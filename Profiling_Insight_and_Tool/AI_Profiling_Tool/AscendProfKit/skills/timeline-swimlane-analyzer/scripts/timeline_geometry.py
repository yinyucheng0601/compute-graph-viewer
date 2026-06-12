#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""timeline_geometry.py — 从 Ascend Profiling timeline 计算泳道时序结构指标。

纯标准库实现，无第三方依赖。输入 chrome trace 格式的 trace_view.json / msprof_*.json，
输出本 skill 8 个维度里可由"区间几何"直接算出的部分：

  - 各泳道忙时 / 空挡比例 / 最大间隔 / 间隙 P95（维度 3）
  - 计算-通信重叠率 / 暴露通信（维度 2，优先读 Overlap Analysis 轨道）
  - 关键路径近似 = device 计算 ∪ 暴露通信 的忙时并集长度及其占比（维度 1，近似，无依赖边）
  - step 抖动 / 长尾（维度 6，需额外传入 step_trace_time.csv）

注意：关键路径为"忙时并集"近似，不含算子间显式依赖边；精确关键路径需依赖图，
本脚本给出可落地的工程近似，供 AI 结合 Timeline 视图人工校正。

用法:
  python timeline_geometry.py <trace_view.json> [--step-trace step_trace_time.csv]
                              [--top 10] [--json]
                              [--device-regex REGEX] [--comm-regex REGEX]

所有时间输出单位为 ms（chrome trace 原始 ts/dur 为微秒，自动 /1000）。
"""
import argparse
import json
import re
import sys
from collections import defaultdict

US_TO_MS = 1.0 / 1000.0

# 泳道（进程名）默认归类正则，可用 --device-regex / --comm-regex 覆盖
DEFAULT_DEVICE_REGEX = r"Ascend\s*Hardware|NPU|AI\s*Core|Device"
DEFAULT_COMM_REGEX = r"Communication|HCCL|Collective"
OVERLAP_PROC_REGEX = r"Overlap\s*Analysis"


def load_events(path):
    """读取 chrome trace。兼容顶层 list 或 {"traceEvents": [...]}。"""
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        data = json.load(f)
    if isinstance(data, dict):
        return data.get("traceEvents", [])
    return data


def build_name_maps(events):
    """从 metadata 事件(ph==M)解析 pid->进程名、(pid,tid)->线程名。"""
    proc_name, thread_name = {}, {}
    for e in events:
        if e.get("ph") != "M":
            continue
        args = e.get("args") or {}
        nm = args.get("name")
        if nm is None:
            continue
        if e.get("name") == "process_name":
            proc_name[e.get("pid")] = nm
        elif e.get("name") == "thread_name":
            thread_name[(e.get("pid"), e.get("tid"))] = nm
    return proc_name, thread_name


def collect_intervals(events):
    """收集 complete 事件(ph==X, 含 dur)为 (pid,tid)->[(start_us,end_us,name)]。"""
    lanes = defaultdict(list)
    for e in events:
        if e.get("ph") != "X":
            continue
        dur = e.get("dur")
        ts = e.get("ts")
        if dur is None or ts is None:
            continue
        try:
            ts = float(ts)
            dur = float(dur)
        except (TypeError, ValueError):
            continue
        if dur <= 0:
            continue
        lanes[(e.get("pid"), e.get("tid"))].append((ts, ts + dur, e.get("name", "")))
    return lanes


def merge_union(intervals):
    """合并重叠区间，返回 (merged_list, busy_us, gaps_us)。intervals: [(s,e,...)]"""
    if not intervals:
        return [], 0.0, []
    ivs = sorted((iv[0], iv[1]) for iv in intervals)
    merged = [list(ivs[0])]
    for s, e in ivs[1:]:
        if s <= merged[-1][1]:
            if e > merged[-1][1]:
                merged[-1][1] = e
        else:
            merged.append([s, e])
    busy = sum(e - s for s, e in merged)
    gaps = [merged[i + 1][0] - merged[i][1] for i in range(len(merged) - 1)]
    return merged, busy, gaps


def percentile(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    k = (len(s) - 1) * (p / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def union_of_many(*interval_groups):
    """对若干区间组求总并集长度(us)。每组为 [(s,e),...]。"""
    flat = []
    for g in interval_groups:
        flat.extend((s, e) for s, e in g)
    _, busy, _ = merge_union([(s, e, "") for s, e in flat])
    return busy


def analyze_lanes(lanes, proc_name, thread_name, top):
    rows = []
    global_start, global_end = None, None
    for (pid, tid), ivs in lanes.items():
        # Overlap Analysis 是派生轨道，不是真实执行泳道，排除出空挡排名
        if re.search(OVERLAP_PROC_REGEX, proc_name.get(pid, "") or "", re.I):
            continue
        merged, busy, gaps = merge_union(ivs)
        if not merged:
            continue
        span = merged[-1][1] - merged[0][0]
        if global_start is None or merged[0][0] < global_start:
            global_start = merged[0][0]
        if global_end is None or merged[-1][1] > global_end:
            global_end = merged[-1][1]
        pname = proc_name.get(pid, str(pid))
        tname = thread_name.get((pid, tid), str(tid))
        rows.append({
            "lane": f"{pname} / {tname}",
            "proc": pname,
            "n_intervals": len(ivs),
            "busy_ms": busy * US_TO_MS,
            "span_ms": span * US_TO_MS,
            "idle_ratio": (1 - busy / span) if span > 0 else 0.0,
            "max_gap_ms": (max(gaps) if gaps else 0.0) * US_TO_MS,
            "gap_p95_ms": percentile(gaps, 95) * US_TO_MS,
        })
    rows.sort(key=lambda r: r["idle_ratio"], reverse=True)
    return rows[:top] if top else rows, global_start, global_end


def analyze_overlap(events, lanes, proc_name, device_re, comm_re):
    """优先读 Overlap Analysis 轨道；否则按区间求计算∩通信交集。"""
    # 1) Overlap Analysis 轨道
    ov_buckets = defaultdict(float)
    ov_pids = {pid for pid, nm in proc_name.items() if re.search(OVERLAP_PROC_REGEX, nm or "", re.I)}
    if ov_pids:
        for e in events:
            if e.get("ph") == "X" and e.get("pid") in ov_pids and e.get("dur"):
                ov_buckets[e.get("name", "")] += float(e["dur"])
    if ov_buckets:
        comm_total = sum(v for k, v in ov_buckets.items()
                         if re.search(r"Communication", k, re.I) and "Not Overlapped" not in k)
        exposed = sum(v for k, v in ov_buckets.items() if "Not Overlapped" in k)
        result = {
            "source": "Overlap Analysis 轨道",
            "buckets_ms": {k: v * US_TO_MS for k, v in ov_buckets.items()},
        }
        if comm_total > 0:
            result["comm_total_ms"] = comm_total * US_TO_MS
            result["exposed_comm_ms"] = exposed * US_TO_MS
            result["overlap_ratio"] = max(0.0, 1 - exposed / comm_total)
        return result

    # 2) 回退：区间交集
    dev_iv, comm_iv = [], []
    for (pid, tid), ivs in lanes.items():
        pname = proc_name.get(pid, "")
        if re.search(device_re, pname or "", re.I):
            dev_iv.extend((s, e) for s, e, _ in ivs)
        elif re.search(comm_re, pname or "", re.I):
            comm_iv.extend((s, e) for s, e, _ in ivs)
    if not comm_iv:
        return {"source": "区间交集", "note": "未识别到通信泳道，无法计算重叠率"}
    comm_union = union_of_many(comm_iv)
    dev_union = union_of_many(dev_iv)
    both_union = union_of_many(dev_iv, comm_iv)
    overlap = dev_union + comm_union - both_union  # 容斥
    overlap = max(0.0, overlap)
    return {
        "source": "区间交集（无 Overlap Analysis 轨道，回退计算）",
        "comm_total_ms": comm_union * US_TO_MS,
        "exposed_comm_ms": max(0.0, comm_union - overlap) * US_TO_MS,
        "overlap_ratio": (overlap / comm_union) if comm_union > 0 else 0.0,
        "_dev_iv": dev_iv, "_comm_iv": comm_iv,
    }


def analyze_critical_path(lanes, proc_name, overlap, device_re, comm_re, gstart, gend):
    """关键路径近似 = (device 计算 ∪ 暴露通信) 忙时并集。无依赖边，仅工程近似。"""
    dev_iv = overlap.get("_dev_iv")
    comm_iv = overlap.get("_comm_iv")
    if dev_iv is None:
        dev_iv, comm_iv = [], []
        for (pid, tid), ivs in lanes.items():
            pname = proc_name.get(pid, "")
            if re.search(device_re, pname or "", re.I):
                dev_iv.extend((s, e) for s, e, _ in ivs)
            elif re.search(comm_re, pname or "", re.I):
                comm_iv.extend((s, e) for s, e, _ in ivs)
    cp = union_of_many(dev_iv, comm_iv)
    total = (gend - gstart) if (gstart is not None and gend is not None) else 0.0
    return {
        "critical_path_ms": cp * US_TO_MS,
        "total_span_ms": total * US_TO_MS,
        "critical_path_ratio": (cp / total) if total > 0 else 0.0,
        "note": "忙时并集近似，未含算子间依赖边，请结合 Timeline 视图校正",
    }


def parse_csv_simple(path):
    rows = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        header = None
        for line in f:
            cells = [c.strip() for c in line.rstrip("\n").split(",")]
            if header is None:
                header = cells
                continue
            if len(cells) < len(header):
                continue
            rows.append(dict(zip(header, cells)))
    return header, rows


def analyze_jitter(path):
    """从 step_trace_time.csv 估算每 step 墙钟并算抖动。单位微秒→ms。"""
    try:
        header, rows = parse_csv_simple(path)
    except OSError as ex:
        return {"error": f"读取失败: {ex}"}
    if not rows:
        return {"error": "step_trace_time.csv 为空"}

    def fnum(d, key):
        try:
            return float(d.get(key, "") or 0)
        except ValueError:
            return 0.0

    # 优先用单一总时长列；否则用不重叠分量求和近似墙钟
    total_cols = [c for c in header if re.search(r"e2e|total|step.*time|elapsed", c, re.I)]
    comp_keys = [c for c in header if c.strip() in
                 ("Computing", "Communication(Not Overlapped)", "Free")]
    steps = []
    for r in rows:
        if any(k in r for k in ("Step", "step", "Step ID")):
            if total_cols:
                steps.append(fnum(r, total_cols[0]))
            elif comp_keys:
                steps.append(sum(fnum(r, k) for k in comp_keys))
    steps = [s for s in steps if s > 0]
    if not steps:
        return {"error": "无法从 step_trace_time.csv 解析出每 step 耗时",
                "header": header}
    steps_ms = [s * US_TO_MS for s in steps]
    mean = sum(steps_ms) / len(steps_ms)
    mx, mn = max(steps_ms), min(steps_ms)
    p50 = percentile(steps_ms, 50)
    p95 = percentile(steps_ms, 95)
    var = sum((x - mean) ** 2 for x in steps_ms) / len(steps_ms)
    std = var ** 0.5
    median = p50 or mean
    tail = [i for i, x in enumerate(steps_ms) if x > max(p95, 1.5 * median)]
    return {
        "n_steps": len(steps_ms),
        "mean_ms": mean, "p50_ms": p50, "p95_ms": p95,
        "min_ms": mn, "max_ms": mx,
        "cv": (std / mean) if mean > 0 else 0.0,
        "jitter_maxmin_over_mean": ((mx - mn) / mean) if mean > 0 else 0.0,
        "longtail_step_idx": tail,
        "source_total_col": total_cols[0] if total_cols else "Computing+Comm(NotOverlapped)+Free 近似",
    }


def analyze_comm_jitter(path):
    """从 step_trace_time.csv 计算逐 step 通信耗时的 CV（通信抖动）。单位微秒→ms。"""
    try:
        header, rows = parse_csv_simple(path)
    except OSError as ex:
        return {"error": f"读取失败: {ex}"}
    if not rows:
        return {"error": "step_trace_time.csv 为空"}

    def fnum(d, key):
        try:
            return float(d.get(key, "") or 0)
        except ValueError:
            return 0.0

    comm_cols = [c for c in header
                 if re.search(r"Communication\(Not Overlapped\)|communication.*not.*overlapped", c, re.I)]
    if not comm_cols:
        comm_cols = [c for c in header if re.search(r"^Communication$|^Comm$", c, re.I)]
    if not comm_cols:
        return {"error": "step_trace_time.csv 中未找到通信耗时列", "header": header}

    comm_col = comm_cols[0]
    steps = []
    for r in rows:
        if any(k in r for k in ("Step", "step", "Step ID")):
            val = fnum(r, comm_col)
            if val > 0:
                steps.append(val)

    if len(steps) < 2:
        return {"error": f"通信时长序列仅 {len(steps)} 个 step，无法计算 CV"}

    steps_ms = [s * US_TO_MS for s in steps]
    mean = sum(steps_ms) / len(steps_ms)
    if mean <= 0:
        return {"error": "通信时长均值为 0"}
    var = sum((x - mean) ** 2 for x in steps_ms) / len(steps_ms)
    std = var ** 0.5
    return {
        "n_steps": len(steps_ms),
        "mean_ms": mean,
        "std_ms": std,
        "cv": std / mean,
        "source_col": comm_col,
    }


def analyze_op_utilization(lanes, proc_name, device_re, gstart, gend):
    """AI Core 利用率 = device 计算泳道忙时 / step 总跨度（time-based，非 FLOPs-based）。"""
    total = (gend - gstart) if (gstart is not None and gend is not None) else 0.0
    if total <= 0:
        return {"error": "无法确定 step 跨度"}

    dev_iv = []
    for (pid, tid), ivs in lanes.items():
        pname = proc_name.get(pid, "")
        if re.search(device_re, pname or "", re.I):
            dev_iv.extend((s, e) for s, e, _ in ivs)

    if not dev_iv:
        return {"error": "未识别到计算泳道（device_re 无匹配）"}

    _, busy, _ = merge_union([(s, e, "") for s, e in dev_iv])
    return {
        "busy_ms": busy * US_TO_MS,
        "total_ms": total * US_TO_MS,
        "op_utilization": min(1.0, busy / total),
    }


def fmt(v, n=2):
    return f"{v:.{n}f}"


def print_report(args, lanes_rows, gstart, gend, overlap, crit, jitter, comm_jitter, op_util):
    print("=" * 72)
    print("Timeline 泳道时序结构分析  (单位: ms)")
    print("=" * 72)

    print("\n[维度3] 泳道空挡 Top（按空闲比例降序）")
    print(f"  {'泳道':<40}{'忙时':>9}{'跨度':>9}{'空挡%':>8}{'最大间隔':>10}{'间隙P95':>9}")
    for r in lanes_rows:
        print(f"  {r['lane'][:39]:<40}{fmt(r['busy_ms']):>9}{fmt(r['span_ms']):>9}"
              f"{fmt(r['idle_ratio']*100):>8}{fmt(r['max_gap_ms']):>10}{fmt(r['gap_p95_ms']):>9}")

    print("\n[维度2] 计算-通信重叠")
    print(f"  来源: {overlap.get('source')}")
    if "overlap_ratio" in overlap:
        print(f"  通信总时长: {fmt(overlap['comm_total_ms'])} | "
              f"暴露通信: {fmt(overlap['exposed_comm_ms'])} | "
              f"重叠率: {fmt(overlap['overlap_ratio']*100)}%")
        if overlap["overlap_ratio"] < 0.70:
            print("  ⚠ 重叠率 < 70%：通信掩盖不足，暴露通信进入关键路径（见 SKILL 维度2）")
    else:
        print(f"  {overlap.get('note', '')}")
    if overlap.get("buckets_ms"):
        for k, v in sorted(overlap["buckets_ms"].items(), key=lambda x: -x[1]):
            print(f"    - {k}: {fmt(v)}")

    print("\n[维度1] 关键路径（忙时并集近似）")
    print(f"  关键路径: {fmt(crit['critical_path_ms'])} | 总跨度: {fmt(crit['total_span_ms'])} | "
          f"占比: {fmt(crit['critical_path_ratio']*100)}%")
    if crit["critical_path_ratio"] and crit["critical_path_ratio"] < 0.80:
        print("  ⚠ 关键路径占比 < 80%：存在可掩盖空泡，优先做重叠/下发优化（见 SKILL 维度1）")
    print(f"  说明: {crit['note']}")

    if jitter is not None:
        print("\n[维度6] step 抖动 / 长尾")
        if "error" in jitter:
            print(f"  {jitter['error']}")
        else:
            print(f"  step 数: {jitter['n_steps']} | mean: {fmt(jitter['mean_ms'])} | "
                  f"P50: {fmt(jitter['p50_ms'])} | P95: {fmt(jitter['p95_ms'])} | "
                  f"max: {fmt(jitter['max_ms'])}")
            print(f"  CV: {fmt(jitter['cv']*100)}% | (max-min)/mean: "
                  f"{fmt(jitter['jitter_maxmin_over_mean']*100)}%")
            print(f"  长尾 step 序号: {jitter['longtail_step_idx'] or '无'}")
            if jitter["cv"] > 0.10:
                print("  ⚠ CV > 10%：训练不稳定，先 per-step 归一取典型 step 再分析（见 SKILL 维度6）")

    print("\n[新增] 算子利用率（AI Core time-based）")
    if "error" in op_util:
        print(f"  {op_util['error']}")
    else:
        util_pct = op_util["op_utilization"] * 100
        print(f"  device 忙时: {fmt(op_util['busy_ms'])} ms | step 跨度: {fmt(op_util['total_ms'])} ms | "
              f"算子利用率: {fmt(util_pct)}%")
        if util_pct < 60:
            print("  ⚠ 算子利用率 < 60%：大量空泡/等待，结合关键路径占比与空挡比例定位根因")

    if comm_jitter is not None:
        print("\n[新增] 通信抖动（逐 step 通信 CV）")
        if "error" in comm_jitter:
            print(f"  {comm_jitter['error']}")
        else:
            print(f"  step 数: {comm_jitter['n_steps']} | 通信均值: {fmt(comm_jitter['mean_ms'])} ms | "
                  f"std: {fmt(comm_jitter['std_ms'])} ms | CV: {fmt(comm_jitter['cv']*100)}%")
            print(f"  来源列: {comm_jitter['source_col']}")
            if comm_jitter["cv"] > 0.15:
                print("  ⚠ CV > 15%：通信时延不稳定，排查慢链路 / 网络拥塞 / HCCL 重传")
    print("=" * 72)


def main():
    ap = argparse.ArgumentParser(description="Ascend timeline 泳道几何结构指标")
    ap.add_argument("trace", help="trace_view.json / msprof_*.json 路径")
    ap.add_argument("--step-trace", help="step_trace_time.csv 路径（算 step 抖动）")
    ap.add_argument("--top", type=int, default=10, help="泳道空挡 Top N，默认 10，0=全部")
    ap.add_argument("--device-regex", default=DEFAULT_DEVICE_REGEX, help="计算泳道进程名正则")
    ap.add_argument("--comm-regex", default=DEFAULT_COMM_REGEX, help="通信泳道进程名正则")
    ap.add_argument("--json", action="store_true", help="以 JSON 输出")
    args = ap.parse_args()

    try:
        events = load_events(args.trace)
    except (OSError, ValueError) as ex:
        print(f"读取 trace 失败: {ex}", file=sys.stderr)
        return 2
    if not events:
        print("trace 中无事件", file=sys.stderr)
        return 2

    proc_name, thread_name = build_name_maps(events)
    lanes = collect_intervals(events)
    lanes_rows, gstart, gend = analyze_lanes(lanes, proc_name, thread_name, args.top)
    overlap = analyze_overlap(events, lanes, proc_name, args.device_regex, args.comm_regex)
    crit = analyze_critical_path(lanes, proc_name, overlap, args.device_regex,
                                 args.comm_regex, gstart, gend)
    jitter = analyze_jitter(args.step_trace) if args.step_trace else None
    comm_jitter = analyze_comm_jitter(args.step_trace) if args.step_trace else None
    op_util = analyze_op_utilization(lanes, proc_name, args.device_regex, gstart, gend)

    # 清理内部字段
    overlap.pop("_dev_iv", None)
    overlap.pop("_comm_iv", None)

    if args.json:
        out = {"lanes": lanes_rows, "overlap": overlap,
               "critical_path": crit, "jitter": jitter,
               "comm_jitter": comm_jitter, "op_util": op_util}
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        print_report(args, lanes_rows, gstart, gend, overlap, crit, jitter, comm_jitter, op_util)
    return 0


if __name__ == "__main__":
    sys.exit(main())

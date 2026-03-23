# 生成符合真实情况的 Swimlane JSON 数据

## 数据来源与格式

真实 swimlane 数据来自 `/Users/yin/gitcode/output_deepseek/merged_swimlane.json`，Chrome Trace 格式（`traceEvents` 数组，`ph: "X"`）。

- **时间单位**：微秒（μs）
- **时间跨度**：~466 μs per stitch
- **总 lanes**：73（Fake Core_0 + AIC_1~24 + AIV_25~72）

tid → lane 映射：
- tid 1000 = `Fake Core_0`
- tid 1002, 1004, ..., 1048 = `AIC_1` ~ `AIC_24`（step 2）
- tid 1050, 1052, ..., 1144 = `AIV_25` ~ `AIV_72`（step 2）

## PTO Swimlane Viewer 的 CoreTask 格式

```json
[
  {
    "blockIdx": 0,
    "coreType": "AIC_1",
    "tasks": [
      {
        "taskId": 123,
        "subGraphId": 0,
        "execStart": 1.06,
        "execEnd": 29.60,
        "semanticLabel": "Query-Linear",
        "taskName": "[Stitch 0] 0-2-59-78-2(Query-Linear)"
      }
    ]
  }
]
```

`coreType` 字符串直接作为泳道名称，决定排序（AIC 在上，AIV 在下）。

## Semantic Label 与颜色映射

| Label | 色值 | 常见于 |
|-------|------|--------|
| `Prolog-Quant` | `#9b6bde` | AIV |
| `Query-Linear` | `#7b57bf` | AIC（主力） |
| `Query-Dequant` | `#4d79d4` | AIV |
| `Query-Hadamard` | `#6f63c5` | AIC |
| `Weight-Linear` | `#4da56d` | AIC |
| `Key-Linear` | `#d98f55` | AIC |
| `Key-Hadamard` | `#e39b63` | AIC |
| `Key-LayerNorm` | `#c86aa0` | AIV |
| `Key-Rope2D` | `#45b5c4` | AIV |
| `fake` | `#5c6370` | Fake Core_0 |

真实数据中 color 字段在 `args.color`，输出为 CoreTask 格式时映射到 `semanticLabel`。

## AIC vs AIV 的真实规律

| 属性 | AIC（cube 计算） | AIV（vector 计算） |
|------|----------------|------------------|
| tasks/lane | ~35（密集） | ~14（稀疏，有自然间隔） |
| dur 范围 | 1.1~28.6 μs | 0.9~35.3 μs |
| 结束时间 | ~457 μs | ~465 μs（晚于 AIC）|
| 处理方式 | re-pack 紧密排列 | 保留原始时间戳，呈现自然稀疏 |

**核心规律**：单个 stitch 内，vector 计算总耗时 > cube 计算，AIC 先完成，AIV 继续。

## 生成脚本模板

```python
import json
from collections import defaultdict

with open('/Users/yin/gitcode/output_deepseek/merged_swimlane.json') as f:
    data = json.load(f)

events = [e for e in data['traceEvents'] if e.get('ph') == 'X']
meta   = [e for e in data['traceEvents'] if e.get('ph') == 'M']
thread_names = {e['tid']: e['args']['name'] for e in meta if e.get('name') == 'thread_name'}

min_ts = min(e['ts'] for e in events)
GAP    = 500.0   # stitch 间空洞（μs），用来演示性能问题
INTER  = 1.0     # AIC lane 内相邻 task 间隔

by_tid = defaultdict(list)
for e in events:
    by_tid[e['tid']].append(e)
for tid in by_tid:
    by_tid[tid].sort(key=lambda e: e['ts'])

lane_tasks = {}

for tid in sorted(by_tid.keys()):
    name = thread_names.get(tid, '')
    raw  = by_tid[tid]
    half = raw[::2]   # 取一半任务

    if name.startswith('AIC'):
        # AIC：re-pack 紧密，保留第一个任务的起始偏移
        cursor = round(half[0]['ts'] - min_ts, 3)
        tasks = []
        for e in half:
            dur = round(e['dur'], 3)
            tasks.append((cursor, round(cursor + dur, 3),
                e['args'].get('color', 'unknown'), e.get('name', ''),
                e['args'].get('taskId', 0), e['args'].get('seqNo', 0)))
            cursor = round(cursor + dur + INTER, 3)

    elif name.startswith('AIV'):
        # AIV：保留原始时间戳（自然稀疏，跨度长于 AIC）
        tasks = []
        for e in half:
            rel_s = round(e['ts'] - min_ts, 3)
            rel_e = round(rel_s + e['dur'], 3)
            tasks.append((rel_s, rel_e,
                e['args'].get('color', 'unknown'), e.get('name', ''),
                e['args'].get('taskId', 0), e['args'].get('seqNo', 0)))

    else:
        # Fake Core_0：re-pack
        cursor = round(raw[0]['ts'] - min_ts, 3)
        tasks = []
        for e in raw[::2]:
            dur = round(e['dur'], 3)
            tasks.append((cursor, round(cursor + dur, 3),
                e['args'].get('color', 'unknown'), e.get('name', ''),
                e['args'].get('taskId', 0), e['args'].get('seqNo', 0)))
            cursor = round(cursor + dur + INTER, 3)

    lane_tasks[tid] = tasks

stitch_span = max(t[1] for tasks in lane_tasks.values() for t in tasks)
offset = stitch_span + GAP

result = []
for tid in sorted(by_tid.keys()):
    thread_name = thread_names.get(tid, f'Core_{tid}')
    is_fake = thread_name.startswith('Fake')
    out_tasks = []

    for rel_s, rel_e, color, tname, task_id, seq_no in lane_tasks[tid]:
        out_tasks.append({'taskId': task_id, 'subGraphId': seq_no,
            'execStart': rel_s, 'execEnd': rel_e,
            'semanticLabel': color, 'taskName': f'[Stitch 0] {tname}'})
        out_tasks.append({'taskId': task_id, 'subGraphId': seq_no,
            'execStart': round(rel_s + offset, 3),
            'execEnd':   round(rel_e + offset, 3),
            'semanticLabel': color, 'taskName': f'[Stitch 1] {tname}'})

    if is_fake:
        out_tasks.append({'taskId': 9999, 'subGraphId': -1,
            'execStart': round(stitch_span + 5, 3),
            'execEnd':   round(stitch_span + GAP - 5, 3),
            'semanticLabel': 'Workspace-Reinit',
            'taskName': 'Workspace-Reinit · 参数未对齐，重分配 workspace'})
        out_tasks.sort(key=lambda t: t['execStart'])

    name_parts = thread_name.replace('_', ' ').split()
    try:    block_idx = max(0, int(name_parts[-1]) - 1)
    except: block_idx = 0

    result.append({'blockIdx': block_idx, 'coreType': thread_name, 'tasks': out_tasks})

with open('/Users/yin/pto/swimlane/samples/output.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, separators=(',', ':'))
```

## Before / After 对比（per-core compaction）

### 气泡根因
Stitch N 与 Stitch N+1 之间存在**全局同步屏障**：所有核都完成 Stitch N 后才能启动 Stitch N+1。
AIC 核在 ~200μs 结束 Stitch 0，但必须等 Fake Core_0（~955μs）才能开始 Stitch 1，空等 ~750μs。

### stitched_before.json 真实数据
- 2 个 Stitch 组（Stitch 0 / Stitch 1）
- AIC per-core gap：~725–763 μs
- AIV per-core gap：~500–590 μs
- 总时间线：1419 μs

### After JSON 生成规则（tools/gen_after.js）
**算法：per-core 独立压缩**，移除全局屏障，每核自己的 Stitch N+1 紧接 Stitch N 后启动：

```
for each block (coreType):
  core_end_N    = max(execEnd)   of stitch N tasks on this core
  core_start_N1 = min(execStart) of stitch N+1 tasks on this core
  per_core_gap  = core_start_N1 - core_end_N
  shift stitch N+1 tasks: execStart -= per_core_gap, execEnd -= per_core_gap
```

效果：总时间线 1419μs → 1040μs（-27%），AIC 泳道无黑色 gap，AIV 同样紧密排布。

## 常见坑

1. **AIV 不要 re-pack**：AIV 本身就是稀疏的，re-pack 后会变成不真实的密集短块，且跨度会短于 AIC，与实际相反
2. **AIC 一定要 re-pack**：取半后间隔翻倍，必须压缩回来
3. **GAP 插在 Fake Core_0**：用 `Workspace-Reinit` 任务填充 gap 区间，直观说明性能浪费原因
4. **时间单位是 μs**：ts 的原始值是 ~8.35×10¹³，换算为相对时间后才是 ~0~466 μs
5. **semanticLabel 不是 color**：viewer 读 `semanticLabel`（或 `label`），原始文件里叫 `args.color`，转换时注意字段名

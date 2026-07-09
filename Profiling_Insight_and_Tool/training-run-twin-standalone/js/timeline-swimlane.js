/*
 * 自包含「Timeline (node2 GPU 7)」泳道图
 * -------------------------------------------------------------------------
 * 原「问题一」定位链的「通信调度层」用 <iframe> 内嵌
 *   ../../pangu-moe-trainviz/op-rank-time-wzhBranch.html?embed=model&panels=timeline&...
 * 一旦 training-run-twin-standalone 文件夹被移动到别的项目，上层相对路径失效、
 * iframe 无法加载，图表就塌掉/变形。这里把该 iframe 依赖的三件东西——
 *   1) 模拟 1F1B 运行时数据（analysis-data.js 的 buildSimulated1F1BRuntime 等）
 *   2) swimlane-task 绘制/tooltip（js/swimlane-task.js，即 PtoSwimlaneTaskPattern）
 *   3) pangu 语义调色板解析出的具体色值（freeze 自 pangu-palette.js balanced/clear 方案）
 * ——就地内联，直接在 <canvas> 上重绘同一张 node2 ranks 16-23 / rank 23 all-to-all
 * timeout 的泳道图，不再依赖任何外部页面或 iframe。
 *
 * 对外只暴露 window.PtoProblemOneTimeline.render(host)；host 内会自动按当前
 * document.documentElement.dataset.theme 取深/浅两套色值渲染，随窗口尺寸自适应。
 */
(function () {
  "use strict";

  /* ============ 数据模拟：copy 自 pangu-moe-trainviz/js/analysis-data.js ============ */
  function hash01(a, b = 0, c = 0, d = 0) {
    let h = ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791) ^ (d * 2654435761)) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 1274126177) >>> 0;
    return h / 4294967295;
  }

  function compDuration(stage, type, microbatch, forwardBaseUs, backwardBaseUs) {
    const base = type === "F" ? forwardBaseUs : backwardBaseUs;
    const stageWeight = stage === 0 ? 0.9 : 1.08;
    const microbatchWeight = 0.74 + hash01(stage, type === "F" ? 1 : 2, microbatch) * 0.62;
    return base * stageWeight * microbatchWeight;
  }

  function simulate1F1BSchedule(stageCount, microbatches, forwardBaseUs, backwardBaseUs, ppCommUs) {
    const compF = Array.from({ length: stageCount }, () => Array(microbatches).fill(null));
    const compB = Array.from({ length: stageCount }, () => Array(microbatches).fill(null));
    const stageFree = Array(stageCount).fill(0);
    const seq = [];
    const idx = Array(stageCount).fill(0);
    const stageOps = Array.from({ length: stageCount }, () => []);

    for (let stage = 0; stage < stageCount; stage++) {
      const warmupCount = stageCount - 1 - stage;
      const steadyCount = microbatches - warmupCount;
      const ops = [];
      let fMicro = 0;
      let bMicro = 0;
      for (let k = 0; k < warmupCount; k++) ops.push({ type: "F", microbatch: fMicro++ });
      for (let k = 0; k < steadyCount; k++) {
        ops.push({ type: "F", microbatch: fMicro++ });
        ops.push({ type: "B", microbatch: bMicro++ });
      }
      while (bMicro < microbatches) ops.push({ type: "B", microbatch: bMicro++ });
      seq.push(ops);
    }

    let scheduled = 0;
    const total = stageCount * microbatches * 2;
    let guard = 0;
    while (scheduled < total && guard++ < 20000) {
      let progressed = false;
      for (let stage = 0; stage < stageCount; stage++) {
        if (idx[stage] >= seq[stage].length) continue;
        const op = seq[stage][idx[stage]];
        let dep = 0;
        if (op.type === "F") {
          if (stage > 0) {
            const upstream = compF[stage - 1][op.microbatch];
            if (!upstream) continue;
            dep = upstream.end + ppCommUs;
          }
        } else if (stage < stageCount - 1) {
          const downstream = compB[stage + 1][op.microbatch];
          if (!downstream) continue;
          dep = downstream.end + ppCommUs;
        } else {
          const localForward = compF[stage][op.microbatch];
          if (!localForward) continue;
          dep = localForward.end;
        }
        const start = Math.max(stageFree[stage], dep);
        const dur = compDuration(stage, op.type, op.microbatch, forwardBaseUs, backwardBaseUs);
        const rec = { start, end: start + dur, type: op.type, m: op.microbatch };
        (op.type === "F" ? compF : compB)[stage][op.microbatch] = rec;
        stageOps[stage].push(rec);
        stageFree[stage] = rec.end;
        idx[stage]++;
        scheduled++;
        progressed = true;
      }
      if (!progressed) break;
    }

    let totalUs = 0;
    for (let stage = 0; stage < stageCount; stage++) {
      for (let microbatch = 0; microbatch < microbatches; microbatch++) {
        totalUs = Math.max(totalUs, compF[stage][microbatch]?.end || 0, compB[stage][microbatch]?.end || 0);
      }
    }
    return { compF, compB, stageOps, totalUs: totalUs + ppCommUs };
  }

  function buildSimulated1F1BRuntime({
    dp = 2, pp = 4, tp = 2, ep = 2, microbatches = 8,
    forwardBaseUs = 420, backwardBaseUs = 780,
    ppCommUs = 72, tpCommUs = 58, epCommUs = 96, dpCommUs = 64,
    stageRanges = [[0, 12], [13, 25], [26, 37], [38, 49]],
    anomaly = null, rankFilter = null,
  } = {}) {
    const anomalyRank = anomaly?.type === "ep-timeout" ? anomaly.rank : -1;
    const anomalyDurUs = anomaly?.type === "ep-timeout" ? (anomaly.durUs || 30_000_000) : 0;
    const { compF, compB, stageOps, totalUs } = simulate1F1BSchedule(pp, microbatches, forwardBaseUs, backwardBaseUs, ppCommUs);
    const ranks = [];
    for (let dpIndex = 0; dpIndex < dp; dpIndex++) {
      for (let stage = 0; stage < pp; stage++) {
        for (let tpIndex = 0; tpIndex < tp; tpIndex++) {
          for (let epIndex = 0; epIndex < ep; epIndex++) {
            const rank = (((dpIndex * pp + stage) * tp + tpIndex) * ep) + epIndex;
            const jitter = (offset) => (((rank * 131 + offset * 977) % 100) / 100 - 0.5);
            const rankKey = (variant) => `rank:r${rank}:v${variant % 7}`;
            const range = stageRanges[stage] || stageRanges[stageRanges.length - 1] || [0, 0];
            const tasks = [];

            const emit = (rec, type, microbatch) => {
              if (!rec) return;
              const start = rec.start;
              const dur = rec.end - rec.start;
              const straggler = hash01(rank, type === "F" ? 91 : 97, microbatch) > 0.82 ? 0.06 : 0;
              const load = Math.min(1, 0.70 + hash01(rank, type === "F" ? 11 : 17, microbatch) * 0.26 + straggler);
              const visualDur = dur * load;
              tasks.push({
                startUs: start, durUs: visualDur, slotStartUs: start, slotDurUs: dur,
                rankLoad: load, kind: type, microbatch, status: "ok", label: `${type} m${microbatch}`,
                opName: `${type === "F" ? "Forward" : "Backward"} · micro ${microbatch} · L${range[0]}-L${range[1]} · 填充 ${(load * 100) | 0}%`,
              });
              tasks.push({
                startUs: start + dur * 0.58, durUs: tpCommUs * (0.72 + jitter(5) * 0.5),
                kind: "tp", colorKey: "sem:attention", rankColorKey: rankKey(5), microbatch, status: "overlap",
                label: "AR", opName: `TP All-Reduce · ${tp}-rank TP group · micro ${microbatch}`,
              });
              tasks.push({
                startUs: start + dur * 0.26,
                durUs: (rank === anomalyRank && anomalyDurUs > 0) ? anomalyDurUs : epCommUs * (0.7 + jitter(6) * 0.6),
                kind: "ep", colorKey: "sem:comm", rankColorKey: rankKey(6), microbatch,
                status: (rank === anomalyRank && anomalyDurUs > 0) ? "timeout" : "overlap",
                label: (rank === anomalyRank && anomalyDurUs > 0) ? "A2A TIMEOUT" : "A2A",
                opName: (rank === anomalyRank && anomalyDurUs > 0)
                  ? `EP All-to-All TIMEOUT · rank ${rank} · 30s · expert dispatch deadlock`
                  : `EP All-to-All · ${ep}-rank expert group · token dispatch/combine · micro ${microbatch}`,
              });
            };

            for (let microbatch = 0; microbatch < microbatches; microbatch++) {
              emit(compF[stage][microbatch], "F", microbatch);
              emit(compB[stage][microbatch], "B", microbatch);
            }
            for (let microbatch = 0; microbatch < microbatches; microbatch++) {
              const pushPp = (at, label) => tasks.push({
                startUs: Math.max(0, at), durUs: ppCommUs * 0.8, kind: "pp",
                colorKey: "sem:mlp", rankColorKey: rankKey(4), microbatch, status: "ok", label: "PP", opName: label,
              });
              if (stage > 0 && compF[stage][microbatch]) pushPp(compF[stage][microbatch].start - ppCommUs * 0.8, `PP recv activation ← PP${stage - 1} · micro ${microbatch}`);
              if (stage < pp - 1 && compF[stage][microbatch]) pushPp(compF[stage][microbatch].end, `PP send activation → PP${stage + 1} · micro ${microbatch}`);
              if (stage < pp - 1 && compB[stage][microbatch]) pushPp(compB[stage][microbatch].start - ppCommUs * 0.8, `PP recv gradient ← PP${stage + 1} · micro ${microbatch}`);
              if (stage > 0 && compB[stage][microbatch]) pushPp(compB[stage][microbatch].end, `PP send gradient → PP${stage - 1} · micro ${microbatch}`);
              if (compB[stage][microbatch]) {
                tasks.push({
                  startUs: compB[stage][microbatch].end - dpCommUs * 0.38, durUs: dpCommUs * (0.78 + jitter(8) * 0.42),
                  kind: "dp", colorKey: "sem:head", rankColorKey: rankKey(2), microbatch, status: "overlap",
                  label: "DP", opName: `DP gradient sync · D0/D1 replica group · PP${stage} TP${tpIndex} EP${epIndex} · micro ${microbatch}`,
                });
              }
            }

            const ops = stageOps[stage];
            const bubbleThreshold = ppCommUs * 0.9;
            let prev = 0;
            ops.forEach((op) => {
              if (op.start - prev > bubbleThreshold) {
                tasks.push({
                  startUs: prev, durUs: op.start - prev, kind: "bubble", status: "wait",
                  colorKey: "pipeline:bubble", rankColorKey: rankKey(3), label: "bubble",
                  opName: `Pipeline bubble · PP${stage} 等待跨 stage 依赖（${prev < 1 ? "warmup 填充" : "1F1B 空泡"}）`,
                });
              }
              prev = Math.max(prev, op.end);
            });
            if (totalUs - prev > bubbleThreshold) {
              tasks.push({
                startUs: prev, durUs: totalUs - prev, kind: "bubble", status: "wait",
                colorKey: "pipeline:bubble", rankColorKey: rankKey(3), label: "bubble",
                opName: `Pipeline bubble · PP${stage} drain 尾部空闲（流水线排空）`,
              });
            }

            ranks.push({
              rank, dp: dpIndex, stage, tp: tpIndex, ep: epIndex,
              label: `Rank ${rank}`, group: `D${dpIndex}·PP${stage}·TP${tpIndex}·EP${epIndex}`, tasks,
            });
          }
        }
      }
    }
    return {
      config: { dp, pp, tp, ep, microbatches },
      timeRangeUs: [0, totalUs],
      ranks: rankFilter ? ranks.filter((r) => r.rank >= rankFilter.from && r.rank <= rankFilter.to) : ranks,
    };
  }

  /* ============ 语义色值：freeze 自 pangu-palette.js（balanced / clear 方案） ============ */
  // taskColor 只用到这几个 key：sem:attention(tp)、sem:comm(ep)、sem:mlp(pp)、
  // sem:head(dp)、pipeline:bubble(bubble)、rank:r{n}:v0(F/B 按 microbatch 上色)。
  const PALETTE = {
    dark: {
      "sem:attention": "#49c5f6", "sem:comm": "#c9107d", "sem:mlp": "#f6b24d", "sem:head": "#c9107d",
      "pipeline:bubble": "#3b3b3b",
      rank: ["#fa8c42", "#87c80f", "#5192ff", "#9457e9", "#f9823a", "#38bdf8", "#d8b900", "#6b92ff", "#a855f7", "#e052b0", "#a6d92c", "#f6b24d", "#49c5f6", "#3577f6", "#c9107d", "#e1c84a", "#fa8c42", "#87c80f", "#5192ff", "#9457e9", "#f9823a", "#38bdf8", "#d8b900", "#6b92ff", "#a855f7", "#e052b0", "#a6d92c", "#f6b24d", "#49c5f6", "#3577f6", "#c9107d", "#e1c84a"],
      gray: "#8b929e",
    },
    light: {
      "sem:attention": "#8dcfd5", "sem:comm": "#beaee1", "sem:mlp": "#e6db92", "sem:head": "#beaee1",
      "pipeline:bubble": "#b7c0cb",
      rank: ["#9bbae6", "#dab8e2", "#e6db92", "#a4b0dd", "#e6b696", "#c1dc75", "#8dcfd5", "#beaee1", "#9bbae6", "#dab8e2", "#e6db92", "#a4b0dd", "#e6b696", "#c1dc75", "#8dcfd5", "#beaee1", "#9bbae6", "#dab8e2", "#e6db92", "#a4b0dd", "#e6b696", "#c1dc75", "#8dcfd5", "#beaee1", "#9bbae6", "#dab8e2", "#e6db92", "#a4b0dd", "#e6b696", "#c1dc75", "#8dcfd5", "#beaee1"],
      gray: "#64748b",
    },
  };
  const hexInt = (hex) => parseInt(hex.slice(1), 16);

  // 问题一（node2 ranks 16-23，rank 23 all-to-all timeout）配置，
  // 与原 iframe 的 buildSimulated1F1BRuntime({...trace=deepseek-v32}) 完全一致。
  const RUNTIME_CONFIG = {
    dp: 1, pp: 8, tp: 1, ep: 64, microbatches: 64,
    forwardBaseUs: 320, backwardBaseUs: 620, ppCommUs: 48, epCommUs: 82,
    stageRanges: [[0, 7], [8, 15], [16, 23], [24, 31], [32, 39], [40, 47], [48, 55], [56, 60]],
    anomaly: { type: "ep-timeout", rank: 23, durUs: 30_000_000 },
    rankFilter: { from: 16, to: 23 },
  };

  /* ============ 绘制：port 自 op-rank-time-wzhBranch.html 的 paintAxis/paintBody ============ */
  const ROW_H = 24, GUT = 112, AXIS_H = 28;
  const ANOMALY_RANK = 23;
  const CANVAS_MULT = 3; // 原页 deepseek trace 用 3× 画布宽，问题区放大、其余横向滚动
  const COMM_SPLIT = true; // 原 iframe 带 commDual=1：通信与计算同款双轨

  const toHex = (n) => "#" + ((n >>> 0) & 0xffffff).toString(16).padStart(6, "0");
  const fmtUs = (u) => (u >= 1000 ? (u / 1000).toFixed(2) + "ms" : Math.round(u) + "µs");
  function rgbaHex(colorHex, alpha) {
    const value = (colorHex >>> 0) & 0xffffff;
    return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
  }
  function darken(colorHex, f) {
    const v = (colorHex >>> 0) & 0xffffff;
    return ((Math.round(((v >> 16) & 255) * f) << 16) | (Math.round(((v >> 8) & 255) * f) << 8) | Math.round((v & 255) * f)) >>> 0;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function makeColorCtx(light) {
    const p = light ? PALETTE.light : PALETTE.dark;
    const SEM = {
      "sem:attention": hexInt(p["sem:attention"]),
      "sem:comm": hexInt(p["sem:comm"]),
      "sem:mlp": hexInt(p["sem:mlp"]),
      "sem:head": hexInt(p["sem:head"]),
      "pipeline:bubble": hexInt(p["pipeline:bubble"]),
    };
    const RANK = p.rank.map(hexInt);
    const GRAY = hexInt(p.gray);
    const LINE = { tp: SEM["sem:attention"], ep: SEM["sem:comm"], pp: SEM["sem:mlp"] };
    return { light, SEM, RANK, GRAY, LINE };
  }

  function taskColor(task, cc) {
    if (task?.status === "timeout") return 0xef4444; // 红色标注 timeout
    if (task?.kind === "tp") return cc.LINE.tp;
    if (task?.kind === "ep") return cc.LINE.ep;
    if (task?.kind === "pp") return cc.LINE.pp;
    if (task?.kind === "bubble") return cc.SEM["pipeline:bubble"] ?? 0xf43f5e;
    if (task?.kind === "F" || task?.kind === "B") {
      const base = cc.RANK[(task.microbatch || 0) % 32] ?? (cc.SEM["sem:attention"] ?? cc.GRAY);
      return task.kind === "B" && !cc.light ? darken(base, 0.66) : base;
    }
    if (task?.colorKey && cc.SEM[task.colorKey] != null) return cc.SEM[task.colorKey];
    return cc.SEM["sem:attention"] ?? cc.GRAY;
  }

  // tooltip 内容：port 自原页 swimRowTooltip（去掉 CTA 下钻高亮相关字段，embed 里恒为空）
  function rowTooltipHtml(hit) {
    const t = hit.task, r = hit.r;
    const row = (k, v, cls = "") =>
      `<div class="pto-swimlane-task-tooltip__row"><span class="pto-swimlane-task-tooltip__key">${esc(k)}</span><span class="pto-swimlane-task-tooltip__value${cls ? " " + cls : ""}">${esc(v)}</span></div>`;
    const kindName = { F: "Forward 前向", B: "Backward 反向", tp: "TP All-Reduce", ep: "EP All-to-All", pp: "PP send/recv", bubble: "Pipeline bubble" }[t.kind] || t.kind;
    const isComm = t.kind === "tp" || t.kind === "ep" || t.kind === "pp";
    const cat = isComm ? "通信" : (t.kind === "bubble" ? "气泡" : "计算");
    const catCls = isComm ? "is-warn" : (t.kind === "bubble" ? "is-bad" : "is-ok");
    const desc = {
      F: "前向计算：本 PP stage 负责的层区间前向传播。",
      B: "反向计算：本 PP stage 反向传播、求梯度。",
      tp: "张量并行 All-Reduce：TP 组内同步分片结果，与计算重叠执行。",
      ep: "专家并行 All-to-All：MoE token 的 dispatch / combine 路由通信，与计算重叠执行。",
      pp: "流水线并行 send / recv：跨 PP stage 传递激活（前向）或梯度（反向）。",
      bubble: "流水线气泡：等待跨 stage 依赖的空闲，warmup / 稳态空泡 / drain。",
    }[t.kind] || "";
    return (
      `<div class="pto-swimlane-task-tooltip__title">${esc(r.group)} · Rank ${r.rank}</div>` +
      row("类别", cat, catCls) + row("op", t.opName) + row("kind", kindName) +
      row("start", fmtUs(t.startUs)) + row("dur", fmtUs(t.durUs)) +
      row("status", t.status, t.status === "overlap" ? "is-warn" : t.status === "wait" ? "is-bad" : "is-ok") +
      (desc ? `<div class="pto-swimlane-task-tooltip__row" style="margin-top:6px;display:block"><span class="pto-swimlane-task-tooltip__value" style="display:block;white-space:normal;line-height:1.5">${esc(desc)}</span></div>` : "")
    );
  }

  function render(host) {
    if (!host) return;
    const SW = window.PtoSwimlaneTaskPattern;
    if (!SW) {
      host.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--foreground-secondary)">swimlane-task.js 未加载</div>';
      return;
    }
    const RT = buildSimulated1F1BRuntime(RUNTIME_CONFIG);

    // 主题相关色值/文字色（port 自原页 lightT()/txtMuted() 等）
    let cc;
    const isLight = () => (document.documentElement.dataset.theme || "dark") === "light";
    const txtMuted = () => (cc.light ? "#111111" : "#94a3b8");
    const txtMain = () => (cc.light ? "#0f0f10" : "#e5e7eb");
    const bandA = () => (cc.light ? "rgba(15,23,42,0.04)" : "rgba(255,255,255,0.04)");
    const sepLine = () => (cc.light ? "rgba(15,23,42,0.10)" : "rgba(255,255,255,0.10)");
    const gridLine = () => (cc.light ? "rgba(15,23,42,0.16)" : "rgba(255,255,255,0.16)");
    const rowHilite = () => (cc.light ? "rgba(220,38,38,0.08)" : "rgba(239,68,68,0.12)");

    // DOM 骨架（class 名沿用原页 opv-swim-*，样式见 css/timeline-swimlane.css）
    host.innerHTML = "";
    host.classList.add("opv-swimlane");
    const axisWrap = document.createElement("div");
    axisWrap.className = "opv-swim-axis-wrap";
    const axisCanvas = document.createElement("canvas");
    axisCanvas.className = "opv-swim-axis";
    axisWrap.appendChild(axisCanvas);
    const scrollEl = document.createElement("div");
    scrollEl.className = "opv-swim-scroll";
    const bodyCanvas = document.createElement("canvas");
    bodyCanvas.className = "opv-swim-body";
    scrollEl.appendChild(bodyCanvas);
    host.append(axisWrap, scrollEl);
    scrollEl.addEventListener("scroll", () => { axisWrap.scrollLeft = scrollEl.scrollLeft; });

    const tip = SW.createTooltip();
    host.appendChild(tip);
    const hitRects = [];

    function paintAxis() {
      const W = Math.max(320, host.clientWidth || 320);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const axisW = W * CANVAS_MULT;
      axisCanvas.style.width = axisW + "px";
      axisCanvas.width = Math.round(axisW * dpr);
      axisCanvas.height = Math.round(AXIS_H * dpr);
      const ctx = axisCanvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, axisW, AXIS_H);
      const T = RT.timeRangeUs[1], plotW = axisW - GUT - 8;
      ctx.font = "600 10px JetBrains Mono, monospace";
      ctx.textBaseline = "middle";
      ctx.fillStyle = txtMuted();
      ctx.textAlign = "left";
      ctx.fillText("rank ↓ / time →", 8, AXIS_H / 2);
      ctx.textAlign = "center";
      for (let i = 0; i <= 8; i++) {
        const x = GUT + plotW * i / 8;
        ctx.strokeStyle = gridLine();
        ctx.beginPath();
        ctx.moveTo(x, AXIS_H - 6);
        ctx.lineTo(x, AXIS_H);
        ctx.stroke();
        if (i > 0) { ctx.fillStyle = txtMuted(); ctx.fillText(fmtUs(T * i / 8), x, AXIS_H / 2); }
      }
    }

    function paintBody() {
      const rowH = COMM_SPLIT ? ROW_H * 2 : ROW_H;
      const W = Math.max(320, host.clientWidth || 320);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const bodyH = RT.ranks.length * rowH;
      const bodyW = W * CANVAS_MULT;
      bodyCanvas.style.width = bodyW + "px";
      bodyCanvas.style.height = bodyH + "px";
      bodyCanvas.width = Math.round(bodyW * dpr);
      bodyCanvas.height = Math.round(bodyH * dpr);
      const ctx = bodyCanvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, bodyW, bodyH);
      SW.defaults.textColor = cc.light ? "rgba(15,15,16,0.86)" : "rgba(255,255,255,0.92)";
      SW.defaults.borderDefault = cc.light ? "transparent" : "rgba(255,255,255,0.16)";
      SW.defaults.borderRelated = cc.light ? "transparent" : "rgba(255,255,255,0.46)";
      SW.defaults.borderSelected = cc.light ? toHex(cc.LINE.tp) : "rgba(255,255,255,0.88)";
      hitRects.length = 0;
      const T = RT.timeRangeUs[1], plotW = bodyW - GUT - 8;
      const xOf = (us) => GUT + plotW * (us / T);

      RT.ranks.forEach((r, ri) => {
        const top = ri * rowH;
        const band = (r.dp * RT.config.pp + r.stage);
        const isAnomalyRank = r.rank === ANOMALY_RANK;
        const bg = isAnomalyRank ? rowHilite() : (band % 2 ? bandA() : null);
        if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, top, bodyW, rowH); }
        if (isAnomalyRank) { ctx.fillStyle = rgbaHex(0xef4444, 0.12); ctx.fillRect(0, top, bodyW, rowH); }
        if (r.tp === 0 && ri > 0) {
          ctx.strokeStyle = sepLine();
          ctx.beginPath();
          ctx.moveTo(0, top + 0.5);
          ctx.lineTo(bodyW, top + 0.5);
          ctx.stroke();
        }
        if (COMM_SPLIT) {
          ctx.save();
          ctx.strokeStyle = sepLine();
          ctx.globalAlpha = 0.55;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(GUT, top + rowH / 2 + 0.5);
          ctx.lineTo(bodyW, top + rowH / 2 + 0.5);
          ctx.stroke();
          ctx.restore();
        }
        ctx.font = "600 10px JetBrains Mono, monospace";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillStyle = r.tp === 0 ? txtMain() : txtMuted();
        ctx.fillText(`R${r.rank}`, 8, top + (COMM_SPLIT ? rowH / 4 : rowH / 2));
        if (r.tp === 0) {
          ctx.font = "600 9px JetBrains Mono, monospace";
          ctx.textAlign = "right";
          ctx.fillStyle = txtMuted();
          ctx.fillText(`D${r.dp}·PP${r.stage}`, GUT - 8, top + (COMM_SPLIT ? rowH / 4 : rowH / 2));
        }
        if (COMM_SPLIT) {
          ctx.font = "600 9px JetBrains Mono, monospace";
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";
          ctx.fillStyle = txtMuted();
          ctx.fillText("计算", 38, top + rowH / 4);
          ctx.fillStyle = txtMain();
          ctx.fillText("通信", 8, top + rowH * 3 / 4);
        }
        r.tasks.forEach((t) => {
          const x = xOf(t.startUs);
          const compute = t.kind === "F" || t.kind === "B";
          const w = Math.max(compute ? 2 : 4, xOf(t.startUs + t.durUs) - x);
          if (t.kind === "bubble") {
            const y = top + 3, h = 13;
            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, w, h, 2); else ctx.rect(x, y, w, h);
            const c = taskColor(t, cc);
            ctx.fillStyle = rgbaHex(c, cc.light ? 0.08 : 0.12);
            ctx.fill();
            ctx.clip();
            ctx.strokeStyle = rgbaHex(c, cc.light ? 0.30 : 0.34);
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let hx = x - h; hx < x + w; hx += 5) { ctx.moveTo(hx, y + h); ctx.lineTo(hx + h, y); }
            ctx.stroke();
            ctx.restore();
            hitRects.push({ x, y, w: Math.max(w, 3), h, task: t, r });
          } else if (compute) {
            const y = top + 3, h = 13;
            SW.drawTaskBar(ctx, { x, y, width: w, height: h, baseColor: toHex(taskColor(t, cc)), task: { label: t.label, opName: t.opName }, isSelected: false, isRelated: false, fontFamily: "JetBrains Mono, monospace" });
            hitRects.push({ x, y, w: Math.max(w, 3), h, task: t, r });
          } else if (COMM_SPLIT) {
            const y = top + rowH / 2 + 3, h = 13, cw = Math.max(w, 3);
            SW.drawTaskBar(ctx, { x, y, width: cw, height: h, baseColor: toHex(taskColor(t, cc)), task: { label: t.label, opName: t.opName }, isSelected: false, isRelated: false, fontFamily: "JetBrains Mono, monospace" });
            hitRects.push({ x, y, w: cw, h, task: t, r });
          } else {
            const y = top + rowH - 6, h = 4;
            ctx.fillStyle = toHex(taskColor(t, cc));
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, 2); ctx.fill(); } else ctx.fillRect(x, y, w, h);
            hitRects.push({ x, y: y - 3, w: Math.max(w, 4), h: h + 5, task: t, r });
          }
        });
      });
    }

    function paint() {
      cc = makeColorCtx(isLight());
      paintAxis();
      paintBody();
    }

    bodyCanvas.addEventListener("pointermove", (e) => {
      const rect = bodyCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const inside = (h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h;
      const hit = hitRects.findLast ? hitRects.findLast(inside) : [...hitRects].reverse().find(inside);
      if (hit) SW.showTooltip(tip, hit.task, e, { bounds: host, getTooltipHtml: () => rowTooltipHtml(hit) });
      else SW.hideTooltip(tip);
    });
    bodyCanvas.addEventListener("pointerleave", () => SW.hideTooltip(tip));

    paint();

    // 主题切换 / 尺寸变化时重绘（画布颜色是烘焙进去的，必须重画）
    const themeObs = new MutationObserver(() => paint());
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let roTimer = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(roTimer);
      roTimer = setTimeout(paint, 60);
    });
    ro.observe(host);

    // 若 host 被移除（切换到别的诊断案例会 innerHTML=""），断开观察器避免泄漏
    host._ptoTimelineCleanup = () => { themeObs.disconnect(); ro.disconnect(); };
  }

  window.PtoProblemOneTimeline = { render };
})();

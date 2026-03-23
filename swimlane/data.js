/**
 * data.js — Swimlane Builtin Samples & Domain Knowledge
 *
 * ════════════════════════════════════════════════════════════════
 *  STITCH 领域知识（来源：pypto-master framework 源码）
 * ════════════════════════════════════════════════════════════════
 *
 * ## Stitch（缝合函数）
 *   Dynamic Scheduler 将多个相邻 iteration 的 task list 合并成一个
 *   stitched function 一次性发射执行，称为一次 "Stitch"。
 *   每个 Stitch 对应 seqNo = N，即任务名前缀 "[Stitch N]"。
 *
 * ## taskId 编码
 *   taskId = stitchedStatic << 32 | stitchedRootIndex << 20 | opIndex
 *   - stitchedStatic   (bits 63–32): 第 N 个 stitched function 的 ID
 *   - stitchedRootIndex(bits 31–20): 该 stitch 内第几个 root function
 *   - opIndex          (bits 19–0):  root 内第几个 op
 *
 * ## 任务名格式（taskName）
 *   "[Stitch N] seqNo-funcId-opIdx-rootIndex-psgId(semanticLabel)"
 *   例：[Stitch 0] 0-0-5-82-2(fake)
 *
 * ## seqNo（查看泳道图文档）
 *   表示第几个 stitched function，对应 Stitch 着色模式下的颜色分组。
 *
 * ## StitchKind（device_stitch_context.h）
 *   - StitchDefault:   默认缝合
 *   - StitchPartial:   部分缝合（仅匹配 cell match table 的部分区域）
 *   - StitchFullCover: 全覆盖缝合（一对一完整映射）
 *   - StitchReuse:     重用缝合（workspace 内存复用）
 *
 * ## 气泡（Bubble）根因（device_stitch_context.cpp: ReuseStitch）
 *   泳道图中 Stitch N 与 Stitch N+1 之间的黑色空白区域，由以下原因产生：
 *   1. Workspace 地址重叠：前后两个 stitched function 的 workspace 内存
 *      范围有交叉 → 必须等 Stitch N 全部结束才能启动 Stitch N+1
 *   2. Pool reset times 不匹配：内存池重置时序不一致，强制 serialization
 *   优化方向：减少相邻 stitch 的 workspace 地址重叠，或通过 memory coloring
 *   让相邻 stitch 使用不同的内存池区间，从而消除序列化等待。
 *
 * ════════════════════════════════════════════════════════════════
 *  JSON 格式（merged_swimlane.json / CoreTask 格式）
 * ════════════════════════════════════════════════════════════════
 *
 * [
 *   {
 *     "blockIdx": 0,             // 硬件 block 索引
 *     "coreType": "AIC_1",       // 核心类型（Fake Core / AIC / AIV / AICPU）
 *     "tasks": [
 *       {
 *         "taskId": 5,           // 编码见上 taskId 编码
 *         "subGraphId": 0,       // 所属同构子图 ID
 *         "execStart": 0.0,      // 执行开始时间（μs）
 *         "execEnd": 1.0,        // 执行结束时间（μs）
 *         "semanticLabel": "fake", // 语义标签（set_semantic_label 设置）
 *         "taskName": "[Stitch 0] 0-0-5-82-2(fake)"  // 完整任务名
 *       }
 *     ]
 *   }
 * ]
 *
 * ════════════════════════════════════════════════════════════════
 *  内置 Samples
 * ════════════════════════════════════════════════════════════════
 *
 *  samples/stitched_before.json  — 真实采集的执行 Profile（含 Stitch 间气泡）
 *  samples/stitched_after.json   — 消除气泡后的理想执行形态（由 tools/gen_after.js 生成）
 *
 *  Before vs After 对比：直观量化 workspace 序列化约束带来的空闲开销。
 *  After 生成规则详见 tools/gen_after.js。
 */

const swimlaneRoot = typeof window !== 'undefined' ? window : globalThis;

(function registerBuiltinSwimlaneSamples(root) {
  // ── Fallback：离线/无 HTTP server 时使用的生成数据 ──────────────────

  const PID = 20260320;
  const SPAN = 474.0;
  const PROCESS_NAME = 'Machine View';

  const fakeLabels = [
    { value: 'fake',          weight: 0.70 },
    { value: 'Query-Dequant', weight: 0.10 },
    { value: 'Key-LayerNorm', weight: 0.08 },
    { value: 'Weight-Linear', weight: 0.07 },
    { value: 'Key-Rope2D',    weight: 0.05 },
  ];

  const aicLabels = [
    { value: 'Query-Linear',   weight: 0.59 },
    { value: 'Query-Hadamard', weight: 0.19 },
    { value: 'Key-Linear',     weight: 0.074 },
    { value: 'Weight-Linear',  weight: 0.074 },
    { value: 'Key-Hadamard',   weight: 0.072 },
  ];

  const aivLabels = [
    { value: 'Prolog-Quant',  weight: 0.65 },
    { value: 'Query-Dequant', weight: 0.25 },
    { value: 'Key-LayerNorm', weight: 0.055 },
    { value: 'Weight-Linear', weight: 0.03 },
    { value: 'Key-Rope2D',    weight: 0.015 },
  ];

  const labelStem = {
    fake: 'bookkeeping', 'Prolog-Quant': 'prolog_quant',
    'Query-Linear': 'query_linear', 'Query-Dequant': 'query_dequant',
    'Query-Hadamard': 'query_hadamard', 'Weight-Linear': 'weight_linear',
    'Key-Linear': 'key_linear', 'Key-Hadamard': 'key_hadamard',
    'Key-LayerNorm': 'key_layernorm', 'Key-Rope2D': 'key_rope2d',
  };

  function round(v) { return Math.round(v * 100) / 100; }

  function createRng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function pickWeighted(rand, items) {
    let c = rand() * items.reduce((a, i) => a + i.weight, 0);
    for (const item of items) { c -= item.weight; if (c <= 0) return item.value; }
    return items[items.length - 1].value;
  }

  function intRange(rand, min, max) { return min + Math.floor(rand() * (max - min + 1)); }
  function range(rand, min, max)    { return min + rand() * (max - min); }

  function durationForLabel(label, laneKind, rand) {
    const ranges = {
      fake: [0.7, 2.4], 'Prolog-Quant': laneKind === 'aiv' ? [8, 24] : [11, 32],
      'Query-Linear': laneKind === 'aiv' ? [1.8, 6.4] : [3.8, 10.5],
      'Query-Dequant': laneKind === 'aiv' ? [1.8, 8.8] : [3.2, 11.4],
      'Query-Hadamard': laneKind === 'aiv' ? [2.4, 7.8] : [3.4, 11.2],
      'Weight-Linear': laneKind === 'aiv' ? [2.2, 7.4] : [4.6, 13.2],
      'Key-Linear': laneKind === 'aiv' ? [2, 6.6] : [4.4, 12.4],
      'Key-Hadamard': laneKind === 'aiv' ? [1.8, 6.4] : [3.6, 10.6],
      'Key-LayerNorm': laneKind === 'aiv' ? [1.7, 6.2] : [2.6, 8.8],
      'Key-Rope2D': laneKind === 'aiv' ? [1.6, 5.8] : [2.8, 8.2],
    };
    const [min, max] = ranges[label] || [2.5, 7.5];
    return round(range(rand, min, max));
  }

  function gapForLane(laneKind, rand) {
    if (laneKind === 'fake') return round(range(rand, 1.8, 6.6));
    if (laneKind === 'aic')  return round(range(rand, 0.9, 4.6));
    return round(range(rand, 0.8, 3.4));
  }

  function clamp(ts, dur) { return Math.max(0, Math.min(SPAN - dur - 0.2, ts)); }

  function addThread(ev, tid, name) {
    ev.push({ name: 'thread_name', pid: PID, tid, args: { name } });
  }

  function addTask(ev, tid, ts, dur, label, name) {
    ev.push({ pid: PID, tid, cat: 'event', ph: 'X',
      ts: round(clamp(ts, dur)), dur: round(Math.max(0.5, dur)),
      name: `${name} (${label})` });
  }

  function createLaneEmitter(ev, tid, laneName, laneKind, seed) {
    const rand = createRng(seed);
    let seq = 0;
    return function emit(start, count, labels, opts = {}) {
      let cursor = start + range(rand, -1.2, 1.2);
      for (let i = 0; i < count; i++) {
        const label = pickWeighted(rand, labels);
        const dur = durationForLabel(label, laneKind, rand) * (opts.durationScale || 1);
        const ts  = clamp(cursor + range(rand, -0.8, 1.1), dur);
        const stem = labelStem[label] || label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        addTask(ev, tid, ts, dur, label,
          `${laneName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.${stem}_${String(seq++).padStart(3, '0')}`);
        cursor = ts + dur + gapForLane(laneKind, rand) * (opts.gapScale || 1);
        if (cursor >= SPAN - 0.5) break;
      }
    };
  }

  function buildFallbackTraceEvents() {
    const ev = [{ name: 'process_name', pid: PID, args: { name: PROCESS_NAME } }];
    const r0 = createRng(7001);

    addThread(ev, 0, 'Fake Core_0');
    const fake = createLaneEmitter(ev, 0, 'Fake Core_0', 'fake', 7001);
    fake(6, 18, fakeLabels); fake(90, 16, fakeLabels);
    fake(184, 18, fakeLabels); fake(286, 17, fakeLabels); fake(388, 16, fakeLabels);

    for (let lane = 1; lane <= 24; lane++) {
      const rng = createRng(1100 + lane);
      addThread(ev, lane, `AIC_${lane}`);
      const emit = createLaneEmitter(ev, lane, `AIC_${lane}`, 'aic', 2100 + lane);
      emit((lane % 6) * 1.8, intRange(rng, 30, 38), aicLabels, { gapScale: 0.6 });
    }

    for (let lane = 25; lane <= 72; lane++) {
      const rng = createRng(3100 + lane);
      addThread(ev, lane, `AIV_${lane}`);
      const emit = createLaneEmitter(ev, lane, `AIV_${lane}`, 'aiv', 4100 + lane);
      emit((lane % 8) * 3.2, intRange(rng, 3, 5), aivLabels, { gapScale: 3.2 });
      emit(160 + (lane % 5) * 6.1, intRange(rng, 2, 4), aivLabels, { gapScale: 3.6 });
      emit(330 + (lane % 6) * 5.4, intRange(rng, 2, 4), aivLabels, { gapScale: 3.0 });
    }
    return ev;
  }

  root.SWIMLANE_BUILTIN_SAMPLES = {
    // 离线 fallback：无需 HTTP server，自动生成的 Machine View 模拟数据
    defaultSample: {
      key: 'builtin-fallback',
      name: 'builtin-machine-view.json',
      data: { traceEvents: buildFallbackTraceEvents() },
    },
  };
})(swimlaneRoot);

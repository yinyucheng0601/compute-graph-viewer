const swimlaneRoot = typeof window !== 'undefined' ? window : globalThis;

(function registerBuiltinSwimlaneSamples(root) {
  const PID = 20260320;
  const SPAN = 474.0;  // AIV 延伸到 ~474μs，晚于 AIC ~457μs
  const PROCESS_NAME = 'Machine View';

  const labelStem = {
    fake: 'bookkeeping',
    'Prolog-Quant': 'prolog_quant',
    'Query-Linear': 'query_linear',
    'Query-Dequant': 'query_dequant',
    'Query-Hadamard': 'query_hadamard',
    'Weight-Linear': 'weight_linear',
    'Key-Linear': 'key_linear',
    'Key-Hadamard': 'key_hadamard',
    'Key-LayerNorm': 'key_layernorm',
    'Key-Rope2D': 'key_rope2d'
  };

  const fakeLabels = [
    { value: 'fake', weight: 0.7 },
    { value: 'Query-Dequant', weight: 0.1 },
    { value: 'Key-LayerNorm', weight: 0.08 },
    { value: 'Weight-Linear', weight: 0.07 },
    { value: 'Key-Rope2D', weight: 0.05 }
  ];

  // AIC 真实分布：Query-Linear 主力(~59%)，Query-Hadamard 次(~19%)，其余各~7%
  const aicLabels = [
    { value: 'Query-Linear',   weight: 0.59 },
    { value: 'Query-Hadamard', weight: 0.19 },
    { value: 'Key-Linear',     weight: 0.074 },
    { value: 'Weight-Linear',  weight: 0.074 },
    { value: 'Key-Hadamard',   weight: 0.072 }
  ];

  // AIV 真实分布：Prolog-Quant 主力(~65%)，Query-Dequant 次(~25%)
  const aivLabels = [
    { value: 'Prolog-Quant',  weight: 0.65 },
    { value: 'Query-Dequant', weight: 0.25 },
    { value: 'Key-LayerNorm', weight: 0.055 },
    { value: 'Weight-Linear', weight: 0.03 },
    { value: 'Key-Rope2D',    weight: 0.015 }
  ];

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function createRng(seed) {
    let current = seed >>> 0;
    return function next() {
      current = (current * 1664525 + 1013904223) >>> 0;
      return current / 4294967296;
    };
  }

  function pickWeighted(rand, items) {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let cursor = rand() * totalWeight;
    for (const item of items) {
      cursor -= item.weight;
      if (cursor <= 0) return item.value;
    }
    return items[items.length - 1].value;
  }

  function intRange(rand, min, max) {
    return min + Math.floor(rand() * (max - min + 1));
  }

  function range(rand, min, max) {
    return min + rand() * (max - min);
  }

  function durationForLabel(label, laneKind, rand) {
    const durationRanges = {
      fake: [0.7, 2.4],
      'Prolog-Quant': laneKind === 'aiv' ? [8, 24] : [11, 32],
      'Query-Linear': laneKind === 'aiv' ? [1.8, 6.4] : [3.8, 10.5],
      'Query-Dequant': laneKind === 'aiv' ? [1.8, 8.8] : [3.2, 11.4],
      'Query-Hadamard': laneKind === 'aiv' ? [2.4, 7.8] : [3.4, 11.2],
      'Weight-Linear': laneKind === 'aiv' ? [2.2, 7.4] : [4.6, 13.2],
      'Key-Linear': laneKind === 'aiv' ? [2, 6.6] : [4.4, 12.4],
      'Key-Hadamard': laneKind === 'aiv' ? [1.8, 6.4] : [3.6, 10.6],
      'Key-LayerNorm': laneKind === 'aiv' ? [1.7, 6.2] : [2.6, 8.8],
      'Key-Rope2D': laneKind === 'aiv' ? [1.6, 5.8] : [2.8, 8.2]
    };
    const [min, max] = durationRanges[label] || [2.5, 7.5];
    return round(range(rand, min, max));
  }

  function gapForLane(laneKind, rand) {
    if (laneKind === 'fake') return round(range(rand, 1.8, 6.6));
    if (laneKind === 'aic') return round(range(rand, 0.9, 4.6));
    return round(range(rand, 0.8, 3.4));
  }

  function makeTaskName(laneName, label, sequence) {
    const laneSlug = laneName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const stem = labelStem[label] || label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return `${laneSlug}.${stem}_${String(sequence).padStart(3, '0')}`;
  }

  function clampStart(ts, dur) {
    return Math.max(0, Math.min(SPAN - dur - 0.2, ts));
  }

  function addTask(traceEvents, tid, ts, dur, label, name) {
    traceEvents.push({
      pid: PID,
      tid,
      cat: 'event',
      ph: 'X',
      ts: round(clampStart(ts, dur)),
      dur: round(Math.max(0.5, dur)),
      name: `${name} (${label})`
    });
  }

  function addThread(traceEvents, tid, name) {
    traceEvents.push({
      name: 'thread_name',
      pid: PID,
      tid,
      args: { name }
    });
  }

  function createLaneEmitter(traceEvents, tid, laneName, laneKind, seed) {
    const rand = createRng(seed);
    let sequence = 0;

    return function emitCluster(start, count, labels, options = {}) {
      let cursor = start + range(rand, -1.2, 1.2);
      for (let index = 0; index < count; index += 1) {
        const label = pickWeighted(rand, labels);
        const dur = durationForLabel(label, laneKind, rand) * (options.durationScale || 1);
        const ts = clampStart(cursor + range(rand, -0.8, 1.1), dur);
        addTask(traceEvents, tid, ts, dur, label, makeTaskName(laneName, label, sequence));
        sequence += 1;
        cursor = ts + dur + gapForLane(laneKind, rand) * (options.gapScale || 1);
        if (cursor >= SPAN - 0.5) break;
      }
    };
  }

  function buildRichTraceEvents() {
    const traceEvents = [
      {
        name: 'process_name',
        pid: PID,
        args: { name: PROCESS_NAME }
      }
    ];

    addThread(traceEvents, 0, 'Fake Core_0');
    const fakeEmitter = createLaneEmitter(traceEvents, 0, 'Fake Core_0', 'fake', 7001);
    fakeEmitter(6, 18, fakeLabels);
    fakeEmitter(90, 16, fakeLabels);
    fakeEmitter(184, 18, fakeLabels);
    fakeEmitter(286, 17, fakeLabels);
    fakeEmitter(388, 16, fakeLabels);

    // AIC：从起点连续发射到 ~457μs，背靠背，小间隔，模拟真实密集形态
    for (let lane = 1; lane <= 24; lane += 1) {
      const laneName = `AIC_${lane}`;
      const laneRand = createRng(1100 + lane);
      addThread(traceEvents, lane, laneName);
      const emit = createLaneEmitter(traceEvents, lane, laneName, 'aic', 2100 + lane);
      const startOffset = (lane % 6) * 1.8;
      emit(startOffset, intRange(laneRand, 30, 38), aicLabels, { gapScale: 0.6 });
    }

    // AIV：稀疏散布，自然间隔大，整体跨度延伸到 ~474μs（晚于 AIC ~457μs）
    for (let lane = 25; lane <= 72; lane += 1) {
      const laneName = `AIV_${lane}`;
      const laneRand = createRng(3100 + lane);
      addThread(traceEvents, lane, laneName);
      const emit = createLaneEmitter(traceEvents, lane, laneName, 'aiv', 4100 + lane);
      const startOffset = (lane % 8) * 3.2;

      // 三段稀疏 cluster，间隔大，尾段延伸到 SPAN 以外 ~8μs
      emit(startOffset, intRange(laneRand, 3, 5), aivLabels, { gapScale: 3.2 });
      emit(160 + (lane % 5) * 6.1, intRange(laneRand, 2, 4), aivLabels, { gapScale: 3.6 });
      emit(330 + (lane % 6) * 5.4, intRange(laneRand, 2, 4), aivLabels, { gapScale: 3.0 });
    }

    return traceEvents;
  }

  root.SWIMLANE_BUILTIN_SAMPLES = {
    defaultSample: {
      key: 'samples/open-source-swim.json',
      name: 'builtin-rich-swimlane.json',
      data: {
        traceEvents: buildRichTraceEvents()
      }
    }
  };
})(swimlaneRoot);

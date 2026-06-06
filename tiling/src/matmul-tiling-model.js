(function registerMatmulTilingModel(global) {
  'use strict';

  const KB = 1024;
  const C0_SIZE = 16;
  const DTYPE_BYTES = { fp16: 2, bf16: 2, fp32: 4 };

  const CHIPS = {
    ascend950: {
      label: 'Ascend 950',
      note: '平台 API 运行时值，本页使用标称近似',
      L0A: 64 * KB,
      L0B: 64 * KB,
      L0C: 128 * KB,
      L1: { display: 512 * KB, compute: 512 * KB },
      UB: { display: 118 * KB, compute: 118 * KB },
      btSize: 0,
    },
    ascend910b: {
      label: 'Ascend 910B',
      note: 'fallback 常量：L1/UB 约束容量含 -256；L1 再扣 BT 1024B',
      L0A: 64 * KB,
      L0B: 64 * KB,
      L0C: 128 * KB,
      L1: { display: 512 * KB, compute: 512 * KB - 256 },
      UB: { display: 192 * KB, compute: 192 * KB - 256 },
      btSize: 1024,
    },
    ascend3113: {
      label: 'Ascend 3113',
      note: 'fallback 常量：L0A/L0B/L0C 更小，BT=0',
      L0A: 32 * KB,
      L0B: 32 * KB,
      L0C: 64 * KB,
      L1: { display: 512 * KB, compute: 512 * KB },
      UB: { display: 118 * KB, compute: 118 * KB },
      btSize: 0,
    },
  };

  const SAFE_SEEDS = {
    'decode-m1': {
      label: 'Decode M=1',
      short: 'M=1',
      why: '单 token decode，M 由 batch×seq 得到，实际 tile 按 16 对齐看尾块。',
      scenario: { presetId: 'decode-m1', chip: 'ascend910b', dtype: 'fp16', batch: 1, seq: 1, K: 4096, N: 4096, advancedMnk: false, overrideM: null, overrideN: null, overrideK: null },
      tiling: { usedCoreNum: 1, singleCoreM: 16, singleCoreN: 256, singleCoreK: 512, baseM: 16, baseN: 128, baseK: 64, dbL0A: 1, dbL0B: 1, dbL0C: 1, iterateOrder: 1 },
    },
    'decode-small': {
      label: 'Small Decode',
      short: '2-128',
      why: '小批 decode / speculative token，M 较小，主要观察 DB 余量与 core tile 数。',
      scenario: { presetId: 'decode-small', chip: 'ascend910b', dtype: 'fp16', batch: 4, seq: 16, K: 4096, N: 4096, advancedMnk: false, overrideM: null, overrideN: null, overrideK: null },
      tiling: { usedCoreNum: 4, singleCoreM: 64, singleCoreN: 256, singleCoreK: 512, baseM: 64, baseN: 128, baseK: 64, dbL0A: 1, dbL0B: 1, dbL0C: 1, iterateOrder: 1 },
    },
    prefill: {
      label: 'Prefill',
      short: '129+',
      why: '长序列 prefill，M/N tile 数多，适合看单核 slab 与 base tile 的嵌套关系。',
      scenario: { presetId: 'prefill', chip: 'ascend910b', dtype: 'fp16', batch: 1, seq: 2048, K: 4096, N: 4096, advancedMnk: false, overrideM: null, overrideN: null, overrideK: null },
      tiling: { usedCoreNum: 8, singleCoreM: 256, singleCoreN: 256, singleCoreK: 512, baseM: 128, baseN: 128, baseK: 64, dbL0A: 1, dbL0B: 1, dbL0C: 0, iterateOrder: 0 },
    },
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const ceil = (a, b) => Math.max(1, Math.ceil(Math.max(1, a) / Math.max(1, b)));
  const capL1 = (cap) => Math.max(1, cap.L1.compute - cap.btSize);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function positiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    return Math.round(clamp(numberOr(value, fallback), min, max));
  }

  function scenarioToMnk(scenario) {
    const advanced = !!scenario.advancedMnk;
    const batch = positiveInt(scenario.batch, 1, 1, 65536);
    const seq = positiveInt(scenario.seq, 1, 1, 1048576);
    const baseM = batch * seq;
    return {
      M: positiveInt(advanced ? scenario.overrideM : baseM, baseM, 1, 1048576),
      N: positiveInt(advanced ? scenario.overrideN : scenario.N, scenario.N || 4096, 1, 1048576),
      K: positiveInt(advanced ? scenario.overrideK : scenario.K, scenario.K || 4096, 1, 1048576),
    };
  }

  function composeTiling(scenario, tiling) {
    const mnk = scenarioToMnk(scenario);
    const chip = CHIPS[scenario.chip] ? scenario.chip : 'ascend910b';
    const dtype = DTYPE_BYTES[scenario.dtype] ? scenario.dtype : 'fp16';
    return {
      ...tiling,
      ...mnk,
      chip,
      dtype,
      defaultSource: tiling.defaultSource || 'safe-seed',
      usedCoreNum: positiveInt(tiling.usedCoreNum, 8, 1, 256),
      singleCoreM: positiveInt(tiling.singleCoreM, 256, 1, 1048576),
      singleCoreN: positiveInt(tiling.singleCoreN, 256, 1, 1048576),
      singleCoreK: positiveInt(tiling.singleCoreK, 512, 1, 1048576),
      baseM: positiveInt(tiling.baseM, 128, 1, 1048576),
      baseN: positiveInt(tiling.baseN, 128, 1, 1048576),
      baseK: positiveInt(tiling.baseK, 64, 1, 1048576),
      dbL0A: tiling.dbL0A ? 1 : 0,
      dbL0B: tiling.dbL0B ? 1 : 0,
      dbL0C: tiling.dbL0C ? 1 : 0,
      iterateOrder: Number(tiling.iterateOrder) === 1 ? 1 : 0,
    };
  }

  function analyzeBounds(t) {
    const notes = [];
    if (t.baseM > t.singleCoreM) notes.push({ field: 'baseM', level: 'warning', text: 'baseM 大于 singleCoreM，当前尾块会按 singleCoreM 限制展示。' });
    if (t.baseN > t.singleCoreN) notes.push({ field: 'baseN', level: 'warning', text: 'baseN 大于 singleCoreN，当前尾块会按 singleCoreN 限制展示。' });
    if (t.baseK > t.singleCoreK) notes.push({ field: 'baseK', level: 'warning', text: 'baseK 大于 singleCoreK，K loop 近似会被钳制。' });
    if (t.baseK > t.K) notes.push({ field: 'baseK', level: 'warning', text: 'baseK 大于全局 K，逻辑视图按一个 K tile 展示。' });
    if (t.singleCoreM > t.M) notes.push({ field: 'singleCoreM', level: 'info', text: 'singleCoreM 超过 M，表示尾块/补齐区；约束仍按 base tile 计算。' });
    if (t.singleCoreN > t.N) notes.push({ field: 'singleCoreN', level: 'info', text: 'singleCoreN 超过 N，表示尾块/补齐区；约束仍按 base tile 计算。' });
    if (t.singleCoreK > t.K) notes.push({ field: 'singleCoreK', level: 'info', text: 'singleCoreK 超过 K，K loop 按一个尾块展示。' });
    if (t.baseM % C0_SIZE !== 0) notes.push({ field: 'baseM', level: 'warning', text: 'baseM 不是 16 对齐，源码 C0 约束会标黄。' });
    if (t.baseN % C0_SIZE !== 0) notes.push({ field: 'baseN', level: 'warning', text: 'baseN 不是 16 对齐，源码 C0 约束会标黄。' });
    return notes;
  }

  function estimateL1(t, cap) {
    const eb = DTYPE_BYTES[t.dtype] || 2;
    const depthA = Math.min(4, ceil(t.singleCoreM, t.baseM));
    const depthB = Math.min(4, ceil(t.singleCoreN, t.baseN));
    const used = depthA * t.baseM * t.baseK * eb + depthB * t.baseK * t.baseN * eb;
    return {
      used,
      full: capL1(cap),
      detail: `A depth ${depthA} + B depth ${depthB}（近似）`,
    };
  }

  function packConstraint(x, label, note, dbOn, tone) {
    const ratio = x.used / x.full;
    const over = x.used > x.full;
    const dbEligible = 2 * x.used <= x.full;
    const dbWouldOver = !!dbOn && !over && !dbEligible;
    return {
      label,
      note,
      tone,
      used: x.used,
      full: x.full,
      ratio,
      over,
      dbEligible,
      dbWouldOver,
      state: over ? 'error' : dbWouldOver ? 'warning' : 'ok',
    };
  }

  function checkConstraints(t) {
    const cap = CHIPS[t.chip] || CHIPS.ascend910b;
    const eb = DTYPE_BYTES[t.dtype] || 2;
    const l0a = { used: t.baseM * t.baseK * eb, full: cap.L0A };
    const l0b = { used: t.baseK * t.baseN * eb, full: cap.L0B };
    const l0c = { used: t.baseM * t.baseN * 4, full: cap.L0C };
    const l1 = estimateL1(t, cap);
    const constraints = {
      L0A: packConstraint(l0a, 'L0A', 'baseM×baseK', t.dbL0A, 'input'),
      L0B: packConstraint(l0b, 'L0B', 'baseK×baseN', t.dbL0B, 'input'),
      L0C: packConstraint(l0c, 'L0C', 'baseM×baseN ×4B(恒FP32)', t.dbL0C, 'accumulator'),
      L1: packConstraint(l1, 'L1', `A/B 暂存 · ${l1.detail}`, false, 'input'),
      align: {
        baseM: t.baseM % C0_SIZE === 0,
        baseN: t.baseN % C0_SIZE === 0,
      },
      cap,
      notes: analyzeBounds(t),
    };
    constraints.legal = ['L0A', 'L0B', 'L0C', 'L1'].every((key) => !constraints[key].over)
      && constraints.align.baseM
      && constraints.align.baseN;
    constraints.hasDbWarning = ['L0A', 'L0B', 'L0C'].some((key) => constraints[key].dbWouldOver);
    return constraints;
  }

  function deriveTiling(t) {
    const mIter = ceil(t.M, t.singleCoreM);
    const nIter = ceil(t.N, t.singleCoreN);
    const baseMLoop = ceil(Math.min(t.singleCoreM, Math.max(t.baseM, t.M)), t.baseM);
    const baseNLoop = ceil(Math.min(t.singleCoreN, Math.max(t.baseN, t.N)), t.baseN);
    const kLoop = ceil(t.K, t.baseK);
    return {
      mIter,
      nIter,
      coreTiles: mIter * nIter,
      baseMLoop,
      baseNLoop,
      kLoop,
      logicalTilesM: ceil(t.M, t.baseM),
      logicalTilesN: ceil(t.N, t.baseN),
      activeCoreCount: Math.min(t.usedCoreNum, mIter * nIter),
      coreMismatch: t.usedCoreNum !== mIter * nIter,
    };
  }

  function iterateOrderCost(t, d) {
    const mFirst = Number(t.iterateOrder) === 0;
    const wideN = d.nIter >= d.mIter;
    const preferred = wideN ? 1 : 0;
    const matches = Number(t.iterateOrder) === preferred;
    const penalty = matches ? 0 : Math.min(0.18, Math.abs(d.nIter - d.mIter) / Math.max(1, d.nIter + d.mIter) * 0.28);
    return {
      iterateLabel: mFirst ? 'M-first' : 'N-first',
      iteratePreferred: preferred === 0 ? 'M-first' : 'N-first',
      iteratePenalty: penalty,
      iterateMatches: matches,
    };
  }

  function scorePerf(t, constraints, derived) {
    const eb = DTYPE_BYTES[t.dtype] || 2;
    const memTraffic = t.baseM * t.baseK * eb + t.baseK * t.baseN * eb;
    const computeWork = t.baseM * t.baseN * t.baseK;
    const intensity = computeWork / Math.max(1, memTraffic);
    const dbReady = t.dbL0A && t.dbL0B && !constraints.L0A.dbWouldOver && !constraints.L0B.dbWouldOver;
    const dbGain = dbReady ? Math.min(0.22, 0.06 + Math.log2(Math.max(2, derived.kLoop)) * 0.025) : 0;
    const iter = iterateOrderCost(t, derived);
    const raw = intensity * (1 + dbGain - iter.iteratePenalty);
    const level = constraints.legal && raw >= 48 ? 'good' : constraints.legal && raw >= 24 ? 'warn' : 'bad';
    return {
      memTraffic,
      computeWork,
      intensity,
      dbGain,
      raw,
      level,
      ...iter,
    };
  }

  function createInitialState(presetId = 'prefill') {
    const preset = SAFE_SEEDS[presetId] || SAFE_SEEDS.prefill;
    return {
      scenario: clone(preset.scenario),
      tilingSeed: {
        ...clone(preset.tiling),
        defaultSource: 'safe-seed',
      },
    };
  }

  function evaluate(scenario, tilingSeed) {
    const tiling = composeTiling(scenario, tilingSeed);
    const constraints = checkConstraints(tiling);
    const derived = deriveTiling(tiling);
    const perf = scorePerf(tiling, constraints, derived);
    return { tiling, constraints, derived, perf };
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value % (1024 * 1024) ? 2 : 0)}MB`;
    return `${(value / 1024).toFixed(value % 1024 ? 1 : 0)}KB`;
  }

  global.MatmulTilingModel = {
    KB,
    C0_SIZE,
    DTYPE_BYTES,
    CHIPS,
    SAFE_SEEDS,
    capL1,
    clone,
    createInitialState,
    evaluate,
    formatBytes,
    scenarioToMnk,
  };
})(window);

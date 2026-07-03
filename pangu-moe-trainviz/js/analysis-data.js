const clamp01 = value => Math.max(0, Math.min(1, value));

function hash01(a, b = 0, c = 0, d = 0) {
  let h = ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791) ^ (d * 2654435761)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  return h / 4294967295;
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx];
}

function summarize(values) {
  const max = values.length ? Math.max(...values) : 0;
  const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return { max, avg, p95: quantile(values, 0.95) };
}

export function buildMoeRuntimeMetrics({
  firstMoeLayer = 4,
  lastMoeLayer = 49,
  expertsPerLayer = 80,
  capacityTokens = 192,
  step = 0,
  collapse = 0,   // 0=均衡；1=路由坍缩（少数专家吃光 token，其余空转）—— 由 load_balance_loss 驱动
} = {}) {
  const layers = [];
  const loadRatio = [];
  const assignedTokens = [];
  const acceptedTokens = [];
  const droppedTokens = [];
  const reroutedTokens = [];
  const routerProbMass = [];
  const allToAllSendTokens = [];
  const allToAllRecvTokens = [];
  const layerCount = Math.max(0, lastMoeLayer - firstMoeLayer + 1);

  for (let row = 0; row < layerCount; row++) {
    const layer = firstMoeLayer + row;
    const layerPhase = Math.sin((layer + step * 0.7) * 0.31) * 0.12;
    const rowLoads = [];
    let overloaded = 0;
    let idle = 0;
    let dropped = 0;
    let assigned = 0;
    let send = 0;
    let recv = 0;

    for (let expertId = 0; expertId < expertsPerLayer; expertId++) {
      const index = row * expertsPerLayer + expertId;
      const laneHotspot = expertId % 64 === (layer * 7 + step) % 64 ? 0.48 : 0;
      const groupHotspot = Math.floor(expertId / 32) === (layer + step) % 8 ? 0.20 : 0;
      const noise = (hash01(layer, expertId, step, 17) - 0.5) * 0.34;
      const wave = Math.sin((expertId * 0.23) + (layer * 0.41) + step) * 0.11;
      let ratio = Math.max(0, 0.64 + layerPhase + wave + noise + laneHotspot + groupHotspot);
      if (collapse > 0) {                                  // 坍缩：少数赢家专家暴增，其余被抽干
        const winner = (expertId % 41) === ((layer * 13 + 7) % 41);
        ratio = winner ? ratio + collapse * 3.0 : ratio * (1 - collapse * 0.85);
      }
      const tokens = Math.round(capacityTokens * ratio);
      const accepted = Math.min(tokens, capacityTokens);
      const droppedNow = Math.max(0, tokens - capacityTokens);
      const rerouted = Math.round(droppedNow * (0.45 + hash01(layer, expertId, step, 31) * 0.4));
      const probMass = clamp01(0.52 + ratio * 0.28 + (hash01(layer, expertId, step, 43) - 0.5) * 0.16);
      const sendTokens = Math.round(tokens * (0.72 + hash01(layer, expertId, step, 59) * 0.42));
      const recvTokens = Math.round(tokens * (0.70 + hash01(layer, expertId, step, 71) * 0.46));

      loadRatio[index] = ratio;
      assignedTokens[index] = tokens;
      acceptedTokens[index] = accepted;
      droppedTokens[index] = droppedNow;
      reroutedTokens[index] = rerouted;
      routerProbMass[index] = probMass;
      allToAllSendTokens[index] = sendTokens;
      allToAllRecvTokens[index] = recvTokens;

      rowLoads.push(ratio);
      assigned += tokens;
      dropped += droppedNow;
      send += sendTokens;
      recv += recvTokens;
      if (ratio > 1) overloaded++;
      if (tokens < capacityTokens * 0.08) idle++;
    }

    const loadSummary = summarize(rowLoads);
    layers.push({
      layer,
      row,
      expertCount: expertsPerLayer,
      assignedTokens: assigned,
      droppedTokens: dropped,
      overloadedExperts: overloaded,
      idleExperts: idle,
      maxLoadRatio: loadSummary.max,
      avgLoadRatio: loadSummary.avg,
      p95LoadRatio: loadSummary.p95,
      allToAllSendTokens: send,
      allToAllRecvTokens: recv,
      allToAllSkew: send && recv ? Math.max(send, recv) / Math.max(1, Math.min(send, recv)) : 1,
    });
  }

  return {
    schema: 'pangu.moe-runtime-metrics.mock.v1',
    step,
    firstMoeLayer,
    lastMoeLayer,
    layerCount,
    expertsPerLayer,
    capacityTokens,
    layers,
    arrays: {
      loadRatio,
      assignedTokens,
      acceptedTokens,
      droppedTokens,
      reroutedTokens,
      routerProbMass,
      allToAllSendTokens,
      allToAllRecvTokens,
    },
  };
}

export function buildMoeLoadViewModel(metrics) {
  const ratios = metrics.arrays.loadRatio;
  const summary = summarize(ratios);
  const overloaded = ratios.reduce((sum, value) => sum + (value > 1 ? 1 : 0), 0);
  const idle = metrics.arrays.assignedTokens.reduce((sum, value) => sum + (value < metrics.capacityTokens * 0.08 ? 1 : 0), 0);
  const dropped = metrics.arrays.droppedTokens.reduce((sum, value) => sum + value, 0);
  const worstLayer = metrics.layers.reduce((best, layer) => !best || layer.maxLoadRatio > best.maxLoadRatio ? layer : best, null);
  return {
    id: 'moe-load',
    title: 'MoE Load',
    meta: `L${metrics.firstMoeLayer}-L${metrics.lastMoeLayer} · ${metrics.layerCount} layers × ${metrics.expertsPerLayer} experts`,
    metrics,
    metricOptions: [
      { id: 'loadRatio', label: 'Load', array: metrics.arrays.loadRatio, unit: '× capacity' },
      { id: 'droppedTokens', label: 'Dropped', array: metrics.arrays.droppedTokens, unit: 'tokens' },
      { id: 'reroutedTokens', label: 'Reroute', array: metrics.arrays.reroutedTokens, unit: 'tokens' },
      { id: 'allToAllSendTokens', label: 'A2A send', array: metrics.arrays.allToAllSendTokens, unit: 'tokens' },
    ],
    stats: [
      { label: 'max load', value: `${summary.max.toFixed(2)}x` },
      { label: 'p95 load', value: `${summary.p95.toFixed(2)}x` },
      { label: 'overloaded', value: `${overloaded}` },
      { label: 'idle', value: `${idle}` },
      { label: 'dropped', value: `${dropped}` },
      { label: 'worst layer', value: worstLayer ? `L${worstLayer.layer}` : '-' },
    ],
  };
}

export function buildRankLoadViewModel(timelineRuntime) {
  const ranks = (timelineRuntime?.ranks || []).map(rank => {
    let computeUs = 0;
    let commUs = 0;
    let bubbleUs = 0;
    for (const task of rank.tasks || []) {
      if (task.kind === 'F' || task.kind === 'B') computeUs += task.durUs || 0;
      else if (task.kind === 'bubble') bubbleUs += task.durUs || 0;
      else commUs += task.durUs || 0;
    }
    const totalUs = Math.max(1, timelineRuntime?.timeRangeUs?.[1] || computeUs + commUs + bubbleUs);
    return {
      rank: rank.rank,
      dp: rank.dp,
      stage: rank.stage,
      tp: rank.tp,
      ep: rank.ep ?? 0,
      group: rank.group,
      computeUs,
      commUs,
      bubbleUs,
      utilRatio: computeUs / totalUs,
      commRatio: commUs / totalUs,
      bubbleRatio: bubbleUs / totalUs,
      totalUs,
    };
  });
  const utils = ranks.map(r => r.utilRatio);
  const comms = ranks.map(r => r.commRatio);
  const worst = ranks.reduce((best, rank) => !best || rank.bubbleRatio > best.bubbleRatio ? rank : best, null);
  return {
    id: 'rank-load',
    title: 'Rank Load',
    meta: `${ranks.length} ranks · compute / comm / bubble`,
    ranks,
    stats: [
      { label: 'avg util', value: `${Math.round((summarize(utils).avg || 0) * 100)}%` },
      { label: 'max util', value: `${Math.round((summarize(utils).max || 0) * 100)}%` },
      { label: 'avg comm', value: `${Math.round((summarize(comms).avg || 0) * 100)}%` },
      { label: 'worst wait', value: worst ? `R${worst.rank}` : '-' },
    ],
  };
}

// 每 step 一份卡占用快照：collapse(0..1) 来自 load_balance_loss，>0 时令牌路由坍缩 →
// 每个 DP·PP 组里令牌堆到 TP1（winner，util→97%、comm→60%），其余卡饥饿（util→12%）。
export function buildCardLoadViewModel(rankViewModel, collapse = 0) {
  const c = clamp01(collapse);
  const cards = (rankViewModel?.ranks || []).map(rank => {
    let util = rank.utilRatio;
    let comm = rank.commRatio;
    if (c > 0) {
      const winner = (rank.ep ?? rank.tp) === 1;
      util += ((winner ? 0.97 : 0.12) - util) * c;
      comm += ((winner ? 0.60 : 0.44) - comm) * c;
    }
    util = clamp01(util);
    comm = clamp01(comm);
    return {
      cardId: rank.rank,
      label: `Card ${rank.rank}`,
      dp: rank.dp,
      stage: rank.stage,
      tp: rank.tp,
      ep: rank.ep ?? 0,
      utilRatio: util,
      commRatio: comm,
      bubbleRatio: rank.bubbleRatio,
      pressure: util,
      state: util < 0.30 ? 'alert' : (util > 0.95 || comm > 0.5) ? 'warn' : 'ok',
    };
  });
  // 组排序：先 DP·PP 组，组内按 TP→EP；DP2×PP4×TP2×EP2 会自然铺成 8 组×4 卡。
  cards.sort((a, b) => (a.dp - b.dp) || (a.stage - b.stage) || (a.tp - b.tp) || (a.ep - b.ep));
  const tpCount = Math.max(1, ...cards.map(card => card.tp + 1));
  const epCount = Math.max(1, ...cards.map(card => card.ep + 1));
  const avgUtil = summarize(cards.map(card => card.utilRatio)).avg || 0;
  const starved = cards.filter(card => card.state === 'alert').length;
  const hot = cards.filter(card => card.state === 'warn').length;
  return {
    id: 'card-load',
    title: 'Card Load',
    meta: `${cards.length} cards · local ${tpCount}TP×${epCount}EP · 每 step 占用`,
    cards,
    tpCount,
    epCount,
    stats: [
      { label: 'cards', value: `${cards.length}` },
      { label: 'avg util', value: `${Math.round(avgUtil * 100)}%` },
      { label: 'starved', value: `${starved}` },
      { label: 'hot', value: `${hot}` },
    ],
  };
}

// ===== Layer Scan：逐层 × 逐 step 指标（可切换）——单跑自身信号，非双跑 diff =====
// 同一「层深 × 时间」轴可承载多种量。这里做成 4 个可切换通道：
//   梯度/负载 = 异常型（色=偏离健康基线；首超标/峰值有意义；算子占比=对异常的贡献）
//   耗时/显存 = 成本型（色=绝对成本；算子占比=计算/资源占用，火焰图式）
// 都自洽于 timeseries.js 的故障链：faultStep 起，faultLayer（Router 所在 MoE 层）为中心，
// 沿层深向下游累积，collapseStep 后在故障带饱和/变贵。
const LAYER_SCAN_OP_META = {
  mla: { label: 'MLA', sem: 'sem:attention' },
  moe_prenorm: { label: 'Pre-RMSNorm', sem: 'sem:norm' },
  gate: { label: 'Router', sem: 'sem:gate' },
  a2a_dispatch: { label: 'A2A dispatch', sem: 'sem:comm' },
  experts: { label: 'Experts', sem: 'sem:moe' },
  a2a_combine: { label: 'A2A combine', sem: 'sem:comm' },
  moe_residual: { label: 'Post-RMSNorm', sem: 'sem:norm' },
  dense: { label: 'Dense FFN', sem: 'module:decoder' },
  norm: { label: 'RMSNorm', sem: 'sem:norm' },
};
// 算子权重档：贡献型（bug 在 Router）/ 耗时型（Experts+MLA 最贵）/ 显存型（Experts+MLA 占用大）
const LAYER_SCAN_PROFILE = {
  contrib: {
    moe: { gate: 0.30, experts: 0.24, a2a_dispatch: 0.14, a2a_combine: 0.14, mla: 0.07, moe_prenorm: 0.05, moe_residual: 0.06 },
    dense: { dense: 0.50, mla: 0.34, norm: 0.16 },
  },
  time: {
    moe: { experts: 0.42, mla: 0.20, a2a_dispatch: 0.10, a2a_combine: 0.10, moe_residual: 0.07, moe_prenorm: 0.06, gate: 0.05 },
    dense: { dense: 0.58, mla: 0.30, norm: 0.12 },
  },
  mem: {
    moe: { experts: 0.38, mla: 0.28, a2a_dispatch: 0.08, a2a_combine: 0.08, moe_prenorm: 0.07, moe_residual: 0.06, gate: 0.05 },
    dense: { dense: 0.50, mla: 0.34, norm: 0.16 },
  },
};

export function buildLayerScanMetrics({
  steps,
  faultStep,
  collapseStep,
  totalLayers = 61,
  firstMoeLayer = 3,
  lastMoeLayer = 60,
  faultLayer = 47,
} = {}) {
  const stepCount = steps.length;
  const lastStep = steps[stepCount - 1];
  const layers = [];
  for (let layer = 0; layer < totalLayers; layer++) {
    const isMoe = layer >= firstMoeLayer && layer <= lastMoeLayer;
    layers.push({ layer, isMoe, isDense: !isMoe });
  }
  const isMoeL = layer => layer >= firstMoeLayer && layer <= lastMoeLayer;
  const gauss = (x, mu, sigma) => Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
  const originF = layer => gauss(layer, faultLayer, 3.2);
  const downF = layer => layer > faultLayer ? clamp01((layer - faultLayer) / Math.max(1, lastMoeLayer - faultLayer)) : 0;
  const rampF = s => s >= faultStep ? clamp01((s - faultStep) / Math.max(1, collapseStep - faultStep)) : 0;
  const postF = s => s >= collapseStep ? clamp01((s - collapseStep) / Math.max(1, lastStep - collapseStep)) : 0;
  // 共享异常骨架 0..1（MoE 为主；故障层为中心 + 向下游累积 + 沿时间爬升/饱和）
  const anomF = (layer, s) => {
    if (!isMoeL(layer)) return 0;
    const r = rampF(s), p = postF(s), o = originF(layer), d = downF(layer);
    const nz = (hash01(layer, s, 23) - 0.5) * 0.06;
    return clamp01(r * (0.50 * o + 0.28 * d) + p * (0.42 * o + 0.50 * d + 0.08) + (r + p) * nz);
  };

  // 各通道的物理量取值（raw），归一化到 [lo,hi] 用于上色
  const CHANNEL_SPECS = [
    {
      id: 'grad', label: '梯度', unit: 'grad norm', kind: 'anomaly', digits: 1,
      lo: 0.8, hi: 8, warnRaw: 2.5, profile: 'contrib', markerLabel: '首问题层',
      opLabel: '算子分解 · 占该层梯度异常',
      desc: '逐层梯度范数；健康≈1，故障层及下游随 step 爆炸（与 grad_norm 发散一致）。占比=各算子对梯度异常的贡献。',
      rawFn: (layer, s) => 0.9 + (hash01(layer, s, 7) - 0.5) * 0.15 + anomF(layer, s) * 7.0,
    },
    {
      id: 'load', label: '负载', unit: '×cap', kind: 'anomaly', digits: 2,
      lo: 0.6, hi: 3.0, warnRaw: 1.3, profile: 'contrib', markerLabel: '首问题层',
      opLabel: '算子分解 · 占该层负载偏移',
      desc: 'MoE 逐层专家负载（×capacity）；Dense 无专家故为空。坍缩后热点专家过载、token 溢出。占比=各算子对负载偏移的贡献。',
      rawFn: (layer, s) => isMoeL(layer) ? 0.72 + (hash01(layer, s, 11) - 0.5) * 0.12 + anomF(layer, s) * 2.3 : 0,
    },
    {
      id: 'time', label: '耗时', unit: 'µs', kind: 'cost', digits: 0,
      lo: 500, hi: 1700, warnRaw: 1300, profile: 'time', markerLabel: '最耗时层',
      opLabel: '算子分解 · 占该层耗时',
      desc: '逐层前反向耗时；MoE 结构性更贵，坍缩后热点层因负载不均/A2A 等待更慢。占比=计算耗时（火焰图式）。',
      rawFn: (layer, s) => {
        const structural = isMoeL(layer) ? 1080 : 600;
        const slow = isMoeL(layer) ? postF(s) * (0.15 + 0.55 * originF(layer)) * structural : 0;
        return structural * (1 + (hash01(layer, s, 13) - 0.5) * 0.06) + slow;
      },
    },
    {
      id: 'mem', label: '显存', unit: 'GB', kind: 'cost', digits: 1,
      lo: 1.5, hi: 3.6, warnRaw: 3.1, profile: 'mem', markerLabel: '显存峰值层',
      opLabel: '算子分解 · 占该层显存',
      desc: '逐层激活显存峰值；MoE（激活+专家权重）更高，坍缩后 rerouted buffer / 碎片略升。占比=显存占用（结构性）。',
      rawFn: (layer, s) => {
        const structural = isMoeL(layer) ? 2.6 : 2.0;
        const bump = isMoeL(layer) ? postF(s) * originF(layer) * 0.7 : 0;
        return structural * (1 + (hash01(layer, s, 29) - 0.5) * 0.04) + bump;
      },
    },
  ];

  function buildChannel(spec) {
    const scores = new Float32Array(totalLayers * stepCount);
    const raw = new Float32Array(totalLayers * stepCount);
    const span = Math.max(1e-6, spec.hi - spec.lo);
    const warnThreshold = clamp01((spec.warnRaw - spec.lo) / span);
    let maxRaw = -Infinity;
    for (let layer = 0; layer < totalLayers; layer++) {
      for (let si = 0; si < stepCount; si++) {
        const v = spec.rawFn(layer, steps[si]);
        raw[layer * stepCount + si] = v;
        scores[layer * stepCount + si] = clamp01((v - spec.lo) / span);
        if (v > maxRaw) maxRaw = v;
      }
    }
    const perLayer = layers.map(({ layer, isMoe }) => {
      let firstDivergeStep = null, peak = 0, peakStep = steps[0], peakRaw = raw[layer * stepCount];
      for (let si = 0; si < stepCount; si++) {
        const nv = scores[layer * stepCount + si];
        if (firstDivergeStep == null && nv >= warnThreshold) firstDivergeStep = steps[si];
        if (nv > peak) { peak = nv; peakStep = steps[si]; peakRaw = raw[layer * stepCount + si]; }
      }
      return { layer, isMoe, firstDivergeStep, peak, peakStep, peakRaw };
    });
    const diverged = perLayer.filter(l => l.firstDivergeStep != null);
    const epicenter = diverged.length
      ? diverged.reduce((b, l) => (l.firstDivergeStep < b.firstDivergeStep
          || (l.firstDivergeStep === b.firstDivergeStep && l.peak > b.peak)) ? l : b)
      : perLayer.reduce((b, l) => l.peak > b.peak ? l : b, perLayer[0]);
    const peakLayer = perLayer.reduce((b, l) => l.peak > b.peak ? l : b, perLayer[0]);
    const marker = spec.kind === 'anomaly'
      ? { layer: epicenter.layer, step: epicenter.firstDivergeStep ?? epicenter.peakStep }
      : { layer: peakLayer.layer, step: peakLayer.peakStep };
    const scoreAt = (layer, step) => {
      const si = steps.indexOf(step);
      return si < 0 || layer < 0 || layer >= totalLayers ? 0 : scores[layer * stepCount + si];
    };
    const rawAt = (layer, step) => {
      const si = steps.indexOf(step);
      return si < 0 || layer < 0 || layer >= totalLayers ? 0 : raw[layer * stepCount + si];
    };
    const wmapOf = layer => LAYER_SCAN_PROFILE[spec.profile][isMoeL(layer) ? 'moe' : 'dense'];
    // share = 占该层该指标的比例（条长）；score = 强度 0..1（颜色，主导算子≈该层归一分）
    const ops = (layer, step) => {
      const nv = scoreAt(layer, step);
      const entries = Object.entries(wmapOf(layer)).map(([op, w]) => ({ op, w: w * (0.85 + hash01(layer, step, op.length * 7) * 0.30) }));
      const sum = entries.reduce((a, d) => a + d.w, 0) || 1;
      const maxW = entries.reduce((m, d) => Math.max(m, d.w), 0) || 1;
      return entries.map(d => ({
        op: d.op, label: LAYER_SCAN_OP_META[d.op].label, sem: LAYER_SCAN_OP_META[d.op].sem,
        share: d.w / sum, score: clamp01(nv * (d.w / maxW)),
      }));
    };
    const domOp = Object.entries(LAYER_SCAN_PROFILE[spec.profile].moe).reduce((b, e) => e[1] > b[1] ? e : b)[0];
    // 阈值文本：>标准值（含紧凑单位，如 >2.5 / >1.30× / >1300µs / >3.1GB）
    const su = spec.unit === 'grad norm' ? '' : spec.unit === '×cap' ? '×' : spec.unit;
    const warnText = `>${spec.warnRaw.toFixed(spec.digits)}${su}`;
    const stats = spec.kind === 'anomaly' ? [
      { label: spec.markerLabel, value: `L${epicenter.layer}` },
      { label: `首超标（${warnText}）`, value: epicenter.firstDivergeStep != null ? `step ${epicenter.firstDivergeStep}` : '—' },
      { label: '峰值', value: `${maxRaw.toFixed(spec.digits)} ${spec.unit}` },
      { label: '超标层数', value: `${diverged.length}` },
      { label: '主导算子', value: LAYER_SCAN_OP_META[domOp].label },
      { label: 'MoE 层', value: `L${firstMoeLayer}-L${lastMoeLayer}` },
    ] : [
      { label: spec.markerLabel, value: `L${peakLayer.layer}` },
      { label: '峰值', value: `${maxRaw.toFixed(spec.digits)} ${spec.unit}` },
      { label: `首超阈（${warnText}）`, value: epicenter.firstDivergeStep != null ? `step ${epicenter.firstDivergeStep}` : '—' },
      { label: '超阈层数', value: `${diverged.length}` },
      { label: '主导算子', value: LAYER_SCAN_OP_META[domOp].label },
      { label: 'MoE 层', value: `L${firstMoeLayer}-L${lastMoeLayer}` },
    ];
    return {
      id: spec.id, label: spec.label, unit: spec.unit, kind: spec.kind, digits: spec.digits,
      scores, raw, warnThreshold, warnText, perLayer, epicenter, peakLayer, marker, maxRaw, markerLabel: spec.markerLabel,
      scoreAt, rawAt, ops, opLabel: spec.opLabel, desc: spec.desc, stats,
    };
  }

  const channels = {};
  const channelOrder = CHANNEL_SPECS.map(s => s.id);
  CHANNEL_SPECS.forEach(s => { channels[s.id] = buildChannel(s); });

  return {
    schema: 'pangu.layer-scan.mock.v2',
    steps, stepCount, totalLayers, firstMoeLayer, lastMoeLayer, faultStep, collapseStep, faultLayer,
    layers, channels, channelOrder, defaultChannel: 'grad',
    title: 'Layer Scan',
    meta: `L0-L${lastMoeLayer} × ${stepCount} steps · 指标可切换`,
  };
}

function compDuration(stage, type, microbatch, forwardBaseUs, backwardBaseUs) {
  const base = type === 'F' ? forwardBaseUs : backwardBaseUs;
  const stageWeight = stage === 0 ? 0.9 : 1.08;
  const microbatchWeight = 0.74 + hash01(stage, type === 'F' ? 1 : 2, microbatch) * 0.62;
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
    for (let k = 0; k < warmupCount; k++) ops.push({ type: 'F', microbatch: fMicro++ });
    for (let k = 0; k < steadyCount; k++) {
      ops.push({ type: 'F', microbatch: fMicro++ });
      ops.push({ type: 'B', microbatch: bMicro++ });
    }
    while (bMicro < microbatches) ops.push({ type: 'B', microbatch: bMicro++ });
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
      if (op.type === 'F') {
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
      (op.type === 'F' ? compF : compB)[stage][op.microbatch] = rec;
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

export function buildSimulated1F1BRuntime({
  dp = 2,
  pp = 4,
  tp = 2,
  ep = 2,
  microbatches = 8,
  forwardBaseUs = 420,
  backwardBaseUs = 780,
  ppCommUs = 72,
  tpCommUs = 58,
  epCommUs = 96,
  dpCommUs = 64,
  stageRanges = [[0, 12], [13, 25], [26, 37], [38, 49]],
} = {}) {
  const { compF, compB, stageOps, totalUs } = simulate1F1BSchedule(pp, microbatches, forwardBaseUs, backwardBaseUs, ppCommUs);
  const ranks = [];
  for (let dpIndex = 0; dpIndex < dp; dpIndex++) {
    for (let stage = 0; stage < pp; stage++) {
      for (let tpIndex = 0; tpIndex < tp; tpIndex++) {
        for (let epIndex = 0; epIndex < ep; epIndex++) {
          const rank = (((dpIndex * pp + stage) * tp + tpIndex) * ep) + epIndex;
          const jitter = offset => (((rank * 131 + offset * 977) % 100) / 100 - 0.5);
          const rankKey = variant => `rank:r${rank}:v${variant % 7}`;
          const range = stageRanges[stage] || stageRanges[stageRanges.length - 1] || [0, 0];
          const tasks = [];

        const emit = (rec, type, microbatch) => {
          if (!rec) return;
          const start = rec.start;
          const dur = rec.end - rec.start;
          const straggler = hash01(rank, type === 'F' ? 91 : 97, microbatch) > 0.82 ? 0.06 : 0;
          const load = Math.min(1, 0.70 + hash01(rank, type === 'F' ? 11 : 17, microbatch) * 0.26 + straggler);
          const visualDur = dur * load;
          tasks.push({
            startUs: start,
            durUs: visualDur,
            slotStartUs: start,
            slotDurUs: dur,
            rankLoad: load,
            kind: type,
            microbatch,
            status: 'ok',
            label: `${type} m${microbatch}`,
            opName: `${type === 'F' ? 'Forward' : 'Backward'} · micro ${microbatch} · L${range[0]}-L${range[1]} · 填充 ${(load * 100) | 0}%`,
          });
          tasks.push({
            startUs: start + dur * 0.58,
            durUs: tpCommUs * (0.72 + jitter(5) * 0.5),
            kind: 'tp',
            colorKey: 'sem:attention',
            rankColorKey: rankKey(5),
            microbatch,
            status: 'overlap',
            label: 'AR',
            opName: `TP All-Reduce · ${tp}-rank TP group · micro ${microbatch}`,
          });
          tasks.push({
            startUs: start + dur * 0.26,
            durUs: epCommUs * (0.7 + jitter(6) * 0.6),
            kind: 'ep',
            colorKey: 'sem:comm',
            rankColorKey: rankKey(6),
            microbatch,
            status: 'overlap',
            label: 'A2A',
            opName: `EP All-to-All · ${ep}-rank expert group · token dispatch/combine · micro ${microbatch}`,
          });
        };

        for (let microbatch = 0; microbatch < microbatches; microbatch++) {
          emit(compF[stage][microbatch], 'F', microbatch);
          emit(compB[stage][microbatch], 'B', microbatch);
        }
        for (let microbatch = 0; microbatch < microbatches; microbatch++) {
          const pushPp = (at, label) => tasks.push({
            startUs: Math.max(0, at),
            durUs: ppCommUs * 0.8,
            kind: 'pp',
            colorKey: 'sem:mlp',
            rankColorKey: rankKey(4),
            microbatch,
            status: 'ok',
            label: 'PP',
            opName: label,
          });
          if (stage > 0 && compF[stage][microbatch]) pushPp(compF[stage][microbatch].start - ppCommUs * 0.8, `PP recv activation ← PP${stage - 1} · micro ${microbatch}`);
          if (stage < pp - 1 && compF[stage][microbatch]) pushPp(compF[stage][microbatch].end, `PP send activation → PP${stage + 1} · micro ${microbatch}`);
          if (stage < pp - 1 && compB[stage][microbatch]) pushPp(compB[stage][microbatch].start - ppCommUs * 0.8, `PP recv gradient ← PP${stage + 1} · micro ${microbatch}`);
          if (stage > 0 && compB[stage][microbatch]) pushPp(compB[stage][microbatch].end, `PP send gradient → PP${stage - 1} · micro ${microbatch}`);
          if (compB[stage][microbatch]) {
            tasks.push({
              startUs: compB[stage][microbatch].end - dpCommUs * 0.38,
              durUs: dpCommUs * (0.78 + jitter(8) * 0.42),
              kind: 'dp',
              colorKey: 'sem:head',
              rankColorKey: rankKey(2),
              microbatch,
              status: 'overlap',
              label: 'DP',
              opName: `DP gradient sync · D0/D1 replica group · PP${stage} TP${tpIndex} EP${epIndex} · micro ${microbatch}`,
            });
          }
        }

        const ops = stageOps[stage];
        const bubbleThreshold = ppCommUs * 0.9;
        let prev = 0;
        ops.forEach(op => {
          if (op.start - prev > bubbleThreshold) {
            tasks.push({
              startUs: prev,
              durUs: op.start - prev,
              kind: 'bubble',
              status: 'wait',
              colorKey: 'pipeline:bubble',
              rankColorKey: rankKey(3),
              label: 'bubble',
              opName: `Pipeline bubble · PP${stage} 等待跨 stage 依赖（${prev < 1 ? 'warmup 填充' : '1F1B 空泡'}）`,
            });
          }
          prev = Math.max(prev, op.end);
        });
        if (totalUs - prev > bubbleThreshold) {
          tasks.push({
            startUs: prev,
            durUs: totalUs - prev,
            kind: 'bubble',
            status: 'wait',
            colorKey: 'pipeline:bubble',
            rankColorKey: rankKey(3),
            label: 'bubble',
            opName: `Pipeline bubble · PP${stage} drain 尾部空闲（流水线排空）`,
          });
        }

          ranks.push({
            rank,
            dp: dpIndex,
            stage,
            tp: tpIndex,
            ep: epIndex,
            label: `Rank ${rank}`,
            group: `D${dpIndex}·PP${stage}·TP${tpIndex}·EP${epIndex}`,
            tasks,
          });
        }
      }
    }
  }
  return { config: { dp, pp, tp, ep, microbatches }, timeRangeUs: [0, totalUs], ranks };
}

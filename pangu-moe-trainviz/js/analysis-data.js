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
  firstMoeLayer = 3,
  lastMoeLayer = 60,
  expertsPerLayer = 256,
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

export function buildCardLoadViewModel(rankViewModel) {
  const cards = (rankViewModel?.ranks || []).map(rank => ({
    cardId: rank.rank,
    label: `Card ${rank.rank}`,
    dp: rank.dp,
    stage: rank.stage,
    tp: rank.tp,
    utilRatio: rank.utilRatio,
    commRatio: rank.commRatio,
    bubbleRatio: rank.bubbleRatio,
    pressure: clamp01(rank.utilRatio * 0.72 + rank.commRatio * 0.48),
  }));
  const byStage = new Map();
  for (const card of cards) {
    const key = `D${card.dp}·P${card.stage}`;
    if (!byStage.has(key)) byStage.set(key, []);
    byStage.get(key).push(card);
  }
  return {
    id: 'card-load',
    title: 'Card Load',
    meta: `${cards.length} cards · grouped by DP/PP stage`,
    cards,
    groups: [...byStage.entries()].map(([label, items]) => ({ label, cards: items.sort((a, b) => a.tp - b.tp) })),
    stats: [
      { label: 'cards', value: `${cards.length}` },
      { label: 'groups', value: `${byStage.size}` },
      { label: 'max pressure', value: `${Math.round(Math.max(...cards.map(c => c.pressure), 0) * 100)}%` },
      { label: 'max comm', value: `${Math.round(Math.max(...cards.map(c => c.commRatio), 0) * 100)}%` },
    ],
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
  pp = 2,
  tp = 8,
  microbatches = 8,
  forwardBaseUs = 420,
  backwardBaseUs = 780,
  ppCommUs = 72,
  tpCommUs = 58,
  epCommUs = 96,
  stageRanges = [[0, 30], [31, 60]],
} = {}) {
  const { compF, compB, stageOps, totalUs } = simulate1F1BSchedule(pp, microbatches, forwardBaseUs, backwardBaseUs, ppCommUs);
  const ranks = [];
  for (let dpIndex = 0; dpIndex < dp; dpIndex++) {
    for (let stage = 0; stage < pp; stage++) {
      for (let tpIndex = 0; tpIndex < tp; tpIndex++) {
        const rank = (dpIndex * pp + stage) * tp + tpIndex;
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
            opName: `TP All-Reduce · 8-card TP group · micro ${microbatch}`,
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
            opName: `EP All-to-All · token dispatch/combine · micro ${microbatch}`,
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
          if (stage === 0 && compF[0][microbatch]) pushPp(compF[0][microbatch].end, `PP send activation → PP1 · micro ${microbatch}`);
          if (stage === 1 && compF[1][microbatch]) pushPp(compF[1][microbatch].start - ppCommUs * 0.8, `PP recv activation ← PP0 · micro ${microbatch}`);
          if (stage === 1 && compB[1][microbatch]) pushPp(compB[1][microbatch].end, `PP send gradient → PP0 · micro ${microbatch}`);
          if (stage === 0 && compB[0][microbatch]) pushPp(compB[0][microbatch].start - ppCommUs * 0.8, `PP recv gradient ← PP1 · micro ${microbatch}`);
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
          label: `Rank ${rank}`,
          group: `D${dpIndex}·PP${stage}·TP${tpIndex}`,
          tasks,
        });
      }
    }
  }
  return { config: { dp, pp, tp, microbatches }, timeRangeUs: [0, totalUs], ranks };
}

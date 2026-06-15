/* 每节点权重 / shape 详情 + 路由热图。hist = 24 桶分布。 */
window.WEIGHT_DATA = (function () {
  // 正态直方图（中心 c，宽 w，幅 a）
  function gauss(c, w, a) { const h = []; for (let i = 0; i < 24; i++) { const x = (i - 12) / 12; h.push(+(a * Math.exp(-((x - c) * (x - c)) / (w * w))).toFixed(3)); } return h; }
  const normalHist = gauss(0, 0.5, 1);
  // 异常：主体塌缩 + 最左桶（-inf 下溢）爆高
  const anomalyHist = gauss(0, 0.32, 0.45); anomalyHist[0] = 1.0; anomalyHist[1] = 0.62;

  // 路由热图：rows=8 专家组, cols=4 TP rank；Rank2(列2) 全 0（白）
  function heat() {
    const m = [];
    for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 4; c++) { row.push(c === 2 ? 0 : +(0.35 + 0.5 * Math.abs(Math.sin(r * 1.3 + c))).toFixed(2)); } m.push(row); }
    return m;
  }

  return {
    gate: {
      title: 'W_gate (Router)',
      normal: { shape: [4096, 256], stat: 'μ=0.00 σ=0.31', hist: normalHist },
      anomaly: { step: 1998, shape: [4096, 64], stat: 'Rank2 分片含 -inf', note: '混合精度下溢 · -inf', hist: anomalyHist },
      routingHeatmap: { rows: 8, cols: 4, anomalyCol: 2, matrix: heat() },
      dispatch: { normal: '[2048, 4]', anomaly: '[2048, 1]' },
    },
    experts: {
      title: 'W_expert (MoGE group)',
      normal: { shape: [4096, 11008], stat: 'μ=0.00 σ=0.28', hist: gauss(0, 0.52, 1) },
      anomaly: { step: 1998, shape: [4096, 11008], stat: 'Rank2 组 0 token → 0 梯度', note: '专家未激活', hist: gauss(0, 0.5, 0.2) },
      routingHeatmap: { rows: 8, cols: 4, anomalyCol: 2, matrix: heat() },
      dispatch: { normal: '[2048, 4]', anomaly: '[2048, 1]' },
    },
  };
})();

/* 分布式通信物理 mesh + 流量模型。
   展示一个 MoE All-to-All 通信组的代表性切片：8 行(DP slice) × 4 列(TP rank)。
   故障：TP Rank2（列 index=2）在 collapse 后流入流量坍缩成黑洞。 */
window.COMM_DATA = (function () {
  const ROWS = 8, COLS = 4;          // DP slice × TP rank
  const devices = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      devices.push({ rankId: 'r' + (r * COLS + c), dp: r, tp: c, baseUtil: 0.72 + (((r + c) % 3) * 0.05) });
    }
  }
  return {
    rows: ROWS, cols: COLS, devices,
    anomalyTp: 2,                    // TP Rank2 黑洞
    collapseStep: 1998,
    baseBytes: 1.0,                  // 归一化 All-to-All token 交换量
    primitives: [
      { id: 'all2all', label: 'All-to-All', colorVar: '--highlight-copy-blue-source' },
      { id: 'allreduce', label: 'AllReduce(TP)', colorVar: '--highlight-ub-green-source' },
    ],
    // 每 step 流量：collapse 后流入 anomalyTp 的 All-to-All 量 → 近似消失；气泡随时间累积
    flowAt: function (step) {
      const collapsed = step >= this.collapseStep;
      const k = Math.max(0, step - this.collapseStep);
      return {
        collapsed,
        bubbleCount: collapsed ? Math.min(6, 1 + Math.floor(k / 3)) : 0,
        // 列流量系数（流入该 TP 列的相对带宽）
        colFlow: [1, 1, collapsed ? Math.max(0.02, 0.5 - k * 0.05) : 1, 1],
        // 列利用率
        colUtil: [0.8, 0.82, collapsed ? Math.max(0.08, 0.7 - k * 0.06) : 0.78, 0.8],
      };
    },
  };
})();

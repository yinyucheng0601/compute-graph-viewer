/* 训练指标时序（合成，自洽于故障链：Step1997 混合精度写越界 → 路由坍缩）。
   生成 step 1900..2100。 */
window.TS_DATA = (function () {
  const FAULT = 1997;            // 混合精度写越界
  const COLLAPSE = 1998;         // 路由坍缩起点
  const steps = [];
  for (let s = 1900; s <= 2100; s++) steps.push(s);
  const rnd = (seed => () => (seed = (seed * 9301 + 49297) % 233280) / 233280)(1997);

  const train_loss = [], val_loss = [], eval_mmlu = [], grad_norm = [], load_balance_loss = [];
  steps.forEach(s => {
    const base = 2.05 - (s - 1900) * 0.0015;
    train_loss.push(+(base + (rnd() - 0.5) * 0.03).toFixed(4));
    if (s < COLLAPSE) {
      val_loss.push(+(base + 0.06 + (rnd() - 0.5) * 0.04).toFixed(4));
      eval_mmlu.push(+(0.58 + (s - 1900) * 0.0006 + (rnd() - 0.5) * 0.008).toFixed(4));
      grad_norm.push(+(0.9 + (rnd() - 0.5) * 0.12).toFixed(4));
      load_balance_loss.push(+(0.42 + (rnd() - 0.5) * 0.03).toFixed(4));
    } else {
      const k = s - COLLAPSE;
      val_loss.push(+(base + 0.06 + Math.abs(Math.sin(k * 1.3)) * (0.5 + k * 0.012) + (rnd() - 0.5) * 0.06).toFixed(4));
      eval_mmlu.push(+Math.max(0.30, 0.595 - k * 0.004 + (rnd() - 0.5) * 0.01).toFixed(4));
      grad_norm.push(+(1.2 + Math.abs(Math.sin(k * 1.1)) * (3 + k * 0.05) + (rnd() - 0.5) * 0.3).toFixed(4));
      load_balance_loss.push(+Math.max(0, 0.42 - k * 0.2 + (rnd() - 0.5) * 0.004).toFixed(4));
    }
  });

  const anomalies = { val_loss: [], grad_norm: [], load_balance_loss: [] };
  steps.forEach((s, i) => {
    if (s >= COLLAPSE && val_loss[i] > 2.35) anomalies.val_loss.push({ step: s, seriesId: 'val_loss' });
    if (s >= COLLAPSE && grad_norm[i] > 3.5) anomalies.grad_norm.push({ step: s, seriesId: 'grad_norm' });
  });
  anomalies.load_balance_loss.push({ step: 2000, seriesId: 'load_balance_loss' });

  return {
    steps, faultStep: FAULT, collapseStep: COLLAPSE, defaultStep: COLLAPSE + 2,
    series: { train_loss, val_loss, eval_mmlu, grad_norm, load_balance_loss },
    anomalies,
    config: { DP: 32, PP: 8, TP: 4, EP: 8, lr: '1.2e-4', batch: 2048, seq: 8192, precision: 'bf16 mixed' },
    faultEvent: { step: FAULT, what: '混合精度权重更新内存 stride 算错 → 写越界', node: 'gate' },
  };
})();

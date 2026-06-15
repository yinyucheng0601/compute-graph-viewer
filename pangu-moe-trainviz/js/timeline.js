/* ① 模型效果时间轴：train/val loss + eval MMLU。框选→interestWindow，监听 stepCursor 画游标。 */
window.TimelineView = (function () {
  let ctrl = null;
  function init(host) {
    const ts = window.TS_DATA;
    const initialStep = ts.defaultStep || ts.collapseStep || ts.faultStep;
    ctrl = window.PtoTrainingMetricsChart.render(host, {
      steps: ts.steps,
      series: [
        { id: 'train_loss', label: 'train loss', key: 'train_loss', colorVar: '--highlight-copy-blue-source', axis: 'left' },
        { id: 'val_loss', label: 'val loss', key: 'val_loss', colorVar: '--highlight-l0a-violet-source', axis: 'left', emphasis: true },
        { id: 'eval_mmlu', label: 'eval MMLU', key: 'eval_mmlu', colorVar: '--highlight-ub-green-source', axis: 'right' },
      ],
      data: ts.series,
      anomalies: ts.anomalies.val_loss,
      cursor: initialStep,
      options: { width: 1040, height: 160 },
      onBrush: (w) => Bus.emit('interestWindow', w),
    });
    Bus.on('stepCursor', s => ctrl.setCursor(s));
    Bus.on('interestWindow', w => ctrl.setInterestWindow(w));
  }
  return { init };
})();

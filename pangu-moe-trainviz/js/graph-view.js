/* ② 整网架构图：model-training-graphviz 渲染 Pangu Pro MoE。
   选中→广播 select；监听 select 反向点亮；「追溯梯度流」→ 回溯 Step1997。 */
window.GraphView = (function () {
  let controller = null, selfSelect = false;
  function init(stageEl, traceBtn) {
    controller = window.PtoModelTrainingGraphvizPattern.render(stageEl, window.PANGU_GRAPH, {
      activeNodeId: 'gate',
      activeRelatedNodeIds: CrossMap.resolve('gate').relatedNodeIds,
      colormap: { saturation: 0.45, lightness: 0.38 },   // 克制深色，保证白字可读
      fitMode: 'full',
      viewportPadding: 18,
      onSelect: ({ nodeId, source }) => {
        if (source === 'bus') return;                 // 防回环
        const m = CrossMap.resolve(nodeId);
        selfSelect = true;
        Bus.emit('select', { objectType: 'node', id: nodeId, relatedNodeIds: m.relatedNodeIds, cols: m.cols, weightKey: m.weightKey, source: 'graph' });
        selfSelect = false;
      },
    });

    Bus.on('select', p => {
      if (!p || p.source === 'graph' || selfSelect) return;
      if (p.id && window.PANGU_GRAPH.nodes.some(n => n.id === p.id)) {
        controller.selectNode(p.id, { relatedNodeIds: p.relatedNodeIds, source: 'bus' });
      }
    });

    // 追溯梯度流：定位 Step1997 混合精度写越界
    function trace() {
      const ts = window.TS_DATA;
      Bus.emit('select', { objectType: 'node', id: 'gate', relatedNodeIds: CrossMap.resolve('gate').relatedNodeIds, cols: [2], weightKey: 'gate', source: 'graph' });
      controller.selectNode('gate', { relatedNodeIds: CrossMap.resolve('gate').relatedNodeIds, source: 'bus' });
      Bus.emit('interestWindow', { start: ts.faultStep - 3, end: ts.collapseStep + 8 });
      Bus.emit('stepCursor', ts.faultStep);
      Bus.emit('faultTrace', ts.faultEvent);
    }
    if (traceBtn) traceBtn.addEventListener('click', trace);
    stageEl.addEventListener('contextmenu', e => { e.preventDefault(); trace(); });
  }
  return { init };
})();

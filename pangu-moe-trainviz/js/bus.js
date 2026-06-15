/* 轻量事件总线 + 跨视图映射。三广播通道：
   interestWindow {start,end} · select {objectType,id,...} · stepCursor step  */
window.Bus = (function () {
  const ch = {};
  return {
    on(name, fn) { (ch[name] || (ch[name] = [])).push(fn); },
    emit(name, payload) { (ch[name] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); },
  };
})();

/* nodeId ↔ relatedNodeIds ↔ 物理 TP 列 ↔ 权重 key 的双向索引 */
window.CrossMap = {
  byNode: {
    gate: { relatedNodeIds: ['a2a_dispatch', 'experts', 'a2a_combine'], cols: [2], weightKey: 'gate' },
    a2a_dispatch: { relatedNodeIds: ['gate', 'experts'], cols: [2], weightKey: 'gate' },
    experts: { relatedNodeIds: ['a2a_dispatch', 'a2a_combine', 'gate'], cols: [2], weightKey: 'experts' },
    a2a_combine: { relatedNodeIds: ['experts', 'gate'], cols: [2], weightKey: 'experts' },
  },
  resolve(nodeId) { return this.byNode[nodeId] || { relatedNodeIds: [], cols: [], weightKey: null }; },
};

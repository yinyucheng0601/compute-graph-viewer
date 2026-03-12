/**
 * layout-tb.js — Top-to-Bottom (TB) layered DAG layout
 *
 * Self-contained top-level function; no external dependencies.
 * All constants are scoped inside the function.
 *
 * Returns: { positions: Map<id,{x,y,w,h}>, layerNodes, maxLayer, canvasW, canvasH, direction:'TB' }
 */
function computeLayoutTB(graph, options) {
  options = options || {};

  var _PAD      = 60;
  var _NODE_W   = 225;
  var _H_GAP    = 60;
  var _V_GAP    = 60;

  var _H = { incast: 208, outcast: 208, op: 156, tensor: 208, group: 200 };
  var _HC = { incast: 98,  outcast: 98,  op: 64,  tensor: 98,  group: 98  };

  var compact   = !!options.compact;
  var nodeWidth = options.nodeWidth || _NODE_W;
  var hStep     = options.hStep    || (nodeWidth + _H_GAP);
  var vGap      = options.vGap     || _V_GAP;
  var nodes     = graph.nodes;
  var edges     = graph.edges;

  function nodeH(node) {
    var type = node && node.type;
    return compact ? (_HC[type] || 44) : (_H[type] || 124);
  }

  function bary(nodeId, neighbors, prevPos) {
    var nbrs = neighbors.get(nodeId) || [];
    var sum = 0, count = 0;
    for (var i = 0; i < nbrs.length; i++) {
      if (prevPos.has(nbrs[i])) { sum += prevPos.get(nbrs[i]); count++; }
    }
    return count > 0 ? sum / count : 1e9;
  }

  if (!nodes || nodes.length === 0) {
    return { positions: new Map(), layerNodes: [], maxLayer: 0, canvasW: 0, canvasH: 0, direction: 'TB' };
  }

  // ── Adjacency ─────────────────────────────────────────────
  var pred = new Map();
  var succ = new Map();
  nodes.forEach(function(n) { pred.set(n.id, []); succ.set(n.id, []); });
  edges.forEach(function(e) {
    if (pred.has(e.target) && succ.has(e.source)) {
      pred.get(e.target).push(e.source);
      succ.get(e.source).push(e.target);
    }
  });

  // ── Layer assignment: longest path (Kahn's BFS) ──────────
  var layer = new Map();
  var inDeg = new Map();
  nodes.forEach(function(n) { inDeg.set(n.id, pred.get(n.id).length); });

  var queue = [];
  nodes.forEach(function(n) { if (inDeg.get(n.id) === 0) { queue.push(n.id); layer.set(n.id, 0); } });

  var head = 0;
  while (head < queue.length) {
    var id = queue[head++];
    var cur = layer.get(id);
    var outs = succ.get(id);
    for (var i = 0; i < outs.length; i++) {
      var nextId = outs[i];
      var proposed = cur + 1;
      if (!layer.has(nextId) || layer.get(nextId) < proposed) layer.set(nextId, proposed);
      inDeg.set(nextId, inDeg.get(nextId) - 1);
      if (inDeg.get(nextId) === 0) queue.push(nextId);
    }
  }
  nodes.forEach(function(n) { if (!layer.has(n.id)) layer.set(n.id, 0); });

  // Pull pure sources one step above their first consumer
  nodes.forEach(function(n) {
    if (pred.get(n.id).length !== 0) return;
    var outs = succ.get(n.id);
    if (outs.length > 0) {
      var minOut = Math.min.apply(null, outs.map(function(id) { return layer.get(id); }));
      if (minOut > 1) layer.set(n.id, minOut - 1);
    }
  });

  var maxLayer = 0;
  layer.forEach(function(v) { if (v > maxLayer) maxLayer = v; });

  var layerNodes = [];
  for (var l = 0; l <= maxLayer; l++) layerNodes.push([]);
  layer.forEach(function(l, id) { layerNodes[l].push(id); });

  // ── Crossing minimization (forward → backward → forward) ──
  for (var l = 1; l <= maxLayer; l++) {
    var prevPos = new Map(layerNodes[l-1].map(function(id, i) { return [id, i]; }));
    layerNodes[l].sort(function(a, b) { return bary(a, pred, prevPos) - bary(b, pred, prevPos); });
  }
  for (var l = maxLayer - 1; l >= 0; l--) {
    var nextPos = new Map(layerNodes[l+1].map(function(id, i) { return [id, i]; }));
    layerNodes[l].sort(function(a, b) { return bary(a, succ, nextPos) - bary(b, succ, nextPos); });
  }
  for (var l = 1; l <= maxLayer; l++) {
    var prevPos = new Map(layerNodes[l-1].map(function(id, i) { return [id, i]; }));
    layerNodes[l].sort(function(a, b) { return bary(a, pred, prevPos) - bary(b, pred, prevPos); });
  }

  // ── Y: accumulate actual max node height per layer ─────────
  var nodeMap = new Map(nodes.map(function(n) { return [n.id, n]; }));
  var layerY = [];
  var yAcc = _PAD;
  for (var l = 0; l <= maxLayer; l++) {
    layerY.push(yAcc);
    var maxH = 0;
    layerNodes[l].forEach(function(id) {
      var h = nodeH(nodeMap.get(id));
      if (h > maxH) maxH = h;
    });
    yAcc += maxH + vGap;
  }

  // ── X: horizontal placement ────────────────────────────────
  var nodeX = new Map();
  for (var l = 0; l <= maxLayer; l++) {
    var ids = layerNodes[l];
    if (ids.length === 0) continue;
    var cursor = _PAD;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var placed = pred.get(id).filter(function(p) { return nodeX.has(p); });
      var ideal = placed.length > 0
        ? placed.reduce(function(s, p) { return s + nodeX.get(p); }, 0) / placed.length
        : null;
      var x = ideal !== null ? Math.max(cursor, ideal) : cursor;
      nodeX.set(id, x);
      cursor = x + hStep;
    }
  }

  // Backward pass: nudge toward successor centers
  for (var l = maxLayer - 1; l >= 0; l--) {
    var ids = layerNodes[l];
    var ceiling = Infinity;
    for (var i = ids.length - 1; i >= 0; i--) {
      var id = ids[i];
      var placed = succ.get(id).filter(function(s) { return nodeX.has(s); });
      if (placed.length > 0) {
        var ideal = placed.reduce(function(s, p) { return s + nodeX.get(p); }, 0) / placed.length;
        var cap   = ceiling === Infinity ? ideal : Math.min(ideal, ceiling - hStep);
        var clamped = Math.max(_PAD, cap);
        if (clamped > nodeX.get(id)) nodeX.set(id, clamped);
      }
      ceiling = nodeX.get(id);
    }
  }

  // ── Build positions ────────────────────────────────────────
  var positions = new Map();
  for (var l = 0; l <= maxLayer; l++) {
    layerNodes[l].forEach(function(id) {
      var node = nodeMap.get(id);
      positions.set(id, {
        x: nodeX.get(id) !== undefined ? nodeX.get(id) : _PAD,
        y: layerY[l],
        w: nodeWidth,
        h: nodeH(node),
      });
    });
  }

  var maxRight = 0, maxBottom = 0;
  positions.forEach(function(p) {
    if (p.x + p.w > maxRight)  maxRight  = p.x + p.w;
    if (p.y + p.h > maxBottom) maxBottom = p.y + p.h;
  });

  return {
    positions:  positions,
    layerNodes: layerNodes,
    maxLayer:   maxLayer,
    canvasW:    maxRight  + _PAD,
    canvasH:    maxBottom + _PAD,
    direction:  'TB',
  };
}

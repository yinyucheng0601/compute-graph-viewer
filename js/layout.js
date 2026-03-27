/**
 * layout.js — Sugiyama-style layered DAG layout (LR orientation)
 *
 * Strategy:
 *   1. Topological sort → assign layer (longest path from sources)
 *   2. Two-pass crossing minimization (forward + backward barycenter)
 *   3. Coordinate assignment with centering per layer
 *
 * Output: Map<nodeId, {x, y, w, h}>
 */

const NODE_W = 225;   // compact node width tuned to 1.5x for readable labels
const H_GAP = 180;    // default horizontal gap between layers
const H_STEP = NODE_W + H_GAP;   // horizontal step: column width + gap
const V_GAP = 20;     // dynamic gap between nodes when using per-node heights
const V_GAP_COMPACT = 30;
const PAD = 60;    // canvas padding

const NODE_HEIGHTS = {
  incast: 208,
  outcast: 208,
  op: 156,
  tensor: 208,
  group: 200,
};

const NODE_HEIGHTS_COMPACT = {
  // Must match real compact card outer height (content + margins + node padding),
  // otherwise layout underestimates vertical space and cards overlap/clipped.
  incast: 98,
  outcast: 98,
  op: 124,
  tensor: 98,
  group: 98,
};

function estimateGroupRows(node) {
  const d = node?.data || {};
  let rows = 0;
  const hasShape = Array.isArray(d.shape) ? d.shape.length > 0 : !!d.shape;
  if (hasShape) rows += 1;
  if (d.memFlow || d.memFrom || d.memTo) rows += 1;
  if (Array.isArray(d.rows)) rows += d.rows.length;
  return rows;
}

function estimateGroupVisibleStackCount(node) {
  const d = node?.data || {};
  const members = Array.isArray(d.members) ? d.members : [];
  if (members.length === 0) {
    const fallbackCount = Number(d.count) || 0;
    return Math.min(7, Math.max(2, fallbackCount || 2));
  }
  return members.length <= 7 ? members.length : 7;
}

function estimateGroupHeight(node) {
  // Mirrors renderer/card CSS roughly: header + rows + compressed stack bars.
  const rows = estimateGroupRows(node);
  const stackCount = estimateGroupVisibleStackCount(node);
  const headH = 56; // include extra top inset in .group-content
  const rowPad = rows > 0 ? 8 : 0;
  const rowH = 19;
  const stackMargin = 6; // match group-stack margin: 2(top)+4(bottom)
  const stackItemH = 12;
  const stackGap = 4;
  const stackH = stackMargin + (stackCount * stackItemH) + (Math.max(0, stackCount - 1) * stackGap);
  const estimated = headH + rowPad + (rows * rowH) + stackH;
  return Math.max(148, Math.min(320, Math.round(estimated)));
}

function getNodeHeight(nodeOrType, compact, options = {}) {
  const type = typeof nodeOrType === 'string' ? nodeOrType : nodeOrType?.type;
  const compactHeights = options.nodeHeightsCompact || NODE_HEIGHTS_COMPACT;
  if (compact) return compactHeights[type] ?? 44;
  if (type === 'group') return estimateGroupHeight(nodeOrType);
  return NODE_HEIGHTS[type] ?? 124;
}

function computeLayout(graph, options = {}) {
  const { nodes, edges } = graph;
  const compact = !!options.compact;
  const nodeWidth = compact ? (options.nodeWidth || NODE_W) : (options.nodeWidth || NODE_W);
  const hStep = compact ? (nodeWidth + 50) : (options.hStep || (nodeWidth + H_GAP));
  const vGap = compact ? V_GAP_COMPACT : V_GAP;
  if (nodes.length === 0) return { positions: new Map(), layerNodes: [], maxLayer: 0 };

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // ── Build adjacency ──────────────────────────────────────────
  const pred = new Map(nodes.map(n => [n.id, []]));
  const succ = new Map(nodes.map(n => [n.id, []]));

  for (const e of edges) {
    if (pred.has(e.target) && succ.has(e.source)) {
      pred.get(e.target).push(e.source);
      succ.get(e.source).push(e.target);
    }
  }

  // ── Layer assignment (longest path from sources) ─────────────
  const layer = new Map();
  const inDeg = new Map(nodes.map(n => [n.id, pred.get(n.id).length]));

  // Kahn's BFS with longest-path update
  const queue = nodes.filter(n => inDeg.get(n.id) === 0).map(n => n.id);
  queue.forEach(id => layer.set(id, 0));

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const currentLayer = layer.get(id);
    for (const nextId of succ.get(id)) {
      const proposed = currentLayer + 1;
      if (!layer.has(nextId) || layer.get(nextId) < proposed) {
        layer.set(nextId, proposed);
      }
      inDeg.set(nextId, inDeg.get(nextId) - 1);
      if (inDeg.get(nextId) === 0) {
        queue.push(nextId);
      }
    }
  }

  // Handle any nodes not reached (disconnected)
  for (const n of nodes) {
    if (!layer.has(n.id)) layer.set(n.id, 0);
  }

  // ── Push down sources (tensors/incasts) closer to consumers ──
  const layerReversed = Array.from(layer.keys()).sort((a, b) => layer.get(b) - layer.get(a));
  for (const id of layerReversed) {
    if (inDeg.get(id) === 0) {
      const outNodes = succ.get(id);
      if (outNodes.length > 0) {
        // Find minimum layer among successors
        const minOutLayer = Math.min(...outNodes.map(outId => layer.get(outId)));
        if (minOutLayer > 1) {
          layer.set(id, minOutLayer - 1);
        }
      }
    }
  }

  const maxLayer = Math.max(...layer.values());

  // ── Group nodes by layer ─────────────────────────────────────
  const layerNodes = Array.from({ length: maxLayer + 1 }, () => []);
  layer.forEach((l, id) => layerNodes[l].push(id));

  // ── Crossing minimization ────────────────────────────────────
  const posInLayer = new Map();

  // Initialize positions (natural order)
  layerNodes.forEach(ids => ids.forEach((id, i) => posInLayer.set(id, i)));

  // Forward pass: sort by avg predecessor position
  for (let l = 1; l <= maxLayer; l++) {
    const prevPos = new Map(layerNodes[l - 1].map((id, i) => [id, i]));
    layerNodes[l].sort((a, b) => {
      return baryPos(a, pred, prevPos) - baryPos(b, pred, prevPos);
    });
    layerNodes[l].forEach((id, i) => posInLayer.set(id, i));
  }

  // Backward pass: sort by avg successor position
  for (let l = maxLayer - 1; l >= 0; l--) {
    const nextPos = new Map(layerNodes[l + 1].map((id, i) => [id, i]));
    layerNodes[l].sort((a, b) => {
      return baryPos(a, succ, nextPos) - baryPos(b, succ, nextPos);
    });
    layerNodes[l].forEach((id, i) => posInLayer.set(id, i));
  }

  // Second forward pass (improves result)
  for (let l = 1; l <= maxLayer; l++) {
    const prevPos = new Map(layerNodes[l - 1].map((id, i) => [id, i]));
    layerNodes[l].sort((a, b) => {
      return baryPos(a, pred, prevPos) - baryPos(b, pred, prevPos);
    });
    layerNodes[l].forEach((id, i) => posInLayer.set(id, i));
  }

  // ── Coordinate assignment ─────────────────────────────────────
  // TB mode: layers go down (Y axis), nodes spread right (X axis).
  // LR mode: layers go right (X axis), nodes spread down (Y axis).

  if (options.direction === 'TB') {
    const layerY = layerNodes.map((_, l) => PAD + l * hStep);
    const nodeX = new Map();

    for (let l = 0; l <= maxLayer; l++) {
      const ids = layerNodes[l];
      if (ids.length === 0) continue;
      let cursor = PAD;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const placedPreds = (pred.get(id) || []).filter(p => nodeX.has(p));
        const ideal = placedPreds.length > 0
          ? placedPreds.reduce((s, p) => s + nodeX.get(p), 0) / placedPreds.length
          : null;
        const x = ideal !== null ? Math.max(cursor, ideal) : cursor;
        nodeX.set(id, x);
        cursor = x + hStep;
      }
    }

    for (let l = maxLayer - 1; l >= 0; l--) {
      const ids = layerNodes[l];
      let ceiling = Infinity;
      for (let i = ids.length - 1; i >= 0; i--) {
        const id = ids[i];
        const placedSuccs = (succ.get(id) || []).filter(s => nodeX.has(s));
        if (placedSuccs.length > 0) {
          const ideal = placedSuccs.reduce((s, p) => s + nodeX.get(p), 0) / placedSuccs.length;
          const maxX = ceiling === Infinity ? ideal : Math.min(ideal, ceiling - hStep);
          if (maxX <= nodeX.get(id)) {
            nodeX.set(id, Math.max(nodeX.get(id), maxX < PAD ? PAD : maxX));
          }
        }
        ceiling = nodeX.get(id);
      }
    }

    const positions = new Map();
    for (let l = 0; l <= maxLayer; l++) {
      for (const id of layerNodes[l]) {
        const node = nodeMap.get(id);
        const h = getNodeHeight(node, compact, options);
        positions.set(id, { x: nodeX.get(id) ?? PAD, y: layerY[l], w: nodeWidth, h });
      }
    }
    const maxRight = Math.max(...[...positions.values()].map(p => p.x + p.w));
    const maxBottom = Math.max(...[...positions.values()].map(p => p.y + p.h));
    return { positions, layerNodes, maxLayer, canvasW: maxRight + PAD, canvasH: maxBottom + PAD };
  }

  // ── LR: layers go right, nodes spread down ───────────────────
  const layerX = layerNodes.map((_, l) => PAD + l * hStep);
  const nodeY = new Map();

  for (let l = 0; l <= maxLayer; l++) {
    const ids = layerNodes[l];
    if (ids.length === 0) continue;

    let cursor = PAD;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const placedPreds = (pred.get(id) || []).filter(p => nodeY.has(p));
      const ideal = placedPreds.length > 0
        ? placedPreds.reduce((s, p) => s + nodeY.get(p), 0) / placedPreds.length
        : null;
      const node = nodeMap.get(id);
      const nodeH = getNodeHeight(node, compact, options);
      const y = ideal !== null ? Math.max(cursor, ideal) : cursor;
      nodeY.set(id, y);
      cursor = y + nodeH + vGap;
    }
  }

  for (let l = maxLayer - 1; l >= 0; l--) {
    const ids = layerNodes[l];
    let ceiling = Infinity;
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i];
      const node = nodeMap.get(id);
      const nodeH = getNodeHeight(node, compact, options);
      const placedSuccs = (succ.get(id) || []).filter(s => nodeY.has(s));
      if (placedSuccs.length > 0) {
        const ideal = placedSuccs.reduce((s, p) => s + nodeY.get(p), 0) / placedSuccs.length;
        const maxY = ceiling === Infinity ? ideal : Math.min(ideal, ceiling - (nodeH + vGap));
        if (maxY > nodeY.get(id)) {
          // Only pull up (toward ideal) if it doesn't cause overlap
        } else {
          nodeY.set(id, Math.max(nodeY.get(id), maxY < PAD ? PAD : maxY));
        }
      }
      ceiling = nodeY.get(id);
    }
  }

  const positions = new Map();
  for (let l = 0; l <= maxLayer; l++) {
    for (const id of layerNodes[l]) {
      const node = nodeMap.get(id);
      const h = getNodeHeight(node, compact, options);
      positions.set(id, { x: layerX[l], y: nodeY.get(id) ?? PAD, w: nodeWidth, h });
    }
  }

  const maxNodeBottom = Math.max(...[...positions.values()].map(p => p.y + p.h));
  const canvasW = PAD * 2 + (maxLayer + 1) * hStep;
  const canvasH = maxNodeBottom + PAD;

  return { positions, layerNodes, maxLayer, canvasW, canvasH };
}

function baryPos(nodeId, neighbors, prevPositions) {
  const nbrs = neighbors.get(nodeId) || [];
  if (nbrs.length === 0) return Infinity; // keep original order
  let sum = 0, count = 0;
  for (const nid of nbrs) {
    if (prevPositions.has(nid)) {
      sum += prevPositions.get(nid);
      count++;
    }
  }
  return count > 0 ? sum / count : Infinity;
}

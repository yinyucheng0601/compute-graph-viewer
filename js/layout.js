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

const NODE_W    = 250;   // fixed width for all nodes
const H_STEP    = 330;   // horizontal step: column width + gap
const V_STEP    = 220;   // vertical step: node height + gap
const PAD       = 60;    // canvas padding

const NODE_HEIGHTS = {
  incast:  200,
  outcast: 200,
  op:      148,
  tensor:  200,
};

function getNodeHeight(type) {
  return NODE_HEIGHTS[type] ?? 124;
}

function computeLayout(graph) {
  const { nodes, edges } = graph;
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

  // ── Connection-aware Y-coordinate assignment ─────────────────
  // Each node's ideal Y = average Y of its already-placed predecessors.
  // This makes a single unbranched flow a perfectly horizontal line.
  // Nodes are placed in crossing-minimized order; minimum gap = V_STEP.

  const layerX = layerNodes.map((_, l) => PAD + l * H_STEP);
  const nodeY  = new Map();

  for (let l = 0; l <= maxLayer; l++) {
    const ids = layerNodes[l];
    if (ids.length === 0) continue;

    let cursor = PAD;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];

      // Ideal Y = avg of placed predecessors
      const placedPreds = (pred.get(id) || []).filter(p => nodeY.has(p));
      const ideal = placedPreds.length > 0
        ? placedPreds.reduce((s, p) => s + nodeY.get(p), 0) / placedPreds.length
        : null;

      const y = ideal !== null ? Math.max(cursor, ideal) : cursor;
      nodeY.set(id, y);
      cursor = y + V_STEP;
    }
  }

  // Also do a backward pass to pull nodes toward successors
  for (let l = maxLayer - 1; l >= 0; l--) {
    const ids = layerNodes[l];
    let ceiling = Infinity;
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i];
      const placedSuccs = (succ.get(id) || []).filter(s => nodeY.has(s));
      if (placedSuccs.length > 0) {
        const ideal = placedSuccs.reduce((s, p) => s + nodeY.get(p), 0) / placedSuccs.length;
        const maxY = ceiling === Infinity ? ideal : Math.min(ideal, ceiling - V_STEP);
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
      const h = getNodeHeight(node?.type);
      positions.set(id, {
        x: layerX[l],
        y: nodeY.get(id) ?? PAD,
        w: NODE_W,
        h,
      });
    }
  }

  // Canvas dimensions from actual node positions
  const maxNodeBottom = Math.max(...[...positions.values()].map(p => p.y + p.h));
  const canvasW = PAD * 2 + (maxLayer + 1) * H_STEP;
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

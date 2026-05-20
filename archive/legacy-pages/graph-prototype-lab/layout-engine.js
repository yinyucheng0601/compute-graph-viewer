export async function computeLayout(visibleGraph) {
  if (visibleGraph.layoutMode === "fixed") {
    return { ...computeFixedLayout(visibleGraph), engine: "fixed" };
  }
  return { ...computeDagreLayout(visibleGraph), engine: "dagre" };
}

function computeFixedLayout(visibleGraph) {
  const positions = new Map();
  let maxX = 0;
  let maxY = 0;

  visibleGraph.nodes.forEach((node) => {
    const x = Number(node.data?.x ?? 0);
    const y = Number(node.data?.y ?? 0);
    const w = Number(node.displayWidth ?? node.coreWidth ?? node.data?.width ?? 160);
    const h = Number(node.displayHeight ?? node.coreHeight ?? node.data?.height ?? 48);
    positions.set(node.id, {x, y, w, h});
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  expandFixedGroupBounds(visibleGraph, positions);
  maxX = 0;
  maxY = 0;
  positions.forEach((rect) => {
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  });

  const edges = visibleGraph.edges.map((edge) => {
    const srcRect = positions.get(edge.source);
    const tgtRect = positions.get(edge.target);
    const srcNode = visibleGraph.byId.get(edge.source);
    const tgtNode = visibleGraph.byId.get(edge.target);
    if (!srcRect || !tgtRect) {
      return {id: edge.id, source: edge.source, target: edge.target, points: [], labelPoint: null};
    }
    const src = coreRect(srcRect, srcNode);
    const tgt = coreRect(tgtRect, tgtNode);
    const points = fixedEdgePoints(edge, src, tgt);
    points.forEach((p) => {
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      points,
      labelPoint: findMidPoint(points),
    };
  });

  return {positions, edges, canvasW: maxX + 80, canvasH: maxY + 80};
}

function expandFixedGroupBounds(visibleGraph, positions) {
  const GROUP_PAD = {top: 52, right: 18, bottom: 18, left: 18};
  const groups = visibleGraph.nodes
    .filter((node) => node.kind === "group" && node.expanded)
    .sort((left, right) => (right.data?.depth || 0) - (left.data?.depth || 0));

  groups.forEach((group) => {
    const childIds = visibleGraph.childrenByParent.get(group.id) || [];
    const groupRect = positions.get(group.id);
    if (!groupRect || !childIds.length) {
      return;
    }

    let minX = groupRect.x;
    let minY = groupRect.y;
    let maxX = groupRect.x + groupRect.w;
    let maxY = groupRect.y + groupRect.h;

    childIds.forEach((childId) => {
      const childRect = positions.get(childId);
      if (!childRect) {
        return;
      }
      minX = Math.min(minX, childRect.x - GROUP_PAD.left);
      minY = Math.min(minY, childRect.y - GROUP_PAD.top);
      maxX = Math.max(maxX, childRect.x + childRect.w + GROUP_PAD.right);
      maxY = Math.max(maxY, childRect.y + childRect.h + GROUP_PAD.bottom);
    });

    positions.set(group.id, {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    });
  });
}

function fixedEdgePoints(edge, src, tgt) {
  const sourceSide = edge.data?.sourceSide || "bottom";
  const targetSide = edge.data?.targetSide || "top";
  const sourcePoint = sideAnchor(src, sourceSide);
  const targetPoint = sideAnchor(tgt, targetSide);
  const via = Array.isArray(edge.data?.points) ? edge.data.points : [];
  return [sourcePoint, ...via.map((p) => ({x: Number(p.x), y: Number(p.y)})), targetPoint];
}

function sideAnchor(rect, side) {
  if (side === "top") return {x: rect.x + rect.w / 2, y: rect.y};
  if (side === "bottom") return {x: rect.x + rect.w / 2, y: rect.y + rect.h};
  if (side === "left") return {x: rect.x, y: rect.y + rect.h / 2};
  return {x: rect.x + rect.w, y: rect.y + rect.h / 2};
}

function computeDagreLayout(visibleGraph) {
  const positions = new Map();
  const direction = visibleGraph.direction || "TB";

  const GROUP_PAD = { top: 48, right: 24, bottom: 24, left: 24 };
  const ROOT_PAD = 32;

  layoutLevel(null, ROOT_PAD, ROOT_PAD);

  const edges = computeEdgeLines(visibleGraph, positions);

  let maxX = 0;
  let maxY = 0;
  positions.forEach((r) => {
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  });
  edges.forEach((e) => {
    e.points.forEach((p) => {
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
  });

  return { positions, edges, canvasW: maxX + 48, canvasH: maxY + 48 };

  function layoutLevel(parentId, originX, originY) {
    const childIds = visibleGraph.childrenByParent.get(parentId) || [];
    if (!childIds.length) {
      return { w: 0, h: 0 };
    }

    // Bottom-up: recursively layout expanded child groups first
    const sizes = new Map();
    childIds.forEach((id) => {
      const node = visibleGraph.byId.get(id);
      if (node.kind === "group" && node.expanded) {
        const inner = layoutLevel(id, 0, 0);
        sizes.set(id, {
          w: inner.w + GROUP_PAD.left + GROUP_PAD.right,
          h: inner.h + GROUP_PAD.top + GROUP_PAD.bottom,
        });
      } else {
        sizes.set(id, { w: node.displayWidth, h: node.displayHeight });
      }
    });

    // Lift a node up to its direct-child representative at this level
    function getRepAt(nodeId) {
      let cur = visibleGraph.byId.get(nodeId);
      while (cur && cur.visibleParentId !== parentId) {
        cur = visibleGraph.byId.get(cur.visibleParentId);
      }
      return cur?.id || null;
    }

    // Collect lifted edge pairs (dedup)
    const liftedEdges = new Set();
    visibleGraph.edges.forEach((e) => {
      const src = getRepAt(e.source);
      const tgt = getRepAt(e.target);
      if (src && tgt && src !== tgt) {
        liftedEdges.add(`${src}\x00${tgt}`);
      }
    });

    // Build dagre graph
    const g = new window.dagre.graphlib.Graph();
    g.setGraph({
      rankdir: direction === "TB" ? "TB" : "LR",
      nodesep: 36,
      ranksep: direction === "TB" ? 60 : 80,
      marginx: 0,
      marginy: 0,
      acyclicer: "greedy",
      ranker: "network-simplex",
    });
    g.setDefaultEdgeLabel(() => ({}));

    childIds.forEach((id) => {
      const s = sizes.get(id);
      g.setNode(id, { width: s.w, height: s.h });
    });

    liftedEdges.forEach((pair) => {
      const [src, tgt] = pair.split("\x00");
      if (g.hasNode(src) && g.hasNode(tgt)) {
        g.setEdge(src, tgt);
      }
    });

    window.dagre.layout(g);

    // Dagre uses center coords; find top-left origin
    let minX = Infinity;
    let minY = Infinity;
    childIds.forEach((id) => {
      const n = g.node(id);
      if (n) {
        minX = Math.min(minX, n.x - n.width / 2);
        minY = Math.min(minY, n.y - n.height / 2);
      }
    });
    if (!isFinite(minX)) minX = 0;
    if (!isFinite(minY)) minY = 0;

    let maxRight = 0;
    let maxBottom = 0;

    childIds.forEach((id) => {
      const n = g.node(id);
      if (!n) return;
      const x = originX + (n.x - n.width / 2 - minX);
      const y = originY + (n.y - n.height / 2 - minY);
      const node = visibleGraph.byId.get(id);
      positions.set(id, { x, y, w: n.width, h: n.height });

      if (node.kind === "group" && node.expanded) {
        repositionSubtree(id, x + GROUP_PAD.left, y + GROUP_PAD.top);
      }

      maxRight = Math.max(maxRight, x - originX + n.width);
      maxBottom = Math.max(maxBottom, y - originY + n.height);
    });

    return { w: maxRight, h: maxBottom };
  }

  function repositionSubtree(groupId, newLeft, newTop) {
    const childIds = visibleGraph.childrenByParent.get(groupId) || [];
    if (!childIds.length) return;

    let minX = Infinity;
    let minY = Infinity;
    collectAllDescendants(groupId).forEach((id) => {
      const r = positions.get(id);
      if (r) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
      }
    });

    const dx = newLeft - (isFinite(minX) ? minX : 0);
    const dy = newTop - (isFinite(minY) ? minY : 0);
    if (!dx && !dy) return;

    collectAllDescendants(groupId).forEach((id) => {
      const r = positions.get(id);
      if (r) positions.set(id, { ...r, x: r.x + dx, y: r.y + dy });
    });
  }

  function collectAllDescendants(groupId) {
    const result = [];
    const queue = [...(visibleGraph.childrenByParent.get(groupId) || [])];
    while (queue.length) {
      const id = queue.shift();
      result.push(id);
      const node = visibleGraph.byId.get(id);
      if (node?.kind === "group" && node.expanded) {
        queue.push(...(visibleGraph.childrenByParent.get(id) || []));
      }
    }
    return result;
  }
}

function computeEdgeLines(visibleGraph, positions) {
  const direction = visibleGraph.direction || "TB";
  return visibleGraph.edges.map((edge) => {
    const srcRect = positions.get(edge.source);
    const tgtRect = positions.get(edge.target);
    const srcNode = visibleGraph.byId.get(edge.source);
    const tgtNode = visibleGraph.byId.get(edge.target);

    if (!srcRect || !tgtRect) {
      return { id: edge.id, source: edge.source, target: edge.target, points: [], labelPoint: null };
    }

    const src = coreRect(srcRect, srcNode);
    const tgt = coreRect(tgtRect, tgtNode);
    const points = buildEdgePoints(src, tgt, direction);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      points,
      labelPoint: findMidPoint(points),
    };
  });
}

function coreRect(displayRect, node) {
  if (!node || (node.kind === "group" && node.expanded)) {
    return displayRect;
  }
  const dx = node.inboxWidth || 0;
  const dy = (displayRect.h - (node.coreHeight || displayRect.h)) / 2;
  return {
    x: displayRect.x + dx,
    y: displayRect.y + dy,
    w: node.coreWidth || displayRect.w,
    h: node.coreHeight || displayRect.h,
  };
}

function buildEdgePoints(src, tgt, direction) {
  if (direction === "TB") {
    const sx = src.x + src.w / 2;
    const sy = src.y + src.h;
    const tx = tgt.x + tgt.w / 2;
    const ty = tgt.y;
    return [{ x: sx, y: sy }, { x: tx, y: ty }];
  }
  const sx = src.x + src.w;
  const sy = src.y + src.h / 2;
  const tx = tgt.x;
  const ty = tgt.y + tgt.h / 2;
  return [{ x: sx, y: sy }, { x: tx, y: ty }];
}

function findMidPoint(points) {
  if (!points.length) return null;
  if (points.length === 1) return points[0];
  const mid = Math.floor(points.length / 2);
  return { x: (points[mid - 1].x + points[mid].x) / 2, y: (points[mid - 1].y + points[mid].y) / 2 };
}

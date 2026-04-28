export function createInitialState(graph) {
  const expanded = new Set(graph.initialExpanded || []);
  return {
    expanded,
    direction: graph.initialDirection || "TB",
    tensorMode: graph.preferredTensorMode || "auto",
    selection: null,
  };
}

export function resolveTensorMode(direction, tensorMode) {
  if (tensorMode === "nodes" || tensorMode === "edges") {
    return tensorMode;
  }
  return direction === "TB" ? "edges" : "nodes";
}

export function materializeVisibleGraph(graph, options) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges || [];
  const expanded = options.expanded || new Set();
  const direction = options.direction || "TB";
  const tensorMode = resolveTensorMode(direction, options.tensorMode);
  const childrenByParent = buildChildrenIndex(graph.nodes);
  const pred = new Map();
  const succ = new Map();

  graph.nodes.forEach((node) => {
    pred.set(node.id, []);
    succ.set(node.id, []);
  });
  edges.forEach((edge) => {
    pred.get(edge.target)?.push(edge.source);
    succ.get(edge.source)?.push(edge.target);
  });

  const visibleNodes = [];
  const visibleNodeSet = new Set();

  graph.nodes.forEach((node) => {
    if (node.kind === "group") {
      if (areAncestorsExpanded(node.parentId, byId, expanded)) {
        visibleNodes.push({
          ...node,
          visibleParentId: findVisibleParent(node.parentId, byId, expanded),
          expanded: expanded.has(node.id),
          hasChildren: (childrenByParent.get(node.id) || []).length > 0,
        });
        visibleNodeSet.add(node.id);
      }
      return;
    }

    if (tensorMode === "nodes" && areAncestorsExpanded(node.parentId, byId, expanded)) {
      visibleNodes.push({
        ...node,
        visibleParentId: findVisibleParent(node.parentId, byId, expanded),
        expanded: false,
        hasChildren: false,
      });
      visibleNodeSet.add(node.id);
      return;
    }

    if (tensorMode === "edges" && node.kind === "op" && areAncestorsExpanded(node.parentId, byId, expanded)) {
      visibleNodes.push({
        ...node,
        visibleParentId: findVisibleParent(node.parentId, byId, expanded),
        expanded: false,
        hasChildren: false,
      });
      visibleNodeSet.add(node.id);
    }
  });

  const visibleById = new Map(visibleNodes.map((node) => [node.id, node]));

  let visibleEdges;
  let annotationsByHost;

  if (tensorMode === "nodes") {
    annotationsByHost = new Map();
    visibleEdges = materializeNodeEdges(edges, byId, expanded);
  } else {
    const edgeMode = materializeTensorEdges(graph, byId, pred, succ, expanded);
    visibleEdges = edgeMode.edges;
    annotationsByHost = edgeMode.annotationsByHost;
    visibleNodes.forEach((node) => {
      node.annotations = annotationsByHost.get(node.id) || {in: [], out: []};
    });
  }

  visibleNodes.forEach((node) => {
    if (!node.annotations) {
      node.annotations = {in: [], out: []};
    }
    const sizing = estimateNodeSizing(node, tensorMode, direction);
    Object.assign(node, sizing);
  });

  const topLevelNodeIds = visibleNodes
    .filter((node) => node.visibleParentId == null)
    .map((node) => node.id);

  return {
    id: graph.id,
    label: graph.label,
    direction,
    tensorMode,
    nodes: visibleNodes,
    edges: visibleEdges.filter((edge) => visibleById.has(edge.source) && visibleById.has(edge.target)),
    byId: visibleById,
    topLevelNodeIds,
    childrenByParent: buildChildrenIndex(visibleNodes, "visibleParentId"),
    meta: {
      sampleLabel: graph.meta?.sampleLabel || graph.label,
      description: graph.meta?.description || "",
      stats: {
        visibleNodes: visibleNodes.length,
        visibleEdges: visibleEdges.length,
        groups: visibleNodes.filter((node) => node.kind === "group").length,
        ops: visibleNodes.filter((node) => node.kind === "op").length,
        tensors: visibleNodes.filter((node) => node.kind === "tensor").length,
        annotations: visibleNodes.reduce(
          (sum, node) => sum + node.annotations.in.length + node.annotations.out.length,
          0
        ),
      },
    },
    layoutMode: graph.layoutMode || "dagre",
  };
}

function materializeNodeEdges(edges, byId, expanded) {
  const aggregated = new Map();
  edges.forEach((edge) => {
    const source = resolveVisibleRepresentative(edge.source, byId, expanded);
    const target = resolveVisibleRepresentative(edge.target, byId, expanded);
    if (!source || !target || source === target) {
      return;
    }
    const key = `${source}__${target}`;
    if (!aggregated.has(key)) {
      aggregated.set(key, {
        id: `agg_${key}`,
        source,
        target,
        kind: "structural",
        tensors: [],
        count: 0,
        data: {
          originalEdgeIds: [],
        },
      });
    }
    const next = aggregated.get(key);
    next.count += 1;
    next.data.originalEdgeIds.push(edge.id);
  });
  return [...aggregated.values()];
}

function materializeTensorEdges(graph, byId, pred, succ, expanded) {
  const aggregatedEdges = new Map();
  const annotationsByHost = new Map();

  graph.nodes.forEach((node) => {
    if (node.kind !== "tensor" && node.kind !== "boundary") {
      return;
    }

    const upstreamHosts = uniqueHosts(pred.get(node.id) || [], byId, expanded);
    const downstreamHosts = uniqueHosts(succ.get(node.id) || [], byId, expanded);
    const payload = tensorPayloadFromNode(node);

    if (upstreamHosts.length && downstreamHosts.length) {
      upstreamHosts.forEach((source) => {
        downstreamHosts.forEach((target) => {
          if (source === target) {
            return;
          }
          const key = `${source}__${target}`;
          if (!aggregatedEdges.has(key)) {
            aggregatedEdges.set(key, {
              id: `edge_${key}`,
              source,
              target,
              kind: "tensor",
              tensors: [],
              weight: 0,
              data: {},
            });
          }
          const next = aggregatedEdges.get(key);
          next.tensors.push(payload);
          next.weight += payload.size;
        });
      });
      return;
    }

    if (!upstreamHosts.length && downstreamHosts.length) {
      downstreamHosts.forEach((hostId) => addAnnotation(annotationsByHost, hostId, "in", payload));
      return;
    }

    if (upstreamHosts.length && !downstreamHosts.length) {
      upstreamHosts.forEach((hostId) => addAnnotation(annotationsByHost, hostId, "out", payload));
    }
  });

  graph.edges.forEach((edge) => {
    const sourceNode = byId.get(edge.source);
    const targetNode = byId.get(edge.target);
    if (!sourceNode || !targetNode) {
      return;
    }
    if (sourceNode.kind === "tensor" || sourceNode.kind === "boundary") {
      return;
    }
    if (targetNode.kind === "tensor" || targetNode.kind === "boundary") {
      return;
    }
    const source = resolveVisibleRepresentative(edge.source, byId, expanded);
    const target = resolveVisibleRepresentative(edge.target, byId, expanded);
    if (!source || !target || source === target) {
      return;
    }
    const key = `${source}__${target}`;
    if (!aggregatedEdges.has(key)) {
      aggregatedEdges.set(key, {
        id: `edge_${key}`,
        source,
        target,
        kind: "direct",
        tensors: [],
        weight: 1,
        data: {},
      });
    }
  });

  return {
    edges: [...aggregatedEdges.values()].map((edge) => ({
      ...edge,
      weight: Math.max(edge.weight, edge.tensors.length || 1),
      label: edge.tensors.length
        ? edge.tensors.length === 1
          ? compactTensorLabel(edge.tensors[0])
          : `${edge.tensors.length} tensors`
        : "",
    })),
    annotationsByHost,
  };
}

function addAnnotation(annotationsByHost, hostId, side, payload) {
  if (!annotationsByHost.has(hostId)) {
    annotationsByHost.set(hostId, {in: [], out: []});
  }
  const bucket = annotationsByHost.get(hostId)[side];
  if (bucket.some((item) => item.id === payload.id)) {
    return;
  }
  bucket.push(payload);
}

function tensorPayloadFromNode(node) {
  const shape = shapeString(node.data?.shape || node.data?.rawShape || node.data?.outputShape || "");
  const dtype = node.data?.dtype || "";
  const size = estimateTensorSize(node.data?.shape || node.data?.rawShape || []);
  return {
    id: node.id,
    label: node.label,
    shape,
    dtype,
    size,
    role: node.data?.role || null,
    raw: node,
  };
}

function compactTensorLabel(payload) {
  const base = payload.label.length > 18 ? `${payload.label.slice(0, 15)}...` : payload.label;
  if (payload.shape && payload.shape.length <= 18) {
    return `${base} ${payload.shape}`.trim();
  }
  return base;
}

function estimateNodeSizing(node, tensorMode, direction = "LR") {
  const coreWidth = estimateCoreWidth(node);
  const coreHeight = estimateCoreHeight(node);

  // Collapsed groups: annotations not rendered, use compact size only
  if (node.kind === "group" && !node.expanded) {
    return {coreWidth, coreHeight, displayWidth: coreWidth, displayHeight: coreHeight, inboxWidth: 0, outboxWidth: 0};
  }

  // TB mode: annotation chips go above/below, no horizontal space needed
  if (direction === "TB") {
    return {coreWidth, coreHeight, displayWidth: coreWidth, displayHeight: coreHeight, inboxWidth: 0, outboxWidth: 0};
  }

  const inWidths = node.annotations.in.map((item) => estimateAnnotationWidth(item));
  const outWidths = node.annotations.out.map((item) => estimateAnnotationWidth(item));
  const inboxWidth = tensorMode === "edges" ? (inWidths.length ? Math.max(...inWidths) + 18 : 0) : 0;
  const outboxWidth = tensorMode === "edges" ? (outWidths.length ? Math.max(...outWidths) + 18 : 0) : 0;
  const annotationHeightIn = stackedAnnotationHeight(node.annotations.in.length);
  const annotationHeightOut = stackedAnnotationHeight(node.annotations.out.length);
  const displayWidth = coreWidth + inboxWidth + outboxWidth;
  const displayHeight = Math.max(coreHeight, annotationHeightIn, annotationHeightOut);

  return {coreWidth, coreHeight, displayWidth, displayHeight, inboxWidth, outboxWidth};
}

function estimateCoreWidth(node) {
  if (Number.isFinite(Number(node.data?.width)) && (node.kind !== "group" || node.expanded)) {
    return Number(node.data.width);
  }
  if (node.kind === "group" && !node.expanded && Number.isFinite(Number(node.data?.collapsedWidth))) {
    return Number(node.data.collapsedWidth);
  }
  const labelLength = String(node.label || "").length;
  if (node.kind === "group") {
    if (node.expanded) {
      return Math.max(220, Math.min(320, 140 + labelLength * 7));
    }
    return Math.max(180, Math.min(280, 120 + labelLength * 7));
  }
  if (node.kind === "op") {
    return Math.max(154, Math.min(220, 112 + labelLength * 7));
  }
  if (node.kind === "boundary") {
    return Math.max(118, Math.min(170, 92 + labelLength * 6));
  }
  return Math.max(118, Math.min(180, 90 + labelLength * 6));
}

function estimateCoreHeight(node) {
  if (Number.isFinite(Number(node.data?.height)) && (node.kind !== "group" || node.expanded)) {
    return Number(node.data.height);
  }
  if (node.kind === "group" && !node.expanded && Number.isFinite(Number(node.data?.collapsedHeight))) {
    return Number(node.data.collapsedHeight);
  }
  if (node.kind === "group" && node.expanded) {
    return 72;
  }
  if (node.kind === "op") {
    return 44;
  }
  return 44;
}

function estimateAnnotationWidth(payload) {
  const label = compactTensorLabel(payload);
  return Math.max(68, Math.min(176, 26 + label.length * 6.2));
}

function stackedAnnotationHeight(count) {
  if (!count) {
    return 0;
  }
  return count * 18 + (count - 1) * 6;
}

function buildChildrenIndex(nodes, parentKey = "parentId") {
  const map = new Map();
  nodes.forEach((node) => {
    const parentId = node[parentKey] || null;
    if (!map.has(parentId)) {
      map.set(parentId, []);
    }
    map.get(parentId).push(node.id);
  });
  return map;
}

function areAncestorsExpanded(parentId, byId, expanded) {
  let currentId = parentId;
  while (currentId) {
    const current = byId.get(currentId);
    if (!current) {
      break;
    }
    if (current.kind === "group" && !expanded.has(current.id)) {
      return false;
    }
    currentId = current.parentId;
  }
  return true;
}

function findVisibleParent(parentId, byId, expanded) {
  let currentId = parentId;
  while (currentId) {
    const current = byId.get(currentId);
    if (!current) {
      return null;
    }
    if (current.kind === "group" && areAncestorsExpanded(current.parentId, byId, expanded)) {
      return current.id;
    }
    currentId = current.parentId;
  }
  return null;
}

function resolveVisibleRepresentative(nodeId, byId, expanded) {
  let current = byId.get(nodeId);
  if (!current) {
    return null;
  }
  // Walk all the way up to the topmost collapsed ancestor that is itself visible
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent) {
      break;
    }
    if (parent.kind === "group" && !expanded.has(parent.id)) {
      current = parent;
      continue;
    }
    break;
  }
  return current.id;
}

function uniqueHosts(nodeIds, byId, expanded) {
  const hosts = new Set();
  nodeIds.forEach((nodeId) => {
    const rep = resolveVisibleRepresentative(nodeId, byId, expanded);
    if (!rep) {
      return;
    }
    const node = byId.get(rep);
    if (!node) {
      return;
    }
    if (node.kind === "op" || node.kind === "group") {
      hosts.add(rep);
    }
  });
  return [...hosts];
}

function shapeString(shape) {
  if (typeof shape === "string") {
    return shape;
  }
  if (!Array.isArray(shape) || !shape.length) {
    return "";
  }
  return `[${shape.join(", ")}]`;
}

function estimateTensorSize(shape) {
  if (!Array.isArray(shape) || !shape.length) {
    return 1;
  }
  return shape.reduce((product, dimension) => {
    const numeric = Number(dimension);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return product;
    }
    return product * numeric;
  }, 1);
}

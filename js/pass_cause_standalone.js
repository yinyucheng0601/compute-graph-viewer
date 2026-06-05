/**
 * pass_cause_standalone.js - Minimal Pass Cause Explainer page.
 */
(function () {
  const state = {
    navIndex: null,
    navigatorIndex: null,
    pairs: [],
    pairResults: new Map(),
    activeResult: null,
    sourceGraph: null,
    sourceLayout: null,
    groupedGraph: null,
    groupedLayout: null,
    currentGraph: null,
    currentLayout: null,
    currentLoadInfo: null,
    currentColorMap: null,
    localFileRefs: new Map(),
    graphCache: new Map(),
    tx: 0,
    ty: 0,
    scale: 1,
    currentSide: 'after',
    viewMode: 'original',
    colorMode: 'semantic',
    syncingNav: false,
    panning: false,
    panStart: null,
    renderCache: null,
    renderedGraph: null,
    virtualRenderWindow: null,
    viewportRenderRaf: 0,
    viewportRenderForce: false,
    focusTransitionTimer: 0,
    lastVirtualRenderScale: 1,
    hugeGraphMode: false,
    edgesHiddenByScale: false,
    diffEmphasisNodes: new Set(),
    diffEmphasisEdges: new Set(),
    memberToGroupId: new Map(),
  };

  const HUGE_GRAPH_NODE_THRESHOLD = 1200;
  const HUGE_GRAPH_EDGE_THRESHOLD = 2400;
  const HUGE_EDGE_HIDE_SCALE = 0.18;
  const VIRTUAL_BUFFER_SCREEN_PX = 460;
  const VIRTUAL_SCALE_FORCE_DELTA = 0.12;
  const FOCUS_TRANSITION_MS = 980;
  const MAX_AUTOSTART_SCAN = 36;
  const GROUP_DETAIL_NODE_THRESHOLD = 5000;
  const GROUP_DETAIL_EDGE_THRESHOLD = 10000;

  const AUTOSTART = [
    { passName: 'RemoveRedundantOp', pathId: 'PATH0_6' },
    { passName: 'MergeViewAssemble', pathId: 'PATH0_6' },
    { passName: 'RemoveRedundantReshape', pathId: 'PATH0_6' },
    { passName: 'DuplicateOp', pathId: 'PATH0_6' },
    { passName: 'CommonOperationEliminate', pathId: 'PATH0_6' },
    { passName: 'SplitReshape', pathId: 'PATH0_6' },
  ];

  const els = {
    openBtn: document.getElementById('openPassFolderBtn'),
    dirInput: document.getElementById('passFolderInput'),
    passFilterSelect: document.getElementById('passFilterSelect'),
    pairSelect: document.getElementById('pairSelect'),
    viewport: document.getElementById('explainViewport'),
    graphRoot: document.getElementById('explainGraphRoot'),
    nodesLayer: document.getElementById('nodesLayer'),
    edgesSvg: document.getElementById('edgesSvg'),
    emptyState: document.getElementById('explainEmptyState'),
    ghostTray: document.getElementById('passCauseGhostTray'),
    fitBtn: document.getElementById('fitExplainBtn'),
    beforeBtn: document.getElementById('showBeforeBtn'),
    afterBtn: document.getElementById('showAfterBtn'),
    colorModeBtn: document.getElementById('colorModeBtn'),
    colorModeLabel: document.getElementById('colorModeLabel'),
    colorModeMenu: document.getElementById('colorModeMenu'),
    groupViewBtn: document.getElementById('groupViewBtn'),
    legend: document.getElementById('legend'),
  };

  function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/');
  }

  function normalizePassName(value) {
    return window.PtoPassCausePairs?.normalizePassName?.(value) || String(value || '').replace(/\d+$/g, '');
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text || '';
  }

  function sideForRef(fileRef) {
    const pair = state.activeResult?.pair;
    if (!pair || !fileRef) return state.currentSide;
    if (fileRef === pair.beforeRef?.ref) return 'before';
    if (fileRef === pair.afterRef?.ref) return 'after';
    return state.currentSide;
  }

  function graphRefName(ref) {
    return String(ref || '').replace(/^local::/, '').split('/').pop();
  }

  function readJsonRef(fileRef) {
    const localFile = state.localFileRefs.get(fileRef);
    if (localFile) return localFile.text().then(text => JSON.parse(text));
    return fetch(fileRef).then(response => {
      if (!response.ok) throw new Error(`读取 ${fileRef} 失败：${response.status}`);
      return response.json();
    });
  }

  function edgeId(edge) {
    return `${edge.source}->${edge.target}`;
  }

  function isHugeGraph(graph) {
    const nodeCount = graph?.nodes?.length || 0;
    const edgeCount = graph?.edges?.length || 0;
    return nodeCount >= HUGE_GRAPH_NODE_THRESHOLD || edgeCount >= HUGE_GRAPH_EDGE_THRESHOLD;
  }

  function updateHugeGraphMode(graph) {
    const next = isHugeGraph(graph);
    state.hugeGraphMode = next;
    document.body.classList.toggle('huge-graph-mode', next);
  }

  function updateEdgeVisibilityByScale() {
    if (!els.edgesSvg) return false;
    const shouldHide = state.hugeGraphMode && state.scale < HUGE_EDGE_HIDE_SCALE;
    if (shouldHide === state.edgesHiddenByScale) return false;
    state.edgesHiddenByScale = shouldHide;
    els.edgesSvg.classList.toggle('is-hidden', shouldHide);
    return true;
  }

  function shouldVirtualizeGraph() {
    return !!(state.hugeGraphMode && state.currentGraph && state.currentLayout && els.viewport);
  }

  function getViewportGraphRect() {
    const safeScale = Math.max(state.scale, 1e-6);
    const left = -state.tx / safeScale;
    const top = -state.ty / safeScale;
    const width = els.viewport.clientWidth / safeScale;
    const height = els.viewport.clientHeight / safeScale;
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    };
  }

  function expandRect(rect, pad) {
    return {
      left: rect.left - pad,
      top: rect.top - pad,
      right: rect.right + pad,
      bottom: rect.bottom + pad,
    };
  }

  function rectContainsRect(outer, inner) {
    if (!outer || !inner) return false;
    return inner.left >= outer.left
      && inner.top >= outer.top
      && inner.right <= outer.right
      && inner.bottom <= outer.bottom;
  }

  function buildVirtualizedGraph(force = false) {
    if (!shouldVirtualizeGraph()) {
      state.renderedGraph = state.currentGraph;
      state.virtualRenderWindow = null;
      return state.currentGraph;
    }

    const viewportRect = getViewportGraphRect();
    const scaleDelta = Math.abs(state.scale - state.lastVirtualRenderScale) / Math.max(1e-6, state.lastVirtualRenderScale);
    if (!force && state.virtualRenderWindow && rectContainsRect(state.virtualRenderWindow, viewportRect) && scaleDelta < VIRTUAL_SCALE_FORCE_DELTA) {
      return null;
    }

    const pad = VIRTUAL_BUFFER_SCREEN_PX / Math.max(state.scale, 1e-6);
    const renderWindow = expandRect(viewportRect, pad);
    const visibleNodes = [];
    const visibleNodeIds = new Set();
    const positions = state.currentLayout.positions;

    for (const node of state.currentGraph.nodes || []) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const intersects = pos.x <= renderWindow.right
        && pos.x + pos.w >= renderWindow.left
        && pos.y <= renderWindow.bottom
        && pos.y + pos.h >= renderWindow.top;
      if (!intersects) continue;
      visibleNodes.push(node);
      visibleNodeIds.add(node.id);
    }

    const visibleEdges = [];
    if (!state.edgesHiddenByScale) {
      for (const edge of state.currentGraph.edges || []) {
        if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue;
        visibleEdges.push(edge);
      }
    }

    state.renderedGraph = {
      nodes: visibleNodes,
      edges: visibleEdges,
      meta: state.currentGraph.meta,
    };
    state.virtualRenderWindow = renderWindow;
    state.lastVirtualRenderScale = state.scale;
    return state.renderedGraph;
  }

  function clearDiffDimming() {
    els.graphRoot?.classList.remove('is-after-diff-dim');
    state.diffEmphasisNodes.forEach(el => el.classList.remove('cause-diff-emphasis'));
    state.diffEmphasisEdges.forEach(el => el.classList.remove('cause-diff-emphasis'));
    state.diffEmphasisNodes.clear();
    state.diffEmphasisEdges.clear();
  }

  function nodeElementById(nodeId) {
    return state.renderCache?.nodeElementsById?.get(nodeId) || null;
  }

  function edgeElementsById(id) {
    return state.renderCache?.edgeElementsById?.get(id) || [];
  }

  function shapeSignature(shape) {
    if (!Array.isArray(shape) || !shape.length) return '[]';
    return `[${shape.join(',')}]`;
  }

  function tensorRole(node) {
    if (node?.type === 'incast') return 'input-contract';
    if (node?.type === 'outcast') return 'output-contract';
    const symbol = String(node?.data?.symbol || node?.label || '').toUpperCase();
    if (symbol.startsWith('IN_') || symbol.startsWith('INCAST')) return 'input-contract';
    if (symbol.startsWith('OUT_') || symbol.startsWith('OUTCAST')) return 'output-contract';
    if (!symbol) return 'state/intermediate';
    return 'intermediate';
  }

  function tensorSemanticTitle(node) {
    const role = tensorRole(node);
    if (role === 'input-contract') return 'Input Tensor';
    if (role === 'output-contract') return 'Output Tensor';
    if (role === 'state/intermediate') return 'State Tensor';
    return 'Intermediate Tensor';
  }

  function resolvedSemanticLabel(node) {
    const d = node?.data || {};
    return d.semanticLabel || d.inferredSemanticLabel || null;
  }

  function semanticKeyForNode(node) {
    if (window.PtoPassCauseSemantic?.semanticKeyForNode) {
      return window.PtoPassCauseSemantic.semanticKeyForNode(node);
    }
    if (!node) return null;
    if (node.type === 'group') return node.data?.semanticKey || (node.data?.groupType === 'tensor' ? 'tensor' : null);
    if (node.type === 'op') return resolvedSemanticLabel(node) ? `sem:${resolvedSemanticLabel(node)}` : `op:${node.data?.opcode || node.label || 'OP'}`;
    if (node.type === 'incast') return 'boundary:incast';
    if (node.type === 'outcast') return 'boundary:outcast';
    return 'tensor';
  }

  function semanticLabelFromKey(key) {
    if (!key) return '';
    if (key.startsWith('sem:')) return key.slice(4);
    if (key.startsWith('cat:')) return key.slice(4);
    if (key.startsWith('op:')) return key.slice(3);
    if (key === 'tensor') return 'Tensor';
    if (key === 'boundary:incast') return 'Graph Input';
    if (key === 'boundary:outcast') return 'Graph Output';
    return key;
  }

  function opFingerprint(node) {
    const d = node?.data || {};
    const attrs = Object.keys(d.opAttr || {}).sort().join(',');
    const inArity = Array.isArray(d.ioperands) ? d.ioperands.length : 0;
    const outArity = Array.isArray(d.ooperands) ? d.ooperands.length : 0;
    return [
      `opcode=${String(d.opcode || node.label || 'OP')}`,
      `arity=${inArity}->${outArity}`,
      `attrs=${attrs}`,
      `out=${shapeSignature(d.outShape)}`,
      `semantic=${String(resolvedSemanticLabel(node) || '-')}`,
    ].join('|');
  }

  function tensorFingerprint(node) {
    const d = node?.data || {};
    return [
      `role=${tensorRole(node)}`,
      `dtype=${String(d.dtype || '?')}`,
      `shape=${shapeSignature(d.shape)}`,
      `kind=${String(d.kind ?? '-')}`,
    ].join('|');
  }

  function pickDominantValue(values) {
    const counts = new Map();
    let winner = null;
    let winnerCount = 0;
    values.forEach(value => {
      if (value == null || value === '') return;
      const next = (counts.get(value) || 0) + 1;
      counts.set(value, next);
      if (next > winnerCount) {
        winner = value;
        winnerCount = next;
      }
    });
    return winner;
  }

  function summarizeLatency(values) {
    const nums = values.filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    if (!nums.length) return { avg: null, max: null, total: null };
    const total = nums.reduce((sum, value) => sum + value, 0);
    return { avg: total / nums.length, max: Math.max(...nums), total };
  }

  function formatCycles(value) {
    if (value == null || !Number.isFinite(value)) return '';
    return `${Math.round(value).toLocaleString()} cy`;
  }

  function topoSortGraph(graph) {
    const nodeIds = (graph?.nodes || []).map(node => node.id);
    const incomingByTarget = new Map(nodeIds.map(id => [id, []]));
    const outgoingBySource = new Map(nodeIds.map(id => [id, []]));
    const indegree = new Map(nodeIds.map(id => [id, 0]));

    (graph?.edges || []).forEach(edge => {
      if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
      if (!outgoingBySource.has(edge.source)) outgoingBySource.set(edge.source, []);
      incomingByTarget.get(edge.target).push(edge.source);
      outgoingBySource.get(edge.source).push(edge.target);
      indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    });

    const queue = [];
    indegree.forEach((degree, id) => {
      if (degree === 0) queue.push(id);
    });

    const topo = [];
    while (queue.length) {
      const id = queue.shift();
      topo.push(id);
      (outgoingBySource.get(id) || []).forEach(nextId => {
        const nextDegree = (indegree.get(nextId) || 0) - 1;
        indegree.set(nextId, nextDegree);
        if (nextDegree === 0) queue.push(nextId);
      });
    }

    if (topo.length !== nodeIds.length) {
      const seen = new Set(topo);
      nodeIds.forEach(id => {
        if (!seen.has(id)) topo.push(id);
      });
    }
    return { topo, incomingByTarget, outgoingBySource };
  }

  function annotateFlowSignatures(graph) {
    window.PtoPassCauseSemantic?.annotateGraph?.(graph);
    if (!graph?.nodes?.length) return graph;
    const nodeMap = new Map(graph.nodes.map(node => [node.id, node]));
    const { topo, incomingByTarget, outgoingBySource } = topoSortGraph(graph);
    const upstreamByNodeId = new Map();
    const downstreamByNodeId = new Map();

    topo.forEach(nodeId => {
      const node = nodeMap.get(nodeId);
      const boundarySet = new Set();
      if (node?.type === 'incast') boundarySet.add(nodeId);
      (incomingByTarget.get(nodeId) || []).forEach(prevId => {
        (upstreamByNodeId.get(prevId) || []).forEach(boundaryId => boundarySet.add(boundaryId));
      });
      upstreamByNodeId.set(nodeId, boundarySet);
    });

    [...topo].reverse().forEach(nodeId => {
      const node = nodeMap.get(nodeId);
      const boundarySet = new Set();
      if (node?.type === 'outcast') boundarySet.add(nodeId);
      (outgoingBySource.get(nodeId) || []).forEach(nextId => {
        (downstreamByNodeId.get(nextId) || []).forEach(boundaryId => boundarySet.add(boundaryId));
      });
      downstreamByNodeId.set(nodeId, boundarySet);
    });

    graph.nodes.forEach(node => {
      if (!node.data) node.data = {};
      const upstream = [...(upstreamByNodeId.get(node.id) || [])].sort();
      const downstream = [...(downstreamByNodeId.get(node.id) || [])].sort();
      node.data.upstreamBoundaryIds = upstream;
      node.data.downstreamBoundaryIds = downstream;
      node.data.flowSignature = `u:${upstream.join(',') || '-'}|d:${downstream.join(',') || '-'}`;
    });
    return graph;
  }

  function buildGroupMemberRef(member) {
    return {
      nodeId: member.id,
      type: member.type,
      label: member.label,
      semanticKey: semanticKeyForNode(member),
      semanticLabel: resolvedSemanticLabel(member),
      subgraphId: member.data?.subgraphId ?? null,
      latency: member.data?.latency ?? null,
    };
  }

  function makeGroupNode(groupId, bucket, members) {
    const rep = members[0];
    const isOpGroup = bucket.nodeType === 'op';
    const d = rep?.data || {};
    const memberRefs = members.map(buildGroupMemberRef);
    const semanticKey = isOpGroup ? pickDominantValue(memberRefs.map(member => member.semanticKey)) : 'tensor';
    const subgraphId = isOpGroup ? pickDominantValue(memberRefs.map(member => member.subgraphId)) : null;
    const latency = summarizeLatency(memberRefs.map(member => member.latency));

    let title = 'Group';
    let rows = [];
    if (isOpGroup) {
      const inArity = Array.isArray(d.ioperands) ? d.ioperands.length : 0;
      const outArity = Array.isArray(d.ooperands) ? d.ooperands.length : 0;
      title = String(d.opcode || rep.label || 'Op Cluster');
      rows = [
        ['opcode', String(d.opcode || rep.label || '-')],
        ['arity', `${inArity}->${outArity}`],
      ];
      if (semanticKey) rows.push(['semantic', semanticLabelFromKey(semanticKey)]);
      if (subgraphId != null) rows.push(['sg', `SG·${subgraphId}`]);
      if (latency.avg != null) rows.push(['lat(avg)', formatCycles(latency.avg)]);
    } else {
      title = tensorSemanticTitle(rep);
      rows = [
        ['role', tensorRole(rep)],
        ['dtype', String(d.dtype || '-')],
        ['shape', shapeSignature(d.shape)],
      ];
    }

    return {
      id: groupId,
      type: 'group',
      label: title,
      subLabel: title,
      data: {
        magic: -1,
        kind: 'cluster',
        groupType: isOpGroup ? 'op' : 'tensor',
        title,
        count: members.length,
        members: memberRefs,
        rows,
        layer: bucket.layer,
        clusterKey: bucket.key,
        semanticKey,
        semanticLabel: semanticLabelFromKey(semanticKey),
        flowSignature: bucket.flowSignature,
        subgraphId,
        latency: latency.avg != null ? Math.round(latency.avg) : null,
        latencyMax: latency.max != null ? Math.round(latency.max) : null,
        latencyTotal: latency.total != null ? Math.round(latency.total) : null,
        groupReason: bucket.flowSignature ? 'same flow signature + same local structure' : 'same local structure',
      },
    };
  }

  function buildGroupedGraphModel(baseGraph, baseLayout) {
    state.memberToGroupId = new Map();
    if (!baseGraph?.nodes?.length) return null;

    const layerByNodeId = new Map();
    (baseLayout?.layerNodes || []).forEach((ids, layerIdx) => {
      (ids || []).forEach(nodeId => layerByNodeId.set(nodeId, layerIdx));
    });

    const buckets = new Map();
    for (const node of baseGraph.nodes) {
      if (node.type !== 'op' && node.type !== 'tensor') continue;
      const layerIdx = layerByNodeId.get(node.id) ?? 0;
      const fp = node.type === 'op' ? opFingerprint(node) : tensorFingerprint(node);
      const flowSignature = node.data?.flowSignature || 'flow:-';
      const key = `${layerIdx}|${node.type}|${fp}|${flowSignature}`;
      if (!buckets.has(key)) {
        buckets.set(key, { key, layer: layerIdx, nodeType: node.type, flowSignature, memberIds: [] });
      }
      buckets.get(key).memberIds.push(node.id);
    }

    const selected = [...buckets.values()].filter(bucket => bucket.memberIds.length >= 2);
    if (!selected.length) return null;

    const baseNodeMap = new Map(baseGraph.nodes.map(node => [node.id, node]));
    const nodeToGroupId = new Map();
    const groupedNodes = [];
    const usedIds = new Set(baseGraph.nodes.map(node => node.id));
    let seq = 0;

    selected.forEach(bucket => {
      let groupId = `group_auto_${bucket.layer}_${seq++}`;
      while (usedIds.has(groupId)) groupId = `group_auto_${bucket.layer}_${seq++}`;
      usedIds.add(groupId);

      const members = bucket.memberIds.map(id => baseNodeMap.get(id)).filter(Boolean);
      if (members.length < 2) return;
      members.forEach(member => {
        nodeToGroupId.set(member.id, groupId);
        state.memberToGroupId.set(member.id, groupId);
      });
      groupedNodes.push(makeGroupNode(groupId, bucket, members));
    });

    if (!groupedNodes.length) return null;

    const finalNodes = [];
    for (const node of baseGraph.nodes) {
      if (!nodeToGroupId.has(node.id)) finalNodes.push(node);
    }
    finalNodes.push(...groupedNodes);

    const edgeMap = new Map();
    for (const edge of baseGraph.edges || []) {
      const source = nodeToGroupId.get(edge.source) || edge.source;
      const target = nodeToGroupId.get(edge.target) || edge.target;
      if (source === target) continue;
      const key = `${source}@@${target}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { source, target, weight: 0 });
      edgeMap.get(key).weight += 1;
    }

    const countType = type => finalNodes.filter(node => node.type === type).length;
    return {
      nodes: finalNodes,
      edges: [...edgeMap.values()],
      meta: {
        ...baseGraph.meta,
        totalNodes: finalNodes.length,
        totalEdges: edgeMap.size,
        incastCount: countType('incast'),
        outcastCount: countType('outcast'),
        opCount: countType('op'),
        tensorCount: countType('tensor'),
        groupCount: countType('group'),
      },
    };
  }

  function computeGraphLayout(graph, options = {}) {
    const nodeCount = graph?.nodes?.length || 0;
    const edgeCount = graph?.edges?.length || 0;
    const compact = options.preferDetail
      ? (nodeCount >= GROUP_DETAIL_NODE_THRESHOLD || edgeCount >= GROUP_DETAIL_EDGE_THRESHOLD)
      : isHugeGraph(graph);
    const layout = computeLayout(graph, { nodeWidth: 225, compact });
    layout.compact = compact;
    return layout;
  }

  function subgraphKeyForNode(node, tensorToSg) {
    if (!node) return null;
    if (node.type === 'incast' || node.type === 'outcast') return 'boundary';
    if (node.type === 'op') return node.data?.subgraphId != null ? `sg_${node.data.subgraphId}` : 'sg_input';
    if (node.type === 'group') {
      if (node.data?.groupType === 'op') return node.data?.subgraphId != null ? `sg_${node.data.subgraphId}` : 'sg_input';
      const sgId = node.data?.subgraphId ?? tensorToSg?.get(node.id);
      return sgId != null ? `sg_${sgId}` : 'sg_input';
    }
    const sgId = tensorToSg?.get(node.id);
    return sgId != null ? `sg_${sgId}` : 'sg_input';
  }

  function buildTensorToSubgraphMap(graph) {
    const nodeMap = new Map((graph?.nodes || []).map(node => [node.id, node]));
    const tensorToSg = new Map();
    (graph?.edges || []).forEach(edge => {
      const source = nodeMap.get(edge.source);
      const key = subgraphKeyForNode(source, tensorToSg);
      if (key?.startsWith('sg_')) tensorToSg.set(edge.target, Number(key.slice(3)));
    });
    return tensorToSg;
  }

  function applyGroupMemberColors(graph, mode) {
    if (!graph?.nodes?.length) return;
    let semanticPalette = null;
    let subgraphPalette = null;

    if (mode === 'semantic' && typeof buildColorMap === 'function') {
      const keys = [];
      graph.nodes.forEach(node => {
        if (node.type === 'group' && Array.isArray(node.data?.members)) {
          node.data.members.forEach(member => {
            if (member.semanticKey) keys.push(member.semanticKey);
          });
        }
      });
      semanticPalette = buildColorMap([...new Set(keys)]);
    } else if (mode === 'subgraph' && typeof buildColorMap === 'function') {
      const keys = new Set();
      graph.nodes.forEach(node => {
        if (node.type !== 'group' || !Array.isArray(node.data?.members)) return;
        node.data.members.forEach(member => {
          if (member.type === 'incast' || member.type === 'outcast') keys.add('boundary');
          else if (member.subgraphId != null) keys.add(`sg_${member.subgraphId}`);
          else keys.add('sg_input');
        });
      });
      subgraphPalette = buildColorMap([...keys]);
    }

    graph.nodes.forEach(node => {
      if (node.type !== 'group' || !Array.isArray(node.data?.members)) return;
      node.data.members.forEach(member => {
        let nextColor = null;
        if (mode === 'semantic') {
          nextColor = member.semanticKey === 'tensor'
            ? '#727272'
            : semanticPalette?.get(member.semanticKey);
        } else if (mode === 'subgraph') {
          let key = 'sg_input';
          if (member.type === 'incast' || member.type === 'outcast') key = 'boundary';
          else if (member.subgraphId != null) key = `sg_${member.subgraphId}`;
          nextColor = subgraphPalette?.get(key);
        } else if (mode === 'latency') {
          nextColor = member.latency != null && typeof latencyToColor === 'function' ? latencyToColor(member.latency) : '#727272';
        }
        member.color = nextColor || (member.type === 'tensor' ? '#727272' : '#666666');
      });
    });
  }

  function semanticColorMap(graph) {
    if (window.PtoPassCauseSemantic?.buildNodeColorMap) {
      return window.PtoPassCauseSemantic.buildNodeColorMap(graph);
    }
    if (typeof buildColorMap !== 'function' || typeof getSemanticKey !== 'function') return null;
    const keyMap = buildColorMap((graph.nodes || []).map(node => getSemanticKey(node)));
    const nodeMap = new Map();
    (graph.nodes || []).forEach(node => nodeMap.set(node.id, keyMap.get(getSemanticKey(node))));
    return nodeMap;
  }

  function buildNodeColorMap(graph) {
    const mode = state.colorMode;
    if (!graph || mode === 'none') return null;
    applyGroupMemberColors(graph, mode);
    if (mode === 'semantic') return semanticColorMap(graph);
    if (mode === 'latency') {
      const map = new Map();
      (graph.nodes || []).forEach(node => {
        const latency = node.type === 'op' || node.type === 'group' ? node.data?.latency : null;
        const color = latency != null && typeof latencyToColor === 'function'
          ? latencyToColor(latency)
          : null;
        if (color) map.set(node.id, color);
        else if (node.type === 'tensor' || node.type === 'group') map.set(node.id, '#727272');
      });
      return map;
    }
    if (mode === 'subgraph') {
      const tensorToSg = buildTensorToSubgraphMap(graph);
      const keys = (graph.nodes || []).map(node => subgraphKeyForNode(node, tensorToSg)).filter(Boolean);
      const palette = typeof buildColorMap === 'function' ? buildColorMap(keys) : new Map();
      const map = new Map();
      (graph.nodes || []).forEach(node => {
        const key = subgraphKeyForNode(node, tensorToSg);
        if (key) map.set(node.id, palette.get(key));
      });
      return map;
    }
    return null;
  }

  function legendLabel(key) {
    if (key === 'tensor') return 'Tensor';
    if (key === 'boundary:incast') return 'Graph Input';
    if (key === 'boundary:outcast') return 'Graph Output';
    if (key === 'boundary') return 'Boundary';
    if (key === 'sg_input') return 'Unassigned';
    if (key?.startsWith?.('sg_')) return `SG · ${key.slice(3)}`;
    if (key?.startsWith?.('sem:')) return key.slice(4).replace(/-/g, ' ');
    if (key?.startsWith?.('cat:')) return key.slice(4);
    if (key?.startsWith?.('op:')) return key.slice(3);
    return key || 'Unknown';
  }

  function updateLegend() {
    if (!els.legend) return;
    const graph = state.currentGraph;
    const mode = state.colorMode;
    const grouped = state.viewMode === 'grouped' && !!state.groupedGraph;

    if (!graph || mode === 'none' || !state.currentColorMap) {
      els.legend.innerHTML = `
        <span class="mode-panel-legend-item"><span class="mode-panel-legend-dot legend-dot-incast"></span><span class="mode-panel-legend-label">Incast</span></span>
        <span class="mode-panel-legend-item"><span class="mode-panel-legend-dot legend-dot-op"></span><span class="mode-panel-legend-label">Op</span></span>
        <span class="mode-panel-legend-item"><span class="mode-panel-legend-dot legend-dot-tensor"></span><span class="mode-panel-legend-label">Tensor</span></span>
        ${grouped ? '<span class="mode-panel-legend-item"><span class="mode-panel-legend-dot legend-dot-group"></span><span class="mode-panel-legend-label">Group</span></span>' : ''}
        <span class="mode-panel-legend-item"><span class="mode-panel-legend-dot legend-dot-outcast"></span><span class="mode-panel-legend-label">Outcast</span></span>
      `;
      return;
    }

    if (mode === 'latency') {
      const values = (graph.nodes || [])
        .map(node => (node.type === 'op' || node.type === 'group') ? node.data?.latency : null)
        .filter(value => value != null && Number.isFinite(value) && value > 0);
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;
      const fmt = value => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K cy` : `${value} cy`;
      els.legend.innerHTML = `
        <span class="mode-panel-legend-item" style="display:block;">
          <span class="legend-gradient" style="display:block; max-width:none;"></span>
          <span class="legend-scale"><span>${fmt(min)}</span><span>${fmt(max)}</span></span>
        </span>
      `;
      return;
    }

    const keyData = new Map();
    const tensorToSg = mode === 'subgraph' ? buildTensorToSubgraphMap(graph) : null;
    (graph.nodes || []).forEach(node => {
      let key = null;
      if (mode === 'semantic') {
        key = semanticKeyForNode(node);
        if (key === 'tensor' || key === 'boundary:incast' || key === 'boundary:outcast') return;
      } else if (mode === 'subgraph') {
        if (node.type === 'tensor') return;
        key = node.type === 'group' && node.data?.groupType !== 'op' ? null : subgraphKeyForNode(node, tensorToSg);
      }
      if (!key) return;
      const color = state.currentColorMap.get(node.id);
      if (!color) return;
      if (!keyData.has(key)) keyData.set(key, { color, count: 0 });
      keyData.get(key).count += 1;
    });

    const rows = [...keyData.entries()].slice(0, 12);
    const extra = Math.max(0, keyData.size - rows.length);
    els.legend.innerHTML = rows.map(([key, stat]) => `
      <span class="mode-panel-legend-item">
        <span class="mode-panel-legend-dot" style="background:${stat.color}"></span>
        <span class="mode-panel-legend-label">${legendLabel(key)}</span>
        <span class="mode-panel-legend-count">(${stat.count})</span>
      </span>
    `).join('') + (extra ? `<span class="mode-panel-legend-item">+${extra}</span>` : '');
  }

  function syncColorControls() {
    if (els.colorModeLabel) els.colorModeLabel.textContent = colorModeLabel(state.colorMode);
    els.colorModeMenu?.querySelectorAll('[data-color-mode]').forEach(btn => {
      btn.classList.toggle('is-selected', btn.dataset.colorMode === state.colorMode);
    });
    if (els.groupViewBtn) {
      const hasGrouped = !!(state.groupedGraph && state.groupedGraph.nodes?.some(node => node.type === 'group'));
      const grouped = state.viewMode === 'grouped';
      els.groupViewBtn.disabled = !hasGrouped;
      els.groupViewBtn.classList.toggle('is-selected', grouped);
      els.groupViewBtn.setAttribute('aria-pressed', grouped ? 'true' : 'false');
      els.groupViewBtn.title = hasGrouped
        ? (grouped ? '切回原始视图' : '切到聚合视图')
        : '当前图没有可聚合节点';
    }
  }

  function updateModeAvailability() {
    const source = state.sourceGraph;
    const hasGrouped = !!(state.groupedGraph && state.groupedGraph.nodes?.some(node => node.type === 'group'));
    const hasLatency = !!source?.nodes?.some(node => node.type === 'op' && node.data?.latency != null);
    const hasSubgraph = !!source?.nodes?.some(node => node.type === 'op' && node.data?.subgraphId != null && node.data.subgraphId >= 0);
    els.colorModeMenu?.querySelectorAll('[data-color-mode="latency"]').forEach(btn => {
      btn.disabled = !hasLatency;
    });
    els.colorModeMenu?.querySelectorAll('[data-color-mode="subgraph"]').forEach(btn => {
      btn.disabled = !hasSubgraph;
    });
    if (!hasGrouped && state.viewMode === 'grouped') state.viewMode = 'original';
    if (!hasLatency && state.colorMode === 'latency') state.colorMode = 'semantic';
    if (!hasSubgraph && state.colorMode === 'subgraph') state.colorMode = 'semantic';
    syncColorControls();
  }

  function afterChangedSets(result) {
    const changedNodes = new Set();
    const changedEdges = new Set();
    const diff = result?.diff;
    if (!diff) return { changedNodes, changedEdges };

    (diff.nodes.added || []).forEach(node => changedNodes.add(node.id));
    (diff.nodes.modified || []).forEach(item => changedNodes.add(item.id || item.after?.id));
    (diff.edges.added || []).forEach(edge => {
      changedEdges.add(edgeId(edge));
      changedNodes.add(edge.source);
      changedNodes.add(edge.target);
    });
    (diff.rewires || []).forEach(item => {
      if (item.afterInputTensorId) changedNodes.add(item.afterInputTensorId);
      if (item.consumerOpId) changedNodes.add(item.consumerOpId);
      (item.edgeIds || []).forEach(id => changedEdges.add(id));
    });

    return { changedNodes, changedEdges };
  }

  function applyDiffDimming(side) {
    clearDiffDimming();

    if (side !== 'after' || !state.activeResult?.diff) return;
    const activeAfterRef = state.activeResult?.pair?.afterRef?.ref || null;
    if (activeAfterRef && state.currentLoadInfo?.fileRef && state.currentLoadInfo.fileRef !== activeAfterRef) return;
    const { changedNodes, changedEdges } = afterChangedSets(state.activeResult);

    els.graphRoot?.classList.add('is-after-diff-dim');
    changedNodes.forEach(nodeId => {
      const el = nodeElementById(resolveRenderNodeId(nodeId));
      if (!el) return;
      el.classList.add('cause-diff-emphasis');
      state.diffEmphasisNodes.add(el);
    });
    changedEdges.forEach(id => {
      edgeElementsById(id).forEach(el => {
        el.classList.add('cause-diff-emphasis');
        state.diffEmphasisEdges.add(el);
      });
    });
  }

  function renderViewportGraph({ force = false, dispatch = true } = {}) {
    if (!state.currentGraph || !state.currentLayout) return;
    if (state.viewportRenderRaf) {
      cancelAnimationFrame(state.viewportRenderRaf);
      state.viewportRenderRaf = 0;
      state.viewportRenderForce = false;
    }
    const graphToRender = shouldVirtualizeGraph() ? buildVirtualizedGraph(force) : state.currentGraph;
    if (!graphToRender) return;
    state.renderCache = renderGraph(
      graphToRender,
      state.currentLayout,
      els.nodesLayer,
      els.edgesSvg,
      () => {},
      state.currentColorMap,
      state.colorMode,
      { compact: !!state.currentLayout.compact, delegateEvents: true }
    );
    applyDiffDimming(state.currentSide);
    updateLegend();
    if (dispatch) {
      window.dispatchEvent(new CustomEvent('pto-pass-ir:graph-rendered', {
        detail: { side: state.currentSide, loadInfo: state.currentLoadInfo },
      }));
    }
  }

  function scheduleViewportRender(force = false) {
    if (!shouldVirtualizeGraph()) return;
    if (force) state.viewportRenderForce = true;
    if (state.viewportRenderRaf) return;
    state.viewportRenderRaf = requestAnimationFrame(() => {
      const forceNow = state.viewportRenderForce;
      state.viewportRenderForce = false;
      state.viewportRenderRaf = 0;
      renderViewportGraph({ force: forceNow });
    });
  }

  function graphForViewMode() {
    if (state.viewMode === 'grouped' && state.groupedGraph && state.groupedLayout) {
      return { graph: state.groupedGraph, layout: state.groupedLayout };
    }
    return { graph: state.sourceGraph, layout: state.sourceLayout };
  }

  function ensureMagicMoveLayer() {
    let layer = document.getElementById('passMagicMoveLayer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'passMagicMoveLayer';
      layer.className = 'pass-magic-ghost-layer';
      els.graphRoot?.appendChild(layer);
    }
    return layer;
  }

  function captureTransitionSnapshot() {
    if (!state.currentLayout?.positions || !state.renderCache?.nodeElementsById) return null;
    const positions = new Map();
    const ghosts = new Map();
    state.renderCache.nodeElementsById.forEach((el, nodeId) => {
      if (!el || !state.currentLayout.positions.has(nodeId)) return;
      const pos = state.currentLayout.positions.get(nodeId);
      positions.set(nodeId, { x: pos.x, y: pos.y });
      const clone = el.cloneNode(true);
      clone.classList.add('pass-magic-ghost-node');
      clone.style.left = el.style.left;
      clone.style.top = el.style.top;
      clone.style.width = el.style.width;
      clone.style.height = el.style.height;
      ghosts.set(nodeId, clone);
    });
    return positions.size ? { positions, ghosts } : null;
  }

  function animateNodeLayoutTransition(snapshot, durationMs = 860) {
    const previousPositions = snapshot?.positions || snapshot;
    if (!previousPositions || !state.currentLayout?.positions || !state.renderCache?.nodeElementsById) return;
    const easing = 'var(--easing-out)';
    const animated = [];
    const fadedEdges = [];
    const ghostLayer = snapshot?.ghosts ? ensureMagicMoveLayer() : null;
    const nextNodeIds = new Set(state.currentLayout.positions.keys());

    if (ghostLayer && snapshot.ghosts) {
      snapshot.ghosts.forEach((clone, nodeId) => {
        if (nextNodeIds.has(nodeId)) return;
        clone.classList.add('is-fading-out');
        ghostLayer.appendChild(clone);
        requestAnimationFrame(() => clone.classList.add('is-exiting'));
        setTimeout(() => clone.remove(), durationMs + 180);
      });
    }

    state.renderCache.nodeElementsById.forEach((el, nodeId) => {
      if (!el || !state.currentLayout.positions.has(nodeId)) return;
      const next = state.currentLayout.positions.get(nodeId);
      const prev = previousPositions.get(nodeId);

      if (prev) {
        const dx = prev.x - next.x;
        const dy = prev.y - next.y;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        el.classList.add('pass-magic-move-node');
        el.style.transition = 'none';
        el.style.willChange = 'transform, opacity';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      } else {
        el.classList.add('pass-magic-move-node');
        el.style.transition = 'none';
        el.style.willChange = 'transform, opacity';
        el.style.opacity = '0';
        el.style.transform = 'translate(0, 8px) scale(0.985)';
      }
      animated.push(el);
    });

    state.renderCache.edgeElementsById?.forEach(edgeEls => {
      (edgeEls || []).forEach(edgeEl => {
        if (!edgeEl) return;
        edgeEl.style.transition = 'none';
        edgeEl.style.opacity = '0';
        fadedEdges.push(edgeEl);
      });
    });

      if (!animated.length && !fadedEdges.length) return;
    void els.nodesLayer?.offsetWidth;
    requestAnimationFrame(() => {
      animated.forEach(el => {
        el.style.transition = `transform ${durationMs}ms ${easing}, opacity ${Math.min(520, durationMs)}ms ${easing}`;
        el.style.transform = 'translate(0, 0) scale(1)';
        el.style.opacity = '';
      });
      fadedEdges.forEach(edgeEl => {
        edgeEl.style.transition = `opacity ${Math.min(620, durationMs)}ms ${easing}`;
        edgeEl.style.opacity = '';
      });
      setTimeout(() => {
        animated.forEach(el => {
          el.style.transition = '';
          el.style.transform = '';
          el.style.willChange = '';
          el.classList.remove('pass-magic-move-node');
        });
        fadedEdges.forEach(edgeEl => {
          edgeEl.style.transition = '';
          edgeEl.style.opacity = '';
        });
      }, durationMs + 140);
    });
  }

  function renderActiveGraph({ fit = false, animate = false } = {}) {
    const active = graphForViewMode();
    if (!active.graph || !active.layout) return;
    const previousPositions = animate ? captureTransitionSnapshot() : null;
    state.currentGraph = active.graph;
    state.currentLayout = active.layout;
    state.renderedGraph = null;
    state.virtualRenderWindow = null;
    state.lastVirtualRenderScale = state.scale || 1;
    state.edgesHiddenByScale = false;
    els.edgesSvg?.classList.remove('is-hidden');
    updateHugeGraphMode(active.graph);
    updateSideButtons(state.currentSide);
    if (els.emptyState) els.emptyState.hidden = true;
    updateModeAvailability();
    state.currentColorMap = buildNodeColorMap(active.graph);
    if (fit) fitGraph();
    else updateEdgeVisibilityByScale();
    renderViewportGraph({ force: true });
    if (animate) animateNodeLayoutTransition(previousPositions);
  }

  function displayGraph(graph, loadInfo = {}, options = {}) {
    annotateFlowSignatures(graph);
    state.sourceGraph = graph;
    state.currentLoadInfo = loadInfo;
    state.currentSide = loadInfo.side || sideForRef(loadInfo.fileRef) || state.currentSide;
    state.sourceLayout = computeGraphLayout(graph);
    state.groupedGraph = buildGroupedGraphModel(graph, state.sourceLayout);
    state.groupedLayout = state.groupedGraph ? computeGraphLayout(state.groupedGraph, { preferDetail: true }) : null;
    if (state.viewMode === 'grouped' && !(state.groupedGraph && state.groupedLayout)) {
      state.viewMode = 'original';
    }
    renderActiveGraph({ fit: options.fit !== false, animate: !!options.animate });
  }

  function displayGraphRef(fileRef, options = {}) {
    const cachedGraph = state.graphCache.get(fileRef);
    if (cachedGraph) {
      displayGraph(cachedGraph, {
        fileRef,
        fileName: graphRefName(fileRef),
        side: options.side || sideForRef(fileRef),
        loadedAt: Date.now(),
      }, options);
      return Promise.resolve(cachedGraph);
    }
    return readJsonRef(fileRef).then(data => {
      const graph = parseGraph(data);
      state.graphCache.set(fileRef, graph);
      displayGraph(graph, {
        fileRef,
        fileName: graphRefName(fileRef),
        side: options.side || sideForRef(fileRef),
        loadedAt: Date.now(),
      }, options);
      return graph;
    });
  }

  function focusNodeById(nodeId) {
    if (!nodeId || !state.currentGraph || !state.currentLayout) return false;
    const renderNodeId = resolveRenderNodeId(nodeId);
    const pos = state.currentLayout.positions.get(renderNodeId);
    if (!pos) return false;
    state.scale = Math.max(0.12, state.scale);
    state.tx = els.viewport.clientWidth / 2 - (pos.x + pos.w / 2) * state.scale;
    state.ty = els.viewport.clientHeight / 2 - (pos.y + pos.h / 2) * state.scale;
    applyTransform(true, { scheduleRender: false });
    updateEdgeVisibilityByScale();
    renderViewportGraph({ force: true, dispatch: false });
    return true;
  }

  function resolveRenderNodeId(nodeId) {
    if (!nodeId) return nodeId;
    if (state.currentLayout?.positions?.has(nodeId)) return nodeId;
    return state.memberToGroupId.get(nodeId) || nodeId;
  }

  window.PtoPassIrState = {
    readJsonRef,
    loadGraphRef: displayGraphRef,
    getCurrentGraph: () => state.currentGraph,
    getCurrentLoadInfo: () => state.currentLoadInfo ? { ...state.currentLoadInfo } : null,
    getCurrentSide: () => state.currentSide,
    getRenderCache: () => state.renderCache,
    getViewMode: () => state.viewMode,
    resolveRenderNodeId,
    setViewMode,
    setColorMode,
    loadEntries,
    fitCurrentGraph,
    focusNodeById,
    showStepGhost,
  };

  function applyTransform(animate = false, options = {}) {
    if (!els.graphRoot) return;
    if (state.focusTransitionTimer) {
      clearTimeout(state.focusTransitionTimer);
      state.focusTransitionTimer = 0;
    }
    const durationMs = options.durationMs || FOCUS_TRANSITION_MS;
    els.graphRoot.style.transition = animate ? `transform ${durationMs}ms var(--easing-out)` : '';
    els.graphRoot.style.willChange = animate ? 'transform' : '';
    els.graphRoot.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    if (animate) {
      const timer = setTimeout(() => {
        if (state.focusTransitionTimer !== timer) return;
        els.graphRoot.style.transition = '';
        els.graphRoot.style.willChange = '';
        state.focusTransitionTimer = 0;
      }, durationMs + 120);
      state.focusTransitionTimer = timer;
    }
    const edgeVisibilityChanged = updateEdgeVisibilityByScale();
    if (options.scheduleRender !== false) scheduleViewportRender(!!edgeVisibilityChanged);
  }

  function fitGraph() {
    if (!state.currentLayout || !els.viewport) return;
    const w = Math.max(1, state.currentLayout.canvasW || 1);
    const h = Math.max(1, state.currentLayout.canvasH || 1);
    const vw = Math.max(1, els.viewport.clientWidth);
    const vh = Math.max(1, els.viewport.clientHeight);
    const targetScale = Math.min(1.1, Math.min(vw / w, vh / h) * 0.86);
    const minScale = state.hugeGraphMode ? 0.002 : 0.04;
    state.scale = Math.max(minScale, targetScale);
    state.tx = (vw - w * state.scale) / 2;
    state.ty = (vh - h * state.scale) / 2;
    applyTransform(false, { scheduleRender: false });
    updateEdgeVisibilityByScale();
  }

  function fitCurrentGraph() {
    fitGraph();
    renderViewportGraph({ force: true, dispatch: false });
  }

  function collectPairs(navIndex) {
    return window.PtoPassCausePairs.buildPairsFromNavIndex(navIndex);
  }

  function readyPairs() {
    return (state.pairs || []).filter(pair => pair.status === 'ready');
  }

  function filteredReadyPairs() {
    const passName = els.passFilterSelect?.value || 'all';
    const list = readyPairs();
    if (!passName || passName === 'all') return list;
    return list.filter(pair => pair.passName === passName);
  }

  function coverageStats() {
    const all = state.pairs || [];
    const ready = all.filter(pair => pair.status === 'ready');
    return {
      schemaPasses: window.PtoPassCauseSourceSchema?.PASS_SOURCE_SCHEMA?.length || 0,
      dumpPasses: new Set(all.map(pair => pair.passName)).size,
      readyPasses: new Set(ready.map(pair => pair.passName)).size,
      totalPairs: all.length,
      readyPairs: ready.length,
      missingPairs: all.length - ready.length,
    };
  }

  function updateCoverageLabel() {
    if (!els.coverage) return;
    const stats = coverageStats();
    if (!stats.totalPairs) {
      els.coverage.textContent = '';
      els.coverage.title = '';
      return;
    }
    const text = `源码 ${stats.schemaPasses} · dump ${stats.dumpPasses} · ready ${stats.readyPasses} pass / ${stats.readyPairs} pair`;
    els.coverage.textContent = text;
    els.coverage.title = `已解析 ${stats.totalPairs} 个 pair，ready ${stats.readyPairs}，缺失 ${stats.missingPairs}`;
  }

  function loopLabelForPath(pathId) {
    if (pathId === 'PATH0_4') return 'RESHAPE';
    const map = { PATH0_6: 32, PATH0_8: 16, PATH0_10: 8, PATH0_12: 4, PATH0_14: 2, PATH0_16: 1 };
    return map[pathId] ? `MAIN x${map[pathId]}` : pathId;
  }

  function pairLabel(pair) {
    const target = pair.snapshotKey === 'main' ? loopLabelForPath(pair.pathId) : `${loopLabelForPath(pair.pathId)} ${pair.snapshotKey}`;
    return `P${String(pair.passIndex).padStart(2, '0')} ${pair.passName} - ${target}`;
  }

  function populatePassFilter() {
    if (!els.passFilterSelect) return;
    const current = els.passFilterSelect.value || 'all';
    els.passFilterSelect.innerHTML = '';

    const stats = coverageStats();
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `全部 Pass (${stats.readyPasses}/${stats.dumpPasses})`;
    els.passFilterSelect.appendChild(allOpt);

    const readyByPass = new Map();
    readyPairs().forEach(pair => {
      if (!readyByPass.has(pair.passName)) readyByPass.set(pair.passName, []);
      readyByPass.get(pair.passName).push(pair);
    });

    const passRows = [...new Map((state.pairs || []).map(pair => [pair.passName, pair])).values()]
      .sort((a, b) => {
        const ai = Number.isFinite(a.passIndex) ? a.passIndex : 9999;
        const bi = Number.isFinite(b.passIndex) ? b.passIndex : 9999;
        if (ai !== bi) return ai - bi;
        return String(a.passName).localeCompare(String(b.passName));
      });

    passRows.forEach(pair => {
      const opt = document.createElement('option');
      const readyCount = readyByPass.get(pair.passName)?.length || 0;
      const schema = pair.sourceSchema || window.PtoPassCauseSourceSchema?.getPassSchema?.(pair.passName);
      const tier = window.PtoPassCauseSourceSchema?.coverageLabel?.(schema?.coverageTier || pair.coverageTier) || '未知';
      opt.value = pair.passName;
      opt.textContent = `P${String(pair.passIndex).padStart(2, '0')} ${pair.passName} (${readyCount}) · ${tier}`;
      opt.disabled = readyCount === 0;
      els.passFilterSelect.appendChild(opt);
    });

    const hasCurrent = [...els.passFilterSelect.options].some(opt => opt.value === current && !opt.disabled);
    els.passFilterSelect.value = hasCurrent ? current : 'all';
    els.passFilterSelect.disabled = state.pairs.length === 0;
  }

  function populatePairSelect() {
    if (!els.pairSelect) return;
    els.pairSelect.innerHTML = '';
    const pairs = filteredReadyPairs();
    pairs.forEach(pair => {
      const option = document.createElement('option');
      option.value = pair.id;
      option.textContent = pairLabel(pair);
      els.pairSelect.appendChild(option);
    });
    els.pairSelect.disabled = pairs.length === 0;
    updateCoverageLabel();
  }

  function structuralScore(result) {
    const stats = result?.diff?.stats;
    if (!stats) return 0;
    return Math.abs(stats.netNodes || 0) * 3
      + Math.abs(stats.netEdges || 0)
      + stats.addedNodes
      + stats.removedNodes
      + stats.modifiedNodes
      + stats.addedEdges
      + stats.removedEdges
      + stats.rewires * 2
      + (result?.explanations || []).length;
  }

  function preferredCandidates() {
    const candidates = [];
    for (const preferred of AUTOSTART) {
      const match = readyPairs().find(pair => (
        normalizePassName(pair.passName) === preferred.passName
        && pair.pathId === preferred.pathId
        && pair.snapshotKey === 'main'
      ));
      if (match) candidates.push(match);
    }
    readyPairs().forEach(pair => {
      if (!candidates.some(item => item.id === pair.id)) candidates.push(pair);
    });
    return candidates;
  }

  async function explainPair(pair) {
    if (state.pairResults.has(pair.id)) return state.pairResults.get(pair.id);
    const result = await window.PtoPassCauseExplainer.explainPair(pair);
    state.pairResults.set(pair.id, result);
    return result;
  }

  async function findAutoStartResult() {
    const candidates = preferredCandidates();
    let best = null;
    const scanList = candidates.slice(0, MAX_AUTOSTART_SCAN);
    for (const pair of scanList) {
      setStatus(`扫描结构变化：${pairLabel(pair)}`);
      const result = await explainPair(pair);
      if (structuralScore(result) > 0 && (result.explanations || []).length > 0) {
        if (AUTOSTART.some(item => item.passName === normalizePassName(pair.passName) && item.pathId === pair.pathId)) return result;
        if (!best || structuralScore(result) > structuralScore(best)) best = result;
      }
    }
    if (best) return best;
    if (!candidates.length) return null;
    setStatus(`未在前 ${scanList.length} 组内找到明显结构变化，先打开第一组 ready 配对`);
    return explainPair(candidates[0]);
  }

  function updateSideButtons(side) {
    state.currentSide = side;
    els.beforeBtn?.classList.toggle('is-selected', side === 'before');
    els.afterBtn?.classList.toggle('is-selected', side === 'after');
  }

  function initialSideForResult(result) {
    const stats = result?.diff?.stats;
    if (!stats) return 'after';
    if ((stats.removedNodes || 0) > (stats.addedNodes || 0)) return 'before';
    return 'after';
  }

  function graphForSide(result, side) {
    return side === 'before' ? result.beforeGraph : result.afterGraph;
  }

  function refForSide(pair, side) {
    return side === 'before' ? pair.beforeRef : pair.afterRef;
  }

  function showStepGhost(step, side = state.currentSide) {
    if (!els.ghostTray) return;
    if (!step || !step.counts || (side !== 'after' && side !== 'before')) {
      els.ghostTray.hidden = true;
      els.ghostTray.innerHTML = '';
      return;
    }
    const c = step.counts || {};
    const chips = [];
    if (c.removedOps) chips.push(`op -${c.removedOps}`);
    if (c.removedTensors) chips.push(`tensor -${c.removedTensors}`);
    if (c.removedEdges) chips.push(`edge -${c.removedEdges}`);
    if (c.rewiredEdges) chips.push(`重连 ${c.rewiredEdges}`);
    if (c.addedOps) chips.push(`op +${c.addedOps}`);
    if (c.addedTensors) chips.push(`tensor +${c.addedTensors}`);
    if (c.fieldChanges) chips.push(`字段 ${c.fieldChanges}`);
    if (!chips.length) {
      els.ghostTray.hidden = true;
      return;
    }
    const title = side === 'after' && (c.removedOps || c.removedTensors)
      ? 'After 中隐藏了 Before 被删除对象'
      : (side === 'before' ? 'Before 中将被改写的对象' : '当前步骤变化');
    els.ghostTray.innerHTML = `
      <div class="pass-cause-ghost-title">${title}</div>
      <div class="pass-cause-ghost-chips">
        ${chips.map(text => `<span class="stat-chip">${text}</span>`).join('')}
      </div>
    `;
    els.ghostTray.hidden = false;
  }

  function syncNavToPair(pair) {
    if (!pair || !window.navSelectPassIndex) return;
    const indexForNav = state.navigatorIndex || state.navIndex;
    const navPassIndex = indexForNav?.passes?.findIndex(pass => (
      pass.pass_index === pair.passIndex && pass.pass_name === pair.passName
    ));
    if (navPassIndex == null || navPassIndex < 0) return;
    state.syncingNav = true;
    try {
      window.navSelectPassIndex(navPassIndex);
      window.navSelectPath?.(pair.pathId);
    } finally {
      state.syncingNav = false;
    }
  }

  function setActiveResult(result, { autoplay = false, side = null, syncNav = true } = {}) {
    state.activeResult = result;
    const pair = result?.pair;
    if (!pair) return;
    if (pair.beforeRef?.ref && result.beforeGraph) state.graphCache.set(pair.beforeRef.ref, result.beforeGraph);
    if (pair.afterRef?.ref && result.afterGraph) state.graphCache.set(pair.afterRef.ref, result.afterGraph);
    if (els.current) els.current.textContent = pairLabel(pair);
    if (els.passFilterSelect && els.passFilterSelect.value !== 'all') {
      els.passFilterSelect.value = pair.passName;
      populatePairSelect();
    }
    if (els.pairSelect) {
      const hasPairOption = [...els.pairSelect.options].some(opt => opt.value === pair.id);
      if (!hasPairOption && els.passFilterSelect) {
        els.passFilterSelect.value = 'all';
        populatePairSelect();
      }
      els.pairSelect.value = pair.id;
    }
    document.body.classList.remove('is-explain-panel-closed');
    setStatus(structuralScore(result) > 0 ? '已就绪' : '这组 Before/After 没有结构变化');
    if (syncNav) syncNavToPair(pair);
    const initialSide = side || initialSideForResult(result);
    const initialRef = refForSide(pair, initialSide);
    updateSideButtons(initialSide);
    displayGraph(graphForSide(result, initialSide), {
      fileRef: initialRef?.ref || null,
      fileName: initialRef?.fileName || '',
      side: initialSide,
      loadedAt: Date.now(),
    });
    showStepGhost((result.explanations || [])[0], initialSide);
    window.PtoPassCausePanel?.renderResult?.(result);
    if (autoplay) setTimeout(() => window.PtoPassCausePlayback?.play?.(), 350);
  }

  async function choosePair(pairId, options = {}) {
    const pair = readyPairs().find(item => item.id === pairId);
    if (!pair) return;
    setStatus(`解释中：${pairLabel(pair)}`);
    const result = await explainPair(pair);
    setActiveResult(result, options);
  }

  function pairForFileRef(fileRef) {
    if (!fileRef) return null;
    return readyPairs().find(pair => pair.beforeRef?.ref === fileRef || pair.afterRef?.ref === fileRef) || null;
  }

  window.loadFile = (fileRef, selection = null) => {
    if (!fileRef || state.syncingNav) return;
    const pair = pairForFileRef(fileRef);
    const side = pair?.beforeRef?.ref === fileRef ? 'before' : (selection?.side || 'after');
    if (pair) {
      choosePair(pair.id, { autoplay: false, side, syncNav: false });
      return;
    }
    displayGraphRef(fileRef).catch(error => {
      console.error(error);
      setStatus(error?.message || '读取图失败');
    });
  };

  function explainAvailabilityFromPairs(pairs) {
    return (pairs || [])
      .filter(pair => pair.status === 'ready')
      .map(pair => ({
        dir: `Pass_${String(pair.passIndex).padStart(2, '0')}_${pair.passName}`,
        passIndex: pair.passIndex,
        passName: pair.passName,
        pathId: pair.pathId,
      }));
  }

  function mapEntries(entries, sourceLabel, options = {}) {
    state.localFileRefs.clear();
    const builderEntries = [];
    for (const entry of entries || []) {
      const rel = normalizePath(entry.relativePath || '');
      if (!rel.toLowerCase().endsWith('.json')) continue;
      const ref = entry.ref || `local::${rel}`;
      state.localFileRefs.set(ref, entry.file);
      builderEntries.push({ relativePath: rel, ref });
    }
    state.navIndex = window.buildNavIndexFromFileEntries(builderEntries, { basePath: sourceLabel || 'local' });
    state.navigatorIndex = options.navigatorIndex || state.navIndex;
    state.pairResults.clear();
    state.graphCache.clear();
    state.pairs = collectPairs(state.navIndex);
    populatePassFilter();
    populatePairSelect();
    updateCoverageLabel();
    if (window.setNavIndex) {
      state.syncingNav = true;
      try {
        window.setNavIndex(state.navigatorIndex, {
          sourceLabel: options.navigatorSourceLabel || sourceLabel || state.navigatorIndex.base_path || 'local',
          explainAvailability: options.explainAvailability || explainAvailabilityFromPairs(state.pairs),
          preferredPathId: options.preferredPathId,
          initialPassDir: options.initialPassDir,
          initialPassName: options.initialPassName,
        });
      } finally {
        state.syncingNav = false;
      }
    }
  }

  async function loadEntries(entries, sourceLabel, options = {}) {
    setStatus('正在建立 Pass 索引');
    mapEntries(entries, sourceLabel, options);
    if (!readyPairs().length) {
      setStatus('没有找到可用的 Before/After 配对');
      return;
    }
    const stats = coverageStats();
    setStatus(`已解析 ${stats.dumpPasses} 个 Pass，正在自动选择有结构变化的配对`);
    const result = await findAutoStartResult();
    if (result) setActiveResult(result, { autoplay: false });
    if (options.timeline && window.PtoPassCausePlayback?.setTimeline) {
      window.PtoPassCausePlayback.setTimeline(attachTimelineGhostSteps(options.timeline, result), {
        title: options.timelineTitle || 'Pass 级播放',
        animateInitial: options.timelineAnimateInitial,
      });
    }
  }

  function mergePayloadForSide(steps, side) {
    const primaryNodeIds = new Set();
    const secondaryNodeIds = new Set();
    const edgeIds = new Set();

    (steps || []).forEach(step => {
      const payload = side === 'before' ? step.before : step.after;
      (payload?.primaryNodeIds || []).forEach(id => primaryNodeIds.add(id));
      (payload?.secondaryNodeIds || []).forEach(id => secondaryNodeIds.add(id));
      (payload?.edgeIds || []).forEach(id => edgeIds.add(id));
      if (!payload?.primaryNodeIds?.length && !payload?.secondaryNodeIds?.length) {
        (step.nodeIds || []).forEach(id => primaryNodeIds.add(id));
      }
      if (!payload?.edgeIds?.length) {
        (step.edgeIds || []).forEach(id => edgeIds.add(id));
      }
    });

    primaryNodeIds.forEach(id => secondaryNodeIds.delete(id));
    return {
      primaryNodeIds: [...primaryNodeIds],
      secondaryNodeIds: [...secondaryNodeIds],
      edgeIds: [...edgeIds],
      dimOthers: true,
    };
  }

  function mergeCounts(steps) {
    const keys = ['removedOps', 'removedTensors', 'removedEdges', 'rewiredEdges', 'addedOps', 'addedTensors', 'fieldChanges'];
    const counts = {};
    keys.forEach(key => {
      counts[key] = (steps || []).reduce((sum, step) => sum + (Number(step.counts?.[key]) || 0), 0);
    });
    return counts;
  }

  function buildTimelineGhostStep(result) {
    const steps = result?.explanations || [];
    if (!steps.length) return null;
    return {
      title: `${result.pair?.passName || 'Pass'} 变化总览`,
      summary: result.summary?.headline || '当前 Pass 的节点和边变化',
      focusSide: 'after',
      sideMode: 'after',
      transition: { type: 'timeline-highlight' },
      counts: mergeCounts(steps),
      before: mergePayloadForSide(steps, 'before'),
      after: mergePayloadForSide(steps, 'after'),
    };
  }

  function attachTimelineGhostSteps(timeline, result) {
    const ghostStep = buildTimelineGhostStep(result);
    if (!ghostStep || !result?.pair) return timeline;
    return (timeline || []).map(step => {
      const isActivePair = step
        && step.passIndex === result.pair.passIndex
        && step.passName === result.pair.passName
        && (!result.pair.pathId || !step.pathId || step.pathId === result.pair.pathId)
        && (step.side || 'after') === 'after';
      return isActivePair ? { ...step, ghostStep } : step;
    });
  }

  function colorModeLabel(mode) {
    if (mode === 'semantic') return 'Semantic';
    if (mode === 'latency') return 'Latency';
    if (mode === 'subgraph') return 'Subgraph';
    return 'None';
  }

  function setColorMode(mode) {
    state.colorMode = mode || 'semantic';
    syncColorControls();
    if (state.sourceGraph) renderActiveGraph({ fit: false });
  }

  function setViewMode(mode) {
    const nextMode = mode === 'grouped' && state.groupedGraph && state.groupedLayout ? 'grouped' : 'original';
    if (nextMode === state.viewMode) return;
    state.viewMode = nextMode;
    syncColorControls();
    if (state.sourceGraph) renderActiveGraph({ fit: true });
  }

  function positionColorModeMenu() {
    if (!els.colorModeBtn || !els.colorModeMenu) return;
    const rect = els.colorModeBtn.getBoundingClientRect();
    const menuWidth = 188;
    const margin = 12;
    const left = Math.max(margin, Math.min(window.innerWidth - menuWidth - margin, rect.right - menuWidth));
    const top = Math.max(margin, rect.bottom + 8);
    els.colorModeMenu.style.left = `${left}px`;
    els.colorModeMenu.style.top = `${top}px`;
  }

  function setColorModeMenuOpen(open) {
    if (!els.colorModeMenu) return;
    els.colorModeMenu.hidden = !open;
    els.colorModeBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) positionColorModeMenu();
  }

  async function collectHandleEntries(handle, prefix = '') {
    const out = [];
    for await (const [name, child] of handle.entries()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (child.kind === 'directory') {
        out.push(...await collectHandleEntries(child, rel));
      } else if (name.toLowerCase().endsWith('.json')) {
        out.push({ relativePath: rel, file: await child.getFile() });
      }
    }
    return out;
  }

  async function openFolder() {
    if (window.showDirectoryPicker) {
      const handle = await window.showDirectoryPicker({ id: 'pto-pass-explain-folder' });
      const entries = await collectHandleEntries(handle);
      await loadEntries(entries, handle.name || 'local');
      return;
    }
    els.dirInput?.click();
  }

  function bindViewport() {
    if (!els.viewport) return;
    els.viewport.addEventListener('mousedown', event => {
      state.panning = true;
      state.panStart = { x: event.clientX - state.tx, y: event.clientY - state.ty };
      els.viewport.classList.add('is-panning');
    });
    window.addEventListener('mousemove', event => {
      if (!state.panning || !state.panStart) return;
      state.tx = event.clientX - state.panStart.x;
      state.ty = event.clientY - state.panStart.y;
      applyTransform(false);
    });
    window.addEventListener('mouseup', () => {
      state.panning = false;
      state.panStart = null;
      els.viewport.classList.remove('is-panning');
    });
    els.viewport.addEventListener('wheel', event => {
      if (!event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? 0.9 : 1.1;
      const nextScale = Math.max(0.05, Math.min(3, state.scale * delta));
      const rect = els.viewport.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      state.tx = mx - (mx - state.tx) * (nextScale / state.scale);
      state.ty = my - (my - state.ty) * (nextScale / state.scale);
      state.scale = nextScale;
      applyTransform(false);
    }, { passive: false });
  }

  function bindEvents() {
    const handleOpenClick = () => {
      openFolder().catch(error => {
        if (error?.name !== 'AbortError') {
          console.error(error);
          setStatus(error?.message || '打开文件夹失败');
        }
      });
    };
    els.openBtn?.addEventListener('click', handleOpenClick);
    document.querySelectorAll('[data-open-pass-folder]').forEach(btn => {
      if (btn === els.openBtn) return;
      btn.addEventListener('click', handleOpenClick);
    });
    els.dirInput?.addEventListener('change', event => {
      const files = [...(event.target.files || [])].filter(file => file.name.toLowerCase().endsWith('.json'));
      const entries = files.map(file => ({
        relativePath: normalizePath(file.webkitRelativePath || file.name),
        file,
      }));
      const folderName = files[0]?.webkitRelativePath?.split('/')?.[0] || 'local-folder';
      loadEntries(entries, folderName).catch(error => {
        console.error(error);
        setStatus(error?.message || '加载文件夹失败');
      });
      event.target.value = '';
    });
    els.passFilterSelect?.addEventListener('change', () => {
      populatePairSelect();
      const firstPairId = els.pairSelect?.value;
      if (!firstPairId) {
        setStatus('这个 Pass 没有 ready 的 Before/After 配对');
        return;
      }
      choosePair(firstPairId, { autoplay: false });
    });
    els.pairSelect?.addEventListener('change', () => choosePair(els.pairSelect.value, { autoplay: false }));
    els.fitBtn?.addEventListener('click', () => {
      fitGraph();
      renderViewportGraph({ force: true });
    });
    els.beforeBtn?.addEventListener('click', () => {
      const pair = state.activeResult?.pair;
      if (pair?.beforeRef?.ref) {
        updateSideButtons('before');
        displayGraphRef(pair.beforeRef.ref);
      }
    });
    els.afterBtn?.addEventListener('click', () => {
      const pair = state.activeResult?.pair;
      if (pair?.afterRef?.ref) {
        updateSideButtons('after');
        displayGraphRef(pair.afterRef.ref);
      }
    });
    els.colorModeBtn?.addEventListener('click', event => {
      event.stopPropagation();
      setColorModeMenuOpen(Boolean(els.colorModeMenu?.hidden));
    });
    els.colorModeMenu?.addEventListener('click', event => {
      const btn = event.target.closest('[data-color-mode]');
      if (!btn || btn.disabled) return;
      setColorMode(btn.dataset.colorMode);
      setColorModeMenuOpen(false);
    });
    els.groupViewBtn?.addEventListener('click', () => {
      if (els.groupViewBtn.disabled) return;
      setViewMode(state.viewMode === 'grouped' ? 'original' : 'grouped');
    });
    document.addEventListener('click', event => {
      if (!els.colorModeMenu || els.colorModeMenu.hidden) return;
      if (event.target.closest('#colorModeBtn') || event.target.closest('#colorModeMenu')) return;
      setColorModeMenuOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') setColorModeMenuOpen(false);
    });
    window.addEventListener('resize', () => {
      fitGraph();
      renderViewportGraph({ force: true });
      if (els.colorModeMenu && !els.colorModeMenu.hidden) positionColorModeMenu();
    });
  }

  bindViewport();
  bindEvents();
  setColorMode('semantic');
  setStatus('');
})();

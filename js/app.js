/**
 * app.js — Main controller: file loading, zoom/pan, selection, detail panel
 */

(function () {
  // ── DOM refs ───────────────────────────────────────────────────
  const viewport      = document.getElementById('viewport');
  const graphRoot     = document.getElementById('graphRoot');
  const nodesLayer    = document.getElementById('nodesLayer');
  const edgesSvg      = document.getElementById('edgesSvg');
  const emptyState    = document.getElementById('emptyState');
  const fileInput     = document.getElementById('fileInput');
  const dirInput      = document.getElementById('dirInput');
  const loadBtn       = document.getElementById('loadBtn');
  const emptyLoadBtn  = document.getElementById('emptyLoadBtn');
  const fitBtn        = document.getElementById('fitBtn');
  const zoomInBtn     = document.getElementById('zoomInBtn');
  const zoomOutBtn    = document.getElementById('zoomOutBtn');
  const zoomLabel     = document.getElementById('zoomLabel');
  const graphTitle    = document.getElementById('graphTitle');
  const graphStats    = document.getElementById('graphStats');
  const detailPanel   = document.getElementById('detailPanel');
  const detailBadge   = document.getElementById('detailBadge');
  const detailName    = document.getElementById('detailName');
  const detailBody    = document.getElementById('detailBody');
  const detailClose   = document.getElementById('detailClose');
  const minimapEl     = document.getElementById('minimap');
  const minimapCanvas = document.getElementById('minimapCanvas');
  const minimapVp     = document.getElementById('minimapViewport');
  const colorPanel    = document.getElementById('colorPanel');
  const colorPanelToggle = document.getElementById('colorPanelToggle');
  const recentRow     = document.getElementById('recentRow');
  const recentChip    = document.getElementById('recentChip');
  const recentName    = document.getElementById('recentName');
  const graphPicker   = document.getElementById('graphPicker');
  const graphMenu     = document.getElementById('graphMenu');
  const graphMenuLocal = document.getElementById('graphMenuLocal');
  const graphMenuDir  = document.getElementById('graphMenuDir');
  const minimapToggle = document.getElementById('minimapToggle');
  const graphLockExit = document.getElementById('graphLockExit');
  const graphLockLabel = document.getElementById('graphLockLabel');
  const DEFAULT_COLOR_MODE = 'semantic';
  const DEFAULT_VIEW_MODE = 'original';

  // ── State ──────────────────────────────────────────────────────
  let graph  = null;
  let layout = null;
  let sourceGraph = null;
  let sourceLayout = null;
  let groupedGraph = null;
  let groupedLayout = null;
  let tx = 0, ty = 0, scale = 1;
  let panning = false, panStart = { x: 0, y: 0 };
  let selectedNodeId = null;
  let viewMode = DEFAULT_VIEW_MODE; // 'original' | 'grouped'
  let colorMode = DEFAULT_COLOR_MODE;  // hidden 'none' | 'semantic' | 'subgraph' | 'latency' | 'engineMemory'
  let colorMap  = null;    // Map<nodeId, hexColor> | null
  const localFileRefs = new Map(); // ref -> File
  const BRIDGE_DB = 'pto-launch-bridge';
  const BRIDGE_STORE = 'pending-dir-handles';
  const LS_MINIMAP_COLLAPSED = 'pto_minimap_collapsed';
  const LS_COLOR_PANEL_COLLAPSED = 'pto_color_panel_collapsed';
  const PASS_IR_COLOR_SYNC_EVENT = 'pto-pass-ir:set-color-mode';

  const SCALE_MIN = 0.06;
  const SCALE_MAX = 4;
  const PASS_LAYOUT_OPTS = { nodeWidth: 225 };
  const HUGE_GRAPH_NODE_THRESHOLD = 3000;
  const HUGE_GRAPH_EDGE_THRESHOLD = 6000;
  const GROUP_DETAIL_NODE_THRESHOLD = 5000;
  const GROUP_DETAIL_EDGE_THRESHOLD = 10000;
  const HUGE_EDGE_HIDE_SCALE = 0.18;
  const VIRTUAL_BUFFER_SCREEN_PX = 420;
  const VIRTUAL_SCALE_FORCE_DELTA = 0.12;

  let lockedFlowState = null; // { anchorSourceNodeId, anchorLabel, anchorType, anchorMagic, subgraph, flowLayout, nodeCount }
  let detailSourceNodeId = null;

  let renderCache = null;
  let activeGraphIndex = null;
  let sourceGraphIndex = null;
  let hugeGraphMode = false;
  let edgesHiddenByScale = false;
  let renderedGraphModel = null;
  let virtualRenderWindow = null;
  let lastVirtualRenderScale = 1;
  const graphIndexCache = new WeakMap();
  let viewportRenderRaf = 0;
  let viewportRenderForce = false;

  const minimapBaseCanvas = document.createElement('canvas');
  minimapBaseCanvas.width = minimapCanvas.width;
  minimapBaseCanvas.height = minimapCanvas.height;
  const minimapBaseCtx = minimapBaseCanvas.getContext('2d');
  let minimapBaseDirty = true;
  let minimapRaf = 0;
  let minimapTransform = { gs: 1, ox: 0, oy: 0 };

  // ── Color mapping ──────────────────────────────────────────────

  const BOUNDARY_COLORS = { incast: '#87c80f', outcast: '#c9107d' };
  const ENGINE_MEMORY_FALLBACK_COLORS = {
    'engine:vector': '#3B82F6',
    'engine:cube': '#8B5CF6',
    'memory:gm': '#14B8A6',
    'memory:l1': '#0EA5A4',
    'memory:l0': '#06B6D4',
    'memory:ub': '#22D3EE',
    'memory:local': '#5EEAD4',
    'memory:register': '#64748B',
    'memory:workspace': '#2DD4BF',
    'memory:allocated': '#0F766E',
    'memory:unknown': '#6B7280',
  };

  function fallbackEngineMemoryKey(node) {
    if (!node) return null;
    if (node.type === 'op') {
      const opcode = String(node.data?.opcode || '').toUpperCase();
      const isCube = !!node.data?.opAttr?.IS_CUBE || opcode === 'A_MUL_B';
      return isCube ? 'engine:cube' : 'engine:vector';
    }
    const mt = node.data?.memType || null;
    const raw = mt?.tobe ?? mt?.asis;
    const s = String(raw ?? '').toUpperCase();
    if (s.includes('L1')) return 'memory:l1';
    if (s.includes('L0')) return 'memory:l0';
    if (s.includes('UB')) return 'memory:ub';
    if (s.includes('GM')) return 'memory:gm';
    if (s.includes('REG')) return 'memory:register';
    if (s.includes('LOCAL')) return 'memory:local';
    if (s.includes('WORK')) return 'memory:workspace';
    if (typeof node.data?.memId === 'number' && node.data.memId >= 0) return 'memory:allocated';
    return 'memory:unknown';
  }

  function safeEngineMemoryKey(node) {
    if (typeof getEngineMemoryKey === 'function') return getEngineMemoryKey(node);
    return fallbackEngineMemoryKey(node);
  }

  function safeBuildEngineMemoryNodeColorMap(nodes) {
    if (typeof buildEngineMemoryNodeColorMap === 'function') {
      return buildEngineMemoryNodeColorMap(nodes);
    }
    const out = new Map();
    (nodes || []).forEach(n => {
      const key = safeEngineMemoryKey(n);
      if (!key) return;
      out.set(n.id, ENGINE_MEMORY_FALLBACK_COLORS[key] || ENGINE_MEMORY_FALLBACK_COLORS['memory:unknown']);
    });
    return out;
  }

  function shapeSignature(shape) {
    if (!Array.isArray(shape) || !shape.length) return '[]';
    return '[' + shape.join(',') + ']';
  }

  function tensorRole(node) {
    if (node.type === 'incast') return 'input-contract';
    if (node.type === 'outcast') return 'output-contract';
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

  function titleCaseToken(token) {
    return String(token || '')
      .toLowerCase()
      .split(/[_\s]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  const OPCODE_SEMANTIC_LABELS = {
    VIEW: 'View',
    RESHAPE: 'Reshape',
    ASSEMBLE: 'Assemble',
    REGISTER_COPY: 'Copy',
    INDEX_OUTCAST: 'Outcast',
    A_MUL_B: 'Matmul',
    ROWSUM_SINGLE: 'Reduce',
    ROWMAX_SINGLE: 'Reduce',
    CAST: 'Cast',
    SQRT: 'Special Math',
    VEC_DUP: 'Broadcast',
    ADD: 'Add',
    ADDS: 'Add',
    SUB: 'Subtract',
    MUL: 'Multiply',
    MULS: 'Multiply',
    DIV: 'Divide',
    ABS: 'Abs',
  };

  function semanticLabelFromCategoryKey(categoryKey) {
    if (!categoryKey || typeof categoryKey !== 'string') return '';
    if (categoryKey.startsWith('op:')) return titleCaseToken(categoryKey.slice(3));
    if (!categoryKey.startsWith('cat:')) return titleCaseToken(categoryKey);
    const inner = categoryKey.slice(4);
    switch (inner) {
      case 'MEMORY': return 'Memory';
      case 'MATMUL': return 'Matmul';
      case 'ELEMENTWISE': return 'Elementwise';
      case 'REDUCE': return 'Reduce';
      case 'SPECIAL_MATH': return 'Special Math';
      case 'CAST': return 'Cast';
      case 'COMMS': return 'Data Movement';
      default: return titleCaseToken(inner);
    }
  }

  function inferSemanticLabelForOp(node) {
    if (!node || node.type !== 'op') return null;
    const explicit = node.data?.semanticLabel;
    if (explicit) return explicit;

    const opcode = String(node.data?.opcode || '').toUpperCase();
    if (OPCODE_SEMANTIC_LABELS[opcode]) return OPCODE_SEMANTIC_LABELS[opcode];

    if (typeof opcodeToCategory === 'function') {
      const categoryKey = opcodeToCategory(opcode);
      const categoryLabel = semanticLabelFromCategoryKey(categoryKey);
      if (categoryLabel) return categoryLabel;
    }

    return opcode ? titleCaseToken(opcode) : null;
  }

  function sortBoundaryIds(ids, nodeMap) {
    return [...(ids || [])].sort((a, b) => {
      const aNode = nodeMap.get(a);
      const bNode = nodeMap.get(b);
      const aSlot = typeof aNode?.data?.slotIdx === 'number' ? aNode.data.slotIdx : Number.MAX_SAFE_INTEGER;
      const bSlot = typeof bNode?.data?.slotIdx === 'number' ? bNode.data.slotIdx : Number.MAX_SAFE_INTEGER;
      if (aSlot !== bSlot) return aSlot - bSlot;
      return String(a).localeCompare(String(b));
    });
  }

  function topoSortNodeIds(graphModel) {
    const nodeIds = (graphModel?.nodes || []).map(node => node.id);
    const incomingByTarget = new Map(nodeIds.map(id => [id, []]));
    const outgoingBySource = new Map(nodeIds.map(id => [id, []]));
    const indegree = new Map(nodeIds.map(id => [id, 0]));

    (graphModel?.edges || []).forEach(edge => {
      if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
      if (!outgoingBySource.has(edge.source)) outgoingBySource.set(edge.source, []);
      incomingByTarget.get(edge.target).push(edge.source);
      outgoingBySource.get(edge.source).push(edge.target);
      indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    });

    const queue = [];
    indegree.forEach((deg, id) => {
      if (deg === 0) queue.push(id);
    });

    const topo = [];
    while (queue.length) {
      const id = queue.shift();
      topo.push(id);
      (outgoingBySource.get(id) || []).forEach(nextId => {
        const nextDeg = (indegree.get(nextId) || 0) - 1;
        indegree.set(nextId, nextDeg);
        if (nextDeg === 0) queue.push(nextId);
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

  function annotateGraphModel(graphModel) {
    if (!graphModel?.nodes?.length) return graphModel;

    const nodeMap = new Map(graphModel.nodes.map(node => [node.id, node]));
    const { topo, incomingByTarget, outgoingBySource } = topoSortNodeIds(graphModel);
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

    graphModel.nodes.forEach(node => {
      if (!node?.data) node.data = {};

      const upstreamBoundaryIds = sortBoundaryIds(upstreamByNodeId.get(node.id), nodeMap);
      const downstreamBoundaryIds = sortBoundaryIds(downstreamByNodeId.get(node.id), nodeMap);
      const flowSignature = `u:${upstreamBoundaryIds.join(',') || '-'}|d:${downstreamBoundaryIds.join(',') || '-'}`;

      node.data.upstreamBoundaryIds = upstreamBoundaryIds;
      node.data.downstreamBoundaryIds = downstreamBoundaryIds;
      node.data.flowSignature = flowSignature;

      if (node.type === 'op') {
        node.data.inferredSemanticLabel = inferSemanticLabelForOp(node);
      }
    });

    return graphModel;
  }

  function opFingerprint(node) {
    const d = node?.data || {};
    const attrs = Object.keys(d.opAttr || {}).sort().join(',');
    const inArity = Array.isArray(d.ioperands) ? d.ioperands.length : 0;
    const outArity = Array.isArray(d.ooperands) ? d.ooperands.length : 0;
    const semantic = resolvedSemanticLabel(node);
    return [
      'opcode=' + String(d.opcode || node.label || 'OP'),
      'arity=' + inArity + '->' + outArity,
      'attrs=' + attrs,
      'out=' + shapeSignature(d.outShape),
      'semantic=' + String(semantic || '—'),
    ].join('|');
  }

  function tensorFingerprint(node) {
    const d = node?.data || {};
    return [
      'role=' + tensorRole(node),
      'dtype=' + String(d.dtype || '?'),
      'shape=' + shapeSignature(d.shape),
      'kind=' + String(d.kind ?? '—'),
    ].join('|');
  }

  function pickDominantValue(values) {
    const counts = new Map();
    let winner = null;
    let winnerCount = 0;
    values.forEach(value => {
      if (value == null || value === '') return;
      const nextCount = (counts.get(value) || 0) + 1;
      counts.set(value, nextCount);
      if (nextCount > winnerCount) {
        winner = value;
        winnerCount = nextCount;
      }
    });
    return winner;
  }

  function summarizeLatency(values) {
    const nums = values.filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    if (!nums.length) return { avg: null, max: null, total: null };
    const total = nums.reduce((sum, value) => sum + value, 0);
    return {
      avg: total / nums.length,
      max: Math.max(...nums),
      total,
    };
  }

  function formatCycles(value) {
    if (value == null || !Number.isFinite(value)) return '';
    return Math.round(value).toLocaleString() + ' cy';
  }

  function semanticKeyForNode(node) {
    if (!node) return null;
    if (node.type === 'group') return node.data?.semanticKey || (node.data?.groupType === 'tensor' ? 'tensor' : null);
    if (node.type === 'op') {
      const semantic = resolvedSemanticLabel(node);
      if (semantic) return 'sem:' + semantic;
      if (typeof getSemanticKey === 'function') return getSemanticKey(node);
      return typeof opcodeToCategory === 'function' ? opcodeToCategory(node.data?.opcode) : 'cat:UNKNOWN';
    }
    if (node.type === 'incast') return 'boundary:incast';
    if (node.type === 'outcast') return 'boundary:outcast';
    return 'tensor';
  }

  function semanticLabelFromKey(key) {
    if (!key) return '';
    if (key.startsWith('sem:')) return key.slice(4);
    if (key.startsWith('cat:')) return key.slice(4);
    if (key === 'tensor') return 'Tensor';
    if (key === 'boundary:incast') return 'Graph Input';
    if (key === 'boundary:outcast') return 'Graph Output';
    return key;
  }

  function buildSemanticPipelineColorMap(keys) {
    const pipelineStages = {};
    const genericKeys = [];
    [...new Set(keys)].forEach(key => {
      if (typeof key !== 'string') return;
      if (!key.startsWith('sem:')) {
        genericKeys.push(key);
        return;
      }
      const parsed = typeof parsePipelineLabel === 'function' ? parsePipelineLabel(key) : null;
      if (!parsed) {
        genericKeys.push(key);
        return;
      }
      const { pipeline, stage } = parsed;
      if (!pipelineStages[pipeline]) pipelineStages[pipeline] = [];
      if (!pipelineStages[pipeline].includes(stage)) pipelineStages[pipeline].push(stage);
    });

    const keyColorMap = new Map();
    Object.entries(pipelineStages).forEach(([pipeline, stages]) => {
      const baseHue = PIPELINE_HUES?.[pipeline] ? PIPELINE_HUES[pipeline].h * 360 : 220;
      const laneColors = typeof getLaneColors === 'function'
        ? getLaneColors(Math.max(1, stages.length), baseHue, 30)
        : stages.map(() => '#666666');
      stages.forEach((stage, idx) => {
        keyColorMap.set(`sem:${pipeline}-${stage}`, laneColors[idx] || '#666666');
      });
    });

    const genericPalette = typeof buildColorMap === 'function'
      ? buildColorMap([...new Set(genericKeys)].sort((a, b) => String(a).localeCompare(String(b))))
      : new Map();
    genericPalette.forEach((color, key) => {
      if (!keyColorMap.has(key)) keyColorMap.set(key, color);
    });
    return keyColorMap;
  }

  function semanticColorForKey(key, pipelineColorMap) {
    if (!key) return '#666666';
    if (key === 'tensor') return '#606060';
    if (key === 'boundary:incast') return BOUNDARY_COLORS.incast;
    if (key === 'boundary:outcast') return BOUNDARY_COLORS.outcast;
    if (pipelineColorMap?.has(key)) return pipelineColorMap.get(key) || '#666666';
    return '#666666';
  }

  function engineMemoryKeyForNode(node) {
    if (!node) return null;
    if (node.type === 'group') return node.data?.engineMemoryKey || null;
    return safeEngineMemoryKey(node);
  }

  function engineMemoryColorForKey(key) {
    if (!key) return null;
    if (typeof getEngineMemoryColor === 'function') return getEngineMemoryColor(key);
    return ENGINE_MEMORY_FALLBACK_COLORS[key] || ENGINE_MEMORY_FALLBACK_COLORS['memory:unknown'];
  }

  function engineMemoryHintForKey(key) {
    if (!key) return '';
    if (typeof getEngineMemoryLabel === 'function') return getEngineMemoryLabel(key);
    return key;
  }

  function latencyValueForNode(node) {
    if (!node) return null;
    if (node.type === 'group') return node.data?.latency ?? null;
    if (node.type === 'op') return node.data?.latency ?? null;
    return null;
  }

  function subgraphKeyForNode(node, tensorToSg) {
    if (!node) return null;
    if (node.type === 'incast' || node.type === 'outcast') return 'boundary';
    if (node.type === 'op') {
      return node.data?.subgraphId != null ? 'sg_' + node.data.subgraphId : 'sg_input';
    }
    if (node.type === 'group') {
      if (node.data?.groupType === 'op') {
        return node.data?.subgraphId != null ? 'sg_' + node.data.subgraphId : 'sg_input';
      }
      const sgId = node.data?.subgraphId ?? tensorToSg?.get(node.id);
      return sgId != null ? 'sg_' + sgId : 'sg_input';
    }
    const sgId = tensorToSg?.get(node.id);
    return sgId != null ? 'sg_' + sgId : 'sg_input';
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
      engineMemoryKey: engineMemoryKeyForNode(member),
    };
  }

  function resolveGroupMemberNode(ref, baseNodeMap, fallbackGroupType) {
    if (typeof ref === 'string') return baseNodeMap.get(ref) || null;
    if (typeof ref === 'number') {
      const prefix = fallbackGroupType === 'op' ? 'op_' : 't_';
      return baseNodeMap.get(`${prefix}${ref}`) || null;
    }
    if (!ref || typeof ref !== 'object') return null;
    const nodeId = ref.nodeId || ref.id || ref.node_id || null;
    return nodeId ? (baseNodeMap.get(nodeId) || null) : null;
  }

  function hydrateExistingGroupNodes(baseGraph) {
    if (!baseGraph?.nodes?.some(node => node.type === 'group')) return baseGraph;
    const baseNodeMap = new Map(baseGraph.nodes.map(node => [node.id, node]));
    let changed = false;

    const nextNodes = baseGraph.nodes.map(node => {
      if (node.type !== 'group') return node;
      const rawGroupType = String(node.data?.groupType || 'tensor').toLowerCase();
      const groupType = rawGroupType === 'tile' || rawGroupType === 'op' ? 'op' : 'tensor';
      const members = (Array.isArray(node.data?.members) ? node.data.members : [])
        .map(ref => resolveGroupMemberNode(ref, baseNodeMap, groupType))
        .filter(Boolean);
      if (!members.length) return node;

      changed = true;
      const hydrated = makeGroupNodeFromBucket(node.id, {
        nodeType: groupType,
        layer: node.data?.layer ?? 0,
        key: node.data?.clusterKey || node.id,
      }, members);

      return {
        ...node,
        label: node.label || hydrated.label,
        subLabel: node.subLabel || hydrated.subLabel,
        data: {
          ...hydrated.data,
          ...node.data,
          title: node.data?.title || hydrated.data.title,
          count: node.data?.count ?? hydrated.data.count,
          rows: Array.isArray(node.data?.rows) && node.data.rows.length ? node.data.rows : hydrated.data.rows,
          members: hydrated.data.members,
        },
      };
    });

    if (!changed) return baseGraph;
    return {
      ...baseGraph,
      nodes: nextNodes,
    };
  }

  function makeGroupNodeFromBucket(groupId, bucket, members) {
    const rep = members[0];
    const isOpGroup = bucket.nodeType === 'op';
    const d = rep?.data || {};
    const memberRefs = members.map(buildGroupMemberRef);
    const dominantSemanticKey = isOpGroup
      ? pickDominantValue(memberRefs.map(member => member.semanticKey))
      : 'tensor';
    const dominantSubgraphId = isOpGroup
      ? pickDominantValue(memberRefs.map(member => member.subgraphId))
      : null;
    const latencySummary = summarizeLatency(memberRefs.map(member => member.latency));
    const dominantEngineMemoryKey = pickDominantValue(memberRefs.map(member => member.engineMemoryKey));
    const flowSignature = pickDominantValue(members.map(member => member.data?.flowSignature)) || null;

    let title = 'Group';
    let rows = [];
    if (isOpGroup) {
      const inArity = Array.isArray(d.ioperands) ? d.ioperands.length : 0;
      const outArity = Array.isArray(d.ooperands) ? d.ooperands.length : 0;
      title = String(d.opcode || rep.label || 'Op Cluster');
      rows = [
        ['opcode', String(d.opcode || rep.label || '—')],
        ['arity', `${inArity}->${outArity}`],
      ];
      if (dominantSemanticKey) rows.push(['semantic', semanticLabelFromKey(dominantSemanticKey)]);
      if (dominantSubgraphId != null) rows.push(['sg', `SG·${dominantSubgraphId}`]);
      if (latencySummary.avg != null) rows.push(['lat(avg)', formatCycles(latencySummary.avg)]);
    } else {
      title = tensorSemanticTitle(rep);
      rows = [
        ['role', tensorRole(rep)],
        ['dtype', String(d.dtype || '—')],
        ['shape', shapeSignature(d.shape)],
      ];
      if (dominantEngineMemoryKey) rows.push(['mem', engineMemoryHintForKey(dominantEngineMemoryKey)]);
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
        semanticKey: dominantSemanticKey,
        semanticLabel: semanticLabelFromKey(dominantSemanticKey),
        flowSignature,
        subgraphId: dominantSubgraphId,
        latency: latencySummary.avg != null ? Math.round(latencySummary.avg) : null,
        latencyMax: latencySummary.max != null ? Math.round(latencySummary.max) : null,
        latencyTotal: latencySummary.total != null ? Math.round(latencySummary.total) : null,
        engineMemoryKey: dominantEngineMemoryKey,
        engineMemoryHint: engineMemoryHintForKey(dominantEngineMemoryKey),
        groupReason: flowSignature
          ? 'same flow signature + same local structure'
          : 'same local structure',
      },
    };
  }

  function buildGroupedGraphModel(baseGraph, baseLayout) {
    if (!baseGraph || !baseGraph.nodes?.length) return null;

    const hasNativeGroup = baseGraph.nodes.some(n => n.type === 'group');
    if (hasNativeGroup) {
      return hydrateExistingGroupNodes(baseGraph);
    }

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

    const baseNodeMap = new Map(baseGraph.nodes.map(n => [n.id, n]));
    let selectedBuckets = [...buckets.values()].filter(b => b.memberIds.length >= 2);

    if (!selectedBuckets.length) return null;

    const nodeToGroupId = new Map();
    const groupedNodes = [];
    const usedIds = new Set(baseGraph.nodes.map(n => n.id));

    let seq = 0;
    for (const bucket of selectedBuckets) {
      let groupId = `group_auto_${bucket.layer}_${seq++}`;
      while (usedIds.has(groupId)) groupId = `group_auto_${bucket.layer}_${seq++}`;
      usedIds.add(groupId);

      const members = bucket.memberIds
        .map(id => baseNodeMap.get(id))
        .filter(Boolean);
      if (members.length < 2) continue;

      members.forEach(m => nodeToGroupId.set(m.id, groupId));
      groupedNodes.push(makeGroupNodeFromBucket(groupId, bucket, members));
    }

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
    const finalEdges = [...edgeMap.values()];

    const countType = t => finalNodes.filter(n => n.type === t).length;
    return {
      nodes: finalNodes,
      edges: finalEdges,
      meta: {
        ...baseGraph.meta,
        totalNodes: finalNodes.length,
        totalEdges: finalEdges.length,
        incastCount: countType('incast'),
        outcastCount: countType('outcast'),
        opCount: countType('op'),
        tensorCount: countType('tensor'),
        groupCount: countType('group'),
      },
    };
  }

  function isGroupMode() {
    return viewMode === 'grouped';
  }

  function isLockedFlowMode() {
    return !!(lockedFlowState?.subgraph && lockedFlowState?.flowLayout);
  }

  function getActiveColorMode() {
    return colorMode;
  }

  function getActiveGraphState() {
    if (isLockedFlowMode()) {
      return { graph: lockedFlowState.subgraph, layout: lockedFlowState.flowLayout };
    }
    if (isGroupMode() && groupedGraph && groupedLayout) {
      return { graph: groupedGraph, layout: groupedLayout };
    }
    return { graph: sourceGraph, layout: sourceLayout };
  }

  function syncColorButtons() {
    document.querySelectorAll('.cp-btn[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === colorMode);
    });
  }

  function syncViewButtons() {
    document.querySelectorAll('.cp-btn[data-view-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.viewMode === viewMode);
    });
  }

  function syncPanelButtons() {
    syncColorButtons();
    syncViewButtons();
  }

  function isHugeGraphModel(graphModel) {
    if (!graphModel) return false;
    const nodeCount = graphModel.nodes?.length || 0;
    const edgeCount = graphModel.edges?.length || 0;
    return nodeCount >= HUGE_GRAPH_NODE_THRESHOLD || edgeCount >= HUGE_GRAPH_EDGE_THRESHOLD;
  }

  function getLayoutOptionsForGraph(graphModel, options = {}) {
    const preferDetail = !!options.preferDetail;
    const nodeCount = graphModel?.nodes?.length || 0;
    const edgeCount = graphModel?.edges?.length || 0;
    const compact = preferDetail
      ? (nodeCount >= GROUP_DETAIL_NODE_THRESHOLD || edgeCount >= GROUP_DETAIL_EDGE_THRESHOLD)
      : isHugeGraphModel(graphModel);
    return {
      ...PASS_LAYOUT_OPTS,
      compact,
    };
  }

  function computeLayoutForGraph(graphModel, options = {}) {
    const opts = getLayoutOptionsForGraph(graphModel, options);
    const nextLayout = computeLayout(graphModel, opts);
    nextLayout.compact = !!opts.compact;
    return nextLayout;
  }

  function buildGraphIndex(graphModel) {
    const nodeById = new Map();
    const incomingByTarget = new Map();
    const outgoingBySource = new Map();
    const nodes = graphModel?.nodes || [];
    const edges = graphModel?.edges || [];

    nodes.forEach(node => nodeById.set(node.id, node));
    edges.forEach(edge => {
      if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
      if (!outgoingBySource.has(edge.source)) outgoingBySource.set(edge.source, []);
      incomingByTarget.get(edge.target).push(edge.source);
      outgoingBySource.get(edge.source).push(edge.target);
    });

    return { nodeById, incomingByTarget, outgoingBySource };
  }

  function getGraphIndex(graphModel) {
    if (!graphModel) return null;
    const cached = graphIndexCache.get(graphModel);
    if (cached) return cached;
    const next = buildGraphIndex(graphModel);
    graphIndexCache.set(graphModel, next);
    return next;
  }

  function updateHugeGraphMode(graphModel) {
    const next = isHugeGraphModel(graphModel);
    if (next === hugeGraphMode) return;
    hugeGraphMode = next;
    document.body.classList.toggle('huge-graph-mode', hugeGraphMode);
  }

  function updateEdgeVisibilityByScale() {
    if (!edgesSvg) return;
    const shouldHide = hugeGraphMode && scale < HUGE_EDGE_HIDE_SCALE;
    if (shouldHide === edgesHiddenByScale) return false;
    edgesHiddenByScale = shouldHide;
    edgesSvg.style.visibility = shouldHide ? 'hidden' : 'visible';
    return true;
  }

  function shouldVirtualizeGraph() {
    return !!(hugeGraphMode && graph && layout && viewport);
  }

  function getViewportGraphRect() {
    const safeScale = Math.max(scale, 1e-6);
    const left = -tx / safeScale;
    const top = -ty / safeScale;
    const width = viewport.clientWidth / safeScale;
    const height = viewport.clientHeight / safeScale;
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

  function buildVirtualizedGraphModel(force = false) {
    if (!shouldVirtualizeGraph()) {
      renderedGraphModel = graph;
      virtualRenderWindow = null;
      return graph;
    }

    const viewportRect = getViewportGraphRect();
    const scaleDelta = Math.abs(scale - lastVirtualRenderScale) / Math.max(1e-6, lastVirtualRenderScale);
    if (!force && virtualRenderWindow && rectContainsRect(virtualRenderWindow, viewportRect) && scaleDelta < VIRTUAL_SCALE_FORCE_DELTA) {
      return null;
    }

    const pad = VIRTUAL_BUFFER_SCREEN_PX / Math.max(scale, 1e-6);
    const renderWindow = expandRect(viewportRect, pad);
    const visibleNodes = [];
    const visibleNodeIds = new Set();
    const positions = layout.positions;

    for (const node of graph.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const x2 = pos.x + pos.w;
      const y2 = pos.y + pos.h;
      const intersects = pos.x <= renderWindow.right
        && x2 >= renderWindow.left
        && pos.y <= renderWindow.bottom
        && y2 >= renderWindow.top;
      if (!intersects) continue;
      visibleNodes.push(node);
      visibleNodeIds.add(node.id);
    }

    const visibleEdges = [];
    if (!edgesHiddenByScale) {
      for (const edge of graph.edges) {
        if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue;
        visibleEdges.push(edge);
      }
    }

    renderedGraphModel = {
      nodes: visibleNodes,
      edges: visibleEdges,
      meta: graph.meta,
    };
    virtualRenderWindow = renderWindow;
    lastVirtualRenderScale = scale;
    return renderedGraphModel;
  }

  function renderViewportGraph({ force = false } = {}) {
    if (!graph || !layout) return;
    if (viewportRenderRaf) {
      cancelAnimationFrame(viewportRenderRaf);
      viewportRenderRaf = 0;
      viewportRenderForce = false;
    }
    const model = shouldVirtualizeGraph()
      ? buildVirtualizedGraphModel(force)
      : graph;
    if (!model) return;
    renderedGraphModel = model;
    renderCache = renderGraph(model, layout, nodesLayer, edgesSvg, handleNodeClick, colorMap, getActiveColorMode(), {
      compact: !!layout.compact,
      delegateEvents: true,
    });
    if (selectedNodeId) {
      selectNode(selectedNodeId, nodesLayer, edgesSvg, renderCache?.edgeElementsByNodeId);
    }
  }

  function scheduleViewportRender(force = false) {
    if (!shouldVirtualizeGraph()) return;
    if (force) viewportRenderForce = true;
    if (viewportRenderRaf) return;
    viewportRenderRaf = requestAnimationFrame(() => {
      const forceNow = viewportRenderForce;
      viewportRenderForce = false;
      viewportRenderRaf = 0;
      renderViewportGraph({ force: forceNow });
    });
  }

  function collectGraphSemanticKeys(graphModel) {
    const keys = [];
    (graphModel?.nodes || []).forEach(node => {
      const key = semanticKeyForNode(node);
      if (key) keys.push(key);
      if (node.type === 'group' && Array.isArray(node.data?.members)) {
        node.data.members.forEach(member => {
          if (member?.semanticKey) keys.push(member.semanticKey);
        });
      }
    });
    return keys;
  }

  function buildSubgraphKeyColorMap(graphModel, tensorToSg) {
    const keys = new Set();
    (graphModel?.nodes || []).forEach(node => {
      const key = subgraphKeyForNode(node, tensorToSg);
      if (key) keys.add(key);
      if (node.type === 'group' && Array.isArray(node.data?.members)) {
        node.data.members.forEach(member => {
          if (member?.type === 'incast' || member?.type === 'outcast') {
            keys.add('boundary');
            return;
          }
          if (member?.subgraphId != null) {
            keys.add('sg_' + member.subgraphId);
            return;
          }
          keys.add('sg_input');
        });
      }
    });
    return buildColorMap([...keys]);
  }

  function applyGroupMemberColors(graphModel, mode) {
    if (!graphModel?.nodes?.length) return;

    let semanticPalette = null;
    let subgraphPalette = null;
    let tensorToSg = null;

    if (mode === 'semantic') {
      semanticPalette = buildSemanticPipelineColorMap(collectGraphSemanticKeys(graphModel));
    } else if (mode === 'subgraph') {
      const nodeMap = new Map(graphModel.nodes.map(node => [node.id, node]));
      tensorToSg = new Map();
      graphModel.edges.forEach(edge => {
        const srcNode = nodeMap.get(edge.source);
        const key = subgraphKeyForNode(srcNode, tensorToSg);
        if (key && key.startsWith('sg_')) tensorToSg.set(edge.target, Number(key.slice(3)));
      });
      subgraphPalette = buildSubgraphKeyColorMap(graphModel, tensorToSg);
    }

    graphModel.nodes.forEach(node => {
      if (node.type !== 'group' || !Array.isArray(node.data?.members)) return;
      node.data.members.forEach(member => {
        let nextColor = null;
        if (mode === 'semantic') {
          nextColor = semanticColorForKey(member.semanticKey || 'tensor', semanticPalette);
        } else if (mode === 'subgraph') {
          let key = 'sg_input';
          if (member.type === 'incast' || member.type === 'outcast') key = 'boundary';
          else if (member.subgraphId != null) key = 'sg_' + member.subgraphId;
          nextColor = subgraphPalette.get(key) || '#666666';
        } else if (mode === 'latency') {
          nextColor = member.latency != null ? latencyToColor(member.latency) : '#606060';
        } else if (mode === 'engineMemory') {
          nextColor = engineMemoryColorForKey(member.engineMemoryKey) || '#6B7280';
        }
        member.color = nextColor || (member.type === 'tensor' ? '#606060' : '#666666');
      });
    });
  }

  function buildNodeColorMap(mode, graphModel) {
    if (!graphModel || mode === 'none') return null;

    let nodeIdMap = new Map();

    if (mode === 'semantic') {
      const pipelineMap = buildSemanticPipelineColorMap(collectGraphSemanticKeys(graphModel));
      graphModel.nodes.forEach(n => {
        const color = semanticColorForKey(semanticKeyForNode(n), pipelineMap);
        nodeIdMap.set(n.id, color);
      });
    } else if (mode === 'subgraph') {
      const nodeMap = new Map(graphModel.nodes.map(n => [n.id, n]));
      const tensorToSg = new Map();
      graphModel.edges.forEach(e => {
        const srcNode = nodeMap.get(e.source);
        const key = subgraphKeyForNode(srcNode, tensorToSg);
        if (key && key.startsWith('sg_')) {
          tensorToSg.set(e.target, Number(key.slice(3)));
        }
      });
      const keyColorMap = buildSubgraphKeyColorMap(graphModel, tensorToSg);
      graphModel.nodes.forEach(n => {
        const key = subgraphKeyForNode(n, tensorToSg);
        nodeIdMap.set(n.id, keyColorMap.get(key));
      });
    } else if (mode === 'latency') {
      graphModel.nodes.forEach(n => {
        let color = null;
        const latency = latencyValueForNode(n);
        if (latency != null) color = latencyToColor(latency);
        else if (n.type === 'tensor' || n.type === 'group') color = '#606060';
        nodeIdMap.set(n.id, color);
      });
    } else if (mode === 'engineMemory') {
      graphModel.nodes.forEach(n => {
        nodeIdMap.set(n.id, engineMemoryColorForKey(engineMemoryKeyForNode(n)));
      });
    }

    // Always pin boundary node colors regardless of mode
    if (mode !== 'engineMemory') {
      graphModel.nodes.forEach(n => {
        if (BOUNDARY_COLORS[n.type]) nodeIdMap.set(n.id, BOUNDARY_COLORS[n.type]);
      });
    }

    return nodeIdMap;
  }

  const LEGEND_LABELS = {
    'cat:MEMORY':       'Memory / Reshape',
    'cat:MATMUL':       'Matrix Multiply',
    'cat:ELEMENTWISE':  'Elementwise',
    'cat:REDUCE':       'Reduction',
    'cat:SPECIAL_MATH': 'Special Math',
    'cat:CAST':         'Precision Cast',
    'cat:COMMS':        'Data Movement',
    'boundary:incast':  'Graph Input',
    'boundary:outcast': 'Graph Output',
    'boundary':         'Boundary',
    'engine:vector':    'Vector Engine',
    'engine:cube':      'Cube Engine',
    'memory:gm':        'GM',
    'memory:l1':        'L1',
    'memory:l0':        'L0',
    'memory:ub':        'UB',
    'memory:local':     'Local',
    'memory:register':  'Register',
    'memory:workspace': 'Workspace',
    'memory:allocated': 'Allocated',
    'memory:unknown':   'Unknown',
    'sg_input':         'Unassigned / Input',
  };

  function legendLabel(key) {
    if (LEGEND_LABELS[key]) return LEGEND_LABELS[key];
    if (key.startsWith('sem:'))  return key.slice(4).replace(/-/g, ' ');
    if (key.startsWith('cat:'))  return key.slice(4);
    if (key.startsWith('op:'))   return key.slice(3);
    if (key.startsWith('sg_'))   return 'SG · ' + key.slice(3);
    return key;
  }

  function updateGraphStats(graphModel) {
    if (!graphModel || !graphStats) return;
    const countType = (type) => graphModel.nodes.filter(n => n.type === type).length;
    const groupCount = countType('group');
    const chips = [
      `<span class="stat-chip">${countType('incast')} incast</span>`,
      `<span class="stat-chip">${countType('op')} ops</span>`,
      `<span class="stat-chip">${countType('tensor')} tensors</span>`,
    ];
    if (groupCount > 0) chips.push(`<span class="stat-chip">${groupCount} groups</span>`);
    chips.push(`<span class="stat-chip">${countType('outcast')} outcast</span>`);
    graphStats.innerHTML = chips.join('');
  }

  function syncLockedFlowToolbar() {
    if (!graphLockExit) return;
    const active = isLockedFlowMode();
    graphLockExit.hidden = !active;
    if (!active) {
      if (graphLockLabel) graphLockLabel.textContent = '退出链路锁定';
      graphLockExit.title = '退出链路锁定';
      return;
    }
    const anchorLabel = lockedFlowState?.anchorLabel || 'Locked Flow';
    if (graphLockLabel) graphLockLabel.textContent = '退出链路锁定';
    graphLockExit.title = `退出链路锁定: ${anchorLabel}`;
  }

  function closeDetailAndSelection() {
    closeDetail();
    selectNode(null, nodesLayer, edgesSvg, renderCache?.edgeElementsByNodeId);
    selectedNodeId = null;
  }

  function renderActiveGraph({ fit = false } = {}) {
    const active = getActiveGraphState();
    graph = active.graph;
    layout = active.layout;
    if (!graph || !layout) return;
    activeGraphIndex = getGraphIndex(graph);
    updateHugeGraphMode(graph);
    renderedGraphModel = null;
    virtualRenderWindow = null;
    lastVirtualRenderScale = scale;
    if (viewportRenderRaf) {
      cancelAnimationFrame(viewportRenderRaf);
      viewportRenderRaf = 0;
      viewportRenderForce = false;
    }
    edgesHiddenByScale = false;
    edgesSvg.style.visibility = 'visible';
    if (graphTitle && sourceGraph?.meta?.name) {
      const suffix = isLockedFlowMode()
        ? ' · locked flow'
        : (isGroupMode() ? ' · grouped' : '');
      graphTitle.textContent = sourceGraph.meta.name + suffix;
    }

    const effectiveMode = getActiveColorMode();
    colorMap = buildNodeColorMap(effectiveMode, graph);
    applyGroupMemberColors(graph, effectiveMode);
    updateGraphStats(graph);
    syncLockedFlowToolbar();
    updateLegend();
    markMinimapBaseDirty();
    if (fit) {
      fitView();
      renderViewportGraph({ force: true });
      return;
    }
    updateEdgeVisibilityByScale();
    renderViewportGraph({ force: true });
    scheduleMinimapUpdate();
  }

  function setColorMode(mode) {
    const nextMode = mode || DEFAULT_COLOR_MODE;
    colorMode = nextMode;
    syncColorButtons();

    if (!sourceGraph) return;
    closeDetailAndSelection();
    renderActiveGraph();
  }

  function normalizeExternalColorMode(mode) {
    if (mode === 'semantic' || mode === 'subgraph' || mode === 'latency' || mode === 'engineMemory') {
      return mode;
    }
    return null;
  }

  function applyExternalColorMode(mode) {
    const nextMode = normalizeExternalColorMode(mode);
    if (!nextMode || nextMode === colorMode) return;
    setColorMode(nextMode);
  }

  function setViewMode(mode) {
    const nextMode = mode === 'grouped' && groupedGraph && groupedLayout ? 'grouped' : DEFAULT_VIEW_MODE;
    viewMode = nextMode;
    syncViewButtons();

    if (!sourceGraph) return;
    closeDetailAndSelection();
    renderActiveGraph();
  }

  function setMinimapCollapsed(collapsed) {
    minimapEl.classList.toggle('is-collapsed', !!collapsed);
    if (minimapToggle) {
      minimapToggle.title = collapsed ? 'Expand' : 'Collapse';
      minimapToggle.setAttribute('aria-label', collapsed ? 'Expand minimap' : 'Collapse minimap');
    }
    try { localStorage.setItem(LS_MINIMAP_COLLAPSED, collapsed ? '1' : '0'); } catch (_) {}
    if (!collapsed) scheduleMinimapUpdate();
  }

  function setColorPanelCollapsed(collapsed) {
    colorPanel.classList.toggle('is-collapsed', !!collapsed);
    if (colorPanelToggle) {
      colorPanelToggle.title = collapsed ? 'Expand' : 'Collapse';
      colorPanelToggle.setAttribute('aria-label', collapsed ? 'Expand color panel' : 'Collapse color panel');
    }
    try { localStorage.setItem(LS_COLOR_PANEL_COLLAPSED, collapsed ? '1' : '0'); } catch (_) {}
  }

  function initPanelCollapseState() {
    let minimapCollapsed = false;
    let colorCollapsed = false;
    try {
      minimapCollapsed = localStorage.getItem(LS_MINIMAP_COLLAPSED) === '1';
      colorCollapsed = localStorage.getItem(LS_COLOR_PANEL_COLLAPSED) === '1';
    } catch (_) {}
    setMinimapCollapsed(minimapCollapsed);
    setColorPanelCollapsed(colorCollapsed);
  }

  function updateLegend() {
    const legendEl = document.getElementById('legend');
    if (!legendEl) return;
    const activeColorMode = getActiveColorMode();
    const groupedView = isGroupMode() && !!groupedGraph;

    if (activeColorMode === 'none') {
      legendEl.innerHTML = `
        <span class="legend-item"><span class="legend-dot" style="background:var(--incast-accent)"></span>Incast</span>
        <span class="legend-item"><span class="legend-dot" style="background:var(--op-accent)"></span>Op</span>
        <span class="legend-item"><span class="legend-dot" style="background:var(--tensor-accent)"></span>Tensor</span>
        ${groupedView ? '<span class="legend-item"><span class="legend-dot" style="background:#5B73FF"></span>Group</span>' : ''}
        <span class="legend-item"><span class="legend-dot" style="background:var(--outcast-accent)"></span>Outcast</span>`;
      return;
    }

    if (activeColorMode === 'latency') {
      const latencies = graph
        ? graph.nodes
          .map(n => latencyValueForNode(n))
          .filter(latency => latency != null && latency > 0)
        : [];
      const minCy = latencies.length ? Math.min(...latencies) : 0;
      const maxCy = latencies.length ? Math.max(...latencies) : 0;
      const fmtCy = v => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'K cy' : v + ' cy';
      legendEl.innerHTML = `
        <span class="legend-item" style="flex-direction:column;align-items:stretch;gap:4px">
          <span class="legend-gradient"></span>
          <span style="display:flex;justify-content:space-between;font-size:10px;opacity:0.50">
            <span>${fmtCy(minCy)}</span><span>${fmtCy(maxCy)}</span>
          </span>
        </span>`;
      return;
    }

    if (!colorMap) { legendEl.innerHTML = ''; return; }

    // Collect key → { color, count }
    const keyData = new Map();
    graph.nodes.forEach(n => {
      let key;
      if (activeColorMode === 'semantic') {
        key = semanticKeyForNode(n);
        if (key === 'tensor' || key === 'boundary:incast' || key === 'boundary:outcast') return;
      } else if (activeColorMode === 'engineMemory') {
        key = engineMemoryKeyForNode(n);
        if (!key) return;
      } else {
        // subgraph: only show op/boundary in legend
        if (n.type === 'tensor') return;
        key = n.type === 'group' && n.data?.groupType !== 'op'
          ? null
          : subgraphKeyForNode(n);
        if (!key) return;
      }
      if (!key) return;
      const color = colorMap.get(n.id);
      if (!keyData.has(key)) keyData.set(key, { color: color || null, count: 0 });
      keyData.get(key).count++;
    });

    const entries = [...keyData.entries()]
      .filter(([, v]) => v.color)
      .map(([key, v]) => ({ key, color: v.color, count: v.count }));

    const MAX = 12;
    const shown = entries.slice(0, MAX);
    const extra = entries.length - shown.length;

    legendEl.innerHTML = shown.map(({ key, color, count }) =>
      `<span class="legend-item"><span class="legend-dot" style="background:${color}"></span><span class="legend-item-label">${legendLabel(key)}</span><span class="legend-item-count">(${count})</span></span>`
    ).join('') + (extra > 0 ? `<span class="legend-item" style="opacity:0.45">+${extra}</span>` : '');
  }

  function updateModeAvailability() {
    if (!sourceGraph) return;
    const hasPartition = sourceGraph.nodes.some(n => n.type === 'op' && n.data.subgraphId != null && n.data.subgraphId >= 0);
    const hasCost = sourceGraph.nodes.some(n => n.type === 'op' && n.data.latency != null);
    const hasGroupedView = !!(groupedGraph && groupedGraph.nodes.some(n => n.type === 'group'));
    setModeEnabled('subgraph', hasPartition);
    setModeEnabled('latency', hasCost);
    setViewModeEnabled('grouped', hasGroupedView);
  }

  function setModeEnabled(mode, enabled) {
    document.querySelectorAll(`.cp-btn[data-mode="${mode}"]`).forEach(btn => {
      btn.disabled = !enabled;
      btn.classList.toggle('disabled', !enabled);
    });
    if (!enabled && colorMode === mode) setColorMode(DEFAULT_COLOR_MODE);
  }

  function setViewModeEnabled(mode, enabled) {
    document.querySelectorAll(`.cp-btn[data-view-mode="${mode}"]`).forEach(btn => {
      btn.disabled = !enabled;
      btn.classList.toggle('disabled', !enabled);
    });
    if (!enabled && viewMode === mode) setViewMode(DEFAULT_VIEW_MODE);
  }

  // ── File loading ───────────────────────────────────────────────

  function normalizePath(v) {
    return String(v || '').replace(/\\/g, '/');
  }

  function toLocalRef(relativePath) {
    return 'local::' + normalizePath(relativePath);
  }

  function clearLocalRefs() {
    localFileRefs.clear();
  }

  function readAndLoadLocalFile(file, displayName) {
    return file.text()
      .then(text => {
        const data = JSON.parse(text);
        loadGraphData(data, displayName || file.name);
      });
  }

  function loadRefFile(fileRef) {
    const localFile = localFileRefs.get(fileRef);
    if (localFile) {
      readAndLoadLocalFile(localFile, localFile.name)
        .catch(err => {
          console.error('Nav: failed to load local ref', fileRef, err);
          alert('Failed to parse local graph file:\n' + (err?.message || err));
        });
      return;
    }

    fetch(fileRef)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => loadGraphData(d, fileRef.split('/').pop()))
      .catch(err => console.error('Nav: failed to load', fileRef, err));
  }

  window.loadFile = (fileRef) => {
    if (!fileRef) return;
    loadRefFile(fileRef);
  };

  const LS_JSON = 'pto_last_json';
  const LS_NAME = 'pto_last_name';
  const BRIDGE_SWIMLANE_META = 'ptoSwimlaneProgramMeta';
  const BRIDGE_SWIMLANE_TEXT = 'ptoSwimlaneProgramText';
  const BRIDGE_SWIMLANE_FOCUS = 'ptoSwimlanePassFocus';
  let pendingExternalFocus = null;

  function consumeSwimlaneBridgePayload() {
    try {
      const metaText = sessionStorage.getItem(BRIDGE_SWIMLANE_META);
      const graphText = sessionStorage.getItem(BRIDGE_SWIMLANE_TEXT);
      const focusText = sessionStorage.getItem(BRIDGE_SWIMLANE_FOCUS);
      if (!graphText) return null;
      const meta = metaText ? JSON.parse(metaText) : {};
      const focus = focusText ? JSON.parse(focusText) : null;
      sessionStorage.removeItem(BRIDGE_SWIMLANE_META);
      sessionStorage.removeItem(BRIDGE_SWIMLANE_TEXT);
      sessionStorage.removeItem(BRIDGE_SWIMLANE_FOCUS);
      return {
        data: JSON.parse(graphText),
        name: meta?.name || 'program.json',
        focus,
      };
    } catch (error) {
      console.error('Failed to consume swimlane bridge payload:', error);
      return null;
    }
  }

  function normalizeOpaqueId(value) {
    if (value == null || value === '') return null;
    const text = String(value)
      .trim()
      .replace(/^[`'"]+|[`'"]+$/g, '')
      .replace(/[;,\]}]+$/g, '')
      .trim();
    if (!text) return null;
    return /^0x/i.test(text) ? text.toLowerCase() : text;
  }

  function findExternalFocusTarget(focus) {
    if (!focus || !sourceGraph?.nodes?.length) return null;
    const nodes = sourceGraph.nodes;
    if (focus.callOpMagic != null) {
      const magic = normalizeOpaqueId(focus.callOpMagic);
      const byMagic = nodes.find(node => {
        if (node.type !== 'op') return false;
        return normalizeOpaqueId(node.data?.magic ?? node.data?.opmagic) === magic;
      });
      if (byMagic) return byMagic;
    }
    if (focus.semanticLabel) {
      const bySemantic = nodes.find(node => node.type === 'op' && node.data?.semanticLabel === focus.semanticLabel);
      if (bySemantic) return bySemantic;
    }
    return null;
  }

  function applyPendingExternalFocus() {
    if (!pendingExternalFocus) return;
    const focus = pendingExternalFocus;
    pendingExternalFocus = null;
    const target = findExternalFocusTarget(focus);
    if (!target) return;
    if (focus.semanticLabel && colorMode !== 'semantic') setColorMode('semantic');
    centerOnActiveNode(target, { openDetailPanel: true });
  }

  function loadGraphData(data, fileName) {
    sourceGraph = parseGraph(data);
    annotateGraphModel(sourceGraph);
    sourceLayout = computeLayoutForGraph(sourceGraph);
    sourceGraphIndex = getGraphIndex(sourceGraph);

    groupedGraph = buildGroupedGraphModel(sourceGraph, sourceLayout);
    if (groupedGraph === sourceGraph) {
      groupedLayout = sourceLayout;
    } else {
      // Group view should prefer full cards (with tags/details) unless still very large.
      groupedLayout = groupedGraph ? computeLayoutForGraph(groupedGraph, { preferDetail: true }) : null;
      if (groupedGraph) getGraphIndex(groupedGraph);
    }

    if (viewMode === 'grouped' && !(groupedGraph && groupedLayout)) {
      viewMode = DEFAULT_VIEW_MODE;
    }
    syncPanelButtons();

    updateModeAvailability();
    emptyState.classList.add('hidden');
    minimapEl.classList.add('visible');
    colorPanel.classList.add('visible');
    closeDetailAndSelection();
    renderActiveGraph({ fit: true });
    if (lockedFlowState) retrackLockedFlow();

    // Cache to localStorage
    try {
      const name = fileName || sourceGraph.meta.name || 'graph.json';
      localStorage.setItem(LS_JSON, JSON.stringify(data));
      localStorage.setItem(LS_NAME, name);
      setRecentChip(name);
    } catch (_) {}

    setTimeout(() => applyPendingExternalFocus(), 0);
  }

  function setRecentChip(name) {
    if (!name) { recentRow.classList.add('hidden'); return; }
    recentName.textContent = name;
    recentRow.classList.remove('hidden');
  }

  function loadJSON(file) {
    readAndLoadLocalFile(file, file.name)
      .catch(err => {
        console.error(err);
        alert('Failed to parse JSON:\n' + (err?.message || err));
      });
  }

  function applyLocalPassFolder(entries, sourceLabel) {
    if (!window.buildNavIndexFromFileEntries) {
      alert('Local folder indexing is unavailable (missing nav_index_builder.js).');
      return;
    }
    if (!entries.length) {
      alert('No JSON files found in selected folder.');
      return;
    }

    clearLocalRefs();
    const builderEntries = [];
    for (const entry of entries) {
      const rel = normalizePath(entry.relativePath);
      if (!rel.toLowerCase().endsWith('.json')) continue;
      const ref = toLocalRef(rel);
      localFileRefs.set(ref, entry.file);
      builderEntries.push({ relativePath: rel, ref });
    }

    const navIndex = window.buildNavIndexFromFileEntries(builderEntries, { basePath: sourceLabel || 'local' });
    if (!navIndex?.passes?.length) {
      alert('Selected folder does not look like output_deepseek Pass snapshots.');
      return;
    }
    if (window.setNavIndex) window.setNavIndex(navIndex, { sourceLabel: sourceLabel || 'local' });

    // 显示 cf-panel（首次加载文件夹后）
    const cfPanel = document.getElementById('cfPanel');
    if (cfPanel && !cfPanel.classList.contains('cf-visible')) {
      cfPanel.classList.add('cf-visible');
      const reopenBtn = document.getElementById('cfReopenBtn');
      if (reopenBtn) reopenBtn.style.display = 'none';
      setTimeout(() => { if (window.drawMappingLines) window.drawMappingLines(null); }, 260);
    }
  }

  async function collectHandleEntries(handle, prefix = '') {
    const out = [];
    for await (const [name, child] of handle.entries()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (child.kind === 'directory') {
        const sub = await collectHandleEntries(child, rel);
        out.push(...sub);
      } else if (name.toLowerCase().endsWith('.json')) {
        const file = await child.getFile();
        out.push({ relativePath: rel, file });
      }
    }
    return out;
  }

  function openBridgeDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(BRIDGE_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BRIDGE_STORE)) db.createObjectStore(BRIDGE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function consumePendingDirHandle(token) {
    if (!token) return false;

    const db = await openBridgeDb();
    let dirHandle = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BRIDGE_STORE, 'readwrite');
      const store = tx.objectStore(BRIDGE_STORE);
      const getReq = store.get(token);
      getReq.onsuccess = () => {
        dirHandle = getReq.result || null;
        if (dirHandle) store.delete(token);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();

    if (!dirHandle || dirHandle.kind !== 'directory') return false;

    if (typeof dirHandle.queryPermission === 'function') {
      let perm = await dirHandle.queryPermission({ mode: 'read' });
      if (perm === 'prompt' && typeof dirHandle.requestPermission === 'function') {
        perm = await dirHandle.requestPermission({ mode: 'read' });
      }
      if (perm !== 'granted') return false;
    }

    const entries = await collectHandleEntries(dirHandle);
    applyLocalPassFolder(entries, dirHandle.name || 'local');
    return true;
  }

  async function openLocalPassFolder() {
    if (window.showDirectoryPicker) {
      try {
        const dirHandle = await window.showDirectoryPicker({ id: 'pto-pass-folder' });
        const entries = await collectHandleEntries(dirHandle);
        applyLocalPassFolder(entries, dirHandle.name);
      } catch (err) {
        if (err?.name !== 'AbortError') console.error('Folder picker failed:', err);
      }
      return;
    }
    dirInput.click();
  }

  function xhrLoadJson(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); } };
      xhr.onerror = () => reject(new Error('XHR error'));
      xhr.send();
    });
  }

  // Wire sample chips (empty-state cards)
  document.querySelectorAll('.sample-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.dataset.sample;
      const label = chip.dataset.label;
      xhrLoadJson(url)
        .then(data => loadGraphData(data, label))
        .catch(() => alert('Failed to load sample.\nTry serving the app via a local server (e.g. npx serve .)'));
    });
  });

  // ── Graph picker dropdown ───────────────────────────────────────
  loadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    graphMenu.classList.toggle('open');
  });

  // Menu sample items
  graphMenu.querySelectorAll('.graph-menu-item[data-sample]').forEach(item => {
    item.addEventListener('click', () => {
      graphMenu.classList.remove('open');
      const url = item.dataset.sample;
      const label = item.dataset.label;
      xhrLoadJson(url)
        .then(data => loadGraphData(data, label))
        .catch(() => alert('Failed to load sample.\nTry serving the app via a local server (e.g. npx serve .)'));
    });
  });

  // Menu local file item
  graphMenuLocal.addEventListener('click', () => {
    graphMenu.classList.remove('open');
    fileInput.click();
  });

  // Menu local folder item
  graphMenuDir.addEventListener('click', () => {
    graphMenu.classList.remove('open');
    openLocalPassFolder();
  });

  // Close menu on outside click
  document.addEventListener('click', (e) => {
    if (!graphPicker.contains(e.target)) graphMenu.classList.remove('open');
  });

  // Wire recent chip
  recentChip.addEventListener('click', () => {
    try {
      const cached = localStorage.getItem(LS_JSON);
      if (cached) loadGraphData(JSON.parse(cached), localStorage.getItem(LS_NAME));
    } catch (_) {}
  });

  // Init recent chip display
  (() => {
    const name = localStorage.getItem(LS_NAME);
    setRecentChip(name);
  })();

  // Auto-load from URL params
  const urlParams = new URLSearchParams(location.search);
  const urlFile = urlParams.get('file');
  const urlAction = urlParams.get('action');
  const urlToken = urlParams.get('token');
  const bridgePayload = urlAction === 'open-file' ? consumeSwimlaneBridgePayload() : null;

  if (urlFile) {
    xhrLoadJson(urlFile)
      .then(data => loadGraphData(data, urlFile.split('/').pop()))
      .catch(err => { emptyState.classList.remove('hidden'); console.error('Failed to load', urlFile, err); });
  } else if (bridgePayload?.data) {
    pendingExternalFocus = bridgePayload.focus || null;
    loadGraphData(bridgePayload.data, bridgePayload.name);
  } else if (urlAction === 'consume-folder') {
    // Folder handle selected on launch page; consume and auto-load here.
    setTimeout(() => {
      consumePendingDirHandle(urlToken)
        .then(ok => { if (!ok) return openLocalPassFolder(); return null; })
        .catch(err => {
          console.error('Consume pending folder failed:', err);
          return openLocalPassFolder();
        });
    }, 0);
  } else if (urlAction === 'open-folder') {
    // Reuse existing folder-loading flow from index.html
    setTimeout(() => {
      openLocalPassFolder().catch(err => console.error('Auto open folder failed:', err));
    }, 0);
  } else if (urlAction === 'open-file') {
    // Reuse existing local file picker flow from index.html
    setTimeout(() => fileInput.click(), 0);
  }

  emptyLoadBtn.addEventListener('click', () => openLocalPassFolder());
  document.getElementById('emptyLoadFileBtn')?.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadJSON(e.target.files[0]);
    e.target.value = '';
  });

  dirInput.addEventListener('change', (e) => {
    const files = [...(e.target.files || [])].filter(f => f.name.toLowerCase().endsWith('.json'));
    const entries = files.map(file => ({
      relativePath: normalizePath(file.webkitRelativePath || file.name),
      file,
    }));
    const folderName = files[0]?.webkitRelativePath?.split('/')?.[0] || 'local-folder';
    applyLocalPassFolder(entries, folderName);
    e.target.value = '';
  });

  viewport.addEventListener('dragover', (e) => { e.preventDefault(); viewport.classList.add('drag-over'); });
  viewport.addEventListener('dragleave', () => viewport.classList.remove('drag-over'));
  viewport.addEventListener('drop', (e) => {
    e.preventDefault();
    viewport.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith('.json')) loadJSON(f); // loadJSON passes f.name
  });

  // ── Transform ─────────────────────────────────────────────────
  function applyTransform(animate) {
    graphRoot.style.transition = animate ? 'transform 0.22s ease' : '';
    graphRoot.style.transform  = `translate(${tx}px,${ty}px) scale(${scale})`;
    zoomLabel.textContent = Math.round(scale * 100) + '%';
    if (animate) setTimeout(() => { graphRoot.style.transition = ''; }, 250);
    const edgeVisibilityChanged = updateEdgeVisibilityByScale();
    scheduleViewportRender(!!edgeVisibilityChanged);
    scheduleMinimapUpdate();
  }

  function fitView() {
    if (!layout?.canvasW) return;
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const pad = 48;
    scale = Math.min((vw - pad * 2) / layout.canvasW, (vh - pad * 2) / layout.canvasH, 1);
    tx = (vw - layout.canvasW * scale) / 2;
    ty = (vh - layout.canvasH * scale) / 2;
    applyTransform(true);
  }

  function zoomAround(cx, cy, factor) {
    const ns = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale * factor));
    const r  = ns / scale;
    tx = cx - r * (cx - tx);
    ty = cy - r * (cy - ty);
    scale = ns;
    applyTransform(false);
  }

  fitBtn.addEventListener('click', fitView);
  zoomInBtn.addEventListener('click',  () => zoomAround(viewport.clientWidth / 2, viewport.clientHeight / 2, 1.25));
  zoomOutBtn.addEventListener('click', () => zoomAround(viewport.clientWidth / 2, viewport.clientHeight / 2, 0.8));

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoomAround(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 0.89);
  }, { passive: false });

  // Mouse pan
  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node-card') || e.target.closest('.detail-panel')) return;
    panning = true;
    panStart = { x: e.clientX - tx, y: e.clientY - ty };
    viewport.classList.add('panning');
  });
  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    tx = e.clientX - panStart.x;
    ty = e.clientY - panStart.y;
    applyTransform(false);
  });
  window.addEventListener('mouseup', () => { panning = false; viewport.classList.remove('panning'); });

  // Touch
  let touchCache = {}, lastPinchDist = null;
  viewport.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) touchCache[t.identifier] = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  viewport.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0], prev = touchCache[t.identifier];
      if (prev) { tx += t.clientX - prev.x; ty += t.clientY - prev.y; applyTransform(false); }
      touchCache[t.identifier] = { x: t.clientX, y: t.clientY };
    } else if (e.touches.length === 2) {
      const [t0, t1] = e.touches;
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      if (lastPinchDist) {
        const rect = viewport.getBoundingClientRect();
        zoomAround((t0.clientX + t1.clientX) / 2 - rect.left, (t0.clientY + t1.clientY) / 2 - rect.top, dist / lastPinchDist);
      }
      lastPinchDist = dist;
    }
  }, { passive: false });
  viewport.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) delete touchCache[t.identifier];
    if (e.touches.length < 2) lastPinchDist = null;
  }, { passive: true });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDetail(); selectNode(null, nodesLayer, edgesSvg, renderCache?.edgeElementsByNodeId); selectedNodeId = null; }
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) fitView();
    if ((e.key === '+' || e.key === '=') && !e.metaKey) zoomAround(viewport.clientWidth/2, viewport.clientHeight/2, 1.2);
    if (e.key === '-' && !e.metaKey) zoomAround(viewport.clientWidth/2, viewport.clientHeight/2, 1/1.2);
  });

  window.addEventListener('resize', () => {
    if (!graph || !layout) return;
    virtualRenderWindow = null;
    scheduleViewportRender(true);
    scheduleMinimapUpdate();
  });

  viewport.addEventListener('click', (e) => {
    if (!e.target.closest('.node-card') && !e.target.closest('.detail-panel')) {
      closeDetail();
      selectNode(null, nodesLayer, edgesSvg, renderCache?.edgeElementsByNodeId);
      selectedNodeId = null;
    }
  });

  // ── Node selection ─────────────────────────────────────────────
  function handleNodeClick(node) {
    selectedNodeId = node.id;
    selectNode(node.id, nodesLayer, edgesSvg, renderCache?.edgeElementsByNodeId);
    openDetail(node);
  }

  function handleGroupMemberClick(groupNode, memberNodeId) {
    if (!sourceGraph?.nodes?.length || !memberNodeId) return;
    const target = (sourceGraphIndex || getGraphIndex(sourceGraph))?.nodeById.get(memberNodeId);
    if (!target) return;

    if (groupNode?.id) {
      selectedNodeId = groupNode.id;
      selectNode(groupNode.id, nodesLayer, edgesSvg, renderCache?.edgeElementsByNodeId);
    }
    openDetail(target, sourceGraph);
  }

  nodesLayer.addEventListener('click', (e) => {
    const memberEl = e.target.closest('.group-stack-item[data-member-node-id]');
    if (memberEl && nodesLayer.contains(memberEl)) {
      const groupCard = memberEl.closest('.node-card[data-node-id]');
      const groupNodeId = groupCard?.dataset?.nodeId;
      const groupNode = groupNodeId ? activeGraphIndex?.nodeById.get(groupNodeId) : null;
      handleGroupMemberClick(groupNode, memberEl.dataset.memberNodeId);
      e.stopPropagation();
      return;
    }

    const nodeEl = e.target.closest('.node-card[data-node-id]');
    if (!nodeEl || !nodesLayer.contains(nodeEl)) return;
    const nodeId = nodeEl.dataset.nodeId;
    if (!nodeId) return;
    const node = activeGraphIndex?.nodeById.get(nodeId);
    if (!node) return;
    handleNodeClick(node);
    e.stopPropagation();
  });

  // ── Locked Flow Panel ──────────────────────────────────────────
  const flowPanel      = document.getElementById('flowPanel');
  const flowViewport   = document.getElementById('flowViewport');
  const flowGraphRoot  = document.getElementById('flowGraphRoot');
  const flowEdgesSvg   = document.getElementById('flowEdgesSvg');
  const flowNodesLayer = document.getElementById('flowNodesLayer');
  const flowStatsEl    = document.getElementById('flowStats');
  const flowUnlockBtn  = document.getElementById('flowUnlock');
  const detailLockBtn  = document.getElementById('detailLock');

  function resolveSourceNodeId(node, graphModel = graph) {
    if (!node || !sourceGraph) return null;
    const sourceIndex = sourceGraphIndex || getGraphIndex(sourceGraph);
    if (sourceIndex?.nodeById?.has(node.id)) return node.id;

    const magic = node.data?.magic;
    if (magic == null) return null;

    const nodeType = node.type;
    const fallbackGraph = graphModel || sourceGraph;
    const fallbackNodes = fallbackGraph?.nodes || [];
    const sourceNodes = sourceGraph.nodes || [];

    // Prefer matching by magic + type, which is more stable than label across views.
    const inSource = sourceNodes.find(n => n.type === nodeType && n.data?.magic === magic);
    if (inSource) return inSource.id;

    // Fallback for cases where the node came from a derived/detail model.
    const candidate = fallbackNodes.find(n => n.id === node.id || (n.type === nodeType && n.data?.magic === magic));
    if (candidate && sourceIndex?.nodeById?.has(candidate.id)) return candidate.id;
    return null;
  }

  function isDetailFlowLocked() {
    return !!(lockedFlowState && detailSourceNodeId && lockedFlowState.anchorSourceNodeId === detailSourceNodeId);
  }

  function syncDetailLockButton() {
    if (!detailLockBtn) return;
    const enabled = !!detailSourceNodeId;
    detailLockBtn.disabled = !enabled;
    detailLockBtn.classList.toggle('locked', isDetailFlowLocked());
    detailLockBtn.title = !enabled
      ? 'Current detail node cannot be locked'
      : (isDetailFlowLocked() ? 'Unlock compute flow' : 'Lock compute flow');
  }

  function collectReachableNodes(startNodeId, adjacency) {
    const visited = new Set([startNodeId]);
    const queue = [startNodeId];
    let i = 0;
    while (i < queue.length) {
      const cur = queue[i++];
      for (const nextId of adjacency.get(cur) || []) {
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        queue.push(nextId);
      }
    }
    return visited;
  }

  function extractFlowSubgraph(nodeId, graphModel) {
    const { nodes, edges } = graphModel;
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const pred = new Map(nodes.map(n => [n.id, []]));
    const succ = new Map(nodes.map(n => [n.id, []]));
    for (const e of edges) {
      if (pred.has(e.target) && succ.has(e.source)) {
        pred.get(e.target).push(e.source);
        succ.get(e.source).push(e.target);
      }
    }
    const upstream = collectReachableNodes(nodeId, pred);
    const downstream = collectReachableNodes(nodeId, succ);
    const visibleNodeIds = new Set([...upstream, ...downstream]);
    const subgraphNodes = nodes.filter(n => visibleNodeIds.has(n.id) && nodeMap.has(n.id));
    const subgraphEdges = edges.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
    return {
      nodes: subgraphNodes,
      edges: subgraphEdges,
      meta: buildSubgraphMeta(graphModel.meta, subgraphNodes, subgraphEdges),
    };
  }

  function buildSubgraphMeta(baseMeta, nodes, edges) {
    const countType = (type) => nodes.filter(n => n.type === type).length;
    return {
      ...(baseMeta || {}),
      totalNodes: nodes.length,
      totalEdges: edges.length,
      incastCount: countType('incast'),
      outcastCount: countType('outcast'),
      opCount: countType('op'),
      tensorCount: countType('tensor'),
      groupCount: countType('group'),
    };
  }

  function centerOnActiveNode(node, { openDetailPanel = false } = {}) {
    if (!layout) return false;
    const pos = layout.positions.get(node.id);
    if (!pos) return false;
    const cx = pos.x + pos.w / 2;
    const cy = pos.y + pos.h / 2;
    tx = viewport.clientWidth / 2 - cx * scale;
    ty = viewport.clientHeight / 2 - cy * scale;
    applyTransform(true);
    renderViewportGraph({ force: true });
    selectedNodeId = node.id;
    selectNode(node.id, nodesLayer, edgesSvg, renderCache?.edgeElementsByNodeId);
    if (openDetailPanel) openDetail(node);
    return true;
  }

  function lockComputeFlow(nodeId) {
    if (!sourceGraph) return;
    const node = (sourceGraphIndex || getGraphIndex(sourceGraph)).nodeById.get(nodeId);
    if (!node) return;
    if (isGroupMode()) {
      viewMode = DEFAULT_VIEW_MODE;
      syncViewButtons();
    }
    const subgraph = extractFlowSubgraph(nodeId, sourceGraph);
    const flowLayout = computeLayoutForGraph(subgraph, { preferDetail: true });
    selectedNodeId = node.id;
    lockedFlowState = {
      anchorSourceNodeId: node.id,
      anchorLabel: node.label,
      anchorType: node.type,
      anchorMagic: node.data?.magic ?? null,
      subgraph,
      flowLayout,
      nodeCount: subgraph.nodes.length,
    };
    flowPanel?.classList.remove('open');
    renderActiveGraph({ fit: true });
    openDetail(node, sourceGraph);
    syncDetailLockButton();
  }

  function unlockComputeFlow() {
    if (!lockedFlowState) return;
    const anchorSourceNodeId = lockedFlowState.anchorSourceNodeId;
    lockedFlowState = null;
    flowPanel?.classList.remove('open');
    renderActiveGraph();
    const anchor = (sourceGraphIndex || getGraphIndex(sourceGraph))?.nodeById.get(anchorSourceNodeId);
    const keepDetailOpen = detailPanel.classList.contains('open');
    if (!anchor || isGroupMode() || !centerOnActiveNode(anchor, { openDetailPanel: keepDetailOpen })) {
      fitView();
      renderViewportGraph({ force: true });
      if (keepDetailOpen && anchor) openDetail(anchor, sourceGraph);
    }
    syncDetailLockButton();
  }

  function findLockedFlowAnchor() {
    if (!lockedFlowState || !sourceGraph?.nodes?.length) return null;
    const sourceIndex = sourceGraphIndex || getGraphIndex(sourceGraph);
    if (sourceIndex?.nodeById?.has(lockedFlowState.anchorSourceNodeId)) {
      return sourceIndex.nodeById.get(lockedFlowState.anchorSourceNodeId);
    }
    if (lockedFlowState.anchorMagic != null) {
      const byMagic = sourceGraph.nodes.find(n =>
        n.type === lockedFlowState.anchorType && n.data?.magic === lockedFlowState.anchorMagic
      );
      if (byMagic) return byMagic;
    }
    return sourceGraph.nodes.find(n =>
      n.type === lockedFlowState.anchorType && n.label === lockedFlowState.anchorLabel
    ) || null;
  }

  function retrackLockedFlow() {
    if (!lockedFlowState || !sourceGraph) return;
    const newAnchor = findLockedFlowAnchor();
    if (!newAnchor) { unlockComputeFlow(); return; }
    const subgraph = extractFlowSubgraph(newAnchor.id, sourceGraph);
    const flowLayout = computeLayoutForGraph(subgraph, { preferDetail: true });
    lockedFlowState = {
      ...lockedFlowState,
      anchorSourceNodeId: newAnchor.id,
      anchorLabel: newAnchor.label,
      anchorType: newAnchor.type,
      anchorMagic: newAnchor.data?.magic ?? lockedFlowState.anchorMagic,
      subgraph,
      flowLayout,
      nodeCount: subgraph.nodes.length,
    };
    selectedNodeId = newAnchor.id;
    renderActiveGraph({ fit: true });
    if (detailPanel.classList.contains('open')) openDetail(newAnchor, sourceGraph);
    syncDetailLockButton();
  }

  detailLockBtn?.addEventListener('click', () => {
    if (!detailSourceNodeId) return;
    if (isDetailFlowLocked()) unlockComputeFlow();
    else lockComputeFlow(detailSourceNodeId);
  });
  flowUnlockBtn?.addEventListener('click', unlockComputeFlow);
  graphLockExit?.addEventListener('click', unlockComputeFlow);
  syncDetailLockButton();
  syncLockedFlowToolbar();

  // ── Detail panel ───────────────────────────────────────────────
  const TYPE_STYLES = {
    incast:  { bg: 'var(--incast-accent-dim)',  color: 'var(--incast-accent)' },
    outcast: { bg: 'var(--outcast-accent-dim)', color: 'var(--outcast-accent)' },
    op:      { bg: 'var(--op-accent-dim)',       color: 'var(--op-accent)' },
    tensor:  { bg: 'var(--tensor-accent-dim)',   color: 'var(--tensor-accent)' },
    group:   { bg: 'rgba(91,115,255,0.18)',      color: '#5B73FF' },
  };

  function openDetail(node, graphModel = graph) {
    const detailModel = graphModel || graph;
    const detailIndex = getGraphIndex(detailModel);
    const sourceIndex = sourceGraph ? (sourceGraphIndex || getGraphIndex(sourceGraph)) : null;
    const ts = TYPE_STYLES[node.type] || TYPE_STYLES.tensor;
    detailBadge.textContent = node.type.toUpperCase();
    detailBadge.style.background = ts.bg;
    detailBadge.style.color      = ts.color;
    detailName.textContent = node.label;
    detailBody.innerHTML   = buildDetailContent(node, detailModel, detailIndex);
    detailSourceNodeId = resolveSourceNodeId(node, detailModel);

    detailBody.querySelectorAll('[data-nav]').forEach(chip => {
      chip.addEventListener('click', () => {
        const navId = chip.dataset.nav;
        if (!navId) return;
        const fromGraphModel = detailIndex?.nodeById.get(navId);
        const fromSource = sourceIndex?.nodeById.get(navId);
        const target = fromGraphModel || fromSource;
        if (!target) return;

        const hasActivePosition = !!layout?.positions?.get(target.id);
        if (hasActivePosition) {
          navigateToNode(target);
        } else {
          openDetail(target, sourceGraph || detailModel);
        }
      });
    });
    syncDetailLockButton();
    detailPanel.classList.add('open');
  }

  function closeDetail() {
    detailPanel.classList.remove('open');
    detailSourceNodeId = null;
    syncDetailLockButton();
  }
  detailClose.addEventListener('click', () => { closeDetail(); selectNode(null, nodesLayer, edgesSvg, renderCache?.edgeElementsByNodeId); selectedNodeId = null; });

  function navigateToNode(node) {
    centerOnActiveNode(node, { openDetailPanel: true });
  }

  // ── Minimap ────────────────────────────────────────────────────
  function markMinimapBaseDirty() {
    minimapBaseDirty = true;
  }

  function blitMinimapBase() {
    const ctx = minimapCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    ctx.drawImage(minimapBaseCanvas, 0, 0);
  }

  function rebuildMinimapBase() {
    if (!graph || !layout || !minimapBaseCtx) return;
    if (minimapEl.classList.contains('is-collapsed')) return;
    const { positions, canvasW, canvasH } = layout;
    if (!positions.size) return;

    const mw = minimapCanvas.width;
    const mh = minimapCanvas.height;
    if (minimapBaseCanvas.width !== mw || minimapBaseCanvas.height !== mh) {
      minimapBaseCanvas.width = mw;
      minimapBaseCanvas.height = mh;
    }
    minimapBaseCtx.clearRect(0, 0, mw, mh);

    const gs = Math.min(mw / (canvasW || 1), mh / (canvasH || 1)) * 0.92;
    const ox = (mw - (canvasW || 0) * gs) / 2;
    const oy = (mh - (canvasH || 0) * gs) / 2;
    minimapTransform = { gs, ox, oy };

    const TYPE_COLORS = { incast:'#87C80F', outcast:'#C9107D', op:'#3577F6', tensor:'#A855F7', group:'#5B73FF' };
    for (const node of graph.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const mapped = colorMap?.get(node.id);
      const baseColor = (mapped != null ? mapped : null) ?? (TYPE_COLORS[node.type] || '#555');
      minimapBaseCtx.fillStyle = baseColor + 'AA';
      minimapBaseCtx.fillRect(
        Math.round(pos.x * gs + ox), Math.round(pos.y * gs + oy),
        Math.max(2, Math.round(pos.w * gs)), Math.max(1, Math.round(pos.h * gs))
      );
    }

    minimapBaseDirty = false;
    blitMinimapBase();
  }

  function syncMinimapViewportRect() {
    if (!graph || !layout) return;
    if (minimapEl.classList.contains('is-collapsed')) return;
    const { gs, ox, oy } = minimapTransform;
    if (!gs) return;
    const vLeft  = -tx / scale;
    const vTop   = -ty / scale;
    const vW     = viewport.clientWidth  / scale;
    const vH     = viewport.clientHeight / scale;
    minimapVp.style.left   = Math.round(vLeft * gs + ox) + 'px';
    minimapVp.style.top    = Math.round(vTop  * gs + oy) + 'px';
    minimapVp.style.width  = Math.round(vW * gs) + 'px';
    minimapVp.style.height = Math.round(vH * gs) + 'px';
  }

  function drawMinimap() {
    if (!graph || !layout) return;
    if (minimapEl.classList.contains('is-collapsed')) return;
    if (minimapBaseDirty) rebuildMinimapBase();
    syncMinimapViewportRect();
  }

  function scheduleMinimapUpdate() {
    if (minimapRaf) return;
    minimapRaf = requestAnimationFrame(() => {
      minimapRaf = 0;
      drawMinimap();
    });
  }

  // ── Color toggle buttons ───────────────────────────────────────
  document.querySelectorAll('.cp-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => setColorMode(btn.dataset.mode));
  });
  document.querySelectorAll('.cp-btn[data-view-mode]').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.viewMode));
  });
  syncPanelButtons();

  minimapToggle?.addEventListener('click', () => {
    const collapsed = !minimapEl.classList.contains('is-collapsed');
    setMinimapCollapsed(collapsed);
    if (!collapsed) scheduleMinimapUpdate();
  });

  colorPanelToggle?.addEventListener('click', () => {
    const collapsed = !colorPanel.classList.contains('is-collapsed');
    setColorPanelCollapsed(collapsed);
  });

  initPanelCollapseState();

  window.addEventListener('message', (event) => {
    const payload = event?.data;
    if (!payload || payload.type !== PASS_IR_COLOR_SYNC_EVENT) return;
    applyExternalColorMode(payload.mode);
  });

  window.loadGraphData = loadGraphData;

})();

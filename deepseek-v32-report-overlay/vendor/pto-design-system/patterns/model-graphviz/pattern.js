(function registerPtoModelGraphvizPattern(global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CORE_COLORS = [
    '#14B8A6',
    '#06B6D4',
    '#0EA5E9',
    '#3B82F6',
    '#4F46E5',
    '#7C3AED',
    '#A855F7',
    '#F59E0B',
    '#EA580C',
  ];
  const SEMANTIC_COLOR_DEFAULTS = {
    'sem:embedding': '#14B8A6',
    'sem:norm': '#0EA5E9',
    'sem:attention': '#3B82F6',
    'sem:position': '#A855F7',
    'sem:rope': '#A855F7',
    'sem:qknorm': '#0EA5E9',
    'sem:linear': '#4F46E5',
    'sem:head': '#7C3AED',
    'sem:mlp': '#A855F7',
    'sem:act': '#8B5CF6',
    'sem:activation': '#8B5CF6',
    'sem:gate': '#F59E0B',
    'sem:moe': '#EA580C',
    'sem:comm': '#06B6D4',
  };
  const MODEL_ARCHITECTURE_NEUTRAL = '#D1D1D1';
  const MODEL_ARCHITECTURE_LIGHT_HSL = Object.freeze({ hue: 2, saturation: 79, lightness: 76 });
  const MODEL_ARCHITECTURE_COLOR_KEY_ALIASES = Object.freeze({
    'sem:embedding': 'opv:embedding',
    'sem:norm': 'opv:norm',
    'sem:attention': 'opv:attention',
    'sem:position': 'opv:rope',
    'sem:rope': 'opv:rope',
    'sem:qknorm': 'opv:norm',
    'sem:linear': 'opv:linear',
    'sem:head': 'opv:head',
    'sem:mlp': 'opv:mlp',
    'sem:act': 'opv:act',
    'sem:activation': 'opv:act',
    'sem:gate': 'opv:gate',
    'sem:moe': 'opv:moe',
    'sem:comm': 'opv:comm',
    'module:model': 'opv:model',
    'module:decoder': 'opv:decoder',
    'module:mhc': 'opv:attention',
    'module:ffn': 'opv:mlp',
    'module:mtp': 'opv:linear',
  });
  const MODEL_ARCHITECTURE_BASE_COLORS = Object.freeze({
    'opv:act': '#8B5CF6',
    'opv:attention': '#3B82F6',
    'opv:comm': '#06B6D4',
    'opv:decoder': '#0D9488',
    'opv:embedding': '#14B8A6',
    'opv:gate': '#F59E0B',
    'opv:head': '#7C3AED',
    'opv:linear': '#4F46E5',
    'opv:mlp': '#A855F7',
    'opv:model': '#475569',
    'opv:moe': '#EA580C',
    'opv:norm': '#38BDF8',
    'opv:op': '#14B8A6',
    'opv:rope': '#A855F7',
  });
  const STANDARD_IO_COLORS = {
    input: '#A855F7',
    activation: '#14B8A6',
    state: '#8B5CF6',
    output: '#38BDF8',
    parameter: '#3B82F6',
    constant: '#64748B',
  };
  const STANDARD_COLORMAP = Object.freeze({
    coreColors: Object.freeze([...CORE_COLORS]),
    ioColors: Object.freeze({ ...STANDARD_IO_COLORS }),
  });
  const COLORMAP_SATURATION = 0.82;
  const COLORMAP_LIGHTNESS = 0.40;
  const LIGHT_COLORMAP_SATURATION = 0.74;
  const LIGHT_COLORMAP_LIGHTNESS = 0.60;
  const LIGHT_THEME_NODE_FILL_OPACITY = '0.90';
  const FORBIDDEN_HUE_RANGES = [
    { from: 345 / 360, to: 15 / 360, wraps: true },
    { from: 85 / 360, to: 165 / 360, wraps: false },
  ];
  const LINE_COLOR = 'var(--model-graphviz-line)';
  const NODE_TEXT_COLOR = 'var(--model-graphviz-node-label)';
  const NODE_TYPE_COLOR = 'var(--model-graphviz-node-type)';
  const TENSOR_NODE_FILL = 'var(--model-graphviz-tensor-fill)';
  const EXPAND_BUTTON_RADIUS = 14;
  const EXPAND_BUTTON_EDGE_GAP = 10;
  const DEFAULT_DOT_LAYOUT = {
    graphMargin: 0.22,
    graphPad: 0.38,
    clusterMargin: 36,
  };
  const REPORT_PRIORITY_COLORS = {
    P0: '#FF2D7A',
    P1: '#FF9D00',
    P2: '#FFE600',
  };
  const MIN_ZOOM = 0.18;
  const MAX_ZOOM = 2.6;
  let renderSequence = 0;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);
  }

  function normalizeIdList(value) {
    if (!value) return [];
    return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
  }

  function nodeMap(graph) {
    return new Map((graph.nodes || []).map((node) => [node.id, node]));
  }

  function clusterMap(graph) {
    return new Map((graph.clusters || []).map((cluster) => [cluster.id, cluster]));
  }

  function cloneGraph(graph) {
    const source = graph || {};
    return {
      ...source,
      clusters: (source.clusters || []).map((cluster) => ({ ...cluster })),
      nodes: (source.nodes || []).map((node) => ({ ...node })),
      edges: (source.edges || []).map((edge) => ({ ...edge })),
    };
  }

  function buildHierarchy(graph) {
    const nodes = nodeMap(graph);
    const clusters = clusterMap(graph);
    const nodeParent = new Map();
    const clusterParent = new Map();
    const clusterChildren = new Map();
    const nodesByCluster = new Map();

    clusters.forEach((cluster, clusterId) => {
      nodesByCluster.set(clusterId, new Set(normalizeIdList(cluster.nodes)));
      clusterChildren.set(clusterId, new Set(normalizeIdList(cluster.children)));
      if (cluster.parent && clusters.has(cluster.parent)) {
        clusterParent.set(clusterId, cluster.parent);
      }
    });

    clusters.forEach((cluster, clusterId) => {
      normalizeIdList(cluster.children).forEach((childId) => {
        if (clusters.has(childId)) clusterParent.set(childId, clusterId);
      });
    });

    if (graph.clusterChildren && typeof graph.clusterChildren === 'object') {
      Object.entries(graph.clusterChildren).forEach(([clusterId, childIds]) => {
        if (!clusterChildren.has(clusterId)) clusterChildren.set(clusterId, new Set());
        normalizeIdList(childIds).forEach((childId) => {
          if (!clusters.has(childId)) return;
          clusterChildren.get(clusterId).add(childId);
          clusterParent.set(childId, clusterId);
        });
      });
    }

    (graph.nodes || []).forEach((node) => {
      if (!node.parent || !clusters.has(node.parent)) return;
      nodeParent.set(node.id, node.parent);
      if (!nodesByCluster.has(node.parent)) nodesByCluster.set(node.parent, new Set());
      nodesByCluster.get(node.parent).add(node.id);
    });

    const ancestorClustersForCluster = (clusterId) => {
      const out = [];
      const seen = new Set();
      let current = clusterId;
      while (clusterParent.has(current)) {
        current = clusterParent.get(current);
        if (!current || seen.has(current)) break;
        seen.add(current);
        out.push(current);
      }
      return out;
    };

    const ancestorClustersForNode = (nodeId) => {
      const parent = nodeParent.get(nodeId);
      if (!parent) return [];
      return [parent, ...ancestorClustersForCluster(parent)];
    };

    const descendantClustersOfCluster = (clusterId) => {
      const out = new Set();
      const visit = (id) => {
        (clusterChildren.get(id) || new Set()).forEach((childId) => {
          if (out.has(childId)) return;
          out.add(childId);
          visit(childId);
        });
      };
      visit(clusterId);
      return out;
    };

    const descendantNodesOfCluster = (clusterId) => {
      const out = new Set(nodesByCluster.get(clusterId) || []);
      descendantClustersOfCluster(clusterId).forEach((childId) => {
        (nodesByCluster.get(childId) || new Set()).forEach((nodeId) => out.add(nodeId));
      });
      return out;
    };

    return {
      nodes,
      clusters,
      nodeParent,
      clusterParent,
      clusterChildren,
      nodesByCluster,
      ancestorClustersForNode,
      ancestorClustersForCluster,
      descendantClustersOfCluster,
      descendantNodesOfCluster,
    };
  }

  function relationForNode(graph, evidenceMap, nodeId, explicitRelated, hierarchy) {
    const nodeIds = new Set();
    const clusterIds = new Set();
    const resolvedHierarchy = hierarchy || buildHierarchy(graph);

    const addCluster = (clusterId) => {
      if (!clusterId || !resolvedHierarchy.clusters.has(clusterId)) return;
      clusterIds.add(clusterId);
      resolvedHierarchy.ancestorClustersForCluster(clusterId).forEach((id) => clusterIds.add(id));
    };

    const addItem = (id, includeDescendants) => {
      if (!id) return;
      if (resolvedHierarchy.clusters.has(id)) {
        addCluster(id);
        if (includeDescendants) {
          resolvedHierarchy.descendantClustersOfCluster(id).forEach((clusterId) => clusterIds.add(clusterId));
          resolvedHierarchy.descendantNodesOfCluster(id).forEach((descendantNodeId) => nodeIds.add(descendantNodeId));
        }
        return;
      }
      if (!resolvedHierarchy.nodes.has(id)) return;
      nodeIds.add(id);
      resolvedHierarchy.ancestorClustersForNode(id).forEach((clusterId) => clusterIds.add(clusterId));
    };

    addItem(nodeId, true);
    (explicitRelated || []).forEach((id) => addItem(id, true));
    const info = (evidenceMap || {})[nodeId] || {};
    (info.relatedNodeIds || []).forEach((id) => addItem(id, true));

    const seedNodes = new Set(nodeIds);
    (graph.edges || []).forEach((edge) => {
      if (seedNodes.has(edge.source)) addItem(edge.target, false);
      if (seedNodes.has(edge.target)) addItem(edge.source, false);
    });

    return { nodeIds, clusterIds };
  }

  function normalizeEdgeType(edge) {
    return String((edge && (edge.edgeType || edge.type || edge.tag)) || 'activation')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'activation';
  }

  function edgeTagText(edge) {
    return String(edge?.tag || edge?.edgeTypeLabel || edge?.edgeType || '').trim();
  }

  function edgeTagFontSize(edge, options) {
    const value = Number(edge?.tagFontSize ?? options?.edgeTagFontSize);
    return Number.isFinite(value) ? Math.max(8, Math.min(18, value)) : 9.5;
  }

  function edgeTagHeight(edge, options) {
    const value = Number(edge?.tagHeight ?? options?.edgeTagHeight);
    return Number.isFinite(value) ? Math.max(16, Math.min(32, value)) : 18;
  }

  function edgeTagAngle(edge) {
    const value = Number(edge?.tagAngle ?? edge?.tagRotation ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  function edgeTagWidth(label, fontSize = 9.5, paddingX = 9) {
    return Math.max(38, Math.min(132, String(label || '').length * fontSize * 0.6 + paddingX * 2));
  }

  function rotatedTagSize(width, height, angle) {
    const radians = Math.abs(angle) * Math.PI / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    return {
      width: width * cos + height * sin,
      height: width * sin + height * cos,
    };
  }

  function classToken(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function evidenceHtml(node, info, options) {
    if (typeof options?.renderEvidence === 'function') {
      return options.renderEvidence(node, info);
    }
    const chips = [
      node.typeLabel,
      info?.dimension,
      info?.metric,
    ].filter(Boolean).map((item) => `<span>${esc(item)}</span>`).join('');
    const lines = (info?.evidence || info?.lines || []).slice(0, 4)
      .map((line) => `<li>${esc(line)}</li>`)
      .join('');
    const sources = (info?.sources || []).slice(0, 2)
      .map((item) => `<span>${esc(item)}</span>`)
      .join('');
    const actionLabel = options?.evidenceActionLabel || 'Action';

    return [
      '<div class="pto-model-graphviz-hover-title">',
        '<div>',
          `<small>${esc(node.id)}</small>`,
          `<strong>${esc(node.label || node.id)}</strong>`,
        '</div>',
      '</div>',
      chips ? `<div class="pto-model-graphviz-hover-chips">${chips}</div>` : '',
      info?.what ? `<p>${esc(info.what)}</p>` : '',
      info?.description ? `<p>${esc(info.description)}</p>` : '',
      lines ? `<ul>${lines}</ul>` : '',
      info?.action ? `<p><b>${esc(actionLabel)}</b> ${esc(info.action)}</p>` : '',
      sources ? `<div class="pto-model-graphviz-hover-source">${sources}</div>` : '',
    ].filter(Boolean).join('');
  }

  function edgeHasHover(edge) {
    const info = edge?.hover || edge || {};
    return Boolean(
      info.title
      || info.what
      || info.description
      || info.object
      || info.tensor
      || (Array.isArray(info.evidence) && info.evidence.length)
      || (Array.isArray(info.lines) && info.lines.length)
      || (Array.isArray(info.sources) && info.sources.length)
    );
  }

  function edgeHoverHtml(edge, options) {
    if (typeof options?.renderEdgeHover === 'function') {
      return options.renderEdgeHover(edge);
    }
    const info = edge?.hover || edge || {};
    const tensor = info.tensor || edge?.tensor || null;
    const title = info.title || info.label || edgeTagText(edge) || 'Edge object';
    const chips = [
      edgeTagText(edge),
      info.object,
      tensor?.name,
      tensor?.shape,
      tensor?.dtype,
      edge?.edgeType || edge?.type,
    ].filter(Boolean).map((item) => `<span>${esc(item)}</span>`).join('');
    const lines = (info.evidence || info.lines || []).slice(0, 4)
      .map((line) => `<li>${esc(line)}</li>`)
      .join('');
    const sources = (info.sources || []).slice(0, 3)
      .map((item) => `<span>${esc(item)}</span>`)
      .join('');

    return [
      '<div class="pto-model-graphviz-hover-title">',
        '<div>',
          `<small>${esc(edge?.source || '')} -> ${esc(edge?.target || '')}</small>`,
          `<strong>${esc(title)}</strong>`,
        '</div>',
      '</div>',
      chips ? `<div class="pto-model-graphviz-hover-chips">${chips}</div>` : '',
      info.what ? `<p>${esc(info.what)}</p>` : '',
      info.description ? `<p>${esc(info.description)}</p>` : '',
      lines ? `<ul>${lines}</ul>` : '',
      sources ? `<div class="pto-model-graphviz-hover-source">${sources}</div>` : '',
    ].filter(Boolean).join('');
  }

  const DEEPSEEK_V32_DEFAULT_GRAPH = {
    width: 720,
    height: 1280,
    clusters: [
      { id: 'transformer-core', label: 'Transformer', x: 160, y: 86, width: 400, height: 1050, colorKey: 'module:transformer-core', reportPriority: 'P0' },
      { id: 'decoder-block', label: 'Decoder Layer', x: 178, y: 240, width: 364, height: 500, colorKey: 'module:decoder-block', reportPriority: 'P0' },
    ],
    nodes: [
      { id: 'token-ids', label: 'Token IDs', typeLabel: 'Input', kind: 'tensor', x: 360, y: 44, width: 190, height: 48, colorKey: 'io:input' },
      { id: 'embedding', label: 'Parallel Embedding', typeLabel: 'Op', kind: 'op', x: 360, y: 150, width: 330, height: 56, colorKey: 'sem:embedding', reportPriority: 'P2' },
      { id: 'hidden', label: 'Hidden States', typeLabel: 'Tensor', kind: 'tensor', x: 360, y: 296, width: 230, height: 54, parent: 'decoder-block' },
      { id: 'attn-norm', label: 'attn_norm fused residual', typeLabel: 'Op', kind: 'op', x: 320, y: 390, width: 286, height: 58, parent: 'decoder-block' },
      { id: 'mla', label: 'MLA attention', typeLabel: 'Module (MLA atte...)', kind: 'op', x: 330, y: 486, width: 214, height: 58, colorKey: 'sem:attention', parent: 'decoder-block', reportPriority: 'P1' },
      { id: 'mla-indexer', label: 'MLA + Sparse Indexer', typeLabel: 'Module (MLA + Sp...)', x: 340, y: 582, width: 286, height: 58, colorKey: 'module:mla-indexer', collapsed: true, parent: 'decoder-block' },
      { id: 'ffn-norm', label: 'ffn_norm fused residual', typeLabel: 'Op', kind: 'op', x: 355, y: 682, width: 288, height: 58, parent: 'decoder-block' },
      { id: 'ffn-choice', label: 'Feed Forward Choice', typeLabel: 'Module (Feed For...)', x: 365, y: 790, width: 286, height: 58, colorKey: 'module:ffn-choice', collapsed: true },
      { id: 'block-output', label: 'Block Output', typeLabel: 'Tensor', kind: 'tensor', x: 360, y: 900, width: 245, height: 54, colorKey: 'io:output' },
      { id: 'final-norm', label: 'final RMSNorm', typeLabel: 'Op', kind: 'op', x: 360, y: 1016, width: 210, height: 56, colorKey: 'sem:norm' },
      { id: 'lm-head', label: 'LM Head Linear', typeLabel: 'Op', kind: 'op', x: 360, y: 1100, width: 292, height: 56, colorKey: 'sem:linear', reportPriority: 'P2' },
      { id: 'logits', label: 'Logits', typeLabel: 'Output', kind: 'tensor', x: 360, y: 1220, width: 230, height: 48, colorKey: 'io:output', reportPriority: 'P2' },
    ],
    edges: [
      { source: 'token-ids', target: 'embedding' },
      { source: 'embedding', target: 'hidden' },
      { source: 'hidden', target: 'attn-norm' },
      { source: 'attn-norm', target: 'mla' },
      { source: 'mla', target: 'mla-indexer' },
      { source: 'mla-indexer', target: 'ffn-norm' },
      { source: 'hidden', target: 'ffn-norm', dashed: true },
      { source: 'ffn-norm', target: 'ffn-choice' },
      { source: 'ffn-choice', target: 'block-output' },
      { source: 'block-output', target: 'final-norm' },
      { source: 'final-norm', target: 'lm-head' },
      { source: 'lm-head', target: 'logits' },
    ],
  };

  function createSvgElement(tagName, attributes) {
    const element = document.createElementNS(SVG_NS, tagName);
    Object.entries(attributes || {}).forEach(([key, value]) => {
      if (value == null) return;
      element.setAttribute(key, value);
    });
    return element;
  }

  function estimateTextWidth(text, minWidth, maxWidth) {
    return Math.max(minWidth, Math.min(maxWidth, String(text || '').length * 5.8 + 18));
  }

  function getReportPriorityFill(priority) {
    return REPORT_PRIORITY_COLORS[String(priority || '').toUpperCase()] || REPORT_PRIORITY_COLORS.P2;
  }

  function getReportPriorityTextColor(priority) {
    return String(priority || '').toUpperCase() === 'P0'
      ? 'var(--model-graphviz-report-priority-on-dark)'
      : 'var(--model-graphviz-report-priority-on-light)';
  }

  function normalizeHue(hue) {
    return ((hue % 1) + 1) % 1;
  }

  function isHueForbidden(hue) {
    const h = normalizeHue(hue);
    return FORBIDDEN_HUE_RANGES.some((range) => {
      if (!range.wraps) return h >= range.from && h <= range.to;
      return h >= range.from || h <= range.to;
    });
  }

  function snapToValidHue(hue) {
    const h = normalizeHue(hue);
    if (!isHueForbidden(h)) return h;
    const step = 1 / 3600;
    let lower = h;
    let upper = h;
    for (let index = 0; index < 1800; index += 1) {
      lower = normalizeHue(lower - step);
      if (!isHueForbidden(lower)) return lower;
      upper = normalizeHue(upper + step);
      if (!isHueForbidden(upper)) return upper;
    }
    return h;
  }

  function hexToRgb(hex) {
    const normalized = String(hex || '').replace('#', '').trim();
    if (normalized.length !== 6) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16),
    };
  }

  function rgbToHsl(r, g, b) {
    const nr = r / 255;
    const ng = g / 255;
    const nb = b / 255;
    const max = Math.max(nr, ng, nb);
    const min = Math.min(nr, ng, nb);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === nr) h = (ng - nb) / d + (ng < nb ? 6 : 0);
      else if (max === ng) h = (nb - nr) / d + 2;
      else h = (nr - ng) / d + 4;
      h /= 6;
    }
    return { h, s, l };
  }

  function hslToHex(h, s, l) {
    function hueToRgb(p, q, t) {
      let next = t;
      if (next < 0) next += 1;
      if (next > 1) next -= 1;
      if (next < 1 / 6) return p + (q - p) * 6 * next;
      if (next < 1 / 2) return q;
      if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
      return p;
    }

    const normalizedHue = snapToValidHue(h);
    let r;
    let g;
    let b;
    if (s === 0) {
      r = l;
      g = l;
      b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hueToRgb(p, q, normalizedHue + 1 / 3);
      g = hueToRgb(p, q, normalizedHue);
      b = hueToRgb(p, q, normalizedHue - 1 / 3);
    }
    return '#' + [r, g, b].map((value) => {
      const channel = Math.round(value * 255);
      return channel.toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }

  function hexToHsl(hex) {
    const rgb = hexToRgb(hex);
    return rgbToHsl(rgb.r, rgb.g, rgb.b);
  }

  function resolvedColormapOptions(options) {
    const colormap = options && options.colormap ? options.colormap : (options || {});
    const isLightTheme = global.document?.documentElement?.dataset?.theme === 'light';
    const saturation = Number.isFinite(Number(colormap.saturation))
      ? Number(colormap.saturation)
      : isLightTheme ? LIGHT_COLORMAP_SATURATION : COLORMAP_SATURATION;
    const lightness = Number.isFinite(Number(colormap.lightness))
      ? Number(colormap.lightness)
      : isLightTheme ? LIGHT_COLORMAP_LIGHTNESS : COLORMAP_LIGHTNESS;
    return {
      coreColors: Array.isArray(colormap.coreColors) && colormap.coreColors.length
        ? colormap.coreColors
        : CORE_COLORS,
      saturation,
      lightness,
      ioColors: {
        ...STANDARD_IO_COLORS,
        ...(colormap.ioColors || {}),
      },
      semanticColors: {
        ...SEMANTIC_COLOR_DEFAULTS,
        ...(colormap.semanticColors || {}),
      },
    };
  }

  function isLightTheme() {
    return global.document?.documentElement?.dataset?.theme === 'light';
  }

  function normalizeColormapColor(hex, options) {
    const resolved = resolvedColormapOptions(options);
    const hsl = hexToHsl(hex);
    return hslToHex(snapToValidHue(hsl.h), resolved.saturation, resolved.lightness);
  }

  function isHexColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
  }

  function resolveColormapColor(value, fallback, options) {
    if (value && typeof value === 'object') {
      const raw = String(value.raw || '').trim();
      if (isHexColor(raw)) return raw.toUpperCase();
      return normalizeColormapColor(value.color || fallback, options);
    }
    return normalizeColormapColor(value || fallback, options);
  }

  function modelArchitectureLightColor(baseHex, lightHsl) {
    const base = hexToHsl(baseHex);
    const hue = base.h + (Number(lightHsl.hue) || 0) / 360;
    const saturation = (Number(lightHsl.saturation) || MODEL_ARCHITECTURE_LIGHT_HSL.saturation) / 100;
    const lightness = (Number(lightHsl.lightness) || MODEL_ARCHITECTURE_LIGHT_HSL.lightness) / 100;
    return hslToHex(hue, saturation, lightness);
  }

  function normalizeModelArchitectureKey(key) {
    const normalized = String(key || '');
    if (!normalized || normalized.startsWith('io:')) return normalized;
    if (MODEL_ARCHITECTURE_COLOR_KEY_ALIASES[normalized]) return MODEL_ARCHITECTURE_COLOR_KEY_ALIASES[normalized];
    if (MODEL_ARCHITECTURE_BASE_COLORS[normalized]) return normalized;
    return 'opv:op';
  }

  function modelArchitectureColormap(graph, options = {}) {
    const theme = options.theme || global.document?.documentElement?.dataset?.theme || 'dark';
    const lightHsl = {
      ...MODEL_ARCHITECTURE_LIGHT_HSL,
      ...(options.lightHsl || {}),
    };
    const semanticColors = {};
    const allKeys = new Set([
      ...Object.keys(SEMANTIC_COLOR_DEFAULTS),
      ...Object.keys(MODEL_ARCHITECTURE_COLOR_KEY_ALIASES),
      ...Object.values(MODEL_ARCHITECTURE_COLOR_KEY_ALIASES),
      ...Object.keys(MODEL_ARCHITECTURE_BASE_COLORS),
      ...collectColorKeys(graph || {}),
    ]);

    allKeys.forEach((sourceKey) => {
      if (!sourceKey || String(sourceKey).startsWith('io:')) return;
      const profileKey = normalizeModelArchitectureKey(sourceKey);
      const baseColor = MODEL_ARCHITECTURE_BASE_COLORS[profileKey] || MODEL_ARCHITECTURE_BASE_COLORS['opv:op'];
      semanticColors[sourceKey] = theme === 'light'
        ? modelArchitectureLightColor(baseColor, lightHsl)
        : baseColor;
    });

    const profileKeys = Array.from(new Set(Array.from(allKeys).map(normalizeModelArchitectureKey)))
      .filter((key) => key && !key.startsWith('io:'));
    const coreColors = profileKeys.map((key) => {
      const baseColor = MODEL_ARCHITECTURE_BASE_COLORS[key] || MODEL_ARCHITECTURE_BASE_COLORS['opv:op'];
      return theme === 'light' ? modelArchitectureLightColor(baseColor, lightHsl) : baseColor;
    });

    return {
      coreColors,
      saturation: theme === 'light' ? lightHsl.saturation / 100 : COLORMAP_SATURATION,
      lightness: theme === 'light' ? lightHsl.lightness / 100 : COLORMAP_LIGHTNESS,
      ioColors: theme === 'light' ? {
        input: { raw: MODEL_ARCHITECTURE_NEUTRAL },
        activation: { raw: MODEL_ARCHITECTURE_NEUTRAL },
        state: { raw: MODEL_ARCHITECTURE_NEUTRAL },
        output: { raw: MODEL_ARCHITECTURE_NEUTRAL },
        parameter: { raw: MODEL_ARCHITECTURE_NEUTRAL },
        constant: { raw: MODEL_ARCHITECTURE_NEUTRAL },
      } : { ...STANDARD_IO_COLORS },
      semanticColors,
    };
  }

  function expandPalette(baseHexes, targetCount, options) {
    const resolved = resolvedColormapOptions(options);
    const hues = baseHexes.map((hex) => snapToValidHue(hexToHsl(hex).h));
    const coreHueSet = new Set(hues.map((hue) => Math.round(hue * 1e6)));
    const maxHuePositions = 100;
    const minGap = 1 / 360 * 2.5;

    while (hues.length < maxHuePositions) {
      let maxGap = -1;
      let insertIndex = 0;
      for (let index = 0; index < hues.length; index += 1) {
        const current = hues[index];
        const next = hues[(index + 1) % hues.length];
        let gap = next - current;
        if (gap < 0) gap += 1;
        if (gap > maxGap) {
          maxGap = gap;
          insertIndex = index;
        }
      }
      const current = hues[insertIndex];
      const next = hues[(insertIndex + 1) % hues.length];
      let midpoint = next < current ? ((current + next + 1) / 2) % 1 : (current + next) / 2;
      midpoint = snapToValidHue(midpoint);
      const tooClose = hues.some((hue) => {
        let distance = Math.abs(hue - midpoint);
        if (distance > 0.5) distance = 1 - distance;
        return distance < minGap;
      });
      if (tooClose) break;
      hues.splice(insertIndex + 1, 0, midpoint);
    }

    const colors = baseHexes.map((hex) => normalizeColormapColor(hex, resolved));
    const extraHues = hues.filter((hue) => !coreHueSet.has(Math.round(hue * 1e6)));
    for (const hue of extraHues) {
      if (colors.length >= targetCount) break;
      colors.push(hslToHex(hue, resolved.saturation, resolved.lightness));
    }
    while (colors.length < targetCount) {
      for (const hue of hues) {
        if (colors.length >= targetCount) break;
        colors.push(hslToHex(hue, resolved.saturation, resolved.lightness));
      }
    }

    return colors.slice(0, targetCount);
  }

  function buildColorMap(keys, options) {
    const resolved = resolvedColormapOptions(options);
    const unique = Array.from(new Set(keys || []));
    const semanticKeys = unique.filter((key) => !String(key).startsWith('io:')).sort();
    const generatedKeys = semanticKeys.filter((key) => !resolved.semanticColors[key]);
    const colors = expandPalette(resolved.coreColors, Math.max(semanticKeys.length, resolved.coreColors.length), resolved);
    const map = new Map();
    map.set('io:input', resolveColormapColor(resolved.ioColors.input, '#A855F7', resolved));
    map.set('io:activation', resolveColormapColor(resolved.ioColors.activation, '#14B8A6', resolved));
    map.set('io:state', resolveColormapColor(resolved.ioColors.state, '#8B5CF6', resolved));
    map.set('io:output', resolveColormapColor(resolved.ioColors.output, '#38BDF8', resolved));
    map.set('io:constant', resolveColormapColor(resolved.ioColors.constant, '#64748B', resolved));
    map.set('io:parameter', resolveColormapColor(resolved.ioColors.parameter, '#3B82F6', resolved));
    Object.entries(resolved.semanticColors).forEach(([key, color]) => {
      if (unique.includes(key)) map.set(key, resolveColormapColor(color, color, resolved));
    });
    generatedKeys.forEach((key, index) => map.set(key, colors[index]));
    return map;
  }

  function collectColorKeys(graph) {
    const keys = [];
    (graph.clusters || []).forEach((cluster) => keys.push(cluster.colorKey || `parent:${cluster.id}`));
    (graph.nodes || []).forEach((node) => {
      if (node.colorKey) keys.push(node.colorKey);
      else if (node.parent) keys.push(`parent:${node.parent}`);
      else keys.push(`type:${node.kind || 'node'}`);
    });
    return keys;
  }

  function resolveClusterColors(graph, colorMap, options) {
    const resolved = resolvedColormapOptions(options);
    const fallback = normalizeColormapColor(resolved.coreColors[0] || CORE_COLORS[0], resolved);
    const colors = new Map();
    (graph.clusters || []).forEach((cluster) => {
      const key = cluster.colorKey || `parent:${cluster.id}`;
      colors.set(cluster.id, colorMap.get(key) || fallback);
    });
    return colors;
  }

  function getNodeVisualKind(node) {
    if (node.collapsed) return 'module';
    if (node.kind) return node.kind;
    const typeLabel = String(node.typeLabel || '').toLowerCase();
    if (['input', 'output', 'tensor', 'constant', 'parameter'].some((needle) => typeLabel.includes(needle))) {
      return 'tensor';
    }
    return 'op';
  }

  function resolveNodeColor(node, colorMap, clusterColors) {
    if (getNodeVisualKind(node) === 'tensor') {
      return TENSOR_NODE_FILL;
    }
    if (node.colorKey && colorMap.has(node.colorKey)) {
      return colorMap.get(node.colorKey);
    }
    if (node.parent && clusterColors.has(node.parent)) {
      return clusterColors.get(node.parent);
    }
    const key = node.colorKey || `type:${node.kind || 'node'}`;
    return colorMap.get(key) || CORE_COLORS[1];
  }

  function nodeAnchor(node, direction) {
    const anchor = typeof direction === 'object' && direction !== null
      ? direction
      : { side: direction };
    const side = anchor.side || anchor.anchor || 'center';
    const x = side === 'left'
      ? node.x - node.width / 2
      : side === 'right'
        ? node.x + node.width / 2
        : node.x;
    const y = side === 'top'
      ? node.y - node.height / 2
      : side === 'bottom'
        ? node.y + node.height / 2
        : node.y;
    return {
      x: x + (Number(anchor.dx) || 0),
      y: y + (Number(anchor.dy) || 0),
    };
  }

  function roundedRoutePath(points, radius) {
    const cleanPoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (cleanPoints.length < 2) return '';
    const cornerRadius = Math.max(0, Number(radius) || 0);
    const parts = [`M ${cleanPoints[0].x} ${cleanPoints[0].y}`];
    if (cleanPoints.length === 2 || cornerRadius === 0) {
      cleanPoints.slice(1).forEach((point) => parts.push(`L ${point.x} ${point.y}`));
      return parts.join(' ');
    }

    function pointAtDistance(from, to, distance) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      if (!length) return { ...from };
      const ratio = Math.min(1, Math.max(0, distance / length));
      return { x: from.x + dx * ratio, y: from.y + dy * ratio };
    }

    for (let index = 1; index < cleanPoints.length - 1; index += 1) {
      const prev = cleanPoints[index - 1];
      const point = cleanPoints[index];
      const next = cleanPoints[index + 1];
      const inLength = Math.hypot(point.x - prev.x, point.y - prev.y);
      const outLength = Math.hypot(next.x - point.x, next.y - point.y);
      const r = Math.min(cornerRadius, inLength / 2, outLength / 2);
      if (r <= 0.5) {
        parts.push(`L ${point.x} ${point.y}`);
        continue;
      }
      const before = pointAtDistance(point, prev, r);
      const after = pointAtDistance(point, next, r);
      parts.push(`L ${before.x} ${before.y}`);
      parts.push(`Q ${point.x} ${point.y} ${after.x} ${after.y}`);
    }
    const last = cleanPoints[cleanPoints.length - 1];
    parts.push(`L ${last.x} ${last.y}`);
    return parts.join(' ');
  }

  function smoothRoutePath(points, tension) {
    const cleanPoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (cleanPoints.length < 2) return '';
    const t = Math.max(0.05, Math.min(0.5, Number(tension) || 0.18));
    const parts = [`M ${cleanPoints[0].x} ${cleanPoints[0].y}`];
    for (let index = 0; index < cleanPoints.length - 1; index += 1) {
      const p0 = cleanPoints[index - 1] || cleanPoints[index];
      const p1 = cleanPoints[index];
      const p2 = cleanPoints[index + 1];
      const p3 = cleanPoints[index + 2] || p2;
      const c1 = {
        x: p1.x + (p2.x - p0.x) * t,
        y: p1.y + (p2.y - p0.y) * t,
      };
      const c2 = {
        x: p2.x - (p3.x - p1.x) * t,
        y: p2.y - (p3.y - p1.y) * t,
      };
      parts.push(`C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`);
    }
    return parts.join(' ');
  }

  function edgePath(source, target, edge) {
    const vertical = Math.abs(source.y - target.y) >= Math.abs(source.x - target.x);
    const sourceAnchor = edge?.sourceAnchor || (vertical
      ? source.y < target.y ? 'bottom' : 'top'
      : source.x < target.x ? 'right' : 'left');
    const targetAnchor = edge?.targetAnchor || (vertical
      ? source.y < target.y ? 'top' : 'bottom'
      : source.x < target.x ? 'left' : 'right');
    const start = edge?.sourcePoint
      ? { x: Number(edge.sourcePoint.x), y: Number(edge.sourcePoint.y) }
      : nodeAnchor(source, sourceAnchor);
    const end = edge?.targetPoint
      ? { x: Number(edge.targetPoint.x), y: Number(edge.targetPoint.y) }
      : nodeAnchor(target, targetAnchor);
    if (Array.isArray(edge?.waypoints) && edge.waypoints.length) {
      const points = [
        start,
        ...edge.waypoints.map((point) => ({ x: Number(point.x), y: Number(point.y) })),
        end,
      ];
      if (edge.route === 'smooth' || edge.curve === 'smooth') {
        return smoothRoutePath(points, edge.tension);
      }
      return roundedRoutePath(points, edge.cornerRadius ?? 32);
    }
    const curve = edge?.curve || (vertical ? 'vertical' : 'horizontal');

    if (curve === 'straight' || curve === 'line') {
      return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    }

    if (curve === 'vertical') {
      const midY = (start.y + end.y) / 2;
      return `M ${start.x} ${start.y} C ${start.x} ${midY}, ${end.x} ${midY}, ${end.x} ${end.y}`;
    }

    const midX = (start.x + end.x) / 2;
    return `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
  }

  function drawMarker(defs, markerId) {
    const marker = createSvgElement('marker', {
      id: markerId,
      viewBox: '0 0 10 10',
      refX: '8.6',
      refY: '5',
      markerWidth: '8',
      markerHeight: '8',
      orient: 'auto-start-reverse',
    });
    marker.appendChild(createSvgElement('path', {
      d: 'M 0 0 L 10 5 L 0 10 z',
      fill: LINE_COLOR,
    }));
    defs.appendChild(marker);
  }

  function drawCluster(svg, cluster, color) {
    const dataState = classToken(cluster.dataState || (cluster.selectable === false ? 'source-only' : 'mapped'));
    const origin = classToken(cluster.origin);
    const group = createSvgElement('g', {
      class: `pto-model-graphviz-cluster${dataState ? ` is-${dataState}` : ''}${origin ? ` is-origin-${origin}` : ''}`,
      'data-cluster-id': cluster.id,
      'data-state': dataState || null,
      'data-origin': origin || null,
      'data-selectable': cluster.selectable === false ? 'false' : 'true',
    });
    const isRepeat = Boolean(cluster.repeat);
    const radius = 16; // --radius-xl, matches DeepSeek parent-radius; keeps corner toggle inside
    group.appendChild(createSvgElement('rect', {
      x: cluster.x,
      y: cluster.y,
      width: cluster.width,
      height: cluster.height,
      rx: radius,
      ry: radius,
      fill: 'transparent',
      'fill-opacity': '0',
      stroke: isRepeat ? LINE_COLOR : 'var(--model-graphviz-line-soft)',
      'stroke-width': isRepeat ? '1.2' : '1.6',
      'stroke-dasharray': isRepeat ? '3 2' : null,
    }));

    if (!cluster.reportPriority) {
      const label = createSvgElement('text', {
        class: 'pto-model-graphviz-cluster-label',
        x: cluster.x + 20,
        y: cluster.y + 18,
      });
      label.textContent = cluster.label || cluster.id;
      group.appendChild(label);
    }

    const repeatCount = Number(cluster.repeatCount || cluster.instanceIndices?.length || 0);
    if (isRepeat && repeatCount > 1) {
      const repeatLabel = `×${repeatCount}`;
      const repeatWidth = estimateTextWidth(repeatLabel, 28, 42);
      group.appendChild(createSvgElement('rect', {
        class: 'pto-model-graphviz-repeat-badge',
        x: cluster.x + 14,
        y: cluster.y + 28,
        width: repeatWidth,
        height: 18,
        rx: 9,
        ry: 9,
      }));
      const repeatText = createSvgElement('text', {
        class: 'pto-model-graphviz-repeat-badge-text',
        x: cluster.x + 14 + repeatWidth / 2,
        y: cluster.y + 37,
      });
      repeatText.textContent = repeatLabel;
      group.appendChild(repeatText);
    }

    if (cluster.collapsible !== false) {
      const toggleX = cluster.x + cluster.width - 13;
      const toggleY = cluster.y + 13; // top-right corner anchor
      group.appendChild(createSvgElement('circle', {
        class: 'pto-model-graphviz-toggle',
        cx: toggleX,
        cy: toggleY,
        r: 7.5,
      }));
      const icon = createSvgElement('path', {
        class: 'pto-model-graphviz-toggle-icon',
        d: `M ${toggleX - 3.5} ${toggleY} H ${toggleX + 3.5}`,
      });
      group.appendChild(icon);
    }
    svg.appendChild(group);
    return group;
  }

  function drawClusterTitlePill(svg, cluster) {
    const priority = String(cluster.reportPriority || '').toUpperCase();
    if (!priority) return;

    const label = cluster.label || cluster.id;
    const fill = getReportPriorityFill(priority);
    const textColor = getReportPriorityTextColor(priority);
    const tagWidth = estimateTextWidth(priority, 20, 24);
    const tagHeight = 12;
    const pillPaddingLeft = 6;
    const pillPaddingRight = 12;
    const tagGap = 8;
    const labelWidth = estimateTextWidth(label, 42, Math.max(42, cluster.width - tagWidth - 42));
    const height = 18;
    const width = pillPaddingLeft + tagWidth + tagGap + labelWidth + pillPaddingRight;
    const centeredX = cluster.x + (cluster.width - width) / 2;
    const minX = cluster.x + 8;
    const maxX = cluster.x + cluster.width - width - 8;
    const x = maxX >= minX ? Math.min(Math.max(centeredX, minX), maxX) : centeredX;
    const y = cluster.y;
    const tagX = x + pillPaddingLeft;

    const group = createSvgElement('g', {
      class: `pto-model-graphviz-cluster-title-pill report-priority-${priority.toLowerCase()}`,
      'data-report-priority': priority,
      'pointer-events': 'none',
    });

    group.appendChild(createSvgElement('rect', {
      class: 'pto-model-graphviz-cluster-title-bg',
      x,
      y: y - height / 2,
      width,
      height,
      rx: height / 2,
      ry: height / 2,
      fill,
    }));
    group.appendChild(createSvgElement('rect', {
      class: 'pto-model-graphviz-cluster-title-tag',
      x: tagX,
      y: y - tagHeight / 2,
      width: tagWidth,
      height: tagHeight,
      rx: tagHeight / 2,
      ry: tagHeight / 2,
    }));

    const tag = createSvgElement('text', {
      class: 'pto-model-graphviz-cluster-title-tag-text',
      x: tagX + tagWidth / 2,
      y,
      fill: textColor,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    });
    tag.textContent = priority;
    group.appendChild(tag);

    const title = createSvgElement('text', {
      class: 'pto-model-graphviz-cluster-title-text',
      x: tagX + tagWidth + tagGap,
      y,
      fill: textColor,
      'dominant-baseline': 'central',
    });
    title.textContent = label;
    group.appendChild(title);
    svg.appendChild(group);
  }

  function drawReportBadge(group, node) {
    const priority = String(node.reportPriority || '').toUpperCase();
    if (!priority) return;

    const badgeWidth = estimateTextWidth(priority, 30, 36);
    const badgeHeight = 16;
    const x = -node.width / 2 + 8;
    const centerY = 0;
    const fill = getReportPriorityFill(priority);
    const textColor = getReportPriorityTextColor(priority);

    group.appendChild(createSvgElement('rect', {
      class: 'pto-model-graphviz-report-node-badge',
      'data-report-priority': priority,
      x,
      y: centerY - badgeHeight / 2,
      width: badgeWidth,
      height: badgeHeight,
      rx: badgeHeight / 2,
      ry: badgeHeight / 2,
      fill,
    }));

    const label = createSvgElement('text', {
      class: 'pto-model-graphviz-report-node-badge-text',
      x: x + badgeWidth / 2,
      y: centerY,
      fill: textColor,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    });
    label.textContent = priority;
    group.appendChild(label);
  }

  function drawMetricBadge(group, node) {
    const metric = String(node.metricBadge || '').trim();
    if (!metric) return;

    const badgeHeight = 18;
    const badgeWidth = estimateTextWidth(metric, 36, 54);
    const right = node.width / 2 - 10;
    const x = right - badgeWidth;
    group.appendChild(createSvgElement('rect', {
      class: 'pto-model-graphviz-metric-badge',
      x,
      y: -badgeHeight / 2,
      width: badgeWidth,
      height: badgeHeight,
      rx: badgeHeight / 2,
      ry: badgeHeight / 2,
    }));
    const label = createSvgElement('text', {
      class: 'pto-model-graphviz-metric-badge-text',
      x: x + badgeWidth / 2,
      y: 0.4,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    });
    label.textContent = metric;
    group.appendChild(label);
  }

  function drawNode(svg, node, color, options) {
    const visualKind = getNodeVisualKind(node);
    const cornerRadius = visualKind === 'tensor'
      ? Math.min(14, Math.max(8, node.height * 0.32))
      : node.height / 2;
    const overlayKind = classToken(node.overlayKind || node.overlayType);
    const dataState = classToken(node.dataState || (node.selectable === false ? 'source-only' : 'mapped'));
    const origin = classToken(node.origin);
    const extraClasses = [
      node.collapsed ? 'is-collapsed' : '',
      node.virtual ? 'is-virtual' : '',
      node.glyph ? 'is-glyph' : '',
      overlayKind ? `is-overlay-${overlayKind}` : '',
      dataState ? `is-${dataState}` : '',
      origin ? `is-origin-${origin}` : '',
    ].filter(Boolean).join(' ');
    const group = createSvgElement('g', {
      class: `pto-model-graphviz-node is-${visualKind}${extraClasses ? ` ${extraClasses}` : ''}`,
      transform: `translate(${node.x}, ${node.y})`,
      'data-node-id': node.id,
      'data-node-kind': visualKind,
      'data-state': dataState || null,
      'data-origin': origin || null,
      'data-selectable': node.selectable === false ? 'false' : 'true',
    });
    const rect = createSvgElement('rect', {
      x: -node.width / 2,
      y: -node.height / 2,
      width: node.width,
      height: node.height,
      rx: cornerRadius,
      ry: cornerRadius,
      fill: color,
      'fill-opacity': isLightTheme() ? LIGHT_THEME_NODE_FILL_OPACITY : null,
    });
    group.appendChild(rect);

    const repeatCount = Number(node.repeatCount || node.instanceIndices?.length || 0);
    const hasRepeatBadge = node.collapsed && repeatCount > 1;
    if (hasRepeatBadge) {
      const repeatLabel = `×${repeatCount}`;
      const repeatWidth = estimateTextWidth(repeatLabel, 28, 42);
      group.appendChild(createSvgElement('rect', {
        class: 'pto-model-graphviz-repeat-badge',
        x: -node.width / 2 + 10,
        y: -9,
        width: repeatWidth,
        height: 18,
        rx: 9,
        ry: 9,
      }));
      const repeatText = createSvgElement('text', {
        class: 'pto-model-graphviz-repeat-badge-text',
        x: -node.width / 2 + 10 + repeatWidth / 2,
        y: 0,
      });
      repeatText.textContent = repeatLabel;
      group.appendChild(repeatText);
    }

    const metricBadge = String(node.metricBadge || '').trim();
    const contentX = metricBadge ? -20 : 0;
    const label = createSvgElement('text', {
      class: 'pto-model-graphviz-node-label',
      x: node.collapsed ? (hasRepeatBadge ? 12 : -8) : contentX,
      y: visualKind === 'tensor' || node.hideTypeLabel || node.glyph ? 0 : -4,
      fill: NODE_TEXT_COLOR,
    });
    label.textContent = node.label || node.id;
    group.appendChild(label);

    if (visualKind !== 'tensor' && !node.hideTypeLabel && !node.glyph) {
      const type = createSvgElement('text', {
        class: 'pto-model-graphviz-node-type',
        x: node.collapsed ? (hasRepeatBadge ? 12 : -8) : contentX,
        y: 12,
        fill: NODE_TYPE_COLOR,
      });
      type.textContent = node.typeLabel || 'Op';
      group.appendChild(type);
    }

    if (node.collapsed) {
      const toggleX = node.width / 2 - EXPAND_BUTTON_EDGE_GAP - EXPAND_BUTTON_RADIUS;
      const toggleY = 0;
      group.appendChild(createSvgElement('circle', {
        class: 'pto-model-graphviz-toggle',
        cx: toggleX,
        cy: toggleY,
        r: EXPAND_BUTTON_RADIUS,
      }));
      const icon = createSvgElement('path', {
        class: 'pto-model-graphviz-toggle-icon',
        d: `M ${toggleX - 5} ${toggleY} H ${toggleX + 5} M ${toggleX} ${toggleY - 5} V ${toggleY + 5}`,
      });
      group.appendChild(icon);
    }

    if (options?.metricOverlays !== false) {
      drawMetricBadge(group, node);
    }
    if (options?.reportOverlays !== false) {
      drawReportBadge(group, node);
    }
    svg.appendChild(group);
    return group;
  }

  function nodeRect(node, padding = 0) {
    return {
      left: node.x - node.width / 2 - padding,
      top: node.y - node.height / 2 - padding,
      right: node.x + node.width / 2 + padding,
      bottom: node.y + node.height / 2 + padding,
    };
  }

  function clusterBoundaryRects(cluster, padding = 0) {
    const left = cluster.x - padding;
    const top = cluster.y - padding;
    const right = cluster.x + cluster.width + padding;
    const bottom = cluster.y + cluster.height + padding;
    const band = Math.max(8, padding * 2);
    const titleBand = Math.max(38, padding * 3);
    return [
      { left, top, right, bottom: top + titleBand },
      { left, top: bottom - band, right, bottom },
      { left, top, right: left + band, bottom },
      { left: right - band, top, right, bottom },
    ];
  }

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function tagRectAt(point, width, height) {
    return {
      left: point.x - width / 2,
      top: point.y - height / 2,
      right: point.x + width / 2,
      bottom: point.y + height / 2,
    };
  }

  function uniqueTagPositions(basePosition) {
    const base = Math.min(0.92, Math.max(0.08, Number.isFinite(basePosition) ? basePosition : 0.52));
    const candidates = [
      base,
      base - 0.16,
      base + 0.16,
      base - 0.28,
      base + 0.28,
      0.22,
      0.34,
      0.66,
      0.78,
    ];
    const seen = new Set();
    return candidates
      .map((value) => Math.min(0.92, Math.max(0.08, value)))
      .filter((value) => {
        const key = value.toFixed(3);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function edgeTagOverlapsNode(point, width, height, entry, padding) {
    const tagRect = tagRectAt(point, width, height);
    return (entry.avoidNodes || [entry.sourceNode, entry.targetNode])
      .filter(Boolean)
      .some((node) => rectsOverlap(tagRect, nodeRect(node, padding)));
  }

  function edgeTagOverlapsCluster(point, width, height, entry, padding) {
    const tagRect = tagRectAt(point, width, height);
    return (entry.avoidClusters || [])
      .filter(Boolean)
      .some((cluster) => clusterBoundaryRects(cluster, padding).some((rect) => rectsOverlap(tagRect, rect)));
  }

  function shiftedEdgeTagPoint(entry, length, distance, point, offset) {
    if (!Number.isFinite(offset) || Math.abs(offset) < 0.5) return point;
    const sample = Math.max(1, Math.min(8, length * 0.01));
    const before = entry.el.getPointAtLength(Math.max(0, distance - sample));
    const after = entry.el.getPointAtLength(Math.min(length, distance + sample));
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const magnitude = Math.hypot(dx, dy);
    if (!magnitude) return { x: point.x, y: point.y - offset };
    return {
      x: point.x + (-dy / magnitude) * offset,
      y: point.y + (dx / magnitude) * offset,
    };
  }

  function edgeTagOffsets(edge, opts) {
    const explicitOffset = Number(edge?.tagOffset);
    if (Number.isFinite(explicitOffset)) return [explicitOffset, 0];
    if (Array.isArray(edge?.tagOffsets) && edge.tagOffsets.length) {
      return [0, ...edge.tagOffsets.map(Number).filter(Number.isFinite)];
    }
    const explicitOptions = Array.isArray(opts.edgeTagOffsets)
      ? opts.edgeTagOffsets.map(Number).filter(Number.isFinite)
      : [];
    if (explicitOptions.length) return [0, ...explicitOptions];
    return normalizeEdgeType(edge) === 'parameter'
      ? [0, -24, 24, -38, 38, -52, 52]
      : [0];
  }

  function resolveEdgeTagPoint(entry, length, width, height, options) {
    const opts = options || {};
    const edge = entry.edge || {};
    const explicitPosition = Number(edge.tagPosition);
    const basePosition = Number.isFinite(explicitPosition) ? explicitPosition : 0.52;
    const avoidNodes = edge.tagAvoidNodes !== false && opts.edgeTagAvoidNodes !== false;
    const avoidClusters = normalizeEdgeType(edge) === 'parameter'
      && edge.tagAvoidClusters !== false
      && opts.edgeTagAvoidClusters !== false;
    const endpointPadding = Number.isFinite(Number(opts.edgeTagNodePadding))
      ? Number(opts.edgeTagNodePadding)
      : 6;
    const clusterPadding = Number.isFinite(Number(opts.edgeTagClusterPadding))
      ? Number(opts.edgeTagClusterPadding)
      : 12;

    let fallbackPoint = null;
    for (const position of uniqueTagPositions(basePosition)) {
      const distance = length * position;
      const basePoint = entry.el.getPointAtLength(distance);
      if (!fallbackPoint) fallbackPoint = basePoint;
      for (const offset of edgeTagOffsets(edge, opts)) {
        const point = shiftedEdgeTagPoint(entry, length, distance, basePoint, offset);
        const overlapsNode = avoidNodes && edgeTagOverlapsNode(point, width, height, entry, endpointPadding);
        const overlapsCluster = avoidClusters && edgeTagOverlapsCluster(point, width, height, entry, clusterPadding);
        if (!overlapsNode && !overlapsCluster) {
          return point;
        }
      }
    }
    return fallbackPoint;
  }

  function drawEdgeTags(svg, edgeEntries, options) {
    const opts = options || {};
    const layerClass = opts.edgeTagLayerClass || 'pto-model-graphviz-edge-tags';
    const tagClass = opts.edgeTagClass || 'pto-model-graphviz-edge-tag';
    const old = svg.querySelector(`.${layerClass}`);
    if (old) old.remove();
    const layer = createSvgElement('g', { class: layerClass });

    edgeEntries.forEach((entry) => {
      const edge = entry.edge || {};
      const label = edgeTagText(edge);
      if (!label || !entry.el || typeof entry.el.getTotalLength !== 'function') return;
      let point;
      try {
        const length = entry.el.getTotalLength();
        if (!length) return;
        const fontSize = edgeTagFontSize(edge, opts);
        const paddingX = Number.isFinite(Number(edge.tagPaddingX)) ? Number(edge.tagPaddingX) : 9;
        const width = edgeTagWidth(label, fontSize, paddingX);
        const height = edgeTagHeight(edge, opts);
        const angle = edgeTagAngle(edge);
        const collisionSize = rotatedTagSize(width, height, angle);
        point = resolveEdgeTagPoint(entry, length, collisionSize.width, collisionSize.height, opts);
        if (!point) return;
        const group = createSvgElement('g', {
          class: tagClass,
          transform: `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})${angle ? ` rotate(${angle})` : ''}`,
          'data-edge-type': normalizeEdgeType(edge),
          'data-source': edge.source || entry.source || null,
          'data-target': edge.target || entry.target || null,
          'aria-label': label,
        });
        group.appendChild(createSvgElement('rect', {
          x: -width / 2,
          y: -height / 2,
          width,
          height,
          rx: height / 2,
          ry: height / 2,
        }));
        const text = createSvgElement('text', {
          x: 0,
          y: 0.4,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          style: `font-size: ${fontSize}px;`,
        });
        text.textContent = label;
        group.appendChild(text);
        layer.appendChild(group);
        entry.tagEl = group;
      } catch (_) {
        return;
      }
    });

    svg.appendChild(layer);
  }

  function createHover(stage, className) {
    const panel = document.createElement('div');
    panel.className = className || 'pto-model-graphviz-hover';
    panel.setAttribute('aria-hidden', 'true');
    stage.appendChild(panel);
    return panel;
  }

  function placeHover(stage, panel, event) {
    const rect = stage.getBoundingClientRect();
    let x = event.clientX - rect.left + 16;
    let y = event.clientY - rect.top + 16;
    const width = panel.offsetWidth || 320;
    const height = panel.offsetHeight || 180;
    x = Math.max(10, Math.min(rect.width - width - 10, x));
    y = Math.max(10, Math.min(rect.height - height - 10, y));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }

  function applyTextContrast(nodeEntries) {
    nodeEntries.forEach(({ el, node }) => {
      const visualKind = getNodeVisualKind(node);
      const label = el.querySelector('.pto-model-graphviz-node-label');
      const type = el.querySelector('.pto-model-graphviz-node-type');
      if (label) {
        label.setAttribute('dominant-baseline', visualKind === 'tensor' ? 'middle' : 'auto');
        label.style.paintOrder = 'stroke';
      }
      if (type) type.style.opacity = '0.92';
    });
  }

  function applySemanticNodeClasses(nodeEntries, evidenceMap, options) {
    const evidenceNodeClass = options.evidenceNodeClass || 'has-model-evidence';
    const parameterClass = options.parameterClass || 'is-parameter-object';
    const stateClass = options.stateClass || 'is-state-object';
    nodeEntries.forEach(({ el, node }) => {
      const semanticType = String(node.typeLabel || '').trim().toLowerCase();
      if (evidenceMap?.[node.id]) el.classList.add(evidenceNodeClass);
      if (semanticType === 'parameter') el.classList.add(parameterClass);
      if (semanticType === 'state') el.classList.add(stateClass);
    });
  }

  function createController(stage, svg, graph, metadata, options) {
    const opts = options || {};
    const interaction = opts.interaction === true ? {} : (opts.interaction || {});
    const overlays = opts.overlays === true ? {} : (opts.overlays || {});
    const evidenceMap = opts.evidenceMap || graph?.trainingEvidence || graph?.evidenceMap || {};
    const hasEvidence = Object.keys(evidenceMap || {}).length > 0;
    const selectedClass = opts.selectedClass || 'is-model-selected';
    const relatedClass = opts.relatedClass || 'is-model-related';
    const nodeEntries = metadata.nodeEntries || [];
    const edgeEntries = metadata.edgeEntries || [];
    const clusterEntries = metadata.clusterEntries || [];
    const width = metadata.width;
    const height = metadata.height;
    const hierarchy = buildHierarchy(graph);
    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const panZoomEnabled = interaction.panZoom !== false && opts.panZoom !== false;
    const wheelZoomWithoutModifier = interaction.wheelZoomWithoutModifier === true || opts.wheelZoomWithoutModifier === true;
    const selectable = interaction.selectable !== false && opts.selectable !== false;
    const hoverEnabled = overlays.evidence !== false && opts.evidence !== false && hasEvidence;
    const edgeTagsEnabled = overlays.edgeTags !== false && opts.edgeTags !== false;
    const edgeHoverEnabled = overlays.edgeHover !== false
      && opts.edgeHover !== false
      && edgeEntries.some((entry) => edgeHasHover(entry.edge));

    let selectedItemId = null;
    let selectedRelated = { nodeIds: new Set(), clusterIds: new Set() };
    let transform = { tx: 0, ty: 0, zoom: 1 };
    let pan = null;
    let suppressClick = false;
    let hover = null;
    let resizeObserver = null;

    stage.classList.add('pto-model-graphviz-interactive');
    if (opts.className) {
      String(opts.className).split(/\s+/).filter(Boolean).forEach((className) => stage.classList.add(className));
    }
    svg.classList.add('pto-model-graphviz-interactive-svg');
    applyTextContrast(nodeEntries);
    applySemanticNodeClasses(nodeEntries, evidenceMap, opts);

    if (edgeTagsEnabled) {
      drawEdgeTags(svg, edgeEntries, opts);
    }

    if (hoverEnabled || edgeHoverEnabled) {
      hover = createHover(stage, opts.hoverClassName);
    }

    function listen(target, type, handler, listenerOptions) {
      const optsWithSignal = abortController
        ? { ...(listenerOptions || {}), signal: abortController.signal }
        : listenerOptions;
      target.addEventListener(type, handler, optsWithSignal);
    }

    function applyTransform() {
      svg.style.width = `${width}px`;
      svg.style.height = `${height}px`;
      svg.style.transform = `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.zoom})`;
    }

    function setTransform(nextTransform) {
      if (!nextTransform) return;
      transform = {
        tx: Number.isFinite(Number(nextTransform.tx)) ? Number(nextTransform.tx) : transform.tx,
        ty: Number.isFinite(Number(nextTransform.ty)) ? Number(nextTransform.ty) : transform.ty,
        zoom: Number.isFinite(Number(nextTransform.zoom))
          ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(nextTransform.zoom)))
          : transform.zoom,
      };
      applyTransform();
    }

    function fit() {
      const rect = stage.getBoundingClientRect();
      const pad = Number.isFinite(Number(opts.viewportPadding)) ? Number(opts.viewportPadding) : 28;
      const widthFit = Math.max(120, rect.width - pad * 2) / width;
      const heightFit = Math.max(120, rect.height - pad * 2) / height;
      const readableFloor = Number.isFinite(Number(opts.minReadableZoom)) ? Number(opts.minReadableZoom) : 0.62;
      const fitZoom = opts.fitMode === 'full'
        ? Math.min(1.08, Math.max(MIN_ZOOM, Math.min(widthFit, heightFit)))
        : Math.min(1.08, Math.max(MIN_ZOOM, Math.min(widthFit, Math.max(heightFit, readableFloor))));
      transform.zoom = fitZoom;
      transform.tx = Math.max(pad / 2, (rect.width - width * fitZoom) / 2);
      transform.ty = height * fitZoom > rect.height
        ? pad / 2
        : Math.max(pad / 2, (rect.height - height * fitZoom) / 2);
      applyTransform();
    }

    function centerNode(nodeId) {
      const node = graph.nodes?.find((item) => item.id === nodeId);
      const cluster = graph.clusters?.find((item) => item.id === nodeId);
      if (!node && !cluster) return false;
      const center = node
        ? { x: node.x, y: node.y }
        : { x: cluster.x + cluster.width / 2, y: cluster.y + cluster.height / 2 };
      const rect = stage.getBoundingClientRect();
      transform.tx = rect.width / 2 - center.x * transform.zoom;
      transform.ty = rect.height / 2 - center.y * transform.zoom;
      applyTransform();
      return true;
    }

    function clearSelection() {
      selectedItemId = null;
      selectedRelated = { nodeIds: new Set(), clusterIds: new Set() };
      nodeEntries.forEach(({ el }) => el.classList.remove(selectedClass, relatedClass));
      clusterEntries.forEach(({ el }) => el.classList.remove(selectedClass, relatedClass));
      edgeEntries.forEach((entry) => {
        entry.el.classList.remove(relatedClass);
        if (entry.tagEl) entry.tagEl.classList.remove(relatedClass);
      });
    }

    function selectNode(nodeId, selectOptions) {
      const id = nodeId || null;
      if (!id) {
        clearSelection();
        return;
      }
      selectedItemId = id;
      selectedRelated = relationForNode(graph, evidenceMap, id, selectOptions?.relatedNodeIds, hierarchy);
      nodeEntries.forEach(({ el, node }) => {
        const isSelected = node.id === id;
        const isRelated = selectedRelated.nodeIds.has(node.id);
        el.classList.toggle(selectedClass, isSelected);
        el.classList.toggle(relatedClass, !isSelected && isRelated);
      });
      clusterEntries.forEach(({ el, cluster }) => {
        const isSelected = cluster.id === id;
        const isRelated = selectedRelated.clusterIds.has(cluster.id);
        el.classList.toggle(selectedClass, isSelected);
        el.classList.toggle(relatedClass, !isSelected && isRelated);
      });
      edgeEntries.forEach((entry) => {
        const related = selectedRelated.nodeIds.has(entry.source) && selectedRelated.nodeIds.has(entry.target);
        entry.el.classList.toggle(relatedClass, related);
        if (entry.tagEl) entry.tagEl.classList.toggle(relatedClass, related);
      });
      opts.onSelect?.({
        nodeId: id,
        relatedNodeIds: Array.from(selectedRelated.nodeIds),
        relatedClusterIds: Array.from(selectedRelated.clusterIds),
        source: selectOptions?.source || 'graph',
      });
    }

    function setFocus(focus) {
      if (!focus) return;
      const nodeId = typeof focus === 'string' ? focus : (focus.nodeId || focus.id);
      selectNode(nodeId, {
        relatedNodeIds: typeof focus === 'string' ? null : focus.relatedNodeIds,
        source: typeof focus === 'string' ? 'focus' : (focus.source || 'focus'),
      });
    }

    function setPhase(phase) {
      if (!phase) return;
      const nodeId = typeof phase === 'string' ? phase : phase.nodeId;
      selectNode(nodeId, {
        relatedNodeIds: typeof phase === 'string' ? null : phase.relatedNodeIds,
        source: 'phase',
      });
    }

    function showHover(node, event) {
      if (!hover) return;
      const info = evidenceMap[node.id] || {};
      hover.innerHTML = evidenceHtml(node, info, opts);
      hover.classList.add('is-visible');
      hover.setAttribute('aria-hidden', 'false');
      placeHover(stage, hover, event);
    }

    function showEdgeHover(edge, event) {
      if (!hover || !edgeHasHover(edge)) return;
      hover.innerHTML = edgeHoverHtml(edge, opts);
      hover.classList.add('is-visible');
      hover.setAttribute('aria-hidden', 'false');
      placeHover(stage, hover, event);
    }

    function hideHover() {
      if (!hover) return;
      hover.classList.remove('is-visible');
      hover.setAttribute('aria-hidden', 'true');
    }

    nodeEntries.forEach(({ el, node }) => {
      const itemSelectable = selectable && node.selectable !== false;
      const toggle = el.querySelector('.pto-model-graphviz-toggle');
      if (toggle && typeof opts.onToggle === 'function') {
        toggle.setAttribute('tabindex', '0');
        toggle.setAttribute('role', 'button');
        toggle.setAttribute('aria-label', `Expand ${node.label || node.id}`);
        listen(toggle, 'click', (event) => {
          event.stopPropagation();
          hideHover();
          opts.onToggle({ nodeId: node.id, collapsed: true, source: 'graph' });
        });
        listen(toggle, 'keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          opts.onToggle({ nodeId: node.id, collapsed: true, source: 'keyboard' });
        });
      }
      if (itemSelectable) {
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', node.label || node.id);
      }
      if (hoverEnabled) {
        listen(el, 'pointerenter', (event) => showHover(node, event));
        listen(el, 'pointermove', (event) => {
          if (hover?.classList.contains('is-visible')) placeHover(stage, hover, event);
        });
        listen(el, 'pointerleave', hideHover);
      }
      if (itemSelectable) {
        listen(el, 'click', (event) => {
          if (suppressClick) {
            suppressClick = false;
            return;
          }
          hideHover();
          selectNode(node.id, { source: 'graph' });
        });
        listen(el, 'keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          selectNode(node.id, { source: 'keyboard' });
        });
      }
    });

    if (edgeHoverEnabled) {
      edgeEntries.forEach((entry) => {
        if (!edgeHasHover(entry.edge)) return;
        const targets = [entry.el, entry.tagEl].filter(Boolean);
        targets.forEach((el) => {
          el.setAttribute('aria-label', edgeTagText(entry.edge) || entry.edge.title || 'edge object');
          listen(el, 'pointerenter', (event) => showEdgeHover(entry.edge, event));
          listen(el, 'pointermove', (event) => {
            if (hover?.classList.contains('is-visible')) placeHover(stage, hover, event);
          });
          listen(el, 'pointerleave', hideHover);
        });
      });
    }

    const selectableClusters = selectable && interaction.selectableClusters !== false && opts.selectableClusters !== false;
    clusterEntries.forEach(({ el, cluster }) => {
      const itemSelectable = selectableClusters && cluster.selectable !== false;
      const toggle = el.querySelector('.pto-model-graphviz-toggle');
      if (toggle && typeof opts.onToggle === 'function') {
        toggle.setAttribute('tabindex', '0');
        toggle.setAttribute('role', 'button');
        toggle.setAttribute('aria-label', `Collapse ${cluster.label || cluster.id}`);
        listen(toggle, 'click', (event) => {
          event.stopPropagation();
          hideHover();
          opts.onToggle({ nodeId: cluster.id, collapsed: false, source: 'graph' });
        });
        listen(toggle, 'keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          opts.onToggle({ nodeId: cluster.id, collapsed: false, source: 'keyboard' });
        });
      }
      if (!itemSelectable) {
        return;
      }
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', cluster.label || cluster.id);
      listen(el, 'click', (event) => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        hideHover();
        selectNode(cluster.id, { source: 'cluster' });
      });
      listen(el, 'keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectNode(cluster.id, { source: 'keyboard' });
      });
    });

    if (panZoomEnabled) {
      listen(stage, 'wheel', (event) => {
        if (!wheelZoomWithoutModifier && !event.ctrlKey && !event.metaKey) {
          if (global.parent && global.parent !== global) {
            global.parent.postMessage({
              type: 'pto-pattern-preview-wheel',
              deltaX: event.deltaX || 0,
              deltaY: event.deltaY || 0,
            }, '*');
          }
          return;
        }
        event.preventDefault();
        const rect = stage.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        const z0 = transform.zoom;
        const z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z0 * factor));
        transform.tx = px - (px - transform.tx) * (z1 / z0);
        transform.ty = py - (py - transform.ty) * (z1 / z0);
        transform.zoom = z1;
        applyTransform();
      }, { passive: false });

      listen(stage, 'pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('.pto-model-graphviz-node, .pto-model-graphviz-toggle, .pto-model-graphviz-edge, .pto-model-graphviz-edge-tag')) return;
        suppressClick = false;
        pan = { id: event.pointerId, x: event.clientX, y: event.clientY, tx: transform.tx, ty: transform.ty, moved: false };
      });

      listen(stage, 'pointermove', (event) => {
        if (!pan || pan.id !== event.pointerId) return;
        const dx = event.clientX - pan.x;
        const dy = event.clientY - pan.y;
        if (!pan.moved) {
          if (Math.hypot(dx, dy) < 4) return;
          pan.moved = true;
          stage.classList.add('is-panning');
          try { stage.setPointerCapture(event.pointerId); } catch (_) {}
        }
        transform.tx = pan.tx + dx;
        transform.ty = pan.ty + dy;
        applyTransform();
        event.preventDefault();
      });

      const endPan = (event) => {
        if (!pan || pan.id !== event.pointerId) return;
        if (pan.moved) suppressClick = true;
        pan = null;
        stage.classList.remove('is-panning');
        if (stage.hasPointerCapture && stage.hasPointerCapture(event.pointerId)) {
          stage.releasePointerCapture(event.pointerId);
        }
      };

      listen(stage, 'pointerup', endPan);
      listen(stage, 'pointercancel', endPan);
      listen(stage, 'lostpointercapture', endPan);
    }

    resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        if (opts.autoFit === false) return;
        if (!selectedItemId) fit();
      })
      : null;
    if (resizeObserver) resizeObserver.observe(stage);

    requestAnimationFrame(() => {
      if (opts.initialTransform) setTransform(opts.initialTransform);
      else if (opts.autoFit !== false) fit();
      if (opts.activeNodeId) {
        selectNode(opts.activeNodeId, {
          relatedNodeIds: opts.activeRelatedNodeIds,
          source: 'init',
        });
      }
    });

    return {
      svg,
      graph,
      hierarchy,
      selectNode,
      setFocus,
      setPhase,
      clearSelection,
      fit,
      centerNode,
      setTransform,
      getTransform() {
        return { ...transform };
      },
      destroy() {
        abortController?.abort();
        resizeObserver?.disconnect();
        stage.innerHTML = '';
      },
    };
  }

  function render(container, graph, options) {
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) return null;
    const data = cloneGraph(graph || DEEPSEEK_V32_DEFAULT_GRAPH);
    const resolvedOptions = options || {};
    const width = resolvedOptions.width || data.width || 1180;
    const height = resolvedOptions.height || data.height || 520;
    target.innerHTML = '';

    const markerId = `pto-model-graphviz-arrowhead-${renderSequence += 1}`;
    const svg = createSvgElement('svg', {
      role: 'img',
      'aria-label': resolvedOptions.ariaLabel || 'PTO model graphviz pattern preview',
      viewBox: `0 0 ${width} ${height}`,
    });
    const defs = createSvgElement('defs');
    drawMarker(defs, markerId);
    svg.appendChild(defs);

    const colorMapOptions = resolvedColormapOptions(resolvedOptions);
    const colorMap = buildColorMap(collectColorKeys(data), colorMapOptions);
    const clusterColors = resolveClusterColors(data, colorMap, colorMapOptions);
    const nodesById = nodeMap(data);
    const clusterEntries = [];
    const nodeEntries = [];
    const edgeEntries = [];

    (data.clusters || []).forEach((cluster) => {
      const el = drawCluster(svg, cluster, clusterColors.get(cluster.id) || normalizeColormapColor(CORE_COLORS[0], colorMapOptions));
      clusterEntries.push({ el, cluster });
    });

    const renderedEdges = new Set();
    (data.edges || []).forEach((edge) => {
      const source = nodesById.get(edge.source);
      const targetNode = nodesById.get(edge.target);
      if (!source || !targetNode) return;
      const edgeKey = `${edge.source}->${edge.target}`;
      if (renderedEdges.has(edgeKey)) return;
      renderedEdges.add(edgeKey);
      const el = createSvgElement('path', {
        class: `pto-model-graphviz-edge${edge.dataState ? ` is-${classToken(edge.dataState)}` : ''}`,
        d: edgePath(source, targetNode, edge),
        stroke: edge.color || LINE_COLOR,
        'stroke-dasharray': edge.dashed ? '8 7' : null,
        'marker-end': `url(#${markerId})`,
        'data-source': edge.source,
        'data-target': edge.target,
      });
      svg.appendChild(el);
      edgeEntries.push({ el, edge, source: edge.source, target: edge.target, sourceNode: source, targetNode, avoidNodes: data.nodes, avoidClusters: data.clusters, tagEl: null });
    });

    (data.nodes || []).forEach((node) => {
      const el = drawNode(svg, node, resolveNodeColor(node, colorMap, clusterColors), resolvedOptions);
      nodeEntries.push({ el, node });
    });

    if (resolvedOptions.reportOverlays !== false) {
      (data.clusters || []).forEach((cluster) => {
        drawClusterTitlePill(svg, cluster);
      });
    }

    target.appendChild(svg);
    const metadata = { width, height, nodeEntries, edgeEntries, clusterEntries };
    svg.ptoModelGraphviz = { graph: data, metadata };
    if (resolvedOptions.interaction || resolvedOptions.overlays || resolvedOptions.attachController) {
      svg.ptoModelGraphvizController = createController(target, svg, data, metadata, resolvedOptions);
    }
    return svg;
  }

  function renderController(container, graph, options) {
    const svg = render(container, graph, {
      ...(options || {}),
      attachController: true,
      interaction: options?.interaction === undefined ? true : options.interaction,
      overlays: options?.overlays === undefined ? true : options.overlays,
    });
    return svg?.ptoModelGraphvizController || null;
  }

  global.PtoModelGraphvizPattern = {
    render,
    renderController,
    buildColorMap,
    modelArchitectureColormap,
    buildHierarchy,
    relationForNode,
    drawEdgeTags,
    standardColormap: {
      coreColors: [...STANDARD_COLORMAP.coreColors],
      ioColors: { ...STANDARD_COLORMAP.ioColors },
    },
    modelArchitectureColorProfile: {
      neutral: MODEL_ARCHITECTURE_NEUTRAL,
      lightHsl: { ...MODEL_ARCHITECTURE_LIGHT_HSL },
      keyAliases: { ...MODEL_ARCHITECTURE_COLOR_KEY_ALIASES },
      baseColors: { ...MODEL_ARCHITECTURE_BASE_COLORS },
    },
    reportPriorityColors: { ...REPORT_PRIORITY_COLORS },
    defaultDotLayout: { ...DEFAULT_DOT_LAYOUT },
    sourcePages: {
      deepseekV32: './assets/deepseek_v32_modelviz.html',
      qwen7b: './assets/qwen7b_modelviz.html',
    },
    schemaAssets: {
      deepseekV32: './assets/deepseek_v32_model_architecture.json',
      qwen7b: './assets/qwen7b_model_architecture.json',
      gemma: './assets/gemma_model_architecture.json',
    },
    defaultGraphs: {
      deepseekV32: DEEPSEEK_V32_DEFAULT_GRAPH,
    },
  };
})(window);

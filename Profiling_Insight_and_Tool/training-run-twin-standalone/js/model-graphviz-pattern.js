(function registerPtoModelGraphvizPattern(global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CORE_COLORS = [
    '#14B8A6',
    '#06B6D4',
    '#EC4899',
    '#A855F7',
    '#0EA5E9',
    '#3B82F6',
    '#8B5CF6',
    '#F59E0B',
    '#F97316',
    '#22D3EE',
  ];
  const SEMANTIC_COLOR_DEFAULTS = {
    'sem:embedding': '#14B8A6',
    'sem:norm': '#06B6D4',
    'sem:attention': '#EC4899',
    'sem:position': '#A855F7',
    'sem:rope': '#A855F7',
    'sem:qknorm': '#0EA5E9',
    'sem:linear': '#3B82F6',
    'sem:head': '#3B82F6',
    'sem:mlp': '#8B5CF6',
    'sem:act': '#8B5CF6',
    'sem:gate': '#F59E0B',
    'sem:moe': '#F97316',
    'sem:comm': '#22D3EE',
  };
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

  function edgeTagWidth(label) {
    return Math.max(38, Math.min(94, String(label || '').length * 5.7 + 18));
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
      ioColors: colormap.ioColors || {},
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
    const generatedKeys = semanticKeys.filter((key) => !SEMANTIC_COLOR_DEFAULTS[key]);
    const colors = expandPalette(resolved.coreColors, Math.max(semanticKeys.length, resolved.coreColors.length), resolved);
    const map = new Map();
    map.set('io:input', normalizeColormapColor(resolved.ioColors.input || '#A855F7', resolved));
    map.set('io:output', normalizeColormapColor(resolved.ioColors.output || '#38BDF8', resolved));
    map.set('io:constant', normalizeColormapColor(resolved.ioColors.constant || '#64748B', resolved));
    map.set('io:parameter', normalizeColormapColor(resolved.ioColors.parameter || '#3B82F6', resolved));
    Object.entries(SEMANTIC_COLOR_DEFAULTS).forEach(([key, color]) => {
      if (unique.includes(key)) map.set(key, normalizeColormapColor(color, resolved));
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

  function edgePath(source, target, edge) {
    const vertical = Math.abs(source.y - target.y) >= Math.abs(source.x - target.x);
    const sourceAnchor = edge?.sourceAnchor || (vertical
      ? source.y < target.y ? 'bottom' : 'top'
      : source.x < target.x ? 'right' : 'left');
    const targetAnchor = edge?.targetAnchor || (vertical
      ? source.y < target.y ? 'top' : 'bottom'
      : source.x < target.x ? 'left' : 'right');
    const start = nodeAnchor(source, sourceAnchor);
    const end = nodeAnchor(target, targetAnchor);
    const curve = edge?.curve || (vertical ? 'vertical' : 'horizontal');

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
    const group = createSvgElement('g', {
      class: 'pto-model-graphviz-cluster',
      'data-cluster-id': cluster.id,
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
      fill: '#FFFFFF',
      'fill-opacity': '0.10',
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

    const toggleX = cluster.x + cluster.width - 13;
    const toggleY = cluster.y + 13; // top-right corner anchor
    group.appendChild(createSvgElement('circle', {
      class: 'pto-model-graphviz-toggle',
      cx: toggleX,
      cy: toggleY,
      r: 7.5,
    }));
    const icon = createSvgElement('text', {
      class: 'pto-model-graphviz-toggle-icon',
      x: toggleX,
      y: toggleY + 0.3,
      'font-size': '12',
    });
    icon.textContent = '-';
    group.appendChild(icon);
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

  function drawNode(svg, node, color, options) {
    const visualKind = getNodeVisualKind(node);
    const cornerRadius = visualKind === 'tensor'
      ? Math.min(14, Math.max(8, node.height * 0.32))
      : node.height / 2;
    const overlayKind = classToken(node.overlayKind || node.overlayType);
    const extraClasses = [
      node.collapsed ? 'is-collapsed' : '',
      node.virtual ? 'is-virtual' : '',
      node.glyph ? 'is-glyph' : '',
      overlayKind ? `is-overlay-${overlayKind}` : '',
    ].filter(Boolean).join(' ');
    const group = createSvgElement('g', {
      class: `pto-model-graphviz-node is-${visualKind}${extraClasses ? ` ${extraClasses}` : ''}`,
      transform: `translate(${node.x}, ${node.y})`,
      'data-node-id': node.id,
      'data-node-kind': visualKind,
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

    const label = createSvgElement('text', {
      class: 'pto-model-graphviz-node-label',
      x: node.collapsed ? -8 : 0,
      y: visualKind === 'tensor' || node.hideTypeLabel || node.glyph ? 0 : -4,
      fill: NODE_TEXT_COLOR,
    });
    label.textContent = node.label || node.id;
    group.appendChild(label);

    if (visualKind !== 'tensor' && !node.hideTypeLabel && !node.glyph) {
      const type = createSvgElement('text', {
        class: 'pto-model-graphviz-node-type',
        x: node.collapsed ? -8 : 0,
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
      const icon = createSvgElement('text', {
        class: 'pto-model-graphviz-toggle-icon',
        x: toggleX,
        y: toggleY + 0.2,
      });
      icon.textContent = '+';
      group.appendChild(icon);
    }

    if (options?.reportOverlays !== false) {
      drawReportBadge(group, node);
    }
    svg.appendChild(group);
    return group;
  }

  function drawEdgeTags(svg, edgeEntries, options) {
    const layerClass = options.edgeTagLayerClass || 'pto-model-graphviz-edge-tags';
    const tagClass = options.edgeTagClass || 'pto-model-graphviz-edge-tag';
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
        point = entry.el.getPointAtLength(length * (Number(edge.tagPosition) || 0.52));
      } catch (_) {
        return;
      }

      const width = edgeTagWidth(label);
      const height = 18;
      const group = createSvgElement('g', {
        class: tagClass,
        transform: `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`,
        'data-edge-type': normalizeEdgeType(edge),
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
      });
      text.textContent = label;
      group.appendChild(text);
      layer.appendChild(group);
      entry.tagEl = group;
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
    const selectable = interaction.selectable !== false && opts.selectable !== false;
    const hoverEnabled = overlays.evidence !== false && opts.evidence !== false && hasEvidence;
    const edgeTagsEnabled = overlays.edgeTags !== false && opts.edgeTags !== false;

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

    if (hoverEnabled) {
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

    function hideHover() {
      if (!hover) return;
      hover.classList.remove('is-visible');
      hover.setAttribute('aria-hidden', 'true');
    }

    nodeEntries.forEach(({ el, node }) => {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', node.label || node.id);
      if (hoverEnabled) {
        listen(el, 'pointerenter', (event) => showHover(node, event));
        listen(el, 'pointermove', (event) => {
          if (hover?.classList.contains('is-visible')) placeHover(stage, hover, event);
        });
        listen(el, 'pointerleave', hideHover);
      }
      if (selectable) {
        listen(el, 'click', () => {
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

    clusterEntries.forEach(({ el, cluster }) => {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', cluster.label || cluster.id);
      if (!selectable) return;
      listen(el, 'click', () => {
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
        if (!event.ctrlKey && !event.metaKey) return;
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
        if (event.target.closest('.pto-model-graphviz-node, .pto-model-graphviz-toggle')) return;
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
    const declaredWidth = resolvedOptions.width || data.width || 1180;
    const declaredHeight = resolvedOptions.height || data.height || 520;
    target.innerHTML = '';

    // node.x/y 是节点中心,左列参数节点会因半宽落到负坐标(见 drawNode 的 rect x=-width/2)。
    // 若 viewBox 固定从 0,0 起,这些负坐标内容会被 <svg> 视口裁掉(左侧截断)。
    // 这里按节点(含半宽)与集群的真实包围盒扩展 viewBox,保证越界内容仍在可视区内。
    const VIEWBOX_PAD = 12;
    let minX = 0;
    let minY = 0;
    let maxX = declaredWidth;
    let maxY = declaredHeight;
    (data.nodes || []).forEach((node) => {
      const halfW = (node.width || 0) / 2;
      const halfH = (node.height || 0) / 2;
      minX = Math.min(minX, node.x - halfW);
      maxX = Math.max(maxX, node.x + halfW);
      minY = Math.min(minY, node.y - halfH);
      maxY = Math.max(maxY, node.y + halfH);
    });
    (data.clusters || []).forEach((cluster) => {
      minX = Math.min(minX, cluster.x);
      maxX = Math.max(maxX, cluster.x + (cluster.width || 0));
      minY = Math.min(minY, cluster.y);
      maxY = Math.max(maxY, cluster.y + (cluster.height || 0));
    });
    minX -= VIEWBOX_PAD;
    minY -= VIEWBOX_PAD;
    maxX += VIEWBOX_PAD;
    maxY += VIEWBOX_PAD;
    const vbX = Math.min(0, minX);
    const vbY = Math.min(0, minY);
    const width = maxX - vbX;
    const height = maxY - vbY;

    const markerId = `pto-model-graphviz-arrowhead-${renderSequence += 1}`;
    const svg = createSvgElement('svg', {
      role: 'img',
      'aria-label': resolvedOptions.ariaLabel || 'PTO model graphviz pattern preview',
      viewBox: `${vbX} ${vbY} ${width} ${height}`,
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
        class: 'pto-model-graphviz-edge',
        d: edgePath(source, targetNode, edge),
        stroke: edge.color || LINE_COLOR,
        'stroke-dasharray': edge.dashed ? '8 7' : null,
        'marker-end': `url(#${markerId})`,
        'data-source': edge.source,
        'data-target': edge.target,
      });
      svg.appendChild(el);
      edgeEntries.push({ el, edge, source: edge.source, target: edge.target, tagEl: null });
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
    buildHierarchy,
    relationForNode,
    drawEdgeTags,
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

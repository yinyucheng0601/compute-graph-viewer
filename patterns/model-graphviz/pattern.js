(function registerPtoModelGraphvizPattern(global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CORE_COLORS = [
    '#34D399',
    '#14B8A6',
    '#06B6D4',
    '#0EA5E9',
    '#3B82F6',
    '#6366F1',
    '#8B5CF6',
    '#A855F7',
    '#1E40AF',
  ];
  const COLORMAP_SATURATION = 0.82;
  const COLORMAP_LIGHTNESS = 0.40;
  const FORBIDDEN_HUES = { from: 300 / 360, to: 150 / 360, wraps: true };
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
  let renderSequence = 0;

  const DEEPSEEK_V32_DEFAULT_GRAPH = {
    width: 720,
    height: 1280,
    clusters: [
      { id: 'transformer-core', label: 'Transformer Core (27 layers)', x: 160, y: 86, width: 400, height: 1050, colorKey: 'module:transformer-core', reportPriority: 'P0' },
      { id: 'decoder-block', label: 'Decoder Block (repeated 27x)', x: 178, y: 240, width: 364, height: 500, colorKey: 'module:decoder-block', reportPriority: 'P0' },
    ],
    nodes: [
      { id: 'token-ids', label: 'token ids [B,T]', typeLabel: 'Tensor', kind: 'tensor', x: 360, y: 44, width: 190, height: 48, colorKey: 'io:input' },
      { id: 'embedding', label: 'ParallelEmbedding [102400,2048]', typeLabel: 'Module (Parallel...)', kind: 'op', x: 360, y: 150, width: 330, height: 56, colorKey: 'sem:embedding', reportPriority: 'P2' },
      { id: 'hidden', label: 'hidden [B,T,2048]', typeLabel: 'Tensor', kind: 'tensor', x: 360, y: 296, width: 230, height: 54, parent: 'decoder-block' },
      { id: 'attn-norm', label: 'attn_norm fused residual', typeLabel: 'Op', kind: 'op', x: 320, y: 390, width: 286, height: 58, parent: 'decoder-block' },
      { id: 'mla', label: 'MLA attention', typeLabel: 'Module (MLA atte...)', kind: 'op', x: 330, y: 486, width: 214, height: 58, colorKey: 'sem:attention', parent: 'decoder-block', reportPriority: 'P1' },
      { id: 'mla-indexer', label: 'MLA + Sparse Indexer', typeLabel: 'Module (MLA + Sp...)', x: 340, y: 582, width: 286, height: 58, colorKey: 'module:mla-indexer', collapsed: true, parent: 'decoder-block' },
      { id: 'ffn-norm', label: 'ffn_norm fused residual', typeLabel: 'Op', kind: 'op', x: 355, y: 682, width: 288, height: 58, parent: 'decoder-block' },
      { id: 'ffn-choice', label: 'Feed Forward Choice', typeLabel: 'Module (Feed For...)', x: 365, y: 790, width: 286, height: 58, colorKey: 'module:ffn-choice', collapsed: true },
      { id: 'block-output', label: 'block output [B,T,2048]', typeLabel: 'Tensor', kind: 'tensor', x: 360, y: 900, width: 245, height: 54, colorKey: 'io:output' },
      { id: 'final-norm', label: 'final RMSNorm', typeLabel: 'Op', kind: 'op', x: 360, y: 1016, width: 210, height: 56, colorKey: 'sem:norm' },
      { id: 'lm-head', label: 'LM head -> vocab 102400', typeLabel: 'Module (LM head ...)', kind: 'op', x: 360, y: 1100, width: 292, height: 56, colorKey: 'sem:linear', reportPriority: 'P2' },
      { id: 'logits', label: 'logits [B,102400]', typeLabel: 'Tensor', kind: 'tensor', x: 360, y: 1220, width: 230, height: 48, colorKey: 'io:output', reportPriority: 'P2' },
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
    if (!FORBIDDEN_HUES.wraps) {
      return h >= FORBIDDEN_HUES.from && h <= FORBIDDEN_HUES.to;
    }
    return h >= FORBIDDEN_HUES.from || h <= FORBIDDEN_HUES.to;
  }

  function snapToValidHue(hue) {
    const h = normalizeHue(hue);
    if (!isHueForbidden(h)) return h;
    const lower = FORBIDDEN_HUES.to;
    const upper = FORBIDDEN_HUES.from;
    const distanceToLower = Math.min(Math.abs(h - lower), 1 - Math.abs(h - lower));
    const distanceToUpper = Math.min(Math.abs(h - upper), 1 - Math.abs(h - upper));
    return distanceToLower <= distanceToUpper ? lower : upper;
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

  function normalizeColormapColor(hex) {
    const hsl = hexToHsl(hex);
    return hslToHex(snapToValidHue(hsl.h), COLORMAP_SATURATION, COLORMAP_LIGHTNESS);
  }

  function expandPalette(baseHexes, targetCount) {
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

    const colors = baseHexes.map(normalizeColormapColor);
    const extraHues = hues.filter((hue) => !coreHueSet.has(Math.round(hue * 1e6)));
    for (const hue of extraHues) {
      if (colors.length >= targetCount) break;
      colors.push(hslToHex(hue, COLORMAP_SATURATION, COLORMAP_LIGHTNESS));
    }
    while (colors.length < targetCount) {
      for (const hue of hues) {
        if (colors.length >= targetCount) break;
        colors.push(hslToHex(hue, COLORMAP_SATURATION, COLORMAP_LIGHTNESS));
      }
    }

    return colors.slice(0, targetCount);
  }

  function buildColorMap(keys) {
    const unique = Array.from(new Set(keys || []));
    const semanticKeys = unique.filter((key) => !String(key).startsWith('io:')).sort();
    const colors = expandPalette(CORE_COLORS, Math.max(semanticKeys.length, CORE_COLORS.length));
    const map = new Map();
    map.set('io:input', normalizeColormapColor('#A855F7'));
    map.set('io:output', normalizeColormapColor('#34D399'));
    map.set('io:constant', normalizeColormapColor('#64748B'));
    map.set('io:parameter', normalizeColormapColor('#3B82F6'));
    semanticKeys.forEach((key, index) => map.set(key, colors[index]));
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

  function resolveClusterColors(graph, colorMap) {
    const colors = new Map();
    (graph.clusters || []).forEach((cluster) => {
      const key = cluster.colorKey || `parent:${cluster.id}`;
      colors.set(cluster.id, colorMap.get(key) || CORE_COLORS[0]);
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
    if (node.parent && clusterColors.has(node.parent)) {
      return clusterColors.get(node.parent);
    }
    const key = node.colorKey || `type:${node.kind || 'node'}`;
    return colorMap.get(key) || CORE_COLORS[1];
  }

  function nodeAnchor(node, direction) {
    const x = direction === 'left' ? node.x - node.width / 2 : direction === 'right' ? node.x + node.width / 2 : node.x;
    const y = direction === 'top' ? node.y - node.height / 2 : direction === 'bottom' ? node.y + node.height / 2 : node.y;
    return { x, y };
  }

  function edgePath(source, target) {
    const vertical = Math.abs(source.y - target.y) >= Math.abs(source.x - target.x);
    const start = vertical
      ? nodeAnchor(source, source.y < target.y ? 'bottom' : 'top')
      : nodeAnchor(source, source.x < target.x ? 'right' : 'left');
    const end = vertical
      ? nodeAnchor(target, source.y < target.y ? 'top' : 'bottom')
      : nodeAnchor(target, source.x < target.x ? 'left' : 'right');

    if (vertical) {
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
    const group = createSvgElement('g', { class: 'pto-model-graphviz-cluster' });
    const isRepeat = Boolean(cluster.repeat);
    const radius = Math.min(24, Math.max(12, Math.min(cluster.width, cluster.height) * 0.08));
    group.appendChild(createSvgElement('rect', {
      x: cluster.x,
      y: cluster.y,
      width: cluster.width,
      height: cluster.height,
      rx: radius,
      ry: radius,
      fill: isRepeat ? color : '#FFFFFF',
      'fill-opacity': isRepeat ? '0.12' : '0.10',
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
    const toggleY = cluster.y + cluster.height / 2;
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

  function drawNode(svg, node, color) {
    const visualKind = getNodeVisualKind(node);
    const cornerRadius = visualKind === 'tensor'
      ? Math.min(14, Math.max(8, node.height * 0.32))
      : node.height / 2;
    const group = createSvgElement('g', {
      class: `pto-model-graphviz-node is-${visualKind}${node.collapsed ? ' is-collapsed' : ''}`,
      transform: `translate(${node.x}, ${node.y})`,
    });
    const rect = createSvgElement('rect', {
      x: -node.width / 2,
      y: -node.height / 2,
      width: node.width,
      height: node.height,
      rx: cornerRadius,
      ry: cornerRadius,
      fill: color,
    });
    group.appendChild(rect);

    const label = createSvgElement('text', {
      class: 'pto-model-graphviz-node-label',
      x: node.collapsed ? -8 : 0,
      y: visualKind === 'tensor' ? 0 : -5,
      fill: NODE_TEXT_COLOR,
    });
    label.textContent = node.label || node.id;
    group.appendChild(label);

    if (visualKind !== 'tensor') {
      const type = createSvgElement('text', {
        class: 'pto-model-graphviz-node-type',
        x: node.collapsed ? -8 : 0,
        y: 20,
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

    drawReportBadge(group, node);
    svg.appendChild(group);
  }

  function render(container, graph, options) {
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) return null;
    const data = graph || DEEPSEEK_V32_DEFAULT_GRAPH;
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

    const colorMap = buildColorMap(collectColorKeys(data));
    const clusterColors = resolveClusterColors(data, colorMap);
    const nodeMap = new Map((data.nodes || []).map((node) => [node.id, node]));

    (data.clusters || []).forEach((cluster) => {
      drawCluster(svg, cluster, clusterColors.get(cluster.id) || CORE_COLORS[0]);
    });

    const renderedEdges = new Set();
    (data.edges || []).forEach((edge) => {
      const source = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!source || !targetNode) return;
      const edgeKey = `${edge.source}->${edge.target}`;
      if (renderedEdges.has(edgeKey)) return;
      renderedEdges.add(edgeKey);
      svg.appendChild(createSvgElement('path', {
        class: 'pto-model-graphviz-edge',
        d: edgePath(source, targetNode),
        stroke: edge.color || LINE_COLOR,
        'stroke-dasharray': edge.dashed ? '8 7' : null,
        'marker-end': `url(#${markerId})`,
      }));
    });

    (data.nodes || []).forEach((node) => {
      drawNode(svg, node, resolveNodeColor(node, colorMap, clusterColors));
    });

    (data.clusters || []).forEach((cluster) => {
      drawClusterTitlePill(svg, cluster);
    });

    target.appendChild(svg);
    return svg;
  }

  global.PtoModelGraphvizPattern = {
    render,
    buildColorMap,
    reportPriorityColors: { ...REPORT_PRIORITY_COLORS },
    defaultDotLayout: { ...DEFAULT_DOT_LAYOUT },
    sourcePages: {
      deepseekV32: '../../graphviz/deepseek_v32_source_graph.html',
      deepseekV4: '../../graphviz/torchvista_graphviz_deepseek_v4.html',
    },
    defaultGraphs: {
      deepseekV32: DEEPSEEK_V32_DEFAULT_GRAPH,
    },
  };
})(window);

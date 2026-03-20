(function () {
  const PIPELINE_LABELS = {
    shared: 'Shared',
    query: 'Query',
    key: 'Key',
    weight: 'Weight',
  };

  const PIPELINE_LOOKUP = {
    query: 'Query',
    key: 'Key',
    weight: 'Weight',
    shared: 'Prolog',
  };

  const PIPELINE_TONES = {
    query: { s: 0.8952879581151836, l: 0.6254901960784314 },
    key: { s: 0.8953488372093027, l: 0.6627450980392157 },
    weight: { s: 0.5344827586206896, l: 0.4549019607843137 },
    shared: { s: 0.08, l: 0.48 },
  };

  const PIPELINE_FALLBACKS = {
    query: '#4A8BF5',
    key: '#8B5CF6',
    weight: '#36B29F',
    shared: '#847E71',
  };

  function localHexToRgb(hex) {
    const normalized = String(hex || '').replace('#', '');
    if (normalized.length !== 6) return { r: 128, g: 128, b: 128 };
    const value = parseInt(normalized, 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255,
    };
  }

  function rgbString(rgb) {
    return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  }

  function resolvePipelineHue(key) {
    if (key === 'shared') return 40 / 360;
    const lookup = PIPELINE_LOOKUP[key];
    if (typeof PIPELINE_HUES !== 'undefined' && PIPELINE_HUES?.[lookup]?.h != null) {
      return PIPELINE_HUES[lookup].h;
    }
    return 220 / 360;
  }

  function resolvePipelineAccent(key) {
    const tone = PIPELINE_TONES[key];
    if (typeof hslToHex === 'function') {
      return hslToHex({
        h: resolvePipelineHue(key),
        s: tone.s,
        l: tone.l,
      });
    }
    return PIPELINE_FALLBACKS[key];
  }

  function buildPipelineTheme(key) {
    const accent = resolvePipelineAccent(key);
    const rgb = typeof hexToRgb === 'function' ? hexToRgb(accent) : localHexToRgb(accent);
    const alpha = key === 'shared' ? 0.08 : 0.10;
    return {
      label: PIPELINE_LABELS[key],
      accent,
      rgb,
      rgbCss: rgbString(rgb),
      bg: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`,
    };
  }

  const PIPELINES = {
    shared: buildPipelineTheme('shared'),
    query: buildPipelineTheme('query'),
    key: buildPipelineTheme('key'),
    weight: buildPipelineTheme('weight'),
  };

  const SIGNALS = [
    'Duration heat-map: 用时长热度表达热点，目的不是绝对 profiling，而是让人一眼看到瓶颈段落。',
    'Core assignment badge: 每个节点都挂着 AIC / AIV 信息，说明作者想把“谁执行”直接贴回 DAG。',
    'Memory R/W indicators: 读写强度跟着节点展示，强调执行代价不仅是时长，还有搬运与写回。',
    'Playback progress: 底部时间条驱动节点 running / done 状态，说明原型想做时序回放。',
    'Pipeline color coding: Query / Key / Weight 三条路径被分区着色，便于看跨路径依赖。',
    'Diagnostics sidebar: 右侧不仅是 inspector，还包含 critical path 和优化建议，偏向性能分析台。',
  ];

  const REGIONS = [
    { pipeline: 'query', x: 200, y: 0, w: 1350, h: 230 },
    { pipeline: 'key', x: 200, y: 340, w: 1350, h: 260 },
    { pipeline: 'weight', x: 360, y: 575, w: 550, h: 105 },
  ];

  const NODES = [
    { id: 'reshape', name: 'Reshape\nInputs', pipeline: 'shared', unit: 'vector', core: 'AIV 0', x: 60, y: 310, w: 120, h: 62, start: 0.000, duration: 0.020, memR: 0, memW: 0, desc: 'Reshape NZ to 2D for shared weights and normalization inputs.' },
    { id: 'q_view', name: 'Q:View\nNorm', pipeline: 'query', unit: 'vector', core: 'AIV 1', x: 230, y: 120, w: 110, h: 62, start: 0.020, duration: 0.010, memR: 0, memW: 0, desc: 'Prepare normalized query view.' },
    { id: 'q_linear', name: 'Q:Linear\nMatMul', pipeline: 'query', unit: 'cube', core: 'AIC 0-7', x: 390, y: 120, w: 130, h: 62, start: 0.030, duration: 0.310, memR: 2048, memW: 2048, desc: 'Main query-side matmul; the obvious hotspot in the prototype.', status: 'warning', tiles: 8 },
    { id: 'q_dequant', name: 'Q:Dequant\nScale', pipeline: 'query', unit: 'vector', core: 'AIV 2-5', x: 570, y: 80, w: 120, h: 62, start: 0.345, duration: 0.065, memR: 0, memW: 0, desc: 'Dequantize INT32 accumulation back to BF16-compatible flow.' },
    { id: 'q_cossin', name: 'Q:View\nCos/Sin', pipeline: 'query', unit: 'vector', core: 'AIV 7', x: 230, y: 20, w: 110, h: 52, start: 0.020, duration: 0.008, memR: 0, memW: 0, desc: 'Expose shared rope tables for both query and key branches.' },
    { id: 'q_split', name: 'Q:Split\nRoPE/NoPE', pipeline: 'query', unit: 'vector', core: 'AIV 6', x: 570, y: 175, w: 120, h: 52, start: 0.412, duration: 0.015, memR: 0, memW: 0, desc: 'Split rope and non-rope channels before specialized handling.' },
    { id: 'q_rope3d', name: 'Q:RoPE\n3D', pipeline: 'query', unit: 'vector', core: 'AIV 8-9', x: 740, y: 50, w: 110, h: 62, start: 0.430, duration: 0.070, memR: 0, memW: 0, desc: 'Apply rotate-half plus cos/sin fusion on the rope slice.' },
    { id: 'q_nope', name: 'Q:NoPE\nCast', pipeline: 'query', unit: 'vector', core: 'AIV 10', x: 740, y: 150, w: 110, h: 52, start: 0.430, duration: 0.025, memR: 0, memW: 0, desc: 'Type alignment on the non-rope slice.' },
    { id: 'q_concat', name: 'Q:Concat\nRoPE+NoPE', pipeline: 'query', unit: 'vector', core: 'AIV 11', x: 900, y: 95, w: 120, h: 52, start: 0.503, duration: 0.020, memR: 0, memW: 0, desc: 'Rejoin the two query-side branches.' },
    { id: 'q_hadamard', name: 'Q:Hadamard\nMatMul', pipeline: 'query', unit: 'cube', core: 'AIC 0-3', x: 1070, y: 70, w: 130, h: 62, start: 0.528, duration: 0.195, memR: 512, memW: 512, desc: 'Second heavy query-side cube op after concat.', tiles: 4 },
    { id: 'q_quant', name: 'Q:Quant\nINT8', pipeline: 'query', unit: 'vector', core: 'AIV 12-13', x: 1250, y: 70, w: 110, h: 62, start: 0.726, duration: 0.060, memR: 0, memW: 0, desc: 'Quantize query results into compact INT8 representation.' },
    { id: 'q_assemble', name: 'Q:Assemble\nOutput', pipeline: 'query', unit: 'memory', core: 'AIV 14', x: 1410, y: 70, w: 120, h: 52, start: 0.788, duration: 0.030, memR: 0, memW: 4096, desc: 'Write query output bundle back to memory.' },
    { id: 'k_view', name: 'K:View\nX_in', pipeline: 'key', unit: 'vector', core: 'AIV 16', x: 230, y: 420, w: 110, h: 62, start: 0.020, duration: 0.010, memR: 0, memW: 0, desc: 'Prepare key-side input window.' },
    { id: 'k_linear', name: 'K:Linear\nMatMul', pipeline: 'key', unit: 'cube', core: 'AIC 8-13', x: 390, y: 420, w: 130, h: 62, start: 0.030, duration: 0.250, memR: 2048, memW: 1024, desc: 'Key-side matmul with notable but secondary cost.', tiles: 6 },
    { id: 'k_layernorm', name: 'K:Layer\nNorm', pipeline: 'key', unit: 'vector', core: 'AIV 17-18', x: 570, y: 420, w: 120, h: 62, start: 0.283, duration: 0.075, memR: 0, memW: 0, desc: 'Normalize the key branch before rope split.' },
    { id: 'k_split', name: 'K:Split\nRoPE/NoPE', pipeline: 'key', unit: 'vector', core: 'AIV 19', x: 740, y: 365, w: 110, h: 52, start: 0.360, duration: 0.012, memR: 0, memW: 0, desc: 'Split key branch for rope and non-rope treatment.' },
    { id: 'k_rope2d', name: 'K:RoPE\n2D', pipeline: 'key', unit: 'vector', core: 'AIV 20', x: 740, y: 450, w: 110, h: 62, start: 0.374, duration: 0.055, memR: 0, memW: 0, desc: 'Apply 2D rope using the shared cos/sin path.' },
    { id: 'k_nope', name: 'K:NoPE\nCast', pipeline: 'key', unit: 'vector', core: 'AIV 21', x: 740, y: 540, w: 110, h: 52, start: 0.374, duration: 0.020, memR: 0, memW: 0, desc: 'Type alignment for the non-rope key slice.' },
    { id: 'k_concat', name: 'K:Concat\nRoPE+NoPE', pipeline: 'key', unit: 'vector', core: 'AIV 22', x: 900, y: 460, w: 120, h: 52, start: 0.432, duration: 0.018, memR: 0, memW: 0, desc: 'Rejoin rope and non-rope slices on the key side.' },
    { id: 'k_hadamard', name: 'K:Hadamard\nMatMul', pipeline: 'key', unit: 'cube', core: 'AIC 14-16', x: 1070, y: 430, w: 130, h: 62, start: 0.454, duration: 0.155, memR: 256, memW: 256, desc: 'Secondary cube hotspot in the key pipeline.', tiles: 3 },
    { id: 'k_quant', name: 'K:Quant\nINT8', pipeline: 'key', unit: 'vector', core: 'AIV 23', x: 1250, y: 430, w: 110, h: 62, start: 0.612, duration: 0.050, memR: 0, memW: 0, desc: 'Quantize key results before cache update.' },
    { id: 'k_scatter', name: 'K:Scatter\nUpdate', pipeline: 'key', unit: 'scatter', core: 'AIV 24', x: 1410, y: 430, w: 120, h: 52, start: 0.664, duration: 0.060, memR: 0, memW: 8192, desc: 'Scatter update into key cache and scale storage.' },
    { id: 'w_linear', name: 'W:Linear\nMatMul', pipeline: 'weight', unit: 'cube', core: 'AIC 17-20', x: 390, y: 600, w: 130, h: 62, start: 0.030, duration: 0.230, memR: 2048, memW: 512, desc: 'Weight-side projection matmul; independent but concurrent.' },
    { id: 'w_scale', name: 'W:Scale\n1 over sqrt(h*d)', pipeline: 'weight', unit: 'vector', core: 'AIV 26-27', x: 570, y: 600, w: 120, h: 62, start: 0.263, duration: 0.045, memR: 0, memW: 0, desc: 'Apply scaling factor before final assembly.' },
    { id: 'w_assemble', name: 'W:Assemble\nOutput', pipeline: 'weight', unit: 'memory', core: 'AIV 28', x: 740, y: 600, w: 120, h: 52, start: 0.310, duration: 0.025, memR: 0, memW: 2048, desc: 'Write weight-side result bundle to output.' },
  ];

  const EDGES = [
    { from: 'reshape', to: 'q_view' },
    { from: 'reshape', to: 'q_cossin' },
    { from: 'reshape', to: 'k_view' },
    { from: 'reshape', to: 'w_linear' },
    { from: 'q_view', to: 'q_linear' },
    { from: 'q_linear', to: 'q_dequant' },
    { from: 'q_dequant', to: 'q_split' },
    { from: 'q_split', to: 'q_rope3d' },
    { from: 'q_cossin', to: 'q_rope3d' },
    { from: 'q_split', to: 'q_nope' },
    { from: 'q_rope3d', to: 'q_concat' },
    { from: 'q_nope', to: 'q_concat' },
    { from: 'q_concat', to: 'q_hadamard' },
    { from: 'q_hadamard', to: 'q_quant' },
    { from: 'q_quant', to: 'q_assemble' },
    { from: 'k_view', to: 'k_linear' },
    { from: 'k_linear', to: 'k_layernorm' },
    { from: 'k_layernorm', to: 'k_split' },
    { from: 'k_split', to: 'k_rope2d' },
    { from: 'q_cossin', to: 'k_rope2d' },
    { from: 'k_split', to: 'k_nope' },
    { from: 'k_rope2d', to: 'k_concat' },
    { from: 'k_nope', to: 'k_concat' },
    { from: 'k_concat', to: 'k_hadamard' },
    { from: 'k_hadamard', to: 'k_quant' },
    { from: 'k_quant', to: 'k_scatter' },
    { from: 'k_view', to: 'w_linear' },
    { from: 'w_linear', to: 'w_scale' },
    { from: 'w_scale', to: 'w_assemble' },
  ];

  const NODE_MAP = new Map(NODES.map(node => [node.id, node]));
  const CANVAS_WIDTH = 1600;
  const CANVAS_HEIGHT = 760;
  const TOTAL_TIME = NODES.reduce((max, node) => Math.max(max, node.start + node.duration), 0);
  const MAX_DURATION = NODES.reduce((max, node) => Math.max(max, node.duration), 0);
  const MAX_MEMORY = NODES.reduce((max, node) => Math.max(max, node.memR + node.memW), 0);
  const PIPELINE_COUNTS = NODES.reduce((acc, node) => {
    acc[node.pipeline] = (acc[node.pipeline] || 0) + 1;
    return acc;
  }, {});

  const state = {
    selectedId: null,
    detailOpen: false,
    filter: 'all',
    zoom: 1,
    playhead: 0,
    isPlaying: false,
    rafId: 0,
    startedAt: 0,
  };

  const refs = {
    headerStats: document.getElementById('eoHeaderStats'),
    summary: document.getElementById('eoSummary'),
    signalList: document.getElementById('eoSignalList'),
    nodeDetail: document.getElementById('eoNodeDetail'),
    detailPanel: document.getElementById('eoDetailPanel'),
    detailBadge: document.getElementById('eoDetailBadge'),
    detailName: document.getElementById('eoDetailName'),
    detailClose: document.getElementById('eoDetailClose'),
    regions: document.getElementById('eoRegions'),
    edges: document.getElementById('eoEdges'),
    nodes: document.getElementById('eoNodes'),
    canvas: document.getElementById('eoCanvas'),
    canvasWrap: document.getElementById('eoCanvasWrap'),
    filterBar: document.getElementById('eoFilterBar'),
    playBtn: document.getElementById('eoPlayBtn'),
    resetBtn: document.getElementById('eoResetBtn'),
    progress: document.getElementById('eoProgress'),
    progressFill: document.getElementById('eoProgressFill'),
    progressLabel: document.getElementById('eoProgressLabel'),
    zoomLabel: document.getElementById('eoZoomLabel'),
    zoomInBtn: document.getElementById('eoZoomInBtn'),
    zoomOutBtn: document.getElementById('eoZoomOutBtn'),
    fitBtn: document.getElementById('eoFitBtn'),
  };

  function applyPipelineVars() {
    const rootStyle = document.documentElement.style;
    Object.entries(PIPELINES).forEach(([key, theme]) => {
      rootStyle.setProperty(`--eo-${key}`, theme.accent);
      rootStyle.setProperty(`--eo-${key}-rgb`, theme.rgbCss);
      rootStyle.setProperty(`--eo-${key}-bg`, theme.bg);
    });
    rootStyle.setProperty('--eo-play-gradient', `linear-gradient(90deg, ${PIPELINES.query.accent}, ${PIPELINES.key.accent}, ${PIPELINES.weight.accent})`);
  }

  function formatName(name) {
    return String(name || '').replace(/\n/g, ' / ');
  }

  function formatMs(value) {
    return `${Number(value).toFixed(3)} ms`;
  }

  function heatColor(node) {
    const fraction = Math.max(0, Math.min(1, node.duration / MAX_DURATION));
    const r = Math.round(30 + fraction * 210);
    const g = Math.round(190 - fraction * 125);
    const b = Math.round(220 - fraction * 180);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function durationBand(node) {
    const ratio = node.duration / MAX_DURATION;
    if (ratio >= 0.8) return 'hot';
    if (ratio >= 0.4) return 'warm';
    return 'short';
  }

  function memoryBand(node) {
    const value = node.memR + node.memW;
    if (!value) return 'light';
    if (value >= MAX_MEMORY * 0.55) return 'heavy';
    if (value >= MAX_MEMORY * 0.2) return 'medium';
    return 'light';
  }

  function getNodeProgress(node) {
    const start = node.start;
    const end = node.start + node.duration;
    if (state.playhead <= start) return 0;
    if (state.playhead >= end) return 1;
    return (state.playhead - start) / node.duration;
  }

  function isNodeVisible(node) {
    return state.filter === 'all' || node.pipeline === 'shared' || node.pipeline === state.filter;
  }

  function buildRelatedSet(activeId) {
    if (!activeId) return new Set();
    const related = new Set([activeId]);
    let changed = true;
    while (changed) {
      changed = false;
      EDGES.forEach(edge => {
        if (related.has(edge.to) && !related.has(edge.from)) {
          related.add(edge.from);
          changed = true;
        }
        if (related.has(edge.from) && !related.has(edge.to)) {
          related.add(edge.to);
          changed = true;
        }
      });
    }
    return related;
  }

  function nodeStatusClass(node) {
    const progress = getNodeProgress(node);
    if (progress >= 1) return 'done';
    if (progress > 0) return 'running';
    return '';
  }

  function syncDetailPanel() {
    refs.detailPanel.classList.toggle('open', state.detailOpen);
    refs.detailPanel.setAttribute('aria-hidden', state.detailOpen ? 'false' : 'true');
  }

  function openDetailPanel() {
    state.detailOpen = true;
    syncDetailPanel();
  }

  function closeDetailPanel() {
    state.detailOpen = false;
    syncDetailPanel();
  }

  function setSelected(nodeId, openDetail = false) {
    state.selectedId = nodeId;
    renderGraph();
    renderNodeDetail();
    if (openDetail) openDetailPanel();
  }

  function renderHeaderStats() {
    const chips = [
      `${NODES.length} nodes`,
      `${EDGES.length} edges`,
      'single-file React prototype',
      `${Object.keys(PIPELINE_COUNTS).length - 1} pipelines + shared ingress`,
    ];
    refs.headerStats.innerHTML = chips.map(label => `<span class="stat-chip">${label}</span>`).join('');
  }

  function renderSummary() {
    const items = [
      '来源: pto/claude.txt',
      '形态: React 18 UMD + Babel standalone',
      '范围: 单算子 IndexerPrologQuant 原型',
      '表达目标: 拓扑、执行、诊断放到同一张图里',
      '热点判断: Query pipeline 最重',
      '更像研究型 viewer，而不是生产态数据面板',
    ];
    refs.summary.innerHTML = items.map(label => `<span class="stat-chip">${label}</span>`).join('');
  }

  function renderSignals() {
    refs.signalList.innerHTML = SIGNALS.map(item => `<li>${item}</li>`).join('');
  }

  function renderRegions() {
    refs.regions.innerHTML = REGIONS.map(region => (
      `<div class="eo-region ${region.pipeline}" style="left:${region.x}px;top:${region.y}px;width:${region.w}px;height:${region.h}px;"></div>`
    )).join('');
  }

  function edgePath(from, to) {
    const x1 = from.x + from.w;
    const y1 = from.y + (from.h / 2);
    const x2 = to.x;
    const y2 = to.y + (to.h / 2);
    const dx = Math.max(38, (x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  function renderEdges() {
    const related = buildRelatedSet(state.selectedId);
    refs.edges.setAttribute('viewBox', `0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`);
    refs.edges.innerHTML = refs.edges.querySelector('defs').outerHTML + EDGES.map(edge => {
      const from = NODE_MAP.get(edge.from);
      const to = NODE_MAP.get(edge.to);
      const visible = isNodeVisible(from) && isNodeVisible(to);
      const active = related.size && related.has(edge.from) && related.has(edge.to);
      const classes = ['eo-edge'];
      if (from.pipeline !== to.pipeline) classes.push('cross');
      if (!visible) classes.push('dimmed');
      if (active) classes.push('active');
      return `<path class="${classes.join(' ')}" d="${edgePath(from, to)}"></path>`;
    }).join('');
  }

  function renderNodes() {
    const related = buildRelatedSet(state.selectedId);
    refs.nodes.innerHTML = NODES.map(node => {
      const selected = state.selectedId === node.id;
      const visible = isNodeVisible(node);
      const connected = !related.size || related.has(node.id);
      const classes = ['eo-node', node.pipeline, nodeStatusClass(node)];
      if (selected) classes.push('selected');
      if (!visible || !connected) classes.push('dimmed');
      const progress = Math.max(0.06, getNodeProgress(node)) * 100;
      const memoryText = memoryBand(node);
      return `
        <button
          class="${classes.join(' ')}"
          type="button"
          data-node-id="${node.id}"
          style="left:${node.x}px;top:${node.y}px;width:${node.w}px;height:${node.h}px;"
        >
          <div class="eo-node-title">${formatName(node.name)}</div>
          <div class="eo-node-meta">
            <span class="eo-node-tag">${PIPELINES[node.pipeline].label}</span>
            <span class="eo-node-tag">${node.unit}</span>
          </div>
          <div class="eo-node-meta">
            <span class="eo-node-core">${node.core}</span>
          </div>
          <div class="eo-node-foot">
            <div class="eo-node-progress" style="width:${progress}%;background:linear-gradient(90deg, ${PIPELINES[node.pipeline].accent}, ${heatColor(node)});"></div>
            <div class="eo-node-info">
              <span>${durationBand(node)}</span>
              <span>${memoryText}</span>
            </div>
          </div>
        </button>
      `;
    }).join('');

    refs.nodes.querySelectorAll('[data-node-id]').forEach(button => {
      button.addEventListener('click', () => setSelected(button.dataset.nodeId, true));
    });
  }

  function buildConnButtons(ids) {
    if (!ids.length) return '<span class="eo-detail-value">None</span>';
    return `<div class="eo-conn-list">${ids.map(id => (
      `<button class="eo-conn-btn" type="button" data-jump-node="${id}">${formatName(NODE_MAP.get(id).name)}</button>`
    )).join('')}</div>`;
  }

  function renderNodeDetail() {
    const node = state.selectedId ? NODE_MAP.get(state.selectedId) : null;
    if (!node) {
      refs.detailBadge.textContent = 'NODE';
      refs.detailBadge.style.background = 'rgba(255,255,255,0.08)';
      refs.detailBadge.style.color = 'rgba(255,255,255,0.72)';
      refs.detailName.textContent = '点击节点查看详情';
      refs.nodeDetail.innerHTML = '<div class="eo-copy"><p>当前还没有选中节点。点击画布中的节点后，这里会显示该节点的执行、依赖和读写信息。</p></div>';
      return;
    }

    const upstream = EDGES.filter(edge => edge.to === node.id).map(edge => edge.from);
    const downstream = EDGES.filter(edge => edge.from === node.id).map(edge => edge.to);
    const theme = PIPELINES[node.pipeline];
    refs.detailBadge.textContent = theme.label.toUpperCase();
    refs.detailBadge.style.background = `${theme.bg}`;
    refs.detailBadge.style.color = theme.accent;
    refs.detailName.textContent = formatName(node.name);

    const detailHtml = `
      <div class="eo-copy">
        <p>${node.desc}</p>
      </div>
      <div class="eo-detail-grid">
        <div class="eo-detail-key">节点</div>
        <div class="eo-detail-value">${formatName(node.name)}</div>
        <div class="eo-detail-key">Pipeline</div>
        <div class="eo-detail-value">${PIPELINES[node.pipeline].label}</div>
        <div class="eo-detail-key">执行单元</div>
        <div class="eo-detail-value">${node.unit} · ${node.core}</div>
        <div class="eo-detail-key">时间窗</div>
        <div class="eo-detail-value">${formatMs(node.start)} → ${formatMs(node.start + node.duration)}</div>
        <div class="eo-detail-key">时长级别</div>
        <div class="eo-detail-value">${durationBand(node)}</div>
        <div class="eo-detail-key">读写强度</div>
        <div class="eo-detail-value">${memoryBand(node)} (R ${node.memR}, W ${node.memW})</div>
      </div>
      <div class="detail-section-title">上游依赖</div>
      ${buildConnButtons(upstream)}
      <div class="detail-section-title">下游去向</div>
      ${buildConnButtons(downstream)}
    `;
    refs.nodeDetail.innerHTML = detailHtml;
    refs.nodeDetail.querySelectorAll('[data-jump-node]').forEach(button => {
      button.addEventListener('click', () => setSelected(button.dataset.jumpNode, true));
    });
  }

  function updateProgressUi() {
    const ratio = TOTAL_TIME ? state.playhead / TOTAL_TIME : 0;
    refs.progressFill.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
    refs.progressLabel.textContent = `${state.playhead.toFixed(3)} / ${TOTAL_TIME.toFixed(3)} ms`;
    refs.playBtn.textContent = state.isPlaying ? '暂停' : '播放';
  }

  function applyZoom() {
    refs.canvas.style.transform = `scale(${state.zoom})`;
    refs.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function renderGraph() {
    renderEdges();
    renderNodes();
    updateProgressUi();
    applyZoom();
  }

  function stopPlayback() {
    state.isPlaying = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    updateProgressUi();
  }

  function tick(timestamp) {
    const elapsed = (timestamp - state.startedAt) / 1100;
    if (elapsed >= TOTAL_TIME) {
      state.playhead = TOTAL_TIME;
      stopPlayback();
      renderGraph();
      return;
    }
    state.playhead = elapsed;
    renderGraph();
    state.rafId = requestAnimationFrame(tick);
  }

  function togglePlayback() {
    if (state.isPlaying) {
      stopPlayback();
      return;
    }
    state.isPlaying = true;
    state.startedAt = performance.now() - (state.playhead * 1100);
    state.rafId = requestAnimationFrame(tick);
    updateProgressUi();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function fitCanvas() {
    const widthScale = (refs.canvasWrap.clientWidth - 40) / CANVAS_WIDTH;
    const heightScale = (refs.canvasWrap.clientHeight - 40) / CANVAS_HEIGHT;
    state.zoom = clamp(Math.min(widthScale, heightScale, 1), 0.48, 1.25);
    applyZoom();
  }

  function setPlayheadFromClientX(clientX) {
    const rect = refs.progress.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    state.playhead = TOTAL_TIME * ratio;
    renderGraph();
  }

  function bindEvents() {
    refs.filterBar.querySelectorAll('[data-filter]').forEach(button => {
      button.addEventListener('click', () => {
        state.filter = button.dataset.filter;
        refs.filterBar.querySelectorAll('[data-filter]').forEach(item => {
          item.classList.toggle('active', item === button);
        });
        renderGraph();
      });
    });

    refs.playBtn.addEventListener('click', togglePlayback);
    refs.resetBtn.addEventListener('click', () => {
      stopPlayback();
      state.playhead = 0;
      renderGraph();
    });

    refs.progress.addEventListener('click', event => setPlayheadFromClientX(event.clientX));
    refs.progress.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        state.playhead = clamp(state.playhead - 0.03, 0, TOTAL_TIME);
        renderGraph();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        state.playhead = clamp(state.playhead + 0.03, 0, TOTAL_TIME);
        renderGraph();
      }
    });

    refs.zoomInBtn.addEventListener('click', () => {
      state.zoom = clamp(state.zoom + 0.1, 0.45, 1.6);
      applyZoom();
    });

    refs.zoomOutBtn.addEventListener('click', () => {
      state.zoom = clamp(state.zoom - 0.1, 0.45, 1.6);
      applyZoom();
    });

    refs.detailClose.addEventListener('click', closeDetailPanel);

    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.detailOpen) {
        closeDetailPanel();
      }
    });

    refs.fitBtn.addEventListener('click', fitCanvas);
    window.addEventListener('resize', () => {
      if (state.zoom <= 1) fitCanvas();
    });
  }

  function init() {
    applyPipelineVars();
    renderHeaderStats();
    renderSummary();
    renderSignals();
    renderRegions();
    bindEvents();
    fitCanvas();
    renderNodeDetail();
    syncDetailPanel();
    renderGraph();
  }

  init();
})();

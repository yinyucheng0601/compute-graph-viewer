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
  const recentRow     = document.getElementById('recentRow');
  const recentChip    = document.getElementById('recentChip');
  const recentName    = document.getElementById('recentName');
  const graphPicker   = document.getElementById('graphPicker');
  const graphMenu     = document.getElementById('graphMenu');
  const graphMenuLocal = document.getElementById('graphMenuLocal');

  // ── State ──────────────────────────────────────────────────────
  let graph  = null;
  let layout = null;
  let tx = 0, ty = 0, scale = 1;
  let panning = false, panStart = { x: 0, y: 0 };
  let selectedNodeId = null;
  let colorMode = 'none';  // 'none' | 'semantic' | 'subgraph' | 'latency'
  let colorMap  = null;    // Map<nodeId, hexColor> | null

  const SCALE_MIN = 0.06;
  const SCALE_MAX = 4;

  // ── Color mapping ──────────────────────────────────────────────

  const BOUNDARY_COLORS = { incast: '#87c80f', outcast: '#c9107d' };

  function buildNodeColorMap(mode) {
    if (!graph || mode === 'none') return null;

    let nodeIdMap = new Map();

    if (mode === 'semantic') {
      const keys = graph.nodes.map(n => getSemanticKey(n));
      const keyColorMap = buildColorMap(keys);
      graph.nodes.forEach(n => {
        const color = n.type === 'tensor' ? '#606060' : keyColorMap.get(getSemanticKey(n));
        nodeIdMap.set(n.id, color);
      });
    } else if (mode === 'subgraph') {
      const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
      const tensorToSg = new Map();
      graph.edges.forEach(e => {
        const srcNode = nodeMap.get(e.source);
        if (srcNode?.type === 'op' && srcNode.data.subgraphId != null) {
          tensorToSg.set(e.target, srcNode.data.subgraphId);
        }
      });
      const keys = new Set();
      graph.nodes.forEach(n => {
        if (n.type === 'op') keys.add('sg_' + n.data.subgraphId);
        else if (n.type === 'incast' || n.type === 'outcast') keys.add('boundary');
        else { const sgId = tensorToSg.get(n.id); keys.add(sgId != null ? 'sg_' + sgId : 'sg_input'); }
      });
      const keyColorMap = buildColorMap([...keys]);
      graph.nodes.forEach(n => {
        let key;
        if (n.type === 'op') key = 'sg_' + n.data.subgraphId;
        else if (n.type === 'incast' || n.type === 'outcast') key = 'boundary';
        else { const sgId = tensorToSg.get(n.id); key = sgId != null ? 'sg_' + sgId : 'sg_input'; }
        nodeIdMap.set(n.id, keyColorMap.get(key));
      });
    } else if (mode === 'latency') {
      graph.nodes.forEach(n => {
        let color = null;
        if (n.type === 'op') color = latencyToColor(n.data.latency);
        else if (n.type === 'tensor') color = '#606060';
        nodeIdMap.set(n.id, color);
      });
    }

    // Always pin boundary node colors regardless of mode
    graph.nodes.forEach(n => {
      if (BOUNDARY_COLORS[n.type]) nodeIdMap.set(n.id, BOUNDARY_COLORS[n.type]);
    });

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
  };

  function legendLabel(key) {
    if (LEGEND_LABELS[key]) return LEGEND_LABELS[key];
    if (key.startsWith('sem:'))  return key.slice(4).replace(/-/g, ' ');
    if (key.startsWith('cat:'))  return key.slice(4);
    if (key.startsWith('op:'))   return key.slice(3);
    if (key.startsWith('sg_'))   return 'SG · ' + key.slice(3);
    return key;
  }

  function setColorMode(mode) {
    colorMode = mode;
    document.querySelectorAll('.cp-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    if (!graph) return;
    colorMap = buildNodeColorMap(mode);
    renderGraph(graph, layout, nodesLayer, edgesSvg, handleNodeClick, colorMap, colorMode);
    updateLegend();
    drawMinimap();
  }

  function updateLegend() {
    const legendEl = document.getElementById('legend');
    if (!legendEl) return;

    if (colorMode === 'none') {
      legendEl.innerHTML = `
        <span class="legend-item"><span class="legend-dot" style="background:var(--incast-accent)"></span>Incast</span>
        <span class="legend-item"><span class="legend-dot" style="background:var(--op-accent)"></span>Op</span>
        <span class="legend-item"><span class="legend-dot" style="background:var(--tensor-accent)"></span>Tensor</span>
        <span class="legend-item"><span class="legend-dot" style="background:var(--outcast-accent)"></span>Outcast</span>`;
      return;
    }

    if (colorMode === 'latency') {
      const latencies = graph
        ? graph.nodes.filter(n => n.type === 'op' && n.data.latency != null && n.data.latency > 0).map(n => n.data.latency)
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
      if (colorMode === 'semantic') {
        key = getSemanticKey(n);
        if (key === 'tensor' || key === 'boundary:incast' || key === 'boundary:outcast') return;
      } else {
        // subgraph: only show op/boundary in legend
        if (n.type === 'op') key = 'sg_' + n.data.subgraphId;
        else if (n.type === 'incast' || n.type === 'outcast') key = 'boundary';
        else return;
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
    if (!graph) return;
    const hasPartition = graph.nodes.some(n => n.type === 'op' && n.data.subgraphId != null && n.data.subgraphId >= 0);
    const hasCost = graph.nodes.some(n => n.type === 'op' && n.data.latency != null);
    setModeEnabled('subgraph', hasPartition);
    setModeEnabled('latency', hasCost);
  }

  function setModeEnabled(mode, enabled) {
    document.querySelectorAll(`.cp-btn[data-mode="${mode}"]`).forEach(btn => {
      btn.disabled = !enabled;
      btn.classList.toggle('disabled', !enabled);
    });
    if (!enabled && colorMode === mode) setColorMode('none');
  }

  // ── File loading ───────────────────────────────────────────────

  const LS_JSON = 'pto_last_json';
  const LS_NAME = 'pto_last_name';

  function loadGraphData(data, fileName) {
    graph  = parseGraph(data);
    layout = computeLayout(graph);
    colorMap = buildNodeColorMap(colorMode);
    updateModeAvailability();
    renderGraph(graph, layout, nodesLayer, edgesSvg, handleNodeClick, colorMap, colorMode);
    graphTitle.textContent = graph.meta.name;
    graphStats.innerHTML = `
      <span class="stat-chip">${graph.meta.incastCount} incast</span>
      <span class="stat-chip">${graph.meta.opCount} ops</span>
      <span class="stat-chip">${graph.meta.tensorCount} tensors</span>
      <span class="stat-chip">${graph.meta.outcastCount} outcast</span>`;
    emptyState.classList.add('hidden');
    minimapEl.classList.add('visible');
    colorPanel.classList.add('visible');
    updateLegend();
    fitView();

    // Cache to localStorage
    try {
      const name = fileName || graph.meta.name || 'graph.json';
      localStorage.setItem(LS_JSON, JSON.stringify(data));
      localStorage.setItem(LS_NAME, name);
      setRecentChip(name);
    } catch (_) {}
  }

  function setRecentChip(name) {
    if (!name) { recentRow.classList.add('hidden'); return; }
    recentName.textContent = name;
    recentRow.classList.remove('hidden');
  }

  function loadJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { loadGraphData(JSON.parse(e.target.result), file.name); }
      catch (err) { console.error(err); alert('Failed to parse JSON:\n' + err.message); }
    };
    reader.readAsText(file);
  }

  // Wire sample chips (empty-state cards)
  document.querySelectorAll('.sample-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.dataset.sample;
      const label = chip.dataset.label;
      fetch(url)
        .then(r => r.json())
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
      fetch(url)
        .then(r => r.json())
        .then(data => loadGraphData(data, label))
        .catch(() => alert('Failed to load sample.\nTry serving the app via a local server (e.g. npx serve .)'));
    });
  });

  // Menu local file item
  graphMenuLocal.addEventListener('click', () => {
    graphMenu.classList.remove('open');
    fileInput.click();
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

  // Auto-load from ?file= URL param, otherwise fall back to default sample
  const urlFile = new URLSearchParams(location.search).get('file');
  if (urlFile) {
    fetch(urlFile)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(data => loadGraphData(data, urlFile.split('/').pop()))
      .catch(err => { emptyState.classList.remove('hidden'); console.error('Failed to load', urlFile, err); });
  } else {
    fetch('deepseek_out_pass/After_000_RemoveRedundantReshape_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json')
      .then(r => r.json())
      .then(data => loadGraphData(data, 'LOOP_RESHAPE · PATH0'))
      .catch(() => {});
  }

  emptyLoadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadJSON(e.target.files[0]);
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
    drawMinimap();
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
    if (e.key === 'Escape') { closeDetail(); selectNode(null, nodesLayer, edgesSvg); selectedNodeId = null; }
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) fitView();
    if ((e.key === '+' || e.key === '=') && !e.metaKey) zoomAround(viewport.clientWidth/2, viewport.clientHeight/2, 1.2);
    if (e.key === '-' && !e.metaKey) zoomAround(viewport.clientWidth/2, viewport.clientHeight/2, 1/1.2);
  });

  viewport.addEventListener('click', (e) => {
    if (!e.target.closest('.node-card') && !e.target.closest('.detail-panel')) {
      closeDetail();
      selectNode(null, nodesLayer, edgesSvg);
      selectedNodeId = null;
    }
  });

  // ── Node selection ─────────────────────────────────────────────
  function handleNodeClick(node) {
    selectedNodeId = node.id;
    selectNode(node.id, nodesLayer, edgesSvg);
    openDetail(node);
  }

  // ── Detail panel ───────────────────────────────────────────────
  const TYPE_STYLES = {
    incast:  { bg: 'var(--incast-accent-dim)',  color: 'var(--incast-accent)' },
    outcast: { bg: 'var(--outcast-accent-dim)', color: 'var(--outcast-accent)' },
    op:      { bg: 'var(--op-accent-dim)',       color: 'var(--op-accent)' },
    tensor:  { bg: 'var(--tensor-accent-dim)',   color: 'var(--tensor-accent)' },
  };

  function openDetail(node) {
    const ts = TYPE_STYLES[node.type] || TYPE_STYLES.tensor;
    detailBadge.textContent = node.type.toUpperCase();
    detailBadge.style.background = ts.bg;
    detailBadge.style.color      = ts.color;
    detailName.textContent = node.label;
    detailBody.innerHTML   = buildDetailContent(node, graph);

    detailBody.querySelectorAll('[data-nav]').forEach(chip => {
      chip.addEventListener('click', () => {
        const target = graph.nodes.find(n => n.id === chip.dataset.nav);
        if (target) navigateToNode(target);
      });
    });
    detailPanel.classList.add('open');
  }

  function closeDetail() { detailPanel.classList.remove('open'); }
  detailClose.addEventListener('click', () => { closeDetail(); selectNode(null, nodesLayer, edgesSvg); selectedNodeId = null; });

  function navigateToNode(node) {
    if (!layout) return;
    const pos = layout.positions.get(node.id);
    if (!pos) return;
    const cx = pos.x + pos.w / 2, cy = pos.y + pos.h / 2;
    tx = viewport.clientWidth  / 2 - cx * scale;
    ty = viewport.clientHeight / 2 - cy * scale;
    applyTransform(true);
    selectedNodeId = node.id;
    selectNode(node.id, nodesLayer, edgesSvg);
    openDetail(node);
  }

  // ── Minimap ────────────────────────────────────────────────────
  function drawMinimap() {
    if (!graph || !layout) return;
    const { positions, canvasW, canvasH } = layout;
    if (!positions.size) return;

    const ctx = minimapCanvas.getContext('2d');
    const mw = minimapCanvas.width, mh = minimapCanvas.height;
    ctx.clearRect(0, 0, mw, mh);

    const gs = Math.min(mw / (canvasW || 1), mh / (canvasH || 1)) * 0.92;
    const ox = (mw - (canvasW || 0) * gs) / 2;
    const oy = (mh - (canvasH || 0) * gs) / 2;

    const TYPE_COLORS = { incast:'#87C80F', outcast:'#C9107D', op:'#3577F6', tensor:'#A855F7' };
    for (const node of graph.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const mapped = colorMap?.get(node.id);
      const baseColor = (mapped != null ? mapped : null) ?? (TYPE_COLORS[node.type] || '#555');
      ctx.fillStyle = baseColor + 'AA';
      ctx.fillRect(
        Math.round(pos.x * gs + ox), Math.round(pos.y * gs + oy),
        Math.max(2, Math.round(pos.w * gs)), Math.max(1, Math.round(pos.h * gs))
      );
    }

    // Viewport rect
    const vLeft  = -tx / scale;
    const vTop   = -ty / scale;
    const vW     = viewport.clientWidth  / scale;
    const vH     = viewport.clientHeight / scale;
    minimapVp.style.left   = Math.round(vLeft * gs + ox) + 'px';
    minimapVp.style.top    = Math.round(vTop  * gs + oy) + 'px';
    minimapVp.style.width  = Math.round(vW * gs) + 'px';
    minimapVp.style.height = Math.round(vH * gs) + 'px';
  }

  // ── Color toggle buttons ───────────────────────────────────────
  document.querySelectorAll('.cp-btn').forEach(btn => {
    btn.addEventListener('click', () => setColorMode(btn.dataset.mode));
  });

})();

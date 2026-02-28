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
  const recentRow     = document.getElementById('recentRow');
  const recentChip    = document.getElementById('recentChip');
  const recentName    = document.getElementById('recentName');

  // ── State ──────────────────────────────────────────────────────
  let graph  = null;
  let layout = null;
  let tx = 0, ty = 0, scale = 1;
  let panning = false, panStart = { x: 0, y: 0 };
  let selectedNodeId = null;

  const SCALE_MIN = 0.06;
  const SCALE_MAX = 4;

  // ── File loading ───────────────────────────────────────────────

  const LS_JSON = 'pto_last_json';
  const LS_NAME = 'pto_last_name';

  function loadGraphData(data, fileName) {
    graph  = parseGraph(data);
    layout = computeLayout(graph);
    renderGraph(graph, layout, nodesLayer, edgesSvg, handleNodeClick);
    graphTitle.textContent = graph.meta.name;
    graphStats.innerHTML = `
      <span class="stat-chip">${graph.meta.incastCount} incast</span>
      <span class="stat-chip">${graph.meta.opCount} ops</span>
      <span class="stat-chip">${graph.meta.tensorCount} tensors</span>
      <span class="stat-chip">${graph.meta.outcastCount} outcast</span>`;
    emptyState.classList.add('hidden');
    minimapEl.classList.add('visible');
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

  // Auto-load: try localStorage cache first, then default file
  (() => {
    try {
      const cached = localStorage.getItem(LS_JSON);
      if (cached) { loadGraphData(JSON.parse(cached), localStorage.getItem(LS_NAME)); return; }
    } catch (_) {}
    fetch('deepseek_out_pass/After_000_RemoveRedundantReshape_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json')
      .then(r => r.json())
      .then(data => loadGraphData(data, 'After_000_RemoveRedundantReshape_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json'))
      .catch(() => {});
  })();

  loadBtn.addEventListener('click', () => fileInput.click());
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

    const TYPE_COLORS = { incast:'#87C80F', outcast:'#F59E0B', op:'#3577F6', tensor:'#A855F7' };
    for (const node of graph.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      ctx.fillStyle = (TYPE_COLORS[node.type] || '#555') + 'AA';
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

})();

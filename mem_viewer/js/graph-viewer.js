import { opByMagic } from './constants.js';
import { SCHEDULE, tensorBorn, tensorDies } from './schedule.js';

/* ============================================================
   Graph Viewer — renders sample-graph.json via pass-ir stack
   Globals required (loaded via <script> before this module):
     parseGraph(data), computeLayout(graph, opts), renderGraph(...)
   ============================================================ */

const graphTransform = document.getElementById('graph-transform');
const graphViewport  = document.getElementById('graph-viewport');
const graphPlaceholder = document.getElementById('svg-placeholder');
const zoomDisplay    = document.getElementById('zoom-display');
const colorLegend = document.getElementById('mv-color-legend');
const INITIAL_SCALE = 0.5;
const DEFAULT_COLOR_MODE = 'semantic';
const SUPPORTED_COLOR_MODES = new Set(['none', 'semantic', 'subgraph', 'latency', 'engineMemory']);

let graphLoaded = false;
let graphData   = null;   // {nodes, edges, meta}
let layoutData  = null;   // {positions, canvasW, canvasH}
let nodesLayer  = null;
let edgesSvg    = null;
let colorMode   = DEFAULT_COLOR_MODE;
let colorMap    = null;
let lastStep    = 0;
let modeEnabled = { none: true, semantic: true, subgraph: true, latency: true, engineMemory: true };

// Pan/zoom state
let panX = 0, panY = 0, scale = 1;
let isDragging = false;
let dragStartX = 0, dragStartY = 0, dragStartPanX = 0, dragStartPanY = 0;

// Smooth-pan animation
let _animRafId = null, _animTarget = null;

function titleCaseToken(token) {
  if (!token) return '';
  return String(token)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function semanticKeyForNode(node) {
  if (!node || node.type !== 'op') return null;
  if (typeof getSemanticKey === 'function') return getSemanticKey(node);
  return node.data?.semanticLabel ? `sem:${node.data.semanticLabel}` : null;
}

function buildFallbackKeyColorMap(keys) {
  const palette = ['#3577F6', '#A855F7', '#7c3aed', '#f97316', '#22c55e', '#eab308', '#ef4444', '#0ea5e9'];
  const map = new Map();
  keys.forEach((key, idx) => map.set(key, palette[idx % palette.length]));
  return map;
}

function buildSemanticNodeColorMap(graph) {
  const opNodeMap = typeof buildPipelineSemanticColorMap === 'function'
    ? buildPipelineSemanticColorMap(graph.nodes)
    : null;
  const fallbackKeys = [...new Set(graph.nodes
    .filter(node => node.type === 'op')
    .map(node => semanticKeyForNode(node))
    .filter(Boolean))];
  const fallbackKeyMap = typeof buildColorMap === 'function'
    ? buildColorMap(fallbackKeys)
    : buildFallbackKeyColorMap(fallbackKeys);

  const map = new Map();
  for (const node of graph.nodes) {
    if (node.type === 'op') {
      const semanticKey = semanticKeyForNode(node);
      map.set(node.id, opNodeMap?.get(node.id) ?? fallbackKeyMap.get(semanticKey) ?? '#666666');
      continue;
    }
    if (node.type === 'incast') { map.set(node.id, '#87C80F'); continue; }
    if (node.type === 'outcast') { map.set(node.id, '#C9107D'); continue; }
    map.set(node.id, '#606060'); // pass-ir semantic: tensors remain neutral gray
  }
  return map;
}

function buildSubgraphNodeColorMap(graph) {
  const subgraphKeys = [...new Set(graph.nodes
    .filter(node => node.type === 'op')
    .map(node => node.data?.subgraphId)
    .filter(id => Number.isFinite(id) && id >= 0)
    .map(id => `sg_${id}`))]
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  const keyMap = typeof buildColorMap === 'function'
    ? buildColorMap(subgraphKeys)
    : buildFallbackKeyColorMap(subgraphKeys);
  const map = new Map();
  for (const node of graph.nodes) {
    if (node.type === 'op') {
      const sg = node.data?.subgraphId;
      const key = Number.isFinite(sg) && sg >= 0 ? `sg_${sg}` : null;
      map.set(node.id, key ? (keyMap.get(key) ?? '#666666') : '#666666');
      continue;
    }
    if (node.type === 'incast') { map.set(node.id, '#87C80F'); continue; }
    if (node.type === 'outcast') { map.set(node.id, '#C9107D'); continue; }
    map.set(node.id, '#606060');
  }
  return map;
}

function buildLatencyModeNodeColorMap(graph) {
  const map = new Map();
  for (const node of graph.nodes) {
    if (node.type === 'op') {
      const lat = node.data?.latency;
      map.set(node.id, typeof latencyToColor === 'function' && lat != null ? latencyToColor(lat) : '#666666');
      continue;
    }
    if (node.type === 'incast') { map.set(node.id, '#87C80F'); continue; }
    if (node.type === 'outcast') { map.set(node.id, '#C9107D'); continue; }
    map.set(node.id, '#606060');
  }
  return map;
}

function buildEngineMemoryModeNodeColorMap(graph) {
  const baseMap = typeof buildEngineMemoryNodeColorMap === 'function'
    ? buildEngineMemoryNodeColorMap(graph.nodes)
    : new Map();
  const map = new Map();
  for (const node of graph.nodes) {
    if (node.type === 'incast') { map.set(node.id, '#87C80F'); continue; }
    if (node.type === 'outcast') { map.set(node.id, '#C9107D'); continue; }
    map.set(node.id, baseMap.get(node.id) ?? '#6B7280');
  }
  return map;
}

function detectModeAvailability(graph) {
  return {
    none: true,
    semantic: true,
    subgraph: graph.nodes.some(node => node.type === 'op' && Number.isFinite(node.data?.subgraphId) && node.data.subgraphId >= 0),
    latency: graph.nodes.some(node => node.type === 'op' && node.data?.latency != null),
    engineMemory: typeof buildEngineMemoryNodeColorMap === 'function' || typeof getEngineMemoryKey === 'function',
  };
}

function modeKeyLabel(mode, key) {
  if (!key) return 'Unknown';
  if (mode === 'semantic') {
    if (key.startsWith('sem:')) return key.slice(4);
    if (key.startsWith('cat:')) return titleCaseToken(key.slice(4));
    if (key.startsWith('op:')) return titleCaseToken(key.slice(3));
    return titleCaseToken(key);
  }
  if (mode === 'subgraph') {
    if (key.startsWith('sg_')) return `SG ${key.slice(3)}`;
    return 'Input';
  }
  if (mode === 'engineMemory') {
    return typeof getEngineMemoryLabel === 'function' ? getEngineMemoryLabel(key) : titleCaseToken(key);
  }
  return titleCaseToken(key);
}

function formatCycles(cy) {
  if (!Number.isFinite(cy)) return '0 cy';
  if (cy >= 1000) return `${(cy / 1000).toFixed(cy >= 10000 ? 0 : 1)}K cy`;
  return `${Math.round(cy)} cy`;
}

function updateColorLegend() {
  if (!colorLegend || !graphData) return;

  if (colorMode === 'none') {
    colorLegend.innerHTML = `
      <div class="mv-cp-legend-item"><span class="mv-cp-dot" style="background:#87C80F"></span><span class="mv-cp-label">Incast</span></div>
      <div class="mv-cp-legend-item"><span class="mv-cp-dot" style="background:#3577F6"></span><span class="mv-cp-label">Op</span></div>
      <div class="mv-cp-legend-item"><span class="mv-cp-dot" style="background:#A855F7"></span><span class="mv-cp-label">Tensor</span></div>
      <div class="mv-cp-legend-item"><span class="mv-cp-dot" style="background:#C9107D"></span><span class="mv-cp-label">Outcast</span></div>`;
    return;
  }

  if (colorMode === 'latency') {
    const latencies = graphData.nodes
      .filter(node => node.type === 'op' && node.data?.latency != null)
      .map(node => Number(node.data.latency))
      .filter(v => Number.isFinite(v) && v > 0);
    const minCy = latencies.length ? Math.min(...latencies) : 0;
    const maxCy = latencies.length ? Math.max(...latencies) : 0;
    colorLegend.innerHTML = `
      <div class="mv-cp-latency-gradient"></div>
      <div class="mv-cp-latency-range"><span>${formatCycles(minCy)}</span><span>${formatCycles(maxCy)}</span></div>`;
    return;
  }

  const keyData = new Map();
  for (const node of graphData.nodes) {
    let key = null;
    if (colorMode === 'semantic') {
      if (node.type !== 'op') continue;
      key = semanticKeyForNode(node);
      if (!key || key === 'tensor' || key === 'boundary:incast' || key === 'boundary:outcast') continue;
    } else if (colorMode === 'subgraph') {
      if (node.type !== 'op') continue;
      const sg = node.data?.subgraphId;
      if (!Number.isFinite(sg) || sg < 0) continue;
      key = `sg_${sg}`;
    } else if (colorMode === 'engineMemory') {
      key = typeof getEngineMemoryKey === 'function' ? getEngineMemoryKey(node) : null;
      if (!key) continue;
    }
    if (!key) continue;
    if (!keyData.has(key)) {
      keyData.set(key, { color: colorMap?.get(node.id) ?? '#666666', count: 0 });
    }
    keyData.get(key).count++;
  }

  const items = [...keyData.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12);
  if (items.length === 0) {
    colorLegend.innerHTML = '<div class="mv-cp-legend-item"><span class="mv-cp-label">No data for this mode</span></div>';
    return;
  }
  colorLegend.innerHTML = items.map(([key, { color, count }]) => `
    <div class="mv-cp-legend-item">
      <span class="mv-cp-dot" style="background:${color}"></span>
      <span class="mv-cp-label">${modeKeyLabel(colorMode, key)}</span>
      <span class="mv-cp-count">(${count})</span>
    </div>`).join('');
}

function syncColorModeButtons() {
  document.querySelectorAll('#mv-color-panel .mv-cp-btn[data-mode]').forEach(btn => {
    const mode = btn.dataset.mode;
    const enabled = !!modeEnabled[mode];
    btn.disabled = !enabled;
    btn.classList.toggle('active', mode === colorMode);
  });
}

function buildColorMapForMode(mode) {
  if (!graphData) return null;
  if (mode === 'none') return null;
  if (mode === 'semantic') return buildSemanticNodeColorMap(graphData);
  if (mode === 'subgraph') return buildSubgraphNodeColorMap(graphData);
  if (mode === 'latency') return buildLatencyModeNodeColorMap(graphData);
  if (mode === 'engineMemory') return buildEngineMemoryModeNodeColorMap(graphData);
  return buildSemanticNodeColorMap(graphData);
}

function renderGraphForCurrentMode() {
  if (!graphData || !layoutData || !nodesLayer || !edgesSvg) return;
  colorMap = buildColorMapForMode(colorMode);
  renderGraph(
    graphData,
    layoutData,
    nodesLayer,
    edgesSvg,
    (_node, _el) => {},
    colorMap,
    colorMode,
    { compact: true, direction: 'LR' }
  );
  applyStepToGraph(lastStep);
  syncColorModeButtons();
  updateColorLegend();
}

function setColorMode(nextMode) {
  const mode = SUPPORTED_COLOR_MODES.has(nextMode) ? nextMode : DEFAULT_COLOR_MODE;
  if (!modeEnabled[mode]) return;
  colorMode = mode;
  if (graphLoaded) renderGraphForCurrentMode();
  else syncColorModeButtons();
}

document.querySelectorAll('#mv-color-panel .mv-cp-btn[data-mode]').forEach(btn => {
  btn.addEventListener('click', () => setColorMode(btn.dataset.mode));
});

/* ============================================================
   Load & Render
   ============================================================ */
async function loadGraph() {
  try {
    const resp = await fetch('./data/sample-graph.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();

    // Use global functions from pass-ir script tags
    graphData  = parseGraph(json);
    layoutData = computeLayout(graphData, { compact: true, direction: 'LR' });

    // Build DOM structure
    const container = document.createElement('div');
    container.style.cssText = 'position:relative;';

    edgesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    edgesSvg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible;';

    nodesLayer = document.createElement('div');
    nodesLayer.style.cssText = 'position:absolute;top:0;left:0;';

    // Inject defs for arrow markers (same as pass-ir)
    edgesSvg.innerHTML = `<defs>
      <marker id="mv-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
        <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,255,255,0.25)"/>
      </marker>
    </defs>`;

    const { canvasW, canvasH } = layoutData;
    container.style.width  = canvasW + 'px';
    container.style.height = canvasH + 'px';
    edgesSvg.setAttribute('width',  canvasW);
    edgesSvg.setAttribute('height', canvasH);
    nodesLayer.style.width  = canvasW + 'px';
    nodesLayer.style.height = canvasH + 'px';

    container.appendChild(edgesSvg);
    container.appendChild(nodesLayer);
    graphTransform.appendChild(container);

    if (graphPlaceholder) graphPlaceholder.style.display = 'none';
    modeEnabled = detectModeAvailability(graphData);
    if (!modeEnabled[colorMode]) {
      colorMode = modeEnabled.semantic ? 'semantic' : 'none';
    }
    graphLoaded = true;
    renderGraphForCurrentMode();
    fitGraph();
    applyInitialScale();
    return true;
  } catch (err) {
    if (graphPlaceholder) {
      graphPlaceholder.className = 'error';
      graphPlaceholder.innerHTML = `
        <div style="font-size:20px;margin-bottom:8px;">⚠</div>
        <div><strong>Failed to load graph</strong></div>
        <div style="font-size:10px;color:var(--text-dim);max-width:280px;text-align:center;margin-top:6px;">
          ${err.message}<br><br>Serve via HTTP:<br>
          <code style="background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:3px;">python3 -m http.server</code>
        </div>`;
    }
    return false;
  }
}

/* ============================================================
   Fit / Zoom / Pan
   ============================================================ */
function fitGraph() {
  if (!layoutData) return;
  const vw = graphViewport.clientWidth;
  const vh = graphViewport.clientHeight;
  const { canvasW, canvasH } = layoutData;
  if (!canvasW || !canvasH) return;

  const s = Math.min(vw / canvasW, vh / canvasH) * 0.92;
  scale = Math.max(0.05, Math.min(3, s));
  panX = (vw - canvasW * scale) / 2;
  panY = (vh - canvasH * scale) / 2;
  _applyTransform();
}

function applyInitialScale() {
  const vw = graphViewport.clientWidth;
  const vh = graphViewport.clientHeight;
  scale = Math.max(0.05, Math.min(3, INITIAL_SCALE));
  const { canvasW, canvasH } = layoutData;
  panX = (vw - canvasW * scale) / 2;
  panY = (vh - canvasH * scale) / 2;
  _applyTransform();
}

function _applyTransform() {
  graphTransform.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
  if (zoomDisplay) zoomDisplay.textContent = Math.round(scale * 100) + '%';
}

// Wheel zoom
graphViewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Wheel zoom muted on purpose: keep zoom controlled by toolbar buttons only.
}, { passive: false });

// Drag pan
graphViewport.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  _cancelAnim();
  isDragging = true;
  dragStartX = e.clientX; dragStartY = e.clientY;
  dragStartPanX = panX; dragStartPanY = panY;
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  panX = dragStartPanX + (e.clientX - dragStartX);
  panY = dragStartPanY + (e.clientY - dragStartY);
  _applyTransform();
});
window.addEventListener('mouseup', () => { isDragging = false; });

// Toolbar buttons
document.getElementById('fit-btn')?.addEventListener('click', fitGraph);
document.getElementById('zoom-in-btn')?.addEventListener('click', () => {
  const vw = graphViewport.clientWidth, vh = graphViewport.clientHeight;
  scale = Math.min(3, scale * 1.25);
  panX = vw/2 - (vw/2 - panX) * 1.25;
  panY = vh/2 - (vh/2 - panY) * 1.25;
  _applyTransform();
});
document.getElementById('zoom-out-btn')?.addEventListener('click', () => {
  const prev = scale;
  scale = Math.max(0.05, scale / 1.25);
  const vw = graphViewport.clientWidth, vh = graphViewport.clientHeight;
  panX = vw/2 - (vw/2 - panX) * (scale/prev);
  panY = vh/2 - (vh/2 - panY) * (scale/prev);
  _applyTransform();
});

/* ============================================================
   Step Highlighting
   ============================================================ */
const OP_STATE_CLASS = {
  done:      'mv-op-done',
  executing: 'mv-op-executing',
  pending:   'mv-op-pending',
};

function applyStepToGraph(step) {
  if (!nodesLayer) return;
  lastStep = step;

  for (let i = 0; i < SCHEDULE.length; i++) {
    const m = SCHEDULE[i];
    const nodeId = `op_${m}`;
    const el = nodesLayer.querySelector(`[data-node-id="${nodeId}"]`);
    if (!el) continue;
    el.classList.remove('mv-op-done', 'mv-op-executing', 'mv-op-pending');
    if (i < step)      el.classList.add('mv-op-done');
    else if (i === step) el.classList.add('mv-op-executing');
    else                 el.classList.add('mv-op-pending');
  }

  // Tensor liveness
  for (const [t, born] of tensorBorn) {
    const dies = tensorDies.get(t) ?? born;
    const tEl = nodesLayer.querySelector(`[data-node-id="t_${t}"]`);
    if (!tEl) continue;
    tEl.classList.remove('mv-tensor-input', 'mv-tensor-output');
    if (born <= step && step <= dies) {
      tEl.classList.remove('mv-tensor-dim');
      tEl.classList.add('mv-tensor-live');
    } else {
      tEl.classList.remove('mv-tensor-live');
      tEl.classList.add('mv-tensor-dim');
    }
  }

  // Highlight active op's tensors
  const execOp = opByMagic.get(SCHEDULE[step]);
  if (execOp) {
    for (const t of execOp.i) {
      const tEl = nodesLayer.querySelector(`[data-node-id="t_${t}"]`);
      if (tEl) { tEl.classList.remove('mv-tensor-dim'); tEl.classList.add('mv-tensor-input'); }
    }
    for (const t of execOp.o) {
      const tEl = nodesLayer.querySelector(`[data-node-id="t_${t}"]`);
      if (tEl) { tEl.classList.remove('mv-tensor-dim'); tEl.classList.add('mv-tensor-output'); }
    }
  }
}

/* ============================================================
   Center on executing op
   ============================================================ */
function _cancelAnim() {
  if (_animRafId) { cancelAnimationFrame(_animRafId); _animRafId = null; }
  _animTarget = null;
}

function _startAnim(tx, ty, ts) {
  _cancelAnim();
  _animTarget = { x: tx, y: ty, s: ts };
  function step() {
    if (!_animTarget) return;
    const dx = _animTarget.x - panX, dy = _animTarget.y - panY, ds = _animTarget.s - scale;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(ds) < 0.001) {
      panX = _animTarget.x; panY = _animTarget.y; scale = _animTarget.s;
      _applyTransform(); _animTarget = null; return;
    }
    panX += dx * 0.18; panY += dy * 0.18; scale += ds * 0.18;
    _applyTransform();
    _animRafId = requestAnimationFrame(step);
  }
  _animRafId = requestAnimationFrame(step);
}

function centerOnExecuting(op, immediate) {
  if (!op || !layoutData) return;
  const ids = [`op_${op.m}`, ...op.i.map(t => `t_${t}`), ...op.o.map(t => `t_${t}`)];
  const { positions } = layoutData;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = 0;
  for (const id of ids) {
    const pos = positions.get(id);
    if (!pos) continue;
    minX = Math.min(minX, pos.x); minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + pos.w); maxY = Math.max(maxY, pos.y + pos.h);
    found++;
  }
  if (!found) return;

  const vpW = graphViewport.clientWidth;
  const vpH = graphViewport.clientHeight;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const tx = vpW/2 - cx*scale, ty = vpH/2 - cy*scale;

  if (immediate) { _cancelAnim(); panX = tx; panY = ty; _applyTransform(); }
  else _startAnim(tx, ty, scale);
}

export function isSvgLoaded() { return graphLoaded; }
export { loadGraph, fitGraph, applyStepToGraph, centerOnExecuting, setColorMode };

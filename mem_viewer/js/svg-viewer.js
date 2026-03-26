import { OP_DATA } from '../data/ops.js';
import { opByMagic } from './constants.js';
import { SCHEDULE, tensorBorn, tensorDies } from './schedule.js';

/* ============================================================
   SVG Loading & Pan/Zoom
   ============================================================ */
const graphTransform = document.getElementById('graph-transform');
const graphViewport = document.getElementById('graph-viewport');
const svgPlaceholder = document.getElementById('svg-placeholder');
const zoomDisplay = document.getElementById('zoom-display');

let svgEl = null;
let svgWidth = 0, svgHeight = 0;
let panX = 0, panY = 0;
let scale = 1;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let dragStartPanX = 0, dragStartPanY = 0;
let svgLoaded = false;

let svgStyleEl = null;

// Smooth-pan animation state
let _animRafId = null;
let _animTarget = null;

async function loadSVG() {
  try {
    const resp = await fetch('./data/graph.svg');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    const text = await resp.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'image/svg+xml');
    svgEl = doc.documentElement;

    svgWidth = parseFloat(svgEl.getAttribute('width')) || 1000;
    svgHeight = parseFloat(svgEl.getAttribute('height')) || 800;

    svgEl.style.background = 'transparent';

    if (!svgStyleEl) {
      svgStyleEl = document.createElement('style');
      svgStyleEl.id = 'svg-dynamic-styles';
      document.head.appendChild(svgStyleEl);
    }

    graphTransform.appendChild(svgEl);
    svgPlaceholder.style.display = 'none';
    svgLoaded = true;

    hideSoleTensorNodes();
    fixTensorTextColors();
    fitGraph();

    // applyStepToSVG will be called by playback after init
    return true;
  } catch (err) {
    svgPlaceholder.className = 'error';
    svgPlaceholder.innerHTML = `
      <div style="font-size:22px;">⚠</div>
      <div><strong>Failed to load SVG</strong></div>
      <div style="font-size:10px;color:rgba(0,0,0,0.4);max-width:300px;text-align:center;">
        ${err.message}<br><br>
        Serve via HTTP to avoid CORS issues:<br>
        <code style="background:rgba(0,0,0,0.08);padding:2px 6px;border-radius:3px;">python3 -m http.server</code>
        <br>or<br>
        <code style="background:rgba(0,0,0,0.08);padding:2px 6px;border-radius:3px;">npx serve .</code>
      </div>
    `;
    return false;
  }
}

/**
 * Force dark fill on all text elements inside tensor/op nodes.
 * CSS variables from DOMParser-parsed SVG may not resolve in the HTML context.
 */
function fixTensorTextColors() {
  if (!svgEl) return;
  svgEl.querySelectorAll(`
    [id^="sprotty_tensor-"] text, [id^="sprotty_tensor-"] tspan,
    [id^="sprotty_operation-"] text, [id^="sprotty_operation-"] tspan,
    [id^="sprotty_input-"] text, [id^="sprotty_output-"] text,
    .sprotty-label
  `).forEach(el => {
    el.setAttribute('fill', '#1a1a1a');
    el.removeAttribute('fill-opacity');
    el.style.setProperty('fill', '#1a1a1a', 'important');
    el.style.setProperty('fill-opacity', '1', 'important');
    el.style.setProperty('font-weight', '600', 'important');
  });
}

/**
 * Hide tensor nodes that are not referenced in any op (unreachable in schedule).
 */
function hideSoleTensorNodes() {
  if (!svgEl) return;
  const referencedTensors = new Set();
  for (const op of OP_DATA) {
    for (const t of op.i) referencedTensors.add(t);
    for (const t of op.o) referencedTensors.add(t);
  }
  const allNodes = svgEl.querySelectorAll('[id^="sprotty_tensor-"]');
  for (const node of allNodes) {
    const match = node.id.match(/sprotty_tensor-(\d+)-0/);
    if (!match) continue;
    const tMagic = parseInt(match[1]);
    if (!referencedTensors.has(tMagic)) {
      node.style.display = 'none';
    }
  }
}

function fitGraph() {
  const vw = graphViewport.clientWidth;
  const vh = graphViewport.clientHeight;
  if (svgWidth <= 0 || svgHeight <= 0) return;

  const scaleX = vw / svgWidth;
  const scaleY = vh / svgHeight;
  scale = Math.min(scaleX, scaleY) * 0.95;
  scale = Math.max(0.05, Math.min(3, scale));

  panX = (vw - svgWidth * scale) / 2;
  panY = (vh - svgHeight * scale) / 2;

  applyTransform();
}

function applyTransform() {
  graphTransform.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  zoomDisplay.textContent = Math.round(scale * 100) + '%';
}

// Wheel zoom
graphViewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = graphViewport.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const delta = e.deltaY > 0 ? 0.85 : 1.15;
  const newScale = Math.max(0.05, Math.min(3, scale * delta));

  panX = mouseX - (mouseX - panX) * (newScale / scale);
  panY = mouseY - (mouseY - panY) * (newScale / scale);
  scale = newScale;

  applyTransform();
}, { passive: false });

// Mouse drag pan
graphViewport.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  _cancelAnim();
  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragStartPanX = panX;
  dragStartPanY = panY;
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  panX = dragStartPanX + (e.clientX - dragStartX);
  panY = dragStartPanY + (e.clientY - dragStartY);
  applyTransform();
});

window.addEventListener('mouseup', () => { isDragging = false; });

// Toolbar buttons
document.getElementById('fit-btn').addEventListener('click', fitGraph);
document.getElementById('zoom-in-btn').addEventListener('click', () => {
  scale = Math.min(3, scale * 1.25);
  const vw = graphViewport.clientWidth;
  const vh = graphViewport.clientHeight;
  panX = vw/2 - (vw/2 - panX) * 1.25;
  panY = vh/2 - (vh/2 - panY) * 1.25;
  applyTransform();
});
document.getElementById('zoom-out-btn').addEventListener('click', () => {
  const prev = scale;
  scale = Math.max(0.05, scale / 1.25);
  const vw = graphViewport.clientWidth;
  const vh = graphViewport.clientHeight;
  panX = vw/2 - (vw/2 - panX) * (scale/prev);
  panY = vh/2 - (vh/2 - panY) * (scale/prev);
  applyTransform();
});

/* ============================================================
   SVG Op Coloring via injected <style>
   ============================================================ */
function opStateCSS(magic, state) {
  const baseSelector = `#sprotty_operation-magic-${magic}-0`;

  if (state === 'done') {
    return `
      ${baseSelector} { opacity: 1 !important; }
      ${baseSelector} rect.sprotty-node {
        fill: rgba(22,163,74,0.12) !important;
        stroke: #16a34a !important;
        stroke-width: 2px !important;
        filter: none !important;
      }
    `;
  } else if (state === 'executing') {
    return `
      ${baseSelector} rect.sprotty-node {
        fill: rgba(245,158,11,0.18) !important;
        stroke: #d97706 !important;
        stroke-width: 3px !important;
        opacity: 1 !important;
        filter: drop-shadow(0 0 8px rgba(217,119,6,0.85)) drop-shadow(0 0 20px rgba(217,119,6,0.45)) !important;
      }
      ${baseSelector} {
        opacity: 1 !important;
        filter: drop-shadow(0 0 10px rgba(217,119,6,0.75)) !important;
        animation: none !important;
      }
    `;
  } else {
    return `
      ${baseSelector} { opacity: 0.40 !important; filter: grayscale(50%) brightness(1.1) !important; }
    `;
  }
}

function applyStepToSVG(step) {
  if (!svgEl || !svgStyleEl) return;

  let css = '';

  for (let i = 0; i < SCHEDULE.length; i++) {
    const m = SCHEDULE[i];
    let state;
    if (i < step) state = 'done';
    else if (i === step) state = 'executing';
    else state = 'pending';
    css += opStateCSS(m, state);
  }

  css += `[id^="sprotty_tensor-"] { opacity: 0.45 !important; }\n`;

  for (const [t, born] of tensorBorn) {
    const dies = tensorDies.get(t) ?? born;
    if (born <= step && step <= dies) {
      css += `#sprotty_tensor-${t}-0 { opacity: 1.0 !important; }\n`;
    }
  }

  css += `
    [id^="sprotty_tensor-"] text, [id^="sprotty_tensor-"] tspan,
    [id^="sprotty_operation-"] text, [id^="sprotty_operation-"] tspan,
    [id^="sprotty_input-"] text, [id^="sprotty_output-"] text {
      fill: #1a1a1a !important;
      fill-opacity: 1 !important;
      font-weight: 600 !important;
    }
  `;

  const execOp = opByMagic.get(SCHEDULE[step]);
  if (execOp) {
    for (const t of execOp.i) {
      css += `
        #sprotty_tensor-${t}-0 { opacity: 1 !important; z-index: 10 !important; }
        #sprotty_tensor-${t}-0 rect.sprotty-node {
          stroke: #3b82f6 !important;
          stroke-width: 3px !important;
          fill: rgba(219,234,254,0.95) !important;
          filter: drop-shadow(0 0 6px rgba(59,130,246,0.6)) !important;
        }
        #sprotty_tensor-${t}-0 text { fill: #1e3a8a !important; font-weight: 700 !important; }
      `;
    }
    for (const t of execOp.o) {
      css += `
        #sprotty_tensor-${t}-0 { opacity: 1 !important; z-index: 10 !important; }
        #sprotty_tensor-${t}-0 rect.sprotty-node {
          stroke: #10b981 !important;
          stroke-width: 3px !important;
          fill: rgba(209,250,229,0.95) !important;
          filter: drop-shadow(0 0 6px rgba(16,185,129,0.6)) !important;
        }
        #sprotty_tensor-${t}-0 text { fill: #064e3b !important; font-weight: 700 !important; }
      `;
    }
  }

  svgStyleEl.textContent = css;
}

/* ============================================================
   Auto-center animation
   ============================================================ */
function _cancelAnim() {
  if (_animRafId) { cancelAnimationFrame(_animRafId); _animRafId = null; }
  _animTarget = null;
}

function _startAnim(tPanX, tPanY, tScale) {
  _cancelAnim();
  _animTarget = { x: tPanX, y: tPanY, s: tScale };
  function step() {
    if (!_animTarget) return;
    const dx = _animTarget.x - panX, dy = _animTarget.y - panY, ds = _animTarget.s - scale;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(ds) < 0.002) {
      panX = _animTarget.x; panY = _animTarget.y; scale = _animTarget.s;
      applyTransform(); _animTarget = null; return;
    }
    const t = 0.18;
    panX += dx * t; panY += dy * t; scale += ds * t;
    applyTransform();
    _animRafId = requestAnimationFrame(step);
  }
  _animRafId = requestAnimationFrame(step);
}

function getSVGRootTranslation(el) {
  let tx = 0, ty = 0;
  let node = el;
  while (node && node !== svgEl) {
    const t = node.getAttribute && node.getAttribute('transform');
    if (t) {
      const m = t.match(/translate\(\s*([^,\s)]+)[,\s]+([^)]+)\)/);
      if (m) { tx += parseFloat(m[1]) || 0; ty += parseFloat(m[2]) || 0; }
    }
    node = node.parentNode;
  }
  return { tx, ty };
}

function getSVGRootBBox(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    const bbox = el.getBBox();
    if (bbox.width === 0 && bbox.height === 0) return null;
    const { tx, ty } = getSVGRootTranslation(el);
    return { x: tx + bbox.x, y: ty + bbox.y, w: bbox.width, h: bbox.height };
  } catch (e) { return null; }
}

/**
 * Center viewport on the executing op and its connected tensors.
 * immediate=true → hard jump | immediate=false → smooth animation
 */
function centerOnExecuting(op, immediate) {
  if (!svgEl || !op) return;

  const ids = [
    `sprotty_operation-magic-${op.m}-0`,
    ...op.i.map(t => `sprotty_tensor-${t}-0`),
    ...op.o.map(t => `sprotty_tensor-${t}-0`),
  ];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = 0;

  for (const id of ids) {
    const b = getSVGRootBBox(id);
    if (!b) continue;
    minX = Math.min(minX, b.x);       minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    found++;
  }
  if (found === 0) return;

  const vpW = graphViewport.clientWidth;
  const vpH = graphViewport.clientHeight;
  if (vpW === 0 || vpH === 0) return;

  const groupW = maxX - minX;
  const groupH = maxY - minY;
  const pad = 0.30;
  const fitScale = Math.min(
    vpW  / (groupW  * (1 + pad * 2)),
    vpH  / (groupH  * (1 + pad * 2)),
    1.6
  );
  const targetScale = Math.max(0.08, Math.min(3, fitScale));

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const targetPanX = vpW / 2 - cx * targetScale;
  const targetPanY = vpH / 2 - cy * targetScale;

  if (immediate) {
    _cancelAnim();
    panX = targetPanX; panY = targetPanY; scale = targetScale;
    applyTransform();
  } else {
    _startAnim(targetPanX, targetPanY, targetScale);
  }
}

export { loadSVG, fitGraph, applyStepToSVG, centerOnExecuting, svgLoaded };

// Re-export svgLoaded as a getter since it's mutated
export function isSvgLoaded() { return svgLoaded; }

/**
 * mte-overlay.js — straight-line MTE arrows in the gaps between hardware cards.
 *
 * Ascend 910B topology:
 *   MTE1  DDR ↔ L1          COPY_IN (→) / COPY_OUT (←)
 *   MTE2  L1  → L0A         L1_TO_L0A
 *   MTE2  L1  → L0B         L1_TO_L0B
 *   MTE3  L0C → UB          cross-section; idle in this trace (topology reference)
 *
 * DDR is rendered as a real DOM card (buf-box buf-ddr) injected into .aic-main-row.
 */

import { opByMagic } from './constants.js';
import { SCHEDULE } from './schedule.js';

/* ── Route definitions ─────────────────────────────────────────────────────── */

const ROUTES = [
  { id: 'mte1',   label: 'MTE1', color: '#3577F6', ops: new Set(['COPY_IN', 'COPY_OUT']) },
  { id: 'mte2-a', label: 'MTE2', color: '#A855F7', ops: new Set(['L1_TO_L0A']) },
  { id: 'mte2-b', label: 'MTE2', color: '#7c3aed', ops: new Set(['L1_TO_L0B']) },
  { id: 'mte3',   label: 'MTE3', color: '#f97316', ops: new Set([]) },
];

const TAG_BG_IDLE    = '#5a3a00';
const TAG_TXT_IDLE   = 'rgba(255,220,120,0.55)';
const TAG_BG_ACTIVE  = '#F59E0B';
const TAG_TXT_ACTIVE = '#ffffff';

/* ── SVG helpers ───────────────────────────────────────────────────────────── */

const NS = 'http://www.w3.org/2000/svg';
function mk(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function arrowMarker(id, color, reverse = false) {
  const m = mk('marker', { id, markerWidth: '7', markerHeight: '7',
    refX: reverse ? '1' : '6', refY: '3.5', orient: 'auto' });
  m.appendChild(mk('path', {
    d: reverse ? 'M7,0 L7,7 L0,3.5 Z' : 'M0,0 L0,7 L7,3.5 Z', fill: color }));
  return m;
}

/* ── State ─────────────────────────────────────────────────────────────────── */

let container = null;
let svg       = null;
let ddrCard   = null;
let layoutDone = false;
const els = {};

/* ── DDR card (DOM) ─────────────────────────────────────────────────────────── */

function buildDdrCard() {
  const card = document.createElement('div');
  card.id        = 'ddr-card';
  card.className = 'buf-box buf-ddr';
  card.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                height:100%;gap:6px;">
      <span class="buf-label">DDR</span>
      <span class="cube-sub">off-chip</span>
    </div>`;
  return card;
}

/* ── Init ──────────────────────────────────────────────────────────────────── */

export function initMteOverlay() {
  container = document.getElementById('arch-diagram');
  if (!container) return;

  // Inject DDR card as first item in .aic-main-row
  const row = container.querySelector('.aic-main-row');
  if (row && !document.getElementById('ddr-card')) {
    ddrCard = buildDdrCard();
    row.insertBefore(ddrCard, row.firstChild);
  }

  // SVG overlay for lines
  container.style.position = 'relative';
  svg = mk('svg', { id: 'mte-overlay-svg' });
  Object.assign(svg.style, {
    position: 'absolute', top: '0', left: '0',
    width: '100%', height: '100%',
    overflow: 'visible', pointerEvents: 'none', zIndex: '50',
  });

  const defs = mk('defs');
  for (const r of ROUTES) {
    defs.appendChild(arrowMarker(`af-${r.id}`, r.color));
    defs.appendChild(arrowMarker(`ar-${r.id}`, r.color, true));
    defs.appendChild(arrowMarker(`af-idle-${r.id}`, 'rgba(160,160,160,0.4)'));
  }
  svg.appendChild(defs);

  for (const r of ROUTES) {
    const g    = mk('g', { id: `mte-g-${r.id}` });
    const line = mk('line', { 'stroke-linecap': 'round' });
    g.appendChild(line);
    const LW = 32, LH = 16;
    const labelBg  = mk('rect', { width: LW, height: LH, rx: '4', ry: '4' });
    const labelTxt = mk('text', {
      'font-size': '9', 'font-weight': '700',
      'font-family': 'ui-monospace,monospace',
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
    });
    labelTxt.textContent = r.label;
    g.appendChild(labelBg);
    g.appendChild(labelTxt);
    svg.appendChild(g);
    els[r.id] = { line, labelBg, labelTxt, LW, LH };
  }

  container.appendChild(svg);

  requestAnimationFrame(() => { updateLayout(); layoutDone = true; });
  new ResizeObserver(() => { updateLayout(); layoutDone = true; }).observe(container);
}

/* ── Layout ─────────────────────────────────────────────────────────────────── */

function edgePt(el, side) {
  const cR = container.getBoundingClientRect();
  const r  = el.getBoundingClientRect();
  const cy = r.top  - cR.top  + r.height / 2;
  const cx = r.left - cR.left + r.width  / 2;
  if (side === 'left')  return { x: r.left  - cR.left, y: cy };
  if (side === 'right') return { x: r.right - cR.left, y: cy };
  return { x: cx, y: cy };
}

function placeRoute(id, x1, y1, x2, y2) {
  const e = els[id];
  if (!e) return;
  e.line.setAttribute('x1', x1); e.line.setAttribute('y1', y1);
  e.line.setAttribute('x2', x2); e.line.setAttribute('y2', y2);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  e.labelBg.setAttribute('x', mx - e.LW / 2);
  e.labelBg.setAttribute('y', my - e.LH / 2);
  e.labelTxt.setAttribute('x', mx);
  e.labelTxt.setAttribute('y', my);
}

function updateLayout() {
  if (!svg || !container) return;
  const cR = container.getBoundingClientRect();
  if (cR.width < 10) return;

  const ddrEl = document.getElementById('ddr-card');
  const l1El  = container.querySelector('.buf-l1');
  const l0aEl = container.querySelector('.buf-l0a');
  const l0bEl = container.querySelector('.buf-l0b');
  const l0cEl = container.querySelector('.buf-l0c');
  const ubEl  = container.querySelector('.buf-ub');

  if (!l1El) return;

  // MTE1: DDR-right → L1-left (at L1 center Y)
  if (ddrEl) {
    const ddrR = edgePt(ddrEl, 'right');
    const l1L  = edgePt(l1El,  'left');
    placeRoute('mte1', ddrR.x, ddrR.y, l1L.x, l1L.y);
  }

  // MTE2-A: L1-right → L0A-left (at L0A center Y)
  if (l0aEl) {
    const y = edgePt(l0aEl, 'left').y;
    placeRoute('mte2-a', edgePt(l1El, 'right').x, y, edgePt(l0aEl, 'left').x, y);
  }

  // MTE2-B: L1-right → L0B-left (at L0B center Y)
  if (l0bEl) {
    const y = edgePt(l0bEl, 'left').y;
    placeRoute('mte2-b', edgePt(l1El, 'right').x, y, edgePt(l0bEl, 'left').x, y);
  }

  // MTE3: L0C-right → UB-left (cross-section, average Y)
  if (l0cEl && ubEl) {
    const y = (edgePt(l0cEl, 'right').y + edgePt(ubEl, 'left').y) / 2;
    placeRoute('mte3', edgePt(l0cEl, 'right').x, y, edgePt(ubEl, 'left').x, y);
  }
}

/* ── Render ─────────────────────────────────────────────────────────────────── */

export function renderMteOverlay(step) {
  if (!svg) return;
  if (!layoutDone) { updateLayout(); layoutDone = true; }

  const op     = opByMagic.get(SCHEDULE[step]);
  const opName = op?.n ?? '';
  const mte1On = opName === 'COPY_IN' || opName === 'COPY_OUT';

  // DDR card highlight
  const ddrEl = document.getElementById('ddr-card');
  if (ddrEl) {
    ddrEl.style.backgroundColor = mte1On ? 'rgba(53,119,246,0.18)' : '';
    ddrEl.style.borderColor     = mte1On ? 'rgba(53,119,246,0.65)' : '';
    ddrEl.style.boxShadow       = mte1On ? '0 0 14px rgba(53,119,246,0.40)' : '';
  }

  for (const r of ROUTES) {
    const e = els[r.id];
    if (!e) continue;

    const isActive  = r.ops.size > 0 && r.ops.has(opName);
    const isReverse = r.id === 'mte1' && opName === 'COPY_OUT';

    if (isActive) {
      e.line.setAttribute('stroke',          r.color);
      e.line.setAttribute('stroke-width',    '2.5');
      e.line.removeAttribute('stroke-dasharray');
      e.line.setAttribute('marker-end',   isReverse ? 'none'             : `url(#af-${r.id})`);
      e.line.setAttribute('marker-start', isReverse ? `url(#ar-${r.id})` : 'none');
      e.line.style.filter = `drop-shadow(0 0 4px ${r.color})`;
      e.labelBg.setAttribute('fill',          TAG_BG_ACTIVE);
      e.labelBg.setAttribute('stroke',        r.color);
      e.labelBg.setAttribute('stroke-width',  '1.5');
      e.labelTxt.setAttribute('fill', TAG_TXT_ACTIVE);
      e.labelBg.style.display = e.labelTxt.style.display = '';
    } else {
      e.line.setAttribute('stroke',          'rgba(160,160,160,0.35)');
      e.line.setAttribute('stroke-width',    '1');
      e.line.setAttribute('stroke-dasharray','5 4');
      e.line.setAttribute('marker-end',   r.ops.size > 0 ? `url(#af-idle-${r.id})` : 'none');
      e.line.setAttribute('marker-start', 'none');
      e.line.style.filter = '';
      if (r.id === 'mte3') {
        e.labelBg.style.display = e.labelTxt.style.display = 'none';
      } else {
        e.labelBg.setAttribute('fill',         TAG_BG_IDLE);
        e.labelBg.setAttribute('stroke',       'rgba(200,140,0,0.30)');
        e.labelBg.setAttribute('stroke-width', '1');
        e.labelTxt.setAttribute('fill', TAG_TXT_IDLE);
        e.labelBg.style.display = e.labelTxt.style.display = '';
      }
    }
  }
}

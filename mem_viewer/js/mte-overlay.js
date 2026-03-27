/**
 * mte-overlay.js — straight-line MTE arrows in the gaps between hardware cards.
 *
 * Ascend 910B topology:
 *   MTE1  DDR ↔ L1          COPY_IN (→) / COPY_OUT (←)
 *   MTE2  L1  → L0A         L1_TO_L0A
 *   MTE2  L1  → L0B         L1_TO_L0B
 *   MTE3  L0C → UB          cross-section; idle in this trace (topology reference)
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

// High-visibility tag: saturated orange-yellow bg + white text
const TAG_BG_IDLE   = '#5a3a00';
const TAG_TXT_IDLE  = 'rgba(255,220,120,0.55)';
const TAG_BG_ACTIVE = '#F59E0B';
const TAG_TXT_ACTIVE = '#ffffff';

/* ── SVG helpers ───────────────────────────────────────────────────────────── */

const NS = 'http://www.w3.org/2000/svg';
function mk(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function arrowMarker(id, color, reverse = false) {
  const m = mk('marker', {
    id, markerWidth: '7', markerHeight: '7',
    refX: reverse ? '1' : '6', refY: '3.5', orient: 'auto',
  });
  m.appendChild(mk('path', {
    d: reverse ? 'M7,0 L7,7 L0,3.5 Z' : 'M0,0 L0,7 L7,3.5 Z',
    fill: color,
  }));
  return m;
}

/* ── State ─────────────────────────────────────────────────────────────────── */

let container = null;
let svg       = null;
let layoutDone = false;
const els = {};  // { [id]: { line, labelBg, labelTxt } }

/* ── Init ──────────────────────────────────────────────────────────────────── */

export function initMteOverlay() {
  container = document.getElementById('arch-diagram');
  if (!container) return;

  container.style.position = 'relative';

  svg = mk('svg', { id: 'mte-overlay-svg' });
  Object.assign(svg.style, {
    position:      'absolute',
    top:           '0', left: '0',
    width:         '100%',
    height:        '100%',
    overflow:      'visible',
    pointerEvents: 'none',
    zIndex:        '50',
  });

  // Arrow markers per route
  const defs = mk('defs');
  for (const r of ROUTES) {
    defs.appendChild(arrowMarker(`af-${r.id}`, r.color));
    defs.appendChild(arrowMarker(`ar-${r.id}`, r.color, true));
    defs.appendChild(arrowMarker(`af-idle-${r.id}`, 'rgba(160,160,160,0.4)'));
  }
  svg.appendChild(defs);

  // DDR badge (MTE1 source)
  const ddrG = mk('g', { id: 'mte-ddr' });
  ddrG.appendChild(mk('rect', { rx: '4', ry: '4' }));
  const ddrT = mk('text', { 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': '9', 'font-family': 'ui-monospace,monospace' });
  ddrT.textContent = 'DDR';
  ddrG.appendChild(ddrT);
  svg.appendChild(ddrG);

  // Line + tag per route
  for (const r of ROUTES) {
    const g = mk('g', { id: `mte-g-${r.id}` });

    const line = mk('line', { 'stroke-linecap': 'round' });
    g.appendChild(line);

    // Tag: bg rect + text centered on line midpoint
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

  // Append LAST so it paints above flex siblings
  container.appendChild(svg);

  // Delay first layout to let the flex grid settle
  requestAnimationFrame(() => {
    updateLayout();
    layoutDone = true;
  });

  new ResizeObserver(() => { updateLayout(); layoutDone = true; }).observe(container);
}

/* ── Layout ────────────────────────────────────────────────────────────────── */

function edgePt(el, side) {
  const cR = container.getBoundingClientRect();
  const r  = el.getBoundingClientRect();
  const cy = r.top  - cR.top  + r.height / 2;
  const cx = r.left - cR.left + r.width  / 2;
  if (side === 'left')   return { x: r.left  - cR.left, y: cy };
  if (side === 'right')  return { x: r.right - cR.left, y: cy };
  if (side === 'top')    return { x: cx, y: r.top    - cR.top };
  if (side === 'bottom') return { x: cx, y: r.bottom - cR.top };
  return { x: cx, y: cy };
}

function placeRoute(id, x1, y1, x2, y2) {
  const e = els[id];
  if (!e) return;
  e.line.setAttribute('x1', x1); e.line.setAttribute('y1', y1);
  e.line.setAttribute('x2', x2); e.line.setAttribute('y2', y2);
  // Tag centered on midpoint
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  e.labelBg.setAttribute('x', mx - e.LW / 2);
  e.labelBg.setAttribute('y', my - e.LH / 2);
  e.labelTxt.setAttribute('x', mx);
  e.labelTxt.setAttribute('y', my);
}

function updateLayout() {
  if (!svg || !container) return;

  const l1El  = container.querySelector('.buf-l1');
  const l0aEl = container.querySelector('.buf-l0a');
  const l0bEl = container.querySelector('.buf-l0b');
  const l0cEl = container.querySelector('.buf-l0c');
  const ubEl  = container.querySelector('.buf-ub');

  if (!l1El) return;

  // Guard: if container has no size yet, abort (ResizeObserver will retry)
  const cR = container.getBoundingClientRect();
  if (cR.width < 10) return;

  // ── DDR badge: horizontally left of L1 ──
  const l1L   = edgePt(l1El, 'left');
  const DW = 36, DH = 18;
  const dx = Math.max(4, l1L.x - 56);
  const dy = l1L.y - DH / 2;

  const ddrG = document.getElementById('mte-ddr');
  if (ddrG) {
    const r = ddrG.querySelector('rect');
    const t = ddrG.querySelector('text');
    r?.setAttribute('x', dx);     r?.setAttribute('y', dy);
    r?.setAttribute('width', DW); r?.setAttribute('height', DH);
    t?.setAttribute('x', dx + DW / 2);
    t?.setAttribute('y', dy + DH / 2);
  }

  // MTE1: DDR-right → L1-left (same Y = L1 center)
  placeRoute('mte1', dx + DW, l1L.y, l1L.x, l1L.y);

  // MTE2-A: L1-right → L0A-left (at L0A center Y — purely horizontal)
  if (l0aEl) {
    const y = edgePt(l0aEl, 'left').y;
    placeRoute('mte2-a', edgePt(l1El, 'right').x, y, edgePt(l0aEl, 'left').x, y);
  }

  // MTE2-B: L1-right → L0B-left (at L0B center Y — purely horizontal)
  if (l0bEl) {
    const y = edgePt(l0bEl, 'left').y;
    placeRoute('mte2-b', edgePt(l1El, 'right').x, y, edgePt(l0bEl, 'left').x, y);
  }

  // MTE3: L0C-right → UB-left (cross-section, at average Y)
  if (l0cEl && ubEl) {
    const fy = edgePt(l0cEl, 'right').y;
    const ty = edgePt(ubEl,  'left').y;
    const y  = (fy + ty) / 2;
    placeRoute('mte3', edgePt(l0cEl, 'right').x, y, edgePt(ubEl, 'left').x, y);
  }
}

/* ── Render ─────────────────────────────────────────────────────────────────── */

export function renderMteOverlay(step) {
  if (!svg) return;
  if (!layoutDone) updateLayout();  // ensure layout on first render

  const op     = opByMagic.get(SCHEDULE[step]);
  const opName = op?.n ?? '';

  // DDR badge state
  const mte1Active = opName === 'COPY_IN' || opName === 'COPY_OUT';
  const ddrG = document.getElementById('mte-ddr');
  if (ddrG) {
    const r = ddrG.querySelector('rect');
    const t = ddrG.querySelector('text');
    r?.setAttribute('fill',         mte1Active ? 'rgba(53,119,246,0.22)' : 'rgba(53,119,246,0.07)');
    r?.setAttribute('stroke',       mte1Active ? '#3577F6' : 'rgba(53,119,246,0.25)');
    r?.setAttribute('stroke-width', '1');
    t?.setAttribute('fill', mte1Active ? 'rgba(150,190,255,0.95)' : 'rgba(130,170,255,0.38)');
    ddrG.style.filter = mte1Active ? 'drop-shadow(0 0 5px rgba(53,119,246,0.6))' : '';
  }

  for (const r of ROUTES) {
    const e = els[r.id];
    if (!e) continue;

    const isActive  = r.ops.size > 0 && r.ops.has(opName);
    const isReverse = r.id === 'mte1' && opName === 'COPY_OUT';

    if (isActive) {
      // Line: solid, colored, glowing
      e.line.setAttribute('stroke',       r.color);
      e.line.setAttribute('stroke-width', '2.5');
      e.line.removeAttribute('stroke-dasharray');
      e.line.setAttribute('marker-end',   isReverse ? 'none'             : `url(#af-${r.id})`);
      e.line.setAttribute('marker-start', isReverse ? `url(#ar-${r.id})` : 'none');
      e.line.style.filter = `drop-shadow(0 0 4px ${r.color})`;

      // Tag: saturated orange-yellow + white text
      e.labelBg.setAttribute('fill',         TAG_BG_ACTIVE);
      e.labelBg.setAttribute('stroke',       r.color);
      e.labelBg.setAttribute('stroke-width', '1.5');
      e.labelTxt.setAttribute('fill', TAG_TXT_ACTIVE);
      e.labelBg.style.display  = '';
      e.labelTxt.style.display = '';
    } else {
      // Line: dashed, dim
      e.line.setAttribute('stroke',          'rgba(160,160,160,0.35)');
      e.line.setAttribute('stroke-width',    '1');
      e.line.setAttribute('stroke-dasharray','5 4');
      e.line.setAttribute('marker-end',      r.ops.size > 0 ? `url(#af-idle-${r.id})` : 'none');
      e.line.setAttribute('marker-start',    'none');
      e.line.style.filter = '';

      // Tag: dark amber bg, dim text — hide for MTE3 (always idle, reduces clutter)
      if (r.id === 'mte3') {
        e.labelBg.style.display  = 'none';
        e.labelTxt.style.display = 'none';
      } else {
        e.labelBg.setAttribute('fill',         TAG_BG_IDLE);
        e.labelBg.setAttribute('stroke',       'rgba(200,140,0,0.30)');
        e.labelBg.setAttribute('stroke-width', '1');
        e.labelTxt.setAttribute('fill', TAG_TXT_IDLE);
        e.labelBg.style.display  = '';
        e.labelTxt.style.display = '';
      }
    }
  }
}

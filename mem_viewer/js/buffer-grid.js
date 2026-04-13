import { TENSOR_META } from '../data/ops.js';
import { BPG_CONFIG, TIER_CAP_BYTES, fmtBytes, opByMagic, MEMORY_TIER_VISUALS } from './constants.js';
import { SCHEDULE, getLiveTensorsAtStep, getActiveTensors } from './schedule.js';

function getTierFill(tier) {
  const visual = MEMORY_TIER_VISUALS[tier] ?? MEMORY_TIER_VISUALS.L0A;
  return visual.chip;
}

/* ============================================================
   Build and render one Buffer's pixel grid
   ============================================================ */
function buildAndRenderBpg(tier, liveMagics, activeMagics, inputSet, outputSet) {
  const cfg = BPG_CONFIG[tier];
  if (!cfg) return;
  const totalCells = cfg.rows * cfg.cols;
  const capBytes = TIER_CAP_BYTES[tier];
  const tierVisual = MEMORY_TIER_VISUALS[tier] ?? MEMORY_TIER_VISUALS.L0A;

  // Allocate cells per tensor in magic order
  const cellMap = new Array(totalCells).fill(null); // null = empty, else { magic, color }
  let cursor = 0;
  let usedBytes = 0;

  for (const magic of liveMagics) {
    const meta = TENSOR_META[magic];
    const bytes = meta?.b ?? cfg.bpc; // fallback: 1 cell
    const nCells = Math.max(1, Math.ceil(bytes / cfg.bpc));
    const color = getTierFill(tier);
    usedBytes += bytes;
    for (let c = 0; c < nCells && cursor < totalCells; c++, cursor++) {
      cellMap[cursor] = { magic, color };
    }
  }

  // Build grid cells HTML
  const gridEl = document.getElementById(`grid-${tier}`);
  if (!gridEl) return;
  gridEl.innerHTML = '';

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'bpg-cell';
    const entry = cellMap[i];
    if (entry) {
      const { magic, color } = entry;
      cell.style.background = color;
      cell.style.opacity = '0.75';
      const isActive = activeMagics.has(magic);
      cell.style.boxShadow = isActive ? `0 0 0 1px ${tierVisual.active} inset, 0 0 12px ${tierVisual.glow}` : '';
      if (isActive) cell.classList.add('bpg-active');
      if (inputSet.has(magic)) {
        cell.classList.add('bpg-read');
        cell.style.borderColor = tier === 'DDR' ? MEMORY_TIER_VISUALS.L1.active : tierVisual.active;
      }
      if (outputSet.has(magic)) {
        cell.classList.add('bpg-write');
        cell.style.borderColor = tier === 'DDR' ? MEMORY_TIER_VISUALS.DDR.active : tierVisual.active;
      }

      // Data attributes for tooltip
      const meta = TENSOR_META[magic] ?? {};
      const addr = '0x' + (i * cfg.bpc).toString(16).padStart(6, '0');
      const rw = inputSet.has(magic) ? 'r' : outputSet.has(magic) ? 'w' : '';
      cell.dataset.tier   = tier;
      cell.dataset.magic  = magic;
      cell.dataset.color  = color;
      cell.dataset.addr   = addr;
      cell.dataset.name   = meta.s || `T${magic}`;
      cell.dataset.dt     = meta.dt || '?';
      cell.dataset.sh     = meta.sh ? JSON.stringify(meta.sh) : '[]';
      cell.dataset.sz     = fmtBytes(meta.b ?? 0);
      cell.dataset.rw     = rw;
      cell.textContent = String(magic);
      cell.setAttribute('aria-label', `Tensor ${magic}`);
    } else {
      cell.classList.add('bpg-empty');
    }
    gridEl.appendChild(cell);
  }

  // Update header stats
  const pct = capBytes > 0 ? Math.round(usedBytes / capBytes * 100) : 0;
  const pctEl = document.getElementById(`pct-${tier}`);
  const usedEl = document.getElementById(`used-${tier}`);
  const freeEl = document.getElementById(`free-${tier}`);
  if (pctEl) { pctEl.textContent = `${pct}%`; }
  if (usedEl) usedEl.textContent = `${fmtBytes(usedBytes)} / ${fmtBytes(capBytes)}`;
  if (freeEl) {
    const freeBytes = Math.max(0, capBytes - usedBytes);
    freeEl.textContent = freeBytes > 0 ? fmtBytes(freeBytes) : '0 B';
  }

  // Update legend (up to 5 tensors)
  const legendEl = document.getElementById(`legend-${tier}`);
  if (legendEl) {
    legendEl.innerHTML = '';
    const shown = liveMagics.slice(0, 5);
    for (const magic of shown) {
      const meta = TENSOR_META[magic] ?? {};
      const name = meta.s || `T${magic}`;
      const item = document.createElement('div');
      item.className = 'bpg-legend-item';
      item.innerHTML = `<div class="bpg-legend-dot" style="background:${getTierFill(tier)}"></div>`
                     + `<span class="bpg-legend-label">Tensor:</span>`
                     + `<span class="bpg-legend-value">${name}</span>`;
      legendEl.appendChild(item);
    }
    if (liveMagics.length > 5) {
      const more = document.createElement('div');
      more.className = 'bpg-legend-item';
      more.innerHTML = `<span class="bpg-legend-label">More:</span><span class="bpg-legend-value">+${liveMagics.length - 5}</span>`;
      legendEl.appendChild(more);
    }
  }
}

/* ============================================================
   Render all buffer grids for a given step
   ============================================================ */
export function renderBufferGrids(step) {
  const liveByTier = getLiveTensorsAtStep(step);
  const activeMagics = getActiveTensors(step);

  const op = opByMagic.get(SCHEDULE[step]);
  const inputSet  = new Set(op?.i ?? []);
  const outputSet = new Set(op?.o ?? []);

  for (const tier of ['L1', 'L0A', 'L0B', 'L0C', 'UB']) {
    buildAndRenderBpg(tier, liveByTier[tier] ?? [], activeMagics, inputSet, outputSet);
  }
}

/* ============================================================
   Floating Tensor Tooltip
   ============================================================ */
export function initBpgTooltip() {
  const tip = document.createElement('div');
  tip.id = 'bpg-float-tip';
  document.body.appendChild(tip);

  let currentTarget = null;

  document.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.bpg-cell');
    if (!cell || !cell.dataset.magic) {
      tip.classList.remove('visible');
      currentTarget = null;
      return;
    }
    currentTarget = cell;
    const { tier, name, dt, sh, sz, addr, rw, color } = cell.dataset;

    const rwClass = rw === 'r' ? 'rw-r' : rw === 'w' ? 'rw-w' : '';
    const rwText  = rw === 'r' ? 'read' : rw === 'w' ? 'write' : '—';

    let shapeStr = '?';
    try { shapeStr = JSON.parse(sh).join(' × '); } catch {}

    const tooltipBorder = rw === 'r'
      ? MEMORY_TIER_VISUALS.L1.active
      : rw === 'w'
        ? MEMORY_TIER_VISUALS.DDR.active
        : (color || MEMORY_TIER_VISUALS.L0A.active);
    tip.style.borderColor = tooltipBorder;
    tip.innerHTML = `
      <div style="font-size:10px;font-weight:700;color:var(--text-primary);margin-bottom:4px">${tier} · Tensor</div>
      <hr class="bt-divider">
      <div class="bt-row"><span class="bt-k">Name</span><span class="bt-v">${name}</span></div>
      <div class="bt-row"><span class="bt-k">Shape</span><span class="bt-v">${shapeStr}</span></div>
      <div class="bt-row"><span class="bt-k">Type</span><span class="bt-v">${dt}</span></div>
      <div class="bt-row"><span class="bt-k">Size</span><span class="bt-v">${sz}</span></div>
      <div class="bt-row"><span class="bt-k">Addr</span><span class="bt-v">${addr}</span></div>
      <div class="bt-row"><span class="bt-k">Access</span><span class="bt-v ${rwClass}">${rwText}</span></div>
    `;
    tip.classList.add('visible');
  });

  document.addEventListener('mousemove', (e) => {
    if (!currentTarget) return;
    const W = window.innerWidth, H = window.innerHeight;
    const tw = tip.offsetWidth || 160, th = tip.offsetHeight || 120;
    const ox = 14, oy = 12;
    let x = e.clientX + ox;
    let y = e.clientY + oy;
    if (x + tw > W) x = e.clientX - tw - ox;
    if (y + th > H) y = e.clientY - th - oy;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  });

  document.addEventListener('mouseleave', (e) => {
    if (e.target.closest?.('.bpg-cell')) {
      tip.classList.remove('visible');
      currentTarget = null;
    }
  }, true);
}

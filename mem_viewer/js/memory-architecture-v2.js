import { TENSOR_META } from '../data/ops.js';
import { BPG_CONFIG, fmtBytes, opByMagic, MEMORY_TIER_VISUALS } from './constants.js';
import { SCHEDULE, getLiveTensorsAtStep, getActiveTensors } from './schedule.js';

const ARCH_PRESET = 'ascend910b';
const BUFFER_SELECTORS = {
  L1: '[data-aic-node="buffer:L1"]',
  L0A: '[data-aic-node="buffer:L0A"]',
  L0B: '[data-aic-node="buffer:L0B"]',
  L0C: '[data-aic-node="buffer:L0C"]',
  UB: '[data-aiv-node="buffer:UB"]',
};
const TIERS = Object.keys(BUFFER_SELECTORS);

let helper = null;
let stageEl = null;
let overlay = null;
let hover = null;
let resizeObserver = null;
let currentStep = 0;
let fitFrame = 0;
let lastResizeWidth = 0;
let lastFitWidth = 0;
let lastAppliedScale = 0;

function hexToRgba(hex, alpha) {
  if (!hex || hex.startsWith('rgb')) return hex || `rgba(255,255,255,${alpha})`;
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function root() {
  return stageEl?.querySelector('.pto-mem950') || null;
}

function bufferForTier(tier) {
  return root()?.querySelector(BUFFER_SELECTORS[tier]) || null;
}

function cellsForBuffer(buffer) {
  return Array.from(buffer?.querySelectorAll('.pto-aic-core__cell, .pto-aiv-core__cell') || []);
}

function ensureBufferChrome() {
  for (const tier of TIERS) {
    const buffer = bufferForTier(tier);
    if (!buffer) continue;
    buffer.dataset.mvV2Tier = tier;
    cellsForBuffer(buffer).forEach((cell) => cell.classList.add('mv-v2-memory-cell'));

    if (!buffer.querySelector('.mv-v2-buffer-status')) {
      const status = document.createElement('div');
      status.className = 'mv-v2-buffer-status';
      status.dataset.mvV2Status = tier;
      buffer.appendChild(status);
    }
    if (!buffer.querySelector('.mv-v2-buffer-legend')) {
      const legend = document.createElement('div');
      legend.className = 'mv-v2-buffer-legend';
      legend.dataset.mvV2Legend = tier;
      buffer.appendChild(legend);
    }
  }
}

function clearCell(cell) {
  cell.classList.remove('is-filled', 'is-active', 'is-read', 'is-write', 'is-label-anchor');
  cell.removeAttribute('data-tier');
  cell.removeAttribute('data-magic');
  cell.removeAttribute('data-name');
  cell.removeAttribute('data-dt');
  cell.removeAttribute('data-sh');
  cell.removeAttribute('data-sz');
  cell.removeAttribute('data-addr');
  cell.removeAttribute('data-rw');
  cell.removeAttribute('aria-label');
  cell.removeAttribute('title');
  cell.style.removeProperty('--mv-v2-cell-fill');
  cell.style.removeProperty('--mv-v2-cell-border');
  cell.style.removeProperty('--mv-v2-cell-glow');
  cell.textContent = '';
}

function renderLegend(buffer, tier, tensors) {
  const legend = buffer.querySelector('.mv-v2-buffer-legend');
  if (!legend) return;
  legend.innerHTML = '';
  tensors.slice(0, 4).forEach((magic) => {
    const meta = TENSOR_META[magic] || {};
    const item = document.createElement('div');
    item.className = 'mv-v2-buffer-legend-item';

    const dot = document.createElement('span');
    dot.className = 'mv-v2-buffer-legend-dot';
    dot.style.background = MEMORY_TIER_VISUALS[tier]?.chip || MEMORY_TIER_VISUALS.L0A.chip;
    item.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'mv-v2-buffer-legend-label';
    label.textContent = meta.s || `T${magic}`;
    item.appendChild(label);
    legend.appendChild(item);
  });

  if (tensors.length > 4) {
    const more = document.createElement('div');
    more.className = 'mv-v2-buffer-legend-item';
    more.textContent = `+${tensors.length - 4} more`;
    legend.appendChild(more);
  }
}

function renderTier(tier, tensors, activeTensors, inputSet, outputSet) {
  const buffer = bufferForTier(tier);
  if (!buffer) return;
  const cells = cellsForBuffer(buffer);
  const cfg = BPG_CONFIG[tier] || { bpc: 4096 };
  const visual = MEMORY_TIER_VISUALS[tier] || MEMORY_TIER_VISUALS.L0A;
  let cursor = 0;
  let usedBytes = 0;

  cells.forEach(clearCell);

  for (const magic of tensors) {
    const meta = TENSOR_META[magic] || {};
    const bytes = meta.b || cfg.bpc;
    const cellCount = Math.max(1, Math.ceil(bytes / cfg.bpc));
    usedBytes += bytes;

    for (let index = 0; index < cellCount && cursor < cells.length; index += 1, cursor += 1) {
      const cell = cells[cursor];
      const addr = `0x${(cursor * cfg.bpc).toString(16).padStart(6, '0')}`;
      const isActive = activeTensors.has(magic);
      const rw = inputSet.has(magic) ? 'r' : outputSet.has(magic) ? 'w' : '';

      cell.classList.add('is-filled');
      if (isActive) cell.classList.add('is-active');
      if (rw === 'r') cell.classList.add('is-read');
      if (rw === 'w') cell.classList.add('is-write');
      if (index === 0) cell.classList.add('is-label-anchor');
      cell.style.setProperty('--mv-v2-cell-fill', hexToRgba(visual.chip, isActive ? 0.95 : 0.78));
      cell.style.setProperty('--mv-v2-cell-border', rw === 'w' ? MEMORY_TIER_VISUALS.DDR.active : visual.active);
      cell.style.setProperty('--mv-v2-cell-glow', visual.glow);
      cell.dataset.tier = tier;
      cell.dataset.magic = String(magic);
      cell.dataset.name = meta.s || `T${magic}`;
      cell.dataset.dt = meta.dt || '?';
      cell.dataset.sh = meta.sh ? JSON.stringify(meta.sh) : '[]';
      cell.dataset.sz = fmtBytes(meta.b || 0);
      cell.dataset.addr = addr;
      cell.dataset.rw = rw;
      cell.title = `Tensor ${magic} | ${tier} | ${addr}`;
      cell.setAttribute('aria-label', `Tensor ${magic}`);
      cell.textContent = index === 0 ? String(magic) : '';
    }
  }

  const status = buffer.querySelector('.mv-v2-buffer-status');
  if (status) {
    status.textContent = tensors.length
      ? `${tensors.length} tensors live · ${fmtBytes(usedBytes)}`
      : 'empty';
  }
  renderLegend(buffer, tier, tensors);
}

function clearActivity() {
  const archRoot = root();
  if (!archRoot) return;
  archRoot.querySelectorAll('.mv-v2-active-node, .mv-v2-active-route').forEach((el) => {
    el.classList.remove('mv-v2-active-node', 'mv-v2-active-route');
  });
}

function mark(selector, className = 'mv-v2-active-node') {
  root()?.querySelectorAll(selector).forEach((el) => el.classList.add(className));
}

function renderActivity(step) {
  const op = opByMagic.get(SCHEDULE[step]);
  const opName = op?.n || '';
  clearActivity();

  if (opName === 'COPY_IN' || opName === 'COPY_OUT') {
    mark('[data-mem950-node="rail:GM"], [data-mem950-node="rail:L2"], [data-aic-node="buffer:L1"]');
    mark('[data-route-id="l2-to-aic"]', 'mv-v2-active-route');
    return;
  }

  if (opName === 'L1_TO_L0A') {
    mark('[data-aic-node="buffer:L1"], [data-aic-node="buffer:L0A"]');
    mark('[data-aic-route-from="buffer:L1"][data-aic-route-to="buffer:L0A"]', 'mv-v2-active-route');
    return;
  }

  if (opName === 'L1_TO_L0B') {
    mark('[data-aic-node="buffer:L1"], [data-aic-node="buffer:L0B"]');
    mark('[data-aic-route-from="buffer:L1"][data-aic-route-to="buffer:L0B"]', 'mv-v2-active-route');
    return;
  }

  if (opName === 'A_MUL_B' || opName === 'A_MULACC_B') {
    mark('[data-aic-node="buffer:L0A"], [data-aic-node="buffer:L0B"], [data-aic-node="cube:CUBE"], [data-aic-node="buffer:L0C"]');
    mark('[data-aic-route-to="cube:CUBE"], [data-aic-route-from="cube:CUBE"][data-aic-route-to="buffer:L0C"]', 'mv-v2-active-route');
  }
}

function renderTensorCells(step) {
  const liveByTier = getLiveTensorsAtStep(step);
  const activeTensors = getActiveTensors(step);
  const op = opByMagic.get(SCHEDULE[step]);
  const inputSet = new Set(op?.i || []);
  const outputSet = new Set(op?.o || []);

  for (const tier of TIERS) {
    renderTier(tier, liveByTier[tier] || [], activeTensors, inputSet, outputSet);
  }
}

function formatShape(value) {
  try {
    const shape = JSON.parse(value || '[]');
    return Array.isArray(shape) && shape.length ? shape.join(' x ') : '?';
  } catch {
    return '?';
  }
}

function initTensorTooltip() {
  if (document.getElementById('mv-v2-tensor-tip')) return;
  const tip = document.createElement('div');
  tip.id = 'mv-v2-tensor-tip';
  document.body.appendChild(tip);
  let activeCell = null;

  document.addEventListener('mouseover', (event) => {
    const cell = event.target.closest?.('.mv-v2-memory-cell[data-magic]');
    if (!cell) {
      activeCell = null;
      tip.classList.remove('visible');
      return;
    }
    activeCell = cell;
    const rwText = cell.dataset.rw === 'r' ? 'read' : cell.dataset.rw === 'w' ? 'write' : '-';
    tip.innerHTML = `
      <div class="mv-v2-tip-title">${cell.dataset.tier} · Tensor ${cell.dataset.magic}</div>
      <div class="mv-v2-tip-row"><span>Name</span><strong>${cell.dataset.name}</strong></div>
      <div class="mv-v2-tip-row"><span>Shape</span><strong>${formatShape(cell.dataset.sh)}</strong></div>
      <div class="mv-v2-tip-row"><span>Type</span><strong>${cell.dataset.dt}</strong></div>
      <div class="mv-v2-tip-row"><span>Size</span><strong>${cell.dataset.sz}</strong></div>
      <div class="mv-v2-tip-row"><span>Addr</span><strong>${cell.dataset.addr}</strong></div>
      <div class="mv-v2-tip-row"><span>Access</span><strong>${rwText}</strong></div>
    `;
    tip.classList.add('visible');
  });

  document.addEventListener('mousemove', (event) => {
    if (!activeCell) return;
    const gap = 14;
    const width = tip.offsetWidth || 180;
    const height = tip.offsetHeight || 130;
    let left = event.clientX + gap;
    let top = event.clientY + gap;
    if (left + width > window.innerWidth) left = event.clientX - width - gap;
    if (top + height > window.innerHeight) top = event.clientY - height - gap;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });
}

function getArchitectureAvailableWidth() {
  const panel = document.getElementById('bottom-panel');
  const shell = document.getElementById('arch-diagram');
  const target = panel || shell;
  if (!target) return 360;
  const rect = target.getBoundingClientRect();
  const styles = window.getComputedStyle(target);
  const paddingX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
  return Math.max(360, Math.round(rect.width - paddingX - 24));
}

function fitArchitecture(force = false) {
  const archRoot = root();
  const shell = document.getElementById('arch-diagram');
  if (!helper || !stageEl || !archRoot || !shell) return;
  const availableWidth = getArchitectureAvailableWidth();
  const naturalWidth = Math.max(1, archRoot.offsetWidth || archRoot.getBoundingClientRect().width);
  const scale = Math.max(0.42, Math.min(0.84, availableWidth / naturalWidth));
  const widthChanged = Math.abs(availableWidth - lastFitWidth) >= 2;
  const scaleChanged = Math.abs(scale - lastAppliedScale) >= 0.005;

  if (force || widthChanged || scaleChanged) {
    helper.applyCanvasScale(stageEl, scale);
    lastFitWidth = availableWidth;
    lastAppliedScale = scale;
    overlay?.update?.();
  }

  const readout = document.getElementById('arch-fit-readout');
  if (readout) readout.textContent = `fit ${Math.round(scale * 100)}%`;
}

function scheduleFit(force = false) {
  window.cancelAnimationFrame(fitFrame);
  fitFrame = window.requestAnimationFrame(() => {
    fitArchitecture(force);
  });
}

function scheduleFitForResize(entries) {
  const entry = entries?.[0];
  const inlineSize = entry?.borderBoxSize?.[0]?.inlineSize
    ?? entry?.borderBoxSize?.inlineSize
    ?? entry?.target?.getBoundingClientRect?.().width
    ?? entry?.contentRect?.width
    ?? document.getElementById('bottom-panel')?.clientWidth
    ?? 0;
  const nextWidth = Math.round(inlineSize);
  if (!nextWidth) {
    scheduleFit();
    return;
  }
  if (lastResizeWidth && Math.abs(nextWidth - lastResizeWidth) < 2) return;
  lastResizeWidth = nextWidth;
  scheduleFit(true);
}

function showMissingRenderer() {
  if (!stageEl) return;
  stageEl.innerHTML = '<div class="mv-v2-arch-error">Memory architecture renderer unavailable.</div>';
}

export function initMemoryArchitectureV2() {
  stageEl = document.getElementById('memory-architecture-stage');
  helper = window.PtoMemoryArchitecturePattern;
  if (!stageEl || !helper) {
    showMissingRenderer();
    return;
  }

  hover?.destroy?.();
  overlay?.destroy?.();
  resizeObserver?.disconnect?.();
  lastResizeWidth = 0;
  lastFitWidth = 0;
  lastAppliedScale = 0;

  helper.renderArchitecture(stageEl, ARCH_PRESET);
  stageEl.classList.add('mv-v2-memory-arch');
  overlay = helper.createRouteOverlay(stageEl, ARCH_PRESET);
  hover = helper.attachHoverInteractions(stageEl, ARCH_PRESET);
  helper.setDetailVisibility(stageEl, true);
  ensureBufferChrome();
  initTensorTooltip();

  const resizeTarget = document.getElementById('bottom-panel');
  resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(scheduleFitForResize)
    : null;
  if (resizeObserver && resizeTarget) resizeObserver.observe(resizeTarget);

  window.requestAnimationFrame(() => {
    overlay?.render?.();
    fitArchitecture(true);
    renderMemoryArchitectureV2(currentStep);
  });
}

export function renderMemoryArchitectureV2(step) {
  currentStep = step;
  if (!stageEl || !helper || !root()) return;
  ensureBufferChrome();
  renderTensorCells(step);
  renderActivity(step);
  overlay?.update?.();
}

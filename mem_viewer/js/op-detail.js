import { TENSOR_META } from '../data/ops.js';
import { opByMagic, getTensorTier, TIER_COLORS, getOpColor, getOpCategory, fmtBytes } from './constants.js';
import { SCHEDULE, scheduleIndexOf } from './schedule.js';

/* ============================================================
   Module state
   ============================================================ */
let selectedOpMagic = null;
let _currentStep = 0;
let lastAnchor = { x: window.innerWidth - 400, y: window.innerHeight - 260 };

const floatPanel = document.getElementById('op-detail-float');
const body = document.getElementById('op-detail-body');
const closeBtn = document.getElementById('op-detail-close');

export function getSelectedOpMagic() { return selectedOpMagic; }
export function setCurrentStep(step) { _currentStep = step; }

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionFloatPanel(anchor = lastAnchor) {
  if (!floatPanel) return;
  const margin = 12;
  const gap = 14;
  const panelRect = floatPanel.getBoundingClientRect();
  const panelWidth = panelRect.width || 360;
  const panelHeight = panelRect.height || 240;

  let left = anchor.x + gap;
  let top = anchor.y + gap;

  if (left + panelWidth > window.innerWidth - margin) {
    left = anchor.x - panelWidth - gap;
  }
  if (left < margin) {
    left = window.innerWidth - panelWidth - margin;
  }
  if (top + panelHeight > window.innerHeight - margin) {
    top = anchor.y - panelHeight - gap;
  }
  if (top < margin) {
    top = margin;
  }

  floatPanel.style.left = `${clamp(left, margin, Math.max(margin, window.innerWidth - panelWidth - margin))}px`;
  floatPanel.style.top = `${clamp(top, margin, Math.max(margin, window.innerHeight - panelHeight - margin))}px`;
}

export function hideOpDetail() {
  selectedOpMagic = null;
  if (!floatPanel) return;
  floatPanel.classList.remove('visible');
  floatPanel.setAttribute('aria-hidden', 'true');
}

/* ============================================================
   Toggle selection (click again to deselect)
   ============================================================ */
export function selectOp(magic, anchor) {
  if (selectedOpMagic === magic) {
    hideOpDetail();
    return;
  }
  selectedOpMagic = magic;
  if (anchor) lastAnchor = anchor;
  renderOpDetail(selectedOpMagic, _currentStep);
}

/* ============================================================
   Render op detail panel
   ============================================================ */
export function renderOpDetail(magic, currentStep) {
  if (!body || !floatPanel) return;

  if (magic === null || magic === undefined) {
    hideOpDetail();
    return;
  }

  const op = opByMagic.get(magic);
  if (!op) {
    body.innerHTML = '<div class="od-placeholder">算子未找到</div>';
    floatPanel.classList.add('visible');
    floatPanel.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => positionFloatPanel());
    return;
  }

  const color    = getOpColor(op.n);
  const category = getOpCategory(op.n);
  const stepIdx  = scheduleIndexOf.get(magic);
  const step     = currentStep ?? -1;

  let statusHtml;
  if (stepIdx === undefined) {
    statusHtml = '<span style="color:var(--text-dim)">— 未调度</span>';
  } else if (step > stepIdx) {
    statusHtml = '<span style="color:#4ade80">✓ 已完成</span>';
  } else if (step === stepIdx) {
    statusHtml = '<span style="color:#fb923c">▶ 执行中</span>';
  } else {
    statusHtml = '<span style="color:var(--text-dim)">◌ 待执行</span>';
  }

  // Memory ops table
  const tensors = [...op.i.map(m => ({ m, dir: 'IN' })), ...op.o.map(m => ({ m, dir: 'OUT' }))];
  let rowsHtml = tensors.map(({ m, dir }) => {
    const meta  = TENSOR_META[m] ?? {};
    const name  = meta.s || `T${m}`;
    const shape = meta.sh ? '[' + meta.sh.join(', ') + ']' : '?';
    const dt    = meta.dt || '?';
    const sz    = fmtBytes(meta.b ?? 0);
    const tier  = getTensorTier(m);
    const tc    = TIER_COLORS[tier] || '#6b7280';
    const dirCls = dir === 'IN' ? 'in' : 'out';
    return `<div class="od-tensor-row">
      <span class="od-dir ${dirCls}">${dir}</span>
      <span class="od-t-name">${name}</span>
      <span class="od-t-shape">${shape}</span>
      <span class="od-t-type">${dt}</span>
      <span class="od-t-sz">${sz}</span>
      <span class="od-tier-chip" style="color:${tc};border-color:${tc}20;background:${tc}18">${tier}</span>
    </div>`;
  }).join('');

  if (!rowsHtml) {
    rowsHtml = '<div style="color:var(--text-dim);font-size:10px;padding:4px 0">— 无 tensor 操作 —</div>';
  }

  body.innerHTML = `
    <div class="od-header">
      <div class="od-color-bar" style="background:${color};min-height:28px"></div>
      <span class="od-name">${op.n}</span>
      <span class="od-pipe-badge">${category}</span>
    </div>
    <div class="od-row">
      <span class="od-k">Step</span>
      <span class="od-v">${stepIdx !== undefined ? stepIdx : '—'} / ${SCHEDULE.length - 1}</span>
    </div>
    <div class="od-row">
      <span class="od-k">Magic</span>
      <span class="od-v">${magic}</span>
    </div>
    <div class="od-row">
      <span class="od-k">Status</span>
      <span class="od-v">${statusHtml}</span>
    </div>
    <hr class="od-sep">
    <div class="od-mem-label">Memory Ops</div>
    ${rowsHtml}
  `;
  floatPanel.classList.add('visible');
  floatPanel.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => positionFloatPanel());
}

closeBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  hideOpDetail();
});

document.addEventListener('click', (e) => {
  if (!floatPanel?.classList.contains('visible')) return;
  if (floatPanel.contains(e.target)) return;
  if (e.target.closest('[data-node-id]')) return;
  hideOpDetail();
});

window.addEventListener('resize', () => {
  if (!floatPanel?.classList.contains('visible')) return;
  positionFloatPanel();
});

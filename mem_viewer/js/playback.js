import { opByMagic, getTensorTier, getOpColor, getOpCategory } from './constants.js';
import { SCHEDULE } from './schedule.js';
import { renderMemoryPanel, renderDaVinciHighlights } from './memory-panel.js';
import { initMteOverlay, renderMteOverlay } from './mte-overlay.js';
import { loadGraph, fitGraph, applyStepToGraph, centerOnExecuting, isSvgLoaded, isAutoFollowEnabled } from './graph-viewer.js';
import { renderBufferGrids, initBpgTooltip } from './buffer-grid.js';
import { getSelectedOpMagic, renderOpDetail, setCurrentStep } from './op-detail.js';

/* ============================================================
   Step / Playback State
   ============================================================ */
let currentStep = 0;
let playing = false;
let playTimer = null;

const totalSteps = SCHEDULE.length;

const scrubber      = document.getElementById('scrubber');
const playBtn       = document.getElementById('play-btn');
const stepBackBtn   = document.getElementById('step-back-btn');
const stepFwdBtn    = document.getElementById('step-fwd-btn');
const replayBtn     = document.getElementById('replay-btn');
const scrubberLabel = document.getElementById('scrubber-label');
const scrubberOpname = document.getElementById('scrubber-opname');
const scrubberHover = document.getElementById('scrubber-hover');
const floatingShell = document.getElementById('floating-shell');
const floatingToggle = document.getElementById('floating-toggle');
const floatingCollapsedBtn = document.getElementById('floating-collapsed-btn');
const floatingCollapsedIcon = document.getElementById('floating-collapsed-icon');
const mainEl = document.getElementById('main');
const panelResizer = document.getElementById('panel-resizer');

const siStep   = document.getElementById('si-step');
const siTotal  = document.getElementById('si-total');
const siOpname = document.getElementById('si-opname');
const siOpmagic = document.getElementById('si-opmagic');

const detName    = document.getElementById('det-name');
const detMagic   = document.getElementById('det-magic');
const detInputs  = document.getElementById('det-inputs');
const detOutputs = document.getElementById('det-outputs');
const detTiers   = document.getElementById('det-tiers');

scrubber.max = totalSteps - 1;
siTotal.textContent = totalSteps;

function syncFloatingToolbarState() {
  if (!floatingShell || !floatingToggle || !floatingCollapsedIcon) return;
  const expanded = !floatingShell.classList.contains('is-collapsed');
  floatingShell.classList.toggle('is-expanded', expanded);
  floatingShell.classList.toggle('is-collapsed', !expanded);
  floatingToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  floatingToggle.setAttribute('aria-label', expanded ? 'Collapse playback toolbar' : 'Expand playback toolbar');
  floatingCollapsedIcon.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setTopPanelRatio(ratio) {
  const next = clamp(ratio, 28, 78);
  document.documentElement.style.setProperty('--top-panel-ratio', String(next));
}

function initPanelResizer() {
  if (!mainEl || !panelResizer) return;

  const onPointerMove = (e) => {
    const rect = mainEl.getBoundingClientRect();
    const ratio = ((e.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
    setTopPanelRatio(ratio);
  };

  const stopDragging = () => {
    panelResizer.classList.remove('is-dragging');
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDragging);
  };

  panelResizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    panelResizer.classList.add('is-dragging');
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDragging);
  });
}

function setFloatingToolbarExpanded(expanded) {
  if (!floatingShell) return;
  floatingShell.classList.toggle('is-collapsed', !expanded);
  floatingShell.classList.toggle('is-expanded', expanded);
  syncFloatingToolbarState();
}

function renderRuntimeStatus(step) {
  const doneCount    = step;
  const pendingCount = totalSteps - step - 1;
  const doneEl  = document.getElementById('rs-done');
  const pendEl  = document.getElementById('rs-pend');
  if (doneEl) doneEl.textContent = `✓ ${doneCount} done`;
  if (pendEl) pendEl.textContent = `◌ ${pendingCount} pending`;

  const op = opByMagic.get(SCHEDULE[step]);
  const runEl = document.getElementById('rs-run');
  if (runEl) runEl.textContent = `▶ ${op ? op.n : '—'}`;

  const dotEl   = document.getElementById('rs-cur-dot');
  const nameEl  = document.getElementById('rs-cur-name');
  const magicEl = document.getElementById('rs-cur-magic');
  const badgeEl = document.getElementById('rs-pipe-badge');
  if (op) {
    const color = getOpColor(op.n);
    if (dotEl)   { dotEl.style.background = color; dotEl.classList.add('pulsing'); }
    if (nameEl)  nameEl.textContent = op.n;
    if (magicEl) magicEl.textContent = `#${op.m}`;
    if (badgeEl) badgeEl.textContent = getOpCategory(op.n);
  } else {
    if (dotEl)   { dotEl.style.background = '#6b7280'; dotEl.classList.remove('pulsing'); }
    if (nameEl)  nameEl.textContent = '—';
    if (magicEl) magicEl.textContent = '';
    if (badgeEl) badgeEl.textContent = '';
  }
}

function goToStep(step) {
  step = Math.max(0, Math.min(totalSteps - 1, step));
  currentStep = step;

  scrubber.value = step;
  scrubberLabel.textContent = `${step} / ${totalSteps - 1}`;

  const op = opByMagic.get(SCHEDULE[step]);
  if (scrubberOpname) scrubberOpname.textContent = op ? op.n : '—';
  siStep.textContent = step + 1;
  siOpname.textContent = op ? op.n : '—';
  siOpmagic.textContent = op ? `(${op.m})` : '';

  if (op) {
    detName.textContent = op.n;
    detMagic.textContent = op.m;
    detInputs.textContent = op.i.join(', ') || '—';
    detOutputs.textContent = op.o.join(', ') || '—';

    const tiersAffected = new Set();
    for (const t of [...op.i, ...op.o]) {
      tiersAffected.add(getTensorTier(t));
    }
    detTiers.textContent = [...tiersAffected].filter(t => t !== 'DDR').join(', ') || 'DDR';
  } else {
    detName.textContent = '—';
    detMagic.textContent = '—';
    detInputs.textContent = '—';
    detOutputs.textContent = '—';
    detTiers.textContent = '—';
  }

  renderMemoryPanel(step);
  renderBufferGrids(step);
  renderDaVinciHighlights(step);
  renderMteOverlay(step);
  renderRuntimeStatus(step);

  setCurrentStep(step);
  const selMagic = getSelectedOpMagic();
  if (selMagic !== null) renderOpDetail(selMagic, step);

  if (isSvgLoaded()) {
    applyStepToGraph(step);
    if (op && isAutoFollowEnabled()) centerOnExecuting(op, !playing);
  }
}

/* ============================================================
   Playback controls
   ============================================================ */
function startPlay() {
  if (playing) return;
  playing = true;
  playBtn.innerHTML = '&#9646;&#9646; Pause';
  syncFloatingToolbarState();
  scheduleNext();
}

function stopPlay() {
  playing = false;
  playBtn.innerHTML = '&#9654; Play';
  clearTimeout(playTimer);
  syncFloatingToolbarState();
}

function scheduleNext() {
  if (!playing) return;
  const interval = 1400;
  playTimer = setTimeout(() => {
    if (currentStep >= totalSteps - 1) { stopPlay(); return; }
    goToStep(currentStep + 1);
    scheduleNext();
  }, interval);
}

playBtn.addEventListener('click', () => {
  if (playing) stopPlay();
  else {
    if (currentStep >= totalSteps - 1) goToStep(0);
    startPlay();
  }
});

stepBackBtn.addEventListener('click', () => { stopPlay(); goToStep(currentStep - 1); });
stepFwdBtn.addEventListener('click',  () => { stopPlay(); goToStep(currentStep + 1); });

scrubber.addEventListener('input', () => {
  stopPlay();
  goToStep(parseInt(scrubber.value));
});

replayBtn?.addEventListener('click', () => {
  stopPlay();
  goToStep(0);
});

floatingToggle?.addEventListener('click', () => {
  const expanded = floatingShell?.classList.contains('is-expanded');
  setFloatingToolbarExpanded(!expanded);
});

function updateScrubberHover(clientX) {
  if (!scrubber || !scrubberHover) return;
  const rect = scrubber.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)));
  const step = Math.round(ratio * (totalSteps - 1));
  const op = opByMagic.get(SCHEDULE[step]);
  scrubberHover.textContent = `Step ${step} · ${op ? `${op.n} #${op.m}` : '—'}`;
  scrubberHover.style.left = `${ratio * rect.width}px`;
}

scrubber?.addEventListener('pointermove', (e) => {
  updateScrubberHover(e.clientX);
  scrubberHover?.classList.add('visible');
});

scrubber?.addEventListener('pointerdown', () => {
  scrubberHover?.classList.add('visible');
});

scrubber?.addEventListener('pointerleave', () => {
  scrubberHover?.classList.remove('visible');
});

scrubber?.addEventListener('change', () => {
  scrubberHover?.classList.remove('visible');
});

floatingCollapsedBtn?.addEventListener('click', () => {
  const expanded = floatingShell?.classList.contains('is-expanded');
  if (expanded) {
    if (playing) playBtn.click();
    return;
  }
  setFloatingToolbarExpanded(true);
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight' || e.key === 'l') { stopPlay(); goToStep(currentStep + 1); }
  if (e.key === 'ArrowLeft'  || e.key === 'h') { stopPlay(); goToStep(currentStep - 1); }
  if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  if (e.key === 'f') fitGraph();
  if (e.key === 'Home') { stopPlay(); goToStep(0); }
  if (e.key === 'End')  { stopPlay(); goToStep(totalSteps - 1); }
});

/* ============================================================
   Initialize
   ============================================================ */
initBpgTooltip();
initMteOverlay();
initPanelResizer();
syncFloatingToolbarState();
goToStep(0);
loadGraph().then(() => {
  applyStepToGraph(currentStep);
  const op = opByMagic.get(SCHEDULE[currentStep]);
  if (op) centerOnExecuting(op, true);
});

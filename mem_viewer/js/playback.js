import { opByMagic, getTensorTier } from './constants.js';
import { SCHEDULE } from './schedule.js';
import { renderMemoryPanel } from './memory-panel.js';
import { loadGraph, fitGraph, applyStepToGraph, centerOnExecuting, isSvgLoaded } from './graph-viewer.js';

/* ============================================================
   Step / Playback State
   ============================================================ */
let currentStep = 0;
let playing = false;
let playSpeed = 1;
let playTimer = null;

const totalSteps = SCHEDULE.length;

const scrubber      = document.getElementById('scrubber');
const playBtn       = document.getElementById('play-btn');
const stepBackBtn   = document.getElementById('step-back-btn');
const stepFwdBtn    = document.getElementById('step-fwd-btn');
const scrubberLabel = document.getElementById('scrubber-label');

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

function goToStep(step) {
  step = Math.max(0, Math.min(totalSteps - 1, step));
  currentStep = step;

  scrubber.value = step;
  scrubberLabel.textContent = `${step} / ${totalSteps - 1}`;

  const op = opByMagic.get(SCHEDULE[step]);
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

  if (isSvgLoaded()) {
    applyStepToGraph(step);
    if (op) centerOnExecuting(op, !playing);
  }
}

/* ============================================================
   Playback controls
   ============================================================ */
function startPlay() {
  if (playing) return;
  playing = true;
  playBtn.innerHTML = '&#9646;&#9646; Pause';
  playBtn.classList.add('primary');
  scheduleNext();
}

function stopPlay() {
  playing = false;
  playBtn.innerHTML = '&#9654; Play';
  clearTimeout(playTimer);
}

function scheduleNext() {
  if (!playing) return;
  const interval = 2000 / playSpeed;
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

document.querySelectorAll('.mv-speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mv-speed-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    playSpeed = parseFloat(btn.dataset.speed);
    if (playing) { clearTimeout(playTimer); scheduleNext(); }
  });
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
goToStep(0);
loadGraph().then(() => {
  applyStepToGraph(currentStep);
  const op = opByMagic.get(SCHEDULE[currentStep]);
  if (op) centerOnExecuting(op, true);
});

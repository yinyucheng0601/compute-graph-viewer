import { getLiveTensorsAtStep, getActiveTensors, SCHEDULE } from './schedule.js';
import { opByMagic, UB_VEC_OPS } from './constants.js';

/* ============================================================
   Memory Panel Rendering — dark mode
   ============================================================ */

// Dark mode palette: semi-transparent colored tints on dark bg
const ARCH_TIER_COLORS = {
  L1:  { bg: 'rgba(53,119,246,0.85)',  border: 'rgba(53,119,246,0.9)',  text: '#ffffff', activeBorder: '#3577F6' },
  L0A: { bg: 'rgba(168,85,247,0.85)',  border: 'rgba(168,85,247,0.9)',  text: '#ffffff', activeBorder: '#A855F7' },
  L0B: { bg: 'rgba(124,58,237,0.85)',  border: 'rgba(124,58,237,0.9)',  text: '#ffffff', activeBorder: '#7c3aed' },
  L0C: { bg: 'rgba(249,115,22,0.85)',  border: 'rgba(249,115,22,0.9)',  text: '#ffffff', activeBorder: '#f97316' },
};

const ARCH_TIERS = ['L1', 'L0A', 'L0B', 'L0C'];

function hexToRgba(hex, alpha) {
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function renderMemoryPanel(step) {
  const liveByTier = getLiveTensorsAtStep(step);
  const activeTensors = getActiveTensors(step);

  for (const tier of ARCH_TIERS) {
    const container = document.getElementById(`tensors-${tier}`);
    if (!container) continue;

    const tensors = liveByTier[tier] || [];
    const palette = ARCH_TIER_COLORS[tier];

    container.innerHTML = '';
    if (tensors.length === 0) {
      container.innerHTML = '<div class="tier-empty">empty</div>';
      continue;
    }

    for (const t of tensors) {
      const isActive = activeTensors.has(t);
      const borderColor = isActive ? palette.activeBorder : palette.border;
      const shadowStyle = isActive
        ? `box-shadow:0 0 10px 2px ${hexToRgba(palette.activeBorder, 0.5)};`
        : '';
      const glowClass = isActive ? ' active-glow' : '';

      const div = document.createElement('div');
      div.className = `tensor-block${glowClass}`;
      div.style.cssText = `background:${palette.bg};border-color:${borderColor};color:${palette.text};${shadowStyle}`;
      div.title = `Tensor ${t} | Tier: ${tier}`;
      div.textContent = t;
      container.appendChild(div);
    }
  }
}

/* ============================================================
   DaVinci Architecture Dynamic Highlights
   ============================================================ */
function renderDaVinciHighlights(step) {
  const liveByTier = getLiveTensorsAtStep(step);
  const op = opByMagic.get(SCHEDULE[step]);
  const opName = op?.n ?? '';

  const cubeActive = opName === 'A_MUL_B' || opName === 'A_MULACC_B';
  const vecActive  = UB_VEC_OPS.has(opName);
  const anyAIC = ['L1', 'L0A', 'L0B', 'L0C'].some(t => (liveByTier[t] ?? []).length > 0);
  const anyAIV = (liveByTier['UB'] ?? []).length > 0;

  // Cube MMA
  const cubeEl = document.getElementById('cube-unit');
  if (cubeEl) {
    cubeEl.style.background    = cubeActive ? 'rgba(249,115,22,0.25)' : '';
    cubeEl.style.borderColor   = cubeActive ? '#f97316' : '';
    cubeEl.style.boxShadow     = cubeActive ? '0 0 12px rgba(249,115,22,0.5)' : '';
    cubeEl.style.transform     = cubeActive ? 'scale(1.03)' : '';
    cubeEl.style.transition    = 'all 0.25s ease';
  }

  // FixPipe
  const fixEl = document.getElementById('fixpipe-unit');
  if (fixEl) {
    fixEl.style.color      = cubeActive ? '#fbbf24' : '';
    fixEl.style.borderBottom = cubeActive ? '1px solid rgba(251,191,36,0.4)' : '';
    fixEl.style.transition = 'all 0.25s ease';
  }

  // Vector
  const vecEl = document.getElementById('vector-unit');
  if (vecEl) {
    vecEl.style.background  = vecActive ? 'rgba(16,185,129,0.20)' : '';
    vecEl.style.borderColor = vecActive ? '#10b981' : '';
    vecEl.style.boxShadow   = vecActive ? '0 0 10px rgba(16,185,129,0.45)' : '';
    vecEl.style.transition  = 'all 0.25s ease';
  }

  // AIC / AIV region backgrounds
  const aicEl = document.getElementById('arch-aic');
  if (aicEl) aicEl.style.background = anyAIC ? 'rgba(59,130,246,0.05)' : '';

  const aivEl = document.getElementById('arch-aiv');
  if (aivEl) aivEl.style.background = anyAIV ? 'rgba(16,185,129,0.05)' : '';
}

export { hexToRgba, renderMemoryPanel, renderDaVinciHighlights };

import { getLiveTensorsAtStep, getActiveTensors, SCHEDULE } from './schedule.js';
import { opByMagic, UB_VEC_OPS, ENGINE_MEMORY_LEGEND_COLORS, MEMORY_TIER_VISUALS } from './constants.js';

/* ============================================================
   Memory Panel Rendering — dark mode
   ============================================================ */

// Dark mode palette: semi-transparent colored tints on dark bg
const ARCH_TIER_COLORS = {
  L1:  { bg: 'rgba(34,184,181,0.85)', border: 'rgba(34,184,181,0.92)', text: '#ffffff', activeBorder: MEMORY_TIER_VISUALS.L1.active },
  L0A: { bg: 'rgba(29,183,217,0.85)', border: 'rgba(29,183,217,0.92)', text: '#ffffff', activeBorder: MEMORY_TIER_VISUALS.L0A.active },
  L0B: { bg: 'rgba(29,183,217,0.80)', border: 'rgba(29,183,217,0.88)', text: '#ffffff', activeBorder: MEMORY_TIER_VISUALS.L0B.active },
  L0C: { bg: 'rgba(29,183,217,0.74)', border: 'rgba(29,183,217,0.84)', text: '#ffffff', activeBorder: MEMORY_TIER_VISUALS.L0C.active },
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
    cubeEl.classList.toggle('is-active', cubeActive);
  }

  // FixPipe
  const fixEl = document.getElementById('fixpipe-unit');
  if (fixEl) {
    fixEl.classList.toggle('is-active', cubeActive);
  }

  // Vector
  const vecEl = document.getElementById('vector-unit');
  if (vecEl) {
    vecEl.classList.toggle('is-active', vecActive);
  }

  // AIC / AIV region backgrounds
  const aicEl = document.getElementById('arch-aic');
  if (aicEl) aicEl.style.background = anyAIC ? 'rgba(29,183,217,0.05)' : '';

  const aivEl = document.getElementById('arch-aiv');
  if (aivEl) aivEl.style.background = anyAIV ? 'rgba(29,183,217,0.04)' : '';

  if (cubeEl) {
    cubeEl.style.backgroundColor = cubeActive ? 'rgba(139,92,246,0.18)' : '';
    cubeEl.style.borderColor = cubeActive ? 'rgba(139,92,246,0.44)' : '';
    cubeEl.style.boxShadow = cubeActive ? `0 0 18px ${hexToRgba(ENGINE_MEMORY_LEGEND_COLORS.cube, 0.28)}` : '';
  }
  if (fixEl) {
    fixEl.style.color = cubeActive ? ENGINE_MEMORY_LEGEND_COLORS.cube : '';
    fixEl.style.textShadow = cubeActive ? `0 0 12px ${hexToRgba(ENGINE_MEMORY_LEGEND_COLORS.cube, 0.28)}` : '';
  }
  if (vecEl) {
    vecEl.style.backgroundColor = vecActive ? 'rgba(29,183,217,0.16)' : '';
    vecEl.style.borderColor = vecActive ? 'rgba(29,183,217,0.34)' : '';
    vecEl.style.color = vecActive ? '#8FE5F5' : '';
    vecEl.style.boxShadow = vecActive ? '0 0 16px rgba(29,183,217,0.24)' : '';
  }
}

export { hexToRgba, renderMemoryPanel, renderDaVinciHighlights };

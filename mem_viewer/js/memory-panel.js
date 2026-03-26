import { getLiveTensorsAtStep, getActiveTensors } from './schedule.js';

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

export { hexToRgba, renderMemoryPanel };

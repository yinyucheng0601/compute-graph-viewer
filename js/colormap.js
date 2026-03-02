/**
 * colormap.js — Color palette generation for node coloring modes
 */

// ── Color conversion utilities ─────────────────────────────────────────────

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h, s, l };
}

function hslToHex({ h, s, l }) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsl(hex) { return rgbToHsl(hexToRgb(hex)); }

// ── Base palette (design colors + RGB×0.8 dark overlay) ───────────────────

const CORE = [
  '#0015CC', // blue   H=234°
  '#1E8DB7', // sky    H=196°
  '#36B29F', // teal   H=171°
  '#57AA01', // lime   H=89°
  '#7246C8', // violet H=260°
  '#859100', // olive  H=65°
  '#B32E77', // pink   H=327°
  '#C69101', // amber  H=44°
  '#C85001', // orange H=24°
];

// ── Forbidden hue zones (avoid semantic red and green) ─────────────────────

const FORBIDDEN = [
  { from: 340/360, to: 20/360,  wraps: true  }, // 正红 340°–20°
  { from: 108/360, to: 148/360, wraps: false }, // 正绿 108°–148°
];

function isHueForbidden(h) {
  h = ((h % 1) + 1) % 1;
  for (const z of FORBIDDEN) {
    if (z.wraps) {
      if (h >= z.from || h <= z.to) return true;
    } else {
      if (h >= z.from && h <= z.to) return true;
    }
  }
  return false;
}

function snapToValid(h) {
  h = ((h % 1) + 1) % 1;
  if (!isHueForbidden(h)) return h;
  const STEP = 1/3600;
  let lo = h, hi = h;
  for (let i = 0; i < 1800; i++) {
    lo = ((lo - STEP) + 1) % 1;
    if (!isHueForbidden(lo)) return lo;
    hi = (hi + STEP) % 1;
    if (!isHueForbidden(hi)) return hi;
  }
  return h;
}

// ── Expand palette: bisect hues (skip forbidden) + multi-tier S/L ──────────

const MAX_HUE_POSITIONS = 100;
const MIN_GAP = 1/360 * 2.5; // ~2.5°
const TIERS = [
  { s: 0.80, l: 0.44 }, // Tier 0: base, close to design palette
  { s: 0.65, l: 0.60 }, // Tier 1: brighter, mid saturation
  { s: 0.85, l: 0.33 }, // Tier 2: darker, high saturation
  { s: 0.55, l: 0.54 }, // Tier 3: soft, low saturation
];

function expandPalette(baseHexes, targetCount) {
  // Priority: use CORE colors directly if they're enough
  if (targetCount <= baseHexes.length) return baseHexes.slice(0, targetCount);

  // Phase 1: build extended hue list via bisection
  const hues = baseHexes.map(c => hexToHsl(c).h);
  const coreHueSet = new Set(hues.map(h => Math.round(h * 1e6)));

  while (hues.length < MAX_HUE_POSITIONS) {
    let maxGap = -1, insertIdx = 0;
    for (let i = 0; i < hues.length; i++) {
      const a = hues[i];
      const b = hues[(i + 1) % hues.length];
      let gap = b - a;
      if (gap < 0) gap += 1;
      if (gap > maxGap) { maxGap = gap; insertIdx = i; }
    }
    const a = hues[insertIdx];
    const b = hues[(insertIdx + 1) % hues.length];
    let mid = b < a ? ((a + b + 1) / 2) % 1 : (a + b) / 2;
    if (isHueForbidden(mid)) mid = snapToValid(mid);
    const tooClose = hues.some(h => {
      let d = Math.abs(h - mid);
      if (d > 0.5) d = 1 - d;
      return d < MIN_GAP;
    });
    if (tooClose) break;
    hues.splice(insertIdx + 1, 0, mid);
  }

  // Phase 2: CORE first (exact), then bisected extras at Tier 0, then cycle tiers
  const result = [...baseHexes];
  const extraHues = hues.filter(h => !coreHueSet.has(Math.round(h * 1e6)));

  for (const h of extraHues) {
    if (result.length >= targetCount) break;
    result.push(hslToHex({ h, ...TIERS[0] }));
  }

  let tier = 1;
  while (result.length < targetCount) {
    const { s, l } = TIERS[tier % TIERS.length];
    for (const h of hues) {
      if (result.length >= targetCount) break;
      result.push(hslToHex({ h, s, l }));
    }
    tier++;
  }

  return result;
}

// ── Opcode functional category map ────────────────────────────────────────
// Groups low-level opcodes into 7 interpretable compute classes.

const OPCODE_CATEGORY = {
  // Memory / view (no arithmetic, shape manipulation only)
  VIEW: 'MEMORY', RESHAPE: 'MEMORY',
  // Cube engine matrix multiply (high latency, dedicated hardware)
  A_MUL_B: 'MATMUL',
  // Vector elementwise arithmetic
  MUL: 'ELEMENTWISE', MULS: 'ELEMENTWISE',
  ADD: 'ELEMENTWISE', ADDS: 'ELEMENTWISE',
  SUB: 'ELEMENTWISE', DIV: 'ELEMENTWISE', ABS: 'ELEMENTWISE',
  // Reduction ops
  ROWSUM_SINGLE: 'REDUCE', ROWMAX_SINGLE: 'REDUCE',
  // Special math / broadcast
  SQRT: 'SPECIAL_MATH', VEC_DUP: 'SPECIAL_MATH',
  // Precision conversion
  CAST: 'CAST',
  // Data movement / communication
  ASSEMBLE: 'COMMS', REGISTER_COPY: 'COMMS', INDEX_OUTCAST: 'COMMS',
};

function opcodeToCategory(opcode) {
  const cat = OPCODE_CATEGORY[(opcode || '').toUpperCase()];
  return cat ? 'cat:' + cat : 'op:' + (opcode || 'unknown');
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Given an array of string keys, returns a Map<key, hexColor>
 */
function buildColorMap(keys) {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return new Map();
  const colors = expandPalette(CORE, Math.max(unique.length, CORE.length));
  const map = new Map();
  unique.forEach((k, i) => map.set(k, colors[i]));
  return map;
}

/**
 * Extract semantic key for a node.
 * Op nodes: prefer semantic_label.label (from pypto compiler annotation),
 *           fall back to opcode functional category.
 * Tensor nodes: group by dtype.
 * Boundary (incast/outcast): fixed keys.
 */
function getSemanticKey(node) {
  switch (node.type) {
    case 'op':
      if (node.data.semanticLabel) return 'sem:' + node.data.semanticLabel;
      return opcodeToCategory(node.data.opcode);
    case 'incast':  return 'boundary:incast';
    case 'outcast': return 'boundary:outcast';
    default:        return 'tensor';
  }
}

/**
 * Map a latency value (cycles) to a hex color via log-scale blue→red gradient.
 * Returns null for non-op nodes or missing latency.
 */
function latencyToColor(latency) {
  if (latency == null || latency <= 0) return null;
  // Log10 scale: ~8 cycles (fast) → ~100,000 cycles (slow)
  const log = Math.log10(Math.max(1, latency));
  const t = Math.min(1, log / 5);  // normalize to [0,1]
  // h: 0.611 (220° blue) → 0 (0° red)
  const h = (1 - t) * 0.611;
  const s = 0.70 + t * 0.15;
  const l = 0.60 - t * 0.14;
  return hslToHex({ h, s, l });
}

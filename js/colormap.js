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
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
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
  { from: 340 / 360, to: 20 / 360, wraps: true }, // 正红 340°–20°
  { from: 108 / 360, to: 148 / 360, wraps: false }, // 正绿 108°–148°
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
  const STEP = 1 / 3600;
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
const MIN_GAP = 1 / 360 * 2.5; // ~2.5°
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

// ── Engine + Memory mode helpers ──────────────────────────────────────────

const ENGINE_MEMORY_COLORS = {
  'engine:vector': '#3B82F6',      // blue
  'engine:cube': '#8B5CF6',        // purple
  'memory:gm': '#14B8A6',          // teal
  'memory:l1': '#0EA5A4',          // dark teal
  'memory:l0': '#06B6D4',          // cyan
  'memory:ub': '#22D3EE',          // light cyan
  'memory:local': '#5EEAD4',       // mint
  'memory:register': '#64748B',    // slate
  'memory:workspace': '#2DD4BF',   // turquoise
  'memory:allocated': '#0F766E',   // deep teal
  'memory:unknown': '#6B7280',     // neutral
};

const MEM_TYPE_CODE_TO_KEY = {
  0: 'memory:gm',
  1: 'memory:l1',
  2: 'memory:l0',
  3: 'memory:l0',
  4: 'memory:l0',
  5: 'memory:ub',
  6: 'memory:local',
  7: 'memory:register',
  8: 'memory:workspace',
  15: 'memory:gm',
};

const ENGINE_MEMORY_LABELS = {
  'engine:vector': 'Vector Engine',
  'engine:cube': 'Cube Engine',
  'memory:gm': 'GM',
  'memory:l1': 'L1',
  'memory:l0': 'L0',
  'memory:ub': 'UB',
  'memory:local': 'Local',
  'memory:register': 'Register',
  'memory:workspace': 'Workspace',
  'memory:allocated': 'Allocated',
  'memory:unknown': 'Unknown',
};

function asBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}

function normalizeMemTypeValue(v) {
  if (v == null) return null;
  if (typeof v === 'number') return MEM_TYPE_CODE_TO_KEY[v] || null;

  const s = String(v).toUpperCase();
  if (s.includes('L1')) return 'memory:l1';
  if (s.includes('L0')) return 'memory:l0';
  if (s.includes('UB')) return 'memory:ub';
  if (s.includes('GM')) return 'memory:gm';
  if (s.includes('REG')) return 'memory:register';
  if (s.includes('LOCAL')) return 'memory:local';
  if (s.includes('WORK')) return 'memory:workspace';
  return null;
}

function getOpEngineKey(node) {
  if (!node || node.type !== 'op') return null;
  const opcode = (node.data?.opcode || '').toUpperCase();
  const isCube = asBool(node.data?.opAttr?.IS_CUBE) || opcode === 'A_MUL_B';
  return isCube ? 'engine:cube' : 'engine:vector';
}

function getTensorMemoryKey(node) {
  if (!node || (node.type !== 'tensor' && node.type !== 'incast' && node.type !== 'outcast')) return null;
  const memType = node.data?.memType || null;
  const targetKey = normalizeMemTypeValue(memType?.tobe);
  if (targetKey) return targetKey;

  const currentKey = normalizeMemTypeValue(memType?.asis);
  if (currentKey) return currentKey;

  const memId = node.data?.memId;
  if (typeof memId === 'number' && memId >= 0) return 'memory:allocated';
  return 'memory:unknown';
}

function getEngineMemoryKey(node) {
  if (!node) return null;
  if (node.type === 'op') return getOpEngineKey(node);
  return getTensorMemoryKey(node);
}

function getEngineMemoryColor(key) {
  return ENGINE_MEMORY_COLORS[key] || ENGINE_MEMORY_COLORS['memory:unknown'];
}

function getEngineMemoryLabel(key) {
  return ENGINE_MEMORY_LABELS[key] || key || 'Unknown';
}

function getEngineMemoryHint(node) {
  if (!node) return '';
  const key = getEngineMemoryKey(node);
  return getEngineMemoryLabel(key);
}

function buildEngineMemoryNodeColorMap(nodes) {
  const nodeIdMap = new Map();
  for (const n of (nodes || [])) {
    const key = getEngineMemoryKey(n);
    if (!key) continue;
    nodeIdMap.set(n.id, getEngineMemoryColor(key));
  }
  return nodeIdMap;
}

// ── Pipeline semantic coloring ─────────────────────────────────────────────

const PIPELINE_HUES = {
  Query: { h: 215 / 360, s: 0.72 },
  Key: { h: 265 / 360, s: 0.68 },
  Weight: { h: 145 / 360, s: 0.65 },
  Prolog: { h: 40 / 360, s: 0.45 },  // shared utility, desaturated
  Embed: { h: 176 / 360, s: 0.62 },
  Norm: { h: 34 / 360, s: 0.68 },
  Attn: { h: 213 / 360, s: 0.7 },
  Residual: { h: 18 / 360, s: 0.72 },
  FFN: { h: 142 / 360, s: 0.6 },
  MoE: { h: 302 / 360, s: 0.55 },
  Output: { h: 346 / 360, s: 0.62 },
};

function parsePipelineLabel(semKey) {
  // semKey: 'sem:Key-LayerNorm' or 'sem:Query-Linear' etc.
  if (!semKey || !semKey.startsWith('sem:')) return null;
  const inner = semKey.slice(4); // 'Key-LayerNorm'
  const dash = inner.indexOf('-');
  if (dash < 1) return null;
  const pipeline = inner.slice(0, dash);
  const stage = inner.slice(dash + 1);
  if (!PIPELINE_HUES[pipeline]) return null;
  return { pipeline, stage };
}

function buildPipelineSemanticColorMap(nodes) {
  // First pass: collect stages per pipeline (in order of first appearance)
  // Also collect non-pipeline semantic keys for generic palette assignment
  const pipelineStages = {}; // pipeline -> [stage, ...]
  const genericSemKeys = []; // non-pipeline sem:* keys
  nodes.forEach(n => {
    if (n.type !== 'op') return;
    const semKey = getSemanticKey(n);
    const parsed = parsePipelineLabel(semKey);
    if (!parsed) {
      if (semKey && semKey.startsWith('sem:') && !genericSemKeys.includes(semKey)) {
        genericSemKeys.push(semKey);
      }
      return;
    }
    const { pipeline, stage } = parsed;
    if (!pipelineStages[pipeline]) pipelineStages[pipeline] = [];
    if (!pipelineStages[pipeline].includes(stage)) {
      pipelineStages[pipeline].push(stage);
    }
  });

  // Build semKey -> color map for pipeline labels
  const semKeyColorMap = new Map();
  for (const [pipeline, stages] of Object.entries(pipelineStages)) {
    const { h, s } = PIPELINE_HUES[pipeline];

    // Support single stage by ensuring hueRange covers it, or default to base
    const totalStages = Math.max(1, stages.length);
    // Use the continuous hue function: 30 degrees range
    const stageColors = getLaneColors(totalStages, h * 360, 30);

    stages.forEach((stage, i) => {
      // getLaneColors returns hex colors
      semKeyColorMap.set('sem:' + pipeline + '-' + stage, stageColors[i]);
    });
  }

  // Assign distinct colors to non-pipeline semantic keys (VIEW, RESHAPE, ASSEMBLE, etc.)
  if (genericSemKeys.length > 0) {
    const genericPalette = buildColorMap(genericSemKeys.sort((a, b) => a.localeCompare(b)));
    genericPalette.forEach((color, key) => {
      if (!semKeyColorMap.has(key)) semKeyColorMap.set(key, color);
    });
  }

  // Second pass: build nodeId -> color map
  const nodeIdMap = new Map();
  nodes.forEach(n => {
    if (n.type !== 'op') return;
    const semKey = getSemanticKey(n);
    // Use the merged colorMap — covers both pipeline and generic sem:* keys
    nodeIdMap.set(n.id, semKeyColorMap.get(semKey) ?? '#666666');
  });

  return nodeIdMap;
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
// Opcodes that have named semantic meanings even without explicit semantic_label
const INLINE_OPCODE_LABELS = {
  VIEW: 'View', RESHAPE: 'Reshape', ASSEMBLE: 'Assemble',
  REGISTER_COPY: 'Copy', INDEX_OUTCAST: 'Outcast',
  A_MUL_B: 'Matmul', ROWSUM_SINGLE: 'Reduce', ROWMAX_SINGLE: 'Reduce',
  CAST: 'Cast', SQRT: 'Special Math', VEC_DUP: 'Broadcast',
};

function getSemanticKey(node) {
  switch (node.type) {
    case 'op':
      if (node.data.semanticLabel) return 'sem:' + node.data.semanticLabel;
      if (node.data.inferredSemanticLabel) return 'sem:' + node.data.inferredSemanticLabel;
      // Inline inference for well-known opcodes
      {
        const opcode = String(node.data.opcode || '').toUpperCase();
        if (INLINE_OPCODE_LABELS[opcode]) return 'sem:' + INLINE_OPCODE_LABELS[opcode];
      }
      return opcodeToCategory(node.data.opcode);
    case 'incast': return 'boundary:incast';
    case 'outcast': return 'boundary:outcast';
    default: return 'tensor';
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

function fixPrologColors(colorMap, nodes, edges) {
  const succ = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) succ.get(e.source)?.push(e.target);
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Build semKey→color for non-Prolog pipeline stages
  const pipelineStages = {};
  nodes.forEach(n => {
    if (n.type !== 'op') return;
    const parsed = parsePipelineLabel(getSemanticKey(n));
    if (!parsed || parsed.pipeline === 'Prolog') return;
    if (!pipelineStages[parsed.pipeline]) pipelineStages[parsed.pipeline] = [];
    if (!pipelineStages[parsed.pipeline].includes(parsed.stage))
      pipelineStages[parsed.pipeline].push(parsed.stage);
  });
  const semKeyColorMap = new Map();
  for (const [pipeline, stages] of Object.entries(pipelineStages)) {
    const { h, s } = PIPELINE_HUES[pipeline];
    const totalStages = Math.max(1, stages.length);
    const stageColors = getLaneColors(totalStages, h * 360, 30);

    stages.forEach((stage, i) => {
      semKeyColorMap.set('sem:' + pipeline + '-' + stage, stageColors[i]);
    });
  }

  nodes.forEach(n => {
    if (n.type !== 'op') return;
    const parsed = parsePipelineLabel(getSemanticKey(n));
    if (!parsed || parsed.pipeline !== 'Prolog') return;

    const visited = new Set([n.id]);
    const queue = [...(succ.get(n.id) || [])];
    let targetPipeline = null;
    while (queue.length && !targetPipeline) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const nb = nodeMap.get(id);
      if (nb?.type === 'op') {
        const p = parsePipelineLabel(getSemanticKey(nb));
        if (p && p.pipeline !== 'Prolog') { targetPipeline = p.pipeline; break; }
      }
      queue.push(...(succ.get(id) || []));
    }
    if (!targetPipeline) return;

    const targetKey = 'sem:' + targetPipeline + '-' + parsed.stage;
    const color = semKeyColorMap.get(targetKey)
      ?? hslToHex({ ...PIPELINE_HUES[targetPipeline], l: 0.38 });
    colorMap.set(n.id, color);
  });

  // Also fix MEMORY (RESHAPE/VIEW) ops: BFS downstream → target pipeline hue (darker l)
  nodes.forEach(n => {
    if (n.type !== 'op') return;
    if (getSemanticKey(n) !== 'cat:MEMORY') return;
    const visited = new Set([n.id]);
    const queue = [...(succ.get(n.id) || [])];
    let targetPipeline = null;
    while (queue.length && !targetPipeline) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const nb = nodeMap.get(id);
      if (nb?.type === 'op') {
        const p = parsePipelineLabel(getSemanticKey(nb));
        if (p && p.pipeline !== 'Prolog') { targetPipeline = p.pipeline; break; }
      }
      queue.push(...(succ.get(id) || []));
    }
    if (!targetPipeline) return;
    colorMap.set(n.id, hslToHex({ ...PIPELINE_HUES[targetPipeline], l: 0.28 }));
  });
}

// ── Lane-based continuous hue coloring ──────────────────────────────────────

/**
 * Generate colors for lanes using continuous hue intervals
 * @param {number} totalLanes - Total number of lanes
 * @param {number} baseHue - Base hue in degrees (0-360)
 * @param {number} hueRange - Hue range in degrees (default: 30)
 * @returns {Array<string>} Array of hex colors
 */
function getLaneColors(totalLanes, baseHue = 220, hueRange = 30) {
  if (totalLanes <= 0) return [];

  const colors = [];
  const hueStep = hueRange / Math.max(1, totalLanes - 1);

  for (let i = 0; i < totalLanes; i++) {
    // Calculate hue within the specified range
    let hue = (baseHue + i * hueStep) % 360;
    hue = hue / 360; // Convert to 0-1 range

    // Use colormap.js's forbidden zone handling
    const snappedHue = snapToValid(hue);

    // Use consistent saturation and lightness for lane colors
    const s = 0.7; // Medium saturation
    const l = 0.5; // Medium lightness

    colors.push(hslToHex({ h: snappedHue, s, l }));
  }

  return colors;
}

/**
 * Create a color map for pipeline lanes using continuous hue intervals
 * @param {Array<string>} pipelineNames - Array of pipeline names
 * @param {number} baseHue - Base hue in degrees (default: 220 for blue)
 * @param {number} hueRange - Hue range in degrees (default: 30)
 * @returns {Map<string, string>} Map of pipeline name to hex color
 */
function buildLaneColorMap(pipelineNames, baseHue = 220, hueRange = 30) {
  const colors = getLaneColors(pipelineNames.length, baseHue, hueRange);
  const colorMap = new Map();

  pipelineNames.forEach((pipeline, index) => {
    colorMap.set(pipeline, colors[index] || '#666666');
  });

  return colorMap;
}

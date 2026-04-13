import { OP_DATA, TENSOR_TOBE } from '../data/ops.js';
export { TENSOR_META } from '../data/ops.js';

/* ============================================================
   Constants
   ============================================================ */

// tobe code -> tier name
const TOBE_TO_TIER = { 1: 'L1', 2: 'L0A', 3: 'L0B', 4: 'L0C', 15: 'DDR' };

const TIERS = ['L1', 'L0A', 'L0B', 'L0C'];  // on-chip tiers shown in arch diagram
const TIER_CAPACITY = { L1: 1024, L0A: 64, L0B: 64, L0C: 256 };
const TIER_CAP_BYTES = { L1: 1048576, L0A: 65536, L0B: 65536, L0C: 262144, UB: 262144 };
const ENGINE_MEMORY_LEGEND_COLORS = {
  cube: '#8B5CF6',
  l0:   '#1DB7D9',
  l1:   '#22B8B5',
  gm:   '#8DD61A',
  neutral: '#6B7280',
};
const TIER_ENGINE_GROUP = {
  L1: 'l1',
  L0A: 'l0',
  L0B: 'l0',
  L0C: 'l0',
  UB: 'l0',
  DDR: 'gm',
};
const MEMORY_TIER_VISUALS = {
  L1: {
    chip: ENGINE_MEMORY_LEGEND_COLORS.l1,
    bg: 'rgba(34,184,181,0.14)',
    border: 'rgba(34,184,181,0.34)',
    active: '#31D4D0',
    glow: 'rgba(34,184,181,0.34)',
  },
  L0A: {
    chip: ENGINE_MEMORY_LEGEND_COLORS.l0,
    bg: 'rgba(29,183,217,0.14)',
    border: 'rgba(29,183,217,0.36)',
    active: '#3FD0EE',
    glow: 'rgba(29,183,217,0.34)',
  },
  L0B: {
    chip: '#17AFD2',
    bg: 'rgba(29,183,217,0.11)',
    border: 'rgba(29,183,217,0.31)',
    active: '#36C6E6',
    glow: 'rgba(29,183,217,0.30)',
  },
  L0C: {
    chip: '#129FC1',
    bg: 'rgba(29,183,217,0.09)',
    border: 'rgba(29,183,217,0.26)',
    active: '#2CBADA',
    glow: 'rgba(29,183,217,0.26)',
  },
  UB: {
    chip: '#55CAE6',
    bg: 'rgba(29,183,217,0.08)',
    border: 'rgba(29,183,217,0.24)',
    active: '#74DCF4',
    glow: 'rgba(29,183,217,0.22)',
  },
  DDR: {
    chip: ENGINE_MEMORY_LEGEND_COLORS.gm,
    bg: 'rgba(141,214,26,0.10)',
    border: 'rgba(141,214,26,0.28)',
    active: '#A7ED44',
    glow: 'rgba(141,214,26,0.26)',
  },
};
const TIER_COLORS = {
  L1:  MEMORY_TIER_VISUALS.L1.chip,
  L0A: MEMORY_TIER_VISUALS.L0A.chip,
  L0B: MEMORY_TIER_VISUALS.L0B.chip,
  L0C: MEMORY_TIER_VISUALS.L0C.chip,
  UB:  MEMORY_TIER_VISUALS.UB.chip,
  DDR: MEMORY_TIER_VISUALS.DDR.chip,
};

// Pixel grid config: rows × cols × bytes-per-cell
const BPG_CONFIG = {
  L1:  { rows: 8, cols: 8, bpc: 16384 },
  L0A: { rows: 4, cols: 4, bpc: 4096  },
  L0B: { rows: 4, cols: 4, bpc: 4096  },
  L0C: { rows: 8, cols: 8, bpc: 4096  },
  UB:  { rows: 8, cols: 8, bpc: 4096  },
};

// Tensor color palette (15 colors, assigned by sorted magic index)
const TENSOR_PALETTE = [
  '#1D4ED8', '#0284C7', '#0891B2', '#059669', '#D97706',
  '#7C3AED', '#DC2626', '#9333EA', '#D97706', '#0D9488',
  '#6D28D9', '#BE185D', '#1E40AF', '#065F46', '#92400E',
];

// UB vector ops (none in this graph, but defined for completeness)
const UB_VEC_OPS = new Set([]);

const OP_CATEGORY_COLOR = {
  'COPY_IN':    '#3577F6',
  'COPY_OUT':   '#3577F6',
  'L1_TO_L0A':  '#a78bfa',
  'L1_TO_L0B':  '#7c3aed',
  'A_MUL_B':    '#f97316',
  'A_MULACC_B': '#f97316',
};

// ops that operate on L0C output (no UB in this graph)
const CUBE_OPS = new Set(['A_MUL_B', 'A_MULACC_B']);
const ALLOC_OPS = new Set(['L1_ALLOC', 'L0A_ALLOC', 'L0B_ALLOC', 'L0C_ALLOC']);

/* ============================================================
   Build data structures
   ============================================================ */

// Map: magic → op
const opByMagic = new Map(OP_DATA.map(op => [op.m, op]));

// Build producer map: tensor magic → op that produces it
const tensorProducer = new Map();
for (const op of OP_DATA) {
  for (const t of op.o) {
    tensorProducer.set(t, op);
  }
}

/**
 * Determine which memory tier a tensor lives in.
 * Returns one of: 'L1', 'L0A', 'L0B', 'L0C', 'DDR'
 */
function getTensorTier(tensorMagic) {
  const tobe = TENSOR_TOBE.get(tensorMagic);
  if (tobe !== undefined) {
    return TOBE_TO_TIER[tobe] ?? 'DDR';
  }
  // Fallback: infer from producer op name
  const producer = tensorProducer.get(tensorMagic);
  if (!producer) return 'DDR';
  const n = producer.n;
  if (n === 'L1_TO_L0A') return 'L0A';
  if (n === 'L1_TO_L0B') return 'L0B';
  if (CUBE_OPS.has(n)) return 'L0C';
  if (n === 'COPY_IN') return 'L1';
  return 'DDR';
}

function getOpColor(opName) {
  return OP_CATEGORY_COLOR[opName] ?? '#6b7280';
}

function getOpCategory(opName) {
  if (opName === 'COPY_IN' || opName === 'COPY_OUT') return 'DMA';
  if (opName === 'L1_TO_L0A') return 'L1→L0A';
  if (opName === 'L1_TO_L0B') return 'L1→L0B';
  if (opName === 'A_MUL_B' || opName === 'A_MULACC_B') return 'Cube MMA';
  if (UB_VEC_OPS.has(opName)) return 'Vector UB';
  return 'Other';
}

function fmtBytes(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024)    return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

export {
  TOBE_TO_TIER, TIERS, TIER_CAPACITY, TIER_CAP_BYTES, TIER_COLORS,
  ENGINE_MEMORY_LEGEND_COLORS, TIER_ENGINE_GROUP, MEMORY_TIER_VISUALS,
  BPG_CONFIG, TENSOR_PALETTE, UB_VEC_OPS,
  OP_CATEGORY_COLOR, CUBE_OPS, ALLOC_OPS,
  opByMagic, tensorProducer,
  getTensorTier, getOpColor, getOpCategory, fmtBytes,
};

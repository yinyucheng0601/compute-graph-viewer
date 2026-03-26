import { OP_DATA, TENSOR_TOBE } from '../data/ops.js';

/* ============================================================
   Constants
   ============================================================ */

// tobe code -> tier name
const TOBE_TO_TIER = { 1: 'L1', 2: 'L0A', 3: 'L0B', 4: 'L0C', 15: 'DDR' };

const TIERS = ['L1', 'L0A', 'L0B', 'L0C'];  // on-chip tiers shown in arch diagram
const TIER_CAPACITY = { L1: 1024, L0A: 64, L0B: 64, L0C: 256 };
const TIER_COLORS = {
  L1:  '#3b82f6',
  L0A: '#a78bfa',
  L0B: '#7c3aed',
  L0C: '#f97316',
  DDR: '#6b7280',
};

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

export {
  TOBE_TO_TIER, TIERS, TIER_CAPACITY, TIER_COLORS,
  OP_CATEGORY_COLOR, CUBE_OPS, ALLOC_OPS,
  opByMagic, tensorProducer,
  getTensorTier, getOpColor,
};

import { OP_DATA } from '../data/ops.js';
import { ALLOC_OPS, opByMagic, getTensorTier } from './constants.js';

/* ============================================================
   Schedule — use natural JSON order (ops already in exec order)
   ALLOC ops have no operands, so they come first naturally.
   ============================================================ */

const EXEC_OP_DATA = OP_DATA.filter(op => {
  // Allocation markers don't touch tensors, so including them makes playback
  // look stalled while the graph advances.
  return !(ALLOC_OPS.has(op.n) && op.i.length === 0 && op.o.length === 0);
});

const SCHEDULE = EXEC_OP_DATA.map(op => op.m);

/* ============================================================
   Compute tensor liveness
   ============================================================ */
const scheduleIndexOf = new Map(SCHEDULE.map((m, i) => [m, i]));

const tensorBorn = new Map();
const tensorDies = new Map();

for (const op of EXEC_OP_DATA) {
  const stepDone = scheduleIndexOf.get(op.m) ?? 0;
  for (const t of op.o) {
    if (!tensorBorn.has(t)) tensorBorn.set(t, stepDone);
  }
}

for (const op of EXEC_OP_DATA) {
  const stepDone = scheduleIndexOf.get(op.m) ?? 0;
  for (const t of op.i) {
    const currentDies = tensorDies.get(t) ?? -1;
    if (stepDone > currentDies) tensorDies.set(t, stepDone);
  }
}

// Tensors with no consumer live until end
for (const [t, born] of tensorBorn) {
  if (!tensorDies.has(t)) tensorDies.set(t, SCHEDULE.length - 1);
}

/* ============================================================
   Query functions
   ============================================================ */
function getLiveTensorsAtStep(step) {
  const tiers = { L1: [], L0A: [], L0B: [], L0C: [], UB: [], DDR: [] };

  for (const [t, born] of tensorBorn) {
    const dies = tensorDies.get(t) ?? born;
    if (born <= step && step <= dies) {
      const tier = getTensorTier(t);
      if (tiers[tier]) tiers[tier].push(t);
    }
  }

  for (const k of Object.keys(tiers)) tiers[k].sort((a, b) => a - b);
  return tiers;
}

function getActiveTensors(step) {
  if (step < 0 || step >= SCHEDULE.length) return new Set();
  const op = opByMagic.get(SCHEDULE[step]);
  if (!op) return new Set();
  return new Set([...op.i, ...op.o]);
}

export { EXEC_OP_DATA, SCHEDULE, scheduleIndexOf, tensorBorn, tensorDies, getLiveTensorsAtStep, getActiveTensors };

/**
 * scan_passes.js — Scans output_deepseek/ and generates nav_index.json
 * Run: node scan_passes.js
 */

const fs   = require('fs');
const path = require('path');

const BASE       = 'output_deepseek';
const OUTPUT_DIR = path.join(__dirname, BASE);
const OUT_FILE   = path.join(__dirname, 'nav_index.json');

const STAGES = [
  { label: 'Tensor',        range: [0,   4],  color: '#87C80F' },
  { label: 'Tile',          range: [5,  26],  color: '#3577F6' },
  { label: 'Split',         range: [27, 27],  color: '#A855F7' },
  { label: 'Block/Execute', range: [28, 36],  color: '#C9107D' },
];

function getStage(idx) {
  return STAGES.find(s => idx >= s.range[0] && idx <= s.range[1])?.label ?? 'Unknown';
}

function walkDir(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else if (entry.name.endsWith('.json')) results.push(full);
  }
  return results;
}

// Parse filenames:
// Before_000_RemoveRedundantReshape_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json
// After_027_SubgraphToFunction_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4_ROOT.json
// After_028_InferParamIndex_TENSOR_..._PATH0_6_LEAF_program_id_01_<hash>.json
// Before_000_LoopUnroll_PROGRAM_ENTRY.json
function parseFileName(filePath) {
  const base = path.basename(filePath, '.json');

  // LoopUnroll PROGRAM_ENTRY special case
  const loopM = base.match(/^(Before|After)_(\d+)_(\w+)_PROGRAM_ENTRY$/);
  if (loopM) {
    return { side: loopM[1], passIndex: parseInt(loopM[2]), passName: loopM[3],
             funcName: 'PROGRAM_ENTRY', pathId: 'PROGRAM_ENTRY', snapType: 'main', programId: null };
  }

  // LEAF
  const leafM = base.match(/^(Before|After)_(\d+)_(.+?)_TENSOR_(.+?)_Unroll\d+_PATH(\d+)_(\d+)_LEAF_program_id_(\d+)_\d+$/);
  if (leafM) {
    return { side: leafM[1], passIndex: parseInt(leafM[2]), passName: leafM[3],
             funcName: leafM[4], pathId: `PATH${leafM[5]}_${leafM[6]}`, snapType: 'LEAF', programId: leafM[7] };
  }

  // ROOT
  const rootM = base.match(/^(Before|After)_(\d+)_(.+?)_TENSOR_(.+?)_Unroll\d+_PATH(\d+)_(\d+)_ROOT$/);
  if (rootM) {
    return { side: rootM[1], passIndex: parseInt(rootM[2]), passName: rootM[3],
             funcName: rootM[4], pathId: `PATH${rootM[5]}_${rootM[6]}`, snapType: 'ROOT', programId: null };
  }

  // Main
  const mainM = base.match(/^(Before|After)_(\d+)_(.+?)_TENSOR_(.+?)_Unroll\d+_PATH(\d+)_(\d+)$/);
  if (mainM) {
    return { side: mainM[1], passIndex: parseInt(mainM[2]), passName: mainM[3],
             funcName: mainM[4], pathId: `PATH${mainM[5]}_${mainM[6]}`, snapType: 'main', programId: null };
  }

  return null;
}

function pathSortKey(pathId) {
  if (pathId === 'PROGRAM_ENTRY') return 9999;
  const m = pathId.match(/_(\d+)$/);
  return m ? parseInt(m[1]) : 9998;
}

// ── Scan ──────────────────────────────────────────────────────────────────────

const passDirs = fs.readdirSync(OUTPUT_DIR)
  .filter(n => n.match(/^Pass_\d+_/))
  .sort();

const passes = [];

for (const dirName of passDirs) {
  const dirPath    = path.join(OUTPUT_DIR, dirName);
  const dirMatch   = dirName.match(/^Pass_(\d+)_(.+)$/);
  if (!dirMatch) continue;

  const passIndex  = parseInt(dirMatch[1]);
  const passName   = dirMatch[2];
  const stage      = getStage(passIndex);

  // Walk all JSON files in this pass directory (recursive for Pass_27)
  const jsonFiles  = walkDir(dirPath);

  // pathId → { funcName, snaps: Map<snapKey, {snap_type, program_id, before, after}> }
  const pathMap = new Map();

  for (const filePath of jsonFiles) {
    const parsed = parseFileName(filePath);
    if (!parsed) continue;

    const relPath = path.relative(__dirname, filePath).replace(/\\/g, '/');
    const { pathId, funcName, side, snapType, programId } = parsed;

    if (!pathMap.has(pathId)) pathMap.set(pathId, { funcName, snaps: new Map() });
    const pathEntry = pathMap.get(pathId);

    const snapKey = snapType === 'LEAF' ? `LEAF_${programId}` : snapType;
    if (!pathEntry.snaps.has(snapKey)) {
      pathEntry.snaps.set(snapKey, { snap_type: snapType, program_id: programId || null, before: null, after: null });
    }
    const snap = pathEntry.snaps.get(snapKey);
    if (side === 'Before') snap.before = relPath;
    else                   snap.after  = relPath;
  }

  if (pathMap.size === 0) continue;

  const paths = [...pathMap.entries()]
    .sort(([a], [b]) => pathSortKey(a) - pathSortKey(b))
    .map(([pathId, { funcName, snaps }]) => {
      const leafKeys  = [...snaps.keys()].filter(k => k.startsWith('LEAF_')).sort();
      const snapOrder = ['main', 'ROOT', ...leafKeys];
      const snapshots = snapOrder.filter(k => snaps.has(k)).map(k => snaps.get(k));
      return { path_id: pathId, path_label: funcName, snapshots };
    });

  passes.push({ pass_index: passIndex, pass_name: passName, dir: dirName, stage, paths });
}

const index = {
  generated_at: new Date().toISOString(),
  base_path: BASE,
  stages: STAGES,
  passes,
};

fs.writeFileSync(OUT_FILE, JSON.stringify(index, null, 2));
console.log(`✓ Written ${passes.length} passes → ${OUT_FILE}`);

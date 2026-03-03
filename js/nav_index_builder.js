/**
 * nav_index_builder.js — Build nav index in-browser from local folder entries.
 *
 * Input entry format:
 *   { relativePath: "Pass_00_xxx/After_...", ref: "local::..." }
 */
(function () {
  const STAGES = [
    { label: 'Tensor', range: [0, 4], color: '#6B92FF' },
    { label: 'Tile', range: [5, 27], color: '#6ADB02' },
    { label: 'Block/Execute', range: [28, 36], color: '#D8B900' },
  ];

  function getStage(idx) {
    return STAGES.find(s => idx >= s.range[0] && idx <= s.range[1])?.label ?? 'Unknown';
  }

  function normalizeSlashes(v) {
    return String(v || '').replace(/\\/g, '/');
  }

  function pathSortKey(pathId) {
    if (pathId === 'PROGRAM_ENTRY') return 9999;
    const m = String(pathId).match(/_(\d+)$/);
    return m ? parseInt(m[1], 10) : 9998;
  }

  function leafSortKey(snapKey) {
    const m = String(snapKey).match(/^LEAF_(\d+)$/);
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  }

  function findPassDir(relativePath) {
    const parts = normalizeSlashes(relativePath).split('/');
    const idx = parts.findIndex(p => /^Pass_\d+_/.test(p));
    if (idx < 0) return null;
    return {
      passDir: parts[idx],
      inPassPath: parts.slice(idx + 1).join('/'),
    };
  }

  // Parse filename patterns:
  // Before_000_RemoveRedundantReshape_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json
  // After_027_SubgraphToFunction_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4_ROOT.json
  // After_028_..._LEAF_program_id_01_XXXXXXXX.json
  // Before_000_LoopUnroll_PROGRAM_ENTRY.json
  function parseFileName(fileName) {
    const base = String(fileName || '').replace(/\.json$/i, '');

    // PROGRAM_ENTRY special case
    const loopM = base.match(/^(Before|After)_(\d+)_(.+?)_PROGRAM_ENTRY$/);
    if (loopM) {
      return {
        side: loopM[1],
        passIndex: parseInt(loopM[2], 10),
        passName: loopM[3],
        funcName: 'PROGRAM_ENTRY',
        pathId: 'PROGRAM_ENTRY',
        snapType: 'main',
        programId: null,
      };
    }

    // LEAF
    const leafM = base.match(
      /^(Before|After)_(\d+)_(.+?)_TENSOR_(.+?)_Unroll\d+_PATH(\d+)_(\d+)_LEAF_program_id_([A-Za-z0-9]+)_[A-Za-z0-9]+$/
    );
    if (leafM) {
      return {
        side: leafM[1],
        passIndex: parseInt(leafM[2], 10),
        passName: leafM[3],
        funcName: leafM[4],
        pathId: `PATH${leafM[5]}_${leafM[6]}`,
        snapType: 'LEAF',
        programId: leafM[7],
      };
    }

    // ROOT
    const rootM = base.match(
      /^(Before|After)_(\d+)_(.+?)_TENSOR_(.+?)_Unroll\d+_PATH(\d+)_(\d+)_ROOT$/
    );
    if (rootM) {
      return {
        side: rootM[1],
        passIndex: parseInt(rootM[2], 10),
        passName: rootM[3],
        funcName: rootM[4],
        pathId: `PATH${rootM[5]}_${rootM[6]}`,
        snapType: 'ROOT',
        programId: null,
      };
    }

    // Main
    const mainM = base.match(
      /^(Before|After)_(\d+)_(.+?)_TENSOR_(.+?)_Unroll\d+_PATH(\d+)_(\d+)$/
    );
    if (mainM) {
      return {
        side: mainM[1],
        passIndex: parseInt(mainM[2], 10),
        passName: mainM[3],
        funcName: mainM[4],
        pathId: `PATH${mainM[5]}_${mainM[6]}`,
        snapType: 'main',
        programId: null,
      };
    }

    return null;
  }

  function buildNavIndexFromFileEntries(entries, options = {}) {
    const passMap = new Map();

    for (const entry of entries || []) {
      const rel = normalizeSlashes(entry.relativePath || '');
      if (!rel.toLowerCase().endsWith('.json')) continue;

      const passInfo = findPassDir(rel);
      if (!passInfo) continue;

      const parsed = parseFileName(rel.split('/').pop());
      if (!parsed) continue;

      const dirMatch = passInfo.passDir.match(/^Pass_(\d+)_(.+)$/);
      if (!dirMatch) continue;

      const passKey = passInfo.passDir;
      if (!passMap.has(passKey)) {
        const passIndex = parseInt(dirMatch[1], 10);
        passMap.set(passKey, {
          pass_index: passIndex,
          pass_name: dirMatch[2],
          dir: passInfo.passDir,
          stage: getStage(passIndex),
          _pathMap: new Map(),
        });
      }

      const pass = passMap.get(passKey);
      const pathId = parsed.pathId;
      const snapKey = parsed.snapType === 'LEAF' ? `LEAF_${parsed.programId}` : parsed.snapType;

      if (!pass._pathMap.has(pathId)) {
        pass._pathMap.set(pathId, { funcName: parsed.funcName, snaps: new Map() });
      }
      const pathEntry = pass._pathMap.get(pathId);

      if (!pathEntry.snaps.has(snapKey)) {
        pathEntry.snaps.set(snapKey, {
          snap_type: parsed.snapType,
          program_id: parsed.programId || null,
          before: null,
          after: null,
        });
      }

      const snap = pathEntry.snaps.get(snapKey);
      const ref = entry.ref || rel;
      if (parsed.side === 'Before') snap.before = ref;
      else snap.after = ref;
    }

    const passes = [...passMap.values()]
      .sort((a, b) => {
        if (a.pass_index !== b.pass_index) return a.pass_index - b.pass_index;
        return a.pass_name.localeCompare(b.pass_name);
      })
      .map(pass => {
        const paths = [...pass._pathMap.entries()]
          .sort(([a], [b]) => pathSortKey(a) - pathSortKey(b))
          .map(([pathId, v]) => {
            const keys = [...v.snaps.keys()];
            const leafKeys = keys.filter(k => k.startsWith('LEAF_')).sort((a, b) => leafSortKey(a) - leafSortKey(b));
            const order = ['main', 'ROOT', ...leafKeys];
            const snapshots = order.filter(k => v.snaps.has(k)).map(k => v.snaps.get(k));
            return {
              path_id: pathId,
              path_label: v.funcName,
              snapshots,
            };
          });

        return {
          pass_index: pass.pass_index,
          pass_name: pass.pass_name,
          dir: pass.dir,
          stage: pass.stage,
          paths,
        };
      })
      .filter(p => p.paths.length > 0);

    return {
      generated_at: new Date().toISOString(),
      base_path: options.basePath || 'local',
      stages: STAGES,
      passes,
    };
  }

  window.buildNavIndexFromFileEntries = buildNavIndexFromFileEntries;
})();

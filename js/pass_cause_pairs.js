/**
 * pass_cause_pairs.js - Resolve Before/After pass pairs from Pass-IR nav data.
 */
(function () {
  function normalizeSnapshotKey(snapshot) {
    if (!snapshot) return 'main';
    if (snapshot.snap_type === 'LEAF') return `LEAF_${snapshot.program_id}`;
    return snapshot.snap_type || 'main';
  }

  function normalizePassName(name) {
    return String(name || '').replace(/\d+$/g, '');
  }

  function pairId(pass, path, snapshot) {
    const snapKey = normalizeSnapshotKey(snapshot);
    return [
      String(pass.pass_index).padStart(3, '0'),
      pass.pass_name,
      path.path_id,
      snapKey,
    ].join(':');
  }

  function passPairStatus(snapshot) {
    if (!snapshot?.before && !snapshot?.after) return 'unsupported';
    if (!snapshot.before) return 'missing-before';
    if (!snapshot.after) return 'missing-after';
    return 'ready';
  }

  function makeFileRef(ref, source) {
    if (!ref) return null;
    return {
      fileName: String(ref).split('/').pop().replace(/^local::/, ''),
      filePath: String(ref).replace(/^local::/, ''),
      ref,
      source: source || (String(ref).startsWith('local::') ? 'directory' : 'url'),
    };
  }

  function buildPairsFromNavIndex(navIndex) {
    const pairs = [];
    for (const pass of navIndex?.passes || []) {
      for (const path of pass.paths || []) {
        for (const snapshot of path.snapshots || []) {
          const snapKey = normalizeSnapshotKey(snapshot);
          const pair = {
            id: pairId(pass, path, snapshot),
            passIndex: pass.pass_index,
            passName: pass.pass_name,
            normalizedPassName: normalizePassName(pass.pass_name),
            stage: pass.stage || 'Unknown',
            functionName: path.path_label || '',
            pathId: path.path_id,
            snapshotKey: snapKey,
            beforeRef: makeFileRef(snapshot.before, 'directory'),
            afterRef: makeFileRef(snapshot.after, 'directory'),
            inferredBefore: false,
            status: passPairStatus(snapshot),
          };
          pairs.push(window.PtoPassCauseDumpSchema?.enrichPair?.(pair) || pair);
        }
      }
    }
    return pairs;
  }

  function buildPairsFromEntries(entries, navIndex) {
    if (navIndex) return buildPairsFromNavIndex(navIndex);
    if (typeof window.buildNavIndexFromFileEntries !== 'function') return [];
    return buildPairsFromNavIndex(window.buildNavIndexFromFileEntries(entries || []));
  }

  function resolvePair(query = {}, navIndex = null) {
    const pairs = buildPairsFromNavIndex(navIndex || query.navIndex || window.PtoPassIrNav?.getIndex?.());
    const qPassName = normalizePassName(query.passName);
    const qSnap = query.snapshotKey || 'main';
    return pairs.find(pair => {
      if (query.passIndex != null && pair.passIndex !== query.passIndex) return false;
      if (qPassName && normalizePassName(pair.passName) !== qPassName) return false;
      if (query.pathId && pair.pathId !== query.pathId) return false;
      if (qSnap && pair.snapshotKey !== qSnap) return false;
      return true;
    }) || null;
  }

  function getPairCoverage(pairs) {
    const list = pairs || [];
    const ready = list.filter(p => p.status === 'ready');
    const byPass = new Map();
    for (const pair of list) {
      const key = pair.passName;
      const stat = byPass.get(key) || { passName: key, total: 0, ready: 0, missing: 0 };
      stat.total += 1;
      if (pair.status === 'ready') stat.ready += 1;
      else stat.missing += 1;
      byPass.set(key, stat);
    }
    return {
      total: list.length,
      ready: ready.length,
      missing: list.length - ready.length,
      byPass: [...byPass.values()],
    };
  }

  window.PtoPassCausePairs = {
    buildPairsFromEntries,
    buildPairsFromNavIndex,
    resolvePair,
    getPairCoverage,
    normalizePassName,
  };
})();

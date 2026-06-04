/**
 * pass_cause_dump_schema.js - Parse PyPTO pass dump paths and enrich pairs.
 */
(function () {
  function stripLocalRef(value) {
    return String(value || '').replace(/^local::/, '').replace(/\\/g, '/');
  }

  function basename(value) {
    return stripLocalRef(value).split('/').pop() || '';
  }

  function parsePassDir(path) {
    const parts = stripLocalRef(path).split('/');
    const dir = parts.find(part => /^Pass_\d+_/.test(part));
    if (!dir) return null;
    const match = dir.match(/^Pass_(\d+)_(.+)$/);
    if (!match) return null;
    return {
      dir,
      dirIndex: Number(match[1]),
      passClassName: match[2],
    };
  }

  function parseSnapshotFile(fileName) {
    const base = basename(fileName).replace(/\.json$/i, '');
    const head = base.match(/^(Before|After)_(\d+)_(.+?)_(.+)$/);
    if (!head) return null;

    const side = head[1];
    const fileIndex = Number(head[2]);
    const identifier = head[3];
    const rest = head[4];

    if (rest === 'PROGRAM_ENTRY') {
      return {
        side,
        fileIndex,
        identifier,
        functionMagicName: 'PROGRAM_ENTRY',
        pathId: 'PROGRAM_ENTRY',
        targetKind: 'current',
        snapshotKey: 'main',
        leafProgramId: null,
        leafHash: null,
      };
    }

    const leaf = rest.match(/^TENSOR_(.+?)_Unroll\d+_PATH(\d+)_(\d+)_LEAF_program_id_([A-Za-z0-9]+)_([A-Za-z0-9]+)$/);
    if (leaf) {
      return {
        side,
        fileIndex,
        identifier,
        functionMagicName: leaf[1],
        pathId: `PATH${leaf[2]}_${leaf[3]}`,
        targetKind: 'leaf',
        snapshotKey: `LEAF_${leaf[4]}`,
        leafProgramId: leaf[4],
        leafHash: leaf[5],
      };
    }

    const root = rest.match(/^TENSOR_(.+?)_Unroll\d+_PATH(\d+)_(\d+)_ROOT$/);
    if (root) {
      return {
        side,
        fileIndex,
        identifier,
        functionMagicName: root[1],
        pathId: `PATH${root[2]}_${root[3]}`,
        targetKind: 'root',
        snapshotKey: 'ROOT',
        leafProgramId: null,
        leafHash: null,
      };
    }

    const main = rest.match(/^TENSOR_(.+?)_Unroll\d+_PATH(\d+)_(\d+)$/);
    if (main) {
      return {
        side,
        fileIndex,
        identifier,
        functionMagicName: main[1],
        pathId: `PATH${main[2]}_${main[3]}`,
        targetKind: 'current',
        snapshotKey: 'main',
        leafProgramId: null,
        leafHash: null,
      };
    }

    return {
      side,
      fileIndex,
      identifier,
      functionMagicName: rest,
      pathId: '',
      targetKind: 'unknown',
      snapshotKey: 'main',
      leafProgramId: null,
      leafHash: null,
    };
  }

  function parseSnapshotRef(ref) {
    const filePath = stripLocalRef(ref);
    const file = parseSnapshotFile(filePath);
    const dir = parsePassDir(filePath);
    if (!file && !dir) return null;
    const passClassName = dir?.passClassName || file?.identifier || '';
    const sourceSchema = window.PtoPassCauseSourceSchema?.getPassSchema?.(passClassName)
      || window.PtoPassCauseSourceSchema?.getPassSchema?.(file?.identifier)
      || null;
    return {
      path: filePath,
      basename: basename(filePath),
      ...dir,
      ...file,
      runtimeIndex: file?.fileIndex ?? dir?.dirIndex ?? null,
      passClassName,
      sourceSchema,
    };
  }

  function graphSummary(graph) {
    const nodes = graph?.nodes || [];
    const edges = graph?.edges || [];
    return {
      nodes: nodes.length,
      ops: nodes.filter(node => node.type === 'op').length,
      tensors: nodes.filter(node => node.type === 'tensor' || node.type === 'incast' || node.type === 'outcast').length,
      incasts: nodes.filter(node => node.type === 'incast').length,
      outcasts: nodes.filter(node => node.type === 'outcast').length,
      edges: edges.length,
    };
  }

  function enrichPair(pair) {
    const beforeDump = parseSnapshotRef(pair?.beforeRef?.ref || pair?.beforeRef?.filePath || '');
    const afterDump = parseSnapshotRef(pair?.afterRef?.ref || pair?.afterRef?.filePath || '');
    const schema = window.PtoPassCauseSourceSchema?.getPassSchema?.(pair?.passName)
      || beforeDump?.sourceSchema
      || afterDump?.sourceSchema
      || null;
    return {
      ...pair,
      runtimeIndex: afterDump?.runtimeIndex ?? beforeDump?.runtimeIndex ?? pair?.passIndex ?? null,
      dirIndex: afterDump?.dirIndex ?? beforeDump?.dirIndex ?? pair?.passIndex ?? null,
      identifier: afterDump?.identifier ?? beforeDump?.identifier ?? pair?.passName ?? '',
      passClassName: afterDump?.passClassName ?? beforeDump?.passClassName ?? pair?.passName ?? '',
      targetKind: afterDump?.targetKind ?? beforeDump?.targetKind ?? 'current',
      leafProgramId: afterDump?.leafProgramId ?? beforeDump?.leafProgramId ?? null,
      leafHash: afterDump?.leafHash ?? beforeDump?.leafHash ?? null,
      functionMagicName: afterDump?.functionMagicName ?? beforeDump?.functionMagicName ?? pair?.functionName ?? '',
      dump: { before: beforeDump, after: afterDump },
      sourceSchema: schema,
      coverageTier: schema?.coverageTier || 'uncovered',
    };
  }

  window.PtoPassCauseDumpSchema = {
    stripLocalRef,
    basename,
    parsePassDir,
    parseSnapshotFile,
    parseSnapshotRef,
    graphSummary,
    enrichPair,
  };
})();

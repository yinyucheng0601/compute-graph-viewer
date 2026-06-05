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

    const tensor = rest.match(/^TENSOR_(.+?)_Unroll\d+_PATH(\d+)(?:_hiddenfunc(\d+))?_(\d+)(?:_(ROOT)|_LEAF_program_id_([A-Za-z0-9]+)_([A-Za-z0-9]+))?$/);
    if (tensor) {
      const functionMagicName = tensor[3] != null ? `${tensor[1]} hiddenfunc${tensor[3]}` : tensor[1];
      const pathId = `PATH${tensor[2]}_${tensor[4]}`;
      if (tensor[6]) {
        return {
          side,
          fileIndex,
          identifier,
          functionMagicName,
          pathId,
          targetKind: 'leaf',
          snapshotKey: `LEAF_${tensor[6]}`,
          leafProgramId: tensor[6],
          leafHash: tensor[7],
        };
      }
      if (tensor[5] === 'ROOT') {
        return {
          side,
          fileIndex,
          identifier,
          functionMagicName,
          pathId,
          targetKind: 'root',
          snapshotKey: 'ROOT',
          leafProgramId: null,
          leafHash: null,
        };
      }
      return {
        side,
        fileIndex,
        identifier,
        functionMagicName,
        pathId,
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

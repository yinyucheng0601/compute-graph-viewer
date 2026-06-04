/**
 * pass_cause_semantic.js - Standalone semantic color helpers for explain.html.
 *
 * The original pass-ir page keeps this logic inside app.js.  The explainer page
 * intentionally does not load app.js, so it needs the same semantic key path in
 * a small module.
 */
(function () {
  const BOUNDARY_COLORS = { incast: '#87c80f', outcast: '#c9107d' };

  const OPCODE_SEMANTIC_LABELS = {
    VIEW: 'View',
    RESHAPE: 'Reshape',
    ASSEMBLE: 'Assemble',
    REGISTER_COPY: 'Copy',
    INDEX_OUTCAST: 'Outcast',
    A_MUL_B: 'Matmul',
    ROWSUM_SINGLE: 'Reduce',
    ROWMAX_SINGLE: 'Reduce',
    CAST: 'Cast',
    SQRT: 'Special Math',
    VEC_DUP: 'Broadcast',
    ADD: 'Add',
    ADDS: 'Add',
    SUB: 'Subtract',
    MUL: 'Multiply',
    MULS: 'Multiply',
    DIV: 'Divide',
    ABS: 'Abs',
  };

  function titleCaseToken(token) {
    return String(token || '')
      .toLowerCase()
      .split(/[_\s]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function semanticLabelFromCategoryKey(categoryKey) {
    if (!categoryKey || typeof categoryKey !== 'string') return '';
    if (categoryKey.startsWith('op:')) return titleCaseToken(categoryKey.slice(3));
    if (!categoryKey.startsWith('cat:')) return titleCaseToken(categoryKey);
    const inner = categoryKey.slice(4);
    switch (inner) {
      case 'MEMORY': return 'Memory';
      case 'MATMUL': return 'Matmul';
      case 'ELEMENTWISE': return 'Elementwise';
      case 'REDUCE': return 'Reduce';
      case 'SPECIAL_MATH': return 'Special Math';
      case 'CAST': return 'Cast';
      case 'COMMS': return 'Data Movement';
      default: return titleCaseToken(inner);
    }
  }

  function resolvedSemanticLabel(node) {
    const d = node?.data || {};
    return d.semanticLabel || d.inferredSemanticLabel || null;
  }

  function inferSemanticLabelForOp(node) {
    if (!node || node.type !== 'op') return null;
    const explicit = node.data?.semanticLabel;
    if (explicit) return explicit;

    const opcode = String(node.data?.opcode || '').toUpperCase();
    if (OPCODE_SEMANTIC_LABELS[opcode]) return OPCODE_SEMANTIC_LABELS[opcode];

    if (typeof opcodeToCategory === 'function') {
      const categoryLabel = semanticLabelFromCategoryKey(opcodeToCategory(opcode));
      if (categoryLabel) return categoryLabel;
    }

    return opcode ? titleCaseToken(opcode) : null;
  }

  function annotateGraph(graphModel) {
    if (!graphModel?.nodes?.length) return graphModel;
    graphModel.nodes.forEach(node => {
      if (!node?.data) node.data = {};
      if (node.type === 'op' && !node.data.inferredSemanticLabel) {
        node.data.inferredSemanticLabel = inferSemanticLabelForOp(node);
      }
    });
    return graphModel;
  }

  function semanticKeyForNode(node) {
    if (!node) return null;
    if (node.type === 'group') return node.data?.semanticKey || (node.data?.groupType === 'tensor' ? 'tensor' : null);
    if (node.type === 'op') {
      const semantic = resolvedSemanticLabel(node);
      if (semantic) return 'sem:' + semantic;
      if (typeof getSemanticKey === 'function') return getSemanticKey(node);
      return typeof opcodeToCategory === 'function' ? opcodeToCategory(node.data?.opcode) : 'cat:UNKNOWN';
    }
    if (node.type === 'incast') return 'boundary:incast';
    if (node.type === 'outcast') return 'boundary:outcast';
    return 'tensor';
  }

  function collectGraphSemanticKeys(graphModel) {
    const keys = [];
    (graphModel?.nodes || []).forEach(node => {
      const key = semanticKeyForNode(node);
      if (key) keys.push(key);
      if (node.type === 'group' && Array.isArray(node.data?.members)) {
        node.data.members.forEach(member => {
          if (member?.semanticKey) keys.push(member.semanticKey);
        });
      }
    });
    return keys;
  }

  function buildSemanticPipelineColorMap(keys) {
    const pipelineStages = {};
    const genericKeys = [];
    [...new Set(keys)].forEach(key => {
      if (typeof key !== 'string') return;
      if (!key.startsWith('sem:')) {
        genericKeys.push(key);
        return;
      }
      const parsed = typeof parsePipelineLabel === 'function' ? parsePipelineLabel(key) : null;
      if (!parsed) {
        genericKeys.push(key);
        return;
      }
      const { pipeline, stage } = parsed;
      if (!pipelineStages[pipeline]) pipelineStages[pipeline] = [];
      if (!pipelineStages[pipeline].includes(stage)) pipelineStages[pipeline].push(stage);
    });

    const keyColorMap = new Map();
    Object.entries(pipelineStages).forEach(([pipeline, stages]) => {
      const baseHue = PIPELINE_HUES?.[pipeline] ? PIPELINE_HUES[pipeline].h * 360 : 220;
      const laneColors = typeof getLaneColors === 'function'
        ? getLaneColors(Math.max(1, stages.length), baseHue, 30)
        : stages.map(() => '#666666');
      stages.forEach((stage, idx) => {
        keyColorMap.set(`sem:${pipeline}-${stage}`, laneColors[idx] || '#666666');
      });
    });

    const genericPalette = typeof buildColorMap === 'function'
      ? buildColorMap([...new Set(genericKeys)].sort((a, b) => String(a).localeCompare(String(b))))
      : new Map();
    genericPalette.forEach((color, key) => {
      if (!keyColorMap.has(key)) keyColorMap.set(key, color);
    });

    return keyColorMap;
  }

  function semanticColorForKey(key, pipelineColorMap) {
    if (!key) return '#666666';
    if (key === 'tensor') return '#727272';
    if (key === 'boundary:incast') return BOUNDARY_COLORS.incast;
    if (key === 'boundary:outcast') return BOUNDARY_COLORS.outcast;
    if (pipelineColorMap?.has(key)) return pipelineColorMap.get(key) || '#666666';
    return '#666666';
  }

  function buildNodeColorMap(graphModel) {
    annotateGraph(graphModel);
    const pipelineMap = buildSemanticPipelineColorMap(collectGraphSemanticKeys(graphModel));
    const nodeIdMap = new Map();
    (graphModel?.nodes || []).forEach(node => {
      nodeIdMap.set(node.id, semanticColorForKey(semanticKeyForNode(node), pipelineMap));
    });
    return nodeIdMap;
  }

  function summarizePipelines(graphModel) {
    const counts = new Map();
    (graphModel?.nodes || []).forEach(node => {
      if (node.type !== 'op') return;
      const key = semanticKeyForNode(node);
      const parsed = typeof parsePipelineLabel === 'function' ? parsePipelineLabel(key) : null;
      if (!parsed) return;
      counts.set(parsed.pipeline, (counts.get(parsed.pipeline) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  window.PtoPassCauseSemantic = {
    annotateGraph,
    semanticKeyForNode,
    buildNodeColorMap,
    summarizePipelines,
  };
})();

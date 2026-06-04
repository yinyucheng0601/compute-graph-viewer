/**
 * pass_cause_explainer.js - Orchestrate pair loading, diffing, and rule explanations.
 */
(function () {
  const RULE_COVERED_PASSES = new Set([
    'RemoveRedundantReshape',
    'DuplicateOp',
    'MergeViewAssemble',
    'RemoveRedundantOp',
  ]);

  function normalizePassName(name) {
    return window.PtoPassCausePairs?.normalizePassName?.(name) || String(name || '');
  }

  function parseGraphData(data) {
    if (typeof parseGraph !== 'function') {
      throw new Error('parseGraph 不可用');
    }
    const graph = enrichGraphRawFields(parseGraph(data), data);
    return window.PtoPassCauseSemantic?.annotateGraph?.(graph) || graph;
  }

  function enrichGraphRawFields(graph, data) {
    const func = data?.functions?.[0];
    if (!func || !graph?.nodes) return graph;
    const tensorByMagic = new Map((func.tensors || []).map(tensor => [tensor.magic, tensor]));
    const rawByMagic = new Map((func.rawtensors || []).map(raw => [raw.rawmagic, raw]));
    const opByMagic = new Map((func.operations || []).map(op => [op.opmagic, op]));

    graph.nodes.forEach(node => {
      const d = node.data || {};
      if (node.type === 'op') {
        const op = opByMagic.get(d.magic);
        if (!op) return;
        d.opAttr = op.op_attr || op.attr || op.attrs || d.opAttr || {};
        d.attr = op.attr || op.attrs || {};
        d.staticAttr = op.static_attr || op.staticAttr || null;
        d.syncQueue = op.sync_queue || op.syncQueue || null;
        d.rawRef = { functionIndex: 0, collection: 'operations', magicField: 'opmagic', magic: d.magic };
        d.rawOperation = op;
        return;
      }

      const tensor = tensorByMagic.get(d.magic);
      if (!tensor) return;
      const raw = rawByMagic.get(tensor.rawtensor) || {};
      d.validShape = tensor.validshape || tensor.valid_shape || tensor.validShape || [];
      d.dynValidShape = tensor.dynvalidshape || tensor.dyn_validshape || tensor.dynValidShape || [];
      d.rawTensor = tensor.rawtensor;
      d.nodeTypeRaw = tensor.nodetype || tensor.node_type || null;
      d.memRange = tensor.mem_range || tensor.memoryrange || tensor.memory_range || null;
      d.subgraphBoundary = tensor.subgraph_boundary || tensor.boundary || tensor.is_boundary || null;
      d.rawRef = { functionIndex: 0, collection: 'tensors', magicField: 'magic', magic: d.magic };
      d.rawTensorMeta = raw;
    });
    return graph;
  }

  function readPairGraph(pair) {
    if (!window.PtoPassIrState?.readJsonRef) {
      return Promise.reject(new Error('Pass-IR 文件读取器不可用'));
    }
    if (!pair?.beforeRef?.ref || !pair?.afterRef?.ref) {
      return Promise.reject(new Error('Before/After 配对不完整'));
    }
    return Promise.all([
      window.PtoPassIrState.readJsonRef(pair.beforeRef.ref),
      window.PtoPassIrState.readJsonRef(pair.afterRef.ref),
    ]).then(([beforeData, afterData]) => ({
      beforeData,
      afterData,
      beforeGraph: parseGraphData(beforeData),
      afterGraph: parseGraphData(afterData),
    }));
  }

  function makeContext(pair, diff) {
    let seq = 0;
    return {
      pair,
      diff,
      nextExplanationIndex() {
        seq += 1;
        return seq;
      },
    };
  }

  function collectMatched(explanations) {
    const nodeIds = new Set();
    const edgeIds = new Set();
    for (const explanation of explanations || []) {
      (explanation.nodeIds || []).forEach(id => nodeIds.add(id));
      (explanation.edgeIds || []).forEach(id => edgeIds.add(id));
    }
    return { nodeIds, edgeIds };
  }

  function sourceSchemaFor(pair) {
    return pair?.sourceSchema
      || window.PtoPassCauseSourceSchema?.getPassSchema?.(pair?.passName)
      || null;
  }

  function compactNodeList(nodes, limit = 12) {
    const list = (nodes || []).slice(0, limit).map(node => node.id);
    const rest = Math.max(0, (nodes || []).length - list.length);
    return { list, rest };
  }

  function makeUnexplained(context, explanations) {
    const matched = collectMatched(explanations);
    const added = context.diff.nodes.added.filter(node => !matched.nodeIds.has(node.id));
    const removed = context.diff.nodes.removed.filter(node => !matched.nodeIds.has(node.id));
    const modified = context.diff.nodes.modified.map(item => item.after).filter(node => !matched.nodeIds.has(node.id));
    const addedEdges = context.diff.edges.added.filter(edge => !matched.edgeIds.has(window.PtoPassCauseDiff.edgeId(edge)));
    const removedEdges = context.diff.edges.removed.filter(edge => !matched.edgeIds.has(window.PtoPassCauseDiff.edgeId(edge)));

    const count = added.length + removed.length + modified.length + addedEdges.length + removedEdges.length;
    if (!count) return null;

    const addedCompact = compactNodeList(added);
    const removedCompact = compactNodeList(removed);
    const modifiedCompact = compactNodeList(modified);
    const nodeIds = [...addedCompact.list, ...removedCompact.list, ...modifiedCompact.list];
    const focusSide = removed.length && !added.length && !modified.length ? 'before' : 'after';

    return {
      id: `unexplained.${context.nextExplanationIndex()}`,
      pairId: context.pair?.id || '',
      ruleId: 'unexplained',
      passName: context.pair?.passName || '',
      title: '未解释的结构变化',
      summary: '这些图变化能在 Before/After diff 中看到，但当前 MVP 规则还没有从源码逻辑匹配到原因。',
      confidence: 'unexplained',
      changeType: 'unexplained',
      focusSide,
      sideMode: focusSide,
      nodeIds,
      edgeIds: [
        ...addedEdges.slice(0, 12).map(window.PtoPassCauseDiff.edgeId),
        ...removedEdges.slice(0, 12).map(window.PtoPassCauseDiff.edgeId),
      ],
      before: {
        graphRef: context.pair?.beforeRef?.ref || '',
        primaryNodeIds: removedCompact.list,
        edgeIds: removedEdges.slice(0, 12).map(window.PtoPassCauseDiff.edgeId),
        badges: Object.fromEntries(removedCompact.list.map(id => [id, '删除'])),
        dimOthers: true,
      },
      after: {
        graphRef: context.pair?.afterRef?.ref || '',
        primaryNodeIds: [...addedCompact.list, ...modifiedCompact.list],
        edgeIds: addedEdges.slice(0, 12).map(window.PtoPassCauseDiff.edgeId),
        badges: Object.fromEntries(addedCompact.list.map(id => [id, '新增'])),
        dimOthers: true,
      },
      transition: null,
      counts: {
        addedNodes: added.length,
        removedNodes: removed.length,
        modifiedNodes: modified.length,
        addedEdges: addedEdges.length,
        removedEdges: removedEdges.length,
        hiddenAddedNodes: addedCompact.rest,
        hiddenRemovedNodes: removedCompact.rest,
      },
      evidence: [
        { label: '新增节点', value: String(added.length) },
        { label: '删除节点', value: String(removed.length) },
        { label: '修改节点', value: String(modified.length) },
        { label: '新增边', value: String(addedEdges.length) },
        { label: '删除边', value: String(removedEdges.length) },
      ],
      source: null,
    };
  }

  function sideForGroup(group) {
    if (group.changeKind === 'remove-chain') return 'before';
    if (group.changeKind === 'add-chain') return 'after';
    return group.side === 'before' ? 'before' : 'after';
  }

  function stepTitleForGroup(group, schema) {
    const category = window.PtoPassCauseSourceSchema?.categoryLabel?.(schema?.category) || schema?.category || '变化';
    if (group.changeKind === 'remove-chain') return `${schema?.name || 'Pass'} 删除链路：${group.title}`;
    if (group.changeKind === 'add-chain') return `${schema?.name || 'Pass'} 新增链路：${group.title}`;
    if (group.changeKind === 'field-update') return `${schema?.name || 'Pass'} 更新字段：${group.title}`;
    return `${schema?.name || 'Pass'} ${category} diff`;
  }

  function makeSchemaStep(context, schema, group) {
    const side = sideForGroup(group);
    const beforePrimary = group.changeKind === 'add-chain' ? [] : (group.memberNodeIds || []).slice(0, 40);
    const afterPrimary = group.changeKind === 'remove-chain'
      ? [
          ...(group.afterBoundary?.consumerOpIds || []),
          ...(group.afterBoundary?.replacementTensorIds || []),
        ].slice(0, 40)
      : (group.memberNodeIds || []).slice(0, 40);
    const beforeEdgeIds = (group.memberEdgeIds || []).slice(0, 60);
    const afterEdgeIds = group.changeKind === 'remove-chain'
      ? (group.afterBoundary?.replacementEdgeIds || []).slice(0, 60)
      : (group.memberEdgeIds || []).slice(0, 60);
    const removedOps = Math.abs(group.countDelta?.ops || 0);
    const removedTensors = Math.abs(group.countDelta?.tensors || 0);
    const removedEdges = Math.abs(group.countDelta?.edges || 0);
    const addedOps = Math.max(0, group.countDelta?.ops || 0);
    const addedTensors = Math.max(0, group.countDelta?.tensors || 0);
    const opcodeText = Object.entries(group.opcodeHistogram || {})
      .map(([op, count]) => `${op} ${count}`)
      .join(', ');

    return {
      id: `schema.${context.nextExplanationIndex()}.${group.id}`,
      pairId: context.pair?.id || '',
      ruleId: `schema.${schema?.name || 'unknown'}`,
      passName: context.pair?.passName || schema?.name || '',
      confidence: schema?.coverageTier === 'rule' ? 'source-rule fallback' : 'schema-diff',
      changeType: group.changeKind,
      focusSide: side,
      sideMode: group.changeKind === 'remove-chain' ? 'split' : side,
      title: stepTitleForGroup(group, schema),
      summary: schema?.narrativeTemplate || '当前 step 来自 Before/After diff group，源码规则尚未细化。',
      nodeIds: [...new Set([...(beforePrimary || []), ...(afterPrimary || [])])],
      edgeIds: [...new Set([...(beforeEdgeIds || []), ...(afterEdgeIds || [])])],
      before: {
        graphRef: context.pair?.beforeRef?.ref || '',
        primaryNodeIds: beforePrimary,
        edgeIds: beforeEdgeIds,
        badges: Object.fromEntries(beforePrimary.slice(0, 20).map(id => [id, group.changeKind === 'remove-chain' ? '删除' : 'Before'])),
        dimOthers: true,
      },
      after: {
        graphRef: context.pair?.afterRef?.ref || '',
        primaryNodeIds: afterPrimary,
        edgeIds: afterEdgeIds,
        badges: Object.fromEntries(afterPrimary.slice(0, 20).map(id => [id, group.changeKind === 'remove-chain' ? '改接/保留' : 'After'])),
        dimOthers: true,
      },
      transition: {
        type: group.changeKind === 'remove-chain' ? 'remove-and-rewire' : group.changeKind,
        fromNodeIds: beforePrimary,
        toNodeIds: afterPrimary,
        removedEdgeIds: group.changeKind === 'remove-chain' ? beforeEdgeIds : [],
        addedEdgeIds: afterEdgeIds,
        durationMs: 900,
      },
      counts: {
        removedOps: group.changeKind === 'remove-chain' ? removedOps : 0,
        removedTensors: group.changeKind === 'remove-chain' ? removedTensors : 0,
        removedEdges: group.changeKind === 'remove-chain' ? removedEdges : 0,
        addedOps,
        addedTensors,
        fieldChanges: group.fieldChangeIds?.length || 0,
        netNodes: (group.countDelta?.ops || 0) + (group.countDelta?.tensors || 0),
      },
      evidence: [
        ...(opcodeText ? [{ label: 'opcode', value: opcodeText }] : []),
        { label: '变化类型', value: group.changeKind },
        { label: '影响节点', value: String((group.memberNodeIds || []).length) },
        { label: '影响边', value: String((group.memberEdgeIds || []).length) },
      ],
      source: schema?.source || null,
    };
  }

  function makeSchemaDriven(context, schema, matchedExplanations) {
    const matched = collectMatched(matchedExplanations || []);
    const groups = (context.diff.groups || []).filter(group => {
      const groupNodes = group.memberNodeIds || [];
      if (!groupNodes.length) return true;
      return groupNodes.some(id => !matched.nodeIds.has(id));
    });
    return groups.slice(0, 16).map(group => makeSchemaStep(context, schema, group));
  }

  function summarize(explanations, diff, pair) {
    const explained = explanations.filter(item => item.confidence !== 'unexplained');
    const unexplained = explanations.filter(item => item.confidence === 'unexplained');
    const schema = sourceSchemaFor(pair);
    const coverage = window.PtoPassCauseSourceSchema?.coverageLabel?.(schema?.coverageTier) || '未覆盖';
    return {
      passName: pair?.passName || '',
      pairId: pair?.id || '',
      sourceSchema: schema,
      coverageTier: schema?.coverageTier || 'uncovered',
      coverageLabel: coverage,
      totalSteps: explanations.length,
      explainedSteps: explained.length,
      unexplainedSteps: unexplained.length,
      changeStats: { ...diff.stats },
      graphCounts: diff.graphCounts,
      headline: explanations.length
        ? `${coverage} · ${explained.length}/${explanations.length} 个步骤已解释`
        : '没有结构变化',
    };
  }

  function runRules(pair, diff) {
    const rules = window.PtoPassCauseRules?.rulesForPass?.(pair.passName) || [];
    const schema = sourceSchemaFor(pair);
    const context = makeContext(pair, diff);
    const explanations = [];
    for (const rule of rules) {
      const matches = rule.match(context, rule) || [];
      explanations.push(...matches);
    }
    if (schema) explanations.push(...makeSchemaDriven(context, schema, explanations));
    const unexplained = makeUnexplained(context, explanations);
    if (unexplained) explanations.push(unexplained);
    return {
      explanations,
      rules,
      summary: summarize(explanations, diff, pair),
    };
  }

  function explainGraphs(pair, beforeGraph, afterGraph) {
    const diff = window.PtoPassCauseDiff.computeGraphDiff(beforeGraph, afterGraph, pair);
    const normalizedPass = normalizePassName(pair?.passName);
    const schema = sourceSchemaFor(pair);
    const covered = !!schema;
    const ruleResult = runRules(pair, diff);

    return {
      pair,
      beforeGraph,
      afterGraph,
      diff,
      covered,
      coverageTier: schema?.coverageTier || 'uncovered',
      sourceSchema: schema,
      rules: ruleResult.rules,
      explanations: ruleResult.explanations,
      summary: ruleResult.summary || summarize(ruleResult.explanations, diff, pair),
      generatedAt: Date.now(),
    };
  }

  function explainPair(pair) {
    if (!pair) return Promise.reject(new Error('缺少 Pass 配对'));
    if (pair.status !== 'ready') {
      return Promise.resolve({
        pair,
        beforeGraph: null,
        afterGraph: null,
        diff: null,
        covered: !!sourceSchemaFor(pair),
        rules: [],
        explanations: [],
        summary: {
          passName: pair.passName,
          pairId: pair.id,
          totalSteps: 0,
          explainedSteps: 0,
          unexplainedSteps: 0,
          changeStats: null,
          headline: `配对状态：${pair.status}`,
        },
        generatedAt: Date.now(),
      });
    }
    return readPairGraph(pair).then(({ beforeGraph, afterGraph }) => explainGraphs(pair, beforeGraph, afterGraph));
  }

  window.PtoPassCauseExplainer = {
    MVP_PASSES: RULE_COVERED_PASSES,
    RULE_COVERED_PASSES,
    explainPair,
    explainGraphs,
    normalizePassName,
  };
})();

/**
 * pass_cause_diff.js - Compute structural graph diffs for Pass cause rules.
 */
(function () {
  function edgeId(edge) {
    return `${edge.source}->${edge.target}`;
  }

  function tensorId(magic) {
    return magic == null ? null : `t_${magic}`;
  }

  function opcode(node) {
    return String(node?.data?.opcode || node?.label || '').toUpperCase();
  }

  function nodeKind(node) {
    return node?.type === 'op' ? 'op' : 'tensor';
  }

  function stableJson(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (typeof value === 'object') {
      return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function comparableNode(node) {
    const d = node?.data || {};
    if (node?.type === 'op') {
      return {
        type: node.type,
        label: node.label,
        opcode: d.opcode,
        ioperands: d.ioperands || [],
        ooperands: d.ooperands || [],
        latency: d.latency ?? null,
        semanticLabel: d.semanticLabel || '',
        opAttr: d.opAttr || {},
      };
    }
    return {
      type: node?.type,
      label: node?.label,
      shape: d.shape || [],
      rawShape: d.rawShape || [],
      validShape: d.validShape || d.validshape || [],
      dynValidShape: d.dynValidShape || d.dynvalidshape || [],
      offset: d.offset || [],
      rawtensor: d.rawtensor ?? d.rawTensor ?? null,
      symbol: d.symbol || '',
      nodetype: d.nodetype || d.nodeType || d.kind || null,
      memType: d.memType || null,
      memId: d.memId ?? null,
      memRange: d.memRange || null,
      subgraphBoundary: d.subgraphBoundary || null,
    };
  }

  function nodeChanged(beforeNode, afterNode) {
    return stableJson(comparableNode(beforeNode)) !== stableJson(comparableNode(afterNode));
  }

  function buildGraphIndex(graph) {
    const nodeById = new Map((graph?.nodes || []).map(node => [node.id, node]));
    const edgeById = new Map((graph?.edges || []).map(edge => [edgeId(edge), edge]));
    const inEdgesByTarget = new Map();
    const outEdgesBySource = new Map();
    for (const edge of graph?.edges || []) {
      if (!inEdgesByTarget.has(edge.target)) inEdgesByTarget.set(edge.target, []);
      if (!outEdgesBySource.has(edge.source)) outEdgesBySource.set(edge.source, []);
      inEdgesByTarget.get(edge.target).push(edge);
      outEdgesBySource.get(edge.source).push(edge);
    }
    return { nodeById, edgeById, inEdgesByTarget, outEdgesBySource };
  }

  function consumersOf(index, tensorNodeId) {
    return (index.outEdgesBySource.get(tensorNodeId) || [])
      .map(edge => index.nodeById.get(edge.target))
      .filter(node => node?.type === 'op');
  }

  function producerOf(index, tensorNodeId) {
    const edge = (index.inEdgesByTarget.get(tensorNodeId) || [])
      .find(item => index.nodeById.get(item.source)?.type === 'op');
    return edge ? index.nodeById.get(edge.source) : null;
  }

  function countGraph(graph) {
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

  function diffCount(before, after) {
    const out = {};
    for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
      out[key] = (after?.[key] || 0) - (before?.[key] || 0);
    }
    return out;
  }

  function histogram(nodes, keyFn) {
    const out = {};
    for (const node of nodes || []) {
      const key = keyFn(node) || 'unknown';
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }

  function changedOpcodeCounts(added, removed) {
    const keys = new Set([
      ...Object.keys(histogram(added, opcode)),
      ...Object.keys(histogram(removed, opcode)),
    ]);
    const addedByOpcode = histogram(added, opcode);
    const removedByOpcode = histogram(removed, opcode);
    const out = {};
    keys.forEach(key => {
      out[key] = {
        added: addedByOpcode[key] || 0,
        removed: removedByOpcode[key] || 0,
        net: (addedByOpcode[key] || 0) - (removedByOpcode[key] || 0),
      };
    });
    return out;
  }

  function buildFieldChanges(modified) {
    const paths = [
      ['data.shape', node => node?.data?.shape || []],
      ['data.rawShape', node => node?.data?.rawShape || []],
      ['data.validShape', node => node?.data?.validShape || []],
      ['data.dynValidShape', node => node?.data?.dynValidShape || []],
      ['data.offset', node => node?.data?.offset || []],
      ['data.memType', node => node?.data?.memType || null],
      ['data.memId', node => node?.data?.memId ?? null],
      ['data.memRange', node => node?.data?.memRange || null],
      ['data.opAttr', node => node?.data?.opAttr || {}],
      ['data.attr', node => node?.data?.attr || {}],
      ['data.latency', node => node?.data?.latency ?? null],
      ['data.subgraphId', node => node?.data?.subgraphId ?? null],
    ];
    const out = [];
    for (const item of modified || []) {
      for (const [path, getter] of paths) {
        const beforeValue = getter(item.before);
        const afterValue = getter(item.after);
        if (stableJson(beforeValue) === stableJson(afterValue)) continue;
        const category = path.includes('shape') || path.includes('offset') ? 'shape'
          : path.includes('mem') ? 'memory'
          : path.includes('latency') || path.includes('subgraph') ? 'schedule'
          : 'attr';
        out.push({
          id: `${item.id}:${path}`,
          nodeId: item.id,
          nodeType: item.after?.type || item.before?.type || '',
          side: 'both',
          path,
          beforeValue,
          afterValue,
          category,
          impact: `${path} changed`,
        });
      }
    }
    return out;
  }

  function computeRewires(beforeIndex, afterIndex) {
    const rewires = [];
    for (const [nodeId, beforeNode] of beforeIndex.nodeById.entries()) {
      if (beforeNode.type !== 'op') continue;
      const afterNode = afterIndex.nodeById.get(nodeId);
      if (!afterNode || afterNode.type !== 'op') continue;

      const beforeInputs = beforeNode.data?.ioperands || [];
      const afterInputs = afterNode.data?.ioperands || [];
      const slots = Math.max(beforeInputs.length, afterInputs.length);
      for (let slot = 0; slot < slots; slot += 1) {
        const beforeTensorId = tensorId(beforeInputs[slot]);
        const afterTensorId = tensorId(afterInputs[slot]);
        if (!beforeTensorId || !afterTensorId || beforeTensorId === afterTensorId) continue;
        const beforeEdgeId = `${beforeTensorId}->${nodeId}`;
        const afterEdgeId = `${afterTensorId}->${nodeId}`;
        const removedProducer = producerOf(beforeIndex, beforeTensorId);
        const afterProducer = producerOf(afterIndex, afterTensorId);
        const bypassedNodeIds = [];
        const bypassedEdgeIds = [];
        if (removedProducer && !afterIndex.nodeById.has(removedProducer.id)) {
          bypassedNodeIds.push(removedProducer.id);
          bypassedEdgeIds.push(...(removedProducer.data?.ioperands || []).map(t => `${tensorId(t)}->${removedProducer.id}`));
          bypassedEdgeIds.push(...(removedProducer.data?.ooperands || []).map(t => `${removedProducer.id}->${tensorId(t)}`));
        }
        if (!afterIndex.nodeById.has(beforeTensorId)) bypassedNodeIds.push(beforeTensorId);
        rewires.push({
          id: `${nodeId}:${slot}:${beforeTensorId}->${afterTensorId}`,
          type: 'rewired-input',
          consumerOpId: nodeId,
          inputSlot: slot,
          slot,
          beforeInputTensorId: beforeTensorId,
          afterInputTensorId: afterTensorId,
          beforeEdgeId,
          afterEdgeId,
          edgeIds: [beforeEdgeId, afterEdgeId],
          removedProducerOpId: removedProducer && !afterIndex.nodeById.has(removedProducer.id) ? removedProducer.id : null,
          removedProducerOpcode: removedProducer && !afterIndex.nodeById.has(removedProducer.id) ? opcode(removedProducer) : null,
          removedOutputTensorId: !afterIndex.nodeById.has(beforeTensorId) ? beforeTensorId : null,
          replacementProducerOpId: afterProducer?.id || null,
          bypassedNodeIds: [...new Set(bypassedNodeIds.filter(Boolean))],
          bypassedEdgeIds: [...new Set(bypassedEdgeIds.filter(Boolean))],
          evidence: {
            consumerOpcode: afterNode.data?.opcode || beforeNode.data?.opcode || '',
            beforeInputMagic: beforeInputs[slot],
            afterInputMagic: afterInputs[slot],
            reason: 'consumer input operand changed',
          },
        });
      }
    }
    return rewires;
  }

  function incidentEdgeIds(index, nodeId) {
    return [
      ...(index.inEdgesByTarget.get(nodeId) || []).map(edgeId),
      ...(index.outEdgesBySource.get(nodeId) || []).map(edgeId),
    ];
  }

  function makeRemoveGroups(removed, beforeIndex, afterIndex, rewires) {
    const byOpcode = new Map();
    removed.filter(node => node.type === 'op').forEach(node => {
      const key = opcode(node);
      if (!byOpcode.has(key)) byOpcode.set(key, []);
      byOpcode.get(key).push(node);
    });
    return [...byOpcode.entries()].map(([op, nodes], idx) => {
      const memberNodeIds = new Set(nodes.map(node => node.id));
      const memberEdgeIds = new Set();
      const entryTensorIds = new Set();
      const exitTensorIds = new Set();
      nodes.forEach(node => {
        (node.data?.ioperands || []).map(tensorId).filter(Boolean).forEach(id => entryTensorIds.add(id));
        (node.data?.ooperands || []).map(tensorId).filter(Boolean).forEach(id => {
          exitTensorIds.add(id);
          if (!afterIndex.nodeById.has(id)) memberNodeIds.add(id);
        });
        incidentEdgeIds(beforeIndex, node.id).forEach(id => memberEdgeIds.add(id));
      });
      const relatedRewires = rewires.filter(item => (
        item.removedProducerOpcode === op
        || [...exitTensorIds].includes(item.beforeInputTensorId)
        || (item.bypassedNodeIds || []).some(id => memberNodeIds.has(id))
      ));
      relatedRewires.forEach(item => (item.edgeIds || []).forEach(id => memberEdgeIds.add(id)));
      return {
        id: `remove:${op}:${idx}`,
        changeKind: 'remove-chain',
        title: `删除 ${nodes.length} 个 ${op}`,
        side: 'both',
        memberNodeIds: [...memberNodeIds],
        memberEdgeIds: [...memberEdgeIds],
        beforeBoundary: {
          entryTensorIds: [...entryTensorIds],
          exitTensorIds: [...exitTensorIds],
          externalConsumerOpIds: relatedRewires.map(item => item.consumerOpId),
        },
        afterBoundary: {
          replacementTensorIds: [...new Set(relatedRewires.map(item => item.afterInputTensorId).filter(Boolean))],
          replacementEdgeIds: [...new Set(relatedRewires.map(item => item.afterEdgeId).filter(Boolean))],
          consumerOpIds: [...new Set(relatedRewires.map(item => item.consumerOpId).filter(Boolean))],
        },
        countDelta: {
          ops: -nodes.length,
          tensors: -[...memberNodeIds].filter(id => id.startsWith('t_')).length,
          edges: -[...memberEdgeIds].filter(id => !id.includes('undefined')).length,
        },
        opcodeHistogram: { [op]: nodes.length },
        ruleIds: [],
        sourceRefs: [],
      };
    });
  }

  function makeAddGroups(added, afterIndex) {
    const byOpcode = new Map();
    added.filter(node => node.type === 'op').forEach(node => {
      const key = opcode(node);
      if (!byOpcode.has(key)) byOpcode.set(key, []);
      byOpcode.get(key).push(node);
    });
    return [...byOpcode.entries()].map(([op, nodes], idx) => {
      const memberNodeIds = new Set(nodes.map(node => node.id));
      const memberEdgeIds = new Set();
      nodes.forEach(node => {
        (node.data?.ioperands || []).map(tensorId).filter(Boolean).forEach(id => memberNodeIds.add(id));
        (node.data?.ooperands || []).map(tensorId).filter(Boolean).forEach(id => memberNodeIds.add(id));
        incidentEdgeIds(afterIndex, node.id).forEach(id => memberEdgeIds.add(id));
      });
      return {
        id: `add:${op}:${idx}`,
        changeKind: 'add-chain',
        title: `新增 ${nodes.length} 个 ${op}`,
        side: 'after',
        memberNodeIds: [...memberNodeIds],
        memberEdgeIds: [...memberEdgeIds],
        beforeBoundary: {},
        afterBoundary: { consumerOpIds: [] },
        countDelta: { ops: nodes.length, tensors: [...memberNodeIds].filter(id => id.startsWith('t_')).length, edges: memberEdgeIds.size },
        opcodeHistogram: { [op]: nodes.length },
        ruleIds: [],
        sourceRefs: [],
      };
    });
  }

  function makeFieldGroups(fieldChanges) {
    const byCategory = new Map();
    fieldChanges.forEach(change => {
      if (!byCategory.has(change.category)) byCategory.set(change.category, []);
      byCategory.get(change.category).push(change);
    });
    return [...byCategory.entries()].map(([category, changes], idx) => ({
      id: `field:${category}:${idx}`,
      changeKind: 'field-update',
      title: `更新 ${changes.length} 个 ${category} 字段`,
      side: 'both',
      memberNodeIds: [...new Set(changes.map(change => change.nodeId))],
      memberEdgeIds: [],
      beforeBoundary: {},
      afterBoundary: {},
      countDelta: { ops: 0, tensors: 0, edges: 0 },
      opcodeHistogram: {},
      fieldChangeIds: changes.map(change => change.id),
      ruleIds: [],
      sourceRefs: [],
    }));
  }

  function computeGraphDiff(beforeGraph, afterGraph, pair = {}) {
    const beforeIndex = buildGraphIndex(beforeGraph);
    const afterIndex = buildGraphIndex(afterGraph);
    const added = [];
    const removed = [];
    const modified = [];
    const same = [];

    for (const node of afterGraph?.nodes || []) {
      const beforeNode = beforeIndex.nodeById.get(node.id);
      if (!beforeNode) {
        added.push(node);
      } else if (nodeChanged(beforeNode, node)) {
        modified.push({ before: beforeNode, after: node, id: node.id });
      } else {
        same.push(node);
      }
    }

    for (const node of beforeGraph?.nodes || []) {
      if (!afterIndex.nodeById.has(node.id)) removed.push(node);
    }

    const addedEdges = [];
    const removedEdges = [];
    const sameEdges = [];
    for (const edge of afterGraph?.edges || []) {
      if (beforeIndex.edgeById.has(edgeId(edge))) sameEdges.push(edge);
      else addedEdges.push(edge);
    }
    for (const edge of beforeGraph?.edges || []) {
      if (!afterIndex.edgeById.has(edgeId(edge))) removedEdges.push(edge);
    }

    const rewires = computeRewires(beforeIndex, afterIndex);
    const beforeCounts = countGraph(beforeGraph);
    const afterCounts = countGraph(afterGraph);
    const fieldChanges = buildFieldChanges(modified);
    const groups = [
      ...makeRemoveGroups(removed, beforeIndex, afterIndex, rewires),
      ...makeAddGroups(added, afterIndex),
      ...makeFieldGroups(fieldChanges),
    ];

    return {
      pairId: pair.id || '',
      pair,
      beforeGraph,
      afterGraph,
      beforeIndex,
      afterIndex,
      nodes: { added, removed, modified, same },
      edges: { added: addedEdges, removed: removedEdges, same: sameEdges },
      rewires,
      groups,
      fieldChanges,
      graphCounts: {
        before: beforeCounts,
        after: afterCounts,
        delta: diffCount(beforeCounts, afterCounts),
        byType: {
          op: { before: beforeCounts.ops, after: afterCounts.ops, delta: afterCounts.ops - beforeCounts.ops },
          tensor: { before: beforeCounts.tensors, after: afterCounts.tensors, delta: afterCounts.tensors - beforeCounts.tensors },
          edge: { before: beforeCounts.edges, after: afterCounts.edges, delta: afterCounts.edges - beforeCounts.edges },
        },
        byOpcode: changedOpcodeCounts(
          added.filter(node => node.type === 'op'),
          removed.filter(node => node.type === 'op')
        ),
      },
      stats: {
        addedNodes: added.length,
        removedNodes: removed.length,
        modifiedNodes: modified.length,
        addedEdges: addedEdges.length,
        removedEdges: removedEdges.length,
        rewires: rewires.length,
        netNodes: added.length - removed.length,
        netEdges: addedEdges.length - removedEdges.length,
        fieldChanges: fieldChanges.length,
      },
    };
  }

  window.PtoPassCauseDiff = {
    computeGraphDiff,
    buildGraphIndex,
    edgeId,
    tensorId,
    opcode,
    nodeKind,
    countGraph,
    stableJson,
    consumersOf,
    producerOf,
  };
})();

/**
 * pass_cause_rules.js - Source-derived PyPTO pass rule matchers.
 */
(function () {
  const SOURCE_ROOT = '/Users/yin/gitcode/pypto-master/framework/src/passes';

  const DUMMY_OPCODES = new Set(['VIEW', 'EXPAND', 'REGISTER_COPY', 'ASSEMBLE', 'RESHAPE']);
  const DUPLICATED_OPCODES = new Set(['VIEW', 'GATHER_IN_L1']);
  const MERGE_OPCODES = new Set(['VIEW', 'ASSEMBLE']);

  function opcode(node) {
    return String(node?.data?.opcode || node?.label || '').toUpperCase();
  }

  function tensorId(magic) {
    return window.PtoPassCauseDiff.tensorId(magic);
  }

  function nodeTitle(node) {
    if (!node) return 'unknown';
    const d = node.data || {};
    if (node.type === 'op') return `${opcode(node)} #${d.magic}`;
    if (d.symbol) return `${d.symbol} #${d.magic}`;
    return `${node.type} #${d.magic ?? node.id}`;
  }

  function valuesEqual(a, b) {
    return window.PtoPassCauseDiff.stableJson(a) === window.PtoPassCauseDiff.stableJson(b);
  }

  function explanation(rule, context, fields) {
    const index = context.nextExplanationIndex();
    const pair = context.pair || {};
    const focusSide = fields.focusSide || 'after';
    const nodeIds = [...new Set(fields.nodeIds || [])];
    const edgeIds = [...new Set(fields.edgeIds || [])];
    const before = fields.before || {
      graphRef: pair.beforeRef?.ref || '',
      primaryNodeIds: focusSide === 'before' ? nodeIds : [],
      edgeIds: focusSide === 'before' ? edgeIds : [],
      dimOthers: true,
    };
    const after = fields.after || {
      graphRef: pair.afterRef?.ref || '',
      primaryNodeIds: focusSide === 'after' ? nodeIds : [],
      edgeIds: focusSide === 'after' ? edgeIds : [],
      dimOthers: true,
    };
    return {
      id: `${rule.id}.${index}`,
      pairId: context.pair?.id || '',
      ruleId: rule.id,
      passName: rule.passName,
      confidence: fields.confidence || 'source-rule matched',
      changeType: fields.changeType || 'unexplained',
      focusSide,
      sideMode: fields.sideMode || (before.primaryNodeIds?.length && after.primaryNodeIds?.length ? 'split' : focusSide),
      title: fields.title,
      summary: fields.summary || rule.summary,
      nodeIds,
      edgeIds,
      before,
      after,
      transition: fields.transition || null,
      counts: fields.counts || null,
      evidence: fields.evidence || [],
      source: rule.source,
    };
  }

  function beforeConsumers(context, tensorNodeId) {
    return window.PtoPassCauseDiff.consumersOf(context.diff.beforeIndex, tensorNodeId);
  }

  function afterConsumers(context, tensorNodeId) {
    return window.PtoPassCauseDiff.consumersOf(context.diff.afterIndex, tensorNodeId);
  }

  function matchRemoveRedundantReshape(context, rule) {
    const out = [];
    const removedReshapes = context.diff.nodes.removed.filter(node => node.type === 'op' && opcode(node) === 'RESHAPE');

    for (const reshape of removedReshapes) {
      const inputTensorId = tensorId(reshape.data?.ioperands?.[0]);
      const outputTensorId = tensorId(reshape.data?.ooperands?.[0]);
      const consumersBefore = outputTensorId ? beforeConsumers(context, outputTensorId) : [];
      const rewires = context.diff.rewires.filter(item => (
        (!outputTensorId || item.beforeInputTensorId === outputTensorId)
        && (!inputTensorId || item.afterInputTensorId === inputTensorId)
      ));
      const consumerIds = consumersBefore.map(node => node.id);
      const afterConsumerIds = rewires.map(item => item.consumerOpId).filter(Boolean);
      const afterTensorIds = rewires.map(item => item.afterInputTensorId).filter(Boolean);
      const edgeIds = [
        ...(inputTensorId ? [`${inputTensorId}->${reshape.id}`] : []),
        ...(outputTensorId ? [`${reshape.id}->${outputTensorId}`] : []),
        ...rewires.flatMap(item => item.edgeIds || []),
      ];

      out.push(explanation(rule, context, {
        title: `删除冗余 RESHAPE ${reshape.data?.magic ?? ''}`.trim(),
        summary: '这个 Pass 判断该 RESHAPE 的输出可以直接由输入张量替代，因此删除该算子，并把下游消费者改接到输入张量。',
        changeType: rewires.length ? 'rewired-input' : 'removed-op',
        focusSide: 'before',
        sideMode: rewires.length ? 'split' : 'before',
        nodeIds: [reshape.id, inputTensorId, outputTensorId, ...consumerIds].filter(Boolean),
        edgeIds,
        before: {
          graphRef: context.pair?.beforeRef?.ref || '',
          primaryNodeIds: [reshape.id, outputTensorId].filter(Boolean),
          secondaryNodeIds: [inputTensorId, ...consumerIds].filter(Boolean),
          edgeIds: [
            ...(inputTensorId ? [`${inputTensorId}->${reshape.id}`] : []),
            ...(outputTensorId ? [`${reshape.id}->${outputTensorId}`] : []),
          ],
          badges: { [reshape.id]: '删除', ...(outputTensorId ? { [outputTensorId]: '中间 tensor' } : {}) },
          dimOthers: true,
        },
        after: {
          graphRef: context.pair?.afterRef?.ref || '',
          primaryNodeIds: [...afterConsumerIds, ...afterTensorIds],
          edgeIds: rewires.map(item => item.afterEdgeId).filter(Boolean),
          badges: Object.fromEntries(afterConsumerIds.map(id => [id, '消费者改接'])),
          dimOthers: true,
        },
        transition: {
          type: rewires.length ? 'remove-and-rewire' : 'remove',
          fromNodeIds: [reshape.id, outputTensorId].filter(Boolean),
          toNodeIds: [...afterConsumerIds, ...afterTensorIds],
          removedEdgeIds: [
            ...(inputTensorId ? [`${inputTensorId}->${reshape.id}`] : []),
            ...(outputTensorId ? [`${reshape.id}->${outputTensorId}`] : []),
          ],
          addedEdgeIds: rewires.map(item => item.afterEdgeId).filter(Boolean),
          durationMs: 900,
        },
        counts: {
          removedOps: 1,
          removedTensors: outputTensorId ? 1 : 0,
          rewiredEdges: rewires.length,
          netNodes: outputTensorId ? -2 : -1,
        },
        evidence: [
          { label: '删除算子', value: nodeTitle(reshape) },
          ...(inputTensorId ? [{ label: '输入张量', value: inputTensorId }] : []),
          ...(outputTensorId ? [{ label: '被删输出张量', value: outputTensorId }] : []),
          { label: '消费者重连', value: String(rewires.length) },
        ],
      }));
    }

    return out;
  }

  function matchingBeforeFanoutSource(context, addedOp) {
    const addedOpcode = opcode(addedOp);
    const addedInput = addedOp.data?.ioperands?.[0];
    if (addedInput == null) return null;
    const candidates = [...context.diff.beforeIndex.nodeById.values()].filter(node => {
      if (node.type !== 'op' || opcode(node) !== addedOpcode) return false;
      return (node.data?.ioperands || [])[0] === addedInput;
    });
    return candidates.find(node => {
      const outTensorId = tensorId(node.data?.ooperands?.[0]);
      return outTensorId && beforeConsumers(context, outTensorId).length > 1;
    }) || candidates[0] || null;
  }

  function matchDuplicateOp(context, rule) {
    const out = [];
    const addedOps = context.diff.nodes.added.filter(node => node.type === 'op' && DUPLICATED_OPCODES.has(opcode(node)));

    for (const addedOp of addedOps) {
      const source = matchingBeforeFanoutSource(context, addedOp);
      const inputTensorId = tensorId(addedOp.data?.ioperands?.[0]);
      const outputTensorId = tensorId(addedOp.data?.ooperands?.[0]);
      const sourceOutputTensorId = source ? tensorId(source.data?.ooperands?.[0]) : null;
      const sourceFanout = sourceOutputTensorId ? beforeConsumers(context, sourceOutputTensorId).length : 0;
      const consumers = outputTensorId ? afterConsumers(context, outputTensorId) : [];

      out.push(explanation(rule, context, {
        title: `为 fan-out 复制 ${opcode(addedOp)}`,
        summary: '这个 Pass 复制 VIEW 或 GATHER_IN_L1 路径，让后续消费者不再共享同一个 producer 输出。',
        changeType: 'split-fanout',
        focusSide: 'after',
        sideMode: source ? 'split' : 'after',
        confidence: sourceFanout > 1 ? 'source-rule matched' : 'diff-inferred',
        nodeIds: [
          source?.id,
          sourceOutputTensorId,
          addedOp.id,
          inputTensorId,
          outputTensorId,
          ...consumers.map(node => node.id),
        ].filter(Boolean),
        edgeIds: [
          ...(inputTensorId ? [`${inputTensorId}->${addedOp.id}`] : []),
          ...(outputTensorId ? [`${addedOp.id}->${outputTensorId}`] : []),
          ...consumers.map(node => `${outputTensorId}->${node.id}`),
        ].filter(Boolean),
        before: {
          graphRef: context.pair?.beforeRef?.ref || '',
          primaryNodeIds: [source?.id, sourceOutputTensorId].filter(Boolean),
          edgeIds: sourceOutputTensorId ? consumersOf(context.diff.beforeIndex, sourceOutputTensorId).map(node => `${sourceOutputTensorId}->${node.id}`) : [],
          badges: source?.id ? { [source.id]: '原 fan-out' } : {},
          dimOthers: true,
        },
        after: {
          graphRef: context.pair?.afterRef?.ref || '',
          primaryNodeIds: [addedOp.id, outputTensorId, ...consumers.map(node => node.id)].filter(Boolean),
          edgeIds: [
            ...(inputTensorId ? [`${inputTensorId}->${addedOp.id}`] : []),
            ...(outputTensorId ? [`${addedOp.id}->${outputTensorId}`] : []),
            ...consumers.map(node => `${outputTensorId}->${node.id}`),
          ].filter(Boolean),
          badges: { [addedOp.id]: '新增副本' },
          dimOthers: true,
        },
        transition: {
          type: 'split-fanout',
          fromNodeIds: [source?.id, sourceOutputTensorId].filter(Boolean),
          toNodeIds: [addedOp.id, outputTensorId].filter(Boolean),
          addedEdgeIds: [
            ...(inputTensorId ? [`${inputTensorId}->${addedOp.id}`] : []),
            ...(outputTensorId ? [`${addedOp.id}->${outputTensorId}`] : []),
          ],
          durationMs: 900,
        },
        counts: {
          addedOps: 1,
          addedTensors: outputTensorId ? 1 : 0,
          originalFanout: sourceFanout || null,
          netNodes: outputTensorId ? 2 : 1,
        },
        evidence: [
          { label: '新增算子', value: nodeTitle(addedOp) },
          ...(source ? [{ label: '原始候选', value: nodeTitle(source) }] : []),
          { label: '原 fan-out', value: String(sourceFanout || '未知') },
          ...(outputTensorId ? [{ label: '复制输出', value: outputTensorId }] : []),
        ],
      }));
    }

    return out;
  }

  function matchMergeViewAssemble(context, rule) {
    const out = [];
    const removedMergeOps = context.diff.nodes.removed.filter(node => node.type === 'op' && MERGE_OPCODES.has(opcode(node)));
    const modifiedOffsets = context.diff.nodes.modified.filter(item => {
      const before = item.before?.data || {};
      const after = item.after?.data || {};
      return item.after?.type !== 'op'
        && (!valuesEqual(before.offset || [], after.offset || [])
          || !valuesEqual(before.dynvalidshape || before.dynValidShape || [], after.dynvalidshape || after.dynValidShape || []));
    });

    if (removedMergeOps.length) {
      const byOpcode = new Map();
      removedMergeOps.forEach(node => {
        const key = opcode(node);
        if (!byOpcode.has(key)) byOpcode.set(key, []);
        byOpcode.get(key).push(node);
      });
      for (const [op, nodes] of byOpcode.entries()) {
        const inputTensorIds = nodes.map(node => tensorId(node.data?.ioperands?.[0])).filter(Boolean);
        const outputTensorIds = nodes.map(node => tensorId(node.data?.ooperands?.[0])).filter(Boolean);
        out.push(explanation(rule, context, {
          title: `合并连续 ${op} 链`,
          summary: `这个 Pass 折叠相邻的 ${op} 算子链，并重新计算派生张量的 view 元数据。`,
          changeType: 'merged-chain',
          focusSide: 'before',
          sideMode: modifiedOffsets.length ? 'split' : 'before',
          nodeIds: [...nodes.map(node => node.id), ...inputTensorIds, ...outputTensorIds],
          edgeIds: [
            ...nodes.flatMap(node => (node.data?.ioperands || []).map(t => `${tensorId(t)}->${node.id}`)),
            ...nodes.flatMap(node => (node.data?.ooperands || []).map(t => `${node.id}->${tensorId(t)}`)),
          ],
          before: {
            graphRef: context.pair?.beforeRef?.ref || '',
            primaryNodeIds: nodes.map(node => node.id),
            secondaryNodeIds: [...inputTensorIds, ...outputTensorIds],
            edgeIds: [
              ...nodes.flatMap(node => (node.data?.ioperands || []).map(t => `${tensorId(t)}->${node.id}`)),
              ...nodes.flatMap(node => (node.data?.ooperands || []).map(t => `${node.id}->${tensorId(t)}`)),
            ],
            badges: Object.fromEntries(nodes.map(node => [node.id, '合并删除'])),
            dimOthers: true,
          },
          after: {
            graphRef: context.pair?.afterRef?.ref || '',
            primaryNodeIds: modifiedOffsets.map(item => item.id),
            edgeIds: [],
            badges: Object.fromEntries(modifiedOffsets.map(item => [item.id, '元数据更新'])),
            dimOthers: true,
          },
          transition: {
            type: 'merge-chain',
            fromNodeIds: nodes.map(node => node.id),
            toNodeIds: modifiedOffsets.map(item => item.id),
            removedEdgeIds: [
              ...nodes.flatMap(node => (node.data?.ioperands || []).map(t => `${tensorId(t)}->${node.id}`)),
              ...nodes.flatMap(node => (node.data?.ooperands || []).map(t => `${node.id}->${tensorId(t)}`)),
            ],
            durationMs: 900,
          },
          counts: {
            removedOps: nodes.length,
            removedTensors: outputTensorIds.length,
            fieldChanges: modifiedOffsets.length,
            netNodes: -(nodes.length + outputTensorIds.length),
          },
          evidence: [
            { label: '合并 opcode', value: op },
            { label: '删除链路算子', value: String(nodes.length) },
          ],
        }));
      }
    }

    if (modifiedOffsets.length) {
      out.push(explanation(rule, context, {
        title: '重算合并后的 view 元数据',
        summary: '合并 view/assemble 链后，这个 Pass 更新张量 offset 或 dynamic-valid-shape 字段。',
        changeType: 'offset-updated',
        focusSide: 'after',
        nodeIds: modifiedOffsets.map(item => item.id),
        edgeIds: [],
        evidence: [
          { label: '修改张量', value: String(modifiedOffsets.length) },
          { label: '字段', value: 'offset / dyn valid shape' },
        ],
      }));
    }

    return out;
  }

  function matchRemoveRedundantOp(context, rule) {
    const out = [];
    const removedDummyOps = context.diff.nodes.removed.filter(node => node.type === 'op' && DUMMY_OPCODES.has(opcode(node)));
    if (!removedDummyOps.length) return out;

    const byOpcode = new Map();
    removedDummyOps.forEach(node => {
      const key = opcode(node);
      if (!byOpcode.has(key)) byOpcode.set(key, []);
      byOpcode.get(key).push(node);
    });

    for (const [op, nodes] of byOpcode.entries()) {
      const outputTensorIds = nodes.flatMap(node => (node.data?.ooperands || []).map(tensorId)).filter(Boolean);
      const relatedRewires = context.diff.rewires.filter(item => outputTensorIds.includes(item.beforeInputTensorId));
      const relatedTensorIds = nodes.flatMap(node => [
        ...(node.data?.ioperands || []).map(tensorId),
        ...(node.data?.ooperands || []).map(tensorId),
      ]).filter(Boolean);

      out.push(explanation(rule, context, {
        title: `删除冗余 ${op}`,
        summary: '当输入/输出 shape、memory 或 view/assemble 谓词证明算子是冗余的，这个 Pass 会删除这些 dummy graph operation。',
        changeType: relatedRewires.length ? 'rewired-input' : 'removed-op',
        focusSide: 'before',
        sideMode: relatedRewires.length ? 'split' : 'before',
        nodeIds: [...nodes.map(node => node.id), ...relatedTensorIds],
        edgeIds: [
          ...nodes.flatMap(node => (node.data?.ioperands || []).map(t => `${tensorId(t)}->${node.id}`)),
          ...nodes.flatMap(node => (node.data?.ooperands || []).map(t => `${node.id}->${tensorId(t)}`)),
          ...relatedRewires.flatMap(item => item.edgeIds || []),
        ],
        before: {
          graphRef: context.pair?.beforeRef?.ref || '',
          primaryNodeIds: nodes.map(node => node.id),
          secondaryNodeIds: relatedTensorIds,
          edgeIds: [
            ...nodes.flatMap(node => (node.data?.ioperands || []).map(t => `${tensorId(t)}->${node.id}`)),
            ...nodes.flatMap(node => (node.data?.ooperands || []).map(t => `${node.id}->${tensorId(t)}`)),
          ],
          badges: Object.fromEntries(nodes.map(node => [node.id, '删除'])),
          dimOthers: true,
        },
        after: {
          graphRef: context.pair?.afterRef?.ref || '',
          primaryNodeIds: [
            ...relatedRewires.map(item => item.consumerOpId),
            ...relatedRewires.map(item => item.afterInputTensorId),
          ].filter(Boolean),
          edgeIds: relatedRewires.map(item => item.afterEdgeId).filter(Boolean),
          badges: Object.fromEntries(relatedRewires.map(item => [item.consumerOpId, '消费者改接']).filter(([id]) => id)),
          dimOthers: true,
        },
        transition: {
          type: relatedRewires.length ? 'remove-and-rewire' : 'remove',
          fromNodeIds: [...nodes.map(node => node.id), ...outputTensorIds],
          toNodeIds: [
            ...relatedRewires.map(item => item.consumerOpId),
            ...relatedRewires.map(item => item.afterInputTensorId),
          ].filter(Boolean),
          removedEdgeIds: [
            ...nodes.flatMap(node => (node.data?.ioperands || []).map(t => `${tensorId(t)}->${node.id}`)),
            ...nodes.flatMap(node => (node.data?.ooperands || []).map(t => `${node.id}->${tensorId(t)}`)),
          ],
          addedEdgeIds: relatedRewires.map(item => item.afterEdgeId).filter(Boolean),
          durationMs: 900,
        },
        counts: {
          removedOps: nodes.length,
          removedTensors: outputTensorIds.length,
          rewiredEdges: relatedRewires.length,
          netNodes: -(nodes.length + outputTensorIds.length),
        },
        evidence: [
          { label: '删除 opcode', value: op },
          { label: '删除算子数', value: String(nodes.length) },
          { label: '消费者重连', value: String(relatedRewires.length) },
        ],
      }));
    }

    return out;
  }

  const RULES = [
    {
      id: 'remove-redundant-reshape.rewire-consumers',
      passName: 'RemoveRedundantReshape',
      source: {
        file: `${SOURCE_ROOT}/tensor_graph_pass/remove_redundant_reshape.cpp`,
        functions: ['RunOnFunction', 'RemoveReshape'],
      },
      summary: '删除冗余 RESHAPE，并把消费者重连到 reshape 的输入张量。',
      match: matchRemoveRedundantReshape,
    },
    {
      id: 'duplicate-op.split-fanout',
      passName: 'DuplicateOp',
      source: {
        file: `${SOURCE_ROOT}/tile_graph_pass/graph_optimization/duplicate_op.cpp`,
        functions: ['RunOnFunction', 'DuplicateOp'],
      },
      summary: '当 producer 输出有多个消费者时，复制 VIEW 或 GATHER_IN_L1 producer。',
      match: matchDuplicateOp,
    },
    {
      id: 'merge-view-assemble.merge-chain',
      passName: 'MergeViewAssemble',
      source: {
        file: `${SOURCE_ROOT}/tile_graph_pass/graph_optimization/merge_view_assemble.cpp`,
        functions: ['RunOnFunction', 'MergeContinuousViewOrAssemble'],
        relatedFiles: [`${SOURCE_ROOT}/pass_utils/merge_view_assemble_utils.cpp`],
      },
      summary: '合并连续 VIEW 或 ASSEMBLE 链，并重新计算合并后的 offset 元数据。',
      match: matchMergeViewAssemble,
    },
    {
      id: 'remove-redundant-op.remove-dummy',
      passName: 'RemoveRedundantOp',
      source: {
        file: `${SOURCE_ROOT}/tile_graph_pass/graph_optimization/remove_redundant_op.cpp`,
        functions: ['RunOnFunction', 'RemoveRedundantOp', 'ProcessViewAssemble'],
      },
      summary: '当谓词证明 VIEW、EXPAND、REGISTER_COPY、ASSEMBLE 或 RESHAPE 是冗余操作时删除它们。',
      match: matchRemoveRedundantOp,
    },
  ];

  function rulesForPass(passName) {
    const normalize = window.PtoPassCausePairs?.normalizePassName || ((v) => String(v || ''));
    const name = normalize(passName);
    return RULES.filter(rule => normalize(rule.passName) === name);
  }

  window.PtoPassCauseRules = {
    RULES,
    rulesForPass,
    opcode,
    nodeTitle,
  };
})();

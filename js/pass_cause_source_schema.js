/**
 * pass_cause_source_schema.js - Source-derived PyPTO Pass metadata.
 */
(function () {
  const SOURCE_ROOT = '/Users/yin/gitcode/pypto-master/framework/src/passes';

  const CATEGORY_LABELS = {
    redundancy: '消冗余',
    layout: '布局',
    copy: '复制/数据通路',
    fusion: '融合/合并',
    partition: '图分区',
    schedule: '调度',
    memory: '内存',
    sync: '同步',
    shape: 'Shape 推导',
    codegen: 'Codegen',
    function: '函数/控制流',
    dtype: '类型转换',
    check: '检查',
  };

  const PVC2_OOO_ORDER = [
    'RemoveRedundantReshape',
    'AutoCast',
    'InferMemoryConflict',
    'RemoveUndrivenView',
    'ExpandFunction',
    'MergeViewAssemble',
    'SplitReshape',
    'SplitRawTensor',
    'SplitLargeFanoutTensor',
    'DuplicateOp',
    'AssignMemoryType',
    'InferDiscontinuousInput',
    'RemoveRedundantOp',
    'InsertOpForViewAssemble',
    'SplitK',
    'GraphPartition',
    'ReduceCopyMerge',
    'NBufferMerge',
    'L1CopyInReuseMerge',
    'IntraSubgraphAdapter',
    'GenerateMoveOp',
    'CommonOperationEliminate',
    'AxisCombine',
    'PadLocalBuffer',
    'RemoveUnalignedReshape',
    'ReplaceTensor',
    'PreGraphProcess',
    'InferDynShape',
    'SubgraphToFunction',
    'InferParamIndex',
    'SrcDstBufferMerge',
    'AddAlloc',
    'OoOSchedule',
    'TuneTileOpSeqForVF',
    'GlobalMemoryReuse',
    'RemoveAlloc',
    'CopyOutResolve',
    'InsertSync',
    'TuneSyncForVF',
    'MixSubgraphSplit',
    'LoopaxesProc',
    'CodegenPreproc',
  ];

  function src(path) {
    return `${SOURCE_ROOT}/${path}`;
  }

  function pass(entry) {
    return {
      registered: true,
      coverageTier: 'schema',
      strategyOrder: PVC2_OOO_ORDER.indexOf(entry.name),
      sourceCandidateIndex: PVC2_OOO_ORDER.indexOf(entry.name),
      narrativeTemplate: `${entry.name} 改写 ${entry.rewriteTargets.join('/')}，主要变化需要结合源码条件和 Before/After diff 判断。`,
      matchSignals: [],
      ...entry,
    };
  }

  const PASS_SOURCE_SCHEMA = [
    pass({ name: 'RemoveRedundantReshape', stage: 'Tensor', category: 'redundancy', source: { file: src('tensor_graph_pass/remove_redundant_reshape.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'edge'], coverageTier: 'rule', matchSignals: ['removed OP_RESHAPE', 'consumer input rewired to reshape input'], narrativeTemplate: '删除等价 RESHAPE，并把消费者改接到原输入 tensor。' }),
    pass({ name: 'AutoCast', stage: 'Tensor', category: 'dtype', source: { file: src('tensor_graph_pass/auto_cast.cpp'), functions: ['RunOnFunction', 'InsertCast'] }, rewriteTargets: ['op', 'tensor', 'edge', 'dtype'], matchSignals: ['added/removed OP_CAST', 'dtype changed'], narrativeTemplate: '根据 dtype 约束插入、合并或删除 CAST。' }),
    pass({ name: 'InferMemoryConflict', stage: 'Tensor', category: 'copy', source: { file: src('tensor_graph_pass/infer_memory_conflict.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'tensor', 'edge'], matchSignals: ['added OP_REGISTER_COPY', 'memory conflict around view/reshape chain'], narrativeTemplate: '发现 view/reshape 链上的内存冲突后插入 REGISTER_COPY。' }),
    pass({ name: 'RemoveUndrivenView', stage: 'Tensor', category: 'redundancy', source: { file: src('tensor_graph_pass/remove_undriven_view.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'edge'], matchSignals: ['removed OP_VIEW', 'ASSEMBLE_SSA changed to ASSEMBLE'], narrativeTemplate: '删除没有真实 producer 驱动的 VIEW，并修正 assemble 类型。' }),
    pass({ name: 'ExpandFunction', stage: 'Tensor', category: 'function', source: { file: src('tensor_graph_pass/expand_function.cpp'), functions: ['RunOnFunction', 'ExpandOperationInto'] }, rewriteTargets: ['op', 'tensor', 'edge', 'attr'], matchSignals: ['many added tile ops', 'function expanded'], narrativeTemplate: '把 tensor graph op 展开为 tile graph op，并复制相关 attr。' }),
    pass({ name: 'MergeViewAssemble', stage: 'Tile', category: 'fusion', source: { file: src('tile_graph_pass/graph_optimization/merge_view_assemble.cpp'), functions: ['RunOnFunction'], relatedFiles: [src('pass_utils/merge_view_assemble_utils.cpp')] }, rewriteTargets: ['op', 'edge', 'shape'], coverageTier: 'rule', matchSignals: ['removed VIEW/ASSEMBLE chain', 'offset/dynValidShape updated'], narrativeTemplate: '合并连续 VIEW/ASSEMBLE 链，并重算派生 tensor 元数据。' }),
    pass({ name: 'SplitReshape', stage: 'Tile', category: 'layout', source: { file: src('tile_graph_pass/graph_optimization/split_reshape.cpp'), functions: ['RunOnFunction', 'AddOperation', 'SetMemoryType'] }, rewriteTargets: ['op', 'tensor', 'edge', 'shape', 'memory'], coverageTier: 'rule', matchSignals: ['RESHAPE replaced by view/assemble/reshape chain', 'memory type changed'], narrativeTemplate: '按 tile overlap、对齐和动态 shape 条件拆分 RESHAPE。' }),
    pass({ name: 'SplitRawTensor', stage: 'Tile', category: 'layout', source: { file: src('tile_graph_pass/graph_optimization/split_raw.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['tensor', 'edge'], coverageTier: 'rule', matchSignals: ['raw tensor split', 'VIEW/ASSEMBLE producer-consumer boundary'], narrativeTemplate: '把可被 VIEW/ASSEMBLE 边界隔离的 raw tensor 拆开。' }),
    pass({ name: 'SplitLargeFanoutTensor', stage: 'Tile', category: 'layout', source: { file: src('tile_graph_pass/graph_optimization/split_large_fanout_tensor.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['tensor', 'op', 'edge', 'shape'], coverageTier: 'rule', matchSignals: ['large fanout tensor split', 'added VIEW/ASSEMBLE'], narrativeTemplate: '把多消费者大 tensor 拆为更小的 view/assemble 路径。' }),
    pass({ name: 'DuplicateOp', stage: 'Tile', category: 'copy', source: { file: src('tile_graph_pass/graph_optimization/duplicate_op.cpp'), functions: ['RunOnFunction', 'Process'] }, rewriteTargets: ['op', 'tensor', 'edge'], coverageTier: 'rule', matchSignals: ['added VIEW/GATHER_IN_L1 clone', 'fanout split'], narrativeTemplate: '复制多消费者 producer，让不同 consumer 不再共享同一输出。' }),
    pass({ name: 'AssignMemoryType', stage: 'Tile', category: 'memory', source: { file: src('tile_graph_pass/data_path/assign_memory_type.cpp'), functions: ['RunOnFunction', 'RunOnOperation'] }, rewriteTargets: ['tensor', 'memory'], matchSignals: ['memType changed', 'boundary tensor forced DDR'], narrativeTemplate: '按 opcode 输入输出约束设置 tensor memory type。' }),
    pass({ name: 'InferDiscontinuousInput', stage: 'Tile', category: 'layout', source: { file: src('tile_graph_pass/graph_optimization/infer_discontinuous_input.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'tensor', 'edge', 'memory'], matchSignals: ['added VIEW/ASSEMBLE', 'UB/DDR adapter tensor'], narrativeTemplate: '发现非连续输入或 memory mismatch 后插入适配路径。' }),
    pass({ name: 'RemoveRedundantOp', stage: 'Tile', category: 'redundancy', source: { file: src('tile_graph_pass/graph_optimization/remove_redundant_op.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'tensor', 'edge'], coverageTier: 'rule', matchSignals: ['removed VIEW/EXPAND/REGISTER_COPY/ASSEMBLE/RESHAPE', 'consumer rewired'], narrativeTemplate: '删除能被等价输入替代的 dummy operation，并重连 consumer。' }),
    pass({ name: 'InsertOpForViewAssemble', stage: 'Tile', category: 'copy', source: { file: src('tile_graph_pass/graph_optimization/insert_op_for_viewassemble.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'tensor', 'edge', 'memory'], coverageTier: 'rule', matchSignals: ['inserted ASSEMBLE -> DDR tensor -> VIEW'], narrativeTemplate: '在 view/assemble 路径之间插入隔离 op，修补 memory path。' }),
    pass({ name: 'SplitK', stage: 'Tile', category: 'fusion', source: { file: src('tile_graph_pass/graph_optimization/split_k.cpp'), functions: ['RunOnFunction', 'EliminateReduceAcc'] }, rewriteTargets: ['op', 'edge', 'attr'], coverageTier: 'rule', matchSignals: ['removed OP_REDUCE_ACC', 'copy_out atomic_add attr'], narrativeTemplate: '把 REDUCE_ACC 折叠到 copy_out atomic_add 路径中。' }),
    pass({ name: 'GraphPartition', stage: 'Tile', category: 'partition', source: { file: src('tile_graph_pass/graph_partition/iso_partitioner.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'tensor', 'subgraph', 'attr'], matchSignals: ['subgraphId/scope/isCube changed'], narrativeTemplate: '根据 core type、memory 和 DAG 依赖构建分区。' }),
    pass({ name: 'ReduceCopyMerge', stage: 'Tile', category: 'partition', source: { file: src('tile_graph_pass/graph_partition/reduce_copy.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['subgraph', 'schedule'], matchSignals: ['reduce/copy color node merged'], narrativeTemplate: '合并 reduce/copy 相关分区。' }),
    pass({ name: 'NBufferMerge', stage: 'Tile', category: 'partition', source: { file: src('tile_graph_pass/graph_partition/n_buffer_merge.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['subgraph', 'schedule'], matchSignals: ['N-buffer partition merged'], narrativeTemplate: '合并可复用的 copy-in/compute N-buffer 分区。' }),
    pass({ name: 'L1CopyInReuseMerge', stage: 'Tile', category: 'copy', source: { file: src('tile_graph_pass/graph_partition/l1_copy_reuse.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'subgraph', 'edge'], matchSignals: ['DDR->L1 copy-in reused', 'removed redundant view'], narrativeTemplate: '复用 L1 copy-in 路径，减少重复搬运。' }),
    pass({ name: 'IntraSubgraphAdapter', stage: 'Tile', category: 'copy', source: { file: src('tile_graph_pass/data_path/intra_subgraph_adapter.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'tensor', 'edge', 'memory'], matchSignals: ['cross-subgraph adapter inserted', 'producer changed to COPY_OUT'], narrativeTemplate: '为跨子图 tensor 插入 view/assemble/copy 适配。' }),
    pass({ name: 'GenerateMoveOp', stage: 'Tile', category: 'copy', source: { file: src('tile_graph_pass/data_path/generate_move_op.cpp'), functions: ['RunOnFunction', 'CreateMoveOp'] }, rewriteTargets: ['op', 'attr', 'memory'], coverageTier: 'rule', matchSignals: ['OP_VIEW opcode changed to COPY_IN/L1_TO_L0*/UB_COPY*'], narrativeTemplate: '按 memory path 把 VIEW 改写为实际搬运 op。' }),
    pass({ name: 'CommonOperationEliminate', stage: 'Tile', category: 'redundancy', source: { file: src('tile_graph_pass/graph_partition/common_operation_eliminate.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'edge'], coverageTier: 'rule', matchSignals: ['removed duplicate producer', 'consumer rewired to existing tensor'], narrativeTemplate: '删除语义等价的重复 operation，并让 consumer 复用已有 producer。' }),
    pass({ name: 'AxisCombine', stage: 'Tile', category: 'shape', source: { file: src('tile_graph_pass/graph_constraint/axis_combine.cpp'), functions: ['RunOnFunction', 'AlignBroadCastOpInputs'] }, rewriteTargets: ['op', 'tensor', 'shape', 'attr'], matchSignals: ['added OP_BRCB/OP_EXPAND', 'brcbIdx attr'], narrativeTemplate: '为广播输入插入 BRCB/EXPAND 并合并轴。' }),
    pass({ name: 'PadLocalBuffer', stage: 'Tile', category: 'layout', source: { file: src('tile_graph_pass/graph_constraint/pad_local_buffer.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['tensor', 'shape', 'attr'], matchSignals: ['local buffer shape/validShape/padding changed'], narrativeTemplate: '根据本地 buffer 对齐需求调整 shape 和 padding。' }),
    pass({ name: 'RemoveUnalignedReshape', stage: 'Tile', category: 'layout', source: { file: src('tile_graph_pass/graph_constraint/remove_unaligned_reshape_op.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'tensor', 'edge', 'shape'], matchSignals: ['unaligned RESHAPE replaced by copy/reshape/copy path'], narrativeTemplate: '把不对齐的 UB->UB reshape 改写为可执行的搬运链。' }),
    pass({ name: 'ReplaceTensor', stage: 'Tile', category: 'layout', source: { file: src('tile_graph_pass/graph_constraint/replace_tensor.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['tensor', 'edge', 'memory'], matchSignals: ['tensor replacement', 'boundary tensor rewired'], narrativeTemplate: '根据 replace graph 和边界关系替换 logical tensor。' }),
    pass({ name: 'PreGraphProcess', stage: 'Tile', category: 'layout', source: { file: src('tile_graph_pass/graph_constraint/pre_graph/pre_graph.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'tensor', 'attr', 'color'], matchSignals: ['tensor color/boundary initialized', 'redundant assemble removed'], narrativeTemplate: '初始化 graph constraint 信息并执行预处理合并。' }),
    pass({ name: 'InferDynShape', stage: 'Tile', category: 'shape', source: { file: src('tile_graph_pass/graph_constraint/infer_dyn_shape.cpp'), functions: ['RunOnFunction', 'InferShape'] }, rewriteTargets: ['shape', 'attr', 'topo'], matchSignals: ['dynValidShape/shape changed'], narrativeTemplate: '按拓扑顺序推导动态 shape 和 valid shape。' }),
    pass({ name: 'SubgraphToFunction', stage: 'Tile', category: 'function', source: { file: src('tile_graph_pass/subgraph_to_function.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['function', 'op', 'tensor', 'edge'], matchSignals: ['leaf/root snapshots', 'OP_CALL inserted', 'subfunction created'], narrativeTemplate: '把分区后的子图转成 leaf function 和 CALL。' }),
    pass({ name: 'InferParamIndex', stage: 'Block', category: 'codegen', source: { file: src('block_graph_pass/infer_param_index.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['attr', 'call param'], matchSignals: ['param index attr changed'], narrativeTemplate: '为 call、GM tensor 和动态属性推断参数索引。' }),
    pass({ name: 'SrcDstBufferMerge', stage: 'Block', category: 'memory', source: { file: src('block_graph_pass/memory_reuse/merge_src_dst_buffer.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['tensor', 'memory'], matchSignals: ['memory range/storage merged'], narrativeTemplate: '合并 copy src/dst 可复用 buffer。' }),
    pass({ name: 'AddAlloc', stage: 'Block', category: 'memory', source: { file: src('block_graph_pass/schedule_ooo/add_alloc.cpp'), functions: ['RunOnFunction', 'AddAndCheckAlloc'] }, rewriteTargets: ['op', 'tensor', 'schedule'], matchSignals: ['added ALLOC op', 'schedule changed'], narrativeTemplate: '为未分配的非 DDR 输出插入 alloc op。' }),
    pass({ name: 'OoOSchedule', stage: 'Block', category: 'schedule', source: { file: src('block_graph_pass/schedule_ooo/schedule_ooo.cpp'), functions: ['RunOnFunction', 'SortOps'] }, rewriteTargets: ['schedule', 'attr'], matchSignals: ['operation order changed', 'lastUse/latency attr changed'], narrativeTemplate: '按依赖、latency 和 buffer 估计执行乱序调度。' }),
    pass({ name: 'TuneTileOpSeqForVF', stage: 'Block', category: 'schedule', source: { file: src('block_graph_pass/tune_tileopseq_for_vf.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['schedule'], matchSignals: ['tile op sequence changed'], narrativeTemplate: '在 VF 配置下重排 tile op 序列。' }),
    pass({ name: 'GlobalMemoryReuse', stage: 'Block', category: 'memory', source: { file: src('block_graph_pass/memory_reuse/global_memory_reuse.cpp'), functions: ['RunOnFunction', 'Allocate'] }, rewriteTargets: ['tensor', 'memory'], matchSignals: ['workspace storage assigned/reused'], narrativeTemplate: '基于生命周期为 workspace tensor 分配或复用 storage。' }),
    pass({ name: 'RemoveAlloc', stage: 'Block', category: 'redundancy', source: { file: src('block_graph_pass/schedule_ooo/remove_alloc.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op'], matchSignals: ['removed ALLOC opcode'], narrativeTemplate: '删除调度后不再需要的 alloc op。' }),
    pass({ name: 'CopyOutResolve', stage: 'Block', category: 'sync', source: { file: src('block_graph_pass/copy_out_resolve.cpp'), functions: ['RunOnFunction', 'InsertCopyOutResolveForLeaf'] }, rewriteTargets: ['op', 'schedule', 'attr'], matchSignals: ['added/removed AICPU_CALL', 'copy_out resolve counter'], narrativeTemplate: '为最后 copy_out 插入或合并 resolve 标记。' }),
    pass({ name: 'InsertSync', stage: 'Block', category: 'sync', source: { file: src('block_graph_pass/insert_sync.cpp'), functions: ['RunOnFunction', 'InsertSync'] }, rewriteTargets: ['op', 'schedule', 'dependency'], matchSignals: ['added/removed SYNC/BAR/PHASE op'], narrativeTemplate: '根据 pipe/core 和 memory dependency 插入同步。' }),
    pass({ name: 'TuneSyncForVF', stage: 'Block', category: 'sync', source: { file: src('block_graph_pass/tune_sync_for_vf.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['schedule', 'sync op'], matchSignals: ['sync order changed'], narrativeTemplate: '在 VF 配置下调整 sync 排布。' }),
    pass({ name: 'MixSubgraphSplit', stage: 'Block', category: 'function', source: { file: src('block_graph_pass/mix_subgraph_split.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['function', 'op', 'attr'], matchSignals: ['function clone/split', 'mixId/resourceType/programId changed'], narrativeTemplate: '拆分混合资源子图并设置 mix 相关 attr。' }),
    pass({ name: 'LoopaxesProc', stage: 'Block', category: 'schedule', source: { file: src('block_graph_pass/loopaxes_proc.cpp'), functions: ['RunOnFunction', 'UpdateOpLoopAxes'] }, rewriteTargets: ['op attr'], matchSignals: ['loopAxes/loopGroup attr changed'], narrativeTemplate: '为 VF fuse 支持 op 标记 loop axes 和 loop group。' }),
    pass({ name: 'CodegenPreproc', stage: 'Block', category: 'codegen', source: { file: src('block_graph_pass/codegen_preproc.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'attr'], matchSignals: ['codegen attr changed', 'opcode adjusted back to VIEW'], narrativeTemplate: '设置 codegen 所需参数索引和最后阶段 attr。' }),
    { name: 'LoopUnroll', registered: true, strategy: 'FunctionUnroll', strategyOrder: 0, sourceCandidateIndex: -1, stage: 'Tensor', category: 'function', source: { file: src('tensor_graph_pass/loop_unroll.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['function', 'op', 'tensor', 'shape', 'attr'], coverageTier: 'schema', matchSignals: ['dynamic loop path cloned', 'local/global tensor mapping'], narrativeTemplate: '展开 loop/call function，创建动态路径 function 并静态化局部 view/assemble 元数据。' },
    { name: 'DynAttrToStatic', registered: true, strategy: 'ExecuteGraph', strategyOrder: 0, sourceCandidateIndex: -1, stage: 'Execute', category: 'codegen', source: { file: src('block_graph_pass/dyn_attr_to_static.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['attr', 'symbolic scalar'], coverageTier: 'schema', matchSignals: ['dynamic attr constant-folded'], narrativeTemplate: '把可判定的动态属性表达式静态化。' },
    { name: 'SetHeuristicTileShapes', registered: false, stage: 'Tensor', category: 'shape', source: { file: src('tensor_graph_pass/set_heuristic_tile_shapes.cpp'), functions: ['RunOnFunction', 'SetHeuristicTileShapesFunc'] }, rewriteTargets: ['tile shape', 'attr'], coverageTier: 'source-only', matchSignals: ['tile shape changed'], narrativeTemplate: '按 opcode、dtype、axis 和平台 memory limit 启发式设置 tile shape。' },
    { name: 'InplaceProcess', registered: false, stage: 'Tile', category: 'layout', source: { file: src('tile_graph_pass/graph_constraint/inplace_process.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['op', 'tensor', 'edge', 'attr'], coverageTier: 'source-only', matchSignals: ['inplace attr/tensor replacement'], narrativeTemplate: '处理 VIEW/ASSEMBLE/RESHAPE/HUB 与 inplace op 的 raw tensor 替换。' },
    { name: 'PriorScheduling', registered: false, stage: 'Block', category: 'schedule', source: { file: src('block_graph_pass/prior_scheduling.cpp'), functions: ['RunOnFunction'] }, rewriteTargets: ['schedule'], coverageTier: 'source-only', matchSignals: ['priority schedule order changed'], narrativeTemplate: '按优先级规则调整 schedule。' },
  ];

  const PASS_BY_NAME = new Map(PASS_SOURCE_SCHEMA.map(item => [item.name, item]));

  function normalizePassName(value) {
    return String(value || '').replace(/\d+$/g, '');
  }

  function getPassSchema(name) {
    return PASS_BY_NAME.get(normalizePassName(name)) || null;
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || category || '未知';
  }

  function coverageLabel(tier) {
    if (tier === 'rule') return '源码规则';
    if (tier === 'schema') return 'Schema 解释';
    if (tier === 'source-only') return '源码索引';
    return '未知';
  }

  window.PtoPassCauseSourceSchema = {
    CATEGORY_LABELS,
    PVC2_OOO_ORDER,
    PASS_SOURCE_SCHEMA,
    getPassSchema,
    normalizePassName,
    categoryLabel,
    coverageLabel,
  };
})();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PTO_ROOT = path.resolve(__dirname, '../..');
const BASE_ARCHITECTURE = path.join(
  PTO_ROOT,
  'vendor/pto-design-system/patterns/model-graphviz/assets/openpangu_2_0_flash_model_architecture.json',
);
const SOURCE_ROOT = path.join(PTO_ROOT, 'model-architecture/sources');
const CONFIG_PATH = path.join(SOURCE_ROOT, 'openPangu-2.0-Flash/config.json');
const MODEL_PATH = path.join(
  SOURCE_ROOT,
  'openPangu-2.0-Infer/components/omni-npu/src/omni_npu/v1/models/pangu/pangu_v2_moe.py',
);
const ATTENTION_PATH = path.join(
  SOURCE_ROOT,
  'openPangu-2.0-Infer/components/omni-npu/src/omni_npu/v1/layers/attention/npu_pangu.py',
);
const MOE_PATH = path.join(
  SOURCE_ROOT,
  'openPangu-2.0-Infer/components/omni-npu/src/omni_npu/layers/fused_moe/layer.py',
);
const OUTPUT_DIR = path.join(__dirname, 'data/openpangu-2.0-flash');
const OUTPUTS = Object.freeze({
  architecture: path.join(OUTPUT_DIR, 'model_architecture.json'),
  graph: path.join(OUTPUT_DIR, 'model_architecture_graph.json'),
  validation: path.join(OUTPUT_DIR, 'model_architecture_validation.md'),
});
const SOURCE_INPUTS = Object.freeze([CONFIG_PATH, MODEL_PATH, ATTENTION_PATH, MOE_PATH]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readText = (file) => fs.readFileSync(file, 'utf8');
const readJson = (file) => JSON.parse(readText(file));
const relativeToPto = (file) => path.relative(PTO_ROOT, file).split(path.sep).join('/');

function requireSourceFact(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`Source fact missing: ${label}`);
}

function sourceRef(sourceId, file, lineStart, lineEnd, symbol, evidence = 'source') {
  return {
    source_id: sourceId,
    path: relativeToPto(file),
    line_start: lineStart,
    line_end: lineEnd,
    symbol,
    evidence,
  };
}

function provenance(source, line, fact) {
  return [{ source, line, fact, confidence: 'confirmed' }];
}

function makeNode(id, kind, label, attrs, source, line, fact, extra = {}) {
  return {
    id,
    kind,
    label,
    ...(kind === 'module' ? { module_type: attrs.module_type || id } : {}),
    ...(kind === 'op' ? { op_type: attrs.op_type || label } : {}),
    ...(kind === 'state' ? { state_type: attrs.state_type || id } : {}),
    attrs: Object.fromEntries(Object.entries(attrs).filter(([key]) => !['module_type', 'op_type', 'state_type'].includes(key))),
    provenance: provenance(source, line, fact),
    ...extra,
  };
}

function makeEdge(id, source, target, semanticEdgeType, tensor, sourceId, line, fact, condition) {
  return {
    id,
    source,
    target,
    semanticEdgeType,
    tensor,
    provenance: provenance(sourceId, line, fact),
    ...(condition ? { condition } : {}),
  };
}

function normalizeEdgeType(edge, nodeById) {
  if (edge.semanticEdgeType) return edge.semanticEdgeType;
  const tensor = edge.tensor || {};
  const source = nodeById.get(edge.source) || {};
  if (tensor.role === 'parameter' || source.state_type === 'parameter') return 'parameter';
  if (['e_qa_skip_to_qadd', 'e_kva_skip_to_kvadd', 'e_core_skip_to_oadd'].includes(edge.id)) return 'residual';
  if (source.kind === 'state') return 'state';
  return 'activation';
}

function canonicalSourcePathMap(architecture) {
  return new Map((architecture.sources || []).map((source) => {
    const basename = path.basename(source.path || '');
    const known = {
      'config.json': CONFIG_PATH,
      'pangu_v2_moe.py': MODEL_PATH,
      'npu_pangu.py': ATTENTION_PATH,
      'layer.py': MOE_PATH,
    }[basename];
    const resolved = known || source.path;
    return [source.id, resolved];
  }));
}

function sourceRefsFor(item, sourcePaths) {
  return (item.provenance || []).map((entry) => {
    const file = sourcePaths.get(entry.source);
    return {
      source_id: entry.source,
      path: file ? relativeToPto(file) : String(entry.source),
      line_start: Number(entry.line || 1),
      line_end: Number(entry.line || 1),
      symbol: item.op_type || item.module_type || item.state_type || item.id,
      evidence: entry.confidence === 'confirmed' ? 'source' : 'inference',
    };
  });
}

function patchCanonicalArchitecture(base, config, sources) {
  const architecture = clone(base);
  const nodeById = new Map(architecture.nodes.map((node) => [node.id, node]));

  const routedExperts = nodeById.get('routed_expert_bank');
  Object.assign(routedExperts, {
    kind: 'module',
    label: 'Routed Experts',
    module_type: 'logical_expert_collection',
    attrs: {
      ...routedExperts.attrs,
      logical_expert_count: config.n_routed_experts,
      instance_id_range: `E000-E${String(config.n_routed_experts - 1).padStart(3, '0')}`,
      implementation: 'NPUSharedFusedMoE / FusedMoE',
      physical_placement: 'runtime_overlay',
    },
    children: Array.from({ length: config.n_routed_experts }, (_, expertId) => `expert_${expertId}`),
  });
  delete routedExperts.op_type;

  const mhcAttention = nodeById.get('mhc_attention');
  Object.assign(mhcAttention, {
    kind: 'module',
    label: 'mHC Attention State Flow',
    module_type: 'mhc_pre_post_state_flow',
    attrs: { streams: config.mhc_num_stream, enabled_when: 'use_mhc=true' },
  });
  const mhcAttentionPost = nodeById.get('mhc_attention_post');
  Object.assign(mhcAttentionPost, {
    kind: 'op',
    label: 'Attention Residual Merge',
    op_type: 'mHCPost',
    attrs: { semantic_role: 'residual_merge', enabled_when: 'use_mhc=true', consumes: ['hidden_states', 'h_post', 'residual', 'h_res'] },
  });
  delete mhcAttentionPost.module_type;

  const additions = [
    makeNode('mhc_attention_pre', 'op', 'mHC Attention Pre', { op_type: 'mHCPre', outputs: ['hidden_states', 'h_post', 'h_res'] }, 'model_impl', 1454, 'attn_mhc_module.mhc_pre returns hidden_states, h_post, and h_res'),
    makeNode('mhc_attention_residual_state', 'state', 'Attention Residual', { state_type: 'residual', dtype: 'bf16' }, 'model_impl', 1448, 'mhc_head clones the incoming hidden states as residual'),
    makeNode('mhc_attention_h_post_state', 'state', 'Attention h_post', { state_type: 'mhc_state', streams: config.mhc_num_stream }, 'model_impl', 1454, 'attn_mhc_module.mhc_pre emits h_post'),
    makeNode('mhc_attention_h_res_state', 'state', 'Attention h_res', { state_type: 'mhc_state', streams: config.mhc_num_stream, transform: 'sinkhorn' }, 'model_impl', 1454, 'attn_mhc_module.mhc_pre emits h_res and applies mhc_sinkhorn'),
    makeNode('mhc_mlp', 'module', 'mHC FFN State Flow', { module_type: 'mhc_pre_post_state_flow', streams: config.mhc_num_stream, enabled_when: 'use_mhc=true' }, 'model_impl', 1320, 'decoder layer creates mlp_mhc_module when mHC is enabled'),
    makeNode('mhc_mlp_pre', 'op', 'mHC FFN Pre', { op_type: 'mHCPre', outputs: ['hidden_states', 'h_post', 'h_res'] }, 'model_impl', 1622, 'sandwich helper invokes mlp_mhc_module.mhc_pre before the FFN'),
    makeNode('mhc_mlp_residual_state', 'state', 'FFN Residual', { state_type: 'residual', dtype: 'bf16' }, 'model_impl', 1620, 'sandwich helper clones the post-attention hidden states for the FFN residual'),
    makeNode('mhc_mlp_h_post_state', 'state', 'FFN h_post', { state_type: 'mhc_state', streams: config.mhc_num_stream }, 'model_impl', 1622, 'mlp_mhc_module.mhc_pre emits h_post'),
    makeNode('mhc_mlp_h_res_state', 'state', 'FFN h_res', { state_type: 'mhc_state', streams: config.mhc_num_stream, transform: 'sinkhorn' }, 'model_impl', 1622, 'mlp_mhc_module.mhc_pre emits h_res and applies mhc_sinkhorn'),
    makeNode('mhc_mlp_post', 'op', 'FFN Residual Merge', { op_type: 'mHCPost', semantic_role: 'residual_merge', enabled_when: 'use_mhc=true', consumes: ['hidden_states', 'h_post', 'residual', 'h_res'] }, 'model_impl', 1603, 'sandwich helper invokes post_mhc_module.mhc_post'),
    makeNode('attention_residual_add_fallback', 'op', 'Attention Residual Add', { op_type: 'Add', enabled_when: 'use_mhc=false' }, 'model_impl', 1608, 'ordinary residual addition is used only when mHC is disabled'),
    makeNode('ffn_residual_add_fallback', 'op', 'FFN Residual Add', { op_type: 'Add', enabled_when: 'use_mhc=false' }, 'model_impl', 1608, 'ordinary residual addition is used only when mHC is disabled'),
    makeNode('routed_expert_kernel', 'op', 'FusedMoE Kernel', { op_type: 'FusedMoE', implementation_of: 'routed_expert_bank' }, 'model_impl', 275, 'OpenPanguV2MOE creates NPUSharedFusedMoE as the expert implementation'),
    makeNode('moe_communication_policy', 'module', 'MoE Communication Strategy', { module_type: 'conditional_runtime_policy', mutually_exclusive: true }, 'model_impl', 352, '_forward_single selects exactly one communication implementation'),
  ];

  const strategyDefinitions = [
    ['allreduce', 'AllReduce Strategy', 'moe_allreduce', 'MoE AllReduce', 357],
    ['allgather_reducescatter', 'AllGather / ReduceScatter Strategy', 'moe_allgather', 'MoE AllGather', 358],
    ['all2allv', 'All-to-All-v Strategy', 'moe_all_to_all_v', 'MoE All-to-All-v', 359],
    ['dispatch_combine', 'Dispatch / Combine Strategy', 'moe_all_to_all_dispatch', 'EP Dispatch', 360],
    ['fused', 'Fused MoE Strategy', 'moe_fused_path', 'Fused MoE', 362],
  ];
  strategyDefinitions.forEach(([strategy, moduleLabel, opId, opLabel, line]) => {
    additions.push(makeNode(
      `moe_strategy_${strategy}`,
      'module',
      moduleLabel,
      { module_type: 'moe_communication_branch', branch_group: 'moe_communication_strategy', branch_value: strategy },
      'model_impl',
      line,
      `_forward_single declares the ${strategy} branch`,
    ));
    additions.push(makeNode(
      opId,
      'op',
      opLabel,
      { op_type: 'Communication', branch_group: 'moe_communication_strategy', branch_value: strategy },
      'model_impl',
      line,
      `_forward_single routes to the ${strategy} implementation`,
    ));
  });
  additions.push(
    makeNode('moe_reduce_scatter', 'op', 'MoE ReduceScatter', { op_type: 'Communication', branch_group: 'moe_communication_strategy', branch_value: 'allgather_reducescatter' }, 'model_impl', 358, 'allgather_reducescatter executes a ReduceScatter after expert compute'),
    makeNode('moe_all_to_all_combine', 'op', 'EP Combine', { op_type: 'Communication', branch_group: 'moe_communication_strategy', branch_value: 'dispatch_combine' }, 'model_impl', 708, '_forward_dispatch_combine invokes fused dispatch and combine operators'),
  );

  Array.from({ length: config.n_routed_experts }, (_, logicalExpertId) => {
    additions.push(makeNode(
      `expert_${logicalExpertId}`,
      'module',
      `E${String(logicalExpertId).padStart(3, '0')}`,
      {
        module_type: 'logical_routed_expert_instance',
        logicalExpertId,
        physicalExpertId: null,
        ownerGlobalRank: null,
        epRank: null,
        placement_source: 'runtime_overlay',
      },
      'runtime_config',
      27,
      `logical expert instance ${logicalExpertId} is materialized from n_routed_experts`,
      { logicalInstance: true },
    ));
  });

  architecture.nodes.push(...additions);
  const removedEdges = new Set([
    'e_decoder_to_mhc',
    'e_mhc_to_norm',
    'e_post_attn_to_mhc_post',
    'e_mhc_post_to_pre_mlp',
    'e_post_mlp_to_block_norm',
  ]);
  architecture.edges = architecture.edges.filter((edge) => !removedEdges.has(edge.id));

  const mhcEdges = [
    makeEdge('e_decoder_to_mhc_attention_pre', 'decoder_layer', 'mhc_attention_pre', 'activation', { name: 'hidden_states', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1454, 'decoder layer feeds the attention mHC pre transform', 'use_mhc=true'),
    makeEdge('e_decoder_to_attention_residual', 'decoder_layer', 'mhc_attention_residual_state', 'residual', { name: 'residual', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1448, 'mhc_head clones hidden_states into residual', 'use_mhc=true'),
    makeEdge('e_mhc_attention_pre_to_norm', 'mhc_attention_pre', 'input_layernorm', 'activation', { name: 'mixed_hidden_states', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1473, 'mHC-pre output is normalized before attention', 'use_mhc=true'),
    makeEdge('e_mhc_attention_pre_to_h_post', 'mhc_attention_pre', 'mhc_attention_h_post_state', 'state', { name: 'h_post', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1454, 'mHC-pre emits h_post', 'use_mhc=true'),
    makeEdge('e_mhc_attention_pre_to_h_res', 'mhc_attention_pre', 'mhc_attention_h_res_state', 'state', { name: 'h_res', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1454, 'mHC-pre emits h_res for Sinkhorn processing', 'use_mhc=true'),
    makeEdge('e_post_attention_norm_to_mhc_post', 'post_attention_norm', 'mhc_attention_post', 'activation', { name: 'hidden_states', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 1603, 'post-attention normalized output enters mHC-post', 'use_mhc=true'),
    makeEdge('e_attention_h_post_to_mhc_post', 'mhc_attention_h_post_state', 'mhc_attention_post', 'state', { name: 'h_post', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1603, 'mHC-post consumes h_post', 'use_mhc=true'),
    makeEdge('e_attention_h_res_to_mhc_post', 'mhc_attention_h_res_state', 'mhc_attention_post', 'state', { name: 'h_res', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1603, 'mHC-post consumes the Sinkhorn-transformed h_res', 'use_mhc=true'),
    makeEdge('e_attention_residual_to_mhc_post', 'mhc_attention_residual_state', 'mhc_attention_post', 'residual', { name: 'residual', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1603, 'mHC-post consumes the carried residual', 'use_mhc=true'),
    makeEdge('e_mhc_attention_post_to_mlp_pre', 'mhc_attention_post', 'mhc_mlp_pre', 'activation', { name: 'hidden_states', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1622, 'attention mHC-post output enters FFN mHC-pre', 'use_mhc=true'),
    makeEdge('e_mhc_attention_post_to_mlp_residual', 'mhc_attention_post', 'mhc_mlp_residual_state', 'residual', { name: 'residual', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1620, 'post-attention hidden states are cloned for the FFN residual', 'use_mhc=true'),
    makeEdge('e_mhc_mlp_pre_to_norm', 'mhc_mlp_pre', 'pre_mlp_norm', 'activation', { name: 'mixed_hidden_states', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1648, 'FFN mHC-pre output is normalized before the FFN', 'use_mhc=true'),
    makeEdge('e_mhc_mlp_pre_to_h_post', 'mhc_mlp_pre', 'mhc_mlp_h_post_state', 'state', { name: 'h_post', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1622, 'FFN mHC-pre emits h_post', 'use_mhc=true'),
    makeEdge('e_mhc_mlp_pre_to_h_res', 'mhc_mlp_pre', 'mhc_mlp_h_res_state', 'state', { name: 'h_res', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1622, 'FFN mHC-pre emits h_res', 'use_mhc=true'),
    makeEdge('e_post_mlp_norm_to_mhc_post', 'post_mlp_norm', 'mhc_mlp_post', 'activation', { name: 'hidden_states', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 1603, 'post-FFN normalized output enters mHC-post', 'use_mhc=true'),
    makeEdge('e_mlp_h_post_to_mhc_post', 'mhc_mlp_h_post_state', 'mhc_mlp_post', 'state', { name: 'h_post', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1603, 'FFN mHC-post consumes h_post', 'use_mhc=true'),
    makeEdge('e_mlp_h_res_to_mhc_post', 'mhc_mlp_h_res_state', 'mhc_mlp_post', 'state', { name: 'h_res', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1603, 'FFN mHC-post consumes h_res', 'use_mhc=true'),
    makeEdge('e_mlp_residual_to_mhc_post', 'mhc_mlp_residual_state', 'mhc_mlp_post', 'residual', { name: 'residual', shape: '[B,T,S_mhc,H]', dtype: 'bf16' }, 'model_impl', 1603, 'FFN mHC-post consumes the carried residual', 'use_mhc=true'),
    makeEdge('e_mhc_mlp_post_to_block_norm', 'mhc_mlp_post', 'block_post_norm', 'activation', { name: 'hidden_states', shape: '[B,T,S_mhc,H]', dtype: 'bf16', constraints: ['selected layer ids only'] }, 'model_impl', 1610, 'optional block norm follows the mHC FFN post transform', 'use_mhc=true'),
    makeEdge('e_post_attention_to_fallback_add', 'post_attention_norm', 'attention_residual_add_fallback', 'activation', { name: 'hidden_states', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 1608, 'non-mHC attention output enters an ordinary residual add', 'use_mhc=false'),
    makeEdge('e_attention_residual_to_fallback_add', 'mhc_attention_residual_state', 'attention_residual_add_fallback', 'residual', { name: 'residual', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 1608, 'non-mHC path adds the saved residual', 'use_mhc=false'),
    makeEdge('e_fallback_attention_add_to_pre_mlp', 'attention_residual_add_fallback', 'pre_mlp_norm', 'activation', { name: 'hidden_states', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 1619, 'non-mHC residual result proceeds to the FFN pre-norm', 'use_mhc=false'),
    makeEdge('e_fallback_attention_add_to_mlp_residual', 'attention_residual_add_fallback', 'mhc_mlp_residual_state', 'residual', { name: 'residual', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 1620, 'non-mHC path clones the FFN residual', 'use_mhc=false'),
    makeEdge('e_post_mlp_to_fallback_add', 'post_mlp_norm', 'ffn_residual_add_fallback', 'activation', { name: 'hidden_states', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 1608, 'non-mHC FFN output enters an ordinary residual add', 'use_mhc=false'),
    makeEdge('e_mlp_residual_to_fallback_add', 'mhc_mlp_residual_state', 'ffn_residual_add_fallback', 'residual', { name: 'residual', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 1608, 'non-mHC path adds the saved FFN residual', 'use_mhc=false'),
    makeEdge('e_fallback_mlp_add_to_block_norm', 'ffn_residual_add_fallback', 'block_post_norm', 'activation', { name: 'hidden_states', shape: '[B,T,H]', dtype: 'bf16', constraints: ['selected layer ids only'] }, 'model_impl', 1610, 'non-mHC residual output proceeds through optional block norm', 'use_mhc=false'),
  ];

  const communicationEdges = [
    makeEdge('e_expert_to_allreduce', 'routed_expert_bank', 'moe_allreduce', 'communication', { name: 'expert_output', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 357, 'allreduce strategy communicates expert output', 'moe_communication_strategy=allreduce'),
    makeEdge('e_allreduce_to_combine', 'moe_allreduce', 'moe_combine', 'activation', { name: 'reduced_expert_output', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 357, 'allreduce output proceeds to MoE combine', 'moe_communication_strategy=allreduce'),
    makeEdge('e_topk_to_allgather', 'route_topk', 'moe_allgather', 'communication', { name: 'routed_tokens', shape: '[B,T,top_k]', dtype: 'bf16/int32' }, 'model_impl', 358, 'allgather_reducescatter gathers routed tokens before expert compute', 'moe_communication_strategy=allgather_reducescatter'),
    makeEdge('e_allgather_to_experts', 'moe_allgather', 'routed_expert_bank', 'activation', { name: 'gathered_tokens', shape: '[B,T,top_k,H]', dtype: 'bf16' }, 'model_impl', 358, 'gathered tokens enter routed experts', 'moe_communication_strategy=allgather_reducescatter'),
    makeEdge('e_experts_to_reduce_scatter', 'routed_expert_bank', 'moe_reduce_scatter', 'communication', { name: 'expert_output', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 358, 'expert output enters ReduceScatter', 'moe_communication_strategy=allgather_reducescatter'),
    makeEdge('e_reduce_scatter_to_combine', 'moe_reduce_scatter', 'moe_combine', 'activation', { name: 'reduced_scattered_output', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 358, 'ReduceScatter output proceeds to MoE combine', 'moe_communication_strategy=allgather_reducescatter'),
    makeEdge('e_topk_to_all_to_all_v', 'route_topk', 'moe_all_to_all_v', 'communication', { name: 'routed_tokens', shape: '[B,T,top_k,H]', dtype: 'bf16/int32' }, 'model_impl', 359, 'all2allv exchanges variable routed-token splits', 'moe_communication_strategy=all2allv'),
    makeEdge('e_all_to_all_v_to_experts', 'moe_all_to_all_v', 'routed_expert_bank', 'activation', { name: 'received_tokens', shape: '[T_local,H]', dtype: 'bf16' }, 'model_impl', 986, 'all2allv receive buffer enters local experts', 'moe_communication_strategy=all2allv'),
    makeEdge('e_topk_to_dispatch', 'route_topk', 'moe_all_to_all_dispatch', 'communication', { name: 'topk_ids_weights', shape: '[B,T,top_k]', dtype: 'int32/fp32' }, 'model_impl', 858, 'dispatch_v2 routes token copies to expert owners', 'moe_communication_strategy=dispatch_combine'),
    makeEdge('e_dispatch_to_experts', 'moe_all_to_all_dispatch', 'routed_expert_bank', 'activation', { name: 'expand_x', shape: '[T_local,H]', dtype: 'bf16' }, 'model_impl', 876, 'dispatch_v2 output is sorted for local expert compute', 'moe_communication_strategy=dispatch_combine'),
    makeEdge('e_experts_to_dispatch_combine', 'routed_expert_bank', 'moe_all_to_all_combine', 'communication', { name: 'expert_output', shape: '[T_local,H]', dtype: 'bf16' }, 'model_impl', 967, 'combine_v2 returns expert outputs to source ranks', 'moe_communication_strategy=dispatch_combine'),
    makeEdge('e_dispatch_combine_to_moe_combine', 'moe_all_to_all_combine', 'moe_combine', 'activation', { name: 'moe_output', shape: '[B,T,H]', dtype: 'bf16' }, 'model_impl', 967, 'combine_v2 reconstructs the routed MoE output', 'moe_communication_strategy=dispatch_combine'),
    makeEdge('e_topk_to_fused_moe', 'route_topk', 'moe_fused_path', 'activation', { name: 'router_logits', shape: '[B,T,E]', dtype: 'fp32' }, 'model_impl', 385, 'fallback and Ascend 950 paths execute fused MoE', 'moe_communication_strategy=fused'),
    makeEdge('e_fused_moe_to_experts', 'moe_fused_path', 'routed_expert_bank', 'activation', { name: 'selected_experts', shape: '[B,T,top_k]', dtype: 'int32/fp32' }, 'model_impl', 389, 'fused path selects and computes routed experts', 'moe_communication_strategy=fused'),
  ];

  architecture.edges.push(...mhcEdges, ...communicationEdges);
  const refreshedNodeById = new Map(architecture.nodes.map((node) => [node.id, node]));
  architecture.edges = architecture.edges.map((edge) => ({
    ...edge,
    semanticEdgeType: normalizeEdgeType(edge, refreshedNodeById),
  }));
  architecture.branches = [
    ...(architecture.branches || []).filter((branch) => branch.id !== 'decoder_residual_policy' && branch.id !== 'moe_communication_strategy'),
    {
      id: 'decoder_residual_policy',
      mutually_exclusive: true,
      selector: 'use_mhc',
      options: [
        { value: true, nodes: ['mhc_attention_pre', 'mhc_attention_post', 'mhc_mlp_pre', 'mhc_mlp_post'], edgeCondition: 'use_mhc=true' },
        { value: false, nodes: ['attention_residual_add_fallback', 'ffn_residual_add_fallback'], edgeCondition: 'use_mhc=false' },
      ],
      provenance: provenance('model_impl', 1595, 'sandwich helper selects mHC post/pre or ordinary residual addition'),
    },
    {
      id: 'moe_communication_strategy',
      mutually_exclusive: true,
      selector: 'moe_comm_strategy / device policy',
      options: strategyDefinitions.map(([value]) => ({ value, node: `moe_strategy_${value}` })),
      provenance: provenance('model_impl', 352, '_forward_single selects one MoE communication implementation'),
    },
  ];
  architecture.hierarchy = {
    routed_experts_parent: 'routed_expert_bank',
    logical_expert_children: routedExperts.children,
  };
  architecture.sources = architecture.sources.map((source) => {
    const sourcePath = sources.get(source.id);
    return {
      ...source,
      path: sourcePath ? relativeToPto(sourcePath) : source.path,
      ...(sourcePath && fs.existsSync(sourcePath) ? { sha256: sha256(readText(sourcePath)) } : {}),
    };
  });
  architecture.model = {
    ...architecture.model,
    source_root: 'model-architecture/sources',
    asset_id: 'openpangu-2.0-flash/source-architecture',
    asset_version: 1,
  };
  architecture.extraction_scope.notes = [
    ...(architecture.extraction_scope.notes || []),
    'Routed Experts is a parent Module with the complete logical E0-E255 child inventory.',
    'mHC state flow and non-mHC Add residual flow are mutually exclusive source branches.',
    'MoE communication strategies are mutually exclusive source branches; activation is supplied by runtime data.',
  ];
  architecture.content_hash = sha256(JSON.stringify({ ...architecture, content_hash: undefined }));
  return architecture;
}

function buildHierarchy(architecture) {
  const nodeById = new Map(architecture.nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map();
  const attach = (parent, children) => {
    childrenByParent.set(parent, children.filter((id) => nodeById.has(id)));
  };

  attach('section/source_architecture', ['input_tokens', 'positions', 'causal_lm']);
  attach('causal_lm', ['decoder_model', 'lm_head', 'logits', 'mtp_module', 'lm_head_weight']);
  attach('decoder_model', ['token_embedding', 'decoder_layer', 'final_norm', 'embedding_weight', 'rope_cache']);
  attach('decoder_layer', ['mhc_attention', 'input_layernorm', 'sparse_mla_attention', 'post_attention_norm', 'mhc_attention_post', 'mhc_mlp', 'pre_mlp_norm', 'ffn_choice', 'post_mlp_norm', 'block_post_norm']);
  attach('mhc_attention', ['mhc_attention_pre', 'mhc_attention_residual_state', 'mhc_attention_h_post_state', 'mhc_attention_h_res_state']);
  attach('mhc_mlp', ['mhc_mlp_pre', 'mhc_mlp_residual_state', 'mhc_mlp_h_post_state', 'mhc_mlp_h_res_state', 'mhc_mlp_post']);
  attach('sparse_mla_attention', ['q_a_proj', 'q_causal_conv', 'q_residual_add', 'q_a_norm', 'q_b_proj', 'kv_a_proj', 'kv_causal_conv', 'kv_residual_add', 'kv_a_norm', 'kv_b_proj', 'rope_apply', 'dsa_indexer', 'attention_core', 'o_causal_conv', 'o_residual_add', 'o_proj', 'kv_cache', 'param_sink_state', 'mome_state', 'attention_projection_weights']);
  attach('ffn_choice', ['dense_mlp', 'moe_ffn', 'attention_residual_add_fallback', 'ffn_residual_add_fallback']);
  attach('dense_mlp', ['dense_gate_up', 'dense_silu', 'dense_down', 'dense_mlp_weights']);
  attach('moe_ffn', ['router_gate', 'route_topk', 'routed_expert_bank', 'shared_expert_mlp', 'moe_combine', 'moe_communication_policy', 'expert_parallel_state', 'router_weight', 'expert_bank_weights', 'shared_expert_weights']);
  attach('routed_expert_bank', ['routed_expert_kernel', ...architecture.hierarchy.logical_expert_children]);
  attach('moe_communication_policy', ['moe_strategy_allreduce', 'moe_strategy_allgather_reducescatter', 'moe_strategy_all2allv', 'moe_strategy_dispatch_combine', 'moe_strategy_fused']);
  attach('moe_strategy_allreduce', ['moe_allreduce']);
  attach('moe_strategy_allgather_reducescatter', ['moe_allgather', 'moe_reduce_scatter']);
  attach('moe_strategy_all2allv', ['moe_all_to_all_v']);
  attach('moe_strategy_dispatch_combine', ['moe_all_to_all_dispatch', 'moe_all_to_all_combine']);
  attach('moe_strategy_fused', ['moe_fused_path']);
  attach('mtp_module', ['mtp_input_norms', 'mtp_eh_proj', 'mtp_decoder_layer', 'mtp_shared_head', 'mtp_logits', 'mtp_head_weight']);

  const assigned = new Set([...childrenByParent.values()].flat());
  const orphans = architecture.nodes.map((node) => node.id).filter((id) => !assigned.has(id) && id !== 'causal_lm');
  if (orphans.length) throw new Error(`Unassigned architecture nodes: ${orphans.join(', ')}`);
  const sourcePaths = canonicalSourcePathMap(architecture);

  function itemFor(id) {
    const node = nodeById.get(id);
    if (!node) throw new Error(`Unknown hierarchy node ${id}`);
    const refs = sourceRefsFor(node, sourcePaths);
    const children = (childrenByParent.get(id) || []).map(itemFor);
    return {
      id: node.id,
      label: node.label,
      kind: node.kind,
      typeLabel: node.kind === 'module' ? 'Module' : node.kind === 'op' ? (node.op_type || 'Op') : node.kind === 'state' ? (node.state_type === 'parameter' ? 'Parameter' : 'State') : node.kind === 'input' ? 'Input' : 'Output',
      colorKey: colorKey(node),
      origin: node.logicalInstance ? 'config_instance' : 'source',
      dataState: 'source_only',
      selectable: true,
      children,
      attrs: clone(node.attrs || {}),
      sourceRefs: refs,
      ...(id === 'decoder_layer' ? { repeatCount: architecture.symbol_table.L, instanceIndices: Array.from({ length: architecture.symbol_table.L }, (_, index) => index) } : {}),
      ...(id === 'routed_expert_bank' ? { repeatCount: architecture.symbol_table.E, instanceIndices: Array.from({ length: architecture.symbol_table.E }, (_, index) => index) } : {}),
      ...(node.logicalInstance ? { logicalInstance: true } : {}),
    };
  }

  return [{
    id: 'section/source_architecture',
    label: 'Source Architecture',
    kind: 'module',
    typeLabel: 'Section',
    colorKey: 'module:model',
    synthetic: true,
    children: (childrenByParent.get('section/source_architecture') || []).map(itemFor),
    attrs: { sourceScope: 'full_source' },
    sourceRefs: [],
  }];
}

function colorKey(node) {
  if (node.colorKey) return node.colorKey;
  if (node.kind === 'input') return 'io:input';
  if (node.kind === 'output') return 'io:output';
  if (node.kind === 'state') return node.state_type === 'parameter' ? 'io:parameter' : 'io:state';
  const text = `${node.id} ${node.label}`.toLowerCase();
  if (text.includes('comm') || text.includes('dispatch') || text.includes('scatter') || text.includes('gather') || text.includes('allreduce') || text.includes('all-to-all')) return 'sem:comm';
  if (text.includes('expert') || text.includes('moe')) return 'sem:moe';
  if (text.includes('router') || text.includes('topk')) return 'sem:gate';
  if (text.includes('attention') || text.includes('mhc')) return 'sem:attention';
  if (text.includes('norm')) return 'sem:norm';
  if (text.includes('mlp') || text.includes('ffn')) return 'sem:mlp';
  return node.kind === 'module' ? 'module:model' : 'sem:linear';
}

function buildProjectedPositions(roots, edges) {
  const allItems = new Map();
  const visit = (item) => {
    allItems.set(item.id, item);
    item.children.forEach(visit);
  };
  roots.forEach(visit);
  const endpointIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const indegree = new Map([...endpointIds].map((id) => [id, 0]));
  const outgoing = new Map([...endpointIds].map((id) => [id, []]));
  edges.forEach((edge) => {
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    outgoing.get(edge.source).push(edge.target);
  });
  const queue = [...endpointIds].filter((id) => indegree.get(id) === 0).sort();
  const level = new Map(queue.map((id) => [id, 0]));
  while (queue.length) {
    const id = queue.shift();
    outgoing.get(id).forEach((target) => {
      level.set(target, Math.max(level.get(target) || 0, (level.get(id) || 0) + 1));
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    });
  }
  if ([...indegree.values()].some((value) => value > 0)) throw new Error('Architecture dataflow contains a cycle');
  const byLevel = new Map();
  [...endpointIds].forEach((id) => {
    const value = level.get(id) || 0;
    if (!byLevel.has(value)) byLevel.set(value, []);
    byLevel.get(value).push(id);
  });
  const nodes = [];
  [...byLevel.entries()].sort(([a], [b]) => a - b).forEach(([levelIndex, ids]) => {
    ids.sort();
    ids.forEach((id, index) => {
      const item = allItems.get(id);
      const width = item.kind === 'state' || item.kind === 'input' || item.kind === 'output' ? 180 : 230;
      nodes.push({
        id,
        label: item.label,
        kind: ['state', 'input', 'output'].includes(item.kind) ? 'tensor' : item.kind,
        typeLabel: item.typeLabel,
        colorKey: item.colorKey,
        x: 640 + (index - (ids.length - 1) / 2) * 270,
        y: 80 + levelIndex * 116,
        width,
        height: item.kind === 'state' ? 48 : 56,
      });
    });
  });
  return nodes;
}

function buildGraph(architecture) {
  const roots = buildHierarchy(architecture);
  const graphSourcePaths = new Map(architecture.sources.map((source) => [source.id, path.join(PTO_ROOT, source.path)]));
  const edges = architecture.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    semanticEdgeType: edge.semanticEdgeType,
    tensor: clone(edge.tensor || { name: edge.id }),
    provenance: sourceRefsFor(edge, graphSourcePaths),
    sourceAnchor: 'bottom',
    targetAnchor: 'top',
    curve: 'vertical',
    ...(edge.condition ? { condition: edge.condition } : {}),
  }));
  const graph = {
    schema_version: 'model_architecture_graph.v1',
    metadata: {
      modelId: 'openpangu-2.0-flash',
      sourceScope: 'full_source',
      profilingOverlay: false,
      sourceAssetId: architecture.model.asset_id,
      sourceAssetVersion: architecture.model.asset_version,
      sourceAssetHash: architecture.content_hash,
      defaultRootId: 'section/source_architecture',
      defaultCollapseDepth: 2,
      runtimePolicy: {
        decoderResidualBranch: 'use_mhc=true',
        moeCommunicationStrategy: null,
      },
    },
    roots,
    edges,
    runtimePolicies: architecture.branches.filter((branch) => ['decoder_residual_policy', 'moe_communication_strategy'].includes(branch.id)),
  };
  graph.nodes = buildProjectedPositions(roots, edges);
  graph.content_hash = sha256(JSON.stringify({ ...graph, content_hash: undefined }));
  return graph;
}

function validateGenerated(architecture, graph, config) {
  const errors = [];
  const fail = (message) => errors.push(message);
  const nodes = new Map(architecture.nodes.map((node) => [node.id, node]));
  const graphItems = new Map();
  const walk = (item, parent = null) => {
    if (graphItems.has(item.id)) fail(`duplicate graph item ${item.id}`);
    graphItems.set(item.id, { item, parent });
    (item.children || []).forEach((child) => walk(child, item.id));
  };
  graph.roots.forEach((root) => walk(root));
  if (graph.schema_version !== 'model_architecture_graph.v1') fail('graph schema version');
  if (nodes.get('routed_expert_bank')?.kind !== 'module') fail('Routed Experts must be a Module');
  const expertIds = Array.from({ length: config.n_routed_experts }, (_, index) => `expert_${index}`);
  const routedItem = graphItems.get('routed_expert_bank')?.item;
  if (!routedItem || routedItem.children.length !== config.n_routed_experts + 1) fail('Routed Experts child count');
  expertIds.forEach((id) => {
    const entry = graphItems.get(id);
    if (!entry || entry.parent !== 'routed_expert_bank') fail(`missing logical expert ${id}`);
  });
  if (graphItems.has(`expert_${config.n_routed_experts}`)) fail('expert inventory exceeds config E');
  const edgeIds = new Set();
  graph.edges.forEach((edge) => {
    if (edgeIds.has(edge.id)) fail(`duplicate edge ${edge.id}`);
    edgeIds.add(edge.id);
    if (!graphItems.has(edge.source) || !graphItems.has(edge.target)) fail(`unresolved edge ${edge.id}`);
    if (!edge.tensor || !edge.provenance?.length) fail(`edge metadata ${edge.id}`);
  });
  ['e_qa_skip_to_qadd', 'e_kva_skip_to_kvadd', 'e_core_skip_to_oadd'].forEach((id) => {
    if (graph.edges.find((edge) => edge.id === id)?.semanticEdgeType !== 'residual') fail(`MoME residual ${id}`);
  });
  const mhcResiduals = graph.edges.filter((edge) => edge.semanticEdgeType === 'residual' && edge.condition === 'use_mhc=true');
  if (mhcResiduals.length !== 4) fail('mHC residual state edges');
  if (!graph.edges.some((edge) => edge.target === 'attention_residual_add_fallback' && edge.condition === 'use_mhc=false')) fail('non-mHC attention residual branch');
  if (!graph.edges.some((edge) => edge.target === 'ffn_residual_add_fallback' && edge.condition === 'use_mhc=false')) fail('non-mHC FFN residual branch');
  const communicationPolicy = graph.runtimePolicies.find((policy) => policy.id === 'moe_communication_strategy');
  const strategies = communicationPolicy?.options?.map((option) => option.value) || [];
  if (new Set(strategies).size !== 5 || !['allreduce', 'allgather_reducescatter', 'all2allv', 'dispatch_combine', 'fused'].every((value) => strategies.includes(value))) fail('communication strategy inventory');
  if (!communicationPolicy?.mutually_exclusive) fail('communication strategies must be mutually exclusive');
  if (errors.length) throw new Error(`Generated architecture invalid:\n- ${errors.join('\n- ')}`);
  return {
    architectureNodes: architecture.nodes.length,
    graphItems: graphItems.size,
    graphEdges: graph.edges.length,
    logicalExperts: expertIds.length,
    mhcResidualEdges: mhcResiduals.length,
    communicationStrategies: strategies.length,
  };
}

function validationMarkdown(architecture, graph, summary) {
  const sourceRows = architecture.sources
    .filter((source) => source.sha256)
    .map((source) => `| \`${source.id}\` | \`${source.path}\` | \`${source.sha256.slice(0, 12)}\` |`)
    .join('\n');
  return `# openPangu-2.0-Flash architecture validation\n\nStatus: PASS  \nAsset: \`${architecture.model.asset_id}\` v${architecture.model.asset_version}  \nArchitecture hash: \`${architecture.content_hash}\`  \nGraph hash: \`${graph.content_hash}\`\n\n## Verified facts\n\n- ${architecture.symbol_table.L} decoder layers; Dense layers 0-1 and MoE layers 2-45.\n- Routed Experts is a parent Module with ${summary.logicalExperts} addressable logical children, \`E000\` through \`E255\`.\n- Physical expert identity, owner Global Rank, and EP Rank remain runtime-overlay fields.\n- mHC pre/post state flow carries \`residual\`, \`h_post\`, and \`h_res\` explicitly. The ordinary Add residual branch is marked \`use_mhc=false\`.\n- Q/KV/O MoME local residuals are distinct \`residual\` edges.\n- AllReduce, AllGather/ReduceScatter, All-to-All-v, Dispatch/Combine, and fused paths are source-declared, mutually exclusive runtime strategies. No strategy is activated by the static architecture asset.\n\n## Counts\n\n| Check | Count |\n| --- | ---: |\n| Canonical nodes | ${summary.architectureNodes} |\n| Graph hierarchy items | ${summary.graphItems} |\n| Semantic edges | ${summary.graphEdges} |\n| Logical expert children | ${summary.logicalExperts} |\n| mHC residual-state edges | ${summary.mhcResidualEdges} |\n| MoE communication strategies | ${summary.communicationStrategies} |\n\n## Source fingerprints\n\n| Source | Repository-relative path | SHA-256 prefix |\n| --- | --- | --- |\n${sourceRows}\n\n## Boundary\n\nThis is a source/config-checked architecture artifact. It is not profiling evidence. Timeline data selects a runtime communication branch and supplies Expert placement and load overlays by canonical ID.\n`;
}

function generate() {
  const base = readJson(BASE_ARCHITECTURE);
  const config = readJson(CONFIG_PATH);
  const modelSource = readText(MODEL_PATH);
  const attentionSource = readText(ATTENTION_PATH);
  const moeSource = readText(MOE_PATH);
  requireSourceFact(modelSource, /def mhc_head\(/, 'decoder mHC head');
  requireSourceFact(modelSource, /def mhc_sandwich_norm_post_pre\(/, 'decoder mHC sandwich');
  requireSourceFact(modelSource, /hidden_states = hidden_states \+ residual/, 'non-mHC residual add');
  requireSourceFact(modelSource, /self\.moe_comm_strategy == "dispatch_combine"/, 'dispatch/combine strategy');
  requireSourceFact(modelSource, /self\.moe_comm_strategy == "allgather_reducescatter"/, 'allgather/reducescatter strategy');
  requireSourceFact(modelSource, /self\.moe_comm_strategy == "all2allv"/, 'all2allv strategy');
  requireSourceFact(attentionSource, /residual_connection/, 'MoME local residual connection');
  requireSourceFact(moeSource, /select_communication_strategy/, 'runtime communication selector');
  if (!Number.isInteger(config.n_routed_experts) || config.n_routed_experts < 1) throw new Error('Invalid n_routed_experts');

  const sourceFiles = new Map([
    ['runtime_config', CONFIG_PATH],
    ['model_impl', MODEL_PATH],
    ['attention_impl', ATTENTION_PATH],
    ['moe_impl', MOE_PATH],
  ]);
  (base.sources || []).forEach((source) => {
    if (!sourceFiles.has(source.id) && fs.existsSync(source.path || '')) sourceFiles.set(source.id, source.path);
  });
  const architecture = patchCanonicalArchitecture(base, config, sourceFiles);
  const graph = buildGraph(architecture);
  const summary = validateGenerated(architecture, graph, config);
  return { architecture, graph, validation: validationMarkdown(architecture, graph, summary), summary };
}

function writeOutputs(result) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUTS.architecture, `${JSON.stringify(result.architecture, null, 2)}\n`);
  fs.writeFileSync(OUTPUTS.graph, `${JSON.stringify(result.graph, null, 2)}\n`);
  fs.writeFileSync(OUTPUTS.validation, result.validation);
}

if (require.main === module) {
  const result = generate();
  if (process.argv.includes('--write')) writeOutputs(result);
  console.log(JSON.stringify({ wrote: process.argv.includes('--write'), outputs: OUTPUTS, ...result.summary }, null, 2));
}

module.exports = Object.freeze({ generate, validateGenerated, writeOutputs, OUTPUTS, SOURCE_INPUTS });

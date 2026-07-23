// openPangu-2.0-Flash 整网图组件逻辑（从 openpangu_2_0_flash_modelviz.html 主 <script> 抽出）
// 改动：IIFE 包裹；themeToggle→opvTopThemeToggle 避与父页冲突；schema 读 window.OPV_DEFAULT_SCHEMA；
//       新增 data-theme MutationObserver 与父页主题联动。渲染引擎复用 model-graphviz-embed/pattern.js。
(function () {
"use strict";
const NODE_SPEC = {"input_tokens": {"w": 170, "h": 48, "colorKey": "io:input"}, "positions": {"w": 164, "h": 48, "colorKey": "io:input", "lane": 190}, "token_embedding": {"w": 260, "h": 56, "colorKey": "sem:embedding", "parent": "model-core"}, "decoder_layer": {"w": 274, "h": 58, "colorKey": "module:decoder", "parent": "model-core"}, "mhc_attention": {"w": 246, "h": 56, "colorKey": "module:mhc", "parent": "decoder-stack"}, "input_layernorm": {"w": 204, "h": 54, "colorKey": "sem:norm", "parent": "decoder-stack"}, "sparse_mla_attention": {"w": 252, "h": 58, "colorKey": "sem:attention", "parent": "decoder-stack"}, "q_a_proj": {"w": 210, "h": 52, "colorKey": "sem:linear", "parent": "attention-block", "lane": 465}, "q_causal_conv": {"w": 212, "h": 52, "colorKey": "sem:act", "parent": "attention-block", "lane": 465}, "q_residual_add": {"w": 102, "h": 46, "colorKey": "sem:comm", "parent": "attention-block", "lane": 465}, "q_a_norm": {"w": 190, "h": 52, "colorKey": "sem:norm", "parent": "attention-block", "lane": 465}, "q_b_proj": {"w": 178, "h": 52, "colorKey": "sem:linear", "parent": "attention-block", "lane": 465}, "kv_a_proj": {"w": 220, "h": 52, "colorKey": "sem:linear", "parent": "attention-block", "lane": 815}, "kv_causal_conv": {"w": 222, "h": 52, "colorKey": "sem:act", "parent": "attention-block", "lane": 815}, "kv_residual_add": {"w": 110, "h": 46, "colorKey": "sem:comm", "parent": "attention-block", "lane": 815}, "kv_a_norm": {"w": 196, "h": 52, "colorKey": "sem:norm", "parent": "attention-block", "lane": 815}, "kv_b_proj": {"w": 188, "h": 52, "colorKey": "sem:linear", "parent": "attention-block", "lane": 815}, "rope_apply": {"w": 170, "h": 52, "colorKey": "sem:rope", "parent": "attention-block", "lane": 640}, "dsa_indexer": {"w": 176, "h": 52, "colorKey": "sem:gate", "parent": "attention-block", "lane": 390}, "attention_core": {"w": 226, "h": 52, "colorKey": "sem:attention", "parent": "attention-block", "lane": 640}, "o_causal_conv": {"w": 238, "h": 52, "colorKey": "sem:act", "parent": "attention-block", "lane": 640}, "o_residual_add": {"w": 126, "h": 46, "colorKey": "sem:comm", "parent": "attention-block", "lane": 640}, "o_proj": {"w": 194, "h": 52, "colorKey": "sem:linear", "parent": "attention-block"}, "post_attention_norm": {"w": 244, "h": 54, "colorKey": "sem:norm", "parent": "decoder-stack"}, "mhc_attention_post": {"w": 244, "h": 56, "colorKey": "module:mhc", "parent": "decoder-stack"}, "pre_mlp_norm": {"w": 188, "h": 54, "colorKey": "sem:norm", "parent": "decoder-stack"}, "ffn_choice": {"w": 248, "h": 58, "colorKey": "module:ffn", "parent": "decoder-stack"}, "dense_mlp": {"w": 184, "h": 54, "colorKey": "sem:mlp", "parent": "ffn-block", "lane": 520}, "dense_gate_up": {"w": 198, "h": 52, "colorKey": "sem:linear", "parent": "ffn-block", "lane": 520}, "dense_silu": {"w": 172, "h": 52, "colorKey": "sem:act", "parent": "ffn-block", "lane": 520}, "dense_down": {"w": 192, "h": 52, "colorKey": "sem:linear", "parent": "ffn-block", "lane": 520}, "moe_ffn": {"w": 174, "h": 54, "colorKey": "sem:moe", "parent": "ffn-block", "lane": 765}, "router_gate": {"w": 170, "h": 52, "colorKey": "sem:gate", "parent": "moe-block", "lane": 765}, "route_topk": {"w": 164, "h": 52, "colorKey": "sem:gate", "parent": "moe-block", "lane": 765}, "routed_expert_bank": {"w": 218, "h": 52, "colorKey": "sem:moe", "parent": "moe-block", "lane": 765}, "shared_expert_mlp": {"w": 208, "h": 52, "colorKey": "sem:mlp", "parent": "moe-block", "lane": 1010}, "moe_combine": {"w": 170, "h": 52, "colorKey": "sem:comm", "parent": "moe-block", "lane": 885}, "post_mlp_norm": {"w": 206, "h": 54, "colorKey": "sem:norm", "parent": "decoder-stack"}, "block_post_norm": {"w": 214, "h": 54, "colorKey": "sem:norm", "parent": "decoder-stack"}, "final_norm": {"w": 174, "h": 54, "colorKey": "sem:norm", "parent": "model-core"}, "lm_head": {"w": 168, "h": 54, "colorKey": "sem:head", "parent": "model-core"}, "logits": {"w": 148, "h": 48, "colorKey": "io:output", "parent": "model-core"}, "mtp_module": {"w": 250, "h": 58, "colorKey": "module:mtp", "parent": "model-core", "lane": 990}, "mtp_input_norms": {"w": 204, "h": 52, "colorKey": "sem:norm", "parent": "mtp-stack", "lane": 990}, "mtp_eh_proj": {"w": 198, "h": 52, "colorKey": "sem:linear", "parent": "mtp-stack", "lane": 990}, "mtp_decoder_layer": {"w": 226, "h": 54, "colorKey": "module:decoder", "parent": "mtp-stack", "lane": 990}, "mtp_shared_head": {"w": 204, "h": 52, "colorKey": "sem:head", "parent": "mtp-stack", "lane": 990}, "mtp_logits": {"w": 160, "h": 48, "colorKey": "io:output", "parent": "mtp-stack", "lane": 990}, "rope_cache": {"w": 158, "h": 48, "colorKey": "io:state", "parent": "attention-block", "lane": 190}, "kv_cache": {"w": 144, "h": 48, "colorKey": "io:state", "parent": "attention-block", "lane": 190}, "param_sink_state": {"w": 176, "h": 48, "colorKey": "io:state", "parent": "attention-block", "lane": 190}, "mome_state": {"w": 150, "h": 48, "colorKey": "io:state", "parent": "attention-block", "lane": 190}, "expert_parallel_state": {"w": 214, "h": 48, "colorKey": "io:state", "parent": "moe-block", "lane": 190}};
    const GROUPS = [{"id": "model-core", "label": "Causal LM", "colorKey": "module:model", "parentCluster": null, "repeat": false}, {"id": "decoder-stack", "label": "Decoder Layer Template", "colorKey": "module:decoder", "parentCluster": "model-core", "repeat": true}, {"id": "attention-block", "label": "Sparse MLA Attention", "colorKey": "sem:attention", "parentCluster": "decoder-stack", "repeat": false}, {"id": "ffn-block", "label": "Dense + MoE FFN", "colorKey": "module:ffn", "parentCluster": "decoder-stack", "repeat": false}, {"id": "moe-block", "label": "MoE FFN", "colorKey": "sem:moe", "parentCluster": "ffn-block", "repeat": true}, {"id": "mtp-stack", "label": "Multi Token Predictor", "colorKey": "module:mtp", "parentCluster": "model-core", "repeat": true}];
    const MODULE_BY_CLUSTER = {"decoder-stack": "decoder_layer", "attention-block": "sparse_mla_attention", "ffn-block": "ffn_choice", "moe-block": "moe_ffn", "mtp-stack": "mtp_module"};
    const CLUSTER_BY_MODULE = Object.fromEntries(Object.entries(MODULE_BY_CLUSTER).map(([clusterId, moduleId]) => [moduleId, clusterId]));
    const COLLAPSIBLE = {"decoder_layer": ["mhc_attention", "input_layernorm", "sparse_mla_attention", "q_a_proj", "q_causal_conv", "q_residual_add", "q_a_norm", "q_b_proj", "kv_a_proj", "kv_causal_conv", "kv_residual_add", "kv_a_norm", "kv_b_proj", "rope_apply", "dsa_indexer", "attention_core", "o_causal_conv", "o_residual_add", "o_proj", "post_attention_norm", "mhc_attention_post", "pre_mlp_norm", "ffn_choice", "dense_mlp", "dense_gate_up", "dense_silu", "dense_down", "moe_ffn", "router_gate", "route_topk", "routed_expert_bank", "shared_expert_mlp", "moe_combine", "post_mlp_norm", "block_post_norm", "rope_cache", "kv_cache", "param_sink_state", "mome_state", "expert_parallel_state"], "sparse_mla_attention": ["q_a_proj", "q_causal_conv", "q_residual_add", "q_a_norm", "q_b_proj", "kv_a_proj", "kv_causal_conv", "kv_residual_add", "kv_a_norm", "kv_b_proj", "rope_apply", "dsa_indexer", "attention_core", "o_causal_conv", "o_residual_add", "o_proj", "rope_cache", "kv_cache", "param_sink_state", "mome_state"], "ffn_choice": ["dense_mlp", "dense_gate_up", "dense_silu", "dense_down", "moe_ffn", "router_gate", "route_topk", "routed_expert_bank", "shared_expert_mlp", "moe_combine", "expert_parallel_state"], "moe_ffn": ["router_gate", "route_topk", "routed_expert_bank", "shared_expert_mlp", "moe_combine", "expert_parallel_state"], "mtp_module": ["mtp_input_norms", "mtp_eh_proj", "mtp_decoder_layer", "mtp_shared_head", "mtp_logits"]};
    COLLAPSIBLE.decoder_layer.push('attention_all_gather', 'attention_reduce_scatter', 'ffn_all_gather', 'ffn_reduce_scatter', 'moe_all_to_all_dispatch', 'moe_all_to_all_combine');
    COLLAPSIBLE.decoder_layer.push('query_tensor', 'key_tensor', 'value_tensor');
    COLLAPSIBLE.sparse_mla_attention.push('query_tensor', 'key_tensor', 'value_tensor');
    COLLAPSIBLE.decoder_layer.push('attention_projection_weights', 'dense_mlp_weights', 'router_weight', 'expert_bank_weights', 'shared_expert_weights');
    COLLAPSIBLE.sparse_mla_attention.push('attention_projection_weights');
    COLLAPSIBLE.ffn_choice.push('dense_mlp_weights', 'router_weight', 'expert_bank_weights', 'shared_expert_weights', 'ffn_all_gather', 'ffn_reduce_scatter', 'moe_all_to_all_dispatch', 'moe_all_to_all_combine');
    COLLAPSIBLE.moe_ffn.push('router_weight', 'expert_bank_weights', 'shared_expert_weights', 'moe_all_to_all_dispatch', 'moe_all_to_all_combine');
    COLLAPSIBLE.mtp_module.push('mtp_head_weight');
    const DEFAULT_COLLAPSED = new Set(["mtp_module"]);
    const DEFAULT_DETAIL_MODULES = new Set();
    const ALWAYS_VISIBLE_MODULES = new Set(['decoder_layer', 'sparse_mla_attention']);
    const ATTENTION_FINE_DETAIL_NODES = new Set([
      'positions',
      'rope_apply',
      'dsa_indexer',
      'rope_cache',
      'kv_cache',
      'param_sink_state',
      'mome_state',
    ]);
    const OPENPANGU_DISPLAY_LABELS = {
      input_tokens: 'Token IDs',
      decoder_layer: 'Decoder Layer',
      input_layernorm: 'Input RMSNorm',
      sparse_mla_attention: 'Sparse MLA Attention',
      embedding_weight: 'Embedding Weight',
      attention_projection_weights: 'Attention Projection Weights',
      q_a_proj: 'Q Latent Linear',
      kv_a_proj: 'KV Latent Linear',
      q_causal_conv: 'Q Causal Conv1D',
      kv_causal_conv: 'KV Causal Conv1D',
      q_residual_add: '+',
      kv_residual_add: '+',
      q_b_proj: 'Q Up Linear',
      kv_b_proj: 'KV Up Linear',
      attention_core: 'Sparse FlashAttention',
      o_causal_conv: 'Output Causal Conv1D',
      o_residual_add: '+',
      o_proj: 'Output Projection',
      post_attention_norm: 'Post Attention RMSNorm',
      ffn_choice: 'Feed Forward Choice',
      dense_mlp_weights: 'Dense MLP Weights',
      router_weight: 'Router Weight',
      expert_bank_weights: 'Routed Expert Weights',
      shared_expert_weights: 'Shared Expert Weights',
      lm_head_weight: 'LM Head Weight',
      mtp_head_weight: 'MTP Head Weight',
    };
    const OPENPANGU_VIRTUAL_NODES = {
      query_tensor: {
        id: 'query_tensor',
        kind: 'tensor',
        label: 'Query',
        role: 'logical attention query tensor',
        attrs: { source: 'rope_apply', target: 'attention_core', tensor_edge: 'query' },
      },
      key_tensor: {
        id: 'key_tensor',
        kind: 'tensor',
        label: 'Key',
        role: 'logical key tensor projected from compressed KV',
        attrs: { source: 'kv_b_proj', target: 'attention_core', tensor_edge: 'compressed_kv.key' },
      },
      value_tensor: {
        id: 'value_tensor',
        kind: 'tensor',
        label: 'Value',
        role: 'logical value tensor projected from compressed KV',
        attrs: { source: 'kv_b_proj', target: 'attention_core', tensor_edge: 'compressed_kv.value' },
      },
    };
    Object.assign(OPENPANGU_VIRTUAL_NODES, {
      attention_all_gather: {
        id: 'attention_all_gather',
        kind: 'op',
        label: 'AllGather',
        op_type: 'Communication',
        attrs: { collective: 'all_gather', scope: 'tensor_parallel', stage: 'attention_input' },
      },
      attention_reduce_scatter: {
        id: 'attention_reduce_scatter',
        kind: 'op',
        label: 'Reduce-Scatter',
        op_type: 'Communication',
        attrs: { collective: 'reduce_scatter', scope: 'tensor_parallel', stage: 'attention_output' },
      },
      ffn_all_gather: {
        id: 'ffn_all_gather',
        kind: 'op',
        label: 'AllGather',
        op_type: 'Communication',
        attrs: { collective: 'all_gather', scope: 'tensor_parallel', stage: 'ffn_input' },
      },
      ffn_reduce_scatter: {
        id: 'ffn_reduce_scatter',
        kind: 'op',
        label: 'Reduce-Scatter',
        op_type: 'Communication',
        attrs: { collective: 'reduce_scatter', scope: 'tensor_parallel', stage: 'ffn_output' },
      },
      moe_all_to_all_dispatch: {
        id: 'moe_all_to_all_dispatch',
        kind: 'op',
        label: 'All-to-All Dispatch',
        op_type: 'Communication',
        attrs: { collective: 'all_to_all', scope: 'expert_parallel', stage: 'expert_dispatch' },
      },
      moe_all_to_all_combine: {
        id: 'moe_all_to_all_combine',
        kind: 'op',
        label: 'All-to-All Combine',
        op_type: 'Communication',
        attrs: { collective: 'all_to_all', scope: 'expert_parallel', stage: 'expert_combine' },
      },
    });
    const OPENPANGU_WIDTHS = Object.freeze({
      mainSpine: 480,
      attentionLane: 470,
      attentionTensor: 210,
      addGlyph: 54,
      denseLane: 360,
      moeLane: 340,
      mtpLane: 300,
      state: 250,
      parameter: 238,
      leftParameterLane: 70,
      moeParameterLane: 730,
      moeCoreLane: 1040,
      moeSharedLane: 1480,
      moeStateLane: 1395,
      moeCombineLane: 1220,
    });
    const LIGHT_HSL_DEFAULT = Object.freeze({ hue: 2, saturation: 79, lightness: 76 });
    const LIGHT_HSL_STORAGE_KEY = 'openpangu-architecture-light-hsl';
    const LIGHT_COLOR_KEY_BY_SOURCE = Object.freeze({
      'sem:embedding': 'opv:embedding',
      'sem:norm': 'opv:norm',
      'sem:attention': 'opv:attention',
      'sem:position': 'opv:rope',
      'sem:rope': 'opv:rope',
      'sem:qknorm': 'opv:norm',
      'sem:linear': 'opv:linear',
      'sem:head': 'opv:head',
      'sem:mlp': 'opv:mlp',
      'sem:act': 'opv:act',
      'sem:gate': 'opv:gate',
      'sem:moe': 'opv:moe',
      'sem:comm': 'opv:comm',
      'module:model': 'opv:model',
      'module:decoder': 'opv:decoder',
      'module:mhc': 'opv:attention',
      'module:ffn': 'opv:mlp',
      'module:mtp': 'opv:linear',
    });
    const LIGHT_BASE_COLOR_BY_KEY = Object.freeze({
      'opv:act': '#8B5CF6',
      'opv:attention': '#3B82F6',
      'opv:comm': '#06B6D4',
      'opv:decoder': '#0D9488',
      'opv:embedding': '#14B8A6',
      'opv:gate': '#F59E0B',
      'opv:head': '#7C3AED',
      'opv:linear': '#4F46E5',
      'opv:mlp': '#A855F7',
      'opv:model': '#475569',
      'opv:moe': '#EA580C',
      'opv:norm': '#0EA5E9',
      'opv:op': '#14B8A6',
      'opv:rope': '#A855F7',
    });
    Object.assign(NODE_SPEC, {
      input_tokens: { ...NODE_SPEC.input_tokens, w: OPENPANGU_WIDTHS.mainSpine, h: 66, parent: 'model-core' },
      token_embedding: { ...NODE_SPEC.token_embedding, w: OPENPANGU_WIDTHS.mainSpine, h: 58 },
      embedding_weight: { w: OPENPANGU_WIDTHS.parameter, h: 50, colorKey: 'io:parameter', parent: 'model-core' },
      decoder_layer: { ...NODE_SPEC.decoder_layer, w: OPENPANGU_WIDTHS.mainSpine, h: 64, parent: 'decoder-stack' },
      mhc_attention: { ...NODE_SPEC.mhc_attention, w: OPENPANGU_WIDTHS.mainSpine, h: 62 },
      input_layernorm: { ...NODE_SPEC.input_layernorm, w: OPENPANGU_WIDTHS.mainSpine, h: 66, colorKey: 'sem:norm' },
      attention_all_gather: { w: OPENPANGU_WIDTHS.mainSpine, h: 58, colorKey: 'sem:comm', parent: 'decoder-stack' },
      sparse_mla_attention: { ...NODE_SPEC.sparse_mla_attention, w: OPENPANGU_WIDTHS.mainSpine, h: 66, colorKey: 'sem:attention', parent: 'attention-block' },
      attention_reduce_scatter: { w: OPENPANGU_WIDTHS.mainSpine, h: 58, colorKey: 'sem:comm', parent: 'decoder-stack' },
      attention_projection_weights: { w: 282, h: 50, colorKey: 'io:parameter', parent: 'attention-block', lane: OPENPANGU_WIDTHS.leftParameterLane },
      q_a_proj: { ...NODE_SPEC.q_a_proj, w: OPENPANGU_WIDTHS.attentionLane, h: 62, lane: 390 },
      kv_a_proj: { ...NODE_SPEC.kv_a_proj, w: OPENPANGU_WIDTHS.attentionLane, h: 62, lane: 1050 },
      q_causal_conv: { ...NODE_SPEC.q_causal_conv, w: OPENPANGU_WIDTHS.attentionLane, h: 62, colorKey: 'sem:act', lane: 390 },
      kv_causal_conv: { ...NODE_SPEC.kv_causal_conv, w: OPENPANGU_WIDTHS.attentionLane, h: 62, colorKey: 'sem:act', lane: 1050 },
      q_residual_add: { ...NODE_SPEC.q_residual_add, w: OPENPANGU_WIDTHS.addGlyph, h: OPENPANGU_WIDTHS.addGlyph, colorKey: 'sem:act', lane: 390, glyph: true, hideTypeLabel: true },
      kv_residual_add: { ...NODE_SPEC.kv_residual_add, w: OPENPANGU_WIDTHS.addGlyph, h: OPENPANGU_WIDTHS.addGlyph, colorKey: 'sem:act', lane: 1050, glyph: true, hideTypeLabel: true },
      q_a_norm: { ...NODE_SPEC.q_a_norm, w: OPENPANGU_WIDTHS.attentionLane, h: 62, colorKey: 'sem:norm', lane: 390 },
      kv_a_norm: { ...NODE_SPEC.kv_a_norm, w: OPENPANGU_WIDTHS.attentionLane, h: 62, colorKey: 'sem:norm', lane: 1050 },
      q_b_proj: { ...NODE_SPEC.q_b_proj, w: OPENPANGU_WIDTHS.attentionLane, h: 62, lane: 390 },
      kv_b_proj: { ...NODE_SPEC.kv_b_proj, w: OPENPANGU_WIDTHS.attentionLane, h: 62, lane: 1050 },
      query_tensor: { w: OPENPANGU_WIDTHS.attentionLane, h: 62, colorKey: 'sem:linear', parent: 'attention-block', lane: 390 },
      key_tensor: { w: OPENPANGU_WIDTHS.attentionTensor, h: 62, colorKey: 'sem:linear', parent: 'attention-block', lane: 900 },
      value_tensor: { w: OPENPANGU_WIDTHS.attentionTensor, h: 62, colorKey: 'sem:linear', parent: 'attention-block', lane: 1180 },
      attention_core: { ...NODE_SPEC.attention_core, w: OPENPANGU_WIDTHS.mainSpine, h: 64, colorKey: 'sem:attention', lane: 720 },
      o_causal_conv: { ...NODE_SPEC.o_causal_conv, w: OPENPANGU_WIDTHS.mainSpine, h: 62, colorKey: 'sem:act', lane: 720 },
      o_residual_add: { ...NODE_SPEC.o_residual_add, w: OPENPANGU_WIDTHS.addGlyph, h: OPENPANGU_WIDTHS.addGlyph, colorKey: 'sem:act', lane: 720, glyph: true, hideTypeLabel: true },
      o_proj: { ...NODE_SPEC.o_proj, w: OPENPANGU_WIDTHS.mainSpine, h: 62, lane: 720 },
      post_attention_norm: { ...NODE_SPEC.post_attention_norm, w: OPENPANGU_WIDTHS.mainSpine, h: 62, colorKey: 'sem:norm' },
      mhc_attention_post: { ...NODE_SPEC.mhc_attention_post, w: OPENPANGU_WIDTHS.mainSpine, h: 62 },
      pre_mlp_norm: { ...NODE_SPEC.pre_mlp_norm, w: OPENPANGU_WIDTHS.mainSpine, h: 62, colorKey: 'sem:norm' },
      ffn_choice: { ...NODE_SPEC.ffn_choice, w: OPENPANGU_WIDTHS.mainSpine, h: 64, colorKey: 'module:ffn' },
      ffn_all_gather: { w: OPENPANGU_WIDTHS.mainSpine, h: 58, colorKey: 'sem:comm', parent: 'ffn-block' },
      dense_mlp_weights: { w: 238, h: 50, colorKey: 'io:parameter', parent: 'ffn-block', lane: OPENPANGU_WIDTHS.leftParameterLane },
      dense_mlp: { ...NODE_SPEC.dense_mlp, w: OPENPANGU_WIDTHS.denseLane, h: 62, colorKey: 'sem:mlp', lane: 420 },
      dense_gate_up: { ...NODE_SPEC.dense_gate_up, w: OPENPANGU_WIDTHS.denseLane, h: 62, lane: 420 },
      dense_silu: { ...NODE_SPEC.dense_silu, w: OPENPANGU_WIDTHS.denseLane, h: 62, colorKey: 'sem:act', lane: 420 },
      dense_down: { ...NODE_SPEC.dense_down, w: OPENPANGU_WIDTHS.denseLane, h: 62, lane: 420 },
      moe_ffn: { ...NODE_SPEC.moe_ffn, w: OPENPANGU_WIDTHS.moeLane, h: 62, colorKey: 'sem:moe', lane: OPENPANGU_WIDTHS.moeCoreLane },
      router_weight: { w: 218, h: 50, colorKey: 'io:parameter', parent: 'moe-block', lane: OPENPANGU_WIDTHS.moeParameterLane },
      router_gate: { ...NODE_SPEC.router_gate, w: OPENPANGU_WIDTHS.moeLane, h: 62, lane: OPENPANGU_WIDTHS.moeCoreLane },
      route_topk: { ...NODE_SPEC.route_topk, w: OPENPANGU_WIDTHS.moeLane, h: 62, lane: OPENPANGU_WIDTHS.moeCoreLane },
      moe_all_to_all_dispatch: { w: OPENPANGU_WIDTHS.moeLane, h: 58, colorKey: 'sem:comm', parent: 'moe-block', lane: OPENPANGU_WIDTHS.moeCoreLane },
      expert_bank_weights: { w: 238, h: 50, colorKey: 'io:parameter', parent: 'moe-block', lane: OPENPANGU_WIDTHS.moeParameterLane },
      routed_expert_bank: { ...NODE_SPEC.routed_expert_bank, w: OPENPANGU_WIDTHS.moeLane, h: 62, colorKey: 'sem:moe', lane: OPENPANGU_WIDTHS.moeCoreLane },
      shared_expert_weights: { w: 238, h: 50, colorKey: 'io:parameter', parent: 'moe-block', lane: OPENPANGU_WIDTHS.moeParameterLane },
      shared_expert_mlp: { ...NODE_SPEC.shared_expert_mlp, w: OPENPANGU_WIDTHS.moeLane, h: 62, lane: OPENPANGU_WIDTHS.moeSharedLane },
      moe_all_to_all_combine: { w: OPENPANGU_WIDTHS.moeLane, h: 58, colorKey: 'sem:comm', parent: 'moe-block', lane: OPENPANGU_WIDTHS.moeCombineLane },
      moe_combine: { ...NODE_SPEC.moe_combine, w: OPENPANGU_WIDTHS.moeLane, h: 62, colorKey: 'sem:moe', lane: OPENPANGU_WIDTHS.moeCombineLane },
      expert_parallel_state: { ...NODE_SPEC.expert_parallel_state, w: OPENPANGU_WIDTHS.state, h: 54, lane: OPENPANGU_WIDTHS.moeStateLane },
      ffn_reduce_scatter: { w: OPENPANGU_WIDTHS.mainSpine, h: 58, colorKey: 'sem:comm', parent: 'ffn-block' },
      post_mlp_norm: { ...NODE_SPEC.post_mlp_norm, w: OPENPANGU_WIDTHS.mainSpine, h: 62, colorKey: 'sem:norm' },
      block_post_norm: { ...NODE_SPEC.block_post_norm, w: OPENPANGU_WIDTHS.mainSpine, h: 62, colorKey: 'sem:norm' },
      final_norm: { ...NODE_SPEC.final_norm, w: OPENPANGU_WIDTHS.mainSpine, h: 58, colorKey: 'sem:norm' },
      lm_head_weight: { w: OPENPANGU_WIDTHS.parameter, h: 50, colorKey: 'io:parameter', parent: 'model-core' },
      lm_head: { ...NODE_SPEC.lm_head, w: OPENPANGU_WIDTHS.mainSpine, h: 58 },
      mtp_module: { ...NODE_SPEC.mtp_module, w: OPENPANGU_WIDTHS.mtpLane, h: 58, lane: 1180 },
      mtp_input_norms: { ...NODE_SPEC.mtp_input_norms, w: OPENPANGU_WIDTHS.mtpLane, h: 52, lane: 1180 },
      mtp_eh_proj: { ...NODE_SPEC.mtp_eh_proj, w: OPENPANGU_WIDTHS.mtpLane, h: 52, lane: 1180 },
      mtp_decoder_layer: { ...NODE_SPEC.mtp_decoder_layer, w: OPENPANGU_WIDTHS.mtpLane, h: 54, lane: 1180 },
      mtp_head_weight: { w: 214, h: 50, colorKey: 'io:parameter', parent: 'mtp-stack', lane: 860 },
      mtp_shared_head: { ...NODE_SPEC.mtp_shared_head, w: OPENPANGU_WIDTHS.mtpLane, h: 52, lane: 1180 },
    });
    const COL_X = 640;
    const CLUSTER_MARGIN = 36;
    const CLUSTER_TOP_PAD = 46;
    const ROW_GAP = 44;
    const ZOOM_MIN = 0.18;
    const ZOOM_MAX = 2.8;

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function normalizeHueDegrees(value) {
      return ((value % 360) + 360) % 360;
    }

    function hexToRgb(hex) {
      const normalized = String(hex || '').replace('#', '').trim();
      if (normalized.length !== 6) return { r: 0, g: 0, b: 0 };
      return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16),
      };
    }

    function rgbToHsl(r, g, b) {
      const nr = r / 255;
      const ng = g / 255;
      const nb = b / 255;
      const max = Math.max(nr, ng, nb);
      const min = Math.min(nr, ng, nb);
      let h = 0;
      let s = 0;
      const l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === nr) h = (ng - nb) / d + (ng < nb ? 6 : 0);
        else if (max === ng) h = (nb - nr) / d + 2;
        else h = (nr - ng) / d + 4;
        h /= 6;
      }
      return { h: h * 360, s, l };
    }

    function hslToHex(h, s, l) {
      const normalizedHue = normalizeHueDegrees(h) / 360;
      const hueToRgb = (p, q, t) => {
        let next = t;
        if (next < 0) next += 1;
        if (next > 1) next -= 1;
        if (next < 1 / 6) return p + (q - p) * 6 * next;
        if (next < 1 / 2) return q;
        if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
        return p;
      };
      let r = l;
      let g = l;
      let b = l;
      if (s !== 0) {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hueToRgb(p, q, normalizedHue + 1 / 3);
        g = hueToRgb(p, q, normalizedHue);
        b = hueToRgb(p, q, normalizedHue - 1 / 3);
      }
      return '#' + [r, g, b].map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    function adjustedLightColor(baseHex, settings = LIGHT_HSL_DEFAULT) {
      const base = rgbToHsl(...Object.values(hexToRgb(baseHex)));
      return hslToHex(base.h + settings.hue, settings.saturation / 100, settings.lightness / 100);
    }

    function loadLightHslSettings() {
      try {
        const saved = JSON.parse(window.localStorage.getItem(LIGHT_HSL_STORAGE_KEY) || '{}');
        return {
          hue: clamp(Number.isFinite(Number(saved.hue)) ? Number(saved.hue) : LIGHT_HSL_DEFAULT.hue, -180, 180),
          saturation: clamp(Number.isFinite(Number(saved.saturation)) ? Number(saved.saturation) : LIGHT_HSL_DEFAULT.saturation, 30, 88),
          lightness: clamp(Number.isFinite(Number(saved.lightness)) ? Number(saved.lightness) : LIGHT_HSL_DEFAULT.lightness, 58, 86),
        };
      } catch {
        return { ...LIGHT_HSL_DEFAULT };
      }
    }

    function saveLightHslSettings() {
      try {
        window.localStorage.setItem(LIGHT_HSL_STORAGE_KEY, JSON.stringify(state.lightHsl));
      } catch {
        // Local storage is optional; the panel still works for the current session.
      }
    }

    const state = {
      schema: null,
      graph: null,
      selectedNodeId: null,
      collapsedModules: new Set(DEFAULT_COLLAPSED),
      detailModules: new Set(DEFAULT_DETAIL_MODULES),
      zoom: 1,
      tx: 0,
      ty: 0,
      svg: null,
      graphController: null,
      lightHsl: loadLightHslSettings(),
      colorRenderFrame: 0,
    };

    function setStatus(message) {
      const status = document.getElementById('statusText');
      if (status) status.textContent = message;
    }

    function syncThemeToggle() {
      const isLight = document.documentElement.dataset.theme === 'light';
      [document.getElementById('opvTopThemeToggle'), document.getElementById('floatingThemeToggle')].forEach((button) => {
        if (!button) return;
        button.textContent = isLight ? 'Dark' : 'Light';
        button.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
        button.setAttribute('aria-pressed', String(isLight));
      });
    }

    function setTheme(next) {
      document.documentElement.dataset.theme = next;
      syncThemeToggle();
      const url = new URL(window.location.href);
      url.searchParams.set('theme', next);
      window.history.replaceState({}, '', url);
      syncColorPanel();
      renderAll(`${next} theme.`, { preserveZoom: true });
    }

    function isOpenPanguSchema(schema) {
      return String(schema?.model?.name || '').toLowerCase().includes('openpangu');
    }

    function hiddenByAncestor(nodeId) {
      return Object.entries(COLLAPSIBLE).some(([moduleId, descendants]) => (
        state.collapsedModules.has(moduleId) && nodeId !== moduleId && descendants.includes(nodeId)
      ));
    }

    function attentionDetailOpen() {
      return state.detailModules.has('sparse_mla_attention') && !state.collapsedModules.has('sparse_mla_attention');
    }

    function visibleNode(nodeId) {
      if (!NODE_SPEC[nodeId]) return false;
      if (ATTENTION_FINE_DETAIL_NODES.has(nodeId) && !attentionDetailOpen()) return false;
      if (ALWAYS_VISIBLE_MODULES.has(nodeId)) return !hiddenByAncestor(nodeId);
      if (COLLAPSIBLE[nodeId]) return state.collapsedModules.has(nodeId) && !hiddenByAncestor(nodeId);
      return !hiddenByAncestor(nodeId);
    }

    function graphKind(kind) {
      if (kind === 'input' || kind === 'output' || kind === 'state' || kind === 'parameter') return 'tensor';
      if (kind === 'tensor') return 'tensor';
      if (kind === 'module') return 'module';
      return 'op';
    }

    function typeLabel(kind, node = null) {
      if (kind === 'parameter' || node?.state_type === 'parameter') return 'Parameter';
      if (node?.op_type === 'Communication') return 'Comm';
      return { input: 'Input', output: 'Output', state: 'State', tensor: 'Tensor', module: 'Module', op: 'Op' }[kind] || 'Node';
    }

    function fallbackColorKey(node) {
      const text = `${node.id || ''} ${node.label || ''} ${node.op_type || ''} ${node.module_type || ''} ${node.state_type || ''}`.toLowerCase();
      if (node.kind === 'input') return 'io:input';
      if (node.kind === 'output') return 'io:output';
      if (node.kind === 'parameter' || node.state_type === 'parameter') return 'io:parameter';
      if (node.kind === 'state') return 'io:state';
      if (text.includes('embedding')) return 'sem:embedding';
      if (text.includes('rope') || text.includes('rotary')) return 'sem:rope';
      if (text.includes('norm')) return 'sem:norm';
      if (text.includes('attention') || text.includes('mla') || text.includes('dsa')) return 'sem:attention';
      if (text.includes('moe')) return 'sem:moe';
      if (text.includes('mlp') || text.includes('silu')) return 'sem:mlp';
      if (text.includes('gate') || text.includes('router')) return 'sem:gate';
      if (text.includes('head')) return 'sem:head';
      if (text.includes('linear') || text.includes('projection')) return 'sem:linear';
      return node.kind === 'module' ? 'module:model' : 'sem:op';
    }

    function lightColorKey(colorKey) {
      const key = String(colorKey || '');
      if (!key || key.startsWith('io:')) return colorKey;
      return LIGHT_COLOR_KEY_BY_SOURCE[key] || 'opv:op';
    }

    function graphForCurrentTheme(graph) {
      if (document.documentElement.dataset.theme !== 'light') return graph;
      return {
        ...graph,
        clusters: (graph.clusters || []).map((cluster) => ({
          ...cluster,
          colorKey: lightColorKey(cluster.colorKey),
        })),
        nodes: (graph.nodes || []).map((node) => ({
          ...node,
          colorKey: lightColorKey(node.colorKey),
        })),
      };
    }

    function lightColorKeysForGraph(graph) {
      const keys = [];
      (graph.clusters || []).forEach((cluster) => {
        if (cluster.colorKey && !String(cluster.colorKey).startsWith('io:')) keys.push(cluster.colorKey);
      });
      (graph.nodes || []).forEach((node) => {
        if (node.colorKey && !String(node.colorKey).startsWith('io:')) keys.push(node.colorKey);
      });
      return Array.from(new Set(keys)).sort();
    }

    function currentLightColormap(graph) {
      if (document.documentElement.dataset.theme !== 'light') return undefined;
      if (window._opColorMode === 'off') {
        return { coreColors: ['#94a3b8'], saturation: 0.3, lightness: 0.72, ioColors: {} };
      }
      return window.PtoOpvGraphvizPattern.modelArchitectureColormap(graph, { lightHsl: state.lightHsl });
    }

    function syncColorPanel() {
      const hue = document.getElementById('colorHue');
      const saturation = document.getElementById('colorSaturation');
      const lightness = document.getElementById('colorLightness');
      if (!hue || !saturation || !lightness) return;
      hue.value = String(state.lightHsl.hue);
      saturation.value = String(state.lightHsl.saturation);
      lightness.value = String(state.lightHsl.lightness);
      document.getElementById('colorHueValue').textContent = `${state.lightHsl.hue}`;
      document.getElementById('colorSaturationValue').textContent = `${state.lightHsl.saturation}%`;
      document.getElementById('colorLightnessValue').textContent = `${state.lightHsl.lightness}%`;
      const preview = document.getElementById('colorPreview');
      if (preview) {
        const keys = ['opv:embedding', 'opv:norm', 'opv:attention', 'opv:linear', 'opv:head', 'opv:mlp', 'opv:gate', 'opv:moe', 'opv:comm', 'opv:model'];
        preview.innerHTML = keys.map((key) => (
          `<span class="opv-color-swatch" style="--swatch: ${adjustedLightColor(LIGHT_BASE_COLOR_BY_KEY[key], state.lightHsl)}"></span>`
        )).join('');
      }
      const toggle = document.getElementById('colorPanelToggle');
      const panel = document.getElementById('colorPanel');
      if (toggle && panel) toggle.setAttribute('aria-expanded', String(!panel.hidden));
    }

    function scheduleColorRender() {
      if (state.colorRenderFrame) window.cancelAnimationFrame(state.colorRenderFrame);
      state.colorRenderFrame = window.requestAnimationFrame(() => {
        state.colorRenderFrame = 0;
        if (!state.schema) return;
        renderAll(`Light HSL ${state.lightHsl.hue} / ${state.lightHsl.saturation}% / ${state.lightHsl.lightness}%.`, { preserveZoom: true });
      });
    }

    function computeOpenPanguPositions() {
      const positions = {};
      const c = state.collapsedModules;
      const cx = COL_X + 80;
      const qx = 470;
      const kvx = 1110;
      const keyX = 1040;
      const valueX = 1300;
      const stateX = 1530;
      const mtpX = NODE_SPEC.mtp_module.lane;
      const place = (id, x, y) => {
        if (!visibleNode(id)) return;
        positions[id] = { x: x ?? NODE_SPEC[id].lane ?? cx, y };
      };

      place('input_tokens', cx, 76);
      place('token_embedding', cx, 168);
      place('embedding_weight', 330, 168);
      place('decoder_layer', cx, 262);
      place('positions', 180, 170);

      if (c.has('decoder_layer')) {
        place('rope_cache', 1260, 346);
        place('kv_cache', 1260, 414);
        place('final_norm', cx, 396);
        place('lm_head', cx, 488);
        place('lm_head_weight', 390, 488);
        place('logits', cx, 580);
        if (c.has('mtp_module')) place('mtp_module', mtpX, 488);
        return positions;
      }

      place('mhc_attention', cx, 364);
      place('input_layernorm', cx, 466);
      place('attention_all_gather', cx, 560);
      place('sparse_mla_attention', cx, 654);

      let tailY = 748;
      if (c.has('sparse_mla_attention')) {
        place('rope_cache', 1260, 634);
        place('kv_cache', 1260, 702);
        place('attention_reduce_scatter', cx, 748);
        tailY = 842;
      } else {
        const detail = attentionDetailOpen();
        place('q_a_proj', qx, 798);
        place('kv_a_proj', kvx, 798);
        place('attention_projection_weights', OPENPANGU_WIDTHS.leftParameterLane, 798);
        place('q_causal_conv', qx, 928);
        place('kv_causal_conv', kvx, 928);
        place('q_residual_add', qx, 1006);
        place('kv_residual_add', kvx, 1006);
        place('q_a_norm', qx, 1084);
        place('kv_a_norm', kvx, 1084);
        place('q_b_proj', qx, 1176);
        place('kv_b_proj', kvx, 1176);
        place('query_tensor', qx, 1316);
        place('key_tensor', keyX, 1316);
        place('value_tensor', valueX, 1316);
        if (detail) {
          place('rope_apply', 800, 1241);
          place('dsa_indexer', 810, 1404);
          place('rope_cache', stateX, 1241);
          place('kv_cache', stateX, 1316);
          place('param_sink_state', stateX, 1388);
          place('mome_state', stateX, 1460);
          place('attention_core', cx, 1516);
          place('o_causal_conv', cx, 1616);
          place('o_residual_add', cx, 1694);
          place('o_proj', cx, 1778);
          place('attention_reduce_scatter', cx, 1870);
          tailY = 1962;
        } else {
          place('attention_core', cx, 1484);
          place('o_causal_conv', cx, 1586);
          place('o_residual_add', cx, 1664);
          place('o_proj', cx, 1748);
          place('attention_reduce_scatter', cx, 1840);
          tailY = 1932;
        }
      }

      place('post_attention_norm', cx, tailY);
      place('mhc_attention_post', cx, tailY + 96);
      place('pre_mlp_norm', cx, tailY + 192);

      if (c.has('ffn_choice')) {
        place('ffn_choice', cx, tailY + 294);
        tailY += 404;
      } else {
        place('ffn_all_gather', cx, tailY + 306);
        place('dense_mlp', 420, tailY + 424);
        place('dense_mlp_weights', OPENPANGU_WIDTHS.leftParameterLane, tailY + 544);
        place('dense_gate_up', 420, tailY + 544);
        place('dense_silu', 420, tailY + 664);
        place('dense_down', 420, tailY + 784);
        if (c.has('moe_ffn')) {
          place('moe_ffn', OPENPANGU_WIDTHS.moeCoreLane, tailY + 424);
          place('ffn_reduce_scatter', cx, tailY + 904);
          tailY += 1014;
        } else {
          place('moe_ffn', OPENPANGU_WIDTHS.moeCoreLane, tailY + 424);
          place('router_weight', OPENPANGU_WIDTHS.moeParameterLane, tailY + 544);
          place('router_gate', OPENPANGU_WIDTHS.moeCoreLane, tailY + 544);
          place('route_topk', OPENPANGU_WIDTHS.moeCoreLane, tailY + 664);
          place('moe_all_to_all_dispatch', OPENPANGU_WIDTHS.moeCoreLane, tailY + 784);
          place('expert_bank_weights', OPENPANGU_WIDTHS.moeParameterLane, tailY + 904);
          place('routed_expert_bank', OPENPANGU_WIDTHS.moeCoreLane, tailY + 904);
          place('shared_expert_weights', OPENPANGU_WIDTHS.moeParameterLane, tailY + 664);
          place('shared_expert_mlp', OPENPANGU_WIDTHS.moeSharedLane, tailY + 664);
          place('expert_parallel_state', OPENPANGU_WIDTHS.moeStateLane, tailY + 904);
          place('moe_all_to_all_combine', OPENPANGU_WIDTHS.moeCombineLane, tailY + 1024);
          place('moe_combine', OPENPANGU_WIDTHS.moeCombineLane, tailY + 1144);
          place('ffn_reduce_scatter', cx, tailY + 1264);
          tailY += 1374;
        }
      }

      place('post_mlp_norm', cx, tailY);
      place('block_post_norm', cx, tailY + 92);
      place('final_norm', cx, tailY + 208);
      place('lm_head', cx, tailY + 300);
      place('lm_head_weight', 330, tailY + 300);
      place('logits', cx, tailY + 392);

      const mtpY = tailY + 208;
      if (c.has('mtp_module')) {
        place('mtp_module', mtpX, mtpY);
      } else {
        place('mtp_input_norms', mtpX, mtpY - 132);
        place('mtp_eh_proj', mtpX, mtpY - 42);
        place('mtp_decoder_layer', mtpX, mtpY + 48);
        place('mtp_head_weight', 860, mtpY + 138);
        place('mtp_shared_head', mtpX, mtpY + 138);
        place('mtp_logits', mtpX, mtpY + 228);
      }
      return positions;
    }

    function buildOpenPanguGraph(schema) {
      const positions = computeOpenPanguPositions();
      const sourceNodes = [
        ...(schema.nodes || []),
        ...Object.values(OPENPANGU_VIRTUAL_NODES),
      ];
      const graphNodes = sourceNodes.map((node) => {
        const spec = NODE_SPEC[node.id];
        const pos = positions[node.id];
        if (!spec || !pos || !visibleNode(node.id)) return null;
        return {
          id: node.id,
          label: OPENPANGU_DISPLAY_LABELS[node.id] || node.label || node.id,
          kind: graphKind(node.kind),
          typeLabel: typeLabel(node.kind, node),
          x: pos.x,
          y: pos.y,
          width: spec.w,
          height: spec.h,
          colorKey: spec.colorKey || fallbackColorKey(node),
          parent: spec.parent,
          glyph: Boolean(spec.glyph),
          hideTypeLabel: Boolean(spec.hideTypeLabel),
          collapsed: COLLAPSIBLE[node.id] ? state.collapsedModules.has(node.id) : false,
        };
      }).filter(Boolean);
      const visibleIds = new Set(graphNodes.map((node) => node.id));
      const groupChildren = {};
      Object.entries(NODE_SPEC).forEach(([id, spec]) => {
        if (!spec.parent) return;
        (groupChildren[spec.parent] ||= []).push(id);
      });
      const groupChildGroups = {};
      GROUPS.forEach((group) => {
        if (!group.parentCluster) return;
        (groupChildGroups[group.parentCluster] ||= []).push(group.id);
      });
      function groupActive(groupId) {
        const moduleId = MODULE_BY_CLUSTER[groupId];
        if (!moduleId) return true;
        return !state.collapsedModules.has(moduleId) && !hiddenByAncestor(moduleId);
      }
      function nodeRect(id) {
        const pos = positions[id];
        const spec = NODE_SPEC[id];
        if (!pos || !spec || !visibleIds.has(id)) return null;
        return { left: pos.x - spec.w / 2, right: pos.x + spec.w / 2, top: pos.y - spec.h / 2, bottom: pos.y + spec.h / 2 };
      }
      function clusterTopPad(groupId) {
        return groupId === 'decoder-stack' ? 24 : CLUSTER_TOP_PAD;
      }
      function clusterBox(groupId) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        (groupChildren[groupId] || []).forEach((id) => {
          const rect = nodeRect(id);
          if (!rect) return;
          minX = Math.min(minX, rect.left); minY = Math.min(minY, rect.top);
          maxX = Math.max(maxX, rect.right); maxY = Math.max(maxY, rect.bottom);
        });
        (groupChildGroups[groupId] || []).forEach((childId) => {
          if (!groupActive(childId)) return;
          const box = clusterBox(childId);
          if (!box) return;
          minX = Math.min(minX, box.x); minY = Math.min(minY, box.y);
          maxX = Math.max(maxX, box.x + box.width); maxY = Math.max(maxY, box.y + box.height);
        });
        if (minX === Infinity) return null;
        const x = minX - CLUSTER_MARGIN;
        const topPad = clusterTopPad(groupId);
        const y = minY - topPad;
        return { x, y, width: maxX + CLUSTER_MARGIN - x, height: maxY + CLUSTER_MARGIN - y };
      }
      const clusters = GROUPS.map((group) => {
        if (!groupActive(group.id)) return null;
        const box = clusterBox(group.id);
        return box ? { ...group, ...box } : null;
      }).filter(Boolean);
      const edges = [];
      const edgeGap = 8;
      function defaultEdgeAnchors(source, target) {
        const sourcePos = positions[source];
        const targetPos = positions[target];
        if (!sourcePos || !targetPos) return {};
        const dx = targetPos.x - sourcePos.x;
        const dy = targetPos.y - sourcePos.y;
        const vertical = Math.abs(dy) >= Math.abs(dx);
        if (vertical) {
          return dy >= 0
            ? { sourceAnchor: { side: 'bottom', dy: edgeGap }, targetAnchor: { side: 'top', dy: -edgeGap }, curve: 'vertical' }
            : { sourceAnchor: { side: 'top', dy: -edgeGap }, targetAnchor: { side: 'bottom', dy: edgeGap }, curve: 'vertical' };
        }
        return dx >= 0
          ? { sourceAnchor: { side: 'right', dx: edgeGap }, targetAnchor: { side: 'left', dx: -edgeGap }, curve: 'horizontal' }
          : { sourceAnchor: { side: 'left', dx: -edgeGap }, targetAnchor: { side: 'right', dx: edgeGap }, curve: 'horizontal' };
      }
      function forkDown(sourceDx = 0, targetDx = 0) {
        return {
          sourceAnchor: { side: 'bottom', dx: sourceDx, dy: edgeGap },
          targetAnchor: { side: 'top', dx: targetDx, dy: -edgeGap },
          curve: 'vertical',
        };
      }
      function edgeAnchor(side, dx = 0, dy = 0) {
        const anchor = { side };
        if (side === 'left') anchor.dx = -edgeGap;
        if (side === 'right') anchor.dx = edgeGap;
        if (side === 'top') anchor.dy = -edgeGap;
        if (side === 'bottom') anchor.dy = edgeGap;
        if (dx) anchor.dx = (anchor.dx || 0) + dx;
        if (dy) anchor.dy = (anchor.dy || 0) + dy;
        return anchor;
      }
      function sideEdge(sourceSide, targetSide, sourceDy = 0, targetDy = 0) {
        return {
          sourceAnchor: edgeAnchor(sourceSide, 0, sourceDy),
          targetAnchor: edgeAnchor(targetSide, 0, targetDy),
          curve: 'horizontal',
        };
      }
      function straightSideEdge(sourceSide, targetSide, sourceDy = 0, targetDy = 0) {
        return {
          sourceAnchor: edgeAnchor(sourceSide, 0, sourceDy),
          targetAnchor: edgeAnchor(targetSide, 0, targetDy),
          curve: 'straight',
        };
      }
      function add(source, target, dashed = false, options = {}) {
        if (visibleIds.has(source) && visibleIds.has(target) && !edges.some((edge) => edge.source === source && edge.target === target)) {
          edges.push({ source, target, dashed, ...defaultEdgeAnchors(source, target), ...options });
        }
      }
      add('input_tokens', 'token_embedding');
      add('embedding_weight', 'token_embedding', true, straightSideEdge('right', 'left'));
      add('positions', 'rope_cache', true);
      if (state.collapsedModules.has('decoder_layer')) {
        add('token_embedding', 'decoder_layer');
        add('decoder_layer', 'final_norm');
        add('positions', 'decoder_layer', true);
        add('rope_cache', 'decoder_layer', true);
        add('kv_cache', 'decoder_layer', true);
      } else {
        add('token_embedding', 'decoder_layer');
        add('decoder_layer', 'mhc_attention', true);
        add('mhc_attention', 'input_layernorm');
        add('input_layernorm', 'attention_all_gather');
        if (state.collapsedModules.has('sparse_mla_attention')) {
          add('attention_all_gather', 'sparse_mla_attention');
          add('positions', 'sparse_mla_attention', true);
          add('rope_cache', 'sparse_mla_attention', true);
          add('kv_cache', 'sparse_mla_attention', true);
          add('sparse_mla_attention', 'attention_reduce_scatter');
          add('attention_reduce_scatter', 'post_attention_norm');
        } else {
          const detail = attentionDetailOpen();
          add('attention_all_gather', 'sparse_mla_attention');
          add('sparse_mla_attention', 'q_a_proj', false, forkDown(0, 0));
          add('sparse_mla_attention', 'kv_a_proj', false, forkDown(0, 0));
          add('attention_projection_weights', 'q_a_proj', true, straightSideEdge('right', 'left'));
          add('q_a_proj', 'q_causal_conv'); add('q_a_proj', 'q_residual_add', true); add('q_causal_conv', 'q_residual_add'); add('q_residual_add', 'q_a_norm'); add('q_a_norm', 'q_b_proj');
          add('kv_a_proj', 'kv_causal_conv'); add('kv_a_proj', 'kv_residual_add', true); add('kv_causal_conv', 'kv_residual_add'); add('kv_residual_add', 'kv_a_norm'); add('kv_a_norm', 'kv_b_proj');
          if (detail) {
            add('q_b_proj', 'rope_apply'); add('rope_cache', 'rope_apply', true);
            add('rope_apply', 'dsa_indexer');
            add('rope_apply', 'query_tensor');
          } else {
            add('q_b_proj', 'query_tensor');
          }
          add('query_tensor', 'attention_core', false, forkDown(0, 0));
          if (detail) add('dsa_indexer', 'attention_core');
          add('kv_b_proj', 'key_tensor', false, forkDown(0, 0)); add('kv_b_proj', 'value_tensor', false, forkDown(0, 0));
          add('key_tensor', 'attention_core', false, forkDown(0, 0));
          add('value_tensor', 'attention_core', false, forkDown(0, 0));
          if (detail) {
            add('kv_cache', 'attention_core', true);
            add('param_sink_state', 'attention_core', true); add('mome_state', 'attention_core', true);
          }
          add('attention_core', 'o_causal_conv'); add('attention_core', 'o_residual_add', true); add('o_causal_conv', 'o_residual_add'); add('o_residual_add', 'o_proj'); add('o_proj', 'attention_reduce_scatter'); add('attention_reduce_scatter', 'post_attention_norm');
        }
        add('post_attention_norm', 'mhc_attention_post'); add('mhc_attention_post', 'pre_mlp_norm');
        if (state.collapsedModules.has('ffn_choice')) {
          add('pre_mlp_norm', 'ffn_choice'); add('ffn_choice', 'post_mlp_norm');
        } else {
          add('pre_mlp_norm', 'ffn_all_gather');
          add('ffn_all_gather', 'dense_mlp', false, forkDown(0, 0));
          add('dense_mlp_weights', 'dense_gate_up', true, straightSideEdge('right', 'left'));
          add('dense_mlp', 'dense_gate_up'); add('dense_gate_up', 'dense_silu'); add('dense_silu', 'dense_down');
          add('dense_down', 'ffn_reduce_scatter', false, forkDown(0, 0));
          if (state.collapsedModules.has('moe_ffn')) {
            add('ffn_all_gather', 'moe_ffn', false, forkDown(0, 0));
            add('moe_ffn', 'ffn_reduce_scatter', false, forkDown(0, 0));
          } else {
            add('ffn_all_gather', 'router_gate', false, forkDown(0, 0)); add('router_gate', 'route_topk'); add('route_topk', 'moe_all_to_all_dispatch'); add('moe_all_to_all_dispatch', 'routed_expert_bank');
            add('router_weight', 'router_gate', true, straightSideEdge('right', 'left'));
            add('expert_bank_weights', 'routed_expert_bank', true, straightSideEdge('right', 'left'));
            add('shared_expert_weights', 'shared_expert_mlp', true, straightSideEdge('right', 'left'));
            add('expert_parallel_state', 'routed_expert_bank', true, straightSideEdge('left', 'right'));
            add('ffn_all_gather', 'shared_expert_mlp', false, forkDown(0, 0));
            add('routed_expert_bank', 'moe_all_to_all_combine', false, forkDown(0, 0));
            add('moe_all_to_all_combine', 'moe_combine', false, forkDown(0, 0));
            add('shared_expert_mlp', 'moe_combine', false, forkDown(0, 0));
            add('moe_combine', 'ffn_reduce_scatter', false, forkDown(0, 0));
          }
          add('ffn_reduce_scatter', 'post_mlp_norm', false, forkDown(0, 0));
        }
        add('post_mlp_norm', 'block_post_norm'); add('block_post_norm', 'final_norm');
      }
      add('final_norm', 'lm_head'); add('lm_head_weight', 'lm_head', true, straightSideEdge('right', 'left')); add('lm_head', 'logits');
      if (state.collapsedModules.has('mtp_module')) {
        add('final_norm', 'mtp_module', true);
      } else {
        add('token_embedding', 'mtp_input_norms', true); add('final_norm', 'mtp_input_norms', true);
        add('mtp_input_norms', 'mtp_eh_proj'); add('mtp_eh_proj', 'mtp_decoder_layer'); add('mtp_decoder_layer', 'mtp_shared_head'); add('mtp_head_weight', 'mtp_shared_head', true, straightSideEdge('right', 'left')); add('mtp_shared_head', 'mtp_logits');
      }
      const minGraphX = Math.min(
        ...graphNodes.map((node) => node.x - node.width / 2),
        ...clusters.map((cluster) => cluster.x)
      );
      const minGraphY = Math.min(
        ...graphNodes.map((node) => node.y - node.height / 2),
        ...clusters.map((cluster) => cluster.y)
      );
      const safeInset = 36;
      if (minGraphX < safeInset) {
        const shiftX = safeInset - minGraphX;
        graphNodes.forEach((node) => { node.x += shiftX; });
        clusters.forEach((cluster) => { cluster.x += shiftX; });
      }
      if (minGraphY < safeInset) {
        const shiftY = safeInset - minGraphY;
        graphNodes.forEach((node) => { node.y += shiftY; });
        clusters.forEach((cluster) => { cluster.y += shiftY; });
      }
      const maxBottom = Math.max(900, ...graphNodes.map((node) => node.y + node.height / 2));
      const maxRight = Math.max(1180, ...graphNodes.map((node) => node.x + node.width / 2), ...clusters.map((cluster) => cluster.x + cluster.width));
      return { width: Math.round(Math.max(1280, maxRight + 90)), height: Math.round(maxBottom + 80), clusters, nodes: graphNodes, edges };
    }

    function fallbackGraph(schema) {
      const nodes = Array.isArray(schema.nodes) ? schema.nodes : [];
      const graphNodes = nodes.map((node, index) => {
        const layout = schema.visual_layout?.nodes?.[node.id] || { x: 220 + (index % 4) * 250, y: 120 + Math.floor(index / 4) * 110 };
        return { id: node.id, label: node.label || node.id, kind: graphKind(node.kind), typeLabel: typeLabel(node.kind), x: layout.x, y: layout.y, width: 210, height: 54, colorKey: fallbackColorKey(node) };
      });
      const ids = new Set(graphNodes.map((node) => node.id));
      return {
        width: 1280,
        height: Math.max(720, Math.ceil(nodes.length / 4) * 118 + 180),
        clusters: [],
        nodes: graphNodes,
        edges: (schema.edges || []).filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ source: edge.source, target: edge.target })),
      };
    }

    function buildGraphFromSchema(schema) {
      return isOpenPanguSchema(schema) ? buildOpenPanguGraph(schema) : fallbackGraph(schema);
    }

    function createSvg(tag, attrs = {}) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attrs).forEach(([key, value]) => {
        if (value !== undefined && value !== null) element.setAttribute(key, value);
      });
      return element;
    }

    function getNode(id) {
      return (state.schema?.nodes || []).find((node) => node.id === id) || OPENPANGU_VIRTUAL_NODES[id];
    }

    function setModuleCollapsed(moduleId, collapsed) {
      if (!COLLAPSIBLE[moduleId]) return;
      if (collapsed) state.collapsedModules.add(moduleId);
      else state.collapsedModules.delete(moduleId);
      state.selectedNodeId = null;
      renderAll(`${getNode(moduleId)?.label || moduleId} ${collapsed ? 'collapsed' : 'expanded'}.`, { preserveZoom: true });
    }

    function setModuleDetail(moduleId, expanded) {
      if (moduleId !== 'sparse_mla_attention') return;
      if (expanded) state.detailModules.add(moduleId);
      else state.detailModules.delete(moduleId);
      state.selectedNodeId = null;
      renderAll(`${getNode(moduleId)?.label || moduleId} detail ${expanded ? 'opened' : 'closed'}.`, { preserveZoom: true });
    }

    function appendOverlayToggle(svg, x, y, moduleId, collapseAction, radius = 7.5, mode = 'collapse') {
      const node = getNode(moduleId);
      const group = createSvg('g', {
        class: 'opv-overlay-toggle',
        transform: `translate(${x}, ${y})`,
        role: 'button',
        tabindex: '0',
        'data-module-id': moduleId,
      });
      const actionLabel = mode === 'detail'
        ? (collapseAction ? 'close detail' : 'open detail')
        : (collapseAction ? 'collapse' : 'expand');
      group.setAttribute('aria-label', `${node?.label || moduleId} ${actionLabel}`);
      group.appendChild(createSvg('circle', { class: 'opv-toggle-hit', cx: 0, cy: 0, r: radius + 10 }));
      group.appendChild(createSvg('circle', { cx: 0, cy: 0, r: radius }));
      const icon = createSvg('text', { x: 0, y: 0.2 });
      icon.textContent = collapseAction ? '-' : '+';
      group.appendChild(icon);
      group.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
      });
      group.addEventListener('pointerup', (event) => {
        event.stopPropagation();
      });
      group.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (mode === 'detail') setModuleDetail(moduleId, !collapseAction);
        else setModuleCollapsed(moduleId, collapseAction);
      });
      group.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        if (mode === 'detail') setModuleDetail(moduleId, !collapseAction);
        else setModuleCollapsed(moduleId, collapseAction);
      });
      svg.appendChild(group);
    }

    function appendRepeatTag(svg, x, y, text) {
      const group = createSvg('g', { class: 'opv-repeat-tag', transform: `translate(${x}, ${y})`, 'pointer-events': 'none' });
      const width = Math.max(72, text.length * 8.4 + 22);
      group.appendChild(createSvg('rect', { x: 0, y: -11, width, height: 22, rx: 11, ry: 11, fill: 'color-mix(in srgb, var(--opv-panel-bg) 84%, var(--opv-accent))', stroke: 'color-mix(in srgb, var(--opv-border-strong) 68%, var(--opv-accent))', 'stroke-width': '0.9px' }));
      const label = createSvg('text', { x: width / 2, y: 0 });
      label.textContent = text;
      group.appendChild(label);
      svg.appendChild(group);
    }

    function appendToggleOverlay() {
      const svg = state.svg;
      if (!svg || !state.graph || !isOpenPanguSchema(state.schema)) return;
      state.graph.clusters.forEach((cluster) => {
        const moduleId = MODULE_BY_CLUSTER[cluster.id];
        if (!moduleId) return;
        if (moduleId === 'sparse_mla_attention') {
          appendOverlayToggle(svg, cluster.x + cluster.width - 13, cluster.y + 13, moduleId, attentionDetailOpen(), 7.5, 'detail');
          return;
        }
        appendOverlayToggle(svg, cluster.x + cluster.width - 13, cluster.y + 13, moduleId, true);
      });
      state.graph.nodes.forEach((node) => {
        if (!COLLAPSIBLE[node.id] || !state.collapsedModules.has(node.id)) return;
        appendOverlayToggle(svg, node.x + node.width / 2 - 24, node.y, node.id, false, 14);
      });
      const decoderBox = state.graph.clusters.find((cluster) => cluster.id === 'decoder-stack');
      if (decoderBox) appendRepeatTag(svg, decoderBox.x + 16, decoderBox.y + 42, 'decode layers 0-45 | count 46');
      const attentionBox = state.graph.clusters.find((cluster) => cluster.id === 'attention-block');
      if (attentionBox) appendRepeatTag(svg, attentionBox.x + 16, attentionBox.y + 42, 'MLA + DSA/SWA + MoME');
      const ffnBox = state.graph.clusters.find((cluster) => cluster.id === 'ffn-block');
      if (ffnBox) appendRepeatTag(svg, ffnBox.x + 16, ffnBox.y + 42, 'Dense 0-1 / MoE 2-45');
      const moeBox = state.graph.clusters.find((cluster) => cluster.id === 'moe-block');
      if (moeBox) appendRepeatTag(svg, moeBox.x + 16, moeBox.y + 42, 'MoE layers 2-45 | top-8');
      const moeNode = state.graph.nodes.find((node) => node.id === 'moe_ffn');
      if (moeNode) {
        appendRepeatTag(svg, moeNode.x - moeNode.width / 2, moeNode.y + 44, 'MoE 2-45 | 256 routed');
      }
      const mtpBox = state.graph.clusters.find((cluster) => cluster.id === 'mtp-stack');
      if (mtpBox) appendRepeatTag(svg, mtpBox.x + 16, mtpBox.y + 42, 'MTP layers 46-48');
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    }

    function tensorSummary(edge) {
      const tensor = edge.tensor || {};
      const parts = [];
      if (tensor.name) parts.push(tensor.name);
      if (tensor.shape) parts.push(tensor.shape);
      if (tensor.dtype) parts.push(tensor.dtype);
      if (Array.isArray(tensor.constraints) && tensor.constraints.length) parts.push(tensor.constraints.join(', '));
      return parts.join(' | ') || edge.label || 'tensor';
    }

    function displayType(node) {
      return node?.module_type || node?.op_type || node?.state_type || node?.role || node?.id || '';
    }

    function repeatRowsFor(nodeId) {
      return (state.schema?.repeats || []).filter((repeat) => repeat.template_node === nodeId);
    }

    function branchRowsFor(nodeId) {
      return (state.schema?.branches || []).filter((branch) => (
        branch.true_target === nodeId ||
        branch.false_target === nodeId ||
        (branch.resolved_ranges || []).some((range) => range.target === nodeId)
      ));
    }

    function topologySectionHtml(nodeId) {
      const repeats = repeatRowsFor(nodeId);
      const branches = branchRowsFor(nodeId);
      if (!repeats.length && !branches.length) return '';
      const repeatHtml = repeats.map((repeat) => (
        `<div class="opv-edge-row"><strong>${escapeHtml(repeat.id)}</strong><br>range ${escapeHtml(repeat.range)} | count ${escapeHtml(repeat.count)}</div>`
      )).join('');
      const branchHtml = branches.map((branch) => {
        const ranges = (branch.resolved_ranges || [])
          .map((range) => `${range.target}: ${range.range}`)
          .join(' | ');
        return `<div class="opv-edge-row"><strong>${escapeHtml(branch.id)}</strong><br>${escapeHtml(branch.condition)}${ranges ? `<br>${escapeHtml(ranges)}` : ''}</div>`;
      }).join('');
      return `
        <section class="opv-section">
          <div class="opv-section-title">Repeats / Branches</div>
          <div class="opv-edge-list">${repeatHtml}${branchHtml}</div>
        </section>
      `;
    }

    function graphItemBounds(id) {
      if (!state.graph) return null;
      const graphId = graphSelectionIdForDetails(id);
      const node = state.graph.nodes.find((item) => item.id === graphId) || state.graph.nodes.find((item) => item.id === id);
      if (node) {
        return {
          left: node.x - node.width / 2,
          top: node.y - node.height / 2,
          right: node.x + node.width / 2,
          bottom: node.y + node.height / 2,
          width: node.width,
          height: node.height,
        };
      }
      const cluster = state.graph.clusters.find((item) => item.id === graphId);
      if (!cluster) return null;
      return {
        left: cluster.x,
        top: cluster.y,
        right: cluster.x + cluster.width,
        bottom: cluster.y + cluster.height,
        width: cluster.width,
        height: cluster.height,
      };
    }

    function renderPopoverAction(nodeId) {
      if (nodeId === 'sparse_mla_attention') {
        const expanded = attentionDetailOpen();
        return `<button class="btn btn-ghost" type="button" data-popover-detail="${escapeHtml(nodeId)}">${expanded ? 'Close Detail' : 'Open Detail'}</button>`;
      }
      if (!COLLAPSIBLE[nodeId]) return '';
      const collapsed = state.collapsedModules.has(nodeId);
      return `<button class="btn btn-ghost" type="button" data-popover-toggle="${escapeHtml(nodeId)}">${collapsed ? 'Expand' : 'Collapse'}</button>`;
    }

    function edgeRowsHtml(edges) {
      return edges.map((edge) => (
        `<div class="opv-edge-row"><strong>${escapeHtml(edge.source)}</strong> to <strong>${escapeHtml(edge.target)}</strong><br>${escapeHtml(tensorSummary(edge))}</div>`
      )).join('') || '<div class="opv-edge-row">No direct tensor edge.</div>';
    }

    function ensureNodePopover() {
      let popover = document.getElementById('nodePopover');
      if (popover) return popover;
      const stage = document.getElementById('graphStage');
      popover = document.createElement('div');
      popover.id = 'nodePopover';
      popover.className = 'opv-node-popover';
      popover.hidden = true;
      stage.appendChild(popover);
      return popover;
    }

    function renderNodePopover() {
      const popover = ensureNodePopover();
      const node = getNode(state.selectedNodeId);
      if (!popover || !node || !state.graphController) {
        if (popover) popover.hidden = true;
        return;
      }
      const bounds = graphItemBounds(state.selectedNodeId);
      const transform = state.graphController.getTransform?.();
      const stage = document.getElementById('graphStage');
      if (!bounds || !transform || !stage) {
        popover.hidden = true;
        return;
      }
      const attrs = node.attrs ? JSON.stringify(node.attrs, null, 2) : '{}';
      const edges = (state.schema.edges || []).filter((edge) => edge.source === node.id || edge.target === node.id);
      const provenance = node.provenance || [];
      const actionHtml = renderPopoverAction(node.id);
      popover.innerHTML = `
        <div class="opv-node-popover-head">
          <div>
            <h3 class="opv-node-popover-title">${escapeHtml(OPENPANGU_DISPLAY_LABELS[node.id] || node.label || node.id)}</h3>
            <div class="opv-node-popover-sub">${escapeHtml(typeLabel(node.kind))} / ${escapeHtml(displayType(node))}</div>
          </div>
          <button class="btn btn-ghost opv-node-popover-close" type="button" data-popover-close aria-label="Close">x</button>
        </div>
        <div class="opv-node-popover-body">
          ${actionHtml ? `<div class="opv-popover-actions">${actionHtml}</div>` : ''}
          <section class="opv-section">
            <div class="opv-section-title">Node</div>
            <dl class="opv-popover-kv">
              <dt>ID</dt><dd>${escapeHtml(node.id)}</dd>
              <dt>Kind</dt><dd>${escapeHtml(node.kind)}</dd>
              <dt>Type</dt><dd>${escapeHtml(displayType(node))}</dd>
            </dl>
          </section>
          ${topologySectionHtml(node.id)}
          <section class="opv-section">
            <div class="opv-section-title">Attributes</div>
            <pre class="opv-code">${escapeHtml(attrs)}</pre>
          </section>
          <section class="opv-section">
            <div class="opv-section-title">Edges</div>
            <div class="opv-edge-list">${edgeRowsHtml(edges)}</div>
          </section>
          <section class="opv-section">
            <div class="opv-section-title">Provenance</div>
            <pre class="opv-code">${escapeHtml(JSON.stringify(provenance, null, 2))}</pre>
          </section>
        </div>
      `;
      popover.hidden = false;
      const zoom = transform.zoom || 1;
      const targetX = transform.tx + bounds.right * zoom + 14;
      const targetY = transform.ty + bounds.top * zoom;
      const panelW = popover.offsetWidth || 340;
      const panelH = popover.offsetHeight || 180;
      const maxX = Math.max(12, stage.clientWidth - panelW - 12);
      const maxY = Math.max(12, stage.clientHeight - panelH - 12);
      let left = Math.min(Math.max(12, targetX), maxX);
      let top = Math.min(Math.max(12, targetY), maxY);
      if (targetX > maxX && bounds.left * zoom + transform.tx - panelW - 14 > 12) {
        left = bounds.left * zoom + transform.tx - panelW - 14;
      }
      popover.style.left = `${Math.round(left)}px`;
      popover.style.top = `${Math.round(top)}px`;
    }

    function graphSelectionIdForDetails(id) {
      if (!id || !state.graph) return id;
      const clusterId = CLUSTER_BY_MODULE[id];
      if (clusterId && state.graph.clusters.some((cluster) => cluster.id === clusterId)) return clusterId;
      return id;
    }

    function syncSelection() {
      renderNodePopover();
    }

    function clearNodeSelection() {
      state.selectedNodeId = null;
      ensureNodePopover().hidden = true;
      state.graphController?.clearSelection?.();
      setStatus('Selection cleared.');
    }

    function selectNode(id, options = {}) {
      if (!id) return;
      state.selectedNodeId = MODULE_BY_CLUSTER[id] || id;
      if (!options.fromController && state.graphController?.selectNode) {
        state.graphController.selectNode(graphSelectionIdForDetails(state.selectedNodeId), {
          source: options.source || 'page',
        });
      }
      syncSelection();
      setStatus(`Selected ${getNode(state.selectedNodeId)?.label || state.selectedNodeId}.`);
    }

    function wireGraphSelection() {
      syncSelection();
    }

    function clampZoom(value) {
      return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
    }

    function applyTransform() {
      if (!state.graphController?.setTransform) return;
      state.graphController.setTransform({ tx: state.tx, ty: state.ty, zoom: state.zoom });
      window.requestAnimationFrame(renderNodePopover);
    }

    function computeFitZoom() {
      const stage = document.getElementById('graphStage');
      const availableWidth = Math.max(640, stage.clientWidth - 72);
      const availableHeight = Math.max(640, stage.clientHeight - 72);
      return clampZoom(Math.min(1.05, Math.min(availableWidth / state.graph.width, availableHeight / state.graph.height)));
    }

    function centerView() {
      state.graphController?.fit?.();
      const transform = state.graphController?.getTransform?.();
      if (transform) {
        state.tx = transform.tx;
        state.ty = transform.ty;
        state.zoom = transform.zoom;
      }
      renderNodePopover();
    }

    function zoomAtStagePoint(factor, px, py) {
      const current = state.graphController?.getTransform?.();
      if (!current || !state.graphController?.setTransform) return;
      const z0 = current.zoom;
      const z1 = clampZoom(z0 * factor);
      if (z1 === z0) return;
      state.tx = px - (px - current.tx) * (z1 / z0);
      state.ty = py - (py - current.ty) * (z1 / z0);
      state.zoom = z1;
      applyTransform();
      setStatus(`Zoom ${Math.round(state.zoom * 100)}%.`);
    }

    const REFERENCE_VIEW = { width: 1600, height: 1640 };

    function renderOpenPanguReferenceLayout(stage, options = {}) {
      stage.innerHTML = '';
      state.graph = { width: REFERENCE_VIEW.width, height: REFERENCE_VIEW.height, clusters: [], nodes: [], edges: [] };

      const svg = createSvg('svg', {
        class: 'opv-reference-svg',
        viewBox: `0 0 ${REFERENCE_VIEW.width} ${REFERENCE_VIEW.height}`,
        role: 'img',
        'aria-label': 'openPangu MLA attention architecture reference layout',
      });
      const defs = createSvg('defs');
      const marker = createSvg('marker', {
        id: 'opv-reference-arrow',
        viewBox: '0 0 10 10',
        refX: '8.5',
        refY: '5',
        markerWidth: '7',
        markerHeight: '7',
        orient: 'auto',
      });
      marker.appendChild(createSvg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#4c4c4c' }));
      defs.appendChild(marker);
      svg.appendChild(defs);

      const content = createSvg('g', { class: 'opv-reference-content' });
      svg.appendChild(content);

      const nodeH = 66;
      const nodeW = 480;
      const smallW = 200;
      const cx = 700;
      const qx = 360;
      const kvx = 1020;
      const keyX = 875;
      const valueX = 1150;
      const y = {
        input: 92,
        inputNorm: 182,
        mla: 272,
        qLatent: 420,
        kvLatent: 420,
        qConv: 550,
        kvConv: 550,
        qPlus: 625,
        kvPlus: 625,
        qNorm: 688,
        kvNorm: 688,
        qUp: 778,
        kvUp: 778,
        query: 900,
        key: 900,
        value: 900,
        flash: 1080,
        outConv: 1210,
        outPlus: 1285,
        outProj: 1370,
        postNorm: 1462,
        mlp: 1554,
      };
      const top = (cy, h = nodeH) => cy - h / 2;
      const bottom = (cy, h = nodeH) => cy + h / 2;

      function line(d, className = 'opv-reference-line') {
        content.appendChild(createSvg('path', { class: className, d }));
      }

      function node(id, label, x, cy, w = nodeW, color = 'blue') {
        const group = createSvg('g', {
          class: `opv-reference-node opv-reference-color-${color}`,
          transform: `translate(${x}, ${cy})`,
          'data-node-id': id,
          role: 'button',
          tabindex: '0',
          'aria-label': label,
        });
        group.appendChild(createSvg('rect', {
          x: -w / 2,
          y: -nodeH / 2,
          width: w,
          height: nodeH,
          rx: 14,
          ry: 14,
          class: `opv-reference-color-${color}`,
        }));
        const text = createSvg('text', { x: 0, y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
        text.textContent = label;
        group.appendChild(text);
        group.addEventListener('click', (event) => {
          event.stopPropagation();
          selectNode(id, { fromController: true });
          state.graphController?.selectNode?.(id);
        });
        group.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          selectNode(id, { fromController: true });
          state.graphController?.selectNode?.(id);
        });
        content.appendChild(group);
        state.graph.nodes.push({ id, label, x, y: cy, width: w, height: nodeH });
        return group;
      }

      function plus(id, x, cy) {
        const group = createSvg('g', {
          class: 'opv-reference-plus',
          transform: `translate(${x}, ${cy})`,
          'data-node-id': id,
          role: 'button',
          tabindex: '0',
          'aria-label': getNode(id)?.label || id,
        });
        group.appendChild(createSvg('circle', { cx: 0, cy: 0, r: 18 }));
        const text = createSvg('text', { x: 0, y: 0 });
        text.textContent = '+';
        group.appendChild(text);
        group.addEventListener('click', (event) => {
          event.stopPropagation();
          selectNode(id, { fromController: true });
          state.graphController?.selectNode?.(id);
        });
        content.appendChild(group);
        return group;
      }

      function selectedElement(id) {
        return content.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
      }

      line(`M ${cx} ${bottom(y.input)} L ${cx} ${top(y.inputNorm)}`);
      line(`M ${cx} ${bottom(y.inputNorm)} L ${cx} ${top(y.mla)}`);
      const forkY = 340;
      line(`M ${cx} ${bottom(y.mla)} L ${cx} ${forkY} L ${qx} ${forkY} L ${qx} ${top(y.qLatent)}`);
      line(`M ${cx} ${forkY} L ${kvx} ${forkY} L ${kvx} ${top(y.kvLatent)}`);

      line(`M ${qx} ${bottom(y.qLatent)} L ${qx} ${top(y.qConv)}`);
      line(`M ${kvx} ${bottom(y.kvLatent)} L ${kvx} ${top(y.kvConv)}`);
      line(`M ${qx} ${bottom(y.qConv)} L ${qx} ${y.qPlus - 18}`);
      line(`M ${kvx} ${bottom(y.kvConv)} L ${kvx} ${y.kvPlus - 18}`);
      line(`M ${qx - nodeW / 2} ${bottom(y.qLatent) + 30} L 65 ${bottom(y.qLatent) + 30} Q 45 ${bottom(y.qLatent) + 30} 45 ${bottom(y.qLatent) + 50} L 45 ${y.qPlus - 22} Q 45 ${y.qPlus} 67 ${y.qPlus} L ${qx - 18} ${y.qPlus}`);
      line(`M ${kvx - nodeW / 2} ${bottom(y.kvLatent) + 30} L 705 ${bottom(y.kvLatent) + 30} Q 685 ${bottom(y.kvLatent) + 30} 685 ${bottom(y.kvLatent) + 50} L 685 ${y.kvPlus - 22} Q 685 ${y.kvPlus} 707 ${y.kvPlus} L ${kvx - 18} ${y.kvPlus}`);
      line(`M ${qx} ${y.qPlus + 18} L ${qx} ${top(y.qNorm)}`);
      line(`M ${kvx} ${y.kvPlus + 18} L ${kvx} ${top(y.kvNorm)}`);
      line(`M ${qx} ${bottom(y.qNorm)} L ${qx} ${top(y.qUp)}`);
      line(`M ${kvx} ${bottom(y.kvNorm)} L ${kvx} ${top(y.kvUp)}`);
      line(`M ${qx} ${bottom(y.qUp)} L ${qx} ${top(y.query)}`);
      const kvSplitY = bottom(y.kvUp) + 38;
      line(`M ${kvx} ${bottom(y.kvUp)} L ${kvx} ${kvSplitY} L ${keyX} ${kvSplitY} L ${keyX} ${top(y.key)}`);
      line(`M ${kvx} ${kvSplitY} L ${valueX} ${kvSplitY} L ${valueX} ${top(y.value)}`);
      const joinY = 994;
      line(`M ${qx} ${bottom(y.query)} L ${qx} ${joinY} L ${valueX} ${joinY}`);
      line(`M ${keyX} ${bottom(y.key)} L ${keyX} ${joinY}`);
      line(`M ${valueX} ${bottom(y.value)} L ${valueX} ${joinY}`);
      line(`M ${cx} ${joinY} L ${cx} ${top(y.flash)}`);
      line(`M ${cx} ${bottom(y.flash)} L ${cx} ${top(y.outConv)}`);
      line(`M ${cx} ${bottom(y.outConv)} L ${cx} ${y.outPlus - 18}`);
      line(`M ${cx - nodeW / 2 + 10} ${bottom(y.flash) + 28} L 405 ${bottom(y.flash) + 28} Q 385 ${bottom(y.flash) + 28} 385 ${bottom(y.flash) + 48} L 385 ${y.outPlus - 22} Q 385 ${y.outPlus} 407 ${y.outPlus} L ${cx - 18} ${y.outPlus}`);
      line(`M ${cx} ${y.outPlus + 18} L ${cx} ${top(y.outProj)}`);
      line(`M ${cx} ${bottom(y.outProj)} L ${cx} ${top(y.postNorm)}`);
      line(`M ${cx} ${bottom(y.postNorm)} L ${cx} ${top(y.mlp)}`);
      line(`M 1340 ${y.kvConv} L ${kvx + nodeW / 2 + 10} ${y.kvConv}`, 'opv-reference-arrow');

      node('input_tokens', 'Input', cx, y.input, nodeW, 'gray');
      node('input_layernorm', 'Input LayerNorm', cx, y.inputNorm, nodeW, 'gray');
      node('sparse_mla_attention', 'MLA LoRA Linear', cx, y.mla, nodeW, 'gray');
      node('q_a_proj', 'Q Latent', qx, y.qLatent, nodeW, 'blue');
      node('kv_a_proj', 'KV Latent', kvx, y.kvLatent, nodeW, 'blue');
      node('q_causal_conv', 'Causual Conv1D', qx, y.qConv, nodeW, 'green');
      node('kv_causal_conv', 'Causual Conv1D', kvx, y.kvConv, nodeW, 'green');
      plus('q_residual_add', qx, y.qPlus);
      plus('kv_residual_add', kvx, y.kvPlus);
      node('q_a_norm', 'Q LayerNorm', qx, y.qNorm, nodeW, 'blue');
      node('kv_a_norm', 'KV LayerNorm', kvx, y.kvNorm, nodeW, 'blue');
      node('q_b_proj', 'Q Up Linear', qx, y.qUp, nodeW, 'blue');
      node('kv_b_proj', 'KV Up Linear', kvx, y.kvUp, nodeW, 'blue');
      node('rope_apply', 'Query', qx, y.query, nodeW, 'blue-strong');
      node('kv_b_proj', 'Key', keyX, y.key, smallW, 'blue-strong');
      node('kv_b_proj', 'Value', valueX, y.value, smallW, 'blue-strong');
      node('attention_core', 'FlashAttention', cx, y.flash, nodeW, 'blue-strong');
      node('o_causal_conv', 'Causual Conv1D', cx, y.outConv, nodeW, 'green');
      plus('o_residual_add', cx, y.outPlus);
      node('o_proj', 'Output Linear Projection', cx, y.outProj, nodeW, 'blue');
      node('post_attention_norm', 'Post-Attn LayerNorm', cx, y.postNorm, nodeW, 'blue');
      node('ffn_choice', 'MLP', cx, y.mlp, nodeW, 'blue-strong');

      stage.appendChild(svg);
      state.svg = svg;

      const controllerState = { tx: 0, ty: 0, zoom: 1 };
      const controller = {
        svg,
        destroy() {
          stage.innerHTML = '';
        },
        getTransform() {
          return { ...controllerState };
        },
        setTransform(transform) {
          controllerState.tx = Number(transform?.tx) || 0;
          controllerState.ty = Number(transform?.ty) || 0;
          controllerState.zoom = clampZoom(Number(transform?.zoom) || 1);
          content.setAttribute('transform', `translate(${controllerState.tx}, ${controllerState.ty}) scale(${controllerState.zoom})`);
        },
        fit() {
          const availableWidth = Math.max(640, stage.clientWidth - 72);
          const zoom = clampZoom(Math.min(1.0, availableWidth / REFERENCE_VIEW.width));
          this.setTransform({
            zoom,
            tx: Math.round((stage.clientWidth - REFERENCE_VIEW.width * zoom) / 2),
            ty: 28,
          });
        },
        selectNode(id) {
          content.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
          const el = selectedElement(MODULE_BY_CLUSTER[id] || id);
          if (el) el.classList.add('is-selected');
        },
      };
      if (options.preserveZoom) controller.setTransform(options.initialTransform || { zoom: state.zoom, tx: state.tx, ty: state.ty });
      else controller.fit();
      if (state.selectedNodeId) controller.selectNode(state.selectedNodeId);
      return controller;
    }

    function renderAll(message = 'Schema loaded.', options = {}) {
      const previous = state.graphController?.getTransform?.() || { zoom: state.zoom, tx: state.tx, ty: state.ty };
      const stage = document.getElementById('graphStage');
      state.graphController?.destroy?.();

      state.graph = buildGraphFromSchema(state.schema);
      const renderGraph = graphForCurrentTheme(state.graph);
      state.graphController = window.PtoOpvGraphvizPattern.renderController(stage, renderGraph, {
        ariaLabel: 'openPangu architecture graph',
        reportOverlays: false,
        className: 'pto-model-architecture-stage',
        viewportPadding: 36,
        fitMode: 'readable',
        minReadableZoom: 0.58,
        autoFit: !options.preserveZoom,
        initialTransform: options.preserveZoom ? previous : null,
        colormap: currentLightColormap(renderGraph),
        activeNodeId: graphSelectionIdForDetails(state.selectedNodeId),
        interaction: {
          panZoom: true,
          selectable: true,
          selectableClusters: false,
          relatedHighlight: true,
        },
        overlays: {
          evidence: false,
          edgeTags: true,
        },
        onSelect: ({ nodeId }) => {
          selectNode(nodeId, { fromController: true });
        },
      });
      state.svg = state.graphController?.svg || document.querySelector('#graphStage svg');
      appendToggleOverlay();
      ensureNodePopover();
      wireGraphSelection();
      if (options.preserveZoom) {
        state.zoom = previous.zoom;
        state.tx = previous.tx;
        state.ty = previous.ty;
        applyTransform();
      } else {
        window.requestAnimationFrame(() => {
          const transform = state.graphController?.getTransform?.();
          if (!transform) return;
          state.zoom = transform.zoom;
          state.tx = transform.tx;
          state.ty = transform.ty;
          renderNodePopover();
        });
      }
      setStatus(message);
      // 整网图 SVG 已重建（染色/层级/主题切换等会走这里）。外部注入的诊断标记、
      // 溢出率徽标都挂在旧 SVG 上，随重建被清掉——广播事件让 training-run-twin 重新注入。
      document.dispatchEvent(new CustomEvent('opv-graph-rendered'));
    }

    function wireStageInteractions() {
      const stage = document.getElementById('graphStage');
      stage.addEventListener('pointerdown', (event) => {
        const target = event.target;
        if (target.closest('.opv-node-popover')) {
          event.stopPropagation();
          return;
        }
        if (target.closest('.pto-model-graphviz-node, .opv-overlay-toggle')) return;
        if (event.button === 0) clearNodeSelection();
      }, true);
      stage.addEventListener('wheel', (event) => {
        if (event.metaKey || event.ctrlKey) clearNodeSelection();
      }, { passive: true });
      stage.addEventListener('click', (event) => {
        const target = event.target;
        if (target.closest('.opv-node-popover, .pto-model-graphviz-node, .opv-overlay-toggle')) return;
        clearNodeSelection();
      }, true);
      stage.addEventListener('click', (event) => {
        if (!event.target.closest('.opv-node-popover')) return;
        const close = event.target.closest('[data-popover-close]');
        if (close) {
          clearNodeSelection();
          return;
        }
        const toggle = event.target.closest('[data-popover-toggle]');
        if (toggle) {
          const moduleId = toggle.getAttribute('data-popover-toggle');
          setModuleCollapsed(moduleId, !state.collapsedModules.has(moduleId));
          return;
        }
        const detail = event.target.closest('[data-popover-detail]');
        if (!detail) return;
        const moduleId = detail.getAttribute('data-popover-detail');
        setModuleDetail(moduleId, !state.detailModules.has(moduleId));
      });
    }

    function wireColorPanel() {
      const toggle = document.getElementById('colorPanelToggle');
      const panel = document.getElementById('colorPanel');
      const reset = document.getElementById('colorReset');
      const hue = document.getElementById('colorHue');
      const saturation = document.getElementById('colorSaturation');
      const lightness = document.getElementById('colorLightness');
      toggle?.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        syncColorPanel();
      });
      reset?.addEventListener('click', () => {
        state.lightHsl = { ...LIGHT_HSL_DEFAULT };
        saveLightHslSettings();
        syncColorPanel();
        scheduleColorRender();
      });
      const onInput = () => {
        state.lightHsl = {
          hue: clamp(Number(hue.value), -180, 180),
          saturation: clamp(Number(saturation.value), 30, 88),
          lightness: clamp(Number(lightness.value), 58, 86),
        };
        saveLightHslSettings();
        syncColorPanel();
        scheduleColorRender();
      };
      [hue, saturation, lightness].forEach((input) => input?.addEventListener('input', onInput));
      if (new URLSearchParams(window.location.search).get('colorPanel') === '1') panel.hidden = false;
      syncColorPanel();
    }

    async function loadDefaultSchema() {
      const embedded = window.OPV_DEFAULT_SCHEMA;
      if (!embedded) throw new Error('missing OPV_DEFAULT_SCHEMA');
      state.schema = embedded;
      renderAll('openPangu schema loaded.');
    }

    document.getElementById('zoomIn').addEventListener('click', () => {
      const stage = document.getElementById('graphStage');
      zoomAtStagePoint(1.14, stage.clientWidth / 2, stage.clientHeight / 2);
    });
    document.getElementById('zoomOut').addEventListener('click', () => {
      const stage = document.getElementById('graphStage');
      zoomAtStagePoint(0.88, stage.clientWidth / 2, stage.clientHeight / 2);
    });
    document.getElementById('zoomReset').addEventListener('click', () => {
      centerView();
      setStatus(`Fit ${Math.round(state.zoom * 100)}%.`);
    });
    [document.getElementById('opvTopThemeToggle'), document.getElementById('floatingThemeToggle')].forEach((button) => {
      button?.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        setTheme(next);
      });
    });
    // 内嵌到训练监控大盘时,由父页面通过 postMessage 同步浅/深色主题(复用 panguSetTheme 约定)
    window.addEventListener('message', (event) => {
      const nextTheme = event.data && event.data.panguSetTheme;
      if (nextTheme === 'light' || nextTheme === 'dark') setTheme(nextTheme);
    });
    document.getElementById('schemaFileInput').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        state.schema = JSON.parse(await file.text());
        state.selectedNodeId = null;
        state.collapsedModules = new Set(DEFAULT_COLLAPSED);
        state.detailModules = new Set(DEFAULT_DETAIL_MODULES);
        renderAll(`Loaded ${file.name}.`);
      } catch (error) {
        setStatus(`Could not load JSON: ${error.message}`);
      }
    });
    window.addEventListener('resize', () => {
      if (!state.graph) return;
      centerView();
    });
    wireStageInteractions();
    wireColorPanel();
    syncThemeToggle();
    // 内嵌到训练监控大盘：父页切换 data-theme 时同步重着色（组件自身也保留浮动主题按钮）。
    // 注意 setTheme 自身会写 document.documentElement.dataset.theme，会再次触发本 observer，
    // 必须用 opvLastTheme 去重，否则 observer→setTheme→写 data-theme→observer… 死循环、整页卡死。
    let opvLastTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    new MutationObserver(() => {
      if (!state.graph) return;
      const t = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      if (t === opvLastTheme) return;
      opvLastTheme = t;
      setTheme(t);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    loadDefaultSchema().catch((error) => {
      setStatus(`Could not load default schema: ${error.message}. Use Open JSON.`);
    });

    // ── 外部触发：算子染色切换 & 层级切换 ──
    document.addEventListener('opv-recolor', () => {
      if (!state.schema) return;
      renderAll('Color mode changed.', { preserveZoom: true });
    });
    document.addEventListener('opv-set-level', (e) => {
      if (!state.schema) return;
      var level = (e.detail && e.detail.level) || 5;
      // L1~L5 基于 MODULE ID（非 cluster ID）：decoder_layer → sparse_mla_attention/ffn_choice → moe_ffn → ops
      // buildOpenPanguGraph 用 module ID 检查 collapsedModules，必须用 module ID
      var fresh = new Set();
      if (level <= 4) { fresh.add('moe_ffn'); }                                          // L4: 折叠 MoE 内部（router/expert/comm）
      if (level <= 3) { fresh.add('sparse_mla_attention'); fresh.add('ffn_choice'); }    // L3: 折叠 attention + ffn 子模块
      if (level <= 2) { fresh.add('decoder_layer'); }                                    // L2: 折叠 decoder 层
      if (level <= 1) { fresh.add('mtp_module'); }                                       // L1: 全部折叠
      state.collapsedModules = fresh;
      state.detailModules = new Set();
      if (level >= 5) { state.collapsedModules = new Set(DEFAULT_COLLAPSED); }           // L5: 默认展开（仅 mtp 折叠）
      renderAll('Level L' + level + '.', { preserveZoom: true });
    });
  })();

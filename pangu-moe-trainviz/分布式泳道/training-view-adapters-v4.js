(function registerTrainingViewAdaptersV4(global) {
  'use strict';

  const FRONT_VIEW_SCHEMA = 'model_architecture_front_view.v1';
  const EXPERT_PATTERN = /^expert_(\d+)$/;
  const TENSOR_KINDS = new Set(['input', 'output', 'state', 'tensor', 'parameter']);

  function invariant(condition, message) {
    if (!condition) throw new Error(message);
  }

  function indexArchitecture(graph) {
    const itemById = new Map();
    const parentById = new Map();
    const childrenById = new Map();
    function visit(item, parentId = null) {
      invariant(item && typeof item.id === 'string', 'architecture item must have an id');
      invariant(!itemById.has(item.id), `duplicate architecture id: ${item.id}`);
      itemById.set(item.id, item);
      parentById.set(item.id, parentId);
      const children = Array.isArray(item.children) ? item.children : [];
      childrenById.set(item.id, children.map((child) => child.id));
      children.forEach((child) => visit(child, item.id));
    }
    (graph.roots || []).forEach((root) => visit(root));
    return { itemById, parentById, childrenById };
  }

  function validateArchitectureBinding(dataset, graph) {
    invariant(graph?.schema_version === 'model_architecture_graph.v1', 'unsupported architecture schema');
    const asset = dataset?.model?.architectureAsset;
    invariant(asset, 'timeline model.architectureAsset is required');
    invariant(asset.schemaVersion === graph.schema_version, 'architecture schema version mismatch');
    invariant(asset.id === graph.metadata?.sourceAssetId, 'architecture asset id mismatch');
    invariant(asset.version === graph.metadata?.sourceAssetVersion, 'architecture asset version mismatch');
    invariant(asset.contentHash === graph.metadata?.sourceAssetHash, 'architecture source hash mismatch');
    invariant(asset.graphContentHash === graph.content_hash, 'architecture graph hash mismatch');
    const index = indexArchitecture(graph);
    (dataset.modelBindings || []).forEach((binding) => {
      invariant(binding.architectureAssetId === asset.id, `binding ${binding.semanticNodeId} targets another architecture asset`);
      invariant(index.itemById.has(binding.architectureNodeId), `binding target not found: ${binding.architectureNodeId}`);
      invariant(binding.rendererNodeId === binding.architectureNodeId, `binding ${binding.semanticNodeId} uses a renderer alias`);
    });
    return Object.freeze({ asset, ...index });
  }

  function tensorType(item) {
    if (item.kind === 'input') return 'Input Tensor';
    if (item.kind === 'output') return 'Output Tensor';
    if (item.state_type === 'parameter' || item.typeLabel === 'Parameter') return 'Parameter';
    return 'State Tensor';
  }

  function frontColor(id, item) {
    if (TENSOR_KINDS.has(item.kind)) {
      if (item.kind === 'input') return 'io:input';
      if (item.kind === 'output') return 'io:output';
      return item.state_type === 'parameter' || item.typeLabel === 'Parameter' ? 'io:parameter' : 'io:state';
    }
    if (/residual|mhc_.*post/.test(id)) return 'front:residual';
    if (/expert_\d+|shared_expert/.test(id)) return 'front:expert';
    if (/moe|router|route_topk/.test(id)) return 'front:moe';
    if (/mlp|ffn/.test(id)) return 'front:ffn';
    if (/norm/.test(id)) return 'front:norm';
    if (/attention|q_b_proj|kv_b_proj|o_proj/.test(id)) return 'front:attention';
    if (/embedding/.test(id)) return 'front:embedding';
    if (/lm_head/.test(id)) return 'front:head';
    return item.colorKey || 'module:model';
  }

  function buildModelFrontViewInput(dataset, graph, options = {}) {
    const index = validateArchitectureBinding(dataset, graph);
    const selectedLayer = Number.isInteger(options.selectedLayer) ? options.selectedLayer : dataset.incident.focus.layer;
    invariant(selectedLayer >= 0 && selectedLayer < dataset.model.numHiddenLayers, `invalid selected layer: ${selectedLayer}`);
    const dense = dataset.model.denseLayers.includes(selectedLayer);
    const residualStreams = Number(index.itemById.get('mhc_attention')?.attrs?.streams || 1);
    const nodes = {};
    const evidence = {};
    const placementByExpert = new Map(dataset.expertPlacements.map((entry) => [entry.logicalExpertId, entry]));
    const loadByExpert = new Map(dataset.expertLoads.map((entry) => [entry.logicalExpertId, entry]));

    function addCanonical(id, override = {}) {
      const item = index.itemById.get(id);
      invariant(item, `front-view canonical node not found: ${id}`);
      const expertMatch = id.match(EXPERT_PATTERN);
      const logicalExpertId = expertMatch ? Number(expertMatch[1]) : null;
      const kind = TENSOR_KINDS.has(item.kind) ? 'tensor' : item.kind;
      nodes[id] = {
        ...item,
        ...override,
        id,
        kind: override.kind || kind,
        typeLabel: override.typeLabel || (TENSOR_KINDS.has(item.kind) ? tensorType(item) : item.kind === 'module' ? 'Module' : item.op_type || 'Op'),
        colorKey: override.colorKey || frontColor(id, item),
        attrs: logicalExpertId === null ? item.attrs : {
          ...item.attrs,
          placement: placementByExpert.get(logicalExpertId) || null,
          load: loadByExpert.get(logicalExpertId) || null,
        },
        ...(logicalExpertId === null ? {} : { hideTypeLabel: true }),
      };
      evidence[id] = {
        what: nodes[id].label,
        description: logicalExpertId === null ? nodes[id].typeLabel : `Logical routed expert E${logicalExpertId}`,
        evidence: (item.sourceRefs || []).map((entry) => entry.path || entry.source_id || entry).join(' · '),
      };
    }

    function addViewState(id, label, bindsTo) {
      const canonical = index.itemById.get(bindsTo);
      nodes[id] = {
        id,
        label,
        kind: 'state',
        typeLabel: 'State',
        colorKey: 'front:residual',
        hideTypeLabel: true,
        overlayKind: 'residual-state',
        viewOnly: true,
        canonicalNodeIds: [bindsTo],
        sourceRefs: canonical?.sourceRefs || [],
      };
      evidence[id] = {
        what: label,
        description: 'Layer slice state boundary',
        evidence: (canonical?.sourceRefs || []).map((entry) => entry.path || entry.source_id || entry).join(' · '),
      };
    }

    [
      'input_tokens', 'positions', 'embedding_weight', 'token_embedding',
      'decoder_layer', 'mhc_attention', 'sparse_mla_attention',
      'mhc_attention_pre', 'mhc_attention_residual_state', 'input_layernorm',
      'attention_projection_weights', 'q_b_proj', 'kv_b_proj', 'rope_cache', 'attention_core', 'o_proj',
      'post_attention_norm', 'mhc_attention_post', 'mhc_mlp', 'mhc_mlp_pre', 'mhc_mlp_residual_state', 'pre_mlp_norm',
      'post_mlp_norm', 'mhc_mlp_post', 'final_norm', 'lm_head_weight', 'lm_head', 'logits',
    ].forEach((id) => addCanonical(id));
    nodes.rope_cache.label = 'RoPE / KV Cache';
    nodes.rope_cache.canonicalNodeIds = ['rope_cache', 'kv_cache'];
    nodes.mhc_attention_post.overlayKind = 'residual-op';
    nodes.mhc_mlp_post.overlayKind = 'residual-op';

    addViewState('view/layer_input', `H${selectedLayer} · ${residualStreams} × residual streams`, 'decoder_layer');
    addViewState('view/middle_state', `H${selectedLayer}′ · ${residualStreams} × residual streams`, 'mhc_attention_post');
    addViewState('view/layer_output', `H${selectedLayer + 1} · ${residualStreams} × residual streams`, 'mhc_mlp_post');
    nodes['view/previous_layers'] = {
      id: 'view/previous_layers', label: selectedLayer ? `Previous Decoder Layers · L0–L${selectedLayer - 1}` : 'Model Input',
      kind: 'module', typeLabel: 'Module', colorKey: 'front:embedding', viewOnly: true, canonicalNodeIds: ['decoder_layer'],
    };
    nodes['view/remaining_layers'] = {
      id: 'view/remaining_layers',
      label: selectedLayer < dataset.model.numHiddenLayers - 1 ? `Remaining Decoder Layers · L${selectedLayer + 1}–L${dataset.model.numHiddenLayers - 1}` : 'Decoder Output',
      kind: 'module', typeLabel: 'Module', colorKey: 'front:embedding', viewOnly: true, canonicalNodeIds: ['decoder_layer'],
    };

    const experts = Array.from({ length: dataset.model.expertCount }, (_, expertId) => `expert_${expertId}`);
    if (dense) {
      ['dense_mlp', 'dense_mlp_weights', 'dense_gate_up', 'dense_silu', 'dense_down'].forEach((id) => addCanonical(id));
    } else {
      ['moe_ffn', 'router_gate', 'route_topk', 'routed_expert_bank', 'shared_expert_mlp', 'moe_combine'].forEach((id) => addCanonical(id));
      experts.forEach((id) => addCanonical(id, { overlayKind: 'expert-cell' }));
    }

    const attention = {
      type: 'cluster', id: 'sparse_mla_attention', label: 'Sparse MLA Attention', width: 980, colorKey: 'front:attention', children: [
        { type: 'row', items: [{ id: 'attention_projection_weights', lane: 'left' }] },
        { type: 'row', items: ['q_b_proj', 'kv_b_proj'] },
        { type: 'row', items: [{ id: 'positions', lane: 'left' }, 'attention_core', { id: 'rope_cache', lane: 'right' }] },
        { type: 'row', items: ['o_proj'] },
      ],
    };
    const feedForward = dense
      ? {
          type: 'cluster', id: 'dense_mlp', label: 'Dense MLP', width: 980, colorKey: 'front:ffn', children: [
            { type: 'row', items: [{ id: 'dense_mlp_weights', lane: 'left' }] },
            { type: 'row', items: ['dense_gate_up'] },
            { type: 'row', items: ['dense_silu'] },
            { type: 'row', items: ['dense_down'] },
          ],
        }
      : {
          type: 'cluster', id: 'moe_ffn', label: 'MoE FFN', width: 1080, colorKey: 'front:moe', children: [
            { type: 'row', items: ['router_gate'] },
            { type: 'row', items: ['route_topk'] },
            { type: 'expert-bank', id: 'routed_expert_bank', label: 'Routed Experts', expertIds: experts, columns: 16, width: 760, aside: ['shared_expert_mlp'], colorKey: 'front:moe' },
            { type: 'row', items: ['moe_combine'] },
          ],
        };

    const structure = [
      { type: 'row', items: ['input_tokens'] },
      { type: 'row', items: [{ id: 'embedding_weight', lane: 'left' }, 'token_embedding'] },
    ];
    if (selectedLayer > 0) structure.push({ type: 'row', items: ['view/previous_layers'] });
    structure.push({
      type: 'cluster', id: 'decoder_layer', label: 'Decoder Layer', width: 1360, colorKey: 'module:decoder',
      repeatCount: dataset.model.numHiddenLayers, selectedInstanceIndex: selectedLayer, collapsible: false,
      children: [
        { type: 'row', items: ['view/layer_input'] },
        {
          type: 'cluster', id: 'mhc_attention', label: 'mHC Attention State Flow', width: 1240, colorKey: 'front:attention', children: [
            { type: 'row', items: ['mhc_attention_pre', { id: 'mhc_attention_residual_state', lane: 'right', width: 210 }] },
            { type: 'row', items: ['input_layernorm'] },
            attention,
            { type: 'row', items: ['post_attention_norm'] },
            { type: 'row', items: ['mhc_attention_post'] },
          ],
        },
        { type: 'row', items: ['view/middle_state'] },
        {
          type: 'cluster', id: 'mhc_mlp', label: 'mHC FFN State Flow', width: 1240, colorKey: 'front:ffn', children: [
            { type: 'row', items: ['mhc_mlp_pre', { id: 'mhc_mlp_residual_state', lane: 'right', width: 210 }] },
            { type: 'row', items: ['pre_mlp_norm'] },
            feedForward,
            { type: 'row', items: ['post_mlp_norm'] },
            { type: 'row', items: ['mhc_mlp_post'] },
          ],
        },
        { type: 'row', items: ['view/layer_output'] },
      ],
    });
    if (selectedLayer < dataset.model.numHiddenLayers - 1) structure.push({ type: 'row', items: ['view/remaining_layers'] });
    structure.push(
      { type: 'row', items: ['final_norm'] },
      { type: 'row', items: [{ id: 'lm_head_weight', lane: 'left' }, 'lm_head'] },
      { type: 'row', items: ['logits'] },
    );

    const edge = (id, source, target, semanticEdgeType = 'activation', extra = {}) => ({ id, source, target, semanticEdgeType, ...extra });
    const edges = [
      edge('front/input-embedding', 'input_tokens', 'token_embedding'),
      edge('front/embedding-weight', 'embedding_weight', 'token_embedding', 'parameter', { sourceAnchor: 'right', targetAnchor: 'left', curve: 'horizontal' }),
      edge('front/embedding-context', 'token_embedding', selectedLayer ? 'view/previous_layers' : 'view/layer_input'),
      ...(selectedLayer ? [edge('front/context-layer', 'view/previous_layers', 'view/layer_input')] : []),
      edge('front/layer-attention-pre', 'view/layer_input', 'mhc_attention_pre'),
      edge('front/attention-state-pre', 'mhc_attention_residual_state', 'mhc_attention_pre', 'state', { sourceAnchor: 'left', targetAnchor: 'right', curve: 'horizontal' }),
      edge('front/pre-input-norm', 'mhc_attention_pre', 'input_layernorm'),
      edge('front/norm-q', 'input_layernorm', 'q_b_proj'),
      edge('front/norm-kv', 'input_layernorm', 'kv_b_proj'),
      edge('front/attention-param-q', 'attention_projection_weights', 'q_b_proj', 'parameter', { sourceAnchor: 'right', targetAnchor: 'left', curve: 'horizontal' }),
      edge('front/q-core', 'q_b_proj', 'attention_core'),
      edge('front/kv-core', 'kv_b_proj', 'attention_core'),
      edge('front/position-core', 'positions', 'attention_core', 'state', { sourceAnchor: 'right', targetAnchor: 'left', curve: 'horizontal' }),
      edge('front/cache-core', 'rope_cache', 'attention_core', 'state', { sourceAnchor: 'left', targetAnchor: 'right', curve: 'horizontal' }),
      edge('front/core-output', 'attention_core', 'o_proj'),
      edge('front/output-post-norm', 'o_proj', 'post_attention_norm'),
      edge('front/post-norm-attn-merge', 'post_attention_norm', 'mhc_attention_post'),
      edge('front/attn-merge-middle', 'mhc_attention_post', 'view/middle_state'),
      edge('front/middle-ffn-pre', 'view/middle_state', 'mhc_mlp_pre'),
      edge('front/ffn-state-pre', 'mhc_mlp_residual_state', 'mhc_mlp_pre', 'state', { sourceAnchor: 'left', targetAnchor: 'right', curve: 'horizontal' }),
      edge('front/ffn-pre-norm', 'mhc_mlp_pre', 'pre_mlp_norm'),
      ...(dense ? [
        edge('front/norm-dense', 'pre_mlp_norm', 'dense_gate_up'),
        edge('front/dense-param', 'dense_mlp_weights', 'dense_gate_up', 'parameter', { sourceAnchor: 'right', targetAnchor: 'left', curve: 'horizontal' }),
        edge('front/gate-silu', 'dense_gate_up', 'dense_silu'),
        edge('front/silu-down', 'dense_silu', 'dense_down'),
        edge('front/dense-post', 'dense_down', 'post_mlp_norm'),
      ] : [
        edge('front/norm-router', 'pre_mlp_norm', 'router_gate'),
        edge('front/router-topk', 'router_gate', 'route_topk'),
        edge('front/topk-experts', 'route_topk', 'routed_expert_bank', 'communication'),
        edge('front/experts-combine', 'routed_expert_bank', 'moe_combine', 'communication'),
        edge('front/shared-combine', 'shared_expert_mlp', 'moe_combine', 'activation', { sourceAnchor: 'bottom', targetAnchor: 'right' }),
        edge('front/combine-post', 'moe_combine', 'post_mlp_norm'),
      ]),
      edge('front/post-ffn-merge', 'post_mlp_norm', 'mhc_mlp_post'),
      edge('front/ffn-merge-output', 'mhc_mlp_post', 'view/layer_output'),
      edge('front/layer-tail', 'view/layer_output', selectedLayer < dataset.model.numHiddenLayers - 1 ? 'view/remaining_layers' : 'final_norm'),
      ...(selectedLayer < dataset.model.numHiddenLayers - 1 ? [edge('front/tail-final', 'view/remaining_layers', 'final_norm')] : []),
      edge('front/final-head', 'final_norm', 'lm_head'),
      edge('front/head-weight', 'lm_head_weight', 'lm_head', 'parameter', { sourceAnchor: 'right', targetAnchor: 'left', curve: 'horizontal' }),
      edge('front/head-logits', 'lm_head', 'logits'),
    ];

    const aliases = {
      kv_cache: 'rope_cache',
      sparse_mla_attention: 'attention_core',
      moe_all_to_all_dispatch: 'router_gate',
      moe_all_to_all_combine: 'moe_combine',
      dense_mlp: dense ? 'dense_gate_up' : null,
      moe_ffn: dense ? null : 'router_gate',
      decoder_layer: 'view/layer_input',
    };
    return {
      schemaVersion: FRONT_VIEW_SCHEMA,
      model: { id: dataset.model.id, label: dataset.model.name },
      nodes,
      structure,
      edges,
      residualBundles: [
        { id: 'front/attention-residual-x4', source: 'view/layer_input', target: 'mhc_attention_post', count: residualStreams, side: 'left', containerId: 'mhc_attention', containerInset: 82, label: `mHC residual ×${residualStreams}` },
        { id: 'front/ffn-residual-x4', source: 'view/middle_state', target: 'mhc_mlp_post', count: residualStreams, side: 'left', containerId: 'mhc_mlp', containerInset: 82, label: `mHC residual ×${residualStreams}` },
      ],
      evidence,
      initialCollapsedIds: options.collapsedIds ? [...options.collapsedIds] : [],
      selectedNodeId: options.selectedNodeId || null,
      metadata: { selectedLayer, dense, aliases, sourceGraphHash: graph.content_hash },
    };
  }

  function resolveFrontViewNodeId(frontView, canonicalNodeId) {
    if (!canonicalNodeId) return null;
    if (frontView.nodes[canonicalNodeId]) return canonicalNodeId;
    return frontView.metadata?.aliases?.[canonicalNodeId] || null;
  }

  function defaultCollapsed(dataset, selectedLayer) {
    return new Set();
  }

  function buildMoeRoutingInput(dataset) {
    const placements = new Map(dataset.expertPlacements.map((item) => [item.logicalExpertId, item]));
    return dataset.expertLoads.map((load) => ({ ...load, placement: placements.get(load.logicalExpertId) }));
  }

  function buildTimelineInput(dataset) {
    return Object.freeze({ events: dataset.events, ranks: dataset.ranks, epGroups: dataset.epGroups, stages: dataset.stages });
  }

  const api = Object.freeze({
    validateArchitectureBinding,
    buildModelFrontViewInput,
    resolveFrontViewNodeId,
    buildMoeRoutingInput,
    buildTimelineInput,
    indexArchitecture,
    defaultCollapsed,
  });
  global.TrainingViewAdaptersV4 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

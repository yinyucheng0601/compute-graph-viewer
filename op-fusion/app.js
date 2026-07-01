(function attachOpFusionApp() {
  'use strict';

  const SEM = {
    embedding: 'var(--op-sem-embedding)',
    norm: 'var(--op-sem-norm)',
    attention: 'var(--op-sem-attention)',
    qknorm: 'var(--op-sem-qknorm)',
    rope: 'var(--op-sem-rope)',
    linear: 'var(--op-sem-linear)',
    gate: 'var(--op-sem-gate)',
    moe: 'var(--op-sem-moe)',
    act: 'var(--op-sem-act)',
    comm: 'var(--op-sem-comm)',
    io: 'var(--op-sem-io)',
  };

  const FUSION_LIB = {
    qknorm_rope: {
      prio: 's',
      title: 'QK-Norm + RoPE 融合',
      star: true,
      chain: [['q_norm', 'fu'], ['->'], ['k_norm', 'fu'], ['->'], ['RoPE', 'fu'], ['=>'], ['RmsNormRope', 'out']],
      gains: [['访存 -42%', 'mem'], ['吞吐 +1.3x', 'tp'], ['kernel 3->1', '']],
      reason: 'Qwen3 在 QKV 投影后、RoPE 前对 Q/K 按 <b>head_dim=128</b> 做 per-head RMSNorm。单独执行时 q_norm/k_norm 是访存受限的小向量算子，归一化后的 Q/K 要落 HBM 再被 RoPE 读回。融合后归一化结果驻留 UB，直接喂给旋转编码。',
      affects: ['q_norm', 'k_norm', 'rotary_emb'],
      doc: 'aclnnRmsNormRope / ascendc_kernels/rms_norm_rope.h',
      vllm: [
        '# vLLM: q/k norm 与 rope 分立 (qwen3)',
        'q = self.q_norm(q.view(-1, hd))',
        'k = self.k_norm(k.view(-1, hd))',
        'q, k = self.rotary_emb(pos, q, k)',
      ],
      asc: [
        '// Ascend: 单 kernel 完成 norm + rope',
        'aclnnRmsNormRope(q, k, gamma_q, gamma_k,',
        '                  cos, sin, eps, &q_out, &k_out);',
        '// Q/K 归一化结果驻留 UB，不落 HBM',
      ],
    },
    add_rmsnorm: {
      prio: 'h',
      title: '残差 Add + RMSNorm 融合',
      chain: [['residual', 'op'], ['+'], ['hidden', 'op'], ['->'], ['RMSNorm', 'fu'], ['=>'], ['AddRmsNorm', 'out']],
      gains: [['访存 -35%', 'mem'], ['吞吐 +1.2x', 'tp'], ['kernel 2->1', '']],
      reason: '每个 decoder layer 入口都是 <b>residual add -> RMSNorm</b> 的固定组合。融合为 AddRmsNorm 后，残差加法结果直接在片上参与归一化平方和归约，减少一次 [batch, seq, hidden] 写回与读取。',
      affects: ['attn_norm', 'ffn_norm'],
      doc: 'aclnnAddRmsNorm / ops: add_rms_norm',
      vllm: [
        '# vLLM: add 与 norm 分两步',
        'hidden = residual + hidden',
        'hidden = self.input_layernorm(hidden)',
      ],
      asc: [
        '// Ascend: 残差加法结果片上直接归一化',
        'aclnnAddRmsNorm(x, residual, gamma, eps,',
        '                &y, &new_residual);',
      ],
    },
    swiglu: {
      prio: 'h',
      title: 'SwiGLU 激活融合 (SiluAndMul)',
      chain: [['gate_proj', 'op'], ['silu', 'fu'], ['x'], ['up_proj', 'op'], ['=>'], ['SiluAndMul', 'out']],
      gains: [['访存 -30%', 'mem'], ['吞吐 +1.25x', 'tp']],
      reason: 'MLP 的 <b>SiLU(gate) * up</b> 若拆成 silu、elementwise-mul 两个 Vector 算子，中间结果会往返 HBM。融合为 SiluAndMul 后，gate 分支过 SiLU 后立即与 up 分支逐元素相乘。',
      affects: ['mlp_act'],
      doc: 'aclnnSwiGlu / SiluAndMul',
      vllm: [
        '# vLLM: SiluAndMul 已是融合算子接口',
        'x = self.act_fn(gate_up)',
        '# act_fn = silu(gate) * up',
      ],
      asc: [
        '// Ascend: gate 过 silu 后片上直乘 up',
        'aclnnSwiGlu(gate_up, dim, &out);',
      ],
    },
    qkv_merge: {
      prio: 'm',
      title: 'QKV 合并投影 (MergedColumnParallel)',
      chain: [['q_proj', 'op'], ['k_proj', 'op'], ['v_proj', 'op'], ['=>'], ['QKVProj', 'out']],
      gains: [['吞吐 +1.15x', 'tp'], ['启动开销下降', '']],
      reason: 'Q/K/V 三个 Linear 共享同一输入 hidden。合并为单个 <b>QKVParallelLinear</b> 做一次大 GEMM，可以更好填满 Cube 单元并减少 kernel 启动与权重重排开销。',
      affects: ['qkv_proj'],
      doc: 'QKVParallelLinear / aclnnMatmul',
      vllm: [
        '# vLLM: QKVParallelLinear 一次投影',
        'qkv = self.qkv_proj(hidden)',
        'q, k, v = qkv.split([qs, kvs, kvs], -1)',
      ],
      asc: [
        '// Ascend: 单 GEMM, Qwen3 无 bias',
        'aclnnMatmul(hidden, qkv_w, &qkv);',
      ],
    },
    flash_paged: {
      prio: 'm',
      title: 'FlashAttention + PagedKV 融合',
      chain: [['QK^T', 'op'], ['softmax', 'fu'], ['xV', 'op'], ['+ PagedKV'], ['=>'], ['FlashAttn', 'out']],
      gains: [['显存下降', 'mem'], ['长序列吞吐提升', 'tp']],
      reason: '<b>FlashAttention</b> 分块计算 QK^T、online-softmax 和加权 V，打分矩阵不落 HBM；叠加 PagedAttention 的分页 KV-cache，按 block 寻址非连续 KV。',
      affects: ['attention'],
      doc: 'aclnnFlashAttention / PagedAttention',
      vllm: [
        '# vLLM: 统一注意力后端入口',
        'out = self.attn(q, k, v, kv_cache,',
        '                attn_metadata)',
      ],
      asc: [
        '// Ascend: 融合 flash + 分页 KV',
        'aclnnFlashAttentionPaged(q, k, v,',
        '                         block_tables, &out);',
      ],
    },
    grouped_matmul: {
      prio: 's',
      title: 'MoE 路由 + GroupedMatmul 融合',
      star: true,
      chain: [['router', 'op'], ['->'], ['dispatch', 'fu'], ['->'], ['expert GEMM', 'fu'], ['=>'], ['GroupedMatmul', 'out']],
      gains: [['访存下降', 'mem'], ['专家并行提升', 'tp'], ['零 padding', '']],
      reason: 'MoE 下每个 token 只激活 top-k 专家。<b>GroupedMatmul</b> 把路由后变长的 token 分组，按 group_list 一次性发起分组矩阵乘，避免 padding 浪费并提升 Cube 利用率。',
      affects: ['router', 'experts'],
      doc: 'aclnnGroupedMatmul / moe_dispatch_combine',
      vllm: [
        '# vLLM: FusedMoE 入口',
        'out = self.experts(hidden, router_logits)',
      ],
      asc: [
        '// Ascend: 变长分组矩阵乘, 无 padding',
        'aclnnGroupedMatmul(x, w, group_list, &out);',
      ],
    },
  };

  const MODELS = {
    qwen3_14b: {
      name: 'Qwen3-14B',
      tags: [['Dense', 'def'], ['QK-Norm', 'new']],
      meta: 'hidden 5120 · ffn 17408 · L40\nGQA 40Q:8KV · hd 128 · no-bias',
      recs: ['qknorm_rope', 'add_rmsnorm', 'swiglu', 'qkv_merge', 'flash_paged'],
      spec: { name: 'Qwen3-14B', layers: 40, qh: 40, kvh: 8, topk: 0, experts: 0, variant: 'dense', qknorm: true, attnBias: false },
    },
    qwen2_7b: {
      name: 'Qwen2-7B',
      tags: [['Dense', 'def']],
      meta: 'hidden 3584 · ffn 18944 · L28\nGQA 28Q:4KV · hd 128 · +qkv bias',
      recs: ['add_rmsnorm', 'swiglu', 'qkv_merge', 'flash_paged'],
      spec: { name: 'Qwen2-7B', layers: 28, qh: 28, kvh: 4, topk: 0, experts: 0, variant: 'dense', qknorm: false, attnBias: true },
    },
    llama3_8b: {
      name: 'Llama-3-8B',
      tags: [['Dense', 'def']],
      meta: 'hidden 4096 · ffn 14336 · L32\nGQA 32Q:8KV · hd 128 · no-bias',
      recs: ['add_rmsnorm', 'swiglu', 'qkv_merge', 'flash_paged'],
      spec: { name: 'Llama-3-8B', layers: 32, qh: 32, kvh: 8, topk: 0, experts: 0, variant: 'dense', qknorm: false, attnBias: false },
    },
    mixtral: {
      name: 'Mixtral-8x7B',
      tags: [['MoE', 'moe']],
      meta: 'hidden 4096 · ffn 14336 · L32\nGQA 32Q:8KV · 8 experts top-2',
      recs: ['grouped_matmul', 'add_rmsnorm', 'swiglu', 'qkv_merge', 'flash_paged'],
      spec: { name: 'Mixtral-8x7B', layers: 32, qh: 32, kvh: 8, topk: 2, experts: 8, variant: 'moe', qknorm: false, attnBias: false },
    },
  };

  const OP_SOURCE = {
    embedding: {
      doc: 'vllm/model_executor/layers/vocab_parallel_embedding.py',
      vllm: [
        '# Parallel embedding lookup',
        'hidden_states = self.embed_tokens(input_ids)',
        'hidden_states = tensor_model_parallel_all_reduce(hidden_states)',
      ],
      asc: [
        '// Ascend: token id -> hidden state',
        'aclnnGather(embedding_weight, token_ids, &hidden_states);',
        'aclnnAllReduce(hidden_states, comm_group, &hidden_states);',
      ],
    },
    attention: {
      doc: 'vllm/attention/layer.py',
      vllm: [
        '# Unified attention backend',
        'attn_output = self.attn(q, k, v, kv_cache,',
        '                        attn_metadata)',
      ],
      asc: [
        '// Ascend: flash attention with paged KV',
        'aclnnFlashAttentionPaged(q, k, v, block_tables,',
        '                         seq_lens, &attn_output);',
      ],
    },
    gate_up: {
      doc: 'vllm/model_executor/layers/linear.py',
      vllm: [
        '# Merged gate/up projection',
        'gate_up, _ = self.gate_up_proj(hidden_states)',
        'gate, up = gate_up.chunk(2, dim=-1)',
      ],
      asc: [
        '// Ascend: merged column parallel matmul',
        'aclnnMatmul(hidden_states, gate_up_weight, &gate_up);',
        'Split(gate_up, axis=-1, &gate, &up);',
      ],
    },
    down_proj: {
      doc: 'vllm/model_executor/layers/linear.py',
      vllm: [
        '# Row-parallel down projection',
        'hidden_states, _ = self.down_proj(hidden_states)',
      ],
      asc: [
        '// Ascend: FFN down projection',
        'aclnnMatmul(activation, down_weight, &hidden_states);',
        'aclnnAllReduce(hidden_states, comm_group, &hidden_states);',
      ],
    },
    lm_head: {
      doc: 'vllm/model_executor/layers/logits_processor.py',
      vllm: [
        '# Final vocabulary projection',
        'logits = self.lm_head(hidden_states)',
        'logits = self.logits_processor(logits)',
      ],
      asc: [
        '// Ascend: hidden -> vocab projection',
        'aclnnMatmul(hidden_states, lm_head_weight, &logits);',
      ],
    },
    router: {
      doc: 'vllm/model_executor/layers/fused_moe/layer.py',
      vllm: [
        '# MoE router logits',
        'router_logits, _ = self.gate(hidden_states)',
        'topk_weights, topk_ids = fused_topk(router_logits, top_k)',
      ],
      asc: [
        '// Ascend: top-k router dispatch',
        'aclnnTopk(router_logits, top_k, &topk_weights, &topk_ids);',
      ],
    },
    dispatch: {
      doc: 'vllm/model_executor/layers/fused_moe/layer.py',
      vllm: [
        '# Dispatch tokens to selected experts',
        'permuted_tokens = moe_align_block_size(hidden_states, topk_ids)',
      ],
      asc: [
        '// Ascend: expert token regroup',
        'MoeDispatch(hidden_states, topk_ids, &expert_tokens);',
      ],
    },
    experts: {
      doc: 'vllm/model_executor/layers/fused_moe/fused_moe.py',
      vllm: [
        '# Grouped expert matmul',
        'expert_out = fused_experts(hidden_states, w1, w2,',
        '                           topk_weights, topk_ids)',
      ],
      asc: [
        '// Ascend: grouped matmul per expert',
        'aclnnGroupedMatmul(expert_tokens, expert_weights,',
        '                   group_list, &expert_out);',
      ],
    },
  };

  const SVGNS = 'http://www.w3.org/2000/svg';
  const els = {};
  let G = null;
  let NM = {};
  let view = { tx: 0, ty: 0, z: 1 };
  let pan = null;
  let selectedNode = null;
  let showBrackets = true;
  let currentModel = null;

  function svg(tag, attrs = {}) {
    const element = document.createElementNS(SVGNS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value != null) element.setAttribute(key, value);
    });
    return element;
  }

  function esc(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    }[char]));
  }

  function buildGraph(spec) {
    const cx = 470;
    const Wp = 168;
    const Wo = 252;
    const Wt = 190;
    const Lx = 150;
    const Rx = 790;
    const N = [];
    const E = [];
    const CL = [];
    let y = 56;

    const op = (id, label, type, sem, opts = {}) => {
      N.push({ id, label, typeLabel: type, kind: 'op', sem, x: cx, y, w: Wo, h: 52, ...opts });
    };
    const io = (id, label, type, opts = {}) => {
      N.push({ id, label, typeLabel: type, kind: 'io', x: cx, y, w: Wt, h: 44, ...opts });
    };
    const pL = (id, label, metric, toId, tag = 'W') => {
      const target = N.find((node) => node.id === toId);
      N.push({ id, label, typeLabel: metric, kind: 'param', x: Lx, y: target.y, w: Wp, h: 42 });
      E.push({ s: id, t: toId, tag, type: 'param' });
    };
    const pR = (id, label, metric, toId, tag = 'γ') => {
      const target = N.find((node) => node.id === toId);
      N.push({ id, label, typeLabel: metric, kind: 'param', x: Rx, y: target.y, w: Wp, h: 42 });
      E.push({ s: id, t: toId, tag, type: 'param' });
    };
    const flow = (s, t, tag = 'ACT', type = 'act') => E.push({ s, t, tag, type });

    io('token_ids', 'Token IDs', 'Input');
    y += 104;
    op('embedding', 'Parallel Embedding', 'Op', 'embedding');
    y += 120;
    flow('token_ids', 'embedding');
    pL('emb_w', 'Embedding W', '[vocab, h]', 'embedding');

    op('attn_norm', 'attn RMSNorm', 'Op', 'norm', { fuseRec: 'add_rmsnorm', typeLabel: 'AddRmsNorm?' });
    y += 96;
    flow('embedding', 'attn_norm');
    pR('attn_g', 'attn γ', '[h]', 'attn_norm');

    op('qkv_proj', 'QKV Projection', 'Op', 'linear', { fuseRec: 'qkv_merge', typeLabel: spec.attnBias ? '+bias' : 'no-bias' });
    y += 96;
    flow('attn_norm', 'qkv_proj');
    pL('qkv_w', 'QKV W', `[h, ${spec.attnBias ? '+b' : 'q+2kv'}]`, 'qkv_proj');

    if (spec.qknorm) {
      op('q_norm', 'Q-Norm', 'Op', 'qknorm', { fuseRec: 'qknorm_rope', typeLabel: 'per-head RMS' });
      y += 88;
      flow('qkv_proj', 'q_norm', 'Q');
      pR('qn_g', 'q_norm γ', '[hd=128]', 'q_norm');
      op('k_norm', 'K-Norm', 'Op', 'qknorm', { fuseRec: 'qknorm_rope', typeLabel: 'per-head RMS' });
      y += 88;
      flow('q_norm', 'k_norm', 'K');
      pR('kn_g', 'k_norm γ', '[hd=128]', 'k_norm');
      op('rotary_emb', 'RoPE', 'Op', 'rope', { fuseRec: 'qknorm_rope', typeLabel: 'rotary' });
      y += 96;
      flow('k_norm', 'rotary_emb');
    } else {
      op('rotary_emb', 'RoPE', 'Op', 'rope', { typeLabel: 'rotary' });
      y += 96;
      flow('qkv_proj', 'rotary_emb');
    }

    op('attention', 'Grouped Attention', 'Op', 'attention', { fuseRec: 'flash_paged', typeLabel: `GQA ${spec.qh}:${spec.kvh}` });
    y += 96;
    flow('rotary_emb', 'attention');
    pL('o_w', 'O-Proj W', '[hd, h]', 'attention');

    op('ffn_norm', 'ffn RMSNorm', 'Op', 'norm', { fuseRec: 'add_rmsnorm', typeLabel: 'AddRmsNorm?' });
    y += 96;
    flow('attention', 'ffn_norm');
    pR('ffn_g', 'ffn γ', '[h]', 'ffn_norm');

    let lastBlock = '';
    let moeClusterOps = [];
    if (spec.variant === 'moe') {
      op('router', 'Router (Gate)', 'Op', 'gate', { fuseRec: 'grouped_matmul', typeLabel: `top-${spec.topk}` });
      y += 92;
      flow('ffn_norm', 'router');
      pL('gate_w', 'Gate W', `[h, E=${spec.experts}]`, 'router');
      op('dispatch', 'Token Dispatch', 'Comm', 'comm', { fuseRec: 'grouped_matmul', typeLabel: 'all-to-all' });
      y += 88;
      flow('router', 'dispatch', 'DISPATCH', 'comm');
      op('experts', `Experts x ${spec.experts}`, 'Op', 'moe', { fuseRec: 'grouped_matmul', typeLabel: 'GroupedMM' });
      y += 88;
      flow('dispatch', 'experts', 'TOKENS', 'comm');
      pL('eup_w', 'Expert up W', '[h, ffn]', 'experts');
      pR('edn_w', 'Expert down W', '[ffn, h]', 'experts');
      op('mlp_act', 'SwiGLU (in expert)', 'Op', 'act', { fuseRec: 'swiglu', typeLabel: 'SiluAndMul' });
      y += 92;
      flow('experts', 'mlp_act', 'COMBINE', 'comm');
      lastBlock = 'mlp_act';
      moeClusterOps = ['router', 'dispatch', 'experts', 'mlp_act'];
    } else {
      op('gate_up', 'Gate/Up Proj', 'Op', 'linear', { typeLabel: 'merged' });
      y += 88;
      flow('ffn_norm', 'gate_up');
      pL('gu_w', 'Gate/Up W', '[h, 2·ffn]', 'gate_up');
      op('mlp_act', 'SwiGLU', 'Op', 'act', { fuseRec: 'swiglu', typeLabel: 'SiluAndMul' });
      y += 88;
      flow('gate_up', 'mlp_act');
      op('down_proj', 'Down Proj', 'Op', 'linear', { typeLabel: 'ffn->h' });
      y += 92;
      flow('mlp_act', 'down_proj');
      pL('dn_w', 'Down W', '[ffn, h]', 'down_proj');
      lastBlock = 'down_proj';
    }

    op('final_norm', 'final RMSNorm', 'Op', 'norm', { typeLabel: 'RMSNorm' });
    y += 96;
    flow(lastBlock, 'final_norm');
    pR('fn_g', 'final γ', '[h]', 'final_norm');
    op('lm_head', 'LM Head', 'Op', 'linear', { typeLabel: 'h->vocab' });
    y += 104;
    flow('final_norm', 'lm_head');
    pL('lm_w', 'LM Head W', '[h, vocab]', 'lm_head');
    io('logits', 'Logits', 'Output');
    y += 60;
    flow('lm_head', 'logits', 'LOSS');

    const nodeById = new Map(N.map((node) => [node.id, node]));
    const existingIds = (ids) => ids.filter((id) => nodeById.has(id));
    const withParamTensors = (ids) => {
      const scope = new Set(existingIds(ids));
      E.forEach((edge) => {
        if (edge.type === 'param' && scope.has(edge.t)) scope.add(edge.s);
      });
      return Array.from(scope);
    };
    const boundsFor = (ids, padding = {}) => {
      const nodes = existingIds(ids).map((id) => nodeById.get(id));
      if (!nodes.length) return null;
      const padX = padding.x ?? 18;
      const padTop = padding.top ?? 28;
      const padBottom = padding.bottom ?? 18;
      const left = Math.min(...nodes.map((node) => node.x - node.w / 2));
      const right = Math.max(...nodes.map((node) => node.x + node.w / 2));
      const top = Math.min(...nodes.map((node) => node.y - node.h / 2));
      const bottom = Math.max(...nodes.map((node) => node.y + node.h / 2));
      return {
        x: left - padX,
        y: top - padTop,
        w: right - left + padX * 2,
        h: bottom - top + padTop + padBottom,
      };
    };

    const decoderOps = existingIds([
      'attn_norm',
      'qkv_proj',
      'q_norm',
      'k_norm',
      'rotary_emb',
      'attention',
      'ffn_norm',
      'router',
      'dispatch',
      'experts',
      'gate_up',
      'mlp_act',
      'down_proj',
    ]);
    const transformerStackIds = withParamTensors(decoderOps.concat('final_norm'));
    const decoderIds = withParamTensors(decoderOps);
    const transformerBox = boundsFor(transformerStackIds, { x: 26, top: 42, bottom: 26 });
    const decoderBox = boundsFor(decoderIds, { x: 18, top: 34, bottom: 22 });
    if (transformerBox) CL.push({ id: 'transformer', label: 'Transformer Stack', ...transformerBox });
    if (decoderBox) CL.push({ id: 'decoder', label: `Decoder Layer x ${spec.layers}`, ...decoderBox, repeat: true });
    if (moeClusterOps.length) {
      const moeBox = boundsFor(withParamTensors(moeClusterOps), { x: 16, top: 26, bottom: 18 });
      if (moeBox) CL.push({ id: 'moe', label: 'MoE FFN · 专家分组', ...moeBox, repeat: false });
    }
    return { width: 980, height: y + 20, clusters: CL, nodes: N, edges: E, spec };
  }

  function anchor(node, direction) {
    return {
      x: direction === 'l' ? node.x - node.w / 2 : direction === 'r' ? node.x + node.w / 2 : node.x,
      y: direction === 't' ? node.y - node.h / 2 : direction === 'b' ? node.y + node.h / 2 : node.y,
    };
  }

  function edgePath(source, target) {
    if (Math.abs(source.x - target.x) < Math.abs(source.y - target.y)) {
      const a = anchor(source, source.y < target.y ? 'b' : 't');
      const b = anchor(target, source.y < target.y ? 't' : 'b');
      const my = (a.y + b.y) / 2;
      return { d: `M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`, mx: (a.x + b.x) / 2, my };
    }
    const a = anchor(source, source.x < target.x ? 'r' : 'l');
    const b = anchor(target, source.x < target.x ? 'l' : 'r');
    const mx = (a.x + b.x) / 2;
    return { d: `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`, mx, my: (a.y + b.y) / 2 };
  }

  function applyTransform() {
    els.gsvg.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.z})`;
  }

  function fit() {
    if (!G) return;
    const rect = els.stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const pad = 30;
    const z = Math.min((rect.width - pad * 2) / G.width, (rect.height - pad * 2) / G.height, 1.05);
    view.z = Math.max(z, 0.22);
    view.tx = Math.max(pad, (rect.width - G.width * view.z) / 2);
    view.ty = pad / 2;
    applyTransform();
  }

  function renderGraph(graph) {
    G = graph;
    NM = {};
    graph.nodes.forEach((node) => {
      NM[node.id] = node;
    });
    els.gsvg.innerHTML = '';
    els.gsvg.setAttribute('viewBox', `0 0 ${graph.width} ${graph.height}`);
    els.gsvg.setAttribute('width', graph.width);
    els.gsvg.setAttribute('height', graph.height);

    const defs = svg('defs');
    const marker = svg('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 8.6, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'var(--border-strong)' }));
    defs.appendChild(marker);
    els.gsvg.appendChild(defs);

    graph.clusters.forEach((cluster) => {
      const group = svg('g');
      group.appendChild(svg('rect', {
        class: `cl-rect${cluster.repeat ? ' repeat' : ''}`,
        x: cluster.x,
        y: cluster.y,
        width: cluster.w,
        height: cluster.h,
        rx: 16,
        ry: 16,
      }));
      const label = svg('text', { class: 'cl-label', x: cluster.x + 18, y: cluster.y + 22 });
      label.textContent = cluster.label;
      group.appendChild(label);
      els.gsvg.appendChild(group);
    });

    const edgeEls = [];
    graph.edges.forEach((edge) => {
      const source = NM[edge.s];
      const target = NM[edge.t];
      if (!source || !target) return;
      const pathData = edgePath(source, target);
      const cls = `edge ${edge.type === 'param' ? 'param' : edge.type === 'comm' ? 'comm' : ''}`;
      const path = svg('path', { class: cls, d: pathData.d, 'marker-end': 'url(#arr)' });
      els.gsvg.appendChild(path);
      if (edge.tag) {
        const width = edge.tag.length * 6 + 12;
        const tag = svg('g');
        tag.appendChild(svg('rect', { class: 'etag-bg', x: pathData.mx - width / 2, y: pathData.my - 8, width, height: 16, rx: 4 }));
        const text = svg('text', {
          class: `etag ${edge.type === 'param' ? 'param' : edge.type === 'comm' ? 'comm' : ''}`,
          x: pathData.mx,
          y: pathData.my + 1,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        });
        text.textContent = edge.tag;
        tag.appendChild(text);
        els.gsvg.appendChild(tag);
      }
      edgeEls.push({ el: path, edge });
    });
    graph._edgeEls = edgeEls;

    graph.nodes.forEach((node) => {
      const kind = node.kind;
      const group = svg('g', {
        class: `nd ${kind === 'tensor' || kind === 'param' ? 'tensor' : kind === 'io' ? 'io' : 'op'}${node.fuseRec ? ' fuse' : ''}`,
        transform: `translate(${node.x}, ${node.y})`,
      });
      group.dataset.id = node.id;
      const radius = kind === 'op' ? node.h / 2 : Math.min(13, node.h * 0.32);
      const fill = kind === 'op' ? (SEM[node.sem] || 'var(--primary)') : null;
      group.appendChild(svg('rect', {
        class: 'nd-rect',
        x: -node.w / 2,
        y: -node.h / 2,
        width: node.w,
        height: node.h,
        rx: radius,
        ry: radius,
        fill,
        stroke: kind === 'op' ? 'color-mix(in srgb, var(--foreground) 16%, transparent)' : null,
      }));
      const label = svg('text', { class: 'nd-label', x: 0, y: kind === 'op' ? -3 : 0 });
      label.textContent = node.label;
      group.appendChild(label);
      if (kind !== 'tensor' && kind !== 'io') {
        const type = svg('text', { class: 'nd-type', x: 0, y: 11 });
        type.textContent = node.typeLabel;
        group.appendChild(type);
      } else if (kind === 'param') {
        const type = svg('text', { class: 'nd-type', x: 0, y: 11 });
        type.textContent = node.typeLabel;
        group.appendChild(type);
      }
      if (node.fuseRec) {
        const rec = FUSION_LIB[node.fuseRec];
        if (rec?.star) {
          const star = svg('text', { class: 'fuse-star', x: node.w / 2 - 12, y: 0 });
          star.textContent = '★';
          group.appendChild(star);
        } else {
          group.appendChild(svg('circle', { class: 'fuse-dot', cx: node.w / 2 - 11, cy: 0, r: 4 }));
        }
      }
      group.addEventListener('click', (event) => {
        event.stopPropagation();
        selectNode(node.id, 'graph', event);
      });
      group.addEventListener('mousemove', (event) => showTip(node, event));
      group.addEventListener('mouseleave', hideTip);
      els.gsvg.appendChild(group);
      node._el = group;
    });

    renderBrackets();
    requestAnimationFrame(fit);
  }

  function renderBrackets() {
    els.gsvg.querySelectorAll('.fbracket,.fbracket-bg,.fbracket-lbl').forEach((node) => node.remove());
    if (!showBrackets || !G) return;
    const spine = G.nodes.filter((node) => node.kind === 'op');
    let i = 0;
    while (i < spine.length) {
      const rec = spine[i].fuseRec;
      if (!rec) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < spine.length && spine[j + 1].fuseRec === rec) j += 1;
      const top = spine[i].y - spine[i].h / 2 - 18;
      const bottom = spine[j].y + spine[j].h / 2 + 8;
      const rectX = spine[i].x - spine[i].w / 2 - 6;
      const rectW = spine[i].w + 54;
      const x = spine[i].x + spine[i].w / 2 + 14;
      els.gsvg.appendChild(svg('rect', {
        class: 'fbracket-bg',
        x: rectX,
        y: top,
        width: rectW,
        height: bottom - top,
        rx: 12,
      }));
      els.gsvg.appendChild(svg('path', { class: 'fbracket', d: `M ${x} ${top + 16} h 10 v ${Math.max(8, bottom - top - 16)} h -10` }));
      const label = svg('text', {
        class: 'fbracket-lbl',
        x: rectX + 10,
        y: top + 10,
        'dominant-baseline': 'central',
      });
      label.textContent = `=> ${FUSION_LIB[rec]?.chain.slice(-1)[0][0] || 'fusion'}`;
      els.gsvg.appendChild(label);
      i = j + 1;
    }
  }

  function showTip(node, event) {
    const type = node.typeLabel || node.kind;
    let html = `<div class="op-graph-tip__head"><span class="op-graph-tip__kind">${esc(type).slice(0, 16)}</span>${esc(node.label)}</div>`;
    html += `<div class="op-graph-tip__row">类型：<b>${node.kind === 'op' ? '算子 Op' : node.kind === 'param' ? '权重张量' : node.kind === 'io' ? 'IO 张量' : '张量'}</b></div>`;
    if (node.fuseRec) {
      const rec = FUSION_LIB[node.fuseRec];
      html += `<div class="op-graph-tip__fusion">${rec?.star ? '★' : '●'} 可融合点 -> ${esc(rec?.title || node.fuseRec)}</div>`;
    }
    els.gtip.innerHTML = html;
    els.gtip.classList.add('is-visible');
    const rect = els.stage.getBoundingClientRect();
    const x = Math.min(event.clientX - rect.left + 16, rect.width - 300);
    const y = Math.min(event.clientY - rect.top + 16, rect.height - 130);
    els.gtip.style.left = `${Math.max(8, x)}px`;
    els.gtip.style.top = `${Math.max(8, y)}px`;
  }

  function hideTip() {
    els.gtip.classList.remove('is-visible');
  }

  function setLegendOpen(open) {
    if (!els.legend || !els.legendToggle) return;
    els.legend.hidden = !open;
    els.legendToggle.setAttribute('aria-expanded', String(open));
  }

  function genericSourceFor(node) {
    const opName = node.id.replace(/(^|_)([a-z])/g, (_match, _prefix, char) => char.toUpperCase());
    return {
      doc: `operator/${node.id}`,
      vllm: [
        `# ${node.label}`,
        `hidden_states = self.${node.id}(hidden_states)`,
        `# type: ${node.typeLabel || node.kind}`,
      ],
      asc: [
        `// Ascend: ${node.label}`,
        `aclnn${opName}(hidden_states, workspace, &output);`,
      ],
    };
  }

  function sourceForNode(node) {
    if (!node || node.kind !== 'op') return null;
    if (node.fuseRec && FUSION_LIB[node.fuseRec]) {
      const rec = FUSION_LIB[node.fuseRec];
      return {
        title: `${node.label} · ${rec.title}`,
        meta: `${node.id} · ${node.typeLabel}`,
        doc: rec.doc,
        blocks: [
          ['V · vLLM 对应源码', rec.vllm],
          ['A · 昇腾融合算子', rec.asc],
        ],
      };
    }
    const base = OP_SOURCE[node.id] || OP_SOURCE[node.sem] || genericSourceFor(node);
    return {
      title: `${node.label} · 源码`,
      meta: `${node.id} · ${node.typeLabel}`,
      doc: base.doc,
      blocks: [
        ['V · vLLM 源码路径', base.vllm],
        ['A · Ascend 映射', base.asc],
      ],
    };
  }

  function placeSourcePanel(event) {
    if (!els.sourcePanel || !event) return;
    const host = els.sourcePanel.offsetParent || els.sourcePanel.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const panel = els.sourcePanel;
    const gap = 12;
    const pointerGap = 16;
    const panelWidth = panel.offsetWidth || 380;
    const panelHeight = panel.offsetHeight || 360;
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const maxX = Math.max(gap, rect.width - panelWidth - gap);
    const maxY = Math.max(gap, rect.height - panelHeight - gap);
    let x = pointerX + pointerGap;
    let y = pointerY + pointerGap;
    if (x > maxX) x = pointerX - panelWidth / 2;
    if (y > maxY) y = pointerY - panelHeight / 2;
    x = Math.max(gap, Math.min(x, maxX));
    y = Math.max(gap, Math.min(y, maxY));
    panel.style.setProperty('--op-source-left', `${Math.round(x)}px`);
    panel.style.setProperty('--op-source-top', `${Math.round(y)}px`);
  }

  function renderSourcePanel(node, event) {
    if (!els.sourcePanel || !els.sourceBody) return;
    const source = sourceForNode(node);
    if (!source) {
      hideSourcePanel();
      return;
    }
    els.sourceTitle.textContent = source.title;
    els.sourceMeta.textContent = source.meta;
    const doc = source.doc ? `<div class="op-source-panel__doc">${esc(source.doc)}</div>` : '';
    const blocks = source.blocks.map(([title, lines]) => codeBlock(title, lines)).join('');
    els.sourceBody.innerHTML = `${doc}${blocks}`;
    els.sourcePanel.hidden = false;
    placeSourcePanel(event);
  }

  function hideSourcePanel() {
    if (els.sourcePanel) els.sourcePanel.hidden = true;
  }

  function relatedOf(id) {
    const related = new Set([id]);
    G.edges.forEach((edge) => {
      if (edge.s === id) related.add(edge.t);
      if (edge.t === id) related.add(edge.s);
    });
    return related;
  }

  function selectNode(id, source, event) {
    hideTip();
    selectedNode = id;
    const related = relatedOf(id);
    G.nodes.forEach((node) => {
      node._el.classList.toggle('sel', node.id === id);
      node._el.classList.toggle('rel', node.id !== id && related.has(node.id));
      node._el.classList.toggle('dim', !related.has(node.id) && node.id !== id);
    });
    G._edgeEls.forEach(({ el, edge }) => {
      const isRelated = related.has(edge.s) && related.has(edge.t);
      el.classList.toggle('rel', isRelated);
      el.classList.toggle('dim', !isRelated);
    });
    document.querySelectorAll('.op-rec-card').forEach((card) => card.classList.remove('is-selected'));
    const node = NM[id];
    if (node?.kind === 'op') renderSourcePanel(node, event);
    else hideSourcePanel();
    if (node?.fuseRec) {
      const card = document.querySelector(`.op-rec-card[data-rec="${node.fuseRec}"]`);
      if (card) {
        card.classList.add('is-selected', 'is-open');
        syncExpander(card);
        if (source === 'graph') card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function clearSelection() {
    selectedNode = null;
    if (!G) return;
    G.nodes.forEach((node) => node._el.classList.remove('sel', 'rel', 'dim'));
    G._edgeEls.forEach(({ el }) => el.classList.remove('rel', 'dim'));
    document.querySelectorAll('.op-rec-card').forEach((card) => card.classList.remove('is-selected'));
    hideSourcePanel();
  }

  function chainHtml(chain) {
    return chain.map((segment) => {
      if (segment.length === 1) return `<span class="op-chain__arrow">${esc(segment[0])}</span>`;
      const [text, type] = segment;
      if (type === 'fu') return `<span class="op-chain__fuse">${esc(text)}</span>`;
      if (type === 'out') return `<span class="op-chain__out">[${esc(text)}]</span>`;
      return `<span class="op-chain__op">${esc(text)}</span>`;
    }).join(' ');
  }

  function codeBlock(title, lines) {
    return `<div class="op-code-block"><div class="op-code-block__head">${esc(title)}</div><pre>${lines.map(esc).join('\n')}</pre></div>`;
  }

  function renderRecommendations(model) {
    const recs = model.recs;
    const fusePoints = model.graph.nodes.filter((node) => node.fuseRec).length;
    els.rightD.textContent = `${recs.length} 个方案 · 计算图含 ${fusePoints} 个融合点`;
    els.topRecChip.textContent = `${recs.length} recs`;
    const summary = `<div class="op-summary-grid">
      <div class="op-summary-cell"><div class="op-summary-cell__value" data-tone="fusion">${recs.length}</div><div class="op-summary-cell__label">推荐方案</div></div>
      <div class="op-summary-cell"><div class="op-summary-cell__value" data-tone="info">${fusePoints}</div><div class="op-summary-cell__label">融合点</div></div>
      <div class="op-summary-cell"><div class="op-summary-cell__value" data-tone="success">${model.graph.nodes.filter((node) => node.kind === 'op').length}</div><div class="op-summary-cell__label">算子节点</div></div>
    </div>`;

    const cards = recs.map((id) => {
      const rec = FUSION_LIB[id];
      if (!rec) return '';
      const prioText = rec.prio === 's' ? 'STAR' : rec.prio === 'h' ? 'HIGH' : 'MED';
      const prioClass = rec.prio === 's' ? 'op-priority--star' : rec.prio === 'h' ? 'op-priority--high' : 'op-priority--medium';
      const gains = rec.gains.map(([label, kind]) => `<span class="op-gain ${kind === 'tp' ? 'op-gain--tp' : kind === 'mem' ? 'op-gain--mem' : ''}">${esc(label)}</span>`).join('');
      const affects = rec.affects
        .filter((nodeId) => NM[nodeId])
        .map((nodeId) => `<button class="btn btn-sm op-affect-chip" type="button" data-go="${esc(nodeId)}">${esc(NM[nodeId].label)}</button>`)
        .join('');
      return `<article class="op-rec-card" data-rec="${esc(id)}">
        <button class="op-rec-card__head" type="button" aria-expanded="false">
          <span class="op-priority ${prioClass}">${prioText}</span>
          <span class="op-rec-card__title">
            <span class="op-rec-card__name">${rec.star ? '<span class="op-badge op-badge--fusion">★</span> ' : ''}${esc(rec.title)}</span>
            <span class="op-chain">${chainHtml(rec.chain)}</span>
            <span class="op-gain-row">${gains}</span>
          </span>
          <span class="op-rec-card__expander" aria-hidden="true">v</span>
        </button>
        <div class="op-rec-card__body">
          <section class="op-detail-section">
            <div class="op-detail-section__head">推荐理由</div>
            <div class="op-reason">${rec.reason}</div>
          </section>
          <section class="op-detail-section">
            <div class="op-detail-section__head">代码对照 · vLLM -> Ascend</div>
            <div class="op-code-grid">${codeBlock('V · vLLM 原始实现', rec.vllm)}${codeBlock('A · 昇腾融合算子', rec.asc)}</div>
          </section>
          <section class="op-detail-section">
            <div class="op-detail-section__head">对应 CANN 文档</div>
            <div class="op-docref">${esc(rec.doc)}</div>
          </section>
          <section class="op-detail-section">
            <div class="op-detail-section__head">计算图中影响算子</div>
            <div class="op-affects">${affects}</div>
          </section>
        </div>
      </article>`;
    }).join('');

    els.rbody.innerHTML = `${summary}${cards}`;
    els.rbody.querySelectorAll('.op-rec-card__head').forEach((head) => {
      head.addEventListener('click', () => {
        const card = head.closest('.op-rec-card');
        card.classList.toggle('is-open');
        syncExpander(card);
        if (card.classList.contains('is-open')) highlightRecommendation(card.dataset.rec);
      });
    });
    els.rbody.querySelectorAll('[data-go]').forEach((chip) => {
      chip.addEventListener('click', (event) => {
        event.stopPropagation();
        selectNode(chip.dataset.go, 'recommendation');
      });
    });
  }

  function syncExpander(card) {
    const expanded = card.classList.contains('is-open');
    const button = card.querySelector('.op-rec-card__head');
    const expander = card.querySelector('.op-rec-card__expander');
    if (button) button.setAttribute('aria-expanded', String(expanded));
    if (expander) expander.textContent = expanded ? '^' : 'v';
  }

  function highlightRecommendation(id) {
    const rec = FUSION_LIB[id];
    if (!rec || !G) return;
    const affected = new Set(rec.affects.filter((nodeId) => NM[nodeId]));
    G.nodes.forEach((node) => {
      node._el.classList.toggle('sel', affected.has(node.id));
      node._el.classList.toggle('dim', !affected.has(node.id) && node.kind !== 'param');
      node._el.classList.remove('rel');
    });
    G._edgeEls.forEach(({ el, edge }) => {
      const isRelated = affected.has(edge.s) && affected.has(edge.t);
      el.classList.toggle('rel', isRelated);
      el.classList.toggle('dim', !isRelated);
    });
    const first = NM[rec.affects.find((nodeId) => NM[nodeId])];
    if (first) {
      const rect = els.stage.getBoundingClientRect();
      view.ty = rect.height / 2 - first.y * view.z;
      applyTransform();
    }
  }

  function renderModelList() {
    els.mlist.innerHTML = '';
    Object.entries(MODELS).forEach(([key, model]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `op-model-card${key === currentModel ? ' is-selected' : ''}`;
      button.dataset.model = key;
      button.innerHTML = `<span class="op-model-card__head">
        <span class="op-model-card__name">${esc(model.name)}</span>
        <span class="op-model-card__tags">${model.tags.map(([tag, cls]) => `<span class="op-badge ${cls === 'moe' ? 'op-badge--moe' : cls === 'new' ? 'op-badge--new' : ''}">${esc(tag)}</span>`).join('')}</span>
      </span>
      <span class="op-model-card__meta">${esc(model.meta).replace(/\n/g, '<br>')}</span>`;
      button.addEventListener('click', () => selectModel(key));
      els.mlist.appendChild(button);
    });
  }

  function selectModel(key) {
    currentModel = key;
    const model = MODELS[key];
    if (!model.graph) model.graph = buildGraph(model.spec);
    document.querySelectorAll('.op-model-card').forEach((card) => {
      card.classList.toggle('is-selected', card.dataset.model === key);
    });
    els.midD.textContent = `${model.name} · ${model.graph.nodes.filter((node) => node.kind === 'op').length} 算子 · ${model.graph.nodes.filter((node) => node.fuseRec).length} 融合点`;
    els.topModelChip.textContent = model.name;
    renderGraph(model.graph);
    renderRecommendations(model);
    clearSelection();
  }

  function parseUploadedConfig(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const cfg = JSON.parse(reader.result);
        const modelType = String(cfg.model_type || '').toLowerCase();
        const hidden = cfg.hidden_size || 4096;
        const ffn = cfg.intermediate_size || hidden * 4;
        const layers = cfg.num_hidden_layers || 32;
        const qh = cfg.num_attention_heads || 32;
        const kvh = cfg.num_key_value_heads || qh;
        const hd = cfg.head_dim || Math.round(hidden / qh);
        const experts = cfg.num_local_experts || cfg.num_experts || 0;
        const topk = cfg.num_experts_per_tok || cfg.moe_top_k || 0;
        const isMoe = experts > 0;
        const isQwen3 = modelType.includes('qwen3') || cfg.q_norm !== undefined || (modelType.includes('qwen') && cfg.attention_bias === false);
        const attnBias = cfg.attention_bias === true || (modelType.includes('qwen2') && cfg.attention_bias !== false);
        const spec = {
          name: String(cfg._name_or_path || cfg.model_type || 'uploaded').split('/').pop(),
          layers,
          qh,
          kvh,
          topk: topk || 2,
          experts: experts || 0,
          variant: isMoe ? 'moe' : 'dense',
          qknorm: isQwen3,
          attnBias,
        };
        const recs = [];
        if (spec.qknorm) recs.push('qknorm_rope');
        recs.push('add_rmsnorm', 'swiglu');
        if (isMoe) recs.push('grouped_matmul');
        recs.push('qkv_merge', 'flash_paged');
        const key = `uploaded_${Date.now()}`;
        MODELS[key] = {
          name: `${spec.name} (上传)`,
          tags: [[isMoe ? 'MoE' : 'Dense', isMoe ? 'moe' : 'def']].concat(spec.qknorm ? [['QK-Norm', 'new']] : []),
          meta: `hidden ${hidden} · ffn ${ffn} · L${layers}\nGQA ${qh}Q:${kvh}KV · hd ${hd}${isMoe ? ` · E${experts} top${topk || 2}` : ''}${spec.qknorm ? ' · QK-Norm' : ''}${attnBias ? ' · +bias' : ' · no-bias'}`,
          recs,
          spec,
          graph: buildGraph(spec),
        };
        renderModelList();
        selectModel(key);
        els.statusLeft.textContent = `Loaded ${file.name}`;
      } catch (error) {
        els.statusLeft.textContent = `config.json 解析失败: ${error.message}`;
      }
    };
    reader.readAsText(file);
  }

  function renderThemeToggle() {
    if (!els.themeToggle) return;
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const nextLabel = theme === 'light' ? '切换深色模式' : '切换浅色模式';
    els.themeToggle.setAttribute('aria-pressed', String(theme === 'light'));
    els.themeToggle.setAttribute('title', nextLabel);
    els.themeToggle.setAttribute('aria-label', nextLabel);
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = current === 'light' ? 'dark' : 'light';
    renderThemeToggle();
  }

  function initCursorFollow() {
    if (!els.frame) return;
    const show = () => {
      els.frame.style.setProperty('--ide-cursor-alpha', document.documentElement.dataset.theme === 'light' ? '0.20' : '0.28');
      els.frame.style.setProperty('--ide-dot-opacity', document.documentElement.dataset.theme === 'light' ? '0.24' : '0.34');
    };
    const hide = () => {
      els.frame.style.setProperty('--ide-cursor-alpha', '0');
      els.frame.style.setProperty('--ide-dot-opacity', '0');
    };
    const move = (event) => {
      const rect = els.frame.getBoundingClientRect();
      els.frame.style.setProperty('--ide-cursor-x', `${event.clientX - rect.left}px`);
      els.frame.style.setProperty('--ide-cursor-y', `${event.clientY - rect.top}px`);
      show();
    };
    els.frame.addEventListener('pointerenter', show);
    els.frame.addEventListener('pointermove', move);
    els.frame.addEventListener('pointerleave', hide);
  }

  function initInteractions() {
    els.topExplorerToggle?.addEventListener('click', () => {
      els.explorerToggle?.click();
    });
    els.themeToggle?.addEventListener('click', toggleTheme);
    els.legendToggle?.addEventListener('click', (event) => {
      event.stopPropagation();
      setLegendOpen(els.legend.hidden);
    });
    els.legend?.addEventListener('click', (event) => event.stopPropagation());
    els.sourceClose?.addEventListener('click', hideSourcePanel);
    renderThemeToggle();
    initCursorFollow();

    els.zin.addEventListener('click', () => {
      view.z = Math.min(2.4, view.z * 1.18);
      applyTransform();
    });
    els.zout.addEventListener('click', () => {
      view.z = Math.max(0.2, view.z / 1.18);
      applyTransform();
    });
    els.zfit.addEventListener('click', fit);
    els.zbr.addEventListener('click', () => {
      showBrackets = !showBrackets;
      els.zbr.classList.toggle('is-selected', showBrackets);
      renderBrackets();
    });

    els.stage.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.nd')) return;
      pan = { x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty };
      els.stage.setPointerCapture?.(event.pointerId);
      els.stage.classList.add('is-grabbing');
    });
    els.stage.addEventListener('pointermove', (event) => {
      if (!pan) return;
      view.tx = pan.tx + (event.clientX - pan.x);
      view.ty = pan.ty + (event.clientY - pan.y);
      applyTransform();
    });
    els.stage.addEventListener('pointerup', (event) => {
      pan = null;
      els.stage.releasePointerCapture?.(event.pointerId);
      els.stage.classList.remove('is-grabbing');
    });
    els.stage.addEventListener('pointercancel', () => {
      pan = null;
      els.stage.classList.remove('is-grabbing');
    });
    els.stage.addEventListener('wheel', (event) => {
      if (!event.metaKey) return;
      event.preventDefault();
      const rect = els.stage.getBoundingClientRect();
      const before = {
        x: (event.clientX - rect.left - view.tx) / view.z,
        y: (event.clientY - rect.top - view.ty) / view.z,
      };
      const factor = event.deltaY < 0 ? 1.1 : 0.9;
      view.z = Math.max(0.2, Math.min(2.4, view.z * factor));
      view.tx = event.clientX - rect.left - before.x * view.z;
      view.ty = event.clientY - rect.top - before.y * view.z;
      applyTransform();
    }, { passive: false });
    els.stage.addEventListener('click', (event) => {
      if (!event.target.closest('.nd')) clearSelection();
      setLegendOpen(false);
    });
    els.cfgfile.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) parseUploadedConfig(file);
    });

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => fit());
      observer.observe(els.stage);
    }
    window.addEventListener('resize', fit);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      setLegendOpen(false);
      hideSourcePanel();
    });
  }

  function init() {
    Object.assign(els, {
      frame: document.querySelector('.op-fusion-frame'),
      mlist: document.getElementById('mlist'),
      stage: document.getElementById('stage'),
      gsvg: document.getElementById('gsvg'),
      gtip: document.getElementById('gtip'),
      rbody: document.getElementById('rbody'),
      midD: document.getElementById('mid-d'),
      rightD: document.getElementById('right-d'),
      cfgfile: document.getElementById('cfgfile'),
      zin: document.getElementById('zin'),
      zout: document.getElementById('zout'),
      zfit: document.getElementById('zfit'),
      zbr: document.getElementById('zbr'),
      legendToggle: document.getElementById('legend-toggle'),
      legend: document.getElementById('legend'),
      topModelChip: document.getElementById('top-model-chip'),
      topRecChip: document.getElementById('top-rec-chip'),
      statusLeft: document.getElementById('status-left'),
      topExplorerToggle: document.getElementById('top-explorer-toggle'),
      explorerToggle: document.getElementById('op-explorer-toggle'),
      themeToggle: document.getElementById('theme-toggle'),
      sourcePanel: document.getElementById('op-source-panel'),
      sourceTitle: document.getElementById('op-source-title'),
      sourceMeta: document.getElementById('op-source-meta'),
      sourceBody: document.getElementById('op-source-body'),
      sourceClose: document.getElementById('source-close'),
    });
    renderModelList();
    initInteractions();
    selectModel('qwen3_14b');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

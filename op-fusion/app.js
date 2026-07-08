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
      chain: [['q_norm', 'fu'], ['+'], ['k_norm', 'fu'], ['+'], ['Q/K RoPE', 'fu'], ['=>'], ['RmsNormRope', 'out']],
      gains: [['访存 -42%', 'mem'], ['吞吐 +1.3x', 'tp'], ['kernel 3->1', '']],
      reason: 'Qwen3 在 QKV 投影后、RoPE 前对 Q/K 按 <b>head_dim=128</b> 做 per-head RMSNorm。单独执行时 q_norm/k_norm 是访存受限的小向量算子，归一化后的 Q/K 要落 HBM 再被 RoPE 读回。融合后归一化结果驻留 UB，直接喂给旋转编码。',
      affects: ['q_norm', 'k_norm', 'q_rope', 'k_rope'],
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
      affects: ['q_proj', 'k_proj', 'v_proj'],
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
      affects: ['qk_matmul', 'attn_scale', 'attn_softmax', 'attn_values'],
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

  const AIV_VIZ = {
    qknorm_rope: {
      name: 'QK-Norm + RoPE',
      flow: 'Q,K → per-head RMSNorm(q_norm/k_norm) → RoPE → Qr,Kr',
      before: {
        metrics: ['kernel 3', 'HBM 往返 2 次'],
        notes: ['q_norm / k_norm 输出写回 HBM', 'RoPE 再次读入做旋转编码'],
        markers: [
          { node: 'hbm:HBM', label: 'Q/K 输入', tone: 'input', title: 'Q/K 从 HBM 进入片上' },
          { node: 'buffer:UB', label: 'Q,K tile', tone: 'input', title: 'Q/K staging 到 UB' },
          { node: 'vector:Vector', label: 'RMSNorm', tone: 'compute', title: 'per-head RMSNorm 归约/缩放' },
          { node: 'hbm:HBM', label: 'Qn/Kn 中间结果', tone: 'output', title: '融合前：Qn/Kn 落 HBM' },
          { node: 'vector:Vector', label: 'RoPE', tone: 'compute', title: '旋转位置编码' },
          { node: 'buffer:UB', label: 'Qr/Kr 输出', tone: 'output', title: 'RoPE 输出驻留 UB' },
        ],
        steps: [
          { title: '1) Q/K 从 HBM 经 ND-DMA 进入 UB（tile staging）', nodes: ['hbm:HBM', 'cache:ND-DMA Cache', 'buffer:UB'], routes: [['hbm:HBM', 'cache:ND-DMA Cache'], ['cache:ND-DMA Cache', 'buffer:UB']] },
          { title: '2) Vector 执行 per-head RMSNorm：归约 sum(x^2) → rsqrt → scale', nodes: ['buffer:UB', 'exec:SIMD', 'vector:Vector'], routes: [['buffer:UB', 'vector:Vector'], ['exec:SIMD', 'vector:Vector'], ['vector:Vector', 'buffer:UB']] },
          { title: '3) 归一化后的 Qn/Kn 写回 HBM（中间张量落地）', nodes: ['buffer:UB', 'cache:ND-DMA Cache', 'hbm:HBM'], routes: [['cache:ND-DMA Cache', 'hbm:HBM']] },
          { title: '4) RoPE 再次从 HBM 读回 Qn/Kn，并读取 cos/sin', nodes: ['hbm:HBM', 'cache:ND-DMA Cache', 'buffer:UB'], routes: [['hbm:HBM', 'cache:ND-DMA Cache'], ['cache:ND-DMA Cache', 'buffer:UB']] },
          { title: '5) Vector 计算 RoPE，输出 Qr/Kr 回到 UB（供后续 Attention）', nodes: ['buffer:UB', 'exec:SIMD', 'vector:Vector'], routes: [['buffer:UB', 'vector:Vector'], ['exec:SIMD', 'vector:Vector'], ['vector:Vector', 'buffer:UB']] },
        ],
        blocks: [
          { buffer: 'UB', label: 'Q (HBM->UB)', state: 'loaded', tone: 'input', cellRange: [0, 15], sourceTile: 'Q[t,:]' },
          { buffer: 'UB', label: 'K (HBM->UB)', state: 'loaded', tone: 'input', cellRange: [16, 31], sourceTile: 'K[t,:]' },
          { buffer: 'UB', label: 'RMS stats', state: 'accumulating', tone: 'accumulator', cellRange: [32, 37], sourceTile: 'sum(x^2),rsqrt' },
          { buffer: 'UB', label: 'Q_norm (store)', state: 'committed', tone: 'output', cellRange: [38, 53], sourceTile: 'Qn[t,:]' },
          { buffer: 'UB', label: 'K_norm (store)', state: 'committed', tone: 'output', cellRange: [54, 69], sourceTile: 'Kn[t,:]' },
          { buffer: 'UB', label: 'Q_norm (reload)', state: 'loaded', tone: 'input', cellRange: [70, 85], sourceTile: 'Qn[t,:]' },
          { buffer: 'UB', label: 'K_norm (reload)', state: 'loaded', tone: 'input', cellRange: [86, 101], sourceTile: 'Kn[t,:]' },
          { buffer: 'UB', label: 'cos/sin', state: 'loaded', tone: 'input', cellRange: [102, 115], sourceTile: 'RoPE cache' },
        ],
      },
      after: {
        metrics: ['kernel 1', 'HBM 往返 0 次'],
        notes: ['归一化结果驻留 UB', '直接喂给 RoPE 输出 Q/K_rope'],
        markers: [
          { node: 'hbm:HBM', label: 'Q/K 输入', tone: 'input', title: 'Q/K 从 HBM 进入片上' },
          { node: 'buffer:UB', label: 'Q,K tile', tone: 'input', title: 'Q/K staging 到 UB' },
          { node: 'vector:Vector', label: 'RMSNorm+RoPE', tone: 'compute', title: '融合后：同一段执行内完成归一化 + RoPE' },
          { node: 'hbm:HBM', label: 'Qn/Kn 不落地', tone: 'note', title: '融合后：中间张量不写回 HBM' },
          { node: 'buffer:UB', label: 'Qr/Kr 输出', tone: 'output', title: 'RoPE 输出驻留 UB' },
        ],
        steps: [
          { title: '1) Q/K 从 HBM 经 ND-DMA 进入 UB（tile staging）', nodes: ['hbm:HBM', 'cache:ND-DMA Cache', 'buffer:UB'], routes: [['hbm:HBM', 'cache:ND-DMA Cache'], ['cache:ND-DMA Cache', 'buffer:UB']] },
          { title: '2) Vector 执行 RMSNorm 归约与缩放，结果不落 HBM（保持 UB 驻留）', nodes: ['buffer:UB', 'exec:SIMD', 'vector:Vector'], routes: [['buffer:UB', 'vector:Vector'], ['exec:SIMD', 'vector:Vector'], ['vector:Vector', 'buffer:UB']] },
          { title: '3) 在同一融合 kernel 内读取 cos/sin 并完成 RoPE，输出 Qr/Kr 回到 UB', nodes: ['buffer:UB', 'exec:SIMD', 'vector:Vector'], routes: [['buffer:UB', 'vector:Vector'], ['exec:SIMD', 'vector:Vector'], ['vector:Vector', 'buffer:UB']] },
        ],
        blocks: [
          { buffer: 'UB', label: 'Q (HBM->UB)', state: 'loaded', tone: 'input', cellRange: [0, 15], sourceTile: 'Q[t,:]' },
          { buffer: 'UB', label: 'K (HBM->UB)', state: 'loaded', tone: 'input', cellRange: [16, 31], sourceTile: 'K[t,:]' },
          { buffer: 'UB', label: 'RMS stats', state: 'accumulating', tone: 'accumulator', cellRange: [32, 37], sourceTile: 'sum(x^2),rsqrt' },
          { buffer: 'UB', label: 'Q_norm (no store)', state: 'avoided', tone: 'input', cellRange: [38, 53], sourceTile: 'Qn[t,:]' },
          { buffer: 'UB', label: 'K_norm (no store)', state: 'avoided', tone: 'input', cellRange: [54, 69], sourceTile: 'Kn[t,:]' },
          { buffer: 'UB', label: 'Q_rope', state: 'committed', tone: 'output', cellRange: [70, 85], sourceTile: 'Qr[t,:]' },
          { buffer: 'UB', label: 'K_rope', state: 'committed', tone: 'output', cellRange: [86, 101], sourceTile: 'Kr[t,:]' },
          { buffer: 'UB', label: 'cos/sin', state: 'loaded', tone: 'input', cellRange: [102, 115], sourceTile: 'RoPE cache' },
        ],
      },
    },
    add_rmsnorm: {
      name: 'Add + RMSNorm',
      flow: 'residual + hidden → RMSNorm → y',
      before: {
        metrics: ['kernel 2', 'HBM 往返 1 次'],
        notes: ['Add 写回后再读入做 RMSNorm', '归约与归一化跨 kernel 分离'],
        blocks: [
          { buffer: 'UB', label: 'hidden (load)', state: 'loaded', tone: 'input', cellRange: [0, 17], sourceTile: 'x[t,:]' },
          { buffer: 'UB', label: 'residual (load)', state: 'loaded', tone: 'input', cellRange: [18, 35], sourceTile: 'r[t,:]' },
          { buffer: 'UB', label: 'add_out (store)', state: 'committed', tone: 'output', cellRange: [46, 63], sourceTile: 'x+r' },
          { buffer: 'UB', label: 'add_out (reload)', state: 'loaded', tone: 'input', cellRange: [64, 81], sourceTile: 'x+r' },
          { buffer: 'UB', label: 'norm_out', state: 'committed', tone: 'output', cellRange: [90, 107], sourceTile: 'y' },
        ],
      },
      after: {
        metrics: ['kernel 1', 'HBM 往返 0 次'],
        notes: ['Add 结果片上直接归一化', '减少一次写回与读取'],
        blocks: [
          { buffer: 'UB', label: 'hidden (load)', state: 'loaded', tone: 'input', cellRange: [0, 17], sourceTile: 'x[t,:]' },
          { buffer: 'UB', label: 'residual (load)', state: 'loaded', tone: 'input', cellRange: [18, 35], sourceTile: 'r[t,:]' },
          { buffer: 'UB', label: 'add_out (no store)', state: 'avoided', tone: 'input', cellRange: [46, 63], sourceTile: 'x+r' },
          { buffer: 'UB', label: 'norm_out', state: 'committed', tone: 'output', cellRange: [90, 107], sourceTile: 'y' },
        ],
      },
    },
    swiglu: {
      name: 'SwiGLU (SiluAndMul)',
      flow: 'gate/up → SiLU(gate) → ⊙ up → out',
      before: {
        metrics: ['kernel 2', 'HBM 往返 1 次'],
        notes: ['SiLU 输出落地后再做乘法', '中间张量造成额外带宽压力'],
        blocks: [
          { buffer: 'UB', label: 'gate/up (load)', state: 'loaded', tone: 'input', cellRange: [0, 29], sourceTile: 'gate,up' },
          { buffer: 'UB', label: 'silu(gate) (store)', state: 'committed', tone: 'output', cellRange: [38, 61], sourceTile: 'silu(gate)' },
          { buffer: 'UB', label: 'silu(gate) (reload)', state: 'loaded', tone: 'input', cellRange: [62, 85], sourceTile: 'silu(gate)' },
          { buffer: 'UB', label: 'mul_out', state: 'committed', tone: 'output', cellRange: [92, 115], sourceTile: 'silu(gate)*up' },
        ],
      },
      after: {
        metrics: ['kernel 1', 'HBM 往返 0 次'],
        notes: ['SiLU 后立即逐元素相乘', '中间结果不写回'],
        blocks: [
          { buffer: 'UB', label: 'gate/up (load)', state: 'loaded', tone: 'input', cellRange: [0, 29], sourceTile: 'gate,up' },
          { buffer: 'UB', label: 'silu(gate) (no store)', state: 'avoided', tone: 'input', cellRange: [38, 61], sourceTile: 'silu(gate)' },
          { buffer: 'UB', label: 'mul_out', state: 'committed', tone: 'output', cellRange: [92, 115], sourceTile: 'silu(gate)*up' },
        ],
      },
    },
    qkv_merge: {
      name: 'QKV 合并投影',
      flow: 'hidden → GEMM(QKV) → split → Q,K,V',
      before: {
        metrics: ['kernel 3', 'HBM 读输入 3 次'],
        notes: ['Q/K/V 各自 GEMM 反复读取同一 hidden', '启动与权重访存开销叠加'],
        blocks: [
          { buffer: 'UB', label: 'hidden (Q load)', state: 'loaded', tone: 'input', cellRange: [0, 17], sourceTile: 'x' },
          { buffer: 'UB', label: 'hidden (K load)', state: 'loaded', tone: 'input', cellRange: [18, 35], sourceTile: 'x' },
          { buffer: 'UB', label: 'hidden (V load)', state: 'loaded', tone: 'input', cellRange: [36, 53], sourceTile: 'x' },
          { buffer: 'UB', label: 'Q', state: 'committed', tone: 'output', cellRange: [64, 75], sourceTile: 'Q' },
          { buffer: 'UB', label: 'K', state: 'committed', tone: 'output', cellRange: [76, 87], sourceTile: 'K' },
          { buffer: 'UB', label: 'V', state: 'committed', tone: 'output', cellRange: [88, 99], sourceTile: 'V' },
        ],
      },
      after: {
        metrics: ['kernel 1', 'HBM 读输入 1 次'],
        notes: ['一次大 GEMM 产出 QKV', '更好填满 Cube + 更少启动开销'],
        blocks: [
          { buffer: 'UB', label: 'hidden (load)', state: 'loaded', tone: 'input', cellRange: [0, 17], sourceTile: 'x' },
          { buffer: 'UB', label: 'hidden (avoid 2x)', state: 'avoided', tone: 'input', cellRange: [18, 35], sourceTile: 'x' },
          { buffer: 'UB', label: 'Q', state: 'committed', tone: 'output', cellRange: [64, 75], sourceTile: 'Q' },
          { buffer: 'UB', label: 'K', state: 'committed', tone: 'output', cellRange: [76, 87], sourceTile: 'K' },
          { buffer: 'UB', label: 'V', state: 'committed', tone: 'output', cellRange: [88, 99], sourceTile: 'V' },
        ],
      },
    },
    flash_paged: {
      name: 'FlashAttention + PagedKV',
      flow: 'QK^T → online-softmax → ⊙V (PagedKV) → out',
      before: {
        metrics: ['S 矩阵落地', 'HBM 写大张量'],
        notes: ['显式 materialize QK^T / softmax 分离', 'score 矩阵带来显存与带宽压力'],
        blocks: [
          { buffer: 'UB', label: 'Q/K tile', state: 'loaded', tone: 'input', cellRange: [0, 23], sourceTile: 'Q,K' },
          { buffer: 'UB', label: 'Scores S (store)', state: 'committed', tone: 'output', cellRange: [38, 77], sourceTile: 'S=QK^T' },
          { buffer: 'UB', label: 'Scores S (reload)', state: 'loaded', tone: 'input', cellRange: [78, 117], sourceTile: 'S' },
          { buffer: 'UB', label: 'Attn out', state: 'committed', tone: 'output', cellRange: [118, 139], sourceTile: 'P·V' },
        ],
      },
      after: {
        metrics: ['online softmax', 'S 不落地'],
        notes: ['分块计算 + online-softmax', 'PagedKV 按 block_table 寻址 KV'],
        blocks: [
          { buffer: 'UB', label: 'Q/K tile', state: 'loaded', tone: 'input', cellRange: [0, 23], sourceTile: 'Q,K' },
          { buffer: 'UB', label: 'Scores S (avoided)', state: 'avoided', tone: 'input', cellRange: [38, 77], sourceTile: 'S' },
          { buffer: 'UB', label: 'Softmax stats', state: 'accumulating', tone: 'accumulator', cellRange: [78, 93], sourceTile: 'm,l' },
          { buffer: 'UB', label: 'Attn out', state: 'committed', tone: 'output', cellRange: [118, 139], sourceTile: 'P·V' },
        ],
      },
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
    pangu_flash: {
      name: 'openPangu-2.0-Flash',
      tags: [['MoE', 'moe'], ['Sparse MLA', 'new'], ['MTP', 'new']],
      meta: 'hidden 2560 · L46 · 256 experts top-8\nSparse MLA · DSA16/SWA30 · MTP x3',
      recs: ['add_rmsnorm', 'flash_paged', 'grouped_matmul', 'swiglu'],
      spec: {
        name: 'openPangu-2.0-Flash',
        layers: 46,
        qh: 48,
        kvh: 48,
        topk: 8,
        experts: 256,
        variant: 'pangu_moe',
        qknorm: false,
        attnBias: false,
        hidden: 2560,
        qRank: 1024,
        kvRank: 512,
        dsaLayers: 16,
        swaLayers: 30,
        denseLayers: 2,
        mtp: 3,
      },
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
  const GRAPH_LAYOUT = {
    // Toggle center is 17px from the cluster top and r=10, so its bottom is 27px.
    // A 44px child top gap leaves the control, title text, and a 12px visual buffer clear.
    clusterChildTopGap: 44,
    clusterChildSideGap: 36,
    clusterChildBottomGap: 30,
    collapsedModuleGap: 28,
    decoderEntryGap: 224,
    appliedFusionGap: 30,
  };
  const els = {};
  let G = null;
  let NM = {};
  let view = { tx: 0, ty: 0, z: 1 };
  let pan = null;
  let selectedNode = null;
  let showBrackets = true;
  let currentModel = null;
  let activeFusionPreviews = new Set();
  let graphViewMode = 'drill';
  let flatDepth = 3;
  let flatMenuOpen = false;
  let expandedModules = new Set([
    'model',
    'transformer',
    'decoder',
    'attention',
    'qkv_projection',
    'q_lane',
    'k_lane',
    'v_lane',
    'attention_core',
    'mlp',
    'pangu_mhc',
    'pangu_q_lane',
    'pangu_kv_lane',
    'pangu_sparse_core',
    'ffn',
    'dense_ffn',
    'moe',
    'mtp_stack',
  ]);

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
    const isPangu = spec.variant === 'pangu_moe';
    const cx = 560;
    const Wp = 168;
    const Wo = 252;
    const Wt = 190;
    const Lx = 130;
    const Rx = 1000;
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
    y += GRAPH_LAYOUT.decoderEntryGap;
    flow('token_ids', 'embedding');
    pL('emb_w', 'Embedding W', '[vocab, h]', 'embedding');

    const qx = 300;
    const kx = 560;
    const vx = 820;
    const laneW = 172;
    const narrowW = 164;
    let ffnEntry = 'ffn_norm';

    if (isPangu) {
      op('mhc_attention', 'mHC Pre Mix', 'Module', 'attention', { w: 260, typeLabel: 'S_mhc=4' });
      y += 90;
      flow('embedding', 'mhc_attention');

      op('input_layernorm', 'Input RMSNorm', 'Op', 'norm', { fuseRec: 'add_rmsnorm', typeLabel: 'pre-attn' });
      y += 96;
      flow('mhc_attention', 'input_layernorm');
      pR('input_ln_g', 'input γ', '[h]', 'input_layernorm');

      op('sparse_mla_attention', 'Sparse MLA Attention', 'Module', 'attention', { w: 280, typeLabel: `DSA${spec.dsaLayers}/SWA${spec.swaLayers}` });
      y += 96;
      flow('input_layernorm', 'sparse_mla_attention');

      op('q_a_proj', 'Q Latent Linear', 'Op', 'linear', { x: qx, w: laneW, typeLabel: `H->${spec.qRank}` });
      op('kv_a_proj', 'KV Latent Linear', 'Op', 'linear', { x: kx, w: laneW, typeLabel: `H->${spec.kvRank}+RoPE` });
      flow('sparse_mla_attention', 'q_a_proj', 'Q');
      flow('sparse_mla_attention', 'kv_a_proj', 'KV');
      pL('qa_w', 'Q A W', '[h, r_q]', 'q_a_proj');
      pR('kva_w', 'KV A W', '[h, r_kv]', 'kv_a_proj');
      y += 84;

      op('q_causal_conv', 'Q Causal Conv1D', 'Op', 'comm', { x: qx, w: laneW, typeLabel: 'W=3' });
      op('kv_causal_conv', 'KV Causal Conv1D', 'Op', 'comm', { x: kx, w: laneW, typeLabel: 'W=3' });
      flow('q_a_proj', 'q_causal_conv', 'q_lora');
      flow('kv_a_proj', 'kv_causal_conv', 'kv_lora');
      y += 84;

      op('q_residual_add', 'Q Local Add', 'Op', 'norm', { x: qx, w: laneW, typeLabel: 'residual' });
      op('kv_residual_add', 'KV Local Add', 'Op', 'norm', { x: kx, w: laneW, typeLabel: 'residual' });
      flow('q_a_proj', 'q_residual_add', 'skip');
      flow('q_causal_conv', 'q_residual_add', 'local');
      flow('kv_a_proj', 'kv_residual_add', 'skip');
      flow('kv_causal_conv', 'kv_residual_add', 'local');
      y += 84;

      op('q_a_norm', 'Q Latent Norm', 'Op', 'norm', { x: qx, w: laneW, typeLabel: 'LayerNorm' });
      op('kv_a_norm', 'KV Latent Norm', 'Op', 'norm', { x: kx, w: laneW, typeLabel: 'LayerNorm' });
      flow('q_residual_add', 'q_a_norm', 'Q');
      flow('kv_residual_add', 'kv_a_norm', 'KV');
      pL('qa_g', 'q_a γ', '[r_q]', 'q_a_norm');
      pR('kva_g', 'kv_a γ', '[r_kv]', 'kv_a_norm');
      y += 84;

      op('q_b_proj', 'Q Up Linear', 'Op', 'linear', { x: qx, w: laneW, typeLabel: 'R_q->Q' });
      op('kv_b_proj', 'KV Up Linear', 'Op', 'linear', { x: kx, w: laneW, typeLabel: 'R_kv->KV' });
      flow('q_a_norm', 'q_b_proj', 'Q');
      flow('kv_a_norm', 'kv_b_proj', 'KV');
      pL('qb_w', 'Q B W', '[r_q, q]', 'q_b_proj');
      pR('kvb_w', 'KV B W', '[r_kv, kv]', 'kv_b_proj');
      y += 92;

      op('rope_apply', 'RoPE Apply', 'Op', 'rope', { x: cx, w: laneW, typeLabel: 'q_rope' });
      flow('q_b_proj', 'rope_apply', 'Q');
      N.push({ id: 'rope_cache', label: 'RoPE Cache', typeLabel: 'State', kind: 'param', x: Lx, y, w: Wp, h: 42 });
      E.push({ s: 'rope_cache', t: 'rope_apply', tag: 'cos/sin', type: 'param' });
      y += 86;

      op('dsa_indexer', 'DSA Indexer', 'Op', 'attention', { x: cx, w: laneW, fuseRec: 'flash_paged', typeLabel: 'global K' });
      flow('rope_apply', 'dsa_indexer', 'idx');
      y += 86;

      op('attention_core', 'Sparse FlashAttention', 'Op', 'attention', { x: cx, w: laneW + 18, fuseRec: 'flash_paged', typeLabel: 'DSA/SWA' });
      flow('rope_apply', 'attention_core', 'Q');
      flow('kv_b_proj', 'attention_core', 'KV');
      flow('dsa_indexer', 'attention_core', 'sparse');
      N.push({ id: 'kv_cache', label: 'KV Cache', typeLabel: 'State', kind: 'param', x: Rx, y: y - 22, w: Wp, h: 42 });
      N.push({ id: 'param_sink_state', label: 'Parameter Sink', typeLabel: 'State', kind: 'param', x: Rx, y: y + 26, w: Wp, h: 42 });
      N.push({ id: 'mome_state', label: 'MoME State', typeLabel: 'State', kind: 'param', x: Rx, y: y + 74, w: Wp, h: 42 });
      E.push({ s: 'kv_cache', t: 'attention_core', tag: 'KV', type: 'param' });
      E.push({ s: 'param_sink_state', t: 'attention_core', tag: 'sink', type: 'param' });
      E.push({ s: 'mome_state', t: 'attention_core', tag: 'MoME', type: 'param' });
      y += 98;

      op('o_causal_conv', 'O Causal Conv1D', 'Op', 'comm', { x: cx, w: laneW, typeLabel: 'W=3' });
      flow('attention_core', 'o_causal_conv', 'attn');
      y += 84;

      op('o_residual_add', 'O Local Add', 'Op', 'norm', { x: cx, w: laneW, typeLabel: 'residual' });
      flow('attention_core', 'o_residual_add', 'skip');
      flow('o_causal_conv', 'o_residual_add', 'local');
      y += 84;

      op('o_proj', 'O Projection', 'Op', 'linear', { x: cx, w: laneW, typeLabel: 'h->h' });
      flow('o_residual_add', 'o_proj', 'ATTN');
      pL('oproj_w', 'O-Proj W', '[v, h]', 'o_proj');
      y += 96;

      op('post_attention_norm', 'Post Attention RMSNorm', 'Op', 'norm', { fuseRec: 'add_rmsnorm', typeLabel: 'post-attn' });
      y += 96;
      flow('o_proj', 'post_attention_norm');
      pR('post_attn_g', 'post γ', '[h]', 'post_attention_norm');

      op('mhc_attention_post', 'mHC Merge', 'Module', 'attention', { w: 250, typeLabel: 'sandwich' });
      y += 92;
      flow('post_attention_norm', 'mhc_attention_post');

      op('pre_mlp_norm', 'Pre MLP RMSNorm', 'Op', 'norm', { fuseRec: 'add_rmsnorm', typeLabel: 'pre-ffn' });
      y += 96;
      flow('mhc_attention_post', 'pre_mlp_norm');
      pR('pre_mlp_g', 'pre-mlp γ', '[h]', 'pre_mlp_norm');
      ffnEntry = 'pre_mlp_norm';
    } else {
      op('attn_norm', 'attn RMSNorm', 'Op', 'norm', { fuseRec: 'add_rmsnorm', typeLabel: 'AddRmsNorm?' });
      y += 96;
      flow('embedding', 'attn_norm');
      pR('attn_g', 'attn γ', '[h]', 'attn_norm');

      op('q_proj', 'Q Projection', 'Logical Linear', 'linear', { x: qx, w: laneW, fuseRec: 'qkv_merge', typeLabel: spec.attnBias ? '+bias' : 'candidate' });
      op('k_proj', 'K Projection', 'Logical Linear', 'linear', { x: kx, w: laneW, fuseRec: 'qkv_merge', typeLabel: spec.attnBias ? '+bias' : 'candidate' });
      op('v_proj', 'V Projection', 'Logical Linear', 'linear', { x: vx, w: laneW, fuseRec: 'qkv_merge', typeLabel: spec.attnBias ? '+bias' : 'candidate' });
      N.push({ id: 'qkv_w', label: 'QKV W', typeLabel: spec.attnBias ? 'logical +bias' : 'logical shard', kind: 'param', x: Lx, y, w: Wp, h: 42 });
      flow('attn_norm', 'q_proj', 'Q');
      flow('attn_norm', 'k_proj', 'K');
      flow('attn_norm', 'v_proj', 'V');
      E.push({ s: 'qkv_w', t: 'q_proj', tag: 'Wq', type: 'param' });
      E.push({ s: 'qkv_w', t: 'k_proj', tag: 'Wk', type: 'param' });
      E.push({ s: 'qkv_w', t: 'v_proj', tag: 'Wv', type: 'param' });
      y += 144;

      if (spec.qknorm) {
        op('q_norm', 'Q-Norm', 'Op', 'qknorm', { x: qx, w: narrowW, fuseRec: 'qknorm_rope', typeLabel: 'per-head RMS' });
        op('k_norm', 'K-Norm', 'Op', 'qknorm', { x: kx, w: narrowW, fuseRec: 'qknorm_rope', typeLabel: 'per-head RMS' });
        flow('q_proj', 'q_norm', 'Q');
        flow('k_proj', 'k_norm', 'K');
        N.push({ id: 'qn_g', label: 'q_norm γ', typeLabel: 'gamma', kind: 'param', x: qx, y: y - 42, w: 122, h: 36 });
        N.push({ id: 'kn_g', label: 'k_norm γ', typeLabel: 'gamma', kind: 'param', x: kx, y: y - 42, w: 122, h: 36 });
        E.push({ s: 'qn_g', t: 'q_norm', tag: 'γ', type: 'param' });
        E.push({ s: 'kn_g', t: 'k_norm', tag: 'γ', type: 'param' });
        y += 92;
        op('q_rope', 'Q RoPE', 'Op', 'rope', { x: qx, w: narrowW, fuseRec: 'qknorm_rope', typeLabel: 'rotary' });
        op('k_rope', 'K RoPE', 'Op', 'rope', { x: kx, w: narrowW, fuseRec: 'qknorm_rope', typeLabel: 'rotary' });
        flow('q_norm', 'q_rope', 'Q');
        flow('k_norm', 'k_rope', 'K');
      } else {
        op('q_rope', 'Q RoPE', 'Op', 'rope', { x: qx, w: narrowW, typeLabel: 'rotary' });
        op('k_rope', 'K RoPE', 'Op', 'rope', { x: kx, w: narrowW, typeLabel: 'rotary' });
        flow('q_proj', 'q_rope', 'Q');
        flow('k_proj', 'k_rope', 'K');
      }
      op('kv_cache_update', 'KV Cache Update', 'State Update', 'comm', { x: vx, w: laneW, typeLabel: 'paged KV' });
      flow('v_proj', 'kv_cache_update', 'V', 'comm');
      flow('k_rope', 'kv_cache_update', 'K', 'comm');
      N.push({ id: 'rope_cache', label: 'RoPE Cache', typeLabel: 'State', kind: 'param', x: Rx, y, w: Wp, h: 42 });
      E.push({ s: 'rope_cache', t: 'q_rope', tag: 'cos/sin', type: 'param' });
      E.push({ s: 'rope_cache', t: 'k_rope', tag: 'cos/sin', type: 'param' });
      y += 104;

      op('qk_matmul', 'QK^T MatMul', 'Op', 'attention', { fuseRec: 'flash_paged', typeLabel: 'scores' });
      flow('q_rope', 'qk_matmul', 'Q');
      flow('k_rope', 'qk_matmul', 'K');
      y += 88;
      op('attn_scale', 'Scale / Mask', 'Op', 'attention', { fuseRec: 'flash_paged', typeLabel: 'causal' });
      flow('qk_matmul', 'attn_scale', 'SCORE');
      y += 88;
      op('attn_softmax', 'Softmax', 'Op', 'attention', { fuseRec: 'flash_paged', typeLabel: 'online' });
      flow('attn_scale', 'attn_softmax', 'PROB');
      y += 88;
      op('attn_values', 'AV MatMul', 'Op', 'attention', { fuseRec: 'flash_paged', typeLabel: 'x V' });
      flow('attn_softmax', 'attn_values', 'P');
      flow('kv_cache_update', 'attn_values', 'V/KV', 'comm');
      N.push({ id: 'kv_cache', label: 'KV Cache', typeLabel: 'State', kind: 'param', x: Rx, y, w: Wp, h: 42 });
      E.push({ s: 'kv_cache', t: 'attn_values', tag: 'KV', type: 'param' });
      y += 96;
      op('attn_output_linear', 'O Projection', 'Op', 'linear', { typeLabel: 'h->h' });
      flow('attn_values', 'attn_output_linear', 'ATTN');
      pL('o_w', 'O-Proj W', '[hd, h]', 'attn_output_linear');
      y += 96;

      op('ffn_norm', 'ffn RMSNorm', 'Op', 'norm', { fuseRec: 'add_rmsnorm', typeLabel: 'AddRmsNorm?' });
      y += 96;
      flow('attn_output_linear', 'ffn_norm');
      pR('ffn_g', 'ffn γ', '[h]', 'ffn_norm');
    }

    let lastBlock = '';
    let moeClusterOps = [];
    if (isPangu) {
      op('ffn_choice', 'FFN Choice', 'Module', 'gate', { w: 280, typeLabel: `dense ${spec.denseLayers} · MoE ${spec.layers - spec.denseLayers}` });
      y += 86;
      flow(ffnEntry, 'ffn_choice');

      const denseX = qx;
      const routedX = kx;
      const sharedX = vx;
      const row1 = y;
      const row2 = y + 84;
      const row3 = y + 168;
      const row4 = y + 260;
      const row5 = y + 352;
      const row6 = y + 444;

      op('dense_gate_up', 'Dense Gate/Up', 'Op', 'linear', { x: denseX, y: row1, w: laneW, typeLabel: 'L0-1' });
      op('dense_silu', 'Dense SwiGLU', 'Op', 'act', { x: denseX, y: row2, w: laneW, fuseRec: 'swiglu', typeLabel: 'SiluAndMul' });
      op('dense_down', 'Dense Down', 'Op', 'linear', { x: denseX, y: row3, w: laneW, typeLabel: 'dense out' });
      pL('dense_w', 'Dense MLP W', '[h, ffn]', 'dense_gate_up');
      flow('ffn_choice', 'dense_gate_up', 'L0-1');
      flow('dense_gate_up', 'dense_silu');
      flow('dense_silu', 'dense_down');

      op('router_gate', 'Router Gate', 'Op', 'gate', { x: routedX, y: row1, w: laneW, fuseRec: 'grouped_matmul', typeLabel: `E=${spec.experts}` });
      op('route_topk', 'TopK Router', 'Op', 'gate', { x: routedX, y: row2, w: laneW, fuseRec: 'grouped_matmul', typeLabel: `top-${spec.topk}` });
      op('routed_expert_bank', 'Routed Experts', 'Op', 'moe', { x: routedX, y: row3, w: laneW, fuseRec: 'grouped_matmul', typeLabel: 'FusedMoE' });
      N.push({ id: 'expert_parallel_state', label: 'Expert Parallel', typeLabel: 'State', kind: 'param', x: Rx, y: row3, w: Wp, h: 42 });
      pR('router_w', 'Router W', '[h, E]', 'router_gate', 'W');
      flow('ffn_choice', 'router_gate', 'L2-45');
      flow('router_gate', 'route_topk', 'logits');
      flow('route_topk', 'routed_expert_bank', 'ids/weights');
      E.push({ s: 'expert_parallel_state', t: 'routed_expert_bank', tag: 'map', type: 'param' });

      op('shared_expert_mlp', 'Shared Expert MLP', 'Op', 'act', { x: sharedX, y: row1, w: laneW, fuseRec: 'swiglu', typeLabel: 'E_shared=1' });
      flow('ffn_choice', 'shared_expert_mlp', 'shared');

      op('moe_combine', 'MoE Combine', 'Op', 'moe', { x: routedX, y: row4, w: laneW + 22, typeLabel: 'routed + shared' });
      flow('routed_expert_bank', 'moe_combine', 'routed');
      flow('shared_expert_mlp', 'moe_combine', 'shared');

      op('post_mlp_norm', 'Post MLP RMSNorm', 'Op', 'norm', { x: cx, y: row5, fuseRec: 'add_rmsnorm', typeLabel: 'post-ffn' });
      flow('dense_down', 'post_mlp_norm', 'dense');
      flow('moe_combine', 'post_mlp_norm', 'moe');
      pR('post_mlp_g', 'post-mlp γ', '[h]', 'post_mlp_norm');

      op('block_post_norm', 'Block Post RMSNorm', 'Op', 'norm', { x: cx, y: row6, typeLabel: 'selected layers' });
      flow('post_mlp_norm', 'block_post_norm');
      pR('block_post_g', 'block γ', '[h]', 'block_post_norm');
      y = row6 + 96;
      lastBlock = 'block_post_norm';
      moeClusterOps = ['router_gate', 'route_topk', 'routed_expert_bank', 'shared_expert_mlp', 'moe_combine'];
    } else if (spec.variant === 'moe') {
      op('router', 'Router (Gate)', 'Op', 'gate', { fuseRec: 'grouped_matmul', typeLabel: `top-${spec.topk}` });
      y += 92;
      flow(ffnEntry, 'router');
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
      flow(ffnEntry, 'gate_up');
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

    if (isPangu) {
      const mtpY1 = y + 40;
      const mtpY2 = mtpY1 + 88;
      op('mtp_input_norms', 'MTP Input Norms', 'Op', 'norm', { x: qx, y: mtpY1, w: laneW, typeLabel: 'enorm + hnorm' });
      op('mtp_eh_proj', 'MTP EH Projection', 'Op', 'linear', { x: kx, y: mtpY1, w: laneW, typeLabel: '2H->H' });
      op('mtp_decoder_layer', 'MTP Decoder Layer', 'Module', 'attention', { x: vx, y: mtpY1, w: laneW, typeLabel: `x${spec.mtp}` });
      flow('final_norm', 'mtp_input_norms', 'hidden');
      flow('embedding', 'mtp_input_norms', 'embed');
      flow('mtp_input_norms', 'mtp_eh_proj', 'concat');
      flow('mtp_eh_proj', 'mtp_decoder_layer', 'draft');

      op('mtp_shared_head', 'MTP Shared Head', 'Op', 'linear', { x: kx, y: mtpY2, w: laneW, typeLabel: 'shared vocab' });
      io('mtp_logits', 'MTP Logits', 'Output', { x: vx, y: mtpY2, w: laneW });
      flow('mtp_decoder_layer', 'mtp_shared_head');
      flow('mtp_shared_head', 'mtp_logits', 'draft');
      y = mtpY2 + 78;
    }

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
    const includeClusterWithClearance = (parent, child) => {
      const left = child.x - GRAPH_LAYOUT.clusterChildSideGap;
      const top = child.y - GRAPH_LAYOUT.clusterChildTopGap;
      const right = child.x + child.w + GRAPH_LAYOUT.clusterChildSideGap;
      const bottom = child.y + child.h + GRAPH_LAYOUT.clusterChildBottomGap;
      const parentRight = parent.x + parent.w;
      const parentBottom = parent.y + parent.h;
      if (left < parent.x) {
        parent.w += parent.x - left;
        parent.x = left;
      }
      if (top < parent.y) {
        parent.h += parent.y - top;
        parent.y = top;
      }
      parent.w = Math.max(parent.w, right - parent.x, parentRight - parent.x);
      parent.h = Math.max(parent.h, bottom - parent.y, parentBottom - parent.y);
    };
    const normalizeClusterHierarchy = (clusters, hierarchy) => {
      const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
      const moduleById = new Map(hierarchy.map((module) => [module.id, module]));
      const depthCache = new Map();
      const depthFor = (module) => {
        if (!module) return 0;
        if (depthCache.has(module.id)) return depthCache.get(module.id);
        const depth = module.parentModule ? depthFor(moduleById.get(module.parentModule)) + 1 : 0;
        depthCache.set(module.id, depth);
        return depth;
      };
      hierarchy
        .slice()
        .sort((a, b) => depthFor(b) - depthFor(a))
        .forEach((module) => {
          const cluster = clusterById.get(module.id);
          const parent = clusterById.get(module.parentModule);
          if (cluster && parent) includeClusterWithClearance(parent, cluster);
        });
    };
    const fitGraphExtents = (nodes, clusters, minWidth, minHeight) => {
      const lefts = nodes.map((node) => node.x - node.w / 2).concat(clusters.map((cluster) => cluster.x));
      const tops = nodes.map((node) => node.y - node.h / 2).concat(clusters.map((cluster) => cluster.y));
      const minLeft = Math.min(...lefts);
      const minTop = Math.min(...tops);
      const shiftX = minLeft < 18 ? 18 - minLeft : 0;
      const shiftY = minTop < 18 ? 18 - minTop : 0;
      if (shiftX || shiftY) {
        nodes.forEach((node) => {
          node.x += shiftX;
          node.y += shiftY;
        });
        clusters.forEach((cluster) => {
          cluster.x += shiftX;
          cluster.y += shiftY;
        });
      }
      const right = Math.max(
        ...nodes.map((node) => node.x + node.w / 2),
        ...clusters.map((cluster) => cluster.x + cluster.w),
      );
      const bottom = Math.max(
        ...nodes.map((node) => node.y + node.h / 2),
        ...clusters.map((cluster) => cluster.y + cluster.h),
      );
      return {
        width: Math.ceil(Math.max(minWidth, right + 28)),
        height: Math.ceil(Math.max(minHeight, bottom + 28)),
      };
    };

    const genericAttentionOps = existingIds([
      'attn_norm',
      'q_proj',
      'k_proj',
      'v_proj',
      'q_norm',
      'k_norm',
      'q_rope',
      'k_rope',
      'kv_cache_update',
      'qk_matmul',
      'attn_scale',
      'attn_softmax',
      'attn_values',
      'attn_output_linear',
    ]);
    const panguMhcOps = withParamTensors(['mhc_attention', 'input_layernorm', 'post_attention_norm', 'mhc_attention_post']);
    const panguQLaneOps = withParamTensors(['q_a_proj', 'q_causal_conv', 'q_residual_add', 'q_a_norm', 'q_b_proj']);
    const panguKvLaneOps = withParamTensors(['kv_a_proj', 'kv_causal_conv', 'kv_residual_add', 'kv_a_norm', 'kv_b_proj']);
    const panguSparseCoreOps = withParamTensors(['rope_apply', 'dsa_indexer', 'attention_core', 'o_causal_conv', 'o_residual_add', 'o_proj']);
    const panguAttentionOps = existingIds([
      'mhc_attention',
      'input_layernorm',
      'sparse_mla_attention',
      'q_a_proj',
      'q_causal_conv',
      'q_residual_add',
      'q_a_norm',
      'q_b_proj',
      'kv_a_proj',
      'kv_causal_conv',
      'kv_residual_add',
      'kv_a_norm',
      'kv_b_proj',
      'rope_apply',
      'dsa_indexer',
      'attention_core',
      'o_causal_conv',
      'o_residual_add',
      'o_proj',
      'post_attention_norm',
      'mhc_attention_post',
    ]);
    const attentionOps = isPangu ? panguAttentionOps : genericAttentionOps;
    const qkvProjectionOps = withParamTensors(['q_proj', 'k_proj', 'v_proj']);
    const qLaneOps = withParamTensors(['q_norm', 'q_rope']).filter((id) => id !== 'rope_cache');
    const kLaneOps = withParamTensors(['k_norm', 'k_rope']).filter((id) => id !== 'rope_cache');
    const vLaneOps = withParamTensors(['kv_cache_update']);
    const attentionCoreOps = withParamTensors(['qk_matmul', 'attn_scale', 'attn_softmax', 'attn_values', 'attn_output_linear']);
    const denseFfnOps = withParamTensors(['dense_gate_up', 'dense_silu', 'dense_down']);
    const panguMoeOps = withParamTensors(['router_gate', 'route_topk', 'routed_expert_bank', 'shared_expert_mlp', 'moe_combine']);
    const mtpOps = withParamTensors(['mtp_input_norms', 'mtp_eh_proj', 'mtp_decoder_layer', 'mtp_shared_head', 'mtp_logits']);
    const ffnOps = existingIds(isPangu
      ? ['pre_mlp_norm', 'ffn_choice', 'dense_gate_up', 'dense_silu', 'dense_down', 'router_gate', 'route_topk', 'routed_expert_bank', 'shared_expert_mlp', 'moe_combine', 'post_mlp_norm', 'block_post_norm']
      : spec.variant === 'moe'
        ? ['ffn_norm', 'router', 'dispatch', 'experts', 'mlp_act']
        : ['ffn_norm', 'gate_up', 'mlp_act', 'down_proj']);
    const decoderOps = existingIds([
      ...attentionOps,
      'pre_mlp_norm',
      'ffn_norm',
      'ffn_choice',
      'dense_gate_up',
      'dense_silu',
      'dense_down',
      'post_mlp_norm',
      'block_post_norm',
      'router_gate',
      'route_topk',
      'routed_expert_bank',
      'shared_expert_mlp',
      'moe_combine',
      'router',
      'dispatch',
      'experts',
      'gate_up',
      'mlp_act',
      'down_proj',
    ]);
    const allNodeIds = N.map((node) => node.id);
    const transformerStackIds = withParamTensors(decoderOps.concat(['embedding', 'final_norm', 'lm_head'], isPangu ? mtpOps : []));
    const decoderIds = withParamTensors(decoderOps);
    const attentionIds = withParamTensors(attentionOps);
    const ffnIds = withParamTensors(ffnOps);
    const setParent = (ids, parent) => {
      existingIds(ids).forEach((id) => {
        nodeById.get(id).parent = parent;
      });
    };
    setParent(['token_ids', 'logits', 'mtp_logits'], 'model');
    setParent(withParamTensors(['embedding', 'final_norm', 'lm_head']), 'transformer');
    if (isPangu) {
      setParent(withParamTensors(['sparse_mla_attention']).concat(['rope_cache', 'kv_cache', 'param_sink_state', 'mome_state']), 'attention');
      setParent(panguMhcOps, 'pangu_mhc');
      setParent(panguQLaneOps, 'pangu_q_lane');
      setParent(panguKvLaneOps, 'pangu_kv_lane');
      setParent(panguSparseCoreOps, 'pangu_sparse_core');
      setParent(ffnIds, 'ffn');
      setParent(denseFfnOps, 'dense_ffn');
      setParent(panguMoeOps, 'moe');
      setParent(mtpOps, 'mtp_stack');
    } else {
      setParent(withParamTensors(['attn_norm']).concat(['rope_cache']), 'attention');
      setParent(qkvProjectionOps, 'qkv_projection');
      setParent(qLaneOps, 'q_lane');
      setParent(kLaneOps, 'k_lane');
      setParent(vLaneOps, 'v_lane');
      setParent(attentionCoreOps, 'attention_core');
      setParent(ffnIds, spec.variant === 'moe' ? 'moe' : 'mlp');
    }

    const modelBox = boundsFor(allNodeIds, { x: 34, top: 38, bottom: 30 });
    const transformerBox = boundsFor(transformerStackIds, { x: 26, top: 42, bottom: 26 });
    const decoderBox = boundsFor(decoderIds, { x: 18, top: 34, bottom: 22 });
    const attentionBox = boundsFor(attentionIds, { x: 18, top: 52, bottom: 24 });
    const qkvProjectionBox = boundsFor(qkvProjectionOps, { x: 16, top: 48, bottom: 20 });
    const qLaneBox = boundsFor(qLaneOps, { x: 16, top: 44, bottom: 20 });
    const kLaneBox = boundsFor(kLaneOps, { x: 16, top: 44, bottom: 20 });
    const vLaneBox = boundsFor(vLaneOps, { x: 16, top: 44, bottom: 20 });
    const attentionCoreBox = boundsFor(attentionCoreOps, { x: 18, top: 48, bottom: 22 });
    const ffnBox = boundsFor(ffnIds, { x: 14, top: 26, bottom: 18 });
    const panguMhcBox = boundsFor(panguMhcOps, { x: 16, top: 44, bottom: 20 });
    const panguQLaneBox = boundsFor(panguQLaneOps, { x: 16, top: 44, bottom: 20 });
    const panguKvLaneBox = boundsFor(panguKvLaneOps, { x: 16, top: 44, bottom: 20 });
    const panguSparseCoreBox = boundsFor(panguSparseCoreOps, { x: 18, top: 48, bottom: 22 });
    const denseFfnBox = boundsFor(denseFfnOps, { x: 14, top: 38, bottom: 18 });
    const panguMoeBox = boundsFor(panguMoeOps, { x: 14, top: 38, bottom: 18 });
    const mtpBox = boundsFor(mtpOps, { x: 18, top: 40, bottom: 20 });
    const H = [];
    if (modelBox) {
      CL.push({ id: 'model', label: `${spec.name} Model`, ...modelBox });
      H.push({ id: 'model', label: `${spec.name} Model`, typeLabel: 'Root module', childIds: allNodeIds, sem: 'linear' });
    }
    if (transformerBox) CL.push({ id: 'transformer', label: 'Transformer Stack', ...transformerBox });
    if (transformerBox) H.push({ id: 'transformer', label: 'Transformer Stack', typeLabel: 'Module', parentModule: 'model', childIds: transformerStackIds, sem: 'linear' });
    if (decoderBox) CL.push({ id: 'decoder', label: `Decoder Layer x ${spec.layers}`, ...decoderBox, repeat: true });
    if (decoderBox) H.push({ id: 'decoder', label: 'Decoder Layer', typeLabel: `Repeated x ${spec.layers}`, parentModule: 'transformer', childIds: decoderIds, sem: 'linear', repeat: true });
    if (attentionBox) {
      CL.push({ id: 'attention', label: isPangu ? `Sparse MLA Attention · DSA${spec.dsaLayers}/SWA${spec.swaLayers}` : `Attention · GQA ${spec.qh}:${spec.kvh}`, ...attentionBox });
      H.push({
        id: 'attention',
        label: isPangu ? 'Sparse MLA Attention' : 'Attention',
        typeLabel: isPangu ? `DSA${spec.dsaLayers} / SWA${spec.swaLayers}` : `GQA ${spec.qh}:${spec.kvh}`,
        parentModule: 'decoder',
        childIds: attentionIds,
        sem: 'attention',
      });
    }
    if (isPangu) {
      if (panguMhcBox) {
        CL.push({ id: 'pangu_mhc', label: 'mHC Sandwich Norm', ...panguMhcBox });
        H.push({ id: 'pangu_mhc', label: 'mHC Sandwich Norm', typeLabel: 'S_mhc=4', parentModule: 'attention', childIds: panguMhcOps, sem: 'attention' });
      }
      if (panguQLaneBox) {
        CL.push({ id: 'pangu_q_lane', label: 'Q Latent Lane', ...panguQLaneBox });
        H.push({ id: 'pangu_q_lane', label: 'Q Latent Lane', typeLabel: `R_q ${spec.qRank}`, parentModule: 'attention', childIds: panguQLaneOps, sem: 'linear' });
      }
      if (panguKvLaneBox) {
        CL.push({ id: 'pangu_kv_lane', label: 'KV Latent Lane', ...panguKvLaneBox });
        H.push({ id: 'pangu_kv_lane', label: 'KV Latent Lane', typeLabel: `R_kv ${spec.kvRank}`, parentModule: 'attention', childIds: panguKvLaneOps, sem: 'linear' });
      }
      if (panguSparseCoreBox) {
        CL.push({ id: 'pangu_sparse_core', label: 'Sparse Core · DSA/SWA + cache states', ...panguSparseCoreBox });
        H.push({ id: 'pangu_sparse_core', label: 'Sparse Core', typeLabel: 'RoPE + DSA + Flash', parentModule: 'attention', childIds: panguSparseCoreOps, sem: 'attention' });
      }
      if (ffnBox) {
        CL.push({ id: 'ffn', label: `Dense + MoE FFN · dense ${spec.denseLayers} / MoE ${spec.layers - spec.denseLayers}`, ...ffnBox });
        H.push({ id: 'ffn', label: 'Dense + MoE FFN', typeLabel: `L0-${spec.denseLayers - 1} dense · L${spec.denseLayers}-${spec.layers - 1} MoE`, parentModule: 'decoder', childIds: ffnIds, sem: 'moe' });
      }
      if (denseFfnBox) {
        CL.push({ id: 'dense_ffn', label: 'Dense MLP · early layers', ...denseFfnBox });
        H.push({ id: 'dense_ffn', label: 'Dense MLP', typeLabel: `layers 0-${spec.denseLayers - 1}`, parentModule: 'ffn', childIds: denseFfnOps, sem: 'act' });
      }
      if (panguMoeBox) {
        CL.push({ id: 'moe', label: 'MoE FFN · routed + shared', ...panguMoeBox });
        H.push({ id: 'moe', label: 'MoE FFN', typeLabel: `Experts ${spec.experts} top-${spec.topk}`, parentModule: 'ffn', childIds: panguMoeOps, sem: 'moe' });
      }
      if (mtpBox) {
        CL.push({ id: 'mtp_stack', label: `MTP Stack · next ${spec.mtp}`, ...mtpBox, repeat: true });
        H.push({ id: 'mtp_stack', label: 'Multi Token Predictor', typeLabel: `Repeated x ${spec.mtp}`, parentModule: 'transformer', childIds: mtpOps, sem: 'linear', repeat: true });
      }
    } else if (qkvProjectionBox) {
      CL.push({ id: 'qkv_projection', label: 'QKV Projection · logical lanes', ...qkvProjectionBox });
      H.push({ id: 'qkv_projection', label: 'QKV Projection', typeLabel: 'Fusion candidate view', parentModule: 'attention', childIds: qkvProjectionOps, sem: 'linear' });
    }
    if (!isPangu && qLaneBox) {
      CL.push({ id: 'q_lane', label: 'Q Lane', ...qLaneBox });
      H.push({ id: 'q_lane', label: 'Q Lane', typeLabel: 'Query path', parentModule: 'attention', childIds: qLaneOps, sem: 'qknorm' });
    }
    if (!isPangu && kLaneBox) {
      CL.push({ id: 'k_lane', label: 'K Lane', ...kLaneBox });
      H.push({ id: 'k_lane', label: 'K Lane', typeLabel: 'Key path', parentModule: 'attention', childIds: kLaneOps, sem: 'qknorm' });
    }
    if (!isPangu && vLaneBox) {
      CL.push({ id: 'v_lane', label: 'V Lane', ...vLaneBox });
      H.push({ id: 'v_lane', label: 'V Lane', typeLabel: 'Value / cache path', parentModule: 'attention', childIds: vLaneOps, sem: 'attention' });
    }
    if (!isPangu && attentionCoreBox) {
      CL.push({ id: 'attention_core', label: 'Attention Core · flash candidate', ...attentionCoreBox });
      H.push({ id: 'attention_core', label: 'Attention Core', typeLabel: 'QK softmax V', parentModule: 'attention', childIds: attentionCoreOps, sem: 'attention' });
    }
    if (!isPangu && moeClusterOps.length) {
      if (ffnBox) {
        CL.push({ id: 'moe', label: 'MoE FFN · 专家分组', ...ffnBox, repeat: false });
        H.push({ id: 'moe', label: 'MoE FFN', typeLabel: `Experts ${spec.experts} top-${spec.topk}`, parentModule: 'decoder', childIds: ffnIds, sem: 'moe' });
      }
    } else if (!isPangu && ffnBox) {
      CL.push({ id: 'mlp', label: 'SwiGLU MLP', ...ffnBox, repeat: false });
      H.push({ id: 'mlp', label: 'SwiGLU MLP', typeLabel: 'Feed-forward', parentModule: 'decoder', childIds: ffnIds, sem: 'act' });
    }
    normalizeClusterHierarchy(CL, H);
    const extents = fitGraphExtents(N, CL, 1140, y + 20);
    return { width: extents.width, height: extents.height, clusters: CL, nodes: N, edges: E, hierarchy: H, spec };
  }

  function cloneGraph(graph) {
    return {
      width: graph.width,
      height: graph.height,
      spec: graph.spec,
      clusters: graph.clusters.map((cluster) => ({ ...cluster })),
      hierarchy: (graph.hierarchy || []).map((module) => ({ ...module, childIds: [...(module.childIds || [])] })),
      nodes: graph.nodes.map((node) => {
        const { _el, ...data } = node;
        return { ...data };
      }),
      edges: graph.edges.map((edge) => ({ ...edge })),
    };
  }

  function currentModelData() {
    return currentModel ? MODELS[currentModel] : null;
  }

  function ensureModelGraph(model) {
    if (!model.graph) model.graph = buildGraph(model.spec);
    return model.graph;
  }

  function fusionAffectedIds(recId, graph) {
    const rec = FUSION_LIB[recId];
    if (!rec || !graph) return [];
    const ids = new Set(rec.affects || []);
    graph.nodes.forEach((node) => {
      if (node.fuseRec === recId) ids.add(node.id);
    });
    return graph.nodes
      .filter((node) => ids.has(node.id) && node.kind === 'op')
      .map((node) => node.id);
  }

  function fusionOutputLabel(recId) {
    const rec = FUSION_LIB[recId];
    const output = (rec?.chain || []).slice().reverse().find((segment) => segment[1] === 'out') || rec?.chain?.[rec.chain.length - 1];
    if (Array.isArray(output) && output[0]) return output[0];
    const fallback = {
      qknorm_rope: 'RmsNormRope',
      add_rmsnorm: 'AddRmsNorm',
      swiglu: 'SiluAndMul',
      qkv_merge: 'QKVProj',
      flash_paged: 'FlashAttn',
      grouped_matmul: 'GroupedMatmul',
    };
    return fallback[recId] || rec?.title || recId;
  }

  function semanticForFusion(recId, ids, graph) {
    if (recId === 'grouped_matmul') return 'moe';
    if (recId === 'flash_paged' || recId === 'qknorm_rope') return 'attention';
    if (recId === 'add_rmsnorm') return 'norm';
    if (recId === 'swiglu') return 'act';
    if (recId === 'qkv_merge') return 'linear';
    const node = graph.nodes.find((item) => ids.includes(item.id) && item.sem);
    return node?.sem || 'linear';
  }

  function contiguousFusionGroups(ids, graph) {
    const wanted = new Set(ids);
    const spine = graph.nodes.filter((node) => node.kind === 'op');
    const groups = [];
    let current = [];
    spine.forEach((node) => {
      if (wanted.has(node.id)) {
        current.push(node.id);
        return;
      }
      if (current.length) groups.push(current);
      current = [];
    });
    if (current.length) groups.push(current);
    return groups;
  }

  function moduleAncestors(moduleId, graph) {
    const moduleById = new Map((graph.hierarchy || []).map((module) => [module.id, module]));
    const ancestors = [];
    let current = moduleId;
    let guard = 0;
    while (current && guard < 16) {
      ancestors.push(current);
      current = moduleById.get(current)?.parentModule;
      guard += 1;
    }
    return ancestors;
  }

  function commonModuleParentForNodes(nodes, graph) {
    const chains = nodes
      .map((node) => moduleAncestors(node.parent, graph))
      .filter((chain) => chain.length);
    if (!chains.length) return null;
    return chains[0].find((moduleId) => chains.every((chain) => chain.includes(moduleId))) || null;
  }

  function projectGraphWithFusions(baseGraph, previewIds) {
    const graph = cloneGraph(baseGraph);
    const active = Array.from(previewIds || []).filter((recId) => FUSION_LIB[recId]);
    if (!active.length) return graph;

    const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
    const replacementByNode = new Map();
    const fusedNodes = [];

    active.forEach((recId) => {
      const availableIds = fusionAffectedIds(recId, graph).filter((id) => nodeMap.has(id) && !replacementByNode.has(id));
      const groups = contiguousFusionGroups(availableIds, graph).filter((group) => group.length);
      groups.forEach((group, index) => {
        const originals = group.map((id) => nodeMap.get(id)).filter(Boolean);
        if (!originals.length) return;
        const minY = Math.min(...originals.map((node) => node.y - node.h / 2));
        const maxY = Math.max(...originals.map((node) => node.y + node.h / 2));
        const centerX = originals.reduce((sum, node) => sum + node.x, 0) / originals.length;
        const centerY = (minY + maxY) / 2;
        const width = Math.max(230, Math.min(320, fusionOutputLabel(recId).length * 8 + 92));
        const fusedId = groups.length === 1 ? `fused_${recId}` : `fused_${recId}_${index + 1}`;
        const parent = commonModuleParentForNodes(originals, graph) || originals.find((node) => node.parent)?.parent || 'decoder';
        fusedNodes.push({
          id: fusedId,
          label: fusionOutputLabel(recId),
          typeLabel: `Applied fusion · ${originals.length} ops`,
          kind: 'op',
          sem: semanticForFusion(recId, group, graph),
          x: centerX,
          y: centerY,
          w: width,
          h: 58,
          fuseRec: recId,
          virtual: true,
          parent,
          originalNodeIds: group,
        });
        group.forEach((id) => replacementByNode.set(id, fusedId));
      });
    });

    if (!fusedNodes.length) return graph;

    graph.nodes = graph.nodes.filter((node) => !replacementByNode.has(node.id)).concat(fusedNodes);
    const seenEdges = new Set();
    graph.edges = graph.edges.reduce((edges, edge) => {
      const source = replacementByNode.get(edge.s) || edge.s;
      const target = replacementByNode.get(edge.t) || edge.t;
      if (source === target) return edges;
      const key = `${source}->${target}:${edge.tag || ''}:${edge.type || ''}`;
      if (seenEdges.has(key)) return edges;
      seenEdges.add(key);
      edges.push({ ...edge, s: source, t: target, fusedProjection: replacementByNode.has(edge.s) || replacementByNode.has(edge.t) });
      return edges;
    }, []);
    graph.viewMode = 'applied-fusions';
    return graph;
  }

  function moduleDepth(module, moduleById) {
    let depth = 0;
    let parent = module.parentModule;
    let guard = 0;
    while (parent && guard < 16) {
      depth += 1;
      parent = moduleById.get(parent)?.parentModule;
      guard += 1;
    }
    return depth;
  }

  function maxFlatDepthForGraph(graph) {
    const hierarchy = graph?.hierarchy || [];
    if (!hierarchy.length) return 1;
    const moduleById = new Map(hierarchy.map((module) => [module.id, module]));
    const maxDepth = Math.max(...hierarchy.map((module) => moduleDepth(module, moduleById)));
    return Math.max(1, maxDepth + 1);
  }

  function minFlatDepthForGraph(graph) {
    return Math.min(3, maxFlatDepthForGraph(graph));
  }

  function clampedFlatDepth(graph) {
    const minDepth = minFlatDepthForGraph(graph);
    return Math.max(minDepth, Math.min(flatDepth, maxFlatDepthForGraph(graph)));
  }

  function expansionSetForGraph(graph, moduleById) {
    if (graphViewMode !== 'flat') return new Set(expandedModules);
    const level = clampedFlatDepth(graph);
    return new Set((graph.hierarchy || [])
      .filter((module) => moduleDepth(module, moduleById) < level)
      .map((module) => module.id));
  }

  function moduleHasCollapsedAncestor(module, collapsedIds, moduleById) {
    let parent = module.parentModule;
    let guard = 0;
    while (parent && guard < 16) {
      if (collapsedIds.has(parent)) return true;
      parent = moduleById.get(parent)?.parentModule;
      guard += 1;
    }
    return false;
  }

  function moduleContainsNode(module, node, moduleById) {
    if ((module.childIds || []).includes(node.id)) return true;
    let parent = node.parent;
    let guard = 0;
    while (parent && guard < 16) {
      if (parent === module.id) return true;
      parent = moduleById.get(parent)?.parentModule;
      guard += 1;
    }
    return false;
  }

  function moduleFallbackBounds(nodes) {
    if (!nodes.length) return null;
    const left = Math.min(...nodes.map((node) => node.x - node.w / 2));
    const right = Math.max(...nodes.map((node) => node.x + node.w / 2));
    const top = Math.min(...nodes.map((node) => node.y - node.h / 2));
    const bottom = Math.max(...nodes.map((node) => node.y + node.h / 2));
    return { x: left - 18, y: top - 24, w: right - left + 36, h: bottom - top + 48 };
  }

  function collapsedModuleBounds(childNodes, cluster) {
    const primaryNodes = childNodes.filter((node) => node.kind !== 'param' && node.kind !== 'tensor');
    return moduleFallbackBounds(primaryNodes.length ? primaryNodes : childNodes) || cluster;
  }

  function separateCollapsedModuleNodes(nodes, graph) {
    const groups = new Map();
    nodes.forEach((node) => {
      const key = node.parent || 'root';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(node);
    });
    groups.forEach((group) => {
      group.sort((a, b) => a.x - b.x);
      for (let pass = 0; pass < 3; pass += 1) {
        for (let i = 1; i < group.length; i += 1) {
          const prev = group[i - 1];
          const current = group[i];
          const verticalOverlap = Math.abs(prev.y - current.y) < (prev.h + current.h) / 2 + GRAPH_LAYOUT.collapsedModuleGap / 2;
          if (!verticalOverlap) continue;
          const minX = prev.x + prev.w / 2 + current.w / 2 + GRAPH_LAYOUT.collapsedModuleGap;
          if (current.x < minX) current.x = minX;
        }
      }
      const minLeft = Math.min(...group.map((node) => node.x - node.w / 2));
      if (minLeft < 18) {
        const dx = 18 - minLeft;
        group.forEach((node) => {
          node.x += dx;
        });
      }
    });
    const right = Math.max(0, ...nodes.map((node) => node.x + node.w / 2));
    if (right + 28 > graph.width) graph.width = Math.ceil(right + 28);
  }

  function alignCollapsedQkvLanes(nodes, graph) {
    const byModule = new Map(nodes.map((node) => [node.moduleId, node]));
    const qkv = byModule.get('qkv_projection');
    const q = byModule.get('q_lane');
    const k = byModule.get('k_lane');
    const v = byModule.get('v_lane');
    if (!qkv || !q || !k || !v) return;

    const laneY = Math.round((q.y + k.y) / 2);
    const centerX = Math.round((q.x + k.x + v.x) / 3);
    q.y = laneY;
    k.y = laneY;
    v.y = laneY;
    qkv.x = centerX;
    qkv.y = Math.min(qkv.y, laneY - 150);

    const core = byModule.get('attention_core');
    if (core) {
      core.x = centerX;
      core.y = Math.max(core.y, laneY + 170);
    }

    const right = Math.max(0, ...nodes.map((node) => node.x + node.w / 2));
    const bottom = Math.max(0, ...nodes.map((node) => node.y + node.h / 2));
    if (right + 28 > graph.width) graph.width = Math.ceil(right + 28);
    if (bottom + 28 > graph.height) graph.height = Math.ceil(bottom + 28);
  }

  function alignVisibleAppliedFusionNodes(graph) {
    if (graphViewMode !== 'flat') return;
    const nodes = graph.nodes || [];
    const byModule = new Map(nodes.filter((node) => node.collapsedModule).map((node) => [node.moduleId, node]));
    const qkv = byModule.get('qkv_projection');
    const q = byModule.get('q_lane');
    const k = byModule.get('k_lane');
    const v = byModule.get('v_lane');
    const core = byModule.get('attention_core');
    const visibleVirtuals = nodes.filter((node) => node.virtual);
    if (!visibleVirtuals.length) return;

    const gap = GRAPH_LAYOUT.appliedFusionGap;
    const setAbove = (node, target) => {
      node.y = target.y - target.h / 2 - node.h / 2 - gap;
    };
    const setBelow = (node, target) => {
      node.y = target.y + target.h / 2 + node.h / 2 + gap;
    };

    const attnAdd = visibleVirtuals.find((node) => node.fuseRec === 'add_rmsnorm' && node.parent === 'attention');
    if (attnAdd && qkv) {
      attnAdd.x = qkv.x;
      setAbove(attnAdd, qkv);
    }

    const qkFusion = visibleVirtuals.find((node) => node.fuseRec === 'qknorm_rope');
    if (qkFusion && q && k) {
      qkFusion.x = Math.round((q.x + k.x) / 2);
      setBelow(qkFusion, q);
      if (core) {
        core.x = Math.round((q.x + k.x + (v?.x ?? k.x)) / (v ? 3 : 2));
        core.y = Math.max(core.y, qkFusion.y + qkFusion.h / 2 + core.h / 2 + gap);
      }
    }

    visibleVirtuals
      .filter((node) => node !== attnAdd && node !== qkFusion)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .forEach((node) => {
        let guard = 0;
        while (guard < 8) {
          const blocker = nodes.find((other) => other !== node && Math.abs(other.x - node.x) < (other.w + node.w) / 2 + gap && Math.abs(other.y - node.y) < (other.h + node.h) / 2 + gap);
          if (!blocker) break;
          node.y = blocker.y + blocker.h / 2 + node.h / 2 + gap;
          guard += 1;
        }
      });

    const right = Math.max(0, ...nodes.map((node) => node.x + node.w / 2));
    const bottom = Math.max(0, ...nodes.map((node) => node.y + node.h / 2));
    if (right + 28 > graph.width) graph.width = Math.ceil(right + 28);
    if (bottom + 28 > graph.height) graph.height = Math.ceil(bottom + 28);
  }

  function applyHierarchyProjection(inputGraph) {
    const graph = cloneGraph(inputGraph);
    const hierarchy = graph.hierarchy || [];
    if (!hierarchy.length) return graph;

    const moduleById = new Map(hierarchy.map((module) => [module.id, module]));
    const clusterById = new Map(graph.clusters.map((cluster) => [cluster.id, cluster]));
    const expandedSet = expansionSetForGraph(graph, moduleById);
    const collapsedIds = new Set(hierarchy.filter((module) => !expandedSet.has(module.id)).map((module) => module.id));
    const visibleCollapsedModules = hierarchy
      .filter((module) => collapsedIds.has(module.id) && !moduleHasCollapsedAncestor(module, collapsedIds, moduleById))
      .sort((a, b) => moduleDepth(a, moduleById) - moduleDepth(b, moduleById));

    if (!visibleCollapsedModules.length) {
      graph.hierarchy = hierarchy.map((module) => ({ ...module, expanded: true, hiddenByAncestor: false }));
      graph.viewMode = graphViewMode;
      graph.flatDepth = graphViewMode === 'flat' ? clampedFlatDepth(graph) : null;
      return graph;
    }

    const hiddenOwnerByNode = new Map();
    visibleCollapsedModules.forEach((module) => {
      graph.nodes.forEach((node) => {
        if (!hiddenOwnerByNode.has(node.id) && moduleContainsNode(module, node, moduleById)) {
          hiddenOwnerByNode.set(node.id, module.id);
        }
      });
    });

    const moduleNodes = visibleCollapsedModules.map((module) => {
      const childNodes = graph.nodes.filter((node) => moduleContainsNode(module, node, moduleById));
      const cluster = clusterById.get(module.id);
      const bounds = collapsedModuleBounds(childNodes, cluster) || { x: 360, y: 120, w: 240, h: 90 };
      const collapsedChildIds = Array.from(new Set(childNodes.flatMap((node) => [node.id].concat(node.originalNodeIds || []))));
      return {
        id: `module_${module.id}`,
        label: module.label,
        typeLabel: `${module.typeLabel || 'Module'} · ${collapsedChildIds.length} children`,
        kind: 'module',
        sem: module.sem || 'linear',
        parent: module.parentModule,
        moduleId: module.id,
        collapsedModule: true,
        collapsedChildIds,
        x: bounds.x + bounds.w / 2,
        y: bounds.y + bounds.h / 2,
        w: Math.max(210, Math.min(300, bounds.w * 0.46)),
        h: 58,
      };
    });
    alignCollapsedQkvLanes(moduleNodes, graph);
    separateCollapsedModuleNodes(moduleNodes, graph);

    const moduleNodeIdByModule = new Map(moduleNodes.map((node) => [node.moduleId, node.id]));
    graph.nodes = graph.nodes
      .filter((node) => !hiddenOwnerByNode.has(node.id))
      .concat(moduleNodes)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    alignVisibleAppliedFusionNodes(graph);
    graph.nodes.sort((a, b) => (a.y - b.y) || (a.x - b.x));

    const edgeKeys = new Set();
    graph.edges = graph.edges.reduce((edges, edge) => {
      const sourceModule = hiddenOwnerByNode.get(edge.s);
      const targetModule = hiddenOwnerByNode.get(edge.t);
      const source = sourceModule ? moduleNodeIdByModule.get(sourceModule) : edge.s;
      const target = targetModule ? moduleNodeIdByModule.get(targetModule) : edge.t;
      if (!source || !target || source === target) return edges;
      const key = `${source}->${target}:${edge.tag || ''}:${edge.type || ''}`;
      if (edgeKeys.has(key)) return edges;
      edgeKeys.add(key);
      edges.push({
        ...edge,
        s: source,
        t: target,
        hierarchyProjection: Boolean(sourceModule || targetModule),
      });
      return edges;
    }, []);

    graph.clusters = graph.clusters.filter((cluster) => {
      const module = moduleById.get(cluster.id);
      if (!module) return true;
      return !collapsedIds.has(module.id) && !moduleHasCollapsedAncestor(module, collapsedIds, moduleById);
    });
    graph.hierarchy = hierarchy.map((module) => ({
      ...module,
      expanded: expandedSet.has(module.id),
      hiddenByAncestor: moduleHasCollapsedAncestor(module, collapsedIds, moduleById),
    }));
    graph.collapsedModules = visibleCollapsedModules.map((module) => module.id);
    graph.viewMode = graphViewMode;
    graph.flatDepth = graphViewMode === 'flat' ? clampedFlatDepth(graph) : null;
    return graph;
  }

  function graphForCurrentView(model) {
    const base = ensureModelGraph(model);
    const graph = activeFusionPreviews.size
      ? projectGraphWithFusions(base, activeFusionPreviews)
      : cloneGraph(base);
    return applyHierarchyProjection(graph);
  }

  function renderActiveGraph(options = {}) {
    const model = currentModelData();
    if (!model) return;
    const graph = graphForCurrentView(model);
    renderGraph(graph, { preserveView: options.preserveView });
    const base = ensureModelGraph(model);
    const opCount = base.nodes.filter((node) => node.kind === 'op').length;
    const moduleCount = base.hierarchy?.length || 0;
    const fusionText = activeFusionPreviews.size ? `${activeFusionPreviews.size} 个融合已应用` : '推荐层叠加';
    const viewText = graphViewMode === 'flat' ? `平铺 L${clampedFlatDepth(base)}` : '下钻';
    els.midD.textContent = `${model.name} · ${viewText} · ${moduleCount} 级模块 · ${opCount} 原始算子 · ${fusionText}`;
    updateGraphControls();
  }

  function updateGraphControls() {
    els.zbr?.classList.toggle('is-selected', showBrackets);
    els.viewDrill?.classList.toggle('is-selected', graphViewMode === 'drill');
    els.viewDrill?.setAttribute('aria-pressed', String(graphViewMode === 'drill'));
    els.viewFlat?.classList.toggle('is-selected', graphViewMode === 'flat');
    els.viewFlat?.setAttribute('aria-expanded', String(flatMenuOpen));
    const model = currentModelData();
    const graph = model ? ensureModelGraph(model) : null;
    if (graph) {
      const depth = clampedFlatDepth(graph);
      if (depth !== flatDepth) flatDepth = depth;
      if (els.flatLabel) els.flatLabel.textContent = `平铺 · L${depth}`;
      renderFlatDepthMenu(graph);
    }
    positionFlatMenu();
    if (els.flatMenu) els.flatMenu.hidden = !flatMenuOpen;
  }

  function positionFlatMenu() {
    if (!els.flatMenu || !els.viewFlat) return;
    const rect = els.viewFlat.getBoundingClientRect();
    const width = Math.max(96, els.flatMenu.offsetWidth || 96);
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    const top = Math.min(window.innerHeight - 8, rect.bottom + 6);
    els.flatMenu.style.setProperty('--op-flat-menu-left', `${Math.round(left)}px`);
    els.flatMenu.style.setProperty('--op-flat-menu-top', `${Math.round(top)}px`);
  }

  function renderFlatDepthMenu(graph) {
    if (!els.flatMenu || !graph) return;
    const minDepth = minFlatDepthForGraph(graph);
    const maxDepth = maxFlatDepthForGraph(graph);
    const current = clampedFlatDepth(graph);
    els.flatMenu.innerHTML = Array.from({ length: maxDepth - minDepth + 1 }, (_, index) => {
      const depth = minDepth + index;
      return `<button class="op-flat-menu__item${depth === current && graphViewMode === 'flat' ? ' is-selected' : ''}" type="button" role="menuitemradio" aria-checked="${depth === current && graphViewMode === 'flat' ? 'true' : 'false'}" data-flat-depth="${depth}">L${depth}</button>`;
    }).join('');
    els.flatMenu.querySelectorAll('[data-flat-depth]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        setFlatDepth(Number(button.dataset.flatDepth));
      });
    });
  }

  function setFlatMenuOpen(open) {
    flatMenuOpen = Boolean(open);
    updateGraphControls();
  }

  function setGraphViewMode(mode, options = {}) {
    if (mode !== 'drill' && mode !== 'flat') return;
    graphViewMode = mode;
    if (mode === 'drill') flatMenuOpen = false;
    if (mode === 'flat') flatMenuOpen = options.openMenu ?? flatMenuOpen;
    const model = currentModelData();
    if (model && mode === 'flat') flatDepth = clampedFlatDepth(ensureModelGraph(model));
    renderActiveGraph({ preserveView: options.preserveView ?? true });
    clearSelection();
  }

  function setFlatDepth(depth) {
    const model = currentModelData();
    if (!model) return;
    const graph = ensureModelGraph(model);
    flatDepth = Math.max(minFlatDepthForGraph(graph), Math.min(depth, maxFlatDepthForGraph(graph)));
    graphViewMode = 'flat';
    flatMenuOpen = false;
    renderActiveGraph({ preserveView: true });
    clearSelection();
  }

  function setFusionOverlayVisible(visible) {
    showBrackets = Boolean(visible);
    renderActiveGraph({ preserveView: true });
  }

  function toggleModule(moduleId) {
    if (!moduleId) return;
    if (graphViewMode === 'flat') {
      const graph = currentModelData()?.graph || G;
      const moduleById = new Map((graph?.hierarchy || []).map((module) => [module.id, module]));
      moduleAncestors(moduleId, graph).forEach((id) => expandedModules.add(id));
      let parent = moduleById.get(moduleId)?.parentModule;
      let guard = 0;
      while (parent && guard < 16) {
        expandedModules.add(parent);
        parent = moduleById.get(parent)?.parentModule;
        guard += 1;
      }
      graphViewMode = 'drill';
      flatMenuOpen = false;
      renderActiveGraph({ preserveView: true });
      clearSelection();
      return;
    }
    if (expandedModules.has(moduleId)) expandedModules.delete(moduleId);
    else expandedModules.add(moduleId);
    renderActiveGraph({ preserveView: true });
    clearSelection();
  }

  function toggleFusionPreview(recId) {
    if (!FUSION_LIB[recId]) return;
    if (activeFusionPreviews.has(recId)) {
      activeFusionPreviews.delete(recId);
    } else {
      activeFusionPreviews.add(recId);
    }
    renderActiveGraph({ preserveView: true });
    renderRecommendations(currentModelData());
    clearSelection();
  }

  function toggleAllFusionPreviews() {
    const model = currentModelData();
    if (!model) return;
    const allPreviewed = model.recs.every((id) => activeFusionPreviews.has(id));
    activeFusionPreviews = allPreviewed ? new Set() : new Set(model.recs);
    renderActiveGraph({ preserveView: true });
    renderRecommendations(model);
    clearSelection();
  }

  function anchor(node, direction) {
    return {
      x: direction === 'l' ? node.x - node.w / 2 : direction === 'r' ? node.x + node.w / 2 : node.x,
      y: direction === 't' ? node.y - node.h / 2 : direction === 'b' ? node.y + node.h / 2 : node.y,
    };
  }

  function qkvLaneEdgePath(source, target) {
    const a = anchor(source, 'b');
    const b = anchor(target, 't');
    const gap = Math.max(30, Math.abs(b.y - a.y) * 0.46);
    return {
      d: `M ${a.x} ${a.y} C ${a.x} ${a.y + gap}, ${b.x} ${b.y - gap}, ${b.x} ${b.y}`,
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
    };
  }

  function shouldUseQkvLaneEdge(source, target) {
    if (!source?.collapsedModule || !target?.collapsedModule) return false;
    const lanes = new Set(['q_lane', 'k_lane', 'v_lane']);
    return (
      source.moduleId === 'qkv_projection' && lanes.has(target.moduleId)
    ) || (
      lanes.has(source.moduleId) && target.moduleId === 'attention_core'
    );
  }

  function edgePath(source, target, edge = null) {
    if (edge?.hierarchyProjection && shouldUseQkvLaneEdge(source, target)) {
      return qkvLaneEdgePath(source, target);
    }
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

  function renderGraph(graph, options = {}) {
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

    renderBrackets();

    const hierarchyById = new Map((graph.hierarchy || []).map((module) => [module.id, module]));
    const clusterChrome = [];
    graph.clusters.forEach((cluster) => {
      const module = hierarchyById.get(cluster.id);
      const group = svg('g', { class: module ? 'cl-group' : '' });
      group.appendChild(svg('rect', {
        class: `cl-rect${cluster.repeat ? ' repeat' : ''}`,
        x: cluster.x,
        y: cluster.y,
        width: cluster.w,
        height: cluster.h,
        rx: 16,
        ry: 16,
      }));
      if (module) {
        group.addEventListener('dblclick', (event) => {
          event.stopPropagation();
          toggleModule(module.id);
        });
      }
      els.gsvg.appendChild(group);

      const chrome = svg('g', { class: 'cl-chrome' });
      const label = svg('text', { class: 'cl-label', x: cluster.x + 18, y: cluster.y + 22 });
      label.textContent = cluster.label;
      chrome.appendChild(label);
      if (module) {
        const toggle = svg('g', {
          class: 'cl-toggle',
          transform: `translate(${cluster.x + cluster.w - 28}, ${cluster.y + 17})`,
        });
        toggle.appendChild(svg('circle', { class: 'cl-toggle__bg', cx: 0, cy: 0, r: 10 }));
        const glyph = svg('text', {
          class: 'cl-toggle__glyph',
          x: 0,
          y: 1,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        });
        glyph.textContent = '-';
        toggle.appendChild(glyph);
        toggle.addEventListener('pointerdown', (event) => event.stopPropagation());
        toggle.addEventListener('click', (event) => {
          event.stopPropagation();
          toggleModule(module.id);
        });
        chrome.addEventListener('dblclick', (event) => {
          event.stopPropagation();
          toggleModule(module.id);
        });
        chrome.appendChild(toggle);
      }
      clusterChrome.push(chrome);
    });

    const edgeEls = [];
    graph.edges.forEach((edge) => {
      const source = NM[edge.s];
      const target = NM[edge.t];
      if (!source || !target) return;
      const pathData = edgePath(source, target, edge);
      const cls = `edge ${edge.type === 'param' ? 'param' : edge.type === 'comm' ? 'comm' : ''}${edge.fusedProjection || edge.hierarchyProjection ? ' fuse' : ''}`;
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
    clusterChrome.forEach((chrome) => els.gsvg.appendChild(chrome));

    graph.nodes.forEach((node) => {
      const kind = node.kind;
      const nodeClass = kind === 'tensor' || kind === 'param' ? 'tensor' : kind === 'io' ? 'io' : kind === 'module' ? 'module' : 'op';
      const operatorLike = kind === 'op' || kind === 'module';
      const group = svg('g', {
        class: `nd ${nodeClass}${node.fuseRec ? ' fuse' : ''}${node.virtual ? ' virtual' : ''}${node.collapsedModule ? ' collapsed' : ''}`,
        transform: `translate(${node.x}, ${node.y})`,
      });
      group.dataset.id = node.id;
      const radius = operatorLike ? node.h / 2 : Math.min(13, node.h * 0.32);
      const fill = operatorLike ? (SEM[node.sem] || 'var(--primary)') : null;
      group.appendChild(svg('rect', {
        class: 'nd-rect',
        x: -node.w / 2,
        y: -node.h / 2,
        width: node.w,
        height: node.h,
        rx: radius,
        ry: radius,
        fill,
        stroke: operatorLike ? 'color-mix(in srgb, var(--foreground) 16%, transparent)' : null,
      }));
      const label = svg('text', { class: 'nd-label', x: 0, y: operatorLike ? -3 : 0 });
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
      if (node.collapsedModule) {
        group.appendChild(svg('circle', { class: 'module-plus__bg', cx: node.w / 2 - 18, cy: 0, r: 9 }));
        const plus = svg('text', {
          class: 'module-plus__glyph',
          x: node.w / 2 - 18,
          y: 1,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        });
        plus.textContent = '+';
        group.appendChild(plus);
      }
      group.addEventListener('click', (event) => {
        event.stopPropagation();
        if (node.collapsedModule) {
          toggleModule(node.moduleId);
          return;
        }
        selectNode(node.id, 'graph', event);
      });
      group.addEventListener('mousemove', (event) => showTip(node, event));
      group.addEventListener('mouseleave', hideTip);
      els.gsvg.appendChild(group);
      node._el = group;
    });

    requestAnimationFrame(() => {
      if (options.preserveView) applyTransform();
      else fit();
    });
  }

  function renderBrackets() {
    els.gsvg.querySelectorAll('.fbracket,.fbracket-bg,.fbracket-lbl').forEach((node) => node.remove());
    if (!showBrackets || !G || activeFusionPreviews.size) return;
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
    html += `<div class="op-graph-tip__row">类型：<b>${node.virtual ? '已应用融合算子' : node.kind === 'module' ? '父级模块' : node.kind === 'op' ? '算子 Op' : node.kind === 'param' ? '权重张量' : node.kind === 'io' ? 'IO 张量' : '张量'}</b></div>`;
    if (node.collapsedModule) {
      html += `<div class="op-graph-tip__row">点击展开：${esc(node.moduleId)} · ${node.collapsedChildIds?.length || 0} 个 child</div>`;
    }
    if (node.virtual && node.originalNodeIds?.length) {
      html += `<div class="op-graph-tip__row">折叠自：${node.originalNodeIds.map(esc).join(' / ')}</div>`;
    }
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
    if (node.virtual && node.fuseRec && FUSION_LIB[node.fuseRec]) {
      const rec = FUSION_LIB[node.fuseRec];
      const baseGraph = currentModelData()?.graph;
      const baseNodes = new Map((baseGraph?.nodes || []).map((item) => [item.id, item]));
      const originals = (node.originalNodeIds || [])
        .map((id) => baseNodes.get(id)?.label || id)
        .join(' -> ');
      return {
        title: `${node.label} · 已应用融合`,
        meta: `${node.id} · ${originals || rec.title}`,
        doc: rec.doc,
        blocks: [
          ['原始 child ops', originals ? originals.split(' -> ') : [rec.title]],
          ['V · vLLM 原始实现', rec.vllm],
          ['A · 昇腾融合算子', rec.asc],
        ],
      };
    }
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

    // 在算子详细面板中显示节点信息
    if (node?.kind === 'op') {
      renderOperatorDetailPanel(node);
      // 切换到算子详细面板页签
      const detailTabBtn = document.getElementById('tab-btn-details');
      if (detailTabBtn && source === 'graph') {
        detailTabBtn.click();
      }
    }

    if (node?.fuseRec) {
      const card = document.querySelector(`.op-rec-card[data-rec="${node.fuseRec}"]`);
      if (card) {
        card.classList.add('is-selected', 'is-open');
        syncExpander(card);
        if (source === 'graph') card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function renderOperatorDetailPanel(node) {
    const detailContent = document.querySelector('#tab-details .op-detail-content');
    if (!detailContent) return;

    // 构建算子类型信息
    const typeMap = {
      'norm': '归一化',
      'attention': '注意力',
      'qknorm': 'QK-Norm',
      'rope': 'RoPE',
      'linear': 'Linear/GEMM',
      'act': '激活',
      'gate': 'Router',
      'moe': 'Expert',
      'io': 'I/O',
      'embedding': 'Embedding'
    };
    const typeName = typeMap[node.sem] || node.sem || '算子';

    // 生成HTML内容
    let html = `
      <div class="op-detail-header">
        <div class="cardt" style="color: var(--op-sem-${node.sem})">算子详细信息</div>
        <h2 style="font-size: 18px; font-weight: 600; margin: 8px 0;">${esc(node.label)}</h2>
        <div style="font-size: 12px; color: var(--foreground-muted); margin-bottom: 16px;">
          ${esc(node.typeLabel || typeName)}
        </div>
      </div>

      <div class="cardt">基本信息</div>
      <div class="kv">
        <span class="k">算子类型</span>
        <span class="v">${esc(typeName)}</span>
      </div>
      <div class="kv">
        <span class="k">语义类别</span>
        <span class="v">${esc(node.sem || 'op')}</span>
      </div>
      <div class="kv">
        <span class="k">节点ID</span>
        <span class="v" style="font-family: var(--font-mono)">${esc(node.id)}</span>
      </div>
    `;

    // 输出形状信息
    if (node.out) {
      html += `
        <div class="cardt">输出形状</div>
        <div class="kv">
          <span class="k">Output Shape</span>
          <span class="v" style="font-family: var(--font-mono); color: var(--primary)">[${node.out.join(' × ')}]</span>
        </div>
      `;
    }

    // 性能指标
    if (node.metric) {
      html += `
        <div class="cardt">性能指标</div>
        <div class="kv">
          <span class="k">计算量</span>
          <span class="v">${esc(node.metric)}</span>
        </div>
      `;
    }

    if (node.time) {
      html += `
        <div class="kv">
          <span class="k">估算时间</span>
          <span class="v">${esc(node.time)}</span>
        </div>
      `;
    }

    // 描述信息
    if (node.desc) {
      html += `
        <div class="cardt">描述</div>
        <div style="font-size: 12px; line-height: 1.6; color: var(--foreground-secondary); padding: 8px 0;">
          ${esc(node.desc)}
        </div>
      `;
    }

    // 融合推荐信息
    if (node.fuseRec) {
      const rec = FUSION_LIB[node.fuseRec];
      if (rec) {
        html += `
          <div class="cardt" style="color: var(--op-fusion-accent)">融合推荐</div>
          <div class="fitem" style="border-color: var(--op-fusion-accent); margin: 0;">
            <h6><span class="dot" style="background: var(--op-fusion-accent)"></span>${rec.star ? '★ ' : ''}${esc(rec.title)}</h6>
            <p>${esc(rec.reason)}</p>
          </div>
        `;
      }
    }

    detailContent.innerHTML = html;
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

  function aivVizSectionHtml(recId) {
    const config = AIV_VIZ[recId];
    if (!config) return '';
    const flow = config.flow ? `<div class="op-arch-flow">${esc(config.flow)}</div>` : '';
    return `<section class="op-detail-section">
      <div class="op-detail-section__head">硬件视角 · Ascend 910 (AIV)</div>
      <div class="op-arch-panel op-arch-panel--single" data-aiv-viz data-rec="${esc(recId)}" data-phase="before" role="group" aria-label="${esc(config.name)} 的数据流对照">
        <div class="op-arch-panel__head">
          <span class="op-arch-panel__title">${esc(config.name)}</span>
          <span class="op-arch-toggle" role="tablist" aria-label="融合前后对比">
            <button class="btn btn-sm op-arch-toggle__btn is-selected" type="button" role="tab" aria-selected="true" aria-pressed="true" data-aiv-toggle="before">融合前</button>
            <button class="btn btn-sm op-arch-toggle__btn" type="button" role="tab" aria-selected="false" aria-pressed="false" data-aiv-toggle="after">融合后</button>
          </span>
        </div>
        ${flow}
        <div class="op-arch-chip-row" data-aiv-metrics></div>
        <div class="op-aiv-surface"><div class="op-aiv-mount" data-aiv-core data-rec="${esc(recId)}"></div></div>
        <div class="op-aiv-playback" data-aiv-playback aria-label="数据流播放控制"></div>
        <ul class="op-arch-notes" data-aiv-notes></ul>
        <ol class="op-arch-steps" data-aiv-steps></ol>
      </div>
    </section>`;
  }

  function ensureAivEnhancedStage(mount) {
    const stage = mount?.querySelector?.('.pto-aiv-core') || null;
    if (!stage) return null;
    if (stage.dataset.opAivEnhanced === 'true') return stage;
    const layout = stage.querySelector('.pto-aiv-core__layout');
    if (!layout) return stage;

    const innerVectorNode = stage.querySelector('[data-aiv-node="vector:Vector"]');
    if (innerVectorNode && !innerVectorNode.classList.contains('op-aiv-unit')) {
      innerVectorNode.dataset.aivNode = 'vector:VectorRF';
    }

    const hbm = document.createElement('section');
    hbm.className = 'op-aiv-unit op-aiv-unit--hbm';
    hbm.dataset.aivNode = 'hbm:HBM';
    hbm.innerHTML = '<span class="op-aiv-unit__label">HBM</span><span class="op-aiv-unit__meta">Global</span>';
    layout.insertBefore(hbm, layout.firstChild);

    const vector = document.createElement('section');
    vector.className = 'op-aiv-unit op-aiv-unit--vector';
    vector.dataset.aivNode = 'vector:Vector';
    vector.innerHTML = '<span class="op-aiv-unit__label">Vector</span>';
    layout.appendChild(vector);

    stage.dataset.opAivEnhanced = 'true';
    return stage;
  }

  function ensureAivOverlay(stage) {
    if (!stage) return null;
    if (stage.__opAivOverlay) return stage.__opAivOverlay;
    const svgEl = document.createElementNS(SVGNS, 'svg');
    svgEl.setAttribute('class', 'op-aiv-overlay');
    svgEl.setAttribute('viewBox', '0 0 10 10');
    svgEl.setAttribute('preserveAspectRatio', 'none');

    const defs = document.createElementNS(SVGNS, 'defs');
    const marker = document.createElementNS(SVGNS, 'marker');
    marker.setAttribute('id', 'op-aiv-flow-arrow');
    marker.setAttribute('markerUnits', 'userSpaceOnUse');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX', '5.4');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const arrow = document.createElementNS(SVGNS, 'path');
    arrow.setAttribute('d', 'M1,1 L5.4,3 L1,5');
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', 'currentColor');
    arrow.setAttribute('stroke-width', '1.4');
    arrow.setAttribute('stroke-linecap', 'round');
    arrow.setAttribute('stroke-linejoin', 'round');
    marker.appendChild(arrow);
    defs.appendChild(marker);
    svgEl.appendChild(defs);

    stage.appendChild(svgEl);

    const state = {
      svg: svgEl,
      defs,
      paths: new Map(),
      active: [],
      update() {},
    };

    const edgePoint = (stageRect, nodeRect, side) => {
      const x0 = nodeRect.left - stageRect.left;
      const y0 = nodeRect.top - stageRect.top;
      const w = nodeRect.width;
      const h = nodeRect.height;
      if (side === 'left') return { x: x0, y: y0 + h / 2 };
      if (side === 'right') return { x: x0 + w, y: y0 + h / 2 };
      if (side === 'top') return { x: x0 + w / 2, y: y0 };
      if (side === 'bottom') return { x: x0 + w / 2, y: y0 + h };
      return { x: x0 + w / 2, y: y0 + h / 2 };
    };

    const chooseSides = (fromRect, toRect) => {
      const fromCx = fromRect.left + fromRect.width / 2;
      const toCx = toRect.left + toRect.width / 2;
      const fromCy = fromRect.top + fromRect.height / 2;
      const toCy = toRect.top + toRect.height / 2;
      if (Math.abs(fromCx - toCx) >= Math.abs(fromCy - toCy)) {
        return fromCx < toCx ? ['right', 'left'] : ['left', 'right'];
      }
      return fromCy < toCy ? ['bottom', 'top'] : ['top', 'bottom'];
    };

    const pathFor = (fromPoint, toPoint) => {
      const midX = (fromPoint.x + toPoint.x) / 2;
      return `M ${fromPoint.x} ${fromPoint.y} L ${midX} ${fromPoint.y} L ${midX} ${toPoint.y} L ${toPoint.x} ${toPoint.y}`;
    };

    const update = () => {
      const stageRect = stage.getBoundingClientRect();
      svgEl.setAttribute('viewBox', `0 0 ${Math.max(1, stageRect.width)} ${Math.max(1, stageRect.height)}`);
      (state.active || []).forEach(({ from, to }) => {
        const fromEl = stage.querySelector(`[data-aiv-node="${CSS.escape(from)}"]`);
        const toEl = stage.querySelector(`[data-aiv-node="${CSS.escape(to)}"]`);
        const pathEl = state.paths.get(`${from}__${to}`);
        if (!fromEl || !toEl || !pathEl) return;
        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        const [fromSide, toSide] = chooseSides(fromRect, toRect);
        const fromPoint = edgePoint(stageRect, fromRect, fromSide);
        const toPoint = edgePoint(stageRect, toRect, toSide);
        pathEl.setAttribute('d', pathFor(fromPoint, toPoint));
      });
    };

    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(stage);
    stage.querySelectorAll('[data-aiv-node]').forEach((el) => ro?.observe(el));
    requestAnimationFrame(() => requestAnimationFrame(update));

    state.update = update;
    state.destroy = () => ro?.disconnect();

    stage.__opAivOverlay = state;
    return state;
  }

  function ensureAivDriver(mount) {
    if (mount?.__opAivDriver) return mount.__opAivDriver;
    const stage = ensureAivEnhancedStage(mount);
    if (!stage) return null;
    const overlay = ensureAivOverlay(stage);

    const clearNodeHighlights = () => {
      stage.querySelectorAll('[data-aiv-node]').forEach((el) => el.classList.remove('is-highlighted'));
    };

    const highlightNodes = (nodeIds = []) => {
      const set = new Set((Array.isArray(nodeIds) ? nodeIds : []).map(String));
      stage.querySelectorAll('[data-aiv-node]').forEach((el) => {
        el.classList.toggle('is-highlighted', set.has(el.dataset.aivNode));
      });
    };

    const clearMarkers = () => {
      stage.querySelectorAll('.op-aiv-markers').forEach((node) => node.remove());
    };

    const setNodeMarkers = (markers = []) => {
      clearMarkers();
      (Array.isArray(markers) ? markers : []).forEach((marker) => {
        const nodeKey = marker?.node || marker?.target;
        const label = marker?.label;
        if (!nodeKey || !label) return;
        const target = stage.querySelector(`[data-aiv-node="${CSS.escape(String(nodeKey))}"]`);
        if (!target) return;
        const stack = document.createElement('div');
        stack.className = 'op-aiv-markers';
        const tone = String(marker.tone || 'note').toLowerCase();
        const chip = document.createElement('span');
        chip.className = `op-aiv-marker is-tone-${tone}`;
        chip.textContent = String(label);
        if (marker.title) chip.title = String(marker.title);
        stack.appendChild(chip);
        target.appendChild(stack);
      });
    };

    const clearActiveRoutes = () => {
      if (!overlay) return;
      overlay.active = [];
      overlay.paths.forEach((pathEl) => {
        pathEl.classList.remove('is-active', 'is-flow');
      });
      overlay.update();
    };

    const setActiveRoutes = (routes = [], options = {}) => {
      if (!overlay) return;
      const animate = options.animate !== false;
      clearActiveRoutes();
      const list = (Array.isArray(routes) ? routes : [])
        .map((route) => Array.isArray(route) ? { from: route[0], to: route[1] } : route)
        .filter((route) => route && route.from && route.to)
        .map((route) => ({ from: String(route.from), to: String(route.to) }));

      overlay.active = list;

      list.forEach(({ from, to }) => {
        const key = `${from}__${to}`;
        let pathEl = overlay.paths.get(key);
        if (!pathEl) {
          pathEl = document.createElementNS(SVGNS, 'path');
          pathEl.setAttribute('fill', 'none');
          pathEl.setAttribute('stroke-width', '2.2');
          pathEl.setAttribute('stroke-linecap', 'round');
          pathEl.setAttribute('stroke-linejoin', 'round');
          pathEl.setAttribute('marker-end', 'url(#op-aiv-flow-arrow)');
          pathEl.dataset.from = from;
          pathEl.dataset.to = to;
          overlay.svg.appendChild(pathEl);
          overlay.paths.set(key, pathEl);
        }
        pathEl.classList.add('is-active');
        if (animate) pathEl.classList.add('is-flow');
      });

      overlay.update();
    };

    const driver = {
      stage,
      overlay,
      clearNodeHighlights,
      highlightNodes,
      setNodeMarkers,
      clearActiveRoutes,
      setActiveRoutes,
    };
    mount.__opAivDriver = driver;
    return driver;
  }

  function hydrateAivViz(root) {
    const helper = window.PtoAivCorePattern;
    if (!helper || !root) return;
    root.querySelectorAll('[data-aiv-viz]').forEach((panel) => {
      const playbackHelper = window.PtoFloatingPlaybackControl;
      const recId = panel.dataset.rec;
      if (!recId || !AIV_VIZ[recId]) return;
      const mount = panel.querySelector('[data-aiv-core]');
      const playbackMount = panel.querySelector('[data-aiv-playback]');
      const metricsRow = panel.querySelector('[data-aiv-metrics]');
      const notesList = panel.querySelector('[data-aiv-notes]');
      const stepsList = panel.querySelector('[data-aiv-steps]');
      const playbackStateKey = `aivPlaybackState_${recId}`;

      const applyPhase = (phase) => {
        const resolvedPhase = phase === 'after' ? 'after' : 'before';
        panel.dataset.phase = resolvedPhase;

        panel.querySelectorAll('[data-aiv-toggle]').forEach((btn) => {
          const active = btn.dataset.aivToggle === resolvedPhase;
          btn.classList.toggle('is-selected', active);
          btn.setAttribute('aria-selected', String(active));
          btn.setAttribute('aria-pressed', String(active));
        });

        const phaseConfig = AIV_VIZ[recId]?.[resolvedPhase];
        if (!phaseConfig) return;
        const steps = Array.isArray(phaseConfig.steps) ? phaseConfig.steps : [];

        if (metricsRow) {
          metricsRow.innerHTML = (phaseConfig.metrics || [])
            .map((text) => `<span class="op-arch-chip">${esc(text)}</span>`)
            .join('');
        }
        if (notesList) {
          notesList.innerHTML = (phaseConfig.notes || [])
            .map((text) => `<li>${esc(text)}</li>`)
            .join('');
        }
        if (stepsList) {
          stepsList.innerHTML = (phaseConfig.steps || [])
            .map((step, index) => `<li class="op-arch-step" data-aiv-step="${index}">
              <button class="btn btn-ghost op-arch-step__btn" type="button" data-aiv-step-btn="${index}">${esc(step.title || '')}</button>
            </li>`)
            .join('');
        }
        if (mount) {
          if (mount.dataset.aivRendered !== 'true') {
            helper.render(mount, 'aivOfficialV1');
            mount.dataset.aivRendered = 'true';
          }
          const driver = ensureAivDriver(mount);
          helper.setBufferBlocks(mount, phaseConfig.blocks || []);
          driver?.setNodeMarkers(phaseConfig.markers || []);
          driver?.highlightNodes([]);
          driver?.clearActiveRoutes();
        }

        if (playbackMount) {
          playbackMount.innerHTML = '';
          delete playbackMount.dataset.aivPlaybackReady;
          delete panel.dataset.aivPlaybackIds;
        }

        const state = panel[playbackStateKey] || { step: 0, playing: false, timer: null };
        panel[playbackStateKey] = state;
        state.step = 0;
        state.playing = false;
        if (state.timer) {
          clearInterval(state.timer);
          state.timer = null;
        }

        const ensurePlaybackControl = () => {
          if (!playbackHelper || !playbackMount) return null;
          if (playbackMount.dataset.aivPlaybackReady === 'true') return playbackMount.firstElementChild || playbackMount;
          const uid = `${recId}_${Math.random().toString(16).slice(2)}`;
          const ids = {
            shell: `floating-shell-${uid}`,
            toggle: `floating-toggle-${uid}`,
            collapsedButton: `floating-collapsed-btn-${uid}`,
            collapsedIcon: `floating-collapsed-icon-${uid}`,
            controls: `controls-row-${uid}`,
            stepBack: `step-back-btn-${uid}`,
            play: `play-btn-${uid}`,
            stepForward: `step-fwd-btn-${uid}`,
            replay: `replay-btn-${uid}`,
            scrubber: `scrubber-${uid}`,
            scrubberLabel: `scrubber-label-${uid}`,
            scrubberOpname: `scrubber-opname-${uid}`,
            scrubberHover: `scrubber-hover-${uid}`,
          };
          panel.dataset.aivPlaybackIds = JSON.stringify(ids);
          const control = playbackHelper.createControl({
            className: 'pto-floating-playback--preview op-aiv-playback__control',
            ids,
            showTimeline: true,
          });
          playbackMount.innerHTML = '';
          playbackMount.appendChild(control);
          playbackHelper.init({ root: control, isPlaying: () => state.playing });
          playbackHelper.initScrubberHover({
            root: control,
            getTotalSteps: () => steps.length || 1,
            getLabelForStep: (nextStep) => steps[nextStep]?.title || `Step ${nextStep + 1}`,
          });
          playbackMount.dataset.aivPlaybackReady = 'true';
          return control;
        };

        const applyStep = (nextStep, options = {}) => {
          if (!mount) return;
          const driver = ensureAivDriver(mount);
          const clamped = Math.max(0, Math.min(steps.length - 1, Number(nextStep) || 0));
          state.step = clamped;
          const step = steps[clamped];
          driver?.highlightNodes(step?.nodes || []);
          driver?.setActiveRoutes(step?.routes || [], { animate: true });

          if (stepsList) {
            stepsList.querySelectorAll('[data-aiv-step]').forEach((row) => {
              row.classList.toggle('is-selected', Number(row.dataset.aivStep) === clamped);
            });
          }

          const control = ensurePlaybackControl();
          const ids = panel.dataset.aivPlaybackIds ? JSON.parse(panel.dataset.aivPlaybackIds) : null;
          if (control && ids) {
            const scrubber = control.querySelector(`#${ids.scrubber}`);
            const label = control.querySelector(`#${ids.scrubberLabel}`);
            const opname = control.querySelector(`#${ids.scrubberOpname}`);
            const playBtn = control.querySelector(`#${ids.play}`);
            if (scrubber) {
              scrubber.max = String(Math.max(0, steps.length - 1));
              scrubber.value = String(clamped);
            }
            if (label) label.textContent = `${clamped + 1} / ${Math.max(1, steps.length)}`;
            if (opname) opname.textContent = (step?.title || '').replace(/^\d+\)\s*/, '');
            if (playBtn) playBtn.innerHTML = state.playing ? playbackHelper.iconLabel('pause', 'Pause') : playbackHelper.iconLabel('play', 'Play');
          }

          if (!options.silent) {
            const status = els?.statusLeft;
            if (status) status.textContent = `${AIV_VIZ[recId].name} · ${resolvedPhase === 'before' ? '融合前' : '融合后'} · Step ${clamped + 1}/${Math.max(1, steps.length)}`;
          }
        };

        const bindPlaybackEvents = () => {
          const control = ensurePlaybackControl();
          const ids = panel.dataset.aivPlaybackIds ? JSON.parse(panel.dataset.aivPlaybackIds) : null;
          if (!control || !ids) return;
          if (control.dataset.aivPlaybackBound === 'true') return;

          const playBtn = control.querySelector(`#${ids.play}`);
          const backBtn = control.querySelector(`#${ids.stepBack}`);
          const forwardBtn = control.querySelector(`#${ids.stepForward}`);
          const replayBtn = control.querySelector(`#${ids.replay}`);
          const scrubber = control.querySelector(`#${ids.scrubber}`);

          const stop = () => {
            state.playing = false;
            if (state.timer) {
              clearInterval(state.timer);
              state.timer = null;
            }
          };

          const tick = () => {
            if (steps.length <= 0) return;
            if (state.step >= steps.length - 1) {
              stop();
              applyStep(state.step);
              return;
            }
            applyStep(state.step + 1);
          };

          const start = () => {
            stop();
            state.playing = true;
            state.timer = setInterval(tick, 1200);
          };

          playBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            if (state.playing) stop();
            else start();
            applyStep(state.step);
          });
          backBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            stop();
            applyStep(state.step - 1);
          });
          forwardBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            stop();
            applyStep(state.step + 1);
          });
          replayBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            stop();
            applyStep(0);
          });
          scrubber?.addEventListener('input', (event) => {
            event.stopPropagation();
            stop();
            applyStep(Number(scrubber.value) || 0);
          });

          control.dataset.aivPlaybackBound = 'true';
        };

        bindPlaybackEvents();
        applyStep(0, { silent: true });

        if (stepsList && mount) {
          stepsList.querySelectorAll('[data-aiv-step-btn]').forEach((button) => {
            const stepIndex = Number(button.dataset.aivStepBtn);
            const step = phaseConfig.steps?.[stepIndex];
            const nodes = Array.isArray(step?.nodes) ? step.nodes : [];
            const highlight = () => {
              const driver = ensureAivDriver(mount);
              driver?.highlightNodes(nodes);
              driver?.setActiveRoutes(step?.routes || [], { animate: true });
            };
            const clear = () => {
              const driver = ensureAivDriver(mount);
              driver?.highlightNodes([]);
              driver?.clearActiveRoutes();
            };
            button.addEventListener('mouseenter', highlight);
            button.addEventListener('mouseleave', clear);
            button.addEventListener('focus', highlight);
            button.addEventListener('blur', clear);
            button.addEventListener('click', (event) => {
              event.stopPropagation();
              panel[playbackStateKey].playing = false;
              if (panel[playbackStateKey].timer) {
                clearInterval(panel[playbackStateKey].timer);
                panel[playbackStateKey].timer = null;
              }
              applyStep(Number(button.dataset.aivStepBtn) || 0);
            });
          });
        }
      };

      panel.querySelectorAll('[data-aiv-toggle]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          applyPhase(btn.dataset.aivToggle);
        });
      });

      applyPhase(panel.dataset.phase || 'before');
    });
  }

  function renderRecommendations(model) {
    if (!model) return;
    const baseGraph = ensureModelGraph(model);
    const baseMap = new Map(baseGraph.nodes.map((node) => [node.id, node]));
    const recs = model.recs;
    const fusePoints = baseGraph.nodes.filter((node) => node.fuseRec).length;
    const allApplied = recs.every((id) => activeFusionPreviews.has(id));
    els.rightD.textContent = `${recs.length} 个方案 · ${activeFusionPreviews.size} 个已应用`;
    els.topRecChip.textContent = `${recs.length} recs`;
    const toolbar = `<div class="op-rec-toolbar">
      <button class="btn btn-solid btn-lg op-apply-all${allApplied ? ' is-selected' : ''}" type="button" id="apply-all-fusions" aria-pressed="${allApplied ? 'true' : 'false'}">${allApplied ? 'Clear applied' : 'Apply all'}</button>
    </div>`;
    const summary = `<div class="op-summary-grid">
      <div class="op-summary-cell"><div class="op-summary-cell__value" data-tone="fusion">${recs.length}</div><div class="op-summary-cell__label">推荐方案</div></div>
      <div class="op-summary-cell"><div class="op-summary-cell__value" data-tone="info">${activeFusionPreviews.size}</div><div class="op-summary-cell__label">已应用</div></div>
      <div class="op-summary-cell"><div class="op-summary-cell__value" data-tone="success">${fusePoints}</div><div class="op-summary-cell__label">候选点</div></div>
    </div>`;

    const cards = recs.map((id) => {
      const rec = FUSION_LIB[id];
      if (!rec) return '';
      const previewed = activeFusionPreviews.has(id);
      const prioText = rec.prio === 's' ? 'STAR' : rec.prio === 'h' ? 'HIGH' : 'MED';
      const prioClass = rec.prio === 's' ? 'op-priority--star' : rec.prio === 'h' ? 'op-priority--high' : 'op-priority--medium';
      const gains = rec.gains.map(([label, kind]) => `<span class="op-gain ${kind === 'tp' ? 'op-gain--tp' : kind === 'mem' ? 'op-gain--mem' : ''}">${esc(label)}</span>`).join('');
      const affects = fusionAffectedIds(id, baseGraph)
        .filter((nodeId) => baseMap.has(nodeId))
        .map((nodeId) => `<button class="btn btn-sm op-affect-chip" type="button" data-go="${esc(nodeId)}" data-rec="${esc(id)}">${esc(baseMap.get(nodeId).label)}</button>`)
        .join('');
      return `<article class="op-rec-card${previewed ? ' is-previewed' : ''}" data-rec="${esc(id)}">
        <div class="op-rec-card__head" role="button" tabindex="0" aria-expanded="false">
          <span class="op-priority ${prioClass}">${prioText}</span>
          <span class="op-rec-card__title">
            <span class="op-rec-card__name">${rec.star ? '<span class="op-badge op-badge--fusion">★</span> ' : ''}${esc(rec.title)}</span>
            <span class="op-chain">${chainHtml(rec.chain)}</span>
            <span class="op-gain-row">${gains}</span>
          </span>
          <span class="op-rec-card__actions">
            <button class="btn btn-sm op-rec-preview${previewed ? ' is-selected' : ''}" type="button" data-preview-rec="${esc(id)}">${previewed ? 'Applied' : 'Apply'}</button>
            <span class="op-rec-card__expander" aria-hidden="true">v</span>
          </span>
        </div>
        <div class="op-rec-card__body">
          <section class="op-detail-section">
            <div class="op-detail-section__head">推荐理由</div>
            <div class="op-reason">${rec.reason}</div>
          </section>
          ${aivVizSectionHtml(id)}
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

    els.rbody.innerHTML = `${toolbar}${summary}${cards}`;
    els.rbody.querySelector('#apply-all-fusions')?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleAllFusionPreviews();
    });
    els.rbody.querySelectorAll('.op-rec-card__head').forEach((head) => {
      const toggleCard = () => {
        const card = head.closest('.op-rec-card');
        card.classList.toggle('is-open');
        syncExpander(card);
        if (card.classList.contains('is-open')) highlightRecommendation(card.dataset.rec);
      };
      head.addEventListener('click', toggleCard);
      head.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleCard();
      });
    });
    els.rbody.querySelectorAll('[data-preview-rec]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleFusionPreview(button.dataset.previewRec);
      });
    });
    els.rbody.querySelectorAll('[data-go]').forEach((chip) => {
      chip.addEventListener('click', (event) => {
        event.stopPropagation();
        if (NM[chip.dataset.go]) selectNode(chip.dataset.go, 'recommendation');
        else highlightRecommendation(chip.dataset.rec);
      });
    });
    hydrateAivViz(els.rbody);
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
    const baseGraph = currentModelData()?.graph || G;
    const baseAffected = new Set(fusionAffectedIds(id, baseGraph));
    const affected = new Set(Array.from(baseAffected).filter((nodeId) => NM[nodeId]));
    G.nodes.forEach((node) => {
      if (node.virtual && node.fuseRec === id) affected.add(node.id);
      if (node.collapsedChildIds?.some((nodeId) => baseAffected.has(nodeId))) affected.add(node.id);
    });
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
    const first = G.nodes.find((node) => affected.has(node.id));
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
    const graph = ensureModelGraph(model);
    if (graphViewMode === 'flat') flatDepth = clampedFlatDepth(graph);
    activeFusionPreviews = new Set(Array.from(activeFusionPreviews).filter((id) => model.recs.includes(id)));
    document.querySelectorAll('.op-model-card').forEach((card) => {
      card.classList.toggle('is-selected', card.dataset.model === key);
    });
    els.topModelChip.textContent = model.name;
    renderActiveGraph();
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
      els.frame.style.setProperty('--ide-cursor-alpha', document.documentElement.dataset.theme === 'light' ? '0.06' : '0.08');
      els.frame.style.setProperty('--ide-dot-opacity', document.documentElement.dataset.theme === 'light' ? '0.08' : '0.10');
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

    // 页签切换交互
    const tabButtons = document.querySelectorAll('.op-tab[role="tab"]');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('aria-controls');
        const targetPanel = document.getElementById(targetId);

        if (!targetPanel) return;

        // 更新所有页签按钮状态
        tabButtons.forEach(b => {
          b.classList.remove('is-active');
          b.setAttribute('aria-selected', 'false');
        });

        // 激活当前页签
        btn.classList.add('is-active');
        btn.setAttribute('aria-selected', 'true');

        // 更新所有面板状态
        document.querySelectorAll('.op-tab-panel').forEach(panel => {
          panel.classList.remove('is-active');
          panel.setAttribute('hidden', '');
        });

        // 显示目标面板
        targetPanel.classList.add('is-active');
        targetPanel.removeAttribute('hidden');
      });
    });

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
      setFusionOverlayVisible(!showBrackets);
    });
    els.viewDrill?.addEventListener('click', () => setGraphViewMode('drill', { preserveView: true }));
    els.viewFlat?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (graphViewMode !== 'flat') {
        setGraphViewMode('flat', { preserveView: true, openMenu: true });
      } else {
        setFlatMenuOpen(!flatMenuOpen);
      }
    });
    els.flatMenu?.addEventListener('click', (event) => event.stopPropagation());

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
    window.addEventListener('resize', () => {
      if (flatMenuOpen) updateGraphControls();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      setFlatMenuOpen(false);
      setLegendOpen(false);
      hideSourcePanel();
    });
    document.addEventListener('click', () => {
      setFlatMenuOpen(false);
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
      viewDrill: document.getElementById('view-drill'),
      viewFlat: document.getElementById('view-flat'),
      flatLabel: document.getElementById('flat-label'),
      flatMenu: document.getElementById('flat-menu'),
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
    if (els.flatMenu && els.flatMenu.parentElement !== document.body) {
      document.body.appendChild(els.flatMenu);
    }
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

(function registerDeepSeekFusionAdvisor(global) {
  "use strict";

  // Fusion-operator recommendation knowledge base for the DeepSeek V3.2 report.
  // Content follows the rules and structure of the PTO op-fusion module
  // (op-fusion/index.html) but is grounded in THIS workload's real profile
  // (data/ds3_2_perf_data.json). Each recommendation carries:
  //   - status  : "opportunity" (not yet fused in this graph) | "applied"
  //               (the fused kernel is already present — kept as coverage/validation)
  //   - prio    : ranked by measured latency impact, not generic priority
  //   - unit    : the Ascend hardware unit(s) the fusion loads (Cube / Vector /
  //               MTE2 / HCCL) — the constraint that makes the fusion worthwhile
  //   - evidence: the measured hotspot from the profile that justifies the card
  //   - constraint: the Ascend prerequisite / limit that gates the fusion
  //   - fused   : the short name of the resulting fused kernel — used as the
  //               group label on the architecture-graph highlight overlay
  //   - flow    : structured before/after pipeline for the visual comparison —
  //               { io:{in,out}, before:[...], after:[...] }. A token is a kernel
  //               name, "hbm" (an HBM round-trip of an intermediate), or
  //               "comm:Label" (a blocking collective). The card derives kernel
  //               count and HBM/comm-hop deltas from these arrays.
  //   - chain / gains / reason / before / after / doc / affects / graphOps
  //
  // `graphOps` are REAL operator names that appear as the dominant op of a node in
  // report-data.js, so the architecture-graph marker lands on the concrete node.
  // Descriptive text is bilingual ({ en, zh }); code, op names, dtype/unit tokens
  // and measured numbers are language-neutral so they read the same in both.

  const CANN_DOC = "https://www.hiascend.com/document/detail/zh/canncommercial/latest/apiref/operatorlist/operatorlist_0000.html";

  const RECS = [
    // ---------------------------------------------------------------------------
    // OPPORTUNITIES — un-fused hotspots in this profile, ordered by latency impact.
    // ---------------------------------------------------------------------------
    {
      id: "mtp_spec_verify",
      status: "opportunity",
      prio: "star",
      title: { en: "MTP speculative-verify fusion (reverse-scan)", zh: "MTP 投机验证融合（反向扫描）" },
      unit: ["Vector", "MTE2"],
      evidence: "spec_token_verify_main · ReverseV2 87.5% · 3.18 ms (35.7% of step)",
      chain: ["Equal", "→", "ReverseV2", "→", "cumsum", "→", "ReverseV2", "→", "ArgMax/Gather", "⇒", "SpecVerify"],
      gains: [
        { label: { en: "HBM traffic −60%", zh: "访存 −60%" }, tone: "mem" },
        { label: { en: "Step −up to 30%", zh: "单步 −最多 30%" }, tone: "tp" },
        { label: { en: "kernel ≈8→1", zh: "kernel ≈8→1" }, tone: "" },
      ],
      reason: {
        en: "This is the workload's single largest hotspot: MTP <code>next_n=3</code> speculative verification runs on <b>spec_token_verify_main</b> and is <b>87.5% ReverseV2</b> — 3.18 ms, 35.7% of the whole step. The accept-mask scan is expressed as <b>ReverseV2 → cumulative op → ReverseV2</b> plus Equal/ArgMaxV2/ConcatD, each a separate Vector/MTE pass that round-trips the <code>[B, next_n+1]</code> mask through HBM. A single fused verify kernel keeps the reverse inclusive-scan and the accepted-token gather on chip, so the reverse-scan stops being a memory-bound bottleneck.",
        zh: "这是整个负载最大的热点：MTP <code>next_n=3</code> 投机验证运行在 <b>spec_token_verify_main</b>，其中 <b>ReverseV2 占 87.5%</b>——3.18 ms，占整步 35.7%。接受掩码扫描被拆成 <b>ReverseV2 → 累积算子 → ReverseV2</b> 再加 Equal/ArgMaxV2/ConcatD，每个都是独立的 Vector/MTE pass，把 <code>[B, next_n+1]</code> 掩码反复往返 HBM。融合为单个 verify kernel 后，反向前缀扫描与接受 token 的 gather 常驻片上，反向扫描不再是访存瓶颈。",
      },
      constraint: {
        en: "Reverse-scan tiling is sequence-length dependent; the fused kernel must carry the running accept count across next_n+1 candidates. Best written as an AscendC custom op — no shipped aclnn covers the speculative-verify pattern yet.",
        zh: "反向扫描 tiling 依赖序列长度；融合核需在 next_n+1 个候选间维护累计接受数。建议用 AscendC 自定义算子实现——目前没有现成 aclnn 覆盖该投机验证模式。",
      },
      affects: ["ReverseV2", "ArgMaxV2"],
      graphOps: ["ReverseV2", "ArgMaxV2"],
      fused: "SpecVerify",
      flow: {
        io: { in: "draft / target", out: "next_tok" },
        before: ["Equal", "hbm", "ReverseV2", "hbm", "cumsum", "hbm", "ReverseV2", "hbm", "Gather"],
        after: ["SpecVerify"],
      },
      doc: "cann-ops custom (AscendC): spec_verify / reverse-scan",
      before: [
        "# framework: reversed accept-scan as many vector ops",
        "acc = (draft == target)          # Equal",
        "run = ReverseV2(cumsum(ReverseV2(acc)))",
        "n_accept = (run == arange).sum(-1)",
        "next_tok = gather(draft, n_accept)  # ArgMaxV2/Gather",
      ],
      after: [
        "// Ascend: one fused speculative-verify kernel,",
        "// reverse inclusive-scan + gather stay on chip",
        "aclnnSpecVerify(draft, target,",
        "                &n_accept, &next_tok);",
      ],
    },
    {
      id: "mc2_matmul_comm",
      status: "opportunity",
      prio: "star",
      title: { en: "MC2: TP Matmul + collective fusion (comm masking)", zh: "MC2：TP Matmul + 集合通信融合（通信掩盖）" },
      unit: ["Cube", "HCCL"],
      evidence: "step_start_init 0.96 ms (65% AllReduce) · eh_proj 0.26 ms MatMul · lm_head AllGather→MatMul standalone",
      chain: ["MatMul", "→", "AllReduce / AllGather / ReduceScatter", "⇒", "MatmulAllReduce / AllGatherMatmul"],
      gains: [
        { label: { en: "Comm hidden", zh: "通信被掩盖" }, tone: "mem" },
        { label: { en: "Step −~1 ms", zh: "单步 −~1 ms" }, tone: "tp" },
        { label: { en: "Cube stall ↓", zh: "Cube 空转 ↓" }, tone: "" },
      ],
      reason: {
        en: "Tensor-parallel projections here run the GEMM and its collective as <b>separate, blocking</b> ops: <b>step_start_init</b> is 0.96 ms with 65% <code>hcom_allReduce_</code>, <b>eh_proj</b> is 0.26 ms of standalone MatMul, and lm_head does <code>HcomAllGather → MatMul → HcomAllToAll</code> back to back. The Cube unit stalls while HCCL drains the link. Ascend <b>MC2</b> fused ops (<b>MatmulAllReduce / AllGatherMatmul / MatmulReduceScatter</b>) split the GEMM along K/N and pipeline each collective chunk behind the matching Cube tile, so the HCCS/RoCE transfer hides under compute instead of serializing after it.",
        zh: "这里的张量并行投影把 GEMM 与集合通信当作<b>独立、阻塞</b>的算子执行：<b>step_start_init</b> 0.96 ms，其中 <code>hcom_allReduce_</code> 占 65%；<b>eh_proj</b> 是 0.26 ms 的独立 MatMul；lm_head 则是 <code>HcomAllGather → MatMul → HcomAllToAll</code> 串行。HCCL 排空链路时 Cube 空转。昇腾 <b>MC2</b> 融合算子（<b>MatmulAllReduce / AllGatherMatmul / MatmulReduceScatter</b>）沿 K/N 切分 GEMM，把每个通信分片流水到对应的 Cube tile 之后，使 HCCS/RoCE 传输隐藏在计算之下，而非串行等待。",
      },
      constraint: {
        en: "Needs a TP communication group over HCCS / RoCE and MC2 support (Atlas 800T A2 / 900 A3). The K (AllGather) or N (ReduceScatter) axis must tile large enough that a collective chunk overlaps one Cube step; tiny GEMMs (gate, single-token decode) may not amortize the setup.",
        zh: "需要基于 HCCS / RoCE 的 TP 通信组与 MC2 支持（Atlas 800T A2 / 900 A3）。K（AllGather）或 N（ReduceScatter）轴切分需足够大，使单个通信分片能与一个 Cube step 重叠；过小的 GEMM（gate、单 token decode）可能无法摊薄启动开销。",
      },
      affects: ["MatMul", "hcom_allReduce_", "HcomAllGather", "HcomReduceScatter"],
      graphOps: ["MatMul", "HcomAllGather", "HcomReduceScatter", "hcom_allReduce_"],
      fused: "MatmulAllReduce",
      flow: {
        io: { in: "x (TP shard)", out: "y (full)" },
        before: ["MatMul", "comm:AllReduce"],
        after: ["MatmulAllReduce"],
      },
      doc: "aclnnMatmulAllReduce / aclnnAllGatherMatmul (cann-ops-adv: mc2)",
      before: [
        "# framework: TP matmul then blocking collective",
        "y = torch.matmul(x, w_tp)     # Cube",
        "y = all_reduce(y)             # HCCL waits on Cube",
        "xg = all_gather(x)            # lm_head",
        "logits = torch.matmul(xg, w_vocab)",
      ],
      after: [
        "// Ascend MC2: GEMM tiles pipeline the collective",
        "aclnnMatmulAllReduce(x, w_tp, hcom, &y);",
        "aclnnAllGatherMatmul(x, w_vocab, hcom,",
        "                     &logits);",
      ],
    },
    {
      id: "transpose_cast_epilogue",
      status: "opportunity",
      prio: "medium",
      title: { en: "Fold Transpose + Cast into Matmul epilogue", zh: "Transpose + Cast 折叠进 Matmul 尾处理" },
      unit: ["MTE2", "Vector"],
      evidence: "Transpose ≈0.40 ms + Cast ≈0.16 ms standalone (vocab_reshape 100% Transpose)",
      chain: ["Transpose", "→", "Cast", "→", "MatMul", "⇒", "MatMul(transpose_x, out_dtype)"],
      gains: [
        { label: { en: "MTE2 traffic ↓", zh: "MTE2 搬运 ↓" }, tone: "mem" },
        { label: { en: "kernel count ↓", zh: "kernel 数 ↓" }, tone: "tp" },
      ],
      reason: {
        en: "Roughly <b>0.40 ms of Transpose and 0.16 ms of Cast</b> run as standalone Vector/MTE ops around the projections — e.g. <b>vocab_reshape is 100% Transpose</b> feeding the vocab GEMM, and casts sit between quantized stages. Each writes a full tensor back to HBM only for the next Cube op to read it again. Folding the layout change into the consumer matmul (transpose_x / NZ input) and the dtype change into the producer's output cast removes those round-trips: the Cube reads the transposed tile directly and the epilogue emits the target dtype.",
        zh: "投影前后约有 <b>0.40 ms 的 Transpose 与 0.16 ms 的 Cast</b> 以独立 Vector/MTE 算子运行——例如 <b>vocab_reshape 100% 是 Transpose</b>，直接喂给 vocab GEMM，量化阶段之间也夹着 Cast。每个都把整块张量写回 HBM，仅供下一个 Cube 算子再读一遍。把布局变换折叠进消费侧矩阵乘（transpose_x / NZ 输入）、把 dtype 变换折叠进生产者的输出 cast，即可消除这些往返：Cube 直接读转置后的 tile，尾处理阶段直接输出目标 dtype。",
      },
      constraint: {
        en: "Transpose folds only when the consumer is a Cube op that accepts a transposed / FRACTAL_NZ input; a Cast folds only when the producing op exposes an output-dtype parameter. Standalone Transpose feeding a Vector-only consumer cannot be absorbed this way.",
        zh: "仅当消费者是可接受转置 / FRACTAL_NZ 输入的 Cube 算子时，Transpose 才能折叠；仅当生产算子暴露输出 dtype 参数时，Cast 才能折叠。喂给纯 Vector 消费者的独立 Transpose 无法以此方式吸收。",
      },
      affects: ["Transpose", "Cast"],
      graphOps: ["Transpose", "Cast"],
      fused: "Matmul (transpose_x + cast)",
      flow: {
        io: { in: "h", out: "logits" },
        before: ["Transpose", "hbm", "Cast", "hbm", "MatMul"],
        after: ["MatMul"],
      },
      doc: "aclnnMatmul (transpose_x2 / output dtype epilogue)",
      before: [
        "# framework: standalone reshape/transpose + cast",
        "h = h.transpose(1, 2).contiguous()  # Transpose",
        "h = h.to(torch.bfloat16)            # Cast",
        "logits = torch.matmul(h, w)         # Cube reads ND",
      ],
      after: [
        "// Ascend: transpose folded into NZ input,",
        "// cast folded into the matmul epilogue",
        "aclnnMatmul(h_nz, w, /*transpose_x=*/true,",
        "            /*out_dtype=*/BF16, &logits);",
      ],
    },

    // ---------------------------------------------------------------------------
    // APPLIED — fused kernels already present in this graph. Shown as coverage so
    // the panel reflects what is done, not just what is left; markers validate them
    // on the architecture graph.
    // ---------------------------------------------------------------------------
    {
      id: "mla_prolog",
      status: "applied",
      prio: "star",
      title: { en: "MLA prolog fusion (down/up proj + RoPE)", zh: "MLA prolog 融合（下投影/上投影 + RoPE）" },
      unit: ["Cube", "Vector"],
      evidence: "MlaPrologV3 0.78 ms — RMSNorm + down/up proj + RoPE fused in one kernel",
      chain: ["RMSNorm", "→", "q/kv down", "→", "up proj", "→", "RoPE", "⇒", "MlaPrologV3"],
      gains: [
        { label: { en: "HBM traffic −45%", zh: "访存 −45%" }, tone: "mem" },
        { label: { en: "kernel 5→1", zh: "kernel 5→1" }, tone: "tp" },
      ],
      reason: {
        en: "DeepSeek MLA compresses Q/KV through a low-rank down projection, an up projection, and a decoupled RoPE branch. This graph already runs it as <b>MlaPrologV3</b> (0.78 ms): the RMSNorm, the down/up projections and the RoPE are fused into one prolog kernel that hands the attention core a ready Q/K/V tile instead of spilling every small matmul to HBM. Kept here as validated coverage.",
        zh: "DeepSeek MLA 通过低秩下投影、上投影与解耦 RoPE 分支压缩 Q/KV。本图已用 <b>MlaPrologV3</b>（0.78 ms）实现：RMSNorm、下投影/上投影与 RoPE 融合为单个 prolog kernel，直接向注意力核输出就绪的 Q/K/V tile，而非把每个小矩阵乘落 HBM。此处作为已验证的覆盖保留。",
      },
      constraint: {
        en: "Weights must be pre-quantized/packed for the fused prolog; the decoupled RoPE dim (rope vs. nope split) has to match the attention core's expected layout.",
        zh: "权重需为融合 prolog 预先量化/打包；解耦 RoPE 维度（rope 与 nope 切分）必须与注意力核期望的布局一致。",
      },
      affects: ["MlaPrologV3", "RmsNorm", "RotaryMul"],
      graphOps: ["MlaPrologV3", "RotaryMul"],
      fused: "MlaPrologV3",
      flow: {
        io: { in: "hidden", out: "q / k / v" },
        before: ["down_proj", "hbm", "q/kv_norm", "hbm", "up_proj", "hbm", "RoPE"],
        after: ["MlaPrologV3"],
      },
      doc: "aclnnMlaProlog / cann-ops-adv: mla_prolog",
      before: [
        "# framework: MLA prolog as separate ops",
        "c = self.kv_a_norm(self.kv_a_proj(h))",
        "kv = self.kv_b_proj(c)",
        "q = self.q_b_proj(self.q_a_norm(self.q_a_proj(h)))",
        "q, k = self.rotary_emb(pos, q, k)",
      ],
      after: [
        "// Ascend: single prolog kernel feeds MLA core",
        "aclnnMlaProlog(h, wq_a, wq_b, wkv_a, wkv_b,",
        "               gamma_q, gamma_kv, cos, sin,",
        "               &q_out, &k_out, &v_out);",
      ],
    },
    {
      id: "dsa_sparse_attention",
      status: "applied",
      prio: "star",
      title: { en: "DSA sparse attention (indexer + sparse FlashAttn)", zh: "DSA 稀疏注意力（索引器 + 稀疏 FlashAttn）" },
      unit: ["Cube", "Vector"],
      evidence: "LightningIndexerQuant 0.62 ms → KvQuantSparseFlashAttention 0.94 ms",
      chain: ["Lightning indexer", "→", "top-k KV select", "→", "sparse FlashAttn over INT8 KV", "⇒", "KvQuantSparseFlashAttention"],
      gains: [
        { label: { en: "Attn FLOPs ↓ (sparse)", zh: "注意力 FLOPs ↓（稀疏）" }, tone: "mem" },
        { label: { en: "KV cache INT8", zh: "KV cache INT8" }, tone: "tp" },
      ],
      reason: {
        en: "The V3.2 signature: DeepSeek Sparse Attention. The <b>LightningIndexerQuant</b> op (0.62 ms) scores a lightweight index and picks the top-k KV blocks, then <b>KvQuantSparseFlashAttention</b> (0.94 ms) runs a FlashAttention-style kernel over only those blocks with an INT8-quantized KV cache. Selection + sparse attention + KV dequant stay fused so scores never leave on-chip buffers. Already present in this graph.",
        zh: "V3.2 的标志性特征：DeepSeek 稀疏注意力。<b>LightningIndexerQuant</b>（0.62 ms）对轻量索引打分并选出 top-k KV 块，随后 <b>KvQuantSparseFlashAttention</b>（0.94 ms）仅对这些块运行 FlashAttention 风格核，KV cache 为 INT8 量化。选择 + 稀疏注意力 + KV 反量化保持融合，注意力分数不离开片上缓存。本图已具备。",
      },
      constraint: {
        en: "Sparse block table must be produced before the attention core; INT8 KV needs a paired per-block dequant scale. Indexer top-k width trades recall for FLOPs — too small degrades quality, too large loses the sparsity win.",
        zh: "稀疏 block table 需在注意力核之前产生；INT8 KV 需配套逐块 dequant scale。索引器 top-k 宽度在召回与 FLOPs 间权衡——过小损精度，过大丧失稀疏收益。",
      },
      affects: ["LightningIndexerQuant", "KvQuantSparseFlashAttention"],
      graphOps: ["LightningIndexerQuant", "KvQuantSparseFlashAttention"],
      fused: "KvQuantSparseFlashAttention",
      flow: {
        io: { in: "q / k", out: "attn_out" },
        before: ["indexer_score", "hbm", "topk", "hbm", "gather_kv", "hbm", "FlashAttn"],
        after: ["LightningIndexerQuant", "KvQuantSparseFlashAttention"],
      },
      doc: "aclnnKvQuantSparseFlashAttention / cann-ops-adv: lightning_indexer",
      before: [
        "# framework: dense attention, no index select",
        "idx = topk(indexer_score(q, k), k_sel)",
        "k_s, v_s = gather(k, idx), gather(v, idx)",
        "attn = flash_attention(q, k_s, v_s)",
      ],
      after: [
        "// Ascend: indexer + sparse FA over INT8 KV",
        "aclnnLightningIndexerQuant(q, k, w, &idx);",
        "aclnnKvQuantSparseFlashAttention(",
        "    q, k_int8, v_int8, kv_scale, idx, &attn);",
      ],
    },
    {
      id: "moe_grouped",
      status: "applied",
      prio: "high",
      title: { en: "MoE routing + GroupedMatmul + dispatch/combine", zh: "MoE 路由 + GroupedMatmul + dispatch/combine" },
      unit: ["Cube", "HCCL"],
      evidence: "GroupedMatmul 4.06 ms · MoeGatingTopKHash + MoeDistributeDispatchV2/CombineV2 present",
      chain: ["gating top-k", "→", "dispatch (A2A)", "→", "grouped expert GEMM", "→", "combine (A2A)", "⇒", "GroupedMatmul + MoeDistribute*"],
      gains: [
        { label: { en: "Zero padding", zh: "零 padding" }, tone: "mem" },
        { label: { en: "EP comm overlapped", zh: "EP 通信重叠" }, tone: "tp" },
      ],
      reason: {
        en: "With 256 routed experts each token activates only top-k. This graph already fuses the path: <b>MoeGatingTopKHash</b> routes tokens, <b>MoeDistributeDispatchV2/CombineV2</b> fuse the all-to-all permutation with the HCCL transfer, and <b>GroupedMatmul</b> (4.06 ms — the MoE compute core) groups variable-length tokens by <code>group_list</code> for one padding-free grouped GEMM that keeps the Cube saturated. Kept as coverage.",
        zh: "256 个路由专家下每个 token 仅激活 top-k。本图已融合该路径：<b>MoeGatingTopKHash</b> 路由 token，<b>MoeDistributeDispatchV2/CombineV2</b> 将 all-to-all 重排与 HCCL 传输融合，<b>GroupedMatmul</b>（4.06 ms——MoE 计算核）按 <code>group_list</code> 对变长 token 分组，一次性发起无 padding 的分组 GEMM 保持 Cube 满载。作为覆盖保留。",
      },
      constraint: {
        en: "Expert-parallel MoE needs an EP group and enough experts per rank to overlap dispatch/combine with expert compute; group_list must be built on-device to avoid a host sync stall.",
        zh: "专家并行 MoE 需要 EP 通信组，且每 rank 专家数足够多，才能让 dispatch/combine 与专家计算重叠；group_list 需在片上构建以避免 host 同步阻塞。",
      },
      affects: ["MoeGatingTopKHash", "GroupedMatmul", "MoeDistributeDispatchV2", "MoeDistributeCombineV2"],
      graphOps: ["MoeGatingTopKHash", "GroupedMatmul", "MoeDistributeDispatchV2", "MoeDistributeCombineV2"],
      fused: "GroupedMatmul + MoeDistribute*",
      flow: {
        io: { in: "tokens", out: "out" },
        before: ["gate", "hbm", "topk", "comm:AllToAll", "expert GEMM", "comm:AllToAll", "combine"],
        after: ["MoeGatingTopKHash", "MoeDistributeDispatchV2", "GroupedMatmul", "MoeDistributeCombineV2"],
      },
      doc: "aclnnGroupedMatmul / aclnnMoeDistributeDispatchV2 (cann-ops-adv / cann-hccl)",
      before: [
        "# framework: gate, per-expert loop, blocking a2a",
        "topk = torch.topk(self.gate(hidden), k)",
        "x = all_to_all(dispatch(hidden, topk))",
        "y = grouped_experts(x, w1, w2)",
        "out = combine(all_to_all(y), topk)",
      ],
      after: [
        "// Ascend: routing + grouped GEMM + fused a2a",
        "aclnnMoeGatingTopKHash(logits, k, &group_list);",
        "aclnnMoeDistributeDispatchV2(hidden, topk, &x);",
        "aclnnGroupedMatmul(x, w, group_list, &y);",
        "aclnnMoeDistributeCombineV2(y, topk, &out);",
      ],
    },
    {
      id: "dequant_swiglu_quant",
      status: "applied",
      prio: "high",
      title: { en: "Dequant + SwiGLU + Quant fusion", zh: "Dequant + SwiGLU + Quant 融合" },
      unit: ["Vector"],
      evidence: "DequantSwigluQuant 0.33 ms — dequant + SiLU·up + requant in one Vector pass",
      chain: ["gate/up dequant", "→", "SiLU × up", "→", "requant", "⇒", "DequantSwigluQuant"],
      gains: [
        { label: { en: "HBM traffic −32%", zh: "访存 −32%" }, tone: "mem" },
        { label: { en: "kernel 3→1", zh: "kernel 3→1" }, tone: "tp" },
      ],
      reason: {
        en: "The FP8 MLP dequantizes the fused gate/up GEMM output, applies <b>SiLU(gate) · up</b>, then requantizes for the down projection. This graph already runs it as one op — <b>DequantSwigluQuant</b> (0.33 ms) — keeping the dequant scale, the SwiGLU activation and the per-token requant in a single Vector pass so only the FP8 result leaves the core instead of the intermediate activation round-tripping HBM twice.",
        zh: "FP8 MLP 先对融合的 gate/up GEMM 输出反量化，再做 <b>SiLU(gate) · up</b>，然后为下投影重新量化。本图已用单算子 <b>DequantSwigluQuant</b>（0.33 ms）实现：反量化 scale、SwiGLU 激活与逐 token 重量化并入一段 Vector 执行，只有 FP8 结果离开计算核，而非让中间激活两次往返 HBM。",
      },
      constraint: {
        en: "Input must be the packed gate|up layout the fused op expects; per-token requant scale is emitted alongside and must feed the down-projection QuantBatchMatmul.",
        zh: "输入需为融合算子期望的 gate|up 打包布局；逐 token 重量化 scale 随输出产出，需喂给下投影的 QuantBatchMatmul。",
      },
      affects: ["DequantSwigluQuant", "DynamicQuant"],
      graphOps: ["DequantSwigluQuant"],
      fused: "DequantSwigluQuant",
      flow: {
        io: { in: "gate_up (int8)", out: "y_fp8" },
        before: ["dequant", "hbm", "SwiGLU", "hbm", "quant"],
        after: ["DequantSwigluQuant"],
      },
      doc: "aclnnDequantSwigluQuant / ops: dequant_swiglu_quant",
      before: [
        "# framework: dequant / act / quant split",
        "x = gate_up.to(torch.bfloat16) * scale",
        "x = F.silu(x[..., :d]) * x[..., d:]",
        "x, s = per_token_quant(x)",
      ],
      after: [
        "// Ascend: dequant + swiglu + requant fused",
        "aclnnDequantSwigluQuant(gate_up, in_scale,",
        "                        &out_fp8, &out_scale);",
      ],
    },
    {
      id: "add_rmsnorm_cast",
      status: "applied",
      prio: "high",
      title: { en: "Residual Add + RMSNorm + Cast/Quant fusion", zh: "残差 Add + RMSNorm + Cast/Quant 融合" },
      unit: ["Vector"],
      evidence: "AddRmsNormCast + InplaceAddRmsNorm + AddRmsNormDynamicQuant all present",
      chain: ["residual", "+", "hidden", "→", "RMSNorm", "→", "cast/quant", "⇒", "AddRmsNorm{Cast,DynamicQuant}"],
      gains: [
        { label: { en: "HBM traffic −38%", zh: "访存 −38%" }, tone: "mem" },
        { label: { en: "kernel 3→1", zh: "kernel 3→1" }, tone: "tp" },
      ],
      reason: {
        en: "Every decoder layer starts with <b>residual add → RMSNorm → cast/quant</b> before the FP8 projections. Run separately, the add result and the normalized tensor each round-trip HBM. This graph already fuses all three variants — <b>AddRmsNormCast</b>, <b>InplaceAddRmsNorm</b> and <b>AddRmsNormDynamicQuant</b> — keeping the residual sum on chip, folding the quant/cast into the same pass, and emitting both the new residual and the FP8/INT8 activation in one kernel.",
        zh: "每个 decoder layer 入口都是 <b>residual add → RMSNorm → cast/quant</b> 再进入 FP8 投影。分开执行时，加法结果与归一化张量都要往返 HBM。本图已融合三种变体——<b>AddRmsNormCast</b>、<b>InplaceAddRmsNorm</b>、<b>AddRmsNormDynamicQuant</b>——残差和驻留片上，量化/cast 并入同一段执行，单 kernel 同时产出新残差与 FP8/INT8 激活。",
      },
      constraint: {
        en: "gamma stays FP32 and the reduction runs in FP32 regardless of I/O dtype; the fused op must emit the updated residual as a second output for the next layer's add.",
        zh: "gamma 保持 FP32，规约无论输入输出精度均以 FP32 进行；融合算子需将更新后的残差作为第二输出产出，供下一层的 add 使用。",
      },
      affects: ["AddRmsNormCast", "InplaceAddRmsNorm", "AddRmsNormDynamicQuant"],
      graphOps: ["AddRmsNormCast", "InplaceAddRmsNorm", "AddRmsNormDynamicQuant"],
      fused: "AddRmsNormCast",
      flow: {
        io: { in: "x + residual", out: "y_fp8" },
        before: ["Add", "hbm", "RMSNorm", "hbm", "Cast"],
        after: ["AddRmsNormCast"],
      },
      doc: "aclnnAddRmsNormCast / add_rms_norm_dynamic_quant",
      before: [
        "# framework: add / norm / cast in three steps",
        "hidden = residual + hidden",
        "hidden = self.input_layernorm(hidden)",
        "hidden = hidden.to(torch.float8_e4m3fn)",
      ],
      after: [
        "// Ascend: one kernel, residual stays on chip",
        "aclnnAddRmsNormCast(x, residual, gamma, eps,",
        "                    &y_fp8, &new_residual);",
      ],
    },
    {
      id: "quant_batch_matmul",
      status: "applied",
      prio: "medium",
      title: { en: "Quant + BatchMatmul fusion", zh: "Quant + BatchMatmul 融合" },
      unit: ["Cube"],
      evidence: "QuantBatchMatmulV3 3.61 ms · dominant op of 15 projection nodes",
      chain: ["quant", "→", "batched GEMM", "→", "dequant", "⇒", "QuantBatchMatmulV3"],
      gains: [
        { label: { en: "HBM traffic −25%", zh: "访存 −25%" }, tone: "mem" },
        { label: { en: "epilogue dequant", zh: "尾处理反量化" }, tone: "tp" },
      ],
      reason: {
        en: "The W8A8 projections are the model's main GEMM cost: <b>QuantBatchMatmulV3</b> is the dominant op of 15 nodes and 3.61 ms total. It already folds the input quant and the per-channel output dequant into the Cube epilogue, so only the final tensor is written back instead of the low-precision tensor and its scales round-tripping HBM. Kept as coverage of the projection core.",
        zh: "W8A8 投影是模型主要的 GEMM 开销：<b>QuantBatchMatmulV3</b> 是 15 个节点的主导算子，合计 3.61 ms。它已将输入量化与 per-channel 输出反量化折叠进 Cube 尾处理，只写回最终张量，而非让低精度张量与 scale 往返 HBM。作为投影核的覆盖保留。",
      },
      constraint: {
        en: "Weights need NZ (FRACTAL_NZ) layout to saturate MTE2; INT8 accumulation is FP32 on chip and requires a matching per-channel/per-token dequant scale from the upstream quant op.",
        zh: "权重需 NZ（FRACTAL_NZ）布局以打满 MTE2；INT8 累加在片上以 FP32 进行，需上游量化算子提供匹配的 per-channel/per-token 反量化 scale。",
      },
      affects: ["QuantBatchMatmulV3", "DynamicQuant"],
      graphOps: ["QuantBatchMatmulV3"],
      fused: "QuantBatchMatmulV3",
      flow: {
        io: { in: "x", out: "y" },
        before: ["quant", "hbm", "BatchMatMul", "hbm", "dequant"],
        after: ["QuantBatchMatmulV3"],
      },
      doc: "aclnnQuantBatchMatmulV3 / ops: quant_batch_matmul",
      before: [
        "# framework: quant / matmul / dequant",
        "xq, s = per_token_quant(x)",
        "y = torch.bmm(xq, wq)",
        "y = y.to(torch.bfloat16) * s * w_scale",
      ],
      after: [
        "// Ascend: quant + bmm + dequant in one op",
        "aclnnQuantBatchMatmulV3(x, w, x_scale, w_scale,",
        "                        &y);",
      ],
    },
  ];

  global.DeepSeekFusionAdvisor = { RECS, CANN_DOC };
})(window);

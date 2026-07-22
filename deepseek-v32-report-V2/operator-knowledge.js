(function registerDeepSeekOperatorKnowledge(global) {
  "use strict";

  // Curated operator reference for the inspector detail tabs (definition / support /
  // precision / API). The backend profiling JSON only carries runtime metrics, so this
  // module supplies the semantic reference layer. Descriptive text is bilingual
  // ({ en, zh }); technical tokens (formulas, dtype names, URLs) are language-neutral.
  //
  // Each operator entry inherits a CATEGORY default and overrides only what it needs.
  // Uncurated operators fall back to a category inferred from their name so every
  // operator still fills all four tabs with sensible content.

  const CANN_DOC = "https://www.hiascend.com/document/detail/zh/canncommercial/latest/apiref/operatorlist/operatorlist_0000.html";

  const CATEGORY_DEFAULTS = {
    matmul: {
      label: { en: "Matrix multiplication", zh: "矩阵乘" },
      hardware: ["Atlas 800T A2", "Atlas 900 A3 SuperPoD", "Atlas 300I Duo"],
      dtypes: ["FP16", "BF16", "INT8", "FP32(累加)"],
      formats: ["ND", "NZ (FRACTAL_NZ)"],
      supportNotes: {
        en: "Runs on the Cube unit; NZ layout on the weight side maximizes MTE2 throughput.",
        zh: "运行在 Cube 计算单元，权重侧使用 NZ 格式可最大化 MTE2 搬运吞吐。",
      },
      precisionMode: { en: "High-precision / high-performance dual mode", zh: "高精度 / 高性能双模式" },
      precisionError: "≤ 2⁻⁸ relative (FP16), FP32 accumulation",
      precisionNotes: {
        en: "FP32 accumulation on chip keeps large-K reductions stable; INT8 needs a paired dequant scale.",
        zh: "片上 FP32 累加保证大 K 规约稳定；INT8 需配套 dequant scale。",
      },
      docs: [{ label: { en: "MatMul operator spec", zh: "MatMul 算子规格" }, url: CANN_DOC }],
      repos: [{ label: "ascend/cann-ops-adv", url: "https://gitee.com/ascend/cann-ops-adv" }],
    },
    norm: {
      label: { en: "Normalization", zh: "归一化" },
      hardware: ["Atlas 800T A2", "Atlas 900 A3 SuperPoD", "Atlas 300I Duo"],
      dtypes: ["FP16", "BF16", "FP32"],
      formats: ["ND"],
      supportNotes: {
        en: "Vector-unit op; reductions run in FP32 regardless of the I/O dtype.",
        zh: "Vector 单元算子；无论输入输出精度，规约过程均以 FP32 进行。",
      },
      precisionMode: { en: "FP32 reduction", zh: "FP32 规约" },
      precisionError: "≤ 2⁻¹⁰ relative",
      precisionNotes: {
        en: "gamma/beta stay in FP32; only the final cast drops to FP16/BF16.",
        zh: "gamma/beta 保持 FP32，仅在输出阶段 cast 回 FP16/BF16。",
      },
      docs: [{ label: { en: "RmsNorm operator spec", zh: "RmsNorm 算子规格" }, url: CANN_DOC }],
      repos: [{ label: "ascend/cann-ops-adv", url: "https://gitee.com/ascend/cann-ops-adv" }],
    },
    elementwise: {
      label: { en: "Element-wise / shape", zh: "逐元素 / 形状变换" },
      hardware: ["Atlas 800T A2", "Atlas 900 A3 SuperPoD", "Atlas 300I Duo"],
      dtypes: ["FP16", "BF16", "FP32", "INT32", "BOOL"],
      formats: ["ND"],
      supportNotes: {
        en: "Vector / MTE bound; supports broadcasting on the trailing dimensions.",
        zh: "Vector / MTE 受限；支持尾部维度广播。",
      },
      precisionMode: { en: "Bit-exact / element-wise", zh: "逐元素 / 位精确" },
      precisionError: "0 (shape ops) · ≤ 2⁻¹¹ relative (arithmetic)",
      precisionNotes: {
        en: "Pure data-movement ops are lossless; arithmetic ops match the I/O dtype.",
        zh: "纯搬运类算子无损；算术类算子精度与输入输出数据类型一致。",
      },
      docs: [{ label: { en: "Element-wise operators", zh: "逐元素算子" }, url: CANN_DOC }],
      repos: [{ label: "ascend/cann-ops", url: "https://gitee.com/ascend/cann-ops" }],
    },
    quant: {
      label: { en: "Quantization", zh: "量化" },
      hardware: ["Atlas 800T A2", "Atlas 900 A3 SuperPoD", "Atlas 300I Duo"],
      dtypes: ["FP16→INT8", "BF16→INT8", "per-token / per-channel scale"],
      formats: ["ND"],
      supportNotes: {
        en: "Emits an INT8 tensor plus a dequant scale consumed by the next matmul.",
        zh: "输出 INT8 张量与 dequant scale，供后续矩阵乘反量化使用。",
      },
      precisionMode: { en: "Dynamic per-token quantization", zh: "动态 per-token 量化" },
      precisionError: "≤ 1% end-to-end on calibrated ranges",
      precisionNotes: {
        en: "Dynamic scale limits outlier clipping; static scale is faster but needs calibration.",
        zh: "动态 scale 抑制离群点截断；静态 scale 更快但需离线校准。",
      },
      docs: [{ label: { en: "Quantization operators", zh: "量化算子" }, url: CANN_DOC }],
      repos: [{ label: "ascend/cann-ops-adv", url: "https://gitee.com/ascend/cann-ops-adv" }],
    },
    attention: {
      label: { en: "Attention (fused)", zh: "注意力（融合）" },
      hardware: ["Atlas 800T A2", "Atlas 900 A3 SuperPoD"],
      dtypes: ["FP16", "BF16", "INT8 (KV)"],
      formats: ["ND"],
      supportNotes: {
        en: "Fused FlashAttention-style kernel; tiles Q·Kᵀ·V to keep scores in on-chip buffers.",
        zh: "FlashAttention 风格融合核；对 Q·Kᵀ·V 分块，使注意力分数常驻片上缓存。",
      },
      precisionMode: { en: "Online-softmax, FP32 statistics", zh: "在线 softmax，FP32 统计量" },
      precisionError: "≤ 2⁻⁸ relative vs. FP32 reference",
      precisionNotes: {
        en: "Running max/sum kept in FP32 for numerical stability; KV may be INT8 quantized.",
        zh: "running max/sum 以 FP32 维护以保证数值稳定；KV 可 INT8 量化。",
      },
      docs: [{ label: { en: "Fused Attention operators", zh: "融合注意力算子" }, url: CANN_DOC }],
      repos: [{ label: "ascend/cann-ops-adv", url: "https://gitee.com/ascend/cann-ops-adv" }],
    },
    moe: {
      label: { en: "MoE routing / expert", zh: "MoE 路由 / 专家" },
      hardware: ["Atlas 800T A2", "Atlas 900 A3 SuperPoD"],
      dtypes: ["FP16", "BF16", "INT8"],
      formats: ["ND"],
      supportNotes: {
        en: "Token dispatch/combine fuses gating, permutation and grouped matmul across experts.",
        zh: "token dispatch/combine 将门控、重排与分组矩阵乘跨专家融合执行。",
      },
      precisionMode: { en: "TopK gating in FP32", zh: "TopK 门控 FP32" },
      precisionError: "gating exact · expert compute ≤ 2⁻⁸",
      precisionNotes: {
        en: "Routing indices are exact; expert GEMMs follow the matmul precision policy.",
        zh: "路由索引精确无误；专家 GEMM 遵循矩阵乘精度策略。",
      },
      docs: [{ label: { en: "MoE operators", zh: "MoE 算子" }, url: CANN_DOC }],
      repos: [{ label: "ascend/cann-ops-adv", url: "https://gitee.com/ascend/cann-ops-adv" }],
    },
    comm: {
      label: { en: "Collective communication", zh: "集合通信" },
      hardware: ["Atlas 900 A3 SuperPoD", "Atlas 800T A2 (HCCS/RoCE)"],
      dtypes: ["FP16", "BF16", "FP32", "INT8"],
      formats: ["ND"],
      supportNotes: {
        en: "HCCL collective over HCCS / RoCE; overlaps with compute on a dedicated stream.",
        zh: "基于 HCCL 的集合通信，走 HCCS / RoCE，占用独立 stream 与计算重叠。",
      },
      precisionMode: { en: "Lossless transport", zh: "无损传输" },
      precisionError: "0 (transport) · sum order-dependent",
      precisionNotes: {
        en: "Data movement is lossless; reduce ops may reorder float accumulation across ranks.",
        zh: "数据搬运无损；reduce 类操作在多 rank 间浮点累加顺序可能变化。",
      },
      docs: [{ label: { en: "HCCL collective operators", zh: "HCCL 集合通信算子" }, url: CANN_DOC }],
      repos: [{ label: "ascend/cann-hccl", url: "https://gitee.com/ascend/cann-hccl" }],
    },
    misc: {
      label: { en: "General operator", zh: "通用算子" },
      hardware: ["Atlas 800T A2", "Atlas 900 A3 SuperPoD", "Atlas 300I Duo"],
      dtypes: ["FP16", "BF16", "FP32", "INT32"],
      formats: ["ND"],
      supportNotes: {
        en: "Standard AI Core / Vector operator with ND layout support.",
        zh: "标准 AI Core / Vector 算子，支持 ND 布局。",
      },
      precisionMode: { en: "Matches I/O dtype", zh: "与输入输出精度一致" },
      precisionError: "≤ 2⁻¹⁰ relative",
      precisionNotes: {
        en: "No dedicated high-precision path; accuracy tracks the requested dtype.",
        zh: "无专用高精度通路，精度随请求的数据类型变化。",
      },
      docs: [{ label: { en: "CANN operator list", zh: "CANN 算子清单" }, url: CANN_DOC }],
      repos: [{ label: "ascend/cann-ops", url: "https://gitee.com/ascend/cann-ops" }],
    },
  };

  const io = (name, dtype, en, zh) => ({ name, dtype, desc: { en, zh } });

  const OPERATORS = {
    MatMul: {
      category: "matmul",
      summary: { en: "Dense matrix multiplication C = A·B.", zh: "稠密矩阵乘 C = A·B。" },
      formula: "C[m,n] = Σ_k A[m,k] · B[k,n]",
      inputs: [
        io("x1 (A)", "FP16/BF16/INT8", "Left matrix [M, K].", "左矩阵 [M, K]。"),
        io("x2 (B)", "FP16/BF16/INT8", "Right matrix [K, N], often NZ.", "右矩阵 [K, N]，通常为 NZ 格式。"),
      ],
      outputs: [io("y (C)", "FP16/BF16/FP32", "Result matrix [M, N].", "结果矩阵 [M, N]。")],
    },
    QuantBatchMatmulV3: {
      category: "matmul",
      summary: { en: "INT8 batched matmul with fused dequant.", zh: "融合反量化的 INT8 批量矩阵乘。" },
      formula: "y = dequant(A_int8 · B_int8, scale) [+ bias]",
      inputs: [
        io("x1", "INT8", "Quantized activations.", "量化后的激活。"),
        io("x2", "INT8", "Quantized weights (NZ).", "量化后的权重（NZ）。"),
        io("scale", "FP32/UINT64", "Dequant scale per channel/token.", "per-channel/token 的反量化 scale。"),
      ],
      outputs: [io("y", "FP16/BF16", "Dequantized result.", "反量化后的结果。")],
    },
    GroupedMatmul: {
      category: "moe",
      summary: { en: "Per-expert grouped matmul over a token permutation.", zh: "按专家分组、面向重排 token 的矩阵乘。" },
      formula: "y_g = x_g · W_g  for each expert group g",
      inputs: [
        io("x", "FP16/BF16/INT8", "Permuted tokens grouped by expert.", "按专家分组重排后的 token。"),
        io("weight", "FP16/BF16/INT8", "Stacked per-expert weights.", "堆叠的各专家权重。"),
        io("group_list", "INT64", "Token count per expert group.", "每个专家分组的 token 数。"),
      ],
      outputs: [io("y", "FP16/BF16", "Per-group matmul output.", "各分组矩阵乘输出。")],
    },
    TransposeBatchMatMul: {
      category: "matmul",
      summary: { en: "Batched matmul with a fused transpose on an input.", zh: "在输入侧融合转置的批量矩阵乘。" },
      formula: "y = batch(Aᵀ · B)",
      inputs: [
        io("x1", "FP16/BF16", "Left tensor, transposed on chip.", "左张量，片上转置。"),
        io("x2", "FP16/BF16", "Right tensor.", "右张量。"),
      ],
      outputs: [io("y", "FP16/BF16", "Batched result.", "批量结果。")],
    },
    RmsNorm: {
      category: "norm",
      summary: { en: "Root-mean-square layer normalization.", zh: "均方根层归一化。" },
      formula: "y = x / sqrt(mean(x²) + ε) · gamma",
      inputs: [
        io("x", "FP16/BF16", "Input activations [.., H].", "输入激活 [.., H]。"),
        io("gamma", "FP32", "Learnable scale [H].", "可学习缩放 [H]。"),
      ],
      outputs: [io("y", "FP16/BF16", "Normalized activations.", "归一化后的激活。")],
    },
    AddRmsNormCast: {
      category: "norm",
      summary: { en: "Fused residual-add + RmsNorm + output cast.", zh: "融合残差相加 + RmsNorm + 输出 cast。" },
      formula: "y = cast(rmsnorm(x + residual) · gamma)",
      inputs: [
        io("x", "FP16/BF16", "Current activations.", "当前激活。"),
        io("residual", "FP16/BF16", "Residual branch.", "残差分支。"),
        io("gamma", "FP32", "Learnable scale.", "可学习缩放。"),
      ],
      outputs: [
        io("y", "FP16/BF16", "Normalized + cast output.", "归一化并 cast 后的输出。"),
        io("x_out", "FP16/BF16", "Updated residual sum.", "更新后的残差和。"),
      ],
    },
    LayerNormV3: {
      category: "norm",
      summary: { en: "Standard layer normalization with mean/variance.", zh: "带均值/方差的标准层归一化。" },
      formula: "y = (x − μ) / sqrt(σ² + ε) · gamma + beta",
      inputs: [
        io("x", "FP16/BF16", "Input activations.", "输入激活。"),
        io("gamma", "FP32", "Scale [H].", "缩放 [H]。"),
        io("beta", "FP32", "Shift [H].", "偏移 [H]。"),
      ],
      outputs: [io("y", "FP16/BF16", "Normalized activations.", "归一化后的激活。")],
    },
    DynamicQuant: {
      category: "quant",
      summary: { en: "Dynamic per-token quantization to INT8.", zh: "面向 INT8 的动态 per-token 量化。" },
      formula: "scale = max(|x|)/127 ; x_int8 = round(x/scale)",
      inputs: [io("x", "FP16/BF16", "Input activations.", "输入激活。")],
      outputs: [
        io("y", "INT8", "Quantized activations.", "量化后的激活。"),
        io("scale", "FP32", "Per-token dequant scale.", "per-token 反量化 scale。"),
      ],
    },
    DequantSwigluQuant: {
      category: "quant",
      summary: { en: "Fused dequant → SwiGLU → requantize.", zh: "融合反量化 → SwiGLU → 再量化。" },
      formula: "y = quant(swish(dequant(x)_a) ⊙ dequant(x)_b)",
      inputs: [
        io("x", "INT8", "Quantized gate+up projection.", "量化后的 gate+up 投影。"),
        io("scale", "FP32", "Dequant scale.", "反量化 scale。"),
      ],
      outputs: [
        io("y", "INT8", "Requantized activation.", "再量化后的激活。"),
        io("scale_out", "FP32", "New dequant scale.", "新的反量化 scale。"),
      ],
    },
    MlaPrologV3: {
      category: "attention",
      summary: { en: "Multi-head Latent Attention prolog: QKV projection + RoPE.", zh: "MLA 前处理：QKV 投影 + RoPE。" },
      formula: "q,k,v = proj(x) ; q,k = rope(q,k)",
      inputs: [
        io("x", "FP16/BF16", "Hidden states.", "隐藏状态。"),
        io("weight_*", "FP16/BF16/INT8", "Down/up projection weights.", "降维/升维投影权重。"),
        io("rope_cos/sin", "FP16", "Rotary position tables.", "旋转位置编码表。"),
      ],
      outputs: [
        io("q", "FP16/BF16", "Rotary query.", "旋转后的 query。"),
        io("k_rope / k_nope", "FP16/BF16", "Rotary / non-rotary key.", "旋转 / 非旋转 key。"),
      ],
    },
    KvQuantSparseFlashAttention: {
      category: "attention",
      summary: { en: "Sparse FlashAttention over INT8-quantized KV cache.", zh: "面向 INT8 量化 KV cache 的稀疏 FlashAttention。" },
      formula: "y = softmax(Q·Kᵀ·/√d ⊙ mask)·V",
      inputs: [
        io("query", "FP16/BF16", "Query [B, S, H, D].", "query [B, S, H, D]。"),
        io("key/value", "INT8", "Quantized KV cache.", "量化 KV cache。"),
        io("scale / block_table", "FP32/INT32", "Dequant scale + sparse indices.", "反量化 scale + 稀疏索引。"),
      ],
      outputs: [io("attn_out", "FP16/BF16", "Attention output.", "注意力输出。")],
    },
    LightningIndexerQuant: {
      category: "attention",
      summary: { en: "Lightning sparse-attention indexer with quantization.", zh: "Lightning 稀疏注意力索引器（含量化）。" },
      formula: "idx = topk(scoreₗᵢₜₑ(Q, K))",
      inputs: [
        io("query / key", "FP16/BF16", "Indexer projections.", "索引器投影。"),
        io("weight", "INT8", "Indexer weights.", "索引器权重。"),
      ],
      outputs: [io("index", "INT32", "Selected sparse key indices.", "选中的稀疏 key 索引。")],
    },
    MoeGatingTopKHash: {
      category: "moe",
      summary: { en: "MoE gating: TopK expert selection with hash routing.", zh: "MoE 门控：TopK 专家选择与哈希路由。" },
      formula: "expert_ids = topk(softmax(x·W_gate), k)",
      inputs: [
        io("x", "FP16/BF16", "Router input tokens.", "路由输入 token。"),
        io("gate_weight", "FP16/BF16", "Gating projection.", "门控投影。"),
      ],
      outputs: [
        io("expert_idx", "INT32", "Selected expert ids.", "选中的专家 id。"),
        io("weight", "FP32", "Gating weights.", "门控权重。"),
      ],
    },
    MoeDistributeDispatchV2: {
      category: "moe",
      summary: { en: "All-to-All token dispatch to expert ranks.", zh: "面向专家 rank 的 All-to-All token 分发。" },
      formula: "x_g = alltoall(permute(x, expert_idx))",
      inputs: [
        io("x", "FP16/BF16/INT8", "Tokens to route.", "待路由的 token。"),
        io("expert_idx", "INT32", "Per-token expert assignment.", "每个 token 的专家分配。"),
      ],
      outputs: [io("x_dispatched", "FP16/BF16/INT8", "Tokens grouped per expert rank.", "按专家 rank 分组的 token。")],
    },
    MoeDistributeCombineV2: {
      category: "moe",
      summary: { en: "All-to-All combine of expert outputs back to source tokens.", zh: "将专家输出经 All-to-All 合并回源 token。" },
      formula: "y = unpermute(alltoall(y_g)) · gate_weight",
      inputs: [
        io("y_g", "FP16/BF16", "Per-expert outputs.", "各专家输出。"),
        io("gate_weight", "FP32", "Gating combine weights.", "门控合并权重。"),
      ],
      outputs: [io("y", "FP16/BF16", "Combined token outputs.", "合并后的 token 输出。")],
    },
    RotaryMul: {
      category: "misc",
      summary: { en: "Rotary position embedding (RoPE) application.", zh: "旋转位置编码（RoPE）应用。" },
      formula: "y = x·cos(θ) + rotate_half(x)·sin(θ)",
      inputs: [
        io("x", "FP16/BF16", "Query/key projection.", "query/key 投影。"),
        io("cos / sin", "FP16", "Position tables.", "位置编码表。"),
      ],
      outputs: [io("y", "FP16/BF16", "Rotated embedding.", "旋转后的编码。")],
    },
    GatherV2: {
      category: "misc",
      summary: { en: "Gather rows along an axis by index.", zh: "按索引沿指定轴收集行。" },
      formula: "y[i] = x[index[i]]",
      inputs: [
        io("x", "any", "Source tensor.", "源张量。"),
        io("indices", "INT32/INT64", "Gather indices.", "收集索引。"),
      ],
      outputs: [io("y", "same as x", "Gathered tensor.", "收集后的张量。")],
    },
    Transpose: {
      category: "elementwise",
      summary: { en: "Permute tensor dimensions.", zh: "对张量维度进行排列。" },
      formula: "y[perm(i)] = x[i]",
      inputs: [io("x", "any", "Input tensor.", "输入张量。")],
      outputs: [io("y", "same as x", "Permuted tensor.", "重排后的张量。")],
    },
    Cast: {
      category: "elementwise",
      summary: { en: "Numeric dtype conversion.", zh: "数值数据类型转换。" },
      formula: "y = (dst_dtype) x",
      inputs: [io("x", "any", "Source tensor.", "源张量。")],
      outputs: [io("y", "dst_dtype", "Converted tensor.", "转换后的张量。")],
    },
  };

  const HEURISTICS = [
    [/matmul|batchmatmul|\bmm\b/i, "matmul"],
    [/norm/i, "norm"],
    [/attention|flashattn|mlaprolog|indexer/i, "attention"],
    [/moe|gating|grouped|distribute/i, "moe"],
    [/hcom|allgather|alltoall|reducescatter|allreduce/i, "comm"],
    [/quant/i, "quant"],
    [/add|mul|sub|cast|select|equal|fill|concat|split|reverse|gather|transpose|scatter|argmax|reduce|zeroslike|oneslike|tensormove|rotary|data/i, "elementwise"],
  ];

  function inferCategory(name) {
    for (const [pattern, category] of HEURISTICS) {
      if (pattern.test(name)) return category;
    }
    return "misc";
  }

  function getOperator(name) {
    const entry = OPERATORS[name] || null;
    const category = entry?.category || inferCategory(name);
    const defaults = CATEGORY_DEFAULTS[category] || CATEGORY_DEFAULTS.misc;
    return {
      name,
      category,
      categoryLabel: defaults.label,
      curated: Boolean(entry),
      summary: entry?.summary || {
        en: `${name}: ${category} operator on the Ascend backend.`,
        zh: `${name}：昇腾后端上的 ${category} 类算子。`,
      },
      formula: entry?.formula || "",
      inputs: entry?.inputs || [],
      outputs: entry?.outputs || [],
      support: {
        hardware: entry?.support?.hardware || defaults.hardware,
        dtypes: entry?.support?.dtypes || defaults.dtypes,
        formats: entry?.support?.formats || defaults.formats,
        notes: entry?.support?.notes || defaults.supportNotes,
      },
      precision: {
        mode: entry?.precision?.mode || defaults.precisionMode,
        error: entry?.precision?.error || defaults.precisionError,
        notes: entry?.precision?.notes || defaults.precisionNotes,
      },
      api: {
        docs: entry?.api?.docs || defaults.docs,
        repos: entry?.api?.repos || defaults.repos,
      },
    };
  }

  global.DeepSeekOperatorKnowledge = { getOperator, inferCategory };
})(window);

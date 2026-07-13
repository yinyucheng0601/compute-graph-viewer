(function () {
  const $ = (id) => document.getElementById(id);
  const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const themeParam = new URLSearchParams(window.location.search).get("theme");
  let currentTheme = themeParam === "dark" || themeParam === "light"
    ? themeParam
    : document.documentElement.dataset.theme === "light" ? "light" : "dark";
  let graphController = null;

  const models = {
    qwen3: {
      name: "Qwen3-8B",
      title: "Qwen3-8B 架构解释",
      meta: "Dense decoder · 36 layers · hidden 4096 · TP2 PP1",
      run: "run qwen3-8b-r12",
      graphKind: "dense",
      trainingGraph: makeQwen3TrainingGraph(),
      phaseMap: {
        tokens: { nodeId: "input_tokens", nodeLabel: "Token IDs" },
        embedding: { nodeId: "token_embedding", nodeLabel: "Embedding Lookup", relatedNodeIds: ["token_embedding_weight"] },
        attention: { nodeId: "scaled_attention", nodeLabel: "Scaled Attention", relatedNodeIds: ["hidden_states", "attn_norm_gamma", "qkv_weight", "qkv_linear", "rope_cache", "kv_cache", "rotary_apply", "attn_out_weight", "attn_output_linear"] },
        mlp: { nodeId: "silu_multiply", nodeLabel: "SwiGLU MLP", relatedNodeIds: ["mlp_norm_gamma", "mlp_gate_linear", "gate_weight", "mlp_up_linear", "up_weight", "down_weight", "mlp_output_linear"] },
        norm: { nodeId: "final_norm", nodeLabel: "Final RMSNorm", relatedNodeIds: ["final_norm_gamma"] },
        logits: { nodeId: "lm_head", nodeLabel: "LM Head Linear", relatedNodeIds: ["shared_lm_weight", "logits"] },
      },
      seq: "4096",
      parallel: "TP2 · PP1",
      batch: "MBS1 · GBS128",
      params: 8e9,
      target: 8e10,
      summary: "Token IDs 进入 Embedding，经过 36 个 Dense Decoder Layer，Attention 和 SwiGLU MLP 交替加工，最后由 LM Head 输出 logits。",
      snippet: [
        'MODEL_ARGS="--num-layers 36 --hidden-size 4096 --num-attention-heads 32"',
        'TRAIN_ARGS="--seq-length 4096 --tensor-model-parallel-size 2 --pipeline-model-parallel-size 1"',
        'DATA_ARGS="--tokenizer-name-or-path ${TOKENIZER_PATH} --data-path ${DATA_PATH}"',
      ].join("\n"),
      decision: {
        title: "当前配置可进入短跑验证",
        body: "建议先运行 200 step，观察 loss 是否下降、HBM 是否稳定、通信等待是否超过 20%。",
      },
      checks: [
        ["ok", "TOKENIZER_PATH 已配置", "tokenizer 与 Qwen3 权重路径一致。"],
        ["ok", "DATA_PATH 前缀完整", "数据前缀指向 mmap/bin 索引文件。"],
        ["warn", "TP2 需要匹配权重转换", "如果从 HF 权重启动，需要确认转换目标并行度。"],
      ],
      graph: [
        ["input", "Token IDs", "input", 300, 42, 180, 58],
        ["embed", "Embedding", "vocab -> hidden", 300, 128, 220, 68],
        ["attn", "Attention", "32 heads", 155, 236, 220, 68],
        ["mlp", "SwiGLU MLP", "intermediate 22016", 445, 236, 240, 68],
        ["norm", "RMSNorm", "pre + final", 300, 344, 210, 62],
        ["head", "LM Head", "logits", 300, 430, 210, 62],
      ],
      edges: [["input", "embed"], ["embed", "attn"], ["embed", "mlp"], ["attn", "norm"], ["mlp", "norm"], ["norm", "head"]],
      paramLinks: {
        seq: { nodes: ["input", "embed", "attn"], note: "SEQ_LENGTH 决定 Token IDs 的长度，最直接放大 Attention 的计算量和 KV/激活显存。" },
        parallel: { nodes: ["attn", "mlp", "norm"], note: "TP/PP 把 Attention、MLP 和 Decoder 层拆到多卡；切分方式必须和脚本、权重转换一致。" },
        batch: { nodes: ["input", "embed", "head"], note: "MBS/GBS 决定每次进入模型的样本规模和梯度累积，影响吞吐、显存和收敛折中。" },
      },
    },
    qwen7b: {
      name: "Qwen7B",
      title: "Qwen7B 本地源码闭环",
      meta: "Dense decoder · 32 layers · hidden 4096 · source verified",
      run: "run qwen7b-source-r03",
      graphKind: "dense",
      trainingGraph: makeQwen7BTrainingGraph(),
      phaseMap: {
        tokens: { nodeId: "input_tokens", nodeLabel: "Token IDs" },
        embedding: { nodeId: "token_embedding", nodeLabel: "Embedding Lookup", relatedNodeIds: ["token_embedding_weight"] },
        attention: { nodeId: "scaled_attention", nodeLabel: "Scaled Attention", relatedNodeIds: ["hidden_states", "attn_norm_gamma", "qkv_weight", "qkv_linear", "rope_cache", "kv_cache", "rotary_apply", "attn_out_weight", "attn_output_linear"] },
        mlp: { nodeId: "silu_multiply", nodeLabel: "SwiGLU MLP", relatedNodeIds: ["mlp_norm_gamma", "mlp_gate_linear", "gate_weight", "mlp_up_linear", "up_weight", "down_weight", "mlp_output_linear"] },
        norm: { nodeId: "final_norm", nodeLabel: "Final RMSNorm", relatedNodeIds: ["final_norm_gamma"] },
        logits: { nodeId: "lm_head", nodeLabel: "LM Head Linear", relatedNodeIds: ["shared_lm_weight", "logits"] },
      },
      seq: "8192",
      parallel: "TP1 · PP1",
      batch: "MBS1 · GBS64",
      params: 7e9,
      target: 5e10,
      summary: "Qwen7B 适合建立 README、config.json、modeling_qwen.py、generation_config 和 safetensors index 之间的对应关系。",
      snippet: [
        '"num_hidden_layers": 32, "hidden_size": 4096, "num_attention_heads": 32',
        '"seq_length": 8192, "vocab_size": 151936, "intermediate_size": 22016',
        '"top_p": 0.8, "top_k": 0, "max_new_tokens": 512',
      ].join("\n"),
      decision: {
        title: "适合做第一张模型地图",
        body: "建议用它校准源码、config、权重索引和推理配置，再进入 Qwen3 Ascend 训练链路。",
      },
      checks: [
        ["ok", "config.json 可映射架构图", "层数、hidden、head、词表和上下文长度都有本地证据。"],
        ["ok", "safetensors index 可定位权重 shard", "适合解释权重不是单个大文件。"],
        ["warn", "不是本机全量训练对象", "作为学习闭环更合适，训练需转向可控脚本。"],
      ],
      graph: [
        ["readme", "README", "source", 84, 84, 160, 58],
        ["config", "config.json", "params", 84, 188, 180, 58],
        ["code", "modeling_qwen.py", "modules", 84, 316, 210, 58],
        ["embed", "Embedding", "151936 x 4096", 430, 84, 240, 68],
        ["attn", "Attention", "32 heads", 350, 208, 210, 68],
        ["mlp", "SwiGLU MLP", "22016", 580, 208, 210, 68],
        ["norm", "RMSNorm", "pre + final", 465, 326, 210, 62],
        ["head", "LM Head", "top_p / eos", 465, 430, 210, 62],
      ],
      edges: [["readme", "config"], ["config", "embed"], ["code", "attn"], ["code", "mlp"], ["embed", "attn"], ["embed", "mlp"], ["attn", "norm"], ["mlp", "norm"], ["norm", "head"]],
      paramLinks: {
        seq: { nodes: ["config", "embed", "attn"], note: "Qwen7B 的 seq_length 来自 config，本质上影响输入序列进入 Embedding 后的 Attention 范围。" },
        parallel: { nodes: ["config", "attn", "mlp"], note: "Qwen7B 学习页主要用 TP/PP 建立概念，真实训练还要匹配权重切分和脚本启动方式。" },
        batch: { nodes: ["config", "head"], note: "Batch 不改变模型结构，但会改变一次前后向覆盖多少 token，最终反映到 logits/loss 的统计稳定性。" },
      },
    },
    qwenmoe: {
      name: "Qwen3-MoE",
      title: "Qwen3-MoE 专家路由解释",
      meta: "MoE decoder · router topk · expert parallel",
      run: "run qwen3-moe-a3b-r06",
      graphKind: "moe",
      trainingGraph: makeQwenMoeTrainingGraph(),
      phaseMap: {
        tokens: { nodeId: "input_tokens", nodeLabel: "Token IDs" },
        embedding: { nodeId: "token_embedding", nodeLabel: "Embedding Lookup", relatedNodeIds: ["token_embedding_weight"] },
        attention: { nodeId: "scaled_attention", nodeLabel: "Dense Attention", relatedNodeIds: ["qkv_weight", "qkv_linear", "kv_cache"] },
        mlp: { nodeId: "expert_combine", nodeLabel: "Expert Combine", relatedNodeIds: ["router_weight", "router", "topk_expert_select", "expert_dispatch_buffer", "expert_dispatch", "routed_expert_weight", "routed_experts", "shared_expert_weight"] },
        norm: { nodeId: "final_norm", nodeLabel: "Final RMSNorm", relatedNodeIds: ["final_norm_gamma"] },
        logits: { nodeId: "lm_head", nodeLabel: "LM Head Linear", relatedNodeIds: ["lm_head_weight", "logits"] },
      },
      seq: "4096 / 16384",
      parallel: "TP2 · PP4 · EP8",
      batch: "MBS1 · GBS128",
      params: 30e9,
      target: 1.5e11,
      summary: "MoE 的重点不是参数更多，而是 token 先经过 router，再按 TopK 选择专家，EP 和 all-to-all 会直接影响通信。",
      snippet: [
        'MOE_ARGS="--num-experts 128 --moe-router-topk 8 --expert-model-parallel-size 8"',
        'TRAIN_ARGS="--seq-length 4096 --tensor-model-parallel-size 2 --pipeline-model-parallel-size 4"',
        'DPO_ARGS="--global-batch-size 128 --recompute-granularity full"',
      ].join("\n"),
      decision: {
        title: "进入进阶训练解释",
        body: "建议同时观察 expert 负载、all-to-all 通信、recompute 和长上下文 HBM 压力。",
      },
      checks: [
        ["ok", "EP 与 num_experts 已绑定", "专家并行需要和 world size 一起解释。"],
        ["warn", "all-to-all 通信风险", "router topk 增大后通信和负载均衡都会变化。"],
        ["ok", "DPO 数据格式可检查", "chosen/rejected 数据需要进入体检项。"],
      ],
      graph: [
        ["input", "Token IDs", "input", 300, 42, 180, 58],
        ["embed", "Embedding", "hidden", 300, 128, 220, 68],
        ["router", "Router", "topk experts", 300, 226, 220, 68],
        ["expertA", "Expert Group A", "EP shard", 150, 336, 220, 62],
        ["expertB", "Expert Group B", "EP shard", 450, 336, 220, 62],
        ["merge", "Combine", "weighted sum", 300, 430, 220, 62],
      ],
      edges: [["input", "embed"], ["embed", "router"], ["router", "expertA"], ["router", "expertB"], ["expertA", "merge"], ["expertB", "merge"]],
      paramLinks: {
        seq: { nodes: ["input", "embed", "router"], note: "长上下文先扩大 token 序列，再让更多 token 进入 router，增加路由和专家通信压力。" },
        parallel: { nodes: ["router", "expertA", "expertB"], note: "EP 与专家组强绑定；router 的 TopK 选择会决定 all-to-all 通信和负载均衡风险。" },
        batch: { nodes: ["input", "router", "merge"], note: "Batch 增大后，router 和专家合并阶段同时承压，吞吐收益和通信风险要一起看。" },
      },
    },
    deepseek: {
      name: "Pangu 2.0 flash",
      title: "Pangu 2.0 flash 整网图",
      meta: "",
      graphKind: "moe",
      trainingGraph: makeDeepSeekTrainingGraph(),
      phaseMap: {
        tokens: { nodeId: "input_tokens", nodeLabel: "Token IDs" },
        embedding: { nodeId: "token_embedding", nodeLabel: "Parallel Embedding", relatedNodeIds: ["token_embedding_weight"] },
        attention: { nodeId: "mla_attention", nodeLabel: "MLA + DSA Attention", relatedNodeIds: ["query_weight", "kv_weight", "kv_cache", "dsa_sparse_index", "query_projection", "kv_projection", "dsa_indexer", "sparse_attention"] },
        mlp: { nodeId: "moe_combine", nodeLabel: "MoE Combine", relatedNodeIds: ["router_weight", "router", "topk_expert_select", "routed_expert_weight", "routed_experts", "shared_expert_weight", "shared_expert"] },
        norm: { nodeId: "final_norm", nodeLabel: "Final RMSNorm", relatedNodeIds: ["final_norm_gamma"] },
        logits: { nodeId: "lm_head", nodeLabel: "LM Head + MTP", relatedNodeIds: ["lm_head_weight", "mtp_weight", "mtp_head", "logits"] },
      },
      seq: "16384+",
      parallel: "TP4 · PP8 · EP64 · CP2",
      batch: "MBS1 · GBS256",
      params: 671e9,
      target: 3e12,
      summary: "DeepSeek V3.2 把 MLA、Sparse Indexer、MoE、MTP、长上下文和多维并行放到同一条解释链里。",
      snippet: [
        'MODEL_ARGS="--num-experts 256 --moe-router-topk 8 --enable-dsa-indexer"',
        'PARALLEL_ARGS="--tensor-model-parallel-size 4 --pipeline-model-parallel-size 8 --expert-model-parallel-size 64"',
        'ATTN_ARGS="--use-sparse-flash-attn --context-parallel-size 2"',
      ].join("\n"),
      decision: {
        title: "建议作为专家模式样例",
        body: "先不要让初学者直接照抄脚本，应该用它解释 MLA、DSA、EP、CP 和 profiling 归因。",
      },
      checks: [
        ["warn", "多维并行需整体校验", "TP/PP/EP/CP 与节点数、rank 和权重切分强相关。"],
        ["warn", "DSA 与 sparse attention 需成对解释", "索引器、稀疏注意力和长上下文不能孤立看。"],
        ["danger", "必须采集 profiling 摘要", "没有通信/显存证据时，很难定位瓶颈。"],
      ],
      graph: [
        ["input", "Token IDs", "long context", 300, 36, 190, 58],
        ["mla", "MLA", "compressed KV", 170, 128, 220, 68],
        ["dsa", "DSA Indexer", "sparse select", 430, 128, 230, 68],
        ["router", "MoE Router", "topk 8", 300, 238, 220, 68],
        ["experts", "256 Experts", "EP64", 170, 350, 220, 62],
        ["mtp", "MTP", "multi-token", 430, 350, 220, 62],
        ["head", "LM Head", "logits", 300, 438, 220, 62],
      ],
      edges: [["input", "mla"], ["input", "dsa"], ["mla", "router"], ["dsa", "router"], ["router", "experts"], ["router", "mtp"], ["experts", "head"], ["mtp", "head"]],
      paramLinks: {
        seq: { nodes: ["input", "mla", "dsa"], note: "DeepSeek 的长上下文会同时牵动 MLA、DSA Indexer 和 Sparse Attention 路径。" },
        parallel: { nodes: ["router", "experts", "mtp"], note: "TP/PP/EP/CP 同时出现时，router、experts 和 MTP 的通信域必须一起校验。" },
        batch: { nodes: ["input", "router", "head"], note: "Batch 放大 token 流量，风险会从输入、MoE 路由一路传导到 logits/loss。" },
      },
    },
  };

  function evidenceItem(priority, dimension, metric, what, evidence, action, relatedNodeIds = [], sources = []) {
    return { priority, dimension, metric, what, evidence, action, relatedNodeIds, sources };
  }

  function makeDenseTrainingGraph(config) {
    const mainX = 560;
    const leftX = 190;
    const rightX = 930;
    const nodes = [
      { id: "input_tokens", label: "Token IDs", typeLabel: "Input", kind: "tensor", x: mainX, y: 48, width: 176, height: 48, colorKey: "io:input" },
      { id: "token_embedding_weight", label: "Embedding Weight", typeLabel: "Parameter", kind: "tensor", x: leftX, y: 150, width: 232, height: 52, colorKey: "io:parameter" },
      { id: "token_embedding", label: "Embedding Lookup", typeLabel: "Op", kind: "op", x: mainX, y: 150, width: 246, height: 56, colorKey: "sem:embedding" },
      { id: "hidden_states", label: "Hidden States", typeLabel: "Tensor", kind: "tensor", x: mainX, y: 224, width: 210, height: 48, colorKey: "io:activation" },
      { id: "attn_norm_gamma", label: "Attn Norm Gamma", typeLabel: "Parameter", kind: "tensor", x: rightX, y: 304, width: 204, height: 52, colorKey: "io:parameter" },
      { id: "attn_norm", label: "Attention RMSNorm", typeLabel: "Op", kind: "op", x: mainX, y: 304, width: 232, height: 54, colorKey: "sem:norm" },
      { id: "qkv_weight", label: "QKV Weight", typeLabel: "Parameter", kind: "tensor", x: leftX, y: 384, width: 188, height: 52, colorKey: "io:parameter" },
      { id: "qkv_linear", label: "QKV Linear", typeLabel: "Op", kind: "op", x: mainX, y: 384, width: 204, height: 54, colorKey: "sem:linear" },
      { id: "rope_cache", label: "RoPE Cache", typeLabel: "State", kind: "tensor", x: leftX, y: 464, width: 176, height: 52, colorKey: "io:state" },
      { id: "rotary_apply", label: "Apply RoPE", typeLabel: "Op", kind: "op", x: mainX, y: 464, width: 204, height: 54, colorKey: "sem:position" },
      { id: "kv_cache", label: "KV Cache", typeLabel: "State", kind: "tensor", x: leftX, y: 544, width: 164, height: 52, colorKey: "io:state" },
      { id: "scaled_attention", label: "Scaled Attention", typeLabel: "Op", kind: "op", x: mainX, y: 544, width: 224, height: 54, colorKey: "sem:attention" },
      { id: "attn_out_weight", label: "O-Proj Weight", typeLabel: "Parameter", kind: "tensor", x: rightX, y: 624, width: 194, height: 52, colorKey: "io:parameter" },
      { id: "attn_output_linear", label: "Attention Output", typeLabel: "Op", kind: "op", x: mainX, y: 624, width: 230, height: 54, colorKey: "sem:linear" },
      { id: "mlp_norm_gamma", label: "MLP Norm Gamma", typeLabel: "Parameter", kind: "tensor", x: rightX, y: 704, width: 204, height: 52, colorKey: "io:parameter" },
      { id: "mlp_norm", label: "MLP RMSNorm", typeLabel: "Op", kind: "op", x: mainX, y: 704, width: 214, height: 54, colorKey: "sem:norm" },
      { id: "gate_weight", label: "Gate Weight", typeLabel: "Parameter", kind: "tensor", x: leftX, y: 794, width: 180, height: 52, colorKey: "io:parameter" },
      { id: "mlp_gate_linear", label: "Gate Linear", typeLabel: "Op", kind: "op", x: mainX - 126, y: 794, width: 190, height: 54, colorKey: "sem:mlp" },
      { id: "up_weight", label: "Up Weight", typeLabel: "Parameter", kind: "tensor", x: rightX, y: 794, width: 164, height: 52, colorKey: "io:parameter" },
      { id: "mlp_up_linear", label: "Up Linear", typeLabel: "Op", kind: "op", x: mainX + 126, y: 794, width: 190, height: 54, colorKey: "sem:mlp" },
      { id: "silu_multiply", label: "SiLU Multiply", typeLabel: "Op", kind: "op", x: mainX, y: 874, width: 214, height: 54, colorKey: "sem:mlp" },
      { id: "down_weight", label: "Down Weight", typeLabel: "Parameter", kind: "tensor", x: rightX, y: 954, width: 184, height: 52, colorKey: "io:parameter" },
      { id: "mlp_output_linear", label: "MLP Output", typeLabel: "Op", kind: "op", x: mainX, y: 954, width: 214, height: 54, colorKey: "sem:linear" },
      { id: "decoder_output", label: "Layer Output", typeLabel: "Tensor", kind: "tensor", x: mainX, y: 1034, width: 204, height: 48, colorKey: "io:activation" },
      { id: "final_norm_gamma", label: "Final Norm Gamma", typeLabel: "Parameter", kind: "tensor", x: rightX, y: 1120, width: 206, height: 52, colorKey: "io:parameter" },
      { id: "final_norm", label: "Final RMSNorm", typeLabel: "Op", kind: "op", x: mainX, y: 1120, width: 214, height: 54, colorKey: "sem:norm" },
      { id: "shared_lm_weight", label: "Shared LM Weight", typeLabel: "Parameter", kind: "tensor", x: leftX, y: 1208, width: 224, height: 52, colorKey: "io:parameter" },
      { id: "lm_head", label: "LM Head Linear", typeLabel: "Op", kind: "op", x: mainX, y: 1208, width: 224, height: 54, colorKey: "sem:head" },
      { id: "logits", label: "Logits", typeLabel: "Output", kind: "tensor", x: mainX, y: 1292, width: 176, height: 48, colorKey: "io:output" },
    ];

    const edges = [
      { source: "input_tokens", target: "token_embedding", tag: "ACT", edgeType: "activation" },
      { source: "token_embedding_weight", target: "token_embedding", tag: "Parameter", edgeType: "parameter", dashed: true },
      { source: "token_embedding", target: "hidden_states", tag: "H", edgeType: "activation" },
      { source: "hidden_states", target: "attn_norm", tag: "ACT", edgeType: "activation" },
      { source: "attn_norm_gamma", target: "attn_norm", tag: "Parameter", edgeType: "parameter", dashed: true },
      { source: "qkv_weight", target: "qkv_linear", tag: "Parameter", edgeType: "parameter", dashed: true },
      { source: "attn_norm", target: "qkv_linear", tag: "QKV", edgeType: "parameter" },
      { source: "rope_cache", target: "rotary_apply", tag: "State", edgeType: "state", dashed: true },
      { source: "qkv_linear", target: "rotary_apply", tag: "ROPE", edgeType: "state" },
      { source: "kv_cache", target: "scaled_attention", tag: "State", edgeType: "cache", dashed: true },
      { source: "rotary_apply", target: "scaled_attention", tag: "KV", edgeType: "cache" },
      { source: "scaled_attention", target: "attn_output_linear", tag: "ACT", edgeType: "activation" },
      { source: "attn_out_weight", target: "attn_output_linear", tag: "Parameter", edgeType: "parameter", dashed: true },
      { source: "attn_output_linear", target: "mlp_norm", tag: "RES", edgeType: "activation" },
      { source: "mlp_norm_gamma", target: "mlp_norm", tag: "Parameter", edgeType: "parameter", dashed: true },
      { source: "gate_weight", target: "mlp_gate_linear", tag: "Parameter", edgeType: "parameter", dashed: true },
      { source: "mlp_norm", target: "mlp_gate_linear", tag: "W1", edgeType: "parameter" },
      { source: "up_weight", target: "mlp_up_linear", tag: "Parameter", edgeType: "parameter", dashed: true },
      { source: "mlp_norm", target: "mlp_up_linear", tag: "W2", edgeType: "parameter" },
      { source: "mlp_gate_linear", target: "silu_multiply", tag: "GATE", edgeType: "activation" },
      { source: "mlp_up_linear", target: "silu_multiply", tag: "UP", edgeType: "activation" },
      { source: "silu_multiply", target: "mlp_output_linear", tag: "W", edgeType: "parameter" },
      { source: "down_weight", target: "mlp_output_linear", tag: "Parameter", edgeType: "parameter", dashed: true },
      { source: "mlp_output_linear", target: "decoder_output", tag: "ACT", edgeType: "activation" },
      { source: "decoder_output", target: "final_norm", tag: "ACT", edgeType: "activation" },
      { source: "final_norm_gamma", target: "final_norm", tag: "Parameter", edgeType: "parameter", dashed: true },
      { source: "shared_lm_weight", target: "lm_head", tag: "Parameter", edgeType: "parameter", dashed: true },
      { source: "final_norm", target: "lm_head", tag: "W", edgeType: "parameter" },
      { source: "lm_head", target: "logits", tag: "LOSS", edgeType: "gradient" },
    ];

    const evidence = {
      input_tokens: evidenceItem("P2", "data", `SEQ_LENGTH ${config.seq}`, "训练样本首先被切成 token ids；序列长度决定后续每层要处理的 token 数。", [
        `${config.seq} 是单样本上下文长度，直接影响激活显存和 attention 计算量。`,
        "微批次 MBS 与 GBS 决定一次前后向覆盖多少 token。",
      ], "如果首轮就 OOM，优先缩短 SEQ_LENGTH 或开启重算。", ["token_embedding"]),
      token_embedding: evidenceItem("P2", "source / parameter", `hidden ${config.hidden}`, "Embedding 把 token id 映射到 hidden states，是模型数据流的入口。", [
        `hidden size=${config.hidden} 会沿着 Attention、MLP、RMSNorm 和 LM Head 传播。`,
        "词表维度影响 embedding 与最终 vocab projection 的权重规模。",
      ], "检查 tokenizer 路径、词表大小和权重转换是否一致。", ["input_tokens", "token_embedding_weight", "attn_norm"]),
      token_embedding_weight: evidenceItem(null, "parameter tensor", "embedding.weight", "Embedding Weight 是 token id 查表时读取的参数张量，不是 config 或 README 文件。", [
        "config.json 提供 vocab_size、hidden_size 这类形状证据；safetensors index 提供权重 shard 证据。",
      ], "在图里把它作为 Parameter 输入接到 Embedding Lookup。", ["token_embedding"], ["config.json", "safetensors.index"]),
      hidden_states: evidenceItem("P2", "tensor", `hidden ${config.hidden}`, "Hidden States 是 embedding 之后真正进入 decoder layer 的激活张量。", [
        "它不是源码文件，而是训练中每一层反复读写、保存或重算的激活。",
      ], "讲训练链路时，优先沿着 tensor 流向解释，而不是沿着文件名解释。", ["token_embedding", "attn_norm"]),
      scaled_attention: evidenceItem("P1", "compute / memory", "Attention", "Attention 让当前 token 读取上下文重点，是序列长度最敏感的训练节点。", [
        `${config.layers} layers、${config.heads} heads、${config.parallel} 共同决定 attention 的切分和通信域。`,
        "长上下文会放大 QK^T、softmax、KV cache/激活保存和重算压力。",
      ], "观察 MFU、HBM 与通信等待；若 MFU 低且 HBM 高，优先看重算和 TP 切分。", ["qkv_weight", "qkv_linear", "rope_cache", "kv_cache", "rotary_apply", "attn_output_linear"]),
      qkv_weight: evidenceItem(null, "parameter tensor", "q_proj/k_proj/v_proj", "QKV Weight 是 Attention 线性投影读取的权重输入。", [
        "modeling_qwen.py 证明 Q/K/V 投影的源码路径；config.json 给出 head 和 hidden 的形状约束。",
      ], "排查 attention 显存或通信时，把 QKV 权重和 QKV 激活分开看。", ["qkv_linear"], ["modeling_qwen.py", "config.json"]),
      rope_cache: evidenceItem(null, "state tensor", "RoPE cache", "RoPE Cache 是位置编码状态，用于把位置信息注入 Q/K。", [
        "它来自模型实现和序列长度约束，不是独立源码文件节点。",
      ], "长上下文异常时，联查 RoPE 形状、seq_length 和 attention kernel。", ["rotary_apply"], ["modeling_qwen.py"]),
      kv_cache: evidenceItem(null, "state tensor", "KV cache / activation", "训练图中 KV Cache 表示 attention 路径上需要保存或重算的 K/V 状态。", [
        "它帮助解释长上下文为什么会放大 HBM 和重算压力。",
      ], "用 profiling 区分 KV/激活压力和参数权重读取压力。", ["scaled_attention"], ["profiling summary"]),
      silu_multiply: evidenceItem("P2", "compute", `intermediate ${config.intermediate}`, "SwiGLU MLP 执行 Gate/Up 投影和 SiLU 乘法，是 Dense decoder 的主要算力消耗之一。", [
        `intermediate size=${config.intermediate} 解释了 MLP 为什么比 hidden size 宽很多。`,
        "MLP 对矩阵乘吞吐敏感，和 tensor parallel 的切分策略强相关。",
      ], "如果 attention 正常但 MFU 偏低，检查 MLP fusion、TP 切分和重算粒度。", ["mlp_norm_gamma", "gate_weight", "up_weight", "mlp_gate_linear", "mlp_up_linear", "down_weight", "mlp_output_linear"]),
      gate_weight: evidenceItem(null, "parameter tensor", "mlp.w1 / gate_proj", "Gate Weight 是 SwiGLU 门控分支的参数输入。", [
        `intermediate size=${config.intermediate} 主要体现在 Gate/Up/Down 三组 MLP 权重上。`,
      ], "把 MLP 算力问题映射到 Gate/Up/Down 三条参数输入。", ["mlp_gate_linear"], ["modeling_qwen.py", "safetensors.index"]),
      up_weight: evidenceItem(null, "parameter tensor", "mlp.w2 / up_proj", "Up Weight 是 SwiGLU 上投影分支的参数输入。", [
        "它和 Gate Weight 一起决定 SiLU Multiply 前的宽激活。",
      ], "若 MLP kernel 利用率低，优先看这两条上投影是否被正确切分。", ["mlp_up_linear"], ["modeling_qwen.py", "safetensors.index"]),
      down_weight: evidenceItem(null, "parameter tensor", "mlp.c_proj / down_proj", "Down Weight 把 intermediate 激活投回 hidden size。", [
        "它是 MLP 分支回到主干 hidden states 的参数边界。",
      ], "检查 TP 切分和输出投影融合是否匹配脚本配置。", ["mlp_output_linear"], ["modeling_qwen.py", "safetensors.index"]),
      decoder_output: evidenceItem("P2", "tensor", "layer output", "Layer Output 表示一个 decoder layer 结束后的 hidden states，会进入下一层或最终 RMSNorm。", [
        "训练时它通常对应残差后的激活保存、重算和梯度回传边界。",
      ], "解释收敛或显存问题时，把它当作层间张量边界来看。", ["mlp_output_linear", "final_norm"]),
      lm_head: evidenceItem("P2", "loss / backward", "logits", "LM Head 把 hidden states 投影到词表 logits，随后进入 loss、反向传播和优化器更新。", [
        "词表越大，logits、cross entropy 和梯度路径越容易变成显存压力点。",
        `${config.batch} 会改变 logits/loss 的统计稳定性和梯度累积节奏。`,
      ], "遇到 loss spike 时同时看 logits、梯度范数和最后投影的通信/显存。", ["shared_lm_weight", "logits", "final_norm"]),
      shared_lm_weight: evidenceItem(null, "parameter tensor", "lm_head.weight", "Shared LM Weight 是输出词表投影读取的参数张量。", [
        "generation_config 只解释采样侧 top_p/eos；训练前向里真正输入 LM Head 的是权重 tensor。",
      ], "不要把 generation_config 画成 logits 的输入节点。", ["lm_head", "logits"], ["generation_config.json", "safetensors.index"]),
    };

    return {
      width: 1120,
      height: 1360,
      clusters: [
        { id: "transformer", label: `${config.name} Transformer`, x: mainX - 270, y: 92, width: 540, height: 1110, colorKey: "module:transformer" },
        { id: "decoder_layer", label: `Decoder Layer × ${config.layers}`, x: mainX - 232, y: 282, width: 464, height: 790, repeat: config.layers, colorKey: "module:decoder" },
        { id: "attention_box", label: "Self Attention", x: mainX - 190, y: 354, width: 380, height: 296, colorKey: "module:attention" },
        { id: "mlp_box", label: "SwiGLU MLP", x: mainX - 210, y: 684, width: 420, height: 306, colorKey: "module:mlp" },
      ],
      nodes,
      edges,
      trainingEvidence: evidence,
    };
  }

  function makeQwen3TrainingGraph() {
    return makeDenseTrainingGraph({
      name: "Qwen3-8B",
      layers: 36,
      hidden: 4096,
      heads: "32 attention heads / GQA",
      intermediate: 22016,
      seq: 4096,
      parallel: "TP2 / PP1",
      batch: "MBS1 / GBS128",
    });
  }

  function makeQwen7BTrainingGraph() {
    return makeDenseTrainingGraph({
      name: "Qwen7B",
      layers: 32,
      hidden: 4096,
      heads: "32 attention heads",
      intermediate: 22016,
      seq: 8192,
      parallel: "TP1 / PP1",
      batch: "MBS1 / GBS64",
    });
  }

  function makeQwenMoeTrainingGraph() {
    return {
      width: 1040,
      height: 1240,
      clusters: [
        { id: "transformer", label: "Qwen3-MoE Transformer", x: 132, y: 92, width: 596, height: 1030, colorKey: "module:transformer" },
        { id: "decoder_layer", label: "MoE Decoder Layer", x: 164, y: 282, width: 532, height: 720, repeat: 48, colorKey: "module:decoder" },
        { id: "attention_box", label: "Attention", x: 196, y: 344, width: 468, height: 164, colorKey: "module:attention" },
        { id: "moe_box", label: "Router + Experts", x: 184, y: 568, width: 492, height: 354, colorKey: "module:moe" },
      ],
      nodes: [
        { id: "input_tokens", label: "Token IDs", typeLabel: "Input", kind: "tensor", x: 430, y: 48, width: 176, height: 48, colorKey: "io:input" },
        { id: "token_embedding_weight", label: "Embedding Weight", typeLabel: "Parameter", kind: "tensor", x: 88, y: 150, width: 232, height: 52, colorKey: "io:parameter" },
        { id: "token_embedding", label: "Embedding Lookup", typeLabel: "Op", kind: "op", x: 430, y: 150, width: 246, height: 56, colorKey: "sem:embedding" },
        { id: "hidden_states", label: "Hidden States", typeLabel: "Tensor", kind: "tensor", x: 430, y: 224, width: 210, height: 48, colorKey: "io:activation" },
        { id: "attn_norm", label: "Attention RMSNorm", typeLabel: "Op", kind: "op", x: 430, y: 304, width: 232, height: 54, colorKey: "sem:norm" },
        { id: "qkv_weight", label: "QKV Weight", typeLabel: "Parameter", kind: "tensor", x: 88, y: 392, width: 188, height: 52, colorKey: "io:parameter" },
        { id: "qkv_linear", label: "QKV Linear", typeLabel: "Op", kind: "op", x: 300, y: 392, width: 190, height: 54, colorKey: "sem:linear" },
        { id: "kv_cache", label: "KV Cache", typeLabel: "State", kind: "tensor", x: 836, y: 392, width: 164, height: 52, colorKey: "io:state" },
        { id: "scaled_attention", label: "Dense Attention", typeLabel: "Op", kind: "op", x: 560, y: 392, width: 214, height: 54, colorKey: "sem:attention" },
        { id: "ffn_norm", label: "FFN RMSNorm", typeLabel: "Op", kind: "op", x: 430, y: 520, width: 214, height: 54, colorKey: "sem:norm" },
        { id: "router_weight", label: "Router Weight", typeLabel: "Parameter", kind: "tensor", x: 88, y: 604, width: 196, height: 52, colorKey: "io:parameter" },
        { id: "router", label: "Router Linear", typeLabel: "Op", kind: "op", x: 430, y: 604, width: 214, height: 54, colorKey: "sem:router" },
        { id: "expert_dispatch_buffer", label: "Dispatch Buffer", typeLabel: "State", kind: "tensor", x: 836, y: 684, width: 210, height: 52, colorKey: "io:state" },
        { id: "topk_expert_select", label: "TopK Expert Select", typeLabel: "Op", kind: "op", x: 430, y: 684, width: 238, height: 54, colorKey: "sem:router" },
        { id: "expert_dispatch", label: "All-to-All Dispatch", typeLabel: "Comm", kind: "op", x: 214, y: 774, width: 206, height: 54, colorKey: "sem:communication" },
        { id: "routed_expert_weight", label: "Routed Expert Weight", typeLabel: "Parameter", kind: "tensor", x: 88, y: 844, width: 242, height: 52, colorKey: "io:parameter" },
        { id: "routed_experts", label: "Routed Experts", typeLabel: "Expert", kind: "op", x: 430, y: 774, width: 204, height: 54, colorKey: "sem:expert" },
        { id: "shared_expert_weight", label: "Shared Expert Weight", typeLabel: "Parameter", kind: "tensor", x: 836, y: 844, width: 246, height: 52, colorKey: "io:parameter" },
        { id: "shared_expert", label: "Shared Expert", typeLabel: "Expert", kind: "op", x: 610, y: 774, width: 204, height: 54, colorKey: "sem:expert" },
        { id: "expert_combine", label: "Expert Combine", typeLabel: "Op", kind: "op", x: 430, y: 866, width: 214, height: 54, colorKey: "sem:combine" },
        { id: "decoder_output", label: "Layer Output", typeLabel: "Tensor", kind: "tensor", x: 430, y: 952, width: 204, height: 48, colorKey: "io:activation" },
        { id: "final_norm_gamma", label: "Final Norm Gamma", typeLabel: "Parameter", kind: "tensor", x: 836, y: 1036, width: 206, height: 52, colorKey: "io:parameter" },
        { id: "final_norm", label: "Final RMSNorm", typeLabel: "Op", kind: "op", x: 430, y: 1036, width: 214, height: 54, colorKey: "sem:norm" },
        { id: "lm_head_weight", label: "LM Head Weight", typeLabel: "Parameter", kind: "tensor", x: 88, y: 1122, width: 210, height: 52, colorKey: "io:parameter" },
        { id: "lm_head", label: "LM Head Linear", typeLabel: "Op", kind: "op", x: 430, y: 1122, width: 224, height: 54, colorKey: "sem:head" },
        { id: "logits", label: "Logits", typeLabel: "Output", kind: "tensor", x: 430, y: 1192, width: 176, height: 48, colorKey: "io:output" },
      ],
      edges: [
        { source: "input_tokens", target: "token_embedding", tag: "ACT", edgeType: "activation" },
        { source: "token_embedding_weight", target: "token_embedding", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "token_embedding", target: "hidden_states", tag: "H", edgeType: "activation" },
        { source: "hidden_states", target: "attn_norm", tag: "ACT", edgeType: "activation" },
        { source: "qkv_weight", target: "qkv_linear", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "attn_norm", target: "qkv_linear", tag: "QKV", edgeType: "parameter" },
        { source: "kv_cache", target: "scaled_attention", tag: "State", edgeType: "cache", dashed: true },
        { source: "qkv_linear", target: "scaled_attention", tag: "ATTN", edgeType: "activation" },
        { source: "scaled_attention", target: "ffn_norm", tag: "RES", edgeType: "activation" },
        { source: "router_weight", target: "router", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "ffn_norm", target: "router", tag: "ROUTE", edgeType: "activation" },
        { source: "router", target: "topk_expert_select", tag: "TOPK", edgeType: "parameter" },
        { source: "expert_dispatch_buffer", target: "expert_dispatch", tag: "State", edgeType: "state", dashed: true },
        { source: "topk_expert_select", target: "expert_dispatch", tag: "A2A", edgeType: "communication" },
        { source: "expert_dispatch", target: "routed_experts", tag: "EP", edgeType: "communication" },
        { source: "topk_expert_select", target: "shared_expert", tag: "SHARED", edgeType: "activation" },
        { source: "routed_expert_weight", target: "routed_experts", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "shared_expert_weight", target: "shared_expert", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "routed_experts", target: "expert_combine", tag: "WEIGHT", edgeType: "activation" },
        { source: "shared_expert", target: "expert_combine", tag: "SUM", edgeType: "activation" },
        { source: "expert_combine", target: "decoder_output", tag: "ACT", edgeType: "activation" },
        { source: "decoder_output", target: "final_norm", tag: "ACT", edgeType: "activation" },
        { source: "final_norm_gamma", target: "final_norm", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "lm_head_weight", target: "lm_head", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "final_norm", target: "lm_head", tag: "W", edgeType: "parameter" },
        { source: "lm_head", target: "logits", tag: "LOSS", edgeType: "gradient" },
      ],
      trainingEvidence: {
        token_embedding_weight: evidenceItem(null, "parameter tensor", "embedding.weight", "Embedding Weight 是 MoE 主干的参数输入，token ids 通过它变成 hidden states。", [
          "它由 config 形状和权重 shard 共同校准，不是源码文件节点。",
        ], "先确认 vocab/hidden，再看 router 和 expert。", ["token_embedding"], ["config.json", "safetensors.index"]),
        hidden_states: evidenceItem("P2", "tensor", "hidden states", "Hidden States 是 MoE decoder 进入 attention 和 router 之前的激活张量。", [
          "MoE 不是把输入 tensor 变成专家文件，而是在 hidden states 上做 router 选择。",
        ], "先沿 tensor 流解释，再解释 router 和 expert 并行。", ["token_embedding", "attn_norm", "router"]),
        router_weight: evidenceItem(null, "parameter tensor", "router.weight", "Router Weight 是 token 到专家打分的参数输入。", [
          "TopK 选择发生在 router logits 上，和 expert 权重不是一回事。",
        ], "解释负载不均时，把 router 权重、TopK 和 dispatch buffer 分开看。", ["router", "topk_expert_select"], ["MoE config"]),
        expert_dispatch_buffer: evidenceItem(null, "state tensor", "dispatch buffer", "Dispatch Buffer 是 token 按专家分组后跨 rank 发送的运行态状态。", [
          "all-to-all 等待升高时，瓶颈往往出现在这里，而不是单个专家 matmul。",
        ], "结合硬件利用率查看 straggler rank。", ["expert_dispatch"], ["profiling communication trace"]),
        router: evidenceItem("P1", "MoE routing", "topk 8", "Router 为每个 token 选择专家，训练风险从算力转向负载均衡和通信。", [
          "MOE_ARGS 里的 num_experts、moe-router-topk 和 expert-model-parallel-size 必须一起解释。",
          "TopK 增大后，专家通信量和负载不均风险都会上升。",
        ], "监控 expert load、token drop、all-to-all 等待和 straggler rank。", ["router_weight", "topk_expert_select", "expert_dispatch_buffer", "expert_dispatch"]),
        expert_dispatch: evidenceItem("P1", "communication", "EP / all-to-all", "Expert parallel 会把 token 按专家路由到不同 rank，all-to-all 是 MoE 训练的关键通信面。", [
          "EP8 表示专家并行把专家组拆到多卡。",
          "all-to-all 等待升高时，MFU 可能下降但单卡算子并不慢。",
        ], "低 MFU 同时看 all-to-all overlap、expert load 和 rank 间 token 分布。", ["expert_dispatch_buffer", "router", "routed_experts"]),
        expert_combine: evidenceItem("P2", "MoE output", "weighted sum", "专家输出按路由权重合并回 hidden states，再进入后续 norm 和 LM Head。", [
          "Combine 是 MoE 分支回到 dense 流水线的同步点。",
        ], "如果 combine 附近等待高，优先判断是专家负载不均还是通信拓扑问题。", ["routed_expert_weight", "routed_experts", "shared_expert_weight", "shared_expert", "final_norm"]),
        decoder_output: evidenceItem("P2", "tensor", "layer output", "Layer Output 是专家合并后回到主干的数据边界。", [
          "它让 MoE 图重新回到普通 decoder 的后续 Norm、LM Head 和 loss 路径。",
        ], "定位 MoE 训练问题时，把 router/expert 分支和主干输出边界分开看。", ["expert_combine", "final_norm"]),
      },
    };
  }

  function makeDeepSeekTrainingGraph() {
    return {
      width: 1160,
      height: 1360,
      clusters: [
        { id: "transformer", label: "DeepSeek V3.2 Transformer", x: 124, y: 92, width: 682, height: 1120, colorKey: "module:transformer" },
        { id: "decoder_layer", label: "Decoder Layer × 61", x: 158, y: 282, width: 614, height: 852, repeat: 61, colorKey: "module:decoder" },
        { id: "mla_box", label: "MLA + DSA", x: 190, y: 342, width: 550, height: 292, colorKey: "module:mla" },
        { id: "moe_box", label: "MoE FFN", x: 190, y: 704, width: 550, height: 342, colorKey: "module:moe" },
      ],
      nodes: [
        { id: "input_tokens", label: "Token IDs", typeLabel: "Input", kind: "tensor", x: 465, y: 48, width: 176, height: 48, colorKey: "io:input" },
        { id: "token_embedding_weight", label: "Embedding Weight", typeLabel: "Parameter", kind: "tensor", x: 74, y: 150, width: 232, height: 52, colorKey: "io:parameter" },
        { id: "token_embedding", label: "Parallel Embedding", typeLabel: "Op", kind: "op", x: 465, y: 150, width: 260, height: 56, colorKey: "sem:embedding" },
        { id: "hidden_states", label: "Hidden States", typeLabel: "Tensor", kind: "tensor", x: 465, y: 224, width: 210, height: 48, colorKey: "io:activation" },
        { id: "attention_norm", label: "Attention RMSNorm", typeLabel: "Op", kind: "op", x: 465, y: 304, width: 232, height: 54, colorKey: "sem:norm" },
        { id: "query_weight", label: "Query Weight", typeLabel: "Parameter", kind: "tensor", x: 74, y: 398, width: 188, height: 52, colorKey: "io:parameter" },
        { id: "query_projection", label: "Query Projection", typeLabel: "Op", kind: "op", x: 300, y: 398, width: 220, height: 54, colorKey: "sem:linear" },
        { id: "kv_weight", label: "KV Weight", typeLabel: "Parameter", kind: "tensor", x: 74, y: 480, width: 164, height: 52, colorKey: "io:parameter" },
        { id: "kv_projection", label: "KV Projection", typeLabel: "Op", kind: "op", x: 465, y: 398, width: 204, height: 54, colorKey: "sem:linear" },
        { id: "dsa_sparse_index", label: "DSA Sparse Index", typeLabel: "State", kind: "tensor", x: 910, y: 398, width: 222, height: 52, colorKey: "io:state" },
        { id: "dsa_indexer", label: "DSA Indexer", typeLabel: "Module", kind: "op", x: 630, y: 398, width: 204, height: 54, colorKey: "sem:indexer" },
        { id: "sparse_attention", label: "Sparse Attention", typeLabel: "Op", kind: "op", x: 370, y: 498, width: 224, height: 54, colorKey: "sem:attention" },
        { id: "kv_cache", label: "KV Cache", typeLabel: "State", kind: "tensor", x: 910, y: 498, width: 164, height: 52, colorKey: "io:state" },
        { id: "mla_attention", label: "MLA Attention", typeLabel: "Module", kind: "op", x: 560, y: 498, width: 224, height: 54, colorKey: "sem:attention" },
        { id: "attention_output", label: "Attention Output", typeLabel: "Op", kind: "op", x: 465, y: 604, width: 230, height: 54, colorKey: "sem:linear" },
        { id: "ffn_norm", label: "FFN RMSNorm", typeLabel: "Op", kind: "op", x: 465, y: 704, width: 214, height: 54, colorKey: "sem:norm" },
        { id: "router_weight", label: "Router Weight", typeLabel: "Parameter", kind: "tensor", x: 74, y: 788, width: 196, height: 52, colorKey: "io:parameter" },
        { id: "router", label: "Router Linear", typeLabel: "Op", kind: "op", x: 465, y: 788, width: 214, height: 54, colorKey: "sem:router" },
        { id: "topk_expert_select", label: "TopK Expert Select", typeLabel: "Op", kind: "op", x: 465, y: 868, width: 238, height: 54, colorKey: "sem:router" },
        { id: "routed_expert_weight", label: "Routed Expert Weight", typeLabel: "Parameter", kind: "tensor", x: 74, y: 950, width: 242, height: 52, colorKey: "io:parameter" },
        { id: "routed_experts", label: "Routed Experts", typeLabel: "Expert", kind: "op", x: 310, y: 950, width: 204, height: 54, colorKey: "sem:expert" },
        { id: "shared_expert_weight", label: "Shared Expert Weight", typeLabel: "Parameter", kind: "tensor", x: 910, y: 950, width: 246, height: 52, colorKey: "io:parameter" },
        { id: "shared_expert", label: "Shared Expert", typeLabel: "Expert", kind: "op", x: 620, y: 950, width: 204, height: 54, colorKey: "sem:expert" },
        { id: "moe_combine", label: "Expert Combine", typeLabel: "Op", kind: "op", x: 465, y: 1034, width: 214, height: 54, colorKey: "sem:combine" },
        { id: "decoder_output", label: "Layer Output", typeLabel: "Tensor", kind: "tensor", x: 465, y: 1114, width: 204, height: 48, colorKey: "io:activation" },
        { id: "final_norm_gamma", label: "Final Norm Gamma", typeLabel: "Parameter", kind: "tensor", x: 910, y: 1194, width: 206, height: 52, colorKey: "io:parameter" },
        { id: "final_norm", label: "Final RMSNorm", typeLabel: "Op", kind: "op", x: 465, y: 1194, width: 214, height: 54, colorKey: "sem:norm" },
        { id: "lm_head_weight", label: "LM Head Weight", typeLabel: "Parameter", kind: "tensor", x: 74, y: 1274, width: 210, height: 52, colorKey: "io:parameter" },
        { id: "lm_head", label: "LM Head Linear", typeLabel: "Op", kind: "op", x: 348, y: 1274, width: 224, height: 54, colorKey: "sem:head" },
        { id: "mtp_weight", label: "MTP Weight", typeLabel: "Parameter", kind: "tensor", x: 910, y: 1274, width: 172, height: 52, colorKey: "io:parameter" },
        { id: "mtp_head", label: "MTP Head", typeLabel: "Aux", kind: "op", x: 582, y: 1274, width: 196, height: 54, colorKey: "sem:mtp" },
        { id: "logits", label: "Logits", typeLabel: "Output", kind: "tensor", x: 465, y: 1328, width: 176, height: 48, colorKey: "io:output" },
      ],
      edges: [
        { source: "input_tokens", target: "token_embedding", tag: "ACT", edgeType: "activation" },
        { source: "token_embedding_weight", target: "token_embedding", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "token_embedding", target: "hidden_states", tag: "H", edgeType: "activation" },
        { source: "hidden_states", target: "attention_norm", tag: "ACT", edgeType: "activation" },
        { source: "query_weight", target: "query_projection", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "attention_norm", target: "query_projection", tag: "Q", edgeType: "parameter" },
        { source: "kv_weight", target: "kv_projection", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "attention_norm", target: "kv_projection", tag: "KV", edgeType: "parameter" },
        { source: "dsa_sparse_index", target: "dsa_indexer", tag: "State", edgeType: "state", dashed: true },
        { source: "attention_norm", target: "dsa_indexer", tag: "IDX", edgeType: "state" },
        { source: "query_projection", target: "sparse_attention", tag: "Q", edgeType: "activation" },
        { source: "kv_cache", target: "mla_attention", tag: "State", edgeType: "cache", dashed: true },
        { source: "kv_projection", target: "mla_attention", tag: "KV", edgeType: "cache" },
        { source: "dsa_indexer", target: "sparse_attention", tag: "TOPK", edgeType: "state" },
        { source: "sparse_attention", target: "attention_output", tag: "ACT", edgeType: "activation" },
        { source: "mla_attention", target: "attention_output", tag: "LATENT", edgeType: "activation" },
        { source: "attention_output", target: "ffn_norm", tag: "RES", edgeType: "activation" },
        { source: "router_weight", target: "router", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "ffn_norm", target: "router", tag: "ROUTE", edgeType: "activation" },
        { source: "router", target: "topk_expert_select", tag: "TOPK", edgeType: "parameter" },
        { source: "topk_expert_select", target: "routed_experts", tag: "EP64", edgeType: "communication" },
        { source: "topk_expert_select", target: "shared_expert", tag: "SHARED", edgeType: "activation" },
        { source: "routed_expert_weight", target: "routed_experts", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "shared_expert_weight", target: "shared_expert", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "routed_experts", target: "moe_combine", tag: "WEIGHT", edgeType: "activation" },
        { source: "shared_expert", target: "moe_combine", tag: "SUM", edgeType: "activation" },
        { source: "moe_combine", target: "decoder_output", tag: "ACT", edgeType: "activation" },
        { source: "decoder_output", target: "final_norm", tag: "ACT", edgeType: "activation" },
        { source: "final_norm_gamma", target: "final_norm", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "lm_head_weight", target: "lm_head", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "final_norm", target: "lm_head", tag: "W", edgeType: "parameter" },
        { source: "mtp_weight", target: "mtp_head", tag: "Parameter", edgeType: "parameter", dashed: true },
        { source: "final_norm", target: "mtp_head", tag: "MTP", edgeType: "parameter" },
        { source: "lm_head", target: "logits", tag: "LOSS", edgeType: "gradient" },
        { source: "mtp_head", target: "logits", tag: "AUX", edgeType: "gradient" },
      ],
      trainingEvidence: {
        token_embedding_weight: evidenceItem(null, "parameter tensor", "embedding.weight", "Parallel Embedding Weight 是 DeepSeek 输入侧的参数张量。", [
          "它让 token ids 进入隐藏空间，后续 MLA/DSA/MoE 都沿这个 hidden-state 主线展开。",
        ], "不要把模型 README 或 config 文件当作输入节点。", ["token_embedding"], ["config.json", "safetensors.index"]),
        hidden_states: evidenceItem("P2", "tensor", "hidden states", "Hidden States 是 DeepSeek V3.2 中进入 MLA、DSA 和 MoE 的主干激活。", [
          "MLA/DSA/MoE 是在同一条 hidden-state 数据流上分支加工，不是输入文件流。",
        ], "解释复杂模型时先固定 tensor 主线，再讲 MLA、DSA、router 和 MTP。", ["attention_norm", "router"]),
        query_weight: evidenceItem(null, "parameter tensor", "q_proj.weight", "Query Weight 是 MLA/DSA attention 查询侧投影的参数输入。", [
          "它和 KV Weight 一起决定 attention 投影的形状与 TP 切分。",
        ], "低 MFU 时区分投影 matmul、稀疏索引和 attention kernel。", ["query_projection"], ["model code", "config"]),
        kv_weight: evidenceItem(null, "parameter tensor", "kv_proj.weight", "KV Weight 是 MLA 压缩 KV 路径的参数输入。", [
          "DeepSeek 的 KV 路径和普通 dense attention 不同，后续还会进入 latent/cache 结构。",
        ], "把 KV 投影权重、KV cache 和 MLA attention 分开观察。", ["kv_projection", "mla_attention"], ["model code", "config"]),
        dsa_sparse_index: evidenceItem(null, "state tensor", "sparse index", "DSA Sparse Index 是稀疏 attention 选择出的运行态索引。", [
          "它不是模型参数，而是长上下文 attention 阶段的状态对象。",
        ], "索引构建耗时高时，联查 sparse attention 命中率和 HBM。", ["dsa_indexer", "sparse_attention"], ["profiling trace"]),
        kv_cache: evidenceItem(null, "state tensor", "KV cache", "KV Cache 表示 MLA 压缩 KV 路径中保留或重算的状态。", [
          "长上下文成本会从这里传导到 attention 输出和后续 MoE。",
        ], "定位长上下文瓶颈时，把 cache/state 压力和参数读取分开看。", ["mla_attention"], ["profiling trace"]),
        dsa_indexer: evidenceItem("P1", "sparse attention", "DSA", "DSA Indexer 把长上下文注意力变成可索引的稀疏选择问题。", [
          "DeepSeek V3.2 的长上下文不只是 SEQ_LENGTH 变大，还需要 MLA、Sparse Indexer 和 sparse attention 配合。",
          "索引器异常会把问题传导到 attention 输出和后续 MoE。",
        ], "观察 sparse attention 命中率、索引构建耗时和 HBM 压力。", ["dsa_sparse_index", "query_projection", "sparse_attention"]),
        mla_attention: evidenceItem("P1", "attention", "MLA", "MLA 压缩 KV 路径以降低长上下文 KV 压力，是 DeepSeek 图中区别于普通 dense attention 的核心。", [
          "kv latent、rope dim 和 cache 写入会影响解码和长上下文训练成本。",
        ], "若 attention 阶段 MFU 低，先分辨是稀疏索引、KV path 还是输出投影的问题。", ["kv_weight", "kv_cache", "kv_projection", "sparse_attention", "attention_output"]),
        router_weight: evidenceItem(null, "parameter tensor", "router.weight", "Router Weight 决定 token 到专家的打分投影。", [
          "它和 EP64、topk 8 共同影响专家负载，而不是普通 FFN 权重。",
        ], "专家负载不均时，从 router logits 到 TopK 分布一路看。", ["router", "topk_expert_select"], ["MoE config"]),
        router: evidenceItem("P1", "MoE routing", "topk 8 / 256 experts", "Router 决定 token 进入哪些专家，和 EP64、all-to-all、负载均衡直接绑定。", [
          "MODEL_ARGS 中 num-experts=256、topk=8 与 EP64 必须作为同一个训练面解释。",
        ], "低利用率通常先看 expert load 和 all-to-all overlap，不要只看单算子耗时。", ["router_weight", "topk_expert_select", "routed_experts"]),
        moe_combine: evidenceItem("P2", "MoE output", "weighted sum", "Expert Combine 是 MoE 分支回到主干 hidden states 的同步点。", [
          "专家输出合并前后的等待能暴露通信、负载和 pipeline bubble。",
        ], "combine 周边等待高时，联查 EP 拆分、router topk 和 rank 拓扑。", ["routed_expert_weight", "routed_experts", "shared_expert_weight", "shared_expert", "final_norm"]),
        decoder_output: evidenceItem("P2", "tensor", "layer output", "Layer Output 是 DeepSeek decoder 层输出张量，后续进入 Final RMSNorm、LM Head 和 MTP。", [
          "它把复杂的 MLA/DSA/MoE 分支重新收敛到训练 loss 路径。",
        ], "排查梯度或 loss 时，把主 LM Head 与 MTP 辅助头从这个张量边界往后看。", ["final_norm", "lm_head", "mtp_head"]),
        mtp_head: evidenceItem("P2", "auxiliary objective", "MTP", "MTP 是额外的多 token 预测头，训练时会增加输出侧 loss 和梯度路径。", [
          "MTP 不能和主 LM Head 混成一个普通输出节点，它是 DeepSeek 工程复杂度的一部分。",
        ], "解释 loss 曲线时区分主 logits 与 auxiliary loss 对梯度的贡献。", ["mtp_weight", "lm_head", "logits"]),
      },
      // 问题标注：对应进度条上 5 个诊断标记，标在整网图的首个问题节点上
      problemMarkers: [
        { id: "1", nodeId: "router",              diagnosisKey: "moe-a2a",                  label: "问题1：MoE all-to-all 超时", sub: "layer 30 router → rank 23 死锁 → loss NaN" },
        { id: "2", nodeId: "query_tensor",        diagnosisKey: "qproj-overflow",           label: "问题2：q_proj FP8 溢出", sub: "layer 33 q_proj 输入 3.2% 超 FP8 E4M3 max(448)" },
        { id: "3", nodeId: "query_projection",    diagnosisKey: "low-precision-training",    label: "问题3：低精训练 loss 不收敛", sub: "FP8 深层数值退化 → layer 47 偏差起点 → 梯度消失" },
        { id: "4", nodeId: "routed_experts",      diagnosisKey: "nvlink",                   label: "问题4：NVLINK 链路掉线", sub: "node2 GPU3 lane5 inactive → MFU 骤降至 20%" },
        { id: "5", nodeId: "lm_head",             diagnosisKey: "perf-compute-bottleneck",  label: "问题5：lm_head 带宽瓶颈", sub: "vocab 129280 非对齐256 → cube_util 仅 49%" },
        { id: "6", nodeId: "topk_expert_select",  diagnosisKey: "perf-comm-straggler",      label: "问题6：all-to-all 快慢卡", sub: "rank 17/23/41 负载 5× → 步耗时周期性尖峰" },
      ],
    };
  }

  const hardwareProfiles = {
    single8: { label: "8 × Ascend 910B · 1 节点", devices: 64, world: 8, cols: 16, unit: "AI Core 槽位", unitHint: "单节点细粒度视图" },
    cluster64: { label: "64 × Ascend 910B · 8 节点", devices: 64, world: 64, cols: 16, unit: "NPU 卡槽", unitHint: "集群聚合视图" },
    cluster512: { label: "512 × Ascend NPU · 64 节点", devices: 512, world: 512, cols: 32, unit: "NPU 卡槽", unitHint: "集群聚合视图" },
    cluster2048: { label: "2048 × Ascend 910B · 256 节点", devices: 2048, world: 2048, cols: 64, unit: "910B NPU 卡槽", unitHint: "PP8×EP64×DP 集群视图" },
  };

  const phaseSteps = [
    { id: "tokens", label: "Tokens", nodeId: "input_tokens", nodeLabel: "Token IDs", summary: "当前 micro batch 已切成 token ids，准备进入 embedding 查表。" },
    { id: "embedding", label: "Embedding", nodeId: "token_embedding", nodeLabel: "Embedding", summary: "Token IDs 正在映射为 hidden states，词表维度会影响 embedding 和 LM Head。" },
    { id: "attention", label: "Attention", nodeId: "scaled_attention", nodeLabel: "Scaled Attention", summary: "当前层在计算上下文依赖，序列长度会直接放大 attention 计算和 KV 压力。" },
    { id: "mlp", label: "SwiGLU", nodeId: "silu_multiply", nodeLabel: "SwiGLU MLP", summary: "MLP 分支执行 Gate/Up 投影和 SiLU Multiply，是 Dense decoder 的主要算力消耗之一。" },
    { id: "norm", label: "Norm", nodeId: "final_norm", nodeLabel: "Final RMSNorm", summary: "Decoder 输出进入最终 RMSNorm，准备投影到词表 logits。" },
    { id: "logits", label: "Logits", nodeId: "lm_head", nodeLabel: "LM Head", summary: "LM Head 生成 logits，随后进入 loss、反向传播和优化器更新。" },
  ];

  const state = {
    model: "deepseek",
    task: "pretrain",
    hardware: "cluster2048",
    step: 48230,
    totalSteps: 120000,
    stepsPerEpoch: 2000,
    loss: 2.182,
    lossEMA: 2.182,
    val: 2.246,
    mfu: 0.512,
    seen: 3.3e10,
    spike: 0,
    phase: "embedding",
    devices: [],
  };

  const TP_VALUES = [1, 2, 4, 8];
  const PP_VALUES = [1, 2, 4, 8, 16];
  const MB_VALUES = [1, 2, 4, 8];
  const GA_VALUES = [1, 2, 4, 8, 16, 64];
  const baseline = { mfu: 0.512, tokps: 0, eta: 0 };

  function fmtBig(n) {
    if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return Math.round(n).toString();
  }

  function fmtTime(seconds) {
    const safeSeconds = Math.max(0, seconds);
    const days = Math.floor(safeSeconds / 86400);
    const hours = Math.floor((safeSeconds % 86400) / 3600);
    const mins = Math.floor((safeSeconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function seedHistory() {
    let loss = 2.55;
    for (let index = 0; index < 96; index += 1) {
      const t = index / 96;
      loss = 2.55 - 0.42 * t + (Math.random() - 0.5) * 0.04;
    }
    state.loss = loss;
    state.lossEMA = state.loss;
  }

  function resetDevices() {
    const profile = hardwareProfiles[state.hardware];
    state.devices = [];
    for (let index = 0; index < profile.devices; index += 1) {
      let util = rand(0.72, 0.94);
      if (Math.random() < 0.08) util = rand(0.48, 0.68);
      if (Math.random() < 0.12) util = rand(0.94, 0.99);
      state.devices.push({
        util,
        temp: rand(57, 68) + util * 8,
        mem: rand(0.68, 0.86),
        bad: false,
      });
    }
    if (state.devices[37]) {
      state.devices[37].temp = 83;
      state.devices[37].bad = "straggler";
      state.devices[37].util = 0.52;
    }
    if (state.devices[201]) state.devices[201].util = 0.58;
    if (state.devices[330]) state.devices[330].temp = 84;
    renderHeatShell();
  }

  // EP64 列背景色：8 色调循环，区分 64 个 EP rank 所在列
  var EP_TINT_COLORS = [
    "rgba(59,130,246,0.06)", "rgba(16,185,129,0.06)", "rgba(245,158,11,0.06)", "rgba(139,92,246,0.06)",
    "rgba(6,182,212,0.06)", "rgba(239,68,68,0.06)", "rgba(34,197,94,0.06)", "rgba(168,85,247,0.06)"
  ];

  var PP_STAGE_COUNT = 8;
  var PP_COLS_PER_STAGE = 8; // 64 cols / 8 PP stages = 8 cols per stage

  function renderHeatShell(heatEl) {
    const heat = heatEl || $("heat");
    const profile = hardwareProfiles[state.hardware];
    const cols = profile.cols; // 64
    const rows = profile.devices / cols; // 32

    // DP4: 4 组,每组 8 行 × 64 列
    var dpGroups = 4;
    var rowsPerDp = rows / dpGroups; // 8

    heat.style.display = "flex";
    heat.style.flexDirection = "column";
    heat.style.gap = "4px";
    heat.innerHTML = "";

    // PP 阶段标签行
    var ppLabelRow = document.createElement("div");
    ppLabelRow.className = "twin-heat-pp-labels";
    ppLabelRow.style.display = "grid";
    ppLabelRow.style.gridTemplateColumns = "repeat(" + PP_STAGE_COUNT + ", 1fr)";
    ppLabelRow.style.gap = "2px";
    ppLabelRow.style.padding = "0 3px";
    for (var s = 0; s < PP_STAGE_COUNT; s++) {
      var lbl = document.createElement("span");
      lbl.textContent = "Stage" + s;
      lbl.style.textAlign = "center";
      lbl.style.fontSize = "9px";
      lbl.style.fontWeight = "600";
      lbl.style.color = "var(--foreground-muted)";
      ppLabelRow.appendChild(lbl);
    }
    heat.appendChild(ppLabelRow);

    for (var dp = 0; dp < dpGroups; dp++) {
      var dpGroup = document.createElement("div");
      dpGroup.className = "twin-heat-dp-group";
      dpGroup.dataset.dpLabel = "DP" + dp;
      dpGroup.style.display = "grid";
      dpGroup.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
      dpGroup.style.gap = "2px";
      dpGroup.style.padding = "3px";
      dpGroup.style.borderRadius = "4px";
      dpGroup.style.border = "1.5px solid var(--border-default)";

      for (var row = 0; row < rowsPerDp; row++) {
        for (var col = 0; col < cols; col++) {
          var index = dp * rowsPerDp * cols + row * cols + col;
          var ppStage = Math.floor(col / PP_COLS_PER_STAGE);
          var cell = document.createElement("div");
          cell.className = "twin-heat-cell";
          cell.dataset.index = String(index);
          cell.dataset.epRank = String(col);
          cell.dataset.ppStage = String(ppStage);
          cell.style.background = EP_TINT_COLORS[col % EP_TINT_COLORS.length];
          // PP 阶段分界：每 8 列右侧加粗分隔
          if ((col + 1) % PP_COLS_PER_STAGE === 0 && col < cols - 1) {
            cell.style.marginRight = "3px";
            cell.style.boxShadow = "inset -3px 0 0 0 var(--border-strong)";
          }
          dpGroup.appendChild(cell);
        }
      }
      heat.appendChild(dpGroup);
    }

    // EP 标签行：每列是一个 EP rank，只标 EP0, EP8, EP16, ... EP56
    var epLabelRow = document.createElement("div");
    epLabelRow.className = "twin-heat-ep-labels";
    epLabelRow.style.display = "grid";
    epLabelRow.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
    epLabelRow.style.gap = "2px";
    epLabelRow.style.padding = "0 3px";
    for (var c = 0; c < cols; c++) {
      var el = document.createElement("span");
      if (c % 8 === 0) {
        el.textContent = "EP" + c;
      }
      el.style.textAlign = "center";
      el.style.fontSize = "8px";
      el.style.fontWeight = "500";
      el.style.color = "var(--foreground-muted)";
      epLabelRow.appendChild(el);
    }
    heat.appendChild(epLabelRow);
  }

  function renderHeat() {
    var cells = $("heat").querySelectorAll(".twin-heat-cell");
    var profile = hardwareProfiles[state.hardware];
    var cols = profile.cols;
    let peak = 0;
    let thermalRisk = 0;
    let lowUtil = 0;
    let total = 0;
    let totalUtil = 0;
    state.devices.forEach((device, index) => {
      var col = index % cols;
      const targetTemp = 54 + device.util * 23 + (device.bad ? 8 : 0);
      device.temp = clamp(device.temp * 0.86 + (targetTemp + rand(-2.2, 2.2)) * 0.14, 50, 92);
      device.util = clamp(device.util + (Math.random() - 0.5) * 0.025, 0.45, 1);
      peak = Math.max(peak, device.temp);
      total += device.temp;
      totalUtil += device.util;
      if (device.temp > 82 || device.bad) thermalRisk += 1;
      if (device.util < 0.7) lowUtil += 1;
      const cell = cells[index];
      if (!cell) return;
      // 在 EP 底色之上叠加 util 着色（保留 EP rank 列背景作为基底）
      cell.className = "twin-heat-cell";
      cell.style.background = EP_TINT_COLORS[col % EP_TINT_COLORS.length];
      var utilOverlay = "";
      // PP 分界线保留
      var ppShadow = (col + 1) % PP_COLS_PER_STAGE === 0 && col < cols - 1
        ? ", inset -3px 0 0 0 var(--border-strong)" : "";
      if (device.util < 0.7) utilOverlay = "var(--twin-util-low)";
      else if (device.util > 0.92) utilOverlay = "var(--twin-util-high)";
      else utilOverlay = "var(--twin-util-mid)";
      cell.style.boxShadow = "inset 0 0 0 2px " + utilOverlay + ppShadow;
      if (device.temp > 82 || device.bad) cell.classList.add("is-thermal-risk");
      if (device.bad) cell.classList.add("is-straggler");
      var dpGroup = Math.floor(index / (8 * cols)); // DP0~3
      var ppStage = Math.floor(col / PP_COLS_PER_STAGE) + 1;
      var epRank = col + 1;
      const tip = [
        `${profile.unit} ${index}`,
        `node-${Math.floor(index / 8)} / rank-${index}`,
        `算力占用率 ${(device.util * 100).toFixed(0)}%`,
        `温度 ${device.temp.toFixed(0)}°C`,
        `HBM ${(device.mem * 100).toFixed(0)}%`,
        `DP${dpGroup} · Stage${Math.floor(col / 8)} · EP${col}`,
        device.bad ? `风险 ${device.bad}` : "",
      ].filter(Boolean).join("\n");
      cell.dataset.tip = tip;
    });
    const avgUtil = totalUtil / state.devices.length;
    $("hwUtil").textContent = `${(avgUtil * 100).toFixed(0)}%`;
    $("hwLow").textContent = `${lowUtil}`;
    $("hwThermal").textContent = `${thermalRisk}`;
    $("hwThermal").style.color = thermalRisk > 0 ? "var(--danger, #dc2626)" : "";
    $("hwAction").textContent = lowUtil > state.devices.length * 0.05
      ? "查低利用 rank"
      : thermalRisk > 0
        ? "查降频/散热"
        : "继续观察";
  }

  function renderArchitecture() {
    const model = models[state.model];
    $("architectureTitle").textContent = model.title;
    $("architectureMeta").textContent = model.meta;
    const scriptChecks = $("scriptChecks");
    if (scriptChecks) {
      scriptChecks.innerHTML = model.checks.map(([stateValue, title, body]) => (
        `<div class="twin-check" data-state="${stateValue}"><div><strong>${title}</strong><small>${body}</small></div></div>`
      )).join("");
    }
    const stage = $("modelGraphStage");
    if (!stage || !window.PtoModelTrainingGraphvizPattern) return;
    if (graphController && typeof graphController.destroy === "function") {
      graphController.destroy();
    }
    const phase = resolvePhaseInfo(currentPhase());
    graphController = window.PtoModelTrainingGraphvizPattern.render(stage, model.trainingGraph, {
      ariaLabel: `${model.name} training architecture graph`,
      activeNodeId: phase.nodeId,
      activeRelatedNodeIds: phase.relatedNodeIds,
      viewportPadding: 18,
    });
    applyDefaultDiagnosisMarkers();
    applyProblemMarkers(stage, model.trainingGraph);
    const selectedDiagnosis = document.querySelector(".diagnosis-card.is-selected");
    if (selectedDiagnosis) applyDiagnosisFocus(selectedDiagnosis.dataset.diagnosis);
  }

  // 月亮(切到深色)/太阳(切到浅色)图标,与 pangu-moe-trainviz/op-rank-time.html 的 .opv-theme-toggle 一致
  const THEME_TOGGLE_ICONS = {
    toDark: '<path d="M12 3a6.5 6.5 0 0 0 7.8 8.8A8 8 0 1 1 12 3z"></path>',
    toLight: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>',
  };

  function applyTheme(theme, options = {}) {
    currentTheme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = currentTheme;
    document.body.dataset.theme = currentTheme;
    const themeToggle = $("themeToggle");
    const themeToggleIcon = $("themeToggleIcon");
    const toDark = currentTheme === "light";
    const nextMode = toDark ? "深色模式" : "浅色模式";
    if (themeToggle) {
      themeToggle.setAttribute("aria-pressed", String(currentTheme === "light"));
      themeToggle.setAttribute("title", `切换${nextMode}`);
      themeToggle.setAttribute("aria-label", `切换${nextMode}`);
    }
    if (themeToggleIcon) {
      themeToggleIcon.innerHTML = toDark ? THEME_TOGGLE_ICONS.toDark : THEME_TOGGLE_ICONS.toLight;
    }
    if (!options.skipRender) renderArchitecture();
  }

  function toggleTheme() {
    applyTheme(currentTheme === "light" ? "dark" : "light");
  }

  function currentPhase() {
    return phaseSteps.find((phase) => phase.id === state.phase) || phaseSteps[0];
  }

  function resolvePhaseInfo(phase) {
    const model = models[state.model];
    const mapped = model.phaseMap?.[phase.id] || {};
    return {
      ...phase,
      ...mapped,
      nodeId: mapped.nodeId || phase.nodeId,
      nodeLabel: mapped.nodeLabel || phase.nodeLabel,
      summary: mapped.summary || phase.summary,
      relatedNodeIds: mapped.relatedNodeIds || phase.relatedNodeIds || [],
    };
  }

  function currentTokps() {
    const model = models[state.model];
    const profile = hardwareProfiles[state.hardware];
    return Math.max(300, (state.mfu * profile.world * 320e12) / (6 * model.params));
  }

  /* ===== 精度指标图表：loss/acc/precision/recall/grad_norm/corr 六项指标的合成时序卡组 =====
     数据生成与卡片布局在本文件内独立维护；SVG 渲染复用 pangu-moe-trainviz 的
     training-metrics-chart 组件（window.PtoTrainingMetricsChart），不再经 iframe 内嵌整页。
     窗口右边界 = state.step,与页面右上角进度条同一个时钟;每次 tick() 都会重算 accSteps/ACC_DATA,
     六张卡片共用同一份数据与同一个窗口,进度天然保持一致。 */
  const ACC_WINDOW = 200;
  const ACC_STRIDE = Math.max(1, Math.round(state.stepsPerEpoch / 20));
  const ACC_EPOCH_STRIDE = Math.max(1, Math.round(ACC_WINDOW / 8)); // val 仅在若干采样点上有值,其余为 null

  function computeAccSteps() {
    return Array.from({ length: ACC_WINDOW }, (_, i) => state.step - (ACC_WINDOW - 1 - i) * ACC_STRIDE);
  }
  let accSteps = computeAccSteps();

  /* 事故点 + 恢复窗口：step 41230 出现 NaN → AI 重跑定位 → 修复代码 → 恢复训练。
     INCIDENT_STEP 为固定的绝对 step；RECOVERY_STEPS 为恢复所需的步数。
     事故步本身显示 NaN/inf；恢复期内指标从异常值平滑过渡回正常趋势；
     恢复完成后继续朝好的方向发展（loss 降低、acc 升高等）。 */
  const INCIDENT_STEP = 41230;
  const RECOVERY_STEPS = 15;
  const RECOVERY_END = INCIDENT_STEP + RECOVERY_STEPS;

  // 以绝对 step 为种子的确定性伪随机,保证同一 step 无论何时被计算、被哪张卡片引用,取值都一致
  function stepNoise(seed, step, amp) {
    const x = Math.sin(step * 12.9898 + seed * 78.233) * 43758.5453;
    return ((x - Math.floor(x)) * 2 - 1) * amp;
  }

  function metricsAtStep(step, t) {
    const targetLoss = state.loss, targetMfu = state.mfu;
    // 恢复进度：0 = 事故步，1 = 完全恢复
    const recRaw = (step - INCIDENT_STEP - 1) / (RECOVERY_STEPS - 1 || 1);
    const rec = step <= INCIDENT_STEP ? 0 : step >= RECOVERY_END ? 1 : Math.min(1, Math.max(0, recRaw));
    // ease-in-out 平滑过渡
    const ease = rec < 0.5 ? 2 * rec * rec : -1 + (4 - 2 * rec) * rec;
    const atIncident = step === INCIDENT_STEP;
    const inRecovery = step > INCIDENT_STEP && step < RECOVERY_END;

    // 事故步本身：loss NaN / grad_norm inf / 其余指标也 NaN（训练中断）
    // 恢复期：从异常值平滑过渡回正常趋势
    // 恢复后：继续正常训练，趋势朝好的方向发展
    const baseLoss = 3.08 + stepNoise(7, step, 0.06);
    const shockLoss = atIncident ? NaN : inRecovery ? (6.0 * (1 - ease) + baseLoss * ease) : baseLoss;
    const loss = atIncident ? NaN : +(shockLoss).toFixed(3);

    const baseGn = 12.0 + stepNoise(8, step, 0.9);
    const shockGn = atIncident ? Infinity : inRecovery ? (50.0 * (1 - ease) + baseGn * ease) : baseGn;
    const grad_norm = atIncident ? Infinity : +(shockGn).toFixed(2);

    const tlBase = Math.max(0.15, targetLoss * (1.7 - 0.7 * t) + stepNoise(1, step, 0.05));
    const tl = atIncident ? NaN : inRecovery ? (tlBase + 0.8 * (1 - ease)) : tlBase;
    const vlBase = tlBase + 0.05 + stepNoise(2, step, 0.03);
    const vl = atIncident ? NaN : inRecovery ? (vlBase + 0.5 * (1 - ease)) : vlBase;

    const taBase = clamp(1 - tlBase / 6, 0.05, 0.99);
    const ta = atIncident ? NaN : inRecovery ? (taBase - 0.12 * (1 - ease)) : taBase;
    const vaBase = clamp(1 - vlBase / 6, 0.05, 0.99);
    const va = atIncident ? NaN : inRecovery ? (vaBase - 0.08 * (1 - ease)) : vaBase;

    const mfBase = clamp(targetMfu * (0.72 + 0.28 * t) + stepNoise(3, step, 0.015), 0.05, 0.9);
    const mf = atIncident ? 0 : inRecovery ? (mfBase * ease) : mfBase;

    const pcBase = clamp(0.62 + 0.3 * t + stepNoise(4, step, 0.02), 0.05, 0.99);
    const pc = atIncident ? NaN : inRecovery ? (pcBase - 0.1 * (1 - ease)) : pcBase;
    const rcBase = clamp(0.58 + 0.32 * t + stepNoise(5, step, 0.024), 0.05, 0.99);
    const rc = atIncident ? NaN : inRecovery ? (rcBase - 0.1 * (1 - ease)) : rcBase;

    const crBase = clamp(0.7 + 0.28 * t + stepNoise(6, step, 0.02), -0.3, 0.999);
    const cr = atIncident ? NaN : inRecovery ? (crBase - 0.15 * (1 - ease)) : crBase;

    // HBM 显存利用率：事故步跌至 0（训练中断），恢复期从低位回升，恢复后继续正常波动
    const memBase = clamp(0.72 + 0.12 * t + stepNoise(11, step, 0.025), 0.45, 0.95);
    const avg_mem = atIncident ? 0 : inRecovery ? (memBase * ease) : memBase;

    // 单卡重跑同一 step(定位链.md 案例一 · 分叉判定):不经历多卡 all-to-all,不受事故影响,全程健康——
    // loss≈3.21、grad_norm≈11.8,用于和上面的多卡曲线对照,证明问题只在多卡复现。
    const loss_single = +(3.21 + stepNoise(9, step, 0.05)).toFixed(3);
    const grad_norm_single = +(11.8 + stepNoise(10, step, 0.7)).toFixed(2);
    return {
      train_loss: +tl.toFixed(4), val_loss: +vl.toFixed(4),
      train_acc: +ta.toFixed(4), val_acc: +va.toFixed(4),
      mfu: +mf.toFixed(4), precision: +pc.toFixed(4), recall: +rc.toFixed(4),
      rollout_actor_probs_pearson_corr: +cr.toFixed(4),
      avg_mem: +avg_mem.toFixed(4),
      loss, grad_norm, loss_single, grad_norm_single,
    };
  }

  function buildAccuracyData(steps) {
    const n = steps.length;
    const cols = { train_loss: [], val_loss: [], train_acc: [], val_acc: [], mfu: [], precision: [], recall: [], rollout_actor_probs_pearson_corr: [], avg_mem: [], loss: [], grad_norm: [], loss_single: [], grad_norm_single: [] };
    steps.forEach((s, i) => {
      const m = metricsAtStep(s, n > 1 ? i / (n - 1) : 1);
      const isEpoch = i % ACC_EPOCH_STRIDE === 0 || i === n - 1;
      cols.train_loss.push(m.train_loss);
      cols.val_loss.push(isEpoch ? m.val_loss : null);
      cols.train_acc.push(m.train_acc);
      cols.val_acc.push(isEpoch ? m.val_acc : null);
      cols.mfu.push(m.mfu);
      cols.precision.push(m.precision);
      cols.recall.push(m.recall);
      cols.rollout_actor_probs_pearson_corr.push(m.rollout_actor_probs_pearson_corr);
      cols.avg_mem.push(m.avg_mem);
      cols.loss.push(m.loss);
      cols.grad_norm.push(m.grad_norm);
      cols.loss_single.push(m.loss_single);
      cols.grad_norm_single.push(m.grad_norm_single);
    });
    return cols;
  }

  let ACC_DATA = null; // 首次 initAccuracyCharts() 时基于 seedHistory() 之后的 state 生成,此后每次 tick() 随 accSteps 一起刷新

  function refreshAccuracyData() {
    accSteps = computeAccSteps();
    ACC_DATA = buildAccuracyData(accSteps);
  }

  const fmtAccPct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

  const ACC_CARD_DEFS = [
    { id: "loss", name: "loss", legend: true,
      formatValue: (v) => (v == null ? "—" : v.toFixed(3)),
      tipCarryForward: false, markerStep: INCIDENT_STEP,
      series: [
        { id: "train_loss", label: "train loss", key: "train_loss", colorVar: "--twin-chart-loss" },
        { id: "val_loss", label: "val loss", key: "val_loss", colorVar: "--twin-chart-gradnorm", emphasis: true },
      ] },
    { id: "acc", name: "acc", legend: true, formatValue: fmtAccPct, series: [
      { id: "train_acc", label: "train acc", key: "train_acc", colorVar: "--twin-chart-acc" },
      { id: "val_acc", label: "val acc", key: "val_acc", colorVar: "--twin-chart-loss", emphasis: true },
    ] },
    { id: "precision", name: "precision", legend: false, note: "预测正例中的准确率", formatValue: fmtAccPct, series: [
      { id: "precision", label: "precision", key: "precision", colorVar: "--twin-chart-precision", emphasis: true },
    ] },
    { id: "recall", name: "recall", legend: false, note: "真实正例的召回率", formatValue: fmtAccPct, series: [
      { id: "recall", label: "recall", key: "recall", colorVar: "--twin-chart-recall", emphasis: true },
    ] },
    { id: "gradnorm", name: "grad_norm", legend: false,
      note: `step ${INCIDENT_STEP} MoE all-to-all 超时 → grad_norm 跳至 inf，AI 定位修复后 ${RECOVERY_STEPS} 步内恢复`,
      formatValue: (v) => (v == null ? "—" : !isFinite(v) ? "inf" : v.toFixed(2)),
      tipCarryForward: false, markerStep: INCIDENT_STEP,
      series: [
        { id: "gradnorm", label: "grad_norm", key: "grad_norm", colorVar: "--twin-chart-gradnorm", emphasis: true },
      ] },
    { id: "corr", name: "rollout_actor_probs_pearson_corr", legend: false, note: "rollout 与训练 actor 概率相关系数", formatValue: (v) => (v == null ? "—" : v.toFixed(3)), series: [
      { id: "corr", label: "pearson corr", key: "rollout_actor_probs_pearson_corr", colorVar: "--twin-chart-corr", emphasis: true },
    ] },
  ];

  const INFRA_CARD_DEFS = [
    { id: "mfu", name: "MFU", legend: false,
      note: "Model FLOPS Utilization · 训练算力利用效率",
      formatValue: (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`),
      series: [
        { id: "mfu", label: "MFU", key: "mfu", colorVar: "--twin-chart-mfu", emphasis: true },
      ] },
    { id: "avg_mem", name: "显存利用率", legend: false,
      note: "HBM 平均占用率 · 跨卡均值",
      formatValue: (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`),
      series: [
        { id: "avg_mem", label: "HBM", key: "avg_mem", colorVar: "--twin-chart-mem", emphasis: true },
      ] },
  ];

  let accSmoothing = 0.1;
  let accCards = []; // [{cfg, valEl, wrap, ctrl, size}]

  function buildAccLegend(series) {
    const legendEl = document.createElement("div");
    legendEl.className = "twin-accuracy-legend";
    series.forEach((s) => {
      const item = document.createElement("span");
      const swatch = document.createElement("i");
      swatch.style.background = `var(${s.colorVar})`;
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(s.label));
      legendEl.appendChild(item);
    });
    return legendEl;
  }

  function buildAccCard(cfg) {
    const card = document.createElement("div");
    card.className = "twin-accuracy-metric-card";
    const head = document.createElement("div");
    head.className = "twin-accuracy-metric-card__head";
    const name = document.createElement("span");
    name.className = "twin-accuracy-metric-card__name";
    name.textContent = cfg.name;
    const val = document.createElement("span");
    val.className = "twin-accuracy-metric-card__val";
    val.textContent = "—";
    head.appendChild(name);
    head.appendChild(val);
    card.appendChild(head);
    if (cfg.legend) {
      card.appendChild(buildAccLegend(cfg.series));
    } else if (cfg.note) {
      const note = document.createElement("div");
      note.className = "twin-accuracy-metric-card__note";
      note.textContent = cfg.note;
      card.appendChild(note);
    }
    const wrap = document.createElement("div");
    wrap.className = "twin-accuracy-metric-card__chart";
    card.appendChild(wrap);
    return { card, valEl: val, wrap };
  }

  // 单一渲染入口:「关键指标」面板和「问题一 · 迭代层」都用它渲染 loss/grad_norm,
  // 共享同一份 cfg(steps/data/regions/markerStep 引用相同对象)与同一个 accSmoothing,
  // 两处图表天然保持完全联动,不需要另外做同步。
  function renderMetricChart(el, cfg, w, h) {
    if (!window.PtoTrainingMetricsChart || !el) return null;
    const steps = cfg.steps || accSteps;
    let ctrl = null;
    // regions 标记事故+恢复窗口（而非从事故点一直拉到图表末尾）
    const regions = cfg.markerStep != null
      ? [{ start: cfg.markerStep, end: Math.min(RECOVERY_END, steps[steps.length - 1]), label: "事故 · 恢复" }]
      : (cfg.regions || null);
    const renderOpts = {
      steps,
      series: cfg.series.map((s) => ({ axis: "left", ...s })),
      data: cfg.data || ACC_DATA,
      regions,
      cursor: cfg.markerStep != null ? cfg.markerStep : null,
      smoothing: accSmoothing,
      cursorTooltip: true,
      tipCarryForward: cfg.tipCarryForward !== false,
      formatValue: cfg.formatValue,
      options: { width: w, height: h, pad: { t: 14, r: 10, b: 20, l: 40 }, xTicks: 4 },
      onBrush: false,
      // 图例固定不走引擎内置(会作为额外 DOM 追加进被测量高度的容器,配合 auto-height 造成"越拉越高"的循环增长);
      // 需要图例时改由调用方在容器外自行渲染(见 mountLocateMetricCharts 的 buildAccLegend)
      legend: false,
    };
    // 精度 6 图联动：鼠标悬浮任一图表时同步游标 + 指标气泡到所有精度图表
    renderOpts.onCursorHover = (step) => {
      accCards.forEach((c) => { if (c.ctrl) { c.ctrl.setCursor(step); c.ctrl.setTooltip(true); } });
    };
    // 鼠标离开后收起所有图表的气泡；对于有 markerStep 的图表（loss / grad_norm）收回问题点
    renderOpts.onCursorLeave = () => {
      accCards.forEach((c) => { if (c.ctrl) c.ctrl.setTooltip(false); });
      if (cfg.markerStep != null && ctrl) ctrl.setCursor(cfg.markerStep);
    };
    ctrl = window.PtoTrainingMetricsChart.render(el, renderOpts);
    return ctrl;
  }

  function syncAccCard(card, force) {
    const w = Math.round(card.wrap.clientWidth || 0);
    const h = Math.round(card.wrap.clientHeight || 0);
    if (w < 2 || h < 2) return;
    if (!force && card.ctrl && w === card.size.w && h === card.size.h) return;
    card.size = { w, h };
    card.ctrl = renderMetricChart(card.wrap, card.cfg, w, h);
  }

  function syncAccCards(force) {
    accCards.forEach((c) => syncAccCard(c, force));
  }

  function renderAccReadouts() {
    accCards.forEach((c) => {
      const steps = c.cfg.steps || accSteps;
      const data = c.cfg.data || ACC_DATA;
      const v = data[c.cfg.series[0].key][steps.length - 1];
      c.valEl.textContent = c.cfg.formatValue ? c.cfg.formatValue(v) : (v == null ? "—" : v);
      const txt = c.valEl.textContent;
      c.valEl.classList.toggle("is-danger", txt === "NaN" || txt === "inf");
    });
  }

  function buildAccuracySmoothControl() {
    const wrap = document.createElement("div");
    wrap.className = "twin-accuracy-smooth";
    const lab = document.createElement("span");
    lab.textContent = "smoothing";
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "95";
    range.step = "1";
    range.value = String(Math.round(accSmoothing * 100));
    range.setAttribute("aria-label", "曲线平滑度");
    const out = document.createElement("output");
    out.textContent = accSmoothing.toFixed(2);
    range.addEventListener("input", () => {
      accSmoothing = (+range.value) / 100;
      out.textContent = accSmoothing.toFixed(2);
      syncAccCards(true);
      syncLocateMetricCharts(true);
      renderCase6MetricCharts(); // 问题二迭代层的 loss/grad_norm 也随滑条重画(无对应容器时内部自动跳过)
    });
    wrap.appendChild(lab);
    wrap.appendChild(range);
    wrap.appendChild(out);
    return wrap;
  }

  function initAccuracyCharts() {
    const host = $("accuracyCharts");
    const smoothSlot = $("accuracySmoothSlot");
    if (!host || !window.PtoTrainingMetricsChart) return;
    refreshAccuracyData();
    host.innerHTML = "";
    if (smoothSlot) {
      smoothSlot.innerHTML = "";
      smoothSlot.appendChild(buildAccuracySmoothControl());
    }
    const cardsWrap = document.createElement("div");
    cardsWrap.className = "twin-accuracy-cards";
    accCards = ACC_CARD_DEFS.map((cfg) => {
      const b = buildAccCard(cfg);
      cardsWrap.appendChild(b.card);
      return { cfg, valEl: b.valEl, wrap: b.wrap, ctrl: null, size: { w: 0, h: 0 } };
    });
    host.appendChild(cardsWrap);
    syncAccCards(true);
    requestAnimationFrame(() => syncAccCards(true));
    renderAccReadouts();
  }

  // ── infra 图表（MFU / 显存利用率）────────────────────────────────────────
  let infraCards = []; // [{cfg, valEl, wrap, ctrl, size}]

  function syncInfraCard(card, force) {
    const w = Math.round(card.wrap.clientWidth || 0);
    const h = Math.round(card.wrap.clientHeight || 0);
    if (w < 2 || h < 2) return;
    if (!force && card.ctrl && w === card.size.w && h === card.size.h) return;
    card.size = { w, h };
    card.ctrl = renderMetricChart(card.wrap, card.cfg, w, h);
  }

  function syncInfraCards(force) {
    infraCards.forEach((c) => syncInfraCard(c, force));
  }

  function renderInfraReadouts() {
    infraCards.forEach((c) => {
      const steps = c.cfg.steps || accSteps;
      const data = c.cfg.data || ACC_DATA;
      const v = data[c.cfg.series[0].key][steps.length - 1];
      c.valEl.textContent = c.cfg.formatValue ? c.cfg.formatValue(v) : (v == null ? "—" : v);
    });
  }

  function initInfraCharts() {
    const host = $("infraCharts");
    if (!host || !window.PtoTrainingMetricsChart) return;
    host.innerHTML = "";
    const cardsWrap = document.createElement("div");
    cardsWrap.className = "twin-accuracy-cards";
    cardsWrap.style.gridTemplateRows = "1fr"; // 单行 2 列
    infraCards = INFRA_CARD_DEFS.map((cfg) => {
      const b = buildAccCard(cfg);
      cardsWrap.appendChild(b.card);
      return { cfg, valEl: b.valEl, wrap: b.wrap, ctrl: null, size: { w: 0, h: 0 } };
    });
    host.appendChild(cardsWrap);
    syncInfraCards(true);
    requestAnimationFrame(() => syncInfraCards(true));
    renderInfraReadouts();
  }

  function renderVitals() {
    const acc = clamp(1 - state.loss / 6, 0, 1);
    const accEMA = clamp(1 - state.lossEMA / 6, 0, 1);
    const avgMem = state.devices.length
      ? state.devices.reduce((sum, device) => sum + device.mem, 0) / state.devices.length
      : 0;
    setText("vAcc", `${(acc * 100).toFixed(1)}%`);
    setText("vAccSub", `ema ${(accEMA * 100).toFixed(1)}%`);
    setText("vLoss", state.loss.toFixed(3));
    setText("vLossSub", `val ${state.val.toFixed(3)} · ema ${state.lossEMA.toFixed(3)}`);
    setText("vMfu", `${(state.mfu * 100).toFixed(1)}%`);
    setText("vMem", `${(avgMem * 100).toFixed(1)}%`);
    setText("vMemSub", `HBM avg / ${state.devices.length} 卡`);
  }

  function renderProgress() {
    const pct = clamp(state.step / state.totalSteps, 0, 1);
    const epoch = Math.floor(state.step / state.stepsPerEpoch) + 1;
    const totalEpochs = Math.ceil(state.totalSteps / state.stepsPerEpoch);
    $("progressPct").textContent = `${(pct * 100).toFixed(1)}%`;
    $("progressFill").style.width = `${(pct * 100).toFixed(2)}%`;
    $("progressStepCurrent").textContent = state.step.toLocaleString();
    $("progressStepTotal").textContent = state.totalSteps.toLocaleString();
    $("progressEpoch").textContent = `${epoch} / ${totalEpochs}`;
    renderDiagnosisMarkers();
  }

  const artifacts = [
    { name: "ckpt-500", meta: "loss 0.44" },
    { name: "ckpt-400", meta: "loss 0.46" },
    { name: "ckpt-300", meta: "loss 0.50" },
    { name: "ckpt-200", meta: "loss 0.55" },
  ];

  function renderArtifacts() {
    const node = $("artifacts");
    let bestIdx = 0;
    let bestLoss = Infinity;
    artifacts.forEach((a, i) => {
      const m = a.meta.match(/loss ([\d.]+)/);
      if (m) { const v = parseFloat(m[1]); if (v < bestLoss) { bestLoss = v; bestIdx = i; } }
    });
    node.innerHTML = artifacts.map((artifact, i) => `
      <div class="twin-artifact">
        <span class="twin-artifact-main">
          <span class="twin-artifact-name">${artifact.name}</span>
          <span class="twin-artifact-meta">${artifact.meta}</span>
        </span>
        ${i === bestIdx ? '<span class="twin-artifact-badge">最佳</span>' : ""}
      </div>`).join("");
  }

  const eventPool = [
    ["ok", "checkpoint 写入完成 · step {s} · 用时 41s"],
    ["ok", "loss EMA 持续下降 · 收敛正常"],
    ["info", "梯度同步耗时 11.2ms · overlap 92%"],
    ["warn", "node-{r} device{g} 结温 84°C · 触发降频预警"],
    ["warn", "straggler 检测 · node-37 落后 1.8x"],
    ["info", "数据分片 shard-{r} 预取完成"],
  ];

  function clock() {
    return new Date().toTimeString().slice(0, 8);
  }

  function pushEvent(sev, text) {
    const feed = $("feed");
    const el = document.createElement("div");
    el.className = "twin-event";
    el.dataset.sev = sev;
    el.innerHTML = `<i></i><div class="twin-event-body"><time>${clock()}</time><span>${text}</span></div>`;
    feed.insertBefore(el, feed.firstChild);
    while (feed.children.length > 4) feed.removeChild(feed.lastChild);
  }

  function seedEvents() {
    $("feed").innerHTML = "";
    for (let index = 0; index < 4; index += 1) {
      const event = eventPool[Math.floor(rand(0, eventPool.length))];
      pushEvent(event[0], event[1].replace("{s}", state.step - index * 40).replace("{r}", Math.floor(rand(0, 64))).replace("{g}", Math.floor(rand(0, 8))));
    }
  }

  function modelMFU(config) {
    let mfu = 0.58;
    mfu -= (config.TP - 1) * 0.012;
    const bubble = (config.PP - 1) / (config.GA + config.PP - 1);
    mfu *= 1 - bubble * 0.6;
    if (config.MB < 2) mfu *= 0.9;
    return { mfu: clamp(mfu, 0.12, 0.62), bubble };
  }

  function renderWhatIf() {
    if (!$("rTP")) return;   // What-if 已改为「训练信息」静态展示，无滑块时跳过
    const config = {
      TP: TP_VALUES[Number($("rTP").value)],
      PP: PP_VALUES[Number($("rPP").value)],
      MB: MB_VALUES[Number($("rMB").value)],
      GA: GA_VALUES[Number($("rGA").value)],
    };
    $("lTP").textContent = config.TP;
    $("lPP").textContent = config.PP;
    $("lMB").textContent = config.MB;
    $("lGA").textContent = config.GA;
    const model = models[state.model];
    const profile = hardwareProfiles[state.hardware];
    const { mfu, bubble } = modelMFU(config);
    const tokps = Math.max(300, (profile.world * 312e12 * mfu) / (6 * model.params));
    const eta = (model.target - state.seen) / tokps;
    $("oMfu").textContent = `${(mfu * 100).toFixed(1)}%`;
    $("oTok").textContent = fmtBig(tokps);
    $("oEta").textContent = fmtTime(eta);
    $("oBub").textContent = `${(bubble * 100).toFixed(0)}%`;
    $("dMfu").textContent = `${((mfu - baseline.mfu) / baseline.mfu * 100).toFixed(0)}% vs 当前`;
    $("dTok").textContent = `${((tokps - baseline.tokps) / baseline.tokps * 100).toFixed(0)}% vs 当前`;
    $("dEta").textContent = `${((eta - baseline.eta) / baseline.eta * 100).toFixed(0)}% vs 当前`;
  }

  function tick() {
    state.step += 2;
    if (Math.random() < 0.025 && state.spike < 0.2) {
      state.spike = rand(0.45, 0.95);
      pushEvent("crit", `loss spike 检测 · ${(state.loss + rand(0.1, 0.28)).toFixed(3)} · 建议检查数据和梯度`);
    }
    const target = Math.max(1.55, state.lossEMA - 0.0008);
    state.loss = target + (Math.random() - 0.5) * 0.03 + state.spike * rand(0.05, 0.18);
    state.lossEMA = state.lossEMA * 0.98 + state.loss * 0.02;
    state.spike *= 0.78;
    state.val = state.lossEMA + 0.06 + (Math.random() - 0.5) * 0.015;
    state.mfu = clamp(0.512 + (Math.random() - 0.5) * 0.04 - state.spike * 0.05, 0.3, 0.62);
    state.seen += currentTokps();
    if (Math.random() < 0.45) {
      const event = eventPool[Math.floor(rand(0, eventPool.length))];
      pushEvent(event[0], event[1].replace("{s}", state.step).replace("{r}", Math.floor(rand(0, 64))).replace("{g}", Math.floor(rand(0, 8))));
    }
    renderAll();
    // 精度图表窗口跟着 state.step 一起往前滑,和右上角进度条同一个时钟
    refreshAccuracyData();
    syncAccCards(true);
    syncInfraCards(true);
    syncLocateMetricCharts(true);
    renderAccReadouts();
    renderInfraReadouts();
  }

  function renderAll() {
    renderVitals();
    renderProgress();
    renderHeat();
    if (activeLocateCase) syncLocateInfraHeat(activeLocateCase); // infra 示意图跟随集群热力图同步刷新
    renderWhatIf();
  }

  function applyModel(modelKey) {
    state.model = modelKey;
    document.body.dataset.model = modelKey;
    document.querySelectorAll("[data-model-option]").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.modelOption === modelKey);
    });
    state.seen = models[modelKey].target * 0.42;
    renderArchitecture();
    renderAll();
  }

  function applyTask(taskKey) {
    state.task = taskKey;
    document.body.dataset.task = taskKey;
    document.querySelectorAll("[data-task-option]").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.taskOption === taskKey);
    });
  }

  function applyHardware(profileKey) {
    state.hardware = profileKey;
    document.body.dataset.hardware = profileKey;
    document.querySelectorAll("[data-hardware-option]").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.hardwareOption === profileKey);
    });
    $("hardwareSummary").textContent = `${hardwareProfiles[profileKey].label}，每格为${hardwareProfiles[profileKey].unit}。`;
    resetDevices();
    baseline.tokps = currentTokps();
    baseline.eta = (models[state.model].target - state.seen) / baseline.tokps;
    renderAll();
  }

  const diagnosisCases = {
    "moe-a2a": {
      layer: "Layer 30 · MoE Router",
      nodeIds: ["router_gate", "router_weight", "routed_expert_bank", "shared_expert_mlp", "moe_all_to_all_dispatch", "moe_all_to_all_combine"],
      edges: [
        ["router_gate", "moe_all_to_all_dispatch"],
        ["moe_all_to_all_dispatch", "routed_expert_bank"],
        ["routed_expert_bank", "moe_all_to_all_combine"],
        ["shared_expert_mlp", "moe_all_to_all_combine"]
      ],
      clusterIds: ["moe-block"],
      note: "Router → all-to-all dispatch → Routed Experts → all-to-all combine。EP rank 23 死锁,其余 rank 空等超时。",
    },
    "qproj-overflow": {
      layer: "Layer 33 · GQA Attention",
      nodeIds: ["query_tensor", "attention_core", "o_proj"],
      edges: [
        ["query_tensor", "attention_core"],
        ["attention_core", "o_proj"]
      ],
      clusterIds: ["attention-block"],
      note: "q_proj Linear[4608→12288] 输入 3.2% 元素超 FP8 E4M3 max(448),扩张投影放大 → attention softmax 进一步放大。",
    },
    nvlink: {
      layer: null,
      nodeIds: ["moe_all_to_all_dispatch", "moe_all_to_all_combine", "attention_all_gather", "attention_reduce_scatter"],
      edges: [
        ["moe_all_to_all_dispatch", "moe_all_to_all_combine"],
        ["attention_all_gather", "attention_reduce_scatter"]
      ],
      clusterIds: ["decoder-stack"],
      note: "HCCS lane 5 inactive → HCCL 从高速互联回退至 RoCE 慢路径,all-to-all 耗时 8×,PP pipeline 被拖慢。",
    },
    "perf-compute-bottleneck": {
      layer: "Output / Head 区",
      nodeIds: ["lm_head", "final_norm", "token_embedding"],
      edges: [
        ["final_norm", "lm_head"],
        ["token_embedding", "lm_head"]
      ],
      note: "LM Head → Logits 路径。vocab 非对齐致 cube_util 仅 49%,AICPU 回退 526ms。",
    },
    "perf-comm-straggler": {
      layer: "MoE FFN 区",
      nodeIds: ["router_gate", "router_weight", "routed_expert_bank", "shared_expert_mlp", "moe_all_to_all_dispatch", "moe_all_to_all_combine"],
      edges: [
        ["router_gate", "routed_expert_bank"],
        ["routed_expert_bank", "moe_all_to_all_combine"],
        ["moe_all_to_all_dispatch", "routed_expert_bank"]
      ],
      clusterIds: ["moe-block"],
      note: "Router gate bias 漂移 → 热点 rank 承接 5× token → all-to-all 尾延迟恶化。",
    },
    "low-precision-training": {
      layer: "Layer 47 深层",
      nodeIds: ["query_tensor", "attention_core", "shared_expert_mlp", "routed_expert_bank"],
      edges: [
        ["query_tensor", "attention_core"],
        ["shared_expert_mlp", "moe_all_to_all_combine"]
      ],
      clusterIds: ["attention-block", "moe-block"],
      note: "FP8 E4M3 深层激活值长尾超限 → 峰度 +15.3 → 梯度信号淹没。",
    },
  };

  // 进度条诊断标记:step 在 0~totalSteps 范围内,百分比自动换算
  const diagnosisMarkers = [
    { key: "moe-a2a", step: INCIDENT_STEP, severity: "p0", category: "精度", num: "一", label: "MoE all-to-all 超时 → loss NaN", sub: "layer 30 router 98% token → expert 47, EP23 死锁" },
    { key: "qproj-overflow", step: 8500, severity: "p1", category: "精度", num: "二", label: "q_proj FP8 精度溢出 → grad_norm 发散", sub: "layer 33 q_proj 3.2% 超 FP8 max(448)" },
    { key: "low-precision-training", stepFrom: 28000, stepTo: 35000, severity: "p1", category: "精度", num: "三", label: "低精训练 loss 不收敛 → 梯度消失", sub: "FP8 E4M3 深层激活值长尾, 峰度 +15.3, SNR 降至 6.8dB" },
    { key: "nvlink", step: 20000, severity: "p1", category: "Infra", num: "四", label: "HCCS 链路掉线 → MFU 骤降", sub: "node2 NPU3 lane5 inactive, HCCL 回退 RoCE 慢路径" },
    { key: "perf-compute-bottleneck", stepFrom: 20000, stepTo: 120000, severity: "p1", category: "性能", num: "五", label: "算子带宽瓶颈 + AICPU 回退", sub: "lm_head vocab 非对齐, cube_util 49%, AICPU 526ms" },
    { key: "perf-comm-straggler", step: 18427, severity: "p1", category: "性能", num: "六", label: "MoE all-to-all 快慢卡 → 步耗时尖峰", sub: "gate bias 漂移 rank 17/23/41 承接 5× token" },
  ];

  function renderDiagnosisMarkers() {
    const track = document.getElementById('progressTrack');
    if (!track) return;
    // 问题点标注改为进度条内的「带白边纵向线」,直接用百分比定位,无需测量几何
    track.querySelectorAll('.twin-progress-marker').forEach((el) => el.remove());
    const total = state.totalSteps || 120000;
    diagnosisMarkers.forEach((m) => {
      const firstStep = m.stepFrom != null ? m.stepFrom : m.step;
      const pct = clamp(firstStep / total, 0, 1);
      const mk = document.createElement('div');
      mk.className = `twin-progress-marker is-${m.severity}`;
      mk.style.left = (pct * 100).toFixed(2) + '%';
      mk.dataset.markerKey = m.key;
      track.appendChild(mk);
    });
  }

  function markNodeActive(stage, nodeId, className) {
    const group = stage?.querySelector(`[data-node-id="${nodeId}"]`);
    if (!group) return;
    group.classList.add(className);
    if (className !== "pto-diagnosis-active" || group.querySelector(".pto-diagnosis-pulse-ring")) return;
    const rect = group.querySelector("rect");
    if (!rect) return;
    const ring = rect.cloneNode(false);
    ring.removeAttribute("fill");
    ring.removeAttribute("fill-opacity");
    ring.setAttribute("class", "pto-diagnosis-pulse-ring");
    group.appendChild(ring);
  }

  function markEdgeActive(stage, source, target, className) {
    stage?.querySelector(`[data-source="${source}"][data-target="${target}"]`)?.classList.add(className);
  }

  function markClusterActive(stage, clusterId, className) {
    var cluster = stage?.querySelector('[data-cluster-id="' + clusterId + '"]');
    if (!cluster) return;
    cluster.classList.add(className);
  }

  // 常态标红 + 问题序号徽标:页面加载后在 #graphStage（新整网图）上标出诊断案例命中的节点/连线/Cluster,
  // 并在第一个命中节点旁画红色胶囊序号徽标
  function applyDefaultDiagnosisMarkers() {
    var stage = document.getElementById('graphStage');
    if (!stage) return;
    var NS = "http://www.w3.org/2000/svg";
    var tip = document.getElementById("diagnosisTooltip");

    // 已放置徽标的 bounding box 列表,用于避让
    var placedBadges = [];

    function drawBadge(nodeGroup, marker, color) {
      var rect = nodeGroup.querySelector("rect");
      if (!rect) return;
      var dims = { w: parseFloat(rect.getAttribute("width") || "0"), h: parseFloat(rect.getAttribute("height") || "0") };
      if (!dims.w) return;

      var FS = 18, PILLH = 32, PADX = 12, GAP = 4;
      var labelText = "问题" + marker.num;

      var tmpLabel = document.createElementNS(NS, "text");
      tmpLabel.setAttribute("font-size", FS);
      tmpLabel.setAttribute("font-weight", "700");
      tmpLabel.setAttribute("font-family", "system-ui, sans-serif");
      tmpLabel.textContent = labelText;
      nodeGroup.appendChild(tmpLabel);
      var tw = 0;
      try { tw = tmpLabel.getBBox().width; } catch (e) { tw = labelText.length * FS * 0.62; }
      nodeGroup.removeChild(tmpLabel);

      var pillW = PADX + tw + PADX;
      // 贴在节点上方，不遮挡节点本体
      var pillLeft = -dims.w / 2;
      var pillTop = -dims.h / 2 - PILLH - GAP;

      // 避让：重叠时往上堆叠
      var badgeBox = { left: pillLeft, top: pillTop, width: pillW, height: PILLH };
      for (var i = 0; i < placedBadges.length; i++) {
        var placed = placedBadges[i];
        var overlapX = badgeBox.left < placed.left + placed.width && badgeBox.left + badgeBox.width > placed.left;
        var overlapY = badgeBox.top < placed.top + placed.height && badgeBox.top + badgeBox.height > placed.top;
        if (overlapX && overlapY) {
          badgeBox.top = placed.top - PILLH - GAP;
          pillTop = badgeBox.top;
        }
      }
      placedBadges.push(badgeBox);

      var badge = document.createElementNS(NS, "g");
      badge.setAttribute("class", "pto-problem-marker pto-problem-badge");
      badge.setAttribute("data-diagnosis-key", marker.key || "");
      badge.style.cursor = "pointer";

      var bg = document.createElementNS(NS, "rect");
      bg.setAttribute("x", pillLeft); bg.setAttribute("y", pillTop);
      bg.setAttribute("width", pillW); bg.setAttribute("height", PILLH);
      bg.setAttribute("rx", PILLH / 2); bg.setAttribute("ry", PILLH / 2);
      bg.setAttribute("fill", "var(--danger, #FF4B7B)");
      badge.appendChild(bg);

      // 白色文字
      var label = document.createElementNS(NS, "text");
      label.setAttribute("x", pillLeft + PADX);
      label.setAttribute("y", pillTop + PILLH / 2);
      label.setAttribute("dominant-baseline", "central");
      label.setAttribute("fill", "#ffffff");
      label.setAttribute("font-size", FS);
      label.setAttribute("font-weight", "700");
      label.setAttribute("font-family", "system-ui, sans-serif");
      label.textContent = labelText;
      badge.appendChild(label);

      nodeGroup.appendChild(badge);

      if (tip) {
        var move = function(e) {
          tip.style.left = Math.min(window.innerWidth - 270, e.clientX + 12) + "px";
          tip.style.top = (e.clientY + 14) + "px";
        };
        badge.addEventListener("mouseenter", function(e) {
          tip.textContent = marker.label + "\n" + (marker.sub || "");
          tip.hidden = false;
          move(e);
        });
        badge.addEventListener("mousemove", move);
        badge.addEventListener("mouseleave", function() { tip.hidden = true; });
      }
      badge.addEventListener("click", function(e) {
        e.stopPropagation();
        var card = document.querySelector('.diagnosis-card[data-diagnosis="' + marker.key + '"]');
        if (card) { card.click(); }
      });
    }

    function tryApply() {
      var svg = stage.querySelector('svg');
      if (!svg) { setTimeout(tryApply, 200); return; }

      stage.querySelectorAll(".pto-problem-marker").forEach(function(el) { el.remove(); });
      placedBadges = [];

      Object.values(diagnosisCases).forEach(function(info) {
        info.nodeIds.forEach(function(id) { markNodeActive(stage, id, "pto-diagnosis-active"); });
        info.edges.forEach(function(e) { markEdgeActive(stage, e[0], e[1], "pto-diagnosis-active"); });
        (info.clusterIds || []).forEach(function(cid) { markClusterActive(stage, cid, "pto-diagnosis-active"); });
      });

      // 问题一的红框(MoE FFN 分组框 moe-block):点击红框本体 = 选中问题一并进入模型层展开图。
      // 只响应落在分组框背景 rect 上的点击(点内部节点仍走节点自己的徽标联动),不重复绑定。
      var moeCluster = stage.querySelector('[data-cluster-id="moe-block"]');
      if (moeCluster && !moeCluster.dataset.lvBound) {
        moeCluster.dataset.lvBound = "1";
        var moeFrame = moeCluster.querySelector("rect");
        if (moeFrame) {
          moeFrame.style.cursor = "pointer";
          moeFrame.addEventListener("click", function(e) {
            e.stopPropagation();
            enterProblemOneLayerView();
          });
        }
      }

      Object.keys(diagnosisCases).forEach(function(key) {
        var info = diagnosisCases[key];
        var marker = diagnosisMarkers.find(function(m) { return m.key === key; });
        if (!marker || !info.nodeIds.length) return;
        var color = problemSeverityColor(key);
        var nodeGroup = stage.querySelector('[data-node-id="' + info.nodeIds[0] + '"]');
        if (!nodeGroup) return;
        drawBadge(nodeGroup, { key: key, label: marker.label, num: marker.num, sub: info.note || "" }, color);
      });
    }
    tryApply();
  }

  // 图上问题标注:改为节点左上角的紧凑序号徽标(颜色按严重度 P0 红 / P1 橙),取代原来
  // 5 个 180×44 的大红卡片,大幅减少对整网图的遮挡;完整标签在悬浮气泡里展示,点击联动右侧诊断卡片。
  var PROBLEM_SEVERITY = { p0: "#dc2626", p1: "#ea580c", p2: "#ca8a04" };
  function problemSeverityColor(diagnosisKey) {
    var m = diagnosisMarkers.find(function (d) { return d.key === diagnosisKey; });
    return (m && PROBLEM_SEVERITY[m.severity]) || "#dc2626";
  }

  function applyProblemMarkers(stage, graph) {
    if (!stage || !graph || !graph.problemMarkers) return;
    stage.querySelectorAll(".pto-problem-marker").forEach(function (el) { el.remove(); });

    var NS = "http://www.w3.org/2000/svg";
    var nodeLookup = {};
    (graph.nodes || []).forEach(function (n) {
      nodeLookup[n.id] = { w: n.width || 0, h: n.height || 0 };
    });
    var tip = document.getElementById("diagnosisTooltip");
    var R = 11;

    graph.problemMarkers.forEach(function (m) {
      var group = stage.querySelector('[data-node-id="' + m.nodeId + '"]');
      if (!group) return;
      var dims = nodeLookup[m.nodeId];
      if (!dims || !dims.w) return;
      var color = problemSeverityColor(m.diagnosisKey);

      var badge = document.createElementNS(NS, "g");
      badge.setAttribute("class", "pto-problem-marker pto-problem-badge");
      badge.setAttribute("data-diagnosis-key", m.diagnosisKey || "");
      badge.style.cursor = "pointer";

      // 胶囊:序号圆点 + 小字标签(在节点内文字外留白)。先渲染标签量出宽度再定胶囊尺寸。
      var FS = 9, R = 7, PADX = 7, GAPCT = 5, PILLH = 20;
      var label = document.createElementNS(NS, "text");
      label.setAttribute("font-size", FS);
      label.setAttribute("font-weight", "600");
      label.setAttribute("font-family", "system-ui, sans-serif");
      label.setAttribute("dominant-baseline", "central");
      label.setAttribute("fill", "var(--foreground, #1c1e22)");
      label.textContent = m.label;
      badge.appendChild(label);
      group.appendChild(badge);        // 先入 DOM 才能量到文字宽度
      var tw = 0;
      try { tw = label.getBBox().width; } catch (e) { tw = m.label.length * FS * 0.62; }

      var pillW = PADX + R * 2 + GAPCT + tw + PADX;
      var cy = -dims.h / 2;                 // 竖向对齐到节点左上角
      var pillRight = -dims.w / 2 - 8;      // 胶囊右缘留在节点左侧外
      var pillLeft = pillRight - pillW;
      var pillTop = cy - PILLH / 2;
      var dotCx = pillLeft + PADX + R;

      var bg = document.createElementNS(NS, "rect");
      bg.setAttribute("x", pillLeft); bg.setAttribute("y", pillTop);
      bg.setAttribute("width", pillW); bg.setAttribute("height", PILLH);
      bg.setAttribute("rx", PILLH / 2); bg.setAttribute("ry", PILLH / 2);
      bg.setAttribute("fill", "var(--surface-1, #ffffff)");
      bg.setAttribute("stroke", color);
      bg.setAttribute("stroke-opacity", "0.55");
      badge.insertBefore(bg, label);        // 背景在标签之下

      var dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", dotCx); dot.setAttribute("cy", cy); dot.setAttribute("r", R);
      dot.setAttribute("fill", color);
      badge.appendChild(dot);

      var num = document.createElementNS(NS, "text");
      num.setAttribute("x", dotCx); num.setAttribute("y", cy);
      num.setAttribute("text-anchor", "middle");
      num.setAttribute("dominant-baseline", "central");
      num.setAttribute("fill", "#ffffff");
      num.setAttribute("font-size", "10");
      num.setAttribute("font-weight", "700");
      num.setAttribute("font-family", "system-ui, sans-serif");
      num.textContent = m.id;
      badge.appendChild(num);

      label.setAttribute("x", dotCx + R + GAPCT);
      label.setAttribute("y", cy);

      // 悬浮:复用诊断气泡展示完整「标签 + 说明」
      if (tip) {
        var move = function (e) {
          tip.style.left = Math.min(window.innerWidth - 270, e.clientX + 12) + "px";
          tip.style.top = (e.clientY + 14) + "px";
        };
        badge.addEventListener("mouseenter", function (e) {
          tip.textContent = m.label + "\n" + m.sub;
          tip.hidden = false;
          move(e);
        });
        badge.addEventListener("mousemove", move);
        badge.addEventListener("mouseleave", function () { tip.hidden = true; });
      }
      // 点击 → 联动选中右侧对应诊断问题
      if (m.diagnosisKey) {
        badge.addEventListener("click", function (e) {
          e.stopPropagation();
          if (tip) tip.hidden = true;
          var card = document.querySelector('.diagnosis-card[data-diagnosis="' + m.diagnosisKey + '"]');
          if (card) toggleDiagnosisCard(card);
        });
      }
    });
  }

  function clearDiagnosisFocus() {
    var stage = document.getElementById("graphStage");
    if (stage) {
      stage.classList.remove("is-diagnosis-focus");
      stage.querySelectorAll(".pto-diagnosis-focus-active").forEach(function(el) { el.classList.remove("pto-diagnosis-focus-active"); });
    }
    highlightProblemBadge(null);
  }

  function highlightProblemBadge(caseKey) {
    var stage = document.getElementById("graphStage");
    if (!stage) return;
    stage.querySelectorAll(".pto-problem-badge").forEach(function(b) {
      var match = b.getAttribute("data-diagnosis-key") === caseKey;
      b.classList.toggle("is-dimmed", !!caseKey && !match);
      b.classList.toggle("is-active", !!caseKey && match);
    });
  }

  function hideDiagnosisLocator() {
    const locator = $("diagnosisLocator");
    if (locator) locator.hidden = true;
  }

  // ── 热力图 infra 问题高亮 ─────────────────────────────────────────────────
  var INFRA_HEAT_MAP = {
    "moe-a2a":           { hotCells: [23], warmCells: [16,17,18,19,20,21,22] },
    "nvlink":            { hotCells: [19, 20], warmCells: [16,17,18,21,22,23] },
    "perf-comm-straggler": { hotCells: [17, 23, 41] },
  };

  function applyInfraHeatHighlight(caseKey) {
    clearInfraHeatHighlight();
    var map = INFRA_HEAT_MAP[caseKey];
    if (!map) return;
    var cells = $("heat").querySelectorAll(".twin-heat-cell");
    (map.hotCells || []).forEach(function (idx) {
      if (cells[idx]) cells[idx].classList.add("is-infra-hot");
    });
    (map.warmCells || []).forEach(function (idx) {
      if (cells[idx]) cells[idx].classList.add("is-infra-warm");
    });
  }

  function clearInfraHeatHighlight() {
    var cells = $("heat").querySelectorAll(".twin-heat-cell");
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove("is-infra-hot", "is-infra-warm");
    }
  }

  // 定位链「infra层」示意图:完全复用外层监控的集群热力图(#heat)。首帧按同款外壳建格,
  // 之后把 #heat 每个 cell 的 util 着色镜像过来,再叠加本问题的 hot/warm 标记。随训练 tick 刷新。
  var activeLocateCase = null;
  function syncLocateInfraHeat(caseKey) {
    var dst = document.getElementById("locateInfraHeat");
    if (!dst) return;
    var src = $("heat");
    if (!src) return;
    var srcCells = src.querySelectorAll(".twin-heat-cell");
    var dstCells = dst.querySelectorAll(".twin-heat-cell");
    if (dstCells.length !== srcCells.length) {
      renderHeatShell(dst); // 首次或结构变化:重建与 #heat 同款的 DP/PP/EP 外壳
      dstCells = dst.querySelectorAll(".twin-heat-cell");
    }
    for (var i = 0; i < srcCells.length; i++) {
      var s = srcCells[i], d = dstCells[i];
      if (!d) continue;
      d.className = s.className;            // util-low/mid/high、thermal、straggler 等
      d.style.cssText = s.style.cssText;    // EP 底色 + util 描边 + PP 分界
      d.classList.remove("is-infra-hot", "is-infra-warm"); // 标记由下方按本问题重新叠加
    }
    var map = INFRA_HEAT_MAP[caseKey];
    if (!map) return;
    (map.hotCells || []).forEach(function (idx) { if (dstCells[idx]) dstCells[idx].classList.add("is-infra-hot"); });
    (map.warmCells || []).forEach(function (idx) { if (dstCells[idx]) dstCells[idx].classList.add("is-infra-warm"); });
  }

  // 点击后进入「聚焦」模式:命中节点/连线保持不透明,整网图其余部分淡出到 50%
  function applyDiagnosisFocus(caseKey) {
    var info = diagnosisCases[caseKey];
    clearDiagnosisFocus();
    applyInfraHeatHighlight(caseKey);
    highlightProblemBadge(caseKey);
    if (!info) { hideDiagnosisLocator(); return; }
    var stage = document.getElementById("graphStage");
    if (stage) {
      stage.classList.add("is-diagnosis-focus");
      info.nodeIds.forEach(function(id) { markNodeActive(stage, id, "pto-diagnosis-focus-active"); });
      info.edges.forEach(function(e) { markEdgeActive(stage, e[0], e[1], "pto-diagnosis-focus-active"); });
      (info.clusterIds || []).forEach(function(cid) { markClusterActive(stage, cid, "pto-diagnosis-focus-active"); });
      // 自动平移画布，让问题相关节点居中显示
      panToProblemNodes(stage, info.nodeIds);
    }
    hideDiagnosisLocator();
  }

  // 将画布平移到问题命中节点的中心区域
  function panToProblemNodes(stage, nodeIds) {
    if (!nodeIds || !nodeIds.length) return;
    var svg = stage.querySelector("svg");
    if (!svg) return;
    // 从 opv-modelviz 的 state 获取 controller（挂载在 svg 上）
    var ctrl = svg.ptoModelGraphvizController;
    if (!ctrl) return;
    var bounds = null;
    nodeIds.forEach(function(id) {
      var group = stage.querySelector('[data-node-id="' + id + '"]');
      if (!group) return;
      var rect = group.querySelector("rect");
      if (!rect) return;
      var x = parseFloat(rect.getAttribute("x") || "0");
      var y = parseFloat(rect.getAttribute("y") || "0");
      var w = parseFloat(rect.getAttribute("width") || "0");
      var h = parseFloat(rect.getAttribute("height") || "0");
      // 节点坐标在 group 的 transform 中
      var tx = parseFloat(group.getAttribute("transform")?.match(/translate\(([^,]+)/)?.[1] || "0");
      var ty = parseFloat(group.getAttribute("transform")?.match(/,\s*([^)]+)/)?.[1] || "0");
      if (!bounds) { bounds = { x1: tx + x, y1: ty + y, x2: tx + x + w, y2: ty + y + h }; }
      else {
        bounds.x1 = Math.min(bounds.x1, tx + x);
        bounds.y1 = Math.min(bounds.y1, ty + y);
        bounds.x2 = Math.max(bounds.x2, tx + x + w);
        bounds.y2 = Math.max(bounds.y2, ty + y + h);
      }
    });
    if (!bounds) return;
    var cx = (bounds.x1 + bounds.x2) / 2;
    var cy = (bounds.y1 + bounds.y2) / 2;
    var viewBox = svg.viewBox.baseVal;
    var vbW = viewBox.width, vbH = viewBox.height;
    var stageW = stage.clientWidth, stageH = stage.clientHeight;
    var zoom = Math.min(stageW / (bounds.x2 - bounds.x1 + 120), stageH / (bounds.y2 - bounds.y1 + 120), 1.8);
    zoom = Math.max(0.25, Math.min(2.6, zoom));
    ctrl.setTransform({ zoom: zoom, tx: stageW / 2 - cx * zoom, ty: stageH / 2 - cy * zoom });
  }

  // 定位链数据:对应 定位链.md 中三个案例各自实际走过的链路节点
  const locateChains = {
    "moe-a2a": {
      title: "定位链 · MoE all-to-all 超时导致 loss NaN",
      meta: "路径:迭代层 → 仅多卡异常 → 通信调度层 → 模型层 → infra层 → 超参/代码层",
      steps: [
        { label: "迭代层", short: `Step ${INCIDENT_STEP}`, sub: `WHEN · step ${INCIDENT_STEP} loss 跳变至 NaN`,
          showSmoothing: true,
          content: `
            <div class="twin-locate-metric-block">
              <div class="twin-locate-metric-charts">
                <div class="twin-locate-metric-card">
                  <div class="twin-locate-metric-card__head">loss</div>
                  <div class="twin-locate-metric-card__chart" data-locate-chart="loss"></div>
                </div>
                <div class="twin-locate-metric-card">
                  <div class="twin-locate-metric-card__head">grad_norm</div>
                  <div class="twin-locate-metric-card__chart" data-locate-chart="gradnorm"></div>
                </div>
              </div>
              <p class="twin-locate-metric-note">step ${INCIDENT_STEP} loss 跳变至 NaN,grad_norm 跳至 inf。</p>
              <p class="twin-locate-metric-note">重跑step，锁定 step ${INCIDENT_STEP} 的输入数据（dataloader seed 固定），分别在 1 GPU 和 32 GPU 上重跑该 step，单卡：loss=3.21，grad_norm=11.8，完全正常，而多卡时：loss=NaN，grad_norm=inf</p>
              <p class="twin-locate-metric-note">↳ 多卡即出现，需在【通信调度层】的NCCL trace中检查异常位置</p>
            </div>
          ` },
        { label: "分叉判定", sub: "仅多卡异常 · 切入通信分支", branch: true },
        { label: "通信调度层", short: "EP rank 23", sub: "WHY(通信) · EP rank 23 all-to-all 死锁",
          content: `<div class="opv-swim-embed" data-problem-one-timeline title="NCCL trace: node2 ranks 16-23, rank 23 all-to-all timeout"></div><p style="margin:10px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">识别 EP rank 23（node2 GPU 7）在 <code>all-to-all</code> 调用处超时（30s timeout）。该调用时间上定位到 layer 30 MoE 的 expert dispatch 阶段。</p><p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ 需在【模型层】提取 step ${INCIDENT_STEP} 各层 router 的 token-to-expert 分配统计。</p>` },
        { label: "模型层", short: "layer 30", sub: "WHERE · layer 30 router 98% token 倾斜到 expert 47",
          content: `
            <div class="twin-layerview-cta" data-open-layer-view data-lv-expanded="30" data-lv-hot-expert="47" role="button" tabindex="0">
              <div class="twin-layerview-cta-text">
                <strong>layer 30 · MoE 层展开图</strong>
                <span>router→expert 分发与 rank 23 all-to-all 死锁动画 · 点击在整网图区域查看</span>
              </div>
              <span class="btn btn-solid btn-sm twin-layerview-cta-btn">查看</span>
            </div>
            <p class="twin-locate-metric-note">layer 30 的 router 将当前 micro-batch 中 98% 的 token 路由到了 expert 47(恰好位于 EP rank 23),其余 63 个 expert 几乎无 token。</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">对比分析收发数据， layer 30 每个 rank 的 all-to-all send/recv buffer size 对比如下图：</p>
            <canvas id="bufChart" style="width:100%;height:168px;margin:6px 0 0;display:block;background:var(--surface-2);border-radius:6px"></canvas>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">进一步证实 rank 23 的 send buffer 为 0（没有 token 被 router 分发到其他 rank 的 expert），而 recv buffer 期望接收 2048 token × 4608 dim × 8 experts 的数据，size 不匹配导致死锁。</p>
            <p class="twin-locate-metric-note">↳ 需在【infra层】识别对训练集群的影响。</p>
          ` },
        { label: "infra层", short: "EP rank 23", sub: "CONTEXT · EP rank 23 / PP stage 3 / DP0",
          // infra 示意图完全复用外层「训练监控 · infra」的集群热力图(#heat 的 DP4×PP8×EP64 网格),
          // 由 syncLocateInfraHeat() 把当前 util 着色镜像到 #locateInfraHeat,再叠加本问题的 hot/warm 标记。
          content: `
            <div class="twin-infra-heat-block">
              <div id="locateInfraHeat" class="twin-heat locate-infra-heat"></div>
              <div class="twin-legend" style="margin-top:8px;font-size:11px">
                <span><i class="twin-swatch twin-swatch-util-low"></i>&lt;70% util</span>
                <span><i class="twin-swatch twin-swatch-util-mid"></i>70-92% util</span>
                <span><i class="twin-swatch twin-swatch-util-high"></i>&gt;92% util</span>
                <span style="display:inline-flex;align-items:center;gap:5px"><i style="width:10px;height:10px;border-radius:2px;outline:2px solid #dc2626;outline-offset:1px"></i>EP rank 23 死锁</span>
                <span style="display:inline-flex;align-items:center;gap:5px"><i style="width:10px;height:10px;border-radius:2px;outline:2px solid #ea580c;outline-offset:1px"></i>EP 16–22 空等</span>
              </div>
              <p style="margin:8px 0 0;font-size:11px;color:var(--foreground-secondary);line-height:1.5"><span style="color:#dc2626;font-weight:700">EP rank 23</span> 在 all-to-all 死锁,<span style="color:#ea580c;font-weight:600">EP rank 16–22</span> 空等超时;异常聚集在单个 EP rank → 局部路由倾斜。</p>
            </div>
          ` },
        { label: "超参/代码层", short: "3 处代码改动", sub: "FIX · MoGE group 8→16 + z-loss + 超时延长",
          content: `
            <p class="twin-locate-metric-note" style="margin:0 0 12px">综合以上各层定位诊断，代码修改建议如下：</p>
            <div style="display:flex;flex-direction:column;gap:12px;">
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:8px 12px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--foreground)">① model_config.json</div>
                <div style="font-family:monospace;font-size:11px;line-height:1.7;padding:10px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="color:var(--foreground-muted)">&nbsp;&nbsp;"num_experts": 64,</div>
                  <div style="color:var(--foreground-muted)">&nbsp;&nbsp;"moge_group_topk": 1,</div>
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− &nbsp;"n_group": <strong>8</strong>,</div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;"n_group": <strong>16</strong>,&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># MoGE 分组 8→16，每组 expert 8→4，分散热点</span></div>
                  <div style="color:var(--foreground-muted)">&nbsp;&nbsp;"experts_per_group": 4,</div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:8px 12px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--foreground)">② training_args.yaml</div>
                <div style="font-family:monospace;font-size:11px;line-height:1.7;padding:10px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="color:var(--foreground-muted)">&nbsp;&nbsp;aux_loss_coeff: 0.001</div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;z_loss_coeff: <strong>1e-4</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># gate 前增加 z-loss 正则项，抑制 gate logit 极端值</span></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:8px 12px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--foreground)">③ env.sh</div>
                <div style="font-family:monospace;font-size:11px;line-height:1.7;padding:10px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− export NCCL_IB_TIMEOUT=<strong>30</strong></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ export NCCL_IB_TIMEOUT=<strong>60</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># all-to-all 超时延长 30→60s 兜底</span></div>
                </div>
              </div>
            </div>
          ` },
      ],
      // 单/多卡均异常时会绕过「通信调度层」直接从迭代层进入模型层,用弧形虚线标出这条未被走到的旁路
      bypass: [{ from: 0, to: 2 }],
    },
    nvlink: {
      title: "定位链 · NVLINK 链路掉线导致 MFU 骤降",
      meta: "路径:集群层 → 资源层 → 通信原语层 → 硬件层 → 配置变更层",
      steps: [
        { label: "集群层", short: "node2", sub: "WHERE · node2 GPU0~7 利用率骤降至 35~40%" },
        { label: "资源层", short: "NVLINK↓ IB↑", sub: "WHAT · NVLINK 带宽降级,IB 负载骤增,网络瓶颈" },
        { label: "分叉判定", sub: "网络瓶颈 · 切入通信原语分支", branch: true },
        { label: "通信原语层", short: "all-to-all 8×", sub: "WHICH(comm) · all-to-all 耗时 8×,回退至 PATH_SYS" },
        { label: "硬件层", short: "lane 5 inactive", sub: "HARDWARE · GPU3 NVLINK lane 5 inactive,CRC 突增" },
        { label: "配置变更层", short: "reseat / EP=63", sub: "FIX · reseat NVLINK bridge / EP=63 临时绕过" },
      ],
    },
    "perf-compute-bottleneck": {
      title: "定位链 · 整网耗时下钻：算子带宽瓶颈 + AICPU 回退导致步耗时超标 42%",
      meta: "路径:迭代层 → 单/多卡均异常 → 模型层 → 算子层 → 张量层 → infra层 → 超参/代码层",
      steps: [
        { label: "迭代层", short: "T_iter 3.2s", sub: "WHEN · 稳态训练步耗时 3.2s,超标 42%" },
        { label: "分叉判定", sub: "单/多卡均异常 · 沿计算主干", branch: true },
        { label: "模型层", short: "lm_head / logits", sub: "WHERE · lm_head / logits 路径耗时占比 38%" },
        { label: "算子层", short: "cube_util 49%", sub: "WHAT · MatMulV2 cube_util 仅 49%,CE loss 走 AICPU 回退" },
        { label: "张量层", short: "vocab 非对齐", sub: "WHICH · vocab 非对齐导致带宽利用率低" },
        { label: "infra层", short: "stage7 1.82×", sub: "CONTEXT · PP stage 7 过载 1.82×,MFU 仅 38%" },
        { label: "超参/代码层", short: "vocab padding 对齐", sub: "FIX · vocab padding 对齐 + fused CE kernel 替代 AICPU 回退" },
      ],
    },
    "perf-comm-straggler": {
      title: "定位链 · MoE all-to-all 快慢卡：步耗时周期性尖峰、尾延迟恶化",
      meta: "路径:迭代层 → 仅多卡异常 → 通信调度层 → 模型层 → infra层 → 超参/代码层",
      steps: [
        { label: "迭代层", short: "CV 27%", sub: "WHEN · 步耗时 CV=27%,周期性尖峰 8~12×" },
        { label: "分叉判定", sub: "仅多卡异常 · 切入通信分支", branch: true },
        { label: "通信调度层", short: "rank 17/23/41", sub: "WHY(通信) · all-to-all 耗时暴增 32×,rank 17/23/41 尾延迟" },
        { label: "模型层", short: "gate bias 漂移", sub: "WHERE · router gate bias 漂移致 3 rank 承接 5× expert token" },
        { label: "infra层", short: "61 rank 空等", sub: "CONTEXT · 其余 61 rank 空等,EP64 负载严重不均" },
        { label: "超参/代码层", short: "aux-loss+重映射", sub: "FIX · aux-loss + global-balance + EP group 重新映射" },
      ],
      bypass: [{ from: 0, to: 2 }],
    },
    "low-precision-training": {
      title: "定位链 · 低精训练 loss 尾部不收敛，量化误差累积导致梯度信号淹没",
      meta: "路径:迭代层 → 单/多卡均异常 → 张量数值分析 → 误差传递路径 → infra层 → 超参/代码层",
      steps: [
        { label: "迭代层", short: "Step 25000 分叉", sub: "WHEN · step 25000 HiF8 与 BF16 基线开始分叉，loss 下降骤停",
          showSmoothing: true,
          content: `
            <div class="twin-locate-metric-block">
              <div class="twin-locate-metric-charts">
                <div class="twin-locate-metric-card">
                  <div class="twin-locate-metric-card__head">loss — HiF8 vs BF16 基线</div>
                  <div class="twin-locate-metric-card__chart" data-locate-chart="case6-loss"></div>
                </div>
                <div class="twin-locate-metric-card">
                  <div class="twin-locate-metric-card__head">grad_norm</div>
                  <div class="twin-locate-metric-card__chart" data-locate-chart="case6-gradnorm"></div>
                </div>
              </div>
              <p class="twin-locate-metric-note">step 0~25000：HiF8 与 BF16 基线紧密跟随，loss 8.5→2.5 平稳下降，grad_norm 8~15 正常波动。<strong>step 25000 起两条 loss 曲线分叉</strong>——BF16 继续下降至 ~1.8，HiF8 停滞在 2.1 附近，step 31000 后微幅反弹（2.08→2.15），grad_norm 从 ~10 持续衰减至 0.3（step 35000）。</p>
              <p class="twin-locate-metric-note">↳ HiF8 与 BF16 的分叉 + 梯度消失 → FP8 混合精度引入的渐进式数值退化。嫌疑范围：<strong>25000~35000</strong></p>
            </div>
          ` },
        { label: "分叉判定", sub: "单/多卡均异常 · 沿计算主干", branch: true },
        { label: "张量数值分析", short: "分布曲线 + 宏观指标", sub: "WHICH · 直方图 + 峰度/离群率/p99/量化SNR/KL散度 + 风险矩阵",
          content: `
            <p class="twin-locate-metric-note">锁定 layer 47 为异常层后，dump step 32000 时该层各关键张量，绘制数值分布直方图与 BF16 baseline 叠图对比：</p>
            <div class="locate-dist-grid">
              <div class="locate-dist-cell"><h4>q_nope 输入（激活值）</h4><canvas id="case6DistQnope"></canvas><div class="note">BF16：N(0.12, 1.45)。FP8：严重右偏 skewness=+1.8，<span style="color:#dc2626">6.8% clip@448</span></div></div>
              <div class="locate-dist-cell"><h4>core_attention 输出</h4><canvas id="case6DistAttn"></canvas><div class="note">BF16：多模态 方差 0.85。FP8：<span style="color:#dc2626">主峰塌缩至[-0.3,0.3]</span>，方差→0.21</div></div>
              <div class="locate-dist-cell"><h4>gate_proj 输出（FFN 中间激活）</h4><canvas id="case6DistGate"></canvas><div class="note">BF16：[-12,15] 自然长尾。FP8：<span style="color:#dc2626">双侧 ±448 截断，12.4% clip</span></div></div>
            </div>
            <p class="twin-locate-metric-note" style="margin:6px 0"><strong>三张分布图一致揭示</strong>：FP8 E4M3 动态范围（max=448）无法容纳深层激活值自然长尾。三阶段退化：激活值右偏 → attention 信息坍缩 → FFN 截断饱和。</p>

            <p class="twin-locate-metric-note" style="margin:14px 0 6px;font-weight:600;color:var(--foreground)">宏观统计指标（step 32000 vs BF16 baseline）</p>
            <div style="overflow-x:auto;margin:6px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">张量</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">指标</th><th style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">FP8</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">BF16</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">诊断含义</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)" rowspan="7">q_nope 输入</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Mean</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">+2.41</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">+0.12</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">均值右偏 → 向 FP8 正上限漂移</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Std</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">3.82</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">1.45</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">标准差扩大 2.6×</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Skewness</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">+1.83</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">+0.08</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">严重右偏</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)"><strong>Kurtosis</strong></td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">+7.42</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">-0.12</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">高峰度 = 重尾+尖峰</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Outlier Ratio (>3σ)</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">8.7%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.9%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">离群率 ~10× baseline</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">p99</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#ea580c;font-weight:600">378.4</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">4.12</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">p99 逼近 FP8 max=448</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">p99.9</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">447.8 (clip)</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">4.89</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">最强 0.1% 激活完全丢失</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)" rowspan="2">core_attn 输出</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Std</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">0.21</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.85</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">方差 1/4 — 区分度丧失</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">KL Divergence</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">2.31 bits</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">分布根本性变化</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)" rowspan="2">gate_proj 输出</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Quantization SNR</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">6.8 dB</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">42.1 dB</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">信号被噪声严重污染</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Kurtosis</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">+15.3</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">+0.45</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">极端 — "尖峰+截断双尾"</td></tr>
              </table>
            </div>
            <p class="twin-locate-metric-note"><strong style="color:var(--foreground)">🔑 峰度（Kurtosis）最关键</strong>：-0.12→+15.3，"尖峰+截断双尾"是低精训练退化的<strong>典型数值指纹</strong>。</p>

            <p class="twin-locate-metric-note" style="margin:14px 0 6px;font-weight:600;color:var(--foreground)">量化风险评估矩阵</p>
            <div style="display:grid;grid-template-columns:130px repeat(3,1fr) 100px;margin:6px 0;font-size:11px;border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
              <div style="padding:5px 8px;background:var(--surface-2);font-weight:600;border-bottom:1px solid var(--border-subtle)">风险维度</div><div style="padding:5px 8px;background:var(--surface-2);font-weight:600;border-bottom:1px solid var(--border-subtle)">q_nope</div><div style="padding:5px 8px;background:var(--surface-2);font-weight:600;border-bottom:1px solid var(--border-subtle)">core_attn</div><div style="padding:5px 8px;background:var(--surface-2);font-weight:600;border-bottom:1px solid var(--border-subtle)">gate_proj</div><div style="padding:5px 8px;background:var(--surface-2);font-weight:600;border-bottom:1px solid var(--border-subtle)">综合</div>
              <div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)">动态范围适配</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fff7ed;color:#ea580c">⚠️ 临界</span></div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 危险</span></div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 危险</span></div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 高风险</span></div>
              <div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)">QSNR</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)">18.3 dB</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle);color:#dc2626;font-weight:600">11.5 dB</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle);color:#dc2626;font-weight:700">6.8 dB</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 <10dB 不可用</span></div>
              <div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)">KL 散度</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)">0.87 bits</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle);color:#dc2626;font-weight:600">2.31 bits</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle);color:#dc2626;font-weight:700">3.45 bits</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 >1 bit 显著偏移</span></div>
              <div style="padding:5px 8px">梯度可恢复性</div><div style="padding:5px 8px"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fefce8;color:#ca8a04">🟡 部分可恢复</span></div><div style="padding:5px 8px"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 不可恢复</span></div><div style="padding:5px 8px"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 不可恢复</span></div><div style="padding:5px 8px"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 需结构性修改</span></div>
            </div>

            <p class="twin-locate-metric-note" style="margin:14px 0 6px;font-weight:600;color:var(--foreground)">算子误差定位</p>
            <div class="locate-canvas-card">
              <div class="locate-canvas-card__head"><span>Layer 47 算子误差瀑布（log₁₀ MSE vs BF16 baseline）</span></div>
              <div class="locate-canvas-card__body"><canvas id="case6OpWaterfallCanvas"></canvas></div>
            </div>
            <div style="overflow-x:auto;margin:6px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">算子</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">MSE vs BF16</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">变化</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">角色</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">input_layernorm</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">3e-8</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">—</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🟢 正常</td></tr>
                <tr style="background:#fef2f2"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">q_nope</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">2e-7 → 4.1e-3</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">⬆ 20000×</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">🔴 首害</td></tr>
                <tr style="background:#fef2f2"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">core_attention</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">4.1e-3 → 1.6e-1</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">⬆ 40×</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">🔴 放大器(softmax)</td></tr>
                <tr style="background:#fef2f2"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">gate_proj</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">1.8e-1 → 7.3e-1</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">⬆ 4×</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">放大器(FP8 cast)</td></tr>
              </table>
            </div>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ 首害算子 <code>q_nope</code>，误差放大链：q_nope → softmax（信息抹平）→ gate_proj（截断饱和）。需在【误差传递路径】逐层追查偏差起点。</p>
          ` },
        { label: "误差传递路径", short: "L47 拐点 460×", sub: "逐层对比 BF16 基线，发现偏差起点 layer 47",
          content: `
            <p class="twin-locate-metric-note">以 BF16 全精度训练为 baseline，沿 forward 计算图逐层对比 FP8 训练的激活输出，绘制<strong>误差累积曲线</strong>（横轴 layer 1→61，纵轴 log₁₀ MSE）：</p>
            <div class="locate-canvas-card">
              <div class="locate-canvas-card__head"><span>61 层误差累积曲线（log₁₀ MSE vs BF16 baseline，step 32000）</span></div>
              <div class="locate-canvas-card__body"><canvas id="case6MseCurveCanvas"></canvas></div>
            </div>
            <p class="twin-locate-metric-note" style="margin:4px 0">layer 1~35：MSE 1e-7~1e-6 平稳 → layer 36~46：缓慢爬升至 5e-4 → <strong style="color:#dc2626">layer 47：跳跃至 2.3e-1（460×）</strong> → layer 48~55：0.2~0.8 高位震荡 → layer 56~61：飙升至 3.5</p>

            <p class="twin-locate-metric-note" style="margin:12px 0 6px;font-weight:600;color:var(--foreground)">逐层对比详表（偏差起点附近）</p>
            <div style="overflow-x:auto;margin:6px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle)">Layer</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">Attn MSE</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">FFN MSE</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">Grad MSE</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">状态</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">45</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">8.2e-7</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">1.1e-6</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">2.3e-6</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🟢</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">46</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">3.5e-6</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">6.8e-6</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">1.2e-5</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🟢 略有抬升</td></tr>
                <tr style="background:#fef2f2"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">47</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">2.3e-1</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">7.3e-1</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">1.8e+1</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">🔴 偏差起点</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">48</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.41</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.55</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">8.7e+0</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🔴 向下游传播</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">50</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.45</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.78</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">9.1e+0</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🔴 误差放大</td></tr>
              </table>
            </div>
            <p class="twin-locate-metric-note" style="margin-top:8px"><strong style="color:var(--foreground)">误差传递因果链</strong>：layer 1~46 FP8 截断累积 → L47 RMSNorm 方差放大 → q_nope 6.8% clip@448 → core_attn softmax 信息抹平 → o_proj 噪声>50% → gate_proj 双侧 12% clip → L48~61 残差传播 → 全局梯度消失 → loss 反弹</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ L47 的 Attn 和 FFN 在同一 step 同时爆炸 → 非特定算子 bug，而是该层激活值整体数值分布已超出 FP8 可表示范围。需在【infra层】检查并行策略和 scale 状态。</p>
          ` },
        { label: "infra层", short: "全 64 rank", sub: "CONTEXT · 跨所有 rank 复现，FP8 scale 0.62→0.18，有效 bit 4.5→2.8",
          content: `
            <p class="twin-locate-metric-note">layer 47 属于 PP stage 6（layers 47~53），在所有 64 个 EP rank 上均观测到相同分布偏移。进一步检查 FP8 量化参数：layer 47 的 per-tensor scale 从 step 28000 的 <strong>0.62</strong> 持续下降至 step 32000 的 <strong style="color:#dc2626">0.18</strong>。</p>
            <div class="locate-canvas-card">
              <div class="locate-canvas-card__head"><span>Layer 47 · FP8 per-tensor scale 衰减曲线（step 27000→32000）</span></div>
              <div class="locate-canvas-card__body"><canvas id="case6ScaleDecayCanvas"></canvas></div>
            </div>
            <p class="twin-locate-metric-note" style="margin:8px 0">scale 衰减使有效量化精度从 <strong>~4.5 bit 退化至 ~2.8 bit</strong>——scale 越小，量化 bin 越粗，舍入误差越大，形成"截断→scale 衰减→更粗量化→更多截断"正反馈。</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ 全局问题，非特定硬件故障。FP8 per-tensor scaling 的 scale 衰减是量化误差累积的放大器。需在【超参/代码层】做结构性修改。</p>
          ` },
        { label: "超参/代码层", short: "4 处代码改动", sub: "FIX · 混合量化 + scale 保护 + 深层 BF16 softmax + grad scale 预热",
          content: `
            <p class="twin-locate-metric-note" style="margin:0 0 10px"><strong style="color:var(--foreground)">诊断总结</strong>：根因是 FP8 E4M3 per-tensor 量化在深层激活值上的动态范围不足。深层激活值自然长尾 + 静态 per-tensor FP8 的系统性缺陷，量化误差经 softmax（信息抹平）→ FFN（非线性饱和）形成正反馈。</p>
            <div style="display:flex;flex-direction:column;gap:10px">
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:7px 12px;background:var(--surface-2);font-size:12px;font-weight:600">① model_config.json — per-token + per-channel 混合量化</div>
                <div style="font-family:monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="color:var(--foreground-muted)">&nbsp;&nbsp;"fp8_quant_mode": "per_tensor",</div>
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− &nbsp;"fp8_quant_mode": <strong>"per_tensor"</strong>,</div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;"fp8_quant_mode": <strong>"hybrid"</strong>,</div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;"fp8_attn_quant": "per_token",&nbsp;&nbsp;<span style="color:var(--foreground-muted)"># q/k/v 每个 token 独立 scale</span></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;"fp8_ffn_quant": "per_channel",&nbsp;<span style="color:var(--foreground-muted)"># FFN 每个 channel 独立 scale</span></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;"fp8_hybrid_threshold_layer": <strong>45</strong>,&nbsp;<span style="color:var(--foreground-muted)"># L45+ 深层启用</span></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:7px 12px;background:var(--surface-2);font-size:12px;font-weight:600">② fp8_cast.py — 动态 scale 上界保护</div>
                <div style="font-family:monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− &nbsp;scale = <strong>compute_scale(tensor)</strong></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;scale = <strong>max(compute_scale(tensor), 512.0 / 448.0)</strong>&nbsp;<span style="color:var(--foreground-muted)"># scale ≥ ~1.14，有效 ≥ 4.2 bit</span></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:7px 12px;background:var(--surface-2);font-size:12px;font-weight:600">③ attention.py — 深层启用 BF16 softmax</div>
                <div style="font-family:monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− &nbsp;attn_output = softmax(scores, dtype=<strong>torch.float8_e4m3fn</strong>)</div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;dtype = torch.float8_e4m3fn <strong>if layer_idx < 45 else torch.bfloat16</strong></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;attn_output = <strong>softmax(scores, dtype=dtype)</strong></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:7px 12px;background:var(--surface-2);font-size:12px;font-weight:600">④ training_args.yaml — 梯度 scale 预热</div>
                <div style="font-family:monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;fp8_grad_scale_warmup_steps: <strong>5000</strong></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;fp8_grad_scale_max: <strong>4.0</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted)"># warmup 后 grad scale 上限 4×</span></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;fp8_grad_scale_interval: <strong>1000</strong>&nbsp;<span style="color:var(--foreground-muted)"># 每 1000 step 递增</span></div>
                </div>
              </div>
            </div>
            <p class="twin-locate-metric-note" style="margin:12px 0 6px;font-weight:600;color:var(--foreground)">验证结果（方案①+③ 从 step 28000 续跑）</p>
            <div style="overflow-x:auto;margin:6px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle)">指标</th><th style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">修改前</th><th style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a">修改后</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">BF16</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">outlier ratio</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">8.7%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">0.6%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.9%</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">KL 散度</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">2.31 bits</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">0.18 bits</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">量化 SNR</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">6.8 dB</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">28.3 dB</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">42.1 dB</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">最小 scale</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">0.18</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">0.55</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">—</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">有效 bit</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">~2.8</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">≥ 4.2</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">—</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">loss (step 40000)</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">2.15</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">1.82</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">1.80</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">grad_norm</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">0.3</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">8~14</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">8~12</td></tr>
              </table>
            </div>
          ` },
      ],
      bypass: [{ from: 0, to: 2 }],
    },
  };

  // 问题七 · HiF8 精度诊断工作台:定位链结构由自包含模块 hif8-case7.js 提供(五节对应工作台五页签)
  if (window.PtoHif8Case7) { locateChains["hif8-precision"] = window.PtoHif8Case7.chain(); locateChains["qproj-overflow"] = locateChains["hif8-precision"]; }

  let locateChainObserver = null;
  let _locateTrackArgs = null; // 保存 drawLocateTrackLines 参数，resize 时重绘

  // 选中态底色是独立图层(z-index 压在连线下方),节点切换时把它挪到对应节点的位置/尺寸上
  function positionLocateHighlight() {
    const top = $("locateChainTop");
    const highlight = top?.querySelector(".twin-locate-highlight");
    const activeNode = top?.querySelector(".twin-locate-node.is-active");
    if (!top || !highlight) return;
    if (!activeNode) {
      highlight.classList.remove("is-visible");
      return;
    }
    const containerRect = top.getBoundingClientRect();
    const nodeRect = activeNode.getBoundingClientRect();
    highlight.style.left = `${nodeRect.left - containerRect.left}px`;
    highlight.style.top = `${nodeRect.top - containerRect.top}px`;
    highlight.style.width = `${nodeRect.width}px`;
    highlight.style.height = `${nodeRect.height}px`;
    highlight.classList.add("is-visible");
  }

  // 悬浮底色同样是独立图层(z-index 压在连线下方),鼠标移入某节点时把它挪过去,移出则隐藏
  function positionLocateHover(node) {
    const top = $("locateChainTop");
    const hover = top?.querySelector(".twin-locate-hover");
    if (!top || !hover) return;
    if (!node) {
      hover.classList.remove("is-visible");
      return;
    }
    const containerRect = top.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    hover.style.left = `${nodeRect.left - containerRect.left}px`;
    hover.style.top = `${nodeRect.top - containerRect.top}px`;
    hover.style.width = `${nodeRect.width}px`;
    hover.style.height = `${nodeRect.height}px`;
    hover.classList.add("is-visible");
  }

  // 定位链栏兼作锚点导航:点击/滚动联动高亮对应的 nav 节点、下方内容区块、以及走过的连线
  function setActiveLocateNode(sectionId) {
    const nodes = Array.from(document.querySelectorAll(".twin-locate-node"));
    nodes.forEach((node) => node.classList.toggle("is-active", node.dataset.target === sectionId));
    document.querySelectorAll(".twin-locate-section").forEach((section) => {
      section.classList.toggle("is-active", section.id === sectionId);
    });
    const activeIndex = nodes.findIndex((node) => node.dataset.target === sectionId);
    document.querySelectorAll(".twin-locate-line").forEach((line) => {
      const segTo = Number(line.dataset.segmentTo);
      line.classList.toggle("is-current", activeIndex >= 0 && segTo <= activeIndex);
    });
    positionLocateHighlight();
  }

  // 量出每个圆点的真实坐标后用 SVG 画出连线:保证逐点相连、不断线不错位;
  // 同时按 chain.bypass 画出跳过某个节点的旁路虚线弧(例如绕过「通信调度层」直达「模型层」)
  function drawLocateTrackLines(top, nodeCount, branchBeforeIndex, bypassList) {
    _locateTrackArgs = { top, nodeCount, branchBeforeIndex, bypassList };
    top.querySelector(".twin-locate-track-svg")?.remove();
    if (nodeCount < 2) return;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "twin-locate-track-svg");
    top.insertBefore(svg, top.firstChild);

    requestAnimationFrame(() => {
      const containerRect = top.getBoundingClientRect();
      const centers = Array.from(top.querySelectorAll(".twin-locate-node-dot")).map((dot) => {
        const r = dot.getBoundingClientRect();
        return {
          x: r.left + r.width / 2 - containerRect.left,
          y: r.top + r.height / 2 - containerRect.top,
        };
      });
      svg.setAttribute("width", String(containerRect.width));
      svg.setAttribute("height", String(containerRect.height));
      svg.innerHTML = "";

      // 箭头标记:仅用于最后一段(连到「超参/代码层」),表示定位链从左到右的走向。
      // fill=context-stroke 让箭头颜色跟随所在连线(含 is-current 高亮蓝)。
      const defs = document.createElementNS(svgNS, "defs");
      const marker = document.createElementNS(svgNS, "marker");
      marker.setAttribute("id", "twin-locate-arrow");
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "7");
      marker.setAttribute("markerHeight", "7");
      marker.setAttribute("orient", "auto-start-reverse");
      marker.setAttribute("markerUnits", "userSpaceOnUse");
      const arrowPath = document.createElementNS(svgNS, "path");
      arrowPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      arrowPath.setAttribute("fill", "context-stroke");
      marker.appendChild(arrowPath);
      defs.appendChild(marker);
      svg.appendChild(defs);

      for (let i = 0; i < centers.length - 1; i += 1) {
        const a = centers[i];
        const b = centers[i + 1];
        const isLast = i === centers.length - 2;
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", String(a.x));
        line.setAttribute("y1", String(a.y));
        if (isLast) {
          // 终点回退 10px,让箭头落在最后一个节点圆点之前而不被其遮住
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          line.setAttribute("x2", String(b.x - (dx / len) * 10));
          line.setAttribute("y2", String(b.y - (dy / len) * 10));
          line.setAttribute("marker-end", "url(#twin-locate-arrow)");
        } else {
          line.setAttribute("x2", String(b.x));
          line.setAttribute("y2", String(b.y));
        }
        line.setAttribute("class", "twin-locate-line");
        line.dataset.segmentTo = String(i + 1);
        svg.appendChild(line);
      }

      bypassList.forEach(({ from, to }) => {
        const a = centers[from];
        const b = centers[to];
        if (!a || !b) return;
        const midX = (a.x + b.x) / 2;
        const dipY = Math.max(a.y, b.y) + 22;
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", `M ${a.x} ${a.y} Q ${midX} ${dipY} ${b.x} ${b.y}`);
        path.setAttribute("class", "twin-locate-bypass");
        svg.appendChild(path);
      });

      positionLocateHighlight();
    });
  }

  function renderLocateChain(caseKey) {
    const chain = locateChains[caseKey];
    const top = $("locateChainTop");
    const content = $("locateChainContent");
    if (!chain || !top || !content) return;
    top.innerHTML = "";
    content.innerHTML = "";

    const highlight = document.createElement("div");
    highlight.className = "twin-locate-highlight";
    top.appendChild(highlight);

    const hover = document.createElement("div");
    hover.className = "twin-locate-hover";
    top.appendChild(hover);

    // 展开出真正会渲染成节点的层,同时记下哪些节点前面夹了一个「分叉判定」(虚线连接)
    const contentSteps = [];
    const branchBeforeIndex = new Set();
    let sawBranch = false;
    chain.steps.forEach((step) => {
      if (step.branch) {
        sawBranch = true;
        return;
      }
      if (sawBranch) branchBeforeIndex.add(contentSteps.length);
      contentSteps.push(step);
      sawBranch = false;
    });

    contentSteps.forEach((step, index) => {
      const sectionId = `locate-section-${caseKey}-${index}`;

      const node = document.createElement("div");
      node.className = "twin-locate-node" + (index === 0 ? " is-active" : "");
      node.dataset.target = sectionId;
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", "0");
      node.innerHTML = `
        <strong class="twin-locate-node-label">${step.label}</strong>
        <small class="twin-locate-node-sub">${step.short || ""}</small>
        <span class="twin-locate-node-dot-row"><span class="twin-locate-node-dot"></span></span>
      `;
      const jumpToSection = () => {
        setActiveLocateNode(sectionId);
        document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      node.addEventListener("click", jumpToSection);
      node.addEventListener("mouseenter", () => positionLocateHover(node));
      node.addEventListener("mouseleave", () => positionLocateHover(null));
      node.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        jumpToSection();
      });
      top.appendChild(node);

      const section = document.createElement("section");
      section.className = "twin-locate-section" + (index === 0 ? " is-active" : "");
      section.id = sectionId;
      const titleRow = document.createElement("div");
      titleRow.className = "twin-locate-section-title-row";
      const titleEl = document.createElement("h3");
      titleEl.className = "twin-locate-section-title";
      titleEl.textContent = step.label;
      titleRow.appendChild(titleEl);
      // loss/grad_norm 图表所在的节(迭代层)标题右侧复用「关键指标」面板同款 smoothing 滑条
      if (step.showSmoothing) titleRow.appendChild(buildAccuracySmoothControl());
      const bodyEl = document.createElement("div");
      bodyEl.className = "twin-locate-section-content";
      bodyEl.innerHTML = step.content || step.sub;
      section.appendChild(titleRow);
      section.appendChild(bodyEl);
      content.appendChild(section);
    });

    drawLocateTrackLines(top, contentSteps.length, branchBeforeIndex, chain.bypass || []);

    locateChainObserver?.disconnect();
    const root = $("runTwinLocateView");
    const sections = Array.from(content.querySelectorAll(".twin-locate-section"));
    if (root && sections.length) {
      locateChainObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) setActiveLocateNode(entry.target.id);
          });
        },
        { root, rootMargin: "-76px 0px -70% 0px", threshold: 0 }
      );
      sections.forEach((section) => locateChainObserver.observe(section));
    }
  }

  // 定位链「迭代层」内容区复用「关键指标」的 loss / grad_norm 图表(同一份事故重演数据 incidentSteps/incidentData),
  // 通过 [data-locate-chart] 占位符挂载,避免重复实现一套图表渲染逻辑
  let locateMetricCards = []; // [{el, cfg, ctrl, size}]

  function syncLocateMetricCharts(force) {
    locateMetricCards.forEach((c) => {
      const w = Math.round(c.el.clientWidth || 0);
      const h = Math.round(c.el.clientHeight || 0);
      if (w < 2 || h < 2) return;
      if (!force && c.ctrl && w === c.size.w && h === c.size.h) return;
      c.size = { w, h };
      c.ctrl = renderMetricChart(c.el, c.cfg, w, h);
    });
  }

  // 「迭代层」专用:在多卡曲线(会跳变为 NaN/inf)之外叠加一条单卡重跑同一 step 的曲线——
  // 单卡不经历 all-to-all,全程健康,用来对照出「仅多卡复现」(定位链.md 115 行·分叉判定)。
  // 只在这里叠加第二条曲线,不改「关键指标」面板本身用的 ACC_CARD_DEFS。
  const LOCATE_SINGLE_SERIES = {
    loss: { id: "loss_single", label: "单卡(正常)", key: "loss_single", colorVar: "--twin-chart-mfu" },
    // grad_norm 多卡曲线本就是深紫(--twin-chart-gradnorm),单卡改用绿色(--twin-chart-acc),避免同为紫色系难以区分
    gradnorm: { id: "grad_norm_single", label: "单卡(正常)", key: "grad_norm_single", colorVar: "--twin-chart-acc" },
  };
  function buildLocateMetricCfg(baseCfg) {
    const single = LOCATE_SINGLE_SERIES[baseCfg.id];
    return {
      ...baseCfg,
      legend: true,
      series: [
        { ...baseCfg.series[0], label: "多卡" },
        single,
      ],
    };
  }

  function mountLocateMetricCharts(container) {
    locateMetricCards = [];
    if (!container || !window.PtoTrainingMetricsChart) return;
    [["loss", ACC_CARD_DEFS.find((c) => c.id === "loss")], ["gradnorm", ACC_CARD_DEFS.find((c) => c.id === "gradnorm")]].forEach(([key, baseCfg]) => {
      const el = container.querySelector(`[data-locate-chart="${key}"]`);
      if (!el || !baseCfg) return;
      const cfg = buildLocateMetricCfg(baseCfg);
      // 图例挂在 head 里(固定高度,不参与图表容器的测量),不用引擎内置图例,避免高度反复增长
      const head = el.closest(".twin-locate-metric-card")?.querySelector(".twin-locate-metric-card__head");
      if (head) head.appendChild(buildAccLegend(cfg.series));
      locateMetricCards.push({ el, cfg, ctrl: null, size: { w: 0, h: 0 } });
    });
    if (locateMetricCards.length) requestAnimationFrame(() => syncLocateMetricCharts(true));
  }

  // 体现 Pangu 72B 定位链案例一:对比各 EP rank 的 all-to-all send/recv buffer size。
  // 31 个正常 rank send≈recv≈19MB(收发对称);rank 23 send=0(本地 token 全留在本卡 expert 47,
  // 没有 token 发往其它 rank)、recv=151MB(2048 token × 4608 dim × 8 expert,BF16 2B/元素)——
  // 收发严重不对称 → all-to-all 期望的对称尺寸对不上 → 死锁。
  function drawBufferChart() {
    const canvas = document.getElementById("bufChart");
    if (!canvas) return;
    // Canvas 2D 不认 CSS 变量,先从元素上取出 token 的具体色值(随主题变化)
    const cs = getComputedStyle(canvas);
    const tok = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
    const cMuted = tok("--foreground-muted", "#8a8f98");
    const cSec = tok("--foreground-secondary", "#5c626b");
    const cGrid = tok("--border-subtle", "rgba(128,128,128,.25)");
    const cSend = "#3b82f6", cRecv = "#f59e0b", cHot = "#dc2626";

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.getBoundingClientRect().width || 520;
    const H = 168;
    canvas.width = cssW * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW;
    const n = 32, hot = 23;
    const padL = 30, padR = 12, padTop = 40, padBot = 16;
    const plotW = W - padL - padR;
    const barW = plotW / n;
    const baseY = H - padBot;
    const plotH = baseY - padTop;
    const maxVal = 160;                         // MB 满刻度
    const normal = 19, hotSend = 0, hotRecv = 151; // 2048×4608×8 ≈ 151MB (BF16)
    const yOf = (v) => baseY - (v / maxVal) * plotH;

    ctx.clearRect(0, 0, W, H);

    // 标题
    ctx.fillStyle = cSec; ctx.font = "600 11px system-ui"; ctx.textAlign = "left";
    ctx.fillText("layer 30 · 各 EP rank 的 all-to-all send/recv buffer (MB)", padL, 14);

    // 图例
    const lgX = padL, lgY = 28;
    ctx.fillStyle = cSend; ctx.fillRect(lgX, lgY - 7, 10, 7);
    ctx.fillStyle = cMuted; ctx.font = "10px system-ui"; ctx.fillText("send", lgX + 14, lgY);
    ctx.fillStyle = cRecv; ctx.fillRect(lgX + 48, lgY - 7, 10, 7);
    ctx.fillStyle = cMuted; ctx.fillText("recv", lgX + 62, lgY);

    // y 轴刻度 + 网格
    ctx.textAlign = "right"; ctx.font = "8px monospace";
    [0, 40, 80, 120, 160].forEach((v) => {
      const y = yOf(v);
      ctx.strokeStyle = cGrid; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillStyle = cMuted; ctx.fillText(String(v), padL - 4, y + 3);
    });

    // 均衡参考线(~19MB):正常 rank 的 send/recv 都贴着它
    const refY = yOf(normal);
    ctx.strokeStyle = cRecv; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, refY); ctx.lineTo(W - padR, refY); ctx.stroke();
    ctx.setLineDash([]);

    // 每个 rank:send(蓝)与 recv(橙)并排两根细柱,便于看"收发是否对称"
    for (let r = 0; r < n; r++) {
      const x = padL + r * barW;
      const isHot = r === hot;
      const sendVal = isHot ? hotSend : normal;
      const recvVal = isHot ? hotRecv : normal;
      const halfW = Math.max(1.1, barW / 2 - 0.6);
      // send
      ctx.fillStyle = isHot ? cHot : cSend;
      ctx.fillRect(x + 0.4, yOf(sendVal), halfW, baseY - yOf(sendVal));
      // recv
      ctx.fillStyle = cRecv;
      ctx.fillRect(x + 0.4 + halfW, yOf(recvVal), halfW, baseY - yOf(recvVal));
      if (isHot) {
        ctx.strokeStyle = cHot; ctx.lineWidth = 1.4;
        ctx.strokeRect(x + 0.4, yOf(recvVal), halfW * 2, baseY - yOf(recvVal));
        // send=0:在基线上画一个空心红槽标明"本该有 send,却是 0"
        ctx.strokeStyle = cHot; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.6, baseY - 4, halfW - 0.4, 4);
      }
      if (r % 8 === 0) {
        ctx.fillStyle = cMuted; ctx.font = "8px monospace"; ctx.textAlign = "center";
        ctx.fillText(String(r), x + barW / 2, H - 4);
      }
    }
    // rank 23 定位标
    const rx = padL + hot * barW + barW / 2;
    ctx.fillStyle = cHot; ctx.font = "bold 9px monospace"; ctx.textAlign = "center";
    ctx.fillText("r23", rx, H - 4);
    ctx.beginPath(); ctx.moveTo(rx, yOf(hotRecv) - 3); ctx.lineTo(rx - 3, yOf(hotRecv) - 8); ctx.lineTo(rx + 3, yOf(hotRecv) - 8); ctx.closePath(); ctx.fill();

    // 失配注释框(放在右侧空白区,指向 rank 23 的 recv 塔)
    const boxX = Math.min(rx + 30, W - padR - 214), boxY = 40, boxW = 208, boxH = 52;
    ctx.fillStyle = cHot; ctx.globalAlpha = 0.10; ctx.fillRect(boxX, boxY, boxW, boxH); ctx.globalAlpha = 1;
    ctx.strokeStyle = cHot; ctx.lineWidth = 1; ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = cHot; ctx.font = "bold 10px system-ui"; ctx.textAlign = "left";
    ctx.fillText("rank 23 send/recv 失配 → 死锁", boxX + 8, boxY + 15);
    ctx.fillStyle = cSec; ctx.font = "9px system-ui";
    ctx.fillText("send = 0(无 token 发往其它 rank)", boxX + 8, boxY + 30);
    ctx.fillText("recv = 151MB = 2048×4608×8 (BF16)", boxX + 8, boxY + 44);
    // 引线:注释框 → recv 塔顶
    ctx.strokeStyle = cHot; ctx.lineWidth = 0.8; ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(boxX, boxY + boxH / 2); ctx.lineTo(rx + barW / 2, yOf(hotRecv) + 6); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── infra 层热力图快照 ────────────────────────────────────────────────────
  // 上半：全局 64 GPU × PP stage 分组；下半：问题节点放大镜
  var INFRA_SNAPSHOTS = {
    "moe-a2a": {
      node: 2, hotGPUs: [7], warmGPUs: [0, 1, 2, 3, 4, 5, 6],
      label: "node2 放大 · 32 GPU 内部",
      hotLabel: "GPU 7 (EP rank 23) 死锁", warmLabel: "GPU 0~6 空等",
      ppStage: 3, ppLabel: "PP stage 3 · layers 24~35",
    },
    "nvlink": {
      node: 2, hotGPUs: [3, 4], warmGPUs: [0, 1, 2, 5, 6, 7],
      label: "node2 放大 · NVLINK GPU3↔GPU4 掉线",
      hotLabel: "GPU 3 & 4 带宽降级", warmLabel: "同节点其余 GPU 受影响",
      ppStage: 4, ppLabel: "PP stage 4↔5 跨 stage p2p 被拖慢",
    },
    "perf-comm-straggler": {
      node: null, hotRanks: [17, 23, 41],
      label: "2048 GPU 全局 · rank 17/23/41 straggler",
      hotLabel: "rank 17/23/41 负载 5×", warmLabel: "其余 61 EP rank 空等",
      ppStage: null, ppLabel: "周期性尖峰 · CV=27%",
    },
  };

  var PP_STAGE_COLORS = ["#3b82f6","#06b6d4","#10b981","#f59e0b","#f97316","#ef4444","#8b5cf6","#ec4899"];
  var NODES = 64, GPUS_PER_NODE = 32, TOTAL = NODES * GPUS_PER_NODE;

  function renderInfraHeatSnapshot(caseKey) {
    var canvas = document.getElementById("infraHeatCanvas");
    if (!canvas) return;
    var snap = INFRA_SNAPSHOTS[caseKey];
    if (!snap) return;

    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.getBoundingClientRect().width || 400;
    var H = snap.node != null ? 560 : 220;
    canvas.width = cssW * dpr;
    canvas.height = H * dpr;
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var W = cssW;

    var RED = "#dc2626", ORANGE = "#ea580c", WHITE = "#ffffff";
    var cs = getComputedStyle(canvas);
    var cMuted = cs.getPropertyValue("--foreground-muted").trim() || "#8a8f98";
    var cSec = cs.getPropertyValue("--foreground-secondary").trim() || "#5c626b";
    // 热力图配色梯度（对齐 CSS token: util-low → util-mid → util-high）
    var LOW_COLOR = { r: 147, g: 197, b: 253 };   // ≈ --twin-util-low 蓝
    var MID_COLOR = { r: 74,  g: 222, b: 128 };   // ≈ --twin-util-mid 绿
    var HIGH_COLOR = { r: 34, g: 197, b: 94 };     // ≈ --twin-util-high 深绿

    // 确定性伪随机（seed 固定，每次渲染一致）
    var seed = 42;
    function rand() { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; }

    // 为 2048 GPU 生成模拟利用率（node 粒度基值 + GPU 粒度微调）
    var gpuUtils = [];
    for (var ni = 0; ni < NODES; ni++) {
      var baseUtil = 0.72 + rand() * 0.22; // node 基值 72%~94%
      // 个别 node 整体偏低（模拟真实集群的 straggler/low-util node）
      if (rand() < 0.08) baseUtil = 0.42 + rand() * 0.18;
      for (var g = 0; g < GPUS_PER_NODE; g++) {
        gpuUtils.push(Math.min(1, Math.max(0.35, baseUtil + (rand() - 0.5) * 0.12)));
      }
    }

    // util → 颜色插值
    function utilColor(u) {
      var a, b, t;
      if (u < 0.7) { a = LOW_COLOR; b = MID_COLOR; t = u / 0.7; }
      else { a = MID_COLOR; b = HIGH_COLOR; t = (u - 0.7) / 0.3; }
      var r = Math.round(a.r + (b.r - a.r) * t);
      var g = Math.round(a.g + (b.g - a.g) * t);
      var bl = Math.round(a.b + (b.b - a.b) * t);
      return "rgb(" + r + "," + g + "," + bl + ")";
    }

    ctx.clearRect(0, 0, W, H);

    if (snap.node != null) {
      // ═══════════════════════════════════════════════════════════════
      //  上半：2048 个 GPU 小格子（32 列 × 64 行，每行=1 node）
      // ═══════════════════════════════════════════════════════════════
      var padL = 52, padR = 12, padT = 22, padB = 8;
      var gCols = 32, gRows = 64;           // 32 GPU/列, 64 node/行
      var gCellW = (W - padL - padR) / gCols;  // ≈ 10.5px
      var gCellH = 5.6;                       // 固定行高
      var globalH = gRows * gCellH;
      var gStartX = padL, gStartY = padT;

      // PP stage 行分组色带（每 8 node 一行 stage：64/8=8）
      var NODES_PER_STAGE = 8;
      for (var stage = 0; stage < 8; stage++) {
        var sy = gStartY + stage * NODES_PER_STAGE * gCellH;
        ctx.fillStyle = PP_STAGE_COLORS[stage];
        ctx.globalAlpha = 0.08;
        ctx.fillRect(gStartX, sy, gCols * gCellW, NODES_PER_STAGE * gCellH);
        ctx.globalAlpha = 1;
        // stage 标签（左侧）
        ctx.fillStyle = PP_STAGE_COLORS[stage];
        ctx.font = "bold 6px system-ui"; ctx.textAlign = "right";
        var labelY = sy + (NODES_PER_STAGE * gCellH) / 2 + 2;
        ctx.fillText("S" + stage, padL - 4, labelY);
        // 层范围标注
        ctx.font = "5px system-ui";
        var layerStart = stage * 8, layerEnd = Math.min(layerStart + 7, 60);
        ctx.fillText("L" + layerStart + "~" + layerEnd, padL - 4, labelY + 7);
      }

      // 2048 GPU 小格子（每格颜色=模拟利用率）
      for (var ni = 0; ni < NODES; ni++) {
        var rowY = gStartY + ni * gCellH;
        var isProblemNode = (ni === snap.node);

        for (var g = 0; g < GPUS_PER_NODE; g++) {
          var cx = gStartX + g * gCellW + 0.5;
          var idx = ni * GPUS_PER_NODE + g;
          var isHot = isProblemNode && snap.hotGPUs && snap.hotGPUs.indexOf(g) >= 0;
          var isWarm = isProblemNode && snap.warmGPUs && snap.warmGPUs.indexOf(g) >= 0;

          if (isHot)      { ctx.fillStyle = RED; ctx.globalAlpha = 1; }
          else if (isWarm) { ctx.fillStyle = ORANGE; ctx.globalAlpha = 0.7; }
          else if (isProblemNode) { ctx.fillStyle = gpuUtils[idx] < 0.6 ? "#93c5fd" : "#4ade80"; ctx.globalAlpha = 0.22; }
          else            { ctx.fillStyle = utilColor(gpuUtils[idx]); ctx.globalAlpha = 0.72; }

          ctx.fillRect(cx, rowY + 0.3, gCellW - 0.5, gCellH - 0.6);
          ctx.globalAlpha = 1;
        }

        // 问题节点行高亮边框
        if (isProblemNode) {
          ctx.strokeStyle = RED; ctx.lineWidth = 1.2;
          ctx.strokeRect(gStartX, rowY + 0.2, gCols * gCellW, gCellH);
        }

        // 每 8 node 标注行号
        if (ni % 8 === 0) {
          ctx.fillStyle = cMuted; ctx.font = "7px monospace"; ctx.textAlign = "right";
          ctx.fillText("n" + ni, padL - 4, rowY + gCellH / 2 + 3);
        }
      }

      // 标题
      ctx.fillStyle = cSec; ctx.font = "10px system-ui"; ctx.textAlign = "left";
      ctx.fillText("全局 2048 GPU · 32 GPU/列 × 64 node/行 · PP stage 行分组（S0~S7，每 8 node）", 12, 12);

      // 问题节点右侧标注
      var hotRowY = gStartY + snap.node * gCellH;
      ctx.fillStyle = RED; ctx.font = "bold 7px system-ui"; ctx.textAlign = "left";
      ctx.fillText("◀ n" + snap.node + " 异常", padL + gCols * gCellW + 4, hotRowY + gCellH / 2 + 3);

      // ═══════════════════════════════════════════════════════════════
      //  下半：问题 node 放大镜（32 GPU 横排）
      // ═══════════════════════════════════════════════════════════════
      var zoomTop = gStartY + globalH + 18;
      var zCellW = Math.min(36, (W - 60) / GPUS_PER_NODE), zCellH = zCellW;
      var zStartX = (W - GPUS_PER_NODE * zCellW) / 2;

      // 引线
      ctx.strokeStyle = RED; ctx.lineWidth = 0.8; ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(padL - 6, hotRowY + gCellH / 2);
      ctx.lineTo(padL - 6, zoomTop - 8);
      ctx.lineTo(zStartX + GPUS_PER_NODE * zCellW / 2, zoomTop - 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = RED;
      ctx.beginPath(); ctx.moveTo(zStartX + GPUS_PER_NODE * zCellW / 2, zoomTop - 14); ctx.lineTo(zStartX + GPUS_PER_NODE * zCellW / 2 - 5, zoomTop - 4); ctx.lineTo(zStartX + GPUS_PER_NODE * zCellW / 2 + 5, zoomTop - 4); ctx.closePath(); ctx.fill();

      // 放大镜标题
      ctx.fillStyle = cSec; ctx.font = "10px system-ui"; ctx.textAlign = "center";
      ctx.fillText(snap.label, W / 2, zoomTop - 2);

      // 32 GPU 横排
      for (var g = 0; g < GPUS_PER_NODE; g++) {
        var zx = zStartX + g * zCellW + 1, zy = zoomTop + 4;
        var isHot = snap.hotGPUs && snap.hotGPUs.indexOf(g) >= 0;
        var isWarm = snap.warmGPUs && snap.warmGPUs.indexOf(g) >= 0;

        ctx.fillStyle = isHot ? RED : isWarm ? ORANGE : utilColor(gpuUtils[snap.node * GPUS_PER_NODE + g]);
        ctx.globalAlpha = isHot ? 0.9 : isWarm ? 0.55 : 0.65;
        ctx.fillRect(zx, zy, zCellW - 2, zCellH - 2);
        ctx.globalAlpha = 1;

        if (isHot) {
          ctx.strokeStyle = RED; ctx.lineWidth = 1.8;
          ctx.strokeRect(zx, zy, zCellW - 2, zCellH - 2);
        }
        if (g % 8 === 0 && zCellW > 24) {
          ctx.fillStyle = WHITE; ctx.font = "bold 7px system-ui"; ctx.textAlign = "center";
          ctx.fillText("G" + g, zx + (zCellW - 2) / 2, zy + zCellH / 2 + 3);
        }
      }

      // 下方标注
      var botY = zoomTop + zCellH + 14;
      ctx.fillStyle = RED; ctx.font = "bold 10px system-ui"; ctx.textAlign = "center";
      ctx.fillText(snap.hotLabel, W / 2, botY);
      ctx.fillStyle = ORANGE; ctx.font = "10px system-ui";
      ctx.fillText(snap.warmLabel, W / 2, botY + 16);
      ctx.fillStyle = cMuted; ctx.font = "9px system-ui";
      ctx.fillText(snap.ppLabel, W / 2, botY + 30);

    } else {
      // straggler 视图：EP=64 ranks（非全量 2048 GPU）
      var cols = 16, rows = 4;
      var gCellW = (W - 40) / cols, gCellH = Math.min(26, (H - 70) / rows);
      var sx = (W - cols * gCellW) / 2, sy = 45;

      for (var r = 0; r < 64; r++) {
        var col = r % cols, row = Math.floor(r / cols);
        var cx = sx + col * gCellW + 1, cy = sy + row * gCellH + 1;
        var isHot = snap.hotRanks && snap.hotRanks.indexOf(r) >= 0;

        var u = 0.65 + rand() * 0.3;
        ctx.fillStyle = isHot ? RED : utilColor(u);
        ctx.globalAlpha = isHot ? 0.9 : 0.25;
        ctx.fillRect(cx, cy, gCellW - 2, gCellH - 2);
        ctx.globalAlpha = 1;

        if (isHot) {
          ctx.strokeStyle = RED; ctx.lineWidth = 1.2;
          ctx.strokeRect(cx, cy, gCellW - 2, gCellH - 2);
        }
      }

      ctx.fillStyle = cSec; ctx.font = "12px system-ui"; ctx.textAlign = "center";
      ctx.fillText(snap.label, W / 2, 24);
      ctx.fillStyle = RED; ctx.font = "bold 10px system-ui";
      ctx.fillText(snap.hotLabel, W / 2, sy + rows * gCellH + 22);
      ctx.fillStyle = cMuted; ctx.font = "9px system-ui";
      ctx.fillText(snap.ppLabel, W / 2, sy + rows * gCellH + 38);
    }
  }

  // ── 模型层展开图 ──────────────────────────────────────────────────────────
  // 复用 pangu-moe-trainviz/ep-expert-parallel-2d.html 上方「层视图」的配色与几何(侧视层轨 + 内联展开面板),
  // 但不嵌 iframe——直接按 DeepSeek-V3.2 架构(arxiv:2412.19437 / HuggingFace config.json)重画,
  // 校准单层 MoE TransformerLayer 的模块流程与数量常量(256 routed / top-8 / 1 shared / MLA / n_group=8)。
  const LV_BASE = {
    layers: 61,          // 0~60:L0~2 Dense,L3~60 MoE
    denseLayers: 3,
    routedExperts: 256,
    sharedExperts: 1,
    topK: 8,
    nGroup: 8,
    topkGroup: 4,
    // 侧视图配色沿用参考页:青=attention,紫=router/dispatch/combine,黄=expert/norm,蓝=前向路由
    cAttn: "#7fcbd3", cRoute: "#b99ae7", cExpert: "#ead66f", cFlow: "#4f6df6", cHot: "#dc2626",
  };
  // 展开图「算子染色」模式(由整网图顶栏的算子染色开关联动):'cat' 按类别配色 / 'off' 中性灰(仅保留 cHot 红色诊断信号)。
  const LV_NEUTRAL = "#9ca3af";
  let lvColorMode = "cat";

  // 单层 MoE TransformerLayer 的模块流程(自底向上 = 输入→输出),y 为面板内竖直坐标。
  // 顺序严格对应架构参考 §3.2:input_layernorm → MLA → post_attention_layernorm →
  //   router → dispatch(all-to-all) → {shared + routed experts} → combine(all-to-all) → MoE merge(+残差)
  function lvModules() {
    return [
      { id: "in_norm",   y: 648, h: 30, color: LV_BASE.cExpert, label: "input_layernorm", note: "RmsNorm" },
      { id: "mla",       y: 536, h: 92, color: LV_BASE.cAttn,   label: "MLA 注意力",
        note: ["q_lora[7168→1536] · kv_lora[7168→512]", "128 heads · d=192 · attn_output→7168"] },
      { id: "post_norm", y: 484, h: 30, color: LV_BASE.cExpert, label: "post_attention_layernorm", note: "RmsNorm · +残差" },
      { id: "router",    y: 430, h: 34, color: LV_BASE.cRoute,  label: "router",
        note: `top-${LV_BASE.topK}/${LV_BASE.routedExperts} · n_group=${LV_BASE.nGroup} · topk_group=${LV_BASE.topkGroup}` },
      { id: "dispatch",  y: 392, h: 26, color: LV_BASE.cRoute,  label: "token dispatch", note: "all-to-all (EP dispatch)" },
      { id: "experts",   y: 210, h: 158, color: LV_BASE.cExpert, label: "expert pool", note: "" }, // 64 卡 × 4 expert 网格,特殊绘制
      { id: "combine",   y: 158, h: 26, color: LV_BASE.cRoute,  label: "token combine", note: "all-to-all (EP combine)" },
      { id: "merge",     y: 110, h: 30, color: LV_BASE.cFlow,   label: "MoE merge",
        note: "shared + Σ(routed_i × g_i) · +残差" },
    ];
  }

  // EP64:256 routed expert 分到 64 张卡,每卡 4 个(256/64)。返回代表某个 token 的 top-8 命中集合。
  // hotExpert!=null(事故层):98% token 倾斜到该 expert,其余 7 个只分到零头 → 连线粗细体现数据量。
  // 说明:框架里 expert→rank 的映射不一定连续,这里为与页面其它处的「EP rank 23」保持一致,
  //       直接把倾斜 expert 放进 rank 23,属业务示意。
  function lvSelectedExperts(hotExpert) {
    if (hotExpert == null) {
      // 非事故层:均衡命中 8 张卡,数据量相近
      return [3, 11, 19, 27, 36, 44, 52, 60].map((card) => ({ card, cell: card % 4, vol: 1 / 8, hot: false, id: card * 4 + (card % 4) }));
    }
    const hotCard = 23; // 与通信调度层/缓冲图的 EP rank 23 对齐
    return [
      { card: hotCard, cell: 0, vol: 0.98, hot: true, id: hotExpert },
      { card: 4, cell: 2, vol: 0.004, hot: false, id: 4 * 4 + 2 },
      { card: 12, cell: 1, vol: 0.004, hot: false, id: 12 * 4 + 1 },
      { card: 19, cell: 3, vol: 0.003, hot: false, id: 19 * 4 + 3 },
      { card: 33, cell: 0, vol: 0.003, hot: false, id: 33 * 4 },
      { card: 41, cell: 2, vol: 0.002, hot: false, id: 41 * 4 + 2 },
      { card: 50, cell: 1, vol: 0.002, hot: false, id: 50 * 4 + 1 },
      { card: 60, cell: 3, vol: 0.002, hot: false, id: 60 * 4 + 3 },
    ];
  }

  function lvBuildSvg(expandedLayer, hotExpert) {
    // 算子染色:'off' 模式把类别色统一压成中性灰(仅保留 cHot 红色诊断信号),'cat' 用原类别配色。
    // 局部 LV 遮蔽模块级 LV_BASE,函数内所有 LV.cXxx 引用随染色模式切换。
    const LV = lvColorMode === "off"
      ? Object.assign({}, LV_BASE, { cAttn: LV_NEUTRAL, cRoute: LV_NEUTRAL, cExpert: LV_NEUTRAL, cFlow: LV_NEUTRAL })
      : LV_BASE;
    const VW = 1180, VH = 720;
    const x0 = 150, railW = 1018;
    const panelW = 752, gap = 20;
    const normalStep = (railW - panelW - gap * 2) / (LV.layers - 1);
    const layerX = (layer) => {
      if (layer < expandedLayer) return x0 + layer * normalStep;
      if (layer === expandedLayer) return x0 + layer * normalStep + gap + panelW / 2;
      return x0 + expandedLayer * normalStep + gap * 2 + panelW + (layer - expandedLayer - 1) * normalStep;
    };
    const modules = lvModules().map((m) => (lvColorMode === "off" ? Object.assign({}, m, { color: LV_NEUTRAL }) : m));
    const laneY = Object.fromEntries(modules.map((m) => [m.id, m.y]));
    const railTop = 78, railBot = 678;
    const isMoe = expandedLayer >= LV.denseLayers;

    // 背景 lane 引导线(横跨层轨,对齐展开面板各模块中心)——让展开面板读起来就是被拉宽的那一层
    const guides = modules.map((m) => {
      const cy = m.y + m.h / 2;
      return `<line x1="${x0 - 4}" y1="${cy}" x2="${x0 + railW}" y2="${cy}" stroke="${m.color}" stroke-width="2" opacity=".16"></line>`;
    }).join("");

    // MoE 聚焦带:L3~L60
    const moeX1 = layerX(LV.denseLayers) - normalStep * 0.5;
    const moeX2 = layerX(LV.layers - 1) + normalStep * 0.5;

    // 每一层(除展开层)画成细列:dense 层不含 MoE lane,MoE 层含全部 lane
    const layerTicks = [];
    for (let layer = 0; layer < LV.layers; layer += 1) {
      if (layer === expandedLayer) continue;
      const x = layerX(layer);
      const isDense = layer < LV.denseLayers;
      const marks = modules.map((m) => {
        if (isDense && ["router", "dispatch", "experts", "combine"].includes(m.id)) return "";
        const cy = m.y + m.h / 2;
        const mh = Math.min(m.h, 24);
        return `<rect x="${x - 3}" y="${cy - mh / 2}" width="6" height="${mh}" rx="1.5" fill="${m.color}" opacity=".5"></rect>`;
      }).join("");
      const denseFfn = isDense
        ? `<rect x="${x - 3}" y="${laneY.experts + 40}" width="6" height="70" rx="1.5" fill="#9ca3af" opacity=".5"></rect>`
        : "";
      layerTicks.push(`
        <g data-lv-layer="${layer}" opacity=".6">
          <rect x="${x - 7}" y="${railTop}" width="14" height="${railBot - railTop}" rx="3" fill="transparent"></rect>
          ${marks}${denseFfn}
        </g>`);
    }

    // 展开面板几何
    const pcx = layerX(expandedLayer);
    const px = pcx - panelW / 2;

    // 普通模块盒(experts 特殊绘制;dense 层用一个 FFN 盒替换 MoE 系列)
    const denseMode = !isMoe;
    const boxes = modules.map((m) => {
      if (m.id === "experts") return "";
      if (denseMode && ["router", "dispatch", "combine"].includes(m.id)) return "";
      let label = m.label, notes = m.note ? (Array.isArray(m.note) ? m.note : [m.note]) : [];
      if (denseMode && m.id === "merge") { label = "Dense FFN 输出"; notes = ["+ 残差"]; }
      const bx = px + 40, bw = panelW - 80;
      const noteLines = notes.map((line, i) =>
        `<text class="lv-tiny mono" x="${pcx}" y="${m.y + m.h - 8 - (notes.length - 1 - i) * 13}" text-anchor="middle" opacity=".85">${line}</text>`).join("");
      return `
        <rect x="${bx}" y="${m.y}" width="${bw}" height="${m.h}" rx="7"
          fill="color-mix(in srgb, ${m.color} 22%, var(--surface-1))" stroke="${m.color}" stroke-opacity=".7"></rect>
        <text class="lv-tiny" x="${pcx}" y="${m.y + (notes.length ? 16 : m.h / 2 + 4)}" text-anchor="middle" style="font-weight:800">${label}</text>
        ${noteLines}`;
    }).join("");

    // ── expert pool:64 张卡 × 4 expert(EP64),高亮命中 top-8,连线粗细=数据量 ──
    const em = laneY.experts;               // 210
    const cardCols = 16, cardRows = 4;      // 64 卡
    const gapX = 4, gapY = 6;
    const gX = px + 96, gW = panelW - 150;   // 左侧 px+40..px+96 留给 shared 专家
    const gY = em + 40, gH = 108;
    const cardW = (gW - (cardCols - 1) * gapX) / cardCols;
    const cardH = (gH - (cardRows - 1) * gapY) / cardRows;
    const cellW = (cardW - 5) / 2, cellH = (cardH - 5) / 2;
    const cardPos = (card) => ({ x: gX + (card % cardCols) * (cardW + gapX), y: gY + Math.floor(card / cardCols) * (cardH + gapY) });
    const cellCenter = (card, cell) => {
      const p = cardPos(card);
      return { x: p.x + 2 + (cell % 2) * cellW + cellW / 2, y: p.y + 2 + Math.floor(cell / 2) * cellH + cellH / 2 };
    };
    const selected = isMoe ? lvSelectedExperts(hotExpert) : [];
    const selKey = new Set(selected.map((s) => `${s.card}.${s.cell}`));
    const hotCards = new Set(selected.filter((s) => s.hot).map((s) => s.card));

    // 64 张卡 + 每卡 4 个 expert 小格
    let cardsSvg = "";
    for (let card = 0; card < 64; card += 1) {
      const p = cardPos(card);
      const overloaded = hotCards.has(card);
      cardsSvg += `<rect x="${p.x}" y="${p.y}" width="${cardW}" height="${cardH}" rx="2.5"
        fill="color-mix(in srgb, ${LV.cFlow} 6%, var(--surface-1))"
        stroke="${overloaded ? LV.cHot : LV.cFlow}" stroke-opacity="${overloaded ? "1" : ".28"}" stroke-width="${overloaded ? "2" : "0.8"}"></rect>`;
      for (let cell = 0; cell < 4; cell += 1) {
        const c = cellCenter(card, cell);
        const hot = selected.find((s) => s.card === card && s.cell === cell && s.hot);
        let fill, op, extra = "";
        if (hotExpert != null) {
          // 事故层:格子亮度 ∝ 该 expert 的 token 量。98% 全压在 E47(亮红),其余 63 个 ≈0(极淡)——
          // 直接体现模型层 §4「98% token → expert 47,其余 63 expert 几乎无 token」的路由倾斜。
          fill = hot ? LV.cHot : LV.cExpert;
          op = hot ? 1 : 0.12;
        } else {
          // 均衡层:高亮该 token 命中的 top-8
          const sel = selKey.has(`${card}.${cell}`);
          fill = hot ? LV.cHot : sel ? LV.cFlow : LV.cExpert;
          op = hot ? 1 : sel ? 0.92 : 0.5;
          if (sel) extra = `stroke="#fff" stroke-width="1"`;
        }
        cardsSvg += `<rect x="${c.x - cellW / 2}" y="${c.y - cellH / 2}" width="${cellW - 1}" height="${cellH - 1}" rx="1"
          fill="${fill}" opacity="${op}" ${extra}></rect>`;
      }
    }
    // 卡编号:每 4 卡标一次 rank,外加倾斜卡 r23
    let cardLabels = "";
    for (let card = 0; card < 64; card += 4) {
      const p = cardPos(card);
      cardLabels += `<text class="lv-tiny mono" x="${p.x}" y="${p.y - 2}" opacity=".5" style="font-size:8px">r${card}</text>`;
    }
    const rHot = cardPos(23);
    cardLabels += `<text class="lv-tiny mono" x="${rHot.x + cardW / 2}" y="${rHot.y - 3}" text-anchor="middle" fill="${LV.cHot}" style="font-weight:800;font-size:9px">EP rank 23</text>`;

    // 均衡层:dispatch 条 → 命中 expert → combine 条 的静态扇形连线(粗细 ∝ vol)。
    // 事故层不画这套,改用下面的两阶段 all-to-all 动画。
    const dispY = laneY.dispatch, combY = laneY.combine + modules.find((m) => m.id === "combine").h;
    const w = (vol) => 1 + vol * 12;
    let routeLines = "";
    if (isMoe && hotExpert == null) {
      selected.forEach((s) => {
        const c = cellCenter(s.card, s.cell);
        routeLines += `<path d="M${pcx} ${dispY} C${pcx} ${(dispY + c.y) / 2} ${c.x} ${(dispY + c.y) / 2 + 12} ${c.x} ${c.y + cellH / 2 + 2}"
          stroke="${LV.cFlow}" stroke-width="${w(s.vol)}" fill="none" opacity=".55" stroke-linecap="round"></path>`;
        routeLines += `<path d="M${c.x} ${c.y - cellH / 2 - 2} C${c.x} ${(combY + c.y) / 2 - 12} ${pcx} ${(combY + c.y) / 2} ${pcx} ${combY}"
          stroke="${LV.cFlow}" stroke-width="${w(s.vol)}" fill="none" opacity=".47" stroke-linecap="round"></path>`;
      });
    }

    // top-8 专家 all-to-all(体现 定位链.md L128):all-to-all 发生在该 token 命中的 8 个专家(所在 rank)之间。
    // 8 个参与者用高亮环标出,它们之间画满 all-to-all mesh(C(8,2)=28 条蓝线)。动画分两阶段(见 startLayerA2A):
    //   ① dispatch:mesh 逐条生长,8 个 rank 陆续收到数据 → 全部「变红」(recv);
    //   ② combine:7 个专家完成输出 → 恢复原色,而 rank 23 send=0 无法输出 → 保持红色(死锁)。
    let a2aMesh = "", a2aNodes = "", a2aLabels = "";
    if (isMoe && hotExpert != null) {
      const sel = lvSelectedExperts(hotExpert); // 8 个,sel[0] 为倾斜的 rank 23(hot)
      const nodes = sel.map((s, k) => {
        const c = cellCenter(s.card, s.cell), p = cardPos(s.card);
        return { k, hot: !!s.hot, cx: c.x, cy: c.y, px: p.x, py: p.y };
      });
      let mi = 0;
      for (let a = 0; a < nodes.length; a += 1) {
        for (let b = a + 1; b < nodes.length; b += 1) {
          const A = nodes[a], B = nodes[b];
          const len = Math.hypot(B.cx - A.cx, B.cy - A.cy).toFixed(1);
          a2aMesh += `<path class="lv-a2a-mesh" data-mi="${mi}" data-len="${len}" style="--lv-dash:${len}" d="M${A.cx} ${A.cy} L${B.cx} ${B.cy}"></path>`;
          mi += 1;
        }
      }
      nodes.forEach((n) => {
        a2aNodes += `<rect class="lv-a2a-ring" x="${n.px - 1.5}" y="${n.py - 1.5}" width="${cardW + 3}" height="${cardH + 3}" rx="3.5"></rect>`;
        a2aNodes += `<rect class="lv-a2a-node" data-k="${n.k}" data-hot="${n.hot ? 1 : 0}" x="${n.px}" y="${n.py}" width="${cardW}" height="${cardH}" rx="2.5"></rect>`;
      });
      const ly = gY + gH + 12;
      a2aLabels = `
        <text class="lv-tiny lv-a2a-label" data-phase="disp" x="${cardPos(0).x}" y="${ly}" fill="${LV.cHot}" style="font-weight:800">① all-to-all dispatch:top-8 专家互相收发 token,8 个 rank 收到数据 → 变红(rank 23 recv=2048×4608×8≈151MB)</text>
        <text class="lv-tiny lv-a2a-label" data-phase="comb" x="${cardPos(0).x}" y="${ly}" fill="${LV.cFlow}" style="font-weight:800;opacity:0">② all-to-all combine:7 个专家输出完成→恢复原色,rank 23 send=0 无法输出 → 保持红色(死锁)</text>`;
    }

    // shared expert:1 个,处理全部 token,不走 all-to-all(左侧独立支路 + 虚线旁路)
    const shX = px + 46, shW = 44;
    const sharedSvg = isMoe ? `
      <rect x="${shX}" y="${gY}" width="${shW}" height="${gH}" rx="4" fill="${LV.cAttn}" opacity=".72"></rect>
      <text class="lv-tiny" x="${shX + shW / 2}" y="${gY + gH / 2 - 4}" text-anchor="middle" style="font-weight:800">shared</text>
      <text class="lv-tiny" x="${shX + shW / 2}" y="${gY + gH / 2 + 10}" text-anchor="middle">×1</text>
      <path d="M${shX + shW / 2} ${dispY + 6} V${gY + gH}" stroke="${LV.cAttn}" stroke-width="3" fill="none" opacity=".6" stroke-dasharray="5 4"></path>
      <path d="M${shX + shW / 2} ${gY} V${combY - 6}" stroke="${LV.cAttn}" stroke-width="3" fill="none" opacity=".6" stroke-dasharray="5 4"></path>
      <text class="lv-tiny" x="${shX}" y="${gY - 8}" fill="color-mix(in srgb, ${LV.cAttn} 90%, #000)">全 token · 不走 a2a</text>
    ` : "";

    // ── 体现 定位链.md L128:rank 23 的 all-to-all send/recv buffer 失配 ──
    // 本地 token 全落在本卡 expert 47 → 没有 token 需要发往别的 rank(send=0);
    // 但全局 98% token 都选中 E47,要从其它 rank 收进来(recv=2048×4608×8≈151MB) → 收发尺寸对不上 → 死锁。
    let mismatchGauge = "";
    if (isMoe && hotExpert != null) {
      const gx = px + 396, barX = gx + 40, barMaxW = 148;
      const recvW = barMaxW, sendW = 3; // send≈0 只画一个空心红槽
      mismatchGauge = `
        <text class="lv-tiny" x="${gx}" y="${em + 12}" fill="${LV.cHot}" style="font-weight:800">EP rank 23 all-to-all buffer 失配 → 死锁</text>
        <text class="lv-tiny" x="${gx}" y="${em + 27}">send</text>
        <rect x="${barX}" y="${em + 20}" width="${sendW}" height="8" rx="1" fill="none" stroke="${LV.cHot}" stroke-width="1"></rect>
        <text class="lv-tiny mono" x="${barX + 10}" y="${em + 27}" fill="${LV.cHot}" style="font-weight:800">0(无 token 外发)</text>
        <text class="lv-tiny" x="${gx}" y="${em + 39}">recv</text>
        <rect x="${barX}" y="${em + 32}" width="${recvW}" height="8" rx="1" fill="${LV.cHot}"></rect>
        <text class="lv-tiny mono" x="${barX + recvW + 6}" y="${em + 39}" fill="${LV.cHot}" style="font-weight:800">2048×4608×8 ≈ 151MB</text>`;
    }
    const expertsTitle = isMoe && hotExpert != null
      ? `routed experts · ${LV.routedExperts} → EP64(64 卡 × 4)`
      : `routed experts · ${LV.routedExperts} → EP64:64 卡 × 4/卡 · 激活 top-${LV.topK}`;
    // 模型层 §4 路由倾斜说明(事故层):点明 98%→E47、其余 expert≈0,与网格热力配色对应
    const skewCaption = isMoe && hotExpert != null
      ? `<text class="lv-tiny" x="${px + 52}" y="${em + 31}" fill="${LV.cHot}" style="font-weight:700">router 输出:98% token → E${hotExpert} · 其余 63 expert ≈ 0(格子亮度 ∝ token 量)</text>`
      : "";
    const expertsGroup = isMoe ? `
      <rect x="${px + 40}" y="${em}" width="${panelW - 80}" height="${modules.find((m) => m.id === "experts").h}" rx="8"
        fill="color-mix(in srgb, ${LV.cExpert} 7%, var(--surface-1))" stroke="currentColor" stroke-opacity=".12"></rect>
      <text class="lv-tiny" x="${px + 52}" y="${em + 18}" style="font-weight:800">${expertsTitle}</text>
      ${skewCaption}
      ${mismatchGauge}
      ${sharedSvg}
      ${cardsSvg}
      ${cardLabels}
    ` : `
      <rect x="${px + 40}" y="${em}" width="${panelW - 80}" height="${modules.find((m) => m.id === "experts").h}" rx="8"
        fill="color-mix(in srgb, #9ca3af 10%, var(--surface-1))" stroke="#9ca3af" stroke-opacity=".4"></rect>
      <text class="lv-tiny" x="${pcx}" y="${em + 60}" text-anchor="middle" style="font-weight:800">Dense FFN (SwiGLU)</text>
      <text class="lv-tiny mono" x="${pcx}" y="${em + 80}" text-anchor="middle" opacity=".85">gate/up [7168→18432] · down [18432→7168]</text>`;

    // 主前向路由箭头:MoE 层在 dispatch↔combine 之间由扇形连线接管,故中间不画贯穿箭头
    const cyOf = (id) => { const m = modules.find((x) => x.id === id); return m.y + m.h / 2; };
    const seg = (id) => modules.find((m) => m.id === id).h / 2;
    let order = ["in_norm", "mla", "post_norm", "router", "dispatch"];
    let flow = `<path d="M${pcx} 690 V${cyOf("in_norm") + 15}" stroke="${LV.cFlow}" stroke-width="3.4" fill="none" marker-end="url(#lvArrow)" opacity=".85"></path>`;
    if (denseMode) order = ["in_norm", "mla", "post_norm"];
    for (let i = 0; i < order.length - 1; i += 1) {
      flow += `<path d="M${pcx} ${cyOf(order[i]) - seg(order[i])} V${cyOf(order[i + 1]) + seg(order[i + 1])}"
        stroke="${LV.cFlow}" stroke-width="3.4" fill="none" marker-end="url(#lvArrow)" opacity=".82"></path>`;
    }
    // combine → merge → output
    if (isMoe) {
      flow += `<path d="M${pcx} ${cyOf("combine") - seg("combine")} V${cyOf("merge") + seg("merge")}" stroke="${LV.cFlow}" stroke-width="3.4" fill="none" marker-end="url(#lvArrow)" opacity=".82"></path>`;
    } else {
      flow += `<path d="M${pcx} ${cyOf("post_norm") - seg("post_norm")} V${em + modules.find((m) => m.id === "experts").h}" stroke="${LV.cFlow}" stroke-width="3.4" fill="none" marker-end="url(#lvArrow)" opacity=".82"></path>
        <path d="M${pcx} ${em} V${cyOf("merge") + seg("merge")}" stroke="${LV.cFlow}" stroke-width="3.4" fill="none" marker-end="url(#lvArrow)" opacity=".82"></path>`;
    }
    flow += `<path d="M${pcx} ${cyOf("merge") - seg("merge")} V60" stroke="${LV.cFlow}" stroke-width="3.4" fill="none" marker-end="url(#lvArrow)" opacity=".85"></path>`;

    // 残差跳线
    const resX = px + panelW - 22;
    const residual = `
      <path d="M${resX} 690 V${cyOf("post_norm")}" stroke="${LV.cFlow}" stroke-width="1.6" stroke-dasharray="4 4" fill="none" opacity=".4"></path>
      <path d="M${resX} ${cyOf("mla")} V${cyOf("merge")}" stroke="${LV.cFlow}" stroke-width="1.6" stroke-dasharray="4 4" fill="none" opacity=".4"></path>
      <text class="lv-tiny" x="${resX + 4}" y="${(cyOf("post_norm") + cyOf("merge")) / 2}" opacity=".5">残差</text>`;

    const layerKind = isMoe ? "MoE TransformerLayer" : "Dense TransformerLayer";
    const subLine = isMoe
      ? `${LV.routedExperts} routed · top-${LV.topK} · ${LV.sharedExperts} shared · MLA`
      : `Dense FFN(SwiGLU 18432) · MLA · 前 3 层`;
    const hotNote = isMoe && hotExpert != null
      ? `<text class="lv-tiny" x="${pcx}" y="${railTop + 50}" text-anchor="middle" fill="${LV.cHot}" style="font-weight:800">layer ${expandedLayer}:router 98% token → E${hotExpert}(落在 EP rank 23,该卡 a2a 过载)</text>`
      : "";
    const panelBox = `
      <g data-lv-layer="${expandedLayer}">
        <rect x="${px}" y="${railTop - 8}" width="${panelW}" height="${railBot - railTop + 18}" rx="14"
          fill="color-mix(in srgb, var(--surface-1) 92%, transparent)" stroke="${LV.cFlow}" stroke-width="2.2"></rect>
        <text class="lv-title mono" x="${pcx}" y="${railTop + 12}" text-anchor="middle">L${expandedLayer} · ${layerKind}</text>
        <text class="lv-sub" x="${pcx}" y="${railTop + 32}" text-anchor="middle">${subLine}</text>
        ${hotNote}
        ${boxes}
        ${expertsGroup}
        ${a2aMesh}
        ${a2aNodes}
        ${a2aLabels}
        ${routeLines}
        ${residual}
        ${flow}
      </g>`;

    return `
      <svg viewBox="0 0 ${VW} ${VH}" role="img" aria-label="DeepSeek-V3.2 L${expandedLayer} MoE 层展开图">
        <defs>
          <marker id="lvArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="${LV.cFlow}"></path>
          </marker>
        </defs>
        <rect x="0" y="0" width="${VW}" height="${VH}" rx="12" fill="color-mix(in srgb, var(--surface-1) 40%, transparent)"></rect>
        <rect x="${moeX1}" y="52" width="${moeX2 - moeX1}" height="632" rx="6" fill="none" stroke="${LV.cRoute}" stroke-width="1.6" stroke-dasharray="7 6" opacity=".4"></rect>
        <text class="lv-tiny" x="${(moeX1 + moeX2) / 2}" y="46" text-anchor="middle" opacity=".7">MoE 层 L3–L60(前 3 层为 Dense)</text>
        ${guides}
        <g data-lv-object="input">
          <rect x="40" y="654" width="104" height="38" rx="6" fill="color-mix(in srgb, var(--surface-1) 80%, transparent)" stroke="currentColor" stroke-opacity=".28"></rect>
          <text class="lv-tiny" x="92" y="677" text-anchor="middle">hidden [S,7168]</text>
        </g>
        <g data-lv-object="output">
          <rect x="40" y="46" width="104" height="38" rx="6" fill="color-mix(in srgb, var(--surface-1) 80%, transparent)" stroke="currentColor" stroke-opacity=".28"></rect>
          <text class="lv-tiny" x="92" y="69" text-anchor="middle">hidden [S,7168]</text>
        </g>
        ${layerTicks.join("")}
        ${panelBox}
        <text class="lv-legend" x="150" y="712">自底(输入)向上(输出) · 格子亮度 ∝ token 量(仅 E${hotExpert} 亮=98%,其余 255≈0)· 蓝环=all-to-all 的 8 个参与 rank · 红=rank 收到数据/rank 23 死锁 · 虚线=残差 / shared 旁路</text>
      </svg>`;
  }

  // top-8 专家 all-to-all 动画(一个循环):
  //   ① dispatch(0~2600):8 条 mesh 陆续生长(专家互发 token),1600~2200 间 8 个 rank 依次「变红」(收到数据);
  //   ② combine(2600~5800):7 个非 rank23 专家依次输出完成 → 红色淡出恢复原色,rank 23 始终保持红(send=0,死锁);
  //   ③ 收尾(5800~6800):rank 23 红色淡出、mesh 淡出,回到起点循环。
  // 单个 rAF 句柄(全页仅一个展开图),重画前先取消,避免泄漏。
  let lvAnimRaf = null;
  function startLayerA2A(host) {
    if (lvAnimRaf) { cancelAnimationFrame(lvAnimRaf); lvAnimRaf = null; }
    const mesh = Array.from(host.querySelectorAll(".lv-a2a-mesh"));
    const nodes = Array.from(host.querySelectorAll(".lv-a2a-node"));
    if (!mesh.length && !nodes.length) return;
    const labelDisp = host.querySelector('.lv-a2a-label[data-phase="disp"]');
    const labelComb = host.querySelector('.lv-a2a-label[data-phase="comb"]');
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { // 静态终态:mesh/rank23 红由 CSS 处理,这里只固定标签
      if (labelDisp) labelDisp.style.opacity = "1";
      if (labelComb) labelComb.style.opacity = "0";
      return;
    }
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const M = mesh.length, meshWin = 1500, meshDur = 520;
    const nonHot = nodes.filter((n) => n.dataset.hot !== "1");
    const T = 6800;
    let t0 = null;
    const frame = (now) => {
      if (t0 == null) t0 = now;
      const t = (now - t0) % T;

      // ① mesh 描边生长(dispatch 阶段),combine 阶段保持淡蓝,收尾淡出
      mesh.forEach((el, i) => {
        const len = parseFloat(el.dataset.len) || 10;
        const start = (i / Math.max(1, M)) * meshWin;
        if (t < start) { el.style.strokeDashoffset = len; el.style.opacity = 0; return; }
        const p = clamp01((t - start) / meshDur);
        el.style.strokeDashoffset = len * (1 - p);
        el.style.opacity = t < 2400 ? 0.55 * Math.min(p * 1.5, 1)
          : t < 6000 ? 0.2
          : 0.2 * (1 - clamp01((t - 6000) / 800));
      });

      // ② 节点红色状态层
      nodes.forEach((el) => {
        const hot = el.dataset.hot === "1";
        let op = 0;
        if (t < 1600) op = 0;                                   // dispatch 在途,尚未收到
        else if (t < 2600) op = clamp01((t - 1600) / 600) * 0.8; // 8 个 rank 一起变红(收到)
        else if (t < 5800) {                                    // combine
          op = 0.8;
          if (!hot) {
            const k = nonHot.indexOf(el);                       // 7 个非 rank23 依次淡出
            const s = 2700 + k * ((5600 - 2700) / Math.max(1, nonHot.length));
            op = 0.8 * (1 - clamp01((t - s) / 520));
          }
        } else {                                                // 收尾:仅 rank 23 仍红,再淡出复位
          op = hot ? 0.8 * (1 - clamp01((t - 6000) / 800)) : 0;
        }
        el.style.opacity = op;
      });

      if (labelDisp) labelDisp.style.opacity = t < 2600 ? "1" : "0.15";
      if (labelComb) labelComb.style.opacity = t >= 2600 ? "1" : "0.15";
      lvAnimRaf = requestAnimationFrame(frame);
    };
    lvAnimRaf = requestAnimationFrame(frame);
  }

  // 最大化:给 .twin-layerview 加 is-maximized(CSS 变 position:fixed 铺满) + 一层背板;
  // 动画仍跑在同一个 host 上(只是 CSS 放大),无需重建。Esc / 点背板 / 再点按钮都可还原。
  const LV_MAX_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  const LV_MIN_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h3a2 2 0 0 0 2-2V4M20 9h-3a2 2 0 0 1-2-2V4M4 15h3a2 2 0 0 1 2 2v3M20 15h-3a2 2 0 0 0-2 2v3"/></svg>';
  let lvEscHandler = null;
  function setLayerMax(host, on) {
    let backdrop = document.getElementById("lvMaxBackdrop");
    if (on && !backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "lvMaxBackdrop";
      backdrop.className = "twin-layerview-backdrop";
      backdrop.addEventListener("click", () => setLayerMax(host, false));
      document.body.appendChild(backdrop);
    }
    if (backdrop) backdrop.hidden = !on;
    host.classList.toggle("is-maximized", on);
    if (on && !lvEscHandler) {
      lvEscHandler = (e) => { if (e.key === "Escape") setLayerMax(host, false); };
      document.addEventListener("keydown", lvEscHandler);
    } else if (!on && lvEscHandler) {
      document.removeEventListener("keydown", lvEscHandler);
      lvEscHandler = null;
    }
    const btn = host.querySelector(".twin-layerview-max");
    if (btn) {
      btn.setAttribute("aria-label", on ? "还原" : "最大化");
      btn.title = on ? "还原" : "最大化";
      btn.innerHTML = on ? LV_MIN_ICON : LV_MAX_ICON;
    }
  }
  function closeLayerMax() {
    document.querySelectorAll(".twin-layerview.is-maximized").forEach((h) => setLayerMax(h, false));
  }

  function renderTwinLayerViews() {
    if (lvAnimRaf) { cancelAnimationFrame(lvAnimRaf); lvAnimRaf = null; } // 切换案例/重画前先停掉旧动画
    document.querySelectorAll("[data-layer-view]").forEach((host) => {
      const draw = () => {
        const expanded = Number(host.dataset.lvExpanded ?? 38);
        const hot = host.dataset.lvHotExpert != null ? Number(host.dataset.lvHotExpert) : null;
        host.innerHTML = lvBuildSvg(expanded, hot);
        host.querySelectorAll("[data-lv-layer]").forEach((g) => {
          g.addEventListener("click", () => {
            host.dataset.lvExpanded = g.dataset.lvLayer;
            draw();
          });
        });
        // 最大化按钮:innerHTML 每次重画会清掉,故每次 draw 后重建,并保持当前最大化态图标
        const on = host.classList.contains("is-maximized");
        const btn = document.createElement("button");
        btn.className = "twin-layerview-max";
        btn.type = "button";
        btn.setAttribute("aria-label", on ? "还原" : "最大化");
        btn.title = on ? "还原" : "最大化";
        btn.innerHTML = on ? LV_MIN_ICON : LV_MAX_ICON;
        btn.addEventListener("click", () => setLayerMax(host, !host.classList.contains("is-maximized")));
        host.appendChild(btn);
        startLayerA2A(host);
      };
      draw();
    });
  }

  // ── 模型层展开图搬到整网图区域展示 ───────────────────────────────────────
  // 定位链「模型层」不再内嵌大图,改为一个「查看」按钮;点击后在整网图区域(#modelLayerStage)
  // 覆盖展示 MoE 层展开图,并配一段转场:整网图对准 MoE(router)节点放大淡出,展开图从该处
  // 放大淡入,左右层列由中心向两侧逐渐出现,让「整网图 → 模型层展开图」两图有连续观感。
  const LV_INCIDENT_LAYER = 30, LV_INCIDENT_EXPERT = 47;
  let modelLayerOpen = false;
  let lvZoom = 1;                 // 展开图缩放倍率(整网图顶栏 +/-/Fit 控制)
  let lvCurrent = null;          // 当前展开图的 { expanded, hot },用于染色切换后按原层重绘

  // 把当前缩放倍率作用到展开图 SVG(每次重绘会新建 svg,故重绘后需重新施加)
  function lvApplyZoom() {
    const svg = document.querySelector("#modelLayerStage .twin-layerview svg");
    if (!svg) return;
    svg.style.transformOrigin = "center center";
    svg.style.transform = `scale(${lvZoom})`;
  }
  function lvZoomBy(factor) {
    lvZoom = Math.min(4, Math.max(0.4, lvZoom * factor));
    lvApplyZoom();
  }
  function lvZoomReset() { lvZoom = 1; lvApplyZoom(); }

  function drawCenterLayerView(host, expanded, hot, stagger) {
    lvCurrent = { expanded, hot };
    host.innerHTML = lvBuildSvg(expanded, hot);
    // lvBuildSvg 的固定 viewBox(0 0 1180 720)装不下全部内容——展开面板里 all-to-all 说明等
    // 长文字会画到 viewBox 右侧之外,导致右侧溢出、层图显示不全。这里改成量出「所有内容的真实
    // 包围盒」(含溢出文字),把 viewBox 设成该包围盒。配合 CSS 的 width/height:100% + meet,
    // 浏览器会自动按当前显示区/分辨率整体缩放并居中,窗口缩放时也始终显示全,无需手动监听。
    const svg = host.querySelector("svg");
    if (svg) {
      const fit = () => {
        try {
          const bb = svg.getBBox(); // 所有子元素的真实几何范围(不受 CSS 变换影响)
          if (bb.width > 0 && bb.height > 0) {
            const pad = 14;
            svg.setAttribute("viewBox", `${(bb.x - pad).toFixed(1)} ${(bb.y - pad).toFixed(1)} ${(bb.width + pad * 2).toFixed(1)} ${(bb.height + pad * 2).toFixed(1)}`);
            svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
          }
        } catch (e) { /* 未布局时忽略,下一帧再试 */ }
      };
      fit();
      requestAnimationFrame(fit); // 首帧若尚未布局,下一帧再量一次,确保 viewBox 覆盖全部内容
    }
    host.querySelectorAll("[data-lv-layer]").forEach((g) => {
      const layer = Number(g.dataset.lvLayer);
      if (layer === expanded) return;
      // 点击层列:切换展开层(命中事故层则带上倾斜 expert 高亮)
      g.addEventListener("click", () => {
        drawCenterLayerView(host, layer, layer === LV_INCIDENT_LAYER ? LV_INCIDENT_EXPERT : null, false);
      });
      if (stagger) {
        const dist = Math.abs(layer - expanded);
        g.style.animation = `twinLayerTickIn .5s ease ${100 + dist * 20}ms both`;
      }
    });
    startLayerA2A(host);
    lvApplyZoom(); // 重绘会新建 svg,重新施加当前缩放倍率
  }

  function openModelLayerView(expanded, hot) {
    const stageWrap = document.querySelector(".twin-architecture-stage");
    const overlay = $("modelLayerStage");
    const graph = $("modelGraphStage");
    if (!stageWrap || !overlay) return;
    modelLayerOpen = true;
    lvZoom = 1; // 每次进入按 Fit 起始
    // 进入展开图时,整网图顶栏的「算子染色」开关改为控制展开图;染色模式初始沿用整网图当前模式
    lvColorMode = window._opColorMode === "off" ? "off" : "cat";
    syncColorSegButtons(lvColorMode);

    // 缩放焦点对准整网图里的 MoE(router)节点,让「放大」像钻进 MoE
    const routerNode = graph?.querySelector('[data-node-id="router"]');
    if (routerNode && graph) {
      const gb = graph.getBoundingClientRect();
      const nb = routerNode.getBoundingClientRect();
      if (gb.width > 0 && gb.height > 0) {
        graph.style.setProperty("--twin-zoom-ox", (((nb.left + nb.width / 2 - gb.left) / gb.width) * 100).toFixed(1) + "%");
        graph.style.setProperty("--twin-zoom-oy", (((nb.top + nb.height / 2 - gb.top) / gb.height) * 100).toFixed(1) + "%");
      }
    }

    overlay.innerHTML = "";
    const host = document.createElement("div");
    host.className = "twin-layerview";
    overlay.appendChild(host);
    const back = document.createElement("button");
    back.type = "button";
    back.className = "twin-layer-stage-back";
    back.textContent = "← 返回整网图";
    back.addEventListener("click", closeModelLayerView);
    overlay.appendChild(back);

    overlay.hidden = false;
    overlay.classList.remove("is-leaving");
    // 下一帧再加过渡类,保证从初始态开始动画
    requestAnimationFrame(() => {
      stageWrap.classList.add("is-layer-active");
      overlay.classList.add("is-entering");
    });
    drawCenterLayerView(host, expanded, hot, true);
    syncLayerViewCTALabel();
  }

  function closeModelLayerView() {
    if (!modelLayerOpen) return;
    modelLayerOpen = false;
    if (lvAnimRaf) { cancelAnimationFrame(lvAnimRaf); lvAnimRaf = null; }
    const stageWrap = document.querySelector(".twin-architecture-stage");
    const overlay = $("modelLayerStage");
    stageWrap?.classList.remove("is-layer-active"); // 整网图缩放/淡出还原
    if (overlay) {
      overlay.classList.remove("is-entering");
      overlay.classList.add("is-leaving");
      setTimeout(() => {
        overlay.hidden = true;
        overlay.innerHTML = "";
        overlay.classList.remove("is-leaving");
      }, 400);
    }
    // 退出展开图:顶栏「算子染色」开关交还整网图,按钮高亮复位到整网图的染色模式
    syncColorSegButtons(window._opColorMode === "off" ? "off" : "cat");
    syncLayerViewCTALabel();
  }

  // 顶栏「算子染色」分段按钮的高亮状态同步到指定模式(展开图与整网图共用这套按钮)
  function syncColorSegButtons(mode) {
    document.querySelectorAll("#opColorSeg .segbtn").forEach((b) => {
      b.classList.toggle("on", b.dataset.c === mode);
    });
  }

  // 展开图打开时,拦截整网图顶栏的缩放 / 算子染色点击,改为控制展开图(捕获阶段在祖先上拦截,
  // 阻止事件到达按钮自身的 opv 引擎处理器 / 内联 onclick)。层级下拉在展开图下由 CSS 隐藏,不再处理。
  function bindLayerViewTopbar() {
    const host = document.getElementById("opvHost");
    if (!host) return;
    host.addEventListener("click", (e) => {
      if (!modelLayerOpen) return;
      const zin = e.target.closest("#zoomIn");
      const zout = e.target.closest("#zoomOut");
      const zfit = e.target.closest("#zoomReset");
      const cbtn = e.target.closest("#opColorSeg .segbtn");
      if (!zin && !zout && !zfit && !cbtn) return;
      e.stopPropagation();
      e.preventDefault();
      if (zin) lvZoomBy(1.14);
      else if (zout) lvZoomBy(0.88);
      else if (zfit) lvZoomReset();
      else if (cbtn) {
        lvColorMode = cbtn.dataset.c === "off" ? "off" : "cat";
        syncColorSegButtons(lvColorMode);
        const view = document.querySelector("#modelLayerStage .twin-layerview");
        if (view && lvCurrent) drawCenterLayerView(view, lvCurrent.expanded, lvCurrent.hot, false);
      }
    }, true); // 捕获阶段
  }

  // 定位链「模型层」的 CTA 按钮文案随展开图开合切换:展开图打开时显示「关闭」,收起时显示「查看」
  function syncLayerViewCTALabel() {
    document.querySelectorAll(".twin-layerview-cta-btn").forEach((btn) => {
      btn.textContent = modelLayerOpen ? "关闭" : "查看";
    });
    document.querySelectorAll("[data-open-layer-view]").forEach((el) => {
      el.classList.toggle("is-open", modelLayerOpen);
    });
  }

  // 点击整网图上问题一的红框(MoE FFN 分组框)时调用:选中问题一并进入模型层展开图
  function enterProblemOneLayerView() {
    const card = document.querySelector('.diagnosis-card[data-diagnosis="moe-a2a"]');
    if (!card) return;
    if (!card.classList.contains("is-selected")) {
      toggleDiagnosisCard(card); // 选中问题一 → 渲染定位链 → bindLayerViewCTA
    }
    if (!modelLayerOpen) openModelLayerView(LV_INCIDENT_LAYER, LV_INCIDENT_EXPERT);
  }

  function bindLayerViewCTA() {
    document.querySelectorAll("[data-open-layer-view]").forEach((el) => {
      const toggle = () => {
        if (modelLayerOpen) {
          closeModelLayerView();
        } else {
          openModelLayerView(
            Number(el.dataset.lvExpanded ?? LV_INCIDENT_LAYER),
            el.dataset.lvHotExpert != null ? Number(el.dataset.lvHotExpert) : null
          );
        }
      };
      el.addEventListener("click", toggle);
      el.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        toggle();
      });
    });
    syncLayerViewCTALabel();
  }

  // ── 问题六 Canvas 图表渲染 ──
  function dprCase6(canvas, cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W: cssW, H: cssH };
  }

  function renderCase6ModelBar() {
    const canvas = document.getElementById('case6ModelBarCanvas');
    if (!canvas) return;
    const cssW = canvas.parentElement.clientWidth;
    const r = dprCase6(canvas, cssW, 200);
    const { ctx, W, H } = r;
    const P = { t: 20, r: 14, b: 28, l: 36 }, pw = W - P.l - P.r, ph = H - P.t - P.b;
    const n = 61, barW = Math.max(2, (pw / n) * 0.68), gap = pw / n;
    const maxV = 7;
    const yOf = (v) => P.t + ph - (v / maxV) * ph;

    const d28 = Array.from({ length: n }, (_, i) => { const b = 0.25 + (i / n) * 1.6; return b + (Math.random() - 0.5) * 0.4; });
    const d32 = d28.map((v, i) => { if (i === 46) return 6.2; if (i === 54) return 3.8; if (i >= 44 && i <= 48) return v * (1 + (i - 44) * 2); return v * (1 + Math.random() * 0.25); });

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) { const y = P.t + (ph / 4) * i; ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.fillStyle = '#888'; ctx.font = '9px system-ui'; ctx.textAlign = 'right'; ctx.fillText((maxV * (1 - i / 4)).toFixed(1) + '%', P.l - 5, y + 4); }
    ctx.fillStyle = '#888'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
    [0, 15, 30, 46, 60].forEach(i => ctx.fillText('L' + (i + 1), P.l + (i / n) * pw, H - 6));

    for (let i = 0; i < n; i++) {
      const x = P.l + i * gap + (gap - barW) / 2;
      ctx.fillStyle = 'rgba(59,130,246,0.55)'; ctx.fillRect(x, yOf(d28[i]), barW, P.t + ph - yOf(d28[i]));
      ctx.fillStyle = i === 46 ? '#dc2626' : 'rgba(220,38,38,0.5)'; ctx.fillRect(x + barW * 0.3, yOf(d32[i]), barW * 0.7, P.t + ph - yOf(d32[i]));
    }
    const l47x = P.l + 46 * gap + gap / 2;
    ctx.fillStyle = '#dc2626'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('L47 · 震中', l47x, yOf(d32[46]) - 7);
    ctx.setLineDash([2, 2]); ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(l47x, yOf(d32[46]) - 2); ctx.lineTo(l47x, P.t - 2); ctx.stroke(); ctx.setLineDash([]);
  }

  function renderCase6OpWaterfall() {
    const canvas = document.getElementById('case6OpWaterfallCanvas');
    if (!canvas) return;
    const r = dprCase6(canvas, canvas.parentElement.clientWidth, 140);
    const { ctx, W, H } = r;
    const P = { t: 16, r: 14, b: 42, l: 44 }, pw = W - P.l - P.r, ph = H - P.t - P.b;
    const labels = ['LN', 'q_lora', 'kv_lora', 'q_nope', 'q_rope', 'attn', 'o_proj', 'gate', 'up', 'SiLU', 'down'];
    const vals = [-7.5, -6.2, -6.1, -2.4, -2.3, -0.8, -0.75, -0.14, -0.2, -0.25, -0.3];
    const colors = vals.map(v => v > -3 ? '#dc2626' : v > -6 ? '#ea580c' : '#3b82f6');
    const minV = -8, maxV = 0;
    const yOf = (v) => P.t + ph - ((v - minV) / (maxV - minV)) * ph;

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) { const y = P.t + (ph / 4) * i; ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.fillStyle = '#888'; ctx.font = '9px system-ui'; ctx.textAlign = 'right'; ctx.fillText(String(minV + (maxV - minV) * (1 - i / 4)), P.l - 5, y + 4); }
    const n = vals.length, barGap = pw / n, barW = barGap * 0.62;
    vals.forEach((v, i) => {
      const x = P.l + i * barGap + (barGap - barW) / 2, h = P.t + ph - yOf(v);
      ctx.fillStyle = colors[i]; ctx.fillRect(x, yOf(v), barW, h);
      if (i === 3 || i === 5 || i === 7) { ctx.fillStyle = '#dc2626'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center'; ctx.fillText('⬆' + (i === 3 ? '20000×' : i === 5 ? '40×' : '4×'), x + barW / 2, yOf(v) - 3); }
      ctx.save(); ctx.fillStyle = '#666'; ctx.font = '8px system-ui'; ctx.textAlign = 'right'; ctx.translate(x + barW / 2, H - 8); ctx.rotate(-0.45); ctx.fillText(labels[i], 0, 0); ctx.restore();
    });
  }

  function renderCase6Dist(canvasId, clipRight) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const r = dprCase6(canvas, canvas.parentElement.clientWidth, 100);
    const { ctx, W, H } = r;
    const P = { t: 6, r: 6, b: 18, l: 28 }, pw = W - P.l - P.r, ph = H - P.t - P.b;
    const nBins = 36;
    const bf16 = Array.from({ length: nBins }, (_, i) => { const x = (i - nBins / 2) / (nBins / 6); return Math.exp(-x * x / 2) * (0.6 + Math.random() * 0.3); });
    const fp8 = bf16.map((v, i) => { if (i >= nBins * 0.84) return v * 0.35 + 0.07; if (i <= nBins * 0.16) return v * 0.35 + 0.04; return v * 1.1; });
    const maxY = Math.max(...bf16, ...fp8) * 1.2;
    const yOf = (v) => P.t + ph - (v / maxY) * ph;
    const barW = (pw / nBins) * 0.82, gap = pw / nBins;

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
    [0, 0.5, 1].forEach(f => { const y = P.t + ph * (1 - f); ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); });
    bf16.forEach((v, i) => { const x = P.l + i * gap + (gap - barW) / 2; ctx.fillStyle = 'rgba(59,130,246,0.45)'; ctx.fillRect(x, yOf(v), barW, P.t + ph - yOf(v)); });
    fp8.forEach((v, i) => { const x = P.l + i * gap + (gap - barW) / 2 + barW * 0.3; ctx.fillStyle = 'rgba(220,38,38,0.4)'; ctx.fillRect(x, yOf(v), barW * 0.7, P.t + ph - yOf(v)); });
    if (clipRight) { const cx = P.l + pw * 0.84; ctx.fillStyle = '#dc2626'; ctx.font = 'bold 7px system-ui'; ctx.textAlign = 'center'; ctx.fillText('clip@448', cx, P.t - 1); ctx.setLineDash([2, 2]); ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(cx, P.t + 1); ctx.lineTo(cx, P.t + ph); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = '#3b82f6'; ctx.fillRect(W - 58, 3, 7, 7); ctx.fillStyle = '#888'; ctx.font = '7px system-ui'; ctx.textAlign = 'left'; ctx.fillText('BF16', W - 48, 9);
    ctx.fillStyle = '#dc2626'; ctx.fillRect(W - 28, 3, 7, 7); ctx.fillText('FP8', W - 18, 9);
  }

  function renderCase6MseCurve() {
    const canvas = document.getElementById('case6MseCurveCanvas');
    if (!canvas) return;
    const r = dprCase6(canvas, canvas.parentElement.clientWidth, 170);
    const { ctx, W, H } = r;
    const P = { t: 15, r: 14, b: 24, l: 42 }, pw = W - P.l - P.r, ph = H - P.t - P.b;
    const n = 61;
    const mse = Array.from({ length: n }, (_, i) => { if (i < 35) return -6.5 + (i / 35) * 1.2 + (Math.random() - 0.5) * 0.3; if (i < 46) return -5.3 + (i - 35) / 11 * 2.8 + (Math.random() - 0.5) * 0.3; if (i === 46) return -0.64; if (i < 55) return -0.64 + (i - 46) * 0.03 + (Math.random() - 0.5) * 0.08; return -0.4 + (i - 55) / 6 * 0.9 + (Math.random() - 0.5) * 0.1; });
    const minV = -7, maxV = 1;
    const xOf = (i) => P.l + (i / (n - 1)) * pw, yOf = (v) => P.t + ph - ((v - minV) / (maxV - minV)) * ph;

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) { const y = P.t + (ph / 4) * i; ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.fillStyle = '#888'; ctx.font = '9px system-ui'; ctx.textAlign = 'right'; ctx.fillText('1e' + Math.round(minV + (maxV - minV) * (1 - i / 4)), P.l - 5, y + 4); }
    ctx.fillStyle = '#888'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; [0, 15, 30, 46, 60].forEach(i => ctx.fillText('L' + (i + 1), xOf(i), H - 6));

    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.beginPath();
    mse.forEach((v, i) => { const x = xOf(i), y = yOf(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke(); ctx.lineTo(xOf(n - 1), P.t + ph); ctx.lineTo(P.l, P.t + ph); ctx.closePath(); ctx.fillStyle = 'rgba(59,130,246,0.07)'; ctx.fill();

    const l47x = xOf(46), l47y = yOf(mse[46]);
    ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.arc(l47x, l47y, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#dc2626'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('L47 · 拐点', l47x, l47y - 9); ctx.fillText('460×', l47x, l47y + 14);
    ctx.setLineDash([2, 2]); ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(l47x, l47y + 5); ctx.lineTo(l47x, P.t + ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(234,88,12,0.07)'; ctx.fillRect(xOf(35), P.t, xOf(46) - xOf(35), ph);
  }

  function renderCase6ScaleDecay() {
    const canvas = document.getElementById('case6ScaleDecayCanvas');
    if (!canvas) return;
    const r = dprCase6(canvas, canvas.parentElement.clientWidth, 130);
    const { ctx, W, H } = r;
    const P = { t: 14, r: 14, b: 24, l: 42 }, pw = W - P.l - P.r, ph = H - P.t - P.b;
    const n = 51;
    const xOf = (i) => P.l + (i / (n - 1)) * pw, yOf = (v) => P.t + ph - (v / 0.7) * ph;
    const scale = Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return 0.62 - t * 0.44 + (Math.random() - 0.5) * 0.015; });

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) { const y = P.t + (ph / 4) * i; ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.fillStyle = '#888'; ctx.font = '9px system-ui'; ctx.textAlign = 'right'; ctx.fillText((0.7 * (1 - i / 4)).toFixed(2), P.l - 5, y + 4); }
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 1; const thY = yOf(0.3); ctx.beginPath(); ctx.moveTo(P.l, thY); ctx.lineTo(W - P.r, thY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ea580c'; ctx.font = '9px system-ui'; ctx.textAlign = 'right'; ctx.fillText('危险线 0.3', P.l - 5, thY - 3);
    ctx.fillStyle = '#888'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; [0, 0.5, 1].forEach(f => ctx.fillText('step ' + Math.round(27000 + f * 5000), xOf(Math.round(f * (n - 1))), H - 6));

    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2; ctx.beginPath();
    scale.forEach((v, i) => { const x = xOf(i), y = yOf(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke(); ctx.lineTo(xOf(n - 1), P.t + ph); ctx.lineTo(P.l, P.t + ph); ctx.closePath(); ctx.fillStyle = 'rgba(220,38,38,0.06)'; ctx.fill();
    ctx.fillStyle = '#dc2626'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'left'; ctx.fillText('0.62', xOf(0) + 3, yOf(scale[0]) - 4); ctx.fillText('0.18', xOf(n - 1) - 42, yOf(scale[n - 1]) - 4);
  }

  function renderCase6MetricCharts() {
    if (!window.PtoTrainingMetricsChart) return;
    const TOTAL = 40000;
    const steps = Array.from({ length: TOTAL / 100 }, (_, i) => i * 100);

    // BF16 基线 loss：全程平稳下降
    const lossBf16 = steps.map((_, i) => {
      const s = i * 100;
      return 8.5 - (s / 40000) * 6.7 + (Math.random() - 0.5) * 0.08;
    });
    // HiF8 loss：step 0~25000 紧跟 BF16，之后分叉停滞
    const lossHif8 = steps.map((_, i) => {
      const s = i * 100;
      const base = lossBf16[i];
      if (s <= 25000) return base + (Math.random() - 0.5) * 0.08;          // 紧密跟随
      if (s <= 28000) return base + (s - 25000) / 3000 * 0.18 + (Math.random() - 0.5) * 0.04; // 开始分叉
      if (s <= 31000) return 2.1 + (s - 28000) / 3000 * 0.02 + (Math.random() - 0.5) * 0.03;  // 停滞
      return 2.12 + (s - 31000) / 9000 * 0.08 + (Math.random() - 0.5) * 0.04;                 // 微反弹
    });
    const gradnorm = steps.map((_, i) => {
      const s = i * 100;
      if (s <= 25000) return 11 + (Math.random() - 0.5) * 3;
      const decay = Math.max(0.3, 11 - (s - 25000) / 10000 * 10.7);
      return decay + (Math.random() - 0.5) * Math.max(0.1, decay * 0.15);
    });

    // 图例统一挂到卡片 head(与问题一迭代层一致),关掉引擎内置的底部图例;重画时先去重
    const mountCase6Legend = (el, series) => {
      const head = el.closest(".twin-locate-metric-card")?.querySelector(".twin-locate-metric-card__head");
      if (!head) return;
      head.querySelector(".twin-accuracy-legend")?.remove();
      head.appendChild(buildAccLegend(series));
    };

    // loss 双线图（HiF8 + BF16）
    const lossEl = document.querySelector('[data-locate-chart="case6-loss"]');
    if (lossEl) {
      const cw = Math.round(lossEl.getBoundingClientRect().width) || 600;
      const lossSeries = [
        { id: 'case6-loss-hif8', label: 'HiF8', key: 'case6-loss-hif8', colorVar: '--twin-chart-loss', emphasis: true, axis: 'left' },
        { id: 'case6-loss-bf16', label: 'BF16', key: 'case6-loss-bf16', colorVar: '--twin-chart-mfu', axis: 'left' },
      ];
      window.PtoTrainingMetricsChart.render(lossEl, {
        steps,
        smoothing: accSmoothing,
        legend: false,
        options: { compact: false, width: cw, height: 170, pad: { t: 10, r: 18, b: 22, l: 42 } },
        series: lossSeries,
        data: { 'case6-loss-hif8': lossHif8, 'case6-loss-bf16': lossBf16 },
        anomalies: [{ step: 25000, seriesId: 'case6-loss-hif8' }, { step: 31000, seriesId: 'case6-loss-hif8' }],
        interestWindow: { start: 24000, end: 35000 },
        cursor: 30000,
      });
      mountCase6Legend(lossEl, lossSeries);
    }

    // grad_norm 单线图（单序列,head 名已足够,不额外挂图例）
    const gnEl = document.querySelector('[data-locate-chart="case6-gradnorm"]');
    if (gnEl) {
      const cw = Math.round(gnEl.getBoundingClientRect().width) || 600;
      const d = { 'case6-gradnorm': gradnorm };
      window.PtoTrainingMetricsChart.render(gnEl, {
        steps,
        smoothing: accSmoothing,
        legend: false,
        options: { compact: false, width: cw, height: 170, pad: { t: 10, r: 14, b: 22, l: 42 } },
        series: [{ id: 'case6-gradnorm', label: 'grad_norm', key: 'case6-gradnorm', colorVar: '--twin-chart-gradnorm', axis: 'left' }],
        data: d,
        anomalies: [{ step: 25000, seriesId: 'case6-gradnorm' }],
        interestWindow: { start: 24000, end: 35000 },
        cursor: 30000,
      });
    }
  }

  function renderCase6AllCharts() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      renderCase6MetricCharts();
      renderCase6ModelBar();
      renderCase6OpWaterfall();
      renderCase6Dist('case6DistQnope', true);
      renderCase6Dist('case6DistAttn', true);
      renderCase6Dist('case6DistGate', true);
      renderCase6MseCurve();
      renderCase6ScaleDecay();
    }));
  }

  function showLocateChainPanel(caseKey) {
    const chain = locateChains[caseKey];
    if (!chain) return;
    closeModelLayerView(); // 切换问题时先收起可能残留的展开图
    // 先合并面板(切到头部栏布局),再渲染定位链——保证连线 SVG 按合并后的几何测量绘制
    $("twinWorkArea")?.classList.add("is-merged"); // 整网图列与定位链列合并为一块大面板
    renderLocateChain(caseKey);
    const marker = diagnosisMarkers.find((m) => m.key === caseKey);
    // 问题标题移到左侧「整网图」头部:模型名降为 kicker,问题名作为大标题;
    // 中间列头隐藏,让定位链栏直接吸顶到监控列顶部(对齐「组合 8」布局)
    const kicker = $("architectureKicker");
    if (kicker) {
      kicker.textContent = `${models[state.model].title} /`;
      kicker.hidden = false;
    }
    $("architectureTitle").textContent = marker ? `问题${marker.num}：${marker.label}` : chain.title;
    $("locateChainBack").hidden = false;
    const runTwinHeader = $("runTwinHeader");
    if (runTwinHeader) runTwinHeader.hidden = true;
    $("runTwinDefaultView").hidden = true;
    $("runTwinLocateView").hidden = false;
    $("runTwinLocateView").scrollTop = 0;
    mountLocateMetricCharts($("locateChainContent"));
    drawBufferChart();
    activeLocateCase = caseKey;
    syncLocateInfraHeat(caseKey); // infra 示意图复用外层集群热力图并叠加标记(随 tick 刷新)
    renderTwinLayerViews();
    bindLayerViewCTA();
    renderProblemOneTimeline();
    if (caseKey === "low-precision-training") renderCase6AllCharts();
    if (caseKey === "hif8-precision" || caseKey === "qproj-overflow") {
      window.PtoHif8Case7?.renderAll();
      // 问题二默认收起底部泳道图(ide-frame 底部 dock 开关,见 wzh_index.html 内联脚本)
      window.PtoTrainingTwinTimelineDock?.setVisible(false);
    }
    // 问题二(qproj-overflow / hif8-precision):把表搬到整网图位置并隐藏整网图;其余问题则复位
    applyHif8SidePanel(caseKey);
  }

  // 问题二(qproj-overflow / hif8-precision)专属:进入时隐藏整网图,把定位链「量化误差」
  // 节里的「层/算子级量化误差指标」表整卡搬到左侧整网图位置(表 DOM 原样搬运,排序/选层联动照旧)。
  // 传入非 qproj-overflow / hif8-precision 的 caseKey(或 null)则复位:清空搬运槽、恢复整网图。
  function applyHif8SidePanel(caseKey) {
    const centerPane = document.querySelector(".twin-center-pane");
    const centerScroll = document.querySelector(".twin-center-scroll");
    if (!centerPane || !centerScroll) return;
    let host = document.getElementById("hif8SideStage");
    if (host) { host.innerHTML = ""; host.hidden = true; } // 复位:清掉上次搬运的表
    centerPane.classList.remove("is-hif8-side-table");
    if (caseKey !== "hif8-precision" && caseKey !== "qproj-overflow") return;
    if (!host) {
      host = document.createElement("div");
      host.id = "hif8SideStage";
      host.className = "twin-hif8-side-stage";
      centerScroll.appendChild(host);
    }
    const card = document.getElementById("c7etable")?.closest(".h8-card");
    if (!card) return; // 表尚未渲染则跳过
    const grid = card.parentElement;
    if (grid) grid.style.gridTemplateColumns = "1fr"; // 源栅格收成单列(右侧只剩演化图+热力图)
    host.innerHTML = '<div class="hif8c7"></div>'; // 保留 .hif8c7 作用域,搬过去仍带 --h8-* 变量
    const wrap = host.firstElementChild;
    // 训练步回放 scrubber 一并从概览节搬到表上方(仍按 ID 绑定,拖动照旧驱动全部图表)
    const scrub = document.getElementById("c7play")?.closest(".h8-scrub");
    if (scrub) wrap.appendChild(scrub);
    wrap.appendChild(card);
    host.hidden = false;
    centerPane.classList.add("is-hif8-side-table");
  }

  // 「问题一」通信调度层的 Timeline (node2 GPU 7) 泳道图：自包含渲染,不再走 iframe。
  // 占位 div 由 renderLocateChain 从 locateChains 的 content 里插入(data-problem-one-timeline)。
  function renderProblemOneTimeline() {
    const host = document.querySelector("[data-problem-one-timeline]");
    // 底部 Timeline 面板已有全量泳道图,这里只保留异常相关的 r22/r23 两条泳道。
    if (host && window.PtoProblemOneTimeline) window.PtoProblemOneTimeline.render(host, { rankFilter: { from: 22, to: 23 } });
  }

  // 底部「Timeline」面板:就地渲染同一张自包含 1F1B 泳道图(复制自 op-rank-time.html
  // 的 Timeline/Swimlane 页签,不走 iframe)。始终常驻,进入问题一等诊断流程时保持不变。
  function renderTimelineDock() {
    const host = document.getElementById("twinTimelineBody");
    if (host && window.PtoProblemOneTimeline) window.PtoProblemOneTimeline.render(host);
  }

  function hideLocateChainPanel() {
    window.PtoHif8Case7?.stop(); // 关闭定位链时停掉 HiF8 案例的训练步回放,避免遗留 interval 空转
    applyHif8SidePanel(null);    // 复位:恢复整网图,清掉搬到左侧的量化误差表
    if (lvAnimRaf) { cancelAnimationFrame(lvAnimRaf); lvAnimRaf = null; } // 关闭定位链时停掉 all-to-all 动画
    closeModelLayerView(); // 收起在整网图区域展示的模型层展开图,还原整网图
    closeLayerMax(); // 若展开图正处于最大化,先还原,避免 fixed 层残留在关闭后的界面上
    locateChainObserver?.disconnect();
    locateChainObserver = null;
    _locateTrackArgs = null;
    activeLocateCase = null; // 停止把集群热力图镜像到已关闭的 infra 示意图
    clearInfraHeatHighlight();
    // 还原左侧「整网图」头部:隐藏 kicker,标题恢复为模型名;中间列头重新显示「训练监控」
    const kicker = $("architectureKicker");
    if (kicker) kicker.hidden = true;
    $("architectureTitle").textContent = models[state.model].title;
    $("locateChainBack").hidden = true;
    const runTwinHeader = $("runTwinHeader");
    if (runTwinHeader) runTwinHeader.hidden = false;
    $("twinWorkArea")?.classList.remove("is-merged"); // 还原为两块独立面板
    $("runTwinLocateView").hidden = true;
    $("runTwinDefaultView").hidden = false;
  }

  function toggleDiagnosisCard(card) {
    const key = card.dataset.diagnosis;
    const isActive = card.classList.contains("is-selected");
    document.querySelectorAll(".diagnosis-card").forEach((el) => el.classList.remove("is-selected"));
    if (isActive) {
      clearDiagnosisFocus();
      hideDiagnosisLocator();
      hideLocateChainPanel();
      return;
    }
    card.classList.add("is-selected");
    applyDiagnosisFocus(key);
    showLocateChainPanel(key);
  }

  function bindDiagnosisCards() {
    document.querySelectorAll(".diagnosis-card").forEach((card) => {
      card.addEventListener("click", () => toggleDiagnosisCard(card));
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleDiagnosisCard(card);
      });
    });
    $("locateChainBack")?.addEventListener("click", () => {
      document.querySelectorAll(".diagnosis-card").forEach((el) => el.classList.remove("is-selected"));
      clearDiagnosisFocus();
      hideDiagnosisLocator();
      hideLocateChainPanel();
    });
  }

  function bindControls() {
    document.querySelectorAll("[data-model-option]").forEach((button) => {
      button.addEventListener("click", () => applyModel(button.dataset.modelOption));
    });
    document.querySelectorAll("[data-task-option]").forEach((button) => {
      button.addEventListener("click", () => applyTask(button.dataset.taskOption));
    });
    document.querySelectorAll("[data-hardware-option]").forEach((button) => {
      button.addEventListener("click", () => applyHardware(button.dataset.hardwareOption));
    });
    $("themeToggle")?.addEventListener("click", toggleTheme);
    ["rTP", "rPP", "rMB", "rGA"].forEach((id) => {
      $(id)?.addEventListener("input", renderWhatIf);
    });
  }

  function bindDiagnosisMarkers() {
    const bubble = document.getElementById('diagnosisTooltip');
    const track = document.getElementById('progressTrack');
    if (!track || !bubble) return;

    const findMarker = (key) => diagnosisMarkers.find((m) => m.key === key);

    const showBubble = (e) => {
      const el = e.currentTarget;
      const key = el.dataset.markerKey;
      const m = findMarker(key);
      if (!m) return;
      const sevLabel = m.severity === 'p0' ? 'P0' : 'P1';
      const stepText = m.stepFrom != null
        ? `Step ${m.stepFrom.toLocaleString()} ~ ${m.stepTo.toLocaleString()}`
        : `Step ${m.step.toLocaleString()}`;
      bubble.innerHTML = `<strong style="color:${m.severity==='p0'?'#dc2626':'#ea580c'}">${sevLabel} ${m.category}</strong><br>${stepText}<br>问题${m.num}：${m.label}`;
      bubble.hidden = false;
      const rect = el.getBoundingClientRect();
      bubble.style.left = Math.max(6, rect.left + rect.width / 2 - 130) + 'px';
      bubble.style.top = (rect.bottom + 8) + 'px';
    };

    const hideBubble = () => { bubble.hidden = true; };

    const moveBubble = (e) => {
      if (bubble.hidden) return;
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      bubble.style.left = Math.max(6, rect.left + rect.width / 2 - 130) + 'px';
      bubble.style.top = (rect.bottom + 8) + 'px';
    };

    const handleClick = (e) => {
      const key = e.currentTarget.dataset.markerKey;
      const card = document.querySelector(`.diagnosis-card[data-diagnosis="${key}"]`);
      if (card) toggleDiagnosisCard(card);
    };

    // 事件委托在进度条上(问题点纵向线挂在 track 内)
    track.addEventListener('mouseenter', (e) => {
      const el = e.target.closest('.twin-progress-marker');
      if (el) showBubble({ currentTarget: el });
    }, true);
    track.addEventListener('mouseleave', (e) => {
      const el = e.target.closest('.twin-progress-marker');
      if (el) hideBubble();
    }, true);
    track.addEventListener('mousemove', (e) => {
      const el = e.target.closest('.twin-progress-marker');
      if (el) moveBubble({ currentTarget: el });
    }, true);
    track.addEventListener('click', (e) => {
      const el = e.target.closest('.twin-progress-marker');
      if (el) handleClick({ currentTarget: el });
    });
  }

  function boot() {
    bindControls();
    bindDiagnosisCards();
    bindDiagnosisMarkers();
    bindLayerViewTopbar();
    applyTheme(currentTheme, { skipRender: true });
    seedHistory();
    state.seen = models[state.model].target * 0.42;
    renderArchitecture();
    // 新整网图由 opv-modelviz 异步渲染,renderArchitecture 内已跳过旧图;
    // applyDefaultDiagnosisMarkers 内部自带重试等待 #graphStage SVG 就绪再画标记
    applyDefaultDiagnosisMarkers();
    $("hardwareSummary").textContent = `${hardwareProfiles[state.hardware].label}，每格为${hardwareProfiles[state.hardware].unit}。`;
    resetDevices();
    seedEvents();
    renderArtifacts();
    baseline.tokps = currentTokps();
    baseline.eta = (models[state.model].target - state.seen) / baseline.tokps;
    renderAll();
    initAccuracyCharts();
    initInfraCharts();
    renderTimelineDock();
    window.addEventListener("resize", () => {
      syncAccCards(false);
      syncInfraCards(false);
      syncLocateMetricCharts(false);
      if (!document.getElementById("runTwinLocateView").hidden) renderCase6AllCharts();
      if (_locateTrackArgs) drawLocateTrackLines(_locateTrackArgs.top, _locateTrackArgs.nodeCount, _locateTrackArgs.branchBeforeIndex, _locateTrackArgs.bypassList);
    });
    // 监控侧栏宽度改由 grid 的 minmax(420px, 0.4fr) 弹性伸缩(分辨率足够时占整网图列 40%),
    // 侧栏变宽不会触发 window resize,需单独观察侧栏尺寸变化重画图表,否则 SVG(height:auto)
    // 会按旧宽度的宽高比溢出固定高度的网格单元,底部被裁掉,看起来像"挤在容器上面"
    const monitorSidebar = document.querySelector(".twin-monitor-sidebar");
    if (monitorSidebar && "ResizeObserver" in window) {
      let sidebarSyncRaf = 0;
      const ro = new ResizeObserver(() => {
        if (sidebarSyncRaf) return;
        sidebarSyncRaf = requestAnimationFrame(() => {
          sidebarSyncRaf = 0;
          syncAccCards(false);
          syncInfraCards(false);
          syncLocateMetricCharts(false);
        });
      });
      ro.observe(monitorSidebar);
    }
    setInterval(tick, 120000); // 每 2 分钟推进一次 step,图表与进度条同步刷新,不再频繁闪动
  }

  boot();
})();

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
      title: "Pangu 2.0 flash 训练监控",
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
      gate_weight: evidenceItem(null, "parameter tensor", "mlp.w1 / gate_up", "Gate Weight 是 SwiGLU 门控分支（gate+up 合并）的参数输入。", [
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
        { id: "1", nodeId: "router",              diagnosisKey: "moe-a2a",                  label: "问题1：Router 数值溢出", sub: "FP8 softmax 溢出 → NaN + 死锁双发" },
        { id: "2", nodeId: "lm_head",             diagnosisKey: "perf-compute-bottleneck",  label: "问题2：lm_head 带宽瓶颈", sub: "vocab 151552 尾块非对齐 → cube_util 仅 49%" },
        { id: "3", nodeId: "query_tensor",        diagnosisKey: "qproj-overflow",           label: "问题3：q_proj FP8 溢出", sub: "layer 33 q_proj 输入 3.2% 超 FP8 E4M3 max(448)" },
        { id: "4", nodeId: "query_projection",    diagnosisKey: "low-precision-training",    label: "问题4：低精训练 loss 不收敛", sub: "FP8 深层数值退化 → layer 35 偏差起点 → 梯度消失" },
        { id: "5", nodeId: "routed_experts",      diagnosisKey: "nvlink",                   label: "问题5：NVLINK 链路掉线", sub: "node2 GPU3 lane5 inactive → MFU 骤降至 20%" },
      ],
    };
  }

  const hardwareProfiles = {
    single8: { label: "8 × Ascend 910B · 1 节点", devices: 64, world: 8, cols: 16, unit: "AI Core 槽位", unitHint: "单节点细粒度视图" },
    cluster64: { label: "64 × Ascend 910B · 8 节点", devices: 64, world: 64, cols: 16, unit: "NPU 卡槽", unitHint: "集群聚合视图" },
    cluster512: { label: "512 × Ascend NPU · 64 节点", devices: 512, world: 512, cols: 32, unit: "NPU 卡槽", unitHint: "集群聚合视图" },
    cluster2048: { label: "2048 × Ascend 910B · 256 节点", devices: 2048, world: 2048, cols: 64, unit: "910B NPU 卡槽", unitHint: "PP4×EP64×DP 集群视图" },
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
    // 「当前」step:需落在问题一(INCIDENT_STEP=15203)之后、问题五(nvlink, step 20000)之后,
    // 且与两者的差距要小于精度栏默认滚动窗口跨度(ACC_WINDOW×ACC_STRIDE=200×100=19900 步),
    // 否则两个事故都会滑出默认「精度」8 图的可视范围——之前误设成 48230(与 15203 相差 33027 步),
    // 导致 loss_scale/z_loss 等默认卡片在冷启动时看起来是一条平直线,见 js/training-log-drawer.js
    // 顶部注释同步说明。
    step: 21000,
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

  // 时光机「已训练时长」换算用：目标步耗时取自本页定位链案例(openPangu-2.0-Flash 稳态 T_iter 基线 ≤8.5s),
  // 比用 seen/tokps 反推(会被 target=3e12 tokens 的语料规模拉到几百天)更贴近一次训练的合理周期。
  const TIME_MACHINE_STEP_SECONDS = 8.5;

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

  function fmtDurationCN(seconds) {
    const safeSeconds = Math.max(0, Math.round(seconds));
    const days = Math.floor(safeSeconds / 86400);
    const hours = Math.floor((safeSeconds % 86400) / 3600);
    const mins = Math.floor((safeSeconds % 3600) / 60);
    if (days > 0) return `${days}天${hours}小时${mins}分`;
    if (hours > 0) return `${hours}小时${mins}分`;
    return `${mins}分`;
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
    // 之前这里固定把 devices[37]/[330] 的温度顶到阈值以上,导致集群监控热力图默认(未进入任何
    // 问题详情时)就常驻 2 个红框,且它们不对应任何一个诊断案例,讲故事时解释不清——已去掉,
    // 热力图默认保持健康态,红色只应在联动到具体事故(如 nvlink)时出现。
    if (state.devices[201]) state.devices[201].util = 0.58;
    renderHeatShell();
  }

  // EP64 列背景色：8 色调循环，区分 64 个 EP rank 所在列
  var EP_TINT_COLORS = [
    "rgba(59,130,246,0.06)", "rgba(16,185,129,0.06)", "rgba(245,158,11,0.06)", "rgba(139,92,246,0.06)",
    "rgba(6,182,212,0.06)", "rgba(239,68,68,0.06)", "rgba(34,197,94,0.06)", "rgba(168,85,247,0.06)"
  ];

  var DP_GROUP_COUNT = 8;
  var PP_STAGE_COUNT = 4;
  var EP_RANK_COUNT = 64;
  var EP_ROWS_PER_STAGE = 4;
  var EP_COLS_PER_STAGE = EP_RANK_COUNT / EP_ROWS_PER_STAGE;

  // 本页是演示 demo,集群热力图不需要"实时"——着色只在外壳重建后(初始加载/切硬件)
  // 算一次并冻结,之后 tick/时光机/renderAll 再调用 renderHeat() 都直接跳过,
  // 不再逐帧重写 2048 个格子的 class/style/tip(此前每次重绘要花数百毫秒)。
  var heatPainted = false;

  function renderHeatShell(heatEl) {
    const heat = heatEl || $("heat");
    if (!heatEl) heatPainted = false; // 只有主热力图(#heat)外壳重建才需要重新着色
    // Match config-relation-observer's rank address:
    // rank = stage * (DP * EP) + dp * EP + ep (TP=CP=1).
    var dpGroups = DP_GROUP_COUNT;
    var ranksPerStage = dpGroups * EP_RANK_COUNT;

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
      dpGroup.style.gridTemplateColumns = "repeat(" + PP_STAGE_COUNT + ", minmax(0, 1fr))";
      // Stage 块之间空出约一个 rank 格宽；块内 rank 仍保持紧凑的 2px 间距。
      dpGroup.style.gap = "6px";
      dpGroup.style.padding = "3px";
      dpGroup.style.borderRadius = "4px";
      dpGroup.style.border = "1.5px solid var(--border-default)";

      for (var ppStage = 0; ppStage < PP_STAGE_COUNT; ppStage++) {
        var stageBlock = document.createElement("div");
        stageBlock.className = "twin-heat-stage-block";
        stageBlock.style.display = "grid";
        stageBlock.style.gridTemplateColumns = "repeat(" + EP_COLS_PER_STAGE + ", minmax(0, 1fr))";
        stageBlock.style.gap = "2px";
        stageBlock.style.minWidth = "0";
        for (var epRank = 0; epRank < EP_RANK_COUNT; epRank++) {
          var index = ppStage * ranksPerStage + dp * EP_RANK_COUNT + epRank;
          var cell = document.createElement("div");
          // ep-tint-N 类携带底色(见 training-run-twin.css),避免给每个格子单独写内联 background
          cell.className = "twin-heat-cell ep-tint-" + (epRank % EP_TINT_COLORS.length);
          cell.dataset.index = String(index);
          cell.dataset.dp = String(dp);
          cell.dataset.epRank = String(epRank);
          cell.dataset.ppStage = String(ppStage);
          stageBlock.appendChild(cell);
        }
        dpGroup.appendChild(stageBlock);
      }
      heat.appendChild(dpGroup);
    }

    // EP 标签行：每列是一个 EP rank，只标 EP0, EP8, EP16, ... EP56
    var epLabelRow = document.createElement("div");
    epLabelRow.className = "twin-heat-ep-labels";
    epLabelRow.style.display = "grid";
    epLabelRow.style.gridTemplateColumns = "repeat(" + PP_STAGE_COUNT + ", minmax(0, 1fr))";
    epLabelRow.style.gap = "2px";
    epLabelRow.style.padding = "0 3px";
    for (var c = 0; c < PP_STAGE_COUNT; c++) {
      var el = document.createElement("span");
      el.textContent = "EP0-EP63 (4x16)";
      el.style.textAlign = "center";
      el.style.fontSize = "8px";
      el.style.fontWeight = "500";
      el.style.color = "var(--foreground-muted)";
      epLabelRow.appendChild(el);
    }
    heat.appendChild(epLabelRow);
  }

  function renderHeat() {
    if (heatPainted) return; // 已经着色过一次,固定着色,不再逐帧重绘 2048 个格子
    var profile = hardwareProfiles[state.hardware];
    var cellsByRank = new Map(Array.from($("heat").querySelectorAll(".twin-heat-cell"))
      .map(function (cell) { return [Number(cell.dataset.index), cell]; }));
    let peak = 0;
    let thermalRisk = 0;
    let lowUtil = 0;
    let total = 0;
    let totalUtil = 0;
    state.devices.forEach((device, index) => {
      var epRank = index % EP_RANK_COUNT;
      peak = Math.max(peak, device.temp);
      total += device.temp;
      totalUtil += device.util;
      if (device.temp > 82 || device.bad) thermalRisk += 1;
      if (device.util < 0.7) lowUtil += 1;
      const cell = cellsByRank.get(index);
      if (!cell) return;
      // 在 EP 底色之上叠加 util 着色（ep-tint-N 类保留 EP rank 列背景作为基底,
      // 避免像之前那样对每个格子重新解析一次内联 background 颜色字符串）
      cell.className = "twin-heat-cell ep-tint-" + (epRank % EP_TINT_COLORS.length);
      var utilOverlay = "";
      if (device.util < 0.7) utilOverlay = "var(--twin-util-low)";
      else if (device.util > 0.92) utilOverlay = "var(--twin-util-high)";
      else utilOverlay = "var(--twin-util-mid)";
      cell.style.boxShadow = "inset 0 0 0 2px " + utilOverlay;
      if (device.temp > 82 || device.bad) cell.classList.add("is-thermal-risk");
      if (device.bad) cell.classList.add("is-straggler");
      var ppStage = Math.floor(index / (DP_GROUP_COUNT * EP_RANK_COUNT));
      var dpGroup = Math.floor((index % (DP_GROUP_COUNT * EP_RANK_COUNT)) / EP_RANK_COUNT);
      const tip = [
        `${profile.unit} ${index}`,
        `node-${Math.floor(index / 8)} / rank-${index}`,
        `算力占用率 ${(device.util * 100).toFixed(0)}%`,
        `温度 ${device.temp.toFixed(0)}°C`,
        `HBM ${(device.mem * 100).toFixed(0)}%`,
        `DP${dpGroup} · Stage${ppStage} · EP${epRank}`,
        device.bad ? `风险 ${device.bad}` : "",
      ].filter(Boolean).join("\n");
      cell.dataset.tip = tip;
    });
    const avgUtil = totalUtil / state.devices.length;
    if ($("hwUtil")) {
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
    heatPainted = true;
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

  /* 窗口右边界永远是 state.step(实时态 = 最新 step,回放态 = 拖块所在 step)。
     回放到训练早期时 step 可能不够铺满 200×ACC_STRIDE 的窗口,此时按比例收窄步距,
     保证窗口左边界不越过 step 0(否则会算出负数 step 的"未来之前"数据)。 */
  function computeAccSteps() {
    const right = Math.max(0, state.step);
    const stride = right >= (ACC_WINDOW - 1) * ACC_STRIDE
      ? ACC_STRIDE
      : Math.max(1, Math.floor(right / (ACC_WINDOW - 1)));
    const regular = Array.from({ length: ACC_WINDOW }, (_, i) => Math.max(0, right - (ACC_WINDOW - 1 - i) * stride));
    const left = regular[0];
    // 常规监控每 100 step 采样一次，但 AMP scaler 在 15000~15203 内每 50 step 减半；
    // 把事故关键点补进共享时间轴，避免 65536→32768→16384→8192→4096 被抽稀成两次四倍跳变。
    const ampIncidentSteps = [15000, 15050, 15100, 15150, 15200, 15202, 15203];
    return [...new Set(regular.concat(ampIncidentSteps.filter((step) => step >= left && step <= right)))]
      .sort((a, b) => a - b);
  }
  let accSteps = computeAccSteps();

  /* 事故点 + 恢复窗口：step 15203 出现 NaN → AI 重跑定位 → 修复代码 → 恢复训练。
     INCIDENT_STEP 为固定的绝对 step；RECOVERY_STEPS 为恢复所需的步数。
     事故步本身显示 NaN/inf；恢复期内指标从异常值平滑过渡回正常趋势；
     恢复完成后继续朝好的方向发展（loss 降低、acc 升高等）。
     step 号与「问题一」案例文档(定位链-openPangu-2.0-Flash.md 案例一)保持一致。 */
  const INCIDENT_STEP = 15203;
  // 时光机手动拖动很难像点击「问题一」标记那样精确落在单个 step 上,
  // 故给 W_gate/EP All-to-All 两张卡的事故态判定留一点容差(见 applyViewStep 里的回调)。
  const INCIDENT_STEP_TOLERANCE = 300;
  const RECOVERY_STEPS = 15;
  const RECOVERY_END = INCIDENT_STEP + RECOVERY_STEPS;

  // 以绝对 step 为种子的确定性伪随机,保证同一 step 无论何时被计算、被哪张卡片引用,取值都一致
  function stepNoise(seed, step, amp) {
    const x = Math.sin(step * 12.9898 + seed * 78.233) * 43758.5453;
    return ((x - Math.floor(x)) * 2 - 1) * amp;
  }

  /* ══ 问题二(显存)数据源 ═══════════════════════════════════════════════════════
     定位链-openPangu-2.0-Flash.md 案例四「activation checkpoint 未开启导致显存峰值超标
     + 分配器碎片触发 OOM」。与问题一(step 15203)共处同一条 run 上,时间上在它之前:
       · step < 8000     显存平稳 52~55 GB —— 46 层激活全量常驻,尚未触顶
       · 8000 → 12003    逐步爬升至 64 GB(单卡 HBM 上限);分配器开始频繁碎片整理,
                         malloc 次数 25→180/step、分配 API 耗时 180→890ms、碎片率 18%→83%,
                         吞吐被换页与碎片整理拖累 3200→2800 tokens/s
       · step 12003      rank 17 报 ACL_ERROR_MEMORY_ALLOCATION,进程中断 → 无有效读数(NaN)
       · 12003 → 12027   开 selective activation checkpoint + expandable_segments 后重启,回落
       · > 12027         稳定在 ~34 GB(占容量 53%,安全线以下),分配开销/碎片率同步回落

     显存利用率(avg_mem)不再独立生成,改为由 mem_gb / MEM_CAPACITY_GB 派生 —— 保证 infra 栏
     「显存利用率」「显存占用」两张卡与「关键指标」vMem 读数三者恒定自洽,显存故事只有一个真相源。 */
  const MEM_INCIDENT_STEP = 12003;
  const MEM_CLIMB_FROM = 8000;
  const MEM_RECOVERY_STEPS = 24;
  const MEM_RECOVERY_END = MEM_INCIDENT_STEP + MEM_RECOVERY_STEPS;
  const MEM_CAPACITY_GB = 64;      // 单卡 HBM 总容量(910B1/B2/B3)
  const MEM_BASE_GB = 53.2;        // 爬升前的平稳段
  const MEM_PEAK_GB = 64.0;        // 触顶 = 容量本身
  const MEM_FIXED_GB = 34.2;       // 修复后的新稳态

  /* 返回「未叠加问题一事故效应」的原始显存读数;问题一的 NaN/恢复期回弹由 metricsAtStep 统一叠加,
     两个事故因此可以同时存在于一条曲线上而互不覆盖。 */
  function memoryAtStep(step) {
    if (step === MEM_INCIDENT_STEP) {
      return { mem_gb: NaN, alloc_api_ms: NaN, malloc_calls: NaN, frag_ratio: NaN, throughput: NaN };
    }
    if (step < MEM_INCIDENT_STEP) {
      // 爬升进度 0→1,平方缓入:前期几乎看不出来,临近事故步陡升 —— 与"激活值累积 + 碎片放大"一致
      const ramp = Math.pow(clamp((step - MEM_CLIMB_FROM) / (MEM_INCIDENT_STEP - MEM_CLIMB_FROM), 0, 1), 2);
      return {
        // 上限夹到容量本身:抖动不该把占用推到物理容量之上(触顶即 OOM,不存在 64.2/64 这种读数)
        mem_gb: Math.min(MEM_PEAK_GB, MEM_BASE_GB + (MEM_PEAK_GB - MEM_BASE_GB) * ramp + stepNoise(41, step, 0.45)),
        alloc_api_ms: 180 + 710 * ramp + stepNoise(42, step, 12),
        malloc_calls: 25 + 155 * ramp + stepNoise(43, step, 3),
        frag_ratio: 0.18 + 0.65 * ramp + stepNoise(44, step, 0.015),
        throughput: 3200 - 400 * ramp + stepNoise(45, step, 18),
      };
    }
    // 恢复期:进程重启,各项从 0 回升到修复后的新稳态;恢复完成后维持
    const rec = clamp((step - MEM_INCIDENT_STEP) / MEM_RECOVERY_STEPS, 0, 1);
    const ease = rec < 0.5 ? 2 * rec * rec : -1 + (4 - 2 * rec) * rec;
    return {
      mem_gb: MEM_FIXED_GB * ease + stepNoise(41, step, 0.3),
      alloc_api_ms: 150 * ease + stepNoise(42, step, 6),
      malloc_calls: 28 * ease + stepNoise(43, step, 2),
      frag_ratio: 0.22 * ease + stepNoise(44, step, 0.01),
      throughput: 3150 * ease + stepNoise(45, step, 15),
    };
  }

  /* 案例四里不随 step 变化的静态事实:显存峰值构成、PP stage / 层级分布、内存快照摘要。
     暂时只被聚光灯定位链的文案引用;后续「峰值构成堆叠图 / stage 热力图 / 碎片分布图」
     三个可视化组件直接读这里,不要各自再抄一份数字(经 window.PtoTrainingTwinMemoryCase 暴露)。
     数值口径 = 定位链-openPangu-2.0-Flash.md 案例四 §4/§5/§6。 */
  const MEM_CASE_FACTS = {
    incidentStep: MEM_INCIDENT_STEP,
    oomRank: 17,
    capacityGB: MEM_CAPACITY_GB,
    peakGB: MEM_PEAK_GB,
    fixedGB: MEM_FIXED_GB,
    // §4 峰值构成(step 12000 · rank 17 快照)
    // short:窄图里用的短名(如「峰值构成」的比例圆,圆下方只有一个圆的宽度可写字)
    composition: [
      { id: "activation", label: "激活值(含中间张量)", short: "激活值", gb: 36.2, pct: 0.566, reducible: true,
        note: "46 层 × seq 4096 全部常驻;开 selective checkpoint 后可压到 ~8.5 GB" },
      { id: "params", label: "模型参数(FP8)", short: "参数", gb: 8.1, pct: 0.127 },
      { id: "grads", label: "梯度(FP8)", short: "梯度", gb: 8.1, pct: 0.127 },
      { id: "optimizer", label: "优化器状态(BF16 m+v)", short: "优化器", gb: 10.8, pct: 0.169 },
      { id: "workspace", label: "临时 workspace buffer", short: "workspace", gb: 0.8, pct: 0.012 },
    ],
    // §2 瓶颈分类层:profiling 报告耗时构成
    timeBreakdown: { computingMs: 8520, communicationMs: 1420, allocApiMs: 890, allocApiPct: 0.074, allocApiHealthyPct: 0.02 },
    // §5 PP stage 显存分布([lo,hi] 为层号区间)
    stages: [
      { stage: 0, layers: [1, 11], activationGB: 8.8, stateGB: 7.1, totalGB: 15.9 },
      { stage: 1, layers: [12, 22], activationGB: 9.0, stateGB: 6.8, totalGB: 15.8 },
      { stage: 2, layers: [23, 33], activationGB: 9.0, stateGB: 6.8, totalGB: 15.8 },
      { stage: 3, layers: [34, 45], activationGB: 11.2, stateGB: 7.5, totalGB: 18.7, hot: true,
        note: "含 lm_head logits [4096,151552] ≈ 1.2 GB + final_norm/loss" },
    ],
    hotLayer: { layer: 38, kind: "MoE", activationGB: 1.2, denseBaselineGB: 0.7,
                reason: "expert dispatch buffer(256 expert × token 分配临时缓冲区)" },
    // §3 + §6 碎片
    /* maxRequestGB:单笔最大分配申请。定位链 §3「观测」原话:总空闲 1.8 GB、最大连续空闲块仅
       0.3 GB,"无法满足下一个 0.5 GB 的临时 buffer 分配请求"——0.3 GB 本身没有对错,
       是"最大申请 0.5 GB > 最大连续 0.3 GB"这层关系才成为故障判据,碎片图的红色标注按这个口径给。 */
    fragment: { totalFreeGB: 1.8, largestFreeBlockGB: 0.3, maxRequestGB: 0.5, unusableFreeGB: 1.5, ratio: 0.83,
                mallocPerStepBefore: 25, mallocPerStepAfter: 180, mallocP99MsBefore: 0.3, mallocP99MsAfter: 4.2,
                sampleBlock: { name: "L38 q_b_proj 输出中间张量", shape: "[4096, 9216] FP8", sizeMB: 36,
                               allocMs: 842, freeMs: 7832, holdMs: 6990,
                               stack: ["torch.npu.empty", "q_b_proj.forward", "SelfAttn.forward", "TransformerLayer.forward"] } },
    // §7 验证
    verify: { peakGB: [64, 34], allocApiMs: [890, 150], fragRatio: [0.83, 0.22], throughput: [3200, 3150] },
  };

  function metricsAtStep(step, t) {
    const targetLoss = state.loss, targetMfu = state.mfu;
    // 恢复进度：0 = 事故步，1 = 完全恢复
    const recRaw = (step - INCIDENT_STEP - 1) / (RECOVERY_STEPS - 1 || 1);
    const rec = step <= INCIDENT_STEP ? 0 : step >= RECOVERY_END ? 1 : Math.min(1, Math.max(0, recRaw));
    // ease-in-out 平滑过渡
    const ease = rec < 0.5 ? 2 * rec * rec : -1 + (4 - 2 * rec) * rec;
    const atIncident = step === INCIDENT_STEP;
    const inRecovery = step > INCIDENT_STEP && step < RECOVERY_END;

    // 收敛型时间重整:训练早期变化快、后期趋于平稳(真实训练里 loss 先快降后收敛,
    // acc/precision/recall/corr 先快升后趋稳),避免曲线呈直线。convUp 0→1 先快后慢,convDown 反之。
    const convUp = t >= 1 ? 1 : 1 - Math.pow(2, -5.5 * t);
    const convDown = 1 - convUp;

    // 事故步本身：loss NaN / grad_norm inf / 其余指标也 NaN（训练中断）
    // 恢复期：从异常值平滑过渡回正常趋势
    // 恢复后：继续正常训练，趋势朝好的方向发展
    const baseLoss = 3.08 + stepNoise(7, step, 0.06);
    const shockLoss = atIncident ? NaN : inRecovery ? (6.0 * (1 - ease) + baseLoss * ease) : baseLoss;
    const loss = atIncident ? NaN : +(shockLoss).toFixed(3);

    const baseGn = 12.0 + stepNoise(8, step, 0.9);
    const shockGn = atIncident ? Infinity : inRecovery ? (50.0 * (1 - ease) + baseGn * ease) : baseGn;
    const grad_norm = atIncident ? Infinity : +(shockGn).toFixed(2);

    // 权重差分 ‖ΔW‖(逐 step 参数更新幅度的 L2 范数):早期训练步长大、收敛后趋于平稳(convDown 项),
    // 与 grad_norm 同一根因(事故步梯度发散→ 优化器更新量同步炸至 inf),故事故/恢复处理与 grad_norm 一致。
    const baseWd = 0.42 + 0.25 * convDown + stepNoise(12, step, 0.03);
    const shockWd = atIncident ? Infinity : inRecovery ? (3.2 * (1 - ease) + baseWd * ease) : baseWd;
    const weight_diff = atIncident ? Infinity : +(shockWd).toFixed(4);

    const tlBase = Math.max(0.15, targetLoss * (1.0 + 0.7 * convDown) + stepNoise(1, step, 0.11));
    const tl = atIncident ? NaN : inRecovery ? (tlBase + 0.8 * (1 - ease)) : tlBase;
    // val 与 train 的差距(泛化 gap)随收敛逐步拉开 0.18→0.30，且 val 是 epoch 级评测、抖动比逐 step
    // 训练损失小(±0.03 vs ±0.11)。原来只高 0.05、抖动却有 ±0.06，两条线一直缠在一起、看着像只有一条。
    const vlBase = tlBase + 0.18 + 0.12 * convUp + stepNoise(2, step, 0.03);
    const vl = atIncident ? NaN : inRecovery ? (vlBase + 0.5 * (1 - ease)) : vlBase;

    const taBase = clamp(1 - tlBase / 6, 0.05, 0.99);
    const ta = atIncident ? NaN : inRecovery ? (taBase - 0.12 * (1 - ease)) : taBase;
    const vaBase = clamp(1 - vlBase / 6, 0.05, 0.99);
    const va = atIncident ? NaN : inRecovery ? (vaBase - 0.08 * (1 - ease)) : vaBase;

    // MFU：事故步进程死锁/超时崩溃，该 step 无有效算力读数，记 NaN（口径与 loss/grad_norm 一致，
    // 而非"测得 0%"）；恢复期进程重启后从低位回升，恢复后继续正常波动
    const mfBase = clamp(targetMfu * (0.72 + 0.28 * convUp) + stepNoise(3, step, 0.03), 0.05, 0.9);
    const mf = atIncident ? NaN : inRecovery ? (mfBase * ease) : mfBase;

    const pcBase = clamp(0.62 + 0.3 * convUp + stepNoise(4, step, 0.045), 0.05, 0.99);
    const pc = atIncident ? NaN : inRecovery ? (pcBase - 0.1 * (1 - ease)) : pcBase;
    const rcBase = clamp(0.58 + 0.32 * convUp + stepNoise(5, step, 0.05), 0.05, 0.99);
    const rc = atIncident ? NaN : inRecovery ? (rcBase - 0.1 * (1 - ease)) : rcBase;

    const crBase = clamp(0.7 + 0.28 * convUp + stepNoise(6, step, 0.045), -0.3, 0.999);
    const cr = atIncident ? NaN : inRecovery ? (crBase - 0.15 * (1 - ease)) : crBase;

    // F1 = precision、recall 的调和平均，随两者同步计算，事故/恢复处理与 precision、recall 一致
    const f1 = atIncident ? NaN : (pc + rc > 0 ? (2 * pc * rc) / (pc + rc) : 0);

    // 显存一族(占用 GB / 分配器开销 / 碎片率 / 吞吐)：基线由 memoryAtStep() 按「问题二·显存 OOM」
    // 的时间线给出(见其注释)，这里再叠加问题一的事故效应 —— 事故步进程死锁崩溃、无有效读数记 NaN，
    // 恢复期进程重启后从低位回升。两个事故因此共存于同一条曲线，互不覆盖。
    const memRaw = memoryAtStep(step);
    const shockMem = (v) => (atIncident ? NaN : inRecovery ? v * ease : v);
    const mem_gb = shockMem(memRaw.mem_gb);
    const alloc_api_ms = shockMem(memRaw.alloc_api_ms);
    const malloc_calls = shockMem(memRaw.malloc_calls);
    const frag_ratio = shockMem(memRaw.frag_ratio);
    const throughput = shockMem(memRaw.throughput);
    // HBM 显存利用率：不再独立生成，直接由 mem_gb / 单卡容量 派生，保证与「显存占用」卡恒定一致
    const avg_mem = mem_gb / MEM_CAPACITY_GB;

    // 单卡重跑同一 step(定位链.md 案例一 · 分叉判定):不经历多卡 all-to-all,不受事故影响,全程健康——
    // loss≈3.21、grad_norm≈11.8,用于和上面的多卡曲线对照,证明问题只在多卡复现。
    const loss_single = +(3.21 + stepNoise(9, step, 0.05)).toFixed(3);
    const grad_norm_single = +(11.8 + stepNoise(10, step, 0.7)).toFixed(2);

    // AMP 动态 loss scale(定位链.md 案例一 · 熔断/预警层):以 log2 存储而非原始值 65536~4096,
    // 让折线图按等距台阶下降(每次减半=同等严重度),真实数值由 formatValue 换算回 2^v 展示。
    // 衰减节点严格对齐案例一给出的 step 15000/15050/15100/15150/15200,事故步(15203)后
    // 熔断修复(router 改 FP32 + z-loss)生效,scaler 不再衰减,回落维持在 16(65536)。
    const lossScaleLog2 = (() => {
      if (step === INCIDENT_STEP) return NaN;
      if (step > INCIDENT_STEP) return 16;
      if (step >= 15200) return 12;
      if (step >= 15150) return 13;
      if (step >= 15100) return 14;
      if (step >= 15050) return 15;
      return 16;
    })();

    // z-loss(定位链.md 案例一 · 熔断/预警层 + 超参/代码层 ⑥):事故发生时训练里从未开启过
    // (根因之一),修复项②在 recovery 完成后加入 z_loss_coeff=1e-4——图上应看到一条从 0 开始、
    // 在事故修复后才出现的线,而不是从头就存在的指标。
    const zLossBase = step > INCIDENT_STEP ? 0.16 + stepNoise(33, step, 0.02) : 0;
    const z_loss = atIncident ? NaN : +zLossBase.toFixed(4);

    return {
      train_loss: +tl.toFixed(4), val_loss: +vl.toFixed(4),
      train_acc: +ta.toFixed(4), val_acc: +va.toFixed(4),
      mfu: +mf.toFixed(4), precision: +pc.toFixed(4), recall: +rc.toFixed(4), f1: +f1.toFixed(4),
      rollout_actor_probs_pearson_corr: +cr.toFixed(4),
      avg_mem: +avg_mem.toFixed(4),
      mem_gb: +mem_gb.toFixed(2), alloc_api_ms: +alloc_api_ms.toFixed(1),
      malloc_calls: +malloc_calls.toFixed(0), frag_ratio: +frag_ratio.toFixed(4),
      throughput: +throughput.toFixed(0),
      loss, grad_norm, loss_single, grad_norm_single, weight_diff,
      loss_scale_log2: lossScaleLog2, z_loss,
    };
  }

  function buildAccuracyData(steps) {
    const n = steps.length;
    const cols = { train_loss: [], val_loss: [], train_acc: [], val_acc: [], mfu: [], precision: [], recall: [], f1: [], rollout_actor_probs_pearson_corr: [], avg_mem: [], mem_gb: [], alloc_api_ms: [], malloc_calls: [], frag_ratio: [], throughput: [], loss: [], grad_norm: [], loss_single: [], grad_norm_single: [], weight_diff: [], loss_scale_log2: [], z_loss: [] };
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
      cols.f1.push(m.f1);
      cols.rollout_actor_probs_pearson_corr.push(m.rollout_actor_probs_pearson_corr);
      cols.avg_mem.push(m.avg_mem);
      cols.mem_gb.push(m.mem_gb);
      cols.alloc_api_ms.push(m.alloc_api_ms);
      cols.malloc_calls.push(m.malloc_calls);
      cols.frag_ratio.push(m.frag_ratio);
      cols.throughput.push(m.throughput);
      cols.loss.push(m.loss);
      cols.grad_norm.push(m.grad_norm);
      cols.loss_single.push(m.loss_single);
      cols.grad_norm_single.push(m.grad_norm_single);
      cols.weight_diff.push(m.weight_diff);
      cols.loss_scale_log2.push(m.loss_scale_log2);
      cols.z_loss.push(m.z_loss);
    });
    return cols;
  }

  let ACC_DATA = null; // 首次 initAccuracyCharts() 时基于 seedHistory() 之后的 state 生成,此后每次 tick() 随 accSteps 一起刷新

  function refreshAccuracyData() {
    accSteps = computeAccSteps();
    ACC_DATA = buildAccuracyData(accSteps);
  }

  const fmtAccPct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

  /* 曲线配色统一为两档，不再一指标一色：第一条(或唯一一条)曲线用 grad_norm 原来那支蓝紫
     (--twin-chart-gradnorm / l0b-deep-violet #4F46E5)，图内第二条曲线用 train loss 原来那支绿
     (--twin-chart-loss / success·ark-green-500 #04D793) —— 蓝紫与绿是对比色，同图两条线一眼分得开。
     并列十来张卡时彩虹配色只是噪声——真正需要区分的是"同一张图里的两条线"，
     其余语义(事故点红虚线、异常带、参考线)另有自己的颜色，不受这两档影响。 */
  const LINE_1 = "--twin-chart-gradnorm";  // 主线 · 蓝紫
  const LINE_2 = "--twin-chart-loss";      // 同图第二条线 · 绿

  const ACC_CARD_DEFS = [
    { id: "loss", name: "loss", legend: true,
      formatValue: (v) => (v == null ? "—" : v.toFixed(3)),
      tipCarryForward: false, markerStep: INCIDENT_STEP,
      series: [
        { id: "train_loss", label: "train loss", key: "train_loss", colorVar: LINE_1 },
        // connectNulls：val 只在 epoch 采样点有值(其余为 null)，不连空点的话每个点都是孤立
        // moveto、整条线一段都画不出来 —— 图上看着就是"少画了一条曲线"
        { id: "val_loss", label: "val loss", key: "val_loss", colorVar: LINE_2, emphasis: true, connectNulls: true },
      ] },
    { id: "acc", name: "acc", legend: true, formatValue: fmtAccPct,
      tipCarryForward: false, markerStep: INCIDENT_STEP,
      series: [
      { id: "train_acc", label: "train acc", key: "train_acc", colorVar: LINE_1 },
      { id: "val_acc", label: "val acc", key: "val_acc", colorVar: LINE_2, emphasis: true, connectNulls: true },
    ] },
    { id: "gradnorm", name: "grad_norm", legend: false,
      note: `step ${INCIDENT_STEP} MoE all-to-all 超时 → grad_norm 跳至 inf，AI 定位修复后 ${RECOVERY_STEPS} 步内恢复`,
      formatValue: (v) => (v == null ? "—" : !isFinite(v) ? "inf" : v.toFixed(2)),
      tipCarryForward: false, markerStep: INCIDENT_STEP,
      series: [
        { id: "gradnorm", label: "grad_norm", key: "grad_norm", colorVar: LINE_1, emphasis: true },
      ] },
    { id: "recall", name: "recall", legend: false, note: "真实正例的召回率", formatValue: fmtAccPct,
      tipCarryForward: false, markerStep: INCIDENT_STEP,
      series: [
      { id: "recall", label: "recall", key: "recall", colorVar: LINE_1, emphasis: true },
    ] },
    { id: "z_loss", name: "z-loss", legend: false,
      note: "logits 归一化正则项;本次事故前训练从未开启,是根因之一——熔断修复后才加入抑制 router logits 极端值",
      formatValue: (v) => (v == null || !isFinite(v) ? "—" : v.toFixed(4)),
      tipCarryForward: false, markerStep: INCIDENT_STEP,
      series: [
      { id: "z_loss", label: "z-loss", key: "z_loss", colorVar: LINE_1, emphasis: true },
    ] },
    { id: "weightdiff", name: "weight_diff", legend: true,
      note: `参数更新幅度 ‖ΔW‖，与 grad_norm 同一根因同步观察；step ${INCIDENT_STEP} 梯度发散时同步跳至 inf`,
      formatValue: (v) => (v == null ? "—" : !isFinite(v) ? "inf" : v.toFixed(4)),
      tipCarryForward: false, markerStep: INCIDENT_STEP,
      series: [
        { id: "weight_diff", label: "‖ΔW‖", key: "weight_diff", colorVar: LINE_1 },
        // grad_norm 量级(约 12~50)远大于 ‖ΔW‖(约 0.4~3.2),放右轴独立定域,避免被压成贴底的平线
        { id: "gradnorm_ref", label: "grad_norm (右轴)", key: "grad_norm", colorVar: LINE_2, emphasis: true, axis: "right" },
      ] },
    { id: "loss_scale", name: "AMP loss scale", legend: false,
      note: "首次连续减半即通知；降至初始值 1/16 自动 dump，降至 1/32 立即停训",
      formatValue: (v) => (v == null || !isFinite(v) ? "—" : Math.round(Math.pow(2, v)).toLocaleString()),
      tipCarryForward: false, markerStep: INCIDENT_STEP, smoothing: 0,
      // 固定为 2^10.5~2^16.5：让 65536→4096 的四级衰减占据主要纵向空间，
      // 同时给尚未触发的 1/32 停训线（2048 / log2=11）留出可见位置。
      yDomain: { left: [10.5, 16.5] },
      referenceLines: [
        { value: 12, label: "1/16 告警", color: "#ea580c" },
        { value: 11, label: "1/32 停训", color: "#dc2626" },
      ],
      series: [
      { id: "loss_scale", label: "loss scale", key: "loss_scale_log2", colorVar: LINE_1, emphasis: true, curve: "step" },
    ] },
    { id: "precision", name: "precision", legend: false, note: "预测正例中的准确率", formatValue: fmtAccPct,
      tipCarryForward: false, markerStep: INCIDENT_STEP,
      series: [
      { id: "precision", label: "precision", key: "precision", colorVar: LINE_1, emphasis: true },
    ] },
  ];

  /* infra 两图(MFU / 显存利用率)的 y 轴域：只按「健康段」取值域。
     这两个指标事故步本身为 NaN（无效读数），恢复期从 0 回升，若把 0 纳入值域，正常波动（MFU 约 0.45~0.60、
     HBM 约 0.72~0.85）会被压成图表顶部一条窄带，下方大片留白 —— 图表空间大但看不出波动。
     这里排除事故窗口 [INCIDENT_STEP, RECOVERY_END] 内的点后再取 min/max 并留 8% 余量；
     骤降段被图表 clip 裁到画面外，事故本身仍由下方 regions 区带 + 悬浮气泡的真实数值体现。 */
  function healthyDomain(values, steps) {
    if (!values) return null;
    let min = Infinity, max = -Infinity;
    steps.forEach((st, i) => {
      const v = values[i];
      if (v == null || !isFinite(v)) return;
      if (st >= INCIDENT_STEP && st <= RECOVERY_END) return;
      if (v < min) min = v;
      if (v > max) max = v;
    });
    if (!isFinite(min) || !isFinite(max)) return null;   // 窗口整段落在事故区 → 退回引擎自适应
    if (min === max) { min -= 0.01; max += 0.01; }
    const pad = (max - min) * 0.08;
    return [min - pad, max + pad];
  }

  const INFRA_CARD_DEFS = [
    { id: "mfu", name: "MFU", legend: false,
      note: `Model FLOPS Utilization · 训练算力利用效率；step ${INCIDENT_STEP} 进程死锁崩溃，无有效读数记为 NaN`,
      formatValue: (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`),
      markerStep: INCIDENT_STEP,
      yDomain: (steps, data) => ({ left: healthyDomain(data.mfu, steps) }),
      series: [
        { id: "mfu", label: "MFU", key: "mfu", colorVar: LINE_1, emphasis: true },
      ] },
    // linkCursor:false —— 不与精度栏 6 张卡做悬浮联动(见 renderMetricChart),只显示自己的游标气泡
    { id: "avg_mem", name: "显存利用率", legend: false, linkCursor: false,
      note: `HBM 平均占用率 · 跨卡均值；step ${INCIDENT_STEP} 进程死锁崩溃，无有效读数记为 NaN`,
      formatValue: (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`),
      markerStep: INCIDENT_STEP,
      yDomain: (steps, data) => ({ left: healthyDomain(data.avg_mem, steps) }),
      series: [
        { id: "avg_mem", label: "HBM", key: "avg_mem", colorVar: LINE_1, emphasis: true },
      ] },
    /* 注：这里曾经并排放过一张「显存占用 (GB)」卡，已撤掉 —— avg_mem 就是 mem_gb / 单卡容量，
       两张卡画的是同一条曲线、只差单位，集群监控栏里看着像重复了一张。绝对 GB 的读法
       （离 64 GB 天花板还有多远、峰值构成、碎片）统一放到底部 dock「性能」页签，
       见 js/training-memory-panel.js。 */
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
    // 聚光灯定位链(js/training-spotlight.js)按 [data-acc-card] 选中并照亮对应指标卡(如 loss / loss_scale)
    card.dataset.accCard = cfg.id;
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
    // regions 标记事故+恢复窗口（而非从事故点一直拉到图表末尾）。
    // 显式给了 cfg.regions 的卡片优先用它 —— 问题二(显存 OOM, step 12003)的恢复窗口与问题一
    // 的 RECOVERY_END 不同,不能套用下面那条按问题一口径算的默认区带。
    const regions = cfg.regions
      || (cfg.markerStep != null
        ? [{ start: cfg.markerStep, end: Math.min(RECOVERY_END, steps[steps.length - 1]), label: "事故 · 恢复" }]
        : null);
    const data = cfg.data || ACC_DATA;
    // x 轴刻度档数按实际绘图宽度动态收缩：窄卡(训练监控侧栏 2 列)硬塞 4 档会首尾数字交错重叠，
    // 宽一点的场景(如「问题一·迭代层」大图)才有空间摆下 3~4 档。阈值按 pad.l(40)+pad.r(10) 扣完后的
    // plotW 估算：每档数字(如"15203")在 10px 等宽字体下约占 30~35px，需要档间留白避免贴边。
    const plotW = w - 50;
    const xTicks = plotW < 150 ? 2 : plotW < 260 ? 3 : 4;
    const renderOpts = {
      steps,
      series: cfg.series.map((s) => ({ axis: "left", ...s })),
      data,
      regions,
      // cfg.yDomain 可为函数(按当前窗口数据算)或常量对象;不给则由引擎自适应
      yDomain: typeof cfg.yDomain === "function" ? cfg.yDomain(steps, data) : (cfg.yDomain || null),
      referenceLines: cfg.referenceLines || null,
      // markerStep：常驻红色虚线(事故点)，与 cursor(仅 hover 时临时出现的中性色游标)彻底分开，
      // 故这里 cursor 恒为 null，不再借用 markerStep 当初始值
      markerStep: cfg.markerStep,
      cursor: null,
      smoothing: cfg.smoothing == null ? accSmoothing : cfg.smoothing,
      cursorTooltip: true,
      tipCarryForward: cfg.tipCarryForward !== false,
      formatValue: cfg.formatValue,
      options: { width: w, height: h, pad: { t: 14, r: 10, b: 20, l: 40 }, xTicks },
      onBrush: false,
      // 图例固定不走引擎内置(会作为额外 DOM 追加进被测量高度的容器,配合 auto-height 造成"越拉越高"的循环增长);
      // 需要图例时改由调用方在容器外自行渲染(见 mountLocateMetricCharts 的 buildAccLegend)
      legend: false,
    };
    // 精度 6 图联动：鼠标悬浮任一图表时同步游标 + 指标气泡到所有精度图表。
    // cfg.linkCursor === false 的卡不参与联动(如集群监控「显存利用率」——它讲的是问题二那条独立的
    // 显存故事,划过它没必要把精度栏 6 张卡的气泡一起唤起来);该卡自身的游标/气泡照常显示。
    if (cfg.linkCursor !== false) {
      renderOpts.onCursorHover = (step) => {
        accCards.forEach((c) => { if (c.ctrl) { c.ctrl.setCursor(step); c.ctrl.setTooltip(true); } });
      };
      // 鼠标离开后收起所有图表的气泡(事故点红线是常驻标注，不随 hover 变化，不需要在这里复位)
      renderOpts.onCursorLeave = () => {
        accCards.forEach((c) => { if (c.ctrl) c.ctrl.setTooltip(false); });
      };
    }
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

  // 先统一读完所有卡片的尺寸(一次 layout flush),再统一写(renderMetricChart 重建图表 DOM)。
  // 逐卡"读尺寸→建 DOM→读下一张尺寸"交替着来的话,每张卡都会强制浏览器同步跑一次 layout——
  // profiler 实测这是 tick() 单帧里最重的一块(N 张卡 N 次同步 layout,而不是 1 次)。
  function syncAccCards(force) {
    const pending = [];
    accCards.forEach((card) => {
      const w = Math.round(card.wrap.clientWidth || 0);
      const h = Math.round(card.wrap.clientHeight || 0);
      if (w < 2 || h < 2) return;
      if (!force && card.ctrl && w === card.size.w && h === card.size.h) return;
      pending.push({ card, w, h });
    });
    pending.forEach(({ card, w, h }) => {
      card.size = { w, h };
      card.ctrl = renderMetricChart(card.wrap, card.cfg, w, h);
    });
  }

  function renderAccReadouts() {
    accCards.forEach((c) => {
      const steps = c.cfg.steps || accSteps;
      const data = c.cfg.data || ACC_DATA;
      const v = data[c.cfg.series[0].key][steps.length - 1];
      c.valEl.textContent = c.cfg.formatValue ? c.cfg.formatValue(v) : (v == null ? "—" : v);
      // 按数值而非格式化文本判断是否标红：acc/precision/recall/f1 走 fmtAccPct 会拼出 "NaN%"，
      // 不等于裸 "NaN"，字符串精确匹配会漏判，故统一用 !isFinite(v) 判定问题值
      c.valEl.classList.toggle("is-danger", v != null && !isFinite(v));
    });
  }

  // 页面上可能同时挂多个 smoothing 滑条(精度卡 / infra 集群监控 / 迭代层),
  // 它们共享同一个 accSmoothing —— 拖动任一个都要把其余滑条的位置与读数镜像过去。
  let smoothControls = []; // [{range, out}]

  function applySmoothing(value, source) {
    accSmoothing = value;
    const pct = String(Math.round(value * 100));
    const txt = value.toFixed(2);
    smoothControls = smoothControls.filter((c) => c.range.isConnected);
    smoothControls.forEach((c) => {
      if (c.range !== source) c.range.value = pct;
      c.out.textContent = txt;
    });
    syncAccCards(true);
    syncInfraCards(true);
    syncLocateMetricCharts(true);
    renderCase6MetricCharts(); // 问题二迭代层的 loss/grad_norm 也随滑条重画(无对应容器时内部自动跳过)
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
    smoothControls.push({ range, out });
    range.addEventListener("input", () => {
      applySmoothing((+range.value) / 100, range);
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

  // ── 智能对话「调整图表」演示场景专用:临时把精度栏 2 张卡换成新指标,关闭对话框(见
  // js/training-chat-panel.js 的 revertChartsOverrideIfActive)即还原。复用真实图表引擎
  // (buildAccCard/renderMetricChart)与 metricsAtStep 同款"先快后缓收敛 + 事故态回弹"曲线形状,
  // 只是喂入虚构的新指标数据,不写回 ACC_DATA/ACC_CARD_DEFS,不影响其余联动逻辑。
  // (原本 f1/corr 两张卡也在这份演示替换名单里,分别换成 Z loss / 数值 t 分布——现已把
  // Z loss、AMP loss scale 提升为 ACC_CARD_DEFS 里的常驻默认卡,不再需要临时演示,
  // 对应的 demoTDistSeries 也随之整体移除。)
  function demoMetricSeries(seed, base, span, noiseAmp, incidentBump) {
    return accSteps.map((step, i) => {
      const t = accSteps.length > 1 ? i / (accSteps.length - 1) : 1;
      const recRaw = (step - INCIDENT_STEP - 1) / (RECOVERY_STEPS - 1 || 1);
      const rec = step <= INCIDENT_STEP ? 0 : step >= RECOVERY_END ? 1 : Math.min(1, Math.max(0, recRaw));
      const ease = rec < 0.5 ? 2 * rec * rec : -1 + (4 - 2 * rec) * rec;
      const atIncident = step === INCIDENT_STEP;
      const inRecovery = step > INCIDENT_STEP && step < RECOVERY_END;
      const convUp = t >= 1 ? 1 : 1 - Math.pow(2, -5.5 * t);
      const baseVal = base - span * convUp + stepNoise(seed, step, noiseAmp);
      if (atIncident) return NaN;
      return +(inRecovery ? baseVal + incidentBump * (1 - ease) : baseVal).toFixed(4);
    });
  }

  const fmtDemoLoss = (digits) => (v) => (v == null || !isFinite(v) ? "—" : v.toFixed(digits));

  const ACC_DEMO_REPLACEMENTS = [
    { targetId: "precision", id: "wplc_val_loss", key: "wplc_val_loss", name: "WPLC val loss",
      note: "WPLC(Wikipedia+Pile 混合语料)验证集 loss，衡量通用语言建模能力",
      colorVar: LINE_1, formatValue: fmtDemoLoss(3),
      genSeries: () => demoMetricSeries(31, 4.6, 1.7, 0.08, 1.4) },
    { targetId: "recall", id: "lambada_val_loss", key: "lambada_val_loss", name: "LAMBADA val loss",
      note: "LAMBADA 完形填空评测集验证 loss，衡量长程上下文理解能力",
      colorVar: LINE_1, formatValue: fmtDemoLoss(3),
      genSeries: () => demoMetricSeries(32, 5.8, 2.4, 0.12, 2.0) },
  ];

  let accDemoOverrideBackup = null; // null = 未应用；应用后存 [{idx, original, originalCardEl}]

  window.twinDemoApplyAccuracyOverride = function () {
    if (accDemoOverrideBackup || !accCards.length) return false;
    const backup = [];
    ACC_DEMO_REPLACEMENTS.forEach((rep) => {
      const idx = accCards.findIndex((c) => c.cfg.id === rep.targetId);
      if (idx === -1) return;
      const original = accCards[idx];
      const originalCardEl = original.wrap.parentElement;
      backup.push({ idx, original, originalCardEl });
      const cfg = {
        id: rep.id, name: rep.name, legend: false, note: rep.note,
        formatValue: rep.formatValue, tipCarryForward: false, markerStep: INCIDENT_STEP,
        data: { [rep.key]: rep.genSeries() },
        series: [{ id: rep.id, label: rep.name, key: rep.key, colorVar: rep.colorVar, emphasis: true }],
      };
      const built = buildAccCard(cfg);
      originalCardEl.replaceWith(built.card);
      const entry = { cfg, valEl: built.valEl, wrap: built.wrap, ctrl: null, size: { w: 0, h: 0 } };
      accCards[idx] = entry;
      syncAccCard(entry, true);
    });
    accDemoOverrideBackup = backup;
    renderAccReadouts();
    return true;
  };

  window.twinDemoResetAccuracyOverride = function () {
    if (!accDemoOverrideBackup) return false;
    accDemoOverrideBackup.forEach(({ idx, original, originalCardEl }) => {
      const currentCardEl = accCards[idx] && accCards[idx].wrap && accCards[idx].wrap.parentElement;
      if (currentCardEl && currentCardEl.parentNode) currentCardEl.replaceWith(originalCardEl);
      accCards[idx] = original;
      syncAccCard(original, true);
    });
    accDemoOverrideBackup = null;
    renderAccReadouts();
    return true;
  };

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

  // 同 syncAccCards:批量读完尺寸再批量写,避免逐卡读写交替触发多次同步 layout。
  function syncInfraCards(force) {
    const pending = [];
    infraCards.forEach((card) => {
      const w = Math.round(card.wrap.clientWidth || 0);
      const h = Math.round(card.wrap.clientHeight || 0);
      if (w < 2 || h < 2) return;
      if (!force && card.ctrl && w === card.size.w && h === card.size.h) return;
      pending.push({ card, w, h });
    });
    pending.forEach(({ card, w, h }) => {
      card.size = { w, h };
      card.ctrl = renderMetricChart(card.wrap, card.cfg, w, h);
    });
  }

  function renderInfraReadouts() {
    infraCards.forEach((c) => {
      const steps = c.cfg.steps || accSteps;
      const data = c.cfg.data || ACC_DATA;
      const v = data[c.cfg.series[0].key][steps.length - 1];
      c.valEl.textContent = c.cfg.formatValue ? c.cfg.formatValue(v) : (v == null ? "—" : v);
      // 与精度栏同一套"问题值标红"语义：事故步 MFU/显存利用率也是 NaN（无效读数）
      c.valEl.classList.toggle("is-danger", v != null && !isFinite(v));
    });
  }

  function initInfraCharts() {
    const host = $("infraCharts");
    if (!host || !window.PtoTrainingMetricsChart) return;
    // 「集群监控」标题右侧的 smoothing 滑条：与「精度」卡那个互为镜像(共享 accSmoothing)
    const smoothSlot = $("infraSmoothSlot");
    if (smoothSlot) {
      smoothSlot.innerHTML = "";
      smoothSlot.appendChild(buildAccuracySmoothControl());
    }
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
    // 回放态：关键指标改读 ACC_DATA 窗口右端(= 拖块所在 step)的值,和精度/infra 图表同源;
    // 实时态仍用 state 上的随机游走值,行为不变。
    const replay = isTimeMachineReplaying() && ACC_DATA ? ACC_DATA : null;
    const last = (key) => {
      const col = replay && replay[key];
      if (!col) return null;
      for (let i = col.length - 1; i >= 0; i -= 1) if (col[i] != null) return col[i];
      return null;
    };
    const rTrainLoss = last("train_loss");
    const rValLoss = last("val_loss");
    const rMfu = last("mfu");
    const rMem = last("avg_mem");
    const rAcc = last("train_acc");

    const shownLoss = rTrainLoss != null ? rTrainLoss : state.loss;
    const acc = rAcc != null ? rAcc : clamp(1 - state.loss / 6, 0, 1);
    const accEMA = clamp(1 - (rTrainLoss != null ? rTrainLoss : state.lossEMA) / 6, 0, 1);
    const avgMem = rMem != null ? rMem : (state.devices.length
      ? state.devices.reduce((sum, device) => sum + device.mem, 0) / state.devices.length
      : 0);
    const shownVal = rValLoss != null ? rValLoss : state.val;
    const shownMfu = rMfu != null ? rMfu : state.mfu;
    setText("vAcc", `${(acc * 100).toFixed(1)}%`);
    setText("vAccSub", `ema ${(accEMA * 100).toFixed(1)}%`);
    setText("vLoss", Number.isFinite(shownLoss) ? shownLoss.toFixed(3) : "NaN");
    setText("vLossSub", `val ${Number.isFinite(shownVal) ? shownVal.toFixed(3) : "NaN"} · ema ${(rTrainLoss != null ? rTrainLoss : state.lossEMA).toFixed(3)}`);
    setText("vMfu", `${(shownMfu * 100).toFixed(1)}%`);
    setText("vMem", `${(avgMem * 100).toFixed(1)}%`);
    setText("vMemSub", `HBM avg / ${state.devices.length} 卡`);
  }

  /* ===== 时光机回放 =====
     liveStep 是训练真正推进到的最新 step(由 tick() 独占推进);state.step 是"当前展示的 step"。
     实时态两者相等;回放态 state.step 被拖块钉在历史某步,tick() 只更新 liveStep 不重绘图表,
     所有以 state.step 为时钟的视图(精度/infra 图表窗口、进度读数、集群热力图、关键指标)
     因此整体回到那一步的状态。拖块只能在 [0, liveStep] 内移动 —— 未执行的 step 无从回放。 */
  let liveStep = state.step;
  let isReplaying = false;
  let liveDeviceSnapshot = null;

  /* 可回放的最早 step。图表窗口是「以展示 step 为右边界的 ACC_WINDOW 个采样点」,
     step 小于窗口点数时步距会被压到 0,200 个采样点全落在同一 step 上,
     x 轴跨度归零 → 坐标算成 NaN,图表卡死。因此下限取一个窗口的点数,保证跨度恒 > 0。 */
  const MIN_VIEW_STEP = ACC_WINDOW;

  function isTimeMachineReplaying() { return isReplaying; }

  // 回放态的集群热力图必须可复现：同一 step 拖过去几次都是同一张图，
  // 因此用 stepNoise(绝对 step 播种)代替 renderHeat() 里的随机游走。
  function applyReplayDevices(step) {
    const baseList = state.devices.map((d, i) => (liveDeviceSnapshot ? liveDeviceSnapshot[i] : d));
    /* 每张卡的 HBM 水位与「显存占用 / 显存利用率」两张曲线同源(见 memoryAtStep):把各卡相对基线
       均值的偏移整体平移到该 step 的全局占用率上 —— 卡间差异照旧,水位跟着「问题二 · 显存」的故事走,
       否则回放到 step 12003 时热力图气泡还写着 HBM 78%,和图上的 64/64 GB 自相矛盾。
       事故步本身无有效读数(NaN),取前一步的峰值代入,以免平移量塌回基线、峰值反而看不见。 */
    const rawGb = memoryAtStep(step).mem_gb;
    const gb = isFinite(rawGb) ? rawGb : memoryAtStep(step - 1).mem_gb;
    const baseMean = baseList.length ? baseList.reduce((sum, b) => sum + b.mem, 0) / baseList.length : 0;
    const shift = isFinite(gb) ? gb / MEM_CAPACITY_GB - baseMean : 0;
    state.devices.forEach((device, index) => {
      const base = baseList[index];
      device.util = clamp(base.util + stepNoise(20 + (index % 16), step, 0.06), 0.45, 1);
      device.mem = clamp(base.mem + shift + stepNoise(40 + (index % 16), step, 0.05), 0.3, 1);
      device.temp = clamp(54 + device.util * 23 + (device.bad ? 8 : 0) + stepNoise(60 + (index % 16), step, 2.2), 50, 92);
    });
  }

  /* 回放/返回统一走这里：换掉展示时钟 → 重算数据 → 重绘所有以 step 为时钟的视图。
     opts.dragging = 拖动中的中间帧,跳过集群热力图。热力图要逐卡重写 2048 个格子的
     class/style/tip(实测每帧数百毫秒,是拖动卡顿的唯一大头),而图表整套重绘只要 ~7ms;
     所以拖动中图表逐帧跟手回放,热力图留到松手那一帧补齐。 */
  function applyViewStep(step, opts) {
    const dragging = !!(opts && opts.dragging);
    const target = clamp(Math.round(step), Math.min(MIN_VIEW_STEP, liveStep), liveStep);
    const wasReplaying = isReplaying;
    isReplaying = target < liveStep;
    if (isReplaying && !wasReplaying) {
      // 首次进入回放：留存实时态的设备基线，返回时原样恢复
      liveDeviceSnapshot = state.devices.map((d) => ({ util: d.util, temp: d.temp, mem: d.mem }));
    }
    state.step = target;
    if (isWzhTwinPage() && typeof window.wzhSyncProblemOneMonitorCards === "function") {
      window.wzhSyncProblemOneMonitorCards(Math.abs(target - INCIDENT_STEP) <= INCIDENT_STEP_TOLERANCE);
    }
    if (!dragging) {
      if (isReplaying) {
        applyReplayDevices(target);
      } else if (liveDeviceSnapshot) {
        state.devices.forEach((d, i) => Object.assign(d, liveDeviceSnapshot[i]));
        liveDeviceSnapshot = null;
      }
    }
    refreshAccuracyData();
    renderVitals();
    renderProgress();
    // 展开着的 256 专家热力跟着时光机走(拖动中也刷,路由坍缩的形成过程就是拖过去看的)
    syncExpertHeatToStep();
    if (!dragging) {
      renderHeat();
      if (activeLocateCase) syncLocateInfraHeat(activeLocateCase);
      renderWhatIf();
    }
    syncAccCards(true);
    syncInfraCards(true);
    if (!dragging) syncLocateMetricCharts(true);
    renderAccReadouts();
    renderInfraReadouts();
    // 底部「性能」页签的显存曲线上有一根「当前 step」游标，跟着时光机走(拖动中不画，松手补齐)
    if (!dragging) window.PtoTrainingMemoryPanel?.renderSoon();
  }

  function exitTimeMachine() {
    applyViewStep(liveStep);
    // 只有 wzh 单屏页面的时光机才会触发问题透镜(见 activateProblemLens),
    // 返回最新 step 时一并收起,避免整网图/infra 热力图残留上一次的问题聚焦。
    if (isWzhTwinPage()) {
      clearDiagnosisFocus();
      hideDiagnosisLocator();
      // 进入问题透镜时关闭的「算子染色」在退出时恢复打开,见 activateProblemLens 里的对应调用。
      window.setOpColorMode?.("cat");
      // 同上:解除侧视图训练动画的「回顾模式」定格,回到最新 step 就该重新跑起来。
      window.PtoTwinGraphAdapter?.setFrozen?.(false);
      // 收起「聚光灯定位链」覆盖层(其名片 × / ESC 亦通过 diagnosisLocatorClose 触发本函数)。
      window.PtoTrainingSpotlight?.close();
    }
  }

  function renderProgress() {
    const pct = clamp(state.step / state.totalSteps, 0, 1);
    const livePct = clamp(liveStep / state.totalSteps, 0, 1);
    // progressPct/progressEpoch 只在旧版 training-monitoring.html 的进度条里还有对应节点，
    // wzh 单屏时光机卡已去掉这两项展示（40.2% 冗余；预训练语料通常只过 1 遍，Epoch 计数没有意义）。
    setText("progressPct", `${(pct * 100).toFixed(1)}%`);
    $("progressFill").style.width = `${(pct * 100).toFixed(2)}%`;
    $("progressStepCurrent").textContent = state.step.toLocaleString();
    $("progressStepTotal").textContent = state.totalSteps.toLocaleString();
    const epoch = Math.floor(state.step / state.stepsPerEpoch) + 1;
    const totalEpochs = Math.ceil(state.totalSteps / state.stepsPerEpoch);
    setText("progressEpoch", `${epoch} / ${totalEpochs}`);
    setText("progressElapsed", fmtDurationCN(state.step * TIME_MACHINE_STEP_SECONDS));

    const live = document.getElementById("progressLive");
    if (live) live.style.width = `${(livePct * 100).toFixed(2)}%`;
    const thumb = document.getElementById("progressThumb");
    if (thumb) {
      thumb.style.left = `${(pct * 100).toFixed(2)}%`;
      thumb.setAttribute("aria-valuenow", String(state.step));
      thumb.setAttribute("aria-valuemin", String(Math.min(MIN_VIEW_STEP, liveStep)));
      thumb.setAttribute("aria-valuemax", String(liveStep));
      thumb.setAttribute("aria-valuetext", `Step ${state.step.toLocaleString()}`);
    }
    document.querySelector(".wzh-timemachine-card")?.classList.toggle("is-replay", isReplaying);

    renderDiagnosisMarkers();
  }

  function bindTimeMachine() {
    const track = document.getElementById("progressTrack");
    const thumb = document.getElementById("progressThumb");
    if (!track || !thumb) return;

    const stepFromClientX = (clientX) => {
      const rect = track.getBoundingClientRect();
      if (!rect.width) return state.step;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      // 越过 liveStep 的部分是"还没跑到的 step",不可拖
      return clamp(Math.round(ratio * state.totalSteps), Math.min(MIN_VIEW_STEP, liveStep), liveStep);
    };

    let dragging = false;
    // 拖动中图表按 rAF 节流重画：ACC_DATA 每次要算 200 点 ×13 条序列，逐 pointermove 重算会掉帧
    let pendingStep = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (pendingStep == null) return;
      applyViewStep(pendingStep, { dragging });
      pendingStep = null;
    };
    const scheduleStep = (step) => {
      pendingStep = step;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const onMove = (e) => {
      if (!dragging) return;
      e.preventDefault();
      scheduleStep(stepFromClientX(e.clientX));
    };
    const onUp = () => {
      if (!dragging) return;
      const landedAt = pendingStep != null ? pendingStep : state.step;
      dragging = false;  // 先落回非拖动态,下面这次重绘才会把热力图等"重活"补齐
      track.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      pendingStep = null;
      applyViewStep(landedAt); // 松手必定整套重绘一次,不依赖是否还有未 flush 的帧
    };

    const onDown = (e) => {
      if (e.button != null && e.button !== 0) return;
      dragging = true;
      track.classList.add("is-dragging");
      thumb.focus({ preventScroll: true });
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      scheduleStep(stepFromClientX(e.clientX));
    };

    thumb.addEventListener("pointerdown", onDown);
    /* 轨道上的按下:问题点标注保留原有的 hover 气泡 + 点击展开诊断卡,不当作拖拽起点。
       v2 单屏页有「时光全景」浮窗(js/training-timeline-panorama.js)后,轨道的一击有了两种语义,
       按是否拖动区分:
         · 按下后拖过 3px  → 和以前一样跟手回放到落点 step；
         · 没拖动的干净一击 → 展开时光全景(整段训练的关键事件全貌)。
       没有全景模块的页面(training-monitoring.html)保持原行为:按下即跳步。 */
    const DRAG_SLOP = 3;
    track.addEventListener("pointerdown", (e) => {
      if (e.target === thumb || e.target.closest?.(".twin-progress-marker")) return;
      if (!window.PtoTrainingPanorama) { onDown(e); return; }
      if (e.button != null && e.button !== 0) return;
      const origin = { x: e.clientX, y: e.clientY };
      let moved = false;
      const cleanup = () => {
        window.removeEventListener("pointermove", onSlopMove);
        window.removeEventListener("pointerup", onSlopUp);
        window.removeEventListener("pointercancel", onSlopUp);
      };
      const onSlopMove = (ev) => {
        if (Math.abs(ev.clientX - origin.x) < DRAG_SLOP && Math.abs(ev.clientY - origin.y) < DRAG_SLOP) return;
        moved = true;
        cleanup();
        // 转交给拖拽回放。pointermove 的 button 是 -1,onDown 会当成非左键直接返回,
        // 因此这里合成一个只带它需要的两个字段的事件对象。
        onDown({ button: 0, clientX: ev.clientX });
      };
      const onSlopUp = () => {
        cleanup();
        if (!moved) window.PtoTrainingPanorama.toggle();
      };
      window.addEventListener("pointermove", onSlopMove);
      window.addEventListener("pointerup", onSlopUp);
      window.addEventListener("pointercancel", onSlopUp);
    });

    // 键盘：←/→ 单步、PageUp/PageDown 粗调、Home/End 到两端
    thumb.addEventListener("keydown", (e) => {
      const coarse = Math.max(1, Math.round(state.stepsPerEpoch));
      const delta = { ArrowLeft: -2, ArrowRight: 2, PageDown: -coarse, PageUp: coarse }[e.key];
      if (delta != null) { e.preventDefault(); applyViewStep(state.step + delta); return; }
      if (e.key === "Home") { e.preventDefault(); applyViewStep(MIN_VIEW_STEP); }
      if (e.key === "End") { e.preventDefault(); exitTimeMachine(); }
    });

    document.getElementById("diagnosisLocatorClose")?.addEventListener("click", exitTimeMachine);
  }

  // 制品(ckpt)列表：step/时间与 js/training-log-drawer.js 的日志时间线量级对齐(总步数 120000，
  // world_size=2048、tp=4·pp=8·ep=64·cp=2)；分片数取 TP×PP×CP=64(DP 副本互为镜像，不重复计入分片)。
  const artifacts = [
    { name: "ckpt-40000", step: 40000, loss: 0.44, time: "2026-07-17 19:48:50", size: "119.1GB", shards: "64 分片（TP4×PP8×CP2）", path: "obs://pangu-ckpt/2.0-flash/step_40000" },
    { name: "ckpt-30000", step: 30000, loss: 0.50, time: "2026-07-17 12:51:32", size: "118.9GB", shards: "64 分片（TP4×PP8×CP2）", path: "obs://pangu-ckpt/2.0-flash/step_30000" },
    { name: "ckpt-20000", step: 20000, loss: 0.58, time: "2026-07-17 06:14:40", size: "118.6GB", shards: "64 分片（TP4×PP8×CP2）", path: "obs://pangu-ckpt/2.0-flash/step_20000" },
    { name: "ckpt-10000", step: 10000, loss: 0.72, time: "2026-07-16 16:35:12", size: "118.4GB", shards: "64 分片（TP4×PP8×CP2）", path: "obs://pangu-ckpt/2.0-flash/step_10000" },
  ];

  const checkpointMarkers = [
    { step: 10000 },
    { step: 20000 },
    { step: 30000 },
    { step: 40000 },
    { step: 60000 },
    { step: 80000 },
    { step: 100000 },
    { step: 120000 },
  ];

  function renderArtifacts() {
    const node = $("artifacts");
    let bestIdx = 0;
    let bestLoss = Infinity;
    artifacts.forEach((a, i) => { if (a.loss < bestLoss) { bestLoss = a.loss; bestIdx = i; } });
    const latestIdx = 0; // 数组按 step 降序排列，首项即最新落盘的 ckpt
    node.innerHTML = `
      <table class="twin-artifacts-table">
        <thead>
          <tr>
            <th>制品名称</th>
            <th>Step</th>
            <th>Epoch</th>
            <th>Loss</th>
            <th>保存时间</th>
            <th>大小</th>
            <th>并行分片</th>
            <th>存储路径</th>
            <th>校验</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${artifacts.map((a, i) => {
            const epoch = Math.ceil(a.step / state.stepsPerEpoch);
            const tags = (i === latestIdx ? '<span class="twin-artifact-badge twin-artifact-badge-latest">最新</span>' : "")
              + (i === bestIdx ? '<span class="twin-artifact-badge">最佳</span>' : "");
            return `
            <tr>
              <td class="twin-artifacts-cell-name"><span class="twin-artifact-name">${a.name}</span>${tags}</td>
              <td class="twin-artifacts-cell-num">${a.step.toLocaleString()}</td>
              <td class="twin-artifacts-cell-num">${epoch}</td>
              <td class="twin-artifacts-cell-num">${a.loss.toFixed(2)}</td>
              <td class="twin-artifacts-cell-mono">${a.time}</td>
              <td class="twin-artifacts-cell-num">${a.size}</td>
              <td>${a.shards}</td>
              <td class="twin-artifacts-cell-mono twin-artifacts-cell-path" title="${a.path}">${a.path}</td>
              <td class="twin-artifacts-cell-verify">✓ SHA256 已校验</td>
              <td><button class="btn btn-ghost btn-sm" type="button" title="仅示意，暂不提供实际下载">下载</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
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
    liveStep += 2;
    if (!isReplaying) state.step = liveStep;
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
      pushEvent(event[0], event[1].replace("{s}", liveStep).replace("{r}", Math.floor(rand(0, 64))).replace("{g}", Math.floor(rand(0, 8))));
    }
    // 回放中：只把进度条右端的"已执行范围"往前推,视图保持钉在拖块所在的历史 step,
    // 否则用户正在看的那一步会被实时时钟顶走
    if (isReplaying) { renderProgress(); return; }
    renderAll();
    syncExpertHeatToStep();   // 展开着的 256 专家热力跟着实时步进重新着色
    // 精度图表窗口跟着 state.step 一起往前滑,和右上角进度条同一个时钟
    refreshAccuracyData();
    syncAccCards(true);
    syncInfraCards(true);
    syncLocateMetricCharts(true);
    renderAccReadouts();
    renderInfraReadouts();
  }

  // ── 供「实时监控」视图（training-monitoring-v2.html 内联脚本）驱动步数的最小接口 ──
  // 实时监控每跑完一遍 46 层前向 = 推进一个 step，需与「时光机」共用同一个 state.step，
  // 因此这里只推进步数并重绘进度条，不触发 tick() 那套 2 分钟一次的指标重算。
  // 回放(时光机拖动)期间不改视图 step，只把已执行范围往前推，与 tick() 的处理保持一致。
  window.twinAdvanceStep = function (n) {
    const delta = Number(n) || 1;
    liveStep = Math.min(state.totalSteps, liveStep + delta);
    if (!isReplaying) state.step = liveStep;
    renderProgress();
    syncExpertHeatToStep();   // 展开着的 256 专家热力跟着实时步进重新着色
    return state.step;
  };
  window.twinGetStep = function () { return state.step; };

  // 供智能对话面板(js/training-chat-panel.js)读取当前训练态作为系统提示上下文,
  // 只读汇总,不暴露 state 本身引用,避免外部误改内部状态。
  window.twinGetTrainingContext = function () {
    const model = models[state.model] || {};
    const hw = hardwareProfiles[state.hardware] || {};
    return {
      model: {
        name: model.name || state.model,
        title: model.title || "",
        summary: model.summary || "",
        seq: model.seq || "",
        parallel: model.parallel || "",
        batch: model.batch || "",
        params: model.params || null,
      },
      task: state.task,
      hardwareLabel: hw.label || state.hardware,
      step: state.step,
      totalSteps: state.totalSteps,
      stepsPerEpoch: state.stepsPerEpoch,
      loss: state.loss,
      lossEMA: state.lossEMA,
      val: state.val,
      mfu: state.mfu,
      seenTokens: state.seen,
      phase: state.phase,
      diagnosisMarkers: visibleDiagnosisMarkers().map((m) => ({
        num: m.displayNum,
        severity: m.severity,
        category: m.category,
        label: m.label,
        sub: m.sub,
        step: m.step != null ? m.step : null,
        stepFrom: m.stepFrom != null ? m.stepFrom : null,
        stepTo: m.stepTo != null ? m.stepTo : null,
      })),
    };
  };

  /* 「问题二 · 显存 OOM」的数据出口:静态事实 + 按 step 取原始显存读数。
     峰值构成堆叠图 / PP stage 热力图 / 碎片分布图三个待建组件都从这里取数,不要各自再抄一份。 */
  window.PtoTrainingTwinMemoryCase = {
    facts: MEM_CASE_FACTS,
    at: function (step) { return memoryAtStep(step); },
    constants: {
      incidentStep: MEM_INCIDENT_STEP, climbFrom: MEM_CLIMB_FROM,
      recoveryEnd: MEM_RECOVERY_END, capacityGB: MEM_CAPACITY_GB,
    },
  };

  /* 「时光全景」浮窗(js/training-timeline-panorama.js)的数据/跳转出口:
     它要按同一套时钟(step ↔ 墙钟)铺事件,并把点中的事件交回时光机,因此只读取汇总态,
     跳转一律走 applyViewStep / activateProblemLens,不另起一套 step 语义。 */
  window.PtoTrainingTimeMachine = {
    getState: function () {
      return {
        step: state.step,
        liveStep: liveStep,
        totalSteps: state.totalSteps,
        stepsPerEpoch: state.stepsPerEpoch,
        stepSeconds: TIME_MACHINE_STEP_SECONDS,
        replaying: isReplaying,
      };
    },
    gotoStep: function (step) { applyViewStep(step); },
    activateProblemLens: function (key) { activateProblemLens(key); },
    exit: function () { exitTimeMachine(); },
  };

  // 供 training-monitoring-v2.html 的 3D deck 适配器复用本文件里的诊断联动入口
  // (适配器负责画图,业务语义仍只有这一份实现)。函数声明会提升,这里引用晚定义的函数是安全的。
  window.PtoTwinGraphBridge = {
    activateProblemLens: function (key) { activateProblemLens(key); },
    // 旧名别名(「问题一」时期的命名),保留以兼容尚未改口的调用方
    activateProblemOneLens: function (key) { activateProblemLens(key); },
    enterProblemOneLayerView: function () { enterProblemOneLayerView(); },
    lvSelectedExperts: function (hotExpert) { return lvSelectedExperts(hotExpert); },
    // deck 上点 router(节点 id 'gate')时调用:就地开/关 256 专家负载热力卡片,
    // 不进问题详情、不动时光机 —— 训练中随时可看当前 step 的路由分布。
    toggleExpertExpand: function () { toggleRoutedExpertBankExpand(); },
  };

  // 供 js/training-spotlight.js 的问题二「模型·数值层」步调用:进入该步循环播放
  // 256 专家负载热力"均衡 → 坍缩"过渡,离开该步(或关闭聚光灯)时钉回坍缩终态。
  window.PtoTrainingExpertHeatLoop = {
    start: function () { startExpertHeatLoop(); },
    stop: function () { stopExpertHeatLoop(); },
  };

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
      layer: "Layer 38 · MoE Router",
      nodeIds: ["router_gate", "router_weight", "routed_expert_bank", "shared_expert_mlp", "moe_all_to_all_dispatch", "moe_all_to_all_combine"],
      edges: [
        ["router_gate", "moe_all_to_all_dispatch"],
        ["moe_all_to_all_dispatch", "routed_expert_bank"],
        ["routed_expert_bank", "moe_all_to_all_combine"],
        ["shared_expert_mlp", "moe_all_to_all_combine"]
      ],
      clusterIds: ["moe-block"],
      note: "Router FP8 softmax 溢出→路由塌缩→all-to-all 死锁+NaN 双发。根因在数值层,通信只是表象。",
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

    "low-precision-training": {
      layer: "Layer 35 深层",
      nodeIds: ["query_tensor", "attention_core", "shared_expert_mlp", "routed_expert_bank"],
      edges: [
        ["query_tensor", "attention_core"],
        ["shared_expert_mlp", "moe_all_to_all_combine"]
      ],
      clusterIds: ["attention-block", "moe-block"],
      note: "FP8 E4M3 深层激活值长尾超限 → 峰度 +15.3 → 梯度信号淹没。",
    },

    // 问题二(仅 v2 单屏页):定位链-openPangu-2.0-Flash.md 案例四。命中的是"显存被谁占满"的三处:
    // MoE expert dispatch buffer(热点层 38)、routed expert bank(激活大头)、lm_head(logits 1.2 GB)。
    "mem-oom": {
      layer: "PP stage 3 · L34-45 + LM Head",
      nodeIds: ["moe_all_to_all_dispatch", "routed_expert_bank", "lm_head"],
      edges: [
        ["moe_all_to_all_dispatch", "routed_expert_bank"],
        ["final_norm", "lm_head"]
      ],
      clusterIds: ["moe-block"],
      note: "activation checkpoint 未开启 → 46 层激活全量常驻占 56.6% 显存;分配器碎片率 83% 让 OOM 提前到来。",
    },
  };

  /* 进度条诊断标记:step 在 0~totalSteps 范围内,百分比自动换算。
     ── 编号(num / wzhNum)──────────────────────────────────────────────────────
     两个页面各有一套展示序号,不能共用一个字段:
       · num    = training-monitoring.html 的序号,与它 markup 里硬编码的 5 张诊断卡片一一对应(一~五),
                  改动它就要同步改那份 markup,因此保持不动;
       · wzhNum = training-monitoring-v2.html(单屏)的序号。v2 按事故发生时间编号：
                  step 12003 的「显存 OOM」为问题一，step 15203 的 Router 事故为问题二。
                  取值一律走 problemNum(marker)。
     ── 页面归属(wzhOnly / wzhLens)────────────────────────────────────────────
       · wzhOnly = 只在 v2 出现。training-monitoring.html 的诊断卡片列表是写死的 markup,没有对应卡片
                   就不能在它的整网图上画徽标(点了没有卡片可联动);
       · wzhLens = 在 v2 时光机进度条上画标记,点击即进入该问题的聚光灯定位链。 */
  const diagnosisMarkers = [
    { key: "moe-a2a", step: INCIDENT_STEP, severity: "p0", category: "精度", num: "一", wzhNum: "二", wzhLens: true, label: "Router 数值溢出 → 路由塌缩，同时触发 loss NaN 与 all-to-all 死锁", sub: "router softmax FP8 溢出 → 98% token 集中到 expert 193 → NaN + 死锁双发" },
    { key: "mem-oom", step: MEM_INCIDENT_STEP, severity: "p0", category: "显存", num: "六", wzhNum: "一", wzhLens: true, label: "activation checkpoint 未开启 → 显存峰值超标 + 分配器碎片触发 OOM", sub: `激活值占 56.6%(36.2 GB) → 峰值触顶 ${MEM_CAPACITY_GB} GB，碎片率 83% → rank ${MEM_CASE_FACTS.oomRank} OOM 中断` },
    { key: "perf-compute-bottleneck", stepFrom: 20000, stepTo: 120000, severity: "p1", category: "性能", num: "二", wzhNum: "三", label: "算子带宽瓶颈 + AICPU 回退", sub: "lm_head vocab 非对齐, cube_util 49%, AICPU 526ms" },
    { key: "qproj-overflow", step: 8500, severity: "p1", category: "精度", num: "三", wzhNum: "四", label: "q_proj FP8 精度溢出 → grad_norm 发散", sub: "layer 33 q_proj 3.2% 超 FP8 max(448)" },
    { key: "low-precision-training", stepFrom: 28000, stepTo: 35000, severity: "p1", category: "精度", num: "四", wzhNum: "五", label: "低精训练 loss 不收敛 → 梯度消失", sub: "FP8 E4M3 深层激活值长尾, 峰度 +15.3, SNR 降至 6.8dB" },
    { key: "nvlink", step: 20000, severity: "p1", category: "Infra", num: "五", wzhNum: "六", label: "HCCS 链路掉线 → MFU 骤降", sub: "node2 NPU3 lane5 inactive, HCCL 回退 RoCE 慢路径" },
  ];

  // wzh 单屏页面识别:该页面把「时光机」进度条搬进独立卡片(.wzh-timemachine-card),
  // training-monitoring.html 没有这个类名,用它做两个页面共用同一份 JS 时的行为分支。
  function isWzhTwinPage() {
    return !!document.querySelector('.wzh-timemachine-card');
  }

  // 当前页面下该问题的展示序号(见 diagnosisMarkers 的编号说明)
  function problemNum(marker) {
    if (!marker) return "";
    return (isWzhTwinPage() && marker.wzhNum) || marker.num || "";
  }

  /* 当前页面应当出现的诊断标记,并把 problemNum() 的结果固化为 displayNum ——
     整网图适配器(training-monitoring-v2-deck.js)拿到的是这份数组的副本,画徽标时直接读 displayNum,
     不必也不应再关心 num/wzhNum 的分页规则。 */
  function visibleDiagnosisMarkers() {
    const wzh = isWzhTwinPage();
    return diagnosisMarkers
      .filter((m) => wzh || !m.wzhOnly)
      .map((m) => Object.assign({}, m, { displayNum: problemNum(m) }));
  }

  // 与 visibleDiagnosisMarkers() 同口径的 diagnosisCases 子集(键序保持原顺序)
  function visibleDiagnosisCases() {
    const keys = new Set(visibleDiagnosisMarkers().map((m) => m.key));
    const out = {};
    Object.keys(diagnosisCases).forEach((k) => { if (keys.has(k)) out[k] = diagnosisCases[k]; });
    return out;
  }

  function renderDiagnosisMarkers() {
    const track = document.getElementById('progressTrack');
    if (!track) return;
    // wzh 单屏时光机只画「有聚光灯定位链」的问题(wzhLens:问题一 router 溢出 / 问题二 显存 OOM),
    // 其余几个只在整网图上留徽标、不占进度条;training-monitoring.html 仍是全量。
    const markers = isWzhTwinPage()
      ? visibleDiagnosisMarkers().filter((m) => m.wzhLens)
      : visibleDiagnosisMarkers();
    // 标记位置只取决于绝对 step / totalSteps,与当前展示的 step 无关;
    // 已经画好就直接复用,避免时光机拖动时每帧重建 DOM(还会打断 hover 气泡)
    if (track.querySelectorAll('.twin-progress-marker').length === markers.length) return;
    // 问题点标注是带序号的红色圆点，直接用百分比定位，无需测量几何。
    track.querySelectorAll('.twin-progress-marker, .twin-progress-checkpoint').forEach((el) => el.remove());
    const total = state.totalSteps || 120000;
    markers.forEach((m) => {
      const firstStep = m.stepFrom != null ? m.stepFrom : m.step;
      const pct = clamp(firstStep / total, 0, 1);
      const mk = document.createElement('div');
      mk.className = `twin-progress-marker is-${m.severity}`;
      mk.style.left = (pct * 100).toFixed(2) + '%';
      const trackNum = isWzhTwinPage()
        ? ({ "一": "1", "二": "2" }[m.displayNum] || m.displayNum)
        : m.displayNum;
      mk.textContent = trackNum;
      mk.dataset.markerKey = m.key;
      mk.dataset.problemNum = trackNum;
      mk.setAttribute('role', 'button');
      mk.setAttribute('aria-label', `问题${m.displayNum}：${m.label}`);
      track.appendChild(mk);
    });
    // checkpoint 标记：已到达=绿色菱形，未到达=灰色
    checkpointMarkers.forEach((cp) => {
      const pct = clamp(cp.step / total, 0, 1);
      const mk = document.createElement('div');
      const reached = state.step >= cp.step;
      mk.className = 'twin-progress-checkpoint' + (reached ? ' is-reached' : '');
      mk.style.left = (pct * 100).toFixed(2) + '%';
      mk.title = 'ckpt-' + cp.step + (reached ? ' · 已保存' : ' · 未到达');
      track.appendChild(mk);
    });
  }

  function markNodeActive(stage, nodeId, className) {
    const group = stage?.querySelector(`[data-node-id="${nodeId}"]`);
    if (!group) return;
    group.classList.add(className);
    // 涟漪(呼吸)效果已按需求移除:命中节点只保留静态红色描边,不再克隆脉冲环
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
    // training-monitoring-v2.html 把整网图换成了 model-architecture-3d-deck(CSS 3D DOM,
    // 不是 SVG),节点几何与徽标绘制方式完全不同,由它自己注册的适配器接管;旧 v2/training-monitoring.html
    // 没有适配器,继续走下面这套 SVG 实现,行为不变。下同。
    if (window.PtoTwinGraphAdapter) {
      window.PtoTwinGraphAdapter.renderMarkers(visibleDiagnosisCases(), visibleDiagnosisMarkers(), problemSeverityColor);
      return;
    }
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

      // 徽标改为「与所属节点同宽」的两行标签条：上排「问题N」+ 下排问题标题(超宽自动省略号截断)。
      // 宽度严格等于节点本体宽度、左右边缘对齐节点，天然不会侵入相邻节点/连线的空间；
      // 部分案例共用同一 anchor 节点(如 query_tensor 挂问题二+三、router_gate 挂问题一+六)时，
      // 仍沿用原有「与已放置徽标重叠则整体上移一层」避让逻辑纵向堆叠，互不遮挡。
      var ROW1_FS = 14, ROW2_FS = 11.5, PILLH = 46, PADX = 12, PADY = 6, ROW_GAP = 3, GAP = 4;
      var numText = "问题" + marker.num;
      var titleText = marker.label || "";

      function measure(str, fs, weight) {
        var t = document.createElementNS(NS, "text");
        t.setAttribute("font-size", fs);
        t.setAttribute("font-weight", weight || "500");
        t.setAttribute("font-family", "system-ui, sans-serif");
        t.textContent = str;
        nodeGroup.appendChild(t);
        var w = 0;
        try { w = t.getBBox().width; } catch (e) { w = str.length * fs * 0.62; }
        nodeGroup.removeChild(t);
        return w;
      }

      var pillW = Math.max(dims.w, 96);
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
      bg.setAttribute("rx", 10); bg.setAttribute("ry", 10);
      bg.setAttribute("fill", "var(--danger, #FF4B7B)");
      badge.appendChild(bg);

      // 上排：问题序号
      var numEl = document.createElementNS(NS, "text");
      numEl.setAttribute("x", pillLeft + PADX);
      numEl.setAttribute("y", pillTop + PADY + ROW1_FS * 0.85);
      numEl.setAttribute("fill", "#ffffff");
      numEl.setAttribute("font-size", ROW1_FS);
      numEl.setAttribute("font-weight", "700");
      numEl.setAttribute("font-family", "system-ui, sans-serif");
      numEl.textContent = numText;
      badge.appendChild(numEl);

      // 下排：问题标题，超出徽标可用宽度时逐字裁剪并加省略号(完整标题仍在 hover 提示中)
      var maxTitleW = pillW - PADX * 2;
      var shownTitle = titleText;
      if (measure(shownTitle, ROW2_FS) > maxTitleW) {
        while (shownTitle.length > 1 && measure(shownTitle + "…", ROW2_FS) > maxTitleW) {
          shownTitle = shownTitle.slice(0, -1);
        }
        shownTitle = shownTitle + "…";
      }
      var titleEl = document.createElementNS(NS, "text");
      titleEl.setAttribute("x", pillLeft + PADX);
      titleEl.setAttribute("y", pillTop + PADY + ROW1_FS + ROW_GAP + ROW2_FS * 0.85);
      titleEl.setAttribute("fill", "#ffffff");
      titleEl.setAttribute("fill-opacity", "0.92");
      titleEl.setAttribute("font-size", ROW2_FS);
      titleEl.setAttribute("font-weight", "500");
      titleEl.setAttribute("font-family", "system-ui, sans-serif");
      titleEl.textContent = shownTitle;
      badge.appendChild(titleEl);

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

      var visibleCases = visibleDiagnosisCases();
      Object.values(visibleCases).forEach(function(info) {
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

      // 点一下就地展开 256 专家负载热力,再点收起。不进问题详情、不动时光机——
      // 训练过程中随时可以打开看当前这一步 token 是怎么分到 256 个专家上的,
      // 步数推进/时光机拖动时热力跟着重画(见 syncExpertHeatToStep)。
      // router_gate(做出路由决策的算子)是语义入口,routed_expert_bank(展开卡片就长在它身上)
      // 是几何入口——从"点哪个能看到专家"的直觉出发,用户更可能点后者,两个都绑。
      ["router_gate", "routed_expert_bank"].forEach(function (id) {
        bindRouterExpandToggle(stage.querySelector('[data-node-id="' + id + '"]'));
      });

      Object.keys(visibleCases).forEach(function(key) {
        var info = visibleCases[key];
        var marker = diagnosisMarkers.find(function(m) { return m.key === key; });
        if (!marker || !info.nodeIds.length) return;
        var color = problemSeverityColor(key);
        var nodeGroup = stage.querySelector('[data-node-id="' + info.nodeIds[0] + '"]');
        if (!nodeGroup) return;
        drawBadge(nodeGroup, { key: key, label: marker.label, num: problemNum(marker), sub: info.note || "" }, color);
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
          if (card) { toggleDiagnosisCard(card); return; }
          // wzh 单屏页面没有「问题诊断」卡片列表,改走单屏问题一透镜联动
          if (isWzhTwinPage()) activateProblemLens(m.diagnosisKey);
        });
      }
    });
  }

  function clearDiagnosisFocus() {
    if (window.PtoTwinGraphAdapter) {
      window.PtoTwinGraphAdapter.clearFocus();
      highlightProblemBadge(null);
      hideRoutedExpertBankExpand();
      return;
    }
    var stage = document.getElementById("graphStage");
    if (stage) {
      stage.classList.remove("is-diagnosis-focus");
      stage.querySelectorAll(".pto-diagnosis-focus-active").forEach(function(el) { el.classList.remove("pto-diagnosis-focus-active"); });
    }
    highlightProblemBadge(null);
    hideRoutedExpertBankExpand();
  }

  function highlightProblemBadge(caseKey) {
    if (window.PtoTwinGraphAdapter) { window.PtoTwinGraphAdapter.highlightBadge(caseKey); return; }
    var stage = document.getElementById("graphStage");
    if (!stage) return;
    stage.querySelectorAll(".pto-problem-badge").forEach(function(b) {
      var match = b.getAttribute("data-diagnosis-key") === caseKey;
      b.classList.toggle("is-dimmed", !!caseKey && !match);
      b.classList.toggle("is-active", !!caseKey && match);
    });
  }

  // ── wzh 单屏页面专属:「routed_expert_bank」单节点原地撑开卡片 ──────────────────
  // training-monitoring.html 点问题一是下钻到整块「L38 · MoE TransformerLayer」展开图页面
  // (openModelLayerView,见下文);wzh 单屏不下钻整页,只让整网图里 routed_expert_bank 这一个
  // 节点原地"撑开"成同样内容的卡片(routed experts·256→EP64(64 卡×4) 网格 + EP rank 23 死锁
  // buffer 失配),复用 lvSelectedExperts()/LV_BASE 的数据与配色,和「模型层展开图」保持信息一致。
  // 卡片挂在节点同一个父级(与节点共享 pan/zoom 坐标系,视图跟着整网图一起缩放平移),
  // 不受 .twin-live-on(实时监控)隐藏问题徽标的 CSS 规则影响,因此全局/实时监控视图下都可见。
  var routedExpertExpandActive = false;
  var ROUTED_EXPERT_HOT_ID = 193; // 与 diagnosisMarkers/locateChains 的「问题一」口径一致(expert 193)
  var EXPAND_W = 560, EXPAND_H = 210; // 卡片尺寸,同时供下面「挤开邻居节点」的避让计算复用

  // ── 展开卡片里两处随 step 变化的读数 ──────────────────────────────────────────
  // 卡片本体(64×4 网格 + 色阶)是固定几何,只有这两处文案/柱子跟着 step 走,
  // 所以步进时由 updateExpertHeatReadout() 就地改,不重建整张卡片(重建会打断热力过渡)。

  // 最热/最冷专家 + 相对均衡基准(1/256)的倍数,健康态与坍缩态共用这组统计
  function lvHeatStats(loads) {
    var even = 1 / LV_BASE.routedExperts;
    var hi = 0, lo = 0;
    for (var i = 1; i < loads.length; i += 1) {
      if (loads[i] > loads[hi]) hi = i;
      if (loads[i] < loads[lo]) lo = i;
    }
    return {
      even: even,
      hiId: hi, hiLoad: loads[hi], hiX: loads[hi] / even,
      loId: lo, loLoad: loads[lo], loX: loads[lo] / even,
    };
  }
  function lvPct(v) { return (v * 100).toFixed(v >= 0.01 ? 1 : 2) + "%"; }

  function lvHeatCaption(loads, step) {
    var st = lvHeatStats(loads);
    if (lvRouteSkew(step) >= 0.5) {
      return "色温 ∝ token 量:" + lvPct(st.hiLoad) + " → E" + st.hiId + "(路由坍缩)";
    }
    return "色温 ∝ token 量 · 最热 E" + st.hiId + " " + lvPct(st.hiLoad) + "(均衡 " + lvPct(st.even) + ")";
  }

  // 底部读数:坍缩态讲 rank 23 的 all-to-all buffer 失配(事故根因链路的下一环);
  // 健康态讲负载均衡度(最热/最冷专家占比 + 相对均衡的倍数)。两者共用同一块版面与三行几何。
  function lvHeatGaugeMarkup(loads, step, gX, gaugeY, barX, barMaxW) {
    var LV = LV_BASE;
    var head = 'style="font-size:9.5px;font-weight:800;font-family:system-ui,sans-serif"';
    var lbl = 'style="font-size:8.5px;font-family:system-ui,sans-serif" fill="var(--foreground-secondary)"';
    var val = 'style="font-size:8.5px;font-weight:700;font-family:ui-monospace,monospace"';
    if (lvRouteSkew(step) >= 0.5) {
      return '<text x="' + gX + '" y="' + (gaugeY - 2).toFixed(1) + '" fill="' + LV.cHot + '" ' + head + '>EP rank 23 all-to-all buffer 失配 → 死锁</text>' +
        '<text x="' + gX + '" y="' + (gaugeY + 12).toFixed(1) + '" ' + lbl + '>send</text>' +
        '<rect x="' + barX + '" y="' + (gaugeY + 6).toFixed(1) + '" width="3" height="8" rx="1" fill="none" stroke="' + LV.cHot + '" stroke-width="1"></rect>' +
        '<text x="' + (barX + 10) + '" y="' + (gaugeY + 12).toFixed(1) + '" fill="' + LV.cFlow + '" ' + val + '>0(无 token 外发)</text>' +
        '<text x="' + gX + '" y="' + (gaugeY + 26).toFixed(1) + '" ' + lbl + '>recv</text>' +
        '<rect x="' + barX + '" y="' + (gaugeY + 20).toFixed(1) + '" width="' + Math.max(3, barMaxW).toFixed(1) + '" height="8" rx="1" fill="' + LV.cFlow + '"></rect>' +
        '<text x="' + (barX + barMaxW + 6).toFixed(1) + '" y="' + (gaugeY + 26).toFixed(1) + '" fill="' + LV.cFlow + '" ' + val + '>2048×4608×8 ≈ 151MB</text>';
    }
    var st = lvHeatStats(loads);
    // 柱长按「相对均衡的倍数 / 4×」归一,与热力色阶的 4× 打满口径一致,读起来是同一把尺子;
    // 柱色直接取该专家自己的热力色(同一个 lvHeatFill/lvHeatOpacity),柱子就是那一格的放大版,
    // 配合网格上的 lv-heat-mark 描边圈,数字、柱子、格子三者一眼能对上。
    var wOf = function (x) { return Math.max(3, Math.min(1, x / 4) * barMaxW); };
    var hiT = lvHeatT(st.hiLoad), loT = lvHeatT(st.loLoad);
    var hiC = lvHeatFill(hiT, false), loC = lvHeatFill(loT, false);
    var hiW = wOf(st.hiX), loW = wOf(st.loX);
    // step 用精确值(fmtBig 会压成 24.3k,步号必须逐步可读——这卡片就是拿来逐 step 对比的)
    return '<text x="' + gX + '" y="' + (gaugeY - 2).toFixed(1) + '" fill="var(--foreground)" ' + head + '>路由负载均衡 · step ' + (step == null ? "—" : Math.round(step)) + '</text>' +
      '<text x="' + gX + '" y="' + (gaugeY + 12).toFixed(1) + '" ' + lbl + '>最热</text>' +
      '<rect x="' + barX + '" y="' + (gaugeY + 6).toFixed(1) + '" width="' + hiW.toFixed(1) + '" height="8" rx="1" fill="' + hiC + '" opacity="' + lvHeatOpacity(hiT).toFixed(3) + '"></rect>' +
      '<text x="' + (barX + hiW + 6).toFixed(1) + '" y="' + (gaugeY + 12).toFixed(1) + '" fill="' + hiC + '" ' + val + '>E' + st.hiId + " " + lvPct(st.hiLoad) + "(" + st.hiX.toFixed(2) + '×均衡)</text>' +
      '<text x="' + gX + '" y="' + (gaugeY + 26).toFixed(1) + '" ' + lbl + '>最冷</text>' +
      '<rect x="' + barX + '" y="' + (gaugeY + 20).toFixed(1) + '" width="' + loW.toFixed(1) + '" height="8" rx="1" fill="' + loC + '" opacity="' + lvHeatOpacity(loT).toFixed(3) + '"></rect>' +
      '<text x="' + (barX + loW + 6).toFixed(1) + '" y="' + (gaugeY + 26).toFixed(1) + '" fill="' + loC + '" ' + val + '>E' + st.loId + " " + lvPct(st.loLoad) + "(" + st.loX.toFixed(2) + '×均衡)</text>';
  }

  // step 变化后就地刷新卡片上的读数:顶行说明、底部 gauge、EP rank 23 标注的开合。
  // 网格本体由 paintExpertHeat() 单独重着色,两者都不动 DOM 结构,过渡不被打断。
  function updateExpertHeatReadout(step) {
    var loads = null;
    document.querySelectorAll(".lv-heat-caption").forEach(function (el) {
      if (!loads) loads = lvExpertLoads(ROUTED_EXPERT_HOT_ID, step);
      var collapsed = lvRouteSkew(step) >= 0.5;
      el.textContent = lvHeatCaption(loads, step);
      el.setAttribute("fill", collapsed ? LV_BASE.cHot : "var(--foreground-secondary)");
    });
    document.querySelectorAll(".lv-heat-gauge").forEach(function (g) {
      if (!loads) loads = lvExpertLoads(ROUTED_EXPERT_HOT_ID, step);
      g.innerHTML = lvHeatGaugeMarkup(loads, step,
        Number(g.dataset.gx), Number(g.dataset.gy), Number(g.dataset.barx), Number(g.dataset.barw));
    });
    var showHot = lvRouteSkew(step) >= 0.5 ? "1" : "0";
    document.querySelectorAll(".lv-heat-hotlabel").forEach(function (el) { el.setAttribute("opacity", showHot); });
  }

  // step:按哪一步的路由分布出图。不传 = 取当前视图 step(实时训练/时光机拖块所在那一步)。
  function buildExpertBankExpandMarkup(step) {
    if (step == null) step = state.step;
    var LV = LV_BASE;
    var W = EXPAND_W, H = EXPAND_H;
    var ox = -W / 2, oy = -H / 2;
    var padX = 14;
    var gX = ox + padX, gW = W - padX * 2;
    var gY = oy + 46, gH = 96;
    var cardCols = 16, cardRows = 4, gapX = 3, gapY = 5;
    var cardW = (gW - (cardCols - 1) * gapX) / cardCols;
    var cardH = (gH - (cardRows - 1) * gapY) / cardRows;
    var cellW = (cardW - 3) / 2, cellH = (cardH - 3) / 2;
    var cardPos = function (card) { return { x: gX + (card % cardCols) * (cardW + gapX), y: gY + Math.floor(card / cardCols) * (cardH + gapY) }; };
    var cellCenter = function (card, cell) {
      var p = cardPos(card);
      return { x: p.x + 1.5 + (cell % 2) * cellW + cellW / 2, y: p.y + 1.5 + Math.floor(cell / 2) * cellH + cellH / 2 };
    };
    // EP64(64×4)网格本身只作背景棋盘,不给命中卡加红外框(命中态由 hotLabel/gauge 标题表达,
    // 网格描边统一走中性蓝,避免重复刷红)。每个小格 = 一个 routed expert 的负载热力:
    // 这里只写「均衡同色」初值,真实负载挂在 data-fill/data-op 上,由 startExpertHeat() 用 2s 过渡推过去
    // (与「模型层展开图」lvBuildSvg 同一套 lvExpertLoads/lvHeat* 口径)。
    // 负载按传进来的 step 取:训练中点开 router 看到的是当前这一步的真实分布,
    // 时光机拖动/步数推进时由 syncExpertHeatToStep() 就地重新着色,不重建卡片。
    var loads = lvExpertLoads(ROUTED_EXPERT_HOT_ID, step);
    var collapsed = lvRouteSkew(step) >= 0.5;
    var evenT = lvHeatT(1 / LV.routedExperts);
    var evenFill = lvHeatFill(evenT, false), evenOp = lvHeatOpacity(evenT).toFixed(3);
    var cardsSvg = "", cellBox = {};
    for (var card = 0; card < 64; card += 1) {
      var p = cardPos(card);
      cardsSvg += '<rect x="' + p.x.toFixed(1) + '" y="' + p.y.toFixed(1) + '" width="' + cardW.toFixed(1) + '" height="' + cardH.toFixed(1) + '" rx="2"' +
        ' fill="color-mix(in srgb, ' + LV.cFlow + ' 6%, var(--surface-1))"' +
        ' stroke="' + LV.cFlow + '" stroke-opacity=".28" stroke-width="0.7"></rect>';
      for (var cell = 0; cell < 4; cell += 1) {
        var c = cellCenter(card, cell);
        var eid = lvExpertIdAt(card, cell, ROUTED_EXPERT_HOT_ID);
        var load = loads[eid], t = lvHeatT(load);
        var bx = c.x - cellW / 2, by = c.y - cellH / 2;
        var bw = Math.max(0, cellW - 1), bh = Math.max(0, cellH - 1);
        cellBox[eid] = { x: bx, y: by, w: bw, h: bh };   // 供最热/最冷描边圈定位
        cardsSvg += '<rect class="lv-heat-cell" data-e="' + eid + '" data-fill="' + lvHeatFill(t, false) + '" data-op="' + lvHeatOpacity(t).toFixed(3) + '"' +
          ' x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '"' +
          ' width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1"' +
          ' fill="' + evenFill + '" opacity="' + evenOp + '">' +
          '<title>' + lvHeatCellTitle(eid, load) + '</title></rect>';
      }
    }
    // 最热/最冷两格加描边圈:底部 gauge 报的就是这两个专家,圈出来让数字和图能一一对上。
    // 位置由 paintExpertHeat() 在每次重着色后按新的极值搬过去(读格子自己的 x/y/w/h)。
    var mStat = lvHeatStats(loads);
    var markSvg = [["hi", mStat.hiId], ["lo", mStat.loId]].map(function (m) {
      var g = cellBox[m[1]];
      if (!g) return "";
      return '<rect class="lv-heat-mark" data-kind="' + m[0] + '"' +
        ' x="' + (g.x - 1.2).toFixed(1) + '" y="' + (g.y - 1.2).toFixed(1) + '"' +
        ' width="' + (g.w + 2.4).toFixed(1) + '" height="' + (g.h + 2.4).toFixed(1) + '" rx="2"' +
        ' fill="none" stroke="var(--foreground)" stroke-width="1.1" stroke-opacity=".85"></rect>';
    }).join("");

    // 网格整体包一层:paintExpertHeat() 靠 data-heat-hot/data-heat-neutral 就地重着色,
    // is-heat-live 由 startExpertHeat() 在首次揭示动画跑完后挂上(把过渡从 2s 缩到 .6s)。
    cardsSvg = '<g class="lv-heat-grid" data-heat-hot="' + ROUTED_EXPERT_HOT_ID + '" data-heat-neutral="0">' + cardsSvg + markSvg + '</g>';

    // EP rank 23 标注只在坍缩态出现:健康训练下 token 均摊到 64 张卡,没有"那张卡"可指。
    // 元素常在、靠 opacity 开合,这样时光机拖过事故点时由 updateExpertHeatReadout() 直接切,
    // 不必重建整张卡片。
    var rHot = cardPos(23);
    var hotLabel = '<text class="lv-heat-hotlabel" x="' + (rHot.x + cardW / 2).toFixed(1) + '" y="' + (rHot.y - 4).toFixed(1) + '"' +
      ' text-anchor="middle" fill="' + LV.cHot + '" opacity="' + (collapsed ? 1 : 0) + '"' +
      ' style="font-size:8px;font-weight:800;font-family:ui-monospace,monospace;transition:opacity .4s ease">EP rank 23</text>';

    // 热力色阶图例 + 说明(取代原来的 top-8 all-to-all mesh 连线动画)。
    // 原实现在 8 个参与者之间画 C(8,2)=28 条 mesh 逐条生长,但 top-k 是逐 token 算的——
    // 一个 step 几万 token 就是几十万条路由,连线画不全也读不动,反而误导成「只有 8 条链路」。
    var swW = 8, swH = 6, swX = ox + padX + 232;
    var heatStops = "";
    for (var si = 0; si < 12; si += 1) {
      var st = si / 11;
      heatStops += '<rect x="' + (swX + si * swW).toFixed(1) + '" y="' + (oy + 30) + '" width="' + swW + '" height="' + swH + '"' +
        ' fill="' + lvHeatFill(st, false) + '" opacity="' + lvHeatOpacity(st).toFixed(3) + '"></rect>';
    }
    // 顶行读数随 step 变(updateExpertHeatReadout 就地改文案,不重建卡片),故给它一个类名做锚点
    var heatLegend =
      '<text class="lv-heat-caption" x="' + (ox + padX) + '" y="' + (oy + 36) + '" style="font-size:9.5px;font-weight:700;font-family:system-ui,sans-serif" fill="' + (collapsed ? LV.cHot : "var(--foreground-secondary)") + '">' + lvHeatCaption(loads, step) + '</text>' +
      heatStops +
      '<text x="' + (swX + 12 * swW + 5).toFixed(1) + '" y="' + (oy + 36) + '" style="font-size:8px;font-family:ui-monospace,monospace" fill="var(--foreground-secondary)">≈0 → ≥4× 均衡(1/256)</text>';

    // 底部读数:坍缩态讲 rank 23 的 all-to-all buffer 失配(事故根因链路的下一环);
    // 健康态讲负载均衡度(最热/最冷专家占比 + 相对均衡的倍数),两者共用同一块版面。
    // send/recv 柱状图+数值用中性蓝(LV.cFlow),红色只留给诊断标题和 EP rank 23 标注,
    // 避免整块卡片视觉上"全是红色"。
    var gaugeY = gY + gH + 16;
    var barX = gX + 40, barMaxW = gW - 100;
    // 几何参数挂在 group 上,updateExpertHeatReadout() 重算读数时不必再拿一遍卡片尺寸
    var gauge = '<g class="lv-heat-gauge" data-gx="' + gX + '" data-gy="' + gaugeY.toFixed(1) +
      '" data-barx="' + barX + '" data-barw="' + Math.max(3, barMaxW).toFixed(1) + '">' +
      lvHeatGaugeMarkup(loads, step, gX, gaugeY, barX, barMaxW) + '</g>';

    // 收起按钮:卡片撑开后把 router / expert bank 两个节点都盖住了,再点节点收不回来,
    // 必须在卡片自己身上留一个出口(点击由 bindExpertHeatClose() 在 document 捕获阶段接)。
    var clX = ox + W - 17, clY = oy + 16;
    var closeBtn = '<g class="lv-heat-close" style="cursor:pointer">' +
      '<circle cx="' + clX + '" cy="' + clY + '" r="9" fill="color-mix(in srgb, var(--surface-2) 90%, transparent)" stroke="var(--border-default)" stroke-width="1"></circle>' +
      '<path d="M' + (clX - 3.6) + ' ' + (clY - 3.6) + ' l7.2 7.2 M' + (clX + 3.6) + ' ' + (clY - 3.6) + ' l-7.2 7.2"' +
      ' stroke="var(--foreground-secondary)" stroke-width="1.5" stroke-linecap="round" fill="none"></path>' +
      '<title>收起专家分布图</title></g>';

    // 底板配色对齐「精度/性能」那组曲线图表卡(.twin-accuracy-metric-card:border-subtle +
    // foreground 3% 中性底),不再用 cExpert 黄调 —— 卡片浮在整网图上必须不透明,
    // 所以把那 3% 叠在 --surface-1 上而不是 transparent 上,浅/深色主题都跟着 token 走。
    return (
      '<rect x="' + ox + '" y="' + oy + '" width="' + W + '" height="' + H + '" rx="10"' +
      ' fill="color-mix(in srgb, var(--foreground) 3%, var(--surface-1))" stroke="var(--border-subtle)" stroke-width="1"' +
      ' style="filter:drop-shadow(0 8px 20px rgba(0,0,0,.38))"></rect>' +
      '<text x="' + (ox + padX) + '" y="' + (oy + 20) + '" style="font-size:12.5px;font-weight:800;font-family:system-ui,sans-serif" fill="var(--foreground)">routed experts · ' + LV.routedExperts + ' → EP64(64 卡 × 4)</text>' +
      cardsSvg + hotLabel + gauge + heatLegend + closeBtn
    );
  }

  // 整网图节点的坐标/连线路径是渲染引擎算好后画死的 SVG,节点之间没有"弹性避让"能力。
  // 这里做轻量的近似位移:卡片撑开后,几何上会被卡片包围盒盖住的邻居节点顺着"卡片中心→
  // 节点中心"的方向被推到卡片外(只挪必要的那一侧,不做真正的重新布局);连到这些被挤开的
  // 节点、或连到 routed_expert_bank 自身的连线位置对不上了,展开期间先淡出,收起时淡回,
  // 位置和普通视图完全一致。
  function collectRoutedExpertNeighbors(stage, group) {
    var m = (group.getAttribute("transform") || "").match(/translate\(([-\d.]+)[,\s]+([-\d.]+)\)/);
    var selfTx = m ? parseFloat(m[1]) : 0;
    var selfTy = m ? parseFloat(m[2]) : 0;
    var halfW = EXPAND_W / 2, halfH = EXPAND_H / 2, gap = 18;
    var neighbors = [];
    stage.querySelectorAll("[data-node-id]").forEach(function (el) {
      var id = el.getAttribute("data-node-id");
      if (!id || id === "routed_expert_bank") return;
      var rect = el.querySelector("rect");
      if (!rect) return;
      var w = parseFloat(rect.getAttribute("width") || "0");
      var h = parseFloat(rect.getAttribute("height") || "0");
      if (!w || !h) return;
      var mm = (el.getAttribute("transform") || "").match(/translate\(([-\d.]+)[,\s]+([-\d.]+)\)/);
      if (!mm) return;
      var tx = parseFloat(mm[1]), ty = parseFloat(mm[2]);
      var relX = tx - selfTx, relY = ty - selfTy;
      var overX = (halfW + w / 2 + gap) - Math.abs(relX);
      var overY = (halfH + h / 2 + gap) - Math.abs(relY);
      if (overX > 0 && overY > 0) {
        neighbors.push({ el: el, id: id, tx: tx, ty: ty, relX: relX, relY: relY, overX: overX, overY: overY });
      }
    });
    return neighbors;
  }

  function pushRoutedExpertNeighborsAway(stage, group) {
    var neighbors = collectRoutedExpertNeighbors(stage, group);
    var touchIds = ["routed_expert_bank"];
    neighbors.forEach(function (n) {
      // 从较窄的越界轴挤开(节点更贴近卡片左右两侧就横推,更贴近上下就竖推),避免同时对角挪动显得乱
      var dx = 0, dy = 0;
      if (n.overX < n.overY) dx = (n.relX >= 0 ? 1 : -1) * n.overX;
      else dy = (n.relY >= 0 ? 1 : -1) * n.overY;
      n.el.dataset.expandOrigTransform = n.el.getAttribute("transform") || "";
      n.el.dataset.expandPushed = "routed_expert_bank";
      n.el.style.transition = "transform 260ms cubic-bezier(.2,.7,.2,1)";
      n.el.setAttribute("transform", "translate(" + (n.tx + dx).toFixed(1) + "," + (n.ty + dy).toFixed(1) + ")");
      touchIds.push(n.id);
    });
    touchIds.forEach(function (id) {
      stage.querySelectorAll('[data-source="' + id + '"], [data-target="' + id + '"]').forEach(function (edge) {
        edge.style.transition = "opacity 200ms ease";
        edge.style.opacity = "0";
        edge.dataset.expandDimmed = "routed_expert_bank";
      });
    });
  }

  function restoreRoutedExpertNeighbors(stage) {
    if (!stage) return;
    stage.querySelectorAll('[data-expand-pushed="routed_expert_bank"]').forEach(function (el) {
      el.style.transition = "transform 220ms ease";
      el.setAttribute("transform", el.dataset.expandOrigTransform || el.getAttribute("transform") || "");
      delete el.dataset.expandPushed;
      delete el.dataset.expandOrigTransform;
    });
    stage.querySelectorAll('[data-expand-dimmed="routed_expert_bank"]').forEach(function (edge) {
      edge.style.opacity = "";
      delete edge.dataset.expandDimmed;
    });
  }

  function showRoutedExpertBankExpand() {
    if (window.PtoTwinGraphAdapter) {
      routedExpertExpandActive = true;
      window.PtoTwinGraphAdapter.showExpertExpand(buildExpertBankExpandMarkup, startExpertHeat);
      return;
    }
    var stage = document.getElementById("graphStage");
    if (!stage) return;
    var group = stage.querySelector('[data-node-id="routed_expert_bank"]');
    if (!group || !group.parentNode) return;
    // 先清掉可能残留的旧实例、还原上一次的邻居位移(不经过 hideRoutedExpertBankExpand,
    // 避免它把下面刚设的 active 标记又清掉),再按当前布局重新计算一遍位移,幂等、不会累积漂移。
    document.querySelectorAll('[data-node-expand="routed_expert_bank"]').forEach(function (el) { el.remove(); });
    restoreRoutedExpertNeighbors(stage);
    routedExpertExpandActive = true;
    var NS = "http://www.w3.org/2000/svg";
    var wrap = document.createElementNS(NS, "g");
    wrap.setAttribute("class", "pto-node-expand-card");
    wrap.setAttribute("data-node-expand", "routed_expert_bank");
    // 与节点挂在同一个父级、复用节点自身的 translate,跟随整网图 pan/zoom 一起走;
    // 追加为最后一个子节点保证画在最上层,不被相邻节点/连线遮挡。
    wrap.setAttribute("transform", group.getAttribute("transform") || "");
    wrap.innerHTML = buildExpertBankExpandMarkup();
    group.parentNode.appendChild(wrap);
    // 256 专家负载热力动画:与「模型层展开图」共用同一个 startExpertHeat() 驱动器
    startExpertHeat(wrap);
    // 卡片比原节点大得多,几何上会盖住的邻居节点顺势挤开,让"节点变大"看起来更像真实的展开
    pushRoutedExpertNeighborsAway(stage, group);
    // model-graphviz-embed/pattern.js 用 ResizeObserver 盯着 #graphStage 容器尺寸,只要没有
    // selectedItemId 就在尺寸变化(比如展开 Timeline dock 挤压整网图高度)时自动 fit() 回默认视图,
    // 会把上面 applyDiagnosisFocus 刚做的聚焦平移冲掉。这里借 selectNode 钉住 selectedItemId
    // 抑制这次自动回位;selectNode 会联动弹出 opv-modelviz 自带的节点详情浮层(#nodePopover),
    // 这不是本卡片要的效果,借完 pin 效果立即把它关掉。
    var svg = stage.querySelector("svg");
    var vctrl = svg && svg.ptoModelGraphvizController;
    if (vctrl && vctrl.selectNode) {
      vctrl.selectNode("routed_expert_bank");
      var popover = stage.querySelector("#nodePopover");
      if (popover) popover.hidden = true;
    }
  }

  // 点 router 节点 = 开/关 256 专家负载热力卡片。整网图重建后节点是新的 DOM,
  // 用 data-routerExpandBound 去重,避免同一个节点被绑多次。
  function bindRouterExpandToggle(nodeEl) {
    if (!nodeEl || nodeEl.dataset.routerExpandBound) return;
    nodeEl.dataset.routerExpandBound = "1";
    nodeEl.style.cursor = "pointer";
    if (!nodeEl.querySelector("title")) {
      var hint = document.createElementNS("http://www.w3.org/2000/svg", "title");
      hint.textContent = "展开 / 收起 256 专家负载热力";
      nodeEl.appendChild(hint);
    }
    nodeEl.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleRoutedExpertBankExpand();
    });
  }

  // 卡片撑开后有 560×210,把 router 与 expert bank 两个节点连同邻居一起盖住/淡出,
  // 于是"再点一次收起"点不着了 —— 卡片右上角自带一个 × ,由 document 捕获阶段兜底监听
  // (两条渲染路径共用同一份卡片 markup,监听放在这里就都覆盖到了,不必各绑一次)。
  function bindExpertHeatClose() {
    var inClose = function (t) { return !!(t && t.closest && t.closest(".lv-heat-close")); };
    // 整网图(deck / opv 两套)都在容器上用 pointerdown + setPointerCapture 做拖拽平移。
    // 捕获一旦生效,浏览器会把随后的 click 派发到捕获元素而不是真正被点的元素,卡片上的 ×
    // 就永远收不到 click。这里在 document 捕获阶段先把落在 × 上的 pointerdown 截断,
    // 让容器的拖拽逻辑压根不启动,click 才能正常落到 × 上。
    document.addEventListener("pointerdown", function (e) {
      if (inClose(e.target)) e.stopPropagation();
    }, true);
    document.addEventListener("click", function (e) {
      if (!inClose(e.target)) return;
      e.stopPropagation();
      e.preventDefault();
      hideRoutedExpertBankExpand();
    }, true);
  }

  function toggleRoutedExpertBankExpand() {
    if (routedExpertExpandActive) hideRoutedExpertBankExpand();
    else showRoutedExpertBankExpand();
  }

  function hideRoutedExpertBankExpand() {
    routedExpertExpandActive = false;
    lastHeatStep = null;   // 下次展开重新按当前 step 着色
    if (window.PtoTwinGraphAdapter) { window.PtoTwinGraphAdapter.hideExpertExpand(); return; }
    var stage = document.getElementById("graphStage");
    document.querySelectorAll('[data-node-expand="routed_expert_bank"]').forEach(function (el) { el.remove(); });
    restoreRoutedExpertNeighbors(stage);
    var svg = stage && stage.querySelector("svg");
    var vctrl = svg && svg.ptoModelGraphvizController;
    if (vctrl && vctrl.clearSelection) vctrl.clearSelection();
  }

  // opv-modelviz.js 的 centerView()(挂在 window resize 上)会无条件 fit() 回默认视图、
  // 并重新弹出它自己的节点详情浮层,不受 selectedItemId 影响——凡是会派发 resize 的动作
  // (展开/收起 Timeline dock、切换「全局/实时监控」整网图视图……)都会把刚钉好的聚焦平移和
  // routed_expert_bank 卡片冲掉。opv-modelviz.js 先于本文件加载,这里的 resize 监听注册在
  // 它之后,同一次 resize 事件里保证后触发,借此把聚焦平移和卡片重新钉回去。
  window.addEventListener("resize", function () {
    if (!routedExpertExpandActive) return;
    applyDiagnosisFocus("moe-a2a");
    showRoutedExpertBankExpand();
    pinDiagnosisLocator("moe-a2a"); // applyDiagnosisFocus 会先把顶栏问题定位卡片隐藏,这里配套重新钉回去
  });

  function hideDiagnosisLocator() {
    const locator = $("diagnosisLocator");
    if (locator) locator.classList.remove("is-visible");
  }

  function showDiagnosisLocator() {
    const locator = $("diagnosisLocator");
    if (locator) locator.classList.add("is-visible");
  }

  // 用 caseKey 填充并钉住顶栏「问题定位」卡片。applyDiagnosisFocus() 内部每次都会先无条件
  // hideDiagnosisLocator() 再交给调用方决定要不要重新显示,所以凡是重新调用了 applyDiagnosisFocus
  // 的地方(含下面 resize 重新钉回聚焦的分支)都必须配套调用本函数,否则卡片会被那次隐藏静默冲掉。
  function pinDiagnosisLocator(caseKey) {
    var marker = diagnosisMarkers.find(function (m) { return m.key === caseKey; });
    var info = diagnosisCases[caseKey];
    var locator = $("diagnosisLocator");
    if (locator && info && marker) {
      $("diagnosisLocatorTitle").textContent = marker.label || "";
      $("diagnosisLocatorLayerTag").textContent = info.layer || "";
      $("diagnosisLocatorCategoryTag").textContent = marker.category || "";
      var sevEl = $("diagnosisLocatorSeverityTag");
      sevEl.textContent = (marker.severity || "").toUpperCase();
      sevEl.className = "twin-diagnosis-locator-severity is-" + (marker.severity || "");
      $("diagnosisLocatorDesc").textContent = marker.sub || "";
      locator.title = marker.sub || "";
      // 「详情与修复建议」按钮打开的是本问题的定位链长文抽屉;没有长文的问题(见 v2 页 DRAWER_CASES)
      // 直接把按钮藏掉,而不是让它错开成另一个问题的详情。
      locator.dataset.caseKey = caseKey;
      var drawerBtn = $("diagnosisLocatorDrawerBtn");
      if (drawerBtn) drawerBtn.hidden = !(window.hasLocateDrawer && window.hasLocateDrawer(caseKey));
      showDiagnosisLocator();
    }
  }

  // ── 热力图 infra 问题高亮 ─────────────────────────────────────────────────
  var INFRA_HEAT_MAP = {
    "moe-a2a":           { hotCells: [23], warmCells: [16,17,18,19,20,21,22],
                           hotWarn: "空等 · all-to-all send/recv 死锁,阻塞其余 rank",
                           warmWarn: "空等 · all-to-all 超时,等待 rank 23 迟迟不返回" },
    "nvlink":            { hotCells: [19, 20], warmCells: [16,17,18,21,22,23],
                           hotWarn: "空等 · HCCS 链路掉线,HCCL 回退 RoCE 慢路径",
                           warmWarn: "空等 · PP pipeline 被慢路径拖住,等待上游数据" },
    // 问题二(显存 OOM):rank 17 先触顶 OOM 中断,同 PP stage 3 的其余 rank 也都在 61~63 GB 逼近红线
    "mem-oom":           { hotCells: [17], warmCells: [16,18,19,20,21,22,23],
                           hotWarn: "OOM · ACL_ERROR_MEMORY_ALLOCATION,峰值触顶 64/64 GB",
                           warmWarn: "逼近上限 · 显存 61~63 GB,同样处于 OOM 边缘" },
  };

  function applyInfraHeatHighlight(caseKey) {
    clearInfraHeatHighlight();
    var map = INFRA_HEAT_MAP[caseKey];
    if (!map) return;
    (map.hotCells || []).forEach(function (idx) {
      var cell = $("heat").querySelector('.twin-heat-cell[data-index="' + idx + '"]');
      if (cell) cell.classList.add("is-infra-hot");
    });
    (map.warmCells || []).forEach(function (idx) {
      var cell = $("heat").querySelector('.twin-heat-cell[data-index="' + idx + '"]');
      if (cell) cell.classList.add("is-infra-warm");
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
      bindLocateInfraHeatBubble(dst); // 悬浮气泡(展示 rank 内容,复用监控栏 data-tip)只需绑定一次
    }
    for (var i = 0; i < srcCells.length; i++) {
      var s = srcCells[i], d = dstCells[i];
      if (!d) continue;
      d.className = s.className;            // util-low/mid/high、thermal、straggler 等
      d.style.cssText = s.style.cssText;    // EP 底色 + util 描边 + PP 分界
      d.dataset.tip = s.dataset.tip || ""; // 镜像监控栏的 rank 悬浮内容(node/rank/util/温度/HBM/DP·Stage·EP)
      d.classList.remove("is-infra-hot", "is-infra-warm"); // 标记由下方按本问题重新叠加
      delete d.dataset.tipWarn;            // 上一问题的「空等」红字先清掉
    }
    var map = INFRA_HEAT_MAP[caseKey];
    if (!map) return;
    (map.hotCells || []).forEach(function (idx) {
      var cell = dst.querySelector('.twin-heat-cell[data-index="' + idx + '"]');
      if (!cell) return;
      cell.classList.add("is-infra-hot");
      if (map.hotWarn) cell.dataset.tipWarn = map.hotWarn;
    });
    (map.warmCells || []).forEach(function (idx) {
      var cell = dst.querySelector('.twin-heat-cell[data-index="' + idx + '"]');
      if (!cell) return;
      cell.classList.add("is-infra-warm");
      if (map.warmWarn) cell.dataset.tipWarn = map.warmWarn;
    });
  }

  // infra层集群图悬浮气泡:复用监控栏 data-tip 的 rank 内容,有问题的 rank 再补一行「空等」红字。
  // CSS ::after 的 attr() 无法给单行上色,故改用挂到 body 的 JS 气泡,跟随光标、不被 overflow 祖先截断。
  var locateInfraBubble = null;
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ensureLocateInfraBubble() {
    if (locateInfraBubble) return locateInfraBubble;
    locateInfraBubble = document.createElement("div");
    locateInfraBubble.className = "locate-infra-bubble";
    locateInfraBubble.hidden = true;
    document.body.appendChild(locateInfraBubble);
    return locateInfraBubble;
  }
  function bindLocateInfraHeatBubble(host) {
    if (!host || host.dataset.bubbleBound) return;
    host.dataset.bubbleBound = "1";
    var bubble = ensureLocateInfraBubble();
    function moveTo(e) {
      var pad = 14;
      var x = e.clientX + pad;
      var y = e.clientY + pad;
      var r = bubble.getBoundingClientRect();
      if (x + r.width > window.innerWidth - 8) x = e.clientX - pad - r.width;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - pad - r.height;
      bubble.style.left = Math.max(8, x) + "px";
      bubble.style.top = Math.max(8, y) + "px";
    }
    host.addEventListener("mousemove", function (e) {
      var cell = e.target.closest && e.target.closest(".twin-heat-cell");
      if (!cell || !cell.dataset.tip) { bubble.hidden = true; return; }
      var html = escapeHtml(cell.dataset.tip).replace(/\n/g, "<br>");
      if (cell.dataset.tipWarn) {
        html += '<div class="locate-infra-bubble__warn">' + escapeHtml(cell.dataset.tipWarn) + "</div>";
      }
      bubble.innerHTML = html;
      bubble.hidden = false;
      moveTo(e);
    });
    host.addEventListener("mouseleave", function () { bubble.hidden = true; });
  }

  // 点击后进入「聚焦」模式:命中节点/连线保持不透明,整网图其余部分淡出到 50%
  function applyDiagnosisFocus(caseKey) {
    var info = diagnosisCases[caseKey];
    clearDiagnosisFocus();
    applyInfraHeatHighlight(caseKey);
    highlightProblemBadge(caseKey);
    if (!info) { hideDiagnosisLocator(); return; }
    if (window.PtoTwinGraphAdapter) {
      window.PtoTwinGraphAdapter.focus(caseKey, info);
      hideDiagnosisLocator();
      return;
    }
    var stage = document.getElementById("graphStage");
    if (stage) {
      stage.classList.add("is-diagnosis-focus");
      info.nodeIds.forEach(function(id) { markNodeActive(stage, id, "pto-diagnosis-focus-active"); });
      info.edges.forEach(function(e) { markEdgeActive(stage, e[0], e[1], "pto-diagnosis-focus-active"); });
      (info.clusterIds || []).forEach(function(cid) { markClusterActive(stage, cid, "pto-diagnosis-focus-active"); });
      // 自动平移画布，让问题相关节点（含所属 cluster）居中显示
      panToProblemNodes(stage, info.nodeIds, info.clusterIds || []);
    }
    hideDiagnosisLocator();
  }

  // 将画布平移到问题命中节点/Cluster 的中心区域，以 cluster 边界为主精准缩放
  function panToProblemNodes(stage, nodeIds, clusterIds) {
    if ((!nodeIds || !nodeIds.length) && (!clusterIds || !clusterIds.length)) return;
    var svg = stage.querySelector("svg");
    if (!svg) return;
    // 从 opv-modelviz 的 state 获取 controller（挂载在 svg 上）
    var ctrl = svg.ptoModelGraphvizController;
    if (!ctrl) return;
    var bounds = null;
    var expand = function(x, y, w, h) {
      if (!bounds) { bounds = { x1: x, y1: y, x2: x + w, y2: y + h }; }
      else {
        bounds.x1 = Math.min(bounds.x1, x);
        bounds.y1 = Math.min(bounds.y1, y);
        bounds.x2 = Math.max(bounds.x2, x + w);
        bounds.y2 = Math.max(bounds.y2, y + h);
      }
    };

    // 1) 优先取 cluster 的边界框（cluster 已经包含其内部所有子节点，精准代表"整个框"）
    if (clusterIds && clusterIds.length) {
      clusterIds.forEach(function(cid) {
        var cluster = stage.querySelector('[data-cluster-id="' + cid + '"]');
        if (!cluster) return;
        var rect = cluster.querySelector("rect");
        if (!rect) return;
        var x = parseFloat(rect.getAttribute("x") || "0");
        var y = parseFloat(rect.getAttribute("y") || "0");
        var w = parseFloat(rect.getAttribute("width") || "0");
        var h = parseFloat(rect.getAttribute("height") || "0");
        if (w > 0 && h > 0) expand(x, y, w, h);
      });
    }

    // 2) 再补上独立节点（不在任何命中 cluster 内的散点）
    (nodeIds || []).forEach(function(id) {
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
      expand(tx + x, ty + y, w, h);
    });

    if (!bounds) return;
    var cx = (bounds.x1 + bounds.x2) / 2;
    var cy = (bounds.y1 + bounds.y2) / 2;
    var stageW = stage.clientWidth, stageH = stage.clientHeight;
    // 四周留白（SVG viewport 坐标）：上下各 40px，左右各 60px 让红框不会贴边
    var padX = 60, padY = 40;
    var zoom = Math.min(stageW / (bounds.x2 - bounds.x1 + padX * 2), stageH / (bounds.y2 - bounds.y1 + padY * 2), 1.8);
    zoom = Math.max(0.25, Math.min(2.6, zoom));
    ctrl.setTransform({ zoom: zoom, tx: stageW / 2 - cx * zoom, ty: stageH / 2 - cy * zoom });
  }

  // ── wzh 单屏页面专属:点击「时光机」上的问题标记时,不走 training-monitoring.html
  // 那套「问题诊断卡片 → 定位链整块视图」下钻,而是原地把单屏各图表都联动到该问题的事故时刻——
  // 时光机拖块跳到事故 step(驱动精度/infra 图表与关键指标一并回放)、整网图聚焦命中节点、
  // infra 热力图叠加该问题的 rank 标注、底部 Timeline 面板展开,相当于原地复现事故时刻的全部细节。
  //
  // 每个问题额外的「就位动作」写在 PROBLEM_LENS_ENTER 里(如问题一要原地展开 routed_expert_bank),
  // 不再往本函数里堆 if (caseKey === ...) 分支。
  var PROBLEM_LENS_ENTER = {
    // 问题一:精准展开 routed_expert_bank 单节点(而不是下钻整块「模型层展开图」页面),
    // 全局/实时监控视图下都要看到,故不受 .twin-live-on 隐藏问题徽标的规则影响。
    "moe-a2a": function () { showRoutedExpertBankExpand(); },
    // 问题二(显存 OOM):举证图全在底部 dock「性能」页签里(6 张,见 js/training-memory-panel.js),
    // 进来就切过去 —— 否则默认停在 Timeline 页签,聚光灯第一步要照亮的卡还是隐藏的。
    "mem-oom": function () {
      window.PtoTrainingTwinDockTabs?.select("perf");
      window.PtoTrainingMemoryPanel?.renderSoon();
    },
  };

  function activateProblemLens(caseKey) {
    var marker = diagnosisMarkers.find(function (m) { return m.key === caseKey; });
    // 先展开 Timeline dock 面板再做整网图聚焦平移——PtoTrainingTwinDockTabs.select("timeline")
    // 会派发一次 window resize,opv-modelviz 的 centerView() 监听 resize 会无条件把画面 fit()
    // 回默认视图;顺序上让这次 resize 先发生,下面的 applyDiagnosisFocus 才是最后生效的那次。
    // 展开 Timeline dock 本身还会异步挤压整网图容器高度,触发 pattern.js 内部另一个
    // ResizeObserver 的自动 fit()——这一个由 showRoutedExpertBankExpand() 里钉住的
    // selectedItemId 抑制,并且下面注册的全局 resize 监听兜底把任何后续 resize 引发的
    // 重置都重新纠正回来。
    window.PtoTrainingTwinTimelineDock?.setVisible(true);
    window.PtoTrainingTwinDockTabs?.select("timeline");
    applyViewStep(marker && marker.step != null ? marker.step : INCIDENT_STEP);
    applyDiagnosisFocus(caseKey);
    // 问题聚焦时关掉整网图默认的「算子染色」类别底色,避免跟诊断命中节点的红色描边互相抢视觉焦点;
    // 退出时光机(exitTimeMachine)会恢复打开。
    window.setOpColorMode?.("off");
    // 整网图侧视图的「训练过程动画」定格:进了问题定位链就是在复盘一件已经发生完的事故,
    // 层还在一层层点亮、指标还在往前描点会读成"训练正在跑"。退出时光机时解除。
    window.PtoTwinGraphAdapter?.setFrozen?.(true);
    if (PROBLEM_LENS_ENTER[caseKey]) { try { PROBLEM_LENS_ENTER[caseKey](); } catch (e) {} }
    pinDiagnosisLocator(caseKey);
    // 进入问题时默认开启「聚光灯定位链」覆盖层(js/training-spotlight.js):按步进照亮各层举证图表,
    // 顶栏问题卡被其名片遮住,读全文仍走名片「详情」→ window.openLocateDrawer 抽屉。
    window.PtoTrainingSpotlight?.open(caseKey);
  }

  // 定位链数据:对应 定位链.md 中三个案例各自实际走过的链路节点
  const locateChains = {
    "moe-a2a": {
      title: "定位链 · Router 数值溢出 → 路由塌缩 → NaN+死锁双发",
      meta: "路径:迭代层 → 日志/plog诊断层 → 通信调度层 → 模型层 → 数值层 → 熔断/预警层 → infra层 → 超参/代码层 → 止损链路总览",
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
        { label: "日志/plog诊断层", short: "plog→可读诊断", sub: "TRANSLATE · 报错说人话，穿插在后续每层排查中",
          content: `
            <p class="twin-locate-metric-note" style="margin:0 0 8px">此层不改变定位方向，而是穿插在后续每一步排查中，解决"报错看不懂、plog 有信息但 Python 侧不显示"的痛点——这里单独演示一次。</p>
            <p class="twin-locate-metric-note"><strong>现象</strong>：step ${INCIDENT_STEP} 训练中断，Python 侧仅报 <code>RuntimeError: NCCL timeout in all-to-all</code>，无法直接定位原因。若无翻译层，用户需要 ① 去 Device 侧 grep plog → ② 看不懂 HCCL/corner ops 报错 → ③ 逐层找框架负责人/算子开发 → 链路 2~7 天。</p>
            <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden;margin:10px 0">
              <div style="padding:8px 12px;background:var(--surface-2);font-size:11px;font-weight:600;color:var(--foreground);font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace">$ grep -i "error\\|timeout\\|mismatch" /var/log/npu/plog/plog_*.log</div>
              <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:10px 12px;background:var(--surface-1);overflow-x:auto;color:var(--foreground-secondary)">
                <div>[hcom_all_to_all_v_] rank=23 send_count=0 recv_count=9832 <span style="color:#dc2626">buffer size mismatch</span></div>
                <div>[aclnnSoftmaxV2] input[router_logits] contains <span style="color:#dc2626">inf</span> values</div>
              </div>
            </div>
            <p class="twin-locate-metric-note"><strong>翻译</strong>：① rank 23 的 <code>dist.all_to_all</code> send buffer 为空，但期望接收 9832 个 token 的数据——buffer 大小不匹配导致死锁；② <code>router.forward</code> 中的 <code>F.softmax(router_logits)</code> 收到了 inf 输入——上游 router_logits 在 FP8 下溢出。</p>
            <div style="overflow-x:auto;margin:10px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">Ascend C / plog 内部名</th><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">torch_npu / PyTorch 可见接口</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-family:ui-monospace,monospace">hcom_all_to_all_v_</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)"><code>dist.all_to_all</code>（通信库）</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-family:ui-monospace,monospace">aclnnSoftmaxV2</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)"><code>F.softmax</code>（<code>router.forward</code> 中调用）</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-family:ui-monospace,monospace">aclnnMatmulV3</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)"><code>F.linear</code>（router 的 Linear 层）</td></tr>
              </table>
            </div>
            <p class="twin-locate-metric-note"><strong>产出</strong>：翻译后的可读诊断 + 关联调用位置——<code>model.layers.38.mlp.router.forward</code> 中的 <code>F.softmax(router_logits)</code> 收到了 inf 输入，两条线索共同指向【通信调度层】的 rank 23 死锁表象与【数值层】的 router 溢出根因。</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ 已给出方向，进入【通信调度层】核实 rank 23 的 all-to-all 超时细节。</p>
          ` },
        { label: "分叉判定", sub: "仅多卡异常 · 切入通信分支", branch: true },
        { label: "通信调度层", short: "EP rank 23", sub: "WHY(通信) · EP rank 23 all-to-all 死锁",
          content: `<div class="opv-swim-embed" data-problem-one-timeline title="NCCL trace: node2 ranks 16-23, rank 23 all-to-all timeout"></div><p style="margin:10px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">识别 EP rank 23（node2 GPU 7）在 <code>all-to-all</code> 调用处超时（30s timeout）。该调用时间上定位到 layer 38 MoE 的 expert dispatch 阶段。对比各 rank 的 send/recv buffer size：rank 23 的 send=0（没有 token 被 router 分发到其他 rank 的 expert），recv≈9832 token，size 不匹配导致死锁。</p><p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5"><strong>EP=64 切分校验</strong>：256 个 expert 均匀分配到 64 个 EP rank，每个 rank 名义上承载 4 个 expert，切分看似均匀（256/64=4）。但当前 rank 23 的 send=0、recv≈9832 → <strong style="color:#dc2626">所有 token 被 router 判定应全部送往 rank 23 的 4 个 expert</strong>，其余 252 个 expert 无 token 流入，EP 切分名义均匀、实际塌缩为 1 个 rank 在工作，63 个 rank 空等。</p><p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">死锁只是"果"，需继续追"因"——为什么 router 会把几乎所有 token 分配给 rank 23 的 expert 193？↳ 需在【模型层】提取 step ${INCIDENT_STEP} 各层 router 的 token-to-expert 分配统计。</p>` },
        { label: "模型层", short: "layer 38", sub: "WHERE · layer 38 router 98% token 倾斜到 expert 193",
          content: `
            <div class="twin-layerview-cta" data-open-layer-view data-lv-expanded="38" data-lv-hot-expert="193" role="button" tabindex="0">
              <div class="twin-layerview-cta-text">
                <strong>layer 38 · MoE 层展开图</strong>
                <span>router→expert 分发与 rank 23 all-to-all 死锁动画 · 点击在整网图区域查看</span>
              </div>
              <span class="btn btn-solid btn-sm twin-layerview-cta-btn">查看</span>
            </div>
            <p class="twin-locate-metric-note">layer 38 的 router 将当前 micro-batch 中 98% 的 token 路由到了 expert 193(恰好位于 EP rank 23)，其余 255 个 expert 中 <strong style="color:#dc2626">247 个为 dead expert(0 token)</strong>——这是路由彻底塌缩，不是普通倾斜。</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">对比分析收发数据， layer 38 每个 rank 的 all-to-all send/recv buffer size 对比如下图：</p>
            <canvas id="bufChart" style="width:100%;height:168px;margin:6px 0 0;display:block;background:var(--surface-2);border-radius:6px"></canvas>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">rank 23 的 send buffer 为 0（没有 token 被 router 分发到其他 rank 的 expert），recv buffer 期望接收大量 token 数据，size 不匹配导致死锁——但死锁只是果。</p>
            <p class="twin-locate-metric-note">↳ 需在【数值层】追查 router 的精度路径——为什么 softmax 输出会退化为 one-hot？</p>
          ` },
        { label: "数值层", short: "FP8 softmax 溢出", sub: "WHICH(数值) · router logits max=1846→inf, FP8 softmax 溢出",
          content: `
            <p class="twin-locate-metric-note" style="margin:0 0 8px">此层是定位链的<strong style="color:var(--highlight-copy-blue-500, #3b6fe0)">核心转折点</strong>：从"通信怎么死的"下钻到"数值为什么先崩了"。</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px 0 10px">
              <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:10px 12px;background:var(--surface-2)">
                <div style="font-size:11px;color:var(--foreground-muted)">router logits max</div>
                <div style="font-size:22px;font-weight:700;color:#dc2626;font-family:ui-monospace,monospace;margin-top:4px">1846</div>
                <div style="font-size:11px;color:var(--foreground-muted);margin-top:2px">正常应 &lt;50</div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:10px 12px;background:var(--surface-2)">
                <div style="font-size:11px;color:var(--foreground-muted)">AMP loss scale</div>
                <div style="font-size:22px;font-weight:700;color:#dc2626;font-family:ui-monospace,monospace;margin-top:4px">65536→4096</div>
                <div style="font-size:11px;color:var(--foreground-muted);margin-top:2px">持续衰减=溢出前兆</div>
              </div>
            </div>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">dump step ${INCIDENT_STEP} 时 layer 38 router 的 raw logits（softmax 之前），发现 max(logits)=<strong style="color:#dc2626">1846</strong>，且存在 inf 值——FP8 E4M3 下 exp(1846) 直接溢出为 inf。</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">检查 router 计算精度路径：当前实现中 router 的 softmax 在 <strong style="color:#dc2626">FP8</strong> 下计算（<code>router_logits → FP8 cast → softmax</code>），而非业界建议的 FP32。AMP scaler 日志显示 loss scale 从 step 15000 起从 65536 持续衰减至 step 15202 的 4096，说明训练已处于持续 FP 溢出的临界状态。</p>
            <p style="margin:10px 0 0;font-size:12px;color:var(--foreground);font-weight:600;line-height:1.5">判据：FP8 下 router logits 溢出 → softmax 产生 NaN/inf → 路由概率退化 → top-k 集中于 expert 193 → <strong style="color:#dc2626">同时触发两个后果</strong>：A) NaN 沿 forward 传播到 loss；B) 所有 token 路由到 rank 23 → all-to-all 死锁。死锁和 NaN 是同一 root cause 的两个平行后果，而非因果关系。</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ AMP scaler 这条衰减轨迹从 step 15000 起就已持续报警——如果被实时监控，能否在 loss NaN 前拦截？见【熔断/预警层】。</p>
          ` },
        { label: "熔断/预警层", short: "scaler 65536→4096", sub: "GUARD · 能否在 NaN 前拦截？",
          content: `
            <p class="twin-locate-metric-note" style="margin:0 0 8px">此层回答一个关键问题：<strong>精度异常真的只能等到 loss NaN 才知道吗？</strong> 复盘本案例的 AMP loss-scale 衰减轨迹——它从 step 15000 起就已持续报警，只是当时无人监控。</p>
            <svg viewBox="0 0 300 150" style="width:100%;height:auto;display:block;margin:8px 0" preserveAspectRatio="xMidYMid meet">
              <title>AMP loss scale 衰减轨迹：step 15000(65536) → step 15202(4096) → step 15203(loss NaN)</title>
              <line x1="16" y1="70" x2="292" y2="70" stroke="#ca8a04" stroke-width="1" stroke-dasharray="3 3" opacity="0.75"/>
              <text x="14" y="67" text-anchor="end" font-size="7.5" fill="#ca8a04" font-family="ui-monospace,monospace">🟡1/4</text>
              <line x1="16" y1="110" x2="292" y2="110" stroke="#ea580c" stroke-width="1" stroke-dasharray="3 3" opacity="0.75"/>
              <text x="14" y="107" text-anchor="end" font-size="7.5" fill="#ea580c" font-family="ui-monospace,monospace">🟠1/16</text>
              <polyline points="28,30 76,50 124,70 172,90 220,110 246,110" fill="none" stroke="var(--highlight-copy-blue-500,#3b6fe0)" stroke-width="1.6"/>
              <line x1="246" y1="110" x2="270" y2="136" stroke="#dc2626" stroke-width="1.6" stroke-dasharray="2 2"/>
              <circle cx="28" cy="30" r="3" fill="var(--highlight-copy-blue-500,#3b6fe0)"/>
              <circle cx="76" cy="50" r="3" fill="var(--highlight-copy-blue-500,#3b6fe0)"/>
              <circle cx="124" cy="70" r="3.6" fill="#ca8a04"/>
              <circle cx="172" cy="90" r="3" fill="#ca8a04"/>
              <circle cx="220" cy="110" r="3.6" fill="#ea580c"/>
              <circle cx="246" cy="110" r="3" fill="#ea580c"/>
              <circle cx="270" cy="136" r="4" fill="#dc2626"/>
              <text x="28" y="21" text-anchor="middle" font-size="7.5" fill="var(--foreground-secondary)" font-family="ui-monospace,monospace">65536</text>
              <text x="76" y="41" text-anchor="middle" font-size="7.5" fill="var(--foreground-secondary)" font-family="ui-monospace,monospace">32768</text>
              <text x="124" y="61" text-anchor="middle" font-size="7.5" fill="#ca8a04" font-family="ui-monospace,monospace">16384</text>
              <text x="172" y="81" text-anchor="middle" font-size="7.5" fill="var(--foreground-secondary)" font-family="ui-monospace,monospace">8192</text>
              <text x="220" y="101" text-anchor="middle" font-size="7.5" fill="#ea580c" font-family="ui-monospace,monospace">4096</text>
              <text x="246" y="122" text-anchor="middle" font-size="7" fill="var(--foreground-muted)">末窗</text>
              <text x="282" y="132" text-anchor="start" font-size="7.5" fill="#dc2626" font-weight="700" font-family="ui-monospace,monospace">loss NaN</text>
              <text x="28" y="146" text-anchor="middle" font-size="7.5" fill="var(--foreground-muted)">15000</text>
              <text x="76" y="146" text-anchor="middle" font-size="7.5" fill="var(--foreground-muted)">15050</text>
              <text x="124" y="146" text-anchor="middle" font-size="7.5" fill="var(--foreground-muted)">15100</text>
              <text x="172" y="146" text-anchor="middle" font-size="7.5" fill="var(--foreground-muted)">15150</text>
              <text x="220" y="146" text-anchor="middle" font-size="7.5" fill="var(--foreground-muted)">15200</text>
              <text x="270" y="146" text-anchor="middle" font-size="7.5" fill="#dc2626" font-weight="700">15203</text>
            </svg>
            <div style="overflow-x:auto;margin:10px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">预警级别</th><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">触发条件</th><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">自动动作</th><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">本案例</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🟡 注意</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">scaler 降至初始值 1/4（65536→16384）</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">记录日志，通知 on-call，不中断训练</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#ca8a04;font-weight:600">step 15100 触发</td></tr>
                <tr style="background:#fff7ed"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">🟠 警告</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">scaler 降至初始值 1/16（65536→4096）或 grad_norm 连续 50 step 翻倍</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:600">自动 dump 当前 step 激活张量 + router logits，发告警</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#ea580c;font-weight:700">step 15200 触发——最后的拦截窗口</td></tr>
                <tr style="background:#fef2f2"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">🔴 熔断</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">scaler &lt; 初始值 1/32 或 grad_norm=inf 或 loss=NaN</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:600">立即停训，保存 checkpoint，释放资源，通知值班</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">step 15203 loss NaN 才触发——已经晚了</td></tr>
              </table>
            </div>
            <p class="twin-locate-metric-note"><strong>复盘时间线</strong>：15000 scaler=65536（健康）→ 15050 32768（临近🟡）→ 15100 16384（🟡 首次越线）→ 15150 8192（逼近🟠）→ <strong style="color:#ea580c">15200 4096（🟠 越线——应触发自动 dump，最后的拦截窗口）</strong> → 15202 loss=3.1 仍正常（距 NaN 只差 1 step）→ <strong style="color:#dc2626">15203 loss NaN（🔴 熔断级，但无人监控）</strong>。</p>
            <p class="twin-locate-metric-note">若在 step 15150（🟡→🟠 临界）就人工介入排查止损，到 step 15203 NaN 共可提前 <strong>53 step</strong>：53 step × 2048 NPU × ¥2/卡时 ≈ <strong style="color:#dc2626">¥21.7 万</strong>；若是万卡集群同等模式，同样量级的空跑将是百万元级损失。</p>
            <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden;margin-top:10px">
              <div style="padding:8px 12px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--foreground)">产出 · monitor_config.yaml 熔断规则建议</div>
              <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:10px 12px;background:var(--surface-1);overflow-x:auto">
                <div style="background:rgba(22,163,74,.1);color:#16a34a">+ amp_scaler_warn_ratio: <strong>0.25</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># 降至初始值 1/4 → 🟡 通知 on-call</span></div>
                <div style="background:rgba(22,163,74,.1);color:#16a34a">+ amp_scaler_dump_ratio: <strong>0.0625</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># 降至初始值 1/16 → 🟠 自动 dump 激活张量+router logits</span></div>
                <div style="background:rgba(22,163,74,.1);color:#16a34a">+ amp_scaler_abort_ratio: <strong>0.03125</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># 降至初始值 1/32 → 🔴 立即停训，释放资源</span></div>
              </div>
            </div>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ 熔断只是止损，不是根因——继续进入【infra层】看这次单点溢出如何扩散到全集群。</p>
          ` },
        { label: "infra层", short: "EP rank 23", sub: "CONTEXT · EP rank 23 / PP stage 3",
          // infra 示意图完全复用外层「训练监控 · infra」的集群热力图(#heat 的 DP8×PP4×EP64 网格),
          // 由 syncLocateInfraHeat() 把当前 util 着色镜像到 #locateInfraHeat,再叠加本问题的 hot/warm 标记。
          content: `
            <div class="twin-infra-heat-block">
              <p style="margin:0 0 8px;font-size:11px;color:var(--foreground-secondary);line-height:1.5">AMP scaler 衰减在全部 64 rank 上同步发生，但 <strong style="color:#dc2626">only rank 23</strong> 因 expert 193 的地理位置成为死锁的"引爆点"——如果 expert 193 位于其他 rank，只会换一个 rank 触发死锁。问题聚集在单个 EP rank → 局部路由塌缩，但根因（router FP8 overflow）是系统性的。</p>
              <div id="locateInfraHeat" class="twin-heat locate-infra-heat"></div>
              <div class="twin-legend" style="margin-top:8px;font-size:11px">
                <span><i class="twin-swatch twin-swatch-util-low"></i>&lt;70% util</span>
                <span><i class="twin-swatch twin-swatch-util-mid"></i>70-92% util</span>
                <span><i class="twin-swatch twin-swatch-util-high"></i>&gt;92% util</span>
                <span style="display:inline-flex;align-items:center;gap:5px"><i style="width:10px;height:10px;border-radius:2px;outline:2px solid #dc2626;outline-offset:1px"></i>EP rank 23 死锁</span>
                <span style="display:inline-flex;align-items:center;gap:5px"><i style="width:10px;height:10px;border-radius:2px;outline:2px solid #ea580c;outline-offset:1px"></i>EP 16–22 空等</span>
              </div>
            </div>
            <p class="twin-locate-metric-note" style="margin-top:12px"><strong>错误扩散路径</strong>：这是典型的"单点故障 → 全局扩散"模式——报错位置 ≠ 根因位置。</p>
            <div style="display:flex;flex-direction:column;gap:6px;margin:8px 0;font-size:11px;line-height:1.5">
              <div style="padding:6px 10px;border-radius:6px;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;font-weight:600">① EP rank 23 router softmax FP8 overflow（数值层根因）</div>
              <div style="text-align:center;color:var(--foreground-muted);font-size:10px">↓</div>
              <div style="padding:6px 10px;border-radius:6px;background:#fff7ed;border:1px solid #fed7aa;color:#ea580c;font-weight:600">② rank 23 的 expert 193 吸收 98% token → all-to-all send=0 / recv≈9832 死锁</div>
              <div style="text-align:center;color:var(--foreground-muted);font-size:10px">↓</div>
              <div style="padding:6px 10px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border-subtle);color:var(--foreground)">③ all-to-all 是同步屏障操作 → 其余 63 个 EP rank 全部卡在 barrier 上空等</div>
              <div style="text-align:center;color:var(--foreground-muted);font-size:10px">↓</div>
              <div style="padding:6px 10px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border-subtle);color:var(--foreground)">④ rank 23 所属 PP stage 3 断裂 → 全部 4 个 PP stage 相互等待</div>
              <div style="text-align:center;color:var(--foreground-muted);font-size:10px">↓</div>
              <div style="padding:6px 10px;border-radius:6px;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;font-weight:600">⑤ 2048 NPU 全部 hang，30s 后 NCCL timeout 报错——报的是"通信 timeout"而非"router 溢出"</div>
            </div>
            <p class="twin-locate-metric-note">关键教训：在 512+ rank 的大规模训练中，一个 rank 的数值溢出可通过 gather/all-to-all 扩散到数百 rank，必须自动做跨 rank 的首因定位，而非人工逐一比对几百张卡的日志。</p>
          ` },
        { label: "超参/代码层", short: "6 处代码改动", sub: "FIX · router 改 FP32 + z-loss + 降 lr + grad clip + n_group + 超时延长",
          content: `
            <p class="twin-locate-metric-note" style="margin:0 0 12px">根因是 router softmax 在 FP8 下计算 + 缺乏 logits 正则化。按优先级修改如下：</p>
            <div style="display:flex;flex-direction:column;gap:12px;">
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:8px 12px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--foreground)">① router.py · softmax 改 FP32（最关键）</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:10px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− router_logits = router(x); probs = softmax(router_logits)&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># FP8 下 logits 溢出</span></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ router_logits = <strong>router(x.float())</strong>; probs = <strong>softmax(router_logits)</strong></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ probs = probs.to(dtype)&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># softmax 在 FP32 计算后再 cast 回</span></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:8px 12px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--foreground)">② training_args.yaml · z-loss + grad clip</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:10px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ z_loss_coeff: <strong>1e-4</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># gate 前加 z-loss 抑制 logits 极端值</span></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ clip_grad_norm: <strong>1.0</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># MoE 训练标配</span></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:8px 12px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--foreground)">③ optimizer_config.json · router 学习率</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:10px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− router_lr: <strong>3e-4</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># 与 expert 相同</span></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ router_lr: <strong>3e-5</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># expert lr × 0.1</span></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:8px 12px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--foreground)">④ model_config.json · n_group 辅助保障</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:10px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− "n_group": <strong>8</strong>,</div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ "n_group": <strong>16</strong>,&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># 分散 expert 选择,辅助保障</span></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:8px 12px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--foreground)">⑤ env.sh · NCCL 超时兜底</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:10px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− export NCCL_IB_TIMEOUT=<strong>30</strong></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ export NCCL_IB_TIMEOUT=<strong>60</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># 训练不中断兜底</span></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:8px 12px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--foreground)">⑥ monitor_config.yaml · 部署熔断规则</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:10px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ amp_scaler_dump_ratio: <strong>0.0625</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># scaler 降至初始值 1/16 → 🟠 自动 dump（见【熔断/预警层】三级阈值）</span></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ amp_scaler_abort_ratio: <strong>0.03125</strong>&nbsp;&nbsp;<span style="color:var(--foreground-muted);font-family:system-ui"># scaler 降至初始值 1/32 → 🔴 立即停训</span></div>
                </div>
              </div>
            </div>
            <p style="margin:12px 0 0;font-size:12px;color:#16a34a;font-weight:600;line-height:1.5">验证：①~④ 从 step 15000 续跑，router logits max 稳定在 18~35（安全范围），AMP scaler 维持在 65536 不衰减，256 expert 的 token CV 降至 8~15%。step 15203 正常通过，继续训练 5000 step 无 NaN 无死锁。⑥ 熔断规则纳入监控后，同类衰减轨迹将在 step 15200 附近被自动 dump 拦截，不必再等到 loss NaN。</p>
          ` },
        { label: "止损链路总览", short: "30 分钟 vs 2~7 天", sub: "SUMMARY · 从 loss NaN 到修复上线的完整时间线",
          content: `
            <p class="twin-locate-metric-note" style="margin:0 0 10px">汇总本案例从"表象"到"修复"走过的全部 8 层，看这条定位链把原本 2~7 天的排查压缩到了哪里。</p>
            <div style="overflow-x:auto;margin:10px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">阶段</th><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">事件</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);white-space:nowrap">🔍 发现</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">step 15203 loss NaN，训练中断</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);white-space:nowrap">📋 日志翻译</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">plog 翻译 → <code>dist.all_to_all</code> send/recv 不匹配 + <code>F.softmax</code> 输入 inf</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);white-space:nowrap">🔀 分叉判定</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">单卡重跑正常，多卡复现 NaN → 切入通信分支</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);white-space:nowrap">📡 通信调度</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">rank 23 all-to-all timeout，send=0/recv≈9832 → EP 切分校验失败</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);white-space:nowrap">🧠 模型层</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">expert 193 收到 98% token，247 个 dead expert → 路由塌缩</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);white-space:nowrap">🔢 数值层</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">router logits max=1846，FP8 softmax → inf，AMP scaler 65536→4096</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);white-space:nowrap">🛡️ 熔断预警</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">复盘：若 step 15200 部署 🟠 自动 dump，可在 loss NaN 前捕获证据止损</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);white-space:nowrap">🌐 扩散分析</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">rank 23 单点溢出 → all-to-all barrier → 64 EP rank 全卡 → PP pipeline 断裂</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle);white-space:nowrap">🔧 修复</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">6 项修改（softmax FP32 + z-loss/grad clip + router lr + n_group + 超时兜底 + 熔断规则），5000 step 验证通过</td></tr>
              </table>
            </div>
            <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
              <div style="flex:1;min-width:140px;border:1px solid var(--border-subtle);border-radius:8px;padding:10px 12px;background:var(--surface-2)">
                <div style="font-size:11px;color:var(--foreground-muted)">无工具 / 无经验</div>
                <div style="font-size:20px;font-weight:700;color:#dc2626;margin-top:4px">2~7 天</div>
                <div style="font-size:11px;color:var(--foreground-muted);margin-top:2px">看不懂报错 → 逐层找人 → 定位 → 修复</div>
              </div>
              <div style="flex:1;min-width:140px;border:1px solid var(--border-subtle);border-radius:8px;padding:10px 12px;background:var(--surface-2)">
                <div style="font-size:11px;color:var(--foreground-muted)">按本定位链 + plog 翻译 + 熔断</div>
                <div style="font-size:20px;font-weight:700;color:#16a34a;margin-top:4px">~30 分钟</div>
                <div style="font-size:11px;color:var(--foreground-muted);margin-top:2px">翻译即时 → 分叉 5min → 通信层 5min → 模型/数值层 10min → 修复 10min</div>
              </div>
            </div>
          ` },
      ],
      // 单/多卡均异常时会绕过「通信调度层」直接从迭代层进入模型层,用弧形虚线标出这条未被走到的旁路
      // (索引按非 branch 节点计数:0=迭代层 1=日志/plog诊断层 2=通信调度层 3=模型层)
      bypass: [{ from: 0, to: 3 }],
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
      meta: "路径:性能表征层 → 瓶颈分类层(计算受限) → 阶段定位层 → 算子定位层 → 执行效率层 → 代码/配置层",
      steps: [
        { label: "性能表征层", short: "T_iter 12.1s", sub: "WHEN · 稳态步耗时 12.1s,超标 42%,MFU 38%",
          content: `
            <p class="twin-locate-metric-note" style="margin:0 0 10px">128 GPU(16 节点 × 8 GPU)训练 openPangu-2.0-Flash，<strong>EP=64 / PP=4 / TP=1 / FP8</strong>，seq_len=4096，micro_batch=1，global_batch=1024。目标步耗时 ≤ 8.5s，实测 <strong style="color:#dc2626">12.1s</strong>。</p>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:2px 0 10px">
              <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:10px 12px;background:var(--surface-2)">
                <div style="font-size:11px;color:var(--foreground-muted)">步耗时 T_iter</div>
                <div style="font-size:22px;font-weight:700;color:#dc2626;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;margin-top:4px">12.1<small style="font-size:12px;color:var(--foreground-muted)">s</small></div>
                <div style="font-size:11px;color:#dc2626;margin-top:2px">目标 ≤8.5s · +3.6s(+42%)</div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:10px 12px;background:var(--surface-2)">
                <div style="font-size:11px;color:var(--foreground-muted)">MFU</div>
                <div style="font-size:22px;font-weight:700;color:#dc2626;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;margin-top:4px">38<small style="font-size:12px;color:var(--foreground-muted)">%</small></div>
                <div style="font-size:11px;color:#dc2626;margin-top:2px">目标 ≥50% · −12pp</div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:10px 12px;background:var(--surface-2)">
                <div style="font-size:11px;color:var(--foreground-muted)">PHS 评分</div>
                <div style="font-size:22px;font-weight:700;color:#dc2626;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;margin-top:4px">D<small style="font-size:12px;color:var(--foreground-muted)">(32)</small></div>
                <div style="font-size:11px;color:var(--foreground-muted);margin-top:2px">性能健康度</div>
              </div>
            </div>
            <p class="twin-locate-metric-note"><strong>判据</strong>：步耗时超基线 &gt; 40% + MFU &lt; 40% → 显著性能劣化，非调度抖动。</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ 需在【瓶颈分类层】从 <code>step_trace_time.csv</code> 拆解计算/通信/空泡占比，判定走计算分支还是通信分支。</p>
          ` },
        { label: "分叉判定", sub: "计算受限 · Computing 78% > 60% · 沿计算主干", branch: true },
        { label: "阶段定位层", short: "stage3 1.82×", sub: "WHERE · PP stage 3 Computing 2152ms,过载 1.82×",
          content: `
            <p class="twin-locate-metric-note">从 <code>step_trace_time.csv</code> 提取整步耗时构成——计算绝对主导，通信虽有占比但非主因，判定 <strong>计算受限，走计算分支</strong>：</p>
            <div style="display:flex;height:26px;border-radius:6px;overflow:hidden;border:1px solid var(--border-subtle);font-size:10px;font-weight:600;color:#fff;margin:6px 0 4px">
              <div style="flex:78;background:#3b6fe0;display:flex;align-items:center;justify-content:center" title="Computing 9422ms">Computing 78%</div>
              <div style="flex:11;background:#ea580c;display:flex;align-items:center;justify-content:center" title="PP bubble ≈1337ms">Bubble 11%</div>
              <div style="flex:9;background:#8b5cf6;display:flex;align-items:center;justify-content:center" title="未掩盖通信 1093ms">通信 9%</div>
              <div style="flex:2;background:#94a3b8;display:flex;align-items:center;justify-content:center" title="Free 248ms">2%</div>
            </div>
            <p class="twin-locate-metric-note" style="margin:2px 0 12px;font-size:11px">Computing 9422ms(78%) · PP bubble ≈1337ms(11%) · 未掩盖通信 1093ms(9%) · Free 248ms(2%)</p>
            <p class="twin-locate-metric-note">再看 Pipeline 时序泳道图，按 PP stage 0~3 拆分 Computing 段耗时。<strong style="color:#dc2626">末级 stage 3</strong>（layers 34~45 + final_layernorm + lm_head + loss）严重过载：</p>
            <div style="display:flex;flex-direction:column;gap:5px;margin:8px 0">
              ${[["stage 0","1310","embedding + L0~7","#64748b",1310],["stage 1","1180","L8~13 MoE","#64748b",1180],["stage 2","1180","L14~19 MoE","#64748b",1180],["stage 3","1180","L20~25 MoE","#64748b",1180],["stage 4","1180","L26~31 MoE","#64748b",1180],["stage 5","1180","L32~37 MoE","#64748b",1180],["stage 6","1180","L38~43 MoE","#64748b",1180],["stage 7","2152","+ lm_head + loss","#dc2626",2152]].map(([s,ms,note,color,val])=>`
                <div style="display:flex;align-items:center;gap:8px;font-size:11px">
                  <span style="flex:0 0 52px;color:var(--foreground-muted);font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace">${s}</span>
                  <div style="flex:1;background:var(--surface-2);border-radius:4px;overflow:hidden;height:16px"><div style="width:${(val/2152*100).toFixed(0)}%;height:100%;background:${color}"></div></div>
                  <span style="flex:0 0 56px;text-align:right;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;color:${color==='#dc2626'?'#dc2626':'var(--foreground-secondary)'};font-weight:${color==='#dc2626'?'700':'400'}">${ms}ms</span>
                  <span style="flex:0 0 118px;color:var(--foreground-muted);font-size:10px">${note}</span>
                </div>`).join("")}
            </div>
            <p class="twin-locate-metric-note"><strong>判据</strong>：stage 7 耗时 / 中间 stage 均值 = 2152 / 1180 ≈ <strong style="color:#dc2626">1.82×</strong> → 末级严重过载；stage 0~6 在 stage 7 计算段期间空等，PP bubble ≈ 1337ms。</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ 需在【算子定位层】拆解 stage 7 的算子 parent-child 表（<code>op_statistic.csv</code>），定位到具体过载算子。</p>
          ` },
        { label: "算子定位层", short: "cube_util 49%", sub: "WHAT · lm_head MatMulV2 cube_util 49% + CE loss AICPU 526ms",
          content: `
            <p class="twin-locate-metric-note">stage 7 算子按总耗时降序（<code>op_statistic.csv</code>，device 6）。MatMul 占比虽高但属正常计算，关键异常在 <strong style="color:#dc2626">lm_head 的 cube 利用率</strong> 与 <strong style="color:#dc2626">CE loss 的 AICPU 回退</strong>：</p>
            <div style="overflow-x:auto;margin:6px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">算子</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">耗时</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">占比</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">诊断</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">MatMulV3（QKV/o_proj + fc1/fc2）</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace">5936ms</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">63%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🟢 cube_util 78~82% 正常</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">FlashAttentionScore + Grad</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace">723ms</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">7.7%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🟢 MLA core_attention</td></tr>
                <tr style="background:#fef2f2"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">↳ lm_head MatMulV2 [4096,2560]×[151552,2560]</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;color:#dc2626;font-weight:700">544ms</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">5.8%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">🔴 cube_util 仅 49%（预期 75%）</td></tr>
                <tr style="background:#fef2f2"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">CE loss 链路（Exp/Sub/RealDiv/ArgMax/ReduceSum）</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;color:#dc2626;font-weight:700">526ms</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">5.6%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">🔴 手写算子链 · AICPU 回退</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">ApplyAdamWV2 / LpNormV2（优化器）</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace">64ms</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.7%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🟢 BF16 状态,正常范围</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">RmsNorm ×92 + 残差/杂项</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace">560ms</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">5.9%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🟢 Add/Mul/Cast/Slice</td></tr>
              </table>
            </div>
            <p class="twin-locate-metric-note"><strong>产出</strong>：两个问题算子 —— ① <code>lm_head MatMulV2</code>（vocab 非对齐 → 带宽瓶颈，cube_util 49% vs 预期 75%）；② <code>CE loss 链路</code>（Exp/Sub/RealDiv/ArgMax/ReduceSum 合计 526ms，走 AICPU 回退）。</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ 需在【执行效率层】用 Roofline + Timeline 判定这两个算子的根因归类（带宽瓶颈 / AICPU 回退）。</p>
          ` },
        { label: "执行效率层", short: "带宽瓶颈", sub: "WHY · lm_head memory-bound(vocab 尾块非对齐) + CE 手写链 AICPU 回退",
          content: `
            <p class="twin-locate-metric-note" style="margin:0 0 6px;font-weight:600;color:var(--foreground)">① lm_head 带宽瓶颈（Roofline memory-bound）</p>
            <p class="twin-locate-metric-note"><code>kernel_details</code> 中 lm_head MatMulV2 <code>cube_util=49%</code>。DRAM 访存 ≈ 输入 4096×2560×2 + 权重 151552×2560×2 + 输出 4096×151552×2 ≈ <strong>2.0GB</strong>；H800 HBM 带宽 3.35TB/s，纯带宽耗时 ≈ 0.60ms，而实测 <strong style="color:#dc2626">8.5ms/call × 64 microbatch = 544ms</strong> → Roofline 落在 <strong style="color:#dc2626">memory-bound 区</strong>。根因：vocab=151552 的 tile 粒度与 hidden=2560 的 K 维不匹配，GEMM 尾块效率折半。</p>
            <p class="twin-locate-metric-note" style="margin:14px 0 6px;font-weight:600;color:var(--foreground)">② CE loss 的 AICPU 串行链路</p>
            <p class="twin-locate-metric-note">Timeline 中 lm_head 后有 5 个 vector 算子串行排列，每个算子间有 60~100μs 的 launch gap：</p>
            <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:8px 0;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:10px">
              ${["Exp 128ms","Sub 126ms","RealDiv 125ms","ReduceSum 75ms","ArgMax 72ms"].map((op,i)=>`
                <span style="padding:5px 9px;border-radius:5px;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;font-weight:600">${op}</span>${i<4?`<span style="color:var(--foreground-muted)">→</span>`:""}`).join("")}
              <span style="color:var(--foreground-muted);margin-left:6px">= 526ms · 5 次 HBM 读写往返</span>
            </div>
            <p class="twin-locate-metric-note">若替换为 <code>F.cross_entropy</code>（路由到 <code>aclnnSoftmaxCrossEntropyWithLogits</code> 融合实现），融合后仅 1 个 kernel，消除 5 次 HBM 往返与 launch gap。</p>
            <p class="twin-locate-metric-note" style="margin-top:12px"><strong>判据</strong>：lm_head → 带宽瓶颈（memory-bound），vocab 尾块未对齐导致 cube_util 折半；CE loss → 手写算子链 × AICPU 回退；其余算子（MatMul / FA / RmsNorm）正常。合计可优化 ≈ 750ms。</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ 需在【代码/配置层】把根因映射到具体修改项。</p>
          ` },
        { label: "代码/配置层", short: "3 处改动", sub: "FIX · lm_head tiling 调优 + CE loss 融合 + BF16 优化器",
          content: `
            <p class="twin-locate-metric-note" style="margin:0 0 12px"><strong style="color:var(--foreground)">诊断总结</strong>：lm_head vocab 尾块非对齐致带宽瓶颈 + CE loss 手写算子链走 AICPU 回退，共同拉高 stage 7 负载，拖累整网 MFU 至 38%。</p>
            <div style="display:flex;flex-direction:column;gap:10px">
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:7px 12px;background:var(--surface-2);font-size:12px;font-weight:600">① lm_head tiling 调优（针对 vocab=151552 手工 tile）</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="color:var(--foreground-muted)">&nbsp;&nbsp;# vocab=151552 已对齐 256(151552/256=592)，但 K=hidden 2560 tile 划分不友好</div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;lm_head.set_matmul_tiling(cube_tile=(256, 128), vec_tile=256)&nbsp;<span style="color:var(--foreground-muted)"># 手工指定尾块 tile</span></div>
                  <div style="color:var(--foreground-muted)">&nbsp;&nbsp;# 预期 cube_util 49% → 72%，耗时 544ms → 约 370ms（↓174ms）</div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:7px 12px;background:var(--surface-2);font-size:12px;font-weight:600">② CE loss 融合（消除 AICPU 回退）</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− &nbsp;p = softmax(logits); loss = -(labels * log(p)).sum()&nbsp;<span style="color:var(--foreground-muted)"># 手写 5 段 AICPU/Vector</span></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;loss = F.cross_entropy(logits, labels, ignore_index=pad_id)&nbsp;<span style="color:var(--foreground-muted)"># → aclnnSoftmaxCrossEntropyWithLogits 融合</span></div>
                  <div style="color:var(--foreground-muted)">&nbsp;&nbsp;# 预期 526ms → 约 50ms（↓476ms）</div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:7px 12px;background:var(--surface-2);font-size:12px;font-weight:600">③ 优化器 BF16 状态（openPangu-2.0-Flash 默认已启用）</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="color:var(--foreground-muted)">&nbsp;&nbsp;use_distributed_optimizer: True&nbsp;&nbsp;# 已启用,ApplyAdamWV2 显存/耗时已减半,无需修改</div>
                </div>
              </div>
            </div>
            <p class="twin-locate-metric-note" style="margin:12px 0 6px;font-weight:600;color:var(--foreground)">验证结果（①+② 叠加）</p>
            <div style="overflow-x:auto;margin:6px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle)">指标</th><th style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">修改前</th><th style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a">修改后</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">步耗时 T_iter</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">12100ms</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">10350ms（↓14.5%）</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">MFU</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">38%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">45%</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">lm_head cube_util</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">49%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">72%</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">AICPU 耗时占比</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">7.2%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">1.5%</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">PHS 评分</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">D(32)</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#16a34a;font-weight:600">C+(55)</td></tr>
              </table>
            </div>
            <p class="twin-locate-metric-note" style="margin-top:8px">若要进一步达到 50%+ MFU，需配合 PP bubble 优化（interleaved 1F1B + 层数分配）。</p>
          ` },
      ],
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
            <p class="twin-locate-metric-note">锁定 layer 35 为异常层后，dump step 32000 时该层各关键张量，绘制数值分布直方图与 BF16 baseline 叠图对比：</p>
            <div class="locate-dist-grid">
              <div class="locate-dist-cell"><h4>q_b_proj 输入（MLA 低秩 latent）</h4><canvas id="case6DistQnope"></canvas><div class="note">BF16：N(0.12, 1.45)。FP8：严重右偏 skewness=+1.8，<span style="color:#dc2626">6.8% clip@448</span></div></div>
              <div class="locate-dist-cell"><h4>core_attention 输出</h4><canvas id="case6DistAttn"></canvas><div class="note">BF16：多模态 方差 0.85。FP8：<span style="color:#dc2626">主峰塌缩至[-0.3,0.3]</span>，方差→0.21</div></div>
              <div class="locate-dist-cell"><h4>gate_up 输出（FFN 中间激活）</h4><canvas id="case6DistGate"></canvas><div class="note">BF16：[-12,15] 自然长尾。FP8：<span style="color:#dc2626">双侧 ±448 截断，12.4% clip</span></div></div>
            </div>
            <p class="twin-locate-metric-note" style="margin:6px 0"><strong>三张分布图一致揭示</strong>：FP8 E4M3 动态范围（max=448）无法容纳深层激活值自然长尾。三阶段退化：激活值右偏 → attention 信息坍缩 → FFN 截断饱和。</p>

            <p class="twin-locate-metric-note" style="margin:14px 0 6px;font-weight:600;color:var(--foreground)">宏观统计指标（step 32000 vs BF16 baseline）</p>
            <div style="overflow-x:auto;margin:6px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">张量</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">指标</th><th style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">FP8</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">BF16</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">诊断含义</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)" rowspan="7">q_b_proj 输入</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Mean</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">+2.41</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">+0.12</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">均值右偏 → 向 FP8 正上限漂移</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Std</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">3.82</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">1.45</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">标准差扩大 2.6×</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Skewness</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">+1.83</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">+0.08</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">严重右偏</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)"><strong>Kurtosis</strong></td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">+7.42</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">-0.12</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">高峰度 = 重尾+尖峰</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Outlier Ratio (>3σ)</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">8.7%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.9%</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">离群率 ~10× baseline</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">p99</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#ea580c;font-weight:600">378.4</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">4.12</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">p99 逼近 FP8 max=448</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">p99.9</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">447.8 (clip)</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">4.89</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">最强 0.1% 激活完全丢失</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)" rowspan="2">core_attn 输出</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Std</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:600">0.21</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.85</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">方差 1/4 — 区分度丧失</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">KL Divergence</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">2.31 bits</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">分布根本性变化</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)" rowspan="2">gate_up 输出</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Quantization SNR</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">6.8 dB</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">42.1 dB</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">信号被噪声严重污染</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">Kurtosis</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">+15.3</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">+0.45</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">极端 — "尖峰+截断双尾"</td></tr>
              </table>
            </div>
            <p class="twin-locate-metric-note"><strong style="color:var(--foreground)">🔑 峰度（Kurtosis）最关键</strong>：-0.12→+15.3，"尖峰+截断双尾"是低精训练退化的<strong>典型数值指纹</strong>。</p>

            <p class="twin-locate-metric-note" style="margin:14px 0 6px;font-weight:600;color:var(--foreground)">量化风险评估矩阵</p>
            <div style="display:grid;grid-template-columns:130px repeat(3,1fr) 100px;margin:6px 0;font-size:11px;border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
              <div style="padding:5px 8px;background:var(--surface-2);font-weight:600;border-bottom:1px solid var(--border-subtle)">风险维度</div><div style="padding:5px 8px;background:var(--surface-2);font-weight:600;border-bottom:1px solid var(--border-subtle)">q_b_proj</div><div style="padding:5px 8px;background:var(--surface-2);font-weight:600;border-bottom:1px solid var(--border-subtle)">core_attn</div><div style="padding:5px 8px;background:var(--surface-2);font-weight:600;border-bottom:1px solid var(--border-subtle)">gate_up</div><div style="padding:5px 8px;background:var(--surface-2);font-weight:600;border-bottom:1px solid var(--border-subtle)">综合</div>
              <div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)">动态范围适配</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fff7ed;color:#ea580c">⚠️ 临界</span></div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 危险</span></div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 危险</span></div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 高风险</span></div>
              <div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)">QSNR</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)">18.3 dB</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle);color:#dc2626;font-weight:600">11.5 dB</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle);color:#dc2626;font-weight:700">6.8 dB</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 <10dB 不可用</span></div>
              <div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)">KL 散度</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)">0.87 bits</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle);color:#dc2626;font-weight:600">2.31 bits</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle);color:#dc2626;font-weight:700">3.45 bits</div><div style="padding:5px 8px;border-bottom:1px solid var(--border-subtle)"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 >1 bit 显著偏移</span></div>
              <div style="padding:5px 8px">梯度可恢复性</div><div style="padding:5px 8px"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fefce8;color:#ca8a04">🟡 部分可恢复</span></div><div style="padding:5px 8px"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 不可恢复</span></div><div style="padding:5px 8px"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 不可恢复</span></div><div style="padding:5px 8px"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:#fef2f2;color:#dc2626">🔴 需结构性修改</span></div>
            </div>

            <p class="twin-locate-metric-note" style="margin:14px 0 6px;font-weight:600;color:var(--foreground)">算子误差定位</p>
            <div class="locate-canvas-card">
              <div class="locate-canvas-card__head"><span>Layer 35 算子误差瀑布（log₁₀ MSE vs BF16 baseline）</span></div>
              <div class="locate-canvas-card__body"><canvas id="case6OpWaterfallCanvas"></canvas></div>
            </div>
            <div style="overflow-x:auto;margin:6px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle);text-align:left">算子</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">MSE vs BF16</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">变化</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">角色</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">input_layernorm</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">3e-8</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">—</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🟢 正常</td></tr>
                <tr style="background:#fef2f2"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">q_b_proj</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">6e-7 → 4.1e-3</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">⬆ 6800×</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">🔴 首害(MLA 上投影)</td></tr>
                <tr style="background:#fef2f2"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">core_attention</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">4.1e-3 → 1.6e-1</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">⬆ 40×</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">🔴 放大器(softmax)</td></tr>
                <tr style="background:#fef2f2"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">gate_up</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">1.8e-1 → 7.3e-1</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">⬆ 4×</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">放大器(FP8 cast)</td></tr>
              </table>
            </div>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ 首害算子 <code>q_b_proj</code>（MLA Q 路低秩上投影），误差放大链：q_b_proj → softmax（信息抹平）→ gate_up（截断饱和）。需在【误差传递路径】逐层追查偏差起点。</p>
          ` },
        { label: "误差传递路径", short: "L35 拐点 460×", sub: "逐层对比 BF16 基线，发现偏差起点 layer 35",
          content: `
            <p class="twin-locate-metric-note">以 BF16 全精度训练为 baseline，沿 forward 计算图逐层对比 FP8 训练的激活输出，绘制<strong>误差累积曲线</strong>（横轴 layer 1→46，纵轴 log₁₀ MSE）：</p>
            <div class="locate-canvas-card">
              <div class="locate-canvas-card__head"><span>46 层误差累积曲线（log₁₀ MSE vs BF16 baseline，step 32000）</span></div>
              <div class="locate-canvas-card__body"><canvas id="case6MseCurveCanvas"></canvas></div>
            </div>
            <p class="twin-locate-metric-note" style="margin:4px 0">layer 1~25：MSE 1e-7~1e-6 平稳 → layer 26~34：缓慢爬升至 5e-4 → <strong style="color:#dc2626">layer 35：跳跃至 2.3e-1（460×）</strong> → layer 36~41：0.2~0.8 高位震荡 → layer 42~45：飙升至 3.5</p>

            <p class="twin-locate-metric-note" style="margin:12px 0 6px;font-weight:600;color:var(--foreground)">逐层对比详表（偏差起点附近）</p>
            <div style="overflow-x:auto;margin:6px 0">
              <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.5">
                <tr style="background:var(--surface-2)"><th style="padding:4px 8px;border:1px solid var(--border-subtle)">Layer</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">Attn MSE</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">FFN MSE</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">Grad MSE</th><th style="padding:4px 8px;border:1px solid var(--border-subtle)">状态</th></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">33</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">8.2e-7</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">1.1e-6</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">2.3e-6</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🟢</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">34</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">3.5e-6</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">6.8e-6</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">1.2e-5</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🟢 略有抬升</td></tr>
                <tr style="background:#fef2f2"><td style="padding:4px 8px;border:1px solid var(--border-subtle);font-weight:700">35</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">2.3e-1</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">7.3e-1</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626;font-weight:700">1.8e+1</td><td style="padding:4px 8px;border:1px solid var(--border-subtle);color:#dc2626">🔴 偏差起点</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">36</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.41</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.55</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">8.7e+0</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🔴 向下游传播</td></tr>
                <tr><td style="padding:4px 8px;border:1px solid var(--border-subtle)">38</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.45</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">0.78</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">9.1e+0</td><td style="padding:4px 8px;border:1px solid var(--border-subtle)">🔴 误差放大</td></tr>
              </table>
            </div>
            <p class="twin-locate-metric-note" style="margin-top:8px"><strong style="color:var(--foreground)">误差传递因果链</strong>：layer 1~34 FP8 截断累积 → L35 RMSNorm 方差放大 → q_b_proj 6.8% clip@448 → core_attn softmax 信息抹平 → o_proj 噪声>50% → gate_up 双侧 12% clip → L36~45 残差传播 → 全局梯度消失 → loss 反弹</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--foreground-secondary);line-height:1.5">↳ L35 的 Attn 和 FFN 在同一 step 同时爆炸 → 非特定算子 bug，而是该层激活值整体数值分布已超出 FP8 可表示范围。需在【infra层】检查并行策略和 scale 状态。</p>
          ` },
        { label: "infra层", short: "全 64 rank", sub: "CONTEXT · 跨所有 rank 复现，FP8 scale 0.62→0.18，有效 bit 4.5→2.8",
          content: `
            <p class="twin-locate-metric-note">layer 35 属于 PP stage 3（layers 34~45），在所有 64 个 EP rank 上均观测到相同分布偏移。进一步检查 FP8 量化参数：layer 35 的 per-tensor scale 从 step 25000 的 <strong>0.62</strong> 持续下降至 step 32000 的 <strong style="color:#dc2626">0.18</strong>。</p>
            <div class="locate-canvas-card">
              <div class="locate-canvas-card__head"><span>Layer 35 · FP8 per-tensor scale 衰减曲线（step 25000→32000）</span></div>
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
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="color:var(--foreground-muted)">&nbsp;&nbsp;"fp8_quant_mode": "per_tensor",</div>
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− &nbsp;"fp8_quant_mode": <strong>"per_tensor"</strong>,</div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;"fp8_quant_mode": <strong>"hybrid"</strong>,</div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;"fp8_attn_quant": "per_token",&nbsp;&nbsp;<span style="color:var(--foreground-muted)"># q/k/v 每个 token 独立 scale</span></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;"fp8_ffn_quant": "per_channel",&nbsp;<span style="color:var(--foreground-muted)"># FFN 每个 channel 独立 scale</span></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;"fp8_hybrid_threshold_layer": <strong>30</strong>,&nbsp;<span style="color:var(--foreground-muted)"># L30+ 深层启用</span></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:7px 12px;background:var(--surface-2);font-size:12px;font-weight:600">② fp8_cast.py — 动态 scale 上界保护</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− &nbsp;scale = <strong>compute_scale(tensor)</strong></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;scale = <strong>max(compute_scale(tensor), 512.0 / 448.0)</strong>&nbsp;<span style="color:var(--foreground-muted)"># scale ≥ ~1.14，有效 ≥ 4.2 bit</span></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:7px 12px;background:var(--surface-2);font-size:12px;font-weight:600">③ attention.py — 深层启用 BF16 softmax</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:var(--surface-1);overflow-x:auto">
                  <div style="background:rgba(220,38,38,.1);color:#dc2626">− &nbsp;attn_output = softmax(scores, dtype=<strong>torch.float8_e4m3fn</strong>)</div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;dtype = torch.float8_e4m3fn <strong>if layer_idx < 30 else torch.bfloat16</strong></div>
                  <div style="background:rgba(22,163,74,.1);color:#16a34a">+ &nbsp;attn_output = <strong>softmax(scores, dtype=dtype)</strong></div>
                </div>
              </div>
              <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
                <div style="padding:7px 12px;background:var(--surface-2);font-size:12px;font-weight:600">④ training_args.yaml — 梯度 scale 预热</div>
                <div style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:var(--surface-1);overflow-x:auto">
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
  // 问题二 · 显存 OOM:定位链长文由自包含模块 training-memory-case4.js 提供(案例四七层对应七小节),
  // 正文里的三张图与底部 dock「性能」页签共用 PtoTrainingMemoryPanel 的绘制代码。
  if (window.PtoMemCase4) {
    var memChain = window.PtoMemCase4.chain();
    if (memChain) locateChains["mem-oom"] = memChain;
  }

  let locateChainObserver = null;

  // 定位链栏兼作锚点导航:点击/滚动联动点亮对应刀锋、下方内容区块;
  // is-active=当前层(最亮+发光)；is-done=已走过的层(点亮蓝刃)
  function setActiveLocateNode(sectionId) {
    const segs = Array.from(document.querySelectorAll(".twin-locate-seg"));
    const activeIndex = segs.findIndex((seg) => seg.dataset.target === sectionId);
    segs.forEach((seg, i) => {
      seg.classList.toggle("is-active", seg.dataset.target === sectionId);
      seg.classList.toggle("is-done", activeIndex >= 0 && i < activeIndex);
    });
    document.querySelectorAll(".twin-locate-section").forEach((section) => {
      section.classList.toggle("is-active", section.id === sectionId);
    });
  }

  function renderLocateChain(caseKey) {
    const chain = locateChains[caseKey];
    const top = $("locateChainTop");
    const content = $("locateChainContent");
    if (!chain || !top || !content) return;
    top.innerHTML = "";
    content.innerHTML = "";

    // 关卡进度条外壳：一条整体轨道，所有分段挂在里面（一体化 ribbon）
    const track = document.createElement("div");
    track.className = "twin-locate-track";
    top.appendChild(track);

    // 展开出真正会渲染成分段的层,同时记下哪些层前面夹了一个「分叉判定」(该段加分叉标记)
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
      const isBranch = branchBeforeIndex.has(index);

      const seg = document.createElement("div");
      seg.className = "twin-locate-seg" + (index === 0 ? " is-active" : "") + (isBranch ? " is-branch" : "");
      seg.dataset.target = sectionId;
      seg.setAttribute("role", "button");
      seg.setAttribute("tabindex", "0");
      seg.setAttribute("title", step.label + (step.short ? " · " + step.short : ""));
      seg.innerHTML = `
        <span class="twin-locate-seg-label">${step.label}</span>
        ${step.short ? `<span class="twin-locate-seg-sub">${step.short}</span>` : ""}
      `;
      const jumpToSection = () => {
        setActiveLocateNode(sectionId);
        document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      seg.addEventListener("click", jumpToSection);
      seg.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        jumpToSection();
      });
      track.appendChild(seg);

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

  // 同 syncAccCards:批量读完尺寸再批量写,避免逐卡读写交替触发多次同步 layout。
  function syncLocateMetricCharts(force) {
    const pending = [];
    locateMetricCards.forEach((c) => {
      const w = Math.round(c.el.clientWidth || 0);
      const h = Math.round(c.el.clientHeight || 0);
      if (w < 2 || h < 2) return;
      if (!force && c.ctrl && w === c.size.w && h === c.size.h) return;
      pending.push({ c, w, h });
    });
    pending.forEach(({ c, w, h }) => {
      c.size = { w, h };
      c.ctrl = renderMetricChart(c.el, c.cfg, w, h);
    });
  }

  // 「迭代层」专用:在多卡曲线(会跳变为 NaN/inf)之外叠加一条单卡重跑同一 step 的曲线——
  // 单卡不经历 all-to-all,全程健康,用来对照出「仅多卡复现」(定位链.md 115 行·分叉判定)。
  // 只在这里叠加第二条曲线,不改「关键指标」面板本身用的 ACC_CARD_DEFS。
  // 多卡线沿用基础卡的主线蓝紫(LINE_1),叠加的单卡线是"图内第二条线",按统一配色走绿(LINE_2)
  const LOCATE_SINGLE_SERIES = {
    loss: { id: "loss_single", label: "单卡(正常)", key: "loss_single", colorVar: LINE_2 },
    gradnorm: { id: "grad_norm_single", label: "单卡(正常)", key: "grad_norm_single", colorVar: LINE_2 },
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
      // 图例参考「精度」图表:放在标题(head)下方独占一行,而非挤在标题右侧;
      // 仍不用引擎内置图例(会参与图表容器测量,配合 auto-height 越拉越高)
      const card = el.closest(".twin-locate-metric-card");
      if (card) card.insertBefore(buildAccLegend(cfg.series), el);
      locateMetricCards.push({ el, cfg, ctrl: null, size: { w: 0, h: 0 } });
    });
    if (locateMetricCards.length) requestAnimationFrame(() => syncLocateMetricCharts(true));
  }

  // 体现 Pangu 72B 定位链案例一:对比各 EP rank 的 all-to-all send/recv buffer size。
  // 31 个正常 rank send≈recv≈19MB(收发对称);rank 23 send=0(本地 token 全留在本卡 expert 193,
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
    ctx.fillText("layer 38 · 各 EP rank 的 all-to-all send/recv buffer (MB)", padL, 14);

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
      ppStage: 3, ppLabel: "PP stage 3 · layers 34~45",
    },
    "nvlink": {
      node: 2, hotGPUs: [3, 4], warmGPUs: [0, 1, 2, 5, 6, 7],
      label: "node2 放大 · NVLINK GPU3↔GPU4 掉线",
      hotLabel: "GPU 3 & 4 带宽降级", warmLabel: "同节点其余 GPU 受影响",
      ppStage: 2, ppLabel: "PP stage 2↔3 跨 stage p2p 被拖慢",
    },

  };

  var PP_STAGE_COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444"];
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

      // PP stage 行分组色带（每 16 node 一行 stage：64/4=16）
      var NODES_PER_STAGE = 16;
      var STAGE_LAYERS = [[0,11],[12,22],[23,33],[34,45]];
      for (var stage = 0; stage < 4; stage++) {
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
        ctx.fillText("L" + STAGE_LAYERS[stage][0] + "~" + STAGE_LAYERS[stage][1], padL - 4, labelY + 7);
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
      ctx.fillText("全局 2048 GPU · 32 GPU/列 × 64 node/行 · PP stage 行分组（S0~S3，每 16 node）", 12, 12);

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
      { id: "in_norm",   y: 688, h: 30, color: LV_BASE.cExpert, label: "input_layernorm", note: "RmsNorm" },
      { id: "mla",       y: 584, h: 92, color: LV_BASE.cAttn,   label: "MLA 注意力",
        note: ["q_a_proj[2560→1024] + q_b_proj[1024→9216]", "48 heads · d=192 · attn_output→2560"] },
      { id: "post_norm", y: 534, h: 38, color: LV_BASE.cExpert, label: "post_attention_layernorm", note: "RmsNorm · +残差" },
      { id: "router",    y: 488, h: 34, color: LV_BASE.cRoute,  label: "router",
        note: `top-${LV_BASE.topK}/${LV_BASE.routedExperts} · n_group=${LV_BASE.nGroup} · topk_group=${LV_BASE.topkGroup}` },
      { id: "dispatch",  y: 438, h: 38, color: LV_BASE.cRoute,  label: "token dispatch", note: "all-to-all (EP dispatch)" },
      { id: "experts",   y: 222, h: 180, color: LV_BASE.cExpert, label: "expert pool", note: "" }, // 64 卡 × 4 expert 网格,特殊绘制
      { id: "combine",   y: 158, h: 38, color: LV_BASE.cRoute,  label: "token combine", note: "all-to-all (EP combine)" },
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

  /* ── 事故层 256 个 routed expert 的负载热力 ──────────────────────────────────
     为什么用热力而不是连线:top-k 是逐 token 计算的,一个 step 里几万个 token 各自选 8 个专家,
     真要画路由连线就是几十万条,既画不出也读不动,还会被误读成「只有 8 条链路」。改成
     「每个专家格子的色温 ∝ 它承接的 token 量」,一屏 256 格就能把「路由坍缩」讲清楚:
     均衡时整片同色,坍缩后其余 255 格退回冷蓝、只剩一格烫红。
     两个展开入口共用这组函数:「模型层展开图」lvBuildSvg() 与 wzh 单屏的原地展开卡片
     buildExpertBankExpandMarkup(),保证两处的负载口径与配色完全一致。

     负载随 step 变化(所以训练中点开 router 能逐 step 看热力怎么走):
     倾斜度 lvRouteSkew(step) 从「均衡」渐变到「坍缩」,再随修复回落,与页面其它图表
     (loss/grad_norm/z-loss)共用 INCIDENT_STEP / RECOVERY_END 这条时间线。 */

  // step → 路由倾斜度 ∈[0,1]:0=完全均衡,1=98% 全压在一个专家(定位链案例一的事故终态)。
  // 事故不是瞬间发生的——router softmax 低精度溢出是慢慢积累的,所以事故前几千步就开始爬坡;
  // 修复(router 改 FP32 + z-loss + 降 router lr)之后回到接近均衡,但不会绝对平,留一点自然抖动。
  // step 传 null = 不挂时间线,直接给事故终态(定位链/问题详情里的静态举证图用这个口径)。
  const LV_SKEW_CLIMB_FROM = INCIDENT_STEP - 4200;
  // 底噪要足够小:倾斜分量把 98% 压给单个专家,哪怕 5% 的权重也让它拿到 13× 均衡份额、
  // 直接烫红,健康训练下会误读成"一直有个专家过载"。0.002 对应最热专家约 1.5× 均衡,
  // 是正常 MoE 训练该有的轻微不均。
  const LV_SKEW_FLOOR = 0.002;
  function lvRouteSkew(step) {
    if (step == null) return 1;
    if (step >= INCIDENT_STEP && step < RECOVERY_END) return 1;
    if (step >= RECOVERY_END) {
      // 修复(router 改 FP32 + z-loss + 降 router lr)生效后,负载重新摊平。
      // 收敛比 loss 慢一些但同量级:RECOVERY_STEPS(15 步)后再给 300 步把分布拉回底噪。
      const back = clamp((step - RECOVERY_END) / 300, 0, 1);
      return LV_SKEW_FLOOR + (1 - LV_SKEW_FLOOR) * (1 - back);
    }
    if (step <= LV_SKEW_CLIMB_FROM) return LV_SKEW_FLOOR;
    const ramp = clamp((step - LV_SKEW_CLIMB_FROM) / (INCIDENT_STEP - LV_SKEW_CLIMB_FROM), 0, 1);
    return LV_SKEW_FLOOR + (1 - LV_SKEW_FLOOR) * Math.pow(ramp, 2.6);
  }

  // 256 个 routed expert 在给定 step 的 token 份额(和为 1)。
  // 两个分量按倾斜度插值:
  //   · 均衡分量 —— 每专家 ≈1/256,叠一层随 step 缓慢游走的确定性抖动(同一 step 反复渲染结果一致,
  //     但 step 一变热力就跟着变,这正是「逐 step 看热力变化」要的东西);
  //   · 坍缩分量 —— hotExpert 拿 98%,其余 255 个分剩下的 2%。
  function lvExpertLoads(hotExpert, step) {
    const N = LV_BASE.routedExperts;
    const skew = lvRouteSkew(step);
    const s = step == null ? INCIDENT_STEP : step;
    const even = [];
    let evenSum = 0, restSum = 0;
    for (let i = 0; i < N; i += 1) {
      // 三个不同频率的正弦叠加:空间上专家之间有高低,时间上随 step 缓慢漂移。
      // 振幅取到 0.72/0.42/0.2,权重跨度约 0.15~2.3 倍均衡 —— 原来 0.5/0.28 的跨度只有
      // 0.22~1.78 倍,换算成热力档位挤在 t=0.055~0.445 的一小段里,整片看着都是蓝绿、
      // 分不出冷热。第三个高频分量再打散一点,避免正弦叠加出肉眼可见的条纹。
      const v = Math.max(0.15,
        1 + 0.72 * Math.sin(i * 12.9898 + s * 0.013)
          + 0.42 * Math.sin(i * 4.113 + s * 0.037)
          + 0.2 * Math.sin(i * 29.417 + s * 0.021));
      even.push(v);
      evenSum += v;
      if (i !== hotExpert) restSum += v;
    }
    return even.map((v, i) => {
      const balanced = v / evenSum;
      const collapsed = i === hotExpert ? 0.98 : (restSum > 0 ? (0.02 * v) / restSum : 0);
      return balanced * (1 - skew) + collapsed * skew;
    });
  }

  // 负载 → 热力档位 t∈[0,1]。基准取「均衡时每专家 1/256」,4× 基准即打满:
  // 于是均衡态整片恰好落在 t=0.25 的同一档(= 动画的初始同色状态),
  // 坍缩后只有 hotExpert 冲到 1、其余 255 个掉到 ≈0,对比一眼可辨。
  function lvHeatT(load) {
    return Math.max(0, Math.min(1, load / ((1 / LV_BASE.routedExperts) * 4)));
  }
  // 热力色阶:冷(蓝)→ 中(绿)→ 烫(红)。与页面 infra 集群热力图(renderInfraHeatSnapshot 的
  // LOW/MID 蓝→绿)同一套语义色系,顶端再接 cHot 红表示过载,读者在两张图之间不用换尺子。
  // neutral=true(算子染色关闭)时蓝/绿两端压成中性灰蓝,红色诊断信号保留。
  // 调用方显式传 neutral,不隐式读 lvColorMode——单屏展开卡片不参与展开图的染色切换。
  function lvHeatFill(t, neutral) {
    const cold = neutral ? [203, 213, 225] : [147, 197, 253];   // slate-300 / ≈--twin-util-low 蓝
    const mid = neutral ? [148, 163, 184] : [34, 197, 94];      // slate-400 / ≈--twin-util-high 绿
    const hot = [220, 38, 38];                                  // cHot 红
    const a = t <= 0.5 ? cold : mid, b = t <= 0.5 ? mid : hot;
    const p = t <= 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(",")})`;
  }
  // 低负载除了偏蓝,还要暗一档才有层次;但不再压到近乎不可见——蓝/绿/红的色相差本身已经
  // 足够区分,冷端留住可读的蓝比"整片消失"更像一张热力图(幂次<1 让中低段拉开)。
  function lvHeatOpacity(t) { return 0.2 + 0.8 * Math.pow(t, 0.55); }

  // 专家 id ↔ 网格位置。默认按 EP64 连续排布(expert = card*4 + cell);事故层要让倾斜专家落在
  // 页面其它处口径一致的 EP rank 23 首格上(与 lvSelectedExperts 的 hotCard=23/cell=0 对齐),
  // 故把它与该格原本的专家对调,保证 0~255 不重不漏。
  const LV_HOT_SLOT = 23 * 4;
  function lvExpertIdAt(card, cell, hotExpert) {
    const natural = card * 4 + cell;
    if (hotExpert == null) return natural;
    if (natural === LV_HOT_SLOT) return hotExpert;
    if (natural === hotExpert) return LV_HOT_SLOT;
    return natural;
  }

  // 首次揭示:元素带着「均衡同色」初值上屏,首帧之后把真实负载写进行内样式,
  // 由 css/training-run-twin.css 的 .lv-heat-cell(2s transition)演出从同色到热力的过渡。
  // 揭示跑完给网格挂 is-heat-live,把过渡缩到 .6s —— 之后每推进一个 step 都要重新着色一次
  // (见 syncExpertHeatToStep),2s 会跟不上步进节奏、看起来像卡住。
  // 不循环、不占 rAF 句柄,随 innerHTML 重画自然消失。
  const LV_HEAT_REVEAL_MS = 2000;
  function startExpertHeat(host) {
    const cells = Array.from(host.querySelectorAll(".lv-heat-cell"));
    if (!cells.length) return;
    const grids = Array.from(host.querySelectorAll(".lv-heat-grid"));
    const apply = () => cells.forEach((el) => {
      el.style.fill = el.dataset.fill;
      el.style.opacity = el.dataset.op;
    });
    const goLive = () => grids.forEach((g) => g.classList.add("is-heat-live"));
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { apply(); goLive(); return; }   // CSS 里同偏好下已关掉 transition,直接落终态

    // 揭示动画:整片同色 → 2s 过渡到各自的真实负载。
    // 不靠 rAF 排队来"等初值上屏"——卡片是刚 innerHTML 进去的,同一帧里既设初值又设终值,
    // 浏览器会把两次样式合并成一次,过渡直接被吃掉(表现就是一打开已经是终态、没有动画)。
    // 这里显式走一遍标准套路:transition:none 写死初值 → 强制回流让初值真正生效 → 恢复
    // transition 再写终值。无论调用时机在哪一帧,动画都必定播放。
    grids.forEach((g) => g.classList.remove("is-heat-live"));
    cells.forEach((el) => {
      el.style.transition = "none";
      el.style.fill = el.getAttribute("fill");
      el.style.opacity = el.getAttribute("opacity");
    });
    void host.getBoundingClientRect();          // 强制回流:同色初值落地
    cells.forEach((el) => { el.style.transition = ""; });
    apply();
    setTimeout(goLive, LV_HEAT_REVEAL_MS + 60);
    // 卡片是按当前 step 生成的,记下来,免得紧接着的一次 syncExpertHeatToStep() 又原值重写一遍
    // (重写会把刚起步的 2s 揭示动画从头打断)
    if (grids.some((g) => !g.dataset.heatStatic)) lastHeatStep = state.step;
  }

  // ── 聚光灯定位链「模型·数值层」步专用:循环播放"均衡 → 坍缩"过渡 ──────────────
  // 只作用在会跟着卡片走的活网格(排除「模型层展开图」那种钉死终态的 data-heat-static 举证图)。
  // 坍缩态直接读 data-fill/data-op(当前 step 的真实负载);均衡态现算(见 setEven,带自然抖动,
  // 不用整片同色的静态初值)。两态都只改行内 style,不碰 dataset,数据本身全程不动。
  // 不进 rAF、只用一根 setTimeout 链自我调度,stop 时 clearTimeout 即可整链掐断。
  var expertHeatLoopTimer = null;
  function expertHeatLoopGrids() {
    return Array.from(document.querySelectorAll(".lv-heat-grid:not([data-heat-static])"));
  }
  // freeze=false 只清定时器不改画面(startExpertHeatLoop 重启前调用);
  // 默认(freeze 省略/true)额外把画面钉回坍缩终态,与不在该步时页面别处看到的"非常极端"一致。
  function stopExpertHeatLoop(freeze) {
    if (expertHeatLoopTimer) { clearTimeout(expertHeatLoopTimer); expertHeatLoopTimer = null; }
    if (freeze === false) return;
    expertHeatLoopGrids().forEach((g) => {
      var cells = Array.from(g.querySelectorAll(".lv-heat-cell"));
      g.classList.add("is-heat-live");
      cells.forEach((el) => {
        el.style.transition = "none";
        el.style.fill = el.dataset.fill || el.getAttribute("fill");
        el.style.opacity = el.dataset.op || el.getAttribute("opacity");
      });
      void g.getBoundingClientRect();
      cells.forEach((el) => { el.style.transition = ""; });
    });
  }
  var LV_HEAT_LOOP_HOT_MS = 2000, LV_HEAT_LOOP_HOT_HOLD_MS = 1400, LV_HEAT_LOOP_EVEN_HOLD_MS = 500;
  function startExpertHeatLoop() {
    stopExpertHeatLoop(false);   // 先掐掉可能残留的旧循环,画面不动(马上会被下面接管)
    var grids = expertHeatLoopGrids();
    if (!grids.length) return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { stopExpertHeatLoop(); return; }   // 尊重「减少动态效果」,直接停在坍缩终态
    // 均衡态不用 evenFill/evenOp 那个整片同色的静态初值(256 格一个色,循环起来像在演示
    // "开关"而不是"训练")——换成 lvExpertLoads() 自带的跨专家正弦扰动(健康训练本来就有
    // 这点自然不均):取 step=0(落在 lvRouteSkew 的 floor 区间,skew≈0.002 几乎纯均衡分量),
    // 每个专家因此各自落在略有高低的档位上,而不是 256 个格子一模一样的颜色。
    var EVEN_SAMPLE_STEP = 0;
    function setEven() {
      grids.forEach((g) => {
        g.classList.remove("is-heat-live");   // 循环两个方向都走 2s,节奏才看得清
        var hotId = Number(g.dataset.heatHot);
        var neutral = g.dataset.heatNeutral === "1";
        var loads = lvExpertLoads(hotId, EVEN_SAMPLE_STEP);
        g.querySelectorAll(".lv-heat-cell").forEach((el) => {
          var load = loads[Number(el.dataset.e)];
          var t = load == null ? lvHeatT(1 / LV_BASE.routedExperts) : lvHeatT(load);
          el.style.fill = lvHeatFill(t, neutral);
          el.style.opacity = lvHeatOpacity(t).toFixed(3);
        });
      });
    }
    function setHot() {
      grids.forEach((g) => {
        g.classList.remove("is-heat-live");
        g.querySelectorAll(".lv-heat-cell").forEach((el) => {
          el.style.fill = el.dataset.fill || el.getAttribute("fill");
          el.style.opacity = el.dataset.op || el.getAttribute("opacity");
        });
      });
    }
    // 首帧不带过渡地定格在「均衡」,避免从当前(可能已是上一次的坍缩终态)直接跳读成一次瞬移
    grids.forEach((g) => { g.querySelectorAll(".lv-heat-cell").forEach((el) => { el.style.transition = "none"; }); });
    setEven();
    void grids[0].getBoundingClientRect();
    grids.forEach((g) => { g.querySelectorAll(".lv-heat-cell").forEach((el) => { el.style.transition = ""; }); });
    function cycle(hot) {
      if (hot) setHot(); else setEven();
      expertHeatLoopTimer = window.setTimeout(function () { cycle(!hot); },
        LV_HEAT_LOOP_HOT_MS + (hot ? LV_HEAT_LOOP_HOT_HOLD_MS : LV_HEAT_LOOP_EVEN_HOLD_MS));
    }
    expertHeatLoopTimer = window.setTimeout(function () { cycle(true); }, 60);
  }

  // 按给定 step 给一块热力网格重新着色(含格子 <title> 的占比读数)。
  // 网格自带 data-heat-hot(倾斜专家 id)/data-heat-neutral(是否走中性灰),
  // 所以同一个函数能服务不同入口的网格,不需要调用方再传上下文。
  function paintExpertHeat(grid, step) {
    const hot = Number(grid.dataset.heatHot);
    const neutral = grid.dataset.heatNeutral === "1";
    const loads = lvExpertLoads(hot, step);
    grid.querySelectorAll(".lv-heat-cell").forEach((el) => {
      const eid = Number(el.dataset.e);
      const load = loads[eid];
      if (load == null) return;
      const t = lvHeatT(load);
      el.dataset.fill = lvHeatFill(t, neutral);
      el.dataset.op = lvHeatOpacity(t).toFixed(3);
      el.style.fill = el.dataset.fill;
      el.style.opacity = el.dataset.op;
      const title = el.querySelector("title");
      if (title) title.textContent = lvHeatCellTitle(eid, load);
    });
    // 最热/最冷描边圈搬到本 step 的新极值格上(读目标格自己的几何,不用再算一遍网格坐标)
    const st = lvHeatStats(loads);
    [["hi", st.hiId], ["lo", st.loId]].forEach(([kind, eid]) => {
      const mark = grid.querySelector('.lv-heat-mark[data-kind="' + kind + '"]');
      const cell = grid.querySelector('.lv-heat-cell[data-e="' + eid + '"]');
      if (!mark || !cell) return;
      const num = (name) => Number(cell.getAttribute(name)) || 0;
      mark.setAttribute("x", (num("x") - 1.2).toFixed(1));
      mark.setAttribute("y", (num("y") - 1.2).toFixed(1));
      mark.setAttribute("width", (num("width") + 2.4).toFixed(1));
      mark.setAttribute("height", (num("height") + 2.4).toFixed(1));
    });
  }
  function lvHeatCellTitle(eid, load) {
    return `E${eid} · ${(load * 100).toFixed(load >= 0.01 ? 1 : 3)}% token`;
  }

  // step 推进/时光机拖动后把在场的热力网格重画一遍。data-heat-static 的网格(定位链「模型层
  // 展开图」的事故举证图)钉在事故终态,不跟时钟走,跳过。
  let lastHeatStep = null;
  function syncExpertHeatToStep() {
    const grids = document.querySelectorAll(".lv-heat-grid:not([data-heat-static])");
    if (!grids.length) { lastHeatStep = null; return; }
    if (state.step === lastHeatStep) return;
    lastHeatStep = state.step;
    grids.forEach((g) => paintExpertHeat(g, state.step));
    updateExpertHeatReadout(state.step);
  }

  function lvBuildSvg(expandedLayer, hotExpert) {
    // 算子染色:'off' 模式把类别色统一压成中性灰(仅保留 cHot 红色诊断信号),'cat' 用原类别配色。
    // 局部 LV 遮蔽模块级 LV_BASE,函数内所有 LV.cXxx 引用随染色模式切换。
    const LV = lvColorMode === "off"
      ? Object.assign({}, LV_BASE, { cAttn: LV_NEUTRAL, cRoute: LV_NEUTRAL, cExpert: LV_NEUTRAL, cFlow: LV_NEUTRAL })
      : LV_BASE;
    const VW = 1180, VH = 820;
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
    const railTop = 78, railBot = 778;
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
        return `<rect x="${x - 3}" y="${cy - mh / 2}" width="6" height="${mh}" rx="1.5" fill="${m.color}" opacity=".65"></rect>`;
      }).join("");
      const denseFfn = isDense
        ? `<rect x="${x - 3}" y="${laneY.experts + 40}" width="6" height="70" rx="1.5" fill="#9ca3af" opacity=".65"></rect>`
        : "";
      layerTicks.push(`
        <g data-lv-layer="${layer}" opacity=".8">
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
        `<text class="lv-tiny mono" x="${pcx}" y="${m.y + m.h - 8 - (notes.length - 1 - i) * 13}" text-anchor="middle">${line}</text>`).join("");
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
    // 事故层:每个小格 = 一个 routed expert 的负载热力。这里只写「初始同色态」(= 均衡基准 1/256),
    // 真实负载放在 data-fill/data-op 上,挂载后由 startExpertHeat() 用 2s 过渡推过去。
    const neutral = lvColorMode === "off";
    // step 传 null:这张图是定位链里的事故举证图,整页文案都在讲事故那一刻,
    // 热力也钉在坍缩终态,不跟时光机走(网格上的 data-heat-static 让 syncExpertHeatToStep 跳过它)。
    const loads = isMoe && hotExpert != null ? lvExpertLoads(hotExpert, null) : null;
    const evenT = lvHeatT(1 / LV.routedExperts);
    const evenFill = lvHeatFill(evenT, neutral), evenOp = lvHeatOpacity(evenT).toFixed(3);
    let cardsSvg = "";
    for (let card = 0; card < 64; card += 1) {
      const p = cardPos(card);
      const overloaded = hotCards.has(card);
      cardsSvg += `<rect x="${p.x}" y="${p.y}" width="${cardW}" height="${cardH}" rx="2.5"
        fill="color-mix(in srgb, ${LV.cFlow} 6%, var(--surface-1))"
        stroke="${overloaded ? LV.cHot : LV.cFlow}" stroke-opacity="${overloaded ? "1" : ".28"}" stroke-width="${overloaded ? "2" : "0.8"}"></rect>`;
      for (let cell = 0; cell < 4; cell += 1) {
        const c = cellCenter(card, cell);
        const cx = c.x - cellW / 2, cy = c.y - cellH / 2;
        if (loads) {
          const eid = lvExpertIdAt(card, cell, hotExpert);
          const load = loads[eid], t = lvHeatT(load);
          cardsSvg += `<rect class="lv-heat-cell" data-e="${eid}" data-fill="${lvHeatFill(t, neutral)}" data-op="${lvHeatOpacity(t).toFixed(3)}"
            x="${cx}" y="${cy}" width="${cellW - 1}" height="${cellH - 1}" rx="1"
            fill="${evenFill}" opacity="${evenOp}"><title>${lvHeatCellTitle(eid, load)}</title></rect>`;
          continue;
        }
        // 均衡层:高亮该 token 命中的 top-8
        const hot = selected.find((s) => s.card === card && s.cell === cell && s.hot);
        const sel = selKey.has(`${card}.${cell}`);
        const fill = hot ? LV.cHot : sel ? LV.cFlow : LV.cExpert;
        const op = hot ? 1 : sel ? 0.92 : 0.5;
        cardsSvg += `<rect x="${cx}" y="${cy}" width="${cellW - 1}" height="${cellH - 1}" rx="1"
          fill="${fill}" opacity="${op}" ${sel ? 'stroke="#fff" stroke-width="1"' : ""}></rect>`;
      }
    }
    // 事故层的网格包一层,供 startExpertHeat() 找到并在揭示动画后转入短过渡;
    // data-heat-static 表示这块钉在事故终态,不跟时光机的 step 走(见 syncExpertHeatToStep)。
    if (loads) {
      cardsSvg = `<g class="lv-heat-grid" data-heat-static="1" data-heat-hot="${hotExpert}" data-heat-neutral="${neutral ? 1 : 0}">${cardsSvg}</g>`;
    }
    // 卡编号:每 4 卡标一次 rank,外加倾斜卡 r23(缩小字号避免与邻近 r20/r24 标签重叠)
    let cardLabels = "";
    for (let card = 0; card < 64; card += 4) {
      const p = cardPos(card);
      cardLabels += `<text class="lv-tiny mono" x="${p.x}" y="${p.y - 2}" style="font-size:7px">r${card}</text>`;
    }
    const rHot = cardPos(23);
    cardLabels += `<text class="lv-tiny mono" x="${rHot.x + cardW / 2}" y="${rHot.y - 6}" text-anchor="middle" fill="${LV.cHot}" style="font-weight:800;font-size:7px">EP rank 23</text>`;

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

    // 热力色阶图例(取代原来的 top-8 all-to-all mesh 连线动画)。
    // 原实现在命中的 8 个专家之间画 C(8,2)=28 条 mesh 并逐条描边生长,但 top-k 是逐 token 算的——
    // 一个 step 几万 token 就是几十万条路由,连线既画不全也读不动,反而误导成「只有 8 条链路」。
    // 现在改为整片 256 格的负载热力:动画只做「同色 → 热力」这一次过渡,坍缩本身就是画面。
    let heatLegend = "";
    if (isMoe && hotExpert != null) {
      const ly = gY + gH + 13;
      const swW = 11, swH = 8, swX = cardPos(0).x + 330;
      let stops = "";
      for (let i = 0; i < 12; i += 1) {
        const t = i / 11;
        stops += `<rect x="${(swX + i * swW).toFixed(1)}" y="${ly - swH}" width="${swW}" height="${swH}" fill="${lvHeatFill(t, neutral)}" opacity="${lvHeatOpacity(t).toFixed(3)}"></rect>`;
      }
      heatLegend = `
        <text class="lv-tiny" x="${cardPos(0).x}" y="${ly}" fill="${LV.cHot}" style="font-weight:800">色温/亮度 ∝ 专家承接的 token 量 · 悬停看占比</text>
        ${stops}
        <text class="lv-tiny mono" x="${(swX - 6).toFixed(1)}" y="${ly}" text-anchor="end" opacity=".7">≈0</text>
        <text class="lv-tiny mono" x="${(swX + 12 * swW + 6).toFixed(1)}" y="${ly}" opacity=".7">≥4× 均衡(1/256)</text>`;
    }

    // shared expert:1 个,处理全部 token,不走 all-to-all(左侧独立支路 + 虚线旁路)
    const shX = px + 46, shW = 44;
    const sharedSvg = isMoe ? `
      <rect x="${shX}" y="${gY}" width="${shW}" height="${gH}" rx="4" fill="${LV.cAttn}" opacity=".72"></rect>
      <text class="lv-tiny" x="${shX + shW / 2}" y="${gY + gH / 2 - 4}" text-anchor="middle" style="font-weight:800">shared</text>
      <text class="lv-tiny" x="${shX + shW / 2}" y="${gY + gH / 2 + 10}" text-anchor="middle">×1</text>
      <path d="M${shX + shW / 2} ${dispY + 6} V${gY + gH}" stroke="${LV.cAttn}" stroke-width="3" fill="none" opacity=".6" stroke-dasharray="5 4"></path>
      <path d="M${shX + shW / 2} ${gY} V${combY - 6}" stroke="${LV.cAttn}" stroke-width="3" fill="none" opacity=".6" stroke-dasharray="5 4"></path>
    ` : "";

    // ── 体现 定位链.md L128:rank 23 的 all-to-all send/recv buffer 失配 ──
    // 本地 token 全落在本卡 expert 193 → 没有 token 需要发往别的 rank(send=0);
    // 但全局 98% token 都选中 E47,要从其它 rank 收进来(recv=2048×4608×8≈151MB) → 收发尺寸对不上 → 死锁。
    let mismatchGauge = "";
    if (isMoe && hotExpert != null) {
      const gx = px + 396, barX = gx + 40, barMaxW = 148;
      const recvW = barMaxW, sendW = 3; // send≈0 只画一个空心红槽
      mismatchGauge = `
        <text class="lv-tiny" x="${gx}" y="${em + 50}" fill="${LV.cHot}" style="font-weight:800">EP rank 23 all-to-all buffer 失配 → 死锁</text>
        <text class="lv-tiny" x="${gx}" y="${em + 62}">send</text>
        <rect x="${barX}" y="${em + 55}" width="${sendW}" height="8" rx="1" fill="none" stroke="${LV.cHot}" stroke-width="1"></rect>
        <text class="lv-tiny mono" x="${barX + 10}" y="${em + 62}" fill="${LV.cHot}" style="font-weight:800">0(无 token 外发)</text>
        <text class="lv-tiny" x="${gx}" y="${em + 74}">recv</text>
        <rect x="${barX}" y="${em + 67}" width="${recvW}" height="8" rx="1" fill="${LV.cHot}"></rect>
        <text class="lv-tiny mono" x="${barX + recvW + 6}" y="${em + 74}" fill="${LV.cHot}" style="font-weight:800">2048×4608×8 ≈ 151MB</text>`;
    }
    const expertsTitle = isMoe && hotExpert != null
      ? `routed experts · ${LV.routedExperts} → EP64(64 卡 × 4)`
      : `routed experts · ${LV.routedExperts} → EP64:64 卡 × 4/卡 · 激活 top-${LV.topK}`;
    // 模型层 §4 路由倾斜说明(事故层):点明 98%→E47、其余 expert≈0,与网格热力配色对应
    const skewCaption = isMoe && hotExpert != null
      ? `<text class="lv-tiny" x="${px + 52}" y="${em + 31}" fill="${LV.cHot}" style="font-weight:700">router 输出:98% token → E${hotExpert} · 其余 ${LV.routedExperts - 1} 个专家分摊剩下 2%(路由坍缩)</text>`
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
    let flow = `<path d="M${pcx} 700 V${cyOf("in_norm") + 15}" stroke="${LV.cFlow}" stroke-width="3.4" fill="none" marker-end="url(#lvArrow)" opacity=".85"></path>`;
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
      <path d="M${resX} 700 V${cyOf("post_norm")}" stroke="${LV.cFlow}" stroke-width="1.6" stroke-dasharray="4 4" fill="none" opacity=".4"></path>
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
        ${heatLegend}
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
        <rect x="${moeX1}" y="52" width="${moeX2 - moeX1}" height="706" rx="6" fill="none" stroke="${LV.cRoute}" stroke-width="1.6" stroke-dasharray="7 6" opacity=".4"></rect>
        <text class="lv-tiny" x="${(moeX1 + moeX2) / 2}" y="46" text-anchor="middle" opacity=".7">MoE 层 L3–L60(前 3 层为 Dense)</text>
        ${guides}
        <g data-lv-object="input">
          <rect x="40" y="662" width="104" height="38" rx="6" fill="color-mix(in srgb, var(--surface-1) 80%, transparent)" stroke="currentColor" stroke-opacity=".28"></rect>
          <text class="lv-tiny" x="92" y="685" text-anchor="middle">hidden [S,7168]</text>
        </g>
        <g data-lv-object="output">
          <rect x="40" y="46" width="104" height="38" rx="6" fill="color-mix(in srgb, var(--surface-1) 80%, transparent)" stroke="currentColor" stroke-opacity=".28"></rect>
          <text class="lv-tiny" x="92" y="69" text-anchor="middle">hidden [S,7168]</text>
        </g>
        ${layerTicks.join("")}
        ${panelBox}
        <text class="lv-legend" x="150" y="812">自底(输入)向上(输出) · 专家格子色温 ∝ token 量(载入时 2s 从均衡同色过渡到实际负载:仅 E${hotExpert} 烫红=98%,其余 255 个退回冷蓝 ≈0)· 红框=倾斜专家所在 EP rank 23(a2a buffer 失配 → 死锁)· 虚线=残差 / shared 旁路</text>
      </svg>`;
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
    // 热力动画是一次性 CSS 过渡,跟着 innerHTML 重画自然消失,不再需要取消 rAF 句柄/可见性监听
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
        startExpertHeat(host);
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
    startExpertHeat(host);
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

  // ── 问题三 Canvas 图表渲染 ──
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
    const l35x = P.l + 34 * gap + gap / 2;
    ctx.fillStyle = '#dc2626'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('L35 · 震中', l35x, yOf(d32[34]) - 7);
    ctx.setLineDash([2, 2]); ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(l35x, yOf(d32[34]) - 2); ctx.lineTo(l35x, P.t - 2); ctx.stroke(); ctx.setLineDash([]);
  }

  function renderCase6OpWaterfall() {
    const canvas = document.getElementById('case6OpWaterfallCanvas');
    if (!canvas) return;
    const r = dprCase6(canvas, canvas.parentElement.clientWidth, 140);
    const { ctx, W, H } = r;
    const P = { t: 16, r: 14, b: 42, l: 44 }, pw = W - P.l - P.r, ph = H - P.t - P.b;
    const labels = ['LN', 'q_a_proj', 'kv_a_proj', 'q_b_proj', 'rope', 'attn', 'o_proj', 'gate_up', 'SiLU', 'down'];
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
      if (i === 3 || i === 5 || i === 7) { ctx.fillStyle = '#dc2626'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center'; ctx.fillText('⬆' + (i === 3 ? '6800×' : i === 5 ? '40×' : '4×'), x + barW / 2, yOf(v) - 3); }
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
    const n = 46;
    const mse = Array.from({ length: n }, (_, i) => { if (i < 25) return -6.5 + (i / 25) * 1.2 + (Math.random() - 0.5) * 0.3; if (i < 34) return -5.3 + (i - 25) / 9 * 2.8 + (Math.random() - 0.5) * 0.3; if (i === 34) return -0.64; if (i < 41) return -0.64 + (i - 34) * 0.03 + (Math.random() - 0.5) * 0.08; return -0.4 + (i - 41) / 4 * 0.9 + (Math.random() - 0.5) * 0.1; });
    const minV = -7, maxV = 1;
    const xOf = (i) => P.l + (i / (n - 1)) * pw, yOf = (v) => P.t + ph - ((v - minV) / (maxV - minV)) * ph;

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) { const y = P.t + (ph / 4) * i; ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.fillStyle = '#888'; ctx.font = '9px system-ui'; ctx.textAlign = 'right'; ctx.fillText('1e' + Math.round(minV + (maxV - minV) * (1 - i / 4)), P.l - 5, y + 4); }
    ctx.fillStyle = '#888'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; [0, 11, 23, 34, 45].forEach(i => ctx.fillText('L' + (i + 1), xOf(i), H - 6));

    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.beginPath();
    mse.forEach((v, i) => { const x = xOf(i), y = yOf(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke(); ctx.lineTo(xOf(n - 1), P.t + ph); ctx.lineTo(P.l, P.t + ph); ctx.closePath(); ctx.fillStyle = 'rgba(59,130,246,0.07)'; ctx.fill();

    const l35x = xOf(34), l35y = yOf(mse[34]);
    ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.arc(l35x, l35y, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#dc2626'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('L35 · 拐点', l35x, l35y - 9); ctx.fillText('460×', l35x, l35y + 14);
    ctx.setLineDash([2, 2]); ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(l35x, l35y + 5); ctx.lineTo(l35x, P.t + ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(234,88,12,0.07)'; ctx.fillRect(xOf(35), P.t, xOf(45) - xOf(35), ph);
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
        { id: 'case6-loss-hif8', label: 'HiF8', key: 'case6-loss-hif8', colorVar: LINE_1, emphasis: true, axis: 'left' },
        { id: 'case6-loss-bf16', label: 'BF16', key: 'case6-loss-bf16', colorVar: LINE_2, axis: 'left' },
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
        series: [{ id: 'case6-gradnorm', label: 'grad_norm', key: 'case6-gradnorm', colorVar: LINE_1, axis: 'left' }],
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
    $("architectureTitle").textContent = marker ? `问题${problemNum(marker)}：${marker.label}` : chain.title;
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
    if (caseKey === "mem-oom") window.PtoMemCase4?.renderAll();
    if (caseKey === "hif8-precision" || caseKey === "qproj-overflow") {
      window.PtoHif8Case7?.renderAll();
      // 问题二默认收起底部泳道图(ide-frame 底部 dock 开关,见 training-monitoring.html 内联脚本)
      window.PtoTrainingTwinTimelineDock?.setVisible(false);
    }
    // 问题二(qproj-overflow / hif8-precision):把表搬到整网图位置并隐藏整网图;其余问题则复位
    applyHif8SidePanel(caseKey);
  }

  // 问题二(qproj-overflow / hif8-precision)专属:把整网图区改造为「整网图 | 表格」双视图。
  // 右列侧栏(#hif8SideStage)自上而下 = 训练步回放 scrubber + 「整网图 | 表格」切换栏 + 整网图槽 + 表格槽。
  //   · 整网图槽:把默认页面的 L5 整网图卡(.twin-graph-card)原样搬进来复用,并在其算子节点右上角注入溢出率徽标;
  //   · 表格槽:把定位链「量化误差」节里的「层/算子级量化误差指标」表整卡搬进来(排序/选层联动照旧)。
  // 默认选中「整网图」。传入非问题二的 caseKey(或 null)则复位:整网图卡搬回原网格、清空侧栏。
  function restoreHif8Graph() {
    // 把可能搬进侧栏的整网图卡搬回 .twin-center-scroll 原位(order:1 由 CSS 归位),并清掉注入的溢出率徽标
    const centerScroll = document.querySelector(".twin-center-scroll");
    const graphCard = document.querySelector(".twin-graph-card");
    if (graphCard && centerScroll && graphCard.parentElement && graphCard.parentElement.id === "hif8GraphSlot") {
      centerScroll.appendChild(graphCard);
    }
    if (window.PtoTwinGraphAdapter) { window.PtoTwinGraphAdapter.clearOverflowBadges(); return; }
    document.querySelectorAll("#graphStage .c7over-badge").forEach((el) => el.remove());
    document.querySelectorAll("#graphStage .c7over-node-crit, #graphStage .c7over-node-ok")
      .forEach((el) => el.classList.remove("c7over-node", "c7over-node-crit", "c7over-node-ok"));
  }

  // 把每层当前步溢出率(取自 hif8-case7)注入到 #graphStage 命中算子节点的右上角(药丸徽标,红/绿 2 档)
  // 返回命中并注入的节点数,供 scheduleHif8GraphBadges 判断整网图是否已就绪(未就绪则重试)
  function refreshHif8GraphBadges() {
    if (!window.PtoHif8Case7 || !window.PtoHif8Case7.overflowMap) return 0;
    if (window.PtoTwinGraphAdapter) return window.PtoTwinGraphAdapter.refreshOverflowBadges(window.PtoHif8Case7.overflowMap());
    const stage = document.getElementById("graphStage");
    if (!stage) return 0;
    if (!stage.querySelector("svg")) return 0;                    // 整网图 SVG 未就绪
    const map = window.PtoHif8Case7.overflowMap();
    const NS = "http://www.w3.org/2000/svg";
    stage.querySelectorAll(".c7over-badge").forEach((el) => el.remove());   // 清旧徽标(逐步重画)
    stage.querySelectorAll(".c7over-node-crit, .c7over-node-ok").forEach((el) => el.classList.remove("c7over-node", "c7over-node-crit", "c7over-node-ok"));
    let hit = 0;
    Object.keys(map).forEach((id) => {
      const group = stage.querySelector('[data-node-id="' + id + '"]');
      if (!group) return;
      const rect = group.querySelector("rect");
      if (!rect) return;
      const w = parseFloat(rect.getAttribute("width") || "0");
      const h = parseFloat(rect.getAttribute("height") || "0");
      if (!w) return;
      const info = map[id];
      // 节点本体描边:命中算子给节点加对应颜色描边(与右上角徽标同色,参考 precision-debugger prec-crit/high)
      group.classList.add("c7over-node", "c7over-node-" + info.tier);
      // 节点组局部坐标以节点中心为原点(与 drawBadge 一致)→ 右上角 = (w/2, -h/2)
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "c7over-badge c7over-" + info.tier);
      g.setAttribute("transform", "translate(" + (w / 2 + 4) + "," + (-h / 2) + ")");
      const bw = 64, bh = 26;
      const bg = document.createElementNS(NS, "rect");
      bg.setAttribute("x", -bw); bg.setAttribute("y", -bh / 2);
      bg.setAttribute("width", bw); bg.setAttribute("height", bh);
      bg.setAttribute("rx", 13); bg.setAttribute("ry", 13);
      const tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", -bw / 2); tx.setAttribute("y", 1);
      tx.setAttribute("text-anchor", "middle"); tx.setAttribute("dominant-baseline", "central");
      tx.textContent = (info.over * 100).toFixed(2) + "%";
      const ttl = document.createElementNS(NS, "title");
      ttl.textContent = info.name + " · 溢出率 " + (info.over * 100).toFixed(2) + "% · SQNR " + info.sqnr.toFixed(1) + "dB";
      g.appendChild(bg); g.appendChild(tx); g.appendChild(ttl);
      group.appendChild(g);
      hit++;
    });
    return hit;
  }

  // 整网图可能在进入问题二时尚未渲染完 SVG，重试注入直到命中算子节点(与 applyDefaultDiagnosisMarkers 同思路)
  let hif8BadgeTimer = null;
  function scheduleHif8GraphBadges(tries) {
    if (hif8BadgeTimer) { clearTimeout(hif8BadgeTimer); hif8BadgeTimer = null; }
    if (refreshHif8GraphBadges() > 0) return;                    // 已命中即停
    if (tries <= 0) return;
    hif8BadgeTimer = setTimeout(() => scheduleHif8GraphBadges(tries - 1), 200);
  }

  function applyHif8SidePanel(caseKey) {
    const centerPane = document.querySelector(".twin-center-pane");
    const centerScroll = document.querySelector(".twin-center-scroll");
    if (!centerPane || !centerScroll) return;
    let host = document.getElementById("hif8SideStage");
    // 复位:先把整网图卡搬回原位,再清空/隐藏侧栏
    restoreHif8Graph();
    if (host) { host.innerHTML = ""; host.hidden = true; }
    centerPane.classList.remove("is-hif8-side-table");
    if (window.PtoHif8Case7 && window.PtoHif8Case7.onStep) window.PtoHif8Case7.onStep(null);
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
    // 训练步回放 scrubber 从概览节搬到切换栏上方(仍按 ID 绑定,拖动照旧驱动全部图表 + 整网图徽标)
    const scrub = document.getElementById("c7play")?.closest(".h8-scrub");
    if (scrub) wrap.appendChild(scrub);

    // 「整网图 | 表格」切换栏(复用整网图工具栏的算子染色分段样式 .seg/.segbtn)
    const bar = document.createElement("div");
    bar.className = "hif8-view-bar";
    bar.innerHTML =
      '<span class="seg" id="hif8ViewSeg">' +
        '<button type="button" class="segbtn on" data-v="graph">整网图</button>' +
        '<button type="button" class="segbtn" data-v="table">表格</button>' +
      '</span>' +
      '<span class="h8-help" data-help-key="error-table" style="margin-left:auto">?</span>';
    wrap.appendChild(bar);

    // 整网图槽:搬入默认页面的 L5 整网图卡复用
    const graphSlot = document.createElement("div");
    graphSlot.id = "hif8GraphSlot";
    graphSlot.className = "hif8-slot";
    const graphCard = document.querySelector(".twin-graph-card");
    if (graphCard) graphSlot.appendChild(graphCard);
    wrap.appendChild(graphSlot);

    // 表格槽:搬入「层/算子级量化误差指标」表卡(默认隐藏)
    const tableSlot = document.createElement("div");
    tableSlot.id = "hif8TableSlot";
    tableSlot.className = "hif8-slot";
    tableSlot.hidden = true;
    tableSlot.appendChild(card);
    wrap.appendChild(tableSlot);

    host.hidden = false;
    centerPane.classList.add("is-hif8-side-table");

    // 视图切换
    const seg = document.getElementById("hif8ViewSeg");
    function setView(v) {
      const isGraph = v === "graph";
      graphSlot.hidden = !isGraph;
      tableSlot.hidden = isGraph;
      if (seg) seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
      if (isGraph) {
        // 整网图重新显示后,触发引擎 re-fit(监听 resize→centerView)并重试注入徽标直到就绪
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event("resize"));
          scheduleHif8GraphBadges(40);
        });
      }
    }
    if (seg) seg.querySelectorAll("button").forEach((b) => (b.onclick = () => setView(b.dataset.v)));

    // 训练步/选层变化时刷新整网图溢出率徽标
    if (window.PtoHif8Case7.onStep) window.PtoHif8Case7.onStep(refreshHif8GraphBadges);

    // 默认整网图视图 + 初次注入徽标(等一帧让搬运后的布局稳定)
    setView("graph");
    // 页签栏中的 ? 气泡是在这里动态创建的，需补绑事件（bindHelpBubbles 已做去重）
    if (window.PtoHif8Case7 && window.PtoHif8Case7.bindHelpBubbles) {
      window.PtoHif8Case7.bindHelpBubbles();
    }
  }

  // 「问题一」通信调度层的 Timeline (node2 GPU 7) 泳道图：自包含渲染,不再走 iframe。
  // 占位 div 由 renderLocateChain 从 locateChains 的 content 里插入(data-problem-one-timeline)。
  function renderProblemOneTimeline() {
    const host = document.querySelector("[data-problem-one-timeline]");
    // 底部 Timeline 面板已有全量泳道图,这里只保留有问题的 r23 一条泳道。
    if (host && window.PtoProblemOneTimeline) window.PtoProblemOneTimeline.render(host, { rankFilter: { from: 23, to: 23 } });
  }

  // 底部「Timeline」面板的泳道图。两套实现按页面择一:
  //   · v2 单屏页(training-monitoring-v2.html)走「按 Rank 的训练步泳道」
  //     (js/training-rank-swimlane.js)——旧图是算子/通信事务级的 1F1B trace,站在训练角度太细;
  //     新图按 训练步 → PP stage → Rank 分层,只讲关键的前向/反向/梯度同步/参数更新,
  //     再往下钻才出通信细节,并带「健康步 / 事故步」两个场景。
  //   · 其余页面(没加载该脚本的)仍用自包含 1F1B 泳道图(js/timeline-swimlane.js),行为不变。
  // 始终常驻,进入问题一等诊断流程时保持不变。
  function renderTimelineDock() {
    const host = document.getElementById("twinTimelineBody");
    if (!host) return;
    if (window.PtoTrainingRankSwimlane) { window.PtoTrainingRankSwimlane.render(host); return; }
    if (window.PtoProblemOneTimeline) window.PtoProblemOneTimeline.render(host);
  }

  function hideLocateChainPanel() {
    window.PtoHif8Case7?.stop(); // 关闭定位链时停掉 HiF8 案例的训练步回放,避免遗留 interval 空转
    applyHif8SidePanel(null);    // 复位:恢复整网图,清掉搬到左侧的量化误差表
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
    // 退出问题详情(返回或再点一次问题卡片)时,整网图可能残留 panToProblemNodes 平移/缩放到的局部视图,
    // 需恢复默认全局视图:等一帧让面板尺寸变化(is-merged 还原等)落地,再触发 resize→centerView 的 Fit 逻辑
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
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
      bubble.innerHTML = `<strong style="color:${m.severity==='p0'?'#dc2626':'#ea580c'}">${sevLabel} ${m.category}</strong><br>${stepText}<br>问题${problemNum(m)}：${m.label}`;
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
      if (card) { toggleDiagnosisCard(card); return; }
      // wzh 单屏页面没有「问题诊断」卡片列表,改走单屏问题透镜联动(时光机跳转 + 整网图/infra 高亮 + 展开 Timeline)
      if (isWzhTwinPage()) activateProblemLens(key);
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

  // 深链接:training-monitoring-v2.html(问题一单屏深度看板)的「定位链详情」抽屉用 iframe 内嵌本页并带
  // ?diagnosis=<key>,加载后自动选中对应「问题诊断」卡,直接展开定位链面板,不需要在 iframe 里再点一次。
  function applyDeepLinkDiagnosis() {
    const key = new URLSearchParams(window.location.search).get("diagnosis");
    if (!key) return;
    const card = document.querySelector(`.diagnosis-card[data-diagnosis="${key}"]`);
    if (card) toggleDiagnosisCard(card);
  }

  function boot() {
    bindControls();
    bindDiagnosisCards();
    bindDiagnosisMarkers();
    bindTimeMachine();
    bindLayerViewTopbar();
    bindExpertHeatClose();
    applyTheme(currentTheme, { skipRender: true });
    seedHistory();
    state.seen = models[state.model].target * 0.42;
    renderArchitecture();
    // 新整网图由 opv-modelviz 异步渲染,renderArchitecture 内已跳过旧图;
    // applyDefaultDiagnosisMarkers 内部自带重试等待 #graphStage SVG 就绪再画标记
    applyDefaultDiagnosisMarkers();
    // opv-modelviz 每次重建整网图 SVG(算子染色 / 层级 / 主题切换)都会清掉挂在旧 SVG 上的
    // 诊断标记与溢出率徽标;监听其广播的重建事件,重新注入这两类叠加标记。
    document.addEventListener("opv-graph-rendered", () => {
      applyDefaultDiagnosisMarkers();
      // 溢出率徽标只在问题二(HiF8)侧栏「整网图」视图激活时存在,复位后不再注入
      if (document.querySelector(".twin-center-pane")?.classList.contains("is-hif8-side-table")) {
        scheduleHif8GraphBadges(40);
      }
      // opv-modelviz 重建 SVG 会连带清掉挂在旧 SVG 上的 routed_expert_bank 展开卡片,重建后按需重新挂上
      if (routedExpertExpandActive) showRoutedExpertBankExpand();
    });
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
    applyDeepLinkDiagnosis(); // 放在 boot() 末尾:模拟真实点击卡片时机,此时图表/设备状态均已初始化完毕
  }

  boot();
})();

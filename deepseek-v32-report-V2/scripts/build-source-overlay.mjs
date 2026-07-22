import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

await import("../architecture-data.js");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const outputDir = resolve(root, "outputs");
const dataDir = resolve(root, "data");
const deepSeekRoot = resolve(root, "sources/DeepSeek-V3.2-Exp");
const transformersRoot = resolve(root, "sources/huggingface-transformers");
const runtimeSourceRoot = resolve(root, "sources/ui-json-runtime");

const DEEPSEEK_REVISION = "87e509a2e5a100d221c97df52c6e8be7835f0057";
const TRANSFORMERS_REVISION = "9a0fe3f5dd36ffe1888133f09eb03f1eb14b8a6e";
const UI_JSON_REVISION = "f6262f5b95e32a2a66e38314b6c7b035d51ea49d";
const MTP_LEARNED_LAYER_COUNT = 1;
const MTP_LAYER_INDEX = 61;
const MTP_RUNTIME_ITERATIONS = 3;
const EXPECTED_HASHES = {
  "sources/DeepSeek-V3.2-Exp/inference/model.py": "bfe5b89186b579910b6d59fa7e0cf1f7a75ceb4ec5d0f5b54f0ccbe77cdb6a63",
  "sources/DeepSeek-V3.2-Exp/inference/config_671B_v3.2.json": "f9fe074cdef8fdcc0feabbe635ff7c072a65d273a42a6bc207fe425439dff835",
  "sources/huggingface-transformers/src/transformers/models/deepseek_v32/modeling_deepseek_v32.py": "92ba56d4d2fb435510f23c32b4beea403135431adf2f6cea6bee36e6004a05b5",
  "sources/huggingface-transformers/src/transformers/models/deepseek_v32/configuration_deepseek_v32.py": "4306770517f8a4db3e1d33452c6eda7af2b48a5e45169ac8ed742edf3bbfec15",
  "sources/ui-json-runtime/model/models/modeling_deepseek.py": "47aa95ecb702d741308b0b50f8e63e04fd12361a7013ff7e243d31279fc57079",
  "sources/ui-json-runtime/model/models/configuration_deepseek.py": "60ded95338f214ad2d16e0ae33410799d24689302edc365d413235a8617adbf9",
  "sources/ui-json-runtime/model/models/model_infer.py": "7b6b8ac03dca96c04e89f8f2ff613fbe92b3c2b4971788e5c420a0ac232a9aa6",
  "sources/ui-json-runtime/model/infer.py": "41b68c7aeac0b8e261e045a58f0b02237613a50733479720fcf4c5d77c85ac3e",
  "sources/ui-json-runtime/model/config/ci/deepseek_v3.2_exp_rank_32_32ep_32cp_w8a8c8_mtp3.yaml": "9538ed678916d495864544d24d7c89a7a4102dd8f948b253cbd36e831a0d99a6",
};

const [analysisConfig, perfData, timelineData, runtimeConfig] = await Promise.all([
  readJson(resolve(dataDir, "ds3_2_analysis_config.json")),
  readJson(resolve(dataDir, "ds3_2_perf_data.json")),
  readJson(resolve(dataDir, "ds3_2_timeline.json")),
  readJson(resolve(deepSeekRoot, "inference/config_671B_v3.2.json")),
]);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function collectAnalysisNodes() {
  const out = [];
  const seen = new Set();
  function visit(node, parentNodeId = "") {
    if (!node || typeof node.node_id !== "string" || seen.has(node.node_id)) return;
    seen.add(node.node_id);
    out.push({
      node_id: node.node_id,
      parent_node_id: parentNodeId || null,
      node_kind: node.node_kind || (values(node.children).length ? "module" : "op"),
      semantic_key: node.semantic_key || node.name || node.node_id.split("/").pop(),
      name: node.name || node.semantic_key || node.node_id.split("/").pop(),
      code_ref: node.code_ref || null,
      instance_indices: Array.isArray(node.instance_indices) ? [...node.instance_indices] : [],
    });
    values(node.children).forEach((child) => visit(child, node.node_id));
  }
  [...values(analysisConfig.stages), ...values(analysisConfig.layer_structure), ...values(analysisConfig.runtime_auxiliary)]
    .forEach((node) => visit(node));
  return out;
}

function collectPerfNodes() {
  const byId = new Map();
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (typeof node.node_id === "string") {
      const { children, ...metrics } = node;
      byId.set(node.node_id, metrics);
    }
    values(node.children).forEach(visit);
  }
  values(perfData.modules).forEach(visit);
  return byId;
}

function ref(sourceId, path, lineStart, lineEnd, symbol, evidence = "source") {
  return {
    source_id: sourceId,
    path,
    line_start: lineStart,
    line_end: lineEnd,
    symbol,
    evidence,
  };
}

const sourceRefs = {
  transformer: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 1502, 1686, "DeepseekV3Model"),
    ref("deepseek_official", "inference/model.py", 854, 913, "Transformer"),
    ref("transformers_official", "modeling_deepseek_v32.py", 678, 752, "DeepseekV32Model"),
  ],
  embedding: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 1531, 1615, "DeepseekV3Model.calc_input_embeddings"),
    ref("deepseek_official", "inference/model.py", 92, 130, "ParallelEmbedding"),
    ref("transformers_official", "modeling_deepseek_v32.py", 678, 734, "DeepseekV32Model.embed_tokens"),
  ],
  norm: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 1439, 1465, "DeepseekV3DecoderLayer norms"),
    ref("deepseek_official", "inference/model.py", 272, 298, "RMSNorm"),
    ref("transformers_official", "modeling_deepseek_v32.py", 48, 63, "DeepseekV32RMSNorm"),
  ],
  rope: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 1619, 1641, "DeepseekV3Model.forward rotary_emb"),
    ref("deepseek_official", "inference/model.py", 326, 431, "precompute_freqs_cis/apply_rotary_emb"),
    ref("transformers_official", "modeling_deepseek_v32.py", 68, 163, "DeepseekV32RotaryEmbedding"),
  ],
  attention: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 673, 1412, "DeepseekIndexerAttention"),
    ref("deepseek_official", "inference/model.py", 498, 608, "MLA"),
    ref("transformers_official", "modeling_deepseek_v32.py", 347, 475, "DeepseekV32Attention"),
  ],
  indexer: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 673, 937, "DeepseekIndexerAttention indexer"),
    ref("deepseek_official", "inference/model.py", 435, 487, "Indexer"),
    ref("transformers_official", "modeling_deepseek_v32.py", 166, 262, "DeepseekV32Indexer"),
  ],
  denseMlp: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 72, 142, "DeepseekV3DenseMLP"),
    ref("deepseek_official", "inference/model.py", 611, 643, "MLP"),
    ref("transformers_official", "modeling_deepseek_v32.py", 478, 491, "DeepseekV32MLP"),
  ],
  router: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 198, 555, "DeepseekV3MoE routing"),
    ref("deepseek_official", "inference/model.py", 646, 709, "Gate"),
    ref("transformers_official", "modeling_deepseek_v32.py", 494, 532, "DeepseekV32TopkRouter"),
  ],
  experts: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 143, 672, "DeepseekV3SharedExpert/DeepseekV3MoE"),
    ref("deepseek_official", "inference/model.py", 712, 803, "Expert/MoE"),
    ref("transformers_official", "modeling_deepseek_v32.py", 536, 600, "DeepseekV32Experts/DeepseekV32MoE"),
  ],
  block: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 1415, 1495, "DeepseekV3DecoderLayer"),
    ref("deepseek_official", "inference/model.py", 807, 851, "Block"),
    ref("transformers_official", "modeling_deepseek_v32.py", 599, 643, "DeepseekV32DecoderLayer"),
  ],
  lmHead: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 1785, 1800, "DeepseekV3ForCausalLM lm_head"),
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 1942, 1991, "DeepseekV3ForCausalLM.forward_lm_head"),
    ref("deepseek_official", "inference/model.py", 890, 913, "Transformer.forward"),
    ref("transformers_official", "modeling_deepseek_v32.py", 755, 816, "DeepseekV32ForCausalLM"),
  ],
  mtp: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 1688, 1740, "DeepseekV3ModelMTPLayer"),
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 2447, 2549, "DeepseekV3ModelMTP"),
  ],
  mtpPreprocess: [
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 2460, 2523, "DeepseekV3ModelMTP preprocess and fusion"),
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 1566, 1615, "DeepseekV3Model.calc_input_embeddings"),
  ],
  mtpLoop: [
    ref("ui_json_runtime", "model/models/model_infer.py", 297, 316, "Infer.mtp_post_process"),
    ref("ui_json_runtime", "model/config/ci/deepseek_v3.2_exp_rank_32_32ep_32cp_w8a8c8_mtp3.yaml", 6, 8, "model_config.next_n", "config"),
  ],
  mtpShare: [
    ref("ui_json_runtime", "model/infer.py", 44, 52, "shared MTP embedding/lm_head/rotary_emb"),
    ref("ui_json_runtime", "model/models/modeling_deepseek.py", 2460, 2467, "DeepseekV3ModelMTP shared modules"),
  ],
};

function sourceItem(id, label, kind, refs, options = {}) {
  return {
    id,
    label,
    kind,
    typeLabel: options.typeLabel || ({ module: "Module", op: "Op", state: "State", input: "Input", output: "Output" }[kind] || "Node"),
    colorKey: options.colorKey || colorKey(label, kind),
    origin: "source",
    dataState: "source_only",
    selectable: false,
    sourceRefs: refs,
    attrs: options.attrs || {},
    stateType: options.stateType,
    repeatCount: options.repeatCount,
    repeatRange: options.repeatRange,
    instanceIndices: options.instanceIndices,
    observedInstanceIndices: options.observedInstanceIndices,
    defaultCollapsed: options.defaultCollapsed,
    layout: options.layout,
    layoutRows: options.layoutRows,
    children: options.children || [],
  };
}

function colorKey(label, kind = "op") {
  const text = label.toLowerCase();
  if (kind === "input") return "io:input";
  if (kind === "output") return "io:output";
  if (kind === "module") return /attention|mla|index/.test(text) ? "module:attention" : /moe|expert/.test(text) ? "module:moe" : "module:model";
  if (/all.?gather|all.?reduce|reduce.?scatter|all.?to.?all|dispatch|combine/.test(text)) return "sem:comm";
  if (/rotary|rope|cos|sin/.test(text)) return "sem:rope";
  if (/embed/.test(text)) return "sem:embedding";
  if (/norm/.test(text)) return "sem:norm";
  if (/attention|mla|index|cache|absorb/.test(text)) return "sem:attention";
  if (/router|routing|topk|gate/.test(text)) return "sem:gate";
  if (/activation|silu/.test(text)) return "sem:activation";
  if (/projection|proj|head/.test(text)) return "sem:linear";
  if (/expert|mlp|moe/.test(text)) return "sem:moe";
  return kind === "state" ? "io:state" : "opv:op";
}

function attentionTree(prefix) {
  const qPathId = `${prefix}/self_attn/mla_prolog/query_path`;
  const kvPathId = `${prefix}/self_attn/mla_prolog/kv_path`;
  return sourceItem(`${prefix}/self_attn`, "Multi-head Latent Attention", "module", sourceRefs.attention, {
    defaultCollapsed: true,
    children: [
      sourceItem(`${prefix}/self_attn/mla_prolog`, "MLA Projection Prolog", "module", sourceRefs.attention, {
        defaultCollapsed: true,
        layout: "parallel",
        children: [
          sourceItem(qPathId, "Query Low-rank Path", "module", sourceRefs.attention, {
            children: [
              sourceItem(`${qPathId}/q_down_proj`, "Query Down Projection", "op", sourceRefs.attention),
              sourceItem(`${qPathId}/q_norm`, "Query RMSNorm", "op", sourceRefs.attention),
              sourceItem(`${qPathId}/q_up_proj`, "Query Up Projection", "op", sourceRefs.attention),
              sourceItem(`${qPathId}/q_rope`, "Query Rotary Embedding", "op", sourceRefs.rope),
            ],
          }),
          sourceItem(kvPathId, "Key Value Low-rank Path", "module", sourceRefs.attention, {
            children: [
              sourceItem(`${kvPathId}/kv_down_proj`, "Key Value Down Projection", "op", sourceRefs.attention),
              sourceItem(`${kvPathId}/kv_norm`, "Key Value RMSNorm", "op", sourceRefs.attention),
              sourceItem(`${kvPathId}/k_rope`, "Key Rotary Embedding", "op", sourceRefs.rope),
            ],
          }),
        ],
      }),
      sourceItem(`${prefix}/self_attn/indexer`, "Sparse Attention Indexer", "module", sourceRefs.indexer, {
        defaultCollapsed: true,
        children: [
          sourceItem(`${prefix}/self_attn/indexer/query_projection`, "Indexer Query Projection", "op", sourceRefs.indexer),
          sourceItem(`${prefix}/self_attn/indexer/key_projection`, "Indexer Key Projection", "op", sourceRefs.indexer),
          sourceItem(`${prefix}/self_attn/indexer/key_norm`, "Indexer Key Norm", "op", sourceRefs.indexer),
          sourceItem(`${prefix}/self_attn/indexer/weight_projection`, "Indexer Weight Projection", "op", sourceRefs.indexer),
          sourceItem(`${prefix}/self_attn/indexer/key_cache`, "Indexer Key Cache", "state", sourceRefs.indexer, { stateType: "cache" }),
          sourceItem(`${prefix}/self_attn/indexer/scale_cache`, "Indexer Scale Cache", "state", sourceRefs.indexer, { stateType: "cache" }),
          sourceItem(`${prefix}/self_attn/indexer/index_score`, "Sparse Index Score", "op", sourceRefs.indexer),
          sourceItem(`${prefix}/self_attn/indexer/topk_select`, "Sparse Index Selection", "op", sourceRefs.indexer),
        ],
      }),
      sourceItem(`${prefix}/self_attn/kv_cache`, "Latent Key Value Cache", "state", sourceRefs.attention, { stateType: "cache" }),
      sourceItem(`${prefix}/self_attn/pe_cache`, "Position Encoding Cache", "state", sourceRefs.attention, { stateType: "cache" }),
      sourceItem(`${prefix}/self_attn/attn_core`, "Sparse Attention Core", "op", sourceRefs.attention),
      sourceItem(`${prefix}/self_attn/kv_b_absorb`, "Latent Value Absorption", "op", sourceRefs.attention),
      sourceItem(`${prefix}/self_attn/o_proj`, "Attention Output Projection", "op", sourceRefs.attention),
    ],
  });
}

function denseTree() {
  const prefix = "source/transformer/dense_decoder";
  return sourceItem(prefix, "Dense Decoder Layer", "module", sourceRefs.block, {
    repeatCount: 3,
    repeatRange: "0-2",
    instanceIndices: [0, 1, 2],
    observedInstanceIndices: [0, 1, 2],
    children: [
      sourceItem(`${prefix}/input_layernorm`, "Input RMSNorm", "op", sourceRefs.norm),
      attentionTree(prefix),
      sourceItem(`${prefix}/attention_residual`, "Attention Residual Add", "op", sourceRefs.block),
      sourceItem(`${prefix}/post_attention_layernorm`, "Post Attention RMSNorm", "op", sourceRefs.norm),
      sourceItem(`${prefix}/mlp`, "Dense Gated MLP", "module", sourceRefs.denseMlp, {
        defaultCollapsed: true,
        children: [
          sourceItem(`${prefix}/mlp/gate_up_proj`, "Gate and Up Projection", "op", sourceRefs.denseMlp),
          sourceItem(`${prefix}/mlp/activation`, "SiLU Gating", "op", sourceRefs.denseMlp),
          sourceItem(`${prefix}/mlp/down_proj`, "Down Projection", "op", sourceRefs.denseMlp),
        ],
      }),
      sourceItem(`${prefix}/mlp_residual`, "MLP Residual Add", "op", sourceRefs.block),
    ],
  });
}

function moeTree() {
  const prefix = "source/transformer/moe_decoder";
  const sharedId = `${prefix}/moe/shared_expert`;
  const routedId = `${prefix}/moe/routed_experts`;
  return sourceItem(prefix, "MoE Decoder Layer", "module", sourceRefs.block, {
    repeatCount: 58,
    repeatRange: "3-60",
    instanceIndices: Array.from({ length: 58 }, (_, index) => index + 3),
    observedInstanceIndices: [3, 4, 5],
    children: [
      sourceItem(`${prefix}/input_layernorm`, "Input RMSNorm", "op", sourceRefs.norm),
      attentionTree(prefix),
      sourceItem(`${prefix}/attention_residual`, "Attention Residual Add", "op", sourceRefs.block),
      sourceItem(`${prefix}/post_attention_layernorm`, "Post Attention RMSNorm", "op", sourceRefs.norm),
      sourceItem(`${prefix}/moe`, "Mixture of Experts", "module", sourceRefs.experts, {
        defaultCollapsed: true,
        layoutRows: [
          [`${prefix}/moe/router`],
          [`${prefix}/moe/topk_routing`],
          [`${prefix}/moe/expert_dispatch`],
          [sharedId, routedId],
          [`${prefix}/moe/combine`],
        ],
        children: [
          sourceItem(`${prefix}/moe/router`, "Expert Router", "op", sourceRefs.router),
          sourceItem(`${prefix}/moe/topk_routing`, "Expert Selection", "op", sourceRefs.router),
          sourceItem(`${prefix}/moe/expert_dispatch`, "Expert Token Dispatch", "op", sourceRefs.experts),
          sourceItem(sharedId, "Shared Expert", "module", sourceRefs.experts, {
            children: [
              sourceItem(`${sharedId}/quantization`, "Shared Expert Quantization", "op", sourceRefs.experts),
              sourceItem(`${sharedId}/gate_up_proj`, "Shared Gate and Up Projection", "op", sourceRefs.experts),
              sourceItem(`${sharedId}/activation`, "Shared SiLU Gating", "op", sourceRefs.experts),
              sourceItem(`${sharedId}/down_proj`, "Shared Down Projection", "op", sourceRefs.experts),
            ],
          }),
          sourceItem(routedId, "Routed Experts", "module", sourceRefs.experts, {
            repeatCount: 256,
            repeatRange: "experts",
            children: [
              sourceItem(`${routedId}/gate_up_proj`, "Routed Gate and Up Projection", "op", sourceRefs.experts),
              sourceItem(`${routedId}/activation`, "Routed SiLU Gating", "op", sourceRefs.experts),
              sourceItem(`${routedId}/down_proj`, "Routed Down Projection", "op", sourceRefs.experts),
            ],
          }),
          sourceItem(`${prefix}/moe/combine`, "Expert Output Combine", "op", sourceRefs.experts),
        ],
      }),
      sourceItem(`${prefix}/moe_residual`, "MoE Residual Add", "op", sourceRefs.block),
    ],
  });
}

function mtpTree() {
  const prefix = "source/transformer/mtp";
  const sharedId = `${prefix}/moe/shared_expert`;
  const routedId = `${prefix}/moe/routed_experts`;
  return sourceItem(prefix, "MTP Prediction Loop", "module", sourceRefs.mtp, {
    repeatCount: MTP_RUNTIME_ITERATIONS,
    repeatRange: "runtime iterations 0-2",
    instanceIndices: [0, 1, 2],
    observedInstanceIndices: [6, 7, 8],
    attrs: {
      learned_layer_count: MTP_LEARNED_LAYER_COUNT,
      learned_layer_index: MTP_LAYER_INDEX,
      runtime_iterations: MTP_RUNTIME_ITERATIONS,
      shares: [embeddingId, lmHeadId, "rotary_emb"],
    },
    children: [
      sourceItem(`${prefix}/preprocessing`, "Shared-input Preprocessing", "module", sourceRefs.mtpPreprocess, {
        defaultCollapsed: true,
        children: [
          sourceItem(`${prefix}/preprocessing/valid_mask`, "Embedding Valid Mask", "op", sourceRefs.mtpPreprocess),
          sourceItem(`${prefix}/preprocessing/embed_tokens`, "Shared Token Lookup", "op", sourceRefs.mtpShare),
          sourceItem(`${prefix}/preprocessing/rotary_cos`, "Shared Rotary Cosine", "op", sourceRefs.mtpShare),
          sourceItem(`${prefix}/preprocessing/embed_tp_reducescatter`, "Embedding Reduce Scatter", "op", sourceRefs.mtpPreprocess),
          sourceItem(`${prefix}/preprocessing/rotary_sin`, "Shared Rotary Sine", "op", sourceRefs.mtpShare),
        ],
      }),
      sourceItem(`${prefix}/enorm`, "Embedding RMSNorm", "op", sourceRefs.mtp),
      sourceItem(`${prefix}/hnorm`, "Previous Hidden RMSNorm", "op", sourceRefs.mtp),
      sourceItem(`${prefix}/hidden_concat`, "Embedding / Hidden Concatenate", "op", sourceRefs.mtp),
      sourceItem(`${prefix}/eh_proj`, "Embedding-Hidden Projection", "op", sourceRefs.mtp),
      sourceItem(`${prefix}/decoder_layer_61`, "Learned MTP Decoder Layer 61", "module", sourceRefs.mtp, {
        attrs: { learned_layer_count: MTP_LEARNED_LAYER_COUNT, layer_index: MTP_LAYER_INDEX },
        children: [
          sourceItem(`${prefix}/input_layernorm`, "Input RMSNorm", "op", sourceRefs.norm),
          attentionTree(prefix),
          sourceItem(`${prefix}/attention_residual`, "Attention Residual Add", "op", sourceRefs.block),
          sourceItem(`${prefix}/post_attention_layernorm`, "Post Attention RMSNorm", "op", sourceRefs.norm),
          sourceItem(`${prefix}/moe`, "Mixture of Experts", "module", sourceRefs.experts, {
            defaultCollapsed: true,
            layoutRows: [
              [`${prefix}/moe/router`],
              [`${prefix}/moe/topk_routing`],
              [`${prefix}/moe/expert_dispatch`],
              [sharedId, routedId],
              [`${prefix}/moe/combine`],
            ],
            children: [
              sourceItem(`${prefix}/moe/router`, "Expert Router", "op", sourceRefs.router),
              sourceItem(`${prefix}/moe/topk_routing`, "Expert Selection", "op", sourceRefs.router),
              sourceItem(`${prefix}/moe/expert_dispatch`, "Expert Token Dispatch", "op", sourceRefs.experts),
              sourceItem(sharedId, "Shared Expert", "module", sourceRefs.experts, {
                children: [
                  sourceItem(`${sharedId}/quantization`, "Shared Expert Quantization", "op", sourceRefs.experts),
                  sourceItem(`${sharedId}/gate_up_proj`, "Shared Gate and Up Projection", "op", sourceRefs.experts),
                  sourceItem(`${sharedId}/activation`, "Shared SiLU Gating", "op", sourceRefs.experts),
                  sourceItem(`${sharedId}/down_proj`, "Shared Down Projection", "op", sourceRefs.experts),
                ],
              }),
              sourceItem(routedId, "Routed Experts", "module", sourceRefs.experts, {
                repeatCount: 256,
                repeatRange: "experts",
                children: [
                  sourceItem(`${routedId}/gate_up_proj`, "Routed Gate and Up Projection", "op", sourceRefs.experts),
                  sourceItem(`${routedId}/activation`, "Routed SiLU Gating", "op", sourceRefs.experts),
                  sourceItem(`${routedId}/down_proj`, "Routed Down Projection", "op", sourceRefs.experts),
                ],
              }),
              sourceItem(`${prefix}/moe/combine`, "Expert Output Combine", "op", sourceRefs.experts),
            ],
          }),
          sourceItem(`${prefix}/moe_residual`, "MoE Residual Add", "op", sourceRefs.block),
        ],
      }),
      sourceItem(`${prefix}/shared_head_norm`, "Shared Head RMSNorm", "op", sourceRefs.mtpShare),
      sourceItem(`${prefix}/shared_lm_head`, "Shared Language Model Head", "module", sourceRefs.mtpShare, {
        attrs: { shared_with: lmHeadId },
        children: [
          sourceItem(`${prefix}/shared_lm_head/all_gather`, "Shared Hidden All Gather", "op", sourceRefs.lmHead),
          sourceItem(`${prefix}/shared_lm_head/vocab_projection`, "Shared Vocabulary Projection", "op", sourceRefs.lmHead),
          sourceItem(`${prefix}/shared_lm_head/all_to_all`, "Draft Logits All-to-All", "op", sourceRefs.lmHead),
          sourceItem(`${prefix}/shared_lm_head/vocab_reshape`, "Draft Vocabulary Reshape", "op", sourceRefs.lmHead),
          sourceItem(`${prefix}/shared_lm_head/logits_cast`, "Draft Logits FP32 Cast", "op", sourceRefs.lmHead),
          sourceItem("source/io/mtp_logits", "MTP Draft Logits", "output", sourceRefs.mtp),
        ],
      }),
    ],
  });
}

const embeddingId = "source/transformer/embedding";
const lmHeadId = "source/transformer/lm_head";
const mtpId = "source/transformer/mtp";
const transformerTree = sourceItem("source/transformer", "DeepSeek V3.2 Transformer", "module", sourceRefs.transformer, {
  children: [
    sourceItem("source/io/token_ids", "Token IDs", "input", sourceRefs.transformer),
    sourceItem(embeddingId, "Parallel Token Embedding", "module", sourceRefs.embedding, {
      children: [
        sourceItem(`${embeddingId}/weight`, "Embedding Weight", "state", sourceRefs.embedding, { stateType: "parameter", attrs: { shape: "[V,H]", dtype: "fp8_or_bf16" } }),
        sourceItem(`${embeddingId}/valid_mask`, "Embedding Valid Mask", "op", sourceRefs.embedding),
        sourceItem(`${embeddingId}/embed_tokens`, "Token Lookup", "op", sourceRefs.embedding),
        sourceItem(`${embeddingId}/rotary_cos`, "Rotary Cosine", "op", sourceRefs.rope),
        sourceItem(`${embeddingId}/rotary_sin`, "Rotary Sine", "op", sourceRefs.rope),
        sourceItem(`${embeddingId}/embed_tp_reducescatter`, "Embedding Reduce Scatter", "op", sourceRefs.embedding),
      ],
      layoutRows: [
        [`${embeddingId}/weight`, `${embeddingId}/valid_mask`, `${embeddingId}/embed_tokens`],
        [`${embeddingId}/rotary_cos`, `${embeddingId}/rotary_sin`],
        [`${embeddingId}/embed_tp_reducescatter`],
      ],
    }),
    denseTree(),
    moeTree(),
    sourceItem("source/transformer/final_norm", "Final RMSNorm", "op", sourceRefs.norm),
    sourceItem(lmHeadId, "Language Model Head", "module", sourceRefs.lmHead, {
      children: [
        sourceItem(`${lmHeadId}/weight`, "LM Head Weight", "state", sourceRefs.lmHead, { stateType: "parameter", attrs: { shape: "[V,H]", dtype: "fp8_or_bf16" } }),
        sourceItem(`${lmHeadId}/all_gather`, "Tensor-parallel Hidden All Gather", "op", sourceRefs.lmHead),
        sourceItem(`${lmHeadId}/all_gather_aiv`, "AIV All Gather", "op", sourceRefs.lmHead),
        sourceItem(`${lmHeadId}/vocab_projection`, "Vocabulary Projection", "op", sourceRefs.lmHead),
        sourceItem(`${lmHeadId}/all_to_all`, "Logits All-to-All", "op", sourceRefs.lmHead),
        sourceItem(`${lmHeadId}/vocab_reshape`, "Vocabulary Reshape", "op", sourceRefs.lmHead),
        sourceItem(`${lmHeadId}/logits_cast`, "Logits FP32 Cast", "op", sourceRefs.lmHead),
        sourceItem("source/io/logits", "Logits", "output", sourceRefs.lmHead),
      ],
    }),
    mtpTree(),
  ],
});

function findTreeItem(rootItem, id) {
  if (rootItem.id === id) return rootItem;
  for (const child of rootItem.children || []) {
    const found = findTreeItem(child, id);
    if (found) return found;
  }
  return null;
}

function backendItem(node, origin, graphPrefix = "trace") {
  const children = values(node.children).map((child) => backendItem(child, origin, graphPrefix));
  const repeatCount = Array.isArray(node.instance_indices) ? node.instance_indices.length : 0;
  return {
    id: `${graphPrefix}/${node.node_id}`,
    label: node.name || node.semantic_key || node.node_id.split("/").pop(),
    kind: children.length ? "module" : "op",
    typeLabel: origin === "runtime" ? "Runtime" : "Trace extension",
    colorKey: colorKey(`${node.semantic_key || ""} ${node.name || ""}`, children.length ? "module" : "op"),
    origin: origin === "runtime" ? "backend_runtime" : "backend_trace_extension",
    dataState: origin === "runtime" ? "runtime" : "backend_extension",
    selectable: true,
    backendNodeId: node.node_id,
    mappingKind: origin === "runtime" ? "backend_only_runtime" : "backend_trace_extension",
    repeatCount: repeatCount > 1 ? repeatCount : undefined,
    instanceIndices: repeatCount > 1 ? [...node.instance_indices] : undefined,
    observedInstanceIndices: repeatCount > 1 ? [...node.instance_indices] : undefined,
    defaultCollapsed: children.length > 0 && node.semantic_key !== "mtp_layer",
    children,
  };
}

const analysisNodes = collectAnalysisNodes();
const analysisById = new Map(analysisNodes.map((node) => [node.node_id, node]));
const perfById = collectPerfNodes();
const mtpBackendRoot = values(analysisConfig.layer_structure)
  .find((node) => node.semantic_key === "mtp_layer");
const runtimeBackendRoots = values(analysisConfig.runtime_auxiliary);

function sourceDestination(backendNodeId) {
  const embeddingPrefix = "model/deepseek-v3.2-exp/stages/embedding";
  const lmPrefix = "model/deepseek-v3.2-exp/stages/lm_head";
  const densePrefix = "model/deepseek-v3.2-exp/layers/dense_decoder_layer";
  const moePrefix = "model/deepseek-v3.2-exp/layers/moe_decoder_layer";
  const mtpSourcePrefix = "model/deepseek-v3.2-exp/layers/mtp_layer";
  const exact = new Map([
    [embeddingPrefix, embeddingId],
    [`${embeddingPrefix}/valid_mask`, `${embeddingId}/valid_mask`],
    [`${embeddingPrefix}/embed_tokens`, `${embeddingId}/embed_tokens`],
    [`${embeddingPrefix}/rotary_cos_gather`, `${embeddingId}/rotary_cos`],
    [`${embeddingPrefix}/rotary_sin_gather`, `${embeddingId}/rotary_sin`],
    [`${embeddingPrefix}/embed_tp_reducescatter`, `${embeddingId}/embed_tp_reducescatter`],
    ["model/deepseek-v3.2-exp/stages/main_final_norm", "source/transformer/final_norm"],
    [lmPrefix, lmHeadId],
    [`${lmPrefix}/tp_allgather`, `${lmHeadId}/all_gather`],
    [`${lmPrefix}/tp_allgather_aiv`, `${lmHeadId}/all_gather_aiv`],
    [`${lmPrefix}/vocab_proj`, `${lmHeadId}/vocab_projection`],
    [`${lmPrefix}/tp_alltoall`, `${lmHeadId}/all_to_all`],
    [`${lmPrefix}/vocab_reshape`, `${lmHeadId}/vocab_reshape`],
    [`${lmPrefix}/logits_cast`, `${lmHeadId}/logits_cast`],
  ]);
  if (exact.has(backendNodeId)) return exact.get(backendNodeId);

  const denseMap = new Map([
    ["", ""],
    ["input_layernorm", "input_layernorm"],
    ["self_attn", "self_attn"],
    ["self_attn/mla_prolog", "self_attn/mla_prolog"],
    ["self_attn/indexer", "self_attn/indexer"],
    ["self_attn/attn_core", "self_attn/attn_core"],
    ["self_attn/kv_b_absorb", "self_attn/kv_b_absorb"],
    ["self_attn/o_proj", "self_attn/o_proj"],
    ["post_attention_layernorm", "post_attention_layernorm"],
    ["mlp", "mlp"],
    ["mlp/gate_up_proj", "mlp/gate_up_proj"],
    ["mlp/activation", "mlp/activation"],
    ["mlp/down_proj", "mlp/down_proj"],
  ]);
  if (backendNodeId === densePrefix || backendNodeId.startsWith(`${densePrefix}/`)) {
    const suffix = backendNodeId.slice(densePrefix.length).replace(/^\//, "");
    if (denseMap.has(suffix)) return `source/transformer/dense_decoder${denseMap.get(suffix) ? `/${denseMap.get(suffix)}` : ""}`;
  }

  const moeMap = new Map([
    ["", ""],
    ["input_layernorm", "input_layernorm"],
    ["self_attn", "self_attn"],
    ["self_attn/mla_prolog", "self_attn/mla_prolog"],
    ["self_attn/indexer", "self_attn/indexer"],
    ["self_attn/attn_core", "self_attn/attn_core"],
    ["self_attn/kv_b_absorb", "self_attn/kv_b_absorb"],
    ["self_attn/o_proj", "self_attn/o_proj"],
    ["post_attention_layernorm", "post_attention_layernorm"],
    ["mlp", "moe"],
    ["mlp/gate", "moe/router"],
    ["mlp/topk_routing", "moe/topk_routing"],
    ["mlp/dispatch", "moe/expert_dispatch"],
    ["mlp/shared_expert", "moe/shared_expert"],
    ["mlp/shared_expert/shared_quant", "moe/shared_expert/quantization"],
    ["mlp/shared_expert/shared_gate_up", "moe/shared_expert/gate_up_proj"],
    ["mlp/shared_expert/shared_activation", "moe/shared_expert/activation"],
    ["mlp/shared_expert/shared_down", "moe/shared_expert/down_proj"],
    ["mlp/routed_experts", "moe/routed_experts"],
    ["mlp/routed_experts/gate_up", "moe/routed_experts/gate_up_proj"],
    ["mlp/routed_experts/activation", "moe/routed_experts/activation"],
    ["mlp/routed_experts/down", "moe/routed_experts/down_proj"],
    ["mlp/combine", "moe/combine"],
  ]);
  if (backendNodeId === moePrefix || backendNodeId.startsWith(`${moePrefix}/`)) {
    const suffix = backendNodeId.slice(moePrefix.length).replace(/^\//, "");
    if (moeMap.has(suffix)) return `source/transformer/moe_decoder${moeMap.get(suffix) ? `/${moeMap.get(suffix)}` : ""}`;
  }

  const mtpMap = new Map([
    ["", ""],
    ["preprocessing", "preprocessing"],
    ["preprocessing/valid_mask", "preprocessing/valid_mask"],
    ["preprocessing/embed_tokens", "preprocessing/embed_tokens"],
    ["preprocessing/rotary_cos_gather", "preprocessing/rotary_cos"],
    ["preprocessing/embed_tp_reducescatter", "preprocessing/embed_tp_reducescatter"],
    ["preprocessing/rotary_sin_gather", "preprocessing/rotary_sin"],
    ["enorm", "enorm"],
    ["hnorm", "hnorm"],
    ["eh_proj", "eh_proj"],
    ["input_layernorm", "input_layernorm"],
    ["self_attn", "self_attn"],
    ["self_attn/mla_prolog", "self_attn/mla_prolog"],
    ["self_attn/indexer", "self_attn/indexer"],
    ["self_attn/attn_core", "self_attn/attn_core"],
    ["self_attn/kv_b_absorb", "self_attn/kv_b_absorb"],
    ["self_attn/o_proj", "self_attn/o_proj"],
    ["post_attention_layernorm", "post_attention_layernorm"],
    ["mlp", "moe"],
    ["mlp/gate", "moe/router"],
    ["mlp/topk_routing", "moe/topk_routing"],
    ["mlp/dispatch", "moe/expert_dispatch"],
    ["mlp/shared_expert", "moe/shared_expert"],
    ["mlp/shared_expert/shared_quant", "moe/shared_expert/quantization"],
    ["mlp/shared_expert/shared_gate_up", "moe/shared_expert/gate_up_proj"],
    ["mlp/shared_expert/shared_activation", "moe/shared_expert/activation"],
    ["mlp/shared_expert/shared_down", "moe/shared_expert/down_proj"],
    ["mlp/routed_experts", "moe/routed_experts"],
    ["mlp/routed_experts/gate_up", "moe/routed_experts/gate_up_proj"],
    ["mlp/routed_experts/activation", "moe/routed_experts/activation"],
    ["mlp/routed_experts/down", "moe/routed_experts/down_proj"],
    ["mlp/combine", "moe/combine"],
    ["shared_head_norm", "shared_head_norm"],
  ]);
  if (backendNodeId === mtpSourcePrefix || backendNodeId.startsWith(`${mtpSourcePrefix}/`)) {
    const suffix = backendNodeId.slice(mtpSourcePrefix.length).replace(/^\//, "");
    if (mtpMap.has(suffix)) return `${mtpId}${mtpMap.get(suffix) ? `/${mtpMap.get(suffix)}` : ""}`;
  }
  return "";
}

function mappingKindFor(backendNodeId, sourceNodeId) {
  const semantic = analysisById.get(backendNodeId)?.semantic_key || "";
  const aggregateSemantics = new Set([
    "embedding", "lm_head", "dense_decoder_layer", "moe_decoder_layer", "mtp_layer", "preprocessing", "self_attn", "mla_prolog", "indexer", "mlp", "shared_expert", "routed_experts",
  ]);
  if (aggregateSemantics.has(semantic)) return "aggregate";
  if (/rotary_(?:cos|sin)_gather$/.test(semantic)) return "alias";
  if (sourceNodeId) return "exact";
  return "backend_trace_extension";
}

const mtpPrefix = mtpBackendRoot?.node_id || "model/deepseek-v3.2-exp/layers/mtp_layer";
const runtimePrefix = "model/deepseek-v3.2-exp/runtime/";
const mappings = [];
const sourceMappedBy = new Map();
const extensionItems = [];

for (const backendNode of analysisNodes) {
  if (backendNode.node_id.startsWith(runtimePrefix)) continue;
  const destination = sourceDestination(backendNode.node_id);
  if (destination) {
    sourceMappedBy.set(destination, backendNode.node_id);
    mappings.push({
      backend_node_id: backendNode.node_id,
      source_node_ids: [destination],
      projected_graph_node_id: destination,
      mapping_kind: mappingKindFor(backendNode.node_id, destination),
      evidence: [
        `backend semantic path: ${backendNode.node_id}`,
        `backend code_ref: ${backendNode.code_ref || "not supplied"}`,
        `locked runtime source role: ${destination}`,
      ],
      review_state: "resolved",
    });
    continue;
  }

  const parentDestination = sourceDestination(backendNode.parent_node_id || "");
  const extension = {
    id: `trace/${backendNode.node_id}`,
    label: backendNode.name,
    kind: "op",
    typeLabel: "Trace extension",
    colorKey: colorKey(`${backendNode.semantic_key} ${backendNode.name}`),
    origin: "backend_trace_extension",
    dataState: "backend_extension",
    selectable: true,
    backendNodeId: backendNode.node_id,
    mappingKind: "backend_trace_extension",
    children: [],
  };
  const parent = parentDestination ? findTreeItem(transformerTree, parentDestination) : null;
  if (parent) parent.children.push(extension);
  else extensionItems.push(extension);
  mappings.push({
    backend_node_id: backendNode.node_id,
    source_node_ids: [],
    projected_graph_node_id: extension.id,
    mapping_kind: "backend_trace_extension",
    evidence: [
      `backend semantic path: ${backendNode.node_id}`,
      `implementation trace node without an equivalent canonical architecture role`,
    ],
    review_state: "documented_conflict",
  });
}

if (extensionItems.length) {
  transformerTree.children.push({
    id: "trace/backend_implementation_details",
    label: "Backend Implementation Details",
    kind: "module",
    typeLabel: "Trace detail",
    colorKey: "module:model",
    origin: "backend_trace_extension",
    dataState: "backend_extension",
    selectable: false,
    defaultCollapsed: true,
    children: extensionItems,
  });
}

function decorateSourceMappings(item) {
  const backendNodeId = sourceMappedBy.get(item.id);
  if (backendNodeId) {
    item.backendNodeId = backendNodeId;
    item.dataState = "mapped";
    item.selectable = true;
    item.mappingKind = mappingKindFor(backendNodeId, item.id);
  }
  (item.children || []).forEach(decorateSourceMappings);
}
decorateSourceMappings(transformerTree);

const runtimeTrees = runtimeBackendRoots.map((node) => backendItem(node, "runtime", "runtime"));
runtimeTrees.forEach((item) => mappings.push({
  backend_node_id: item.backendNodeId,
  source_node_ids: [],
  projected_graph_node_id: item.id,
  mapping_kind: "backend_only_runtime",
  evidence: ["analysis_config.runtime_auxiliary"],
  review_state: "resolved",
}));

const sourceNodes = [];
(function collectSource(item) {
  if (item.origin === "source") sourceNodes.push(item);
  (item.children || []).forEach(collectSource);
}(transformerTree));

function canonicalNode(item) {
  const node = {
    id: item.id,
    label: item.label,
    kind: item.kind,
    attrs: item.attrs || {},
    provenance: item.sourceRefs || sourceRefs.transformer,
  };
  if (item.kind === "state") node.state_type = item.stateType || "state";
  if (item.repeatCount) node.scope = { repeat_count: item.repeatCount, range: item.repeatRange };
  return node;
}

function edge(id, source, target, refs, tensor, extra = {}) {
  return {
    id,
    source,
    target,
    tensor,
    provenance: refs,
    ...extra,
  };
}

function attentionEdges(prefix) {
  const q = `${prefix}/self_attn/mla_prolog/query_path`;
  const kv = `${prefix}/self_attn/mla_prolog/kv_path`;
  const index = `${prefix}/self_attn/indexer`;
  const core = `${prefix}/self_attn/attn_core`;
  return [
    edge(`${prefix}/e_q_down`, `${prefix}/input_layernorm`, `${q}/q_down_proj`, sourceRefs.attention, { name: "hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
    edge(`${prefix}/e_q_norm`, `${q}/q_down_proj`, `${q}/q_norm`, sourceRefs.attention, { name: "q_compressed", shape: "[B,T,Q]", dtype: "bf16" }),
    edge(`${prefix}/e_q_up`, `${q}/q_norm`, `${q}/q_up_proj`, sourceRefs.attention, { name: "q_latent", shape: "[B,T,Q]", dtype: "bf16" }),
    edge(`${prefix}/e_q_rope`, `${q}/q_up_proj`, `${q}/q_rope`, sourceRefs.rope, { name: "query_heads", shape: "[B,T,N,Dq]", dtype: "bf16" }),
    edge(`${prefix}/e_kv_down`, `${prefix}/input_layernorm`, `${kv}/kv_down_proj`, sourceRefs.attention, { name: "hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
    edge(`${prefix}/e_kv_norm`, `${kv}/kv_down_proj`, `${kv}/kv_norm`, sourceRefs.attention, { name: "kv_latent", shape: "[B,T,K]", dtype: "bf16" }),
    edge(`${prefix}/e_k_rope`, `${kv}/kv_norm`, `${kv}/k_rope`, sourceRefs.rope, { name: "key_rope", shape: "[B,T,R]", dtype: "bf16" }),
    edge(`${prefix}/e_index_q`, `${q}/q_norm`, `${index}/query_projection`, sourceRefs.indexer, { name: "q_latent", shape: "[B,T,Q]", dtype: "bf16" }),
    edge(`${prefix}/e_index_k`, `${prefix}/input_layernorm`, `${index}/key_projection`, sourceRefs.indexer, { name: "hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
    edge(`${prefix}/e_index_knorm`, `${index}/key_projection`, `${index}/key_norm`, sourceRefs.indexer, { name: "index_key", shape: "[B,T,Di]", dtype: "bf16" }),
    edge(`${prefix}/e_index_weight`, `${prefix}/input_layernorm`, `${index}/weight_projection`, sourceRefs.indexer, { name: "hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
    edge(`${prefix}/e_index_cache`, `${index}/key_norm`, `${index}/key_cache`, sourceRefs.indexer, { name: "index_key", shape: "[B,T,Di]", dtype: "fp8" }),
    edge(`${prefix}/e_index_scale`, `${index}/key_norm`, `${index}/scale_cache`, sourceRefs.indexer, { name: "index_scale", shape: "[B,T,Di/block]", dtype: "fp32" }),
    edge(`${prefix}/e_index_score`, `${index}/query_projection`, `${index}/index_score`, sourceRefs.indexer, { name: "index_query", shape: "[B,T,Ni,Di]", dtype: "fp8" }),
    edge(`${prefix}/e_cached_index_score`, `${index}/key_cache`, `${index}/index_score`, sourceRefs.indexer, { name: "cached_index_key", dtype: "fp8" }),
    edge(`${prefix}/e_index_topk`, `${index}/index_score`, `${index}/topk_select`, sourceRefs.indexer, { name: "index_scores", shape: "[B,T,S]", dtype: "fp32", constraints: ["selected positions limited by index_topk"] }),
    edge(`${prefix}/e_q_core`, `${q}/q_rope`, core, sourceRefs.attention, { name: "query", shape: "[B,T,N,Dq]", dtype: "bf16" }),
    edge(`${prefix}/e_k_core`, `${kv}/k_rope`, core, sourceRefs.attention, { name: "key_rope", shape: "[B,T,R]", dtype: "bf16" }),
    edge(`${prefix}/e_sparse_core`, `${index}/topk_select`, core, sourceRefs.attention, { name: "sparse_indices", shape: "[B,T,I]", dtype: "int32", constraints: ["I<=index_topk"] }),
    edge(`${prefix}/e_kv_cache`, `${kv}/kv_norm`, `${prefix}/self_attn/kv_cache`, sourceRefs.attention, { name: "kv_latent", shape: "[B,T,K]", dtype: "bf16" }),
    edge(`${prefix}/e_pe_cache`, `${kv}/k_rope`, `${prefix}/self_attn/pe_cache`, sourceRefs.attention, { name: "key_rope", shape: "[B,T,R]", dtype: "bf16" }),
    edge(`${prefix}/e_core_absorb`, core, `${prefix}/self_attn/kv_b_absorb`, sourceRefs.attention, { name: "attention_context", shape: "[B,T,N,Dv]", dtype: "bf16" }),
    edge(`${prefix}/e_absorb_out`, `${prefix}/self_attn/kv_b_absorb`, `${prefix}/self_attn/o_proj`, sourceRefs.attention, { name: "head_context", shape: "[B,T,N,Dv]", dtype: "bf16" }),
  ];
}

function moeEdges(prefix) {
  return [
    edge(`${prefix}/e_moe_router`, `${prefix}/post_attention_layernorm`, `${prefix}/moe/router`, sourceRefs.router, { name: "normalized_hidden", shape: "[B,T,H]", dtype: "bf16" }),
    edge(`${prefix}/e_moe_topk`, `${prefix}/moe/router`, `${prefix}/moe/topk_routing`, sourceRefs.router, { name: "router_scores", shape: "[B*T,E]", dtype: "fp32", constraints: ["E=256", "selected experts=8"] }),
    edge(`${prefix}/e_moe_dispatch`, `${prefix}/moe/topk_routing`, `${prefix}/moe/expert_dispatch`, sourceRefs.experts, { name: "expert_indices", shape: "[B*T,K]", dtype: "int64", constraints: ["K=8"] }),
    edge(`${prefix}/e_dispatch_shared`, `${prefix}/moe/expert_dispatch`, `${prefix}/moe/shared_expert/quantization`, sourceRefs.experts, { name: "all_tokens", shape: "[B*T,H]", dtype: "bf16" }),
    edge(`${prefix}/e_shared_gate_up`, `${prefix}/moe/shared_expert/quantization`, `${prefix}/moe/shared_expert/gate_up_proj`, sourceRefs.experts, { name: "quantized_shared_tokens", dtype: "int8" }),
    edge(`${prefix}/e_shared_activation`, `${prefix}/moe/shared_expert/gate_up_proj`, `${prefix}/moe/shared_expert/activation`, sourceRefs.experts, { name: "shared_gate_up", dtype: "bf16" }),
    edge(`${prefix}/e_shared_down`, `${prefix}/moe/shared_expert/activation`, `${prefix}/moe/shared_expert/down_proj`, sourceRefs.experts, { name: "shared_activated", dtype: "bf16" }),
    edge(`${prefix}/e_dispatch_routed`, `${prefix}/moe/expert_dispatch`, `${prefix}/moe/routed_experts/gate_up_proj`, sourceRefs.experts, { name: "routed_tokens", dtype: "bf16" }),
    edge(`${prefix}/e_routed_activation`, `${prefix}/moe/routed_experts/gate_up_proj`, `${prefix}/moe/routed_experts/activation`, sourceRefs.experts, { name: "routed_gate_up", dtype: "bf16" }),
    edge(`${prefix}/e_routed_down`, `${prefix}/moe/routed_experts/activation`, `${prefix}/moe/routed_experts/down_proj`, sourceRefs.experts, { name: "routed_activated", dtype: "bf16" }),
    edge(`${prefix}/e_shared_combine`, `${prefix}/moe/shared_expert/down_proj`, `${prefix}/moe/combine`, sourceRefs.experts, { name: "shared_output", shape: "[B*T,H]", dtype: "bf16" }),
    edge(`${prefix}/e_routed_combine`, `${prefix}/moe/routed_experts/down_proj`, `${prefix}/moe/combine`, sourceRefs.experts, { name: "weighted_expert_output", shape: "[B*T,H]", dtype: "bf16" }),
  ];
}

const canonicalEdges = [
  edge("e_embedding_mask", "source/io/token_ids", `${embeddingId}/valid_mask`, sourceRefs.embedding, { name: "input_ids", shape: "[B,T]", dtype: "int64" }),
  edge("e_token_embedding", `${embeddingId}/valid_mask`, `${embeddingId}/embed_tokens`, sourceRefs.embedding, { name: "masked_input_ids", shape: "[B,T]", dtype: "int64" }),
  edge("e_embedding_weight", `${embeddingId}/weight`, `${embeddingId}/embed_tokens`, sourceRefs.embedding, { name: "embedding_weight", shape: "[V,H]", dtype: "fp8_or_bf16", constraints: ["V=129280", "H=7168"] }, { edgeType: "parameter", dashed: true }),
  edge("e_embedding_reduce", `${embeddingId}/embed_tokens`, `${embeddingId}/embed_tp_reducescatter`, sourceRefs.embedding, { name: "hidden_states", shape: "[B,T,H]", dtype: "bf16" }, { edgeType: "communication" }),
  edge("e_embed_dense", `${embeddingId}/embed_tp_reducescatter`, "source/transformer/dense_decoder/input_layernorm", sourceRefs.block, { name: "hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
  ...attentionEdges("source/transformer/dense_decoder"),
  edge("e_dense_attn_residual", "source/transformer/dense_decoder/self_attn/o_proj", "source/transformer/dense_decoder/attention_residual", sourceRefs.block, { name: "attention_output", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_dense_post_norm", "source/transformer/dense_decoder/attention_residual", "source/transformer/dense_decoder/post_attention_layernorm", sourceRefs.block, { name: "hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_dense_gate_up", "source/transformer/dense_decoder/post_attention_layernorm", "source/transformer/dense_decoder/mlp/gate_up_proj", sourceRefs.denseMlp, { name: "normalized_hidden", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_dense_activation", "source/transformer/dense_decoder/mlp/gate_up_proj", "source/transformer/dense_decoder/mlp/activation", sourceRefs.denseMlp, { name: "gate_and_up", shape: "[B,T,2M]", dtype: "bf16" }),
  edge("e_dense_down", "source/transformer/dense_decoder/mlp/activation", "source/transformer/dense_decoder/mlp/down_proj", sourceRefs.denseMlp, { name: "activated_hidden", shape: "[B,T,M]", dtype: "bf16" }),
  edge("e_dense_mlp_residual", "source/transformer/dense_decoder/mlp/down_proj", "source/transformer/dense_decoder/mlp_residual", sourceRefs.block, { name: "mlp_output", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_dense_moe", "source/transformer/dense_decoder/mlp_residual", "source/transformer/moe_decoder/input_layernorm", sourceRefs.block, { name: "hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
  ...attentionEdges("source/transformer/moe_decoder"),
  edge("e_moe_attn_residual", "source/transformer/moe_decoder/self_attn/o_proj", "source/transformer/moe_decoder/attention_residual", sourceRefs.block, { name: "attention_output", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_moe_post_norm", "source/transformer/moe_decoder/attention_residual", "source/transformer/moe_decoder/post_attention_layernorm", sourceRefs.block, { name: "hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_moe_router", "source/transformer/moe_decoder/post_attention_layernorm", "source/transformer/moe_decoder/moe/router", sourceRefs.router, { name: "normalized_hidden", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_moe_topk", "source/transformer/moe_decoder/moe/router", "source/transformer/moe_decoder/moe/topk_routing", sourceRefs.router, { name: "router_scores", shape: "[B*T,E]", dtype: "fp32", constraints: ["E=256", "selected experts=8"] }),
  edge("e_moe_dispatch", "source/transformer/moe_decoder/moe/topk_routing", "source/transformer/moe_decoder/moe/expert_dispatch", sourceRefs.experts, { name: "expert_indices", shape: "[B*T,K]", dtype: "int64", constraints: ["K=8"] }),
  edge("e_dispatch_shared", "source/transformer/moe_decoder/moe/expert_dispatch", "source/transformer/moe_decoder/moe/shared_expert/quantization", sourceRefs.experts, { name: "all_tokens", shape: "[B*T,H]", dtype: "bf16" }),
  edge("e_shared_quant", "source/transformer/moe_decoder/moe/shared_expert/quantization", "source/transformer/moe_decoder/moe/shared_expert/gate_up_proj", sourceRefs.experts, { name: "quantized_shared_tokens", dtype: "int8" }),
  edge("e_shared_activation", "source/transformer/moe_decoder/moe/shared_expert/gate_up_proj", "source/transformer/moe_decoder/moe/shared_expert/activation", sourceRefs.experts, { name: "shared_gate_up", dtype: "bf16" }),
  edge("e_shared_down", "source/transformer/moe_decoder/moe/shared_expert/activation", "source/transformer/moe_decoder/moe/shared_expert/down_proj", sourceRefs.experts, { name: "shared_activated", dtype: "bf16" }),
  edge("e_dispatch_routed", "source/transformer/moe_decoder/moe/expert_dispatch", "source/transformer/moe_decoder/moe/routed_experts/gate_up_proj", sourceRefs.experts, { name: "routed_tokens", dtype: "bf16" }),
  edge("e_routed_activation", "source/transformer/moe_decoder/moe/routed_experts/gate_up_proj", "source/transformer/moe_decoder/moe/routed_experts/activation", sourceRefs.experts, { name: "routed_gate_up", dtype: "bf16" }),
  edge("e_routed_down", "source/transformer/moe_decoder/moe/routed_experts/activation", "source/transformer/moe_decoder/moe/routed_experts/down_proj", sourceRefs.experts, { name: "routed_activated", dtype: "bf16" }),
  edge("e_shared_combine", "source/transformer/moe_decoder/moe/shared_expert/down_proj", "source/transformer/moe_decoder/moe/combine", sourceRefs.experts, { name: "shared_output", shape: "[B*T,H]", dtype: "bf16" }),
  edge("e_routed_combine", "source/transformer/moe_decoder/moe/routed_experts/down_proj", "source/transformer/moe_decoder/moe/combine", sourceRefs.experts, { name: "weighted_expert_output", shape: "[B*T,H]", dtype: "bf16" }),
  edge("e_moe_residual", "source/transformer/moe_decoder/moe/combine", "source/transformer/moe_decoder/moe_residual", sourceRefs.block, { name: "moe_output", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_final_norm", "source/transformer/moe_decoder/moe_residual", "source/transformer/final_norm", sourceRefs.transformer, { name: "hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_lm_hidden_gather", "source/transformer/final_norm", `${lmHeadId}/all_gather`, sourceRefs.lmHead, { name: "normalized_hidden", shape: "[B,T,H]", dtype: "bf16" }, { edgeType: "communication" }),
  edge("e_lm_aiv_gather", `${lmHeadId}/all_gather`, `${lmHeadId}/all_gather_aiv`, sourceRefs.lmHead, { name: "gathered_hidden", shape: "[B,T,H]", dtype: "bf16" }, { edgeType: "communication" }),
  edge("e_lm_projection", `${lmHeadId}/all_gather_aiv`, `${lmHeadId}/vocab_projection`, sourceRefs.lmHead, { name: "gathered_hidden", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_lm_weight", `${lmHeadId}/weight`, `${lmHeadId}/vocab_projection`, sourceRefs.lmHead, { name: "lm_head_weight", shape: "[V,H]", dtype: "fp8_or_bf16" }, { edgeType: "parameter", dashed: true }),
  edge("e_logits_all_to_all", `${lmHeadId}/vocab_projection`, `${lmHeadId}/all_to_all`, sourceRefs.lmHead, { name: "vocab_shard_logits", shape: "[B,T,V/world]", dtype: "bf16" }, { edgeType: "communication" }),
  edge("e_logits_reshape", `${lmHeadId}/all_to_all`, `${lmHeadId}/vocab_reshape`, sourceRefs.lmHead, { name: "distributed_logits", dtype: "bf16" }),
  edge("e_logits_cast", `${lmHeadId}/vocab_reshape`, `${lmHeadId}/logits_cast`, sourceRefs.lmHead, { name: "reshaped_logits", shape: "[B,T,V]", dtype: "bf16" }),
  edge("e_logits", `${lmHeadId}/logits_cast`, "source/io/logits", sourceRefs.lmHead, { name: "logits", shape: "[B,T,V]", dtype: "fp32" }),
  edge("e_mtp_valid_mask", "source/io/token_ids", `${mtpId}/preprocessing/valid_mask`, sourceRefs.mtpPreprocess, { name: "draft_input_ids", shape: "[B,T]", dtype: "int64" }),
  edge("e_mtp_token_lookup", `${mtpId}/preprocessing/valid_mask`, `${mtpId}/preprocessing/embed_tokens`, sourceRefs.mtpPreprocess, { name: "masked_input_ids", shape: "[B,T]", dtype: "int64" }),
  edge("e_mtp_shared_embedding_weight", `${embeddingId}/weight`, `${mtpId}/preprocessing/embed_tokens`, sourceRefs.mtpShare, { name: "shared_embedding_weight", shape: "[V,H]", dtype: "fp8_or_bf16" }, { edgeType: "parameter", dashed: true }),
  edge("e_mtp_embedding_reduce", `${mtpId}/preprocessing/embed_tokens`, `${mtpId}/preprocessing/embed_tp_reducescatter`, sourceRefs.mtpPreprocess, { name: "mtp_input_embedding", shape: "[B,T,H]", dtype: "bf16" }, { edgeType: "communication" }),
  edge("e_mtp_rotary_cos", `${mtpId}/preprocessing/embed_tokens`, `${mtpId}/preprocessing/rotary_cos`, sourceRefs.mtpShare, { name: "rotary_input", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_mtp_rotary_sin", `${mtpId}/preprocessing/embed_tokens`, `${mtpId}/preprocessing/rotary_sin`, sourceRefs.mtpShare, { name: "rotary_input", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_mtp_enorm", `${mtpId}/preprocessing/embed_tp_reducescatter`, `${mtpId}/enorm`, sourceRefs.mtp, { name: "input_embedding", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_mtp_hnorm", "source/transformer/final_norm", `${mtpId}/hnorm`, sourceRefs.mtp, { name: "previous_hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_mtp_concat_embedding", `${mtpId}/enorm`, `${mtpId}/hidden_concat`, sourceRefs.mtp, { name: "normalized_embedding", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_mtp_concat_hidden", `${mtpId}/hnorm`, `${mtpId}/hidden_concat`, sourceRefs.mtp, { name: "normalized_previous_hidden", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_mtp_fusion_projection", `${mtpId}/hidden_concat`, `${mtpId}/eh_proj`, sourceRefs.mtp, { name: "embedding_hidden_concat", shape: "[B,T,2H]", dtype: "bf16" }),
  edge("e_mtp_decoder_input", `${mtpId}/eh_proj`, `${mtpId}/input_layernorm`, sourceRefs.mtp, { name: "fused_hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
  ...attentionEdges(mtpId),
  edge("e_mtp_attn_residual", `${mtpId}/self_attn/o_proj`, `${mtpId}/attention_residual`, sourceRefs.block, { name: "attention_output", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_mtp_post_norm", `${mtpId}/attention_residual`, `${mtpId}/post_attention_layernorm`, sourceRefs.block, { name: "hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
  ...moeEdges(mtpId),
  edge("e_mtp_moe_residual", `${mtpId}/moe/combine`, `${mtpId}/moe_residual`, sourceRefs.block, { name: "moe_output", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_mtp_shared_head_norm", `${mtpId}/moe_residual`, `${mtpId}/shared_head_norm`, sourceRefs.mtp, { name: "mtp_hidden_states", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_mtp_shared_hidden_gather", `${mtpId}/shared_head_norm`, `${mtpId}/shared_lm_head/all_gather`, sourceRefs.mtpShare, { name: "normalized_mtp_hidden", shape: "[B,T,H]", dtype: "bf16" }, { edgeType: "communication" }),
  edge("e_mtp_shared_lm_projection", `${mtpId}/shared_lm_head/all_gather`, `${mtpId}/shared_lm_head/vocab_projection`, sourceRefs.mtpShare, { name: "gathered_mtp_hidden", shape: "[B,T,H]", dtype: "bf16" }),
  edge("e_mtp_shared_lm_weight", `${lmHeadId}/weight`, `${mtpId}/shared_lm_head/vocab_projection`, sourceRefs.mtpShare, { name: "shared_lm_head_weight", shape: "[V,H]", dtype: "fp8_or_bf16" }, { edgeType: "parameter", dashed: true }),
  edge("e_mtp_logits_all_to_all", `${mtpId}/shared_lm_head/vocab_projection`, `${mtpId}/shared_lm_head/all_to_all`, sourceRefs.lmHead, { name: "draft_vocab_shard_logits", shape: "[B,T,V/world]", dtype: "bf16" }, { edgeType: "communication" }),
  edge("e_mtp_logits_reshape", `${mtpId}/shared_lm_head/all_to_all`, `${mtpId}/shared_lm_head/vocab_reshape`, sourceRefs.lmHead, { name: "distributed_draft_logits", dtype: "bf16" }),
  edge("e_mtp_logits_cast", `${mtpId}/shared_lm_head/vocab_reshape`, `${mtpId}/shared_lm_head/logits_cast`, sourceRefs.lmHead, { name: "reshaped_draft_logits", shape: "[B,T,V]", dtype: "bf16" }),
  edge("e_mtp_logits", `${mtpId}/shared_lm_head/logits_cast`, "source/io/mtp_logits", sourceRefs.mtp, { name: "draft_logits", shape: "[B,T,V]", dtype: "fp32" }),
];

const sourceManifestFiles = await Promise.all(Object.entries(EXPECTED_HASHES).map(async ([relativePath, expectedSha256]) => {
  const actualSha256 = await sha256(resolve(root, relativePath));
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Locked source hash mismatch for ${relativePath}: ${actualSha256}`);
  }
  return {
    path: relativePath,
    sha256: actualSha256,
    role: relativePath.includes("config") ? "runtime_config" : "source_of_truth",
  };
}));

const sourceManifest = {
  schema_version: "model_source_manifest.v1",
  model_id: analysisConfig.model_id,
  model_name: analysisConfig.model_name,
  repositories: [
    {
      source_id: "deepseek_official",
      source_repo: "https://github.com/deepseek-ai/DeepSeek-V3.2-Exp",
      source_revision: DEEPSEEK_REVISION,
      config_revision: DEEPSEEK_REVISION,
      license: "MIT",
    },
    {
      source_id: "transformers_official",
      source_repo: "https://github.com/huggingface/transformers",
      source_revision: TRANSFORMERS_REVISION,
      model_implementation: "src/transformers/models/deepseek_v32",
      license: "Apache-2.0",
    },
    {
      source_id: "ui_json_runtime",
      source_repo: "https://gitcode.com/yinyucheng0601/ui-json",
      source_revision: UI_JSON_REVISION,
      config_revision: UI_JSON_REVISION,
      model_implementation: "model/models/modeling_deepseek.py",
      license: "CANN Open Software License Agreement 2.0",
    },
  ],
  files: sourceManifestFiles,
  verification_state: "runtime_source_locked",
  runtime_equivalence: "source_structure_verified",
  reason: "ui-json now provides the model source used for node mapping, locked at commit f6262f5; official sources remain cross-check baselines.",
};

const canonicalArchitecture = {
  schema_version: "model_architecture.v1",
  model: {
    id: analysisConfig.model_id,
    name: "DeepSeek V3.2 Experimental",
    framework: "pytorch",
    source_revision: UI_JSON_REVISION,
  },
  extraction_scope: {
    kind: "full_source",
    full_main_layers: runtimeConfig.n_layers,
    dense_layer_range: "0-2",
    moe_layer_range: "3-60",
    includes_mtp: true,
    mtp_learned_layers: MTP_LEARNED_LAYER_COUNT,
    mtp_layer_index: MTP_LAYER_INDEX,
    mtp_runtime_iterations: MTP_RUNTIME_ITERATIONS,
    notes: [
      "The model architecture is extracted from the locked ui-json runtime source and cross-checked against official source snapshots.",
      "MTP has one learned decoder layer at model layer index 61; runner next_n=3 executes that same module three times.",
      "MTP reuses the main model embedding, rotary embedding, and language-model head.",
      "Repeated layers use folded templates rather than 61 duplicated graph instances.",
    ],
  },
  sources: sourceManifest.repositories.map((repository) => ({
    source_id: repository.source_id,
    repository: repository.source_repo,
    revision: repository.source_revision,
  })),
  symbol_table: {
    B: "batch",
    T: "sequence",
    H: runtimeConfig.dim,
    V: runtimeConfig.vocab_size,
    L: runtimeConfig.n_layers,
    dense_layers: "0-2",
    moe_layers: "3-60",
    attention_heads: runtimeConfig.n_heads,
    routed_experts: runtimeConfig.n_routed_experts,
    shared_experts: runtimeConfig.n_shared_experts,
    activated_experts: runtimeConfig.n_activated_experts,
    q_lora_rank: runtimeConfig.q_lora_rank,
    kv_lora_rank: runtimeConfig.kv_lora_rank,
    index_heads: runtimeConfig.index_n_heads,
    index_dim: runtimeConfig.index_head_dim,
    index_topk: runtimeConfig.index_topk,
    mtp_learned_layers: MTP_LEARNED_LAYER_COUNT,
    mtp_layer_index: MTP_LAYER_INDEX,
    mtp_runtime_iterations: MTP_RUNTIME_ITERATIONS,
  },
  nodes: sourceNodes.map(canonicalNode),
  edges: canonicalEdges,
  repeats: [
    { id: "dense_decoder_repeat", template_node: "source/transformer/dense_decoder", range: "0-2", count: 3 },
    { id: "moe_decoder_repeat", template_node: "source/transformer/moe_decoder", range: "3-60", count: 58 },
    { id: "routed_expert_repeat", template_node: "source/transformer/moe_decoder/moe/routed_experts", count: runtimeConfig.n_routed_experts },
    { id: "mtp_learned_layer", template_node: `${mtpId}/decoder_layer_61`, range: "61", count: MTP_LEARNED_LAYER_COUNT },
    { id: "mtp_runtime_loop", template_node: mtpId, range: "runtime iterations 0-2", count: MTP_RUNTIME_ITERATIONS, provenance: sourceRefs.mtpLoop },
    { id: "mtp_routed_expert_repeat", template_node: `${mtpId}/moe/routed_experts`, count: runtimeConfig.n_routed_experts },
  ],
  branches: [
    { id: "dense_or_moe", condition: "layer_id < n_dense_layers", true_target: "source/transformer/dense_decoder", false_target: "source/transformer/moe_decoder", provenance: sourceRefs.block },
    { id: "attention_prefill_or_decode", condition: "mask is not None", targets: ["MHA prefill", "MQA decode"], provenance: sourceRefs.attention },
  ],
  warnings: [
    "The representative trace observes only main layers 0-5; layers 6-60 remain source-only in this report.",
    "Profiler implementation scaffolding stays distinct from canonical model architecture roles.",
  ],
  validation: {
    source_hashes_verified: true,
    config_layer_count_verified: runtimeConfig.n_layers === 61,
    extraction_scope: "full_source",
  },
};

const timelineOwnerIds = [...new Set(values(timelineData.events).map((event) => event.owner_node_id).filter(Boolean))].sort();
const backendTraceOverlay = {
  schema_version: "backend_trace_overlay.v1",
  model_id: analysisConfig.model_id,
  report_id: analysisConfig.report_id,
  scope: "trace_slice",
  representative_step: analysisConfig.representative_step,
  nodes: analysisNodes.map((node) => ({ ...node, metrics: perfById.get(node.node_id) || null })),
  runtime_auxiliary: runtimeBackendRoots.map((node) => node.node_id),
  timeline_owner_ids: timelineOwnerIds,
  observed_instance_indices: Object.fromEntries(analysisNodes
    .filter((node) => node.instance_indices.length)
    .map((node) => [node.node_id, node.instance_indices])),
  timeline_summary: {
    event_count: timelineData.event_count,
    mapped_events: timelineData.mapping_summary?.mapped_events,
    unmapped_events: timelineData.mapping_summary?.unmapped_events,
  },
};

const conflicts = [
  {
    conflict_id: "mtp_weight_allgather_scaffold",
    kind: "implementation_detail",
    backend_scope: `${mtpPrefix}/preprocessing/weight_allgather`,
    source_scope: `${mtpId}/preprocessing`,
    resolution: "Keep weight preparation/all-gather as an interactive trace detail inside MTP preprocessing; it is runner scaffolding, not a learned model module.",
  },
];

const mappedBackendIds = new Set(mappings.map((mapping) => mapping.backend_node_id));
const sourceOnlyNodeIds = sourceNodes.map((node) => node.id).filter((id) => !sourceMappedBy.has(id));
const architectureOverlayMap = {
  schema_version: "architecture_overlay_map.v1",
  model_id: analysisConfig.model_id,
  report_id: analysisConfig.report_id,
  source_verification_state: "runtime_source_locked",
  mappings: mappings.sort((left, right) => left.backend_node_id.localeCompare(right.backend_node_id)),
  source_only_node_ids: sourceOnlyNodeIds,
  backend_only_runtime_node_ids: runtimeTrees.map((item) => item.backendNodeId),
  backend_trace_extension_node_ids: mappings.filter((mapping) => mapping.mapping_kind === "backend_trace_extension").map((mapping) => mapping.backend_node_id),
  conflicts,
  validation: {
    backend_node_count: analysisNodes.length,
    mapped_or_classified_backend_node_count: mappedBackendIds.size,
    all_backend_nodes_classified: mappedBackendIds.size === analysisNodes.length,
  },
};

const graphSpec = {
  schema_version: "model_architecture_graph.v1",
  roots: [
    {
      id: "section/source_architecture",
      label: "Complete model architecture",
      kind: "module",
      colorKey: "module:model",
      origin: "synthetic",
      dataState: "source_only",
      selectable: false,
      synthetic: true,
      children: [transformerTree],
    },
    {
      id: "section/runtime_auxiliary",
      label: "Runtime auxiliary",
      kind: "module",
      colorKey: "module:model",
      origin: "synthetic",
      dataState: "runtime",
      selectable: false,
      synthetic: true,
      children: runtimeTrees,
    },
  ],
  edges: canonicalEdges.map((item) => ({
    ...item,
    dataState: "source_only",
    semanticEdgeType: item.edgeType || "activation",
    edgeType: undefined,
    hover: {
      title: item.tensor?.name || "Source tensor edge",
      tensor: item.tensor,
      sources: item.provenance.map((provenance) => `${provenance.path}:${provenance.line_start}-${provenance.line_end}`),
    },
  })),
  metadata: {
    modelId: analysisConfig.model_id,
    reportId: analysisConfig.report_id,
    extractionScope: "hybrid",
    sourceScope: "full_source",
    backendScope: "trace_slice",
    sourceVerificationState: "runtime_source_locked",
    fullMainLayerCount: runtimeConfig.n_layers,
    mtpLearnedLayerCount: MTP_LEARNED_LAYER_COUNT,
    mtpRuntimeIterations: MTP_RUNTIME_ITERATIONS,
    backendNodeCount: analysisNodes.length,
    sourceNodeCount: sourceNodes.length,
    sourceOnlyNodeCount: sourceOnlyNodeIds.length,
    mappedSourceNodeCount: sourceMappedBy.size,
    backendTraceExtensionCount: mappings.filter((mapping) => mapping.mapping_kind === "backend_trace_extension").length,
    backendRuntimeCount: runtimeTrees.length,
  },
};

const expandedProjection = globalThis.DeepSeekArchitectureData.createArchitectureGraph(graphSpec, {});
const graphOutput = {
  ...graphSpec,
  width: expandedProjection.width,
  height: expandedProjection.height,
  nodes: expandedProjection.nodes,
  clusters: expandedProjection.clusters,
  edges: expandedProjection.edges,
  metadata: expandedProjection.metadata,
};

const architectureValidation = `# Model architecture validation\n\n- Result: PASS\n- Scope: \`full_source\`\n- Source verification: \`runtime_source_locked\`\n- Canonical nodes: ${sourceNodes.length}\n- Canonical edges: ${canonicalEdges.length}\n- Main layers: ${runtimeConfig.n_layers} (dense 3, MoE 58)\n- MTP learned layers: ${MTP_LEARNED_LAYER_COUNT} (model layer ${MTP_LAYER_INDEX})\n- MTP runtime iterations: ${MTP_RUNTIME_ITERATIONS}\n- Source hashes: verified\n\nThe canonical graph is extracted from ui-json runtime source at ${UI_JSON_REVISION}; official DeepSeek and Transformers snapshots remain cross-check baselines.\n`;
const overlayValidation = `# Architecture overlay validation\n\n- Result: PASS with documented implementation details\n- Backend analysis nodes: ${analysisNodes.length}\n- Classified backend nodes: ${mappedBackendIds.size}\n- Source-backed mappings: ${mappings.filter((mapping) => mapping.source_node_ids.length).length}\n- Backend trace details: ${mappings.filter((mapping) => mapping.mapping_kind === "backend_trace_extension").length}\n- Runtime auxiliary nodes: ${runtimeTrees.length}\n- Source-only nodes: ${sourceOnlyNodeIds.length}\n- Timeline owner IDs: ${timelineOwnerIds.length}\n- Documented details: ${conflicts.length}\n\nNo aggregate metric is propagated to unmapped source descendants. MTP is part of the complete model architecture; implementation-only profiler nodes stay attached to their canonical parent.\n`;

const outputs = new Map([
  ["model-source-manifest.json", sourceManifest],
  ["model_architecture.json", canonicalArchitecture],
  ["backend_trace_overlay.json", backendTraceOverlay],
  ["architecture_overlay_map.json", architectureOverlayMap],
  ["model_architecture_graph.json", graphOutput],
  ["model_architecture_validation.md", architectureValidation],
  ["architecture_overlay_validation.md", overlayValidation],
]);

await mkdir(outputDir, { recursive: true });
let stale = false;
for (const [fileName, value] of outputs) {
  const path = resolve(outputDir, fileName);
  const content = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  if (checkOnly) {
    const existing = await readFile(path, "utf8").catch(() => "");
    if (existing !== content) {
      console.error(`STALE outputs/${fileName}`);
      stale = true;
    } else {
      console.log(`OK    outputs/${fileName}`);
    }
  } else {
    await writeFile(path, content, "utf8");
    console.log(`WROTE outputs/${fileName}`);
  }
}

if (stale) process.exitCode = 1;

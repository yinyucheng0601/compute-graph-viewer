window.DEEPSEEK_INTERPRETABILITY_DATA = {
  "metadata": {
    "generated_at_utc": "2026-03-10T03:27:16.360969+00:00",
    "generator": "tools/generate_interpretability_artifacts.py",
    "intended_audience": "Model developers building interpretability or mechanistic-interpretability tools",
    "source_scope": [
      "configuration_deepseek.py",
      "modeling_deepseek.py",
      "inference/model.py",
      "inference/kernel.py",
      "inference/generate.py"
    ]
  },
  "architectural_summary": {
    "model_family": "Decoder-only Transformer",
    "norm_style": "Pre-norm RMSNorm",
    "total_layers": 61,
    "dense_layers": [
      0,
      1,
      2
    ],
    "moe_layers": [
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
      16,
      17,
      18,
      19,
      20,
      21,
      22,
      23,
      24,
      25,
      26,
      27,
      28,
      29,
      30,
      31,
      32,
      33,
      34,
      35,
      36,
      37,
      38,
      39,
      40,
      41,
      42,
      43,
      44,
      45,
      46,
      47,
      48,
      49,
      50,
      51,
      52,
      53,
      54,
      55,
      56,
      57,
      58,
      59,
      60
    ],
    "attention_style": "DeepSeek MLA-style attention with split no-PE/RoPE channels and low-rank Q/KV paths",
    "ffn_style": "Dense SwiGLU in shallow layers; routed+shared MoE SwiGLU afterwards",
    "ffn_dropout_present_in_source": false,
    "attention_dropout_default": 0.0,
    "rope_scaling_default": null
  },
  "model_defaults": {
    "vocab_size": 129280,
    "hidden_size": 7168,
    "intermediate_size": 18432,
    "moe_intermediate_size": 2048,
    "num_hidden_layers": 61,
    "num_nextn_predict_layers": 1,
    "num_attention_heads": 128,
    "num_key_value_heads": 128,
    "n_shared_experts": 1,
    "n_routed_experts": 256,
    "ep_size": 1,
    "routed_scaling_factor": 2.5,
    "kv_lora_rank": 512,
    "q_lora_rank": 1536,
    "qk_rope_head_dim": 64,
    "v_head_dim": 128,
    "qk_nope_head_dim": 128,
    "topk_method": "noaux_tc",
    "n_group": 8,
    "topk_group": 4,
    "num_experts_per_tok": 8,
    "moe_layer_freq": 1,
    "first_k_dense_replace": 3,
    "norm_topk_prob": true,
    "scoring_func": "sigmoid",
    "hidden_act": "silu",
    "max_position_embeddings": 4096,
    "initializer_range": 0.02,
    "rms_norm_eps": 1e-06,
    "use_cache": true,
    "pad_token_id": null,
    "bos_token_id": 0,
    "eos_token_id": 1,
    "tie_word_embeddings": false,
    "rope_theta": 10000.0,
    "rope_scaling": null,
    "attention_bias": false,
    "attention_dropout": 0.0
  },
  "derived_dimensions": {
    "q_head_dim": 192,
    "q_projection_out": 24576,
    "kv_a_projection_out": 576,
    "kv_b_projection_out": 32768,
    "o_projection_in": 16384
  },
  "global_components": [
    {
      "component": "embed_tokens",
      "category": "embedding",
      "input_shape": "[B, T]",
      "output_shape": "[B, T, 7168]",
      "weights": [
        {
          "name": "embed_tokens.weight",
          "shape": "[129280, 7168]"
        }
      ],
      "details": "Token embedding table used before the decoder stack.",
      "source_ref": "modeling_deepseek.py:1346; modeling_deepseek.py:1382"
    },
    {
      "component": "decoder_loop",
      "category": "decoder",
      "input_shape": "[B, T, 7168]",
      "output_shape": "[B, T, 7168]",
      "weights": [],
      "details": "61 decoder layers. Layers 0-2 use dense SwiGLU FFN; layers 3-60 use MoE because moe_layer_freq=1.",
      "source_ref": "modeling_deepseek.py:1142; modeling_deepseek.py:1382"
    },
    {
      "component": "final_norm",
      "category": "normalization",
      "input_shape": "[B, T, 7168]",
      "output_shape": "[B, T, 7168]",
      "weights": [
        {
          "name": "norm.weight",
          "shape": "[7168]"
        }
      ],
      "details": "Final RMSNorm applied after the decoder stack.",
      "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1382"
    },
    {
      "component": "lm_head",
      "category": "output",
      "input_shape": "[B, T, 7168]",
      "output_shape": "[B, T, 129280]",
      "weights": [
        {
          "name": "lm_head.weight",
          "shape": "[129280, 7168]"
        }
      ],
      "details": "Causal LM projection used by DeepseekV3ForCausalLM.",
      "source_ref": "modeling_deepseek.py:1514; modeling_deepseek.py:1548"
    }
  ],
  "layers": [
    {
      "layer_id": 0,
      "layer_name": "model.layers.0",
      "block_type": "dense_ffn",
      "summary": "Pre-norm attention followed by dense SwiGLU FFN.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.gate_proj",
          "op_name": "Gate projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 18432]",
          "weights": [
            {
              "name": "mlp.gate_proj.weight",
              "shape": "[18432, 7168]"
            }
          ],
          "formula": "gate = W_gate x",
          "fusion_notes": "One branch of a SwiGLU-style MLP.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:388"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.up_proj",
          "op_name": "Up projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 18432]",
          "weights": [
            {
              "name": "mlp.up_proj.weight",
              "shape": "[18432, 7168]"
            }
          ],
          "formula": "up = W_up x",
          "fusion_notes": "Second branch of the gated MLP.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:388"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.activation_product",
          "op_name": "SiLU gate and elementwise product",
          "input_shape": "gate/up:[B, T, 18432]",
          "output_shape": "[B, T, 18432]",
          "weights": [],
          "formula": "hidden = SiLU(gate) * up",
          "fusion_notes": "The source uses SiLU and does not implement FFN dropout.",
          "source_ref": "modeling_deepseek.py:388"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.down_proj",
          "op_name": "Down projection",
          "input_shape": "[B, T, 18432]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "mlp.down_proj.weight",
              "shape": "[7168, 18432]"
            }
          ],
          "formula": "ffn_out = W_down hidden",
          "fusion_notes": "Completes the dense FFN branch.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:388"
        },
        {
          "stage": "residual",
          "submodule": "ffn_residual",
          "op_name": "Residual add after FFN",
          "input_shape": "residual:[B, T, 7168] + ffn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MLP(x_norm)",
          "fusion_notes": "No dropout is applied between down_proj and residual.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 1,
      "layer_name": "model.layers.1",
      "block_type": "dense_ffn",
      "summary": "Pre-norm attention followed by dense SwiGLU FFN.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.gate_proj",
          "op_name": "Gate projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 18432]",
          "weights": [
            {
              "name": "mlp.gate_proj.weight",
              "shape": "[18432, 7168]"
            }
          ],
          "formula": "gate = W_gate x",
          "fusion_notes": "One branch of a SwiGLU-style MLP.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:388"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.up_proj",
          "op_name": "Up projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 18432]",
          "weights": [
            {
              "name": "mlp.up_proj.weight",
              "shape": "[18432, 7168]"
            }
          ],
          "formula": "up = W_up x",
          "fusion_notes": "Second branch of the gated MLP.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:388"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.activation_product",
          "op_name": "SiLU gate and elementwise product",
          "input_shape": "gate/up:[B, T, 18432]",
          "output_shape": "[B, T, 18432]",
          "weights": [],
          "formula": "hidden = SiLU(gate) * up",
          "fusion_notes": "The source uses SiLU and does not implement FFN dropout.",
          "source_ref": "modeling_deepseek.py:388"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.down_proj",
          "op_name": "Down projection",
          "input_shape": "[B, T, 18432]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "mlp.down_proj.weight",
              "shape": "[7168, 18432]"
            }
          ],
          "formula": "ffn_out = W_down hidden",
          "fusion_notes": "Completes the dense FFN branch.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:388"
        },
        {
          "stage": "residual",
          "submodule": "ffn_residual",
          "op_name": "Residual add after FFN",
          "input_shape": "residual:[B, T, 7168] + ffn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MLP(x_norm)",
          "fusion_notes": "No dropout is applied between down_proj and residual.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 2,
      "layer_name": "model.layers.2",
      "block_type": "dense_ffn",
      "summary": "Pre-norm attention followed by dense SwiGLU FFN.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.gate_proj",
          "op_name": "Gate projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 18432]",
          "weights": [
            {
              "name": "mlp.gate_proj.weight",
              "shape": "[18432, 7168]"
            }
          ],
          "formula": "gate = W_gate x",
          "fusion_notes": "One branch of a SwiGLU-style MLP.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:388"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.up_proj",
          "op_name": "Up projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 18432]",
          "weights": [
            {
              "name": "mlp.up_proj.weight",
              "shape": "[18432, 7168]"
            }
          ],
          "formula": "up = W_up x",
          "fusion_notes": "Second branch of the gated MLP.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:388"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.activation_product",
          "op_name": "SiLU gate and elementwise product",
          "input_shape": "gate/up:[B, T, 18432]",
          "output_shape": "[B, T, 18432]",
          "weights": [],
          "formula": "hidden = SiLU(gate) * up",
          "fusion_notes": "The source uses SiLU and does not implement FFN dropout.",
          "source_ref": "modeling_deepseek.py:388"
        },
        {
          "stage": "ffn",
          "submodule": "mlp.down_proj",
          "op_name": "Down projection",
          "input_shape": "[B, T, 18432]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "mlp.down_proj.weight",
              "shape": "[7168, 18432]"
            }
          ],
          "formula": "ffn_out = W_down hidden",
          "fusion_notes": "Completes the dense FFN branch.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:388"
        },
        {
          "stage": "residual",
          "submodule": "ffn_residual",
          "op_name": "Residual add after FFN",
          "input_shape": "residual:[B, T, 7168] + ffn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MLP(x_norm)",
          "fusion_notes": "No dropout is applied between down_proj and residual.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 3,
      "layer_name": "model.layers.3",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 4,
      "layer_name": "model.layers.4",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 5,
      "layer_name": "model.layers.5",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 6,
      "layer_name": "model.layers.6",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 7,
      "layer_name": "model.layers.7",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 8,
      "layer_name": "model.layers.8",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 9,
      "layer_name": "model.layers.9",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 10,
      "layer_name": "model.layers.10",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 11,
      "layer_name": "model.layers.11",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 12,
      "layer_name": "model.layers.12",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 13,
      "layer_name": "model.layers.13",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 14,
      "layer_name": "model.layers.14",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 15,
      "layer_name": "model.layers.15",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 16,
      "layer_name": "model.layers.16",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 17,
      "layer_name": "model.layers.17",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 18,
      "layer_name": "model.layers.18",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 19,
      "layer_name": "model.layers.19",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 20,
      "layer_name": "model.layers.20",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 21,
      "layer_name": "model.layers.21",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 22,
      "layer_name": "model.layers.22",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 23,
      "layer_name": "model.layers.23",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 24,
      "layer_name": "model.layers.24",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 25,
      "layer_name": "model.layers.25",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 26,
      "layer_name": "model.layers.26",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 27,
      "layer_name": "model.layers.27",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 28,
      "layer_name": "model.layers.28",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 29,
      "layer_name": "model.layers.29",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 30,
      "layer_name": "model.layers.30",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 31,
      "layer_name": "model.layers.31",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 32,
      "layer_name": "model.layers.32",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 33,
      "layer_name": "model.layers.33",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 34,
      "layer_name": "model.layers.34",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 35,
      "layer_name": "model.layers.35",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 36,
      "layer_name": "model.layers.36",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 37,
      "layer_name": "model.layers.37",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 38,
      "layer_name": "model.layers.38",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 39,
      "layer_name": "model.layers.39",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 40,
      "layer_name": "model.layers.40",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 41,
      "layer_name": "model.layers.41",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 42,
      "layer_name": "model.layers.42",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 43,
      "layer_name": "model.layers.43",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 44,
      "layer_name": "model.layers.44",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 45,
      "layer_name": "model.layers.45",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 46,
      "layer_name": "model.layers.46",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 47,
      "layer_name": "model.layers.47",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 48,
      "layer_name": "model.layers.48",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 49,
      "layer_name": "model.layers.49",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 50,
      "layer_name": "model.layers.50",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 51,
      "layer_name": "model.layers.51",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 52,
      "layer_name": "model.layers.52",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 53,
      "layer_name": "model.layers.53",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 54,
      "layer_name": "model.layers.54",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 55,
      "layer_name": "model.layers.55",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 56,
      "layer_name": "model.layers.56",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 57,
      "layer_name": "model.layers.57",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 58,
      "layer_name": "model.layers.58",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 59,
      "layer_name": "model.layers.59",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    },
    {
      "layer_id": 60,
      "layer_name": "model.layers.60",
      "block_type": "moe_ffn",
      "summary": "Pre-norm attention followed by routed+shared MoE SwiGLU.",
      "operators": [
        {
          "stage": "normalization",
          "submodule": "input_layernorm",
          "op_name": "RMSNorm",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "input_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Pre-norm layout. No bias or mean-centering.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1142; modeling_deepseek.py:1167"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_path",
          "op_name": "Q low-rank projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 24576]",
          "weights": [
            {
              "name": "self_attn.q_a_proj.weight",
              "shape": "[1536, 7168]"
            },
            {
              "name": "self_attn.q_a_layernorm.weight",
              "shape": "[1536]"
            },
            {
              "name": "self_attn.q_b_proj.weight",
              "shape": "[24576, 1536]"
            }
          ],
          "formula": "q = W_qb(RMSNorm(W_qa x))",
          "fusion_notes": "Use one logical node in the UI even though the source has projection -> norm -> projection.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.q_split",
          "op_name": "Split query into no-PE and RoPE channels",
          "input_shape": "[B, T, 24576]",
          "output_shape": "q_nope:[B, 128, T, 128] | q_pe:[B, 128, T, 64]",
          "weights": [],
          "formula": "reshape -> transpose -> split(q, [128, 64])",
          "fusion_notes": "Interpretability tools should visualize the two query subspaces separately.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_a_path",
          "op_name": "Compressed KV projection",
          "input_shape": "[B, T, 7168]",
          "output_shape": "compressed_kv:[B, T, 512] | k_pe:[B, 1, T, 64]",
          "weights": [
            {
              "name": "self_attn.kv_a_proj_with_mqa.weight",
              "shape": "[576, 7168]"
            }
          ],
          "formula": "kv_a = W_kva x; split(kv_a, [512, 64])",
          "fusion_notes": "The KV path is compressed before being expanded into per-head K/V.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_b_path",
          "op_name": "Expand compressed KV to per-head K(no-PE)/V",
          "input_shape": "[B, T, 512]",
          "output_shape": "[B, T, 32768]",
          "weights": [
            {
              "name": "self_attn.kv_a_layernorm.weight",
              "shape": "[512]"
            },
            {
              "name": "self_attn.kv_b_proj.weight",
              "shape": "[32768, 512]"
            }
          ],
          "formula": "kv = W_kvb(RMSNorm(compressed_kv))",
          "fusion_notes": "Low-rank latent KV is normalized before expansion.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.kv_split",
          "op_name": "Split expanded KV into K(no-PE) and V",
          "input_shape": "[B, T, 32768]",
          "output_shape": "k_nope:[B, 128, T, 128] | v:[B, 128, T, 128]",
          "weights": [],
          "formula": "reshape -> transpose -> split(kv, [128, 128])",
          "fusion_notes": "K is split into no-position and position-aware branches only after the low-rank expansion.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.rope",
          "op_name": "Apply RoPE to q_pe and k_pe only",
          "input_shape": "q_pe:[B, 128, T, 64] | k_pe:[B, 1, T, 64]",
          "output_shape": "q_pe':[B, 128, T, 64] | k_pe':[B, 1, T, 64]",
          "weights": [],
          "formula": "apply_rotary_pos_emb(q_pe, k_pe, cos, sin, position_ids)",
          "fusion_notes": "Only the RoPE subspace is rotated. The no-PE channels remain untouched.",
          "source_ref": "modeling_deepseek.py:114; modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.compose_qk",
          "op_name": "Assemble full query/key tensors",
          "input_shape": "q_nope/q_pe' and k_nope/k_pe'",
          "output_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "weights": [],
          "formula": "concat([no-PE, RoPE], dim=-1)",
          "fusion_notes": "This logical concatenation is a good expansion point in a developer-facing UI.",
          "source_ref": "modeling_deepseek.py:750"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.score_path",
          "op_name": "Scaled dot-product attention scores",
          "input_shape": "Q:[B, 128, T, 192] | K:[B, 128, T_kv, 192]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "scores = (Q @ K^T) * softmax_scale + causal_mask",
          "fusion_notes": "In the eager path this is explicit matmul + mask add. In flash-attn it is fused.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:860"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.softmax_dropout",
          "op_name": "Softmax over keys",
          "input_shape": "[B, 128, T, T_kv]",
          "output_shape": "[B, 128, T, T_kv]",
          "weights": [],
          "formula": "softmax(scores, dim=-1, dtype=float32) -> dropout(p=attention_dropout)",
          "fusion_notes": "Default attention_dropout is 0.0, so dropout is present in code but a no-op for the default config.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.value_aggregation",
          "op_name": "Attention-weighted value sum",
          "input_shape": "attn:[B, 128, T, T_kv] | V:[B, 128, T_kv, 128]",
          "output_shape": "[B, 128, T, 128]",
          "weights": [],
          "formula": "context = attn @ V",
          "fusion_notes": "Often fused with score/softmax in optimized kernels.",
          "source_ref": "modeling_deepseek.py:750; modeling_deepseek.py:875"
        },
        {
          "stage": "attention",
          "submodule": "self_attn.out_proj",
          "op_name": "Head concat and output projection",
          "input_shape": "[B, 128, T, 128]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "self_attn.o_proj.weight",
              "shape": "[7168, 16384]"
            }
          ],
          "formula": "reshape(context) -> W_o context",
          "fusion_notes": "The concat is a view/reshape; O-proj is the actual weight matrix to visualize.",
          "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750"
        },
        {
          "stage": "residual",
          "submodule": "attention_residual",
          "op_name": "Residual add after attention",
          "input_shape": "residual:[B, T, 7168] + attn_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + attention(x_norm)",
          "fusion_notes": "This closes the first pre-norm sublayer.",
          "source_ref": "modeling_deepseek.py:1167"
        },
        {
          "stage": "normalization",
          "submodule": "post_attention_layernorm",
          "op_name": "RMSNorm before FFN or MoE",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "post_attention_layernorm.weight",
              "shape": "[7168]"
            }
          ],
          "formula": "y = x * rsqrt(mean(x^2) + eps) * weight",
          "fusion_notes": "Second pre-norm point. A natural fold-out node in the UI.",
          "source_ref": "modeling_deepseek.py:94; modeling_deepseek.py:1167"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.linear",
          "op_name": "Router linear logits",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B*T, 256]",
          "weights": [
            {
              "name": "mlp.gate.weight",
              "shape": "[256, 7168]"
            },
            {
              "name": "mlp.gate.e_score_correction_bias",
              "shape": "[256]"
            }
          ],
          "formula": "logits = hidden @ W_gate^T",
          "fusion_notes": "Router state is flattened over tokens before expert selection.",
          "source_ref": "modeling_deepseek.py:393; modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.gate.selection",
          "op_name": "Sigmoid + group top-k + expert top-k + renorm",
          "input_shape": "[B*T, 256]",
          "output_shape": "indices:[B*T, 8] | weights:[B*T, 8]",
          "weights": [],
          "formula": "scores = sigmoid(logits); select top groups over 8 groups; select top 8 experts; normalize; multiply by routed_scaling_factor",
          "fusion_notes": "Actual default path is noaux_tc with 8 groups, top 4 groups, top 8 experts, scoring_func=sigmoid, routed_scaling_factor=2.5.",
          "source_ref": "modeling_deepseek.py:422"
        },
        {
          "stage": "moe",
          "submodule": "moe.dispatch",
          "op_name": "Token dispatch to routed experts",
          "input_shape": "x:[B*T, 7168] | indices:[B*T, 8] | weights:[B*T, 8]",
          "output_shape": "token groups per expert",
          "weights": [],
          "formula": "sort tokens by expert id; optionally all_to_all when ep_size > 1",
          "fusion_notes": "This is an implementation hotspot rather than a mathematical layer.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_expert",
          "op_name": "Per-expert SwiGLU MLP",
          "input_shape": "[tokens_for_expert, 7168]",
          "output_shape": "[tokens_for_expert, 7168]",
          "weights": [
            {
              "name": "experts[i].gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "experts[i].down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "expert_out = W2(SiLU(W1 x) * W3 x)",
          "fusion_notes": "Each routed expert uses the same MLP pattern as the dense FFN, but with moe_intermediate_size.",
          "source_ref": "modeling_deepseek.py:374; modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.routed_weighted_sum",
          "op_name": "Weighted combine across selected experts",
          "input_shape": "expert_outs:[B*T, 8, 7168] | weights:[B*T, 8]",
          "output_shape": "[B*T, 7168]",
          "weights": [],
          "formula": "sum_i expert_out_i * route_weight_i",
          "fusion_notes": "This is the main place to expose per-token expert attribution in the UI.",
          "source_ref": "modeling_deepseek.py:535"
        },
        {
          "stage": "moe",
          "submodule": "moe.shared_experts",
          "op_name": "Always-on shared expert branch",
          "input_shape": "[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [
            {
              "name": "shared_experts.gate_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.up_proj.weight",
              "shape": "[2048, 7168]"
            },
            {
              "name": "shared_experts.down_proj.weight",
              "shape": "[7168, 2048]"
            }
          ],
          "formula": "shared = SharedMLP(identity)",
          "fusion_notes": "n_shared_experts=1; this branch bypasses router sparsity.",
          "source_ref": "modeling_deepseek.py:475; modeling_deepseek.py:522"
        },
        {
          "stage": "moe",
          "submodule": "moe.combine",
          "op_name": "Combine routed and shared expert outputs",
          "input_shape": "routed:[B, T, 7168] | shared:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "moe_out = routed + shared",
          "fusion_notes": "The residual add happens after this combine, not inside the expert block.",
          "source_ref": "modeling_deepseek.py:522"
        },
        {
          "stage": "residual",
          "submodule": "moe_residual",
          "op_name": "Residual add after MoE",
          "input_shape": "residual:[B, T, 7168] + moe_out:[B, T, 7168]",
          "output_shape": "[B, T, 7168]",
          "weights": [],
          "formula": "x = residual + MoE(x_norm)",
          "fusion_notes": "This closes the second pre-norm sublayer on MoE layers.",
          "source_ref": "modeling_deepseek.py:1167"
        }
      ]
    }
  ],
  "fusion_primitives": [
    {
      "name": "hf_eager_attention_path",
      "implementation": "transformers.eager",
      "source_ref": "modeling_deepseek.py:627; modeling_deepseek.py:750",
      "fused_ops": [
        "Q/K/V projection",
        "QK^T",
        "scale",
        "causal mask add",
        "softmax",
        "dropout",
        "AV matmul",
        "head concat",
        "O projection"
      ],
      "notes": "Semantic reference path. Useful when the UI wants explicit operator-level expansion."
    },
    {
      "name": "hf_flash_attention_2",
      "implementation": "transformers.flash_attention_2",
      "source_ref": "modeling_deepseek.py:860; modeling_deepseek.py:875; modeling_deepseek.py:1010",
      "fused_ops": [
        "QK^T",
        "mask handling",
        "softmax",
        "dropout",
        "AV matmul"
      ],
      "notes": "The weights are unchanged, but the score/softmax/value path becomes a single optimized kernel call."
    },
    {
      "name": "inference_absorb_attention",
      "implementation": "inference.model.MLA(attn_impl='absorb')",
      "source_ref": "inference/model.py:195; inference/model.py:230",
      "fused_ops": [
        "dequant or read wkv_b",
        "project q_nope into KV latent space",
        "split RoPE and latent score terms",
        "score accumulation",
        "latent value aggregation",
        "recover V head output"
      ],
      "notes": "This is the main DeepSeek-specific fusion point in the inference path. The lightweight inference defaults differ from HF: n_layers=27, dim=2048."
    },
    {
      "name": "inference_linear_fp8_path",
      "implementation": "inference.model.linear(gemm_impl='fp8')",
      "source_ref": "inference/model.py:77; inference/model.py:91; inference/model.py:110",
      "fused_ops": [
        "activation quantization",
        "FP8 GEMM",
        "bias add"
      ],
      "notes": "This path is active only when weights are FP8 and gemm_impl='fp8'."
    },
    {
      "name": "inference_linear_dequant_path",
      "implementation": "inference.model.linear(gemm_impl='bf16')",
      "source_ref": "inference/model.py:77",
      "fused_ops": [
        "weight dequantization",
        "BF16 linear"
      ],
      "notes": "Fallback path when FP8 weights are dequantized before matmul."
    },
    {
      "name": "triton_act_quant",
      "implementation": "inference.kernel.act_quant",
      "source_ref": "inference/kernel.py:10; inference/kernel.py:21",
      "fused_ops": [
        "block max abs",
        "scale computation",
        "FP8 cast"
      ],
      "notes": "Quantizes activations blockwise with BLOCK_SIZE=128."
    },
    {
      "name": "triton_weight_dequant",
      "implementation": "inference.kernel.weight_dequant",
      "source_ref": "inference/kernel.py:32; inference/kernel.py:46",
      "fused_ops": [
        "load quantized weights",
        "load scale",
        "dequant multiply"
      ],
      "notes": "Used by the inference path when weights are stored in FP8 with scale tensors."
    },
    {
      "name": "triton_fp8_gemm",
      "implementation": "inference.kernel.fp8_gemm",
      "source_ref": "inference/kernel.py:63; inference/kernel.py:99",
      "fused_ops": [
        "blockwise FP8 dot product",
        "scale application",
        "accumulation",
        "output cast"
      ],
      "notes": "Autotuned over BLOCK_SIZE_M/BLOCK_SIZE_N/num_stages."
    },
    {
      "name": "moe_group_topk_router",
      "implementation": "HF + inference router logic",
      "source_ref": "modeling_deepseek.py:422; inference/model.py:295",
      "fused_ops": [
        "router logits",
        "sigmoid or softmax",
        "group selection",
        "expert top-k",
        "probability renorm"
      ],
      "notes": "Expose this as a separate explainer card because it determines sparsity and expert attribution."
    }
  ],
  "counts": {
    "layer_count": 61,
    "dense_layer_count": 3,
    "moe_layer_count": 58,
    "per_dense_layer_operator_count": 19,
    "per_moe_layer_operator_count": 22,
    "total_operator_nodes": 1333
  }
}
;
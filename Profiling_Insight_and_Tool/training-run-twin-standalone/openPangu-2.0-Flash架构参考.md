# openPangu-2.0-Flash 架构参考（Sparse MLA + DSA/SWA + 256-Expert MoE）

v 20260717 · 型号：**openPangu-2.0-Flash**（华为 ascend-tribe 开源）

> **数据来源（source-verified）**：本文规格全部取自仓库内经源码/config 校验的 canonical schema
> `model-architecture/openpangu-2.0-flash/outputs/model_architecture.json`
> 与校验报告 `model_architecture_validation.md`（extract 自官方 `config.json` + `openPangu-2.0-Infer` 源码，commit `1676856`）。
>
>
> ⚠️ **未从本地取到的量（标记为「待补」）**：总参数量 / 激活参数量 / 训练数据量 / rope_theta 数值 / 训练精度 / routed_scaling_factor。
> 本地 checkout 的 safetensors 是 Git LFS 指针文件，未下载全权重，故这些量本文不臆造。

## 1. 骨架

```
openPangu-2.0-Flash
│
├─ token_embedding: Vocab Parallel Embedding (vocab 151552 × hidden 2560)
│
├─ decoder: 46 × DecoderLayer (L0~L45)
│   └─ 每层 = mHC 注意力分支(S_mhc=4 流) + FFN，FFN 类型按层号二选一
│   │
│   │  【注意力类型按层混合（hybrid）】
│   │   ├─ DSA 层（16 层）: L0,3,6,9,…,45（每 3 层 1 个）→ 走 DSA Indexer 稀疏选择
│   │   └─ SWA 层（30 层）: 其余层 → 滑动窗口注意力
│   │
│   │  【FFN 类型按层分段】
│   │   ├─ L0~L1  : Dense MLP（first_k_dense=2）
│   │   └─ L2~L45 : MoE FFN（256 路由专家 + 1 共享）
│   │
│   │   单层内部结构：
│   │   ├─ input_layernorm — Input RMSNorm
│   │   │
│   │   ├─ Sparse MLA Attention（多头潜在注意力，N_h=48）
│   │   │   ├─ q_a_proj      — Q Latent Linear  [2560 → R_q=1024]
│   │   │   ├─ q_causal_conv — Q Causal Conv1D（短卷积，配合 MoME 状态）
│   │   │   ├─ q_residual_add + q_a_norm — Q Add / Q LayerNorm
│   │   │   ├─ q_b_proj      — Q Up Linear     [1024 → N_h·D_qk = 48×192 = 9216]
│   │   │   ├─ kv_a_proj     — KV Latent Linear [2560 → R_kv=512, +rope → 576]
│   │   │   ├─ kv_causal_conv + kv_residual_add + kv_a_norm
│   │   │   ├─ kv_b_proj     — KV Up Linear（还原 K_nope / V）
│   │   │   ├─ rope_apply    — Apply RoPE（D_rope=64 维）
│   │   │   ├─ dsa_indexer   — DSA Indexer（仅 DSA 层；K_index=2048 候选，N_index=24 选中）
│   │   │   ├─ attention_core— Sparse FlashAttention
│   │   │   ├─ o_causal_conv + o_residual_add
│   │   │   └─ o_proj        — Output Projection [→ 2560]
│   │   │       · param_sink_state：128 个可学习 Sink Token（缓解极大激活值）
│   │   │
│   │   ├─ post_attention_norm — Post Attention RMSNorm（+ 残差）
│   │   ├─ pre_mlp_norm        — Pre MLP RMSNorm
│   │   │
│   │   ├─ FFN Choice ──┬─ Dense MLP（L0~L1）
│   │   │               │   ├─ dense_gate_up [2560 → I_dense=9216 ×2]
│   │   │               │   ├─ dense_silu    — SiLU Multiply (SwiGLU)
│   │   │               │   └─ dense_down    [9216 → 2560]
│   │   │               │
│   │   │               └─ MoE FFN（L2~L45）
│   │   │                   ├─ router_gate       — Router Gate（W_router=3）
│   │   │                   ├─ route_topk         — TopK Router：top_k=8 / E=256
│   │   │                   ├─ routed_expert_bank — 256 路由专家（SwiGLU，I_moe=1024）
│   │   │                   │       每专家: gate_up [2560→1024×2] → SiLU → down [1024→2560]
│   │   │                   ├─ shared_expert_mlp  — 1 个共享专家 MLP（E_shared=1，始终激活）
│   │   │                   └─ moe_combine        — 共享输出 + Σ(top8 路由专家 × 门控)
│   │   │
│   │   ├─ post_mlp_norm   — Post MLP RMSNorm（+ 残差）
│   │   └─ block_post_norm — Block Post RMSNorm（可选）
│   │
│   · 每层专家并行运行时：expert_parallel_state（EP 切分 256 专家）
│
├─ final_norm — Final RMSNorm
├─ lm_head    — LM Head [2560 → vocab 151552] → logits
│
└─ MTP module: Multi Token Predictor（N_mtp=3，层 46/47/48）
    ├─ mtp_input_norms — MTP Input Norms
    ├─ mtp_eh_proj     — MTP EH Projection
    ├─ mtp_decoder_layer — 复用 DecoderLayer 模板
    └─ mtp_shared_head → mtp_logits（额外预测后续 3 个 token）
```

## 2. Sparse MLA 注意力详解（区别于 GQA / MHA）

openPangu-2.0-Flash 用 **Sparse MLA（多头潜在注意力 + 稀疏注意力核）**，
并在 Q/KV/O 三处引入 **Causal Conv1D** 短卷积（配合 MoME 状态），这是它区别于常规 MLA 的显著特征。

```
标准 MLA（如 DeepSeek）:  X → 低秩下投影(latent) → 上投影还原 Q/K/V
openPangu Flash MLA:      X → 低秩下投影 → Causal Conv1D → 残差 → LayerNorm → 上投影

  Q 路：  X[2560] → q_a_proj[→1024] → causal_conv → +res → q_a_norm → q_b_proj[→48×192]
  KV 路： X[2560] → kv_a_proj[→512(+rope64=576)] → causal_conv → +res → kv_a_norm → kv_b_proj
  头维度：D_qk=192 = D_nope(128) + D_rope(64)，D_v=128，N_h=48 头

Partial RoPE：仅 D_rope=64 / 192 维施加位置编码（rope_theta 待补）

Param Sink Token（原创）:
  128 个可学习 Sink Token（N_sink=128），吸收极大激活值，提升训练稳定性与后量化亲和。
```

### 注意力按层混合：DSA / SWA

```
46 层 decoder 的注意力不是同构，而是两种混合：

  DSA 层（Dynamic/Sparse Attention Indexer）  · 16 层 · L0,3,6,…,45（每 3 层）
    └─ dsa_indexer 先在 K_index=2048 个候选 key 中挑 N_index=24 个 → 稀疏 attention
       用于长上下文下压缩注意力代价（S_max=524288 = 512K）

  SWA 层（Sliding Window Attention）           · 30 层 · 其余层
    └─ 滑动窗口局部注意力
```

### mHC 注意力分支（S_mhc=4）

每层注意力外包一层 **mHC Attention Branch → … → mHC Attention Merge**，`S_mhc=4` 表示 4 条流；
schema 层面确认其存在与流数，内部语义（multi-head-Cache / multi-Head-Channel 等）本地资料未给全，暂不展开释义。

## 3. 典型 DecoderLayer Mermaid 图

46 层 decoder 按 FFN 类型分为 **Dense（L0~L1）** 和 **MoE（L2~L45）** 两大类，注意力侧 DSA/SWA 混合由 `dsa_indexer` 节点的条件存在（"仅 DSA 层"）统一表达；MTP 模块（L46~48）复用 DecoderLayer 模板并追加额外投影。

### 3.1 Dense DecoderLayer（L0~L1，2 层）

```mermaid
graph TD
    INPUT["输入 hidden [T, 2560]"]

    subgraph ATTN["Sparse MLA Attention (N_h=48)"]
        NORM1["input_layernorm<br>[算子: RMSNorm]"]
        QA["q_a_proj [2560→1024]<br>[算子: Linear]"]
        QCV["q_causal_conv<br>[算子: Conv1D]"]
        QRES["q_residual_add + q_a_norm<br>[算子: Add + RMSNorm]"]
        QB["q_b_proj [1024→48×192]<br>[算子: Linear]"]
        KVA["kv_a_proj [2560→576]<br>[算子: Linear]"]
        KVCV["kv_causal_conv<br>[算子: Conv1D]"]
        KVRES["kv_residual_add + kv_a_norm<br>[算子: Add + RMSNorm]"]
        KVB["kv_b_proj · 还原 K_nope/V<br>[算子: Linear]"]
        ROPE["rope_apply · D_rope=64<br>[算子: RoPE]"]
        DSA["dsa_indexer · 2048→24<br>[算子: Indexer]<br>(仅 DSA 层)"]
        CORE["attention_core<br>[算子: FlashAttention · Sparse]"]
        OCV["o_causal_conv<br>[算子: Conv1D]"]
        ORES["o_residual_add<br>[算子: Add]"]
        OP["o_proj [→2560]<br>[算子: Linear]"]
    end

    subgraph DENSE["Dense FFN (SwiGLU, I=9216)"]
        NORM2["post_attention_norm<br>[算子: RMSNorm]"]
        NORM3["pre_mlp_norm<br>[算子: RMSNorm]"]
        GU["dense_gate_up [2560→18432]<br>[算子: Linear]"]
        SILU["dense_silu<br>[算子: SiLU · Multiply]"]
        DOWN["dense_down [9216→2560]<br>[算子: Linear]"]
        NORM4["post_mlp_norm<br>[算子: RMSNorm]"]
    end

    OUT["输出 hidden [T, 2560]"]

    INPUT --> NORM1
    NORM1 --> QA --> QCV --> QRES --> QB --> CORE
    NORM1 --> KVA --> KVCV --> KVRES --> KVB --> ROPE --> CORE
    DSA --> CORE
    CORE --> OCV --> ORES --> OP
    OP -->|"+ 残差"| NORM2
    NORM2 --> NORM3
    NORM3 --> GU --> SILU --> DOWN
    DOWN -->|"+ 残差"| NORM4 --> OUT
```

> L0 为 DSA 注意力（dsa_indexer 激活），L1 为 SWA 注意力（dsa_indexer 不激活）。两者 FFN 侧结构相同：无 router、无 expert，仅一个 Dense SwiGLU MLP。

### 3.2 MoE DecoderLayer（L2~L45，44 层）

```mermaid
graph TD
    INPUT["输入 hidden [T, 2560]"]

    subgraph ATTN["Sparse MLA Attention (N_h=48)"]
        NORM1["input_layernorm<br>[算子: RMSNorm]"]
        QA["q_a_proj [2560→1024]<br>[算子: Linear]"]
        QCV["q_causal_conv<br>[算子: Conv1D]"]
        QRES["q_residual_add + q_a_norm<br>[算子: Add + RMSNorm]"]
        QB["q_b_proj [1024→48×192]<br>[算子: Linear]"]
        KVA["kv_a_proj [2560→576]<br>[算子: Linear]"]
        KVCV["kv_causal_conv<br>[算子: Conv1D]"]
        KVRES["kv_residual_add + kv_a_norm<br>[算子: Add + RMSNorm]"]
        KVB["kv_b_proj · 还原 K_nope/V<br>[算子: Linear]"]
        ROPE["rope_apply · D_rope=64<br>[算子: RoPE]"]
        DSA["dsa_indexer · 2048→24<br>[算子: Indexer]<br>(仅 DSA 层)"]
        CORE["attention_core<br>[算子: FlashAttention · Sparse]"]
        OCV["o_causal_conv<br>[算子: Conv1D]"]
        ORES["o_residual_add<br>[算子: Add]"]
        OP["o_proj [→2560]<br>[算子: Linear]"]
    end

    subgraph MOE["MoE FFN (256 experts, top-8, +1 shared)"]
        NORM2["post_attention_norm<br>[算子: RMSNorm]"]
        NORM3["pre_mlp_norm<br>[算子: RMSNorm]"]
        RG["router_gate · W_router=3<br>[算子: Linear]"]
        TOPK["route_topk · top-8/256<br>[算子: TopK]"]
        BANK["routed_expert_bank<br>[算子: 256× SwiGLU Expert]<br>gate_up[Linear]+SiLU+down[Linear]"]
        SHARED["shared_expert_mlp<br>[算子: SwiGLU Shared]<br>gate_up[Linear]+SiLU+down[Linear]"]
        COMB["moe_combine<br>[算子: Add · shared+Σ(top8×gate)]"]
        NORM4["post_mlp_norm<br>[算子: RMSNorm]"]
    end

    OUT["输出 hidden [T, 2560]"]

    INPUT --> NORM1
    NORM1 --> QA --> QCV --> QRES --> QB --> CORE
    NORM1 --> KVA --> KVCV --> KVRES --> KVB --> ROPE --> CORE
    DSA --> CORE
    CORE --> OCV --> ORES --> OP
    OP -->|"+ 残差"| NORM2
    NORM2 --> NORM3
    NORM3 --> RG --> TOPK
    TOPK -->|"select top-8"| BANK
    NORM3 --> SHARED
    BANK --> COMB
    SHARED --> COMB
    COMB -->|"+ 残差"| NORM4 --> OUT
```

> 44 层中 DSA 层 15 层（L3,6,9,…,42）、SWA 层 29 层（其余），区别仅在 dsa_indexer 是否激活。末层 L45 也是 DSA+MoE，同本图。

### 3.3 MTP DecoderLayer（L46~48，3 层）

```mermaid
graph TD
    MAIN["主 decoder 最后一层 hidden [T, 2560]"]

    subgraph MTP["Multi Token Predictor (N_mtp=3)"]
        NORM0["mtp_input_norm<br>[算子: RMSNorm]"]
        EH["mtp_eh_proj [5120→2560]<br>[算子: Linear]"]
        DEC["mtp_decoder_layer<br>[算子: 复用 DecoderLayer 模板]<br>(含 Attention ~16 算子 + FFN ~4~20 算子)"]
        HEAD["mtp_shared_head [2560→151552]<br>[算子: Linear · 3 层共享]"]
    end

    LOGITS["mtp_logits<br>(额外预测后续 3 个 token)"]

    MAIN --> NORM0 --> EH --> DEC --> HEAD --> LOGITS
```

> MTP 的 `mtp_decoder_layer` 与主 decoder 的 Dense/MoE DecoderLayer 结构一致（含 Sparse MLA Attention + FFN），区别在于：（1）输入是主 decoder 最后一层 hidden 与当前 MTP 层上一 token embedding 的拼接，经 `mtp_eh_proj` 融合；（2）输出走 `mtp_shared_head`（3 层共享）而非主 `lm_head`。

### 3.4 L5 整网算子图（46 层展开到算子粒度）

> 下图将整网展平到 **L5 · Operator** 粒度：每个方框是一个具体算子（Linear / RMSNorm / FlashAttention / SiLU / TopK / RoPE / Conv1D / Add / Embedding），按数据流串联。Dense 层（L0~L1）和 MoE 层（L2~L45）各展开一层为代表，其余同型层折叠为 `…`；MTP 层独立展开。

```mermaid
graph TD
    %% ═══ 输入端 ═══
    TOK["Token IDs\n[算子: Embedding]"]
    EMB["token_embedding\n[算子: Embedding · VocabParallel]\nvocab 151552 → 2560"]

    TOK --> EMB

    %% ═══ Dense 层（L0~L1）═══
    subgraph DENSE_LAYERS["Dense DecoderLayers (L0~L1, 2 层)"]
        direction TB
        subgraph L0_EXPAND["L0 · DSA + Dense（展开到算子）"]
            direction TB
            L0_IN["input_layernorm\n[算子: RMSNorm]"]
            L0_QA["q_a_proj\n[算子: Linear · 2560→1024]"]
            L0_QCV["q_causal_conv\n[算子: Conv1D]"]
            L0_QADD["q_residual_add\n[算子: Add]"]
            L0_QAN["q_a_norm\n[算子: RMSNorm]"]
            L0_QB["q_b_proj\n[算子: Linear · 1024→9216]"]
            L0_KVA["kv_a_proj\n[算子: Linear · 2560→576]"]
            L0_KVCV["kv_causal_conv\n[算子: Conv1D]"]
            L0_KVADD["kv_residual_add\n[算子: Add]"]
            L0_KVAN["kv_a_norm\n[算子: RMSNorm]"]
            L0_KVB["kv_b_proj\n[算子: Linear · 还原 K_nope/V]"]
            L0_ROPE["rope_apply\n[算子: RoPE · D_rope=64]"]
            L0_DSA["dsa_indexer\n[算子: Indexer · 2048→24]\n(仅 DSA 层)"]
            L0_ATTN["attention_core\n[算子: FlashAttention · Sparse]"]
            L0_OCV["o_causal_conv\n[算子: Conv1D]"]
            L0_OADD["o_residual_add\n[算子: Add]"]
            L0_OP["o_proj\n[算子: Linear · →2560]"]
            L0_PAN["post_attention_norm\n[算子: RMSNorm]"]
            L0_PMN["pre_mlp_norm\n[算子: RMSNorm]"]
            L0_GU["dense_gate_up\n[算子: Linear · 2560→18432]"]
            L0_SILU["dense_silu\n[算子: SiLU · Multiply]"]
            L0_DOWN["dense_down\n[算子: Linear · 9216→2560]"]
            L0_PON["post_mlp_norm\n[算子: RMSNorm]"]

            L0_IN --> L0_QA --> L0_QCV --> L0_QADD --> L0_QAN --> L0_QB --> L0_ATTN
            L0_IN --> L0_KVA --> L0_KVCV --> L0_KVADD --> L0_KVAN --> L0_KVB --> L0_ROPE --> L0_ATTN
            L0_DSA --> L0_ATTN
            L0_ATTN --> L0_OCV --> L0_OADD --> L0_OP --> L0_PAN --> L0_PMN
            L0_PMN --> L0_GU --> L0_SILU --> L0_DOWN --> L0_PON
        end
        L1_FOLD["L1 · SWA + Dense\n（同 L0 结构，dsa_indexer 不激活）\n[含 16 个算子，同上]"]
        L0_PON --> L1_FOLD
    end

    %% ═══ MoE 层（L2~L45）═══
    subgraph MOE_LAYERS["MoE DecoderLayers (L2~L45, 44 层)"]
        direction TB
        L2_FOLD["L2~L37 …\n（36 层 DSA/SWA + MoE，每层 ~20 算子）\n[算子: RMSNorm ×4 + Linear ×8 + Conv1D ×3\n+ Add ×3 + RoPE + FlashAttention + Router + TopK\n+ gate_up/down ×256 专家 + SiLU + shared gate_up/down + SiLU]"]
        subgraph L38_EXPAND["L38 · SWA + MoE（展开到算子）"]
            direction TB
            L38_IN["input_layernorm\n[算子: RMSNorm]"]
            L38_QA["q_a_proj\n[算子: Linear · 2560→1024]"]
            L38_QCV["q_causal_conv\n[算子: Conv1D]"]
            L38_QADD["q_residual_add\n[算子: Add]"]
            L38_QAN["q_a_norm\n[算子: RMSNorm]"]
            L38_QB["q_b_proj\n[算子: Linear · 1024→9216]"]
            L38_KVA["kv_a_proj\n[算子: Linear · 2560→576]"]
            L38_KVCV["kv_causal_conv\n[算子: Conv1D]"]
            L38_KVADD["kv_residual_add\n[算子: Add]"]
            L38_KVAN["kv_a_norm\n[算子: RMSNorm]"]
            L38_KVB["kv_b_proj\n[算子: Linear · 还原 K_nope/V]"]
            L38_ROPE["rope_apply\n[算子: RoPE · D_rope=64]"]
            L38_ATTN["attention_core\n[算子: FlashAttention · Sparse]"]
            L38_OCV["o_causal_conv\n[算子: Conv1D]"]
            L38_OADD["o_residual_add\n[算子: Add]"]
            L38_OP["o_proj\n[算子: Linear · →2560]"]
            L38_PAN["post_attention_norm\n[算子: RMSNorm]"]
            L38_PMN["pre_mlp_norm\n[算子: RMSNorm]"]
            L38_RG["router_gate\n[算子: Linear · W_router=3]"]
            L38_TK["route_topk\n[算子: TopK · top-8/256]"]
            L38_BANK["routed_expert_bank\n[算子: 256× SwiGLU Expert]\ngate_up[Linear 2560→2048]\nSiLU[Multiply]\ndown[Linear 1024→2560]"]
            L38_SHARED["shared_expert_mlp\n[算子: SwiGLU Shared]\ngate_up[Linear 2560→2048]\nSiLU[Multiply]\ndown[Linear 1024→2560]"]
            L38_COMB["moe_combine\n[算子: Add · shared+Σ(top8×gate)]"]
            L38_PON["post_mlp_norm\n[算子: RMSNorm]"]

            L38_IN --> L38_QA --> L38_QCV --> L38_QADD --> L38_QAN --> L38_QB --> L38_ATTN
            L38_IN --> L38_KVA --> L38_KVCV --> L38_KVADD --> L38_KVAN --> L38_KVB --> L38_ROPE --> L38_ATTN
            L38_ATTN --> L38_OCV --> L38_OADD --> L38_OP --> L38_PAN --> L38_PMN
            L38_PMN --> L38_RG --> L38_TK --> L38_BANK
            L38_PMN --> L38_SHARED
            L38_BANK --> L38_COMB
            L38_SHARED --> L38_COMB --> L38_PON
        end
        L39_FOLD["L39~L45 …\n（7 层 DSA/SWA + MoE，每层 ~20 算子）"]
        L2_FOLD --> L38_PON --> L39_FOLD
    end

    %% ═══ 输出端 ═══
    FN["final_norm\n[算子: RMSNorm]"]
    LH["lm_head\n[算子: Linear · 2560→151552]"]
    LOGITS["logits\n（主输出）"]

    L39_FOLD --> FN --> LH --> LOGITS

    %% ═══ MTP 模块 ═══
    subgraph MTP_TAIL["MTP Module (L46~L48, 3 层)"]
        direction TB
        MTP_IN["mtp_input_norm\n[算子: RMSNorm]"]
        MTP_EH["mtp_eh_proj\n[算子: Linear · 5120→2560]"]
        MTP_DEC["mtp_decoder_layer\n[复用 DecoderLayer 模板]\n[算子: 同 MoE 层 ~20 算子]"]
        MTP_HEAD["mtp_shared_head\n[算子: Linear · 2560→151552]\n(3 层共享)"]
        MTP_OUT["mtp_logits\n（额外预测后续 3 token）"]

        MTP_IN --> MTP_EH --> MTP_DEC --> MTP_HEAD --> MTP_OUT
    end

    %% ═══ 跨模块连线 ═══
    EMB --> L0_IN
    L1_FOLD --> L2_FOLD
    L0_PON -.->|"主 decoder 末层 hidden"| MTP_IN
```

> **L5 算子统计**：主 decoder 共 46 层。Dense 层（L0~L1）每层 16 个算子（RMSNorm×4 + Linear×5 + Conv1D×3 + Add×3 + RoPE + FlashAttention + SiLU）；MoE 层（L2~L45）每层 ~20 个算子（上述 Attention 算子 + Router + TopK + 256×SwiGLU Expert 各 3 算子 + shared Expert 3 算子 + Combine）。总计约 **900+ 个算子节点**，Mermaid 图仅展开 L0 和 L38 为代表，其余折叠。

## 4. 关键参数（全部 source-verified）

| 符号 | 参数 | 值 | 来源 |
|---|---|---|---|
| L | 主 decoder 层数 | **46**（Dense L0-1 + MoE L2-45） | schema / config |
| H | hidden_dim | **2560** | 同上 |
| V | vocab | **151552** | 同上 |
| N_h | 注意力头数 | **48** | 同上 |
| — | 注意力机制 | **Sparse MLA + Causal Conv1D** | source |
| D_qk / D_v | 头维度 | **192**（nope 128 + rope 64）/ **128** | 同上 |
| R_q / R_kv | MLA 低秩 | Q **1024** / KV **512**（+rope=**576**） | 同上 |
| — | 注意力按层混合 | DSA **16** 层（indexer 2048→24）/ SWA **30** 层 | repeats/branches |
| N_sink | Sink Token 数 | **128** | symbol |
| S_mhc | mHC 流数 | **4** | symbol |
| I_dense | Dense FFN 中间维 | **9216**（SwiGLU） | 同上 |
| I_moe | MoE 专家中间维 | **1024**（SwiGLU） | 同上 |
| E / E_shared | 专家数 | **256** 路由 + **1** 共享 | 同上 |
| top_k | 路由 top-k | **8** / 256 | 同上 |
| K_index / N_index | DSA indexer | 候选 **2048** → 选 **24** | 同上 |
| S_max | 最大上下文 | **524288**（512K） | config |
| N_mtp | MTP 层数 | **3**（层 46/47/48） | 同上 |
| — | 总参数 / 激活参数 | **待补**（本地未下载全权重） | — |
| — | 训练数据 / 精度 / rope_theta | **待补** | — |

## 5. 独特设计要点

1. **MLA + Causal Conv1D**：在 Q/KV/O 低秩路径上加入因果短卷积（`q/kv/o_causal_conv`）与残差+LayerNorm，配合 `MoME State`。区别于 DeepSeek 纯低秩 MLA。
2. **DSA/SWA 混合注意力**：1/3 层用 DSA indexer（2048 候选选 24）做稀疏长程注意力，2/3 层用滑动窗口，服务 512K 超长上下文。
3. **256 专家标准 MoE + 1 共享**：`top-8/256`，专家并行（EP）切分；**无 MoGE 分组均衡约束**（那是 Pro MoE 的特性，本模型没有）。
4. **Param Sink Token ×128**：可学习 sink token 抑制极大激活值。
5. **3 层 MTP**：多 token 预测，额外预测后续 3 个 token（Pro MoE 仅 1 层）。
6. **多重 RMSNorm**：input / post-attention / pre-mlp / post-mlp / block-post / final 多处 RMSNorm。


### 附：数据溯源
- canonical schema：`model-architecture/openpangu-2.0-flash/outputs/model_architecture.json`（`schema_version: model_architecture.v1`）
- 校验报告：`.../model_architecture_validation.md`
- 源码根：`openPangu-2.0-Infer/.../models/pangu/pangu_v2_moe.py`、`layers/attention/npu_pangu.py`、`pangu_v2_moe_mtp.py`、`layers/fused_moe/layer.py`
- 官方仓库：`ascend-tribe/openPangu-2.0-Flash`（gitcode，commit `1676856`）

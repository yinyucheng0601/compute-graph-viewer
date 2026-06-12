# 并行训练可视化 — 知识库

## 层、权重矩阵、算子的关系

### 层级结构

```
Transformer Block
├── Attention 层
│   ├── 权重矩阵：W_Q [H×H], W_K [H×H], W_V [H×H], W_O [H×H]
│   └── 算子：QKV MatMul, Scaled Dot-Product, Out MatMul, all-reduce, 残差加
├── MLP 层（标准）
│   ├── 权重矩阵：W_up [H×4H], W_dn [4H×H]
│   └── 算子：up MatMul, SiLU, down MatMul, all-reduce, 残差加
├── Embedding 层
│   ├── 权重矩阵：W_emb [V×H]
│   └── 算子：Embedding lookup（gather，非 MatMul）
└── LM Head 层
    ├── 权重矩阵：W_head [H×V]（通常与 W_emb 共享）
    └── 算子：lm_head MatMul, all-gather（若 TP>1）
```

---

### 一个层有几个权重矩阵？

**0 个、1 个、多个都有可能**，取决于层的类型：

| 权重矩阵数量 | 层类型 | 说明 |
|---|---|---|
| **0 个** | Softmax、SiLU、ReLU、残差加法、Dropout | 纯计算，无可学习参数 |
| **1 个** | Embedding、LM Head | 一个大矩阵做 lookup 或投影 |
| **2 个** | 标准 MLP | W_up + W_dn |
| **3 个** | SwiGLU MLP（LLaMA 风格） | W_gate + W_up + W_dn |
| **4 个** | Attention（非融合） | W_Q + W_K + W_V + W_O |
| **4 + 2×E 个** | MoE 层 | W_router + E 个专家（每个专家 2 个矩阵） |

> LayerNorm/RMSNorm 有 γ、β 两个参数向量（长度 H），但它们是**向量不是矩阵**，对应逐元素乘加而非 MatMul，参数量极小，通常单独讨论。

---

### 权重矩阵与算子的对应关系

基本规则：**1 权重矩阵 : 1 MatMul 算子**（前向 pass）

| 对应关系 | 场景 | 例子 |
|---|---|---|
| 1 权重 : 1 算子 | 标准情况 | W_up → up_proj MatMul |
| 多权重 : 1 算子 | 融合 kernel | W_Q/K/V 拼成 [H×3H] → 一次 fused QKV MatMul |
| 1 权重 : 多算子 | Weight tying | W_emb = W_head，前端 lookup + 后端 lm_head 各用一次 |
| 0 权重 : 1 算子 | 纯计算 | Softmax, SiLU, all-reduce, 残差加法 |

---

### Attention 层算子图（前向）

```
x [B, seq, H]
      ↓
W_Q/K/V [H × H/tp] → QKV Linear (col-parallel)
      ↓
Q/K/V [B, seq, H/tp]
      ↓
Scaled Dot-Product Attention   ← 无权重，纯激活计算
      ↓
attn [B, seq, H/tp]
      ↓
W_O [H/tp × H] → Out Proj (row-parallel)
      ↓
all-reduce                     ← 仅 TP>1
      ↓
x + residual [B, seq, H]
```

### MLP 层算子图（前向，SwiGLU）

```
x [B, seq, H]
      ↓
W_up [H × 4H/tp] → up_proj (col-parallel)
      ↓
SiLU                           ← 无权重
      ↓
W_dn [4H/tp × H] → down_proj (row-parallel)
      ↓
all-reduce                     ← 仅 TP>1
      ↓
x + residual [B, seq, H]
```

---

### 一个权重矩阵在完整训练 step 中被多少个算子访问

demo 里的算子图只展示**前向** pass，但一次完整 training step 里，同一个 W 会被 4 个算子依次访问：

```
前向    output = x @ W          → 消费 W，产出激活值
反向①   grad_x = grad_out @ Wᵀ → 消费 W，产出传给上一层的梯度
反向②   grad_W = xᵀ @ grad_out → 读 x，写 grad_W（梯度累积）
优化器  W -= lr · Adam(grad_W, m, v) → 读写 W、m、v
```

这解释了为什么混合精度训练下每个参数需要 **16 B/param**：
- bf16 权重 2B + fp32 主权重 4B + Adam m 4B + Adam v 4B + 梯度 2B = 16B

---

### Tensor Parallel 下的变化

TP 把权重矩阵按列或行切分到 tp 张卡上，每张卡持有一个 shard：

- **列切（Column Parallel）**：W[:, t·k:(t+1)·k]，各卡算部分输出，最后 all-gather 拼合
- **行切（Row Parallel）**：W[t·k:(t+1)·k, :]，各卡算部分和，最后 all-reduce 求和

原本 1 个逻辑 MatMul 算子，在 TP 下变成：`tp 个并行 shard-MatMul + 1 个通信算子`

---

### MoE 层特殊性

```
x [B, seq, H]
      ↓
W_router [H × E] → gate / router（决定每个 token 去哪个专家）
      ↓  top-k dispatch
all-to-all dispatch            ← 仅 EP>1
      ↓
W_exp_i [H × 4H] → Expert_i FFN（只有被选中的 token 流经）
      ↓
all-to-all combine             ← 仅 EP>1
      ↓
x + residual [B, seq, H]
```

MoE 的 1 个专家 = 2 个 MatMul（up_proj + down_proj），但每个 token 只激活 top-k 个专家（通常 k=2），所以是**稀疏激活**。

---

### Weight Tying（W_emb = W_head）

LLaMA 等模型中 Embedding 权重和 LM Head 权重共享同一块显存：

```
W_emb [V × H]  ──── 前向入口：token ID → 向量
      ↑ 同一块显存（转置关系）
W_head[H × V]  ──── 前向出口：隐状态 → logits
```

好处：节省 V×H 参数量（约 32000×4096 ≈ 128M 参数 ≈ 0.25GB @ bf16）

在 TP 下两者都做列切分，切法对称，梯度在 all-gather 后自动合并。

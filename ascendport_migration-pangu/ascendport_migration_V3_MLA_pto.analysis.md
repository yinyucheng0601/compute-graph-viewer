# AscendPort · MLA Decode 迁移分析纪要（A3 · Ascend C & PTO）

> 配套文件：`ascendport_migration_V3_MLA_pto.html` + `ascendport_migration_V3_MLA_pto_legacy.js`
> 源算子：`example_mla_decode.py`（TileLang / GPU，H100 上的 dense flash-decoding MLA）
> 目标：Atlas A3（Ascend 910C）· tilelang-ascend 的 **Ascend C & PTO** 路线
> 本纪要承载 UI 工作台无法完整表达的映射细节，作为 S2–S8 改写的技术底稿。

---

## 1. 结论先行

不能把这份 H100 TileLang kernel 逐行搬到昇腾。正确做法是**从 tilelang-ascend 现成的 FlashAttention / SparseMLA 示例出发，把 MLA decode 逻辑填进去**。根因是昇腾达芬奇架构（910B/C）采用 **Cube(AIC) 与 Vector(AIV) 分离** 模式：两者没有直连数据通道，交互须经 L2/GM 中转。这决定了 kernel 骨架与 GPU 完全不同——GPU 上一个融合循环里的 `gemm → softmax → gemm`，在昇腾上会被拆成 Cube 算矩阵、Vector 算逐元素、中间靠 buffer 搬运衔接的协同流水。

算法（MLA decode 的在线 softmax）可移植，**代码不可移植**。

## 2. 环境前提

- CANN ≥ **8.3.RC1**
- torch-npu ≥ **2.6.0.RC1**
- 源码安装：`git clone --recursive https://github.com/tile-ai/tilelang-ascend.git` → `bash install_ascend.sh` → `source set_env.sh`
- 冒烟验证：`cd examples/gemm && python example_gemm.py`，应打印 `Kernel Output Match!`
- 已验证硬件：A2 / A3

两种写法先选一种（本工作台默认走后者）：
- **手动同步**：Developer + Expert 混合，自己插 `set_flag / wait_flag / barrier_all`。
- **自动同步（推荐先用）**：设 `threads`（仅 1 或 2），开 `TL_ASCEND_AUTO_CV_COMBINE: True`、`TL_ASCEND_AUTO_CV_SYNC: True`，编译器自动做 CV 分离与跨核同步；此时 `T.Kernel` 返回值只有 `cid`、没有 `vid`。

## 3. 原语映射表

| GPU 原语（源） | A3 Ascend C & PTO 对应 | 说明 |
|---|---|---|
| `threads=256` | `is_npu=True`（返回 cid,vid）或 `threads=1/2`（仅 cid） | 昇腾无线程抽象，按 AI Core 组织 |
| `T.alloc_shared` | `T.alloc_shared`（Developer）或 `T.alloc_L1` / `T.alloc_ub`（Expert） | shared 对应 Cube 的 L1 与 Vector 的 UB，编译器按上下文识别 |
| `T.alloc_fragment` | `T.alloc_fragment` 或 `T.alloc_L0A/L0B/L0C` | GEMM 累加器必须落 L0C |
| `T.gemm(A,B,C,transpose_B=True,clear_accum=True)` | `T.gemm_v0(A_l1,B_l1,C_l0c,transpose_B=True,init=True)` | 左右矩阵在 L1、输出在 L0C；`init` 取代 `clear_accum` |
| `T.GemmWarpPolicy.FullCol` | **删除** | warp 划分是 GPU 概念，昇腾无 |
| `T.use_swizzle(10)` | **删除**，改 `T.Persistent` | swizzle 无对应；Persistent 做核间负载均衡与缓存友好调度 |
| `T.reduce_max/sum(...,dim=1)` | `T.reduce_max/sum(...,dim=-1,clear=...)` | 语义一致；主要服务 UB tile/slice |
| `T.exp2(x*scale)` + log2(e) | `T.exp(x*softmax_scale)`（或 `T.tile.exp`） | **数值坑**：指南只有自然 `exp`，无 exp2。去掉 1.44269504，全程改自然底 |
| element-wise（`T.Parallel` 内） | `T.Parallel`+符号 API 或 `T.tile.add/mul/exp/...` | 两种范式都支持 |
| `T.Pipelined(...,num_stages=2)` | 保留 | 语义是访存/计算流水掩盖；核间与核内流水不能同时开 |

## 4. 结构性改写（不是改名能解决的）

### 4.1 Cube/Vector 分离 → 显式 buffer 搬运
910C 的 L0C 无直连 Vector，copy 路径受限：支持 `GM↔UB`、`UB↔UB`、`UB→L1`、`L1→L0A/L0B`、`L0C→GM`，**没有 `L0C→UB` 直连**。因此 `gemm → exp2 → gemm` 变成：
```
QK(Cube) → L0C → GM workspace → UB
   → 在线 softmax(Vector: reduce_max/减/exp/reduce_sum/rescale)
   → UB → L1 → PV(Cube) → L0C
```
这是重写量最大的地方。

### 4.2 split-KV + combine 先砍掉
源码的 `num_split` 是 flash-decoding。**第一版直接走 `main_no_split`（num_split=1）** 把正确性跑通。之后再用 GM workspace 存各核 partial O 与 LSE，第二阶段 Vector 归约合并——参考 SparseMLA 的 paged 版。

### 4.3 MLA 的 KV 复用与容量
KV 同时当 QK 的 K（transpose_B）和 PV 的 V，`dim=512` 偏大。`gemm_v0` 内部自管 L0A/L0B，但 L1 里要同时放 Q(block_H×512)、KV(block_N×512)、pe、P，**L1 容量须核算**，超了得对 dim 分块。

### 4.4 数值一致性
`exp2` + log2(e) 技巧改成自然 `exp`；`logsum`/LSE 的 log2 空间也要一并改成自然 ln/exp，保持 split/combine 阶段口径一致。这是精度对齐（工作台 S7）的主要风险源，不是 UI demo 里旧的 "FP8 累加序" 问题。

## 5. 核心循环骨架（no-split · 自动同步模式）

> 脚手架，需在真机验证；`ws_s` 为 `T.alloc_global` 中转 workspace，`m_i/logsum/scale_i` 在 UB。

```python
for k in T.Pipelined(T.ceildiv(seqlen_kv, block_N), num_stages=2):
    # --- Cube: QK^T，主 dim 与 pe 两次累加 ---
    T.copy(KV[bid, k*block_N:(k+1)*block_N, cur_kv_head, :], kv_l1)
    T.copy(K_pe[bid, k*block_N:(k+1)*block_N, cur_kv_head, :], kpe_l1)
    T.gemm_v0(q_l1,   kv_l1,  acc_s_l0c, transpose_B=True, init=True)    # 对应 clear_accum
    T.gemm_v0(qpe_l1, kpe_l1, acc_s_l0c, transpose_B=True, init=False)   # 累加
    T.copy(acc_s_l0c, ws_s[cid, :, :])          # L0C -> GM（无直连 UB）

    # --- Vector: online softmax（自然底，去掉 exp2）---
    T.copy(ws_s[cid, ...], acc_s_ub)
    T.copy(m_i, m_i_prev)
    T.reduce_max(acc_s_ub, m_i, dim=-1, clear=False)      # 与历史 max 取大
    for i, j in T.Parallel(block_H, block_N):
        acc_s_ub[i, j] = T.exp((acc_s_ub[i, j] - m_i[i]) * softmax_scale)
    T.reduce_sum(acc_s_ub, l_i, dim=-1)
    for i in T.Parallel(block_H):
        scale_i[i] = T.exp((m_i_prev[i] - m_i[i]) * softmax_scale)
        logsum[i]  = logsum[i] * scale_i[i] + l_i[i]
    for i, j in T.Parallel(block_H, dim):
        acc_o_ub[i, j] *= scale_i[i]              # rescale 历史输出
    T.copy(acc_s_ub, p_l1)                        # UB -> L1，给 PV 当左矩阵

    # --- Cube: PV ---
    T.gemm_v0(p_l1, kv_l1, acc_o_l0c, init=(k == 0))
# 循环后：acc_o /= logsum，再经 GM/UB 归一后写回 Output
```

## 6. 构建与调试（A3）

- soc-version：910C 家族（含 910C1 等子型号），`msprof op simulator` 配合 `--soc-version=Ascend910C*`。
- `func.get_kernel_source()` 打印生成的 AscendC 代码；`T.printf` / `T.dump_tensor` 做设备端 dump。
- 流水调优（num_stages、Double Buffer）见 tilelang-ascend 的 Flash Attention Performance Optimization Guide。
- 参考实现基准：SparseMLA 在相同输入下，TileLang 生成算子可达 AscendC 手写参考 ~0.90× 性能。

## 7. 本纪要与工作台 UI 的对应关系（本次更新范围）

已同步进 `pto.html` / `_legacy.js` 的内容：
- 目标标识：Atlas 800T A2 / 910B → **Atlas A3 (Ascend 910C)**；路线标注 **Ascend C & PTO**。
- 工具链：CANN 8.0 → **8.3.RC1**，新增 **torch-npu 2.6.0.RC1**。
- 数据类型：FP8 e4m3 → **FP16 · FP32 累加**（状态栏与上下文条）。
- 内存架构标题：昇腾 910B → **昇腾 A3 (910C)**。
- 问题面板：替换为本分析的真实迁移风险（`T.exp2` 无对应、`GemmWarpPolicy`/`use_swizzle` 无对应、split-KV+combine 与 `L0C→UB` 无直连）。
- 数据流主注释：点出 910C 的 Cube/Vector 分离与 L0C→GM→UB 中转、QKᵀ 由 FP8 改 FP16。
- 精度问题（S7）：由旧的 "WeightedHeadReduce / FP8 累加序" 改为 "exp2→exp 底数改写 + Vector 归约次序 / FP16 累加"。

**本轮已补齐**（在 vendor 设计系统就位后，经无头浏览器渲染验证、零控制台报错）：
- S1–S8 向导正文（STEPS）：整体改写为标准 MLA decode 叙事（Q·KVᵀ + Q_pe·K_peᵀ → 在线 Softmax → P·V），去掉 Lightning Indexer / TopK / 双调排序 / FP8；风险项改为 `use_swizzle` / `GemmWarpPolicy.FullCol` / `exp2+log2(e)`。
- `S3/S4/S6` AscendC 源码字符串：由 fp8 + topk/indices/paged 稀疏骨架改写为 **dense FP16** MLA decode（`half*` 缓冲、`DIM=512`/`PE_DIM=64`、Q|Q_pe 与 KV|K_pe 拼接搬运、L0C→GM→UB 中转、自然 `Exp`、P·V 累加）。
- `LINKMAP`：`cuda:`/`asc:` 行号重新对准真实 MLA 源码（`main_no_split`）与新 codegen；标签改为 dense-MLA 语义。
- `ACC_OPS` 精度清单与根因：异常算子由 `WeightedHeadReduce`/FP8 累加序改为 `Exp·在线 Softmax` / exp2→exp 底数改写 + 在线归约次序 + FP32 累加；修复 diff 同步。
- `tilingSrc` / `FLOW_STEPS` / `FUNITS` / `selectNode` / `riskHL` / `etbFile` / perf 报告 / aclNN 名（`aclnnFlashMLADecode`）等标签全部对齐 dense MLA。
- `SparseMLA ≈ 0.90× AscendC` 作为**参考基准**保留（S8 性能叙述），这是 tilelang-ascend 的真实数据点，非旧稀疏叙事。

**有意保留**：左侧源码 `CUDA`（即上传的真实 `example_mla_decode.py`，作为迁移输入不改）；语法高亮关键字集里的 `__nv_fp8_e4m3` 等 CUDA 关键字（仅影响高亮，MLA 源码中不出现）；内存架构 pattern 的路由键 `ascend910b`（vendor 设计系统仅定义该 arch key，改动会使内存可视化面板无法渲染——它是功能性 ID，非显示文案，显示层已是 A3/910C）。

## 8. 验收 / 待办

- [ ] 环境搭好（CANN 8.3.RC1 + torch-npu 2.6.0.RC1），gemm 冒烟通过。
- [ ] no-split 正确性版：`profiler.assert_allclose` 对齐参考实现（自然 exp 口径）。
- [ ] L1 容量核算，必要时对 dim=512 分块。
- [ ] 加 split-KV + combine，对齐 flash-decoding 性能。
- [x] 将 S1–S8 向导与 S3/S4/S6 codegen 串整体改写为标准 MLA decode 叙事（本轮完成，已渲染验证）。

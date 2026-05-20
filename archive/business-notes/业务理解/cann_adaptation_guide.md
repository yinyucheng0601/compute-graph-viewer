# DeepSeek 大模型适配昇腾 910B 

> 来源：昇腾社区 CANN 官方发布文档（与 gitcode.com/cann 同一套官方资料体系）
> 整理日期：2026-03-16

---

## 摘要

把一个大模型部署到昇腾 910B 上，"适配"不是把 `.pt` 或 `.onnx` 文件丢进去跑一遍。它是一组分层次的工程决策：先看芯片的内存规模和互连拓扑，决定跑哪种精度、要几台机器、怎么切并行；再看 CANN 软件栈的约束，把不兼容的实现路径替换掉；最后到单个 kernel 的层面，根据片上缓存层级（L2/L1/UB）做 tile 切分、数据复用和子图调度。

以 DeepSeek-V3 为例：64GB/卡 × 8 卡/机的规格决定了 BF16 需要 4 台服务器、W8A8 可以压到 2 台；8 卡 HCCS 单机互连决定了 `tp=8` 是最自然的张量并行切法；原始代码里的 `flash_attn` 和 FP8 加载路径需要替换；MLA 相关 kernel 的主要瓶颈是搬运而非算力，要靠 L1 Reuse 和子图合并来解决。

本文从八个层次系统梳理适配清单，并附具体案例和官方文档来源。

---

## 全局视图

```
用户模型（PyTorch / ONNX / ATB 图接口）
        │
        ▼
 ┌─────────────────────────────────────────────────┐
 │              CANN 软件栈                         │
 │  Framework Adapter → Graph Engine → Op Library  │
 └─────────────────────────────────────────────────┘
        │
        ▼
 ┌─────────────────────────────────────────────────┐
 │           Ascend 910B 芯片                       │
 │   AI Core / Cube / Vector / HBMC / NIC          │
 └─────────────────────────────────────────────────┘
```

适配就是打通这条路上的每一层。

---

## 八层适配清单

| # | 适配层 | 核心问题 | 关键 API / 文档 |
|---|--------|----------|-----------------|
| 1 | 目标芯片 & 版本配套 | 你要跑在哪颗芯片上 | `aclgrphBuildInitialize` → `SOC_VERSION` |
| 2 | 模型前端接入路径 | 模型从哪个入口进 CANN | Framework Adapter / ONNX 解析 / ATB 图接口 |
| 3 | 算子实现覆盖 | 每一步计算平台上有没有 | `aclnn` / ATB Operation / Ascend C 自定义算子 |
| 4 | 张量精度 & 格式 & 排布 | dtype / format 怎么对齐硬件 | ND / NC1HWC0 / FRACTAL_Z / ACL_BF16 限制 |
| 5 | 动态 shape & KV cache | 大模型输入不固定怎么处理 | 动态 shape 范围 / KVCacheOperation |
| 6 | 切块、workspace、调度 | 数据怎么拆成芯片能高效吞的块 | Host 侧 tiling / TilingData / blockDim |
| 7 | 多卡通信 & 并行 | 多卡怎么切、怎么通信 | HCCL / ATB 分布式推理 / TP / PP |
| 8 | 性能调优 | 编译成功 ≠ 跑得值，还要调 | AOE（算子 + 整网调优闭环） |

---

## 逐层详解

### 1 先定芯片型号，不是先看模型

CANN 图编译接口 `aclgrphBuildInitialize` 里，`SOC_VERSION` 就是目标芯片型号。不同型号的能力、支持特性和编译参数并不完全一样。

> **关键结论：** 部署的第一件事不是"模型长什么样"，而是"你到底要跑在 Ascend 哪个型号上"。

| 接口 | 作用 |
|------|------|
| `aclgrphBuildInitialize` | 指定图编译目标芯片（SOC_VERSION） |
| `aclgrphBuildModel` | 把 Graph 编译成适配该芯片的离线模型 |

来源：[aclgrphBuildInitialize 支持的配置参数](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/82RC1/API/ascendgraphapi/atlasgeapi_07_0140.html) · [Ascend Graph 开发指南](https://www.hiascend.com/doc_center/source/zh/CANNCommunityEdition/80RC1alpha002/devguide/moddevg/graphdevg/CANN%208.0.RC1.alpha002%20Ascend%20Graph%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97%2001.pdf)

---

### 2 模型前端接入路径

CANN 不只管执行，中间还有 Framework Adapter → Graph Engine → Operator Library 三层。不同框架的计算图需先通过统一 IR 接口进入图解析、优化和编译。

```
PyTorch ──┐
ONNX    ──┼──► Framework Adapter ──► 统一 IR ──► Graph Engine ──► Op Library ──► 910B
TF/Caffe ─┘                          ▲
ATB 图接口 ────────────────────────────┘
```

> **关键结论：** 这一步适配的是"模型前端表示"，即确定走哪条接入路径。

来源：[CANN 总体架构](https://www.hiascend.com/en/cann) · [原始模型转换为 Graph](https://www.hiascend.com/document/detail/zh/canncommercial/81RC1/developmentguide/graph/graphdevg/atlasag_25_0024.html) · [CANN 逻辑架构](https://www.hiascend.com/document/detail/zh/canncommercial/5046/modeldev/tfmigr/tfmigr_000005.html)

---

### 3 算子实现覆盖（核心层）

模型里每一步计算（attention、matmul、norm、rope、quant、cache 写回...）在目标芯片上有没有高性能实现。

```
优先用现成高性能算子
    │
    ├── aclnn 高性能算子接口（直接调用）
    ├── ATB Operation / GraphOperation / PluginOperation（图算子拼接）
    └── Ascend C 自定义算子（以上都覆盖不了时）
```

| 层级 | 工具 | 适用场景 |
|------|------|----------|
| L1 高性能算子 | `aclnn` 系列接口 | 主流算子有现成实现 |
| L2 图算子拼接 | ATB Operation / GraphOperation | 组合已有能力 |
| L3 自定义 kernel | Ascend C | 平台无现成实现时兜底 |

来源：[aclnn 开发接口概述](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/82RC1alpha003/API/ascendcopapi/atlasascendc_api_07_1040.html) · [ATB Operation 概述](https://www.hiascend.com/document/detail/zh/canncommercial/80RC3/developmentguide/acce/ascendtb/ascendtb_0007.html)

---

### 4 张量精度 & 格式 & 内存排布

这是最容易被低估的一层。Tensor 不只是 shape，还包括 dtype 和 format。

| 格式 | 说明 | 典型场景 |
|------|------|----------|
| `ND` | 通用格式 | 默认输入输出 |
| `NC1HWC0` | 按 AI Core 拆分通道 | 卷积高性能路径 |
| `FRACTAL_Z` | 贴合 Cube 的矩阵块格式 | 矩阵乘高性能路径 |

**精度限制示例：** ATB 文档明确写了，Atlas 推理系列产品**默认不支持 `ACL_BF16`**。

适配清单：
- [ ] 用什么精度（FP16 / BF16 / INT8 / FP32）
- [ ] 用什么 layout
- [ ] 是否需要格式转换算子
- [ ] 目标型号是否支持该格式/精度

来源：[Ascend IR 算子规格简介](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/850/API/aolapi/operatorlist_00094.html) · [数据排布格式](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/82RC1/opdevg/Ascendcopdevg/atlas_ascendc_10_0099.html) · [ATB 注意事项](https://www.hiascend.com/document/detail/zh/canncommercial/800/apiref/ascendtbapi/ascendtb_01_0001.html)

---

### 5 动态 shape & KV Cache（大模型专属）

大模型和普通 CV 模型最大的不同：输入不固定。

```
普通 CV 模型   → 固定 shape → 编译一次，反复用
大模型推理      → prefill 和 decode 两阶段，shape 持续变化 + KV 持续积累
```

| 能力 | 说明 | 平台限制 |
|------|------|----------|
| 动态 shape 范围 | 允许 batch/seq/token 数变化 | 某些产品**不支持** |
| 动态维度档位 | 预先注册多个 shape 档位 | 编译阶段需指定 |
| `KVCacheOperation` | KV cache 原生算子 | **仅支持 A2/A3 系列** |

来源：[动态输入 shape 范围](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/82RC1alpha003/graph/graphdevg/atlasag_25_0054.html) · [动态维度档位](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/83RC1alpha001/graph/graphdevg/atlasag_25_0052.html) · [KVCacheOperation](https://www.hiascend.com/document/detail/zh/canncommercial/81RC1/apiref/ascendtbapi/ascendtb_01_0060.html)

---

### 6 切块、workspace、执行调度

Local Memory 往往装不下完整输入输出，所以必须把数据切成块，算一块、搬一块。

Host 侧 tiling 需要计算：

| 参数 | 含义 |
|------|------|
| `TilingData` | 分块策略描述 |
| `blockDim` | 并行块数量 |
| `TilingKey` | 选择哪套切块方案 |
| `workspace` | 算子临时中间内存需求 |

> **关键结论：** 适配芯片 = 适配这颗芯片的片上存储容量、数据搬运方式、并行切分方式。

来源：[Host 侧 tiling 实现](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/82RC1/opdevg/Ascendcopdevg/atlas_ascendc_10_0064.html) · [workspace 说明](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/850/opdevg/Ascendcopdevg/atlas_ascendc_10_0092.html)

---

### 7 多卡通信 & 并行（单卡跑通不够）

大模型实际部署几乎都是多卡。

| 并行策略 | 说明 |
|----------|------|
| Tensor Parallel (TP) | 矩阵按列/行切，多卡各算一部分 |
| Pipeline Parallel (PP) | 模型层切段，每卡负责若干层 |
| 数据并行 (DP) | 不同 batch 分到不同卡 |

通信原语（HCCL）：AllReduce、AllGather、ReduceScatter、Broadcast

> **关键结论：** 多卡通信层直接决定大模型的整体吞吐和时延，不是"单卡能跑"就够了。

来源：[HCCL 简介](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/850/commlib/hcclug/hcclug_000001.html) · [ATB 分布式推理背景](https://www.hiascend.com/document/detail/zh/canncommercial/81RC1/developmentguide/acce/ascendtb/ascendtb_0040.html) · [ATB 通信算子介绍](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/83RC1alpha001/acce/ascendtb/ascendtb_0042.html)

---

### 8 性能调优（编译成功 ≠ 跑得值）

AOE（Ascend Optimization Engine）做"生成调优策略 → 编译 → 在运行环境验证"的闭环。

```
编译成功
    │
    ├── 算子级性能调优（单算子 benchmark）
    ├── 整网性能调优（端到端 profiling）
    ├── 编译策略优化（更好的 tiling / fusion）
    └── 实际运行验证（真实数据 + 真实负载）
```

> **关键结论：** 最终的适配对象，除了功能正确性，还包括**性能最优解**。

来源：[AOE 简介](https://www.hiascend.com/document/detail/zh/canncommercial/850/devaids/aoe/aoeep_16_001.html)

---

## 总结：适配层次图

```
┌────────────────────────────────────────────────────────┐
│  1. 目标芯片型号 & CANN 版本配套                         │  ← 先定这个
├────────────────────────────────────────────────────────┤
│  2. 模型前端接入路径（PyTorch / ONNX / ATB 图接口）      │
├────────────────────────────────────────────────────────┤
│  3. 算子实现覆盖（aclnn → ATB → Ascend C 自定义）        │  ← 核心层
├────────────────────────────────────────────────────────┤
│  4. 张量精度 / 格式 / 内存排布对齐                        │
├────────────────────────────────────────────────────────┤
│  5. 动态 shape & KV Cache（大模型专属）                  │
├────────────────────────────────────────────────────────┤
│  6. 切块 / workspace / 执行调度（片上存储适配）            │
├────────────────────────────────────────────────────────┤
│  7. 多卡通信 & 并行策略（TP / PP / HCCL）                │
├────────────────────────────────────────────────────────┤
│  8. 性能调优（AOE 闭环）                                 │  ← 最后这个
└────────────────────────────────────────────────────────┘
```

**"适配芯片"从来不是把模型文件复制过去，而是逐层对齐上面 8 件事。**

---

## 延伸问答

### PyPTO 在这个适配过程中可以起到什么作用？

PyPTO 是一个**编译过程的可视化工具**，不参与编译本身。它做的事情是：

```
Python 算子源码 / CANN 编译输出的 Pass IR JSON
        │
        ▼
    PyPTO 可视化
        │
        ▼
工程师能"看见"计算图在每个编译阶段长什么样
```

它的价值不是"做适配"，而是在适配过程中**提供可见性**——让工程师知道"现在编译器对我的模型做了什么"。

**对应到八层清单，哪几层有帮助：**

| 层 | PyPTO 能做什么 | 价值 |
|----|----------------|------|
| 3. 算子实现覆盖 | 在 Pass IR 图里看到哪些算子经过了替换、融合，或者编译失败 | 定位"这个 op 平台上有没有实现" |
| 4. 张量格式 & 排布 | 查看节点上 tensor 的 shape、dtype、format 标注 | 发现格式转换算子是否被正确插入 |
| 5. 动态 shape & KV cache | 逐 Pass 追踪 shape 推导过程 | 看动态 shape 在哪个 Pass 被固化或出错 |
| 6. 切块 & 调度 | 查看 tiling 相关 Pass 对图的变换 | 理解切块策略是否符合预期 |
| 8. 性能调优 | 锁定特定计算流，对比优化前后的图结构 | 精准定位性能瓶颈在哪个算子 |

**哪几层 PyPTO 基本帮不上：**

| 层 | 原因 |
|----|------|
| 1. 芯片型号配套 | 这是编译参数层面的事，图可视化看不到 |
| 2. 前端接入路径 | 框架适配发生在进图引擎之前 |
| 7. 多卡通信 & 并行 | 当前 PyPTO 只做单卡计算图，通信拓扑不在视图里 |

PyPTO 是适配过程的**调试放大镜**，主要价值在中间几层（3、4、5、6）——当你不确定编译器对模型做了什么变换时，用 Pass IR 视图逐阶段对比，找出适配断点在哪里。

---

### 通信拓扑是什么？有什么竞品能做吗？

**通信拓扑是什么**

单卡推理里，计算图的节点是算子（matmul、attention...），边是 tensor 数据流。

多卡推理里，除了算子间的 tensor 流，卡与卡之间也要传数据。通信拓扑描述的就是这层关系：

```
Card 0 ──AllReduce──► Card 1
  │                     │
  └──ReduceScatter──► Card 2
                        │
                     AllGather
                        │
                      Card 3
```

具体包含：
- 哪些卡之间有通信（rank 拓扑）
- 用的是哪种集合通信原语（AllReduce / AllGather / ReduceScatter / Broadcast）
- 通信发生在哪个算子前后（计算-通信依赖关系）
- 通信和计算是否并行（overlap 情况）

对大模型来说，TP 每层都有 AllReduce，PP 每个 microbatch 都有点对点通信，这些加在一起的时序关系直接决定整体吞吐。

**竞品能做吗**

| 工具 | 能不能看通信拓扑 | 说明 |
|------|-----------------|------|
| Nsight Systems（NVIDIA）| 能，但是 timeline 形式 | 能看 NCCL 通信在时间轴上的位置，看不到卡间依赖图 |
| Horovod Timeline | 能，Gantt 图 | 通信/计算 overlap 可见，但绑定 Horovod，不通用 |
| MindInsight（华为） | 部分能 | MindSpore 生态配套，有通信分析，但主要是统计报表，不是图 |
| PyTorch Profiler + TensorBoard | 弱 | 能看 NCCL 算子耗时，拓扑关系要自己推断 |
| Perfetto | 能，但原始 | 通用 trace 工具，需要配合 profiler 输出，可视化不专业 |

目前没有工具能同时做到"计算图结构（算子级）+ 通信拓扑（卡间依赖）"的联合可视化。现有工具要么只看时间轴（timeline），要么只看单卡计算图。这是一个真实的空白——工程师排查多卡推理性能问题时，往往要在 Nsight 的 timeline 和自己画的拓扑图之间来回对照。

对 PyPTO 来说，这是一个潜在的差异化方向，但难点在于通信数据（HCCL trace）的获取和格式解析，不是纯前端可以独立完成的。

---

## 具体案例：DeepSeek 部署到 910B 全流程

> 口径说明：官方文档中 910B 很少以裸芯片规格表出现，更多以产品形态（Atlas 800I A2、Atlas 300I A2）出现。本节把两类信息合并：产品侧规格来自官方公开页和 DeepSeek 部署 FAQ，编译器/算子侧规格来自官方仓 910B 平台配置。

---

### 910B 规格

**产品侧（Atlas 300I A2 单卡）**

| 指标 | 数值 |
|------|------|
| FP16 / BF16 算力 | 280 TFLOPS |
| INT8 算力 | 560 TOPS |
| HBM 带宽 | 最高 1.6 TB/s |
| 单卡显存（Atlas 800I A2） | 64 GB |
| 服务器标准配置 | 8 NPU / 台，卡间 HCCS 高速互连 |

**芯片侧（Ascend910B1.ini，编译器视角）**

| 资源 | 规格 |
|------|------|
| Cube Core | 24 |
| Vector Core | 48 |
| AI CPU | 4 |
| 内存 | 64 GiB |
| L2 | 192 MiB |
| L1 | 512 KB |
| UB | 192 KB |
| Cube 主频 | 1850 MHz |

这些数字决定了 DeepSeek 适配时要不要量化、怎么分卡、怎么切 tile、为什么某些 kernel 的瓶颈是搬运而非算力。

---

### 容量适配：先算装不装得下

把 DeepSeek-R1 / V3 全量模型部署到 910B，第一个现实问题不是能不能编译，而是一台 8 卡服务器装不装得下。

官方 FAQ 给出的最低配置（64K 上下文）：

| 精度路线 | 最少机器数 | 显存估算 |
|----------|-----------|---------|
| BF16 | 4 台 Atlas 800I A2 | 4 × 8 × 64 GB = 2 TB |
| W8A8 | 2 台 Atlas 800I A2 | 2 × 8 × 64 GB = 1 TB |

容量预算公式：

```
模型参数 + KV Cache + 中间激活 + workspace + 通信缓冲 ≤ 总显存
```

910B 规格先决定了"能跑哪种精度、要几台机器"，然后才轮到图编译和 kernel 调优。

---

### 拓扑适配：为什么 tp=8 是最自然的切法

官方 DeepSeek 部署文档中，一个典型参数是 `tp=8`，背后直接对应 910B 产品形态：

```
一台 Atlas 800I A2 = 8 个 NPU
tp=8 = 一个 tensor parallel group 正好落满一台服务器
```

这样做的收益：

- Attention 和 MLP 的张量并行通信全在单机 HCCS 内部完成
- 最重的通信不走跨机网络
- 如果再叠加专家并行（EP），官方文档明确限制：**大规模 EP 只支持 64GB HCCS 形态，需要 200G 光模块；32GB HCCS 和 32GB PCIe 不支持**

拓扑适配的本质：把最重的通信收在互连带宽最高的层级内，而这个层级由 910B 的硬件拓扑决定。

---

### 实现适配：原始 DeepSeek 路径需要改动

DeepSeek 的原始实现假设了另一套硬件生态，直接跑在 910B/CANN 上需要修改：

| 改动点 | 原因 |
|--------|------|
| 删除 `load_format="dummy"` | CANN 不支持该加载方式 |
| 注释掉 `flash_attn` | 910B 有自己的高性能 Attention 实现路径 |
| FP8 权重加载/推理路径替换 | 910B 当前精度支持与原始路径不兼容 |

本质是：把不兼容的实现替换掉 → 把精度路线换成 910B 更适合的路线 → 把图和运行时配置换成 CANN/MindIE 能接受的方式。

---

### Kernel 适配：910B 片上存储层级逼着你做 tile 和 reuse

以 DeepSeek 中的 QuantIndexerProlog（MLA 相关）为例，在 Batch=4、KV Cache=64K 典型场景下，主要瓶颈不是算力不够，而是搬运瓶颈：

| 问题 | 原因 |
|------|------|
| Vector 任务多而稀疏，子图之间有气泡 | 24 Cube + 48 Vector 需要精细调度才能打满 |
| 右矩阵重复搬运 | L1=512KB，大矩阵无法整块片上驻留 |
| 不同 kernel 段之间搬运浪费 | UB=192KB，中间数据必须分级搬运 |

对应优化手段：

```
统一 TileShape
  → Cube Tile 调整
    → L1 Reuse（右矩阵复用）
      → cube/vector 子图合并
        → Prefill / Decode 两阶段分开调度策略
```

官方 matmul 指南给出的 910B 24 核典型配置建议：

```
L2 带宽 ≈ HBM 带宽 × 3
优先让 tile 配置提高 L2 命中率
典型可取 mDim=6, nDim=4 或 mDim=8, nDim=3
```

---

### 四层适配总结

| 层级 | 约束来源 | 典型决策 |
|------|---------|---------|
| 容量适配 | 64 GB/卡 × 8 卡/机 | BF16 还是 W8A8，需要 2 台还是 4 台 |
| 拓扑适配 | 8 NPU + HCCS 单机互连 | tp=8，重通信收在单机内，EP 需 64GB HCCS |
| 实现适配 | CANN/MindIE 运行时约束 | 替换 flash_attn、FP8 路径、加载配置 |
| Kernel 适配 | 24 Cube + 48 Vector + 192MiB L2 + 512KB L1 | tile 切分、L1 Reuse、子图合并、Prefill/Decode 分策略 |

> "DeepSeek 适配 910B"本质上是把 DeepSeek 的模型表示、并行方式和 kernel 实现，重新对齐到 910B 的内存规模、互连拓扑、精度能力和片上缓存层级。

---

### 参考文档

| 文档 | 链接 |
|------|------|
| Atlas 300I A2 产品页 | https://www.hiascend.com/hardware/accelerator-cards/atlas-300i-a2 |
| MindIE DeepSeek FAQ | https://www.hiascend.com/document/detail/zh/mindie/100/faq/mindie_service0005.html |
| DeepSeek-R1/V3 昇腾部署文档 | https://www.hiascend.com/document/detail/zh/mindie/100/mindieservice/Thirdpartyservitization/mindie_openthird_0016.html |
| DeepSeek-V3.1 迁移文档 | https://www.hiascend.com/document/detail/zh/mindie/100/mindieservice/Thirdpartyservitization/mindie_openthird_0015.html |
| DeepSeek-V3.1 部署文档（EP） | https://www.hiascend.com/document/detail/zh/mindie/100/mindieservice/Thirdpartyservitization/mindie_openthird_0019.html |
| Ascend910B1.ini（编译器芯片配置） | 官方 PyPTO 仓 |
| matmul_performance_guide.md | 官方 PyPTO 仓 |
| performance_case_quantindexerprolog.md | 官方 PyPTO 仓 |

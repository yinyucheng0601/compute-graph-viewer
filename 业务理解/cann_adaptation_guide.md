# DeepSeek 大模型适配昇腾 910B — 八层适配清单

> 来源：昇腾社区 CANN 官方发布文档（与 gitcode.com/cann 同一套官方资料体系）
> 整理日期：2026-03-16

---

## TL;DR

> 把一个大模型部署到某个型号的昇腾芯片上，"适配"不是部署一个 `.pt` 或 `.onnx` 文件，而是在适配：
>
> **模型表示 → 算子能力 → 张量规格 → 缓存机制 → 编译策略 → 通信机制 → 性能调优**

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

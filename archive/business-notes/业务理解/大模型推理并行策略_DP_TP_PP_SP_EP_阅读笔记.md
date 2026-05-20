# 《大模型推理并行策略 (DP/TP/PP/SP/EP) 原理简介》阅读笔记

原文信息：
- 标题：`大模型推理并行策略(DP/TP/PP/SP/EP)原理简介`
- 作者：`kaiyuan / InfraTech`
- 发布时间：`2026-02-19 10:00`
- 原文链接：<https://mp.weixin.qq.com/s/PiRPWWZpnJbAbU47sJr-gw>

这篇文章的价值，不在于给出某个框架的具体配置，而在于把推理并行的基本分类讲清楚了：**不同并行策略，本质上是在切不同维度、解决不同瓶颈。**

对当前 PTO 来说，这篇文章不是“现成功能说明书”，更像一篇**补齐推理并行基本词汇、帮助界定产品边界的背景笔记**。其中最有直接价值的是 `TP` 和 `EP`，其次是帮助区分“当前工具已经能解释什么”和“当前工具还解释不了什么”。

## 1. 文章的核心结论

文章把大模型推理中的常见并行方式归成五类：

- `DP (Data Parallel)`：切 batch / 请求副本
- `TP (Tensor Parallel)`：切隐藏维或层内矩阵
- `SP (Sequence Parallel)`：切序列维
- `PP (Pipeline Parallel)`：切层
- `EP (Expert Parallel)`：切 MoE experts

它的关键判断有三条：

第一，没有一种并行策略能通吃所有场景。  
第二，推理场景里最常见的是 `DP + TP`，长上下文场景会叠 `SP/CP`，MoE 模型会叠 `EP`。  
第三，`PP` 在推理里通常不是优先选项，更像“单卡放不下模型权重时的兜底方案”。

如果把这篇文章压缩成一句话，就是：

```text
并行策略不是“选一种”，而是根据瓶颈位置决定“切哪一维”，再按实际场景组合使用。
```

## 2. 五种策略分别在解决什么问题

### 2.1 DP：解决吞吐，不解决单卡放不下模型

DP 的本质是整模型复制多份，每张卡处理不同请求或不同 batch 分片。

它的优点是思路最直观，适合提升并发吞吐；它的局限也很明确：

- 不减少单卡模型显存占用
- 不减少单次请求的算力压力
- 更像服务层扩副本，而不是模型内部分解

因此，DP 对系统部署很重要，但对“模型内部一层是怎么被拆开的”帮助有限。

### 2.2 TP：解决单卡显存和单卡算力压力

TP 把层内矩阵计算切到多张卡上做，本质依赖矩阵分块计算的可组合性。

它在推理里非常常见，因为它同时解决两个现实问题：

- 一张卡放不下完整权重
- 一张卡算单层太慢

代价是每层都会有跨卡通信，比如 `all_reduce`、`all_gather` 之类。也就是说，TP 的核心不是“只是把大矩阵拆小”，而是：

```text
算子内部分片计算 + 层间持续通信
```

### 2.3 SP / CP：解决长序列问题

SP 把序列维切开，让不同设备分别处理不同 token 片段。CP 也属于沿序列维切分的一类方法，但更针对 attention 相关计算。

这类方法的价值主要体现在长上下文场景：

- 单卡 attention 内存压力过大
- 序列很长，单设备处理延迟和显存都不理想

它和 `TP` 的区别在于：`TP` 主要切隐藏维，`SP/CP` 主要切序列维。

### 2.4 PP：按层切，但推理里通常不是优先选项

PP 把模型层切成多个 stage，数据像流水线一样逐 stage 流动。

文章里一个很重要的判断是：**PP 在训练里很常见，但在推理里通常只在权重确实单卡放不下时才会采用。**

原因也很直白：

- 推理没有训练那样的前后向重叠收益
- stage 间数据流动会带来点对点通信
- 微批流水会引入额外调度复杂度

所以对推理产品来说，PP 不是应该默认优先解释的第一层概念。

### 2.5 EP：MoE 模型的核心并行方式

EP 是这篇文章和 PTO 当前内容最贴近的部分。

它的核心是：

- 不同 experts 放到不同 GPU
- token 先经过 router 选择 experts
- 再把 token 分发到对应 expert
- 最后把结果汇总回来

它的好处是：

- 可以把总参数量做得非常大
- 每张卡只保存部分 expert 参数

它的代价是：

- 路由和分发逻辑更复杂
- 负载容易不均衡
- 需要额外处理 expert balance

## 3. 这篇文章和 PTO 的直接关联

先说结论：**和 PTO 直接相关的不是全部五种策略，而是 `EP` 和 `TP`。**

### 3.1 EP：和当前 MVP / Source Graph 最直接相关

PTO 现在已经在模型结构和 source graph 里表达了 MoE 主链路：

- `Router`
- `TopK`
- `Dispatch`
- `Routed Expert`
- `Shared Expert`
- `Combine`

可以直接对照：

- [`../model-architecture/app.js`](../model-architecture/app.js)
- [`../tools/convert_interpretability_to_viewer.py`](../tools/convert_interpretability_to_viewer.py)
- [`../deepseek_model_hierarchy_demo.html`](../deepseek_model_hierarchy_demo.html)

这说明 PTO 现在已经能解释：

```text
MoE 在算子和数据流层面是怎么工作的
```

但它还不能解释：

```text
这些 expert 具体被放到了哪些 GPU
哪些 token 被发到了哪一组设备
通信代价和负载均衡实际长什么样
```

也就是说，PTO 当前覆盖的是 `EP` 的**计算语义层**，还没有覆盖它的**设备部署层**。

### 3.2 TP：代码里已有语义，前端还没显式画出来

PTO 自带的 DeepSeek V3.2 推理副本里，已经有相当明确的 TP 痕迹：

- `ParallelEmbedding`
- `ColumnParallelLinear`
- `RowParallelLinear`
- `world_size / rank`
- `all_reduce / all_gather`

对应文件：

- [`../deepseekv3.2源码/inference_副本/model.py`](../deepseekv3.2源码/inference_副本/model.py)
- [`../deepseekv3.2源码/inference_副本/generate.py`](../deepseekv3.2源码/inference_副本/generate.py)

这说明项目内部已经有这样的事实：

```text
模型代码并不是纯单卡视角，它已经包含 model-parallel / tensor-parallel 语义。
```

但前端当前展示的仍然是：

- attention / moe 的结构
- 编译后 pass 图
- source-level 数据流

它没有把下面这些东西显式可视化：

- 张量到底沿哪个轴被分片
- 某个线性层切到几张卡
- `all_reduce / all_gather` 发生在什么位置
- 通信和计算的依赖关系

所以，TP 对 PTO 来说属于：

```text
代码层已经存在，产品层尚未显式表达
```

## 4. 哪些策略和 PTO 只有弱关联

### 4.1 DP：目前更像背景知识

PTO 当前不是服务编排工具，也不是推理副本调度工具。

它更关心：

- 一张图里的 tensor 怎么流
- 一个 kernel 怎样从源码变成 IR
- 一个 block 内部的 attention / MoE 是怎样组成的

而 DP 更偏：

- 模型副本复制
- 请求调度
- 服务吞吐扩展

因此，DP 对当前 PTO 的价值主要是帮助建立完整词汇表，而不是直接映射到已有页面能力。

### 4.2 SP / CP：目前几乎没有正面覆盖

当前项目当然已经包含长序列、KV cache、prefill / decode 等语义，但这不等于已经支持了 `SP/CP` 的并行表达。

PTO 现在能解释的是：

- 长序列相关算子路径
- cache 写回或读取的计算过程
- 一部分 dynamic shape / KV cache 语义

它还不能解释的是：

- 序列维如何跨设备切开
- 切开的序列怎样重组
- attention 中跨设备序列通信怎样发生

所以 `SP/CP` 对当前 PTO 更像未来扩展方向，而不是现有功能映射。

### 4.3 PP：当前项目里的 “pipeline” 大多不是文章里的 Pipeline Parallel

这是一个很容易误判的点。

PTO 当前代码里大量出现 `pipeline` 这个词，但大部分时候它指的是：

- 语义泳道
- 阶段分组
- attention / ffn / moe / prolog 这类逻辑阶段

而不是文章里定义的：

```text
把模型层切到多个设备，按 stage 顺序流动的 Pipeline Parallel
```

对应代码例如：

- [`../js/app.js`](../js/app.js)
- [`../js/colormap.js`](../js/colormap.js)

也就是说，PTO 当前的“pipeline 颜色 / lane”更接近**语义分层**，不是**多卡流水线并行**。

这个命名如果后续不区分清楚，会非常容易让人把“语义泳道”误解成“PP 拓扑”。

## 5. 这篇文章对 PTO 的真正启发

这篇文章最重要的作用，不是告诉 PTO “马上去支持五种并行策略”，而是帮助我们把产品边界说清楚：

### 5.1 PTO 当前擅长解释的是“计算语义”，不是“设备拓扑”

PTO 现在已经比较擅长回答：

- attention / MoE / KV cache 计算路径是什么
- source graph 和 pass IR 分别长什么样
- 某个模块内部有哪些融合块和数据依赖

但它还不擅长回答：

- 这个层切到了哪些卡
- 哪些张量在哪些设备上有 shard
- 哪种集合通信发生在哪个阶段
- TP / EP / PP 叠加时，通信路径和时序关系是什么

换句话说，当前 PTO 更像：

```text
模型与编译链路可视化工具
```

而不是：

```text
分布式推理并行拓扑分析工具
```

### 5.2 如果后续要扩展“并行视图”，优先顺序应该是 EP / TP，而不是 DP / PP

原因很简单：

- `EP` 已经在现有 MVP / source graph 里有明显骨架
- `TP` 已经在推理代码里有明确实现入口
- `DP` 更偏系统副本层，不是当前 PTO 的主战场
- `PP` 对推理不是优先策略，且 PTO 现在容易和“语义 pipeline”混名

如果将来真的做一层并行视图，我认为最小闭环应该是：

1. 先给现有 attention / MoE 节点补“分片维度”和“设备组”信息
2. 再把 `all_reduce / all_gather / dispatch` 显示成显式通信边
3. 最后再考虑更系统级的 `PP / DP` 视角

## 6. 我对这篇文章的判断

这篇文章适合被当作：

- 推理并行基础词汇表
- 给 PTO 团队统一概念边界的短文
- 后续做“并行视图”时的一级分类参考

但它不适合直接当作：

- 某个框架的部署操作手册
- 某个策略的性能调优指南
- 某种并行配置的定量设计依据

它的层级更像：

```text
把问题分对类
```

而不是：

```text
把系统配到最优
```

## 7. 对 PTO 的落地建议

如果只保留一句 actionable 结论，我会写成：

```text
把这篇文章当成 PTO 的“并行策略词汇底座”，并明确：当前产品已覆盖 EP/TP 的一部分计算语义，但尚未覆盖 DP/TP/PP/SP/EP 的设备拓扑与通信可视化。
```

基于这个判断，后续最值得做的不是重画一张“并行策略总览图”，而是新增一层更贴近现有产品的视角：

- 对 `MoE` 节点增加 expert placement / dispatch 含义
- 对 `Linear / Attention` 节点增加 tensor shard 语义
- 对通信操作增加显式边和设备组说明
- 把“语义 pipeline”与“Pipeline Parallel”在命名上彻底拆开

这会比单纯重复文章内容，更能直接服务 PTO 的产品演进。

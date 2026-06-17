# 并行分配知识说明

这份文档的目的，是把训练并行里最容易混淆的几件事讲清楚：

- 什么叫“卡”
- 什么叫 `rank`
- 什么叫“这张卡承载哪些层/算子”
- 什么情况下这个说法准确，什么情况下不准确
- 为什么 `ParallelDemo` 里的“并行分配逻辑”是对的，但不能直接把它的示意图当成真实大规模训练拓扑

这份文档尽量不用抽象术语堆砌，而是用“快递仓库”“流水线工厂”“多人抄写一本书”这类类比来解释。

---

## 1. 先把几个基本名词分开

### 1.1 卡、device、rank、worker 不是一回事

很多讨论里，大家会把这些词混着说，但它们其实不是同一个层级。

#### 卡 / device

- 指物理硬件，比如 1 张 Ascend 910B、1 张 H100。
- 它是“机器上的一块板子/一个计算设备”。

类比：

- 一张卡，像工厂里的一台机器。

#### rank

- 指分布式训练里的一个进程身份，或者说一个通信成员编号。
- 很多 demo 里常见“1 个 rank 绑定 1 张卡”，所以大家容易把 rank 直接等同于卡。
- 但严格说，`rank` 是软件/运行时语义，`card` 是硬件语义。

类比：

- `rank` 像工厂里的一个工位编号。
- 工位通常坐在某台机器前面工作，所以“工位”和“机器”经常配对，但不是同一个概念。

#### worker

- 常是更宽泛的说法，可以指一个训练进程，也可以指一个参与计算的执行单元。
- 在不同框架里，`worker` 的精确含义可能略有不同。

#### 为什么产品里最好写 rank 和 card 两层

因为产品里一旦要表达：

- 物理位置：host / slot / device_id
- 运行时位置：global rank / local rank
- 并行坐标：TP / PP / DP / CP / EP

你就不能只写“这张卡是什么”，也不能只写“这个 rank 是什么”。

更准确的表达应该是：

`rank_237 运行在 host_03 的 device_5 上，属于 PP5 / TP2 / DP7 / EP19`

---

## 2. 最大的误区：是不是“卡按层和算子分配”？

答案是：

- **有些并行方式下，这么说基本对**
- **有些并行方式下，这么说只对一半**
- **有些并行方式下，这么说基本不对**

最关键的一句是：

> 真实训练里，并不是所有并行都在回答“这张卡负责哪几层”。
> 更常见的是：不同并行维度分别决定“这张卡持有哪些层段、哪些参数分片、哪些专家、哪些序列分片、以及它属于哪些通信组”。

也就是说：

- `PP` 更像“按层段切”
- `TP` 更像“同一层内部按矩阵/算子切”
- `DP` 更像“整模型复制多份，各吃不同数据”
- `FSDP` 更像“参数/梯度/优化器状态切片保存”
- `SP/CP` 更像“序列切片”
- `EP` 更像“专家切片”

下面一类一类讲。

---

## 3. DP：数据并行 Data Parallel

### 3.1 它到底做什么

数据并行的核心不是切模型，而是：

- **每个 rank 都有同一份模型**
- **每个 rank 吃不同的数据 batch shard**
- **算完梯度后，把梯度同步**

官方依据：

- PyTorch DDP 文档明确说：`DistributedDataParallel` 通过在每个模型副本之间同步梯度来提供 data parallelism。
- 同时文档也明确说：DDP **不会**自动把输入切到各 GPU，用户要自己决定怎么切，例如用 `DistributedSampler`。

来源：

- https://docs.pytorch.org/docs/2.12/generated/torch.nn.parallel.DistributedDataParallel.html

### 3.2 类比

想象有 8 个老师一起批改同一本练习册的不同页：

- 每个老师手里都有同样的“答案标准”
- 但每个人批改的学生作业页不同
- 最后大家把“改出来的经验”汇总一下，保证答案标准继续保持一致

这里：

- “答案标准” = 模型副本
- “不同页作业” = 不同数据分片
- “最后汇总经验” = 梯度同步

### 3.3 它不做什么

它**不**意味着：

- GPU0 负责 Embedding
- GPU1 负责 Attention
- GPU2 负责 MLP

这不是 DP 的语义。

### 3.4 所以页面里怎么说才准确

不要写：

- `这张卡承载了第 12-24 层（DP）`

应该写：

- `这个 rank 属于 DP7 副本组，运行完整模型副本，处理本 step 的一部分数据 shard`

---

## 4. FSDP：全分片数据并行 Fully Sharded Data Parallel

### 4.1 它到底做什么

FSDP 还是数据并行体系，但它进一步节省显存：

- 参数是分片存的
- 梯度是分片存的
- 优化器状态也是分片存的

官方文档里 `FULL_SHARD` 的定义非常直接：

- 参数、梯度、优化器状态都被切分
- 前向前 `all-gather` 把需要的参数拼出来
- 前向后再重新分片
- 反向前再拼
- 反向后再分片

来源：

- https://docs.pytorch.org/docs/2.12/fsdp.html

### 4.2 类比

想象一本特别厚的参考书：

- DDP：每个老师都抱着一本完整书
- FSDP：8 个老师每人只带书的 1/8
- 轮到某个章节要用时，大家临时把这章拼起来看
- 用完再拆回去，各自只带自己那一份

### 4.3 它是不是按层分配

**不是它的核心语义。**

它的重点是：

- 参数怎么切
- 什么时候 gather
- 什么时候 scatter

虽然工程实现上常常“按模块粒度 wrap”，看起来像“这一块参数归这个 wrapper 管”，但 FSDP 本质上不是在表达“哪张卡负责哪几层”，而是在表达“参数和状态如何被分片管理”。

### 4.4 页面里怎么说才准确

不要写：

- `卡 12 负责 MLP 层`

可以写：

- `该 rank 持有模型参数/梯度/优化器状态的一部分分片；前后向期间按需 all-gather`

---

## 5. PP：流水线并行 Pipeline Parallel

### 5.1 它到底做什么

这类并行最接近“按层分配”。

官方 PyTorch pipeline 文档写得很明确：

- 要先构造 `PipelineStage`
- 一个 `PipelineStage` 包装“这个 stage 上运行的那一部分模型”
- 官方示例里甚至是直接删掉本 stage 不需要的层，再创建 stage

来源：

- https://docs.pytorch.org/docs/2.12/distributed.pipelining.html

### 5.2 类比

像工厂流水线：

- 第 1 站负责上料和前几道工序
- 第 2 站负责中间加工
- 第 3 站负责最后组装

一件产品从第 1 站流到第 2 站，再到第 3 站。

这里：

- `PP stage 0` 可能负责 embedding + 前几层 block
- `PP stage 1` 负责中间一段 block
- `PP stage 2` 负责最后几层 + LM Head

### 5.3 所以“每张卡承载哪些层”在这里准不准

**在 PP 语义下，这句话基本是准确的。**

更精确一点：

- 不是“每张卡”
- 而是“每个 pipeline stage 上的 rank / device”

它承载的是：

- 一段连续层
- 或一个 stage 的模型子模块

### 5.4 页面里怎么说才准确

可以写：

- `PP5 承载第 36-42 层`
- `该 rank 处于 pipeline stage 5，执行这段层的前后向`

这类说法是靠谱的。

---

## 6. TP：张量并行 Tensor Parallel

### 6.1 它到底做什么

TP 不是把不同层分给不同卡，而是把**同一层内部的线性层/张量**切开。

官方 PyTorch Tensor Parallel 文档说明：

- `ColwiseParallel`：按列切 compatible `nn.Module`
- `RowwiseParallel`：按行切 compatible `nn.Module`
- 二者可以组合起来实现更复杂模块，比如 `MLP`、`Attention`

来源：

- https://docs.pytorch.org/docs/2.12/distributed.tensor.parallel.html

### 6.2 类比

假设一张超大的表格要算矩阵乘法：

- 不是让 A 同学算前 10 页、B 同学算后 10 页
- 而是让 4 个人同时算**同一页上的不同列块/行块**

也就是说：

- 大家都在算“同一层”
- 只是每个人算的是这一层里面不同的权重分片或输出分片

### 6.3 为什么“承载哪些层/算子”只对一半

如果你说：

- `这张卡正在参与 Attention`

这没问题。

但如果你说：

- `这张卡独自承载了 Attention 这一层`

这就不对了，因为 TP 下这层通常是多卡一起完成的。

更准确的表达是：

- `这张卡承载 Attention/MLP 的 TP 分片`
- `它持有该层某个线性算子的列分片或行分片`

### 6.4 页面里怎么说才准确

不要写：

- `卡 7 负责 Attention 层`

应该写：

- `卡 7 / rank_7 持有 Attention QKV 的 TP shard 2/8`
- `卡 7 参与该层张量并行组的同层协同计算`

---

## 7. SP / Sequence Parallel 与 CP / Context Parallel

这两个名字在不同框架/论文里有时会有差异，但对产品表达来说，核心抓住一点就够了：

- 它们主要在表达**序列维度被切开**
- 不是在表达“层归哪张卡”

### 7.1 官方语义里 Sequence Parallel 是什么

PyTorch 文档对 `SequenceParallel` 的定义是：

- 模块参数是 replicated
- 计算在 sequence 维已经切开的输入上进行
- 输出继续沿 sequence 维切分

来源：

- https://docs.pytorch.org/docs/2.12/distributed.tensor.parallel.html

### 7.2 类比

想象一本很长的小说：

- 不是把前半本交给甲老师、后半本交给乙老师去“拥有”
- 而是把同一句子序列切成前半段和后半段，大家各自处理一段 token

更像：

- 同样的处理规则
- 不同的人处理长序列的不同片段

### 7.3 它是不是按层分配

**不是。**

它主要回答的是：

- 序列如何切
- 长上下文如何分摊到多个 rank

### 7.4 页面里怎么说才准确

不要写：

- `CP3 承载第 20 层`

可以写：

- `CP3 负责当前序列窗口的第 4 个 context shard`
- `参数不因 CP 而天然按层切走，重点是 token / sequence 维切分`

---

## 8. EP：专家并行 Expert Parallel

### 8.1 它到底做什么

这是 MoE 最关键的一类。

Megatron Core 官方文档写得很清楚：

- 专家被分配到不同 worker
- 每个 worker 在每个 MoE 层处理一个或多个专家

DeepSpeed 官方文档也写得很直接：

- 一个 `ep_size` 大小的 expert-parallel group 中，参与的 GPUs/ranks 会分配该层的总专家数

来源：

- https://docs.nvidia.com/megatron-core/developer-guide/latest/api-guide/moe.html
- https://www.deepspeed.ai/tutorials/mixture-of-experts/

### 8.2 类比

想象一家医院：

- 有心内科专家、骨科专家、眼科专家
- 病人先经过分诊台（router / gate）
- 分诊台决定把病人送去哪个专家
- 不同医生在不同诊室里接待各自擅长的病人

这里：

- 分诊台 = router / gate
- 医生 = experts
- 不同诊室 = 不同 rank/device 上的专家分布

### 8.3 它是不是按层分配

**不该概括成“按层分配”。**

更准确是：

- 在每个 MoE 层内部，有一组 experts
- 这些 experts 被分散到不同 rank 上

所以它回答的是：

- `这个 rank 上放了哪些 expert`

而不是：

- `这个 rank 负责第几层`

### 8.4 为什么这里很容易和“卡”混淆

因为 demo 常常会画成：

- `expert_group_19 -> rank_19 -> card_19`

这只是为了演示方便。

真实大规模训练里，不应该默认：

- 一个 expert bucket 永远对应一张卡
- 一个 rank 永远只放一个 expert group

真正该表达的是：

- `某个 expert bucket 当前 placement 投影到哪些 rank/device`

### 8.5 页面里怎么说才准确

不要写：

- `卡 19 负责 MoE 层`

可以写：

- `rank_19 持有当前 MoE 层的一部分 experts / expert shards`
- `Gate 会把 token 路由到对应 expert 所在的 rank`

---

## 9. 把几种并行放在一起看

真实大模型训练通常不是只开一种并行，而是叠加。

例如一个 rank 可能同时有这些身份：

- 它属于 `PP5`：说明它负责某一段层
- 它属于 `TP2`：说明这一段层里的线性层，它只持有第 2 个张量分片
- 它属于 `DP7`：说明它所在的是第 7 个数据并行副本组
- 它属于 `CP1`：说明它处理长序列中的某个上下文分片
- 它属于 `EP19`：说明它上面放着某些 MoE experts

所以真实描述应该是“多维坐标”，不是单一归类。

类比：

一个工人可能同时具备这些标签：

- 在第 5 条流水线工位上班（PP）
- 只负责组装零件的第 2 个子部件（TP）
- 今天处理第 7 批订单样本（DP）
- 订单说明书只看第 1 段（CP）
- 遇到心脏病类病例时归他处理（EP）

这比“他负责某一层”要丰富得多，也更接近真实训练。

---

## 10. 为什么 `ParallelDemo` 的逻辑对，但示意图不能直接当真实盘古拓扑

### 10.1 它对在哪里

`ParallelDemo` 对的地方，是它把并行分配逻辑算对了：

- `rankOf(d,p,c,t)` 这类 rank 坐标推导
- `tp / pp / dp / cp` 分组关系
- `distributeLayers()` 的 pipeline 层分配

也就是说，它对的是“placement 计算逻辑”。

### 10.2 它不能直接复用在哪里

它的图还是 demo 视图：

- 只画少量卡
- 用可读性优先的示意块
- 没打算直接承载 1k/4k 卡规模的真实训练集群

所以不能把它的“几张卡示意图”直接当成 `TrainScope` 的真实物理轴。

### 10.3 正确做法

应该复用：

- `ParallelDemo` 的 placement engine

不应该直接复用：

- `ParallelDemo` 的卡片示意排版

也就是：

- **逻辑复用**
- **视图重做**

---

## 11. 对 `TrainScope` 的产品表达建议

### 11.1 不推荐的表达

- `每张卡承载哪些层/算子`

这个说法会让人误以为所有并行都像 PP 一样按层切。

### 11.2 推荐的总标题

- `每个 rank/device 的并行放置`
- `Runtime Placement`
- `Rank / Device Placement`

### 11.3 推荐的字段

- `device`: host / slot / device_id
- `rank`: global_rank / local_rank
- `PP`: 负责的层段范围
- `TP`: 持有的算子/权重分片
- `CP/SP`: 负责的序列分片
- `DP`: 所属副本组
- `EP`: 持有的 expert / expert shard

### 11.4 推荐的一句话说明

可以写成：

> 该视图不是简单回答“这张卡是哪几层”，而是展示每个 rank/device 在 PP、TP、DP、CP、EP 多个并行维度上的运行时放置关系。

---

## 12. 给页面文案直接可用的几种模板

### 12.1 适合 PP 的文案

- `PP5 · layers 36-42`
- `该 stage 执行第 36-42 层的前后向`

### 12.2 适合 TP 的文案

- `TP2 · Attention QKV shard 2/8`
- `该 rank 持有该层线性算子的张量分片`

### 12.3 适合 DP 的文案

- `DP7 replica`
- `完整模型副本之一，处理当前 step 的数据 shard`

### 12.4 适合 CP/SP 的文案

- `CP1 · sequence shard 1/4`
- `负责当前上下文窗口的一段 token`

### 12.5 适合 EP 的文案

- `EP19 · experts 152-159`
- `该 rank 持有当前 MoE 层的一部分 experts`

---

## 13. 最终结论

### 13.1 如果只问一句：“每张卡承载哪些层/算子”这个说法准吗？

回答是：

- **对 PP 来说，基本准确**
- **对 TP 来说，只说对了一半**
- **对 DP/FSDP/CP 来说，基本不准确**
- **对 EP 来说，应该改成“承载哪些专家/专家分片”**

### 13.2 更准确的一句话

> 真实大模型训练里，不是简单地“卡按层和算子分配”；更准确的是：每个 rank/device 在 PP、TP、DP、CP、EP 等不同并行维度上，同时拥有层段、参数分片、专家分片、序列分片和通信组身份。

---

## 14. 官方依据

以下链接是这份说明直接参考的官方文档：

- PyTorch DistributedDataParallel  
  https://docs.pytorch.org/docs/2.12/generated/torch.nn.parallel.DistributedDataParallel.html

- PyTorch FullyShardedDataParallel  
  https://docs.pytorch.org/docs/2.12/fsdp.html

- PyTorch Tensor Parallelism  
  https://docs.pytorch.org/docs/2.12/distributed.tensor.parallel.html

- PyTorch Pipeline Parallelism  
  https://docs.pytorch.org/docs/2.12/distributed.pipelining.html

- Megatron Core MoE  
  https://docs.nvidia.com/megatron-core/developer-guide/latest/api-guide/moe.html

- DeepSpeed MoE Tutorial  
  https://www.deepspeed.ai/tutorials/mixture-of-experts/

# PTO 产品方向：数据流视角研究笔记

**核心问题：为什么三个可视化模块迟迟无法"打通"？**

---

## 一、问题的起点：开发者在"开发"什么

PTO 现在有三个模块：
- 模型架构可视化（`mvp/`）—— 展示 L1→L4 的模型层级结构
- 源码算子可视化（`visual-test.html`）—— 展示 PyPTO 源码的计算路径
- IR 计算图（`index.html`）—— 展示编译后的 pass 图和 controlflow

三个模块分别描述了"代码产物"的三个截面。但它们打通不了的根本原因，不是 UI 层的问题，而是**分模块的方式本身就错了**——它在切"代码"，而不是切"数据"。

真正的问题是：**开发者在"开发"什么？**

不是在开发代码。是在开发**数据的变换规则**。他写的每一行，本质上是在说：这个 tensor，经过这个 op，变成那个 tensor。他设计的是一条从输入到输出的数据流。

---

## 二、真正的 Gap：数据流是不可追溯的

"今天天气如何"这句话进来，被 tokenize，变成 embedding tensor，经过 60 层 decoder，每层做 attention 和 MLP，最后输出下一个 token 的概率。

**这条路径，没有任何工具可以让你跟着走一遍。**

开发者真正的问题永远是：这个 tensor 从哪来？经历了什么？变成了什么？值对不对？

而现在的三个模块分别给出的是：
- 架构图：模型的拓扑结构（我设计了什么）
- 源码视图：算子的实现逻辑（我怎么写的）
- IR 图：某一个 kernel 某一个档位的编译输出（编译器产生了什么）

三个问题，三个工具。但开发者的问题是第四个：**这个数据到底经历了什么**。这个问题没有工具可以回答。

---

## 三、重新理解三个模块

三个模块不应该是三个独立工具，而是同一条数据流上的**三个观察粒度**：

```
输入 tensor
  │
  ├─ 粒度一（模型层）：这条数据在哪个 decoder layer 的哪个组件里
  │
  ├─ 粒度二（源码层）：这个组件用什么 loop 结构处理了这条数据
  │
  ├─ 粒度三（编译层）：这个 loop 最终被编译成哪条 path，执行了什么 tile
  │
  └─ 输出 tensor
```

用户不应该在三个页面之间跳，而是**跟着数据走**——想放大就放大，想看硬件执行细节就往下钻。

这才是"打通"的正确姿势：不是三个工具加链接，而是**数据流作为第一组织原则，三个粒度作为同一旅程的三个镜头**。

---

## 四、外部论证

这个判断有多个独立领域的收敛证据。

### 4.1 Google 的工程实验：从架构图到 tensor 调试器

TensorFlow 早期有 Netron 风格的架构图查看器，但 Google Brain 发现它对调试毫无帮助，用户看不懂问题出在哪。

于是他们做了 `tfdbg`（TensorFlow Debugger），然后是 TensorBoard Debugger V2。设计原则原文：

> *"Standard Python debuggers treat Session.run() as a single black box and do not expose the running graph's internal structure and state."*

Debugger V2 的核心功能：自动追踪 NaN/Infinity 在 tensor 间的传播，找到"第一个出现异常值的 tensor"。这是纯粹的数据流取证工具——代码视图在这里是盲的。

### 4.2 Weiser 1982：程序切片是天然的调试心智模型

40 年前的经典实验证明：开发者调试时，大脑自动在做"数据流切片"——我关心的这个值，是被哪些数据变换影响的。这是人类调试时的天然心智模型，不是代码结构，是数据依赖。

### 4.3 Google DeepMind Penzai（2024）

Penzai 是 DeepMind 2024 年发布的 JAX 可视化分析库，是目前最明确的"数据流优先"设计声明。

**核心哲学：模型不是一段要阅读的代码，而是一个数据结构，信息在其中流动，你通过跟随这个流动来调试它。**

**Treescope 渲染器**

Penzai 的输出是在 Jupyter/Colab 里渲染的可交互 HTML 树——不是静态图片，不是架构示意图。它把模型本身渲染成可以展开折叠的嵌套数据结构，每一层都可以点 `▶ / ▼` 展开。

每个 NDArray 直接在树里内嵌渲染成小图：
- 高维数组自动分解成 2D facet 网格（外层 axis 形成行列，内层 axis 形成像素）
- 默认 colormap：蓝色 = 正值，红色 = 负值，以 ±3 标准差为界
- 异常值直接在图上标注：`I`（白底蓝字）= +Inf，`-I`（白底红字）= -Inf，`X`（品红底黑字）= NaN

这意味着：你打开一个已训练好的模型，不需要跑任何脚本，直接在树里就能看到每一层权重的值域分布、是否有异常——数据状态变成了视觉可读的。

**`pz.select`：手术刀式的数据流拦截**

`pz.select` 是 Penzai 最核心的 API，让你在任意位置拦截和修改数据流：

```python
# 找到所有 Elementwise 激活层，在每个后面插入一个"spy"层
var = pz.StateVariable(value=[], label="intermediates")
saving_model = (
    pz.select(mlp)
    .at_instances_of(pz.nn.Elementwise)
    .insert_after(AppendIntermediate(var))
)
# 运行后，var.value 包含所有激活层的中间 tensor
```

这不是修改源码，不是子类化，不是 monkey-patching。这是在数据流里**非破坏性地打断点**——原始模型不变，`saving_model` 是一个新的 pytree，在运行时把任意位置的激活值引出来。

`pz.select` 支持的选择器：
- `.at_instances_of(LayerType)` —— 按类型找所有节点
- `.at_subtrees_where(predicate)` —— 按条件找（比如 `size > 1000`）
- `.at_keypaths([path1, path2])` —— 按路径直接访问
- `.where(fn)` / `.invert()` —— 过滤和取反

找到目标后，可以：
- `.insert_before() / .insert_after()` —— 插入新层（激活拦截）
- `.apply(fn)` —— 替换该位置的计算（激活 patch，做消融实验）
- `.remove_from_parent()` —— 删除某层

**Penzai 解决的核心问题**

| | PyTorch / Flax | Penzai |
|---|---|---|
| 参数可见性 | 隐藏在 `.parameters()` 或函数返回值里 | 作为 `Variable` 节点显式出现在树里 |
| 激活拦截 | 需要 hook 或改写 forward | `pz.select().insert_after()` 非破坏性插入 |
| 模型手术 | 子类化或 monkey-patch | `pz.select().apply()` 替换任意子树 |
| 中间值可视化 | 需要额外脚本导出 | Treescope 直接在树里内嵌 array 图 |

Penzai 把"post-training analysis and model surgery"作为第一设计目标——而不是训练效率。这正好对应了开发者真正花大量时间做的事：调试、归因、验证模型是否在做正确的事。

### 4.4 Huawei MindInsight（Ascend NPU）

MindInsight 是距离 PTO 目标场景最接近的参照——同样是 Ascend NPU，同样面向模型开发者。

**Tensor Debugger：两种模式**

- **Online 模式**：连接到正在运行的训练进程，Web UI 显示**优化后的计算图**（不是 Python 源码视图）。训练控制按钮：OK（执行 N 步）、CONTINUE（运行到 watchpoint 触发）、PAUSE、TERMINATE。GPU 环境下还有 "Current Node" / "Next Node"，逐节点步进。

- **Offline 模式**：分析预先 dump 的 `.npy` 文件。界面上方有"图执行历史"时间轴，可以跳到任意 step 重看 tensor 值。

**Watchpoint：数据流上的条件断点**

用户给特定 tensor 设规则，比如：溢出检测、零值检测、超过阈值。当规则触发，UI 高亮命中节点，显示实际值 vs 阈值。这是在**数据流层**设断点，不是在代码行设断点——代码行触不到 GPU/NPU 上的中间 tensor 值。

**Timeline：双层对照视图**

Timeline 是性能分析的核心，有两个部分在同一时间轴上对齐：

- **Summary 层（Step Trace）**：按子图和迭代展示 forward 计算时间、backward 计算时间、iteration trailing 时间（空转）
- **Detail 层（Hardware Tracks）**：按 Stream 展示设备侧算子的实际执行序列，每行是一个硬件 stream；加上 HCCL 轨（集合通信算子执行，按 communication plane 组织）

这让你可以把"这次 backward pass"（模型层理解）和"这个 AllReduce 在硬件上占了多久"（硬件层理解）对应起来——**同一时间轴上的两个粒度**，而不是两个分开的工具。

**Tensor 内存生命周期**

Memory 分析视图里有一张折线图，X 轴是**算子执行顺序**（不是墙上时钟），Y 轴是当前占用内存。悬浮到任何点，可以看到那一刻所有存活 tensor 的列表：名称、大小、类型、dtype、shape、format，以及**该 tensor 的内存分配和释放区间**。

这是真正的"tensor 生命周期可视化"：你可以看到哪些 tensor 同时活着，找到内存压力点，判断哪里可以做 recomputation。

**MindInsight 的核心限制，也是 PTO 的机会**

MindInsight 调试器展示的是**优化后的执行图**，不是 Python 模型定义。框架编译 Graph Mode 时会做 op 融合、消除、重排——开发者写的 `nn.Module` 和实际执行的图之间有一道墙。MindInsight 提供了 node-to-code 映射来弥补这道墙，但这是事后补丁，不是天然透明的。

PTO 面向的是 PyPTO 的 tile-level 计算，问题更底层：连 Python 层和 tile 执行层之间的墙更厚，当前没有任何工具把这两侧对应起来。

---

## 五、对 PTO 的启示

基于以上，三个问题值得重新想：

**1. 第一组织原则应该是什么？**

不是 Pass，不是 Loop，不是模块。是**这条数据（tensor）经历了什么**。用户的起点应该是一个具体的计算（比如第 N 层的 MLA attention），然后能追着它看：这个计算在模型里是什么语义，在源码里是什么 loop，在 tile 层是怎么切的，在编译层产生了哪条 path，在哪条 path 上首块和尾块的逻辑分叉了。

**2. 三个模块还需要吗？**

不是"需不需要三个模块"，而是三个模块应该是**同一条数据流旅程的三个镜头**，而不是三个独立工具。用户的视角应该是缩放（zoom），不是切换（switch）。

**3. 哪些现有工具的方法值得借鉴？**

- Penzai 的**非破坏性 tensor 拦截**：在计算图任意位置插入观察点，不改原始结构
- MindInsight 的**双层 timeline**：同一时间轴上对齐模型粒度理解和硬件粒度执行
- TensorBoard Debugger V2 的**NaN/Inf 传播追踪**：自动找到第一个异常 tensor 的位置

---

## 参考资料

| 资源 | 链接 |
|------|------|
| Penzai GitHub (DeepMind) | https://github.com/google-deepmind/penzai |
| How to Think in Penzai | https://penzai.readthedocs.io/en/stable/notebooks/how_to_think_in_penzai.html |
| Penzai Selectors API | https://penzai.readthedocs.io/en/stable/notebooks/selectors.html |
| Treescope Array Visualization | https://treescope.readthedocs.io/en/stable/notebooks/array_visualization.html |
| MindInsight Debugger (Online) | https://mindspore.cn/mindinsight/docs/en/r2.3/debugger_online.html |
| MindInsight Profiling (Ascend) | https://mindspore.cn/mindinsight/docs/en/r2.3/performance_profiling_ascend.html |
| Visualizing Dataflow Graphs in TensorFlow (VAST 2018) | https://idl.cs.washington.edu/files/2018-TensorFlowGraph-VAST.pdf |
| Visual Analytics in Deep Learning Survey (Hohman, IEEE TVCG 2018) | https://pmc.ncbi.nlm.nih.gov/articles/PMC6703958/ |
| Programmers use slices when debugging (Weiser 1982) | https://dl.acm.org/doi/10.1145/358557.358577 |
| UMLAUT: Debugging Deep Learning Programs (CHI 2021) | https://dl.acm.org/doi/10.1145/3411764.3445538 |

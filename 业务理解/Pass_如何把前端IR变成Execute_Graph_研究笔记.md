# Pass 如何把前端 IR 变成 Execute Graph

这篇笔记只回答一个问题：

**前端 parse 出来的高层 IR，经过哪些 pass，怎样一步步变成 Execute Graph。**

---

## 1. 最短答案

PyPTO 的编译过程不是"把一张图优化一下"，而是把同一份计算连续翻译成四种越来越接近硬件执行的图：

```
前端 IR / Tensor Graph
  → Tile Graph
    → Block Graph
      → Execute Graph
```

每一层图回答的问题不同：

- **Tensor Graph** 回答"开发者想算什么"
- **Tile Graph** 回答"这些数据要按多大的 tile 切开来算"
- **Block Graph** 回答"哪些 tile 组合成一个可以在单个 AI Core 上运行的子图"
- **Execute Graph** 回答"这些子图之间怎样调用、怎样依赖、怎样被调度"

`pass` 的核心价值不是单纯删节点，而是把图一步步降到"设备可以调度"的层级。

---

## 2. 官方定义：四类图分别是什么意思

> 官方原文：「Tensor Graph、Tile Graph、Block Graph 阶段会经历多个 Pass 的优化，最终通过 Execute Graph 阶段整合图信息」
> ——[debug.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/debug.md)

### 2.1 Tensor Graph

Tensor Graph 由 `Tensor` 和 `Operation` 组成，表达的是用户在 Python 里写下的高层计算逻辑。这一层还没有 tile 展开，也没有内存层级和调度语义。

官方定义：「高层次的 Tensor 操作，贴近算法设计者的数学表达式」
——[introduction.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/introduction/introduction.md)

例如开发者写的是：

```python
out[:] = pypto.matmul(a, b, a.dtype)
```

Tensor Graph 看到的还是"一个 matmul 操作连接若干输入输出 tensor"，而不是很多小 tile，也不是很多待调度任务。

### 2.2 Tile Graph

Tile Graph 是 Tensor Graph 根据 `TileShape` 展开后的结果。到了这一层，原来的 Tensor 会被拆成 Tile，Operation 会被拆成 TileOp，框架会推导 tile 的存储位置，并在需要时插入搬运节点。

官方定义：「硬件感知的 Tile 操作，充分利用硬件并行性和内存层次结构」
——[introduction.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/introduction/introduction.md)

调试示例中可以直接看到：原本一个大 shape 的 tensor，到了 Tile Graph，会被切成很多小 tile，同时出现 `TILE_COPY_IN`、`TILE_COPY_OUT` 这类搬运语义节点。

### 2.3 Block Graph

Block Graph 是把 Tile Graph 进一步切成多个子图之后的结果。每个子图都要满足一个目标：可以作为一个相对独立的执行块，调度到单个 AI Core 上运行。

官方定义：「子图分区，支持并行执行和资源管理」
——[introduction.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/introduction/introduction.md)

Block Graph 关注的底层硬件问题包括：子图边界怎么切、片上内存怎么分、同步点插在哪里、指令怎么编排。

### 2.4 Execute Graph

Execute Graph 是最终给调度器使用的图。不再重点展示"某个计算内部怎么做"，而是重点描述不同 Block Graph 之间如何调用、彼此有哪些依赖、运行时该怎样组织资源和调度。

官方定义：「执行图，包含依赖关系和调度信息」；「整合了所有优化结果，精确描述各 Block Graph 之间的依赖关系，用于设备调度器的调度执行」
——[introduction.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/introduction/introduction.md) / [debug.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/debug.md)

---

## 3. 起点：前端 parse 完之后，IR 长什么样

前端 parse 完后，最接近用户源码语义的是高层 IR，也就是 Tensor Graph 的起点。这一层通常保留：

- tensor 的 shape、dtype、symbol
- operation 的种类，例如 `matmul`、`view`、`assemble`
- 动态维度的符号表示，比如 `t`
- 语义标签，例如某段代码属于 `Query-Linear` 还是 `Assemble_qNorm`

这一层最像"开发者脑中的计算草图"，但还缺很多东西：没有 tile 切法、没有内存搬运方案、没有子图划分、没有调度描述。前端 IR 是编译链路的起点，不是终点。

---

## 4. Pass 主线：图是怎样一层层降下去的

Pass 的注册和默认策略定义在：
[pass_manager.cpp](https://gitcode.com/cann/pypto/blob/master/framework/src/passes/pass_mgr/pass_manager.cpp)

从中可以看到三件事：

1. Tensor Graph、Tile Graph、Block Graph、Execute Graph 各有自己的 pass 族
2. `GraphPartition`、`SubgraphToFunction`、`CodegenPreproc` 是主链上最关键的三个阶段点
3. `LoopUnroll` 是单独的 `FunctionUnroll` 策略，不应把它误读成整条 lowering 主线本身

### 4.1 Tensor Graph pass：先把高层图整理干净

进入 Tile Graph 之前，Tensor Graph 会先经过一批偏"高层语义整理"的 pass，例如：

- `RemoveRedundantReshape`
- `AutoCast`
- `InferMemoryConflict`
- `RemoveUndrivenView`
- `ExpandFunction`

这些 pass 的重点不是切 tile，而是先把图的高层结构理顺：去掉冗余的 reshape/view，把函数展开成更稳定的图结构，补足后续编译需要的属性。

> **产品理解：** 把"源码表达出来的意图"清洗成"编译器更容易继续处理的高层图"。

### 4.2 Tile Graph pass：把大 tensor 变成 tile，为后续切图做准备

进入 Tile Graph 后，图的焦点从"这个算子是什么"变成"这批数据怎么切、怎么搬、怎么放进硬件内存层级"。

这一阶段里，`GraphPartition` 很关键。它的作用不是最终调度，而是把 Tile Graph 切成后面可组织为执行子图的候选块。

真实产物可以直接看到：`Pass_15_GraphPartition` 目录里，图已经不只是"一个高层 loop 对应的一大团计算"，而是开始按后续可执行单元的边界来组织。

### 4.3 `SubgraphToFunction`：把切好的子图组织成可调用函数体系

这是整条链上最值得重点理解的一个 pass。

`SubgraphToFunction` 不是再做一轮普通优化，而是把已经切好的子图正式变成"可调用的函数结构"。这一步之后，图开始出现 `ROOT` 和 `LEAF` 的组织方式。

在 DeepSeek 真实产物里，`Pass_27_SubgraphToFunction/path0_10` 目录里同时有：
- `..._ROOT.json`
- 一组 `..._LEAF_program_id_XX_*.json`（共 11 个 leaf）

这说明同一条 path，在这里已经被组织成：

```
一个 ROOT
  └── 调用多个 LEAF program
```

这就是后面 Execute Graph 和 Block Graph 之间关系的雏形。

### 4.4 Block Graph pass：优化每个执行子图

子图成型之后，进入更偏硬件执行的优化阶段。Block Graph 相关 pass 包括：

- `OoOSchedule`
- `GlobalMemoryReuse`
- `InsertSync`
- `MixSubgraphSplit`
- `LoopaxesProc`
- `CodegenPreproc`

这一阶段的关注点已经不再是"表达原始算法"，而是"让每个子图在硬件上跑得更顺、更稳、更省资源"。

### 4.5 `CodegenPreproc`：把 ROOT / LEAF 产物定型

官方调试文档给了非常明确的对应关系：

| 文件类型 | 对应图类型 |
|---------|-----------|
| `..._ROOT.json` | Execute Graph |
| `..._LEAF_program_id_*.json` | Block Graph |

来源：[debug.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/debug.md)

DeepSeek 真实产物完全符合这个规则：

- `After_036_CodegenPreproc_..._ROOT.json` → Execute Graph
- `After_036_CodegenPreproc_..._LEAF_program_id_02_*.json` → Block Graph

> **对 PTO 的关键结论：** 用户在 `ROOT.json` 里看到的已经是 Execute Graph；在 `LEAF_program_id_*.json` 里看到的是某个 Block Graph 子图。

---

## 5. 用 DeepSeek 真实链路把这件事看完整

如果只讲抽象定义，很容易让人觉得这些阶段只是文档分类。下面用真实链路串一次：

**源码入口：** DeepSeek Indexer Prolog loop
[lightning_indexer_prolog_quant_impl.py](https://gitcode.com/cann/pypto/blob/master/models/deepseek_v32_exp/lightning_indexer_prolog_quant_impl.py)

**Lowering 轨迹（以 PATH0\_10 为例）：**

```
PATH0_10
  → Pass_15_GraphPartition  仍是一张 path 级图
  → Pass_27_SubgraphToFunction  出现 ROOT + leaf × 11
  → Pass_36_CodegenPreproc  定型为 ROOT + 多个 LEAF_program_id
```

从这个例子可以看到，pass 真正做的不是简单"前后对比"，而是连续完成了三次角色转换：

```
高层计算图
  → tile 级图
    → 可调用子图体系
      → 调度器可理解的执行图
```

---

## 6. 为什么 Execute Graph 才能和运行时、泳道图对上

官方文档明确说，运行时的 `DeviceMachine` 会基于 Execute Graph 做解析、stitch 和调度。
来源：[debug.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/debug.md)

这也是泳道图能反查计算图的原因。官方泳道图文档写得很明确：

- `rootHash` → 跳到 Execute Graph
- `callOpMagic` → 定位 Execute Graph 中的调用节点
- `leafHash` → 跳到 Block Graph

来源：[泳道图跳转到计算图.md](https://gitcode.com/cann/pypto/blob/master/docs/tools/swimlane_graph/泳道图跳转到计算图.md)

PTO 如果要把"计算图"和"泳道图"真正打通，关键不是停在 Tensor Graph，而是要明确支持：

```
swimlane task
  → Execute Graph ROOT
    → call 节点
      → Block Graph LEAF
```

---

## 7. 一句最容易记住的话

**前端 IR 只是"开发者想算什么"的高层表达；pass 的工作，是把它依次变成 tile 级图、可执行子图，以及最终给调度器使用的 Execute Graph。**

---

## 8. 典型编译问题类别

基于 gitcode.com/cann/pypto 官方仓，能明确提取出的 pass/编译链路问题主要有 7 类。

### 8.1 Tensor Graph 构图约束错误

- **典型案例：** `ffn_shared_expert_quant` 里 matmul 输入 A/B 传反，导致 K 轴不相等，Tensor Graph 中 Matmul 节点异常缺失
- **典型报错：** `Matrix K dimemsion mismatch`
- **来源：** [debug_case_ffn.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/debug_case_ffn.md)

### 8.2 ExpandFunction 阶段的 TileShape 维度错误

- **典型案例：** TileShape 维度小于输出 tensor 的 shape 维度
- **典型报错：** `Run pass [ExpandFunction] failed`
- **来源：** [faq.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/faq.md)

### 8.3 图结构非法，导致构图/编译前阶段失败

- **典型案例：** 同一个 tensor 同时被 view 读取、又被 assemble 写回，形成环路，违反 DAG 约束
- **典型现象：** 拓扑排序失败、`ASSERTION FAILED`
- **来源：** [issue.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/issue.md)

### 8.4 shape / valid_shape / dynamic shape 推导错误

- **典型案例：**
  - view 未传 `valid_shape`，导致 valid shape 推导错误，出现精度问题
  - 静态轴多次运行传入不同值，或动态轴未标注，导致 AI CPU/AI Core 异常或精度异常
- **来源：** [faq.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/faq.md) / [issue.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/issue.md)

### 8.5 loop / 内存语义错误

- **典型案例：** 父循环里定义临时 tensor，在一个子循环写、另一个子循环读；多次父循环迭代并行时发生内存覆盖，导致精度错误
- **官方建议：** 在后一个子循环加 `submit_before_loop=True`
- **来源：** [issue.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/issue.md)

### 8.6 tile / codegen / 子图资源类错误

- **典型案例：**
  - `set_xxx_tile_shapes` 最后一维未做 32 字节对齐，直接校验报错
  - 子图过大，编译时报 `stack frame size exceeds limit (32768)`
- **官方建议：** 调 TileShape、做 `split_k`、限制子图规模
- **来源：** [faq.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/faq.md) / [pypto-set_pass_options.md](https://gitcode.com/cann/pypto/blob/master/docs/api/config/pypto-set_pass_options.md)

### 8.7 pass 优化不足导致的性能问题

- **典型案例：** QuantIndexerProlog 中 tile 不一致，pass 没把相关计算切到同一个同构子图，造成冗余搬运、性能差
- **来源：** [performance_case_quantindexerprolog.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/performance_case_quantindexerprolog.md) / [performance.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/performance.md)

### 附：精度调试 pass 校验结果分类

官方精度调试文档定义了四种 pass 校验状态：

| 状态 | 含义 |
|------|------|
| `PASS` | 精度校验通过 |
| `FAIL` | 精度校验失败 |
| `NO_COMPARE` | 无法比较（如无 baseline） |
| *(跳过)* | 某些 pass（如 `SubgraphToFunction`）被 verify 跳过 |

来源：[precision.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/precision.md)

---

## 9. 对 PTO 的直接启发

**第一：明确把 `Tensor / Tile / Block / Execute` 四个阶段当成不同产品对象，而不是都当成"graph"。**
因为这四张图回答的问题根本不同。

**第二：给 `ROOT / LEAF` 明确命名和跳转关系。**
否则用户会看到很多 `program_id` 文件，但不知道它们和 Execute Graph 是什么关系。

**第三：把泳道图里的 `rootHash / callOpMagic / leafHash` 直接接回计算图。**
这一步打通后，PTO 才真正具备"从性能现象回到执行图结构"的能力。

---

## 参考资料

| 文档 | 链接 |
|------|------|
| debug.md（调试主文档） | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/debug.md) |
| introduction.md（架构介绍） | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/introduction/introduction.md) |
| pass_manager.cpp（pass 注册） | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/framework/src/passes/pass_mgr/pass_manager.cpp) |
| loop_unroll.cpp（LoopUnroll 实现） | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/framework/src/passes/tensor_graph_pass/loop_unroll.cpp) |
| 泳道图跳转到计算图 | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/tools/swimlane_graph/泳道图跳转到计算图.md) |
| faq.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/faq.md) |
| precision.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/precision.md) |
| debug_case_ffn.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/debug_case_ffn.md) |
| issue.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/issue.md) |
| performance.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/debug/performance.md) |

本地真实产物（DeepSeek 编译输出，仅本地可用）：

- `output_deepseek/Pass_15_GraphPartition/`
- `output_deepseek/Pass_27_SubgraphToFunction/path0_10/`
- `output_deepseek/Pass_36_CodegenPreproc/`

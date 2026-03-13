# 基于 DeepSeek V3.2 EXP 的 PyPTO 前端六步过程分析 —— Python 代码，是怎样一步步变成初始计算图的？

本文主要基于以下官方材料和真实案例展开：
- PyPTO 官方总览：`README.md`
- PyPTO 前端开发文档：`python/pypto/frontend/developer_doc_zh.md`
- `pypto.frontend.jit` 官方文档：`docs/api/pypto-frontend-jit.md`
- `pypto.frontend.dynamic` 官方文档：`docs/api/pypto-frontend-dynamic.md`
- 精度调试文档中关于 `tensor_graph` 的说明：`docs/tutorials/debug/precision.md`
- 真实案例：`models/deepseek_v32_exp/README.md`
- 真实代码：`models/deepseek_v32_exp/mla_prolog_quant_impl.py`

## 1. 背景

当前工具只覆盖了 PyPTO 编译链路的后半段——Pass DAG。它能展示"编译器优化之后图长什么样"，但无法回答另一个更基础的问题：**一段 Python 代码，是怎样一步步变成初始计算图的？**

这个问题对产品和调试都很重要。根据 PyPTO 官方 README，PyPTO 的核心工作方式是：开发者用接近算法思维的 Python 接口描述张量计算，框架再把这些高层描述逐步翻译成更接近硬件执行的中间表示，最终生成可运行代码。这意味着从 Python 到 Pass DAG 之间，存在一段完整的"前端解析链路"，而目前工具对这段链路是盲区。

## 2. 术语表

| 术语 | 解释 |
|------|------|
| **AST**（抽象语法树）| Python 代码的语法结构图。关心代码是怎么写的（函数定义、for 循环、函数调用），而不关心最终是否会发起一次 `matmul`。 |
| **IR**（中间表示）| 编译器内部真正用于处理和优化的图。比源码更接近执行，比最终机器代码更容易分析。PyPTO 通过多层 IR 逐步向下编译。 |
| **惰性执行**（Lazy Execution）| 不是"偷懒执行"，而是"先不编译，等第一次真正调用时再编译"。`JitCallableWrapper` 会把 parse 和 compile 延迟到第一次 `__call__`。 |
| **kernel** | 被 `@pypto.frontend.jit` 修饰、可被编译并执行的算子入口函数。不是操作系统内核，也不是 CUDA kernel，而是 PyPTO 前端里"一个可以单独观察、单独编译、单独执行的计算单元"。 |
| **动态维度** | 某个 shape 维度在运行时才知道具体数值，用 `pypto.frontend.dynamic()` 定义为 `SymbolicScalar`。典型场景是 batch size、序列长度等在不同请求间会变化的维度。 |
| **X / token_x** | 数学公式里的隐藏状态矩阵 `X`，在代码里写作 `token_x` 或 `x_in`。两者是同一个东西，不是新的算法对象。DeepSeek README 明确写了：MLA Prolog 的输入是 hidden state `X`，`token_x` 是它的代码变量名。 |
| **隐藏状态** | 大模型在当前阶段对一个 token 的内部数值表达——不是汉字或 token id，而是一串浮点数。模型每往后算一层，这串数都会被更新一次。路径：原始文本 → tokenizer → embedding → 若干层网络 → 当前层看到的 hidden state。 |
| **tensor（开发阶段）** | 计算图节点，是声明式描述。有四个属性：`dtype`、`shape`、`format`（内存排布）、`name`。`a + b` 这行代码不会立即执行，而是在图里留下一个加法节点。 |
| **tensor（运行阶段）** | 内存里真实的数值块。第一次调用触发 JIT 编译，走完整链路：Tensor Graph → Tile Graph → Block Graph → Execute Graph → NPU 可执行代码，最终以 MPMD 方式调度到 NPU 各处理器核。框架在 Tile Graph 阶段自动把大 tensor 切成能放进 L1/UB 缓存的小块。数值来源分四类：① 输入激活（如 `token_x`）：前面层的计算输出；② 权重（如 `w_dq`, `w_uk`）：checkpoint 加载；③ 缓存（如 `kv_cache`）：前面时间步写入；④ 辅助配置（如 `cos/sin`, `cache_index`）：按位置规则预生成。 |

## 3. 为什么选 DeepSeek V3.2 EXP 这个案例

`mla_prolog_quant_impl.py` 是验证前端六步最合适的案例，因为它同时具备了前端链路里最关键的四类元素，用玩具样例看不出来的问题在这里都会出现。

**动态维度：**

```python
t = pypto.frontend.dynamic("t")
```

**前端入口：**

```python
@pypto.frontend.jit(...)
def mla_prolog_quant_kernel(...):
    ...
```

**控制流与语义标签：**

```python
for bs_offset, unroll_length in pypto.loop_unroll(...):
    ...
    pypto.set_semantic_label("Assemble_qNorm")
    pypto.assemble(...)
```

**大量可映射为图节点的 PyPTO 原语：**

```python
pypto.matmul(...)
pypto.reshape(...)
pypto.view(...)
pypto.transpose(...)
pypto.scatter_update(...)
```

这个案例足够"真实且复杂"，可以同时验证：源码面板是否有价值、深层父子群组是否必要、动态维度是否值得单独展示、初始 IR 是否应该和后续 Pass 图分开看。

## 4. 六步流程的总览

PyPTO 官方前端开发文档把整个前端过程概括成六个阶段。前四步解决"理解代码"的问题，第五步开始进入"构造计算图"，第六步回答"这张图什么时候、以什么 shape 被真正激活"。

| 阶段 | 官方名称 | 通俗理解 | 产物 |
|------|----------|----------|------|
| 1 | Source 提取 | 把函数源码和行号取出来 | 带行号的源码对象 |
| 2 | Python AST | 把源码解析成标准 Python 语法树 | 语法结构树 |
| 3 | Doc AST | 把语法树整理成前端语义树 | 标准化语义树 |
| 4 | Liveness Analysis | 分析变量最后一次被使用的位置 | 生命周期标注 |
| 5 | Parser / IR 生成 | 把语义树翻译成初始计算图 | 初始 IR / tensor graph |
| 6 | Lazy Execution | 首次调用时绑定动态维度并编译执行 | 首次调用状态图 |

## 5. 六步过程，逐步解释

### 5.1 第一步：Source 提取

**这一步的核心价值不是"读文件"，而是为后续所有阶段建立源码位置锚点。**

官方前端文档把第一步定义为 Source 提取。`diagnostics.py` 中的 `Source` 类调用 Python 的 `inspect.getfile()` 和 `inspect.getsourcelines()`，提取被装饰函数的源码，并修正 AST 节点的行号和列号。

没有这个锚点，后面的 AST 节点和 IR 节点就无法再和具体代码行对应起来。因此这一步更像"代码地图"，而不是"数据流图"：

```python
def mla_prolog_quant_compute(...):
    ...
    for bs_offset, unroll_length in pypto.loop_unroll(...):
        ...
        pypto.set_semantic_label("Assemble_qNorm")
        pypto.assemble(q_norm, [bs_offset, 0], q_norm_out)
```

当用户点到一个节点时，界面应该能高亮这段代码——这正是 Source 阶段保留位置信息的用途。所以 Source 阶段的正确 UI 不是"再造一张运算图"，而是建立"源码和后续所有图节点之间的可追溯关系"。

### 5.2 第二步：Python AST

**AST 只看见语法骨架，还不知道哪些调用带有 PyPTO 语义。**

这一步使用内置的 `ast.parse()` 将源码解析为 Python 标准抽象语法树。它关心的是"代码是怎样组织的"：这里是函数定义，那里是赋值语句，这里是 `for` 循环，那里是函数调用。

拿真实案例来说，下面这段代码在 AST 里会被表示为：

```python
for bs_offset, unroll_length in pypto.loop_unroll(
    0, t, 1, name="MLA_BS_LOOP", idx_name="bs_offset", unroll_list=unroll_list
):
    ...
```

```text
For
  target = (bs_offset, unroll_length)
  iter = Call(pypto.loop_unroll, ...)
  body = [
    x_view = pypto.view(...),
    q_kv = pre_compute_2d(...),
    pypto.assemble(...),
    ...
  ]
```

在这一层，`loop_unroll` 只是"某个调用出现在 `for ... in ...` 的迭代器位置"，`controlflow` 只是语法结构（`for`、`if`、`return`）。真正让这个 `for` 具备 PyPTO 语义的，是后面的 parser，而不是 AST 本身。

这一点对产品设计很关键：

```text
Python AST  → 适合回答"代码结构是什么"
Initial IR  → 适合回答"这个结构被翻译成了什么控制流图"
```

官方 `loop_unroll` 文档还补充了一层：`unroll_list=[1, 2, 4]` 时，框架会为 1 倍、2 倍、4 倍展开分别生成路径。开发者源码只写了一份循环体，编译器后面可能生成多条执行路径——这在 AST 层完全看不出来，在 Initial IR 里才应该被真正看见。

所以 Python AST 阶段的主视图应该是"结构树"，而不是"数据流图"。

### 5.3 第三步：Doc AST

**Doc AST 是"Python 写法"到"前端语义"的分界线。没有这一步，IR 节点就像凭空冒出来。**

官方前端开发文档把第三步称为 Doc AST，由 `parser/doc.py` 和 `parser/doc_core.py` 两个模块实现：

- `parser/doc.py`：Python AST 与 doc AST 之间的双向转换注册系统，提供 `parse()`、`to_doc()`、`from_doc()` 等接口，支持 visitor/transformer 模式。
- `parser/doc_core.py`：定义核心 AST 节点类，包含 `AST`、`NodeVisitor`、`NodeTransformer` 基类，以及完整的语句节点（FunctionDef、Assign、For、If、Return 等）和表达式节点（BinOp、Call、Name、Constant 等）。

它的职责是把 Python AST 节点转换为一个更稳定的抽象层，隔离 Python 版本变化（3.9+ 兼容），并为后续 Parser 提供统一接口。更重要的是，它完成了三件事：① 给节点分配稳定 ID，方便跨阶段映射；② 统一不同 Python 写法带来的差异；③ 把后续生成 IR 所需的语义信息提前挂到节点上。

例如下面这段：

```python
pypto.set_semantic_label("Assemble_qNorm")
pypto.assemble(q_norm, [bs_offset, 0], q_norm_out)
```

在 Python AST 里只是两个普通调用；标准化之后，它变成：一条"为后续算子设置语义标签"的元信息语句，以及一条"把局部结果写回输出张量"的前端语义语句。

### 5.4 第四步：Liveness Analysis

**前端不只在建图，它还在分析图中对象的生命周期——这直接关系到内存占用和调试可解释性。**

官方前端文档定义明确：`LivenessAnalyzer` 遍历 doc AST，找出变量最后一次被使用的位置，从而通过插入删除点实现自动内存管理。它回答的是一个很实际的问题：

```text
某个中间变量从哪里开始存在？
它在哪里被反复使用？
最后一次用完之后，什么时候可以释放？
```

在 `mla_prolog_quant_compute(...)` 中，`q_tmp`、`q_nope_new_trans`、`k_nope_split` 这类中间量往往只在局部片段内被消费，一旦最后一次使用结束，前端就可以把它们标记为"可以删除"。

如果 graph 工具要体现这一步，最好的方式是叠加在已有结构上，而不是单独再开一张图：
- 在语句节点上显示 `defined here`、`last used here`
- 在右侧详情面板中展示变量的 `defs / uses / last_use`
- 在 IR 视图中把超过最后使用点之后的链路变淡

### 5.5 第五步：Parser / Initial IR 生成

**从这一步开始，前端不再只是理解代码写法，而是在真的构造一张可执行、可继续优化的初始计算图。**

官方前端文档把它描述为：`Parser` 类使用访问者模式遍历 doc AST 并生成 PTO IR。精度调试文档里明确提到 `tensor_graph`，把它描述为"前端初始计算图模拟计算后的中间数据"——这说明前端阶段确实存在一层可独立观察的"初始计算图"，它不等于后续某个优化 Pass 的图。

Parser 的工作方式是"解释执行"，不是"字符串替换"：

```text
parser 一边读受限的 Python 代码
一边在当前上下文里执行这些 pypto 调用
这些 pypto 调用就在后台真正把图节点和张量关系建出来
```

用一个极简例子来看：

```python
@pypto.frontend.jit
def toy_kernel(
    x: pypto.Tensor((t, h), pypto.DT_BF16),
    w: pypto.Tensor((h, m), pypto.DT_BF16),
    out: pypto.Tensor((t, m), pypto.DT_BF16),
) -> None:
    y = pypto.matmul(x, w, x.dtype)
    pypto.assemble(y, [0, 0], out)
    return
```

Parser 处理这段代码的过程：

**第一，读取函数签名。** `get_signature()` 从类型注解里拿到输入输出张量定义——shape、dtype、是否动态。

**第二，创建函数壳。** `_visit_function_def()` 进入 `with pypto.function(...)` 上下文，开始创建真正的 PTO function。值得注意的一个细节：即使代码里没有显式写循环，parser 内部也会把函数体包进一个单次循环体。

**第三，逐句访问函数体。** 以 `y = pypto.matmul(x, w, x.dtype)` 为例：
1. 访问右侧表达式 `pypto.matmul(...)`
2. 在当前上下文里查出 `x`、`w`
3. 真正调用 `pypto.matmul(...)`，返回新 tensor 并在 PTO function 里留下 `MatMul` 节点
4. 把返回的 tensor 绑定到变量名 `y`

用户看到的是"一行 Python 赋值"，图里变成：

```text
x ----\
       MatMul ----> y
w ----/
```

`pypto.assemble(y, [0, 0], out)` 则被解释为"把局部结果 `y` 写回输出张量 `out` 的某个偏移位置"，出现一个带写回语义的 `Assemble` 节点。这也是为什么 `assemble` 在循环场景下很关键——它经常就是"把本轮 tile 的结果写回整体输出"的那一步。

整体对应关系如下：

```text
Python 变量                                          → Initial IR 的 tensor 边
pypto.matmul / reshape / view / transpose / assemble → operation 节点
for / if                                             → controlflow 结构
```

在 DeepSeek 案例里，`pypto.set_semantic_label("Assemble_qNorm")` 这类调用不一定要变成独立算子节点，但应该作为 metadata 挂到后续真正的运算节点上，否则图里会失去对源码意图的解释能力。

这一层才是真正适合复用当前布局能力的阶段，因为它已经具备计算节点、张量边、控制流 group、深层父子群组等图工具真正需要的元素。

### 5.6 第六步：Lazy Execution

**第一次调用前后，kernel 经历了一次本质性的状态变化——从"符号描述"变成"绑定了真实 shape 的可执行计算图"。**

官方文档和 `entry.py` 都说明了核心机制：`JitCallableWrapper` 不会在函数定义时立即完成所有编译，而是在第一次真实调用时再创建 `Parser`、执行 `parse()`、绑定动态维度、调用 `execute()`，进入编译/运行流程。从用户体验上看，这只是"定义了一个函数，然后像普通函数一样调用"，但内部发生的事情远不止这些。

**动态维度绑定**

以 `t = pypto.frontend.dynamic("t")` 为例，调用前 `t` 只是一个 `SymbolicScalar`——前端知道有这么一个维度，但不知道它等于 128 还是 1024。形如 `token_x_shape = (t, h)` 的 shape，在首次调用前本质上是"带符号的 shape 模板"。

调用时，PyPTO 从真实输入 tensor 的 shape 里反推：如果 `token_x` 实际 shape 是 `[128, 7168]`，前端就把 `t` 绑定到 128，后面所有用了 `t` 的地方据此推导出具体 shape。

**缓存机制**

"命中缓存还是重新编译"本质上是在问：这次调用能不能复用之前为相同源码和相同输入规格准备好的编译结果？缓存分两层：

- **Python 侧 `KernelModule` 缓存**：`JitCallableWrapper` 根据源码、配置项、闭包变量、非 tensor 参数生成 cache key，相同则复用。
- **`KernelBinary` 缓存**：C++ binding 根据本次输入 tensor 规格查找已编译好的内核二进制，有则直接复用，无则重新编译。

**NPU vs SIM**

这两个词不是硬件层面的概念（不是 AI Core / AI CPU），而是运行模式：

```text
NPU → 在真实昇腾硬件上执行
SIM → 在模拟器/代价模型路径上执行，主要用于开发、验证和调试
```

因此第六步更适合做"状态面板"，而不是再复制一张 DAG。它最应该回答的问题是：首次调用前哪些维度还是符号？动态维度是如何绑定的？这次调用命中缓存还是触发了重新编译？

## 6. 为什么这个功能对开发者真的有用

**这不是"锦上添花"的视图，而是定位"错在哪个阶段"的直接工具。**

很多问题并不是到 Pass 图才暴露，而是在更早阶段就已经埋下。将 Source、Python AST 和 Initial IR 对齐，可以服务于三类具体任务：

**正确性定位**

前端问题常见于：
- `assemble` 的 offset 写错，导致 tile 写回位置不对
- `view / reshape` 的 shape 推导错误，后面算子都在"合法但错误"的形状上运行
- `set_semantic_label` 挂到了错误的算子上

如果只能看 Pass 图，很容易误以为是某个后端优化 Pass 改坏了图；对齐 Initial IR 之后，往往更早发现"问题其实在源码写法或前端建图阶段"。

**性能分析**

在 DeepSeek 这类案例里，开发者真正关心的不只是"有没有 `MatMul`"，还关心：
- 这个 `matmul` 外面有没有多余的 `reshape / transpose`
- 它是否被放在过小的 loop body 里，导致调度开销偏大
- `loop_unroll` 的写法是否引入了过多执行路径
- `if / cond` 和 `unroll` 叠加后，编译路径数是否激增

这些问题只看最终 Pass 图时已经离源码太远；在 `Python AST + Initial IR` 的组合视图里，更容易看清"性能问题是从哪种代码结构长出来的"。

**区分前端问题还是后端问题**

如果 Initial IR 就已经和预期不一致，继续盯 Pass 图意义不大——后面的优化都是在一张一开始就不对的图上做的。反过来，如果 Initial IR 是对的，而某个 Pass 之后开始不对，问题范围就被大大缩小了。

## 7. 结论

这六步的意义不在于把编译器内部名词搬进浏览器，而在于建立一条真正可解释的链路：

```text
源码写了什么
→ 前端怎样理解它
→ 前端怎样分析变量生命周期
→ 前端怎样生成初始计算图
→ 第一次真实调用时这张图怎样被激活
```

只有把这条链路建立起来，graph 工具才不仅仅是"图画出来了"，而是真正具备了帮助开发者回答下面这类问题的能力：

```text
我这段算子代码为什么会编成这样？
慢，到底是慢在循环结构，还是慢在后端？
错，到底是源码写错了，还是某个 Pass 改坏了？
动态 shape 频繁触发重新编译，是不是 kernel 写法导致的？
```

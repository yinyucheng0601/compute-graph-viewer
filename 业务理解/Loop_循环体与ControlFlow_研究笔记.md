# Loop、循环体与 ControlFlow 研究笔记

**模型在架构层面的 loop、算子源码里的 loop、tile 带来的逐块遍历，以及编译后的 controlflow，分别是什么关系？**

---

## 1. "循环"的四层含义

在 DeepSeek 和 PyPTO 里，"循环"至少有四层：

```
模型层 loop
  源码层 loop
    tile 遍历 loop
      编译后的 controlflow
```

它们分别回答的是四个完全不同的问题：

| 层级 | 它在回答什么 |
|------|------------|
| 模型层 loop | 为什么同类 kernel 会反复被调用 |
| 源码层 loop | 一个 kernel 怎样分批处理 token、head 或 cache block |
| tile 遍历 loop | 同一批数据在核内怎样被切成小块逐块算完 |
| 编译后的 controlflow | 这些循环最终怎样变成 path、分支和可调度的控制骨架 |

---

## 2. 什么叫"循环体"

循环体就是 `for` 下面那整段会被重复执行的模板。

```python
for idx in pypto.loop(b_loop):
    t0_sub = input0[b_offset:b_offset_end, ...]
    t1_sub = input1[b_offset:b_offset_end, ...]
    out_sub = t0_sub + t1_sub
```

真正被重复的不是某一行，而是这一整段模板。每次迭代只是在"换一个 idx，再执行同样的模板"。

---

## 3. 第一层：模型架构层的 loop

模型层 loop离具体源码最远，但对产品理解最重要，因为它解释了"为什么同一类 kernel 会在整网里反复出现"。

在大模型里，最典型的有两类：

- **层重复：** decoder layer 一层一层重复很多次，这是一种模块复用
- **时间步重复：** decode 阶段每生成一个 token，都会再跑一轮 attention、MLP、norm 等计算

这一层的 loop 不一定对应源码里真的写了一个 `for`，更多是一种架构级重复关系。

---

## 4. 第二层：源码里的 loop，才是开发者真正写出来的循环

进入 PyPTO kernel 以后，loop 才变成源码对象。官方 API 主要有：

- `pypto.loop` — 定义普通循环
- `pypto.loop_unroll` — 带展开档位的循环
- `pypto.is_loop_begin` — 判断当前迭代是否为循环开始
- `pypto.is_loop_end` — 判断当前迭代是否为循环结束

对应文档：
[pypto-loop.md](https://gitcode.com/cann/pypto/blob/master/docs/api/controlflow/pypto-loop.md) /
[pypto-loop_unroll.md](https://gitcode.com/cann/pypto/blob/master/docs/api/controlflow/pypto-loop_unroll.md) /
[pypto-is_loop_begin.md](https://gitcode.com/cann/pypto/blob/master/docs/api/controlflow/pypto-is_loop_begin.md) /
[pypto-is_loop_end.md](https://gitcode.com/cann/pypto/blob/master/docs/api/controlflow/pypto-is_loop_end.md)

### 4.1 `pypto.loop`

`pypto.loop` 最接近"普通循环"，通常用来表示"把某一维数据按批次处理完"。

官方定义：「定义一个循环操作，实现 python 当中的 for 循环功能」
——[pypto-loop.md](https://gitcode.com/cann/pypto/blob/master/docs/api/controlflow/pypto-loop.md)

```python
for idx in pypto.loop(b_loop):
    ...
```

这层 loop 的业务含义通常是：**这一批数据太大，不能一次全算完，要按某个外层维度分批处理。**

### 4.2 `pypto.loop_unroll`

`loop_unroll` 不是简单"多跑几次"，而是允许开发者同时准备多种展开档位，让编译器在不同场景下选择不同 path。

官方定义：「`pypto.loop_unroll` 是一个支持循环展开的循环迭代器函数，功能与 `pypto.loop` 类似，增加了 `unroll_list` 参数支持多个展开方式」
——[pypto-loop_unroll.md](https://gitcode.com/cann/pypto/blob/master/docs/api/controlflow/pypto-loop_unroll.md)

**`loop` vs `loop_unroll` 的关键区别（来自官方 FAQ）：**

- 使用 `loop(unroll_list=[2])` 时，展开逻辑是框架自动重复 body，用户每次只处理 step=1 的步长
- 使用 `loop_unroll(unroll_list=[2])` 时，body 签名带 `unroll_length` 参数，用户自己处理 k 个步长

官方原则：「如果可以一次处理多个 i，使用 `loop_unroll` 会更高效；如果一次只能处理 1 个 i，则需要使用 `loop`」
——[faq.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/faq.md)

在 DeepSeek 里使用 `loop_unroll` 非常重要，因为很多 kernel 在 decode 小 batch 和 prefill 大 batch 下，最合适的展开粒度完全不同。

### 4.3 一个很容易忽略的细节：即使没写 loop，前端也可能插入隐式 loop

官方 FAQ 专门说明：即使开发者没有显式写 `for`，前端也会默认插入 `pypto.loop(1)` 作为执行骨架。

> 官方原文：「实际是在构图阶段前端会隐式的在 function 开始的位置插入一个 loop，循环次数为 1」
> ——[faq.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/faq.md)

```python
# 等价关系：
@pypto.jit
def foo(a, b, c):
    c[:] = a + b

# 等价于：
@pypto.jit
def foo(a, b, c):
    for i in pypto.loop(1):
        c[:] = a + b
```

另外，官方还提醒：「框架当前不会自动进行 `loop(1)` 合并，因此在实际使用中，建议用户手动合并 `loop(1)`，以提高效率」

> **源码里看不到 loop，不等于后面的控制流图里一定没有 loop。**

---

## 5. DeepSeek 真实案例一：Indexer Prolog 的 token 循环

最适合看的真实例子：
[lightning_indexer_prolog_quant_impl.py](https://gitcode.com/cann/pypto/blob/master/models/deepseek_v32_exp/lightning_indexer_prolog_quant_impl.py)

源码里的核心循环：

```python
for t_idx, unroll_length in pypto.loop_unroll(
    0, t, 1,
    name="IndexerPrologQuantQuantLoop",
    idx_name="tIdx",
    unroll_list=unroll_list,
):
    t_tile = unroll_length
    ...
```

业务意思：

```
从第 t_idx 个 token 开始
这次按 t_tile 个 token 为一批处理
处理完这一批，再继续下一批
```

循环体表达的是：**"处理一批 token 的完整 Query / Key / Weight 计算模板"。**

### 5.1 为什么这段 loop 不是普通循环

对应配置文件
[deepseekv32_lightning_indexer_prolog_quant.py](https://gitcode.com/cann/pypto/blob/master/models/deepseek_v32_exp/deepseekv32_lightning_indexer_prolog_quant.py)
里，真实给的是：

```python
unroll_list=[32, 16, 8, 4, 2, 1]
```

这意味着源码层面虽然只写了一条 loop，但编译器实际上会准备 6 种候选跑法：

| 档位 | 一次处理 token 数 |
|-----|----------------|
| 1 | 32 |
| 2 | 16 |
| 3 | 8 |
| 4 | 4 |
| 5 | 2 |
| 6 | 1 |

> **源码 loop 是"一个模板"，不是"只有一种执行粒度"。**

### 5.2 真实产物证明这 6 种档位确实存在

本地真实输出 `Pass_00_RemoveRedundantReshape` 目录里可以直接看到 6 个 path 文件：

```
...PATH0_6.json
...PATH0_8.json
...PATH0_10.json
...PATH0_12.json
...PATH0_14.json
...PATH0_16.json
```

在 `kernel_aicpu/controlFlow_host_*.cpp` 里，能看到这组真实映射：

| loop step（token 数） | path magic |
|---------------------:|----------:|
| 32 | 6 |
| 16 | 8 |
| 8 | 10 |
| 4 | 12 |
| 2 | 14 |
| 1 | 16 |

> **重要：文件名里的 `PATH0_6 / 8 / 10...` 不是展开因子本身，而是 path 的 magic 编号；真正的展开因子，要看 controlFlow 代码里的 step。**

---

## 6. 第三层：tile 遍历 loop

这层最容易被忽视，但如果要理解性能问题，就必须单独拿出来。

`TileShape` 表面上只是一个切块配置，实际上它天然对应"逐块遍历"。如果原始 tensor 比单个 tile 大，那么框架最终就必须：

```
切出很多小 tile
逐块搬运
逐块计算
逐块写回
```

这就是一种执行意义上的 loop。

官方文档：
[tiling.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/development/tiling.md) /
[loops.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/development/loops.md)

### 6.1 tile loop 和源码 loop 的区别

- **源码 loop** 关心的是"按哪一批 token / head / block 来组织业务处理"
- **tile loop** 关心的是"这一批数据在核内怎么被继续切细并覆盖完整张量"

举个最简单的例子：

- 外层 `t_idx` loop 可能表示"这次处理 8 个 token"
- 但这 8 个 token 对应的 matmul、dequant、rope、hadamard，在核内还会继续按各自的 cube tile 或 vec tile 再切很多块

所以同一批 token，到了图和泳道图上，常常会被拆成很多节点和任务。这不是因为源码里多写了几层 `for`，而是因为 **TileShape 本身就要求逐块遍历。**

### 6.2 在 DeepSeek 里，这层 loop 常常藏在算子内部

DeepSeek 的很多 kernel 会显式设置：

```python
pypto.set_cube_tile_shapes(...)
pypto.set_vec_tile_shapes(...)
```

这意味着 `Query-Linear`、`Dequant`、`Hadamard`、`RoPE` 这些语义片段，都会各自按不同 tile 粒度运行。

> **不要把"源码只看到一层 loop"误读成"执行上只有一层重复"。**

---

## 7. DeepSeek 真实案例二：Sparse Flash Attention 的多层嵌套 loop

如果说 Indexer Prolog 更适合解释"一维 token loop"，那么
[sparse_flash_attention_quant_impl.py](https://gitcode.com/cann/pypto/blob/master/models/deepseek_v32_exp/sparse_flash_attention_quant_impl.py)
更适合解释"为什么 controlflow 看上去往往比源码还复杂"。

源码里有 5 层嵌套：

```python
for batch_idx in pypto.loop(...):           # 第几条请求
    for slc_idx in pypto.loop(...):         # 当前 query 的第几个位置
        for n_kv_idx in pypto.loop(...):    # 第几个 key/value 头
            for group_idx in pypto.loop(...): # 第几个 group
                for s2_idx, _ in pypto.loop_unroll(...): # 第几个历史 KV block 区间
                    ...
```

这 5 层循环的业务含义完全不同，同时扫描 batch / query 位置 / head / group / 历史 cache block。这也是 attention controlflow 往往比一般算子更复杂的原因。

---

## 8. 第四层：编译后的 controlflow，不等于源码 AST

很多人第一次看控制流图时，会下意识以为它就是 Python `for/if` 的图形版。实际上不是。

中间至少发生了几件事：

1. **普通 `range/list/tuple` 这类循环，很多时候前端就直接展开了** ——不是每个 Python `for` 都会留下来
2. **前端可能补一层隐式 `pypto.loop(1)`** ——源码没写 loop，也不代表后面一定没有 loop 骨架
3. **`loop_unroll` 会把一条 loop 变成多条 path** ——控制流里看到的 path 数，可能比源码表面上看到的循环层数更多
4. **tile 遍历会继续放大任务数** ——控制流和执行图，通常会比源码"更碎"

> **controlflow 不是源码 AST 的复印件，而是"前端保留下来的动态控制骨架 + path 展开 + tile 遍历结果"的合成物。**

---

## 9. `is_loop_begin / is_loop_end` 在 DeepSeek 里到底在解决什么

控制流里另一类重要对象，不是普通业务条件，而是循环边界条件。

官方定义：
- `is_loop_begin`：「判断当前迭代是否为循环的开始」
- `is_loop_end`：「判断当前迭代是否为循环的结束」

官方用途：「为了支持关键算子 FA 的编译优化，提供了两个特殊的函数 `pypto.is_loop_begin()` 和 `pypto.is_loop_end()` 用于优化条件分支」
——[faq.md](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/faq.md)

在
[page_attention.cpp](https://gitcode.com/cann/pypto/blob/master/framework/src/operator/models/deepseek/page_attention.cpp)
里能直接看到这种低层表达：

```cpp
LOOP("LOOP_L2_bn", FunctionType::DYNAMIC_LOOP, bn, LoopRange(0, bnPerBatch, 1), PowersOf2(maxUnrollTimes)) {
    IF (IsLoopBegin(bn, 0)) {
        ...
        IF (IsLoopEnd(bn, bnPerBatch)) {
            ...  // 首块 = 最后块：初始化 + 收尾
        } ELSE {
            ...  // 首块但不是最后块：初始化
        }
    } ELSE {
        ...
        IF (IsLoopEnd(bn, bnPerBatch)) {
            ...  // 中间块到最后一块：收尾
        } ELSE {
            ...  // 普通中间块：累计
        }
    }
}
```

逻辑很直观：

- 首块 → 初始化逻辑
- 中间块 → 累计逻辑
- 尾块 → 收尾和写回

> **controlflow 里很多 IF，本质上不是"业务判断"，而是同一个循环在首块、中间块、尾块位置上，执行模板不同。** 这也是为什么 controlflow 图往往比源码表面看到的 `if` 更多。

---

## 10. 四层 loop 汇总

| 层级 | 它在回答什么 | DeepSeek 里的例子 | 最容易误解成什么 |
|-----|------------|-----------------|---------------|
| 模型层 loop | 为什么同类 kernel 会反复出现 | decoder layer 重复、decode 每步重复 | 误以为源码里写了很多 for |
| 源码层 loop | 一个 kernel 怎样分批处理数据 | `t_idx`、`batch_idx`、`s2_idx` | 误以为这已经等于最终执行任务 |
| tile 遍历 loop | 这一批数据怎样在核内被逐块算完 | cube tile / vec tile 遍历 | 误以为只是配置，不算 loop |
| 编译后的 controlflow | 这些循环最终保留成哪些 path 和分支 | `PATH0_6/8/10...`、`IsLoopBegin/End` | 误以为它是源码 AST 的直接投影 |


---

## 12. 对 PTO 的直接启发

**第一：给 loop 打"层级标签"。**
要让用户一眼知道当前看到的是模型层重复、源码层循环，还是 tile 遍历。

**第二：把 `path magic` 和 `loop step` 的关系解释出来。**
否则用户只会看到一堆 `PATH0_6/8/10` 文件名，不知道它们对应哪种展开档位。

**第三：不要把 controlflow 图包装成"源码流程图"。**
它应该被明确描述成"编译器保留下来的控制骨架"。

---

## 参考资料

| 文档 | 链接 |
|------|------|
| pypto-loop.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/api/controlflow/pypto-loop.md) |
| pypto-loop_unroll.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/api/controlflow/pypto-loop_unroll.md) |
| pypto-is_loop_begin.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/api/controlflow/pypto-is_loop_begin.md) |
| pypto-is_loop_end.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/api/controlflow/pypto-is_loop_end.md) |
| loops.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/development/loops.md) |
| tiling.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/development/tiling.md) |
| faq.md | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/docs/tutorials/appendix/faq.md) |
| lightning_indexer_prolog_quant_impl.py | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/models/deepseek_v32_exp/lightning_indexer_prolog_quant_impl.py) |
| deepseekv32_lightning_indexer_prolog_quant.py | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/models/deepseek_v32_exp/deepseekv32_lightning_indexer_prolog_quant.py) |
| sparse_flash_attention_quant_impl.py | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/models/deepseek_v32_exp/sparse_flash_attention_quant_impl.py) |
| page_attention.cpp | [gitcode.com](https://gitcode.com/cann/pypto/blob/master/framework/src/operator/models/deepseek/page_attention.cpp) |

本地真实产物（仅本地可用）：

- `output_deepseek/Pass_00_RemoveRedundantReshape/`（可见 6 个 PATH0\_N 文件）
- `output_deepseek/kernel_aicpu/controlFlow_host_*.cpp`（loop step ↔ path magic 映射）

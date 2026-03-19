# Dynamic Shape 与 KV Cache 的可视化研究

这篇笔记专门研究另一个对大模型工具极其重要、但目前还没有被画清楚的主题：

**动态 shape 和 KV cache，到底应该怎样在 graph 工具里表达，才能让开发者真正看懂 prefill / decode、shape 绑定和 cache 更新。**

这个主题之所以重要，是因为很多大模型相关问题，根源不在普通张量节点，而在这些运行时对象：

- 当前这次调用到底把哪些符号维度绑定成了什么值；
- 这次执行到底走的是 prefill 还是 decode；
- `cache_index` 决定了把哪些 token 写进了 `kv_cache / kr_cache / k_scale_cache`；
- `topk_indices`、`block_table` 和 `kv_act_seqs` 又怎样从缓存里把数据取回来。

如果工具只能展示一张静态 DAG，开发者其实很难看清这些关系。

## 1. 先把问题说清楚：什么叫 dynamic shape，什么叫 KV cache

### 1.1 Dynamic shape 不是“图会变”，而是“某些维度在运行时才知道”

官方 `pypto.frontend.dynamic` 文档给出的定义很明确：`dynamic(name)` 会创建一个 `SymbolicScalar`，用来表示动态维度。典型场景就是 batch size、序列长度这类在不同请求之间会变化的维度。[`pypto-frontend-dynamic.md`](/Users/yin/gitcode/pypto-master/docs/api/pypto-frontend-dynamic.md)

例如：

```python
t = pypto.frontend.dynamic("t")
token_x: pypto.Tensor((t, h), pypto.DT_BF16)
```

这段定义的意思不是“图不稳定”，而是说：

```text
在写 kernel 的时候，只知道有一维叫 t
但第一次真正调用之前，并不知道 t 具体等于多少
```

所以，dynamic shape 的关键不是“图变了”，而是“维度先以符号形式存在，运行时再绑定到真实输入”。

### 1.2 KV cache 不是普通输入输出，而是“跨 token 保持状态”的存储

在 DeepSeek 的 MLA 和 Indexer 相关算子里，`KV cache` 不只是一个普通张量，它是一个会在多次 token 计算之间不断累积的状态。

官方 README 里对这些张量的定义非常清楚：

- `kv_cache`：保存 key 的 cache
- `kr_cache`：保存 key 的 rope 部分
- `k_scale_cache`：保存 key 的反量化参数
- `cache_index`：指示本次要往 cache 的哪个位置写

这些对象的 shape 通常不是 `[t, h]` 这种简单二维，而是：

```text
[block_num, block_size, n_kv, hidden_or_rope_dim]
```

并且它们使用的 `cache_mode` 往往是 `"PA_BSND"` 这一类分页注意力布局。[`README.md`](/Users/yin/gitcode/pypto-master/models/deepseek_v32_exp/README.md)

所以，KV cache 的本质不是“一个更大的 tensor”，而是：

```text
一个跨 step 存活的、按分页布局组织的历史状态区
```

## 2. 动态 shape 在 PyPTO 里是怎么绑定到真实值的

这件事如果只停留在术语层，会很抽象。好在本地实现给了非常直观的路径。

在前端 parser 里，`dynamic()` 产生的是 `SymbolicScalar`。  
真正到第一次调用时，`Parser.bind_dynamic_dims_to_input_tensors()` 会把这些符号维度绑定到运行时输入 shape 的具体轴上。[`parser.py`](/Users/yin/gitcode/pypto-master/python/pypto/frontend/parser/parser.py)

它的逻辑可以压缩成一句话：

```text
看函数签名里哪些维度是 SymbolicScalar
再看这次真实输入张量各轴的大小
把二者一一绑定起来
```

例如：

```python
t = pypto.frontend.dynamic("t")
token_x: pypto.Tensor((t, h), pypto.DT_BF16)
```

如果这次真正调用传入的 `token_x` 形状是：

```text
[128, 7168]
```

那么这次运行里就会得到：

```text
t = 128
```

更关键的是，前端实现并不是一味把符号直接替换成整数，它还支持把动态维度绑定成运行时 shape 表达式。这意味着动态轴可以在多次调用之间保持“真正动态”，而不是每次都退化成一个静态专用版本。[`parser.py`](/Users/yin/gitcode/pypto-master/python/pypto/frontend/parser/parser.py)

对产品来说，这一点很重要。因为它说明工具在表现 dynamic shape 时，不应该只显示“最后变成了多少”，还应该区分：

- 这是一个符号维度
- 这次调用把它绑定成了什么
- 它到底是被静态特化了，还是依然作为运行时维度存在

## 3. 在 DeepSeek 的真实代码里，dynamic shape 和 KV cache 是怎么交汇的

这个主题如果只讲动态维度或只讲 cache，都不够。大模型里最关键的地方，是两者其实交汇在一起。

以 [`mla_prolog_quant_impl.py`](/Users/yin/gitcode/pypto-master/models/deepseek_v32_exp/mla_prolog_quant_impl.py) 为例，官方代码里可以看到这条线非常清楚：

```python
t = pypto.frontend.dynamic("t")

token_x_shape = (t, h)
cos_shape = (t, qk_rope_head_dim)
sin_shape = (t, qk_rope_head_dim)
cache_index_shape = (t,)
```

这说明：

```text
当前要处理多少 token
不仅决定 token_x 的第一维
也决定 cos/sin 的第一维
还决定这次要写多少个 cache_index
```

也就是说，`t` 不是一个孤零零的符号，而是把一批运行时对象串起来的公共锚点。

接着往下看，在算子主体里：

```python
k_cache_index_2d = pypto.reshape(cache_index, [t, 1], inplace=True)
...
index = pypto.view(k_cache_index_2d, [tile_bs, 1], [bs_offset, 0])
...
kr_cache_out[:] = pypto.scatter_update(kr_cache, -2, index, k_rope_4d)
kv_cache_out[:] = pypto.scatter_update(kv_cache, -2, index, k_nope_4d)
k_scale_cache_out[:] = pypto.scatter_update(k_scale_cache, -2, index, k_scale_4d)
```

这一段的意思可以翻成非常直白的话：

```text
先把本次调用涉及的 token 索引整理成 index
再按 tile 分批取出这一小段 index
然后把每一批算出的 key / rope / scale
分别写回到 cache 的对应位置
```

所以对工具来说，`cache_index` 不应该只是属性面板里一行 `shape=[t]`。它实际上是这次运行里最关键的“路由信息”之一。

## 4. Sparse Attention 阶段，KV cache 又是怎样被读出来的

如果只看 `scatter_update` 写 cache，很容易把 KV cache 理解成“只是一个写回缓冲区”。但在 attention 阶段，它又会变成“被选择、被分页映射、被 gather 出来的历史状态”。

在 [`sparse_flash_attention_quant_impl.py`](/Users/yin/gitcode/pypto-master/models/deepseek_v32_exp/sparse_flash_attention_quant_impl.py) 里，可以看到几个关键对象同时出现：

- `topk_indices`
- `block_table`
- `kv_act_seqs`
- `key_nope_2d / key_rope_2d / k_nope_scales`

这里的语义大致是：

1. `topk_indices` 告诉你，本次 query 最相关的是哪些历史 token；
2. `block_table` 告诉你，这些逻辑 token 在分页 cache 里实际落在哪些 block；
3. `kv_act_seqs` 告诉你，不同 batch 的有效 cache 长度是多少；
4. `gather_in_ub / gather_in_l1` 再把真正需要的 kv cache 块搬到片上参与计算。

这意味着，KV cache 在产品层其实至少有两种完全不同的状态：

```text
写阶段：cache_index 决定往哪里写
读阶段：topk_indices + block_table 决定从哪里取
```

如果工具只展示一个“kv_cache 节点”，而不区分这两种语义，开发者还是看不懂它在当前阶段到底扮演什么角色。

## 5. 为什么当前 graph 工具还解释不清这个主题

把前面的事实放在一起看，会发现当前工具的不足不是“没画出 kv_cache 节点”，而是**没把运行时对象的语义层画出来。**

现在的图工具更擅长表达：

- 张量和操作之间的静态依赖
- Pass 优化后的结构变化
- 某些源码到图节点的对应关系

但 dynamic shape 和 KV cache 真正关键的部分在于：

- `SymbolicScalar` 是怎么绑定的
- 哪些 tensor 共享同一个动态维度
- 这次调用的 `shape bucket` 是什么
- `cache_index` 这次写了哪些位置
- `topk_indices` 这次从哪些位置读了哪些 block

这些都更接近“运行时语义图”，而不是单纯的 DAG。

所以，如果 topic 4 要落成产品能力，不能只在现有 DAG 上继续堆更多标签，而必须引入一层新的表达模型。

## 6. 我建议引入三层表达：符号层、绑定层、缓存层

为了让 topic 4 真正可视化，我建议把表达分成三层，而不是试图把所有信息塞进一张图里。

### 6.1 符号层：谁是动态的

这一层的目标是回答：

```text
哪些维度在写代码时是符号，不是固定整数
```

适合展示的对象包括：

- `SymbolicScalar` 名称，例如 `t / B / shape1 / shape2`
- 哪些输入和输出 shape 使用了这个符号
- 这个符号在当前 kernel 里一共约束了哪些对象

一个简单例子就是：

```text
t
├─ token_x: [t, h]
├─ cos: [t, rope_dim]
├─ sin: [t, rope_dim]
└─ cache_index: [t]
```

这层不需要画复杂 DAG，更像“符号约束关系图”。

### 6.2 绑定层：这次调用把符号变成了什么

这一层的目标是回答：

```text
这次运行里，t 到底绑定成了多少
prefill 和 decode 分别绑定成了什么形状
```

这一层最适合做成一次调用的 runtime card，而不是长期存在在主图上。

例如：

```text
Call #128
Mode: decode
t = 2
b = 2
token_x = [2, 7168]
cache_index = [2]
```

或者：

```text
Call #12
Mode: prefill
t = 32
b = 16
token_x = [32, 7168]
cache_index = [32]
```

这层的关键价值在于，它把“符号维度”变成“本次执行的真实上下文”。

### 6.3 缓存层：这次到底写了哪里、读了哪里

这一层的目标是回答：

```text
cache 这次发生了什么
```

这一层建议不要硬塞到主 DAG 里，而要做成 overlay 或独立视图。因为 cache 往往维度很大，直接画成 DAG 会迅速失控。

更合适的方式是：

- 写路径视图：`cache_index -> kv_cache / kr_cache / k_scale_cache`
- 读路径视图：`topk_indices + block_table -> gather -> attention`
- block 视图：按 `block_num / block_size` 展示哪些 block 被命中

如果第一版要简化，我建议只先做两件事：

1. 在写路径上高亮“本次更新的 cache slot”
2. 在读路径上高亮“本次 attention 实际 gather 的 block”

这样已经能让很多 prefill/decode 问题第一次变得可解释。

## 7. 针对 graph 工具，我建议的页面形态

如果要把 topic 4 落成产品，我建议不要试图在现有 DAG 主画布上一次解决所有问题，而是采用“主图 + runtime overlay + cache view”的组合。

### 7.1 主图仍然保留 DAG，但加动态 badge

主图上，适合新增的是轻量提示，而不是重构整个图。

建议给节点或边加两种 badge：

- `dyn:t` 这类 badge，表示该 shape 含有动态维度
- `cache-write` / `cache-read` 这类 badge，表示该节点参与 cache 更新或读取

例如：

```text
token_x   [t, h]       dyn:t
cache_index [t]        dyn:t
kv_cache               cache-write
topk_indices           cache-read
```

这样用户在不离开主图的情况下，已经能看出哪些对象需要重点关注。

### 7.2 右侧 Inspector 要升级成“Runtime Inspector”

当前的详情面板更像静态属性卡。  
对 topic 4 来说，它需要升级成运行时面板，至少包含：

- 符号维度列表
- 本次调用的绑定结果
- cache 模式，例如 `PA_BSND`
- cache 张量 shape
- 本次命中的 cache index 概览

如果这层做成了，用户第一次点到 `cache_index` 时，不会只看到“shape=[t]，dtype=int64”，而是会看到：

```text
这是本次调用用于更新 cache 的索引张量
本次绑定 t = 32
本次有效 index 范围 = ...
将更新 kv_cache / kr_cache / k_scale_cache
```

### 7.3 单独做一个 Cache View

这可能是 topic 4 最值得做、也最容易和现有主图解耦的能力。

这个视图不应该再是普通 DAG，而应该更像：

- page/block 布局图
- 写入热区图
- 读取热区图
- 或一张“逻辑 token -> 物理 block”的映射图

尤其是当 `block_table`、`topk_indices` 和 `kv_act_seqs` 一起出现时，用户真正想看的是：

```text
这次 query 到底访问了哪些历史 token
这些 token 在物理 cache 上落在哪些 block
```

这件事直接关系到 cache 命中、搬运效率和 attention 阶段的性能理解。

## 8. topic 4 最值得优先做的第一版能力

如果这件事现在就要开始落原型，我建议第一版不要贪多，而是优先做下面三件事。

**第一件：动态维度链路卡。**  
把一个符号维度及其关联张量组织成小卡片，例如：

```text
t
-> token_x [t, h]
-> cos [t, rope_dim]
-> sin [t, rope_dim]
-> cache_index [t]
```

这件事的成本不高，但能极大提升用户对 `dynamic shape` 的理解。

**第二件：调用级绑定结果面板。**  
把当前这次调用真正绑定出来的：

- `t`
- `b`
- `shape1/shape2`
- 模式（prefill/decode）
- 关键输入 shape

显式展示出来。

**第三件：KV cache 写路径可视化。**  
哪怕第一版不画复杂 block 结构，也至少要把：

```text
cache_index -> scatter_update -> kv_cache / kr_cache / k_scale_cache
```

作为一条明确的运行时链路展示出来。

只要这三件事做出来，topic 4 的很多“半懂不懂”问题就会第一次真正变得直观。

## 9. 对 topic 4 的最终判断

如果只保留一句结论，我的判断是：

**dynamic shape 和 KV cache 之所以值得单独研究，不是因为它们是大模型里的专业术语，而是因为它们本质上都是“运行时语义对象”；如果 graph 工具只会画静态 DAG，就永远无法把 prefill / decode、shape 绑定和 cache 读写真正讲清楚。**

## 参考资料

- [`pypto-frontend-dynamic.md`](/Users/yin/gitcode/pypto-master/docs/api/pypto-frontend-dynamic.md)
- [`parser.py`](/Users/yin/gitcode/pypto-master/python/pypto/frontend/parser/parser.py)
- [`developer_doc_zh.md`](/Users/yin/gitcode/pypto-master/python/pypto/frontend/developer_doc_zh.md)
- [`README.md`](/Users/yin/gitcode/pypto-master/models/deepseek_v32_exp/README.md)
- [`mla_prolog_quant_impl.py`](/Users/yin/gitcode/pypto-master/models/deepseek_v32_exp/mla_prolog_quant_impl.py)
- [`lightning_indexer_prolog_quant_impl.py`](/Users/yin/gitcode/pypto-master/models/deepseek_v32_exp/lightning_indexer_prolog_quant_impl.py)
- [`sparse_flash_attention_quant_impl.py`](/Users/yin/gitcode/pypto-master/models/deepseek_v32_exp/sparse_flash_attention_quant_impl.py)
- [`pypto-experimental-gather_in_ub.md`](/Users/yin/gitcode/pypto-master/docs/api/operation/pypto-experimental-gather_in_ub.md)

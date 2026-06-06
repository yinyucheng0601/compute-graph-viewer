
#  真实算子开发流程的调研

> 说明：上面的 §1–§12 是从 Triton-Viz「trace 回放」视角出发的早期心智模型，回答的是「某一步在碰哪一片」。下面的 Part II 是后续深入真实 CANN 源码后得到的结论，把视角从「回放一次执行」转到「开发者写 tiling 时真正面对的问题」。两者不矛盾：Part I 解释「执行长什么样」，Part II 解释「tiling 该怎么定、为什么难」。
>
> 证据约定：以下文件路径相对 `~/gitcode/`，即
> `asc-devkit-master/` = `~/gitcode/asc-devkit-master/`，
> `cann-recipes-infer-master/` = `~/gitcode/cann-recipes-infer-master/`。
> 行号基于调研当时的代码，可能随版本漂移，引用时以标识符为准。

## 13. tiling 不是写死的数字，是「运行时按 shape 算」的函数

最关键的认知纠正：**开发者交付的不是一组固定的 tiling 数字，而是一个在运行时被调用、读真实 shape、现算 tiling 的函数。**

- 注册入口：`IMPL_OP_OPTILING(OpName).Tiling(TilingFunc).TilingParse<CompileInfo>(...)`
  - 证据：`cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_host/swiglu_group_quant_tiling.cpp:586-588`
- tiling 函数签名：`ge::graphStatus TilingFunc(gert::TilingContext* context)`，每次算子被调用都会执行。
  - 证据：`swiglu_group_quant_tiling.cpp:578`
- 两阶段模型：
  - **编译期 `TilingParse`**：只存「与 shape 无关」的硬件信息（核数、SoC、UB/L1 大小）。
    - 证据：`cann-recipes-infer-master/ops/pypto/src/lightning_indexer_pto/op_host/lightning_indexer_tiling.cpp:137-143`，compile-info 结构体仅含 `block_dim_num`（`lightning_indexer_tiling.cpp:34-36`）。
  - **运行期 `Tiling`**：读真实 shape、现算。
    - 证据：`cann-recipes-infer-master/ops/ascendc/src/moe_gating_top_k_hash/op_host/moe_gating_top_k_hash_tiling.cpp:610-629`（运行时还会按 `GetSocVersion()` 分流到 950 / 非 950 两套 tiling）。

> 推论：硬件是「编译期给定」，shape 是「运行期给定」，**开发者这两个都不"调"**。开发者写的是「给定硬件 + 任意 shape → 算出合法且快的 tiling」这套决策逻辑。

## 14. 输入 tensor 的 shape 是「喂进来的」，不是开发者定的

tiling 函数靠 `context->GetInputShape(i)->GetStorageShape().GetDim(k)` 读维度，shape 来自调用方。

LLM 算子有一个**通用套路**：把除最后一维外的所有维乘起来当 row（= token 数），最后一维（或由 gamma/weight 决定的维）当 feature/hidden：

- rms_norm：`numRow = ∏(前导维)`，`numCol = ∏(gamma 维)`。
  - 证据：`cann-recipes-infer-master/ops/ascendc/src/rms_norm_dynamic_quant/op_host/rms_norm_dynamic_quant_tiling.cpp:284-297`
- swiglu：`bs_ = ∏(前导维)`（B×S = token 数），`d_ = 最后一维`（hidden），`splitD_ = d_/2`。
  - 证据：`cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_host/swiglu_group_quant_tiling.cpp:137-145, 185-186`

落到 MatMul `x @ W`：

```text
M = batch × seq  （token 数，来自激活 x，运行时会变）
K = hidden       （来自 weight，模型结构固定）
N = 输出维        （来自 weight，模型结构固定）
```

> 关键结论：**K、N 来自 weight 是固定的；只有 M = batch×seq 在动。** tiling 主要就是在跟会变的 M 较劲。开发者脑子里是「我的 x 是 [batch, seq, 4096]」，不是「M=512」。

## 15. 我们面向「推理」，不是训练

| | 训练 Training | 推理 Inference |
|---|---|---|
| 在干嘛 | 喂数据，更新模型参数（weight） | 参数冻结，直接产出结果 |
| 计算流程 | 前向 + 反向，两趟 | 只有前向一趟 |
| shape 特征 | 大 batch，较规整 | batch/seq 随请求剧烈变化 |

我们读的代码库 `cann-recipes-infer-master` 名字里的 **infer 即推理**——工具瞄准推理场景。推理特有的两阶段是动态 shape 的根源：

- **Prefill**（处理 prompt）：一次吃整个输入，`seq` 大 → M 大 → matmul 近方阵，base tile 能切大、算力跑满。
- **Decode**（逐字生成）：每步生成 1 个 token，`seq=1`，batch 也常小 → **M 可能小到 1**，matmul 退化成又瘦又长，tiling 策略完全不同。

> 代码里没有按 `"decode"/"prefill"/"seqLen==1"` 命名的硬分支（confirmed absent）；这种区分是**隐式地通过 shape 落入不同 tiling key 实现的**（见 §16）。

## 16. 动态 shape：一个 binary 用 tiling key 覆盖一片 shape

shape 不固定（tokenize 后 seq 随输入长度变），所以同一个编译产物必须服务一片 shape。机制是 **tiling key**：

- 未知维用 `-1` 表示（`UNKNOWN_DIM = -1`，`asc-devkit-master/impl/utils/stub/shape.cpp:16`），算子声明 `.DynamicShapeSupportFlag(true)`（`moe_gating_top_k_hash_def.cpp:139`）。
- 运行期按真实 shape/dtype/属性选一个 key：`context->SetTilingKey(key)`。
  - 证据：`swiglu_group_quant_tiling.cpp:547`；`moe_gating_top_k_hash_tiling.cpp:573-602`（`GetTilingKey()` 决策逻辑）。
- 每个 key 对应 kernel 里一个**不同的模板实例**（不同 unroll/buffer 配置）：`if (TILING_KEY_IS(K)) { OpTemplate<...> op; ... }`。
  - 证据：`cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_kernel/swiglu_group_quant.cpp:26-57`
- 分支条件是真实的 shape 阈值 / dtype 组合 / 可选输入，例如：
  - `MoeGatingTopKHash` 有 **7 个 key**，条件含 `expertCount==256 && groupCount==8 && k<=32`、以及 4 种 (input_ids dtype × tid2eid dtype) 组合。证据：`moe_gating_top_k_hash_tiling.cpp:573-602`。
  - `RmsNormDynamicQuant` 按「一行塞不塞得进 UB」在 `NORMAL → SINGLE_ROW → SLICE_D` 三套策略里顺序回退。证据：`rms_norm_dynamic_quant_tiling.cpp:371-443`；key 写回 `:98-132`。

> 这就是「按 unroll 层级分别定义 tiling」的真身：**不是炫技，是被动态 shape 逼出来的**——一套 tiling 覆盖不了从 M=1 到 M=几千的全光谱。

## 17. 硬件约束包络：「能切多大」

tiling 第一道硬门槛是 base tile 必须塞进固定大小的片上 buffer，超了 tiling 非法（编不过/报错，不是慢一点）。

硬件容量常量（`asc-devkit-master/impl/adv_api/tiling/matmul/matmul_tiling_base.cpp:33-59`）：

| 芯片 | L0A | L0B | L0C | L1 | UB | btSize（L1 预留） |
|---|---|---|---|---|---|---|
| Ascend 950（DAV_3510） | 64KB | 64KB | 128KB | 512KB | 118KB | 0 |
| Ascend 910B/310B（DAV_2201） | 64KB | 64KB | 128KB | 512KB | ~192KB | 1024B |
| Ascend 3113 | 32KB | 32KB | 64KB | 512KB | 118KB | 0 |

btSize 差异证据：`matmul_tiling_base.cpp:186-189`（910B/310B 预留 1024B，其余 0）。

约束校验公式（`matmul_tiling_algorithm.cpp`）：

> ⚠️ 合法性判定用**满容量**（`/ DB_OFF`，`DB_OFF=1`），**不**把 double buffer 砍半算进去；DB 能否开是第二层（`GetL0cDB`）。`DB_ON=2/DB_OFF=1` 见 `matmul_tiling_algorithm.h:30-31`。

| 约束（第一层·合法装下） | 公式 | 证据 |
|---|---|---|
| L0A | `baseM*baseK*dtypeBytes ≤ L0A`（满容量） | `CheckL0ASize :3843` |
| L0B | `baseK*baseN*dtypeBytes ≤ L0B` | `CheckL0BSize :3881` |
| L0C | `baseM*baseN*4 ≤ L0C`（**恒按 FP32 4 字节**） | `CheckL0CSize :3918` |
| L1 | `depthA1Size*Abytes + depthB1Size*Bbytes ≤ L1 - btSize` | `CalcL1Tiling :2605` |
| 对齐 | `baseM/baseN` 须为 `C0_SIZE=16` 的倍数 | `:3852 / :3927` |
| DB 可开（第二层） | 合法基础上 `2×used ≤ 容量` 才有空间开 DB | `GetL0cDB :564-612` |

三个反直觉教学点：

1. **L0C 永远按 FP32(4B) 算**，不管输入是不是 fp16 → `baseM×baseN` 往往是最先爆的那个。
2. **double buffer 要占两份** → 合法容量不变，但想开 DB 提速就得留出第二份空间，所以 base tile 得更小。
3. base 须 16 对齐，否则出尾块、核用不满。

## 18. 性能：「切多大更快」——而且代码里没有现成的反馈

塞得下不等于快。算法内部确实有一个 cost model：

| 维度 | 逻辑 | 证据 |
|---|---|---|
| 算力强度（主指标） | `avgIntensity = computeCycle / memoryTraffic`，越高越好 | `ComputeIntensity :330-345` |
| 访存量 | `aRatio*baseM*baseK*tA + bRatio*baseK*baseN*tB`（**只算 A、B 两项，源码无 C 项**） | `CalculateMemoryTraffic :2333-2339` |
| 估算 cycle | `CalculateBlockCycles(baseM,baseN,baseK)` | `:2472` |
| double buffer 取舍 | 比 `dbOnPipeTime` vs `dbOffPipeTime`，短者胜 | `GetL0cDB :564-612` |
| iterateOrder | 按 A/B 在 L1 的 reload 次数选 M 优先/N 优先 | `GetIteratorOrder :1980-2011` |

> **关键真空**：代码里**没有一个"给开发者看"的 per-shape 性能反馈**——选择是启发式拍的（full-load vs split、对齐阈值），不是把一条性能曲线摆在开发者面前。也就是说，**开发者在写/调 tiling 时是半盲的**。这正是工具能补、且不与现有代码重复的地方。

## 19. 芯片版本差异：AIC→AIV（L0C→UB）通路

不同芯片不只是 buffer 大小不同，还有结构性的数据通路差异，集中体现在 feature flag `ifSupportL0CToUB`：

| 芯片 | `ifSupportL0CToUB` | Fixpipe | 证据 |
|---|---|---|---|
| 910B（DAV_2201） | **false** | V220 | `asc-devkit-master/impl/adv_api/detail/matmul/feature_trait/matmul_chip_cap.h:104-105` |
| 950（DAV_3510） | **true** | **V310** | `matmul_chip_cap.h:110-111` |

运行时门控：`matmul_feature_trait.h:101-108`（`IsSupportL0CToUB()`）。AIC:AIV = **1:2**（`platform_ascendc.cpp:31` `MIX_AIC_AIV_RATION_910B1=2`，校验 `CalcTschNumBlocks :249-263`）。

它**只在融合算子（matmul + vector epilogue，如 +leakyrelu/+dequant）上有结构性影响**：

- 910B（无 L0C→UB）：中间结果 C 绕 GM —— `Cube: L0C→GM workspace`，`Vector: GM→UB→激活→GM`。需 GM workspace，Vector tile 与 Cube 解耦，代价是 GM 带宽。
- 950（有 L0C→UB）：`Cube: L0C→UB` 直连，`Vector: UB→激活→GM`，不落 GM。**UB 进入约束包络**，Cube 产出 tile 与 Vector 消费 tile 被 UB 耦合（producer/consumer）。

（这与 Part I §8 描述的融合路径是同一件事，此处补上版本依据。）

> 对纯 matmul，950 与 910B 差异极小（仅 btSize）。结构性差异只在融合出现。

## 20. 开发者的起点：一个「安全默认」

开发者不是从空白填 base，起点通常是一个保证合法的默认：

- **matmul / cube 族**：内置自动 tiling 算法。`MatmulApiTiling::GetTiling(TCubeTiling&)` → `Compute()` → `MatmulTilingAlgorithm::Process()`，喂 shape+硬件，自动算出一整套合法 TCubeTiling。
  - 证据：`asc-devkit-master/include/adv_api/matmul/matmul_tiling.h:44`；`asc-devkit-master/impl/adv_api/tiling/matmul/matmul_tiling.cpp:28-38`。
  - 注意：matmul **没有专门的 dynamic 路径、不缓存**，每次 `GetTiling` 从头现算；`full-load vs split` 看实际 M/N/K 决定（`matmul_tiling_algorithm.cpp` 内 "full load" 分支）。
- **自定义 / vector 族**：复制一个结构最像的现成算子当模板（每个算子一个独立 tiling.cpp，骨架一致：读 shape → 算 factor → set key），再改 shape 映射和分支。

> 关键落差：**安全默认只保证"合法（塞得下）"，不保证"快"。** 开发者的真实旅程是「默认能跑 → 发现某些 shape 慢 → 调 base/split/key」。工具的价值就在这段路上。

## 21. 动态 shape 怎么验证、边界怎么找

**外边界是给定的，不是预测的**：`M ∈ [1, max_batch × max_seq]`（serving 启动配置），下界 1（decode），K/N 由 weight 固定。tiling 函数不预测范围，只是「来什么 shape 处理什么」。

**真正难的是范围之内不平滑**，危险都在内部断点：

| 断点 | 危险 | 性质 |
|---|---|---|
| M=1（decode） | 算力强度最低，多半最慢 | 解析可定位 |
| 对齐边缘（非 16/base 倍数） | 出尾块、核用不满 | 解析 |
| 尾块（shape % tile ≠ 0） | 末核/末轮干活少，负载不均 | 解析（`SplitRows` 算 `lastCoreRows = rows % perCore`，`moe_gating_top_k_hash_tiling.cpp:486-498`） |
| tiling key 阈值 | 开发者自己的分支条件造成的断崖 | 解析（就是分支条件本身） |
| full-load → split 翻转 | 超过 L1 整块装下的临界，策略突变 | 解析 |
| 最大 shape | 还塞不塞得下、workspace 够不够 | 解析 |

**当前怎么验证**：一张手工挑选的测试 shape 矩阵 `{1, 几个小的, 对齐的, 故意不对齐/带尾的, 阈值附近, 最大}` + golden 对比（正确性）+ profiler（性能找断崖）。痛点：**这些 shape 全靠开发者手猜**，得提前知道断点在哪才能选中能暴露问题的用例，猜不准就漏测。

> 工具机会：上表里除性能外**全是解析可算的**（fit 判定、对齐、尾块、阈值、full-load 翻转都是整除与不等式）。工具可以沿 M 从 1 扫到 max，**自动标出每个断点**，把「手猜测试 shape」变成「一眼看完整条危险地图」；性能再叠一层半定量 cost model。这就是把「预测动态边界」自动化。

## 22. 由此重构的工具定位（产品结论）

把以上串起来，工具的定位从「切片演示器」改为「**动态 shape 下的 tiling 约束 & 性能决策台**」：

- **输入是「场景」不是「调参」**：开发者给定目标 shape 范围（batch/seq）+ 芯片；`M=batch×seq` 是会变的量，`K/N` 由 weight 固定，硬件由部署固定。这些都是「给定」，不是滑块。
- **起点是「安全默认」**：工具载入自动 tiling 算法 / 模板给出的默认 tiling（和开发者手里拿到的一样），而不是让他从零猜。
- **工具给答案 + 解释**：开发者不知道怎么调才需要工具，所以工具应当**算出/揭示**「该怎么切、为什么、随 shape 怎么变、哪里必须换 tiling key」，而不是当一个只判 fit 的裁判。
- **核心可视化 = 把开发者看不见的那条曲线画出来**：沿 shape（主要是 M）扫描，呈现约束合法区间 + 性能甜点 + 所有断点（§21），让「动态」从抽象变成一张可读的决策地图。

> 一句话：真实开发里，tiling 决策是一条随 shape 变化、带断点的曲线，而开发者手里没有这条曲线。工具就是把它算出来、画出来。

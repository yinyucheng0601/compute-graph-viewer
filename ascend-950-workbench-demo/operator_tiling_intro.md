# Ascend C 算子开发 Tiling 入门

本文面向刚开始写 Ascend C 自定义算子的开发者，基于本机两个仓库中的实际文件说明：哪里有 tiling 代码、tiling 到底解决什么问题、Host 侧和 Kernel 侧各写什么，以及看代码时应该抓住哪些关键点。

## 结论：这两个目录里有 tiling 文件吗

有。

`/Users/yin/gitcode/cann-recipes-infer-master` 里有较多真实算子的 tiling 实现，主要在：

- `ops/ascendc/src/*/op_host/*_tiling.cpp`
- `ops/ascendc/src/*/op_host/*_tiling.h`
- `ops/pypto/src/*/op_host/*_tiling.cpp`

代表文件：

- `cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_host/swiglu_group_quant_tiling.h`
- `cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_host/swiglu_group_quant_tiling.cpp`
- `cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_kernel/swiglu_group_quant.cpp`
- `cann-recipes-infer-master/ops/ascendc/src/inplace_partial_rotary_mul/op_host/inplace_partial_rotary_mul_tiling.h`
- `cann-recipes-infer-master/ops/pypto/src/deepseek_indexer_attention/op_host/deepseek_indexer_attention_tiling.cpp`
- `cann-recipes-infer-master/ops/pypto/src/lightning_indexer_pto/op_host/lightning_indexer_tiling.cpp`

`/Users/yin/gitcode/asc-devkit-master` 里有官方开发套件、API、文档和样例，适合入门：

- `examples/01_simd_cpp_api/02_features/00_compilation/custom_op/op_host/add_custom/add_custom_host.cpp`
- `examples/01_simd_cpp_api/02_features/00_compilation/custom_op/op_kernel/add_custom/add_custom_tiling.h`
- `examples/01_simd_cpp_api/02_features/00_compilation/custom_op/op_kernel/add_custom/add_custom_kernel.cpp`
- `docs/api/Utils-API/Tiling数据结构注册/TilingData结构定义.md`
- `docs/guide/算子实践参考/SIMD算子实现/矢量编程/多核-Tiling切分/多核Tiling.md`
- `impl/adv_api/tiling/*/*_tiling_impl.cpp`
- `include/adv_api/*/*_tiling.h`

建议阅读顺序：先看 `asc-devkit-master` 的 `add_custom`，再看 `cann-recipes-infer-master` 的 `swiglu_group_quant`。

## Tiling 是什么

一句话：tiling 是 Host 侧根据输入 shape、dtype、属性、平台能力和 UB 大小，提前算出 Kernel 侧怎么切数据、用多少核、循环几次、尾块多大、选择哪个 kernel 分支的一组参数。

更具体地说，Kernel 不能每次都在 AICore 上做复杂的 shape 推导和策略搜索。Host 侧 tiling 函数会先完成这些事情：

- 从 `gert::TilingContext` 读取输入输出 shape、dtype、attr、可选输入、平台信息。
- 计算多核切分，例如每个 core 处理多少行、多少元素。
- 计算核内切分，例如每次搬多少数据进 UB、循环多少次、最后一块有多长。
- 计算 UB 内存需求，例如输入队列、输出队列、临时 buffer 是否能放下。
- 设置 `blockDim`，也就是实际启动多少个 AICore。
- 设置 `workspace` 大小。
- 设置 `tilingKey`，让 Kernel 侧选择不同实现分支。
- 把 `TilingData` 序列化到 tiling buffer，Kernel 侧再解析使用。

可以把 tiling 理解成 Kernel 的“执行计划”。Kernel 侧只负责按计划搬入、计算、搬出。

## 最小模型：AddCustom

`asc-devkit-master` 里的 `add_custom` 是最适合入门的例子。

### 1. 定义传给 Kernel 的 TilingData

文件：

`asc-devkit-master/examples/01_simd_cpp_api/02_features/00_compilation/custom_op/op_kernel/add_custom/add_custom_tiling.h`

核心结构：

```cpp
struct AddCustomTilingData {
    uint32_t totalLength;
    uint32_t tileNum;
};
```

这两个字段的含义：

- `totalLength`：总元素数，Kernel 用它计算每个 core 处理多少元素。
- `tileNum`：每个 core 内再切成多少个 tile，用来控制 UB 队列的块大小和循环次数。

### 2. Host 侧计算 tiling

文件：

`asc-devkit-master/examples/01_simd_cpp_api/02_features/00_compilation/custom_op/op_host/add_custom/add_custom_host.cpp`

核心逻辑：

```cpp
static ge::graphStatus TilingFunc(gert::TilingContext *context)
{
    AddCustomTilingData *tiling = context->GetTilingData<AddCustomTilingData>();
    uint32_t totalLength = context->GetInputShape(0)->GetOriginShape().GetShapeSize();
    context->SetBlockDim(NUM_BLOCKS);
    tiling->totalLength = totalLength;
    tiling->tileNum = TILE_NUM;
    size_t *currentWorkspace = context->GetWorkspaceSizes(1);
    currentWorkspace[0] = 0;
    return ge::GRAPH_SUCCESS;
}
```

这里 Host 做了三件事：

- 读输入 shape，得到 `totalLength`。
- 设置启动核数 `SetBlockDim(NUM_BLOCKS)`。
- 把 `totalLength` 和 `tileNum` 写入 tiling 数据。

### 3. Kernel 侧读取 tiling 并执行

文件：

`asc-devkit-master/examples/01_simd_cpp_api/02_features/00_compilation/custom_op/op_kernel/add_custom/add_custom_kernel.cpp`

入口处：

```cpp
extern "C" __global__ __aicore__ void add_custom(
    GM_ADDR x, GM_ADDR y, GM_ADDR z, GM_ADDR workspace, GM_ADDR tiling)
{
    REGISTER_TILING_DEFAULT(AddCustomTilingData);
    GET_TILING_DATA(tilingData, tiling);
    KernelAdd op;
    op.Init(x, y, z, tilingData.totalLength, tilingData.tileNum);
    op.Process();
}
```

Kernel 侧拿到 `tilingData` 后：

- `blockLength = totalLength / GetBlockNum()`，决定当前 core 处理的数据范围。
- `tileLength = blockLength / tileNum / BUFFER_NUM`，决定每次搬入 UB 的长度。
- `GetBlockIdx()` 决定当前 core 的 GM 偏移。
- `Process()` 循环 `tileNum * BUFFER_NUM` 次完成搬入、计算、搬出。

这就是最基础的 tiling 闭环：Host 算参数，Kernel 用参数。

## 真实算子的 Tiling 会多做什么

`cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant` 更接近真实业务算子。

### 1. TilingData 字段更多

文件：

`cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_host/swiglu_group_quant_tiling.h`

里面定义了：

- 输入 shape 相关：`bs`、`d`、`splitD`、`scaleCol`
- 多核切分：`rowOfFormerBlock`、`rowOfTailBlock`、`coreNum`
- 核内循环：`rowLoopOfFormerBlock`、`rowLoopOfTailBlock`、`dLoop`
- 每次处理大小：`rowFactor`、`dFactor`
- 尾块：`tailRowFactorOfFormerBlock`、`tailRowFactorOfTailBlock`、`tailDFactor`
- 属性和模式：`roundScale`、`ue8m0Scale`、`outputOrigin`、`clampValue`
- UB 和可选输入：`ubSize`、`gLoop`、`gFactor`、`tailGFactor`

这说明真实 tiling 不是只算一个 tile 长度，而是把所有会影响 Kernel 分支、循环、尾块和内存分配的东西都提前算好。

### 2. Host 侧流程更完整

文件：

`cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_host/swiglu_group_quant_tiling.cpp`

主要流程：

```cpp
DoOpTiling()
  -> GetPlatformInfo()
  -> GetShapeAttrsInfoInner()
  -> CalcOpTiling()
  -> GetWorkspaceSize()
  -> PostTiling()
  -> SetTilingKey(...)
```

每一步的职责：

- `GetPlatformInfo()`：读取 AIV 核数、UB 大小、SoC 版本。
- `GetShapeAttrsInfoInner()`：读取输入 shape、可选输入和 attr，并做合法性检查。
- `CalcOpTiling()`：按量化模式选择不同 tiling 策略。
- `SetTilingData()`：把计算结果写入 `TilingData`。
- `PostTiling()`：设置 `blockDim`、workspace，并 `SaveToBuffer`。
- `SetTilingKey()`：告诉 Kernel 侧使用哪个分支。

### 3. Kernel 侧用 tilingKey 选择分支

文件：

`cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_kernel/swiglu_group_quant.cpp`

核心逻辑：

```cpp
GET_TILING_DATA(tilingData, tiling);

if (TILING_KEY_IS(GROUP_QUANT_TILING_KEY)) {
    ...
} else if (TILING_KEY_IS(MX_QUANT_TILING_KEY)) {
    ...
} else if (TILING_KEY_IS(FP8_QUANT_TILING_KEY)) {
    ...
} else if (TILING_KEY_IS(FP8_QUANT_YORIGIN_TILING_KEY)) {
    ...
}
```

这类写法很常见：Host 侧根据 attr、dtype、shape 或 SoC 选择一个 `tilingKey`，Kernel 侧用 `TILING_KEY_IS(...)` 进入对应实现。这样可以把多个策略放在一个算子里。

## Host 侧 Tiling 一般怎么写

一个成熟的 Host 侧 tiling 函数通常包含这些步骤。

### 1. 获取上下文信息

常见来源：

- `context->GetInputShape(index)`
- `context->GetDynamicInputShape(group, index)`
- `context->GetInputDesc(index)`
- `context->GetOptionalInputShape(index)`
- `context->GetAttrs()`
- `context->GetPlatformInfo()`
- `platform_ascendc::PlatformAscendC(platformInfo)`

要拿的信息通常是：

- shape：总元素数、最后一维、batch、head、sequence length。
- dtype：每个元素多少字节，是否需要不同 kernel。
- attr：axis、keepdim、quant mode、clamp value 等。
- 平台：core 数、UB 大小、SoC 版本。

### 2. 做合法性检查

常见检查：

- 输入 shape 维度是否符合预期。
- 某些维度是否能被 block size、group size、vector 对齐要求整除。
- 可选输入存在时 shape 是否匹配。
- attr 是否在支持范围内。
- UB 是否足够容纳至少一个最小 tile。

不要把这些检查留到 Kernel 侧。Host 侧报错更清晰，也避免 AICore 侧异常难定位。

### 3. 设计多核切分

最常见的思路：

```cpp
rowOfFormerBlock = CeilDiv(totalRows, coreNum);
usedCoreNums = min(CeilDiv(totalRows, rowOfFormerBlock), coreNum);
rowOfTailBlock = totalRows - (usedCoreNums - 1) * rowOfFormerBlock;
```

含义：

- 前面的 core 每个处理 `rowOfFormerBlock` 行。
- 最后一个有效 core 处理 `rowOfTailBlock` 行。
- `usedCoreNums` 是实际启动核数。

如果数据太少，不一定要启动所有 core。启动过多 core 可能增加调度和尾核浪费。

### 4. 设计核内切分

核内切分主要受 UB 限制。思路是估算每个 tile 需要的 UB 字节数：

```cpp
totalUbBytes =
    input0Bytes +
    input1Bytes +
    outputBytes +
    tempBytes +
    optionalInputBytes;
```

如果 `totalUbBytes <= ubSize`，可以一次处理更大 tile；否则缩小 `rowFactor` 或 `dFactor`，让单次处理的数据放进 UB。

常用字段：

- `rowFactor`：一次处理多少行。
- `dFactor`：一次处理多少列或最后一维多少元素。
- `rowLoop`：一核内按行循环几次。
- `dLoop`：一核内按列循环几次。
- `tailRowFactor`：最后一次行循环处理多少行。
- `tailDFactor`：最后一次列循环处理多少元素。

### 5. 设置输出给运行时和 Kernel

常见操作：

```cpp
context->SetBlockDim(usedCoreNums);

size_t *workspaces = context->GetWorkspaceSizes(1);
workspaces[0] = workspaceSize;

tilingData.SaveToBuffer(
    context->GetRawTilingData()->GetData(),
    context->GetRawTilingData()->GetCapacity());
context->GetRawTilingData()->SetDataSize(tilingData.GetDataSize());

context->SetTilingKey(tilingKey);
```

这些分别控制：

- `SetBlockDim`：Kernel 启动多少个 core。
- `workspace`：额外 GM 临时空间大小。
- `SaveToBuffer`：把 Host 侧算好的结构体序列化给 Kernel。
- `SetDataSize`：告诉运行时 tiling 数据真实长度。
- `SetTilingKey`：让 Kernel 选择实现分支。

## Kernel 侧一般怎么用 Tiling

Kernel 入口一般接收 `GM_ADDR tiling`：

```cpp
extern "C" __global__ __aicore__ void my_op(..., GM_ADDR workspace, GM_ADDR tiling)
{
    GET_TILING_DATA(tilingData, tiling);
    ...
}
```

Kernel 侧使用 tiling 的重点：

- 用 `GetBlockIdx()` 获取当前 core 编号。
- 用 `tilingData` 中的多核切分字段计算当前 core 的 GM 起始偏移。
- 用 `rowLoop`、`dLoop` 控制循环。
- 用 `tail*` 字段处理最后一块。
- 用 `rowFactor`、`dFactor` 初始化 UB 队列或临时 buffer。
- 用 `TILING_KEY_IS(...)` 选择不同模板或类实现。

典型公式：

```cpp
gmOffset = blockIdx * rowOfFormerBlock * stride;
curRowFactor = (rowLoopIdx == rowLoop - 1) ? tailRowFactor : rowFactor;
curDFactor = (dLoopIdx == dLoop - 1) ? tailDFactor : dFactor;
```

理解 Kernel 侧时，不要只看计算 API。先找它如何用 `tilingData` 算偏移、循环次数和 buffer 大小。

## TilingData 两种写法

### 普通 C++ struct

简单样例里会直接写：

```cpp
struct AddCustomTilingData {
    uint32_t totalLength;
    uint32_t tileNum;
};
```

优点是简单直观，适合入门样例。

### 宏定义注册结构

工程化算子里更常见：

```cpp
BEGIN_TILING_DATA_DEF(MyTilingData)
TILING_DATA_FIELD_DEF(uint32_t, totalSize);
TILING_DATA_FIELD_DEF(uint32_t, splitTile);
END_TILING_DATA_DEF;

REGISTER_TILING_DATA_CLASS(MyOp, MyTilingData)
```

这类结构会生成：

- `set_xxx`
- `get_xxx`
- `SaveToBuffer`
- `GetDataSize`

注意约束：

- 需要包含 `register/tilingdata_base.h`。
- 字段类型通常使用固定宽度整数和 `float`，例如 `uint32_t`、`int64_t`。
- 字段要注意字节对齐。
- `TilingData` 结构名是全局标记，不要不同算子复用同名但字段不同的结构。

## 常见字段命名怎么理解

| 字段 | 常见含义 |
| --- | --- |
| `totalLength` / `totalSize` | 总元素数 |
| `blockDim` / `coreNum` / `usedCoreNums` | 使用多少个 AICore |
| `blockLength` | 每个 core 处理的数据量 |
| `tileNum` | 每个 core 内切多少个 tile |
| `tileLength` | 每个 tile 的元素数 |
| `rowFactor` | 每次处理多少行 |
| `dFactor` | 每次处理最后一维多少元素 |
| `rowLoop` / `dLoop` | 核内循环次数 |
| `tailRowFactor` / `tailDFactor` | 最后一块实际大小 |
| `ubSize` | 当前平台 UB 容量 |
| `workspaceSize` | 需要的 GM 临时空间 |
| `tilingKey` | Kernel 分支选择标识 |

## 看一个新算子的 Tiling 文件时怎么入手

按这个顺序读最快：

1. 找 `*_tiling.h`：看 `TilingData` 有哪些字段。
2. 找 `TilingFunc`、`DoOpTiling` 或 `TilingForXxx`：看 Host 侧入口。
3. 找 `GetShape...`：看算子对 shape 的假设。
4. 找 `GetAttr`：看 attr 如何影响策略。
5. 找 `GetPlatformInfo`：看是否依赖 UB、core 数、SoC。
6. 找 `Calc...Tiling`：看核心切分算法。
7. 找 `SetBlockDim`、`SetTilingKey`、`SaveToBuffer`：看最终输出给运行时和 Kernel 的参数。
8. 到 `op_kernel` 里搜 `GET_TILING_DATA`：看 Kernel 如何消费这些字段。
9. 搜 `TILING_KEY_IS`：看不同策略分支对应关系。

## 与可视化结合的初步设计

这个文档可以和 `/Users/yin/pto/ascend-950-workbench-demo` 的现有可视化工作台结合起来，目标不是把 tiling 解释成一篇静态教程，而是把它变成可点、可调、可追溯的执行计划视图。

现有 workbench 已经有三块基础能力：

- 左侧代码行标注：能把 kernel 源码行映射到 memory / compute / control 等角色。
- 右侧硬件路径图：能高亮 GM、L2、MTE、UB、Cube、Vector、Scalar 等硬件路径。
- Inspector V2 区段：已有 `V2 切分分析 · Tiling` 和 `V2 流水线分析 · Pipeline` 容器。

tiling 可视化应该成为这三块之间的桥：从 Host 侧 `TilingFunc` 解释“为什么这样切”，从 Kernel 侧 `GET_TILING_DATA` 解释“这些参数如何驱动真实执行”，最后落到硬件路径和 pipeline 上解释“切分是否合理”。

### 设计目标

面向算子开发者，tiling 可视化要回答五个问题：

1. Host 侧从哪些输入信息推导了 tiling？例如 shape、attr、dtype、SoC、UB 大小。
2. 最终生成了哪些 `TilingData` 字段？每个字段控制 Kernel 的哪部分行为？
3. 当前 workload 被分到多少个 core、多少个 tile、尾核和尾块在哪里？
4. 单个 tile 对 UB / L1 / L0A / L0B / workspace 的压力是否合理？
5. `tilingKey` 选中了哪个 Kernel 分支？这个分支在硬件路径和 pipeline 上有什么后果？

### 认知模型

建议把 tiling 可视化拆成三层数据，而不是直接从源码画图：

```text
源码事实层 Source Facts
  TilingData 字段、TilingFunc 步骤、SetBlockDim、SetTilingKey、SaveToBuffer、GET_TILING_DATA

执行计划层 Execution Plan
  core 切分、tile 形状、循环次数、尾块、片上存储占用、workspace、kernel 分支

可视化状态层 Visualization State
  当前芯片、当前 tier、选中的字段、选中的 tile、compare 模式、hover/click 联动
```

这三层分开后，后续可以先用手工 JSON 驱动 demo，再逐步接入源码解析或编译器输出。

### 可视化模块

| 模块 | 解决的问题 | 主要输入 | 主要输出 |
| --- | --- | --- | --- |
| Tiling Flow | Host 侧 tiling 是怎么生成的 | `TilingFunc` / `DoOpTiling` 步骤 | 从 context 到 Kernel 的流程图 |
| TilingData Map | 每个字段有什么用 | `TilingData` 字段定义和 Kernel 使用点 | 字段表 + 代码行跳转 |
| Core Split | 多核怎么分 | `SetBlockDim`、`rowOfFormerBlock`、`rowOfTailBlock` | core 条带图，标出尾核 |
| Tile Map | 核内怎么切 | `tileLength`、`rowFactor`、`dFactor`、`dLoop` | 1D / 2D / 自定义 tile 图 |
| Memory Budget | 单 tile 是否放得下 | UB / L1 / L0A / L0B 字节估算 | 片上存储占用条和超限警告 |
| TilingKey Branch | 为什么走这个分支 | `SetTilingKey` 和 `TILING_KEY_IS` | 分支选择图 + Kernel 分支高亮 |
| Pipeline Link | 切分如何影响流水 | tile 数、double buffer、MTE/compute 周期 | 泳道图和 bubble 原因 |

现有 `index.html` 里的 `tilingModel()` 已经在做一部分事情：根据 kernel 和 chip 返回 `layout`、`shape`、`count`、`memory`、`doubleBuffer`，并渲染到 `tilingPanel`。下一步应把这些硬编码模型升级为“从 tiling 执行计划对象渲染”。

静态 HTML 预览页：`tiling-execution-plan.html`。

新手可播放 910B 对照页：`tiling-playable-910b.html`。这页把 910B 架构 pattern、逻辑 tile map、UB buffer residency 和 kernel loop 同步播放，专门解释“tile 格子为什么不等于 buffer 格子”。

### 数据契约草案

MVP 可以在每个 `kernels/*.js` 文件中补一个 `tilingPlan` 字段。先手工维护，后续再由解析器生成。

```js
{
  id: "swiglu_group_quant",
  tilingPlan: {
    source: {
      hostFile: "op_host/swiglu_group_quant_tiling.cpp",
      kernelFile: "op_kernel/swiglu_group_quant.cpp",
      entry: "TilingForSwigluGroupQuant",
      kernelEntry: "swiglu_group_quant"
    },
    inputs: {
      shape: ["bs", "d", "splitD", "scaleCol"],
      attrs: ["quantMode", "roundScale", "outputOrigin", "clampValue"],
      platform: ["coreNum", "ubSize", "socVersion"]
    },
    fields: [
      { name: "coreNum", role: "core-count", visual: "core-split" },
      { name: "rowFactor", role: "tile-row-size", visual: "tile-map" },
      { name: "dFactor", role: "tile-col-size", visual: "tile-map" },
      { name: "tailDFactor", role: "tail", visual: "tile-map" },
      { name: "ubSize", role: "capacity", visual: "memory-budget" }
    ],
    split: {
      layout: "2D",
      axes: [
        { name: "B/S rows", sizeExpr: "bs", tileExpr: "rowFactor", tailExpr: "tailRowFactorOfTailBlock" },
        { name: "D", sizeExpr: "splitD", tileExpr: "dFactor", tailExpr: "tailDFactor" }
      ],
      blockDimExpr: "usedCoreNums",
      doubleBuffer: "enabled"
    },
    memory: [
      { region: "UB", usedBytesExpr: "sum(input queues + output queues + temp buffers)", capacityExpr: "ubSize" },
      { region: "workspace", usedBytesExpr: "workspaceSize", capacityExpr: "runtime allocated" }
    ],
    branches: [
      { key: 1, label: "GROUP_QUANT", condition: "quantMode == STATIC_QUANT" },
      { key: 2, label: "MX_QUANT", condition: "quantMode == MX_QUANT" },
      { key: 31, label: "FP8_QUANT", condition: "quantMode == FP8_QUANT && !outputOrigin" },
      { key: 32, label: "FP8_QUANT_YORIGIN", condition: "quantMode == FP8_QUANT && outputOrigin" }
    ]
  }
}
```

关键点：字段不要只存展示文案，要保留 `expr` 或 `sourceLine`。这样点击可视化元素时，才能回跳到源码里的 `set_xxx`、`SetBlockDim`、`TILING_KEY_IS`。

### 交互联动

| 用户动作 | 左侧源码 | 中间 tiling 图 | 右侧硬件 / Inspector |
| --- | --- | --- | --- |
| 点击 `rowFactor` 字段 | 高亮 `set_rowFactor` 和 Kernel 使用点 | 高亮 tile 的行切分 | Memory Budget 刷新 UB 占用 |
| 点击 `SetBlockDim` | 高亮 Host 设置行 | 高亮 core 条带图 | 硬件图高亮参与的 AIC/AIV core |
| 点击尾块 | 高亮 `tail*` 字段 | 高亮尾核 / 尾 tile | Recommendations 给出对齐建议 |
| 切换 `tilingKey` | 高亮 Host 条件分支 | 分支图切换 active path | Kernel 分支和 pipeline 同步切换 |
| 调整主切分 slider | 源码保持不变，显示参数覆盖态 | tile map 实时重排 | Cycle、Pipeline、建议同步刷新 |

### 初步 Wireframe

```text
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Ascend 950 Workbench · Operator Tiling Explorer                                    │
│ Kernel: swiglu_group_quant   Chip: 950 / 910B / Compare   Tier: T1 / T2 / T3       │
└────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┬───────────────────────────────────┬─────────────────┐
│ Source & Anchors             │ Tiling Execution Plan              │ Inspector        │
│                              │                                   │                 │
│ op_host/*_tiling.cpp         │  Host Context                      │ Summary         │
│  470 set_bs                  │   shape / attrs / platform         │  blockDim: 40    │
│  478 set_rowFactor  ◄──────┐ │        │                          │  tile: row × d   │
│  483 set_tailDFactor       │ │        ▼                          │  key: FP8        │
│  537 SetTilingKey          │ │  CalcOpTiling                     │                 │
│  566 SetBlockDim           │ │        │                          │ Memory Budget    │
│  567 SaveToBuffer          │ │        ▼                          │  UB     ███░ 62% │
│                              │  TilingData Fields                 │  L1     ██░░ 42% │
│ op_kernel/*.cpp              │   coreNum rowFactor dFactor tail  │  WS     ░░░ 32B  │
│   GET_TILING_DATA            │        │                          │                 │
│   TILING_KEY_IS(31)          │        ▼                          │ Warnings         │
│                              │  Core Split                        │  tail D unaligned│
│ [click field -> code line]   │  C0 C1 C2 C3 ... C39 tail          │                 │
├──────────────────────────────┤        │                          ├─────────────────┤
│ Field Detail                 │        ▼                          │ Recommendations │
│ rowFactor                    │  Tile Map                          │  try dFactor 128 │
│ role: tile-row-size          │  ┌──┬──┬──┬──┬tail┐                │  enable DB       │
│ set at: tiling.cpp:478       │  ├──┼──┼──┼──┼────┤                │                 │
│ used at: perf.h:121          │  └──┴──┴──┴──┴────┘                │ Evidence         │
└──────────────────────────────┴───────────────────────────────────┴─────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│ Pipeline Preview                                                                    │
│ MTE2    ███░░███░░███░░                                                             │
│ MTE1    ░███░░███░░███                                                              │
│ Vector  ░░░████████░░░                                                              │
│               ▲ bubble: waiting input tile                                          │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### 更细的面板布局

```text
Tiling Execution Plan
├─ Flow Strip
│  Context -> Shape/Attr/Platform -> Calc -> SaveToBuffer -> GET_TILING_DATA
├─ Core Split
│  [core 0][core 1][core 2] ... [tail core]
├─ Tile Map
│  1D vector: block axis
│  2D matrix: M/N or row/D axes
│  custom: deepseek indexer attention 这类复合路径
├─ Memory Budget
│  UB queue + temp + output + double buffer
└─ Branch Selector
   tilingKey -> Kernel implementation branch
```

### 与现有 demo 的落地关系

短期不要新增一个独立页面，优先扩展现有 Inspector V2：

1. 保留现有 `V2 切分分析 · Tiling` 区段，改为消费 `tilingPlan`。
2. 在代码视图中给 `TilingData` 字段、`SetBlockDim`、`SetTilingKey`、`GET_TILING_DATA` 增加锚点。
3. 点击 tiling 图里的字段时，左侧滚动到源码锚点，右侧硬件图高亮相关路径。
4. 在 `Pipeline` 区段里复用 tile 数、double buffer、MTE 阶段估算，说明切分对 bubble 的影响。
5. Compare 模式下并排展示 950 / 910B 的 tile 图和 memory budget，突出“为什么 950 能换更大 tile 或更少 staging”。

### MVP 分期

| 阶段 | 范围 | 实现方式 |
| --- | --- | --- |
| M0 静态说明 | 本文档内补 wireframe 和数据契约 | Markdown |
| M1 手工模型 | 给 2-3 个 kernel 手写 `tilingPlan` | `kernels/*.js` |
| M2 UI 联动 | `tilingPanel` 从 `tilingPlan` 渲染，字段可点击 | 扩展 `index.html` |
| M3 证据回跳 | 字段、branch、tail 能跳到源码行 | 增加 source anchors |
| M4 半自动解析 | 从 `*_tiling.h/cpp` 抽取字段和入口 | 本地脚本或编译产物 |
| M5 Profile 对齐 | 用 T3 profile 校正 pipeline 和 memory 估算 | profile 数据接入 |

M1 阶段的验收标准很简单：用户点击 `rowFactor`、`dFactor`、`tilingKey` 时，能同时看见源码位置、tile 图变化、Kernel 分支和优化建议，而不是只看到一个孤立的字段解释。

## 写自己的 Tiling 时的最小清单

开发一个新算子时，至少确认这些问题：

- 输入输出 shape 是否都能从 `TilingContext` 拿到？
- 动态 shape 下哪些维度会影响切分？
- 每个元素的 dtype size 是多少？
- 需要几个 core？数据少时是否减少 core？
- 每个 core 处理多少数据？
- UB 中需要同时放哪些输入、输出、临时 buffer？
- 单 tile 字节数是否小于 UB？
- 是否有尾核、尾行、尾列、尾 tile？
- Kernel 是否需要不同实现分支？如果需要，定义 `tilingKey`。
- 是否需要 workspace？
- `TilingData` 字段是否够用，字段类型和对齐是否合理？
- Host 侧是否调用了 `SetBlockDim`、`SaveToBuffer`、`SetDataSize`？
- Kernel 侧是否正确读取 `GET_TILING_DATA`？
- Kernel 侧所有 GM 偏移是否使用了 `GetBlockIdx()` 和 tail 字段？

## 常见坑

- 只按整除场景写，忘记尾块。真实输入通常不会刚好整除 core 数或 tile 大小。
- `SetBlockDim` 和 Kernel 内 `GetBlockNum()` 假设不一致。
- Host 侧算了字段，但 Kernel 侧实际没用，或者字段含义不一致。
- UB 估算漏了 double buffer、临时张量、对齐后的大小。
- `TilingData` 字段顺序或类型变了，但 Kernel 侧仍按旧结构解析。
- 复杂算子忘记设置 `SetDataSize(tilingData.GetDataSize())`。
- `tilingKey` Host 侧设置值和 Kernel 侧 `TILING_KEY_IS` 常量不一致。
- 可选输入为空时没有兜底，导致 Host 侧访问空指针。
- 用所有 core 处理很小数据，反而造成尾核浪费。

## 推荐本机阅读路径

入门：

1. `asc-devkit-master/examples/01_simd_cpp_api/02_features/00_compilation/custom_op/op_kernel/add_custom/add_custom_tiling.h`
2. `asc-devkit-master/examples/01_simd_cpp_api/02_features/00_compilation/custom_op/op_host/add_custom/add_custom_host.cpp`
3. `asc-devkit-master/examples/01_simd_cpp_api/02_features/00_compilation/custom_op/op_kernel/add_custom/add_custom_kernel.cpp`

理解宏定义 TilingData：

1. `asc-devkit-master/docs/api/Utils-API/Tiling数据结构注册/TilingData结构定义.md`
2. `asc-devkit-master/docs/guide/编程指南/高级编程/高级特性/Aclnn算子工程化开发/Host侧Tiling实现/通过TilingData传递属性信息.md`

理解多核和尾块：

1. `asc-devkit-master/docs/guide/算子实践参考/SIMD算子实现/矢量编程/多核-Tiling切分/多核Tiling.md`
2. `asc-devkit-master/docs/guide/算子实践参考/SIMD算子实现/矢量编程/多核-Tiling切分/尾核Tiling.md`
3. `asc-devkit-master/docs/guide/算子实践参考/SIMD算子实现/矢量编程/多核-Tiling切分/尾块Tiling.md`

看真实业务算子：

1. `cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_host/swiglu_group_quant_tiling.h`
2. `cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_host/swiglu_group_quant_tiling.cpp`
3. `cann-recipes-infer-master/ops/ascendc/src/swiglu_group_quant/op_kernel/swiglu_group_quant.cpp`
4. `cann-recipes-infer-master/ops/ascendc/src/inplace_partial_rotary_mul/op_host/inplace_partial_rotary_mul_tiling.h`

看 PyPTO / Tile framework 风格：

1. `cann-recipes-infer-master/ops/pypto/src/deepseek_indexer_attention/op_host/deepseek_indexer_attention_tiling.cpp`
2. `cann-recipes-infer-master/ops/pypto/src/lightning_indexer_pto/op_host/lightning_indexer_tiling.cpp`

## 一句话总结

算子开发里，tiling 不是“把矩阵切块”这么窄的概念，而是 Host 侧为 Kernel 生成执行计划：切多少核、每核多少数据、UB 一次放多少、尾块怎么处理、workspace 多大、走哪个 kernel 分支。读懂 tiling，基本就读懂了一个 Ascend C 算子的性能策略和动态 shape 支撑方式。

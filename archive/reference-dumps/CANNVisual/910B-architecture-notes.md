# Ascend 910B / CANN 910B 架构图学习笔记

## 0. 这张图对应的官方架构范围

先给结论：你这张 `910B` 架构图，按官方文档体系，应该归到 **Ascend 910B 对应的 Atlas A2 训练/推理系列产品**，其 AI Core 属于 **分离架构**，并落在 **NPU_ARCH 220x** 这一类架构说明中。

官方依据：

- 华为在“昇腾产品形态说明”里明确把 **Ascend 910B** 归到 **Atlas A2 训练系列产品** 和 **Atlas A2 推理系列产品**。[来源](https://www.hiascend.com/document/detail/zh/AscendFAQ/ProduTech/productform/hardwaredesc_0001.html)
- CANN 在 “基本架构” 和 “NPU 架构版本 220” 里明确说明：**Atlas A2 训练系列产品 / Atlas A2 推理系列产品** 使用的是 **AIC + AIV 分离模式**。[基本架构](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/850alpha001/opdevg/Ascendcopdevg/atlas_ascendc_10_0008.html) / [NPU_ARCH 220](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/850alpha001/opdevg/Ascendcopdevg/atlas_ascendc_10_0011.html)

因此，下面的解释都以 **Ascend 910B = Atlas A2 系列 = 分离架构 = NPU_ARCH 220x** 为前提。

## 1. 先看总图：这张图到底在表达什么

这不是芯片版图意义上的 die floorplan，而是 **程序员可见的“架构/数据流视图”**。它主要表达四件事：

1. **计算单元分工**
   - AIC 负责矩阵计算，也就是 `Cube` 路径。
   - AIV 负责向量计算，也就是 `Vector` 路径。
   - 两边各自都有 `Scalar`，负责发指令、做流程控制、算地址、做同步。

2. **存储分层**
   - 最外层是 `Global Memory (GM)`。
   - GM 访问路径通常会经过 `L2 Cache`。
   - AIC 内部有适配矩阵计算的数据层次：`L1 -> L0A/L0B/L0C + BT/FP`。
   - AIV 内部有适配向量计算的数据层次：`UB (Unified Buffer)`。

3. **数据搬运引擎**
   - `MTE1 / MTE2 / MTE3 / FixPipe` 不是计算单元，而是 **搬运与格式处理单元**。
   - 它们负责把数据送到正确的 Buffer，再把结果送回去。

4. **控制流和数据流分离**
   - 数据按照箭头在 GM/L2/各 Buffer/计算单元间流动。
   - 指令先到 `ICache`，由 `Scalar` 分类后分别发往 `Cube`、`Vector`、`MTE1/2/3`、`FixPipe` 等执行序列。

## 2. 图中每个元素的定义

### 2.1 Global Memory

- 核外全局显存，是 AIC/AIV 都可见的外部主存。
- 程序中的输入张量、输出张量、代码段、标量数据段，本质上都要落到 GM。
- 官方还说明：通过搬运单元读写 GM 的数据，默认会被 `L2 Cache` 缓存。

## 2.2 L2 Cache

- 位于核外、靠近 GM 的缓存层。
- 官方文档把它描述为对访问 GM 的数据做缓存，以提升访问效率。
- 它既服务数据访问，也服务 `Scalar` 对代码段和数据段的访问。

## 2.3 AIC

- `AI Cube` 核，也就是矩阵计算核。
- 它包含自己的 `Scalar`、自己的内部存储层次和矩阵搬运/执行流水。
- 核心职责是把矩阵算子高效映射到 `Cube` 执行。

### 2.4 AIV

- `AI Vector` 核，也就是向量计算核。
- 它也有独立 `Scalar` 和独立的代码段加载能力。
- 核心职责是做向量类、逐元素类、归约类、后处理类运算。

### 2.5 Scalar

- 官方把它定义为“像一个小 CPU”。
- 主要职责不是大规模数值计算，而是：
  - 发射指令
  - 计算地址和参数
  - 循环控制、分支判断
  - 控制各执行单元之间的同步
- AIC 和 AIV **各有一个独立 Scalar**。

### 2.6 L1 Buffer

- AIC 内较大的一块通用内部中转区。
- 主要作用是缓存矩阵路径里需要反复复用的数据，减少频繁去 GM 取数。
- 在 910B 这类分离架构中，它是 Cube 计算链路里非常关键的 staging buffer。

### 2.7 L0A Buffer / L0B Buffer

- `Cube` 指令输入缓冲区。
- 从官方定义看：
  - `L0A` 放左矩阵
  - `L0B` 放右矩阵
- 推荐使用的分形格式分别是：
  - `L0A: FRACTAL_ZZ`
  - `L0B: FRACTAL_ZN`

### 2.8 L0C Buffer

- `Cube` 指令输出缓冲区。
- 对矩阵乘来说，它保存结果；做累加类计算时，也可能继续作为输入的一部分。
- 推荐格式是 `FRACTAL_NZ`。

### 2.9 BT Buffer

- `BiasTable Buffer`。
- 用来存放矩阵计算中的 `Bias`。
- 它属于 AIC 的矩阵计算配套存储，而不是通用向量存储。

### 2.10 FP Buffer

- `Fixpipe Buffer`。
- 官方定义里用于存放量化参数、Relu 参数等。
- 它服务于 `FixPipe` 这条后处理/格式处理流水。

### 2.11 Unified Buffer

- AIV 的统一缓冲区，通常简称 `UB`。
- 官方定义是：**向量和标量计算的输入和输出**。
- `Vector` 的源和目的数据都要求在 UB 中。

### 2.12 Cube

- 矩阵计算单元。
- 官方给的例子是：以 `float16` 为例，一次可完成两个 `16x16` 矩阵乘法操作。
- 它只直接面向 `L0A / L0B / L0C` 这组矩阵专用存储。

### 2.13 Vector

- 向量计算单元。
- 类似 SIMD，适合逐元素运算、向量加减乘、向量后处理等。
- 所有输入输出都围绕 `UB` 组织。

### 2.14 指令序列

- 不是数据 Buffer，而是各类执行单元各自的 **指令队列/流水序列**。
- 官方明确写到：非 Scalar 指令会被 Scalar 分类到不同序列，例如 `Vector`、`Cube`、`MTE1/2/3` 等。
- 同一序列内部顺序执行，不同序列之间可以并行。

## 3. 各元素之间的运作关系

## 3.1 910B 的核心原则：矩阵和向量是分核跑的

这是理解整张图最重要的一点。

官方在 `NPU_ARCH 220` 中明确说：

- AI Core 在这个架构里分成 **AIC** 和 **AIV** 两个独立核。
- AIC 用于矩阵计算。
- AIV 用于向量计算。
- 两边 **各有自己的 Scalar**。
- **AIV 与 AIC 之间通过 Global Memory 进行数据传递**。

这意味着：

- AIC 算完结果，不能像同核耦合架构那样直接“顺手”给 Vector。
- 如果后续需要向量后处理，通常需要先把结果写回 `GM`，再由 AIV 从 `GM` 搬到 `UB` 继续算。

## 3.2 AIC 典型数据流

官方给出的典型路径是：

- `GM -> L1 -> L0A/L0B -> Cube -> L0C -> FixPipe -> GM`
- `GM -> L1 -> L0A/L0B -> Cube -> L0C -> FixPipe -> L1`

可以把它理解成：

1. `MTE2` 从 `GM` 把矩阵数据搬到 `L1`，有些场景也可直接进 `L0A/L0B`。
2. `MTE1` 再把数据从 `L1` 送进 `L0A/L0B`，并按 Cube 需要的格式排布。
3. `Cube` 执行矩阵乘/张量计算，把结果写到 `L0C`。
4. `FixPipe` 把 `L0C` 中的结果搬回 `GM` 或回写到 `L1`，同时可顺带做格式/类型转换。
5. 若需要 Bias、量化参数、激活参数，则分别通过 `BT Buffer`、`FP Buffer` 参与后续处理。

## 3.3 AIV 典型数据流

官方给出的典型路径是：

- `GM -> UB -> Vector -> UB -> GM`

即：

1. `MTE2` 把数据从 `GM` 搬到 `UB`。
2. `Vector` 在 `UB` 上直接完成向量运算。
3. `MTE3` 再把结果从 `UB` 写回 `GM`。

## 3.4 Scalar 与各执行单元的关系

`Scalar` 是整个流水的控制中枢：

- 它自己执行标量 ALU、循环和分支。
- 它把非标量指令分发到不同的执行队列。
- 它通过 `PipeBarrier`、`SetFlag/WaitFlag` 等机制控制跨流水同步。

因此，图里 `Scalar` 和右侧“指令序列”的关系，本质上是在表达：

- `Scalar` 不等于所有计算本身。
- `Scalar` 更像“调度者 + 控制器”。

## 4. 物理硬件排布关系：应该怎么理解

这里要非常谨慎。

官方文档并 **没有** 把这张图定义成芯片版图，也没有公开到 “某个模块在 die 上具体位于左上角/右下角” 这种物理 floorplan 粒度。所以如果说“物理排布关系”，更稳妥的理解应当是：

## 4.1 官方明确给出的“硬件分区关系”

1. **GM 和 L2 Cache 在核外**
   - 从图和文档描述都能看出来，`GM` 和 `L2 Cache` 不属于 AIC/AIV 内部局部存储。

2. **AIC 与 AIV 是两个独立核**
   - 这是 910B 最关键的物理/逻辑分区。
   - 每个核有自己独立的 `Scalar`，能独立加载代码段。

3. **AIC 内是矩阵专用存储层次**
   - `L1`
   - `L0A/L0B/L0C`
   - `BT/FP`
   - `Cube`

4. **AIV 内是向量专用存储层次**
   - `UB`
   - `Vector`

5. **AIC 和 AIV 之间没有文档公开的直接片上共享 Buffer**
   - 官方对 `NPU_ARCH 220` 的表述是：**AIV 与 AIC 之间通过 GM 进行数据传递**。

## 4.2 更准确地说，这是“程序员可见的逻辑物理关系”

如果你从算子开发视角理解“物理关系”，可以记成下面这张脑图：

- 核外：`GM`、`L2 Cache`
- AIC 内：`Scalar + ICache/DCache + L1 + L0A/L0B/L0C + BT/FP + Cube + MTE/FixPipe`
- AIV 内：`Scalar + ICache/DCache + UB + Vector + MTE`

这个层次结构比“图上谁在左谁在右”更重要，因为它直接决定：

- 哪些单元能直接互访
- 哪些单元必须经由搬运引擎
- 哪些结果必须先回 GM 再交给另一侧核

## 4.3 系统级“物理链路”补充

官方在 `NPU_ARCH 220` 中还明确提到：

- 对于 Atlas A2 训练/推理系列，跨卡数据搬运只支持 **HCCS 物理链路**。

这个信息属于 **卡间/设备间物理互联**，不是图里单个 AI Core 内部模块的排布，但如果你后面要继续写多卡并行、跨卡通信，这一点很重要。

## 5. MTE 的类型和功能

这是这张图里最容易画出来、最容易看混的一组。

官方定义如下。

### 5.1 MTE1

职责：

- `L1 -> L0A/L0B`
- `L1 -> BT Buffer`

理解：

- 它主要负责 **AIC 内部深层存储到矩阵执行输入层** 的搬运。
- 重点是把适合复用的数据从 `L1` 送到 Cube 直接可用的位置。

### 5.2 MTE2

职责：

- `GM -> {L1, L0A/L0B}`
- `GM -> UB`

理解：

- 它是最主要的 **“从核外搬进核内”** 的入口搬运引擎。
- 对 AIC 来说，它把矩阵数据从 GM 搬进 `L1` 或 `L0A/L0B`。
- 对 AIV 来说，它把向量数据从 GM 搬进 `UB`。
- 官方特别强调：按 `Cache Line` 或分形大小对齐搬运，性能更好。

### 5.3 MTE3

职责：

- `UB -> GM`

理解：

- 它主要是 AIV 向量路径的“出核回写”单元。
- 即向量计算做完以后，把 `UB` 的结果写回 `GM`。

### 5.4 FixPipe

职责：

- `L0C -> {GM / L1}`
- `L1 -> FP Buffer`
- 搬运过程中可以完成随路数据格式/类型转换

理解：

- `FixPipe` 虽然在图里也像一条搬运链路，但它比普通 MTE 更像 **带后处理能力的结果出流水**。
- 它常和矩阵结果输出绑定出现：
  - 做类型转换
  - 做量化/反量化相关参数处理
  - 搬到 `GM` 或暂回 `L1`

### 5.5 一个好记的总结

- `MTE2`：外面搬进来
- `MTE1`：AIC 内再下沉到 Cube 输入层
- `MTE3`：AIV 算完搬出去
- `FixPipe`：AIC 结果后处理后搬出去

## 6. 为什么图里会同时有“数据流”和“指令流”

因为在 Ascend C / AI Core 语义里，**数据流** 和 **控制流** 是分开的。

### 6.1 数据流

关心的是数据在哪些 Buffer 之间移动，以及最后在哪个计算单元上执行。

### 6.2 指令流

关心的是：

- 指令从 GM 到 ICache
- `Scalar` 如何分类
- `Cube/Vector/MTE/FixPipe` 这些执行单元如何并行

因此图里的菱形“指令序列”不是数据 Buffer，而是 **执行队列抽象**。

## 7. 读这张 910B 架构图时最值得记住的几点

1. **910B 对应 A2 系列，属于分离架构。**
2. **AIC 管矩阵，AIV 管向量。**
3. **AIC 和 AIV 各有独立 Scalar。**
4. **AIC 与 AIV 之间默认通过 GM 交换数据，不是直接共享一个计算 Buffer。**
5. **Cube 路径看 `L1/L0A/L0B/L0C/BT/FP/FixPipe`。**
6. **Vector 路径看 `UB/MTE2/MTE3/Vector`。**
7. **MTE 是搬运引擎，不是计算核心。**
8. **FixPipe 是矩阵结果出流水上的后处理/格式转换关键单元。**

## 8. 一句话版理解

如果只用一句话概括 910B 这张图：

> 它展示的是 Ascend 910B 在 A2 分离架构下，如何把矩阵计算和向量计算拆到两个独立核上，并通过多级 Buffer、MTE 和 FixPipe 把 GM 中的数据高效送入计算单元，再把结果按控制流水写回 GM。

## 9. 参考资料

1. 昇腾产品形态说明（确认 910B 对应 Atlas A2 训练/推理系列）  
   https://www.hiascend.com/document/detail/zh/AscendFAQ/ProduTech/productform/hardwaredesc_0001.html

2. 基本架构（AIC/AIV、工作模式、存储单元、搬运单元、典型数据流/指令流）  
   https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/850alpha001/opdevg/Ascendcopdevg/atlas_ascendc_10_0008.html

3. NPU 架构版本 220（A2/910B 所属架构，AIC/AIV 分离、存储对齐、推荐格式）  
   https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/850alpha001/opdevg/Ascendcopdevg/atlas_ascendc_10_0011.html

4. GetSubBlockNum（分离架构下 AIC/AIV 数量关系接口说明）  
   https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/83RC1alpha002/API/ascendcopapi/atlasascendc_api_07_0280.html

5. GetTaskRatio（分离架构下 AIC/AIV 比例接口说明）  
   https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/850/API/ascendcopapi/atlasascendc_api_07_0188.html

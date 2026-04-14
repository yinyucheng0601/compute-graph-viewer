# Ascend 950 架构相关资料提取笔记

整理时间：2026-04-10

资料来源目录：

- `events/meetup/slides/950/20260316/面向新一代硬件，CANN技术架构的变与不变.pdf`
- `events/meetup/slides/950/20260320/探索Ascend 950的性能天花板.pdf`
- `events/meetup/slides/950/20260324/HCCL集合通信专用引擎CCU技术介绍.pdf`
- `events/meetup/slides/950/20260326/PTO ISA教你如何快速上手昇腾950.pdf`

说明：

- 这份笔记只保留和 `芯片架构`、`模块`、`互联`、`存储` 相关的信息。
- 内容来自 PDF 文本提取，个别术语可能受原始排版影响，但关键结论是稳定的。

## 1. Ascend 950 总体架构

最直接的总览来自 `面向新一代硬件，CANN技术架构的变与不变.pdf`。

### 1.1 芯片形态

第 2 页给出的信息：

- Ascend 950PR：中等算力/带宽，低成本
- Ascend 950DT：高算力/带宽，中等成本
- 采用 `多 DIE 合封`
- 组合形式包含 `计算 DIE` 和 `IO DIE`
- 强调 `D2D 大带宽`
- 提到 `双 DIE UMA`，目标是提升易用性

第 10 页进一步说明：

- Ascend 950 从上一代的 `2Die` 走向 `4Die`
- `Compute` 与 `IO` 进行了切割
- 页面文本可见 `Compute Die 16 AICore`
- 页面文本可见多个 `IO Die 36 Lane 9Ports`

基于这两页，可以得到的结构性结论：

- 950 不是单片单功能分布，而是明显的 `chiplet / 多 die` 方案
- 计算和 IO 进行了更明确的职责分离
- die 之间互联带宽是这一代设计重点之一

### 1.2 总体模块

第 3 页给出了一张很关键的架构页，文本里明确出现：

- `L2 Cache`
- `L3 Cache`
- `NOC`
- `IO Subsys`
- `TS Subsys`
- `DVPP Cluster`
- `DaVinci AI Core`
- `HiBL * 2 or HiZQ * 1`

按这页可把 950 关键模块粗分为：

- 计算模块：`DaVinci AI Core`
- 片上互联模块：`NOC`
- 缓存模块：`L2 Cache`、`L3 Cache`
- IO 子系统：`IO Subsys`
- 媒体/专项模块：`DVPP Cluster`
- 任务/时序相关子系统：`TS Subsys`
- 高速互联接口：`HiBL / HiZQ`

## 2. 微架构与计算单元变化

### 2.1 950 微架构变化

`面向新一代硬件，CANN技术架构的变与不变.pdf` 第 4 页：

- 标题直接是 `Ascend 950 微架构框图`
- `Cube MMAD` 支持的数据类型进一步扩展
- 相比 910B/910C 的主要数据通道变化：
- 增加 `L0C -> UBuffer` 数据通路
- 增加 `UBuffer -> L1` 数据通路
- 增加 `SSBuf`，支持不同单元之间的消息通路

这几条和存储层次关系非常直接，说明 950 在局部 buffer 之间增加了更多直连路径，减少绕行。

### 2.2 Vector / Cube 方向

同一份资料的第 5 页、第 8 页：

- `Vector` 单元保留了对离散访问更友好的路径
- 提到 `DCache`
- `SIMD-Regbase` 架构强调寄存器内计算，减少对 local buffer 的访问带宽需求
- 通过 OOO 和双发提高 Vector 性能

`探索Ascend 950的性能天花板.pdf` 第 5 页补充：

- `Cube 单 die 核数` 相比上一代增加
- `Cube vs Vector` 算力比持续提升
- `Cube L0C buffer` 相比上一代翻倍
- 新增低比特格式，包括 `HiFP8`、`MXFP8/4`、`FP8`
- 950DT 的 `片上内存访存带宽` 和内存容量较上一代增加
- `Sector Cache` 持续优化

这说明 950 的核心增强点不是单点提频，而是：

- 计算核配置增强
- L0C / UB / L1 等近核存储路径增强
- cache 和片上内存带宽配套增强

## 3. 存储层次与数据通路

### 3.1 明确可见的存储层

几份资料中明确出现的存储和缓冲层包括：

- `GM`
- `L0C`
- `L1`
- `UBuffer / UB`
- `L2 Cache`
- `L3 Cache`
- `DCache`
- `片上 buffer`
- `Memory Slice (MS)`

### 3.2 950 的存储优化重点

`面向新一代硬件，CANN技术架构的变与不变.pdf`：

- 950 新增 `L0C -> UBuffer`
- 950 新增 `UBuffer -> L1`
- 说明片上局部存储间的数据流转被专门增强

`探索Ascend 950的性能天花板.pdf` 第 6 页：

- 为了提升 `Cube` 算子效率，重点讨论 `L2 Cache` 命中率
- 旧方案的问题是 L2 命中率低，首次 MMAD 计算时综合带宽供应不足
- 新方案通过 `Sliding Window Adaptive Tiling` 改善带宽供给和 L2 命中率

第 8 页、第 11 页、第 12 页继续体现：

- 量化场景会专门设计 `scaleFactor` 缓存
- `Double Buffer` 用于掩盖 latency
- 核内 tiling 明确围绕 `UB` 容量和 `regbase` 特性展开

可以归纳为：

- 950 的性能关键瓶颈仍然是 `算力` 与 `局部存储/片上带宽` 的匹配
- cache 命中率和 UB/L0/L1 的组织方式，是高性能算子调优的核心

## 4. 互联与通信路径

### 4.1 DIE 间互联

`面向新一代硬件，CANN技术架构的变与不变.pdf` 第 2 页：

- 直接写到 `D2D 大带宽`
- 结合多 die 合封和双 die UMA，可以确认 die 间高速互联是 950 平台的重要设计点

### 4.2 片上互联

第 3 页中明确出现 `NOC`。

这说明：

- 950 内部模块连接不是简单总线形态
- 片上网络承担计算核心、缓存、IO 子系统之间的互联角色

### 4.3 高速 IO / 外部互联

第 3 页出现：

- `HiBL * 2 or HiZQ * 1`

第 10 页出现：

- `IO Die 36 Lane 9Ports`

虽然提取文本没有完整注释，但已经足以说明：

- 950 的 IO die 承担高速端口与 lane 组织
- 外部互联能力在物理上独立出来，不再混在 compute die 中

## 5. CCU：950 上最重要的专项互联/通信模块

`HCCL集合通信专用引擎CCU技术介绍.pdf` 对互联和通信通路最有价值。

### 5.1 CCU 设计目标

第 4 页给出的原意很明确：

- 利用 `CCU 片上 buffer` 缓存通信数据，降低访存带宽需求
- 利用 `片上 buffer + 内置计算单元` 做 Reduce，确保保序
- 使用专用通信调度与同步机制，降低时延
- 减少用户 buffer 到 CCL buffer 的拷贝

这意味着 CCU 本质上是：

- 从通用计算核中剥离出来的 `专用通信引擎`
- 不只是 DMA，而是带有片上存储和规约执行能力的集合通信模块

### 5.2 CCU 的片上资源

第 6 页提到的资源包括：

- `Memory Slice (MS)`：缓存待传输或待规约的数据
- `Loop Engine`：可并发的指令执行单元
- `GSA`：地址寄存器
- `GPR`：通用寄存器

这页很重要，因为它说明 CCU 不是一个简单黑盒，而是具备：

- 独立片上存储
- 独立执行单元
- 独立寄存器/地址管理

### 5.3 CCU 与带宽/时延

第 2 页、第 3 页、第 5 页、第 9 页集中说明：

- 集合通信会对内存带宽造成很大压力
- 传统方案会抢占 `AICPU`、`AIVector` 等资源
- CCU 通过片上并发执行和专用调度，降低调度开销
- `AI Core` 与 `CCU` 可通过寄存器传递同步和参数信息

从架构角度看，CCU 是 950 在“互联与存储”方向最明确的新能力之一。

## 6. PTO ISA 里反映出来的 950 硬件抽象

`PTO ISA教你如何快速上手昇腾950.pdf` 不是纯硬件介绍，但能反向帮助理解 950 的程序员可见结构。

### 6.1 950 的编程抽象

第 2 页出现的 950 侧关键元素：

- `Vector`
- `GM`
- `SIMD FE`
- `VREG`
- `warp`

同时也保留：

- `Unified Buffer`
- `Scalar Unit`

这说明 PTO 在 950 上试图把底层结构抽象成：

- 标量控制
- 向量/张量执行
- 统一 buffer
- 前端调度与寄存器组织

### 6.2 PTO 和底层架构关系

第 5 页明确写到：

- PTO 是 `达芬奇架构的新西装`
- 虚拟指令集和底层硬件做到 `一一对应`
- `透传硬件能力`

这意味着：

- PTO 不是完全屏蔽硬件
- 950 的很多硬件特性仍然会通过 PTO 暴露给算子开发者
- 因此 PTO 文档也能作为理解 950 微架构的辅助资料

## 7. 结论

如果目标是快速理解 Ascend 950 的芯片架构，优先级建议如下：

1. `面向新一代硬件，CANN技术架构的变与不变.pdf`
2. `HCCL集合通信专用引擎CCU技术介绍.pdf`
3. `探索Ascend 950的性能天花板.pdf`
4. `PTO ISA教你如何快速上手昇腾950.pdf`

核心结论可以压缩成 8 点：

- 950 采用 `多 die / chiplet` 形态
- `Compute Die` 和 `IO Die` 已明确分离
- die 间存在高带宽 `D2D` 互联
- 片内互联核心是 `NOC`
- 片上缓存层明显增强，至少可见 `L2`、`L3`、`UB`、`L1`、`L0C`
- 950 微架构新增多条 buffer 间数据通路
- `CCU` 是 950 的关键专项通信引擎，负责降低带宽压力和通信时延
- 950 的性能优化已经深度依赖 `cache 命中率`、`UB/L0/L1` 组织方式和 `tiling`

## 8. 本地提取文件

如果需要继续核对原始文本，可参考本地提取结果：

- `/Users/yin/.tmp/cann950_extracts/面向新一代硬件，CANN技术架构的变与不变.pdf.txt`
- `/Users/yin/.tmp/cann950_extracts/探索Ascend 950的性能天花板.pdf.txt`
- `/Users/yin/.tmp/cann950_extracts/HCCL集合通信专用引擎CCU技术介绍.pdf.txt`
- `/Users/yin/.tmp/cann950_extracts/PTO ISA教你如何快速上手昇腾950.pdf.txt`

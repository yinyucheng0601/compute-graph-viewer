# Ascend C Tiling Triton Viz可视化知识

本文档用于解释 Ascend C 算子开发中 tiling、GM 数据、循环执行、片上搬运和可视化表达之间的关系。后续页面可以把本文拆成教学卡片、交互说明或可视化旁白。

## 1. “一整块 tensor”不是物理 3D 内存

Triton Viz 里的 3D tensor 视图容易让人误解：好像 GPU/NPU 内存里真的存了一块三维立方体。实际不是。

在 Ascend C 里也是一样：

- GM 是一段扁平地址空间。
- Tensor 的 shape、layout、stride 决定如何解释这段扁平地址。
- Tiling 决定每个 core、每次循环要处理 GM 上哪一段数据。
- 3D 可视化展示的是逻辑访问空间，不是 GM 的物理形状。

所以，所谓“展示一整块 tensor”，更准确的说法是：

> 展示完整逻辑 tensor 空间，并高亮当前 block / tile / loop 正在访问的区域。

这和 GM 是否物理 3D 无关。GM 仍然是线性 buffer，3D 只是帮助开发者理解当前访问片段在整体 tensor 里的位置。

## 1.1 Triton-Viz 的产品逻辑：trace event 驱动 3D 高亮

Triton-Viz 的核心不是“把源码静态翻译成一个 3D 图”，而是先 trace 一次 kernel 执行，再把这次执行产生的操作记录画出来。

典型流程是：

```text
1. 用户用 @triton_viz.trace(client=Tracer()) 包住 Triton kernel。
2. Triton-Viz 通过 interpreter 执行每个 program id。
3. Tracer 记录 Grid、Load、Store、Dot、Transfer 等事件。
4. 每个 Load/Store 记录 pointer offsets、mask、tensor shape、stride 和源码调用栈。
5. 前端把 offsets/mask 反解成 logical tensor 坐标，在 3D 视口里高亮这些坐标。
```

所以 Triton-Viz 里的 3D 画面要拆成两层看：

```text
背景网格:
  完整 logical tensor / logical access space。

高亮块:
  当前 program id、当前 op、当前 trace event 实际访问到的 tensor 坐标集合。
```

画面静止时只代表“当前帧”。它不表示 tiling 是静态的。切换 op、切换 program id、拖动 timeline 或开启 all program ids 后，高亮范围会变化，表示不同 program block 和不同操作访问了不同的 logical range。

这给 Ascend C 版本三个重要约束：

- 3D viewport 应回答“这一条 trace step 正在触碰完整 logical tensor 的哪一块？”
- Memory Architecture 应回答“这块数据经过了哪些硬件节点、链路和片上 buffer？”
- Execution Timeline 应回答“CopyIn、Compute、CopyOut、同步和 epilogue 是按什么顺序发生的？”

不要把硬件阶段硬塞成 tensor 维度。比如 fusion 里的 AIC/AIV handoff 是生产者/消费者同步关系，应放在 timeline 和 memory architecture 中表达；3D viewport 只需要展示 AIC 生产的 C tile，以及 AIV 消费的 C tile 上半/下半 logical range。

Triton-Viz 的 program id 控件也不是 tensor 轴本身。`program_id(0/1/2)` 是执行网格坐标。对于 1D vector kernel，Triton-Viz 可以把它和 tile 内 offset 一起折叠成一个易观察的 3D 空间；这是一种调试视图，不改变原始 tensor 的物理布局。

## 2. Ascend C tiling 到底在切什么

Tiling 切的是输入/输出 tensor 的逻辑访问范围，最终会落到 GM buffer 的 offset 和 length。

以 Vector Add 为例：

```cpp
z[i] = x[i] + y[i]
```

GM 上通常是三段扁平 buffer：

```text
xGM: x[0 ... N-1]
yGM: y[0 ... N-1]
zGM: z[0 ... N-1]
```

tiling 需要决定：

```text
blockLength = totalLength / blockNum
tileLength  = blockLength / tileNum / BUFFER_NUM
gmOffset    = blockIdx * blockLength + progress * tileLength
```

每个 core 在某一次循环中实际处理：

```text
xGM[gmOffset : gmOffset + tileLength]
yGM[gmOffset : gmOffset + tileLength]
zGM[gmOffset : gmOffset + tileLength]
```

这就是 tiling 可视化要展示的核心：当前循环对应整块逻辑 tensor 中哪一个 slice。

## 3. 为什么 1D 数据也可以画成 3D

即使 Vector Add 的 GM 数据是 1D，也可以为了教学和调试，把访问空间折叠成三维：

```text
X axis: element inside tile
Y axis: tileIdx / progress
Z axis: blockIdx / core
```

这不是说原始 tensor 是 3D，而是把执行结构投影到 3D：

- X 表示 tile 内元素。
- Y 表示当前 core 内的循环进度。
- Z 表示不同 block/core 负责的区段。

这样用户能看到：

- 全部数据被分给了哪些 core。
- 每个 core 内部又被切成哪些 tile。
- 当前 step 高亮的是哪一个 tile。
- 尾块、对齐、padding 或越界 mask 可能出现在哪里。

## 4. CopyIn / Compute / CopyOut 处理的是 tile 生命周期

Ascend C 里的常见执行过程可以理解为一个 tile 的生命周期：

```text
1. Tiling / Init
   计算 blockLength、tileLength、offset，初始化 GM view 和 UB queue。

2. CopyIn
   从 GM 当前 slice 拷贝到片上 buffer。

3. Compute
   在 UB、寄存器或计算单元中处理当前 tile。

4. CopyOut
   把结果 tile 写回 GM。
```

以 Vector Add 为例：

```text
CopyIn:
  GM:x slice -> UB:xLocal
  GM:y slice -> UB:yLocal

Compute:
  UB:xLocal + UB:yLocal -> UB:zLocal

CopyOut:
  UB:zLocal -> GM:z slice
```

可视化时不要把它画成单纯流程图。更好的表达是：

- 主 3D tensor 视图显示完整逻辑 tensor 和当前 tile 位置。
- 片上 tile lens 显示当前 tile 在 UB/L0 中的局部状态。
- memory-architecture 架构图显示数据经过的硬件路径。

## 5. 循环不是抽象控制流，而是 tile 调度

常见 Ascend C 代码会出现类似循环：

```cpp
for (int i = 0; i < loopCount; i++) {
  CopyIn(i);
  Compute(i);
  CopyOut(i);
}
```

这里的 `i` 不是一个随意的 loop counter，它通常对应当前 core 内部的 tile progress。

一个可视化 step 可以这样解释：

```text
blockIdx = 当前 core
progress = 当前循环 i
tileRange = [gmOffset, gmOffset + tileLength)
```

当用户点击或播放 step 时，页面应该同步更新三类信息：

- 3D tensor 中当前 tile 的位置。
- Source code 中对应的 CopyIn / Compute / CopyOut 代码行。
- memory-architecture 中对应的硬件路径。

## 6. Double Buffer 和流水并行如何理解

很多 Ascend C sample 会使用 `BUFFER_NUM = 2`。这意味着 CopyIn、Compute、CopyOut 可能不是完全串行，而是有流水重叠。

概念上可以理解为：

```text
time t:
  CopyIn tile i + 1
  Compute tile i
  CopyOut tile i - 1
```

MVP 阶段可以先按顺序播放：

```text
CopyIn(i) -> Compute(i) -> CopyOut(i)
```

后续增强版应显示三条泳道：

```text
MTE / CopyIn lane
Vector or Cube Compute lane
MTE / CopyOut lane
```

这样才能解释 pipe bubble、搬运等待、计算等待和 double buffer 是否真正隐藏了延迟。

## 7. MatMul tiling 切的是 M/N/K

MatMul 的 tiling 比 Vector Add 更典型，因为它不是简单切一维范围。

逻辑公式：

```text
C[M, N] = A[M, K] x B[K, N]
```

每个 core 或每个循环通常会处理：

```text
A[mTile, kTile] -> L0A
B[kTile, nTile] -> L0B
Cube compute    -> L0C[mTile, nTile]
CopyOut         -> GM:C[mTile, nTile]
```

这里可以把 3D 视图理解为：

```text
X axis: N tile
Y axis: M tile
Z axis: K tile / reduction step
```

注意：

- `C` 结果本身通常是 2D。
- `K` 轴是 reduction 过程中的计算维度。
- 可视化时可以用 Z 轴展示当前 K tile 的累积过程。

因此 MatMul 的 3D 视图不是展示一个物理 3D tensor，而是展示 M/N/K tiling 和 reduction 关系。

## 8. Fusion 关注中间结果是否少走 GM

Fusion sample 里，重点不是简单多画一个激活函数，而是展示中间结果是否绕回 GM。

普通拆分路径可能是：

```text
AIC Cube:
  L0C -> GM workspace

AIV Vector:
  GM workspace -> UB -> activation -> GM output
```

更理想的融合路径是：

```text
AIC Cube:
  L0C -> UB

AIV Vector:
  UB -> activation -> GM output
```

可视化时应该清楚表达：

- `L0C -> UB` 直连路径被高亮。
- GM workspace 被灰掉或标记为 avoided。
- 3D tensor 主视图仍然显示最终 output tile 的位置。
- 片上 lens 显示 L0C tile 如何进入 UB 并完成 epilogue。

## 9. 3D tensor 视图和 memory-architecture 图的分工

这两个视图不要混在一起。

### 3D tensor 视图回答的问题

```text
当前处理的是整块逻辑 tensor 的哪一块？
这个 tile 属于哪个 block/core？
它在 M/N/K 或 block/tile/element 空间中的位置是什么？
哪些元素被 load、store、mask、padding 或写回？
```

### memory-architecture 图回答的问题

```text
这块数据从哪里搬到哪里？
经过 GM/L2/UB/L1/L0A/L0B/L0C 中哪些硬件对象？
使用的是 MTE2、MTE3、Cube、Vector 还是 C-V direct lane？
哪些硬件节点 active，哪些路径被绕开？
```

因此推荐的教学页面布局是：

```text
左侧：代码和 tiling 参数
中间：3D full tensor space
右侧：memory-architecture path focus + inspector
底部：playback / step timeline
```

## 10. 视觉状态建议

一个 step 播放时，推荐同步更新以下状态：

| Step | 3D tensor 主视图 | 片上 lens | memory-architecture |
|---|---|---|---|
| Tiling / Init | 显示 block/tile 网格 | buffer slot 为空 | 仅高亮目标 core |
| CopyIn | 高亮 GM 输入 slice | xLocal/yLocal 出现 | L2/GM -> UB 或 L1/L0A/B 路径发光 |
| Compute | 保留当前 tile outline | x/y/z local 计算状态变化 | Vector/Cube 和对应 buffer 发光 |
| CopyOut | output tile 填充 | zLocal 消退 | UB/L0C -> GM/L2 路径发光 |
| Fusion | output tile + avoided intermediate | L0C -> UB -> epilogue | C-V direct route 发光，GM workspace 灰掉 |

## 11. 教学时最重要的心智模型

用户应该建立这几个判断：

1. GM 是扁平地址，tensor 是逻辑解释。
2. Tiling 是把逻辑 tensor 切成 core/tile/loop 可处理的 GM slice。
3. CopyIn/Compute/CopyOut 是 tile 在片上内存和计算单元中的生命周期。
4. 循环 `i` 通常代表当前 core 内的 tile progress。
5. 3D tensor 视图展示“在哪一块算”。
6. memory-architecture 图展示“数据怎么走”。
7. MatMul 的 K 轴是 reduction 过程，不一定对应输出 tensor 的物理维度。
8. Fusion 的核心价值是减少中间结果绕 GM。

## 12. 页面落地建议

后续页面可以把本文拆成三个教学层级：

### Level 1: 新手解释

只讲 GM 是扁平 buffer，3D 是逻辑访问空间；用 Vector Add 展示 block/tile/element。

### Level 2: 算子开发解释

加入 CopyIn/Compute/CopyOut、BUFFER_NUM、loopCount、tileLength、gmOffset。

### Level 3: 调优解释

加入 MatMul M/N/K、double buffer overlap、C-V fusion、GM workspace avoided、memory-architecture path focus。

最终目标不是让用户记住每个 API，而是让用户能回答：

> 当前代码这一行正在处理整块 tensor 的哪一片？这片数据从哪来、到哪去、在哪个硬件对象上被消费？

---

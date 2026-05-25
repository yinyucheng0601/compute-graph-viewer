# 指令可视化系统 PRD

**产品代号**：Kernel Instruction Visualizer / 指令路径工作台
**版本**：v0.1 草案
**日期**：2026-05-22
**状态**：产品定义中
**参考输入**：

- 前期洞察：`/Users/yin/pto/ai-cpu-aicore/ai_cpu_ai_core_operator_beginner.md`
- 参考原型：`/Users/yin/pto/ascend-950-workbench-demo/index.html`
- 可复用形态：源码面板、硬件架构图、Inspector 三栏联动工作台

---

## 1. 一句话定义

指令可视化系统是一个面向昇腾算子开发与性能优化的联动可视化工作台。它把 kernel 源代码、CANN 控制面任务参数、AI Core 指令流水、芯片架构图放到同一个界面里，让用户点击一行 kernel 代码，就能同步看到这行代码落在哪条硬件路径、使用哪些流水单元、依赖哪些 tiling / stream / GM / workspace 参数，以及下一步应该如何优化。

---

## 2. 背景与核心洞察

前期白皮书已经明确一个关键认知：**AI CPU / Host CPU 不是逐条遥控 AI Core 执行加法、乘法指令，而是控制面准备任务，AI Core 数据面执行已经编译好的 kernel。**

这导致算子开发中存在一个典型断层：

| 用户看到的东西 | 硬件实际发生的事 | 当前断点 |
|---|---|---|
| Python / PyTorch 调了一个 op | Runtime 查 OPP、InferShape、Tiling、选择 kernel 并投递到 stream | 调用链隐藏在框架和 CANN 里 |
| `op_host/*_tiling.cpp` 写了 `SetBlockDim` / `SetTilingKey` | 生成 kernel 任务的并行度、分支选择和 tile 参数 | 用户很难把控制面代码和 AI Core 执行联系起来 |
| `op_kernel/*.cpp` 写了 `DataCopy` / `Add` / `Mmad` / `PipeBarrier` | 分别映射到 MTE2、Vector、Cube、FixPipe、MTE3 等流水 | 源码行和硬件路径之间缺少可视化证据 |
| 芯片架构图展示 GM、L2、AIC、AIV、UB、L1、L0 | 真实执行会走其中一小段路径 | 架构图通常是静态教学图，不随代码联动 |
| profiler 给出 cycle 或 stall | 性能瓶颈来自 tiling、搬运、计算、同步、mode switch 的组合 | profile 结果很难反向定位到源码和硬件结构 |

产品机会是：把“控制面下单、数据面执行”的心智模型做成可操作的工作台，而不是继续写静态说明文档。

---

## 3. 产品目标

### 3.1 用户目标

- 在 30 秒内理解一个 kernel 的关键执行路径：谁下单、谁搬数据、谁计算、谁同步。
- 在 2 分钟内从一行源码定位到对应的硬件路径、流水单元和性能风险。
- 在 10 分钟内完成一次 kernel 初步性能诊断，输出可复核的证据和建议。

### 3.2 业务目标

- 降低 Ascend C / CANN 算子开发入门门槛。
- 提升 910B 到 950 / 950B 等新芯片迁移时的路径解释能力。
- 把 kernel 优化从“专家凭经验读代码”推进到“源码、架构、tiling、pipeline 有证据联动”。

### 3.3 产品原则

- **源码是入口**：用户从 kernel 代码开始理解，不从抽象架构图开始。
- **架构图常驻**：硬件图不是说明材料，而是主工作区。
- **联动优先于堆指标**：每个指标必须能回到源码行、硬件节点或 pipeline 段。
- **控制面与数据面同时可见**：不仅解释 AI Core 指令，也解释 CPU 侧传给 AI Core 的任务“订单”。
- **先解释，再建议**：优化建议必须附带 evidence，避免只给结论。

---

## 4. 用户定义

| 用户 | 典型水平 | 核心问题 | 产品要交付的价值 |
|---|---|---|---|
| 算子开发初学者 | 刚开始读 Ascend C / CANN | `op_host`、`op_kernel`、AI CPU、AI Core 到底怎么分工 | 建立可落地心智模型，知道按什么顺序读代码 |
| Kernel 开发工程师 | 能写 kernel，但调优经验有限 | 这行 `DataCopy` / `Add` / `Mmad` 在硬件上怎么跑 | 把源码行映射到指令流水和硬件路径 |
| 性能优化工程师 | 关注 cycle、带宽、pipeline overlap | 瓶颈在搬运、计算、同步、tiling 还是 tail 分支 | 给出瓶颈归因、what-if 调参和优化建议 |
| 编译器 / 工具链工程师 | 关注 lowering、intrinsic、profile 对齐 | 静态分析、编译结果、profile 是否一致 | 提供 source-inferred、compiled、profiled 多层证据 |
| 架构评估 / 技术布道用户 | 不一定改代码，但需要解释新芯片收益 | 950 相比 910B 为什么更快，硬件路径差异在哪里 | 用同一段 kernel 展示两代芯片路径和 cycle 差异 |

P0 优先服务 Kernel 开发工程师和性能优化工程师；初学者场景作为首屏解释与默认 walkthrough 支撑。

---

## 5. 核心场景

### S1. 从 kernel 源码理解 AI Core 指令路径

用户打开 `op_kernel/*.cpp`、`.asc` 或 `.tik` 文件，点击 `DataCopy`、`Add`、`Mmad`、`PipeBarrier` 等关键行。系统高亮对应硬件路径，并在 Inspector 中说明该行属于 memory、compute 还是 control，使用 MTE2 / Vector / Cube / FixPipe / MTE3 中的哪类流水。

用户要回答：**这行代码到底让 AI Core 做了什么？**

### S2. 从控制面任务参数理解“CPU 下单”

用户切到 `op_host/*_tiling.cpp` 或 host launch 代码，系统识别 `SetBlockDim`、`SetTilingKey`、`SaveToBuffer`、workspace、stream、event / notify 等信号，并把它们组成一次 kernel 任务订单。

用户要回答：**AI CPU / Host CPU 到底传给 AI Core 了什么？**

### S3. 诊断 CopyIn → Compute → CopyOut 的性能结构

用户选择一个 kernel 后，系统展示 tile、block、GM/UB/L1/L0 数据路径和 pipeline 泳道图。用户可以看到 CopyIn、Compute、CopyOut 是否重叠，是否有 sync bubble，是否受 GM 带宽、UB 容量或 Cube/Vector 利用率限制。

用户要回答：**这个 kernel 贵在哪，下一步该调 tile 还是改数据流？**

### S4. 做 910B / 950 架构迁移对比

用户选择同一个 kernel 的 910B baseline 与 950 / 950B 目标架构。硬件图并列展示两代路径，Inspector 给出总 cycle 差异、路径差异和原因，例如 C-V 直通、AIC/AIV 协作、SIMT island、GM/L2 staging 的变化。

用户要回答：**迁移到新芯片的收益来自哪里，哪些路径会退化？**

### S5. 解释 PTO / KFC 类复杂编排

用户查看 `SetAttachedStreamInfos`、`SetSyncResInfos`、`SYNC_RES_NOTIFY` 等 PTO/KFC 信号。系统把它们标为设备侧控制 / 附加 stream / notify 同步，而不是普通 AI Core 计算。

用户要回答：**这里是不是 AI CPU 参与编排？它和 AI Core kernel 的边界在哪里？**

### S6. 用作 code review / 教学报告

用户完成分析后导出一页报告，包含源码片段、硬件路径、tiling 参数、pipeline 结论、证据和建议，供 reviewer 或新同学复盘。

用户要回答：**这次判断是否可复核、可传播？**

---

## 6. 产品形态

### 6.1 总体形态：三栏联动工作台

参考 `ascend-950-workbench-demo/index.html`，P0 产品采用三栏工作台，而不是文档页或 dashboard。

```text
顶部上下文栏
当前 kernel / 芯片架构 / 分析层级 / 结论 / 导出

主工作区
┌──────────────────────┬──────────────────────────────┬──────────────────────┐
│ Kernel 源代码         │ 芯片架构图                     │ Inspector             │
│ Source View           │ Hardware Architecture Map      │ Instruction Inspector │
│                      │                              │                      │
│ 行级标注              │ AIC / AIV / GM / L2 / UB       │ 当前行解释             │
│ 文件切换              │ 路径高亮 / 对比视图             │ 任务订单 / tiling       │
│ 搜索 / 筛选            │ route chips / zoom             │ pipeline / 建议 / 证据  │
└──────────────────────┴──────────────────────────────┴──────────────────────┘
```

### 6.2 源码面板

源码面板是用户入口，支持：

- kernel 文件选择：`csrc`、`op_host`、`op_kernel`、`.asc`、`.tik`。
- 行号、语法高亮、关键行标签。
- 标签类型：memory、compute、control、scalar、loop、framework、tiling、sync。
- 点击源码行触发全局选择态。
- 支持只显示关键行、只显示数据面、只显示控制面。

### 6.3 芯片架构图

硬件图是主认知界面，必须常驻中栏：

- 芯片 preset：Ascend 910B、Ascend 950 / 950B，后续可扩展。
- 图元：GM、L2、AIC、AIV、UB、L1、L0A、L0B、L0C、Vector、Cube、Scalar、MTE、FixPipe、stream / notify 抽象节点。
- 支持 route 高亮：如 `Global Memory -> L2 -> MTE2 -> AIC L1`、`AIV UB -> MTE3 -> L2 -> GM`。
- 支持 compare 模式：同一源码行在两代芯片中的路径映射并列展示。
- 支持反向联动：点击硬件节点，列出相关源码行和指令类型。

### 6.4 Inspector 面板

Inspector 回答“当前选择为什么重要”。建议固定为以下信息架构：

| 区段 | 用户问题 | P0 内容 |
|---|---|---|
| A. 当前对象 | 我在看哪行 / 哪个 kernel | 文件、行号、代码片段、kind、tag |
| B. 一句话解释 | 这行在硬件上做什么 | 指令语义、控制面/数据面分类、路径摘要 |
| C. 硬件路径 | 它经过哪些节点 | selectors、routes、路径 chip、910B/950 差异 |
| D. 指令流水 | 它占用哪条 pipeline | MTE2 / MTE1 / Cube / Vector / Scalar / FixPipe / MTE3 |
| E. 任务订单 | CPU 侧传了什么 | kernel 选择、blockDim、tilingKey、tilingData、workspace、stream/event |
| F. Tiling | 这次任务怎么切 | tile shape、tile count、per-block range、UB/L1/L0 占用 |
| G. Pipeline | 它怎么排队执行 | 泳道图、bubble、critical path、overlap |
| H. 建议 | 我该做什么 | 对齐、double buffer、分支拆分、tile 调整、同步收窄 |
| I. 证据 | 凭什么这么判断 | 规则命中、源码证据、编译产物、profile 证据、置信度 |

---

## 7. 联动模型

### 7.1 正向链路

```text
源码行
  -> 语义识别
  -> 控制面 / 数据面分类
  -> 指令或任务参数类型
  -> 硬件节点 selectors + route ids
  -> pipeline lane + cycle / stall
  -> Inspector 解释 + 建议
```

示例：

| 源码信号 | 分类 | 硬件映射 | Inspector 解释 |
|---|---|---|---|
| `DataCopy(aL1, aGM + tileOffset, ...)` | memory | GM -> L2 -> MTE2 -> AIC L1 | 预取输入 tile，关注 GM 连续读、L1 复用窗口 |
| `MmadFp8(cL0C, aL0A, bL0B, ...)` | compute | L1 -> L0A/L0B -> Cube -> L0C | Cube 友好矩阵片段，关注 L0 容量和 repeat shape |
| `PipeBarrier<PIPE_FIX>()` | control / sync | L0C -> FixPipe -> AIV UB | Cube 到 Vector epilogue 的顺序保护 |
| `Add(outUb, cUb, biasUb, ...)` | compute | AIV UB -> SIMD -> Vector | 稠密向量计算，关注 UB 驻留和对齐 |
| `if (mask[k])` | control / SIMT | Scalar -> SIMT scheduler -> Vector | mask 依赖元素，可能形成 SIMT island |
| `SetBlockDim(...)` | control plane | Kernel Launch / Block Scheduler | 定义 AI Core block 并行度 |
| `SetTilingKey(...)` | parameter bridge | Kernel branch selector | 决定 kernel 内 `TILING_KEY_IS` 分支 |
| `SetAttachedStreamInfos(...)` | device orchestration | stream / notify | PTO/KFC 设备侧编排信号 |

### 7.2 反向链路

- 点击硬件节点：显示所有相关源码行，按 memory / compute / control 分组。
- 点击 route：显示触发该 route 的 `DataCopy` / `TransferToVector` / writeback 等行。
- 点击 pipeline bubble：高亮造成等待的源码行和依赖参数。
- 点击 tiling tile：高亮当前 block / tile 对应的源码循环和 GM/UB/L1/L0 数据范围。

---

## 8. 功能范围

### 8.1 P0：可用 MVP

| 功能 | 描述 | 验收标准 |
|---|---|---|
| F1. Kernel 项目载入 | 支持载入一个 kernel 示例，包含源码、架构 preset、标注数据 | 可打开至少 3 个示例：Vector Add、GELU、FP8 MMAD |
| F2. 源码行级标注 | 标出 memory、compute、control、scalar、loop | 关键行点击后 Inspector 与硬件图同步刷新 |
| F3. 硬件路径高亮 | 根据 `selectors` 和 `routes` 高亮架构图节点与连线 | 点击 `DataCopy` 能看到 GM/L2/UB 或 L1 路径 |
| F4. 指令解释卡 | 展示当前行的语义、流水、原因、建议 | 每个关键行必须有一句中文解释和至少一个 evidence |
| F5. 控制面任务订单 | 汇总 kernel 选择、blockDim、tilingKey、tilingData、workspace、stream/event | `op_host` 与 launch 行能被归入任务订单 |
| F6. Tiling 可视化 | 展示 tile shape、tile count、per-block range、片上内存占用 | 调整主 tile 参数时，下游卡片刷新 |
| F7. Pipeline 泳道图 | 展示 MTE / Vector / Cube / Scalar / FixPipe 时间线 | 能标出 critical path 和 bubble |
| F8. 910B / 950 对比 | 同一源码行在两代芯片中映射不同路径 | Compare 模式有一句明确差异结论 |
| F9. 状态与错误处理 | 支持无标注、无路径、架构节点缺失、profile 缺失 | 不出现空白面板，明确说明缺少什么 |

### 8.2 P1：产品化增强

- 自动解析更多 Ascend C / C API intrinsic。
- 支持 `op_host`、`op_kernel`、`torch_ops_extension` 三层文件树联动。
- 支持从 profile trace 导入 cycle / stall / bandwidth 数据。
- 支持导出 Markdown / PNG 报告。
- 支持 reason code 搜索与筛选。
- 支持硬件节点反查源码。
- 支持多 kernel 对比列表。

### 8.3 P2：高阶能力

- 接入编译产物，展示 source-inferred / compiled / profiled 三层差异。
- 支持建议生成 patch 草案，但不自动改代码。
- 支持 IDE 插件形态，在源码编辑器中侧边展示可视化。
- 支持自定义芯片架构 preset 和企业内部节点命名。
- 支持 CI 中生成 kernel 路径健康度报告。

---

## 9. 数据契约

### 9.1 输入数据

| 数据 | 来源 | 必需性 | 说明 |
|---|---|---|---|
| 源码文件 | 用户项目 / 示例目录 | P0 必需 | `.cpp`、`.h`、`.asc`、`.tik`、`.py` |
| 架构 preset | 产品内置 / 设计系统 pattern | P0 必需 | 芯片节点、route、容量、显示层级 |
| 行级标注 | 静态规则 / 人工补充 / 编译器输出 | P0 必需 | 源码行到硬件路径的桥 |
| Tiling 数据 | `op_host` 解析 / 用户输入 / profile | P0 部分必需 | blockDim、tile shape、tilingKey、workspace |
| Profile 数据 | profiler / trace | P1 必需 | cycle、stall、带宽、利用率 |
| 编译产物 | compiler IR / lowering report | P2 必需 | 高阶 API 到真实指令的映射 |

### 9.2 行级标注结构

```json
{
  "id": "l48",
  "file": "op_kernel/fp8_mmad_masked_reduce.cpp",
  "line": 48,
  "kind": "compute",
  "tag": "SIMD / Cube",
  "code": "MmadFp8(cL0C, aL0A, bL0B, repeatM, repeatN, repeatK);",
  "plane": "data",
  "instruction": {
    "api": "MmadFp8",
    "pipeline": ["MTE1", "Cube"],
    "level": "AI Core instruction abstraction"
  },
  "hardware": {
    "selectors": [
      "#aic [data-aic-node=\"buffer:L1\"]",
      "#aic [data-aic-node=\"buffer:L0A\"]",
      "#aic [data-aic-node=\"cube:CUBE\"]"
    ],
    "routes": ["l1-to-l0", "l0-to-cube"]
  },
  "tiling": {
    "tileShape": "M128 x N128 x K64",
    "blockDim": 8,
    "tilingKey": 2
  },
  "evidence": [
    "Cube friendly shape",
    "stride aligned",
    "FP8 MMAD supported"
  ],
  "recommendation": {
    "title": "验证 L0 容量与 repeat shape",
    "expectedImpact": "reduce compute bubble"
  }
}
```

### 9.3 架构图契约

架构图需要提供稳定的 DOM selector 和 route id：

- 节点 selector：`[data-aic-node="buffer:L1"]`、`[data-aiv-node="buffer:UB"]`、`[data-mem-node="rail:GM"]`
- 路径 route id：`gm-to-l2`、`l2-to-aic`、`aic-to-aiv`、`aiv-to-l2`
- preset id：`ascend910b`、`ascend950b`
- 节点元信息：名称、类型、容量、吞吐提示、所属 core、是否 950 专有
- route 元信息：from、to、pipeline、direction、是否可对比降级

---

## 10. 关键交互

### 10.1 默认进入

默认打开一个示例 kernel，选中最能代表核心路径的行：

- Vector Add：默认选中 `asc_add`。
- GELU：默认选中核心 Vector / VF 计算行。
- FP8 MMAD：默认选中 `MmadFp8` 或 `DataCopy` 预取行。

首屏必须同时看到源码、硬件图和 Inspector，不进入说明页。

### 10.2 点击源码行

点击关键行后：

1. 源码行进入 selected 状态。
2. 硬件图高亮对应节点和 route，弱化无关节点。
3. Inspector 更新当前行解释、流水、tiling、pipeline、建议与证据。
4. 顶部上下文栏更新当前 kernel verdict。

### 10.3 Compare 模式

选择 910B / 950 Compare 后：

- 硬件图并列显示两个 preset。
- 同一行的硬件语义保持一致，但 selectors/routes 可按架构降级映射。
- Inspector 显示两张 cycle / pipeline 卡片。
- 必须给出一句差异结论，例如：`950 侧减少 34% cycle，主要来自 C-V 直通路径降低 AIC/AIV 交接开销。`

### 10.4 Tiling what-if

用户调整 tile 参数后：

- tile shape、tile count、UB/L1/L0 占用即时刷新。
- pipeline 重新估算 bubble 和 critical path。
- 如果参数超出片上容量，显示明确风险，不静默失败。

### 10.5 证据追溯

每个建议必须能追溯到至少一种证据：

- 源码规则命中：intrinsic、AST、宏展开、变量依赖。
- 控制面参数：blockDim、tilingKey、workspace、stream。
- 架构能力：节点容量、route 可用性、芯片 preset。
- 编译产物：lowering、instruction report。
- profile：cycle、stall、带宽。

---

## 11. 体验与信息设计要求

- 产品首屏是工作台，不做营销式 landing page。
- 架构图必须常驻主界面，不能藏在 drawer、tooltip 或二级页。
- 技术术语允许出现，但必须配一句用户可读解释。
- 标签颜色与语义稳定：
  - memory：搬运 / GM / UB / L1 / L0 / MTE
  - compute：Vector / Cube / SIMD / MMAD
  - control：SetFlag / WaitFlag / PipeBarrier / stream / event
  - tiling：blockDim / tilingKey / tile shape
- 右侧 Inspector 的主语始终是“当前 kernel / 当前行”，避免一会儿讲行、一会儿讲算子导致认知漂移。
- 910B / 950 对比不允许伪造不存在的路径；不存在的 route 应显示降级说明。
- 无 profile 时可以做 source-inferred 估算，但必须标注数据层级。

---

## 12. 成功指标

| 指标 | 目标 |
|---|---|
| 首次路径高亮时间 | 用户导入 kernel 后 30 秒内看到第一条源码到硬件路径联动 |
| 初学者理解效率 | 新用户能在 10 分钟内说清 control plane / data plane 分工 |
| 关键行覆盖率 | P0 示例 kernel 的 memory / compute / control 关键行覆盖率 >= 90% |
| 解释可复核率 | 每条优化建议至少有 1 条源码证据和 1 条硬件/参数证据 |
| 诊断完成时间 | 单 kernel 初步瓶颈判断 <= 10 分钟 |
| 对比结论可读性 | Compare 模式 100% 产出一句明确差异结论 |

---

## 13. 非目标

- 不在 P0 做真实 profile 采集，只消费已有或模拟 profile 数据。
- 不在 P0 自动改写 kernel 代码。
- 不替代 IDE，只提供可视化理解与诊断工作台。
- 不做完整 CANN 文档搜索系统。
- 不把 AI CPU 描述成实时逐条下发 AI Core 指令的控制器。
- 不用静态架构图冒充执行结果；必须通过源码标注或数据证据驱动高亮。

---

## 14. 里程碑

### M0：静态原型收敛

- 基于现有 `ascend-950-workbench-demo` 完成产品形态确认。
- 三个示例 kernel：Vector Add、GELU、FP8 MMAD。
- 支持源码行 -> 架构图 -> Inspector 联动。

### M1：MVP 产品

- 支持导入一个本地 kernel 示例目录。
- 支持行级标注 JSON。
- 支持控制面任务订单视图。
- 支持 tiling 与 pipeline 基础可视化。
- 支持 910B / 950 Compare。

### M2：半自动分析

- 引入静态解析规则，自动识别常见 intrinsic 和控制面 API。
- 支持 profile trace 导入。
- 支持导出分析报告。

### M3：工程化集成

- 接入编译产物。
- 支持 IDE 插件或本地服务形态。
- 支持 CI 报告和多 kernel 汇总。

---

## 15. 风险与待确认问题

| 风险 | 影响 | 应对 |
|---|---|---|
| 高阶 API 到真实硬件指令的映射不稳定 | 解释可能误导用户 | 明确标注 source-inferred / compiled / profiled 层级 |
| 宏、模板、自定义封装导致静态解析漏判 | 关键行覆盖不足 | P0 允许人工标注，P1 加宏展开和白名单 |
| 架构图 selector / route contract 不稳定 | 联动容易失效 | 将架构图节点和 route id 产品化为稳定契约 |
| profile 数据不可用 | 性能结论可信度不足 | 无 profile 时只给估算，不给强结论 |
| 910B / 950 差异解释过度简化 | 架构评估失真 | 不存在路径只做降级映射和说明，不本地补线 |
| 初学者和专家信息密度需求冲突 | 首屏过载或太浅 | 默认专家工作台，提供概念提示和可折叠解释 |

---

## 16. P0 验收清单

- [ ] 打开产品后，首屏同时看到源码、芯片架构图、Inspector。
- [ ] 点击 `DataCopy` 行，硬件图高亮 GM / L2 / UB 或 L1 路径，Inspector 显示 MTE2 / MTE3 解释。
- [ ] 点击 `Add` / `Mmad` 行，硬件图高亮 Vector 或 Cube 路径，Inspector 显示 compute pipeline。
- [ ] 点击 `SetBlockDim` / `SetTilingKey` 行，Inspector 将其归入控制面任务订单，而不是 AI Core 计算指令。
- [ ] Compare 模式能展示同一行在 910B 与 950 的路径差异。
- [ ] 每个关键行至少有 `kind`、`tag`、`path`、`pipeline`、`evidence`。
- [ ] 无路径或无 profile 的场景有明确空态说明。
- [ ] 导出报告能包含源码片段、硬件路径、tiling、pipeline、建议和证据。

---

## 17. 产品结论

这个产品不是“把白皮书做成网页”，而是把白皮书里的核心洞察转成一个可交互的工程工具：

> CPU 侧准备 kernel 任务订单，AI Core 执行设备指令流水；指令可视化系统负责把这张订单、这段源码和这条硬件路径同时显示出来。

P0 应聚焦一件事：让用户点击 kernel 源码中的关键行时，能够立刻看到它在芯片架构图上的真实执行路径，并在 Inspector 里获得可复核的解释和下一步动作。

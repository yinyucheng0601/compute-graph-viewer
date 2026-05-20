# Ascend 950B 硬件路径工作台 Demo 设计说明

## 设计目标

这个 demo 把模式选择产品重构成“硬件路径工作台”。核心交互不是简单告诉用户“这一行建议 SIMD / SIMT”，而是建立一条可验证的信任链：

> 选中代码行 -> 高亮 950B 硬件路径 -> 用决策证据解释为什么。

因此硬件架构图必须常驻主界面。它不是辅助说明，而是 kernel / compiler / perf engineer 判断建议是否可信的核心认知界面。

## 用户场景

主要用户是内核、编译器和性能工程师。TA 的真实任务是确认一段 kernel 在 Ascend 950B 上应该如何走硬件路径。

用户关心三个问题：

- 这段代码为什么应该走这条硬件路径？
- 哪些 buffer / cache / compute unit 被用到？
- 当前 SIMD / SIMT / Hybrid 选择是否和 950B 架构能力冲突？

典型场景：

1. 用户打开 `fp8_mmad_masked_reduce.tik`。
2. 系统标注关键代码行，包括访存预取、Cube 计算、FixPipe 交接、Vector epilogue、SIMT 条件分支和写回。
3. 用户点击某一行代码。
4. 右侧 950B 架构图同步高亮相关路径。
5. 底部证据区解释结论、原因码、建议改写和指标影响。
6. 用户决定应用建议，或导出给 reviewer / CI。

## 场景数据

Demo 使用一个合成但贴近真实的 FP8 matmul + vector epilogue kernel，覆盖 950B 模式选择里最关键的信任路径。

| 行号 | 代码角色 | 硬件路径 | 决策 |
|---|---|---|---|
| L42 | 输入预取 | Global Memory -> L2 -> MTE2 -> AIC L1 | 访存预取 |
| L48 | FP8 MMA | L1 -> MTE1 -> L0A / L0B -> Cube -> L0C | SIMD / Cube |
| L57 | 流水同步 | L0C -> FixPipe -> 直连 CV 通道 -> AIV UB | 混合路径交接 |
| L73 | 向量 epilogue | AIC L0C -> AIV UB -> SIMD -> Vector | SIMD / Vector |
| L82 | mask 条件分支 | UB -> Scalar 控制 -> SIMT Warp Scheduler -> Vector | SIMT 区域 |
| L96 | 输出写回 | AIV UB -> MTE3 -> L2 -> Global Memory | 访存写回 |

每一行包含：

- 代码文本
- 模式标签
- 硬件图节点选择器
- 顶层 route id
- 决策原因
- 中文解释
- 建议改写
- 置信度 / 周期变化 / 资源压力

## 标注规则

代码行的标注分两级：

- **Tag**：贴在代码行旁的 pill（如 `GM→UB 读入`），识别即标，覆盖所有可解析的代码行，让读者知道这一行被分类到了哪个角色。
- **卡片**：代码行下方展开的决策证据区（verdict / reasons / explanation / rewrite / metrics），只挂在 memory / compute / control 三类硬件路径角色上。

### Tag 角色

| 角色 | 触发条件 | 是否展开卡片 |
|---|---|---|
| memory | 跨存储层级搬运 intrinsic：`DataCopy*` / `Copy*` 系列；按参数符号前缀派生 MTE2 / MTE3 / MTE1 等 tag | ✅ |
| compute | Cube / Vector intrinsic：`Mmad*` / `Add` / `Mul` / `Relu` / `Vector*` 等 | ✅ |
| control（同步） | `PipeBarrier` / `SetFlag` / `WaitFlag` / `FixPipe` | ✅ |
| control（SIMT 分支） | 条件依赖 lane 索引或 mask 数组的发散分支 | ✅ |
| scalar | 普通赋值、地址计算、tile offset 推导 | ❌ 仅 tag |
| loop | for / while 循环头 | ❌ 仅 tag |
| control（scalar） | 普通 `if (i < N)` 这类 uniform 控制流 | ❌ 仅 tag |

仅 tag 的行不展开卡片，但保留在标注数据里。作用是：

- 让代码视图能区分"已识别但非关键"和"完全未分析"，避免读者误以为系统漏看了。
- 给后续筛选 / 统计提供完整画像（比如一段 kernel 里 scalar 占比多少）。

### 自动化能力

- **memory / compute / 同步类 control / scalar / loop**：靠 intrinsic 名字 + 参数符号前缀 + AST 节点类型，能 100% 覆盖。
- **SIMT 分支 vs scalar 分支**：差别在条件表达式是否依赖 lane 索引或 mask 数组。AST 启发式可以判定大多数情况，边界 case 需要人工 review。
- **自定义封装 / 宏**：作者把 `Mmad` 包成 `MyMatMul()` 或用模板特化时，静态分析识别不到，需要项目级算子白名单或宏展开兜底。

### 代表性选择（可选策略）

当前 demo 对卡片级每种 transition 类型只挑一个代表（如 L42 代表 MTE2 预取，L43 同型未挂卡片）。这是一个**展示密度**策略，不是判定规则。在以下场景应关闭去重、所有命中行都展开卡片：

- 算子审计 / CI 报告：需要完整覆盖
- 多流并行分析：A/B 双流的预取要分别可见

去重策略由消费端（demo / report / IDE 插件）决定，标注数据本身保持全集。

## Key User Path

1. 页面默认选中 L48，因为 Cube 执行是该 kernel 的核心优化点。
2. 用户点击任意代码行。
3. 左侧代码行进入选中态。
4. 右侧硬件图只弱化非相关器件，并保持命中器件高亮。
5. 路径 chip 用自然语言总结当前路径。
6. 底部证据区显示这一行为什么得到该模式结论。
7. 用户可通过“计算路径 / 访存路径 / 控制路径”快速跳到代表性代码行。

## 布局

页面采用“双主区 + 证据区”的组织方式：

```text
顶部上下文栏
内核 / 目标芯片 / 分析层级 / 当前结论 / 主操作

主工作台
代码与行级建议 | 常驻硬件架构图

底部证据区
当前行 / 原因码 / 模式解释 / 建议改写 / 指标
```

布局原则：

- 左侧代码建议约占 44%。
- 右侧硬件架构图约占 56%。
- 底部证据区横跨全宽，但不抢主视觉。
- 硬件图不能藏到二级页面、drawer 或代码行展开区。

### 950 / 910B 对比视图

硬件架构图下拉菜单提供第三种模式：`950 / 910B 对比视图`。它用于回答“同一段 kernel 代码在 950 迁移目标和 910B baseline 下，硬件路径与 cycle split 有什么差异”。

对比视图的布局规则：

- 硬件列改为上下分栏，上方是 Ascend 950，下方是 Ascend 910B。
- 两个架构图都复用 `hardware-frame.html` 和 `patterns/memory-architecture` 的 preset 渲染，不复制生成后的 DOM。
- 950 与 910B 的空间比例为 `1.2 : 1`，950 获得略高空间，用于容纳更复杂的 AIC + AIV + AIV 拓扑。
- 两个 iframe 在 compare 模式下统一缩放到 `35%`。
- `Ascend 950` / `Ascend 910B` 标题浮在对应 iframe 上方，不占用图形布局高度，不使用额外背景色或描边。
- compare 模式隐藏底部路径图例，避免图例挤占两张架构图的纵向空间。

联动规则：

- 点击左侧任意标注行时，同时向 950 和 910B 两个 iframe 分发高亮消息。
- 950 使用原始 selector / route；910B 使用同一行语义的 baseline 映射。
- 950 专有的 C-V 直通路、SIMT island、第二个 AIV 等路径，在 910B 中降级映射为 GM / L2 / 单 AIV baseline 路径。
- 如果某条 route 在 910B preset 中不存在，不在业务页本地补线；只高亮 910B preset 中真实存在的对应节点和 route。

Inspector 规则：

- `Cycle Split` 在 compare 模式下渲染两张 cycle 卡片：Ascend 950 与 Ascend 910B。
- 每张卡片都显示 total、SIMD、SIMT、memory / sync 或 DMA / sync 的 cycle 数量和比例。
- `c_api_add.asc` 在两侧都保持 PURE SIMD；950 侧重点解释 128B sector、NDDMA / 预取、同步收窄等迁移收益，910B 侧作为 GM / L2 / AIV SIMD baseline。
- hybrid kernel 在 950 侧保留 SIMD / SIMT split；910B 侧显示 SIMT island 与 C-V 直通路不可用后的 fallback / staging 估算。

## 设计系统复用

来源：`design-system-share/`。

复用的系统组件：

- `design-system-share/css/style.css`
- `tokens/foundation.css`
- `tokens/semantic.css`
- `tokens/components.css`
- `.layout-header`
- `.tab-control` / `.tab-control-item`
- `.segmented-control.segmented-control-muted`
- `.toolbar-control` / `.toolbar-readout`
- `.btn` / `.btn-solid` / `.btn-sm` / `.btn-ghost`
- `.panel-shell.panel-shell-quiet`
- `.panel-shell-header` / `.panel-shell-title` / `.panel-shell-meta` / `.panel-shell-body`

复用的图元 pattern：

- `patterns/memory-architecture`
- `patterns/aic-core-object`
- `patterns/aiv-core-object`

Demo 本地样式只处理布局、选中态、证据区组织和硬件图高亮，不新增按钮、tab、card、panel 的视觉语言。

## 缺失组件的补充来源

`design-system-share` 是项目内的视觉语言基线，所有按钮 / tab / card / panel 必须优先复用。

如果某次需求里确实出现现有设计系统**不存在**的组件（例如 slider、switch、tooltip、command palette、scrollbar、popover 等），可以去 [shadcn-ui/ui](https://github.com/shadcn-ui/ui) 取参考实现：

- 只取**视觉样式和交互行为**，不引入它的 React/Tailwind 依赖。
- 颜色、间距、圆角、字体等 token 必须翻译到本项目的 CSS 变量（`var(--primary)` / `var(--radius-md)` / `var(--space-3)` 等），不要直接写 zinc-900、slate-500 这类 Tailwind 色阶。
- 落地后在本节追加一行说明：哪个组件、来自 shadcn 哪个 primitive、做了哪些适配。
- 如果是高频需求，记得反馈给 `design-system-share` 维护者，沉淀回设计系统，而不是长期分散在 demo 本地。

已落地的补充：

- `.inspector-controls`（T1/T2/T3 分析层级段控件）：参考 shadcn-ui `Tabs` 的 `TabsList` + `TabsTrigger` 视觉（muted 背景容器 + active pill + 微阴影）。在 muted 背景上叠加一个绝对定位的滑动指示器（::before），用 JS `syncTierIndicator()` 测量选中按钮的 offsetLeft / width 写到 CSS 变量 `--tier-x` / `--tier-w`，由 `transition: transform / width 240ms` 驱动滑动。Token 已翻译到本项目 `var(--surface-2)`、`var(--background-elevated)`、`var(--border-subtle)`、`var(--radius-md)`、`var(--foreground-*)`。

## 硬件图渲染规则

硬件图放入独立 `hardware-frame.html`，先在 iframe 内按原始比例完成：

- 950B 架构图渲染
- route overlay 计算
- 节点高亮
- route 高亮
- 线宽和箭头样式

然后外层 `index.html` 只对整个 iframe 做统一缩放。这样可以避免缩放后出现线宽、箭头、标签、outline 比例不一致。

高亮规则：

- 只 dim rail 和具体器件。
- 不 dim AIC / AIV core 容器，避免父级透明度压暗 `UB / L0C / FP` 等命中器件。
- route 高亮先在原始比例下加粗，再由外层整体缩放。

## 后续产品化问题

- 代码区是否需要直接编辑，还是只在用户点击“应用建议”后进入编辑态。
- 是否需要同时展示多个硬件路径假设。
- 芯片型号增加后，硬件图是否需要 minimap。
- `评审` 和 `健康度` 应作为独立页面，还是作为工作台内的次级状态。

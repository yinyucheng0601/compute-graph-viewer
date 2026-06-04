# Pass-IR Pass Cause Explainer PRD

## 1. 页面产品特性

### 1.1 背景与目标

Pass-IR 当前可以加载 PyPTO pass 输出目录，按 pass 时间线查看 `Before` / `After` JSON 图，并在画布中看到节点新增、删除、修改和链路变化。下一阶段的产品目标是补齐“原因解释层”：时间轴动画不仅展示结果差异，还要解释某个 Pass 为什么会这样改图。

目标体验：

- 用户看到某个节点消失时，页面能说明它命中了哪个 Pass 规则，以及源码逻辑中的删除条件。
- 用户看到某个节点新增时，页面能说明它是由 fan-out 拆分、view/assemble 合并、reshape 切分、copy 插入还是其它规则生成。
- 用户拖动 Before/After 时间轴时，右侧解释面板同步展示当前变化的“程序因”，而不是只列出 JSON diff。
- 用户可以从解释面板跳到相关节点、相关边、相关 Pass 源码路径和真实 Before/After dump 文件。

核心判断：`Before/After JSON diff` 只能证明“结果发生了什么”，不能证明“Pass 为什么这么做”。原因解释必须来自 PyPTO Pass 源码规则，再结合当前 JSON diff 做匹配。

### 1.1.1 已确认产品决策

- 解释面板在未选择/未自动加载 pair 前关闭；选中有效 pair 后默认打开，用户可手动折叠。
- 默认展示工程解释：包含规则摘要、证据、源码文件/函数、相关节点。简明摘要置顶。
- 工程解释可打开源码级解释，但源码级解释不是默认主视图。
- 时间轴采用“规则命中叙事”：每个解释项对应一个 step，播放时高亮该规则影响的节点和边。
- 源码入口 MVP 仅显示文件名/函数名，并支持复制本地源码路径；暂不做编辑器跳转。
- MVP 不再只展示 4 个 Pass。页面需要解析所有能从 dump 与源码 schema 识别到的 Pass。
- 规则级解释首批覆盖 4 个 Pass：`RemoveRedundantReshape`、`DuplicateOp`、`MergeViewAssemble`、`RemoveRedundantOp`。
- 这 4 个 Pass 不是连续 Pass，选择依据是覆盖关键变化类型：删除/重连、fan-out 拆分、链合并、复杂冗余与 view/assemble 重写。
- 其它 Pass 进入 schema/diff 解释层：展示源码入口、Pass 意图、diff group、变化统计和未解释项，不能从 UI 中隐藏。
- 第一版面向 PyPTO 算子开发者调试，不做汇报型简化界面。
- 新功能使用独立页面 `/Users/yin/pto/pass-ir/explain.html`，不直接改原 `/Users/yin/pto/pass-ir/index.html`，也不引入原页面中与本目标无关的 controlflow/group 冗余入口。

### 1.2 目标用户

- PyPTO 算子开发者：确认编译器 Pass 是否按预期重写图。
- 编译器/Pass 开发者：验证某个 Pass 的规则触发是否正确，排查误删、漏删、误拆分。
- 性能与精度调试人员：定位哪个 Pass 引入结构变化，并理解变化对数据流、内存流或调度流的影响。
- Demo 讲解人员：用真实 pass dump 演示“编译器做了什么”和“为什么这么做”。

### 1.3 数据来源

页面应支持三类数据：

- Pass dump JSON：来自 `/Users/yin/gitcode/output_deepseek/Pass_xx_<PassName>/Before_*.json` 与 `After_*.json`。
- Pass 源码规则：来自 `/Users/yin/gitcode/pypto-master/framework/src/passes/**`。
- Pass 目录元数据：由目录名、文件名、pass 序号、function name、PATH、ROOT/LEAF snapshot 解析。

已确认可用的源码入口：

| Pass | 源码路径 | 产品解释重点 |
|---|---|---|
| `RemoveRedundantReshape` | `/Users/yin/gitcode/pypto-master/framework/src/passes/tensor_graph_pass/remove_redundant_reshape.cpp` | 删除冗余 `OP_RESHAPE`，将消费者改接到输入 tensor |
| `DuplicateOp` | `/Users/yin/gitcode/pypto-master/framework/src/passes/tile_graph_pass/graph_optimization/duplicate_op.cpp` | 当 `VIEW` 或 `GATHER_IN_L1` 输出存在多消费者时复制 op/tensor |
| `MergeViewAssemble` | `/Users/yin/gitcode/pypto-master/framework/src/passes/tile_graph_pass/graph_optimization/merge_view_assemble.cpp` 与 `/Users/yin/gitcode/pypto-master/framework/src/passes/pass_utils/merge_view_assemble_utils.cpp` | 合并连续 `VIEW` 链或连续 `ASSEMBLE` 链，重算 offset/dyn offset |
| `SplitReshape` | `/Users/yin/gitcode/pypto-master/framework/src/passes/tile_graph_pass/graph_optimization/split_reshape.cpp` | 围绕 reshape 的 tile overlap、copy-in/copy-out、assemble/view 重新构图 |
| `RemoveRedundantOp` | `/Users/yin/gitcode/pypto-master/framework/src/passes/tile_graph_pass/graph_optimization/remove_redundant_op.cpp` | 迭代删除 dummy op，处理 `VIEW -> ASSEMBLE` perfect match / partial match |
| Pass pipeline | `/Users/yin/gitcode/pypto-master/framework/src/passes/pass_mgr/pass_manager.cpp` | `PVC2_OOO` 默认策略、Pass 顺序、执行入口 |
| Pass 名称枚举 | `/Users/yin/gitcode/pypto-master/framework/src/passes/pass_interface/pass_type.h` | Pass name 与 enum 映射 |

注意：抽样检查的 pass `.log` 文件为空，不能作为主要解释来源。

当前实现验证口径：

- 源码 schema 已索引 47 个 PyPTO Pass/Pass-like 源码项。
- `/Users/yin/gitcode/output_deepseek` 可解析出 38 个 dump pass 目录。
- 该目录可构建 1000 个 Before/After pair，其中 926 个为 ready pair，覆盖 36 个 ready pass 名称。
- 缺少 Before 的 pair 保留为 `missing-before`，不进入解释播放，但计入覆盖统计。

### 1.4 页面信息架构

新增功能不替代现有 Pass-IR 基础页面，当前实现为独立解释页面。页面由以下区域组成：

- 顶部工具栏：保留加载入口、当前 pair 标题、状态统计；新增 Pass 级过滤器、Pair 级选择器、染色模式按钮。
- Pass 级过滤器：列出 dump 中解析到的全部 pass，并显示每个 pass 的 ready pair 数与解释覆盖等级。
- Pair 级选择器：列出当前 pass 下可解释的 function/PATH/snapshot Before/After pair。
- 主图画布：继续渲染 op/tensor/incast/outcast/group 节点；在解释模式下叠加变化状态和原因锚点。
- 浮动播放控件：用于 Before/After 动画、逐步查看变化、定位当前解释项。
- 右侧解释面板：展示当前 Pass 的规则摘要、命中规则、变化列表、源码依据和置信度。
- 节点详情面板：点击变化节点时，展示该节点的 diff 状态和原因说明。

### 1.5 核心功能

#### 1.5.1 Pass Pair 自动识别

当用户加载 pass 输出目录后，页面应自动建立 `Before/After` 配对。

配对规则：

- 目录匹配：`Pass_<index>_<PassName>`。
- 文件匹配：同一 function、同一 PATH、同一 ROOT/LEAF snapshot。
- 优先配对 `Before_<index>_<PassName>_*.json` 与 `After_<index>_<PassName>_*.json`。
- 若只有 `After`，MVP 标注为 `missing-before`，不进入播放；未来可使用上一 pass 的 `After` 作为逻辑 Before 并标注 `inferred before`。
- 若 pair 缺失，Pass 过滤器和覆盖统计显示不可解释状态。

#### 1.5.2 Before/After 时间轴动画

页面应保留 GraphScope 式的平滑过渡能力，并接入当前 Pass-IR 图布局。

能力要求：

- `0%` 表示 Before 图。
- `100%` 表示 After 图。
- 相同节点在两端位置插值移动。
- 删除节点在后半程淡出。
- 新增节点在后半程淡入。
- 修改节点保持可见，并在关键属性变化时显示变化标记。
- 边随节点位置重绘；新增/删除边使用差异状态表达。
- 时间轴拖动时解释面板同步滚动到当前变化项。

#### 1.5.3 原因解释面板

右侧解释面板是本次 PRD 的核心。

面板语义：

- 右侧解释面板展示的是“当前选中的一个 Before/After pair”的多个解释 step。
- 一个 pair 由 `passName + function + PATH + snapshot` 唯一确定，不等同于全局 Pass 列表。
- 如果当前 pair 命中多个规则或多个 diff group，面板会显示多个 step；播放条按这些 step 顺序播放。
- 如果用户在顶部切换 Pass 或 Pair，右侧面板随之替换为新 pair 的解释步骤。
- 全部 pass 的覆盖范围应通过顶部 Pass 过滤器和覆盖统计展示，不放在右侧解释面板内。

面板内容：

- Pass 标题：序号、名称、阶段、function、PATH/snapshot。
- 源码入口：源码文件路径、核心函数名，例如 `RunOnFunction`、`RemoveReshape`、`ProcessViewAssemble`。
- 简明摘要：置顶展示一句话结论，服务快速扫读。
- Pass 意图摘要：自然语言解释这个 Pass 解决什么问题。
- 触发规则列表：按源码规则拆分为可读条件。
- 当前命中规则：只显示本次 Before/After pair 实际命中的规则。
- 变化清单：新增、删除、重连、属性修改、shape/offset/dyn shape 改写。
- 置信度：`source-rule matched`、`diff-inferred`、`unexplained`。
- 源码级解释入口：用户主动展开后显示更接近源码分支条件的解释。

示例说明：

```text
OP_RESHAPE 10005 被删除。
原因：RemoveRedundantReshape::RemoveReshape 命中单输入单输出 reshape；
该 reshape 的消费者均可改接到输入 tensor，因此输出 tensor 的下游被重连，op 被标记删除。
```

#### 1.5.4 节点级原因解释

点击新增、删除或修改节点时，详情面板应显示该节点的原因解释。

字段：

- `Diff state`：added / removed / modified / rewired / same。
- `Pass cause`：命中的源码规则名称。
- `Evidence`：Before/After 中相关 tensor/op magic、shape、offset、consumer/producers。
- `Source rule`：源码文件路径与函数名。
- `Affected flow`：上游和下游受影响节点数量。
- `Action`：定位相关节点、锁定受影响 flow、查看源码路径。

#### 1.5.5 规则解释器

页面需要一个前端规则解释器，把 Pass 源码中的关键逻辑抽象成可匹配的规则。

建议数据结构：

```js
{
  passName: "RemoveRedundantReshape",
  source: {
    file: "/Users/yin/gitcode/pypto-master/framework/src/passes/tensor_graph_pass/remove_redundant_reshape.cpp",
    functions: ["RunOnFunction", "RemoveReshape"]
  },
  rules: [
    {
      id: "reshape.single_io.rewire_consumers",
      summary: "删除可被消费者改接的冗余 reshape",
      match: "removed op opcode == OP_RESHAPE && single input && single output",
      evidence: ["input tensor", "output tensor", "consumer rewiring"],
      confidence: "source-rule matched"
    }
  ]
}
```

首批规则应覆盖：

- `RemoveRedundantReshape`
  - 删除 `OP_RESHAPE`。
  - 单输入单输出校验。
  - 输出消费者改接到输入 tensor。
  - 删除 marked op 后清理。
- `DuplicateOp`
  - `VIEW` 输出多消费者时复制 `VIEW`。
  - `GATHER_IN_L1` 输出多消费者时复制 `GATHER_IN_L1`。
  - 第一个消费者保留原分支，其它消费者接入 clone tensor。
- `MergeViewAssemble`
  - 连续 `VIEW` 链可合并。
  - 连续 `ASSEMBLE` 链可合并。
  - 合并时累加 offset / dyn offset。
  - 追加合并后的 op，清理旧链和 dead op。
- `RemoveRedundantOp`
  - 删除 input/output shape 与 mem type 相同的 dummy op。
  - 动态 shape 场景需额外比较 dyn valid shape。
  - `VIEW -> ASSEMBLE` perfect match 直接重连。
  - partial match 生成新 `VIEW`。
  - 排除非同源 input 与数据重排场景。
- `SplitReshape`
  - 根据 copy-in/copy-out、reshape source、overlap status 添加新 op。
  - 处理 one-to-one、one-to-multi、multi-to-one、perfectly match 等场景。
  - 删除旧 reshape，重建 assemble/view，并更新 memory type。

所有其它 schema Pass 的默认解释策略：

- 根据源码 schema 显示 Pass 意图、文件名、函数名、rewrite target 与 match signal。
- 根据 diff group 生成 schema 级 step，如 `remove-chain`、`add-chain`、`field-update`。
- 对没有 source-rule matcher 的变化标注为 `schema-diff` 或 `unexplained`，不得伪装成 `source-rule matched`。

#### 1.5.6 变化类型分类

Diff 不应只用 `added/removed/modified`，需要扩展为更贴近 Pass 行为的分类：

| 类型 | 说明 | 示例 |
|---|---|---|
| `removed-op` | op 被删除 | redundant reshape 被删除 |
| `added-op` | op 被新增 | DuplicateOp 生成新 VIEW |
| `rewired-input` | 消费者输入被改接 | reshape output 的消费者改接到 reshape input |
| `rewired-output` | producer/output 关系变化 | assemble 链合并后输出指向新 op |
| `merged-chain` | 多个 op 合并为一个 | view chain / assemble chain |
| `split-fanout` | 一个多消费者分支被拆成多个 | DuplicateOp |
| `shape-updated` | shape / valid shape 变化 | SplitReshape |
| `offset-updated` | offset / dyn offset 变化 | MergeViewAssemble |
| `memory-updated` | asis/tobe/memory type 变化 | AssignMemoryType 或后续内存 Pass |
| `unexplained` | 有 diff 但规则未覆盖 | 需要补规则或标注未知 |

#### 1.5.7 源码依据展示

页面不需要内嵌完整源码，但需要把解释和源码入口绑定。

展示方式：

- 显示文件名与函数名，例如 `remove_redundant_op.cpp / ProcessViewAssemble`。
- 显示简短规则摘要，不长段引用源码。
- 支持点击复制本地源码路径。
- 源码级解释通过用户主动展开进入，MVP 不默认展示。
- 若未来接入本地编辑器桥接，可跳转到源码行。

#### 1.5.8 解释覆盖率

页面应显示两个层级的解释覆盖率。

Pass/目录级覆盖率：

- 源码 schema 总数。
- dump 中解析到的 pass 数。
- ready pass 数。
- ready pair 数。
- missing pair 数。

Pair 级覆盖率：

- `explained changes`：命中 source-rule 的变化数。
- `diff-inferred changes`：根据 diff 推断但未能完全证明的变化数。
- `unexplained changes`：没有规则解释的变化数。

Pass 过滤器或覆盖 chip 可用小型状态提示：

- 绿色：变化全部解释。
- 黄色：部分推断。
- 红色：存在未解释变化。
- 灰色：无变化或无 pair。

状态颜色属于数据可视化编码，不作为全局 UI token。

#### 1.5.9 与 Locked Flow 联动

从解释项进入 `Locked Flow` 时，局部子图应包含：

- 触发规则的核心节点。
- 被删除或新增节点。
- 被重连的前后输入/输出 tensor。
- 一跳上下游消费者/producer。

退出后回到完整 Before/After 对比视图，并保留当前 Pass、时间轴位置和解释项选择。

#### 1.5.10 空态与异常

空态：

- 未加载 pass folder：提示打开包含 `Pass_xx_<PassName>` 的目录。
- 已加载单图但无 pair：提示需要 Before/After 才能解释 Pass 原因。
- 当前 Pass 无变化：显示 `No structural change`，并说明该 Pass 未对当前 function/path 产生结构变化。

异常：

- 无法配对 Before/After：标注 pair missing。
- Pass 名无法映射源码规则：显示 `Rule not available yet`。
- Diff 有变化但规则未解释：标注 `unexplained`，并纳入规则补齐列表。
- 源码路径不存在：保留解释规则，但源码入口显示 unavailable。

### 1.6 验收标准

- 加载 `/Users/yin/gitcode/output_deepseek` 后，页面能解析全部 dump pass，而不是只展示规则级首批 4 个 Pass。
- 顶部 Pass 过滤器能列出 dump 中解析到的 pass，并显示 ready pair 数与覆盖等级。
- Pair 选择器能列出当前 pass 的 Before/After pair，自动优先选择 `MAIN x32 / PATH0_6` 中有结构变化的 pair。
- 进入任一可解释 Pass 后，页面能显示 Pass 源码入口、Pass 意图摘要、命中规则和变化清单。
- 右侧解释面板必须明确表达当前 pair 的多个 step；切换 pass/pair 后面板内容必须随当前 pair 更新。
- `RemoveRedundantReshape` 中被删除的 `OP_RESHAPE` 能被解释为消费者改接或冗余 reshape 删除，而不是只显示 removed。
- `DuplicateOp` 中新增的 `VIEW` 或 clone tensor 能被解释为多消费者 fan-out 拆分。
- `MergeViewAssemble` 中链路变化能被解释为 view/assemble chain merge 和 offset 重算。
- `RemoveRedundantOp` 中的 view/assemble 重连能区分 perfect match 与 partial match。
- 其它 schema pass 至少显示源码入口、Pass 意图、diff group step 和 unexplained 标注。
- Semantic 染色默认开启，并复用原 Pass-IR pipeline 色系：`Key` 紫系、`Query` 蓝系、`Weight` 青色系。
- After 对比态应 dim 未变化部分，但不能把 semantic 色系压到不可读。
- 时间轴拖动时，画布动画、解释项高亮、差异状态保持同步。
- 对无法解释的变化，页面必须明确标注 `unexplained`，不能伪装成已解释。

## 2. 样式约束

### 2.1 设计系统来源

本功能必须遵循 `/Users/yin/pto-design-system/SKILL.md`，并消费 PTO 设计系统，不创建新的视觉语言。

已读取并应遵循的设计系统文件：

- `/Users/yin/pto-design-system/references/DESIGN.md`
- `/Users/yin/pto-design-system/references/quick-reference.md`
- `/Users/yin/pto-design-system/references/pto-design-system-map.md`
- `/Users/yin/pto-design-system/references/retrofit-container-audit.md`
- `/Users/yin/pto-design-system/patterns/patterns.json`
- `/Users/yin/pto-design-system/patterns/pass-ir-graph-node/pattern.json`
- `/Users/yin/pto-design-system/patterns/floating-playback-control/pattern.json`
- `/Users/yin/pto-design-system/patterns/workbench-shell/pattern.json`

### 2.2 必须复用的系统组件与 Pattern

| 页面元素 | PTO 组件或 Pattern | 使用方式 |
|---|---|---|
| Pass-IR graph node | `patterns/pass-ir-graph-node` | 直接嵌入，使用 `window.PtoPassIrGraphNodePattern.buildNodeCardElement` 或保持现有 Pass-IR 节点合同 |
| Before/After 播放和 scrubber | `patterns/floating-playback-control` | 直接嵌入，调用 `window.PtoFloatingPlaybackControl.createControl/init/initScrubberHover` |
| 多 pane 或可拖拽解释布局 | `patterns/workbench-shell` | 仅作为 resize kernel，不承担 pane 视觉 |
| 顶部入口按钮 | `.btn` | 打开、加载、选择类入口 |
| 主要执行按钮 | `.btn.btn-solid` | 运行解释、应用筛选、生成解释这类 commit action |
| 图模式切换 | `.segmented-control` 或 `.toolbar-control` | Before/After、结果/原因、graph/cause 等互斥模式 |
| Pass / stage / status 标签 | `.badge`、status badge、`.nav-stage-chip`、`.nav-pass-dot` | 不新增私有 pill 样式 |
| 右侧解释面板 | `.panel-shell`、`.inspector-rail`、`.inspector-section`、`.inspector-soft-card` | 连续信息结构，不堆叠私有卡片 |
| 节点详情 | 现有 `.detail-*` 与 inspector classes | 保持 Pass-IR 详情交互，不新增详情面板视觉体系 |

### 2.3 Token 约束

模块 CSS 必须使用设计系统 token：

- 背景：`var(--background)`、`var(--background-elevated)`。
- 面板：`var(--surface-1)`、`var(--surface-2)`、`var(--surface-3)`、`var(--surface-4)`。
- 文本：`var(--foreground)`、`var(--foreground-secondary)`、`var(--foreground-muted)`。
- 边界：`var(--border-subtle)`、`var(--border-default)`、`var(--border-strong)`。
- 状态：`var(--success)`、`var(--warning)`、`var(--danger)`。
- 间距：`var(--space-1)` 到 `var(--space-6)`。
- 圆角：`var(--radius-sm)`、`var(--radius-md)`、`var(--radius-lg)`、`var(--radius-xl)`、`var(--radius-pill)`。
- 字体：`var(--font-sans)`，源码路径、magic、opcode、shape、offset 使用 `var(--font-mono)`。

禁止在新增 UI 中硬编码中性色、圆角、阴影、字体大小、边框和间距。

### 2.4 数据可视化颜色例外

以下颜色可以作为 data-viz-only 编码存在，但必须记录含义，且不得变成全局 UI token：

- added / removed / modified / rewired / unexplained 的差异颜色。
- Pass 解释覆盖率状态颜色。
- 图节点 semantic accent。
- 变化边、重连边、被解释边的线色。
- latency heatmap。

这些颜色只能用于图形和数据状态，不得用于普通按钮、面板、卡片或页面装饰。

### 2.5 容器与面板约束

解释面板应使用 inspector section 结构：

- 规则摘要用 `.inspector-section`。
- 当前结论用一个 `.inspector-soft-card`。
- 警告或未解释变化用 `.inspector-soft-card.is-warning` 或 `.is-danger`。
- 多条变化列表用连续 row 或 compact list，不要每条都包一张有边框的卡片。

禁止：

- 给每个解释项加私有 full border card。
- 使用 `border-left`、伪元素竖条、inset shadow、侧向渐变作为普通强调。
- 在已有 panel 内继续嵌套多个浮动卡片。
- 把旧 GraphScope 风格的白底卡片、彩色 tab、外发光阴影搬进 PTO。

### 2.6 Playback 约束

Before/After 时间轴必须消费 `floating-playback-control`：

- 不重写浮动播放 shell。
- 不本地复制 collapse 同步逻辑。
- 不本地重写 scrubber thumb、hover tooltip、按钮圆角或分隔线透明度。
- 业务页面只负责 step 数据、按钮 handler、当前 Pass 状态和解释项同步。

### 2.7 Graph Node 约束

图节点必须沿用 `pass-ir-graph-node` 合同：

- op、tensor、incast、outcast、group 不重新设计节点 chrome。
- 可覆盖节点内容、accent、selected、compact、宽高。
- 不在业务页面本地重写 group shell path。
- 不丢弃 pattern JS 负责的 compact/full 切换和 group card 生成。

### 2.8 Workbench 与布局约束

若原因解释层需要三栏或可拖拽布局：

- 使用 `workbench-shell` 作为 resize kernel。
- `workbench-shell` 不拥有页面 chrome、pane title、pane fill、工具栏或画布控件。
- pane 视觉由产品页面使用 `.panel-shell`、`.workbench-pane`、`.inspector-*` 组合实现。
- 不覆盖 `.pto-workbench-shell__*` internals。

### 2.9 文案与信息密度

页面是开发者工作台，不是营销页。

- 不使用 hero、宣传文案、装饰插图。
- 解释文案应短句、可验证、和源码规则对应。
- 避免“智能优化”“自动洞察”这类不可验证表述。
- 对未知原因必须直接标注 `unexplained`。
- 源码路径、magic、opcode、shape、offset 保持可复制和等宽字体显示。

### 2.10 预览门禁

如果现有 PTO 设计系统无法覆盖以下需求，必须先做 preview 并等待批准：

- 新的变化状态徽标形态。
- 新的解释列表容器。
- 新的图边动画视觉语言。
- 新的 timeline step marker 样式。
- 新的源码证据块样式。

批准后应先吸收到 `/Users/yin/pto-design-system` 的共享 pattern 或组件中，再在 `/Users/yin/pto/pass-ir` 消费。

### 2.11 实现后 residue check

若后续实现涉及 CSS 修改，必须执行容器装饰残留检查，至少搜索：

```text
border-left
border-inline-start
box-shadow: inset
::before
::after
outline:
linear-gradient(90deg
linear-gradient(to right
```

每个命中项必须标注：

- `removed`
- `PTO-owned`
- `data-viz-exempt`
- `needs-user-decision`

普通卡片、面板、inspector block 不允许保留未批准的左边栏、伪元素 rail、inset-left shadow 或侧向渐变。

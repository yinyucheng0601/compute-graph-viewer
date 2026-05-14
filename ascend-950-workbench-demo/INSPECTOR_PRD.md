# Inspector 模块 PRD

**产品**：Ascend 950 Workbench Demo · Inspector 模块
**版本**：v0.2（草案）
**日期**：2026-05-14
**状态**：评审中

> **v0.2 主要变更**
> 1. Inspector 的分析对象由「源码当前行」修正为「**当前 kernel 整体**」。
> 2. 新增 V2 范围：**Tiling（切分）** 与 **Pipeline（流水）** 两个可视化区段，并在数据契约、布局结构、联动逻辑中预留扩展点。

---

## 1. 背景

升腾 950 工作台用于让用户在新一代 NPU 上理解每个 kernel 的执行真相、相比 910B 的差异，并据此做出优化决策。Inspector 是工作台右侧的「kernel 解读面板」，承担：

> 当前 kernel → 它的执行成本与结构 → 我该怎么改

Inspector 的分析单位是 **kernel（算子）**，不是源码中的某一行。源码区可以高亮 reason code 对应的行作为佐证，但 Inspector 内容的"主语"始终是 kernel 本身（例如 `c_api_add`、`gelu`、`fp8_mmad`）。

当前原型已具备 Tier 切换、Cycle Split、Mode Partition、Reason Code 等渲染能力，但：
- 信息层级倒置（设置在下、摘要在上）
- 行/算子粒度混淆（部分文案以"行"为主语）
- 术语在 kernel 间漂移（DMA / memory / switch / handoff 混用）
- 缺乏可行动建议
- 尚未承载 tiling 与 pipeline——而这恰是 950 调优最关键的两块

本 PRD 重新定义 Inspector 为面向决策的 kernel 解释面板，并明确 V2 的扩展边界。

---

## 2. 目标

| 维度 | 目标 |
|---|---|
| **用户目标** | 在 30 秒内看懂当前 kernel 在 950 上的执行成本、与 910B 的差距，并知道下一步动作 |
| **业务目标** | 降低 910B → 950 的迁移评估门槛；让算子开发与编译器调优在工作台内闭环 |
| **体验目标** | 把 Inspector 从「指标罗列」升级为「带行动建议的解释器」；V2 进一步覆盖 tiling 与 pipeline 决策 |

**非目标**：
- Profile 采集本身（依赖 T3 上游产物，仅消费）
- 自动 patch / 代码改写
- 多 kernel 横向 dashboard（属于工作台主区，不在 Inspector）
- 硬件本身的架构教学（Inspector 是工具，不是文档）

---

## 3. 用户角色

| 角色 | 占比 | 主要诉求 | 关键 KPI |
|---|---|---|---|
| **算子开发工程师** Kernel Dev | ~50% | 写完一个 kernel，想知道它整体被编成什么、瓶颈在哪 | 单算子调通时间、cycle 达标率 |
| **性能优化工程师** Perf Engineer | ~30% | 已跑通，想压榨 cycle；尤其关心 tiling 与 pipeline overlap | 算子 cycle 优化幅度、pipeline 利用率 |
| **编译器工程师** Compiler Engineer | ~15% | 验证编译策略（fusion、tiling、predication）在新硬件上是否达到预期 | Tier 间一致性、reason code 合理性 |
| **架构评估师 / 售前** Architecture Evaluator | ~5% | 不写代码，只看 950 vs 910B 的对比结论 | 对比明确度、可截图传播性 |

P0 范围围绕前两类用户的 kernel 级工作流；V2 的 tiling/pipeline 进一步深化 Perf Engineer 与 Compiler Engineer 的场景。

---

## 4. 使用场景

### 当前版本（V1）

**S1 · Kernel 整体成本归因**（Kernel Dev / Perf Engineer，高频）
用户从 kernel 列表中选中一个 kernel（如 `fp8_mmad`），Inspector 立刻展示它的总 cycle、compute/data movement/mode-switch 拆分、所属架构（SIMD/Cube/Hybrid）。
> 用户的问题：「这个 kernel 贵不贵、贵在哪？」

**S2 · 调参试探**（Perf Engineer，高频）
拖动 K tile / tail length 等主切分参数，实时看 cycle 拆分与 SIMD/SIMT 占比变化。
> 用户的问题：「我改这个参数有用吗？」

**S3 · 950 vs 910B Kernel 对比**（Architecture Evaluator + Perf Engineer，中频）
切到 Compare 模式，左右并列两代芯片下同一 kernel 的执行画像。
> 用户的问题：「迁到 950 能省多少、为什么？」
> 期望：**一句结论**，例如 "950 在该 kernel 上省 34% cycle，主要来自 mode switch（FixPipe 直通 Cube）"。

**S4 · 编译层级核对**（Compiler Engineer，中频）
在 T1 Source / T2 Compiled / T3 Profiled 间切换，比对编译器中间表示与最终 profile 的偏差。
> 用户的问题：「编译器猜得准不准？」

**S5 · 可解释性 / 证据追溯**（Kernel Dev + Compiler Engineer，中频）
看到异常 cycle 占比时，展开 Debug Evidence，理解编译器为什么做出当前决定。Reason code 可关联源码行作为佐证。
> 用户的问题：「凭什么是这个结果？」

**S6 · Hybrid 决策辅助**（Perf Engineer，中低频）
看 SIMD/SIMT 分区，判断是否需要把 tail 拆分独立 kernel。
> 用户的问题：「这个 kernel 要不要重构成两段？」

### V2 新增场景

**S7 · Tiling 决策**（Perf Engineer / Compiler Engineer，V2 高频）
查看 kernel 的 tile shape（M×N×K 或对应维度）、tile 数量、L1/L2/UB 内存占用，验证 tile 是否充分利用片上存储、是否能开 double buffer。
> 用户的问题：「我现在的切分合不合理？能不能更大/更小？」

**S8 · Pipeline Overlap 优化**（Perf Engineer，V2 高频）
查看 MTE / Cube / Vector / Scalar 多个单元的时间线泳道图，识别 bubble 与关键路径，判断是数据搬运还是计算成为瓶颈。
> 用户的问题：「我的流水排满了吗？卡在谁身上？」

**S9 · Tiling × Pipeline 联动判断**（Perf Engineer，V2 中频）
改 tile 参数后实时看 pipeline overlap 变化；或反过来——pipeline 有 bubble 时回溯到 tile 配置原因。
> 用户的问题：「我换个 tile 能不能把这段 bubble 填掉？」

---

## 5. 功能需求

### 5.1 V1 · P0（首版必备）

- **F1 · Kernel 上下文锚点**：始终展示「当前 kernel 名 + 算子分类（SIMD/Cube/Hybrid/Scalar）+ 当前芯片（950 / 910B / Compare）+ 当前 Tier」
- **F2 · 分析配置面板**：Tier 切换 + 主切分参数 + tail 参数，参数变化驱动下游所有可视化实时刷新（<200ms）
- **F3 · 周期拆分卡**：单芯片下展示 total + 三段 bar（compute / data movement / mode-switch-or-sync），术语跨 kernel 一致
- **F4 · 对比差值结论**：Compare 模式下必须给出一句明确 delta 文案（"950 比 910B 省 X% Y 周期，原因是 Z"）
- **F5 · 优化建议条**：当拆分触发预设阈值（如 bridge > 30%、SIMT > 20%），显示行动建议
- **F6 · Debug Evidence**：reason code 必须以「人类可读描述 + 折叠的技术 ID」呈现，不裸出 snake_case；reason code 可关联源码行高亮
- **F7 · 状态完备**：默认 / 加载 / 空 / 不适用 / 错误 五种状态均有视觉表达

### 5.2 V1 · P1（次版补齐）

- **F8 · Tier 解释入口**：每个 Tier 按钮可展开"它表示什么、数据来源、可信度"
- **F9 · 参数单位锚点**：每个 slider 标注物理单位（elements / bytes）与合法取值
- **F10 · 跨视图联动**：点击 reason code 高亮源码区；点击 cycle bar 段高亮模式分区相应区段
- **F11 · 结论可复制**：Compare 模式下差值结论支持复制为文本/截图

### 5.3 V2 · P0（下一版核心）

- **F12 · Tiling 可视化**：展示 tile 形状、数量、片上存储占用、double-buffer 标识
- **F13 · Pipeline 泳道图**：MTE2 / MTE1 / Cube / MTE3 / Vector / Scalar 多单元时间线（其中 950 与 910B 的具体单元集合可能不同，由数据契约下发）
- **F14 · Pipeline Bubble 自动识别**：自动标注 stall 区段，关联到原因（等数据 / 等同步 / 等算力）
- **F15 · Tiling ↔ Pipeline 联动**：tile 参数变化实时刷新 pipeline；pipeline 内点击 bubble 反查 tile 配置原因
- **F16 · 关键路径标识**：在 pipeline 上明确标识 critical path，便于定位主要瓶颈

### 5.4 V2 · P1

- **F17 · Tile 容量预警**：tile 占用超过 L1/L0 容量时显式警示
- **F18 · Double-buffer 可视化**：双缓冲是否启用、是否生效，在 tile 与 pipeline 两处都体现
- **F19 · 历史对比**：参数调整后保留前一次快照，提供 before/after 切换查看

### 5.5 P2（增强项）

- **F20 · 多 kernel 横向汇总**：在 batch 选择多个 kernel 时切换为汇总视图
- **F21 · 自定义阈值**：用户配置"什么算贵"

---

## 6. 模块细分定义

### 6.1 命名原则

Inspector 的区段命名以「**用户当下在问什么**」为主语，而不是「这个区段是什么」。出发点：

- 让面板的信息架构与用户心智路径对齐——用户不会想"我现在要看上下文头"，他想的是"我在看哪个 kernel"
- 每个区段名同时就是它存在的理由；如果用户没有这个问题，对应区段就该被隐藏或降级
- 中文主标（用户问句）+ 英文副标（工程术语）双语呈现：主标用于扫读，副标用于跨团队对齐

旧名（结构式）→ 新名（用户式）对照：

| 旧名 | 新名 |
|---|---|
| Kernel 上下文头 | **A · 我在看哪个 Kernel** · Kernel Identity |
| 对比结论横幅 | **B · 一句话结论** · Verdict |
| 分析配置 | **C · 我能调什么** · Tunables |
| 周期拆分 | **D · 它贵在哪** · Cost Breakdown |
| 模式分区 | **E · 它怎么混的** · Hybrid Profile |
| 优化建议 | **F · 我该做什么** · Recommendations |
| 调试证据 | **G · 凭什么这样** · Evidence |
| 切分可视化 | **H · 它怎么切的** · Tiling 【V2】 |
| 流水可视化 | **I · 它怎么排的** · Pipeline 【V2】 |

### 6.2 整体结构

Inspector 自上而下按"用户问句"的逻辑顺序组织——先锚定主语，再给结论，然后是操作 → 拆解 → 建议 → 证据。V1 含 A–G 七段；V2 在末尾追加 H、I 两段，**不重排** V1 区段。

```
┌──────────────────────────────────┐
│ A · 我在看哪个 Kernel            │  锚定主语
├──────────────────────────────────┤
│ B · 一句话结论    Compare 模式   │  直接给答案
├──────────────────────────────────┤
│ C · 我能调什么                   │  操作入口
├──────────────────────────────────┤
│ D · 它贵在哪                     │  代价拆解
├──────────────────────────────────┤
│ E · 它怎么混的    Hybrid kernel  │  结构观察
├──────────────────────────────────┤
│ F · 我该做什么                   │  行动建议
├──────────────────────────────────┤
│ G · 凭什么这样    默认折叠       │  证据追溯
├══════════════════════════════════┤
│ H · 它怎么切的   【V2】          │  切分布局
├──────────────────────────────────┤
│ I · 它怎么排的   【V2】          │  执行流水
└──────────────────────────────────┘
```

### 6.3 线框示意 · User-view Wireframe

以 `fp8_mmad` kernel 在 Compare 模式（950 vs 910B，Tier = T2 Compiled）下的完整面板为例：

```
┌─────────────────────────────────────────────────────┐
│  Inspector                                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ▸ 我在看哪个 Kernel                                │
│  ┌─────────────────────────────────────────────┐    │
│  │  fp8_mmad                         [Hybrid]  │    │
│  │  ⟨ 950 │ 910B │ Compare ⟩   T2 Compiled ⓘ   │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ▸ 一句话结论                              [复制]   │
│  ┌─────────────────────────────────────────────┐    │
│  │  950 总 cycle  ▼ 34%                        │    │
│  │  280 cyc  →  184 cyc                        │    │
│  │                                             │    │
│  │  主要节省   mode switch  −58 cyc            │    │
│  │  原因       FixPipe 直通 Cube，无需 Vector  │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ▸ 我能调什么                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │  数据来源                                   │    │
│  │  ⟨ T1 Source │ ▸T2 Compiled◂ │ T3 Profiled ⟩│   │
│  │                                             │    │
│  │  K tile · 主切分轴 · elements               │    │
│  │  ├─────●──────────┤  128                    │    │
│  │  64                384                      │    │
│  │                                             │    │
│  │  Tail length · elements          [N/A]      │    │
│  │  ├────────────────┤  本 kernel 不适用       │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ▸ 它贵在哪                                         │
│  ┌─────────────────────────────────────────────┐    │
│  │  total 184 cyc · 主导项 compute (52%)       │    │
│  │                                             │    │
│  │  compute        ████████████░  96  52%      │    │
│  │                              ▲ +14 cyc      │    │
│  │  data movement  █████░░░░░░░  46  25%       │    │
│  │                              ▼ −12 cyc      │    │
│  │  mode switch    ███░░░░░░░░░  42  23%       │    │
│  │                              ▼ −58 cyc      │    │
│  │                                             │    │
│  │  ▲▼ = 相对 910B 的差值                       │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ▸ 它怎么混的                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │  SIMD ████████████████░░░░  72%             │    │
│  │  SIMT ████░░░░░░░░░░░░░░░░  28%  ⚠ >20%     │    │
│  │                                             │    │
│  │  模式切换  3 次 · 42 cyc                    │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ▸ 我该做什么                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │  ① SIMT 占比 28% (>阈值 20%)   est. −18%    │    │
│  │     现象  tail 段 predication fallback      │    │
│  │     原因  tile 尾部 < SIMD lane 宽度        │    │
│  │     建议  tail 拆为独立 kernel              │    │
│  │            → 跳到「它怎么切的」              │    │
│  │  ─────────────────────────────────────      │    │
│  │  ② Pipeline overlap 仅 42%     est. −18%    │    │
│  │     现象  关键路径卡在 MTE2                 │    │
│  │     建议  K tile 提升到 128                 │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ▸ 凭什么这样                          [展开 ▾]     │
│  ┌─────────────────────────────────────────────┐    │
│  │  3 条证据 · 1 primary · 2 supporting        │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ═════════════════ V2 增量 ═════════════════════    │
│                                                     │
│  ▸ 它怎么切的       【V2】                          │
│  ┌─────────────────────────────────────────────┐    │
│  │  Tile shape   M × N × K  =  64 × 64 × 128   │    │
│  │  Tile count   8 × 6 × 2  =  96 tiles        │    │
│  │                                             │    │
│  │           N axis (6 tiles × 64) →           │    │
│  │           ┌──┬──┬──┬──┬──┬──┐               │    │
│  │      M    │  │  │  │  │  │  │               │    │
│  │     8 ×   ├──┼──┼──┼──┼──┼──┤               │    │
│  │      64   │  │  │● │  │  │  │  ● 当前主轴 K │    │
│  │      ↓    ├──┼──┼──┼──┼──┼──┤               │    │
│  │           │  │  │  │  │  │  │               │    │
│  │           └──┴──┴──┴──┴──┴──┘               │    │
│  │                                             │    │
│  │  片上存储占用                               │    │
│  │  L1    ████████████░░░░  68% / 1024 KB      │    │
│  │  L0A   █████████░░░░░░░  45% /   64 KB      │    │
│  │  L0B   ████████████░░░░  60% /   64 KB      │    │
│  │  UB    ███░░░░░░░░░░░░░  18% /  256 KB      │    │
│  │                                             │    │
│  │  Double buffer   [✓ 已启用]                 │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ▸ 它怎么排的       【V2】                          │
│  ┌─────────────────────────────────────────────┐    │
│  │  Overlap     MTE × Cube  64%                │    │
│  │              MTE × Vec   38%                │    │
│  │  关键路径    占总时长 78%                   │    │
│  │                                             │    │
│  │           0    40    80   120   160 cyc    │    │
│  │   MTE2    ▓▓▓░░▓▓▓░░░▓▓▓░░░░░░░░░░░         │    │
│  │   MTE1    ░▓▓▓░░▓▓▓░░░▓▓▓░░░░░░░░░          │    │
│  │   Cube    ░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░ ◄ 关键路径│    │
│  │   MTE3    ░░░░░▓▓▓░░░▓▓▓░░░░▓▓▓░░           │    │
│  │   Vec     ░░░░░░░░░░░░░░░░░░░▓▓▓▓░          │    │
│  │                ↑                            │    │
│  │                bubble 8 cyc · 等 MTE2       │    │
│  │                                             │    │
│  │  ▓ 工作   ░ 空闲   ◄ critical path          │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**wireframe 阅读说明**：
- 每个区段都以 `▸ <用户问句>` 作为入口标题，强化"这是用户的提问"
- Compare 模式下 B 区出现一句话结论；非 Compare 模式 B 区隐藏
- E 区只在 Hybrid kernel 出现；纯 SIMD/Cube/Scalar kernel 隐藏
- G 区默认折叠，仅显示证据计数；展开后内部滚动而不撑高面板
- V2 的 H、I 区在 V1 上线时不显示；数据契约下发对应字段后再渐进开放

### 6.4 各区段详细行为

---

### A · 我在看哪个 Kernel · Kernel Identity

**目的**：让用户始终知道 Inspector 当前的「主语」是哪个 kernel。

**元素**：
- Kernel 名称 chip：`fp8_mmad`
- 算子分类 chip：`SIMD` / `Cube` / `Hybrid` / `Scalar`
- 芯片切换 segment：`950` / `910B` / `Compare`
- Tier 状态指示：`T2 Compiled`（点击展开来源说明）

**空态**：未选中任何 kernel 时显示「从左侧选择一个 kernel 以开始分析」。

---

### B · 一句话结论 · Verdict（Compare 模式）

**目的**：Compare 模式下，第一时间给出结论。

**内容模板**：
> 950 相比 910B：**总 cycle -34%（280 → 184）**
> 主要节省来自 **mode switch（-58 cyc）**
> 原因：**该 kernel 在 950 上由 FixPipe 直通 Cube，无需 Vector 桥接**

**触发条件**：仅 Compare 模式显示；其他模式隐藏整段。

**P1 增强**：右上角"复制结论"按钮（文本 + 截图）。

---

### C · 我能调什么 · Tunables

**目的**：让用户调节会影响下方所有可视化的参数。

| 控件 | 类型 | 说明 |
|---|---|---|
| Tier 切换 | 3-segment（T1 Source / T2 Compiled / T3 Profiled） | 切换数据源；每个 Tier 可展开来源、可信度、耗时 |
| 主切分参数 | slider | 名称随 kernel 动态（K tile / block length / tile size），**必须带副标题说明"当前 kernel 的主切分轴"并标注单位** |
| Tail 参数 | slider 或 disabled 占位 | 单位标注（elements）；不适用时显示 disabled + tooltip |

**交互约束**：
- 参数变化在 200ms 内驱动 D / E / F 区刷新
- V2 启用后，参数变化同样驱动 H / I 区刷新
- 参数 = 因，可视化 = 果——任何区段不应反向修改参数

---

### D · 它贵在哪 · Cost Breakdown

**目的**：把 kernel 的总代价拆开。

**结构**：
- 顶部摘要行：`total: 280 cyc · 主导项：compute (52%)`
- 三段 bar：
  - **Compute**（SIMD / Cube / SIMT 视情况）
  - **Data movement**（DMA / GM↔L2↔UB，**术语跨 kernel 统一，按 Ascend 文档命名**）
  - **Mode switch & sync**（barrier、模式切换；与 Data movement 不混用）

**业务准确性硬性要求**：
- 三段命名跨 kernel 一致
- 某段不适用时显式标注「N/A · 本 kernel 无此开销」，不省略
- 估算值带 `~` 或 `est.` 标识

**Compare 模式**：左右并排，每段差值在 950 侧用 ▲▼ + 颜色双编码标出。

**与 V2 的联动**：D 区是 H/I 区的"总账"。点击 D 区某一段（如 data movement）应高亮 I 区对应 MTE 泳道。

---

### E · 它怎么混的 · Hybrid Profile

**目的**：Hybrid kernel 下，让用户看清 SIMD/SIMT 各占多少与是否需要拆分。

**元素**：
- SIMD% / SIMT% 可视化条
- 阈值警示：SIMT > 20% 时高亮，并在 F 区生成建议
- 切换次数与切换开销 metric

**不适用场景**：非 Hybrid kernel 隐藏整段，或显式提示「本 kernel 为纯 SIMD/Cube，无模式切换」。

---

### F · 我该做什么 · Recommendations

**目的**：把 D / E / H / I 区的事实**翻译成行动**。

**展示规则**：
- 后端规则引擎驱动（基于 cycle 拆分、阈值、reason code、tiling、pipeline 综合判定）
- 每条建议结构：`【现象】 → 【可能原因】 → 【建议动作】`
- 最多 3 条，按预估收益排序
- 每条可点击展开详细说明 / 跳转到佐证区段（D / E / G / H / I）

**示例（V1）**：
> **Bridge cycles 占比 41%**
> 可能原因：tail 段触发了 SIMT predication fallback
> 建议：tail 拆分为独立 kernel，或将 tile 调整为 128 的倍数

**示例（V2）**：
> **Pipeline overlap 仅 42%，关键路径在 MTE2**
> 可能原因：tile K = 64 偏小，GM→L1 搬运未充分摊薄
> 建议：尝试将 K tile 提升到 128，预估 cycle -18%

---

### G · 凭什么这样 · Evidence

**目的**：满足 S5——为编译器工程师提供可追溯证据。

**元素**：
- Reason code 列表：

  > **GM 连续读取**（primary）
  > `contiguous_gm_load` · Arch: Cube · 源码 L48–L52

- Primary / Supporting 标签 + tooltip 解释
- 每条 reason code 可关联：源码行号、所属编译阶段、置信度

**默认状态**：折叠。展开后内部滚动而非占满 Inspector。

---

### H · 它怎么切的 · Tiling 【V2】

**目的**：让用户看清 kernel 把工作负载切成了什么形状，以及是否合理利用片上存储。

**核心元素**：

| 元素 | 形态 | 说明 |
|---|---|---|
| Tile 形状图 | 2D 网格（matmul 类）或 1D 分块（vector 类） | 视觉化呈现当前 tile 的 M×N×K 或对应维度 |
| Tile 数量 | 摘要数字 | "8 × 6 = 48 tiles" |
| 片上存储占用条 | 横向 bar | L1 / L0A / L0B / UB 各自占用百分比，超出容量红色警示 |
| Double-buffer 标记 | chip | 已启用 / 未启用 / 不适用 |
| 当前主切分轴标识 | 在 tile 图上高亮 K / M / N 轴 | 与 C 区 slider 联动 |

**业务约束**：
- tile 形状与片上存储容量必须严格按 950 / 910B 的实际架构参数渲染（不同芯片不同容量）
- 当 tile 超过 L1 容量时，必须在 F 区生成强警示

**联动**：
- C 区 K tile slider 变化 → H 区 tile 图实时重排
- H 区点击某维度（如 K）→ D 区高亮 compute 段、I 区高亮关键路径

**Compare 模式**：左右并排展示 950 / 910B 两套 tile 图，差异维度（如 950 的 L1 更大）显式标注。

---

### I · 它怎么排的 · Pipeline 【V2】

**目的**：让用户看清 kernel 在各执行单元上的时间分布，识别 bubble 与关键路径。

**核心元素**：

| 元素 | 形态 | 说明 |
|---|---|---|
| 泳道图 | Gantt 风格，x = 时间 / cycle，y = 执行单元 | 单元集合（MTE2 / MTE1 / Cube / MTE3 / Vector / Scalar）由数据契约下发，不同芯片可能不同 |
| Bubble 标识 | 泳道空白区段用斜纹 / 红色描边 | 鼠标 hover 显示 stall 原因（等数据 / 等同步 / 等算力） |
| 关键路径 | 用粗描边或独立色串联多个 stage | 标注"该路径占总时长 78%" |
| Overlap 指标 | 顶部摘要 | "Overlap 率：MTE × Cube 64% · MTE × Vector 38%" |
| 时间游标 | 可拖动竖线 | 拖动时各泳道显示该时刻状态（V2 P1） |

**业务约束**：
- 时间轴单位明确（cycle 或 ns），不混用
- 单元命名严格按 Ascend 文档（MTE1/MTE2/MTE3 含义不同，不可口语化为 "load/store"）
- 当 pipeline 数据来源为 T1 估算时，必须明确"流水形状为编译期预测，实际以 T3 为准"

**联动**：
- D 区 data movement → I 区高亮所有 MTE 泳道
- D 区 compute → I 区高亮 Cube / Vector
- I 区点击 bubble → F 区跳出对应建议
- C 区参数变化 → I 区实时重绘

**Compare 模式**：上下堆叠两条 pipeline（950 上、910B 下），同一时间轴对齐，便于直观看出 overlap 差异。

---

## 7. 数据与状态定义

### 7.1 输入契约（V1）

```
{
  kernel: {
    id, displayName,
    kind: 'SIMD' | 'Cube' | 'Hybrid' | 'Scalar',
    kSplitParamName, kSplitUnit,
    tailApplicable, sourceFileRange
  },
  chip: '950' | '910B' | 'compare',
  tier: 'T1' | 'T2' | 'T3',
  cycleSplit: { total, compute, dataMovement, modeSwitch, isEstimate },
  modePartition: { simdPct, simtPct, switchCount, switchCost } | null,
  reasonCodes: Array<{ id, humanText, level, arch, sourceLines? }>,
  findings: Array<{ phenomenon, cause, action, estimatedGain, evidenceRefs }>
}
```

### 7.2 输入契约扩展（V2）

```
{
  ...V1 fields,
  tiling: {
    dims: Array<{ name: 'M'|'N'|'K'|..., size, tileSize, tileCount, isPrimaryAxis }>,
    onChipMemory: Array<{ region: 'L1'|'L0A'|'L0B'|'UB', usedBytes, capacityBytes }>,
    doubleBuffer: 'enabled' | 'disabled' | 'n/a',
    layout: '2D' | '1D' | 'custom'
  } | null,
  pipeline: {
    timeUnit: 'cycle' | 'ns',
    units: Array<'MTE2'|'MTE1'|'Cube'|'MTE3'|'Vector'|'Scalar'>,
    segments: Array<{ unit, start, end, stage, isBubble, stallReason? }>,
    overlapMetrics: Array<{ pair: [unitA, unitB], overlapPct }>,
    criticalPath: Array<segmentId>,
    source: 'estimated' | 'profiled'
  } | null
}
```

V1 实现需在数据层与 UI 容器上预留 `tiling` / `pipeline` 字段为 null 的兼容（不渲染对应区段）。

### 7.3 状态矩阵

| 状态 | 触发 | 表现 |
|---|---|---|
| Default | 已选中有效 kernel | 全量渲染 |
| Empty | 未选中 kernel | 空态插画 + 引导文案 |
| Loading | Tier 切换 / 数据获取中 | 骨架屏，控件禁用 |
| N/A | 当前 kernel 在该 Tier 下无数据 | 仅显示 A 区 + 一段解释，提示切换 Tier |
| Error | 数据异常 / 上游报错 | 错误提示 + 重试按钮，保留 A 区 |
| Partial（V2） | V2 区段数据缺失但 V1 完整 | V1 区段正常渲染，H/I 区显示「该 Tier 暂无 tiling/pipeline 数据」 |

---

## 8. 非功能性需求

- **响应性能**：参数调整 → 可视化刷新 < 200ms（demo 数据规模）；V2 pipeline 渲染在 100 段以内保持 < 300ms
- **语言规范**：
  - section 标题统一中文
  - 技术 token 保留英文（T1/T2/T3、SIMD/SIMT/Cube、MTE1/MTE2/MTE3、reason code ID）
  - 正文混排同层级一致
- **可访问性**：所有 chip / button 有 aria-label；颜色非唯一编码维度（差值需 ▲▼ + 颜色双编码）
- **可截图友好**：Compare 模式下整个 Inspector 可一屏内截清；V2 启用后允许 H / I 区独立截取
- **可扩展**：V2 区段以独立卡片插入，不重排 V1 区段；数据契约对未来更多硬件单元开放

---

## 9. 验收标准

### 功能性
- [ ] V1 P0 功能在 950 / 910B / Compare 三种模式下均可用
- [ ] 参数变化驱动可视化更新 ≤ 200ms
- [ ] 五种基础状态（Default / Empty / Loading / N/A / Error）均有视觉验证
- [ ] V2 启用后 Partial 状态正确降级

### 用户测试（5 名目标用户，每类至少 1）
- [ ] 30 秒内能说出"当前 kernel 贵在哪"——通过率 ≥ 80%
- [ ] Compare 模式下能复述一句差值结论——通过率 ≥ 90%
- [ ] 看到 Debug Evidence 后能说出"primary 与 supporting 的区别"——通过率 ≥ 70%
- [ ] （V2）能在 pipeline 图上指出 bubble 与关键路径——通过率 ≥ 80%
- [ ] （V2）能根据 tiling 图判断当前 tile 是否超出 L1 容量——通过率 ≥ 80%

---

## 10. 范围与里程碑

| 里程碑 | 内容 | 备注 |
|---|---|---|
| **V1** | A–G 区，F1–F11 | 当前重构目标；修正层级、术语、行/算子粒度问题 |
| **V2** | 追加 H、I 区，F12–F19 | Tiling 与 Pipeline 可视化、联动、bubble 识别 |
| **V3+**（暂定） | F20、F21 多 kernel 汇总、自定义阈值 | 视用户反馈再排期 |

---

## 11. 开放问题

1. Findings 的规则引擎是前端硬编码还是上游下发？影响 V2 联动规则的迭代成本
2. T3 Profiled 数据缺失时是降级到 T2 还是显式提示"无 profile 可用"？V2 的 pipeline 在估算 vs 实测之间的区分尤为重要
3. Compare 模式是否允许"Tier 不一致对比"（如 950-T3 vs 910B-T2）？
4. Reason code 的人类描述是否支持中英切换，还是固定单语？
5. V2 Pipeline 中，950 与 910B 的执行单元集合不一致时（如 950 多出某个单元），左右对比应如何对齐？
6. Tiling 图在非 matmul 类 kernel（如纯 vector add、reduce）上的退化形态——是否统一为 1D 分块视图？

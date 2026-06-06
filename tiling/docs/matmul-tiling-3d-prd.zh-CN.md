# MatMul Tiling 约束 & 性能 Workbench 产品需求文档（PRD）

状态：草稿 v2.2（open questions 已收敛：场景驱动单点 + safe default seed + Future 动态曲线）
Owner workspace：`/Users/yin/pto/tiling`
关联页面：`/Users/yin/pto/tiling/index.html`（现有 trace replayer，本页是其姊妹页）
关联规格：[matmul-tiling-3d-spec.zh-CN.md](matmul-tiling-3d-spec.zh-CN.md)
心智模型来源：[ascend-tiling-visualization-knowledge.md](ascend-tiling-visualization-knowledge.md)
真实流程调研：[ascend-tiling-真实算子开发流程的调研.md](ascend-tiling-真实算子开发流程的调研.md)
上层规格：[ascend-viz-puzzle-spec.zh-CN.md](ascend-viz-puzzle-spec.zh-CN.md)
证据来源：`asc-devkit-master/impl/adv_api/tiling/matmul/matmul_tiling_algorithm.cpp`、`matmul_tiling_base.cpp`

---

## 0. 这次重写改了什么（给 reviewer）

v1 PRD 把 hero 定为"把 `M/N/K` 切成嵌套小盒子"——这是**逻辑切分**，是被动的展示。但读真实 tiling 算法源码后确认：算法本身几乎不纠结"切成几块"，它只硬性关心两件事——

1. **塞不塞得下**（base tile 必须装进固定大小的片上 buffer，否则 tiling 非法）；
2. **快不快**（算法内置 cost model：算力强度、cycle 估算、double buffer 流水权衡）。

所以本页重新定位为：**让开发者在改 tiling 参数的同时，实时看到"能不能切这么大（硬件约束）"和"切这么大快不快（性能反馈）"**。逻辑切分降级为辅助视图，物理约束 + 性能上升为主线。

**v2.1 补充（真实工作流调研后）**：进一步深入 CANN 源码与真实推理算子开发流程后（完整调研见 [真实算子开发流程的调研](ascend-tiling-真实算子开发流程的调研.md)，§13–§22，全部带 gitcode 证据），确认了几条会影响产品形态的前置事实：

1. **tiling 是运行时按 shape 算的函数，不是写死的数字**（真实流程调研 §13）。开发者交付的是「给定硬件 + 任意 shape → 算 tiling」的逻辑。
2. **输入 tensor 的 shape 是给定的，不是开发者调的**（真实流程调研 §14）：`M = batch×seq`（随推理请求变），`K/N` 来自 weight（模型固定），硬件来自部署。开发者只是「面向」某段 shape，不"调" shape。
3. **面向推理，存在 prefill（M 大）/ decode（M=1）两极**（真实流程调研 §15），同一算子靠多个 **tiling key** 覆盖整段 shape（真实流程调研 §16）。
4. **开发者的起点是一个「安全默认」**（matmul 自动 tiling 算法 / 模板，真实流程调研 §20）——它保证合法（塞得下）但不保证快。
5. **代码里没有给开发者看的 per-shape 性能反馈**（真实流程调研 §18）：开发者写/调 tiling 时是半盲的。

由此本页的真实场景从「开发者拖滑块、工具当裁判」修正为「**开发者给定场景（当前 shape + 芯片），从安全默认 seed 出发，工具解释这组 tiling 为什么合法/不合法、性能趋势如何，并允许手动 what-if 覆盖**」。详见 §2 缺口 3 与 §4 场景。交互方向已在 §14 收敛：本期是**场景驱动的单点 workbench**，动态 shape 扫描保留为 Future。

---

## 1. 一句话定位

一个 **MatMul tiling 约束 & 性能反馈台**：左侧是真实 Ascend C MatMul tiling 源码与可调参数，右侧**双主视觉并列**——逻辑切分（`M×N×K` 怎么分）↔ 物理约束（base tile 怎么塞进 L0A/L0B/L0C/L1），两边由同一组参数联动。改一个参数，立刻看到塞得下/塞不下（红绿）和一个半定量性能分。

## 2. 体验缺口（为什么需要这一页）

现有 `index.html`（trace replayer）回答"某条执行 step 正在触碰逻辑 tensor 的哪一片"，擅长**回放一次执行**。但开发者写 tiling 时真正卡住的不是这个，而是两个更前置、更痛的问题：

### 缺口 1 ·「当前硬件下，我到底能切多大？」

tiling 参数是一堆扁平整数，但它们受**固定大小的片上 buffer 硬约束**，而这层约束在代码里完全不可见：

- base tile 必须同时塞进 L0A(`baseM×baseK`)、L0B(`baseK×baseN`)、L0C(`baseM×baseN`)，超了 tiling 直接非法——不是慢一点，是编不过/报错。
- **反直觉点**：`L0C` 永远按 FP32(4 字节) 计，不管输入是不是 fp16 → `baseM×baseN` 往往是**最先爆的那个**，新手最容易栽。
- **反直觉点**：开 double buffer 需要同一个 buffer 里放下**第二份 tile** → 合法容量不变，但想靠 DB 提速，base tile 就得留下 2× 空间余量。
- 这些容量是隐性知识（L0A/L0B 64KB、L0C 128KB、L1 512KB~1MB，随芯片不同），开发者脑子里根本没有这把"尺子"。

→ 现状是试错：改个 base 值、跑一遍编译、看报不报错。**缺一把能实时量出"还剩多少空间"的尺子。**

### 缺口 2 ·「切多大，性能更好？」

就算塞得下，不同切法性能差很多，而"为什么这个更快"是纯隐性经验：

- base tile 太小 → 被访存带宽拖死（算力强度低）；太大 → 塞不下或开不了 double buffer。中间有个甜点。
- `iterateOrder`（M 优先/N 优先）决定哪个矩阵在 L1 里反复 reload。
- double buffer 开不开，是 buffer 占用 vs 流水重叠的权衡。

算法源码里其实**真有一个 cost model**（`ComputeIntensity`：算力 cycle / 访存字节 排序），但开发者看不到这个评分，只能凭感觉调。

→ **缺一个"这个切法大概好不好"的即时反馈分。**

### 缺口 3 ·「shape 一直在变，tiling 决策跟着变，但这条曲线看不见」

推理场景的输入 shape **不固定**：tokenize 后 `seq` 随用户输入长度变，`batch` 随并发数变，`M = batch×seq` 从 decode 的 **1** 到 prefill 的**几千**横跨几个数量级（真实流程调研 §14/§15）。真实 tiling 是运行时按 shape 现算的函数，且必须靠多个 **tiling key** 覆盖整段范围（真实流程调研 §16，例 `MoeGatingTopKHash` 7 个 key）。

所以开发者面对的不是"某一组 tiling 好不好"，而是 **"一条随 M 变化、带断点的决策曲线"**：哪段 shape 合法、哪里性能掉、哪里必须换 tiling key（断点来自对齐边缘、尾块、full-load→split 翻转、key 阈值，真实流程调研 §21）。这些断点**大多是解析可算的**（fit 判定、整除、不等式），但开发者手里没有这条曲线，只能**手猜测试 shape**、猜不准就漏测（真实流程调研 §21）。

→ **缺一张"shape 扫过去，合法性 / 性能 / 该换 key 的断点"的地图。**

> 小结：v1 PRD 想补的"参数→几何形状"是最浅的一层。真正的三个缺口是：**① 参数→硬件约束（能切多大）**、**② 参数→性能（切多大快）**、**③ shape→决策曲线（动态下决策怎么变、哪里有断点）**。①② 是单点的约束与性能反馈，③ 是把单点沿 shape 轴扫成一条曲线/地图。
>
> **范围裁定（v2.2，对齐 spec 数据模型）**：①② 是本期（M1–M3）MVP；③ 的「沿 M 轴扫描的断点地图」是**北极星，本期不实现**，放入 **Future（后续阶段）**（见 §9）。本期对动态/多 key 只做**静态层面**的体现：在选定 shape 上做单点约束+性能，并把"哪段 shape 该用哪个 tiling key"作为**静态策略分段条**呈现（不做交互式扫描曲线）。这样 PRD 主张与 spec 单点数据模型一致。

## 3. 目标 / 非目标

### 3.1 目标

- **把硬件约束变成看得见的尺子**：L0A/L0B/L0C/L1 画成固定大小容器，当前 base tile 塞进去，占用百分比 + 塞不下变红。
- **把性能变成即时分**：基于算法真实 cost model，给出半定量读数（算力强度、估算 cycle、double buffer 流水对比）。
- **双主视觉联动**：左逻辑切分（`M×N×K`）↔ 右物理约束（buffer 占用），同一组参数实时驱动两边。
- **实时调参**：改 `baseM/N/K`、`singleCoreM/N/K`、`usedCoreNum`、dtype、double buffer 开关 → 约束容器、性能分、逻辑几何全部即时更新。
- 左侧用真实 MatMul tiling 源码，关键字段与右侧两个视图**双向高亮**。
- 全程复用 PTO design system 与现有页面的 WebGL/高亮能力，**不引入外部库**。

### 3.2 非目标

- 不做 trace 回放（那是 `index.html` 的职责），不消费 `steps`。
- 不实际调用真实 `MatmulTilingAlgorithm` / CANN compiler。约束校验与性能评分用**页内复刻的简化公式**（基于源码、显式标注"近似、非编译器输出"）。
- 不做 Puzzle / Developer / Evidence 模式（上层 spec 后续阶段）。
- 不发明新 button/card/pane/配色体系（设计系统治理同上层 spec）。
- 不覆盖 conv3d/vector 等其它算子。
- **不做融合算子（matmul + vector epilogue）与 AIC→AIV 数据流**。这条线只在融合场景才有意义、且会显著加重 MVP（需同时建模 Cube/Vector 双方），故本期排除；但其调研结论已归档于 §13，供后续里程碑取用。本期芯片版本差异仅体现为 buffer 尺寸 + btSize（见 §5.3）。

## 4. 目标用户与场景

- **主用户**：写/调 Ascend C MatMul 类算子 tiling 的算子开发者。**工具的"用户"= 开发者**；而 `batch/seq` 是终端推理请求决定的**工作负载**，开发者不"调"它，只"面向"它。
- **次用户**：讲解/评审 tiling 取舍的人（teaching / review / 文档配图）。

### 4.1 真实推理场景（grounded，带 knowledge 证据）

这些场景来自对真实推理算子开发流程的调研（真实流程调研 §13–§21），是本工具要服务的核心。

**场景 A · Decode 的 M=1 退化（最痛）**
部署 LLM 推理，decode 阶段每步只生成 1 个 token、batch 又常小 → `M = batch×seq` 极小甚至 = 1（真实流程调研 §15）。开发者拿到自动 tiling 的安全默认（真实流程调研 §20），但在 M=1 上算力强度极低、很慢。他需要知道：**这个 shape 下默认切法为什么慢、是约束卡了还是访存拖了、该不该为它单独换一套 tiling key。**

**场景 B · Prefill 的大 M**
长 prompt 一次吃进 → `seq` 大 → M 大、近方阵，base 能切大、算力跑满（真实流程调研 §15）。开发者要确认：**默认切法在这一端塞不塞得下、是不是已接近最优。**

**场景 C · 一个算子覆盖整段 shape（动态 shape 的核心）**
因为输入 shape 不固定，开发者必须写**多个 tiling key** 覆盖 `M ∈ [1, max_batch×max_seq]`（真实流程调研 §16）。他需要看清：**断点落在 M 轴哪里**（对齐边缘、尾块、full-load→split 翻转、key 阈值，真实流程调研 §21），才能正确切分 key、并选中能暴露问题的测试 shape——而不是手猜。
> 范围：本场景的**交互式 M 轴扫描断点地图属 Future（北极星，本期不做）**。本期只支持"切到某个具体 shape 看单点结果"，并以**静态策略分段条**说明哪段 M 该用哪个 key（见 §2 小结裁定）。

**场景 D · 换芯片部署**
同一份 tiling 从 910B 换到 950，buffer/btSize 变（真实流程调研 §17）。开发者要确认：**默认切法换硬件后是否还塞得下、占用余量变了多少。**（纯 matmul 差异主要是 btSize；融合的 AIC→AIV 差异本期不做，见 §13。）

### 4.2 理解与调优场景（覆盖在安全默认之上的手动探索）

在某个选定 shape 上，开发者手动改某个值看后果，用于建立直觉：

1. dtype 改成 fp32 → L0C 占用翻倍、最先爆红 → 理解"L0C 恒按 FP32 算"（真实流程调研 §17）。
2. 开 double buffer → 对应容器点亮"第二份 tile"余量；若 `2×used > full` 则 warning 提示此 base 开不了 DB → 理解"提速代价是切更小"。
3. 调 base 三个值找甜点 → 性能分（算力强度）随之起伏 → 找既塞得下又分高的组合。
4. 切 `iterateOrder` → 看哪个矩阵在 L1 reload 次数变化 + 性能分变化（真实流程调研 §18）。

> 4.1 是「场景给定 → 工具揭示决策」（动态、跨 shape）；4.2 是「单点手动 what-if」（理解约束与性能）。两者互补：前者回答"我该怎么 tile"，后者回答"为什么这样更好"。

## 5. 数据来源

### 5.1 选定文件（已与用户确认）

| 用途 | 文件 |
|---|---|
| 左侧主源码（tiling 入口实现） | `asc-devkit-master/impl/adv_api/tiling/matmul/matmul_tiling.cpp` |
| `TCubeTiling` 字段定义（参数锚点） | `asc-devkit-master/include/adv_api/matmul/matmul_tilingdata.h` |
| 约束/性能公式与硬件常量（实现页内复刻的依据，不直接展示） | `matmul_tiling_algorithm.cpp`、`matmul_tiling_base.cpp` |

### 5.2 为什么选 MatMul `TCubeTiling`

候选清单里，MatMul `TCubeTiling` 是**唯一同时满足**"天然三维 + 有真实硬件约束 + 有真实 cost model"的算子：`M×N×K` 三个轴、三层尺寸（全局/单核/base）、且算法里有完整的 buffer 容量校验和性能排序。rms_norm/swiglu 是 2D；lightning_indexer 只有 shape 校验、没切块；conv3d 虽 3D 但结构更重、不如 matmul 标志性。

### 5.3 真实硬件常量（来自 `matmul_tiling_base.cpp:33-59`）

> ⚠️ 两套数要分清：**显示容量**（标称、好记，用于刻度标签）vs **计算容量**（源码实际用于约束校验的值）。910B 的静态 fallback 里 `L1_SIZE = 512*1024 - 256`、`UB_SIZE = 192*1024 - 256`（`matmul_tiling_base.cpp:52-58`），那个 `-256` 是真正进约束的值；3113 fallback 的 `L1_SIZE = 512*1024`（无 -256）。**约束校验必须用计算容量。**

| 芯片 | L0A | L0B | L0C | L1（显示/计算） | UB（显示/计算） | btSize |
|---|---|---|---|---|---|---|
| Ascend 950（DAV_3510）★平台 API | 64KB | 64KB | 128KB | 512KB | 118KB | **0** |
| Ascend 910B/310B（DAV_2201）★fallback | 64KB | 64KB | 128KB | 512KB / **512KB−256** | 192KB / **192KB−256** | **1024B** |
| Ascend 3113 ★fallback | 32KB | 32KB | 64KB | 512KB / 512KB | 118KB | 见下 |

> **来源差异（重要）**：910B/3113 的数来自 `#if/#else` 静态 fallback（`:33-59`）；**950 的 buffer 尺寸不在这张 fallback 表里，是运行时由平台 API（`GetCoreMemSize`，`:171-189`）取的**——我们页内只能用调研到的标称值近似，须标注"非源码常量、平台 API 运行时值"。
> **btSize 也分两条路径**：静态 fallback 里 `BT_SIZE = 1024` 对所有分支成立（含 3113）；但平台 API 路径（`:186-189`）按 `socVersion` 判定——**仅 910B/310B = 1024，其余（含 950、3113）= 0**。本工具以平台 API 路径为准：910B/310B=1024，950=0，3113=0。
> 对**纯 matmul**，950 与 910B buffer 容量基本一致，可见差异是 **btSize**（910B 在 L1 预留 1024B → 可用 L1 略少）。芯片版本对 tiling 的**结构性**差异（AIC→AIV 通路）只在融合场景出现，本期不做，见 §13。

### 5.4 约束公式（来自 `matmul_tiling_algorithm.cpp`，页内复刻依据）

> ⚠️ **关键纠正（对齐源码）**：源码的"装得下"判定用的是 **`/ DB_OFF`（=1，即整块满容量）**，并**不**把 double buffer 砍半算进合法性。`CheckL0ASize/B/C` 一律 `loadSize ≤ size / DB_OFF`（`:3845/:3884/:3921`，`DB_ON=2 / DB_OFF=1` 定义于 `matmul_tiling_algorithm.h:30-31`）。double buffer 能不能开是**第二层**的事，由 `GetL0cDB`/`CheckL0DB`（`:564-612` 等）在合法 base 之上再判流水收益与剩余空间。所以本工具拆成两层，不要把"开了 DB 塞不下"直接画成 tiling 非法：

| 层 | 约束 | 公式 | 源码位置 |
|---|---|---|---|
| ① 合法装下（满容量） | L0A | `baseM*baseK*dtypeBytes ≤ L0A`（满，不砍半） | `CheckL0ASize` :3843 |
| ① 合法装下 | L0B | `baseK*baseN*dtypeBytes ≤ L0B` | `CheckL0BSize` :3881 |
| ① 合法装下 | L0C | `baseM*baseN*4 ≤ L0C`（**恒按 FP32**） | `CheckL0CSize` :3918 |
| ① 合法装下 | L1 暂存 | `depthA1Size*Abytes + depthB1Size*Bbytes ≤ L1 − btSize` | `CalcL1Tiling` :2605 |
| ① 对齐 | 几何 | `baseM/baseN` 须为 C0_SIZE(16) 的倍数 | :3852/:3927 |
| ② DB 可开（流水增益） | 各 buffer | 在 ① 合法基础上，`2 × loadSize ≤ size` 才有空间开 DB；再比流水收益 | `GetL0cDB` :564-612 |

> UI 表达：① 决定"红/不红（非法）"，② 决定"能不能点亮 DB / 点了之后是否还塞得下"。两者视觉上要区分——非法（爆红）≠ "开了 DB 才超"（可提示但不是非法 tiling）。

### 5.5 性能 cost model（来自 `matmul_tiling_algorithm.cpp`，半定量复刻依据）

| 维度 | 逻辑 | 源码位置 |
|---|---|---|
| 算力强度（主指标） | `avgIntensity = computeCycle / memoryTraffic`，越高越好 | `ComputeIntensity` :330-345 |
| 访存量 | `aRatio*baseM*baseK*tA + bRatio*baseK*baseN*tB`（**只算 A、B 两项，源码无 C 项**） | `CalculateMemoryTraffic` :2333-2339 |
| 估算 cycle | `CalculateBlockCycles(baseM,baseN,baseK)` | :2472 |
| double buffer 取舍 | 比 `dbOnPipeTime` vs `dbOffPipeTime`，短者胜 | `GetL0cDB` :564-612 |
| iterateOrder | 按 A/B 在 L1 的 reload 次数选 M 优先/N 优先 | `GetIteratorOrder` :1980-2011 |

### 5.6 `TCubeTiling` 字段 → 视图映射（核心契约）

| 视图 | 字段 | 含义 |
|---|---|---|
| **物理约束（主）** | `baseM/baseN/baseK` + dtype + `dbL0A/dbL0B/dbL0C` | 决定 L0A/L0B/L0C 容器占用；DB 开关显示第二份 tile 余量 |
| **物理约束（主）** | `depthA1/depthB1/stepKa/stepKb` | 决定 L1 暂存占用 |
| **逻辑切分（辅）** | `M/N/Ka/Kb` | 全局线框盒子 X(N)/Y(M)/Z(K) |
| **逻辑切分（辅）** | `usedCoreNum/singleCoreM/N/K` | 单核 slab；核数决定切几块 |
| **逻辑切分（辅）** | `baseM/N/K` | 最内层 base tile（与物理视图共享同一组值，是联动锚点） |
| **性能分** | 上述全部 + `iterateOrder` | 喂给 cost model 算分 |

> `Z` 轴在逻辑视图里表示 **K-axis reduction 累加进度**，不是物理深度。必须 UI 标注（沿用 knowledge 第 7/9/11 节）。

## 6. 功能需求

### 6.1 左侧 · Tiling 代码 + 参数面板

- 展示选定源码，复用 `highlightAscendC` 风格高亮；`TCubeTiling` 关键字段为可点击锚点。
- 场景控件（PTO base class，不自造）：preset、chip、dtype、`batch/seq/K/N`，派生 `M=batch×seq`；裸 `M/N/K` 只在 Advanced 中覆盖。
- tiling 参数控件：`baseM/N/K`、`singleCoreM/N/K`、`usedCoreNum`、double buffer 三个开关、`iterateOrder`。
- 任意参数变化 → 右侧两视图 + 性能分实时更新。

### 6.2 右侧下 · 物理约束视图（★ 分析核心）

- 复用 `aic-core-object` pattern（AIC 内部对象：L1 大卡 + L0A/L0B 微 buffer + 中央 Cube + L0C 卡），它正好是 matmul 要展示的片上 buffer 集群。**本页必须为它建一份 matmul preset**，覆盖 L0C/L0A/L0B/L1 的 capacity 与 grid 映射（默认 preset 的 L0C 是 512KB、与 matmul 的 128KB/64KB 不符，详见 spec §6）。
- 当前 base tile 在各 buffer 的占用经 pattern 的 `setBufferBlocks` 表达（填充比例 = `used/满容量`），标占用百分比。占用按 §5.4 两层呈现：
  - **第一层·合法性**：占用对比**满容量**（不砍半）。超 100% → 整块变红（error 态）= tiling 非法。
  - **第二层·DB 余量**：再叠加显示"开 DB 需 2× 空间"——当 `2×used ≤ 满容量` 时 DB 可点亮；当 `used ≤ 满容量 < 2×used` 时，base 合法但开 DB 会超，用 warning 态提示（**不是非法**），不要画成红。
- double buffer 开关切换时，对应 buffer 显示"占两份"的余量变化并动效过渡——表达的是第二层余量，不是把合法容量砍半。
- 显式标注 L0C 恒按 FP32 计算（关键教学点）。

### 6.3 右侧上 · 逻辑切分视图（辅）

- WebGL 三层嵌套盒子：全局 `M×N×K`(线框) → 单核 slab(`singleCore*`，按核着色) → base tile(`base*`，实心)。
- 可 orbit/zoom/fit，复用现有 viewport 控件。
- base tile 与下方物理约束视图**共享同一组 `base*` 值**——这是两个视图的联动锚点。
- no-WebGL fallback：退化为 2D 切块示意 + 提示。

### 6.4 性能分

- 基于 5.5 复刻的半定量 cost model，给出：算力强度（主分）、估算 cycle、double buffer on/off 对比、当前 `iterateOrder` 的 reload 评估。
- 参数变化实时重算；显式标注"半定量估算，非编译器真实输出"。

### 6.5 联动

- 改参数 → 物理容器 + 逻辑几何 + 性能分三处同步。
- 悬停代码字段 ↔ 高亮其影响的容器/几何层 ↔ 反向，双向。
- 约束违例（某容器爆红）时，左侧对应字段同步标红，给出"哪个约束被突破"。

## 7. 信息架构 / 页面布局

```text
┌──────────── ide-frame topbar（标题 + 芯片选择 + dtype + DB 开关） ────────────┐
├────────────────────────────┬─────────────────────────────────────────────────┤
│ 左 Pane：源码 + 参数控件    │ 右上 Pane：逻辑切分（M×N×K 嵌套盒子，WebGL）     │
│  - 源码 + 高亮 + 字段锚点   │   - orbit/zoom/fit；base tile 与下方联动         │
│  - batch/seq/K/N + Advanced M/N/K │ ─────────────────────────────────────────── │
│  - dtype / DB / iterateOrder│ 右下 Pane：物理约束（aic-core-object）★分析核心  │
│  - 性能分读数              │   - L1/L0A/L0B/Cube/L0C 卡 + 占用 + 爆红         │
│                            │   - DB 第二份余量动效                            │
└────────────────────────────┴─────────────────────────────────────────────────┘
```

外层两栏横向 split（`workbench-shell`）；右栏内部上下分（逻辑切分在上、物理约束在下）。

## 8. 视觉与设计系统约束

- 复用 `../vendor/pto-design-system/` 的 tokens/components/patterns（同 `index.html` 加载方式）。
- 复用 pattern：`ide-frame`（外壳）、`workbench-shell`（split）、`aic-core-object`（物理约束视图基底：AIC 内部 L1/L0A/L0B/Cube/L0C，遵守其 pattern.json 契约）、`floating-playback-control`（动画，M3）。
- 暗色用中性灰（如 `#292929`），禁止蓝调暗色。
- 约束爆红/正常用 PTO 语义色（error/success），不自造。
- WebGL 3D 属现有页面已有能力，沿用；不新增 button/toggle/card/pane/配色体系。
- 卡片不套卡片，按 L1/L2/L3 三级收敛；callout 用完整 1px border + 背景，不用左侧高亮条。

## 9. 范围与里程碑

> M1–M3 全部是**单点**（在某一选定 shape / 一组参数上）的约束与性能反馈（缺口 ①②）。动态 shape 的交互式扫描（缺口 ③）单列为 Future（后续阶段）。

- **M0（本文档阶段）**：PRD + spec 定稿确认。
- **M1（约束 MVP）**：新页 `matmul-tiling.html` 上线，含左侧源码+参数、右下物理约束（`aic-core-object` + matmul preset：占用 + 合法爆红 + DB 余量两层）、芯片/dtype 切换。**先把"能切多大"讲透。**
- **M2（性能层）**：接入半定量 cost model（算力强度/cycle/DB 对比/iterateOrder），性能分读数 + 联动。
- **M3（逻辑视图 + 联动收尾）**：右上 WebGL 逻辑切分盒子、与物理约束视图 base tile 联动、代码↔视图双向高亮；多 tiling key 以**静态策略分段条**呈现。
- **M4（可选）**：与 `index.html` cube fixture 打通，导出参数为 trace tiling 段。
- **Future（北极星，后续阶段）**：动态 shape 决策曲线 / 断点地图（缺口 ③ / 场景 C）——沿 M 轴扫描，画合法性 + 性能 + 该换 key 的断点。需在数据模型上引入 `shapeRange + keySegments + scanResult`（spec 当前为单点模型，未落地）。

> 说明：按用户选定的"半定量 cost model"，性能不拆成纯后置里程碑，而是 M2 紧跟约束 MVP；逻辑切分视图相对降级到 M3。动态曲线是后续北极星，避免 MVP 过载（详见 §2 小结范围裁定）。

## 10. 验收标准

### M1（约束）
- [ ] 新页独立存在，**不改动** `index.html` 任何现有行为（含自动加载示例）。
- [ ] 左侧展示选定源码，关键字段为可交互锚点；参数控件齐全。
- [ ] 右下用 `aic-core-object` 渲染 L1/L0A/L0B/Cube/L0C，base tile 占用百分比正确（按 5.4 公式）。
- [ ] 改 base/dtype/DB → 占用与爆红状态实时更新。
- [ ] 约束分两层呈现：满容量合法性（error）与 DB 第二份余量（warning）视觉区分。
- [ ] 明确标注 L0C 恒按 FP32、DB 需要第二份空间两个关键点。
- [ ] 切芯片 → buffer 满格刻度按 5.3 常量变化。

### M2（性能）
- [ ] 性能分（算力强度为主）随参数实时重算，公式对齐 5.5。
- [ ] DB on/off、iterateOrder 切换时性能分有可解释的变化。
- [ ] 标注"半定量估算，非编译器输出"。

### M3（逻辑 + 联动）
- [ ] 右上 WebGL 三层嵌套盒子可 orbit/zoom/fit。
- [ ] base tile 在物理约束视图与逻辑视图联动一致。
- [ ] 代码字段 ↔ 视图双向高亮；约束违例时左侧字段同步标红。
- [ ] UI 标注"3D 是逻辑/执行空间，K 为 reduction，非物理 3D 内存"。

### 通用
- [ ] 全程复用 PTO design system，无外部库，无私有视觉样式。
- [ ] 浏览器内验证通过（按现有 HTTP serve 从父目录起服务）。

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 页内复刻的约束/性能公式与真实编译器有偏差 | 全程标注"近似/半定量、非编译器输出"；公式逐条对齐源码并注明行号 |
| 性能分被误当成"绝对真值" | 强调它是相对趋势指标，用于比较切法优劣，不是预测实测耗时 |
| 把逻辑 3D 误解成物理 3D 内存 | UI 显式标注（沿用 knowledge 第 9/11 节） |
| buffer 容器视觉自造样式泄漏进 PTO | 复用 `aic-core-object` pattern，遵守其 pattern.json 契约（不改 shell/不克隆 DOM），不新建视觉 token |
| 芯片常量随版本变化 | 常量集中成一张表，注明来源行号，易更新 |
| `matmul_tiling.cpp` 是 wrapper、字段在 `.h` | 左侧同时展示入口 cpp + `TCubeTiling` 定义，互链 |

## 13. 已归档（暂不实现）：芯片版本对融合 tiling 的影响 — AIC→AIV 通路

> 调研结论保留在此，供后续融合里程碑取用。本期工具不实现，芯片版本仅影响 buffer 尺寸 + btSize（§5.3）。

### 13.1 实锤证据

`matmul_chip_cap.h` 每款芯片硬编码了能力表，关键字段 `ifSupportL0CToUB`：

| 芯片 | `ifSupportL0CToUB` | Fixpipe 硬件 | 源码 |
|---|---|---|---|
| 910B（DAV_2201） | **false** | V220 | `matmul_chip_cap.h:104-105` |
| 950（DAV_3510） | **true** | **V310** | `matmul_chip_cap.h:110-111` |

`ifSupportL0CToUB` 即 AIC（Cube）→AIV（Vector）的片上直连通路开关。AIC:AIV 比例为 **1:2**（`platform_ascendc.cpp:31` `MIX_AIC_AIV_RATION_910B1=2`，`CalcTschNumBlocks:249-263` 校验）。

### 13.2 对 tiling 的结构性影响（仅融合算子，如 matmul + leakyrelu/dequant）

- **910B（无 L0C→UB）**：中间结果 C 必须绕 GM —— `Cube: L0C→GM workspace`，`Vector: GM→UB→激活→GM`。需 GM workspace（16MB），Vector tile 与 Cube **解耦**，代价是 GM 带宽。
- **950（有 L0C→UB）**：`Cube: L0C→UB（直连）`，`Vector: UB→激活→GM`，中间不落 GM。**UB 进入约束包络**，Cube 产出 tile 与 Vector 消费 tile 被 UB **耦合**（producer/consumer）。
- knowledge 文档 248-276 行描述了同一条融合路径。

### 13.3 若后续实现，工具应如何体现

芯片选择器从"换容器尺寸"升级为"**切换数据流路径**"：融合模式下，910B 显示 `L0C→GM→UB` 绕行链 + GM workspace 占用；950 显示 `L0C→UB` 直连 + UB 共享约束容器 + AIC:AIV 1:2 平衡。这是"硬件版本影响 tiling"最直观的演示，适合作为独立里程碑。

## 14. 产品决策

### 14.1 核心方向（已定）

- **核心交互模型** → **场景驱动的单点 workbench + 安全默认 seed + 手动 what-if 覆盖**。Primary flow 是选场景/预设，页面载入一组 safe default seed 并解释当前 shape 下的合法性与性能趋势；secondary flow 是手动改 `baseM/N/K`、DB、dtype、`iterateOrder` 看后果。
- **动态 shape 决策曲线 / 断点地图** → **本期不做，放入 Future（后续阶段）**。理由：本期 spec 数据模型是单点对象，没有 `shapeRange/keySegments/scanResult`；把扫描曲线列为本期 hero 会显著加重 MVP。本期只做单点 + 多 key 静态策略分段条。
- **输入模型** → **场景驱动单点**。主入口用 `chip + dtype + batch + seq + K + N`，页面派生 `M = batch × seq`；裸 `M/N/K` 只放 Advanced 作为专家覆盖。K/N 默认来自 weight/模型结构，M 来自当前请求形态。
- **起点** → **safe default seed，不承诺真实 CANN 自动 tiling 输出**。MVP 不调用 CANN，也不完整复刻 `MatmulTilingAlgorithm`。默认值是 "auto-tiling-inspired / safe default" 的教学种子，必须标注"近似安全默认，非真实编译器输出"。
- **多 tiling key 在 v1 的体现方式** → **静态策略分段条**。展示 `M=1 Decode`、`2-128 Small`、`129+ Prefill` 等策略段，每段说明 range/key/why；点击某段只载入代表 shape/preset，不做交互式 M 轴扫描。注意它是外层 tiling key strategy / branch annotation，**不是 `TCubeTiling` 字段**。
- **是否去 `cann-recipes-infer` 翻真实测试矩阵** → **MVP 非阻塞**。本期最多轻量核对 preset 名称和说明；系统性测试矩阵调研留到 Future 断点地图之前做。

### 14.2 实现细节（已定，详见 [spec §14](matmul-tiling-3d-spec.zh-CN.md)）

- 性能分尺度 → **颜色档（红/黄/绿）+ 小字给原始算力强度值**（不用 0-100 分，避免被当绝对真值）。
- 参数初值 → **safe default seed + topbar 提供 2–3 个真实场景 preset**（decode M=1 / small decode / prefill）一键载入；必须标注"近似安全默认，非真实编译器输出"。
- 物理约束视图 pattern → **已定：用 `aic-core-object`**（替换原 memory-architecture 方案）。
- 左侧源码 → **只读 + 独立参数控件**（不做代码可编辑触发重切）。
- 与 `index.html` 互跳 → **两页 topbar 各放小入口互跳**。
- `estimateL1` 简化 → MVP **固定 `stepKa/stepKb` 推 depth、只读**，控件留后续。

# PTO Changelog

> 开发日志，按时间倒序，每轮修改点逐条记录。
> 格式：`[版本/日期] 模块 — 修改描述`

---

## 2026-09-04 — 关系观测器事件机制图补齐 p1-spread / p2-peak / p2-oom

- **p1-spread（PP3 断裂，2048 NPU hang）→ `pp-cascade`**：上排画 PP 依赖拓扑（前向送激活 / 反向回梯度，首尾成闭环），中间四条 stage 泳道画「在算 → 在等」的逐级回压（3→2→1→0，方向不能反），下排把受影响卡数拆成一条可验算的乘法链 `1 →×EP64→ 64 →×EDP8→ 512 →×PP4→ 2048`——逐层差值正好是 evidence 的 63 / 448 / 1536。
- **p2-peak（激活值占用 36.2 GB）→ `activation-lifetime`**：上半是 12 层 + LM Head 的激活**存活区间条**，下半是由这些区间逐槽位加出来的显存占用曲线（曲线就是区间的竖向计数，两者逐格对齐）。峰值出现在 12 层尚未释放、LM Head logits 又叠上来的那一个槽位：9.0 + 27.2 = 36.2 GB，加常驻 27.8 恰好 64.0。
- **p2-oom（碎片 OOM）→ `fragmented-oom`**：把 64 GB 摊成 8 行真实地址空间，已分配块与 22 个空洞交替排列；0.5 GB 的申请块用 SMIL `calcMode="discrete"` 沿空洞逐个试放，连最大的 0.32 GB 也装不下。底部三根对照条点题：决定成败的不是空闲总量（3.9）而是最大连续块（0.32）。
- 机制图自检脚本扩到 5 张图 × 4 相位，并新增**数值自洽**断言：图上写死的数必须与事件 evidence 逐位对得上（空洞总量 3.9 / 已分配 60.1 / 合计 64、峰值激活 36.2、12 层 9.0、L38 1.2、乘法链 1/64/512/2048）。

---

## 2026-09-04 — 关系观测器 MoE 区：宫格拆成「标编号」与「可下钻」两个独立开关

- 上一版把两者绑在一起，导致点 Cluster 的 rank 格也放开了下钻。但专家实例是**按层**分的：只定到 PP stage（一段里往往十几个 MoE 层）仍回答不了「问的是哪一层的那份」。现在拆开：`numbered` 只需 stage + dpIdx；`drillable` 还需具体 MoE layer（`moeBoundOf` 无 `moeBindLayer` 即返回 null）。于是点 Cluster rank 格 → 标出编号但格子仍禁点，复用同一段禁点提示。
- 禁点光标由 `help` 改为 `not-allowed`：这里确实点不动，`pointer` 是撒谎、`help` 只说了「有话讲」没说「按不动」。
- 禁点提示拆成共用正文 `MOE_NO_DRILL_HINT` + 仅未标号时追加的 `MOE_UNBOUND_TAIL`（正文不能写死「编号已隐去」——按 Cluster rank 进来时编号是标着的）。
- 层内下钻不再丢层号：`moeBindingOf` 除 `kind:"layer"` 外也认 `expert`/`epRank` 携带的 `scopeLayer`（并校验它确实落在该 stage 上，防脏 payload）。口径说明与格子/胶囊的悬浮读数全部点明「Layer N」，口径尾巴写「下面的格子是这一层内的下钻」；只定到 stage 时写「未指定 MoE layer，格子暂不可点」。

---

## 2026-09-04 — 关系观测器 MoE 区：EP rank 宫格分「未绑定 / 已绑定」两态

- 宫格画的是**一个 EP group 内部**的 EP rank（0…EP-1），不是集群里的 global rank；EP=64 时它写着 Rank 0~63，而集群有 2048 张卡，被读成 global rank 几乎是必然。根子在于 EP rank → global rank 要 `rankOf(stage, dpIdx, epIdx, inner)`，而 stage / dpIdx 不在 MoE 区里。
- 未绑定（默认）：抹去 Rank 后的编号，卡片带 `.is-anon`（光标 `help`），悬浮/点击弹说明气泡「每个 MoE layer 有相互独立的一套专家，编号相同的 Expert 权重一定不同……请先点一个 MoE Layer 或一张 Rank 卡」，点击**不发出连线**。
- 已绑定：关系收敛到唯一一个 PP stage 且触及 MoE（点 MoE Layer / PP 段 / 集群某张卡）时，每张卡标出对应 global rank（TP×CP>1 时标区间），悬浮换成读数，点击照常连回四域。判据 `rel.stages.size === 1 && rel.epRanks.size > 0` —— 前半是 `rankOf` 的充要条件，后半排掉「点了 Dense 层」这类与专家无关的单 stage 选择。
- 标题旁新增「编号口径：Layer 38 · PP3 · DP 副本 0（共 8 个，默认取第 0 个）」：从层/PP 段进来时副本是页面替用户挑的，必须写破。
- `resolveRelation` 的 expert / epRank 分支新增收敛口径：payload 带 `scopeStage` 时（来自已绑定宫格的点击）只取该 stage 的 MoE 层与指定 DP 副本，让连线与卡片上写着的编号一致；无 `scopeStage` 时退回原来的全展开口径。
- 事件详情角色卡里那套只读宫格不参与两态，保持「Rank N + 读数悬浮」原样。

---

## 2026-09-04 — 关系观测器 MoE 区：专家胶囊满 4 换行，撑高 EP rank 卡片

- `.cro-moe-group__experts` 原是 `flex` + `nowrap`，靠 `.cro-expert` 的 `flex:1 1 0` 把一个 rank 的专家全挤进一行。默认档每 rank 4 个正好，但 EP 拨小到 32 / 16 时一个 rank 有 8 / 16 个专家，每枚只剩几像素，`E12` 被压成一道竖条。改为 `grid` + `repeat(var(--cro-expert-cols, 4), minmax(0, 1fr))`：满 4 换行，卡片高度跟着内容长，同一行的 rank 卡由外层 grid 拉伸对齐。
- 列数由 `renderMoe()` 新增的 `setExpertCols()` 按 `min(4, 实际个数)` 写进内联样式（下限 1，`repeat(0, …)` 非法）——不足 4 个时列数收到实际个数，胶囊仍铺满整行宽，「1 个共享专家」不会缩成四分之一宽。共享专家那一格复用同一个类，同样走这条。
- `config-relation-observer.html` 里 observer 的 css / js 缓存版本号一并推到 `20260904-expert-wrap`。

---

## 2026-09-04 — 关系观测器 MoE 区：EP 标签补问号，说清「一套专家摊在多少 rank 上」

- `FIELD_SPECS.ep` 原先没有 `title`，标签后面因而没有问号：`EP = 64` 有三种误读（一共 64 个专家 / 64 个专家并行组 / 每张卡 64 个专家）。现在与 `Routed` 一样写成 `(topology) => string`，按当前拓扑报出「一套路由专家分布在多少个 rank 上；每个 rank 上的专家人头数 = Routed ÷ EP = 256 ÷ 64 = 4 个」，并接着说明凑齐这 64 个 rank 才是一整套专家、当前有几组 EP 域并排跑，以及 EP 拨大拨小在「每卡专家参数」与「all-to-all 跨度」之间的取舍。除不尽时直说切不平。

---

## 2026-09-04 — 关系观测器 MoE 区：把「Routed 是每层一套」这件事说清楚

- MoE 区 stepper 的 `Routed` 容易被读成「全模型一共 256 个专家」。标签本身塞不下限定词（那一行是 nowrap 四等分、约 300px 一列，标签早已挂省略号，写成 `Routed (per MoE Layer)` 只会被截成碎片并压窄邻居），改为两处补足：`Routed` 新增问号气泡，按当前拓扑报出「46 层里 44 层是 MoE，每层各一套 256 → 全模型 44 × 256 = 11264 个专家实例」；下方 section 标题改成「单个 MoE Layer 的路由专家在 EP ranks 上的分布」。
- `FIELD_SPECS[].title` 现在允许写成 `(topology) => string`，由新的 `fieldTitle()` 在 `emit()` 那一趟按当前拓扑落成文字（建控件时先建空问号，`controller.refresh()` 必定补上）。FLAG_SPECS 的静态 title 路径不变。
- 「单个 EP group · EP size 64 · 256 experts · 每个 rank 4 个」那块占满一行网格的实底摘要下线，同一条口径改挂到 section 标题右侧的问号气泡（复用既有 `buildHint` / `data-hint` 委托），列表第一眼直接是 EP rank 卡片。`.cro-moe-group-summary` 样式一并移除。
- Model Architecture 区标题「Layer 导航」改为「Layer 布局」。

---

## 2026-09-04 — 关系观测器 Global Batch：口径浮层补上「条」这个单位

- `js/config-relation-observer.js` `globalBatchSummary()`：格子里只有一个光秃秃的 12288，
  浮层原先只说「吃掉多少样本」，读不出单位（最容易被当成 token 数，差一个 Seq Length）。
  现在浮层新增「单位是「条」，不是 token」一段：一条样本 = 一条长 Seq Length 的序列（[B,S,H] 的 B），
  并按当前配置算出换算式 `12288 条 × Seq 4096 = 50,331,648 token`；三因子那行也带上「条」，
  「表单上那枚 Micro Batch 不是它」一段点明两者同单位、差在「每卡每次」与「全集群一步」。

## 2026-09-04 — 关系观测器事件详情：机制舞台取代传播范围图占据主区

- `config-relation-observer` 事件模式的中区改为「机制舞台 + 右下角地图」：原「传播源 → 受影响」范围图退成停靠在右侧栏底部的只读缩略图，点击铺满中区、可平移缩放，再点收回。事件未声明 `mechanism` 时中区回到原来的满铺传播图（`data-mech="off"`），机制图可逐个事件铺开。
- 新增机制图渲染层（`MECHANISM_RENDERERS`）：按 `event.mechanism.phases` 的相位推进，相位轴复用 `tab-control`，可点选、可播放，演到末相定格。动效只用 SVG + SMIL（沿连线跑的 `stroke-dashoffset` 彗星、双相位 ripple），不引库、不占 rAF。
- 首批两个试点事件：问题2.5 Router FP8 溢出画「打分 → 越界 → softmax 塌成 one-hot → 流量全汇到 E193」的 dispatch 扇出塌缩（相位 ①② 的健康态即 ③④ 的对照）；问题2.4 all-to-all 超时画 64 条泳道的 barrier 空等，越过 barrier 后持续生长的行军蚁就是「空等了多久」。

---

## 2026-09-04 — Transformer 知识漫游卡片支持公式渲染

- 卡片 Markdown 内容接入本地 KaTeX，支持 `$...$`、`$$...$$`、`\\(...\\)` 和 `\\[...\\]` 数学定界符；代码块和行内代码保持原样，不会误渲染其中的美元符号。
- KaTeX 脚本、样式和字体随静态页面一同发布并加入 Service Worker 缓存，离线打开仍可显示公式；长块公式可在卡片内横向滚动。

---

## 2026-09-03 — 按 Rank 训练步泳道:调色板拉开色相 + 聚光灯到本图时「只留红、其余去色」

- **红色只留给错误**。原来前向蓝 + 反向 `#ff4b7b` 粉红 + 琥珀 + 橙红挤在暖端,一屏下来到处像在报警,真正的故障条反而不跳。现在按色相环把各类事件铺开,每两类至少隔一个可辨的色相段:红 0°(fault) → 琥珀 38°(梯度同步) → 黄绿 77°(参数更新) → 翠绿 160°(通信) → 青 187°(激活驻留) → 天蓝 199°(训练步) → 蓝 228°(前向) → 紫 271°(反向) → 玫红 330°(loss),空等仍是中性灰。取值来自设计系统语义色与 combo-workbench 的 ARCH_NODE_COLORS,不新造色板。
- 反向由粉红改紫 —— 反向是正常流程,不该长得像报警;反过来,**事故步的 `Loss = NaN` 从 loss 改判为 fault 走红色**,它本身就是错误现场之一。图例里「激活驻留」小方块的颜色改由 JS 端 `COLORS.hold` 通过内联 `--trs-c` 传入,换调色板不必再同步改 CSS。
- 新增「定位聚焦」:`window.PtoTrainingRankSwimlane.focusFault() / clearFocus()`。打开后切到事故步 + 事故窗口、把 rank 23 那行滚到视野中间、**除 fault 条外全部压成中性灰(alpha .34)**,行头同样压暗(只留故障 Rank 那行),红条再加一圈外发光。工具条右上出现「定位聚焦中 · 仅高亮 rank 23 ✕」芯片,点它或点任一段控即退出;退出时把进入前的场景/范围/展开态/缩放原样还回去。
- 接线:`js/training-spotlight.js` 的**问题二 · 步④「通信调度层」**在 prep 里调 `focusFault()` —— 光洞只能把视线引到底部这块面板,面板里还有 32 条泳道,让泳道自己再收一次。复位统一放在步进渲染开头(`clearSwimlaneFocus()`)与 `doClose()`,谁开的谁负责关,步与步之间不互相漏状态;组件没渲染过时是空操作。

---

## 2026-09-03 — training-monitoring-v2 底部 Timeline 换成「按 Rank 的训练步泳道」

- 新增 `js/training-rank-swimlane.js` + `css/training-rank-swimlane.css`(`window.PtoTrainingRankSwimlane.render(host)`)。原来那张 `js/timeline-swimlane.js` 是算子/通信事务级的 1F1B trace,站在训练角度太细——一屏几百根 3px 柱子,读不出「这一步各 rank 的前向、反向、梯度同步、参数更新分别在什么时候」。
- 架构照搬 hpc-topology-viewer `public/combo-workbench/swimlane.html`(微批次生命周期泳道):行是一棵可展开的树(训练步 → PP stage → Rank → Rank 内计算流/通信流/更新流)、单 canvas + 左侧 sticky gutter 行头、hitRects 反向命中、离散缩放 1×–64×、前向条叠向右 chevron / 反向条叠向左。事件条与 tooltip 复用已有的 `window.PtoSwimlaneTaskPattern`。**没有**搬上游那套 kernel 级色带——最细停在三轨,不再下钻到算子。
- 内容按本页故事重排:32 Rank · DP2×PP4×TP2×EP2 · 1F1B · 8 micro-batch,`rank = stage×8 + dp×4 + tp×2 + ep`。层切分故意不均匀(PP0 = Embedding+L0–L9 / PP1 = L10–L23 / PP2 = L24–L39 / PP3 = L40–L45+LM Head),于是 **L38 的 MoE 落在 PP2,而 PP2 正好是 rank 16–23**,与定位链里既有的「node2 ranks 16-23, rank 23 all-to-all timeout」「EP rank 23 / PP stage 3」「rank 17 OOM」三条文案对上。
- 顶部段控给两个场景:健康步 15202(1F1B 梯形 → DP 梯度 AllReduce → Optimizer Step 闭环)与事故步 15203(rank 23 在 B m3 的 L38 expert dispatch 发起 EP all-to-all 后不再返回)。事故按「谁先被堵住」逐圈扩散:EP 组同伴 rank 22 同刻挂住 → PP2 其余 rank 做完手上的 micro-batch 后空等 EP 栅栏 → PP0/PP1 收不到回传梯度 → PP3 的 send 队列积压;本该发生的 AllReduce / Optimizer 画成虚线空心框,说明它不是延后而是压根没开始。
- 挂载点:`training-run-twin.js` 的 `renderTimelineDock()` 改为「有 `PtoTrainingRankSwimlane` 就用它,否则回落 `PtoProblemOneTimeline`」。只有 v2 加载新脚本,`training-monitoring.html` / `mc2-incident-monitoring.html` 行为不变;`renderProblemOneTimeline()`(问题一定位链里那条单 rank 23 泳道)也照旧走旧图。

---

## 2026-09-03 — training-monitoring-v2 整网侧视图「层指标」下拉:标题改「已选 N 项」,底部换成推荐指标气泡

- 按钮文案由 `N项层指标` 改为 `已选 N 项层指标`(`updateMetricDDLabel()`),静态兜底文案同步改成「已选 4 项层指标」——默认勾选本来就是 4 项(三类 Top1 + 常驻的单层激活值显存),原来写 3 是旧值。
- 去掉面板底部两行:`.deck-metric-panel__status`(前向/反向扫到第几层)与 `.deck-metric-panel__foot`(描点节奏说明)。下拉是挑指标的地方,训练进度画面上本来就看得见。`metricStatusEl` 置 null,`updateAnimStatus()` 因自带 guard 而安全空转;两条对应样式一并从 `training-monitoring-v2.html` 删除。
- 底部补一条分割线 + 「? 推荐展示指标」入口:整行挂 `.wzh-help`,悬浮或点击(tabindex=0 聚焦)都出气泡,复用页面已有的 `#diagnosisTooltip` 浮层,不新造一套 tooltip。气泡文案 `REC_HELP` 给出按定位价值的挑选顺序——预示异常(梯度 L2 / hidden-state 标准差 / 单层激活值显存 / 注意力熵 / HBM 带宽)＞展示异常(总耗时 / 峰值显存 / MFU / 有效 FLOPs)＞其他(PP 层间传输字节),判据是这条指标算「因」还是「果」。
- 说明气泡加宽变体:`.diagnosis-bubble.is-wide`(400px),由触发器上的 `data-tooltip-wide="1"` 开启,逐层指标的 `?` 与推荐入口都用它——这几条是「含义/采集/优秀/异常/定位价值」的多行结构化文本,260px 会把每行折成两三段。同时给 `position()` 补右/下边界兜底:右侧顶到视口就左推,下方放不下就翻到触发器上方(宽气泡更容易越界)。页面其它短说明仍走原来的窄气泡。

---

## 2026-09-03 — config-relation-observer 的 Cluster 表单行重排成「Global Batch + [B,S,H]」，其余下放高级选项

- 首屏那一行现在只剩七格，从粗到细读成一句话：`Total Rank / 卡型号 / Global Batch / Micro Batch / Seq Length / Hidden / 高级选项`。前三格是「多少卡、什么卡、这一步吃多少样本」，中间三格是摊到这张卡上那个张量的 `[B, S, H]`，B 与 S 之间不再插任何东西。
- 新增 `DERIVED_SPECS`，把原先只服务 Node 的 `buildNodeReadout()` 泛化成 `buildDerivedReadout(key)`，并补 `buildItem(name)` 统一分派三类控件（只读读数 / stepper / 开关）——`mount()` 与 `mountAdvanced()` 共用它，所以派生读数与真字段可以并排写在 `FIELD_ORDER` / `ADVANCED_ITEMS` 里，位置就是列表里的位置。⚠️ `buildItem` 必须先问 `DERIVED_SPECS`：`node` 在两张表里都有，当成 stepper 建出来就是一枚只能停在一个值上的加减键。
- 两枚新只读格都带口径浮层，值与 YAML 视图同源：**Global Batch** = `Micro Batch × DP × 微批数`（`runner_config.batch_size`，full_batch 口径），**Hidden** 取模型预设的结构常量（`model_config.hidden_size`，换模型才变）。此前这两个数只在 YAML 视图里露过面，导致这一行既缺 `[B,S,H]` 的 H，又容易把 Micro Batch 误读成 batch size。
- `ADVANCED_ITEMS.batch` 收进 Node、微批数、重计算三格（连同原有的重算层数 / 精度两档 / LoRA 那一对，共八格）：判据换成「首屏只留『这一步吃多少 + 这张卡上那个张量长什么样』」。微批数不是形状的一维（它是「这个 `[B,S,H]` 一步之内跑几遍」），值仍进 Global Batch 的乘积、仍夹在飞份数；Node 是算得出来的数；重计算与它的搭档重算层数挨着放更好读。`ADVANCED_TITLE.batch` 同步重写。
- 「微批数」改名为 **`micro_batch_num`**：那三个字太像 Micro Batch 的简称，路人第一眼会读成 MBS 本身，而两者意思恰好相反（每份多大 vs 分成几份）。写成框架里的键名（MindFormers `parallel_config.micro_batch_num`）就没有歧义。改动覆盖所有用户可见文案——控件标签与口径浮层、软警告（`micro_batch_num N 少于流水线深度…`）、「高级选项」按钮说明、单卡容量口径浮层与小柱提示、导入报告的字段名、YAML 行尾注释、文档视图那一章的术语名（中文「微批数」退到 `term-full` 那行当别名保留）。代码注释仍按中文的「微批数」称呼它，读代码的人不会误读，也不必重排那些对齐到列的注释框。
- `css/config-relation-observer.css` 只动注释与 `.cro-stepper__derived` 的宽度口径说明（min-width 兜 30px、内容更宽自撑）；控件由八枚收到七格，行宽预算反而松了。
- `tools/cro-selfcheck.js` 那条「微批数不足时给软警告」的断言跟着改认 `micro_batch_num`；`node tools/cro-selfcheck.js` 全通过（54000 状态，断言 0 失败）。

## 2026-09-03 — 时光全景浮窗加三级量尺（epoch / step / L2 阶段）

- `js/training-timeline-panorama.js` 新增一份 `stepCostAt()` 迭代耗时模型（warmup 未进稳态、每 200 步一次全局指标归约、ckpt 落盘阻塞、straggler 抖动、HCCS 掉链路后回退 RoCE、事故步的停机与回滚），同时驱动三层量尺的块宽与 L2 阶段切分，不让各处各画各的。
- 指标栏下方加三级量尺：① epoch（整段训练，块宽 = 该 epoch 实际耗时，HCCS 降级那段 1.64×）② step（选中步附近 24 步逐步一格，格宽 = 该步实际耗时，52~79px 不等，step 编号写在格子里）③ L2（选中那一步的前向传播 / 反向传播 / 更新，可折叠）。宽度是唯一表达耗时的维度；liveStep 之后的 step / epoch 一律按基线 T_iter 等宽占位 —— 没跑过的迭代不该显出宽窄差别。
- 三层共用一套填充语言：蓝色 = 已完成、灰色斜线 = 未完成、交界处一道竖线被蓝色往右推。进行中的 epoch 与进行中的 step 因此长得一模一样，L2 三段也是同一套蓝 + 灰斜线，不另起三种颜色。
- 进度不再按墙钟臆造：`js/training-monitoring-v2-deck.js` 补一个只读 `stepProgress()`，把「一轮前向 46 层 + 反向 46 层」的播放节拍（work 55.9s）暴露出来 —— liveStep 本来就是它跑满一圈时 `twinAdvanceStep(1)` 推进的。量尺直接读它，填满与换步是同一时刻，一格播完就接着播下一格；deck 静态态（reduced-motion）退回按观测到的 liveStep 变化节拍自校准。选中的若是最新一步，会跟着训练往前走；手动挑了历史步则钉住不动。
- L2 三张卡按已进行 / 进行中 / 未进行三态呈现：底色抬一档、进行中补量尺同款蓝描边，未进行的落回面板底色 + 虚线框且只留 key 不填 value（不拿模型预估冒充实测）。key-value 两列的列间距拉到 `--space-5`，每对再垫一层浅底圈成整体，避免第一列的 value 贴着第二列的 key。
- 事件类型筛选并进指标栏，作为「事件」一项排在总进度右侧；标题连同当前数值放在各自条形图上方，量尺因此与下面 L1 的事件轴等宽。L1 的轴、刻度、事件点也一并改走量尺那套 `runX()` 坐标，同一个事件在两处落在同一个 x。
- 口径边界：量尺只表达相对耗时，KPI 的已训练时长与事件时间戳仍走顶栏 `step × TIME_MACHINE_STEP_SECONDS` 的统一口径，两边不会给出互相打架的数字。

## 2026-09-03 — config-relation-observer 配置表单的悬浮说明改成「标签后小问号 + 气泡」

- 表单里那些挂在原生 `title` 上的长说明（要按住 ~1s 才弹、排版归系统管、没有可悬浮的视觉线索）统一换成气泡：标签后一枚 `.cro-hint` 小问号，悬浮/聚焦即出，触屏可点开合，Esc 关闭。
- 气泡单例挂在 `body` 下 `position:fixed`（与容量口径浮层同一个理由：祖先 pane 既 `overflow:hidden` 又带 `backdrop-filter`），落位由 `placeHint()` 实测避让视口；滚动条收成无槽圆角细条，静止只留一道浅痕、指针进气泡才浮到正常对比度。
- 文案一字未改：首段升格成气泡标题，正文 `pre-wrap` 保留原有空行与「· 」列表；`disabledReason`（此刻为什么点不动）单独排在最前一格。加减键走不动的理由、「高级选项」折叠、MoE 的 EP 口径三档改走同一套 `data-hint`，不额外长问号。

## 2026-09-02 — launch-v2 「训练任务监控」卡片新增「学习」入口

- 在卡片底部 variants 末尾追加「学习」按钮，新标签页打开 `Profiling_Insight_and_Tool/Learning/public/index.html`。

## 2026-08-28 — config-relation-observer 升级计划行 23：EP 口径补第三档（MindFormers · DP×MP 域）

- `js/config-relation-observer.js` — `croEpMode` 从二选一变三档，新增「MindFormers（DP×MP）」：world 公式同切出档，但约束换成 `(DP × TP) % EP == 0`、`EDP = DP×TP/EP`。口径字段从布尔 `moeOrthogonal` 升成 `epMode` 三值（老字段保留并同步，读法统一收进 `epModeOf`）；validate / reconcile / fitParallelWorld 的整除判据按域取；**编址几何**跟着换 —— mf 档下 `ranksPerEp` 从 `TP×CP` 变成 `CP`，TP 分片号由 `(EDP索引 × EP + EP索引) % TP` 反推，两套分解统一收进 `derive().shardOf()`（集群矩阵原先自己又算了一遍，那份算法在新档下会画错斑马纹）。
- `js/config-relation-capacity.js` — ZeRO / FSDP2 的非专家分母改读新增的 `counts.dpReplica`（mf 档是 DP，而 `EDP×EP` 会算成 DP×TP，优化器段偏小 TP 倍）；mf 档下路由专家**只 ÷EP、不再另 ÷TP**（EP 已经吃掉 mp 那一维，本页按专家张量并行 ETP=1 建模）；口径浮层的「路由专家」「EDP」两行按档改写。
- `js/config-relation-yaml.js` — 校验行与 `expert_parallel` 的行尾注释补第三档（写出 `dp×mp = N 须被 EP 整除` 与 EDP 的换算），并注明 ETP>1 时的严格式。
- `js/config-relation-import.js` — 新增 EP 口径的推断规则：判据是「这份配置写的是 MindFormers 的 `parallel_config`」而不是「除不尽」。导入 `mf_pretrain_deepseek3_671b.yaml`（dp:4/mp:8/ep:32）不再当场报错，`mf_pretrain_qwen3_30b_a3b.yaml` 的 EP 也不再被配平从 4 静默收到 1。
- `config-relation-observer.html` — MoE 区多一枚页签；「EP 与 DP」一章改成三档对照，并点明前两档是同一张网格的两种读法、第三档是另一张网格；`term-ep` 补上「切自哪个域要看框架」。
- `config-relation-observer-upgradeplan.md` — 行 23 勾掉并写落地记录（含未建模项 ETP）。自检台新增第 8 节：三档 × 四组并行度的 rank↔坐标双射、格子数恒等、TP=1 时切出档与 mf 档逐位相同；随机游走从两档扩到三档共 5.4 万个状态，十二项断言全为 0。基线数字逐位不变。

## 2026-08-28 — config-relation-observer 升级计划第六批：行 21（精度档）/ 行 22（微批数）

- `js/config-relation-observer.js` — 新增「计算精度」（BF16 / FP16 / FP8）与「主权重精度」（BF16 / FP32）两枚档位控件（Cluster 行「高级选项」内）、「微批数」stepper（Cluster 行，pow2 梯子）；两个预设补默认值 —— openPangu 微批数 24 取自架构参考 §6.4 的 GBS 12288 = 1×512×24，精度按参考配置的口径停在 BF16 / BF16（那份「forward FP8」是算子级计算格式，不是权重直存）；新增软警告「微批数少于 PP×VPP，warmup 灌不满，气泡约 N%」。
- `js/config-relation-capacity.js` — 三个写死的字节常量（2 / 2 / 12）改由 `precisionBytes()` 按精度两档折算：主权重 FP32 → 4 / 4 / 8（合计仍是 16 B，但 ZeRO-1 能切走的从 12 B 掉到 8 B），FP8 → 权重段减半（按 Megatron `--fp8-param-gather` 的「权重直存」建模）；新增 `bytesAct` 供算子 workspace 用（激活不随精度档变，理由写进口径浮层）；在飞份数改取 `min(1F1B/VPP 公式, 微批数)`，浮层新增「精度」「微批数夹取」两行，全局 batch 那一行改报真数。
- `js/config-relation-yaml.js` — `micro_batch_num` 从派生值（4×PP）变成输入，`batch_size` 跟着它算（默认档 8192 → 12288，与架构参考对齐）；model_config 新增 `params_dtype` / `compute_dtype` 两行跟随档位，FP8 档补一行口径注释（MindFormers 无同名键）。
- `js/config-relation-import.js` — 精度与批次相关的 12 条从「已识别 · 缺口」撤下（MindFormers 的 params_dtype / compute_dtype / micro_batch_num、Megatron 的 --fp8-format / --bf16 / --fp16 / --global-batch-size 反推微批数、HF 的 gradient_accumulation_steps 均已落到表单）；修 sh 解析漏读带引号参数的 bug —— `megatron_llama3_8b_fp8.sh` 的 fp8 参数整组读不到，而那份脚本整个主题就是 fp8；补 `vocab-size` 进结构常量。11 份样本仍是「未识别 0、每个键都有归宿」。
- `config-relation-observer.html` — 文档新增「微批数」「计算精度 / 主权重精度」两个条目；「单卡显存由什么构成」一章的字节口径、在飞份数说明、Micro Batch 条目里那句「只有 MBS 进显存」一并补全。
- `config-relation-observer-upgradeplan.md` — 行 21 / 22 勾掉并写落地记录（含两处主动留白：激活段不随精度变、FP8 只建「权重直存」一种）。基线数字逐位不变：默认档 10.9 GB / 17%。

## 2026-08-28 — config-relation-observer：切进来的配置显示原文 + Layer 导航密排修复

- **应用一份样例后，yaml 栏显示的是那份文件的原文，文件名也换成它**（`config-test/mixtral_8x7b.sh`）。此前只有数字跟着变、内容仍是按 openPangu 结构生成的 MindFormers yaml —— 文件名说一件事、正文说另一件事。新增 `cro:source` 事件（`js/config-relation-import.js` 发，`js/config-relation-yaml.js` 收），贴/传进来的配置走同一条通路。
- **原文是只读的，一改表单就退回生成视图**，这条写在状态栏那一行。理由：这一栏的本职是「你此刻的档位写成配置文件长什么样」，原文是静态的，留着它跟着表单一起变才是骗人。启动命令那一栏照旧按表单生成（卡型号 / 节点数 / 总卡数本来就不在配置文件里）。
- **原文上标出「页面读了哪几行、哪几行没照收」**：`R` = 收下了，`≠` = 读到了但配平改了数（mixtral 的 EP 文件写 8、页面收 2），悬浮给出两个数。状态栏同时报「N 处页面没照收」。文件里一个数、表单上另一个数而不指出来，就是让人猜哪个算数。
- **Layer 导航：层数一多就错位、看不出层的三处成因一并修掉**（`layoutLayerNav`）。
  （1）**标签硬塞**：PP / Dense / Emb 这些标签是绝对定位 + 定宽 + `overflow:hidden`，段窄到放不下时会被从两侧切掉，「PP15」只剩中间的「P1」。改成两级退让：全名 → 短名（`PP15`→`15`、`Embedding`→`E`），仍放不下就整条不显示，段界由分隔线交代、段名仍由 `data-tip` 答出。Emb / Norm / Head 那三条注记只占 1 格宽，此前**任何配置下**都是被切碎的残字。
  （2）**横向溢出**：原先刻度撞到 1.5px 下限后就把组间缝硬夹到 4px 不管了，总宽超出带子 —— 右侧的层被裁掉，而分隔线与标签按实测组位置定位，跟着跑到带子外面。改成「先压组间缝 → 再压组内间隙（新增 `--cro-tick-gap`）→ 最后才压刻度」的三级退让，等式 `width = tick·n + gap·inner + split·g` 始终成立，256 层（stepper 上限）也一格不溢出。
  （3）**刻度糊成一片**：不足 2px 时空心药丸的两条描边已经叠在一起，改画实心细条（`.cro-layer-nav.is-dense`），一排等距细线还读得出「一层一层」。选中态与关系高亮排除在外，不被这条盖掉。
- 样例菜单的卡片**常态就带边框与底色**，hover 只加重一档（此前是悬浮才显形，读成一片没有边界的文字流，而这个菜单的正题恰恰是逐张比较着挑）；下拉滚动条改细（`scrollbar-width: thin` + `::-webkit-scrollbar` 两套都写，滑块靠透明描边收窄成 4px）。
- 应用后文件名旁那枚角标改为**只在退回生成视图时出现**：显示原文时路径本身就是文件名，两处写同一个名字只是噪声。

## 2026-08-28 — config-relation-observer：样例配置切换挪到 yaml 文件名那一格，改成卡片菜单 + 应用前预览

- **入口换了位置：从导入面板里的一枚下拉，挪到 YAML 视图的 `.cro-yaml__file`**（`configs/<家族>/run_<全名>.yaml` 那一格，现在是可点的 `#croYamlPickerBtn`）。理由是这一格本来就在回答「你现在看的是哪份配置」—— 换一份的动作理应从同一处发起，而不是先去顶栏开一个叫「导入」的面板。导入面板保留「传文件 / 贴文本」两条，正文补一句指路。
- **选项改成两行卡片，`title` 就此不用了**：第一行「名字 + 来源」（`DeepSeek-V3 671B 预训练` / `mindspore-ai/mindformers · configs/deepseek3/`），第二行是「选它能看到什么」那一句。理由与上一轮把来源做成常驻行是同一条 —— **有没有代表性是选之前要读到的东西**，`<option title>` 要悬停半秒才出、还只给纯文本，等于没写。note 里的 `**着重**` 与 `` `键名` `` 按原样渲染成粗体与等宽（`rich()`）。
- **中间加了一步解析弹窗，这是这次改动的正题**：点卡片 → fetch + `analyze()` → 整份报告摊开（落到哪几档 / 页面配平会改哪几个数 / 结构常量不覆盖 / 已知缺口挂着行号 / 读到但不建模）→ 底部才是【取消】【应用】。**看完再决定** —— 一份陌生配置直接糊到表单上，用户看不出页面替他改了什么（deepseek3 的 EP 32→4、175b 的 Total Rank 8→128 这类，全在报告里）。报告复用 `.cro-import__*` 那套块样式，两处长得一模一样。
- **【取消】退回卡片菜单，不是退回空屏**：用户的动作是「挑一份」，取消的是**这一份**，不是挑这件事。点遮罩、按 Esc 同此。
- **模型不换，这条是硬的**：`importConfig()` 只收 FIELD/FLAG 认得的字段，`MAP` 里根本没有 `model` —— 样例的结构常量（hidden / layers / 专家数）一律不覆盖。应用后文件名旁多一枚角标记住「现在这些数来自哪一份」（路径那段由 yaml 模块按模型名重算、样例名不在其中，一次高亮闪过就没了），角标 title 里带上配平改过的项。
- **「页面默认」照旧是第一张卡**，预览这一步给的是「应用会改回哪几项」的逐条 diff；⚠️ 卡型号与 EP 口径不在恢复范围（硬件与读法，不是配置内容）。
- `js/config-relation-import.js` 新增 `bootYamlPicker()`（与 `boot()` 并列，两个入口互不依赖）；样式在 `css/config-relation-yaml.css`（`.cro-yaml__picker/__menu/__opt`）与 `css/config-relation-observer.css`（`.cro-preview`），删掉随下拉一起作废的 `.cro-import__label/__select/__source`。⚠️ 设计系统没有 menu / popover / dialog 原语，两处都是用 tokens 拼的最小实现，与本页的横幅、开关同属「缺失样式」。
- **验证**：`node --check` 干净，HTML 标签栈平衡，两份 CSS 括号配平，`tools/cro-selfcheck.js` 全过（解析层与 DOM 无关，这次改动没碰它）。视觉与交互留给人工过一遍。

## 2026-08-28 — 配置 YAML 视图：注明数据出处 + 点名 mp

- `js/config-relation-yaml.js` — yaml 头新增一行来源注释（openPangu 结构常量取自仓内 `openPangu-2.0-Flash架构参考.md` §4、默认并行度取自 §6.1；Qwen2-7B 取自公开配置），并说明并行度/batch/开关是四域当前值实时生成；「框架校验 dp×mp×pp×cp」一行补上 `mp = parallel_config.model_parallel，即 TP`。

## 2026-08-28 — TaskCompare 最佳任务栏：齿轮接入「评比指标」勾选

- `Profiling_Insight_and_Tool/training-run-twin-standalone/TaskCompare.html` — 最佳任务栏右上角齿轮
  由占位改为可用：点开下拉列出本页全部指标 + media 综合评分，勾选变动即时重算 Borda 排名与奖牌。
  `BEST_RANK_METRIC_IDS` 相应由 const 改为可变。
- 同文件 — 勾选约束：`dir:'flat'` 的指标（学习率 / KL 散度 / 显存占用）没有优劣方向，列出但禁用
  并标注「无优劣方向」；上限 3 项（勾满后锁住其余）；下限 1 项（只剩一项时锁住它本身，避免排名失据）。
- 同文件 — 勾选后只就地替换最佳任务卡片（`refreshBestRankCard`），不整页重渲染，图表缩放/平滑状态
  与滚动位置都保住，下拉保持展开便于连续改；指标列宽新增按标题长度估算的兜底（原先只有三项写死）。

## 2026-08-28 — TaskCompare 图表对比：新增「视图联动」开关

- `Profiling_Insight_and_Tool/training-run-twin-standalone/TaskCompare.html` — 顶栏「标记最优」右侧
  新增「视图联动」开关（默认开），统一管住 hover 竖线/气泡联动与框选缩放的扩散：开启时按横轴口径
  整组联动，关闭后每张图各管各的。
- 同文件 — 缩放状态由 `{ step, time }` 双槽改为按图存（键为 CMP_METRICS 下标），开关只影响
  「写入时是否扩散到同组」，切换开关不会让已放大的图跳回；「恢复」图标改为按图显隐（`.is-shown`），
  联动关时只有被缩放的那张图出现。
- 同文件 — Smoothing 拖动条与右侧开关组之间加 8px 间距（`.smooth-ctrl + .cmp-switch`）。

## 2026-08-28 — TaskCompare 浅色主题：卡片底色对齐设计系统卡片口径

- `Profiling_Insight_and_Tool/training-run-twin-standalone/TaskCompare.html` — 页面级 `.card` 一直用
  `--surface-2`（设计系统里那是 **panel** surface，不是 card），浅色下解析为不透明中灰 `#F2F2F2`，
  压在 ide-frame 近白的 pane 上就成了生硬灰块。改为在浅色下用 `--card-bg`（= `--surface-1` = 纯白）
  + `--card-border`，并补上设计系统浅色卡片同款极淡投影 `0 10px 30px rgba(15,23,42,.06)`
  （对齐 `css/style.css` 里 `.card-demo`/`.panel-shell` 的浅色处理）。深色层级保持不变。

## 2026-08-28 — TaskCompare 图表对比：联动按横轴口径分组

- `Profiling_Insight_and_Tool/training-run-twin-standalone/TaskCompare.html` — hover 竖线联动与框选缩放
  改为按横轴分两组：**step 组**（loss / grad_norm / MFU / 吞吐 / lr / KL）与 **time 组**
  （GPU 利用率 / 显存占用）各自独立。两组横轴物理含义不同（训练步 vs 墙钟秒），同一归一化位置
  不指向同一件事，强行联动会误导。
- 同文件 — `cmpZoom` 由单值改为 `{ step, time }` 双槽；`cmpSyncAll` 增加 axisKind 入参、只刷同组
  并清掉另一组残留；卡片头「恢复」图标带 `data-axis`，只在本组处于缩放态时出现、只还原本组。

## 2026-08-28 — TaskCompare 图表对比：硬件遥测类指标横轴改为时间

- `Profiling_Insight_and_Tool/training-run-twin-standalone/TaskCompare.html` — 给 `CMP_METRICS` 增加
  `axis` 口径：**GPU 利用率**、**显存占用**两条改为时间轴。理由是真实业务里这两条来自 npu-smi /
  DCGM / Prometheus 按固定墙钟间隔轮询的硬件遥测，采样点与 step 边界不对齐；loss / grad_norm /
  MFU / 吞吐量 / lr / KL 则在训练循环里随 step 落库，横轴保持 step。
- 同文件 — 时间轴满量程取参与该图任务里最长的 `runtime.big`（「1小时58分」式）墙钟时长，
  刻度跨度 ≥1h 显示 H:MM、否则 M:SS，气泡显示到秒；轴标题随之切「时间 / step」，
  与框选缩放联动（缩放后时间刻度按可见段换算）。全部任务都取不到时长时自动退回 step 轴。

## 2026-08-28 — TaskCompare 图表对比：框选区间放大

- `Profiling_Insight_and_Tool/training-run-twin-standalone/TaskCompare.html` — 折线图支持左键拖拽框选区间放大：
  框选中在起手图上画高亮矩形，松手后按归一化区间（`cmpZoom`）重绘，**所有对比图联动放大到同一段**，
  可在放大结果上继续框选逐级下钻；纵轴按可见段重新取极值、step 横轴刻度跟随区间换算。
- 同文件 — 卡片头右上角新增「恢复」图标（仅缩放态显示），点击还原全部图表到原始区间；
  hover 联动改为按归一化位置换算各图索引，兼容不同长度序列与缩放后的可见段钳制。

## 2026-08-28 — config-relation-observer 升级计划：追加第六批（行 20–32）

- `config-relation-observer-upgradeplan.md` — 拿 `config-test/` 里 11 份公开训练配置反向撞四域表单，
  盘出 13 条界面无落点的配置项，作为**第六批**追加到落地清单（行 20–32），按 P0/P1/P2 分档。
  P0 三条：精度 dtype（`BASIS` 三个字节数写死成 bf16+Adam）、Global Batch / micro_batch_num
  （在飞份数与气泡比例都缺分母）、EP 的第三种口径（MindFormers 在 dp×mp 域切，deepseek3 那份必红）。
- 同文件 — 在「落地清单」开头补一张**来源对照表**，把此前混在一起的三个进货渠道分开写明：
  行 1–14 = 页面内部审视，行 15–19 = MindSpeed MM 特性矩阵对照，行 20–32 = 外部真实配置反向映射。
- 同文件 — 新增文末附录「附：第六批的由来（外部真实训练配置反向映射）」，记来源样本、判据、
  键的三分堆（有落点 / 没落点且错 / 没落点但不该有），以及建议顺序 20→23→21→24→22。
- 纯文档改动，未动 `js/config-relation-observer.js` 与 `js/config-relation-capacity.js`。

---

## 2026-08-27 — ParallelDemo 知识库：单点收敛 + 更名

- 用 trainman 侧 v20260720 版覆盖仓内 `Profiling_Insight_and_Tool/ParallelDemo/knowledge.md`（新增 mHC 中间残差小节、第三部分「并行策略与 micro batch」整章），归一化为 UTF-8 无 BOM + CRLF；同时删除 `D:\Projects\trainman\ParallelDemo\knowledge.md`，此后仓内这份为唯一副本。
- 修好上一步覆盖引入的结构错位：新增的「并行策略与 micro batch」章被误插进第二部分中间（把「层级结构」一节劈成两半），现整块移到第二部分之后；随之把原「第三部分 · 并行训练（权重如何切到多张卡）」改编号为第四部分，全文 11 处跨章引用（第三部分第 1/2/3/4 节等）同步改指。
- 合并根目录残稿 `ParallelDemo/knowledge.md`（5KB，2026-06-25，同名 H1，最易混淆）后删除：其中仅有的两节独有内容「Tensor Parallel 下的变化」（列切/行切 + TP 切分后的 Attention/MLP 前向算子链）与「Weight Tying（W_emb = W_head）」补进第二部分——前者原本被第二、五部分三处引用却根本不存在，属死链。
- 更名 `knowledge.md` → `Transformer结构与并行策略知识库.md`（旧名只提"并行训练可视化"，但全文前半讲的是模型结构）；文内 H1 与 `Profiling_Insight_and_Tool/工具矩阵.md` 的登记名/路径/内容摘要同步更新，摘要按当前六部分结构重写。

## 2026-08-27 — config-relation-observer：把「谁持有一整套专家」这条业务口径写准

- **口径**：一整套专家的持有者永远是集群矩阵的**一整行 —— 横着的那 EP 张卡，也就是一个 EP 组（token 的 all-to-all 域）**。正交档这一行就是一个 DP 副本，每个 DP 自带整套专家，故 DP 与 EP 无须整除；切出档一个 DP 副本**不**持有整套（它只有 PP×TP×CP 张卡），故要求 `DP % EP == 0` —— 让卡能不多不少切成若干个**完整**的 EP 组。
- **顺带纠正一处术语**：`EDP = DP/EP` 是这样的完整组**共有几个**（专家权重的副本份数 / 专家梯度 all-reduce 域的大小），**不是「一行」的名字** —— 纵向同一列的那 EDP 张卡持有的是同一份 `E/EP` 个专家。行标签 EDP0…EDPn 标的是 d 轴索引（如同 DP0…DPn 标副本），说成「一个 EDP 组」会与框架里的 `expert_data_parallel_group` 撞车。
- **改到哪**：`js/config-relation-observer.js` 文件头把这条定为全页口径；`validate()` 的 `DP % EP` 一条改掉「某些 DP 副本拿不到完整专家集」这句错话，报错文案改成「末尾剩下的 N 张卡凑不齐一个完整的 EP 组」；文档视图「EP 与 DP」一章的口径对照表补一行「谁持有一整套专家」并给 EDP 那一行点明身份，反例收尾与 `DP % EP == 0` 约束卡同步改写；`js/config-relation-capacity.js` 口径浮层的 EDP 一行同改；EP 口径两枚按钮的 title 各补一句。
- **只改文案与注释，判据一个字节没动**：`tools/cro-selfcheck.js` 36000 步随机游走全绿。

---

## 2026-08-26 — config-relation-observer：新增 config-test/ 外部真实训练配置样本集

- **动机**：这页的四域表单一直只拿两个内置预设自测，没验过「业界真配置里的属性，本页能不能全接住」。`Profiling_Insight_and_Tool/training-run-twin-standalone/config-test/` 收 11 份公开配置 + 一份 README 对照表（2026-08-26 下载）。
- **三种方言各取样本**：MindFormers YAML（DeepSeek-V3 671B、Qwen3-30B-A3B —— 与本页 YAML 视图同一口径，`parallel_config` / `recompute_config` 几乎逐键对得上）；Megatron 命令行（Mixtral 8x7B 的 MoE + EP8、GPT-3 175B 的 TP8×PP16、Llama3-8B 是唯一带 `--context-parallel-size` 的一份）；HF Trainer / DeepSpeed（LLaMA-Factory 的 full / lora + ds_z3，用来验 LoRA 两枚与权重分片三档）。
- **已知缺口，先记下来不急着治**：模型结构常量（hidden / vocab / heads / kvHeads / intermediate / moeIntermediate / firstKDense / mtpLayers）写死在 `MODEL_PRESETS` 的两个预设里，外部配置进来只能挑形状最近的一个，DeepSeek-V3 的 hidden 7168 / 61 层拨不出来；页面也没有粘贴导入通路，眼下只能照着手拨 stepper。真要常态化验证，最小改动是先只认 MindFormers 的 `parallel_config` + `recompute_config` 两段。
- **DeepSeek-V3 那份还压着一个真问题**：`data_parallel: 4` 与 `expert_parallel: 32` 并存 —— 按本页切出口径 EDP×EP = 真 DP，world = 4×32×8×8 = 8192 卡，而 MindFormers 自己校验的是 dp×mp×pp = 256。两种读法本页能不能都表示出来，正是 EP 口径开关该被撞一次的地方。
- 顺手对表：`hf_qwen2_7b_config.json` 与内置 qwen2-7b 预设六项（hidden 3584 / heads 28 / kv 4 / intermediate 18944 / vocab 152064 / 28 层）逐位相同，预设本身可信。

## 2026-08-26 — config-relation-observer：新增导入配置通路 + 未映射键清单（升级计划行 20）

- **第六批开头，也是第一条不改任何数、只改「页面知不知道自己漏了什么」的行**。这一页此前是**单向**的（yaml 视图只写不读，grep 不到 file input / FileReader / 粘贴框），于是「拿一份真配置进来，页面接不接得住」这个问题根本问不出口 —— 行 21–32 的价值也就验不出来。新增 `js/config-relation-import.js` 与 `croObserver.importConfig()`，顶栏「导出配置」左边多一枚「导入配置」。
- **解析：三种方言，一个不引库的子集。** 本页纯静态无打包器（CLAUDE.md），引不进 yaml 库，所以自己写了个子集：缩进映射 + `- ` 列表 + 行内 `[a,b]`（含一层嵌套，deepseek3 的 `offset` 是 `[[…],[…]]`）+ 注释 + 引号 + 剥锚点。**刻意不做**多行字符串 / `<<: *ref` / 多文档 —— 样本里一次都没出现，做了就是挖一个「看着能用其实不准」的坑。文件头写死：⚠️ 不是通用 yaml 解析器。
- **sh 那支踩到一个必须修的坑**：真实脚本里要紧的数几乎全是变量引用（`--tensor-model-parallel-size $TP_SIZE`）。不回代的话落到表单的是字符串 `"$TP_SIZE"` —— **比读不到更糟**，是个看着像配置的假值。解析完统一回代（最多三层），自检台为此单列一条断言。
- **报告分五堆，第三堆才是这一行存在的理由**：落到表单 / 已识别·缺口（逐条挂着行 21–32 的行号）/ 结构常量（不覆盖）/ 已识别·不建模（通信、融合、调度、数据流程，整块折叠）/ **未识别（照样列出来 —— 吞掉就等于骗人说「都读了」）**。首行是一句可以核对的账：`总键数 ＝ 五堆之和`，数的是**键**不是行；核不平面板会直接印「有 N 个键没交代（这是本页的 bug）」。
- **「你给的 vs 页面收下的」是最要紧的一栏。** 导入后要走一遍配平，而外部配置常与本页口径不兼容 —— 配平会**改数**，不报出来就是静默篡改。11 份样本里 5 份被改过，每处都指向一个真问题：deepseek3 的 **EP 32→4**（MindFormers 的 `expert_parallel` 在 dp×mp 域上切，正是**行 23**）与 `VPP 2→1`（61 层除不尽 pp8×vpp2）；qwen3_30b 的 `shardMode none→zero1`（dp=1 时那枚控件本就置灰）；mixtral 的 `EP 8→2`、`SP true→false`。
- **一处必须落值、不能返回 null 的判断**：Megatron 不写 DP（由 world 反推），而公开样例多是模板（`NUM_NODES=1` 等着人填，可 TP8×PP16 至少要 128 张），world 除不尽。早先「除不尽就不落 DP」的写法会让表单留着上一个预设的 dp=512，配平把 Total Rank 顶到 **65536** —— 导入一份 175B 脚本得到六万五千张卡，比读不到还离谱。改成「配置没写就按 1 记」并写进报告注释。
- **三条入口，下拉框排第一。** 计划只写了「贴 / 传」，但那两条都要求用户手上先有一份配置。补了第三条：下拉框直接切 `config-test/` 里那 11 份公开配置（它们本来就是第六批的验收材料）。两处细节是这枚下拉好不好用的全部：（1）**每一项都带来源与「选它能看到什么」，常驻一行、不做 tooltip** —— 只写文件名的下拉是没法选的（凭什么知道 `mixtral_8x7b.sh` 与 `megatron_175b.sh` 该先试哪个），而「有没有代表性」是**选之前**就该看到的东西，藏进悬浮等于没写；（2）**页面默认配置也进了下拉，并且第一次有了名字**（`页面默认 · openPangu 2.0 flash 92B · 2048 卡`）—— 一个「别的都有名字、唯独你现在看的这屏没有」的下拉读不通。选它走的是**恢复**（把预设 defaults 整片喂回 importConfig）并报出改回了哪几项；⚠️ 卡型号与 EP 口径不在恢复范围（硬件与读法，不是配置内容）。
- 样例走 `fetch('./config-test/…')`；`file://` 下报的不是「读取失败」而是「这一页需要用 http 打开，也可以直接把内容贴进框里」。自检台加了一组**双向**断言：目录里列到的文件必须存在、目录下的文件必须都被列到（改名一个文件就在下拉里留下一条点了报 404 的死链，而那是用户最先碰到的入口），外加每项必须有名字、来源、代表性说明。
- **谁赢：定死并写在界面上**（计划明确要求的一条）。`totalLayer` / `routedExpert` / `topK` / `sharedExpert` 四项**配置赢**（它们本就是可调字段，导入的目的就是让表单跳档）；**结构常量一个都不覆盖**（由计算图给）。⚠️ 后者有个必须当面说清的后果，面板单开一栏：把 deepseek3 的并行度导到 openPangu 的结构上，**算出来的容量不是 deepseek3 的容量**（hidden 7168 vs 2560）。
- `importConfig()` 与 `set()` 的区别是「一次落一片」：十几项要同时生效，逐个 set 会在中途反复配平（先落 ep=32 而 dp 还是旧值，EP 当场被收回去），落到最后是一组谁也不认识的数。所以**先整片赋值、最后配平一次**，anchor 传 null。
- ⚠️ 设计系统没有 dialog / drawer 原语，面板用 tokens 拼了个最小实现（按钮复用 `.btn`），与本页的横幅、开关、segmented 同属「缺失样式」，待批准后一并吸收。
- **验证**：`tools/cro-selfcheck.js` 新增第 6 节，拿 `config-test/` 那 11 份真配置逐份撞 —— 解析不抛 / 方言认对 / 每份至少接住 N 个字段（回归下界）/ **每个键都有归宿** / **导入后 `validate` 为空**；另逐字核对 deepseek3 的 10 项、mixtral 的 world 反推、llama3 的变量全部解引用。11 份全过。这一行**没改任何显存口径**，基线数字（10.9/17%、25.0/10.9/7.7）与随机游走十二项断言逐位不变。

## 2026-08-26 — config-relation-observer：重计算升成四档 + LoRA 落地（升级计划行 18 / 行 19）

- **行 19 兑现的是行 9 自己记下的缺口**。那条 title 的末句原话是「要调中间档，这枚开关得换成一枚有档位的控件」—— 34 与 2 之间差着一个数量级，而**实际调优最常落的正是中间**。`FLAG_SPECS.recompute` 整枚换成 `recomputeMode`（`none / selective / layers / full`，第三枚带 `options` 的），`"full"` 就是原先那个 `true`，**默认档一个数都没变**（实测峰值仍是 10.9 GB / 17%，与行 15 / 17 记录逐位相同）。
- **四档的系数不是估的，是从行 9 同一篇里读出来的**：Korthikanti et al. 2022 §4 把每层 `34·sbh` 拆成 **attention 11 + FFN 19 + LayerNorm 4**，其中 10 是 TP 复制的、24 是 TP 切得动的（10 = 两个 LN 输入 4 + 两段 block 输入 4 + 两个 dropout mask 2）。于是「选择性 = 重算 FFN 段、只留它的输入」= `34 − (16+1) = 17`（开 SP）/ `9t+8`（关 SP）。**自洽性检查：TP=1 时三档收敛成 34 / 17 / 2，与 SP 无关** —— 与行 9 那两档同一个性质。实测激活 15.9 → 8.0 → 0.9 GB，选择性正好是关的一半（比值 17/34 已断言）。
- **⚠️ 「选择性」的口径必须写出来，因为真实框架里它不是一个定值**：MindFormers 的 `select_recompute` 收的是**算子名正则**，常见默认只挑 FFN 里的 SiLU / mul，落点在 17 与 34 之间，本页取「整个 FFN 段」这一端。而 Megatron 的 `--recompute-granularity selective` **没有列成一档** —— 它重算的是 attention 里的 softmax/dropout（`5·a·s²/h`），本页按 FlashAttention 建模、这一项本来就不计入，那一档在本页等于「关」。两处都写进了 title、`term-recompute` 与 yaml 行尾注释。
- **「按层数」是这一栏第一个逐 stage 分别生效的旋钮**，也是唯一能让激活段停在**任意中间高度**的一档：前 N 层按 `full`、其余按 `none`，N 按各段层数截断（46/4 → 12,12,11,11 时填 12，后两段就是整段重算）。实测 N=4：各 stage 激活 `10.9/8.2/4.8/2.4`（关档是 `15.9/12.0/7.3/3.7`）—— **整排小柱一起变矮、而且变平**，Stage0 降得最多，因为它在飞的份数最多。yaml 写出去的是 `recompute: [4, 4, 4, 4]`（框架本来的语法），截断口径与容量栏共用一条，两个视图不会各讲一套。
- **⚠️ 已知简化：N 是一个统一的数，不是逐 stage 各填一个。** MindFormers 的数组允许 `[8,4,4,0]` 这种按 stage 定制（真实调优里确实有人这么压 Stage0），本页只给一个 N —— PP 最大 128，一行表单摆不下 128 枚 stepper。截断带来的差异已经让各段不等，但「单独压平某一根」做不到，这条写进了 `term-recompute`，不埋在注释里。
- **行 18 的 LoRA 是容量柱上最大的一次形变，比行 15 的 FSDP2 还大**：16 B/参数里的 14 B（梯度 2 + 优化器 12）**只跟可训练参数走**。冻结主干后这两段只剩 adapter 的份 —— openPangu 默认档 10.9 → **8.0 GB**（梯度 2.3 → 0.0、优化器 0.5 → 0.0），Qwen2 27.4 → **9.2 GB**。**而权重段纹丝不动**（冻结不等于不用背），正好把「哪一段跟谁走」讲清楚。
- **⚠️ 也正因为如此，LoRA 不是「显存不够就打开」的旋钮，判定文案里的措辞是拧过的**：它省不到激活（反向仍要穿过整个网络才算得到 adapter 的梯度），而且它改的是**训练本身**。所以那句推荐带着前提 —— 「若这一跑本来就是微调而非预训练…」；调优顺序那张表也专门加了一句「LoRA 不在这条顺序里」。
- 建模口径：`8rH`／层（注意力 q/k/v/o 四个 `[H,H]` 各挂 A/B 一对，÷TP），FFN / 专家上不挂 —— 各家 `target_modules` 的默认就是注意力四件套，MoE 模型上给几百个专家逐个挂 adapter 不是常见做法。yaml 补 `model_config.pet_config`（`pet_type: 'lora'` / `lora_rank` / `lora_alpha=2r` / `lora_dropout` / `target_modules`）—— 与 FSDP2、VPP 那两处不同，**这一段是框架里真有的键**，所以照实写，只在注释里点明本页只建模了那四个矩阵。
- **两枚新 stepper 带出了两条通用机制**：（1）`FIELD_SPECS` 支持 `enabledWhen`/`disabledReason` —— 整枚 stepper 可以「置灰但仍能悬浮」，与那几枚开关同一副长相同一条判据（未开 LoRA 的 Rank、非「按层数」档的重算层数）；（2）`FIELD_SPECS` 支持 `maxOf` **动态量程** —— 重算层数的上界是 `ceil(层数/PP)` 算出来的，加减键（`specMax` → `rawStep`）、手输的量程校验、走不动时的悬浮理由三处读同一个数，否则会出现「加号停在 12、手输 16 却收下了」。
- **UI：batch 行也长出了一枚「高级选项」折叠**，判据与 parallel 那一行不同、各写各的：parallel 是「拨了 Total Rank 一张卡都不变」，batch 是「**只在另一枚控件拨到某一档之后才有意义**」（重算层数 / LoRA / LoRA Rank）。行里因此仍只留 Micro Batch / Seq Length / 重计算三枚。折叠机制随之从单例改成按行一份（`ADVANCED_ITEMS` 取代 `ADVANCED_GROUP` + `ADVANCED_FIELDS`，展开态 localStorage **各记各的**，parallel 的键名不变、老用户偏好不丢）。**拨到「按层数」时页面自己把 batch 折叠掀开** —— 不掀开等于拨了一个当场看不出效果的档，而这一档与另外三档的区别恰恰全在那个数上。
- 口径浮层：「权重 / 梯度」那一行拆成两行（LoRA 下两段的主语不是同一批参数，追一句说不清）；激活那一行改报**当前这一档的系数**（「按层数」档报「几层按 2 算、几层按 34 算」）；新增「LoRA」行（可训练 3.93M / 1244M = 0.32%）与「LoRA × 权重分片」行 —— ZeRO-1 切的正是已被 LoRA 压没的那一段，此刻几乎不省什么，不说的话用户会以为其中一枚没接上。
- 文档：`term-recompute` 整条重写（四档对照表 + 两处口径提醒 + 已知简化），新增 `term-lora`；「单卡显存由什么构成」两张表改口（梯度/优化器改成「**可训练**参数量 ×」，参数表新增「可训练与否」一行），「显存不够时该动哪一维」把「开重计算」一行拆成三行、新增「开 LoRA」一行并改写顺序经验。
- **Cluster 表单从三行压回一行（展开两行）**。⚠️ 根因不是宽度不够，是**换行按「组」发生**：`.cro-cluster__form` 的三个子元素里有两个自己就是 flex 容器（`#croClusterSteppers` / `#croBatchSteppers`），于是 batch 那四枚只要有一枚放不下就整块掉到第二行，展开的面板再占第三行。给两个容器上 `display: contents`（不改 HTML —— 它们是 JS 的挂载点），七枚控件成为表单自己的 flex 项，按格换行；面板的 `flex: 0 0 100%` 照旧自己占一整行。
- 同时量体裁衣，尺度整体收到**与 MoE 那一行同一档**（26px 圆键 + 2px 内衬 = 30px 高，那边同样是「一列塞四枚」的处境）：横向 gap 16 → 8、圆键内间距 2 → 1、四档页签内衬 8 → 3、折叠按钮内衬 12 → 8（文字与箭头 4 → 2）、Node 只读读数内衬 12 → 4（它没有加减键要瞄准）。卡型号放开 128px 下限并允许被压 —— 这一行里唯一允许压的一格，型号看半截也认得出；其余六格一律不压，**读数被压就是读错数**。
- **读数框的字符宽度下限升成按字段给（`spec.digits`，默认仍是 3）**：Micro Batch 的量程只到 64，却按三位数留白，常年显示一个 1 —— 这是这一行里省得最干净的一处。`readoutSize()` 收编原先散在三处的 `Math.max(3, len)`，CSS 侧的 `min-width` 兜底也跟着让到两位，否则 JS 省下的宽度会被它顶回去。只改下限不封上限，手输 120 时照旧跟着位数长。
- 卡型号选项从 `910B（64G）` 改成 `910B · 64G`：那对**全角括号各占一个汉字宽**（26px），够别处一枚加减键了，而信息一个字没少。
- **读数字号与标签字号一个没动**，收的全是留白；表单矮下来的那一截由 `.cro-cluster__grid` 自动吃掉（矩阵的高度预算本来就量它自己的盒子）。
- **折叠一开一合是一次真的版面变化，得跟着补两件事**（新增 `cro:layout` 事件）：折叠把**它下面的所有东西整块平移一行的高度**，Cluster 那一枚尤其明显 —— 矩阵直接上下挪一整行。于是（1）关系图的连线画在 viewport 坐标上，不重画就还连在旧位置（与滚动、窗口缩放同一类位移，那两处早有处理，折叠是第三处）；（2）收起腾出来的那截高度得让矩阵吃掉，否则 Cluster 区下面白着一条 —— 走的正是事件栏折叠那条同样的补量 `resyncClusterGeometry()`（`refitClusterCells` 默认 `growHeight:true`，所以展开时矩阵也会跟着收，两个方向都对）。
- 这条通路**不防抖**（与窗口 resize 那条 180ms 的不同）：折叠是一次确定的、一步到位的变化，防抖只会让矩阵慢半拍才长开。连线则**隔一帧再画** —— `resyncClusterGeometry` 有一条会走 `rebuildCluster` 的分支（腾出来的高度可能让 EP 的折行数都变了），重建后还有一次 rAF 里的补量，同帧画就画在中间态上。事件由控制器的 `setAdvancedOpen` 发、boot 里统一处理：控制器持有的是 config 与表单，不认识矩阵、也不该认识；且只在 `hidden` 真的翻转时发，首次恢复与「本来就开着又被联动掀一次」不算版面变化。
- **验证台从一次性脚本升成常驻工具**：`tools/cro-selfcheck.js`（`node tools/cro-selfcheck.js` 快跑 3.6 万状态 ~4s、`--full` 走 14.4 万 ~22s）。**按 .gitignore 不入库**——与 `js/test-syntax.js` 同例，本仓按设计没有 test runner，不为一个页面引入一套。它的价值在两处：一是那套加载台（这三个文件是给浏览器写的全局脚本，没有 export，只能用 `readyState:"loading"` 的 document 桩让 `boot()` 永不触发 + 读源码时注入一行 export 再喂 `vm`，验的是真代码而不是复制出来的副本）；二是把「与行 15 记录逐位相同」这类**人工声明变成了断言**（默认档 10.9/17%、三档 25.0/10.9/7.7 都在里面）。⚠️ 它**碰不到 DOM 与版面**，一行排布 / 折叠 / 连线位置一条都验不了，那些仍然只能靠人刷新看。
- **验证**（node 跑规则层 + 容量层，不起页面）：两模型 × 两 EP 口径 × 三种卡的加减键随机游走 **14.4 万个状态**（每 20 步随机拨一枚开关/档位），LoRA 覆盖 50.1% / 按层数 23.3% / 选择性 23.6%，十四项断言全为 0（含「置灰控件未停到 disabledValue」「重算层数越过动态上界」「可训练参数量 > 总参数量」三项新的）；另逐条核对：默认档与三档权重分片的数字与行 15 / 17 记录逐位相同（10.9/17%、25.0 / 10.9 / 7.7）、四档系数在 TP∈{1,2,4,8,16} × SP 两档下单调、选择性/全开与关的比值恰为 17/34 与 2/34、N=本段层数时等价于全开、LoRA 下激活逐位不变且梯度 ∝ rank、四档 × 三档权重分片 × LoRA 两态的六段全部非负有限、以及四档 + LoRA 的 yaml 输出。

## 2026-08-26 — config-relation-observer：CP 增 Ulysses / Ring 两档口径，新增 VPP stepper（升级计划行 16 / 行 17）

- **行 16 治的是一条错误的红线**：`seq % (2×CP)` 是 ring attention 专属的约束（因果掩码下要对半交叉分配才均衡），而 MindSpeed MM 特性表里标 CP 的模型多数走 **Ulysses** —— 它沿**头**维做 all-to-all，序列长度爱是多少是多少，约束改落在 `num_heads % (TP × CP) == 0` 上。新增 `cpMode`（`ulysses` / `ring`，`FLAG_SPECS` 里第二枚带 `options` 的），默认 Ulysses；两个预设 CP 都是 1，**默认档逐位未变**。
- **它与 EP 口径长得像但不是同一种东西**：`moeOrthogonal` 是「同一批卡的两种读法」，切一下一个数都不该变；`cpMode` 换的是真算法（拦的字段、并行度上限、通信形态全不同）。唯一相同的是**显存** —— 两档都让每卡留 `S/CP` 份激活，capacity 一个数不动，这一句已写进口径浮层的「序列长度」行（不写的话用户拨一下发现容量柱不动，只会以为开关没接上）。
- **Ulysses 那条是页面第一条把两个可调字段绑在一个乘积上的硬校验**。`structurallyAllowed` 从只判 `tp` 扩成判 `tp / cp / vpp`，**tp 与 cp 互为条件、两边都跳档**（只跳一边的话加减键能把页面推进一个 `reconcile` 修不动的报错态）。openPangu 可达档：`tp=1 → CP 1/2/4/8/16`、`tp=2 → 1/2/4/8`、`tp=4 → 1/2/4`、`tp=8 → 1/2`。TP 到顶的悬浮理由多一档 —— 尾句从「这几个数都是模型常量」改成「头数改不了，但 **CP 是可调的**」，因为这一头卡住时出路第一次不在模型常量之外。
- **⚠️ 验证跑出一个真 bug：联动修出来的值必须留在 2 的幂梯子上。** CP 的合法基数会带奇因子（`48 / TP8 = 6`），`nearestDivisor` 给出 CP=3 后 world 永远卡在 `3·2^k`、凑不回 `2^15` 的 Total Rank，页面停在一条**它自己造出来的**红字上（3 万步走查里 10 次）。新增 `nearestPow2Divisor` 只给这一处用 —— 手输仍可停在 3，但联动不该产生一个用户没要求、页面又收不回来的数。前 15 行没踩到，是因为此前所有修复分支的基数恰好都是 2 的幂。
- 软警告新增 `Ulysses 档：TP × CP > 每节点卡数`（两者争同一批头也争同一条链路，组内卡数是乘起来的）；行 7 那条 GQA 的 KV 复制警告从只看 `TP` 改成看 `TP × CP`。**⚠️ 判据改对了但穷举验过：当前两个预设上仍不可达**（Qwen2 的 `TP×CP` 只凑得出 1/2/4，全整除 KV 头数 4），换个 heads:kvHeads 比值更大的模型才活。
- **行 17 的账全在激活上，这正是它值得做的理由。** VPP 不占卡（**不进 world 乘积**），只把本卡那几层再拆成 VPP 段轮流跑：气泡按 `1/VPP` 缩小，代价是在飞的未反向激活变多 —— 页面此前把 `inflight = PP − s` 写死成非交错 1F1B，那排小柱**已经画着这一项、却没有旋钮能动它**。
- **在飞份数改用交错式 1F1B 的逐 stage 式** `[2(PP−s−1) + (VPP−1)·PP + 1] / VPP`：前半是 warmup 多灌的份数，`+1` 是正在算的那份，`÷VPP` 是因为每份只压一个 chunk。`s=0` 时化简成 `PP·(1 + (PP−1)/(PP·VPP))`，**正是 Korthikanti et al. 2022 §2.2 的交错式惩罚因子**（本页 `actPerLayer` 的系数同出一篇），九组逐位相等已核。两条分支不能合并 —— VPP=1 时框架走的是另一套调度。
- 实测（openPangu 48 层 / PP4 / ZeRO-1，激活 GB）：VPP=1 `0.94/0.70/0.47/0.23` → VPP=2 `1.29/1.05/0.82/0.59` → VPP=6 `1.05/0.98/0.90/0.82`。读法是**整排小柱一起抬高、而且变平**，末段抬得比首段还多。
- **VPP 比 PP 严格，而这一条在默认预设上立刻咬人**：交错式要求每段等长（`层数 % (PP×VPP) == 0`），而本页的 PP 允许不均分。openPangu 的 **46 层连 PP=4 都除不尽**，所以默认档下 VPP 只能是 1 —— 按加号时**抬 Total Layer 到 48**（唯一一个改了不连累卡数的对手字段），不是收 VPP。`reconcile` 里这一段放在配平之后（PP 可能刚被 `fitParallelWorld` 改过）。
- **⚠️ 明确的已知简化：只建模 VPP 的调度代价，不改层 → stage 的画法。** 真实交错式下 stage0 持有的是分散在全模型各处的几段，而 Layer 导航 / 整网 deck / 集群矩阵仍按连续分段显示 —— 改它要动 deck pattern 的 `stageRanges` 契约（收的是连续区间），已写进 `term-vpp` 让用户看得见。
- yaml：新增 `context_parallel_algo`（只在 CP>1 时写）、VPP 两行 `#` 标注（MindFormers 不在 `parallel_config` 段给这个数，与行 15 的 FSDP2 同一种处理）；`micro_batch_num` 从 `4×PP` 改成 `max(4×PP, PP×VPP)`（VPP ≤ 4 时数一个没变）。顺手补了 `L()` 一直缺的兜底：代码超过 `NOTE_COL` 时注释会直接贴在值后面（`'colossalai_cp'# Ring…`），现在至少留一个空格。
- **UI：折叠的判据被换掉了，这是这轮最值得记的副产物。** 原先那句「都是切法、不额外占卡」立不住 —— CP 口径换的是**算法**、VPP 换的是**调度**，两个都塞不进「切法」，却都该收起来。换成一条一眼可验的线：**拨了 Total Rank 一张卡都不变的，收进折叠**。于是明面上留下的恰好是 world 乘积的四个因子（DP×PP×TP×CP）加模型自身的层数，五格不折行（正是 08-26 建折叠那次想要的形状）；折叠里五枚：VPP / CP 口径 / SP / 词表走 DP / 权重分片。
- VPP 归入折叠还有两条独立佐证：真实调参里它在**第二梯队**（先 DP/TP/PP/EP 装下模型，再用重计算与权重分片挤余量，最后才量着气泡动它）；且**默认预设下它压根拨不动**（46 层连 PP=4 都除不尽），摆在首屏正中间等于再犯一次行 6 判 Node 时那句「一枚只能停在一个值上的 stepper 不是 stepper」。代价是教学点默认收着，兜底是口径浮层照说不误 + **面板会自己掀开** —— `emit()` 新增一条：被标红的字段若正收在折叠里，先掀开再标红（VPP 是第一枚进折叠的可手输 stepper，「红圈名单必须与横幅名单一致」这条从此要多守一步）。新增 `ADVANCED_FIELDS` 与 `attachStepper()`（行里与面板里共用同一套登记）。
- 折叠按钮的字面从「高级」改成**「高级选项」**（「高级」单用像个形容词，不像一个可点的东西）；同步改了三处用户可见的引用（两个词条的归属标、term-vpp 正文、容量栏口径浮层里指路 SP 的那一句）。历史 CHANGELOG 条目保持原样，它记的是当时的状态。
- **stepper 也能有悬浮说明了**：原先只有 `FLAG_SPECS` 那几枚开关带 `title`，于是「高级选项」面板里四枚开关悬浮都答得出话、唯独 VPP 不吭声。`spec.title` 挂在 `.cro-stepper` 外壳上（`buildStepper`），悬浮标签或读数即出；加减键走不动时按钮自己的 `stepBlockReason` 更靠内、照旧优先显示 —— 「这枚是干什么的」与「为什么点不动」是两个问题，分两处答。这条通路对任何 `FIELD_SPECS` 字段都可用，目前只填了 VPP：DP / PP / TP / CP 是这个领域里不用解释的通用缩写，VPP 不是。
- ⚠️ **合流点修一处：`emit()` 里 `wrap.title = usable ? "" : spec.disabledReason` 会把 `buildStepper` 挂上的说明在第一次刷新时抹掉**（行 18/19 给 stepper 加「整枚不可用」时新写的那一句，与本轮的 `spec.title` 撞了，表现就是 VPP 悬浮不出话）。改成两件事相叠：可用时给正文，不可用时「理由 + 空行 + 正文」—— 与 `buildFlagSwitch` / `buildFlagChoice` 那两处逐字同一种写法。加减键置灰时按钮自己的理由更靠内，仍旧优先。
- VPP 的悬浮按「是什么 → 调大治什么 → 调小治什么 → 它比 PP 严格在哪」四段写：调大治流水线气泡（PP 大、micro-batch 又被全局 batch 卡住时它是唯一还能压气泡的旋钮），调小治激活峰值（那排小柱整体抬高且变平，末段抬得比首段还多），并点破默认预设下它只能停在 1 以及按加号会把 Total Layer 抬到 48。
- **Cluster 区标题右侧那行 d 轴口径说明整体移除**（「矩阵纵轴 = EDP 8（DP 512 ÷ EP 64）· 一行是一个完整模型副本，含全部 64 个 EP rank」）：`syncClusterAxisNote` 与它的调用点、`#croClusterAxisNote` 那个 `<span>`、`.cro-cluster__axis-note` 一并删掉，标题行只留区名。那句换算并没有丢 —— 矩阵格子的悬浮提示、单卡容量栏口径浮层的「EDP」一行、文档视图「EP 与 DP」一章三处都答得出来；`dAxisName` 决定标签写 EDP 还是 DP 的那条逻辑照旧。
- 文档新增 `term-vpp` / `term-cp-mode` 两个词条，规则章新增三条（Ulysses 硬约束、`num_layers % (PP×VPP)`、Ulysses 跨节点软约束），`term-cp` / `term-pp` / 五维表 / 显存构成 / 调优顺序五处改口。
- **验证**（node 跑规则层 + 容量层，不起页面）：两模型 × 两 EP 口径 × 三种卡的加减键随机游走 **30.5 万个状态**，VPP>1 覆盖 23.8% / Ring 档 8.3% / 软警告 28.5%，十四项断言全为 0；另核对默认档三档权重分片与行 15 记录逐位相同、Korthikanti 恒等式九组、两档 CP 四个 stage 容量逐位相同、两档各自拦得住对方放行的那组参数、四种 yaml 输出。

## 2026-08-26 — config-relation-observer：Model Architecture 行末尾新增「高级 ⌄」折叠，SP / 词表走 DP / 权重分片三枚收进同一行

- **改动**：`mount()` 对 `parallel` 行不再直接铺开三枚 flag 控件，改由新增的 `mountAdvanced()` 在行末摆一枚 `.cro-advanced-toggle`（`.btn .btn-sm .btn-ghost` + 下箭头），三枚控件放进 `.cro-advanced-panel`（`flex-basis:100%`，展开时自成一行）。
- **为什么**：三者都是「不额外占卡的切法」，日常调参很少动，却各占一格把前五枚 stepper 挤到第二行。
- **展开态记忆**：`localStorage["cro:parallel-advanced-open"]`，读写都包 try/catch（隐私窗口下退化为收起）。
- **联动可见性**：`highlightLinkedChanges()` 里若被联动改掉的字段正收在折叠中（TP 落回 1 强制关 SP），先掀开面板再播高亮，且不写回用户偏好。

## 2026-08-26 — training-run-twin-standalone：新增 `chat.HTML`，把「空白 IDE 外壳 + 右上角 AI 入口 + 智能对话抽屉」抽成零依赖单文件

- **AI 入口与对话抽屉只存在于 `training-monitoring-v2.html`**（`training-monitoring.html` 无此功能，已停更），故以 v2 为源抽取：顶栏 `#trainChatToggle`、`#trainChatPanel` 全套 DOM、`.wzh-chat-*` 样式段（v2 内联 style 的智能对话一节）、以及 `js/training-chat-panel.js` 全文。
- **依赖全部内联，可整文件搬到其它工程**：`css/{foundation,semantic,components,style}.css`（style.css 去掉三行 `@import`）+ `css/{workbench-shell,ide-frame}-pattern.css` 依序进同一个 `<style>`，分 8 段加了来源注释；`pic/welink.png`（「消息设置」演示的 WeLink 图标）转成 data URI。成品 233 KB，无任何外链请求，`file://` 直开亦可。
- **主体只留空框架**：整屏 `.pto-ide-frame`（顶栏 + activity rail + 单栏工作区），工作区里一张 `.chat-shell-card` 空卡占位待填；未引入 `ide-frame-pattern.js`（无分栏可拖），顶栏主题切换改为本文件内的 20 行内联脚本。
- 对话面板对宿主页的依赖本就是软的 —— `window.twinGetTrainingContext()` / `twinDemoApplyAccuracyOverride()` 都带 `typeof` 兜底，缺席时系统提示自动降级为「训练态数据暂未就绪」，故不必一并搬运 `training-run-twin.js`。

---


## 2026-08-25 — config-relation-observer：「优化器并行」升成三档「权重分片」，FSDP2 不再被当成 ZeRO-1（升级计划行 15，第五批开头）

- **起因是拿 MindSpeed MM 的「已支持特性概览」表头当 checklist 逐列比对本页**（`pic/README (1).md`）。10 列里 5 列覆盖到位、1 列口径有偏差（CP 全按 ring attention 建模，而表里多数模型标的是 Ulysses）、3 列缺失（VPP / LoRA / FSDP2）、1 列（RL）判定为不该进本页。据此把升级计划从 14 行扩到 19 行，新增「第五批」与一节「附：第五批的由来」记下判据 —— **不是「表里有就要做」**，只有会改变切分拓扑或单卡显存分子/分母的列才落进清单。
- **行 15 治的是一处「说得太笼统」而非算错**：`term-parallel-optimizer` 正文写着「ZeRO-1 / FSDP 一类」，把两个切法不同的东西并成了一句。ZeRO-1 只切优化器状态；FSDP2 是 ZeRO-3 口径，权重与梯度也一起切。README 表里最新那批模型（Qwen3-VL / InternVL3.5 / Wan2.2 / Qwen3-Omni / Magistral）**几乎全部只勾 FSDP2 + Recomputation、TP/PP/CP 一格不勾**，按 ZeRO-1 给它们估显存会高出一大截。
- **布尔 `parallelOptimizer` 整个换成三档 `shardMode`（`none / zero1 / fsdp2`）**，不是再加一枚布尔：关 ⊂ ZeRO-1 ⊂ ZeRO-3 是一条阶梯，做成布尔组合会拨得出「切权重但不切优化器」这种不存在的状态。`zero1` 就是原先那个 `true`，**默认档逐位未变**。
- **`FLAG_SPECS` 长出「带 options 就不是布尔」这条通路**，代价比预想小：`reconcile` 的 `disabledValue` 遍历、联动高亮、红圈名单、横幅改动清单全是按字段名遍历的，一行没改；只动了三处 —— `mount()` 按 `spec.options` 分发到新的 `buildFlagChoice`、sync 多一个 `choiceControls` 循环、横幅里写死的 `onOff()` 升成导出的 `flagText(flag, value)`。控件用 segmented-control（照抄 `.cro-ep-mode`）而不是下拉：三档要一眼看全才读得出那层递进。⚠️ 置灰用 `aria-disabled` 而不是原生 `disabled` —— `.btn:disabled` 带 `pointer-events: none`，`title` 弹不出来，而 DP=1 时「为什么点不动」必须有地方说。
- **显存模型**：`optimShards` 拆成 `dpShards`（两个分母，逐字未改）+ `shardPlan`（哪几段被切），三档共用同一组分母 —— 切的是同一维，差别只在切哪几段，所以行 10 那条「两个 EP 口径给出同一个数」自动继承。新增 all-gather 暂存段：**峰值由「最大的那个分片单元」定而不是总参数量**（`paramsOfStage` 多返回 `unit`，取「本 stage 最重的一层」与「词表那一块」的较大者），预取深度 `RUNTIME.fsdpPrefetch = 2`（⚠️ 与 `MOE_SHARD_MIN` 一样标了「待实测标定」）。它进预留段而不是新开第七段（权重段的语义是「常驻」，这份缓冲算完即弃），在 `reserveParts.unshard` 里单列，且只在 fsdp2 档写出来。
- **openPangu 2048 卡三档实测**：关 25.0 GB/39%（权重/梯度/优化器 2.32/2.32/13.90）→ ZeRO-1 **10.9 GB/17%**（2.32/2.32/0.46）→ FSDP2 7.7 GB/12%（0.08/0.08/0.46 + 暂存 1.45 GB）。前两行与行 10 落地记录里的数字逐位相同。FSDP2 档最有意思的是：DP=512 把权重切得只剩 0.08 GB，**不被切的 all-gather 暂存反倒成了权重相关里最大的一块**，判定文案专门点了这一笔。词表 388M 参数比一层重得多，所以「首尾 stage 更重」这个老结论在 FSDP2 档换了个理由继续成立（暂存 1.45 GB vs 中间 stage 0.25 GB）。
- **软警告复用行 7 那一档，零新机制**：fsdp2 且 TP/PP/CP 有一个 >1 就提示两条路线混用。硬拦是错的（HSDP + TP 有人在跑），但值得说一句。
- **yaml 多写一行注释、不多写一个开关**：MindFormers 的 `parallel` 段没有 FSDP2 的同名项，fsdp2 档只补一行 `#` 标注并明说它对应 MindSpore 的 `optimizer_weight_shard` 全分片档 / MindSpeed 的 `--use-torch-fsdp2`。不写不行 —— 容量柱此刻按 ZeRO-3 画，yaml 一个字不提就又回到了行 9–11 治的「两个视图各讲一套故事」。
- **文档侧这次是自己写而不是代码追平文档**（原词条说的就是错的）：`term-parallel-optimizer` 整条重写（表头改「权重分片」，新增三档对照表），另有六处正文逐处改口 —— 规则章「DP 不省显存」的例外说明、两处行内注释、`term-dp` 与 `term-vocab-emb-dp`、「单卡显存由什么构成」表的 DP 行、「显存不够时按什么顺序调」表（多出 FSDP2 一行）与其下的顺序经验。词条 id 保持不变（页内有链接指向它）。
- **验证**（node 跑规则层 + 容量层，不起页面）：两模型 × 两 EP 口径 × 三档的加减键随机游走 **16 万步**（每 20 步随机拨一枚开关/档位），「落在报错态 / world 乘积不符 / 段非法 / unshard 异常」四项全为 0；另逐条核对三段单调不增、ZeRO-1 不动权重与梯度段、非 fsdp2 档 `unshard` 恒为 0、两个 EP 口径六段逐位相同、DP=1 时三档都被 `reconcile` 停到 `zero1`、软警告的四种触发组合、三档的 yaml 输出。

---

## 2026-08-25 — config-relation-observer：yaml 的 batch_size 改按 full_batch 全局口径写，配平候选序把 EP 后移（升级计划行 12 / 行 14，清单收尾）

- **行 12 查证结论：`full_batch: True` 下 `runner_config.batch_size` 是全局 batch，不是每卡量。** 两处证据：MindFormers《大模型性能调优指南》讲 IO 瓶颈时的原话「在配置为 true 时，每张卡都取 global batch size 的数据量，然后在图内完成数据的切分，只取对应 DP 域内所需数据进行训练」（同段的「每张卡读取 IO 量都存在 DP 倍的冗余」是旁证）；源码 `mindformers/dataset/base_dataset.py` 在 semi + full_batch 下把分片置成 `shard_id=0 / num_shards=1`，`dataset.batch()` 收的就是配置里那个数，**没有任何 ×device_num 的补偿**。
- **所以 `BASIS.microBatch` 不除 DP —— capacity 一个数都没改**，「加 DP 只增吞吐、容量柱纹丝不动」这个卖点保住了（计划里预告的推翻没有发生）。错的是 yaml：那一格填 MBS 会被框架读成全局 batch，DP=512 时每卡实际只训 1/512 个样本、batch 维还切不开。现改为 `MBS × DP × micro_batch_num`，默认档 `1 × 512 × 16 = 8192`，行尾注释给出全式与「图内按 dp 切、再分微批 → 每卡每次前反向 1」。
- 仍是**代码追平文档**：`term-mbs` 早写着「全局 batch = MBS × DP × 梯度累积步数」。文档侧只补同一句话的两处落点 —— `term-mbs` 新增一段「YAML 里那一格填的不是这个数」，容量栏口径浮层 `global batch` 一行补上同样的提醒（用户对着「表单 mb=1 / yaml 8192」起疑时点开的正是它）。`full_batch: True` 那行也补了行尾注释。
- 顺带两处（行 12 自身的正确性所需）：`micro_batch_num` 从无条件 `4×PP` 改成 `PP>1 ? 4×PP : 1` —— 它现在是 `batch_size` 的因子，PP=1 时写 4 等于凭空多一层梯度累积；`L()` 的 `field` 允许给一组字段（`["microBatch","dp","pp"]`），否则改 DP 时这一行数字变了却不标「与默认不同」。
- **行 14：`fitParallelWorldOnce` 候选序 `dp→ep→tp→cp→pp` 改为 `dp→tp→cp→ep→pp`。** EP 是牵连最广的一维（同时动 MoE 分组、集群矩阵列数、容量栏专家段），不该在 DP 之后第一个被牺牲。**只有正交档看得见** —— 切出档下 EP 本就被摘出候选（不进 world，改它补不上差额）。
- 验证（node 跑规则层，不起页面）：两模型 × 两口径 × 三种卡的加减键随机游走 **32.5 万步**（每 20 步随机拨一枚开关），「报错态 / 矩阵格子数≠Total Rank / DP 除不尽 EP / 节点装载 / world 乘积」五项全为 0；新旧候选序跑同一条随机序列，拖 Total Rank 导致 EP 被动的次数在**正交档 1177 → 287（−76%）**，切出档 **11 → 11 逐位不变**（那 11 次来自行 2 的「DP 被 EP 顶住时降 EP 再补一轮」，与候选序无关）。
- 至此升级计划 14 行全部落地。

---

## 2026-08-24 — config-relation-observer：优化器并行与词表放法提成开关，capacity 与 yaml 的四处口径打架全部消解（升级计划行 10 / 行 11）

- **`parallelOptimizer` / `vocabEmbDp` 提成 config 字段**（进 `MODEL_PRESETS.defaults` 与 `FLAG_SPECS`，默认均为 `true`，照抄 yaml 原先写死的那两行）。至此附录那张「capacity 与 yaml 各讲一套故事」的表**四行全部消解** —— `recompute / seq_parallel / parallel_optimizer / vocab_emb_dp` 四枚开关都进了 config，两边读同一份来源。仍是代码追平文档：`term-dp` 早写着「唯一的例外是开了优化器并行」，显存构成表里 `Embedding / LM Head` 一行原话就是「这是个开关，不是默认行为」。
- **行 10 的分母是两个，不是计划里写的那一个。** 一张卡上的参数分两类，「同一份参数被复制了多少份」不是同一个数：路由专家只在 EDP 维上复制 → `÷ EDP`；其余权重（attention / dense / 共享专家 / 词表 / router）在整个数据并行域上复制 → `÷ EDP×EP`。`paramsOfStage` 因此从返回一个总数改成返回 `{ total, expert }`（权重与梯度按 `total` 算，只有优化器段要拆开），新增 `optimShards` / `optimBytes` / `embHeadBytes`。
- **分母写 `EDP×EP` 而不是 `DP`，是为了守住「两档说的是同一批卡」**：切出档 `EDP×EP = DP`，正交档 `EDP×EP = DP×EP`（后者的 attention 权重确实也在 EP 轴上复制了一遍）。写 `DP` 的话切一下 EP 口径优化器段会差 64 倍，而口径开关一张卡都不该改。实测两档六段体积逐位相同，容量栏脚注「本栏各段体积两档相同」保住，只是理由从「这里没有任何一段按 DP 切」（已不成立）换成「两个分母都是同一批卡数出来的」。
- **默认档容量柱掉一半多**：openPangu 2048 卡默认配置下 Stage0 从 **25.0 GB / 39%** 降到 **10.9 GB / 17%**，优化器段 13.9 → 0.46 GB。**行 11 在默认档上一个数不动**（TP=1，÷1），TP=8 时 Stage0 权重段 0.30 → 0.93 GB、末 Stage 0.27 → 0.90 GB —— 计划说的「首尾两根柱子明显抬高」。顺带更正计划里那个数：`388M ≈ 6.2 GB（含梯度+优化器）` 只在**未开优化器并行**时成立，默认档光权重加梯度是 1.5 GB，两处文案按此分档写。
- UI：Model Architecture 行现为 5 枚 stepper + 3 枚开关（`flex-wrap: wrap`，八格会折行）。归属按那一行自己的判据判 —— 词表决定那张大矩阵走 TP 还是走 DP、优化器并行沿 DP 维切优化器状态，两者都是切法，只是都不额外占卡（与行 9 判 SP 同一条尺子）。
- **`disabledValue` 从三条散在 `reconcile` 里的 if 升成 `FLAG_SPECS` 里的一栏。** 两枚新开关各有「此刻毫无效果」的条件（词表在 TP=1、优化器并行在 DP=1），与 SP 在 TP=1 时同构，都做成置灰 + 强制取值；但**停的那一档与 SP 相反**：判据不是「关掉」，而是「停在没有效果、且不会在 yaml 里留下一行需要解释的值上」—— SP 默认 `False` 故停 false，另两枚默认 `True` 故停 true（写成 False 反倒会多标出两行「与默认不同」）。SP 的行为逐位未变。
- **关掉一个行 9 埋下、开关变三枚后会穿帮的洞**：手输报错横幅的「改动清单」与红圈名单都只遍历 `FIELD_SPECS`，建议里若含「TP 降到 1」，SP 会被 `reconcile` 一并关掉而横幅一字不提 —— 「一键应用」等于偷偷拨了一枚开关。两处补上 `FLAG_SPECS`（值写「开 / 关」），CSS 补 `.cro-stepper.is-invalid .cro-switch__track`（药丸轨道用 `outline` 而非 inset 阴影，圆点会盖住内描边）。
- 判定文案分两档写（计划点名这是「最常被引用的一句」）：优化器并行关着时预警档建议「先开它，不撞任何整除约束」；开着时那句老话收回一半，改成「加 DP 只摊薄优化器状态那一段（当前 X GB），权重 / 梯度 / 激活不动」。口径浮层 `DP` 一行同样分档，新增「词表 Emb / Head」一行；yaml 两行的行尾注释把分母写全，稠密模型与 `DP=1` 各走一支（后者如实说「此档等同于关」）。
- 文档：新增 `term-parallel-optimizer` / `term-vocab-emb-dp` 两个词条，原有四处补「本页已如此落地」；顺手把行 9 遗留的 `═ MoE 区 ═` 分区标记从 `term-sp` 前挪回 `term-routed` 前。
- 验证（node 跑规则层 + 容量层，不起页面）：两模型 × 两口径 × 三种卡的随机游走 **36 万个状态**（每 20 步随机拨一枚开关），除既有十二项外新增「专家参数 ≤ 总参数」「各段非负且有限」「开优化器并行后 optim 不大于关着时」「两个分母确为 EDP / EDP×EP」「置灰时停在 disabledValue」「词表走 DP 时首尾更重、TP=1 时两档相等」六项，**全为 0**。

## 2026-08-24 — build-pptx skill：动手前先问「保留全文 / 允许精简」

- `Profiling_Insight_and_Tool/skills/build-pptx/SKILL.md`: 新增一节「Resolve the text-fidelity mode before building」，把「要不要压缩正文」从 skill 的默认动作改成用户的显式选择——此前它做 web PPT 时惯性删减源文档文字，用户拿到的是一份自己没同意过的摘要。该问题为阻塞式，与已有的输出形态（.pptx / HTML）、PowerPoint 明暗主题两问并列，在写大纲和 slide map 之前问；用户本轮已表态过（如「别删我的字」）则不重复问，同一份 deck 的后续修改沿用该选择，换源文档重新问。Mode A（保留全文）只允许改写措辞与合并字面重复句，挤不下就加页 / 拆节 / 换版式，不许缩字号、不许把正文挪进备注；Mode B（允许精简）可压成结论要点，但数字连同单位与基线、证据状态标注、显式限制条件、专名一律保留，且交付时要列出被合并 / 概括 / 略去的部分。两条校验清单（在线 PPT 与 .pptx）各加一条阻塞项；slide map 在 Mode A 下要覆盖到每个实质段落而不只是每一节。

## 2026-08-24 — config-relation-observer：TP 受 intermediate 约束、重计算/SP 提成配置字段（升级计划行 8 / 行 9）

- `attentionHeadBasis` 更名 `tpShardBasis`，从 `heads` 扩成 `gcd(heads, denseIntermediate, moeIntermediate)`（openPangu 16、Qwen2 4），`validate` 增两条 intermediate 整除硬校验。**2 的幂梯子上可达档位逐位未变**，差别只在手输：openPangu TP=3/6/12/24/48、Qwen2 TP=7/14/28 现在被拦。悬浮理由改成把三个数都列出来。
- **补一条「MoE 分片太薄」软警告**：整除只拦得住手输，而行 8 真正想说的「切碎」是 `1024 ÷ 16 = 每卡 64` —— 除得尽但 GEMM 的 N 维太窄。阈值 `MOE_SHARD_MIN = 256` 是**启发式、待实测标定**，标定方法与 `RUNTIME` 那几个系数写在一起。openPangu 在 TP=8 / 16 各触发一次。副作用：行 7 那条 `kvHeads % TP` 警告随之不可达（Qwen2 的 TP 被 gcd 顶死在 4 = KV 头数），代码里留着并注明原因。
- **`recompute` / `seqParallel` 从 yaml 硬编码提成 config 字段**（进 `MODEL_PRESETS.defaults`，yaml 的「与默认不同」高亮自动跟上）。此前两边假设正好相反 —— capacity 按「不重计算 + 开 SP」取 34，yaml 写死 `recompute: True` + `use_seq_parallel: False`。
- capacity 的 `actPerLayer` 从死系数改成按开关与 TP 取值的四档函数，来源是 Korthikanti et al. 2022 §4 的 sbh 系数式：不重计算 `10t+24` / `34`，全重计算 `2t` / `2`（`activationBytes` 统一除以 TP，故不含 `/t` 的两档先乘回 t）。TP=1 时四档收敛成 34 与 2，与 SP 无关。**默认档下 YAML 逐字不变，变的是容量柱** —— 默认全重计算，激活段大幅缩短。
- UI：两枚**开关**（`.cro-switch`，与 TaskCompare.html「标记最优」那款逐条相同，只改了前缀）**分在两行**：`seqParallel` 接在 Model Architecture 行的 CP 之后（它是实打实在切，沿序列维切激活，只是不额外占卡 —— 放 batch 行违反那一行「不参与切分」的判据），`recompute` 留在 batch 行（一刀不切，只决定每份留不留）。由 `mount()` 按 `FLAG_SPECS[flag].group` 各自接到所属行末尾，外壳仍是 `.cro-stepper` 故与邻格齐平，轨道右边跟「开 / 关」二字；各带说明 title（SP 那条给了完整算法）。走普通 `controller.set()`，布尔字段不进 world 乘积。用开关而不是按钮/stepper：这两项只有开与关，且开着时要一直看得见 —— 按钮读起来是「点它会发生一件事」，开关读起来是「现在是这个状态」。⚠️ 设计系统无 switch 原语，同一组件现有两份 page-local 实现，应一起吸收。
- **TP = 1 时 SP 开关置灰，且 `reconcile` 强制 `seqParallel = false`**：不强制的话「TP=8 开着 SP → TP 降回 1」会留下一个改不动的开状态（控件灰着，YAML 却写 `use_seq_parallel: True` 并标「与默认不同」）。做成置灰而不是隐藏，是因为默认配置就是 TP=1（隐藏等于首屏看不到它），且隐藏会让这次强制关闭发生在看不见的地方。强制关闭走既有的联动高亮（`highlightLinkedChanges` 纳入布尔开关，`.cro-switch__track` 加入闪烁选择器）。
- 文档补两处口径差别：SP 确实没有自己的并行度（切几份由 TP 决定），而**重计算在真实世界有中间档**（`select_recompute`、按 stage 给层数、Megatron 的 selective / num-layers），本页按全开全关两档建模，`term-recompute` 注明了将来要调中间档需换成有档位的控件。
- 文档：新增 `term-recompute` / `term-sp` 两个词条（每个表单字段都有一条，新控件不补就是缺口）；`intermediate_size % TP` 规则与 `term-tp` 补「已如此落地」；显存构成表的激活行补上全重计算档。
- 验证：加减键随机游走 21.1 万个状态仍全为 0，软警告覆盖率 2.8% → 8.1%；四档系数与各档手输 TP 逐一核对。

## 2026-08-24 — config-relation-observer：Node 改为硬件派生、新增软警告一档（升级计划行 6 / 行 7，顺带吸收行 13）

- `CARD_SPECS` 增 `ranksPerNode`（三档都是 8，来源写进各自的 `specs`：910B 取自本仓 `ascend_analysis_verl_20260602` 报告的「rank0→peer1–7 全 HCCS、无 RDMA」，950 由 `KNOWLEDGE.md` §4.4「128 NPU / 16 台 Server」反推）。
- **Node 退出 stepper，改为只读派生读数**：每节点卡数是定值后，Node 只剩唯一一个合法值，一枚只能停在一个值上的 stepper 不是 stepper。新增 `nodeLayout()` 作为整页唯一算节点数的地方；不足一机按实际张数算，非整机倍数**不摊薄**而是照实说「末节点 N 卡」（摊薄会把真实硬件形状算成不存在的形状，`rank → node` 也会跟着错）。yaml 的集群注释同步带上这个分支。
- **新增软警告一档** `warn(config)`，与 `validate` 并列、由 `derive()` 带出：渲染成一枚与红色报错同构的黄色横幅（共用几何，只有描边与底色分色；两档互斥，不会叠加），但不标红 stepper、不冻结图形、不进建议修法；只在配置自洽时显示（冻结态下的警告是照着一组不成立的数算的）。目前两条：`TP > 每节点卡数`（行 7 本体）、以及从行 4 降级下来的 `kvHeads % TP`（Megatron 在 TP > KV 头数时是复制 KV，功能合法只是变差）。`attentionHeadBasis` 随之从 `gcd(heads, kvHeads)` 收回成 `heads`。
- **行 13 由行 6 吸收**：`reconcile` 里 `anchor === "node"` 那条「Node 大于乘积时反向撑 world」的分支成了死代码，与 `nearestDivisorNode()` 一并删除；行 2 记录里「手输 Node 给不出建议」的缺口按预判自然消失。
- 顺带补 `validate` 一条 `Total Rank ≤ 65536`：手输非 2 的幂的并行度能把乘积顶出量程（TP=48 → 98304），`fitParallelWorld` 只在 2 的幂上找解、收不回来。改前只是悄悄算出「256 节点 × 384 卡」，Node 变派生量后会直接让 `rank → node` 越界。补上后 `proposeFix` 会拒掉那份建议，横幅退化成只有「取消修改」，而不是给出一个点了就把矩阵画错的「一键应用」。
- 文档侧仍是代码追平文档：`term-node` 的调大/调小改写成「不能直接调」，规则章的 `总卡数 % 节点数`、`TP 组不跨节点` 各补一句「本页已如此落地」；`term-tp` 的 `gcd(num_heads, n_kv_heads)` 收回成 `num_heads`。
- 规则层验证：两模型 × 两口径 × 三种卡的加减键随机游走 21.1 万个状态，新增六项 Node 口径断言（每节点卡数 ≤ 整机 / 装得下 / 无空节点 / 末节点不越界 / `config.node` 与派生一致 / 最大 rank 落在末节点）全为 0；1.44 万个手输值中通过 `validate` 的口径异常也为 0。

## 2026-08-24 — config-relation-observer：TP 受头数约束、CP 受序列约束（升级计划行 4 / 行 5）

- `validate()` 增两条结构约束：TP 必须整除 `num_heads`（GQA 模型再整除 `n_kv_heads`，即 TP 是 `gcd` 的因子），CP > 1 时 `seqLen % (2×CP) == 0`。合法档位由此收窄为 openPangu 48 头 → TP ≤ 16（32 也除不尽，不止计划里写的 64）、Qwen2 28Q:4KV → TP ≤ 4。`isAllowedParallelValue` / `reconcile` 同步，否则拖 Total Rank 时会自己配平出一个当场报错的 TP。
- **加减键跳过被结构约束挡住的档位**：`heads` 是模型常量、不是 stepper，冲突时没有任何字段能被改来兼容，步进过去只会把页面推进一个 `reconcile` 修不动的报错态 —— 而加减键正是手输报错态的第三个出口。`stepValue` 拆出 `rawStep` 并吃进 config；`pp > totalLayer` 那类有对手字段的约束手感不变。
- 走不动的那一头**置灰并挂上悬浮理由**（判据直接问 `stepValue`）：TP 到顶后加号无反应，不置灰看着像页面卡了，而只置灰不给理由同样解释不了 —— 它到顶的原因不在这一行表单里而在模型头数上。理由分撞量程 / 撞模型结构（把被跳过的档位逐个报出来）两档；量程端点（Seq Length 下界、Shared 到 0）顺带一起如实标出。
- 置灰改用 `aria-disabled` 而非原生 `disabled`：设计系统的 `.btn:disabled` 带 `pointer-events: none`，按钮收不到 hover、`title` 弹不出来。CSS 沿用同一个 `--button-disabled-opacity`，只是不掐指针事件并抹掉 hover / active 反馈。
- 文档视图两处补「已落成硬校验」（这两条规则 `term-tp` / `term-cp` 本来就写着，这次是代码追平文档）；yaml 的 `model_parallel` 行尾注释补上须整除的头数。
- 规则层验证：两模型 × 两口径的加减键随机游走 20.9 万个状态，报错态 / TP 除不尽头数 / 序列除不尽 2×CP / DP 除不尽 EP / 矩阵格子数≠Total Rank 五项全为 0。

## 2026-08-23 — config-relation-observer：报错横幅视觉对齐事件横幅，EP 口径 title 改为先说适用条件

- `#croConfigError` 横幅的描边与底色改为与 `.cro-incident-banner` 逐条对齐（`color-mix(danger 28%)` 描边 + `danger 16%→5%` 横向渐变）：页面里「出事了先读这条」的视觉已由事件横幅定下，不另起一套。两枚按钮统一为 `.btn .btn-sm`（`取消修改` 去掉 `.btn-ghost`）。
- 「图形已暂停更新，仍显示上一组自洽的参数」从独立段落改为接在错误红字后的行内 `<span>` —— 它是那条错误的后果，另起一行会读成并列的两件事。
- 切出档的页签名改为 **「EP 切出（主流）」**：这两档不是性能之争，用户唯一要做的判断是「按哪种记法读手上的数字」，而绝大多数情况下答案是切出 —— 这一点不该非得悬浮才看得见。正交档不加对称的后缀，两档的地位本来就不对称。
- `#croEpMode` 两枚按钮的 `title` 第一句改成**选谁的理由**而不是「怎么辨认」：切出＝「拿不准就用这一档，昇腾上的训练基本都落在这里」；正交＝「读别人按正交记的配置时用得上（论文 / 汇报表格 / 部分自研框架把 EP 单列成一维），要复现那份材料就选它」，另给一条对照用途 —— 切一下就能看到同一批卡的 DP 在 512 与 8 之间换算。**先写「日常一般用不到」是错的**：那是使用频率，不是用途，会把这个开关说成摆设。两段都补上关键的一句 —— 这不是性能选项，两档说的是同一批卡，切换只改读法不改硬件。辨认判据与公式降到后面几段。
- **修**：报错标红漏字段。`badFields` 原先只按错误文案做 label 子串匹配，而文案里写的是「路由专家 232 不能被 EP 53 整除」—— `Routed` 这个 label 一个字都没出现，Total Rank 同样没有。结果横幅让改三个数、页面只红两个，读起来像横幅算错了。改为把**横幅建议要改的字段一并标红**，红圈名单与横幅名单强制一致（实测该例：改前红 EP/DP，改后红 EP/DP/Routed/Total Rank）。
- 横幅从 stepper 行下方移到 **Model Architecture 区标题之上**：它建议改的字段常横跨 Model Architecture / MoE / Cluster 三个区（改一个 EP 就能牵动 Routed 与 Total Rank），挂在某个区里面会读成「这个区出错了」。
- **修**：stepper 换成 `<input>` 后整行明显变宽 —— input 是替换元素，不给 `size` 时浏览器按 **20 个字符**算固有宽度，而我原来又叠了一条 `width: 100%`。改为 `width: auto` + 由 JS 按当前值的位数维护 `size`（下限 3，打字时跟着位数走但不提交），宽度回到还是 `<span>` 时的内容自适应，下限仍由 `.zoom-control-readout` 的 `min-width` 兜。
- 集群矩阵格子的悬浮提示末尾加一行「当前 rank 有 N 个路由专家（每个 MoE 层各一份，编号 lo–hi）+ M 个共享专家（每卡一份）」：EP 列号只说明这张卡属于哪个专家组，换算成「几个」还要再除一次。整段都是 dense 层的 stage 上不写这一行，稠密模型整块不出现。

## 2026-08-23 — config-relation-observer：stepper 支持手输任意整数，不兼容时冻结图形并给出建议修法

- stepper 读数从 `<span>` 换成 `<input>`（复用 `.zoom-control-readout` 排版）：加减键维持只走 2 的幂 + 联动配平，手输负责精确指定 `DP=120` / `PP=3` 这类不在 2 的幂梯子上的真实配置。Enter / 失焦提交、Esc 放弃、上下键当加减键；**不监听 `input` 事件** —— 逐键提交会让整页在打字过程中反复标红（输 "120" 要先经过 "1" 和 "12"）。
- 手输**不做联动修复**：能自洽就直接落；不能自洽就停在报错态 —— 输入的那一枚与冲突的那几枚一起标红，`#croConfigError` 从一行文字升格成横幅，给出「为了兼容 EP = 120，建议把 DP 512→480、Routed 256→240、Total Rank 2048→1920、Node 256→128」以及「一键应用」/「取消修改」两个出口；第三个出口是直接点加减键把错数步进回档位。
- **参数不兼容时整页图形停止更新**，掐在两处：`emit()` 不发 `cro:change`、不调 listeners；`topology` getter 在冻结期间返回上一组自洽拓扑 —— 只掐事件会漏，视图侧在窗口尺寸变化时会直接读 getter 重算集群矩阵列数。横幅末尾常驻一行「图形已暂停更新，仍显示上一组自洽的参数」。
- 建议修法由 `proposeFix()` 给出，本体就是在副本上跑 `reconcile`；单独补了 `anchor === "totalRank"` 的直解（让 DP 独自吃掉差额），因为补它的差额要解整数分解，而 `fitParallelWorld` 只在 2 的幂梯子上找解。手输 `Node` 暂时给不出建议（横幅只剩「取消修改」），待行 6 把 Node 变成受约束派生后自然消失。
- `stepValue` 的 `×2 / ÷2` 换成 `snapPow2`：从手输的 120 点加减回到 128 / 64，而不是在 240 / 60 上继续翻倍；值本来就在梯子上时逐位不变。`reconcile` 的修复分支从「反复减半」改成「取最近的合法值」（新增 `gcd` / `nearestMultiple` / `nearestDivisor`）—— 减半修不动手输的数（120 减半是 60，仍不整除 256）；EP 的两条整除约束借机合成一条：EP 必须是 `gcd(专家数, DP)` 的因子。重跑 21.7 万状态的 stepper 模拟，四项指标仍全为 0，**加减键行为逐位未变**。
- 文档「EP 与 DP」章那句「stepper 拨不出 120」随之作废，改成并列两条路径：键入 120 → 标红 + 停更 + 建议修法；点加减键到 32 → EP 自动跟着收到 32。手输是「精确指定」、加减是「联动配平」，两者的表现刻意不同。
- ⚠️ 设计系统无 alert / banner 组件，横幅用 tokens 拼最小实现（按钮复用 `.btn` / `.btn-sm` / `.btn-ghost`），与本页的 select 同属「缺失样式」，待批准后吸收进共享系统。

## 2026-08-23 — config-relation-observer：文档「EP 与 DP」章补「那一个 batch 到底切几份」

- 切出档下表单 DP=512、矩阵纵轴 EDP0–7 并排摆着，最常被问的是「一个 batch 到底切 512 份还是 8 份」。原文有 DP 词条的「每份吃不同的数据分片」、MBS 词条的「全局 batch = MBS × DP × 累积步数」、EP 章的「真正的 DP 是 512」三块料，但没有一句把它们串起来。新增小节直接给答案（切 512 份），配一张 8×64 网格：横向 64 张卡分持一整套 256 个专家，纵向 8 行是专家副本。
- 顺带点破两处：MoE 的两次 all-to-all 是同一份数据分片按路由重发、算完收回，不是把 batch 再切一刀；以及非专家参数梯度在 512 维 all-reduce、路由专家参数只在 8 维 all-reduce —— EDP 的真实身份是专家参数的梯度聚合域，不是数据切分份数。
- 网格补「同一个 PP stage 上的 512 张卡」这一限定，格子标号从「卡 0…卡 511」改成「dp0…dp511」：漏了这句会让人把 EP 组误当成 DP 副本内那 4 张卡（`PP×TP×CP`），进而算出「一份数据最多路由 4×4=16 个专家」。新增一段点明 EP 组是**横着跨副本**的 —— 同一层的专家散在同一 stage 的那 64 张卡上，它们分属 64 个不同的 DP 副本，token 靠 all-to-all 借用另外 63 个副本的卡才够得着全部 256 个专家。

## 2026-08-23 — config-relation-observer：切出档补 `DP % EP == 0`（升级计划行 2，第一批收口）

- `validate()` 增 `!moeOrthogonal && dp % ep !== 0` 一条：专家组要能在一个 DP 组内均分，否则总有模型副本拿不到完整专家集。错误文案把 DP 与 EP 两个 label 都写进去，让 `emit()` 的子串匹配同时标红两枚 stepper（与行 1 那条 world 公式括注写「专家并行」以**避免**误标红的取舍方向相反）。正交档 EP 独占 rank，这条不生效。
- `reconcile()` 增对应修复分支：锚在 EP 上就抬 DP（Total Rank 随之涨），撞 `dp.max` 或锚在别处时把 EP 减半到能整除为止；`isAllowedParallelValue()` 的 dp 分支同步加同一条 —— 不加这处，拖 Total Rank 时 `fitParallelWorld` 会自己配平出一个当场报错的 DP。
- `fitParallelWorld` 拆成外层 + `fitParallelWorldOnce`，补掉新钉的 DP 下限带来的配平死角：`pp/tp/cp` 全为 1 且 `dp === ep` 时把 Total Rank 往下拖会无维可动，页面停在红字上且看不出该动哪枚 stepper。外层在「仍高于目标且 `dp ≤ ep`」时让 EP 减半再补一轮（切出档 EP 不进 world，降它不改乘积，只放开 DP 的下限），其余不收敛情形不动 EP，`anchor === "ep"` 时也不动。
- 这补掉了行 1 落地时留的口子：DP32 / EP64 这类配置以前 world 自洽不报错，但 `edp` 退化到 1，集群矩阵会画出比 Total Rank 更多的格子。规则层随机点 stepper 跑了两档共 21.7 万个状态：切出档 `dp < ep`、专家除不尽、格子数≠Total Rank、落在报错态，四项均为 0。
- 口径文档：`term-dp` 的「切出口径下要满足 DP % EP」从「考虑再调」升到「一定联调」，`term-ep` 那条「切出口径下 DP」补上「必须被 EP 整除」；`expertDataParallel()` 里「校验尚未落地」的注释改为防御性兜底说明。
- 文档视图「EP 与 DP：正交还是从 DP 切出」一章补一段具体反例（`EP=64` / 每层 256 专家 / `DP=120`）：`120 = 64 + 56`，余下 56 张卡只凑出半套专家（缺 224–255），router 打过去 all-to-all 找不到持有者 —— 错在通信域没有对端，不是精度问题；同一组数字在正交口径下完全合法。附带说明页面 stepper 按 2 的幂取值拨不出 120，等价情形是 `DP=32 / EP=64`，且切出档下看到的是 EP 自动收到 32 而不是报错。
- 同章末尾的提示块补一句回答「点 rank 格子只连一个 EP 组」的疑问：两种口径下一张卡持有的专家完全相同（外加不参与 EP 切分、每卡一份的共享专家），口径开关只改 world 公式乘不乘 EP、矩阵纵轴叫 DP 还是 EDP；`DP % EP == 0` 规则卡加了指向这一章的反例出处。
- `#croEpMode` 两枚按钮的 `title` 从公式扩写成「先讲是什么、再给公式」：切出＝专家并行不额外占卡、把已有 DP 组再切一刀，加大 EP 卡数不变；正交＝专家并行自己占一批卡，每多一倍 EP 就多一倍卡。

## 2026-08-21 — config-relation-observer：主页瘦身，播放与 DP 口径开关归档

- 新增归档页 `config-relation-observer-old.html`，配套冻结 `css/config-relation-observer-old.css` / `js/config-relation-observer-old.js`（从本次改动前的工作树完整复制，与主页彻底解耦）。**数据流播放与 Layer Rank 查询口径开关只在这一份里继续可用。**
- 主页删掉数据流播放整套：`.cro-flow-play` / `.cro-flow-exit` 键组、6 条数据线泳道（`#croFlowLanes` + canvas）、`startFlow / stopFlow / flowTick / lanes*` 全族与 `.is-flowing` / `.is-flow-optimizer` 样式；`applyRelation` 的 `quiet` 形参一并去掉（它只为播放而存在）。
- 主页删掉 `#croDpScope` 单 DP / 所有 DP 开关及其 `scopeLayerPayload / DP_SCOPED_KINDS / incidentDpHint / syncDpScopeLabels` 一整条链路。**结构对象（层 / 典型层算子 / Emb·Norm·Head 端点）的默认口径改为查全部 DP/EDP**，不再默认收窄到第一个 DP；只有明确带 `dpIdx` 的 payload（点某张 rank 卡）才收窄到那一个副本。
- 净减 JS 906 行、CSS 247 行、HTML 49 行。

---

## 2026-08-21 — config-relation-observer：集群矩阵 d 轴正名 EDP（升级计划行 3）

- 行 1 落地后表单里 DP 写着 512、矩阵左侧却标 DP0–7，是两个量重名。新增 `dAxisName(counts)` 一处判定（切出档且 EP>1 → `EDP`，否则 `DP`；稠密模型 EDP≡DP 不平添新词），矩阵行标签、组/块的 aria、格子提示与 aria 全部走它。**几何一格未动。**
- `coordsOfRank` 的坐标文案原在关系卡片 / 计算血缘 / 事件详情三处逐字重复，合并成 `coordLine(topology, co)`；`#croDpScope` 那两枚查询范围键的文案改由 `syncDpScopeLabels()` 按口径写；写死的事件样例里 `PP3 / DP0 / EP23` 改成口径中立的 `PP3 / EP23`。
- 换算式落在三处常驻可见：Cluster 区标题右侧一行 `矩阵纵轴 = EDP 8（DP 512 ÷ EP 64）· 一行是一个完整模型副本`（挂在标题行而不是矩阵下方 —— 矩阵的纵向预算是量 `.cro-cluster__grid` 得来的，多一行会直接从格子高度上扣）、每个格子的悬浮提示、容量栏口径浮层新增的 EDP 条目。浮层末尾那句「EP 与 DP 是否正交的口径差异未计入」同时改写成「只改读数与编址，本栏两档同值 —— 这里没有任何一段是按 DP 切的」。

## 2026-08-21 — config-relation-observer：EP 口径开关（升级计划行 1），world 公式不再硬编码 EP 正交

- MoE 区标题右侧新增二选一开关 `#croEpMode`（EP 切出 / EP 正交），落到 `config.moeOrthogonal`（默认 false = 切出，即 Megatron / MindSpeed / MindFormers 的做法）。`validate()` 的 world 公式随档取 `DP×PP×TP×CP×EP` 或 `DP×PP×TP×CP`，`#croConfigError` 的公式文案与 `fitParallelWorld` 的候选维（切出档摘掉 EP —— 改它补不上 world 的差额）同步。
- 参考配置改按切出口径记：`MODEL_PRESETS.openpangu-flash.defaults.dp` 由 8 改成 512，`EDP = DP/EP = 8` 才是原先那个「8」。两种口径下 Total Rank 仍是 2048，**rank 编址的几何一格不动** —— `derive()` 新增 `edp`，集群矩阵的 d 轴、`ranksPerStage`、按 DP 副本遍历的两处关系查询全部改读它（正交档 EDP ≡ DP，与改动前逐位相同）。d 轴标签仍写 DP，正名为 EDP 是升级计划行 3。
- YAML 视图跟着换口径：框架校验行按档写 `dp×mp×pp×cp×ep` 或 `dp×mp×pp×cp`（后者注明 ep 从 dp 内切出、不进乘积），`expert_parallel` 的行尾注释由死值「与 DP 正交」改成随档生成，`data_parallel` 在切出档补注「含 EP 组在内的真 DP」。
- `FIELD_SPECS.dp.max` 1024 → 8192：切出档的 DP 比正交档大一个 EP 倍，旧上界会在换算时把值夹掉、连带改动 Total Rank。

## 2026-08-21 — config-relation-observer：顶栏新增「文档」档，写清配置项之间的兼容规则

- 顶栏视图页签由两档扩到三档（关系视图 / YAML 视图 / **文档**）。新增 `css/config-relation-doc.css` + `js/config-relation-doc.js`：左侧章节目录 196px，右侧正文栏封顶 800px 且自己是滚动容器（滚动条落在文字右缘而非面板右缘）。与 YAML 档的差别是**连整网列一起让位** —— yaml 档留着整网是因为左边要回答「这份 yaml 描述的是哪张网」，文档没有这层对照关系。
- 正文写死在 `config-relation-observer.html` 的 `.cro-region--doc` 里而不是由 JS 拼串：它是一篇要逐字打磨的散文，塞进模板串后每改一个字都要在转义里找位置（与 yaml 那份「每行都随配置变、只能生成」正相反）。`config-relation-doc.js` 只从 `.cro-doc__section[id]` 生成目录、做点击跳转与滚动高亮，改标题只改正文一处。
- 正文定位是**训练配置的领域文档，不是工具说明书**：不写「哪条已实现、哪条还没做」，与工具演进阶段无关。约束卡的分类维度因此是领域本身的 —— `data-kind` 三档：`hard` 违反则起不来（启动器/建图阶段报错）、`soft` 能起来但踩在性能悬崖上、`impl` 取决于所用框架口径。卡里那行小字是「违反时实际会看到什么」（报错点、卡死还是变慢），供排查现场直接用。
- 九个章节：一份配置要过的三关 / 五个并行维度各切什么（含通信模式）/ world_size 与 rank 编址（含「编址顺序本身就是一次通信优化」）/ **EP 与 DP：正交还是从 DP 切出** / 切分维度与模型结构的整除关系 8 条 / 并行维度落到物理拓扑 4 条 / 单卡显存由什么构成 / **显存不够时该动哪一维**（八行决策表：省什么、代价、会撞上哪条约束）/ 配置项逐条详解。
- 末章「配置项逐条详解」与关系视图的表单**一一对应**：13 个 stepper（`FIELD_ORDER` 的 parallel/moe/cluster/batch 四组）加卡型号下拉，共 14 条，顺序与屏幕上读下来的一致；整网区的「模型」下拉不在其中（它选的是一整套预设，是约束网的输入而非网上的可调节点）。每条给「是什么 / 解决什么问题」两段，再接一幅**联动图**：左列「该调大它 / 该调小它」→ 中心该配置项 → 右列「一定会跟着变（实线）/ 常常一起调（虚线）」，四枚箭头一律朝右，整幅是一条从左读到右的因果链。
- 「配置项逐条详解」提到**第 2 章**（紧跟「一份配置要过三关」），当速查表用；章内 14 条在左侧目录里展开为**二级目录**，可直接跳到某个配置项而不必先跳章首再翻。二级常驻展开不跟着章节折叠——它存在的理由就是直跳，要先点开父章才看得见就失去了意义。当前词条与它所属的章用两档强度分别高亮（`is-active` / `is-within`），否则会读成两个并列的选中项。目录项超出可视高度时由 js 按 `offsetTop` 补位，仅在滚动驱动时补、点击驱动时不补（刚点的那一项就在手指底下）。
- 正文节奏返工：此前「全部内容粘在一起，不知道自己看到哪」。章与章之间改为三重信号叠加（通栏细线 + 40px 留白 + 标题左侧 accent 竖条），节标题用同一套语言弱一档（更细更暗的竖条、更大的上方留白）；段间距 12→16px。表格套一层 `.cro-doc__table-wrap` 拿到外框、圆角与 `--surface-1` 底，表头再压一层 `--surface-2`（圆角要裁住表头底色只能由 wrap 负责 overflow，`<table>` 自己的 overflow 各家浏览器都不可靠），wrap 同时兼职横向滚动条——四列的决策表在 800px 正文栏里放不下时自己滚，不撑宽整页。代码块底色从 `--surface-1` 压到 `--background` 并加左缘 accent 竖条：「这是一块代码」要一眼看出来，不能靠一圈细边框暗示。
- 联动图的连线**复用事件详情「计算血缘」页签那一套**：绝对定位的 SVG 覆在格子上、贝塞尔从源盒右缘弯到目标盒左缘、关系名写在曲线中点并带一圈同底色描边（`paint-order:stroke`）当挖空。算法整段照搬 `paintIncidentLineageEdges`（量两端 `getBoundingClientRect` → 换算到 shell 坐标系 → 控制点各自水平外推 Δx/2 → 标签摆中点上方 5px）。两边都是"有向关系图 + 边上写关系名"，本该长一样。方向按盒子中心在中心节点的哪一侧判、不按 `data-flow` 硬编码，改格位时方向自己跟对。
- 与血缘那边有两处不同：`.cro-doc__map` 有 1px 描边，而 SVG 的 `inset:0` 从描边**内侧**起算，所以 viewBox 用 `clientWidth/Height`、原点补 `clientLeft/Top`（血缘的 shell 无描边，原版直接用 offset）；边不需要 `is-active/is-muted` 两态（静态文档）。重画由逐图 `ResizeObserver` 驱动而非只听 `window.resize`——格子高度会随字体载入与换行阈值变化，那时窗口没动但连线两端已经挪了。
- 边上四个词收成两字/四字：**调大 / 调小 / 一定联调 / 考虑再调**（卡型号那条按语气对齐为「换大卡 / 通常不可选」）。配色：调大与调小同用 `--warning`——两者靠位置（上/下）与字面分，不靠颜色分，它们是同一个动作的两个方向，染成两色反而像两类东西；`--danger` 留给「一定联调」（硬绑定，最该被拦下看一眼），`--accent` 给「考虑再调」（可选项，语气最轻）。**连线颜色跟随文字**，经一个 `--cro-flow-color` 变量同时喂给 `stroke` 与 `fill`：一条边和它的名字是同一件事，颜色分家的话读者要在「这条线是哪一类」和「这个词是哪一类」之间来回对。线取 62% 混色比字淡一档——四条线同时满色会盖过它们要连的内容，而字是要读的。图例与窄板兜底同步这套配色。
- 连线加朝右箭头（SVG `marker-end`）：没有箭头的曲线会被读成双向甚至反向，右半边尤其（中心 → 格子，光看形状分不出谁指谁）。marker 的 id 是文档级的、跨 `<svg>` 引用合法，所以 14 张图**共 4 枚** marker 而不是 56 枚；`orient="auto"` 跟着末端切线转，四条边都是左→右故不必按方向分建两套；`markerUnits="userSpaceOnUse"` 而非默认的 `strokeWidth`——线宽只有 1.25，按线宽缩放出来的箭头小到看不清，而这枚箭头正是要读的信息。路径两端各留空隙（起点 2px、终点 3px），否则线贴死在描边上、箭头压进边框里看不出是箭头。箭头比线实一档（80% vs 62%）：线是背景，箭头是要读的那个「方向」。
- 中心节点描边由 accent 改为中性的 `--foreground`（深色主题下即白）、底色改 `--surface-2`：accent 已经被「考虑再调」那条边占了，中心再染同一个蓝会被读成「中心和那条边是一伙的」——中心不属于四类关系中的任何一类，它就该是无色的那个。
- 颜色只留给**边上那四个词**，四个格子一律同色同描边：格子各染一色的话，颜色在讲「这是四类东西」，而真正要读的是边上那四个关系名，两处都在喊就都没被听见。格子标题节点保留但视觉隐藏（读屏仍要念出来），文案由 js 读它的 `textContent` 写进 SVG `<text>`。虚线仍留给「常常一起调」——它就是「可选、不是硬绑定」这句话本身。图例改为 `<dl>`，给的就是连线上那四个词本身（同字体同色），不另造记号。
- 不引 mermaid：本页是纯静态无构建的 HTML，而 mermaid 的配色不跟随 `data-theme`，深浅主题一切换就成两套观感。现在颜色全部走设计系统 token。
- 章标题提到 20px 并去掉左侧 accent 竖条，节标题同去；代码块与约束卡的左缘竖条改为**整圈增亮描边**（代码块 `--border-strong` + 更深的 `--background` 底；约束卡按 `hard/soft/impl` 整圈染 42% 类别色）。一圈淡色描边同样能扫出「这一列里有几条红的」，而且不会在正文左缘留下一排长短不一的竖线。窄板（≤900px）联动图塌成单列纵排时隐掉 SVG、把标题放回格子里——曲线要靠左右两列的水平距离才成立，纵排后源与目标几乎同一 x，弯不出可读的弧。
- `js/config-relation-yaml.js` 的 `setup()` 由二值模式改为三档（它是 `#croViewTabs` 的唯一监听方，文档模块不碰页签）：`mode` 放开 `doc`，`.cro-board` 加挂 `is-doc`，退出运行事件的判据从 `mode === "yaml"` 放宽到 `mode !== "relation"` —— 两档的 DOM 都在 `.cro-board` 里，事件模式下整块被藏起来，不退出什么都看不到。
- 文档档整条隐藏运行事件栏（`.pto-ide-frame__workarea.is-doc-view`）：事件栏与文档没有联动，点任一条事件都会把 `.cro-board` 整块换掉、连带退出文档档，留着一条点了就跳走的侧栏既占 292px 又把正文中线推偏。收起态那 40px 竖条仍占位，所以是 `display:none` 而不是复用 `is-event-rail-collapsed` —— 后者原样留着，退出文档档时侧栏回到用户原来的展开/收起状态。
- 正文栏改为**正对板面中线**：三轨 `1fr | 800px | 1fr` 而不是「目录 + 正文」两轨，两轨的话正文只能在目录右边那片剩余空间里居中、整篇被推得偏右；右轨是空的，存在的意义就是抵掉目录宽度。目录 `justify-self:end` 贴着左轨右缘停。窄板断点从 1000px 提到 1340px（三轨要成立需板面 ≥ 1256px，加活动栏与 padding 即 1336px），以下目录塌成正文上方的横排药丸，正文靠 `margin-inline:auto` 继续居中。
- 同时新增 `config-relation-observer-upgradeplan.md`：上述「计划中 / 待确认」各条的落地清单，14 行带勾选位，按四批排序。

---

## 2026-08-21 — config-relation-observer：首屏集群矩阵按终局板宽铺，不再「切走再切回」才规整

- `js/config-relation-observer.js` 把「收起运行事件栏 + `syncDpScope()`」挪到 `controller.refresh()` **之前**。事件栏 292px ⇄ 40px 一翻，板面横向差 250 多像素，而首帧 `renderCluster` → `syncCellWidth` 已经把每个 stage 块的列轨写成了固定像素：先铺矩阵再收栏，格子就一直挤在「栏还开着」的窄宽度里、块右缘留一道缝、矩阵下方也空一截（openPangu 64 EP 下最明显）。切一次模型走完整条 `onChange` 才按终局宽度重铺，这就是「切到 Qwen 再切回来反而好看」的由来。
- 新增 `resyncClusterGeometry()`：`syncBoardRows` → 比对 `pickEpRows` → 行数变了重建、没变只补量格宽/格高。窗口 `resize` 的防抖体改为直接复用它；`setEventRailCollapsed()` 的 rAF 里也调一次 —— 运行时手动收/展事件栏同样会让列轨失配，此前那里只重排了 Layer 导航与连线。
- 点 rank 后对应 EP 组卡片的描边提到白 1.5px（`.cro-moe-group.is-related.is-pinpoint`），与同一次点击里共享专家的高亮同亮度 —— 此前它只有一档 `--border-strong` 灰边，两处亮度差一大截，读起来像 EP 组没被点上。只在关系集命中的 EP 数少于全部 EP 时提亮（`applyRelation` 里的 `epPinpoint`，判据与关系摘要那句「EP0、EP1… / 全部 EP」同源）：点整网节点 / 典型层会走 `allEpRanks()`，那时整列几十个组一起白框等于什么都没突出，仍走灰档。卡片保持空心不铺底。

---

## 2026-08-20 — 单卡容量：运行时预留从「已用量 10%」拆成四项模型

- `js/config-relation-capacity.js` 去掉 `BASIS.reserveRatio`（core × 10%）。原口径把一个几乎不随 core 变的量做成了正比项：大 EP/大 PP 的轻卡被低估（光驱动 + HCCL 就不止那点），重卡又虚高。新增 `RUNTIME` 四项，各跟各的标度量：
  - **运行时底座** 2.0 GB 固定（驱动 + CANN/ACL context + kernel binary + 通信域元数据），与配置无关；
  - **通信 buffer** = `HCCL_BUFFSIZE 0.2GB × 通信域数 × 2(双缓冲)`，域数 = TP/PP/DP/CP/EP 中 >1 的维度，EP>1 再加一条 MoE a2a 域（`commDomains()`）；
  - **算子 workspace** = `2·topK·mb·(S/CP)·H·2B/TP`，峰值由单个最大算子（MoE permute + GroupedMatMul）定，∝ **一层**而非全部层，纯 dense stage 取 1.0 GB 下限（`workspaceBytes()`）；
  - **内存碎片** = 已用量的 5% —— 四项里只有这一项本来就该按比例。
- 等距容器多摞一段：底座贴盒底（暗灰实心、`--cro-cap-base`），后三项合成盒顶原有的「预留」虚线段。底座摞盒底而非从 cap 里扣，占比算法完全等价，但「64 GB 的卡一开机就少 2 GB」这件事变得看得见；调 EP/PP 时也能看出哪段是配置能管的、哪段是给运行时的死钱。
- 图例「预留」「底座」两行加 `title` 给拆项读数；口径浮层把原来那行「已用量的 10%」换成四项各自的公式与当前域数，并新增「运行时四项怎么标定」一段：固定并行度只改 micro-batch 跑两三次，取 `实测峰值 − 理论四段` 两点拟合，截距 = 底座 + 通信、斜率 = workspace + 碎片；换一组 EP/TP 复跑即可分离通信项。系数标定后应挪进 `CARD_SPECS`（跟卡型号走）。
- 「越界」判定文案补一句「其中底座与预留 X GB 压不掉」，避免读成「减配置就能全省回来」。
## 2026-08-20 — config-relation-observer 增「导出配置」入口与 YAML 视图

- 顶栏右侧主题键之前新增「导出配置」按钮（带下载图标 + 文字标签，独立于 window-actions 图标键组）。目前**只做样子，未绑定 click**。
- 顶栏正中新增全局视图页签「关系视图 / YAML 视图」（`#croViewTabs`，样式对齐 `profileCompare.html` 的分组/聚合页签）。切到 YAML 档时 `.cro-board` 挂 `is-yaml`：Model Architecture / MoE / Cluster 三区整片让位给代码框，整网列保留。
- 新增 `js/config-relation-yaml.js` + `css/config-relation-yaml.css`：YAML 视图做成上下分栏，两块都由 `croObserver.topology` **实时**生成、带行号与语法着色。
  - 上栏 = `configs/<家族>/run_<全名>.yaml`，按 **MindSpore + MindFormers** 真实口径落键：`runner_config` / `context` / `parallel` / `parallel_config`（data_parallel·model_parallel·pipeline_stage·context_parallel·expert_parallel）/ `recompute_config` / `moe_config`（expert_num·num_experts_chosen·shared_expert_num）/ `model.model_config`（含 `offset` 表达 PP 非均分层切分）。
  - 下栏 = `msrun` 启动命令：卡型号 / 单卡 HBM / 节点数 / 总卡数**不写进 yaml**（前两项是硬件事实，只作 `context.max_device_memory` 的行尾注释；后两项由启动器给），它们的落点在这里。
  - 与模型预设默认值不同的行左侧标黄；校验未过时把冲突原因顶在文件头。只吃 `cro:change`，不改主控制器。
- 主脚本 `SELECTABLE` 白名单补 `.cro-region--yaml`，避免在代码框里拖选文本被当成「点空白」清掉当前选择。
- 选中运行事件（事件详情态）时整组视图页签隐藏：运行事件是既成事实，没有「当前配置」可导，两档都不成立；关闭横幅回配置仿真态再放出来。

## 2026-08-19 — `api-visualizer/index-light.html` Load3D 播放条展开状态 + 浅色主题 3D 填充方块描边

- Load3D 播放条播放中点击展开会「展开一下又收起」：`renderLoad3dStage` 每个播放 tick 都会重挂载浮动播放条（`mountLoad3dPlayback` 先移除再以 `defaultCollapsed: true` 重建），用户刚展开的工具栏在下一拍就被重置回收起态。改为挂载前读取旧 shell 的 `is-expanded` 状态，重建时以 `defaultCollapsed: !wasExpanded` 创建并在挂载末尾 `setExpanded(true)` 恢复，播放中保持展开/收起选择不变（Add / Gm2UbAlign 两条播放条为一次性挂载 + 逐拍 sync，本就不存在该问题）。
- `patterns/tensor-volume-canvas/pattern.js` 浅色主题（`surfaceStyle: 'soft-light'` + light theme）下所有方块都走 `softLightFaces` 实心软填充且无描边，padding 方块与真实数据方块无法区分；dark 主题走 `neutralFaces('padding')`（近透明填充 + 可见描边）所以是对的。为 `softLightFaces` 增加占位分支：`padding` / `ghost` / `skipped` 方块改为近透明填充 + **浅灰色（`--surface-4`）轮廓描边**（顶面描边略强），数据方块保持实心软填充 —— 与 dark 主题一致，描边镂空 = padding 补齐槽位。

## 2026-08-19 — `api-visualizer/index-light.html` 顶栏标题文字移除

- 删除顶栏左侧 `workspace-title`（「CANN Vision · API Visualizer」）与 `workspace-meta`（「api-visualizer/index.html」）两行文字，仅保留 CANN Vision logo；清理已无引用的 `.workspace-title` CSS 规则（`.workspace-meta` 在 rejection-case / tiling 图例处仍在使用，保留）。V1 `index.html` 为保留的远端原版，未动。

## 2026-08-19 — index_v3 显存页签：碎片放大区改立体容器侧视图，「放不下」从文字变成几何事实

- `hbm-memory-snapshot` 把碎片放大区的两条平面色条（`__fragment-map` 空闲/占用条 + `__request-attempt` 待分配条）合并成**一幅立体容器侧视图**（`__iso`）：容器 = 放大后的地址窗口，占用是坐在里面的实心块，空闲就是空着的那几段，待分配的 0.5 GB 是吊在容器口上方、按同一把尺子量出来的一整块。
- 待分配块整块一色、左对齐到最大空档起点，块名印在它靠屏幕那一面上而非吊在半空；超出最大空档的那一截用红虚线立体描边（9 条可见棱）框出边界，但不换填充色 —— 说的是「从这里开始没地方放」，不是「这块实体有一半变质了」。
- 待分配块**沿用它自己那一类的颜色**（新增 `summary.requestedKind`，本例 activation），不另设专用色与图例项：待分配不是一个新类别，只是一次还没落地的该类分配，「还没放进去」由它悬在容器上方这个位置表达。面上字色按块色亮度在黑白间自动二选一。
- 超出的 0.20 GB 另按原尺寸**投影回容器里**，画成 42% 不透明度的淡红体量压在已有占用上 —— 重叠本身就是结论，故不再单独描红被压住的那块占用。六条垂直引线（三条边界 × 正/背两面）把请求块的体量接到下面的投影上，只画单面会让另一侧悬空。
- 投影改 cabinet 斜投影而非 `config-relation-capacity` 那套真等距：这幅图的「值」是地址长度、长轴是横的，真等距会压缩 x 轴并让 34 单位长的容器在屏幕上同时下沉 17 单位，两段长度就没法直接目测比较。三面明暗、虚线线框=容量、越界用 `--danger` 单独画的视觉语法仍沿用后者。
- 立体图外加白框（与 `__zoom-source` 同款 2px `--foreground-secondary`），两者的左右边由 `__zoom-bridge` 里两条直线相连表达放大关系，替掉原先那片贝塞尔渐变填充 —— 面积大、边界虚，反而看不出「这一段被放大成了那一整幅」。
- 图例移到总览条正下方（原先挂在整节末尾）：色卡该挨着第一次用到这些颜色的那幅图，不该让人看完两幅再回头比对。只留五个类别 + 其他已占用 + 空闲碎片，去掉「超出部分的投影」条目；每个类别加 `title` 悬浮释义。占用块的点击选中与详情联动照旧（`data-id` 挂到 SVG `<g>` 上）。
- 「其他已占用」由 135° 斜纹改为 32% 透明度的黄（新增 `--hbm-other: #e6c229`），同时改掉总览条 `__address` 的底纹 —— 斜纹看上去像「这里没东西」，正好把这块占比最大的已占用读反了；用黄是为了与「空闲碎片」的中性灰拉开**色相**而非只拉明度，色相取 49° 避开 `--hbm-activation` 的 33° 橙。
- 图例与放大引线合进 `__zoom-region`（引线绝对定位铺满、图例正常流压在其上）：图例上移后横在总览条与引线之间，把引线顶下去、和上面那个白框断开了。同时去掉立体图外框的圆角 —— 引线要落在框的左右上角，圆角会把角切掉。
- 图例与顶部的 9px 间距由「图例的 `margin-top`」改成「`__zoom-region` 的 `padding-top`」：region 只有 `position:relative`、不构成 BFC，子元素上外边距会穿透出去（margin collapsing）把 region 连同贴在它身上的引线一起下推 9px，引线因此仍够不着总览条。padding 挡住塌陷，且绝对定位的包含块是 padding box，`inset:0` 量的是含 padding 在内的整块，引线不受影响。
- 类别名「临时空间」改「临时 workspace」：前者是自造词，对不上任何 API 或日志字段，也对不上本页「峰值构成」图里的写法。
- 去掉 `__plots` 的点阵背景（`radial-gradient` 底纹）：立体图自带的明暗面已经够撑起纵深，再垫一层网点只是噪声。
- 顶部整卡地址总览条 `__address` 高度 62→31px：它只负责交代「放大的是哪一段」，不该和下面那幅主图占同等分量。
- 横幅标题「故障分析」改「异常分析」，去掉其中重复的碎片率（上方读数卡已有），末尾补上后果链：「…引发 OOM —— 训练在 step 12003 中断（ACL_ERROR_MEMORY_ALLOCATION），吞吐由 2800 tokens/s 跌至 0」，数值取自 `incidentStep` / `summary.throughputAtPeak`。

## 2026-08-18 — `api-visualizer` CannVision 收尾：默认浅色主题、滚动条 overlay、stepper 浅灰无边框、V1 双入口 + vendor submodule push

- `api-visualizer/index-light.html` 默认主题由 dark 改为 light：`<html data-theme="light">`，右上角主题按钮初始态同步为「切换到深色模式」/`aria-pressed="true"`；用户手动切换仍经 `localStorage('api-visualizer-theme')` 持久化。
- 滚动条观感对齐本地：移除 `.op-load3d-matrix-scroll` 的 `scrollbar-gutter: stable`（Windows 等非 overlay 平台会常驻滚动条槽）；新增 overlay 检测 polyfill——JS 探测系统滚动条是否原生 overlay（macOS），非 overlay 时给 `<html>` 挂 `pto-overlay-scrollbars`，页面滚动条默认透明、滚动时短暂显示（`.is-scrolling` 600ms 淡出），与本地 macOS overlay scrollbar 一致；macOS 原生 overlay 不挂 class，行为不变。
- `.stepper-control`（参数加减输入框）从 `border:1px solid var(--input-border)` + `var(--input-bg)` 改回无边框 + `var(--surface-2)` 浅灰填充。
- `launch-v2.html` API Visualizer 卡片 `variants` 增加第二入口「V1」→ `api-visualizer/index.html`，与「CannVision」→ `index-light.html` 并列。
- vendor submodule `fa2cd90`：`floating-playback-control` 折叠态 split 模式（播放/展开并排）与 `matrix-canvas` cellStrokeAlpha 改动提交并 push 到 `pto-design-system` 远端（rebased onto 远端 matrix-canvas shared-scale 新提交）；主仓库 submodule 指针同步 bump，远端 Pages 播放条不再是旧版。

## 2026-08-18 — index_v3 显存页签：微调点阵画布 padding/横幅 margin、超出量文字改纯黑字、点阵减弱

- `pto-hbm-snapshot__plots` 顶部 padding 48→38px；「故障分析」横幅上下各加 4px margin（`margin-bottom:10px` → `margin:4px 0 14px`，原来没有 margin-top）。
- 上一版把「超出 0.2 GB」做成了黑底白字的小标签——理解反了，改回文字本身用黑色（`color:#000`），不加底色块，直接叠在红色进度条上。
- 点阵背景强度从 16% 调回 12%。

## 2026-08-18 — index_v3 显存页签：故障指标 step 降字号、补齐梯度色块、超出量加黑底签、消除滚动条根因、点阵加密

- `hbm-memory-snapshot/pattern.js`：`fact()` 加了第 4 个可选参数 `aux`，「故障Rank/step」卡片的 `/ step 12000` 部分现在用 `pto-hbm-snapshot__fact-aux`（12px、次要色）渲染，和「最大连续空闲块」卡片里 `/ 空闲 1.8 GB` 的降字号处理手法一致。
- 数据缺口：图例列了「梯度」但 `lifetimes` 里一直没有真正 `kind:"gradients"` 的分配块，导致整卡地址图永远不出现绿色——`data/openpangu-2.0-flash.memory-snapshot.json` 补了一条 `stage3.gradients`（8.1GB，与 `composition` 里梯度占比一致），塞进 32.2–40.3GB 的空闲区间。
- 「超出 X GB」文字从纯白字改成套一层黑色半透明底签（`pto-hbm-snapshot__request-overflow-label`，`rgba(0,0,0,.6)` + 圆角），不再依赖 text-shadow 硬保对比度。
- 滚动条问题这几轮一直靠给 `#memoryReuseViewer`/`.memory-analysis__lifecycle` 手动加大固定像素高度来压，属于头痛医头——这次从根上改：`.pto-hbm-snapshot` 从 `height:100%` 改成 `height:auto`（保留 `min-height:480px` 兜底），grid 行也从 `auto minmax(0,1fr)` 改成 `auto auto`，让组件按内容自然撑高；`#memoryReuseViewer`/`.memory-analysis__lifecycle` 相应从写死的 720/800px 改回 `min-height:480/560px` 的下限值，`pto-hbm-snapshot__plots` 的 `overflow:auto` 因为不再有比内容矮的固定框而失去触发条件。
- 点阵背景加密加强：`22px→16px` 网格、`8%→16%` 前景色混合浓度。

## 2026-08-18 — index_v3 显存页签：图例挪到点阵画布底部、超出量红色对齐故障指标、显存曲线卡片小屏加责任间距

- `hbm-memory-snapshot/pattern.js`：`pto-hbm-snapshot__legend`（激活/参数/梯度/优化器/临时空间等色标）从「故障分析」横幅下方移到整个 plots 区块（带点阵背景的画布）末尾，紧跟在待分配进度条之后；`pattern.css` 给它补了 `margin-top:16px` 分隔上方内容。
- 待分配条的「超出 X GB」红色底色原来是 `color-mix(danger 68%, surface-2)` 的淡化混合色，和「故障Rank/step」卡片里 `rank 17 / step 12000` 的纯 `var(--danger)` 文字对不上；改成直接用 `var(--danger)` 纯色（去掉了因此变得多余的同色 `border-left`）。核对过显存曲线画布（`memory-analysis.js` `drawTrend`）的红色本来就是从同一个 `--danger` 变量读的，不需要改。
- `.memory-analysis__grid`（显存曲线 + 峰值构成）原来固定 `2fr 1fr` 两栏、没有小屏回退，窄屏下两块被挤得很扁，紧贴着下面的「碎片分布与生命周期」面板，看起来像没留间距；加了 `@media (max-width:860px)` 让它退化成单列，把两块显存曲线卡片和下面的碎片分布卡片正常隔开。

## 2026-08-18 — index_v3 显存页签：故障分析横幅挪到标题下方、指标卡片间留白、局部图加点阵背景

- `hbm-memory-snapshot/pattern.js`：把「故障分析」横幅（原 `pto-hbm-snapshot__verdict`）从顶部独立整行移到「rank 17 内存分配分析」标题正下方，视觉上先看标题再看结论；对应 `pattern.css` 把它从全宽通栏样式（`border-bottom`）改成自带圆角、边框的独立卡片（`border-radius:var(--radius-md)` + `margin-bottom:10px`），网格行数跟着从 3 行收成 2 行（`grid-template-rows: auto minmax(0,1fr)`）。
- `pto-hbm-snapshot__evidence` 指标卡片区去掉「1px 缝隙露出背景色当分隔线」的老写法，改成真实 `gap:8px`，每张卡片补回 `border-radius:var(--radius-lg)`，视觉上和总览页 `.ovm-card` 网格一致。
- `pto-hbm-snapshot__plots` 顶部内边距从 14px 提到 48px（给横幅+标题留呼吸空间），并加了一层弱点阵背景（`radial-gradient(circle, color-mix(...) 8%) `+ 22px 网格，沿用设计系统 `hardware-architecture-viewport` 的点阵写法，透明度压到很淡）。

## 2026-08-18 — index_v3 显存页签：碎片分布面板加高消除滚动条、指标卡片间距修正、显存曲线补 step 横轴、峰值构成配色对齐 HBM 快照

- `.memory-analysis__lifecycle`/`#memoryReuseViewer` 高度从 600/540px 提到 800/720px，容纳加高后的局部放大区、碎片条、待分配条内容，避免 `pto-hbm-snapshot__plots` 内部再出现纵向滚动条。
- `memory-analysis__summary`/`pto-hbm-snapshot__fact` 指标卡片不再靠 `min-height:132px` + 垂直居中撑起来（那样label与数字间距还是只有 3px/`--space-1`，显矮）；改成按内容自然高度 + `padding:15px 16px 14px`（沿用总览页 `.ovm-card` 的内边距量级）+ `gap:8px` 撑开 key/value 间距，卡片不再显得比实际内容空太多。
- 颜色审计：红色/危险态统一走 `var(--danger)`（映射 `--ark-red-500`），验证合规；HBM 显存种类色（activation/parameters/gradients/optimizer/workspace）属于设计系统允许的“数据编码”例外（categorical data-viz exemption），但发现峰值构成图（`memory-analysis.js` canvas 手绘）用的是另一套相近但不同的 hex，同一页同一批类目两处颜色对不上——已改成与 `hbm-memory-snapshot/pattern.css` 的 `--hbm-*` 完全一致的 5 个色值；顺手删掉未被引用的 `--hbm-danger` 变量。
- `memory-analysis.js` `drawTrend()` 补上 step 横轴刻度标签（原来只画了 GB 纵轴网格线，横轴留白），过近的刻度（12000 与 12003）按像素间距去重避免重叠。

## 2026-08-18 — index_v3 显存页签：卡片对标总览页高度、局部放大区加高、清理跳转按钮

- `.memory-analysis__summary > div` 与 `pto-hbm-snapshot__fact` 对标总览页 `.ovm-card` 的尺寸（`min-height:132px; padding:15px 16px 14px`），内容垂直居中，不再显矮。
- 「待分配 0.5 GB」文案挪到进度条上方（原来在下方）。
- `zoom-bridge` 连接曲线（SVG path）、`fragment-map`、`request-scale` 进度条高度整体翻倍（90→180、42→84），配合放大后的局部视图看得更清楚；SVG viewBox 与 path 控制点坐标同步换算。
- 删除显存页签底部「在 Timeline 查看分配/释放」「定位 TransformerLayer.forward」两个按钮及 `memory-analysis.js` 里对应的点击绑定（`openTimeline`/`openSource` 函数本身仍被详情面板内的 Timeline/源码按钮复用，未删）。

## 2026-08-18 — index_v3 显存页签：碎片标注合并进色块、版心加宽、辅助数字降字号

- `hbm-memory-snapshot/pattern.js`：删掉「最大空洞只有 0.3 GB」这行独立说明（`pto-hbm-snapshot__fragment-caption`），改成直接在最大空闲碎片色块内标「0.3G（最大连续空闲）」；整卡地址图标题从「rank 17 · 整卡 64 GB 地址空间与关键分配」精简为「rank 17 内存分配分析」。
- `.memory-analysis` 版心 `max-width` 从 1280px 改成 1680px。
- 「最大连续空闲块」指标卡片里「/ 空闲 1.8 GB」是辅助说明，拆成 `memory-analysis__aux` 小字号 span（12px/400），不再跟主数字一样 30px；`memory-analysis.js` 对应改用 `innerHTML`。

## 2026-08-18 — index_v3 显存页签：详情面板可关闭、版心限宽、指标数字放大

- `hbm-memory-snapshot/pattern.js`：默认不选中任何内存块（`selected` 默认 `null`），详情面板 `pto-hbm-snapshot__detail` 关闭时不占布局空间（`.pto-hbm-snapshot__body` 无 `has-detail` 时只有一列，plots 占满宽度）；点击色块才展开详情列并选中，详情面板新增关闭按钮可收起、回到未选中态。`memory-analysis.js` 里原先给的默认 `initialSelectedId:"frag-router-indices"` 一并去掉。
- 删除整卡地址图标题旁「step 12000 快照 · 斜纹底色=其他已占用 · 彩色色块=关键分配 · 纯灰=真实空闲段」这行提示。
- `.memory-analysis` 版心加 `max-width:1280px` 居中，避免宽屏下被拉得过散。
- `pto-hbm-snapshot__fact strong`（故障Rank/step 等指标卡片大数字）与 `.memory-analysis__summary strong`（峰值/最大连续空闲块等）字号统一改成 30px。

## 2026-08-18 — index_v3 显存页签：OOM 快照卡片改版（rank/step 指标化、超出量内嵌、故障分析合并文案）

- `hbm-memory-snapshot/pattern.js`：去掉顶部 `pto-hbm-snapshot__context`（模型名/rank/step/说明段整块），改用 evidence 卡片里的「故障Rank/step」指标承载 rank+step 信息；原「HBM 峰值」卡片一并替换。
- 「为什么 OOM？」横幅改标题为「故障分析」，并把碎片说明里「总空闲 X GB 分散在 N 个不连续地址段，不能拼接成 Y GB」这句从下方的空洞标注区合并进这条横幅。
- 「待分配」进度条：高度从 14px 提到 42px，与下方 rank 局部放大条（`fragment-map`）对齐；「超出 X GB」文案从条外的独立文字挪进条内的红色超出段，删掉「（与最大空洞左对齐）」。
- 内存详情默认高亮项从 `expert-dispatch` 改为 `frag-router-indices`（对应 `layer38.router.topk_indices`），`pattern.js` 默认值与 `memory-analysis.js` 的 `initialSelectedId` 一并改。
- `index_v3.html` 显存 tab 删除「问题2 · rank 17 显存 OOM：查看 step 12000 的单卡快照…」这句说明段。
- 相应清理 `pattern.css` 里 `.pto-hbm-snapshot__context` 相关规则与网格行定义。

## 2026-08-18 — profileCompare：任务条标签改回一律白字（不跟随 pattern 的自动对比度）

- 现象：泳道图里偏亮底色的任务条（FFN-Dn #86C541、KV-Upd #C9A24B、MTE #EAB308…）标签从白字变成了深字。根因不在本页——设计系统 submodule 提交 `21b982f` 把 `patterns/swimlane-task/pattern.js` 的标签字色从固定 `DEFAULTS.textColor` 改成了 `readableTextColor(segment.fill)`（按 WCAG 相对亮度在白/深字之间自动选），随主仓库 `c4888cf` 的 submodule bump 进来。
- 处理：本 demo 一排泳道里深浅色任务条混排，字色跟着底色翻会让整片读起来发花，「任务条一律白字」是这个页面已成立的视觉约定，故在页面侧覆盖回来，不动 submodule。
- 覆盖方式：`drawTaskBar` 没有暴露字色选项，`readableTextColor` 又是模块内部绑定（改导出的那份影响不到内部调用），所以给 2D 上下文装一个 `fillStyle` 过滤器（`forceWhiteTaskLabels`），命中 pattern 的深字色字面量 `rgba(15,23,42,0.94)` 就换成 `rgba(255,255,255,0.92)`，其余原样透传；再把 `PtoSwimlaneTaskPattern.drawTaskBar` 包一层，三个调用点都不必改。

## 2026-08-18 — profileCompare：右上角「差异健康度」改为「性能评估」（雷达图 + PHS 评分轴）

- 去掉差异健康度评级：对比两个任务的业务意图不唯一——有的改动就是要把差异拉大（提速），有的只求别影响性能（差异越小越好），把「差异」折成一个健康分等于替用户下了一个工具不知道方向的判断。评级徽标（B+）与结论标题（无显著变化 / 整体变快 x%）随之删除，`abHealth` / `rankHealth` / `diffHealthCardHtml` / `DIFF_GRADE_*` / `HEALTH_TIP_*` 一并移除。
- 新增维度雷达图（手写 SVG，形制照搬 index_v3 总览页子项雷达：4 层等分多边形环、偶数环着色、轴名在外）。五维沿用 PHS 的维度语言：计算 / 通信 / 调度 / 均衡（取自「每 step 时间构成」的四段占比，与下方构成对比条同源），本页无内存数据源，第五维换成「稳定」= 100 − step 抖动(CV) × 10。最多同屏画三条记录，轮廓色 = 左侧勾选栏的 run 身份色，轴标签下按色分标各自读数。
- 渐变轴保留但改语义：从「差异健康度」变成每条记录各自的绝对性能评分轴，分档/配色沿用 index_v3 的 PHS（S ≥90 / A ≥75 / B+ ≥60 / B ≥45 / C ≥30 / D）。基线与被对比任务各有一个落点（立柱 + 分数胶囊），分差 <18 分时胶囊逐行错开避免叠压；刻度字母改按各档中点绝对定位（原 space-between 会把 D/S 顶到两端，读成分档线）。
- 结论文案（`abVerdict` / `rankVerdict`）保留原有的总耗时差、噪声带、Top 3 集中度陈述，但不再对差异做好坏评判。
- 评分轴落点补齐标注：胶囊内改为「任务名（中间省略，`truncateRunId` 20 字）+ 基线标签 + 分数」，不再只有一个数字；每条记录各占一行（基线贴着轴、对比对象依次往上），不再按分差挤行。胶囊按落点所在半区靠死一侧对齐（右半区右对齐向左展开）并按落点位置给出 max-width，右侧窄栏里恒不出界。
- 立柱与渐变条的连接处加落点圆点，填色取该分数在渐变轴上的插值色（`phsGradientColorAt`，停靠点与 `.sl-perf__bar` 的 linear-gradient / app.js `gradeColorAt` 同源），描边用卡片底色 `--surface-2` 把它从同色相的条上抠出来。
- 「综合性能评分」标题下补回旧版那种白色大字（`.sl-perf__headline`）：两条对比给「优于基线 / 劣于基线 / 与基线持平」，三条对比给「xxx 性能最佳」，只勾基线一条时给「综合 xx 分 · X 档」。判据是综合评分，与紧跟其下的轴同源。
- 单选任务（只勾基线一条）回退到多任务改版前的呈现：`diffHealthCardHtml(rankHealth(run))` + 多卡面板，不上雷达图/评分轴。单任务内多卡的方向是唯一的（空等越少越好、慢卡越不该有），折成一个 0–100 健康分成立；跨任务对比没有这个前提，两条流程的第一屏本就不该同形。`DIFF_GRADE_*` / `HEALTH_TIP_RANK` / `rankHealth` / `diffHealthCardHtml` 随之复原，新加的 `rankVerdict` 删除。
- 评分轴的落点与标签改用 training-monitoring-v2「时光全景」浮窗那一套（`css/training-timeline-panorama.css` 的 `.tw-pano__dot / __lead / __label`）：竖立柱换成 SVG 引出线（一段直线 + 一段缓和 S 弯接到标签左上角，按记录配色描边），圆点换成带 2.5px 卡片底色描边环 + `--shadow-sm` 的实心点。标签横向位置改为渲染后实测让位（`layoutPerfScale`：优先落在落点正上方、左边缘比落点偏左 8px，顶到容器边缘就整体让位），不再靠估算宽度靠边对齐；分栏拖宽由 `ResizeObserver` 重排。
- 落点标签内「基线」标签移到任务名前面。
- 多任务对比卡内两块上下换位：综合评分（卡片标题 +「优于基线」大字 + 落点轴 + 分档刻度）提到最上，五维雷达降到其下（小标题「性能评估」）。勾两条记录进来问的是"这次谁更好"，轴一句话答完；雷达是"好/差在哪一维"的展开，属追问的第二层。
- 落点标签改按落点从左到右排行（分最低的贴着轴，越往上越靠右），并强制相邻标签左边缘至少错开 14px：原先靠右的几个落点会被右边缘一起顶成左对齐，看上去像几条记录落在同一个分数上。`layoutPerfScaleBox` 改成「先从左往右推开、再从右往左收进容器、最后夹左边界」三趟，横向次序恒等于落点次序。
- 渐变条上圆形落点的描边环从卡片底色改为该任务的身份色（`--ring`，与标签胶囊 / 雷达轮廓 / 左侧勾选栏同色）——一个点同时说清「落在哪一档」（填色 = 渐变轴取色）和「是谁的落点」（环色）。
- 三方对比的「xxx 性能最佳」大字，任务名前挂上该记录的身份点（`.sl-perf__headline i`，与轴上落点的描边环、雷达轮廓、左侧勾选栏同色），大字点名的是谁一眼可对上号。
- 多任务对比的账目卡补标题「差异账目」（`.sl-diff-stat-card__title`，形制同构成对比条的标题）：这张卡混装了总 busy、总差值、Top 3 集中度、显著项计数与噪声带，没有标题就只是一摞读数，读不出它在回答"两条记录之间总共差了多少、差得集不集中"。
- 差异账目卡由「只报数」改成「每条读数后跟一句结论」：原先「Top 3 贡献 3.10 ms」读不出 Top 3 是什么的前三，「极差 4.79 ms」与「噪声带 ±9.9%」并排摆着连单位都不一样、没法比——而这两个数的全部意义就在于比一比（落差没过噪声带就等于没差异）。现在极差/总差值一律同时给绝对量与百分比，结论句直接说出与噪声带比完的结果（"没过基线自身抖动 ±9.9%，这个差值读不出来" / "超出抖动，是真差异：对比任务确实更慢"）。「Top 3 贡献」改名「差异最大的 3 项」并讲清分母是各项差值绝对值之和，集中/弥散给出对应的下一步动作；「显著差异任务/泳道」合成一行「显著差异项」。
- 显著项计数与噪声带行从 `diffDashboardHtml` 挪进 `diffLedgerHtml`（要与结论句配套计算），`diffLedgerHtml` 签名改为 `(taskCards, laneCards, runs)`；结论句插在两行之间，分隔线同步挂到 `.sl-diff-stat-card__note + .sl-diff-stat-card__row` 上，否则会整片消失。
- 差异账目的字段口径统一收进标题旁的问号（`LEDGER_TIP`，悬浮展示），行内不再逐条铺解释小字——五行读数配五行小字会把这张卡撑成一整屏，而口径是查一次就够的东西。但判定结果留在行内：它随数据变（这次到底过没过噪声带、集中还是弥散），复用差异卡片列表的 `.sl-diff-card__flag` 做判定标签——总差值「噪声带内 / 真差异 · 更慢」、极差「三者等效 / 不等效」、差异最大的 3 项「集中 / 弥散」。落在噪声带内时总差值不再上红绿色，避免把基线自身抖动读成退化。
- 「噪声带（基线抖动）」改名「抖动滤波范围（噪声带）」。

## 2026-08-18 — `launch-v2.html` API Visualizer 卡片新增 CannVision 第二入口

- API Visualizer 卡片新增 `variants` 第二入口按钮「CannVision」，指向 `api-visualizer/index-light.html`（合并版：四图标栏工作台 + 远端 gm2ub 新功能），复用「算子 IDE 助手」卡片同一套 `.variant-link` 机制（`has-variants` 下隐藏 tag-row）；卡片主入口仍为 `api-visualizer/index.html`（远端原版），预览 iframe 不变。

## 2026-08-18 — `api-visualizer/index-light.html` 修复右上角「切换左侧面板」按钮失效

- 根因：此前把左侧栏改为四个图标时删除了 rail 里的资源管理器按钮（`data-ide-toggle="explorer"`），但右上角按钮的自定义 JS 仍 `document.querySelector('[data-ide-toggle="explorer"]')?.click()`，元素已不存在 → 点击无效果。
- 修复：右上角按钮直接改为 `data-ide-toggle="explorer"`（保留 `aria-controls="api-visualizer-explorer-pane"`），由 ide-frame pattern 的 `initExplorerToggle` 统一接管收起/展开与 `aria-expanded`/`aria-pressed`/`is-selected` 状态；删除失效的 `leftDockToggle` 自定义 JS；`ensureExplorerPaneOpen`/`openOperatorWorkspace` 中的选择器从 `.pto-ide-frame__activity-rail [data-ide-toggle="explorer"]` 改为全局 `[data-ide-toggle="explorer"]`。

## 2026-08-18 — `api-visualizer/patterns/matrix-canvas/pattern.js` 浅色模式斜杠/填充/数字颜色再减淡

- 上一轮浅色斜杠仍偏深，继续调优：斜杠色 `mix(fg, bg, .76)`、alpha `.12–.26`；wash 填充 alpha 降到 `.10–.20`（原先 `.14–.28`）。
- 格子内数字/文字：浅色模式不再用近黑 `--foreground`，改用深灰 `mix(fg, bg, .82)` + alpha `.78`（默认/empty/written/muted 状态同步适配），既保留可读性又避免纯黑刺眼；深色模式保持原值。

## 2026-08-18 — `api-visualizer/patterns/matrix-canvas/pattern.js` 浅色模式 padding 斜杠减淡

- 浅色主题下 `--foreground` 为近黑 `rgba(0,0,0,.90)`，`drawPaddingPattern` 直接用它画斜杠（alpha 最高 .68），padding 格子的斜杠在浅色下黑得发闷；深色模式 foreground 是白色，无此问题。
- 优化：`drawPaddingPattern` 按主题区分——浅色模式斜杠色改为 `mix(foreground, background, .62)` 的浅灰、alpha 降到 `.18–.38`，底色 wash 同步减淡（alpha `.14–.28`）；深色模式保持原逻辑不变。新增 `isLightTheme()` 辅助函数（读 `data-theme`）。

## 2026-08-18 — `api-visualizer/patterns/matrix-canvas/pattern.js` 修复 Gm2UbAlign 格子标号不显示

- 根因：本地 pattern.js 的 label 绘制阈值是 `minDimension < 40`（HEAD 遗留），而 Gm2UbAlign 矩阵为 32 列（uint8），每格远小于 40px，导致 scene 里已生成的 `label` 序号全部被跳过；远端版已把阈值降到 16px 并支持 label/value 双内容绘制与 selected 蓝色高亮。
- 修复：以远端 `origin/main` 的 pattern.js 为基底（16px 阈值、label+value 双栏/紧凑绘制、selected 高亮、padding 紧凑适配），叠加本地 A2 描边减淡的 `strokeAlpha` 改动（`cellColors`/`drawCell` 加 `strokeAlpha` 参数 + `options.cellStrokeAlpha`，`index-light.html` A2 场景传 0.06）。`index.html` 与 `index-light.html` 两个页面共用此 pattern，一并生效；其它页面引用的是 `vendor/pto-design-system` 版本，不受影响。

## 2026-08-18 — `api-visualizer/index.html` 左侧栏改为四个纯图标 tab

- 左侧活动栏从 GitCode 站点导航改为 4 个 56×56 纯图标 tab：硬件架构（芯片）、算子流程（三点连线）、API（代码尖括号）、API2（花括号，`is-active` 选中态 + `aria-current="page"`）；去掉图标下方文字，hover/focus 与选中态样式沿用 `cannvision-rail-item`。
- 按需求移除底部「资源管理器」切换按钮（`data-ide-toggle="explorer"`）与分隔线/spacer；`ensureExplorerPaneOpen`/`openOperatorWorkspace` 中对它的引用均走可选链，缺省时安全降级，左侧参数面板默认保持展开。

## 2026-08-18 — `api-visualizer/index.html` 左侧导航换成 GitCode 页面左侧图标栏素材

- 左侧活动栏改为复刻 GitCode 页面（gitcode.com/yinyucheng0601/CANNVision）左侧站点图标栏：56px 窄栏、56×74px 竖排项（16px 图标 + 12px 文字）、圆角 6px、hover 灰底加粗；分 3 组（首页/工作台、AI社区/大赛平台/应用市场、项目/组织/企业），组间 1px 分隔线。
- 图标素材自 GitCode CDN 下载到 `api-visualizer/gitcode-icons/`（8 个 PNG，本地离线可用）；素材本身是浅色模式的黑色线条图，深色主题下用 `filter: brightness(0) invert(1)` 反白显示，浅色主题原样。
- 顶部新增本页固定入口 tab（grid 矩阵图标 + 「API 可视化」），`is-active` 选中态——主色蓝 + 10% 底色、label 加粗，`aria-current="page"`，不可切换。
- 底部保留资源管理器切换按钮（`data-ide-toggle="explorer"`，GitCode 风格竖排），面板开合与 `is-selected` 状态由 ide-frame pattern 照常驱动。

## 2026-08-18 — `api-visualizer/index.html` 标题与左侧导航换成 CANN Vision 素材

- 顶栏标题：移除 IDE host-chip，替换为 CANN Vision 品牌——`cann-logo.png`（自 `CANNVision-main/src/assets/` 拷贝到 `api-visualizer/`）+ 标题「CANN Vision · API Visualizer」，`<title>` 与 frame aria-label 同步更新。
- 左侧活动栏：4 个通用 IDE 按钮换成 CANN Vision 图标导航样式（68px 窄栏、44×44 圆角 14 按钮、hover 上浮变蓝、悬浮 tooltip 两行 label+hint）；新增本页固定 icon（grid 矩阵图标，`is-active` 选中态——蓝色 + 10% 底色，`aria-current="page"`，无切换行为）；保留资源管理器切换按钮（`data-ide-toggle="explorer"`，面板开合与 `is-selected` 状态由 ide-frame pattern 照常驱动）。颜色走设计系统 token（`--primary` / `--foreground-muted`），深浅主题一致。

## 2026-08-18 — `api-visualizer/index.html` A2 逻辑矩阵格子描边减淡

- A2 逻辑矩阵格子描边用浅一号灰：`matrix-canvas` pattern 新增可选 `render(canvas, scene, { cellStrokeAlpha })`（默认 0.09 不变），A2 渲染传 0.06；Gm2Ub 等其它矩阵画布不受影响。

## 2026-08-18 — `api-visualizer/index.html` 播放条折叠态按钮纯图标化

- 折叠态两个按钮改为 32×32 正方形：播放/暂停为纯色方块（无 border），「展开」去掉文字只保留箭头（透明底、无 border、hover 浅色反馈）；`floating-playback-control` pattern 中 `collapsedExpandLabel` 改为可选（缺省即纯箭头）。

## 2026-08-18 — `api-visualizer/index.html` 图表区域最大化 + 播放条折叠化 + 默认 Load3D

- 卡片化：Load3D（输入形状 / A1 布局 / A2 逻辑矩阵）与 Gm2UbAlign（GM / UB）卡片只保留标题栏，描述与图例改为透明叠加层（top-left 描述、top-right 图例/状态），图表画布填满卡片；Load3D 舞台改为面板高度填充（body `auto + minmax(400px,1fr)`），A2 矩阵随窗口高度增长。
- 播放条：三个视图的浮动播放条默认折叠收起，折叠态为并列两个按钮——播放/暂停（直接控制，不展开）与「展开」；`floating-playback-control` pattern 新增 `collapsedSplit` / `defaultCollapsed` / `collapsedExpandLabel` / `onCollapsedPlayPause` 能力（pattern.css/js/json 同步更新）。
- 默认视图：页面打开即 Load3D API（`showApiVisualization('Load3D')`）。

## 2026-08-14 — `api-visualizer/index.html` 浅色适配收尾 + 交互整理 + 文案中文化

- 浅色模式：修复 load3d 顶部两个 3D 视图（tensor-volume-canvas pattern 的 neutral/padding voxel 硬编码暗色改为 token 驱动），主题切换时对全部 canvas 控制器（load3d NCHW/A1/A2、gm2ub src/dst）即时重绘；其余图表经排查均为 token 驱动，随主题自动切换。
- 播放条：浮动播放控制条上移 24px（`bottom: 18px → 42px`），覆盖 Add / Load3D / Gm2UbAlign 三个沙盒。
- 顶栏按钮：删除无效的设置按钮与右侧边栏按钮；左侧边栏按钮接线为控制左侧“API 参数”面板（Gm2UbAlign 参数 · 交互控制台）的开关。
- 左侧资源管理器标题栏改为两行布局（标题在上、说明在下），不再遮挡/截断说明文字。
- 全页面 UI 文案中文化：IDE 顶栏/活动栏/状态条、API 目录与算子输入面板、候选对比表、收敛图与谱系图全部标签/状态/度量、排除浏览器与资源案例、格式实验、播放条步进标签等均由英文/中英混杂统一为中文；API 名、代码、SoC/架构术语保留英文。

## 2026-08-14 — `api-visualizer/index.html` 右上角浅色模式切换

- 在 IDE 顶栏右上角窗口操作区新增主题切换按钮（太阳/月亮图标随主题互换），点击在 `data-theme="dark"` 与 `data-theme="light"` 间切换，复用 design-system 自带的 light 主题 token，无新增配色。
- 偏好经 `localStorage('api-visualizer-theme')` 持久化并在加载时恢复；按钮 `aria-label`/`title`/`aria-pressed` 随主题同步更新，`file://` 下 localStorage 异常被静默忽略。

## 2026-08-14 — MatMul Code Recovery Step 6：尾块验证与交付回归
- 新增 Divisible、M/N tail、K tail、Combined 四个 fixture 驱动的验证 case；按源码公式动态派生最后输出 tile、L1/L0 K slice、Mmad 次数、Tensor shape 与逻辑 payload。
- 修正固定 16 Mmad、固定 4 次 L0 循环和非向上取整的 tile 坐标假设；K=1900 时恢复为 `364 → 128/128/108`、15 Mmad、45 个逻辑播放帧。
- 补齐 derived / inferred / unverified 证据边界、键盘 case 切换、窄屏无全局横向溢出、schema/sourceRef/HTTP/控制台/Conv 页面回归验证。

## 2026-08-13 — 碎片图：红色改标「接不下的申请」，修样本块点不动

- 红色标注口径纠正：0.3 GB 的最大连续空闲块本身无对错，出事的是「最大申请 0.5 GB 接不下它」（定位链 §3 观测：无法满足下一个 0.5 GB 的临时 buffer 分配请求）。`facts.fragment` 新增 `maxRequestGB: 0.5`；碎片轴上最大连续块改中性灰框标位置，红色改画那笔装不下的申请条（等比放大后露在灰框外的部分 = 差的量）+ 「最大申请 0.5 GB > 最大连续 0.3 GB」标签。
- 判据格 3 格 → 4 格：空闲总量 / 最大连续 / 最大申请 / 碎片率，前两格转为中性色，只有「最大申请」（因其 > 最大连续）与碎片率标红。`training-memory-case4.js` 的双因子表同步写明「最大连续 0.3 GB < 最大申请 0.5 GB」。
- 修 bug：碎片图命中框存在模块级 `fragGeom` 上，而同一页有两张碎片图（dock 性能页签 + 定位链长文），后画的覆盖先画的 → 先画那张所有块都点不动。改为存 `cv.__fragGeom`，各自独立；样本块命中外扩 5→6 px。
- 样本块描边旁补「样本块：点开看申请堆栈」标签，不再让人猜那个框是什么。

## 2026-08-13 — `training-monitoring-v2.html` 性能页签「碎片分布」图可读性重做

- `js/training-memory-panel.js` 的 `drawFragmentMap()`：补首行轴说明（横轴=地址 0–64 GB / 纵轴=step 内时间自上而下）与左侧时间刻度栏（前向 / 反向 / 结束）+ 反向起点虚线，说明左边三根常驻柱与右边碎块同属一副坐标。
- 横轴按常驻块最高地址自动切成「常驻区 0–27 GB」「激活区 27–64 GB」两段并加括号标注；分隔虚线贯穿块图与底部碎片热力条，点明两者共用同一根地址轴（热力条改为与块图同宽同起点、贴紧无间隙，左侧加「碎片」栏标）。
- 两套图例合并为一套：常驻的参数/梯度/优化器把名字直接写在自己的条上，图例只留碎片块/workspace 两色。
- 坐标转 90°：横轴改为 step 内时间（前向 / 反向 / 结束），纵轴改为显存地址（下低上高，左栏标 0 / 27 / 64 GB 与竖排区名）。常驻块因此画成贯穿整幅的长横条、激活块画成短横条，「谁一直占着 / 谁随用随放」不看图例也读得出。
- 颜色规则收紧为「红色只标最大连续空闲块」：碎片块由橙 `#ea580c` 改青 `#0891b2`（新增 `palette().frag`），样本块的红描边改深色描边。
- 底部热力条改为右侧竖向「碎片轴」：空框垫底（空白=空闲）+ 按用途填参数/梯度/优化器/碎片图例色，最大连续空闲块用红框标注、并在块图里配一条淡红地址带与引线。
- `buildBlocks()` 生成参数对齐 `facts.fragment` 读数：空洞压到 0.002–0.023 GB、只在第 62 块后留一个正好 0.3 GB 的大空洞，激活区铺满到 64 GB 不留尾巴 —— 实测空闲总量 1.79 GB / 最大连续 0.300 GB，与判据格的 1.8 GB / 0.3 GB 对得上；workspace 改为复用激活块地址，不再掉进空洞里把标红区切开。

## 2026-08-13 — `config-relation-observer.html` 整网视图三档切换

- 整网区标题与「模型」下拉之间新增 tab（`#croNetView`）：只看整网 / 只看典型 Layer / 两者并看（默认，即改动前现状），解决整网 deck 与「典型 Layer」结构条信息重复的反馈。
- 「只看整网」收起 arch 列的典型 Layer 一节；「只看典型 Layer」收起 deck 画布，并把 `.cro-section--structure` 整节搬进整网列（搬 DOM 节点本身，选中态与关系连线锚点原样有效），排成 2+2+1 宫格，末行那张卡锁半宽居中、与上方四张等宽。
- 典型 Layer 不占 arch 列的两档里，Layer 导航撑满整列：`.cro-layer-nav__strip` / `.cro-nav-rule` / `.cro-ffn-span` 由写死高度改成 top+bottom 双向锚定（删掉 `--cro-nav-rule-h`），band 放开 flex 伸缩，`height:100%` 的刻度随之整条长高。
- 「只看一边」的两档把 Cluster 行封顶从 46% 抬到 62%（该封顶同时是矩阵折行预算的 `capRatio`）。行数是建 DOM 时定的，故新增 `cro:view` 事件由 tab 触发重建。
- 集群矩阵折几行改成由可用高度倒推（`pickEpRows` / `clusterHeightBudget`），不再写死 2 行或按视图档给 4 行：预算 = `.cro-board` 视口高 × 行高封顶 − 实测 chrome，逐档试 2/3/4 行取放得下的最大值，格高随行数走（`CLUSTER_CELL_H`，经 `--cro-cell-h` 落到 CSS）。候选行数须能整除 EP，避免末行缺格（64 EP 折 3 行是 3×22=66，右下角空两格，会读成少了两张卡）——故 ep=64 时只在 2 / 4 之间选：1080p 只看一边得 4 行，其余维持 2 行。窗口 resize 防抖 180ms 后按目标行数判断是否需要重建。右半边（Layer 导航拉满、集群矩阵折 4 行 + 格高 8px、Cluster 行封顶 62%）一律挂它，两档间切换时右侧完全不动；`is-view-net` / `is-view-layer` 只留给两档真正不同的显隐。
- 单卡容量栏改成「高度只跟随、不驱动」：`.cro-capacity` 加 `height:0` + `min-height:100%`，在 Cluster 行的 fit-content 行高计算里贡献恒为 0，行高由左半的 rank 矩阵独自决定，柱子在剩余高度里缩放；`.cro-capacity__scene` 的两道 px 下限一并去掉（窄屏档单独给回）。
- 单卡容量的等距柱改成高度自适应：`.cro-capacity__scene` 去掉固定 `width:124px`，改为 `aspect-ratio: 10.7/14.9`（viewBox 长宽比）+ `width:auto`，宽度随拉伸后的高度按比例走。宽高必须一起放开——SVG 是 `meet` 缩放，宽度钉死时容器高过 ~173px 就再也长不动。封顶 `max-height:288px` 留在 svg 上而不是盒子上：截短盒子会让 `align-items:stretch` 退化成 flex-start，整幅图贴到 `__main` 顶部。
- `.cro-moe-group`（EP 组卡片）去掉 `surface-2` 填充，改成与 `.cro-tick` 同款空心描边；静息/悬浮/关联/选中四态统一收在 `--cro-group-ring` 上，选中描边由外扩改 inset。事件详情画布里给它垫不透明底的那条规则一并撤销。
- `.cro-cluster` 由 flex + 固定 300px 基准改成照抄 `.cro-board` 后两列的 grid 模板（含窄屏断点），「单卡容量」栏自此恒与上方 MoE 区等宽。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{js/config-relation-capacity.js,js/config-relation-observer.js,css/config-relation-observer.css,config-relation-observer.html}`: 事件 1.3 / 1.5 的显存构成图改用「单卡容量」那幅等距容器（3D 盒），两处共用同一个 builder。① capacity 侧把 `buildScene(m, segColors)` 抽成通用的 `buildBox(spec)`（cap / segments 自底向上 / thresholds / host / format），经 `global.croCapacityBox` 在模块解析时导出（主脚本先加载，但它建图在 rAF 里，那时导出已就绪）；新增 `resolveColor()` 支持把 `var(--token)` 就地解析成 RGB 分量——事件详情传进来的调色板本来就是一串 var()，而三个面要按受光度分明暗必须拿到分量；`cssVar()` 补 host 参数，因为 deck 语义色定义在 `.cro-board` / `.cro-incident-view` 上而不是 `:root`，取错节点会拿到空串。阈值环的颜色也先落地成具体值再写进 SVG 呈现属性（属性不是 CSS 声明，`var()` 在那儿各浏览器行为不一）。本栏自己那幅改由薄封装 `buildScene(m)` 拼 spec，段色从解析好的分量改回 CSS 变量字符串，主题切换时由 buildBox 现解析。② observer 侧新增 `chart.kind = "capacity"`（`chartCapacity`）：判据是「有没有一个固定的容量上限」——这两张图的分母是那张卡的 64 GB，装不下就是 OOM，平面色条表达不了「框满了」。图例从 `chartStack` 抽成共用的 `chartLegend(items, total, unit, {reverse})`，等距容器按**容量**算占比、并按视觉从上往下倒序；新增 `item.void` 语义（碎片/空当）→ 盒里虚线棱 + 半透明、图例键换 45° 斜纹块（`.cro-chart-legend__dot--void`）。`paintDetailChart` 给 builder 多传一个 host（解析 var 用），并在 `cro:theme` 时重画 capacity 图（它的明暗是建图时算死的，不跟 CSS 走）。③ 1.5 的数据修正：原先 60.1 + 3.9 + 0.32 三段并列把「最大连续块」在「碎片空洞」之外又数了一遍，合计 64.32 GB 超过容量本身；现拆成 60.1 + 3.58 零碎 + 0.32 最大连续块 = 64.0，盒顶那道薄片正好就是这条证据要说的「最大的一个洞只有这么薄」，note 同步写明 3.58+0.32=3.9。容量脚本缺席时 `chartCapacity` 退回构成条，不留空白。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{config-relation-observer.html,css/config-relation-observer.css,js/config-relation-observer.js}`: 数字配置 stepper 整体加大一档，加减号从「两个小灰点」变回可瞄准的按钮。上一版把符号从 11px 提到 14px 但圆键仍是 22px，符号再大也被键框压住。这次动键本身：`.cro-stepper__control` 的 `--button-height-md/sm` 22→28px、padding 1→2px（控件高 24→32px），符号 14→18px，读数字号 label-xs→body-sm 且 min-width 28→32px，标签 10→11px。MoE 那一列（四项 nowrap 等分）同步 20→26px，仍 `min-width:0` 所以不会掉行。`.cro-select`（模型 / 卡型号）跟着改 24→32px、字号对齐 body-sm，保持与同行 stepper 同高同字号。JS 里内联 SVG 的 width/height 属性一并改到 18 作兜底，实际尺寸仍由 CSS 给；描边保持 3 格。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{config-relation-observer.html,css/config-relation-observer.css,js/config-relation-observer.js,js/config-relation-capacity.js}`: Micro Batch / Seq Length 移到 Cluster 区表单、卡型号下拉改成与 stepper 同款、加减号图标放大。① 两个 stepper 从 `FIELD_ORDER.parallel` 拆出成新组 `batch`，挂到卡型号下拉**之后**新增的 `#croBatchSteppers`（单独成组而不是并进 cluster 组，是因为 cluster 组的容器排在下拉之前）。动机：它们不参与切分、不进 world_size，只决定往单卡里装多少，和卡型号给出的容量框高度是同一句话的两半；留在 Model Architecture 那行（讲「模型怎么切开」）反而要多解释一遍。`FIELD_SPECS[].group` 只是标注、mount 只读 FIELD_ORDER，故无其他改动；容量栏的 BASIS_FROM_CONFIG 与 `.cro-stepper` 的 SELECTABLE 白名单命中均不受影响。② `.cro-select` 几何对齐 `.cro-stepper__control`：radius-md+1px 描边 → pill 圆角、去描边、高度锁 24px（= stepper 的 1px padding + 22px 圆键）、字号降到 label-xs 与读数一致；左内边距 8→12px 免得文字贴上 pill 弧线。同一行里卡型号与 Total Rank / Node 是同级控件，两套外形会读成两类东西。整网区的「模型」下拉共用这条规则，一并统一。③ 加减号 11px→14px、描边 2→3 格（24 视口），并把笔画从满格收到 ±7：14px 渲染下 2 格描边落地不到 1.2px，深色底上几乎看不见。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{config-relation-observer.html,css/config-relation-observer.css}`: Cluster 区标题抬成通栏一行，单卡容量整栏落到标题之下。上一版标题在 `.cro-cluster__head` 里、只压在左半（矩阵）那一列上，右侧「单卡容量」与它并肩起头，底部读起来像两个并列的区而不是一个 Cluster 区。现在 `<h2>Cluster</h2>` 直接挂到 `.cro-region--cluster` 下做通栏行，`.cro-cluster__head` 整个删掉，`.cro-cluster__form`（Total Rank / Node / 卡型号 横排）升为 `.cro-cluster__main` 的第一段并补 `flex:0 0 auto`；`.cro-cluster` 补 `flex:1 1 auto` 吃掉标题之外的剩余高度，仍受第 2 行 fit-content(46%) 封顶、由 `.cro-cluster__grid` 自己滚。「单卡容量」保持 body-md 小标题，读作 Cluster 下的一栏。窄屏（≤1180px）容量栏换行到矩阵下方的规则不受影响，通栏标题仍在最上。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/js/config-relation-observer.js`: Model Architecture 行里两个 stepper 的标签改写全称，`MBS`→`Micro Batch`、`Seq`→`Seq Length`。DP/PP/TP/CP/EP 是这个领域里没人会认错的通用缩写，这两个不是；MBS 尤其容易和 GBS 混，而两者对单卡显存的作用完全相反（MBS 与激活成正比，GBS 只决定梯度累积步数、一步也不进显存，见容量栏口径浮层）。字段名 microBatch / seqLen 不变，容量栏的 BASIS_FROM_CONFIG 无需跟改；已核 validate() 里按 `message.includes(label)` 标红字段的逻辑不会被这两个新标签误命中。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{config-relation-observer.html,css/config-relation-observer.css}`: Cluster 区标题与表单拆成两行。上一版把标题 + Total Rank / Node / 卡型号 塞在同一行，Cluster 因此成了四个区里唯一「标题与控件同行」的例外（整网 / Model Architecture / MoE 都是 .cro-region__title 独占一行、控件在下）。现在 `.cro-cluster__head` 改为 column，新增 `.cro-cluster__form` 承载横排的三组控件；标题为对齐 stepper 视觉中线而加的 `margin-bottom:2px` hack 随之删除——标题不再与控件同行，那 2px 没有了对齐对象。矩阵仍在表单之下、吃满左半宽度。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{config-relation-observer.html,css/config-relation-observer.css,js/config-relation-observer.js}`: Cluster 区表单横排 + 集群矩阵下移，卡型号下拉补箭头与容量标注。① `.cro-cluster` 从「竖栏表单 | 矩阵 | 容量栏」三列改成「左半（表单在上、矩阵在下）| 容量栏」：新增 `.cro-cluster__main` 纵向两段，`.cro-cluster__side`（max-width 210px、stepper 强制纵向堆叠）改名 `.cro-cluster__head` 并改为横排一行——标题 + Total Rank / Node + 卡型号一行读完。动机是矩阵默认要画 4 个 stage 块 × 64 EP 列且不给横向滚动，宽度比高度值钱，表单抬成一行后整个左半宽度让给矩阵。标题在 flex-end 对齐下压 2px 才与 stepper（label 在上、控件在下的两层）的视觉中线看齐。`.cro-cluster__grid` 名字不动——JS 里它是连线锚点的夹取宿主与滚动视口。注意 mc2-incident-observer.css 里有一份同名的 `.cro-cluster__side` 副本，那是另一页的独立 CSS，本次未同步。② `.cro-select` 补下拉箭头：`appearance:none` 把系统箭头一并抹掉了，看上去就是个普通输入框、不像可展开的东西。用内联 SVG 的 data URI 走 background（select 不能有子元素、::after 也不渲染，伪元素这条路走不通），描边写死中性灰 #8A8A8A 而不是 currentColor——data URI 里取不到 CSS 变量，而这个灰在深浅两套底色上都够看；右内边距同步留到 24px，避免长选项文本压在箭头上。这条改的是共享的 `.cro-select`，整网区的「模型」下拉一并受益。③ 卡型号选项文本缀上容量：CARD_SPECS 新增 `short` 字段（label「昇腾 910B」给口径浮层，short「910B」给只有 128px 的下拉格），选项渲染为 `910B（64G）` / `950（64G）`——选卡的当下就是在选容量框的高度，不该等到看口径才知道。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{config-relation-observer.html,css/config-relation-capacity.css,js/config-relation-capacity.js,js/config-relation-observer.js}`: Cluster 区 Node 之下加卡型号选择（昇腾 910B / 昇腾 950 二选一），并把上一版加在 Model Architecture 行的 `cardMemGB` stepper 撤掉——单卡显存是硬件属性不是训练超参，不该和 MBS / Seq 混在一行；现在 HBM 由选中的卡带出（`topology.card.hbmGB`），容量栏的 syncBasis() 从那里取，Model Architecture 只留 MBS / Seq。用 select 而不是 stepper：型号是枚举不是量，±键在两项间来回跳读不出「选了哪个」。新增 CARD_SPECS / CARD_ORDER / DEFAULT_CARD 三个常量与 config.card（默认 910b），derive() 带出 card；reconcile 对非并行字段是空过（anchor 落 else 分支、world 与 totalRank 不变），故 PARALLEL_FIELDS 与 validate 不动。⚠️ 两个 HBM 数字的证据强度不同，已在代码注释与口径浮层里分别标出：910B 取 64 GB 款（本仓 AscendProfKit/skills/performance-health-score/SKILL.md 记「常见 32GB / 64GB 两种规格，需从 NPU_INFO 确认型号后定」）；950 的单卡 HBM 在 Profiling_Insight_and_Tool/KNOWLEDGE.md 里查无——§3.1 只给了**整片** DDR 128 GB / 1.6 TB/s，不是单卡 HBM，64 GB 是按「两款对齐 64G」的要求取的占位值，口径浮层里用 warning 色标注「待确认」。口径浮层同时新增「规格」一行，950 那条摘 KNOWLEDGE.md §3.1/§4.4 的实据（32 Cube × 64 Vector @1.65GHz、FP16 432 / FP8 864 / FP4 1728 TFLOPS、Chiplet 2×Compute + 2×IO Die、超节点 128P/1024P）。因两款当前都是 64 GB，切换不改变容量柱高度，只改口径说明——拿到准确规格后只改 CARD_SPECS 一个表，柱子与下拉一起跟上。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{config-relation-observer.html,css/config-relation-capacity.css,js/config-relation-capacity.js,js/config-relation-observer.js}`: 单卡容量栏三处。① 上一版加在容量栏里的三枚 select（MBS / Seq / 单卡显存）撤掉，改为 Model Architecture 那一行的 stepper：它们和 DP/PP/TP/CP 一样是开训前要拍板的配置，不是某一栏的局部开关。主控制器侧新增 `microBatch`(step1, 1~64) / `seqLen`(pow2, 128~131072) / `cardMemGB`(pow2, 8~512) 三个 FIELD_SPECS 与 defaults(1 / 4096 / 64)，追加进 FIELD_ORDER.parallel；三者不参与切分、不进 world_size，故 PARALLEL_FIELDS 与 validate 不动。容量模块侧删掉 DIALS/mountDials，改由每次渲染前的 `syncBasis()` 从 topology.config 同步到 BASIS，config 字段名与 BASIS 键名的对应集中在 BASIS_FROM_CONFIG 一张表里。行为不变：MBS 1→4 当场 59%→141% OOM，Seq 4096→8192 变 87%，换 32 GB 卡变 118%。② 口径浮层从 absolute 改 fixed + boot 时移到 <body> 下 + JS 实测避让。原先留在面板里做 absolute，浮层会把 .cro-board / .cro-cluster 的可滚动区撑大——这一栏在板面最底行最右列，鼠标一悬浮页面就冒出滚动条；而光改 fixed 也不行：祖先 .pto-ide-frame__pane 带 backdrop-filter（会成为 fixed 的包含块）且是 overflow:hidden，浮层既定位不到视口也会被裁。现在 placeBasis() 按问号实际位置贴放：默认下方左对齐，下方装不下翻到上方，左右各夹 8px，宽 320px、max-height 62vh 内部滚；面板滚动与窗口缩放时跟着重贴（scroll 用 capture 收内部滚动容器）。因浮层已不在 .cro-capacity 子树内，主控制器的 SELECTABLE 需另加 `.cro-capacity__basis`，否则点它选中文字会清掉当前关系选择。③ 本页默认态回到配置关系图：boot 末尾原先无条件 `selectIncident(requestedEvent || INCIDENT_GROUPS[0].events[0])`，一进来就是某次故障的详情、四域整块被顶掉，要先关横幅才能看正事。改为只有带 `?event=<id>` 深链接时才进事件详情；否则收起事件栏（与关闭事件横幅同一套处理，select:false）并调 `syncDpScope()` 把 HTML 里默认 hidden 的「Layer Rank 查询范围」放出来。深链接行为不变。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{config-relation-observer.html,css/config-relation-capacity.css,js/config-relation-capacity.js}`: 单卡容量栏补上口径输入，并调读数层级与柱高。① 新增三枚窄 select（micro-batch / 序列长度 / 单卡显存），横排在标题下方。此前这三个量写死在 BASIS 里，而它们是除并行维之外**仅有的**能改变单卡占用的输入——写死了「事前配置校验」就缺一角：MBS 从 1 调到 4，默认配置当场从 59% 跳到 141% OOM；S 从 4096 调到 8192 变 87%；同一配置换 32 GB 卡变 118%。三个量不进 topology（不影响切分与关系），故由 config-relation-capacity.js 自己持有、直接写回 BASIS 重画，不惊动主控制器的 stepper 体系。选项文本自带量名（「MBS 1」「S 4096」「64 GB」）而不给独立 label，一栏 300px 放不下三组标签+控件；完整说明走 title。显存一档按**容量**给而不是按型号名：同一型号常有多种 HBM 规格，凭记忆写型号表写错了比不写更糟，要挂真实型号只改 DIALS.capGB 一个数组。② 口径浮层同步补三行，其中「global batch 不进显存」单列一条：GBS 只决定梯度累积步数 GBS/(MBS×DP)，一步也不占容量——与「DP 不减容器」是同一件事，两条摆在一起才说得清 batch 的哪一半进显存。③ 图例底部的「合计 / 容量」行删掉，改为图例**上方**一组头条读数：占比 26px 等宽字并按档位换色（safe 走 foreground、tight 走 warning、alert/over 走 danger），绝对值「37.9 / 64 GB」压到 10px + foreground-muted 跟在同一基线后面。安全档不出判定横幅之后，占比就是唯一一眼能看出险不险的东西，它该是头条而不是列表末行。④ 等距盒高 BOX.h 从 12.0 压到 9.6（−20%），viewBox 宽高比从 0.617 抬到 0.716，整幅在面板里更矮更宽；scene 的 min-height 148→122、max-height 220→176 同步跟上，Cluster 那一行不再被顶得过深。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{config-relation-observer.html,css/config-relation-capacity.css,js/config-relation-capacity.js}`: 单卡容量栏五处收口。① 图例顺序倒过来与柱子对齐：`SEGS` 是从底往上的堆叠顺序（权重→梯度→优化器→激活→预留），图例是从上往下读的，渲染时 `.slice().reverse()`，第一行「预留」对的就是柱顶那一段——两边不一致时眼睛要在柱子与文字之间做一次映射才对得上，白费一次认知。② 安全档不再出判定横幅：一条「安全」横幅每次白占约 36px 行高却什么也没说，而这一栏所在的 Cluster 行高由内容撑；只有越过警戒线才出现，出现即意味着要动手。占用率百分比因此并进图例的「合计 / 容量」行，最关键的读数不跟着横幅一起消失。③ 口径问号从点击改为悬浮即出：`pointerenter/leave`（不用 mouseover/out，后者在子元素间冒泡会反复开合），收起带 140ms 延迟——问号与浮层之间隔着几像素空当，鼠标滑过去会先离开问号再进入浮层，没有延迟就在半路收掉、内容根本选不中；浮层自身 hover 同样保持展开。键盘 focus/blur 与触屏 click 各留一条通路，Esc 立即收；`role` 从 dialog 改 tooltip、`aria-controls` 改 `aria-describedby`，按钮上的 `title` 去掉（原生 tooltip 会与浮层同时冒出来读成两份）。④ 口径浮层新增第二组「为什么各卡装的不一样多」四行：层数不均（46 层分给 PP4 → 12/12/11/11，实时按当前配置算出）、首尾更重（Embedding 只在 Stage0、LM Head 只在末段，各约 5.8 GB 含梯度与优化器状态）、在飞份数（1F1B 下 Stage s 压 PP−s 份）、同 stage 内各 DP/EP/TP/CP 副本容量相同故差异只到 stage 这一级。看到底部 stage 小柱高低不齐时的第一个疑问就是这个，不解释会被当成算错了。⑤ 默认态指名道姓到具体一张卡：scope 从「Stage0 · 最紧的卡」改成「rank 0 · Stage0 · 最满」，rank 取该 stage 首卡（`rankOf(stage,0,0,0)`），用户拿这个号能直接回集群矩阵里找。措辞统一去「紧」：阈值档位 tight 的显示名「紧张」改「偏满」，判定文案里的「紧张线」随之改「偏满线」，分布条脚注「峰值」改「最满」。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{config-relation-observer.html,css/config-relation-capacity.css,js/config-relation-capacity.js}`: 单卡容量栏两处改造。① 口径从常驻正文收进标题右侧的问号浮层：一栏 300px 放不下四行小字还不挤掉容器，而口径又是随时要能核对、不必一直看着的东西。浮层内容改成 dl 键值对（权重/梯度、优化器状态、激活、在飞份数、路由专家、共享专家、其余权重、DP、预留、单卡容量各一行），比原来一整段更好扫；「DP 不除任何东西」单独成行加粗——它是这一栏最反直觉、也最该被人当场核对的一条。浮层绝对定位在面板内、宽度锁在面板宽，不往外弹：`.cro-board` 与 `.cro-cluster` 都是 overflow:auto，弹出去会被裁。点浮层外任意处或 Esc 收起。② 容量柱从平面堆叠条改成等距 3D 容器（参照 parallel-reference FIG 11 的等轴测语法）：屏幕 x=(x−z)·cos30°、y=(x+z)·sin30°−y，每个盒子只画顶/前/右三个可见面并按受光度分 +0.30/−0.06/−0.30 三档明暗，段色从 deck 语义色变量取出后拆成 RGB 分量再分面着色（故 `--cro-cap-reserve` 写死中性灰 #8A98A2 而不用 color-mix——它的计算值格式各浏览器不统一，拆不了分量）。容量仍是虚线线框（12 条棱，画在实心之后，读作「装在笼子里」），越界段仍摞在盒口之上而不是把盒身涂红，预留段用虚线棱 + 62% 不透明区别于实心四段。70%/88% 两条警戒线由平面横线改成贴着盒壁的一圈虚线环 + 左侧百分比标签。几何全部在 user unit 里算、viewBox 由内容包围盒反推（含标签向左伸出的那截），面板宽高怎么变都不重算，SVG 自己等比缩放。主题切换时 deck 调色板与 --border-strong/--warning/--danger 全变，而这些颜色是渲染时读进 SVG 的死值，故补听 `cro:theme` 重画。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{config-relation-observer.html,css/config-relation-observer.css,css/config-relation-capacity.css,js/config-relation-capacity.js,js/config-relation-observer.js}`: 新增「单卡容量」栏，并把四域网格从 T 型改成 ⊥ 型。此前这页只有语法校验（整除、world 一致、层数 ≥ PP）——配得通，但单卡显存是个黑洞，配得通照样 OOM。① 布局：`--moe` 从通栏两行退回只占第 1 行，`--cluster` 从只挂 arch 列下方改为横跨 arch＋moe 两列，腾出右栏；`--net` 不动。落点选 Cluster 而不是 MoE 下半，是因为容量是**卡**的属性、与集群矩阵同源：矩阵回答「是哪张卡」，容量柱回答「这张卡里装了什么、还剩多少」。② 口径必须 MoE-aware：通行的 12H²/层 是 dense 口径，而本模型约 97% 参数在专家里（256 × 3 × H × I_moe ≈ 2.0B/层 × 44 层），套 dense 公式算出来的数完全错。改为逐层分算 attention / dense-MLP / 路由专家 / 共享专家 / router / emb / head 七项，路由专家 ÷ EP×TP、其余权重 ÷ TP、全部 ÷ PP（体现为只遍历本 stage 的层），DP 不除任何东西——于是把 DP 从 8 拉到 64、Total Rank 翻两番、矩阵多出几百格时容量柱纹丝不动，「显存不够就加卡」只在加 TP/PP/EP 时成立。另计入两处会决定最危险那张卡的细节：各 stage 层数不等（46/4 → 12,12,11,11）且 stage0 多背 embedding、末 stage 多背 head；1F1B 下 stage s 同时在飞 (PP−s) 份 micro-batch 的激活，故 stage0 最紧。③ 阈值分三档而非一条 OOM 线：70% 紧张 / 88% 预警 / >100% 越界，且必须画出第五段「预留」（通信 buffer + workspace + 碎片，按已用量 10%，斜纹区别于实心的四段）——只画权重+梯度+优化器+激活，得到的是一个更好看的黑洞。越界段画在容量框**之上**而不是把柱子涂红：OOM 是结构性越界。④ 容量只随 stage 变（同 stage 内各 DP/EP/TP/CP 副本一样重），所以底部那排 PP stage 小柱就是容量在集群上的完整分布，点一根 = 选中该 stage 首卡，payload 形状与矩阵格子一致、走同一条关系解析。⑤ 实现上刻意独立成 css/js 两个新文件，只吃已有的 `cro:change` / `cro:select` 两个 document 事件、只用已导出的 `croObserver` / `croSelect`，主控制器那 5500 行里仅改一处：`SELECTABLE` 加 `.cro-capacity`，否则点 stage 小柱会被判成点空白而清空选择。注意事件模式下 `.cro-board` 整块 hidden，本栏属配置仿真态，事件详情里暂不出现。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/{css/mc2-incident-monitoring.css,mc2-incident-monitoring.html}`: plog 页签右栏「plog → 可读诊断」换成与 v2 「接口映射」同一套底：横向蓝→紫弱渐变（`--primary` 8% → `--highlight-l0a-violet-400` 8%）+ 纵向从上到下渐隐，标题文字同样走蓝→紫渐变填充（挂内层 `<span>`，紫端深色底 violet-300 / 浅色底 violet-500）。做法与 v2 逐条对齐：染色层放 `::before`（`mask` 挂在栏本身会把标题和卡片一起淡掉），滚动容器从 `.wzh-log-mapping` 下沉到 `.wzh-log-mapping-list`（那 7 条共用滚动条样式的选择器同步改名），本体不滚 `::before` 才能 `absolute` 铺满不随内容跑；表头去掉 sticky 与不透明底色，只留分隔线；映射行卡片 82% 不透明的 `--surface-1` 让底纹透上来。整栏不铺不透明底色，透出 dock 自身的 `--ide-frame-pane-fill`。`aria-label` 从遗留的「接口映射表」改成与可见标题一致的「plog 可读诊断」，CSS 版本号 `?v=` 跟着 bump。两页这段样式是双份复制，改一边记得同步另一边（两份注释里都写了）。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/mc2-incident-monitoring.html`: 中区「单卡内部执行图」的适配、对齐与尺度三处收口。① 「适配」原来只除宽度（`(available-8)/scrollWidth`，上限 1），高度溢出多少不管——点完图还是被下边缘切掉、竖滚动条照在，看着就是没适配。改为两轴同算取较小比 `min(availW/w, availH/h)`，可用区按 `getComputedStyle` 扣掉 viewport 的 padding（`clientWidth/Height` 含 padding，不扣右下总差一截），上下限与手动缩放统一到 [0.2, 2]。测自然尺寸时先把 stage 的行内 `height` 临时置 auto 再读 `scrollWidth/scrollHeight`——它平时被 `--mc2-unit-scaled-h` 顶着，直接量到的是上一次缩放的结果，会越量越小。跟踪对象也换了：改变这块可视区的不止窗口，收起左栏 / infra 栏、拖上下分栏条、开合底部 dock 都会改它的宽高而一个 `resize` 事件都不发，故把 `window.resize` 换成盯 `#mc2UnitViewport` 的 `ResizeObserver`（无 RO 时退回 resize），连续触发合到下一帧只算一次。同时引入 `unitFollowsViewport`：默认跟随容器，用户手动 ±缩放后即钉住（收个侧栏、切个主题不该把人家调好的倍率抹掉），点「适配」交还跟随。② CCU 从跨三行居中改为落在 AIV 同一行，且两框一起 `align-self: stretch`——原先它挂在 AIC 与 AIV 中间那个不存在的位置上，连线看着从 AIV 出发却指向半空；现在上下缘严丝合缝，横边居中正对两框的腰，CCU 内部对象 `flex:1` 长满，红框里不留空地。③ CCU 对象的尺度对齐到对面两个 pattern。整块舞台是同一个 transform 等比缩放的，不存在谁缩得多，但 268px 宽、10px 字的 CCU 摆在 1000/1080px 宽、11~14px 字的 AIC/AIV 旁边，缩到 50% 时 pattern 的 14px 还剩 7px 勉强能认、CCU 的 10px 只剩 5px，看起来就是「CCU 被缩得更狠」。CCU 宽度 268→404px，字号 10~12 → 12~15px，mission 格改 30px 定高（不用 `aspect-ratio:1`，8 列铺满 404px 会摊出 44px 见方、比对面格子还大一圈）、WaitGroup 槽 22→30px。连线上那三行字同理抬档（label 10→12px、meta 9.5→11px、verdict 10→12px、断口 16→20px，横边宽度 118→152px）——「NotifyWait 等不到」是这张图的重点，不该是全图最先糊掉的字。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/mc2-incident-monitoring.html`: 左列「推理指标」两张折线图加悬浮读数。绘图区铺一层透明捕获矩形（鼠标不必压在 1.6px 的线上），按 x 就近吸附到整轮采样后画十字线 + 焦点环：竖线定位到哪一轮、横线把该值引回纵轴刻度（压得更淡，不与网格线抢）。只有 4 个采样点，吸附到整轮而不是跟着鼠标自由滑动，竖线才永远落在真实数据点上——落在两点之间会被读成中间还有连续采样。气泡走 `position:fixed` 挂 body（卡片是 overflow:hidden 的窄格子，塞进去贴边就被切），四行：指标名 / 时刻 / 数值带单位 / 「较上一轮 ×N」——本案要看的是「每一轮都比上一轮慢」，绝对差值说明不了这件事，首点显示「稳态基线」。与「?」说明气泡各用各的元素（共用 `#diagnosisTooltip` 的话，鼠标从「?」滑到图上会互相抢内容）；数据点上原来挂的 `<title>` 一并去掉，否则原生 tooltip 与新气泡同时冒出来读成两份。重画（改尺寸）时先收气泡，旧坐标已失效。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/mc2-incident-monitoring.html`: 中区「单卡内部执行图」三处调整。① AIC / AIV 由并排改为上下叠放（`.mc2-unit-row` 从 flex 行换成三列网格，AIC/竖边/AIV 占左列、横边与 CCU 锚在 AIV 那一行、CCU 跨三行居中）——两块都是设计系统的定尺寸对象，一字排开要 2000+ px，中列装不下就只能整块缩到 50% 或一路横向拖；而它们本就是同一侧的东西（一个 MIX 算子的两个计算部位，靠 crossCoreSync 配对），CCU 才是对面，叠起来横向省掉一整个 AIC 的宽度、纵向填的是原先空着的地方。连线因此分朝向：`unitLink` 加 `axis`，CSS 里竖向为基线（窄屏单列也直接复用），横向那条由 `.mc2-unit-link--x` 在 ≥1181px 时改写，原先那段 `max-width:1180px` 的整体转向规则随之删掉。② `.mc2-unit-viewport` 的滚动条换成与左栏 / infra 栏 / 日志区同一套「平时隐形、悬浮才浮现」的 8px 细杠（全圆角 + 2px 内缩 + 透明轨道）——系统默认那条实心横杠横在图底下像一道分隔线，把「还能往右看」讲成了「这里到底了」。③ 结论句（「三个 flag 里两个是 0，但那不是计算单元与本案无关…」）从舞台末尾移到区域置顶横幅 `#mc2UnitBanner`：它原先跟着 stage 一起 scale，缩到 60% 就没法读，而它恰恰是这张图存在的理由；横幅在缩放之外、图之前，字号回到正文 12px，视觉取观测页事件内容顶部的 `.cro-incident-banner`（danger 描边 + 横向渐变底 + danger 色标签）。聚光灯第 ④ 步的 target 补上横幅，否则这一步的结论句被框在照亮区外。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/training-monitoring-v2.html`: 日志抽屉右栏「接口映射表」换底。这一栏的内容是智能映射的产物（plog 内部名 → torch_npu 可见接口），原来和左侧原始日志一样是 `--surface-2` 中性灰，看不出两侧性质不同。改为一道从左到右的蓝→紫弱渐变（`--primary` 8% → `--highlight-l0a-violet-400` 8%），并纵向从上到下渐隐到无。渐变两端都调在 `transparent` 之上、整栏不铺任何不透明底色，透出的是 dock 自身的 `--ide-frame-pane-fill`——与 `.wzh-log-toolbar` 同一个做法，否则内容不满一屏时底部会露出一条与抽屉不同色的灰带。染色层单独占一层 `::before`：纵向渐隐靠 `mask-image` 实现，而 `mask` 挂在 `.wzh-log-mapping` 本身会把标题和映射卡片一起淡掉，只能给伪元素。为此把滚动容器从 `.wzh-log-mapping` 下沉到内层 `.wzh-log-mapping-list`（那 7 条共用滚动条样式的选择器同步改名）——本体不再滚动，`::before` 才能 `absolute` 铺满而不随内容滚走；表头也因此不必再 sticky + 垫不透明底色去挡内容。映射行卡片底色改为 82% 不透明的 `--surface-1`，让渐变透上来一点，否则整片卡把底纹盖死。栏标题「接口映射表」改为「接口映射」（`aria-label` 与日志正文里那句指引同步改），文字本身也走蓝→紫渐变填充，挂在内层 `<span>` 上（`background-clip:text` 会把整个 background 裁成文字形状，与 head 自身的 background 不能共存）；紫端按主题换档，深色底 violet-300、浅色底 violet-500。

- 2026-08-12 `Profiling_Insight_and_Tool/training-run-twin-standalone/mc2-incident-monitoring.html`: 左列「推理指标」两张图重做。原来是一张 240×84 的 viewBox 配 `preserveAspectRatio="none"`，被塞进 640px 高（那是 v2 七张卡 2×4 的排面高度）、半列宽的格子里纵向拉伸数倍——线宽、圆点、斜率一起失真，而斜率正是这张图唯一要讲的事。改为按容器实测像素作图（`drawChart` + `ResizeObserver`，1 SVG 单位 = 1 CSS 像素，`preserveAspectRatio` 用默认值），格子怎么变图都不变形；同时补齐坐标轴：纵轴按十倍档画网格与刻度值并标注量纲「秒（log10）/ 倍（log10）」（不写出来读者会默认它是线性轴而误判斜率），横轴标首末时刻 14:07:00 / 14:09:48，数据点带 `<title>` 可悬停读精确值。布局由横排两张改为竖排两张、各吃半列高（`#accuracyCharts` 去掉固定 640px 改 `flex:1`），横排时每张只有 ~170px 宽，轴标签比曲线还占地方。两张卡标题旁与「推理指标」栏标题各补一枚「?」（衡量什么 / 为什么是 log 轴 / 异常信号 / 能做什么判断），页面补上 v2 那套 `#diagnosisTooltip` 浮层与 `window.wzhBindHelpTooltips`——此前页面里 infra 栏「集群监控」的「?」与四卡热力格的 `data-tooltip` 因为缺这段脚本一直是哑的，一并接上。

- 2026-08-11 `Profiling_Insight_and_Tool/training-run-twin-standalone/training-monitoring-v2.html`: activity rail 底部新增「关键通知」卡片堆叠（`.wzh-notif-dock` + 页尾 `initNotifDock`）。收起态是一枚 34px 的「两张卡叠在一起」占位卡（主卡 + 下方只露 4px 的窄垫卡，隐喻不止一条），封面直接放最新那条（即展开后最上方的 i=5）的状态图标，配右上角未读数（flex 居中而非 line-height 对齐，单字符靠行高对齐肉眼看得出偏下），参照灵动岛：不展开也已经传达「有几条、最新的是什么」；常驻元素不挂循环动效（试过最高等级呼吸涟漪，余光里一直在闪，已删），这是 rail 上唯一不占版面又必须常驻的信息；整个模块离页面底边 16px（rail 自带 10px 下内边距 + 6px margin）。悬浮/聚焦后占位卡与垫卡一并隐去、位置让给刚抽出来的 i=0 卡，卡堆以弹性曲线（`cubic-bezier(.22,1.16,.32,1)`）自下而上逐张抽开，`--i` 同时驱动纵向步距、左移与角度：`transform-origin` 落在左下角 10px 处，第 i 层**逆时针**旋转 `i × 1.05deg`，i=0 的底卡不倾斜；停住时是整数像素平移 + 无缩放——原来按 `1 − i×0.012` 递减做纵深，合成层会按缩放后的尺寸光栅化，卡里的字全发虚（旋转只影响边缘抗锯齿，不糊字），纵深改由描边与底色差承担——支点固定 + 递增角度才像一摞被按住一角抽开的实体卡，纯平移只是列表。展开后每张卡换上 `--shadow-lg` 再叠一层黑色贴地投影（投影不跟状态色走，否则同一堆卡会看起来深浅不一），卡堆浮在工作区内容之上，没有投影分不出层。卡片按 327px 宽、~59px 高（约 1.5×）铺开，间距从 13px 收到 7px；背景是 `--surface-4`→`--surface-2` 的 148° 半透明渐变 + 一道顶边 inset 高光，压在整网图上时既透出底纹又读得清字；`backdrop-filter` 只挂在 `.is-open` 且砍到 `blur(10px)` 不带 `saturate`——背板底下是常年在跑的进度条流光 / mesh 流点 / 图表重绘，每帧都让 6 张卡各做一次背板取样+模糊，展开动画期间卡片还互相重叠，而重叠的 backdrop-filter 在 Chromium 里是串行渲染通道，叠 6 层就是每帧 6 遍全区域模糊，悬浮几次后合成层不回收、越用越卡（不是泄漏也不是死循环，卡堆逻辑里只有一个每次都 clear 的 setTimeout、监听全在 IIFE 里注册一次）。左侧状态图标改成 30px 半透明语义色圆底 + 线性图标（对勾 / 时钟 / 内存芯片 / 感叹三角 / 趋势下降 / 错位断裂），圆底把状态色摊成一片低饱和背景，余光里比一个实心小圆点好认。时间轴自下而上由旧到新（完成 → OOM → NaN → 1/16 → 1/32 熔断 → 排队中），最新一条永远在顶、也就是封面那张。展开与收起的 `transition-delay` 反向（展开 `i×28ms` 自下而上、收起 `(5−i)×16ms` 自上而下），卡堆合拢时才是「落回」而不是「一起消失」。单卡是 watchOS 式微型信息卡的三段式：左侧语义色圆底线性图标读状态，中间两行读事由，右下角 `align-self:flex-end` 贴底读相对时间（3 分钟前 / 20 小时前 / 1 天前 / 2 天前 / 5 天前 / 12 天前）——卡堆自上而下由新到旧，右下那一列连起来就是时间线。原来右侧那组 26×20 状态色微型图元（进度环 / 阶梯 / 断点折线 / 内存条）已删：一张卡上放两处状态色是重复编码，位置让给时间更有用。展开层 `.wzh-notif-shelf` 收起时 `pointer-events:none`（否则 218×352 一片盖住工作区），展开后整片接管 hover，配合 180ms 延时收起，解决卡片间隙导致的边界抖动；点击无事件的卡或空白可钉住，Esc / 点页面别处取消。点带 `data-event` 的卡前往对应事件：优先 `document.querySelector('.twin-progress-marker[data-marker-key=…]').click()` —— 借道进度条上那个问题点，走的是 `training-run-twin.js` 的 `activateProblemLens`（时光机跳到出事那一步 + 整网图聚焦命中节点 + 展开 Timeline + 开聚光灯定位链），与用户自己去点红点完全同一条路径，不新造第二套跳转；进度条没渲染或该问题无标记时退回 `window.openLocateDrawer(key)`。OOM→`mem-oom`、loss NaN→`moe-a2a`、1/16 告警→`qproj-overflow`、1/32 熔断→`low-precision-training`，训练完成没有诊断事件、走 `data-href` 落到 `TaskCompare.html` 复盘，排队中的任务还没开跑、不带 `data-event` 点了不跳。rail 补 `position:relative;z-index:20`，不然卡堆被右侧工作区盖住。矮屏（≤760px）收紧步距到 46px 保证 6 张不越过 rail 顶部，`prefers-reduced-motion` 下去角度、去延时、去呼吸环。数据为静态演示，接真实告警流时只替换那 6 个 `<article>`。

- 2026-08-11 `Profiling_Insight_and_Tool/training-run-twin-standalone/mc2-incident-{monitoring,observer}.html`: 新增 MC2 算子异常（vLLM 推理 · 多 graph 共享 aclOpExecutor → CCU mission 污染 → NotifyWait 死锁，见同目录 history.md）的双页定位链路，fork 自 `training-monitoring-v2.html` / `config-relation-observer.html`，原页不动。观测页三处结构性新增：①「执行配置」域（enable_mc2 / mc2_comm_mode / cudagraph_mode / capture 档数）与触发判定条——训练版 stepper 只有并行与 MoE 维度，改了只换对象，这一组改了会翻转结论（判据取自 history.md §5.2 三组受控实验的必要条件），是本页第一次能对配置改动做预测而非复盘；② 计算血缘新增**资源节点**（`kind:"resource"`，aclOpExecutor / CCU mission 不是算子）与第 5 种边 `kind:"shared"` 的 N:1 共享复用边（红虚线，顶掉该层对之间的自动顺序边，否则 15→1 会读成 15→15）——原有 fusion/split/lowering/dispatch 四种描述的都是正常编译变换，装不下「本不该共享的东西被共享了」；③ evidence 新增 `kind:"control"` 对照实验形态（v15 触发 / v18 不触发 / 单 graph 不触发），本案根因是跑出来的不是观测出来的，line/bars/stack 三种都在回答「多少」而这里没有量纲。拓扑侧按 vLLM 语义加 `preset.epOverlapsTp`：EP 组与 TP 组落在同一批 4 卡上，world 不乘 EP 且 tpIdx ≡ epIdx（训练版 openPangu 的 EP 与 DP 正交，两者不可混用）。监控页只承担表象与定界四步（forward_time 三分钟恶化 85 倍 / plog 507011 / 四卡 cqeStatus 挑出真凶 rank 1 而非首报的 rank 2 / aicError=aivError=0 而 ccuError=1），不加载 `training-run-twin.js`（那份是 46 层 2048 卡的训练数据源，与推理场景无一量对得上）；聚光灯 `js/mc2-spotlight.js` fork 自 `training-spotlight.js` 只换 CASES，第 ⑤⑥ 步 `target` 返回 null 并在 `prep` 里开观测页深链——根因不在模型结构里、监控页确实查不下去，这是本案与训练版两个案例最大的结构差别。Hunyuan V3 的层数/专家数为演示占位（history.md 未记），只给传播关系提供可指认对象，不参与任何结论。

- 2026-08-10 `precision-debugger/index-v2.html` + `launch-v2.html`: 精度调试工作台出 V2,卡片加 V1/V2 版本入口。V2 在原有三类任务(整网→算子调试 / GPU→NPU 迁移验证 / CPU golden↔AscendC 对标)之外新增第四类 **RL 训推一致性对齐**(`workMode='rl'`):主体是**训推双端整网计算图 diff** —— 左 trainer(MindSpeed) ↔ 右 rollout(vLLM-Ascend) 两张同源图逐算子对位,跨图连线标出等价 / 实现不同 / 仅一端有(rollout 缺 SP 通信那 4 个调用直接留成空档,即「训推算子序号对不上」);同一份成对证据另给「调用链 diff」(函数→接口→kernel 三级成对匹配)与「token diff」(好样本 vs 差样本逐 token |Δlogp|)两个粒度。诊断按 pair 口径统一:默认比较对象为生产对 C↔A,每个受控探针声明自己的消融对象,增益不跨 pair 共用 baseline。结论由产物生成而非浏览生成 —— 关键探针未跑完时不给责任角色、图上不画首个决策分叉 tag、修复项锁定;探针改为逐项异步(排队/运行中/失败重试/取消),修复组合拆成推荐/草稿/已提交/已验证四个状态对象,A/B 复跑要真的提交并回填结果后 06 的「修复后」才生成。指标口径分开:`pass_rate(τ_train=0.10)` 与 `pass_rate(τ_ci=1e-5)` 与 `cos_sim` 三个量各自成列,ESS 由 rᵢ=exp(Δlogpᵢ) 直接算不外推;定位对象拆成五类(首个局部数值差异 op / 首个决策分叉 op / 主因运行条件 / 首个输出越界 token / 最大贡献层模块),不再合并成单一「首个分叉点」。V1 保留在 `precision-debugger/index.html`。

- 2026-08-07 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 沉浸式对比三处调整。① 右上角关闭（含 Esc / 点遮罩）改走 `goBackToDashboard()`——收掉任务选中回到差异总览，勾选的对比对象一个不动，并把三栏泳道 viewport 的 scrollLeft/scrollTop 滚回下钻前的位置（`captureImmersiveViewports()` 在 隐藏→显示 那一次快照，遮罩开着时翻页不重记；退出动作本身会走一遍 `syncImmersive` 把快照清掉，故 `close()` 先把它取到局部再用）。清空对比对象是「取消勾选」这个动作的事，不由关一层遮罩代劳；顶栏「沉浸式对比」开关同样不动，它表达的是「下钻要不要进沉浸式」这个偏好。② ← / → 翻页在本泳道到头后跨到相邻泳道（`immersiveLaneHopEvent()`），行序取渲染器 `sortedCores`，与屏幕上看到的顺序一致；聚合视图里同一条逻辑泳道摊成 `…§base` / `…§compare` 多行，按剥掉槽位后缀的裸名去重并统一落到基线那行，否则「下一条」只会翻到对侧同一个任务上；空泳道自动跳过。③ 时间轴与起止胶囊改标绝对时刻，删掉表头「时间轴 0 点 · 最早启动的任务条」那句——原来的 0 点随选中任务漂移，翻一条任务整条轴的数字全变，没法对账。刻度小数位改按步长取（原来按窗口跨度），保证相邻两格读数不会被四舍五入成同一个值；右侧「指标对比」表仍标相对偏移，口径差异写在 `chipHtml` 注释里。

- 2026-08-07 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 沉浸式对比右上角关闭按钮左侧补上「上一条 / 下一条」，切到同泳道时间序上的相邻任务（← / → 也可）。目标由 `immersiveStepTarget()` 取——基准侧第一个有事件的槽位 + `neighborEventsOf()`，与视图里那两个灰色上下文块、「空闲间隙」箭头指的是同一条，点过去所见即所得；选中态复用 `selectAggregatedTrainEvent` / `selectGroupedTrainEvent`，泳道高亮、跨栏连线、右侧详情一并跟着走。三个按钮收进 `.sl-immersive__actions`（原来关闭按钮自己绝对定位），仍挂在 `immersiveInner` 外面，重渲染时不被连带重建、焦点不丢；泳道到头时按钮置灰不隐藏，位置不跳。`.sl-immersive__header` 的 padding-right 由 72px 放到 156px 让位。

- 2026-08-07 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 沉浸式对比里被放大的主角任务条内部补上语义标签文字（`model.label`，与左栏「选中任务」卡的标签胶囊同源）。标签用 `position:absolute;inset:0` 浮在执行/等待两段之上，不参与 flex 分配，免得挤动两段的切分点；白字 + 阴影保证在 8 种语义色上都读得出。条子给了 `container-type:inline-size`，窄于 72px 时整块标签收掉，不留一个孤零零的省略号。指标数字仍一律走条子外的标注箭头，条上只写标签。

- 2026-08-07 `pto-swimlane-profiler/`: 同步 PyPTOUX 最新增量，优化就地生命周期透镜的滚动定位与 Canvas 重绘节流，修正 DevTask 引导线和透镜行背景对齐；更新 16:9 启动台封面。

- 2026-08-07 `Profiling_Insight_and_Tool/AI_Profiling_Tool/report-render.js` + `report.{css,html}`: 报告形态的健康度仪表盘不再自绘，直接调用工具形态 `app.js` 的 `renderPhsGauge()`——分段刻度、等级色渐变、指针、增益弧全部同源，工具态改几何或调色时报告自动跟随，不会再出现同一张图两个样子。它写 DOM 不写字符串，故正文里只吐 `[data-rp-gauge]` 容器，由 `paint()` 末尾新增的 `mountGauges()` 在 innerHTML 落地后回填；它写死了 `styles.css` 的 `.phs-gauge-*` 类与 `--fg` 系列变量，而报告刻意不引 `styles.css`，故 report.css 补一组同名规则并把 `--fg/--fg-secondary/--fg-muted` 就地映射到设计系统 tokens。高度从固定 210px 换成 `aspect-ratio:3/2`，与 `viewBox(300×200)` 严丝合缝——否则 SVG 在栏宽里 letterbox，`.phs-gauge-center`（`inset:0` + `translateY(9%)`）算的是盒子中心而非环心，中心大分数就会偏离环。分项雷达同步重做：口径（维度顺序、预估缺失回落到当前值、N/A 记法）与双色（`COLOR_CURRENT`/`COLOR_ESTIMATED`）对齐工具态 subChart，但不复用那边的 echarts 实例——echarts 走 CDN（离线归档取不到）且默认 canvas 渲染，按 CSS 像素栅格化，A4 打印必糊，故按同一份配置自绘 SVG；图例从 SVG 底部挪到外层 HTML 行（原先压在 `y=196`，与下方两个维度标签 `y≈190` 打架），标签改为「维度名 / 实测值」双行并按象限贴边锚定，不再被 viewBox 切边。分项不足 3 维时整块含图注不出，不留空图占位。

- 2026-08-07 `Profiling_Insight_and_Tool/AI_Profiling_Tool/report.{html,js}`: 报告版面上的 "PTO" 前缀去掉（顶栏品牌、封面页眉、封面页脚、每页页脚共 4 处）；`window.PTO_REPORT` / `PTO_DISABLE_APP_INIT` 是 JS 全局名不上版面，保留。

- 2026-08-07 `Profiling_Insight_and_Tool/AI_Profiling_Tool/index_v3.html` + `app.js`: 在中间 pane 页签行（性能总览 / 算子 …）右端加「→ 报告形态」出口，跳到 `report.html?r=<当前记录 id>`。刻意不做成第 9 个 tab —— 它是离开本页的跳转而非页签切换，故 `margin-left:auto` 推到最右、弱化成 ghost 链接；`selectReport()` 里由新增的 `syncReportFormLink()` 同步 href。本地上传解析出的临时记录不在 `report.html` 的 `REPORTS` 里（那边找不到 id 会回落到最后一条），此类记录直接隐藏入口，避免点过去看到的是别人的数据；`display:inline-flex` 会盖掉 UA 的 `[hidden]{display:none}`，故显式补 `.v2-report-form-link[hidden]` 一条。

- 2026-08-07 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: 计算血缘收敛为运行事件的证据下钻能力；配置态点击整网或典型 Layer 的计算节点继续保留原有选中与关系高亮，但不再构造或打开右侧计算血缘抽屉。事件视图底部的「事件详情 / 计算血缘」页签与卡片级路径交互保持不变。

- 2026-08-07 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: 补齐配置关系页的 Rank 语义与计算血缘。① OOM 事件把含混的「Rank 17」改成「EP rank 17（global rank 1553）」；Router Top-K 说明改为 batch / 观测窗口内的负载均衡语义，不再暗示单 token 应摊到全部 256 个专家。② Rank 编址显式展开 `inner = cpIdx·TP + tpIdx`，新增 `rankOfCoords()`，`coordsOfRank()` 回吐 TP/CP shard；集群格子的 dataset、提示、ARIA、点击 payload 与关系标签统一展示 `PP / DP / EP / TP / CP` 五维坐标。③ 选择整网或典型层里的具体算子时，打开复用 `panel-shell` 的非模态「计算血缘」抽屉，按算子语义动态构造 Model → FX → GE → CANN Runtime → Kernel/Executor 完整链并绑定代表执行 Rank；运行事件、数据流播放或非算子选择会关闭抽屉，Esc 优先收起抽屉。④ 事件视图下区把「事件详情」改为与「计算血缘」并列的标准页签；11 个事件逐条声明可定位层级，五层链固定横排，已定位层正常显示、缺少直接定位信息的层保留位置并暗化。Router 根因点亮完整五层，Plog/All-to-All 点亮 Runtime+Kernel，OOM 只点亮 Runtime；左右方向键可切页签。⑤ 血缘节点补卡片级边关系与转换类型：悬浮只高亮直接上下游，点击固定完整关联路径，非关联卡片和边降权；链下检查区同步展示所在层、直接输入、直接输出与转换依据，并支持键盘 Enter/Space 固定、Esc 清除。按要求没有增加「配置推导 / 实际观测 / 因果推断」图例，也没有调整「整网」等区域命名。

- 2026-08-07 `Profiling_Insight_and_Tool/AI_Profiling_Tool/report.{html,css}` + `report-render.js`（新增，原型）: 给性能分析补**报告形态**——`index_v3.html` 是工具形态（IDE 三栏、多页签、点选钻取），读者是"正在排查的人"；报告形态是同一个 `r` 对象的第二个 renderer，读者是"没跑过这次 profiling 的人"（主管 / 隔壁团队 / 三个月后的自己），所以线性、弱交互、A4 竖版、总分总。策划与竞品分析见同目录 `REPORT-FORM-PLAN.md`。① 数据零重复：`app.js` 末尾的 `init()` 改为 `if (!window.PTO_DISABLE_APP_INIT) init()`（与 `PTO_DISABLE_NAV_AUTOLOAD` 同类的宿主开关），报告页置位后加载 `app.js` 只取 `REPORTS` / `parseReport()` 而不跑工具形态的 DOM 初始化；`REPORTS` 是顶层 `const`，不挂 `window`，同为经典脚本可读其全局词法绑定，故用 `typeof REPORTS` 兜底而非 `window.REPORTS`。② **弱交互的验收标准是「打印出来不丢任何信息」**，不是「少放几个按钮」：工具态藏在指标卡 `?` tooltip 里的口径与 `data-warn` 阈值，在报告里必须变成条上那道黑刻度（`.rp-bullet__thr`，印出 `≥80` / `≤5`）加附录 A 全文；芯片型号下拉固化成 910B1 并写进图注；问题的左右分栏点选摊平成每问题一节。③ 正文按定容模板裁剪（证据 300 字 / 影响 150 / 每步 130），**裁掉的全文进附录 C** 而不是丢弃——为了单页版面牺牲证据完整性，报告就没法当归档件用。④ 泳道快照走最低成本路径：直接消费 `chart-data.js` 已有的 `SWIMLANE_DATA[reportId][actionId]`（含 `annotations` 的 range 标注），自绘定宽 SVG，不加载 `swimlane-data.js`（15 MB）也不复用 `swimlane.js` 渲染器（它面向可缩放交互画布）；语义色从 `swimlane-skill-pack/js/swimlane.js` 的 `SEMANTIC_COLORS` 镜像一份（该常量是模块内 `const`，未挂 `window`），改色需同步。⑤ 图表一律自绘 SVG / CSS，不引 echarts：canvas 按 CSS 像素栅格化，打印必糊；CDN 依赖在离线归档场景不可靠。新增的「收益 × 难度四象限」（`svgQuadrant`）是价值最高的一张——`actions[].benefitNum` + `difficulty` 现成数据，一张图回答"先做什么"。⑥ `mfu` / `mem_util` 沿用工具态的克制：分母是手选的芯片假设而非实测，故 `neutral: true` 不做 ok/warn 着色，只印数值与折算依据，避免误导为"健康/越界"。⑦ 六种 `taskType` 走同模板 + 条件章节而非六套模板：`rankStats` / `opStats` / `breakdown` / 泳道快照缺失即整章不出，**不留空占位**（报告里的空占位等于减分）。实测 8 份预置报告分化为 10–20 页，`r20260618ub` 无泳道数据即自动跳过「时间去向」章。⑧ 打印页高取 296mm 而非满额 297mm：满额盒子在 297mm 纸上易因舍入溢出多打一张空白页。⑨ 刻意不引 `styles.css` —— 那是视口自适应的 IDE 三栏版面，与固定 210×297mm 的文档流没有可复用的部分，混入只会互相污染；只引设计系统 tokens。尚未接入 `launch.html`（待形态确认）。

- 2026-08-07 `pto-swimlane-profiler/`: 同步 PyPTOUX 最新 L2 / schema-generated / share-safe 稳定版，补齐运行历史、PMU 证据、优化建议、核心下钻与生命周期视图；发布资源继续复用 `vendor/pto-design-system`，并更新 16:9 启动台封面。

- 2026-08-07 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: 数据流播放改为**循环重播**，并把步文案的分段顺序与术语对齐泳道。① 播完不再 `stopFlow()` 自停，而是 `flowIndex = 0` 从头再走一遍——一个 step 本来就是循环往复的，训练跑的是成千上万个 step，停在收尾格反倒读作"训练结束了"；退出只由用户点「退出」触发。回绕**必须先 `lanesReset()` 并摘掉 `is-flow-optimizer`**：dW 填块、显存面积、残差流实线都是整趟攒下来的量，不清就把第二轮画在第一轮的残留上（dW 只增不减，叠两轮直接顶满）。② 新增 `noteSegments()`，分段一律按 `FLOW_LANES` 自上而下的顺序重排，不按 `flowNote` 里写的先后——这排色点就是下面 6 条线的图例，读者拿它当索引（看到第 2 枚点就往第 2 条线上找），而反向那句原先把「路由」甩到最末、轴上它是第 2 条，对应关系就废了。在这里统一排而不是逐句手写：`flowNote` 有 9 条分支且还会加，人肉维护迟早再错一次；挂不到泳道的段沉底，兜底 order 取 `FLOW_LANES.length` 而不是 `Infinity`（两个 `Infinity` 相减得 `NaN`，比较器返回 `NaN` 时排序未定义）。`noteToHtml` 与新增的 `noteToText`（挂 title 的纯文本份）共用它，否则 title 与眼前顺序对不上。③ 段名与刻度提示改用全称：`dX`/`dW` → `层间梯度 dX`/`权重梯度 dW`（这行文案往往是读者第一次遇到这两个符号的地方，缩写读不出"梯度传给谁"），`L{n}` → `Layer {n}`；`NOTE_LANE_KEYS` 的倒序匹配前提随之变成「权重梯度 dW」与「权重W」共享前缀。④ 反向 5 条文案的 dW 段一律补「只算不改」——「反向按梯度改了每层权重」是最容易带进来的错觉，反向只算 dX 与 dW，权重一个字节不动（链式法则要求整趟反向踩在同一份权重快照上），唯一一次改写在收尾格，两边措辞对上；MoE 反向把「路由 只读前向那张表」提到段首并写成"照它把梯度发回同一批专家"。MoE 前向的路由段补全 Top-K 打分与分派表的说法（腾出的宽度来自摘掉的重复子句）。⑤ 暂停标记 `.cro-flow-lanes.is-paused::after`（「· 已暂停」）撤掉：暂停态已由按钮自身表达（图标翻回 ▶ + 文案「继续」），进度行再挂一次是同一件事说两遍。⑥ 事件横幅的关闭键从 `&#10005;` 文本换成与 rail 同源的 SVG（收到 14px）：文本走基线排版，`place-items:center` 居中的是含 descender 空白的行盒，而 ✕ 没有下伸笔画，视觉上恒偏下半个 descender。

- 2026-08-07 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 沉浸式对比的**时刻类标注改为相对偏移**，并给 8 个指标补上口径说明。起因是「结束 1234567 μs」这句读起来像时长——值本身是时间轴坐标没错，但 `chipHtml()` 对全部字段无差别走 `formatCompareVal(val,'μs')`，时刻和时长共用一个格式器就长一个样，而刻度尺同样打绝对 μs，量级也帮不上忙。改法：① `diffDetailModel()` 新增 `timeOrigin`（本次对比里最早启动的那条任务条），`rowOf()` 加 `kind`（`offset`/`length`）与 `hint` 两个字段，新增 `formatOffsetVal()` / `compareCellText()` 供右侧表与沉浸式共用——**必须共用，否则遮罩里标 `+842 μs`、表里标 `1235409 μs`，原来"两处永远一致"的对账关系就断了**。② 起止胶囊与刻度尺一律显示相对 0 点的有符号偏移（`+`/`-`，0 点自身不带号），标签从「启动/结束」改回「启动时刻/结束时刻」，绝对时刻退到 title 与遮罩表头新增的「时间轴 0 点」一栏（整屏只出现一次）。这也更贴合这个视图的用途：沉浸式要回答的是"各 run 错开了多少"，绝对时间戳本身没有对账价值。③ `bestVal` 的比较仍用绝对值——0 点对各 run 是同一个，减不减不影响谁最早。④ 每个指标的口径写进 `hint` 并挂到表格行名与标注胶囊的 title 上，重点是把**同步等待**（任务条内部、计算结束到任务退场之间的尾段：等数据搬运 / 等 AIC↔AIV 同步 / 算完等各 rank 到齐进集合通信，核仍被这条任务占着）与**空闲间隙**（任务条之间的空白，核上没有任务，属于调度空泡）区分开——这两个数在遮罩里挨得很近，此前界面上没有任何文字交代差别。⑤ 顶栏「沉浸式对比」开关的开启色从 `--accent` 换成 `--primary`：`--accent` 是辅助域配色（dark 主题下 `#7c8db8`，去饱和灰蓝），摊在 34×18px 的轨道上读起来就是灰的、看不出开着；交互状态色本来就该跟界面其余选中态同源。focus 描边一并换。

- 2026-08-06 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 新增「沉浸式对比」——点泳道任务条下钻后默认在一层遮罩前只留**泳道路径（左上）+ 时间轴 + 关闭按钮 + 选中任务卡（压在原「任务对比」勾选栏的位置上）+ 被整体放大的那条任务条（两侧带同泳道前后相邻任务的灰块）**，顶栏加一枚开关随时进出（× / 点遮罩 / Esc 等价于关开关）。目的只有一个：原先「指标对比」那 8 个数字在右栏表格里，看一眼任务条就得扭一次头，现在全部标到任务条周围的标注箭头上——持续时长跨整条、空闲间隙（前/后）跨相邻任务之间的空白、执行耗时/同步等待直接切在条子内部（两段合起来正好等于持续时长）、计算-通信重叠是条下那段粗线、启动/结束时刻贴在左右边界下方。几处必须这么做的取舍：① 遮罩挂在 `.pto-ide-frame__workarea` 内而不是 `position:fixed` 盖全屏——顶栏那枚开关必须始终点得到，盖住它就只剩 Esc 能退。② 抽出 `diffDetailModel()` 给右侧详情表和遮罩共用：两处显示的必须是同一批数，否则箭头上的值和表里的值对不上，用户没法互相印证；「谁更优」的绿色判定（`bestVal`，唯一最优才标）也一并移进模型。③ **空闲间隙改用泳道上真实的前后相邻任务算**（`neighborEventsOf()`，`compareSlotEvents()` 顺带回吐 renderer/coreName），不再是随机派生值——这两个数现在标在跨过那段空白的箭头上，箭头跨度和数值必须严格一致；随机数序列仍按原样消耗，`执行耗时`/`计算-通信重叠` 的派生值不变。相邻任务不存在时该指标留空（表里显示「—」）。④ 时间窗口以各 run 任务条的整体跨度为基准并尽量框进前后邻居，但**封顶在主角跨度的 6 倍**：邻居离得远时不封顶会把主角压成一条线，超出部分由 track 裁掉。⑤ 跨行竖虚线画在各 run 任务条的起止时刻上，启动时间的偏移一眼可见——这是表格里两个绝对 μs 值做减法读不出来的东西。首轮走查后的调整：泳道路径与关闭按钮改为独占顶部一行，下面两列的第一个元素分别是选中任务卡与时间轴，**时间轴顶部因此与卡片顶部天然对齐**；沉浸式期间用 `.pto-ide-frame.is-immersive` 隐掉 `#crossLaneSvgOverlay`（泳道上「最前开始 / 最后结束」那两条对比边界竖线亮度足以透过遮罩，和这里各 run 起止的竖虚线是两套坐标读法，同屏串味；走 class 而不是改 style，因为首次选中时那个 SVG 还没被 `ensureCrossLaneOverlay` 建出来）；刻度密度 6 段 → 12 段；**数值胶囊从压在箭头线上改为浮在线的上/下方**——压住会把线切成两截，看着像箭头断了；执行耗时/同步等待不再写在任务条上，条子内部只留深浅+斜纹这层视觉切分，两个数字下沉到条下各自那一段的标注箭头（跟其余指标同一套读法）；轨道内改为上下标注各占一半（34 持续时长 / 64 重叠 / 78~126 任务条 / 102 空闲间隙 / 134 起止 / 168 执行·等待），且 `.sl-immersive__runs` 在时间轴以下的剩余高度里垂直居中，任务条不再偏上；去掉底部图例行。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: 数据流播放从「只有流到哪」补上「发生了什么」——原先一趟只有前向 49 格逐格点亮四域，读不出这一格在业务上改写了什么。① 一趟改成三段：前向 49 格 → 反向 49 格（同一条 x 轴反着走）→ Optimizer step 1 格（停 1200ms），约 19 秒。反向直接反用前向解出的那批 rel，省掉 49 次 resolveRelation，且段内共卡的去重结果原样保留，反着走 deck 仍只在 Emb→Dense→MoE→Norm→Head 与 PP 段边界换卡。**"反向更新权重"是错的口径**——反向只产梯度（dW 累加到 buffer），权重是收尾那格 Adam 写回时才被改写，所以它必须是独立一段而不是并进反向。② Layer 导航刻度带正下方新增 6 条数据线（仅播放时展开）：残差流·激活 / 路由决策·门控权重 / 显存占用 / 层间梯度 dX / 权重梯度 dW / 权重 W·优化器状态。泳道 x 轴与刻度带**共用**——第 i 格刻度正下方就是第 i 层的状态，小点从刻度垂直落到泳道，落点即第 i 层；对齐靠 JS 实测刻度中心（lanesSync）而不是两边 padding 碰巧相等。因此它不能占原方案设想的 stepper 槽位：那排在刻度带上方、wrap 后还会错位，点飞过去落在哪儿是随机的，而且 60~70px 的高度塞不下 6 条可读泳道。stepper 改为播放时压暗禁用，不腾位置——收起会让 arch 区高度再变一次，起播时画面跳两下。③ 六条线的变化性质不同，标记也各不相同（全画成"线 + 小点"会把差异压平）：残差流走流动点 + 落点脉冲 + 身后留实线；路由决策是离散事件，只在 MoE 层打竖刻痕、Dense 段整段留空；显存是面积填充，前向堆成山、反向**从右往左融化**（算完第 j 层梯度，第 j 层前向存的激活就释放），任一时刻仍是单值曲线；dX 与残差线镜像（右→左）；dW 逐格填块，MoE 层半高半透表示只有被路由到的专家有梯度；权重 W 最后一格整条扫亮。④ 每层只发 1 个点而不是 attn/ffn 各一个：两次残差改写在结构条上已分开点亮过，再拆一遍是同一件事说两遍，代价却是密度翻倍——190ms 一步、点飞 165ms，屏幕上会一直有 3~4 批点在空中，读起来是噪点雨。⑤ 未激活的线画成极淡虚线而不是"不存在→出现"：6 个槽位从起播就恒定占位，逐条长出来会把下面的线一路往下推，播放中一直在抖。⑥ 收尾那格四域清空（rel = null），集群矩阵整块铺满——DP All-Reduce 平均梯度、Adam 写回，每张卡都参与，这是整趟唯一一次"全体 rank 同时动"。⑦ 播放键拆成两枚：主键在 播放 → 暂停 → 继续 之间翻转，退出才真正结束并还原上一次选择（原先是「停止」一键到底）。一趟从 9 秒变 19 秒后，看清某个中间状态的需求压过了"重看一遍更省事"。暂停走**虚拟时钟**（所有时间戳一律减掉累计暂停时长）而不是逐个平移时间戳——泳道上的点、脉冲、刻痕、填块、扫亮全按绝对时间戳算进度，挨个补偿漏掉哪一项，哪一项就会在续播瞬间跳到终态。暂停期间 rAF 停摆，所以改 canvas 尺寸（板面重排）与切主题都要就地补画一帧，否则定格画面当场变白。配套：播放（含暂停）期间空白点击不再 clearSelection、Esc 改为退出播放——四域上亮着的是当前这一步而不是 relation，抹掉后暂停态没有下一拍来补。点具体对象（刻度/专家/rank）仍走 emitSelect 退出播放并选中它，正好是"定格 → 点进去查"。⑧ 起播、以及关闭事件横幅（红色名片的 ×）时自动收起左侧运行事件栏——播放看的是整网 49 格走一遍，刻度带越宽每格越大，而事件列表在播放期间既不参与也点不动；横幅一关四域就接管整块画布，留着列表只是在左边占宽。为此给 `setEventRailCollapsed` 加 `select:false` 选项跳过它内建的 clearSelection/selectIncident——起播要留着 relation 供退出时还原，横幅关闭自己刚调过 clearSelection，再来一次会把状态推翻。收完必须**同步**补一次 `layoutLayerNav`：栏宽是 class 翻转当场就变，但 `--cro-tick-w` 要重排才重解，不补这一下紧接着的 lanesSync 量到的是旧格宽下的刻度中心，头几格小点会落偏。⑨ 播放期间三排 stepper + 配置错误行 + 整网的模型下拉整体收起（初版是压暗保留）：这一趟要看的 Layer 导航 / 典型层 / MoE 都是越高越好读，各区内容自然上移，多出来的高度由带 `flex:1` 的那一节（典型层算子栈、MoE 路由专家列表）吃掉。原先怕"高度再变一次"，但起播本来就要放出 6 条数据线（+178px），顺手让出 stepper（−66px）反而把净变化压小了。退出键补上 × 描边图标（与 rail 图标同源，不像 ▶/⏸ 那样给 fill）。⑩ 步文案（`.cro-flow-lanes__note`）从单行省略改成**恒定两行**并提到 `--foreground-secondary`：泳道画的是"哪几条线在变"，这句话才是"具体变了什么、伴随哪次通信"，是整块里信息量最大的一行，最长的一条（前向 MoE 层，107 字）单行放不下。高度按两行写死而不是按内容撑高——Dense 层一行、MoE 层两行，撑高会让下面整块泳道每 190ms 上下跳一次；窄视口两行仍装不下由 line-clamp 截断，全文兜在 title 里。head 的 `align-items` 从 baseline 改 flex-start：note 变成 `-webkit-box` 后基线由内部行盒决定，baseline 会把进度标压到两行中间。文案本身同时重写成「谁对谁做什么」并按泳道分段（`部位｜泳道名 动作`），与下面 6 条线一一对上——原先写「Attn → 残差」读不出那是覆盖、累加还是消费，而这三者在业务上完全不是一回事：残差流是 Emb 从无到有 → 每层被**累加**两次（`h += Attn(h)`、`h += FFN(h)`，不是覆盖）→ Final Norm 最后一次**改写** → LM Head **消费**掉；dW 是只增不减、反向逐层各加一份，MoE 层只有被路由到的专家加、其余一份不加；权重 W 整趟只在收尾格被改写一次。硬规矩是**每个分段必须挂在某条泳道名下，挂不上就不写**——初稿每条末尾还缀着 `TP All-Reduce ×2` / `EP A2A ×2` 这类通信注记，但通信不是这 6 条线里的任何一条（设计时列过"第 7 条线"却没实现），读者顺着分段格式去下面找对应的线永远找不到，已全部摘掉；要写通信只能写成某条泳道的动作（如收尾格的「dW 跨 DP All-Reduce 取平均」）。腾出的宽度还给泳道子句（如 MoE 前向补回 `Attn(RMSNorm h)` 的完整写法）。每段开头再缀一枚**该泳道颜色的圆点 + 同色段名**（`noteToHtml` 按段名查 `NOTE_LANE_ID` 生成，开播时一次性算完 99 段 HTML，播放中只做一次 innerHTML 赋值）：六条线在下面各有各的颜色，文案却是一整片同色文字，读者得逐字找"这句说的是哪条线"。色值取 `--pto-model-deck-*`，与 canvas 上那条线同源，syncPalette 重算后两边一起变，不会"点是旧色、线是新色"。上色之后 `｜` 分隔符成了多余（点本身即分隔），撤掉换成 9px 段间距。正文仍走 `--foreground-secondary`，只有段名着色，避免整段变彩字。按 11px 字号逐条量过渲染后像素宽（CJK 11px / 拉丁 6px，含点与段距），最宽一条 937px，两行预算（arch 列 520px，首行让出进度标 70px）970px，无超标、无孤段。⑪ 性能上唯一让步：rAF 回调里多一次 canvas 全量重绘（六条线 + 几十个标记，比原先每步两千次 class 切换便宜）；六条泳道共用一张 canvas，标签留 DOM。刻度带重排（板面出滚动条 / 窗口缩放 / 事件栏收展）会重量 x 轴，主题切换只换颜色不 reset 进度，进事件模式先停播（board hidden 后刻度带量不到宽度）。

- 2026-08-06 `Profiling_Insight_and_Tool/AI_Profiling_Tool/index_v3.html`: MFU 计算明细抽屉——**用户看完解释仍算不出 64.0% / 66.6%**，根因是口径断链而非解释不够。① 修分母：`模型 FLOPs ≈11.95 P` 是 6ND 全局 batch 口径，而峰值卡片写的 `320 T` 是单卡值，代进公式得 521% 而非 64%；峰值改为 `2560 T（320 T/卡 × 8 卡）`，T_iter 副标题点明「单卡迭代墙钟」，两张百分比卡片的副标题从名词（`stage0≈80%`）换成代入了数的算式（`11.95P ÷ (7171ms × 2560T)`、`7171.3 ÷ 10763 ms`），原信息移进 title。② 表格新增「占 T_iter」列（该行耗时 ÷ 10763 ms）+ 类目标题行右端小计，CUBE 59.9% + FA 6.7% 直接读出 66.6%。③ 页签从纯筛选升级为求和：新增求和条，算式拆成带步骤标签的两行——选 64.0% 给「第一步 把选中行加起来 `6448.4 + 722.9 = 7171.3 ms = T_compute`」+「第二步 代进达成率公式」；选 66.6% 时**主算式必须正向直给** `T_compute 7171.3 ÷ T_iter 10763 = 66.6%`，选中行只作为「剩下那 33.4% 由谁构成」的补充。初版写成 `非计算时间 3591.7 ms = 33.4% → 100% − 33.4% = 66.6%`，三处都错：点标着 66.6% 的页签却先讲 33.4%、`ms = %` 吞掉了「÷ T_iter」那一步、还要用户先接受一个他同样不知道怎么来的数再做减法。加数从 DOM 实时读取（表格数据改了自动跟着变），但百分比结果沿用页签标称值不回代重算——模型 FLOPs 是 6ND 估算，回代会得 65.1% 与页面标称的 64.0% 打架。进度条统一成一条 T_iter = 100% 的三段式时间预算条（有效算力 42.6% / 算子未达峰 24.0% / 非计算 33.4%），切页签只改高亮与压暗、不改坐标轴——初版是单条 fill，选 66.6% 时只填 33.4%，跟页签上的数字当场对不上。④ 66.6% 页签的柱状图左右换位：选中行（非计算 33.4%）挪到左段并压暗、绿色让给右段的「计算 66.6%」——绿是这个页签的主色，标在配角上会让人以为绿的那段才是选中的东西；左段再用一条虚线引导线接到表头「占 T_iter」列（起终点每次实测两端 getBoundingClientRect，列宽是百分比、抽屉宽度随视口走；容器用 -20px 负 margin 抵掉 .mfd-body 的两道 20px gap，34px 的带子正好落在求和条与表格之间），被指到的表头列加重字色 + 淡底。柱状图移到求和条卡片最末（说明文字挪到柱子上方）、引导线起点用 `segRect.bottom - linkRect.top` 算成负纵坐标配 svg `overflow:visible`——否则中间隔着一段说明文字、线只能从卡片底边起笔，看着是「整张卡片连到表头」而不是「那一段连到那一列」；起点再补一个 r=2.2 的圆点吸附在段底边上。切泳道视图 / 换页签 / 改视口 / 开抽屉都会重画或撤掉。⑤ 标注不可相加的行：`耗时最大单算子`、`…含 mc2`、`DP通信做差` 是上一行的子集，打「明细」标记、缩进降权且不计入小计；`PP 空泡` 打「含重叠」标记。表下补口径说明并在求和条里点明——occ 各行直接相加是 5849.4 ms 而非 3591.7 ms，因空泡窗口内同时发生着 send/recv、DP 通信与 free，**这些行是耗时分布不是严格划分**。原先用户验算一次对不上就会彻底放弃，这一条比新增的列更关键。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/training-monitoring-v2.html` + `js|css/training-timeline-panorama.*`: 新增「时光全景」顶部浮窗——点顶栏训练进度部件（没点中问题 1/2 标记点的那一击）从顶栏下方展开一张全宽浮窗，把整段训练的关键事件铺在同一条 step 轴上：异常（P0 事故）/ 告警（P1 苗头）/ 产出（ckpt、报告）/ 消息推送（值班群、邮件）/ 事件（启动、warmup、回滚、eval），已发生的带时间戳可点击、计划中的给「预计」时间不可点。点击跳转一律回交时光机：带定位链的问题（12003 显存 OOM = 问题一、15203 Router 溢出 = 问题二）走 `activateProblemLens` 进聚光灯，其余走 `applyViewStep`。为此在 `training-run-twin.js` 暴露 `window.PtoTrainingTimeMachine`（只读时钟 + gotoStep/activateProblemLens/exit），不另起一套 step 语义。时间戳口径统一为「启动墙钟（日志里的 `training loop started` 2026-07-16 08:08:10）+ step × 8.5s」，与顶栏「已训练时长」同源。三处设计取舍：① 轨道的一击有了两种语义，按 3px 拖动阈值区分——拖动仍是原来的跟手回放，干净一击才开全景（无全景模块的 `training-monitoring.html` 保持"按下即跳步"的老行为）；② 当前 step 只到 21000/120000，已发生的事件全挤在轴左侧 ~17%，标签不硬贴在标记点正下方，改成「车道 + 向右让位」贪心排布（固定 152px 宽、最多 5 条车道、代价 = 让位距离 + 车道序），用 S 形引出线接回各自标记点；③ 类型药丸兼作图例与筛选，点一下只看某一类，被筛掉的淡出但保留占位，避免每次筛选整片标签重排。关闭：× / 点面板外 / ESC。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.js`: **1/TP 的说法对 MoE 层高估两个数量级**——MoE 层的参数大头是路由专家，先被 EP 切成 1/ep 再被 TP 切一刀，单卡实际持有 1/(tp×ep)，只有 Attn / 共享专家 / Dense MLP 才是纯 TP 切的 1/tp。TP≥2 时连线卡片按是否含 MoE 层分别陈述：`单卡持有 Attn/共享专家 1/2 · 路由专家 1/(2×64)` / `单卡持有 1/2（只按 TP 切）`；斑马纹那行压短成 `明暗相间 = TP 切出的 2 份，每条一份`（卡片挂在连线中点，一行不能超 ~24 个汉字）。口径说明只加在结构类选择（层 / 典型层 / 端点）上，点 rank、点专家不加——那问的是别的事。**没有**收窄 Dense / Emb / Norm / Head 的高亮范围：EP 维度上它们确实是副本，但副本也是"这张卡上有这一层"，只亮一份会读成"这个 DP 里其余的卡不含这一层"；而且同一 DP 副本内各 EP 位置彼此等价，挑一个当"本体"是任意的。副本结构由斑马纹表达——同一亮度的那批卡持有同一份 TP 切片，互为副本。VPP（一个 rank 持有若干段不连续的层）仍未建模。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: 单 DP / 所有 DP 的查询口径原先只作用于 `kind:"layer"`，选中 Emb / Final Norm / LM Head 时恒定高亮全部 DP 的 rank——而这三个在 Layer 导航里就是三格刻度，用户读到的同样是"选中一格"。口径改为覆盖 `layer` + `segment`（`DP_SCOPED_KINDS`）：新增 `topology.ranksOfStageInDp(stage, dpIdx)`（`ranksOfLayerInDp` 改为它的薄封装，端点对象没有层号只有驻留 stage），`resolveRelation` 的两条 segment 分支改走 `stageRanks(stage)` 按 `payload.dpIdx` 取数；口径切换后的就地重查、以及数据流播放的端点步，也一并按新口径走。实测默认单 DP 下 emb/norm/head 从 512 卡收敛到 64 卡，与点一层完全同口径；所有 DP 仍是 512。专家 / EP 组 / 共享专家不纳入：那边问的是"这个编号散布在哪里"，跨 DP 副本铺开正是答案本身。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.js`: 修上一条"deck 段内共用一张卡"带来的回归——段内的层（如 L3~L11 共用 L2 那张卡）整网图一个节点都不亮。`markDeckRelated` 是按真实层号判相关的，而正在显示的是该段首层那张卡，它不在 `rel.layers` 里，于是整张卡的节点全被判成不相关；deck 上的"亮"恰恰是靠**其余节点变灰**表达的（`:has(.is-related)` + grayscale），结果就是满屏灰。改为把当前展示的 `rel.deckLayer` 也算作相关层，且只在 `rel.layers` 非空时生效——Emb / Norm / Head 这类端点选择 layers 是空的，该亮的是 `staticNodes` 里那几个静态节点，不能顺手把 L0 整张卡点亮。非播放路径下 `deckLayer` 一律取自 `rel.layers`，这条代理是无操作。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: 修数据流播放的两处观感问题。① 整网一直闪：`applyRelation` 对 deck 的两个写入原先无条件执行，而 `setFrontLayer` 内部要遍历全部 46 张层卡、逐张重置专家池（`replaceChildren` + 四条内联几何）再重算边线，正视图换卡还是一次 `display:none→block` 的整卡重绘——值没变也照写，画面上就是每 190ms 白闪一下。改为幂等去重（缓存 `deckFrontLayer` / `deckNodeKey`，deck 重建时作废；换卡时强制重标节点，因为同名节点要在新卡里重新找）。更关键的是播放时**不再逐层换卡**：正视图下 44 个 MoE 层是同一张卡的 44 份副本（除层号外一模一样），逐层换等于纯闪烁；现在同一段（同一结构列 + 同一 PP stage）内的层共用该段首层那张卡，deck 只在 Emb→Dense→MoE→Norm→Head 与 PP 边界换——实测 49 步只换 6 次卡（emb→L0、L2、L12、L24、L35、norm→L45），段内"流到第几层"仍由 Layer 导航 / 典型层 / MoE / Cluster 逐层表达。② Layer 导航残影：`.cro-tick` 等元素带 120~140ms 的高亮过渡，那是为"手点一下"设计的，190ms 一步时上一格还在往回淡、下一格已经填上，两格同时亮着。播放期间给 `.cro-board` 挂 `.is-flowing`，把四域高亮元素的 transition 关成 `none`，一步一格瞬时切换，停播恢复。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: 新增"播放数据流"——Layer 导航标题行最右一枚播放键（默认不播），按下后按一个 step 的前向顺序 Emb → L0…L45 → Final Norm → LM Head 逐格点亮（49 步 × 190ms ≈ 9.3s），每亮一格，整网 deck / 典型层 / MoE / Cluster 跟着亮同一套关系集。不新造渲染：复用 `applyRelation` 的四域铺色，新增 `quiet` 形参跳过 `revealIn` 与 `redrawLinks`——平滑滚动按 190ms 重放永远稳定不下来还抢用户滚动条，而 `collectAnchors`+整层 SVG 重建是单步里最贵的一项（比全部 class 切换加起来还贵），播放本也不需要连线。性能上：步序与 49 份关系集在开播时一次性解出（`navModel().slots` 就是刻度带从左到右的真实顺序；实测预解析 5.9ms/49 步），播放中每 tick 只做 class 切换（单 DP 口径下约 64 个 rank 格 + 320 个 MoE 元素 + 49 刻度，个位数毫秒）；用 rAF 打拍而非 setInterval，标签页转后台自动停摆。层步过 `scopeLayerPayload`，亮出的 rank 范围与手点该层完全一致。停播时机：用户任何一次 `emitSelect`、配置变更（预解的步是旧拓扑的）、播完一趟；停播后把播放前的 `relation` 原样铺回去（连线随之恢复）。播放键已加进 `SELECTABLE` 白名单，否则点它会被当成点空白清掉当前选中。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: 修两个 bug。① Cluster 撑爆版面压到 Model Architecture 上：`.cro-board` 第 2 行原是 `auto`，rank 一多（行数 = dp×tp×cp）它就按内容一路长高、把 `1fr` 那行挤到 0，而刻度带/典型层有固定高度，格子没了照画不误，于是溢出成"重叠"。改为 `grid-template-rows: minmax(260px, 1fr) fit-content(46%)`——内容少时照旧按内容高，超过板面 46% 封顶，多出来的由 `.cro-cluster__grid`（新增 `overflow-y:auto` + `min-height:0`，`.cro-cluster` 同步 `align-items: stretch`，否则子项保持内容高度照样溢出）在区域内滚；第 1 行给 260px 下限杜绝被压没。连带：连线锚点的夹取宿主从 `#croHeat` 换成滚动视口 `.cro-cluster__grid`（`collectAnchors` 与 `clusterStageAnchors` 两处），否则矩阵内部滚动时锚点会落到可视区外；`applyRelation` 的"选中项滚进可视区"补上集群矩阵一路。② 选中层后再调 TP，高亮消失但连线还在：`controller.onChange` 里四域整块重建，选中/关联的 class 挂在旧 DOM 上跟着没了，而连线画在独立 overlay 上不受影响。新增 `reapplySelection(topology)`——按新 topology 重解析同一个选择再铺（关系集本来就是配置的函数，调完 TP 旧连线指向的已是另一批卡，光补高亮也不对）；选中对象在新配置里不存在了（层数/卡数/专家数调小）就整体清空；`expert`/`epRank` 的归属是 (routedExpert, ep) 的函数，重解析前先按新拓扑重算，否则拿旧 epRank 点亮的是别的组。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: 悬浮提示统一换成一枚 body 级气泡 `.cro-tip`（`installTipLayer()`，position:fixed + document 事件委托，谁带 `data-tip` 就给谁弹）。解决两处：① Layer 刻度原先用原生 `title`，要按住 ~1s 才弹，而刻度只有 3~4px 宽、悬浮查层号正是这条带子的主要用法，等不起——改成 60ms（只压快速划过的连闪）；② 集群格子的气泡原先是 `training-run-twin.css` 里画在格子内部的 `.twin-heat-cell::after`，被 `.cro-heat` 的滚动裁剪切掉，边缘一圈 rank 只看得到半个，现在气泡在 body 上、位置按目标 rect 现算并夹在视口内（上方装不下自动翻到下方），与祖先 overflow 无关；该伪元素在本页 `content: none` 关掉，避免一次弹两个。同批把 MoE 侧同样"小目标 + 滚动容器"的 `title`（EP 组、路由专家点、共享专家 chip）和构成条分段的 title 一并改走 `data-tip`。焦点态只认 `:focus-visible`，否则鼠标点击后气泡会立刻弹回来挡住刚选中的目标；`cro:change`（配置重建）与 scroll/resize 时主动收掉。`.cro-structure__name` 的 title 保留原生——那只是名字截断时看全称。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: TP≥2 时集群图的关系高亮改成按 TP 分片分档的"斑马纹"。原先被点亮的 rank 全是同一种白描边，读不出谁拿第 1 份、谁拿第 2 份权重。分片归属取自编址最内维：`inner = cpIdx·tp + tpIdx`，即同一 TP 组的 tp 张卡全局编号连号、优先同节点（TP 每层前反向各 all-reduce 一次激活，是通信最密的一维，必须吃机内互联；Megatron 系的 tp-cp-ep-dp-pp 序同此），故分片号 `tpIdx = inner % tp`；而 `inner` 正是集群图 DP 组内的行序，每 tp 行走完一轮，明暗按行铺开天然成横向条带。渲染侧逐格写 `data-tp-shard` 与 `--cro-tp-fade`，CSS 把 `.twin-heat-cell.is-related` 的描边改成 `color-mix(in srgb, #fff var(--cro-tp-fade,100%), transparent)`。亮度是**间隔**而非渐变的（偶数份 100%、奇数份 50%/40% 交替）：单调递减的斜坡在整片格子上会糊成一团渐变，读不出"一份一份"的边界，明暗交替才切得出条带；最暗一档仍亮于 45% 的静息中性灰描边。格子提示同步补 `TP 分片 k/tp（持有该层权重的 1/tp）` 与 CP 序号，连线卡片第二行补「明暗相间，每一条 = 一份」的读法。tp=1 时不写变量、观感与改动前一致。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: TP≥2 时，点某一层后「层 ↔ 集群」那条连线的卡片补第二行口径说明：`高亮的 rank 实际有 N 个组，每组下的一个 rank 分得这一层权重的 1/N 份`。原先只有 `Node … · N 卡`，容易把卡数读成"每张卡各存一份完整层权重"，而 TP 把这一层的权重切成 tp 份、高亮的 rank 按切片归成 tp 个组。连线标签因此支持多行：`appendLinkLabel` 接受字符串或字符串数组，多行以锚点为竖直中心按 16px 行距排 tspan，第二行起挂 `.cro-link-label__sub`（`--foreground-secondary` + 11px）弱化为补充说明。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.*`: 放大运行事件面板右上角的收起箭头。按钮 24 → 28px、图标框 18 → 22px 只解决一半——问题在于标准 chevron（`m15 18-6-6 6-6`）在 24 的视口里只占中间 12 格，等于图标框永远只用得上一半，放到 22px 也才 11px 高；故把路径改画成 16 格高（`m16 20-8-8 8-8`），字形吃满图标框。这枚是面板级收起键、紧挨着「运行事件」标题，用默认尺寸显得没分量。

- 2026-08-06 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: 重做事件详情里的构成条（问题1.2「单 step 12.0 s 的耗时构成」、问题1.3「64 GB 显存峰值的构成」），参照 `pto-swimlane-profiler` inspector 的 `.sl-meter` + `.sl-kv`。① `chartStack` 从 SVG 换成 DOM：一条 14px 的 pill 轨道（`--surface-3` 打底），各段并排铺满不留缝，段间只用一道底色内阴影分隔，圆角只出现在轨道两端——原先每段各带 rx:3 又留 2px 缝，读起来像几粒散落的胶囊而非一个总量的构成。② 斜纹改画法：原先是 45°、7px 节距、`--foreground` 55% 的 2.5px 粗线压在红底上，明暗对比过强，纹理抢过了颜色本身；现改为 135°、3px/6px 细节距、**同色两档透明度**（88% / 30%）的 `repeating-linear-gradient`，与 swimlane 标 blocked interval 同一画法，纹理只表达"这截是多出来的"。③ 图例按 `.sl-kv` 排：细分隔线分行；斜纹那截单独占一行（缩进、纹样即图例键、给出超出量与超出百分点），此前条上多出来的纹理没有任何图例解释。构成条不再吃高度预算（`paintDetailChart` 的 stack 分支注释同步更新）。

- 2026-08-06 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: ① 训练级泳道默认展开 Rank 0 与 Rank 1（原先只展开 Rank 0，`collapsed: !(h === 0 && r === 0)` → `collapsed: rankId > 1`）—— 只展开一条时看不出 rank 之间的关系，而"谁在等谁"恰恰要至少两条泳道并排才读得出来（一条算完了、另一条还在算，中间那截就是空等）。② 右侧面板标题按勾选数切换：未勾对比对象时为「差异总览 · 单任务内快慢卡」，勾了对比对象时为「差异总览 · 多任务间对比」，`#inspTitle` 的静态初始值同步改为单任务态文案，避免首帧闪一下泛用标题。返回按钮与顶栏开关仍用泛称「差异总览」，它们指的是面板本身而非当前内容。

- 2026-08-06 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 差异总览最顶部新增「差异健康度」卡 —— 此前用户要把总差值、Top3 集中度、空等占比、慢卡一致性几个读数各自换算再横向权衡，才能回答最朴素的那个问题"差异大不大、健康吗"；这张卡把权衡替用户做掉，先给结论（等级 + 一句话），支撑读数降为下面的备查项。**评级体系与配色沿用 index_v3 总览页 PHS 仪表盘**（`app.js` 的 `gradeToColor` 深色阶 + `gradeColorAt` 渐变 stops），档位换成 6 级 A+/A/B+/B/C+/C（≥90/75/60/45/30/其余），同一产品里"绿=好红=差"的色阶不能有两套。① **跨任务 A/B**：主信号是总差值方向与幅度（基准 60 分=无显著变化，变快加分变慢扣分），修正项是差异集中度——同样是变慢，集中在 2~3 条上的可以直接去修，摊在几十条上的连从哪下手都不知道；三方对比无单一方向，改评"三者一致性"。② **任务内多卡**：主信号是空等占 step 的比例（设备什么都没干、纯被同步点拖住的时间），存在系统性慢卡再扣 8 分。③ 视觉上不复刻半环仪表盘：右栏仅 ~300px 宽，改用大等级徽标 + 分数 + 6 档渐变刻度条 + 指针，位置编码与色阶都保留，读数更省空间。

- 2026-08-06 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 修差异显著性判据的两处统计错误（做健康度卡时暴露：所有 A/B 对比都被判成"无显著变化"）。① `runStepStats` 的 CV **改为按 rank 分组后取各 rank 的中位数**。原先把所有 rank 的所有 step 混在一个数组里算，会把"慢卡造成的 rank 间系统性差异"也算进噪声——那不是噪声，正是要被检出的结论。② `diffNoiseBandPct` 改用**均值的标准误**：判定的是两组 step 均值之差是否显著，分母应是 σ/√n 而非单次观测的 σ，用后者会把带宽撑大 √n 倍，导致采样越多反而越迟钝，与统计直觉相反；两侧各有一份误差故再乘 √2，取 2 倍标准误作 ~95% 置信近似，夹在 [1.5%, 25%]。③ 生成器默认 `steps` 4 → 12（`pangu-ffn-a5-g2` 形态 5 → 15）：n=4 时标准误几乎和单步抖动一样大，10% 以内的真实差异根本分辨不出来，真实 profiling 也不会只采 4 步。修正后 baseline→tuned 判为 A+ 95（变快 11.3%）、反向判为 C 22（变慢 12.7%）、baseline→regress 判为 B+ 62（4.2% 落在 ±8.2% 带内），评级恢复区分度。

- 2026-08-06 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 单任务态的三处交互修补。① 只勾一条记录时**收起底部泳道栏**：`showBottomPlaceholder()` 从"往底栏塞一块「请勾选对比数据」占位"改为直接 `hidden` 该栏、并把上方的拖拽分隔条一并收起（否则会留一条没有下文的把手），上方泳道随之占满高度；`openRunComparison()` 里补上恢复分隔条的对称操作。② 多卡视图的「rank 间 step 离散度」「step 中位」「最晚进入通信」各加**问号说明气泡**——离散度那条尤其需要解释：它接近 0 并不等于没有慢卡，集合通信是同步点会把所有卡拉到同一 step 时长，真正的信号在「最晚进入通信」。气泡挂 `body` 末尾 + `position:fixed`，跳出 pane 那层带 `backdrop-filter` 的层叠上下文（同「视图说明」气泡的处理）。③ rank 卡片补**选中态** `.sl-rank-row.is-active`（选中底 + accent 描边，与差异卡片 `.sl-diff-card.is-active` 同一套观感；慢卡态占用的是 inset shadow，故选中态改用 border 避免互相覆盖），并支持再点一次取消选中（新增 `clearDiffLaneSelection()` 撤销高亮/暗化）与 Enter/Space 键盘操作。

- 2026-08-06 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 去掉「跨任务 A/B / 任务内多卡」视角页签，改由**勾选状态直接决定内容** —— 只勾基线一条时右栏给多卡慢卡定位（原本这里是「请勾选对比数据」的空占位），勾了两条及以上给跨任务 A/B 差异。勾选状态已经把用户意图表达清楚了，再加一个视角开关是让用户重复表达一次。随之删除 `state.compareScope`、`COMPARE_SCOPES`、`compareScopeTabsHtml()`、`.sl-scope-tabs` 样式与对应事件绑定。右栏标题固定为「差异总览」（原先随模式在「差异看板/慢卡定位」间切换），同步改掉 `#inspTitle` 初始值、返回按钮与顶栏开关的 title/aria-label。多卡视图的说明行补一句"勾选第二条记录即切换为跨任务 A/B 差异"，让状态切换可预期。注：底部泳道栏无对比数据时的「请勾选对比数据」占位保留——那是另一回事（没有第二条 run 就没有下栏泳道可画）。

- 2026-08-05 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 对比页第 4 步——双流程分叉、慢卡定位、归一化与噪声带。① **泳道生成器重构为「step 外循环 + 跨 rank 同步点」**：改造前每个 rank 各自独立推进时间轴、谁也不等谁，与真实训练相反（集合通信是同步点，最晚进入的卡决定所有卡的通信起始）。现先算出各 rank 本步的计算结束时刻，取最大值为同步点，给每个 rank 补一段 `[自己算完, 同步点]` 的 **`Communication(Wait)` 空等泳道**（告警红，与"真在传输"的青/橙拉开）——没有这个模型，wait 拆分和慢卡定位都无从谈起。慢卡由 `run.id` 决定（可能没有）。② 同步修正生成器一处失真：计算量基数改为**每步共享**、rank 间只差系统性 bias 与小抖动。原先每 rank 独立取 ±30% 随机基数，纯抖动盖过慢卡偏置，导致每步最晚的都是随机一张卡。③ **对比视角切换**（跨任务 A/B | 任务内多卡）：两条流程的第一屏本就不同，A/B 问"赚了还是亏了"，多卡问"谁在拖后腿、是真慢还是在等"，此前共用同一套「按任务/按泳道」UI 会把多卡用户引向错误方向。多卡视角用基线 run 自身的 rank 数据，不需要勾选对比记录。④ **慢卡判定两个条件缺一不可**：跨 step 一致性（某 rank 在 ≥60% 的 step 里最晚进入通信）+ 显著性（进入时刻极差 ≥ step 中位的 5%）。只看平均值必然能挑出一个"最晚"的 rank，那是抖动不是慢卡；实测 5 个 run 的判定与生成器真值全部一致。⑤ 差异看板新增**「按 Rank」页签**——「按泳道」是跨 rank 汇总，恰好抹平了 rank 间差异，多卡场景要的是反方向。⑥ **busy 时长归一到「每 step 平均」**（`laneBusyStats` 除以 `built.steps`）：不同 run 的采集步数可能不同，直接比整条时间轴的 busy 总和，比的是"采了多少步"而非"每步多慢"。⑦ **噪声带挂到基线 run 自身抖动**：新增 `runStepStats()` 从 OVL 泳道反算各 rank 各 step 时长与 CV，`diffNoiseBandPct()` 取 CV×1.5 夹在 [3%,25%]；相对幅度低于该带宽的卡片置灰、打「噪声带内」标并排除出「显著差异」计数——原先固定 10% 阈值与 run 自身抖动无关，会把噪声计成差异。⑧ **删除假仪表盘**：`computeRunPhs` 的分数是 `run.id` 哈希出来的、"优化后预估可达"更无依据，却占着对比页最贵的视觉位置；连同 `renderCompareGauge` 等 6 个函数与 73 行 CSS 一并移除，换成 `compositionCompareHtml()` —— 各 run 的每 step 时间构成条（计算/未掩盖通信/空等/空泡），按总时长等比缩放并列，直接看出"多出来的时间落在哪一类"。⑨ 新增 `trainBuilt()` / `runStepStats()` 的按 run 缓存：四个消费方共用同一份构造结果，避免重复消耗同一个随机序列。

- 2026-08-05 `Profiling_Insight_and_Tool/AI_Profiling_Tool/index_v3.html` + `app.js`: 新增「算子」页签（规则 11），补上此前最大的断层——第 3 章问题详情写着"算子视图 — 载入 kernel_details.csv 按 Duration 倒序"，把读者支使到外部 MindStudio 去看证据，工具自己却不提供这张表。① **分类汇总**：按 `口径`（core/phase）分组的横条，宽度按总耗时归一，配色与总览构成条 / Timeline 图例同源。② **算子 Top-N 表**：默认按总耗时（非单次）降序，表头可点换排序列，带搜索框过滤算子名/Type/Core Type；`OP State=dynamic` 标警告色。③ **与「关键问题」双向联动**——这是相对 MindStudio 的差异化所在：表里哪几行已经被诊断成问题。Top-N 每行匹配行动清单，命中的打「P0 · 已诊断」徽标、点击回总览并选中该问题；问题详情的「影响」块下方给反向入口「在算子表中查看 N 个相关算子」，点击切到算子页签并按算子名过滤。④ 匹配采用**两级候选**：tier1 用具体串（全名 / 首段 / 去掉首段的剩余 / 长度 ≥5 的中间段，如 `MatMulV2_lm_head` → `lm_head`），tier1 全落空才回退 tier2 的泛化 Type。不分级时 `MatMul` 会把 lm_head 投影错配到 MoE 路由问题上——两者都是 MatMul，但报告里点名 lm_head 的是另一条 P0。匹配前两侧做归一（小写 + 去非字母数字），使报告里的 `all-to-all` 能对上算子名里的 `alltoall`。⑤ 报告未出表时页签置灰（同「计算图」页签的处理）。

- 2026-08-05 `Profiling_Insight_and_Tool/AI_Profiling_Tool/app.js`: 给「Pangu 2.0 flash 72B 多机多卡训练性能诊断报告」记录补规则 9/10/11 四张表的**构造数据**（该记录专供 UI 验证，非实测），让新看板分区可见。数字沿用本报告已有口径保持自洽：单步 16.20 s、`op_utilization` 58% → 计算 9.40 s、`pp_bubble_ratio` 26.3% → 空泡 4.26 s、overlap=0 → 通信 2.05 s 全暴露、Host 下发 494 ms，四项闭合到 16.20 s。`rankStats` 按规则 10 列 32 卡的代表行（stage0–3 各取首尾），刻意构造成「各 rank step 耗时几乎相同（极差 0.12%）、只看 step 时长找不出问题卡」，真正的信号在 stage3 计算 12.70 s / 通信等待 0.08 s 与 stage0–2 计算 8.29 s / 空等 4.26 s 的拆分，以及「首次通信进入」12.72 s vs 8.31 s —— 正是慢卡定位不能只看通信总耗时的那个场景。另补 `opStats`（分类汇总 4 行 + Top 10）备第 3 步算子页签消费。顺带修 `renderTrustBar`：`step_cv` 改与指标卡走同一展示口径（`display` 优先，阈值判断也从展示值取数），此前该记录的 `value` 存的是小数 0.0002、口径条会显示成 `0.0002%` 且阈值比错。

- 2026-08-05 `Profiling_Insight_and_Tool/AI_Profiling_Tool/index_v3.html` + `app.js`: 总览「指标看板」从 12 张同权重卡片平铺 + 让用户自己挑 4 个显示，重构为四段分区，每段回答一个问题。① **结果层**（`#metricResultZone`，规则 9.1）—— 单步耗时中位/P90、吞吐、端到端时长四张绝对量卡，由 `renderResultBoard()` 按 `r.results` 动态生成；**不做阈值着色**，810 ms 是快是慢取决于模型与集群规模，没有普适健康区间。此前看板 12 张全是比率，答不了"这次跑多久、多快"，而这些数字只以自然语言躺在结论文案里。② **可信层**口径条（`#metricTrustBar`）—— step CV / 有效 step / warmup / 采集档位贴在结果卡片下方作脚注；CV > 10% 时整条加 `.is-shaky` 并显式告警"以下比率类指标基于抖动区间，仅供参考"。`step_cv` 原先排在第 6 张、默认隐藏，但它决定其余所有数字能不能信，不该与其他指标平级。③ **构成层**（`#metricBreakdownZone`，规则 9.2）—— 计算/通信未掩盖/调度空泡/Host 下发的闭合堆叠条，色板与 Timeline 页签泳道图例同源（同一语义跨页签不能两种颜色）；与单步耗时偏差 >2% 时在标题行标注"未闭合"。④ **结构层**（原 `#metricBoard`）—— 保留 12 张比率卡并新增「Rank 间 step 离散度」卡（`rank_spread`，由 `injectRankMetric()` 从 `r.rankStats` 派生，状态行给出慢卡及其判定来源）；`METRIC_BOARD_DEFAULT` 从 `critical_path_ratio/op_utilization/mfu/mem_util` 改为 `critical_path_ratio/op_utilization/overlap_ratio/rank_spread` —— MFU 与显存利用率的分母（芯片峰值算力 / HBM 容量）落盘数据里没有、要用户下拉手选，分母靠猜的指标不该占首屏前排，仍可从「编辑」调出。⑤ 「编辑」按钮与面板从 section 标题行移到结构层标题行 `.ovm-struct-head`（面板锚点随之改为该行，`top` 调至 38px），作用域从"整个看板"收窄为"结构指标区"，与实际行为一致。⑥ 结果层/构成层无数据时**整块隐藏**而非摆一排"暂无数据"，故未按新规范出表的旧报告视觉不变。⑦ 结构层阈值改为按 `taskType` 取（`METRIC_WARN_BY_TASK`）：推理诊断 / RL 训练场景的 `op_utilization` 与 `host_launch_gap_ratio` 用各自区间，原先全局硬编码在 `data-warn` 上会让这两类场景天天误报。⑧ 三类悬浮提示（`.ovm-info` / `.ovm-status` / `.ovm-name`）从加载时逐元素 `addEventListener` 改为 document 事件委托 —— 结果层卡片是动态生成的，原绑定挂不上；`cardName()` 顺带补 null 保护。⑨ 修 `parseRankStats` 中位数：偶数个 rank（8/16/32 卡才是常态）原先直接取上侧值，会把中位抬高、离散度算偏，改为中间两值平均。

- 2026-08-05 `Profiling_Insight_and_Tool/AI_Profiling_Tool/AscendProfKit/skills/profiling-workflow/SKILL.md` + `app.js`: 报告契约补三条规则，作为「总览结果层/构成层」「算子页签」「慢卡定位」的数据地基（此前这些数字只以自然语言躺在结论文案里，无法结构化消费）。① **规则 9** 结果指标表（`step_time_median`/`step_time_p90`/`throughput`/`e2e_duration`/`active_steps`/`warmup_steps`/`profiling_level`）+ step 时间构成表（`compute`/`comm_exposed`/`bubble`/`host_launch`/`other`，硬性要求闭合到单步耗时、偏差 >2% 须显式补「其他」行）；warmup 与 profiling 档位两行不得省略，禁止用单 step 数字。② **规则 10** Rank 级 step 统计表，硬性要求「通信等待」与「通信(未掩盖)」分列 —— 集合通信的结束时间天然对齐，合并成一个数则所有卡看起来一样慢，慢卡信号丢失；可选列「首次通信进入」是真凶信号。③ **规则 11** 算子分类汇总 + Top-N，硬性要求按总耗时（非单次）降序、`次数` 列必填（A/B 对比里"单次变快但调用次数翻倍"是最常见的负优化）。④ `app.js` 新增通用表格解析层 `normLabel`/`sliceReportSection`/`parseMdTable`/`cellNum`/`cellMs`/`cellUs`/`headerIndexer`（中英文括号与全半角先归一，时长按 us/ms/s 后缀统一归一到 ms），及 `parseResultMetrics`/`parseStepBreakdown`/`parseRankStats`/`parseOpStats` 四个解析器，落到 `r.results`/`r.breakdown`/`r.rankStats`/`r.opStats`；`parseRankStats` 顺带派生离散度与慢卡（优先取报告 `判定=slow`，缺判定时回退「最晚进入通信」的 rank），`parseOpStats` 对报告写错的排序做兜底重排。四表均为可选，缺表返回 null、前端保持空占位。

- 2026-08-05 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 差异看板的度量与排序口径修正。① 卡片排序从「相对幅度 `(max−min)/max`」改为**绝对差值 ms** —— 相对幅度会让 0.2ms vs 0.1ms 的小泳道以 50% 霸榜、压住真正贡献耗时的大泳道；进度条同步改按绝对差值归一（原按百分比，等价于给小泳道满格）。`laneDiffCardOf` 与 `computeLaneAggregatedDiffCards` 新增 `absDiffUs` / `signedDiffUs`。② 卡片主数值改为**有符号差值**（`+12.40 ms` 红=变慢 / `−8.10 ms` 绿=变快，三方对比无单一方向则显示极差 `Δ`），相对幅度降级为其后的小字副标 —— 此前 `direction` 已算出但从不渲染，"变慢 30%"与"变快 30%"在界面上完全同形。③ 新增总账条 `diffLedgerHtml()`：总 busy 时长 A→B、总差值（含方向与百分比）、Top 3 贡献及其占差异绝对值之和的比例，置于「差异任务/差异泳道」计数之上，补上此前完全缺失的漏斗第一层。④ 两方对比的 values 行从单行 ms 改为与三方一致的多行渲染，带 `×次数` 与「无任务条」；一侧无任务条时在标题行打「新增/消失」标记 —— 融合把 N 条变 1 条是 A/B 验证的核心证据，此前两方对比根本不显示条数。

- 2026-08-05 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.html`: 运行事件从「在四域上描红/橙」改为独立的上中下事件详情页。已发生的事件里，配置表单不可调、四域「点一个对象看它理论上牵连谁」的静态查询口径也不成立（范围由本次采样写死），两块都是死内容 → 选中事件时 `.cro-board` 整块隐藏，换成 `#croIncidentView`；关横幅 / Esc / 收起事件栏切回配置仿真态。① **上**＝事件关系横幅（沿用原样式，红字换成 `问题N.M` 事件编号）。② **中**＝一块编排画布 `.cro-incident-stage`：传播源 / 连线 / 受影响是同一张图上的三个部位，不是三个带滚动条的容器。按 `origin`/`victim` 触及的域（Model Architecture / MoE / Cluster）用**同一批渲染器原样重建**那几个域（各域内部 overflow 一律解除，全量铺开），命中对象按角色色 `.is-hit` 点亮、其余压暗，整块只读（`pointer-events` + `tabindex=-1`）。视口只做取景：进场按屏幕自动适配、滚轮以指针为锚缩放、拖拽平移，右下角 −/读数/+/适配 控件（带投影）。两端用红→黄渐变贝塞尔连接（`userSpaceOnUse` 渐变按实际端点建），起点圆点、落点箭头，命中面 >24 时接到整个域并虚线圈出范围；描边 1.25 + `non-scaling-stroke`，与配置态的 `.cro-link` 同规格。路径标签（`event.path` 拆出的链路 + `propagation` 途经范围）绝对定位在两栏之间的空当里、避开连线上下方。③ **下**＝「问题详情」：左证据图、右「一句结论 + 关键读数」。④ 新增 11 个事件的 `evidence`（line / bars / stack 三种自绘 SVG 图 + 读数）。图按宿主实测像素宽高出图（`viewBox` 宽 = CSS 宽，缩放比恒为 1），并吃高度预算：折线压扁、堆叠条变细、横条条目 >6 自动转竖排柱 —— 小屏下这一栏不出滚动条。取色只用设计系统 token（`--primary` 常规量、第二分类色取 deck 紫，`--warning`/`--danger` 专留问题段），跑过 CVD 校验（deck 的 comm 青与 `--primary` 常视觉 ΔE 仅 11，故弃用）；量纲不同的第二指标进读数区，不叠双轴。参照 `AI_Profiling_Tool/memory-analysis.js` 的显存曲线补面积填充 + 虚线警戒线 + 越线标红（`clipPath` 切出越线段重画，非另一条数据），阈值支持 `direction:"below"`（loss scale 是跌破为坏）；堆叠条支持 `limitShare`，超出参考水位的部分同色叠 45° 斜纹。⑤ 整网 deck **不进**事件详情：本页 deck 是正视图、非 front 层 `display:none`，事件模式下只画一层，而结构条每根 `.cro-bar` 本就挂着同名 `deckNode` 且同色，算子集合完全重合；会显示它的 7 个事件里 6 个是同一个 L38 MoE 层，对「在看哪个事件」贡献接近 0。改由结构条承担层内算子视图，`focus` 指向具体算子时（目前只有 p1-root 的 Router gate）单独点亮那根条。⑥ 随之下线：`paintIncidentRoles` 的四域角色描边、`roleSelectors`、`#croRootTag` 传播源浮标及对应 CSS；事件模式下关系连线 overlay 直接清空（四域隐藏后没有可连的锚点，否则 scroll/resize 会把线画到 0×0 元素上）。⑦ 两个坑：`layoutLayerNav` 用 `getBoundingClientRect` 实测后回写 px，读数会被 `transform` 缩放污染，故在 `fit()` 里 transform 归零的窗口重排一次；深色主题的 `--surface-*` 全是半透明叠加，画布点阵会从背板透出来，故给画布内的背板垫不透明底并锁掉悬浮态。⑧ 集群矩阵样式从 `#croHeat` 改挂 `.cro-heat` 类（画布里要再开若干份），deck 语义色变量同步写到 `.cro-incident-view`。

- 2026-08-03 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: 聚光灯故事线 → 关系观测器的深链接打通。① `training-spotlight.js` 给每个故事步骤加 `eventId`，callout 底部新增「查看事件影响范围」按钮，点击跳转 `config-relation-observer.html?event=<id>` 并在目标页 `requestAnimationFrame` 里优先选中该事件（查不到时回退默认首个事件）。② 「制品」页签的 ckpt 列表从单行 name+loss 换成表格（`js/training-run-twin.js`），补齐 step / epoch / 保存时间 / 大小 / 并行分片(TP4×PP8×CP2=64 分片) / 存储路径 / 校验 / 下载列，并区分「最新」「最佳」两个独立标签；`css/training-run-twin.css` 新增 `.twin-artifacts-table`，`training-monitoring-v2.html` 里 dock 面板的 760px 限宽规则排除 `.twin-artifacts`（表格需要铺满宽度）。

- 2026-08-03 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 聚合视图新增「视图说明」入口，解释跨 run 任务条配对依据——应落在算子在计算图上的身份（node id / 结构指纹）而非时间轴先后顺序；配对不上时应留空而非画错线。气泡挂在 `body` 末尾、`position: fixed` + JS 按钮坐标现算，跳出 `.pto-ide-frame__pane` 系带 `backdrop-filter` 开的层叠上下文（否则再高的 z-index 也会被 pane-body 里的画布盖住）。

- 2026-08-03 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.html`: 运行事件的红/橙两级关系高亮补全。① 修正 `p2-rise`（"显存从 55 GB 持续爬升"）的 `origin` 誤复用了同组 `p2-layer` 的单层 L38，与它自己的叙事（"PP stage 3 的激活常驻链"／"46 层激活常驻"）不符——改成覆盖 stage 3 的 L34–45。② `paintIncidentRoles()` 原来只画了 `event.origin`（红，"传播源"），`is-incident-propagation`/`is-incident-victim` 两个 class 只在清空态里出现过、从未真正绘制，是半成品；现在给全部 11 个事件补齐 `victim`（对照各自 `impact` 文案给出受影响范围最大的位置），并在 `paintIncidentRoles()` 里同步画出 `is-incident-victim`。③ `config-relation-observer.css` 新增橙色（`--warning`）描边规则：默认用 `outline`（与红色 `box-shadow` 不同属性，可同时叠加显示两圈），紧邻无缝排布的 `.cro-tick` 例外，改用内嵌 `box-shadow` 避免外扩描边连到邻格。移除不再使用的 `is-incident-propagation` 引用。 `Profiling_Insight_and_Tool/AI_Profiling_Tool/`: 整网图问题标签改小改准 —— 两行胶囊(问题号 + 问题名)收成单行只放「问题N」，字号 12px→24px(翻倍)，并换成真正的节点避让。① 问题名与举证全部移进 hover 的 `<title>`，标签只剩问题号，因此胶囊足够小、可以在节点四周挑位置。② `drawOpvProblemBadge()` 的避让从「节点局部坐标里跟同 anchor 的标签比」升级为「全局坐标里跟全图所有节点比」：新增 `opvGroupOffset()`(节点 group 带 translate、cluster group 不带，统一解析出平移量)、`opvNodeBox()`、`opvCollectNodeBoxes()`，候选位置依次试右侧居中/左侧居中/上方左对齐/下方左对齐/上方右对齐/下方右对齐，取第一个不与任何别的节点(4px 余量)及已放置标签相交的，六个都撞才退回正上方——这样标签不再压住邻近节点的文字。cluster 是大框、内部本来就要放东西，不参与避让。③ 胶囊宽度由 `getComputedTextLength()` 实测文字宽度决定(CJK/拉丁混排估不准)；整网图面板收起时 SVG 处于 display:none 量不到，补一条按字宽粗估的兜底(CJK 24px / 其余 13px)，并让 `window.msnextRefitGraph()`(面板开合时调用)顺带重跑一次标注，把宽度校回实测值。④ 删掉不再需要的 `opvTruncateSvgText()` 与 `.opv-problem-badge-title` 样式；文字改 `text-anchor: middle` 在胶囊里居中。

- 2026-07-31 `Profiling_Insight_and_Tool/AI_Profiling_Tool/`: 指标看板「显存利用率」卡触顶时状态行只写换算式（"占用 64 GB ÷ 910B1 (64GB)"），红了却没说为什么危险 → `app.js` 新增 `memUtilRiskNote()`，按 ≥99 / ≥95 / ≥85 三档在换算式后追加剩余显存与处置建议（重计算 / 调小 micro-batch / 调整 TP-PP 切分 / 查碎片率），并把 85–95% 一档补上 `ovm-warn` 着色（原先只有 ≥95% 的 `ovm-bad`）。`index_v3.html` 里 `.ovm-status` 的 2 行 clamp 在 warn/bad 态放宽到 4 行，bad 态状态行改用 `--danger`，否则新话术会被截断。

- 2026-07-31 `Profiling_Insight_and_Tool/`: Pangu 2.0 flash 72B 报告（记录列表第一条）补齐算子视图环形图。① 新增侧车 `Analysis Report/pangu2.0flash_profiling_analysis_20260715/chart-data.json`（`loadReportChartData` 自动并入，无需改 app.js/chart-data.js），给该报告 4 条「举证视图含算子视图」的问题各配一对环形图：#1 PP 末级过载 = stage3(rank24) 与 stage0(rank0) 计算算子耗时构成对照（lm_head MatMulV2 / loss 的 Exp·Sub 标红，一眼看出只在末级出现）；#6 动态 shape = 按 OP State 分组（计算算子 12.65 s 全部 dynamic vs 通信算子 8.71 s N/A）+ dynamic 算子按类型分组；#7 降频 = cube 算子按 aic_mac_ratio 分档（≥90% 占 8.10 s）+ 按加速核分组，用于佐证「MAC 流水吃得满、耗时拉长非算子实现问题」。以上数值均由本目录 `evidence/*/kernel_details.csv` 离线聚合得到。#4 MoGE 路由不均引用的 `rank16_s2_node3` 未随报告落盘（原先只渲染出一块空白图区），改为按报告 §3.4 的 router gate / expert FFN 统计构造示意分布（expert 27 占 group3 65% token、FFN 耗时 7×），`source` 字段已注明是构造而非落盘数据。② `app.js` 的 `renderOpPieCharts` 支持 curated 条目用 `charts: [{title, data, unit}]` 覆盖默认的「按算子类型 / 按加速核」两环，`unit: '%'` 时 tooltip 只显示百分比；未提供 `charts` 的条目（kernel_details.csv 运行时聚合）行为不变。

- 2026-07-31 `Profiling_Insight_and_Tool/AI_Profiling_Tool/`: 「智能修复预览」的主/次操作按钮改用设计系统 `.btn` —— 「新建分支并提交」原来是品牌蓝实底（`--primary`），换成 `.btn-solid`（高对比实底，PTO 的主操作规范），「修改到本分支」换成 `.btn` 次级样式；`styles.css` 里 `.ac-fr-btn-primary/-ghost` 两套自绘配色删除，只留一行 `padding-inline` 补长文案的横向留白。

- 2026-07-31 `Profiling_Insight_and_Tool/AI_Profiling_Tool/`: 整网图的问题标注从「只有红描边」补成「红描边 + 问题标签条」——光标红看不出哪个点对应哪条问题。① `app.js` 的 `OPV_GRAPH_PROBLEMS` 由「节点 → 问题」改成「问题 → 命中节点组」：每条问题带 `nodes`(全部标红)、`anchor`(缺省 nodes[0]，只有它画标签)、`actionId`、`title`、`desc`。② 新增 `drawOpvProblemBadge()`，在 anchor 节点正上方画两行胶囊：上行「问题N」下行问题标题，与节点等宽、左右边缘对齐节点，实心 P0 红/P1 橙底 + 白字（P2 黄底换深色字）。标签挂进节点 group，跟着画布平移缩放走。标题超宽用 `getComputedTextLength()` 逐字截断加省略号（SVG text 没有 text-overflow）。③ 序号取自「关键问题」列表：该列表渲染的是 `report.actions`，`actions[].id` 1..7 与 `issues[].id` "3.1".."3.7" 一一对应(见 `renderIssueDetail` 的 `+i.id.split(".")[1] === a.id`)，所以 badge 直接由 actionId 转中文数字；M.x 是显存专题、不在 actions 里，标签写 "问题 M.1"。点标签会选中列表里对应的那张 `.ic-card`(M.x 无卡不绑)，省得用户在图和列表之间自己对号入座。④ 避让盒按 group 分桶：包围盒是节点局部坐标，跨节点没有可比性，共用一个数组会把两个不同节点上的标签误判成重叠、无谓往上堆；真正要避让的是同一 anchor 挂多条(L4 折叠后 3.2 与 3.6 都落到 moe_ffn)。⑤ `index_v3.html` 补标签样式，其中底板 rect 要显式 `stroke:none; animation:none` —— 它和节点 rect 同处一个 group，会被 `.pto-model-graphviz-node.is-problem-p0 rect` 一并命中而长出一圈呼吸红边。当前 Pangu 报告标 5 条：问题一(3.1) lm_head/logits、问题二(3.2) routed_expert_bank/moe_combine、问题四(3.4) router_gate/route_topk、问题六(3.6) routed_expert_bank、M.1 decoder_layer。

- 2026-07-31 `Profiling_Insight_and_Tool/AI_Profiling_Tool/`: 整网图（openPangu `#opvHost`）补「算子染色关闭」与问题节点标红。① `vendor/opv-modelviz/js/opv-modelviz.js` 的 `currentLightColormap()` 把 `_opColorMode === "off"` 分支挪到「非 light 主题就 return undefined」之前——原顺序下暗色模式永远走不到 off 分支，「关」按钮点了没反应；暗色补一档 `{#64748b, sat .06, light .34}` 的扁平深灰（浅色沿用原 `#94a3b8`）。同步 `training-run-twin-standalone/js/opv-modelviz.js` 里早已修好的写法。② 染色默认改为「关」（`index_v3.html` 的 `window._opColorMode = "off"` + `segbtn on` 移到「关」）：整网图上要先看见红色问题点，类别底色会抢焦点，与 training-run-twin 进问题透镜时 `setOpColorMode("off")` 同一取舍。③ `app.js` 新增 `OPV_GRAPH_PROBLEMS` + `applyOpvProblemMarks()`：把当前选中报告 issues 中**有明确网络落点**的几条映射到 opv schema node id，打上与 Qwen2-7B 计算图同一套 `is-problem-p0/p1/p2`（红/橙/黄 + 呼吸描边），hover 出 `<title>` 回指问题编号。Pangu 报告映射 7 个点：lm_head/logits(3.1、M.1)、routed_expert_bank(3.2/3.4/3.6)、moe_combine(3.2)、router_gate/route_topk(3.4)、decoder_layer(M.1)；3.5 环境变量、3.7 降频、M.2 碎片属全局/硬件层面，网络图上没有对应点，刻意不标。整网图在染色/层级/主题切换时会整体重建 SVG，故除切报告时直接调用外还订阅组件广播的 `opv-graph-rendered` 补回标记；层级切到 L1–L4 时算子被折进上级模块，按 `rollup` 链（moe_ffn → ffn_choice → decoder_layer）上卷，多条并到同一落点时严重度取最高档，避免 P0 被后写的 P1 样式盖成橙色。④ `index_v3.html` 补 `#opvHost .opv-stage .is-problem-*` 描边样式（cluster 用 `rect:first-of-type` 而非 `:first-child`，因为标记会往 group 里插 `<title>`），并给 `prefers-reduced-motion` 关掉呼吸动画。`MindStudioNext.html` 里的同名旧实现未动。

- 2026-07-31 `Profiling_Insight_and_Tool/AI_Profiling_Tool/`: 问题详情「智能修复预览」里的两组页签统一到 PTO 设计系统。① 方案 A/B/C 页签由本地自绘的方框 tab（`--surface-2` 底 + `--primary` 描边 + inset 下划线）换成共享 `.tab-control` / `.tab-control-item` 胶囊槽，与中栏「性能总览/任务信息/…」主页签同一套视觉；`styles.css` 只保留换行（`flex-wrap`）、左对齐（`align-self`）与「推荐/示意」徽标的 `gap`，配色圆角全部交回 `css/style.css`。② diff 工具条的 Split/Inline 由实心 `--primary` 分段按钮换成同一套 `.tab-control`，按工具条高度做紧凑尺寸微调（26/22px、`--font-size-label-xs`）。③ 选中态改用设计系统的 `is-selected`，`app.js` 的 `frTab`/`frDiffView` 与初始渲染同时维护 `active`（模块状态位，JS 查询用）与 `is-selected`（DS 视觉），与页面既有 `.v2-center-tab` 的写法一致。`MindStudioNext.html` 内联的那份旧副本未改动。

- 2026-07-31 `Profiling_Insight_and_Tool/AI_Profiling_Tool/index_v3.html`: 整网图面板从最左侧移到最右侧，并补齐深浅主题适配。① `#netGraphPanel` 的 `<aside>` 在 DOM 里整块移到 `.pto-ide-frame__split` 之后（而不是用 flex `order` 视觉换位），阅读/Tab 顺序与视觉一致；它仍在 split 之外，三栏 grow/sizes 逻辑与「和分析记录互斥」的开合行为不变。② 间距重排：面板自带 `margin-right:8px` 接手原本由 split `padding-right` 承担的整框内缩，同时 `[data-netgraph-open="true"]` 时把 split 的 `padding-right` 清零，否则 8px padding 叠 7px gap 会裂出 15px 空隙。③ 顶栏开合按钮换成 lucide network 字形——原 panel-left 方框移到右边后语义反了，而 panel-right 方框已被紧邻的 inspector 占用，两枚同形按钮分不清。④ 主题适配：`.netgraph-view` 下 `.graph-left-pane` 与 `#opvHost/.opv-topbar/.opv-status/.pto-model-architecture-stage` 原本写死 `background:#fff`，暗色模式下是一块刺眼白板，改用随 `data-theme` 翻转的 `--bg-elevated`（light 仍是 #ffffff，dark 走 #16171b）；`.graph-map-btn.active` 写死的 `rgba(24,99,220,…)`（light `--primary`）改成 `color-mix(… var(--primary) …)`。vendor 的 opv-modelviz 本身已是 token 驱动，未改。⑤ 「点击左侧标红的算子节点」这类空态文案与箭头图标同步改成右侧（`index_v3.html` + `app.js`）。

- 2026-07-31 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: 智能对话消息区的滚动观感优化（`training-monitoring-v2.html` + `js/training-chat-panel.js`）。① 滚动条接入本页统一的「默认隐藏、悬浮容器才浮现」细滚动条体系（8px、圆角、`--border-default` → 悬浮 thumb `--foreground-muted`），不再是系统默认那条粗直的灰槽。② 消息区上下边缘加渐隐遮罩：`--wzh-chat-fade-top/bottom` 用 `@property` 注册成 `<length>` 才能被 transition 平滑插值（直接 transition `mask-image` 不生效），滚到中段时两端各淡出 28/32px，到顶/到底对应一侧收回 0，欢迎屏与最后一条消息不会被无谓压暗；类名由 JS 按滚动位置在 rAF 里合并计算。③ 追加消息由 `scrollTop = scrollHeight` 硬跳改为 `scrollTo({behavior:'smooth'})`；流式增量仍走瞬时对齐（平滑动画被每个 token 反复重启反而更顿），且只在用户本来就贴着底部（距底 ≤64px）时才跟随——往回翻历史时不再被拽回底部。④ 顺带给消息区加 `overscroll-behavior: contain`，滚到头不再把底层页面带着一起滚。

- 2026-07-31 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: 修掉「val 曲线根本没画出来」的老 bug —— `training-metrics-chart.js` 的 `buildPath` 遇到空点一律 `prev = null` 断线，而 val loss/acc 每 `ACC_EPOCH_STRIDE`(25) 个采样点才有一个值，于是每个点都成了孤立 `moveto`，一条线段都不画：图例有两条、图上只见一条。给 series 加 `connectNulls`（空点不断线，直接连到下一实测点），val loss/val acc 开启；原曲线与平滑曲线两条 path 都吃这个开关，其余序列行为不变（事故步 NaN 仍然断线）。顺带把 val 与 train 的泛化 gap 从「高 0.05、抖动 ±0.06」改成「高 0.18→0.30 随收敛拉开、抖动 ±0.03」——原参数下两条线一直缠在一起，即使画出来也分不开；val acc 由 `1 - vlBase/6` 派生，同步低 3~5 个百分点。

- 2026-07-31 `Profiling_Insight_and_Tool/training-run-twin-standalone/js/training-run-twin.js`: 折线配色由「一指标一色」收敛成两档 —— `LINE_1 = --twin-chart-gradnorm`（grad_norm 原来那支蓝紫 `#4F46E5`，第一条/唯一一条曲线）、`LINE_2 = --twin-chart-loss`（train loss 原来那支绿 `#04D793`，同图第二条曲线；与蓝紫互为对比色，双线卡一眼分得开）。覆盖精度栏 8 张卡（loss、acc、grad_norm、recall、z-loss、weight_diff、AMP loss scale、precision）、集群监控 2 张卡（MFU、显存利用率均为单线 → 蓝紫）、智能对话「调整图表」演示替换卡、问题一迭代层的「多卡 vs 单卡(正常)」叠加线（单卡线改绿）、问题六 HiF8/BF16 双线图（HiF8 蓝紫 / BF16 绿）与其 grad_norm 单线图。双线卡的 `emphasis`（第二条加粗）与右轴设定保持不变；事故点红虚线、异常带、参考线等语义色不属于这两档，未改动。图例色块读的是同一个 `colorVar`，自动跟随。`--twin-chart-loss/acc/precision/recall/f1/gradnorm/corr/weightdiff` 等旧变量暂留在 CSS 中未删。

- 2026-07-31 `Profiling_Insight_and_Tool/training-run-twin-standalone/js/training-run-twin.js`: 集群监控「显存利用率」卡退出精度栏的悬浮联动。`renderMetricChart` 原来给每张卡都挂 `onCursorHover/onCursorLeave` 把游标广播给 `accCards`，划过显存卡会把精度栏 6 张卡的气泡一起唤起来；现在改成按 `cfg.linkCursor !== false` 决定是否挂回调，`avg_mem` 卡标 `linkCursor: false`——它讲的是问题二那条独立的显存故事，与精度指标不同源。该卡自身的游标虚线与气泡照常显示，MFU 等其余卡联动不变。

- 2026-07-31 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: 精度/集群监控图表的悬浮气泡由「画在 SVG 里的 `<g>`」改成挂在 `<body>` 上的固定定位浮层（`.pto-tmchart-tip`，`js/training-metrics-chart.js` + `css/training-run-twin.css`）。① 卡片 `.twin-accuracy-metric-card` 是 `overflow:hidden`，窄卡上原来的 SVG 气泡会被裁掉半截；浮层脱离容器，不再截断。② 原来气泡宽度一超过绘图区就被 `bx` 夹到 `P.l`，鼠标怎么移它都钉在左边挡着曲线；现在按游标的屏幕 x 每次重算位置（右侧优先、右边放不下翻到左侧、只夹进视口不夹进绘图区），跟着鼠标左右走。y 仍锚定各图自己的绘图区顶部，联动时 6 张图的气泡各归各位。③ 浮层脱离容器裁切后，联动下发游标会让隐藏/滚出视口的图表也想摆气泡，故 `placeTip` 自查图表可见性，不可见就收起，避免页面上飘出没有对应图表的孤儿气泡；同一 host 反复 render 时认领上一次的浮层、`destroy()` 时移除，防止在 body 上堆孤儿节点。SVG 版气泡的三条样式类保留给 `js/training-monitoring-v2-deck.js` 的侧视层堆气泡继续复用。

- 2026-07-31 `Profiling_Insight_and_Tool/AI_Profiling_Tool/profileCompare.html`: 对比从固定两两扩到「基线 + 最多 2 个对比对象」。① 数据侧给训练泳道构造器加一层「形态」（`TRAIN_SHAPE_DEFAULT` / `TRAIN_RUN_SHAPES` / `trainShapeOf`），除时长倍率外还能改任务条条数与通信泳道构成；第三份数据 `pangu-ffn-a5-g2-20260701-211806` 登记为 5 个 step、每 step 8~10 条 Cube kernel（AI Core 任务条 120→178）、AIV 融合进 Cube（54→31，少任务条）、通信换成 `G3·alltoall` 且没有 `G2·p2p`（一多一少两条泳道），compute×0.88 / comm×1.35 / free×1.5。默认形态参数与改造前写死值逐字段一致，既有两两对比的数据一字未变（已用逐 JSON 比对校验）。② 聚合视图的 `buildAggregatedTrainingSwimlane` 改吃 run 数组，泳道树按 id 取并集（`mergeLaneTreeNodes`）——只按基线那棵树走会把第三份多出来的泳道整条吞掉；某个 run 没有的泳道在它那条子行上就是空行，正是「少了任务条」的直观呈现。叶子拆成 `§base`/`§compare`/`§compare2` 三条子行（`COMPARE_SLOTS`），叶子分组标签去掉 `(n)` 计数（那是某一个 run 的条数，聚合后会误导）。③ 跨栏连线 `drawTaskConnector` 改吃 specs 数组，相邻两行各画一对首尾曲线，三方就是 基线→对比A→对比B 接力；某个 run 缺同位任务条时跳过它、剩下的仍连起来。④ 差异卡片/看板全面 N 路化：差异幅度改成「最大值与最小值之差占最大值」，卡片三方时竖排逐 run 显示 busy 时长 + 任务条数（`×n`，缺失显示「无任务条」），仪表盘卡片三列（`.sl-compare-cards.is-triple`）。⑤ 下钻详情由「左右两列」改成逐槽位列（`compareSlotEvents` 统一解析聚合/分组两种模式下各 run 的同位任务条），缺失列显示「—」并在任务摘要里注明是哪一路缺；顺带修好聚合视图下详情右列恒为 0 的老问题——原先固定去 `trainRenderers.bottom` 拿事件，而聚合视图只有 top 一个实例、key 还带槽位后缀，必然取不到。⑥ 分组视图补第三栏：`swimlane-analysis` split 由 2 个 pane 扩到 3 个（`#blockGraphView2` / `#trainTimelineThird`，storage key 换成 `-v3-3pane` 免得读到旧的 2 长度尺寸），三栏时给 split 挂 `.is-stacked` —— split 组件给 pane 写的是内联 flex，所以 CSS 用 `flex:1 1 400px !important` + `min-height:400px !important`（内联还写着 `min-height:0`，不 `!important` 会被压到 0 就不滚了）把它从「按比例分高」切成「每栏最小 400px、装不下整块纵向滚」，分隔条隐藏。两栏时不加这个类，维持原来的 50/50。滚动/缩放/选中/分组折叠的跨栏同步由 top↔bottom 两两写死改成按 `TRAIN_PANEL_KEYS` 遍历所有在用的栏，连线同样按栏序串成 基线→对比A→对比B；堆叠模式下整块区域会滚，故给 split 也挂了 scroll 监听重画连线。⑦ 对比详情的「关联代码」补第三份 mock 源码 `MOCK_CODE_LINES_MOE`（`moe_ffn_alltoall.py`，改动点刻意挑在与 `MOCK_CODE_LINES_COMPARE` 完全不同的行号上，三份两两组合出的 diff hunk 分别是 4/8/10 段且落点各不相同），三方对比时两行文件名各变成一个下拉，可把任一侧换成第三个 run 的文件；菜单里**只列当前没在显示的那一个**（三个 run 已经摆了两个，可切换的就只剩一个，列三项让人从里面挑"正在看的那个"没有意义）。下拉是自绘的 popup 而非原生 `<select>`——后者的弹出列表由 UA 绘制，跟不了本页的深浅色 token（深色主题下弹出来是一片白）；配色一律走 `var(--surface-*)`/`var(--foreground-*)`。为了让弹出层不被裁掉，`.sl-diff-code` 的 `overflow:hidden` 去掉，圆角改由上下两个子块各带一半。两方对比时不出下拉，维持原来的纯文件名。⑧ 关联代码的滚动定位由「按 `taskKey.coreName` 哈希」改成真随机且保证与上一次不同段 + 叠一层随机偏移——原来同一条泳道里换任务条算出来是同一段、滚动条纹丝不动。⑨ 换对比对象时统一退回差异看板并清掉画布选中态（`loadData` 换的是数据集，`selectedEvent` 里存的却是旧数据集的事件对象，不清会残留一条指向已卸载数据的高亮）。

- 2026-07-31 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: 聚光灯问题名片的操作区在「定位链指引」开关与「详情」之间补一个「到性能调优工具查看」外链，与详情抽屉抬头上的同款入口（`#locateDrawerProfilingLink`）同址同行为——目标同为 `AI_Profiling_Tool/index_v3.html?issue=mem-oom&tab=memory`（走 `PTO_BASE_PREFIX` 拼路径），`applyCase()` 里按 `key !== "mem-oom"` 隐藏，其余问题在调优工具里没有对应视图、不给死链。两处入口文案由「到性能分析工具深挖」统一改为「到性能调优工具查看」。

- 2026-07-31 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: 专家热力的冷热对比拉开 + 底部读数与网格对齐。① 均衡分量的抖动振幅由 0.5/0.28 两个正弦提到 0.72/0.42/0.2 三个（第三个高频分量打散正弦叠加出的条纹），权重跨度从 0.22~1.78 倍均衡扩到约 0.15~2.3 倍，换算成热力档位由 t=0.055~0.445 扩到 t=0.04~0.56 —— 原来整片挤在蓝绿一小段里分不出冷热，现在最冷淡蓝 `rgb(139,197,241)` 到最热绿 `rgb(56,178,87)` 跨度清楚。② 底部 gauge 的最热/最冷柱色改用该专家自己的热力色（同一个 `lvHeatFill`/`lvHeatOpacity`），柱子就是那一格的放大版。③ 网格上给真实极值的两格加 `lv-heat-mark` 描边圈，`paintExpertHeat()` 每次重着色后按新极值搬位置（读目标格自己的 x/y/w/h），数字、柱子、格子三者可以一一对上。极值本来就取自 `loads` 全量 256 个的真实 max/min，与网格同一份数组同一个 step，这次是把对应关系在图上标出来。

- 2026-07-31 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: 专家热力卡片底板去掉 `cExpert` 黄调（原 `color-mix(in srgb, #ead66f 12%, var(--surface-1))` + `--border-default`），改为对齐「精度/性能」那组曲线图表卡的中性配色 `color-mix(in srgb, var(--foreground) 3%, var(--surface-1))` + `--border-subtle`。图表卡本身是 3% 叠在 transparent 上，而展开卡片浮在整网图之上必须不透明，故把同一层 3% 叠在 `--surface-1` 上，浅/深色主题仍跟着 token 走。

- 2026-07-31 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: 专家热力卡片三处打磨。① 卡片撑开后仍有问题标注浮在上面（读起来像这张热力图在讲那个问题），deck 适配器的遮挡淡出名单加入 `.v3-problem-badge`，与被盖住的节点/连线同批让开、收起时原样淡回。② 色阶由「黄→橙→红」改为「蓝→绿→红」（冷 `rgb(147,197,253)` → 中 `rgb(34,197,94)` → 烫 `#dc2626`），与 infra 集群热力图 `renderInfraHeatSnapshot` 的蓝→绿同一套语义色系；透明度下限从 0.12 提到 0.2 —— 色相差已足够区分冷热，冷端留住可读的蓝比「整片消失」更像热力图。③ 揭示动画修好：原来靠两层 rAF「等初值上屏」，但卡片是刚 `innerHTML` 进去的，同一帧里既设初值又设终值会被浏览器合并成一次样式变更、过渡直接被吃掉（表现为一打开就是终态）。改成显式的 `transition:none` 写初值 → `getBoundingClientRect()` 强制回流 → 恢复 transition 写终值，无论调用时机落在哪一帧都必定播满 2s；并在 `startExpertHeat()` 末尾把 `lastHeatStep` 对齐当前 step，避免紧接着的一次 `syncExpertHeatToStep()` 原值重写把刚起步的动画打断。

- 2026-07-31 `launch-v2.html`: 「训练任务监控」卡片入口调整——去掉 V1 入口（`training-monitoring.html` 已停更），V2 改名「监控主页」，末尾新增「并行与MoE示意」指向 `Profiling_Insight_and_Tool/ParallelDemo/dist.html`。variant 支持 `newTab: true` 强制新标签页打开（原先只有 `http(s)://` 外链才会 `target="_blank"`）。

- 2026-07-31 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: router 展开从「问题一专属」放开为常驻入口——不进问题详情、训练过程中点整网图的 router 或 expert pool 节点即可就地展开 256 专家负载热力（SVG 整网图绑 `router_gate`/`routed_expert_bank`，v2 的 3D deck 绑 `gate`/`expert_pool`，都走 `PtoTwinGraphBridge.toggleExpertExpand`）。两个节点都绑是因为「点哪个能看到专家」的直觉指向 expert pool，而 deck 的 pattern 自身只有 `syncExpertExpansion()` 收起逻辑、没有展开行为，原先点它除 `selectNode` 高亮外什么都不发生。卡片撑开后 560×210 会把这两个节点连同邻居一起盖住/淡出，再点节点收不回来，故卡片右上角加收起 ×（`bindExpertHeatClose()` 在 document 捕获阶段兜底，两条渲染路径共用同一份 markup）；deck 上若停在侧视总览，展开时一并切回正视，否则卡片跟着该层被压成一条读不出东西。deck 侧有两处必须绕过：① 绑定要逐层做、点哪层在哪层展开（`expandLayer`）——正视下 pattern 把非前置层整个 `display:none`，而默认前置层是 23、不是事故层 38，只绑事故层的话用户看到的 Expert Pool 根本不是被绑的那个元素，点了毫无反应；进问题定位链时 `focus()` 把 `expandLayer` 复位成 null，保证问题一仍展在 L38。② `expert_pool` 是 `<div role="button">`，而 pattern 的 `pointerDown` 只对 `<button>`/`[data-stage-ui]` 让路，其余一律给 viewport 设 pointer capture 做拖拽平移，捕获生效后浏览器把 click 派发到捕获元素而非被点元素，该 div 上的 click 永远收不到（pattern 自己的 `selectNode` 同样收不到，所以它本来就点不出任何反应）——在目标阶段截断 pointerdown、不让它冒泡到 viewport 即可，代价是不能从该节点起手拖拽，与 pattern 里 `<button>` 类节点的既有行为一致。卡片上的收起 × 同理，由 `bindExpertHeatClose()` 在 document 捕获阶段一并截断。SVG 那条路径（`model-graphviz-pattern.js`）只在指针移动 ≥4px 后才 `setPointerCapture`，纯点击不受影响，无需守卫。负载改为 step 的函数：`lvRouteSkew(step)` 给出倾斜度，事故前 4200 步开始爬坡（pow 2.6）、`INCIDENT_STEP`~`RECOVERY_END` 期间为 1、修复后 300 步回落到 0.002 底噪；`lvExpertLoads(hot, step)` 按倾斜度在「均衡分量」（每专家 ≈1/256，叠一层随 step 缓慢漂移的确定性抖动）与「坍缩分量」（98% 压给一个专家）之间插值，和恒为 1。步进/时光机拖动时 `syncExpertHeatToStep()` 就地重着色（`paintExpertHeat` 改 fill/opacity/`<title>`，`updateExpertHeatReadout` 改顶行说明、底部 gauge、EP rank 23 标注开合），不重建卡片以免打断过渡；首次揭示仍是 2s，之后网格挂 `is-heat-live` 把过渡缩到 .6s 以跟上步进。卡片底部读数分两态：坍缩态讲 rank 23 all-to-all buffer 失配，健康态讲负载均衡度（最热/最冷专家占比 + ×均衡倍数 + 当前 step）。定位链「模型层展开图」的网格标 `data-heat-static`，钉在事故终态不跟时钟走。

- 2026-07-31 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: router 展开取消 all-to-all 连线动画，改为 256 专家负载热力动画。原实现在命中的 top-8 专家之间画 C(8,2)=28 条 mesh 并逐条描边生长，但 top-k 是逐 token 计算的——一个 step 几万 token 就是几十万条路由，连线既画不全也读不动，还会被误读成「只有 8 条链路」。现在每个专家小格的色温/亮度 ∝ 它承接的 token 量（冷黄→橙→烫红，基准取均衡时 1/256，4× 基准打满，故均衡态整片恰好落在同一档），载入时 256 格全是这一档同色，`startExpertHeat()` 在首帧上屏后把真实负载写进行内样式，由 `.lv-heat-cell` 的 2s CSS 过渡演出「路由坍缩」：整片冷下去、只剩倾斜专家一格烫红。新增 `lvExpertLoads/lvHeatT/lvHeatFill/lvHeatOpacity/lvExpertIdAt` 一组共用函数，三个展开入口（定位链「模型层展开图」`lvBuildSvg`、整网图节点原地撑开卡片 `buildExpertBankExpandMarkup`、v2 页 3D deck 上的同一张卡片）负载口径与配色完全一致。配套删除 `startLayerA2A()` 的 rAF 循环 + IntersectionObserver/visibilitychange 暂停逻辑与 `lvAnimRaf` 句柄（一次性过渡随 innerHTML 重画自然消失）、`.lv-a2a-*` 样式，新增色阶图例与逐格 `<title>` 占比读数；rank 23 的红框与 all-to-all buffer 失配标注保留。

- 2026-07-30 `Profiling_Insight_and_Tool/training-run-twin-standalone/`: `config-relation-observer` 卡顿修复（性能面板显示 83% 主线程花在渲染上：Layerize 25.8% / Recalc style 23.5% / Commit 18.7%，JS 仅 2%，不是泄漏也不是死循环）。三处：① `.cro-event-rail` 去掉 `flex-basis` 过渡 —— 布局属性做 160ms 动画会逐帧重排整个 workarea（deck + 46 刻度 + 结构条 + 256 专家 + 2048 热力格），同时其 18px `backdrop-filter` 每帧重采样底图；配套把 `setEventRailCollapsed` 里等动画的 180ms 定时器换成一帧 rAF。② document 级 click 兜底里把 `.cro-event` 放宽成 `.cro-event-rail` —— 分组标题与收起键也是 `<button>`，原先点一下展开箭头就会掉进通用 button 分支误触发 `clearSelection()`，白跑一整轮 applyRelation + deck 反选 + 连线重画 + 横幅收起。③ `#croDeckHost` 节点与 `.cro-bar` 的 `transition` 摘掉 `filter`（只留 `opacity`）—— `.is-focused` 一翻转数百个元素同时进入 filter 动画，Chrome 逐个提合成层再销毁，即 Layerize 大头；去色改为瞬时生效，静态 `filter` 规则不动，观感不变。

- 2026-07-29 `ParallelDemo/`: 修复 MoE all-to-all 被错误表现为跨 DP 通信的问题。层节点唯一键补齐 DP/PP/CP/TP 坐标，EP 通信组严格限制在当前 DP 副本内；专家分片数、算子图和显存估算统一按 EP 而非 TP 计算，并在悬浮算子图中显示实际组内 ranks。同步重建 `dist.html`。
- 2026-07-30 `ParallelDemo/`: 将原 picotron 教学 Demo 重构为基于 NVIDIA Megatron-LM / Megatron Core `RankGenerator` 语义的 Parallel Strategy Analysis 工作台。新增 Dense、MoE、Long Context 与 MoE Folding 预设，支持 TP/PP/CP/EP/DP、rank order 与 GPUs-per-node 输入；分别生成 Attention（TP×CP×DP×PP）和 Expert（TP×EP×EDP×PP）rank space，按物理节点呈现 rank deck，并可检查选中 rank 的正交 process groups、mixed-radix 方程、配置 JSON 与官方源码证据。新增纯函数 rank 模型及 6 项单测，并刷新自包含 `dist.html`。

- 2026-07-28 `Memory-Visual/index.html`: 合并第二个 ICON 下的“生命周期与复用”和“流水 × 内存”为“生命周期 × 流水”联合页。上半区保留六条流水泳道，下半区改成与其共享 cycle 横轴的 Buffer 生命周期图；纵轴表示内存地址/大小，矩形宽度编码存活时间、高度编码实际字节数，同地址复用通过相同纵向区间与虚线边界表达。生命周期块支持悬浮查看周期、大小、地址和复用来源，并可点击联动右侧详情；同时移除导致分析页签被工具栏覆盖的错误 preview-slot 标记。
- 2026-07-28 `Memory-Visual/index.html`: 修复真实鼠标点击硬件 Buffer 时被画布拖拽逻辑吞掉的问题。按 `memory-architecture` 的 `data-no-pan` 交互约定标记全部可选硬件节点和着色 cell，避免 `createZoomController` 在 pointerdown 阶段阻止 click；L1/L0/UB 点击现在会实际切换底部选中项与 API 详情。
- 2026-07-28 `Memory-Visual/index.html`: 硬件架构视图底部不再只列当前默认 UB，而是常驻平铺 UB/L1/L0A/L0B/L0C 的全部源码 Buffer；点击列表项、硬件层卡片或任一着色块统一更新硬件层、Buffer 选中态与 API 使用列表。
- 2026-07-28 `Memory-Visual/index.html`: 修复硬件架构视图的 Buffer 命中与绘制范围。每个 UB/L1/L0A/L0B/L0C 着色块均可直接点击并打开对应 API 使用列表；网格占用改为按目标硬件 Buffer 的实际 cell 数计算，避免非 UB 区域的后续 Buffer 因范围越界而未绘制、无法选择。

- 2026-07-28 `Memory-Visual/index.html`: 硬件架构模式的 buffer 详情改为与列表布局一致的连续平铺列表。选中 buffer 后扫描源码中的全部引用，逐行列出 `TPipe::InitBuffer`、`Get<T>`、`AllocTensor<T>`、`EnQue/DeQue/FreeTensor` 与声明位置，并展示 API 名、源码行和完整调用；buffer 基本信息与大小表达式也使用同一列表节奏，不再放在单一详情卡中。

- 2026-07-28 `Memory-Visual/index.html`: 右侧「静态内存布局」新增「列表布局 / 硬件架构」切换。硬件模式直接调用设计系统 `memory-architecture` + AIC/AIV patterns，复用共享路由、平移缩放、节点激活和 `setBufferBlocks` API，把源码解析出的 buffer 映射到 UB/L1/L0A/L0B/L0C。点击硬件节点筛选其 buffer，点击具体 buffer 展示容量、`TQue/TBuf<QuePosition>`、buffer_num × 单份大小、对齐、源码行、`InitBuffer` 调用及大小表达式；默认 UB 选中 `gammaBuf`。

- 2026-07-28 `Memory-Visual/index.html`: 源码模式新增右侧「Buffer 规划」面板。静态解析 `TQue/TBuf` 声明、`InitBuffer`、`AllocTensor` 与当前 TilingData，以目标芯片容量/对齐规格计算各 buffer 单份大小、buffer_num、对齐后占用、分层静态布局、水位与剩余容量；面板内可直接切换五组 TilingData 试算候选，芯片或候选变化后实时重算，无需编译即可提示容量安全、接近上限或超限。第二个 ICON 仍切换到原诊断/详情 inspector。

- 2026-07-28 `Memory-Visual/index.html`: 移除顶栏中的当前算子与 Tiling 文本（`MatmulLayerNorm_mix · tileM=32`），顶栏中央仅保留芯片型号切换。

- 2026-07-28 `Memory-Visual/index.html`: 修正源码模式的信息架构：默认第一个 ICON 下，中间编辑区直接显示 `op_kernel/matmul_layernorm_mix.cpp`，隐藏内存分析页签、工具栏、底部水位 dock、状态栏与右侧 inspector；第二个 ICON 才恢复完整分析工作区。源码编辑器新增行号及 Ascend C/C++ 语法高亮，区分预处理、类型、关键字、函数、变量、常量、数字、字符串与注释。

- 2026-07-28 `Memory-Visual/index.html`: 左侧两个 ICON 明确拆成源码与分析模式。默认进入 Ascend C 工程并在右栏显示 `op_kernel/matmul_layernorm_mix.cpp` 完整源码；诊断列表默认隐藏，内存块与流水事件也不再覆盖源码。激活第二个「Tiling 候选」ICON 后才启用诊断、内存块和流水事件详情。

- 2026-07-28 `Memory-Visual/index.html`: 移除左下角浮动播放组件及其资源依赖；点击 Ascend C 工程树中的 `op_kernel/matmul_layernorm_mix.cpp` 时，右侧详情面板展示完整只读算子源码，并在诊断栏被折叠时自动打开。

- 2026-07-28 `Memory-Visual/index.html`: 左侧 activity rail 新增「Tiling 候选」入口，原资源管理器入口改为 Ascend C 算子工程文件树；原算子摘要与五组 tiling 候选完整迁移到新入口。两个入口复用同一 explorer 面板，并同步面板标题、选中态与折叠状态。
- 2026-07-25 `Memory-Visual/`: 场景 6 落地为**产品原型 `workspace.html`**（融合与 workspace），已挂 `launch.html` 与 `launch-v2.html`（后者与单算子页并为同一张卡的两个 variant）。独立成页而非 `index.html` 的第四个页签：单算子页是核内视角（时间轴 cycle），这一页是片外视角（GM，时间轴子计算序），算子也换成融合体 `MLABlock_fused`，塞进同一页会让「焦点层级」「时间游标」同时承担两种语义。核心是 `js/workspace-planner.js`（纯函数、无 DOM，供后续 CLI/Python 复用）：MaxLive 理论下界 + 三种排序策略的装箱（`by-size` / `by-lifespan` / `by-order`，取最紧者，三个高度都进 evidence）+ 同尺寸桶内区间图着色的复用组 + `blockScope` 护栏 + 现有布局的冲突检查。三个数 current / packed / lowerBound，差距拆「策略浪费」与「装箱碎片」两段。主视图 `js/view-ws-plan.js` 用堆叠列画每个子计算真正同时存活的字节（柱顶即下界）+ 四条参考线 + 右侧留白里的差距带；GM 布局复用 `memory-reuse-viewer` 单实例做「当前 / 复用后」切换；底部 `js/view-ws-gap.js` 是六候选的三段分解对比条。诊断 `js/ws-diagnostics.js` 13 条规则，含两条 GM 独有的正确性规则（`WS_ADDR_CONFLICT` 与 `WS_CROSS_BLOCK_UNSAFE` —— 后者是生命周期完全错开、甘特图上看不出问题、但 per-block 与 shared 混用的错误）。演示算子 6 子计算 / 10 GM 张量，基线 21.5MB → 下界 10.0MB（降 53.5%），峰值刻意落在 QKV+RoPE 而非 FFN。实现中修正了方案设计 v0.1 的两处错误：手算认为 `by-lifespan` 能达下界（实测不能，纯生命周期排序会把 lifespan=0 的最大张量 `wsFfn` 推到末尾），以及「三栏并排 memory-reuse-viewer」（该 pattern 是 1013 行的整面板组件，并排必然挤成一团；且「理论下界」不是可实现的布局，用地址图画它是虚构一个不存在的地址分配）。新增 `data/fusion-source.js`、`data/fusion-runs.js`。未动 `index.html` 与既有 `js/*`。

- 2026-07-25 `Memory-Visual/`: 补充**场景 6（融合算子 / 大算子的 workspace 与 GM 规划）方案设计**，新增 `场景6-workspace与GM规划-方案设计.md`。核心是把结论收敛成三个数 —— 当前上报值 `current`、仅做地址复用即可达的 `packed`、当前执行序下的理论下界 `lowerBound`（最大同时存活字节 MaxLive），并把差距拆成「策略浪费」（改分配即可，确定安全）与「装箱碎片」（要动结构）两段，避免只报一个够不着的最小值。文档给出：中间格式的向后兼容扩展（`subgraphs` 子计算实体、GM allocation 的 producer/consumers/liveSubgraphs/blockScope/aliasOf）、下界与装箱算法（DSA NP 难故只报可达值，实现 by-size 与 by-lifespan 两种排序并取优）、复用组推荐（同尺寸桶内区间图着色可证最优，跨尺寸退化为装箱）、GM 独有的跨 block 安全护栏、复用之外降低下界的三条路（原地 / 留片上 / 换序）、九条新增诊断规则、复用 `swimlane-task` 与三实例 `memory-reuse-viewer` 的第四页签视图设计（不自绘同类生命周期图，遵守其 forbiddenOverrides）、可手算复核的演示算子 `MLABlock_fused`（21.5MB → 10.0MB，峰值刻意落在 QKV+RoPE 而非 FFN）、以及 P0/P1/P2 的文件级改动清单。同时记录现状差距：`data/runs.js:719` 把 GM interval 拉平成全程、`js/view-lifetime.js:23` 过滤掉非 core 层级，是当前 GM 视图无信息的根因。
- 2026-07-27 `AI_Profiling_Tool/`: 将案例四“碎片分布与生命周期”从面向 UB/L1/L0C 的 `memory-reuse-viewer` 切换为工具内的 `hbm-memory-snapshot` 组件。新视图按“连续空间判据→关键地址块→生命周期→调用栈”的阅读顺序呈现 GB 级整卡 HBM 快照，明确解释“总空闲 1.8 GB 但最大连续块 0.3 GB，无法满足 0.5 GB 请求”；所有面板、文字、边界和空洞斜纹使用设计 token，完整适配明暗主题，保留 Timeline/源码联动。

- 2026-07-27 `training-run-twin-standalone/` + `AI_Profiling_Tool/`: 完成性能案例四 E/F 闭环。v2 的问题二详情抽屉改为原生渲染七节定位链，并新增“到性能分析工具深挖”深链；index_v3 新增“显存”页签，展示显存趋势、峰值构成及复用 `memory-reuse-viewer` 的碎片/生命周期视图，补齐 PHS 内存评分、64/64 GB 显存卡、分配 API/碎片率指标和两条显存问题。新增 `openpangu-2.0-flash.memory-snapshot.json` 作为跨工具快照契约，打通生命周期→Timeline 分配/释放证据→代码修复示例。

- 2026-07-27 `training-run-twin-standalone/`: 新增**问题二 · 显存 OOM**（定位链-openPangu-2.0-Flash.md 案例四）。数据层在 `training-run-twin.js` 里加 `memoryAtStep()` 与 `MEM_CASE_FACTS`（经 `window.PtoTrainingTwinMemoryCase` 暴露）：step 8000 起显存从 53 GB 爬升、12003 触顶 64/64 GB 触发 rank 17 OOM、开 activation checkpoint 后回落至 34 GB；`avg_mem` 改由 `mem_gb / 单卡容量` 派生，回放态每卡 HBM 水位也平移到同一水位，显存读数全页单一真相源。聚光灯定位链（`training-spotlight.js`）重构为按 caseKey 索引的 `CASES` 注册表，问题一/问题二各一份 meta/fixes/steps，新增 `infraCol` 决定是否展开集群监控栏；`activateProblemOneLens` → `activateProblemLens(caseKey)` + `PROBLEM_LENS_ENTER` 钩子表；抽屉泛化为 `openLocateDrawer(caseKey)`。两页各一套展示序号（`num` / `wzhNum` + `problemNum()`）：单屏页显示为问题二，`training-monitoring.html` 追加为问题六，互不牵动。底部 dock 新增「性能」页签（`training-memory-panel.js`）：显存占用&吞吐曲线、峰值构成面积比例气泡图（贪心 packing，半径 ∝ √GB）、地址×时间碎片分布图（含碎片热力条与单块生命周期/申请堆栈浮层）三张卡一行铺满。定位链长文由自包含模块 `training-memory-case4.js` 提供（案例四七层 → 七小节），正文里三张图经 `PtoTrainingMemoryPanel.drawInto()` 与「性能」页签共用同一份绘制代码。整网图侧视图新增逐层指标 `layer_activation_gb`「单层激活值显存」（dense 0.70 / MoE 约 0.78 / L38 1.2 GB，46 层求和 36.2 GB，默认勾选），并新增「回顾模式」`setFrozen()`：进入任一问题定位链即定格训练过程动画，退出时光机解除。

- 2026-07-27 `training-run-twin-standalone/`: 问题一「聚光灯定位链」名片修：`Layer 38 · MoE Router`/`精度` 两个标签由挤在卡片右侧改为紧跟问题名称排列（`.tw-spot__card-title` 收缩自适应内容宽度，不再抢占剩余空间；`training-monitoring-v2.html` 顶栏 `#diagnosisLocator` 同款问题定位卡同步修正）。名片「详情」左侧新增「关闭/打开定位链指引」按钮（`training-spotlight.js` 的 `setGuideVisible`/`toggleGuide`），只隐藏遮罩/光洞/步进导轨/标注气泡这层视觉引导，不退出问题一定位，名片与「修改建议」栏保持常驻。名片压薄（padding 9→4px，高度约 50→40px，`top` 12→4px）并带动 `.tw-spot__toolbar` 一起上移，减少对内容区的侵占，同步收窄光洞定位的顶部预留区（`topR` 104→88）；步进导轨 6 个圆点之间加箭头分隔并随进度点亮，强化「链路」观感。

- 2026-07-25 `Memory-Visual/`: 内存布局页签下新增**布局切换**（地址布局 / 硬件架构）。硬件架构布局调用设计系统 `patterns/memory-architecture`（+ `aic-core-object` / `aiv-core-object`）的硬件架构图，把当前候选的读数直接挂回硬件本身：每块存储卡片下方给出物理容量、对齐要求、bank 数、静态预留、利用率（超限时写明超出量）、峰值持有，寄存器层级额外给展开度 / 溢出 / 每线程寄存器 / 并发 warp；卡片里的 cell 网格按时间游标着色（实色=此刻持有、灰=预留未用、警告色=该层级超限），悬停给完整读数，点击把焦点层级切过去。全部经 `renderArchitecture` / `createRouteOverlay` / `attachHoverInteractions` / `setBufferBlocks` / `createZoomController` 官方入口，读数行以派生 preset 的 `details` 传入，不复制 pattern 生成的 DOM、不用局部 CSS 改其内部视觉。新增 `js/view-arch.js`。

- 2026-07-25 `Memory-Visual/`: **950 增加寄存器内存管理**。`data/chip-specs.js` 为 `ascend-950b` 增加两个 `kind: 'register'` 存储层级 —— `VRF`（Vector Register File，64×256B）与 `SRF`（SIMT Register File，64KB，按 warp 切分），并用 `chip.registers` 描述 warp 切分与溢出去向；新增 `VF` 流水。`data/runs.js` 据此把 950 的 Normalize/Cast 下沉为 A5 RegBase 路径（`loadalign` → VF 计算 → `storealign`，`normBuf` 不再申请），寄存器分配随展开度变化，装不下的部分溢出到 UB 并产生每次迭代的额外往返。诊断新增 `REG_SPILL` / `REG_OCCUPANCY` / `REG_HEADROOM` 三条规则，通用容量与复用规则对寄存器层级不再给「复用地址 / 增大 tileM」这类不适用的处方。布局图、水位曲线、状态条、分析日志、详情面板对寄存器层级一律按「寄存器个数」口径呈现。

- 2026-07-25 `launch-v2.html`: 执行与性能分析组新增「内存工作台」卡片（`Memory-Visual/index.html`），排在「内存查看器」之后。预览图 `assets/preview-memory-workbench.png` 取自该页 1600×900 实机截图（Ascend 910B / tileM=32 基线，内存布局视图 + 诊断栏 + 占用水位），与其他卡片一致走 `preview` + `fit: "contain"` 静态图路径。

- 2026-07-25 `Memory-Visual/`: 新增**内存工作台**——昇腾算子片上内存可视化工具原型，落在设计系统 `ide-frame`（standalone host）的完整槽位上。覆盖规划文档 §4.3 的三个视图：内存布局条带图（地址空间分栏，实心=当前持有 / 半透明=预留未用 / 斜纹=碎片 / 红区=超容量）、生命周期与复用（整块复用 `memory-reuse-viewer` pattern）、流水×内存联合时序（`swimlane-task` 的 drawTaskBar 画六条流水线 + 焦点层级占用曲线）。底部 dock 承载六层级水位曲线与 `memviz analyze` CLI 形态日志（互斥）。数据层 `data/runs.js` 是中间格式**生成器**：给定 tiling 参数与各队列 buffer_num，用串行流水队列 + slot 释放约束模拟出事件序列，double buffer 是否生效由模型自然产生而非硬编码；五组候选覆盖超限 / 单份缓冲 / 双缓冲解 / 手工复用踩内存 / 过细切分。规则引擎输出「问题+位置+量化影响+建议」四元组并带 evidence 溯源。芯片容量、bank、对齐、流水单元集合走 `data/chip-specs.js` 表驱动（910B / 950B，占位规格）。已在 `launch.html` 执行与性能分析组挂入口。

- 2026-07-24 `op-graph-integration/`: 「框架接入与入图」阶段的入图范围从局部 5 节点扩展到**整机模型**——以 DeepSeek V3.2 为例，复用设计系统 `model-graphviz` pattern（`window.PtoModelGraphvizPattern.render`）渲染完整解码器架构，用 pattern 内置的 `P0` 高亮标记本次入图算子 `FlashAttentionV2` 的落位（每个解码层的 **MLA 注意力核**，61 层复用）。原有的 Cast→算子→Add 融合边界图保留为「局部放大」。CSS 变量经 `.pto-model-graphviz-pattern-page` 作用域注入并就地中和其 `min-height:100vh`。

- 2026-07-24 `op-graph-integration/`: 流水线从 5 步扩展为 **7 个任务阶段，完整覆盖 Ascend C 入图 9 步链路**。新增 ②③「Kernel & Tiling」核对阶段（UB/L1/L0 占用、blockDim/核间切分、动态 Shape tiling 策略）；识别阶段补充算子定义约束（format/动态 Shape/精度要求/目标 SoC/op_proto）；契约生成新增 ④ `ops-info.json` 注册产物（SoC 与 dtype-format 组合）；拆分 ⑤「编译与打包」（OPP 包 + `ASCEND_CUSTOM_OPP_PATH`）与 ⑧⑨「执行与验收调优」（Runtime 下发 + msprof/精度/动态 Shape/边界）；⑥⑦「框架接入与入图」增加**在线 GE / 离线 ATC 路径切换**。空状态新增 9 步→阶段覆盖图。

- 2026-07-23 `op-graph-integration/`: 静态校验中的提醒现可直接定位关联产物；FP16 支持组合跳转至 OpDef，融合规则跳转至独立的 GE Fusion 注册文件。

- 2026-07-23 `op-graph-integration/`: 补全端到端入图证据，覆盖框架自定义节点到 ONNX 导出、ATC/GE 编译、OPP 到 ACL Runtime 加载，以及动态 Shape、精度和 msprof 验收。

## 2026-07-25 — training-monitoring-v2：问题一「聚光灯定位链」覆盖层（真实页开洞 + 1→6 步进）

- 新增 `Profiling_Insight_and_Tool/training-run-twin-standalone/js/training-spotlight.js` + `css/training-spotlight.css`（`window.PtoTrainingSpotlight`）。进入「问题一」时不再默认弹文字密集的详情抽屉，而是在实页之上覆盖暗遮罩、按 1→6 步进：每步把当前证据图表挪到可见（开场 `PtoTrainingTwinSideCols.setRightVisible` 展开 infra 列 / 侧栏 `scrollIntoView` / `PtoTrainingTwinDockTabs.select` 切底部 dock 页签，其中「日志」步点 `#trainLogToggle` 触发 `renderBody()` 才有内容），用**四片遮板围出光洞**照亮它（根容器 `pointer-events:none`、只遮板 `auto`，光洞区可穿透缩放/拖动底层实图），配编号徽标 + 引出线 + 一句话结论 + 关键数字标注（`迭代层`取 loss+grad_norm 两卡并集）。顶部问题名片 + 步进导轨（常显层名）+ 导航同处左上；「修改建议」聚光灯期间挤入 `.pto-ide-frame__workarea`（改行向 flex）作 split 右侧、**与底部 Timeline 左右并排的整页高列**（`is-spot-fixes` + `.wzh-col-spot-fixes`），遮板给它让出常亮右栏、始终显示 6 处代码修复并高亮当前步关联项（举证↔修复联动），关闭即移除该列并复原 workarea。名片「详情」/修复项点击走既有 `window.openProblemOneLocateDrawer` 全文抽屉，`←/→` 步进、自动播放、`ESC`/× 退出（× 经 `diagnosisLocatorClose` → `exitTimeMachine` 复位图表）。
- `js/training-run-twin.js` — `buildAccCard` 给指标卡加 `data-acc-card`（供聚光灯选中 loss / loss_scale 卡）；`activateProblemOneLens` 末尾 `PtoTrainingSpotlight.open(caseKey)`、`exitTimeMachine` 内 `PtoTrainingSpotlight.close()`。`training-monitoring-v2.html` 引入上述 css/js。

## 2026-07-24 — config-relation-observer：点专家/EP 组全展开连线（连上所有相关 layer 与各 stage 的 rank）

- `js/config-relation-observer.js` — 明确「路由槽位」的分布语义并全展开连线。一个专家编号 e 在**每个 MoE 层**都有一份实例（各层权重独立、互不相干，只共享编号与「编号→EP rank」分片公式），其 EP 组在**每个 PP stage** 内各占一块 rank。`resolveRelation` 的 `case "expert"/"epRank"` 连上全部 MoE 层 + 各 stage 的该 EP 组 rank（× DP 副本），`sharedExpert` 连上全部 MoE 层 + 各 stage 全部 rank。`drawRelationLinks` 新增 `clusterStageAnchors()`：集群侧不再把 4 段并成一个横跨整幅热力图的巨框，而是**按 PP stage 拆成多条线**（每段一条 + 一圈虚线框，总「Node… · N 卡」标签只挂离 hub 最近那条），直观表达「这个编号的 rank 散布在每个 stage」。`relationLabels` 主标签改为「`E37 · L2~L45 各一份`」，点明分布范围又不误导成「同一个专家横跨各层」。
  - 同时移除上一轮为「单层收敛」方案加的 MoE 代表层步进器（`#croMoeRepLayer` / `moeRepLayer` / `.cro-replayer*` / `NAV_PREV·NAV_NEXT`）与其 `emitSelect` scopeLayer 注入——全展开语义下与之矛盾，故回退。

## 2026-07-24 — config-relation-observer：典型 Layer 并行分支改左右分栏

- `js/config-relation-observer.js` / `css/config-relation-observer.css` — 典型 Layer 面板原先把每列算子一律竖排（`renderStructure` 直接把 bars 顺次塞进 `.cro-structure__stack`），把整网 deck 里本是并行的支路读成了串行。新增 `PARALLEL_GROUPS` 声明（按 deck 的 SIDE_ROWS 配对）：注意力 Q 路径 ∥ KV 路径、MoE 路由专家支路（Router→Dispatch→Expert Pool→Combine）∥ 共享专家支路；`renderStructure` 据此把连续同组的 bar 收进 `.cro-structure__lanes` 左右两条 `.cro-structure__lane` 子栈渲染，汇合节点（`attention_core` / `moe_branch_add`）本身不属任何分栏、自然收束回整条竖排。bar 的 `data-*`/点击/关系高亮全部不变（子栈仅作视觉容器，选择器都是后代匹配）。

## 2026-07-23 — 新增 `op-graph-integration/` 算子入图交互 demo（编辑器发起 · 自动流水线）

- 新建 IDE 内「算子入图（Op Graph-Integration）」工具原型：以**编辑器为主界面**（活动栏 + 源码 Tab + CodeLens），开发者在写完 AscendC 算子的源码上方点击「⚡ 算子入图」发起任务，右侧任务面板以 **CI 流水线时间线**自动往下跑。
- 五步（识别算子 → 生成入图契约 → 静态校验 → 入图预览 → 构建部署）：识别/生成/校验**自动执行并直接呈现结果**，不再"先看一屏解释再点按钮"；每步保留一行常驻说明；只在**真正需要决策**处暂停——校验提醒的应用/忽略、入图预览确认、构建落盘确认。完成的步骤折叠为一行结果摘要，可点击重新展开。
- 交互覆盖：解析源码填充签名、生成原型/信息库/框架适配三件套（文件 Tab + 自动补全高亮）、6 项入图校验（dtype 组合与融合规则提醒，可一键套用建议修复）、SVG 计算图节点预览（引擎 placement + 可融合边界）、构建日志流式回放至「已入图」成功页与回归指标。
- 单文件自包含，复用 `vendor/pto-design-system` tokens 与 `.btn/.badge` 等类；纯 HTML/CSS/vanilla JS，无新增依赖。
- 后续：整个 IDE 外壳改为消费设计系统标准 **`ide-frame` pattern**（`data-host="standalone"`：顶栏 chrome / 活动栏 / 三栏 split「资源管理器·编辑器·算子入图任务」/ pattern 自带 status strip），经 `PtoIdeFrame.initAll()` + `workbench-shell` 初始化可拖拽分栏；业务内容填入各 slot。同时修复底部状态栏位置异常——改用 pattern 的 `data-ide-slot="status"` 底部条，稳定固定在工作区底部。
- 领域准确性修正（对齐 CANN 8.0 / AscendC OpDef 现代形态，不改交互骨架）：① 生成产物由旧 TBE 老三样（`.cc` `IMPLEMT_COMMON_INFERFUNC` / 手写 `.ini` `op_info_cfg` / `_plugin.cc` `REGISTER_CUSTOM_OP`）改为 `op_host` 的 **OpDef 原型（`Input().DataType().Format()` 支持列表 + `AICore().SetTiling()`）/ InferShape·InferDataType / Tiling** 三件套，并说明 `ops-info.json` 编译期自动生成、aclnn API 自动产出；② **Tiling 升为一等公民**：新增生成 Tab、静态校验项「Tiling 合法性」、预览「Tiling 绑定」、构建日志与确认文案均体现；③ 把入图核心的**「算子选择 CheckSupport」**在校验/预览/图注/构建日志中点明（FP16 组合缺失=CheckSupport 不命中；Cast 标注为 GE 插入的 format 转换节点）；④ 术语统一到 CANN 8.0：`build.sh`→`custom_opp_*.run`→`opp/vendors/custom`→注册 GE→回归确认被选中；文件树改为 `op_host`/`op_kernel` 结构。校验项 6→7（5 通过 + 2 提醒）。

## 2026-07-23 — AscendPort MLA 算子架构图去除 parent 填充并规整连线

- `model-graphviz` parent cluster 改为 `fill: none`；AscendPort MLA 页面继续使用 pattern 原生 cubic curves，并参照 Qwen/openPangu assets 把 Query / Position Query 放到 Query Block Stage 左侧 lane、Latent KV / Position Key 放到 KV Tile Stage 右侧 lane，四条输入边改为横向连接。

## 2026-07-22 — TaskCompare：图表对比底部新增「Media 对比」栏

- `Profiling_Insight_and_Tool/training-run-twin-standalone/TaskCompare.html` — 图表对比页底部增加多模态产出对比分区：左侧勾选几个任务就渲染几张卡片，卡片自上而下为任务名（含状态点/基线标签）、圆角视频封面（取自 `pic/`，16:10 定比裁切 + 综合评分/分辨率·帧率/时长角标）、生成 prompt、产出质量指标（CLIP-T / 时序一致性 / 美学评分 / FVD）、来源 checkpoint 与单条生成耗时；沿用 `.cmp-group` 外壳支持折叠，「标记最优」开关下逐指标高亮最优任务。
- 同页「最佳任务」榜单第 2 项由 `grad_norm` 换成 `media` 综合评分（与 Media 卡片角标同源），榜首任务不再包揽全部指标——第 1 名赢 loss / MFU，media 由基线任务 v2 拿下。
- 同页左侧任务对比栏加 300px 宽度上限，拖拽分隔条不再能把它拉宽到挤压右侧栅格。

## 2026-07-22 — config-relation-observer：Layer 导航分组名跟随选中态降噪

- `js/config-relation-observer.js` / `css/config-relation-observer.css` — 选中层（或任意关系）后，Layer 导航上下两行分组名（PP / Dense / MoE / Emb / Norm / Head）中未被牵连的整条压到 0.35 透明度；Dense/MoE 注记新增 `data-segment`，由 `rel.segments` 判定归属。

## 2026-07-22 — `config-relation-observer.html`：关系连线标注块加重阴影

- `.cro-link-label__box` 原来只有 `--surface-1` 填充 + `--border-subtle` 描边，浮在整网/刻度带/热力图上时融进背景信息里。改为三层 `filter: drop-shadow`（`0 2px 4px /.7` 贴边定形 + `0 8px 16px /.7` 中距 + `0 16px 40px /.65` 大范围暗场，末层近乎无位移，等效把标注块四周底图压暗一圈挖空），描边提到 `--border-strong`。透明度高于 `--shadow-*` token，因为它压的是彩色 3D deck 与热力图而非纯色页面底。SVG 元素不吃 `box-shadow`，所以走 filter。

## 2026-07-22 — training-run-twin-standalone：训练监控 / 任务对比 / 配置关系三页 rail 互跳

- `training-monitoring-v2.html`、`TaskCompare.html`、`config-relation-observer.html` 的 activity rail 底部统一为「训练监控 / 对比 / 配置关系」同款同序三键，当前页保持 `is-selected` 且不绑定跳转，其余两键 `location.href` 跳转，三页任意一页可直达另两页。
- 「配置关系」用 lucide `share-2` 节点连线图标（三个圆 + 两条斜线），比代码分支更贴「关系连线」语义，与 rail 上 Source control（circle 6,6 / circle 18,18 + 折线）也不会看混。
- `config-relation-observer.html` 首个 rail 键原为「折叠整网网格区」（用 `is-selected` 表达展开态），与「选中 = 当前页」的 rail 语义冲突：改为与 TaskCompare 完全同款的文件夹图标 + 跳转训练监控大盘，不带 `is-selected`；整网折叠交互与 `croNetToggle` 脚本一并移除（`.is-net-collapsed` 的 CSS 规则留着未删）。三页 rail 至此完全同构：文件夹 / Search / Source control / Terminal / 对比 / 配置关系。

## 2026-07-22 — `config-relation-observer` 关系映射统一排查：五处连线/高亮缺陷

- 单值 `rel.segment` 换成 `rel.segments` / `rel.units` 集合。一次选择往往横跨多列（一个 rank 压住它那段 PP 的 Dense + MoE + 端点列），旧写法在 `case "rank"` 里把 segment 写死成 `"moe"`，导致点一个 rank 只连 MoE 典型层，Dense / Norm / Head 既不高亮也不去色。现按「有层落进关系集」逐列判定，端点列（Emb / Norm / Head）按驻留的 PP stage 判定，且只在整段 stage 被选中（点 PP 标签 / 点 rank）时才接上——避免 MoE 算子横跨全部 stage 时把 Norm/Head 一并拖亮。
- 新增 `rel.deckStatic`：Emb / Final Norm / LM Head / MTP 这些算子画在 deck 的 input/output 静态段里，不属于任何一张层卡片，而 `selectNode(id, layer)` 会把查找限死在那张卡内 —— 静态节点永远选不中，于是点整网的 MTP Decoder 节点连自己都被取消选中、一条线都连不出去，点 Layer 导航的 Emb/Norm/Head 刻度也没有线连回整网。静态节点现在不带层作用域查找；同时修正传参必须是 `undefined` 而非 `null`（deck 里判的是 `Number.isFinite(Number(layer))`，`Number(null) === 0` 会把查找锁进 L0）。
- 整网 deck 点算子不再强制 `scopeLayer`。同一个算子（EP Combine、Attn…）在同类型的每一层都存在，直接点它就该亮出整列的层；收敛到单层的规则（select.png 的「EP Combine in Layer 3」）统一由 `emitSelect` 在「先选层、再点算子」时施加，与结构条点击路径同语义。新增 `preferLayer`，让 deck 停在用户正看的那一层而不甩到该列中间。
- Layer 导航的端点刻度（Emb / Norm / Head）原先 `is-related` 恒为 `false`，点 stage / rank 时它们明明在那段流水线上、刻度带却是灰的；现按 `rel.units` 点亮。
- 典型层补列级去色：只选到层 / stage / rank 时没有任何 `.cro-bar.is-selected`，原先那条 `:has(.cro-bar.is-selected)` 去色规则整条不生效，五列之间只剩 0.5 的透明度差，点一个 MoE 层时 Dense / Emb / Norm / Head 照旧满色。
- 整网同步补去色：新增 `markDeckRelated()`，按「层内节点看所在层卡的层号是否在关系集里、静态段节点看 id 是否在 `rel.staticNodes`」标注 `is-related`，配 `:has(.is-related)` 的去色规则。一个 rank 只持有它那个 PP stage 的层 + 一端的 Emb 或 Norm/Head/MTP，整网里其余流水线段现在会退到灰底。
- 点 rank / PP 标签时补上 `rel.deckLayer = entry.lo`：整网转到这段流水线的首层（以前点末段的卡，图还停在中间层上）；`collectAnchors().net` 的兜底选择器加入 `.pto-model-deck__layer.is-related`，让这类粗粒度选择也能连出到整网（正视图下非 front 的层卡 rect 全 0，`unionRect` 会跳过，锚点落在当前正视的那张卡上）。
- 删掉 `case "rank"` 里写死的 `rel.segment = "moe"`：一张卡不属于某一列典型层，相关列一律按 `rel.layers` 派生。
- 补齐 `decoder / input / parameter / state` 四个 op 的 `--cro-bar-color` 映射与 `.cro-board` 兜底色。`syncDeckPalette` 的 `DECK_COLOR_VARS` 一直搬着这四个变量，但结构条的 op→色映射表漏了它们，于是 MTP Decoder（`op="decoder"`，`#0D9488` 绿）在整网里是绿的、在典型层里是灰的。
- 关系连线新增 `clampRectTo()`：锚点先夹回所在视图的可视宿主、再夹回 `.cro-board`。deck 的 `__viewport` 是 `overflow:hidden`，而 input / output 静态段落在层卡上下 `top:-700px` / `top:520px` 处（Emb、Final Norm、LM Head、MTP 全在里面），`getBoundingClientRect()` 给出的坐标必定在 deck 可视区之外 —— 连线从可视区一头扎出屏幕，表现为「点 Emb/Norm/Head 刻度，整网和 Cluster 都高亮了，就是没有线」。夹取只作用于绘制坐标，锚点有效性仍判在原始 rect 上；夹扁成一条边时不再画分组虚线框。

---

## 2026-07-22 — 新增 `config-relation-observer.html`：整网-layer-Cluster-expert 的 T 型关系观测页

- 新页面 `Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.html`（配套 `css/config-relation-observer.css`、`js/config-relation-observer.js`），以 `patterns/ide-frame` 为 shell，单一 pane 内用 CSS Grid 切出四个不可见区：左「整网」通栏两行，右上「Model Architecture」与「MoE」并列，「Cluster」挂在 Model Architecture 正下方构成 T 型下竖笔。已挂到 `launch.html`。
- 拓扑模型层 `CroTopology` 是全页唯一数据源。并行语义取 `world = DP×PP×TP×CP×EP`（EP 与 DP 正交，8×4×1×1×64 = 2048 对齐 openPangu-2.0-Flash 的 Total Rank）。层→PP stage、专家→EP rank、(stage,dp,ep,inner)→global rank、rank→node 全部确定性推导，无随机、无数据文件；11 个 stepper 改动后四视图整体重算，配置不自洽时标红对应 stepper 并写出原因。
- 整网图直接消费 `patterns/model-architecture-3d-deck`，用 `options.config` 注入 topology 派生的 `layerCount / stageRanges / denseLayers / dsaLayers / representativeLayers`，`options.showChrome:false` 去掉 pattern 自带的视图切换与工具栏，只保留正视图 + pan/zoom。
- 结构条颜色不再走 `buildColorMap`：本地 `model-graphviz-pattern.js` 未导出 `modelArchitectureColormap`，deck 实际取的是自己的 `COLOR_FALLBACKS`（attention 是 `#3B82F6` 而非 `#EC4899`），两边色相差了一整格。改为把 deck 根节点的 `--pto-model-deck-*` 原样搬到 `.cro-board`，bar 用同名 `data-op` 取同一变量，并照抄它的渐变与 inset 高光，做到同一个算子在两处逐位同色。
- Layer 导航（一条 49 格刻度带：46 层 + Emb/Norm/Head 三个端点格）按 `default.png` 逐像素落地。初版做成的五栏网格（等宽栏 + `--space-4` 栏距 + 实心刻度 + PP 胶囊标签 + 一条横向分割线）与参考图不是一回事。改成一条**连续**刻度带 —— 刻度是空心细胶囊（1px `--border-default` 描边、`--radius-pill`、无填充），带子按「PP 边界 ∪ Dense/MoE 起止」断开成组，组间空当正中一条 1px `--foreground-muted` 竖分隔线：PP 边界与带子两端的线从 PP 标签行顶画到刻度行下方，Dense / MoE 起止的线从刻度行顶画到底部标签行下方，两种线等长（91px）交错咬合。PP0…PPn 在上、Dense / MoE 在下，都是 14px 纯文字，不套底色；首尾 stage 的标签框延伸到带子两端（参考图里 PP0 含 Emb 格），`Norm|Head` 两侧都不是层故该处无分隔线。几何解一个方程写死：`width = (2n−g)·t + g·6.5t`（n 格 g 组，间隙与刻度同宽 t，空当 : 刻度 = 26 : 4 量自参考图），t 夹在 [1.5, 8]、余量吃进空当，保证带子既不横向溢出也不在右侧留空；分隔线与标签的 x 仍按组的实测 `getBoundingClientRect` 写入。面板由 `--surface-2` 无边框卡片改为 `--surface-1` + `--border-default` 描边 + `--radius-lg`。五段结构条未改动。
- 刻度改空心后 `.cro-board.is-focused` 的降噪从 `opacity:.12` 提到 `.4` —— 1px 描边压到 12% 会让整条带子消失（原来是实心块才压得住）；`.cro-tick.is-endpoint` 的淡化规则一并删除，参考图里端点格与层刻度取色完全一致，两者的区分交给下方 Dense / MoE 标签划出的层区范围。
- 集群图参数化重建（原 `training-run-twin.js` 里是写死的 DP4×8行×64列，且列同时被当作 EP rank 和 PP stage 的 1/4）：列 = EP rank，行组 = DP 副本，组内每行一个 PP stage，格数恒等于 Total Rank。复用 `training-run-twin.css` 的 `.twin-heat*` 视觉，但补了一圈中性描边作为静息态 —— 基类只有 6% 的 `.ep-tint-N` 底色，原页面靠 `renderHeat()` 写 util 环才可见，本页不做 util 着色故会整片空白。
- 关系引擎 `resolveRelation()` 把任一视图的点击解析成四者的全量关系集，layer ↔ 专家 ↔ rank ↔ 算子 双向互查；整网图侧经 `onNodeSelect` 反查回结构条，回写时静音回调避免自激。`attention_core`、`post_mlp_norm` 在 Dense/MoE 两列同名，按节点所在层的 FFN 类型消歧。连线画在 `position:fixed` 的 SVG 上，滚动/缩放/拖拽重画；聚焦降噪只动 opacity 不动尺寸线宽。
- 集群 2048 个格子用 roving tabindex + 方向键导航（整张网格只占 1 个 Tab 站），其余可交互元素均为原生 `<button>`。container decoration 审计通过：无 `border-left`、无侧条伪元素、无横向渐变高亮，唯一的 `border` 在 `.cro-select` 表单控件上。
- 修复 Emb / Norm / Head 三个端点算子点不出关系连线：`structureColumns()` 给这三列的 `layers` 是空数组，`resolveRelation()` 的 `segment` 分支被 `if (col.layers.length)` 挡掉，既不收 PP stage 也不收 rank，于是 nav / cluster 两个锚点为空，只剩结构条自己亮着。改为给端点列声明 `stageAnchor`（Emb 在首段、Final Norm / LM Head 在末段），走 `ranksOfStage()` 接回 PP 段与集群格子；标签在无层可报时退化成 `Token Embedding · PP0`，不再拼出尾巴空掉的 `名称 · `；Layer 导航的端点刻度改按 segment 匹配选中态，`.cro-tick.is-endpoint` 的 `opacity:.14` 补上 `:not(.is-selected)`（它写在 `.is-selected` 之后且同特异度，原本会把选中的端点格压回不可见）。
- 算子选中态从「压 opacity」改成「保色 / 去色」：选中某个算子后，整网 deck 与五个典型层里只有它保留语义色，其余节点 `grayscale(1)` + `opacity:.62`，让选中项从一片灰底上跳出来（层 / EP rank / global rank 这类粗粒度选择仍走原来的 opacity 降噪，不动色相）。规则用 `:has(.is-selected)` 锁在「确实有节点被选中」时 —— 只选到层时 `rel.deckNode` 为空、一个 `.is-selected` 都没有，整幅图不该无缘无故变灰；悬停未选中项时把本色放回来，方便在灰底上确认目标。只在 `.cro-board.is-focused` 状态下叠一层 filter，不改写 deck pattern 自身的节点样式。
- 典型层算子栈与路由专家列表的滚动条从系统默认（Windows 上 17px 实心灰槽，在算子条右侧劈出一条比内容还抢眼的硬边）压成 6px：轨道透明，滑块用 `2px transparent border + background-clip:content-box` 撑成胶囊，静息 14% 前景色、指针进容器 30%、压在滑块上 46%；`overscroll-behavior:contain` 断掉滚动链，滚到底不再带着 `.cro-board` 一起位移。
- 选中项自动滚进可视区：算子栈（每列 30+ 条）与路由专家（64 个 EP 组）都远高于各自视口，选中项多半落在折叠区里，不滚出来等于没高亮。`applyRelation()` 末尾对 `.cro-structure__stack` 与 `#croRoutedExperts` 各补一次 `revealIn()`；没有直接选中物时退而露出第一个 `is-related`（选一层 → 该层用到的 EP 组）。实现上手算容器与目标的相对位置、只 `container.scrollBy()`，不用 `el.scrollIntoView()` —— 后者会把所有祖先滚动容器（`.cro-board` 是 `overflow:auto`，document 也可滚）一起滚，点一个专家会把整块面板连同整网图挪走；目标已经露着则一动不动。取元素用按优先级逐个 `querySelector` 而非选择器列表，后者按文档顺序返回，会出现「选中了某个专家却滚到排在它前面的 is-related 组」。
- Cluster 区左右换位：`.cro-cluster__side`（标题 + stepper）移到左、`.cro-cluster__grid`（矩阵）移到右，容器是 flex，只调 DOM 顺序即可。同时去掉 `#croClusterMeta` 那行「2048 卡 · 256 节点…」说明文字，连带删掉写它的 `controller.onChange` 片段与已无引用的 `.cro-region__meta` 样式。
- EP 组升级为可单独选中的实体：`applyRelation()` 里 `.cro-moe-group` 从只有 `is-related` 增加 `is-selected`（`primary.kind === "epRank"` 时命中），`collectAnchors().moe` 优先取 `.cro-moe-group.is-selected` 作锚点，连线直接接到组卡片本身，不再退化成组内专家的并集包围盒外加一圈虚线。选中态视觉去掉 `--state-selected` 那层蓝，改成整组一圈 1.5px 白描边（与 `.cro-expert.is-selected` 同一套语言），组内专家保留 `is-related` 供聚焦降噪判断但底色压回 `--surface-3`；`.cro-moe-groups` 补 2px padding，否则描边被滚动容器裁掉。
- EP 组的选中热区从「只有组名那几个字」扩到整张卡片：click 挂在 `.cro-moe-group` 上，命中 `.cro-expert` 时放行给专家自己的 `kind:"expert"`，其余区域（组名、padding、专家行的间隙）一律选中整组；组名按钮不再单独挂 listener，靠冒泡走同一条路径，仍保留它作为键盘可达入口。清空选择的 `SELECTABLE` 白名单相应从 `.cro-moe-group__name` 放宽到 `.cro-moe-group`，否则点卡片空白处会先选中再被自己清掉。
- 顺带修 `expert` / `epRank` / `sharedExpert` 三个分支不设 `rel.deckLayer` 的问题：`selectNode()` 拿不到层号，整网侧没有锚点，专家类选择的连线一直少一条。改为取中间那个 MoE 层作代表。
- 三处高亮统一到「白描边」这一套选中语言：① 共享专家 SE 胶囊只有一个，任何指向它的选中都只落成 `is-related`，铺满整行的 `--state-selected` 蓝比真正的选中态还抢眼，`.cro-expert--shared.is-related` 改为与 `.cro-expert.is-selected` 同款（中性底 + 1.5px 白描边）；② 连线指向整组时画的包围盒虚线 `.cro-link-group` 从 `--foreground` @0.4（深底上偏灰蓝，像另一套弱提示）改成纯白 @0.9、线宽 1.25；③ `.cro-tick.is-selected` 在蓝色实心之外补一圈白描边 —— 刻度只有 ~4px 宽，白圈走 `border-color` 而非外扩 `box-shadow`，否则会盖住邻格。
- 遗留待办：设计系统当前没有 select / form-control 组件，`.cro-select` 是用 tokens 拼的最小实现，后续应吸收进共享系统。

## 2026-07-22 — `TaskCompare.html` 统一全页字体

- 页面大量中英混排文案（指标名「GPU 利用率」、分组名「运行参数」、标签「基线」「清除」等）套用 `--font-mono`（`JetBrains Mono`/`Fira Code`/`Consolas`），这三款字体不含中文字形，中文部分会回退到浏览器默认等宽字体，与 `--font-sans` 统一使用的 PingFang SC/Noto Sans SC 中文字形不一致。页面级 `<style>` 里新增 `:root` 覆盖，给 `--font-mono` 补上与 `--font-sans` 相同的中文回退字体，西文/数字部分等宽观感不变，全页中文字形统一。

## 2026-07-21 — 智能对话面板头部收纳：Key 设置改齿轮图标，去掉三行状态条

- `#trainChatKeyBtn`（设置 DeepSeek API Key）从原来挤在标题下方的独立"Key 状态条"整行，收成抽屉右上角关闭按钮左侧的一枚齿轮图标按钮；配置状态只通过图标颜色（`.is-configured` 时描边变 `--accent`）和 `title`/`aria-label` 文案区分，不再单独占一行。
- 连带去掉标题下方原本的三行：训练上下文行（`#trainChatContextLabel`）、Key 状态行（`#trainChatKeybar`）、每日额度行（`#trainChatQuotabar`）；额度限流本身（`quotaLeft()`/`bumpQuota()`）逻辑不变，只是不再有独立进度条 UI。`js/training-chat-panel.js` 相应删掉 `updateQuotaUI()`/`fmtContextLabel()` 等只服务于这些行的死代码。
- 标题栏 `.wzh-chat-head` 去掉 `border-bottom` 分割线，头部直接过渡到消息区，减少视觉分层。

## 2026-07-21 — `training-monitoring-v2.html` 新增「日志」抽屉（全量/任务/系统 + SQL 搜索）

- 顶栏主题切换图标左侧新增线性「日志」图标入口 `#trainLogToggle`，默认收起；点击后从底部滑出非模态抽屉 `#trainLogDrawer`（日志行信息密度高偏宽，不采用 `wzh-chat-panel` 那种竖版右侧面板），含「全量日志｜任务日志｜系统日志」页签（复用页面已有的 `.seg`/`.segbtn` 分段控件）与一条 SQL 风格搜索框。
- 新增 `js/training-log-drawer.js`：内置 50 行固定重演日志（时间/级别/组件/消息 + 关联 step），时间线与 `js/training-run-twin.js` 的 `INCIDENT_STEP=41230`（问题一：router FP8 softmax 溢出→98.3% token 塌缩到 expert193→loss NaN + all-to-all 死锁双发）、问题三（q_proj 溢出，step 8500）、问题五（HCCS 掉链路，step 20000）三处事故点对齐，而非随机生成；「任务日志」/「系统日志」按组件（trainer/dataloader/ckpt/eval/router 为任务，scheduler/npu-driver/network/node-health/hccl 为系统）拆分。
- SQL 搜索实现了对这份静态数组的简化 WHERE 解析：支持 `level`/`comp`/`message`/`step` 列，`= != > >= < <= LIKE IN` 运算符，多条件用 `AND` 连接；解析不出结构化条件时退化为对整行文本的关键字子串匹配。抽屉内 context 复用 `window.twinGetTrainingContext()` 显示当前模型/step，逻辑与 `js/training-chat-panel.js` 的面板开合模式一致（Escape 关闭、独立 `is-open` 状态）。

## 2026-07-21 — `training-monitoring-v2.html` 「问题定位」卡片改挂顶栏，不再挤占整网图高度

- 点击进度轴问题点弹出的「问题定位」卡片（`#diagnosisLocator`）原本插在 `.twin-graph-card` 内、位于 `.twin-architecture-stage` 上方，弹出时会挤压整网图的可用高度；现改为挂载到顶栏原本空白的 48px 区域,不再影响图区尺寸。
- 顶栏空间有限，描述文字（原两行 clamp）收起改走原生 `title` 提示（hover 卡片可见完整文案，见 `js/training-run-twin.js` `activateProblemOneLens()`）；`showDiagnosisLocator()`/`hideDiagnosisLocator()`/`exitTimeMachine()` 等既有逻辑和 DOM id 不变，仅挪动位置与重排 CSS。
- 卡片再从顶栏正中挪到 `.pto-ide-frame__topbar-left`、紧跟页面标题之后，并把 `.pto-ide-frame__topbar-center`/`-right` 的 flex-grow 就地清零（本页覆写，不改 `ide-frame-pattern.css`），让标题到进度条之间的整段留白都归它，问题标题因此少截断、多显本文；操作区「详情与修复建议」精简为「详情」，「关闭」文字按钮换成与顶栏其余按钮同款的 28×28 × 图标（`.pto-ide-frame__window-action`）。
- 卡片标题字号 12px 收到 11px，与胶囊内其余徽标字号更协调；同时把 `.pto-ide-frame__host-chip`/`.pto-ide-frame__workspace`（页面标题）钉死 `flex: none` + `white-space: nowrap`，空间紧张时改由卡片自己收缩/走省略号，避免页面标题被挤成两行。
- 首版挂在顶栏中央 `.pto-ide-frame__topbar-center`；按反馈改挂到顶栏左侧、紧跟页面标题之后（标题与右侧进度条之间本就大片留白，更靠左、不遮挡任何元素）。顺手把 `.pto-ide-frame__topbar-center` 原本固定的 420px flex-basis 收窄成 `auto`（该页此槽位已不再使用），否则这段空间被空置的中央槽占着，标题会被挤到换行。

## 2026-07-21 — `training-monitoring-v2.html` 新增「智能对话」AI 助手面板

- 参考 MindStudioNext 右侧 AI 对话 inspector 的实现手法（前端直连 DeepSeek API、用户自带 Key、按浏览器/天限额），在训练监控大盘顶栏右上角新增线性图标入口，默认收起；点击后从右侧滑出非模态面板（不遮挡左侧整网图/指标），面板含 API Key 状态条、每日额度条、训练场景快捷提问、流式回复。
- 系统提示改为围绕当前训练运行作答（模型/step/loss/MFU/已定位问题），而非解读离线性能分析报告；训练态由 `training-run-twin.js` 新增的只读 `window.twinGetTrainingContext()` 实时提供，对话逻辑独立成 `js/training-chat-panel.js`，不引入外部 CDN 依赖（内置极简 Markdown 渲染器，保持离线可用）。
- 新增「消息设置」固定演示场景（快捷提问区首位）：点击后发送带任务名 mention 胶囊的用户消息，走脚本直出（不经 DeepSeek、不占每日额度、无需 API Key）固定文案 + 一张构造的 WeLink 消息预览卡片（任务/时长/step/loss/acc/MFU/显存利用率字段 + 通知强度规则标签）。
- 新增「调整图表」固定演示场景：回答用 Markdown 表格列出精度栏 4 张图的替换前/替换后/日志提取结果，随后调用 `training-run-twin.js` 新增的 `window.twinDemoApplyAccuracyOverride()`，把精度栏 precision/recall/f1/rollout 相关系数 4 张卡换成 WPLC val loss/LAMBADA val loss/Z loss/数值 t 分布（ν）——复用真实图表引擎(`buildAccCard`/`renderMetricChart`)和 `metricsAtStep` 同款事故态曲线形状生成虚构数据，而非贴图；关闭对话框时 `window.twinDemoResetAccuracyOverride()` 自动还原成默认 8 图。`renderMarkdown` 同步补上 GFM 管道表格解析。
- 打磨「消息设置」「调整图表」两个演示场景的业务正确性与真实感：前者用户提问改为携带动机的自然口吻，回答拆成「识别信息→给理由→具体方案→播报样例→确认生效+邀请调整」分段，样例卡片改为"任务开始运行约 6 小时后的首次播报"（此前用具体日期时间戳，与上文"排队中"矛盾），且卡片内 loss/acc/step 进度按 5.6 天总时长与本页 acc≈1-loss/6 的换算关系重新配平，不再是收敛期读数错配到刚开始跑的任务；后者用户诉求改为先指出 precision/recall/f1（分类指标）与 rollout 相关系数（RL 后训练指标）放在 task=pretrain 页面里本来就文不对题（呼应 `body[data-task]` 声明的真实业务背景），回答先认同该诊断再给替换方案，表格新增「不适用原因」列。
- 重做智能对话消息气泡视觉：参考 shadcn/ui 的 [Bubble 组件](https://ui.shadcn.com/docs/components/base/bubble)规范（用户消息 end-aligned + 内容自适应宽度 ≤80% 的实心气泡，AI 回复用不带底色的 ghost 形态，避免表格/卡片被塞进有色气泡里变形），改掉此前"提问和回答都只是散字、没有气泡容器"的问题。用户气泡加圆角+底色+投影，右下角收成小直角当视觉锚点；AI 回复统一走 `js/training-chat-panel.js` 新增的 `createAiMessageShell()`（头像圆标 + "PTO 助手"标签 + 缩进正文的外壳），流式更新/脚本演示/报错只需改 `bodyEl.innerHTML`，头像行不用重建；四处发消息的入口（`sendMessage`/`appendSystemNotice`/两个脚本化场景）统一收敛到这一份外壳，不再各自拼 DOM。
- 「消息设置」预览卡片瘦身:去掉底部"定时播报/事件通知/异常升级"三个规则胶囊(方案文字里已经讲过,卡片没必要重复列)与顶部"首次播报示例"标签;字段行由"标签换行数值"改成 key/value 同一行、两端对齐。快捷提问栏(`.wzh-chat-suggestions`)改成中性色(不再借用 primary/accent)、不换行改横向滚动保持单行,并去掉与上方消息区、下方输入框之间的分割线。

## 2026-07-21 — `TaskCompare.html` 图表曲线业务化 + 按 TensorBoard scalars 范式分组

- 曲线业务化：新增 `enrichSeries()`（配 `cmpNoise()`/`cmpHashSeed()`），把手工 20 点序列上采样到 77 点并叠加确定性抖动，手法参考 `training-monitoring-v2.html` 精度/infra 10 图的 `stepNoise` 正弦哈希噪声。抖动幅度按「相邻步长中位数」而非全局值域定标，避免 loss spike 撑大值域后把收敛平坦段淹没；尖峰段走阶跃插值保持陡直。首尾端点精确保留，故 `last()`/稳态均值/Borda 排名/末值最优口径完全不变，且不改写 `TASKS.series`（仅绘图用）。
- 图表分组：新增 `CMP_GROUPS`（训练收敛 / 算力·基础设施 / 优化·策略），`CMP_METRICS` 各项补 `group` 字段并新增 `mfu`、`tput` 两个 infra 指标（6 → 8 图）。「图表对比」与单任务「数据趋势」两处均改为按分区渲染，分区标题栏可折叠（对应 TensorBoard Scalars 按 tag 首个 `/` 前缀自动归入折叠目录的范式）。
- 折叠后隐藏的图不重绘（`offsetParent` 为 null 时跳过），展开时重绘；单任务页签图表联动缓存改为按元素身份查找，避免分区折叠后序号不连续导致取错缓存。

## 2026-07-21 — `training-monitoring-v3.html` 合并入 `training-monitoring-v2.html`

- 删除旧 `training-monitoring-v2.html`（SVG 整网图版），将 `training-monitoring-v3.html`（3D deck 整网图版）重命名为 `training-monitoring-v2.html`。
- 同步重命名 `js/training-monitoring-v3-deck.js` → `js/training-monitoring-v2-deck.js`，更新 HTML 内 `<script src>` 引用。
- 更新 `js/model-architecture-3d-deck-pattern.js`、`css/model-architecture-3d-deck-pattern.css`、`js/training-run-twin.js` 内引用 v3 的注释为 v2。
- `launch-v2.html` 已指向 `training-monitoring-v2.html`，无需额外修改。

## 2026-07-20 — 新增 `training-monitoring-v3.html`：整网图换成 model-architecture-3d-deck 组件

- 新增 `training-monitoring-v3.html`（从 v2 复制，现已是新版 v2），整网图由 SVG 的 `opv-modelviz` 换成 pto-design-system 的 `model-architecture-3d-deck` pattern（CSS 3D 层叠，46 层沿深度铺开）；组件与样式 vendored 为 `js/model-architecture-3d-deck-pattern.js` / `css/model-architecture-3d-deck-pattern.css`。
- 新增 `js/training-monitoring-v2-deck.js` 适配器（`window.PtoTwinGraphAdapter`）：承接旧 v2 在整网图上叠加的全部内容——常驻问题标注、点问题后的聚焦、`routed_expert_bank`(deck 里为 `expert_pool`) 原地展开卡片与 all-to-all 连线动画、算子去色、问题二 HiF8 溢出率徽标；内含 v2↔deck 的节点 id 映射表。
- 问题标注按用户口径挂到「问题实际发生的层」：问题一 L38 / 问题三 L33 / 问题四 L35 / 问题五 L23（跨栈链路问题取代表层）/ 问题二 输出区；聚焦时切正视并把该层提到最前。
- `js/training-run-twin.js` 改为可插拔绘制：上述几处一旦发现 `window.PtoTwinGraphAdapter` 就把绘制让给适配器，业务语义仍只有一份；新增 `window.PtoTwinGraphBridge` 供适配器回调诊断联动入口。v2 与 `training-monitoring.html` 不注册适配器，继续走原 SVG 实现，行为不变。
- v3 移除 v2 的「全局/实时」视图页签与底部 46 层 3D 侧视卡（`twin-live-deck`）；工具栏补上并行标注（PP/TP/EP/DP）切换，去掉不适用的 L1~L5 层级下拉。
- 视图只保留正视/侧视两个正交投影，不出组件的等轴 3D（iso）视角。动线为「侧视总览 → 正视下钻」：侧视下 46 层全可见、5 枚问题标注同时在场（承接原 3D 视角的总览作用），故作为落地视图；点问题时切正视并把事故层提到最前——正视下只有 `is-front-layer` 那层不透明可交互，天然就是 v2 那套聚焦效果。Fit 回侧视总览。
- 侧视新增「逐层指标曲线」（移植自 precision-debugger 整网 2D 侧视顶部的「逐层 cosine」折线 + op-rank-time 的 transfer line chart 样式）：对齐每一层的趋势曲线，随 pan/zoom/旋转逐帧跟随。指标取自 `temp.md` 的 9 项（精度/性能/Infra 各 Top1~3），做成勾选面板，默认每类只勾 Top1（grad_weight_l2_norm / layer_fwd_bwd_latency / peak_activation_mem）。46 层曲线数据结合业务构造，事故层 L33/L35/L38 做出与红色标注一致的形变（如权重梯度 L2 在 L38 越 1.0 阈值爆炸）。为此给 vendored 的 `model-architecture-3d-deck` pattern 加了 `options.onOverlay` 每帧覆盖层收尾钩子（需回流上游）。
- 逐层曲线样式打磨：① 不再独立占一块顶部分区，改为每指标一条 lane 自模型层顶部向上堆叠、紧贴模型层，lane 高按选中条数自适应压缩；② Catmull-Rom 平滑成顺滑曲线并收窄构造数据的噪声幅度，消除原先的锯齿抖动；③ 曲线名改到左侧（text-anchor:end，配一小段竖色标 + Top/单位副标）；④ 线加粗到 2.1px round-cap + 柔和 drop-shadow，打点带背景描边环，越界点标红并按 `temp.md` 阈值贴数值读数（贪心留距防重叠）。
- 侧视卡顿优化（先减重节点绘制路线）：整网 3D deck 侧视下 46 层同时在场共 3778 个元素（1451 个带渐变+双阴影的节点 + 1772 条层内连线 + 92 个 preserve-3d 上下文），逐帧栅格化是卡顿主因（对照 precision-debugger 侧视是单一扁平 SVG 故不卡）。① 正视只显示单层，其余 45 层由 `opacity:0` 改 `display:none`，彻底移出合成树；② 侧视（data-view="right"）下把节点/专家池的渐变压成扁平填充、去掉 inset/drop 双阴影、层内文字透明（22px 薄片本就看不清），可读算子名仍由 side-labels 提供；③ 侧视整块隐藏层内连线 `__edges`——层间数据流由屏幕坐标的 interlayer-spine/side-guides 另画，不受影响。正视与下钻仍是单层，保留原有光泽。若仍不够顺，下一档是把侧视换成扁平 2D SVG（option B）。
- 训练动画时序修正为「层先亮起 → 算完 → 才出曲线点」：前向时第 prog.fwd 层是正在计算的层，应已点亮(reached)但还没出点；点亮前沿因此比已出点的层领先一层——层点亮传 `prog.fwd+1`(已完成 0..prog.fwd-1 + 正在算的 prog.fwd)，曲线打点仍 `L < prog.fwd` 只画算完的层。二者仍由同一个 prog.fwd 在同一次调用算出，不漂移。验证:t=0 亮 1 层(L0 在算)出 0 点、t=10s 亮 11 层出 10 点、前向完成后亮=点各 46。
- 训练动画曲线「跑在模型层前面」根因修复（宽度相关的横向缩放）：曲线 SVG 的 viewBox 用的是 `viewport.clientWidth/clientHeight`，而曲线点坐标 `xs[L]` 是按 `viewport.getBoundingClientRect()`（实际渲染像素框）换算的。两者只要差 1px（边框/子像素/布局未落定/infra 栏影响视口宽），SVG 就给 viewBox 乘一个随 x 放大的缩放系数，曲线越往右越比模型层跑得快、看着提前好几层；用户实测「收起右侧 infra 栏后才对齐」正是那一刻两把尺子恰好相等。改为 viewBox 也用同一个 `getBoundingClientRect()` 的宽高，并加 `preserveAspectRatio="none"` 保证 x/y 各自 1:1、绝不再缩放。验证:在 clientWidth(1100)≠BCR(1200) 的构造场景下，L10 卡片中心 x=329 对应的曲线点 cx≈329（未被 1.09× 拉伸）。
- 训练动画曲线与层点亮对齐修复：原来层点亮在 animTick 里按 fwdDone 算、曲线在 renderMetricCurve 里按 prog.fwd 算，两处分算 + 层点亮 0.45s 淡入过渡，导致视觉上曲线跑在层前面。改为单一真源——层点亮改由 renderMetricCurve 用与曲线揭示完全相同的 prog.fwd 在同一次调用里算完（animTick 只推进状态 + 触发重画，加 lastLitFwd 去抖），并把点亮过渡收短到 .18s 让层紧跟曲线打点。验证：t=10s 恰好 10 层亮 + 10 个点，t=45s→45，t=46.5s→46，每个时刻「亮到第几层」==「曲线画到第几层」。
- 侧视图加「训练过程动画」：播放一个训练 step。前向 L0→L45（1s/层）逐层点亮，未执行到的层压到 30% 透明；前向类指标随扫层从左往右逐层描点。全部层亮完后，反向 L45→L0（0.2s/层）沿途从右往左回描反向类指标。每个 step 走完短暂停顿后循环，面板底部显示当前前向/反向扫到第几层。指标按 `temp.md` 采集阶段分前/反向（`METRIC_FLOW`）：纯 Fwd（hidden_states_std/attention_entropy/peak_activation_mem/pp_transfer_bytes）为前向；梯度类及合并指标显著信号出现在反向的（grad_weight_l2_norm/layer_fwd_bwd_latency/layer_mfu/effective_flops_ratio/hbm_bandwidth_util）为反向。动画仅侧视播放，切正视即停并复位层透明度；`prefers-reduced-motion` 下直接全亮全曲线不动。
- 修 `model-architecture-3d-deck` 的 `showChrome:false` 空指针：`apply()` 未判空就写 `[data-deck-readout]`，关掉自带工具栏时必崩（vendored 副本已修，需回流上游 `pto-design-system`）。

## 2026-07-20 — `training-monitoring-v2.html` 新增问题一「详情与修复建议」抽屉，顶栏进度条简化为常显态

- 新增「详情与修复建议」抽屉：入口从顶栏进度条面板移到点击问题点后弹出的中央「问题定位」卡片(`#diagnosisLocator`)上，按钮打开右侧抽屉，iframe 内嵌 `training-monitoring.html`（新增 `?embed=locate-sidebar` 内嵌模式，只渲染 `.twin-monitor-sidebar` 训练监控侧栏，配合已有的 `?diagnosis=moe-a2a` 深链自动展开定位链面板）。
- 顶栏「训练进度」缩略部件不再靠悬浮展开问题列表面板：移除 `#progressAxis`/`#progressConnectors`/`#progressIssues`（连带 `renderProgressIssues()`/`layoutProgressConnectors()`），已训练时长默认常显，悬浮/聚焦不再触发部件变宽，避免轨道问题标记点跟着挪位导致点不中。
- `css/training-run-twin.css` 新增 `?embed=locate-sidebar` 内嵌样式规则。

## 2026-07-20 — `training-monitoring-v2.html` 顶栏进度条面板合并为一体 + 问题一定位卡新增「关闭」

- 顶栏「训练进度」缩略条与悬浮问题列表面板不再是两块分离浮层：面板宽度改为贴齐缩略条(不再固定 300px)，二者悬浮时一起变宽(`min-width`)+ 面板向下变高(`max-height`)，衔接处去圆角/去边框做到零缝拼接。
- 移除进度条面板里的「返回」按钮(`#timeMachineBack`)；点击「问题一」后架构图上方弹出的红色定位卡新增「关闭」按钮(`#diagnosisLocatorClose`)承接同一个 `exitTimeMachine()` 退出回放逻辑，且该卡片填色改为复用进度条面板「问题1」条目(`.wzh-tm-issue.is-p0`)同一套红色 inset 光晕，两处色感保持一致。

## 2026-07-20 — `wzh_training-monitoring.html` 更名为 `training-monitoring-v2.html`，V1 入口改回旧文件

- 文件改名以贴合其 V2 定位；同步更新引用：`launch-v2.html`「训练任务监控」卡的 `href`（指向新文件）、`js/training-run-twin.js` 内一处说明性注释。
- `launch-v2.html`：V1/V2 两个 variant 此前都误指向同一文件，现改为 V1 → `training-monitoring.html`（旧版）、V2 → `training-monitoring-v2.html`（新版）。

## 2026-07-20 — launch-v2「训练任务监控」卡加 V1/V2 入口

- `launch-v2.html`：「训练任务监控」卡片 href 与新增的 `variants: [V1, V2]` 底部入口（样式对齐「Pangu 训练时空透视」等既有卡片）均指向 `wzh_training-monitoring.html`；卡片原先指向的 `training-monitoring.html` 不再是本卡默认入口。

## 2026-07-20 — 精度栏恢复 precision/recall/F1，8 图表 + infra 2 图表补指标说明气泡

- `js/training-run-twin.js`：`ACC_CARD_DEFS` 新增 `f1` 卡（precision、recall 的调和平均，数据在 `metricsAtStep()` 里同步算出），补满精度栏 2×4 网格的第 8 格。
- `css/training-run-twin.css`：新增 `--twin-chart-f1` 颜色变量（4 处主题变体）。
- `wzh_training-monitoring.html`：删除此前把精度栏压缩成 2×2、隐藏 precision/recall 的局部 CSS 覆盖，恢复默认 2×4/640px 布局；「精度」8 图表 + 「集群监控」MFU/显存利用率 2 图表标题旁新增「?」气泡，悬浮/聚焦展示指标含义与好坏判定标准（复用既有 `#diagnosisTooltip` 浮层，绑定逻辑抽成 `window.wzhBindHelpTooltips` 供动态建卡后按需重新扫描绑定）；气泡文案按「指标解释 \n\n 判断标准(可多条)」分段(靠 `.diagnosis-bubble` 已有的 `white-space:pre-wrap`)，grad_norm/weight_diff 补充 L2 范数的直白解释，weight_diff 额外说明其与 grad_norm 两条曲线同步波动才是健康信号；精度 8 图卡面上原有的 note 说明行（如 precision 卡下「预测正例中的准确率」）改为 CSS 隐藏，避免与新气泡重复，图例(legend)不受影响仍保留。
- `js/training-metrics-chart.js`：新增常驻事故点标注 `spec.markerStep`——独立于原本借用 hover 游标(`cursor`)实现的临时高亮，单独一层(`gMarker`)绘制红色虚线(`.pto-tmchart__marker`)，不受 hover 交互影响，超出当前窗口范围时自动不画。`css/training-run-twin.css` 配套加了该类样式。
- `js/training-run-twin.js`：`renderMetricChart()` 里 `cursor` 与 `markerStep` 解耦（此前 3 张卡靠把 `cursor` 初值设成 `markerStep` 来常驻显示，游标线是中性灰色且与「问题一」讲述以外的图表不一致）；`ACC_CARD_DEFS` 全部 8 张卡 + `INFRA_CARD_DEFS` 的 MFU / 显存利用率都补上 `markerStep: INCIDENT_STEP`，统一在 step 41230 常驻红色虚线；INFRA_CARD_DEFS 的 `regions` 改由 `markerStep` 派生的等效区间自动生成，移除了重复的 `INFRA_REGIONS` 常量。同时把 x 轴刻度档数从写死的 `xTicks: 4` 改成按实际绘图宽度动态收缩(窄卡 2 档/中等 3 档/宽敞 4 档)，解决训练监控侧栏窄卡下首尾 step 数字交错重叠不可读的问题。

## 2026-07-20 — 整网图 Fit 改为按高度适配窗口

- `model-graphviz-embed/pattern.js`：`fit()` 新增 `fitMode: 'height'` 分支，缩放系数只由 `heightFit` 决定（不再与 `widthFit`/`readableFloor` 取 min/max）；`height` 分支进一步去掉全局 `MIN_ZOOM(0.18)` 下限——该下限本是给交互式缩放用的最小可读比例，但套用到 Fit 计算上会在可视区高度较小/图较高时把缩放顶回 0.18，导致图仍然纵向溢出而不是贴合窗口，因此改为仅用极小值(0.02)兜底避免 0/负值。宽度超出时依赖既有 pan 交互左右滚动查看。
- `js/opv-modelviz.js`：openPangu 整网图渲染改用 `fitMode: 'height'`（原为 `'readable'`）。

## 2026-07-19 — training-run-twin「W_gate」移入 infra 并列页签，精度栏改「Weight Diff」，EP All-to-All 联动抽牌动画

- `wzh_training-monitoring.html`：W_gate(Router)·专家负载分布从「训练监控」列移入 infra 列，与 EP All-to-All 合并为 `#wzhRouterMeshCard` 并列页签（复用 `.seg`/`.segbtn` 分段控件，而非新造 tab 组件）；两个 tooltip 里"左侧/右侧"措辞相应改为"切换页签"。
- `js/training-run-twin.js`：`ACC_CARD_DEFS` 精度栏新增 `weightdiff` 卡（`‖ΔW‖` 权重差分 + `grad_norm` 右轴对照线，事故步同步跳 inf），替代原 Router 卡在精度栏的位置；`metricsAtStep`/`buildAccuracyData` 同步产出 `weight_diff` 序列。
- `css/training-run-twin.css`：新增 `--twin-chart-weightdiff` 图表色变量（4 处主题块）；`.twin-accuracy-cards` 2×3 网格改 2×4 以容纳第 7 张卡。
- `wzh_training-monitoring.html`：EP All-to-All 新增 `#wzhMeshLiveFlow`（8 条跨节点竖线 + 虚线流动动画），由「实时监控」抽牌层的 `layerType(L)` 判定驱动——MoE 层显示流动、Dense 层隐去，与事故态的静态汇聚线互斥显示。

## 2026-07-19 — training-run-twin「W_gate 专家负载分布」「EP All-to-All」默认展示最新态

- `wzh_training-monitoring.html`：两张卡默认显示训练最新健康态（负载均衡/收发对称），不再固定展示 step 41230 事故内容；新增 `window.wzhSyncProblemOneMonitorCards` 回调按事故态/最新态切换 KPI、SVG 柱状图、mesh 热点圈与图例文案。
- `js/training-run-twin.js`：`applyViewStep` 新增 `INCIDENT_STEP_TOLERANCE`(300 步) 容差判定，时光机拖动落在事故 step 附近或点击问题标记（精确跳转）时触发上述回调切回事故态，松手/离开后自动切回最新态。

## 2026-07-19 — training-run-twin 去除中心区底部多余内边距，Timeline 底栏默认收起

- `wzh_training-monitoring.html`：`.twin-center-scroll`（`.pto-ide-frame__pane-body`）去掉底部 8px padding，只保留右侧 8px；底部 Timeline dock 默认收起（`setVisible(false)`），需要时手动点顶栏按钮展开。

## 2026-07-19 — training-run-twin 时光机进度条支持拖块回放历史 step

- `wzh_training-monitoring.html` / `js/training-run-twin.js`：时光机进度条加拖块，可在 `[200, liveStep]` 区间内往回拖（越过最新 step 的部分被钳制，未执行的 step 不可回放），轨道上补一条浅色残影标出可回拖范围。拖动时展示时钟 `state.step` 与实时时钟 `liveStep` 分离，精度 / infra 各图表窗口、进度读数、集群热力图整体回放到拖中的 step；拖到事故步 41230 可复现 loss NaN / grad_norm inf / MFU 0%。标题在回放态变为「xx,xxx Step」并在同行最右露出「返回」按钮，点击回到最新 step 并恢复实时态。回放态的热力图改用绝对 step 播种的确定性噪声，同一 step 反复回放结果一致；拖动中间帧跳过 2048 格热力图重绘（实测占单帧耗时大头），松手时整套补齐。

## 2026-07-19 — training-run-twin infra「集群监控」补 smoothing 滑条，与精度卡双向同步

- `wzh_training-monitoring.html` / `js/training-run-twin.js`：「集群监控」标题右侧新增 `#infraSmoothSlot`，挂同款 smoothing 滑条控制 MFU / 显存利用率两图；滑条统一登记到 `smoothControls`，拖动任一处即镜像其余滑条的位置与读数并重画精度 / infra / 定位链各组图表。

## 2026-07-19 — training-run-twin 去掉左右栏级标题，infra「?」下沉到集群监控

- `wzh_training-monitoring.html`：删除左栏「训练监控」标题（`#runTwinHeader`）与右栏「infra」标题，减少一层冗余标题；原 infra 栏级「?」（集群规模/并行策略说明）移到「集群监控」标题后。两栏 body 补上顶部内边距（原由标题提供），并清掉随之失效的 `.twin-sidebar-title` 样式。

## 2026-07-19 — training-run-twin 制品/事件流移入底部 Timeline dock，形成三页签

- `wzh_training-monitoring.html`：训练监控列的「制品」「事件流」两张卡片移入底部 dock，与 Timeline 并列为三个页签（复用 ide-frame pattern 的 `__terminal-tablist` / `__terminal-tab` 视觉）；副标题随页签切换；切回 Timeline 时补发 `resize` 让泳道图重排。

## 2026-07-19 — training-run-twin infra 栏「?」上移 + MFU/显存图 y 轴按健康段收窄

- 「集群监控」标题旁的并行策略「?」气泡移到上级 infra 栏标题后（`.wzh-card-title` 复用 `.wzh-card-title-row`），页内 4 处「见…标题旁「?」」交叉引用同步改为「见 infra 栏标题旁「?」」。
- MFU / 显存利用率两图原先把事故步跌到 0 的点纳入自适应值域，正常波动被压成图表顶部窄带、下方大片留白。`training-metrics-chart.js` 新增 `spec.yDomain`（显式轴域 + 折线层 clip），`training-run-twin.js` 用 `healthyDomain()` 排除事故窗口 `[INCIDENT_STEP, RECOVERY_END]` 后取值域；骤降段裁到画面外，事故仍由新增的 regions 区带与悬浮气泡真实数值体现。曲线纵向占比由约 1/4 提升到约 7/10。

## 2026-07-17 — training-run-twin 入口文件更名 wzh_index.html → training-monitoring.html

- 个人前缀文件名改为语义化英文名(「训练监控」→ training monitoring)，避免与仓库内其它 `index.html`/`train/training-run-twin.html` 混淆。同步更新 `launch.html`、`launch-v2.html` 的入口链接，`SKILL.md`、`training-run-twin.css`、`training-run-twin.js`、`MindStudioNext.html` 中引用该文件名的注释；`CHANGELOG.md` 历史条目与 `prompt.md` 提示词记录保持原文不改。

## 2026-07-17 — training-run-twin 问题详情顶部定位链重构为「速度刃进度轨」

- `wzh_index.html` / `js/training-run-twin.js` — 顶部定位链从「圆点+连线」彻底重构为异形、有速度感/力量感的一体化进度轨：每层=一片前倾的「刀锋」分段(skewX 斜切 + 圆角，内容逆 skew 保持直立)，段间为斜向缝隙；当前层最亮 + 斜向速度条纹 + 外发光并展开(层名/子标题竖排)。三态：已通过=定向渐变蓝刃 / 当前=最亮发光 / 未到达=暗刃。整条栏做扁(高 ~62px)、去掉层号序号、去掉右侧白炽前缘(远看似缺块)、去掉底部推进光带。移除旧的 SVG 连线/高亮/悬浮图层及 `drawLocateTrackLines`/`positionLocate*` 相关代码，`setActiveLocateNode` 按分段索引点亮 is-done/is-active，浅/深色主题自适应。

## 2026-07-17 — training-run-twin 问题五补全定位链详情页
- **问题五「算子带宽瓶颈 + AICPU 回退」定位链详情**(`Profiling_Insight_and_Tool/training-run-twin-standalone/js/training-run-twin.js` 的 `locateChains["perf-compute-bottleneck"]`):将原本只有节点标签的骨架链，按定位链文档「案例一」(计算分支下钻)补齐为六层完整详情——性能表征层(T_iter 12.1s/MFU 38%/PHS D KPI 卡)、瓶颈分类层分叉(step_trace 堆叠条 + PP stage 0~7 计算段条形图)、阶段定位层(stage 7 过载 1.82×)、算子定位层(`op_statistic` 算子表,lm_head cube_util 49% + CE loss AICPU 526ms)、执行效率层(Roofline memory-bound + CE 手写 5 段串行链)、代码/配置层(lm_head tiling 调优 + `F.cross_entropy` 融合 + BF16 优化器 + 验证表)。内容为纯 HTML/CSS(复用其它问题的表格/代码 diff/metric-note 视觉),经现有 `content` innerHTML 渲染路径直出,无需新增 canvas JS。同步把整网图 lm_head 节点副标题的过时 `vocab 129280` 更正为 `151552`,与页面「训练信息」及架构参考一致。

## 2026-07-16 — openPangu Swimlane 事件详情信息收口
- **按事件类型呈现悬浮详情**(`pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html`):计算区间只显示层范围、时间与对应 activation/gradient 摘要；通信事件只显示 Tensor、通信算子和 Active/Wait/Exposed；Activation 保留区间只显示保留时长与显存，不再把无关指标堆进同一张悬浮卡。
- **Profiling 下钻产品化**:展开区改为“模型算子 / 设备 Kernel / 集合通信”三层，头部只保留 MB、PP、阶段、事件计数与局部时间；Inspector 和 hover 统一使用所属阶段、阶段内时间、模型路径、关联 ID 等用户语义。可见界面不再暴露 `mock profile JSON`、fidelity 枚举、测试目的或点击操作说明，仅以“内置示例 Trace · 局部事件覆盖”标明数据属性。
- **浅色悬浮面板背景**:为共享 Swimlane tooltip pattern 增加受支持的背景变量，本页浅色主题设为 `#F8F8F8`，深色与 glass 主题保持原 surface。
- **空白点击取消选择**:Swimlane 空白区域现在统一清除 profiling span、通信事件、关联模型节点、Inspector 详情与联动去色；时间游标仍移动到点击位置，已展开的 task 明细保持展开，用户可继续选择同一 task 内的其他子事件。

## 2026-07-15 — openPangu 三视图视窗交互统一
- **旋转、平移与缩放手势**(`pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html`):轴测视图保留普通拖拽旋转，并支持 `Ctrl/Command + 拖拽` 平移；正视与侧视锁定旋转后改为普通拖拽直接平移；CSS 3D 与 WebGL 后备渲染均支持无需修饰键的滚轮缩放。侧视 Layer 指标/PP 通信覆盖层同步接入直接平移，并抑制拖拽结束后的误点击选择。
- **轴测 Layer 去重配色**:仅 PP0–PP3 的首层 L0、L12、L23、L35 保留完整算子语义色和不透明度；同一 stage 内其余重复 Layer 继续保留几何、文字、连线与交互，但在轴测视图统一使用中性色并降至 `8%` 近透明；hover 任一对象时，其所属 Layer 临时恢复 `100%` 不透明和完整语义色，移开后回落，选中/执行联动常驻态最多恢复至 `28%`；正视和侧视配色不受影响。

## 2026-07-15 — openPangu PP 边界增加双向通信桥
- **侧视 PP Send/Recv 语义**(`pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html`):三个 PP stage 分割点常驻紧凑黄色 `===` 桥，并稳定排在 PP 标签下方；hover、键盘聚焦或选中后展开为 `F ACT ===▶` 与 `◀=== dH B`，明确区分前向 activation handoff 和反向 dHidden return。通信桥复用原 Layer-gap 数据键、Tooltip、去色聚焦与 Swimlane 下钻，PP 竖线仍只表示模型切分位置；侧视投影使用独立的 80% 默认 Fit 比例，不再继承正视/轴测的 50%。
- **补充通信数值与命中优先级**:桥默认直接显示最大 `Exposed µs`，展开后分别显示 Forward activation / Backward dHidden 的 Payload 与 Exposed，Tooltip 展示两相独立的 Active、Wait、Exposed，并注明 Send/Recv 两端观测不可相加；删除侧视旧 EP token-flow 紫线及 hitbox，桥 hover 会优先截断底层 3D raycast，避免不可见 EP 对象覆盖 PP Tooltip。

## 2026-07-15 — AscendPort 恢复源端不兼容算子标识
- **由算子映射恢复风险节点**(`ascendport_migration_V3_MLA_pto.html` + `mla-model-architecture/assets/modelviz.html`):删除常驻 Operator Association 面板后，图节点继续从 18 条算子关联映射中聚合 `removed_with_replacement` / `planned_not_emitted` 风险；默认二级折叠态在 Kernel Dispatch、QK + PE Score Compute、Probability · Value 上显示 danger 加粗边框与“不兼容” badge，展开后精确落到 `T.use_swizzle(10)` 以及 3 个 `T.GemmWarpPolicy.FullCol` 算子。点击风险节点时优先展示不兼容映射、源端原语和替换状态，同时保留原有源码行高亮联动；S6 精度边框可独立覆盖算子结果颜色，不会抹掉兼容性 badge。运行时回归覆盖默认 3 个、展开 4 个风险节点以及 root 折叠聚合。

## 2026-07-14 — Pangu 训练时空透视卡片补充版本入口
- **首页版本按钮**(`launch.html`):把原 `Light / Dark` 两个主题入口合并为 `V1`，保留页面内主题切换；新增 `V4`，指向带并行事件标识与通信泳道缩放的 `op-rank-time-openpangu-flash-events.html`，原 `WZH-Temp` 入口保持不变。

## 2026-07-14 — AscendPort example_mla_decode.py 架构与算子关联映射独立预览
- **纠正事实源并可复现提取**(`ascendport_migration-pangu/mla-model-architecture/`):提取脚本直接读取项目自带 `ascendport_migration_MLA_A3_updated.zip` 中 `_legacy.js` 的 `const CUDA` payload，恢复并校验 TileLang `example_mla_decode.py`，不再误用外部 DeepSeek `model.py`，也不受工作区顶层旧 FlashAttention V2 payload 污染；输出源码 SHA-256 与可查看的 source mirror。
- **重建算子架构**(`outputs/model_architecture.json` + `model_architecture_graph.json`):完整覆盖 `flashattn`、`main_split`、`main_no_split` 与二阶段 split combine，共 29 nodes / 42 tensor-state edges / 8 nested clusters；主链严格按 dispatch → staging → QK/PE → online softmax → P·V → normalize/store → output 自上而下排布，仅输入搬运与条件 split-KV 保留天然并行侧路；默认 `num_split=1` 与条件 split-KV 路径通过 branch/constraints 分离表达，形状、dtype 和约束只进入 edge tensor/attrs。
- **新增算子关联映射**(`outputs/operator_mapping.json`):建立 18 条「TileLang 源原语 → Atlas A3 / Ascend 910C 目标 API」关系，每条记录关联 graph node、源码行、目标执行单元、映射类型及实现状态；明确 `exp2→Exp` 数值重写、warp/swizzle 删除替换、split-KV 二阶段待实现，并标出 S2 计划 P·V=`Mmad` 与 S6 原型 `Axpy` 的 codegen divergence。
- **共享 pattern 联动预览**(`assets/modelviz.html`):继续通过 `PtoModelGraphvizPattern.renderController` 渲染；MLA Decode → major stage → operator sublayer 三层父子结构支持节点内“+”展开、父框右上角“−”折叠、全局“折叠至二级/展开全部”，折叠时会重投影边与可见节点并按可见子节点重算父框，映射聚焦会自动展开祖先；右侧使用 `panel-shell / toolbar-readout / btn` 与共享 tokens 展示可点击映射列表，图节点可反查源原语、目标 API、执行单元、状态、源码证据和 tensor 关系；canonical/layout、默认/全展开 sibling-overlap、折叠交互与内联脚本校验通过。
- **按 openPangu 参考完成布局与交互收口**(`assets/modelviz.html` + `validate_modelviz_runtime.mjs`):图面改为 480px 宽的单一居中主脊，Q/KV staging 仅在入口处左右对称，`num_split=1` 默认 store 回归主线，条件 split-KV 与 workspace 固定在右侧 lane；折叠后按可见子树动态回流并重算 cluster，局部开合保持点击模块的屏幕锚点，缩放/Fit 与映射聚焦沿用共享控制样式；同步嵌入 schema/graph/mapping 作为 `file://` 回退。新增执行页面真实投影函数的运行时校验，覆盖默认二级折叠、全展开、父/root 折叠、零重叠、主线单调、Q/KV 对称、隐藏边端点、映射自动展开与锚点零漂移。
- **修正 Kernel Dispatch fan-out 起点**(`extract_mla_architecture.py` + `assets/modelviz.html`):`e_dispatch_q / e_dispatch_kv` 显式使用同一个 bottom-center source port；运行时按当前折叠布局生成一段共享竖直 trunk，再以圆角正交路径分向 Q/KV staging，避免 renderer 因横向距离较大而自动吸附到算子左右边缘。运行时校验新增共享端口、同一 junction 与双分支断言。
- **整理输入区线路走廊**(`extract_mla_architecture.py` + `assets/modelviz.html`):输入拓扑改为 Q tensors 左侧、Runtime Config → Kernel Dispatch 居中、KV tensors 右侧三走廊；Runtime Config 移至 Dispatch 正上方，四条 tensor edge 沿外侧竖直下降，越过 Dispatch 后再正交转入 Query/KV Stage 的独立外侧 top ports，避开控制主线和 dispatch fan-out。运行时验证新增中线对齐、外侧 corridor、目标端口和 bridge 区间断言。
- **把 staging 入边改成真实 fan-in**(`assets/modelviz.html` + `validate_modelviz_runtime.mjs`):Query/Position Query 与 Latent KV/Position Key 分别先汇入组内 data merge，随后各组在 Input Staging 父框上方与对应 Dispatch 分支汇合；同一 staging 的三条入边共享最后一段竖直 trunk、top-center 端口和箭头位置，不再出现节点顶部三个独立入口。回归断言验证组内 shared waypoint suffix 与 Dispatch final junction 完全一致。
- **替换 AscendPort 原工作台计算图**(`ascendport_migration_V3_MLA_pto.html` + `mla-model-architecture/assets/modelviz.html`):原“算子计算图”页签不再渲染旧 `GNODES/GEDGES` 图，而是同源嵌入由项目自带 `example_mla_decode.py` 提取的已确认 ModelViz；保留上下主线、父子折叠、fan-out/fan-in 路由和 18 条算子关联映射。iframe 与工作台保留 ready/focus 消息桥，旧节点入口会映射到对应 MLA canonical node。
- **算子详情改为节点侧浮层**(`ascendport_migration_V3_MLA_pto.html` + `mla-model-architecture/assets/modelviz.html`):移除原工作台图底部的常驻详情栏；点击图节点或右侧映射后，详情改用共享 `pto-model-graphviz-hover` 样式锚定在目标算子右侧，空间不足时才翻到左侧，并在缩放、拖拽、Fit、折叠/展开和窗口尺寸变化后重新定位。浮层展示源码原语、Ascend target、执行单元、映射关系、实现状态与 `example_mla_decode.py` 行证据。
- **修复嵌入页点击无反馈**(`ascendport_migration_V3_MLA_pto.html` + `mla-model-architecture/assets/modelviz.html`):iframe `src` 增加 `operator-popover-v2` UI 版本，child ready 消息同步携带 `uiVersion`；父页发现缓存的旧子页面时会追加唯一 `reload` 参数强制刷新，避免“旧 child 只发 selection、新 parent 已移除底栏”导致点击看似无响应。集成校验新增 versioned URL、ready 握手和 click → selection handler → popover 链路断言。
- **浮层提升为跨 pane 上下文菜单**(`ascendport_migration_V3_MLA_pto.html` + `mla-model-architecture/assets/modelviz.html`):嵌入模式不再把详情卡挂在 iframe 内；child 发送选中节点的 viewport rect，工作台在顶层 `body` 渲染 fixed `pto-model-graphviz-hover`，默认锚在算子右下角，只有触及浏览器 viewport 才向左/向上翻转。菜单可越过计算图 pane 与 iframe 边界，不受其 `overflow:hidden` 截断；平移、缩放、Fit、折叠和 pane resize 会同步更新 anchor。
- **补全折叠模块点击并改为实色菜单**(`ascendport_migration_V3_MLA_pto.html` + `mla-model-architecture/assets/modelviz.html`):选择查找从 canonical nodes 扩展到当前 visible graph，使 `QK + PE Score Compute / Online Softmax / Probability · Value` 等折叠模块代表节点也能触发详情；顶层详情层改为 `surface-1` 实色灰背景、标准 elevation shadow、无透明 blur，并设为纯展示点击穿透，避免遮在其他算子上方时吞掉后续点击。iframe UI 版本提升至 `operator-context-menu-v4` 强制刷新旧缓存。
- **S6 精度报告复用架构图并叠加逐算子结果**(`ascendport_migration_V3_MLA_pto.html` + `_legacy.js` + `mla-model-architecture/assets/modelviz.html`):精度页签新增同源 `example_mla_decode.py` ModelViz，不复制第二套架构数据；5 条校验结果显式映射到 8 个 canonical operator node，异常/通过/已修复分别以 danger/success/primary 加粗原节点边框和节点内 badge 表达，折叠父节点汇总子算子状态。应用 FP32 修复后通过消息桥原位切换为复测结果，图的展开与视口状态不随报告刷新丢失；点击任一精度节点仍使用顶层右下角上下文菜单，并补充 S6 metric。
- **修正 S6 图表同屏与原计算图入口**(`ascendport_migration_V3_MLA_pto.html` + `_legacy.js`):精度页从“架构图在上、长报告在下且共用纵向滚动”改为宽屏左右双栏、窄屏上下分区，架构图始终占据独立 pane，只有右侧/下方报告区域滚动，不会再因报告滚动把图移出视口；S4 曾移除的原“计算图”页签在进入 S6 时显式恢复，并固定在横向滚动页签条左侧，始终可见且可随时切回原计算图。
- **收紧 S6 精度页信息密度**(`ascendport_migration_V3_MLA_pto.html`):删除计算图区域内重复的“MLA 算子架构 · 精度叠加”标题、说明和三状态图例整栏，让 iframe 直接占满图 pane；KPI、逐算子表格、异常/修复说明卡统一使用更紧凑的 token spacing 与工具表格行高，窄面板把更多高度分配给架构图，报告继续独立滚动。
- **恢复精度图默认 Fit 与原生交互**(`mla-model-architecture/assets/modelviz.html`):精度消息不再通过 `renderGraph({preserveTransform:true})` 销毁并重建 controller，而是在现有 visible graph / SVG 上原位清理并更新状态边框和 badge；因此拖拽、缩放、折叠、选中状态及 renderer 的 ResizeObserver 行为保持原样。精度 iframe 首次拿到叠加数据、pane 尺寸稳定后仅执行一次 Fit，后续修复复测只换状态装饰，不重置用户视口。
- **恢复精度 Tab 的 S6 执行门禁**(`ascendport_migration_V3_MLA_pto_legacy.js`):删除为调试预览加入的 `?analysis=accuracy` 启动旁路，页面初始化重新严格只解锁“计算图”；“精度”唯一解锁点是 S6 执行完成后的 `openAccPanel()`，并给 legacy 脚本增加 `workflow-gate-v9` 缓存版本，避免旧旁路继续命中浏览器缓存。
- **保持计算图入口并恢复源码联动**(`ascendport_migration_V3_MLA_pto.html` + `_legacy.js` + `mla-model-architecture/assets/modelviz.html`):移除 S4 对已解锁“计算图/生成代码”Tab 的删除操作，后续阶段只增量解锁新视图，迁移完成后仍可切回原计算图；ModelViz selection 现在携带 canonical provenance 行号，折叠父节点会汇总所有子算子的离散源码行。工作台按需加载提取产物 `outputs/example_mla_decode.py`、切回对应源码页签并精确高亮/滚动，详情浮层与源码定位可同时触发；UI 缓存版本提升为 `source-link-v10`，集成断言覆盖 Tab 单调解锁与 `selection → source` 消息链。
- **修复 GitHub Pages 的 pattern API 版本不匹配**(`mla-model-architecture/assets/modelviz.html` + validators):Pages 按主仓库 gitlink 检出 design-system 子模块 `6941fa7`，其 renderer 有 `renderController/standardColormap` 但尚无本地工作区新版 `modelArchitectureColormap()`，导致线上计算图在初始化时抛错。ModelViz 现对新版 API 做能力检测，可用时保持模型专用配色，否则退回锁定 pattern 自带标准 colormap，布局/折叠/交互不变；UI 版本提升为 `pages-compat-v11`。运行时校验覆盖新旧 API 两条分支，工作台集成校验直接核对 Pages 锁定 pattern 的兼容面。
- **更新 launch-v2 的 AscendPort 默认入口**(`launch-v2.html` + workbench validator):卡片主体和“当前版”由旧目录 `ascendport_migration/` 改为本轮持续维护的 `ascendport_migration-pangu/ascendport_migration_V3_MLA_pto.html`；原页面保留为明确的“旧版”入口。集成校验新增 launch 卡片解析、默认目标与当前版一致性、Pages artifact 目标文件存在性断言。
- **精简计算图侧栏并统一七阶段导航**(`ascendport_migration_V3_MLA_pto.html` + `_legacy.js` + `mla-model-architecture/assets/modelviz.html`):删除占用画布宽度、且与节点右下角详情菜单重复的常驻 Operator Association 面板，保留 18 条映射数据用于节点浮层与源码联动；迁移标题改为“七阶段流水”，进度栏按 `STEPS.length` 动态生成 7 列，并在 S1–S7 下分别显示解析算子、算子映射、代码生成、内存层次映射、分块与流水编排、精度对齐、性能剖析与调优，launch 卡片说明同步为 S1–S7。
- **恢复工作台默认分栏与计算图比例**(`ascendport_migration_V3_MLA_pto.html` + `mla-model-architecture/assets/modelviz.html`):外层主分栏由随窗口增长的 `17/64/19%` 默认比例改为 Explorer `260px`、Inspector `300px` 固定侧栏与中央弹性编辑区，并升级 storage key，避免旧拖拽比例继续覆盖新默认值；ModelViz readable Fit 从 `58%` 恢复为经用户确认的 `44%`，宽画布不再因删除映射面板而自动放大，窄窗口仍可按可用宽度继续缩小。
## 2026-07-14 — training-run-twin 整网图问题徽标补全标题(与所属节点同宽两行标签,不遮挡)
- **问题**:`applyDefaultDiagnosisMarkers`/`drawBadge` 原来只在节点上方画一个 ~57 local-unit 的小红胶囊,固定显示「问题N」,完整标题只能靠 hover 提示查看,图上看不出每个问题具体是什么。
- **改法**:徽标改为「与所属 anchor 节点同宽」的两行标签条 — 上排「问题N」(14px 粗体) + 下排问题标题(11.5px,来自 `diagnosisMarkers[].label`,超出可用宽度时逐字裁剪加省略号)。宽度严格等于 `dims.w`(节点本体宽度)、左右边缘与节点对齐,不会侵入相邻节点/连线的空间;完整标题超长时仍靠 hover 提示补全。six 个锚点节点局部宽度均为 340~480 local units,实测 6 条标题(10~19 字)均能整行显示、无需截断。
- **共锚点堆叠**:`query_tensor`(问题二+三)、`router_gate`(问题一+六)各挂 2 个案例,复用原有「与已放置徽标重叠则整体上移一层」避让逻辑纵向堆叠,互不遮挡,只轻微掠过中间的残差相加「+」圆点(非文字,不影响可读性)。
- 验证:Edge headless 打开 wzh_index,`Fit`+放大后逐个截图 6 处徽标(problem 1/2/3/4/6 已核实),标题完整可读,未发现与相邻节点文字重叠。

## 2026-07-14 — training-run-twin 问题二定位链 HiF8 工作台图表栏重排(窄栏换行) + 诊断时间线标签防重叠
- **图表 grid 单列自适应**:HiF8 case7 工作台原为整宽双列(`grid-template-columns:1.55fr/1.6fr 1fr`),嵌进 ~450px 的问题二定位链中栏后多列 grid 挤爆并溢出容器(图表压叠、文字截断,实测张量分布行 180+389px 超出 450px)。新增 `#locateChainContent .hif8c7 .h8-grid{grid-template-columns:1fr!important}` 让所有图表 grid 换行成单列铺满整栏;KPI 行由固定 5 列改 `repeat(auto-fit,minmax(132px,1fr))` 自适应换行(3+2)。仅作用于本页嵌入态,不影响独立整宽工作台 `hif8-precision-workbench-V3.html`(其有自带内联 `renderTimeline`,且不加载 `hif8-case7.js`)。
- **诊断事件时间线防重叠**:`hif8-case7.js` 的 `renderTimeline` 原将 7 条事件标签平铺在同一水平线,step 52/63/66/78 密集处文字必然重叠。改为「贪心分行 + 引导线」:每条标签落到从坐标轴上探、不与同行既有标签相撞的最低一行,canvas 高度按所需行数动态计算,右溢出时向左夹紧。
- **可疑算子清单重排**:根因分析节的 `.h8-suspect` 原为 `rank + 信息 + 120px 进度条 + nowrap 处置药丸` 四段挤一行,窄栏里信息被压到 ~90px、处置文字截断,很粗糙。改为「rank 在左 + 主栏竖排」卡片:算子名行(标签 + loss 贡献右对齐红字) → 满宽渐变进度条 → SQNR/溢出指标行 → 处置建议 chip(按内容宽、可换行)。数据不变仅重排。
- 验证:Edge headless 打开 wzh_index → 点问题二定位链,逐屏截图确认概览/张量分布/量化误差/误差传播/根因分析各节均单列铺满、数据不截断,时间线 7 条标签分行无重叠,可疑算子 4 张卡片竖排清晰。

## 2026-07-14 — training-run-twin 整网图溢出率角标描边着色修复 + 去掉命中节点涟漪
- **角标描边灰色修复**:右上角溢出率药丸的描边此前被 `model-graphviz-embed/pattern.css` 的 `:root[data-theme='light'] .pto-model-architecture-stage .pto-model-graphviz-node rect`(灰色软描边,specificity 更高)覆盖成灰色。改用 `#graphStage .c7over-badge.c7over-crit/ok > rect { stroke … !important }`(红 `#dc2626`/绿 `#16a34a`,深色 `#ff4b7b`/`#4ade80`)并 `filter:none` 去掉引擎阴影,角标描边恢复与文字同色。
- **去掉涟漪**:`markNodeActive` 不再克隆 `.pto-diagnosis-pulse-ring` 脉冲环,命中节点只保留静态红色描边;删除对应 `@keyframes pto-diagnosis-pulse` 与 `.pto-diagnosis-pulse-ring` 样式。
- 验证:Edge headless 读 `getComputedStyle` — crit 角标 stroke=rgb(220,38,38)、ok=rgb(22,163,74)、pulseRings=0、badges=16。

## 2026-07-14 — training-run-twin 问题二整网图溢出率:命中算子节点本体也加对应颜色描边(与右上角徽标同色)
- 参考 precision-debugger 的 `prec-crit`/`prec-high`(节点 + 右上角角标同色描边):`refreshHif8GraphBadges` 给命中算子节点组加 `c7over-node-crit`/`c7over-node-ok` 类,`wzh_index.html` 补 `#graphStage .c7over-node-* > rect` 描边(红 `#dc2626`/绿 `#16a34a`,深色主题用 `#ff4b7b`/`#4ade80`),`> rect` 仅命中节点本体不波及徽标 rect;复位与逐步重画时一并清除节点类。整网图重建后由 `opv-graph-rendered` 一并重新注入。

## 2026-07-14 — training-run-twin 切换「算子染色」开关后整网图问题标记/溢出率徽标不再消失:opv-modelviz 重建 SVG 后广播 opv-graph-rendered,twin 侧监听并重新注入诊断标记与溢出率徽标

## 2026-07-14 — training-run-twin 问题二整网图区改为「整网图 | 表格」双视图,复用默认 L5 整网图并在算子节点右上角标注溢出率(红/绿 2 档)
- 右列侧栏自上而下 = 训练步回放 scrubber + 白底「整网图 | 表格」切换栏 + 整网图槽 + 表格槽,默认整网图。整网图槽复用默认页面的 L5 整网图卡(.twin-graph-card 原样搬入),表格槽放「层/算子级量化误差指标」表。
- `js/hif8-case7.js` 导出 `overflowMap()`(把每层当前步溢出率按算子名映射到整网图节点 id,同名算子跨块取最差)与 `onStep()` 回调;去掉上一版内嵌 DOM 整网图。
- `js/training-run-twin.js` `applyHif8SidePanel` 重构 + 新增 `refreshHif8GraphBadges`/`scheduleHif8GraphBadges`:在 `#graphStage` 命中算子节点右上角注入溢出率药丸徽标(参考 precision-debugger `.prec-cosbadge`),>1% 红、≤1% 绿,随训练步回放实时刷新;复位时整网图卡搬回原网格并清徽标。
- `wzh_index.html` 补 `.hif8-view-bar`/`.hif8-slot`/`.c7over-*` 样式,`is-hif8-side-table` 只隐藏留在网格里的原位整网图卡。

## 2026-07-14 — training-run-twin 问题详情页「infra层」集群图补悬浮气泡 + 问题 rank「空等」红字
- **infra层集群图悬浮气泡**(`js/training-run-twin.js` + `css/training-run-twin.css`):问题详情页定位链「infra层」的集群图(`#locateInfraHeat`)此前只镜像监控栏 `#heat` 的 util 着色,悬浮无内容。现 `syncLocateInfraHeat()` 一并镜像每个 cell 的 `data-tip`(node/rank/util/温度/HBM/DP·Stage·EP),完全对齐监控栏的 rank 悬浮内容;并给命中问题的 hot/warm rank 追加 `data-tip-warn`,气泡末行以 danger 红字展示「空等」问题描述(死锁/超时/尾延迟,见 `INFRA_HEAT_MAP`)。因 CSS `attr()` 无法给单行上色,气泡改由 JS 挂到 body(跟随光标、不被 overflow 截断),并关掉 `.locate-infra-heat` 的纯 CSS `::after` tooltip 以免双气泡。

## 2026-07-14 — training-run-twin 监控栏改为占整面板 40% + 顶栏 step 合并为「当前/总」
- **监控栏宽度基准**(`wzh_index.html`):网格列由 `1fr minmax(420px, 0.4fr)`(相对整网图列 40%)改为 `1fr minmax(420px, 40%)`,百分比相对 grid 容器=整个大面板,即分辨率足够时监控栏占整面板宽度的 40%,整网图占 60%;仍保留 420px 最小宽度。
- **顶栏进度 step**(`wzh_index.html` + `css/training-run-twin.css`):把进度条左侧的当前 step 移到进度条之后,与总 step 合并为「48,230/12000」紧凑组(新增 `.twin-progress-steps` 内联组避免受容器 `gap:10px` 影响,`/` 用 muted 等宽字体)。两个数字沿用原 `.twin-progress-step` / `--total` 样式,未改动。

## 2026-07-13 — training-run-twin 训练监控侧栏改为弹性宽度(最小 420px / 分辨率足够时占整网图 40%)
- **布局**(`wzh_index.html`):`.twin-center-scroll` 网格列由固定 `1fr 420px` 改为 `1fr minmax(420px, 0.4fr)`,侧栏保持 420px 最小宽度,分辨率足够时取整网图列(`1fr`)宽度的 40%。
- **图表健壮化**(`js/training-run-twin.js`):精度图 SVG 用 `viewBox` + `height:auto`,渲染高度随宽度换算;侧栏变宽不触发 window resize,原来只在 window resize 时重画,导致图表按旧宽高比溢出固定高度网格单元、底部被裁("挤在容器上面")。新增 `ResizeObserver` 观察 `.twin-monitor-sidebar`,尺寸变化时 rAF 合并触发 `syncAccCards / syncInfraCards / syncLocateMetricCharts` 重新测量重画。

## 2026-07-10 — training-run-twin 模型名统一为 Pangu 2.0 flash
- 把 `Pangu-Pro-MoE-72BA16B架构参考.md` 标题+正文、`wzh_index.html` 可见文字里的模型专名 `Pangu Pro MoE 72BA16B` / `Pangu Pro MoE` 统一改为 `Pangu 2.0 flash`;整网图标题实际由 `js/training-run-twin.js` 的 `models.deepseek.name/title` 渲染,一并改成 `Pangu 2.0 flash` / `Pangu 2.0 flash 整网图`,否则静态 HTML 改动不生效。
- 保留 DeepSeek 对比引用(对比对象非本模型)、代码标识符(`PanguProMoE` 模块类名、`data-model="deepseek"`、aria-label/注释)与 72B/16.50B 等架构数字。

## 2026-07-10 — training-run-twin 底部 Timeline dock 自动滚动露出首个问题泳道(健壮化)
- **问题**:底部 Timeline 泳道图默认高度只够显示前几个 rank,首个问题所在的异常泳道(EP rank 23 all-to-all timeout,最后一行)在可视区外,用户以为没有滚动条 / 看不到问题。原有一次性 double-rAF 定位在 workbench-shell split 布局定型前就跑,dock `clientHeight` 可能还是 0,用错误高度算出的 `scrollTop` 之后不再修正。
- **修复**(`js/timeline-swimlane.js`):把定位抽成 `revealAnomaly()`,`viewportH<=0`(dock 尚无高度)时本帧放弃、逐帧重试至多 30 帧,直到容器有真实高度再定位;区分自动/手动滚动(`autoScrolling` 标志 + `userScrolled`),用户一旦手动滚动即不再干预;并在 ResizeObserver(split 拖拽定型 / 首次展开)后补一次定位。异常行按「行尾靠可视区 2/3 处」定位,末行天然完整贴底露出。
- **验证**:Node 静态服务器 + Edge headless 截图,底部 dock 首屏即滚到 R20–R23,红色 R23 TIMEOUT 泳道完整露出。

## 2026-07-10 — training-run-twin 顶栏训练进度条重设计(默认极简 + 悬浮撑大)
- **默认态极简**:去掉原来常驻的 step/epoch 双行文字 + 边框盒,只保留「当前 step 单号 · 进度条 · 总 step 单号」一行,进度条透明无框不再突兀。问题点标注从进度条下方的三角箭头改为**进度条内的带白边纵向线**(`.twin-progress-marker`,P0 红/P1 橙,`box-shadow` 白边),用百分比直接定位,不再测量几何。
- **悬浮态动效撑大**:hover 时整条浮起(surface 底 + 阴影 + 圆角),进度条加粗(5→8px),右侧滑入**进度百分比 + Epoch 进度**(`.twin-progress-detail`,max-width/opacity/位移过渡)。
- 结构调整:markup 换成 `#progressStepCurrent`/`#progressStepTotal`/`#progressTrack`/`#progressDetail`;`renderProgress`/`renderDiagnosisMarkers`/`bindDiagnosisMarkers` 相应改为在 `#progressTrack` 内注入纵向线并做事件委托;删除旧 `.twin-progress-status-info/-row/-pct` 与 `.progress-diagnosis-marker` 样式。

## 2026-07-10 — training-run-twin 问题一 infra 示意图复用外层集群热力图
- **complete reuse**:问题一定位链「infra层」原来画一张独立的 2048-GPU canvas(`#infraHeatCanvas` / `renderInfraHeatSnapshot`),现改为完全复用外层「训练监控 · infra」的集群热力图(`#heat` 的 DP4×PP8×EP64 网格)。新增 `syncLocateInfraHeat()`:按同款外壳建格(`renderHeatShell` 增加 target 参数),再把 `#heat` 每个 cell 的 util 着色镜像到定位链里的 `#locateInfraHeat`,并叠加本问题的 hot(EP rank 23)/warm(EP 16–22)标记;随训练 tick(`renderAll`)同步刷新。定位链关闭时 `activeLocateCase` 复位停止镜像。

## 2026-07-10 — training-run-twin 展开图:红框进入、查看/关闭切换、顶栏接管缩放/染色
- **红框进入展开图**:整网图上问题一标红的 MoE FFN 分组框(`moe-block` cluster)背景 rect 现可点击,等同选中问题一并进入模型层展开图(`enterProblemOneLayerView`)。
- **查看/关闭切换**:定位链「模型层」CTA 按钮随展开图开合在「查看」⇄「关闭」间切换(`syncLayerViewCTALabel`),CTA 点击改为开合 toggle;红框/CTA/返回按钮任一路径都会同步文案。
- **进入展开图时整网图消失、顶栏保留接管**:`#graphStage` 与 `.opv-status` 在 `.is-layer-active` 下淡出消失(修正原先指向不存在的 `#modelGraphStage` 的死规则);`.opv-topbar` 保留并作为展开图控制条——`+/−/Fit` 改为缩放展开图 SVG(`lvZoom`/`lvApplyZoom`),「算子染色 关/类别」改为切换展开图配色(`lvColorMode`,局部 LV 遮蔽 `LV_BASE`,off 模式压成中性灰仅保留 cHot 红);顶栏点击由 `bindLayerViewTopbar` 捕获阶段拦截。「层级」下拉在展开图下隐藏(`.lv-topbar-level`)。
- **字号 specificity 修复**:`.diagnosis-severity`(P0/P1 徽标,意图 11px)、`.diagnosis-category`(分类标签,意图 10px)、`.diagnosis-desc`(描述文字,意图 11px)此前一直被 `css/training-run-twin.css` 里更早、更泛化的 `.twin-option span`/`.twin-option small { font-size:14px }` 以更高 specificity(class+type `(0,1,1)` > 单 class `(0,1,0)`)覆盖,导致卡片内所有文字实际都渲染成 14px,标题与徽标/描述没有字号层级。改为 `.diagnosis-card .diagnosis-severity` / `.diagnosis-card .diagnosis-category` / `.diagnosis-card .diagnosis-desc`(双 class,`(0,2,0)`)重新压过前者,徽标/标签/描述恢复到各自设计意图的字号。
- **删除问题七**:移除「q_lora FP8 溢出导致 grad_norm 缓慢发散」诊断卡片(`data-diagnosis="q-lora-fp8"`)及其全部关联数据——explorer 卡片 DOM、`problemMarkers` 里 id 7 的整网图节点标注、`diagnosisCases["q-lora-fp8"]`(架构图概念定位)、`diagnosisMarkers` 里 num 七 的进度条标记、`locateChains["q-lora-fp8"]`(完整定位链步骤)。问题一~问题六保持原编号不变。
- **验证**:Edge headless + CDP 脚本核对卡片数量降到 6、`.diagnosis-severity`/`.diagnosis-category`/`.diagnosis-desc` 的 `getComputedStyle().fontSize` 分别为 11px/10px/11px。

## 2026-07-10 — wzh_index 统一整网图与页面顶栏的主题切换按钮
- **问题**:整网图组件工具栏的 `opvTopThemeToggle`("Dark"/"Light" 文字按钮)、`floatingThemeToggle`(嵌入模式下浮在图上的同款按钮)与页面顶栏的 `#themeToggle`(pill/knob + 文案)是三套并存的主题开关,视觉不统一且语义重复。
- **修复**:参照 `pangu-moe-trainviz/op-rank-time.html` 的 `.opv-theme-toggle` 做法,删除 `opvTopThemeToggle`/`floatingThemeToggle` 两个按钮(`opv-modelviz.js` 原有的 `if(!button) return` 空值保护和 `MutationObserver` 联动重着色逻辑无需改动,元素消失后自动安全跳过),页面顶栏 `#themeToggle` 改成 `.pto-ide-frame__window-action` 单一图标按钮,月亮(浅色态,点击切深色)/太阳(深色态,点击切浅色)两个 SVG 互换,由 `training-run-twin.js` 的 `applyTheme()` 驱动 `#themeToggleIcon.innerHTML` 切换;删除随之失效的 `.twin-theme-toggle`/`.twin-theme-toggle-icon` 私有 pill 样式。
- **验证**:Edge headless + CDP 脚本点击 `#themeToggle`,浅色态显示月亮、点击后深色态显示太阳,整网图组件仍通过 `MutationObserver` 正常跟随重新着色。

## 2026-07-10 — wzh_index 整体接入 patterns/ide-frame(shell-first retrofit)
- **按工作流 B 做 shell-first 迁移**：`Profiling_Insight_and_Tool/training-run-twin-standalone/wzh_index.html` 原有私有 chrome(`.twin-topbar`/`.twin-shell` grid/`.twin-side-pane`/`.twin-panel-toggle`/自制 `.twin-timeline-resizer` 拖拽手柄)整体替换为 `patterns/ide-frame` 标准 shell:顶栏(标题+训练进度+主题切换+Timeline dock 开关)、四键 activity rail(Explorer/Search/Source control/Terminal)、`standalone-vertical`(主区/Timeline dock)+`standalone-main`(诊断列/工作区)+嵌套 `twin-workarea`(整网图/训练监控)三层 workbench-shell split。
- **不用 iframe，本地 vendor 化**:因该 standalone 文件夹会整体移动,不引用 `../../vendor/pto-design-system`,而是把 `patterns/ide-frame`、`patterns/workbench-shell` 的 `pattern.css`/`pattern.js` 直接拷进本地 `css/ide-frame-pattern.css`·`css/workbench-shell-pattern.css`·`js/ide-frame-pattern.js`·`js/workbench-shell-pattern.js`,与既有 `css/model-graphviz-pattern.css` 等本地化资产同构。
- **pane 映射**:「问题诊断」卡片列表 → explorer pane(左, 280px, rail Explorer 按钮折叠);「DeepSeek V3.2 整网图」→ editor-preview pane;「训练监控」→ inspector pane;「Timeline」泳道图 → 底部 bottom-dock(顶栏 "Toggle bottom visualization" 图标开关,替代原自制 resizer+`twinSidebarToggle`/`twinTimelineToggle` 私有实现)。
- **定位链「合并大面板」效果重做**:原 `.twin-work-area.is-merged` 私有实现(白底/边框拼接)改为 `#twinWorkArea.is-merged` 隐藏 workbench-shell gutter + 去掉相邻 pane 的圆角/边框,底色仍走 ide-frame 共享 `--ide-frame-pane-fill`,不再本地覆盖 pane 背景色,浅/深色主题自动适配。
- **`?embed=hardware` 外部嵌入契约保持**:改用新 class(`.pto-ide-frame__topbar`/`#explorerPane`/`#bottomDock`/`.pto-workbench-shell__split-gutter`)重写隐藏规则,效果与迁移前一致(只留训练监控 pane 里的硬件热力图卡片,透明背景铺满 viewport)。
- **container decoration residue check**:清理后 `border-left`/`::before`/`::after`/`outline`/`inset shadow`/`linear-gradient(90deg` 命中项均为已有数据编码(热力图告警框、KPI 状态色条、进度条箭头/流光、事件时间线连接点),或本次新增的“去边框”(`border-left:0` 等,合并态去缝),无遗留的旧卡片装饰性描边/侧边条。
- **验证**:本地起 Node 静态服务器 + Edge headless(CDP 脚本驱动点击)分别截图浅色/深色主题、Explorer 折叠/展开、Timeline dock 开关、点击「问题二 HiF8」进入定位链合并视图,均正常。

## 2026-07-10 — 左侧整网图由 iframe 内嵌改为「直接集成」openPangu-2.0-Flash (wzh_index)
- **去掉 iframe，改为同文档集成**：因整个 standalone 文件夹会整体移动，iframe 方式(即便相对路径)不理想；改为把 `openpangu_2_0_flash_modelviz.html` 组件按「样式/逻辑/数据/引擎」四份资产直接并入 `wzh_index.html`，与页面其它 `js/`·`css/` 依赖同构，随文件夹整体移动无影响。
- **抽出的资产**(经 `scratchpad/gen_opv.js` 从组件 HTML 机械切片生成)：`css/opv-modelviz.css`(组件 `<style>`，去掉会污染父页的全局 `body/html/*` 规则、embed 作用域由 `:root`→`#opvHost`、`height:100vh`→`100%`)、`js/opv-modelviz-schema.js`(内联默认 schema → `window.OPV_DEFAULT_SCHEMA`)、`js/opv-modelviz.js`(组件主逻辑，IIFE 包裹防全局泄漏；`themeToggle`→`opvTopThemeToggle` 避与父页主题按钮 id 冲突；`loadDefaultSchema` 改读全局 schema 不再 fetch；新增 `data-theme` MutationObserver 与父页浅/深色联动)；渲染引擎复用 `model-graphviz-embed/pattern.js`+`pattern.css`(上游新版，含标签避让)。
- **父页接线**：`wzh_index.html` 左侧 `.twin-architecture-stage` 用组件私有 DOM(`#opvHost.opv-app[data-embed=1]` + topbar/color-panel/`#graphStage`/popover/status，`.pto-model-graphviz-pattern-page` 类保留以复刻原 body 变量级联)替换 iframe;head 增 `pattern.css`+`opv-modelviz.css`;底部脚本以 `pattern.js`→`opv-modelviz-schema.js`→`opv-modelviz.js` 顺序替换原 `model-graphviz-pattern.js`/`model-training-graphviz-pattern.js`(旧训练图引擎移除，`renderArchitecture` 因 `PtoModelTrainingGraphvizPattern` 缺失而安全空转);删除已失效的 iframe 主题 postMessage 脚本。展开/下钻/配色/light mode/通信算子/标签避让均由原组件逻辑+引擎原样提供。
- **修复死循环卡死**：主题 MutationObserver 与 `setTheme` 互相触发(observer→setTheme→写 `data-theme`→observer…)导致整页反复重渲卡死;加 `opvLastTheme` 去重，主题未真正变化时直接 return。
- **清理**：删除 `model-graphviz-embed/` 下已不再引用的 `openpangu_2_0_flash_modelviz.html`、`openpangu_2_0_flash_model_architecture.json`、`pangu_moe_modelviz.html`、`pangu_ultramoe_718b_graph.js`、`pangu_pro_moe_72ba16b_graph.js`;该目录仅保留仍在用的引擎 `pattern.js`/`pattern.css`。

## 2026-07-10 — 左侧整网图内嵌组件换成 openPangu-2.0-Flash (wzh_index)
- **整网图组件由 `pangu_moe_modelviz` 换为 `openpangu_2_0_flash_modelviz`**：一模一样复用上游 model-graphviz 组件(展开/下钻、语义配色、light mode、通信算子、标签避让全保留);iframe src 指向新组件。
- **自包含拷贝**：`model-graphviz-embed/` 新增组件 HTML + 内联 schema 的外部备份 `openpangu_2_0_flash_model_architecture.json`,复用已有 `pattern.js`/`pattern.css`;依赖路径改指 standalone `css/`(含 `style.css`),默认 `?theme=light`(组件默认 embed 模式,隐藏顶栏、保留右上角浮动主题按钮)。
- **主题联动**：新组件加 `postMessage` 监听调用自身 `setTheme`(renderAll preserveZoom 不丢缩放),复用父页已有的 `panguSetTheme` 转发,无需改父页脚本。

## 2026-07-10 — 问题一定位链改写为 Pangu Pro MoE 72BA16B 案例 (wzh_index)
- **对齐 `Pangu 72B 定位链.md` 精度案例一**：将问题一（moe-a2a）的图文从 DeepSeek-V3.2 改为 Pangu 72BA16B——问题层 layer 38→30、热点 expert 193→47、其余 255→63 expert、集群 64→32 GPU / EP64→EP32 / PP8→PP4、PP stage 4(layers 31~38)→stage 3(layers 24~35)、精度 FP8→BF16、recv buffer dim 7168→4608（2048×4608×8≈151MB）、修复项 n_group→MoGE group 8→16（每组 8→4）。
- **覆盖范围**：诊断卡/Timeline 副标题/定位节点/定位链各层文案 + send/recv 缓冲图（n 32、满刻度 160、BF16 标注）+ MoE 层展开图 case 标注与 `LV_INCIDENT_*` 常量；MoE 展开图与 infra 热力图几何保持原示意不变。

## 2026-07-10 — training-run-twin 左侧整网图整体替换为 model-graphviz 组件 (wzh_index)
- **完全复用 `pto-design-system/patterns/model-graphviz` 的 `pangu_moe_modelviz` 组件**：把 wzh_index 左侧原 `PtoModelTrainingGraphvizPattern` 整网图替换为该组件，一模一样保留其展开/下钻、语义配色、light mode、通信算子渲染与标签避让实现。
- **自包含内嵌**：新增 `model-graphviz-embed/`（组件 HTML + 上游最新 `pattern.js`/`pattern.css` + `pangu_ultramoe_718b_graph.js`/`pangu_pro_moe_72ba16b_graph.js`），组件以 iframe 内嵌，token CSS 指向 standalone `css/`，离线可运行。
- **主题联动**：组件新增 `postMessage` 监听调用自身 `setTheme`（preserveTransform 不丢缩放/variant/展开态）；`wzh_index.html` 用 MutationObserver 监听 `data-theme` 并向 iframe 转发主题。原 `#modelGraphStage` 换成 `#modelGraphFrame`（id 变更使 `training-run-twin.js` 的诊断高亮等对图操作安全空转），原整网图的错误标签按需丢弃。
## 2026-07-09 — 更新「PTO性能分析」泳道 Profiler (pto-swimlane-profiler)
- 同步 PyPTOUX 最新 swimlane profiler 原型：新增性能统计 / PMU / 优化建议 / 核心详情面板，更新为双 DIE、32 个 1C2V Wrap 的泳道拓扑，并保留 L3 占位数据披露。
- 发布版资源统一指向 `vendor/pto-design-system`；`launch-v2.html` 与旧版 `launch.html` 均指向本地 `pto-swimlane-profiler/index.html`。

## 2026-07-09 — training-run-twin 问题七：HiF8 精度诊断工作台嵌入定位链 (wzh_index)
- **新增「问题七」诊断案例**：把 `hif8-precision-workbench-V3.html` 的「概览 / 张量分布 / 量化误差 / 误差传播 / 根因分析」五页签 100% 搬进「问题诊断」定位链，形式对齐问题一/问题二详情（sticky 定位链栏 + 分节内容 + Canvas 图表）。
- **自包含模块 `js/hif8-case7.js`**：移植工作台的种子 RNG / 数据模型（200 采样步、46 层、culprit blk4.mlp.down_proj 等）与全部 Canvas 渲染（loss 多格式对照 / Δloss / logit 打散度 / 事件时间线 / 直方图 / 动态范围 / 误差表 / 热力图 / 传播柱状 + 累积折线 / 敏感度 / 相关性散点 / 可疑算子清单），去掉工具壳后固定在训练末步（step 10000 已发散）做快照；保留张量类型切换、表头排序、选层联动。`window.PtoHif8Case7.chain()` 提供定位链结构，`renderAll()` 绘制画布。
- **接线**：`training-run-twin.js` 增加 `diagnosisCases`/`diagnosisMarkers`（num 七, P1 精度, step 3150）/`problemMarkers` 条目，注册 `locateChains["hif8-precision"]`，并在 `showLocateChainPanel` 调用 `renderAll()`；`wzh_index.html` 增加问题七卡片、`.hif8c7` 作用域样式与脚本引用。
- **HiF8 案例（现为问题二）整网图位置改放误差表**：该案例是通用 Transformer，整网图无实际层映射；进入时 `applyHif8SidePanel` 把「量化误差」节的「层/算子级量化误差指标」表整卡 + 概览节的「训练步回放」scrubber（DOM 原样搬运，scrubber 在表上方，排序/选层/播放联动照旧）搬到左侧整网图位置并隐藏整网图（`.twin-center-pane.is-hif8-side-table .twin-graph-card{display:none}`），右侧「量化误差」节收成单列只留演化图+热力图；切换到其它问题或关闭定位链时复位。左列用 flex 约束高度，表格 `.h8-table-scroll` 支持横向+纵向滚动、表头吸顶。
- **补回「训练步回放」scrubber**：概览节顶部恢复工作台的播放条（play + 进度轨 + 发散点标记 + STEP/ΔLOSS/均值 SQNR 读数），拖动/播放驱动 `cur` 并 `redraw()` 重绘全部五节随步演化图表（回放量化误差累积过程）；`renderAll` 每次打开重置到末步，`stop()` 在 `hideLocateChainPanel` 关闭时清 interval。
- **统一设计风格**：`.hif8c7` 由独立深色「仪器」皮肤改为设计系统 token（`--h8-*` 变量重映射到 surface/foreground/border-subtle/danger，浅深色主题自适应，与问题二/case6 一致）；画布调色板从工作台深色 hex（#35e0d0/#ff5a6a…）换成 case6 同款浅色语义色（网格 #e5e7eb、蓝 #3b6fe0、红 #dc2626、绿 #16a34a、橙 #ea580c），游标线改深色半透明。

## 2026-06-24 — op-rank-time 四轮：Dense 体量 + light 取色 + 泳道 microbatch 上色 (pangu-moe-trainviz)
- **Dense 放大成 MoE 同级实心块**：根因是 `dense_block` 仅 320×60（单节点），而 MoE 层是 840×970 的 cluster + 多算子，Dense 看着低一级。`addNode` 新增 `box` 覆盖（自定义 graph 尺寸/位置）；Dense 改为 880×820 外壳 + 居中实心大块，落在与 MoE 同一纵向带（y≈430-1250），第一层一眼可读。
- **light 取色 = 低饱和 + 高明度**：`lightCurveForProfile` 锁定 light 饱和度 < dark（clamp .22~.62）、明度 > dark（clamp .70~.88），4 个 LIGHT_VARIANTS 为柔和 pastel；`colorFromStyle` 的 lightBoost 在 light 取正→更亮。（先误改成低明度，已按要求回到高明度 pastel。）
- **泳道 bar 按 microbatch 上色**：原 `emit` 按 microbatch 在算子色间循环，stage0 前几个键同属蓝-青带→视觉全蓝且无意义。改 `taskColor` 按 `kind+microbatch` 取 32-rank 色阶（forward 满色、backward 同色 `darken(0.66)`），可沿流水线追踪一个 microbatch 的 F→B 流转（经典 1F1B 画法）；新增 `darken()`。
- **泳道组内长短**：原 `compDur` 仅按 (stage,type,m)，同组 8 个 TP 行时长完全一致。`emit` 改为每 rank 在调度槽内按 0.70~1.0 填充率（含 ~18% straggler），左对齐→行宽长短不一、尾随空隙真实可见；气泡仍按调度槽精确对齐。
- **palette-lab.html**（codex 建，保留）：copy 更正为「light 饱和度+明度都低于 dark」；`op-rank-time.html` 的 `SELECTED_PALETTE_ID/LIGHT_VARIANT_ID` 改为读 `localStorage`（lab「Use」选中→Viz 刷新生效）。

## 2026-06-24 — op-rank-time 三轮：根因修复层序 + 真实泳道 (pangu-moe-trainviz)
- **找到「最前仍是 MoE」根因**：所有架构网格 `transparent:true + depthWrite:false`，于是遮挡只靠 `renderOrder=20+layer`——靠后的大 MoE 专家池（order 大）画在靠前 Dense 之上，看着像 Dense 在后。修复：`addNode` 的 opaque 分支改 `transparent:false + depthWrite:true`（真正写深度→正确遮挡），`OPACITY.opaque*`→1.0。
- 第一层(L0 Dense)+最后一层(L60 MoE)全 solid：新增 `SOLID_LAYERS`/`isSolidLayer`；L60 的 cluster/专家池/算子节点全部 opaque、可读完整 MoE 架构；solid 专家池 `z-=ARCH_THICK*0.6` 退到算子之后避免 z-fight。
- 淡化专家池新增 `hiCap`：自动 active 高亮封顶 0.42，近前排 MoE 池不再被 tick 冲成大绿块（hover 仍可看全）。
- 泳道真实化（保 PP=2 真实 32 卡配置 dp2·pp2·tp8）：新增 `compDur(stage,type,m)`，按 stage（深层 MoE 更重）+ 逐 micro-batch token 负载不均衡产生 0.74~1.36× 异构时长（bar 有长短）；`simulate1F1B` 导出 `stageOps`，`build1F1B` 据相邻 op/首尾空闲生成 `kind:'bubble' status:'wait'` 真实 warmup/steady/drain 气泡（斜纹绘制）；计算条用调度精确 start/dur 让气泡对齐。

## 2026-06-24 — op-rank-time 二轮修订（按截图反馈） (pangu-moe-trainviz)
- 3D「最前仍是 MoE」修复：Dense 与 MoE 之间加 `DENSE_MOE_GAP` 间隔；`isMajorLayer` 去掉 `layer<5`（前排 MoE 改 ghost，详细 MoE 每 10 层一张，绿色专家池不再压在 Dense 前）；三层 Dense 全部不透明。
- 配色真正改用 colormap.js 调色板：弃用「任意 HSL 色相」，改 `DS_PALETTE`（CORE emerald/teal/cyan/sky/blue/indigo/violet/purple + categorical pink/orange/green）经 `softHex` 降饱和/压暗——明显是 DS 取色，dark/light 同源。
- 播放条文字截断：`--floating-playback-expanded-width` 560→680px；opname 去掉 rank 前缀、专家池长标签截断为 `phase mN · L# · 短label`。
- swimlane 太密：`ROW_H` 16→24（留白），通信条改底部一条 4px 子轨；时间轴跳过 i=0 刻度文字避免与左表头重叠。

## 2026-06-24 — op-rank-time 优化二轮：真实 swimlane + 配色/文字/层序 (pangu-moe-trainviz)
- DS 来源切到 vendored 子模块：12 处引用 `../pto-design-system/` → `../vendor/pto-design-system/`（CLAUDE.md 规定的运行时真源；vendored 的 `swimlane-task` 已内置单段模式）。ide-frame/floating-playback/workbench-shell 的 pattern.js 与外部副本逐字一致，切换安全。
- `swimlane-task` pattern 补文档化「单段规则」：`pattern.json` description/useWhen 增补 + 新增 `rules` 项——无 `inputRawMagic/outputRawMagic` 时画单条实心 bar，不画 IN/OUT 三段（行为本就在 vendored pattern.js，此次写成契约）。
- 底部 swimlane 重写为 **32 rank 行真实感 1F1B**：list-scheduling 模拟器（PP 前向 0→1 / 反向 1→0 依赖，自然产生 warmup/steady/drain bubble），wall-clock µs，非均匀 F/B 时长 + 每 rank 抖动，TP All-Reduce / EP All-to-All / PP send-recv 通信条；单 canvas + 顶部时间轴 + 纵向滚动 + playhead（跟 tick）+ 逐 bar hover/点击 seek；rows=rank0-31（dp2·pp2·tp8 分组）。垂直 split 60/40 给 swimlane 更多高度。
- 配色改取 design-system colormap light mode（`PtoSwimlaneTaskPattern.hslToHex`，降饱和 s44 / 中明度 l54）：节点语义色、通信连线色、弹窗图例（`data-sem`/`data-line` 由 JS 统一上色）三处同源——图例=场景=swimlane。
- 3D 节点文字：居中、去掉白色描边；on-node 文字 light=黑 / dark=近白（`nodeLabelColor()`）。
- 层深度反转：数据流 Embedding(最前)→Dense L0→…→L60 MoE→Final/Head(最后)，最前最显眼的是不透明的 Dense L0，消除「看起来从 MoE 开始」的误读（Dense/MoE 划分本就正确：L0-L2 Dense、L3-L60 MoE）。

## 2026-06-24 — op-rank-time 接入设计系统 (pangu-moe-trainviz)
- 页面框架改用 `ide-frame` pattern（standalone host，铺满视口；左=图例/坐标系，中=3D 舞台，右=聚焦面板，底=全宽 swimlane 面板，nested 垂直/水平 split 经 `workbench-shell`）。
- 底部 swimlane 改用 `swimlane-task` pattern 的 canvas 渲染（`drawTaskBar` + 逐像素 hover tip），替换原 CSS grid。
- 播放控制条改用 `floating-playback-control`（替换自绘 `#transport`）。
- 移除页面本地 `:root` tokens，改用设计系统 token 链；3D 语义色/通信色作为可视化色保留。
- 模型节点透明度调整：顶/底一次性算子 + 默认第一层 Dense 不透明；普通节点整体提亮；三层 Dense 均可见以体现 first_k_dense_replace=3。
- 左侧「图例/坐标系」面板改为右上角 info icon 点击打开的浮层弹窗；横向 split 收为 2 栏（3D 舞台 + 聚焦），3D 舞台变大。
- DS 引用改走仓库内 symlink `pto-design-system -> /Users/yin/pto-design-system`，路径用 `../pto-design-system/`，从 `/Users/yin/pto`（项目默认 root）或 `/Users/yin` 起服务均可解析（修复此前从 pto root 起服务时 DS 404、module 在 import 处即崩、页面全空的问题）。

## 2026-06-13 — 新增「TrainScope · 盘古训练透视」(pangu-moe-trainviz)

**主题：Pangu Pro MoE 分布式训练正确性排障可视化，五大对象一屏闭环 + 全局关联**

- `pangu-moe-trainviz/`（新增）：纯原生 demo，消费设计系统。顶部效果时间轴①／左参数信号面板④／中央 Pangu Pro MoE 架构图②／右权重 Shape Inspector②／底部分布式通信 dock⑤，workbench-shell 嵌套分栏（dock 高度可拖）。三广播通道联动：兴趣窗口框选 + 选中双向高亮 + step 游标。叙事=Step1997 混合精度写越界→路由坍缩六步闭环。
- 设计系统（`vendor/pto-design-system`）：新增共享 pattern **`training-metrics-chart`**（自绘 SVG 训练指标折线图，走审批门）；并把 **`model-training-graphviz`** 从 standalone 同步进子模块。两者注册入 `patterns/patterns.json`。
- `launch.html`：模型训练推理组挂入口。

## 2026-06-08 — 新增「计算图 Profiling 证据工作台」(graph-evidence-workbench)

**主题：从 MindStudioNext 计算图 tab 抽取的独立浅色证据工作台，模型图 + 右侧 Inspector + 底部泳道证据联动**

### `Profiling_Insight_and_Tool/AI_Profiling_Tool/graph-evidence-workbench.html`（新增）
- 浅色模式（`data-theme="light"`），复用 PTO tokens 与 `model-graphviz`/`swimlane-task` pattern。
- 模块化：`js/graph-evidence/{core,trace-parser,loader,inspector,graph-stage,swimlane-stage,app}.js`，契约见同目录 `CONTRACT.md`。
- 业务数据全部外置到 `data/qwen2-7b.*.json`（graph/node-info/problem-map/demo-report/trace_view/evidence fixture），带 `schemaVersion` 校验。
- 真实解析 Chrome Trace Event 格式 `trace_view.json` → Step/Stream/Communication/Overlap/Coverage 泳道；图节点 ↔ 泳道 task ↔ Inspector 四向联动；priority 过滤、深链(reportId/nodeId/priority/stepId)、导出快照、复制证据。

### `launch.html`
- 新增「计算图 Profiling 证据工作台」入口卡片。

## v1.1 — 2026-03-26

**主题：Memory Viewer 全面重构 — 真实 tile graph + 暗色模式 + liquid glass 工具栏**

### `mem_viewer/index.html`

- 布局从左右分屏改为**上下分屏**：上 58% 为计算图，下 42% 为内存架构图
- Header 复用全局 `.toolbar` 样式，badge 更新为新图名 `IndexerPrologQuant · PATH0_leaf293`
- 引入 pass-ir 渲染栈脚本（`colormap.js` / `parser.js` / `layout.js` / `renderer.js`），通过 `<script>` 全局加载
- 底部操作栏改为**居中悬浮工具栏**，不再铺满宽度
- AIV 区块因本 subgraph 无 UB 操作，标记为半透明 dim 状态
- 补充 `det-magic` span 用于显示当前执行 op 的 magic ID

### `mem_viewer/styles/main.css`（完全重写）

- 全局暗色模式对齐 PTO 设计系统，使用 `--canvas-bg: #1a1a1a` 等全局 token
- 架构图 buffer 盒子全面切换为暗色调色：L1/L0A/L0B/L0C 使用 `rgba` 半透明着色，保持视觉层次
- 悬浮工具栏实现 **liquid glass** 效果：`blur(32px) saturate(180%)` + 顶部内高光 + 多层阴影
- 工具栏居中定位（`left:50%; transform:translateX(-50%)`），宽度自适应内容，风格对齐 pass-ir nav pill
- 计算图节点状态 CSS：`.mv-op-executing`（amber glow）/ `.mv-op-done`（50% opacity）/ `.mv-op-pending`（25% opacity）
- tensor 高亮：input 蓝边 glow / output 绿边 glow / live 正常 / dim 淡出

### `mem_viewer/data/sample-graph.json`（新增）

- 从 `output_deepseek/Pass_33_RemoveAlloc/` 选取真实 tile graph subgraph
- 图名：`TENSOR_IndexerPrologQuantQuantLoop_Unroll1_PATH0_leaf293_319`
- 128 个 op，涵盖 `COPY_IN / L1_TO_L0A / L1_TO_L0B / A_MULACC_B / COPY_OUT` 等完整 tile 流水线

### `mem_viewer/data/ops.js`（重新生成）

- 从 `sample-graph.json` 自动生成，格式维持 `{m, n, i, o}`
- 新增 `TENSOR_TOBE` Map，直接从 JSON `mem_type.tobe` 字段获取 tensor 所在内存层（1=L1, 2=L0A, 3=L0B, 4=L0C, 15=DDR）

### `mem_viewer/js/graph-viewer.js`（新增，替换 svg-viewer.js）

- 加载 `sample-graph.json`，调用全局 `parseGraph()` / `computeLayout()` / `renderGraph()` 渲染计算图
- compact LR 布局，复用 pass-ir 渲染器的节点卡片样式
- 通过 `data-node-id` 属性（`op_<magic>` / `t_<magic>`）驱动逐步高亮
- 保留完整 fit/zoom/pan/平滑动画功能，`centerOnExecuting` 基于 layout positions 直接计算

### `mem_viewer/js/constants.js`

- 移除旧的硬编码 `DDR_TENSORS` Set，改用 `TENSOR_TOBE` 查表实现 `getTensorTier()`
- op 名称映射更新为无 `TILE_` 前缀版本（`COPY_IN` / `L1_TO_L0A` / `A_MULACC_B` 等）

### `mem_viewer/js/schedule.js`

- 移除 topo sort，直接使用 JSON 中 ops 的自然顺序作为执行调度（本 subgraph ops 已按执行序排列）
- 移除 `PRE_EXISTING` 硬编码集合，liveness 完全由 producer/consumer 关系推导

### `mem_viewer/js/memory-panel.js`

- 架构图 tensor chip 配色全面切换为暗色 `rgba` 调色板，与新 CSS 一致
- 移除不再使用的 `darkenColor` 工具函数

### `mem_viewer/js/playback.js`

- import 从 `svg-viewer.js` 切换为 `graph-viewer.js`，函数名对应更新（`loadSVG` → `loadGraph`，`applyStepToSVG` → `applyStepToGraph`）

---

## v1.0 — 2026-03-25

**主题：Swimlane 顶部信息架构重组**

### `swimlane/index.html`

- 顶部工具栏收口为“搜索 + 资源”两类全局入口，移除直接暴露的文件绑定、对比绑定、Program 绑定和缩放按钮
- 新增 `资源管理` 面板，统一承载模块目录导入与手动覆盖入口
- 在主图上方新增 `数据模式条`，集中放置 `Before / After` 与 `单视图 / 对比 / Diff`
- 将图表控制重新分成 `筛选` 和 `显示` 两组，缩放也并入图表控制层

### `swimlane/app.js`

- 新增资源面板开关、状态刷新和外部点击收起逻辑，资源绑定不再散落在顶部 / Journey / popup / detail 多处
- 新增 `单视图 / 对比 / Diff` 三态切换：`Diff` 只负责差异摘要，`对比` 负责双图对照，`单视图` 收起参考泳道
- 数据模式条中的状态展示改为结构化 pill，统一显示主泳道、参考泳道、Program、源码绑定状态
- 切回内置 `Before / After` 样例时，会同步清理旧的本地 compare 上下文，避免视图状态和数据来源错位
- Journey 第 3 步保留资源快捷入口，但统一跳到顶部资源面板；task popup、detail panel 中移除了重复的 Program 绑定入口

### `swimlane/styles.css`

- 新增资源面板、状态 pill、数据模式条与分组后的图表控制条样式
- 为资源状态增加按类型区分的视觉层级：主泳道 / 参考泳道 / Program / 源码不再混成同一类按钮
- Journey 中未绑定资源改为只读状态块，不再伪装成第二套资源导入按钮

## v0.9 — 2026-03-25

**主题：Swimlane 模块目录导入 + 深入任务卡片联动**

### `swimlane/index.html`

- 顶部工具栏新增「选择文件夹」入口，支持直接导入整个 `output_deepseek` 模块目录
- 新增隐藏目录 input（`webkitdirectory` / `directory`）作为 `showDirectoryPicker` 的 fallback
- 空态文案改为强调可直接识别 `merged_swimlane.json` 与 `program.json`

### `swimlane/app.js`

- 新增目录扫描与资源识别逻辑：遍历本地目录 JSON，自动识别 `merged_swimlane.json`、`stitched_before.json`、`stitched_after.json`、`program.json`
- 目录扫描扩展到模块源码：识别 `lightning_indexer_prolog_quant.py` 等 `.py` 文件，供 Source Flow 直接打开本地源码
- 目录导入后自动装配主泳道 / 对比泳道 / Program 绑定；若目录内同时存在 before / after，则默认一起挂上 compare
- `bindingStatus` 增加目录绑定态展示，避免只显示 Program / Compare 而看不出当前模块上下文
- “深入任务”卡片从 stub 改为真实状态机：根据当前选中 task、Program 绑定、task 的 `callOpMagic` / `semanticLabel` 动态启用
- 新增卡片动作：`显示前后依赖连线`、`Pass IR 分屏联动`、`Source Flow 分屏联动`
- 目录绑定后，即使还没选 task，也可以先打开整体 `Pass IR` / `Source Flow` 视图；只有“依赖连线”仍要求先选 task
- compare 视图选中 task 时，依赖连线动作会尽量回落到主图对应 task，并滚动定位后显示依赖 overlay
- 内置样例与单文件导入时会清掉旧目录 / Program 绑定，避免沿用过期模块上下文

### `swimlane/styles.css`

- 为“深入任务”卡片新增真实 disabled 态样式，不再使用误导性的灰色 stub 按钮
- 为目录绑定态新增蓝色信息条样式，与 Program 绿色已绑定态区分

---

## v0.8 — 2026-03-13

**主题：V3.2 Attention 集群重构为五个官方 PyPTO 算子**

### `mvp/app.js`

- **L4_H 44→36**：L4 细粒度节点高度减小，容纳更多算子不撑高画布
- **`inferStage` 扩展**：新增 `mla_*` / `lightning_*` / `sparse_*` 前缀映射到 `attention` stage
- **`buildAttentionClusterV32` 重构**：将原 10 个 Q/KV 细粒度 L3 节点 + 5 个中轴节点，重构为对应官方算子的 5 个 L3 块：
  - `mla_prolog_quant`（宽块，双列 L4）— 替换原 qColumn × 4 + kvColumn × 6
  - `lightning_indexer_prolog_quant`（宽块，3 列 L4）— 替换原 `attention_idx_prolog`
  - `lightning_indexer`（标准 L3）— 替换原 `attention_idx_topk`
  - `sparse_flash_attention_quant`（标准 L3，L4 展开 6 步）— 合并原 `rope_compose + sparse_attn`
  - `attention_out_projection`（标准 L3，保持不变）
- **`mla_indexer_prolog_quant` 融合标注**：虚线框环绕 mla_prolog + indexer_prolog 两块，表示可被此融合算子替代（流水并行）；标签定位在框底部 93%
- **Bypass 连线**：从 `mla_prolog_quant` 右侧引出，绕过 indexer 路径直连 `sparse_flash_attention_quant`，表示 q_nope / q_rope 的直接数据流
- **`sparse_attention_antiquant` 注解**：在 `sparse_flash_attention_quant` 下方添加 annotation 标注（存8算16 优化变体），无额外节点
- **新增 `buildMlaPrologL4`**：双列 L4 builder（Query 路 8 步 | KV 路 7 步），类比现有 `buildIndexerPrologL4`
- **更新 `L4_DETAILS.v3_2`**：移除已不作为 L3 顶层节点的旧 `attention_*` 键，新增 `lightning_indexer` / `sparse_flash_attention_quant` 的 L4 子步骤

**层级关系**（数据来源：`deepseek_v32_exp/README.md`）：
```
L1: MLA + Lightning Indexer
└── L2: 展开
    ├── [mla_prolog_quant]             L3  →  L4: Q/KV 双路
    ├── [lightning_indexer_prolog_quant] L3  →  L4: Q/W/K 三列
    ├── ╌╌ mla_indexer_prolog_quant ╌╌  融合标注（虚线框，非节点）
    ├── [lightning_indexer]            L3  →  L4: Top-k 流程
    ├── [sparse_flash_attention_quant] L3  →  L4: gather+RoPE+attn
    │    · sparse_attention_antiquant (注解)
    └── [attention_out_projection]     L3
```

---

## v0.7 — 2026-03-12

**主题：MVP Pill 视觉细节修复**

### `mvp/app.js`

- **同色域取色**：复用 `colormap.js` 的 `getLaneColors(5, 220, 40)` 在蓝色弧段（220°–260°）内分配 5 个 stage（attention→norm→ffn→residual→moe），与 visual-test 单 pipeline 内部取色逻辑一致；per-stage gradient 保留，色相同族无 rainbow 跳变
- **Label 展开后不再移动**：`FlowGroup.toggleCollapse` 动态计算 `refY` 百分比（`headerMid / newHeight × 100%`），展开时文字固定在 header 区域顶部，而非随全高居中漂移
- **移除顶部扁矩形**：删除 FlowGroup markup 里的 `highlight` rect（其 `rx=20, height=2` 导致 SVG ry 超过高度一半，渲染为退化椭圆薄条），同步删除 `toggleCollapse` 里的 highlight visibility 调用
- **连线改为灰色**：`addEdge` stroke 由 `LINE (#333333)` 改为 `#BBBBBB`
- **Pill 描边统一**：所有 pill 变体（summary / io / detail-op / FlowGroup body）stroke 改为 `rgba(255,255,255,0.20)`，strokeWidth 统一为 1

---

## v0.6 — 2026-03-12

**主题：MVP 节点层级尺寸系统 + Pipeline 染色**

### 尺寸系统重构（`mvp/app.js`）

**问题**：旧常量 `MAIN_W=264`、`OP_HEADER_H=38`、`L4_W=126`、`L4_H=26` 等无层级语义，尺寸不与设计图和主计算图对齐。

**重构方案**：以 L4 compact op 为锚点，从下往上推导四级尺寸：

- **L4**（detail-op）：`L4_W=150, L4_H=64` — 与 `layout.js` `NODE_W` + `NODE_HEIGHTS_COMPACT.op` 完全一致
- **L3**（fusionNode collapsed pill）：`L3_W = L4_W + L3_X_PAD×2 = 218, L3_H=46` — L4 两侧各留 34px 内边距
- **L2**（expandable group 容器）：`L2_W=564, L2_H=54`
- **L1**（summary pill + IO）：`L1_W = L2_W = 564, L1_H=53, IO_H=53`

删除旧常量：`MAIN_W, MAIN_H, GROUP_W, HEADER_H, GROUP_INNER_TOP/BOTTOM, OP_HEADER_H, OP_GAP, OP_BRANCH_GAP, OP_CENTER_GAP, L4_TOP, L4_BOTTOM`

对应替换为：`L3_GAP, L3_BRANCH_GAP, L3_CENTER_GAP, L2_TOP_PAD, L2_BOT_PAD, L3_TOP_PAD, L3_BOT_PAD`

**按钮**：`BTN_SIZE=29, BTN_RX=14.5`（设计图 29×29 全圆，原为 24×24 rx=5 方形）

### 列坐标推导（`buildAttentionCluster` / `buildDenseCluster` / `buildMoeCluster` / `buildAttentionClusterV32`）

- 旧：硬编码 `centerX - 222`、`centerX + 70`、`centerX - 76` 等魔法数字
- 新：`colGap = L2_W - 2×L3_W - 2×colPad` → `leftX = centerX - L2_W/2 + colPad`，`centerNodeX = centerX - L3_W/2`
- 所有 cluster builder 统一公式，自洽

### Pipeline 染色系统（`mvp/index.html` + `mvp/app.js`）

**复用 `colormap.js`**（新增 script 加载）：

- `mvp/index.html`：新增 `<script defer src="../js/colormap.js"></script>`
- `getPipelineColors(stage)`：复用 `PIPELINE_HUES`（h/s）+ `hslToHex`（l=0.44 Tier 0）+ `hexToRgb` 构造 rgba(20%) — 零重复
- `MVP_PIPELINE_KEY`：attention→Attn, ffn→FFN, moe→MoE, norm→Norm, residual→Residual
- `inferStage(id)`：从 id 前缀推断 stage（`attention_*`, `ffn_*`, `moe_*`）

**染色规则**：
- Collapsed pill：`fill = solid`，`stroke = rgba(255,255,255,0.38)`
- Expanded 容器：`fill = rgba(r,g,b,0.20)`（pipeline 色 20% 透明），子节点继承同 pipeline solid
- `FlowGroup.toggleCollapse`：切换时实时更新 `body.fill`（solid ↔ bg）

**各层级节点接入**：
- L2 `buildExpandableGroup`：接收 `stage` 参数 → pipeline 颜色
- L3 `buildExpandableOperator`：`stage` 优先 options，缺省 `inferStage(id)`
- L1 `summaryNode`：接收 `stage`，fill/stroke override 注入 `rectNode`
- `buildScene` / `buildSceneV32`：传入 `'norm'` / `'attention'` / `'ffn'` / `'moe'`

### 其他修复

- `detail-op` variant：`rx` 6→12，与 compact op `--node-radius: 12px` 一致
- `buildL4DetailList`：L4 节点固定 `L4_W` 宽，居中于父容器（删除 `width` 参数依赖）
- `addRect`：支持 `spec.fill` / `spec.stroke` 覆盖，不再强制走 `rectStyle` 返回值
- `addGroup`：`pipelineColors` 写入节点 data，供 toggle 时读取

---

## v0.5 — 2026-03-12

**主题：架构统一 + 语义染色修复**

对应计划：[ARCHITECTURE_REVIEW_AND_ROADMAP_PLAN.md](业务理解/ARCHITECTURE_REVIEW_AND_ROADMAP_PLAN.md) Phase A / B / D

### Phase A — MVP 暗色主题（打破视觉断层）

#### `mvp/styles.css`
- 删除所有浅色变量（`--bg: #ececec`、`--ink: #111111`、`--paper: #ffffff` 等）
- 全量替换为继承自 `css/style.css` 的深色 Design Token：
  - `--canvas-bg: #1A1A1A`
  - `--toolbar-bg: rgba(20, 20, 20, 0.96)`、`--toolbar-border: rgba(255,255,255,0.07)`
  - `--text-primary: rgba(255,255,255,0.88)`、`--text-secondary: rgba(255,255,255,0.45)`
  - `--tag-bg / --tag-border`：同主站
- `.model-btn` 改为深色样式：inactive = 半透明边框底，active = 白底黑字
- `.home-link`、`.toolbar-logo`、`.graph-title` 与主站 `css/style.css` 完全对齐

#### `mvp/app.js`
- 颜色常量全部改为深色值：
  - `BG = "#1A1A1A"` / `INK = "#e0e0e0"` / `LINE = "#333333"`
  - `PAPER = "#2D2D2D"` / `PAPER_ALT = "#242424"` / `MUTED = "#888888"` / `DASH = "#555555"`
- `FlowGroup.config()` 中 `button.fill "#e5e5e5"` → `PAPER`，`buttonSign.stroke "#7a7a7a"` → `MUTED`
- `rectStyle()` 各 variant 硬编码颜色替换：
  - `"io"` variant：`fill "#e5e5e5"` → `PAPER`，新增 `stroke: LINE`
  - `"nav"` active：`fill "#e5e5e5"` → `PAPER`
  - `"version-active"`：`textFill PAPER` → `"#1A1A1A"`（深色文字配浅色底）
  - `"version-inactive"`：`fill "#e5e5e5"` → `PAPER_ALT`，新增 `stroke: LINE`，`textFill INK` → `MUTED`

#### `mvp/index.html`
- `<title>` 更新为 `大模型整网架构 — PTO`
- 新增 Google Fonts：IBM Plex Sans + JetBrains Mono（与主站字体一致）
- `.graph-title` 文案：`DeepSeek V3 X6 Flowchart MVP` → `DeepSeek V3 · 模型架构`

---

### Phase B1 — Semantic 染色修复（VIEW/RESHAPE/ASSEMBLE 不再全灰）

#### `js/colormap.js`

**问题**：当节点无 `semantic_label` 时，`VIEW`/`RESHAPE`/`ASSEMBLE` 等 opcode 的颜色退化为 `#666666`。`buildPipelineSemanticColorMap` 只给 pipeline 格式（`sem:Query-Linear` 等）分配颜色，非 pipeline 的 `sem:*` 全部 fallback。

**修复 1 — `getSemanticKey` 内联推断**
- 新增 `INLINE_OPCODE_LABELS` 常量表（VIEW/RESHAPE/ASSEMBLE/CAST/SQRT 等 10 个）
- `getSemanticKey` 第三分支：在 `semanticLabel` 和 `inferredSemanticLabel` 都缺失时，直接按 opcode 推断，返回 `'sem:View'` / `'sem:Reshape'` 等
- 效果：colormap.js 现在无需依赖 `app.js` 的 `annotateGraphModel` 预处理即可独立推断

**修复 2 — `buildPipelineSemanticColorMap` 非 pipeline key 着色**
- 第一阶段新增 `genericSemKeys[]` 收集非 pipeline 的 `sem:*` 键
- 用 `buildColorMap` 为其分配 CORE 调色板离散颜色，写入 `semKeyColorMap`
- 第二阶段改为统一查 `semKeyColorMap`，删除旧的 `return '#666666'` fallback
- 效果：VIEW → 靛蓝、RESHAPE → 墨绿、ASSEMBLE → 橙棕（CORE 颜色顺序分配，与主站语义色系一致）

---

### Phase D — Launcher 改进

#### `launch.html`
- 「源码计算流」卡片标题行新增 `<span class="badge-beta">beta</span>` 徽章
- 新增 `.badge-beta` 样式：10px 大写、半透明边框、`rgba(255,255,255,0.10)` 背景、可读性 60% 白色文字

**抉择记录**：`js/antv-flow.js` 检查后确认被 `visual-test.html` 引用（line 705），属于活跃模块，保留。

---

## v0.4 — 2026-03-11

**主题：MVP 接入探索（复盘见 MVP_INTEGRATION_RETROSPECTIVE.md）**

- 尝试将 `mvp/` 的整网架构视图接入主视图的 compact op 视觉语言
- 识别关键语义轴：`stage`、`pipeline`、`visualLevel`
- 确认收起态 pill 须复用 compact op 填充描边阴影；展开态父组改 20% 透明纯色底
- 结论：样式语义优先于几何拟合，暂不追求 L3 几何细节

---

## v0.3 — 2026-03 (git: 15a73f2)

**主题：Launcher 文件夹选取 + 折叠面板 + Group 视图**

### `launch.html`
- 新增「选择文件夹」按钮，使用 `showDirectoryPicker` API
- 通过 IndexedDB 持久化 `FileSystemDirectoryHandle`，handoff token 传递到 `index.html`
- 新增「选择本地文件（.py）」入口，读取内容写入 `sessionStorage` 传递 `visual-test.html`

### `js/app.js`
- 接入 `consume-folder` token 读取流程，从 IndexedDB 恢复目录句柄
- Group 视图：`buildGroupedGraphModel` + `makeGroupNodeFromBucket`
  - bucket key 包含 `layerIdx|nodeType|fingerprint|flowSignature`，防止跨链路误合并
  - `annotateGraphModel`：预计算每个节点的 `upstreamBoundaryIds / downstreamBoundaryIds / flowSignature`
  - `inferSemanticLabelForOp`：对无 `semantic_label` 的 op 按 opcode 推断（VIEW/RESHAPE 等）
- 锁定计算流：`lockedFlowState` 逻辑，提取子图 + 独立布局
- `buildSemanticPipelineColorMap`：pipeline 键与 generic 键分开处理，generic 用 `buildColorMap` 分配离散色

### `js/colormap.js`
- `getSemanticKey`：优先读 `semanticLabel`，其次 `inferredSemanticLabel`，再 fallback opcode category
- `buildPipelineSemanticColorMap`：pipeline stage 用连续色相区间；`fixPrologColors` 处理 Prolog / MEMORY 算子的色相继承

### `js/renderer.js`
- 新增 `buildGroupCard` / `buildCompactGroupCard` / `buildGroupMemberBars`
- Group 成员颜色来自 `ref.color`（由 `applyGroupMemberColors` 注入）或 `colorMap.get(nodeId)`
- `normalizeGroupMemberRef` 处理 rawRef 格式兼容（字符串 / 数字 / 对象）

---

## v0.2 — 2026-03 (git: e88ef0a)

**主题：Pass 导航重设计 + 迷你地图改进**

### `js/nav.js`
- Pill 宽度改为自动（按内容）而非固定宽度
- 路径优先逻辑：默认高亮当前 PATH，Loop/Unroll 作为次级状态
- Snap 模式：切换 Pass 时视图吸附到选中节点

### `css/nav.css`
- Pill 内边距、字重微调；活跃态对比度提升
- Minimap 与主画布边界对齐

---

## v0.1 — 2026-03 (git: 610e8d2 → 76372c3)

**主题：初始发布 + Pass Navigator**

### 首次提交（841fe6c）
- 纯静态前端 DAG 可视化，HTML + CSS + Vanilla JS
- 四种节点类型：Incast / Op / Tensor / Outcast
- Sugiyama 分层布局（`layout.js`）
- SVG 曲线连线 + DOM 节点卡片（`renderer.js`）
- 解析两种 JSON 格式（`parser.js`）

### Pass Navigator（76372c3）
- `js/nav.js`：时间线导航，支持 Loop / Unroll / Path 切换
- `js/controlflow.js`：Controlflow 双列树面板 + SVG 映射线
- `launch.html`：统一入口，三张卡片（Pass IR 计算图 / 大模型架构 / 源码计算流）

---

## 计划中（未实现）

| Phase | 功能 | 前置条件 |
|-------|------|---------|
| C | Pass 导航新手 UX（方案 A/B/C 待确认） | 产品方向确认 |
| E | L3 → IR 计算图下钻 + 泳道图 | gitcode 官方逻辑验证 |
| E | `layout-tb.js` 竖向排列接入主视图 | Phase A 完成后 |

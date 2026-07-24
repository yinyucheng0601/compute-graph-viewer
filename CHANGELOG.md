# PTO Changelog

> 开发日志，按时间倒序，每轮修改点逐条记录。
> 格式：`[版本/日期] 模块 — 修改描述`

---

## 2026-07-24 — config-relation-observer：点专家/EP 组全展开连线（连上所有相关 layer 与各 stage 的 rank）

- `js/config-relation-observer.js` — 明确「路由槽位」的分布语义并全展开连线。一个专家编号 e 在**每个 MoE 层**都有一份实例（各层权重独立、互不相干，只共享编号与「编号→EP rank」分片公式），其 EP 组在**每个 PP stage** 内各占一块 rank。`resolveRelation` 的 `case "expert"/"epRank"` 连上全部 MoE 层 + 各 stage 的该 EP 组 rank（× DP 副本），`sharedExpert` 连上全部 MoE 层 + 各 stage 全部 rank。`drawRelationLinks` 新增 `clusterStageAnchors()`：集群侧不再把 4 段并成一个横跨整幅热力图的巨框，而是**按 PP stage 拆成多条线**（每段一条 + 一圈虚线框，总「Node… · N 卡」标签只挂离 hub 最近那条），直观表达「这个编号的 rank 散布在每个 stage」。`relationLabels` 主标签改为「`E37 · L2~L45 各一份`」，点明分布范围又不误导成「同一个专家横跨各层」。
  - 同时移除上一轮为「单层收敛」方案加的 MoE 代表层步进器（`#croMoeRepLayer` / `moeRepLayer` / `.cro-replayer*` / `NAV_PREV·NAV_NEXT`）与其 `emitSelect` scopeLayer 注入——全展开语义下与之矛盾，故回退。

## 2026-07-24 — config-relation-observer：典型 Layer 并行分支改左右分栏

- `js/config-relation-observer.js` / `css/config-relation-observer.css` — 典型 Layer 面板原先把每列算子一律竖排（`renderStructure` 直接把 bars 顺次塞进 `.cro-structure__stack`），把整网 deck 里本是并行的支路读成了串行。新增 `PARALLEL_GROUPS` 声明（按 deck 的 SIDE_ROWS 配对）：注意力 Q 路径 ∥ KV 路径、MoE 路由专家支路（Router→Dispatch→Expert Pool→Combine）∥ 共享专家支路；`renderStructure` 据此把连续同组的 bar 收进 `.cro-structure__lanes` 左右两条 `.cro-structure__lane` 子栈渲染，汇合节点（`attention_core` / `moe_branch_add`）本身不属任何分栏、自然收束回整条竖排。bar 的 `data-*`/点击/关系高亮全部不变（子栈仅作视觉容器，选择器都是后代匹配）。

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
- **浅色悬浮面板背景**:页面已跟踪的 Swimlane tooltip pattern 增加背景变量，本页浅色主题设为 `#F8F8F8`，深色与 glass 主题保持原 surface。
- **空白点击取消选择**:Swimlane 空白区域现在统一清除 profiling span、通信事件、关联模型节点、Inspector 详情与联动去色；时间游标仍移动到点击位置，已展开的 task 明细保持展开，用户可继续选择同一 task 内的其他子事件。

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

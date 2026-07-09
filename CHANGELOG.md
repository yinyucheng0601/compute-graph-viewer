# PTO Changelog

> 开发日志，按时间倒序，每轮修改点逐条记录。
> 格式：`[版本/日期] 模块 — 修改描述`

---

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

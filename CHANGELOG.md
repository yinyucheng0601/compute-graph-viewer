# PTO Changelog

> 开发日志，按时间倒序，每轮修改点逐条记录。
> 格式：`[版本/日期] 模块 — 修改描述`

---

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

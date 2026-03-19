## [LRN-20260306-001] correction

**Logged**: 2026-03-06T09:40:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: docs

### Summary
用户纠正了“整网架构分解页可沿用本地文件/文件夹加载模式”的错误假设。

### Details
该页面没有可供用户本地加载的整网模型数据源。正确方案是：演示数据由前端静态编写并内置维护，不依赖用户上传本地模型文件或文件夹。

### Suggested Action
在 PRD、需求说明和后续实现中统一使用“前端内置静态数据”表述，移除“本地文件/文件夹加载”相关描述。

### Metadata
- Source: user_feedback
- Related Files: 业务理解/DEEPSEEK_ARCHITECTURE_INTERACTIVE_PRD.md
- Tags: correction, scope, data-source

---

## [LRN-20260309-001] correction

**Logged**: 2026-03-09T14:35:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: frontend

### Summary
用户纠正了“计算链路锁定应放在底部独立 panel”这一交互方向。

### Details
对计算图问题定位来说，锁定一条节点的全部上下游，更合适的交互不是额外打开一个底部只读 panel，而是在原始计算图主画布中直接隐藏无关节点，并对剩余子图重新布局。这样用户仍然保留原有的缩放、平移、选择和详情操作语境，操作成本明显更低。

### Suggested Action
后续涉及“局部聚焦/路径锁定/子图分析”的功能时，优先采用原位聚焦、视图裁剪和重布局方案，避免引入割裂主工作流的附属 panel。

### Metadata
- Source: user_feedback
- Related Files: js/app.js, index.html, css/style.css
- Tags: correction, interaction, graph-focus, ux

---

## [LRN-20260309-002] correction

**Logged**: 2026-03-09T14:58:00+08:00  
**Priority**: medium  
**Status**: pending  
**Area**: frontend

### Summary
链路锁定的退出入口应只在激活后出现，并放在主菜单附近做高显著提示。

### Details
把“退出 lock”入口放在图标题区域且样式不够显著，容易导致两个问题：一是未激活时存在感过强，形成误导；二是触发后用户难以在主操作区附近快速发现退出路径。更合适的方案是将其放在主菜单右侧，并在未锁定时强制隐藏，激活后以主按钮样式展示。

### Suggested Action
后续新增“模式退出”类操作时，默认遵循“未激活强隐藏、激活后近主入口显示、样式高显著”的规则。

### Metadata
- Source: user_feedback
- Related Files: index.html, css/style.css, js/app.js
- Tags: correction, ux, visibility, toolbar

---

## [LRN-20260309-003] correction

**Logged**: 2026-03-09T15:10:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: frontend

### Summary
用户要求后续所有需求必须先给出 plan，并在确认后再执行。

### Details
此前在收到明确需求后会直接进入实现，这与用户当前偏好的协作方式不一致。后续在该工作区内，收到任何新需求时，应先输出简明 plan，等待用户确认，再开始修改代码或文档。

### Suggested Action
将“先 plan、后执行”作为当前用户的显式协作约束，在后续请求中默认遵守，除非用户明确改回允许直接执行。

### Metadata
- Source: user_feedback
- Related Files: .learnings/LEARNINGS.md
- Tags: correction, collaboration, planning

---

## [LRN-20260311-001] correction

**Logged**: 2026-03-11T14:12:10+08:00  
**Priority**: high  
**Status**: pending  
**Area**: frontend

### Summary
仅把竖向视图的渲染引擎切到 AntV 还不够，必须同时继承 viewer 的 compact op 视觉语言并控制整网边信息密度。

### Details
这次用户明确否定了首版 AntV 竖向实现，原因不是“没换引擎”，而是“视觉语言断裂且不可读”：算子 pill 没有继承 compact op 样式、布局挤在一起、tensor edge label 仍然有描边。说明后续凡是替换图引擎或布局算法，不能只追求功能等价，还要保证节点样式、信息密度和阅读节奏与现有 viewer 语义保持一致。

### Suggested Action
后续涉及计算图渲染迁移时，优先复用已有节点 DOM/CSS 组件，再做布局替换；边上的 tensor 信息默认采用无边框、低密度、摘要式展示。

### Metadata
- Source: user_feedback
- Related Files: visual-test.html, js/antv-flow.js, js/renderer.js
- Tags: correction, antv, compact-op, readability, edge-label

---

## [LRN-20260311-002] correction

**Logged**: 2026-03-11T15:02:00+08:00  
**Priority**: high  
**Status**: pending  

## [LRN-20260313-001] correction

**Logged**: 2026-03-13T16:40:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: docs

### Summary
面向用户的分析文档不能默认按开发者速记方式写，必须优先照顾产品经理和入门开发者的阅读路径。

### Details
这次用户明确指出两类问题。第一，文档默认读者并不是 CANN/算子开发者，因此像 AST、IR、Liveness、Lazy Execution 这类术语不能直接使用，必须先基于官方文档给出定义和通俗解释。第二，文档在表达上不能拆成过多碎 bullet，否则会让非技术读者失去主线。更合适的写法是：先讲背景，再讲概念，再结合真实案例逐步解释，并用少量结构化列表辅助理解。

### Suggested Action
后续在当前工作区撰写面向用户的技术分析文档时，默认遵循以下规则：先交代读者假设；术语首次出现必须解释；优先使用连续段落和示例代码块；只有在确实需要枚举时才使用 bullets；官方文档定义和真实案例必须并列呈现。

### Metadata
- Source: user_feedback
- Related Files: 业务理解/developer_doc_zh.md
- Tags: correction, docs, readability, pm-audience, terminology

---
**Area**: frontend

### Summary
为了解决 tensor 标签重叠，不能把整网 edge tensor 信息默认全部隐藏；至少要保留稀疏边的可见摘要，并给 edge 明确的 hover hitbox。

### Details
这次根据 TensorBoard 思路把 edge tensor 信息切成“默认隐藏、交互揭示”后，用户立即反馈“tensor 全部不见了，hover edge 也没反应”。问题说明两点：第一，TensorBoard 的降噪策略不能机械照搬到当前 viewer，当前场景仍需要让稀疏边保持基础可见性；第二，AntV/X6 的 1px edge 线本身不足以承担 hover 交互，必须提供显式的宽命中区，否则 tooltip 设计等于不存在。

### Suggested Action
后续做计算图 edge 降噪时，优先采用“稀疏边默认显示简短摘要、密集边 hover/select 展示、始终保留 tooltip 详情”的分级规则；同时默认给 edge 配透明宽 hitbox，而不是依赖细线本身承载 hover。

### Metadata
- Source: user_feedback
- Related Files: visual-test.html, js/antv-flow.js
- Tags: correction, tensor-edge, hover, hitbox, readability

---

## [LRN-20260311-003] correction

**Logged**: 2026-03-11T07:53:36Z  
**Priority**: high  
**Status**: pending  
**Area**: frontend

### Summary
聚合视图按钮如果被接成 `data-mode`，会让 grouped/aggregate 功能在 UI 上看起来像消失了，即使底层逻辑还在。

### Details
这次 `index.html` 里的聚合按钮被写成了 `data-mode="group"`，但 `js/app.js` 实际上把“染色”和“聚合视图”分成两套控制：染色走 `setColorMode(...)` 和 `data-mode`，聚合走 `setViewMode('grouped')` 和 `data-view-mode`。因此 grouped graph、lock flow 等代码都还在，但用户从面板上已经无法进入聚合视图，主观感受就是“昨天做的功能不见了”。

### Suggested Action
后续改 viewer 控制面板时，强制区分 color-mode 和 view-mode 按钮；聚合能力至少保留 `original` 与 `grouped` 两个显式入口，避免功能存在但无入口的假消失。

### Metadata
- Source: user_feedback
- Related Files: index.html, js/app.js
- Tags: correction, grouped-view, control-panel, wiring, regression

---

## [LRN-20260311-004] correction

**Logged**: 2026-03-11T16:40:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: frontend

### Summary
整网架构迁移的主优先级不是复刻设计稿里 L3 示意算子的精确排布，而是先统一各 level 的样式语义和展开态视觉规则。

### Details
用户明确说明设计图中的 L3 算子只是示意。真正需要优先落地的是两条大逻辑：第一，同一个 level 的算子 pill 在未展开时要统一复用 compact op 的填充、描边、阴影，只通过染色区分；第二，算子下钻展开后，父级卡片的填充要改为 20% 透明度的纯色并去掉渐变，组内子节点继承原有样式；当子节点里存在多条 pipeline 时，再通过 pipeline 染色区分。说明后续实现顺序必须是“样式语义层 -> 展开态规则 -> pipeline 染色 -> 几何细节”，不能先盯着 L3 示意布局逐像素复刻。

### Suggested Action
后续更新 `mvp` 整网架构模块时，先抽象 level-style 和 expanded-style 规则表，再让 scene builder / node renderer 按规则驱动渲染；几何细节只在上述语义稳定后再微调。

### Metadata
- Source: user_feedback
- Related Files: mvp/app.js, mvp/styles.css
- Tags: correction, architecture-viewer, compact-op, expanded-state, pipeline-color

---

## [LRN-20260313-002] best_practice

**Logged**: 2026-03-13T06:27:19Z  
**Priority**: high  
**Status**: pending  
**Area**: docs

### Summary
面向产品经理和入门开发者的技术文档，除了定义术语，还要显式回答读者自然会追问的“直观问题”。

### Details
这次用户继续追问的点非常典型：`X 是什么`、`token 和 tensor 是什么关系`、`循环体怎么理解`、`parser 到底具体干了啥`、`动态维度如何绑定`、`缓存命中是什么意思`、`NPU 和 SIM 是什么关系`。这些问题说明，仅仅按“概念定义 -> 六步流程”去写，仍然不够贴近非专业读者的阅读路径。更有效的写法是：在主线说明之外，补上“代码写法 -> AST/IR 变化 -> 运行状态变化”的一对一映射，并把最自然的追问直接写进文档正文。

---

## [LRN-20260316-002] correction

**Logged**: 2026-03-16T12:20:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: docs

### Summary
写 `pass / loop / controlflow` 类研究笔记时，不能只停在 PyPTO 通用框架描述，必须覆盖 CANN/PyPTO 关于循环的完整定义，并用 DeepSeek 真实算子和真实循环变量把链路讲透。

### Details
这次用户明确指出两类偏差。第一，`Pass_如何把前端IR变成Execute_Graph_研究笔记.md` 没有把循环相关定义研究全，尤其缺少 tile 逐块遍历、loop_unroll、动态 loop path、运行时调度等更完整的循环层次。第二，`Loop_循环体与ControlFlow_研究笔记.md` 虽然做了层次拆分，但没有真正建立在 DeepSeek 真实算子和真实循环变量之上，深度与官方 wiki 摘要差异不够大。后续这类文档不能只“解释框架概念”，而要做到“官方定义 + 本地实现 + DeepSeek 实例”三者同时落地。

### Suggested Action
后续重写这类研究稿时，默认遵循：
1. 先整理 CANN/PyPTO 对 loop/controlflow 的全域定义；
2. 明确区分 `模型重复 / 源码循环 / tile遍历 / 子图路径 / 运行时调度循环`；
3. 至少选 1-2 个 DeepSeek 真实 kernel，把真实循环变量、真实 shape、真实 pass 产物串起来；
4. 不满足这四点时，不要提交为“研究笔记完成版”。

### Metadata
- Source: user_feedback
- Related Files: 业务理解/Pass_如何把前端IR变成Execute_Graph_研究笔记.md, 业务理解/Loop_循环体与ControlFlow_研究笔记.md
- Tags: correction, docs, loops, controlflow, deepseek, depth

### Suggested Action
后续在当前工作区撰写产品向技术文档时，默认增加一段“读者最可能追问的问题”或把这些问题折进正文，优先解释对象关系、状态变化和一对一示例，而不是只给抽象定义。

### Metadata
- Source: user_feedback
- Related Files: 业务理解/developer_doc_zh.md
- Tags: best_practice, docs, pm-audience, faq, mental-model

---

## [LRN-20260311-004] correction

**Logged**: 2026-03-11T16:05:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: frontend

### Summary
修复功能回归时，不能把用户已经确认过的面板视觉结构一起回退。

### Details
这次在修复 grouped/aggregate 入口接线时，我把 `index.html` 的控制面板从用户昨天已经确认过的“图形设置 / 视图 / 染色”中文分区样式改回了旧的英文结构。虽然逻辑部分被修正了，但用户感知首先是“昨天做好的 UI 被退回去了”。对这种界面任务，已确认的视觉结构本身也是需求的一部分，不能因为修 wiring 就随手换回旧版布局。

### Suggested Action
后续处理 UI 回归时，先最小化修接线或状态逻辑；如果必须改 DOM，也要对照最近一次用户确认的截图或结构，避免功能修复伴随未请求的视觉回退。

### Metadata
- Source: user_feedback
- Related Files: index.html, css/style.css
- Tags: correction, ui-regression, control-panel, visual-consistency

---

## [LRN-20260311-005] correction

**Logged**: 2026-03-11T22:40:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: frontend

### Summary
改动整网架构布局前，必须先做影响面分析，明确 `mvp` 私有样式和主 viewer 共享面板的边界，不能只凭当前页面表象判断“其他 UI 没被影响”。

### Details
这次用户再次指出控制面板的紧凑布局丢失，说明我之前虽然把实现集中在 `mvp/`，但没有先回查共享 `index.html` / `css/style.css` 的当前状态，也没有把“设计稿对比”和“共享 UI 回归检查”作为布局改动前置步骤。结果是：即便本轮没直接改控制面板，也错误地给出了“昨天面板没被带坏”的判断，影响了后续验收。

### Suggested Action
后续所有整网/竖向布局相关修改，先执行两步检查：第一，对照设计稿抽出几何与层级差异清单；第二，检查共享文件 `index.html`、`css/style.css`、`js/app.js` 当前状态，确认控制面板、锁定入口、聚合入口没有回退，再开始写布局代码。

### Metadata
- Source: user_feedback
- Related Files: mvp/app.js, mvp/styles.css, index.html, css/style.css
- Tags: correction, impact-analysis, regression-check, shared-ui, layout

---

## [LRN-20260311-006] correction

**Logged**: 2026-03-11T23:02:00+08:00  
**Priority**: medium  
**Status**: pending  
**Area**: frontend

### Summary
收到“按备份回退”请求时，必须先验证备份目录是否真的包含可恢复文件，不能直接假设备份可用。

### Details
这次用户明确给了 `mvp_before` 作为回退来源，但实际目录里只有 `.DS_Store`，没有任何可恢复的源码文件。如果不先检查备份内容，就会在用户预期“立即回退”时产生额外往返和误判。

### Suggested Action
后续所有“按备份/副本/快照回退”的请求，先执行目录清点和文件比对，再决定复制、覆盖还是需要用户补充正确路径。

### Metadata
- Source: user_feedback
- Related Files: mvp_before, mvp
- Tags: correction, backup, rollback, verification

---

## [LRN-20260316-003] correction

**Logged**: 2026-03-16T12:20:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: docs

### Summary
写 PBC 时不能沿用研究复盘式长篇叙述，必须优先采用体验驱动、价值导向的表达方式。

### Details
这次在基于 PTO 工程产出帮助用户撰写 PBC 时，我按“背景-过程-产出”展开，篇幅偏长，且更像项目总结或研究回顾。用户明确要求“体验驱动产品，要价值导向”，说明 PBC 的重点不是解释自己做了多少分析，而是突出用户体验改善、产品方向推动、业务价值和影响结果。

### Suggested Action
后续在当前工作区协助撰写 PBC、述职或绩效材料时，默认采用“做了什么体验优化、解决了什么关键问题、带来了什么产品价值”的框架，优先短句、结果导向、少背景铺垫。

### Metadata
- Source: user_feedback
- Related Files: .learnings/LEARNINGS.md
- Tags: correction, pbc, value-oriented, experience-driven, writing

---

## [LRN-20260316-004] correction

**Logged**: 2026-03-16T12:28:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: docs

### Summary
在拆分研究文档主题时，不能因为因果相关就把两篇文档写成互相侵入；必须严格区分“主问题”和“支撑背景”。

### Details
这次用户指出 `Pass_如何把前端IR变成Execute_Graph_研究笔记.md` 和 `Loop_循环体与ControlFlow_研究笔记.md` 出现了明显混淆。复查后确认问题成立：前者前半篇大量展开 loop 分类，后者后半篇又深入 ROOT/LEAF、Execute Graph 和 swimlane，导致两篇文档都失去单一主线。正确做法应是：Pass 文档主讲 IR 如何经 pass 变成 execute graph，loop 只保留必要背景；Loop 文档主讲模型 loop、源码 loop、tile loop、controlflow 的分层关系，ROOT/LEAF 和 swimlane 只作为结果落点简述。

### Suggested Action
后续撰写同主题系列研究文档时，先明确每篇文档只回答一个主问题，并在开头写出“不覆盖什么”；正文中若出现支撑背景，控制在一节内，避免把相邻主题整段搬进来。

### Metadata
- Source: user_feedback
- Related Files: 业务理解/Pass_如何把前端IR变成Execute_Graph_研究笔记.md, 业务理解/Loop_循环体与ControlFlow_研究笔记.md
- Tags: correction, docs, scope-control, pass, loop, controlflow

---

## [LRN-20260317-001] correction

**Logged**: 2026-03-17T15:25:00+08:00  
**Priority**: medium  
**Status**: pending  
**Area**: docs

### Summary
在 Markdown 文档中插入复杂流程图时，不应把内联 SVG/XML 源码直接留在正文里，应该抽成独立资源文件再引用。

### Details
这次用户指出 `Loop_循环体与ControlFlow_研究笔记.md` 第 7 节的图后面出现了大段乱码。复查后确认原因是把完整的 SVG/XML 源码直接写进了 Markdown 正文，导致某些渲染环境把源码当作普通文本显示。更稳妥的做法是把图保存成独立 `.svg` 文件，然后在正文中只保留标准图片引用。

### Suggested Action
后续在当前工作区编写业务理解文档时，如果流程图需要长期保留或结构较复杂，默认落成独立 `.svg` 文件，并在 Markdown 中通过相对路径引用；不要混用外链图片和整段内联 SVG 源码。

### Metadata
- Source: user_feedback
- Related Files: 业务理解/Loop_循环体与ControlFlow_研究笔记.md, 业务理解/tiled_flash_attention_flow.svg
- Tags: correction, docs, markdown, svg, rendering

---

## [LRN-20260317-002] correction

**Logged**: 2026-03-17T15:40:00+08:00  
**Priority**: medium  
**Status**: pending  
**Area**: docs

### Summary
当文档编号同时承担“概念层次”的含义时，导读、术语和预备说明不应占用正式数字编号。

### Details
这次用户指出 `Loop_循环体与ControlFlow_研究笔记.md` 的标题索引不易读，原因不是只有跳号，而是“1/2”这些数字本应对应四层 loop，却被前置的阅读地图和定义章节占用了。正确做法应是：导读和术语解释使用无编号标题，正式数字编号从概念主线开始；案例和补充说明都挂回对应主章节，不要独立漂成一章。

### Suggested Action
后续在当前工作区撰写带编号的业务理解文档时，先确认数字编号到底表达“阅读顺序”还是“概念层次”。如果编号承担概念语义，导读、术语表、定义说明默认不编号。

### Metadata
- Source: user_feedback
- Related Files: 业务理解/Loop_循环体与ControlFlow_研究笔记.md
- Tags: correction, docs, heading-structure, numbering, readability

---

## [LRN-20260318-001] correction

**Logged**: 2026-03-18T10:15:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: docs

### Summary
当用户明确说“要的是产品体验，不是文档”时，输出物应从研究笔记切换成 PRD、体验主线和首版范围定义。

### Details
这次在 PTO 相关讨论中，虽然前面已经整理了较多业务理解和测试用例设计思路，但用户明确指出自己要的不是继续补文档，而是先看一份产品 PRD。这说明在当前工作区，研究材料已经足够支撑判断时，下一步应主动切换到产品化表达：目标用户、核心场景、工作台结构、首版用例池、验收标准，而不是继续沿用“概念分析 -> 再出一篇笔记”的路径。

### Suggested Action
后续在 PTO 相关任务中，如果上下文已经形成稳定判断，应优先输出 PRD、页面结构或交互方案；研究笔记只作为支撑材料，不再作为默认主产物。

### Metadata
- Source: user_feedback
- Related Files: 业务理解/PTO_数据流调试工作台_PRD.md
- Tags: correction, prd, product-experience, pto

---

## [LRN-20260318-002] correction

**Logged**: 2026-03-18T10:34:00+08:00  
**Priority**: high  
**Status**: pending  
**Area**: docs

### Summary
在 PTO 的产品体验判断上，不能忽略现有 `mvp` 和 `test` 已经实现的连续下钻能力，更不能倒退回“靠菜单切层”的设计假设。

### Details
这次用户指出：在 `/Users/yin/pto/mvp` 和 `/Users/yin/pto/test` 里，模型 → 算子 → 计算图的打通已经具备，用户不需要手动切换就能下钻。复查代码后确认这一点成立：`mvp/app.js` 通过 layer 选择、group 展开和 operator 细节展开，已经把层级下钻做成了连续体验；`test/app.js` 通过统一 sample、单画布渲染和 inspector，把 source/pass/mvp 派生数据纳入同一工作台。因此，后续产品设计不应再把“数据旅程”实现成左侧菜单或 tab 切换，而应该以“共享焦点 + 连续下钻 + 联动证据”为前提继续深化。

### Suggested Action
后续讨论 PTO 核心工作台时，默认基于已有连续下钻能力做增强：补上下文、映射、证据和对比，而不是重新设计一个分层切换框架。

### Metadata
- Source: user_feedback
- Related Files: mvp/app.js, test/app.js, test/data-adapters.js
- Tags: correction, product, pto, drilldown, continuity

---

# Compute Graph Viewer — 项目总索引

> 最后更新：2026-03-19

Compute Graph Viewer（内部代号 **PTO**）是面向 Ascend NPU 计算图的本地可视化工具，纯静态前端（HTML + CSS + Vanilla JS），加载编译器输出的 JSON 进行 DAG 交互分析。入口为 `launch.html`，对应四条功能路标：

- **精度调试**：`pass-ir/index.html` — Pass IR 计算图，逐阶段追踪编译优化
- **架构洞察**：`model-architecture/index.html` — 大模型整网架构，L1→L2→L3 折叠展开
- **性能调优**：`source-flow/index.html` — 算子源码计算流可视化（beta）
- **执行态观察**：`swimlane/index.html` — AIC / AIV 执行泳道

---

## Milestones

> 状态：✅ 完成 / ⚠️ 有 bug / 🔄 进行中 / ⬜ 待开发

---

### 基础设施

| 状态 | 特性 | 备注 |
|------|------|------|
| ✅ | 启动页 / demo 导航入口（四卡片） | `launch.html` |
| ✅ | 文件夹 handoff（IndexedDB + FileSystemDirectoryHandle） | launch → pass-ir |
| ✅ | 主站深色主题 Design Token | `css/style.css` |
| ✅ | MVP 暗色主题（v0.5 修复） | `model-architecture/styles.css` 已与主站对齐 |
| ⬜ | VSCode 插件化 | Webview 方案，核心特性稳定后再做 |

---

### Release 1 · 精度调试：看懂一张图

**用户**：算子编写完成后，发现计算结果与预期不符的算子开发者

**场景**：开启 `compile_debug_mode` → 打开工具逐层定位
（Tensor Graph 验逻辑 → Tile Graph 验搬运 → Block Graph 验并行度 → Execute Graph 验调度）

| 状态 | 特性 | 解决什么问题 |
|------|------|------------|
| ✅ | 计算图 DAG 可视化（节点/连线/详情面板） | 从 JSON 文件直接看到图结构 |
| ✅ | Pass 导航条（Loop/Unroll/Path/Snap） | 在几十个 Pass 快照间切换，追踪节点演变 |
| ✅ | 锁定计算流（`lockedFlowState`） | 固定关注的 Tensor 计算链路 |
| 🔄⚠️ | 节点 Group 视图 | 万级节点下先看类型分布骨架；已知 bug：① 跨链路误合并（当前 bucket key 已含 flowSignature，实测需验证）② semantic 染色 VIEW/RESHAPE/ASSEMBLE 全灰（v0.5 已修复） |
| ⬜ | 计算图竖向排列 | 深而窄图横排难读；`layout-tb.js` 骨架已有，待接入 |
| ⬜ | 精度检查工具异常节点标注 | 需新增数据协议 + 渲染逻辑 |

---

### Release 2 · 性能调优：代码到执行的链路打通

**用户**：功能正确但性能不达标，需要做 Man-In-The-Loop 调优的开发者

| 状态 | 特性 | 解决什么问题 |
|------|------|------------|
| ✅ | 算子源码可视化（`source-flow/index.html`，beta） | 从图节点跳转到源码行 |
| ✅ | Controlflow 面板（CF 双列树 + SVG 映射线） | 同时看开发者控制流与编译器生成控制流 |
| ⬜ | Loop ↔ Pass ↔ Controlflow 可解释性 | `controlflow-data.js` 当前是硬编码示范数据，待 gitcode 验证后实现 |
| ✅ | 泳道图 | 已提供本地 `merged_swimlane.json` 查看入口 |

---

### Release 3 · 架构洞察：整网多层级浏览

**用户**：开发 Attention / MoE / FFN 算子的架构设计者

| 状态 | 特性 | 解决什么问题 |
|------|------|------------|
| ✅ | 多层级模型图切换（L1→L2→L3→L4，折叠/展开） | 从顶层架构下钻到单算子 |
| ✅ | V3 / V3.2 模型版本切换 | 对比两代模型结构差异 |
| ✅ | 暗色主题（v0.5 修复，与主站视觉统一） | — |
| ⬜ | 扩展下钻：L3 → IR 计算图 + 算子源码 | 依赖 gitcode 官方文档验证逻辑 |

---

## 目录结构

```
pto/
├── launch.html                        # 启动页 / demo 导航（四卡片）
├── pass-ir/
│   └── index.html                     # 精度调试：Pass IR 计算图
├── source-flow/
│   └── index.html                     # 性能调优：算子源码计算流（beta）
├── swimlane/
│   ├── index.html                     # 执行态观察：Swimlane 执行视图
│   ├── app.js                         # Swimlane viewer 解析与渲染
│   └── styles.css                     # Swimlane 页面样式
├── archive/
│   └── unreferenced-20260319/         # 无引用旧文件归档
├── CHANGELOG.md                       # 开发日志
├── css/
│   └── style.css                      # 主样式 + Design Token（深色主题）
├── js/
│   ├── app.js                         # 主控制器（加载、状态、交互、Group、颜色）
│   ├── parser.js                      # JSON 解析，统一为内部图模型
│   ├── layout.js                      # Sugiyama LR 分层布局算法
│   ├── layout-tb.js                   # TB 布局算法（骨架，待接入主视图）
│   ├── renderer.js                    # 节点卡片 DOM + SVG 连线渲染
│   ├── colormap.js                    # 颜色映射（语义/时延/分区/执行单元）
│   ├── nav.js                         # Pass 导航条逻辑（Loop/Unroll/Path/Snap）
│   ├── nav_index_builder.js           # 导航索引构建
│   ├── controlflow.js                 # Controlflow 面板可视化
│   ├── controlflow-data.js            # Controlflow 数据层（当前为硬编码示范）
│   └── antv-flow.js                   # X6 封装（source-flow/index.html 专用）
├── model-architecture/
│   ├── index.html                     # 架构洞察：大模型整网架构浏览器
│   ├── app.js                         # X6 图库封装，L1→L4 折叠展开
│   ├── data.js                        # DeepSeek V3/V3.2 内置结构数据
│   ├── styles.css                     # MVP 样式（v0.5 已与主站 Design Token 对齐）
│   └── x6.min.js                      # X6 bundle（隔离，仅 MVP 使用）
├── graph-prototype-lab/               # 图原型实验室（辅助入口）
├── assets/                            # 图标与 SVG 资源
├── data/
│   └── source-graph.json              # 内置样本图
├── deepseek_out_pass/                 # DeepSeek 不同 Pass 快照 JSON
├── nav_index.json                     # Pass 导航索引
└── 业务理解/                          # PRD 与研究文档
    ├── PROJECT_INDEX.md               # 本文档
    ├── PTO_数据流调试工作台_PRD.md      # 数据流优先的一体化工作台 PRD
    ├── ARCHITECTURE_REVIEW_AND_ROADMAP_PLAN.md  # 架构 Review + 路标对齐
    ├── NODE_GROUP_VIEW_PRD.md         # 节点聚类特性 PRD
    ├── MVP_INTEGRATION_RETROSPECTIVE.md
    ├── DEEPSEEK_ARCHITECTURE_INTERACTIVE_PRD.md
    ├── COMPUTE_GRAPH_问题定位场景与续期需求洞察.md
    ├── OP_TO_CODEGEN_FLOW_PLAN.md
    ├── OUTPUT_DEEPSEEK_NAVIGATION_DESIGN.md
    ├── IR_Pass00_LoopUnroll_节点聚类研究报告.md
    ├── 大模型推理并行策略_DP_TP_PP_SP_EP_阅读笔记.md
    └── VERTICAL_LAYOUT_TENSOR_LABEL_PLAN.md
```

---

## 核心模块职责

| 文件 | 职责 | 关键入口 |
|------|------|---------|
| `js/app.js` | 主控制器：加载 / 状态 / 交互 / Group 视图 / 颜色模式 | `loadFile()`, `buildGroupedGraphModel()`, `annotateGraphModel()` |
| `js/parser.js` | 解析两种 JSON 格式，输出统一图模型 | `parseGraphData()` |
| `js/layout.js` | DAG LR 分层布局（Sugiyama） | `computeLayout(graph, options)` |
| `js/renderer.js` | 节点 DOM 卡片 + SVG 曲线连线 + Group 卡片 | `renderGraph()`, `buildGroupCard()` |
| `js/colormap.js` | 6 种颜色策略：语义/时延/子图/执行单元/opcode 推断 | `getSemanticKey()`, `buildPipelineSemanticColorMap()` |
| `js/nav.js` | Pass 时间线导航（四层状态：Loop/Unroll/Path/Snap） | `setNavIndex(data)`, `loadCurrent()` |
| `js/controlflow.js` | 控制流面板，源码映射线绘制 | `renderControlflow()` |
| `model-architecture/app.js` | X6 封装：L1→L4 折叠展开，V3/V3.2 切换 | `buildScene()`, `buildExpandableGroup()` |

**脚本加载顺序**（`pass-ir/index.html`）：`colormap` → `parser` → `layout` → `renderer` → `nav_index_builder` → `app` → `nav` → `controlflow-data` → `controlflow`

---

## 共享边界

| 资源 | 属于 | MVP 是否接入 |
|------|------|------------|
| `css/style.css` Design Token | 共享 | ✅ v0.5 完成 |
| JetBrains Mono 字体 | 共享 | ✅ v0.5 引入 |
| `js/colormap.js` | 主模块 | ✗（MVP 用 X6 节点直接传色值） |
| `model-architecture/x6.min.js` | MVP 独占 | — |
| `model-architecture/data.js` | MVP 独占 | — |
| `js/antv-flow.js` | source-flow/index.html 专用 | — |

---

## 数据格式

`parser.js` 兼容两种输入，统一输出 `{ nodes, edges, meta }`：

| 格式 | 特征字段 | 来源 |
|------|---------|------|
| Sample 格式 | `nodes`, `edges` | 手工构造 / 轻量示例 |
| Compiler 格式 | `entryhash`, `functions`, `version` | 编译器直接输出（主要样本） |

Compiler 格式可提取：tensor shape/dtype/symbol、op latency/opcode/subgraphId、incast/outcast 边界关系。

---

## 运行时数据流（精度调试模块）

```
用户加载 JSON（文件选择 / 拖拽 / 文件夹 / 样例）
    ↓
app.js → parser.js        解析为统一图模型
    ↓
annotateGraphModel()      预计算 flowSignature / inferredSemanticLabel
    ↓
layout.js                 Sugiyama 分层布局，输出节点坐标
    ↓
renderer.js               渲染 DOM 节点卡片 + SVG 连线
    ↓
app.js                    更新图例、统计、详情面板、minimap
    ↓
（Group 模式）buildGroupedGraphModel() → computeLayoutForGraph() → 重新渲染
```

---

## 本地运行

无需构建，推荐用本地 server 避免浏览器 CORS 限制：

```bash
npx serve .
# 访问 http://localhost:3000/launch.html
```

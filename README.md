# PTO — 计算图工作台

PTO 是面向 Ascend NPU 算子开发、编译 Pass 分析、执行泳道和硬件数据路径理解的本地可视化工作台。项目主体是静态前端，优先使用 HTML、CSS 和原生 JavaScript；少数实验模块使用独立的 Vite 或 Node 子工程。

**线上入口**：[launch.html](https://yinyucheng0601.github.io/compute-graph-viewer/launch.html)  
**启动台 v2**：[launch-v2.html](https://yinyucheng0601.github.io/compute-graph-viewer/launch-v2.html)

---

## 快速开始

多数页面需要通过本地 HTTP 服务访问，避免 `file://` 下 fetch、ES 模块或 iframe 资源加载失败。

```bash
cd /Users/yin/pto
python3 -m http.server 8765
```

打开：

```text
http://127.0.0.1:8765/launch.html
```

也可以使用 Node：

```bash
npx serve .
```

---

## 主入口

| 入口 | 文件 / 链接 | 用途 |
|------|-------------|------|
| 启动台 | `launch.html` | 项目总启动页，聚合高保真工作台、实验模块和演示入口 |
| 启动台 v2 | [launch-v2.html](https://yinyucheng0601.github.io/compute-graph-viewer/launch-v2.html) | GitHub Pages 版本的 CANN PTO 启动台 v2，使用卡片预览、白皮书 SVG 封面和顶部导航 |
| 演示页 | `low-fi/ppt-web.html` | 演示汇报入口 |
| 设计系统技能 | [pto-design-system](https://github.com/yinyucheng0601/pto-design-system) | PTO 设计系统专用技能仓库 |

---

## 核心模块

| 模块 | 入口 | 说明 |
|------|------|------|
| 950B 硬件路径工作台 | `ascend-950-workbench-demo/index.html` | 面向 Ascend 950B 的硬件路径、算子迁移和 tiling 执行理解 |
| A3/A5 差异解读 | `ascend-950-workbench-demo/feature_taxonomy.html` | A3 到 A5 算子迁移差异、分类和硬件联动解读 |
| Ascend 950 流向图 | `ascend-hardware-map/ascend-hardware-map-v3.html` | 950 数据搬运路径、通信指令和硬件流向地图 |
| A5 PMU 诊断工作台 | `pmu/06-a5-pmu-visualization-group2-loop.html` | PMU 数据、循环分组和泳道式性能诊断 |
| Pass IR 计算图 | `pass-ir/index.html` | 编译 Pass 快照浏览、节点分组、语义染色和计算流锁定 |
| 内存查看器 | `mem_viewer/index.html` | 计算图与 DDR/L1/L0/UB 内存层级联动的逐步执行视图 |
| 泳道执行视图 | `swimlane/index.html` | AIC/AIV 任务泳道、目录导入、前后对比和任务下钻 |
| 图执行叠加原型 | `indexer-exec/index.html` | DAG、执行热度、核分配和诊断信息的叠加原型 |
| 模型算子层级架构图 | `model-architecture/index.html` | DeepSeek V3/V3.2 L1 到 L4 的多层级折叠图 |
| TorchVista / Graphviz 预览 | `graphviz/torchvista_graphviz_deepseek_v4.html` | DeepSeek V4 图结构预览 |
| 算子 IDE 助手 | `op-ide-assistant/index.html` / `op-ide-assistant-v2/index.html` | 面向算子开发的 IDE 辅助原型 |
| 泳道性能工具 | `pypto-swimlane-perf-tool/index.html` | 泳道性能数据解析、统计和对比工具 |
| 源码流 | `source-flow/index.html` | 源码计算流实验入口 |
| 图原型实验室 | `graph-prototype-lab/index.html` | 通用图布局、方向切换、分组和检查器实验室 |
| 竞品分析 | `计算领域竞分/index.html` | CUDA / ROCm / Triton 等算子开发体验竞品分析 |

---

## 白皮书页面

| 白皮书 | 页面链接 |
|--------|------------|
| 硬件原生系统：面向 Ascend NPU 的 AI 编译运行时栈白皮书 | https://yinyucheng0601.github.io/compute-graph-viewer/hw-native-sys/ |
| HNSW 白皮书：分层导航小世界图与向量检索工程 | https://yinyucheng0601.github.io/compute-graph-viewer/HNSW/HNSW-whitepaper.html |
| H-Anchor：分层锚点 VLSI 布局算法白皮书 | https://yinyucheng0601.github.io/compute-graph-viewer/PycPlacer/pycplacer-whitepaper.html |
| VLSI 布局白皮书：布局算法如何实现芯片“核舟记” | https://yinyucheng0601.github.io/compute-graph-viewer/vlsi-placement-whitepaper/ |
| PyPTO 工具链白皮书 | `pypto-toolchain-whitepaper/index.html` |
| PTO 白皮书总稿 | `whitepaper.md` |

---

## 目录地图

```text
pto/
├── launch.html                         # 项目总启动页
├── vendor/pto-design-system/           # 设计系统 submodule，运行时默认来源
├── js/                                 # Pass IR 共享解析、布局、渲染和导航逻辑
├── assets/                             # 启动台和演示图像资源
├── data/                               # 内置样本图数据
├── pass-ir/                            # Pass IR 计算图工作台
├── mem_viewer/                         # 内存层级与计算图联动视图
├── swimlane/                           # 执行泳道主模块
├── ascend-950-workbench-demo/           # 950B 硬件路径和迁移工作台
├── ascend-hardware-map/                # Ascend 数据搬运流向图
├── pmu/                                # A5 PMU 可视化原型
├── model-architecture/                 # 大模型算子层级架构图
├── graph-prototype-lab/                # 图布局实验室
├── op-ide-assistant*/                  # IDE 助手两版原型
├── pypto-swimlane-perf-tool/           # 泳道性能分析工具
├── hw-native-sys/                      # 硬件原生系统白皮书页面
├── HNSW/                               # HNSW 白皮书资料和页面
├── PycPlacer/                          # H-Anchor / PycPlacer 白皮书页面
├── vlsi-placement-whitepaper/          # VLSI 布局白皮书页面
└── 业务理解/                           # PRD、研究笔记、迁移方案和项目索引
```

---

## 模式库

复用图形模式以 `vendor/pto-design-system/patterns/patterns.json` 为准。

| 模式 | 路径 | 用途 |
|---------|------|------|
| swimlane-task-bar | `vendor/pto-design-system/patterns/swimlane-task/` | 泳道任务条 |
| memory-architecture-layout | `vendor/pto-design-system/patterns/memory-architecture/` | 内存架构层级图 |
| aic-core-object | `vendor/pto-design-system/patterns/aic-core-object/` | AIC 核心对象图形 |
| aiv-core-object | `vendor/pto-design-system/patterns/aiv-core-object/` | AIV 核心对象图形 |
| pass-ir-graph-node | `vendor/pto-design-system/patterns/pass-ir-graph-node/` | Pass IR 图节点 |
新增图形模式时保持 `pattern.html` / `pattern.css` / `pattern.js` / `pattern.json` 结构，并同步更新 `vendor/pto-design-system/patterns/patterns.json`。

---

## 子工程

根目录整体无统一构建流程。以下目录是独立子工程，进入各自目录后按本地 `package.json` 运行：

| 子工程 | 说明 |
|--------|------|
| `ai-for-design-open-slide/` | Open Slide 演示工程 |

---

## 维护规则

- 新页面优先通过 `launch.html` 暴露入口；若只是实验或归档，放在 `archive/` 或对应模块目录内。
- 设计系统规范以 [pto-design-system](https://github.com/yinyucheng0601/pto-design-system) 为准，README 不再维护展开说明。
- 页面运行时默认引用 `vendor/pto-design-system/...`；`design-system-share/`、根目录 `tokens/`、`css/`、`patterns/` 只在需要兼容旧工具时由同步脚本临时生成。
- 复杂图形先判断是否应沉淀为 `patterns/`，避免在页面里散落重复的 SVG、Canvas 或 DOM 图形实现。
- 白皮书和研究资料优先放在明确模块目录或 `业务理解/`，避免根目录继续堆积临时文件。
- 当前工作区包含较多历史原型和迁移中目录，修改前先看 `git status`，不要顺手清理无关文件。

---

## 版本日志

详见 `CHANGELOG.md`。

**维护者**：Yin Yucheng

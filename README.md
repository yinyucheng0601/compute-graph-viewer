# PTO — Compute Graph Viewer

面向 Ascend NPU 的计算图本地可视化工具，纯静态前端（HTML + CSS + Vanilla JS），无需构建。

**[→ 打开 Launcher](https://yinyucheng0601.github.io/compute-graph-viewer/launch.html)**

---

## 三个入口

| 入口 | 文件 | 功能 |
|------|------|------|
| Pass IR 计算图 | `index.html` | 精度调试：逐 Pass 追踪编译优化，节点聚类，锁定计算流 |
| 大模型整网架构 | `mvp/index.html` | 架构洞察：DeepSeek V3 L1→L2→L3→L4 折叠展开 |
| 源码计算流 `beta` | `visual-test.html` | 性能调优：算子 Python 源码 → 计算路径 + 数据依赖 |

---

## 快速开始

```bash
npx serve .
# 访问 http://localhost:3000/launch.html
```

---

## 核心功能

**精度调试（Pass IR 计算图）**
- DAG 可视化：Incast / Op / Tensor / Outcast 四种节点，SVG 曲线连线
- Pass 导航：Loop / Unroll / Path / Snap 四层状态，追踪跨 Pass 节点演变
- 节点聚类（Group 视图）：按 flowSignature + 结构指纹聚合同类节点，支持 5 种颜色模式
- 锁定计算流：固定选中的 Tensor 链路，Pass 切换时持续追踪
- Controlflow 面板：开发者控制流 ↔ 编译器生成控制流双列对比

**架构洞察（大模型整网架构）**
- L1 整网 → L2 融合算子 → L3 基础算子 → L4 步骤展开，四级递进
- V3 / V3.2 模型版本切换，实时对比结构差异
- 深色主题，与精度调试模块视觉统一（v0.5）

---

## 项目结构

```
pto/
├── launch.html          # 启动页（三卡片导航）
├── index.html           # 精度调试
├── visual-test.html     # 源码计算流（beta）
├── CHANGELOG.md         # 开发日志
├── css/style.css        # 主样式 + Design Token
├── js/
│   ├── app.js           # 主控制器
│   ├── parser.js        # JSON 解析
│   ├── layout.js        # Sugiyama 分层布局
│   ├── renderer.js      # 渲染（节点卡片 + SVG 连线）
│   ├── colormap.js      # 颜色映射（语义/时延/分区/执行单元）
│   ├── nav.js           # Pass 导航条
│   └── controlflow.js   # Controlflow 面板
├── mvp/
│   ├── index.html       # 大模型整网架构
│   ├── app.js           # X6 封装（L1→L4）
│   ├── data.js          # DeepSeek V3/V3.2 内置数据
│   └── styles.css       # MVP 样式（与主站 Design Token 对齐）
└── 业务理解/            # PRD + 设计文档
    └── PROJECT_INDEX.md # 完整模块索引
```

---

## 技术架构

- **前端**：纯 HTML + CSS + Vanilla JS，无构建依赖
- **布局算法**：自研 Sugiyama 分层布局（`js/layout.js`）
- **MVP 图库**：AntV X6（仅 `mvp/` 使用，bundle 隔离）
- **主题**：深色系，Design Token 集中于 `css/style.css`

---

## 版本日志

详见 [CHANGELOG.md](CHANGELOG.md)

| 版本 | 日期 | 主要变更 |
|------|------|---------|
| v0.5 | 2026-03-12 | MVP 暗色主题统一、语义染色 VIEW/RESHAPE 修复、Launcher beta 徽章 |
| v0.4 | 2026-03-11 | MVP 接入探索（复盘） |
| v0.3 | 2026-03 | Launcher 文件夹 handoff、Group 视图、锁定计算流 |
| v0.2 | 2026-03 | Pass 导航重设计、迷你地图改进 |
| v0.1 | 2026-03 | 初始发布、Pass Navigator |

---

**维护者**：Yin Yucheng

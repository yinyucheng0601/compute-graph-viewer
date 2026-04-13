# PTO — Compute Graph Viewer

面向 Ascend NPU 的计算图本地可视化工具，纯静态前端（HTML + CSS + Vanilla JS），无需构建。

**[→ 打开 Launcher](https://yinyucheng0601.github.io/compute-graph-viewer/launch.html)**

---

## 四个入口

| 入口 | 文件 | 功能 |
|------|------|------|
| 大模型整网架构 | `model-architecture/index.html` | 架构洞察：DeepSeek V3 L1→L2→L3→L4 折叠展开 |
| Pass IR 计算图 | `pass-ir/index.html` | 精度调试：逐 Pass 追踪编译优化，节点聚类，锁定计算流 |
| Swimlane 执行视图 | `swimlane/index.html` | 执行态观察：AIC / AIV 真实任务泳道，支持本地 `merged_swimlane.json` |
| 图执行叠加原型 | `execution-overlay/index.html` | 研究视图：解析 `claude.txt` 原型，把 DAG、执行热度、核分配和诊断信息叠到一张图上 |

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
├── launch.html          # 启动页（四卡片导航）
├── pass-ir/
│   └── index.html       # 精度调试
├── execution-overlay/
│   ├── index.html       # 图执行叠加原型解读
│   ├── app.js           # 原型语义提炼版交互
│   └── styles.css       # 原型模块样式
├── swimlane/
│   ├── index.html       # Swimlane 执行视图
│   ├── app.js           # Swimlane viewer 解析与渲染
│   └── styles.css       # Swimlane 页面样式
├── archive/
│   └── unreferenced-20260319/ # 无引用旧文件归档
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
├── model-architecture/
│   ├── index.html       # 大模型整网架构
│   ├── app.js           # X6 封装（L1→L4）
│   ├── data.js          # DeepSeek V3/V3.2 内置数据
│   └── styles.css       # MVP 样式（与主站 Design Token 对齐）
├── source-flow/
│   └── index.html       # 源码计算流（保留在仓库，当前不在 Launcher 主入口）
├── graph-prototype-lab/ # 图原型实验室（辅助入口）
└── 业务理解/            # PRD + 设计文档
    └── PROJECT_INDEX.md # 完整模块索引
```

---

## 设计系统

PTO 使用四层 Design Token 架构，所有颜色、排版、间距通过 CSS 变量统一管理。

### Token 层级

```
tokens/foundation.css   # 原始值：色盘、字号、间距、圆角、阴影、动效
tokens/semantic.css     # 语义映射：background / foreground / border / surface / 交互状态
tokens/components.css   # 组件规格：toolbar / button / input / panel / card / tag
tokens/generate_tokens.py # 生成器：从三份 CSS token 源导出 tokens.js / tokens.json
css/style.css           # 节点图场景 Token + alias（模块消费层）
```

### Token 概览

**foundation.css**
- Neutral 灰阶：`--ark-neutral-0 ~ 4`（纯中性，无蓝色偏移）
- Accent：blue-500 / blue-600 / domain-aux / green-500 / orange-500 / red-500
- 排版：6 个字号档（11px ~ 28px）、font-weight（500 / 600 / 700）
- 间距：`--space-1 ~ 6`（4px ~ 24px）
- 圆角：`--radius-sm / md / lg / xl / pill`
- 阴影：`--shadow-sm / md / lg`
- 动效：`--duration-fast / base / slow` + `--easing-default / out`

**semantic.css（深色主题 :root）**
- Background：`--background`、`--background-elevated`
- Surface：`--surface-1 ~ 4`（纯中性灰）
- Foreground：`--foreground` / `secondary` / `muted` / `disabled`（HOS alpha 四档：0.90 / 0.60 / 0.40 / 0.25）
- Border：`--border-subtle / default / strong`（白色 alpha，纯中性）
- 语义色：`--primary` / `accent` / `success` / `warning` / `danger`
- Tone：`--tone-critical-bg / warning-bg / info-bg` 与 `--tone-*-strong`
- 交互状态叠加：`--state-hover / press / selected / focus`

**components.css**
- Toolbar：`--comp-toolbar-height / bg / border`
- Button：primary / secondary / ghost 高度、圆角、前景背景
- Input / Panel / Card / Table / Tag：统一尺寸与边框语义
- Typography Composites：7 个排版角色（`--text-display / title-1 / title-2 / body / body-sm / label / mono`），消费方直接用 `font: var(--text-body)` 即可

**css/style.css（场景 Token）**
- Pass-IR 节点面：`--node-bg-elevated / hover / selected`（比画布略亮）
- Severity alias：`--severity-critical / warning / info`
- Accent alias：`--accent-blue / yellow / green`

### 模块接入状态

| 模块 | 接入 | 说明 |
|------|------|------|
| pypto-swimlane-perf-tool | ✅ | `style.css + foundation + semantic + components`，保留少量场景扩展 |
| swimlane / swimlane-bench | ✅ | `style.css + foundation + semantic + components` |
| mem_viewer / source-flow / execution-overlay / indexer-exec | ✅ | 通过 `css/style.css` 间接消费共享 token |
| pass-ir | ✅ | 通过 `css/style.css` 间接消费共享 token，节点提升面已统一到共享 `surface-4` |
| op-ide-assistant | △ | 仅接入 `foundation.css + semantic.css`，缺 `components.css` 与 `css/style.css` |
| graph-prototype-lab | ✕ | 仅手工镜像 token 数值，未实际 import 共享 token |
| model-architecture | ✕ | 仅手工镜像 token 数值，未实际 import 共享 token |
| devui | ✕ | Angular bundle 体系，尚未接入当前静态 token 路径 |

### 当前缺口

- `tokens/tokens.js`、`tokens/tokens.json` 现为生成产物，不应手工维护；单一来源是三份 CSS token 源。
- `graph-prototype-lab`、`model-architecture` 已做视觉对齐，但还不是设计系统真实接入。
- `op-ide-assistant` 仍维护自己的组件变量映射，后续适合拆成“壳层接入 style.css + 组件层复用”两步。

### Token 生成

更新 token 快照时执行：

```bash
python3 tokens/generate_tokens.py
```

规则：

- 修改 token → 改 `foundation.css` / `semantic.css` / `components.css`
- 运行生成器
- 不要直接编辑 `tokens.js` 或 `tokens.json`

---

## 技术架构

- **前端**：纯 HTML + CSS + Vanilla JS，无构建依赖
- **布局算法**：自研 Sugiyama 分层布局（`js/layout.js`）
- **MVP 图库**：AntV X6（仅 `model-architecture/` 使用，bundle 隔离）
- **主题**：深色系，四层 Design Token 架构（见上方「设计系统」章节）

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

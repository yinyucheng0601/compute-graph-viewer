# Compute Graph Memory Viewer — Ascend 910B

Interactive step-by-step visualization of tensor memory movement across the Ascend 910B memory hierarchy (DDR → L1 → L0A/L0B → L0C/UB).

## Quick Start

Requires a local HTTP server (ES modules and SVG fetch won't work over `file://`):

```bash
# Python (built-in)
cd /path/to/pto
python3 -m http.server 8080
# open http://localhost:8080/mem_viewer/

# or Node
npx serve .
```

## Project Structure

```
mem_viewer/
├── index.html            HTML shell
├── styles/
│   └── main.css          All styles (layout, arch diagram, SVG overrides)
├── data/
│   ├── ops.js            OP_DATA — 166 ops with inputs/outputs (ES module)
│   └── graph.svg         Compute graph (sprotty SVG, ~950 KB)
└── js/
    ├── constants.js      Tier constants, color maps, getTensorTier()
    ├── schedule.js       Kahn topo-sort → SCHEDULE, tensor liveness
    ├── memory-panel.js   Right-panel tier chip rendering
    ├── svg-viewer.js     SVG load/fetch, pan/zoom, applyStepToSVG()
    └── playback.js       Entry point — goToStep, play/pause, keyboard
```

## Module Dependency Graph

```
playback.js  ←  constants.js  ←  ops.js
             ←  schedule.js   ←  constants.js
             ←  memory-panel.js ← schedule.js
             ←  svg-viewer.js ←  constants.js, schedule.js
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `→` / `l` | Next step |
| `←` / `h` | Previous step |
| `Space` | Play / Pause |
| `f` | Fit graph |
| `Home` | First step |
| `End` | Last step |

## Adding a New Graph

1. Export your compute graph as an SVG from your tool (sprotty-compatible node IDs expected: `sprotty_operation-magic-{id}-0`, `sprotty_tensor-{id}-0`)
2. Replace `data/graph.svg`
3. Replace `OP_DATA` in `data/ops.js` with your op list (`{m, n, i, o}`)
4. Update the header badge in `index.html` if needed

---

## 从原型集成到 PTO 工程：最佳实践

本节记录 mem_viewer 从单文件低保真原型（`mem_viewer.html`）演化为当前模块化工程的完整经验，供后续模块集成参考。

### 原型 vs 工程的典型差距

| 维度 | 低保真原型 | PTO 工程模块 |
|---|---|---|
| 文件结构 | 单文件 HTML（样式+逻辑+数据混合） | `index.html` + `styles/` + `js/` 分层 |
| 主题 | 亮色（白底黑字） | 暗色设计系统（`css/style.css` tokens） |
| 控件 | 底部固定 panel | 浮动 liquid glass toolbar |
| 图渲染 | 简单 SVG 加载器 | 复用 pass-ir 渲染栈（colormap / parser / layout / renderer） |
| 布局 | 面向演示（左右分割） | 面向使用（上下分割，避免遮挡） |
| 数据 | 内联 mock | 独立 `constants.js` + `schedule.js` |

---

### Step 1：读懂原型，整理 inventory（不写代码）

开始写代码前先做这三件事：

**列出 UI 区块**：header / panel A / panel B / controls 各自的职责是什么。

**列出交互行为**：哪些是状态变更（需要 JS），哪些是纯展示（只需 CSS）。

**列出数据 shape**：原型里 mock 数据的结构，决定后续 constants / schedule 怎么设计。

同时标出哪些原型组件 PTO 已有可以直接复用（toolbar、badge、btn、floating shell 等定义在 `css/style.css`）。

---

### Step 2：确定布局方案

原型布局往往从演示角度设计，集成时需要重新评估：

- 图和架构图哪个更重要 → 决定主次面积分配
- 控件是否遮挡关键内容 → 决定是否用浮动 toolbar（mem_viewer 从底部固定改为 floating bar）
- 是否需要嵌入已有 frame → 决定是否复用全局 toolbar HTML 结构

---

### Step 3：主题 token 映射

原型通常用亮色或 devui/vscode token，PTO 用暗色设计系统。映射规律：

```
原型实色背景      rgba(59,130,246,1)    → PTO tint   rgba(53,119,246,0.12)
原型实色边框      border: 2px solid     → PTO subtle  border-color: rgba(...,0.38)
原型深色文字      rgba(0,0,0,0.50)      → PTO bright  rgba(255,255,255,0.65)
原型白底          #ffffff / #f0f2f5     → PTO dark    #1a1a1a / #202020
```

灰色文字对比度底线：在 `#1a1a1a` 背景上，`rgba(255,255,255,α)` 的 α 不低于 **0.56**（等效 #9C9C9C），否则不可读。三级文字层级参考：

```css
--text-primary:   rgba(255,255,255,0.92);  /* 标题、关键数值 */
--text-secondary: rgba(255,255,255,0.65);  /* 说明文字、标签 */
--text-dim:       rgba(255,255,255,0.56);  /* 辅助信息、单位 */
```

**暗色下"层层盒子"陷阱**：亮色原型中用颜色区分的嵌套框，暗色下全部退化成灰框，反而增加视觉噪音。集成时主动评估：外层容器框是结构性的还是装饰性的，装饰性的去掉，只保留 buf-box 级别的直接容器。

---

### Step 4：模块拆分原则

单文件原型 → 工程结构的标准拆法：

```
原型 (monolith)
    ├── index.html            骨架，引用全局 css/style.css 后再引用本模块 styles/main.css
    ├── styles/main.css       本模块样式，只覆盖全局不够用的部分
    └── js/
        ├── constants.js      静态配置、枚举、tier 映射（无副作用）
        ├── <data>.js         数据层：原型的 mock 数据提炼为 schedule/liveness 等
        ├── <panel>.js        渲染层：DOM 更新函数，接受 step 参数，无状态
        ├── <viewer>.js       图/图表渲染，封装 pan/zoom/highlight
        └── playback.js       入口：状态管理 + 控件绑定，调用各渲染层
```

核心原则：**数据层 / 渲染层 / 状态层分离**。渲染函数只做"给我一个 step，我更新 DOM"，不持有状态。

---

### Step 5：接驳 PTO 共享渲染能力

PTO 已有的全局 JS 可直接 `<script src>` 复用，无需重写：

| 文件 | 提供的能力 |
|---|---|
| `js/colormap.js` | 语义染色、调色板生成、engine/memory 颜色映射 |
| `js/parser.js` | 解析 pass-ir JSON，构建 nodes/edges |
| `js/layout.js` | Sugiyama 分层布局，计算节点坐标 |
| `js/renderer.js` | SVG 渲染（节点卡片 + 曲线连线），返回可挂载的 DOM |

接驳图渲染栈的最小接口：

```js
// 加载图（一次性）
loadGraph('data/sample-graph.json');

// 每次 step 变化时调用（highlight 当前执行节点）
applyStepToGraph(step);   // 通过 .mv-op-executing / .mv-tensor-input 等 CSS 类驱动
```

状态通过 CSS 类名传递，渲染逻辑无需修改，在本模块 `styles/main.css` 里覆盖对应类的样式即可。

---

### Step 6：tensor / 数据元素的视觉设计

原型的 tensor chip 通常是矩形标签（`min-width` + `padding`），集成时改为正方形：

```css
.tensor-block {
  width: var(--tensor-sz);     /* 如 26px */
  height: var(--tensor-sz);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

容器背景用 CSS grid 纹理对齐 tensor 尺寸，让空槽位也可读：

```css
.tensor-chips {
  flex: 1;                     /* 撑满父容器，网格才能全区域铺开 */
  background-image:
    linear-gradient(rgba(255,255,255,0.10) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.10) 1px, transparent 1px);
  background-size: calc(var(--tensor-sz) + 3px) calc(var(--tensor-sz) + 3px);
  /* +3px = gap，使网格线落在 tensor 间隙上 */
}
```

关键：`tensor-chips` 必须有 `flex: 1`，否则容器只有内容高度，网格只会渲染一行。

---

### Step 7：颜色系统

语义染色所有颜色保持在 **蓝绿 → 紫** 弧段（H=150°–300°），排除红/黄/橙/绿：

```js
// colormap.js FORBIDDEN zone
{ from: 300 / 360, to: 150 / 360, wraps: true }
```

CORE palette 和 PIPELINE_HUES 全部落在此弧段内，`expandPalette` 插值也不会越界。新增 pipeline 类别时，在 150°–300° 内分配一个未占用的 hue 值即可。

---

### 常见坑

| 坑 | 原因 | 解法 |
|---|---|---|
| 网格只显示一行 | `tensor-chips` 缺 `flex: 1`，高度为内容高度 | 加 `flex: 1` |
| 网格和 tensor 对不上 | grid 从父容器顶部开始，tensor 在子容器内 | 把 `background-image` 放在 `tensor-chips` 而非 `buf-box` |
| 暗色下全是灰框 | 原型嵌套盒子直接翻译，缺乏层次 | 去掉外层装饰性框，只保留直接数据容器 |
| 灰色文字不可读 | token α 过低（如 0.28、0.45） | 保证最低 α≥0.56（≈#9C9C9C on #1a1a1a） |
| tensor 颜色和图例不匹配 | JS 渲染层用半透明 tint，图例用实色 | 统一 bg 为实色（α≥0.85），text 为 #ffffff |

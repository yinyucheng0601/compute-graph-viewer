# Compute Graph Viewer

A browser-based visualizer for Ascend NPU computation graphs.

**[→ Open Launcher](https://yinyucheng0601.github.io/compute-graph-viewer/launch.html)**

## 🎯 项目概述

**Compute Graph Viewer** 是一个专门为华为Ascend NPU设计的计算图可视化工具，采用纯前端技术栈实现，无需构建步骤即可运行。该项目主要用于展示和分析从Ascend IR导出的计算图数据。

## 🚀 核心功能

- **计算图可视化**：支持四种节点类型：**Incast**（输入）、**Op**（操作）、**Tensor**（张量）、**Outcast**（输出）
- **智能布局**：基于Sugiyama算法的分层布局，自动优化节点排列和交叉最小化
- **交互操作**：缩放、平移、自适应视图、迷你地图导航
- **节点详情**：点击任意节点查看详细属性信息
- **多种加载方式**：拖拽上传JSON文件、文件选择器、直接打开编译优化文件夹
- **颜色编码**：支持语义、子图、延迟等多种颜色映射模式
- **时间线导航**：支持编译优化过程的时间线浏览和对比

## 📁 项目结构索引

### 核心文件映射

| 文件路径 | 功能描述 | 主要职责 |
|---------|---------|---------|
| `index.html` | 主页面入口 | UI布局、工具栏、详情面板 |
| `js/app.js` | 主控制器 | 文件加载、缩放平移、选择管理、详情面板 |
| `js/layout.js` | 图布局引擎 | Sugiyama分层布局算法实现 |
| `js/renderer.js` | 图形渲染器 | SVG节点和边渲染、颜色映射 |
| `js/parser.js` | 数据解析器 | JSON数据解析和验证 |
| `js/controlflow.js` | 控制流处理 | 控制流图构建和导航 |
| `js/colormap.js` | 颜色映射管理 | 颜色编码方案实现 |
| `js/nav.js` | 导航栏控制 | 时间线导航和路径选择 |
| `css/style.css` | 主样式文件 | 整体UI样式和主题 |

### 数据文件说明

| 文件/目录 | 用途 | 示例 |
|----------|------|------|
| `data/source-graph.json` | 示例计算图数据 | 包含完整节点和边信息 |
| `deepseek_out_pass/` | 编译优化过程文件 | 包含多个优化阶段的图数据 |
| `assets/` | 资源文件目录 | SVG图标、节点图形等 |

## 🔧 代码模块详解

### 1. 主控制器 (`app.js`)
**核心功能**：协调整个应用的运行
- 文件加载和解析
- 视图缩放平移控制
- 节点选择和详情展示
- 迷你地图渲染
- 颜色模式切换

**关键数据结构**：
```javascript
let graph = null;        // 当前加载的计算图
let layout = null;       // 布局计算结果
let tx = 0, ty = 0, scale = 1;  // 视图变换参数
let selectedNodeId = null;      // 当前选中节点
```

### 2. 布局引擎 (`layout.js`)
**算法实现**：Sugiyama分层布局算法
- 节点分层（Layer Assignment）
- 交叉最小化（Crossing Minimization）
- 坐标计算（Coordinate Assignment）

**核心函数**：
- `computeLayeredLayout()` - 主布局计算函数
- `assignLayers()` - 节点分层
- `minimizeCrossings()` - 交叉优化

### 3. 渲染器 (`renderer.js`)
**渲染职责**：
- SVG节点和边的绘制
- 颜色映射应用
- 交互状态管理（悬停、选中）
- 动画效果实现

### 4. 数据解析 (`parser.js`)
**数据格式**：支持Ascend IR导出的JSON格式
```json
{
  "graph_name": "示例图",
  "nodes": [
    {"id": "node1", "type": "Incast", "name": "输入", "dtype": "DT_FP32", "shape": ["T", "H"]}
  ],
  "edges": [
    {"source": "node1", "target": "node2"}
  ]
}
```

## 🎮 使用指南

### 快速开始
1. **直接运行**：在浏览器中打开 `index.html`
2. **本地服务**：使用静态文件服务器
   ```bash
   npx serve .
   # 或
   python -m http.server 8000
   ```

### 数据加载方式
1. **单个文件**：点击"Select Graph"选择JSON文件
2. **拖拽上传**：直接将JSON文件拖拽到页面
3. **文件夹加载**：点击"Open Pass Folder"选择包含多个优化阶段的文件夹

### 交互操作
- **缩放**：鼠标滚轮或工具栏按钮
- **平移**：鼠标拖拽画布
- **自适应**：点击"Fit View"按钮
- **节点详情**：点击任意节点查看属性
- **颜色模式**：通过颜色面板切换不同编码方案

## 🏗️ 技术架构

### 前端技术栈
- **HTML5/CSS3/JavaScript** - 纯前端实现，无构建依赖
- **SVG** - 矢量图形渲染
- **Canvas** - 迷你地图绘制
- **LocalStorage** - 本地数据持久化

### 架构特点
- **模块化设计**：各功能模块职责清晰，易于维护
- **响应式布局**：适配不同屏幕尺寸
- **性能优化**：大数据量下的流畅渲染
- **可扩展性**：易于添加新的节点类型或布局算法

## 🔍 开发调试

### 调试工具
- 浏览器开发者工具查看控制台输出
- 使用示例数据文件进行测试
- 检查LocalStorage中的历史记录

### 常见问题
1. **数据格式错误**：确保JSON文件符合Ascend IR导出格式
2. **布局异常**：检查节点间连接关系是否正确
3. **渲染性能**：对于大型图，考虑启用虚拟化渲染

## 📚 相关资源

- [Ascend NPU官方文档](https://www.hiascend.com/)
- [Sugiyama布局算法论文](https://link.springer.com/article/10.1007/BF00289631)
- [SVG图形编程指南](https://developer.mozilla.org/en-US/docs/Web/SVG)

---

**项目维护者**：Yin Yucheng  
**最后更新**：2024年12月  
**许可证**：MIT License

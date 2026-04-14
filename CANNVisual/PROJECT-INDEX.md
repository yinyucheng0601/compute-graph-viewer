# CannVisual 项目索引

芯片架构可视化工具集，面向昇腾（Ascend）910B / 950 芯片的 op 算子执行可视化与架构教学。

---

## 已有页面

| 文件 | 内容 | 状态 |
|---|---|---|
| `950-architecture-x6-figma.html` | 950 芯片层级浏览器（Package→Die→AI Core 钻取导航） | ✅ 完成 |
| `950-architecture-x6-airbnb.html` | 950 架构图（Airbnb 风格） | ✅ 完成 |
| `950-architecture-x6.html` | 950 架构图（基础版） | ✅ 完成 |
| `950-package-wireframe.html` | 950 Package 线框图 | ✅ 完成 |
| `910b-architecture.html` | 910B 架构图 | ✅ 完成 |
| `910b-architecture-x6.html` | 910B 架构图（X6版） | ✅ 完成 |

---

## 待实现

### `950-matmul-visual.html` ← 下一步重点
**目标**：950 芯片完整架构 + matmul 算子逐步执行动画

**布局**：
```
HBM-A | Compute Die A | D2D | Compute Die B | HBM-B
                ↓                    ↓
           IO Die A             IO Die B
```

**核心功能**：
- Compute Die 内 4×4 AI Core 网格，每格内置缩略图
- 点击任意 AI Core → Modal 弹出 910B 风格详细流水线图
- Modal 内 M/K/N 参数输入 + 单步/播放/暂停动画
- 动画：数据从 HBM 经 L3→L2→L1→L0→Cube→L0C→UBuffer 全程流动

**技术栈**：单文件 HTML，Vanilla JS + CSS，SVG 箭头，`<dialog>` Modal

**参考笔记**：`notes-950-architecture.md`，`notes-910b-aicore-internals.md`

---

## 研究笔记

| 文件 | 内容 |
|---|---|
| `notes-910b-aicore-internals.md` | 910B AI Core 内部结构：AIC/AIV、MTE、指令队列、matmul流程 |
| `notes-950-architecture.md` | 950 架构：4-Die设计、内存层级、CCU、950 vs 910B 差异、性能优化思路 |
| `notes-nvidia-h100-blackwell.md` | NVIDIA H100/Blackwell：SM结构、Tensor Core、内存层级、Ascend对照表 |
| `950-architecture-notes.md` | 原始研究素材（从 PDF 提取，含带宽数据参考） |
| `910B-architecture-notes.md` | 910B 原始研究素材 |

---

## 核心概念速查

### Ascend 内存路径（950）
`HBM → L3 → L2 → L1 Buffer → L0A/L0B → Cube → L0C ⇄ UBuffer → Vector/FixPipe`

### NVIDIA 内存路径（H100）
`HBM3 → L2 Cache → L1+Shared Memory → Register File → Tensor Core → Accumulator`

### 关键对应关系
- AI Core ≈ SM（最小计算单元）
- Cube ≈ Tensor Core（矩阵引擎）
- UBuffer ≈ Shared Memory / TMEM
- MTE ≈ cp.async / DMA Engine
- CCU（芯片内集合通信）≈ NVSwitch（机箱级）

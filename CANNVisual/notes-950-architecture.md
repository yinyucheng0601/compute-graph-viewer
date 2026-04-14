# 950 芯片架构笔记

## 整体层级

```
950 Package
├── HBM Stack A（显存）
├── HBM Stack B
├── Compute Die A
│   ├── L3 Cache（16个 AI Core 共享）
│   ├── L2 Cache（16个 AI Core 共享）
│   ├── AI Core × 16
│   │   └── 每个 AI Core 内部（见下方）
│   ├── CCU（集合通信引擎，950新增）
│   ├── DVPP Cluster（媒体处理）
│   └── TS Subsystem（任务调度）
├── Compute Die B（对称镜像）
├── IO Die A
│   ├── PCIe Controller
│   ├── RoCE Interface
│   ├── HiBL × 2
│   ├── HiZQ × 1
│   ├── DMA / Data Movement
│   ├── Link Control（36 Lane / 9 Port）
│   └── Boundary Gateway
└── IO Die B（对称镜像）
```

## 内存层级（完整路径）

```
HBM（片外显存）
 ↓
L3 Cache（Die 级共享）
 ↓
L2 Cache（Die 级共享）
 ↓
L1 Buffer（AI Core 内，私有）
 ↓
L0A / L0B / FP Buffer（AI Core 内）
 ↓
Cube ──→ L0C
          ↕  ← 950 新增直通路径
       UBuffer ──→ Vector / FixPipe
```

## 单个 AI Core 内部（含 950 新增路径）

```
L1 Buffer
 ├─[MTE1]→ L0A ──┐
 ├─[MTE1]→ L0B ──┤──→ Cube ──→ L0C
 └─[MTE1]→ L0B ──┘          ⇕ ← 新增
                          UBuffer ──→ Vector
                          ⇕ ← 新增
                         L1（回写）
```

### 950 新增的关键路径
- **L0C ↔ UBuffer**：Cube 结果可直接进向量单元，不用绕回 L2
- **UBuffer ↔ L1**：向量结果可直接回 L1，减少带宽压力
- **SSBuf**：AI Core 之间消息传递通道

## CCU（集合通信单元）

950 新增，独立于 AI Core 的专用通信引擎：

| 组件 | 作用 |
|---|---|
| Memory Slice (MS) | 缓存待传输/Reduce 数据 |
| Loop Engine | 并发指令执行 |
| GSA | 地址寄存器 |
| GPR | 通用寄存器 |

**解决的问题**：传统 AllReduce 等集合通信会抢占 AI Core 的内存带宽，CCU 独立调度后可与 AI Core 并行执行。

## 950 vs 910B 差异对照

| 维度 | 910B | 950 |
|---|---|---|
| Die 数量 | 单片集成 | 4 Die（2 Compute + 2 IO） |
| 缓存层数 | L2 → L1 → L0 | L3 → L2 → L1 → L0 |
| L0C → 向量路径 | 需经 L2 绕回 | L0C ↔ UBuffer 直通 |
| UBuffer → L1 | 无 | 直通路径（新增） |
| 集合通信 | 占用 AI Core 资源 | CCU 独立处理 |
| L0C 容量 | baseline | 翻倍 |
| 低比特数据类型 | FP16/INT8 | 新增 HiFP8、MXFP8/4、FP4 |
| 每 Die AI Core 数 | 较少 | 16 |
| Tiling 策略 | 基础 | 滑动窗口自适应 Tiling |

## 性能优化核心思路（950）

1. **L2 Cache 命中率** 是 matmul 算子性能的第一优化目标
2. **滑动窗口自适应 Tiling**：同时提升带宽供给和 L2 命中率
3. **双缓冲（Double Buffering）**：掩盖搬运延迟
4. **Cube vs Vector 比例改善**：950 Cube 算力占比更高
5. **存算匹配**：片上存储带宽是瓶颈，不是 Cube 本身

## 可视化页面计划

- **文件**：`950-matmul-visual.html`（待实现）
- **布局**：HBM-A | Compute Die A | D2D | Compute Die B | HBM-B，IO Die 挂在 Compute Die 下方
- **AI Core**：4×4 grid，每格内置缩略图，点击弹出 910B 风格详情 Modal
- **动画**：M/K/N 驱动，逐步展示 tile 从 HBM 流入 AI Core 直至输出
- **线框风格**：暗色背景 + monospace 字体，无渐变

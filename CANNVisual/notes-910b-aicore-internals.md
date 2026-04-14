# 910B AI Core 内部架构笔记

## 整体结构

910B 每个 AI Core 分两个计算单元：**AIC（矩阵）** 和 **AIV（向量）**，共享 L2 Cache 和 Global Memory。

```
Global Memory
     ↕
  L2 Cache
     ↕
 ┌── AIC ──────────────────────────────────┐
 │ L1 Buffer                               │
 │  ├─[MTE1]→ L0A Buffer (矩阵A tile)      │
 │  ├─[MTE1]→ L0B Buffer ×2 (矩阵B双bank)  │──→ Cube ──→ L0C Buffer ──→ FixPipe
 │  └─[FixPipe]→ FP Buffer                │
 └─────────────────────────────────────────┘
 ┌── AIV ──────────────────────────────────┐
 │  Unified Buffer ──────────────────────→ Vector
 └─────────────────────────────────────────┘
```

## 数据搬运单元（MTE，橙色）

| 单元 | 路径 | 说明 |
|---|---|---|
| MTE2 | Global Memory / L2 → L1 Buffer | 远距离搬运 |
| MTE1 | L1 Buffer → L0A / L0B | 近距离 tile 填充 |
| MTE2 | L2 → Unified Buffer（AIV侧） | 向量数据搬运 |
| MTE3 | Unified Buffer ↔ L2（AIV输出） | 向量结果写回 |

## 指令管道

### AIC 指令队列（4条并行）
```
DCache ─┐
        ├─► Scalar ─► 指令序列 ─► Cube 指令序列
ICache ─┘              ◇         FixPipe 指令序列
                                 MTE1 指令序列
                                 MTE2 指令序列
```

### AIV 指令队列（3条并行）
```
DCache ─┐
        ├─► Scalar ─► 指令序列 ─► Vector 指令序列
ICache ─┘              ◇         MTE2 指令序列
                                 MTE3 指令序列
```

## Matmul 执行流程（按 tile 循环）

1. MTE2：从 GM/L2 搬矩阵 A tile → L1 Buffer
2. MTE2：从 GM/L2 搬矩阵 B tile → L1 Buffer
3. MTE1：L1 → L0A（矩阵A）
4. MTE1：L1 → L0B（矩阵B，双 bank 流水）
5. Cube 计算：L0A × L0B → L0C（累加）
6. FixPipe 后处理：量化 / 激活 / 格式转换
7. 写回 GM，循环下一个 tile（由 M/K/N 决定 tile 数量）

## 颜色编码（可视化参考）

| 颜色 | 含义 |
|---|---|
| 橙色 | 搬运单元（MTE） |
| 绿色 | 计算单元（Cube） |
| 蓝色虚线 | 存储单元（L1/L0C Buffer） |
| 粉色 | L0A Buffer |
| 紫色 | L0B Buffer |
| 橙色输出端 | FixPipe |

## 与 950 的关系

910B 的完整架构 ≈ 950 单个 AI Core 内部结构，但 950 新增：
- L0C ↔ UBuffer 直通路径（减少绕回大缓存）
- UBuffer ↔ L1 直通路径
- SSBuf（跨单元消息传递）
- Cube L0C 容量翻倍

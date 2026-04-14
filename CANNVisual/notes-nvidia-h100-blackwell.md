# NVIDIA H100 / Blackwell 架构笔记

## H100（Hopper，GH100）层级结构

```
H100 Package（单片，TSMC 4N，80B 晶体管，814mm²）
├── HBM3 × 5 stacks（80GB，3 TB/s）
├── L2 Cache 50MB（全芯片共享，分 2 个 partition）
│   ├── Partition 0（服务 GPC 0-3）
│   └── Partition 1（服务 GPC 4-7）
└── GPC × 8（Graphics Processing Cluster）
    └── TPC × 9 per GPC（Texture Processing Cluster）
        └── SM × 2 per TPC（Streaming Multiprocessor）
            = 144 SM total（实际启用 132）
```

## SM 内部结构（计算的最小单元）

```
┌──────────── SM（对应 Ascend AI Core）────────────────┐
│  Register File 256KB（线程私有，对应 L0A/L0B）        │
│  L1 Cache + Shared Memory 256KB（可配比例）           │
│                                                       │
│  Warp Scheduler × 4                                  │
│  ├─► CUDA Core × 128（FP32/INT32，对应 Vector Unit）  │
│  ├─► Tensor Core × 4（matmul引擎，对应 Cube）         │
│  └─► SFU（特殊函数，对应 FixPipe）                    │
└───────────────────────────────────────────────────────┘
```

### Tensor Core（第4代，H100）
- 每 SM 4个，全芯片 576个
- 操作：4×4×4 矩阵乘加（D = A×B + C）
- 支持：FP16/BF16/TF32/INT8/INT4
- Warp 级同步执行（WGMMA 指令）

### Warp 调度
- Warp size = 32 线程
- 每 SM 4个独立 Warp Scheduler，可 dual-issue
- 靠多 warp 并发隐藏内存延迟（类似 Ascend 的指令队列流水）

## 内存层级

```
HBM3（80GB，3TB/s，片外）
 ↓ ~数百ns
L2 Cache（50MB，全芯片共享，~150-200 cycles）
 ↓
L1 Cache + Shared Memory（256KB per SM，~28-35 cycles）
 ↓
Register File（256KB per SM，1 cycle）
```

## Blackwell（B100/B200，SM100）关键升级

| 特性 | H100 Hopper | Blackwell |
|---|---|---|
| Die 数量 | 1（单片） | 2（reticle 极限，NV-HBI 互联） |
| 晶体管数 | 80B | 208B（104B × 2） |
| HBM | HBM3 × 5，80GB | HBM3e × 8，192GB |
| L2 Cache | 50MB，2 partition | ~50MB，4 partition per die |
| SM 数量 | 132（启用） | 148（74 per die） |
| Tensor Core | 第4代 | 第5代 |
| 新增内存单元 | — | **TMEM 256KB per SM**（专用 Tensor 内存） |
| MMA 同步方式 | Warp 级同步 | 线程级异步（tcgen05指令） |
| 原生低比特 | FP8（部分） | **FP4/FP6 原生支持** |
| Die 互联带宽 | — | 10 TB/s（NV-HBI） |

### TMEM（Tensor Memory）— Blackwell 新增
- 每 SM 256KB，专用于 Tensor Core 操作
- 解决寄存器压力问题，类似 Ascend 950 的 L0C↔UBuffer 直通路径
- 两者解决同一问题：**矩阵乘结果不用绕回大缓存**

## 对外互联

- **NVLink 4.0**：18条链路，900 GB/s 双向，多卡互联
- **NVSwitch（第3代）**：机箱级全互联交换，最多 256 GPU
- 注：NVIDIA 集合通信在**机箱级** NVSwitch 实现，Ascend CCU 在**芯片内**实现

## Ascend 950 vs NVIDIA H100 对照

| 概念层 | Ascend 950 | NVIDIA H100 |
|---|---|---|
| 片外存储 | HBM Stack × 2 | HBM3 × 5 stacks |
| Die 级共享缓存 | L3 + L2 Cache | L2 Cache 50MB（无L3） |
| 计算单元集群 | AI Core Cluster（16/Die） | GPC（18 SM/GPC × 8） |
| 最小计算单元 | AI Core | SM |
| 矩阵计算引擎 | Cube | Tensor Core × 4 |
| 向量计算引擎 | Vector Unit（AIV） | CUDA Core × 128 |
| 特殊函数 | FixPipe | SFU |
| 本地缓存 | L1 Buffer | L1 + Shared Memory |
| 寄存器级存储 | L0A / L0B | Register File |
| 累加缓存 | L0C | Accumulator Registers |
| 向量暂存 | UBuffer | Shared Memory / TMEM（Blackwell） |
| 数据搬运 | MTE1 / MTE2 / MTE3 | cp.async / DMA Engine |
| 指令调度 | 4条独立指令队列 | 4个 Warp Scheduler |
| 集合通信引擎 | CCU（芯片内） | NVSwitch（机箱级） |
| 多 Die 互联 | D2D Fabric | NV-HBI（Blackwell） |

## 架构哲学差异

| | Ascend | NVIDIA |
|---|---|---|
| 指令暴露程度 | PTO ISA 与硬件 1:1 对应，直接暴露硬件 | CUDA 抽象层，硬件细节不完全公开 |
| 缓存层数 | HBM→L3→L2→L1→L0（5层） | HBM→L2→L1（3层） |
| 通信引擎位置 | 芯片内 CCU | 机箱级 NVSwitch |
| Tiling 策略 | 滑动窗口自适应，L2命中率优先 | WGMMA 异步 + 持久化 kernel |
| 低比特支持 | HiFP8/MXFP8/FP4 | FP4/FP6（Blackwell原生） |

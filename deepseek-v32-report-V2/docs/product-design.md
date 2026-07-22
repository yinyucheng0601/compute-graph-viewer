# DeepSeek V3.2 Profiling Report — 产品设计说明

> 独立工程入口：`../index.html`  
> 产品契约：`./SPEC-full-model-architecture-overlay.md`

## 1. 产品定位

把局部性能数据放进完整模型结构语境中，让性能工程师回答：哪个后端节点耗时、它对应模型架构的什么位置、代表步中有哪些原始事件。

页面是事实查看器，不是诊断引擎。P0/P1/P2、热点、等待态、优化建议和执行拓扑只有在后端 schema 明确提供时才展示。

## 2. 双事实层

| 输入 | 决定的事实 | 禁止越界 |
|---|---|---|
| 锁定的 ui-json 运行时源码 + config | 61 层主模型、MTP、Dense/MoE 范围、模块/算子/状态、tensor edge | 不把 compiler/profiler 脚手架误写成学习模块 |
| 官方源码 + config | 独立交叉校验模型配置与基础模块语义 | 不覆盖实际运行时源码中的已验证扩展 |
| `analysis_config` | 后端稳定 ID、语义路径、当前 trace 的观测实例、runtime | 不反推完整模型或 tensor edge |
| `perf_data` | 代表步节点指标和 operator ratio | 不向无数据 source descendants 传播 aggregate 指标 |
| `timeline` | 原始起止时间、device/stream/core、owner | 不强行映射 unmapped event |

浏览器不解析 Python。构建脚本生成 canonical architecture、backend overlay、显式 mapping 和 renderer-ready hybrid graph，页面只读取这些 JSON。

## 3. 架构图

主图使用锁定的实际运行时源码作为骨架：Token/Embedding → Dense Decoder 模板 → MoE Decoder 模板 → Final Norm → LM Head / MTP output path。Dense 重复 3 层，MoE 重复 58 层；Attention 展示 MLA、稀疏 Indexer、cache 和 output projection，MoE 展示 router、dispatch、shared/routed experts 和 combine。

MTP 是整网内的正式预测路径：源码包含 1 个学习到的 MTP Decoder layer（模型索引 61），MTP3 配置通过 `next_n: 3` 对它做三次运行时迭代，并共享主模型 embedding、RoPE 与 LM head。Runtime auxiliary 继续位于模型 shell 外。MTP preprocessing 的 weight AllGather 作为 runner trace detail 留在其源码父容器内。

视觉状态：

- mapped source：正常语义色，可选择，可联动 Inspector；
- mapped aggregate：只有容器激活，未映射子节点继续 dim；
- source-only：保留结构和 edge，低透明度，node body 不可选择；
- backend trace detail/runtime：正常着色、可交互，并以来源状态与源码事实区分。

折叠按钮是结构导航，与性能选择分离；source-only 容器仍能展开/折叠，但其 node body 不获得按钮语义或 Inspector 行为。

## 4. 工作台与联动

```text
┌─ IDE topbar ────────────────────────────────────────────────────┐
│ Rail │ Performance Nodes │ Full Architecture │ Inspector      │
│      │ 88 backend IDs    │ source + overlay  │ backend facts  │
├──────┴───────────────────┴────────────────────┴─────────────────┤
│ Visualization: Step / Streams  ⇄  Terminal                     │
└────────────────────────────────────────────────────────────────┘
```

| 操作 | 结果 |
|---|---|
| 点击 Explorer 节点 | 通过 mapping 展开 source ancestors，并聚焦 source/extension target |
| 点击可选择的架构节点 | 解析 backend ID，更新 Explorer 与 Inspector |
| 点击 source-only node body | 无选择行为 |
| 点击折叠控件 | 只改变结构可见性并保持视口锚点 |
| 点击有 owner 的泳道事件 | owner backend ID 通过同一 mapping 聚焦图节点 |
| Clear | 清除图、Inspector 和 Timeline 选择 |

Streams 直接使用 548 条原始事件绘制 40 条 device/stream/core lane。`direct` / `unmapped` 只表示 owner 是否可解析，不是性能诊断。Coverage 不在产品页面展示。

## 5. 验收

`npm run check` 校验源码 revision/hash、canonical node/edge provenance、88 个后端节点零丢失、MTP 的 1 层/3 次迭代语义、source-only 不可交互、折叠映射、布局几何以及所有本地运行时资源。

当前 `ui-json-main` 已提供 source revision。后端若继续补充 `config_hash`、标准 `module_path` 和精确 `code_ref`，可以进一步减少 runner/compiler detail 的映射歧义；这不会改变前端以源码架构为骨架的原则。

# openPangu-2.0-Flash Mock Profiling Overlay — 产品设计说明

> 独立入口：`../index.html`  
> 副本与模型迁移：2026-07-15

## 产品定位

用经过校验的模型架构图作为空间索引，把 profiling 诊断、证据、时间线和动作映射到同一个工作台。当前版本用于验证交互和信息架构，不用于评价 openPangu 的真实性能。

## 数据契约

| 数据层 | 状态 | 内容 |
|---|---|---|
| 架构 schema | 真实、source-checked | 46 个主 decoder 层、Dense/MoE 分段、Sparse MLA、DSA Indexer、experts、MTP、LM head、节点和边 |
| Profiling overlay | Mock | Step/Stream 时间、算子耗时、利用率、等待、通信、priority、诊断和调优动作 |
| 节点映射 | 架构真实、性能合成 | 15 个报告条目使用 schema/adapter 中的真实 node ID |

任何 mock 数值都必须保留 `synthetic` 标记，Evidence 首条必须包含 `MOCK PROFILE`。接入真实 trace 时只替换数据层，不改变节点 ID 或交互契约。

## 布局

页面完整复用 PTO `ide-frame`：

```text
┌─ IDE topbar ────────────────────────────────────────────────────┐
│ Rail │ Mapped Nodes │ openPangu Model Graph │ Inspector        │
├──────┴──────────────┴───────────────────────┴──────────────────┤
│ Visualization: Steps / Streams / Coverage  ⇄  Terminal         │
├────────────────────────────────────────────────────────────────┤
│ Status strip                                      Playback      │
└────────────────────────────────────────────────────────────────┘
```

- Explorer：按 All/P0/P1/P2 浏览 15 个 mock 映射。
- Model Graph：使用共享 `model-graphviz` renderer；选中节点、cluster 与父页 Inspector 双向联动。
- Inspector：明确分开诊断、证据、算子和动作，并持续展示 mock 提示。
- Timeline：Steps 展示 10 个合成 step；Streams 复用共享 `swimlane-task` 的紧凑 lane/task 尺寸；Coverage 说明哪些信息真实、部分合成或缺失。
- Terminal：显示 graph 状态、`synthetic` profile 标记、overlay、selection 和 timeline 状态。

## 交互

| 触发 | 结果 |
|---|---|
| 点击架构节点或 cluster | 选择对应 mock 报告并更新 Inspector |
| 点击 Explorer 映射 | 聚焦架构节点并更新 Inspector |
| 点击 Stream task | seek 到合成时间段、选择节点并聚焦架构图 |
| 播放 timeline | 播放头推进并同步节点上下文 |
| 切换 priority | 同步过滤 Explorer 和 graph annotation |
| 切换 Overlay | 仅关闭 graph annotation，其他数据视图保留 |

## 设计系统依赖

运行时使用 PTO 三层 tokens、shared CSS，以及 `ide-frame`、`workbench-shell`、`model-graphviz`、`floating-playback-control` 和 `swimlane-task`。本次迁移没有引入新的设计语言或私有泳道组件；页面专有 CSS 只负责布局和 profiling overlay 组合。

## 接入真实 profiling 的替换点

1. 将真实 trace 转成与 `mock-profiling-data.js` 导出对象同形的 JSON/JS 数据层。
2. 用真实事件生成 `STEP_TIMELINE`、`MODULE_TIMELINE` 和 `STREAM_SUMMARY`。
3. 将算子/模块事件对齐到 canonical node ID；没有可靠映射时标记 unresolved，不猜测。
4. 删除 `synthetic` 提示只能发生在全部展示值都有 trace provenance 后。

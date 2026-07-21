# DeepSeek V3.2 Profiling Report

这是一个独立静态工程：用 `ui-json-main` 新增并锁定版本的实际运行时模型源码生成完整 DeepSeek V3.2 架构，以官方源码做交叉校验，再把代表步性能数据作为局部覆盖层叠加到架构上。

页面严格区分两类事实：

- 锁定的运行时源码/config 决定 61 层主模型、MTP、Dense/MoE 分支、Module/Op/State/Parameter 和 tensor edge；
- 后端 JSON 决定稳定 `node_id`、性能指标、operator ratio、Timeline owner、当前观测实例和 runtime auxiliary。

源码有而后端无数据的节点仍显示，但会 dim 且不可选择；只有后端提供并完成显式分类的节点可与 Explorer、Inspector 和 Timeline 联动。

## 启动与校验

```bash
cd /Users/yin/pto/deepseek-v32-report-overlay
npm run build:data
npm run check
npm run serve
```

打开 `http://127.0.0.1:8792/`。页面通过 `fetch` 加载本地 JSON，不能用 `file://` 验证。

`npm run build:data` 会从锁定的源码快照和三份后端 JSON 重建全部 `outputs/`；`npm run check` 会确认生成物未过期并检查数据、映射、交互状态、布局几何和离线依赖。

## 目录

```text
deepseek-v32-report-overlay/
├── index.html                         # 报告工作台
├── app.js                             # 选择联动与泳道交互
├── report-data.js                     # 后端数据 → 报告 UI model
├── architecture-data.js               # hybrid graph → 可折叠 renderer graph
├── data/                              # ui-json-main 快照
├── sources/                           # 锁定的运行时源码与官方交叉校验源码/config
├── outputs/
│   ├── model-source-manifest.json     # repo、commit、hash、验证状态
│   ├── model_architecture.json        # canonical full-source architecture
│   ├── backend_trace_overlay.json     # 规范化 backend trace slice
│   ├── architecture_overlay_map.json  # 显式 source/backend 映射与冲突
│   └── model_architecture_graph.json  # renderer-ready hybrid graph
├── scripts/build-source-overlay.mjs   # 确定性产物生成器
├── scripts/verify.mjs                 # 回归校验
└── docs/SPEC-full-model-architecture-overlay.md
```

## 当前事实与边界

- canonical 架构有 160 个源码节点、140 条带 provenance 的源码 edge；主层数为 61，Dense 范围为 0–2，MoE 范围为 3–60。
- 后端仍是 88 个节点、548 条原始 Timeline event、40 条 device/stream/core 泳道；237 条 event 有直接 owner，311 条保持 unmapped。
- 88 个后端节点均有显式投影分类：源码映射、backend trace extension 或 runtime auxiliary；aggregate 指标不会复制到无数据后代。
- MTP 已由 `modeling_deepseek.py`、`model_infer.py` 和 MTP3 YAML 共同验证：模型只有 1 个学习到的 MTP Decoder layer（索引 61），运行时通过 `next_n: 3` 循环调用三次，并复用主模型 embedding、RoPE 和 LM head。
- MTP 位于完整 Transformer 内；只有不属于模型结构的四个 runtime auxiliary 节点位于模型 shell 外。
- 运行时源码锁定到 `ui-json-main` commit `f6262f5b95e32a2a66e38314b6c7b035d51ea49d`。MTP 每轮权重准备的 AllGather 保持为其 preprocessing 内的 trace detail，不伪装为学习层。
- 页面不生成 P0/P1/P2、热点等级、等待态、诊断或优化建议。
- Coverage 已删除；Streams 完全由后端原始事件起止时间和 lane 字段绘制。

完整来源与语义说明见 [source-provenance.md](./docs/source-provenance.md)，实现契约见 [SPEC](./docs/SPEC-full-model-architecture-overlay.md)。

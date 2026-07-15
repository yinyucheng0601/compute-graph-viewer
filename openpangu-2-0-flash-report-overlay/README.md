# openPangu-2.0-Flash Mock Profiling Overlay

这是 DeepSeek 报告叠加 demo 的独立副本，底图已替换为 PTO `model-graphviz` 中经过源代码/配置校验的 `openPangu-2.0-Flash` 架构。当前没有真实 profiling trace，因此性能数值、Step、Stream、算子耗时和诊断结论均为明确标记的合成演示数据；模型结构、节点 ID 和架构参数来自随工程打包的 canonical schema。

工程使用统一 PTO IDE frame，并复用 `model-graphviz`、`workbench-shell`、`floating-playback-control` 与 `swimlane-task` pattern。所有运行依赖都在本目录内，不依赖父目录、CDN 或 npm 包。

## 启动

```bash
cd /Users/yin/pto/openpangu-2-0-flash-report-overlay
npm run check
npm run serve
```

打开 `http://127.0.0.1:8794/`。不要直接使用 `file://`，因为报告层需要同源访问 iframe 中的 SVG。

## 数据边界

- 真实：模型名、46 个主 decoder 层、Dense 0–1 / MoE 2–45、256 experts、top-k=8、MTP=3、节点和边语义。
- Mock：耗时、占比、优先级、瓶颈、kernel 数、stream 分配、overlap 和调优动作。
- 每个 Inspector Evidence 的首条都带 `MOCK PROFILE` 提示，Coverage 也列出缺失的真实证据。

## 目录

```text
openpangu-2-0-flash-report-overlay/
├── index.html
├── app.css
├── mock-profiling-data.js
├── dependency-manifest.json
├── vendor/pto-design-system/
│   ├── tokens/
│   ├── css/style.css
│   └── patterns/
│       ├── model-graphviz/
│       │   └── assets/
│       │       ├── openpangu_2_0_flash_modelviz.html
│       │       └── openpangu_2_0_flash_model_architecture.json
│       ├── ide-frame/
│       ├── workbench-shell/
│       ├── floating-playback-control/
│       └── swimlane-task/
├── docs/
└── scripts/verify.mjs
```

完整依赖闭包见 [dependency-manifest.json](./dependency-manifest.json)，架构与 mock 数据的来源边界见 [docs/source-provenance.md](./docs/source-provenance.md)。

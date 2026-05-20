# PTO Compute Graph Viewer

Static GitHub Pages workspace for PTO compute-graph, memory, execution, and operator-development demos.

Main Pages entry:

https://yinyucheng0601.github.io/compute-graph-viewer/launch.html

## Current Rule

`main` is the public GitHub Pages branch. Treat it as the source of truth for anything that should be visible online.

- Public entry points live in `launch.html` or are listed in this README.
- Active modules stay at the repository root.
- Old prototypes, business notes, external dumps, and design drafts live under `archive/`.
- Public naming should use `A5` instead of raw `950B` / `Ascend 950` labels.

## Local Preview

```bash
cd <repo>
python3 -m http.server 8767
```

Then open:

```text
http://localhost:8767/launch.html
```

Some pages use `fetch()` or ES modules, so preview with a local static server instead of opening files directly.

## Launch Modules

The launcher is grouped by workflow:

| Group | Entry | Path |
|---|---|---|
| A5 hardware and migration | A5 hardware path workbench | `ascend-950-workbench-demo/index.html` |
| A5 hardware and migration | A3 / A5 difference reading | `ascend-950-workbench-demo/feature_taxonomy.html` |
| A5 hardware and migration | A5 data movement Flow Map | `ascend-hardware-map/ascend-hardware-map-v3.html` |
| A5 hardware and migration | A5 PMU diagnostic workbench | `pmu/06-a5-pmu-visualization-group2-loop.html` |
| Model graph and IR | Model/operator hierarchy | `model-architecture/index.html` |
| Model graph and IR | DeepSeek V3.2 report overlay | `graphviz/deepseek_v32_report_overlay_demo.html` |
| Model graph and IR | Pass IR graph | `pass-ir/index.html` |
| Model graph and IR | Graph execution overlay view | `indexer-exec/index.html` |
| Execution and performance | Memory Viewer | `mem_viewer/index.html`, `mem_viewer/index-v2.html` |
| Execution and performance | Swimlane execution view | `swimlane/index.html` |
| Execution and performance | Swimlane performance tool | `pypto-swimlane-perf-tool/index.html` |
| Operator development | Operator IDE Assistant | `op-ide-assistant/index.html`, `op-ide-assistant-v2/index.html` |

## Other Published Pages

These are still public Pages, but are not part of the main launcher flow.

| Page | Path |
|---|---|
| Hardware-Native Systems whitepaper | `hw-native-sys/index.html` |
| HNSW whitepaper | `HNSW/HNSW-whitepaper.html` |
| H-Anchor / PycPlacer whitepaper | `PycPlacer/pycplacer-whitepaper.html` |
| AI chip netlist whitepaper | `netlist/ai-chip-netlist-whitepaper-report.html` |
| Netlist visual report | `netlist/netlist-visual-report.html` |
| PTO / PyPTO toolchain whitepaper | `pypto-toolchain-whitepaper/index.html` |
| VLSI placement whitepaper | `vlsi-placement-whitepaper/index.html` |
| Source Flow utility | `source-flow/index.html` |

## Active Root Structure

```text
launch.html
design-system-preview.html
assets/
css/
data/
tokens/
patterns/
design-system-share/
ascend-950-workbench-demo/
ascend-hardware-map/
graphviz/
indexer-exec/
mem_viewer/
model-architecture/
op-ide-assistant/
op-ide-assistant-v2/
pass-ir/
pmu/
pypto-swimlane-perf-tool/
source-flow/
swimlane/
```

## Archive Structure

`archive/` keeps material that should not clutter the Pages root but may still be useful.

| Folder | Contents |
|---|---|
| `archive/business-notes/` | PRDs, research notes, product notes |
| `archive/design-files/` | `.pen` files, font/design artifacts |
| `archive/external/` | copied external source trees such as DevUI |
| `archive/internal/` | local agent notes and scratch files |
| `archive/legacy-docs/` | docs for retired prototypes |
| `archive/legacy-pages/` | old demos and pages not linked from `launch.html` |
| `archive/presentations/` | generated slide decks and slide sources |
| `archive/reference-dumps/` | large source/reference dumps used to derive current diagrams |

## Maintenance Workflow

For ordinary changes:

```bash
git checkout main
git pull origin main
# edit files
python3 -m http.server 8767
git status
git add <changed files>
git commit -m "Describe the change"
git push origin main
```

Before pushing, check:

- `launch.html` links still resolve locally.
- No absolute local file links are introduced.
- No `.DS_Store`, `__pycache__`, zip exports, or local share folders are added.
- New public pages are either linked from `launch.html` or listed in this README.

## Backup

Before large cleanup work, keep a local snapshot outside the repository. Do not commit local backup folders to `main`.

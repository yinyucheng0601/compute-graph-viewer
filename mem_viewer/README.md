# Compute Graph Memory Viewer — Ascend 910B

Interactive step-by-step visualization of tensor memory movement across the Ascend 910B memory hierarchy (DDR → L1 → L0A/L0B → L0C/UB).

## Quick Start

Requires a local HTTP server (ES modules and SVG fetch won't work over `file://`):

```bash
# Python (built-in)
cd /path/to/pto
python3 -m http.server 8080
# open http://localhost:8080/mem_viewer/

# or Node
npx serve .
```

## Project Structure

```
mem_viewer/
├── index.html            HTML shell
├── styles/
│   └── main.css          All styles (layout, arch diagram, SVG overrides)
├── data/
│   ├── ops.js            OP_DATA — 166 ops with inputs/outputs (ES module)
│   └── graph.svg         Compute graph (sprotty SVG, ~950 KB)
└── js/
    ├── constants.js      Tier constants, color maps, getTensorTier()
    ├── schedule.js       Kahn topo-sort → SCHEDULE, tensor liveness
    ├── memory-panel.js   Right-panel tier chip rendering
    ├── svg-viewer.js     SVG load/fetch, pan/zoom, applyStepToSVG()
    └── playback.js       Entry point — goToStep, play/pause, keyboard
```

## Module Dependency Graph

```
playback.js  ←  constants.js  ←  ops.js
             ←  schedule.js   ←  constants.js
             ←  memory-panel.js ← schedule.js
             ←  svg-viewer.js ←  constants.js, schedule.js
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `→` / `l` | Next step |
| `←` / `h` | Previous step |
| `Space` | Play / Pause |
| `f` | Fit graph |
| `Home` | First step |
| `End` | Last step |

## Adding a New Graph

1. Export your compute graph as an SVG from your tool (sprotty-compatible node IDs expected: `sprotty_operation-magic-{id}-0`, `sprotty_tensor-{id}-0`)
2. Replace `data/graph.svg`
3. Replace `OP_DATA` in `data/ops.js` with your op list (`{m, n, i, o}`)
4. Update the header badge in `index.html` if needed

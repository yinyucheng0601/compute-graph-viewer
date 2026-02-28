# Compute Graph Viewer

A browser-based visualizer for Ascend NPU computation graphs.

**[→ Open Web App](https://yinyucheng0601.github.io/compute-graph-viewer/)**

## Features

- Visualize DAG graphs with four node types: **Incast**, **Op**, **Tensor**, **Outcast**
- Sugiyama-style layered layout with crossing minimization
- Zoom / pan / fit view + minimap
- Click any node to inspect its properties in the detail panel
- Drag & drop a `.json` file, or open via file picker
- Remembers the last opened file (localStorage)

## Usage

Open the web app and load a computation graph JSON file exported from Ascend IR.

## Local Development

No build step required — open `index.html` directly in a browser, or serve with any static file server:

```bash
npx serve .
```

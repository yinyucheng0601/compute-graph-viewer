# DeepSeek Source Graph Viewer

Interactive DAG viewer for the DeepSeek model's annotated source graph — showing ops, tensors, boundary nodes, and group hierarchies.

## Run

Serve the repository root so the viewer can fetch `data/source-graph.json`:

```bash
cd /Users/yin/pto
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/graph-prototype-lab/
```

## Features

- Auto-loads `data/source-graph.json` on startup
- `TB` / `LR` layout direction switching
- Tensor mode toggle (Auto / Nodes / Edge Data)
- Fit view (`Fit` button or `F` key)
- Node / edge inspector panel with source code references
- Group expand / collapse
- Preview mode (`?preview=1`) hides UI chrome

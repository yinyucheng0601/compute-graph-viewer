# Graph Prototype Lab

Independent prototype for exploring:

- automatic DAG layout via `elkjs`
- compound groups deeper than 4 levels
- free `TB` / `LR` direction switching
- TensorBoard-like tensor presentation in vertical layouts

## Run

Serve the repository root so the prototype can fetch shared sample data:

```bash
cd /Users/yin/pto
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/test/
```

## Samples

- `MVP Layer 3 · Deep Groups`: synthetic deep hierarchy extracted from `mvp/data.js`
- `MVP Layer 0 · Deep Groups`: dense-layer variant
- `Ascend Pass Graph`: real compiler pass JSON
- `Source Graph`: `data/source-graph.json`

## Current scope

- neutral grayscale rendering only
- no build tool, no framework
- no minimap / diff / controlflow integration yet
- TensorBoard-style tensor handling is approximated as:
  - internal tensors -> edge payload
  - input/output tensors -> side annotations

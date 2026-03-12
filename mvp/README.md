# DeepSeek Operator Explorer

**An interactive visualization of DeepSeek V3 / V3.2 decoder layer internals — for model developers who want to see operator structure, not token prediction.**

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://yinyucheng0601.github.io/dpsk/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> 中文简介：按层查看 DeepSeek V3 / V3.2 decoder block 内部算子结构的可交互可视化工具，支持三层展开（L2 → L3 → L4 原语），可在浏览器中直接运行。

---

## Live Demo
<img width="1382" height="1031" alt="截屏2026-03-11 11 34 44" src="https://github.com/user-attachments/assets/f33ae2c3-7a1e-41f5-b908-bae7db96bac5" />

**[yinyucheng0601.github.io/dpsk](https://yinyucheng0601.github.io/dpsk/)**
---

## What It Shows

Most LLM visualizations explain *token generation*. This one explains *operator structure* — what computations actually happen inside a single decoder block, layer by layer.

Switch between **V3** and **V3.2** to see architectural differences:

| | DeepSeek V3 | DeepSeek V3.2 |
|---|---|---|
| Layers | 61 (3 dense + 58 MoE) | 61 (3 dense + 58 MoE) |
| Attention | MLA (Multi-head Latent Attention) | MLA + Sparse Lightning Indexer |
| KV cache | FP8 quantized | FP8 quantized + INT8 Indexer K Cache |
| FFN (MoE layers) | 256 routed experts + 1 shared, Top-2 | 256 routed experts + 1 shared, Top-2 |

---

## Extend to Any Model

A **Claude Code skill** is included to generate this same visualization for any HuggingFace model automatically.

### Setup

Copy `model-viz/SKILL.md` into your Claude Code skills directory:

```bash
mkdir -p ~/.claude/skills/model-viz
cp model-viz/SKILL.md ~/.claude/skills/model-viz/SKILL.md
```

### Usage

In Claude Code, run:

```
/model-viz
```

Then provide a HuggingFace model ID (e.g. `meta-llama/Llama-3.1-8B`, `Qwen/Qwen2.5-7B`, `mistralai/Mixtral-8x7B-v0.1`).

The skill will:
1. Fetch `modeling_*.py` + `config.json` from HuggingFace (or the `transformers` library source)
2. Extract the layer hierarchy: num_layers, dense/MoE split, attention type (MHA/GQA/MLA), FFN type
3. Generate `data.js` with operator trees for all layers
4. Generate a working `app.js` using AntV X6 with the same expandable group pattern
5. Copy `x6.min.js` from this repo and start a local static server

**Supported architectures:** standard MHA · GQA (LLaMA, Qwen, Mistral) · MoE (Mixtral, DeepSeek) · MLA (DeepSeek V3-

#!/usr/bin/env python3
"""Generate a TorchVista-style model architecture graph for DeepSeek V3.2."""

from __future__ import annotations

import ast
import hashlib
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path("/Users/yin/gitcode/deepseekv3.2源码")
TEMPLATE = Path("/Users/yin/pto/graphviz/torchvista_graphviz_deepseek_v4.html")
OUTPUT = Path("/Users/yin/pto/graphviz/deepseek_v32_source_graph.html")


def stable_id(prefix: str, raw: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_]+", "_", raw).strip("_")
    safe = re.sub(r"_+", "_", safe)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:8]
    return f"{prefix}_{safe}_{digest}" if safe else f"{prefix}_{digest}"


def module_name(rel: Path) -> str:
    parts = list(rel.with_suffix("").parts)
    if parts[0] == "encoding_副本":
        parts[0] = "encoding"
    elif parts[0] == "inference_副本":
        parts[0] = "inference"
    return ".".join(parts)


def signature_for(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    try:
        args = ast.unparse(node.args)
    except Exception:
        args = "..."
    prefix = "async " if isinstance(node, ast.AsyncFunctionDef) else ""
    return f"{prefix}{node.name}({args})"


def brief_doc(node: ast.AST) -> str:
    doc = ast.get_docstring(node) or ""
    doc = " ".join(doc.strip().split())
    return doc[:420] + ("..." if len(doc) > 420 else "")


def literal_default(node: ast.AST) -> Any:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult)):
        left = literal_default(node.left)
        right = literal_default(node.right)
        if isinstance(left, (int, float)) and isinstance(right, (int, float)):
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            return left * right
    try:
        return ast.literal_eval(node)
    except Exception:
        return ast.unparse(node)


def js_value(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


COLORMAP_PATCH = """function ptoNormalizeColormapColor(hex) {
  const hsl = ptoHexToHsl(hex);
  return ptoHslToHex({
    h: ptoSnapToValidHue(hsl.h),
    s: PTO_COLORMAP_SATURATION,
    l: PTO_COLORMAP_LIGHTNESS,
  });
}

const PTO_COLORMAP_SATURATION = 0.82;
const PTO_COLORMAP_LIGHTNESS = 0.40;

function ptoExpandPalette(baseHexes, targetCount) {
  const hues = baseHexes.map(c => ptoSnapToValidHue(ptoHexToHsl(c).h));
  const coreHueSet = new Set(hues.map(h => Math.round(h * 1e6)));
  const maxHuePositions = 100;
  const minGap = 1 / 360 * 2.5;

  while (hues.length < maxHuePositions) {
    let maxGap = -1;
    let insertIdx = 0;
    for (let i = 0; i < hues.length; i++) {
      const a = hues[i];
      const b = hues[(i + 1) % hues.length];
      let gap = b - a;
      if (gap < 0) gap += 1;
      if (gap > maxGap) {
        maxGap = gap;
        insertIdx = i;
      }
    }
    const a = hues[insertIdx];
    const b = hues[(insertIdx + 1) % hues.length];
    let mid = b < a ? ((a + b + 1) / 2) % 1 : (a + b) / 2;
    mid = ptoSnapToValidHue(mid);
    const tooClose = hues.some(h => {
      let d = Math.abs(h - mid);
      if (d > 0.5) d = 1 - d;
      return d < minGap;
    });
    if (tooClose) break;
    hues.splice(insertIdx + 1, 0, mid);
  }

  const result = baseHexes.map(ptoNormalizeColormapColor);
  const extraHues = hues.filter(h => !coreHueSet.has(Math.round(h * 1e6)));
  for (const h of extraHues) {
    if (result.length >= targetCount) break;
    result.push(ptoHslToHex({ h, s: PTO_COLORMAP_SATURATION, l: PTO_COLORMAP_LIGHTNESS }));
  }
  while (result.length < targetCount) {
    for (const h of hues) {
      if (result.length >= targetCount) break;
      result.push(ptoHslToHex({ h, s: PTO_COLORMAP_SATURATION, l: PTO_COLORMAP_LIGHTNESS }));
    }
  }
  return result.slice(0, targetCount);
}

function ptoBuildColorMap(keys) {
  const unique = [...new Set(keys)];
  const colors = ptoExpandPalette(PTO_CORE_COLORS, Math.max(unique.length, PTO_CORE_COLORS.length));
  const map = new Map();
  unique.forEach((key, index) => map.set(key, colors[index]));
  return map;
}"""


def add_edge(
    adj: dict[str, dict[str, Any]],
    source: str,
    target: str,
    label: str,
    edge_id: str,
    implied: bool = False,
) -> None:
    if source == target or source not in adj or target not in adj:
        return
    edge = {"target": target, "dims": label, "edge_data_id": edge_id}
    if implied:
        edge["is_implied_edge"] = True
    key = (target, label)
    existing = {(item["target"], item.get("dims", "")) for item in adj[source]["edges"]}
    if key not in existing:
        adj[source]["edges"].append(edge)


def extract_source_facts() -> tuple[dict[str, Any], dict[str, Any]]:
    index: dict[str, Any] = {}
    defaults: dict[str, Any] = {}

    for path in sorted(ROOT.rglob("*.py")):
        rel = path.relative_to(ROOT)
        rel_s = rel.as_posix()
        mod = module_name(rel)
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=rel_s)

        for item in tree.body:
            if isinstance(item, ast.ClassDef):
                index[f"{mod}.{item.name}"] = {
                    "file": rel_s,
                    "line": item.lineno,
                    "end_line": getattr(item, "end_lineno", item.lineno),
                    "kind": "class",
                    "doc": brief_doc(item),
                }
                if mod == "inference.model" and item.name == "ModelArgs":
                    for child in item.body:
                        if (
                            isinstance(child, ast.AnnAssign)
                            and isinstance(child.target, ast.Name)
                            and child.value is not None
                        ):
                            defaults[child.target.id] = literal_default(child.value)
                for child in item.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        index[f"{mod}.{item.name}.{child.name}"] = {
                            "file": rel_s,
                            "line": child.lineno,
                            "end_line": getattr(child, "end_lineno", child.lineno),
                            "kind": "method",
                            "signature": signature_for(child),
                            "doc": brief_doc(child),
                        }
            elif isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                index[f"{mod}.{item.name}"] = {
                    "file": rel_s,
                    "line": item.lineno,
                    "end_line": getattr(item, "end_lineno", item.lineno),
                    "kind": "function",
                    "signature": signature_for(item),
                    "doc": brief_doc(item),
                }

    required = [
        "dim",
        "vocab_size",
        "n_layers",
        "n_dense_layers",
        "n_heads",
        "q_lora_rank",
        "kv_lora_rank",
        "qk_nope_head_dim",
        "qk_rope_head_dim",
        "v_head_dim",
        "inter_dim",
        "moe_inter_dim",
        "n_routed_experts",
        "n_shared_experts",
        "n_activated_experts",
        "index_n_heads",
        "index_head_dim",
        "index_topk",
        "score_func",
        "route_scale",
    ]
    missing = [key for key in required if key not in defaults]
    if missing:
        raise RuntimeError(f"missing ModelArgs defaults: {', '.join(missing)}")

    return index, defaults


def build_graph() -> dict[str, Any]:
    """Build a Graphviz-native top-down model architecture DAG.

    The generated graph intentionally excludes encoding, checkpoint conversion,
    generation CLI, PTO operators, and standalone kernels. Those are source
    workflows around the model, not the model architecture itself.
    """

    defs, defaults = extract_source_facts()
    dim = int(defaults["dim"])
    vocab_size = int(defaults["vocab_size"])
    n_layers = int(defaults["n_layers"])
    n_dense_layers = int(defaults["n_dense_layers"])
    n_moe_layers = n_layers - n_dense_layers
    n_heads = int(defaults["n_heads"])
    q_lora_rank = int(defaults["q_lora_rank"])
    qk_nope = int(defaults["qk_nope_head_dim"])
    qk_rope = int(defaults["qk_rope_head_dim"])
    qk_head = qk_nope + qk_rope
    v_head = int(defaults["v_head_dim"])
    kv_rank = int(defaults["kv_lora_rank"])
    inter_dim = int(defaults["inter_dim"])
    moe_inter_dim = int(defaults["moe_inter_dim"])
    routed_experts = int(defaults["n_routed_experts"])
    shared_experts = int(defaults["n_shared_experts"])
    active_experts = int(defaults["n_activated_experts"])
    index_n_heads = int(defaults["index_n_heads"])
    index_head_dim = int(defaults["index_head_dim"])
    index_topk = int(defaults["index_topk"])

    dense_label = "layer 0" if n_dense_layers == 1 else f"layers 0-{n_dense_layers - 1}"
    moe_label = f"layers {n_dense_layers}-{n_layers - 1}"
    derived = {
        "q_head_dim": qk_head,
        "q_projection_out": n_heads * qk_head,
        "kv_a_projection_out": kv_rank + qk_rope,
        "kv_b_projection_out": n_heads * (qk_nope + v_head),
        "o_projection_in": n_heads * v_head,
        "index_q_projection_out": index_n_heads * index_head_dim,
    }

    def node_id(raw: str) -> str:
        return stable_id("dsv32arch", raw)

    adj: dict[str, dict[str, Any]] = {}
    module_info: dict[str, Any] = {}
    func_info: dict[str, Any] = {}
    display: dict[str, str] = {}
    ancestor: dict[str, str] = {}
    attr_name: dict[str, str] = {}
    node_module_path: dict[str, str] = {}
    edge_no = 0

    def new_edge_id() -> str:
        nonlocal edge_no
        edge_no += 1
        return f"dsv32_model_e{edge_no}"

    def add_node(
        raw_id: str,
        label: str,
        kind: str,
        parent: str | None = None,
        qualname: str | None = None,
        summary: str = "",
        node_type: str = "Operation",
        extra: dict[str, Any] | None = None,
    ) -> str:
        nid = node_id(raw_id)
        adj[nid] = {"edges": [], "failed": False, "node_type": node_type}
        display[nid] = label
        if parent:
            ancestor[nid] = node_id(parent)

        info: dict[str, Any] = {"kind": kind, "role": summary}
        if qualname and qualname in defs:
            ref = defs[qualname]
            attr_name[nid] = f"{ref['file']}:{ref['line']}"
            node_module_path[nid] = qualname.rsplit(".", 1)[0]
            info.update(
                {
                    "kind": ref.get("kind", kind),
                    "qualname": qualname,
                    "file": ref["file"],
                    "line": ref["line"],
                    "end_line": ref["end_line"],
                    "signature": ref.get("signature", ""),
                    "doc": ref.get("doc", ""),
                }
            )
        if extra:
            info.update(extra)
        func_info[nid] = info
        return nid

    def add_container(
        raw_id: str,
        label: str,
        summary: str,
        parent: str | None = None,
        stage: str = "model",
    ) -> str:
        nid = add_node(raw_id, label, "architecture_group", parent=parent, summary=summary, node_type="Module")
        module_info[nid] = {
            "extra_repr": summary,
            "attributes": {
                "kind": "model_architecture_group",
                "stage": stage,
                "source_root": str(ROOT),
                "source_of_truth": str(ROOT / "inference_副本/model.py"),
                "summary": summary,
            },
        }
        func_info[nid].update({"module": label})
        return nid

    def connect(source: str, target: str, label: str = "", implied: bool = False) -> None:
        add_edge(adj, node_id(source), node_id(target), label, new_edge_id(), implied=implied)

    add_container(
        "transformer",
        f"Transformer Core ({n_layers} layers)",
        f"Source ModelArgs: dim={dim}, vocab={vocab_size}, layers={n_layers}, dense={n_dense_layers}, MoE={n_moe_layers}.",
    )
    add_container(
        "block",
        f"Decoder Block (repeated {n_layers}x)",
        "Block.forward: fused residual RMSNorm -> MLA -> fused residual RMSNorm -> dense/MoE FFN.",
        parent="transformer",
    )
    add_container(
        "attention",
        "MLA + Sparse Indexer",
        "MLA.forward builds Q/KV latent paths, writes KV/PE cache, asks Indexer for top-k positions, then runs prefill or decode attention.",
        parent="block",
        stage="attention",
    )
    add_container(
        "ffn",
        "Feed Forward Choice",
        "Block.__init__ uses dense MLP when layer_id < n_dense_layers; remaining layers use routed+shared MoE.",
        parent="block",
        stage="ffn",
    )
    add_container(
        "dense",
        f"Dense FFN ({dense_label})",
        f"{dense_label} uses dense SwiGLU with inter_dim={inter_dim}.",
        parent="ffn",
        stage="ffn",
    )
    add_container(
        "moe",
        f"MoE FFN ({moe_label})",
        f"{moe_label} use {routed_experts} routed experts, top-{active_experts}, and {shared_experts} shared experts.",
        parent="ffn",
        stage="moe",
    )

    add_node("token_ids", "token ids [B,T]", "input", node_type="Input", summary="Input tokens consumed by Transformer.forward.")
    add_node("logits", f"logits [B,{vocab_size}]", "output", node_type="Output", summary="Last-token logits after vocab-parallel head and optional all_gather.")
    add_node(
        "embedding",
        f"ParallelEmbedding [{vocab_size},{dim}]",
        "class",
        "transformer",
        "inference.model.ParallelEmbedding",
        "Vocabulary-parallel embedding; all_reduce restores hidden state when world_size > 1.",
        node_type="Module",
    )
    add_node(
        "block_entry",
        f"hidden [B,T,{dim}]",
        "tensor",
        "block",
        summary="Hidden state entering each decoder block.",
        node_type="Tensor",
    )
    add_node("attn_norm", "attn_norm fused residual", "class", "block", "inference.model.RMSNorm")
    add_node("attention_call", "MLA attention", "class", "block", "inference.model.MLA", node_type="Module")
    add_node("ffn_norm", "ffn_norm fused residual", "class", "block", "inference.model.RMSNorm")
    add_node("ffn_choice", "if dense range: MLP else MoE", "source_fact", "ffn", "inference.model.Block.__init__")
    add_node(
        "block_out",
        f"block output [B,T,{dim}]",
        "tensor",
        "block",
        "inference.model.Block.forward",
        node_type="Tensor",
    )
    add_node("final_norm", "final RMSNorm", "class", "transformer", "inference.model.RMSNorm")
    add_node("lm_head", f"LM head -> vocab {vocab_size}", "class", "transformer", "inference.model.ColumnParallelLinear", node_type="Module")

    add_node(
        "q_path",
        f"Q path -> {derived['q_projection_out']}",
        "method",
        "attention",
        "inference.model.MLA.forward",
        f"wq_a -> q_norm -> wq_b, q_lora_rank={q_lora_rank}; split q_nope={qk_nope}, q_pe={qk_rope}.",
    )
    add_node(
        "kv_path",
        f"KV path -> {derived['kv_a_projection_out']}",
        "method",
        "attention",
        "inference.model.MLA.forward",
        f"wkv_a split: latent KV={kv_rank}, RoPE={qk_rope}; kv_norm and FP8 cache simulation.",
    )
    add_node("cache", f"kv_cache[{kv_rank}] + pe_cache[{qk_rope}]", "buffer", "attention", "inference.model.MLA.__init__")
    add_node("indexer", f"Indexer Q/K {index_n_heads}x{index_head_dim}", "class", "attention", "inference.model.Indexer", node_type="Module")
    add_node("topk", f"top-k index <= {index_topk}", "method", "attention", "inference.model.Indexer.forward")
    add_node("sparse_attn", "sparse prefill/decode attention", "method", "attention", "inference.model.MLA.forward")
    add_node("o_proj", f"O projection {derived['o_projection_in']} -> {dim}", "class", "attention", "inference.model.RowParallelLinear", node_type="Module")

    add_node("dense_w1w3", f"W1/W3 {dim}->{inter_dim}", "class", "dense", "inference.model.MLP", node_type="Module")
    add_node("dense_act", "SiLU(W1) * W3", "method", "dense", "inference.model.MLP.forward")
    add_node("dense_w2", f"W2 {inter_dim}->{dim}", "class", "dense", "inference.model.RowParallelLinear", node_type="Module")

    add_node(
        "router",
        f"Gate logits -> {routed_experts}",
        "class",
        "moe",
        "inference.model.Gate",
        f"score_func={defaults['score_func']}, route_scale={defaults['route_scale']}.",
        node_type="Module",
    )
    add_node("top_experts", f"top-{active_experts} experts", "method", "moe", "inference.model.Gate.forward")
    add_node("experts", f"{routed_experts} routed experts", "class", "moe", "inference.model.Expert", f"Each expert inter_dim={moe_inter_dim}.", node_type="Module")
    add_node("shared", f"{shared_experts} shared experts", "class", "moe", "inference.model.MLP", f"Shared width={shared_experts * moe_inter_dim}.", node_type="Module")
    add_node("moe_sum", "weighted routed + shared", "method", "moe", "inference.model.MoE.forward")

    connect("token_ids", "embedding")
    connect("embedding", "block_entry")
    connect("block_entry", "attn_norm")
    connect("attn_norm", "attention_call")
    connect("attention_call", "q_path")
    connect("attention_call", "kv_path")
    connect("q_path", "indexer", "qr")
    connect("kv_path", "cache")
    connect("indexer", "topk")
    connect("q_path", "sparse_attn")
    connect("cache", "sparse_attn")
    connect("topk", "sparse_attn")
    connect("sparse_attn", "o_proj")
    connect("o_proj", "ffn_norm")
    connect("block_entry", "ffn_norm", "residual", implied=True)
    connect("ffn_norm", "ffn_choice")
    connect("ffn_choice", "dense_w1w3", dense_label)
    connect("dense_w1w3", "dense_act")
    connect("dense_act", "dense_w2")
    connect("dense_w2", "block_out")
    connect("ffn_choice", "router", moe_label)
    connect("router", "top_experts")
    connect("top_experts", "experts")
    connect("top_experts", "shared")
    connect("experts", "moe_sum")
    connect("shared", "moe_sum")
    connect("moe_sum", "block_out")
    connect("block_out", "final_norm")
    connect("final_norm", "lm_head")
    connect("lm_head", "logits")

    return {
        "adj_list": adj,
        "module_info": module_info,
        "func_info": func_info,
        "graph_node_name_to_without_suffix": display,
        "graph_node_display_names": display,
        "node_to_attr_name": attr_name,
        "ancestor_map": ancestor,
        "node_to_module_path": node_module_path,
    }


def inject_data(html: str, data: dict[str, Any]) -> str:
    colormap_start = html.find("function ptoNormalizeColormapColor(hex) {")
    if colormap_start == -1:
        colormap_start = html.index("function ptoExpandPalette(baseHexes, targetCount) {")
    colormap_end = html.index("\n\n    </script>", colormap_start)
    html = html[:colormap_start] + COLORMAP_PATCH + html[colormap_end:]

    start = html.index("    const adj_list = ")
    end = html.index("    const generateImage = ", start)
    replacement = "\n".join(
        [
            f"    const adj_list = {js_value(data['adj_list'])};",
            "    const parent_module_to_nodes = {};",
            f"    const module_info = {js_value(data['module_info'])};",
            f"    const func_info = {js_value(data['func_info'])};",
            f"    const graph_node_name_to_without_suffix = {js_value(data['graph_node_name_to_without_suffix'])};",
            f"    const graph_node_display_names = {js_value(data['graph_node_display_names'])};",
            f"    const node_to_attr_name = {js_value(data['node_to_attr_name'])};",
            f"    const ancestor_map = {js_value(data['ancestor_map'])};",
            "    const repeat_containers = new Set([]);",
            '    const REPEAT_CONTAINER_COLOR = "#FA8334";',
            "    const url_params = new URLSearchParams(window.location.search);",
            '    const requested_collapse_depth = url_params.has("collapseDepth") ? Number(url_params.get("collapseDepth")) : NaN;',
            "    const collapse_modules_after_depth = Number.isFinite(requested_collapse_depth) ? requested_collapse_depth : 2;",
            "    const show_module_attr_names = true;",
            f"    const node_to_module_path = {js_value(data['node_to_module_path'])};",
            "",
        ]
    )
    html = html[:start] + replacement + html[end:]
    html = re.sub(r">\s*torchvista\s*</a>", ">DeepSeek V3.2 Source Graph</a>", html, count=1)
    html = html.replace(
        'href="https://github.com/sachinhosmani/torchvista"',
        'href="file:///Users/yin/gitcode/deepseekv3.2源码"',
    )
    html = html.replace(
        "torchvista_graph_8738e552-e764-4a57-839a-6321bc3ae7d3",
        "deepseek_v32_source_graph",
    )
    html = html.replace(
        '            return "Tensor Op";',
        '            const kind = func_info[nodeName] && func_info[nodeName].kind;\n'
        '            if (kind === "method") return "Method";\n'
        '            if (kind === "function") return "Function";\n'
        '            if (kind === "file_entry") return "Python File";\n'
        '            return "Operation";',
    )
    html = html.replace(
        "const scale = Math.max(0.8, Math.min(1.7, fitScale));",
        "const scale = Math.max(0.22, Math.min(1.35, fitScale));",
    )
    html = html.replace(
        "        dotSource += '  compound=true;\\n';\n"
        "        dotSource += `  bgcolor=\"${GRAPHVIZ_DARK_BG}\";\\n`;",
        "        dotSource += '  compound=true;\\n';\n"
        "        dotSource += '  graph [margin=\"0.22\", pad=\"0.38\"];\\n';\n"
        "        dotSource += `  bgcolor=\"${GRAPHVIZ_DARK_BG}\";\\n`;",
    )
    html = html.replace(
        "            dotSource += `${indent}  labelloc=t;\\n`;\n"
        "            dotSource += `${indent}  labeljust=l;\\n`;",
        "            dotSource += `${indent}  labelloc=t;\\n`;\n"
        "            dotSource += `${indent}  labeljust=l;\\n`;\n"
        "            dotSource += `${indent}  margin=36;\\n`;",
    )
    html = html.replace(
        "--graphviz-node-shadow: drop-shadow(0 var(--space-2) var(--space-5) color-mix(in srgb, var(--background) 72%, transparent));",
        "--graphviz-node-shadow: none;",
    )
    html = html.replace(
        "--graphviz-parent-shadow: drop-shadow(0 var(--space-4) 42px color-mix(in srgb, var(--background) 66%, transparent));",
        "--graphviz-parent-shadow: none;",
    )
    html = html.replace("--graphviz-panel-shadow: var(--panel-shell-shadow);", "--graphviz-panel-shadow: none;")
    html = html.replace("box-shadow: var(--shadow-md);", "box-shadow: none;")
    html = re.sub(r"filter:\s*drop-shadow\([^;]+\);", "filter: none;", html)
    html = html.replace(
        'const GRAPHVIZ_TENSOR_NODE_TYPES = new Set(["Input", "Output", "Constant", "Parameter"]);',
        'const GRAPHVIZ_TENSOR_NODE_TYPES = new Set(["Input", "Output", "Constant", "Parameter", "Tensor"]);',
    )
    html = html.replace(
        '            .attr("fill-opacity", isRepeat ? 0.12 : 0.16)\n'
        '            .attr("fill", clusterColor)',
        '            .attr("fill-opacity", isRepeat ? 0.12 : 0.10)\n'
        '            .attr("fill", isRepeat ? clusterColor : "#FFFFFF")',
    )
    html = html.replace(
        '        const parent = getTopColorParent(nodeName);\n'
        '        if (parent) return "parent:" + parent;\n\n'
        '        if (nodeData.node_type === "Operation") return inferTorchVistaSemantic(nodeName);\n'
        '        if (nodeData.node_type === "Module") return "module:" + (graph_node_name_to_without_suffix[nodeName] || nodeName);\n'
        '        return "type:" + nodeData.node_type;',
        '        if (nodeData.node_type === "Operation") return inferTorchVistaSemantic(nodeName);\n'
        '        if (nodeData.node_type === "Module") return "module:" + (graph_node_name_to_without_suffix[nodeName] || nodeName);\n'
        '        const parent = ancestor_map[nodeName];\n'
        '        if (parent) return "parent:" + (graph_node_name_to_without_suffix[parent] || parent);\n'
        '        return "type:" + nodeData.node_type;',
    )
    html = html.replace('map.set("io:input", "#A855F7");', 'map.set("io:input", ptoNormalizeColormapColor("#A855F7"));')
    html = html.replace('map.set("io:output", "#34D399");', 'map.set("io:output", ptoNormalizeColormapColor("#34D399"));')
    html = html.replace('map.set("io:constant", "#64748B");', 'map.set("io:constant", ptoNormalizeColormapColor("#64748B"));')
    html = html.replace('map.set("io:parameter", "#3B82F6");', 'map.set("io:parameter", ptoNormalizeColormapColor("#3B82F6"));')
    html = html.replace(
        "const dotSource = generateDotFromProcessedData(generateImage);",
        "const dotSource = generateDotFromProcessedData(false);",
    )
    html = html.replace(
        'rect.style("filter", `drop-shadow(0 0 2px ${REPEAT_CONTAINER_COLOR})`);',
        'rect.style("filter", "none");',
    )
    return "<!-- Generated from /Users/yin/gitcode/deepseekv3.2源码 by generate_deepseek_v32_source_graph.py -->\n" + html


def main() -> None:
    data = build_graph()
    html = TEMPLATE.read_text(encoding="utf-8")
    OUTPUT.write_text(inject_data(html, data), encoding="utf-8")
    print(f"wrote {OUTPUT}")
    print(
        f"nodes={len(data['adj_list'])} "
        f"containers={len(data['module_info'])} "
        f"edges={sum(len(v['edges']) for v in data['adj_list'].values())}"
    )


if __name__ == "__main__":
    main()

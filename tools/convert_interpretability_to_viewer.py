#!/usr/bin/env python3
"""Convert DeepSeek interpretability JSON into viewer sample-graph JSON."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


ROOT = Path(__file__).resolve().parents[1]
SOURCE_JSON = ROOT / "deepseek-v3" / "deepseek_v3_interpretability.json"
OUTPUT_JSON = ROOT / "deepseek-v3" / "deepseek_v3_source_graph.json"


LEGEND_ITEMS = [
    {"label": "Embedding", "color": "#13807b"},
    {"label": "Norm", "color": "#b7791f"},
    {"label": "Attention", "color": "#2c6ecb"},
    {"label": "Residual", "color": "#c05621"},
    {"label": "FFN", "color": "#2f855a"},
    {"label": "MoE", "color": "#9f3fb8"},
    {"label": "Output", "color": "#b83249"},
    {"label": "Incast / Outcast", "color": "#606060"},
]


def parse_source_refs(source_ref: Optional[str]) -> Tuple[List[str], List[int]]:
    files: List[str] = []
    lines: List[int] = []
    if not source_ref:
        return files, lines
    for part in source_ref.split(";"):
        item = part.strip()
        if not item or ":" not in item:
            continue
        file_name, line_text = item.rsplit(":", 1)
        file_name = file_name.strip()
        try:
            line_no = int(line_text.strip())
        except ValueError:
            continue
        files.append(file_name)
        lines.append(line_no)
    return files, lines


def stage_semantics(stage: str, submodule: str) -> Tuple[str, str, str]:
    mapping = {
        "input_layernorm": ("Norm", "Input", "RMSNORM"),
        "post_attention_layernorm": ("Norm", "PostAttn", "RMSNORM"),
        "self_attn.q_path": ("Attn", "QPath", "Q_PATH"),
        "self_attn.q_split": ("Attn", "QSplit", "Q_SPLIT"),
        "self_attn.kv_a_path": ("Attn", "KVCompress", "KV_A_PATH"),
        "self_attn.kv_b_path": ("Attn", "KVExpand", "KV_B_PATH"),
        "self_attn.kv_split": ("Attn", "KVSplit", "KV_SPLIT"),
        "self_attn.rope": ("Attn", "RoPE", "ROPE"),
        "self_attn.compose_qk": ("Attn", "ComposeQK", "COMPOSE_QK"),
        "self_attn.score_path": ("Attn", "Score", "ATTN_SCORE"),
        "self_attn.softmax_dropout": ("Attn", "Softmax", "SOFTMAX"),
        "self_attn.value_aggregation": ("Attn", "ValueAgg", "VALUE_AGG"),
        "self_attn.out_proj": ("Attn", "OutProj", "OUT_PROJ"),
        "attention_residual": ("Residual", "AttnSkip", "ADD"),
        "ffn_residual": ("Residual", "FFNSkip", "ADD"),
        "moe_residual": ("Residual", "MoESkip", "ADD"),
        "mlp.gate_proj": ("FFN", "Gate", "LINEAR"),
        "mlp.up_proj": ("FFN", "Up", "LINEAR"),
        "mlp.activation_product": ("FFN", "ActMul", "MUL"),
        "mlp.down_proj": ("FFN", "Down", "LINEAR"),
        "moe.gate.linear": ("MoE", "Router", "LINEAR"),
        "moe.gate.selection": ("MoE", "TopK", "TOPK"),
        "moe.dispatch": ("MoE", "Dispatch", "DISPATCH"),
        "moe.routed_expert": ("MoE", "Expert", "SWIGLU"),
        "moe.routed_weighted_sum": ("MoE", "RoutedSum", "REDUCE"),
        "moe.shared_experts": ("MoE", "Shared", "SWIGLU"),
        "moe.combine": ("MoE", "Combine", "ADD"),
    }
    if submodule in mapping:
        return mapping[submodule]
    pipeline = {
        "normalization": "Norm",
        "attention": "Attn",
        "residual": "Residual",
        "ffn": "FFN",
        "moe": "MoE",
    }.get(stage, "Output")
    stage_name = submodule.split(".")[-1].replace("_", " ").title().replace(" ", "")
    opcode = submodule.split(".")[-1].upper()
    return pipeline, stage_name or "Stage", opcode


class GraphBuilder:
    def __init__(self) -> None:
        self.nodes: List[Dict[str, object]] = []
        self.edges: List[Dict[str, str]] = []
        self._edge_keys: set[Tuple[str, str]] = set()

    def add_node(self, node: Dict[str, object]) -> str:
        self.nodes.append(node)
        return str(node["id"])

    def add_edge(self, source: str, target: str) -> None:
        key = (source, target)
        if key in self._edge_keys:
            return
        self._edge_keys.add(key)
        self.edges.append({"source": source, "target": target})


def make_op_node(
    node_id: str,
    name: str,
    semantic_label: str,
    op_type: str,
    *,
    layer_id: Optional[int] = None,
    block_type: Optional[str] = None,
    stage: Optional[str] = None,
    submodule: Optional[str] = None,
    input_shape: Optional[str] = None,
    output_shape: Optional[str] = None,
    weights: Optional[Iterable[Dict[str, str]]] = None,
    formula: Optional[str] = None,
    fusion_notes: Optional[str] = None,
    details: Optional[str] = None,
    source_ref: Optional[str] = None,
    category: Optional[str] = None,
) -> Dict[str, object]:
    source_files, source_lines = parse_source_refs(source_ref)
    node: Dict[str, object] = {
        "id": node_id,
        "type": "Operation",
        "name": name,
        "op_type": op_type,
        "semantic_label": semantic_label,
        "shape": [output_shape] if output_shape else [],
        "offset": [],
        "layer_id": layer_id,
        "block_type": block_type,
        "stage": stage,
        "submodule": submodule,
        "input_shape": input_shape,
        "output_shape": output_shape,
        "weights": list(weights or []),
        "formula": formula,
        "fusion_notes": fusion_notes,
        "details": details,
        "source_ref": source_ref,
        "source_files": source_files,
        "source_lines": source_lines,
        "category": category,
    }
    return node


def build_graph(doc: Dict[str, object]) -> Dict[str, object]:
    builder = GraphBuilder()
    meta = doc["metadata"]
    arch = doc["architectural_summary"]

    builder.add_node(
        {
            "id": "in_input_ids",
            "type": "Incast",
            "name": "input_ids",
            "dtype": "DT_INT32",
            "shape": ["B", "T"],
            "details": "Token ids fed into the embedding lookup.",
        }
    )

    embed = make_op_node(
        "op_embed_tokens",
        "Embed Tokens",
        "Embed-Tokens",
        "EMBEDDING",
        input_shape="[B, T]",
        output_shape="[B, T, 7168]",
        weights=doc["global_components"][0]["weights"],
        details=doc["global_components"][0]["details"],
        source_ref=doc["global_components"][0]["source_ref"],
        category="embedding",
    )
    builder.add_node(embed)
    builder.add_edge("in_input_ids", "op_embed_tokens")

    previous_output = "op_embed_tokens"

    for layer in doc["layers"]:
        layer_id = int(layer["layer_id"])
        layer_prefix = f"l{layer_id:02d}"
        op_ids: Dict[str, str] = {}

        for operator in layer["operators"]:
            pipeline, semantic_stage, opcode = stage_semantics(operator["stage"], operator["submodule"])
            node_id = f"op_{layer_prefix}_{operator['submodule'].replace('.', '_')}"
            op_ids[operator["submodule"]] = node_id
            layer_label = f"L{layer_id:02d} {operator['op_name']}"
            builder.add_node(
                make_op_node(
                    node_id,
                    layer_label,
                    f"{pipeline}-{semantic_stage}",
                    opcode,
                    layer_id=layer_id,
                    block_type=layer["block_type"],
                    stage=operator["stage"],
                    submodule=operator["submodule"],
                    input_shape=operator["input_shape"],
                    output_shape=operator["output_shape"],
                    weights=operator["weights"],
                    formula=operator["formula"],
                    fusion_notes=operator["fusion_notes"],
                    details=layer["summary"],
                    source_ref=operator["source_ref"],
                    category=operator["stage"],
                )
            )

        first_norm = op_ids["input_layernorm"]
        builder.add_edge(previous_output, first_norm)

        if layer["block_type"] == "dense_ffn":
            builder.add_edge(previous_output, op_ids["attention_residual"])
            builder.add_edge(first_norm, op_ids["self_attn.q_path"])
            builder.add_edge(first_norm, op_ids["self_attn.kv_a_path"])
            builder.add_edge(op_ids["self_attn.q_path"], op_ids["self_attn.q_split"])
            builder.add_edge(op_ids["self_attn.q_split"], op_ids["self_attn.rope"])
            builder.add_edge(op_ids["self_attn.q_split"], op_ids["self_attn.compose_qk"])
            builder.add_edge(op_ids["self_attn.kv_a_path"], op_ids["self_attn.rope"])
            builder.add_edge(op_ids["self_attn.kv_a_path"], op_ids["self_attn.kv_b_path"])
            builder.add_edge(op_ids["self_attn.kv_b_path"], op_ids["self_attn.kv_split"])
            builder.add_edge(op_ids["self_attn.kv_split"], op_ids["self_attn.compose_qk"])
            builder.add_edge(op_ids["self_attn.kv_split"], op_ids["self_attn.value_aggregation"])
            builder.add_edge(op_ids["self_attn.rope"], op_ids["self_attn.compose_qk"])
            builder.add_edge(op_ids["self_attn.compose_qk"], op_ids["self_attn.score_path"])
            builder.add_edge(op_ids["self_attn.score_path"], op_ids["self_attn.softmax_dropout"])
            builder.add_edge(op_ids["self_attn.softmax_dropout"], op_ids["self_attn.value_aggregation"])
            builder.add_edge(op_ids["self_attn.value_aggregation"], op_ids["self_attn.out_proj"])
            builder.add_edge(op_ids["self_attn.out_proj"], op_ids["attention_residual"])
            builder.add_edge(op_ids["attention_residual"], op_ids["post_attention_layernorm"])
            builder.add_edge(op_ids["attention_residual"], op_ids["ffn_residual"])
            builder.add_edge(op_ids["post_attention_layernorm"], op_ids["mlp.gate_proj"])
            builder.add_edge(op_ids["post_attention_layernorm"], op_ids["mlp.up_proj"])
            builder.add_edge(op_ids["mlp.gate_proj"], op_ids["mlp.activation_product"])
            builder.add_edge(op_ids["mlp.up_proj"], op_ids["mlp.activation_product"])
            builder.add_edge(op_ids["mlp.activation_product"], op_ids["mlp.down_proj"])
            builder.add_edge(op_ids["mlp.down_proj"], op_ids["ffn_residual"])
            previous_output = op_ids["ffn_residual"]
        else:
            builder.add_edge(previous_output, op_ids["attention_residual"])
            builder.add_edge(first_norm, op_ids["self_attn.q_path"])
            builder.add_edge(first_norm, op_ids["self_attn.kv_a_path"])
            builder.add_edge(op_ids["self_attn.q_path"], op_ids["self_attn.q_split"])
            builder.add_edge(op_ids["self_attn.q_split"], op_ids["self_attn.rope"])
            builder.add_edge(op_ids["self_attn.q_split"], op_ids["self_attn.compose_qk"])
            builder.add_edge(op_ids["self_attn.kv_a_path"], op_ids["self_attn.rope"])
            builder.add_edge(op_ids["self_attn.kv_a_path"], op_ids["self_attn.kv_b_path"])
            builder.add_edge(op_ids["self_attn.kv_b_path"], op_ids["self_attn.kv_split"])
            builder.add_edge(op_ids["self_attn.kv_split"], op_ids["self_attn.compose_qk"])
            builder.add_edge(op_ids["self_attn.kv_split"], op_ids["self_attn.value_aggregation"])
            builder.add_edge(op_ids["self_attn.rope"], op_ids["self_attn.compose_qk"])
            builder.add_edge(op_ids["self_attn.compose_qk"], op_ids["self_attn.score_path"])
            builder.add_edge(op_ids["self_attn.score_path"], op_ids["self_attn.softmax_dropout"])
            builder.add_edge(op_ids["self_attn.softmax_dropout"], op_ids["self_attn.value_aggregation"])
            builder.add_edge(op_ids["self_attn.value_aggregation"], op_ids["self_attn.out_proj"])
            builder.add_edge(op_ids["self_attn.out_proj"], op_ids["attention_residual"])
            builder.add_edge(op_ids["attention_residual"], op_ids["post_attention_layernorm"])
            builder.add_edge(op_ids["attention_residual"], op_ids["moe_residual"])
            builder.add_edge(op_ids["post_attention_layernorm"], op_ids["moe.gate.linear"])
            builder.add_edge(op_ids["moe.gate.linear"], op_ids["moe.gate.selection"])
            builder.add_edge(op_ids["post_attention_layernorm"], op_ids["moe.dispatch"])
            builder.add_edge(op_ids["moe.gate.selection"], op_ids["moe.dispatch"])
            builder.add_edge(op_ids["moe.dispatch"], op_ids["moe.routed_expert"])
            builder.add_edge(op_ids["moe.gate.selection"], op_ids["moe.routed_weighted_sum"])
            builder.add_edge(op_ids["moe.routed_expert"], op_ids["moe.routed_weighted_sum"])
            builder.add_edge(op_ids["post_attention_layernorm"], op_ids["moe.shared_experts"])
            builder.add_edge(op_ids["moe.routed_weighted_sum"], op_ids["moe.combine"])
            builder.add_edge(op_ids["moe.shared_experts"], op_ids["moe.combine"])
            builder.add_edge(op_ids["moe.combine"], op_ids["moe_residual"])
            previous_output = op_ids["moe_residual"]

    final_norm_meta = doc["global_components"][2]
    final_norm = make_op_node(
        "op_final_norm",
        "Final RMSNorm",
        "Norm-Final",
        "RMSNORM",
        input_shape=final_norm_meta["input_shape"],
        output_shape=final_norm_meta["output_shape"],
        weights=final_norm_meta["weights"],
        details=final_norm_meta["details"],
        source_ref=final_norm_meta["source_ref"],
        category=final_norm_meta["category"],
    )
    lm_head_meta = doc["global_components"][3]
    lm_head = make_op_node(
        "op_lm_head",
        "LM Head",
        "Output-LMHead",
        "LINEAR",
        input_shape=lm_head_meta["input_shape"],
        output_shape=lm_head_meta["output_shape"],
        weights=lm_head_meta["weights"],
        details=lm_head_meta["details"],
        source_ref=lm_head_meta["source_ref"],
        category=lm_head_meta["category"],
    )
    builder.add_node(final_norm)
    builder.add_node(lm_head)
    builder.add_node(
        {
            "id": "out_logits",
            "type": "Outcast",
            "name": "logits",
            "dtype": "DT_FP32",
            "shape": ["B", "T", "129280"],
            "details": "Vocabulary logits emitted by the causal LM head.",
        }
    )

    builder.add_edge(previous_output, "op_final_norm")
    builder.add_edge("op_final_norm", "op_lm_head")
    builder.add_edge("op_lm_head", "out_logits")

    dense_count = len(arch["dense_layers"])
    moe_count = len(arch["moe_layers"])
    return {
        "graph_name": "DeepSeek-V3 Source Graph",
        "meta": {
            "preset": "deepseek_v3",
            "sourceFile": "modeling_deepseek.py",
            "generatedAt": meta["generated_at_utc"],
            "defaultLayout": "vertical",
            "infoSource": f"DeepSeek-V3 源模型：61 层 decoder，{dense_count} 层 dense SwiGLU，{moe_count} 层 MoE。",
            "legendItems": LEGEND_ITEMS,
            "layerCount": arch["total_layers"],
            "denseLayerCount": dense_count,
            "moeLayerCount": moe_count,
            "sourceScope": meta["source_scope"],
        },
        "nodes": builder.nodes,
        "edges": builder.edges,
    }


def main() -> None:
    doc = json.loads(SOURCE_JSON.read_text())
    graph = build_graph(doc)
    OUTPUT_JSON.write_text(json.dumps(graph, indent=2) + "\n")
    print(f"Wrote {OUTPUT_JSON.relative_to(ROOT)} with {len(graph['nodes'])} nodes and {len(graph['edges'])} edges.")


if __name__ == "__main__":
    main()

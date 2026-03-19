#!/usr/bin/env python3
# coding: utf-8
"""
PyPTO 前端静态编译器 —— Initial IR 计算图生成（带分层 Group 结构）
==================================================================
依据 developer_doc_zh.md 六步流程的第五步（Parser / Initial IR 生成），
通过静态分析 lightning_indexer_prolog_quant.py 输出分层 JSON。
"""

import json
from pathlib import Path


# ──────────────────────────────────────────────────────────────────────────────
# IR 数据模型
# ──────────────────────────────────────────────────────────────────────────────

class TensorRef:
    def __init__(self, node_id: str, shape=None, dtype: str = ""):
        self.node_id = node_id
        self.shape   = shape or []
        self.dtype   = dtype


class IRGraph:
    def __init__(self, graph_name: str):
        self.graph_name = graph_name
        self.nodes: list[dict] = []
        self.edges: list[dict] = []
        self._id_ctr: dict[str, int] = {}
        self._pending_label: str = ""

    def _uid(self, prefix: str) -> str:
        n = self._id_ctr.get(prefix, 0)
        self._id_ctr[prefix] = n + 1
        return prefix if n == 0 else f"{prefix}_{n}"

    def add_group(self, gid: str, label: str, parent: str | None = None,
                  source_code: str = "", source_lines=None) -> str:
        node: dict = {"id": gid, "type": "Group", "name": label}
        if parent:        node["parentId"]     = parent
        if source_code:   node["source_code"]  = source_code
        if source_lines:  node["source_lines"] = source_lines
        self.nodes.append(node)
        return gid

    def add_incast(self, var: str, dtype: str, shape: list) -> TensorRef:
        nid = f"in_{var}"
        self.nodes.append({"id": nid, "type": "Incast",
                           "name": var, "dtype": dtype, "shape": shape})
        return TensorRef(nid, shape, dtype)

    def add_outcast(self, var: str, dtype: str, shape: list) -> TensorRef:
        nid = f"out_{var}"
        self.nodes.append({"id": nid, "type": "Outcast",
                           "name": var, "dtype": dtype, "shape": shape})
        return TensorRef(nid, shape, dtype)

    def add_op(self, op_display: str, op_type: str,
               inputs: list, out_name: str, out_dtype: str, out_shape: list,
               parent: str | None = None,
               semantic_label: str = "",
               source_ref: dict | None = None) -> TensorRef:
        op_id  = self._uid(f"op_{op_type.lower()}")
        ten_id = self._uid(f"t_{out_name}")

        label = semantic_label or self._pending_label
        self._pending_label = ""

        op_node: dict = {"id": op_id, "type": "Operation",
                         "name": op_display, "op_type": op_type}
        if parent:       op_node["parentId"]      = parent
        if label:        op_node["semantic_label"] = label
        if source_ref:   op_node["source_ref"]     = source_ref
        self.nodes.append(op_node)

        for inp in inputs:
            if inp and isinstance(inp, TensorRef):
                self.edges.append({"source": inp.node_id, "target": op_id})

        ten_node: dict = {"id": ten_id, "type": "Tensor",
                          "name": out_name, "dtype": out_dtype, "shape": out_shape}
        if parent: ten_node["parentId"] = parent
        self.nodes.append(ten_node)
        self.edges.append({"source": op_id, "target": ten_id})

        return TensorRef(ten_id, out_shape, out_dtype)

    def wire(self, src: TensorRef, dst: TensorRef):
        self.edges.append({"source": src.node_id, "target": dst.node_id})

    def to_dict(self) -> dict:
        nodes_out = []
        for n in self.nodes:
            row = {"id": n["id"], "type": n["type"], "name": n["name"]}
            for key in ("parentId", "dtype", "shape", "op_type",
                        "semantic_label", "source_code", "source_lines", "source_ref"):
                if key in n:
                    row[key] = n[key]
            nodes_out.append(row)
        return {
            "graph_name": self.graph_name,
            "initialExpanded": [],
            "nodes": nodes_out,
            "edges": self.edges,
        }


# ──────────────────────────────────────────────────────────────────────────────
# 输入 / 输出规格
# ──────────────────────────────────────────────────────────────────────────────

INPUT_SPECS = [
    ("x_in",              "DT_BF16",  ["T", "H"]),
    ("q_norm_in",         "DT_INT8",  ["T", "q_lora_rank"]),
    ("q_norm_scale_in",   "DT_FP32",  ["T", "1"]),
    ("w_qb_in",           "DT_INT8",  ["q_lora_rank", "head_num*head_dim"]),
    ("w_qb_scale_in",     "DT_FP32",  ["head_num*head_dim", "1"]),
    ("wk_in",             "DT_BF16",  ["H", "head_dim"]),
    ("w_proj_in",         "DT_BF16",  ["H", "head_num"]),
    ("ln_gamma_k_in",     "DT_BF16",  ["head_dim"]),
    ("ln_beta_k_in",      "DT_BF16",  ["head_dim"]),
    ("cos_idx_rope_in",   "DT_BF16",  ["T", "rope_head_dim"]),
    ("sin_idx_rope_in",   "DT_BF16",  ["T", "rope_head_dim"]),
    ("hadamard_q_in",     "DT_BF16",  ["head_dim", "head_dim"]),
    ("hadamard_k_in",     "DT_BF16",  ["head_dim", "head_dim"]),
    ("k_cache",           "DT_INT8",  ["blockNum", "blockSize", "nKv", "head_dim"]),
    ("k_cache_scale",     "DT_FP16",  ["blockNum", "blockSize", "nKv", "1"]),
    ("k_cache_index_in",  "DT_INT64", ["T"]),
]

OUTPUT_SPECS = [
    ("q_int8_out",  "DT_INT8",  ["T", "head_num", "head_dim"]),
    ("q_scale_out", "DT_FP16",  ["T", "head_num", "1"]),
    ("k_int8_out",  "DT_INT8",  ["blockNum", "blockSize", "nKv", "head_dim"]),
    ("k_scale_out", "DT_FP16",  ["blockNum", "blockSize", "nKv", "1"]),
    ("weights_out", "DT_FP16",  ["T", "head_num"]),
]

T = "t_tile"


# ──────────────────────────────────────────────────────────────────────────────
# Group 源码字符串
# ──────────────────────────────────────────────────────────────────────────────

SRC_LOOP_RESHAPE = (
    'for _ in pypto.loop(0, 1, 1,\n'
    '    name="LOOP_RESHAPE", idx_name="dummy"):\n'
    '    k_cache_index = pypto.reshape(k_cache_index_in, [t, 1], inplace=True)          # L240\n'
    '    w_qb_scale    = pypto.reshape(w_qb_scale_in, [1, head_num*head_dim], ...)       # L242\n'
    '    gamma_2d      = pypto.reshape(ln_gamma_k_in, [1, ln_gamma_k_in.shape[0]], ...)  # L243\n'
    '    beta_2d       = pypto.reshape(ln_beta_k_in,  [1, ln_beta_k_in.shape[0]],  ...)  # L245\n'
    '    w_qb          = pypto.reshape(w_qb_in,  [q_lora_rank, head_num*head_dim], ...)  # L247\n'
    '    wk            = pypto.reshape(wk_in,   [h, head_dim], inplace=True)             # L248\n'
    '    w_proj        = pypto.reshape(w_proj_in, [h, head_num], inplace=True)           # L249'
)

SRC_MAIN_LOOP = (
    'for tIdx, unrollLength in pypto.loop_unroll(\n'
    '    0, t, 1,\n'
    '    name="IndexerPrologQuantQuantLoop",\n'
    '    idx_name="tIdx",\n'
    '    unroll_list=unroll_list):   # L252–253\n'
    '    # 每次处理 t_tile 个 token，tIdx 为当前 tile 起始偏移'
)

SRC_TILE_PREP = (
    '# IR 生成器从主循环体各处汇聚所有 tile 切片操作\n'
    'q_norm       = pypto.view(q_norm_in,       [t_tile, q_lora_rank],   [tIdx, 0], ...)  # L266\n'
    'q_norm_scale = pypto.view(q_norm_scale_in, [t_tile, 1],             [tIdx, 0], ...)  # L267\n'
    'rope_cos     = pypto.view(cos_idx_rope_in, [t_tile, rope_head_dim], [tIdx, 0], ...)  # L287\n'
    'rope_sin     = pypto.view(sin_idx_rope_in, [t_tile, rope_head_dim], [tIdx, 0], ...)  # L289\n'
    'x            = pypto.view(x_in,            [t_tile, h],             [tIdx, 0], ...)  # L317'
)

SRC_Q_BRANCH = (
    '# Query 计算支路（L266–L309）\n'
    '# 含五个语义阶段：Linear → Dequant → Rope3D → Hadamard → Quant'
)

SRC_Q_LINEAR = (
    'pypto.set_semantic_label("Query-Linear")              # L268\n'
    'pypto.set_cube_tile_shapes([L0M,L1M],[L0K,L1K],[L0N,L1N], True)  # L269\n'
    'q_s32 = pypto.matmul(q_norm, w_qb, pypto.DT_INT32)   # L272\n'
    '# q_norm: INT8 [t_tile, q_lora_rank]\n'
    '# w_qb:   INT8 [q_lora_rank, head_num*head_dim]\n'
    '# → q_s32: INT32 [t_tile, head_num*head_dim]'
)

SRC_Q_DEQUANT = (
    'pypto.set_semantic_label("Query-Dequant")             # L274\n'
    'q_f32  = pypto.cast(q_s32, pypto.DT_FP32)            # L276\n'
    'q_f32  = q_f32 * q_norm_scale                        # L277\n'
    'q_f32  = q_f32 * w_qb_scale                          # L278\n'
    'q_cast = pypto.cast(q_f32, x_dtype)                  # L279  → BF16\n'
    'q_bf16 = pypto.reshape(q_cast, [t_tile,head_num,head_dim], ...)  # L281\n'
    'q_rope = pypto.view(q_bf16, [t_tile,head_num,rope_head_dim], [0,0,0], ...)       # L283\n'
    'q_nope = pypto.view(q_bf16, [t_tile,head_num,head_dim-rope_head_dim], [0,0,R], ...)  # L285'
)

SRC_Q_ROPE3D = (
    'q_roped = rope_3d(q_rope, rope_cos, rope_sin)        # L292  → 内联展开\n'
    '\n'
    'def rope_3d(x, cos, sin):  # L181–202\n'
    '    cast_cos = pypto.cast(cos, pypto.DT_FP32)        # L193\n'
    '    cast_sin = pypto.cast(sin, pypto.DT_FP32)        # L194\n'
    '    x_view   = pypto.cast(x,   pypto.DT_FP32)        # L196\n'
    '    cast_cos = pypto.reshape(cast_cos, [t_tile,1,rope_dim])  # L197\n'
    '    cast_sin = pypto.reshape(cast_sin, [t_tile,1,rope_dim])  # L198\n'
    '    # rotate_half 内联（L176–178）\n'
    '    x_embed  = (x_view * cast_cos) + (rotate_half(x_view) * cast_sin)  # L200\n'
    '    return pypto.cast(x_embed, x_dtype)              # L201\n'
    '\n'
    'q_nope = pypto.cast(pypto.cast(q_nope, DT_FP32), q_bf16.dtype)  # L294\n'
    'q_concat = pypto.concat([q_roped, q_nope], -1)       # L295'
)

SRC_Q_HADAMARD = (
    'pypto.set_semantic_label("Query-Hadamard")            # L298\n'
    'hadamard_q = pypto.reshape(hadamard_q_in, [1,head_dim,head_dim], ...)  # L296\n'
    'q_hadamard = pypto.matmul(q_concat, hadamard_q, x_dtype)  # L301\n'
    '# q_concat:   BF16 [t_tile, head_num, head_dim]\n'
    '# hadamard_q: BF16 [1, head_dim, head_dim]\n'
    '# → q_hadamard: BF16 [t_tile, head_num, head_dim]'
)

SRC_Q_QUANT = (
    'pypto.set_semantic_label("Query-Quant")               # L303\n'
    'q_res = prolog_quant(q_hadamard)                      # L305  → 内联展开\n'
    '\n'
    'def prolog_quant(input):  # L146–163\n'
    '    input_fp32 = pypto.cast(input, pypto.DT_FP32)    # L150\n'
    '    abs_res    = pypto.abs(input_fp32)                # L152\n'
    '    max_value  = pypto.amax(abs_res, dim=-1, keepdim=True)  # L153\n'
    '    scale_q    = pypto.full(..., 127.0) / max_value   # L154–156\n'
    '    out_fp32   = input_fp32 * scale_q                 # L157\n'
    '    out_int8   = cast→INT32→FP16→INT8                 # L158–160\n'
    '    scale_deq  = pypto.full(..., 1.0) / scale_q       # L161–162\n'
    '    return (out_int8, scale_deq)\n'
    '\n'
    'pypto.assemble(q_res[0], [tIdx,0,0], q_int8_out)      # L308\n'
    'pypto.assemble(q_scale,  [tIdx,0,0], q_scale_out)     # L309'
)

SRC_K_BRANCH = (
    '# Key 计算支路（L313–L341）\n'
    '# 含六个语义阶段：Linear → LayerNorm → Rope2D → Hadamard → Quant → ScatterUpdate'
)

SRC_K_LINEAR = (
    'pypto.set_semantic_label("Key-Linear")                # L313\n'
    'x = pypto.view(x_in, [t_tile, h], [tIdx, 0], ...)    # L317\n'
    'k = pypto.matmul(x, wk, pypto.DT_FP32)               # L318\n'
    '# x:  BF16 [t_tile, H]\n'
    '# wk: BF16 [H, head_dim]\n'
    '# → k: FP32 [t_tile, head_dim]'
)

SRC_K_LAYERNORM = (
    'k_bf16 = pypto.cast(\n'
    '    quant_layer_norm(k, gamma_2d, beta_2d, -1, attrs.eps),\n'
    '    x_dtype)  # L321  → 内联展开\n'
    '\n'
    'def quant_layer_norm(x, gamma, beta, dim, epsilon):  # L102–124\n'
    '    pypto.set_semantic_label("Key-LayerNorm")        # L103\n'
    '    x_fp32   = pypto.cast(x, pypto.DT_FP32)         # L108\n'
    '    x_scaled = x_fp32 * (1.0 / dim)                 # L110\n'
    '    mean     = pypto.sum(x_scaled, dim, keepdim=True)# L111\n'
    '    diff     = x_fp32 - mean                         # L113\n'
    '    var      = pypto.sum(diff*diff*(1/dim), dim, keepdim=True)  # L115–116\n'
    '    std      = pypto.sqrt(var + epsilon)             # L119\n'
    '    res32    = diff / std                            # L120\n'
    '    return pypto.cast(res32*gamma + beta, x.dtype)  # L122–124'
)

SRC_K_ROPE2D = (
    'k_roped = quant_rope_2d(k_rope, rope_cos, rope_sin)  # L326  → 内联展开\n'
    '\n'
    'def quant_rope_2d(x, cos, sin):  # L127–143\n'
    '    pypto.set_semantic_label("Key-Rope2D")           # L128\n'
    '    cast_cos = pypto.cast(cos, pypto.DT_FP32)        # L136\n'
    '    cast_sin = pypto.cast(sin, pypto.DT_FP32)        # L137\n'
    '    x_view   = pypto.cast(x,   pypto.DT_FP32)        # L138\n'
    '    # rotate_half 内联（L176–178）\n'
    '    x_embed  = (x_view * cast_cos) + (rotate_half(x_view) * cast_sin)  # L141\n'
    '    return pypto.cast(x_embed, x.dtype)              # L142'
)

SRC_K_HADAMARD = (
    'pypto.set_semantic_label("Key-Hadamard")             # L330\n'
    'hadamard_k = pypto.matmul(k_concat, hadamard_k_in, x_dtype)  # L331\n'
    '# k_concat:    BF16 [t_tile, head_dim]\n'
    '# hadamard_k_in: BF16 [head_dim, head_dim]\n'
    '# → hadamard_k: BF16 [t_tile, head_dim]'
)

SRC_K_QUANT = (
    'pypto.set_semantic_label("Key-Quant")                # L332\n'
    'k_res = prolog_quant(hadamard_k)                     # L333  → 内联展开\n'
    '# prolog_quant() 同 Query-Quant，见 L146–163'
)

SRC_K_SCATTER = (
    'k_cache_4D = pypto.reshape(k_res[0], [t_tile,1,1,head_dim], ...)  # L334\n'
    'k_scale_4D = pypto.reshape(cast(k_res[1],FP16), [t_tile,1,1,1], ...)  # L335\n'
    'index = pypto.view(k_cache_index, [t_tile,1], [tIdx,0], ...)  # L338\n'
    'k_int8_out.move(\n'
    '    pypto.scatter_update(k_cache, SCATTER_DIM, index, k_cache_4D))   # L340\n'
    'k_scale_out.move(\n'
    '    pypto.scatter_update(k_cache_scale, SCATTER_DIM, index, k_scale_4D))  # L341'
)

SRC_W_BRANCH = (
    'pypto.set_semantic_label("Weight-Linear")            # L343\n'
    'weights   = pypto.cast(\n'
    '    pypto.matmul(x, w_proj, x_dtype), pypto.DT_FP32)# L349\n'
    'weights   = pypto.mul(weights,\n'
    '    1.0/(math.sqrt(head_num)*math.sqrt(head_dim)))   # L350\n'
    'weights_f16 = pypto.cast(weights, pypto.DT_FP16)    # L351\n'
    'pypto.assemble(weights_f16, [tIdx,0], weights_out)   # L352'
)


# ──────────────────────────────────────────────────────────────────────────────
# 关键 Op source_ref
# ──────────────────────────────────────────────────────────────────────────────

def src(lines, code):
    return {"lines": lines, "code": code}

S_VIEW_Q_NORM    = src([266,266], "q_norm = pypto.view(q_norm_in, [t_tile, q_lora_rank], [tIdx, 0], valid_shape=[t_tile, q_lora_rank])")
S_VIEW_Q_SCALE   = src([267,267], "q_norm_scale = pypto.view(q_norm_scale_in, [t_tile, 1], [tIdx, 0], valid_shape=[t_tile, 1])")
S_VIEW_COS       = src([287,288], "rope_cos = pypto.view(cos_idx_rope_in, [t_tile, rope_head_dim],\n               [tIdx, 0], valid_shape=[t_tile, rope_head_dim])")
S_VIEW_SIN       = src([289,290], "rope_sin = pypto.view(sin_idx_rope_in, [t_tile, rope_head_dim],\n               [tIdx, 0], valid_shape=[t_tile, rope_head_dim])")
S_VIEW_X         = src([317,317], "x = pypto.view(x_in, [t_tile, h], [tIdx, 0], valid_shape=[t_tile, h])")

S_Q_MATMUL       = src([272,272], "q_s32 = pypto.matmul(q_norm, w_qb, pypto.DT_INT32)  # [t_tile, head_num * head_dim]")
S_Q_HADAMARD     = src([301,301], "q_hadamard = pypto.matmul(q_concat, hadamard_q, x_dtype)  # [t_tile, head_num, head_dim]")
S_Q_ASM_INT8     = src([308,308], "pypto.assemble(q_res[0], [tIdx, 0, 0], q_int8_out)")
S_Q_ASM_SCALE    = src([309,309], "pypto.assemble(q_scale, [tIdx, 0, 0], q_scale_out)")

S_K_MATMUL       = src([318,318], "k = pypto.matmul(x, wk, pypto.DT_FP32)  # [t_tile, head_dim]")
S_K_HADAMARD     = src([331,331], "hadamard_k = pypto.matmul(k_concat, hadamard_k_in, x_dtype)  # [t_tile, head_dim]")
S_K_SCATTER_INT8 = src([340,340], "k_int8_out.move(pypto.scatter_update(k_cache, SCATTER_DIM, index, k_cache_4D))")
S_K_SCATTER_SCL  = src([341,341], "k_scale_out.move(pypto.scatter_update(k_cache_scale, SCATTER_DIM, index, k_scale_4D))")

S_W_MATMUL       = src([349,349], "weights = pypto.cast(pypto.matmul(x, w_proj, x_dtype), pypto.DT_FP32)")
S_W_ASSEMBLE     = src([352,352], "pypto.assemble(weights_f16, [tIdx, 0], weights_out)")


# ──────────────────────────────────────────────────────────────────────────────
# 构图
# ──────────────────────────────────────────────────────────────────────────────

def build_ir(g: IRGraph) -> None:
    ctx: dict[str, TensorRef] = {}

    for name, dtype, shape in INPUT_SPECS:
        ctx[name] = g.add_incast(name, dtype, shape)

    out_refs: dict[str, TensorRef] = {}
    for name, dtype, shape in OUTPUT_SPECS:
        ref = g.add_outcast(name, dtype, shape)
        out_refs[name] = ref
        ctx[name] = ref

    # ── Group 骨架 ────────────────────────────────────────────────────────────
    GRP_RESHAPE = g.add_group("grp_loop_reshape", "LOOP_RESHAPE",
                              source_code=SRC_LOOP_RESHAPE, source_lines=[237, 249])
    GRP_MAIN    = g.add_group("grp_main_loop",    "loop_unroll · IndexerPrologQuantQuantLoop",
                              source_code=SRC_MAIN_LOOP, source_lines=[252, 253])
    GRP_PREP    = g.add_group("grp_tile_prep",    "Tile 准备",          GRP_MAIN,
                              source_code=SRC_TILE_PREP, source_lines=[266, 317])
    GRP_Q       = g.add_group("grp_query",        "Query 支路",         GRP_MAIN,
                              source_code=SRC_Q_BRANCH, source_lines=[268, 309])
    GRP_Q_LIN   = g.add_group("grp_q_linear",     "Query-Linear",       GRP_Q,
                              source_code=SRC_Q_LINEAR, source_lines=[268, 272])
    GRP_Q_DEQ   = g.add_group("grp_q_dequant",    "Query-Dequant",      GRP_Q,
                              source_code=SRC_Q_DEQUANT, source_lines=[274, 286])
    GRP_Q_ROPE  = g.add_group("grp_q_rope3d",     "Query-Rope3D",       GRP_Q,
                              source_code=SRC_Q_ROPE3D, source_lines=[292, 295])
    GRP_Q_HD    = g.add_group("grp_q_hadamard",   "Query-Hadamard",     GRP_Q,
                              source_code=SRC_Q_HADAMARD, source_lines=[296, 301])
    GRP_Q_QT    = g.add_group("grp_q_quant",      "Query-Quant",        GRP_Q,
                              source_code=SRC_Q_QUANT, source_lines=[303, 309])
    GRP_K       = g.add_group("grp_key",          "Key 支路",           GRP_MAIN,
                              source_code=SRC_K_BRANCH, source_lines=[313, 341])
    GRP_K_LIN   = g.add_group("grp_k_linear",     "Key-Linear",         GRP_K,
                              source_code=SRC_K_LINEAR, source_lines=[313, 318])
    GRP_K_LN    = g.add_group("grp_k_layernorm",  "Key-LayerNorm",      GRP_K,
                              source_code=SRC_K_LAYERNORM, source_lines=[321, 321])
    GRP_K_ROPE  = g.add_group("grp_k_rope2d",     "Key-Rope2D",         GRP_K,
                              source_code=SRC_K_ROPE2D, source_lines=[326, 329])
    GRP_K_HD    = g.add_group("grp_k_hadamard",   "Key-Hadamard",       GRP_K,
                              source_code=SRC_K_HADAMARD, source_lines=[330, 331])
    GRP_K_QT    = g.add_group("grp_k_quant",      "Key-Quant",          GRP_K,
                              source_code=SRC_K_QUANT, source_lines=[332, 336])
    GRP_K_SC    = g.add_group("grp_k_scatter",    "Key-ScatterUpdate",  GRP_K,
                              source_code=SRC_K_SCATTER, source_lines=[338, 341])
    GRP_W       = g.add_group("grp_weight",       "Weight 支路",        GRP_MAIN,
                              source_code=SRC_W_BRANCH, source_lines=[343, 352])

    # ── 便捷函数 ──────────────────────────────────────────────────────────────
    def reshape(src_var, dst_var, dtype, shape):
        ref = g.add_op("RESHAPE", "RESHAPE", [ctx[src_var]],
                       dst_var, dtype, shape, parent=GRP_RESHAPE)
        ctx[dst_var] = ref
        return ref

    def op(display, op_type, inputs, out_name, dtype, shape, grp, lbl="", sr=None):
        ref = g.add_op(display, op_type, inputs, out_name, dtype, shape,
                       parent=grp, semantic_label=lbl, source_ref=sr)
        ctx[out_name] = ref
        return ref

    # ── LOOP_RESHAPE ──────────────────────────────────────────────────────────
    reshape("k_cache_index_in", "k_cache_index", "DT_INT64", [T, "1"])
    reshape("w_qb_scale_in",    "w_qb_scale",    "DT_FP32",  ["1", "head_num*head_dim"])
    reshape("ln_gamma_k_in",    "gamma_2d",      "DT_BF16",  ["1", "head_dim"])
    reshape("ln_beta_k_in",     "beta_2d",       "DT_BF16",  ["1", "head_dim"])
    reshape("w_qb_in",          "w_qb",          "DT_INT8",  ["q_lora_rank", "head_num*head_dim"])
    reshape("wk_in",            "wk",            "DT_BF16",  ["H", "head_dim"])
    reshape("w_proj_in",        "w_proj",        "DT_BF16",  ["H", "head_num"])

    # ── Tile 准备 ─────────────────────────────────────────────────────────────
    op("VIEW", "VIEW", [ctx["q_norm_in"]],       "q_norm",       "DT_INT8",  [T, "q_lora_rank"],   GRP_PREP, sr=S_VIEW_Q_NORM)
    op("VIEW", "VIEW", [ctx["q_norm_scale_in"]], "q_norm_scale", "DT_FP32",  [T, "1"],             GRP_PREP, sr=S_VIEW_Q_SCALE)
    op("VIEW", "VIEW", [ctx["x_in"]],            "x_tile",       "DT_BF16",  [T, "H"],             GRP_PREP, sr=S_VIEW_X)
    op("VIEW", "VIEW", [ctx["cos_idx_rope_in"]], "rope_cos",     "DT_BF16",  [T, "rope_head_dim"], GRP_PREP, sr=S_VIEW_COS)
    op("VIEW", "VIEW", [ctx["sin_idx_rope_in"]], "rope_sin",     "DT_BF16",  [T, "rope_head_dim"], GRP_PREP, sr=S_VIEW_SIN)

    # ── Query-Linear ──────────────────────────────────────────────────────────
    op("MATMUL", "A_MUL_B",
       [ctx["q_norm"], ctx["w_qb"]],
       "q_s32", "DT_INT32", [T, "head_num*head_dim"],
       GRP_Q_LIN, lbl="Query-Linear", sr=S_Q_MATMUL)

    # ── Query-Dequant ─────────────────────────────────────────────────────────
    op("CAST",   "CAST",   [ctx["q_s32"]],                      "q_f32",        "DT_FP32", [T, "head_num*head_dim"], GRP_Q_DEQ, lbl="Query-Dequant")
    op("MUL",    "MUL",    [ctx["q_f32"], ctx["q_norm_scale"]], "q_f32_normed", "DT_FP32", [T, "head_num*head_dim"], GRP_Q_DEQ)
    op("MUL",    "MUL",    [ctx["q_f32_normed"], ctx["w_qb_scale"]], "q_f32_wt","DT_FP32", [T, "head_num*head_dim"], GRP_Q_DEQ)
    op("CAST",   "CAST",   [ctx["q_f32_wt"]],                   "q_cast",       "DT_BF16", [T, "head_num*head_dim"], GRP_Q_DEQ)
    op("RESHAPE","RESHAPE",[ctx["q_cast"]],                      "q_bf16",       "DT_BF16", [T, "head_num","head_dim"], GRP_Q_DEQ)
    op("VIEW",   "VIEW",   [ctx["q_bf16"]],                      "q_rope_slice", "DT_BF16", [T, "head_num","rope_head_dim"], GRP_Q_DEQ)
    op("VIEW",   "VIEW",   [ctx["q_bf16"]],                      "q_nope_slice", "DT_BF16", [T, "head_num","head_dim-rope_head_dim"], GRP_Q_DEQ)

    # ── Query-Rope3D ──────────────────────────────────────────────────────────
    op("CAST",   "CAST",   [ctx["rope_cos"]],                    "q_cos_fp32",  "DT_FP32", [T, "rope_head_dim"],              GRP_Q_ROPE)
    op("CAST",   "CAST",   [ctx["rope_sin"]],                    "q_sin_fp32",  "DT_FP32", [T, "rope_head_dim"],              GRP_Q_ROPE)
    op("CAST",   "CAST",   [ctx["q_rope_slice"]],                "q_rope_fp32", "DT_FP32", [T, "head_num","rope_head_dim"],   GRP_Q_ROPE)
    op("RESHAPE","RESHAPE",[ctx["q_cos_fp32"]],                  "q_cos_3d",    "DT_FP32", [T, "1","rope_head_dim"],          GRP_Q_ROPE)
    op("RESHAPE","RESHAPE",[ctx["q_sin_fp32"]],                  "q_sin_3d",    "DT_FP32", [T, "1","rope_head_dim"],          GRP_Q_ROPE)
    op("VIEW",   "VIEW",   [ctx["q_rope_fp32"]],                 "q_rh_x1",     "DT_FP32", [T, "head_num","rope_head_dim//2"],GRP_Q_ROPE)
    op("VIEW",   "VIEW",   [ctx["q_rope_fp32"]],                 "q_rh_x2",     "DT_FP32", [T, "head_num","rope_head_dim//2"],GRP_Q_ROPE)
    op("MUL",    "MUL",    [ctx["q_rh_x2"]],                    "q_rh_neg",    "DT_FP32", [T, "head_num","rope_head_dim//2"],GRP_Q_ROPE)
    op("CONCAT", "CONCAT", [ctx["q_rh_neg"],ctx["q_rh_x1"]],    "q_rh",        "DT_FP32", [T, "head_num","rope_head_dim"],   GRP_Q_ROPE)
    op("MUL",    "MUL",    [ctx["q_rope_fp32"],ctx["q_cos_3d"]],"q_x_cos",     "DT_FP32", [T, "head_num","rope_head_dim"],   GRP_Q_ROPE)
    op("MUL",    "MUL",    [ctx["q_rh"],ctx["q_sin_3d"]],       "q_rh_sin",    "DT_FP32", [T, "head_num","rope_head_dim"],   GRP_Q_ROPE)
    op("ADD",    "ADD",    [ctx["q_x_cos"],ctx["q_rh_sin"]],     "q_embed",     "DT_FP32", [T, "head_num","rope_head_dim"],   GRP_Q_ROPE)
    op("CAST",   "CAST",   [ctx["q_embed"]],                     "q_roped",     "DT_BF16", [T, "head_num","rope_head_dim"],   GRP_Q_ROPE)
    op("CAST",   "CAST",   [ctx["q_nope_slice"]],                "q_nope_fp32", "DT_FP32", [T, "head_num","head_dim-rope_head_dim"],GRP_Q_ROPE)
    op("CAST",   "CAST",   [ctx["q_nope_fp32"]],                 "q_nope_bf16", "DT_BF16", [T, "head_num","head_dim-rope_head_dim"],GRP_Q_ROPE)
    op("CONCAT", "CONCAT", [ctx["q_roped"],ctx["q_nope_bf16"]], "q_concat",    "DT_BF16", [T, "head_num","head_dim"],        GRP_Q_ROPE)

    # ── Query-Hadamard ────────────────────────────────────────────────────────
    op("RESHAPE","RESHAPE",[ctx["hadamard_q_in"]],               "hadamard_q",  "DT_BF16", ["1","head_dim","head_dim"],       GRP_Q_HD)
    op("MATMUL", "A_MUL_B",[ctx["q_concat"],ctx["hadamard_q"]], "q_hadamard",  "DT_BF16", [T,"head_num","head_dim"],         GRP_Q_HD, lbl="Query-Hadamard", sr=S_Q_HADAMARD)

    # ── Query-Quant ───────────────────────────────────────────────────────────
    op("CAST",  "CAST",  [ctx["q_hadamard"]],                    "q_hd_fp32",   "DT_FP32", [T,"head_num","head_dim"],        GRP_Q_QT, lbl="Query-Quant")
    op("ABS",   "ABS",   [ctx["q_hd_fp32"]],                     "q_abs",       "DT_FP32", [T,"head_num","head_dim"],        GRP_Q_QT)
    op("AMAX",  "AMAX",  [ctx["q_abs"]],                         "q_amax",      "DT_FP32", [T,"head_num","1"],               GRP_Q_QT)
    op("FULL",  "FULL",  [],                                      "q_127",       "DT_FP32", [T,"head_num","1"],               GRP_Q_QT)
    op("DIV",   "DIV",   [ctx["q_127"],ctx["q_amax"]],           "q_sq",        "DT_FP32", [T,"head_num","1"],               GRP_Q_QT)
    op("MUL",   "MUL",   [ctx["q_hd_fp32"],ctx["q_sq"]],        "q_qscaled",   "DT_FP32", [T,"head_num","head_dim"],        GRP_Q_QT)
    op("CAST",  "CAST",  [ctx["q_qscaled"]],                     "q_qi32",      "DT_INT32",[T,"head_num","head_dim"],        GRP_Q_QT)
    op("CAST",  "CAST",  [ctx["q_qi32"]],                        "q_qf16",      "DT_FP16", [T,"head_num","head_dim"],        GRP_Q_QT)
    op("CAST",  "CAST",  [ctx["q_qf16"]],                        "q_int8",      "DT_INT8", [T,"head_num","head_dim"],        GRP_Q_QT)
    op("FULL",  "FULL",  [],                                      "q_one",       "DT_FP32", [T,"head_num","1"],               GRP_Q_QT)
    op("DIV",   "DIV",   [ctx["q_one"],ctx["q_sq"]],             "q_deq",       "DT_FP32", [T,"head_num","1"],               GRP_Q_QT)
    op("CAST",  "CAST",  [ctx["q_deq"]],                         "q_scale_fp16","DT_FP16", [T,"head_num","1"],               GRP_Q_QT)
    q_asm  = op("ASSEMBLE","ASSEMBLE",[ctx["q_int8"]],           "q_asm_int8",  "DT_INT8", [T,"head_num","head_dim"],        GRP_Q_QT, lbl="Query-Quant", sr=S_Q_ASM_INT8)
    g.wire(q_asm, out_refs["q_int8_out"])
    qs_asm = op("ASSEMBLE","ASSEMBLE",[ctx["q_scale_fp16"]],     "q_asm_scale", "DT_FP16", [T,"head_num","1"],               GRP_Q_QT, lbl="Query-Quant", sr=S_Q_ASM_SCALE)
    g.wire(qs_asm, out_refs["q_scale_out"])

    # ── Key-Linear ────────────────────────────────────────────────────────────
    op("MATMUL","A_MUL_B",[ctx["x_tile"],ctx["wk"]],             "k_fp32",      "DT_FP32", [T,"head_dim"],                  GRP_K_LIN, lbl="Key-Linear", sr=S_K_MATMUL)

    # ── Key-LayerNorm ─────────────────────────────────────────────────────────
    op("CAST", "CAST",  [ctx["k_fp32"]],                         "ln_x",        "DT_FP32", [T,"head_dim"],       GRP_K_LN, lbl="Key-LayerNorm")
    op("MUL",  "MUL",   [ctx["ln_x"]],                          "ln_xs",       "DT_FP32", [T,"head_dim"],       GRP_K_LN)
    op("SUM",  "SUM",   [ctx["ln_xs"]],                          "ln_mean",     "DT_FP32", [T,"1"],             GRP_K_LN)
    op("SUB",  "SUB",   [ctx["ln_x"],ctx["ln_mean"]],           "ln_diff",     "DT_FP32", [T,"head_dim"],       GRP_K_LN)
    op("MUL",  "MUL",   [ctx["ln_diff"],ctx["ln_diff"]],        "ln_diff2",    "DT_FP32", [T,"head_dim"],       GRP_K_LN)
    op("MUL",  "MUL",   [ctx["ln_diff2"]],                       "ln_var_s",    "DT_FP32", [T,"head_dim"],       GRP_K_LN)
    op("SUM",  "SUM",   [ctx["ln_var_s"]],                       "ln_var",      "DT_FP32", [T,"1"],             GRP_K_LN)
    op("ADD",  "ADD",   [ctx["ln_var"]],                         "ln_var_eps",  "DT_FP32", [T,"1"],             GRP_K_LN)
    op("SQRT", "SQRT",  [ctx["ln_var_eps"]],                     "ln_std",      "DT_FP32", [T,"1"],             GRP_K_LN)
    op("DIV",  "DIV",   [ctx["ln_diff"],ctx["ln_std"]],          "ln_norm",     "DT_FP32", [T,"head_dim"],       GRP_K_LN)
    op("CAST", "CAST",  [ctx["gamma_2d"]],                       "ln_gamma_fp32","DT_FP32",["1","head_dim"],     GRP_K_LN)
    op("CAST", "CAST",  [ctx["beta_2d"]],                        "ln_beta_fp32","DT_FP32", ["1","head_dim"],     GRP_K_LN)
    op("MUL",  "MUL",   [ctx["ln_norm"],ctx["ln_gamma_fp32"]],  "ln_rg",       "DT_FP32", [T,"head_dim"],       GRP_K_LN)
    op("ADD",  "ADD",   [ctx["ln_rg"],ctx["ln_beta_fp32"]],      "ln_rgb",      "DT_FP32", [T,"head_dim"],       GRP_K_LN)
    op("CAST", "CAST",  [ctx["ln_rgb"]],                         "k_bf16",      "DT_BF16", [T,"head_dim"],       GRP_K_LN)

    # ── Key-Rope2D ────────────────────────────────────────────────────────────
    op("VIEW",   "VIEW",   [ctx["k_bf16"]],                      "k_rope_slice","DT_BF16", [T,"rope_head_dim"],              GRP_K_ROPE)
    op("VIEW",   "VIEW",   [ctx["k_bf16"]],                      "k_nope_slice","DT_BF16", [T,"head_dim-rope_head_dim"],     GRP_K_ROPE)
    op("CAST",   "CAST",   [ctx["rope_cos"]],                    "k_cos_fp32",  "DT_FP32", [T,"rope_head_dim"],              GRP_K_ROPE, lbl="Key-Rope2D")
    op("CAST",   "CAST",   [ctx["rope_sin"]],                    "k_sin_fp32",  "DT_FP32", [T,"rope_head_dim"],              GRP_K_ROPE)
    op("CAST",   "CAST",   [ctx["k_rope_slice"]],                "k_rope_fp32", "DT_FP32", [T,"rope_head_dim"],              GRP_K_ROPE)
    op("VIEW",   "VIEW",   [ctx["k_rope_fp32"]],                 "k_rh_x1",     "DT_FP32", [T,"rope_head_dim//2"],           GRP_K_ROPE)
    op("VIEW",   "VIEW",   [ctx["k_rope_fp32"]],                 "k_rh_x2",     "DT_FP32", [T,"rope_head_dim//2"],           GRP_K_ROPE)
    op("MUL",    "MUL",    [ctx["k_rh_x2"]],                    "k_rh_neg",    "DT_FP32", [T,"rope_head_dim//2"],           GRP_K_ROPE)
    op("CONCAT", "CONCAT", [ctx["k_rh_neg"],ctx["k_rh_x1"]],    "k_rh",        "DT_FP32", [T,"rope_head_dim"],              GRP_K_ROPE)
    op("MUL",    "MUL",    [ctx["k_rope_fp32"],ctx["k_cos_fp32"]],"k_x_cos",   "DT_FP32", [T,"rope_head_dim"],              GRP_K_ROPE)
    op("MUL",    "MUL",    [ctx["k_rh"],ctx["k_sin_fp32"]],      "k_rh_sin",   "DT_FP32", [T,"rope_head_dim"],              GRP_K_ROPE)
    op("ADD",    "ADD",    [ctx["k_x_cos"],ctx["k_rh_sin"]],     "k_embed",     "DT_FP32", [T,"rope_head_dim"],              GRP_K_ROPE)
    op("CAST",   "CAST",   [ctx["k_embed"]],                     "k_roped",     "DT_BF16", [T,"rope_head_dim"],              GRP_K_ROPE)
    op("CAST",   "CAST",   [ctx["k_nope_slice"]],                "k_nope_fp32", "DT_FP32", [T,"head_dim-rope_head_dim"],     GRP_K_ROPE)
    op("CAST",   "CAST",   [ctx["k_nope_fp32"]],                 "k_nope_bf16", "DT_BF16", [T,"head_dim-rope_head_dim"],     GRP_K_ROPE)
    op("CONCAT", "CONCAT", [ctx["k_roped"],ctx["k_nope_bf16"]], "k_concat",    "DT_BF16", [T,"head_dim"],                  GRP_K_ROPE)

    # ── Key-Hadamard ──────────────────────────────────────────────────────────
    op("MATMUL","A_MUL_B",[ctx["k_concat"],ctx["hadamard_k_in"]],"hadamard_k", "DT_BF16", [T,"head_dim"],       GRP_K_HD, lbl="Key-Hadamard", sr=S_K_HADAMARD)

    # ── Key-Quant ─────────────────────────────────────────────────────────────
    op("CAST",  "CAST",  [ctx["hadamard_k"]],                    "k_hd_fp32",   "DT_FP32", [T,"head_dim"],   GRP_K_QT, lbl="Key-Quant")
    op("ABS",   "ABS",   [ctx["k_hd_fp32"]],                     "k_abs",       "DT_FP32", [T,"head_dim"],   GRP_K_QT)
    op("AMAX",  "AMAX",  [ctx["k_abs"]],                         "k_amax",      "DT_FP32", [T,"1"],         GRP_K_QT)
    op("FULL",  "FULL",  [],                                      "k_127",       "DT_FP32", [T,"1"],         GRP_K_QT)
    op("DIV",   "DIV",   [ctx["k_127"],ctx["k_amax"]],           "k_sq",        "DT_FP32", [T,"1"],         GRP_K_QT)
    op("MUL",   "MUL",   [ctx["k_hd_fp32"],ctx["k_sq"]],        "k_qscaled",   "DT_FP32", [T,"head_dim"],   GRP_K_QT)
    op("CAST",  "CAST",  [ctx["k_qscaled"]],                     "k_qi32",      "DT_INT32",[T,"head_dim"],   GRP_K_QT)
    op("CAST",  "CAST",  [ctx["k_qi32"]],                        "k_qf16",      "DT_FP16", [T,"head_dim"],   GRP_K_QT)
    op("CAST",  "CAST",  [ctx["k_qf16"]],                        "k_int8",      "DT_INT8", [T,"head_dim"],   GRP_K_QT)
    op("FULL",  "FULL",  [],                                      "k_one",       "DT_FP32", [T,"1"],         GRP_K_QT)
    op("DIV",   "DIV",   [ctx["k_one"],ctx["k_sq"]],             "k_deq",       "DT_FP32", [T,"1"],         GRP_K_QT)
    op("CAST",  "CAST",  [ctx["k_deq"]],                         "k_scale_fp16","DT_FP16", [T,"1"],         GRP_K_QT)

    # ── Key-ScatterUpdate ─────────────────────────────────────────────────────
    op("RESHAPE","RESHAPE",[ctx["k_int8"]],                      "k_cache_4d",  "DT_INT8", [T,"1","1","head_dim"],    GRP_K_SC)
    op("RESHAPE","RESHAPE",[ctx["k_scale_fp16"]],                "k_scale_4d",  "DT_FP16", [T,"1","1","1"],           GRP_K_SC)
    op("VIEW",   "VIEW",  [ctx["k_cache_index"]],                "k_idx_tile",  "DT_INT64",[T,"1"],                   GRP_K_SC)
    k_sc  = op("SCATTER_UPDATE","SCATTER_UPDATE",
               [ctx["k_cache"], ctx["k_idx_tile"], ctx["k_cache_4d"]],
               "k_sc_int8", "DT_INT8", ["blockNum","blockSize","nKv","head_dim"],
               GRP_K_SC, lbl="Key-Quant", sr=S_K_SCATTER_INT8)
    g.wire(k_sc, out_refs["k_int8_out"])
    ks_sc = op("SCATTER_UPDATE","SCATTER_UPDATE",
               [ctx["k_cache_scale"], ctx["k_idx_tile"], ctx["k_scale_4d"]],
               "k_sc_scale", "DT_FP16", ["blockNum","blockSize","nKv","1"],
               GRP_K_SC, lbl="Key-Quant", sr=S_K_SCATTER_SCL)
    g.wire(ks_sc, out_refs["k_scale_out"])

    # ── Weight 支路 ────────────────────────────────────────────────────────────
    op("MATMUL","A_MUL_B",[ctx["x_tile"],ctx["w_proj"]],         "w_fp32",      "DT_FP32", [T,"head_num"],  GRP_W, lbl="Weight-Linear", sr=S_W_MATMUL)
    op("MUL",   "MUL",   [ctx["w_fp32"]],                        "w_scaled",    "DT_FP32", [T,"head_num"],  GRP_W, lbl="Weight-Linear")
    op("CAST",  "CAST",  [ctx["w_scaled"]],                      "w_f16",       "DT_FP16", [T,"head_num"],  GRP_W)
    w_asm = op("ASSEMBLE","ASSEMBLE",[ctx["w_f16"]],             "w_asm",       "DT_FP16", [T,"head_num"],  GRP_W, lbl="Weight-Linear", sr=S_W_ASSEMBLE)
    g.wire(w_asm, out_refs["weights_out"])


# ──────────────────────────────────────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────────────────────────────────────

def main():
    g = IRGraph("lightning_indexer_prolog_quant · Initial IR")
    build_ir(g)
    result = g.to_dict()

    out_path = Path(__file__).parent.parent / "data" / "source-graph.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    groups  = sum(1 for n in result["nodes"] if n["type"] == "Group")
    ops     = sum(1 for n in result["nodes"] if n["type"] == "Operation")
    tensors = sum(1 for n in result["nodes"] if n["type"] == "Tensor")
    incasts = sum(1 for n in result["nodes"] if n["type"] == "Incast")
    outs    = sum(1 for n in result["nodes"] if n["type"] == "Outcast")
    print(f"[compile_to_ir_json] {out_path}")
    print(f"  groups={groups}  ops={ops}  tensors={tensors}  "
          f"incasts={incasts}  outcasts={outs}  edges={len(result['edges'])}")
    return result


if __name__ == "__main__":
    main()

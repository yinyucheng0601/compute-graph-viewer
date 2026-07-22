# Source provenance

The report uses two independent fact layers.

## Full-source architecture

The canonical architecture is extracted from immutable local snapshots of:

| Source | Locked revision | Role |
|---|---|---|
| `yinyucheng0601/ui-json` runtime source | `f6262f5b95e32a2a66e38314b6c7b035d51ea49d` | Source used for backend node mapping, MTP implementation, runner loop, and MTP3 runtime config |
| `deepseek-ai/DeepSeek-V3.2-Exp` | `87e509a2e5a100d221c97df52c6e8be7835f0057` | Official inference model and `config_671B_v3.2.json` |
| `huggingface/transformers` DeepSeek V3.2 implementation | `9a0fe3f5dd36ffe1888133f09eb03f1eb14b8a6e` | Independent official model-class cross-check |

`outputs/model-source-manifest.json` records the repositories, immutable commits, file roles, and SHA-256 hashes. `outputs/model_architecture.json` has `extraction_scope.kind = full_source`; it defines the 61-layer main model, the MTP output path, source-validated Module/Op/State nodes, repeats, branches, and tensor edges with per-item provenance.

The source verification state is `runtime_source_locked`. This verifies source structure against the supplied backend repository revision; it does not claim that every compiler-generated profiler op is a learned model module.

MTP is verified by `DeepseekV3ModelMTPLayer` and `DeepseekV3ModelMTP`. `configuration_deepseek.py` defines one next-token prediction layer at model layer index 61. `model_infer.py` and the locked MTP3 YAML define `next_n: 3`, so one learned MTP module is executed for three runtime prediction iterations. `infer.py` explicitly shares the main model embedding, rotary embedding, and LM head with MTP.

The only remaining backend trace detail without an equivalent canonical model role is MTP preprocessing `weight_allgather`. It remains attached inside MTP preprocessing as interactive runner scaffolding. It is not placed in a separate architecture section and is not counted as another learned MTP layer.

## Backend performance overlay

| Runtime input | Responsibility |
|---|---|
| `ds3_2_analysis_config.json` | Stable backend node IDs, semantic paths, observed instances, runtime auxiliary |
| `ds3_2_perf_data.json` | Representative-step metrics and operator ratios keyed by backend node ID |
| `ds3_2_timeline.json` | Raw event start/end times, lane identity, and optional owner node ID |

`outputs/backend_trace_overlay.json` preserves this layer as `trace_slice`. `outputs/architecture_overlay_map.json` classifies every one of the 88 backend nodes as a source mapping, the single runner trace detail, or runtime auxiliary and records that one implementation distinction. Aggregate mappings activate only their mapped container; metrics are never propagated to source-only descendants.

`outputs/model_architecture_graph.json` is the hybrid renderer input. Source-only nodes are visible but dim and nonselectable. Mapped and extension nodes retain their backend IDs through explicit mapping and are the only graph items that can open backend Inspector data.

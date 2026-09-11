# openPangu-2.0-Flash architecture validation

Status: PASS  
Asset: `openpangu-2.0-flash/source-architecture` v1  
Architecture hash: `23a60d30297eb6a66e874aa7a7b7a159d7366d74647a331018e44ef1163ebd2b`  
Graph hash: `51a92c18b9b7fd403c17e9eb4c41ef67a6e9f45367bea379ed197443280f8117`

## Verified facts

- 46 decoder layers; Dense layers 0-1 and MoE layers 2-45.
- Routed Experts is a parent Module with 256 addressable logical children, `E000` through `E255`.
- Physical expert identity, owner Global Rank, and EP Rank remain runtime-overlay fields.
- mHC pre/post state flow carries `residual`, `h_post`, and `h_res` explicitly. The ordinary Add residual branch is marked `use_mhc=false`.
- Q/KV/O MoME local residuals are distinct `residual` edges.
- AllReduce, AllGather/ReduceScatter, All-to-All-v, Dispatch/Combine, and fused paths are source-declared, mutually exclusive runtime strategies. No strategy is activated by the static architecture asset.

## Counts

| Check | Count |
| --- | ---: |
| Canonical nodes | 345 |
| Graph hierarchy items | 346 |
| Semantic edges | 103 |
| Logical expert children | 256 |
| mHC residual-state edges | 4 |
| MoE communication strategies | 5 |

## Source fingerprints

| Source | Repository-relative path | SHA-256 prefix |
| --- | --- | --- |
| `runtime_config` | `model-architecture/sources/openPangu-2.0-Flash/config.json` | `af58889e31ec` |
| `hf_config_class` | `model-architecture/sources/openPangu-2.0-Flash/configuration_openpangu_v2.py` | `a1a7ef8b8bb3` |
| `model_impl` | `model-architecture/sources/openPangu-2.0-Infer/components/omni-npu/src/omni_npu/v1/models/pangu/pangu_v2_moe.py` | `bc165fc4bb9b` |
| `attention_impl` | `model-architecture/sources/openPangu-2.0-Infer/components/omni-npu/src/omni_npu/v1/layers/attention/npu_pangu.py` | `ae4d897cc743` |
| `mtp_impl` | `model-architecture/sources/openPangu-2.0-Infer/components/omni-npu/src/omni_npu/v1/models/pangu/pangu_v2_moe_mtp.py` | `863aad6d829d` |
| `moe_impl` | `model-architecture/sources/openPangu-2.0-Infer/components/omni-npu/src/omni_npu/layers/fused_moe/layer.py` | `b3631382c6e0` |
| `model_card` | `model-architecture/sources/openPangu-2.0-Flash/README.md` | `cd44291b6ee3` |

## Boundary

This is a source/config-checked architecture artifact. It is not profiling evidence. Timeline data selects a runtime communication branch and supplies Expert placement and load overlays by canonical ID.

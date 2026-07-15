# openPangu-2.0-Flash Architecture Validation

## Scope

- Scope kind: `full_source`
- Main decoder layers: `46`
- Profiling trace: not used.
- Full 92B weights: not downloaded. The local model checkout keeps Git LFS pointer files only.

## Source Roots

- Runtime config: `/Users/yin/pto/model-architecture/sources/openPangu-2.0-Flash/config.json`
- Main model source: `/Users/yin/pto/model-architecture/sources/openPangu-2.0-Infer/components/omni-npu/src/omni_npu/v1/models/pangu/pangu_v2_moe.py`
- Attention source: `/Users/yin/pto/model-architecture/sources/openPangu-2.0-Infer/components/omni-npu/src/omni_npu/v1/layers/attention/npu_pangu.py`
- MTP source: `/Users/yin/pto/model-architecture/sources/openPangu-2.0-Infer/components/omni-npu/src/omni_npu/v1/models/pangu/pangu_v2_moe_mtp.py`
- MoE support source: `/Users/yin/pto/model-architecture/sources/openPangu-2.0-Infer/components/omni-npu/src/omni_npu/layers/fused_moe/layer.py`

## Confirmed Runtime Facts

- Hidden size `H=2560`
- Vocabulary `V=151552`
- Attention heads `N_h=48`
- Main layers `L=46`
- Main context limit `S_max=524288`
- MLA ranks `R_q=1024`, `R_kv=512`
- MoE routed expert symbol `E=256`, routing `top_k=8`, shared expert symbol `E_shared=1`
- mHC streams `S_mhc=4`
- MTP layer symbol `N_mtp=3`

## Source Checks

- `OpenPanguV2Model` owns embedding, repeated decoder layers, final norm, and cached RoPE tensors.
- `OpenPanguV2DecoderLayer` owns mHC branches, `NPUPanguSparseAttention`, FFN selection, RMSNorm stack, and optional block post norm.
- `NPUPanguSparseAttention` owns MLA projections, RoPE, param sink state, DSA/SWA attention selection, and MoME state.
- `OpenPanguV2MOE` owns router gate, shared expert MLP, fused routed expert bank, and expert-parallel runtime state.
- `OpenPanguV2MTP` owns the multi-token prediction branch and reuses `OpenPanguV2DecoderLayer`.

## Notes

- `swa_layers` contains `46,47,48`; these line up with the three MTP layers beyond the main decoder range and are treated separately in the graph.
- Dense FFN applies to layers `0-1`; MoE FFN applies to layers `2-45`.

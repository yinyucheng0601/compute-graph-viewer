# GLM-4.5 IFA pass-ir sample

Source dump: `/Users/yin/gitcode/output_glm4.5_attention`

This sample keeps the page payload small while still using real PyPTO dump JSON. It is the repo-local fallback used by `pass-ir/explain.html` when the generated root `nav_index.json` is not available, for example on GitHub Pages.

- `Pass_04_ExpandFunction/After_004_ExpandFunction_TENSOR_LOOP_s2_Unroll1_PATH3_56.json`: P04 After, the TensorGraph tail frame.
- `Pass_05_MergeViewAssemble/Before_005_MergeViewAssemble_TENSOR_LOOP_s2_Unroll1_PATH3_56.json`: P05 Before, used for the rule explanation pair.
- `Pass_05_MergeViewAssemble/After_005_MergeViewAssemble_TENSOR_LOOP_s2_Unroll1_PATH3_56.json`: P05 After, the MergeViewAssemble result frame.
- `Pass_06_SplitReshape/After_006_SplitReshape_TENSOR_LOOP_s2_Unroll1_PATH3_56.json`: P06 After, the next TileGraph frame.
- `focused-nav-index.json`: compact index for the P04/P05/P06 playback sequence.

The focused pair is `MergeViewAssemble` on `TENSOR_LOOP_s2_Unroll1_PATH3_hiddenfunc0_56`. Its `Before_005` graph is the TensorGraph-stage tail graph carried into the first Tile-stage pass; its `After_005` graph shows the first Tile pass rewrite. The visible pass playback is `P04 After -> P05 After -> P06 After`.

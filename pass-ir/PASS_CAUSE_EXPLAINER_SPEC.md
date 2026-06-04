# Pass-IR Pass Cause Explainer Lightweight Spec

## 1. Scope

This spec implements the first engineering slice of `PASS_CAUSE_EXPLAINER_PRD.md`: explain why a PyPTO Pass changed a graph by combining Before/After JSON diff with source-derived Pass rules.

Current implementation target:

- Use a standalone page: `/Users/yin/pto/pass-ir/explain.html`.
- Do not modify the original `pass-ir/index.html`, `js/app.js`, `js/nav.js`, or `js/parser.js`.
- Parse all pass pairs that can be discovered from the selected dump folder.
- Use rule-tier explanations for the first high-value structural passes.
- Use source-schema plus diff-group explanations for every other known pass.
- Keep unknown changes explicit as `unexplained`.

Rule-tier Pass coverage:

- `RemoveRedundantReshape`
- `DuplicateOp`
- `MergeViewAssemble`
- `RemoveRedundantOp`

These are not four consecutive pipeline passes. They are selected because they cover the MVP behavior classes:

- `RemoveRedundantReshape`: removal and consumer rewiring.
- `DuplicateOp`: fan-out split and cloned op/tensor creation.
- `MergeViewAssemble`: view/assemble chain merge and offset update.
- `RemoveRedundantOp`: redundant op cleanup plus view/assemble perfect-match and partial-match rewrites.

Schema/diff-tier Pass coverage:

- All entries in `PASS_SOURCE_SCHEMA`, currently 47 source-derived pass/pass-like records.
- `/Users/yin/gitcode/output_deepseek` validation currently parses 38 dump pass directories, 1000 pair records, and 926 ready pairs.
- `SplitReshape` is a rule-tier candidate but may fall back to schema/diff if specific evidence is incomplete.

Confirmed UX decisions:

- Explain panel is closed before a pair is selected or auto-loaded; once a valid pair is active, it opens by default and remains manually collapsible.
- Default explanation level is engineering explanation with concise summary first.
- Source-level explanation is available through explicit expand/open action, not as the default panel content.
- Playback uses rule-hit narrative: one explanation equals one timeline step, and that step highlights affected nodes and edges.
- The right panel shows timeline steps for the currently selected `pass + function + PATH + snapshot` pair. It is not the global pass list.
- MVP source entry shows file/function and supports copy path. Editor jump is deferred.
- First version is optimized for PyPTO operator developer debugging, not presentation-only demo mode.

Non-goals for MVP:

- Do not parse C++ AST.
- Do not depend on pass `.log` files; sampled logs are empty.
- Do not infer a fake cause for unexplained changes.
- Do not replace the existing Pass-IR renderer, parser, navigation, or Locked Flow.
- Do not redesign graph node, playback, or inspector visual language.

## 2. Existing Integration Points

Current `pass-ir/explain.html` consumes shared modules from `/Users/yin/pto/js`:

- `parser.js`: parses PyPTO JSON into graph model.
- `layout.js`: computes graph layout.
- `renderer.js`: renders graph nodes and edges.
- `nav_index_builder.js`: builds pass navigation data from local directory entries.

The standalone explainer intentionally does not load:

- `app.js`
- `nav.js`
- `controlflow.js`

This keeps the page focused on pass-cause debugging and avoids original Pass-IR controls that are not part of this product goal.

## 3. New Files

Implementation files under `/Users/yin/pto/js`:

| File | Responsibility |
|---|---|
| `pass_cause_source_schema.js` | Source-derived metadata for all known PyPTO passes, including coverage tier, source file/function, rewrite targets, and narrative template |
| `pass_cause_dump_schema.js` | Parse dump directory/file names and enrich pair metadata with runtime index, PATH, target kind, snapshot key, and source schema |
| `pass_cause_semantic.js` | Reuse original Pass-IR semantic pipeline coloring for standalone page, including Key/Query/Weight lane hues |
| `pass_cause_pairs.js` | Build and resolve Before/After pass pairs from nav index and local file entries |
| `pass_cause_diff.js` | Compute graph-level diff and rewiring signals |
| `pass_cause_rules.js` | Hold source-derived Pass rule metadata and matchers |
| `pass_cause_explainer.js` | Run rules against diff context and produce explanations |
| `pass_cause_panel.js` | Render and update the right-side cause panel |
| `pass_cause_playback.js` | Own timeline interpolation state and integrate floating playback control |
| `pass_cause_standalone.js` | Own standalone page state, folder loading, pass/pair selectors, graph rendering, side switching, color mode, and autostart |

Add these scripts to `pass-ir/explain.html`. Do not add them to the original `pass-ir/index.html` unless a future integration explicitly requires it.

## 4. Data Models

### 4.1 PassPair

```js
{
  id: "013:RemoveRedundantOp:TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4:main",
  passIndex: 13,
  passName: "RemoveRedundantOp",
  stage: "Tile",
  functionName: "TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4",
  pathId: "RESHAPE",
  snapshotKey: "main",
  beforeRef: {
    fileName: "Before_013_RemoveRedundantOp_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json",
    filePath: "Pass_13_RemoveRedundantOp/Before_013_RemoveRedundantOp_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json",
    source: "directory"
  },
  afterRef: {
    fileName: "After_013_RemoveRedundantOp_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json",
    filePath: "Pass_13_RemoveRedundantOp/After_013_RemoveRedundantOp_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json",
    source: "directory"
  },
  inferredBefore: false,
  status: "ready" // ready | missing-before | missing-after | inferred-before | unsupported
}
```

Current standalone behavior:

- `state.pairs` keeps all parsed pairs, including missing states.
- `readyPairs()` filters only `status === "ready"` for selectable playback.
- Missing pairs remain visible in coverage counts but are not explainable.
- Inferred-before is a future option; current standalone marks absent Before as `missing-before`.

### 4.2 GraphIdentity

Use stable ids where available:

- Operation id: `op:<opmagic>`
- Tensor id: `tensor:<magic>`
- Incast / outcast id: existing parsed node id from `parser.js`
- Edge id: `<sourceId>-><targetId>`

Fallback signature for unstable ids:

```js
{
  kind: "op" | "tensor",
  opcode,
  shape,
  rawtensor,
  ioperands,
  ooperands,
  nodetype
}
```

MVP uses magic/opmagic as identity. Fallback signatures are only used to label a change as `possible-rename`, not to merge identities automatically.

### 4.3 GraphDiff

```js
{
  pairId,
  beforeGraph,
  afterGraph,
  nodes: {
    added: [],
    removed: [],
    modified: [],
    same: []
  },
  edges: {
    added: [],
    removed: [],
    same: []
  },
  rewires: [
    {
      type: "rewired-input",
      consumerOpId,
      beforeInputTensorId,
      afterInputTensorId,
      evidence: {}
    }
  ],
  stats: {
    addedNodes,
    removedNodes,
    modifiedNodes,
    addedEdges,
    removedEdges,
    rewires
  }
}
```

Modified node comparison fields:

- op: `opcode`, `ioperands`, `ooperands`, `latency`, `semantic_label`, `op_attr`
- tensor: `shape`, `validshape`, `dynvalidshape`, `offset`, `rawtensor`, `nodetype`, `mem.type`

### 4.4 CauseRule

```js
{
  id: "remove-redundant-reshape.rewire-consumers",
  passName: "RemoveRedundantReshape",
  source: {
    file: "/Users/yin/gitcode/pypto-master/framework/src/passes/tensor_graph_pass/remove_redundant_reshape.cpp",
    functions: ["RunOnFunction", "RemoveReshape"]
  },
  summary: "Delete redundant OP_RESHAPE and rewire consumers to the reshape input tensor.",
  match(context) { return []; },
  explain(match, context) { return CauseExplanation; }
}
```

### 4.5 CauseExplanation

```js
{
  id,
  pairId,
  ruleId,
  passName,
  title,
  summary,
  confidence: "source-rule matched" | "diff-inferred" | "unexplained",
  changeType: "removed-op" | "added-op" | "rewired-input" | "merged-chain" | "split-fanout" | "offset-updated" | "unexplained",
  nodeIds: [],
  edgeIds: [],
  evidence: [
    { label: "Removed op", value: "OP_RESHAPE 10005" },
    { label: "Input tensor", value: "tensor:4" },
    { label: "Output tensor", value: "tensor:8" }
  ],
  source: {
    file,
    functions
  },
  before: {
    graphRef,
    primaryNodeIds,
    edgeIds,
    badges,
    dimOthers
  },
  after: {
    graphRef,
    primaryNodeIds,
    edgeIds,
    badges,
    dimOthers
  },
  transition: {
    type,
    fromNodeIds,
    toNodeIds,
    removedEdgeIds,
    addedEdgeIds,
    durationMs
  },
  counts: {
    removedOps,
    removedTensors,
    removedEdges,
    addedOps,
    addedTensors,
    rewiredEdges,
    fieldChanges,
    netNodes
  }
}
```

## 5. Pair Builder

`pass_cause_pairs.js` exports:

```js
window.PtoPassCausePairs = {
  buildPairsFromEntries(entries, navIndex),
  buildPairsFromNavIndex(navIndex),
  resolvePair({ passIndex, passName, pathId, snapshotKey, side }),
  getPairCoverage(pairs)
};
```

Pair building rules:

- Match pass directories with `Pass_<index>_<PassName>`.
- Match files with `Before_<index>_<PassName>_*.json` and `After_<index>_<PassName>_*.json`.
- Pair files by `passIndex`, `passName`, `functionName`, `pathId`, `snapshotKey`.
- `snapshotKey` defaults to `main` when no ROOT/LEAF marker exists.
- Prefer exact Before/After in the same pass directory.
- If Before is absent, mark `missing-before` in the current standalone page. Optional inferred-before support is deferred.
- If After is absent, mark `missing-after`; do not run explainer.

## 6. Diff Engine

`pass_cause_diff.js` exports:

```js
window.PtoPassCauseDiff = {
  buildRawGraphIndex(rawJson),
  diffRawGraphs(beforeJson, afterJson),
  classifyRewires(beforeIndex, afterIndex),
  toRenderableDiff(diff, parsedBeforeGraph, parsedAfterGraph)
};
```

Implementation notes:

- Diff should operate on raw PyPTO JSON first, because raw `operations`, `tensors`, `ioperands`, and `ooperands` are needed for cause matching.
- Parsed graph models from `parser.js` are used for rendering and node lookup.
- Rewire detection compares each common op's `ioperands` and `ooperands`.
- Edge changes are derived from raw op operands and then mapped to parsed graph node ids.
- Keep all unexplained changes in the diff output; do not drop them.

## 7. Rule Matchers

### 7.1 RemoveRedundantReshape

Source: `remove_redundant_reshape.cpp`.

Rules:

- Match removed op where `opcode === "RESHAPE"` or `opcode === "OP_RESHAPE"`.
- Check removed op had exactly one input and one output in Before.
- Check output tensor consumers in Before are now connected to input tensor in After.
- Explanation type: `removed-op` + `rewired-input`.

Confidence:

- `source-rule matched` when removed reshape and consumer rewire are both observed.
- `diff-inferred` when removed reshape is observed but consumer rewire cannot be proven from After.

### 7.2 DuplicateOp

Source: `duplicate_op.cpp`.

Rules:

- Match added `VIEW` whose input tensor equals an existing Before `VIEW` input and whose output tensor is new.
- Match added `GATHER_IN_L1` using the same input operands as a Before `GATHER_IN_L1`.
- Check Before source output tensor had more than one non-view consumer.
- Explanation type: `split-fanout` + `added-op`.

Confidence:

- `source-rule matched` when fan-out count and added clone op both match.
- `diff-inferred` when added op resembles a clone but fan-out cannot be proven.

### 7.3 MergeViewAssemble

Source: `merge_view_assemble.cpp` and `merge_view_assemble_utils.cpp`.

Rules:

- Match removed chain of two or more `VIEW` ops with one added or modified `VIEW`.
- Match removed chain of two or more `ASSEMBLE` ops with one added or modified `ASSEMBLE`.
- Compare offset/dyn offset where available.
- Explanation type: `merged-chain` + `offset-updated`.

Confidence:

- `source-rule matched` when removed chain and replacement op are both found.
- `diff-inferred` when multiple removed view/assemble ops exist but replacement cannot be uniquely identified.

### 7.4 RemoveRedundantOp

Source: `remove_redundant_op.cpp`.

Rules:

- Match removed `VIEW`, `EXPAND`, `REGISTER_COPY`, or `ASSEMBLE` where input/output shape and memory type are equal.
- Match removed `RESHAPE` with equal input/output shape or reshape-only consumers.
- Match `VIEW -> ASSEMBLE` perfect match:
  - view input tensor and assemble output tensor have same shape, same offset, same memory type.
  - consumers are rewired from assemble output to view input.
- Match partial match:
  - original `VIEW -> ASSEMBLE` chain removed.
  - new `VIEW` added from original start tensor to a replacement output.
  - explanation should mention generated new view.

Confidence:

- `source-rule matched` when shape/memory predicate and rewire/new view are observed.
- `diff-inferred` when only removal is observed.

### 7.5 SplitReshape Stretch

Source: `split_reshape.cpp`.

Rules are complex and should start as coarse explanations:

- Match removed reshape plus added view/assemble/reshape nodes around same raw tensor.
- Classify as one of `one-to-one`, `one-to-multi`, `multi-to-one`, `perfectly-match` only if evidence is clear.
- Otherwise mark `diff-inferred`.

## 8. Explainer Pipeline

`pass_cause_explainer.js` exports:

```js
window.PtoPassCauseExplainer = {
  explainPair({ pair, beforeJson, afterJson, parsedBeforeGraph, parsedAfterGraph }),
  explainDiff({ pair, diff, rules }),
  getExplanationsForNode(nodeId),
  getCoverage(explanations, diff)
};
```

Pipeline:

1. Build raw before/after indexes.
2. Compute raw diff.
3. Select rules by `pair.passName`.
4. Run rule matchers.
5. Mark matched diff entities as explained.
6. Generate `unexplained` explanations for remaining added/removed/modified/rewired entities.
7. Return explanations, coverage, and renderable diff state.

For non-rule-tier passes:

1. Load source schema by normalized pass name.
2. Build diff groups such as `remove-chain`, `add-chain`, and `field-update`.
3. Generate schema-driven steps from those groups.
4. Attach source file/function and narrative template.
5. Keep remaining changes as `unexplained`.

## 9. UI State

Standalone state lives in `pass_cause_standalone.js`:

```js
const passCauseState = {
  navIndex: null,
  pairs: [],
  pairResults: new Map(),
  activePairId: null,
  activeResult: null,
  beforeGraph: null,
  afterGraph: null,
  currentSide: "after",
  colorMode: "semantic"
};
```

State transitions:

- Folder loaded -> build pair index.
- Pass filter selected -> rebuild pair selector for that pass.
- Pair selected -> resolve active pair.
- Active pair ready -> load both JSON files, run diff/explainer.
- Active pair chosen -> render initial Before or After scene and cause panel.
- Timeline step selected -> load side-specific graph and highlight explanation nodes/edges.
- Explanation selected -> select related graph nodes and optionally center.
- Node selected -> show node detail plus related explanations.

## 10. UI Rendering

### 10.1 Cause Panel

`pass_cause_panel.js` exports:

```js
window.PtoPassCausePanel = {
  mount(root, options),
  render({ pair, explanations, coverage, selectedExplanationId }),
  selectExplanation(id),
  destroy()
};
```

Panel sections:

- Pass summary
- Concise current conclusion
- Graph-level net diff counts
- Pipeline/source coverage note
- Coverage
- Source rule
- Source-level detail disclosure
- Matched explanations
- Unexplained changes

Important panel semantics:

- The panel is scoped to the active pair, not to the pass class globally.
- Multiple rows in the panel are explanation steps for the active pair.
- When the user changes the Pass filter or Pair selector, the panel is replaced with the new pair's result.

Use existing PTO classes:

- `.panel-shell`
- `.inspector-rail`
- `.inspector-section`
- `.inspector-soft-card`
- `.badge`
- `.btn`

### 10.2 Graph Overlay

Renderer integration should not rewrite node cards.

Allowed additions:

- data attributes on rendered nodes, such as `data-diff-state`.
- CSS classes for data-viz state, such as `.is-diff-added`, `.is-diff-removed`, `.is-diff-explained`.
- edge state classes for added/removed/rewired.

Data-viz colors must be documented in code comments or constants.

### 10.3 Playback

Playback should follow the floating playback design-system constraints. The current standalone page uses PTO floating playback tokens/classes and a focused local controller.

`pass_cause_playback.js` owns:

- create/init control
- play/pause
- scrubber change
- hover label
- sync to `passCauseState.playbackT`

It must not recreate floating playback chrome.

Split-side playback behavior:

- For deletion/rewire steps, first show Before and highlight removed nodes/edges.
- Then show After and highlight replacement or rewired nodes/edges.
- Removed objects that cannot exist in After are represented through count chips/ghost tray, not fake After nodes.
- After view dims unchanged elements, but semantic colors remain readable.

## 11. Integration With Existing Navigation

The standalone page does not couple to `nav.js`. It uses `nav_index_builder.js` to build the same pass/path/snapshot data model from local folder entries, then owns independent pass and pair selectors.

Future integration with the original page should use an event bridge rather than coupling explainer directly to nav internals.

Recommended events:

```js
window.dispatchEvent(new CustomEvent("pto-pass-ir:pass-selected", {
  detail: { passIndex, passName, pathId, snapshotKey, side, fileRef }
}));

window.dispatchEvent(new CustomEvent("pto-pass-ir:folder-index-ready", {
  detail: { navIndex, entries, sourceLabel }
}));
```

In a future embedded integration, the explainer should listen to these events and update pair state.

## 12. Implementation Order

1. Create standalone page `pass-ir/explain.html`.
2. Add pass pair, dump schema, source schema, diff, rules, explainer, panel, playback, semantic, and standalone controller files.
3. Load local folder through `showDirectoryPicker` or directory file input.
4. Parse all pass/pair records and show pass-level coverage.
5. Auto-start with a structural pair, prioritizing `RemoveRedundantOp / PATH0_6`.
6. Render active pair graph with default Semantic color mode.
7. Populate right panel with active pair explanation steps.
8. Use split-side playback for remove/rewire explanations.
9. Keep original Pass-IR page unchanged.

## 13. Validation Data

Primary fixture root:

```text
/Users/yin/gitcode/output_deepseek
```

Required validation pairs:

- `Pass_00_RemoveRedundantReshape`
- `Pass_05_DuplicateOp`
- `Pass_06_MergeViewAssemble`
- `Pass_13_RemoveRedundantOp`

Use `MAIN x32 / PATH0_6` first for structural-change playback where available. `TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4` remains useful for reshape-specific validation.

These validation passes are intentionally non-contiguous in the real `output_deepseek` sequence.

Current count validation:

```text
source schema: 47
dump passes: 38
total pairs: 1000
ready pairs: 926
ready pass names: 36
```

Current semantic validation:

```text
Key    -> purple family
Query  -> blue family
Weight -> cyan family
```

## 14. Acceptance Checks

- Pair builder finds ready pairs for the required validation passes.
- Pass filter shows all parsed dump passes, not only rule-tier passes.
- Coverage label reports source schema count, dump pass count, ready pass count, and ready pair count.
- Diff engine reports added/removed/modified/rewired entities without throwing on missing optional fields.
- `RemoveRedundantReshape` explanation identifies removed reshape nodes and linked rewire evidence where present.
- `DuplicateOp` explanation identifies added clone view/gather nodes and original fan-out evidence where present.
- Cause panel shows coverage and does not hide unexplained changes.
- Cause panel rows are scoped to the current pair's explanation steps.
- Selecting an explanation highlights relevant graph nodes.
- Selecting a graph node surfaces related explanations in detail context.
- Playback scrubber moves graph state without breaking pan/zoom/detail behavior.
- No new private button/card/badge visual system is introduced.
- Semantic color mode preserves original Pass-IR Key/Query/Weight lane colors.
- Original `pass-ir/index.html`, `js/app.js`, `js/nav.js`, and `js/parser.js` remain unchanged.

## 15. Open Questions

- Should source path links open in an external editor, copy to clipboard, or both?
- Should explanation rules live as plain JS metadata or JSON plus matcher functions?
- Should unstable magic/opmagic identities be supported in MVP, or deferred until a real failing case appears?
- Should the explainer compare raw JSON only, or compare parsed graph model as a second validation layer?

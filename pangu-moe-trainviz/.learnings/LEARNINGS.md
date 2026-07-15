## [LRN-20260629-001] correction

**Logged**: 2026-06-29T11:02:59+08:00
**Priority**: high
**Status**: pending
**Area**: docs

### Summary
For model training parallelism facts, search primary papers in addition to public model repos and inference runtimes.

### Details
The user corrected a prior answer that said no public training PP/DP/EP configuration was available for Pangu MoE. That conclusion was too broad: the openPangu/GitCode model repos and Omni-Infer runtime did not disclose training config, but the arXiv paper `2505.21411v1` does disclose `TP=8`, `EP=2`, `PP=5`, `VPP=5`, `CP=1`; `DP` remains not explicitly disclosed and can only be derived approximately from `4K Ascend NPUs`.

### Suggested Action
When asked whether training configuration is public, separately report: repo artifacts, inference scripts, primary paper disclosures, and derived quantities. Do not infer "not public" from repo absence alone.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/SPEC-op-rank-time-A.md
- Tags: pangu, moe, search-strategy, primary-sources, training-parallelism

---

## [LRN-20260713-001] correction

**Logged**: 2026-07-13T16:31:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
Do not leave explanatory prototype UI in the production model viewport when it does not represent model data or an active workflow.

### Details
The CSS 3D front view still contained an empty full-model overview card and a draft implementation note. They competed with the model visualization and had no valid user-facing purpose.

### Suggested Action
Keep the viewport limited to the model, data overlays, and actionable controls. Put implementation notes in source comments or project documentation, not in the rendered product UI.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/op-rank-time-openpangu-flash-css3d.html
- Tags: css3d, viewport, prototype-cleanup, user-facing-copy

### Resolution
- **Resolved**: 2026-07-13T16:31:00+08:00
- **Notes**: Removed the overview card, draft help text, and their dead rendering/selection code.

---

## [LRN-20260714-001] correction

**Logged**: 2026-07-14T16:05:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
Model-event overlays need collision-safe compact controls, semantic focus by desaturation, and a reliable blank-canvas escape path.

### Details
The parallel-event toolbar grew wide enough to overlap the viewport title. Selecting a communication tag highlighted the badge but left unrelated operators equally prominent, and blank clicks in the locked front view did not clear selection because the pointer gesture handler exited before creating drag state.

### Suggested Action
Group compact toolbar controls and position them from the actual offset parent below the viewport title. Define related operator IDs per event and desaturate unrelated nodes, clusters, and edges. Handle blank `click` independently from rotate/pan pointer state, while suppressing the click synthesized after a drag.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html
- Tags: model-graph, event-overlay, focus, desaturation, blank-click, collision-avoidance

### Resolution
- **Resolved**: 2026-07-14T16:05:00+08:00
- **Notes**: Compacted and regrouped the toolbar, fixed title-relative placement, added event-to-operator focus sets, and added blank-canvas selection clearing.

---

## [LRN-20260701-001] correction

**Logged**: 2026-07-01T15:19:46+08:00
**Priority**: high
**Status**: pending
**Area**: docs

### Summary
For PTO page-branch requests, produce the requested planning/spec artifact before proposing implementation or editing pages.

### Details
The user asked for suggestions and then a data spec for an EP expert-parallel page. I prematurely moved toward creating a new page and framed the proposal as a lightweight teaching page, underusing the existing Pangu MoE 72B assets. The correct direction is to reuse current Pangu model data, rank/time resources, and existing visualization objects, allow a 2D side-view simplification, and enrich the data model with all EP/FSDP/TP metrics and objects from the referenced tutorial.

### Suggested Action
When a user asks for "建议" or "数据 spec md", first deliver the spec/recommendation artifact. Do not start implementation unless explicitly requested. Reuse existing module data contracts and call out where source tutorial examples must be adapted to the target model's constants.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/SPEC-ep-expert-parallel-2d.md
- Tags: pto, pangu, ep, spec-first, user-intent

---

## [LRN-20260701-002] correction

**Logged**: 2026-07-01T16:05:00+08:00
**Priority**: high
**Status**: pending
**Area**: docs

### Summary
For this Pangu EP page, the local model target is arXiv v2 Pangu Pro MoE 72BA16B, not a separate local 80-expert variant.

### Details
The user clarified that the local model should also be unified to `https://arxiv.org/html/2505.21411v2`. The prior spec kept `op-rank-time.html` constants as a `localDemo` variant, but those constants are legacy values to replace, not a valid second target model. The unified source facts are 48 transformer layers, 2 no-op training slots, 64 routed experts, Top-8, 4 shared experts, and training `TP8/EP2/CP1/PP5/VPP5`.

### Suggested Action
For this module, treat `op-rank-time.html` as layout/interaction reuse only. Do not preserve `openPangu-R-72B-2512`, `50 decoder layers`, `L0-L3 Dense`, `L4-L49 MoE`, or `80 routed experts` as target data unless the user explicitly asks for a historical comparison.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/SPEC-ep-expert-parallel-2d.md
- Tags: pangu, moe, arxiv-v2, source-of-truth, local-data

---

## [LRN-20260714-002] correction

**Logged**: 2026-07-14T16:12:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
When a persistent viewport toolbar still collides after compaction, relocate the independently timed playback control to a dedicated viewport corner instead of continuing to squeeze both controls into the same top band.

### Details
The compact parallel-event toolbar no longer covered the title, but it still overlapped the separate 1F1B playback row. The controls represent different concerns and do not need to share the top-right stack. The DP comparison also confirmed that a backward gradient-sync event must not inherit a model proxy anchor such as Residual Add merely because another communication filter used that node for placement.

### Suggested Action
Reserve the top band for view/filter controls, dock playback at the viewport bottom-right, and keep DP as a backward-domain annotation over parameter-gradient buckets. If a current Layer is used as a visual anchor, state explicitly that a real gradient bucket may span parameters from multiple Layers.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html, /Users/yin/pto/pangu-moe-trainviz/op-rank-time-openpangu-flash-css3d.html
- Tags: viewport-layout, playback, toolbar-collision, dp, gradient-bucket, semantic-anchor
- See Also: LRN-20260714-001

### Resolution
- **Resolved**: 2026-07-14T16:12:00+08:00
- **Notes**: Docked the 1F1B playback control at the view bottom-right and added an explicit DP backward-domain cue without binding DP to a forward operator.

---

## [LRN-20260714-003] correction

**Logged**: 2026-07-14T16:25:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
A cross-view domain selector should be a persistent navigation control, not a view-local overlay positioned from unrelated content.

### Details
The event selector still collided with the top controls because its vertical position was derived only from the viewport title. It also disappeared outside the front view, preventing it from serving as the navigation mechanism the user intended. PP was missing even though it has a valid side-view representation. A follow-up screenshot showed that placing the selector below the toolbar was also wrong: on wide views, it should share the toolbar's top baseline and center inside the free horizontal region to the toolbar's left.

### Suggested Action
Keep cross-view selectors in the viewport top band, use the same pill-shell styling as adjacent viewport controls, and keep them mounted across views. Prefer a shared top row: measure the toolbar bounds, center the selector in the remaining horizontal region, and align both controls by their top edge. Only move the selector below when the measured free width is insufficient. Route architecture-local domains to the front view and depth/stage domains such as PP to the side view.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html
- Tags: persistent-toolbar, view-routing, collision-avoidance, pp, front-view, side-view
- See Also: LRN-20260714-001, LRN-20260714-002

### Resolution
- **Resolved**: 2026-07-14T16:25:00+08:00
- **Notes**: Made the event bar persistent, added PP, aligned it to the toolbar top inside the measured free region with a collision-safe second-row fallback, and routed PP to side view while routing all other domains to front view.

---

## [LRN-20260714-004] correction

**Logged**: 2026-07-14T16:43:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Do not duplicate current execution state with floating side-view badges when the operator itself is already highlighted; make short timeline events easier to hit through truthful axis zoom.

### Details
Four PP execution badges obscured the side-view operator labels while repeating information already expressed by live operator highlighting. In the Swimlane, short communication durations produced very narrow bars and hit regions, so users needed a way to enlarge the time axis without changing the underlying duration values.

### Suggested Action
Use one visual channel for current execution in dense side views. For timeline accessibility, zoom the horizontal time scale, resize both the rendered bars and hit rectangles together, keep the axis and body scroll positions synchronized, and preserve the actual duration metadata.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html
- Tags: side-view, operator-highlight, duplicate-badges, swimlane, timeline-zoom, hit-target
- See Also: LRN-20260714-003

### Resolution
- **Resolved**: 2026-07-14T16:43:00+08:00
- **Notes**: Removed PP0–PP3 side-view live badges, retained node highlighting, and added synchronized 1×–4× Swimlane time-axis zoom with a 1.5× default.

---

## [LRN-20260714-005] correction

**Logged**: 2026-07-14T19:23:22+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Routing a Lens to the side view must not collapse the established four-track stage diagnostics into a single Lens-specific metric.

### Details
The Execution Lens correctly switched to the side view, but `lensTransferKinds()` returned only `hold`. Rebuilding the chart therefore removed Activation, Gradient, and PP Communication and left only Retention MB. The user expected the established four-track side-view context while inspecting live execution.

### Suggested Action
Keep the execution side view context-rich: render Activation p99, Retention MB, Gradient, and PP Communication together. Use execution highlighting and Swimlane state to show the current task without removing the surrounding diagnostic tracks.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html
- Tags: side-view, execution-lens, metric-tracks, regression, context-preservation
- See Also: LRN-20260714-004

### Resolution
- **Resolved**: 2026-07-14T19:23:22+08:00
- **Notes**: Restored the Execution Lens chart kinds to `act`, `hold`, `grad`, and `comm` in the original side-view order.

---

## [LRN-20260714-006] correction

**Logged**: 2026-07-14T19:28:38+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Side-view operator labels, Layer axes, and PP tags must not disappear when the Structure Lens is active.

### Details
The side-view label geometry was calculated inside the transfer-table synchronization path. Because the Structure Lens returned no transfer tracks, the table stayed unmounted and the shared positioning routine never populated operator names, Layer labels, or PP stage anchors.

### Suggested Action
Keep the established four side-view context tracks available in Structure and Execution modes until structural labels have an independent geometry service. Do not use an empty metric selection as a proxy for hiding only the chart when other overlays depend on that renderer.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html
- Tags: side-view, structure-lens, operator-labels, pp-tags, geometry-dependency
- See Also: LRN-20260714-005

### Resolution
- **Resolved**: 2026-07-14T19:28:38+08:00
- **Notes**: Structure Lens now retains the same four side-view context tracks as Execution, keeping the shared label and stage-positioning pass active.

---

## [LRN-20260715-001] correction

**Logged**: 2026-07-15T09:39:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Persistent viewport controls must live outside the transformed 3D stage instead of relying on GPU promotion inside it.

### Details
The Structure / Numerics / Communication / Execution switch intermittently disappeared after CSS3D view or zoom changes. Raising `z-index` and adding nested `translateZ(0)` layers did not make the control reliable because it remained a child of the same stage whose 3D compositing tree was being rebuilt.

### Suggested Action
Mount persistent viewport chrome as a sibling of the 3D stage under the editor pane, give the editor pane an isolated stacking context, and keep the control layer in ordinary 2D composition. Avoid nested `translateZ(0)` on toolbar controls once they are outside the scene.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html
- Tags: css3d, compositor, viewport-toolbar, stacking-context, persistent-controls
- See Also: LRN-20260714-003

### Resolution
- **Resolved**: 2026-07-15T09:39:00+08:00
- **Notes**: Moved the complete stage toolbar out of `.opv-stage`, isolated the editor pane, raised the 2D toolbar layer, and removed GPU-promotion transforms from its controls.

---

## [LRN-20260715-002] correction

**Logged**: 2026-07-15T09:47:18+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
A PP boundary communication bridge must remain visible in the side view instead of being gated behind the Communication Lens.

### Details
The compact `===` bridge was implemented correctly but `syncPpCommBridge()` required `activeLens === 'communication'`. A user entering the side view through another Lens therefore saw the PP stage lines but no bridge. Its placement also followed the diagnostics-to-model gap, which could put it outside the immediately visible PP header region at a small default side-view scale.

### Suggested Action
Keep compact topology-critical boundary markers present across all side-view Lenses, place them at a stable offset below the PP stage labels, and reserve expanded metric detail for hover/selection. Give the side projection its own explicit default scale instead of reusing the front/iso scale.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html
- Tags: side-view, pp-boundary, send-recv, communication-bridge, default-zoom, visibility
- See Also: LRN-20260714-006

### Resolution
- **Resolved**: 2026-07-15T09:47:18+08:00
- **Notes**: Made the compact bridge persistent across side-view Lenses, positioned it below PP labels, and set the CSS side projection default to 80% of fitted scale.

---

## [LRN-20260715-003] correction

**Logged**: 2026-07-15T10:04:17+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Dimmed or absent parallel guides must not retain hitboxes that overwrite the tooltip of a visible PP communication bridge.

### Details
Hovering the yellow PP `===` bridge first produced the correct Layer-boundary tooltip, but the window-level 3D raycast then hit a legacy EP token-flow hitbox. The EP guide was visually dimmed to near-zero opacity under PP focus, yet remained pickable, so the final tooltip described a nonexistent “purple vertical line.” The expanded bridge also showed only tensor direction labels and omitted its diagnostic values.

### Suggested Action
Give overlay bridge hits priority over 3D raycasts, exclude nonmatching dimmed guides from static picking, and remove legacy EP side-view hit targets when EP is represented only in the front view. Put one summary metric on the compact bridge and show phase-specific payload plus Active / Wait / Exposed values on hover or selection.

### Metadata
- Source: user_feedback
- Related Files: /Users/yin/pto/pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html
- Tags: tooltip-priority, stale-hitbox, pp-bridge, ep-guide, active-wait-exposed, side-view
- See Also: LRN-20260715-002

### Resolution
- **Resolved**: 2026-07-15T10:10:00+08:00
- **Notes**: Removed the legacy EP token-flow side guide/hitbox, made bridge hits short-circuit the 3D raycast, filtered dimmed nonmatching static picks, added forward/backward PP timing records, and surfaced Exposed/Payload on the bridge with full timing in its tooltip.

---

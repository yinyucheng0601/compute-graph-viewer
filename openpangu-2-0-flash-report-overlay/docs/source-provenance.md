# Source provenance

## Architecture: source-checked

The bundled architecture is a snapshot of the PTO design-system asset:

- Viewer source: `/Users/yin/pto-design-system/patterns/model-graphviz/assets/openpangu_2_0_flash_modelviz.html`
- Canonical schema source: `/Users/yin/pto-design-system/patterns/model-graphviz/assets/openpangu_2_0_flash_model_architecture.json`
- Bundled validation report: `../vendor/pto-design-system/patterns/model-graphviz/assets/openpangu_2_0_flash_model_architecture_validation.md`

The canonical schema records provenance from the openPangu runtime configuration and model, attention, MTP, and MoE implementation sources. It validates 46 main decoder layers, Dense layers 0–1, MoE layers 2–45, 256 routed experts, top-k 8, and 3 MTP layers. The project bundles the viewer, schema, validation report, renderer, and tokens so runtime access to those original absolute paths is not required.

## Profiling: synthetic

No openPangu profiler trace was available for this demo. `../mock-profiling-data.js` therefore supplies synthetic step duration, compute/communication/idle ratios, kernel counts, stream placement, overlap, priority, bottleneck, and optimization-action values.

Mock mappings use real architecture node IDs so Explorer, graph selection, Inspector, timeline, and playback can be exercised. They must not be interpreted as measured openPangu performance. Each report starts with an explicit `MOCK PROFILE` evidence line, and the Coverage view lists the real profiler evidence that remains missing.

No DeepSeek profiling values were carried into this copy.

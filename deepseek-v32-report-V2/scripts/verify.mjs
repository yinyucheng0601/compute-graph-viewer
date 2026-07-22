import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const manifest = await readJson("dependency-manifest.json");
const requiredPaths = [
  ...manifest.runtime.map((item) => item.path),
  ...(manifest.bundledPatternSources || []),
  ...(manifest.generatedArtifacts || []),
  ...manifest.documentation,
];
await Promise.all(requiredPaths.map((path) => access(resolve(root, path))));

const [
  indexHtml,
  appSource,
  reportDataSource,
  architectureDataSource,
  appStyle,
  sharedStyle,
  graphPatternStyle,
  graphPatternSource,
  analysisConfig,
  perfData,
  timelineData,
  sourceManifest,
  canonicalArchitecture,
  backendOverlay,
  overlayMap,
  graphSpec,
] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "app.js"), "utf8"),
  readFile(resolve(root, "report-data.js"), "utf8"),
  readFile(resolve(root, "architecture-data.js"), "utf8"),
  readFile(resolve(root, "app.css"), "utf8"),
  readFile(resolve(root, "vendor/pto-design-system/css/style.css"), "utf8"),
  readFile(resolve(root, "vendor/pto-design-system/patterns/model-graphviz/pattern.css"), "utf8"),
  readFile(resolve(root, "vendor/pto-design-system/patterns/model-graphviz/pattern.js"), "utf8"),
  readJson("data/ds3_2_analysis_config.json"),
  readJson("data/ds3_2_perf_data.json"),
  readJson("data/ds3_2_timeline.json"),
  readJson("outputs/model-source-manifest.json"),
  readJson("outputs/model_architecture.json"),
  readJson("outputs/backend_trace_overlay.json"),
  readJson("outputs/architecture_overlay_map.json"),
  readJson("outputs/model_architecture_graph.json"),
]);

const executableScriptTypes = new Set(["", "text/javascript", "application/javascript", "module"]);
function parseInlineScripts(html, fileName) {
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let count = 0;
  while ((match = scriptPattern.exec(html))) {
    const attributes = match[1];
    if (/\bsrc\s*=/.test(attributes)) continue;
    const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "";
    if (!executableScriptTypes.has(type)) continue;
    new vm.Script(match[2], { filename: `${fileName}#inline-${count + 1}` });
    count += 1;
  }
  return count;
}

const indexScriptCount = parseInlineScripts(indexHtml, "index.html");
new vm.Script(appSource, { filename: "app.js" });
new vm.Script(reportDataSource, { filename: "report-data.js" });
new vm.Script(architectureDataSource, { filename: "architecture-data.js" });
new vm.Script(graphPatternSource, { filename: "pattern.js" });

const dataSandbox = { window: {} };
vm.runInNewContext(reportDataSource, dataSandbox, { filename: "report-data.js" });
vm.runInNewContext(architectureDataSource, dataSandbox, { filename: "architecture-data.js" });
const reportModel = dataSandbox.window.DeepSeekReportData.createReportModel(analysisConfig, perfData, timelineData);
const architecture = dataSandbox.window.DeepSeekArchitectureData;
const graph = architecture.createArchitectureGraph(graphSpec, reportModel.reports);
const defaultCollapsedIds = architecture.defaultCollapsedIds(graphSpec);
const graphView = architecture.createArchitectureView(graphSpec, reportModel.reports, defaultCollapsedIds);
const streamTimelineRendererSource = appSource.slice(
  appSource.indexOf("function renderStreamTimeline"),
  appSource.indexOf("function segmentsForLane"),
);

function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function collectBackendNodeIds(value, ids = new Set()) {
  for (const node of values(value)) {
    if (!node || typeof node !== "object") continue;
    if (typeof node.node_id === "string" && node.node_id) ids.add(node.node_id);
    collectBackendNodeIds(node.children, ids);
  }
  return ids;
}

const backendNodeIds = collectBackendNodeIds([
  ...values(analysisConfig.stages),
  ...values(analysisConfig.layer_structure),
  ...values(analysisConfig.runtime_auxiliary),
]);
const mappedBackendIds = new Set(overlayMap.mappings.map((mapping) => mapping.backend_node_id));
const allGraphItems = [...graph.nodes, ...graph.clusters];
const graphItemsById = new Map(allGraphItems.map((item) => [item.id, item]));
const interactiveItems = allGraphItems.filter((item) => item.selectable);
const sourceOnlyItems = allGraphItems.filter((item) => item.dataState === "source_only");
const operatorNodes = graph.nodes.filter((node) => node.kind === "op");
const mappedOperatorNodes = operatorNodes.filter((node) => node.backendNodeId);
const graphBackendIds = new Set(interactiveItems.map((item) => item.backendNodeId).filter(Boolean));
const canonicalNodeIds = new Set(canonicalArchitecture.nodes.map((node) => node.id));
const graphLogicalIds = new Set();
(function collectGraphItems(items) {
  for (const item of items || []) {
    graphLogicalIds.add(item.id);
    collectGraphItems(item.children);
  }
}(graphSpec.roots));

const geometryIsValid = allGraphItems.every((item) => (
  [item.x, item.y, item.width, item.height].every(Number.isFinite)
  && item.width > 0
  && item.height > 0
));
const childContainedByParent = allGraphItems.every((item) => {
  if (!item.parent) return true;
  const parent = graphItemsById.get(item.parent);
  if (!parent) return false;
  const isNode = graph.nodes.includes(item);
  const left = isNode ? item.x - item.width / 2 : item.x;
  const top = isNode ? item.y - item.height / 2 : item.y;
  return left >= parent.x
    && top >= parent.y
    && left + item.width <= parent.x + parent.width
    && top + item.height <= parent.y + parent.height;
});
const allEdgesResolve = graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.source)
  && graph.nodes.some((node) => node.id === edge.target));
const canonicalEdgesResolve = canonicalArchitecture.edges.every((edge) => canonicalNodeIds.has(edge.source)
  && canonicalNodeIds.has(edge.target) && Array.isArray(edge.provenance) && edge.provenance.length);
const canonicalNodesHaveProvenance = canonicalArchitecture.nodes.every((node) => Array.isArray(node.provenance)
  && node.provenance.length);
const allMappingsResolve = overlayMap.mappings.every((mapping) => (
  backendNodeIds.has(mapping.backend_node_id)
  && graphLogicalIds.has(mapping.projected_graph_node_id)
  && mapping.source_node_ids.every((sourceId) => canonicalNodeIds.has(sourceId))
));

const tagReferencePattern = /<(?:link|script|iframe)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
const importReferencePattern = /@import\s+url\(\s*["']?([^"')]+)["']?\s*\)/gi;
const directImportReferencePattern = /@import\s+["']([^"']+)["']/gi;
function collectReferences(text, pattern, baseDir) {
  const references = [];
  let match;
  while ((match = pattern.exec(text))) references.push({ baseDir, reference: match[1] });
  return references;
}
const runtimeReferences = [
  ...collectReferences(indexHtml, new RegExp(tagReferencePattern), root),
  ...collectReferences(sharedStyle, new RegExp(importReferencePattern), resolve(root, "vendor/pto-design-system/css")),
  ...collectReferences(sharedStyle, new RegExp(directImportReferencePattern), resolve(root, "vendor/pto-design-system/css")),
  ...collectReferences(graphPatternStyle, new RegExp(importReferencePattern), resolve(root, "vendor/pto-design-system/patterns/model-graphviz")),
  ...collectReferences(graphPatternStyle, new RegExp(directImportReferencePattern), resolve(root, "vendor/pto-design-system/patterns/model-graphviz")),
];
const externalRuntimeReferences = runtimeReferences.filter(({ reference }) => /^(?:https?:)?\/\//i.test(reference));
const localRuntimeReferences = runtimeReferences.filter(({ reference }) => !/^(?:https?:)?\/\//i.test(reference));
await Promise.all(localRuntimeReferences.map(({ baseDir, reference }) => access(resolve(baseDir, reference.split(/[?#]/, 1)[0]))));

const mtpCanonicalNodes = canonicalArchitecture.nodes.filter((node) => /mtp/i.test(node.id));
const mtpMappings = overlayMap.mappings.filter((mapping) => mapping.backend_node_id.includes("/mtp_layer"));
const mtpRoot = graphSpec.roots[0]?.children?.[0]?.children?.find((item) => item.id === "source/transformer/mtp");
const backendExtensionRoot = graphSpec.roots.find((rootItem) => rootItem.id === "section/backend_extensions");
const runtimeRoot = graphSpec.roots.find((rootItem) => rootItem.id === "section/runtime_auxiliary");
const sourceOnlyHaveNoMetrics = sourceOnlyItems.every((item) => !item.backendNodeId && item.selectable === false);
const backendCoverageExact = backendNodeIds.size === mappedBackendIds.size
  && [...backendNodeIds].every((nodeId) => mappedBackendIds.has(nodeId) && graphBackendIds.has(nodeId));
const colorKeysAreSemantic = allGraphItems.every((item) => /^(?:sem|module|io|opv):/.test(item.colorKey));

const assertions = [
  [indexHtml.includes('src="./report-data.js"') && indexHtml.includes('src="./architecture-data.js"') && indexHtml.includes('src="./app.js"'), "entry loads report, architecture, and application adapters"],
  [indexHtml.includes("patterns/model-graphviz/pattern.js"), "entry loads the shared model-graphviz renderer"],
  [appSource.includes('loadJson("./outputs/model_architecture_graph.json")') && appSource.includes('loadJson("./outputs/architecture_overlay_map.json")'), "application loads generated hybrid graph and explicit mapping"],
  [appSource.includes('loadJson("./data/ds3_2_analysis_config.json")') && appSource.includes('loadJson("./data/ds3_2_perf_data.json")') && appSource.includes('loadJson("./data/ds3_2_timeline.json")'), "application retains all three backend inputs"],
  [!indexHtml.includes("timelineTabCoverage") && !indexHtml.includes("coverageTimelinePanel"), "Coverage tab is absent"],
  [indexHtml.includes('id="bottomPanelToggle"') && !indexHtml.includes("reportTerminalPanel") && !indexHtml.includes('data-ide-toggle="terminal"'), "bottom dock toggle replaces the removed terminal module"],
  [!indexHtml.includes('aria-label="Architecture controls"') && !indexHtml.includes('id="fitGraph"') && !indexHtml.includes('id="clearSelection"'), "architecture toolbar is removed from the canvas header"],
  [!indexHtml.includes('id="reportExplorerPane"') && indexHtml.includes('id="architectureViewTab"') && indexHtml.includes('id="operatorListViewTab"'), "performance nodes and architecture are merged into two node-view tabs"],
  [indexHtml.includes('id="nodeViewsRailButton"') && appSource.includes('activateArchitectureView("operators")'), "activity rail retains an entry into the merged operator-list view"],
  [appSource.includes("function createOperatorTree(config)") && appSource.includes("rawNode.children || []") && appSource.includes("operatorTreeExpandedIds"), "operator list derives expandable indentation from backend parent-child relationships"],
  [appSource.includes('state.selectedNodeId = REPORT_ORDER[0] || ""') && appSource.includes("renderArchitecture({ activeNodeId: initialGraphNodeId })"), "the first backend performance node is selected on initial render"],
  [appStyle.includes("#timelinePanel > .pto-ide-frame__pane-header .tab-control") && appStyle.includes("height: 28px"), "timeline tabs stay within the compact panel header"],
  [indexHtml.includes('id="streamZoomIn"') && indexHtml.includes('id="streamZoomReset"') && appSource.includes("STREAM_ZOOM_LEVELS") && appSource.includes("setStreamZoom"), "swimlane timeline provides bounded horizontal zoom controls"],
  [appStyle.includes(".stream-lane-header") && appStyle.includes("position: sticky;") && appStyle.includes(".stream-lane-scroller"), "swimlane ruler and lane context remain fixed while the zoomed timeline scrolls"],
  [!streamTimelineRendererSource.includes("timeline-summary-grid") && !streamTimelineRendererSource.includes("timeline-stat"), "stream timeline summary cards are absent"],
  [appSource.includes("segment.nodeId === state.selectedNodeId") && appSource.includes("isEmphasized: isLinked") && appSource.includes("isRelated: isLinked && !isActive") && appSource.includes("has-linked-selection"), "architecture selection highlights every mapped swimlane event"],
  [appSource.includes('options.source !== "timeline"') && appSource.includes('selectNode(segment.nodeId, { source: "timeline" })'), "timeline event selection stays primary while synchronizing the architecture node"],
  [appSource.includes('options.source === "timeline"') && appSource.includes("centerNode(graphNodeId)") && graphPatternSource.includes("function centerNode(nodeId)"), "timeline selection centers its mapped architecture node in the viewport"],
  [appSource.includes("[...(canvas.__reportSegments || [])].reverse().find"), "overlapping timeline events hit-test from the visually topmost task"],
  [appSource.includes("context.globalAlpha = hasLinkedTimelineSelection && !isLinked ? 0.26 : 1"), "unrelated timeline events recede while a mapped node is selected"],
  [indexScriptCount === 1 && externalRuntimeReferences.length === 0, "runtime scripts parse and declare no network resources"],
  [indexHtml.includes('id="languageToggle"') && appSource.includes("function setLanguage(language)") && appSource.includes("const I18N ="), "English and Chinese interface switching is available"],
  [!appSource.includes("localizeArchitectureTypeLabels") && !appSource.includes("ARCHITECTURE_LABELS_ZH"), "architecture canvas labels remain source-authored English in both interface languages"],
  [indexHtml.includes('id="themeToggle"') && appSource.includes("function setTheme(theme)") && appStyle.includes(':root[data-theme="light"]'), "dark and light theme switching is available"],
  [reportModel.counts.analysisNodes === 88 && reportModel.counts.perfNodes === 88, "backend analysis and performance each resolve 88 node IDs"],
  [reportModel.counts.timelineEvents === 548 && reportModel.counts.lanes === 40, "timeline derives 548 events and 40 raw lanes"],
  [reportModel.counts.mappedEvents === 237 && reportModel.counts.unmappedEvents === 311, "timeline mapping counts remain backend-authored"],
  [sourceManifest.verification_state === "runtime_source_locked" && sourceManifest.runtime_equivalence === "source_structure_verified", "source provenance locks the supplied internal runtime structure"],
  [sourceManifest.repositories.every((repository) => /^[0-9a-f]{40}$/.test(repository.source_revision)), "source repositories are locked to immutable commits"],
  [sourceManifest.repositories.some((repository) => repository.source_id === "ui_json_runtime" && repository.source_revision === "f6262f5b95e32a2a66e38314b6c7b035d51ea49d"), "ui-json runtime source revision is recorded"],
  [sourceManifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)), "source files carry verified SHA-256 hashes"],
  [canonicalArchitecture.extraction_scope.kind === "full_source" && canonicalArchitecture.extraction_scope.full_main_layers === 61, "canonical architecture covers all 61 main layers"],
  [canonicalArchitecture.nodes.length === 160 && canonicalArchitecture.edges.length === 140, "canonical architecture contains the expected runtime-source nodes and edges"],
  [canonicalNodesHaveProvenance && canonicalEdgesResolve, "canonical nodes and edges resolve with source provenance"],
  [backendOverlay.scope === "trace_slice" && backendOverlay.nodes.length === 88, "backend metrics remain an independent 88-node trace slice"],
  [overlayMap.validation.all_backend_nodes_classified && backendCoverageExact && allMappingsResolve, "all 88 backend nodes have one explicit projected classification"],
  [canonicalArchitecture.extraction_scope.includes_mtp === true && canonicalArchitecture.extraction_scope.mtp_learned_layers === 1 && canonicalArchitecture.extraction_scope.mtp_runtime_iterations === 3, "canonical scope distinguishes one learned MTP layer from three runtime iterations"],
  [mtpCanonicalNodes.length === 63 && mtpMappings.length > 0 && mtpMappings.filter((mapping) => mapping.mapping_kind === "backend_trace_extension").length === 1, "MTP is source-backed with only weight-preparation scaffolding retained as a trace detail"],
  [mtpRoot?.backendNodeId === "model/deepseek-v3.2-exp/layers/mtp_layer" && !backendExtensionRoot && runtimeRoot, "MTP is inside the complete model while runtime auxiliary remains separate"],
  [overlayMap.conflicts.length === 1 && overlayMap.conflicts[0].conflict_id === "mtp_weight_allgather_scaffold", "the remaining runtime implementation detail is documented"],
  [graph.metadata.extractionScope === "hybrid" && graph.metadata.sourceScope === "full_source" && graph.metadata.backendScope === "trace_slice", "runtime graph declares hybrid scope without conflating facts"],
  [graph.metadata.fullMainLayerCount === 61 && graph.metadata.backendNodeCount === 88 && interactiveItems.length === 88, "hybrid graph preserves full layer count and 88 interactive backend nodes"],
  [sourceOnlyHaveNoMetrics, "source-only graph items are dim-state, nonselectable, and metric-free"],
  [appStyle.includes(".pto-model-graphviz-node.is-source-only.is-op") && appStyle.includes("fill-opacity: 0.5"), "source-only operator nodes use 50% fill opacity"],
  [graph.nodes.length > 0 && [...graph.nodes, ...graphView.nodes].every((node) => node.width === 336), "expanded and folded architecture nodes use one readable width"],
  [mappedOperatorNodes.length > 0 && mappedOperatorNodes.every((node) => node.metricBadge === reportModel.reports[node.backendNodeId]?.metricShort), "mapped operator nodes carry backend time-share badges"],
  [appSource.includes("metricOverlays: true") && appSource.includes("reportOverlays: false") && graphPatternSource.includes("options?.metricOverlays !== false"), "time-share badges remain enabled independently of priority overlays"],
  [graph.edges.length === 140 && allEdgesResolve, "hybrid projection renders only source-validated edges"],
  [defaultCollapsedIds.length === 23 && graphView.height < graph.height && graphView.metadata.interactiveItemCount < 88, "semantic folding reduces the initial architecture surface"],
  [architecture.backendToGraphId(graphSpec, "model/deepseek-v3.2-exp/stages/main_final_norm") === "source/transformer/final_norm", "backend-to-graph selection mapping resolves stable IDs"],
  [graphPatternSource.includes("itemSelectable") && graphPatternSource.includes("node.selectable !== false") && graphPatternSource.includes("cluster.selectable !== false"), "renderer separates fold controls from data selection"],
  [!graphPatternSource.includes("obstacleAvoidingRoute") && graphPatternSource.includes("const midY = (start.y + end.y) / 2;") && graphPatternSource.includes("edgePath(source, targetNode, edge)"), "architecture edges use the skill-standard cubic Bezier curve"],
  [graphPatternStyle.includes(".pto-model-graphviz-metric-badge") && graphPatternStyle.includes("stroke: none;") && graphPatternStyle.includes(".pto-model-graphviz-node.is-model-selected > rect:first-child"), "metric badges stay borderless when their node is selected"],
  [graphPatternStyle.includes(".pto-model-graphviz-toggle") && graphPatternStyle.includes(".pto-model-graphviz-toggle-icon") && graphPatternSource.includes("class: 'pto-model-graphviz-toggle-icon'") && graphPatternSource.includes(" V ${toggleY + 5}"), "expand controls use a borderless centered SVG icon"],
  [geometryIsValid && childContainedByParent, "architecture geometry is finite and nested items stay inside their parents"],
  [colorKeysAreSemantic, "architecture colors use shared semantic keys"],
];

const failed = assertions.filter(([condition]) => !condition);
for (const [condition, label] of assertions) console[condition ? "log" : "error"](`${condition ? "OK  " : "FAIL"} ${label}`);
if (failed.length) process.exitCode = 1;
else {
  console.log(`OK   ${localRuntimeReferences.length} local HTML/CSS resource references resolve`);
  console.log(`OK   ${requiredPaths.length} declared project files exist`);
}

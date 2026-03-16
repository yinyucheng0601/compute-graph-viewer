import * as dataAdapters from "./data-adapters.js?v=20260316r";
import {createInitialState, materializeVisibleGraph} from "./graph-ir.js?v=20260316r";
import {computeLayout} from "./layout-engine.js?v=20260316r";
import {GraphRenderer} from "./renderer.js?v=20260316r";

const SAMPLE_CATALOG = dataAdapters.SAMPLE_CATALOG || [];
const REAL_PASS_00_FILES = dataAdapters.REAL_PASS_00_FILES || [];
const DEFAULT_REAL_PASS_00_FILE =
  dataAdapters.DEFAULT_REAL_PASS_00_FILE ||
  "After_000_RemoveRedundantReshape_TENSOR_LOOP_RESHAPE_Unroll1_PATH0_4.json";
const loadGraphSample = dataAdapters.loadGraphSample;

const sampleSelect = document.getElementById("sampleSelect");
const realPassField = document.getElementById("realPassField");
const realPassSelect = document.getElementById("realPassSelect");
const tensorModeSelect = document.getElementById("tensorModeSelect");
const fitBtn = document.getElementById("fitBtn");
const reloadBtn = document.getElementById("reloadBtn");
const statsMeta = document.getElementById("statsMeta");
const detailPanel = document.getElementById("detailPanel");
const detailClose = document.getElementById("detailClose");
const detailKind = document.getElementById("detailKind");
const detailSummary = document.getElementById("detailSummary");
const detailBody = document.getElementById("detailBody");
const emptyState = document.getElementById("emptyState");
const workspace = document.querySelector(".workspace");
const svg = document.getElementById("graphSvg");
const toolbarGraphName = document.getElementById("toolbarGraphName");

const renderer = new GraphRenderer(svg, {
  onToggleGroup: handleToggleGroup,
  onSelectNode: handleSelectNode,
  onSelectEdge: handleSelectEdge,
});

const state = {
  canonicalGraph: null,
  ui: null,
  materialized: null,
  layout: null,
  selectedSample: "source-graph",
  selectedRealPassFile: DEFAULT_REAL_PASS_00_FILE,
  loadingToken: 0,
};

bootstrap();

async function bootstrap() {
  populateSampleOptions();
  populateRealPassOptions();
  bindControls();
  await loadSelectedSample({fit: true});
}

function populateSampleOptions() {
  sampleSelect.innerHTML = SAMPLE_CATALOG.map((sample) => (
    `<option value="${sample.key}">${sample.label}</option>`
  )).join("");
  sampleSelect.value = state.selectedSample;
}

function populateRealPassOptions() {
  realPassSelect.innerHTML = REAL_PASS_00_FILES.map((fileName) => (
    `<option value="${fileName}">${shortPassLabel(fileName)}</option>`
  )).join("");
  realPassSelect.value = state.selectedRealPassFile;
  syncRealPassVisibility();
}

function bindControls() {
  sampleSelect.addEventListener("change", async () => {
    state.selectedSample = sampleSelect.value;
    syncRealPassVisibility();
    await loadSelectedSample({fit: true});
  });

  realPassSelect.addEventListener("change", async () => {
    state.selectedRealPassFile = realPassSelect.value;
    if (state.selectedSample === "pass-graph") {
      await loadSelectedSample({fit: true});
    }
  });

  tensorModeSelect.addEventListener("change", async () => {
    if (!state.ui) {
      return;
    }
    state.ui.tensorMode = tensorModeSelect.value;
    await rerender({fit: true});
  });

  document.querySelectorAll("[data-direction]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!state.ui) {
        return;
      }
      state.ui.direction = button.dataset.direction;
      syncDirectionButtons();
      await rerender({fit: true});
    });
  });

  fitBtn.addEventListener("click", () => renderer.fitToScene());
  reloadBtn.addEventListener("click", async () => loadSelectedSample({fit: true, hardReload: true}));
  detailClose.addEventListener("click", closeInspector);

  window.addEventListener("resize", () => renderer.fitToScene());
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "f") {
      renderer.fitToScene();
    }
  });
}

async function loadSelectedSample(options = {}) {
  const token = ++state.loadingToken;
  const sample = SAMPLE_CATALOG.find((entry) => entry.key === state.selectedSample) || SAMPLE_CATALOG[0];
  setStatus(`Loading ${sample.label}…`, "");
  clearInspector();
  emptyState.hidden = true;

  try {
    const graph = await loadGraphSample(sample.key, {
      realPassFile: state.selectedRealPassFile,
    });
    if (token !== state.loadingToken) {
      return;
    }
    state.canonicalGraph = graph;
    state.ui = createInitialState(graph);
    state.ui.tensorMode = tensorModeSelect.value || "auto";
    syncDirectionButtons();
    await rerender({fit: options.fit});
  } catch (error) {
    if (token !== state.loadingToken) {
      return;
    }
    emptyState.hidden = false;
    setStatus(`Failed to load ${sample.label}`, error.message || String(error));
    detailKind.textContent = "error";
    detailSummary.textContent = "Sample loading failed.";
    detailBody.textContent = String(error.stack || error.message || error);
  }
}

async function rerender(options = {}) {
  if (!state.canonicalGraph || !state.ui) {
    return;
  }

  const start = performance.now();
  const materialized = materializeVisibleGraph(state.canonicalGraph, state.ui);
  const layout = await computeLayout(materialized);

  state.materialized = materialized;
  state.layout = layout;

  renderer.setScene({
    graph: materialized,
    layout,
  }, {
    fit: options.fit,
    selection: state.ui.selection,
  });

  const elapsed = (performance.now() - start).toFixed(1);
  setStatus(
    `${materialized.meta.sampleLabel} · ${materialized.tensorMode === "edges" ? "Tensor edge mode" : "Tensor node mode"}`,
    buildStatsString(materialized, elapsed)
  );
}

function buildStatsString(materialized, elapsed) {
  const stats = materialized.meta.stats;
  return [
    `${stats.visibleNodes} visible nodes`,
    `${stats.visibleEdges} visible edges`,
    `${stats.groups} groups`,
    `${stats.ops} ops`,
    `${stats.annotations} annotations`,
    `${state.layout?.engine || "unknown"} layout`,
    `${elapsed} ms layout`,
  ].join(" · ");
}

function syncDirectionButtons() {
  document.querySelectorAll("[data-direction]").forEach((button) => {
    button.classList.toggle("active", button.dataset.direction === state.ui?.direction);
  });
}

function syncRealPassVisibility() {
  const active = state.selectedSample === "pass-graph";
  realPassField.hidden = !active;
}

function handleToggleGroup(groupId) {
  if (!state.ui) {
    return;
  }
  if (state.ui.expanded.has(groupId)) {
    state.ui.expanded.delete(groupId);
  } else {
    state.ui.expanded.add(groupId);
  }
  rerender({fit: true});
}

function openInspector() {
  detailPanel.classList.add("is-open");
  workspace.classList.add("inspector-open");
}

function closeInspector() {
  detailPanel.classList.remove("is-open");
  workspace.classList.remove("inspector-open");
  if (state.ui) {
    state.ui.selection = null;
    renderer.setSelection(null);
  }
  clearInspector();
}

function handleSelectNode(node) {
  state.ui.selection = {kind: "node", id: node.id};
  renderer.setSelection(state.ui.selection);
  detailKind.textContent = node.kind;
  detailSummary.textContent = node.label;
  detailBody.textContent = JSON.stringify(node, null, 2);
  openInspector();
}

function handleSelectEdge(edge) {
  state.ui.selection = {kind: "edge", id: edge.id};
  renderer.setSelection(state.ui.selection);
  detailKind.textContent = "edge";
  detailSummary.textContent = `${edge.source} -> ${edge.target}`;
  detailBody.textContent = JSON.stringify(edge, null, 2);
  openInspector();
}

function setStatus(primary, secondary) {
  statsMeta.textContent = secondary;
  if (toolbarGraphName) toolbarGraphName.textContent = primary;
}

function clearInspector() {
  detailKind.textContent = "-";
  detailSummary.textContent = "Select a node or edge label.";
  detailBody.textContent = "";
}

function shortPassLabel(fileName) {
  return String(fileName)
    .replace(/\.json$/i, "")
    .replace(/^After_000_RemoveRedundantReshape_/, "After · ")
    .replace(/^Before_000_RemoveRedundantReshape_/, "Before · ")
    .replace(/_Unroll1_/g, " · ")
    .replace(/_PATH0_/g, " · PATH0/")
    .replace(/_/g, " ");
}

import * as dataAdapters from "./data-adapters.js?v=20260317a";
import {createInitialState, materializeVisibleGraph} from "./graph-ir.js?v=20260317a";
import {computeLayout} from "./layout-engine.js?v=20260317a";
import {GraphRenderer} from "./renderer.js?v=20260317a";

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
    detailBody.innerHTML = `<pre class="insp-code">${escHtml(String(error.stack || error.message || error))}</pre>`;
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
  detailBody.innerHTML = buildNodeInspectorHTML(node, state.canonicalGraph);
  openInspector();
}

function handleSelectEdge(edge) {
  state.ui.selection = {kind: "edge", id: edge.id};
  renderer.setSelection(state.ui.selection);
  detailKind.textContent = "edge";
  detailSummary.textContent = `${edge.source} → ${edge.target}`;
  const tensors = edge.tensors || [];
  const lines = tensors.map((t) =>
    `<div class="insp-flow-item">${escHtml(t.label)}  <span class="insp-meta">${escHtml(t.shape)} ${escHtml(t.dtype)}</span></div>`
  ).join("");
  detailBody.innerHTML =
    inspSection("Tensor 流", tensors.length ? lines : "<span class='insp-meta'>直连边（无 tensor 节点）</span>") +
    inspSection("Edge ID", `<span class="insp-meta">${escHtml(edge.id)}</span>`);
  openInspector();
}

// ──────────────────────────────────────────────────────────────────────────────
// Inspector HTML 生成
// ──────────────────────────────────────────────────────────────────────────────

const OP_TYPE_DESC = {
  "VIEW":           {api: "pypto.view()",           desc: "零拷贝内存视图切片，按 offset=[tIdx,…] 提取当前 tile 行"},
  "RESHAPE":        {api: "pypto.reshape()",        desc: "改变张量形状，不移动数据"},
  "A_MUL_B":        {api: "pypto.matmul()",         desc: "矩阵乘法线性变换"},
  "CAST":           {api: "pypto.cast()",           desc: "数据类型转换（如 BF16 ↔ FP32 ↔ INT8）"},
  "MUL":            {api: "pypto.mul() / tensor * x", desc: "逐元素乘法"},
  "ADD":            {api: "pypto.add() / tensor + x", desc: "逐元素加法"},
  "SUB":            {api: "tensor - tensor",          desc: "逐元素减法"},
  "DIV":            {api: "tensor / tensor",          desc: "逐元素除法"},
  "CONCAT":         {api: "pypto.concat()",           desc: "沿指定轴拼接多个张量"},
  "SUM":            {api: "pypto.sum()",              desc: "沿维度求和（keepdim=True）"},
  "ABS":            {api: "pypto.abs()",              desc: "逐元素绝对值"},
  "AMAX":           {api: "pypto.amax()",             desc: "沿维度求最大值（量化缩放因子分母）"},
  "FULL":           {api: "pypto.full()",             desc: "创建常量填充张量（如 127.0 / 1.0）"},
  "SQRT":           {api: "pypto.sqrt()",             desc: "逐元素平方根（LayerNorm 方差归一化）"},
  "SCATTER_UPDATE": {api: "pypto.scatter_update()",   desc: "按 index 分散写入，将量化 K 写回 KV Cache"},
  "ASSEMBLE":       {api: "pypto.assemble()",         desc: "将当前 tile 结果写回全局输出张量对应位置"},
};

const BOUNDARY_SOURCE = {
  "in_x_in":             {line: 54, code: "x: torch.tensor  # BF16, (t, h)"},
  "in_q_norm_in":        {line: 55, code: "q_norm: torch.tensor  # INT8, (t, qLoraRank)"},
  "in_q_norm_scale_in":  {line: 56, code: "q_norm_scale: torch.tensor  # FP32, (t, 1)"},
  "in_w_qb_in":          {line: 57, code: "w_qb: torch.tensor  # INT8, NZ format"},
  "in_w_qb_scale_in":    {line: 58, code: "w_qb_scale: torch.tensor  # FP32, (headNum * headDim, 1)"},
  "in_wk_in":            {line: 59, code: "wk: torch.tensor  # BF16, NZ format"},
  "in_w_proj_in":        {line: 60, code: "w_proj: torch.tensor  # BF16, NZ format"},
  "in_ln_gamma_k_in":    {line: 61, code: "ln_gamma_k: torch.tensor  # BF16, (headDim,)"},
  "in_ln_beta_k_in":     {line: 62, code: "ln_beta_k: torch.tensor  # BF16, (headDim,)"},
  "in_cos_idx_rope_in":  {line: 63, code: "cos_idx_rope: torch.tensor  # BF16, (t, ropeHeadDim)"},
  "in_sin_idx_rope_in":  {line: 64, code: "sin_idx_rope: torch.tensor  # BF16, (t, ropeHeadDim)"},
  "in_hadamard_q_in":    {line: 65, code: "hadamard_q: torch.tensor  # BF16, (headDim, headDim)"},
  "in_hadamard_k_in":    {line: 66, code: "hadamard_k: torch.tensor  # BF16, (headDim, headDim)"},
  "in_k_cache":          {line: 67, code: "k_cache: torch.tensor  # INT8, (blockNum, blockSize, nKv, headDim)"},
  "in_k_cache_scale":    {line: 68, code: "k_cache_scale: torch.tensor  # FP16, (blockNum, blockSize, nKv, 1)"},
  "in_k_cache_index_in": {line: 69, code: "k_cache_index: torch.tensor  # INT64, (t,)"},
  "out_q_int8_out":      {line: 74, code: "q_int8: torch.tensor  # → q_int8_out"},
  "out_q_scale_out":     {line: 75, code: "q_scale: torch.tensor  # → q_scale_out"},
  "out_k_int8_out":      {line: 76, code: "k_int8: torch.tensor  # → k_int8_out"},
  "out_k_scale_out":     {line: 77, code: "k_scale: torch.tensor  # → k_scale_out"},
  "out_weights_out":     {line: 78, code: "weights: torch.tensor  # → weights_out"},
};

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtShape(shape) {
  if (!shape || !shape.length) return "–";
  return `[${shape.join(", ")}]`;
}

function fmtLines(lines) {
  if (!lines || !lines.length) return "";
  if (lines.length === 2 && lines[0] !== lines[1]) return `L${lines[0]}–${lines[1]}`;
  return `L${lines[0]}`;
}

function inspSection(title, content) {
  return `<div class="insp-section">
    <div class="insp-section-title">${title}</div>
    <div class="insp-section-body">${content}</div>
  </div>`;
}

function inspRow(label, value) {
  return `<div class="insp-row"><span class="insp-row-label">${label}</span><span class="insp-row-value">${value}</span></div>`;
}

function buildNodeInspectorHTML(node, canonGraph) {
  const canonical = (canonGraph?.nodes || []).find((n) => n.id === node.id);
  const data = canonical?.data || node.data || {};

  if (node.kind === "group")    return buildGroupInspector(node, data, canonGraph);
  if (node.kind === "op")       return buildOpInspector(node, data, canonGraph);
  return buildTensorInspector(node, data, canonGraph);
}

function buildGroupInspector(node, data, canonGraph) {
  const sourceCode = data.sourceCode || "";
  const sourceLines = data.sourceLines || [];
  const children = (canonGraph?.nodes || []).filter((n) => n.parentId === node.id);
  const opCount     = children.filter((n) => n.type === "Operation").length;
  const groupCount  = children.filter((n) => n.type === "Group").length;
  const tensorCount = children.filter((n) => n.type === "Tensor").length;

  let html = "";

  if (sourceCode) {
    const ref = sourceLines.length
      ? `<div class="insp-src-ref">lightning_indexer_prolog_quant.py · ${fmtLines(sourceLines)}</div>`
      : "";
    html += inspSection("源码结构",
      `<pre class="insp-code">${escHtml(sourceCode)}</pre>${ref}`
    );
  }

  html += inspSection("Step 5 · Parser / IR 生成",
    `<div class="insp-parse-badge">pypto.loop() / loop_unroll() → Group 节点</div>` +
    `<div class="insp-parse-note">IR 生成阶段将循环体展开为逻辑分组，子节点按语义标签聚合</div>`
  );

  const summary = [
    groupCount  ? `${groupCount} 子分组` : "",
    opCount     ? `${opCount} 算子` : "",
    tensorCount ? `${tensorCount} 张量` : "",
  ].filter(Boolean).join("　");
  if (summary) {
    html += inspSection("包含", `<div class="insp-meta">${summary}</div>`);
  }

  return html;
}

function buildOpInspector(node, data, canonGraph) {
  const sourceRef  = data.sourceRef;
  const opTypeName = node.label;
  const opDesc     = OP_TYPE_DESC[opTypeName] || {};

  const outEdge   = (canonGraph?.edges || []).find((e) => e.source === node.id);
  const outTensor = outEdge ? (canonGraph?.nodes || []).find((n) => n.id === outEdge.target) : null;

  let html = "";

  if (sourceRef) {
    html += inspSection("源码",
      `<pre class="insp-code">${escHtml(sourceRef.code)}</pre>` +
      `<div class="insp-src-ref">lightning_indexer_prolog_quant.py · ${fmtLines(sourceRef.lines)}</div>`
    );
  }

  const apiStr = opDesc.api || opTypeName;
  html += inspSection("Step 5 · Parser / IR 生成",
    `<div class="insp-parse-badge"><code>${escHtml(apiStr)}</code> → <strong>${escHtml(opTypeName)}</strong> 节点</div>` +
    (opDesc.desc ? `<div class="insp-parse-note">${escHtml(opDesc.desc)}</div>` : "")
  );

  if (outTensor) {
    html += inspSection("输出张量",
      inspRow("dtype", escHtml(outTensor.dtype || "")) +
      inspRow("shape", escHtml(fmtShape(outTensor.shape || [])))
    );
  }

  return html;
}

function buildTensorInspector(node, data, canonGraph) {
  const isBoundary = node.kind === "boundary";
  const role = data.role;
  const edges = canonGraph?.edges || [];
  const nodes = canonGraph?.nodes || [];

  let html = "";

  // 属性
  let attrs = "";
  if (isBoundary) {
    const roleLabel = role === "in" ? "全局输入边界 (Incast)" : "全局输出边界 (Outcast)";
    attrs += inspRow("角色", roleLabel);
  }
  attrs += inspRow("dtype", escHtml(data.dtype || "–"));
  attrs += inspRow("shape", escHtml(fmtShape(data.shape || [])));
  html += inspSection("属性", attrs);

  // 源码声明（仅 boundary）
  if (isBoundary) {
    const bsrc = BOUNDARY_SOURCE[node.id];
    if (bsrc) {
      html += inspSection("源码声明",
        `<pre class="insp-code">${escHtml(bsrc.code)}</pre>` +
        `<div class="insp-src-ref">lightning_indexer_prolog_quant.py · L${bsrc.line}</div>`
      );
    }
    html += inspSection("Step 5 · Parser / IR 生成",
      `<div class="insp-parse-badge">${role === "in" ? "函数入参 → Incast 节点" : "函数出参 → Outcast 节点"}</div>` +
      `<div class="insp-parse-note">pypto.mark_dynamic() 标记动态维度后，IR 生成器将其注册为边界张量</div>`
    );
  }

  // 来源
  const inEdges = edges.filter((e) => e.target === node.id);
  if (inEdges.length) {
    const items = inEdges.map((e) => {
      const src = nodes.find((n) => n.id === e.source);
      if (!src) return "";
      const sem = src.semantic_label ? ` <span class="insp-meta">· ${escHtml(src.semantic_label)}</span>` : "";
      return `<div class="insp-flow-item">← <strong>${escHtml(src.name)}</strong>${sem}</div>`;
    }).join("");
    html += inspSection("来源", items);
  }

  // 去向
  const outEdges = edges.filter((e) => e.source === node.id);
  if (outEdges.length) {
    const items = outEdges.map((e) => {
      const dst = nodes.find((n) => n.id === e.target);
      if (!dst) return "";
      const sem = dst.semantic_label ? ` <span class="insp-meta">· ${escHtml(dst.semantic_label)}</span>` : "";
      return `<div class="insp-flow-item">→ <strong>${escHtml(dst.name)}</strong>${sem}</div>`;
    }).join("");
    html += inspSection("去向", items);
  }

  return html;
}

function setStatus(primary, secondary) {
  statsMeta.textContent = secondary;
  if (toolbarGraphName) toolbarGraphName.textContent = primary;
}

function clearInspector() {
  detailKind.textContent = "-";
  detailSummary.textContent = "Select a node or edge label.";
  detailBody.innerHTML = "";
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

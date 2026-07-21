(async function initializeReportWorkbench() {
  "use strict";

  const els = {
    ideFrame: document.getElementById("ideFrame"),
    workspaceTitle: document.getElementById("workspaceTitle"),
    workspaceCrumbs: document.getElementById("workspaceCrumbs"),
    nodeList: document.getElementById("nodeList"),
    architectureGraph: document.getElementById("architectureGraph"),
    architectureGraphPanel: document.getElementById("architectureGraphPanel"),
    operatorTreePanel: document.getElementById("operatorTreePanel"),
    architectureViewTab: document.getElementById("architectureViewTab"),
    operatorListViewTab: document.getElementById("operatorListViewTab"),
    nodeViewsRailButton: document.getElementById("nodeViewsRailButton"),
    architectureStatus: document.getElementById("architectureStatus"),
    reportDimension: document.getElementById("reportDimension"),
    inspectorTitle: document.getElementById("inspectorTitle"),
    inspectorNodeId: document.getElementById("inspectorNodeId"),
    inspectorSummary: document.getElementById("inspectorSummary"),
    metricGrid: document.getElementById("metricGrid"),
    factList: document.getElementById("factList"),
    operatorList: document.getElementById("operatorList"),
    actionList: document.getElementById("actionList"),
    graphCount: document.getElementById("graphCount"),
    timelineCaption: document.getElementById("timelineCaption"),
    timelineTabSteps: document.getElementById("timelineTabSteps"),
    stepTimelinePanel: document.getElementById("stepTimelinePanel"),
    streamTimelinePanel: document.getElementById("streamTimelinePanel"),
    streamZoomControls: document.getElementById("streamZoomControls"),
    streamZoomOut: document.getElementById("streamZoomOut"),
    streamZoomReset: document.getElementById("streamZoomReset"),
    streamZoomIn: document.getElementById("streamZoomIn"),
    inspectorPane: document.getElementById("reportInspectorPane"),
    inspectorToggle: document.getElementById("inspectorToggle"),
    inspectorClose: document.getElementById("inspectorClose"),
    languageToggle: document.getElementById("languageToggle"),
    languageToggleLabel: document.getElementById("languageToggleLabel"),
    themeToggle: document.getElementById("themeToggle"),
    themeToggleIcon: document.getElementById("themeToggleIcon"),
    bottomPanelToggle: document.getElementById("bottomPanelToggle"),
    bottomDock: document.getElementById("reportBottomDock"),
    footerStatus: document.getElementById("footerStatus"),
  };

  const state = {
    selectedNodeId: "",
    activeArchitectureView: "architecture",
    activeTimelineTab: "streams",
    activeTimelineSegment: -1,
    architectureController: null,
    architectureViewGraph: null,
    pendingArchitectureCenterNodeId: "",
    collapsedArchitectureIds: new Set(),
    visibleArchitectureIds: new Set(),
    operatorTreeExpandedIds: new Set(),
    streamTooltip: null,
    streamResizeTimer: 0,
    streamResizeObserver: null,
    streamZoomIndex: 0,
    bottomPanelExpanded: true,
    language: document.documentElement.lang.startsWith("zh") ? "zh" : "en",
    theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
  };

  const I18N = {
    en: {
      performanceNodes: "Performance Nodes",
      fullModelArchitecture: "Full Model Architecture",
      modelArchitectureView: "Model Architecture",
      operatorListView: "Operator List",
      nodeViews: "Node views",
      stagesGroup: "Model stages",
      layersGroup: "Decoder layers",
      runtimeGroup: "Runtime auxiliary",
      expand: "Expand",
      collapse: "Collapse",
      operatorTreeStatus: (count) => `${count} backend nodes · hierarchical view`,
      inspector: "Inspector",
      performanceMetrics: "Performance Metrics",
      evidence: "Evidence",
      operators: "Operators",
      actions: "Actions",
      stepStreamTimeline: "Step / Stream Timeline",
      streams: "Streams",
      timelineZoom: "Timeline zoom",
      zoomOut: "Zoom out",
      zoomIn: "Zoom in",
      resetZoom: "Reset timeline zoom",
      executionLane: "Execution lane",
      laneTotalsHeader: "Lane totals",
      workbenchPanels: "Workbench panels",
      showBottomPanel: "Show bottom panel",
      hideBottomPanel: "Hide bottom panel",
      noSelection: "No selection",
      selectBackendNode: "Select a backend node",
      noNodeId: "No node_id selected",
      selectHint: "Choose a node in the architecture view, operator list, or a mapped timeline event.",
      noMetrics: "No metrics selected.",
      noEvidence: "No evidence selected.",
      noOperatorRatio: "No operator ratio selected.",
      noBackendRecommendation: "No backend recommendation selected.",
      noOperatorRatioForNode: "No operator ratio is present for this node.",
      noRecommendationInBackend: "No optimization recommendation is present in the backend JSON.",
      switchToChinese: "切换到中文",
      switchToEnglish: "Switch to English",
      switchToLight: "Switch to light mode",
      switchToDark: "Switch to dark mode",
      reportTitle: "Profiling Report",
      nodesCount: (count) => `${count} nodes`,
      architectureStatus: (layers, backend, interactive) => `${layers} source layers · ${backend} backend nodes · ${interactive} interactive · hybrid`,
      graphAria: (model) => `${model} complete source architecture with backend performance overlay`,
      decodeLatency: "decode latency",
      kernelSum: "kernel sum",
      eventMapping: "event mapping",
      globalMfu: "global MFU INT8",
      mappedEvent: "Mapped event",
      unmappedEvent: "Unmapped event",
      representative: "representative",
      mappedCount: (mapped, total) => `${mapped} / ${total} mapped`,
      stepCaption: (step) => `Step ${step} latency and direct event mapping summary`,
      streamCaption: (events, lanes) => `${events} raw events grouped into ${lanes} device / stream / core lanes`,
      events: (count) => `${count} events`,
      laneTotals: (duration, wait) => `duration Σ ${duration} · raw wait Σ ${wait}`,
      footerStatus: (nodes, events, selection) => `${nodes} nodes · ${events} events · ${selection || "no selection"}`,
      noSelectionShort: "no selection",
      appFailed: "application failed",
      architectureLoadFailed: "architecture data failed to load",
    },
    zh: {
      performanceNodes: "性能节点",
      fullModelArchitecture: "完整模型架构",
      modelArchitectureView: "模型架构",
      operatorListView: "算子列表",
      nodeViews: "节点视图",
      stagesGroup: "模型阶段",
      layersGroup: "解码层",
      runtimeGroup: "运行时辅助",
      expand: "展开",
      collapse: "收起",
      operatorTreeStatus: (count) => `${count} 个后端节点 · 层级视图`,
      inspector: "检查器",
      performanceMetrics: "性能指标",
      evidence: "证据",
      operators: "算子",
      actions: "建议",
      stepStreamTimeline: "单步 / 流时间线",
      streams: "泳道",
      timelineZoom: "时间线缩放",
      zoomOut: "缩小",
      zoomIn: "放大",
      resetZoom: "重置时间线缩放",
      executionLane: "执行泳道",
      laneTotalsHeader: "泳道汇总",
      workbenchPanels: "工作台面板",
      showBottomPanel: "显示底部面板",
      hideBottomPanel: "隐藏底部面板",
      noSelection: "未选择",
      selectBackendNode: "请选择后端节点",
      noNodeId: "未选择 node_id",
      selectHint: "请在模型架构、算子列表或已映射的时间线事件中选择节点。",
      noMetrics: "未选择性能指标。",
      noEvidence: "未选择证据。",
      noOperatorRatio: "未选择算子占比。",
      noBackendRecommendation: "未选择后端建议。",
      noOperatorRatioForNode: "后端未提供该节点的算子占比。",
      noRecommendationInBackend: "后端 JSON 未提供优化建议。",
      switchToChinese: "切换到中文",
      switchToEnglish: "切换到英文",
      switchToLight: "切换到浅色模式",
      switchToDark: "切换到深色模式",
      reportTitle: "性能分析报告",
      nodesCount: (count) => `${count} 个节点`,
      architectureStatus: (layers, backend, interactive) => `${layers} 个源码层 · ${backend} 个后端节点 · ${interactive} 个可交互节点 · 混合视图`,
      graphAria: (model) => `${model} 完整源码架构与后端性能数据叠加图`,
      decodeLatency: "解码延迟",
      kernelSum: "核函数耗时总和",
      eventMapping: "事件映射率",
      globalMfu: "全局 MFU INT8",
      mappedEvent: "已映射事件",
      unmappedEvent: "未映射事件",
      representative: "代表步骤",
      mappedCount: (mapped, total) => `${mapped} / ${total} 已映射`,
      stepCaption: (step) => `步骤 ${step} 的延迟与事件映射摘要`,
      streamCaption: (events, lanes) => `${events} 个原始事件，按 ${lanes} 条设备 / 流 / 核泳道分组`,
      events: (count) => `${count} 个事件`,
      laneTotals: (duration, wait) => `耗时总计 Σ ${duration} · 原始等待总计 Σ ${wait}`,
      footerStatus: (nodes, events, selection) => `${nodes} 个节点 · ${events} 个事件 · ${selection || "未选择"}`,
      noSelectionShort: "未选择",
      appFailed: "应用加载失败",
      architectureLoadFailed: "架构数据加载失败",
    },
  };

  const METRIC_LABELS_ZH = {
    "kernel time": "核函数时间",
    "time share": "时间占比",
    operators: "算子数",
    "HBM estimate": "HBM 估算",
    "MFU INT8": "MFU INT8",
    "MFU BF16": "MFU BF16",
  };

  const THEME_ICONS = {
    light: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>',
    dark: '<path d="M12 3a6 6 0 0 0 9 7.2A8 8 0 1 1 12 3Z"></path>',
  };
  const STREAM_ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8];

  function t(key, ...args) {
    const value = I18N[state.language]?.[key] ?? I18N.en[key] ?? key;
    return typeof value === "function" ? value(...args) : value;
  }

  function applyStaticTranslations() {
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
      element.setAttribute("aria-label", t(element.dataset.i18nAria));
    });
  }

  function syncPreferenceControls() {
    const isLight = state.theme === "light";
    const languageLabel = state.language === "en" ? "中" : "EN";
    const languageAction = state.language === "en" ? t("switchToChinese") : t("switchToEnglish");
    const themeAction = isLight ? t("switchToDark") : t("switchToLight");
    document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.theme = state.theme;
    if (els.languageToggleLabel) els.languageToggleLabel.textContent = languageLabel;
    els.languageToggle?.setAttribute("aria-label", languageAction);
    if (els.languageToggle) els.languageToggle.title = languageAction;
    els.themeToggle?.classList.toggle("is-selected", isLight);
    els.themeToggle?.setAttribute("aria-pressed", String(isLight));
    els.themeToggle?.setAttribute("aria-label", themeAction);
    if (els.themeToggle) els.themeToggle.title = themeAction;
    if (els.themeToggleIcon) els.themeToggleIcon.innerHTML = isLight ? THEME_ICONS.dark : THEME_ICONS.light;
  }

  applyStaticTranslations();
  syncPreferenceControls();

  const ideFrameInstance = window.PtoIdeFrame?.init(els.ideFrame) || null;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function loadJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }

  let analysisConfig;
  let reportModel;
  let architectureGraphSpec;
  let architectureOverlayMap;
  let architectureGraph;
  try {
    const [analysis, perf, timeline, graphSpec, overlayMap] = await Promise.all([
      loadJson("./data/ds3_2_analysis_config.json"),
      loadJson("./data/ds3_2_perf_data.json"),
      loadJson("./data/ds3_2_timeline.json"),
      loadJson("./outputs/model_architecture_graph.json"),
      loadJson("./outputs/architecture_overlay_map.json"),
    ]);
    analysisConfig = analysis;
    architectureGraphSpec = graphSpec;
    architectureOverlayMap = overlayMap;
    reportModel = window.DeepSeekReportData.createReportModel(analysis, perf, timeline);
    architectureGraph = window.DeepSeekArchitectureData.createArchitectureGraph(graphSpec, reportModel.reports);
    state.collapsedArchitectureIds = new Set(window.DeepSeekArchitectureData.defaultCollapsedIds(graphSpec));
  } catch (error) {
    els.architectureStatus.textContent = t("architectureLoadFailed");
    els.footerStatus.textContent = error.message;
    console.error(error);
    return;
  }

  const REPORTS = reportModel.reports;
  const REPORT_ORDER = reportModel.reportOrder;
  const TIMELINE = reportModel.timeline;
  const STREAM_SUMMARY = reportModel.streamSummary;
  const STEP_SUMMARY = reportModel.stepSummary;
  const TIMELINE_NODE_COUNTS = TIMELINE.reduce((counts, event) => {
    if (event.nodeId) counts.set(event.nodeId, (counts.get(event.nodeId) || 0) + 1);
    return counts;
  }, new Map());
  const OPERATOR_TREE = createOperatorTree(analysisConfig);
  const OPERATOR_TREE_PARENTS = new Map();
  indexOperatorTree(OPERATOR_TREE, "", OPERATOR_TREE_PARENTS);
  OPERATOR_TREE.forEach((group) => state.operatorTreeExpandedIds.add(group.id));
  state.selectedNodeId = REPORT_ORDER[0] || "";
  expandOperatorAncestors(state.selectedNodeId);

  function formatDuration(us) {
    if (us >= 1000) {
      const value = us / 1000;
      return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ms`;
    }
    return `${us < 10 ? us.toFixed(1) : us.toFixed(0)} us`;
  }

  function metricPercent(value) {
    const match = String(value).match(/(\d+(?:\.\d+)?)\s*%/);
    if (!match) return null;
    return Math.max(0, Math.min(100, Number(match[1])));
  }

  function renderList(container, items) {
    container.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  }

  function renderMetrics(report) {
    els.metricGrid.innerHTML = report.metrics.map(([label, value]) => {
      const localizedLabel = state.language === "zh" ? (METRIC_LABELS_ZH[label] || label) : label;
      const percent = metricPercent(value);
      const bar = percent == null
        ? ""
        : `<div class="metric-bar" style="--metric-bar-width:${percent}%"><span></span></div>`;
      return `
        <div class="metric-tile" data-tone="info">
          <div class="metric-label">${escapeHtml(localizedLabel)}</div>
          <div class="metric-value">${escapeHtml(value)}</div>
          ${bar}
        </div>
      `;
    }).join("");
  }

  function renderOperators(report) {
    if (!report.operators.length) {
      els.operatorList.innerHTML = `<div class="report-inline-empty">${escapeHtml(t("noOperatorRatioForNode"))}</div>`;
      return;
    }
    els.operatorList.innerHTML = report.operators.map(([name, value]) => `
      <div class="operator-row">
        <div class="operator-name">${escapeHtml(name)}</div>
        <div class="operator-value">${escapeHtml(value)}</div>
      </div>
    `).join("");
  }

  function createOperatorTree(config) {
    const toNode = (rawNode) => {
      if (!rawNode?.node_id || !REPORTS[rawNode.node_id]) return null;
      return {
        id: rawNode.node_id,
        nodeId: rawNode.node_id,
        children: (rawNode.children || []).map(toNode).filter(Boolean),
      };
    };
    const group = (id, labelKey, roots) => ({
      id,
      labelKey,
      nodeId: "",
      children: roots.map(toNode).filter(Boolean),
    });
    return [
      group("group/stages", "stagesGroup", Object.values(config.stages || {})),
      group("group/layers", "layersGroup", Object.values(config.layer_structure || {})),
      group("group/runtime", "runtimeGroup", config.runtime_auxiliary || []),
    ].filter((item) => item.children.length);
  }

  function indexOperatorTree(items, parentId, parentIndex) {
    items.forEach((item) => {
      if (parentId) parentIndex.set(item.id, parentId);
      indexOperatorTree(item.children, item.id, parentIndex);
    });
  }

  function expandOperatorAncestors(nodeId) {
    let currentId = nodeId;
    while (OPERATOR_TREE_PARENTS.has(currentId)) {
      const parentId = OPERATOR_TREE_PARENTS.get(currentId);
      state.operatorTreeExpandedIds.add(parentId);
      currentId = parentId;
    }
  }

  function operatorTreeDescendantCount(item) {
    return item.children.reduce((count, child) => count + 1 + operatorTreeDescendantCount(child), 0);
  }

  function renderOperatorTreeItem(item, depth) {
    const isGroup = !item.nodeId;
    const report = item.nodeId ? REPORTS[item.nodeId] : null;
    const label = isGroup ? t(item.labelKey) : report.title;
    const hasChildren = item.children.length > 0;
    const expanded = hasChildren && state.operatorTreeExpandedIds.has(item.id);
    const toggleLabel = `${t(expanded ? "collapse" : "expand")} ${label}`;
    const toggle = hasChildren ? `
      <button type="button" class="operator-tree-toggle" data-tree-toggle="${escapeHtml(item.id)}" aria-label="${escapeHtml(toggleLabel)}" title="${escapeHtml(toggleLabel)}">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"></path></svg>
      </button>
    ` : '<span class="operator-tree-toggle-placeholder" aria-hidden="true"></span>';
    const row = isGroup ? `
      <button type="button" class="operator-tree-group-button" data-tree-toggle="${escapeHtml(item.id)}">
        <span class="operator-tree-toggle" aria-hidden="true">
          <svg viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"></path></svg>
        </span>
        <span class="operator-tree-group-label">${escapeHtml(label)}</span>
        <span class="operator-tree-count">${operatorTreeDescendantCount(item)}</span>
      </button>
    ` : `
      ${toggle}
      <button type="button" class="mapped-node-button operator-tree-node-button" data-node-id="${escapeHtml(item.nodeId)}" aria-current="${item.nodeId === state.selectedNodeId ? "true" : "false"}">
        <span class="node-name">${escapeHtml(label)}</span>
        <span class="node-metric">${escapeHtml(report.metricShort)}</span>
      </button>
    `;
    const children = expanded ? item.children.map((child) => renderOperatorTreeItem(child, depth + 1)).join("") : "";
    return `
      <div class="operator-tree-item${isGroup ? " is-group" : ""}${expanded ? " is-expanded" : ""}" role="treeitem" aria-level="${depth + 1}"${hasChildren ? ` aria-expanded="${expanded}"` : ""} style="--tree-depth:${depth}">
        <div class="operator-tree-row">${row}</div>
        ${children}
      </div>
    `;
  }

  function renderNodeList() {
    els.nodeList.innerHTML = OPERATOR_TREE.map((item) => renderOperatorTreeItem(item, 0)).join("");
    if (state.activeArchitectureView === "operators" && state.selectedNodeId) {
      window.requestAnimationFrame(() => {
        els.nodeList.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
      });
    }
  }

  function renderInspector() {
    const report = REPORTS[state.selectedNodeId];
    if (!report) {
      els.reportDimension.textContent = t("noSelection");
      els.inspectorTitle.textContent = t("selectBackendNode");
      els.inspectorNodeId.textContent = t("noNodeId");
      els.inspectorSummary.textContent = t("selectHint");
      els.metricGrid.innerHTML = `<div class="report-inline-empty">${escapeHtml(t("noMetrics"))}</div>`;
      els.factList.innerHTML = `<li class="report-inline-empty">${escapeHtml(t("noEvidence"))}</li>`;
      els.operatorList.innerHTML = `<div class="report-inline-empty">${escapeHtml(t("noOperatorRatio"))}</div>`;
      els.actionList.innerHTML = `<li class="report-inline-empty">${escapeHtml(t("noBackendRecommendation"))}</li>`;
    } else {
      els.reportDimension.textContent = report.dimension;
      els.inspectorTitle.textContent = report.title;
      els.inspectorNodeId.textContent = report.nodeId;
      els.inspectorSummary.textContent = report.summary;
      renderMetrics(report);
      renderList(els.factList, report.facts);
      renderOperators(report);
      els.actionList.innerHTML = `<li class="report-inline-empty">${escapeHtml(t("noRecommendationInBackend"))}</li>`;
    }
    renderNodeList();
    renderFooterStatus();
  }

  function selectNode(nodeId, options = {}) {
    if (!REPORTS[nodeId]) return;
    if (options.toggle && state.selectedNodeId === nodeId) {
      clearSelection();
      return;
    }
    state.selectedNodeId = nodeId;
    expandOperatorAncestors(nodeId);
    if (options.source !== "timeline") state.activeTimelineSegment = -1;
    renderInspector();
    drawStreamCanvases();
    if (options.syncGraph !== false) {
      const graphNodeId = window.DeepSeekArchitectureData.backendToGraphId(architectureGraphSpec, nodeId);
      if (!graphNodeId) return;
      const centerGraphNode = options.centerGraphNode ?? options.source === "timeline";
      let expandedAncestor = false;
      window.DeepSeekArchitectureData.ancestorIdsForGraphId(architectureGraphSpec, graphNodeId)
        .forEach((collapsedId) => {
        if (!state.collapsedArchitectureIds.has(collapsedId)) return;
        state.collapsedArchitectureIds.delete(collapsedId);
        expandedAncestor = true;
      });
      if (state.activeArchitectureView !== "architecture") {
        state.pendingArchitectureCenterNodeId = centerGraphNode ? graphNodeId : "";
        return;
      }
      if (expandedAncestor) {
        renderArchitecture({
          initialTransform: state.architectureController?.getTransform(),
          activeNodeId: graphNodeId,
          centerNodeId: centerGraphNode ? graphNodeId : "",
        });
      } else {
        state.architectureController?.selectNode(graphNodeId, { source: options.source || "app" });
        if (centerGraphNode) state.architectureController?.centerNode(graphNodeId);
      }
    }
  }

  function clearSelection() {
    state.selectedNodeId = "";
    state.activeTimelineSegment = -1;
    state.pendingArchitectureCenterNodeId = "";
    state.architectureController?.clearSelection();
    drawStreamCanvases();
    renderInspector();
  }

  function evidenceMap() {
    return Object.fromEntries(Object.entries(REPORTS).flatMap(([nodeId, report]) => {
      const graphNodeId = window.DeepSeekArchitectureData.backendToGraphId(architectureGraphSpec, nodeId);
      return graphNodeId ? [[graphNodeId, {
        dimension: report.dimension,
        metric: report.metricShort,
        what: report.summary,
        evidence: report.facts,
      }]] : [];
    }));
  }

  function architectureItemAnchor(graph, nodeId) {
    const node = graph?.nodes?.find((item) => item.id === nodeId);
    if (node) return { x: node.x, y: node.y };
    const cluster = graph?.clusters?.find((item) => item.id === nodeId);
    return cluster ? { x: cluster.x + cluster.width / 2, y: cluster.y + 18 } : null;
  }

  function syncArchitectureViewStatus() {
    if (state.activeArchitectureView === "operators") {
      els.architectureStatus.textContent = t("operatorTreeStatus", REPORT_ORDER.length);
      return;
    }
    els.architectureStatus.textContent = t(
      "architectureStatus",
      architectureGraph.metadata.fullMainLayerCount,
      architectureGraph.metadata.backendNodeCount,
      state.architectureViewGraph?.metadata.interactiveItemCount || 0,
    );
  }

  function activateArchitectureView(viewName) {
    const previousView = state.activeArchitectureView;
    state.activeArchitectureView = viewName === "operators" ? "operators" : "architecture";
    document.querySelectorAll("[data-architecture-view]").forEach((button) => {
      const selected = button.dataset.architectureView === state.activeArchitectureView;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    els.architectureGraphPanel.hidden = state.activeArchitectureView !== "architecture";
    els.operatorTreePanel.hidden = state.activeArchitectureView !== "operators";
    els.nodeViewsRailButton.setAttribute("aria-label", t("operatorListView"));
    els.nodeViewsRailButton.title = t("operatorListView");
    if (state.activeArchitectureView === "operators") renderNodeList();
    syncArchitectureViewStatus();
    if (state.activeArchitectureView === "architecture" && previousView !== "architecture") {
      const initialTransform = state.architectureController?.getTransform();
      const activeNodeId = window.DeepSeekArchitectureData.backendToGraphId(
        architectureGraphSpec,
        state.selectedNodeId,
      );
      const centerNodeId = state.pendingArchitectureCenterNodeId;
      state.pendingArchitectureCenterNodeId = "";
      window.requestAnimationFrame(() => renderArchitecture({ initialTransform, activeNodeId, centerNodeId }));
    }
  }

  function renderArchitecture(options = {}) {
    const helper = window.PtoModelGraphvizPattern;
    if (!helper) throw new Error("model-graphviz pattern is unavailable");
    const architectureView = window.DeepSeekArchitectureData.createArchitectureView(
      architectureGraphSpec,
      REPORTS,
      state.collapsedArchitectureIds,
    );
    let initialTransform = options.initialTransform ? { ...options.initialTransform } : null;
    if (initialTransform && options.anchor) {
      const nextAnchor = architectureItemAnchor(architectureView, options.anchor.nodeId);
      if (nextAnchor) {
        initialTransform.tx += (options.anchor.x - nextAnchor.x) * initialTransform.zoom;
        initialTransform.ty += (options.anchor.y - nextAnchor.y) * initialTransform.zoom;
      }
    }
    state.architectureViewGraph = architectureView;
    state.visibleArchitectureIds = new Set([
      ...architectureView.nodes.map((node) => node.id),
      ...architectureView.clusters.map((cluster) => cluster.id),
    ]);
    state.architectureController?.destroy();
    state.architectureController = helper.renderController(els.architectureGraph, architectureView, {
      ariaLabel: t("graphAria", reportModel.identity.modelId),
      className: "pto-model-architecture-stage",
      autoFit: !initialTransform,
      fitMode: "readable",
      viewportPadding: 28,
      minReadableZoom: 0.68,
      initialTransform,
      activeNodeId: options.activeNodeId,
      selectableClusters: true,
      metricOverlays: true,
      reportOverlays: false,
      edgeTags: false,
      evidenceMap: evidenceMap(),
      colormap: helper.modelArchitectureColormap(architectureView),
      onToggle({ nodeId, collapsed }) {
        const transform = state.architectureController?.getTransform();
        const anchor = architectureItemAnchor(state.architectureViewGraph, nodeId);
        if (collapsed) {
          state.collapsedArchitectureIds.delete(nodeId);
        } else {
          state.collapsedArchitectureIds.add(nodeId);
        }
        const selectedGraphId = window.DeepSeekArchitectureData.backendToGraphId(
          architectureGraphSpec,
          state.selectedNodeId,
        );
        const selectedAncestors = window.DeepSeekArchitectureData.ancestorIdsForGraphId(
          architectureGraphSpec,
          selectedGraphId,
        );
        const selectedIsHidden = !collapsed && selectedAncestors.includes(nodeId);
        const collapsedNodeIsMapped = Boolean(
          window.DeepSeekArchitectureData.graphToBackendNodeId(architectureGraphSpec, nodeId),
        );
        renderArchitecture({
          initialTransform: transform,
          activeNodeId: selectedIsHidden && collapsedNodeIsMapped ? nodeId : selectedGraphId,
          anchor: anchor ? { nodeId, ...anchor } : null,
        });
      },
      onSelect({ nodeId, source }) {
        const backendNodeId = window.DeepSeekArchitectureData.graphToBackendNodeId(
          architectureGraphSpec,
          nodeId,
        );
        if (!REPORTS[backendNodeId]) return;
        if (state.selectedNodeId === backendNodeId) {
          if (["graph", "keyboard", "cluster"].includes(source)) {
            selectNode(backendNodeId, { syncGraph: false, source: "graph" });
          }
          return;
        }
        selectNode(backendNodeId, { syncGraph: false, source: "graph" });
      },
    });
    if (options.centerNodeId) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => state.architectureController?.centerNode(options.centerNodeId));
      });
    }
    syncArchitectureViewStatus();
    els.graphCount.textContent = `${architectureOverlayMap.validation.mapped_or_classified_backend_node_count} / ${reportModel.counts.analysisNodes}`;
  }

  function streamBounds() {
    const minStart = Math.min(...TIMELINE.map((event) => event.startUs));
    const maxEnd = Math.max(...TIMELINE.map((event) => event.endUs));
    return { minStart, maxEnd, span: maxEnd - minStart };
  }

  function renderStepTimeline() {
    const summary = [
      [t("decodeLatency"), formatDuration(STEP_SUMMARY.decodeLatencyUs)],
      [t("kernelSum"), formatDuration(STEP_SUMMARY.kernelSumUs)],
      [t("eventMapping"), `${STEP_SUMMARY.mappingCoveragePct.toFixed(1)}%`],
      [t("globalMfu"), `${STEP_SUMMARY.globalMfuInt8Pct.toFixed(2)}%`],
    ].map(([label, value]) => `
      <div class="timeline-stat">
        <div class="timeline-stat-label">${escapeHtml(label)}</div>
        <div class="timeline-stat-value">${escapeHtml(value)}</div>
      </div>
    `).join("");
    const mappedPct = STEP_SUMMARY.eventCount ? STEP_SUMMARY.mappedEvents / STEP_SUMMARY.eventCount * 100 : 0;
    const unmappedPct = Math.max(0, 100 - mappedPct);
    els.stepTimelinePanel.innerHTML = `
      <div class="timeline-summary-grid">${summary}</div>
      <div class="timeline-legend" aria-label="event mapping legend">
        <span class="legend-item"><span class="legend-swatch" style="--legend-color:var(--success)"></span>${escapeHtml(t("mappedEvent"))}</span>
        <span class="legend-item"><span class="legend-swatch" style="--legend-color:var(--danger)"></span>${escapeHtml(t("unmappedEvent"))}</span>
      </div>
      <div class="step-timeline">
        <div class="step-row" data-kind="representative">
          <div class="step-label"><span class="step-name">${state.language === "zh" ? "步骤" : "Step"} ${escapeHtml(STEP_SUMMARY.step)}</span><span class="step-meta">${escapeHtml(t("representative"))}</span></div>
          <div class="step-stack" title="${STEP_SUMMARY.mappedEvents} mapped, ${STEP_SUMMARY.unmappedEvents} unmapped events">
            <span class="step-stack-compute" style="width:${mappedPct}%"></span>
            <span class="step-stack-free" style="width:${unmappedPct}%"></span>
          </div>
          <div class="step-values">${escapeHtml(t("mappedCount", STEP_SUMMARY.mappedEvents, STEP_SUMMARY.eventCount))}</div>
        </div>
      </div>
    `;
  }

  function scheduleStreamDraw() {
    window.clearTimeout(state.streamResizeTimer);
    state.streamResizeTimer = window.setTimeout(() => {
      updateStreamChartWidth();
      window.requestAnimationFrame(() => window.requestAnimationFrame(drawStreamCanvases));
    }, 0);
  }

  function streamZoom() {
    return STREAM_ZOOM_LEVELS[state.streamZoomIndex] || 1;
  }

  function syncStreamZoomControls() {
    const zoom = streamZoom();
    const visible = state.activeTimelineTab === "streams";
    els.streamZoomControls.hidden = !visible;
    els.streamZoomControls.setAttribute("aria-label", t("timelineZoom"));
    els.streamZoomOut.disabled = state.streamZoomIndex === 0;
    els.streamZoomIn.disabled = state.streamZoomIndex === STREAM_ZOOM_LEVELS.length - 1;
    els.streamZoomReset.textContent = `${Math.round(zoom * 100)}%`;
    els.streamZoomOut.setAttribute("aria-label", t("zoomOut"));
    els.streamZoomOut.title = t("zoomOut");
    els.streamZoomIn.setAttribute("aria-label", t("zoomIn"));
    els.streamZoomIn.title = t("zoomIn");
    els.streamZoomReset.setAttribute("aria-label", t("resetZoom"));
    els.streamZoomReset.title = t("resetZoom");
  }

  function updateStreamChartWidth() {
    const scroller = els.streamTimelinePanel.querySelector(".stream-lane-scroller");
    const chart = scroller?.querySelector(".stream-lane-chart");
    if (!scroller || !chart) return;
    const fixedColumnsAndGaps = 390;
    const baseTrackWidth = Math.max(240, scroller.clientWidth - fixedColumnsAndGaps);
    chart.style.width = `${Math.ceil(fixedColumnsAndGaps + baseTrackWidth * streamZoom())}px`;
  }

  function setStreamZoom(nextIndex) {
    const scroller = els.streamTimelinePanel.querySelector(".stream-lane-scroller");
    const viewportCenterRatio = scroller?.scrollWidth
      ? (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth
      : 0.5;
    state.streamZoomIndex = Math.max(0, Math.min(STREAM_ZOOM_LEVELS.length - 1, nextIndex));
    syncStreamZoomControls();
    updateStreamChartWidth();
    window.requestAnimationFrame(() => {
      if (scroller) {
        scroller.scrollLeft = viewportCenterRatio * scroller.scrollWidth - scroller.clientWidth / 2;
      }
      scheduleStreamDraw();
    });
  }

  function renderStreamTimeline() {
    const { minStart, span } = streamBounds();
    const rulerTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio, index, ticks) => `
      <span class="stream-time-tick${index === 0 ? " is-start" : index === ticks.length - 1 ? " is-end" : ""}" style="--tick-position:${ratio * 100}%">
        <span>${escapeHtml(formatDuration(minStart + span * ratio))}</span>
      </span>
    `).join("");
    const laneRows = STREAM_SUMMARY.map((lane) => `
      <div class="stream-lane-row pto-pattern-swimlane-task__row" data-lane="${escapeHtml(lane.lane)}">
        <div class="stream-label pto-pattern-swimlane-task__label" title="${escapeHtml(t("events", lane.ops))}">${escapeHtml(lane.lane)} · ${escapeHtml(t("events", lane.ops))}</div>
        <div class="stream-lane-cell"><canvas class="stream-lane-canvas pto-pattern-swimlane-task__canvas" data-lane="${escapeHtml(lane.lane)}" tabindex="0" aria-label="${escapeHtml(lane.lane)} event timeline"></canvas></div>
        <div class="stream-lane-values">${escapeHtml(t("laneTotals", formatDuration(lane.opUs), formatDuration(lane.waitUs)))}</div>
      </div>
    `).join("");
    els.streamTimelinePanel.innerHTML = `
      <div class="stream-lane-scroller">
        <div class="stream-lane-chart pto-pattern-swimlane-task">
          <div class="stream-lane-header stream-lane-row" aria-hidden="true">
            <div class="stream-label stream-lane-header-cell">${escapeHtml(t("executionLane"))}</div>
            <div class="stream-time-ruler">${rulerTicks}</div>
            <div class="stream-lane-values stream-lane-header-cell">${escapeHtml(t("laneTotalsHeader"))}</div>
          </div>
          ${laneRows}
        </div>
      </div>
    `;
    syncStreamZoomControls();
    updateStreamChartWidth();
    bindStreamCanvasInteractions();
    if (!state.streamResizeObserver && "ResizeObserver" in window) {
      state.streamResizeObserver = new ResizeObserver(scheduleStreamDraw);
      state.streamResizeObserver.observe(els.streamTimelinePanel);
    }
    scheduleStreamDraw();
  }

  function segmentsForLane(lane) {
    return TIMELINE
      .map((event, index) => ({ ...event, index }))
      .filter((event) => event.lane === lane)
      .sort((left, right) => left.startUs - right.startUs);
  }

  function streamTask(segment, lane) {
    return {
      label: segment.name,
      displayName: segment.name,
      rawName: segment.name,
      opName: segment.name,
      laneKind: segment.core,
      laneId: lane,
      totalCycle: segment.wallUs,
      gap: segment.waitUs,
      status: segment.category,
      dominantCounter: segment.nodeId || "owner_node_id=null",
    };
  }

  function drawStreamCanvases() {
    const helper = window.PtoSwimlaneTaskPattern;
    if (!helper || !els.streamTimelinePanel) return;
    const { minStart, span } = streamBounds();
    const fontFamily = window.getComputedStyle(document.body).fontFamily;
    const hasLinkedTimelineSelection = Boolean(
      state.selectedNodeId && TIMELINE_NODE_COUNTS.get(state.selectedNodeId),
    );
    els.streamTimelinePanel.querySelectorAll(".stream-lane-canvas").forEach((canvas) => {
      const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.parentElement?.clientWidth || 1));
      const height = 12;
      const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      const context = canvas.getContext("2d");
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      const lane = canvas.dataset.lane;
      let linkedEventCount = 0;
      canvas.__reportSegments = segmentsForLane(lane).map((segment) => {
        const x = ((segment.startUs - minStart) / span) * width;
        const segmentWidth = Math.max(1, (segment.wallUs / span) * width);
        const geometry = { x, y: 1, width: Math.min(segmentWidth, width - x), height: 10, segment };
        const isActive = segment.index === state.activeTimelineSegment;
        const isLinked = Boolean(segment.nodeId && segment.nodeId === state.selectedNodeId);
        if (isLinked) linkedEventCount += 1;
        context.save();
        context.globalAlpha = hasLinkedTimelineSelection && !isLinked ? 0.26 : 1;
        helper.drawTaskBar(context, {
          ...geometry,
          baseColor: segment.color,
          fontFamily,
          task: streamTask(segment, lane),
          isSelected: isActive || (isLinked && state.activeTimelineSegment < 0),
          isEmphasized: isLinked,
          isRelated: isLinked && !isActive,
        });
        context.restore();
        return geometry;
      });
      canvas.dataset.linkedEventCount = String(linkedEventCount);
      canvas.closest(".stream-lane-row")?.classList.toggle("has-linked-selection", linkedEventCount > 0);
    });
  }

  function canvasHit(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return [...(canvas.__reportSegments || [])].reverse().find((hit) => (
      x >= hit.x && x <= hit.x + hit.width && y >= hit.y && y <= hit.y + hit.height
    )) || null;
  }

  function activateSegment(segment) {
    if (!segment) return;
    state.activeTimelineSegment = segment.index;
    if (segment.nodeId && REPORTS[segment.nodeId]) {
      selectNode(segment.nodeId, { source: "timeline" });
      return;
    }
    state.selectedNodeId = "";
    state.architectureController?.clearSelection();
    renderInspector();
    drawStreamCanvases();
  }

  function bindStreamCanvasInteractions() {
    const helper = window.PtoSwimlaneTaskPattern;
    if (!helper) return;
    state.streamTooltip?.remove();
    state.streamTooltip = helper.createTooltip();
    els.streamTimelinePanel.appendChild(state.streamTooltip);
    els.streamTimelinePanel.querySelectorAll(".stream-lane-canvas").forEach((canvas) => {
      canvas.addEventListener("click", (event) => activateSegment(canvasHit(canvas, event)?.segment));
      canvas.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const segments = segmentsForLane(canvas.dataset.lane);
        activateSegment(segments.find((segment) => segment.index === state.activeTimelineSegment) || segments[0]);
      });
      canvas.addEventListener("pointermove", (event) => {
        const hit = canvasHit(canvas, event);
        if (!hit) {
          helper.hideTooltip(state.streamTooltip);
          return;
        }
        helper.showTooltip(state.streamTooltip, streamTask(hit.segment, canvas.dataset.lane), event, {
          bounds: els.streamTimelinePanel,
          target: canvas,
          durationUnit: "us",
        });
      });
      canvas.addEventListener("pointerleave", () => helper.hideTooltip(state.streamTooltip));
    });
  }

  function activateTimelineTab(tabName) {
    state.activeTimelineTab = tabName;
    document.querySelectorAll("[data-timeline-tab]").forEach((button) => {
      const selected = button.dataset.timelineTab === tabName;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    els.stepTimelinePanel.hidden = tabName !== "steps";
    els.streamTimelinePanel.hidden = tabName !== "streams";
    els.timelineCaption.textContent = tabName === "steps"
      ? t("stepCaption", STEP_SUMMARY.step)
      : t("streamCaption", TIMELINE.length, STREAM_SUMMARY.length);
    syncStreamZoomControls();
    if (tabName === "streams") scheduleStreamDraw();
  }

  function renderFooterStatus() {
    const selected = REPORTS[state.selectedNodeId];
    els.footerStatus.textContent = t(
      "footerStatus",
      reportModel.counts.analysisNodes,
      reportModel.counts.timelineEvents,
      selected?.metricShort || t("noSelectionShort"),
    );
  }

  function persistPreference(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_error) {
      // Persistence is optional; the visible preference still applies.
    }
  }

  function setLanguage(language) {
    state.language = language === "zh" ? "zh" : "en";
    persistPreference("dsv32-report-language", state.language);
    applyStaticTranslations();
    syncPreferenceControls();
    syncBottomPanelToggle();
    const transform = state.architectureController?.getTransform();
    const activeNodeId = window.DeepSeekArchitectureData.backendToGraphId(
      architectureGraphSpec,
      state.selectedNodeId,
    );
    if (state.activeArchitectureView === "architecture") {
      renderArchitecture({ initialTransform: transform, activeNodeId });
    } else {
      syncArchitectureViewStatus();
    }
    renderStepTimeline();
    renderStreamTimeline();
    activateTimelineTab(state.activeTimelineTab);
    renderInspector();
    els.timelineTabSteps.textContent = state.language === "zh"
      ? `步骤 ${STEP_SUMMARY.step}`
      : `Step ${STEP_SUMMARY.step}`;
    document.title = `${reportModel.identity.modelId} ${t("reportTitle")}`;
  }

  function setTheme(theme) {
    state.theme = theme === "light" ? "light" : "dark";
    persistPreference("dsv32-report-theme", state.theme);
    syncPreferenceControls();
    const transform = state.architectureController?.getTransform();
    const activeNodeId = window.DeepSeekArchitectureData.backendToGraphId(
      architectureGraphSpec,
      state.selectedNodeId,
    );
    if (state.activeArchitectureView === "architecture") {
      renderArchitecture({ initialTransform: transform, activeNodeId });
    }
    scheduleStreamDraw();
  }

  function setInspectorExpanded(expanded) {
    const gutter = els.inspectorPane.previousElementSibling?.matches?.(".pto-workbench-shell__split-gutter")
      ? els.inspectorPane.previousElementSibling
      : null;
    els.inspectorPane.hidden = !expanded;
    els.inspectorPane.setAttribute("aria-hidden", String(!expanded));
    if (gutter) gutter.hidden = !expanded;
    els.inspectorToggle?.classList.toggle("is-selected", expanded);
    els.inspectorToggle?.setAttribute("aria-expanded", String(expanded));
    els.inspectorToggle?.setAttribute("aria-pressed", String(expanded));
    window.requestAnimationFrame(() => {
      ideFrameInstance?.refresh();
      if (state.activeArchitectureView === "architecture") state.architectureController?.fit();
      drawStreamCanvases();
    });
  }

  function syncBottomPanelToggle() {
    const action = t(state.bottomPanelExpanded ? "hideBottomPanel" : "showBottomPanel");
    els.bottomPanelToggle?.classList.toggle("is-selected", state.bottomPanelExpanded);
    els.bottomPanelToggle?.setAttribute("aria-expanded", String(state.bottomPanelExpanded));
    els.bottomPanelToggle?.setAttribute("aria-pressed", String(state.bottomPanelExpanded));
    els.bottomPanelToggle?.setAttribute("aria-label", action);
    if (els.bottomPanelToggle) els.bottomPanelToggle.title = action;
  }

  function setBottomPanelExpanded(expanded) {
    state.bottomPanelExpanded = Boolean(expanded);
    const gutter = els.bottomDock.previousElementSibling?.matches?.(".pto-workbench-shell__split-gutter")
      ? els.bottomDock.previousElementSibling
      : null;
    els.bottomDock.hidden = !state.bottomPanelExpanded;
    els.bottomDock.setAttribute("aria-hidden", String(!state.bottomPanelExpanded));
    if (gutter) gutter.hidden = !state.bottomPanelExpanded;
    syncBottomPanelToggle();
    window.requestAnimationFrame(() => {
      ideFrameInstance?.refresh();
      if (state.activeArchitectureView === "architecture") state.architectureController?.fit();
      if (state.bottomPanelExpanded) drawStreamCanvases();
    });
  }

  els.nodeList.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-tree-toggle]");
    if (toggle) {
      const itemId = toggle.dataset.treeToggle;
      if (state.operatorTreeExpandedIds.has(itemId)) state.operatorTreeExpandedIds.delete(itemId);
      else state.operatorTreeExpandedIds.add(itemId);
      renderNodeList();
      return;
    }
    const button = event.target.closest("[data-node-id]");
    if (button) selectNode(button.dataset.nodeId, { source: "operator-list" });
  });
  els.languageToggle?.addEventListener("click", () => {
    setLanguage(state.language === "en" ? "zh" : "en");
  });
  els.themeToggle?.addEventListener("click", () => {
    setTheme(state.theme === "light" ? "dark" : "light");
  });
  els.inspectorToggle?.addEventListener("click", () => setInspectorExpanded(els.inspectorPane.hidden));
  els.inspectorClose?.addEventListener("click", () => setInspectorExpanded(false));
  els.bottomPanelToggle?.addEventListener("click", () => {
    setBottomPanelExpanded(!state.bottomPanelExpanded);
  });
  els.streamZoomOut?.addEventListener("click", () => setStreamZoom(state.streamZoomIndex - 1));
  els.streamZoomReset?.addEventListener("click", () => setStreamZoom(0));
  els.streamZoomIn?.addEventListener("click", () => setStreamZoom(state.streamZoomIndex + 1));
  document.querySelectorAll("[data-timeline-tab]").forEach((button) => {
    button.addEventListener("click", () => activateTimelineTab(button.dataset.timelineTab));
  });
  document.querySelectorAll("[data-architecture-view]").forEach((button) => {
    button.addEventListener("click", () => activateArchitectureView(button.dataset.architectureView));
  });
  els.nodeViewsRailButton?.addEventListener("click", () => activateArchitectureView("operators"));
  window.addEventListener("resize", () => {
    scheduleStreamDraw();
  });

  document.title = `${reportModel.identity.modelId} ${t("reportTitle")}`;
  els.workspaceTitle.textContent = reportModel.identity.modelId;
  els.workspaceCrumbs.textContent = `${reportModel.identity.reportId} · schema ${analysisConfig.schema_version}`;
  els.timelineTabSteps.textContent = state.language === "zh"
    ? `步骤 ${STEP_SUMMARY.step}`
    : `Step ${STEP_SUMMARY.step}`;
  const initialGraphNodeId = window.DeepSeekArchitectureData.backendToGraphId(
    architectureGraphSpec,
    state.selectedNodeId,
  );
  renderArchitecture({ activeNodeId: initialGraphNodeId });
  activateArchitectureView("architecture");
  renderStepTimeline();
  renderStreamTimeline();
  activateTimelineTab("streams");
  renderInspector();
  setInspectorExpanded(true);
  setBottomPanelExpanded(true);
})().catch((error) => {
  document.getElementById("footerStatus").textContent = error.message;
  document.getElementById("architectureStatus").textContent = "application failed";
  console.error(error);
});

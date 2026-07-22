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
    operatorSelectBar: document.getElementById("operatorSelectBar"),
    inspectorPanelDefinition: document.getElementById("inspectorPanelDefinition"),
    inspectorPanelSupport: document.getElementById("inspectorPanelSupport"),
    inspectorPanelPrecision: document.getElementById("inspectorPanelPrecision"),
    inspectorPanelApi: document.getElementById("inspectorPanelApi"),
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
    fusionAdvisorToggle: document.getElementById("fusionAdvisorToggle"),
    fusionAdvisorPanel: document.getElementById("fusionAdvisorPanel"),
    fusionAdvisorBackdrop: document.getElementById("fusionAdvisorBackdrop"),
    fusionAdvisorClose: document.getElementById("fusionAdvisorClose"),
    fusionAdvisorBody: document.getElementById("fusionAdvisorBody"),
    fusionAdvisorSubtitle: document.getElementById("fusionAdvisorSubtitle"),
    fusionAdvisorResize: document.getElementById("fusionAdvisorResize"),
    fusionMarkerToggle: document.getElementById("fusionMarkerToggle"),
  };

  const state = {
    selectedNodeId: "",
    activeInspectorTab: "performance",
    selectedOperatorName: "",
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
    fusionAdvisorOpen: false,
    fusionAdvisorWidth: 460,
    fusionExpandedIds: new Set(),
    fusionMarkersVisible: true,
    activeFusionRec: "",
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
      inspectorTabs: "Inspector detail categories",
      tabPerformance: "Performance",
      tabDefinition: "Definition",
      tabSupport: "Support",
      tabPrecision: "Precision",
      tabApi: "API",
      operatorSelectLabel: "Operator",
      curatedBadge: "curated",
      genericBadge: "inferred",
      definitionSummary: "Definition",
      formula: "Formula",
      inputs: "Inputs",
      outputs: "Outputs",
      supportedHardware: "Supported Ascend hardware",
      dataTypes: "Data types",
      dataFormats: "Data formats",
      supportNotes: "Notes",
      precisionMode: "Precision mode",
      precisionError: "Reference error",
      precisionNotes: "Notes",
      apiDocs: "API documentation",
      apiRepos: "Repositories",
      noOperatorDetail: "This node has no operator breakdown to describe.",
      noIoSignature: "No I/O signature is curated for this operator.",
      openLink: "Open ↗",
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
      fusionAdvisorGroup: "Fusion advisor",
      fusionAdvisorToggleLabel: "Fusion operator recommendations",
      fusionAdvisorTitle: "Fusion Operator Recommendations",
      fusionAdvisorSubtitle: (opp, applied) => `${opp} un-fused opportunit${opp === 1 ? "y" : "ies"} · ${applied} fusion${applied === 1 ? "" : "s"} already applied`,
      fusionGroupOpportunity: "Recommended — not yet fused",
      fusionGroupApplied: "Applied in this graph",
      fusionReason: "Why fuse",
      fusionEvidence: "Measured hotspot",
      fusionConstraint: "Ascend constraints",
      fusionUnit: "Hardware unit",
      fusionStatusOpportunity: "Opportunity",
      fusionStatusApplied: "Applied",
      fusionFlowTitle: "Before → After",
      fusionFlowBefore: "Unfused",
      fusionFlowAfter: "Fused",
      fusionFlowKernels: "Kernels / launches",
      fusionFlowHops: "HBM · comm round-trips",
      fusionFlowOnchip: "intermediates stay on-chip",
      fusionFlowHbm: "HBM round-trip",
      fusionFlowComm: "blocking collective",
      fusionHardwareTitle: "Ascend hardware path",
      fusionHardwareArch: "Ascend 950B",
      fusionHardwareBefore: "Before",
      fusionHardwareAfter: "After",
      fusionHardwareDetailsOn: "Details on",
      fusionHardwareDetailsOff: "Details off",
      fusionHardwareFocus: "Path focus",
      fusionAdvisorResizeLabel: "Resize fusion advisor",
      fusionHardwareCompute: "Compute",
      fusionHardwareMove: "Data movement",
      fusionHardwareComm: "Communication",
      fusionGroupLabel: (count, fused) => `${count} op${count === 1 ? "" : "s"} ⇒ ${fused}`,
      fusionCodeCompare: "Code · framework → Ascend",
      fusionCodeBefore: "Framework (unfused)",
      fusionCodeAfter: "Ascend fused operator",
      fusionCannDoc: "CANN operator",
      fusionAffected: "Affected operators",
      fusionPrioStar: "TOP",
      fusionPrioHigh: "HIGH",
      fusionPrioMedium: "MED",
      fusionLocate: "Locate on graph",
      fusionMarkersLabel: "Toggle fusion markers",
      close: "Close",
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
      inspectorTabs: "检查器详情分类",
      tabPerformance: "性能",
      tabDefinition: "算子定义",
      tabSupport: "支持情况",
      tabPrecision: "精度",
      tabApi: "API 学习",
      operatorSelectLabel: "算子",
      curatedBadge: "已收录",
      genericBadge: "推断",
      definitionSummary: "定义",
      formula: "公式",
      inputs: "输入",
      outputs: "输出",
      supportedHardware: "支持的昇腾硬件",
      dataTypes: "数据类型",
      dataFormats: "数据格式",
      supportNotes: "说明",
      precisionMode: "精度模式",
      precisionError: "参考误差",
      precisionNotes: "说明",
      apiDocs: "API 文档",
      apiRepos: "代码仓库",
      noOperatorDetail: "该节点没有可展示的算子构成。",
      noIoSignature: "暂未收录该算子的输入输出签名。",
      openLink: "打开 ↗",
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
      fusionAdvisorGroup: "融合算子推荐",
      fusionAdvisorToggleLabel: "融合算子推荐",
      fusionAdvisorTitle: "融合算子推荐",
      fusionAdvisorSubtitle: (opp, applied) => `${opp} 个待融合机会 · ${applied} 个已应用融合`,
      fusionGroupOpportunity: "推荐 — 尚未融合",
      fusionGroupApplied: "本图已应用",
      fusionReason: "推荐理由",
      fusionEvidence: "实测热点",
      fusionConstraint: "昇腾约束",
      fusionUnit: "硬件单元",
      fusionStatusOpportunity: "待融合",
      fusionStatusApplied: "已应用",
      fusionFlowTitle: "融合前 → 融合后",
      fusionFlowBefore: "未融合",
      fusionFlowAfter: "已融合",
      fusionFlowKernels: "Kernel / 下发次数",
      fusionFlowHops: "HBM · 通信往返",
      fusionFlowOnchip: "中间结果驻留片上",
      fusionFlowHbm: "HBM 往返",
      fusionFlowComm: "阻塞式集合通信",
      fusionHardwareTitle: "昇腾硬件路径",
      fusionHardwareArch: "Ascend 950B",
      fusionHardwareBefore: "融合前",
      fusionHardwareAfter: "融合后",
      fusionHardwareDetailsOn: "细节开",
      fusionHardwareDetailsOff: "细节关",
      fusionHardwareFocus: "路径聚焦",
      fusionAdvisorResizeLabel: "调整融合面板宽度",
      fusionHardwareCompute: "计算",
      fusionHardwareMove: "数据搬运",
      fusionHardwareComm: "通信",
      fusionGroupLabel: (count, fused) => `${count} 个算子 ⇒ ${fused}`,
      fusionCodeCompare: "代码对照 · 框架 → 昇腾",
      fusionCodeBefore: "框架实现（未融合）",
      fusionCodeAfter: "昇腾融合算子",
      fusionCannDoc: "对应 CANN 算子",
      fusionAffected: "影响算子",
      fusionPrioStar: "首选",
      fusionPrioHigh: "高",
      fusionPrioMedium: "中",
      fusionLocate: "在图中定位",
      fusionMarkersLabel: "切换融合标记",
      close: "关闭",
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
  const FUSION_ADVISOR_WIDTH_KEY = "dsv32-report-fusion-advisor-width";
  const FUSION_ADVISOR_MIN_WIDTH = 360;
  const FUSION_ADVISOR_MAX_WIDTH = 760;

  function t(key, ...args) {
    const value = I18N[state.language]?.[key] ?? I18N.en[key] ?? key;
    return typeof value === "function" ? value(...args) : value;
  }

  // Resolve a bilingual { en, zh } field from the operator knowledge base.
  function loc(field) {
    if (field == null) return "";
    if (typeof field === "string") return field;
    return field[state.language] ?? field.en ?? "";
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
  applyFusionAdvisorWidth(readFusionAdvisorWidth(), false);

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

  // ----- Fusion recommendation ↔ architecture-graph index -----
  // Map each fusion recommendation to the concrete leaf nodes on the architecture
  // graph whose dominant operator defines that fusion (its `graphOps`). Leaves that
  // are collapsed in the current view fall back to their nearest visible ancestor so
  // the 6 schemes stay marked at every zoom / collapse level.
  const FUSION_RECS = window.DeepSeekFusionAdvisor?.RECS || [];
  const FUSION_RECS_BY_ID = new Map(FUSION_RECS.map((rec) => [rec.id, rec]));
  const FUSION_PRIO_RANK = { star: 3, high: 2, medium: 1 };
  const FUSION_OP_TO_RECS = new Map();
  FUSION_RECS.forEach((rec) => {
    (rec.graphOps || []).forEach((op) => {
      if (!FUSION_OP_TO_RECS.has(op)) FUSION_OP_TO_RECS.set(op, []);
      FUSION_OP_TO_RECS.get(op).push(rec.id);
    });
  });
  const FUSION_TARGETS = new Map(); // graph node id -> Set(recId)
  Object.entries(REPORTS).forEach(([backendNodeId, report]) => {
    const dominant = report.operators?.[0]?.[0];
    if (!dominant) return;
    const recIds = FUSION_OP_TO_RECS.get(dominant);
    if (!recIds || !recIds.length) return;
    const graphId = window.DeepSeekArchitectureData.backendToGraphId(architectureGraphSpec, backendNodeId);
    if (!graphId) return;
    if (!FUSION_TARGETS.has(graphId)) FUSION_TARGETS.set(graphId, new Set());
    recIds.forEach((id) => FUSION_TARGETS.get(graphId).add(id));
  });
  // Keep only the most specific fusion points: if a matched node is an ancestor of
  // another matched node for the same recommendation, it is a rollup aggregate — drop
  // it so the marker lands on the concrete operator rather than the whole subtree.
  (() => {
    const recToIds = new Map();
    FUSION_TARGETS.forEach((recSet, graphId) => {
      recSet.forEach((recId) => {
        if (!recToIds.has(recId)) recToIds.set(recId, []);
        recToIds.get(recId).push(graphId);
      });
    });
    recToIds.forEach((ids, recId) => {
      ids.forEach((id) => {
        const isAncestorOfAnother = ids.some((other) => other !== id
          && window.DeepSeekArchitectureData.ancestorIdsForGraphId(architectureGraphSpec, other).includes(id));
        if (isAncestorOfAnother) FUSION_TARGETS.get(id)?.delete(recId);
      });
    });
    [...FUSION_TARGETS].forEach(([id, recSet]) => {
      if (!recSet.size) FUSION_TARGETS.delete(id);
    });
  })();

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

  const DETAIL_PANELS = {
    definition: () => els.inspectorPanelDefinition,
    support: () => els.inspectorPanelSupport,
    precision: () => els.inspectorPanelPrecision,
    api: () => els.inspectorPanelApi,
  };

  function operatorNamesForNode(report) {
    return report ? report.operators.map(([name]) => name) : [];
  }

  function tagList(items) {
    if (!items || !items.length) return `<span class="operator-detail-empty">–</span>`;
    return `<div class="operator-tag-row">${items
      .map((item) => `<span class="stat-chip operator-tag">${escapeHtml(item)}</span>`)
      .join("")}</div>`;
  }

  function detailSection(titleKey, body) {
    return `
      <section class="report-inspector-section">
        <h2 class="section-title">${escapeHtml(t(titleKey))}</h2>
        ${body}
      </section>
    `;
  }

  function renderIoRows(rows) {
    if (!rows || !rows.length) {
      return `<div class="operator-detail-empty">${escapeHtml(t("noIoSignature"))}</div>`;
    }
    return `<div class="operator-io-list">${rows
      .map((row) => `
        <div class="operator-io-row">
          <span class="operator-io-name">${escapeHtml(row.name)}</span>
          <span class="stat-chip operator-tag operator-io-dtype">${escapeHtml(row.dtype)}</span>
          <span class="operator-io-desc">${escapeHtml(loc(row.desc))}</span>
        </div>
      `)
      .join("")}</div>`;
  }

  function renderLinkList(links) {
    if (!links || !links.length) return `<div class="operator-detail-empty">–</div>`;
    return `<div class="operator-link-list">${links
      .map((link) => `
        <a class="operator-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
          <span class="operator-link-label">${escapeHtml(loc(link.label))}</span>
          <span class="operator-link-open">${escapeHtml(t("openLink"))}</span>
        </a>
      `)
      .join("")}</div>`;
  }

  function renderDefinitionPanel(op) {
    const badge = op.curated ? t("curatedBadge") : t("genericBadge");
    const head = `
      <section class="report-inspector-section operator-detail-head-section">
        <div class="operator-detail-head">
          <span class="stat-chip">${escapeHtml(loc(op.categoryLabel))}</span>
          <span class="stat-chip operator-badge${op.curated ? " is-curated" : ""}">${escapeHtml(badge)}</span>
        </div>
        <p class="section-copy">${escapeHtml(loc(op.summary))}</p>
      </section>
    `;
    const formula = op.formula
      ? detailSection("formula", `<div class="operator-formula">${escapeHtml(op.formula)}</div>`)
      : "";
    return head + formula + detailSection("inputs", renderIoRows(op.inputs)) + detailSection("outputs", renderIoRows(op.outputs));
  }

  function renderSupportPanel(op) {
    return detailSection("supportedHardware", tagList(op.support.hardware))
      + detailSection("dataTypes", tagList(op.support.dtypes))
      + detailSection("dataFormats", tagList(op.support.formats))
      + detailSection("supportNotes", `<p class="section-copy">${escapeHtml(loc(op.support.notes))}</p>`);
  }

  function renderPrecisionPanel(op) {
    const rows = [
      [t("precisionMode"), loc(op.precision.mode)],
      [t("precisionError"), op.precision.error],
    ].map(([label, value]) => `
      <div class="operator-kv-row">
        <span class="operator-kv-label">${escapeHtml(label)}</span>
        <span class="operator-kv-value">${escapeHtml(value)}</span>
      </div>
    `).join("");
    return `<section class="report-inspector-section"><div class="operator-kv-list">${rows}</div></section>`
      + detailSection("precisionNotes", `<p class="section-copy">${escapeHtml(loc(op.precision.notes))}</p>`);
  }

  function renderApiPanel(op) {
    return detailSection("apiDocs", renderLinkList(op.api.docs))
      + detailSection("apiRepos", renderLinkList(op.api.repos));
  }

  const DETAIL_RENDERERS = {
    definition: renderDefinitionPanel,
    support: renderSupportPanel,
    precision: renderPrecisionPanel,
    api: renderApiPanel,
  };

  function renderOperatorSelectBar(names) {
    const isDetailTab = state.activeInspectorTab !== "performance";
    els.operatorSelectBar.hidden = !isDetailTab || names.length === 0;
    if (els.operatorSelectBar.hidden) {
      els.operatorSelectBar.innerHTML = "";
      return;
    }
    els.operatorSelectBar.innerHTML = names.map((name) => `
      <button type="button" class="operator-select-chip" data-operator-name="${escapeHtml(name)}" aria-pressed="${name === state.selectedOperatorName ? "true" : "false"}">
        ${escapeHtml(name)}
      </button>
    `).join("");
  }

  function renderActiveDetailPanel(names) {
    const tab = state.activeInspectorTab;
    if (tab === "performance") return;
    const panel = DETAIL_PANELS[tab]?.();
    if (!panel) return;
    if (!names.length || !state.selectedOperatorName) {
      panel.innerHTML = `<section class="report-inspector-section"><div class="report-inline-empty">${escapeHtml(t("noOperatorDetail"))}</div></section>`;
      return;
    }
    const op = window.DeepSeekOperatorKnowledge.getOperator(state.selectedOperatorName);
    panel.innerHTML = DETAIL_RENDERERS[tab](op);
  }

  function renderOperatorDetail() {
    const report = REPORTS[state.selectedNodeId];
    const names = operatorNamesForNode(report);
    if (!names.includes(state.selectedOperatorName)) {
      state.selectedOperatorName = names[0] || "";
    }
    renderOperatorSelectBar(names);
    renderActiveDetailPanel(names);
  }

  function activateInspectorTab(tabName) {
    const tabs = ["performance", "definition", "support", "precision", "api"];
    state.activeInspectorTab = tabs.includes(tabName) ? tabName : "performance";
    document.querySelectorAll("[data-inspector-tab]").forEach((button) => {
      const selected = button.dataset.inspectorTab === state.activeInspectorTab;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.getElementById("inspectorPanelPerformance").hidden = state.activeInspectorTab !== "performance";
    Object.entries(DETAIL_PANELS).forEach(([name, getEl]) => {
      getEl().hidden = state.activeInspectorTab !== name;
    });
    renderOperatorDetail();
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
    renderOperatorDetail();
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
      wheelZoomWithoutModifier: true,
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
    applyFusionMarkers();
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

  function readFusionAdvisorWidth() {
    try {
      const value = Number(localStorage.getItem(FUSION_ADVISOR_WIDTH_KEY));
      if (Number.isFinite(value)) return value;
    } catch (_error) {
      // Ignore storage failures; fall back to the default width.
    }
    return state.fusionAdvisorWidth;
  }

  function clampFusionAdvisorWidth(value) {
    const viewport = Math.max(0, window.innerWidth || 0);
    const maxByViewport = viewport > 0 ? Math.max(FUSION_ADVISOR_MIN_WIDTH, viewport - 520) : FUSION_ADVISOR_MAX_WIDTH;
    return Math.round(Math.max(FUSION_ADVISOR_MIN_WIDTH, Math.min(FUSION_ADVISOR_MAX_WIDTH, maxByViewport, value)));
  }

  function applyFusionAdvisorWidth(width, persist = false) {
    state.fusionAdvisorWidth = clampFusionAdvisorWidth(width);
    els.ideFrame?.style.setProperty("--fusion-advisor-width", `${state.fusionAdvisorWidth}px`);
    if (els.fusionAdvisorResize) {
      els.fusionAdvisorResize.setAttribute("aria-valuenow", String(state.fusionAdvisorWidth));
      els.fusionAdvisorResize.setAttribute("aria-valuetext", `${state.fusionAdvisorWidth}px`);
    }
    if (persist) persistPreference(FUSION_ADVISOR_WIDTH_KEY, String(state.fusionAdvisorWidth));
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
    renderFusionAdvisor();
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

  const FUSION_PRIO_META = {
    star: { key: "fusionPrioStar", cls: "is-star" },
    high: { key: "fusionPrioHigh", cls: "is-high" },
    medium: { key: "fusionPrioMedium", cls: "is-medium" },
  };

  // ----- Fusion markers on the architecture graph -----
  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) {
      if (attrs[key] != null) el.setAttribute(key, attrs[key]);
    }
    return el;
  }

  function fusionGraphSvg() {
    return state.architectureController?.svg || els.architectureGraph.querySelector("svg");
  }

  // Resolve the currently-visible element that should carry a leaf's fusion marker:
  // the leaf itself if shown, otherwise its nearest visible ancestor cluster.
  function fusionRepresentativeId(leafId) {
    if (state.visibleArchitectureIds.has(leafId)) return leafId;
    const ancestors = window.DeepSeekArchitectureData.ancestorIdsForGraphId(architectureGraphSpec, leafId);
    for (const ancestorId of ancestors) {
      if (state.visibleArchitectureIds.has(ancestorId)) return ancestorId;
    }
    return "";
  }

  // Collapse the leaf-level targets into the set of recs per currently visible element.
  function visibleFusionGroups() {
    const groups = new Map(); // representative graph id -> Set(recId)
    FUSION_TARGETS.forEach((recIds, leafId) => {
      const repId = fusionRepresentativeId(leafId);
      if (!repId) return;
      if (!groups.has(repId)) groups.set(repId, new Set());
      recIds.forEach((id) => groups.get(repId).add(id));
    });
    return groups;
  }

  function fusionMarkerTitle(recIds) {
    return recIds.map((id) => loc(FUSION_RECS_BY_ID.get(id)?.title)).filter(Boolean).join(" · ");
  }

  function applyFusionMarkers() {
    const svg = fusionGraphSvg();
    if (!svg) return;
    // Markers live inside their host group so they inherit its coordinate space
    // (node groups are translated; cluster groups use absolute coords).
    svg.querySelectorAll(".fusion-marker").forEach((marker) => marker.remove());
    svg.querySelectorAll(".is-fusion-marked").forEach((el) => {
      el.classList.remove("is-fusion-marked", "is-fusion-active");
      el.removeAttribute("data-fusion-recs");
    });
    if (!state.fusionMarkersVisible) return;

    visibleFusionGroups().forEach((recSet, graphId) => {
      const host = svg.querySelector(`[data-node-id="${graphId}"]`)
        || svg.querySelector(`[data-cluster-id="${graphId}"]`);
      const rect = host?.querySelector(":scope > rect");
      if (!host || !rect) return;
      const recIds = [...recSet].sort(
        (a, b) => (FUSION_PRIO_RANK[FUSION_RECS_BY_ID.get(b)?.prio] || 0)
          - (FUSION_PRIO_RANK[FUSION_RECS_BY_ID.get(a)?.prio] || 0),
      );
      const topPrio = FUSION_RECS_BY_ID.get(recIds[0])?.prio || "medium";
      const recAttr = recIds.join(" ");
      const isActive = Boolean(state.activeFusionRec) && recIds.includes(state.activeFusionRec);
      host.classList.add("is-fusion-marked");
      host.setAttribute("data-fusion-recs", recAttr);
      if (isActive) host.classList.add("is-fusion-active");

      const rx = parseFloat(rect.getAttribute("x")) || 0;
      const ry = parseFloat(rect.getAttribute("y")) || 0;
      const marker = svgEl("g", {
        class: `fusion-marker is-prio-${topPrio}${isActive ? " is-active" : ""}`,
        "data-fusion-recs": recAttr,
        transform: `translate(${rx}, ${ry})`,
        role: "button",
        tabindex: "0",
        "aria-label": fusionMarkerTitle(recIds),
      });
      const title = svgEl("title");
      title.textContent = fusionMarkerTitle(recIds);
      marker.appendChild(title);
      marker.appendChild(svgEl("circle", { class: "fusion-marker__halo", cx: 0, cy: 0, r: 12 }));
      marker.appendChild(svgEl("circle", { class: "fusion-marker__dot", cx: 0, cy: 0, r: 9 }));
      const glyph = svgEl("text", {
        class: "fusion-marker__glyph",
        x: 0,
        y: 0,
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      glyph.textContent = recIds.length > 1 ? String(recIds.length) : "⚡";
      marker.appendChild(glyph);

      const activate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFusionRec(recIds[0]);
        centerFusionRec(recIds[0]);
      };
      marker.addEventListener("click", activate);
      marker.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") activate(event);
      });
      host.appendChild(marker);
    });
    applyFusionFocus();
  }

  // Resolve the visible graph elements that a recommendation fuses, with the
  // geometry needed to draw the highlight overlay (center + box size).
  function fusionActiveItems(recId) {
    const controller = state.architectureController;
    if (!recId || !controller?.graph) return [];
    const nodeById = new Map((controller.graph.nodes || []).map((node) => [node.id, node]));
    const clusterById = new Map((controller.graph.clusters || []).map((cluster) => [cluster.id, cluster]));
    const seen = new Set();
    const items = [];
    FUSION_TARGETS.forEach((recIds, leafId) => {
      if (!recIds.has(recId)) return;
      const repId = fusionRepresentativeId(leafId);
      if (!repId || seen.has(repId)) return;
      seen.add(repId);
      const node = nodeById.get(repId);
      if (node) {
        items.push({ id: repId, cx: node.x, cy: node.y, w: node.width, h: node.height });
        return;
      }
      const cluster = clusterById.get(repId);
      if (cluster) {
        items.push({
          id: repId,
          cx: cluster.x + cluster.width / 2,
          cy: cluster.y + cluster.height / 2,
          w: cluster.width,
          h: cluster.height,
        });
      }
    });
    return items;
  }

  // Focus mode: when a recommendation is active, dim everything except the
  // operators it fuses, then draw an overlay (per-node halos + a connector that
  // binds them + a "N ops ⇒ FusedOp" label) so the fusion group reads at a glance.
  function applyFusionFocus() {
    const svg = fusionGraphSvg();
    const stage = els.architectureGraph;
    if (!svg) return;
    svg.querySelectorAll(".is-fusion-dim").forEach((el) => el.classList.remove("is-fusion-dim"));
    svg.querySelector(".fusion-focus-overlay")?.remove();

    const recId = state.fusionMarkersVisible ? state.activeFusionRec : "";
    const rec = recId ? FUSION_RECS_BY_ID.get(recId) : null;
    const items = rec ? fusionActiveItems(recId) : [];
    if (!rec || !items.length) {
      stage?.classList.remove("is-fusion-focus");
      return;
    }
    stage?.classList.add("is-fusion-focus");

    // Keep the active operators and their ancestor containers bright; dim the rest.
    const keep = new Set(items.map((item) => item.id));
    items.forEach((item) => {
      window.DeepSeekArchitectureData.ancestorIdsForGraphId(architectureGraphSpec, item.id)
        .forEach((ancestorId) => keep.add(ancestorId));
    });
    svg.querySelectorAll("[data-node-id]").forEach((el) => {
      if (!keep.has(el.getAttribute("data-node-id"))) el.classList.add("is-fusion-dim");
    });
    svg.querySelectorAll("[data-cluster-id]").forEach((el) => {
      if (!keep.has(el.getAttribute("data-cluster-id"))) el.classList.add("is-fusion-dim");
    });

    const statusCls = rec.status === "applied" ? "is-status-applied" : "is-status-opportunity";
    const overlay = svgEl("g", { class: `fusion-focus-overlay ${statusCls}` });
    const pad = 7;
    const sorted = [...items].sort((a, b) => a.cy - b.cy || a.cx - b.cx);

    if (sorted.length > 1) {
      const d = sorted
        .map((item, index) => `${index === 0 ? "M" : "L"} ${item.cx.toFixed(1)} ${item.cy.toFixed(1)}`)
        .join(" ");
      overlay.appendChild(svgEl("path", { class: "fusion-focus-link", d }));
    }

    sorted.forEach((item) => {
      overlay.appendChild(svgEl("rect", {
        class: "fusion-focus-halo",
        x: (item.cx - item.w / 2 - pad).toFixed(1),
        y: (item.cy - item.h / 2 - pad).toFixed(1),
        width: (item.w + pad * 2).toFixed(1),
        height: (item.h + pad * 2).toFixed(1),
        rx: 12,
      }));
    });

    // "N ops ⇒ FusedOp" pill anchored above the top-most active operator.
    const top = sorted[0];
    const label = t("fusionGroupLabel", items.length, rec.fused || loc(rec.title));
    const labelWidth = Math.min(380, label.length * 7.6 + 32);
    const lx = Math.max(top.cx - labelWidth / 2, 8);
    const ly = Math.max(top.cy - top.h / 2 - pad - 30, 8);
    const labelG = svgEl("g", {
      class: "fusion-focus-label",
      transform: `translate(${lx.toFixed(1)}, ${ly.toFixed(1)})`,
    });
    labelG.appendChild(svgEl("rect", {
      class: "fusion-focus-label-bg", x: 0, y: 0, width: labelWidth.toFixed(1), height: 24, rx: 12,
    }));
    const text = svgEl("text", {
      class: "fusion-focus-label-text", x: (labelWidth / 2).toFixed(1), y: 16, "text-anchor": "middle",
    });
    text.textContent = label;
    labelG.appendChild(text);
    overlay.appendChild(labelG);

    svg.appendChild(overlay);
  }

  // Highlight the graph nodes that belong to a recommendation (and the panel card).
  function setActiveFusionRec(recId) {
    state.activeFusionRec = recId || "";
    const svg = fusionGraphSvg();
    if (svg) {
      svg.querySelectorAll(".fusion-marker, .is-fusion-marked").forEach((el) => {
        const recs = (el.getAttribute("data-fusion-recs") || "").split(" ");
        const on = Boolean(recId) && recs.includes(recId);
        el.classList.toggle(el.classList.contains("fusion-marker") ? "is-active" : "is-fusion-active", on);
      });
    }
    els.fusionAdvisorBody?.querySelectorAll(".fusion-card").forEach((card) => {
      card.classList.toggle("is-graph-active", Boolean(recId) && card.dataset.fusionId === recId);
    });
    applyFusionFocus();
  }

  // Center the architecture graph on a recommendation's first visible fusion point.
  function centerFusionRec(recId) {
    if (!state.architectureController) return;
    for (const [leafId, recIds] of FUSION_TARGETS) {
      if (!recIds.has(recId)) continue;
      const repId = fusionRepresentativeId(leafId);
      if (repId) {
        state.architectureController.centerNode(repId);
        return;
      }
    }
  }

  // Open the advisor panel focused on a recommendation (from a graph marker click).
  function openFusionRec(recId) {
    if (!FUSION_RECS_BY_ID.has(recId)) return;
    state.fusionExpandedIds = new Set([recId]);
    setFusionAdvisorOpen(true);
    setActiveFusionRec(recId);
    const card = els.fusionAdvisorBody?.querySelector(`.fusion-card[data-fusion-id="${recId}"]`);
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function setFusionMarkersVisible(visible) {
    state.fusionMarkersVisible = Boolean(visible);
    els.fusionMarkerToggle?.classList.toggle("is-selected", state.fusionMarkersVisible);
    els.fusionMarkerToggle?.setAttribute("aria-pressed", String(state.fusionMarkersVisible));
    if (!state.fusionMarkersVisible) setActiveFusionRec("");
    applyFusionMarkers();
  }

  function fusionCodeBlock(labelKey, lines) {
    const body = (lines || []).map((line) => escapeHtml(line)).join("\n");
    return `<div class="fusion-code-block">
      <div class="fusion-code-label">${escapeHtml(t(labelKey))}</div>
      <pre class="fusion-code"><code>${body}</code></pre>
    </div>`;
  }

  // ----- Before/after fusion dataflow visualization -----
  const isBusToken = (token) => token === "hbm" || String(token).startsWith("comm");
  const countKernels = (tokens) => tokens.filter((token) => !isBusToken(token)).length;
  const countHops = (tokens) => tokens.filter(isBusToken).length;

  function fusionFlowChip(token) {
    const value = String(token);
    if (value === "hbm") {
      return `<span class="fusion-flow-bus is-hbm" title="${escapeHtml(t("fusionFlowHbm"))}"><span class="fusion-flow-bus-glyph" aria-hidden="true">⇅</span>HBM</span>`;
    }
    if (value.startsWith("comm")) {
      const label = value.split(":")[1] || "HCCL";
      return `<span class="fusion-flow-bus is-comm" title="${escapeHtml(t("fusionFlowComm"))}"><span class="fusion-flow-bus-glyph" aria-hidden="true">⇄</span>${escapeHtml(label)}</span>`;
    }
    return `<span class="fusion-flow-op">${escapeHtml(value)}</span>`;
  }

  function fusionFlowLane(labelKey, tokens, io, opts = {}) {
    const parts = [];
    if (io?.in) parts.push(`<span class="fusion-flow-io">${escapeHtml(io.in)}</span>`);
    tokens.forEach((token) => parts.push(fusionFlowChip(token)));
    if (io?.out) parts.push(`<span class="fusion-flow-io">${escapeHtml(io.out)}</span>`);
    const track = parts.join(`<span class="fusion-flow-arrow" aria-hidden="true">▾</span>`);
    const onchip = opts.onchip
      ? `<span class="fusion-flow-onchip">↺ ${escapeHtml(t("fusionFlowOnchip"))}</span>`
      : "";
    return `<div class="fusion-flow-lane ${opts.laneCls || ""}">
      <span class="fusion-flow-lane-label">${escapeHtml(t(labelKey))}</span>
      <div class="fusion-flow-track">${track}</div>
      ${onchip}
    </div>`;
  }

  function fusionFlowStat(labelKey, before, after) {
    const scale = Math.max(before, after, 1);
    const drop = before > 0 ? Math.round((1 - after / before) * 100) : 0;
    return `<div class="fusion-flow-stat">
      <span class="fusion-flow-stat-label">${escapeHtml(t(labelKey))}</span>
      <span class="fusion-flow-stat-bars">
        <span class="fusion-flow-stat-bar is-before" style="--w:${(before / scale) * 100}%"><b>${before}</b></span>
        <span class="fusion-flow-stat-to" aria-hidden="true">→</span>
        <span class="fusion-flow-stat-bar is-after" style="--w:${(after / scale) * 100}%"><b>${after}</b></span>
      </span>
      ${drop > 0 ? `<span class="fusion-flow-stat-drop">−${drop}%</span>` : ""}
    </div>`;
  }

  function fusionHardwareFocus(rec, mode = "after") {
    const units = (rec.unit || []).map((unit) => String(unit).toLowerCase());
    const tokens = rec.flow?.[mode] || [];
    const hasCube = units.some((unit) => unit.includes("cube")) || tokens.some((token) => /matmul|gemm/i.test(String(token)));
    const hasVector = units.some((unit) => unit.includes("vector") || unit.includes("mte")) || tokens.some((token) => /reverse|cast|transpose|norm|quant|swiglu|verify/i.test(String(token)));
    const hasComm = units.some((unit) => unit.includes("hccl")) || tokens.some((token) => String(token).startsWith("comm"));
    const hasHbm = tokens.includes("hbm") || mode === "before";
    const selectors = new Set();
    const routes = new Set();
    if (hasHbm) selectors.add('[data-mem950-node="rail:GM"]');
    if (hasComm) {
      selectors.add('[data-mem950-node="rail:L2"]');
      selectors.add('[data-mem950-node="rail:GM"]');
    }
    if (hasCube) {
      selectors.add('#mem950-aic [data-aic-node="buffer:L0A"]');
      selectors.add('#mem950-aic [data-aic-node="buffer:L0B"]');
      selectors.add('#mem950-aic [data-aic-node="cube:CUBE"]');
      selectors.add('#mem950-aic [data-aic-node="buffer:L0C"]');
      routes.add("gm-to-aic-l0a");
      routes.add("gm-to-aic-l0b");
      if (mode === "after" && !hasHbm) routes.add("aic-to-aiv1");
    }
    if (hasVector) {
      selectors.add('#mem950-aiv2 [data-aiv-node="cache:ND-DMA Cache"]');
      selectors.add('#mem950-aiv2 [data-aiv-node="buffer:UB"]');
      selectors.add('#mem950-aiv2 [data-aiv-node="exec:SIMT"]');
      routes.add("gm-to-aiv2-ub");
      if (hasHbm) routes.add("aiv2-ub-to-gm");
      if (mode === "after" && hasCube) routes.add("aiv2-to-aic");
    }
    if (mode === "after" && !hasHbm) {
      selectors.delete('[data-mem950-node="rail:GM"]');
      routes.delete("aiv2-ub-to-gm");
    }
    return {
      selectors: Array.from(selectors),
      routes: Array.from(routes),
      kind: hasComm ? "comm" : hasCube ? "compute" : "move",
    };
  }

  function renderFusionHardwareSteps(rec, mode = "after") {
    const tokens = rec.flow?.[mode] || [];
    const io = rec.flow?.io || {};
    const parts = [];
    if (io.in) parts.push(`<span class="fusion-hw-token is-io">${escapeHtml(io.in)}</span>`);
    tokens.forEach((token) => {
      const value = String(token);
      if (value === "hbm") parts.push(`<span class="fusion-hw-token is-hbm">HBM</span>`);
      else if (value.startsWith("comm")) parts.push(`<span class="fusion-hw-token is-comm">${escapeHtml(value.split(":")[1] || "HCCL")}</span>`);
      else parts.push(`<span class="fusion-hw-token is-op">${escapeHtml(value)}</span>`);
    });
    if (io.out) parts.push(`<span class="fusion-hw-token is-io">${escapeHtml(io.out)}</span>`);
    return parts.join(`<span class="fusion-hw-arrow" aria-hidden="true">-&gt;</span>`);
  }

  function renderFusionHardwareViewport(rec) {
    if (!rec.flow) return "";
    const recId = escapeHtml(rec.id);
    return `<section class="fusion-hardware pto-hw-viewport" data-fusion-hardware="${recId}">
      <header class="pto-hw-viewport__toolbar fusion-hardware-toolbar">
        <div class="pto-hw-viewport__title">${escapeHtml(t("fusionHardwareTitle"))}<small>${escapeHtml(t("fusionHardwareArch"))}</small></div>
        <div class="pto-hw-viewport__controls">
          <div class="pto-hw-viewport__segmented" aria-label="${escapeHtml(t("fusionHardwareFocus"))}">
            <button class="btn btn-sm" type="button" data-fusion-hw-mode="before" aria-pressed="false">${escapeHtml(t("fusionHardwareBefore"))}</button>
            <button class="btn btn-sm is-selected" type="button" data-fusion-hw-mode="after" aria-pressed="true">${escapeHtml(t("fusionHardwareAfter"))}</button>
          </div>
          <div class="pto-hw-viewport__tools">
            <button class="btn btn-sm btn-ghost pto-hw-viewport__tool" type="button" data-detail aria-pressed="true">${escapeHtml(t("fusionHardwareDetailsOn"))}</button>
            <button class="btn btn-sm btn-ghost pto-hw-viewport__tool" type="button" data-zoom-out title="Zoom out">-</button>
            <span class="pto-hw-viewport__readout" data-readout>50%</span>
            <button class="btn btn-sm btn-ghost pto-hw-viewport__tool" type="button" data-zoom-in title="Zoom in">+</button>
          </div>
        </div>
      </header>
      <div class="fusion-hardware-summary">
        <span class="fusion-hardware-kind" data-fusion-hw-kind>${escapeHtml(t("fusionHardwareCompute"))}</span>
        <span class="fusion-hardware-steps" data-fusion-hw-steps>${renderFusionHardwareSteps(rec, "after")}</span>
      </div>
      <div class="pto-hw-viewport__stage fusion-hardware-stage" data-stage>
        <div class="pto-hw-viewport__scale fusion-hardware-scale" data-scale>
          <div class="fusion-hardware-graph" data-fusion-hw-graph></div>
        </div>
      </div>
    </section>`;
  }

  function hydrateFusionHardwareFlows() {
    const viewportHelper = window.PtoHardwareArchitectureViewport;
    const memoryHelper = window.PtoMemoryArchitecturePattern;
    if (!viewportHelper || !memoryHelper || !els.fusionAdvisorBody) return;
    els.fusionAdvisorBody.querySelectorAll("[data-fusion-hardware]").forEach((root) => {
      if (root.dataset.fusionHardwareReady === "true") return;
      const rec = FUSION_RECS_BY_ID.get(root.dataset.fusionHardware);
      const graph = root.querySelector("[data-fusion-hw-graph]");
      if (!rec || !graph) return;
      const rendered = memoryHelper.renderArchitecture(graph, "ascend950b");
      const overlay = memoryHelper.createRouteOverlay(graph, "ascend950b");
      root.dataset.fusionHardwareReady = "true";
      memoryHelper.setDetailVisibility(graph, true);
      const viewportApi = viewportHelper.mount(root, {
        mode: "inline",
        viewport: "[data-stage]",
        scaleEl: "[data-scale]",
        detailToggle: "[data-detail]",
        zoomOut: "[data-zoom-out]",
        zoomIn: "[data-zoom-in]",
        readout: "[data-readout]",
        defaultScale: 0.5,
        zoomLevels: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
        detailOnText: t("fusionHardwareDetailsOn"),
        detailOffText: t("fusionHardwareDetailsOff"),
        fitPaddingX: 20,
        fitPaddingY: 20,
      });
      const setMode = (mode) => {
        root.querySelectorAll("[data-fusion-hw-mode]").forEach((button) => {
          const selected = button.dataset.fusionHwMode === mode;
          button.classList.toggle("is-selected", selected);
          button.setAttribute("aria-pressed", String(selected));
        });
        const focus = fusionHardwareFocus(rec, mode);
        const kindKey = focus.kind === "comm" ? "fusionHardwareComm" : focus.kind === "move" ? "fusionHardwareMove" : "fusionHardwareCompute";
        const kind = root.querySelector("[data-fusion-hw-kind]");
        const steps = root.querySelector("[data-fusion-hw-steps]");
        if (kind) kind.textContent = t(kindKey);
        if (steps) steps.innerHTML = renderFusionHardwareSteps(rec, mode);
        memoryHelper.setPathFocus(graph, "ascend950b", focus);
        overlay?.refresh?.();
      };
      root.querySelectorAll("[data-fusion-hw-mode]").forEach((button) => {
        button.addEventListener("click", () => setMode(button.dataset.fusionHwMode || "after"));
      });
      window.requestAnimationFrame(() => {
        const stage = rendered?.stage || graph.querySelector(".pto-mem950") || graph;
        viewportApi?.setFrameSize?.(stage.offsetWidth || stage.scrollWidth || 1200, stage.offsetHeight || stage.scrollHeight || 820);
        viewportApi?.fit?.();
        overlay?.refresh?.();
        setMode("after");
      });
    });
  }

  function renderFusionFlow(rec) {
    const flow = rec.flow;
    if (!flow || !Array.isArray(flow.before) || !Array.isArray(flow.after)) return "";
    const kBefore = countKernels(flow.before);
    const kAfter = countKernels(flow.after);
    const hBefore = countHops(flow.before);
    const hAfter = countHops(flow.after);
    return `<section class="fusion-section">
      <div class="fusion-section-head">${escapeHtml(t("fusionFlowTitle"))}</div>
      <div class="fusion-flow">
        ${renderFusionHardwareViewport(rec)}
        <div class="fusion-flow-lanes">
          ${fusionFlowLane("fusionFlowBefore", flow.before, flow.io, { laneCls: "is-before" })}
          <span class="fusion-flow-fuse" aria-hidden="true">⇒</span>
          ${fusionFlowLane("fusionFlowAfter", flow.after, flow.io, { laneCls: "is-after", onchip: hBefore > 0 })}
        </div>
        <div class="fusion-flow-stats">
          ${fusionFlowStat("fusionFlowKernels", kBefore, kAfter)}
          ${fusionFlowStat("fusionFlowHops", hBefore, hAfter)}
        </div>
      </div>
    </section>`;
  }

  function renderFusionCard(rec) {
    const prio = FUSION_PRIO_META[rec.prio] || FUSION_PRIO_META.medium;
    const expanded = state.fusionExpandedIds.has(rec.id);
    const chain = rec.chain
      .map((token) => `<span class="fusion-chain-token">${escapeHtml(token)}</span>`)
      .join("");
    const gains = rec.gains
      .map((gain) => `<span class="fusion-gain fusion-gain--${gain.tone || "plain"}">${escapeHtml(loc(gain.label))}</span>`)
      .join("");
    const affects = (rec.affects || [])
      .map((name) => `<span class="fusion-affect-chip">${escapeHtml(name)}</span>`)
      .join("");
    const units = (rec.unit || [])
      .map((name) => `<span class="fusion-unit-chip">${escapeHtml(name)}</span>`)
      .join("");
    const isApplied = rec.status === "applied";
    const statusCls = isApplied ? "is-applied" : "is-opportunity";
    const statusKey = isApplied ? "fusionStatusApplied" : "fusionStatusOpportunity";
    const statusBadge = `<span class="fusion-status ${statusCls}">${isApplied ? "✓ " : ""}${escapeHtml(t(statusKey))}</span>`;
    const evidence = rec.evidence
      ? `<section class="fusion-section">
          <div class="fusion-section-head">${escapeHtml(t("fusionEvidence"))}</div>
          <code class="fusion-evidence">${escapeHtml(loc(rec.evidence))}</code>
        </section>`
      : "";
    const constraint = rec.constraint
      ? `<section class="fusion-section">
          <div class="fusion-section-head">${escapeHtml(t("fusionConstraint"))}</div>
          <p class="fusion-constraint">${escapeHtml(loc(rec.constraint))}</p>
        </section>`
      : "";
    const graphActive = state.activeFusionRec === rec.id ? " is-graph-active" : "";
    return `<article class="fusion-card ${statusCls}${expanded ? " is-open" : ""}${graphActive}" data-fusion-id="${escapeHtml(rec.id)}">
      <button class="fusion-card-head" type="button" data-fusion-toggle="${escapeHtml(rec.id)}" aria-expanded="${expanded}">
        <span class="fusion-prio ${prio.cls}">${escapeHtml(t(prio.key))}</span>
        <span class="fusion-card-title">
          <span class="fusion-card-name-row">
            <span class="fusion-card-name">${escapeHtml(loc(rec.title))}</span>
            ${statusBadge}
          </span>
          <span class="fusion-chain">${chain}</span>
          <span class="fusion-meta-row">${units}<span class="fusion-gain-row">${gains}</span></span>
        </span>
        <span class="fusion-card-caret" aria-hidden="true">${expanded ? "▲" : "▼"}</span>
      </button>
      <div class="fusion-card-body"${expanded ? "" : " hidden"}>
        <button class="fusion-locate" type="button" data-fusion-locate="${escapeHtml(rec.id)}">
          <span class="fusion-locate__glyph" aria-hidden="true">⚡</span>${escapeHtml(t("fusionLocate"))}
        </button>
        ${evidence}
        <section class="fusion-section">
          <div class="fusion-section-head">${escapeHtml(t("fusionReason"))}</div>
          <p class="fusion-reason">${loc(rec.reason)}</p>
        </section>
        ${constraint}
        ${renderFusionFlow(rec)}
        <section class="fusion-section">
          <div class="fusion-section-head">${escapeHtml(t("fusionCodeCompare"))}</div>
          <div class="fusion-code-grid">
            ${fusionCodeBlock("fusionCodeBefore", rec.before)}
            ${fusionCodeBlock("fusionCodeAfter", rec.after)}
          </div>
        </section>
        <section class="fusion-section">
          <div class="fusion-section-head">${escapeHtml(t("fusionCannDoc"))}</div>
          <code class="fusion-docref">${escapeHtml(rec.doc)}</code>
        </section>
        <section class="fusion-section">
          <div class="fusion-section-head">${escapeHtml(t("fusionAffected"))}</div>
          <div class="fusion-affect-row">${affects}</div>
        </section>
      </div>
    </article>`;
  }

  function renderFusionAdvisor() {
    const advisor = window.DeepSeekFusionAdvisor;
    if (!advisor || !els.fusionAdvisorBody) return;
    const recs = advisor.RECS || [];
    const opportunities = recs.filter((rec) => rec.status !== "applied");
    const applied = recs.filter((rec) => rec.status === "applied");
    if (els.fusionAdvisorSubtitle) {
      els.fusionAdvisorSubtitle.textContent = t("fusionAdvisorSubtitle", opportunities.length, applied.length);
    }
    const group = (labelKey, list, groupCls) => {
      if (!list.length) return "";
      return `<div class="fusion-group ${groupCls}">
        <h3 class="fusion-group-head">${escapeHtml(t(labelKey))}<span class="fusion-group-count">${list.length}</span></h3>
        ${list.map(renderFusionCard).join("")}
      </div>`;
    };
    els.fusionAdvisorBody.innerHTML =
      group("fusionGroupOpportunity", opportunities, "is-opportunity-group")
      + group("fusionGroupApplied", applied, "is-applied-group");
    window.requestAnimationFrame(hydrateFusionHardwareFlows);
  }

  function startFusionAdvisorResize(event) {
    if (!state.fusionAdvisorOpen || !els.ideFrame) return;
    event.preventDefault();
    event.stopPropagation();
    const startWidth = state.fusionAdvisorWidth;
    const startX = event.clientX;
    const onMove = (moveEvent) => {
      const nextWidth = startWidth + (startX - moveEvent.clientX);
      applyFusionAdvisorWidth(nextWidth, false);
      window.requestAnimationFrame(() => {
        ideFrameInstance?.refresh();
        if (state.activeArchitectureView === "architecture") state.architectureController?.fit();
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      els.ideFrame?.classList.remove("is-resizing-fusion-advisor");
      persistPreference(FUSION_ADVISOR_WIDTH_KEY, String(state.fusionAdvisorWidth));
    };
    els.ideFrame.classList.add("is-resizing-fusion-advisor");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function setFusionAdvisorOpen(open) {
    state.fusionAdvisorOpen = Boolean(open);
    if (els.fusionAdvisorPanel) {
      els.fusionAdvisorPanel.hidden = !state.fusionAdvisorOpen;
      els.fusionAdvisorPanel.setAttribute("aria-hidden", String(!state.fusionAdvisorOpen));
    }
    if (els.fusionAdvisorBackdrop) els.fusionAdvisorBackdrop.hidden = true;
    els.ideFrame?.classList.toggle("is-fusion-advisor-open", state.fusionAdvisorOpen);
    els.fusionAdvisorToggle?.classList.toggle("is-selected", state.fusionAdvisorOpen);
    els.fusionAdvisorToggle?.setAttribute("aria-expanded", String(state.fusionAdvisorOpen));
    els.fusionAdvisorToggle?.setAttribute("aria-pressed", String(state.fusionAdvisorOpen));
    if (state.fusionAdvisorOpen) {
      renderFusionAdvisor();
      els.fusionAdvisorClose?.focus();
    } else {
      els.fusionAdvisorToggle?.focus();
    }
    window.requestAnimationFrame(() => {
      ideFrameInstance?.refresh();
      if (state.activeArchitectureView === "architecture") state.architectureController?.fit();
      drawStreamCanvases();
    });
  }

  els.fusionMarkerToggle?.addEventListener("click", () => setFusionMarkersVisible(!state.fusionMarkersVisible));
  els.fusionAdvisorToggle?.addEventListener("click", () => setFusionAdvisorOpen(!state.fusionAdvisorOpen));
  els.fusionAdvisorClose?.addEventListener("click", () => setFusionAdvisorOpen(false));
  els.fusionAdvisorBackdrop?.addEventListener("click", () => setFusionAdvisorOpen(false));
  els.fusionAdvisorResize?.addEventListener("pointerdown", startFusionAdvisorResize);
  els.fusionAdvisorResize?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -24 : 24;
    applyFusionAdvisorWidth(state.fusionAdvisorWidth + delta, true);
    window.requestAnimationFrame(() => {
      ideFrameInstance?.refresh();
      if (state.activeArchitectureView === "architecture") state.architectureController?.fit();
    });
  });
  els.fusionAdvisorBody?.addEventListener("click", (event) => {
    const locate = event.target.closest("[data-fusion-locate]");
    if (locate) {
      event.stopPropagation();
      const recId = locate.dataset.fusionLocate;
      setActiveFusionRec(recId);
      centerFusionRec(recId);
      return;
    }
    const head = event.target.closest("[data-fusion-toggle]");
    if (!head) return;
    const id = head.dataset.fusionToggle;
    const willExpand = !state.fusionExpandedIds.has(id);
    if (willExpand) state.fusionExpandedIds.add(id);
    else state.fusionExpandedIds.delete(id);
    renderFusionAdvisor();
    if (willExpand) {
      setActiveFusionRec(id);
      centerFusionRec(id);
    } else if (state.activeFusionRec === id) {
      setActiveFusionRec("");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.fusionAdvisorOpen) setFusionAdvisorOpen(false);
  });
  window.addEventListener("resize", () => applyFusionAdvisorWidth(state.fusionAdvisorWidth, false));

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
  document.querySelectorAll("[data-inspector-tab]").forEach((button) => {
    button.addEventListener("click", () => activateInspectorTab(button.dataset.inspectorTab));
  });
  els.operatorSelectBar?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-operator-name]");
    if (!chip) return;
    state.selectedOperatorName = chip.dataset.operatorName;
    renderOperatorDetail();
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
  activateInspectorTab("performance");
  renderFusionAdvisor();
  setInspectorExpanded(true);
  setBottomPanelExpanded(true);
})().catch((error) => {
  document.getElementById("footerStatus").textContent = error.message;
  document.getElementById("architectureStatus").textContent = "application failed";
  console.error(error);
});

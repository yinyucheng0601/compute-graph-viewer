(function () {
  const data = window.DEEPSEEK_INTERPRETABILITY_DATA;
  const X6 = window.X6;
  const root = document.getElementById("app");

  if (!root || !data || !X6 || !X6.Graph || !X6.Node) {
    document.body.innerHTML = "<p style='padding:24px;font-family:sans-serif'>Missing X6 or data.js</p>";
    return;
  }

  const parallelView = data.parallel_view || { legend: [], groups: {} };

  root.innerHTML = [
    '<div class="graph-shell">',
    '  <div id="graph" class="graph-canvas"></div>',
    '  <aside class="view-panel" aria-live="polite">',
    '    <div id="view-panel-title" class="view-panel-title"></div>',
    '    <div id="view-panel-note" class="view-panel-note"></div>',
    '    <div id="view-legend"></div>',
    '  </aside>',
    '</div>',
  ].join("");
  const graphContainer = document.getElementById("graph");
  const viewPanelTitle = document.getElementById("view-panel-title");
  const viewPanelNote = document.getElementById("view-panel-note");
  const viewLegend = document.getElementById("view-legend");
  const graphTitleEl = document.querySelector(".graph-title");

  const BG        = "#1A1A1A";
  const INK       = "#e0e0e0";
  const LINE      = "#333333";
  const PAPER     = "#2D2D2D";
  const PAPER_ALT = "#242424";
  const MUTED     = "#888888";
  const DASH      = "#555555";
  const TP_COLOR  = "#3a89ff";
  const EP_COLOR  = "#b765ff";
  const COLLECTIVE_COLOR = "#ff9c3a";
  const LOCAL_COLOR = "#6b778b";

  // ── L4: compact op ───────────────────────────────────────────────────────
  const L4_W         = 150;
  const L4_H         = 40;
  const L4_GAP       = 24;

  // ── L3: fusionNode collapsed pill ────────────────────────────────────────
  const L3_X_PAD      = 34;
  const L3_W          = L4_W + L3_X_PAD * 2;  // = 218
  const L3_H          = 44;
  const L3_TOP_PAD    = 12;
  const L3_BOT_PAD    = 12;
  const L3_GAP        = 24;
  const L3_BRANCH_GAP = 24;
  const L3_CENTER_GAP = 20;

  // ── L2: expandable group container ───────────────────────────────────────
  const L2_W         = 620;
  const L2_H         = 54;
  const L2_TOP_PAD   = 18;
  const L2_BOT_PAD   = 18;
  const HEADER_H     = L2_H;

  // ── L1: summary pills + IO ────────────────────────────────────────────────
  const L1_W         = L2_W;
  const L1_H         = 53;
  const IO_H         = L1_H;

  // ── Expand/collapse button: near-square rounded rectangle ────────────────
  const BTN_W        = 24;
  const BTN_H        = 24;
  const BTN_RX       = 8;

  // ── Pill visual system (all collapsed pills: rx + gradient + shadow) ───────
  const PILL_RX      = 20;
  const PILL_FILTER  = 'url(#mvp-drop-shadow)';

  // ── Layer strip (UI chrome, independent of node hierarchy) ───────────────
  const STRIP_W      = 298;
  const STRIP_H      = 40;

  const PLUS_PATH  = "M 6 13 20 13 M 13 6 13 20";
  const MINUS_PATH = "M 6 13 20 13";

  // ── Pipeline coloring: blue hue arc 200°–280°, same domain as visual-test ──
  // Stage order maps to getLaneColors(5, 200, 80) — attention(200°) → moe(280°)
  const MVP_PIPELINE_KEY = {
    attention: 0,
    norm:      1,
    ffn:       2,
    residual:  3,
    moe:       4,
  };

  // Lazily computed once injectPillDefs runs (needs getLaneColors from colormap.js)
  let _mvpLaneColors = null;
  function mvpLaneColors() {
    if (!_mvpLaneColors) _mvpLaneColors = getLaneColors(5, 200, 80);
    return _mvpLaneColors;
  }

  function darkenHex(hex) {
    const { r, g, b } = hexToRgb(hex);
    const h = v => Math.round(v * 0.75).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  function getPipelineColors(stage) {
    const idx = MVP_PIPELINE_KEY[stage];
    if (idx == null) return null;
    const solid = mvpLaneColors()[idx];
    const dark  = darkenHex(solid);
    const { r, g, b } = hexToRgb(solid);
    return {
      solid,
      dark,
      grad:   `url(#mvp-grad-${stage})`,
      bg:     `rgba(${r},${g},${b},0.20)`,
      stroke: 'rgba(255,255,255,0.20)',
    };
  }

  function withDefaultPill(pc) {
    if (pc) return pc;
    const solid = mvpLaneColors()[0]; // attention blue as default
    const { r, g, b } = hexToRgb(solid);
    return {
      solid,
      dark:  darkenHex(solid),
      grad:  'url(#mvp-grad-default)',
      bg:    `rgba(${r},${g},${b},0.20)`,
      stroke: 'rgba(255,255,255,0.20)',
    };
  }

  function injectPillDefs() {
    const svgEl = graphContainer.querySelector('svg');
    if (!svgEl) return;
    let defs = svgEl.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svgEl.prepend(defs);
    }

    // Drop-shadow filter
    const filt = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filt.setAttribute('id', 'mvp-drop-shadow');
    filt.setAttribute('x', '-15%'); filt.setAttribute('y', '-15%');
    filt.setAttribute('width', '130%'); filt.setAttribute('height', '140%');
    const fds = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
    fds.setAttribute('dx', '0'); fds.setAttribute('dy', '3');
    fds.setAttribute('stdDeviation', '4');
    fds.setAttribute('flood-color', '#000000');
    fds.setAttribute('flood-opacity', '0.35');
    filt.appendChild(fds);
    defs.appendChild(filt);

    // Per-stage gradients (blue arc) + default
    const gradEntries = [
      ...Object.keys(MVP_PIPELINE_KEY).map(stage => ({ id: `mvp-grad-${stage}`, solid: getPipelineColors(stage).solid })),
      { id: 'mvp-grad-default', solid: mvpLaneColors()[0] },
    ];
    gradEntries.forEach(({ id, solid }) => {
      const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
      grad.setAttribute('id', id);
      grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
      grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
      grad.setAttribute('gradientUnits', 'objectBoundingBox');
      const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', solid);
      const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', darkenHex(solid));
      grad.appendChild(s1); grad.appendChild(s2);
      defs.appendChild(grad);
    });
  }

  function inferStage(id) {
    if (id.startsWith('attention_') || id.startsWith('mla_') ||
        id.startsWith('lightning_') || id.startsWith('sparse_')) return 'attention';
    if (id.startsWith('ffn_'))       return 'ffn';
    if (id.startsWith('moe_'))       return 'moe';
    return null;
  }

  class FlowGroup extends X6.Node {
    toggleCollapse(collapsed) {
      const meta = this.getData() || {};
      if (!meta.collapsible) return;

      const target = collapsed == null ? !meta.collapsed : collapsed;
      this.setData({ ...meta, collapsed: target }, { silent: true });
      const newH = target ? meta.collapsedHeight : meta.expandedHeight;
      this.resize(this.getSize().width, newH);
      this.attr("buttonSign", { d: target ? PLUS_PATH : MINUS_PATH });

      // Keep label fixed in header area regardless of expanded height
      if (meta.collapsedHeight) {
        const headerMid = Math.round(meta.collapsedHeight / 2);
        const pct = Math.round(headerMid / newH * 100);
        this.attr("label", { refY: `${pct}%` });
      }

      if (meta.pipelineColors) {
        this.attr("body", {
          fill:   target ? meta.pipelineColors.grad : meta.pipelineColors.bg,
          filter: target ? PILL_FILTER : "none",
        });
      }
    }
  }

  FlowGroup.config({
    markup: [
      {
        tagName: "rect",
        selector: "body",
      },
      {
        tagName: "text",
        selector: "label",
      },
      {
        tagName: "g",
        selector: "buttonGroup",
        children: [
          {
            tagName: "rect",
            selector: "button",
            attrs: {
              "pointer-events": "visiblePainted",
            },
          },
          {
            tagName: "path",
            selector: "buttonSign",
            attrs: {
              fill: "none",
              "pointer-events": "none",
            },
          },
        ],
      },
    ],
    attrs: {
      body: {
        refWidth: "100%",
        refHeight: "100%",
        fill: PAPER,
        stroke: 'rgba(255,255,255,0.20)',
        strokeWidth: 1,
        rx: PILL_RX,
        ry: PILL_RX,
      },
      label: {
        refX: "50%",
        refY: "50%",
        textAnchor: "middle",
        textVerticalAnchor: "middle",
        fontSize: 14,
        fontWeight: 600,
        fill: INK,
        pointerEvents: "none",
      },
      buttonGroup: {
        refX: "100%",
        refX2: -36,
        refY: 10,
      },
      button: {
        width: BTN_W,
        height: BTN_H,
        rx: BTN_RX,
        ry: BTN_RX,
        fill: "rgba(0,0,0,0.10)",
        stroke: "none",
        cursor: "pointer",
        event: "node:collapse",
      },
      buttonSign: {
        refX: 0,
        refY: 0,
        stroke: "#ffffff",
        strokeWidth: 1.2,
        strokeLinecap: "square",
      },
    },
  });

  const state = {
    selectedLayerId: 0,
    expanded: {},
    modelVersion: "v3",
    viewMode: "structure",
  };

  let renderScheduled = false;
  let pendingResetView = false;

  const graph = new X6.Graph({
    container: graphContainer,
    width: graphContainer.clientWidth || window.innerWidth,
    height: graphContainer.clientHeight || window.innerHeight,
    autoResize: true,
    background: {
      color: BG,
    },
    grid: false,
    panning: {
      enabled: true,
      modifiers: null,
      eventTypes: ["leftMouseDown"],
    },
    mousewheel: {
      enabled: true,
      modifiers: ["ctrl", "meta"],
      factor: 1.1,
      minScale: 0.4,
      maxScale: 2.2,
      zoomAtMousePosition: true,
    },
    interacting: {
      nodeMovable: false,
      edgeMovable: false,
      edgeLabelMovable: false,
      arrowheadMovable: false,
      vertexMovable: false,
      vertexAddable: false,
      vertexDeletable: false,
      magnetConnectable: false,
      useEdgeTools: false,
      toolsAddable: false,
    },
  });

  // ── Touch support (mobile pan + pinch-to-zoom) ─────────────────────────────
  (function initTouch() {
    let lastPan = null;
    let lastDist = 0;

    function dist(t0, t1) {
      return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    }

    graphContainer.addEventListener("touchstart", (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        lastPan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        lastDist = 0;
      } else if (e.touches.length === 2) {
        lastPan = null;
        lastDist = dist(e.touches[0], e.touches[1]);
      }
    }, { passive: false });

    graphContainer.addEventListener("touchmove", (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && lastPan) {
        const dx = e.touches[0].clientX - lastPan.x;
        const dy = e.touches[0].clientY - lastPan.y;
        const t = graph.getTranslation();
        graph.translate(t.tx + dx, t.ty + dy);
        lastPan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2 && lastDist > 0) {
        const t0 = e.touches[0], t1 = e.touches[1];
        const newDist = dist(t0, t1);
        const factor = newDist / lastDist;
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        const rect = graphContainer.getBoundingClientRect();
        graph.zoomTo(
          Math.min(2.2, Math.max(0.4, graph.zoom() * factor)),
          { center: { x: midX - rect.left, y: midY - rect.top } }
        );
        lastDist = newDist;
      }
    }, { passive: false });

    graphContainer.addEventListener("touchend", () => {
      lastPan = null;
      lastDist = 0;
    });
  })();
  // ───────────────────────────────────────────────────────────────────────────

  function isDense(layer) {
    return layer.block_type === "dense_ffn";
  }

  function inParallelView() {
    return state.viewMode === "parallel";
  }

  function swatchColor(kind) {
    if (kind === "tp") return TP_COLOR;
    if (kind === "ep") return EP_COLOR;
    if (kind === "collective") return COLLECTIVE_COLOR;
    return LOCAL_COLOR;
  }

  function getParallelGroupMeta(key) {
    return parallelView.groups?.[key] || null;
  }

  function getAttentionGroupMeta() {
    return getParallelGroupMeta(state.modelVersion === "v3_2" ? "v3_2_attention" : "attention");
  }

  function getFeedforwardGroupMeta(layer) {
    return getParallelGroupMeta(isDense(layer) ? "dense_ffn" : "moe_ffn");
  }

  function groupTitle(baseTitle, meta) {
    if (!inParallelView() || !meta?.badge) return baseTitle;
    return `${baseTitle} · ${meta.badge}`;
  }

  function summaryTitle(baseTitle) {
    return inParallelView() ? `${baseTitle} · local` : baseTitle;
  }

  function getSelectedLayer() {
    return data.layers.find((layer) => layer.layer_id === state.selectedLayerId) || data.layers[0];
  }

  function setDefaultExpanded(layer) {
    state.expanded = {
      __model: state.modelVersion,
      __layer: layer.layer_id,
      attention: false,
      feedforward: false,
    };
  }

  function ensureExpanded(layer) {
    if (state.expanded.__layer !== layer.layer_id || state.expanded.__model !== state.modelVersion) {
      setDefaultExpanded(layer);
    }
  }

  function setExpandedForLayer(layer, options) {
    state.expanded = {
      __model: state.modelVersion,
      __layer: layer.layer_id,
      attention: Boolean(options?.attention),
      feedforward: Boolean(options?.feedforward),
    };
  }

  function isExpanded(key) {
    return Boolean(state.expanded[key]);
  }

  function point(x, y) {
    return { x, y };
  }

  function anchor(node, side) {
    if (node?.anchors?.[side]) return node.anchors[side];
    if (side === "top") return point(node.x + node.w / 2, node.y);
    if (side === "bottom") return point(node.x + node.w / 2, node.y + node.h);
    if (side === "left") return point(node.x, node.y + node.h / 2);
    return point(node.x + node.w, node.y + node.h / 2);
  }

  function edgeSpec(kind, points) {
    return {
      type: "edge",
      kind,
      points,
    };
  }

  function edgeFromTo(kind, fromNode, fromSide, toNode, toSide, via) {
    return edgeSpec(kind, [anchor(fromNode, fromSide), ...(via || []), anchor(toNode, toSide)]);
  }

  function edgeFromPoint(kind, sourcePoint, toNode, toSide, via) {
    return edgeSpec(kind, [sourcePoint, ...(via || []), anchor(toNode, toSide)]);
  }

  function edgeToPoint(kind, fromNode, fromSide, targetPoint, via) {
    return edgeSpec(kind, [anchor(fromNode, fromSide), ...(via || []), targetPoint]);
  }

  function measureBounds(nodes) {
    if (!nodes.length) {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }

    const left = Math.min(...nodes.map((node) => node.x));
    const top = Math.min(...nodes.map((node) => node.y));
    const right = Math.max(...nodes.map((node) => node.x + node.w));
    const bottom = Math.max(...nodes.map((node) => node.y + node.h));
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }

  function rectNode(id, text, x, y, w, h, variant, options) {
    return {
      type: "rect",
      id,
      text,
      x,
      y,
      w,
      h,
      variant,
      fill:        options?.fill,
      stroke:      options?.stroke,
      filter:      options?.filter,
      action: options?.action || null,
      disabled: Boolean(options?.disabled),
      labelRefX: options?.labelRefX,
      labelRefY: options?.labelRefY,
      labelAnchor: options?.labelAnchor,
      zIndex: options?.zIndex,
    };
  }

  function circleNode(id, text, x, y, size) {
    return {
      type: "circle",
      id,
      text,
      x,
      y,
      w: size,
      h: size,
      zIndex: 24,
    };
  }

  function groupNode(id, text, x, y, w, options) {
    const collapsedHeight = options?.collapsedHeight || HEADER_H;
    const expandedHeight = options?.expandedHeight || collapsedHeight;
    const collapsed = Boolean(options?.collapsed);

    return {
      type: "group",
      id,
      text,
      x,
      y,
      w,
      h: collapsed ? collapsedHeight : expandedHeight,
      key: options?.key || null,
      collapsible: Boolean(options?.collapsible),
      collapsed,
      collapsedHeight,
      expandedHeight,
      fill: options?.fill == null ? PAPER : options.fill,
      stroke: options?.stroke || LINE,
      strokeWidth: options?.strokeWidth == null ? 1.2 : options.strokeWidth,
      dashed: Boolean(options?.dashed),
      radius: options?.radius == null ? 12 : options.radius,
      fontSize: options?.fontSize || 14,
      fontWeight: options?.fontWeight || 600,
      showLabel: options?.showLabel !== false,
      labelY: options?.labelY,
      buttonY: options?.buttonY,
      buttonSize: options?.buttonSize,
      buttonH: options?.buttonH,
      children: options?.children || [],
      edges: options?.edges || [],
      zIndex: options?.zIndex || 6,
      pipelineColors: options?.pipelineColors || null,
    };
  }

  function summaryNode(id, title, x, y, stage) {
    const pc = getPipelineColors(stage);
    return rectNode(id, title, x, y, L1_W, L1_H, "summary", {
      fill:   pc?.grad ?? 'url(#mvp-grad-default)',
      stroke: pc?.stroke ?? null,
      filter: PILL_FILTER,
    });
  }

  function operatorNode(id, title, x, y, options) {
    return rectNode(id, title, x, y, options?.w ?? L3_W, options?.h ?? L3_H, "operator");
  }

  function fusionNode(id, title, x, y, options) {
    return buildExpandableOperator(id, title, x, y, {
      ...options,
      key: options?.key || id,
      details: options?.details == null ? getL4Details(id) : options.details,
    });
  }

  function parallelFusionNode(id, title, x, y, stage, details, options) {
    return fusionNode(id, title, x, y, {
      ...options,
      stage,
      details,
    });
  }

  function collectiveNode(id, title, x, y, width) {
    return rectNode(id, title, x, y, width || 164, 32, "parallel-collective");
  }

  function addNode(id, x, y) {
    return circleNode(id, "+", x, y, 28);
  }

  function nodeBottom(node) {
    return node.y + node.h;
  }

  function stackFusionNodes(x, originY, defs, gap) {
    const nodes = [];
    let currentY = originY;

    defs.forEach((def) => {
      const node = fusionNode(def.id, def.title, x, currentY, def);
      nodes.push(node);
      currentY += node.h + (def.gap == null ? gap : def.gap);
    });

    return {
      nodes,
      bottom: nodes.length ? nodeBottom(nodes[nodes.length - 1]) : originY,
    };
  }

  function stackDetailNodes(parentId, prefix, x, originY, labels, width, stage) {
    const nodes = [];
    const edges = [];
    let currentY = originY;
    let prevNode = null;
    const pc = getPipelineColors(stage);

    labels.forEach((label, index) => {
      const node = rectNode(
        parentId + "__" + prefix + "_" + index,
        label,
        x,
        currentY,
        width,
        L4_H,
        "detail-op",
        {
          fill:   pc?.grad ?? 'url(#mvp-grad-default)',
          stroke: 'rgba(255,255,255,0.20)',
          filter: PILL_FILTER,
        }
      );
      nodes.push(node);
      if (prevNode) {
        edges.push(edgeFromTo("operator-detail", prevNode, "bottom", node, "top"));
      }
      prevNode = node;
      currentY += L4_H + L4_GAP;
    });

    return {
      nodes,
      edges,
      firstNode: nodes[0] || null,
      lastNode: nodes[nodes.length - 1] || null,
      bottom: nodes.length ? nodeBottom(nodes[nodes.length - 1]) : originY,
    };
  }

  const L4_DETAILS = {
    v3: {
      attention_q_compress: ["Q_A projection"],
      attention_q_norm: ["RMSNorm Cq"],
      attention_q_expand: ["Q B projection"],
      attention_q_split: ["Split q_nope", "Split q_rope"],
      attention_kv_compress: ["KV A projection"],
      attention_kv_split1: ["Split KV latent", "Split K rope preimage"],
      attention_kv_expand: ["KV RMSNorm", "KV B projection"],
      attention_kv_split2: ["Split key", "Split value"],
      attention_kpe_broadcast: ["Broadcast K rope", "Align heads"],
      attention_kv_cache_update: ["Write K cache", "Write V cache"],
      attention_rope_compose: ["Apply RoPE (Q_PE + K_PE)", "Assemble Q (noPE + PE)", "Assemble K (noPE + PE)"],
      attention_score: ["QK matmul", "Scale by (d_head)^-0.5"],
      attention_softmax: ["Softmax (upcast fp32)", "Dropout (train only)"],
      attention_weighted_sum: ["Probabilities x value"],
      attention_out_projection: ["Head concat", "O projection"],
      ffn_gate_projection: ["Linear gate projection"],
      ffn_up_projection: ["Linear up projection"],
      ffn_swiglu: ["SiLU", "Elementwise multiply"],
      ffn_down_projection: ["Linear down projection"],
      moe_router_logits: ["Router linear", "Score logits"],
      moe_topk_router: ["Group routing", "Top-k experts"],
      moe_routing_scale: ["Normalize weights", "Scale by 2.5"],
      moe_dispatch: ["Token scatter", "Expert batch build"],
      moe_routed_experts: ["Gate projection", "Up projection", "SwiGLU", "Down projection"],
      moe_shared_experts: ["Shared gate projection", "Shared up projection", "SwiGLU", "Down projection"],
      moe_combine: ["Weighted combine", "Merge routed + shared"]
    },
    v3_2: {
      // ── V3.2 EXP official operators (L3 level) ───────────────────────────
      // mla_prolog_quant          → uses buildMlaPrologL4 (builder set in fusionNode options)
      // lightning_indexer_prolog  → uses buildIndexerPrologL4 (builder set in fusionNode options)
      lightning_indexer: ["QK matmul (int8×int8)", "ReLU gate", "W weighted sum", "Top-k select"],
      sparse_flash_attention_quant: [
        "Gather top-k KV", "Apply RoPE (Q_PE + K_PE)", "Assemble Q / K",
        "Sparse QK matmul", "Softmax", "Score × V",
      ],
      attention_out_projection: ["Project to hidden size"],
      // ── FFN / MoE (unchanged) ─────────────────────────────────────────────
      ffn_gate_projection: ["Linear gate projection"],
      ffn_up_projection: ["Linear up projection"],
      ffn_swiglu: ["SiLU", "Elementwise multiply"],
      ffn_down_projection: ["Linear down projection"],
      moe_router_logits: ["Router linear", "Score logits"],
      moe_topk_router: ["Group filter", "Top-k experts"],
      moe_routing_scale: ["Normalize weights", "Scale by 2.5"],
      moe_dispatch: ["Token scatter", "Expert batch build"],
      moe_routed_experts: ["Gate projection", "Up projection", "SwiGLU", "Down projection"],
      moe_shared_experts: ["Shared gate projection", "Shared up projection", "SwiGLU", "Down projection"],
      moe_combine: ["Weighted combine", "Merge routed + shared"],
    }
  };

  function getL4Details(id) {
    const modelDetails = L4_DETAILS[state.modelVersion] || {};
    return modelDetails[id] || [];
  }

  function buildL4DetailList(parentId, centerX, originY, labels, stage) {
    const column = stackDetailNodes(parentId, "detail", centerX - L4_W / 2, originY, labels, L4_W, stage);
    const bounds = measureBounds(column.nodes);
    return {
      nodes: column.nodes,
      edges: column.edges,
      height: bounds.height,
      entryPoints: column.firstNode ? [anchor(column.firstNode, "top")] : [],
      exitPoint: column.lastNode ? anchor(column.lastNode, "bottom") : null,
    };
  }

  function buildIndexerPrologL4(parentId, centerX, originY, width, stage) {
    const labelH = 16;
    const labelGap = 10;
    const columnGap = 10;
    const columnWidth = Math.floor((width - columnGap * 2) / 3);
    const contentWidth = columnWidth * 3 + columnGap * 2;
    const leftX = centerX - Math.round(contentWidth / 2);
    const middleX = leftX + columnWidth + columnGap;
    const rightX = middleX + columnWidth + columnGap;
    const pathOriginY = originY + labelH + labelGap;

    const labels = [
      rectNode(parentId + "__label_q", "Query",  leftX,   originY, columnWidth, labelH, "detail-label"),
      rectNode(parentId + "__label_k", "Key",    middleX, originY, columnWidth, labelH, "detail-label"),
      rectNode(parentId + "__label_w", "Weight", rightX,  originY, columnWidth, labelH, "detail-label"),
    ];

    const queryPath = stackDetailNodes(parentId, "idx_q", leftX, pathOriginY, [
      "Q-Linear (INT8×INT8)",
      "Dequant",
      "Split q_rope / q_nope",
      "RoPE (rope_3d)",
      "Concat",
      "Hadamard",
      "Quant (INT8)",
      "Write q_int8 / q_scale",
    ], columnWidth, stage);
    const keyPath = stackDetailNodes(parentId, "idx_k", middleX, pathOriginY, [
      "K-Linear (BF16)",
      "LayerNorm",
      "Split k_rope / k_nope",
      "RoPE (quant_rope_2d)",
      "Concat",
      "Hadamard",
      "Quant (INT8)",
      "scatter_update k_cache",
    ], columnWidth, stage);
    const weightPath = stackDetailNodes(parentId, "idx_w", rightX, pathOriginY, [
      "W-Linear (BF16)",
      "Scale ÷ √(h_n·h_d)",
      "Cast FP16",
      "Write weights",
    ], columnWidth, stage);

    const nodes = [...labels, ...queryPath.nodes, ...keyPath.nodes, ...weightPath.nodes];
    const edges = [...queryPath.edges, ...keyPath.edges, ...weightPath.edges];
    // Three paths are parallel (no fan-in merge edges); exitPoint is a virtual bottom anchor only
    const bottomY = Math.max(queryPath.bottom, keyPath.bottom, weightPath.bottom) + L4_GAP;
    const exitPoint = point(centerX, bottomY);

    return {
      nodes,
      edges,
      height: exitPoint.y - originY,
      entryPoints: [queryPath.firstNode, keyPath.firstNode, weightPath.firstNode]
        .filter(Boolean)
        .map((node) => anchor(node, "top")),
      exitPoint,
    };
  }

  function buildMlaPrologL4(parentId, centerX, originY, width, stage) {
    const labelH = 16;
    const labelGap = 10;
    const columnGap = 10;
    const columnWidth = Math.floor((width - columnGap) / 2);
    const contentWidth = columnWidth * 2 + columnGap;
    const leftX = centerX - Math.round(contentWidth / 2);
    const rightX = leftX + columnWidth + columnGap;
    const pathOriginY = originY + labelH + labelGap;

    const labels = [
      rectNode(parentId + "__label_q",  "Query",      leftX,  originY, columnWidth, labelH, "detail-label"),
      rectNode(parentId + "__label_kv", "Key / Value", rightX, originY, columnWidth, labelH, "detail-label"),
    ];

    const queryPath = stackDetailNodes(parentId, "mla_q", leftX, pathOriginY, [
      "Dq projection",
      "RMSNorm Cq",
      "Dynamic quant",
      "Write q_norm",
      "UQ projection",
      "UK projection",
      "QR projection",
      "Split q_nope / q_rope",
    ], columnWidth, stage);

    const kvPath = stackDetailNodes(parentId, "mla_kv", rightX, pathOriginY, [
      "DKV + KR projection",
      "RMSNorm Ckv",
      "FP8 quantize KV",
      "Write kv_cache",
      "KR projection",
      "RoPE",
      "Write kr_cache",
    ], columnWidth, stage);

    const nodes = [...labels, ...queryPath.nodes, ...kvPath.nodes];
    const edges = [...queryPath.edges, ...kvPath.edges];
    const bottomY = Math.max(queryPath.bottom, kvPath.bottom) + L4_GAP;
    const exitPoint = point(centerX, bottomY);

    return {
      nodes,
      edges,
      height: exitPoint.y - originY,
      entryPoints: [queryPath.firstNode, kvPath.firstNode]
        .filter(Boolean)
        .map((n) => anchor(n, "top")),
      exitPoint,
    };
  }

  function buildExpandableOperator(id, title, x, y, options) {
    const details = options?.details || [];
    const width = options?.w ?? L3_W;
    const expanded = isExpanded(options?.key || id);
    const centerX = x + width / 2;
    const detailOriginY = y + L3_H + L3_TOP_PAD;
    const stage = options?.stage ?? inferStage(id);
    const detailCluster = options?.builder
      ? options.builder(id, centerX, detailOriginY, width - L3_X_PAD * 2, stage)
      : buildL4DetailList(id, centerX, detailOriginY, details, stage);
    const collapsible = detailCluster.nodes.length > 0;
    const expandedHeight = collapsible
      ? L3_H + L3_TOP_PAD + detailCluster.height + L3_BOT_PAD
      : L3_H;
    const edges = [];

    if (expanded && detailCluster.entryPoints.length) {
      const headerBottom = point(centerX, y + L3_H);
      const splitY = detailOriginY - 6;
      detailCluster.entryPoints.forEach((entryPoint) => {
        edges.push(
          edgeSpec("operator-detail", [
            headerBottom,
            point(centerX, splitY),
            point(entryPoint.x, splitY),
            entryPoint,
          ])
        );
      });
      edges.push(...detailCluster.edges);
    }

    const pc = withDefaultPill(getPipelineColors(stage));

    const spec = groupNode(id, title, x, y, width, {
      key: options?.key || id,
      collapsible,
      collapsed: !expanded,
      collapsedHeight: L3_H,
      expandedHeight,
      fill:        expanded ? pc.bg : pc.grad,
      stroke:      pc.stroke,
      strokeWidth: 1,
      radius:      PILL_RX,
      fontSize:    12,
      fontWeight:  600,
      buttonY:     Math.round((L3_H - BTN_H) / 2),
      buttonSize:  BTN_W,
      buttonH:     BTN_H,
      children:    expanded ? detailCluster.nodes : [],
      edges,
      zIndex:      18,
      pipelineColors: pc,
    });

    spec.anchors = {
      bottom: expanded && detailCluster.exitPoint
        ? detailCluster.exitPoint
        : point(centerX, y + L3_H),
    };

    return spec;
  }

  function buildAttentionCluster(centerX, originY) {
    const colPad = 20;
    const colGap = L2_W - 2 * L3_W - 2 * colPad;
    const leftX       = centerX - L2_W / 2 + colPad;
    const rightX      = leftX + L3_W + colGap;
    const centerNodeX = centerX - L3_W / 2;
    const qColumn = stackFusionNodes(leftX, originY, [
      { id: "attention_q_compress", title: "Q compress" },
      { id: "attention_q_norm", title: "Q RMSNorm" },
      { id: "attention_q_expand", title: "Q expand" },
      { id: "attention_q_split", title: "Q split" },
    ], L3_GAP);
    const kvColumn = stackFusionNodes(rightX, originY, [
      { id: "attention_kv_compress", title: "KV compress" },
      { id: "attention_kv_split1", title: "Compressed KV split" },
      { id: "attention_kv_expand", title: "KV norm + expand" },
      { id: "attention_kv_split2", title: "KV split" },
      { id: "attention_kpe_broadcast", title: "K rope broadcast" },
      { id: "attention_kv_cache_update", title: "KV cache update" },
    ], L3_GAP);
    const [qCompress, qNorm, qExpand, qSplit] = qColumn.nodes;
    const [kvCompress, kvSplit1, kvExpand, kvSplit2, kpeBroadcast, kvCacheUpdate] = kvColumn.nodes;
    const ropeComposeY = Math.max(qColumn.bottom, kvColumn.bottom) + L3_BRANCH_GAP;
    const ropeCompose = fusionNode("attention_rope_compose", "RoPE + Q/K assemble", centerNodeX, ropeComposeY);
    const score = fusionNode("attention_score", "Scaled dot-product", centerNodeX, nodeBottom(ropeCompose) + L3_CENTER_GAP);
    const softmax = fusionNode("attention_softmax", "Softmax", centerNodeX, nodeBottom(score) + L3_CENTER_GAP);
    const weightedSum = fusionNode("attention_weighted_sum", "Weighted sum", centerNodeX, nodeBottom(softmax) + L3_CENTER_GAP);
    const outProjection = fusionNode("attention_out_projection", "O projection", centerNodeX, nodeBottom(weightedSum) + L3_CENTER_GAP);
    const fanInY = ropeCompose.y - Math.round(L3_BRANCH_GAP / 2);

    const nodes = [
      qCompress, qNorm, qExpand, qSplit,
      kvCompress, kvSplit1, kvExpand, kvSplit2, kpeBroadcast, kvCacheUpdate,
      ropeCompose, score, softmax, weightedSum, outProjection,
    ];

    const edges = [
      // Q chain
      edgeFromTo("detail", qCompress, "bottom", qNorm, "top"),
      edgeFromTo("detail", qNorm, "bottom", qExpand, "top"),
      edgeFromTo("detail", qExpand, "bottom", qSplit, "top"),
      // KV chain
      edgeFromTo("detail", kvCompress, "bottom", kvSplit1, "top"),
      edgeFromTo("detail", kvSplit1, "bottom", kvExpand, "top"),
      edgeFromTo("detail", kvExpand, "bottom", kvSplit2, "top"),
      edgeFromTo("detail", kvSplit2, "bottom", kpeBroadcast, "top"),
      edgeFromTo("detail", kpeBroadcast, "bottom", kvCacheUpdate, "top"),
      // Fan-in: qSplit and kvCacheUpdate → ropeCompose
      edgeFromTo("detail", qSplit, "bottom", ropeCompose, "top", [
        point(anchor(qSplit, "bottom").x, fanInY),
        point(anchor(ropeCompose, "top").x, fanInY),
      ]),
      edgeFromTo("detail", kvCacheUpdate, "bottom", ropeCompose, "top", [
        point(anchor(kvCacheUpdate, "bottom").x, fanInY),
        point(anchor(ropeCompose, "top").x, fanInY),
      ]),
      // Center chain
      edgeFromTo("detail", ropeCompose, "bottom", score, "top"),
      edgeFromTo("detail", score, "bottom", softmax, "top"),
      edgeFromTo("detail", softmax, "bottom", weightedSum, "top"),
      edgeFromTo("detail", weightedSum, "bottom", outProjection, "top"),
    ];

    const bounds = measureBounds(nodes);
    return {
      nodes,
      edges,
      height: bounds.height,
      entryNodes: [qCompress, kvCompress],
      exitNode: outProjection,
    };
  }

  function buildDenseCluster(centerX, originY) {
    const colPad = 20;
    const colGap = L2_W - 2 * L3_W - 2 * colPad;
    const leftX       = centerX - L2_W / 2 + colPad;
    const rightX      = leftX + L3_W + colGap;
    const centerNodeX = centerX - L3_W / 2;

    const gateProjection = fusionNode("ffn_gate_projection", "Gate projection", leftX, originY);
    const upProjection = fusionNode("ffn_up_projection", "Up projection", rightX, originY);
    const swigluY = Math.max(nodeBottom(gateProjection), nodeBottom(upProjection)) + L3_BRANCH_GAP;
    const swiglu = fusionNode("ffn_swiglu", "SwiGLU", centerNodeX, swigluY);
    const downProjection = fusionNode("ffn_down_projection", "Down projection", centerNodeX, nodeBottom(swiglu) + L3_CENTER_GAP);
    const fanInY = swiglu.y - Math.round(L3_BRANCH_GAP / 2);

    const nodes = [gateProjection, upProjection, swiglu, downProjection];
    const edges = [
      edgeFromTo("detail", gateProjection, "bottom", swiglu, "top", [
        point(anchor(gateProjection, "bottom").x, fanInY),
        point(anchor(swiglu, "top").x, fanInY),
      ]),
      edgeFromTo("detail", upProjection, "bottom", swiglu, "top", [
        point(anchor(upProjection, "bottom").x, fanInY),
        point(anchor(swiglu, "top").x, fanInY),
      ]),
      edgeFromTo("detail", swiglu, "bottom", downProjection, "top"),
    ];

    const bounds = measureBounds(nodes);
    return {
      nodes,
      edges,
      height: bounds.height,
      entryNodes: [gateProjection, upProjection],
      exitNode: downProjection,
    };
  }

  function buildMoeCluster(centerX, originY) {
    const colPad = 20;
    const colGap = L2_W - 2 * L3_W - 2 * colPad;
    const leftX       = centerX - L2_W / 2 + colPad;
    const rightX      = leftX + L3_W + colGap;
    const centerNodeX = centerX - L3_W / 2;

    const routerLogits = fusionNode("moe_router_logits", "Router logits", centerNodeX, originY);
    const topkRouter = fusionNode("moe_topk_router", "Top-k router", centerNodeX, nodeBottom(routerLogits) + L3_GAP);
    const routingScale = fusionNode("moe_routing_scale", "Route scale", centerNodeX, nodeBottom(topkRouter) + L3_GAP);
    const dispatch = fusionNode("moe_dispatch", "Dispatch", centerNodeX, nodeBottom(routingScale) + L3_GAP);
    const branchY = nodeBottom(dispatch) + L3_BRANCH_GAP;
    const routedExperts = fusionNode("moe_routed_experts", "Routed experts", leftX, branchY);
    const sharedExperts = fusionNode("moe_shared_experts", "Shared experts", rightX, branchY);
    const combine = fusionNode("moe_combine", "Combine", centerNodeX, Math.max(nodeBottom(routedExperts), nodeBottom(sharedExperts)) + L3_BRANCH_GAP);
    const dispatchFanY = branchY - Math.round(L3_BRANCH_GAP / 2);
    const combineFanY = combine.y - Math.round(L3_BRANCH_GAP / 2);

    const nodes = [routerLogits, topkRouter, routingScale, dispatch, routedExperts, sharedExperts, combine];
    const edges = [
      edgeFromTo("detail", routerLogits, "bottom", topkRouter, "top"),
      edgeFromTo("detail", topkRouter, "bottom", routingScale, "top"),
      edgeFromTo("detail", routingScale, "bottom", dispatch, "top"),
      edgeFromTo("detail", dispatch, "bottom", routedExperts, "top", [
        point(anchor(dispatch, "bottom").x, dispatchFanY),
        point(anchor(routedExperts, "top").x, dispatchFanY),
      ]),
      edgeFromTo("detail", dispatch, "bottom", sharedExperts, "top", [
        point(anchor(dispatch, "bottom").x, dispatchFanY),
        point(anchor(sharedExperts, "top").x, dispatchFanY),
      ]),
      edgeFromTo("detail", routedExperts, "bottom", combine, "top", [
        point(anchor(routedExperts, "bottom").x, combineFanY),
        point(anchor(combine, "top").x, combineFanY),
      ]),
      edgeFromTo("detail", sharedExperts, "bottom", combine, "top", [
        point(anchor(sharedExperts, "bottom").x, combineFanY),
        point(anchor(combine, "top").x, combineFanY),
      ]),
    ];

    const bounds = measureBounds(nodes);
    return {
      nodes,
      edges,
      height: bounds.height,
      entryNodes: [routerLogits],
      exitNode: combine,
    };
  }

  function buildAttentionParallelCluster(centerX, originY) {
    const colPad = 24;
    const colGap = L2_W - 2 * L3_W - 2 * colPad;
    const leftX = centerX - L2_W / 2 + colPad;
    const rightX = leftX + L3_W + colGap;
    const centerNodeX = centerX - L3_W / 2;

    const qShard = parallelFusionNode(
      "attention_q_tp",
      "Q expand · Col TP",
      leftX,
      originY,
      "attention",
      ["Query projection weights are column-sharded.", "Each rank keeps a slice of attention heads."]
    );
    const kvShard = parallelFusionNode(
      "attention_kv_tp",
      "KV expand · Col TP",
      rightX,
      originY,
      "attention",
      ["KV expansion stays sharded across the same TP group.", "KV cache is written from each rank's local shard."]
    );
    const localCoreY = Math.max(nodeBottom(qShard), nodeBottom(kvShard)) + L3_BRANCH_GAP;
    const localCore = parallelFusionNode(
      "attention_local_core",
      "Local heads attention",
      centerNodeX,
      localCoreY,
      "attention",
      ["Attention scores and value aggregation run on per-rank head slices.", "No extra topology is expanded in v1."]
    );
    const outProjection = parallelFusionNode(
      "attention_out_tp",
      "O projection · Row TP",
      centerNodeX,
      nodeBottom(localCore) + L3_CENTER_GAP,
      "attention",
      ["Output projection consumes sharded input rows.", "Final hidden state must be reduced across ranks."]
    );
    const collective = collectiveNode(
      "attention_all_reduce",
      "AllReduce hidden",
      centerX - 82,
      nodeBottom(outProjection) + L3_CENTER_GAP,
      164
    );
    const fanInY = localCore.y - Math.round(L3_BRANCH_GAP / 2);

    const nodes = [qShard, kvShard, localCore, outProjection, collective];
    const edges = [
      edgeFromTo("detail", qShard, "bottom", localCore, "top", [
        point(anchor(qShard, "bottom").x, fanInY),
        point(anchor(localCore, "top").x, fanInY),
      ]),
      edgeFromTo("detail", kvShard, "bottom", localCore, "top", [
        point(anchor(kvShard, "bottom").x, fanInY),
        point(anchor(localCore, "top").x, fanInY),
      ]),
      edgeFromTo("detail", localCore, "bottom", outProjection, "top"),
      edgeFromTo("collective", outProjection, "bottom", collective, "top"),
    ];

    const bounds = measureBounds(nodes);
    return {
      nodes,
      edges,
      height: bounds.height,
      entryNodes: [qShard, kvShard],
      exitNode: collective,
    };
  }

  function buildDenseParallelCluster(centerX, originY) {
    const colPad = 24;
    const colGap = L2_W - 2 * L3_W - 2 * colPad;
    const leftX = centerX - L2_W / 2 + colPad;
    const rightX = leftX + L3_W + colGap;
    const centerNodeX = centerX - L3_W / 2;

    const gateProjection = parallelFusionNode(
      "ffn_gate_tp",
      "W1 · Col TP",
      leftX,
      originY,
      "ffn",
      ["Gate projection is column-parallel over intermediate width.", "Each rank computes a partial activation slice."]
    );
    const upProjection = parallelFusionNode(
      "ffn_up_tp",
      "W3 · Col TP",
      rightX,
      originY,
      "ffn",
      ["Up projection follows the same TP partition as W1.", "Local outputs stay sharded before activation."]
    );
    const swigluY = Math.max(nodeBottom(gateProjection), nodeBottom(upProjection)) + L3_BRANCH_GAP;
    const localSwiGLU = parallelFusionNode(
      "ffn_local_swiglu",
      "Local SwiGLU",
      centerNodeX,
      swigluY,
      "ffn",
      ["Elementwise SiLU and multiply stay rank-local.", "No collective is needed before W2."]
    );
    const downProjection = parallelFusionNode(
      "ffn_down_tp",
      "W2 · Row TP",
      centerNodeX,
      nodeBottom(localSwiGLU) + L3_CENTER_GAP,
      "ffn",
      ["Row-parallel output projection consumes sharded intermediate rows.", "Hidden output is reduced across the TP group."]
    );
    const collective = collectiveNode(
      "ffn_all_reduce",
      "AllReduce hidden",
      centerX - 82,
      nodeBottom(downProjection) + L3_CENTER_GAP,
      164
    );
    const fanInY = localSwiGLU.y - Math.round(L3_BRANCH_GAP / 2);

    const nodes = [gateProjection, upProjection, localSwiGLU, downProjection, collective];
    const edges = [
      edgeFromTo("detail", gateProjection, "bottom", localSwiGLU, "top", [
        point(anchor(gateProjection, "bottom").x, fanInY),
        point(anchor(localSwiGLU, "top").x, fanInY),
      ]),
      edgeFromTo("detail", upProjection, "bottom", localSwiGLU, "top", [
        point(anchor(upProjection, "bottom").x, fanInY),
        point(anchor(localSwiGLU, "top").x, fanInY),
      ]),
      edgeFromTo("detail", localSwiGLU, "bottom", downProjection, "top"),
      edgeFromTo("collective", downProjection, "bottom", collective, "top"),
    ];

    const bounds = measureBounds(nodes);
    return {
      nodes,
      edges,
      height: bounds.height,
      entryNodes: [gateProjection, upProjection],
      exitNode: collective,
    };
  }

  function buildMoeParallelCluster(centerX, originY) {
    const colPad = 24;
    const colGap = L2_W - 2 * L3_W - 2 * colPad;
    const leftX = centerX - L2_W / 2 + colPad;
    const rightX = leftX + L3_W + colGap;
    const centerNodeX = centerX - L3_W / 2;

    const router = parallelFusionNode(
      "moe_router_parallel",
      "Router + Top-k",
      centerNodeX,
      originY,
      "moe",
      ["Router scores tokens and selects top-k experts.", "Selection happens before token dispatch to expert ranks."]
    );
    const dispatch = parallelFusionNode(
      "moe_dispatch_parallel",
      "Dispatch · EP",
      centerNodeX,
      nodeBottom(router) + L3_GAP,
      "moe",
      ["Tokens are bucketed by expert id.", "Each rank receives the subset for its local experts."]
    );
    const branchY = nodeBottom(dispatch) + L3_BRANCH_GAP;
    const localExperts = parallelFusionNode(
      "moe_local_experts_parallel",
      "Local experts · EP",
      leftX,
      branchY,
      "moe",
      ["Only a slice of routed experts resides on each rank.", "Activated tokens execute on local expert weights only."]
    );
    const sharedExperts = parallelFusionNode(
      "moe_shared_tp_parallel",
      "Shared experts · TP",
      rightX,
      branchY,
      "moe",
      ["Shared branch behaves like a TP MLP.", "W1/W3 are column-parallel; W2 is row-parallel."]
    );
    const merge = collectiveNode(
      "moe_merge_parallel",
      "AllReduce + merge",
      centerX - 92,
      Math.max(nodeBottom(localExperts), nodeBottom(sharedExperts)) + L3_BRANCH_GAP,
      184
    );
    const dispatchFanY = branchY - Math.round(L3_BRANCH_GAP / 2);

    const nodes = [router, dispatch, localExperts, sharedExperts, merge];
    const edges = [
      edgeFromTo("detail", router, "bottom", dispatch, "top"),
      edgeFromTo("detail", dispatch, "bottom", localExperts, "top", [
        point(anchor(dispatch, "bottom").x, dispatchFanY),
        point(anchor(localExperts, "top").x, dispatchFanY),
      ]),
      edgeFromTo("detail", dispatch, "bottom", sharedExperts, "top", [
        point(anchor(dispatch, "bottom").x, dispatchFanY),
        point(anchor(sharedExperts, "top").x, dispatchFanY),
      ]),
      edgeFromTo("collective", localExperts, "bottom", merge, "top"),
      edgeFromTo("collective", sharedExperts, "bottom", merge, "top"),
    ];

    const bounds = measureBounds(nodes);
    return {
      nodes,
      edges,
      height: bounds.height,
      entryNodes: [router],
      exitNode: merge,
    };
  }

  function buildExpandableGroup(id, title, key, x, y, expanded, builder, stage) {
    const centerX = x + L2_W / 2;
    const clusterOriginY = y + L2_H + L2_TOP_PAD;
    const cluster = builder(centerX, clusterOriginY);
    const entryPoint = point(centerX, y + L2_H);
    const expandedHeight = L2_H + L2_TOP_PAD + cluster.height + L2_BOT_PAD;
    const pc = withDefaultPill(getPipelineColors(stage));
    const edges = [];

    if (expanded) {
      edges.push(...cluster.edges);
      cluster.entryNodes.forEach((entryNode) => {
        edges.push(
          edgeSpec("detail", [
            entryPoint,
            point(entryPoint.x, entryNode.y - 10),
            point(anchor(entryNode, "top").x, entryNode.y - 10),
            anchor(entryNode, "top"),
          ])
        );
      });
    }

    const spec = groupNode(id, title, x, y, L2_W, {
      key,
      collapsible: true,
      collapsed: !expanded,
      collapsedHeight: L2_H,
      expandedHeight,
      fill:        expanded ? pc.bg : pc.grad,
      stroke:      pc.stroke,
      radius:      PILL_RX,
      children:    expanded ? cluster.nodes : [],
      edges,
      pipelineColors: pc,
      buttonY:    Math.round((L2_H - BTN_H) / 2),
      buttonSize: BTN_W,
      buttonH:    BTN_H,
    });

    spec.exitPoint = expanded ? anchor(cluster.exitNode, "bottom") : point(centerX, y + L2_H);
    spec.entryPoint = point(centerX, y);
    return spec;
  }

  function rectStyle(spec) {
    if (spec.variant === "summary") {
      return {
        fill: 'url(#mvp-grad-default)',
        stroke: 'rgba(255,255,255,0.20)',
        strokeWidth: 1,
        rx: PILL_RX,
        ry: PILL_RX,
        fontSize: 14,
        fontWeight: 600,
        textFill: INK,
      };
    }

    if (spec.variant === "io") {
      return {
        fill: '#BBBBBB',
        stroke: 'rgba(255,255,255,0.20)',
        strokeWidth: 1,
        rx: PILL_RX,
        ry: PILL_RX,
        fontSize: 14,
        fontWeight: 600,
        textFill: INK,
        filter: PILL_FILTER,
      };
    }

    if (spec.variant === "operator") {
      return {
        fill: PAPER_ALT,
        stroke: LINE,
        strokeWidth: 1.2,
        rx: 8,
        ry: 8,
        fontSize: 11,
        fontWeight: 600,
        textFill: INK,
      };
    }

    if (spec.variant === "detail-op") {
      return {
        fill: 'url(#mvp-grad-default)',
        stroke: 'rgba(255,255,255,0.20)',
        strokeWidth: 1,
        rx: PILL_RX,
        ry: PILL_RX,
        fontSize: 12,
        fontWeight: 600,
        textFill: INK,
      };
    }

    if (spec.variant === "nav") {
      return {
        fill: spec.disabled ? BG : PAPER,
        stroke: "none",
        strokeWidth: 0,
        rx: 5,
        ry: 5,
        fontSize: 14,
        fontWeight: 700,
        textFill: spec.disabled ? MUTED : INK,
      };
    }

    if (spec.variant === "version-active") {
      return {
        fill: INK,
        stroke: "none",
        strokeWidth: 0,
        rx: 6,
        ry: 6,
        fontSize: 12,
        fontWeight: 700,
        textFill: "#1A1A1A",
      };
    }

    if (spec.variant === "version-inactive") {
      return {
        fill: PAPER_ALT,
        stroke: LINE,
        strokeWidth: 1,
        rx: 6,
        ry: 6,
        fontSize: 12,
        fontWeight: 700,
        textFill: MUTED,
      };
    }

    if (spec.variant === "annotation") {
      return {
        fill: "none",
        stroke: "none",
        strokeWidth: 0,
        rx: 0,
        ry: 0,
        fontSize: 11,
        fontWeight: 400,
        textFill: MUTED,
      };
    }

    if (spec.variant === "detail-label") {
      return {
        fill: "none",
        stroke: "none",
        strokeWidth: 0,
        rx: 0,
        ry: 0,
        fontSize: 11,
        fontWeight: 700,
        textFill: INK,
      };
    }

    if (spec.variant === "parallel-collective") {
      return {
        fill: "rgba(255,156,58,0.16)",
        stroke: COLLECTIVE_COLOR,
        strokeWidth: 1.2,
        rx: 10,
        ry: 10,
        fontSize: 11,
        fontWeight: 700,
        textFill: "#ffd7aa",
      };
    }

    if (spec.variant === "strip") {
      return {
        fill: BG,
        stroke: "none",
        strokeWidth: 0,
        rx: 0,
        ry: 0,
        fontSize: 12,
        fontWeight: 500,
        textFill: INK,
      };
    }

    return {
      fill: PAPER,
      stroke: LINE,
      strokeWidth: 1.2,
      rx: 8,
      ry: 8,
      fontSize: 12,
      fontWeight: 500,
      textFill: INK,
    };
  }

  function addRect(spec) {
    const style = rectStyle(spec);
    const clickable = Boolean(spec.action) && !spec.disabled;

    return graph.addNode({
      id: spec.id,
      shape: "rect",
      x: spec.x,
      y: spec.y,
      width: spec.w,
      height: spec.h,
      zIndex: spec.zIndex || 20,
      attrs: {
        body: {
          fill:        spec.fill   ?? style.fill,
          stroke:      spec.stroke ?? style.stroke,
          filter:      spec.filter ?? style.filter,
          strokeWidth: style.strokeWidth,
          strokeDasharray: "none",
          strokeLinejoin: "round",
          rx: style.rx,
          ry: style.ry,
          cursor: clickable ? "pointer" : "default",
          pointerEvents: clickable ? "auto" : "none",
        },
        label: {
          text: spec.text,
          fill: style.textFill,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          textAnchor: spec.labelAnchor || "middle",
          textVerticalAnchor: "middle",
          refX: spec.labelRefX == null ? "50%" : spec.labelRefX,
          refY: spec.labelRefY == null ? "50%" : spec.labelRefY,
          pointerEvents: "none",
        },
      },
      data: spec.action
        ? {
            action: spec.action,
          }
        : {},
    });
  }

  function addCircle(spec) {
    return graph.addNode({
      id: spec.id,
      shape: "circle",
      x: spec.x,
      y: spec.y,
      width: spec.w,
      height: spec.h,
      zIndex: spec.zIndex || 24,
      attrs: {
        body: {
          fill: PAPER,
          stroke: LINE,
          strokeWidth: 1.8,
        },
        label: {
          text: spec.text,
          fill: INK,
          fontSize: 16,
          fontWeight: 700,
        },
      },
      data: {},
    });
  }

  function addEdge(spec) {
    const [source, ...rest] = spec.points;
    const target = rest[rest.length - 1];
    const vertices = rest.slice(0, -1);
    const isMain = spec.kind === "main";
    const isOperatorDetail = spec.kind === "operator-detail";
    const isCollective = spec.kind === "collective";

    return graph.addEdge({
      source,
      target,
      vertices,
      zIndex: isMain ? 10 : isOperatorDetail ? 19 : isCollective ? 16 : 8,
      connector: {
        name: "rounded",
        args: {
          radius: 0,
        },
      },
      attrs: {
        line: {
          stroke: isCollective ? COLLECTIVE_COLOR : '#BBBBBB',
          strokeWidth: isMain ? 1.7 : isCollective ? 1.35 : 1.15,
          strokeDasharray: isCollective ? "8 5" : "none",
          targetMarker: {
            name: "classic",
            size: isCollective ? 8 : 7,
          },
        },
      },
    });
  }

  function addGroup(spec) {
    const group = new FlowGroup({
      id: spec.id,
      x: spec.x,
      y: spec.y,
      width: spec.w,
      height: spec.collapsed ? spec.collapsedHeight : spec.expandedHeight,
      zIndex: spec.zIndex,
      attrs: {
        body: {
          fill: spec.fill,
          stroke: spec.stroke,
          strokeWidth: spec.strokeWidth,
          strokeDasharray: spec.dashed ? "8 6" : undefined,
          rx: spec.radius,
          ry: spec.radius,
        },
        label: {
          text: spec.showLabel ? spec.text : "",
          fontSize: spec.fontSize,
          fontWeight: spec.fontWeight,
          fill: INK,
          refY: spec.labelY == null ? "50%" : spec.labelY,
          textVerticalAnchor: "middle",
        },
        buttonGroup: {
          visibility: spec.collapsible ? "visible" : "hidden",
          refY: spec.buttonY == null ? 10 : spec.buttonY,
          refX2: -((spec.buttonSize || BTN_W) + 10),
        },
        button: {
          visibility: spec.collapsible ? "visible" : "hidden",
          width: spec.buttonSize || BTN_W,
          height: spec.buttonH   || BTN_H,
        },
        buttonSign: {
          visibility: spec.collapsible ? "visible" : "hidden",
          d: spec.collapsed ? PLUS_PATH : MINUS_PATH,
        },
      },
      data: {
        action: spec.collapsible ? "toggle-group" : null,
        key: spec.key,
        collapsible: spec.collapsible,
        collapsed: spec.collapsed,
        collapsedHeight: spec.collapsedHeight,
        expandedHeight: spec.expandedHeight,
        pipelineColors: spec.pipelineColors || null,
      },
    });

    graph.addNode(group);

    if (spec.collapsible) {
      group.toggleCollapse(spec.collapsed);
    }

    spec.children.forEach((child) => {
      mountSpec(child, group);
    });

    spec.edges.forEach((childEdge) => {
      const edge = addEdge(childEdge);
      group.addChild(edge);
    });

    return group;
  }

  function mountSpec(spec, parent) {
    let cell;

    if (spec.type === "group") {
      cell = addGroup(spec);
    } else if (spec.type === "circle") {
      cell = addCircle(spec);
    } else {
      cell = addRect(spec);
    }

    if (parent) {
      parent.addChild(cell);
    }

    return cell;
  }

  // ── V3.2 cluster builders ────────────────────────────────────────────────

  function buildAttentionParallelClusterV32(centerX, originY) {
    const centerNodeX = centerX - L3_W / 2;
    const prologWidth = 286;
    const prologX = centerX - prologWidth / 2;

    const mlaProlog = parallelFusionNode(
      "mla_prolog_parallel",
      "MLA Prolog · TP",
      prologX,
      originY,
      "attention",
      ["Query / KV preparation stays shard-aware before attention.", "Per-rank prolog writes local cache slices."]
    );
    const indexer = parallelFusionNode(
      "lightning_indexer_parallel",
      "Lightning Indexer · local",
      centerNodeX,
      nodeBottom(mlaProlog) + L3_CENTER_GAP,
      "attention",
      ["Indexer top-k selection is shown as local compute in v1.", "Sequence sparsity is not expanded into SP / CP topology yet."]
    );
    const sparseAttention = parallelFusionNode(
      "sparse_flash_attention_parallel",
      "Sparse Flash Attention · local",
      centerNodeX,
      nodeBottom(indexer) + L3_CENTER_GAP,
      "attention",
      ["Attention runs on each rank's local head / cache shards.", "Cross-rank sequence routing is intentionally out of scope for v1."]
    );
    const outProjection = parallelFusionNode(
      "attention_out_parallel_v32",
      "O projection · Row TP",
      centerNodeX,
      nodeBottom(sparseAttention) + L3_CENTER_GAP,
      "attention",
      ["Output projection gathers contributions from row-parallel slices.", "Hidden state is reduced after projection."]
    );
    const collective = collectiveNode(
      "attention_all_reduce_v32",
      "AllReduce hidden",
      centerX - 82,
      nodeBottom(outProjection) + L3_CENTER_GAP,
      164
    );

    const nodes = [mlaProlog, indexer, sparseAttention, outProjection, collective];
    const edges = [
      edgeFromTo("detail", mlaProlog, "bottom", indexer, "top"),
      edgeFromTo("detail", indexer, "bottom", sparseAttention, "top"),
      edgeFromTo("detail", sparseAttention, "bottom", outProjection, "top"),
      edgeFromTo("collective", outProjection, "bottom", collective, "top"),
    ];

    const bounds = measureBounds(nodes);
    return {
      nodes,
      edges,
      height: bounds.height,
      entryNodes: [mlaProlog],
      exitNode: collective,
    };
  }

  function buildAttentionClusterV32(centerX, originY) {
    const idxColumnGap = 10;
    const idxPrologW   = 3 * L4_W + 2 * idxColumnGap + 2 * L3_X_PAD;  // 538: inner 470 = 3×L4_W cols
    const wideX        = centerX - Math.round(idxPrologW / 2);
    const centerNodeX  = centerX - L3_W / 2;

    // ── Block 1: MLA Prolog (mla_prolog_quant) ────────────────────────────
    const mlaPrologNode = fusionNode(
      "mla_prolog_quant", "MLA Prolog",
      wideX, originY,
      { w: idxPrologW, builder: buildMlaPrologL4, stage: 'attention' }
    );

    // ── Block 2: Lightning Indexer Prolog ─────────────────────────────────
    const idxPrologY = nodeBottom(mlaPrologNode) + L3_CENTER_GAP;
    const idxPrologNode = fusionNode(
      "lightning_indexer_prolog_quant", "Lightning Indexer Prolog",
      wideX, idxPrologY,
      { w: idxPrologW, builder: buildIndexerPrologL4, stage: 'attention' }
    );

    // ── Fusion annotation: dashed frame spanning blocks 1+2 ───────────────
    // Represents mla_indexer_prolog_quant (pipeline-parallel fusion of the two)
    const fusionPad    = 12;
    const fusionPadTop = 22;  // extra headroom for label at top inside frame
    const fusionX   = wideX - fusionPad;
    const fusionTop = originY - fusionPadTop;
    const fusionW   = idxPrologW + 2 * fusionPad;
    const fusionH   = nodeBottom(idxPrologNode) + fusionPad - fusionTop;
    const fusionAnnotation = groupNode(
      "mla_indexer_prolog_quant", "mla_indexer_prolog_quant",
      fusionX, fusionTop, fusionW,
      {
        collapsible: false,
        collapsedHeight: fusionH,
        expandedHeight: fusionH,
        fill: "none",
        stroke: "rgba(255,255,255,0.18)",
        strokeWidth: 1,
        dashed: true,
        radius: PILL_RX,
        fontSize: 10,
        fontWeight: 400,
        showLabel: true,
        labelY: 7,
        children: [],
        edges: [],
        zIndex: 5,
      }
    );

    // ── Block 3: Lightning Indexer (lightning_indexer) ────────────────────
    const lightningIdxY  = nodeBottom(idxPrologNode) + L3_BRANCH_GAP;
    const lightningIdxNode = fusionNode(
      "lightning_indexer", "Lightning Indexer",
      centerNodeX, lightningIdxY,
      { stage: 'attention' }
    );

    // ── Block 4: Sparse Flash Attention (sparse_flash_attention_quant) ────
    const sparseAttnY  = nodeBottom(lightningIdxNode) + L3_CENTER_GAP;
    const sparseAttnNode = fusionNode(
      "sparse_flash_attention_quant", "Sparse Flash Attention",
      centerNodeX, sparseAttnY,
      { stage: 'attention' }
    );

    // ── antiquant variant badge ───────────────────────────────────────────
    const badgeY = nodeBottom(sparseAttnNode) + 4;
    const antiquantBadge = rectNode(
      "sparse_attn_antiquant_badge", "· sparse_attention_antiquant  (存8算16 优化变体)",
      centerNodeX, badgeY, L3_W, 14, "annotation"
    );

    // ── Block 5: Output projection ────────────────────────────────────────
    const outProjY   = badgeY + 14 + L3_CENTER_GAP;
    const outProjNode = fusionNode(
      "attention_out_projection", "O projection",
      centerNodeX, outProjY,
      { stage: 'attention' }
    );

    // ── Edges ─────────────────────────────────────────────────────────────
    const bypassX = wideX + idxPrologW + 24;
    const edges = [
      // Main sequential chain
      edgeFromTo("detail", mlaPrologNode,   "bottom", idxPrologNode,   "top"),
      edgeFromTo("detail", idxPrologNode,   "bottom", lightningIdxNode, "top"),
      edgeFromTo("detail", lightningIdxNode, "bottom", sparseAttnNode,  "top"),
      edgeFromTo("detail", sparseAttnNode,  "bottom", outProjNode,     "top"),
      // Bypass: mla_prolog q_nope/q_rope → sparse_flash_attention (right-side route)
      edgeSpec("detail", [
        point(wideX + idxPrologW, originY + L3_H / 2),
        point(bypassX,            originY + L3_H / 2),
        point(bypassX,            sparseAttnY + L3_H / 2),
        point(centerNodeX + L3_W, sparseAttnY + L3_H / 2),
      ]),
    ];

    const contentNodes = [mlaPrologNode, idxPrologNode, lightningIdxNode, sparseAttnNode, outProjNode];
    return {
      nodes: [fusionAnnotation, ...contentNodes, antiquantBadge],
      edges,
      height: nodeBottom(outProjNode) - originY,
      entryNodes: [mlaPrologNode],
      exitNode: outProjNode,
    };
  }

  function buildSceneV32(layer) {
    ensureExpanded(layer);
    const attentionMeta = getAttentionGroupMeta();
    const feedforwardMeta = getFeedforwardGroupMeta(layer);
    const attentionBuilder = inParallelView() ? buildAttentionParallelClusterV32 : buildAttentionClusterV32;
    const feedforwardBuilder = inParallelView()
      ? (isDense(layer) ? buildDenseParallelCluster : buildMoeParallelCluster)
      : (isDense(layer) ? buildDenseCluster : buildMoeCluster);

    const frameX = 144;
    const frameY = 88;
    const frameW = 772;
    const frameTopPad = 78;
    const frameBottomPad = 52;
    const rowGap = 26;

    const groupX = frameX + (frameW - L2_W) / 2;
    const groupCenterX = groupX + L2_W / 2;
    const residualOuterX = groupX - 52;
    const stripX = frameX + 40;
    const stripY = frameY - STRIP_H / 2;

    const children = [];
    const edges = [];
    const refs = {};

    let cursorY = frameY + frameTopPad;

    children.push(
      rectNode("layer_strip", "Layer " + String(layer.layer_id + 1) + " / " + data.layers.length + (isDense(layer) ? "" : "  ·  MoE"), stripX, stripY, STRIP_W, STRIP_H, "strip", {
        labelRefX: 12,
        labelAnchor: "start",
      })
    );

    children.push(
      rectNode("layer_prev", "<", stripX + 220, stripY + (STRIP_H - 24) / 2, 24, 24, "nav", {
        action: layer.layer_id === 0 ? null : "prev-layer",
        disabled: layer.layer_id === 0,
      })
    );

    children.push(
      rectNode("layer_next", ">", stripX + 248, stripY + (STRIP_H - 24) / 2, 24, 24, "nav", {
        action: layer.layer_id === data.layers.length - 1 ? null : "next-layer",
        disabled: layer.layer_id === data.layers.length - 1,
      })
    );

    // V3.2 uses fused residual norm: attn_norm(x, residual) returns (normed, residual)
    refs.inputNorm = summaryNode("input_norm", summaryTitle("RMSNorm (fused residual)"), groupX, cursorY, 'norm');
    children.push(refs.inputNorm);
    cursorY += L1_H + rowGap;

    refs.attention = buildExpandableGroup(
      "attention_group",
      groupTitle("MLA + Lightning Indexer", attentionMeta),
      "attention",
      groupX,
      cursorY,
      state.expanded.attention,
      attentionBuilder,
      'attention'
    );
    children.push(refs.attention);
    cursorY += refs.attention.h + rowGap;

    // V3.2 fuses residual add into ffn_norm — show as a single fused norm node
    refs.postNorm = summaryNode("post_norm", summaryTitle("RMSNorm (fused residual)"), groupX, cursorY, 'norm');
    children.push(refs.postNorm);
    cursorY += L1_H + rowGap;

    refs.feedforward = buildExpandableGroup(
      "feedforward_group",
      groupTitle(isDense(layer) ? "Feed-Forward" : "MoE Feed-Forward", feedforwardMeta),
      "feedforward",
      groupX,
      cursorY,
      state.expanded.feedforward,
      feedforwardBuilder,
      isDense(layer) ? 'ffn' : 'moe'
    );
    children.push(refs.feedforward);
    cursorY += refs.feedforward.h + rowGap;

    refs.addFfn = addNode("add_ffn", groupCenterX - 14, cursorY);
    children.push(refs.addFfn);
    cursorY += 28;

    const frameH = cursorY - frameY + frameBottomPad;
    const frameBottom = frameY + frameH;
    const inputPoint = point(groupCenterX, frameY - 30);
    const outputPoint = point(groupCenterX, frameBottom + 30);

    children.push(
      rectNode("label_input", "Hidden state in", groupX, inputPoint.y - IO_H - 28, L1_W, IO_H, "io"),
      rectNode("label_output", "Hidden state out", groupX, outputPoint.y, L1_W, IO_H, "io")
    );

    // V3.2: attn residual is absorbed into ffn_norm; no explicit add_attention node
    edges.push(
      edgeFromPoint("main", inputPoint, refs.inputNorm, "top"),
      edgeFromTo("main", refs.inputNorm, "bottom", refs.attention, "top"),
      edgeFromTo("main", refs.attention, "bottom", refs.postNorm, "top"),
      edgeFromTo("main", refs.postNorm, "bottom", refs.feedforward, "top"),
      edgeSpec("main", [refs.feedforward.exitPoint, anchor(refs.addFfn, "top")]),
      edgeToPoint("main", refs.addFfn, "bottom", outputPoint),
      // Residual bypass (outer): input → add_ffn (fused norms absorb the intermediate add)
      edgeSpec("main", [
        point(groupCenterX, frameY + 24),
        point(residualOuterX, frameY + 24),
        point(residualOuterX, anchor(refs.addFfn, "left").y),
        anchor(refs.addFfn, "left"),
      ])
    );

    const layerGroup = groupNode("layer_group", "", frameX, frameY, frameW, {
      collapsible: false,
      collapsedHeight: frameH,
      expandedHeight: frameH,
      fill: "none",
      stroke: DASH,
      strokeWidth: 1.4,
      dashed: true,
      radius: 0,
      showLabel: false,
      children,
      edges,
      zIndex: 1,
    });

    return { layerGroup };
  }

  function buildScene(layer) {
    ensureExpanded(layer);
    const attentionMeta = getAttentionGroupMeta();
    const feedforwardMeta = getFeedforwardGroupMeta(layer);
    const attentionBuilder = inParallelView() ? buildAttentionParallelCluster : buildAttentionCluster;
    const feedforwardBuilder = inParallelView()
      ? (isDense(layer) ? buildDenseParallelCluster : buildMoeParallelCluster)
      : (isDense(layer) ? buildDenseCluster : buildMoeCluster);

    const frameX = 144;
    const frameY = 88;
    const frameW = 772;
    const frameTopPad = 78;
    const frameBottomPad = 52;
    const rowGap = 26;

    const groupX = frameX + (frameW - L2_W) / 2;
    const groupCenterX = groupX + L2_W / 2;
    const residualOuterX = groupX - 52;
    const residualInnerX = groupX - 28;
    const stripX = frameX + 40;
    const stripY = frameY - STRIP_H / 2;

    const children = [];
    const edges = [];
    const refs = {};

    let cursorY = frameY + frameTopPad;

    children.push(
      rectNode("layer_strip", "Layer " + String(layer.layer_id + 1) + " / " + data.layers.length + (isDense(layer) ? "" : "  ·  MoE"), stripX, stripY, STRIP_W, STRIP_H, "strip", {
        labelRefX: 12,
        labelAnchor: "start",
      })
    );

    children.push(
      rectNode("layer_prev", "<", stripX + 220, stripY + (STRIP_H - 24) / 2, 24, 24, "nav", {
        action: layer.layer_id === 0 ? null : "prev-layer",
        disabled: layer.layer_id === 0,
      })
    );

    children.push(
      rectNode("layer_next", ">", stripX + 248, stripY + (STRIP_H - 24) / 2, 24, 24, "nav", {
        action: layer.layer_id === data.layers.length - 1 ? null : "next-layer",
        disabled: layer.layer_id === data.layers.length - 1,
      })
    );

    refs.inputNorm = summaryNode("input_norm", summaryTitle("RMSNorm"), groupX, cursorY, 'norm');
    children.push(refs.inputNorm);
    cursorY += L1_H + rowGap;

    refs.attention = buildExpandableGroup(
      "attention_group",
      groupTitle("Attention", attentionMeta),
      "attention",
      groupX,
      cursorY,
      state.expanded.attention,
      attentionBuilder,
      'attention'
    );
    children.push(refs.attention);
    cursorY += refs.attention.h + rowGap;

    refs.addAttention = addNode("add_attention", groupCenterX - 14, cursorY);
    children.push(refs.addAttention);
    cursorY += 28 + rowGap;

    refs.postNorm = summaryNode("post_norm", summaryTitle("RMSNorm"), groupX, cursorY, 'norm');
    children.push(refs.postNorm);
    cursorY += L1_H + rowGap;

    refs.feedforward = buildExpandableGroup(
      "feedforward_group",
      groupTitle(isDense(layer) ? "Feed-Forward" : "MoE Feed-Forward", feedforwardMeta),
      "feedforward",
      groupX,
      cursorY,
      state.expanded.feedforward,
      feedforwardBuilder,
      isDense(layer) ? 'ffn' : 'moe'
    );
    children.push(refs.feedforward);
    cursorY += refs.feedforward.h + rowGap;

    refs.addFfn = addNode("add_ffn", groupCenterX - 14, cursorY);
    children.push(refs.addFfn);
    cursorY += 28;

    const frameH = cursorY - frameY + frameBottomPad;
    const frameBottom = frameY + frameH;
    const inputPoint = point(groupCenterX, frameY - 30);
    const outputPoint = point(groupCenterX, frameBottom + 30);

    children.push(
      rectNode("label_input", "Hidden state in", groupX, inputPoint.y - IO_H - 28, L1_W, IO_H, "io"),
      rectNode("label_output", "Hidden state out", groupX, outputPoint.y, L1_W, IO_H, "io")
    );

    edges.push(
      edgeFromPoint("main", inputPoint, refs.inputNorm, "top"),
      edgeFromTo("main", refs.inputNorm, "bottom", refs.attention, "top"),
      edgeSpec("main", [refs.attention.exitPoint, anchor(refs.addAttention, "top")]),
      edgeFromTo("main", refs.addAttention, "bottom", refs.postNorm, "top"),
      edgeFromTo("main", refs.postNorm, "bottom", refs.feedforward, "top"),
      edgeSpec("main", [refs.feedforward.exitPoint, anchor(refs.addFfn, "top")]),
      edgeToPoint("main", refs.addFfn, "bottom", outputPoint),
      edgeSpec("main", [
        point(groupCenterX, frameY + 24),
        point(residualOuterX, frameY + 24),
        point(residualOuterX, anchor(refs.addAttention, "left").y),
        anchor(refs.addAttention, "left"),
      ]),
      edgeSpec("main", [
        anchor(refs.addAttention, "bottom"),
        point(residualInnerX, anchor(refs.addAttention, "bottom").y),
        point(residualInnerX, anchor(refs.addFfn, "left").y),
        anchor(refs.addFfn, "left"),
      ])
    );

    const layerGroup = groupNode("layer_group", "", frameX, frameY, frameW, {
      collapsible: false,
      collapsedHeight: frameH,
      expandedHeight: frameH,
      fill: "none",
      stroke: DASH,
      strokeWidth: 1.4,
      dashed: true,
      radius: 0,
      showLabel: false,
      children,
      edges,
      zIndex: 1,
    });

    return {
      layerGroup,
    };
  }

  function clearGraph() {
    if (typeof graph.resetCells === "function") {
      graph.resetCells([]);
      return;
    }

    if (graph.model && typeof graph.model.resetCells === "function") {
      graph.model.resetCells([]);
      return;
    }

    graph.clearCells();
  }

  function render(resetView) {
    const layer = getSelectedLayer();
    updateToolbarUi();
    const scene = state.modelVersion === "v3_2" ? buildSceneV32(layer) : buildScene(layer);

    clearGraph();
    addGroup(scene.layerGroup);

    if (resetView) {
      requestAnimationFrame(() => {
        graph.zoomToFit({
          padding: {
            top: 56,
            right: 56,
            bottom: 56,
            left: 56,
          },
          maxScale: 1,
        });
      });
    }
  }

  function scheduleRender(resetView) {
    pendingResetView = pendingResetView || resetView;

    if (renderScheduled) {
      return;
    }

    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      const shouldResetView = pendingResetView;
      pendingResetView = false;
      render(shouldResetView);
    });
  }

  graph.on("node:collapse", ({ node }) => {
    const payload = node.getData() || {};
    if (payload.action !== "toggle-group" || !payload.key) return;

    state.expanded[payload.key] = !state.expanded[payload.key];
    scheduleRender(false);
  });

  graph.on("node:click", ({ node }) => {
    const payload = node.getData() || {};
    if (!payload.action) return;

    if (payload.action === "prev-layer") {
      const prevLayer = getSelectedLayer();
      state.selectedLayerId = Math.max(0, state.selectedLayerId - 1);
      const nextLayer = getSelectedLayer();
      setExpandedForLayer(nextLayer, {
        attention: state.expanded.attention,
        feedforward: isDense(prevLayer) !== isDense(nextLayer) ? false : state.expanded.feedforward,
      });
      scheduleRender(false);
      return;
    }

    if (payload.action === "next-layer") {
      const prevLayer = getSelectedLayer();
      state.selectedLayerId = Math.min(data.layers.length - 1, state.selectedLayerId + 1);
      const nextLayer = getSelectedLayer();
      setExpandedForLayer(nextLayer, {
        attention: state.expanded.attention,
        feedforward: isDense(prevLayer) !== isDense(nextLayer) ? false : state.expanded.feedforward,
      });
      scheduleRender(false);
    }
  });

  graph.on("blank:dblclick", () => {
    graph.zoomToFit({
      padding: {
        top: 56,
        right: 56,
        bottom: 56,
        left: 56,
      },
      maxScale: 1,
    });
  });

  function renderViewPanel() {
    const layer = getSelectedLayer();
    const structureItems = [
      {
        kind: "local",
        label: "Layer Skeleton",
        description: "保持 L1 → L4 的模型结构递进，强调算子组织与数据路径。",
      },
      {
        kind: "tp",
        label: "Stage Colors",
        description: "Attention / FFN / MoE 继续沿用语义色带，方便和其他页面保持一致。",
      },
    ];
    const parallelItems = [
      {
        kind: "tp",
        label: getAttentionGroupMeta()?.badge || "TP",
        description: getAttentionGroupMeta()?.summary || "",
      },
      {
        kind: isDense(layer) ? "tp" : "ep",
        label: getFeedforwardGroupMeta(layer)?.badge || (isDense(layer) ? "TP" : "EP + TP"),
        description: getFeedforwardGroupMeta(layer)?.summary || "",
      },
      ...(parallelView.legend || []),
    ];
    const items = inParallelView() ? parallelItems : structureItems;

    if (viewPanelTitle) {
      viewPanelTitle.textContent = inParallelView() ? "并行视图" : "结构视图";
    }
    if (viewPanelNote) {
      viewPanelNote.textContent = inParallelView()
        ? "保留 L1/L2 骨架，只在 L3/L4 局部切换为 TP / EP / Collective 语义布局。"
        : "按模型层级展开算子结构，优先解释模块组成与计算流。";
    }
    if (viewLegend) {
      viewLegend.className = inParallelView() ? "view-summary-list" : "view-legend";
      viewLegend.innerHTML = items.map((item) => [
        `<div class="${inParallelView() ? "view-summary-item" : "view-legend-item"}">`,
        `  <span class="view-swatch" style="background:${swatchColor(item.kind)}"></span>`,
        '  <span class="view-copy">',
        `    <strong>${item.label}</strong>`,
        `    <span>${item.description}</span>`,
        "  </span>",
        "</div>",
      ].join("")).join("");
    }
  }

  function updateGraphTitle() {
    if (!graphTitleEl) return;
    const modelLabel = state.modelVersion === "v3_2" ? "DeepSeek V3.2" : "DeepSeek V3";
    const modeLabel = inParallelView() ? "并行视图" : "模型架构";
    graphTitleEl.textContent = `${modelLabel} · ${modeLabel}`;
  }

  function updateVersionPicker() {
    const v3Btn = document.getElementById("btn-v3");
    const v32Btn = document.getElementById("btn-v3_2");
    if (v3Btn) v3Btn.classList.toggle("active", state.modelVersion === "v3");
    if (v32Btn) v32Btn.classList.toggle("active", state.modelVersion === "v3_2");
  }

  function updateViewPicker() {
    const structureBtn = document.getElementById("btn-structure");
    const parallelBtn = document.getElementById("btn-parallel");
    if (structureBtn) {
      const active = state.viewMode === "structure";
      structureBtn.classList.toggle("active", active);
      structureBtn.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (parallelBtn) {
      const active = state.viewMode === "parallel";
      parallelBtn.classList.toggle("active", active);
      parallelBtn.setAttribute("aria-selected", active ? "true" : "false");
    }
  }

  function updateToolbarUi() {
    updateVersionPicker();
    updateViewPicker();
    updateGraphTitle();
    renderViewPanel();
  }

  document.getElementById("btn-v3").addEventListener("click", () => {
    state.modelVersion = "v3";
    setExpandedForLayer(getSelectedLayer(), {
      attention: state.expanded.attention,
      feedforward: state.expanded.feedforward,
    });
    updateToolbarUi();
    scheduleRender(true);
  });

  document.getElementById("btn-v3_2").addEventListener("click", () => {
    state.modelVersion = "v3_2";
    setExpandedForLayer(getSelectedLayer(), {
      attention: state.expanded.attention,
      feedforward: state.expanded.feedforward,
    });
    updateToolbarUi();
    scheduleRender(true);
  });

  document.getElementById("btn-structure").addEventListener("click", () => {
    if (state.viewMode === "structure") return;
    state.viewMode = "structure";
    updateToolbarUi();
    scheduleRender(true);
  });

  document.getElementById("btn-parallel").addEventListener("click", () => {
    if (state.viewMode === "parallel") return;
    state.viewMode = "parallel";
    updateToolbarUi();
    scheduleRender(true);
  });

  setDefaultExpanded(data.layers[0]);
  injectPillDefs();
  updateToolbarUi();
  render(true);
})();

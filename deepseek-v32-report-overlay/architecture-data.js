(function registerDeepSeekArchitectureData(global) {
  "use strict";

  const NODE_WIDTH = 336;
  const NODE_HEIGHT = 56;
  const CLUSTER_PADDING_X = 28;
  const CLUSTER_TITLE_HEIGHT = 46;
  const REPEAT_CLUSTER_TITLE_HEIGHT = 62;
  const CLUSTER_PADDING_BOTTOM = 26;
  const ROW_GAP = 24;
  const TOP_LEVEL_GAP = 44;
  const BRANCH_GAP = 36;
  const SECTION_GAP = 72;
  const GRAPH_PADDING = 40;

  function allItems(graphSpec) {
    const items = [];
    function visit(item, parentId = "", depth = 0) {
      if (!item || typeof item.id !== "string" || !item.id) return;
      items.push({ item, parentId, depth });
      (item.children || []).forEach((child) => visit(child, item.id, depth + 1));
    }
    (graphSpec.roots || []).forEach((root) => visit(root));
    return items;
  }

  function itemIndex(graphSpec) {
    return new Map(allItems(graphSpec).map((entry) => [entry.item.id, entry]));
  }

  function repeatCountFor(item) {
    return Number(item.repeatCount || item.instanceIndices?.length || 0);
  }

  function metricReportFor(item, reports) {
    return item.backendNodeId ? reports[item.backendNodeId] : null;
  }

  function typeLabelFor(item, report, collapsed) {
    const sourceKind = item.typeLabel || item.kind || (collapsed ? "Module" : "Node");
    return [collapsed ? `${sourceKind} · folded` : sourceKind, collapsed ? (report?.metricShort || "") : ""]
      .filter(Boolean)
      .join(" · ");
  }

  function rowLayout(children, gap = BRANCH_GAP) {
    const width = children.reduce((sum, child) => sum + child.width, 0)
      + Math.max(0, children.length - 1) * gap;
    const height = children.length ? Math.max(...children.map((child) => child.height)) : 0;
    let x = 0;
    const placements = children.map((child) => {
      const placement = { child, x, y: (height - child.height) / 2 };
      x += child.width + gap;
      return placement;
    });
    return { width, height, placements };
  }

  function rowsLayout(rows, rowGap = ROW_GAP) {
    const rowMeasures = rows.filter((row) => row.length).map((row) => rowLayout(row));
    const width = rowMeasures.length ? Math.max(...rowMeasures.map((row) => row.width)) : 0;
    let y = 0;
    const placements = [];
    rowMeasures.forEach((row, index) => {
      row.placements.forEach((placement) => placements.push({
        child: placement.child,
        x: (width - row.width) / 2 + placement.x,
        y: y + placement.y,
      }));
      y += row.height;
      if (index < rowMeasures.length - 1) y += rowGap;
    });
    return { width, height: y, placements };
  }

  function rowsFor(item, childLayouts) {
    const byId = new Map(childLayouts.map((layout) => [layout.item.id, layout]));
    const used = new Set();
    const rows = [];

    if (Array.isArray(item.layoutRows)) {
      item.layoutRows.forEach((rowIds) => {
        const row = (Array.isArray(rowIds) ? rowIds : [rowIds])
          .map((id) => byId.get(id))
          .filter(Boolean);
        row.forEach((layout) => used.add(layout.item.id));
        if (row.length) rows.push(row);
      });
    } else if (item.layout === "parallel") {
      childLayouts.forEach((layout) => used.add(layout.item.id));
      rows.push(childLayouts);
    }

    childLayouts.forEach((layout) => {
      if (used.has(layout.item.id)) return;
      rows.push([layout]);
    });
    return rows;
  }

  function layoutItem(item, collapsedIds) {
    const children = item.children || [];
    const collapsed = children.length > 0 && collapsedIds.has(item.id);
    if (!children.length || collapsed) {
      return {
        item,
        collapsed,
        width: NODE_WIDTH,
        height: Number(item.height) || NODE_HEIGHT,
        placements: [],
      };
    }

    const childLayouts = children.map((child) => layoutItem(child, collapsedIds));
    const rowGap = item.synthetic ? TOP_LEVEL_GAP : ROW_GAP;
    const content = rowsLayout(rowsFor(item, childLayouts), rowGap);
    const titleHeight = repeatCountFor(item) > 1
      ? REPEAT_CLUSTER_TITLE_HEIGHT
      : CLUSTER_TITLE_HEIGHT;
    const width = Math.max(NODE_WIDTH + CLUSTER_PADDING_X * 2, content.width + CLUSTER_PADDING_X * 2);
    const placements = content.placements.map((placement) => ({
      child: placement.child,
      x: CLUSTER_PADDING_X + (content.width
        ? (width - CLUSTER_PADDING_X * 2 - content.width) / 2
        : 0) + placement.x,
      y: titleHeight + placement.y,
    }));

    return {
      item,
      collapsed: false,
      width,
      height: titleHeight + content.height + CLUSTER_PADDING_BOTTOM,
      placements,
    };
  }

  function visualProps(item) {
    return {
      backendNodeId: item.backendNodeId || undefined,
      dataState: item.dataState || (item.backendNodeId ? "mapped" : "source_only"),
      origin: item.origin || "source",
      selectable: item.selectable === true,
      mappingKind: item.mappingKind || undefined,
    };
  }

  function resolveVisibleEndpoint(itemId, direction, visibleNodes, collapsedIds, index) {
    if (visibleNodes.has(itemId)) return itemId;
    let current = index.get(itemId);
    while (current?.parentId) {
      if (collapsedIds.has(current.parentId) && visibleNodes.has(current.parentId)) return current.parentId;
      current = index.get(current.parentId);
    }

    const entry = index.get(itemId);
    if (!entry) return "";
    const candidates = [];
    function collect(item) {
      if (visibleNodes.has(item.id)) {
        candidates.push(item.id);
        return;
      }
      (item.children || []).forEach(collect);
    }
    collect(entry.item);
    if (!candidates.length) return "";
    return direction === "source" ? candidates[candidates.length - 1] : candidates[0];
  }

  function projectEdges(graphSpec, nodes, collapsedIds) {
    const index = itemIndex(graphSpec);
    const visibleNodes = new Set(nodes.map((node) => node.id));
    const emitted = new Set();
    return (graphSpec.edges || []).map((edge) => {
      const source = resolveVisibleEndpoint(edge.source, "source", visibleNodes, collapsedIds, index);
      const target = resolveVisibleEndpoint(edge.target, "target", visibleNodes, collapsedIds, index);
      if (!source || !target || source === target) return null;
      const key = `${source}->${target}`;
      if (emitted.has(key)) return null;
      emitted.add(key);
      return {
        ...edge,
        id: edge.id || key,
        source,
        target,
        dataState: edge.dataState || "source_only",
      };
    }).filter(Boolean);
  }

  function projectGraph(graphSpec, reports, collapsedIds) {
    const rootLayouts = (graphSpec.roots || []).map((root) => layoutItem(root, collapsedIds));
    const nodes = [];
    const clusters = [];

    function emit(layout, x, y, parentId = "") {
      const item = layout.item;
      const report = metricReportFor(item, reports);
      const repeatCount = repeatCountFor(item);
      const common = visualProps(item);
      if (!(item.children || []).length || layout.collapsed) {
        nodes.push({
          id: item.id,
          label: item.label || item.id,
          typeLabel: typeLabelFor(item, report, layout.collapsed),
          kind: layout.collapsed ? "module" : (item.kind || "op"),
          x: x + layout.width / 2,
          y: y + layout.height / 2,
          width: layout.width,
          height: layout.height,
          colorKey: item.colorKey || "opv:op",
          parent: parentId || undefined,
          collapsed: layout.collapsed || undefined,
          repeatCount: repeatCount > 1 ? repeatCount : undefined,
          instanceIndices: repeatCount > 1 ? item.instanceIndices : undefined,
          repeatRange: item.repeatRange || undefined,
          metricBadge: !layout.collapsed && item.kind === "op" ? (report?.metricShort || undefined) : undefined,
          ...common,
        });
        return;
      }

      const directNodes = layout.placements
        .filter(({ child }) => !(child.item.children || []).length || child.collapsed)
        .map(({ child }) => child.item.id);
      const directClusters = layout.placements
        .filter(({ child }) => (child.item.children || []).length && !child.collapsed)
        .map(({ child }) => child.item.id);
      clusters.push({
        id: item.id,
        label: item.label || item.id,
        x,
        y,
        width: layout.width,
        height: layout.height,
        colorKey: item.colorKey || "module:model",
        parent: parentId || undefined,
        nodes: directNodes,
        children: directClusters,
        repeat: repeatCount > 1,
        repeatCount: repeatCount > 1 ? repeatCount : undefined,
        instanceIndices: repeatCount > 1 ? item.instanceIndices : undefined,
        repeatRange: item.repeatRange || undefined,
        metric: report?.metricShort || undefined,
        collapsible: item.synthetic !== true,
        ...common,
      });

      layout.placements.forEach((placement) => {
        emit(placement.child, x + placement.x, y + placement.y, item.id);
      });
    }

    let x = GRAPH_PADDING;
    rootLayouts.forEach((layout) => {
      emit(layout, x, GRAPH_PADDING);
      x += layout.width + SECTION_GAP;
    });

    const graphWidth = rootLayouts.length ? x - SECTION_GAP + GRAPH_PADDING : 960;
    const graphHeight = Math.max(720, ...rootLayouts.map((layout) => layout.height)) + GRAPH_PADDING * 2;
    const visibleItemCount = nodes.length + clusters.filter((cluster) => !cluster.id.startsWith("section/")).length;
    const interactiveItemCount = [...nodes, ...clusters].filter((item) => item.selectable).length;

    return {
      width: Math.max(graphWidth, 960),
      height: graphHeight,
      nodes,
      clusters,
      edges: projectEdges(graphSpec, nodes, collapsedIds),
      metadata: {
        ...(graphSpec.metadata || {}),
        extractionScope: "hybrid",
        layoutDirection: "top_to_bottom",
        visibleItemCount,
        interactiveItemCount,
        collapsedIds: [...collapsedIds],
      },
    };
  }

  function defaultCollapsedIds(graphSpec) {
    return allItems(graphSpec)
      .filter(({ item, depth }) => (item.children || []).length && !item.synthetic
        && (item.defaultCollapsed === true || (item.defaultCollapsed == null && depth >= 4)))
      .map(({ item }) => item.id);
  }

  function createArchitectureGraph(graphSpec, reports = {}) {
    return projectGraph(graphSpec, reports, new Set());
  }

  function createArchitectureView(graphSpec, reports = {}, collapsedIds = defaultCollapsedIds(graphSpec)) {
    return projectGraph(graphSpec, reports, new Set(collapsedIds));
  }

  function backendToGraphId(graphSpec, backendNodeId) {
    return allItems(graphSpec).find(({ item }) => item.backendNodeId === backendNodeId)?.item.id || "";
  }

  function graphToBackendNodeId(graphSpec, graphNodeId) {
    return itemIndex(graphSpec).get(graphNodeId)?.item.backendNodeId || "";
  }

  function ancestorIdsForGraphId(graphSpec, graphNodeId) {
    const index = itemIndex(graphSpec);
    const ancestors = [];
    let current = index.get(graphNodeId);
    while (current?.parentId) {
      ancestors.push(current.parentId);
      current = index.get(current.parentId);
    }
    return ancestors;
  }

  global.DeepSeekArchitectureData = {
    createArchitectureGraph,
    createArchitectureView,
    defaultCollapsedIds,
    backendToGraphId,
    graphToBackendNodeId,
    ancestorIdsForGraphId,
  };
})(typeof window === "undefined" ? globalThis : window);

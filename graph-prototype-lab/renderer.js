const SVG_NS = "http://www.w3.org/2000/svg";

export class GraphRenderer {
  constructor(svgElement, callbacks = {}) {
    this.svg = svgElement;
    this.callbacks = callbacks;
    this.transform = {scale: 1, tx: 0, ty: 0};
    this.scene = null;
    this.selection = null;
    this.dragState = null;
    this.minimapSvg = document.getElementById("miniMapSvg");
    this.zoomInBtn = document.getElementById("zoomInBtn");
    this.zoomOutBtn = document.getElementById("zoomOutBtn");

    this.svg.setAttribute("viewBox", `0 0 ${this.svg.clientWidth || 1000} ${this.svg.clientHeight || 700}`);

    this.viewport = createSvgElement("g", {class: "viewport"});
    this.groupLayer = createSvgElement("g", {class: "groups"});
    this.edgeLayer = createSvgElement("g", {class: "edges"});
    this.nodeLayer = createSvgElement("g", {class: "nodes"});
    this.annotationLayer = createSvgElement("g", {class: "annotations"});
    this.viewport.append(this.groupLayer, this.edgeLayer, this.nodeLayer, this.annotationLayer);
    this.svg.appendChild(this.viewport);

    this.installInteractions();
  }

  setScene(scene, options = {}) {
    this.scene = scene;
    this.selection = options.selection || this.selection;
    this.render();
    if (options.fit) {
      this.fitToScene();
    } else {
      this.applyTransform();
    }
  }

  setSelection(selection) {
    this.selection = selection;
    this.render();
  }

  fitToScene() {
    if (!this.scene) {
      return;
    }
    const rect = this.svg.getBoundingClientRect();
    const width = Math.max(rect.width, 320);
    const height = Math.max(rect.height, 320);
    const pad = 32;
    const scale = Math.min(
      (width - pad * 2) / Math.max(this.scene.layout.canvasW, 1),
      (height - pad * 2) / Math.max(this.scene.layout.canvasH, 1),
      1
    );
    this.transform.scale = Math.max(scale, 0.08);
    this.transform.tx = (width - this.scene.layout.canvasW * this.transform.scale) / 2;
    this.transform.ty = (height - this.scene.layout.canvasH * this.transform.scale) / 2;
    this.applyTransform();
  }

  installInteractions() {
    this.svg.addEventListener("wheel", (event) => {
      event.preventDefault();
    }, {passive: false});

    this.zoomInBtn?.addEventListener("click", () => this.zoomBy(1.18));
    this.zoomOutBtn?.addEventListener("click", () => this.zoomBy(0.84));

    this.svg.addEventListener("mousedown", (event) => {
      if (!this.scene) {
        return;
      }
      const target = event.target;
      if (target.closest("[data-role='toggle']") || target.closest("[data-node-id]") || target.closest("[data-edge-id]")) {
        return;
      }
      this.dragState = {
        x: event.clientX,
        y: event.clientY,
        tx: this.transform.tx,
        ty: this.transform.ty,
      };
      this.svg.classList.add("is-panning");
    });

    window.addEventListener("mousemove", (event) => {
      if (!this.dragState) {
        return;
      }
      this.transform.tx = this.dragState.tx + (event.clientX - this.dragState.x);
      this.transform.ty = this.dragState.ty + (event.clientY - this.dragState.y);
      this.applyTransform();
    });

    window.addEventListener("mouseup", () => {
      this.dragState = null;
      this.svg.classList.remove("is-panning");
    });

    this.svg.addEventListener("dblclick", () => this.fitToScene());
  }

  applyTransform() {
    this.viewport.setAttribute(
      "transform",
      `translate(${this.transform.tx}, ${this.transform.ty}) scale(${this.transform.scale})`
    );
    this.renderMinimap();
  }

  render() {
    clearChildren(this.groupLayer);
    clearChildren(this.edgeLayer);
    clearChildren(this.nodeLayer);
    clearChildren(this.annotationLayer);

    if (!this.scene) {
      return;
    }

    const {graph, layout} = this.scene;
    const positions = layout.positions;

    const groups = graph.nodes
      .filter((node) => node.kind === "group")
      .sort((left, right) => (left.data?.depth || 0) - (right.data?.depth || 0));

    groups.forEach((node) => {
      const rect = positions.get(node.id);
      if (!rect) {
        return;
      }
      this.groupLayer.appendChild(this.renderGroup(node, rect));
    });

    layout.edges.forEach((edgeLayout) => {
      const edge = graph.edges.find((entry) => entry.id === edgeLayout.id);
      if (!edge) {
        return;
      }
      this.edgeLayer.appendChild(this.renderEdge(edge, edgeLayout));
    });

    graph.nodes
      .filter((node) => node.kind !== "group")
      .forEach((node) => {
        const rect = positions.get(node.id);
        if (!rect) {
          return;
        }
        this.nodeLayer.appendChild(this.renderNode(node, rect));
      });

    graph.nodes.forEach((node) => {
      if (node.kind === "group" && !node.expanded) {
        return;
      }
      const rect = positions.get(node.id);
      if (!rect) {
        return;
      }
      if (!node.annotations?.in?.length && !node.annotations?.out?.length) {
        return;
      }
      this.annotationLayer.appendChild(this.renderAnnotations(node, rect, graph.direction || "LR"));
    });

    this.renderMinimap();
  }

  zoomBy(factor) {
    if (!this.scene) {
      return;
    }
    const rect = this.svg.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const nextScale = clamp(this.transform.scale * factor, 0.04, 3.2);
    const ratio = nextScale / this.transform.scale;
    this.transform.tx = cx - ratio * (cx - this.transform.tx);
    this.transform.ty = cy - ratio * (cy - this.transform.ty);
    this.transform.scale = nextScale;
    this.applyTransform();
  }

  renderMinimap() {
    if (!this.minimapSvg || !this.scene) {
      return;
    }

    clearChildren(this.minimapSvg);
    const {graph, layout} = this.scene;
    this.minimapSvg.setAttribute("viewBox", `0 0 ${layout.canvasW} ${layout.canvasH}`);

    graph.nodes.forEach((node) => {
      const rect = layout.positions.get(node.id);
      if (!rect) return;
      this.minimapSvg.appendChild(createSvgElement("rect", {
        class: `minimap-node minimap-${node.kind}`,
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
        rx: node.kind === "group" ? 14 : 8,
        ry: node.kind === "group" ? 14 : 8,
      }));
    });

    const svgRect = this.svg.getBoundingClientRect();
    this.minimapSvg.appendChild(createSvgElement("rect", {
      class: "minimap-viewport",
      x: -this.transform.tx / this.transform.scale,
      y: -this.transform.ty / this.transform.scale,
      width: svgRect.width / this.transform.scale,
      height: svgRect.height / this.transform.scale,
      rx: 18,
      ry: 18,
    }));
  }

  renderGroup(node, rect) {
    const group = createSvgElement("g", {
      class: "group-frame",
      "data-node-id": node.id,
    });

    const selected = this.selection?.kind === "node" && this.selection.id === node.id;
    const surface = createSvgElement("rect", {
      class: `group-surface stage-${node.data?.stage || "default"} ${parentColorClass(node)}${selected ? " is-selected" : ""}`,
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      rx: node.expanded ? 18 : 14,
      ry: node.expanded ? 18 : 14,
    });
    const headerBand = createSvgElement("rect", {
      class: "group-header-band",
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: node.expanded ? 40 : rect.h,
      rx: 18,
      ry: 18,
    });
    group.append(surface, headerBand);

    const label = createSvgElement("text", {
      class: "group-label",
      x: rect.x + 12,
      y: rect.y + 18,
    });
    label.textContent = node.label;
    label.setAttribute("text-anchor", "start");
    group.appendChild(label);

    const subtitle = createSvgElement("text", {
      class: "group-subtitle",
      x: rect.x + 12,
      y: rect.y + 34,
    });
    subtitle.textContent = compactGroupDescription(node, rect.w - 46);
    subtitle.setAttribute("text-anchor", "start");
    group.appendChild(subtitle);

    group.addEventListener("click", (event) => {
      event.stopPropagation();
      this.callbacks.onSelectNode?.(node);
    });

    if (node.hasChildren) {
      const toggle = createSvgElement("g", {
        "data-role": "toggle",
      });
      const size = 18;
      const toggleSurface = createSvgElement("rect", {
        class: "toggle-surface",
        x: rect.x + rect.w - size - 10,
        y: rect.y + 10,
        width: size,
        height: size,
        rx: 5,
        ry: 5,
      });
      toggle.appendChild(toggleSurface);
      toggle.appendChild(createSvgElement("line", {
        class: "toggle-mark",
        x1: rect.x + rect.w - size - 5,
        y1: rect.y + 19,
        x2: rect.x + rect.w - 15,
        y2: rect.y + 19,
      }));
      if (!node.expanded) {
        toggle.appendChild(createSvgElement("line", {
          class: "toggle-mark",
          x1: rect.x + rect.w - 19,
          y1: rect.y + 15,
          x2: rect.x + rect.w - 19,
          y2: rect.y + 23,
        }));
      }
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        this.callbacks.onToggleGroup?.(node.id);
      });
      group.appendChild(toggle);
    }

    return group;
  }

  renderNode(node, rect) {
    const selected = this.selection?.kind === "node" && this.selection.id === node.id;
    const group = createSvgElement("g", {
      class: "node-frame",
      "data-node-id": node.id,
    });

    const coreX = rect.x + (node.inboxWidth || 0);
    const coreY = rect.y + (rect.h - node.coreHeight) / 2;

    if (node.data?.rawType === "Title") {
      const label = createSvgElement("text", {
        class: "graph-title-label",
        x: coreX,
        y: coreY + 28,
      });
      label.textContent = node.label;
      label.setAttribute("text-anchor", "start");
      group.removeAttribute("data-node-id");
      group.appendChild(label);
      return group;
    }

    if (node.kind === "op") {
      // Render ops as group-card style: gray fill, left-aligned, matches collapsed group appearance
      const surface = createSvgElement("rect", {
        class: `group-surface kind-op stage-${node.data?.stage || "default"} ${parentColorClass(node)}${selected ? " is-selected" : ""}`,
        x: coreX, y: coreY, width: node.coreWidth, height: node.coreHeight, rx: 14, ry: 14,
      });
      const headerBand = createSvgElement("rect", {
        class: "group-header-band",
        x: coreX, y: coreY, width: node.coreWidth, height: node.coreHeight, rx: 14, ry: 14,
      });
      group.append(surface, headerBand);

      const label = createSvgElement("text", {class: "group-label", x: coreX + 12, y: coreY + 18});
      label.textContent = node.label;
      label.setAttribute("text-anchor", "start");
      group.appendChild(label);

      const subtitleText = buildNodeSubtitle(node);
      if (subtitleText) {
        const subtitle = createSvgElement("text", {class: "group-subtitle", x: coreX + 12, y: coreY + 32});
        subtitle.textContent = subtitleText;
        subtitle.setAttribute("text-anchor", "start");
        group.appendChild(subtitle);
      }

      group.addEventListener("click", (event) => {
        event.stopPropagation();
        this.callbacks.onSelectNode?.(node);
      });
    } else {
      const centerX = coreX + node.coreWidth / 2;
      const surface = createSvgElement("rect", {
        class: `node-surface kind-${node.kind} stage-${node.data?.stage || "default"} ${parentColorClass(node)}${selected ? " is-selected" : ""}`,
        x: coreX, y: coreY, width: node.coreWidth, height: node.coreHeight, rx: 12, ry: 12,
      });
      group.appendChild(surface);

      wrapSvgText(group, {
        className: "node-label",
        x: centerX,
        y: coreY + node.coreHeight / 2,
        lines: splitLabel(node.label, 18),
        lineHeight: 14,
      });

      const subtitleText = buildNodeSubtitle(node);
      if (subtitleText) {
        const subtitle = createSvgElement("text", {
          class: "node-subtitle", x: centerX, y: coreY + node.coreHeight - 10,
        });
        subtitle.textContent = subtitleText;
        group.appendChild(subtitle);
      }

      group.addEventListener("click", (event) => {
        event.stopPropagation();
        this.callbacks.onSelectNode?.(node);
      });
    }

    return group;
  }

  renderEdge(edge, edgeLayout) {
    const group = createSvgElement("g", {
      "data-edge-id": edge.id,
    });

    const thickness = 1;
    const pathData = buildPath(edgeLayout.points);
    const selected = this.selection?.kind === "edge" && this.selection.id === edge.id;

    const hit = createSvgElement("path", {
      class: `edge-hit${selected ? " is-selected" : ""}`,
      d: pathData,
    });
    const path = createSvgElement("path", {
      class: `edge-path${edge.kind === "direct" ? " is-faint" : ""}`,
      d: pathData,
      "stroke-width": "1",
      "vector-effect": "non-scaling-stroke",
    });

    hit.addEventListener("click", (event) => {
      event.stopPropagation();
      this.callbacks.onSelectEdge?.(edge);
    });

    group.append(hit, path);

    if (edge.label && edgeLayout.labelPoint) {
      const text = createSvgElement("text", {
        class: "edge-label",
        x: edgeLayout.labelPoint.x,
        y: edgeLayout.labelPoint.y + 3,
        "text-anchor": "middle",
        "pointer-events": "none",
      });
      text.textContent = edge.label;
      group.appendChild(text);
    }

    return group;
  }

  renderAnnotations(node, rect, direction = "LR") {
    const group = createSvgElement("g", {"data-node-id": node.id});
    const coreX = rect.x + (node.inboxWidth || 0);
    const coreY = rect.y + (rect.h - node.coreHeight) / 2;
    const centerX = coreX + node.coreWidth / 2;

    const inAnnotations = collapseAnnotations(node.annotations.in);
    const outAnnotations = collapseAnnotations(node.annotations.out);

    if (direction === "TB") {
      renderSideTB(inAnnotations, true);
      renderSideTB(outAnnotations, false);
    } else {
      renderSideLR(inAnnotations, true);
      renderSideLR(outAnnotations, false);
    }

    return group;

    function renderSideLR(items, isInput) {
      if (!items.length) return;
      const totalHeight = items.length * 18 + (items.length - 1) * 6;
      const startY = rect.y + rect.h / 2 - totalHeight / 2;
      const anchorX = isInput ? coreX : coreX + node.coreWidth;
      items.forEach((item, index) => {
        const width = Math.max(68, Math.min(176, 26 + compactAnnotationLabel(item).length * 6));
        const height = 18;
        const x = isInput ? coreX - width - 12 : coreX + node.coreWidth + 12;
        const y = startY + index * (height + 6);
        const centerY = y + height / 2;
        const line = createSvgElement("line", {
          x1: isInput ? x + width : anchorX, y1: centerY,
          x2: isInput ? anchorX : x, y2: centerY,
          stroke: "#9a9a9a", "stroke-width": "1",
        });
        const chip = createSvgElement("rect", {class: "annotation-chip", x, y, width, height, rx: 9, ry: 9});
        const text = createSvgElement("text", {
          class: "annotation-label",
          x: isInput ? x + width - 8 : x + 8,
          y: y + 12,
          "text-anchor": isInput ? "end" : "start",
        });
        text.textContent = compactAnnotationLabel(item);
        group.append(line, chip, text);
      });
    }

    function renderSideTB(items, isInput) {
      if (!items.length) return;
      const height = 18;
      const gap = 6;
      const totalHeight = items.length * height + (items.length - 1) * gap;
      const startY = isInput ? coreY - 12 - totalHeight : coreY + node.coreHeight + 12;
      const nodeAnchorY = isInput ? coreY : coreY + node.coreHeight;
      items.forEach((item, index) => {
        const width = Math.max(68, Math.min(176, 26 + compactAnnotationLabel(item).length * 6));
        const chipX = centerX - width / 2;
        const chipY = startY + index * (height + gap);
        const chipEdgeY = isInput ? chipY + height : chipY;
        const line = createSvgElement("line", {
          x1: centerX, y1: nodeAnchorY, x2: centerX, y2: chipEdgeY,
          stroke: "#9a9a9a", "stroke-width": "1",
        });
        const chip = createSvgElement("rect", {class: "annotation-chip", x: chipX, y: chipY, width, height, rx: 9, ry: 9});
        const text = createSvgElement("text", {
          class: "annotation-label", x: chipX + width / 2, y: chipY + 12, "text-anchor": "middle",
        });
        text.textContent = compactAnnotationLabel(item);
        group.append(line, chip, text);
      });
    }
  }
}

function buildNodeSubtitle(node) {
  if (node.kind === "op") {
    const stage = node.data?.stage ? String(node.data.stage) : "";
    return stage || (node.data?.semanticLabel || node.data?.opcode || "");
  }
  if (node.kind === "tensor" || node.kind === "boundary") {
    const shape = node.data?.shape;
    if (typeof shape === "string" && shape) {
      return shape;
    }
    if (Array.isArray(shape) && shape.length) {
      return `[${shape.join(", ")}]`;
    }
    return node.data?.role || "";
  }
  return "";
}

function clearChildren(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tagName);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

function wrapSvgText(parent, config) {
  const group = createSvgElement("g", {});
  config.lines.forEach((line, index) => {
    const text = createSvgElement("text", {
      class: config.className,
      x: config.x,
      y: config.y + index * config.lineHeight,
    });
    text.textContent = line;
    group.appendChild(text);
  });
  parent.appendChild(group);
  return group;
}

function splitLabel(label, maxChars) {
  const words = String(label || "").split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [String(label || "")];
  }
  const lines = [];
  let current = words[0];
  for (let index = 1; index < words.length; index += 1) {
    const next = words[index];
    if ((`${current} ${next}`).length <= maxChars) {
      current = `${current} ${next}`;
    } else {
      lines.push(current);
      current = next;
      if (lines.length === 2) {
        break;
      }
    }
  }
  if (lines.length < 2 && current) {
    lines.push(current);
  }
  if (lines.length === 2 && words.length > 2) {
    lines[1] = lines[1].length > maxChars ? `${lines[1].slice(0, maxChars - 3)}...` : lines[1];
  }
  return lines.slice(0, 2);
}

function compactGroupDescription(node, maxWidth) {
  const description = node.data?.description || stageDescription(node.data?.stage);
  const text = String(description || "Container for related graph operations.").trim();
  const maxChars = Math.max(14, Math.floor(maxWidth / 8.5));
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
}

function stageDescription(stage) {
  const descriptions = {
    attention: "注意力计算路径，负责 token 混合和 KV 读取。",
    csa: "压缩稀疏注意力路径。",
    indexer: "路由、top-k 选择和索引检索路径。",
    mlp: "前馈网络或专家 MLP 路径。",
    core: "主干 Transformer 数据流。",
    compressor: "token 级压缩和状态更新路径。",
    cache: "运行时 KV cache 存储。",
    state: "跨步骤保留的 KV 或 score 状态。",
  };
  return descriptions[String(stage || "")] || "相关算子的模块容器。";
}

function parentColorClass(node) {
  const parentKey = node.kind === "group" ? node.id : (node.visibleParentId || node.parentId || "");
  if (!parentKey) {
    return "parent-color-default";
  }
  return `parent-color-${stableHash(parentKey) % 10}`;
}

function stableHash(value) {
  return String(value).split("").reduce((hash, char) => {
    return ((hash << 5) - hash + char.charCodeAt(0)) >>> 0;
  }, 0);
}

function collapseAnnotations(items) {
  if (items.length <= 4) {
    return items;
  }
  const visible = items.slice(0, 3);
  visible.push({
    label: `+${items.length - 3} more`,
    shape: "",
    id: `ellipsis_${items.length}`,
  });
  return visible;
}

function compactAnnotationLabel(item) {
  if (item.label && item.label.startsWith("+")) {
    return item.label;
  }
  const base = String(item.label || "");
  const shortBase = base.length > 16 ? `${base.slice(0, 13)}...` : base;
  if (item.shape && String(item.shape).length <= 16) {
    return `${shortBase} ${item.shape}`.trim();
  }
  return shortBase;
}

function buildPath(points) {
  if (!points.length) return "";

  const r = (n) => Math.round(n * 10) / 10;

  if (points.length === 2) {
    // Two-point: smooth S-curve (cubic bezier), control points pulled toward midY
    const [p0, p1] = points;
    const mY = (p0.y + p1.y) / 2;
    return `M ${r(p0.x)} ${r(p0.y)} C ${r(p0.x)} ${r(mY)} ${r(p1.x)} ${r(mY)} ${r(p1.x)} ${r(p1.y)}`;
  }

  // Multi-point (ELK orthogonal waypoints): round each corner with a
  // quadratic bezier, radius capped to half the shorter adjacent segment.
  const RADIUS = 10;
  let d = `M ${r(points[0].x)} ${r(points[0].y)}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;

    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;

    const rad = Math.min(RADIUS, len1 / 2, len2 / 2);

    // Approach point (just before the corner)
    const bx = curr.x - (dx1 / len1) * rad;
    const by = curr.y - (dy1 / len1) * rad;
    // Departure point (just after the corner)
    const ax = curr.x + (dx2 / len2) * rad;
    const ay = curr.y + (dy2 / len2) * rad;

    d += ` L ${r(bx)} ${r(by)} Q ${r(curr.x)} ${r(curr.y)} ${r(ax)} ${r(ay)}`;
  }

  const last = points[points.length - 1];
  d += ` L ${r(last.x)} ${r(last.y)}`;
  return d;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

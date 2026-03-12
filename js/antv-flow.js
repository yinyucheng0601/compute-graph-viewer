(function (global) {
  const X6 = global.X6;
  const XHTML_NS = 'http://www.w3.org/1999/xhtml';

  if (!X6 || !X6.Graph) {
    global.AntvFlowGraph = null;
    return;
  }

  const DEFAULTS = {
    minScale: 0.06,
    maxScale: 4,
  };
  const SUPPORTS_FOREIGN_OBJECT = X6.SUPPORT_FOREIGNOBJECT !== false;
  const FALLBACK_ACCENT = '#4f8cff';
  const BASE_EDGE_COLOR = 'rgba(255,255,255,0.18)';
  const HITBOX_FILL = 'rgba(0,0,0,0.001)';
  const EDGE_WRAP_STROKE = 'rgba(0,0,0,0.001)';
  const COMPACT_NODE_MARKUP = SUPPORTS_FOREIGN_OBJECT
    ? [
        {
          tagName: 'rect',
          selector: 'hitbox',
        },
        {
          tagName: 'foreignObject',
          selector: 'fo',
          children: [
            {
              tagName: 'div',
              ns: XHTML_NS,
              selector: 'foContent',
            },
          ],
        },
      ]
    : null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function safeText(value) {
    return value == null ? '' : String(value);
  }

  function escapeHtml(value) {
    return safeText(value).replace(/[&<>"']/g, (char) => {
      if (char === '&') return '&amp;';
      if (char === '<') return '&lt;';
      if (char === '>') return '&gt;';
      if (char === '"') return '&quot;';
      return '&#39;';
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function fallbackCompactOpCard(label) {
    return `
      <div class="op-pill">
        <span class="op-pill-name">${escapeHtml(label)}</span>
      </div>`;
  }

  function buildCompactOpNodeHtml(nodeSpec) {
    const accent = nodeSpec.color || FALLBACK_ACCENT;
    const inner = typeof global.buildCompactOpCard === 'function' && nodeSpec.nodeData
      ? global.buildCompactOpCard(nodeSpec.nodeData)
      : fallbackCompactOpCard(nodeSpec.label);
    return [
      `<div class="vt-antv-node-shell" style="width:${Math.round(nodeSpec.w)}px;height:${Math.round(nodeSpec.h)}px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:0 10px;overflow:visible;pointer-events:none;">`,
      `<div class="node-card node-card-op vt-antv-node-card" data-compact="" data-node-id="${escapeAttr(nodeSpec.id)}" style="--node-accent:${escapeAttr(accent)};width:100%;max-width:none;">`,
      inner,
      '</div>',
      '</div>',
    ].join('');
  }

  function makeEdgeLabelConfig(text, color, distance = 0.54) {
    if (!text) return [];
    return [{
      attrs: {
        body: {
          fill: 'transparent',
          stroke: 'none',
          strokeWidth: 0,
          rx: 0,
          ry: 0,
        },
        label: {
          text,
          fill: 'rgba(255,255,255,0.68)',
          fontSize: 10.5,
          fontWeight: 600,
          fontFamily: 'JetBrains Mono, Menlo, monospace',
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
        },
      },
      position: {
        distance,
      },
    }];
  }

  function eventPoint(evt) {
    const nativeEvent = evt?.e || evt;
    if (!nativeEvent) return null;
    if (typeof nativeEvent.clientX === 'number' && typeof nativeEvent.clientY === 'number') {
      return { x: nativeEvent.clientX, y: nativeEvent.clientY };
    }
    return null;
  }

  class AntvFlowGraph {
    constructor(container, options = {}) {
      this.container = container;
      this.options = { ...DEFAULTS, ...options };
      this.nodeCells = new Map();
      this.edgeCells = [];
      this.selectedNodeId = null;
      this.hoveredEdgeId = null;
      this.onNodeClick = null;
      this.onBlankClick = null;
      this.tooltipEl = document.createElement('div');
      this.tooltipEl.className = 'vt-antv-edge-tooltip';
      this.tooltipEl.hidden = true;

      this.graph = new X6.Graph({
        container,
        autoResize: true,
        grid: false,
        background: {
          color: 'transparent',
        },
        panning: {
          enabled: true,
          modifiers: null,
          eventTypes: ['leftMouseDown'],
        },
        mousewheel: {
          enabled: true,
          modifiers: ['ctrl', 'meta'],
          factor: 1.1,
          minScale: this.options.minScale,
          maxScale: this.options.maxScale,
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
      this.container.appendChild(this.tooltipEl);

      this.graph.on('node:click', ({ node }) => {
        this.hideTooltip();
        this.hoveredEdgeId = null;
        const data = node.getData() || {};
        if (data.kind !== 'op' || !data.nodeData) return;
        this.highlightNode(data.nodeData.id);
        if (typeof this.onNodeClick === 'function') {
          this.onNodeClick(data.nodeData, node);
        }
      });

      this.graph.on('blank:click', () => {
        this.hideTooltip();
        this.hoveredEdgeId = null;
        this.highlightNode(null);
        if (typeof this.onBlankClick === 'function') {
          this.onBlankClick();
        }
      });

      this.graph.on('edge:mouseenter', ({ edge, e }) => {
        const data = edge.getData() || {};
        this.hoveredEdgeId = edge.id;
        this.refreshEdgeStates();
        if (!data.detailText) return;
        this.showTooltip(data.detailText, eventPoint(e));
      });

      this.graph.on('edge:mousemove', ({ edge, e }) => {
        const data = edge.getData() || {};
        if (!data.detailText) return;
        this.moveTooltip(eventPoint(e));
      });

      this.graph.on('edge:mouseleave', () => {
        this.hoveredEdgeId = null;
        this.refreshEdgeStates();
        this.hideTooltip();
      });

      this.graph.on('edge:click', ({ edge, e }) => {
        const data = edge.getData() || {};
        this.hoveredEdgeId = edge.id;
        this.refreshEdgeStates();
        if (!data.detailText) return;
        this.showTooltip(data.detailText, eventPoint(e));
      });

      this.graph.on('scale', () => {
        this.syncZoomLabel();
      });
    }

    getScale() {
      const scale = this.graph.scale();
      return typeof scale?.sx === 'number' ? scale.sx : 1;
    }

    getZoomPercent() {
      return Math.round(this.getScale() * 100);
    }

    syncZoomLabel() {
      if (this.options.zoomLabelEl) {
        this.options.zoomLabelEl.textContent = `${this.getZoomPercent()}%`;
      }
    }

    clear() {
      this.nodeCells.clear();
      this.edgeCells = [];
      this.selectedNodeId = null;
      this.hoveredEdgeId = null;
      this.graph.clearCells();
      this.hideTooltip();
      this.syncZoomLabel();
    }

    render(scene, options = {}) {
      this.clear();
      this.onNodeClick = options.onNodeClick || null;
      this.onBlankClick = options.onBlankClick || null;
      this.scene = scene || null;

      if (!scene) {
        return { canvasW: 0, canvasH: 0, isAntv: true };
      }

      const graph = this.graph;
      const groups = new Map();

      (scene.groups || []).forEach((groupSpec) => {
        const group = graph.addNode({
          id: groupSpec.id,
          shape: 'rect',
          x: groupSpec.x,
          y: groupSpec.y,
          width: groupSpec.w,
          height: groupSpec.h,
          zIndex: 1,
          attrs: {
            body: {
              fill: 'rgba(255,255,255,0.02)',
              stroke: groupSpec.color || 'rgba(255,255,255,0.24)',
              strokeWidth: 1.2,
              strokeDasharray: '8 6',
              rx: 14,
              ry: 14,
            },
            label: {
              text: safeText(groupSpec.title),
              fill: groupSpec.color || 'rgba(255,255,255,0.72)',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'JetBrains Mono, Menlo, monospace',
              textVerticalAnchor: 'top',
              textAnchor: 'middle',
              refX: '50%',
              refY: 12,
            },
          },
          data: {
            kind: 'group',
          },
        });
        groups.set(groupSpec.id, group);
      });

      (scene.nodes || []).forEach((nodeSpec) => {
        const isStub = nodeSpec.kind === 'stub';
        const accent = nodeSpec.color || FALLBACK_ACCENT;
        const cell = graph.addNode({
          id: nodeSpec.id,
          shape: isStub ? 'circle' : 'rect',
          x: nodeSpec.x,
          y: nodeSpec.y,
          width: nodeSpec.w,
          height: nodeSpec.h,
          zIndex: isStub ? 4 : 10,
          markup: !isStub && SUPPORTS_FOREIGN_OBJECT ? COMPACT_NODE_MARKUP : undefined,
          attrs: isStub
            ? {
                body: {
                  fill: 'rgba(255,255,255,0.0)',
                  stroke: 'rgba(255,255,255,0.0)',
                },
              }
            : SUPPORTS_FOREIGN_OBJECT
              ? {
                  hitbox: {
                    refWidth: '100%',
                    refHeight: '100%',
                    fill: HITBOX_FILL,
                    stroke: 'none',
                    cursor: 'pointer',
                  },
                  fo: {
                    x: 0,
                    y: 0,
                    width: nodeSpec.w,
                    height: nodeSpec.h,
                    refWidth: '100%',
                    refHeight: '100%',
                    pointerEvents: 'none',
                  },
                  foContent: {
                    html: buildCompactOpNodeHtml(nodeSpec),
                  },
                }
              : {
                body: {
                  fill: 'rgba(18, 24, 38, 0.96)',
                  stroke: accent,
                  strokeWidth: 1.2,
                  rx: 10,
                  ry: 10,
                },
                label: {
                  text: safeText(nodeSpec.label),
                  fill: 'rgba(255,255,255,0.92)',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: 'PingFang SC, -apple-system, sans-serif',
                  textWrap: {
                    width: Math.max(40, nodeSpec.w - 20),
                    height: Math.max(24, nodeSpec.h - 12),
                    ellipsis: true,
                  },
                },
              },
          data: {
            kind: nodeSpec.kind,
            nodeData: nodeSpec.nodeData || null,
            accent,
            usesHtmlMarkup: !isStub && SUPPORTS_FOREIGN_OBJECT,
          },
        });
        this.nodeCells.set(nodeSpec.id, cell);
        if (nodeSpec.groupId && groups.has(nodeSpec.groupId)) {
          groups.get(nodeSpec.groupId).addChild(cell);
        }
      });

      (scene.edges || []).forEach((edgeSpec, index) => {
        const edge = graph.addEdge({
          id: edgeSpec.id || `edge_${index}`,
          source: edgeSpec.source,
          target: edgeSpec.target,
          vertices: edgeSpec.vertices || [],
          zIndex: 6,
          markup: [
            {
              tagName: 'path',
              selector: 'wrap',
            },
            {
              tagName: 'path',
              selector: 'line',
            },
          ],
          connector: {
            name: 'rounded',
            args: {
              radius: 8,
            },
          },
          attrs: {
            wrap: {
              connection: true,
              fill: 'none',
              stroke: EDGE_WRAP_STROKE,
              strokeWidth: 14,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              cursor: edgeSpec.detailText ? 'pointer' : 'default',
              pointerEvents: 'stroke',
            },
            line: {
              connection: true,
              fill: 'none',
              stroke: edgeSpec.color || BASE_EDGE_COLOR,
              strokeWidth: 1.15,
              cursor: edgeSpec.detailText ? 'pointer' : 'default',
              pointerEvents: 'none',
              targetMarker: {
                name: 'classic',
                size: 6,
              },
            },
          },
          labels: edgeSpec.alwaysShowLabel && edgeSpec.labelText
            ? makeEdgeLabelConfig(edgeSpec.labelText, edgeSpec.color, edgeSpec.labelDistance)
            : [],
          data: {
            source: edgeSpec.source,
            target: edgeSpec.target,
            color: edgeSpec.color || BASE_EDGE_COLOR,
            summaryText: edgeSpec.labelText || '',
            detailText: edgeSpec.detailText || '',
            labelDistance: typeof edgeSpec.labelDistance === 'number' ? edgeSpec.labelDistance : 0.54,
            alwaysShowLabel: !!edgeSpec.alwaysShowLabel,
            showLabelOnSelect: !!edgeSpec.showLabelOnSelect,
          },
        });
        this.edgeCells.push(edge);

        if (edgeSpec.groupId && groups.has(edgeSpec.groupId)) {
          groups.get(edgeSpec.groupId).addChild(edge);
        }
      });

      graph.resize(Math.max(this.container.clientWidth, scene.canvasW), Math.max(this.container.clientHeight, scene.canvasH));
      this.refreshEdgeStates();
      this.syncZoomLabel();
      return {
        canvasW: scene.canvasW,
        canvasH: scene.canvasH,
        isAntv: true,
      };
    }

    refreshEdgeStates() {
      const htmlCards = this.container.querySelectorAll('.vt-antv-node-card');
      htmlCards.forEach((card) => {
        card.classList.toggle('selected', !!this.selectedNodeId && card.dataset.nodeId === this.selectedNodeId);
      });

      this.nodeCells.forEach((cell, id) => {
        const cellData = cell.getData() || {};
        const accent = cellData.accent || FALLBACK_ACCENT;
        const selected = !!this.selectedNodeId && id === this.selectedNodeId;
        if (cellData.usesHtmlMarkup) {
          return;
        }
        if (cell.isNode() && cell.shape !== 'circle') {
          cell.attr('body/strokeWidth', selected ? 2.6 : 1.2);
          cell.attr('body/fill', selected ? 'rgba(24, 31, 46, 0.98)' : 'rgba(18, 24, 38, 0.96)');
          cell.attr('body/stroke', accent);
        }
      });

      this.edgeCells.forEach((edge) => {
        const data = edge.getData() || {};
        const hovered = !!this.hoveredEdgeId && edge.id === this.hoveredEdgeId;
        const connected =
          !!this.selectedNodeId &&
          (data.source === this.selectedNodeId || data.target === this.selectedNodeId);
        const emphasized = hovered || connected;
        edge.attr('line/strokeWidth', hovered ? 2.8 : connected ? 2.3 : 1.15);
        edge.attr('line/stroke', emphasized ? (data.color || '#7aa2ff') : (data.color || BASE_EDGE_COLOR));
        edge.attr('wrap/cursor', data.detailText ? 'pointer' : 'default');
        edge.attr('line/cursor', data.detailText ? 'pointer' : 'default');

        const labelText = data.summaryText || '';
        const shouldShowLabel =
          (!!labelText && data.alwaysShowLabel) ||
          (!!labelText && hovered) ||
          (!!labelText && connected && data.showLabelOnSelect);
        const nextLabels = shouldShowLabel
          ? makeEdgeLabelConfig(labelText, data.color, data.labelDistance)
          : [];
        if (typeof edge.setLabels === 'function') {
          edge.setLabels(nextLabels);
        } else {
          edge.prop('labels', nextLabels);
        }
      });
    }

    highlightNode(nodeId) {
      this.selectedNodeId = nodeId || null;
      this.refreshEdgeStates();
    }

    showTooltip(text, point) {
      if (!text) return;
      this.tooltipEl.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
      this.tooltipEl.hidden = false;
      this.moveTooltip(point);
    }

    moveTooltip(point) {
      if (!point || this.tooltipEl.hidden) return;
      const rect = this.container.getBoundingClientRect();
      const maxLeft = Math.max(12, rect.width - this.tooltipEl.offsetWidth - 12);
      const maxTop = Math.max(12, rect.height - this.tooltipEl.offsetHeight - 12);
      const left = clamp(point.x - rect.left + 14, 12, maxLeft);
      const top = clamp(point.y - rect.top + 14, 12, maxTop);
      this.tooltipEl.style.left = `${Math.round(left)}px`;
      this.tooltipEl.style.top = `${Math.round(top)}px`;
    }

    hideTooltip() {
      this.tooltipEl.hidden = true;
    }

    fit() {
      try {
        this.graph.zoomToFit({
          padding: 24,
          maxScale: 1,
        });
      } catch (err) {
        console.error('AntvFlowGraph.fit failed:', err);
      }
      this.syncZoomLabel();
    }

    zoomBy(delta) {
      try {
        this.graph.zoom(delta);
      } catch (err) {
        const current = this.getScale();
        const next = clamp(current * (1 + delta), this.options.minScale, this.options.maxScale);
        if (typeof this.graph.zoomTo === 'function') {
          this.graph.zoomTo(next);
        }
      }
      this.syncZoomLabel();
    }

    show() {
      this.container.hidden = false;
      this.container.style.display = 'block';
    }

    hide() {
      this.container.hidden = true;
      this.container.style.display = 'none';
    }
  }

  global.AntvFlowGraph = AntvFlowGraph;
})(window);

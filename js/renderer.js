/**
 * renderer.js — Render nodes and edges onto the DOM + SVG
 */

// ── Op icons (inline SVG paths) ───────────────────────────────────────────
const OP_ICONS = {
  VIEW:     '<path d="M2 6h2M10 6h2M5 3l-1 3 1 3M9 3l1 3-1 3" stroke="white" stroke-width="1.2" stroke-linecap="round"/>',
  RESHAPE:  '<path d="M2 4h4v4H2zM8 8h4v4H8z" stroke="white" stroke-width="1.2" fill="none"/><path d="M6 6l2 2" stroke="white" stroke-width="1.2" stroke-linecap="round"/>',
  ASSEMBLE: '<path d="M6 2v10M2 6h8" stroke="white" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="6" r="1.5" fill="white"/>',
  MATMUL:   '<path d="M2 2h4v4H2zM8 2h4v4H8zM5 8l3 4M5 8l-3 4" stroke="white" stroke-width="1.2" fill="none" stroke-linecap="round"/>',
  ADD:      '<path d="M6 2v8M2 6h8" stroke="white" stroke-width="1.5" stroke-linecap="round"/>',
  MUL:      '<path d="M3 3l6 6M9 3L3 9" stroke="white" stroke-width="1.5" stroke-linecap="round"/>',
  DEFAULT:  '<circle cx="6" cy="6" r="3" stroke="white" stroke-width="1.2" fill="none"/><path d="M6 3v6M3 6h6" stroke="white" stroke-width="1" stroke-opacity="0.5" stroke-linecap="round"/>',
};

function opIcon(opcode) {
  const key = opcode?.toUpperCase();
  return OP_ICONS[key] || OP_ICONS.DEFAULT;
}

// ── Node card builders ────────────────────────────────────────────────────

function buildIncastCard(node) {
  const d = node.data;
  const uid = node.id;
  return `
    <div class="cast-header">
      <span class="cast-title">incast</span>
      <span class="node-tag node-tag-id">slot·${d.slotIdx}</span>
    </div>
    <div class="node-rows cast-rows">
      <div class="node-row">
        <span class="row-key">shape</span>
        <span class="row-val">${escHtml(shapeStr(d.shape))}</span>
      </div>
      <div class="node-row">
        <span class="row-key">rawshape</span>
        <span class="row-val row-val-dim">${escHtml(shapeStr(d.rawShape))}</span>
      </div>
      <div class="node-row">
        <span class="row-key">offset</span>
        <span class="row-val row-val-dim">${escHtml(shapeStr(d.offset))}</span>
      </div>
      <div class="node-row">
        <span class="row-key">asis</span>
        <span class="row-val row-val-dim">${d.format}</span>
      </div>
      <div class="node-row">
        <span class="row-key">dtype</span>
        <span class="row-val">${escHtml(d.dtype)}</span>
      </div>
    </div>
    <svg class="node-wave" viewBox="0 0 252 30" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M250.871 15.5C214.882 3 188.371 3 188.371 3C161.86 3 125.871 15.5 125.871 15.5C125.871 15.5 89.6591 26.5 63.3711 26.5C37.0831 26.5 0.871094 15.5 0.871094 15.5" fill="none" style="stroke: var(--node-accent, rgba(135,200,15,0.8))" stroke-width="3"/>
    </svg>`;
}

function buildOutcastCard(node) {
  const d = node.data;
  const uid = node.id;
  return `
    <div class="cast-header">
      <span class="cast-title">outcast</span>
      <span class="node-tag node-tag-id">slot·${d.slotIdx}</span>
    </div>
    <div class="node-rows cast-rows">
      <div class="node-row">
        <span class="row-key">shape</span>
        <span class="row-val">${escHtml(shapeStr(d.shape))}</span>
      </div>
      <div class="node-row">
        <span class="row-key">rawshape</span>
        <span class="row-val row-val-dim">${escHtml(shapeStr(d.rawShape))}</span>
      </div>
      <div class="node-row">
        <span class="row-key">offset</span>
        <span class="row-val row-val-dim">${escHtml(shapeStr(d.offset))}</span>
      </div>
      <div class="node-row">
        <span class="row-key">asis</span>
        <span class="row-val row-val-dim">${d.format}</span>
      </div>
      <div class="node-row">
        <span class="row-key">dtype</span>
        <span class="row-val">${escHtml(d.dtype)}</span>
      </div>
    </div>
    <svg class="node-wave" viewBox="0 0 252 30" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M250.871 15.5C214.882 3 188.371 3 188.371 3C161.86 3 125.871 15.5 125.871 15.5C125.871 15.5 89.6591 26.5 63.3711 26.5C37.0831 26.5 0.871094 15.5 0.871094 15.5" fill="none" style="stroke: var(--node-accent, rgba(201,16,125,0.8))" stroke-width="3"/>
    </svg>`;
}

function buildOpCard(node) {
  const d = node.data;
  const latLabel  = d.latency != null ? `${d.latency}` : '—';
  const sgLabel   = d.subgraphId != null ? `sg·${d.subgraphId}` : 'sg·—';
  const magLabel  = `#${d.magic}`;
  const shapeLabel = d.outShape ? shapeStr(d.outShape) : '—';
  const fromStr   = (d.ioperands || []).map(id => `T${id}`).join(', ') || '—';
  const toStr     = (d.ooperands || []).map(id => `T${id}`).join(', ') || '—';
  return `
    <div class="node-head">
      <span class="node-tag node-tag-id">${escHtml(sgLabel)}</span>
      <span class="node-tag node-tag-id">${escHtml(magLabel)}</span>
    </div>
    <div class="op-pill">
      <div class="op-pill-icon">
        <img src="assets/fx.svg" width="16" height="16" alt="">
      </div>
      <span class="op-pill-name">${escHtml(d.opcode)}</span>
      <span class="op-pill-latency">lat·${latLabel}</span>
    </div>
    <div class="node-rows">
      <div class="node-row">
        <span class="row-key">shape</span>
        <span class="row-val">${escHtml(shapeLabel)}</span>
      </div>
      <div class="node-row">
        <span class="row-key">from</span>
        <span class="row-val row-val-dim">${escHtml(fromStr)}</span>
      </div>
      <div class="node-row">
        <span class="row-key">to</span>
        <span class="row-val row-val-dim">${escHtml(toStr)}</span>
      </div>
    </div>`;
}

function buildTensorCard(node) {
  const d = node.data;
  return `
    <div class="node-head">
      <span class="node-tag node-tag-id">${escHtml(d.dtype)}</span>
      <span class="node-tag node-tag-id">#${d.magic}</span>
    </div>
    <div class="tensor-rect">
      <div class="tensor-rect-name">${escHtml(d.symbol)}</div>
      <div class="tensor-rect-shape">${escHtml(shapeStr(d.shape))}</div>
    </div>
    <div class="node-rows">
      <div class="node-row">
        <span class="row-key">rawshape</span>
        <span class="row-val row-val-dim">${escHtml(shapeStr(d.rawShape))}</span>
      </div>
      <div class="node-row">
        <span class="row-key">dtype</span>
        <span class="row-val">${escHtml(d.dtype)}</span>
      </div>
      <div class="node-row">
        <span class="row-key">asis</span>
        <span class="row-val row-val-dim">${d.format}</span>
      </div>
      <div class="node-row">
        <span class="row-key">offset</span>
        <span class="row-val row-val-dim">${escHtml(shapeStr(d.offset))}</span>
      </div>
    </div>`;
}

// ── Main render function ──────────────────────────────────────────────────

function renderGraph(graph, layout, nodesLayer, edgesSvg, onNodeClick, colorMap, colorMode) {
  const { nodes, edges } = graph;
  const { positions, canvasW, canvasH } = layout;

  // Clear previous
  nodesLayer.innerHTML = '';
  while (edgesSvg.children.length > 1) {
    edgesSvg.removeChild(edgesSvg.lastChild); // keep <defs>
  }

  edgesSvg.setAttribute('width', canvasW);
  edgesSvg.setAttribute('height', canvasH);

  // Build nodeMap for edge routing
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // ── Render edges (behind nodes) ────────────────────────────
  const edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  edgeGroup.setAttribute('class', 'edges-group');

  for (const edge of edges) {
    const sp = positions.get(edge.source);
    const tp = positions.get(edge.target);
    if (!sp || !tp) continue;

    const srcNode = nodeMap.get(edge.source);

    // Connection points: right side at y+60 → left side at y+60
    const CONN_Y = 60;
    const x1 = sp.x + sp.w;
    const y1 = sp.y + CONN_Y;
    const x2 = tp.x;
    const y2 = tp.y + CONN_Y;
    const dx = (x2 - x1) * 0.45;

    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('data-source', edge.source);
    path.setAttribute('data-target', edge.target);

    const edgeClass = edgeClassFor(srcNode?.type);
    path.setAttribute('class', `edge ${edgeClass}`);

    edgeGroup.appendChild(path);
  }
  edgesSvg.appendChild(edgeGroup);

  // ── Render nodes ───────────────────────────────────────────
  const fragment = document.createDocumentFragment();

  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;

    const el = document.createElement('div');
    el.className = `node-card node-card-${node.type}`;
    el.style.left   = pos.x + 'px';
    el.style.top    = pos.y + 'px';
    el.style.width  = pos.w + 'px';
    el.style.height = pos.h + 'px';
    el.dataset.nodeId = node.id;

    const color = colorMap?.get(node.id) ?? null;
    if (color) el.style.setProperty('--node-accent', color);

    // Set hover badge hint for non-Type color modes
    let colorHint = '';
    if (colorMode && colorMode !== 'none' && node.type === 'op') {
      if (colorMode === 'semantic') {
        colorHint = node.data.semanticLabel ||
          (OPCODE_CATEGORY[(node.data.opcode || '').toUpperCase()] || node.data.opcode || '');
      } else if (colorMode === 'latency' && node.data.latency != null) {
        colorHint = node.data.latency.toLocaleString() + ' cy';
      } else if (colorMode === 'subgraph' && node.data.subgraphId != null) {
        colorHint = 'SG·' + node.data.subgraphId;
      }
    }
    el.dataset.colorHint = colorHint;

    switch (node.type) {
      case 'incast':  el.innerHTML = buildIncastCard(node);  break;
      case 'outcast': el.innerHTML = buildOutcastCard(node); break;
      case 'op':      el.innerHTML = buildOpCard(node);      break;
      default:        el.innerHTML = buildTensorCard(node);  break;
    }

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onNodeClick(node, el);
    });

    fragment.appendChild(el);
  }
  nodesLayer.appendChild(fragment);
}

// ── Selection handling ────────────────────────────────────────────────────

function selectNode(nodeId, nodesLayer, edgesSvg) {
  // Clear previous selection
  nodesLayer.querySelectorAll('.node-card.selected').forEach(el => el.classList.remove('selected'));
  edgesSvg.querySelectorAll('.edge-highlight').forEach(el => el.classList.remove('edge-highlight'));

  if (!nodeId) return;

  // Highlight node
  const nodeEl = nodesLayer.querySelector(`[data-node-id="${nodeId}"]`);
  if (nodeEl) nodeEl.classList.add('selected');

  // Highlight connected edges
  edgesSvg.querySelectorAll(`[data-source="${nodeId}"], [data-target="${nodeId}"]`)
    .forEach(el => el.classList.add('edge-highlight'));
}

// ── Detail panel content ──────────────────────────────────────────────────

function buildDetailContent(node, graph) {
  const { nodes, edges } = graph;
  const d = node.data;

  const incoming = edges.filter(e => e.target === node.id).map(e => e.source);
  const outgoing = edges.filter(e => e.source === node.id).map(e => e.target);

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  let html = '';

  if (node.type === 'op') {
    html += detailSection('Operation', [
      ...(d.semanticLabel ? [['semantic', d.semanticLabel]] : []),
      ['opcode',    d.opcode],
      ['magic',     `#${d.magic}`],
      ['kind',      d.kind],
      ['latency',   d.latency ?? '—'],
      ['subgraph',  d.subgraphId ?? '—'],
    ]);
    const attrs = Object.entries(d.opAttr || {});
    if (attrs.length) {
      html += detailSection('Attributes', attrs.map(([k, v]) => [k, String(v)]));
    }
  } else {
    html += detailSection('Tensor', [
      ...(d.semanticLabel ? [['semantic', d.semanticLabel]] : []),
      ['symbol', d.symbol],
      ['magic',  `#${d.magic}`],
      ['shape',  shapeStr(d.shape)],
      ['dtype',  d.dtype],
      ['kind',   d.kind],
      ['mem_id', d.memId !== -1 ? d.memId : '—'],
    ]);
    if (d.rawConnections?.length) {
      html += detailSection('Raw Connections', [
        ['raw IDs', d.rawConnections.join(', ')],
      ]);
    }
  }

  // Connected nodes
  if (incoming.length) {
    html += `<div class="detail-section">
      <div class="detail-section-title">Inputs (${incoming.length})</div>
      <div class="detail-connections">
        ${incoming.map(id => {
          const n = nodeMap.get(id);
          return `<span class="detail-conn-chip" data-nav="${id}">${n?.label || id}</span>`;
        }).join('')}
      </div>
    </div>`;
  }
  if (outgoing.length) {
    html += `<div class="detail-section">
      <div class="detail-section-title">Outputs (${outgoing.length})</div>
      <div class="detail-connections">
        ${outgoing.map(id => {
          const n = nodeMap.get(id);
          return `<span class="detail-conn-chip" data-nav="${id}">${n?.label || id}</span>`;
        }).join('')}
      </div>
    </div>`;
  }

  return html;
}

function detailSection(title, rows) {
  return `<div class="detail-section">
    <div class="detail-section-title">${escHtml(title)}</div>
    ${rows.map(([k, v]) => `
      <div class="detail-row">
        <span class="detail-row-key">${escHtml(String(k))}</span>
        <span class="detail-row-val">${escHtml(String(v ?? '—'))}</span>
      </div>`).join('')}
  </div>`;
}

// ── Utilities ─────────────────────────────────────────────────────────────

function shapeStr(shape) {
  if (!shape || shape.length === 0) return '[]';
  return '[' + shape.join(', ') + ']';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function edgeClassFor(nodeType) {
  switch (nodeType) {
    case 'incast':  return 'edge-incast';
    case 'op':      return 'edge-op';
    case 'outcast': return 'edge-outcast';
    default:        return 'edge-default';
  }
}

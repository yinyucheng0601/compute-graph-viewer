/**
 * renderer.js — Render nodes and edges onto the DOM + SVG
 */

// ── Op icons (inline SVG paths) ───────────────────────────────────────────
const OP_ICONS = {
  VIEW: '<path d="M2 6h2M10 6h2M5 3l-1 3 1 3M9 3l1 3-1 3" stroke="white" stroke-width="1.2" stroke-linecap="round"/>',
  RESHAPE: '<path d="M2 4h4v4H2zM8 8h4v4H8z" stroke="white" stroke-width="1.2" fill="none"/><path d="M6 6l2 2" stroke="white" stroke-width="1.2" stroke-linecap="round"/>',
  ASSEMBLE: '<path d="M6 2v10M2 6h8" stroke="white" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="6" r="1.5" fill="white"/>',
  MATMUL: '<path d="M2 2h4v4H2zM8 2h4v4H8zM5 8l3 4M5 8l-3 4" stroke="white" stroke-width="1.2" fill="none" stroke-linecap="round"/>',
  ADD: '<path d="M6 2v8M2 6h8" stroke="white" stroke-width="1.5" stroke-linecap="round"/>',
  MUL: '<path d="M3 3l6 6M9 3L3 9" stroke="white" stroke-width="1.5" stroke-linecap="round"/>',
  DEFAULT: '<circle cx="6" cy="6" r="3" stroke="white" stroke-width="1.2" fill="none"/><path d="M6 3v6M3 6h6" stroke="white" stroke-width="1" stroke-opacity="0.5" stroke-linecap="round"/>',
};

function opIcon(opcode) {
  const key = opcode?.toUpperCase();
  return OP_ICONS[key] || OP_ICONS.DEFAULT;
}

function semanticDisplayLabelFromData(d) {
  if (!d) return '';
  return d.semanticLabel || d.inferredSemanticLabel || '';
}

function assetUrl(path) {
  if (typeof window === 'undefined') return path;
  const prefix = typeof window.PTO_ASSET_PREFIX === 'string'
    ? window.PTO_ASSET_PREFIX
    : (typeof window.PTO_BASE_PREFIX === 'string' ? window.PTO_BASE_PREFIX : '');
  return prefix + path;
}

function stageLabel(d) {
  return semanticDisplayLabelFromData(d) || d.opcode;
}

const GROUP_ACCENT_BY_TYPE = {
  incast: '#87C80F',
  outcast: '#C9107D',
  op: '#3577F6',
  tensor: '#A855F7',
  group: '#3577F6',
};

function groupFallbackAccent(nodeType, groupType) {
  if (groupType === 'tile' || groupType === 'op') return GROUP_ACCENT_BY_TYPE.op;
  if (groupType === 'tensor') return GROUP_ACCENT_BY_TYPE.tensor;
  return GROUP_ACCENT_BY_TYPE[nodeType] || GROUP_ACCENT_BY_TYPE.tensor;
}

function isOpLikeMemberType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'op' || t === 'operation' || t === 'tile' || t === 'cube' || t === 'vector';
}

function normalizeGroupMemberType(rawType, groupType) {
  if (isOpLikeMemberType(rawType)) return 'op';
  const t = String(rawType || '').toLowerCase();
  if (t === 'tensor' || t === 'incast' || t === 'outcast') return 'tensor';
  return groupType === 'tile' || groupType === 'op' ? 'op' : 'tensor';
}

function normalizeGroupMemberRef(rawRef, groupType) {
  if (typeof rawRef === 'string') return { nodeId: rawRef };
  if (typeof rawRef === 'number') {
    const prefix = groupType === 'tile' || groupType === 'op' ? 'op_' : 't_';
    return { nodeId: `${prefix}${rawRef}` };
  }
  if (!rawRef || typeof rawRef !== 'object') return null;
  return {
    nodeId: rawRef.nodeId || rawRef.id || rawRef.node_id || null,
    type: rawRef.type || null,
    color: rawRef.color || null,
    label: rawRef.label || rawRef.name || null,
    semanticKey: rawRef.semanticKey || null,
    semanticLabel: rawRef.semanticLabel || rawRef.inferredSemanticLabel || null,
    subgraphId: rawRef.subgraphId ?? null,
    latency: rawRef.latency ?? null,
    engineMemoryKey: rawRef.engineMemoryKey || null,
  };
}

function buildGroupMemberBars(node, graphNodeMap, colorMap) {
  const d = node.data || {};
  const groupType = (d.groupType || 'tensor').toLowerCase();
  const refs = Array.isArray(d.members) ? d.members : [];
  const members = refs
    .map(ref => normalizeGroupMemberRef(ref, groupType))
    .filter(Boolean)
    .map((ref, idx) => {
      const base = ref.nodeId ? graphNodeMap.get(ref.nodeId) : null;
      const resolvedType = normalizeGroupMemberType(ref.type || base?.type, groupType);
      const color = ref.color
        || (ref.nodeId ? colorMap?.get(ref.nodeId) : null)
        || groupFallbackAccent(resolvedType, groupType);
      return {
        nodeId: ref.nodeId || base?.id || null,
        type: resolvedType,
        color,
        label: ref.label || base?.label || `member-${idx + 1}`,
      };
    });

  // Fallback: no explicit members, still render count slots so grouped cards remain readable.
  if (members.length === 0) {
    const count = Number(d.count) || 0;
    const slotCount = count > 7 ? 8 : Math.min(count, 7);
    const fallbackType = normalizeGroupMemberType(groupType, groupType);
    for (let i = 0; i < slotCount; i++) {
      members.push({
        nodeId: null,
        type: fallbackType,
        color: groupFallbackAccent(fallbackType, groupType),
        label: `member-${i + 1}`,
      });
    }
  }

  if (members.length <= 7) {
    return members.map(m => ({ kind: 'bar', ...m }));
  }

  // >7: force the 4th capsule to ellipsis.
  const head = members.slice(0, 3).map(m => ({ kind: 'bar', ...m }));
  const tail = members.slice(-3).map(m => ({ kind: 'bar', ...m }));
  return [...head, { kind: 'ellipsis' }, ...tail];
}

function buildGroupRows(node) {
  const d = node.data || {};
  const rows = [];

  const shapeVal = Array.isArray(d.shape) ? shapeStr(d.shape) : (d.shape ? String(d.shape) : '');
  if (shapeVal) rows.push(['shape', shapeVal]);

  if (d.memFlow) {
    rows.push(['mem', String(d.memFlow)]);
  } else if (d.memFrom || d.memTo) {
    rows.push(['mem', `${d.memFrom || '—'} -> ${d.memTo || '—'}`]);
  }

  if (Array.isArray(d.rows)) {
    d.rows.forEach(row => {
      if (Array.isArray(row) && row.length >= 2) {
        rows.push([String(row[0]), String(row[1])]);
      } else if (row && typeof row === 'object') {
        rows.push([String(row.key || row.k || 'meta'), String(row.value || row.v || '—')]);
      }
    });
  }
  return rows;
}

function buildGroupShellPath(cardW, cardH) {
  const w = Math.max(120, Number(cardW) || 194);
  const h = Math.max(120, Number(cardH) || 239);
  const sx = w / 194;
  const fx = (n) => (n * sx).toFixed(3);
  const fy = (n) => (Math.max(0, n)).toFixed(3);

  const r = 8;
  const yTopShoulder = 11.969;
  const yTopRight = 19.969;
  const xRight = w;
  const yBottom = h;

  return [
    `M 0 ${fy(8)}`,
    `C 0 ${fy(3.5817)} ${fx(3.5817)} 0 ${fx(8)} 0`,
    `H ${fx(53.8697)}`,
    `C ${fx(55.9552)} 0 ${fx(57.9582)} ${fy(0.8144)} ${fx(59.4520)} ${fy(2.2696)}`,
    `L ${fx(67.0791)} ${fy(9.6995)}`,
    `C ${fx(68.5729)} ${fy(11.1547)} ${fx(70.5759)} ${fy(yTopShoulder)} ${fx(72.6614)} ${fy(yTopShoulder)}`,
    `H ${(xRight - r).toFixed(3)}`,
    `C ${(xRight - 3.5817).toFixed(3)} ${fy(yTopShoulder)} ${xRight.toFixed(3)} ${fy(15.5508)} ${xRight.toFixed(3)} ${fy(yTopRight)}`,
    `V ${(yBottom - r).toFixed(3)}`,
    `C ${xRight.toFixed(3)} ${(yBottom - 3.5817).toFixed(3)} ${(xRight - 3.5817).toFixed(3)} ${yBottom.toFixed(3)} ${(xRight - r).toFixed(3)} ${yBottom.toFixed(3)}`,
    `H ${fx(8)}`,
    `C ${fx(3.5817)} ${yBottom.toFixed(3)} 0 ${(yBottom - 3.5817).toFixed(3)} 0 ${(yBottom - r).toFixed(3)}`,
    `V ${fy(8)}`,
    'Z',
  ].join(' ');
}

function buildGroupCard(node, graphNodeMap, colorMap, cardW, cardH) {
  const d = node.data || {};
  const groupType = (d.groupType || 'tensor').toLowerCase();
  const title = d.title || d.name || node.label || 'Group';
  const bars = buildGroupMemberBars(node, graphNodeMap, colorMap);
  const count = Number(d.count) || (Array.isArray(d.members) ? d.members.length : bars.length);
  const rows = buildGroupRows(node);
  const hasRows = rows.length > 0;
  const shellPath = buildGroupShellPath(cardW, cardH);

  return `
    <div class="group-shell" aria-hidden="true">
      <svg class="group-shell-svg" viewBox="0 0 ${Math.max(120, Number(cardW) || 194)} ${Math.max(120, Number(cardH) || 239)}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path class="group-shell-fill" d="${escHtml(shellPath)}"/>
      </svg>
    </div>
    <div class="group-content">
      <div class="group-head">
        <span class="group-title op-pill-name">${escHtml(title)}</span>
        <span class="group-count">${count}</span>
      </div>
      ${hasRows ? `<div class="node-rows group-rows">
        ${rows.map(([k, v]) => `
          <div class="node-row">
            <span class="row-key">${escHtml(k)}</span>
            <span class="row-val">${escHtml(v)}</span>
          </div>`).join('')}
      </div>` : ''}
      <div class="group-stack" data-group-type="${escHtml(groupType)}">
        ${bars.map(item => {
    if (item.kind === 'ellipsis') {
      return `<div class="group-stack-item is-ellipsis">...</div>`;
    }
    const stripType = item.type === 'op' ? 'is-op' : 'is-tensor';
    const clickable = !!item.nodeId;
    const attrs = clickable
      ? ` data-member-node-id="${escHtml(item.nodeId)}" data-member-label="${escHtml(item.label || '')}" title="${escHtml(item.label || item.nodeId)}"`
      : '';
    const clickClass = clickable ? ' is-member-clickable' : '';
    return `<div class="group-stack-item ${stripType}${clickClass}"${attrs} style="--group-item-color:${escHtml(item.color)}"></div>`;
  }).join('')}
      </div>
    </div>`;
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
  const latLabel = d.latency != null ? `${d.latency}` : '—';
  const sgLabel = d.subgraphId != null ? `sg·${d.subgraphId}` : 'sg·—';
  const magLabel = `#${d.magic}`;
  const shapeLabel = d.outShape ? shapeStr(d.outShape) : '—';
  const fromStr = (d.ioperands || []).map(id => `T${id}`).join(', ') || '—';
  const toStr = (d.ooperands || []).map(id => `T${id}`).join(', ') || '—';
  return `
    <div class="node-head">
      <span class="node-tag node-tag-id">${escHtml(sgLabel)}</span>
      <span class="node-tag node-tag-id">${escHtml(magLabel)}</span>
    </div>
    <div class="op-pill">
      <div class="op-pill-icon">
        <img src="${escHtml(assetUrl('assets/fx.svg'))}" width="16" height="16" alt="">
      </div>
      <span class="op-pill-name">${escHtml(stageLabel(d))}</span>
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

// ── Compact card builders ─────────────────────────────────────────────────

function buildCompactOpCard(node) {
  const d = node.data;
  const latLabel = d.latency != null ? `lat·${d.latency}` : '';
  return `
    <div class="op-pill">
      <div class="op-pill-icon">
        <img src="${escHtml(assetUrl('assets/fx.svg'))}" width="14" height="14" alt="">
      </div>
      <span class="op-pill-name">${escHtml(stageLabel(d))}</span>
      ${latLabel ? `<span class="op-pill-latency">${escHtml(latLabel)}</span>` : ''}
    </div>`;
}

function buildCompactTensorCard(node) {
  const d = node.data;
  return `
    <div class="tensor-rect">
      <div class="tensor-rect-name">${escHtml(d.symbol)}</div>
      <div class="tensor-rect-shape">${escHtml(shapeStr(d.shape))}</div>
    </div>`;
}

function buildCompactCastCard(node) {
  const d = node.data;
  const name = d.name || d.symbol || (node.type === 'incast' ? 'in' : 'out');
  return `
    <div class="tensor-rect">
      <div class="tensor-rect-name">${escHtml(name)}</div>
      <div class="tensor-rect-shape">${escHtml(shapeStr(d.shape))}</div>
    </div>`;
}

function buildCompactGroupCard(node) {
  const d = node.data || {};
  const title = d.title || node.label || 'Group';
  const count = Number(d.count) || (Array.isArray(d.members) ? d.members.length : 0);
  return `
    <div class="tensor-rect">
      <div class="tensor-rect-name">${escHtml(title)}</div>
      <div class="tensor-rect-shape">count · ${count}</div>
    </div>`;
}

// ── Main render function ──────────────────────────────────────────────────

function renderGraph(graph, layout, nodesLayer, edgesSvg, onNodeClick, colorMap, colorMode, options = {}) {
  const compact = !!options.compact;
  const TB = options.direction === 'TB';
  const delegateEvents = !!options.delegateEvents;
  const onGroupMemberClick = typeof options.onGroupMemberClick === 'function'
    ? options.onGroupMemberClick
    : null;
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
  const edgeElementsByNodeId = new Map();

  // ── Render edges (behind nodes) ────────────────────────────
  const edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  edgeGroup.setAttribute('class', 'edges-group');

  const onTensorLabelClick = typeof options.onTensorLabelClick === 'function' ? options.onTensorLabelClick : null;

  for (const edge of edges) {
    const sp = positions.get(edge.source);
    const tp = positions.get(edge.target);
    if (!sp || !tp) continue;

    const srcNode = nodeMap.get(edge.source);

    let d, midX, midY;
    if (TB) {
      // TB: bottom-center → elbow → top-center
      const x1 = sp.x + sp.w / 2;
      const y1 = sp.y + sp.h;
      const x2 = tp.x + tp.w / 2;
      const y2 = tp.y;
      const mY = (y1 + y2) / 2;

      if (Math.abs(x1 - x2) < 5) {
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
        midX = x1;
        midY = mY;
      } else {
        d = `M ${x1} ${y1} L ${x1} ${mY} L ${x2} ${mY} L ${x2} ${y2}`;
        midX = (x1 + x2) / 2;
        midY = mY;
      }
    } else {
      // LR: right-midpoint → bezier → left-midpoint
      const CONN_Y = compact ? 22 : 60;
      const x1 = sp.x + sp.w;
      const y1 = sp.y + CONN_Y;
      const x2 = tp.x;
      const y2 = tp.y + CONN_Y;
      const dx = (x2 - x1) * (compact ? 0.35 : 0.45);
      d = `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
      midX = (x1 + x2) / 2;
      midY = (y1 + y2) / 2;
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('data-source', edge.source);
    path.setAttribute('data-target', edge.target);

    const edgeClass = edgeClassFor(srcNode);
    path.setAttribute('class', `edge ${edgeClass}`);

    edgeGroup.appendChild(path);

    if (edge.tensorLabels && edge.tensorLabels.length > 0) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'edge-tensor-label-group');

      let currentBoxY = midY;
      const items = edge.tensorLabels;
      const ITEM_H = 16;
      const TOTAL_H = items.length * ITEM_H;
      let startY = midY - TOTAL_H / 2;

      items.forEach((tl, idx) => {
        const displayText = tl.name + (tl.shape ? ' ' + tl.shape : '');
        const approxW = Math.max(50, displayText.length * 6 + 10);
        const ty = startY + idx * ITEM_H + ITEM_H / 2;

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', midX - approxW / 2);
        bg.setAttribute('y', startY + idx * ITEM_H);
        bg.setAttribute('width', approxW);
        bg.setAttribute('height', ITEM_H - 2);
        bg.setAttribute('class', 'edge-tensor-label-bg');

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', midX);
        txt.setAttribute('y', ty);
        txt.setAttribute('class', 'edge-tensor-label-text');
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('dominant-baseline', 'middle');
        txt.textContent = displayText;

        if (onTensorLabelClick) {
          bg.style.cursor = 'pointer';
          bg.addEventListener('click', (ev) => {
            ev.stopPropagation();
            onTensorLabelClick(tl);
          });
        }

        g.appendChild(bg);
        g.appendChild(txt);
      });
      edgeGroup.appendChild(g);
    }

    if (!edgeElementsByNodeId.has(edge.source)) edgeElementsByNodeId.set(edge.source, []);
    if (!edgeElementsByNodeId.has(edge.target)) edgeElementsByNodeId.set(edge.target, []);
    edgeElementsByNodeId.get(edge.source).push(path);
    edgeElementsByNodeId.get(edge.target).push(path);
  }
  edgesSvg.appendChild(edgeGroup);

  // ── Render nodes ───────────────────────────────────────────
  const fragment = document.createDocumentFragment();

  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;

    const el = document.createElement('div');
    el.className = `node-card node-card-${node.type}`;
    if (node.type === 'group') {
      const gt = String(node.data?.groupType || 'tensor').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      el.classList.add('node-card-group', `node-card-group-${gt}`);
    }
    const pxX = node.type === 'group' ? Math.round(pos.x) : pos.x;
    const pxY = node.type === 'group' ? Math.round(pos.y) : pos.y;
    const pxW = node.type === 'group' ? Math.round(pos.w) : pos.w;
    const pxH = node.type === 'group' ? Math.round(pos.h) : pos.h;
    el.style.left = pxX + 'px';
    el.style.top = pxY + 'px';
    el.style.width = pxW + 'px';
    el.style.height = pxH + 'px';
    el.dataset.nodeId = node.id;
    if (compact) el.dataset.compact = '';

    const color = colorMap?.get(node.id) ?? null;
    if (color) el.style.setProperty('--node-accent', color);

    // Set hover badge hint for non-Type color modes
    let colorHint = '';
    if (colorMode && colorMode !== 'none') {
      if (colorMode === 'semantic') {
        if (node.type === 'op') {
          colorHint = semanticDisplayLabelFromData(node.data) ||
            (OPCODE_CATEGORY[(node.data.opcode || '').toUpperCase()] || node.data.opcode || '');
        } else if (node.type === 'group') {
          colorHint = node.data.semanticLabel || '';
        }
      } else if (colorMode === 'latency') {
        if (node.type === 'op' && node.data.latency != null) {
          colorHint = node.data.latency.toLocaleString() + ' cy';
        } else if (node.type === 'group' && node.data.latency != null) {
          colorHint = 'avg ' + node.data.latency.toLocaleString() + ' cy';
        }
      } else if (colorMode === 'subgraph') {
        if (node.type === 'op' && node.data.subgraphId != null) {
          colorHint = 'SG·' + node.data.subgraphId;
        } else if (node.type === 'group' && node.data.subgraphId != null) {
          colorHint = 'SG·' + node.data.subgraphId;
        }
      } else if (colorMode === 'engineMemory') {
        if (typeof getEngineMemoryHint === 'function') {
          colorHint = node.type === 'group'
            ? (node.data.engineMemoryHint || '')
            : getEngineMemoryHint(node);
        } else if (node.type === 'op') {
          const isCube = !!node.data?.opAttr?.IS_CUBE || String(node.data?.opcode || '').toUpperCase() === 'A_MUL_B';
          colorHint = isCube ? 'Cube Engine' : 'Vector Engine';
        } else if (node.type === 'group') {
          colorHint = node.data.engineMemoryHint || '';
        } else {
          const memType = node.data?.memType || null;
          const tobe = memType?.tobe;
          colorHint = tobe != null ? `Mem ${tobe}` : 'Memory';
        }
      }
    }
    el.dataset.colorHint = colorHint;

    if (compact) {
      switch (node.type) {
        case 'incast':
        case 'outcast': el.innerHTML = buildCompactCastCard(node); break;
        case 'op': el.innerHTML = buildCompactOpCard(node); break;
        case 'group': el.innerHTML = buildCompactGroupCard(node); break;
        default: el.innerHTML = buildCompactTensorCard(node); break;
      }
    } else {
      switch (node.type) {
        case 'incast': el.innerHTML = buildIncastCard(node); break;
        case 'outcast': el.innerHTML = buildOutcastCard(node); break;
        case 'op': el.innerHTML = buildOpCard(node); break;
        case 'group': el.innerHTML = buildGroupCard(node, nodeMap, colorMap, pos.w, pos.h); break;
        default: el.innerHTML = buildTensorCard(node); break;
      }
    }

    if (!delegateEvents && node.type === 'group' && onGroupMemberClick) {
      el.querySelectorAll('.group-stack-item[data-member-node-id]').forEach(memberEl => {
        memberEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const memberNodeId = memberEl.dataset.memberNodeId;
          if (!memberNodeId) return;
          onGroupMemberClick(node, memberNodeId, memberEl.dataset.memberLabel || '');
        });
      });
    }

    if (!delegateEvents) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onNodeClick(node, el);
      });
    }

    fragment.appendChild(el);
  }
  nodesLayer.appendChild(fragment);
  return { edgeElementsByNodeId };
}

// ── Selection handling ────────────────────────────────────────────────────

function selectNode(nodeId, nodesLayer, edgesSvg, edgeElementsByNodeId) {
  // Clear previous selection
  nodesLayer.querySelectorAll('.node-card.selected').forEach(el => el.classList.remove('selected'));
  edgesSvg.querySelectorAll('.edge-highlight').forEach(el => el.classList.remove('edge-highlight'));

  if (!nodeId) return;

  // Highlight node
  const nodeEl = nodesLayer.querySelector(`[data-node-id="${nodeId}"]`);
  if (nodeEl) nodeEl.classList.add('selected');

  // Highlight connected edges
  if (edgeElementsByNodeId?.has(nodeId)) {
    edgeElementsByNodeId.get(nodeId).forEach(el => el.classList.add('edge-highlight'));
    return;
  }

  edgesSvg.querySelectorAll(`[data-source="${nodeId}"], [data-target="${nodeId}"]`)
    .forEach(el => el.classList.add('edge-highlight'));
}

// ── Detail panel content ──────────────────────────────────────────────────

function buildDetailContent(node, graph, detailIndex) {
  const { nodes, edges } = graph;
  const d = node.data;

  const incoming = detailIndex?.incomingByTarget?.get(node.id)
    || edges.filter(e => e.target === node.id).map(e => e.source);
  const outgoing = detailIndex?.outgoingBySource?.get(node.id)
    || edges.filter(e => e.source === node.id).map(e => e.target);

  const nodeMap = detailIndex?.nodeById || new Map(nodes.map(n => [n.id, n]));

  let html = '';

  if (node.type === 'op') {
    html += detailSection('Operation', [
      ...((semanticDisplayLabelFromData(d)) ? [['semantic', semanticDisplayLabelFromData(d)]] : []),
      ['opcode', d.opcode],
      ['magic', `#${d.magic}`],
      ['kind', d.kind],
      ['latency', d.latency ?? '—'],
      ['subgraph', d.subgraphId ?? '—'],
    ]);
    const attrs = Object.entries(d.opAttr || {});
    if (attrs.length) {
      html += detailSection('Attributes', attrs.map(([k, v]) => [k, String(v)]));
    }
  } else if (node.type === 'group') {
    const shapeVal = Array.isArray(d.shape) ? shapeStr(d.shape) : (d.shape ?? '—');
    const memVal = d.memFlow || ((d.memFrom || d.memTo) ? `${d.memFrom || '—'} -> ${d.memTo || '—'}` : '—');
    const memberCount = Number(d.count) || (Array.isArray(d.members) ? d.members.length : 0);
    html += detailSection('Group', [
      ['title', d.title || node.label || 'Group'],
      ['group_type', d.groupType || 'tensor'],
      ['members', memberCount],
      ...(d.semanticLabel ? [['semantic', d.semanticLabel]] : []),
      ...(d.groupReason ? [['reason', d.groupReason]] : []),
      ...(d.subgraphId != null ? [['subgraph', d.subgraphId]] : []),
      ...(d.latency != null ? [['latency_avg', d.latency]] : []),
      ...(d.engineMemoryHint ? [['engine_or_mem', d.engineMemoryHint]] : []),
      ['shape', shapeVal],
      ['mem', memVal],
    ]);
  } else {
    html += detailSection('Tensor', [
      ...(d.semanticLabel ? [['semantic', d.semanticLabel]] : []),
      ['symbol', d.symbol],
      ['magic', `#${d.magic}`],
      ['shape', shapeStr(d.shape)],
      ['dtype', d.dtype],
      ['kind', d.kind],
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

function edgeClassFor(node) {
  const nodeType = node?.type;
  switch (nodeType) {
    case 'incast': return 'edge-incast';
    case 'op': return 'edge-op';
    case 'outcast': return 'edge-outcast';
    case 'group': {
      const gt = String(node?.data?.groupType || '').toLowerCase();
      return gt === 'tile' || gt === 'op' ? 'edge-op' : 'edge-default';
    }
    default: return 'edge-default';
  }
}

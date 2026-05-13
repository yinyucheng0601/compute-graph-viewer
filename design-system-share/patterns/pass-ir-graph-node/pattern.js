(function registerPtoPassIrGraphNodePattern(global) {
  'use strict';

  const DEFAULT_ACCENTS = {
    incast: '#87C80F',
    outcast: '#FF4B7B',
    op: '#3577F6',
    tensor: '#7C8DB8',
    groupOp: '#3577F6',
    groupTensor: '#7C8DB8',
  };

  const DEFAULT_FRAMES = {
    incast: { width: 225, minHeight: 208 },
    outcast: { width: 225, minHeight: 208 },
    op: { width: 225, minHeight: 156 },
    tensor: { width: 225, minHeight: 208 },
    group: { width: 194, minHeight: 200 },
  };

  const COMPACT_FRAMES = {
    incast: { width: 225, minHeight: 98 },
    outcast: { width: 225, minHeight: 98 },
    op: { width: 225, minHeight: 72 },
    tensor: { width: 225, minHeight: 98 },
    group: { width: 194, minHeight: 148 },
  };

  function assetUrl(path) {
    const prefix = typeof global.PTO_PASS_IR_GRAPH_NODE_ASSET_PREFIX === 'string'
      ? global.PTO_PASS_IR_GRAPH_NODE_ASSET_PREFIX
      : '../../';
    return prefix + path;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function shapeStr(shape) {
    if (!Array.isArray(shape) || shape.length === 0) return '[]';
    return '[' + shape.join(', ') + ']';
  }

  function semanticDisplayLabelFromData(data) {
    if (!data) return '';
    return data.semanticLabel || data.inferredSemanticLabel || '';
  }

  function stageLabel(data) {
    return semanticDisplayLabelFromData(data) || data.opcode || 'Operation';
  }

  function resolveFrame(node, compact) {
    const base = compact ? COMPACT_FRAMES[node.type] : DEFAULT_FRAMES[node.type];
    const custom = node.frame || {};
    const estimatedGroupHeight = node.type === 'group' && custom.height == null
      ? estimateGroupHeight(node, compact)
      : null;
    return {
      width: custom.width != null ? custom.width : base.width,
      height: custom.height != null ? custom.height : (estimatedGroupHeight ?? base.height),
      minHeight: custom.minHeight != null ? custom.minHeight : base.minHeight,
    };
  }

  function normalizeGroupMemberType(rawType, groupType) {
    const type = String(rawType || '').toLowerCase();
    if (type === 'op' || type === 'operation' || type === 'tile' || type === 'cube' || type === 'vector') return 'op';
    if (type === 'tensor' || type === 'incast' || type === 'outcast') return 'tensor';
    return groupType === 'tile' || groupType === 'op' ? 'op' : 'tensor';
  }

  function groupFallbackAccent(memberType) {
    return memberType === 'op' ? DEFAULT_ACCENTS.groupOp : DEFAULT_ACCENTS.groupTensor;
  }

  function buildGroupMemberBars(node) {
    const data = node.data || {};
    const groupType = String(data.groupType || 'tensor').toLowerCase();
    const members = Array.isArray(data.members) ? data.members : [];
    const normalized = members.map((member, index) => {
      const resolvedType = normalizeGroupMemberType(member.type, groupType);
      return {
        kind: 'bar',
        nodeId: member.nodeId || member.id || null,
        type: resolvedType,
        color: member.color || groupFallbackAccent(resolvedType),
        label: member.label || `member-${index + 1}`,
      };
    });

    if (normalized.length === 0) {
      const fallbackCount = Math.max(2, Math.min(Number(data.count) || 4, 7));
      for (let index = 0; index < fallbackCount; index += 1) {
        const resolvedType = normalizeGroupMemberType(groupType, groupType);
        normalized.push({
          kind: 'bar',
          nodeId: null,
          type: resolvedType,
          color: groupFallbackAccent(resolvedType),
          label: `member-${index + 1}`,
        });
      }
    }

    if (normalized.length <= 7) return normalized;
    return [
      normalized[0],
      normalized[1],
      normalized[2],
      { kind: 'ellipsis' },
      normalized[normalized.length - 3],
      normalized[normalized.length - 2],
      normalized[normalized.length - 1],
    ];
  }

  function buildGroupRows(node) {
    const data = node.data || {};
    const rows = [];
    const shapeValue = Array.isArray(data.shape) ? shapeStr(data.shape) : (data.shape ? String(data.shape) : '');
    if (shapeValue) rows.push(['shape', shapeValue]);

    if (data.memFlow) {
      rows.push(['mem', String(data.memFlow)]);
    } else if (data.memFrom || data.memTo) {
      rows.push(['mem', `${data.memFrom || '—'} -> ${data.memTo || '—'}`]);
    }

    if (Array.isArray(data.rows)) {
      data.rows.forEach((row) => {
        if (Array.isArray(row) && row.length >= 2) {
          rows.push([String(row[0]), String(row[1])]);
          return;
        }
        if (row && typeof row === 'object') {
          rows.push([String(row.key || row.k || 'meta'), String(row.value || row.v || '—')]);
        }
      });
    }

    return rows;
  }

  function estimateGroupHeight(node, compact) {
    const rows = compact ? 0 : buildGroupRows(node).length;
    const stackCount = buildGroupMemberBars(node).length;
    const headBlock = 48;
    const rowBlock = rows > 0
      ? 8 + (rows * 16) + (Math.max(0, rows - 1) * 3)
      : 0;
    // Match Pass-IR layout's deliberately conservative group estimate so the
    // generated shell always contains rows and stack bars.
    const stackBlock = 6 + (stackCount * 12) + (Math.max(0, stackCount - 1) * 4);
    const bottomReserve = 18;
    const estimated = headBlock + rowBlock + stackBlock + bottomReserve;
    const minHeight = compact ? COMPACT_FRAMES.group.minHeight : DEFAULT_FRAMES.group.minHeight;
    const maxHeight = compact ? 240 : 340;
    return Math.max(minHeight, Math.min(maxHeight, Math.ceil(estimated)));
  }

  function buildGroupShellPath(cardWidth, cardHeight) {
    const width = Math.max(120, Number(cardWidth) || 194);
    const height = Math.max(120, Number(cardHeight) || 239);
    const sx = width / 194;
    const fx = (value) => (value * sx).toFixed(3);
    const fy = (value) => value.toFixed(3);
    const radius = 8;
    const shoulderY = 11.969;
    const topRightY = 19.969;

    return [
      `M 0 ${fy(8)}`,
      `C 0 ${fy(3.582)} ${fx(3.582)} 0 ${fx(8)} 0`,
      `H ${fx(53.87)}`,
      `C ${fx(55.955)} 0 ${fx(57.958)} ${fy(0.814)} ${fx(59.452)} ${fy(2.27)}`,
      `L ${fx(67.079)} ${fy(9.7)}`,
      `C ${fx(68.573)} ${fy(11.155)} ${fx(70.576)} ${fy(shoulderY)} ${fx(72.661)} ${fy(shoulderY)}`,
      `H ${(width - radius).toFixed(3)}`,
      `C ${(width - 3.582).toFixed(3)} ${fy(shoulderY)} ${width.toFixed(3)} ${fy(15.551)} ${width.toFixed(3)} ${fy(topRightY)}`,
      `V ${(height - radius).toFixed(3)}`,
      `C ${width.toFixed(3)} ${(height - 3.582).toFixed(3)} ${(width - 3.582).toFixed(3)} ${height.toFixed(3)} ${(width - radius).toFixed(3)} ${height.toFixed(3)}`,
      `H ${fx(8)}`,
      `C ${fx(3.582)} ${height.toFixed(3)} 0 ${(height - 3.582).toFixed(3)} 0 ${(height - radius).toFixed(3)}`,
      `V ${fy(8)}`,
      'Z',
    ].join(' ');
  }

  function buildOpCard(node) {
    const data = node.data || {};
    const latency = data.latency != null ? String(data.latency) : '—';
    const subgraph = data.subgraphId != null ? `sg·${data.subgraphId}` : 'sg·—';
    const magic = `#${data.magic != null ? data.magic : '—'}`;
    const shape = data.outShape ? shapeStr(data.outShape) : '—';
    const fromStr = (data.ioperands || []).map((id) => `T${id}`).join(', ') || '—';
    const toStr = (data.ooperands || []).map((id) => `T${id}`).join(', ') || '—';

    return `
      <div class="node-head">
        <span class="node-tag node-tag-id">${escHtml(subgraph)}</span>
        <span class="node-tag node-tag-id">${escHtml(magic)}</span>
      </div>
      <div class="op-pill">
        <div class="op-pill-icon">
          <img src="${escHtml(assetUrl('assets/fx.svg'))}" width="16" height="16" alt="">
        </div>
        <span class="op-pill-name">${escHtml(stageLabel(data))}</span>
        <span class="op-pill-latency">lat·${escHtml(latency)}</span>
      </div>
      <div class="node-rows">
        <div class="node-row">
          <span class="row-key">shape</span>
          <span class="row-val">${escHtml(shape)}</span>
        </div>
        <div class="node-row">
          <span class="row-key">from</span>
          <span class="row-val row-val-dim">${escHtml(fromStr)}</span>
        </div>
        <div class="node-row">
          <span class="row-key">to</span>
          <span class="row-val row-val-dim">${escHtml(toStr)}</span>
        </div>
      </div>
    `;
  }

  function buildTensorCard(node) {
    const data = node.data || {};
    return `
      <div class="node-head">
        <span class="node-tag node-tag-id">${escHtml(data.dtype || '—')}</span>
        <span class="node-tag node-tag-id">#${escHtml(data.magic != null ? data.magic : '—')}</span>
      </div>
      <div class="tensor-rect">
        <div class="tensor-rect-name">${escHtml(data.symbol || 'tensor')}</div>
        <div class="tensor-rect-shape">${escHtml(shapeStr(data.shape || []))}</div>
      </div>
      <div class="node-rows">
        <div class="node-row">
          <span class="row-key">rawshape</span>
          <span class="row-val row-val-dim">${escHtml(shapeStr(data.rawShape || []))}</span>
        </div>
        <div class="node-row">
          <span class="row-key">dtype</span>
          <span class="row-val">${escHtml(data.dtype || '—')}</span>
        </div>
        <div class="node-row">
          <span class="row-key">asis</span>
          <span class="row-val row-val-dim">${escHtml(data.format || '—')}</span>
        </div>
        <div class="node-row">
          <span class="row-key">offset</span>
          <span class="row-val row-val-dim">${escHtml(shapeStr(data.offset || []))}</span>
        </div>
      </div>
    `;
  }

  function buildCastCard(node, type) {
    const data = node.data || {};
    return `
      <div class="cast-header">
        <span class="cast-title">${escHtml(type)}</span>
        <span class="node-tag node-tag-id">slot·${escHtml(data.slotIdx != null ? data.slotIdx : '—')}</span>
      </div>
      <div class="node-rows cast-rows">
        <div class="node-row">
          <span class="row-key">shape</span>
          <span class="row-val">${escHtml(shapeStr(data.shape || []))}</span>
        </div>
        <div class="node-row">
          <span class="row-key">rawshape</span>
          <span class="row-val row-val-dim">${escHtml(shapeStr(data.rawShape || []))}</span>
        </div>
        <div class="node-row">
          <span class="row-key">offset</span>
          <span class="row-val row-val-dim">${escHtml(shapeStr(data.offset || []))}</span>
        </div>
        <div class="node-row">
          <span class="row-key">asis</span>
          <span class="row-val row-val-dim">${escHtml(data.format || '—')}</span>
        </div>
        <div class="node-row">
          <span class="row-key">dtype</span>
          <span class="row-val">${escHtml(data.dtype || '—')}</span>
        </div>
      </div>
      <svg class="node-wave" viewBox="0 0 252 30" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M250.871 15.5C214.882 3 188.371 3 188.371 3C161.86 3 125.871 15.5 125.871 15.5C125.871 15.5 89.659 26.5 63.371 26.5C37.083 26.5 0.871 15.5 0.871 15.5" fill="none" stroke="var(--node-accent)" stroke-width="3"/>
      </svg>
    `;
  }

  function buildGroupCard(node, frame, options) {
    const resolvedOptions = options || {};
    const data = node.data || {};
    const rows = resolvedOptions.compact ? [] : buildGroupRows(node);
    const bars = buildGroupMemberBars(node);
    const count = Number(data.count) || (Array.isArray(data.members) ? data.members.length : bars.length);
    const shellPath = buildGroupShellPath(frame.width, frame.height);

    return `
      <div class="group-shell" aria-hidden="true">
        <svg class="group-shell-svg" viewBox="0 0 ${frame.width} ${frame.height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <path class="group-shell-fill" d="${escHtml(shellPath)}"></path>
        </svg>
      </div>
      <div class="group-content">
        <div class="group-head">
          <span class="group-title op-pill-name">${escHtml(data.title || node.label || 'Group')}</span>
          <span class="group-count">${escHtml(count)}</span>
        </div>
        ${rows.length ? `
          <div class="node-rows group-rows">
            ${rows.map(([key, value]) => `
              <div class="node-row">
                <span class="row-key">${escHtml(key)}</span>
                <span class="row-val">${escHtml(value)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
        <div class="group-stack" data-group-type="${escHtml(data.groupType || 'tensor')}">
          ${bars.map((item) => {
            if (item.kind === 'ellipsis') {
              return '<div class="group-stack-item is-ellipsis">...</div>';
            }
            const itemTypeClass = item.type === 'op' ? 'is-op' : 'is-tensor';
            return `<div class="group-stack-item ${itemTypeClass}" style="--group-item-color:${escHtml(item.color)}" title="${escHtml(item.label)}"></div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  function buildCompactOpCard(node) {
    const data = node.data || {};
    const latency = data.latency != null ? `lat·${data.latency}` : '';
    return `
      <div class="op-pill">
        <div class="op-pill-icon">
          <img src="${escHtml(assetUrl('assets/fx.svg'))}" width="14" height="14" alt="">
        </div>
        <span class="op-pill-name">${escHtml(stageLabel(data))}</span>
        ${latency ? `<span class="op-pill-latency">${escHtml(latency)}</span>` : ''}
      </div>
    `;
  }

  function buildCompactTensorCard(node) {
    const data = node.data || {};
    return `
      <div class="tensor-rect">
        <div class="tensor-rect-name">${escHtml(data.symbol || 'tensor')}</div>
        <div class="tensor-rect-shape">${escHtml(shapeStr(data.shape || []))}</div>
      </div>
    `;
  }

  function buildCompactCastCard(node) {
    const data = node.data || {};
    const name = data.name || data.symbol || (node.type === 'incast' ? 'in' : 'out');
    return `
      <div class="tensor-rect">
        <div class="tensor-rect-name">${escHtml(name)}</div>
        <div class="tensor-rect-shape">${escHtml(shapeStr(data.shape || []))}</div>
      </div>
    `;
  }

  function buildCompactGroupCard(node, frame) {
    return buildGroupCard(node, frame, { compact: true });
  }

  function resolveAccent(node, options) {
    if (options.accent) return options.accent;
    if (node.accent) return node.accent;
    if (node.type === 'group') {
      const groupType = String(node.data?.groupType || 'tensor').toLowerCase();
      return groupType === 'op' || groupType === 'tile'
        ? DEFAULT_ACCENTS.groupOp
        : DEFAULT_ACCENTS.groupTensor;
    }
    return DEFAULT_ACCENTS[node.type] || DEFAULT_ACCENTS.tensor;
  }

  function buildNodeMarkup(node, options, frame) {
    if (options.compact) {
      switch (node.type) {
        case 'op': return buildCompactOpCard(node);
        case 'tensor': return buildCompactTensorCard(node);
        case 'incast':
        case 'outcast': return buildCompactCastCard(node);
        case 'group': return buildCompactGroupCard(node, frame);
        default: return buildCompactTensorCard(node);
      }
    }

    switch (node.type) {
      case 'op': return buildOpCard(node);
      case 'tensor': return buildTensorCard(node);
      case 'incast': return buildCastCard(node, 'incast');
      case 'outcast': return buildCastCard(node, 'outcast');
      case 'group': return buildGroupCard(node, frame);
      default: return buildTensorCard(node);
    }
  }

  function buildNodeCardElement(node, options) {
    const resolvedOptions = options || {};
    const frame = resolveFrame(node, !!resolvedOptions.compact);
    const el = document.createElement('article');
    el.className = `node-card node-card-${node.type}`;
    el.style.width = `${frame.width}px`;
    if (frame.height != null) {
      el.style.height = `${frame.height}px`;
    }
    if (frame.minHeight != null) {
      el.style.minHeight = `${frame.minHeight}px`;
    }
    el.dataset.nodeId = node.id || '';

    if (node.type === 'group') {
      const groupType = String(node.data?.groupType || 'tensor').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      el.classList.add('node-card-group', `node-card-group-${groupType}`);
    }

    if (resolvedOptions.compact) {
      el.dataset.compact = '';
    }
    if (resolvedOptions.selected) {
      el.classList.add('selected');
    }
    if (resolvedOptions.colorHint) {
      el.dataset.colorHint = resolvedOptions.colorHint;
    }

    el.style.setProperty('--node-accent', resolveAccent(node, resolvedOptions));
    el.innerHTML = buildNodeMarkup(node, resolvedOptions, frame);
    return el;
  }

  function renderCardSet(mountNode, cards) {
    if (!mountNode) return;
    mountNode.innerHTML = '';
    cards.forEach((cardSpec) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'pto-pass-ir-graph-node-card-slot';
      if (cardSpec.caption) {
        const caption = document.createElement('div');
        caption.className = 'pto-pass-ir-graph-node-card-caption';
        caption.textContent = cardSpec.caption;
        wrapper.appendChild(caption);
      }
      wrapper.appendChild(buildNodeCardElement(cardSpec.node, cardSpec.options || {}));
      mountNode.appendChild(wrapper);
    });
  }

  function demoData() {
    const tensorNode = {
      id: 'tensor_2155',
      type: 'tensor',
      data: {
        dtype: 'fp32',
        magic: 2155,
        symbol: 'query_view',
        shape: [1, 2, 128, 512],
        rawShape: [1, 2, 128, 512],
        format: 'MEM_DEVICE_DDR',
        offset: [1, 2, 128, 512],
      },
    };

    const opNode = {
      id: 'op_10000',
      type: 'op',
      data: {
        subgraphId: 2,
        magic: 10000,
        semanticLabel: 'Call',
        opcode: 'CALL',
        latency: 54,
        dtype: 'fp16',
        outShape: [1, 2, 128, 512],
        ioperands: [2154, 2155, 2156],
        ooperands: [2126, 2146, 2166],
      },
    };

    const incastNode = {
      id: 'incast_0',
      type: 'incast',
      data: {
        slotIdx: 0,
        shape: [1, 2, 128, 512],
        rawShape: [1, 2, 128, 512],
        offset: [0, 0, 0, 0],
        format: 'MEM_DEVICE_DDR',
        dtype: 'fp16',
      },
    };

    const outcastNode = {
      id: 'outcast_1',
      type: 'outcast',
      data: {
        slotIdx: 1,
        shape: [1, 2, 128, 512],
        rawShape: [1, 2, 128, 512],
        offset: [0, 0, 0, 0],
        format: 'MEM_DEVICE_DDR',
        dtype: 'fp16',
      },
    };

    const groupNode = {
      id: 'group_0',
      type: 'group',
      label: 'Fuse Block',
      data: {
        title: 'Matmul Block',
        groupType: 'op',
        count: 10,
        shape: [6, 256],
        memFrom: 'L1',
        memTo: 'L0C',
        rows: [
          ['latency_avg', '42 cy'],
          ['stage', 'epilogue'],
        ],
        members: [
          { type: 'op', color: '#3577F6', label: 'Matmul' },
          { type: 'op', color: '#3577F6', label: 'Bias' },
          { type: 'op', color: '#3577F6', label: 'Cast' },
          { type: 'op', color: '#3577F6', label: 'Reduce' },
          { type: 'op', color: '#3577F6', label: 'View' },
          { type: 'op', color: '#3577F6', label: 'Reshape' },
          { type: 'op', color: '#3577F6', label: 'Assemble' },
          { type: 'op', color: '#3577F6', label: 'Outcast' },
        ],
      },
    };

    return {
      standard: [
        { caption: 'Tensor Node', node: tensorNode },
        { caption: 'Op Node', node: opNode },
        { caption: 'Incast Node', node: incastNode },
        { caption: 'Outcast Node', node: outcastNode },
      ],
      selected: [
        { caption: 'Selected Tensor', node: tensorNode, options: { selected: true } },
        { caption: 'Selected Op', node: opNode, options: { selected: true } },
        { caption: 'Group Node', node: groupNode, options: { selected: true } },
      ],
      compact: [
        { caption: 'Compact Tensor', node: tensorNode, options: { compact: true } },
        { caption: 'Compact Op', node: opNode, options: { compact: true } },
        { caption: 'Compact Group', node: groupNode, options: { compact: true } },
      ],
    };
  }

  function renderDefaultPreview(root) {
    if (!root) return;
    const data = demoData();
    renderCardSet(root.querySelector('[data-graph-node-demo="standard"]'), data.standard);
    renderCardSet(root.querySelector('[data-graph-node-demo="selected"]'), data.selected);
    renderCardSet(root.querySelector('[data-graph-node-demo="compact"]'), data.compact);
  }

  global.PtoPassIrGraphNodePattern = {
    buildNodeCardElement,
    renderCardSet,
    renderDefaultPreview,
    demoData,
  };
})(window);

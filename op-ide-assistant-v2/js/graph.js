/* ═══════════════════════════════════════════════════════════════
   PyPTO IDE Assistant — Precision Debug: Compute Graph
   SVG DAG visualization with precision risk overlay
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── Demo Graph Data ────────────────────────────────────────────
const DEMO_OPS = [
  { id: 0, name: 'TILE_COPY_IN',    type: 'dma',    inputs: [],    outputs: [1, 2],    risk: 0 },
  { id: 1, name: 'TILE_COPY_IN',    type: 'dma',    inputs: [],    outputs: [3, 4],    risk: 0 },
  { id: 2, name: 'TILE_L1_TO_L0A', type: 'l1l0a',  inputs: [0],   outputs: [5],       risk: 20 },
  { id: 3, name: 'TILE_L1_TO_L0B', type: 'l1l0b',  inputs: [1],   outputs: [6],       risk: 20 },
  { id: 4, name: 'TILE_A_MUL_B',   type: 'cube',   inputs: [2,3], outputs: [7],       risk: 35 },
  { id: 5, name: 'TILE_A_MULACC_B',type: 'cube',   inputs: [4],   outputs: [8],       risk: 78 },
  { id: 6, name: 'TILE_COPY_IN',   type: 'dma',    inputs: [],    outputs: [9],       risk: 0 },
  { id: 7, name: 'TILE_ADD',       type: 'vector', inputs: [5,6], outputs: [10],      risk: 45 },
  { id: 8, name: 'TILE_MULS',      type: 'vector', inputs: [5],   outputs: [11],      risk: 30 },
  { id: 9, name: 'TILE_EXP',       type: 'vector', inputs: [7],   outputs: [12],      risk: 62 },
  { id:10, name: 'TILE_DIVS',      type: 'vector', inputs: [8,9], outputs: [13],      risk: 55 },
  { id:11, name: 'TILE_COPY_OUT',  type: 'dma',    inputs: [10],  outputs: [],        risk: 0 },
];

const OP_COLORS = {
  dma:    { fill: '#0c1e3d', stroke: '#3b82f6' },
  l1l0a:  { fill: '#1a0d3d', stroke: '#a78bfa' },
  l1l0b:  { fill: '#140b35', stroke: '#7c3aed' },
  cube:   { fill: '#1f0d00', stroke: '#f97316' },
  vector: { fill: '#0a1f10', stroke: '#10b981' },
};

const OP_SHORT = {
  dma: 'DMA', l1l0a: 'L0A', l1l0b: 'L0B', cube: 'CUBE', vector: 'VEC',
};

// ── Layout ────────────────────────────────────────────────────
const NODE_W  = 130;
const NODE_H  = 40;
const COL_GAP = 60;
const ROW_GAP = 20;

let _graphState = {
  riskOverlay: true,
  selectedOp: null,
  checkpoints: new Set(),
  pan: { x: 30, y: 30 },
  scale: 1,
  dragging: false,
  dragStart: null,
};

function initPrecisionGraph() {
  layoutAndRender();
  initGraphInteraction();
  renderRiskMatrix();
}

function layoutAndRender() {
  // Simple topological column layout
  const inDeg = new Array(DEMO_OPS.length).fill(0);
  DEMO_OPS.forEach(op => op.outputs.forEach(to => inDeg[to]++));

  const cols = [];
  const opCols = new Array(DEMO_OPS.length).fill(-1);
  const queue = DEMO_OPS.filter((_, i) => inDeg[i] === 0).map(op => op.id);
  let col = 0;

  const tempInDeg = [...inDeg];
  while (queue.length > 0) {
    cols.push([...queue]);
    queue.forEach(id => {
      opCols[id] = col;
      DEMO_OPS[id].outputs.forEach(to => {
        tempInDeg[to]--;
        if (tempInDeg[to] === 0) queue.push(to);
      });
    });
    queue.splice(0, queue.length - (queue.length - cols[col].length));
    col++;
    if (col > 20) break; // safety
  }

  // Recalculate properly using BFS
  const colMap = new Array(DEMO_OPS.length).fill(0);
  const visited = new Set();
  const bfsQueue = DEMO_OPS.filter((_, i) => inDeg[i] === 0).map(op => op.id);
  bfsQueue.forEach(id => visited.add(id));

  let step = 0;
  const bfsLevel = [bfsQueue.slice()];
  while (bfsLevel[step] && bfsLevel[step].length > 0) {
    const next = [];
    bfsLevel[step].forEach(id => {
      colMap[id] = step;
      DEMO_OPS[id].outputs.forEach(to => {
        if (!visited.has(to)) { visited.add(to); next.push(to); }
      });
    });
    bfsLevel.push(next);
    step++;
    if (step > 30) break;
  }

  // Group by column
  const colGroups = {};
  DEMO_OPS.forEach(op => {
    const c = colMap[op.id];
    if (!colGroups[c]) colGroups[c] = [];
    colGroups[c].push(op.id);
  });

  // Compute positions
  const positions = {};
  Object.keys(colGroups).forEach(c => {
    const ids = colGroups[c];
    const colX = parseInt(c) * (NODE_W + COL_GAP) + 20;
    ids.forEach((id, row) => {
      positions[id] = {
        x: colX,
        y: row * (NODE_H + ROW_GAP) + 20,
      };
    });
  });

  renderSVGGraph(positions);
}

function renderSVGGraph(positions) {
  const g = document.getElementById('pg-transform');
  if (!g) return;
  g.innerHTML = '';

  // Draw edges first (behind nodes)
  DEMO_OPS.forEach(op => {
    op.outputs.forEach(toId => {
      const from = positions[op.id];
      const to   = positions[toId];
      if (!from || !to) return;

      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;
      const cx1 = (x1 + x2) / 2;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1},${y1} C${cx1},${y1} ${cx1},${y2} ${x2},${y2}`);
      path.setAttribute('class', 'pg-edge');
      path.setAttribute('marker-end', 'url(#arrow)');
      g.appendChild(path);
    });
  });

  // Arrow marker
  const svg = document.getElementById('precision-graph');
  let defs = svg.querySelector('defs');
  if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg','defs'); svg.insertBefore(defs, svg.firstChild); }
  defs.innerHTML += `
    <marker id="arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L8,4 L0,8 z" fill="#243447"/>
    </marker>`;

  // Draw nodes
  DEMO_OPS.forEach(op => {
    const pos = positions[op.id];
    if (!pos) return;
    const col = OP_COLORS[op.type] || OP_COLORS.dma;
    const risk = _graphState.riskOverlay ? op.risk : 0;
    const riskColor = risk >= 60 ? '#ef4444' : risk >= 35 ? '#f97316' : col.stroke;
    const isCheckpoint = _graphState.checkpoints.has(op.id);

    const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    grp.setAttribute('class', `pg-node${risk >= 60 ? ' risk-high' : risk >= 35 ? ' risk-medium' : ''}${isCheckpoint ? ' checkpoint' : ''}`);
    grp.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    grp.setAttribute('data-op-id', op.id);

    // Risk halo
    if (risk > 0 && _graphState.riskOverlay) {
      const halo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      halo.setAttribute('x', -3); halo.setAttribute('y', -3);
      halo.setAttribute('width', NODE_W + 6); halo.setAttribute('height', NODE_H + 6);
      halo.setAttribute('rx', 9);
      halo.setAttribute('fill', risk >= 60 ? '#ef444422' : '#f9731622');
      halo.setAttribute('stroke', 'none');
      grp.appendChild(halo);
    }

    // Body
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', NODE_W); rect.setAttribute('height', NODE_H);
    rect.setAttribute('rx', 6);
    rect.setAttribute('fill', col.fill);
    rect.setAttribute('stroke', isCheckpoint ? '#3b82f6' : riskColor);
    rect.setAttribute('stroke-width', op.id === _graphState.selectedOp ? 3 : 1.5);
    if (isCheckpoint) rect.setAttribute('stroke-dasharray', '5 3');
    grp.appendChild(rect);

    // Left accent bar
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bar.setAttribute('x', 0); bar.setAttribute('y', 0);
    bar.setAttribute('width', 3); bar.setAttribute('height', NODE_H);
    bar.setAttribute('rx', 3); bar.setAttribute('fill', col.stroke);
    grp.appendChild(bar);

    // Type badge
    const badge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    badge.setAttribute('x', NODE_W - 36); badge.setAttribute('y', 6);
    badge.setAttribute('width', 30); badge.setAttribute('height', 14);
    badge.setAttribute('rx', 3);
    badge.setAttribute('fill', col.stroke + '22');
    badge.setAttribute('stroke', col.stroke + '55');
    grp.appendChild(badge);

    const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    badgeText.setAttribute('x', NODE_W - 21); badgeText.setAttribute('y', 16);
    badgeText.setAttribute('text-anchor', 'middle');
    badgeText.setAttribute('font-size', '8');
    badgeText.setAttribute('fill', col.stroke);
    badgeText.setAttribute('font-family', 'SF Mono, Fira Code, monospace');
    badgeText.textContent = OP_SHORT[op.type] || '?';
    grp.appendChild(badgeText);

    // Op name
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', 10); txt.setAttribute('y', 16);
    txt.setAttribute('font-size', '9.5');
    txt.setAttribute('fill', '#c9d1d9');
    txt.setAttribute('font-family', 'SF Mono, Fira Code, monospace');
    txt.setAttribute('font-weight', '600');
    const shortName = op.name.replace('TILE_','').slice(0, 13);
    txt.textContent = shortName;
    grp.appendChild(txt);

    // Risk indicator
    if (risk > 0 && _graphState.riskOverlay) {
      const riskTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      riskTxt.setAttribute('x', 10); riskTxt.setAttribute('y', 30);
      riskTxt.setAttribute('font-size', '8');
      riskTxt.setAttribute('fill', riskColor);
      riskTxt.setAttribute('font-family', 'SF Mono, Fira Code, monospace');
      riskTxt.textContent = `risk: ${risk}%`;
      grp.appendChild(riskTxt);
    }

    // Checkpoint badge
    if (isCheckpoint) {
      const cpTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      cpTxt.setAttribute('x', 10); cpTxt.setAttribute('y', 30);
      cpTxt.setAttribute('font-size', '8');
      cpTxt.setAttribute('fill', '#3b82f6');
      cpTxt.textContent = '⊕ checkpoint';
      grp.appendChild(cpTxt);
    }

    grp.style.cursor = 'pointer';
    grp.addEventListener('click', () => selectGraphOp(op.id));

    g.appendChild(grp);
  });

  applyGraphTransform();
}

function applyGraphTransform() {
  const g = document.getElementById('pg-transform');
  if (g) g.setAttribute('transform', `translate(${_graphState.pan.x},${_graphState.pan.y}) scale(${_graphState.scale})`);
}

// ── Graph Interaction ──────────────────────────────────────────
function initGraphInteraction() {
  const svg = document.getElementById('precision-graph');
  if (!svg) return;

  svg.addEventListener('mousedown', e => {
    if (e.target.closest('.pg-node')) return;
    _graphState.dragging = true;
    _graphState.dragStart = { x: e.clientX - _graphState.pan.x, y: e.clientY - _graphState.pan.y };
    svg.style.cursor = 'grabbing';
  });

  svg.addEventListener('mousemove', e => {
    if (!_graphState.dragging) return;
    _graphState.pan.x = e.clientX - _graphState.dragStart.x;
    _graphState.pan.y = e.clientY - _graphState.dragStart.y;
    applyGraphTransform();
  });

  svg.addEventListener('mouseup', () => { _graphState.dragging = false; svg.style.cursor = 'grab'; });
  svg.addEventListener('mouseleave', () => { _graphState.dragging = false; });

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    _graphState.scale = Math.max(0.3, Math.min(3, _graphState.scale * factor));
    applyGraphTransform();
  });
}

function fitGraph() {
  _graphState.pan = { x: 30, y: 30 };
  _graphState.scale = 0.85;
  applyGraphTransform();
}

function toggleRiskOverlay() {
  _graphState.riskOverlay = !_graphState.riskOverlay;
  const btn = document.getElementById('risk-overlay-btn');
  if (btn) btn.classList.toggle('active-toggle', _graphState.riskOverlay);
  layoutAndRender();
}

// ── Op Selection ───────────────────────────────────────────────
function selectGraphOp(opId) {
  const op = DEMO_OPS[opId];
  if (!op) return;

  // Toggle
  if (_graphState.selectedOp === opId) {
    _graphState.selectedOp = null;
    renderSelectedOpInfo(null);
    layoutAndRender();
    return;
  }

  _graphState.selectedOp = opId;
  layoutAndRender();
  renderSelectedOpInfo(op);

  // AI comment in precision chat
  const chat = document.getElementById('precision-chat');
  const riskLevel = op.risk >= 60 ? '高风险' : op.risk >= 35 ? '中风险' : '低风险';
  appendMsg(chat, 'ai', `已选中算子 \`${op.name}\`（${riskLevel} ${op.risk}%）。\n${getRiskComment(op)}`);
}

function getRiskComment(op) {
  if (op.type === 'cube' && op.risk >= 60)
    return '该算子为矩阵乘累加，BF16 尾数截断误差会随循环次数累积。建议优先应用 P1（frontend.jit）策略。';
  if (op.type === 'vector' && op.risk >= 50)
    return '指数运算对输入范围敏感，建议检查输入值是否超出 BF16 表示范围（约 ±65504）。';
  if (op.risk >= 35)
    return '存在中等精度风险，建议插入检查点对比中间结果。';
  return '精度风险较低，建议优先排查上下游算子。';
}

function renderSelectedOpInfo(op) {
  const el = document.getElementById('selected-op-info');
  if (!el) return;
  if (!op) {
    el.innerHTML = '<div class="ds-title">选中算子</div><div class="ds-placeholder">← 点击计算图中的算子节点</div>';
    return;
  }

  const col = OP_COLORS[op.type] || OP_COLORS.dma;
  const riskColor = op.risk >= 60 ? '#ef4444' : op.risk >= 35 ? '#f97316' : '#10b981';
  const riskLabel = op.risk >= 60 ? 'High Risk' : op.risk >= 35 ? 'Medium Risk' : 'Normal';

  el.innerHTML = `
    <div class="ds-title">选中算子</div>
    <div class="op-detail-header">
      <div class="od-color-bar" style="background:${col.stroke}"></div>
      <div>
        <div class="od-name">${op.name}</div>
        <span class="od-badge" style="background:${col.stroke}22;color:${col.stroke};border:1px solid ${col.stroke}44">
          ${OP_SHORT[op.type]}
        </span>
        <span class="od-badge" style="background:${riskColor}22;color:${riskColor};border:1px solid ${riskColor}44;margin-left:4px">
          ${riskLabel} ${op.risk}%
        </span>
      </div>
    </div>
    <div class="op-detail-grid">
      <div class="od-kv"><div class="od-k">Op ID</div><div class="od-v">#${op.id}</div></div>
      <div class="od-kv"><div class="od-k">Type</div><div class="od-v">${OP_SHORT[op.type]}</div></div>
      <div class="od-kv"><div class="od-k">Inputs</div><div class="od-v">${op.inputs.length}</div></div>
      <div class="od-kv"><div class="od-k">Outputs</div><div class="od-v">${op.outputs.length}</div></div>
    </div>
    <button class="btn-mini" style="margin-top:8px;width:100%;" onclick="insertCheckpointAtOp(${op.id})">
      + 在此算子插入检查点
    </button>
  `;
}

// ── Risk Matrix ────────────────────────────────────────────────
function renderRiskMatrix() {
  const el = document.getElementById('risk-matrix');
  if (!el) return;

  const highRisk = DEMO_OPS.filter(op => op.risk >= 60).sort((a,b) => b.risk - a.risk);
  const midRisk  = DEMO_OPS.filter(op => op.risk >= 35 && op.risk < 60).sort((a,b) => b.risk - a.risk);

  const rows = [...highRisk.slice(0,3), ...midRisk.slice(0,3)];
  el.innerHTML = rows.map(op => {
    const cls = op.risk >= 60 ? 'risk-high' : op.risk >= 35 ? 'risk-medium' : 'risk-low';
    return `
      <div class="rm-row ${cls}" onclick="selectGraphOp(${op.id})" style="cursor:pointer">
        <div class="rm-name" title="${op.name}">${op.name.replace('TILE_','')}</div>
        <div class="rm-bar-bg"><div class="rm-bar-fill" style="width:${op.risk}%"></div></div>
        <div class="rm-label">${op.risk}%</div>
      </div>`;
  }).join('');
}

// ── Checkpoint ─────────────────────────────────────────────────
function insertCheckpoint() {
  if (_graphState.selectedOp === null) {
    showToast('请先点击计算图中的算子', 'info');
    return;
  }
  insertCheckpointAtOp(_graphState.selectedOp);
}

function insertCheckpointAtOp(opId) {
  _graphState.checkpoints.add(opId);
  layoutAndRender();
  showToast(`检查点已插入：#${opId} ${DEMO_OPS[opId]?.name}`, 'success');

  // Show checkpoint section with mock results
  const section = document.getElementById('checkpoint-section');
  if (section) {
    section.style.display = 'block';
    renderCheckpointResults(opId);
  }
}

function renderCheckpointResults(opId) {
  const el = document.getElementById('checkpoint-results');
  if (!el) return;
  const op = DEMO_OPS[opId];
  if (!op) return;

  const items = [
    { name: 'max_abs_err', val: '2.34e-3', pass: false, pct: 70 },
    { name: 'mean_abs_err', val: '5.12e-4', pass: true, pct: 25 },
    { name: 'cosine_sim', val: '0.9994', pass: true, pct: 5 },
    { name: 'outlier_ratio', val: '0.32%', pass: true, pct: 15 },
  ];

  el.innerHTML = `
    <div style="font-size:11px;color:#475569;margin-bottom:8px;">算子 <code style="color:#93c5fd">${op.name}</code> vs PyTorch reference</div>
    ${items.map(item => `
      <div class="ckpt-item">
        <div class="ckpt-name">${item.name}</div>
        <div class="ckpt-diff-bar"><div class="ckpt-diff-fill ${item.pass?'pass':'fail'}" style="width:${item.pct}%"></div></div>
        <div class="ckpt-val ${item.pass?'ckpt-pass':'ckpt-fail'}">${item.val}</div>
      </div>`).join('')}
    <div style="font-size:11px;color:#ef4444;margin-top:6px;">⚠ max_abs_err 超阈值 (>1e-3)，建议应用 P1 精度策略</div>
  `;
}

// ── Binary Search ──────────────────────────────────────────────
let _bsState = { lo: 0, hi: DEMO_OPS.length - 1, step: 0 };

function runBinarySearch() {
  _bsState = { lo: 0, hi: DEMO_OPS.length - 1, step: 0 };
  const chat = document.getElementById('precision-chat');

  appendMsg(chat, 'ai', '开始二分精度定位...\n\n将算子序列一分为二，在中点插入检查点对比精度。');

  setTimeout(() => {
    const mid = Math.floor((_bsState.lo + _bsState.hi) / 2);
    _graphState.checkpoints.clear();
    _graphState.checkpoints.add(mid);
    layoutAndRender();

    appendMsg(chat, 'ai', `Step 1: 在算子 #${mid}（${DEMO_OPS[mid]?.name}）插入检查点。\n\n模拟运行结果：误差在该点已出现 (max_err=2.34e-3)。\n\n结论：精度问题发生在 #0~#${mid} 之间。继续二分...`);

    setTimeout(() => {
      const newMid = Math.floor((_bsState.lo + mid) / 2);
      _graphState.checkpoints.add(newMid);
      layoutAndRender();
      appendMsg(chat, 'ai', `Step 2: 在算子 #${newMid}（${DEMO_OPS[newMid]?.name}）插入检查点。\n\n结果：该点误差正常。\n\n✓ 精度问题锁定在 #${newMid+1}~#${mid} 之间，最可能的算子是 \`TILE_A_MULACC_B\`（risk: 78%）。\n\n建议：优先应用 P1 + P3 策略。`);
    }, 1500);
  }, 1000);
}

// ── Workaround Actions ─────────────────────────────────────────
function applyWorkaround(type) {
  const messages = {
    jit:     '已在代码中添加 @pypto.frontend.jit 装饰符',
    inplace: '已在受影响算子添加 inplace=False 参数',
    unroll:  '已在配置中设置 unroll_list=[1]',
    submit:  '已在循环头部添加 submit_before_loop=True',
    plus0:   '已在累加点插入 tensor = tensor + 0.0',
    shape:   '已调整 tile shape 至 16B 对齐边界',
  };
  showToast(messages[type] || '策略已应用', 'success');

  // Animate risk reduction
  if (type === 'jit' || type === 'unroll') {
    DEMO_OPS.forEach(op => { if (op.risk > 40) op.risk = Math.max(op.risk - 30, 10); });
    layoutAndRender();
    renderRiskMatrix();
    const chat = document.getElementById('precision-chat');
    appendMsg(chat, 'ai', `已应用 ${type} 策略。精度风险已降低，建议重新运行对比测试验证效果。`);
  }
}

function previewWorkaround(type) {
  const previews = {
    jit:    '@pypto.frontend.jit\ndef kernel_func(...):\n    ...',
    inplace:'tile_op = TileOp(inplace=False)\ntile_op.run(src, dst)',
    unroll: '@pypto.op_config(unroll_list=[1])\ndef kernel_func(...):\n    ...',
    submit: 'for k in range(K_TILE):\n    pypto.submit()  # submit_before_loop\n    ...',
    plus0:  'acc_result = acc_result + 0.0  # force type promotion',
    shape:  'M_TILE = 64  # was 60, aligned to 16',
  };
  showToast('预览已复制到剪贴板', 'info');
  try { navigator.clipboard.writeText(previews[type] || ''); } catch(e) {}
}

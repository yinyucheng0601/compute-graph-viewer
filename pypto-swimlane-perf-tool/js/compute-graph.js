/**
 * compute-graph.js - 计算图渲染模块
 * 解析 task 的 ioperand-hint / ooperand-hint，渲染 SVG DAG
 */

'use strict';

/**
 * 将 Python dict 格式字符串转换为合法 JSON
 * Python 格式: [{210: {'shape': [32, 1], 'dtype': 7, ...}}, ...]
 * JSON  格式: [{"210": {"shape": [32, 1], "dtype": 7, ...}}]
 */
function parsePythonDictString(str) {
  if (!str) return [];
  try {
    // 1. 将单引号字符串替换为双引号
    // 2. 将裸整数键替换为字符串键
    let json = str
      .replace(/'/g, '"')                          // 单引号 → 双引号
      .replace(/\bNone\b/g, 'null')                // None → null
      .replace(/\bTrue\b/g, 'true')                // True → true
      .replace(/\bFalse\b/g, 'false')              // False → false
      .replace(/(\d+)\s*:/g, '"$1":');             // 整数键 → 字符串键
    return JSON.parse(json);
  } catch (e) {
    // 解析失败时尝试逐条提取
    const items = [];
    const re = /\{(\d+):\s*\{([^{}]+)\}\}/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const id = m[1];
      const body = m[2];
      const shapeMatch = body.match(/'shape':\s*\[([^\]]+)\]/);
      const dtypeMatch = body.match(/'dtype':\s*(\d+)/);
      const memMatch   = body.match(/'mem_usage':\s*(\d+)/);
      items.push({
        [id]: {
          shape: shapeMatch ? shapeMatch[1].split(',').map(s => parseInt(s.trim())) : [],
          dtype: dtypeMatch ? parseInt(dtypeMatch[1]) : 0,
          mem_usage: memMatch ? parseInt(memMatch[1]) : 0,
        }
      });
    }
    return items;
  }
}

const DTYPE_NAMES = {
  0: 'f32', 1: 'f16', 2: 'i8', 3: 'u8', 4: 'i32',
  5: 'i16', 6: 'u16', 7: 'bf16', 8: 'f64', 9: 'i64',
  10: 'u32', 11: 'u64', 12: 'bool',
};

function dtypeName(code) {
  return DTYPE_NAMES[code] || `t${code}`;
}

function formatShape(shape) {
  if (!Array.isArray(shape) || shape.length === 0) return '?';
  return '[' + shape.join('×') + ']';
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024)        return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

/**
 * 从 task event 提取计算图数据
 */
function extractComputeGraphData(event) {
  const args = event.args || {};
  const iHint  = args['ioperand-hint']  || args['ioperandHint']  || '';
  const oHint  = args['ooperand-hint']  || args['ooperandHint']  || '';
  const wHint  = args['woperand-hint']  || args['woperandHint']  || '';

  const inputs   = parsePythonDictString(iHint);
  const outputs  = parsePythonDictString(oHint);
  const weights  = parsePythonDictString(wHint);

  const opName   = getEventOpType(event);
  const taskId   = args.taskId || args.TaskId || '';
  const execHint = parseExecutionHint(args['execution-hint']);
  const eventHint = args['event-hint'] || '';

  // 提取 block / tiling 信息
  const blockMatch  = eventHint.match(/Block:\[([^\]]+)\]/);
  const tilingMatch = eventHint.match(/Tiling[^:]*:\s*([^\n;]+)/);

  return {
    opName,
    taskId,
    taskName: event.name || opName,
    dur: event.dur || 0,
    execHint,
    blockInfo: blockMatch  ? blockMatch[1]  : null,
    tilingInfo: tilingMatch ? tilingMatch[1].trim() : null,
    inputs,
    outputs,
    weights,
  };
}

/**
 * 渲染计算图到 container (div)
 */
function renderComputeGraph(container, event) {
  const data = extractComputeGraphData(event);
  container.innerHTML = '';

  const ns = 'http://www.w3.org/2000/svg';

  // ── 布局参数 ─────────────────────────────────────────────────
  const NODE_W      = 140;
  const NODE_H      = 54;
  const OP_W        = 160;
  const OP_H        = 72;
  const H_GAP       = 40;   // 水平间距（列间）
  const V_GAP       = 14;   // 同列节点垂直间距
  const COL_PADDING = 20;   // 容器左右边距

  // 列: [inputs/weights] → [op] → [outputs]
  const leftNodes  = [
    ...data.inputs.map((item, i)  => ({ kind: 'input',  idx: i, item })),
    ...data.weights.map((item, i) => ({ kind: 'weight', idx: i, item })),
  ];
  const rightNodes = data.outputs.map((item, i) => ({ kind: 'output', idx: i, item }));

  const leftColH  = leftNodes.length  * (NODE_H + V_GAP) - V_GAP;
  const rightColH = rightNodes.length * (NODE_H + V_GAP) - V_GAP;
  const opColH    = OP_H;

  const totalH = Math.max(leftColH, rightColH, opColH) + 60;

  // 列 X 坐标
  const col0X = COL_PADDING;
  const col1X = COL_PADDING + NODE_W + H_GAP;
  const col2X = col1X + OP_W + H_GAP;
  const svgW  = col2X + NODE_W + COL_PADDING;
  const svgH  = totalH;

  // 垂直居中辅助
  const centerY = (count, itemH) => (svgH - (count * itemH + (count - 1) * V_GAP)) / 2;

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.style.display = 'block';
  svg.style.margin = '0 auto';

  // ── defs (箭头) ───────────────────────────────────────────────
  const defs = document.createElementNS(ns, 'defs');
  const arrow = document.createElementNS(ns, 'marker');
  arrow.setAttribute('id', 'cg-arrow');
  arrow.setAttribute('markerWidth', '8');
  arrow.setAttribute('markerHeight', '8');
  arrow.setAttribute('refX', '6');
  arrow.setAttribute('refY', '3');
  arrow.setAttribute('orient', 'auto');
  const arrowPath = document.createElementNS(ns, 'path');
  arrowPath.setAttribute('d', 'M0,0 L0,6 L8,3 z');
  arrowPath.setAttribute('fill', '#64748B');
  arrow.appendChild(arrowPath);
  defs.appendChild(arrow);
  svg.appendChild(defs);

  // ── 辅助函数 ──────────────────────────────────────────────────
  function makeRect(x, y, w, h, rx, fill, stroke) {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y);
    r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('rx', rx);
    r.setAttribute('fill', fill);
    r.setAttribute('stroke', stroke);
    r.setAttribute('stroke-width', '1');
    return r;
  }

  function makeText(x, y, text, size, fill, anchor = 'middle', weight = 'normal') {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('font-size', size);
    t.setAttribute('fill', fill);
    t.setAttribute('text-anchor', anchor);
    t.setAttribute('font-family', 'monospace, sans-serif');
    t.setAttribute('font-weight', weight);
    t.textContent = text;
    return t;
  }

  function makeLine(x1, y1, x2, y2) {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', '#64748B');
    l.setAttribute('stroke-width', '1.5');
    l.setAttribute('marker-end', 'url(#cg-arrow)');
    return l;
  }

  function getFirstEntry(item) {
    const keys = Object.keys(item);
    if (!keys.length) return { id: '?', info: {} };
    const id = keys[0];
    return { id, info: item[id] || {} };
  }

  function drawTensorNode(x, y, item, kind) {
    const { id, info } = getFirstEntry(item);
    const shape   = info.shape || [];
    const dtype   = info.dtype ?? '';
    const mem     = info.mem_usage || 0;

    const fillMap  = { input: '#1E3A5F', weight: '#1E3B2B', output: '#3B2A1E' };
    const strMap   = { input: '#3B82F6', weight: '#10B981', output: '#F97316' };
    const lblMap   = { input: 'INPUT',   weight: 'WEIGHT',  output: 'OUTPUT' };
    const fill     = fillMap[kind]  || '#1E293B';
    const stroke   = strMap[kind]   || '#64748B';
    const kindLbl  = lblMap[kind]   || kind.toUpperCase();

    const g = document.createElementNS(ns, 'g');
    g.appendChild(makeRect(x, y, NODE_W, NODE_H, 6, fill, stroke));

    // 种类标签
    g.appendChild(makeText(x + NODE_W / 2, y + 13, kindLbl, 9, stroke, 'middle', 'bold'));
    // 形状
    g.appendChild(makeText(x + NODE_W / 2, y + 27, formatShape(shape), 10, '#E2E8F0', 'middle', 'bold'));
    // dtype + id
    g.appendChild(makeText(x + NODE_W / 2, y + 40, `${dtypeName(dtype)} · id:${id}`, 9, '#94A3B8'));
    // 内存
    if (mem > 0) g.appendChild(makeText(x + NODE_W / 2, y + 52, formatBytes(mem), 8, '#64748B'));

    return { g, cx: x + NODE_W, cy: y + NODE_H / 2, lx: x, ly: y + NODE_H / 2 };
  }

  function drawOpNode(x, y, w, h) {
    const g = document.createElementNS(ns, 'g');
    g.appendChild(makeRect(x, y, w, h, 8, '#2D1B69', '#8B5CF6'));

    const name = data.opName.length > 18
      ? data.opName.substring(0, 17) + '…'
      : data.opName;
    g.appendChild(makeText(x + w / 2, y + 20, name, 12, '#C4B5FD', 'middle', 'bold'));
    g.appendChild(makeText(x + w / 2, y + 36, `${data.dur.toFixed(1)} μs`, 10, '#A78BFA'));

    if (data.execHint?.avg) {
      g.appendChild(makeText(x + w / 2, y + 52, `avg ${data.execHint.avg.toFixed(1)} μs`, 9, '#7C3AED'));
    }
    if (data.blockInfo) {
      const blk = data.blockInfo.length > 20 ? data.blockInfo.substring(0, 19) + '…' : data.blockInfo;
      g.appendChild(makeText(x + w / 2, y + 63, `Block: ${blk}`, 8, '#6D28D9'));
    }

    return { g, cx: x, cy: y + h / 2, rx: x + w, ry: y + h / 2 };
  }

  // ── 渲染左列 (inputs + weights) ──────────────────────────────
  const leftConnects  = [];
  if (leftNodes.length > 0) {
    const startY = centerY(leftNodes.length, NODE_H);
    leftNodes.forEach((n, i) => {
      const y = startY + i * (NODE_H + V_GAP);
      const { g, cx, cy } = drawTensorNode(col0X, y, n.item, n.kind);
      svg.appendChild(g);
      leftConnects.push({ cx, cy });
    });
  }

  // ── 渲染右列 (outputs) ────────────────────────────────────────
  const rightConnects = [];
  if (rightNodes.length > 0) {
    const startY = centerY(rightNodes.length, NODE_H);
    rightNodes.forEach((n, i) => {
      const y = startY + i * (NODE_H + V_GAP);
      const { g, lx, ly } = drawTensorNode(col2X, y, n.item, n.kind);
      svg.appendChild(g);
      rightConnects.push({ lx, ly });
    });
  }

  // ── 渲染 op 节点 ─────────────────────────────────────────────
  const opY = (svgH - OP_H) / 2;
  const op  = drawOpNode(col1X, opY, OP_W, OP_H);
  svg.appendChild(op.g);

  // ── 连线 ─────────────────────────────────────────────────────
  leftConnects.forEach(({ cx, cy }) => {
    svg.appendChild(makeLine(cx, cy, op.cx - 2, op.cy));
  });
  rightConnects.forEach(({ lx, ly }) => {
    svg.appendChild(makeLine(op.rx + 2, op.ry, lx - 2, ly));
  });

  // ── 空状态 ───────────────────────────────────────────────────
  if (leftNodes.length === 0 && rightNodes.length === 0) {
    // 只显示 op 节点
    const g = document.createElementNS(ns, 'g');
    g.appendChild(makeText(svgW / 2, svgH / 2 - 10, '无操作数信息', 13, '#64748B'));
    g.appendChild(makeText(svgW / 2, svgH / 2 + 10, '(ioperand-hint / ooperand-hint 字段缺失)', 11, '#475569'));
    svg.appendChild(g);
  }

  container.appendChild(svg);
}

/**
 * 渲染任务详细信息 (文字摘要区域)
 */
function renderTaskSummary(container, event) {
  const data = extractComputeGraphData(event);
  const args = event.args || {};

  let html = `<div class="cg-summary">`;
  html += `<div class="cg-summary-row"><span class="cg-lbl">算子</span><span class="cg-val cg-op">${data.opName}</span></div>`;
  html += `<div class="cg-summary-row"><span class="cg-lbl">名称</span><span class="cg-val">${data.taskName}</span></div>`;
  if (data.taskId) html += `<div class="cg-summary-row"><span class="cg-lbl">Task ID</span><span class="cg-val">${data.taskId}</span></div>`;
  html += `<div class="cg-summary-row"><span class="cg-lbl">耗时</span><span class="cg-val">${data.dur.toFixed(3)} μs</span></div>`;
  if (data.execHint?.avg) html += `<div class="cg-summary-row"><span class="cg-lbl">平均</span><span class="cg-val">${data.execHint.avg.toFixed(3)} μs</span></div>`;
  if (data.execHint?.max) html += `<div class="cg-summary-row"><span class="cg-lbl">最大</span><span class="cg-val">${data.execHint.max.toFixed(3)} μs</span></div>`;
  if (data.blockInfo)    html += `<div class="cg-summary-row"><span class="cg-lbl">Block</span><span class="cg-val">${data.blockInfo}</span></div>`;
  if (data.tilingInfo)   html += `<div class="cg-summary-row"><span class="cg-lbl">Tiling</span><span class="cg-val">${data.tilingInfo}</span></div>`;

  // 输入数量
  const iCount = data.inputs.length + data.weights.length;
  const oCount = data.outputs.length;
  html += `<div class="cg-summary-row"><span class="cg-lbl">输入</span><span class="cg-val">${iCount} 个 (含权重 ${data.weights.length} 个)</span></div>`;
  html += `<div class="cg-summary-row"><span class="cg-lbl">输出</span><span class="cg-val">${oCount} 个</span></div>`;

  html += `</div>`;
  container.innerHTML = html;
}

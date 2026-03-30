/* ═══════════════════════════════════════════════════════════════
   PyPTO IDE Assistant — Performance Swimlane
   Canvas-based task timeline with AI bottleneck analysis
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── Config ────────────────────────────────────────────────────
const SL = {
  canvas: null,
  ctx: null,
  data: null,
  scale: 1,
  offsetX: 120,      // left margin for core labels
  rowH: 18,
  headerH: 32,
  padding: 4,
  totalUs: 5000,
  hovered: null,
  bubbleMode: true,
};

const TASK_COLORS = {
  dma:    '#3b82f6',
  cube:   '#f97316',
  vector: '#10b981',
  fixpipe:'#a78bfa',
  scalar: '#f59e0b',
};

const BUBBLE_PATTERN_COLOR = '#ef4444';

// ── Demo Profile Data ──────────────────────────────────────────
function makeDemoProfile() {
  const AIC = 24, AIV = 24;
  const totalUs = 5000;
  const tasks = [];

  // AIC cores: Cube + DMA tasks with intentional bubbles
  for (let core = 0; core < AIC; core++) {
    let t = core * 15; // stagger start slightly
    const phaseLen = totalUs / 5;

    // Phase 1: Copy IN
    tasks.push({ core, coreType:'AIC', type:'dma',    start: t, end: t + 120 + Math.random()*40, label:'COPY_IN' });
    t += 140 + Math.random()*20;

    // Bubble (wait for DMA)
    const bubble1 = 40 + Math.random() * 60;
    tasks.push({ core, coreType:'AIC', type:'bubble', start: t, end: t + bubble1 });
    t += bubble1;

    // Phase 2: L1→L0A
    tasks.push({ core, coreType:'AIC', type:'dma',    start: t, end: t + 60, label:'L1→L0A' });
    t += 65;

    // Phase 3: GEMM iterations
    for (let k = 0; k < 3; k++) {
      tasks.push({ core, coreType:'AIC', type:'cube', start: t, end: t + 200 + Math.random()*50, label:'A×B', k });
      t += 210 + Math.random()*50;
      if (k < 2) {
        const b = 20 + Math.random()*30;
        tasks.push({ core, coreType:'AIC', type:'bubble', start: t, end: t + b });
        t += b;
      }
    }

    // Phase 4: COPY OUT
    tasks.push({ core, coreType:'AIC', type:'dma', start: t, end: t + 100, label:'COPY_OUT' });
    t += 110;

    // cores 7, 12, 18 get extra bubbles to simulate imbalance
    if ([7,12,18].includes(core)) {
      tasks.push({ core, coreType:'AIC', type:'bubble', start: t, end: t + 300, hotspot: true });
      t += 300;
    }
  }

  // AIV cores: Vector tasks
  for (let core = 0; core < AIV; core++) {
    let t = core * 10 + 50;

    // COPY_IN
    tasks.push({ core: AIC + core, coreType:'AIV', type:'dma', start: t, end: t + 80, label:'COPY_IN' });
    t += 90;

    // Vector ops
    const vOps = ['EXP','MULS','ADD','DIVS','SUB'];
    vOps.forEach((name, i) => {
      tasks.push({ core: AIC+core, coreType:'AIV', type:'vector', start: t, end: t + 150+Math.random()*80, label: name });
      t += 160 + Math.random()*80;
      if (i < vOps.length - 1) {
        const b = 10 + Math.random()*20;
        tasks.push({ core: AIC+core, coreType:'AIV', type:'bubble', start: t, end: t + b });
        t += b;
      }
    });

    // COPY_OUT
    tasks.push({ core: AIC+core, coreType:'AIV', type:'dma', start: t, end: t + 80, label:'COPY_OUT' });
  }

  // Find longest task end
  const maxT = tasks.reduce((m, t) => Math.max(m, t.end), 0);

  return { tasks, totalUs: Math.ceil(maxT / 100) * 100, AIC, AIV };
}

// ── Load Data ──────────────────────────────────────────────────
function loadDemoProfile() {
  SL.data = makeDemoProfile();
  SL.totalUs = SL.data.totalUs;
  initSwimlaneCanvas();
  renderSwimlane();
  updatePerfStats();
  document.getElementById('swimlane-placeholder').style.display = 'none';
  showToast('演示 profile 已载入', 'success');
}

function loadProfileData(data) {
  // Normalize external JSON format
  SL.data = data;
  SL.totalUs = data.totalUs || 5000;
  initSwimlaneCanvas();
  renderSwimlane();
  updatePerfStats();
  document.getElementById('swimlane-placeholder').style.display = 'none';
  showToast('Profile 数据已载入', 'success');
}

// ── Canvas Setup ───────────────────────────────────────────────
function initSwimlaneCanvas() {
  SL.canvas = document.getElementById('swimlane-canvas');
  if (!SL.canvas) return;
  SL.ctx = SL.canvas.getContext('2d');
  resizeSwimlaneCanvas();
  SL.canvas.addEventListener('mousemove', onSwimlaneMouseMove);
  SL.canvas.addEventListener('mouseleave', () => { SL.hovered = null; renderSwimlane(); hideTaskTooltip(); });
  SL.canvas.addEventListener('click', onSwimlaneClick);
  window.addEventListener('resize', resizeSwimlaneCanvas);
}

function resizeSwimlaneCanvas() {
  const canvas = SL.canvas || document.getElementById('swimlane-canvas');
  if (!canvas) return;
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  canvas.width  = rect.width  || 800;
  canvas.height = rect.height || 500;
  SL.canvas = canvas;
  SL.ctx = canvas.getContext('2d');
  if (SL.data) renderSwimlane();
}

// ── Render ─────────────────────────────────────────────────────
function renderSwimlane() {
  if (!SL.ctx || !SL.data) return;
  const ctx = SL.ctx;
  const { canvas } = SL;
  const { tasks, AIC, AIV } = SL.data;
  const totalCores = AIC + AIV;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const usPerPx = SL.totalUs / ((canvas.width - SL.offsetX) / SL.scale);

  // Draw AIC/AIV section headers
  const aicH = AIC * (SL.rowH + SL.padding);
  const aivH = AIV * (SL.rowH + SL.padding);

  // AIC section bg
  ctx.fillStyle = '#0d1929';
  ctx.fillRect(0, SL.headerH, canvas.width, aicH);

  // AIV section bg
  ctx.fillStyle = '#0a1f10';
  ctx.fillRect(0, SL.headerH + aicH, canvas.width, aivH);

  // Section labels
  ctx.fillStyle = '#1d3a5e';
  ctx.fillRect(0, SL.headerH, SL.offsetX, aicH);
  ctx.fillStyle = '#0a2a14';
  ctx.fillRect(0, SL.headerH + aicH, SL.offsetX, aivH);

  ctx.font = 'bold 9px SF Mono, Fira Code, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#3b82f6';
  ctx.save();
  ctx.translate(8, SL.headerH + aicH / 2);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('AIC', 0, 0);
  ctx.restore();

  ctx.fillStyle = '#10b981';
  ctx.save();
  ctx.translate(8, SL.headerH + aicH + aivH / 2);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('AIV', 0, 0);
  ctx.restore();

  // Column grid lines
  const gridStep = 500; // μs
  ctx.strokeStyle = '#1e2d3d';
  ctx.lineWidth = 1;
  for (let us = 0; us <= SL.totalUs; us += gridStep) {
    const x = SL.offsetX + (us / SL.totalUs) * (canvas.width - SL.offsetX) * SL.scale;
    ctx.beginPath();
    ctx.moveTo(x, SL.headerH);
    ctx.lineTo(x, SL.headerH + aicH + aivH);
    ctx.stroke();
  }

  // Row separators
  for (let c = 0; c <= totalCores; c++) {
    const y = SL.headerH + c * (SL.rowH + SL.padding);
    ctx.strokeStyle = c === AIC ? '#243447' : '#131d2a';
    ctx.lineWidth = c === AIC ? 1.5 : 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Draw tasks
  tasks.forEach(task => {
    drawTask(ctx, task, canvas.width);
  });

  // Core labels
  ctx.font = '9px SF Mono, Fira Code, monospace';
  ctx.textAlign = 'right';
  for (let c = 0; c < totalCores; c++) {
    const y = SL.headerH + c * (SL.rowH + SL.padding) + SL.rowH / 2 + 3;
    const isAIC = c < AIC;
    ctx.fillStyle = isAIC ? '#334155' : '#1f4a2a';
    ctx.fillText(isAIC ? `AIC.${c}` : `AIV.${c - AIC}`, SL.offsetX - 4, y);
  }

  // Header
  ctx.fillStyle = '#090e17';
  ctx.fillRect(0, 0, canvas.width, SL.headerH);
  ctx.strokeStyle = '#1e2d3d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, SL.headerH);
  ctx.lineTo(canvas.width, SL.headerH);
  ctx.stroke();

  // Time markers in header
  ctx.font = '9px SF Mono, Fira Code, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#475569';
  for (let us = 0; us <= SL.totalUs; us += gridStep) {
    const x = SL.offsetX + (us / SL.totalUs) * (canvas.width - SL.offsetX) * SL.scale;
    ctx.fillText(`${us}μs`, x, 18);
  }

  // Hover highlight
  if (SL.hovered) {
    const h = SL.hovered;
    const x = taskX(h, canvas.width);
    const w = taskW(h, canvas.width);
    const y = SL.headerH + h.core * (SL.rowH + SL.padding);
    ctx.strokeStyle = '#ffffff55';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y + 1, w, SL.rowH - 2);
  }
}

function drawTask(ctx, task, canvasWidth) {
  if (task.end <= task.start) return;

  const x = taskX(task, canvasWidth);
  const w = Math.max(taskW(task, canvasWidth), 1);
  const y = SL.headerH + task.core * (SL.rowH + SL.padding) + 1;
  const h = SL.rowH - 2;

  if (task.type === 'bubble') {
    // Bubble: hatched red pattern
    ctx.fillStyle = '#ef444418';
    ctx.fillRect(x, y, w, h);
    if (w > 4) {
      ctx.strokeStyle = '#ef444466';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
    // Diagonal hatch for wide bubbles
    if (w > 12 && SL.bubbleMode) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.strokeStyle = '#ef444444';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 4]);
      for (let i = -h; i < w + h; i += 6) {
        ctx.beginPath();
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i + h, y + h);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
    return;
  }

  const color = TASK_COLORS[task.type] || '#6b7280';
  const isHot = task.hotspot;

  // Fill
  ctx.fillStyle = color + (isHot ? 'cc' : '66');
  roundRect(ctx, x, y, w, h, 2);
  ctx.fill();

  // Border
  ctx.strokeStyle = color + (isHot ? 'ff' : '99');
  ctx.lineWidth = isHot ? 1.5 : 0.8;
  roundRect(ctx, x, y, w, h, 2);
  ctx.stroke();

  // Label (only if wide enough)
  if (w > 30 && task.label) {
    ctx.fillStyle = '#ffffffcc';
    ctx.font = `${w > 60 ? 9 : 8}px SF Mono, Fira Code, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(task.label, x + w/2, y + h/2 + 3);
  }
}

function taskX(task, canvasWidth) {
  return SL.offsetX + (task.start / SL.totalUs) * (canvasWidth - SL.offsetX) * SL.scale;
}
function taskW(task, canvasWidth) {
  return ((task.end - task.start) / SL.totalUs) * (canvasWidth - SL.offsetX) * SL.scale;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Mouse Interaction ──────────────────────────────────────────
function onSwimlaneMouseMove(e) {
  if (!SL.data || !SL.canvas) return;
  const rect = SL.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const hit = hitTest(mx, my);
  if (hit !== SL.hovered) {
    SL.hovered = hit;
    renderSwimlane();
  }
  if (hit) showTaskTooltip(hit, e.clientX, e.clientY);
  else hideTaskTooltip();
}

function onSwimlaneClick(e) {
  if (!SL.hovered) return;
  const task = SL.hovered;
  if (task.type === 'bubble') {
    showToast(`Bubble 选中：Core ${task.core}，时长 ${Math.round(task.end-task.start)}μs`, 'info');
  }
}

function hitTest(mx, my) {
  if (!SL.data) return null;
  const { tasks } = SL.data;
  for (let i = tasks.length - 1; i >= 0; i--) {
    const task = tasks[i];
    const x = taskX(task, SL.canvas.width);
    const w = taskW(task, SL.canvas.width);
    const y = SL.headerH + task.core * (SL.rowH + SL.padding) + 1;
    const h = SL.rowH - 2;
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) return task;
  }
  return null;
}

function showTaskTooltip(task, cx, cy) {
  const tip = document.getElementById('task-tooltip');
  if (!tip) return;
  const duration = Math.round(task.end - task.start);
  const typeLabel = task.type === 'bubble' ? '⚠ Bubble (idle)' : task.label || task.type;
  const coreLabel = task.coreType + '.' + (task.core < (SL.data?.AIC||24) ? task.core : task.core - (SL.data?.AIC||24));
  tip.innerHTML = `
    <div style="font-weight:700;color:${task.type==='bubble'?'#ef4444':TASK_COLORS[task.type]||'#94a3b8'};margin-bottom:4px;">${typeLabel}</div>
    <div>Core: <span style="color:#e2e8f0">${coreLabel}</span></div>
    <div>Start: <span style="color:#e2e8f0">${Math.round(task.start)} μs</span></div>
    <div>End: <span style="color:#e2e8f0">${Math.round(task.end)} μs</span></div>
    <div>Duration: <span style="color:${duration>200?'#f97316':'#10b981'};font-weight:700">${duration} μs</span></div>
    ${task.hotspot ? '<div style="color:#ef4444;margin-top:4px">⚠ 热点任务</div>' : ''}
  `;
  const container = tip.closest('.panel-body') || document.body;
  const containerRect = container.getBoundingClientRect();
  const tipWidth = 180, tipHeight = 120;
  let left = cx - containerRect.left + 12;
  let top  = cy - containerRect.top  + 12;
  if (left + tipWidth > containerRect.width) left = cx - containerRect.left - tipWidth - 12;
  if (top + tipHeight > containerRect.height) top = cy - containerRect.top - tipHeight - 12;
  tip.style.left = left + 'px';
  tip.style.top  = top  + 'px';
  tip.classList.remove('hidden');
}

function hideTaskTooltip() {
  const tip = document.getElementById('task-tooltip');
  if (tip) tip.classList.add('hidden');
}

// ── Zoom / Reset ───────────────────────────────────────────────
function zoomSwimlane(factor) {
  SL.scale = Math.max(0.5, Math.min(8, SL.scale * factor));
  renderSwimlane();
}
function resetSwimlane() {
  SL.scale = 1;
  renderSwimlane();
}

// ── Perf Stats ─────────────────────────────────────────────────
function updatePerfStats() {
  if (!SL.data) return;
  const { tasks, AIC, AIV } = SL.data;

  const realTasks   = tasks.filter(t => t.type !== 'bubble');
  const bubbleTasks = tasks.filter(t => t.type === 'bubble');

  const totalTime   = realTasks.reduce((s, t) => s + (t.end - t.start), 0);
  const bubbleTime  = bubbleTasks.reduce((s, t) => s + (t.end - t.start), 0);
  const allTime     = totalTime + bubbleTime;
  const utilPct     = allTime > 0 ? ((totalTime / allTime) * 100).toFixed(1) : '—';
  const bubblePct   = allTime > 0 ? ((bubbleTime / allTime) * 100).toFixed(1) : '—';

  const longest = tasks.reduce((m, t) => Math.max(m, t.end - t.start), 0);

  // Core-level totals for variance
  const coreTotals = {};
  tasks.forEach(t => {
    if (t.type !== 'bubble') coreTotals[t.core] = (coreTotals[t.core]||0) + (t.end-t.start);
  });
  const vals = Object.values(coreTotals);
  const mean = vals.reduce((s,v)=>s+v,0) / (vals.length || 1);
  const variance = Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0) / (vals.length||1));

  const el = id => document.getElementById(id);
  if (el('st-util')) el('st-util').textContent = utilPct + '%';
  if (el('st-bubble')) { el('st-bubble').textContent = bubblePct + '%'; el('st-bubble').style.color = parseFloat(bubblePct)>20?'#ef4444':'#f59e0b'; }
  if (el('st-longest')) el('st-longest').textContent = Math.round(longest) + 'μs';
  if (el('st-variance')) el('st-variance').textContent = Math.round(variance) + 'μs';
}

function id(s) { return document.getElementById(s); }

// ── AI Perf Analysis ───────────────────────────────────────────
function analyzePerf() {
  if (!SL.data) {
    showToast('请先载入 Profile 数据', 'info');
    return;
  }

  document.getElementById('opt-list').innerHTML = '<div class="ai-thinking">AI 正在分析性能瓶颈...</div>';

  setTimeout(() => {
    renderOptRecommendations();
    const chat = document.getElementById('swimlane-chat');
    appendMsg(chat, 'ai', '分析完成。发现 3 个主要性能问题：\n\n1. AIC 核 #7、#12、#18 存在大量 bubble（>300μs），原因是上游 DMA 延迟过高\n2. L1→L0A 搬移占关键路径 23%，建议使用 L1 reuse\n3. AIV/AIC 任务分布不均，部分核利用率仅 40%');
  }, 1200);
}

const OPT_RECOMMENDATIONS = [
  {
    title: '增大 CubeNBuffer 消除 Bubble',
    impact: 'high',
    gain: '+18% 吞吐',
    desc: 'AIC 核 #7、#12、#18 等待 DMA 完成时产生大量 bubble。增大 CubeNBuffer 可以让 Cube 和 DMA 流水并行，填充等待间隙。',
    code: `# 在算子配置中增大 CubeNBuffer\n@pypto.op_config(\n    CubeNBuffer=4,  # 原为 2\n    submit_before_loop=True\n)\ndef kernel(...):\n    ...`,
  },
  {
    title: 'L1 Reuse 减少重复搬移',
    impact: 'high',
    gain: '+12% 带宽',
    desc: 'A 矩阵在多次 GEMM 迭代中被重复从 DDR 搬入 L1。固定 A 矩阵在 L1，只迭代 B 矩阵可节省 66% DMA 带宽。',
    code: `# 使用 L1 reuse 固定 A 矩阵\na_l1 = TILE_COPY_IN(a_mat)  # 搬入一次\nfor n in range(N // N_TILE):\n    b_l1 = TILE_COPY_IN(b_mat[:, n*N_TILE:(n+1)*N_TILE])\n    TILE_A_MUL_B(a_l1, b_l1, c_l0c)`,
  },
  {
    title: '调整 Tiling 均衡负载',
    impact: 'medium',
    gain: '+8% 利用率',
    desc: '当前 tiling 导致部分核任务过多，部分核利用率低于 50%。调整 M_TILE/N_TILE 使任务数为核数整数倍。',
    code: `# 调整 tiling 使 task 均匀分配\n# 当前: M=512, N=512, M_TILE=64 → 8 tiles\n# 优化: M_TILE=32 → 16 tiles (更细粒度)\nM_TILE = 32  # 原为 64\nN_TILE = 32  # 原为 64`,
  },
  {
    title: '开启 loop_unroll 提升 Cube 效率',
    impact: 'medium',
    gain: '+10% GEMM',
    desc: '在精度要求不严格的情况下，开启 loop unroll 可让编译器生成更优的 Cube pipeline 调度，减少流水气泡。',
    code: `# 精度允许时开启 unroll\n@pypto.op_config(\n    unroll_list=[4],  # 展开 4 次\n    # submit_before_loop=False  # 关闭强制提交\n)\ndef kernel(...):\n    ...`,
  },
  {
    title: 'L2 Affinity 调度优化',
    impact: 'low',
    gain: '+5% 带宽',
    desc: '将频繁交互的 AIC/AIV 核绑定到同一 L2 Cluster，减少跨 cluster 数据传输延迟。',
    code: `# 在任务调度配置中设置 L2 affinity\npypto.set_affinity(\n    aic_cluster=0,\n    aiv_cluster=0,  # 同一 cluster\n)`,
  },
];

function renderOptRecommendations() {
  const list = document.getElementById('opt-list');
  if (!list) return;

  // Overall score badge
  const badge = document.getElementById('opt-score-badge');
  if (badge) { badge.textContent = '⭐⭐⭐ 3/5'; badge.style.color = '#f59e0b'; }

  list.innerHTML = OPT_RECOMMENDATIONS.map((opt, i) => `
    <div class="opt-card" id="opt-card-${i}">
      <div class="opt-card-header" onclick="toggleOptCard(${i})">
        <span class="opt-impact impact-${opt.impact}">${opt.impact.toUpperCase()}</span>
        <span class="opt-title">${opt.title}</span>
        <span class="opt-gain">${opt.gain}</span>
        <span style="color:var(--text-muted);font-size:10px;">▼</span>
      </div>
      <div class="opt-card-body">
        <p>${opt.desc}</p>
        <div class="opt-code-block">${escHtml(opt.code)}</div>
        <button class="opt-apply-btn" onclick="applyOptimization(${i})">✓ 应用此优化</button>
      </div>
    </div>
  `).join('');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toggleOptCard(i) {
  const card = document.getElementById('opt-card-' + i);
  if (card) card.classList.toggle('expanded');
}

function applyOptimization(i) {
  const opt = OPT_RECOMMENDATIONS[i];
  try { navigator.clipboard.writeText(opt.code); } catch(e) {}
  showToast(`已复制优化代码: ${opt.title}`, 'success');
  const chat = document.getElementById('swimlane-chat');
  appendMsg(chat, 'ai', `已应用优化策略「${opt.title}」。预期收益：${opt.gain}。\n\n请在应用后重新 profile 验证实际提升效果。`);
}

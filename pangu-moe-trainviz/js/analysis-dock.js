const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[ch]));

function readCssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '').trim();
  const value = parseInt(clean.length === 3 ? clean.split('').map(ch => ch + ch).join('') : clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixColor(a, b, t) {
  const ar = hexToRgb(a), br = hexToRgb(b);
  return `rgb(${Math.round(ar[0] + (br[0] - ar[0]) * t)},${Math.round(ar[1] + (br[1] - ar[1]) * t)},${Math.round(ar[2] + (br[2] - ar[2]) * t)})`;
}

function loadColor(value, maxValue = 1.35) {
  const theme = document.documentElement.dataset.theme || 'dark';
  const low = theme === 'light' ? '#e7edf4' : '#222a35';
  const normal = theme === 'light' ? '#7fcbd3' : '#1fb8cc';
  const high = theme === 'light' ? '#e8ce69' : '#d6aa35';
  const hot = theme === 'light' ? '#d775aa' : '#c95ba8';
  if (value <= 0) return low;
  const x = Math.max(0, Math.min(maxValue, value));
  if (x < 0.72) return mixColor(low, normal, x / 0.72);
  if (x < 1) return mixColor(normal, high, (x - 0.72) / 0.28);
  return mixColor(high, hot, (x - 1) / Math.max(0.01, maxValue - 1));
}

function tokenColor(tokenName, fallback) {
  const raw = readCssVar(tokenName, fallback);
  if (raw.startsWith('#')) return raw;
  return fallback;
}

function makeStatGrid(stats) {
  return `<div class="opv-analysis-stats">${stats.map(stat => `
    <div class="opv-analysis-stat">
      <span>${esc(stat.label)}</span>
      <b>${esc(stat.value)}</b>
    </div>
  `).join('')}</div>`;
}

function makeTooltip(parent) {
  const tip = document.createElement('div');
  tip.className = 'opv-analysis-tooltip';
  tip.hidden = true;
  parent.appendChild(tip);
  return {
    show(event, html) {
      tip.innerHTML = html;
      tip.hidden = false;
      const bounds = parent.getBoundingClientRect();
      const x = Math.min(bounds.width - 220, Math.max(8, event.clientX - bounds.left + 12));
      const y = Math.min(bounds.height - 130, Math.max(8, event.clientY - bounds.top + 12));
      tip.style.transform = `translate(${x}px, ${y}px)`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

function resizeCanvas(canvas, width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function createAnalysisDock({ tabsRoot, titleEl, metaEl, views, initialView = 'timeline', onViewChange }) {
  const viewMap = new Map(views.map(view => [view.id, view]));
  const tabs = new Map();
  let activeView = viewMap.has(initialView) ? initialView : views[0]?.id;

  tabsRoot.innerHTML = '';
  views.forEach(view => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'opv-analysis-tab';
    tab.dataset.analysisTab = view.id;
    tab.textContent = view.label;
    tab.addEventListener('click', () => setActiveView(view.id));
    tabsRoot.appendChild(tab);
    tabs.set(view.id, tab);
    view.panel.hidden = true;
    view.mount?.();
  });

  function setActiveView(id) {
    const next = viewMap.has(id) ? id : views[0]?.id;
    if (!next) return;
    activeView = next;
    views.forEach(view => {
      const active = view.id === activeView;
      view.panel.hidden = !active;
      tabs.get(view.id)?.classList.toggle('is-active', active);
      tabs.get(view.id)?.setAttribute('aria-pressed', String(active));
    });
    const view = viewMap.get(activeView);
    titleEl.textContent = view.title || view.label;
    metaEl.textContent = typeof view.meta === 'function' ? view.meta() : (view.meta || '');
    localStorage.setItem('op-rank-time-analysis-view', activeView);
    requestAnimationFrame(() => view.render?.());
    onViewChange?.(activeView);
  }

  function refresh() {
    viewMap.get(activeView)?.render?.();
  }

  function resize() {
    viewMap.get(activeView)?.resize?.();
  }

  setActiveView(activeView);
  return { setActiveView, refresh, resize, get activeView() { return activeView; } };
}

export function createMoeLoadView({ panel, viewModel, onSelect, distribution }) {
  let metricId = viewModel.metricOptions[0]?.id || 'loadRatio';
  let canvas;
  let detail;
  let tooltip;
  let hoverCell = null;
  let selectedCell = null;
  let mode = 'heatmap';   // 'heatmap' | 'distribution'（distribution 仅在传入 distribution 时可用）
  let distCanvas, distTip, distTipEl;
  let distCursor = null;  // distribution 图当前游标 step（跟随鼠标的竖线）
  // 自定义气泡定位：用气泡真实尺寸钳制在容器内，避免溢出屏幕
  function showDistTip(event, html) {
    if (!distTipEl) return;
    distTipEl.innerHTML = html;
    distTipEl.hidden = false;
    const parent = distTipEl.parentElement;
    const pb = parent.getBoundingClientRect();
    const tw = distTipEl.offsetWidth, th = distTipEl.offsetHeight;
    let x = event.clientX - pb.left + 14;
    let y = event.clientY - pb.top + 14;
    if (x + tw > pb.width - 4) x = event.clientX - pb.left - tw - 14;  // 翻到鼠标左侧
    if (x < 4) x = 4;
    if (y + th > pb.height - 4) y = pb.height - th - 4;
    if (y < 4) y = 4;
    distTipEl.style.transform = `translate(${x}px, ${y}px)`;
  }

  function distColor(e, hot, dead) {
    const theme = document.documentElement.dataset.theme || 'dark';
    if (hot && hot.length) {
      if (e === hot[0]) return '#ef4444';
      if (e === hot[1]) return '#f97316';
    }
    if (dead && dead.includes(e)) return theme === 'light' ? '#b6bcc6' : '#5b6473';  // 死专家：灰色
    const hue = (e * 47) % 360;
    return `hsl(${hue}, ${theme === 'light' ? 40 : 34}%, ${theme === 'light' ? 62 : 46}%)`;
  }
  function drawDistribution() {
    if (!distribution || !distCanvas || panel.hidden) return;
    const wrap = panel.querySelector('[data-moe-dist-wrap]');
    if (!wrap || wrap.hidden) return;
    const bounds = wrap.getBoundingClientRect();
    const width = Math.max(460, bounds.width - 4);
    const height = Math.max(200, bounds.height - 4);
    const ctx = resizeCanvas(distCanvas, width, height);
    const { steps, experts, series, hot = [], dead = [], collapseStep } = distribution;
    const n = steps.length;
    const padL = 44, padR = 12, padT = 14, padB = 26;
    const plotW = width - padL - padR, plotH = height - padT - padB;
    const x0 = steps[0], x1 = steps[n - 1];
    const mapX = s => padL + (s - x0) / (x1 - x0 || 1) * plotW;
    const mapY = v => padT + (1 - v) * plotH;   // v: 累计占比 0..1
    ctx.clearRect(0, 0, width, height);
    const cum = new Array(n).fill(0);
    for (let e = 0; e < experts; e++) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const x = mapX(steps[i]), y = mapY(cum[i] + series[e][i]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(mapX(steps[i]), mapY(cum[i]));
      ctx.closePath();
      ctx.fillStyle = distColor(e, hot, dead);
      ctx.fill();
      for (let i = 0; i < n; i++) cum[i] += series[e][i];
    }
    if (collapseStep != null) {
      const cx = mapX(collapseStep);
      ctx.strokeStyle = readCssVar('--danger', '#ef4444');
      ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = readCssVar('--danger', '#ef4444');
      ctx.font = '700 10px PingFang SC, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('路由坍缩', cx + 4, padT + 2);
    }
    ctx.fillStyle = readCssVar('--foreground-muted', 'rgba(255,255,255,0.45)');
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    [0, 0.5, 1].forEach(p => ctx.fillText(Math.round(p * 100) + '%', padL - 6, mapY(p)));
    ctx.textBaseline = 'top';
    [x0, Math.round((x0 + x1) / 2), x1].forEach((s, idx) => { ctx.textAlign = idx === 0 ? 'left' : idx === 2 ? 'right' : 'center'; ctx.fillText(String(s), mapX(s), padT + plotH + 6); });
    // 跟随鼠标的游标竖线 + step 标签
    if (distCursor != null) {
      const cx = mapX(distCursor);
      ctx.strokeStyle = readCssVar('--foreground-secondary', 'rgba(255,255,255,0.6)');
      ctx.setLineDash([]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + plotH); ctx.stroke();
      const label = 'Step ' + distCursor;
      ctx.font = '10px JetBrains Mono, monospace';
      const tw = ctx.measureText(label).width + 10;
      const chipX = Math.min(Math.max(cx - tw / 2, padL), padL + plotW - tw);
      ctx.fillStyle = readCssVar('--surface-4', '#2a2c33');
      ctx.strokeStyle = readCssVar('--border-strong', 'rgba(255,255,255,0.3)');
      ctx.fillRect(chipX, padT - 1, tw, 14); ctx.strokeRect(chipX, padT - 1, tw, 14);
      ctx.fillStyle = readCssVar('--foreground', '#fff');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, chipX + tw / 2, padT + 6);
    }
  }
  function onDistMove(event) {
    if (!distribution) return;
    const rect = distCanvas.getBoundingClientRect();
    const { steps, experts, series, hot = [], dead = [] } = distribution;
    const n = steps.length;
    const padL = 44, padR = 12, padT = 14, padB = 26;
    const plotW = rect.width - padL - padR, plotH = rect.height - padT - padB;
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < padL || x > rect.width - padR || y < padT || y > padT + plotH) { distCursor = null; drawDistribution(); if (distTipEl) distTipEl.hidden = true; return; }
    const i = Math.max(0, Math.min(n - 1, Math.round((x - padL) / plotW * (n - 1))));
    distCursor = steps[i];
    drawDistribution();   // 重绘以更新游标竖线
    // 当前 y 命中的专家（高亮显示），气泡列出全部专家占比
    const shareAtY = 1 - (y - padT) / plotH;
    let cum = 0, hitE = -1;
    for (let e = 0; e < experts; e++) { if (shareAtY >= cum && shareAtY < cum + series[e][i]) { hitE = e; break; } cum += series[e][i]; }
    const order = Array.from({ length: experts }, (_, e) => e).sort((a, b) => series[b][i] - series[a][i]);
    const rows = order.map(e => {
      const hl = e === hitE ? ' style="font-weight:800;color:var(--foreground)"' : '';
      return `<span${hl}><i style="background:${distColor(e, hot, dead)}"></i>E${e} ${(series[e][i] * 100).toFixed(1)}%</span>`;
    }).join('');
    showDistTip(event, `<b>Step ${steps[i]} · ${experts} 专家 token 占比</b><div class="opv-dist-tip-grid">${rows}</div>`);
  }

  function metric() {
    return viewModel.metricOptions.find(item => item.id === metricId) || viewModel.metricOptions[0];
  }

  function cellAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const left = 56;
    const top = 12;
    const rightPad = 10;
    const bottomPad = 22;
    const gridW = Math.max(1, rect.width - left - rightPad);
    const gridH = Math.max(1, rect.height - top - bottomPad);
    if (x < left || x > left + gridW || y < top || y > top + gridH) return null;
    const row = Math.min(viewModel.metrics.layerCount - 1, Math.max(0, Math.floor((y - top) / gridH * viewModel.metrics.layerCount)));
    const expertId = Math.min(viewModel.metrics.expertsPerLayer - 1, Math.max(0, Math.floor((x - left) / gridW * viewModel.metrics.expertsPerLayer)));
    return { row, layer: viewModel.metrics.firstMoeLayer + row, expertId };
  }

  function cellValue(cell) {
    return metric().array[cell.row * viewModel.metrics.expertsPerLayer + cell.expertId] || 0;
  }

  function renderDetail() {
    if (!detail) return;
    const layer = selectedCell ? viewModel.metrics.layers[selectedCell.row] : viewModel.metrics.layers.reduce((best, item) => item.maxLoadRatio > best.maxLoadRatio ? item : best, viewModel.metrics.layers[0]);
    if (!layer) {
      detail.innerHTML = '';
      return;
    }
    const title = selectedCell ? `L${selectedCell.layer} · expert ${selectedCell.expertId}` : `Worst layer · L${layer.layer}`;
    const value = selectedCell ? cellValue(selectedCell) : layer.maxLoadRatio;
    detail.innerHTML = `
      <div class="opv-analysis-detail-title">${esc(title)}</div>
      <div class="opv-analysis-detail-grid">
        <span>metric</span><b>${esc(metric().label)} ${Number(value).toFixed(metricId === 'loadRatio' ? 2 : 0)}${metricId === 'loadRatio' ? 'x' : ''}</b>
        <span>avg load</span><b>${layer.avgLoadRatio.toFixed(2)}x</b>
        <span>p95 load</span><b>${layer.p95LoadRatio.toFixed(2)}x</b>
        <span>overload</span><b>${layer.overloadedExperts} experts</b>
        <span>idle</span><b>${layer.idleExperts} experts</b>
        <span>A2A skew</span><b>${layer.allToAllSkew.toFixed(2)}x</b>
      </div>`;
  }

  function draw() {
    if (!canvas || panel.hidden) return;
    const bounds = panel.getBoundingClientRect();
    const width = Math.max(460, bounds.width - 24);
    const left = 56;
    const top = 12;
    const rightPad = 10;
    const bottomPad = 22;
    const gridW = width - left - rightPad;
    const layerCount = viewModel.metrics.layerCount;
    const experts = viewModel.metrics.expertsPerLayer;
    // 正方形格子：边长由列宽决定，行高跟随列宽，整体高度不随窗口高度拉伸
    const colW = gridW / experts;
    const rowH = colW;
    const gridH = rowH * layerCount;
    const height = top + gridH + bottomPad;
    const ctx = resizeCanvas(canvas, width, height);
    const option = metric();
    const values = option.array;
    const maxValue = metricId === 'loadRatio' ? 1.35 : Math.max(1, ...values);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '600 10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = readCssVar('--foreground-secondary', 'rgba(255,255,255,0.62)');

    for (let row = 0; row < layerCount; row++) {
      const y = top + row * rowH;
      const layer = viewModel.metrics.firstMoeLayer + row;
      if (row % 4 === 0 || row === layerCount - 1) ctx.fillText(`L${layer}`, left - 8, y + rowH * 0.5);
      for (let expertId = 0; expertId < experts; expertId++) {
        const index = row * experts + expertId;
        const raw = values[index] || 0;
        const normalized = metricId === 'loadRatio' ? raw : raw / maxValue * 1.35;
        ctx.fillStyle = loadColor(normalized);
        ctx.fillRect(left + expertId * colW, y, Math.max(1, colW + 0.25), Math.max(1, rowH + 0.25));
      }
    }

    ctx.strokeStyle = readCssVar('--border-default', 'rgba(255,255,255,0.12)');
    ctx.strokeRect(left, top, gridW, gridH);
    ctx.textAlign = 'center';
    ctx.fillStyle = readCssVar('--foreground-muted', 'rgba(255,255,255,0.45)');
    [0, 64, 128, 192, 255].forEach(expertId => {
      const x = left + gridW * expertId / Math.max(1, experts - 1);
      ctx.fillText(`E${expertId}`, x, height - 9);
    });

    const outline = cell => {
      if (!cell) return;
      ctx.strokeStyle = tokenColor('--primary', '#4369ef');
      ctx.lineWidth = cell === selectedCell ? 2 : 1.2;
      ctx.strokeRect(left + cell.expertId * colW, top + cell.row * rowH, Math.max(5, colW), Math.max(5, rowH));
    };
    outline(hoverCell);
    outline(selectedCell);
    renderDetail();
  }

  function mount() {
    panel.innerHTML = `
      <div class="opv-analysis-view">
        ${makeStatGrid(viewModel.stats)}
        <div class="opv-analysis-controls" data-metric-tabs></div>
        <div class="opv-analysis-grid-wrap" data-moe-heat-wrap>
          <canvas class="opv-moe-heatmap" aria-label="MoE expert load heatmap"></canvas>
          <aside class="opv-analysis-detail"></aside>
        </div>
        ${distribution ? '<div class="opv-moe-dist-wrap" data-moe-dist-wrap hidden><canvas class="opv-moe-dist" aria-label="专家 token 占比面积堆叠图"></canvas></div>' : ''}
      </div>`;
    canvas = panel.querySelector('.opv-moe-heatmap');
    detail = panel.querySelector('.opv-analysis-detail');
    tooltip = makeTooltip(panel);
    const heatWrap = panel.querySelector('[data-moe-heat-wrap]');
    const distWrap = panel.querySelector('[data-moe-dist-wrap]');
    const metricTabs = panel.querySelector('[data-metric-tabs]');
    const chips = [];
    viewModel.metricOptions.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opv-analysis-chip';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        metricId = item.id; mode = 'heatmap';
        chips.forEach(c => c.classList.toggle('is-active', c === btn));
        if (heatWrap) heatWrap.hidden = false;
        if (distWrap) distWrap.hidden = true;
        draw();
      });
      if (item.id === metricId && mode === 'heatmap') btn.classList.add('is-active');
      metricTabs.appendChild(btn); chips.push(btn);
    });
    if (distribution) {
      const dbtn = document.createElement('button');
      dbtn.type = 'button';
      dbtn.className = 'opv-analysis-chip';
      dbtn.textContent = 'Distribution';
      dbtn.addEventListener('click', () => {
        mode = 'distribution';
        chips.forEach(c => c.classList.toggle('is-active', c === dbtn));
        if (heatWrap) heatWrap.hidden = true;
        if (distWrap) distWrap.hidden = false;
        drawDistribution();
      });
      if (mode === 'distribution') dbtn.classList.add('is-active');
      metricTabs.appendChild(dbtn); chips.push(dbtn);
      distCanvas = panel.querySelector('.opv-moe-dist');
      distTip = makeTooltip(distWrap);
      distTipEl = distWrap.querySelector('.opv-analysis-tooltip');
      if (distTipEl) distTipEl.classList.add('opv-dist-tip');
      distCanvas.addEventListener('pointermove', onDistMove);
      distCanvas.addEventListener('pointerleave', () => { distCursor = null; drawDistribution(); if (distTipEl) distTipEl.hidden = true; });
      // 还原当前模式可见性（setViewModel 重挂载后保持在 Distribution）
      if (mode === 'distribution') { if (heatWrap) heatWrap.hidden = true; distWrap.hidden = false; }
    }
    canvas.addEventListener('pointermove', event => {
      hoverCell = cellAt(event);
      if (!hoverCell) {
        tooltip.hide();
        draw();
        return;
      }
      const layer = viewModel.metrics.layers[hoverCell.row];
      const value = cellValue(hoverCell);
      tooltip.show(event, `
        <b>L${hoverCell.layer} · Expert ${hoverCell.expertId}</b>
        <span>${esc(metric().label)}: ${Number(value).toFixed(metricId === 'loadRatio' ? 2 : 0)} ${esc(metric().unit)}</span>
        <span>Layer avg: ${layer.avgLoadRatio.toFixed(2)}x · p95: ${layer.p95LoadRatio.toFixed(2)}x</span>
      `);
      draw();
    });
    canvas.addEventListener('pointerleave', () => {
      hoverCell = null;
      tooltip.hide();
      draw();
    });
    canvas.addEventListener('click', event => {
      const cell = cellAt(event);
      if (!cell) return;
      selectedCell = cell;
      onSelect?.({ type: 'expert', layer: cell.layer, expertId: cell.expertId, metricId, value: cellValue(cell) });
      draw();
    });
  }

  function renderByMode() { mode === 'distribution' ? drawDistribution() : draw(); }
  function setViewModel(next) { viewModel = next; selectedCell = null; hoverCell = null; mount(); renderByMode(); }

  return { panel, mount, render: renderByMode, resize: renderByMode, setViewModel };
}

const CARDLOAD_STATE_LABEL = { ok: '正常', warn: '过载', alert: '饥饿' };

export function createCardLoadView({ panel, viewModel, onSelect }) {
  let tooltip;
  let grid;
  const pct = v => Math.round((v || 0) * 100);

  function paintCards() {
    if (!grid) return;
    grid.style.setProperty('--card-cols', String(Math.ceil(viewModel.cards.length / 2) || 8));
    grid.innerHTML = viewModel.cards.map(card => {
      const state = card.state === 'alert' ? ' is-alert' : card.state === 'warn' ? ' is-warn' : '';
      const heat = Math.round(4 + card.utilRatio * 14);            // 4–18% 低饱和平涂
      const flow = Math.max(4, pct(card.commRatio));
      return `<button class="opv-cardload-cell${state}" type="button" data-card-id="${card.cardId}" style="--heat-soft:${heat}%;--flow:${flow}%">`
        + `<div class="cl-top"><b>R${card.cardId}</b><span>D${card.dp}P${card.stage}T${card.tp}</span></div>`
        + `<div class="cl-meter"><i></i></div>`
        + `<div class="cl-bot"><span>u${pct(card.utilRatio)}</span><span>c${pct(card.commRatio)}</span></div>`
        + `</button>`;
    }).join('');
    grid.querySelectorAll('[data-card-id]').forEach(el => {
      const card = viewModel.cards.find(item => String(item.cardId) === el.dataset.cardId);
      el.addEventListener('pointermove', event => tooltip.show(event, `
        <b>Card / Rank ${card.cardId}</b>
        <span>D${card.dp} · P${card.stage} · TP${card.tp}</span>
        <span>util ${pct(card.utilRatio)}% · comm ${pct(card.commRatio)}% · ${CARDLOAD_STATE_LABEL[card.state]}</span>
      `));
      el.addEventListener('pointerleave', () => tooltip.hide());
      el.addEventListener('click', () => onSelect?.({ type: 'card', rank: card.cardId, dp: card.dp, stage: card.stage, tp: card.tp }));
    });
  }

  return {
    panel,
    mount() {
      panel.innerHTML = `
        <div class="opv-analysis-view opv-cardload">
          <div class="opv-cardload-head">
            ${makeStatGrid(viewModel.stats)}
            <button class="opv-cardload-info" type="button" aria-label="占用率规则" title="占用率规则">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="4.6" r="1" fill="currentColor"/><rect x="7.2" y="6.8" width="1.6" height="5.2" rx="0.8" fill="currentColor"/></svg>
            </button>
            <div class="opv-cardload-pop" hidden>
              <h4>卡占用率怎么算</h4>
              <p><code>util = Σ compute_us / iter_wall_us</code> · 每个训练 step 聚合一次</p>
              <p>采样粒度 <b>1 值 / 卡 / step</b>，随播放条走；跨过路由坍缩点占用会重分布。</p>
              <ul><li>底色浓淡 = util 占用</li><li>下方 meter = comm 通信占比</li></ul>
              <div class="opv-cardload-legend">
                <span class="ok">正常</span><span class="warn">过载 util&gt;95% / comm&gt;50%</span><span class="alert">饥饿 util&lt;30%</span>
              </div>
            </div>
          </div>
          <div class="opv-analysis-scroll"><div class="opv-cardload-grid"></div></div>
        </div>`;
      tooltip = makeTooltip(panel);
      grid = panel.querySelector('.opv-cardload-grid');
      const infoBtn = panel.querySelector('.opv-cardload-info');
      const pop = panel.querySelector('.opv-cardload-pop');
      infoBtn.addEventListener('click', event => {
        event.stopPropagation();
        pop.hidden = !pop.hidden;
        if (!pop.hidden) {
          const cleanup = () => { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
          const onDoc = e => { if (!pop.contains(e.target) && e.target !== infoBtn) { pop.hidden = true; cleanup(); } };
          const onKey = e => { if (e.key === 'Escape') { pop.hidden = true; cleanup(); } };
          setTimeout(() => { document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey); }, 0);
        }
      });
      paintCards();
    },
    render: paintCards,
    resize() {},
    setViewModel(next) { viewModel = next; if (!panel.hidden) paintCards(); },
  };
}

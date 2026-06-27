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

export function createMoeLoadView({ panel, viewModel, onSelect }) {
  let metricId = viewModel.metricOptions[0]?.id || 'loadRatio';
  let canvas;
  let detail;
  let tooltip;
  let hoverCell = null;
  let selectedCell = null;

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
    const height = Math.max(220, bounds.height - 92);
    const ctx = resizeCanvas(canvas, width, height);
    const left = 56;
    const top = 12;
    const rightPad = 10;
    const bottomPad = 22;
    const gridW = width - left - rightPad;
    const gridH = height - top - bottomPad;
    const layerCount = viewModel.metrics.layerCount;
    const experts = viewModel.metrics.expertsPerLayer;
    const rowH = gridH / layerCount;
    const colW = gridW / experts;
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
        <div class="opv-analysis-grid-wrap">
          <canvas class="opv-moe-heatmap" aria-label="MoE expert load heatmap"></canvas>
          <aside class="opv-analysis-detail"></aside>
        </div>
      </div>`;
    canvas = panel.querySelector('canvas');
    detail = panel.querySelector('.opv-analysis-detail');
    tooltip = makeTooltip(panel);
    const metricTabs = panel.querySelector('[data-metric-tabs]');
    viewModel.metricOptions.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opv-analysis-chip';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        metricId = item.id;
        metricTabs.querySelectorAll('button').forEach(tab => tab.classList.toggle('is-active', tab === btn));
        draw();
      });
      if (item.id === metricId) btn.classList.add('is-active');
      metricTabs.appendChild(btn);
    });
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

  function setViewModel(next) { viewModel = next; selectedCell = null; hoverCell = null; mount(); draw(); }

  return { panel, mount, render: draw, resize: draw, setViewModel };
}

function createStackedBarRows({ panel, rows, titleForRow, onSelect }) {
  let canvas;
  let tooltip;
  let hover = null;

  function rowAt(event) {
    const rect = canvas.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const top = 10;
    const rowH = 24;
    const index = Math.floor((y - top) / rowH);
    return index >= 0 && index < rows.length ? rows[index] : null;
  }

  function draw() {
    if (!canvas || panel.hidden) return;
    const bounds = panel.getBoundingClientRect();
    const width = Math.max(420, bounds.width - 24);
    const height = Math.max(220, rows.length * 24 + 22);
    const ctx = resizeCanvas(canvas, width, height);
    const left = 112;
    const right = 16;
    const top = 10;
    const rowH = 24;
    const barW = width - left - right;
    ctx.clearRect(0, 0, width, height);
    ctx.font = '600 10px JetBrains Mono, monospace';
    ctx.textBaseline = 'middle';
    rows.forEach((row, index) => {
      const y = top + index * rowH;
      const active = hover === row;
      ctx.fillStyle = active ? readCssVar('--state-hover', 'rgba(255,255,255,0.08)') : 'transparent';
      ctx.fillRect(0, y, width, rowH);
      ctx.fillStyle = readCssVar('--foreground-secondary', 'rgba(255,255,255,0.65)');
      ctx.textAlign = 'left';
      ctx.fillText(titleForRow(row), 8, y + rowH * 0.5);
      let x = left;
      const computeW = Math.max(1, row.utilRatio * barW);
      const commW = Math.max(1, row.commRatio * barW);
      const bubbleW = Math.max(1, row.bubbleRatio * barW);
      ctx.fillStyle = '#7fcbd3';
      ctx.fillRect(x, y + 6, computeW, 12);
      x += computeW;
      ctx.fillStyle = '#b99ae7';
      ctx.fillRect(x, y + 6, commW, 12);
      x += commW;
      ctx.fillStyle = '#d6dbe3';
      ctx.fillRect(x, y + 6, bubbleW, 12);
      ctx.strokeStyle = readCssVar('--border-subtle', 'rgba(255,255,255,0.08)');
      ctx.strokeRect(left, y + 6, barW, 12);
      ctx.textAlign = 'right';
      ctx.fillStyle = readCssVar('--foreground-muted', 'rgba(255,255,255,0.44)');
      ctx.fillText(`${Math.round(row.utilRatio * 100)}%`, width - 8, y + rowH * 0.5);
    });
  }

  function mount() {
    canvas = document.createElement('canvas');
    canvas.className = 'opv-load-bars';
    panel.appendChild(canvas);
    tooltip = makeTooltip(panel);
    canvas.addEventListener('pointermove', event => {
      hover = rowAt(event);
      if (hover) {
        tooltip.show(event, `
          <b>${esc(titleForRow(hover))}</b>
          <span>compute ${Math.round(hover.utilRatio * 100)}% · comm ${Math.round(hover.commRatio * 100)}% · bubble ${Math.round(hover.bubbleRatio * 100)}%</span>
        `);
      } else {
        tooltip.hide();
      }
      draw();
    });
    canvas.addEventListener('pointerleave', () => {
      hover = null;
      tooltip.hide();
      draw();
    });
    canvas.addEventListener('click', () => hover && onSelect?.(hover));
  }

  return { mount, render: draw, resize: draw };
}

export function createRankLoadView({ panel, viewModel, onSelect }) {
  let bars;
  return {
    panel,
    mount() {
      panel.innerHTML = `<div class="opv-analysis-view">${makeStatGrid(viewModel.stats)}<div class="opv-analysis-legend"><span class="is-compute">compute</span><span class="is-comm">comm</span><span class="is-bubble">bubble</span></div><div class="opv-analysis-scroll"></div></div>`;
      const target = panel.querySelector('.opv-analysis-scroll');
      bars = createStackedBarRows({
        panel: target,
        rows: viewModel.ranks,
        titleForRow: row => `R${row.rank} D${row.dp}P${row.stage}T${row.tp}`,
        onSelect: row => onSelect?.({ type: 'rank', rank: row.rank, dp: row.dp, stage: row.stage, tp: row.tp }),
      });
      bars.mount();
    },
    render() { bars?.render(); },
    resize() { bars?.resize(); },
  };
}

export function createCardLoadView({ panel, viewModel, onSelect }) {
  let tooltip;
  function render() {
    if (panel.hidden) return;
    panel.querySelectorAll('[data-card-id]').forEach(card => {
      const pressure = Number(card.dataset.pressure || 0);
      card.style.background = loadColor(pressure * 1.35);
    });
  }
  return {
    panel,
    mount() {
      panel.innerHTML = `
        <div class="opv-analysis-view">
          ${makeStatGrid(viewModel.stats)}
          <div class="opv-card-load-grid">
            ${viewModel.groups.map(group => `
              <section class="opv-card-load-group">
                <h3>${esc(group.label)}</h3>
                <div class="opv-card-load-cards">
                  ${group.cards.map(card => `
                    <button class="opv-card-load-cell" type="button" data-card-id="${card.cardId}" data-pressure="${card.pressure}" data-rank="${card.cardId}">
                      <b>R${card.cardId}</b><span>TP${card.tp}</span>
                    </button>
                  `).join('')}
                </div>
              </section>
            `).join('')}
          </div>
        </div>`;
      tooltip = makeTooltip(panel);
      panel.querySelectorAll('[data-card-id]').forEach(el => {
        const card = viewModel.cards.find(item => String(item.cardId) === el.dataset.cardId);
        el.addEventListener('pointermove', event => tooltip.show(event, `
          <b>Card / Rank ${card.cardId}</b>
          <span>D${card.dp} · P${card.stage} · TP${card.tp}</span>
          <span>pressure ${Math.round(card.pressure * 100)}% · comm ${Math.round(card.commRatio * 100)}% · bubble ${Math.round(card.bubbleRatio * 100)}%</span>
        `));
        el.addEventListener('pointerleave', () => tooltip.hide());
        el.addEventListener('click', () => onSelect?.({ type: 'card', rank: card.cardId, dp: card.dp, stage: card.stage, tp: card.tp }));
      });
      render();
    },
    render,
    resize: render,
  };
}

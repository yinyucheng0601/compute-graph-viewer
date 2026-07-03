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

export function createMoeLoadView({ panel, viewModel, onSelect, distribution, a2aTail }) {
  let metricId = viewModel.metricOptions[0]?.id || 'loadRatio';
  let canvas;
  let detail;
  let tooltip;
  let hoverCell = null;
  let selectedCell = null;
  let mode = 'heatmap';   // 'heatmap' | 'distribution' | 'a2atail'（后二者仅在传入对应数据时可用）
  let distCanvas, distTip, distTipEl;
  let distCursor = null;  // distribution 图当前游标 step（跟随鼠标的竖线）
  let a2aCanvas, a2aTip, a2aTipEl;
  let a2aCursor = null;   // A2A Tail 图当前游标 step（默认落在 P99 最差的 step）
  let a2aHoverRank = null; // 掉队者条中鼠标悬停的 rank（高亮 + 加粗数值）
  let a2aheatCanvas, a2aheatTip, a2aheatCursor = null;  // A2A 热力：左分位带 + 右 EP×专家 热力图（联动）
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
      const hi = hot.indexOf(e);
      if (hi >= 0) {   // 热点赢家专家：统一暖色系（红→橙），让坍缩后上冲的份额醒目
        const hue = 6 + (hi / Math.max(1, hot.length - 1)) * 28;   // 6(红)→34(橙)
        return `hsl(${hue}, 85%, ${theme === 'light' ? 52 : 56}%)`;
      }
    }
    if (dead && dead.includes(e)) return theme === 'light' ? '#b6bcc6' : '#5b6473';  // 死专家：灰色
    const hue = (e * 47) % 360;
    return `hsl(${hue}, ${theme === 'light' ? 40 : 34}%, ${theme === 'light' ? 62 : 46}%)`;
  }
  function drawDistribution() {
    if (!distribution || !distCanvas || panel.hidden) return;
    const wrap = panel.querySelector('[data-moe-dist-wrap]');
    if (!wrap || wrap.hidden) return;
    const bounds = distCanvas.parentElement.getBoundingClientRect();
    const width = Math.max(460, bounds.width - 4);
    const height = Math.max(200, bounds.height - 4);
    const ctx = resizeCanvas(distCanvas, width, height);
    const { steps, experts, series, hot = [], dead = [], collapseStep } = distribution;
    const n = steps.length;
    const padL = 44, padR = 12, padT = 30, padB = 26;
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
    const padL = 44, padR = 12, padT = 30, padB = 26;
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

  function showA2ATip(event, html) {
    if (!a2aTipEl) return;
    a2aTipEl.innerHTML = html;
    a2aTipEl.hidden = false;
    const pb = a2aTipEl.parentElement.getBoundingClientRect();
    const tw = a2aTipEl.offsetWidth, th = a2aTipEl.offsetHeight;
    let x = event.clientX - pb.left + 14, y = event.clientY - pb.top + 14;
    if (x + tw > pb.width - 4) x = event.clientX - pb.left - tw - 14;
    if (x < 4) x = 4;
    if (y + th > pb.height - 4) y = pb.height - th - 4;
    if (y < 4) y = 4;
    a2aTipEl.style.transform = `translate(${x}px, ${y}px)`;
  }

  // A2A Tail 布局：上=分位带时序（P50 线 + P50–P99 阴影带），下=游标 step 的逐 rank 掉队者条。
  const A2A_PAD = { L: 46, R: 12, T: 30, B: 20, gap: 46 };  // 上下两图间距（含轴标签 + 16px 额外留白）
  function a2aLayout(w, h) {
    const { L, R, T, B, gap } = A2A_PAD;
    const plotW = w - L - R;
    const totalH = h - T - B - gap;
    const bandH = Math.max(70, totalH * 0.6);
    const barsH = Math.max(52, totalH - bandH);
    const bandTop = T, bandBot = T + bandH;
    const barsTop = bandBot + gap, barsBot = barsTop + barsH;
    return { L, R, plotW, bandTop, bandBot, barsTop, barsBot, barsH };
  }
  function drawA2ATail() {
    if (!a2aTail || !a2aCanvas || panel.hidden) return;
    const wrap = panel.querySelector('[data-moe-a2a-wrap]');
    if (!wrap || wrap.hidden) return;
    const bounds = a2aCanvas.parentElement.getBoundingClientRect();
    const width = Math.max(460, bounds.width - 4);
    const height = Math.max(200, bounds.height - 4);
    const ctx = resizeCanvas(a2aCanvas, width, height);
    const { steps, p50, p95, p99, iter, collapseStep, ranks, hotRanks, blackHole, lat, ratioWarn, ratioAlert } = a2aTail;
    const n = steps.length;
    if (a2aCursor == null) a2aCursor = a2aTail.worstStep;
    const ci = Math.max(0, steps.indexOf(a2aCursor));
    const { L, plotW, bandTop, bandBot, barsTop, barsBot, barsH } = a2aLayout(width, height);
    const x0 = steps[0], x1 = steps[n - 1];
    const mapX = s => L + (s - x0) / (x1 - x0 || 1) * plotW;
    const yMax = Math.max(...p99) * 1.08 || 1;
    const mapY = v => bandTop + (1 - v / yMax) * (bandBot - bandTop);
    const danger = readCssVar('--danger', '#ef4444');
    const warn = readCssVar('--warning', '#d6aa35');
    const ok = readCssVar('--success', '#3f9e6b');
    const muted = readCssVar('--foreground-muted', 'rgba(255,255,255,0.45)');
    ctx.clearRect(0, 0, width, height);


    // y 网格 + 刻度（µs）
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    [0, 0.5, 1].forEach(t => {
      const v = yMax * t, y = mapY(v);
      ctx.strokeStyle = readCssVar('--border-subtle', 'rgba(255,255,255,0.08)');
      ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + plotW, y); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = muted; ctx.fillText(String(Math.round(v)), L - 6, y);
    });

    // P50–P99 阴影带
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = mapX(steps[i]), y = mapY(p99[i]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(mapX(steps[i]), mapY(p50[i]));
    ctx.closePath();
    ctx.fillStyle = danger; ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1;
    // P99 上沿
    ctx.strokeStyle = danger; ctx.lineWidth = 1;
    ctx.beginPath(); for (let i = 0; i < n; i++) { const x = mapX(steps[i]), y = mapY(p99[i]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();
    // P50 中线
    ctx.strokeStyle = readCssVar('--foreground-secondary', 'rgba(255,255,255,0.62)'); ctx.lineWidth = 1.3;
    ctx.beginPath(); for (let i = 0; i < n; i++) { const x = mapX(steps[i]), y = mapY(p50[i]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();

    // 坍缩竖线
    if (collapseStep != null) {
      const cx = mapX(collapseStep);
      ctx.strokeStyle = danger; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx, bandTop); ctx.lineTo(cx, bandBot); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = danger; ctx.font = '700 10px PingFang SC, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('路由坍缩', cx + 4, bandTop + 2);
    }
    // x 刻度
    ctx.fillStyle = muted; ctx.font = '10px JetBrains Mono, monospace'; ctx.textBaseline = 'top';
    [x0, Math.round((x0 + x1) / 2), x1].forEach((s, idx) => { ctx.textAlign = idx === 0 ? 'left' : idx === 2 ? 'right' : 'center'; ctx.fillText(String(s), mapX(s), bandBot + 4); });
    // 游标竖线
    const cx = mapX(a2aCursor);
    ctx.strokeStyle = readCssVar('--foreground-secondary', 'rgba(255,255,255,0.6)'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, bandTop); ctx.lineTo(cx, bandBot); ctx.stroke();

    // ===== 掉队者条（当前游标 step 的逐 rank 延迟）=====
    const row = lat[ci];
    const barMax = Math.max(...row, p99[ci]) * 1.08 || 1;
    const slot = plotW / ranks;
    const bw = Math.min(46, slot * 0.62);
    const p50v = p50[ci] || 1;
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillStyle = readCssVar('--foreground-secondary', 'rgba(255,255,255,0.62)'); ctx.font = '700 10px PingFang SC, sans-serif';
    ctx.fillText(`Step ${steps[ci]} · 各 rank A2A 延迟`, L, barsTop - 8);
    // P99 参考线
    const p99y = barsBot - (p99[ci] / barMax) * barsH;
    ctx.strokeStyle = danger; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, p99y); ctx.lineTo(L + plotW, p99y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = danger; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('P99', L + 2, p99y - 1);
    // 基线
    ctx.strokeStyle = readCssVar('--border-default', 'rgba(255,255,255,0.12)'); ctx.beginPath(); ctx.moveTo(L, barsBot); ctx.lineTo(L + plotW, barsBot); ctx.stroke();
    const primary = readCssVar('--primary', '#4369ef');
    const fg = readCssVar('--foreground', '#fff');
    const fgSec = readCssVar('--foreground-secondary', 'rgba(255,255,255,0.62)');
    for (let r = 0; r < ranks; r++) {
      const cxr = L + slot * (r + 0.5);
      const v = row[r], h = (v / barMax) * barsH, y = barsBot - h;
      const isBH = (r === blackHole && steps[ci] >= collapseStep);
      const lr = v / p50v;
      const isHover = r === a2aHoverRank;
      const col = isBH ? readCssVar('--foreground-muted', '#5b6473') : lr >= ratioAlert ? danger : lr >= ratioWarn ? warn : ok;
      ctx.fillStyle = col; ctx.globalAlpha = isBH ? 0.35 : isHover ? 1 : 0.85;
      ctx.fillRect(cxr - bw / 2, y, bw, h); ctx.globalAlpha = 1;
      if (isBH || isHover) { ctx.strokeStyle = isHover ? primary : col; ctx.lineWidth = isHover ? 1.5 : 1; ctx.strokeRect(cxr - bw / 2, y, bw, h); }
      // 柱顶数值（µs）：随游标 step / 悬停实时更新
      ctx.fillStyle = isHover ? fg : fgSec;
      ctx.font = (isHover ? '700 ' : '') + '9px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(String(Math.round(v)), cxr, y - 2);
      // rank 轴标签
      ctx.fillStyle = isHover ? fg : muted;
      ctx.font = '9px JetBrains Mono, monospace'; ctx.textBaseline = 'top';
      ctx.fillText('EP' + r + (isBH ? '⚠' : ''), cxr, barsBot + 3);
    }
  }
  function onA2AMove(event) {
    if (!a2aTail) return;
    const rect = a2aCanvas.getBoundingClientRect();
    const { steps, p50, p95, p99, iter, lat, ranks, blackHole, collapseStep, hotRanks, ratioWarn, ratioAlert } = a2aTail;
    const n = steps.length;
    const { L, plotW, bandTop, bandBot, barsTop, barsBot } = a2aLayout(rect.width, rect.height);
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < L || x > L + plotW) { if (a2aHoverRank != null) { a2aHoverRank = null; drawA2ATail(); } if (a2aTipEl) a2aTipEl.hidden = true; return; }
    const i = Math.max(0, Math.min(n - 1, Math.round((x - L) / plotW * (n - 1))));
    if (y >= bandTop && y <= bandBot) {
      a2aCursor = steps[i]; a2aHoverRank = null; drawA2ATail();
      const ratio = p50[i] ? p99[i] / p50[i] : 1, bubble = iter[i] ? (p99[i] - p50[i]) / iter[i] : 0;
      const rcol = ratio >= ratioAlert ? readCssVar('--danger', '#ef4444') : ratio >= ratioWarn ? readCssVar('--warning', '#d6aa35') : readCssVar('--success', '#3f9e6b');
      const kv = (k, v) => `<span style="display:flex;justify-content:space-between;gap:18px"><span>${k}</span><span>${v}</span></span>`;
      showA2ATip(event, `<b>Step ${steps[i]}</b>`
        + kv('尾比 P99/P50', `<b style="color:${rcol}">${ratio.toFixed(2)}×</b>`)
        + kv('气泡', `<b>${(bubble * 100).toFixed(0)}%</b>`)
        + kv('P50', `<b>${p50[i]} µs</b>`)
        + kv('P95', `<b>${p95[i]} µs</b>`));
    } else if (y >= barsTop && y <= barsBot) {
      const slot = plotW / ranks, r = Math.max(0, Math.min(ranks - 1, Math.floor((x - L) / slot)));
      if (r !== a2aHoverRank) { a2aHoverRank = r; drawA2ATail(); }
      const ci = Math.max(0, steps.indexOf(a2aCursor)), v = lat[ci][r];
      const isBH = (r === blackHole && steps[ci] >= collapseStep), lr = v / (p50[ci] || 1);
      const state = isBH ? '0 token · 空等热点 rank（症状非根因）' : lr >= ratioAlert ? '掉队 alert' : lr >= ratioWarn ? '偏慢 warn' : '正常';
      showA2ATip(event, `<b>EP${r} · Step ${steps[ci]}</b><span>A2A 延迟 ${v} µs · 相对 P50 ${lr.toFixed(2)}×</span><span>${state}${hotRanks.includes(r) ? ' · 热点专家宿主' : ''}</span>`);
    } else { if (a2aHoverRank != null) { a2aHoverRank = null; drawA2ATail(); } if (a2aTipEl) a2aTipEl.hidden = true; }
  }

  // ===== A2A 热力：左=分位带时序，右=EP×专家 热力图（256 专家，随游标 step 联动）=====
  const A2AHEAT_PAD = { L: 44, R: 8, T: 30, B: 22, gap: 22 };
  const A2AHEAT_HEADER = 13;   // 每个 EP 块顶部「组间热力条 + 组标签」高度
  const A2AHEAT_OVER = 1.6;    // 专家过载阈值（红格）→ 标注 E#·EP#
  function a2aheatLayout(w, h) {
    const { L, R, T, B, gap } = A2AHEAT_PAD;
    const plotTop = T, plotBot = h - B, plotH = plotBot - plotTop;
    const leftL = L;
    const leftW = Math.max(120, Math.round((w - L - R - gap) * 0.52));
    const rightX = leftL + leftW + gap;
    const rightW = Math.max(120, w - rightX - R);
    return { leftL, leftW, rightX, rightW, plotTop, plotBot, plotH };
  }
  function a2aheatGeom(rightW, rightX, plotH, plotTop, ranks, expertsPerRank) {
    const EPcols = 2, EProws = Math.ceil(ranks / EPcols);
    const ECols = 8, ERows = Math.ceil(expertsPerRank / ECols);
    const epGap = 7;
    const epW = (rightW - (EPcols - 1) * epGap) / EPcols;
    const epH = (plotH - (EProws - 1) * epGap) / EProws;
    return { EPcols, EProws, ECols, ERows, epGap, epW, epH, rightX, plotTop };
  }
  function drawA2AHeat() {
    if (!a2aTail || !a2aheatCanvas || panel.hidden) return;
    const wrap = panel.querySelector('[data-moe-a2aheat-wrap]');
    if (!wrap || wrap.hidden) return;
    const bounds = a2aheatCanvas.parentElement.getBoundingClientRect();
    const width = Math.max(460, bounds.width - 4), height = Math.max(220, bounds.height - 4);
    const ctx = resizeCanvas(a2aheatCanvas, width, height);
    const { steps, p50, p99, lat, collapseStep, worstStep, ranks, hotRanks, blackHole, expertsPerRank, expertLoadAt, epRankIds } = a2aTail;
    const rankTag = r => 'R' + (epRankIds && epRankIds[r] ? epRankIds[r].join(',') : r);
    const n = steps.length;
    if (a2aheatCursor == null) a2aheatCursor = worstStep;
    const { leftL, leftW, rightX, rightW, plotTop, plotBot, plotH } = a2aheatLayout(width, height);
    const danger = readCssVar('--danger', '#e5484d'), muted = readCssVar('--foreground-muted', 'rgba(255,255,255,0.45)');
    const fgSec = readCssVar('--foreground-secondary', 'rgba(255,255,255,0.62)');
    ctx.clearRect(0, 0, width, height);

    // ---- 左：分位带时序 ----
    const x0 = steps[0], x1 = steps[n - 1];
    const mapX = s => leftL + (s - x0) / (x1 - x0 || 1) * leftW;
    const yMax = Math.max(...p99) * 1.08 || 1;
    const mapY = v => plotTop + (1 - v / yMax) * plotH;
    ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    [0, 0.5, 1].forEach(t => {
      const v = yMax * t, y = mapY(v);
      ctx.strokeStyle = readCssVar('--border-subtle', 'rgba(255,255,255,0.08)'); ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(leftL, y); ctx.lineTo(leftL + leftW, y); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = muted; ctx.fillText(String(Math.round(v)), leftL - 6, y);
    });
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = mapX(steps[i]), y = mapY(p99[i]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(mapX(steps[i]), mapY(p50[i]));
    ctx.closePath(); ctx.fillStyle = danger; ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = danger; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = mapX(steps[i]), y = mapY(p99[i]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();
    ctx.strokeStyle = fgSec; ctx.lineWidth = 1.3; ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = mapX(steps[i]), y = mapY(p50[i]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();
    if (collapseStep != null) { const cx = mapX(collapseStep); ctx.strokeStyle = danger; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx, plotTop); ctx.lineTo(cx, plotBot); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = danger; ctx.font = '700 10px PingFang SC, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('路由坍缩', cx + 4, plotTop + 2); }
    ctx.fillStyle = muted; ctx.font = '10px JetBrains Mono, monospace'; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText(String(x0), leftL, plotBot + 4);
    ctx.textAlign = 'right'; ctx.fillText(String(x1), leftL + leftW, plotBot + 4);
    const curX = mapX(a2aheatCursor);
    ctx.strokeStyle = fgSec; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(curX, plotTop); ctx.lineTo(curX, plotBot); ctx.stroke();
    { const label = 'Step ' + a2aheatCursor; ctx.font = '10px JetBrains Mono, monospace'; const tw = ctx.measureText(label).width + 10; const chipX = Math.min(Math.max(curX - tw / 2, leftL), leftL + leftW - tw); ctx.fillStyle = readCssVar('--surface-4', '#2a2c33'); ctx.strokeStyle = readCssVar('--border-strong', 'rgba(255,255,255,0.3)'); ctx.fillRect(chipX, plotTop - 1, tw, 14); ctx.strokeRect(chipX, plotTop - 1, tw, 14); ctx.fillStyle = readCssVar('--foreground', '#fff'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, chipX + tw / 2, plotTop + 6); }

    // ---- 右：EP × 专家 热力图（大格=EP组，小格=专家；EP 顶部条=该组 A2A 尾比 → 组间可比）----
    ctx.fillStyle = fgSec; ctx.font = '700 10px PingFang SC, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`Step ${a2aheatCursor} · EP组间尾比(顶条) + 专家负载(小格) · 256 专家`, rightX, plotTop - 10);
    const ci = Math.max(0, steps.indexOf(a2aheatCursor));
    const load = expertLoadAt(a2aheatCursor);
    const g = a2aheatGeom(rightW, rightX, plotH, plotTop, ranks, expertsPerRank);
    const labels = [];   // 过载红格标注，最后统一画在最上层
    for (let r = 0; r < ranks; r++) {
      const epc = r % g.EPcols, epr = Math.floor(r / g.EPcols);
      const bx = rightX + epc * (g.epW + g.epGap), by = plotTop + epr * (g.epH + g.epGap);
      const gridY = by + A2AHEAT_HEADER, ew = g.epW / g.ECols, eh = (g.epH - A2AHEAT_HEADER) / g.ERows;
      // 专家小格
      for (let e = 0; e < expertsPerRank; e++) {
        const ec = e % g.ECols, er = Math.floor(e / g.ECols);
        const v = load[r * expertsPerRank + e], cx0 = bx + ec * ew, cy0 = gridY + er * eh;
        ctx.fillStyle = loadColor(v);
        ctx.fillRect(cx0, cy0, Math.max(1, ew + 0.3), Math.max(1, eh + 0.3));
        if (v >= A2AHEAT_OVER) {   // 过载红格：亮描边 + 收集标注 E#·Rank#
          ctx.strokeStyle = readCssVar('--foreground', '#fff'); ctx.lineWidth = 1;
          ctx.strokeRect(cx0 + 0.5, cy0 + 0.5, Math.max(1, ew - 1), Math.max(1, eh - 1));
          labels.push({ x: cx0 + ew / 2, y: cy0, text: `E${r * expertsPerRank + e}·${rankTag(r)}` });
        }
      }
      // 组间热力条（顶部）：色 = 该 EP 的 A2A 尾比 lat/P50（和左图分位、和小格负载同一冷→热色阶）
      const ratio = p50[ci] ? lat[ci][r] / p50[ci] : 1;
      ctx.fillStyle = loadColor(ratio);
      ctx.fillRect(bx, by, g.epW, A2AHEAT_HEADER);
      // EP 块外框（热点红 / 黑洞灰虚线）
      const isBH = (r === blackHole && a2aheatCursor >= collapseStep), isHot = hotRanks.includes(r);
      ctx.strokeStyle = isBH ? muted : isHot ? danger : readCssVar('--border-default', 'rgba(255,255,255,0.14)');
      ctx.lineWidth = (isHot || isBH) ? 1.6 : 1;
      if (isBH) ctx.setLineDash([3, 2]);
      ctx.strokeRect(bx, by, g.epW, g.epH); ctx.setLineDash([]);
      // 组标签（直接显示承载的 rank 号，多张卡就多写）+ 尾比（写在热力条上）
      const tag = `${rankTag(r)} ${ratio.toFixed(1)}×${isBH ? ' 死' : isHot ? ' 热' : ''}`;
      ctx.font = '700 9px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = ratio >= 1.3 ? '#fff' : readCssVar('--foreground', '#111');
      ctx.fillText(tag, bx + 4, by + A2AHEAT_HEADER / 2 + 0.5);
    }
    // 过载红格标注：E几·EP几（chip 压在最上层，横向钳制在右图内）
    ctx.font = '700 8px JetBrains Mono, monospace'; ctx.textBaseline = 'bottom';
    labels.forEach(l => {
      const tw = ctx.measureText(l.text).width + 5;
      let lx = Math.max(rightX, Math.min(l.x - tw / 2, rightX + rightW - tw));
      const ly = Math.max(plotTop + A2AHEAT_HEADER + 9, l.y);
      ctx.fillStyle = 'rgba(0,0,0,0.74)'; ctx.fillRect(lx, ly - 10, tw, 10);
      ctx.fillStyle = '#ffd9d5'; ctx.textAlign = 'left'; ctx.fillText(l.text, lx + 3, ly - 1.5);
    });
  }
  function onA2AHeatMove(event) {
    if (!a2aTail) return;
    const rect = a2aheatCanvas.getBoundingClientRect();
    const { steps, p50, p95, p99, iter, lat, collapseStep, ranks, hotRanks, blackHole, expertsPerRank, expertLoadAt, ratioWarn, ratioAlert, epRankIds } = a2aTail;
    const rankTag = r => 'R' + (epRankIds && epRankIds[r] ? epRankIds[r].join(',') : r);
    const n = steps.length;
    const { leftL, leftW, rightX, rightW, plotTop, plotBot, plotH } = a2aheatLayout(rect.width, rect.height);
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x >= leftL && x <= leftL + leftW && y >= plotTop && y <= plotBot) {
      const i = Math.max(0, Math.min(n - 1, Math.round((x - leftL) / leftW * (n - 1))));
      a2aheatCursor = steps[i]; drawA2AHeat();
      const ratio = p50[i] ? p99[i] / p50[i] : 1, bubble = iter[i] ? (p99[i] - p50[i]) / iter[i] : 0;
      const rcol = ratio >= ratioAlert ? readCssVar('--danger', '#ef4444') : ratio >= ratioWarn ? readCssVar('--warning', '#d6aa35') : readCssVar('--success', '#3f9e6b');
      const kv = (k, v) => `<span style="display:flex;justify-content:space-between;gap:18px"><span>${k}</span><span>${v}</span></span>`;
      a2aheatTip.show(event, `<b>Step ${steps[i]}</b>`
        + kv('尾比 P99/P50', `<b style="color:${rcol}">${ratio.toFixed(2)}×</b>`)
        + kv('气泡', `<b>${(bubble * 100).toFixed(0)}%</b>`)
        + kv('P50', `<b>${p50[i]} µs</b>`)
        + kv('P95', `<b>${p95[i]} µs</b>`));
      return;
    }
    const ci = Math.max(0, steps.indexOf(a2aheatCursor));
    const g = a2aheatGeom(rightW, rightX, plotH, plotTop, ranks, expertsPerRank);
    for (let r = 0; r < ranks; r++) {
      const epc = r % g.EPcols, epr = Math.floor(r / g.EPcols);
      const bx = rightX + epc * (g.epW + g.epGap), by = plotTop + epr * (g.epH + g.epGap);
      if (x >= bx && x <= bx + g.epW && y >= by && y <= by + g.epH) {
        const isBH = (r === blackHole && a2aheatCursor >= collapseStep);
        const role = hotRanks.includes(r) ? '热点宿主 rank（拖慢 A2A 尾）' : isBH ? '黑洞 rank（空等热点）' : '均衡 rank';
        if (y < by + A2AHEAT_HEADER) {   // 组头：EP 组间尾比
          const ratio = p50[ci] ? lat[ci][r] / p50[ci] : 1;
          const rcol = ratio >= ratioAlert ? readCssVar('--danger', '#ef4444') : ratio >= ratioWarn ? readCssVar('--warning', '#d6aa35') : readCssVar('--success', '#3f9e6b');
          a2aheatTip.show(event, `<b>${rankTag(r)}（EP组）· Step ${a2aheatCursor}</b><span>A2A 尾比 <b style="color:${rcol}">${ratio.toFixed(2)}×</b> · lat ${lat[ci][r]}µs（vs P50 ${p50[ci]}）</span><span>${role}</span>`);
          return;
        }
        const gridY = by + A2AHEAT_HEADER, ew = g.epW / g.ECols, eh = (g.epH - A2AHEAT_HEADER) / g.ERows;
        const ec = Math.min(g.ECols - 1, Math.max(0, Math.floor((x - bx) / ew)));
        const er = Math.min(g.ERows - 1, Math.max(0, Math.floor((y - gridY) / eh)));
        const e = er * g.ECols + ec;
        if (e >= 0 && e < expertsPerRank) {
          const v = expertLoadAt(a2aheatCursor)[r * expertsPerRank + e], gid = r * expertsPerRank + e;
          const state = isBH ? '死专家(0 token)' : v >= A2AHEAT_OVER ? '过载热点' : v < 0.3 ? '空闲' : '正常';
          a2aheatTip.show(event, `<b>专家 E${gid} · ${rankTag(r)}</b><span>负载 ${v.toFixed(2)}× cap · ${state}</span><span>${role}</span>`);
          return;
        }
      }
    }
    a2aheatTip.hide();
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
    if (mode === 'a2atail') mode = 'heatmap';   // A2A Tail 页签已移除，兜底防止残留模式
    panel.innerHTML = `
      <div class="opv-analysis-view">
        ${makeStatGrid(viewModel.stats)}
        <div class="opv-analysis-controls" data-metric-tabs></div>
        <div class="opv-analysis-grid-wrap" data-moe-heat-wrap>
          <canvas class="opv-moe-heatmap" aria-label="MoE expert load heatmap"></canvas>
          <aside class="opv-analysis-detail"></aside>
        </div>
        ${distribution ? `<div class="opv-moe-dist-wrap" data-moe-dist-wrap hidden>
          <div class="opv-chart-body">
            <canvas class="opv-moe-dist" aria-label="专家 token 占比面积堆叠图"></canvas>
            <div class="opv-chart-head"><span class="opv-chart-title">${esc(distribution.title || 'Distribution')}</span></div>
          </div>
        </div>` : ''}
        ${a2aTail ? `<div class="opv-moe-dist-wrap" data-moe-a2aheat-wrap hidden>
          <div class="opv-chart-body">
            <canvas class="opv-moe-dist" aria-label="A2A 尾延迟分位带 + EP×专家 热力图"></canvas>
            <div class="opv-chart-head">
              <span class="opv-chart-title">A2A 尾 × 专家热力</span>
              ${a2aTail.help ? '<button class="opv-chart-help" type="button" aria-label="图表说明" title="图表说明">?</button><div class="opv-chart-pop" data-help="a2aheat" hidden>' + a2aTail.help + '</div>' : ''}
            </div>
          </div>
        </div>` : ''}
      </div>`;
    canvas = panel.querySelector('.opv-moe-heatmap');
    detail = panel.querySelector('.opv-analysis-detail');
    tooltip = makeTooltip(panel);
    const heatWrap = panel.querySelector('[data-moe-heat-wrap]');
    const distWrap = panel.querySelector('[data-moe-dist-wrap]');
    const a2aWrap = panel.querySelector('[data-moe-a2a-wrap]');
    const a2aheatWrap = panel.querySelector('[data-moe-a2aheat-wrap]');
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
        if (a2aWrap) a2aWrap.hidden = true;
        if (a2aheatWrap) a2aheatWrap.hidden = true;
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
        if (a2aWrap) a2aWrap.hidden = true;
        if (a2aheatWrap) a2aheatWrap.hidden = true;
        drawDistribution();
      });
      if (mode === 'distribution') dbtn.classList.add('is-active');
      metricTabs.appendChild(dbtn); chips.push(dbtn);
      distCanvas = panel.querySelector('[data-moe-dist-wrap] .opv-moe-dist');
      distTip = makeTooltip(distWrap);
      distTipEl = distWrap.querySelector('.opv-analysis-tooltip');
      if (distTipEl) distTipEl.classList.add('opv-dist-tip');
      distCanvas.addEventListener('pointermove', onDistMove);
      distCanvas.addEventListener('pointerleave', () => { distCursor = null; drawDistribution(); if (distTipEl) distTipEl.hidden = true; });
      // 还原当前模式可见性（setViewModel 重挂载后保持在 Distribution）
      if (mode === 'distribution') { if (heatWrap) heatWrap.hidden = true; distWrap.hidden = false; }
    }
    if (a2aTail && a2aheatWrap) {
      const ahbtn = document.createElement('button');
      ahbtn.type = 'button';
      ahbtn.className = 'opv-analysis-chip';
      ahbtn.textContent = 'A2A 热力';
      ahbtn.addEventListener('click', () => {
        mode = 'a2aheat';
        chips.forEach(c => c.classList.toggle('is-active', c === ahbtn));
        if (heatWrap) heatWrap.hidden = true;
        if (distWrap) distWrap.hidden = true;
        if (a2aWrap) a2aWrap.hidden = true;
        a2aheatWrap.hidden = false;
        drawA2AHeat();
      });
      if (mode === 'a2aheat') ahbtn.classList.add('is-active');
      metricTabs.appendChild(ahbtn); chips.push(ahbtn);
      a2aheatCanvas = panel.querySelector('[data-moe-a2aheat-wrap] .opv-moe-dist');
      a2aheatTip = makeTooltip(a2aheatWrap);
      a2aheatCanvas.addEventListener('pointermove', onA2AHeatMove);
      a2aheatCanvas.addEventListener('pointerleave', () => { if (a2aheatTip) a2aheatTip.hide(); });
      // 问号说明气泡（与 A2A Tail 同一份说明；portal 到 body，用专属 data-help 避免与 A2A Tail 互删）
      const ahHelp = a2aheatWrap.querySelector('.opv-chart-help');
      const ahPop = a2aheatWrap.querySelector('.opv-chart-pop');
      if (ahHelp && ahPop) {
        document.querySelectorAll('body > .opv-chart-pop[data-help="a2aheat"]').forEach(n => n.remove());
        document.body.appendChild(ahPop);
        let hideTimer = null;
        const place = () => {
          ahPop.style.left = '0px'; ahPop.style.top = '0px';
          const r = ahHelp.getBoundingClientRect();
          const pw = ahPop.offsetWidth, ph = ahPop.offsetHeight;
          let left = r.left;
          if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
          if (left < 8) left = 8;
          let top = r.bottom + 6;
          if (top + ph > window.innerHeight - 8) top = r.top - 6 - ph;
          if (top < 8) top = 8;
          ahPop.style.left = left + 'px'; ahPop.style.top = top + 'px';
        };
        const open = () => { clearTimeout(hideTimer); ahPop.hidden = false; place(); };
        const scheduleHide = () => { hideTimer = setTimeout(() => { ahPop.hidden = true; }, 140); };
        ahHelp.addEventListener('mouseenter', open);
        ahHelp.addEventListener('mouseleave', scheduleHide);
        ahPop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
        ahPop.addEventListener('mouseleave', scheduleHide);
        ahHelp.addEventListener('click', event => { event.stopPropagation(); ahPop.hidden ? open() : (ahPop.hidden = true); });
      }
      // 还原当前模式可见性（setViewModel 重挂载后保持在 A2A 热力）
      if (mode === 'a2aheat') { if (heatWrap) heatWrap.hidden = true; if (distWrap) distWrap.hidden = true; if (a2aWrap) a2aWrap.hidden = true; a2aheatWrap.hidden = false; }
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

  function renderByMode() { mode === 'distribution' ? drawDistribution() : mode === 'a2aheat' ? drawA2AHeat() : draw(); }
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
    const localGroupSize = Math.max(1, (viewModel.tpCount || 1) * (viewModel.epCount || 1));
    grid.style.setProperty('--card-cols', String(localGroupSize));
    grid.innerHTML = viewModel.cards.map(card => {
      const state = card.state === 'alert' ? ' is-alert' : card.state === 'warn' ? ' is-warn' : '';
      const heat = Math.round(4 + card.utilRatio * 14);            // 4–18% 低饱和平涂
      const flow = Math.max(4, pct(card.commRatio));
      return `<button class="opv-cardload-cell${state}" type="button" data-card-id="${card.cardId}" style="--heat-soft:${heat}%;--flow:${flow}%">`
        + `<div class="cl-top"><b>R${card.cardId}</b><span>D${card.dp}P${card.stage}T${card.tp}E${card.ep}</span></div>`
        + `<div class="cl-meter"><i></i></div>`
        + `<div class="cl-bot"><span>u${pct(card.utilRatio)}</span><span>c${pct(card.commRatio)}</span></div>`
        + `</button>`;
    }).join('');
    grid.querySelectorAll('[data-card-id]').forEach(el => {
      const card = viewModel.cards.find(item => String(item.cardId) === el.dataset.cardId);
      el.addEventListener('pointermove', event => tooltip.show(event, `
        <b>Card / Rank ${card.cardId}</b>
        <span>D${card.dp} · P${card.stage} · TP${card.tp} · EP${card.ep}</span>
        <span>util ${pct(card.utilRatio)}% · comm ${pct(card.commRatio)}% · ${CARDLOAD_STATE_LABEL[card.state]}</span>
      `));
      el.addEventListener('pointerleave', () => tooltip.hide());
      el.addEventListener('click', () => onSelect?.({ type: 'card', rank: card.cardId, dp: card.dp, stage: card.stage, tp: card.tp, ep: card.ep }));
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

// 层内算子小圆点色（按语义）——独立于 3D 场景色，仅用于详情栏图例
const LAYER_SCAN_SEM_DOT = {
  'sem:attention': '#38bdf8',
  'sem:norm': '#94a3b8',
  'sem:gate': '#f59e0b',
  'sem:comm': '#10b981',
  'sem:moe': '#a78bfa',
  'module:decoder': '#7dd3fc',
};

// ===== 第 2 段（层级）+ 第 3 段（算子）：逐层 × step 指标热力图（可切换）+ 层内算子分解 =====
export function createLayerScanView({ panel, model, onSelect, getStep }) {
  let canvas, detail, tooltip;
  let hover = null;
  let channelId = model.defaultChannel || model.channelOrder[0];
  let selLayer = model.channels[channelId].epicenter.layer;   // 选中层贯穿始终；step 始终跟随全局播放头
  const L = 42, T = 10, R = 8, B = 20;     // 热力图内边距
  const ch = () => model.channels[channelId];

  const stepNow = () => {
    const s = typeof getStep === 'function' ? getStep() : null;
    return s ?? ch().marker.step ?? model.steps[0];
  };

  function scanColor(v) {
    const theme = document.documentElement.dataset.theme || 'dark';
    const cold = theme === 'light' ? '#e7edf4' : '#1c232e';
    const calm = theme === 'light' ? '#8fb7a6' : '#2f7d63';
    const warn = theme === 'light' ? '#e8ce69' : '#d6aa35';
    const hot = theme === 'light' ? '#e2564e' : '#e5484d';
    if (v <= 0.06) return cold;
    if (v < 0.35) return mixColor(cold, calm, (v - 0.06) / 0.29);
    if (v < 0.7) return mixColor(calm, warn, (v - 0.35) / 0.35);
    return mixColor(warn, hot, Math.min(1, (v - 0.7) / 0.3));
  }

  function gridBox() {
    const wrap = panel.querySelector('[data-scan-wrap]');
    const wb = wrap.getBoundingClientRect();
    const width = Math.max(360, wb.width - 250 - 8);   // 减去 detail(250) + gap(8)
    const height = Math.max(220, wb.height - 2);
    return { width, height, gridW: width - L - R, gridH: height - T - B };
  }

  function cellAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const gridW = rect.width - L - R, gridH = rect.height - T - B;
    if (x < L || x > L + gridW || y < T || y > T + gridH) return null;
    const layer = Math.min(model.totalLayers - 1, Math.max(0, Math.floor((y - T) / gridH * model.totalLayers)));
    const si = Math.min(model.stepCount - 1, Math.max(0, Math.floor((x - L) / gridW * model.stepCount)));
    return { layer, step: model.steps[si], si };
  }

  function draw() {
    if (!canvas || panel.hidden) return;
    const c = ch();
    const { width, height, gridW, gridH } = gridBox();
    const ctx = resizeCanvas(canvas, width, height);
    const rows = model.totalLayers, cols = model.stepCount;
    const rowH = gridH / rows, colW = gridW / cols;
    ctx.clearRect(0, 0, width, height);

    for (let layer = 0; layer < rows; layer++) {
      const y = T + layer * rowH;
      for (let si = 0; si < cols; si++) {
        ctx.fillStyle = scanColor(c.scores[layer * cols + si]);
        ctx.fillRect(L + si * colW, y, Math.max(1, colW + 0.4), Math.max(1, rowH + 0.4));
      }
    }
    ctx.strokeStyle = readCssVar('--border-default', 'rgba(255,255,255,0.12)');
    ctx.strokeRect(L, T, gridW, gridH);

    // 层轴标签（每 8 层）
    ctx.fillStyle = readCssVar('--foreground-muted', 'rgba(255,255,255,0.45)');
    ctx.font = '600 9px JetBrains Mono, monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let layer = 0; layer < rows; layer += 8) ctx.fillText(`L${layer}`, L - 6, T + (layer + 0.5) * rowH);

    // 分区分隔线：Dense↔MoE 边界
    const moeY = T + model.firstMoeLayer * rowH;
    ctx.strokeStyle = readCssVar('--border-strong', 'rgba(255,255,255,0.28)');
    ctx.setLineDash([2, 2]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, moeY); ctx.lineTo(L + gridW, moeY); ctx.stroke(); ctx.setLineDash([]);

    // step 轴标签（首 / 末）
    const mapX = step => L + (model.steps.indexOf(step) + 0.5) * colW;
    ctx.fillStyle = readCssVar('--foreground-muted', 'rgba(255,255,255,0.45)');
    ctx.font = '9px JetBrains Mono, monospace'; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText(String(model.steps[0]), L, T + gridH + 5);
    ctx.textAlign = 'right'; ctx.fillText(String(model.steps[cols - 1]), L + gridW, T + gridH + 5);

    // 故障 / 坍缩竖线
    const danger = readCssVar('--danger', '#e5484d');
    [[model.faultStep, readCssVar('--warning', '#d6aa35')], [model.collapseStep, danger]].forEach(([st, col]) => {
      const cx = mapX(st);
      ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, T); ctx.lineTo(cx, T + gridH); ctx.stroke(); ctx.setLineDash([]);
    });

    // 首问题层 / 最贵层（marker）：行高亮 + ◆ 标记
    const mk = c.marker;
    const ey = T + (mk.layer + 0.5) * rowH;
    ctx.strokeStyle = danger; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, ey); ctx.lineTo(L + gridW, ey); ctx.stroke();
    if (mk.step != null) {
      const dx = mapX(mk.step);
      ctx.fillStyle = danger;
      ctx.beginPath();
      ctx.moveTo(dx, ey - 4); ctx.lineTo(dx + 4, ey); ctx.lineTo(dx, ey + 4); ctx.lineTo(dx - 4, ey); ctx.closePath();
      ctx.fill();
    }

    // 跟随鼠标的游标竖线：hover 时出现，移出即消失（像 Monitor loss 图的 cursor）
    if (hover) {
      const cursorX = mapX(hover.step);
      ctx.strokeStyle = readCssVar('--foreground-secondary', 'rgba(255,255,255,0.62)'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cursorX, T); ctx.lineTo(cursorX, T + gridH); ctx.stroke();
    }

    // 选中层 + hover 描边
    const primary = tokenColor('--primary', '#4369ef');
    const outlineRow = (layer, lw) => {
      ctx.strokeStyle = primary; ctx.lineWidth = lw;
      ctx.strokeRect(L, T + layer * rowH, gridW, Math.max(2, rowH));
    };
    if (hover && hover.layer !== selLayer) outlineRow(hover.layer, 1);
    outlineRow(selLayer, 1.8);
  }

  function renderSpark(el, layer, step) {
    if (!el) return;
    const c = ch();
    const w = 226, h = 42, pad = 3, n = model.stepCount;
    const xs = i => pad + (n > 1 ? i / (n - 1) : 0) * (w - 2 * pad);
    const ys = v => (h - pad) - v * (h - 2 * pad);
    let d = '';
    for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(c.scores[layer * n + i]).toFixed(1) + ' ';
    const thrY = ys(c.warnThreshold);
    const ci = Math.max(0, model.steps.indexOf(step));
    const cx = xs(ci), cv = c.scores[layer * n + ci];
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-label="L${layer} ${esc(c.label)} 随 step">
      <line x1="${pad}" x2="${w - pad}" y1="${thrY.toFixed(1)}" y2="${thrY.toFixed(1)}" stroke="var(--warning)" stroke-dasharray="3 3" stroke-width="1" opacity="0.7"/>
      <path d="${d}" fill="none" stroke="var(--danger)" stroke-width="1.4"/>
      <line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${pad}" y2="${h - pad}" stroke="var(--foreground-secondary)" stroke-width="1"/>
      <circle cx="${cx.toFixed(1)}" cy="${ys(cv).toFixed(1)}" r="2.4" fill="var(--danger)"/>
    </svg>`;
  }

  function renderStats() {
    const el = panel.querySelector('[data-scan-stats]');
    if (el) el.innerHTML = makeStatGrid(ch().stats);
  }

  function renderTabDesc() {
    const el = panel.querySelector('[data-scan-tabdesc]');
    if (el) el.textContent = ch().desc;
  }

  function renderLegend() {
    const el = panel.querySelector('[data-scan-legend]');
    if (!el) return;
    const c = ch();
    el.innerHTML = `
      <span class="opv-scan-chartname">热力图</span>
      <span>行 = 层 L0–L${model.lastMoeLayer}</span>
      <span>列 = step（时间）</span>
      <span class="opv-scan-key">低<i style="background:${scanColor(0.2)}"></i><i style="background:${scanColor(0.5)}"></i><i style="background:${scanColor(0.9)}"></i>高</span>
      <span class="opv-scan-unit">单位 <b>${esc(c.unit)}</b> · ${c.kind === 'anomaly' ? '异常型' : '成本型'}</span>
      <span class="opv-scan-epi">◆ ${esc(c.markerLabel)} L${c.marker.layer}${c.marker.step != null ? ' @ step ' + c.marker.step : ''}</span>
      <button class="opv-scan-reset" type="button" title="复原默认显示" aria-label="复原默认显示">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path></svg>复原
      </button>`;
    el.querySelector('.opv-scan-reset')?.addEventListener('click', resetView);
  }

  // 复原：图表 + 算子图表回到默认（保留当前指标页签；仅把选中层还原为该指标的首问题/峰值层）
  function resetView() {
    selLayer = ch().epicenter.layer;
    hover = null;
    renderAll();
  }

  // 算子分解「?」说明气泡：portal 到 body（避开详情栏 overflow 裁剪），fixed 定位
  let ophelpPop = null, ophelpHideTimer = null;
  function ensureOpHelpPop() {
    if (ophelpPop) return ophelpPop;
    ophelpPop = document.createElement('div');
    ophelpPop.className = 'opv-chart-pop';
    ophelpPop.hidden = true;
    ophelpPop.addEventListener('mouseenter', () => clearTimeout(ophelpHideTimer));
    ophelpPop.addEventListener('mouseleave', () => { ophelpHideTimer = setTimeout(() => { ophelpPop.hidden = true; }, 140); });
    document.body.appendChild(ophelpPop);
    return ophelpPop;
  }
  function opHelpHtml() {
    const c = ch();
    const anomaly = c.kind === 'anomaly';
    return `<h4>算子贡献值怎么算</h4>`
      + `<p>横条按算子拆解该层的 <b>${esc(c.label)}</b>；占比 = 各算子${anomaly ? '对该层<b>异常</b>的贡献' : '的<b>' + esc(c.label) + '占用</b>'}（条长），归一到 100%。</p>`
      + `<h5>业务口径</h5>`
      + (anomaly
          ? `<p>取该层该 step 的指标值，再按<b>故障归因权重档</b>摊到 7 个算子。本 demo 故障源是 <b>Router</b> 的混合精度权重更新写越界，误差经 dispatch→Experts→combine 放大，所以 <b>Router / Experts / A2A</b> 贡献最高，MLA / Norm 很低。</p>`
            + `<p>真实系统应由<b>逐算子 hook</b> 实测各算子输出的${c.id === 'grad' ? '梯度范数' : '负载偏移'}，这里用领域先验权重近似。</p>`
          : `<p>按<b>结构性成本档</b>摊分：<b>Experts、MLA</b> 最贵（计算量 / 参数与激活最大），Router、Norm 便宜；坍缩后热点层的 Experts / A2A 会进一步变${c.id === 'time' ? '慢' : '大'}。</p>`
            + `<p>真实系统由 <b>profiler 逐算子${c.id === 'time' ? '计时' : '显存快照'}</b> 得到，这里用先验档近似。</p>`);
  }
  function positionOpHelp(btn, pop) {
    pop.style.left = '0px'; pop.style.top = '0px';   // 先落位再量真实尺寸
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r.right - pw;                          // 详情栏在右侧 → 气泡向左展开
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
    if (left < 8) left = 8;
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = r.top - 6 - ph;   // 下方放不下 → 向上翻
    if (top < 8) top = 8;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function bindOpHelp(btn) {
    if (!btn) return;
    const pop = ensureOpHelpPop();
    const open = () => { clearTimeout(ophelpHideTimer); pop.innerHTML = opHelpHtml(); pop.hidden = false; positionOpHelp(btn, pop); };
    const hide = () => { ophelpHideTimer = setTimeout(() => { pop.hidden = true; }, 140); };
    btn.addEventListener('mouseenter', open);
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('click', e => { e.stopPropagation(); pop.hidden ? open() : (pop.hidden = true); });
  }

  function renderDetail() {
    if (!detail) return;
    const c = ch();
    const step = stepNow();
    const layer = selLayer;
    const info = model.layers[layer];
    const pl = c.perLayer[layer];
    const rawv = c.rawAt(layer, step);
    const ops = [...c.ops(layer, step)].sort((a, b) => b.share - a.share);
    const bars = ops.map(o => `
      <div class="opv-scan-op">
        <span class="opv-scan-op__name"><i style="background:${LAYER_SCAN_SEM_DOT[o.sem] || '#888'}"></i>${esc(o.label)}</span>
        <div class="opv-scan-op__bar"><i style="width:${(o.share * 100).toFixed(0)}%;background:${scanColor(o.score)}"></i></div>
        <span class="opv-scan-op__val">${(o.share * 100).toFixed(0)}%</span>
      </div>`).join('');
    detail.innerHTML = `
      <div class="opv-analysis-detail-title">L${layer} · step ${step}</div>
      <div class="opv-scan-spark" data-scan-spark></div>
      <div class="opv-analysis-detail-grid">
        <span>${esc(c.label)}</span><b>${rawv.toFixed(c.digits)} ${esc(c.unit)}</b>
        <span>层类型</span><b>${info.isMoe ? 'MoE' : 'Dense'}</b>
        <span>${c.kind === 'anomaly' ? '首超标' : '首超阈'}（${esc(c.warnText)}）</span><b>${pl.firstDivergeStep != null ? 'step ' + pl.firstDivergeStep : '—'}</b>
        <span>峰值</span><b>${pl.peakRaw.toFixed(c.digits)} ${esc(c.unit)} @${pl.peakStep}</b>
      </div>
      <div class="opv-scan-oplabel"><span>水平条形图 · ${esc(c.opLabel)}</span><button class="opv-chart-help" type="button" data-scan-ophelp aria-label="算子贡献值怎么算" title="算子贡献值怎么算">?</button></div>
      <div class="opv-scan-ops">${bars}</div>`;
    renderSpark(detail.querySelector('[data-scan-spark]'), layer, step);
    bindOpHelp(detail.querySelector('[data-scan-ophelp]'));
  }

  function renderAll() { renderStats(); renderLegend(); renderTabDesc(); draw(); renderDetail(); }

  function mount() {
    panel.innerHTML = `
      <div class="opv-analysis-view">
        <div class="opv-analysis-controls opv-scan-controls">
          <div class="opv-scan-tabs" data-scan-tabs></div>
          <span class="opv-scan-tab-div"></span>
          <span class="opv-scan-tabdesc" data-scan-tabdesc></span>
        </div>
        <div data-scan-stats></div>
        <div class="opv-scan-legend" data-scan-legend></div>
        <div class="opv-analysis-grid-wrap" data-scan-wrap>
          <canvas class="opv-scan-heatmap" aria-label="逐层 × step 指标热力图"></canvas>
          <aside class="opv-analysis-detail" data-scan-detail></aside>
        </div>
      </div>`;
    canvas = panel.querySelector('.opv-scan-heatmap');
    detail = panel.querySelector('[data-scan-detail]');
    tooltip = makeTooltip(panel.querySelector('[data-scan-wrap]'));
    // 指标切换 chips
    const tabsEl = panel.querySelector('[data-scan-tabs]');
    model.channelOrder.forEach(id => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opv-analysis-chip';
      btn.dataset.scanChip = id;
      btn.textContent = model.channels[id].label;
      if (id === channelId) btn.classList.add('is-active');
      btn.addEventListener('click', () => {
        channelId = id;
        tabsEl.querySelectorAll('[data-scan-chip]').forEach(x => x.classList.toggle('is-active', x === btn));
        renderAll();
      });
      tabsEl.appendChild(btn);
    });
    canvas.addEventListener('pointermove', event => {
      hover = cellAt(event);
      if (!hover) { tooltip.hide(); draw(); return; }
      const c = ch();
      const rawv = c.rawAt(hover.layer, hover.step);
      const info = model.layers[hover.layer];
      tooltip.show(event, `
        <b>L${hover.layer} · step ${hover.step}</b>
        <span>${esc(c.label)} ${rawv.toFixed(c.digits)} ${esc(c.unit)} · ${info.isMoe ? 'MoE' : 'Dense'}</span>
        <span>点击查看该层算子分解（见右侧图表）</span>`);
      draw();
    });
    canvas.addEventListener('pointerleave', () => { hover = null; tooltip.hide(); draw(); });
    canvas.addEventListener('click', event => {
      const cell = cellAt(event);
      if (!cell) return;
      selLayer = cell.layer;
      const c = ch();
      const rawv = c.rawAt(cell.layer, cell.step);
      onSelect?.({
        type: 'layer', layer: cell.layer, step: cell.step, score: rawv,
        statusText: `Layer Scan · L${cell.layer} · step ${cell.step} · ${c.label} ${rawv.toFixed(c.digits)} ${c.unit}`,
      });
      draw(); renderDetail();
    });
    renderAll();
  }

  return {
    panel, mount,
    render() { draw(); renderDetail(); },
    resize() { draw(); },
  };
}

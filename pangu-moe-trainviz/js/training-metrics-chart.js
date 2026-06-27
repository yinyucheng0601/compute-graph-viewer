/* ============================================================
   window.PtoTrainingMetricsChart — 训练指标折线图（纯原生、无依赖、自绘 SVG）
   抽自 component-preview.html 的提案 pattern；scope: .pto-tmchart*
   render(container, spec) -> controller
   spec = { steps[], series[{id,label,key,colorVar,axis,emphasis}], data{key:[]},
            anomalies[{step,seriesId}], interestWindow, cursor,
            onBrush(win), onCursorHover(step), options, legend }
   controller = { setInterestWindow, setCursor, setData, setAnomalyVisible, destroy }
   ============================================================ */
(function (global) {
  'use strict';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const el = (n, a) => { const e = document.createElementNS(SVGNS, n); if (a) for (const k in a) e.setAttribute(k, a[k]); return e; };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function render(container, spec) {
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    host.classList.add('pto-tmchart');
    host.innerHTML = '';

    const opt = Object.assign({
      width: 960, height: 300,
      pad: { t: 14, r: 48, b: 26, l: 48 },
      compact: false,
    }, spec.options || {});
    if (opt.compact) { opt.height = 120; opt.pad = { t: 10, r: 12, b: 20, l: 38 }; }

    const steps = spec.steps;
    const x0 = steps[0], x1 = steps[steps.length - 1];
    const W = opt.width, H = opt.height, P = opt.pad;
    const plotW = W - P.l - P.r, plotH = H - P.t - P.b;

    // 轴域：按 axis 分组自适应
    const axes = {};
    spec.series.forEach(s => {
      const vals = spec.data[s.key].filter(v => v != null && isFinite(v));
      const ax = s.axis || 'left';
      const a = axes[ax] || (axes[ax] = { min: Infinity, max: -Infinity });
      a.min = Math.min(a.min, ...vals); a.max = Math.max(a.max, ...vals);
    });
    Object.values(axes).forEach(a => { if (a.min === a.max) { a.max += 1; } const pad = (a.max - a.min) * 0.08; a.min -= pad; a.max += pad; });

    const mapX = (step) => P.l + ((step - x0) / (x1 - x0 || 1)) * plotW;
    const mapY = (val, ax) => { const a = axes[ax || 'left']; return P.t + plotH - ((val - a.min) / (a.max - a.min || 1)) * plotH; };

    const svg = el('svg', { class: 'pto-tmchart__svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img' });
    host.appendChild(svg);

    // 网格 + 左轴刻度
    const gGrid = el('g', { class: 'pto-tmchart__grid' });
    const rows = opt.compact ? 2 : 4;
    for (let i = 0; i <= rows; i++) {
      const y = P.t + (plotH / rows) * i;
      gGrid.appendChild(el('line', { x1: P.l, y1: y, x2: P.l + plotW, y2: y }));
    }
    svg.appendChild(gGrid);

    // 左轴数值
    const gAxis = el('g', { class: 'pto-tmchart__axis' });
    const la = axes.left;
    if (la) for (let i = 0; i <= rows; i++) {
      const v = la.max - ((la.max - la.min) / rows) * i;
      const y = P.t + (plotH / rows) * i;
      const t = el('text', { x: P.l - 6, y: y + 3, 'text-anchor': 'end' }); t.textContent = fmt(v); gAxis.appendChild(t);
    }
    // 右轴数值
    const ra = axes.right;
    if (ra) for (let i = 0; i <= rows; i++) {
      const v = ra.max - ((ra.max - ra.min) / rows) * i;
      const y = P.t + (plotH / rows) * i;
      const t = el('text', { x: P.l + plotW + 6, y: y + 3, 'text-anchor': 'start' }); t.textContent = fmt(v); gAxis.appendChild(t);
    }
    // x 轴端点
    [[x0, P.l, 'start'], [x1, P.l + plotW, 'end']].forEach(([v, x, anchor]) => {
      const t = el('text', { x, y: H - 6, 'text-anchor': anchor }); t.textContent = v; gAxis.appendChild(t);
    });
    svg.appendChild(gAxis);

    // 框选 band（先画，置于线下）
    const gBrush = el('g'); svg.appendChild(gBrush);
    // 异常 band + 折线层
    const gAnom = el('g'); svg.appendChild(gAnom);
    const gLines = el('g'); svg.appendChild(gLines);
    const gDots = el('g'); svg.appendChild(gDots);
    // 游标层
    const gCursor = el('g'); svg.appendChild(gCursor);

    // 折线
    spec.series.forEach(s => {
      const color = cssVar(s.colorVar) || '#888';
      let d = '';
      steps.forEach((st, i) => {
        const v = spec.data[s.key][i];
        if (v == null || !isFinite(v)) { d += ''; return; }
        d += (d ? ' L ' : 'M ') + mapX(st).toFixed(1) + ' ' + mapY(v, s.axis).toFixed(1);
      });
      const path = el('path', { class: 'pto-tmchart__line' + (s.emphasis ? ' pto-tmchart__line--emph' : ''), d, stroke: color });
      gLines.appendChild(path);
    });

    // 状态
    let anomalyVisible = spec.anomalies && spec.anomalies.length ? true : false;
    let brush = spec.interestWindow || null;
    let cursor = spec.cursor != null ? spec.cursor : null;

    function drawAnomaly() {
      gAnom.innerHTML = ''; gDots.innerHTML = '';
      if (!anomalyVisible || !spec.anomalies) return;
      // 把连续异常 step 聚成 band
      const aSteps = [...new Set(spec.anomalies.map(a => a.step))].sort((a, b) => a - b);
      if (aSteps.length) {
        const bx0 = mapX(Math.min(...aSteps)), bx1 = mapX(Math.max(...aSteps));
        gAnom.appendChild(el('rect', { class: 'pto-tmchart__anomaly-band', x: bx0, y: P.t, width: Math.max(2, bx1 - bx0), height: plotH }));
      }
      spec.anomalies.forEach(a => {
        const s = spec.series.find(ss => ss.id === a.seriesId); if (!s) return;
        const i = steps.indexOf(a.step); if (i < 0) return;
        const v = spec.data[s.key][i]; if (v == null) return;
        gDots.appendChild(el('circle', { class: 'pto-tmchart__anomaly-dot', cx: mapX(a.step), cy: mapY(v, s.axis), r: 3 }));
      });
    }
    function drawBrush() {
      gBrush.innerHTML = '';
      if (!brush) return;
      const bx0 = mapX(Math.min(brush.start, brush.end)), bx1 = mapX(Math.max(brush.start, brush.end));
      gBrush.appendChild(el('rect', { class: 'pto-tmchart__brush', x: bx0, y: P.t, width: Math.max(1, bx1 - bx0), height: plotH }));
      gBrush.appendChild(el('line', { class: 'pto-tmchart__brush-edge', x1: bx0, y1: P.t, x2: bx0, y2: P.t + plotH }));
      gBrush.appendChild(el('line', { class: 'pto-tmchart__brush-edge', x1: bx1, y1: P.t, x2: bx1, y2: P.t + plotH }));
    }
    function drawCursor() {
      gCursor.innerHTML = '';
      if (cursor == null) return;
      const cx = mapX(cursor);
      gCursor.appendChild(el('line', { class: 'pto-tmchart__cursor', x1: cx, y1: P.t, x2: cx, y2: P.t + plotH }));
      if (!opt.compact) {
        const label = 'Step ' + cursor;
        const w = 26 + label.length * 5.4;
        const chipX = Math.min(Math.max(cx - w / 2, P.l), P.l + plotW - w);
        gCursor.appendChild(el('rect', { class: 'pto-tmchart__cursor-chip', x: chipX, y: P.t - 1, width: w, height: 16, rx: 4 }));
        const t = el('text', { class: 'pto-tmchart__cursor-chip-text', x: chipX + w / 2, y: P.t + 10, 'text-anchor': 'middle' }); t.textContent = label;
        gCursor.appendChild(t);
      }
    }

    // 交互 hit-rect
    const hit = el('rect', { class: 'pto-tmchart__plot-hit', x: P.l, y: P.t, width: plotW, height: plotH });
    svg.appendChild(hit);
    const stepFromClient = (clientX) => {
      const r = svg.getBoundingClientRect();
      const vx = (clientX - r.left) / r.width * W;
      const frac = Math.min(1, Math.max(0, (vx - P.l) / plotW));
      return Math.round(x0 + frac * (x1 - x0));
    };
    if (!opt.compact && spec.onBrush !== false) {
      let dragging = false, anchor = null;
      hit.addEventListener('pointerdown', (e) => { dragging = true; anchor = stepFromClient(e.clientX); hit.setPointerCapture(e.pointerId); brush = { start: anchor, end: anchor }; drawBrush(); });
      hit.addEventListener('pointermove', (e) => {
        if (dragging) { brush = { start: anchor, end: stepFromClient(e.clientX) }; drawBrush(); }
        else { cursor = stepFromClient(e.clientX); drawCursor(); if (spec.onCursorHover) spec.onCursorHover(cursor); }
      });
      hit.addEventListener('pointerup', (e) => { dragging = false; if (brush && Math.abs(brush.end - brush.start) >= 1 && spec.onBrush) spec.onBrush({ start: Math.min(brush.start, brush.end), end: Math.max(brush.start, brush.end) }); else { brush = null; drawBrush(); } });
    }

    drawAnomaly(); drawBrush(); drawCursor();

    // legend
    if (spec.legend !== false && !opt.compact) {
      const legend = document.createElement('div'); legend.className = 'pto-tmchart__legend';
      spec.series.forEach(s => {
        const item = document.createElement('span'); item.className = 'pto-tmchart__legend-item';
        const sw = document.createElement('span'); sw.className = 'pto-tmchart__legend-swatch'; sw.style.background = cssVar(s.colorVar);
        item.appendChild(sw); item.appendChild(document.createTextNode(s.label + (s.axis === 'right' ? ' (右轴)' : '')));
        legend.appendChild(item);
      });
      host.appendChild(legend);
    }

    return {
      setInterestWindow(win) { brush = win; drawBrush(); },
      setCursor(step) { cursor = step; drawCursor(); },
      setAnomalyVisible(v) { anomalyVisible = v; drawAnomaly(); },
      destroy() { host.innerHTML = ''; },
    };
  }
  function fmt(v) { const a = Math.abs(v); if (a >= 1000) return (v / 1000).toFixed(1) + 'k'; if (a >= 10) return v.toFixed(0); if (a >= 1) return v.toFixed(1); return v.toFixed(2); }

  global.PtoTrainingMetricsChart = { render };
})(window);

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
      xTicks: 2,  // x 轴刻度档数（默认 2 = 仅首尾端点，保持原行为）
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
      const t = el('text', { x: P.l - 6, y: y + 3, 'text-anchor': 'end' });
      const tv = fmt(v);
      t.textContent = tv;
      if (tv === 'NaN' || tv === 'Infinity' || tv === 'inf') t.setAttribute('class', 'pto-tmchart__axis pto-tmchart__val--danger');
      else t.setAttribute('class', 'pto-tmchart__axis');
      gAxis.appendChild(t);
    }
    // 右轴数值
    const ra = axes.right;
    if (ra) for (let i = 0; i <= rows; i++) {
      const v = ra.max - ((ra.max - ra.min) / rows) * i;
      const y = P.t + (plotH / rows) * i;
      const t = el('text', { x: P.l + plotW + 6, y: y + 3, 'text-anchor': 'start' });
      const tv2 = fmt(v);
      t.textContent = tv2;
      if (tv2 === 'NaN' || tv2 === 'Infinity' || tv2 === 'inf') t.setAttribute('class', 'pto-tmchart__axis pto-tmchart__val--danger');
      else t.setAttribute('class', 'pto-tmchart__axis');
      gAxis.appendChild(t);
    }
    // x 轴刻度（opt.xTicks 档，默认 2 = 仅首尾端点）
    const xTicks = Math.max(2, opt.xTicks | 0 || 2);
    for (let i = 0; i < xTicks; i++) {
      const frac = i / (xTicks - 1);
      const v = Math.round(x0 + frac * (x1 - x0));
      const x = P.l + frac * plotW;
      const anchor = i === 0 ? 'start' : i === xTicks - 1 ? 'end' : 'middle';
      const t = el('text', { x, y: H - 6, 'text-anchor': anchor }); t.textContent = v; gAxis.appendChild(t);
    }
    svg.appendChild(gAxis);

    // 区域底色（如路由坍缩区，spec.regions），置于最底层
    const gRegion = el('g'); svg.appendChild(gRegion);
    // 框选 band（先画，置于线下）
    const gBrush = el('g'); svg.appendChild(gBrush);
    // 异常 band + 折线层
    const gAnom = el('g'); svg.appendChild(gAnom);
    const gLines = el('g'); svg.appendChild(gLines);
    const gDots = el('g'); svg.appendChild(gDots);
    // 游标层
    const gCursor = el('g'); svg.appendChild(gCursor);

    // 折线（spec.smoothing>0：原曲线淡化、叠加 EMA 平滑曲线；默认 0 = 原行为）
    const smoothing = Math.max(0, Math.min(0.99, +spec.smoothing || 0));
    const buildPath = (arr, ax) => {
      let d = '';
      steps.forEach((st, i) => {
        const v = arr[i];
        if (v == null || !isFinite(v)) return;
        d += (d ? ' L ' : 'M ') + mapX(st).toFixed(1) + ' ' + mapY(v, ax).toFixed(1);
      });
      return d;
    };
    // 中心移动平均（零相位）+ 端点对称收缩：避免 EMA 单边滞后把上升/下降端点（如 2100）拉偏。
    // 在“非空点序列”上做平滑：train 为逐点；val 仅 epoch 点 → 端点（首/末实测点）保持原值。
    const smoothSeries = (arr, w) => {
      const n = arr.length;
      const out = new Array(n).fill(null);
      const idx = [], val = [];
      for (let i = 0; i < n; i++) { const v = arr[i]; if (v != null && isFinite(v)) { idx.push(i); val.push(v); } }
      const m = val.length;
      if (!m) return out;
      const R = Math.max(1, Math.round(w * 40));  // 平滑半径随 smoothing 增大
      for (let j = 0; j < m; j++) {
        const rr = Math.min(R, j, m - 1 - j);     // 边缘对称收缩：首/末点 rr=0 → 保持原值
        let sum = 0, cnt = 0;
        for (let k = j - rr; k <= j + rr; k++) { sum += val[k]; cnt++; }
        out[idx[j]] = sum / cnt;
      }
      return out;
    };
    spec.series.forEach(s => {
      const color = cssVar(s.colorVar) || '#888';
      const raw = spec.data[s.key];
      const cls = 'pto-tmchart__line' + (s.emphasis ? ' pto-tmchart__line--emph' : '');
      if (smoothing > 0) {
        const base = el('path', { class: 'pto-tmchart__line', d: buildPath(raw, s.axis), stroke: color });
        base.style.opacity = '0.22';  // 原走势淡化但不消失
        gLines.appendChild(base);
        gLines.appendChild(el('path', { class: cls, d: buildPath(smoothSeries(raw, smoothing), s.axis), stroke: color }));
      } else {
        gLines.appendChild(el('path', { class: cls, d: buildPath(raw, s.axis), stroke: color }));
      }
    });

    // 状态
    let anomalyVisible = spec.anomalies && spec.anomalies.length ? true : false;
    let brush = spec.interestWindow || null;
    let cursor = spec.cursor != null ? spec.cursor : null;
    let tooltipVisible = false;  // cursorTooltip 气泡仅在 hover 时显示（由 hover/leave 或外部 setTooltip 控制）

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
    function drawRegions() {
      gRegion.innerHTML = '';
      if (!spec.regions || !spec.regions.length) return;
      spec.regions.forEach(r => {
        const a = Math.max(x0, Math.min(r.start, r.end));
        const b = Math.min(x1, Math.max(r.start, r.end));
        if (b < a) return;
        gRegion.appendChild(el('rect', { class: 'pto-tmchart__anomaly-band', x: mapX(a), y: P.t, width: Math.max(1, mapX(b) - mapX(a)), height: plotH }));
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
      if (opt.compact) return;
      // spec.cursorTooltip：在定位轴旁显示 step + 各序列具体数值的气泡（默认关闭，保持原 Step 胶囊）
      // 气泡仅在 hover（tooltipVisible）时绘制；鼠标移开则只留定位轴、不显示气泡
      if (spec.cursorTooltip) { if (tooltipVisible) drawCursorBubble(cx); return; }
      const label = 'Step ' + cursor;
      const w = 26 + label.length * 5.4;
      const chipX = Math.min(Math.max(cx - w / 2, P.l), P.l + plotW - w);
      gCursor.appendChild(el('rect', { class: 'pto-tmchart__cursor-chip', x: chipX, y: P.t - 1, width: w, height: 16, rx: 4 }));
      const t = el('text', { class: 'pto-tmchart__cursor-chip-text', x: chipX + w / 2, y: P.t + 10, 'text-anchor': 'middle' }); t.textContent = label;
      gCursor.appendChild(t);
    }
    // 近似文本宽度（CJK 字符按 10px、其余 6.1px 估算，避免中文标签把气泡撑爆/裁切）
    function textW(str) { let w = 0; for (const ch of String(str)) { w += ch.charCodeAt(0) > 0x2e80 ? 10 : 6.1; } return w; }
    function drawCursorBubble(cx) {
      const i = steps.indexOf(cursor);
      if (i < 0) return;
      const fv = spec.formatValue || ((v) => fmt(v));
      const head = spec.formatCursor ? spec.formatCursor(cursor) : ('Step ' + cursor);
      const lines = [{ text: head, color: null }];
      spec.series.forEach(s => {
        let v = spec.data[s.key][i];
        // tipCarryForward：当前点为空（如 val 仅 epoch 边界有值）时，回溯取上一个非空值（上一 epoch 的值）
        if ((v == null || !isFinite(v)) && spec.tipCarryForward) {
          for (let j = i - 1; j >= 0; j--) { const pv = spec.data[s.key][j]; if (pv != null && isFinite(pv)) { v = pv; break; } }
        }
        if (v == null || !isFinite(v)) return;
        lines.push({ text: s.label + '  ' + fv(v, s), color: cssVar(s.colorVar) || '#888' });
      });
      // 命中带 label 的区域（如路由坍缩）→ 气泡右上角角标
      let tag = null;
      if (spec.regions) { const r = spec.regions.find(r => r.label && cursor >= Math.min(r.start, r.end) && cursor <= Math.max(r.start, r.end)); if (r) tag = r.label; }
      const lh = 14, padX = 8, padY = 6, sw = 8;
      const tagW = tag ? textW(tag) + 12 : 0;
      let bw = Math.ceil(Math.max(...lines.map(l => (l.color ? sw + 5 : 0) + textW(l.text)))) + padX * 2;
      if (tag) bw = Math.max(bw, Math.ceil(padX + textW(lines[0].text) + 10 + tagW + padX));
      const bh = lines.length * lh + padY * 2;
      let bx = cx + 10; if (bx + bw > P.l + plotW) bx = cx - 10 - bw; if (bx < P.l) bx = P.l + 2;
      const by = P.t + 2;
      const g = el('g', { class: 'pto-tmchart__cursor-tip' });
      g.appendChild(el('rect', { class: 'pto-tmchart__cursor-tip-bg', x: bx, y: by, width: bw, height: bh, rx: 5 }));
      lines.forEach((l, k) => {
        const ty = by + padY + lh * k + 10;
        let tx = bx + padX;
        if (l.color) { g.appendChild(el('rect', { x: bx + padX, y: ty - 8, width: sw, height: sw, rx: 2, fill: l.color })); tx = bx + padX + sw + 5; }
        const t = el('text', { class: l.color ? 'pto-tmchart__cursor-tip-val' : 'pto-tmchart__cursor-tip-step', x: tx, y: ty });
        t.textContent = l.text; g.appendChild(t);
      });
      if (tag) {
        const tx = bx + bw - padX - tagW;
        g.appendChild(el('rect', { class: 'pto-tmchart__cursor-tip-tag-bg', x: tx, y: by + padY - 2, width: tagW, height: 14, rx: 3 }));
        const tt = el('text', { class: 'pto-tmchart__cursor-tip-tag', x: tx + tagW / 2, y: by + padY + 8, 'text-anchor': 'middle' }); tt.textContent = tag;
        g.appendChild(tt);
      }
      gCursor.appendChild(g);
    }

    // 交互 hit-rect
    const hit = el('rect', { class: 'pto-tmchart__plot-hit', x: P.l, y: P.t, width: plotW, height: plotH });
    svg.appendChild(hit);
    const stepFromClient = (clientX) => {
      const r = svg.getBoundingClientRect();
      const vx = (clientX - r.left) / r.width * W;
      const frac = Math.min(1, Math.max(0, (vx - P.l) / plotW));
      const target = x0 + frac * (x1 - x0);
      // 吸附到最近的真实采样点（支持非连续 step，如时间轴每 5s；连续整数 step 时等价于四舍五入）
      let best = steps[0], bd = Infinity;
      for (const s of steps) { const d = Math.abs(s - target); if (d < bd) { bd = d; best = s; } }
      return best;
    };
    // hover（游标 + 气泡）与 brush（框选）解耦：onBrush:false 只关掉框选，hover 仍可用
    if (!opt.compact) {
      const brushEnabled = spec.onBrush !== false;
      let dragging = false, anchor = null;
      hit.addEventListener('pointerdown', (e) => { if (!brushEnabled) return; dragging = true; anchor = stepFromClient(e.clientX); hit.setPointerCapture(e.pointerId); brush = { start: anchor, end: anchor }; drawBrush(); });
      hit.addEventListener('pointermove', (e) => {
        if (dragging) { brush = { start: anchor, end: stepFromClient(e.clientX) }; drawBrush(); }
        else { cursor = stepFromClient(e.clientX); tooltipVisible = true; drawCursor(); if (spec.onCursorHover) spec.onCursorHover(cursor); }
      });
      hit.addEventListener('pointerup', (e) => { if (!brushEnabled) return; dragging = false; if (brush && Math.abs(brush.end - brush.start) >= 1 && spec.onBrush) spec.onBrush({ start: Math.min(brush.start, brush.end), end: Math.max(brush.start, brush.end) }); else { brush = null; drawBrush(); } });
      hit.addEventListener('pointerleave', () => { if (dragging) return; tooltipVisible = false; drawCursor(); if (spec.onCursorLeave) spec.onCursorLeave(); });
    }

    drawRegions(); drawAnomaly(); drawBrush(); drawCursor();

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
      setTooltip(v) { tooltipVisible = !!v; drawCursor(); },
      setAnomalyVisible(v) { anomalyVisible = v; drawAnomaly(); },
      destroy() { host.innerHTML = ''; },
    };
  }
  function fmt(v) { const a = Math.abs(v); if (a >= 1000) return (v / 1000).toFixed(1) + 'k'; if (a >= 10) return v.toFixed(0); if (a >= 1) return v.toFixed(1); return v.toFixed(2); }

  global.PtoTrainingMetricsChart = { render };
})(window);

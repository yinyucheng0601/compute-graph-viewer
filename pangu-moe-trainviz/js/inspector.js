/* ② 权重 / Shape Inspector：Weight Diff(normal vs anomaly 直方图) + 路由热图。
   监听 select：按 weightKey 渲染对应权重。 */
window.Inspector = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  let host = null, tipEl = null;
  const TIPS = {
    shape: 'Shape 表示权重或 dispatch 张量维度；维度变窄说明该 rank 看到的路由/专家分片不完整。',
    stat: 'Stat 是该权重分布的摘要；-inf 或方差塌缩会直接影响 router 打分。',
    dispatch: 'Dispatch shape 是 Gate 将 token 分发到 TP/专家列前的张量形状；Rank2 从 4 列变成 1 列是跨 rank 不一致证据。',
    heatmap: '路由热图显示专家组 × TP rank 的 token 负载；颜色越亮表示负载越高，斜线空白表示 0 token 未激活。',
  };

  function hist(container, data, colorVar, danger) {
    const W = 200, H = 64, n = data.length, bw = W / n;
    const max = Math.max(...data, 0.001);
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'insp-hist', preserveAspectRatio: 'none' });
    const title = svg('title', {});
    title.textContent = danger ? '异常权重分布：最左桶代表 -inf 下溢。' : '正常权重分布：用于和异常 step 对比。';
    s.appendChild(title);
    data.forEach((v, i) => {
      const h = (v / max) * (H - 4);
      const isOver = danger && i === 0;            // 最左桶 = -inf 下溢
      s.appendChild(svg('rect', { x: (i * bw + 0.5).toFixed(1), y: (H - h).toFixed(1), width: (bw - 1).toFixed(1), height: h.toFixed(1),
        fill: isOver ? 'var(--danger)' : `var(${colorVar})`, opacity: isOver ? '0.95' : '0.7' }));
    });
    container.appendChild(s);
  }

  function label(text, className, title) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    if (title) el.title = title;
    return el;
  }

  function heatTitle(row, col, value, anomalyCol) {
    if (col === anomalyCol) {
      return `专家组${row} × TP${col} · 0 token · 未激活：W_gate Rank2 分片 -inf 下溢后，路由分数失效，没有 token 分配到该列。`;
    }
    return `专家组${row} × TP${col} · 负载 ${value.toFixed(2)}：该专家组在此 TP rank 有正常 token 分配。`;
  }

  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'ts-tooltip';
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function placeTip(event) {
    const tip = ensureTip();
    const pad = 14;
    const x = Math.min(window.innerWidth - tip.offsetWidth - pad, event.clientX + 12);
    const y = Math.min(window.innerHeight - tip.offsetHeight - pad, event.clientY + 12);
    tip.style.left = Math.max(pad, x) + 'px';
    tip.style.top = Math.max(pad, y) + 'px';
  }

  function showTip(text, event) {
    const tip = ensureTip();
    tip.textContent = text;
    tip.classList.add('is-visible');
    placeTip(event);
  }

  function hideTip() {
    if (tipEl) tipEl.classList.remove('is-visible');
  }

  function bindTip(el, text) {
    el.dataset.tip = text;
    el.setAttribute('aria-label', text);
    el.addEventListener('mouseenter', e => showTip(text, e));
    el.addEventListener('mousemove', placeTip);
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus', e => {
      const rect = el.getBoundingClientRect();
      showTip(text, { clientX: rect.right, clientY: rect.top });
    });
    el.addEventListener('blur', hideTip);
  }

  function render(weightKey) {
    const w = window.WEIGHT_DATA[weightKey] || window.WEIGHT_DATA.gate;
    host.innerHTML = '';

    // Weight Diff
    const diff = document.createElement('div'); diff.className = 'insp-block';
    diff.innerHTML = `<div class="insp-title">${w.title} · Weight Diff</div>`;
    const cols = document.createElement('div'); cols.className = 'insp-diff';
    const normal = document.createElement('div'); normal.className = 'insp-col';
    normal.title = 'Normal：健康 step 的权重形状和统计分布，作为对照基线。';
    normal.innerHTML = `<div class="insp-col-head"><span class="insp-dot ok"></span>normal</div><div class="insp-shape" title="${TIPS.shape} 当前值：${w.normal.shape.join(' × ')}">${w.normal.shape.join(' × ')}</div><div class="insp-stat" title="${TIPS.stat} 当前值：${w.normal.stat}">${w.normal.stat}</div>`;
    const anom = document.createElement('div'); anom.className = 'insp-col';
    anom.title = `Step ${w.anomaly.step}：异常 step 的权重形状和数值分布。`;
    anom.innerHTML = `<div class="insp-col-head"><span class="insp-dot bad"></span>Step ${w.anomaly.step}</div><div class="insp-shape bad" title="${TIPS.shape} 当前值：${w.anomaly.shape.join(' × ')}">${w.anomaly.shape.join(' × ')}</div><div class="insp-stat bad" title="${TIPS.stat} 当前值：${w.anomaly.note}">${w.anomaly.note}</div>`;
    cols.appendChild(normal); cols.appendChild(anom);
    diff.appendChild(cols);
    const charts = document.createElement('div'); charts.className = 'insp-diff';
    const c1 = document.createElement('div'); c1.className = 'insp-col'; const c2 = document.createElement('div'); c2.className = 'insp-col';
    charts.appendChild(c1); charts.appendChild(c2); diff.appendChild(charts);
    host.appendChild(diff);
    hist(c1, w.normal.hist, '--highlight-l0a-violet-source', false);
    hist(c2, w.anomaly.hist, '--highlight-l0a-violet-source', true);

    // dispatch shape
    const ds = document.createElement('div'); ds.className = 'insp-block';
    ds.innerHTML = `<div class="insp-title">Gate dispatch shape</div>
      <div class="insp-kv" title="${TIPS.dispatch} 其余 rank 正常值：${w.dispatch.normal}"><span>其余 rank</span><code>${w.dispatch.normal}</code></div>
      <div class="insp-kv bad" title="${TIPS.dispatch} Rank2 异常值：${w.dispatch.anomaly}"><span>Rank2</span><code>${w.dispatch.anomaly}</code></div>`;
    host.appendChild(ds);

    // 路由热图
    const hm = w.routingHeatmap;
    const hb = document.createElement('div'); hb.className = 'insp-block';
    hb.innerHTML = `<div class="insp-title">路由热图 <span class="insp-hint" title="${TIPS.heatmap}">行=专家组 · 列=TP rank</span></div>`;
    const grid = document.createElement('div'); grid.className = 'insp-heat';
    grid.style.gridTemplateColumns = `28px repeat(${hm.cols}, var(--insp-heat-cell))`;
    grid.appendChild(label('组', 'insp-heat-label', '每一行是一组 MoGE 专家。'));
    for (let c = 0; c < hm.cols; c++) {
      grid.appendChild(label(`TP${c}`, 'insp-heat-label insp-heat-col', `TP rank ${c}` + (c === hm.anomalyCol ? '：异常空白列。' : '：正常参与路由。')));
    }
    hm.matrix.forEach((row, r) => {
      grid.appendChild(label(`G${r}`, 'insp-heat-label insp-heat-row', `专家组${r}`));
      row.forEach((v, c) => {
        const cell = document.createElement('div'); cell.className = 'insp-heat-cell';
        cell.tabIndex = 0;
        const text = heatTitle(r, c, v, hm.anomalyCol);
        cell.title = text;
        bindTip(cell, text);
        if (c === hm.anomalyCol) { cell.classList.add('blank'); }
        else { cell.style.background = `color-mix(in srgb, var(--highlight-ub-green-source) ${Math.round(v * 100)}%, transparent)`; }
        grid.appendChild(cell);
      });
    });
    hb.appendChild(grid);
    const lg = document.createElement('div'); lg.className = 'insp-heat-legend';
    lg.innerHTML = `<span><i class="sw blank"></i>Rank2 列空白（未激活）</span>`;
    hb.appendChild(lg);
    const cap = document.createElement('div'); cap.className = 'insp-heat-caption';
    cap.textContent = 'Rank2 的 W_gate 分片因 -inf 下溢，路由打分全部失效，没有 token 被分配到 TP2 列，因此整列专家未激活。';
    hb.appendChild(cap);
    host.appendChild(hb);
  }

  function init(el) {
    host = el;
    render('gate');
    Bus.on('select', p => { if (p && p.weightKey) render(p.weightKey); });
  }
  return { init };
})();

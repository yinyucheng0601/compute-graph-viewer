/* ⑤ 分布式通信 dock：物理 NPU mesh（8 DP × 4 TP）+ All-to-All 流量边。
   边粗细/不透明=流量，节点色=利用率，TP Rank2 黑洞 + P2P 气泡。
   传输条单独挂载，是全页唯一播放条，驱动 stepCursor（曲线 + mesh 同步）。 */
window.CommDock = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const D = window.COMM_DATA;
  const VW = 520, VH = 230, PADX = 64, PADY = 22;
  const colX = c => PADX + c * ((VW - PADX * 2) / (D.cols - 1));
  const rowY = r => PADY + r * ((VH - PADY * 2) / (D.rows - 1));
  let gEdges, gNodes, gBubble, range, stepEl, emphCols = [], playing = false, timer = null;
  let cur = window.TS_DATA.defaultStep || window.TS_DATA.collapseStep || window.TS_DATA.faultStep;

  function drawMesh(step) {
    const f = D.flowAt(step);
    gEdges.innerHTML = ''; gNodes.innerHTML = ''; gBubble.innerHTML = '';
    for (let r = 0; r < D.rows; r++) {
      for (let c = 0; c < D.cols - 1; c++) {
        const flow = Math.min(f.colFlow[c], f.colFlow[c + 1]);
        gEdges.appendChild(el('line', { x1: colX(c), y1: rowY(r), x2: colX(c + 1), y2: rowY(r),
          stroke: 'var(--highlight-copy-blue-source)', 'stroke-width': (0.6 + flow * 3.4).toFixed(2),
          opacity: (0.12 + flow * 0.6).toFixed(2), 'stroke-linecap': 'round' }));
      }
    }
    for (let r = 0; r < D.rows; r++) {
      for (let c = 0; c < D.cols; c++) {
        const util = f.colUtil[c], isAnom = (c === D.anomalyTp && f.collapsed);
        const emph = emphCols.includes(c);
        const g = el('g', {});
        if (isAnom) g.appendChild(el('circle', { cx: colX(c), cy: rowY(r), r: 11, fill: 'none', stroke: 'var(--danger)', 'stroke-width': 1, opacity: 0.5 }));
        const node = el('circle', { cx: colX(c), cy: rowY(r), r: 7,
          fill: isAnom ? 'color-mix(in srgb, var(--danger) 22%, transparent)' : `color-mix(in srgb, var(--highlight-ub-green-source) ${Math.round(util * 90)}%, transparent)`,
          stroke: isAnom ? 'var(--danger)' : (emph ? 'var(--primary)' : 'var(--border-strong)'), 'stroke-width': emph || isAnom ? 1.4 : 1 });
        const title = el('title', {}); title.textContent = `${D.devices[r * D.cols + c].rankId} · DP${r} · TP${c} · 利用率 ${(util * 100).toFixed(0)}%` + (isAnom ? ' · All-to-All 黑洞（0 token）' : '');
        node.appendChild(title); g.appendChild(node);
        gNodes.appendChild(g);
      }
    }
    for (let c = 0; c < D.cols; c++) {
      const t = el('text', { x: colX(c), y: VH - 4, 'text-anchor': 'middle', class: 'cd-axis' });
      t.textContent = 'TP' + c + (c === D.anomalyTp && f.collapsed ? ' ⚠' : ''); gNodes.appendChild(t);
    }
    if (f.bubbleCount) {
      for (let i = 0; i < f.bubbleCount; i++) {
        gBubble.appendChild(el('circle', { cx: colX(D.anomalyTp) + 14, cy: rowY(0) - 6 + i * 5, r: 2.2, fill: 'var(--warning)', opacity: 0.85 }));
      }
      const t = el('text', { x: colX(D.anomalyTp) + 22, y: rowY(0) - 2, class: 'cd-bubble-tag' });
      t.textContent = 'P2P 气泡 ×' + f.bubbleCount; gBubble.appendChild(t);
    }
  }

  function setStep(step, broadcast) {
    cur = step; if (range) range.value = step; if (stepEl) stepEl.textContent = 'Step ' + step;
    drawMesh(step);
    if (broadcast) Bus.emit('stepCursor', step);
  }

  function buildMesh(host) {
    host.innerHTML = '';
    const legend = document.createElement('div'); legend.className = 'cd-legend';
    legend.innerHTML = '<span><i class="cd-sw flow"></i>流量(边粗细)</span><span><i class="cd-sw util"></i>利用率</span><span><i class="cd-sw void"></i>Rank2 黑洞</span><span><i class="cd-sw bub"></i>P2P 气泡</span>';
    host.appendChild(legend);
    const stage = document.createElement('div'); stage.className = 'cd-stage';
    const svg = el('svg', { viewBox: `0 0 ${VW} ${VH}`, class: 'cd-svg', preserveAspectRatio: 'xMidYMid meet' });
    gEdges = el('g', {}); gNodes = el('g', {}); gBubble = el('g', {});
    svg.appendChild(gEdges); svg.appendChild(gNodes); svg.appendChild(gBubble);
    stage.appendChild(svg); host.appendChild(stage);
  }

  function buildTransport(host) {
    host.innerHTML = '';
    const tr = document.createElement('div'); tr.className = 'cd-transport';
    tr.innerHTML =
      '<button class="btn btn-icon btn-sm" id="cd-back" title="后退一步">◀</button>' +
      '<button class="btn btn-icon btn-sm" id="cd-play" title="播放/暂停">▶</button>' +
      '<button class="btn btn-icon btn-sm" id="cd-fwd" title="前进一步">▶▮</button>' +
      `<input type="range" class="cd-range" id="cd-range" min="1900" max="2100" step="1" value="${cur}" title="拖动驱动 step 游标（曲线 + mesh 同步）">` +
      '<span class="cd-step" id="cd-step">Step ' + cur + '</span>';
    host.appendChild(tr);
    range = tr.querySelector('#cd-range'); stepEl = tr.querySelector('#cd-step');
    range.addEventListener('input', () => setStep(+range.value, true));
    tr.querySelector('#cd-back').addEventListener('click', () => setStep(Math.max(+range.min, cur - 1), true));
    tr.querySelector('#cd-fwd').addEventListener('click', () => setStep(Math.min(+range.max, cur + 1), true));
    const playBtn = tr.querySelector('#cd-play');
    playBtn.addEventListener('click', () => {
      playing = !playing; playBtn.textContent = playing ? '▮▮' : '▶'; playBtn.classList.toggle('is-selected', playing);
      if (playing) timer = setInterval(() => { let n = cur + 1; if (n > +range.max) n = +range.min; setStep(n, true); }, 220);
      else clearInterval(timer);
    });
  }

  function init(meshHost, transportHost) {
    buildMesh(meshHost);
    buildTransport(transportHost);
    Bus.on('stepCursor', s => { if (s !== cur) setStep(s, false); });
    Bus.on('interestWindow', w => { range.min = w.start; range.max = w.end; if (cur < w.start || cur > w.end) setStep(w.start, true); });
    Bus.on('select', p => { emphCols = (p && p.cols) || []; drawMesh(cur); });
    setStep(cur, false);
  }
  return { init };
})();

window.TrainingStructureV4Ready = (async () => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const EXPERT_PATTERN = /^expert_\d+$/;
  const pattern = window.PtoSwimlaneTaskPattern;
  const viewport = $('timeline-viewport');
  const canvas = $('timeline');
  const ctx = canvas.getContext('2d');
  const graphStage = $('model-graph');
  const detail = $('detail');
  const [schemaResponse, dataResponse] = await Promise.all([
    fetch('./training-timeline-v4.schema.json'),
    fetch('./data/openpangu-moe-incident-step15203.timeline.json'),
  ]);
  if (!schemaResponse.ok || !dataResponse.ok) throw new Error('v4 schema / timeline JSON 加载失败');
  const [schema, input] = await Promise.all([schemaResponse.json(), dataResponse.json()]);
  const dataset = window.TimelineContractV4.validate(input, schema);
  const architectureResponse = await fetch(dataset.model.architectureAsset.uri);
  if (!architectureResponse.ok) throw new Error('timeline 声明的 architecture JSON 加载失败');
  const architectureGraph = await architectureResponse.json();
  const architectureIndex = window.TrainingViewAdaptersV4.validateArchitectureBinding(dataset, architectureGraph);
  const events = dataset.events;
  const byId = new Map(events.map((event) => [event.id, event]));
  const rankById = new Map(dataset.ranks.map((rank) => [rank.globalRank, rank]));
  const groupById = new Map(dataset.epGroups.map((group) => [group.id, group]));
  const expertById = new Map(dataset.expertLoads.map((load) => [load.logicalExpertId, load]));
  const reverseRelations = new Map();
  events.forEach((event) => [...event.blockedBy, ...event.affects].forEach((id) => {
    if (!reverseRelations.has(id)) reverseRelations.set(id, new Set());
    reverseRelations.get(id).add(event.id);
  }));

  const focus = dataset.incident.focus;
  const state = {
    view: 'global',
    stage: focus.stage,
    epGroupId: focus.epGroupId,
    microbatchId: 'all',
    layer: String(focus.layer),
    zoom: 0,
    expanded: new Set(['dp0', ...dataset.stages.map((stage) => `dp0/pp${stage.id}`), focus.epGroupId]),
    eventId: null,
    modelNodeId: null,
    expertId: null,
    graphCollapsed: window.TrainingViewAdaptersV4.defaultCollapsed(dataset, focus.layer),
  };

  const COLORS = {
    forward: '#4369ef',
    backward: '#ff4b7b',
    comm: '#04d793',
    wait: '#737373',
    optimizer: '#ffaa3b',
    hold: '#a855f7',
    misc: '#7c8db8',
  };
  const LABEL = 254;
  const HEADER = 44;
  const ROW = 24;
  const RANK_COLLAPSED = 58;
  const BAR = 15;
  const ZOOMS = [1, 1.5, 2, 4, 8];
  let rows = [];
  let hits = [];
  let width = 0;
  let height = 0;
  let raf = 0;
  let cssStyle;
  let palette;
  let graphController = null;
  let graphScopeKey = `layer:${focus.layer}`;
  let frontViewInput = null;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const css = (name) => cssStyle.getPropertyValue(name).trim();
  const formatMs = (value) => `${Number(value).toFixed(value >= 100 ? 0 : 1)} ms`;
  const formatPercent = (value) => `${(Number(value) * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
  const median = (values) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const valueOrMissing = (value, formatter = String) => value === null || value === undefined ? '未采集' : formatter(value);

  function syncColors() {
    cssStyle = getComputedStyle(document.documentElement);
    palette = pattern.createTaskColormap({ labelColors: COLORS });
  }

  function populateControls() {
    $('stage').innerHTML = dataset.stages.map((stage) => `<option value="${stage.id}">PP${stage.id} · L${stage.first}–L${stage.last}</option>`).join('');
    $('stage').value = String(state.stage);
    $('ep-group').innerHTML = dataset.epGroups.map((group) => `<option value="${escapeHtml(group.id)}">PP${group.stage} · ${group.ranks.length} EP ranks</option>`).join('');
    $('ep-group').value = state.epGroupId;
    const microbatches = [...new Set(events.map((event) => event.microbatchId).filter(Boolean))].sort();
    $('microbatch').innerHTML = '<option value="all">全部 MB</option>' + microbatches.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('');
    $('microbatch').value = state.microbatchId;
  }

  function renderDatasetContext() {
    const training = dataset.training;
    $('structure-title').textContent = `${dataset.model.name} · 模型与路由证据`;
    $('structure-meta').textContent = `L0–L${dataset.model.numHiddenLayers - 1} · Dense ${dataset.model.denseLayers.join(', ')} / MoE ${dataset.model.moeLayers.first}–${dataset.model.moeLayers.last}`;
    $('timeline-title').textContent = `Step ${dataset.step} · 执行时序`;
    $('training-context').textContent = `${dataset.label} · Step ${dataset.step} · PP${training.pp} / EP${training.ep} / DP${training.dp} · 场景声明 ${training.worldSize} Ranks`;
    $('timeline-meta').textContent = `显示 ${dataset.coverage.visibleDp.map((dp) => `DP${dp}`).join(', ')} 切片 · ${dataset.coverage.visibleRanks} / ${training.worldSize} Ranks · ${events.length} Events`;
    const router = dataset.routerMetrics.find((metric) => metric.layer === focus.layer && metric.microbatchId === focus.microbatchId && metric.epGroupId === focus.epGroupId);
    if (!router) throw new Error('incident focus 缺少对应 routerMetrics');
    const hot = expertById.get(router.topExpertId);
    $('kpi-top1').textContent = `${formatPercent(router.topExpertTop1Share)} · E${router.topExpertId}`;
    $('kpi-top1-base').textContent = `基线 ${formatPercent(router.baselineTop1Share)}`;
    $('kpi-owner').textContent = `R${hot.ownerGlobalRank} · EP${hot.epRank}`;
    $('kpi-owner-group').textContent = groupById.get(hot.epGroupId).label;
  }

  function eventInCurrentScope(event) {
    if (state.view === 'stage' && event.stage !== state.stage) return false;
    if (state.view === 'layer' && state.layer !== 'all' && event.layer !== Number(state.layer)) return false;
    if (state.view === 'layer' && state.layer === 'all' && event.layer !== focus.layer) return false;
    if (state.view === 'group' && event.epGroupId !== state.epGroupId) return false;
    if (state.view === 'incident' && (event.end < dataset.incident.timeRange.start || event.start > dataset.incident.timeRange.end)) return false;
    if (state.view === 'forward' && !['forward', 'comm'].includes(event.kind)) return false;
    if (state.view === 'backward' && !['backward', 'comm'].includes(event.kind)) return false;
    return true;
  }

  function currentEvents() {
    return events.filter(eventInCurrentScope);
  }

  function visibleRange() {
    if (state.view === 'incident') return [dataset.incident.timeRange.start, dataset.incident.timeRange.end];
    const scoped = currentEvents();
    if (!scoped.length) return [dataset.stepBounds.start, dataset.stepBounds.end];
    if (state.view === 'global') return [dataset.stepBounds.start, dataset.stepBounds.end];
    return [Math.min(...scoped.map((event) => event.start)), Math.max(...scoped.map((event) => event.end))];
  }

  function relationSet() {
    const set = new Set();
    if (state.eventId) {
      const event = byId.get(state.eventId);
      [...event.blockedBy, ...event.affects, ...(reverseRelations.get(event.id) || [])].forEach((id) => set.add(id));
    }
    return set;
  }

  function selectionMatches(event) {
    if (state.expertId !== null && event.expertIds.includes(state.expertId)) return true;
    if (state.modelNodeId && event.graphNodeIds.includes(state.modelNodeId)) return true;
    if (state.layer !== 'all' && event.layer === Number(state.layer)) return true;
    return false;
  }

  function dedupeSummary(list) {
    const map = new Map();
    list.forEach((event) => {
      const key = [event.label, event.kind, event.status, Math.round(event.start / 10), Math.round(event.end / 10)].join('|');
      if (!map.has(key)) map.set(key, { ...event, id: `summary:${key}`, sourceEventIds: [event.id] });
      else map.get(key).sourceEventIds.push(event.id);
    });
    return [...map.values()];
  }

  function groupMetrics(group, list) {
    const communications = list.filter((event) => event.kind === 'comm').map((event) => event.end - event.start);
    const waits = list.filter((event) => event.kind === 'wait').map((event) => event.end - event.start);
    const abnormalRanks = new Set(list.filter((event) => event.status !== 'normal').map((event) => event.globalRank));
    return `${group.ranks.length} 成员 · 异常 ${abnormalRanks.size} · comm max/median ${formatMs(Math.max(0, ...communications))}/${formatMs(median(communications))} · wait max ${formatMs(Math.max(0, ...waits))}`;
  }

  function buildRows() {
    rows = [];
    const scoped = currentEvents();
    const add = (row) => rows.push({ h: ROW, ...row });
    const dpEvents = scoped.filter((event) => event.dp === 0);
    add({ id: 'dp0', label: 'DP0', meta: `${dataset.coverage.visibleRanks} visible ranks · ${dataset.coverage.mode}`, depth: 0, events: dpEvents, expandable: true, summary: true });
    if (!state.expanded.has('dp0')) return;

    dataset.stages.filter((stage) => state.view !== 'stage' || stage.id === state.stage).forEach((stage) => {
      const stageId = `dp0/pp${stage.id}`;
      const stageEvents = dpEvents.filter((event) => event.stage === stage.id);
      add({ id: stageId, label: `PP${stage.id} · L${stage.first}–L${stage.last}`, meta: `${stageEvents.length} events`, depth: 1, events: stageEvents, expandable: true, summary: true });
      if (!state.expanded.has(stageId)) return;

      dataset.epGroups.filter((group) => group.stage === stage.id && (state.view !== 'group' || group.id === state.epGroupId)).forEach((group) => {
        const groupEvents = stageEvents.filter((event) => event.epGroupId === group.id);
        const critical = groupEvents.some((event) => event.status === 'critical');
        add({ id: group.id, label: `${critical ? '⚠ ' : ''}${group.label}`, meta: groupMetrics(group, groupEvents), depth: 2, events: groupEvents, expandable: true, summary: true, status: critical ? 'critical' : 'normal' });
        if (!state.expanded.has(group.id)) return;

        const orderedMembers = [...group.ranks].sort((left, right) => {
          const leftFocused = focus.rankIds.includes(left.globalRank) ? 0 : 1;
          const rightFocused = focus.rankIds.includes(right.globalRank) ? 0 : 1;
          return leftFocused - rightFocused || left.epRank - right.epRank;
        });
        orderedMembers.forEach((member) => {
          const rank = rankById.get(member.globalRank);
          const rankEvents = groupEvents.filter((event) => event.globalRank === member.globalRank);
          if (!rankEvents.length && state.view !== 'global') return;
          const status = rankEvents.some((event) => event.status === 'critical') ? 'critical' : rankEvents.some((event) => event.status === 'warning') ? 'warning' : 'normal';
          const rankId = `${group.id}/r${rank.globalRank}`;
          add({
            id: rankId,
            label: `${status !== 'normal' ? '⚠ ' : ''}R${rank.globalRank} · EP${rank.epRank}`,
            meta: `node${rank.node}/device${rank.device} · DP${rank.dp}/PP${rank.stage}/TP${rank.tp}`,
            depth: 3,
            events: rankEvents,
            expandable: true,
            rowType: 'rank',
            status,
            h: state.expanded.has(rankId) ? ROW : RANK_COLLAPSED,
          });
          if (!state.expanded.has(rankId)) return;
          const categories = [
            ['compute', '计算', ['forward', 'backward']],
            ['comm', '通信', ['comm']],
            ['wait', '等待', ['wait']],
            ['other', '其他活动', ['optimizer', 'hold', 'misc']],
          ];
          categories.forEach(([key, label, kinds]) => {
            const categoryEvents = rankEvents.filter((event) => kinds.includes(event.kind));
            if (categoryEvents.length) add({ id: `${rankId}/${key}`, label, meta: '', depth: 4, events: categoryEvents, rowType: 'category' });
          });
        });
      });
    });
  }

  function eventsForRow(row) {
    if (row.expandable && state.expanded.has(row.id)) return [];
    if (row.summary) return dedupeSummary(row.events);
    return row.events;
  }

  function rankTrack(event) {
    if (['forward', 'backward'].includes(event.kind)) return 0;
    if (event.kind === 'comm') return 1;
    return 2;
  }

  function scheduleDraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  function roundedRect(context, x, y, w, h, radius) {
    context.beginPath();
    if (context.roundRect) context.roundRect(x, y, w, h, radius);
    else context.rect(x, y, w, h);
  }

  function fitText(value, maxWidth) {
    let text = String(value || '');
    if (ctx.measureText(text).width <= maxWidth) return text;
    while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
    return `${text}…`;
  }

  function drawExpand(row, x, y) {
    if (!row.expandable) return null;
    const size = 14;
    const top = y + (row.h - size) / 2;
    ctx.save();
    roundedRect(ctx, x, top, size, size, 4);
    ctx.fillStyle = css('--surface-2');
    ctx.strokeStyle = css('--border-strong');
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = css('--foreground');
    ctx.font = `700 11px ${css('--font-mono')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.expanded.has(row.id) ? '−' : '+', x + size / 2, top + size / 2);
    ctx.restore();
    return { x, y: top, w: size, h: size };
  }

  function drawRowLabel(row, y, index) {
    ctx.fillStyle = index % 2 ? css('--surface-1') : css('--background');
    ctx.fillRect(0, y, LABEL, row.h);
    const indent = 12 + row.depth * 15;
    const expand = drawExpand(row, indent, y);
    const x = indent + (expand ? 20 : 0);
    const maxWidth = LABEL - x - 10;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, maxWidth, row.h);
    ctx.clip();
    ctx.fillStyle = row.status === 'critical' ? css('--danger') : row.status === 'warning' ? css('--warning') : css('--foreground');
    ctx.font = `600 12px ${css('--font-sans')}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (row.rowType === 'rank' && !state.expanded.has(row.id)) {
      ctx.fillText(fitText(row.label, maxWidth), x, y + 13);
      ctx.font = `400 10px ${css('--font-sans')}`;
      ctx.fillStyle = css('--foreground-muted');
      ctx.fillText(fitText(row.meta, maxWidth), x, y + 29);
      ctx.textAlign = 'right';
      ['计算', '通信', '其他活动'].forEach((label, track) => ctx.fillText(label, LABEL - 10, y + 11 + track * 17));
    } else {
      ctx.fillText(fitText(row.label, maxWidth), x, y + row.h / 2);
      const used = ctx.measureText(row.label).width + 8;
      if (row.meta && maxWidth - used > 40) {
        ctx.font = `400 10px ${css('--font-sans')}`;
        ctx.fillStyle = css('--foreground-muted');
        ctx.fillText(fitText(row.meta, maxWidth - used), x + used, y + row.h / 2);
      }
    }
    ctx.restore();
    hits.push({ x: 0, y, w: LABEL, h: row.h, row });
  }

  function draw() {
    width = viewport.clientWidth;
    height = viewport.clientHeight;
    if (width < 1 || height < 1) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const [rangeStart, rangeEnd] = visibleRange();
    const totalWidth = LABEL + Math.max(1, width - LABEL) * ZOOMS[state.zoom];
    const scale = Math.max(0.001, (totalWidth - LABEL - 16) / Math.max(1, rangeEnd - rangeStart));
    const xForTime = (time) => LABEL + (time - rangeStart) * scale - viewport.scrollLeft;
    const totalHeight = HEADER + rows.reduce((sum, row) => sum + row.h, 0);
    $('timeline-extent').style.width = `${totalWidth}px`;
    $('timeline-extent').style.height = `${Math.max(height, totalHeight)}px`;
    hits = [];
    ctx.fillStyle = css('--background');
    ctx.fillRect(0, 0, width, height);

    const tick = [10, 20, 50, 100, 200, 500, 1000, 2000].find((candidate) => candidate * scale >= 60) || 5000;
    ctx.strokeStyle = css('--border-subtle');
    for (let time = Math.ceil(rangeStart / tick) * tick; time <= rangeEnd; time += tick) {
      const x = xForTime(time);
      if (x < LABEL || x > width) continue;
      ctx.beginPath(); ctx.moveTo(x + 0.5, HEADER); ctx.lineTo(x + 0.5, height); ctx.stroke();
    }

    const relations = relationSet();
    let y = HEADER - viewport.scrollTop;
    rows.forEach((row, index) => {
      const top = y;
      y += row.h;
      if (y < HEADER || top > height) return;
      if (index % 2) {
        ctx.fillStyle = css('--surface-disabled');
        ctx.fillRect(LABEL, top, width - LABEL, row.h);
      }
      ctx.strokeStyle = css('--border-subtle');
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.rect(LABEL, Math.max(HEADER, top), width - LABEL, Math.min(row.h, y - HEADER)); ctx.clip();
      const displayEvents = eventsForRow(row);
      displayEvents.forEach((event, eventIndex) => {
        if (event.end < rangeStart || event.start > rangeEnd) return;
        const barX = xForTime(Math.max(event.start, rangeStart));
        const barW = Math.max(event.kind === 'comm' ? 5 : 3, xForTime(Math.min(event.end, rangeEnd)) - barX);
        const track = row.rowType === 'rank' && !state.expanded.has(row.id) ? rankTrack(event) : Math.min(2, eventIndex % 3);
        const barY = row.rowType === 'rank' && !state.expanded.has(row.id) ? top + 3 + track * 17 : top + (row.h - BAR) / 2;
        const sourceIds = event.sourceEventIds || [event.id];
        const selected = sourceIds.includes(state.eventId);
        const related = sourceIds.some((id) => relations.has(id)) || selectionMatches(event);
        const microbatchActive = state.microbatchId === 'all' || event.microbatchId === state.microbatchId;
        ctx.save();
        ctx.globalAlpha = state.eventId || state.modelNodeId || state.expertId !== null || state.layer !== 'all'
          ? (selected || related ? 1 : 0.2)
          : (microbatchActive ? 1 : 0.2);
        pattern.drawTaskBar(ctx, {
          x: barX,
          y: barY,
          width: barW,
          height: BAR,
          baseColor: palette.colorForTask({ colorKey: event.kind, label: event.kind }),
          task: { label: event.label, opName: event.label, status: event.status, duration: event.end - event.start },
          isSelected: selected,
          isRelated: related && !selected,
          isEmphasized: event.status !== 'normal',
          fontFamily: css('--font-mono'),
        });
        ctx.restore();
        hits.push({ x: Math.max(LABEL, barX), y: barY, w: Math.max(1, Math.min(width, barX + barW) - Math.max(LABEL, barX)), h: BAR, event });
      });
      ctx.restore();
      drawRowLabel(row, top, index);
    });

    ctx.fillStyle = css('--surface-2');
    ctx.fillRect(0, 0, width, HEADER);
    ctx.fillStyle = css('--foreground-muted');
    ctx.font = `500 10px ${css('--font-mono')}`;
    ctx.textAlign = 'center';
    for (let time = Math.ceil(rangeStart / tick) * tick; time <= rangeEnd; time += tick) {
      const x = xForTime(time);
      if (x >= LABEL + 20 && x <= width - 12) ctx.fillText(`${time} ms`, x, 18);
    }
    ctx.textAlign = 'left';
    ctx.fillText(`${rangeStart} ms`, LABEL + 4, 36);
    ctx.textAlign = 'right';
    ctx.fillText(`${rangeEnd} ms`, width - 12, 36);
    ctx.fillStyle = css('--surface-2');
    ctx.fillRect(0, 0, LABEL, HEADER);
    ctx.fillStyle = css('--foreground');
    ctx.textAlign = 'left';
    ctx.font = `600 11px ${css('--font-sans')}`;
    ctx.fillText('泳道 / 资源对象', 12, 20);
    ctx.fillStyle = css('--foreground-muted');
    ctx.font = `400 10px ${css('--font-sans')}`;
    ctx.fillText('Global Rank ≠ EP Rank', 12, 36);
    ctx.strokeStyle = css('--border-default');
    ctx.beginPath(); ctx.moveTo(LABEL - 0.5, 0); ctx.lineTo(LABEL - 0.5, height); ctx.stroke();
    $('range-label').textContent = `${rangeStart}–${rangeEnd} ms`;
  }

  function hitAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return [...hits].reverse().find((hit) => x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h);
  }

  function eventRelationText(ids) {
    if (!ids.length) return '无';
    return ids.map((id) => byId.get(id)).filter(Boolean).map((event) => `${event.label} / R${event.globalRank}`).join('；');
  }

  function detailRows(rowsInput) {
    return `<dl class="detail-grid">${rowsInput.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>`;
  }

  function eventHtml(event) {
    const rank = rankById.get(event.globalRank);
    const anomaly = event.anomaly;
    const communication = event.communication;
    const provenance = event.provenanceIds.map((id) => dataset.provenance.find((item) => item.id === id)?.label || id).join('；');
    const baseline = anomaly?.baselineDuration;
    const duration = event.end - event.start;
    const routerMetric = dataset.routerMetrics.find((metric) => metric.layer === event.layer
      && metric.microbatchId === event.microbatchId
      && metric.epGroupId === event.epGroupId);
    return `
      <section class="detail-section">
        <h4 class="${event.status === 'critical' ? 'status-critical' : event.status === 'warning' ? 'status-warning' : ''}">${event.status === 'normal' ? '' : '⚠ '}${escapeHtml(event.label)}</h4>
        ${detailRows([
          ['类型 / 状态', `${event.kind} / ${event.status} / ${event.diagnosisRole}`],
          ['时间', `${formatMs(event.start)} → ${formatMs(event.end)} · ${formatMs(duration)}`],
          ['基线', valueOrMissing(baseline, formatMs)],
          ['偏差', baseline == null ? '未采集' : `+${formatMs(duration - baseline)} · ${(duration / baseline).toFixed(1)}×`],
          ['判据', anomaly?.threshold || '未采集'],
          ['Reason code', anomaly?.reasonCode || '未采集'],
        ])}
      </section>
      ${routerMetric ? `<section class="detail-section">
        <h4>Router 负载证据</h4>
        ${detailRows([
          ['Top1 Expert', `${formatPercent(routerMetric.topExpertTop1Share)} · E${routerMetric.topExpertId} · 基线 ${formatPercent(routerMetric.baselineTop1Share)}`],
          ['Top1 Idle', `${routerMetric.idleTop1Experts} / ${dataset.model.expertCount} · 基线 ${routerMetric.baselineIdleTop1Experts}`],
          ['Load CV', `${routerMetric.loadCv.toFixed(2)}×`],
        ])}
      </section>` : ''}
      <section class="detail-section">
        <h4>资源与模型定位</h4>
        ${detailRows([
          ['Global / EP Rank', `R${event.globalRank} / EP${event.epRank}`],
          ['EP Group', event.epGroupId],
          ['设备', `node${rank.node} / device${rank.device}`],
          ['并行坐标', `DP${event.dp} / PP${event.stage} / TP${event.tp}`],
          ['Microbatch / Layer', `${event.microbatchId || '未标注'} / ${event.layer == null ? '未绑定' : `L${event.layer}`}`],
          ['模型节点', event.graphNodeIds.join(' → ') || '未绑定'],
          ['Expert', event.expertIds.length ? event.expertIds.map((id) => `E${id}`).join(', ') : '未绑定'],
        ])}
      </section>
      <section class="detail-section">
        <h4>通信与因果</h4>
        ${detailRows([
          ['Primitive / Phase', communication ? `${communication.primitive} / ${communication.phase}` : '非通信事件'],
          ['Send / Recv tokens', communication ? `${valueOrMissing(communication.sendTokens)} / ${valueOrMissing(communication.recvTokens)}` : '未采集'],
          ['Send / Recv bytes', communication ? `${valueOrMissing(communication.sendBytes)} / ${valueOrMissing(communication.recvBytes)}` : '未采集'],
          ['Bandwidth', communication ? valueOrMissing(communication.bandwidthGBps, (value) => `${value} GB/s`) : '未采集'],
          ['Wait', communication ? valueOrMissing(communication.waitDuration, formatMs) : event.kind === 'wait' ? formatMs(duration) : '未采集'],
          ['Stream / Task', `${event.stream} / ${event.taskId || '未采集'}`],
          ['Participants', event.participants.length ? `${event.participants.length} ranks · ${event.participants.slice(0, 8).map((id) => `R${id}`).join(', ')}${event.participants.length > 8 ? '…' : ''}` : '未采集'],
          ['Blocked by', eventRelationText(event.blockedBy)],
          ['Affects', eventRelationText(event.affects)],
          ['证据来源', provenance],
        ])}
      </section>
      <div class="event-popover-actions">
        ${event.microbatchId ? `<button class="btn btn-solid btn-sm" data-trace="${escapeHtml(event.microbatchId)}">追踪 ${escapeHtml(event.microbatchId)}</button>` : ''}
        ${event.expertIds.length ? `<button class="btn btn-ghost btn-sm" data-expert="${event.expertIds[0]}">查看 E${event.expertIds[0]}</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-close>关闭</button>
      </div>`;
  }

  function showPopover(html, pointer, title = '事件详情') {
    pattern.hideTooltip(hover.tooltip);
    detail.innerHTML = `<header class="panel-shell-header"><h3 class="panel-shell-title">${escapeHtml(title)}</h3><button class="btn btn-ghost btn-sm panel-shell-close" data-close aria-label="关闭详情">✕</button></header><div class="panel-shell-body">${html}</div>`;
    detail.hidden = false;
    detail.classList.add('is-visible');
    requestAnimationFrame(() => {
      const bounds = detail.getBoundingClientRect();
      detail.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 12, (pointer?.clientX || innerWidth / 2) + 12))}px`;
      detail.style.top = `${Math.max(8, Math.min(innerHeight - bounds.height - 12, (pointer?.clientY || 80) + 12))}px`;
    });
  }

  function closePopover() {
    detail.hidden = true;
    detail.classList.remove('is-visible');
    $('fidelity').setAttribute('aria-expanded', 'false');
    $('hierarchy').setAttribute('aria-expanded', 'false');
  }

  function eventGraphTarget(event) {
    return event.graphNodeIds
      .map((nodeId) => window.TrainingViewAdaptersV4.resolveFrontViewNodeId(frontViewInput, nodeId))
      .find(Boolean) || null;
  }

  function renderArchitecture({ preserveTransform = false, fit = false } = {}) {
    const selectedLayer = Number(state.layer);
    const nextScopeKey = `layer:${selectedLayer}`;
    if (nextScopeKey !== graphScopeKey) {
      state.graphCollapsed = window.TrainingViewAdaptersV4.defaultCollapsed(dataset, selectedLayer);
      graphScopeKey = nextScopeKey;
      preserveTransform = false;
    }
    graphController?.destroy?.();
    frontViewInput = window.TrainingViewAdaptersV4.buildModelFrontViewInput(dataset, architectureGraph, {
      selectedLayer,
      collapsedIds: state.graphCollapsed,
      selectedNodeId: state.modelNodeId,
    });
    graphController = window.PtoModelArchitectureFrontView.render(graphStage, frontViewInput, {
      ariaLabel: `${dataset.model.name} layer ${selectedLayer} source architecture`,
      theme: document.documentElement.dataset.theme,
      autoFit: true,
      collapsedIds: state.graphCollapsed,
      selectedNodeId: state.modelNodeId,
      onToggle: ({ nodeId, collapsedIds }) => {
        state.graphCollapsed = new Set(collapsedIds);
        state.modelNodeId = nodeId;
        update();
      },
      onSelect: ({ nodeId, source }) => {
        if (source !== 'graph' && source !== 'keyboard') return;
        const canonicalNodeId = nodeId.replace(/\/__anchor$/, '');
        state.modelNodeId = canonicalNodeId;
        state.eventId = null;
        const expertMatch = canonicalNodeId.match(/^expert_(\d+)$/);
        state.expertId = expertMatch ? Number(expertMatch[1]) : null;
        update();
      },
      onLayerChange: ({ layerIndex }) => selectLayer(layerIndex),
    });
    if (fit) requestAnimationFrame(() => graphController?.fit?.());
    if (state.modelNodeId) requestAnimationFrame(() => graphController?.selectNode?.(state.modelNodeId, { source: 'focus' }));
    return frontViewInput;
  }

  function focusGraphNode(nodeId, layer = Number(state.layer)) {
    if (Number.isInteger(layer)) state.layer = String(layer);
    const selectedLayer = Number(state.layer);
    const nextScopeKey = `layer:${selectedLayer}`;
    if (nextScopeKey !== graphScopeKey) {
      state.graphCollapsed = window.TrainingViewAdaptersV4.defaultCollapsed(dataset, selectedLayer);
      graphScopeKey = nextScopeKey;
    }
    if (EXPERT_PATTERN.test(nodeId || '')) state.graphCollapsed.delete('routed_expert_bank');
    renderArchitecture({ preserveTransform: false });
    const target = window.TrainingViewAdaptersV4.resolveFrontViewNodeId(frontViewInput, nodeId);
    state.modelNodeId = target;
    if (target) requestAnimationFrame(() => graphController?.selectNode?.(target, { source: 'focus' }));
    return Boolean(target);
  }

  function selectLayer(layerIndex) {
    const layer = Number(layerIndex);
    if (!Number.isInteger(layer) || layer < 0 || layer >= dataset.model.numHiddenLayers) return;
    state.layer = String(layer);
    state.eventId = null;
    state.expertId = null;
    state.modelNodeId = null;
    const stage = dataset.stages.find((item) => layer >= item.first && layer <= item.last);
    state.stage = stage.id;
    renderArchitecture({ preserveTransform: false });
    update();
  }

  function selectEvent(event, pointer) {
    state.eventId = event.id;
    state.modelNodeId = null;
    state.expertId = null;
    if (event.layer !== null) {
      state.layer = String(event.layer);
    }
    state.stage = event.stage;
    state.epGroupId = event.epGroupId;
    state.expanded.add('dp0');
    state.expanded.add(`dp0/pp${event.stage}`);
    state.expanded.add(event.epGroupId);
    focusGraphNode(eventGraphTarget(event), event.layer);
    showPopover(eventHtml(event), pointer);
    update();
  }

  function clearSelection() {
    state.eventId = null;
    state.modelNodeId = null;
    state.expertId = null;
    closePopover();
    update();
  }

  function selectExpert(expertId) {
    const load = expertById.get(Number(expertId));
    if (!load) return;
    state.expertId = load.logicalExpertId;
    state.eventId = null;
    state.modelNodeId = `expert_${load.logicalExpertId}`;
    state.layer = String(load.layer);
    state.stage = groupById.get(load.epGroupId).stage;
    state.epGroupId = load.epGroupId;
    state.expanded.add('dp0');
    state.expanded.add(`dp0/pp${state.stage}`);
    state.expanded.add(load.epGroupId);
    state.graphCollapsed = window.TrainingViewAdaptersV4.defaultCollapsed(dataset, load.layer);
    state.graphCollapsed.delete('routed_expert_bank');
    graphScopeKey = `layer:${load.layer}`;
    renderArchitecture({ preserveTransform: false });
    update();
  }

  function selectionCopy() {
    if (state.eventId) {
      const event = byId.get(state.eventId);
      return `${event.status === 'normal' ? '' : '⚠ '}${event.label} · R${event.globalRank} / EP${event.epRank} · ${event.epGroupId} · ${event.microbatchId || 'step'} · ${event.layer == null ? '无 Layer' : `L${event.layer}`}`;
    }
    if (state.expertId !== null) {
      const load = expertById.get(state.expertId);
      return `E${load.logicalExpertId} · Top1 ${formatPercent(load.top1Share)} · owner R${load.ownerGlobalRank} / EP${load.epRank} · logical Expert 与物理 placement 已对齐`;
    }
    if (state.modelNodeId) return `${state.modelNodeId} · 已强调同 Layer 关联事件`;
    if (state.layer !== 'all') return `L${state.layer} · 仅强调该 Layer 事件，step 时间范围不变`;
    return '异常已展开到 PP3 / EP Group，但未自动选中事件。';
  }

  function updateControls() {
    $('view').value = state.view;
    $('stage').value = String(state.stage);
    $('ep-group').value = state.epGroupId;
    $('microbatch').value = state.microbatchId;
    $('stage').hidden = !['stage', 'forward', 'backward'].includes(state.view);
    $('ep-group').hidden = state.view !== 'group';
    [['view', state.view !== 'global'], ['stage', state.view === 'stage'], ['ep-group', state.view === 'group'], ['microbatch', state.microbatchId !== 'all']].forEach(([id, active]) => $(id).classList.toggle('is-active', active));
    $('selection-copy').textContent = selectionCopy();
    $('trace').hidden = !state.eventId || !byId.get(state.eventId).microbatchId || state.microbatchId === byId.get(state.eventId).microbatchId;
    $('clear').hidden = !state.eventId && !state.modelNodeId && state.expertId === null && state.microbatchId === 'all';
    $('show-incident').hidden = state.view === 'incident';
  }

  function update() {
    buildRows();
    updateControls();
    scheduleDraw();
  }

  const hover = pattern.initHoverTooltip({
    root: canvas,
    targets: [canvas],
    appendTo: $('timeline-pane'),
    bounds: $('timeline-pane'),
    tooltipOptions: { className: 'training-brief-tip' },
    getTask: (_, event) => hitAt(event),
    getTooltipHtml: (hit) => {
      if (hit?.event) {
        const event = hit.event;
        return `<div class="pto-swimlane-task-tooltip__title">${escapeHtml(event.label)}</div><div class="pto-swimlane-task-tooltip__row"><span class="pto-swimlane-task-tooltip__key">状态</span><span class="pto-swimlane-task-tooltip__value">${escapeHtml(event.status)} / ${escapeHtml(event.diagnosisRole)}</span></div><div class="pto-swimlane-task-tooltip__row"><span class="pto-swimlane-task-tooltip__key">定位</span><span class="pto-swimlane-task-tooltip__value">R${event.globalRank} / EP${event.epRank} · ${event.layer == null ? '无 Layer' : `L${event.layer}`}</span></div><div class="pto-swimlane-task-tooltip__row"><span class="pto-swimlane-task-tooltip__key">时长</span><span class="pto-swimlane-task-tooltip__value">${formatMs(event.end - event.start)}</span></div>`;
      }
      if (hit?.row) return escapeHtml(`${hit.row.label} · ${hit.row.meta || '点击展开/收起'}`);
      return '';
    },
  });

  canvas.addEventListener('pointermove', (event) => {
    const hit = hitAt(event);
    canvas.style.cursor = hit?.event || hit?.row?.expandable ? 'pointer' : 'default';
  });
  canvas.addEventListener('click', (pointer) => {
    const hit = hitAt(pointer);
    if (hit?.event) return selectEvent(hit.event.sourceEventIds ? byId.get(hit.event.sourceEventIds[0]) : hit.event, pointer);
    if (hit?.row?.expandable) {
      state.expanded.has(hit.row.id) ? state.expanded.delete(hit.row.id) : state.expanded.add(hit.row.id);
      closePopover();
      update();
      return;
    }
    clearSelection();
  });
  canvas.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowLeft', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    const candidates = currentEvents().filter((item) => state.microbatchId === 'all' || item.microbatchId === state.microbatchId).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    if (!candidates.length) return;
    let index = Math.max(0, candidates.findIndex((item) => item.id === state.eventId));
    if (event.key === 'ArrowRight') index = (index + 1) % candidates.length;
    if (event.key === 'ArrowLeft') index = (index - 1 + candidates.length) % candidates.length;
    const rect = canvas.getBoundingClientRect();
    selectEvent(candidates[index], { clientX: rect.left + LABEL + 30, clientY: rect.top + 80 });
  });

  $('view').addEventListener('change', (event) => {
    state.view = event.target.value;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    closePopover();
    update();
  });
  $('stage').addEventListener('change', (event) => { state.stage = Number(event.target.value); viewport.scrollTop = 0; update(); });
  $('ep-group').addEventListener('change', (event) => { state.epGroupId = event.target.value; const group = groupById.get(state.epGroupId); state.stage = group.stage; state.expanded.add(group.id); viewport.scrollTop = 0; update(); });
  $('microbatch').addEventListener('change', (event) => { state.microbatchId = event.target.value; update(); });
  $('show-incident').addEventListener('click', () => { state.view = 'incident'; state.stage = focus.stage; state.epGroupId = focus.epGroupId; viewport.scrollLeft = 0; viewport.scrollTop = 0; update(); });
  $('trace').addEventListener('click', () => { const event = byId.get(state.eventId); if (event?.microbatchId) state.microbatchId = event.microbatchId; update(); });
  $('clear').addEventListener('click', clearSelection);

  function setZoom(next) {
    const old = ZOOMS[state.zoom];
    state.zoom = Math.max(0, Math.min(ZOOMS.length - 1, next));
    $('zoom').value = String(state.zoom);
    $('zoom-value').textContent = `${ZOOMS[state.zoom]}×`;
    $('zoom-out').disabled = state.zoom === 0;
    $('zoom-in').disabled = state.zoom === ZOOMS.length - 1;
    viewport.scrollLeft = (viewport.scrollLeft + Math.max(1, width - LABEL) / 2) * ZOOMS[state.zoom] / old - Math.max(1, width - LABEL) / 2;
    scheduleDraw();
  }
  $('zoom').addEventListener('input', (event) => setZoom(Number(event.target.value)));
  $('zoom-out').addEventListener('click', () => setZoom(state.zoom - 1));
  $('zoom-in').addEventListener('click', () => setZoom(state.zoom + 1));

  $('theme').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    renderArchitecture({ preserveTransform: true });
    syncColors();
    scheduleDraw();
  });

  $('fidelity').addEventListener('click', (event) => {
    if ($('fidelity').getAttribute('aria-expanded') === 'true') return closePopover();
    closePopover();
    $('fidelity').setAttribute('aria-expanded', 'true');
    showPopover(`<section class="detail-section"><h4>模拟事故复盘</h4>${detailRows([
      ['数据信度', '模拟，非 openPangu 实测 Profiling'],
      ['固定入口', `Step ${dataset.step}`],
      ['全局上下文', `DP${dataset.training.dp} / PP${dataset.training.pp} / TP${dataset.training.tp} / EP${dataset.training.ep} / ${dataset.training.worldSize} ranks`],
      ['Rank 数来源', `${dataset.training.worldSizePolicy.kind} · ${dataset.training.worldSizePolicy.source}`],
      ['可视覆盖', dataset.coverage.note],
      ['事故脚本', dataset.incident.summary],
      ['结构依据', `${dataset.model.architectureAsset.id} · ${dataset.model.architectureAsset.graphContentHash.slice(0, 12)}…`],
      ['时序依据', dataset.provenance.find((item) => item.id === 'incident-simulation')?.label || 'incident simulation'],
    ])}</section>`, event, '数据边界');
  });
  $('hierarchy').addEventListener('click', (event) => {
    if ($('hierarchy').getAttribute('aria-expanded') === 'true') return closePopover();
    closePopover();
    $('hierarchy').setAttribute('aria-expanded', 'true');
    showPopover(`<section class="detail-section"><h4>EP 感知资源树</h4><p>DP Replica → PP Stage → EP Group → Global Rank / EP Rank → 计算、通信、等待、其他活动。</p><p>EP Group 和成员来自数据契约，页面不使用 rank % EP 推断。Microbatch 是横跨泳道的焦点，不是资源树父节点。空白不等于等待，只有显式 wait 事件才计入。</p></section>`, event, '泳道语义');
  });

  detail.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) closePopover();
    const trace = event.target.closest('[data-trace]');
    if (trace) { state.microbatchId = trace.dataset.trace; closePopover(); update(); }
    const expert = event.target.closest('[data-expert]');
    if (expert) { closePopover(); selectExpert(Number(expert.dataset.expert)); }
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') clearSelection(); });
  document.addEventListener('pointerdown', (event) => {
    if (!detail.hidden && !detail.contains(event.target) && !event.target.closest('#fidelity, #hierarchy, #timeline')) closePopover();
  });

  viewport.addEventListener('scroll', () => { pattern.hideTooltip(hover.tooltip); scheduleDraw(); }, { passive: true });
  new ResizeObserver(scheduleDraw).observe(viewport);
  populateControls();
  renderDatasetContext();
  syncColors();
  renderArchitecture({ preserveTransform: false });
  update();
  setZoom(0);

  window.TrainingStructureV4Demo = Object.freeze({
    dataset,
    architectureGraph,
    architectureIndex,
    getRows: () => rows,
    getHits: () => hits,
    getState: () => ({ ...state, expanded: [...state.expanded], graphCollapsed: [...state.graphCollapsed] }),
    selectExpert,
    selectEvent: (id) => selectEvent(byId.get(id), { clientX: LABEL + 24, clientY: 80 }),
    clearSelection,
    visibleRange,
  });
})();

window.TrainingStructureV4Ready.catch((error) => {
  const copy = document.getElementById('selection-copy');
  copy.textContent = `v4 数据加载或校验失败：${error.message}`;
  copy.setAttribute('role', 'alert');
  console.error(error);
});

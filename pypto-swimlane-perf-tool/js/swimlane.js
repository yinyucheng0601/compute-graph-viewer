/**
 * swimlane.js - 泳道图渲染模块
 *
 * 架构：原生滚动模式
 *   canvas 宽度 = duration × xScale（执行总时长对应的像素宽度）
 *   水平位置 = viewport.scrollLeft，由浏览器原生控制
 *   → 时间轴长度天然等于执行总时长，不可能超出
 *   → 滚轮仅缩放时间粒度，拖拽改变水平位置
 */

'use strict';

const SWIMLANE_CONFIG = {
  ROW_HEIGHT: 22,
  ROW_PADDING: 3,
  LABEL_WIDTH: 120,
  TIME_AXIS_HEIGHT: 30,
  MIN_TASK_WIDTH: 1,
  ZOOM_FACTOR: 1.25,
  BG_COLOR: '#111111',
  LABEL_BG: '#1B1B1B',
  LABEL_TEXT: '#B5B5B5',
  AXIS_COLOR: 'rgba(255, 255, 255, 0.12)',
  TICK_COLOR: '#8D8D8D',
  GRID_COLOR: 'rgba(255, 255, 255, 0.06)',
  BUBBLE_COLOR: 'rgba(239, 68, 68, 0.15)',
  SELECTED_ROW_BG: 'rgba(255, 255, 255, 0.05)',
  BOTTLENECK_ROW_BG: 'rgba(255, 255, 255, 0.04)',
};

// 分组统一改为中性灰，避免 lanes 产生蓝绿紫底色。
const GROUP_PALETTE = [
  { bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.12)', text: '#B5B5B5' },
  { bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.12)', text: '#B5B5B5' },
  { bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.12)', text: '#B5B5B5' },
  { bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.12)', text: '#B5B5B5' },
  { bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.12)', text: '#B5B5B5' },
  { bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.12)', text: '#B5B5B5' },
  { bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.12)', text: '#B5B5B5' },
  { bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.12)', text: '#B5B5B5' },
];

const STITCH_COLORS = ['#7b57bf', '#4d79d4', '#4da56d', '#d98f55', '#45b5c4', '#c86aa0', '#00a6fb', '#eab308'];
const LABEL_COLORS = {
  fake: '#5f6775',
  'Prolog-Quant': '#7b57bf',
  'Query-Linear': '#4d79d4',
  'Query-Dequant': '#5b8cff',
  'Query-Hadamard': '#45b5c4',
  'Weight-Linear': '#d98f55',
  'Key-Linear': '#4da56d',
  'Key-Hadamard': '#72c37f',
  'Key-LayerNorm': '#c86aa0',
  'Key-Rope2D': '#eab308',
};
const LANE_KIND_COLORS = {
  fake: '#5f6775',
  aic: '#4d79d4',
  aiv: '#7b57bf',
  aicpu: '#4da56d',
  other: '#8b93a1',
};
const MIN_BAR_SEGMENT_COUNTS_PX = 84;

function stableHash(input) {
  let hash = 2166136261;
  const value = String(input || '');
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hueColor(input, saturation, lightness) {
  const hash = stableHash(input);
  const hue = hash % 360;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function colorForTask(task, mode = 'semantic') {
  if (mode === 'stitch') {
    const index = Math.abs(task.seqNo || 0) % STITCH_COLORS.length;
    return STITCH_COLORS[index];
  }
  if (mode === 'engine') {
    return LANE_KIND_COLORS[task.laneKind] || LANE_KIND_COLORS.other;
  }
  if (mode === 'subgraph') {
    const key = task.subgraphKey || task.subGraphId || task.leafHash || task.label;
    return hueColor(key, 58, 56);
  }
  return LABEL_COLORS[task.label] || hueColor(task.label, 54, 54);
}

function buildTaskSegmentSpec(task, widthPx) {
  const semantic = String(task?.label || task?.displayName || task?.rawName || 'compute');
  const inputCount = Array.isArray(task?.inputRawMagic) ? task.inputRawMagic.length : 0;
  const outputCount = Array.isArray(task?.outputRawMagic) ? task.outputRawMagic.length : 0;
  const showCounts = widthPx >= MIN_BAR_SEGMENT_COUNTS_PX;
  return [
    { key: 'in', text: showCounts ? `IN ${inputCount}` : 'IN' },
    { key: 'compute', text: semantic },
    { key: 'out', text: showCounts ? `OUT ${outputCount}` : 'OUT' },
  ];
}

class SwimlaneRenderer {
  constructor(container, labelContainer) {
    this.container = container;       // #swimlaneCanvas div
    this.labelContainer = labelContainer; // #swimlaneLabel div
    this.canvas = null;
    this.labelCanvas = null;
    this.ctx = null;
    this.labelCtx = null;

    // 数据
    this.parsedData = null;
    this.analysisResult = null;
    this.sortedCores = [];
    this.visibleCores = new Set();
    this.bottleneckCores = new Set();
    this.visibleCoresCache = [];

    // 缩放状态（水平位置由 viewport.scrollLeft 管理）
    this.xScale = 1;        // px / μs

    // 悬停 / 选中
    this.hoveredCore = null;
    this.hoveredEvent = null;
    this.selectedCore = null;
    this.selectedEvent = null;
    this.relatedEvents = [];

    // 垂直滚动位置（用于时间轴 sticky 效果）
    this.yScrollTop = 0;

    // 拖拽平移
    this.isDragging = false;
    this.dragStartClientX = 0;
    this.dragStartScrollLeft = 0;

    // 过滤
    this.showAIC = true;
    this.showAIV = true;
    this.showBubbles = true;
    this.highlightBottlenecks = true;
    this.showGroups = true;
    this.renderPending = false;
    this.labelsPending = false;
    this.lastHoverPoint = null;

    // 分组数据
    this.groupBands = [];

    // 外部回调
    this.onCoreClick = null;
    this.onEventClick = null;
    this.onOpenComputeGraph = null;

    this._setupCanvases();
    this._bindEvents();
  }

  // ─── 内部 DOM 辅助 ────────────────────────────────────────────
  _viewport() {
    // swimlane-inner → swimlane-viewport
    return this.container.parentElement?.parentElement ?? null;
  }

  _getScrollLeft() {
    return this._viewport()?.scrollLeft ?? 0;
  }

  _getViewportW() {
    const vp = this._viewport();
    return vp ? vp.clientWidth - SWIMLANE_CONFIG.LABEL_WIDTH - 2 : 800;
  }

  _getViewportH() {
    return this._viewport()?.clientHeight ?? 400;
  }

  /** canvas 绘制宽度 = 执行总时长对应像素数 */
  _getDataWidth() {
    if (!this.parsedData) return 800;
    return Math.ceil(this.parsedData.timeRange.duration * this.xScale);
  }

  // ─── 初始化 ───────────────────────────────────────────────────
  _setupCanvases() {
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.style.display = 'block';
    this.labelCanvas.style.cursor = 'default';
    this.labelCtx = this.labelCanvas.getContext('2d');
    this.labelContainer.appendChild(this.labelCanvas);

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.cursor = 'grab';
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'swimlane-tooltip';
    this.tooltip.style.display = 'none';
    document.body.appendChild(this.tooltip);

    // 监听视口滚动（包含水平 scrollLeft 变化）→ 重绘
    const vp = this._viewport();
    if (vp) {
      vp.addEventListener('scroll', () => {
        this.yScrollTop = vp.scrollTop;
        this._scheduleRender();
      }, { passive: true });
    }
  }

  _bindEvents() {
    // ── 标签区滚轮：仅纵向滚动 ──────────────────────────────────
    this.labelContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const vp = this._viewport();
      if (vp) vp.scrollTop += e.deltaY * 0.8;
    }, { passive: false });

    // ── 主 canvas 滚轮：仅缩放时间粒度 ─────────────────────────
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      // mouseViewportX：鼠标在「泳道可视区」内的 X 位置（不含标签列）
      const mouseViewportX = e.clientX - rect.left;
      const factor = e.deltaY < 0 ? SWIMLANE_CONFIG.ZOOM_FACTOR : 1 / SWIMLANE_CONFIG.ZOOM_FACTOR;
      this._zoom(factor, mouseViewportX);
    }, { passive: false });

    // ── 拖拽平移（改变 scrollLeft）────────────────────────────
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStartClientX = e.clientX;
      this.dragStartScrollLeft = this._getScrollLeft();
      this.canvas.style.cursor = 'grabbing';
      e.preventDefault();
    });

    this.canvas.addEventListener('mousemove', (e) => {
      this.lastHoverPoint = { clientX: e.clientX, clientY: e.clientY };
      this._handleMouseMove(e);
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.lastHoverPoint = null;
      this.hoveredCore = null;
      this.hoveredEvent = null;
      this._hideTooltip();
      this._scheduleRender();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStartClientX;
      const vp = this._viewport();
      if (vp) vp.scrollLeft = this.dragStartScrollLeft - dx;
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
      }
    });

    // ── 点击事件 ─────────────────────────────────────────────
    this.canvas.addEventListener('click', (e) => {
      const { coreIndex, event } = this._hitTest(e);

      if (event) {
        this.selectedEvent = (this.selectedEvent === event) ? null : event;
        this.relatedEvents = this.selectedEvent ? this._getRelatedEvents(this.selectedEvent) : [];
        if (this.onEventClick) this.onEventClick(this.selectedEvent, this.relatedEvents);
        this._render();
        this._renderLabels();
        return;
      }

      if (coreIndex >= 0) {
        const coreName = this._getVisibleCores()[coreIndex];
        this.selectedCore = (this.selectedCore === coreName) ? null : coreName;
        if (this.onCoreClick) this.onCoreClick(coreName);
        this._render();
        this._renderLabels();
      }
    });
  }

  // ─── 数据加载 ─────────────────────────────────────────────────
  loadData(parsedData, analysisResult) {
    this.parsedData = parsedData;
    this.analysisResult = analysisResult;

    this.sortedCores = sortCoreNames([...parsedData.coreEvents.keys()])
      .filter(n => !n.startsWith('Fake'));
    this.visibleCores = new Set(this.sortedCores);

    this.bottleneckCores = new Set();
    analysisResult?.bottlenecks?.forEach(b =>
      b.affectedCores?.forEach(c => this.bottleneckCores.add(c))
    );

    this._initView();
    this._resize();
    this._render();
    this._renderLabels();
  }

  _initView() {
    if (!this.parsedData) return;
    const dur = this.parsedData.timeRange.duration;
    if (dur <= 0) return;
    // 初始缩放：全量数据恰好铺满可视宽度
    this.xScale = Math.max(0.001, this._getViewportW() / dur);
    // 重置水平位置
    const vp = this._viewport();
    if (vp) vp.scrollLeft = 0;
  }

  // ─── Canvas 尺寸 ──────────────────────────────────────────────
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const visibleRows = this._getVisibleCores();
    const contentH = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT + visibleRows.length * SWIMLANE_CONFIG.ROW_HEIGHT + 20;

    // 宽度 = 执行总时长对应像素（时间轴长度 = 总时长）
    const dataW = this._getDataWidth();
    const viewportW = this._getViewportW();
    const viewportH = this._getViewportH();

    const canvasW = Math.max(dataW, viewportW);
    const canvasH = Math.max(contentH, viewportH);

    this.canvas.width  = canvasW * dpr;
    this.canvas.height = canvasH * dpr;
    this.canvas.style.width  = `${canvasW}px`;
    this.canvas.style.height = `${canvasH}px`;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);

    this.labelCanvas.width  = SWIMLANE_CONFIG.LABEL_WIDTH * dpr;
    this.labelCanvas.height = canvasH * dpr;
    this.labelCanvas.style.width  = `${SWIMLANE_CONFIG.LABEL_WIDTH}px`;
    this.labelCanvas.style.height = `${canvasH}px`;
    this.labelCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.labelCtx.scale(dpr, dpr);
  }

  // ─── 缩放（以鼠标在视口中的 X 为轴心）────────────────────────
  _zoom(factor, mouseViewportX) {
    if (!this.parsedData) return;
    const dur = this.parsedData.timeRange.duration;
    if (dur <= 0) return;

    const viewportW = this._getViewportW();
    const minScale = viewportW / dur;            // 最小缩放 = 全量铺满
    const oldScale = this.xScale;
    const newScale = Math.max(minScale, Math.min(oldScale * factor, 50000));
    if (newScale === oldScale) return;

    // 锚点：鼠标对应的时间点在缩放前后不动
    const scrollLeft = this._getScrollLeft();
    const timeAtMouse = (scrollLeft + mouseViewportX) / oldScale;

    this.xScale = newScale;
    this._resize();

    // 调整 scrollLeft 使 timeAtMouse 仍在鼠标下方
    const newScrollLeft = timeAtMouse * newScale - mouseViewportX;
    const vp = this._viewport();
    if (vp) vp.scrollLeft = Math.max(0, newScrollLeft);

    this._render();
    this._renderLabels();
  }

  // ─── 主渲染 ───────────────────────────────────────────────────
  _render() {
    if (!this.parsedData) return;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const canvasW = this.canvas.width / dpr;
    const canvasH = this.canvas.height / dpr;

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = SWIMLANE_CONFIG.BG_COLOR;
    ctx.fillRect(0, 0, canvasW, canvasH);

    const scrollLeft  = this._getScrollLeft();
    const viewportW   = this._getViewportW();
    const { timeRange, coreEvents, colorMap } = this.parsedData;

    // 当前可见的时间范围（用于裁剪，加速绘制）
    const viewStartTime = scrollLeft / this.xScale;
    const viewEndTime   = (scrollLeft + viewportW) / this.xScale;

    // 时间轴（随纵向滚动跟随）
    this._renderTimeAxis(ctx, canvasW, timeRange, viewStartTime, viewEndTime, this.yScrollTop);

    // 每一行
    this._getVisibleCores().forEach((coreName, rowIndex) => {
      const y = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT + rowIndex * SWIMLANE_CONFIG.ROW_HEIGHT;
      this._renderRow(
        ctx, canvasW, coreName, rowIndex, y,
        coreEvents.get(coreName) || [],
        colorMap, timeRange, viewStartTime, viewEndTime
      );
    });

    // 关联连线
    this._renderRelations(ctx, canvasW, timeRange);

    // 选中核心高亮边框
    if (this.selectedCore) {
      const idx = this._getVisibleCores().indexOf(this.selectedCore);
      if (idx >= 0) {
        const y = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT + idx * SWIMLANE_CONFIG.ROW_HEIGHT;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, y, canvasW, SWIMLANE_CONFIG.ROW_HEIGHT);
      }
    }
  }

  // ─── 时间轴 ───────────────────────────────────────────────────
  _renderTimeAxis(ctx, canvasW, timeRange, viewStartTime, viewEndTime, axisY = 0) {
    const axisH    = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT;
    const duration = timeRange.duration;
    const dataW    = this._getDataWidth();
    const canvasH  = this.canvas.height / (window.devicePixelRatio || 1);

    // 背景（仅绘制数据范围 [0, dataW]）
    ctx.fillStyle = SWIMLANE_CONFIG.LABEL_BG;
    ctx.fillRect(0, axisY, dataW, axisH);

    // dataW 右侧若还有空白（视口比数据宽时），填暗色
    if (dataW < canvasW) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(dataW, axisY, canvasW - dataW, axisH);
      ctx.fillRect(dataW, SWIMLANE_CONFIG.TIME_AXIS_HEIGHT, canvasW - dataW, canvasH);
    }

    // 底部分割线
    ctx.strokeStyle = SWIMLANE_CONFIG.AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, axisY + axisH);
    ctx.lineTo(dataW, axisY + axisH);
    ctx.stroke();

    // 刻度（只在可见范围内生成，节省绘制开销）
    const clampedStart = Math.max(0, viewStartTime);
    const clampedEnd   = Math.min(duration, viewEndTime);
    if (clampedEnd <= clampedStart) return;

    const viewDuration = clampedEnd - clampedStart;
    const tickCount    = Math.max(4, Math.floor(this._getViewportW() / 80));
    const tickInterval = this._niceInterval(viewDuration / tickCount);
    const firstTick    = Math.ceil(clampedStart / tickInterval) * tickInterval;

    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    for (let t = firstTick; t <= clampedEnd + tickInterval * 0.01; t += tickInterval) {
      if (t < 0 || t > duration) continue;
      const x = t * this.xScale;   // 绝对 canvas 坐标
      if (x < 0 || x > dataW) continue;

      // 刻度线
      ctx.strokeStyle = SWIMLANE_CONFIG.TICK_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, axisY + axisH - 7);
      ctx.lineTo(x, axisY + axisH);
      ctx.stroke();

      // 刻度标签
      ctx.fillStyle = SWIMLANE_CONFIG.TICK_COLOR;
      ctx.fillText(this._formatTime(t), x, axisY + axisH - 9);

      // 垂直网格线
      ctx.strokeStyle = SWIMLANE_CONFIG.GRID_COLOR;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, SWIMLANE_CONFIG.TIME_AXIS_HEIGHT);
      ctx.lineTo(x, canvasH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 起始边界线（t=0，x=0）
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0.5, axisY);
    ctx.lineTo(0.5, canvasH);
    ctx.stroke();
    ctx.fillStyle = '#A3A3A3';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('0', 4, axisY + axisH - 9);

    // 结束边界线（t=duration，x=dataW）
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(dataW - 0.5, axisY);
    ctx.lineTo(dataW - 0.5, canvasH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#A3A3A3';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${this._formatTime(duration)} ►`, dataW - 4, axisY + axisH - 9);
  }

  // ─── 行渲染 ───────────────────────────────────────────────────
  _renderRow(ctx, canvasW, coreName, rowIndex, y, events, colorMap, timeRange, viewStartTime, viewEndTime) {
    const rh      = SWIMLANE_CONFIG.ROW_HEIGHT;
    const padding = SWIMLANE_CONFIG.ROW_PADDING;
    const radius  = 2;

    const isBottleneck = this.highlightBottlenecks && this.bottleneckCores.has(coreName);
    const isSelected   = coreName === this.selectedCore;
    const isHovered    = coreName === this.hoveredCore;

    // 行背景
    if (isSelected)       ctx.fillStyle = SWIMLANE_CONFIG.SELECTED_ROW_BG;
    else if (isBottleneck) ctx.fillStyle = SWIMLANE_CONFIG.BOTTLENECK_ROW_BG;
    else if (isHovered)    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    else                   ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, y, canvasW, rh);

    // 任务条
    for (const event of events) {
      const relStart = event.ts - timeRange.start;
      const relEnd   = relStart + (event.dur || 0);
      if (relEnd < viewStartTime || relStart > viewEndTime) continue;

      // 绝对 canvas 坐标
      const x  = relStart * this.xScale;
      const x2 = relEnd   * this.xScale;
      const w  = Math.max(SWIMLANE_CONFIG.MIN_TASK_WIDTH, x2 - x);

      const op = getEventOpType(event);
      const color = colorForTask(event, 'semantic');

      const isHovEvent    = event === this.hoveredEvent;
      const isSelEvent    = event === this.selectedEvent;
      const isRelated     = this.relatedEvents.includes(event);

      const barX = x;
      const barY = y + padding;
      const barH = rh - padding * 2;
      const displayColor = isSelEvent ? this._lightenColor(color, 28) : (isRelated || isHovEvent ? this._lightenColor(color, 14) : color);
      const borderColor = isSelEvent ? 'rgba(255,255,255,0.88)' : (isRelated ? 'rgba(255,255,255,0.46)' : 'rgba(255,255,255,0.16)');

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(barX, barY, w, barH, radius + 1);
      ctx.clip();

      ctx.fillStyle = this._alphaColor(displayColor, 0.24);
      ctx.fillRect(barX, barY, w, barH);

      const inW = Math.max(10, Math.min(w * 0.2, 42));
      const outW = Math.max(12, Math.min(w * 0.2, 48));
      const computeW = Math.max(0, w - inW - outW);
      const segs = [
        { x: barX, w: inW, fill: this._mixColor(displayColor, '#ffffff', 0.16) },
        { x: barX + inW, w: computeW, fill: displayColor },
        { x: barX + inW + computeW, w: outW, fill: this._mixColor(displayColor, '#0b0f17', 0.2) },
      ];
      segs.forEach(seg => {
        if (seg.w <= 0) return;
        ctx.fillStyle = seg.fill;
        ctx.fillRect(seg.x, barY, seg.w, barH);
      });

      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(barX, barY, w, 1);
      ctx.restore();

      ctx.beginPath();
      ctx.roundRect(barX + 0.5, barY + 0.5, Math.max(0, w - 1), Math.max(0, barH - 1), radius + 1);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = isSelEvent ? 1.4 : 1;
      ctx.stroke();

      if (w >= 28) {
        const segments = buildTaskSegmentSpec(event, w);
        const textColor = 'rgba(255,255,255,0.92)';
        const font = w >= 72 ? '600 9px var(--font-sans, sans-serif)' : '600 8px var(--font-sans, sans-serif)';
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(barX + 1, barY + 1, Math.max(0, w - 2), Math.max(0, barH - 2), radius);
        ctx.clip();
        ctx.font = font;
        ctx.textBaseline = 'middle';

        const layout = [
          { x: barX, w: inW, align: 'center', text: segments[0].text },
          { x: barX + inW, w: computeW, align: 'left', text: segments[1].text },
          { x: barX + inW + computeW, w: outW, align: 'center', text: segments[2].text },
        ];

        layout.forEach((segment, index) => {
          if (segment.w < (index === 1 ? 20 : 14)) return;
          ctx.fillStyle = textColor;
          if (segment.align === 'left') {
            ctx.textAlign = 'left';
            const maxChars = Math.max(4, Math.floor((segment.w - 8) / 6));
            const label = segment.text.length > maxChars ? `${segment.text.slice(0, Math.max(0, maxChars - 1))}…` : segment.text;
            ctx.fillText(label, segment.x + 5, barY + barH / 2 + 0.5);
          } else {
            ctx.textAlign = 'center';
            if (segment.w < segment.text.length * 5.2) return;
            ctx.fillText(segment.text, segment.x + segment.w / 2, barY + barH / 2 + 0.5);
          }
        });
        ctx.restore();
      }
    }

    // 气泡（任务间空隙）
    if (this.showBubbles) {
      const gaps = this.analysisResult?.coreMetrics?.get(coreName)?.gaps;
      if (gaps) {
        for (const gap of gaps) {
          if (gap.duration < 0.5) continue;
          const relStart = gap.start - timeRange.start;
          const relEnd   = gap.end   - timeRange.start;
          if (relEnd < viewStartTime || relStart > viewEndTime) continue;
          const gx = relStart * this.xScale;
          const gw = Math.max(0.5, relEnd * this.xScale - gx);
          ctx.fillStyle = SWIMLANE_CONFIG.BUBBLE_COLOR;
          ctx.fillRect(gx, y + padding, gw, rh - padding * 2);
        }
      }
    }
  }

  // ─── 关联连线 ────────────────────────────────────────────────
  _renderRelations(ctx, canvasW, timeRange) {
    if (!this.selectedEvent || this.relatedEvents.length === 0) return;
    const cur = this._getEventPos(this.selectedEvent);
    if (!cur) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    for (const rel of this.relatedEvents) {
      const rp = this._getEventPos(rel);
      if (!rp) continue;
      const fwd  = this.selectedEvent.ts <= rel.ts;
      const src  = fwd ? cur : rp;
      const dst  = fwd ? rp  : cur;
      const sx   = src.x + src.w, sy = src.y + src.h / 2;
      const dx   = dst.x,         dy = dst.y + dst.h / 2;
      const cpx  = (sx + dx) / 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(cpx, sy, cpx, dy, dx, dy);
      ctx.stroke();
      this._drawArrow(ctx, dx - 5, dy, dx, dy);
    }
    ctx.restore();
  }

  // ─── 分组区间渲染 ─────────────────────────────────────────────

  setGroupBands(bands) {
    this.groupBands = bands || [];
    this._render();
  }

  toggleGroups(show) {
    this.showGroups = show;
    this._render();
  }

  _renderGroupBandsBg(ctx, canvasW, canvasH) {
    return;
  }

  _renderGroupBandsOverlay(ctx, canvasW, canvasH) {
    return;
  }

  _getEventPos(event) {
    if (!this.parsedData) return null;
    const coreName   = this.parsedData.threadMap.get(event.tid) || `Core_${event.tid}`;
    const visibleCores = this._getVisibleCores();
    const rowIndex   = visibleCores.indexOf(coreName);
    if (rowIndex < 0) return null;
    const y = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT + rowIndex * SWIMLANE_CONFIG.ROW_HEIGHT;
    const x = (event.ts - this.parsedData.timeRange.start) * this.xScale;
    return { x, y, w: (event.dur || 0) * this.xScale, h: SWIMLANE_CONFIG.ROW_HEIGHT };
  }

  _drawArrow(ctx, fx, fy, tx, ty) {
    const len = 8, angle = Math.atan2(ty - fy, tx - fx);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - len * Math.cos(angle - Math.PI / 6), ty - len * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - len * Math.cos(angle + Math.PI / 6), ty - len * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  // ─── 标签列渲染 ───────────────────────────────────────────────
  _renderLabels() {
    if (!this.parsedData) return;
    const ctx = this.labelCtx;
    const W   = SWIMLANE_CONFIG.LABEL_WIDTH;
    const H   = this.labelCanvas.height / (window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = SWIMLANE_CONFIG.LABEL_BG;
    ctx.fillRect(0, 0, W, H);

    // 时间轴标题区（跟随纵向滚动）
    const axisY = this.yScrollTop;
    ctx.fillStyle = SWIMLANE_CONFIG.BG_COLOR;
    ctx.fillRect(0, axisY, W, SWIMLANE_CONFIG.TIME_AXIS_HEIGHT);
    ctx.fillStyle = SWIMLANE_CONFIG.LABEL_TEXT;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('核心', W / 2, axisY + SWIMLANE_CONFIG.TIME_AXIS_HEIGHT / 2 + 4);

    ctx.strokeStyle = SWIMLANE_CONFIG.AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, axisY + SWIMLANE_CONFIG.TIME_AXIS_HEIGHT);
    ctx.lineTo(W, axisY + SWIMLANE_CONFIG.TIME_AXIS_HEIGHT);
    ctx.stroke();

    const visibleCores = this._getVisibleCores();
    visibleCores.forEach((coreName, i) => {
      const y  = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT + i * SWIMLANE_CONFIG.ROW_HEIGHT;
      const rh = SWIMLANE_CONFIG.ROW_HEIGHT;

      const isBottleneck = this.highlightBottlenecks && this.bottleneckCores.has(coreName);
      const isSelected   = coreName === this.selectedCore;
      const isHovered    = coreName === this.hoveredCore;

      if (isSelected)       ctx.fillStyle = 'rgba(255,255,255,0.06)';
      else if (isBottleneck) ctx.fillStyle = 'rgba(255,255,255,0.04)';
      else if (isHovered)    ctx.fillStyle = 'rgba(255,255,255,0.03)';
      else                   ctx.fillStyle = SWIMLANE_CONFIG.LABEL_BG;
      ctx.fillRect(0, y, W, rh);

      // 核心名称
      ctx.fillStyle = isSelected ? '#F2F2F2' : SWIMLANE_CONFIG.LABEL_TEXT;
      ctx.font = isSelected ? 'bold 11px monospace' : '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(coreName, 10, y + rh / 2 + 4);

      // 瓶颈图标
      if (isBottleneck) {
        ctx.fillStyle = '#EF4444';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('⚠', W - 4, y + rh / 2 + 4);
      }

    });

    // 右侧边框
    ctx.strokeStyle = SWIMLANE_CONFIG.AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W - 1, 0);
    ctx.lineTo(W - 1, H);
    ctx.stroke();
  }

  // ─── 鼠标交互 ─────────────────────────────────────────────────
  _handleMouseMove(e) {
    const { coreIndex, event } = this._hitTest(e);
    const visibleCores    = this._getVisibleCores();
    const newCore  = coreIndex >= 0 ? visibleCores[coreIndex] : null;
    const changed  = newCore !== this.hoveredCore || event !== this.hoveredEvent;

    this.hoveredCore  = newCore;
    this.hoveredEvent = event;

    if (changed) { this._render(); this._renderLabels(); }
    if (event && newCore) this._showTooltip(e, event, newCore);
    else this._hideTooltip();
  }

  _hitTest(e) {
    const rect    = this.canvas.getBoundingClientRect();
    const mouseX  = e.clientX - rect.left;  // 相对 canvas 的 x（含 scrollLeft 偏移）
    const mouseY  = e.clientY - rect.top;

    const rowIndex = Math.floor((mouseY - SWIMLANE_CONFIG.TIME_AXIS_HEIGHT) / SWIMLANE_CONFIG.ROW_HEIGHT);
    const visibleCores = this._getVisibleCores();
    if (rowIndex < 0 || rowIndex >= visibleCores.length) return { coreIndex: -1, event: null };

    const coreName  = visibleCores[rowIndex];
    const events    = this.parsedData?.coreEvents.get(coreName) || [];
    const timeRange = this.parsedData?.timeRange;

    // mouseX 已经是绝对 canvas 坐标（getBoundingClientRect 随 scrollLeft 变化）
    const timeAtMouse = mouseX / this.xScale;

    let hitEvent = null;
    for (const ev of events) {
      const relStart = ev.ts - timeRange.start;
      const relEnd   = relStart + (ev.dur || 0);
      if (timeAtMouse >= relStart - 0.5 && timeAtMouse <= relEnd + 0.5) { hitEvent = ev; break; }
    }

    return { coreIndex: rowIndex, event: hitEvent };
  }

  _showTooltip(e, event, coreName) {
    const op       = getEventOpType(event);
    const execHint = parseExecutionHint(event.args?.['execution-hint']);
    const taskId   = event.args?.taskId || event.args?.TaskId || '';

    let html = `
      <div class="tt-header">
        <span class="tt-core">${coreName}</span>
        <span class="tt-op">${op}</span>
      </div>
      <div class="tt-body">
        <div class="tt-row"><span>任务名称</span><span>${event.name || '-'}</span></div>
        <div class="tt-row"><span>持续时间</span><span>${(event.dur || 0).toFixed(3)} μs</span></div>
        <div class="tt-row"><span>任务 ID</span><span>${taskId}</span></div>`;
    if (execHint?.avg) html += `<div class="tt-row"><span>平均时间</span><span>${execHint.avg.toFixed(3)} μs</span></div>`;
    if (execHint?.max) html += `<div class="tt-row"><span>最大时间</span><span>${execHint.max.toFixed(3)} μs</span></div>`;
    if (execHint?.min) html += `<div class="tt-row"><span>最小时间</span><span>${execHint.min.toFixed(3)} μs</span></div>`;

    const hint = event.args?.['event-hint'];
    if (hint) {
      const m = hint.match(/Task:\[([^\]]+)\]/);
      if (m) html += `<div class="tt-row"><span>Task</span><span>[${m[1]}]</span></div>`;
    }
    html += '</div>';

    this.tooltip.innerHTML = html;
    this.tooltip.style.display = 'block';

    const tx = e.clientX + 12, ty = e.clientY - 10;
    const ttH = this.tooltip.offsetHeight;
    this.tooltip.style.left = `${Math.min(tx, window.innerWidth - 270)}px`;
    this.tooltip.style.top  = `${Math.max(5, ty + ttH > window.innerHeight ? ty - ttH - 20 : ty)}px`;
  }

  _hideTooltip() { this.tooltip.style.display = 'none'; }

  // ─── 公共 API ─────────────────────────────────────────────────
  setFilter(showAIC, showAIV) {
    this.showAIC = showAIC;
    this.showAIV = showAIV;
    this._resize();
    this._render();
    this._renderLabels();
  }

  toggleBubbles(show)            { this.showBubbles = show; this._render(); }
  toggleBottleneckHighlight(show){ this.highlightBottlenecks = show; this._render(); this._renderLabels(); }

  scrollToCore(coreName) {
    const idx = this._getVisibleCores().indexOf(coreName);
    if (idx < 0) return;
    this.selectedCore = coreName;

    const y  = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT + idx * SWIMLANE_CONFIG.ROW_HEIGHT;
    const vp = this._viewport();
    if (vp) vp.scrollTop = Math.max(0, y - vp.clientHeight / 2);

    this._render();
    this._renderLabels();
  }

  fitToView() {
    this._initView();
    this._resize();
    this._render();
    this._renderLabels();
  }

  exportPNG() {
    const a = document.createElement('a');
    a.download = 'swimlane_export.png';
    a.href = this.canvas.toDataURL('image/png');
    a.click();
  }

  onResize() {
    this._resize();
    this._render();
    this._renderLabels();
  }

  // ─── 工具 ─────────────────────────────────────────────────────
  _getVisibleCores() {
    return this.sortedCores.filter(n => {
      if (!this.visibleCores.has(n)) return false;
      const t = getCoreType(n);
      if (t === 'AIC' && !this.showAIC) return false;
      if (t === 'AIV' && !this.showAIV) return false;
      return true;
    });
  }

  _getRelatedEvents(event) {
    if (!event || !this.parsedData?.relations) return [];
    return Array.from(this.parsedData.relations.get(event) ?? []);
  }

  _niceInterval(raw) {
    const steps = [0.1,0.2,0.5,1,2,5,10,20,50,100,200,500,1000,2000,5000,10000];
    return steps.find(s => s >= raw) ?? raw;
  }

  _formatTime(us) {
    if (us >= 1000) return `${(us/1000).toFixed(1)}ms`;
    if (us >= 1)    return `${us.toFixed(0)}μs`;
    return `${us.toFixed(2)}μs`;
  }

  _lightenColor(hex, amt) {
    if (!hex || hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (n >> 16)        + amt);
    const g = Math.min(255, ((n >> 8) & 0xff) + amt);
    const b = Math.min(255, (n & 0xff)        + amt);
    return `rgb(${r},${g},${b})`;
  }

  _alphaColor(color, alpha) {
    if (!color || color[0] !== '#') return color;
    const n = parseInt(color.slice(1), 16);
    const r = n >> 16;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  _mixColor(base, target, ratio) {
    if (!base || !target || base[0] !== '#' || target[0] !== '#') return base;
    const a = parseInt(base.slice(1), 16);
    const b = parseInt(target.slice(1), 16);
    const mix = (from, to) => Math.round(from + (to - from) * ratio);
    const r = mix(a >> 16, b >> 16);
    const g = mix((a >> 8) & 0xff, (b >> 8) & 0xff);
    const bl = mix(a & 0xff, b & 0xff);
    return `rgb(${r},${g},${bl})`;
  }
}

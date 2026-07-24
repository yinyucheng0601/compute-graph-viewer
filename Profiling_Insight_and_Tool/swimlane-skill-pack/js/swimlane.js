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
  // 组间留白：一个分组块起始处（紧跟在若干叶子行之后的分组头）上方插入的空隙，
  // 让 Rank / Ascend Hardware / Communication 等大块之间有呼吸感（对齐参照实现的 CORE_GAP_H）。
  CORE_GAP_H: 6,
};

/**
 * 画布 chrome 配色（背景、标签列、坐标轴、行底色…）。
 * 任务条本身的语义色不随主题变化，只有画布 chrome 随主题走。
 * 取值对齐 PTO design system semantic tokens（surface-1/2、foreground-*、border-*）。
 */
const SWIMLANE_THEMES = {
  dark: {
    BG_COLOR: '#111111',
    OUTSIDE_BG: 'rgba(0,0,0,0.4)',
    LABEL_BG: '#1B1B1B',
    LABEL_TEXT: '#B5B5B5',
    LABEL_TEXT_STRONG: '#E8EAF0',
    LABEL_TEXT_SELECTED: '#F2F2F2',
    LABEL_MARKER: '#D8DCE6',
    AXIS_COLOR: 'rgba(255, 255, 255, 0.12)',
    BOUNDARY_COLOR: 'rgba(255, 255, 255, 0.18)',
    BOUNDARY_TEXT: '#A3A3A3',
    TICK_COLOR: '#8D8D8D',
    GRID_COLOR: 'rgba(255, 255, 255, 0.06)',
    BUBBLE_COLOR: 'rgba(239, 68, 68, 0.15)',
    SELECTED_ROW_BG: 'rgba(255, 255, 255, 0.10)',
    BOTTLENECK_ROW_BG: 'rgba(255, 255, 255, 0.04)',
    HOVER_ROW_BG: 'rgba(255, 255, 255, 0.025)',
    SELECTED_ROW_BORDER: 'rgba(255, 255, 255, 0.22)',
    ROLLUP_ROW_BG: 'rgba(255, 255, 255, 0.018)',
    ROLLUP_ROW_HOVER_BG: 'rgba(255, 255, 255, 0.035)',
    // 折叠汇总条：无描边浅灰
    ROLLUP_FILL: 'rgba(255, 255, 255, 0.08)',
    ROLLUP_TEXT: 'rgba(255, 255, 255, 0.55)',
    GROUP_ROW_BG: 'rgba(255, 255, 255, 0.045)',
    GROUP_ROW_HOVER_BG: 'rgba(255, 255, 255, 0.065)',
    GROUP_ROW_SELECTED_BG: 'rgba(255, 255, 255, 0.09)',
    // 选中聚焦下不含选中泳道的分组头暗化背景
    GROUP_ROW_BG_DIM: 'rgba(255, 255, 255, 0.012)',
    LABEL_SELECTED_BG: 'rgba(255, 255, 255, 0.11)',
    LABEL_BOTTLENECK_BG: 'rgba(255, 255, 255, 0.04)',
    LABEL_HOVER_BG: 'rgba(255, 255, 255, 0.03)',
    RELATION_LINE: 'rgba(255, 255, 255, 0.8)',
    WARNING: '#EF4444',
    // 标签列利用率 meter：轨道 + 蓝色填充（纯利用率指示，不带语义色）
    METER_TRACK: 'rgba(255, 255, 255, 0.10)',
    METER_FILL: '#6e96e1',
    // 选中聚焦下非关联泳道的暗化色
    LABEL_TEXT_DIM: 'rgba(255, 255, 255, 0.18)',
    METER_FILL_DIM: 'rgba(110, 150, 225, 0.22)',
  },
  // 浅色画布用冷中性灰（带一点蓝，跟 PTO 的中性色同调），而不是纯黑透明叠加——
  // 纯黑 alpha 压在白底上会发脏，尤其还要和红色 bubble 叠加。
  light: {
    BG_COLOR: '#FFFFFF',
    OUTSIDE_BG: 'rgba(16, 24, 40, 0.03)',
    LABEL_BG: '#F4F6FA',
    LABEL_TEXT: 'rgba(16, 24, 40, 0.62)',
    LABEL_TEXT_STRONG: 'rgba(16, 24, 40, 0.92)',
    LABEL_TEXT_SELECTED: '#101828',
    LABEL_MARKER: 'rgba(16, 24, 40, 0.55)',
    AXIS_COLOR: 'rgba(16, 24, 40, 0.10)',
    BOUNDARY_COLOR: 'rgba(16, 24, 40, 0.14)',
    BOUNDARY_TEXT: 'rgba(16, 24, 40, 0.42)',
    TICK_COLOR: 'rgba(16, 24, 40, 0.40)',
    GRID_COLOR: 'rgba(16, 24, 40, 0.05)',
    BUBBLE_COLOR: 'rgba(229, 72, 77, 0.07)',
    SELECTED_ROW_BG: 'rgba(24, 99, 220, 0.07)',
    BOTTLENECK_ROW_BG: 'rgba(229, 72, 77, 0.04)',
    HOVER_ROW_BG: 'rgba(16, 24, 40, 0.03)',
    SELECTED_ROW_BORDER: 'rgba(24, 99, 220, 0.35)',
    ROLLUP_ROW_BG: 'rgba(16, 24, 40, 0.015)',
    ROLLUP_ROW_HOVER_BG: 'rgba(16, 24, 40, 0.035)',
    // 折叠汇总条：无描边浅灰
    ROLLUP_FILL: 'rgba(16, 24, 40, 0.05)',
    ROLLUP_TEXT: 'rgba(16, 24, 40, 0.5)',
    GROUP_ROW_BG: 'rgba(16, 24, 40, 0.035)',
    GROUP_ROW_HOVER_BG: 'rgba(16, 24, 40, 0.055)',
    GROUP_ROW_SELECTED_BG: 'rgba(24, 99, 220, 0.09)',
    // 选中聚焦下不含选中泳道的分组头暗化背景
    GROUP_ROW_BG_DIM: 'rgba(16, 24, 40, 0.01)',
    LABEL_SELECTED_BG: 'rgba(24, 99, 220, 0.09)',
    LABEL_BOTTLENECK_BG: 'rgba(229, 72, 77, 0.05)',
    LABEL_HOVER_BG: 'rgba(16, 24, 40, 0.035)',
    RELATION_LINE: 'rgba(16, 24, 40, 0.55)',
    WARNING: '#D93438',
    METER_TRACK: 'rgba(16, 24, 40, 0.10)',
    METER_FILL: '#3a7bd5',
    // 选中聚焦下非关联泳道的暗化色
    LABEL_TEXT_DIM: 'rgba(16, 24, 40, 0.14)',
    METER_FILL_DIM: 'rgba(58, 123, 213, 0.18)',
  },
};

/** 页面主题：<html data-theme>；未声明时按深色渲染（兼容旧宿主页面）。 */
function resolveDocumentTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement?.dataset?.theme === 'light' ? 'light' : 'dark';
}

/**
 * 画布底色 / 标签列底色允许宿主页面按自己的 surface 调色板覆写：
 * 声明 --swimlane-canvas-bg / --swimlane-label-bg 即可（未声明则用上面的主题默认值），
 * 这样 canvas 与包裹它的 viewport 不会出现两种灰。
 */
function resolvePalette(theme) {
  const base = { ...(SWIMLANE_THEMES[theme] || SWIMLANE_THEMES.dark) };
  if (typeof document === 'undefined' || !document.documentElement) return base;
  const styles = getComputedStyle(document.documentElement);
  const canvasBg = styles.getPropertyValue('--swimlane-canvas-bg').trim();
  const labelBg = styles.getPropertyValue('--swimlane-label-bg').trim();
  if (canvasBg) base.BG_COLOR = canvasBg;
  if (labelBg) base.LABEL_BG = labelBg;
  return base;
}

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

const STITCH_COLORS = ['#735bb4', '#4d70ba', '#4a9568', '#ba8053', '#45a2ad', '#b46494', '#238fcf', '#c99524'];
const LABEL_COLORS = {
  fake: '#6f6a64',
  'Prolog-Quant': '#8d6bc7',
  'Query-Linear': '#735bb4',
  'Query-Dequant': '#4d70ba',
  'Query-Hadamard': '#6f63b8',
  'Weight-Linear': '#4a9568',
  'Key-Linear': '#ba8053',
  'Key-Hadamard': '#c48b60',
  'Key-LayerNorm': '#b46494',
  'Key-Rope2D': '#45a2ad',
  // ── Timeline / PP 语义色：中深调、白字可读，同一套值在浅色(#fff)与深色(#14151a)
  //    画布上都成立（经 dataviz validate_palette.js 双表面验证，CVD 分离达标）。
  //    条上是白字，所以不能用浅色成员；异常语义(等待/空泡)走红/品红。
  //    详见对话记录中的验证输出。[[swimlane-palette]]
  // PP Pipeline timeline labels
  'PP-Bubble':    '#cf4d86',  // magenta — 异常
  'Fwd-Compute':  '#2f6fce',  // blue — 前向
  'Bwd-Compute':  '#8b3fb5',  // purple — 后向（与蓝拉开，红绿色盲下可分）
  'P2P-Send':     '#c15a1c',  // orange
  'P2P-Recv':     '#c15a1c',
  'DP-Collective':'#0f9b8e',  // teal
  'Optimizer':    '#5d6b99',  // 中性蓝灰 — 收尾项，不与关键色相争
  'Free':         '#566173',  // 深灰蓝 — 空闲
  // 多机多卡训练 Timeline（step-trace 概览 + 通信算子相位）
  'Computing':     '#1a8f52',  // green
  'Communication': '#c15a1c',  // orange（聚合通信）
  'Comm-Transmit': '#2f6fce',  // blue
  'Comm-Wait':     '#d23b3b',  // red — 等待同步（异常）
  'Comm-Idle':     '#6b7280',  // 中性灰 — 空转
};
// 语义标签 → 中文展示名（泳道利用率气泡里的占比分类）
const LABEL_ZH = {
  'Computing': '计算',
  'Communication': '通信（聚合）',
  'Comm-Transmit': '通信·传输',
  'Comm-Wait': '通信·等待同步',
  'Comm-Idle': '通信·空转',
  'Free': '空闲',
  'Fwd-Compute': '前向计算',
  'Bwd-Compute': '后向计算',
  'PP-Bubble': '流水气泡',
  'P2P-Send': 'P2P 发送',
  'P2P-Recv': 'P2P 接收',
  'DP-Collective': 'DP 集合通信',
  'Optimizer': '优化器',
};
const LANE_KIND_COLORS = {
  fake: '#6f6a64',
  aic: '#735bb4',
  aiv: '#4d70ba',
  aicpu: '#4a9568',
  other: '#8c847c',
};
const MIN_BAR_SEGMENT_COUNTS_PX = 84;
const SWIMLANE_TASK_PATTERN = typeof window !== 'undefined' ? window.PtoSwimlaneTaskPattern : null;

// 语义 / stitch / engine / subgraph 配色统一由 PTO pattern 的 colormap 决定
// （pattern.json agentReuseRule）；未加载 pattern 时退回本地 hsl 哈希。
const TASK_COLORMAP = SWIMLANE_TASK_PATTERN?.createTaskColormap
  ? SWIMLANE_TASK_PATTERN.createTaskColormap({
      stitchColors: STITCH_COLORS,
      labelColors: LABEL_COLORS,
      laneKindColors: LANE_KIND_COLORS,
    })
  : null;

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

// 算子视图配色 key：优先取显式 opName；否则从 rawName 剥掉尾部耗时数字（如
// "MatMulV2 123.45us" → "MatMulV2"），使同一算子的多次调用落在同一色相；
// 通信类任务名不带这个后缀，退化为整段 rawName（同一通信描述串同色）。
function operatorKeyForTask(task) {
  if (task?.opName) return String(task.opName);
  let raw = String(task?.rawName || task?.displayName || task?.label || 'unknown');
  const kernelMatch = raw.match(/^(.*?)\s+[\d.]+\s*(us|ms|ns)$/i);
  if (kernelMatch) return kernelMatch[1].trim();
  // 通信任务名形如 "R0 · Step 3 · hcom_allReduce · 等待同步 12.3 ms (传输.../等待.../空转...)"：
  // 去掉尾部括号统计后，倒数第二个 "·" 段是通信族名（同一族同色）。
  raw = raw.replace(/\s*\([^)]*\)\s*$/, '');
  const segs = raw.split('·').map(s => s.trim()).filter(Boolean);
  if (segs.length >= 2) return segs[segs.length - 2];
  return raw;
}

function colorForTask(task, mode = 'semantic') {
  if (mode === 'op') return hueColor(operatorKeyForTask(task), 58, 50);
  if (TASK_COLORMAP) return TASK_COLORMAP.colorForTask(task, mode);
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
  if (SWIMLANE_TASK_PATTERN?.buildTaskSegmentSpec) {
    return SWIMLANE_TASK_PATTERN.buildTaskSegmentSpec(task, widthPx);
  }
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
  constructor(container, labelContainer, options = {}) {
    this.container = container;       // #swimlaneCanvas div
    this.labelContainer = labelContainer; // #swimlaneLabel div
    this.canvas = null;
    this.labelCanvas = null;
    this.ctx = null;
    this.labelCtx = null;
    // 标签列宽度可按实例覆盖（默认沿用全局配置），供带深层级树的场景加宽
    this.labelWidth = options.labelWidth || SWIMLANE_CONFIG.LABEL_WIDTH;

    // 主题：'auto' 跟随 <html data-theme>（默认），也可锁定 'light' / 'dark'
    this.themeMode = options.theme || 'auto';
    this.theme = this.themeMode === 'auto' ? resolveDocumentTheme() : this.themeMode;
    this.pal = resolvePalette(this.theme);

    // 数据
    this.parsedData = null;
    this.analysisResult = null;
    this.sortedCores = [];
    this.visibleCores = new Set();
    this.bottleneckCores = new Set();
    this.visibleCoresCache = [];

    // 父子层级泳道（可选）：loadData 第三参传入 laneTree 时启用
    // laneTree = { children: [ { id,label,children:[...] } | { id,label,leafKey } ] }
    // 叶子节点的 leafKey 必须等于扁平 CoreTask 数组里的 coreType 字符串
    this.laneTree = null;
    this.rowMeta = new Map();       // rowKey -> {type:'group'|'leaf', id, label, depth, leafKeys?}
    this.collapsedGroups = new Set();

    // 任务条配色模式：'semantic'（默认，按计算/通信等类别）| 'op'（按算子哈希着色）
    this.colorMode = options.colorMode || 'op';

    // 选中任务 → relatedEvents 之间的细箭头连线（_renderRelations）。宿主页面若已经
    // 自己画了一套跨栏/跨行连线（比如 profileCompare.html 的 SVG overlay），可以传
    // showRelationLines:false 关掉这里的箭头，避免两条线重叠；relatedEvents 本身
    // 仍然生效（任务条不降低透明度的"关联高亮"效果不受影响，只是不画箭头）。
    this.showRelationLines = options.showRelationLines !== false;

    // 缩放状态（水平位置由 viewport.scrollLeft 管理）
    this.xScale = 1;        // px / μs

    // 悬停 / 选中
    this.hoveredCore = null;
    this.hoveredEvent = null;
    this.selectedCore = null;
    this.selectedEvent = null;
    this.relatedEvents = [];
    // 额外强制点亮的泳道 key（不参与"选中泳道 = 谁"的判定，只影响高亮渲染）。
    // 聚合视图下宿主页把选中任务在对侧（base/compare）的同位泳道塞进来，实现
    // "相邻两条泳道一起高亮"；默认空数组，不影响其余页面的单泳道高亮语义。
    this.extraActiveLaneKeys = [];

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

    // 标注
    this.annotations = [];
    this._pulseLoopActive = false;
    this._animFrame = null;

    // 外部回调
    this.onCoreClick = null;
    this.onEventClick = null;
    this.onOpenComputeGraph = null;
    this.onViewChange = null;   // ({ visibleUs, label }) => void，视窗时间范围变化
    this.onGroupToggle = null;  // (groupId, collapsed) => void，泳道树分组展开/折叠

    this._setupCanvases();
    this._bindEvents();
    this._watchTheme();
  }

  // ─── 主题 ─────────────────────────────────────────────────────
  /** 显式切换主题；'auto' 时重新跟随 <html data-theme>。 */
  setTheme(theme) {
    this.themeMode = theme || 'auto';
    const next = this.themeMode === 'auto' ? resolveDocumentTheme() : this.themeMode;
    this.theme = next;
    this.pal = resolvePalette(next);
    if (!this.parsedData) return;
    this._render();
    this._renderLabels();
  }

  /** 切换任务条配色模式：'semantic'（分类）| 'op'（算子哈希）。 */
  setColorMode(mode) {
    this.colorMode = mode === 'op' ? 'op' : 'semantic';
    if (!this.parsedData) return;
    this._render();
  }

  /** auto 模式下监听宿主页面 data-theme 变化，浅色页面配浅色泳道。 */
  _watchTheme() {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    this._themeObserver = new MutationObserver(() => {
      if (this.themeMode === 'auto') this.setTheme('auto');
    });
    this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
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
    return vp ? vp.clientWidth : 800;
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

    // 监听视口滚动（包含水平 scrollLeft 变化）→ 重绘；同步标签列纵向位置
    const vp = this._viewport();
    if (vp) {
      vp.addEventListener('scroll', () => {
        this.yScrollTop = vp.scrollTop;
        this.labelContainer.scrollTop = vp.scrollTop;
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

      // 未命中任何任务条（点击空白处，含行内空白）：若当前有选中任务，清除选中，
      // 回到默认态，和再次点击已选中的任务条效果一致。
      let dirty = false;
      if (this.selectedEvent) {
        this.selectedEvent = null;
        this.relatedEvents = [];
        if (this.onEventClick) this.onEventClick(null, []);
        dirty = true;
      }

      if (coreIndex >= 0) {
        const coreName = this._getVisibleCores()[coreIndex];
        const meta = this.rowMeta.get(coreName);
        if (meta?.type === 'group') { this._toggleGroup(meta.id); return; }
        this.selectedCore = (this.selectedCore === coreName) ? null : coreName;
        if (this.onCoreClick) this.onCoreClick(coreName);
        dirty = true;
      }

      if (dirty) {
        this._render();
        this._renderLabels();
      }
    });

    // ── 标签列点击：分组行=折叠/展开，叶子行=选中（与主画布同步）──
    this.labelCanvas.addEventListener('click', (e) => {
      const rect = this.labelCanvas.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const rowIndex = this._rowIndexAtY(mouseY);
      const visibleCores = this._getVisibleCores();
      if (rowIndex < 0 || rowIndex >= visibleCores.length) return;
      const key = visibleCores[rowIndex];
      const meta = this.rowMeta.get(key);
      if (meta?.type === 'group') { this._toggleGroup(meta.id); return; }
      this.selectedCore = (this.selectedCore === key) ? null : key;
      if (this.onCoreClick) this.onCoreClick(key);
      this._render();
      this._renderLabels();
    });

    this.labelCanvas.addEventListener('mousemove', (e) => {
      const rect = this.labelCanvas.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const rowIndex = this._rowIndexAtY(mouseY);
      const visibleCores = this._getVisibleCores();
      const key = (rowIndex >= 0 && rowIndex < visibleCores.length) ? visibleCores[rowIndex] : null;
      const meta = key ? this.rowMeta.get(key) : null;
      this.labelCanvas.style.cursor = meta ? 'pointer' : 'default';
      if (key !== this.hoveredCore) {
        this.hoveredCore = key;
        this._render();
        this._renderLabels();
      }
      // 叶子泳道：悬浮气泡显示「利用率 + 各类占比」
      if (meta && meta.type === 'leaf') this._showLaneTooltip(e, key);
      else this._hideTooltip();
    });

    this.labelCanvas.addEventListener('mouseleave', () => {
      this._hideTooltip();
      if (this.hoveredCore !== null) {
        this.hoveredCore = null;
        this._render();
        this._renderLabels();
      }
    });
  }

  // ─── 数据加载 ─────────────────────────────────────────────────
  // laneTree 可选：传入时启用父子层级泳道（见构造函数注释里的结构说明）
  loadData(parsedData, analysisResult, laneTree) {
    this.parsedData = parsedData;
    this.analysisResult = analysisResult;
    this.laneTree = laneTree || null;
    this.collapsedGroups = new Set(this._collectDefaultCollapsed(this.laneTree));

    this._rebuildRows();

    this.bottleneckCores = new Set();
    analysisResult?.bottlenecks?.forEach(b =>
      b.affectedCores?.forEach(c => this.bottleneckCores.add(c))
    );

    this._initView();
    this._resize();
    this._render();
    this._renderLabels();
  }

  // 树里叶子/分组节点可带 collapsed:true 标记默认折叠状态
  _collectDefaultCollapsed(tree) {
    const ids = [];
    const walk = (node) => {
      if (!Array.isArray(node.children)) return;
      if (node.collapsed) ids.push(node.id);
      node.children.forEach(walk);
    };
    (tree?.children || []).forEach(walk);
    return ids;
  }

  // 把 laneTree（父子层级）按当前折叠状态展平为行序列；
  // 无 laneTree 时保持组件原有的扁平 AIC/AIV 排序行为（向后兼容）
  _rebuildRows() {
    if (this.laneTree) {
      const rows = [];
      const meta = new Map();
      const collectLeafKeys = (node) => {
        const keys = [];
        const walk = (n) => Array.isArray(n.children) ? n.children.forEach(walk) : keys.push(n.leafKey);
        walk(node);
        return keys;
      };
      const walk = (node, depth) => {
        const isGroup = Array.isArray(node.children);
        if (isGroup) {
          const key = `§g§${node.id}`;
          const collapsed = this.collapsedGroups.has(node.id);
          meta.set(key, {
            type: 'group', id: node.id, label: node.label, depth, collapsed,
            leafKeys: collectLeafKeys(node),
          });
          rows.push(key);
          if (!collapsed) node.children.forEach(c => walk(c, depth + 1));
        } else {
          meta.set(node.leafKey, { type: 'leaf', id: node.leafKey, label: node.label, depth });
          rows.push(node.leafKey);
        }
      };
      (this.laneTree.children || []).forEach(c => walk(c, 0));
      this.sortedCores = rows;
      this.rowMeta = meta;
    } else {
      this.sortedCores = sortCoreNames([...this.parsedData.coreEvents.keys()])
        .filter(n => !n.startsWith('Fake'));
      this.rowMeta = new Map(this.sortedCores.map(n => [n, { type: 'leaf', id: n, label: n, depth: 0 }]));
    }
    this.visibleCores = new Set(this.sortedCores);
  }

  _toggleGroup(id) {
    if (this.collapsedGroups.has(id)) this.collapsedGroups.delete(id);
    else this.collapsedGroups.add(id);
    this._rebuildRows();
    this._resize();
    this._render();
    this._renderLabels();
    if (this.onGroupToggle) this.onGroupToggle(id, this.collapsedGroups.has(id));
  }

  // 供跨实例同步：外部按 groupId 直接设定折叠态（不经过点击、不回调 onGroupToggle），
  // 用于两栏对比时把一侧的展开/折叠状态镜像到另一侧。
  setGroupCollapsed(id, collapsed) {
    const has = this.collapsedGroups.has(id);
    if (has === collapsed) return;
    if (collapsed) this.collapsedGroups.add(id);
    else this.collapsedGroups.delete(id);
    this._rebuildRows();
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
    const contentH = this._layout().bottom + 20;

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

    this.labelCanvas.width  = this.labelWidth * dpr;
    this.labelCanvas.height = canvasH * dpr;
    this.labelCanvas.style.width  = `${this.labelWidth}px`;
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
    ctx.fillStyle = this.pal.BG_COLOR;
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
    const { cores: layoutCores, tops: layoutTops } = this._layout();
    layoutCores.forEach((coreName, rowIndex) => {
      this._renderRow(
        ctx, canvasW, coreName, rowIndex, layoutTops[rowIndex],
        coreEvents.get(coreName) || [],
        colorMap, timeRange, viewStartTime, viewEndTime
      );
    });

    // 关联连线
    this._renderRelations(ctx, canvasW, timeRange);

    // 选中泳道高亮边框——选中泳道本身、仅选中该泳道内的任务条、或额外联动的泳道，都算命中
    const activeLaneKeyForBorder = this._activeLaneKey();
    const activeBorderKeys = activeLaneKeyForBorder
      ? [activeLaneKeyForBorder, ...this.extraActiveLaneKeys]
      : this.extraActiveLaneKeys;
    activeBorderKeys.forEach((key) => {
      const idx = layoutCores.indexOf(key);
      if (idx >= 0) {
        // 仅画左右侧边线，不画上下白边
        ctx.strokeStyle = this.pal.SELECTED_ROW_BORDER;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, layoutTops[idx]);
        ctx.lineTo(0, layoutTops[idx] + SWIMLANE_CONFIG.ROW_HEIGHT);
        ctx.moveTo(canvasW, layoutTops[idx]);
        ctx.lineTo(canvasW, layoutTops[idx] + SWIMLANE_CONFIG.ROW_HEIGHT);
        ctx.stroke();
      }
    });

    // 标注覆盖层（最后绘制，确保在最上层）
    if (this.annotations?.length) this._renderAnnotations(ctx, timeRange);

    // 通知宿主当前视窗可见的时间范围（供标题格的缩放读数占位显示）
    if (this.onViewChange) {
      const visibleUs = viewportW / this.xScale;
      try { this.onViewChange({ visibleUs, label: this._formatTime(visibleUs) }); } catch (e) { /* noop */ }
    }
  }

  // ─── 时间轴 ───────────────────────────────────────────────────
  _renderTimeAxis(ctx, canvasW, timeRange, viewStartTime, viewEndTime, axisY = 0) {
    const axisH    = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT;
    const duration = timeRange.duration;
    const dataW    = this._getDataWidth();
    const canvasH  = this.canvas.height / (window.devicePixelRatio || 1);

    // 背景（仅绘制数据范围 [0, dataW]）
    ctx.fillStyle = this.pal.LABEL_BG;
    ctx.fillRect(0, axisY, dataW, axisH);

    // dataW 右侧若还有空白（视口比数据宽时），填数据范围外的底色
    if (dataW < canvasW) {
      ctx.fillStyle = this.pal.OUTSIDE_BG;
      ctx.fillRect(dataW, axisY, canvasW - dataW, axisH);
      ctx.fillRect(dataW, SWIMLANE_CONFIG.TIME_AXIS_HEIGHT, canvasW - dataW, canvasH);
    }

    // 底部分割线
    ctx.strokeStyle = this.pal.AXIS_COLOR;
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
      ctx.strokeStyle = this.pal.TICK_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, axisY + axisH - 7);
      ctx.lineTo(x, axisY + axisH);
      ctx.stroke();

      // 刻度标签
      ctx.fillStyle = this.pal.TICK_COLOR;
      ctx.fillText(this._formatTime(t), x, axisY + axisH - 9);

      // 纵向虚线：从刻度向下延伸至画布底部，辅助横向对齐时间位置
      ctx.strokeStyle = this.pal.GRID_COLOR;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(x, axisY + axisH);
      ctx.lineTo(x, canvasH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 起始刻度（t=0）：只标 0，不画竖线——未横向滚动时它紧贴标签列的分隔线，
    // 两条线并排会读成一条双线；已滚动时它又在视口外，画了也看不见。
    ctx.fillStyle = this.pal.BOUNDARY_TEXT;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('0', 4, axisY + axisH - 9);

    // 结束边界线（t=duration，x=dataW）
    ctx.strokeStyle = this.pal.BOUNDARY_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(dataW - 0.5, axisY);
    ctx.lineTo(dataW - 0.5, canvasH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = this.pal.BOUNDARY_TEXT;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${this._formatTime(duration)} ►`, dataW - 4, axisY + axisH - 9);
  }

  // ─── 折叠分组行：真实数据反推的覆盖区间（非逐任务细节，提示"展开看细节"）──
  _renderGroupRollupRow(ctx, canvasW, key, meta, y, timeRange, viewStartTime, viewEndTime) {
    const rh = SWIMLANE_CONFIG.ROW_HEIGHT;
    const isSelected = key === this.selectedCore;
    const isHovered  = key === this.hoveredCore;

    ctx.fillStyle = isSelected ? this.pal.SELECTED_ROW_BG
      : isHovered ? this.pal.ROLLUP_ROW_HOVER_BG
      : this.pal.ROLLUP_ROW_BG;
    ctx.fillRect(0, y, canvasW, rh);

    // 只有真正折叠的分组才显示「折叠中」汇总条；展开的分组头是空行（细节在下方子行里）。
    if (!meta.collapsed) return;

    let minS = Infinity, maxE = -Infinity, count = 0;
    for (const leafKey of meta.leafKeys) {
      const evs = this.parsedData.coreEvents.get(leafKey);
      if (!evs) continue;
      for (const ev of evs) {
        const s = ev.ts - timeRange.start, e = s + (ev.dur || 0);
        if (e < viewStartTime || s > viewEndTime) continue;
        if (s < minS) minS = s;
        if (e > maxE) maxE = e;
        count++;
      }
    }
    if (count > 0 && maxE > minS) {
      const x = minS * this.xScale;
      const w = Math.max(1, (maxE - minS) * this.xScale);
      // 无描边浅灰汇总条（信息提示，非数据条）
      ctx.fillStyle = this.pal.ROLLUP_FILL;
      ctx.fillRect(x, y + 4, w, rh - 8);
      if (w >= 60) {
        ctx.fillStyle = this.pal.ROLLUP_TEXT;
        ctx.font = `9px ${this._sansFamily()}`;
        ctx.textAlign = 'left';
        ctx.fillText(`折叠中 · ${meta.leafKeys.length} 条子泳道 · ${count} 个事件`, x + 6, y + rh / 2 + 3);
      }
    }
  }

  // ─── 行渲染 ───────────────────────────────────────────────────
  _renderRow(ctx, canvasW, coreName, rowIndex, y, events, colorMap, timeRange, viewStartTime, viewEndTime) {
    const meta = this.rowMeta.get(coreName);
    if (meta && meta.type === 'group') {
      this._renderGroupRollupRow(ctx, canvasW, coreName, meta, y, timeRange, viewStartTime, viewEndTime);
      return;
    }

    const rh      = SWIMLANE_CONFIG.ROW_HEIGHT;
    const padding = SWIMLANE_CONFIG.ROW_PADDING;
    const patternFontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';

    const isBottleneck = this.highlightBottlenecks && this.bottleneckCores.has(coreName);
    const isSelected   = this._isActiveLane(coreName);
    const isHovered    = coreName === this.hoveredCore;

    // 行背景
    if (isSelected)       ctx.fillStyle = this.pal.SELECTED_ROW_BG;
    else if (isBottleneck) ctx.fillStyle = this.pal.BOTTLENECK_ROW_BG;
    else if (isHovered)    ctx.fillStyle = this.pal.HOVER_ROW_BG;
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
      const color = colorForTask(event, this.colorMode);

      const isHovEvent    = event === this.hoveredEvent;
      const isSelEvent    = event === this.selectedEvent;
      const isRelated     = this.relatedEvents.includes(event);

      // 选中任务后，其他非关联任务降低透明度（焦点汇聚效果）
      const hasSelection = Boolean(this.selectedEvent);
      const isDimmed = hasSelection && !isSelEvent && !isRelated && !isHovEvent;
      const savedAlpha = ctx.globalAlpha;
      if (isDimmed) ctx.globalAlpha = 0.22;

      const barX = x;
      const barY = y + padding;
      const barH = rh - padding * 2;
      // 窄条（密集内核）用直角：2px 圆角摊在 1~4px 宽的方块上只会糊成一团圆点。
      const radius = w < 5 ? 0 : w < 10 ? 1 : 2;
      if (SWIMLANE_TASK_PATTERN?.drawTaskBar) {
        SWIMLANE_TASK_PATTERN.drawTaskBar(ctx, {
          task: event,
          x: barX,
          y: barY,
          width: w,
          height: barH,
          baseColor: color,
          isSelected: isSelEvent,
          isRelated,
          isEmphasized: isHovEvent || isRelated,
          radius,
          fontFamily: patternFontFamily,
        });
      } else {
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
      // 恢复全局 alpha（选中聚焦下非关联任务已调暗）
      if (isDimmed) ctx.globalAlpha = savedAlpha;
    }

    // 气泡（任务间空隙）：只在瓶颈行提示，普通行留空——满屏红色洗底会把任务条淹掉。
    if (this.showBubbles && isBottleneck) {
      const gaps = this.analysisResult?.coreMetrics?.get(coreName)?.gaps;
      if (gaps) {
        for (const gap of gaps) {
          if (gap.duration < 0.5) continue;
          const relStart = gap.start - timeRange.start;
          const relEnd   = gap.end   - timeRange.start;
          if (relEnd < viewStartTime || relStart > viewEndTime) continue;
          const gx = relStart * this.xScale;
          const gw = Math.max(0.5, relEnd * this.xScale - gx);
          ctx.fillStyle = this.pal.BUBBLE_COLOR;
          ctx.fillRect(gx, y + padding, gw, rh - padding * 2);
        }
      }
    }
  }

  // ─── 关联连线 ────────────────────────────────────────────────
  _renderRelations(ctx, canvasW, timeRange) {
    if (!this.showRelationLines || !this.selectedEvent || this.relatedEvents.length === 0) return;
    const cur = this._getEventPos(this.selectedEvent);
    if (!cur) return;

    ctx.save();
    ctx.strokeStyle = this.pal.RELATION_LINE;
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
    const y = this._rowTopOf(coreName);
    if (y < 0) return null;
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
    const W   = this.labelWidth;
    const H   = this.labelCanvas.height / (window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = this.pal.LABEL_BG;
    ctx.fillRect(0, 0, W, H);

    // 时间轴标题区（跟随纵向滚动）。标题格内容由宿主页 HTML 覆盖层提供（搜索 + 缩放占位），
    // 这里只铺底色 + 分隔线，与时间轴一致；不再画「核心」文字。
    const axisY = this.yScrollTop;
    ctx.fillStyle = this.pal.LABEL_BG;
    ctx.fillRect(0, axisY, W, SWIMLANE_CONFIG.TIME_AXIS_HEIGHT);

    ctx.strokeStyle = this.pal.AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, axisY + SWIMLANE_CONFIG.TIME_AXIS_HEIGHT);
    ctx.lineTo(W, axisY + SWIMLANE_CONFIG.TIME_AXIS_HEIGHT);
    ctx.stroke();

    const { cores: visibleCores, tops: labelTops } = this._layout();
    visibleCores.forEach((key, i) => {
      const y  = labelTops[i];
      const rh = SWIMLANE_CONFIG.ROW_HEIGHT;
      const meta = this.rowMeta.get(key) || { type: 'leaf', label: key, depth: 0 };

      const isSelected = this._isActiveLane(key);
      const isHovered  = key === this.hoveredCore;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, W, rh);
      ctx.clip();

      const sans = this._sansFamily();

      if (meta.type === 'group') {
        // 分组行：略亮背景 + 折叠三角 + 粗体标签 + 叶子计数
        // 选中聚焦下，不包含选中任务所在泳道的分组头暗化
        const hasSelection = Boolean(this.selectedEvent);
        const selCore = hasSelection ? this.parsedData.threadMap.get(this.selectedEvent.tid) : null;
        const groupHasSelection = hasSelection && selCore && meta.leafKeys && meta.leafKeys.includes(selCore);
        const groupDimmed = hasSelection && !groupHasSelection;

        ctx.fillStyle = isSelected ? this.pal.GROUP_ROW_SELECTED_BG
          : isHovered ? this.pal.GROUP_ROW_HOVER_BG
          : groupDimmed ? this.pal.GROUP_ROW_BG_DIM
          : this.pal.GROUP_ROW_BG;
        ctx.fillRect(0, y, W, rh);

        const indent = 8 + meta.depth * 13;
        ctx.fillStyle = groupDimmed ? this.pal.LABEL_TEXT_DIM : this.pal.LABEL_MARKER;
        ctx.font = `9px ${sans}`;
        ctx.textAlign = 'left';
        ctx.fillText(meta.collapsed ? '▸' : '▾', indent, y + rh / 2 + 4);

        ctx.fillStyle = groupDimmed ? this.pal.LABEL_TEXT_DIM : this.pal.LABEL_TEXT_STRONG;
        ctx.font = `600 11px ${sans}`;
        ctx.fillText(meta.label, indent + 13, y + rh / 2 + 4);

        if (meta.collapsed) {
          ctx.fillStyle = groupDimmed ? this.pal.LABEL_TEXT_DIM : this.pal.LABEL_TEXT;
          ctx.font = `500 9px ${sans}`;
          ctx.textAlign = 'right';
          ctx.fillText(`${meta.leafKeys.length}`, W - 6, y + rh / 2 + 4);
        }
      } else {
        const isBottleneck = this.highlightBottlenecks && this.bottleneckCores.has(key);

        // 选中任务后，非关联泳道的标签暗化（焦点汇聚）
        const hasSelection = Boolean(this.selectedEvent);
        const selCore = hasSelection ? this.parsedData.threadMap.get(this.selectedEvent.tid) : null;
        const isSelectionRelated = hasSelection && (
          key === selCore ||
          this.relatedEvents.some(function (e) { return this.parsedData.threadMap.get(e.tid) === key; }.bind(this))
        );
        const labelDimmed = hasSelection && !isSelectionRelated;

        if (isSelected)        ctx.fillStyle = this.pal.LABEL_SELECTED_BG;
        else if (isBottleneck) ctx.fillStyle = this.pal.LABEL_BOTTLENECK_BG;
        else if (isHovered)    ctx.fillStyle = this.pal.LABEL_HOVER_BG;
        else                   ctx.fillStyle = this.pal.LABEL_BG;
        ctx.fillRect(0, y, W, rh);

        const cy = y + rh / 2;
        const indent = 8 + meta.depth * 13;

        // 利用率（0–100）：够宽时右侧画 meter + 百分比，窄列只画名称。
        const util = this.analysisResult?.coreMetrics?.get(key)?.utilization;
        const hasUtil = Number.isFinite(util);
        const showMeter = hasUtil && W >= 190;
        const rightPad = 6, pctW = 30, meterW = 34, meterGap = 6;
        let rightZone = 0;
        if (hasUtil) rightZone = rightPad + pctW + (showMeter ? meterGap + meterW : 0);

        // 名称（sans）—— 暗化非关联泳道
        ctx.fillStyle = isSelected ? this.pal.LABEL_TEXT_SELECTED
          : labelDimmed ? this.pal.LABEL_TEXT_DIM
          : this.pal.LABEL_TEXT;
        ctx.font = `${isSelected ? 600 : 400} 11px ${sans}`;
        ctx.textAlign = 'left';
        const nameMaxW = Math.max(20, W - rightZone - indent - 4);
        ctx.fillText(this._ellipsize(ctx, meta.label, nameMaxW), indent, cy + 1.5);

        if (hasUtil) {
          // 泳道利用率 meter：蓝色，纯利用率指示（占比详情见悬浮气泡）
          if (showMeter) {
            const mx = W - rightPad - pctW - meterGap - meterW;
            const my = cy - 2, mh = 4;
            ctx.fillStyle = this.pal.METER_TRACK;
            ctx.beginPath(); ctx.roundRect(mx, my, meterW, mh, 2); ctx.fill();
            const fillW = Math.max(2, meterW * Math.min(100, Math.max(0, util)) / 100);
            ctx.fillStyle = labelDimmed ? this.pal.METER_FILL_DIM : this.pal.METER_FILL;
            ctx.beginPath(); ctx.roundRect(mx, my, fillW, mh, 2); ctx.fill();
          }
          // 百分比（等宽数字对齐；中性色）
          ctx.fillStyle = labelDimmed ? this.pal.LABEL_TEXT_DIM : this.pal.LABEL_TEXT;
          ctx.font = `500 10px ${sans}`;
          ctx.textAlign = 'right';
          ctx.fillText(`${Math.round(util)}%`, W - rightPad, cy + 0.5);
        } else if (isBottleneck) {
          // 无利用率数据但被判为瓶颈：保留 ⚠
          ctx.fillStyle = this.pal.WARNING;
          ctx.font = `10px ${sans}`;
          ctx.textAlign = 'right';
          ctx.fillText('⚠', W - rightPad, cy + 0.5);
        }
      }
      ctx.restore();
    });

    // 选中泳道（含"仅选中其内任务条"、以及额外联动的泳道）：整行最左侧描 2px 白边，
    // 与行背景高亮呼应，分组头不参与——分组本身的选中态另有 GROUP_ROW_SELECTED_BG，不需要这条白边。
    const activeLaneKeyForEdge = this._activeLaneKey();
    const activeEdgeKeys = activeLaneKeyForEdge
      ? [activeLaneKeyForEdge, ...this.extraActiveLaneKeys]
      : this.extraActiveLaneKeys;
    activeEdgeKeys.forEach((key) => {
      if (this.rowMeta.get(key)?.type === 'group') return;
      const idx = visibleCores.indexOf(key);
      if (idx >= 0) {
        const y = labelTops[idx];
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(1, y);
        ctx.lineTo(1, y + SWIMLANE_CONFIG.ROW_HEIGHT);
        ctx.stroke();
      }
    });

    // 右侧边框
    ctx.strokeStyle = this.pal.AXIS_COLOR;
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

    const rowIndex = this._rowIndexAtY(mouseY);
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

  // 泳道利用率气泡：标题「<泳道> 泳道利用率」+ 利用率 + 计算/通信/空闲等各占比
  _showLaneTooltip(e, coreName) {
    const metric = this.analysisResult?.coreMetrics?.get(coreName);
    if (!metric || !metric.totalSpan) { this._hideTooltip(); return; }
    const laneName = this.rowMeta.get(coreName)?.label || coreName;

    const span = metric.totalSpan;
    // 按语义标签聚合活跃时长
    const byLabel = new Map();
    for (const ev of (metric.events || [])) {
      const k = ev.label || 'unknown';
      byLabel.set(k, (byLabel.get(k) || 0) + (ev.dur || 0));
    }
    const rows = [...byLabel.entries()]
      .map(([label, t]) => ({ label, pct: (t / span) * 100, color: colorForTask({ label }, 'semantic') }))
      .filter(r => r.pct >= 0.05)
      .sort((a, b) => b.pct - a.pct);
    const idlePct = Math.max(0, (metric.idleTime / span) * 100);

    const swatch = (c) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c};margin-right:6px;vertical-align:middle"></span>`;
    const fmtPct = (p) => (p >= 10 ? p.toFixed(0) : p.toFixed(1)) + '%';

    let body = `<div class="tt-row"><span>利用率</span><span style="color:${this.pal.METER_FILL};font-weight:600">${fmtPct(metric.utilization)}</span></div>`;
    body += `<div class="tt-row" style="opacity:.5"><span>—— 各类占比 ——</span><span></span></div>`;
    for (const r of rows) {
      const name = LABEL_ZH[r.label] || r.label;
      body += `<div class="tt-row"><span>${swatch(r.color)}${name}</span><span>${fmtPct(r.pct)}</span></div>`;
    }
    body += `<div class="tt-row"><span>${swatch(this.pal.METER_TRACK)}空闲</span><span>${fmtPct(idlePct)}</span></div>`;

    this.tooltip.innerHTML = `
      <div class="tt-header"><span class="tt-core">${laneName}</span><span class="tt-op">泳道利用率</span></div>
      <div class="tt-body">${body}</div>`;
    this.tooltip.style.display = 'block';

    const tx = e.clientX + 14, ty = e.clientY - 10;
    const ttH = this.tooltip.offsetHeight;
    this.tooltip.style.left = `${Math.min(tx, window.innerWidth - 260)}px`;
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
    const y = this._rowTopOf(coreName);
    if (y < 0) return;
    this.selectedCore = coreName;

    const vp = this._viewport();
    if (vp) vp.scrollTop = Math.max(0, y - vp.clientHeight / 2);

    this._render();
    this._renderLabels();
  }

  // ─── 跨实例任务条选中同步 ─────────────────────────────────────
  // 两栏对比时各自持有独立数据集，事件对象/taskId 不通用；用「泳道行 + subGraphId + 语义
  // label + 同桶内按时间排序的序号」这个结构性定位（两栏树结构一致时序号语义对齐），
  // 在另一侧数据里找回「同一位置」的任务条，作为跨栏选中同步的落点。
  positionalKeyOfEvent(event) {
    if (!event || !this.parsedData) return null;
    const coreName = this.parsedData.threadMap.get(event.tid) || `Core_${event.tid}`;
    const bucket = (this.parsedData.coreEvents.get(coreName) || [])
      .filter((e) => e.subGraphId === event.subGraphId && e.label === event.label)
      .sort((a, b) => a.ts - b.ts);
    return { coreName, subGraphId: event.subGraphId, label: event.label, ordinal: bucket.indexOf(event) };
  }

  findEventByPositionalKey(key) {
    if (!key || !this.parsedData) return null;
    const bucket = (this.parsedData.coreEvents.get(key.coreName) || [])
      .filter((e) => e.subGraphId === key.subGraphId && e.label === key.label)
      .sort((a, b) => a.ts - b.ts);
    return bucket[key.ordinal] || null;
  }

  // 供外部（跨栏同步）直接设定选中任务；key 为 null 表示清除选中；不回调 onEventClick，避免联动死循环。
  setSelectedEventByKey(key) {
    const event = key ? this.findEventByPositionalKey(key) : null;
    if (event === this.selectedEvent) return;
    this.selectedEvent = event;
    this.relatedEvents = event ? this._getRelatedEvents(event) : [];
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

  // ─── 行布局（可变行顶：分组块之间插空隙）─────────────────────
  // 返回可见行数组 cores、各行顶部 y 坐标 tops、内容底部 bottom。
  // 行高恒为 ROW_HEIGHT；空隙是不属于任何行的死区（命中测试落空）。
  _layout() {
    const cores = this._getVisibleCores();
    const tops = new Array(cores.length);
    const gap = SWIMLANE_CONFIG.CORE_GAP_H;
    let y = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT;
    let prevType = null;
    for (let i = 0; i < cores.length; i += 1) {
      const type = this.rowMeta.get(cores[i])?.type || 'leaf';
      // 只在「一个新分组块开始」时留白：紧跟在叶子行之后的分组头。
      // 连续嵌套的分组头（Rank→Ascend Hardware→Stream）不累加空隙。
      if (i > 0 && type === 'group' && prevType === 'leaf') y += gap;
      tops[i] = y;
      y += SWIMLANE_CONFIG.ROW_HEIGHT;
      prevType = type;
    }
    return { cores, tops, bottom: y };
  }

  /** 某可见行的顶部 y（找不到返回 -1）。 */
  _rowTopOf(coreName) {
    const { cores, tops } = this._layout();
    const i = cores.indexOf(coreName);
    return i < 0 ? -1 : tops[i];
  }

  /** 按像素宽截断文字并加省略号（ctx.font 须已设好）。 */
  _ellipsize(ctx, text, maxW) {
    const s = String(text ?? '');
    if (maxW <= 0) return '';
    if (ctx.measureText(s).width <= maxW) return s;
    const ell = '…';
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(s.slice(0, mid) + ell).width <= maxW) lo = mid; else hi = mid - 1;
    }
    return lo > 0 ? s.slice(0, lo) + ell : ell;
  }

  /** 页面 --font-sans（供 canvas 文字用），带缓存。 */
  _sansFamily() {
    if (this._sansFamilyCache) return this._sansFamilyCache;
    let v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim(); } catch (e) { /* noop */ }
    this._sansFamilyCache = v || 'system-ui, -apple-system, "Segoe UI", sans-serif';
    return this._sansFamilyCache;
  }

  /** 画布/标签列纵坐标 → 可见行索引（落在空隙里返回 -1）。 */
  _rowIndexAtY(mouseY) {
    const { cores, tops } = this._layout();
    for (let i = 0; i < cores.length; i += 1) {
      if (mouseY >= tops[i] && mouseY < tops[i] + SWIMLANE_CONFIG.ROW_HEIGHT) return i;
    }
    return -1;
  }

  _getRelatedEvents(event) {
    if (!event || !this.parsedData?.relations) return [];
    return Array.from(this.parsedData.relations.get(event) ?? []);
  }

  /** 当前应高亮的泳道 key：显式选中的泳道优先，否则取选中任务条所在的泳道。 */
  _activeLaneKey() {
    if (this.selectedCore) return this.selectedCore;
    if (this.selectedEvent && this.parsedData) return this.parsedData.threadMap.get(this.selectedEvent.tid) || null;
    return null;
  }

  /** key 是否应按"选中泳道"样式高亮：主选中泳道，或宿主页塞进来的额外联动泳道。 */
  _isActiveLane(key) {
    if (key == null) return false;
    if (key === this._activeLaneKey()) return true;
    return this.extraActiveLaneKeys.includes(key);
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

  // ─── 标注 API ────────────────────────────────────────────────
  setAnnotations(annotations) {
    this.annotations = Array.isArray(annotations) ? annotations : [];
    const hasTasks = this.annotations.some(a => a.type === 'task');
    if (hasTasks) {
      this._startPulseLoop();
    } else {
      this._stopPulseLoop();
      this._render();
      this._renderLabels();
    }
  }

  _startPulseLoop() {
    if (this._pulseLoopActive) return;
    this._pulseLoopActive = true;
    const tick = () => {
      if (!this._pulseLoopActive) return;
      this._render();
      this._animFrame = requestAnimationFrame(tick);
    };
    this._animFrame = requestAnimationFrame(tick);
  }

  _stopPulseLoop() {
    this._pulseLoopActive = false;
    if (this._animFrame) { cancelAnimationFrame(this._animFrame); this._animFrame = null; }
  }

  // rAF 节流重绘（滚动/拖拽时调用）——_render 会按当前 scrollLeft 裁剪，故滚动必须重绘
  _scheduleRender() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this._render();
    });
  }

  _renderAnnotations(ctx, timeRange) {
    if (!this.annotations?.length || !this.parsedData) return;

    ctx.save();
    ctx.setLineDash([]);

    const canvasH   = this.canvas.height / (window.devicePixelRatio || 1);
    const layout    = this._layout();
    const contentY  = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT;
    const contentH  = layout.bottom - contentY;
    const axisY     = this.yScrollTop;
    const axisH     = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT;
    // 呼吸节拍：1Hz，0→1→0
    const pulse     = 0.5 + 0.5 * Math.sin(Date.now() / 500 * Math.PI);

    for (const ann of this.annotations) {
      // ── 时间范围标注 ──────────────────────────────────────
      if (ann.type === 'range') {
        const x1 = ann.startTime * this.xScale;
        const x2 = ann.endTime   * this.xScale;
        const w  = x2 - x1;
        if (w <= 0) continue;

        // 半透明红色背景覆盖内容区
        ctx.fillStyle = 'rgba(255, 55, 55, 0.09)';
        ctx.fillRect(x1, contentY, w, contentH);

        // 左右虚线边界
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 85, 85, 0.55)';
        ctx.setLineDash([4, 3]);
        for (const x of [x1, x2]) {
          ctx.beginPath();
          ctx.moveTo(x, contentY);
          ctx.lineTo(x, contentY + contentH);
          ctx.stroke();
        }
        ctx.setLineDash([]);

        // 时间轴：范围标签（顶部红字）
        const midX = (x1 + x2) / 2;
        ctx.fillStyle = '#FF5050';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(ann.label || '', midX, axisY + 13);

        // 时间轴：起止刻度值（底部红字，仅当宽度足够时显示）
        if (w > 80) {
          ctx.fillStyle = 'rgba(255, 85, 85, 0.8)';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(this._formatTime(ann.startTime), x1, axisY + axisH - 3);
          ctx.fillText(this._formatTime(ann.endTime),   x2, axisY + axisH - 3);
        }

      // ── 时间点标注 ────────────────────────────────────────
      } else if (ann.type === 'point') {
        const x = ann.time * this.xScale;

        // 红色竖线贯穿内容区
        ctx.strokeStyle = 'rgba(255, 70, 70, 0.75)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, contentY);
        ctx.lineTo(x, contentY + contentH);
        ctx.stroke();

        // 时间轴：红色刻度标签
        ctx.fillStyle = '#FF5050';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(ann.label || this._formatTime(ann.time), x, axisY + 13);

        // 时间轴底部小三角标记
        ctx.strokeStyle = '#FF5050';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, axisY + axisH - 7);
        ctx.lineTo(x, axisY + axisH);
        ctx.stroke();

      // ── 任务描边标注（呼吸动画）──────────────────────────
      } else if (ann.type === 'task') {
        for (const [coreName, events] of this.parsedData.coreEvents) {
          const rowIdx = layout.cores.indexOf(coreName);
          if (rowIdx < 0) continue;
          const rowY   = layout.tops[rowIdx];
          const pad    = SWIMLANE_CONFIG.ROW_PADDING;
          const barH   = SWIMLANE_CONFIG.ROW_HEIGHT - pad * 2;

          for (const ev of events) {
            const tidOk  = ann.tid     === undefined || ev.tid    === ann.tid;
            const taskOk = ann.taskId  === undefined || ev.taskId === ann.taskId;
            if (!tidOk || !taskOk) continue;

            const relStart = ev.ts - timeRange.start;
            const barX = relStart * this.xScale;
            const barW = Math.max(SWIMLANE_CONFIG.MIN_TASK_WIDTH, (ev.dur || 0) * this.xScale);
            const barY = rowY + pad;

            // 呼吸描边：线宽 1.5→3，透明度 0.55→1
            ctx.strokeStyle = `rgba(255, 50, 50, ${0.55 + 0.45 * pulse})`;
            ctx.lineWidth = 1.5 + 1.5 * pulse;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.roundRect(barX + 0.5, barY + 0.5, Math.max(0, barW - 1), Math.max(0, barH - 1), 3);
            ctx.stroke();
          }
        }
      }
    }

    ctx.restore();
  }
}

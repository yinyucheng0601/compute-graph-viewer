# 从分析报告问题卡片嵌入 Swimlane Timeline 的完整流程

> 适用场景：把已有落盘文件（communication.json / step_trace_time.csv）中的数值，转化为 swimlane 泳道图，嵌入到 Web 报告页的问题卡片里，做到"就地举证"。

---

## 一、判断哪些问题值得渲染 Timeline

读报告的 `visualization` 字段，凡出现 **"Timeline 视图"** 字样的问题，都可用 swimlane 举证。其他视图映射关系：

| 可视化类型 | 适合的图表 |
|---|---|
| Timeline 视图（系统调优） | swimlane 泳道图，rank 级别 lanes |
| 算子视图 | ECharts 柱图 / 散点图，不适合 swimlane |
| 通信视图 | 带宽柱图 / 矩阵热图，不适合 swimlane |

---

## 二、从落盘文件提取锚点数值

### 2.1 step_trace_time.csv → 每卡的宏观时间段

```
Device_id, Step, Computing, Communication(Not Overlapped), Free, Stage, Bubble, ...
```

关键列：
- `Computing`：该 rank 的 NPU 计算总耗时（μs）
- `Free`：该 rank 的空闲总耗时（μs）——PP 场景里约等于 PP 气泡
- `Stage`：整步总耗时（μs），用作 x 轴终点

### 2.2 communication.json → P2P 和 collective 的精确时间戳

顶层结构：`{ "step13": { "p2p": {...}, "collective": {...} } }`

每个通信算子的关键字段：
```jsonc
"hcom_batchSendRecv__128_4_1": {
  "Communication Time Info": {
    "Start Timestamp(us)": 1764246877228630.0,   // 绝对时间戳（μs）
    "Elapse Time(ms)": 158.553,                   // 总耗时
    "Wait Time(ms)": 158.102,                     // 等待时间（气泡 = Wait ≫ Transit）
    "Idle Time(ms)": 0.451                        // 发送侧空闲（Idle ≫ Wait 说明是发送方）
  }
}
```

**判断规则**：
- `Wait Time ≈ Elapse Time`（Wait 比 > 95%）→ 接收侧等待，是气泡来源
- `Idle Time ≈ Elapse Time`（Wait = 0）→ 发送侧 P2P，rank 本身不等待

### 2.3 把绝对时间戳转换为步内相对时间

```
T_ref = 最早的关键 hcom 事件的 Start Timestamp
hcom_相对时间 = hcom.Start_Timestamp - T_ref
```

选一个 "步开始" 估计点（如：PP 气泡开始的 hcom 的相对时间 - 预估前向计算时间），
或直接以第一个 P2P hcom 为 T=0，然后在前面加估计的前向段。

---

## 三、CoreTask JSON 构建规则（PP Pipeline 场景）

以 2-stage PP Pipeline 为例，构造 2 条 lane：

### Lane 命名
- 命名不限格式，不以 `AIC_`/`AIV_` 开头时视为 "OTHER" 类型，按字母升序排列
- 示例：`"rank_0 · PP Stage 0"`、`"rank_2 · PP Stage 1"`

### 语义标签与颜色（已预置在 LABEL_COLORS）

| semanticLabel | 颜色 | 含义 |
|---|---|---|
| `Fwd-Compute` | `#4369EF` | 前向计算 |
| `Bwd-Compute` | `#A78BFA` | 反向计算 |
| `PP-Bubble` | `#FF4B7B` | PP 气泡（等待对侧） |
| `P2P-Send` | `#FFAA3B` | P2P 发送 |
| `P2P-Recv` | `#FFAA3B` | P2P 接收 |
| `DP-Collective` | `#04D793` | DP 集合通信 |
| `Optimizer` | `#5B8CD5` | 优化器更新 |
| `Free` | `#2A2A2A` | 空闲 |

### 时间布局原则

1. **PP-Bubble 宽度必须等于 communication.json 里的 `Elapse Time`（μs）**——这是唯一精确值，其余段落可估算
2. PP Stage 1（末级）的计算时长 = PP Stage 0 的 Free 时间 + 那段对应的计算，两者对齐即可说明问题
3. rank_0 和 rank_2 的泳道起点对齐（T=0 表示步开始），气泡时间段在两条 lane 上形成明显的"一个等、一个算"的视觉对比
4. 有 hcom 绝对时间戳时，用 `hcom_A_abs - hcom_B_abs` 计算各段之间的精确间隔；没有时用 step_trace 总量反推

### 最小可行模板

```json
[
  {
    "blockIdx": 0,
    "coreType": "rank_0 · PP Stage 0",
    "tasks": [
      { "taskId": 1, "subGraphId": 0,
        "execStart": 0, "execEnd": 115000,
        "semanticLabel": "Fwd-Compute",
        "taskName": "前向计算 (115ms)" },
      { "taskId": 2, "subGraphId": 0,
        "execStart": 115000, "execEnd": 273553,
        "semanticLabel": "PP-Bubble",
        "taskName": "hcom_batchSendRecv · Wait 158.1ms — rank_2 仍在计算" },
      { "taskId": 3, "subGraphId": 0,
        "execStart": 273553, "execEnd": 389843,
        "semanticLabel": "Bwd-Compute",
        "taskName": "反向计算 (116ms)" }
    ]
  },
  {
    "blockIdx": 1,
    "coreType": "rank_2 · PP Stage 1",
    "tasks": [
      { "taskId": 10, "subGraphId": 0,
        "execStart": 0, "execEnd": 115000,
        "semanticLabel": "Free",
        "taskName": "等待 rank_0 激活值" },
      { "taskId": 11, "subGraphId": 0,
        "execStart": 115000, "execEnd": 273553,
        "semanticLabel": "Fwd-Compute",
        "taskName": "前向计算 (含 LM Head, 158ms) — 与 rank_0 气泡完全重叠" },
      { "taskId": 12, "subGraphId": 0,
        "execStart": 273553, "execEnd": 515448,
        "semanticLabel": "Bwd-Compute",
        "taskName": "反向计算 (242ms)" }
    ]
  }
]
```

---

## 四、嵌入问题卡片的 DOM + JS 模式

### 4.1 HTML 结构（3 层必须严格对应）

```html
<!-- 放在 ac-body 内，问题详情之后 -->
<div class="ac-section-title ac-sl-title">Timeline 局部 · 来自 trace_view.json</div>
<div class="ac-swimlane-wrap">
  <!-- viewport: overflow:auto，是 _viewport() 识别的那层 -->
  <div class="ac-sl-vp"
       data-rid="${reportId}" data-aid="${actionId}"
       style="overflow:auto;position:relative;width:100%;height:120px">
    <!-- inner: display:flex -->
    <div style="display:flex;position:relative">
      <!-- labelEl: position:sticky 固定左侧泳道名 -->
      <div class="ac-sl-label" style="position:sticky;left:0;flex-shrink:0;z-index:10"></div>
      <!-- canvasEl: 主渲染区 -->
      <div class="ac-sl-canvas" style="flex:1;min-width:0"></div>
    </div>
  </div>
</div>
```

层级关系：`canvasEl → inner div → viewport(.ac-sl-vp)`，
`SwimlaneRenderer` 内部通过 `container.parentElement.parentElement` 取 viewport。

**高度经验值**：
- 1 条 lane：70px（30 时间轴 + 22 行高 + 18 余量）
- 2 条 lane：100–120px
- 4 条 lane：160–180px

### 4.2 CSS（追加到 styles.css）

```css
.ac-swimlane-wrap {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: #111111;
}
.ac-sl-label { background: #1B1B1B; border-right: 1px solid var(--border-subtle); }

/* Tooltip（全局追加一次） */
.swimlane-tooltip {
  position: fixed; z-index: 10000;
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  min-width: 220px; max-width: 380px;
  font-size: 12px; pointer-events: none;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5); overflow: hidden;
}
.swimlane-tooltip .tt-header { display:flex; gap:8px; padding:8px 12px; background:var(--surface-4); border-bottom:1px solid var(--border); }
.swimlane-tooltip .tt-body   { padding:8px 12px; display:flex; flex-direction:column; gap:4px; }
.swimlane-tooltip .tt-row    { display:flex; justify-content:space-between; font-size:11px; gap:12px; }
.swimlane-tooltip .tt-row span:first-child { color:var(--fg-muted); }
```

### 4.3 JS 初始化（懒加载 + 双 RAF）

```js
// 收起/展开卡片时触发
window.toggleAcCard = function(card) {
  card.classList.toggle('expanded');
  if (!card.classList.contains('expanded')) return;
  const vp = card.querySelector('.ac-sl-vp');
  if (!vp || vp._slRenderer) return;          // 防重复初始化
  requestAnimationFrame(() => initAcSwimlane(vp));
};

function initAcSwimlane(vp) {
  const rid  = vp.dataset.rid;
  const aid  = +vp.dataset.aid;
  const data = SWIMLANE_DATA[rid]?.[aid];      // CoreTask JSON
  if (!data || typeof SwimlaneRenderer === 'undefined') return;

  const inner    = vp.children[0];
  const labelEl  = inner.querySelector('.ac-sl-label');
  const canvasEl = inner.querySelector('.ac-sl-canvas');

  const parsed   = parseTraceJSON(data);       // parser.js
  const renderer = new SwimlaneRenderer(canvasEl, labelEl);
  vp._slRenderer = renderer;                   // 标记已初始化

  // 双 RAF：第一帧让浏览器完成 display:block 布局，第二帧取到正确宽高
  requestAnimationFrame(() => {
    renderer.loadData(parsed, null);
    requestAnimationFrame(() => {
      renderer.fitToView();
      renderer.onResize();
    });
  });
}
```

**为什么要双 RAF**：
`action-card.expanded` 展开时，`.ac-body { display: block }` 在 CSS 中，浏览器需要一帧完成重排。
第一帧内 `clientWidth` 可能还是 0，导致 `xScale` 算出 Infinity 或极大值。
第二帧保证拿到真实容器宽度，`fitToView()` 才能正确把整条时间轴铺满视口。

### 4.4 脚本引入顺序（index.html）

```html
<!-- 在 app.js type="module" 之前 -->
<script src="../swimlane-skill-pack/js/parser.js"></script>
<script src="../swimlane-skill-pack/js/analyzer.js"></script>
<script src="../swimlane-skill-pack/js/swimlane.js"></script>
<script type="module" src="app.js"></script>
```

`parser.js` / `analyzer.js` / `swimlane.js` 是普通脚本（无 export），
它们的函数（`parseTraceJSON`, `SwimlaneRenderer`）挂在全局 `window` 上，
可以从 `type="module"` 的 app.js 内通过全局名访问。

---

## 五、新增自定义语义标签颜色

如果需要额外的语义标签颜色（不在 LABEL_COLORS 默认列表里），直接追加到 `swimlane.js` 里的 `const LABEL_COLORS = { ... }` 对象：

```js
// 示例：算子级问题专用颜色
'MatMul-Slow':   '#FF8C42',  // MIX_AIC 路径 → 橙色警告
'CE-Serial':     '#FF4B7B',  // Cross-Entropy 串行 → 红色
'HCCS-Underutil':'#FFAA3B',  // 带宽利用率低 → 黄色
```

---

## 六、数据精度要求

| 字段 | 精度要求 | 说明 |
|---|---|---|
| PP-Bubble / Wait 段宽度 | **必须精确** | 直接来自 `Elapse Time(ms)` × 1000 |
| P2P Send/Recv 宽度 | **必须精确** | 同上 |
| Fwd / Bwd Compute 宽度 | 可估算 | 用 `Computing` 总量扣除已知段；目的是让两条 lane 可视高度差反映问题 |
| DP Collective 宽度 | **必须精确** | 来自 `hcom_reduceScatter` 等各项的 `Elapse Time` |
| 步开始时间 (T=0) 选取 | 按需估算 | 选一个关键 hcom 的绝对时间作锚，前向计算段长度 = 气泡开始时间 - T0 |

---

## 七、常见坑

1. **`PP_SWIMLANE_DATA[rid]?.[aid]` 的 aid 必须是数字**（`+vp.dataset.aid`），dataset 取出来是字符串。
2. **action-card onclick 改成调用 `toggleAcCard()`** 后，原来的内联 toggle 要去掉，否则事件绑定双倍触发。
3. **同一报告多次选中**：若 `renderIssues()` 重新设置 `innerHTML`，旧的 `_slRenderer` 也随 DOM 一起销毁，不需要手动 dispose。
4. **swimlane tooltip z-index**：tooltip 由 `SwimlaneRenderer` 追加到 `document.body`，z-index 需高于所有卡片的 `z-index`（建议 10000）。
5. **label container 宽度由 canvas 决定**：不要给 `.ac-sl-label` 设固定宽度，`_resize()` 会自动把 labelCanvas 设为 `LABEL_WIDTH = 120px`。

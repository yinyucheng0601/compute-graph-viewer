# Swimlane 标注 API 提案

## 背景

在将 SwimlaneRenderer 用于 AI 性能分析报告的问题卡片时，遇到了一个可用性问题：

> 读者要花大量时间在泳道图中用肉眼寻找报告文字描述的时间点、任务名，很难快速定位"问题在哪"。

为此在 `swimlane.js` 中增加了一套**标注覆盖层**能力，让调用方在渲染完成后通过 `setAnnotations()` 直接把"问题点"标出来，无需读者自行查找。

---

## 变更范围

仅修改 `js/swimlane.js`，对外新增一个公开方法 `setAnnotations(annotations)`。现有渲染逻辑、数据格式、事件系统均不受影响，向下兼容。

---

## 新增代码

在 `SwimlaneRenderer` 类中新增以下内容。

### 1. 构造函数追加字段

```js
// 标注
this.annotations = [];
this._pulseLoopActive = false;
this._animFrame = null;
```

位置：在现有的 `this.groupBands = [];` 之后、`this.onCoreClick = null;` 之前。

---

### 2. `_render()` 末尾追加一行调用

```js
// 标注覆盖层（最后绘制，确保在最上层）
if (this.annotations?.length) this._renderAnnotations(ctx, timeRange);
```

位置：在"选中核心高亮边框"块之后、`_render()` 的闭合 `}` 之前。

---

### 3. 新增四个方法

在 `_mixColor()` 之后、class 闭合 `}` 之前追加：

```js
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

_renderAnnotations(ctx, timeRange) {
  if (!this.annotations?.length || !this.parsedData) return;

  ctx.save();
  ctx.setLineDash([]);

  const canvasH      = this.canvas.height / (window.devicePixelRatio || 1);
  const visibleCores = this._getVisibleCores();
  const contentY     = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT;
  const contentH     = visibleCores.length * SWIMLANE_CONFIG.ROW_HEIGHT;
  const axisY        = this.yScrollTop;
  const axisH        = SWIMLANE_CONFIG.TIME_AXIS_HEIGHT;
  // 呼吸节拍：1Hz，值在 0→1→0 之间正弦震荡
  const pulse        = 0.5 + 0.5 * Math.sin(Date.now() / 500 * Math.PI);

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

      // 时间轴：起止刻度值（底部红字，仅当像素宽度 > 80px 时显示）
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

      // 时间轴底部小三角刻度标记
      ctx.strokeStyle = '#FF5050';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, axisY + axisH - 7);
      ctx.lineTo(x, axisY + axisH);
      ctx.stroke();

    // ── 任务描边标注（呼吸动画）──────────────────────────
    } else if (ann.type === 'task') {
      for (const [coreName, events] of this.parsedData.coreEvents) {
        const rowIdx = visibleCores.indexOf(coreName);
        if (rowIdx < 0) continue;
        const rowY = contentY + rowIdx * SWIMLANE_CONFIG.ROW_HEIGHT;
        const pad  = SWIMLANE_CONFIG.ROW_PADDING;
        const barH = SWIMLANE_CONFIG.ROW_HEIGHT - pad * 2;

        for (const ev of events) {
          const tidOk  = ann.tid    === undefined || ev.tid    === ann.tid;
          const taskOk = ann.taskId === undefined || ev.taskId === ann.taskId;
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
```

---

## 公开 API 说明

### `renderer.setAnnotations(annotations)`

在 `loadData()` 之后调用。可多次调用，后一次会完全替换前一次。传入空数组 `[]` 可清除所有标注。

**参数：** `annotations` — `Annotation[]`，每个元素为以下三种类型之一：

---

### 类型 1：时间点标注 `point`

在指定时间处画一条**从时间轴贯穿到内容区底部的红色竖线**，时间轴上方显示红色标签、底部显示一个小三角刻度。

```ts
{
  type: 'point';
  time: number;    // 相对时间（与 CoreTask execStart 同单位，timeRange.start 为 0 参考点）
  label?: string;  // 时间轴显示的文字；省略时自动用 _formatTime(time) 格式化
}
```

**视觉效果：**

```
时间轴  ┌─────────── 串行→DP等优化器结束 ──────────────┐
        │                    ↑ 红字                      │
────────┼────────────────────▼────────────────────────────
 lane 0 │                    │ ← 红色竖线 (1.5px)        │
────────┼────────────────────│────────────────────────────
 lane 1 │                    │                            │
        └────────────────────┘
```

**适用场景：** 两个阶段的分界线（如"优化器结束 → DP collective 开始"的串行边界点）。

---

### 类型 2：时间范围标注 `range`

在指定时间范围内覆盖**淡红色背景**，左右两侧画红色虚线边界，时间轴顶部显示标签，底部（像素宽度 > 80px 时）显示起止时间值。

```ts
{
  type: 'range';
  startTime: number;  // 范围起始相对时间
  endTime: number;    // 范围结束相对时间
  label?: string;     // 时间轴顶部显示的说明文字（建议简短，如"158ms PP气泡"）
}
```

**视觉效果：**

```
时间轴  ┌── 158ms PP气泡 ──┐
        │  ↑ 红字 居中      │
────────┼──┊───────────────┊─────────
 lane 0 │  ┊ 淡红背景(9%)  ┊         
────────┼──┊───────────────┊─────────
 lane 1 │  ┊               ┊         
        └──┊               ┊─────────
           ↑虚线            ↑虚线
         115ms            274ms  ← 底部红字（宽度足够时）
```

**适用场景：** 一段持续性的等待、气泡、阻塞区间（PP 气泡、D2H 同步阻塞、host overhead 等）。

---

### 类型 3：任务描边标注 `task`

对精确命中的任务条画**动态呼吸红色圆角描边**，线宽和透明度以 1Hz 频率正弦震荡，用 `requestAnimationFrame` 驱动。

```ts
{
  type: 'task';
  tid?: number;     // 泳道索引（0-based），对应 CoreTask 数组的下标顺序；
                    // 省略则匹配所有泳道中 taskId 相同的任务
  taskId?: number;  // 任务 ID，与 CoreTask.tasks[i].taskId 一致；
                    // 省略则匹配指定泳道的全部任务
}
```

**视觉效果：**

```
 lane 0 │  ┌─ · · · · · · · · · · ─┐        ← 红色描边
        │  │  任务名称               │ ← 任务条
        │  └─ · · · · · · · · · · ─┘
```

描边参数随 `pulse = 0.5 + 0.5·sin(t)` 变化：
- `lineWidth` = 1.5 + 1.5 × pulse（即 1.5px → 3px）
- `alpha` = 0.55 + 0.45 × pulse（即 0.55 → 1.0）

**适用场景：** 需要精确指向某一个或几个任务条（如 MemSet 交替出现的多个任务、并排对比中差异明显的那条、造成问题的特定 hcom 算子等）。

> **注意：** 只要存在至少一个 `type: 'task'` 标注，`_startPulseLoop()` 就会自动启动持续渲染；清除所有 task 标注后会自动停止。`range` 和 `point` 类型不需要持续渲染，不影响性能。

---

## 使用示例

```js
const renderer = new SwimlaneRenderer(canvasEl, labelEl);
renderer.loadData(parseTraceJSON(data), null);

renderer.setAnnotations([
  // 示例 1：标注 PP 气泡时间段
  { type: 'range', startTime: 115000, endTime: 273989, label: '158ms PP气泡' },

  // 示例 2：标注问题任务（第 0 条泳道 taskId=3 的任务）
  { type: 'task', tid: 0, taskId: 3 },

  // 示例 3：标注两个阶段的串行分界点
  { type: 'point', time: 371214, label: '串行→DP等优化器结束' },

  // 示例 4：同时标注多个任务（跨泳道）
  { type: 'task', tid: 1, taskId: 6 },
  { type: 'task', tid: 2, taskId: 10 },
]);

// 清除所有标注
renderer.setAnnotations([]);
```

---

## 时间单位说明

`time` / `startTime` / `endTime` 的单位与传入 `CoreTask` 数据的 `execStart` / `execEnd` 相同，以 `timeRange.start`（所有任务的最小 `execStart`）为 0 参考点。

- `trace_view.json` 数据：μs
- `visualize_data.bin` simulator 数据：ns（存入 CoreTask 时保留原始 ns 值）

两种数据的标注写法完全一致，只需保证单位与 CoreTask 数据一致即可。`range`/`point` 的起止时间轴标签会通过 `_formatTime()` 自动格式化为 ms/μs，simulator ns 数据会被误显示为 μs 单位——如介意，可在 `label` 字段直接写明单位（如 `"20ns WAIT_FLAG气泡"`），`_formatTime` 仅用于辅助刻度值显示，不影响主标签。

---

## 与现有 API 的兼容性

| 现有方法 | 是否受影响 |
|---|---|
| `loadData()` | 不受影响，调用后标注自动清空 |
| `fitToView()` / `onResize()` | 不受影响 |
| `setFilter()` / `toggleBubbles()` | 不受影响，标注在过滤后的可见泳道上正常显示 |
| `exportPNG()` | 会把当前帧（含标注）导出，包括呼吸动画的当前帧状态 |
| `scrollToCore()` / `onCoreClick` 等 | 不受影响 |

`setAnnotations()` 是纯叠加层，不改变任何现有数据结构和事件处理。

# Swimlane 组件使用指南

> 写于 2026-05-30
> 目的：喂 JSON 给 Claude 渲染泳道图时，快速定位应该调用哪个组件、传什么格式。

---

## 一、项目里有几个 swimlane 实现？

| 路径 | 名称 | 适用场景 |
|------|------|---------|
| `pypto-swimlane-perf-tool/js/swimlane.js` | `SwimlaneRenderer` | 主力组件，完整的 canvas 渲染器，支持 zoom/drag/hover/关联连线 |
| `op-ide-assistant-v2/js/swimlane.js` | `SL` 全局对象 | 简化版，用于 IDE 助手页面内嵌小图 |
| `compute-graph-viewer-main/swimlane/` | 完整应用 | 独立页面，集成了 parser + analyzer + renderer + UI |

**一般需求用 `pypto-swimlane-perf-tool` 里的 `SwimlaneRenderer`。**

---

## 二、JSON 输入格式

### 格式 A：CoreTask 数组（主要格式，Claude 生成数据时用这个）

```json
[
  {
    "blockIdx": 0,
    "coreType": "AIC_1",
    "tasks": [
      {
        "taskId": 123,
        "subGraphId": 0,
        "execStart": 1.06,
        "execEnd": 29.60,
        "semanticLabel": "Query-Linear",
        "taskName": "[Stitch 0] 0-2-59-78-2(Query-Linear)"
      }
    ]
  }
]
```

**字段说明：**
- `coreType`：泳道名（直接显示），决定排序；命名规范 `AIC_N` / `AIV_N` / `Fake Core_0`
- `blockIdx`：硬件 block 索引（0-based，不影响显示，只做数据索引用）
- `execStart` / `execEnd`：单位 **μs**，相对时间（从 0 开始）
- `semanticLabel`：语义标签，决定颜色（见颜色映射表）
- `taskName`：显示在 tooltip 里，格式一般是 `[Stitch N] seqNo-funcId-opIdx(label)`
- `taskId`：任务 ID，用于关联查询
- `subGraphId`：同构子图 ID（等于 seqNo），Stitch 着色模式用这个分组

### 格式 B：Chrome Trace（原始 profile 格式，解析后才能用）

```json
{
  "traceEvents": [
    { "ph": "M", "name": "thread_name", "tid": 1002, "args": {"name": "AIC_1"} },
    { "ph": "X", "ts": 83549944207.98, "dur": 12.92, "tid": 1002,
      "name": "1-1-13-81-2(Query-Linear)",
      "args": { "taskId": 5, "color": "Query-Linear" } }
  ]
}
```

注意：Chrome Trace 里时间戳是绝对值（~8.35×10¹³ μs 量级），parser 会自动换算为相对时间。

---

## 三、颜色映射表（semanticLabel → 色值）

> 权威色板：`patterns/swimlane-task/pattern.js` 的 `DEFAULT_LABEL_COLORS`（muted 系，2026-07 版）。下表已对齐；旧版偏亮的 `#4d79d4/#d98f55/...` 已废弃。

| semanticLabel | 颜色 | 常见 lane |
|---------------|------|---------|
| `Query-Linear` | `#735bb4` | AIC |
| `Query-Hadamard` | `#6f63b8` | AIC |
| `Query-Dequant` | `#4d70ba` | AIV |
| `Prolog-Quant` | `#8d6bc7` | AIV |
| `Weight-Linear` | `#4a9568` | AIC |
| `Key-Linear` | `#ba8053` | AIC |
| `Key-Hadamard` | `#c48b60` | AIC |
| `Key-LayerNorm` | `#b46494` | AIV |
| `Key-Rope2D` | `#45a2ad` | AIV |
| `fake` / `unknown` | `#6f6a64` | Fake Core_0 |
| 未知 label | `hsl(hash % 360, 54%, 54%)` | 自动 |

---

## 四、SwimlaneRenderer 初始化（pypto-swimlane-perf-tool）

### 依赖文件

```html
<script src="js/parser.js"></script>
<script src="js/analyzer.js"></script>
<script src="js/swimlane.js"></script>
```

### HTML 结构（必须严格对应）

```html
<!-- 最外层：有 overflow: auto，是实际滚动容器 -->
<div id="swimlane-viewport" style="overflow: auto; position: relative; width: 100%; height: 500px;">
  <div id="swimlane-inner" style="display: flex; position: relative;">
    <!-- 标签列，固定在左侧 -->
    <div id="swimlaneLabel" style="position: sticky; left: 0; flex-shrink: 0; z-index: 10;"></div>
    <!-- 主体 canvas 区域 -->
    <div id="swimlaneCanvas" style="flex: 1; min-width: 0;"></div>
  </div>
</div>
```

**层级关系**：`SwimlaneRenderer` 内部通过 `container.parentElement?.parentElement` 获取 viewport（即 `swimlane-viewport`）。层级必须是：canvas div → inner div → viewport div。

### JS 初始化

```js
// 初始化渲染器
const renderer = new SwimlaneRenderer(
  document.getElementById('swimlaneCanvas'),
  document.getElementById('swimlaneLabel')
);

// 加载数据（CoreTask 格式）
const parsedData = parseTraceJSON(coreTaskArray);  // 自动识别数组还是 Chrome Trace 对象
const analysisResult = analyzeData(parsedData);    // 需要 analyzer.js
renderer.loadData(parsedData, analysisResult);

// 可选：注册点击回调
renderer.onEventClick = (event, relatedEvents) => {
  console.log('点击任务:', event.name, '时长:', event.dur, 'μs');
};
renderer.onCoreClick = (coreName) => {
  console.log('点击 lane:', coreName);
};
```

### 常用公共 API

```js
renderer.setFilter(showAIC, showAIV);   // 过滤 AIC/AIV lane
renderer.toggleBubbles(true);           // 显示/隐藏气泡（idle 间隙）
renderer.scrollToCore('AIC_7');         // 滚动到指定 lane
renderer.fitToView();                   // 缩放复位，显示全部数据
renderer.exportPNG();                   // 导出 PNG
renderer.onResize();                    // 容器尺寸变化后调用
```

### 父子层级泳道（2026-07 起，`loadData` 第三参 `laneTree`）

默认（不传 `laneTree`）是纯扁平 lane 列表，向后兼容旧用法。要画 Process/Ascend
Hardware/Communication 这种带父子关系的树（参考 `structure.md`），传入第三个参数：

```js
const renderer = new SwimlaneRenderer(canvasEl, labelEl, { labelWidth: 224 }); // 深树建议加宽标签列（默认 120）
renderer.loadData(parsedData, analysisResult, laneTree);
```

`laneTree` 结构：

```js
{
  children: [
    { id: 'host-A', label: 'host-A', children: [       // 分组节点：有 children，无 leafKey
      { id: 'host-A▸R0', label: 'Rank 0', children: [
        { id: 'host-A▸R0▸AHW', label: 'Ascend Hardware', children: [
          { id: '...AI_CORE', label: 'AI_CORE (4928)', leafKey: 'host-A ▸ R0 ▸ Ascend Hardware ▸ Stream 6 ▸ AI_CORE' },
        ]},
      ]},
    ], collapsed: true },   // 可选：collapsed:true 设置该分组默认折叠
  ],
}
```

- **叶子节点**（无 `children`，有 `leafKey`）：`leafKey` 必须等于扁平 CoreTask 数组里对应条目的
  `coreType` 字符串（该字符串本身可以是任意唯一路径，比如 `"host ▸ Rank ▸ 分支 ▸ 叶子"`），
  这样 `parseTraceJSON` 完全不用改，`laneTree` 只是叠加在同一份扁平数据上的一层"标签列渲染 + 折叠"元数据。
- **分组节点**（有 `children`）：点击标签列的分组行（或主画布对应行）会调用内部 `_toggleGroup`
  折叠/展开；折叠后该分组在主画布画一条"覆盖区间"汇总条（真实数据算出的 min/max 时间戳 +
  事件数提示），不是空白，也不是伪造的细节。
- 行的 Y 坐标由 `_getVisibleCores()`（分组行 + 展开的叶子行按树序展平）统一驱动，标签列和主画布
  的任务条严格对齐——这是为什么分组行必须占用真实的一整行，而不能只在标签列画父级文字。
- 不传 `laneTree` 时行为与旧版本完全一致（`sortCoreNames` 扁平 AIC/AIV 排序），已验证不影响
  `op-ide-assistant-v2/app.js` 里另一处直接喂扁平 CoreTask 数组的用法。

### 内部 parsedData 结构

```js
{
  coreEvents: Map<coreName, event[]>,  // 每条 lane 的事件列表
  timeRange: { start, end, duration }, // 时间范围（μs）
  threadMap: Map<tid, coreName>,
  relations: Map<event, Set<event>>,   // flow 关联（Chrome Trace 格式才有）
  groupBands: [...],                   // 分组带（可选）
}
```

每个 event 对象（内部规范化后）：

```js
{
  ts: 1.06,          // 相对开始时间（μs）
  dur: 28.54,        // 持续时间（μs）
  name: '[Stitch 0] ...',  // 显示名称（来自 taskName）
  tid: 0,            // lane 索引
  label: 'Query-Linear',   // 语义标签（用于着色）
  laneKind: 'aic',   // 'fake' | 'aic' | 'aiv' | 'aicpu' | 'other'
  seqNo: 0,          // stitch 序号（来自 subGraphId）
  args: { taskId: 123, subGraphId: 0, ... }
}
```

---

## 五、简化版 SL 全局对象（op-ide-assistant-v2）

### 数据格式（与主力版完全不同）

```js
{
  tasks: [
    // type 值：'dma' | 'cube' | 'vector' | 'fixpipe' | 'scalar' | 'bubble'
    { core: 0, coreType: 'AIC', type: 'dma',    start: 0,   end: 120,  label: 'COPY_IN' },
    { core: 0, coreType: 'AIC', type: 'bubble', start: 120, end: 160 },
    { core: 0, coreType: 'AIC', type: 'cube',   start: 160, end: 360,  label: 'GEMM', hotspot: true },
    { core: 24, coreType: 'AIV', type: 'vector', start: 50, end: 200,  label: 'EXP' },
  ],
  totalUs: 5000,  // 时间轴总宽度（μs）
  AIC: 24,        // AIC 核心数量（core 0 ~ AIC-1）
  AIV: 24         // AIV 核心数量（core AIC ~ AIC+AIV-1）
}
```

### 初始化

```js
// 依赖 canvas#swimlane-canvas 元素
loadProfileData(myData);
// 或
loadDemoProfile();  // 加载内置演示数据

// 缩放控制
zoomSwimlane(1.5);   // 放大 1.5 倍
resetSwimlane();     // 复位
```

---

## 六、完整 app 模式（compute-graph-viewer-main/swimlane/）

这个是独立完整应用，不作为组件嵌入，直接打开 `swimlane/index.html`。

功能：文件拖入加载、Before/After Diff 对比、Stitch 过滤、颜色模式切换、Journey 引导面板、任务弹窗、Pass IR 分屏联动。

如果只是渲染数据，不需要这套；如果要做完整 UX，参考 `swimlane/app.js`。

---

## 七、生成 CoreTask JSON 的最小模板

```python
def make_coretask_json(cores: dict[str, list[tuple]]) -> list:
    """
    cores: { 'AIC_1': [(start_us, end_us, label, task_name), ...], ... }
    返回 CoreTask 数组，可直接喂给 parseTraceJSON()
    """
    result = []
    for i, (core_type, tasks) in enumerate(cores.items()):
        result.append({
            "blockIdx": max(0, i - 1),
            "coreType": core_type,
            "tasks": [
                {
                    "taskId": j,
                    "subGraphId": 0,
                    "execStart": s,
                    "execEnd": e,
                    "semanticLabel": label,
                    "taskName": name
                }
                for j, (s, e, label, name) in enumerate(tasks)
            ]
        })
    return result
```

---

## 八、常见坑

1. **DOM 层级必须是 3 层**：canvas div → inner div → viewport div，`SwimlaneRenderer` 硬编码了 `parentElement.parentElement` 取 viewport
2. **时间单位是 μs**：`execStart`/`execEnd` 都是微秒，Chrome Trace 原始值是绝对 μs（~8.35×10¹³），parser 会自动取相对值
3. **semanticLabel 决定颜色**：不是 `color` 字段；Chrome Trace 原始里叫 `args.color`，转 CoreTask 格式要改字段名
4. **AIV 不要 re-pack**：AIV 天然稀疏，保留原始时间戳；AIC 需要压缩（re-pack）才像真实数据
5. **`sortCoreNames` 函数**：SwimlaneRenderer 内部调用，排序规则是 Fake → AIC（数字升序）→ AIV → 其他；coreType 字符串命名要符合这个规律
6. **Fake Core 会被过滤**：`loadData` 里 `.filter(n => !n.startsWith('Fake'))` 默认不显示 Fake 核心的 lane
7. **IN/compute/OUT 三段是数据驱动、可选的**（2026-06 起，源自 `patterns/swimlane-task` 的 `c0eaecd`）：只有当 task 带非空的 `inputRawMagic` / `outputRawMagic` 数组时，`drawTaskBar` 才画左右两段 IN/OUT 及侧色；两者都缺省或为空时，退化成一整条 compute 实心条（无 IN/OUT chip、无侧色）。**不要为了凑三段样式而塞空数组** —— pipeline forward/backward/通信/bubble 这类没有 in/out 语义的事件就该是单段条。
8. **父子层级（`laneTree`）的 leafKey 必须全局唯一**（2026-07 起）：多个 rank/多个分支的叶子若重名会互相覆盖 `coreEvents` 里的事件列表；统一用完整路径当 `coreType`（如 `"host ▸ R0 ▸ Ascend Hardware ▸ Stream 6 ▸ AI_CORE"`），不要只用叶子短名。
9. **深层级树要加宽标签列**：默认 `LABEL_WIDTH=120`，缩进 `depth*13+8` 加上文字很快溢出，构造 `SwimlaneRenderer` 时传 `{ labelWidth: 200~240 }`（第三参 `options`），不要改全局 `SWIMLANE_CONFIG.LABEL_WIDTH`（会影响其他不带 `options` 的旧用法）。
10. **折叠是真实数据 rollup，不是空白/伪造**：分组行折叠后主画布画的覆盖条，是遍历该分组全部叶子的真实事件算出的 min(start)~max(end) 区间 + 事件计数；如果某分组在当前时间窗口内没有事件，条会正确地不画出来，不要误读成 bug。

---

*关联文档：swimlane-data.md（数据生成脚本）/ swimlane_UX_方向研究笔记.md（产品方向）*

# MatMul Tiling 约束 & 性能 Workbench 技术规格（Spec）

状态：草稿 v2.2（对齐 PRD：场景驱动单点 + 约束容器 + 半定量 cost model）
关联 PRD：[matmul-tiling-3d-prd.zh-CN.md](matmul-tiling-3d-prd.zh-CN.md)
心智模型：[ascend-tiling-visualization-knowledge.md](ascend-tiling-visualization-knowledge.md)
设计系统治理：`/Users/yin/pto-design-system/SKILL.md`（沿用上层 spec 的 Workflow C）
公式/常量来源：`asc-devkit-master/impl/adv_api/tiling/matmul/matmul_tiling_algorithm.cpp`、`matmul_tiling_base.cpp`

---

## 1. 概述与与现有页面的关系

新增**独立姊妹页** `matmul-tiling.html`，与 `index.html` 平级，共享 vendored PTO design system 与同类 WebGL/高亮能力。

- 现有 `index.html`：trace replayer，data-driven 自 `data/fixtures/*.trace.json`，三栏。
- 新页 `matmul-tiling.html`：tiling 参数 → **约束校验 + 性能评分 + 几何推导**，两栏（右栏内部上下分），**不消费 trace `steps`**，自带参数模型 + 页内复刻的约束/cost 公式。

**硬约束：不修改 `index.html`、`src/app.js`、`src/styles.css` 的任何现有行为。** 复用逻辑一律"复制 helper 到新文件"，不改原文件（见 §10）。

## 2. 文件结构与运行

### 2.1 新增文件

```text
/Users/yin/pto/tiling
├── matmul-tiling.html             # 新页面外壳
└── src/
    ├── matmul-tiling.js           # 新页面驱动（单 IIFE，仿 app.js 结构）
    ├── matmul-tiling.css          # 新页面局部样式（仅补 app 级布局，视觉走 token）
    └── matmul-tiling-model.js     # 纯函数：硬件常量 + 约束校验 + cost model（无 DOM，可独立测）
```

把约束/性能公式单独成 `matmul-tiling-model.js`，因为它是页面的"真值核心"、需对齐源码、且应独立于 DOM 验证。不新增构建系统，保持纯 vanilla。

### 2.2 运行方式

与现有页面相同，HTTP 从**父目录** serve：

```sh
cd /Users/yin/pto && python3 -m http.server 8000
# 打开 http://localhost:8000/tiling/matmul-tiling.html
```

### 2.3 Cache busting

`matmul-tiling.html` 引用三个本页资源都带 `?v=YYYYMMDD-x`，改动时同步 bump。

## 3. 页面布局（HTML 骨架）

复用 `ide-frame` + `workbench-shell` 外壳；外层两栏横向，右栏内部上下分（逻辑切分在上、物理约束在下）。

```text
section.pto-ide-frame[data-ide-frame][data-host="standalone"]
├── header.pto-ide-frame__topbar
│   ├── 左：标题 "MatMul Tiling · 约束 & 性能"
│   └── 右：全局控件（场景 preset / 芯片 / dtype / double buffer 三开关 / iterateOrder）
└── .pto-ide-frame__body > .pto-ide-frame__workarea
    └── .pto-ide-frame__split[horizontal][data-sizes="40,60"]
        ├── pane[data-ide-pane="code"]                 # 左：源码 + 参数 + 性能分
        │   ├── header（Tiling Source）
        │   ├── #codeLines（高亮源码 + 字段锚点）
        │   ├── .tiling-scenario（batch/seq/K/N 场景输入，派生 M=batch×seq）
        │   ├── .tiling-params（base*/singleCore*/core 控件，Advanced 可覆盖 M/N/K）
        │   └── .tiling-score（性能分读数，M2 起）
        └── pane[data-ide-pane="viewport"]             # 右
            └── 内层 split[vertical][data-sizes="45,55"]
                ├── pane[data-ide-pane="logical"]      # 右上：逻辑切分
                │   ├── header（Logical M×N×K + viewport 控件）
                │   ├── canvas#tilingCanvas（WebGL）
                │   ├── .tiling-fallback（no-WebGL 提示）
                │   └── .tiling-readout（mIter/nIter/kLoop/当前核）
                └── pane[data-ide-pane="constraint"]   # 右下：物理约束（★ 分析核心）
                    ├── header（On-chip Buffer 约束）
                    └── #bufferStage  ← aic-core-object pattern 挂载点
                                        （L1 / L0A / L0B / Cube / L0C 卡，
                                         占用用 setBufferBlocks 的 cellRange 表达 + 爆红）
```

CSS link 与 `index.html` 一致（foundation/semantic/components/style + ide-frame/workbench-shell/floating-playback-control 的 pattern.css），**加 `aic-core-object` 的 pattern.css**（约束视图基底），末尾加本页 `src/matmul-tiling.css`。对应 JS 末尾引 `aic-core-object/pattern.js`（提供 `window.PtoAicCorePattern`）。

> 内层 vertical split 同样由 `workbench-shell` 驱动（它支持嵌套 split，见 reference_pto_workbench：frame/split 分两层）。

## 4. 数据模型

### 4.1 场景对象 + 派生参数（单一可变源）

本期输入采用**场景驱动的单点模型**：用户先选当前请求形态（batch/seq）与模型维度（K/N），页面派生 `M = batch × seq`，再把派生出的 `M/N/K` 与 safe default seed 的 tiling 参数合成 `tiling`。裸 `M/N/K` 不作为主入口，只放 Advanced 覆盖。

```js
const scenario = {
  presetId: 'decode-m1',      // decode-m1 | decode-small | prefill
  chip: 'ascend910b',
  dtype: 'fp16',
  batch: 1,
  seq: 1,
  K: 4096,                    // hidden，来自 weight / 模型结构
  N: 4096,                    // output dim，来自 weight / 模型结构
  advancedMnk: false,
  overrideM: null,
  overrideN: null,
  overrideK: null,
};

const tiling = {
  // 全局逻辑空间：主路径由 scenario 派生，Advanced 可覆盖
  M: scenario.advancedMnk ? scenario.overrideM : scenario.batch * scenario.seq,
  N: scenario.advancedMnk ? scenario.overrideN : scenario.N,
  K: scenario.advancedMnk ? scenario.overrideK : scenario.K,
  // 并行切分
  usedCoreNum: 8,
  singleCoreM: 256, singleCoreN: 256, singleCoreK: 512,
  // 硬件基本块（约束与几何共享的联动锚点）
  baseM: 128, baseN: 128, baseK: 64,
  // dtype 与 double buffer（dtype 影响容量；DB 影响第二份余量）
  dtype: scenario.dtype,      // fp16 | bf16 | fp32  → A/B 元素字节数
  dbL0A: 1, dbL0B: 1, dbL0C: 1,   // 0/1，开则该 buffer 需要第二份余量
  // 遍历 / 性能
  iterateOrder: 0,           // 0: M-first, 1: N-first
  chip: scenario.chip,       // 选用哪套硬件常量
  defaultSource: 'safe-seed', // safe-seed，非真实 CANN 自动 tiling 输出
};
```

> 初值来自 safe default seed：教学友好、16 对齐、保证能合法装下，但**不承诺等于真实 `MatmulTilingAlgorithm` 输出**。topbar 提供 2–3 个真实场景 preset（decode M=1 / small decode / prefill）一键载入；preset 会同时更新 `scenario` 与对应的 tiling seed。任意控件写回后触发 `render()`。

### 4.2 硬件常量（`matmul-tiling-model.js`，来自 `matmul_tiling_base.cpp:33-59`）

> ⚠️ 区分 **display（标称刻度）** 与 **compute（进约束的真实容量）**：910B fallback 里 `L1 = 512*1024-256`、`UB = 192*1024-256`（`matmul_tiling_base.cpp:52-58`），`-256` 必须算进约束；3113 fallback `L1 = 512*1024`（无 -256）。**约束校验一律用 `compute`，刻度标签可用 `display`。** btSize 按平台 API 路径（`:186-189`）：仅 910B/310B=1024，其余（含 950、3113）=0；950 的 buffer 尺寸来自运行时平台 API、非 fallback 常量，页内用标称近似并须标注。

```js
const CHIPS = {
  // 每项 { display, compute }；compute 用于约束校验，display 仅用于刻度标签
  ascend950:  { // 平台 API 运行时值（非源码 fallback 常量，标称近似）
    L0A: 64*1024, L0B: 64*1024, L0C: 128*1024,
    L1: { display: 512*1024, compute: 512*1024 },
    UB: { display: 118*1024, compute: 118*1024 },
    btSize: 0,
  },
  ascend910b: { // matmul_tiling_base.cpp #else fallback
    L0A: 64*1024, L0B: 64*1024, L0C: 128*1024,
    L1: { display: 512*1024, compute: 512*1024 - 256 },
    UB: { display: 192*1024, compute: 192*1024 - 256 },
    btSize: 1024,
  },
  ascend3113: { // matmul_tiling_base.cpp #if 3113 fallback
    L0A: 32*1024, L0B: 32*1024, L0C: 64*1024,
    L1: { display: 512*1024, compute: 512*1024 },
    UB: { display: 118*1024, compute: 118*1024 },
    btSize: 0,            // 平台 API 路径（非 910B/310B）→ 0
  },
};
const capL1 = (cap) => cap.L1.compute - cap.btSize;   // L1 真实可用 = compute − btSize
const DTYPE_BYTES = { fp16: 2, bf16: 2, fp32: 4 };
const C0_SIZE = 16;            // baseM/baseN 须为其倍数（:3852/:3927）
```

> 纯 matmul 下 950 与 910B buffer 容量基本一致，差异在 btSize（影响 L1 可用空间）。芯片版本对融合 tiling 的结构性差异（AIC→AIV / L0C→UB 通路）**本期不实现**，调研结论见 PRD §13。`estimateL1` 计算可用容量时用 `capL1(cap)`（已扣 compute 余量与 btSize）。

### 4.3 约束校验（核心真值，对齐 §源码公式）

> ⚠️ **两层模型（对齐源码，codex review 纠正）**：源码 `CheckL0ASize/B/C` 判"装得下"用 **`/ DB_OFF`（=1，满容量）**，**不**把 DB 砍半算进合法性（`matmul_tiling_algorithm.h:30` `DB_ON=2/DB_OFF=1`；`:3845/:3884/:3921`）。double buffer 是否能开是**第二层**，由 `GetL0cDB` 等在合法 base 上再判（`:564-612`）。所以：**合法性比满容量；DB 余量另算 `2×used ≤ 满容量`**。不要把"开 DB 才超"画成非法。

```js
function checkConstraints(t) {
  const cap = CHIPS[t.chip];
  const eb = DTYPE_BYTES[t.dtype];          // A/B 元素字节
  // 第一层·合法装下：占用 vs 满容量（不砍半）
  const l0a = { used: t.baseM * t.baseK * eb, full: cap.L0A };
  const l0b = { used: t.baseK * t.baseN * eb, full: cap.L0B };
  const l0c = { used: t.baseM * t.baseN * 4,  full: cap.L0C }; // 恒 FP32
  const l1  = estimateL1(t, cap);            // { used, full=capL1(cap) }，见 §6.4
  const pack = (x, label, note, dbOn) => ({
    label, note,
    used: x.used, full: x.full,
    ratio: x.used / x.full,                 // 第一层刻度（合法占用比）
    over: x.used > x.full,                   // 第一层：超 = tiling 非法（爆红）
    dbEligible: 2 * x.used <= x.full,        // 第二层：还有空间开 DB
    dbWouldOver: dbOn && 2 * x.used > x.full, // 第二层：已点 DB 但 2× 放不下（warning，非非法）
  });
  return {
    L0A: pack(l0a, 'L0A', 'baseM×baseK',        t.dbL0A),
    L0B: pack(l0b, 'L0B', 'baseK×baseN',        t.dbL0B),
    L0C: pack(l0c, 'L0C', 'baseM×baseN ×4B(恒FP32)', t.dbL0C),
    L1:  pack(l1,  'L1',  'A/B 暂存',            false),
    align: {
      baseM: t.baseM % C0_SIZE === 0,
      baseN: t.baseN % C0_SIZE === 0,
    },
  };
}
```

> 显式标注：这是页内复刻的简化校验，对齐 `CheckL0ASize/CheckL0BSize/CheckL0CSize`（合法层）+ `GetL0cDB`（DB 层），**不调用真实编译器**。L1 用简化暂存估算。UI：`over` → error 态；`dbWouldOver` → warning 态（提示"此 base 下开不了 DB"），二者视觉区分。

### 4.4 性能 cost model（半定量，对齐 `ComputeIntensity`）

```js
function scorePerf(t) {
  const eb = DTYPE_BYTES[t.dtype];
  // 访存量（对齐 CalculateMemoryTraffic :2333-2339：只算 A、B 两项，源码无 C 项；aRatio/bRatio 简化为 1）
  const memTraffic = t.baseM*t.baseK*eb + t.baseK*t.baseN*eb;
  // 计算量（MAC 数，作为 cycle 的代理；对齐 CalculateBlockCycles 的趋势）
  const computeWork = t.baseM * t.baseN * t.baseK;
  const intensity = computeWork / memTraffic;          // 算力强度，越高越好（主指标）
  // double buffer 流水权衡（对齐 GetL0cDB 的对比思路，简化）
  const dbGain = (t.dbL0A && t.dbL0B) ? estimatePipelineOverlap(t) : 0;
  return { intensity, dbGain, ...iterateOrderCost(t) };
}
```

> `intensity` 是主分；UI 呈现按 PRD §14 已决：颜色档（红/黄/绿）+ 原始算力强度值。所有读数标注"半定量趋势估算，非实测耗时"。

### 4.5 派生几何（逻辑视图用，纯整除近似）

```js
function deriveTiling(t) {
  const ceil = (a, b) => Math.max(1, Math.ceil(a / b));
  return {
    mIter: ceil(t.M, t.singleCoreM),
    nIter: ceil(t.N, t.singleCoreN),
    coreTiles: ceil(t.M, t.singleCoreM) * ceil(t.N, t.singleCoreN),
    baseMLoop: ceil(t.singleCoreM, t.baseM),
    baseNLoop: ceil(t.singleCoreN, t.baseN),
    kLoop: ceil(t.K, t.baseK),
  };
}
```

### 4.6 边界钳制

- `base* > singleCore*`、`singleCore* > 全局`、`baseK > K` → 钳制并提示。
- `baseM/baseN` 非 16 对齐 → align 标记置 false，左侧字段标黄提示。
- `coreTiles ≠ usedCoreNum` → 读数区提示（教学点：核数不一定整除）。

## 5. 左侧 · 源码 + 参数 + 性能分

- 源码内联：`matmul_tilingdata.h` 的 `TCubeTiling` 字段定义 + `matmul_tiling.cpp` 的 `GetTiling/Compute` 入口；高亮复用 `highlightAscendC`（§10）。
- 字段锚点：`baseM/N/K`、`singleCore*`、`M/N/Ka/Kb`、`dbL0A/B/C` 等行包 `data-field`；hover/click ↔ 右侧对应容器/几何层双向高亮。约束违例时其字段标红。
- 参数控件：PTO base class（`.segmented-control` 选 dtype/iterateOrder、`.toolbar-control` 数字步进、`.btn` toggle 三个 DB）。源码只读（MVP）。
- 性能分区块（M2 起）：算力强度 + DB 对比 + iterateOrder 评估，`.panel-shell-quiet`。

## 6. 右下 · 物理约束视图（★ 分析核心，aic-core-object）

> 位置在右栏下半（与逻辑切分上下对调后）。它仍是工具的分析核心——回答"能切多大"。

### 6.1 视觉基底：复用 `aic-core-object` pattern

直接复用 `pto-design-system/patterns/aic-core-object`。该 pattern 本就是 AIC 内部对象：**L1 大卡 + L0A/L0B 中部微 buffer + 中央 Cube 块 + L0C 卡**，正好是 matmul tiling 要展示的片上 buffer 集群，且 config-driven、自带 grid 生成器。

> ⚠️ **硬性要求（codex review）：不能直接用默认 preset 的容量。** `aicDraftV1` 默认 L0C 标 `512kb`（`pattern.js:111`）、L0A/FP 标 `64kb`，与 matmul 实际容量（L0C 128KB/64KB、L0A/L0B 64KB/32KB、L1 512KB）**不符**。本页**必须创建一份 matmul preset**，按 pattern.json 的 `allowedOverrides` 覆盖每个 buffer 的 `capacity` 与 `grid`（行列/cellSize）使其与 `CHIPS[t.chip]` 一致；切芯片时同步更新 capacity。不得沿用默认数值，否则占用百分比全错。

- 挂载：`window.PtoAicCorePattern.render(bufferStageEl, matmulPreset)`（`matmulPreset` = 在 `aicDraftV1` 基础上 override 容量/grid 的本页 config）。
- 占用：`window.PtoAicCorePattern.setBufferBlocks(bufferStageEl, blocks)`，用每个 buffer 的 `cellRange` 填充比例表达占用 `ratio`；`clearBufferBlocks` 清空。
- **遵守 pattern 契约**（pattern.json）：只通过 preset/config 与 `setBufferBlocks` 驱动，**不在产品页改写其 shell 布局 / 卡片 chrome / grid 处理**；950B 等变体靠扩展 preset 数据，不克隆生成的 DOM。

### 6.2 占用映射（约束 → setBufferBlocks）

对每个 buffer（L0A/L0B/L0C/L1），由 §4.3 `checkConstraints` 得到 `ratio = used/full`（满容量），映射成一个 block。**满格刻度 = compute 容量（L1 再扣 btSize）**，不是把容量砍半：

- `cellRange`：按 `ratio` 占该 buffer 网格的对应格数（如 ratio=0.62 → 填 62% 的 cell）。
- `state` / `tone`（两层）：
  - 第一层·合法：`over=false`（`ratio ≤ 1`）→ `tone:'input'/'accumulator'` 等正常色，label = `用量KB / 容量KB（NN%）`。
  - 第一层·非法：`over=true`（`ratio > 1`）→ `state:'over'`（error 语义色）+ ⚠ + "超 N%"，触发左侧对应字段标红 = **tiling 非法**。
  - 第二层·DB 余量：`dbWouldOver=true`（已点该 buffer DB 但 `2×used > full`）→ **warning 态**（非 error）+ "此 base 开不了 DB"；`dbEligible` 时可在 block 上以浅色虚线标出"DB 需占两份"的预留区。两层视觉必须区分。
- L0C 的 block 常驻标注 "恒按 FP32(4B) 计"——关键教学点（L0C 用 `baseM*baseN*4`）。
- 容器满格刻度随 `CHIPS[t.chip]` 变化：切芯片 → 重新 `render` 或更新 matmul preset 的 capacity（用 compute 容量）。

> 若 `aicDraftV1` 的默认 buffer 成员/标签与 L0A/L0B/L0C/L1 不完全一致，按 pattern.json 的 `allowedOverrides`（buffer labels / capacities / stack membership）扩一个本页 preset，而非改 pattern 源码。

### 6.3 double buffer 余量动效

- 切 `dbL0A/B/C` 任一开关 → 对应容器上"DB 预留区（第二份）"以过渡动画亮起/收起 → 重算 `dbEligible/dbWouldOver`。**注意：合法满格刻度不变**（DB 不改变合法容量），变的是"还放不放得下第二份"。当 `2×used > full` 时该 buffer 转 warning（开不了 DB），让"提速代价=要留出两份、所以得切更小"肉眼可见。

### 6.4 L1 暂存估算（`estimateL1`）

简化对齐 `CalcL1Tiling`：`depthA1Size*baseAByte + depthB1Size*baseBByte ≤ capL1(cap)`（= L1.compute − btSize）。返回 `{ used, full: capL1(cap) }`。MVP 用保守近似（如固定 `stepKa/stepKb` 推 depth），标注"近似"。L1 容器同样给占用条。

## 7. 右上 · 逻辑切分视图（辅）

### 7.1 轴语义

```text
X: N（输出列）  Y: M（输出行）  Z: K（reduction 累加进度，非物理 depth）
```

viewport 固定标注三轴 + "逻辑/执行空间，非物理 GM"一行。

### 7.2 三层嵌套盒子

| 层级 | 尺寸 | 渲染 |
|---|---|---|
| 全局 | `M×N×K` | 灰线框，半透明 |
| 单核 slab | `singleCore*`，按 `mIter×nIter` 平铺 | 着色，当前核高亮 |
| base tile | `base*` | 选中 slab 内实心小盒（**与右下物理约束视图共享同一组 `base*`，是联动锚点**） |

- WebGL 走从 `app.js` 抽出的 viewport 封装（§10），不引 three.js。
- 复用现有 orbit/pan/zoom + zoom in/out/fit 控件。
- base tile 过多时只实心渲染当前 slab，其余 slab 只画外框（保帧率）。
- 配色用现有语义色 token，中性灰底，禁蓝调。

### 7.3 no-WebGL fallback

无 context 时隐藏 canvas，显示 `.tiling-fallback`：2D `M×N` 切块网格 + 文字提示（沿用 `tensorFallback` 思路）。

## 8. 交互与联动

| 交互 | 行为 |
|---|---|
| 改场景/参数/开关/dtype/芯片 | 写回 `scenario` / `tiling` → `checkConstraints`+`scorePerf`+`deriveTiling` → `render()` 同步刷新三处 |
| hover 代码字段 | 高亮其影响的容器 + 几何层 |
| hover 容器/几何块 | 高亮左侧对应代码行 + 读数 |
| 约束违例 | 容器爆红 + 左侧字段标红 + 给出"哪个约束被突破" |
| 扫核动画（M3） | `currentCore = 0..coreTiles-1`，高亮对应 slab |
| K 累加动画（M3） | 选中 slab 内沿 Z 逐 `kIndex`，首片 init、其后 accumulate |
| viewport zoom/fit | 复用现有控件 |

- `state` 单一可变：`{ scenario, tiling, constraints, perf, derived, currentCore, kIndex, viewport:{pan,zoom}, hover }`，`render()` 由 `state` 重派生（仿 `app.js`）。
- 播放控件（M3）复用 `floating-playback-control`，挂 `.tiling-playback-mount`，不本地重建。

## 9. 联动的"单一真值流"

```text
场景/控件改动 → 写 scenario / tiling
   → matmul-tiling-model.js: checkConstraints / scorePerf / deriveTiling（纯函数）
   → 写 state.constraints / state.perf / state.derived
   → render(): 右下约束对象（aic-core-object）/ 左下性能分 / 右上几何 三处同时重画
```

约束与性能都来自 `matmul-tiling-model.js` 的纯函数，DOM 只读它的结果——保证三视图永远一致。

## 10. 从现有 `app.js` 复用（复制，不改原文件）

抽到新文件，原文件不动：

- `highlightAscendC` 语法高亮 tokenizer。
- WebGL viewport 基础设施：context 初始化、相机/投影、pan/orbit/zoom、盒子/网格绘制、no-WebGL fallback。
- viewport 控件接线（zoomIn/zoomOut/fitView）。
- `floating-playback-control` 挂载与回调接线（M3）。
- 中文文案处理（可简化为直接中文，不必照搬 `TEXT_ZH`）。

> 复制必要部分后按本页数据模型改写。**不在 `app.js` 新增本页分支**，避免污染 trace replayer。

## 11. 设计系统约束

- 复用 `../vendor/pto-design-system/` tokens（foundation/semantic/components）、`css/style.css`、以及 `ide-frame`/`workbench-shell`/`aic-core-object`/`floating-playback-control` pattern。
- 控件用现有 base class：`.btn` 系列、`.segmented-control`、`.toolbar-control`、`.toolbar-readout`、`.panel-shell(-quiet)`。
- 约束爆红/正常用 error/success 语义色 token，不自造。
- 暗色中性灰（`#292929`），禁蓝调。卡片不套卡片（L1/L2/L3 三级），callout 用完整 1px border + 背景、不用左侧高亮条。
- 不新增 button/toggle/badge/card/pane/spacing/color 体系；约束视图通过 `aic-core-object` 的 preset/config 与 `setBufferBlocks` 驱动，**遵守其 pattern.json 契约**（禁止在产品页改写 shell 布局/卡片 chrome/grid，禁止克隆其 DOM）。占用比例若需新视觉表达，先走 `component-preview.html` + approval gate。

## 12. 实现阶段（对齐 PRD 里程碑）

| 阶段 | 交付 | 对应 PRD |
|---|---|---|
| S0 | 本 spec + PRD 定稿确认（当前） | M0 |
| S1 | 外壳 + 两栏/嵌套 split + 左侧源码高亮 + 场景/参数控件 + `matmul-tiling-model.js` 约束校验 | M1 |
| S2 | 右下约束对象（建 **matmul preset** override 容量 → 挂载 `aic-core-object` + `setBufferBlocks` 占用 + 合法爆红 + DB 余量两层）+ 芯片/dtype 切换实时刷新 | M1 |
| S3 | 接入 `scorePerf` 半定量分 + 左下性能分读数 + 约束↔字段联动 | M2 |
| S4 | 右上 WebGL 逻辑嵌套盒子 + `deriveTiling` 实时重切 + 与约束视图 base 联动 + fallback | M3 |
| S5 | 扫核 / K 累加动画 + playback 接线 + 代码↔视图双向高亮 | M3 |
| S6 | 浏览器验证 + cache busting + 文案收尾 | 通用 |

每阶段在浏览器内验证视觉（CLAUDE.md 要求）。

> **数据模型范围**：S1–S5 的数据模型是 §4.1 的**场景驱动单点对象**（`scenario` 派生 `M/N/K`，再合成一组 `base*` + 芯片/dtype）。动态 shape 的「沿 M 轴扫描断点地图」（PRD 缺口 ③ / 场景 C）属 **Future（后续阶段，本期不做）**——需另引入 `shapeRange + keySegments + scanResult`，本 spec 暂不落地。本期对多 tiling key 只做**静态策略分段条**。此范围与 PRD §2 小结、§9 Future 一致。

## 13. 验收标准

### 约束（S1–S2 / M1）
- [ ] 新页独立运行，未改动 `index.html`/`app.js`/`styles.css` 任何现有行为。
- [ ] 左侧展示选定源码，`TCubeTiling` 关键字段为可交互锚点；场景控件与参数控件齐全。
- [ ] 右下用 `aic-core-object` + **本页 matmul preset（容量已 override，非默认 512KB）** 渲染 L1/L0A/L0B/Cube/L0C，占用经 `setBufferBlocks` 表达、百分比对齐 §4.3（满容量比，非砍半）。
- [ ] 约束分两层：`over`（超满容量=非法，error 态）与 `dbWouldOver`（开 DB 才超=warning 态）视觉区分。
- [ ] 容量用 `compute` 值（910B L1/UB 含 −256；L1 再扣 btSize），刻度标签可用 display。
- [ ] 改 base/dtype/DB/芯片 → 占用与状态实时更新；DB 余量有动效；未改写 pattern shell。
- [ ] L0C 恒 FP32、DB 两层两个关键点有 UI 标注。

### 性能（S3 / M2）
- [ ] 性能分（算力强度为主）随参数实时重算，对齐 §4.4。
- [ ] DB on/off、iterateOrder 切换有可解释的分值变化。
- [ ] 标注"半定量趋势估算，非实测耗时"。

### 逻辑 + 联动（S4–S5 / M3）
- [ ] 右上 WebGL 三层嵌套盒子可 orbit/zoom/fit。
- [ ] base tile 在约束视图与逻辑视图联动一致。
- [ ] 代码字段 ↔ 容器/几何双向高亮；违例时字段同步标红。
- [ ] UI 标注"逻辑/执行空间、K 为 reduction、近似推导非真实算法"。

### 通用
- [ ] 全程复用 PTO design system，无外部库，无私有视觉样式。
- [ ] 边界值（base > singleCore、非 16 对齐等）有钳制与提示，不崩溃。
- [ ] 浏览器内验证通过（HTTP 从父目录起服务）。

## 14. 已决项

### 14.1 产品方向

1. **核心交互模型** → **场景驱动的单点 workbench + safe default seed + 手动 what-if 覆盖**。
   主路径是选场景/预设后载入一组安全默认 seed；用户再手动改 `base*`、DB、dtype、`iterateOrder` 看解释与趋势。

2. **输入模型** → **场景驱动单点**。
   主入口是 `chip + dtype + batch + seq + K + N`，页面派生 `M=batch×seq`；裸 `M/N/K` 只放 Advanced 覆盖。

3. **默认起点** → **safe default seed，不承诺真实 CANN 自动 tiling 输出**。
   MVP 不调用 CANN，也不完整复刻 `MatmulTilingAlgorithm`。UI 必须标注"近似安全默认，非真实编译器输出"。

4. **动态 shape 决策曲线** → **Future（后续阶段），本期不做**。
   S1–S5 保持单点数据模型；Future 前再引入 `shapeRange + keySegments + scanResult`。

5. **多 tiling key 的 v1 表达** → **静态策略分段条**。
   展示类似 `M=1 Decode` / `2-128 Small` / `129+ Prefill` 的 range/key/why；点击只载入代表 shape/preset，不做交互式扫描。它是外层 tiling key strategy / branch annotation，不是 `TCubeTiling` 字段。

6. **是否翻 `cann-recipes-infer` 测试矩阵** → **MVP 非阻塞**。
   本期最多轻量核对 preset 名称和说明；系统性测试矩阵调研留到 Future 断点地图之前做。

### 14.2 实现细节

1. **性能分尺度** → **颜色档（红/黄/绿）+ 旁边小字给原始算力强度值**。
   理由：一眼看颜色判断好坏，需要精确时看数值。归一 0–100 "分" 会让人误以为是绝对真值，与"半定量趋势"的定位矛盾。

2. **`estimateL1` 简化程度** → **MVP 固定 `stepKa/stepKb` 推 depth、只读，不开控件**；这两个控件留到后续里程碑。
   理由：对主用户之外的人太细，先开会让界面变复杂；且我们对 L1 本就是近似估算，过度精细没意义。

3. **约束容器用哪个 pattern** → **已定：用 `aic-core-object`**（本轮决定，替换原 memory-architecture 方案）。
   理由：它本就是 AIC 内部 L1/L0A/L0B/Cube/L0C 集群，比 memory-architecture 更贴 matmul tiling，且 config-driven、有 `setBufferBlocks` API。

4. **参数初值** → **safe default seed + 2–3 个真实场景 preset**。
   seed 使用教学友好的 16 对齐整数并保证合法；preset 覆盖 decode M=1 / small decode / prefill 等场景，一键载入 `scenario` 与对应 tiling seed。

5. **源码只读 vs 可编辑** → **只读 + 独立参数控件**。
   理由：可编辑代码触发重切要解析 C++，工程量大且易错；本工具价值在"调参看约束/性能"，不在"写代码"，只读够用。

6. **与 `index.html` 互跳入口** → **两页 topbar 各放一个小入口互跳**。
   理由：姊妹页（一个回放执行、一个看 tiling 约束），互跳成本极低、对用户有用。

### 14.3 源码一致性修正（codex review 已落实）

经核对 gitcode 源码，以下四处已直接改进 §4/§6，并记此存档：

- **访存量只算 A、B 两项**：`CalculateMemoryTraffic`（`matmul_tiling_algorithm.cpp:2333-2339`）只返回 `aMatrixSize + bMatrixSize`，**无 C 项**。原文档误加 `baseM*baseN*4`，已删（§4.4）。
- **约束合法性用满容量、DB 是第二层**：`CheckL0ASize/B/C` 用 `/ DB_OFF(=1)` 判合法（`:3845/:3884/:3921`），DB 由 `GetL0cDB` 另判（`:564-612`）。已拆成 `over`（非法）/`dbEligible`/`dbWouldOver`（§4.3、§6.2-6.3）。
- **常量分 display/compute**：910B fallback `L1=512*1024-256`、`UB=192*1024-256`（`matmul_tiling_base.cpp:52-58`）；btSize 平台 API 路径仅 910B/310B=1024。已建 `{display, compute}` 结构 + `capL1()`（§4.2）。
- **aic-core-object 必须建 matmul preset**：默认 L0C=512KB（`pattern.js:111`）≠ matmul 128/64KB，必须 override 容量+grid（§6.1）。

> 注：产品方向、实现细节与源码一致性修正均已收敛。动态 shape 决策曲线保留为 Future（后续阶段），PRD↔spec 据此对齐。

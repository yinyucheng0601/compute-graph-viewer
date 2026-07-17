# Training Run Twin — 整网图层级 L1~L5 映射规则

## 适用范围

`training-monitoring.html` 整网图右上角「层级」下拉（L1~L5），以及 `js/opv-modelviz.js` 中的 `opv-set-level` 事件处理。

## 核心原理

`opv-modelviz.js` 的 `buildOpenPanguGraph()` 通过 `state.collapsedModules`（Set of **module ID**）控制子结构折叠。层级切换触发 `opv-set-level` 自定义事件：

```js
document.dispatchEvent(new CustomEvent('opv-set-level', { detail: { level: 1~5 } }));
```

### ⚠️ Module ID ≠ Cluster ID

```js
// opv-modelviz.js 中 MODULE_BY_CLUSTER 的映射
const MODULE_BY_CLUSTER = {
  "decoder-stack":    "decoder_layer",         // cluster ID → module ID
  "attention-block":  "sparse_mla_attention",
  "ffn-block":        "ffn_choice",
  "moe-block":        "moe_ffn",
  "mtp-stack":        "mtp_module"
};
```

`buildOpenPanguGraph` 用 **module ID** 做 `collapsedModules.has()` 检查，层级逻辑必须用 module ID。

## L1~L5 层级定义

| 层级 | 折叠的 module ID | 可见效果 |
|---|---|---|
| **L5** Operator | 仅 `mtp_module`（= DEFAULT_COLLAPSED） | 所有算子全展开 |
| **L4** Q·K·V / Expert | + `moe_ffn` | 折叠 router、shared/routed experts、all-to-all |
| **L3** Attention / MoE | + `sparse_mla_attention`, `ffn_choice` | attention 和 FFN 各收为折叠块 |
| **L2** DecoderLayer | + `decoder_layer` | 46 层 decoder 收为一个大块 |
| **L1** Model | + `mtp_module` | 全部折叠，仅剩顶层轮廓 |

层级是**累进**的：L4 = L5 的折叠 + moe_ffn；L3 = L4 的折叠 + sparse_mla_attention + ffn_choice；以此类推。

## 实现位置

| 文件 | 作用 |
|---|---|
| `training-monitoring.html` 内联 `<script>` | `pickFlatLevel(level)` → `dispatchEvent('opv-set-level')` |
| `js/opv-modelviz.js` 末尾 | `document.addEventListener('opv-set-level', ...)` 设置 `state.collapsedModules` 并 `renderAll` |
| `js/opv-modelviz.js` `DEFAULT_COLLAPSED` | `new Set(["mtp_module"])` → 默认 L5 全展开 |
| `training-monitoring.html` CSS `.seg`/`.segbtn`/`.hsel-*` | 工具栏样式 |

## 更新 schema 时检查清单

改 `opv-modelviz-schema.js` 或整网图结构时：

1. `MODULE_BY_CLUSTER` 映射是否新增/改名
2. `COLLAPSIBLE` 对象是否包含新 module
3. `buildOpenPanguGraph()` 里 `state.collapsedModules.has(...)` 的参数是否匹配
4. 本文 L1~L5 映射是否需要调整

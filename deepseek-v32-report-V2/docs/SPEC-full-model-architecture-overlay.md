# SPEC：完整模型架构与后端性能覆盖层

> 状态：Implemented（runtime source `f6262f5`）  
> 适用工程：`deepseek-v32-report-overlay`  
> 架构提取规范：`model-architecture-extractor`  
> 当前后端数据：`/Users/yin/pto/ui-json-main`

## 1. 目标

报告中的模型图必须首先是一张来源可验证的完整模型架构图，再叠加后端提供的性能数据。

完整架构不再从 `analysis_config.children` 反推。它由模型官方源码和运行配置生成；`ui-json-main` 只负责描述当前代表 step 的性能覆盖、Timeline owner 和 runtime auxiliary。

最终页面需要同时满足：

- 模型主干、重复层、分支、参数和状态结构完整；
- 后端提供的所有 `node_id`、指标和 Timeline 关系零丢失；
- 只有后端提供且成功映射的架构节点可选择、着色和联动 Inspector；
- 源码存在但后端无数据的节点仍可见，但透明 dim，不能伪装成有性能数据；
- 后端没有提供的诊断、优先级、指标、执行状态和覆盖关系不得由前端推断。

## 2. 非目标

- 不下载或加载模型权重。
- 不把 profiler 执行顺序当作 tensor/dataflow edge。
- 不把父节点指标自动复制到源码中的所有后代节点。
- 不根据节点名称相似度静默合并来源不同的节点。
- 不把当前 rank/step 的 trace slice 解释为完整 61 层模型实测结果。
- 不在本阶段生成 P0/P1/P2、热点等级或优化建议。

## 3. 双事实层

```text
ui-json runtime source + config ──┐
                                 ├─ Canonical full-source architecture
official source cross-check ─────┘                 │
                                                   ▼
                                         Complete graph base
                                                   ▲
                                                   │
ui-json analysis/perf/timeline ─── explicit overlay mapping
```

### 3.1 完整架构事实层

首要来源：后端仓库提供并锁定 revision 的实际 `modeling_deepseek.py`、`configuration_deepseek.py`、`model_infer.py`、inference wrapper 和 MTP3 runner config。官方 Hugging Face/DeepSeek 源码作为独立交叉校验来源。

该层负责：

- 模型、Decoder、Attention、MLP/MoE、MTP 的真实组合关系；
- Module、Op、State/Buffer、Parameter 的语义类型；
- Dense/MoE 层范围、重复次数和条件分支；
- 经过源码或配置验证的 tensor/data/control edges；
- shape、dtype、约束和来源证据。

该层的 `extraction_scope.kind` 必须是 `full_source`。完整架构使用折叠层模板表示重复结构，不要求展开 61 份相同 Decoder 实例。

当前 MTP 必须同时表达两种不同的重复语义：

- `num_nextn_predict_layers = 1`：只有一个学习到的 MTP Decoder layer，权重索引为 61；
- `next_n = 3`：runner 在一次 speculative 生成过程中循环调用同一个 MTP 模块三次；
- embedding、rotary embedding 和 LM head 与主模型共享，不复制成三套权重。

### 3.2 后端性能覆盖层

来源：

- `ds3_2_analysis_config.json`
- `ds3_2_perf_data.json`
- `ds3_2_timeline.json`

该层负责后端稳定 `node_id`、representative step 指标、operator ratios、Timeline 原始事件与 `owner_node_id`、当前 trace 中观察到的 layer instance，以及模型主干之外的 runtime auxiliary。

该层的范围是 `trace_slice`，不能覆盖或改写 full-source 架构中的完整层数、重复范围和源码事实。

### 3.3 最终 Hybrid 投影

页面使用的图是 `hybrid`：完整源码架构作为图骨架，后端 trace/performance 作为覆盖层。

`hybrid` 仅表示“完整架构 + 局部性能覆盖”，不表示完整模型的所有节点都具有实测数据。

## 4. 源码获取与版本锁定

### 4.1 选择顺序

1. 根据后端 `model_id`、`model_name` 和配置字段定位模型型号。
2. 如果后端提供实际模型源码，先锁定其 repository commit、文件 hash 和匹配的 runner config。
3. 再选择模型作者/组织维护的官方 Hugging Face/DeepSeek 仓库做交叉校验。
4. 如果官方仓库只提供配置或入口文件，继续定位其引用的官方源码仓库。
5. 只获取提取架构所需的源码和 config，不获取权重文件。

### 4.2 Source manifest

必须生成 `model-source-manifest.json`，至少记录：

```json
{
  "model_id": "deepseek-v3.2-exp",
  "source_repo": "<official repository>",
  "source_revision": "<commit or immutable revision>",
  "config_revision": "<revision>",
  "files": [
    {
      "path": "modeling_deepseek.py",
      "sha256": "<hash>",
      "role": "source_of_truth"
    }
  ],
  "license": "<license identifier>",
  "verification_state": "verified | official_baseline | mismatch"
}
```

禁止只记录可移动的 `main`/`latest` 而不记录最终 commit 或 immutable revision。

### 4.3 版本不一致处理

如果后端实际运行的是内部修改版，而后端没有提供源码 revision：

- 官方 Hugging Face 源码只能标记为 `official_baseline`；
- 页面不能显示“与运行源码完全一致”；
- 所有源码与后端结构差异进入 validation/conflict 报告；
- 不允许为了提高映射率静默修改完整架构事实。

当前仓库已不属于该降级分支：`ui-json-main` 在 `f6262f5b95e32a2a66e38314b6c7b035d51ea49d` 提供“用于 node mapping 的 DS3.2 model source”，因此 verification state 为 `runtime_source_locked`。官方源码仍保留为 baseline/cross-check，而不是覆盖实际运行时实现。

## 5. 完整架构提取

按 `model-architecture-extractor` 工作流生成 canonical schema：

1. 识别模型 config、顶层模型类、Decoder 容器、Attention、Dense MLP、MoE/router/expert、MTP、Embedding、Final Norm、LM Head。
2. runtime config 覆盖源码默认值；仅有默认值时必须标记 `default_source` 或 `inferred`。
3. Dense、MoE、MTP 使用 folded ranges/repeats，不在 node label 中写层范围。
4. Module 只表达组合关系；Op 只表达真实操作；Cache/Buffer 必须表达为 State。
5. tensor shape、dtype、约束放在 edge payload，不放进 node label。
6. 每个关键事实携带来源路径、行号或 config key。
7. 运行 architecture schema validator，通过后才能生成可视化投影。

## 6. 后端覆盖层规范化

三份后端 JSON 先规范化为独立的 `backend_trace_overlay.json`，不能直接修改 full-source schema。

```json
{
  "model_id": "deepseek-v3.2-exp",
  "report_id": "deepseek-v3.2-exp/step-15",
  "scope": "trace_slice",
  "nodes": [],
  "runtime_auxiliary": [],
  "timeline_owner_ids": [],
  "observed_instance_indices": {}
}
```

约束：

- `node_id` 保持后端原值；
- metric scope 保持 representative/aggregate 口径；
- observed instance 不能改写源码的完整 repeat range；
- Timeline 的 unmapped event 保持 unmapped，不为提高覆盖率强行指定 owner。

## 7. Source 与 Backend 显式映射

### 7.1 映射产物

生成 `architecture_overlay_map.json`：

```json
{
  "mappings": [
    {
      "backend_node_id": "model/.../layers/moe_decoder_layer/mlp",
      "source_node_ids": ["source/.../decoder/moe_layer/moe"],
      "mapping_kind": "exact | aggregate | alias",
      "evidence": ["semantic path", "code_ref", "source line"],
      "review_state": "resolved | needs_review"
    }
  ],
  "source_only_node_ids": [],
  "backend_only_runtime_node_ids": [],
  "conflicts": []
}
```

### 7.2 匹配优先级

从高到低：

1. 后端 `code_ref` 与源码 module path/line 直接对应；
2. 完整 parent semantic path 对应；
3. backend `semantic_key` 与同一父级下的 source semantic role 对应；
4. 有来源证据的人工 alias；
5. 无法确认则进入 conflict，不映射。

禁止只使用末级 label 或字符串相似度作为 resolved 映射依据。

### 7.3 映射类型

| 类型 | 含义 | 图上行为 |
|---|---|---|
| `exact` | 一个后端节点对应一个源码节点 | 源码节点可交互、着色 |
| `aggregate` | 后端指标只对应一个源码容器 | 只激活容器，不传播到无数据后代 |
| `alias` | 名称不同但有来源证据 | review resolved 后才可交互 |
| `source_only` | 源码存在、后端无数据 | dim、不可选择 |
| `backend_only_runtime` | 不属于模型架构的运行时逻辑 | 放入 Runtime auxiliary 分区，可交互 |
| `backend_trace_extension` | 后端观察到、但锁定的官方源码中没有等价节点 | 放入独立 extension 分区，可交互，不写入 canonical source schema |
| `conflict` | 多义、版本冲突或证据不足 | 不附着到架构节点，进入验证报告 |

一对多映射只有在后端节点明确是 aggregate 时允许。aggregate 指标不得被拆分成多个子节点指标。

## 8. 图投影与布局

### 8.1 模型主链

```text
Input / Embedding
        ↓
Dense Decoder range
        ↓
MoE Decoder range
        ↓
Final Norm ──────────────→ Main LM Head → Main logits
     │
     └─ shared embedding + previous hidden
                    ↓
           MTP learned layer 61 × 1
                    ↓ runtime loop next_n=3
              shared LM Head → Draft logits
```

使用源码配置中的完整 repeat/range。当前 trace 观察到的 `[0,1,2]`、`[3,4,5]` 等只显示为 overlay coverage，不替代完整模型范围。

### 8.2 分支与辅助 lane

- Attention、Dense MLP 默认保持单列阅读方向。
- 只将真实并行关系并排，例如 Gate/Up、shared expert/routed expert、MTP 双输入。
- Parameter/Weight 输入放左侧 lane；State/Cache 放右侧 lane。
- Runtime auxiliary 放在模型 shell 外的独立分区。

### 8.3 Edges

- 只渲染 full-source 提取并通过验证的 tensor/data/control edges。
- 不根据 backend children、op index 或 Timeline 时间顺序补画架构 edge。
- 后端未提供 edge 不妨碍 full-source edge 展示，因为两者来源不同；edge 必须携带 source provenance。

## 9. 视觉状态

### 9.1 Mapped node

- 使用共享 `model-graphviz` semantic color；
- 正常不透明度；
- 可点击、可键盘聚焦、可进入 Inspector；
- 可与 Explorer、Timeline owner 联动；
- 指标只能来自映射的 backend node。

### 9.2 Source-only node

- 仍显示完整结构、label、type 和 edge；
- 透明 dim，不使用性能强调色；
- node body 不可点击、不可聚焦、不打开 Inspector；
- 不显示 metric、operator ratio、诊断或数据可用暗示。

### 9.3 Mapped aggregate container

- 容器本身正常着色并可选择；
- 未单独映射的子节点继续 dim；
- 选择容器时 Inspector 展示 aggregate scope；
- 禁止把 aggregate metric 平均或复制给后代。

### 9.4 Runtime auxiliary

- 只使用后端 node ID 和指标；
- 位于模型架构外侧，避免被误解为 Decoder 数据流节点；
- 正常着色并可交互。

### 9.5 着色语义

第一版使用“语义类别色 + 数据可用性透明度”：

- hue 表示 op/module semantic category；
- opacity 表示是否有后端数据；
- 不使用前端推断的 P0/P1/P2 或热点色；
- 如果未来增加 metric heatmap，必须作为明确模式，并直接使用后端数值和图例。

## 10. 交互规则

| 操作 | 结果 |
|---|---|
| 点击 mapped source node | 通过 mapping 找到 backend node，更新 Inspector、Explorer 和 Timeline focus |
| 点击 mapped aggregate container | 选择 aggregate backend node，不选择无数据子节点 |
| 点击 source-only node body | 无选择行为 |
| 点击 source-only cluster 的折叠控件 | 允许展开/折叠；这是结构导航，不是性能交互 |
| 点击 Explorer backend node | 展开其 source ancestors 并选择 resolved mapping target |
| 点击有 owner 的 Timeline event | owner backend ID 经 mapping 聚焦 source node/container |
| 点击 conflict/unmapped backend node | Inspector 可显示后端原始数据，但架构图不伪造 focus target |

渲染器需要区分：

- `collapsible`：是否允许结构展开折叠；
- `selectable`：是否允许作为性能节点选择；
- `data_state`：`mapped | source_only | backend_only_runtime | conflict`。

## 11. 产物契约

| 文件 | 用途 |
|---|---|
| `outputs/model-source-manifest.json` | 运行时源码、官方交叉校验源码、revision、哈希和版本状态 |
| `outputs/model_architecture.json` | canonical full-source architecture |
| `outputs/model_architecture_validation.md` | 源码/config/结构验证说明 |
| `outputs/backend_trace_overlay.json` | 规范化后的 ui-json trace/performance facts |
| `outputs/architecture_overlay_map.json` | backend ↔ source 显式映射 |
| `outputs/architecture_overlay_validation.md` | 覆盖率、冲突和版本差异 |
| `outputs/model_architecture_graph.json` | renderer-ready hybrid graph |

前端运行时只消费生成后的 JSON，不在浏览器中解析 Python 源码。

## 12. 实施顺序

1. 锁定后端实际模型源码、runner config、revision 和 hash，再锁定官方交叉校验源码。
2. 提取并验证包含主模型与 MTP 的 full-source architecture。
3. 规范化 `ui-json-main` 为 backend overlay。
4. 生成并人工复核 explicit mapping/diff。
5. 投影 hybrid graph 和完整模型布局。
6. 实现 mapped/source-only/runtime/conflict 视觉与交互状态。
7. 接入 Explorer、Inspector 和 Timeline 联动。
8. 完成 schema、mapping、layout 和浏览器验收。

## 13. 验收标准

### 13.1 Source architecture

- `model_architecture.json` 通过 skill schema validator；
- 模型层数、Dense/MoE 范围与锁定的 source/config 一致；当前 MTP 必须验证为 1 个学习层、3 次运行迭代，并记录共享 embedding/RoPE/LM head；
- Module/Op/State/Parameter 类型正确；
- node label 不包含 shape、arrow、层范围、专家数或约束；
- edge 具有来源证据，无 profiler-order 推测边。

### 13.2 Backend overlay

- `ui-json-main` 的 88 个 backend node IDs 零丢失；
- perf metrics、operator ratios、Timeline owner 保持原值；
- mapped、source-only、backend-only、conflict 数量可审计；
- 所有 resolved mapping 都有 evidence；
- aggregate metric 不泄漏到 source-only descendants。

### 13.3 Rendering

- 完整架构节点均存在；
- source-only 节点 dim 且不可选择；
- mapped 节点正常着色、可选择并能打开正确 backend Inspector；
- runtime auxiliary 在模型主链之外；
- 折叠前后保持节点身份和视口锚点；
- 通过 `validate_modelviz_layout.py`，无 node overlap、cluster overlap 或 parent overflow。

### 13.4 Browser smoke test

- 标准视口默认加载成功；
- mapped、source-only、aggregate、runtime 四种状态各验证一个节点；
- Explorer 深层选择能展开 source ancestors；
- Timeline owner 能通过映射聚焦正确 source target；
- source-only 节点没有 `button`/`tabindex`/Inspector 行为；
- 页面无 console error 和网络运行时依赖。

## 14. 后端可选增强

该方案不要求后端提供完整架构 edge，但以下字段能显著降低映射歧义：

- `source_repo`
- `source_revision`
- `config_hash`
- 标准化 `module_path`
- 精确 `code_ref`（文件 + 行号）
- aggregate node 的 `aggregate_kind` 和 `children`

这些字段属于 provenance/mapping 增强，不改变前端必须以源码架构为骨架的原则。

## 15. 当前实现迁移

迁移已完成：

1. 保留现有 `report-data.js` 对 perf/timeline 的解析；
2. 用生成的 full-source graph 替换当前 trace-only architecture base；
3. 将现有 88 backend nodes 转为 overlay/mapping 输入；
4. 保留 Runtime auxiliary、Explorer、Inspector、Timeline 的 backend ID 语义；
5. trace-only architecture 已由经过 schema、mapping 与 layout 验证的 hybrid graph 替换。
6. `f6262f5` 新增的实际模型源码已取代“MTP 是 backend-only extension”的旧假设；MTP 已合并进整网，Runtime auxiliary 保持外置。

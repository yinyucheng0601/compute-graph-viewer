# openPangu MoE 通信异常现场回放规格

状态：Draft · 架构纠偏中  
更新：2026-09-11  
目标页面：`training-structure-time-v4.html`  
基线页面：`training-structure-time-v3.html`  
本轮新增范围：openPangu 模型正视图源码解析、残差边和 Routed Experts 层级纠偏

## 1. 决策摘要

本能力是现有“训练结构与执行时序”的增量场景，不新建上游监控页。页面打开时已经绑定一个确定的训练 step，用户直接查看该 step 的完整执行现场。

本期围绕一条核心问题链设计：

```text
异常 EP Dispatch / Combine
        ↓
异常 EP Group 与 EP Rank
        ↓
关联 PP Stage、Microbatch、Layer
        ↓
定位 Router / Routed Experts
        ↓
解释专家负载倾斜如何形成通信热点、等待与超时
```

四项必须落地的产品决策：

1. 不展示“上游如何发现异常 step”；页面输入就是单个 step。
2. 泳道资源树增加 EP Group 和 EP Rank 语义，不能只在普通 Rank 元信息里显示一个 `EPx` 标签。
3. 异常是事件状态与诊断角色，不是新的事件类型；`EP Dispatch` 仍是通信事件，同时可标记为异常源、异常表象或受影响事件。
4. 左侧增加 Layer 选择器；事件选择能跳到对应 Layer，并同步定位 Router、Routed Experts 或 EP Dispatch/Combine。

## 2. 用户问题与成功标准

用户进入页面后应能依次回答：

1. 这个 step 中哪一个通信事件异常？
2. 异常属于哪个 PP Stage、EP Group、EP Rank 和 Microbatch？
3. 是哪个 Layer 的 Router / Routed Experts 触发或承受了异常？
4. 专家负载、收发量和等待关系是否支持“路由倾斜导致 all-to-all 异常”的判断？
5. 哪些 Rank 是首因或热点，哪些 Rank 只是被同步屏障拖住？

成功标准：用户无需切换到另一张拓扑图，即可从异常时间条进入 Layer 和 MoE 对象，再从异常专家反查其 owner EP Rank 及相关 Dispatch/Combine 事件。

## 3. 范围与非目标

### 3.1 本期范围

- 单个 step 的完整时序。
- DP、PP Stage、EP Group、EP Rank、Microbatch 五个定位维度。
- 前向、反向、通信、等待、优化器和激活驻留事件。
- 异常事件状态、诊断角色和异常证据。
- openPangu-2.0-Flash 的 Layer 选择与模型对象联动。
- Router 专家负载、Routed Experts 全量分布与 EP 通信联动。
- 正常基线与当前事件/专家负载的局部对比。

### 3.2 非目标

- 不在本页发现异常 step，不增加跨 step 的 loss、MFU、grad norm 或 AMP scaler 趋势图。
- 不在本页完成 plog 解析、日志翻译或 Python 调用栈定位。
- 不做硬件链路、NVLINK/HCCS/IB 物理拓扑诊断。
- 不在本页执行熔断、停训、参数修改或自动修复。
- 不把空白时间自动解释为等待；只有生产端明确提供的 `wait` 事件才能计入等待和 Bubble。
- 不把模拟事故数据描述为实测 openPangu Profiling。

## 4. 页面信息架构

保留当前左右分栏：左侧“模型结构与训练运行时”，右侧“执行时序”。不增加第三个常驻主栏。

### 4.1 顶部上下文

顶部只显示当前数据集上下文：

```text
openPangu-2.0-Flash · Step 15203 · PP4 / EP64 / DP8 · 2048 Ranks
```

- `Step 15203` 是只读上下文，不提供 step 趋势或上游发现过程。
- 数据为模拟时必须持续显示“模拟事故”；数据为实测时显示“实测 Profiling”。
- 页面加载后默认展示完整 step，不默认选中模型节点或事件。
- 若数据带有 incident focus，可在完整 step 中使异常事件可见并展开相应资源层级，但不得自动制造“用户已选择”的状态。

### 4.2 左侧：Layer 与模型对象

左侧工具栏增加 `Layer` 选择器，位于结构层级控制与“适配”之间或作为同一工具栏的首要上下文控件。

Layer 选择器要求：

- 数据驱动生成全部主层，不硬编码层数。
- openPangu-2.0-Flash 为 L0–L45；L0–L1 标记 Dense，L2–L45 标记 MoE。
- 选项按数据中的 PP Stage 分组，例如 `PP3 · L34–L45`，而不是在前端推算。
- 默认值为“结构概览”，不默认选中某一层。
- 手动选择 Layer 后，左图打开该 Layer；右侧时序仅强调该 Layer 的事件，保留其他事件为背景，不改变 step 时间范围。
- 点击时间轴事件时，若事件存在 `layer`，Layer 选择器同步到该层并打开对应结构。
- 点击无 Layer 绑定的 step 级事件时，保持当前 Layer，不猜测归属。

模型结构要求：

- 从当前 DeepSeek V4 专用结构切换为 source-checked openPangu-2.0-Flash 结构数据。
- 使用共享 `model-graphviz` / `model-architecture-training-sidecar` 能力，不复制或重画模型节点。
- 选中 Layer 后，至少能定位 `Router`、`Routed Experts`、`Shared Expert`、`EP Dispatch` 和 `EP Combine`。
- 事件到模型的定位必须使用数据绑定，不允许通过事件 label 字符串猜节点。

### 4.3 右侧：EP 感知的资源泳道

当 `EP > 1` 时，完整层级为：

```text
DP Replica
└── PP Stage
    └── EP Group
        └── EP Rank（Global Rank + EP coordinate）
            ├── 计算
            ├── 通信
            ├── 等待
            └── 其他活动
```

语义约束：

- `Global Rank` 是训练进程身份；`EP Rank` 是该进程在特定 EP Group 内的坐标，二者不能混称。
- 行标题格式为 `R151 · EP23`；hover/详情补充 node、device、DP、PP、TP 和 EP Group。
- EP Group 必须来自显式 `epGroupId` 和成员列表，不得仅按 `rank % EP` 推算。
- 若 TP/CP 与 EP 组合，生产端必须提供该通信域的准确成员；页面不自行推断正交关系。
- EP Group 摘要行显示总通信跨度、异常成员数、最大/中位通信时长和最大等待时长。
- EP Rank 折叠态保持“计算 / 通信 / 其他活动”概览；展开态将等待独立成轨，避免把等待混入空白。
- Microbatch 仍是跨泳道焦点，不成为资源树父节点。

### 4.4 时间窗口控制

保留“完整 step / PP 阶段 / 层对象 / Rank 前向 / Rank 反向”，增加面向通信事故的窗口：

- `EP Group`：只显示一个 EP Group 的成员 Rank 及其计算、通信、等待事件。
- `异常窗口`：使用生产端提供的 incident time range；没有该字段时禁用，不由前端猜测。

选择 EP Group 或异常窗口不改变 Layer 和 Microbatch 选择；这些维度继续保持正交。

## 5. 异常事件的 UI 表达

### 5.1 状态模型

事件类型与事件状态分离：

| 维度 | 值 |
| --- | --- |
| `kind` | `forward` / `backward` / `comm` / `wait` / `optimizer` / `hold` / `misc` |
| `status` | `normal` / `warning` / `critical` |
| `diagnosisRole` | `root-cause` / `symptom` / `affected` / `context` |

示例：异常的 `EP Dispatch` 仍为 `kind=comm`，同时为 `status=critical`、`diagnosisRole=symptom`；Router 溢出证据对应的模型对象或事件可为 `diagnosisRole=root-cause`；其余 Rank 的 barrier wait 为 `diagnosisRole=affected`。

### 5.2 视觉规则

- 事件主体颜色继续编码事件类型，异常不能把所有通信条统一改成红色，否则会丢失“它仍是通信事件”的语义。
- 异常状态使用附加信号：状态标记、边界强调和异常图标；不能只依赖颜色。
- `critical` 使用 `--danger`，`warning` 使用 `--warning`，正常通信仍使用通信类别色。
- `root-cause`、`symptom`、`affected` 通过详情文案和关系连线区分，不再创建三套事件条形状。
- 选中态优先级高于异常态：选中事件保持清晰焦点轮廓，同时保留异常状态标记。
- 不使用持续闪烁或脉冲；所有过渡服从 `prefers-reduced-motion`。

实现约束：事件条必须继续调用共享 `swimlane-task` Pattern。若 Pattern 当前不能表达异常状态，应先在 Pattern 中增加并预览 `warning` / `critical` 状态，再由页面消费；禁止在页面 CSS 中覆写一套私有事件条。

### 5.3 异常可发现性

页面首屏必须同时提供：

- 时间轴上可扫视的异常标记。
- EP Group 行上的异常成员数量。
- 行头中的异常 EP Rank 标记。
- 图例中对“异常状态”和“事件类型”两个维度的分别解释。

不自动选中异常事件。用户点击异常标记或事件后才进入联动状态。

### 5.4 事件详情

异常通信事件详情至少展示：

- 事件名称、phase（Dispatch/Combine）、开始时间、结束时间、duration。
- 当前值、健康基线、绝对差和倍数差。
- Global Rank、EP Rank、EP Group、PP Stage、DP、TP、Microbatch、Layer。
- 通信原语、参与 Rank、stream、task ID。
- send/recv token count、send/recv bytes、有效带宽、wait duration。
- 异常判据、状态、诊断角色。
- `blockedBy` / `affects` 关系。
- 绑定的模型节点和证据来源。

缺失字段显示“未采集”，不得显示 `0` 或生成推断值。

## 6. Layer、Router、Routed Experts 联动

### 6.1 事件选择到模型结构

点击 `EP Dispatch · L38` 后：

1. 时间轴选中该事件并显示详情。
2. Layer 选择器切换到 L38。
3. 左侧展开 L38 的 MoE 结构。
4. `EP Dispatch`、`Router`、`Routed Experts` 按数据关系显示选中、上游和下游状态。
5. 右侧相关 Combine、Expert Compute 和明确记录的 Wait 事件显示关系强调，但不隐藏其他上下文。

如果数据只能证明通信异常，不能证明 Router 是根因，则 Router 只能显示“相关候选”，不得显示为已确认根因。

### 6.2 模型结构到时间轴

- 点击 Router：强调同 Layer、同 Microbatch 的 Router 计算、Dispatch 和相关 expert load 证据。
- 点击 Routed Experts：打开专家负载详情，并强调其关联的 Expert Compute、Dispatch/Combine 事件。
- 点击某个 Expert：强调 owner EP Rank 及涉及该 Expert 的通信事件。
- 点击 EP Dispatch/Combine：强调对应 EP Group 全体参与 Rank。
- 清除结构选择只清除结构过滤与关系强调，不重置 step、Layer、EP Group 或 Microbatch。

### 6.3 Routed Experts 图表

参考 `Profiling_Insight_and_Tool/training-run-twin-standalone/training-monitoring-v2.html` 的两类既有表达：

1. 当前值与健康基线对比：Top1 专家占比、Dead Expert 占比、热点专家与其余专家均值。
2. `routed_expert_bank` 原地展开的全量专家热力分布。

本页采用以下组合，而不是直接复制参考页面 DOM/CSS：

#### A. 摘要区

- Top1 Expert share：当前 / 基线。
- Dead Expert count 与占比：当前 / 基线。
- Load CV 或 imbalance ratio。
- Router entropy；未采集时不显示。
- 一句诊断摘要，例如“E193 承接 98% token，owner 为 R151 · EP23”。

#### B. 全量专家热力图

- 每格代表一个 Routed Expert，按 Expert ID 稳定排序。
- 颜色编码 `loadRatio = tokenCount / expectedTokenCount`；缺失数据使用中性缺失态，不能当作 0 token。
- 热点、容量预警、溢出和 dead expert 必须可区分，并提供非颜色辅助标记。
- hover：Expert ID、owner Global Rank、EP Rank、token count/share、基线、偏差、capacity、状态。
- 点击 Expert 后保持选择，并双向联动 EP Rank 行与相关通信事件。

#### C. 可选路由视图

需要查看 Rank→Expert 或 Token→Expert 路由时，直接嵌入共享 `moe-routing` Pattern，设置 `showChrome:false`，通过 `controller.setLayer()`、`setToken()` 和 `setActiveRanks()` 驱动。禁止在本页重新实现 256 专家几何和 Top-K 连线。

#### D. 通信流量视图

需要展开 Rank→Expert 的字节/Token 流时，使用已批准的 `communication-traffic-sankey` Pattern。它作为专家详情的可选子视图，不取代右侧时间轴。

## 7. 推荐事故脚本

首个可验证场景采用定位链中的 openPangu Router/EP 事故，但必须标明为“模拟事故复盘”：

```text
Step 15203
L38 · MoE
EP Group：明确 ID 与 64 个成员
热点 Expert：E193
热点 owner：明确 Global Rank 与 EP23 的映射
Router：E193 获取约 98% token
Dead Experts：247 / 256
异常通信：EP Dispatch / all-to-all
异常证据：send=0、recv=9832 tokens（或生产数据中的真实口径）
影响：其余 EP Rank barrier wait，随后 PP Stage 等待扩散
```

注意：原案例中的 `rank 23` 有时表示 EP coordinate，有时被当作全局 Rank。落地数据必须拆成 `globalRank` 和 `epRank`，没有证据时不得假定两者相等。

## 8. 数据契约增量

建议将当前 `training-timeline.v2` 升级为新版本；旧数据通过显式 adapter 兼容，不在前端散落兼容判断。

### 8.1 顶层新增

```json
{
  "incident": {
    "id": "router-collapse-step-15203",
    "status": "critical",
    "summary": "Router load collapse caused EP all-to-all mismatch",
    "timeRange": { "start": 120.0, "end": 30120.0 },
    "focus": {
      "stage": 3,
      "layer": 38,
      "microbatchId": "MB03",
      "epGroupId": "ep-group/pp3/dp0/tp0",
      "eventIds": ["event/dispatch/l38/mb03/r151"],
      "rankIds": [151],
      "nodeIds": ["router_gate", "routed_expert_bank"]
    },
    "provenanceIds": ["incident-simulation"]
  },
  "epGroups": [],
  "expertLoads": []
}
```

`incident.focus` 用于首屏 framing 和层级展开，不等价于用户选择。

### 8.2 EP Group

```json
{
  "id": "ep-group/pp3/dp0/tp0",
  "stage": 3,
  "dp": 0,
  "tp": 0,
  "ranks": [
    { "globalRank": 128, "epRank": 0 },
    { "globalRank": 151, "epRank": 23 }
  ],
  "provenanceIds": ["parallel-config"]
}
```

### 8.3 Event 新增字段

```json
{
  "status": "critical",
  "diagnosisRole": "symptom",
  "epGroupId": "ep-group/pp3/dp0/tp0",
  "epRank": 23,
  "anomaly": {
    "baselineDuration": 198.0,
    "deltaRatio": 32.2,
    "reasonCode": "A2A_SEND_RECV_MISMATCH",
    "threshold": "duration > baseline × 5"
  },
  "communication": {
    "primitive": "all-to-all",
    "phase": "dispatch",
    "sendTokens": 0,
    "recvTokens": 9832,
    "sendBytes": null,
    "recvBytes": null,
    "bandwidthGBps": null,
    "waitDuration": 30000.0
  },
  "blockedBy": [],
  "affects": []
}
```

`blockedBy` 与 `dependsOn` 分离：`dependsOn` 继续表达已完成事件之间的执行因果；`blockedBy` 表达同步等待和未完成依赖，不能被当前 `previous.end <= current.start` 规则错误拒绝。

### 8.4 Expert Load

```json
{
  "id": "expert-load/l38/mb03/e193",
  "layer": 38,
  "microbatchId": "MB03",
  "expertId": 193,
  "globalRank": 151,
  "epRank": 23,
  "epGroupId": "ep-group/pp3/dp0/tp0",
  "tokenCount": 8028,
  "tokenShare": 0.98,
  "baselineShare": 0.0039,
  "capacity": null,
  "status": "critical",
  "provenanceIds": ["incident-simulation"]
}
```

## 9. 交互状态规则

| 操作 | Layer | EP Group | Microbatch | 时间范围 | 事件选择 |
| --- | --- | --- | --- | --- | --- |
| 页面加载 | 概览 | 全部 | 全部 | 完整 step | 无 |
| 点击异常事件 | 同步到事件 Layer | 同步并展开所属组 | 保持当前；提供“追踪 MB”动作 | 不变 | 当前事件 |
| 手动选 Layer | 新 Layer | 保持 | 保持 | 不变 | 清除不属于该层的事件选择 |
| 点击 Expert | 保持 | 同步 owner group | 保持 | 不变 | 相关通信被强调，不伪装为选中 |
| 追踪 MB | 保持 | 保持 | 当前事件 MB | 不变 | 保持 |
| 清除事件 | 保持 | 保持 | 保持 | 不变 | 无 |

原则：Layer、EP Group、Microbatch、时间窗口和事件选择是不同维度，任何联动都必须在 UI 中可解释、可清除。

## 10. Pattern 与设计系统约束

- 页面外壳继续使用 `ide-frame` 和 `workbench-shell`。
- 时间条、hover 和事件类别色继续使用 `swimlane-task`。
- openPangu 模型结构使用 `model-graphviz`；Layer 训练语义优先使用 `model-architecture-training-sidecar`。
- 全量专家路由使用 `moe-routing`。
- Rank→Expert 流量使用 `communication-traffic-sankey`。
- 普通控件使用现有 `.btn`、`.tab-control`、`.segmented-control`、`.toolbar-control`、`.panel-shell` 和 Inspector 类。
- 所有非数据可视化颜色、间距、圆角和字体使用 PTO Token。
- 专家热力图色带属于数据编码，可使用专用连续色带，但需记录刻度、缺失态和色盲辅助策略。
- 若新增异常事件状态、图例或可复用专家热力组件，应先进入设计系统 Pattern 预览审批，不得先在产品页形成私有样式。

## 11. 无障碍与键盘

- Layer、EP Group、Microbatch 控件均有可读 label 和当前状态说明。
- 异常事件除颜色外必须有图标或文本状态。
- Canvas 事件继续支持方向键选择、Enter 打开详情、Escape 清除。
- Expert 热力图支持键盘在格子间移动；焦点信息与 hover 信息一致。
- 所有图表必须提供可访问摘要：当前热点专家、异常 Rank、最大偏差和总体判定。
- 任何动画均支持 reduced motion。

## 12. 验收场景

### 12.1 固定 step 入口

- 打开页面直接显示一个 step 的完整时序。
- 页面没有上游趋势图、step 搜索或异常发现流程。
- 顶部能明确区分模拟与实测数据。

### 12.2 EP Rank 层级

- PP Stage 下可展开 EP Group。
- EP Group 下每个成员显示为 `Global Rank · EP Rank`。
- 选择异常 EP Rank 时，能看到其计算、通信和明确采集的等待事件。
- 页面不通过取模推算 EP Group。

### 12.3 异常事件

- 正常和异常 EP Dispatch 同时出现时，二者仍可被识别为通信事件。
- 异常事件无需点击即可扫视发现，并且不只依赖红色。
- 点击后详情包含基线差、Rank/EP、send/recv、等待与证据来源。

### 12.4 Layer 联动

- 点击 L38 的异常 Dispatch，Layer 选择器同步到 L38。
- 左图定位到 L38 的 EP Dispatch、Router 和 Routed Experts。
- 选择另一个 Layer 不改变 step 和时间范围。
- 无 Layer 绑定事件不会触发错误跳转。

### 12.5 Expert 联动

- Routed Experts 详情显示全量专家，不只显示 Top1。
- E193 热点、247 个 dead experts 和缺失数据具有不同视觉语义。
- 点击 E193 后，owner EP Rank 和相关 Dispatch/Combine 被强调。
- 清除 Expert 选择后恢复完整上下文。

### 12.6 数据边界

- 模拟事故不得显示“实测”。
- sendBytes、bandwidth 或 capacity 缺失时显示“未采集”。
- 没有显式 wait 事件时，页面不得计算等待时长或 PP Bubble。

## 13. Schema-first 架构纠偏

### 13.1 纠偏结论

v3 已经确定“离线生产、版本化契约、前端只读消费”的边界。v4 不得因为新增 Router、Routed Experts 或异常联动而在浏览器内增加第二套业务数据。

目标数据流固定为：

```text
source-checked 模型结构 + 明确的训练模拟配置 + 可选 Profiling 参考
                              ↓
                    独立离线 producer
                              ↓
               单一 versioned timeline artifact
                              ↓
                  schema + semantic contract
                              ↓
      前端纯转换 adapter → 模型结构 / Routed Experts / 泳道
```

约束：

- 一个页面运行时只能有一个场景事实源，即经验证的 timeline artifact。
- Pattern 可以拥有通用几何、交互和渲染逻辑，但不能在消费页面中生成 Step、Rank、Layer、Expert、路由或性能指标。
- 前端 adapter 只能对 artifact 做无损投影、索引、排序、筛选和显示统计，不能补造缺失业务事实。
- 数据缺失必须保留为 `null`、`unknown` 或明确的 coverage，不得回退到 Pattern preview 数据。
- 模型结构可由 artifact 引用独立的 source-checked architecture asset，但其 ID、版本、hash 和节点绑定必须由 artifact 声明；页面不得固定选择某个模型 preset。

### 13.2 当前 v4 审计结论

当前实现暂定性标记为“交互原型，数据架构未验收”。以下问题修复前，不得把 v4 作为 schema-first 示例：

1. `openpangu-moe-incident-step15203.timeline.json` 负责右侧时序和聚合 Expert 负载。
2. `incident-routing-data.js` 在浏览器中另行生成 44 个 MoE Layer、128 tokens、128 placement slots 的路由数据，未进入 timeline schema。
3. `model-architecture-training-sidecar` 固定使用 `openpangu-flash` preset；未注入 snapshot 时生成默认 Step 18420 的 preview metrics。
4. HTML 和控制器仍硬编码 openPangu、Step 15203、PP3、L38、E193、EP23、R215、0–8500 ms 和模型节点别名。
5. v4 contract 对大量对象只验证必填字段存在，无法拒绝错误类型、越界指标和不存在的模型节点。
6. 当前测试固化单一事故数字，但没有验证“更换合法 artifact 后前端无需修改”。

已经确认的跨视图冲突：

| 对象 | Timeline artifact | 左侧 Pattern / preset |
| --- | --- | --- |
| Step | 15203 | Sidecar fallback 18420 |
| PP Layer 范围 | `0–11 / 12–22 / 23–33 / 34–45` | `0–11 / 12–22 / 23–34 / 35–45` |
| 并行配置 | DP8 / PP4 / TP1 / EP64 | DP4 / PP4 / TP2 / EP8 注解 |
| Expert placement | EP64，主要为 4 Experts / EP Rank | 128 slots，2 Experts / slot |
| 路由样本 | 8192 Top1 token assignments | 128 tokens × Top-8 copies |
| E193 | 约 98% Top1 token | 12.5% routing copies，平均 weight 约 51% |
| Dead Experts | 247 | 38 |
| Load CV | 15.61 | 约 2.03 |

这些差异不是允许的显示聚合，而是同一对象由不同 producer 生成，必须消除。

### 13.3 唯一 artifact 的职责

下一版 `training-timeline.v3` artifact 至少包含以下域：

| 域 | 必须表达的事实 |
| --- | --- |
| `model` | model ID、层数、Dense/MoE Layer 分类、Expert 数、source asset、version/hash |
| `topology` | 显式 world size、并行维度、维度关系、可见切片、Rank placement |
| `stages` | PP Stage 与 Layer 范围；成为所有视图唯一的 PP 分层来源 |
| `epGroups` | 通信域 ID、成员 Global Rank、EP Rank、DP/PP/TP 坐标 |
| `expertPlacements` | 给定 Layer/EP Group 下 Expert 到 owner Global Rank/EP Rank 的显式映射 |
| `routingRecords` | Layer、Microbatch、token、Top-K Expert、weight；无明细时允许只有明确语义的 aggregate |
| `routerMetrics` | Top1 assignment、entropy、CV、dead/idle Expert 等带上下文的指标 |
| `expertLoads` | 以 Layer + Microbatch + EP Group + Expert 为复合身份的负载记录 |
| `events` | 时序、状态、诊断角色、通信证据和显式因果关系 |
| `modelBindings` | canonical semantic node ID 到实际 renderer node ID、label 和 architecture source 的映射 |
| `incident` | 异常窗口、focus、根因/症状/受影响对象及证据来源 |
| `provenance` | 每类事实的实测、source-checked、模拟或缺失边界 |

`tokenCount` 不再保持歧义，至少拆分或显式声明为：

- `top1TokenCount`：Top1 assignment 数量。
- `topKCopyCount`：Top-K 展开后的 routed copies。
- `routingWeightSum`：路由权重累计值。

左侧和右侧必须选用同一个语义字段，不允许一侧显示 Top1 share、另一侧显示 Top-K copy share 而仍使用“负载占比”同一名称。

### 13.4 生产器职责

v4 producer 恢复 v3 的可复现模式：

- 模型事实、训练拓扑假设和事故参数分别放在有来源的输入配置中，不散落为生成器魔数。
- generator 导出纯 `generate(config, sources)` API；默认执行不写文件，显式 `--write` 才更新 artifact。
- 生成完成后调用与浏览器相同的 contract 校验。
- 生成 hash 覆盖全部输入配置、architecture asset identity 和参考数据 identity。
- 测试必须证明相同输入产生逐字一致输出，且已提交 artifact 与实时生成结果一致。
- generator 可以模拟数据；浏览器不得运行 generator，也不得加载额外场景 JS 作为 fallback。
- `worldSize` 由生产配置显式提供并注明并行语义，contract 不默认执行 `DP × PP × TP × EP`。若某部署确实满足该公式，应由 topology policy 声明后再校验。

### 13.5 前端纯消费职责

HTML 只保留通用容器和产品级静态文案。以下内容必须在 artifact 校验通过后动态渲染：

- 数据集、模型、Step 和 fidelity。
- Layer、PP Stage、EP Group、Global Rank、EP Rank 和 Microbatch。
- Expert 数量、placement、热点、dead/missing 状态和路由权重。
- incident focus、异常窗口、Rank 展开顺序和默认可见范围。
- 模型节点 label、canonical ID 与 renderer ID 映射。
- Sidecar topology、stage ranges、snapshots 和 metric context。

明确禁止：

- 加载 `incident-routing-data.js` 或等价的页面级业务 fixture。
- 固定 `preset: openpangu-flash` 作为模型事实来源。
- 在 HTML 中出现具体 Step、Layer、Expert、Rank、EP Rank 或事故时间范围。
- 通过 `layer < 2`、`rank % EP`、`expert / N` 等公式猜测模型类别或 placement。
- 当 artifact 没有 metric 时启用 Sidecar `previewSnapshot()`。
- 在控制器中维护只能服务某一个模型的 graph-node alias 表。

共享 Pattern 的接入方式调整为：

```text
validated artifact
  ├─ buildModelSidecarInput(dataset)
  ├─ buildMoeRoutingInput(dataset)
  └─ buildTimelineInput(dataset)
```

三个函数必须是无副作用的纯转换，输出中的实体 ID 可反向追溯到 artifact。

### 13.6 Contract 结构与语义校验

Schema 必须补齐每个必填字段的类型、范围、枚举和 nullable 规则；不能只写 `required`。Semantic contract 至少增加：

- `coverage.visibleRanks === ranks.length`，并验证 `visibleDp` 与实际 Rank 坐标一致。
- Stage 数量和 Layer 范围与模型及 PP topology 一致；Layer 恰好归属一个 Stage。
- incident focus 的 Stage、Layer、Microbatch、EP Group、Rank、Event 和 Node 全部可解析且上下文相符。
- `event.graphNodeIds` 和 `incident.focus.nodeIds` 必须存在于 `modelBindings`。
- Router top Expert 必须存在于同 Layer、Microbatch 和 EP Group 的 `expertLoads`。
- `top1TokenCount` 总和、share 总和和 `routerMetrics.totalTokens` 一致；dead Expert 必须为零负载。
- Expert placement 与 Expert load 的 owner 一致；routing record 的 Expert、owner 和 EP Group 一致。
- Top-K route 的 Expert 不重复、weight 和符合约定；aggregate-only 数据不得伪装为 token route。
- Event placement 与 Rank placement 一致；participants 属于声明的通信域或显式声明的外部 coverage。
- 时间、依赖和异常关系引用有效；缺失字段不能用 `0` 替代。
- `fidelity` 和 provenance 在 dataset、event、metric、routing 之间一致。

Contract 不得硬编码 `expertCount === 256`、某个 Step、某个 Expert、某个 Rank 或某一种并行度乘法。

### 13.7 测试门禁

数据闭环必须先通过以下门禁，才进入视觉验收：

1. **Producer determinism**：相同输入逐字输出一致，artifact 未漂移。
2. **Negative contract tests**：错误类型、非法 share、悬空 Node、错误 focus、placement 冲突和统计不守恒必须被拒绝。
3. **Cross-view identity tests**：Router、Expert、Global Rank、EP Rank、Layer、Microbatch 在三种 adapter 中保持相同 ID 和上下文。
4. **Cross-view metric tests**：E193 的 token count/share、dead count、CV 等在左图、摘要和详情中来自同一记录。
5. **Second-fixture test**：加入不同模型名、Step、Stage 划分、EP 数和热点 Expert 的第二 fixture；不得修改 HTML/JS 即可加载。
6. **Actual controller test**：像 v3 一样加载真实页面控制器，而不是只用正则检查脚本引用。
7. **Browser smoke**：在 canonical viewport 验证默认态、异常选择和双向联动，无控制台错误。

已有测试全部通过不代表本节验收通过；当前 v4 测试缺少第 2–6 项。

## 14. openPangu 模型正视图专项纠偏

### 14.1 问题定性

这一项不是时间轴页面内的视觉微调，而是模型事实层、图投影层和运行时 overlay 之间的职责错位，需要前后端分别处理。

当前已确认的问题：

| 层级 | 当前状态 | 纠偏要求 |
| --- | --- | --- |
| 模型事实 | 已有 source-checked openPangu architecture asset，但 `Routed Expert Bank` 仍被建模为单个 `FusedMoE` Op | 重新核对源码并把 Routed Experts 建模为可展开的父 Module |
| 正视图数据 | `model-architecture-3d-deck` 在 `pattern.js` 中手写 Layer 内部算子、连线、Stage 范围和并行标注 | 正视图必须由 canonical architecture artifact 投影，不得以 preset/DOM builder 当作模型事实 |
| 残差关系 | 当前将 mHC 状态简化为从 Layer 输入到 Merge 的单条 residual edge | 区分 decoder mHC 四路状态、`h_post` / `h_res` / `residual` 与 Attention 内部 MoME residual，按源码端口建边 |
| MoE 运行路径 | 图中把 AllGather / Reduce-Scatter / Dispatch / Combine 组合成固定路径 | 模型事实表达源码分支；当次 step 采用哪种通信策略由 timeline/runtime artifact 选择 |
| Expert 数量 | 手写 Expert Pool 展开为 72 个无身份方块，与 openPangu 的 256 个 logical Routed Experts 不符 | 产物中存在 E0–E255 全量 child identity；图上可用紧凑方块呈现，但不能丢实体 |
| 样式 | 正视图使用页面私有 CSS/DOM 结构，没有完整遵守 `model-graphviz` Pattern | 回到 PTO 共享 renderer、capsule、colormap、cluster 和折叠交互契约 |

现有 openPangu architecture asset 和验证文档只能作为本轮重新解析的输入与对照，不能因为标记了 source-checked 就免于重新核对用户指出的算子、连线和残差问题。

### 14.2 目标数据流

模型结构与训练现场保持两个不可混写的 artifact，由显式 binding 关联：

```text
openPangu config + pangu_v2_moe.py + npu_pangu.py + fused_moe source
                                  ↓
                    model architecture extractor
                                  ↓
      canonical model_architecture.json + validation + graph projection
                                  ↓ model asset id/version/hash
             validated training timeline / incident artifact
                                  ↓
         前端纯 adapter + PTO model-graphviz renderer + runtime overlay
```

边界：

- canonical architecture 表达源码中的 Module、Op、State、张量边、重复和条件分支。
- timeline artifact 表达当次 step 的 PP/TP/EP/DP topology、通信策略、Expert placement、路由量和事件。
- `modelBindings` 只能引用 canonical node ID；不允许页面再保留一套手写别名图。
- 模型结构不得因为某个 step 的 EP placement 而改变；runtime overlay 也不得补造模型中不存在的算子。

### 14.3 后端 / 离线产物责任

后端在本 spec 中指源码解析、数据生成和 contract 校验侧，不限定实现语言。

1. 重新从 openPangu 运行配置和模型源码抽取完整的 decoder layer 结构，为关键节点和边保留文件、行号、source hash 和 confidence。
2. 分开表达三种容易混淆的关系：
   - decoder mHC 四路状态与 `mhc_pre` / `mhc_post`；
   - Q/KV/O MoME causal-conv 内部的局部 residual；
   - 当 `use_mhc=false` 时才成立的普通 `hidden_states + residual` 分支。
3. mHC 启用时不画成标准 Transformer 的两条 Add skip path。图边需显式区分 `hidden_states`、`residual`、`h_post`、`h_res` 和四路 state bundle，并指向真实的 post/pre 组合端口。
4. MoE 通信不再写成单一无条件拓扑。`allreduce`、`allgather_reducescatter`、`all2allv`、`dispatch_combine` 和 fused path 以 `branches[]` / runtime policy 表达，当次 incident 只激活 artifact 声明的分支。
5. 输出三个可验证产物：`model_architecture.json`、`model_architecture_validation.md`、`model_architecture_graph.json`。第三个只是前两者的 renderer-ready 投影，不能加入无来源的算子。
6. timeline producer 记录上述模型 asset 的 ID、schema version 和 content hash；模型 asset 变更后，旧 binding 必须经重新校验才能发布。

### 14.4 Routed Experts 层级契约

`Routed Experts` 是 MoE 内部可折叠的父 `Module`，不再是一个没有子节点的 `FusedMoE` Op。

目标层级：

```text
MoE FFN
├─ Router Gate
├─ TopK Router
├─ Routed Experts                 parent Module
│  ├─ E000                         logical Expert child
│  ├─ E001
│  ├─ …
│  └─ E255
├─ Shared Expert
└─ MoE Combine
```

契约：

- 默认折叠时 node label 只显示 `Routed Experts`；`256 logical` 放在 repeat badge / Inspector 元数据中。数量来自 config/symbol table，不得写在 node label 或页面模板中。
- expand 后必须保留 E0–E255 全量 child identity。图形可使用方块矩阵，默认不在每个方块内绘制长文本，但 hover、键盘 focus、选中和 Inspector 必须返回 Expert ID。
- 不得用“前 N 个 + 省略号”替代全量节点；如果使用虚拟化，也必须保证 256 个 Expert 都在可寻址数据集中。
- E0–E255 标记为由 `E=256` 实例化得到的 logical instances，每个 child 的 provenance 指向 Expert 数量配置和父 Module，不伪装成 256 个独立 Python class 或 256 个已实测 kernel。
- `NPUSharedFusedMoE` / `FusedMoE` 作为 Routed Experts 父 Module 的 implementation reference 或实现层节点保留，不再取代 logical Expert children。
- `logicalExpertId`、`physicalExpertId`、`ownerGlobalRank`、`epRank` 分字段表达。模型结构固定 logical child；EPLB 冗余、物理副本和 owner 属于 runtime overlay。
- Router 到 Routed Experts、Routed Experts 到 Combine 可使用父级聚合边避免 512 条常驻边造成视觉噪声；选中某个 Expert 时再显示其受控路由关系。
- E193 等 runtime Expert 通过同一 canonical child ID 与 Router 指标、EP placement、Expert Compute 事件联动，不经过 `slot 23` 之类显示层别名中转。

### 14.5 前端渲染与交互责任

1. 前端不再用 `layerHtml()`、页面私有 DOM builder 或 preset 构建 Pangu 正视图；只消费经验证的 `model_architecture_graph.json`。
2. 正视图通过 `PtoModelGraphvizPattern.renderController(...)` 渲染。若保留 3D / 侧视 Layer 栈，它只负责层导航；打开 Layer 的正视结构必须来自同一 canonical graph。
3. 模块和算子使用共享 capsule；Tensor / Parameter / State 使用 renderer 的圆角矩形。颜色只通过 `modelArchitectureColormap` 和 semantic color key 解析。
4. 展开 Cluster 使用透明背景、`--radius-xl` 16 px 圆角、右上角 fold control，尺寸由可见 child bounds 推导；不添加阴影、页面私有填充色或重复父节点。
5. 默认 depth-2 折叠，解析后的 decoder 主链自上而下；Parameter / Weight 放左侧，State / Cache 放右侧，只保留真实并行分支。
6. decoder mHC 残差以四路 bundle / port-aware edge 表达；Attention 内部 MoME residual 使用另一 edge semantic，两者不共用一条“Residual”快捷线。
7. 选中 timeline 的 Router、EP Dispatch、Expert Compute 或 Combine 事件时，仅通过 canonical binding 进行 selected/related 高亮，不重布局或自动 fit；当前 viewport transform 必须保持。
8. architecture asset 缺失、hash 不匹配或 binding 无效时显示不可用状态，不回退到手写 openPangu preset。

### 14.6 契约与验收门禁

后端 / 离线产物门禁：

- source hash 或 config hash 改变时，生成结果必须显式变更；相同输入必须逐字一致。
- 所有 node/edge 端点有效，节点类型符合 Module / Op / State / Input / Output 语义，数字和 shape 不写入 node label。
- residual golden test 至少覆盖 mHC on/off、Attention post/pre 交接、FFN post/pre 交接以及 Q/KV/O MoME 局部 residual，并证明不存在悬空 skip edge。
- 全量 Expert child 数与 symbol table 的 `E` 一致；当 `E=256` 时 ID 集合恰好为 E0–E255，不允许 72 个 placeholder 通过。
- 通信分支必须由 source branch + runtime policy 解析；同一场景不能同时激活互斥的 MoE 通信策略。
- 运行 `validate_model_architecture.py`、投影器和 `validate_modelviz_layout.py`，节点重叠、Cluster 越界、非法 color key 和 edge tag 碰撞都是发布失败。

前端与联调门禁：

- 用两个 architecture fixture 验证更换模型后不需修改页面 JS/CSS。
- 折叠 `Routed Experts` 后再展开，256 个 Expert 身份、排序和选中状态不丢失。
- 从 E193 Expert Compute 事件可定位到 E193 child，再反向定位到同一 Layer / EP Group / owner Rank；左右读取同一实体 ID。
- 残差边在父 Module 折叠、Layer 展开、Expert 展开后仍连到合法端点，不穿过无关节点或 Cluster 标题。
- 浅色 / 深色、适配、拖动、Command/Ctrl-wheel 缩放、键盘 focus 和 Inspector 通过 canonical viewport 浏览器验收，控制台无错误。
- 静态扫描不得再出现正式入口所依赖的手写 `expertPoolHtml()`、`72 experts`、固定 Pangu 节点坐标或页面私有 node color。

### 14.7 前后端交付面

| 角色 | 交付 | 不负责 |
| --- | --- | --- |
| 后端 / 离线 producer | source-checked architecture、边与端口、条件分支、256 logical Experts、三份模型产物、hash 与 contract 校验 | 页面布局、颜色、展开动画和 timeline 选中状态 |
| 前端 | 加载/验证产物、Pattern adapter、折叠/展开、Expert 方块矩阵、Inspector、跨视图联动和视觉规范 | 猜测算子、补造连线、修改 Expert 数量、决定运行时通信策略 |
| 联调 | architecture asset ID/hash、canonical node ID、timeline `modelBindings`、Expert ID 和 runtime placement 闭环 | 使用 label 字符串、方块序号或页面坐标作为实体身份 |

## 15. 纠偏实施顺序

### Phase 0：冻结错误扩散

- 保留现有 v4 作为本地交互原型，不继续增加场景硬编码和视觉特例。
- 删除或关闭任何将 Pattern preview metric 描述成事故数据的入口。

### Phase 1：重建契约

- 明确页面版本与 contract 版本的独立关系，统一 schema `$id`、文件名和 contract API 命名。
- 补齐第 13.3 节的数据域和第 13.6 节的语义校验。
- 增加第 14 节的 architecture asset identity、Expert parent/child、residual port 和 runtime branch 契约。
- 先完成 negative tests，再生成新 artifact。

### Phase 2：重建 producer

- 先从 openPangu 源码重新生成并校验 canonical architecture 三份产物。
- 将 openPangu 模型依据、训练 topology 和事故脚本拆为独立输入配置。
- 由一个 generator 同时生成 timeline、routing、metrics、placement 和 binding。
- 验证 artifact 可复现、无手工修改漂移。

### Phase 3：改造 Pattern adapter

- `moe-routing` 仅消费 `buildMoeRoutingInput(dataset)`，移除 `incident-routing-data.js`。
- `model-architecture-training-sidecar` 注入 canonical architecture graph 以及同一 timeline artifact 的 Stage、topology 和 snapshots；无 runtime 数据时只显示 source-checked 结构。
- 移除 Pangu 正视图的手写 `layerHtml()` / `expertPoolHtml()` 事实层，展开 Layer 和 Routed Experts 统一走 `model-graphviz` controller。
- 时间轴继续消费同一 dataset，不维护另一个实体命名空间。

### Phase 4：清理前端硬编码

- 将 HTML 改成纯容器和加载态。
- DP、Stage、Layer、EP Group、Rank、Expert、incident 和 graph binding 全部数据驱动。
- 修正 Forward/Backward 窗口与 Stage 控件的过滤一致性。

### Phase 5：恢复联动与异常表达

- 先验证 Event → Layer → Model Node → Expert → Rank 的 ID 闭环。
- 再验证 decoder mHC 四路 residual、Attention 内部 MoME residual 和 Routed Experts 全量 child 展开。
- 再实现 baseline、异常边界、因果连线和状态可发现性。
- 视觉规则继续遵守第 5、10、11 节，不能为修数据问题新增页面私有 Pattern。

### Phase 6：验收与真实数据接入

- 通过第 13.7 节全部门禁。
- 使用第二 fixture 证明前端与 openPangu 场景解耦。
- 最后增加真实 Profiling adapter；在实测 provenance 完整前持续显示“模拟事故”。

## 16. 参考

- 场景依据：`Profiling_Insight_and_Tool/training-run-twin-standalone/定位链-openPangu-2.0-Flash.md`
- 同事 fork 目录：<https://github.com/LoveBearandDonkey/compute-graph-viewer-wzh/tree/main/Profiling_Insight_and_Tool>
- 专家负载与 EP All-to-All 参考：`Profiling_Insight_and_Tool/training-run-twin-standalone/training-monitoring-v2.html`
- 当前页面规格：`training-structure-time-v2-spec.md`
- 当前时间轴契约：`training-timeline.schema.json`、`timeline-contract.js`
- PTO Pattern：`swimlane-task`、`model-graphviz`、`model-architecture-training-sidecar`、`moe-routing`、`communication-traffic-sankey`
- openPangu canonical architecture：`vendor/pto-design-system/patterns/model-graphviz/assets/openpangu_2_0_flash_model_architecture.json`
- openPangu 源码验证：`vendor/pto-design-system/patterns/model-graphviz/assets/openpangu_2_0_flash_model_architecture_validation.md`
- DeepSeek 源码解析与分级渲染参考：`vendor/pto-design-system/patterns/model-architecture-training-sidecar/pattern.ds32-report-architecture-data.js`

## 17. 实施记录

### 2026-09-11 · Phase 1A · architecture 事实层

状态：已完成；后续 timeline contract 与前端 adapter 已继续实施。

- 新增 source/config-checked 生成器 `generate-openpangu-architecture-assets.cjs`，默认只生成内存结果，仅 `--write` 更新产物。
- 产出 `data/openpangu-2.0-flash/model_architecture.json`、`model_architecture_graph.json` 和 `model_architecture_validation.md`。
- `Routed Experts` 已从单个 `FusedMoE` Op 更正为父 Module，完整包含 E000–E255；物理 Expert、owner Global Rank 和 EP Rank 保留为 runtime overlay 字段。
- decoder mHC 的 `residual` / `h_post` / `h_res` 与 Q/KV/O MoME 局部 residual 已分开建边；`use_mhc=false` 的普通 Add 为独立互斥分支。
- AllReduce、AllGather/ReduceScatter、All-to-All-v、Dispatch/Combine 和 fused path 保留为五个互斥 source branch，静态模型产物不自行选中任何运行时策略。
- 本阶段门禁：5 个针对性 Node 测试通过；`validate_model_architecture.py` 无错误、无警告；`validate-architecture-graph.mjs --require-semantic-port-policy` 通过。

### 2026-09-11 · Phase 1B · 单一 timeline artifact

状态：已完成。

- `training-timeline.v4` schema 已补齐架构资产 identity/hash、显式 world-size policy、运行时模型分支、Expert placement、Router metric、Expert load 和 model binding。
- `generate-openpangu-incident-data.cjs` 改为纯 `generate(config, sources)` producer，仅 `--write` 写入；timeline、placement、metric、事件与架构 binding 由同一产物输出。
- `2048` 是场景配置中的显式输入，前端不再通过并行维度相乘推断；正式 artifact 完整覆盖 DP0 的 256 个可见 Rank。
- E193 明确绑定 R215 / EP23；Top1 assignment 数量守恒，TopK copy 与 routing weight 未采集时保持 `null`，不再伪造 token route。

### 2026-09-11 · Phase 1C · canonical graph UI adapter

状态：已完成首轮可见实现，进入产品确认。

- 左侧已从固定 preset iframe 改为 `PtoModelGraphvizPattern.renderController(...)` 直接渲染 timeline 声明的 canonical architecture asset。
- 正式入口已移除 `incident-routing-data.js`、`PtoMoeRouting`、renderer alias 和 `R0–R127 placement slot` 解释；页面只读消费 timeline 与 architecture 两份有显式 hash/binding 的产物。
- Layer 选择器、事件→Layer/模型节点定位、Routed Experts 折叠/展开和 E193→R215/EP23 反查使用同一 canonical ID。
- Routed Experts 展开为 E0–E255 全量 child 方块；E193 的 placement 与 Top1 load 作为 runtime overlay 附着到 canonical `expert_193`，不修改模型结构事实。
- 运行时只显示 `dispatch_combine` 通信分支；`use_mhc=true` residual 条件边由 architecture edge 直接投影。
- 门禁结果：架构与 timeline/adapter 共 16 项 Node 测试通过；canonical viewport headless browser 验证默认态、异常 Dispatch 定位、256 Expert 展开、E193 选择，控制台零 error/warning。

### 2026-09-11 · Phase 1C.1 · 架构概览语义主干纠偏

状态：语义验证已完成；实现路径已被 Phase 1C.2 取代，不作为最终 UI 方案。

- 修复“结构概览把完整 Decoder Layer 折叠后，只剩 Embedding→Decoder→Norm/Head”的错误投影。
- 概览现在以 canonical 节点直接展示 Embedding、Sparse MLA Attention、Dense MLP / MoE FFN、Attention Residual Merge、FFN Residual Merge、Final Norm 与 LM Head。
- 概览连线由 canonical edge 的真实可达路径收缩生成，并保留 `projectedFromEdgeIds`；不在页面新增虚构算子或手写业务连线。
- 当前运行分支为 `use_mhc=true`：源码调用 `mHCPost(hidden_states, h_post, residual, h_res)`，因此 UI 使用 Residual Merge，而不错误标成普通 Add；`use_mhc=false` 时仍使用 artifact 中独立的 Residual Add 节点。
- 增加概览语义主干测试后，总门禁为 17 项；浏览器复测默认概览、异常 Dispatch 定位、256 Expert 展开与 E193 选择，控制台零 error/warning。

### 2026-09-11 · Phase 1C.2 · Pattern-first 架构正视图纠偏

状态：独立 Pattern 已确认并接入 v4；进入产品页联动确认。

- v3 左侧的真实渲染来源是独立的 DeepSeek 架构正视图：它拥有模型上下文、Layer 选择、嵌套 Attention / FFN Module、残差轨道、父子展开和专用布局；它不是业务页内一组普通 `model-graphviz` 节点。
- v4 首轮直接调用底层 `PtoModelGraphvizPattern.renderController(...)`，并在 `training-view-adapters-v4.js` 中手写 `mainRows`、坐标与拓扑分层。该做法虽然可验证 canonical ID 和边来源，但把 v3 的视觉与交互契约留在业务层之外，造成架构图轮廓、层级、残差表达和展开行为明显漂移。
- 最终实现必须先抽出/泛化独立的 schema-driven 模型架构正视图 Pattern。Pattern 负责：模型上下文与 Layer 切片布局、Module 嵌套、残差多流轨道、折叠/展开、Routed Experts 方块矩阵、Fit/Pan/Zoom、选中与关联强调；业务页面不得复制这些几何和 renderer 逻辑。
- Pattern 输入只接收结构与状态数据：canonical architecture graph、独立 view schema、active runtime branch、selected Layer、selected canonical node / Expert 以及 runtime overlay；模型层数、算子名、Expert 数量、分支选择和 placement 不写入 Pattern 源码。
- openPangu view schema 由架构 producer 从 source-checked 节点与边生成；前端只校验并转交。不得继续在 `training-view-adapters-v4.js` 中维护 Pangu 专用 `mainRows`、固定坐标或临时边收缩规则。
- 第一道可见验收只看独立 Pattern 页面：需与 v3 保持同一种正视图视觉语法，同时准确展示 openPangu 的 Embedding、Sparse MLA Attention、Dense/MoE FFN、mHC Residual Merge、Final Norm、LM Head 和 Routed Experts 父子结构。
- 独立 Pattern 通过确认后，v4 改为薄接入层，仅负责 timeline 事件到 Layer / node / Expert 的状态联动；接入前不再对 v4 当前架构图追加页面私有样式或布局补丁。
- 已在 PTO 设计系统新增 `model-architecture-front-view`：`pattern.js` 只实现 `model_architecture_front_view.v1` 布局/交互，不含 openPangu 模型事实；`pattern.pangu-preview-data.js` 单独提供 L0–L45、Dense/MoE、mHC ×4 和 256 Experts 的预览数据。
- standalone 预览默认打开 L38 MoE：Routed Experts 作为父 Module 展开为 256 个 canonical child 方块，E193 使用独立选中态；切换 L0/L1 后只显示 Dense MLP，并禁用 Routed Experts 控件。
- Pattern 已登记到 `patterns/patterns.json`、`design-system-preview.html`、`references/DESIGN.md` 和 quick reference；13 项布局/契约断言、深浅色、折叠/展开、Dense/MoE 切换及 1512×982 浏览器验收通过。
- 产品走查后补齐正视图视觉契约：Weight / Cache / Input / Output 使用圆角灰色 Tensor 节点；算子使用统一固定宽度；Module 折叠按钮复用 v3 的无描边弱底色样式；mHC residual state、merge 与四路 rail 统一为蓝色；Attention、Dense FFN、MoE Router/Expert、Embedding、Norm、Head 按模块语义使用固定色系；Token IDs 回到主干中心线。
- residual rail 由所属 mHC Module 的边界决定 lane，不再因内部 Routed Experts 展开而穿过 Expert 方块矩阵。Position IDs 与 RoPE / KV Cache 作为 Sparse FlashAttention 的左右侧向 Tensor 输入，与目标算子垂直居中对齐并水平入边。Decoder Layer 的实例选择器使用独立的 repeat header 高度，首个算子必须位于选择器热区之外；该轮独立预览以 27 项 Pattern 契约测试完成确认。
- 产品确认后，v4 已加载共享 `model-architecture-front-view` CSS/JS，并移除旧 adapter 的 `mainRows`、节点坐标、拓扑分层和直接 `PtoModelGraphvizPattern.renderController(...)` 调用。业务层只把 canonical architecture、Layer 分支、Expert placement/load 和选择状态适配为 `model_architecture_front_view.v1`；Pattern 负责全部几何与交互。
- v4 默认进入事故 Layer L38；页面 Layer 下拉框与图内 46 个 Layer 圆点双向切换同一状态。MoE Layer 可展开 E000–E255，E193 保留 R215 / EP23 runtime overlay；Dense L0/L1 不生成 MoE/Expert 结构。异常 EP Dispatch 通过显式 view alias 定位 Router Gate，并沿 Pattern 结构关联 Routed Experts，不伪造 Dispatch 为模型算子。
- 联合门禁：Pattern 29 项契约断言；openPangu architecture + timeline + v4 adapter 17/17 测试通过；本地浏览器验证 L38 默认态、L0 Dense 切换、E193 展开/选择与 Dispatch→Router 定位均通过。
- 第二轮产品走查移除左侧重复的页面级 Layer 下拉和“适配”按钮，Layer 选择只保留在架构图 Pattern 内。四项常驻 Router 指标收敛为 `Top1 Expert` 与 `Owner` 两项定位证据；`Top1 Idle`、`Load CV` 下沉到异常事件详情的 Router 负载证据区。
- 展开/收起链路实测本身可工作，但窄面板全图缩放使 SVG 控件过小且暗色弱底几乎不可见。修复落在共享 Pattern：toggle 底色改为随前景色适配深浅主题，并使用 non-scaling 透明命中描边与图标描边，保持 v3 无可见边框样式同时扩大实际点击区域；Pattern 契约测试增至 31 项。
- 页面下拉框激活态不得使用单侧 `inset` 描边；四边统一使用 1px `--primary` 边框，避免左边框视觉加粗。

---
name: timeline-swimlane-analyzer
description: 面向 Ascend Profiling timeline（trace_view.json / msprof_*.json 及 db 中带 startNs/endNs 的区间表）的"泳道时序结构"分析技能。专门补齐聚合统计型 skill 无法给出的几何派生指标——关键路径（最长链路）、计算-通信重叠率、算子利用率（AI Core time-based）、泳道空挡比例、PP 流水线 bubble 率、step 间抖动、通信抖动（逐 step 通信 CV）、per-step 周期归一，以及推理 prefill/decode 时序拆解。
keywords: [timeline, 泳道, swimlane, trace_view, 关键路径, critical-path, 最长链路, 重叠率, overlap, bubble, 气泡, 空挡, gap, 间隔, 抖动, jitter, 通信抖动, comm_jitter, 算子利用率, op_utilization, AI Core, 长尾, prefill, decode, PP, 流水线]
metadata:
  type: skill
---

# Timeline 泳道时序结构分析

> 本 skill 给 AI 阅读。它**不重复**现有聚合统计型 skill 的能力，而是从 timeline 的"泳道几何结构"（区间起止、相邻间隙、跨泳道重叠）推导一类无人覆盖的指标。当用户问题落在"关键路径 / 重叠 / 空挡 / 气泡 / 抖动 / 链路最长"这类**时序结构**问题时触发。

## 技能目标

从带时间轴的 timeline 数据中，量化下列其他 skill 无法直接给出的结构性指标，并按"是否在关键路径上"对优化收益排序：

1. 关键路径（最长链路）与各类耗时在关键路径上的占比
2. 计算-通信重叠率 + 跨泳道对齐间隙
3. **算子利用率**（AI Core time-based）+ 泳道空挡比例（按泳道排名）
4. Host/Device 与 CPU/IO 重叠（下发瓶颈 & 数据加载阻塞）
5. 流水线并行 PP bubble 率
6. step 间抖动 / 长尾 + **通信抖动**（逐 step 通信 CV）+ per-step 周期归一
7. 真·热点定位（最高单任务，按关键路径加权，而非裸耗时）
8. 推理时序补充（prefill / decode 分离、TTFT / TPOT）

## 与其他 skill 的边界（避免重复）

| 已有能力 | 归属 skill | 本 skill **不**重复 |
|---|---|---|
| 算子 TopK 裸耗时 | `ascend_pytorch_profiler_db_explorer` | 本 skill 只在其结果上叠"是否落在关键路径"加权 |
| 各维度耗时占比、free_analysis | `msprof-analyze-cli` | 本 skill 做**泳道粒度**的空挡/重叠，而非整卡聚合 |
| 慢卡 / 慢链路 | `cluster-fast-slow-rank-detector` | 本 skill 补 step 间**抖动/长尾**（单 rank 时间维度），非跨 rank |
| MFU / FLOPs-based 计算利用率 | `op-mfu-calculator` / `performance-health-score` | 本 skill 算 **time-based 算子利用率**（AI Core 忙时/step 跨度），不算 FLOPs-based MFU；两者互补——time-based 看"是否有空泡"，MFU 看"空泡之外算子跑得有多快" |
| Host 下发瓶颈定性 | `cluster-fast-slow-rank-detector` / dispatch_view | 本 skill 量化 host↔device **重叠率**与 launch gap 分布 |

> 当问题本质是"哪个算子最耗时 / 通信带宽多少 / 是不是慢卡"时，**不要用本 skill**，回到对应聚合 skill。本 skill 只回答"时序结构"类问题。

## 触发条件

用户问题包含或等价于：关键路径 / 最长链路 / 串行链 / 计算通信有没有重叠 / 通信被不被掩盖 / 暴露通信 / 泳道空挡 / 哪条泳道最闲 / 算子利用率 / AI Core 利用率 / 算力有没有被打满 / 流水线气泡 / PP bubble / step 抖动 / 通信抖动 / 通信不稳定 / 长尾 step / 周期性掉速 / prefill decode 拆分 / TTFT / TPOT。

## 数据来源

| 来源 | 用途 | 关键字段 |
|---|---|---|
| `trace_view.json` / `msprof_*.json` | 主来源：每个事件 = 一个区间，`pid/tid` = 泳道 | `ts`(起), `dur`(时长), `pid`, `tid`, `name` |
| trace_view 中的 **`Overlap Analysis`** 轨道 | Ascend 已预生成的计算/通信/free 重叠分解，**优先直接读** | Computing / Communication(Not Overlapped) / Free |
| `ascend_pytorch_profiler_*.db` 区间表 | 大数据量时替代 json 做几何计算 | `TASK`/`COMMUNICATION_OP`/`CANN_API`/`PYTORCH_API` 的 `startNs`/`endNs` |
| `step_trace_time.csv` / `analysis.db.StepTraceTime` | step 边界、每 step 计算/通信/free | 逐 step 拆分、抖动统计 |

> trace_view 重点泳道（进程）：**Python（host 下发）、CANN、Ascend Hardware（device 计算）、Communication/HCCL、Overlap Analysis**。泳道 = 一个 `pid`（或 `pid+tid`）。

---

## 分析脚本 timeline_geometry.py（本 skill 自带，优先调用）

维度 1/2/3/6 中"区间几何"可程序化的部分，**先用本 skill 的 `scripts/timeline_geometry.py` 一次性算出**，再由 AI 在结果上做定性与举证。纯标准库，无第三方依赖。

```bash
# 基础：泳道空挡排名 + 重叠率 + 关键路径近似（输入单个 rank 的 trace_view.json）
python <本技能目录>/scripts/timeline_geometry.py <trace_view.json> --top 10

# 叠加 step 抖动/长尾分析（再传该 rank 的 step_trace_time.csv）
python <本技能目录>/scripts/timeline_geometry.py <trace_view.json> \
       --step-trace <step_trace_time.csv> --top 10

# 结构化输出（供后续脚本/报告引用）
python <本技能目录>/scripts/timeline_geometry.py <trace_view.json> --json
```

- `<本技能目录>` 用 `get_skill` 返回的路径替换；中间产物按 `profiling-workflow` 规则 3 落到报告目录，**不得**写入原始 profiling 目录。
- 泳道归类默认正则：计算泳道 `Ascend Hardware|NPU|AI Core|Device`，通信泳道 `Communication|HCCL`，可用 `--device-regex` / `--comm-regex` 覆盖。
- 脚本直接给出：**[维度3]** 各泳道忙时/空挡%/最大间隔/间隙P95、**[维度2]** 重叠率与暴露通信（优先读 trace 内 `Overlap Analysis` 轨道，无则区间交集回退）、**[维度1]** 关键路径忙时并集近似及占比、**[维度6]** step CV/P95/长尾序号，并对越线项打 `⚠`。
- **脚本只算"几何近似"**：关键路径是忙时并集（无依赖边），重叠率依赖 `Overlap Analysis` 轨道的 `Communication` 桶语义（视为总通信）。脚本输出的所有桶值均打印，AI 必须结合 Timeline 视图人工校正，不能照单全收。
- 脚本**不覆盖**的维度（4 host-bound 对齐判定、5 PP bubble、7 关键路径热点加权、8 prefill/decode），仍按下文算法由 AI 结合数据判断。

---

## 核心分析维度

每个维度给出：**定义 → 算法（可落地）→ 判读阈值 → 举证视图**。所有时间统一换算为 ms。

### 1. 关键路径（最长链路）

- **定义**：从 step 开始到 step 结束，由"有依赖/前后衔接的区间"串成的最长一条耗时链。它决定 step time 下界——**不在关键路径上的耗时，压了也不省**。
- **算法**：
  1. 取一个稳定 step 内的所有区间（优先用 Ascend Hardware + Communication 两条 device 泳道，叠加 host 下发依赖）。
  2. 按 device 执行流（stream）串接：同一 stream 内区间天然串行；跨 stream 用依赖边（计算→其输出被通信消费）连接。
  3. 求加权最长路径（每个节点权 = `dur`）。无显式依赖时，退化为"device 上任一时刻至少有一个区间在跑"的**忙时并集长度**作为关键路径近似。
  4. 关键路径耗时 ÷ step 总耗时 = **关键路径占比**；理想趋近 100%（说明无空泡）。
- **各类耗时在关键路径上的占比**：对关键路径上的节点，按 name 归类（CUBE/VECTOR/通信/FA/free/PP-P2P…），得到"**关键路径上**的耗时构成"——这才是优化靶子，区别于全局裸占比。
- **判读**：关键路径占比 < 80% → 存在大量可掩盖空泡，优先做重叠（维度 2/4）；关键路径上通信占比高 → 通信未被掩盖（维度 2）。
- **举证视图**：Timeline 视图（系统调优）— `trace_view.json`，沿 device 主 stream 追最长连续链。

### 2. 计算-通信重叠率 + 跨泳道对齐间隙

- **定义**：通信区间被计算区间在时间上覆盖的比例。**未被覆盖的通信 = 暴露通信（exposed communication）**，直接进关键路径。跨泳道对齐间隙 = 一条泳道的区间结束到它依赖的另一泳道区间开始之间的等待空隙。
- **算法（优先走 Overlap Analysis 轨道）**：
  - 若 trace_view 有 `Overlap Analysis` 轨道：直接读 `Communication(Not Overlapped)` 总时长 ÷ 通信总时长 = **暴露通信比例**；`1 - 暴露比例` = 重叠率。
  - 无该轨道时手算：`重叠时长 = Σ overlap(计算区间集, 通信区间集)`（两组区间求交集并集），`重叠率 = 重叠时长 ÷ 通信总时长`。
  - 跨泳道对齐间隙：对每条依赖边，`gap = 下游区间.ts − 上游区间.(ts+dur)`，统计 gap 总和与 TopN。
- **判读**：重叠率 < 70%（TP/DP 梯度同步场景）→ 通信掩盖不足，是头号抓手，常见根因：通信流与计算流未并发、依赖过紧、`overlap_comm` 开关未开、micro-batch 太少。
- **举证视图**：Timeline 视图（系统调优）— `trace_view.json`，对齐 Ascend Hardware 与 Communication 两条泳道，看通信块下方是否有计算块覆盖。

### 3. 算子利用率 + 泳道空挡比例

- **定义**：
  - **算子利用率（op_utilization）**：device 计算泳道（Ascend Hardware / AI Core / NPU）所有区间忙时并集 ÷ step 总跨度。纯 time-based，不依赖 FLOPs，直接反映"算力有没有被使用"。
  - **泳道空挡比例**：单条泳道上"无区间覆盖"的总时长占 (泳道末−泳道首) 的比例，按比例对各泳道排名，找出最空闲泳道。
- **算法**：
  1. **算子利用率**：
     - 收集所有匹配 device 泳道正则（`Ascend Hardware|NPU|AI Core|Device`）的区间，做区间并集（merge overlapping intervals）。
     - `op_utilization = busy_union_us ÷ step_span_us`；step_span = timeline 内 gstart→gend（一个稳定 step 的跨度，建议先 per-step 归一取典型 step）。
     - 脚本 `timeline_geometry.py --json` 的 `op_util.op_utilization` 直接输出此值。
  2. **泳道空挡比例**：
     - 对每条泳道：`忙时 = 区间并集长度`，`空挡比例 = 1 − 忙时 ÷ span`，按空挡比例降序排名，输出 Top N。
     - 记录相邻间隙 P95（用于判断是偶发还是持续性空档）。
- **判读**：
  - `op_utilization < 60%` → 算力大量空置；结合关键路径占比（维度 1）和泳道空挡排名定位根因：若空挡集中在 device 计算泳道 → PP bubble / 通信阻塞 / host 下发不及（转维度 4/5）。
  - 泳道空挡区分"**本该闲**"（非瓶颈泳道）与"**异常等待**"（device 计算泳道空挡 > 10%）。
- **举证视图**：Timeline 视图（系统调优）— `trace_view.json`，定位 Ascend Hardware 泳道空白段，向上看同时刻 host 在做什么。

### 4. Host/Device 与 CPU/IO 重叠（下发瓶颈 & 数据加载）

- **定义**：device 泳道的规律性小间隙是否对齐到 host 下发（Python/CANN 泳道）——判 **host-bound**；以及 dataloader/IO 是否与计算重叠——判数据加载阻塞。
- **算法**：
  1. host-bound：取 device 泳道每个 gap，回看同一时刻 host（Python/CANN）泳道是否正好在 `launch`/同步 API 上。若 device gap 与 host launch 高度对齐且周期性出现 → host 下发跟不上。量化 `launch gap 总和 ÷ step`。
  2. CPU/IO 重叠：把 dataloader / H2D 拷贝区间与首个计算区间比对，看是否串行（IO 结束后计算才开始）。
- **判读**：host launch gap 占比 > 5% → host-bound，方向：绑核、减小算子下发量（融合/图模式）、消除 host 同步点。IO 与计算不重叠且占比可观 → 开预取 / 增大 prefetch / pin memory。
- **举证视图**：Timeline 视图（系统调优）— `trace_view.json`，过滤 host 侧 `launch`，看其与 device task 之间的 Free Time 间隙是否周期对齐。

### 5. 流水线并行 PP bubble 率

- **定义**：流水线并行下，某 stage 因等待上/下游 micro-batch 而空闲（warmup/cooldown 三角区 + 中段气泡）占 step 的比例。
- **算法**：
  1. 识别 PP P2P 泳道（send/recv 通信，name 含 `Send`/`Recv`/P2P group）。
  2. 在 device 计算泳道上，落在两个相邻 micro-batch 计算之间、且与 P2P 等待对齐的空隙即 bubble。
  3. `bubble 率 = bubble 总时长 ÷ step 总时长`。理论 bubble ≈ `(pp_size − 1) / (pp_size − 1 + num_microbatch)`，拿实测对比理论。
- **判读**：实测远大于理论 → micro-batch 数偏少 / stage 切分不均（某 stage 计算明显长）/ 重计算放大正向。方向：增大 num_microbatch、均衡 stage 切分、用 interleaved/1F1B 调度。
- **举证视图**：Timeline 视图（系统调优）— `trace_view.json`，看各 PP rank 计算块之间的三角空白与 P2P 等待。

### 6. step 间抖动 / 通信抖动 / 长尾 + per-step 周期归一

- **定义**：
  - **step 抖动（step_cv）**：各 step 总耗时的离散度，CV = std/mean。
  - **通信抖动（comm_jitter）**：逐 step 通信耗时的 CV，独立于 step 总耗时抖动，专门衡量通信时延的稳定性。
  - **长尾 step**：超过 P95 或 1.5×median 的异常 step。
  - **per-step 周期归一**：把 timeline 折叠到典型 step，剔除一次性事件污染。
- **算法**：
  1. 从 `step_trace_time.csv` 取每 step 总耗时列，算 `mean / P50 / P95 / max / CV`；脚本 `timeline_geometry.py --step-trace <csv>` 的 `jitter.cv` 即 step_cv。
  2. **通信抖动**：同一 CSV，取 `Communication(Not Overlapped)` 列（优先）或 `Communication` 列，收集每 step 通信时长 `{c_i}`，`comm_jitter = std({c_i}) / mean({c_i})`；脚本输出 `comm_jitter.cv`。若该列缺失则标注 N/A。
  3. 标出长尾 step（> P95 或 > 1.5×median），回到 timeline 看该 step 多了什么（ckpt / eval / GC / 通信重传）。
  4. **per-step 归一**：选中位耗时那个 step 做维度 1–5 的结构分析，避免首 step、编译 step、save step 把全局最大值带偏。
- **判读**：
  - `step_cv > 10%` → 训练不稳定，先治抖动再谈单 step 优化；周期性长尾 → 多半是 ckpt/eval/GC（host 侧）。
  - `comm_jitter > 15%` → 通信时延不稳定，即使 step 整体 CV 正常也可能存在周期性通信慢；常见根因：慢链路、跨交换机拥塞、HCCL 重传、某 rank 内存分配干扰。应结合 `cluster-fast-slow-rank-detector` 跨 rank 维度交叉验证。
  - `step_cv` 低但 `comm_jitter` 高 → 通信抖动被计算掩盖，是潜在风险；`comm_jitter` 低但 `step_cv` 高 → 抖动来自计算侧（GC / host 调度 / 非稳态 kernel）。
- **举证视图**：Timeline 视图（系统调优）— `trace_view.json`，对长尾 step 与典型 step 做并排对比；通信抖动问题加看通信视图（communication_matrix.json）。

### 7. 真·热点定位（最高单任务，按关键路径加权）

- **定义**：在维度 1 的关键路径基础上，重排"最该优化的单任务/阶段"——不是裸耗时最大，而是 `落在关键路径的耗时 × 出现次数`。
- **算法**：对 TopK 裸耗时算子（来自 `ascend_pytorch_profiler_db_explorer` 的 compute_view 结果），逐个判断是否在关键路径区间内；在 → 计入真热点；不在（被并行掩盖）→ 降权。输出"关键路径热点榜"。
- **判读**：裸耗时榜首若不在关键路径（如能与计算并发的通信），优化它收益接近 0；应优先打关键路径榜首。
- **举证视图**：算子视图（裸耗时榜）+ Timeline 视图（系统调优）交叉印证是否在关键路径。

### 8. 推理时序补充（prefill / decode 分离）

> 仅推理 / 服务化场景启用。训练场景跳过本维度。

- **定义**：推理 timeline 需按 **prefill（算力 bound）/ decode（访存 bound）** 分段，二者瓶颈不同，混在一起看会误判。
- **算法**：
  1. 按请求边界切分，首 token 前的连续计算段 = prefill，之后逐 token 段 = decode。
  2. `TTFT = 请求进入 → 首 token 产出`；`TPOT = (总时延 − TTFT) ÷ (输出 token 数 − 1)`。
  3. decode 段重点看 batching 空泡（continuous batching 的空隙）、KV cache 相关搬运、FlashAttention 在 decode 的访存效率。
- **判读**：prefill 主导 → 算力/算子效率优化；decode 主导 → 提高 batch 利用率、KV cache 命中、访存优化。
- **举证视图**：Timeline 视图（服务化调优）— `chrome_tracing.json` + `profiler.db`，看请求调度与每阶段耗时。

---

## 诊断先验知识库（Expert Rules，供 README 聚合）

| 问题 | 现象 | 定性 | 动作或建议 |
|---|---|---|---|
| 空泡多但单算子不慢 | 关键路径占比 < 80%，device 泳道空挡比例高 | 结构性空泡：算力被等待饿死，而非算子本身慢 | 先做重叠（维度 2/4），不要急着优化单算子 |
| 通信未被掩盖 | Overlap Analysis 中 `Communication(Not Overlapped)` 占比高，或重叠率 < 70% | 暴露通信进入关键路径 | 开启通信-计算并发、放宽依赖、增大 micro-batch；检查通信流是否独立 stream |
| device 周期性小间隙 | device gap 与 host `launch`/同步 API 周期对齐，launch gap 占比 > 5% | Host-bound（下发跟不上），单看 device 看不出 | 绑核、算子融合/图模式减少下发条数、消除 host 同步点 |
| PP bubble 偏大 | 实测 bubble 率远大于 `(p-1)/(p-1+m)` 理论值 | micro-batch 少 / stage 切分不均 / 重计算放大 | 增大 num_microbatch、均衡 stage、interleaved 1F1B |
| step 抖动大 | step 耗时 CV > 10% 或存在 >1.5×median 的长尾 step | 训练不稳定，全局最大值被异常 step 污染 | 先 per-step 归一取典型 step 再分析；周期长尾排查 ckpt/eval/GC |
| 裸热点优化无效 | TopK 耗时榜首不在关键路径 | 该任务可被并行掩盖，压它不省 step | 改打"关键路径热点榜"榜首 |
| 算力大量空置 | op_utilization < 60%，device 泳道有大段空白 | AI Core 被饿死：空泡 / PP bubble / host 下发不及 / 通信阻塞 | 对照关键路径占比和维度 4/5 定位具体原因；不要只看算子耗时排名 |
| step CV 正常但通信不稳定 | step_cv < 10% 但 comm_jitter > 15% | 通信抖动被计算掩盖，是潜在故障信号 | 结合 cluster-fast-slow-rank-detector 查慢链路 / HCCL 重传；comm_jitter 持续高时须排查物理链路 |
| 推理 prefill/decode 混判 | 用整体 timeline 看推理，瓶颈结论摇摆 | 两阶段瓶颈不同（算力 vs 访存） | 按请求边界拆 prefill/decode，分别用 TTFT / TPOT 归因 |

---

## 输出对接

- **报告骨架**：本 skill 产物按 `profiling-workflow/SKILL.md` 规则 1 的 5 章骨架填入，结构性发现进第 2 章行动清单 / 第 3 章问题详情的"证据"字段，**不单独成章**。
- **与 PHS 的关系**：本 skill 的"关键路径占比 / 重叠率 / 空挡比例"可作为 `performance-health-score` 中**调度效率、通信效率**子项的佐证与优化后预估依据，但**不改 PHS 公式**。
- **每个问题点必附举证视图**：调用 `msinsight-view-selector`，本 skill 的结构性问题默认映射到 **Timeline 视图（系统调优）**，热点类辅以算子视图，推理类用 Timeline 视图（服务化调优）。
- **时间单位**：原始 ns/μs 一律换算为 ms 后写入证据字段。
- **指标看板数据块（MUST）**：本 skill 算出的结构化指标，除写入报告正文外，**必须**按 `profiling-workflow/SKILL.md` 规则 7 在报告末尾追加可见 Markdown 表格，供 MindStudioNext 总览页"指标看板"消费。键名对应：`critical_path_ratio` / `op_utilization` / `overlap_ratio` / `host_launch_gap_ratio` / `pp_bubble_ratio` / `step_cv` / `max_lane_idle` / `comm_jitter`；`timeline_geometry.py --json` 的 `critical_path.critical_path_ratio`、`op_util.op_utilization`、`overlap.overlap_ratio`、`jitter.cv`（即 `step_cv`）、`comm_jitter.cv` 可直接映射，未测得的键整行省略（看板留空）。

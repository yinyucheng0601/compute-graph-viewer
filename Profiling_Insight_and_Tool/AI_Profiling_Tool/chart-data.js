// chart-data.js — 由 data/extract.js 自动生成，请勿手动修改
// 生成时间: 2026-06-02T08:51:31.487Z
// 真实数据来源:
//   r20260526: data/level2/rank_{0,2}/ASCEND_PROFILER_OUTPUT/{kernel_details,op_statistic}.csv
//   r20260528: data/eta_eager_l1/.../ASCEND_PROFILER_OUTPUT/kernel_details.csv
//   r20260602verl:  data/verl/.../ascend_pytorch_profiler_0.db (COMPUTE_TASK_INFO+TASK+TASK_PMU_INFO)
//   r20260527: 硬编码回退（simulator bin 格式不含 OP 汇总统计）
/* eslint-disable */

window.SWIMLANE_DATA = {
  // ── r20260618pp: profile_dir 2 节点 × 4 卡 PP4·DP2（Timeline 为依据报告指标的人工语义重建）─────
  // 数据来源: Analysis Report/profile_dir_profiling_analysis_20260618/evidence/{rank0_s0_ubuntu122,rank6_s3_localhost}/trace_view.json
  // 单位 us（单步 ~10.80 s = 10,800,000 us）；semanticLabel 仅用 Fwd/Bwd-Compute/PP-Bubble/P2P-Send/P2P-Recv/DP-Collective/Optimizer/Free
  r20260618pp: {
    // 3.1 PP 末级过载：stage0(rank0) 计算 ~6.3s 后在 P2P recv 空等 ~3.77s，stage3(rank6) 计算 ~9.45s 几乎不等
    1: {
      source: 'evidence/rank0_s0_ubuntu122 + rank6_s3_localhost/trace_view.json（ClusterTimeSummary step4：stage3 计算 9454ms vs stage0 6326ms，空等 3.77s）',
      data: [
        { blockIdx:0, coreType:'rank 0 (ubuntu122) · PP stage0 · 计算 6.3s → 空等末级 3.77s', tasks:[
          { taskId:1, subGraphId:0, execStart:0,        execEnd:3162000,  semanticLabel:'Fwd-Compute',   taskName:'前向 · Transformer Blocks (3162ms)' },
          { taskId:2, subGraphId:0, execStart:3162000,  execEnd:3163000,  semanticLabel:'P2P-Send',      taskName:'hcom_batchSendRecv_ · 发送激活值→stage1 (1ms)' },
          { taskId:3, subGraphId:0, execStart:3163000,  execEnd:6938000,  semanticLabel:'PP-Bubble',     taskName:'hcom_batchSendRecv_ · Wait 3775ms ← 空等末级 lm_head+loss（communicationWaitStageTime≈3.77s / 占 step ~35%）' },
          { taskId:4, subGraphId:0, execStart:6938000,  execEnd:10100000, semanticLabel:'Bwd-Compute',   taskName:'反向 · Transformer Blocks 梯度 (3162ms)' },
          { taskId:5, subGraphId:0, execStart:10100000, execEnd:10716000, semanticLabel:'DP-Collective', taskName:'hcom_allReduce_ DP 梯度 + P2P 传输 (776ms · Overlapped=0 全暴露)' },
          { taskId:6, subGraphId:0, execStart:10716000, execEnd:10800000, semanticLabel:'Free',          taskName:'空闲 (84ms)' },
        ]},
        { blockIdx:1, coreType:'rank 6 (localhost) · PP stage3 末级 · 计算 9.45s（多算 3.11s）', tasks:[
          { taskId:11, subGraphId:0, execStart:0,       execEnd:4727000,  semanticLabel:'Fwd-Compute',   taskName:'前向 · Blocks + lm_head fwd + MatMulV2 logits 16ms×64≈1024ms（末级独有）(4727ms)' },
          { taskId:12, subGraphId:0, execStart:4727000, execEnd:9454000,  semanticLabel:'Bwd-Compute',   taskName:'反向 · lm_head dgrad MatMulV2 + loss vector 算子（耗时为 stage0 ~1.6×）(4727ms)' },
          { taskId:13, subGraphId:0, execStart:9454000, execEnd:9846000,  semanticLabel:'PP-Bubble',     taskName:'P2P 等待仅 392ms（末级几乎不等）' },
          { taskId:14, subGraphId:0, execStart:9846000, execEnd:10546000, semanticLabel:'DP-Collective', taskName:'hcom_allReduce_ + P2P 实际传输 (700ms)' },
          { taskId:15, subGraphId:0, execStart:10546000,execEnd:10800000, semanticLabel:'Free',          taskName:'空闲 (254ms)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 3163000, endTime: 6938000, label: 'stage0 空等 ~3.77s（占 step ~35%）= 末级多算的 3.11s 直接转成 bubble' },
        { type: 'task',  tid: 0, taskId: 3 },
      ],
    },
    // 3.2 Overlapped=0：反向结束才串行起 DP allreduce，通信全暴露在关键路径
    2: {
      source: 'evidence/rank0_s0_ubuntu122/trace_view.json + step_trace_time.csv（communicationOverlapComputation=0.0）',
      data: [
        { blockIdx:0, coreType:'rank 0 · 计算→通信全串行（Overlapped=0，暴露通信 4389ms）', tasks:[
          { taskId:1, subGraphId:0, execStart:0,       execEnd:3162000, semanticLabel:'Bwd-Compute',   taskName:'反向计算 (3162ms) — 期间无任何通信重叠' },
          { taskId:2, subGraphId:0, execStart:3162000, execEnd:4102000, semanticLabel:'DP-Collective', taskName:'hcom_allReduce_ 大梯度 940ms ← 反向结束才串行开始（应可隐藏到反向后）' },
          { taskId:3, subGraphId:0, execStart:4102000, execEnd:7877000, semanticLabel:'PP-Bubble',     taskName:'hcom_batchSendRecv_ · P2P recv 暴露等待 3775ms（含 stage 等待）' },
          { taskId:4, subGraphId:0, execStart:7877000, execEnd:8653000, semanticLabel:'DP-Collective', taskName:'P2P 实际传输 776ms（同样全暴露）' },
          { taskId:5, subGraphId:0, execStart:8653000, execEnd:8737000, semanticLabel:'Free',          taskName:'空闲 (84ms)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 3162000, endTime: 4102000, label: 'DP allReduce 完全暴露（Overlapped=0，可重叠却未重叠）' },
        { type: 'task',  tid: 0, taskId: 2 },
      ],
    },
    // 3.3 环境变量未设置：aclnn/host 缓存偏小 → host 侧 Tiling/launch 间隙增多（局部放大）
    3: {
      source: 'evidence/rank0_s0_ubuntu122/trace_view.json（host 侧 *_Tiling/launch 间隙 · ACLNN_CACHE_LIMIT/HOST_CACHE_CAPACITY 未设的基线）',
      data: [
        { blockIdx:0, coreType:'rank 0 (host 下发段) · 缓存偏小 → launch 间隙偏多（局部放大）', tasks:[
          { taskId:1, subGraphId:0, execStart:0,      execEnd:800000,  semanticLabel:'Fwd-Compute', taskName:'正常异步下发段 (800ms)' },
          { taskId:2, subGraphId:0, execStart:800000, execEnd:950000,  semanticLabel:'Free',        taskName:'*_Tiling/launch 间隙 (150ms · aclnn 缓存未命中、重复 host 编译/下发)' },
          { taskId:3, subGraphId:0, execStart:950000, execEnd:1750000, semanticLabel:'Fwd-Compute', taskName:'下发段 (800ms)' },
          { taskId:4, subGraphId:0, execStart:1750000,execEnd:1900000, semanticLabel:'Free',        taskName:'launch 间隙 (150ms · HOST_CACHE_CAPACITY 偏小)' },
          { taskId:5, subGraphId:0, execStart:1900000,execEnd:2700000, semanticLabel:'Fwd-Compute', taskName:'下发段 …（设缓存环境变量后该间隙收窄）' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 800000, endTime: 950000, label: 'aclnn/host 缓存偏小 → 算子下发间隙（设 ACLNN_CACHE_LIMIT/HOST_CACHE_CAPACITY 后缓解）' },
        { type: 'task',  tid: 0, taskId: 2 },
      ],
    },
  },
  // ── r20260715pangu: pangu2.0flash 72B 4 节点×8 卡 TP1·PP4·EP4·DP2（Timeline 为依据报告指标的人工语义重建）──
  // 数据来源: Analysis Report/pangu2.0flash_profiling_analysis_20260715/evidence/{rank0_s0_node1,rank8_s1_node2,rank24_s3_node4}/trace_view.json
  // 单位 us（单步 ~16.20 s = 16,200,000 us）；semanticLabel 仅用 Fwd/Bwd-Compute/PP-Bubble/P2P-Send/P2P-Recv/DP-Collective/Optimizer/Free
  r20260715pangu: {
    // 3.1 PP 末级过载：stage0(rank0) 计算 ~8.15s 后在 P2P recv 空等 ~4.45s，stage3(rank24) 计算 ~12.90s 几乎不等
    1: {
      source: 'evidence/rank0_s0_node1 + rank24_s3_node4/trace_view.json（ClusterTimeSummary step4：stage3 计算 12900.4ms vs stage0 8150.2ms，空等 4450.3ms）',
      data: [
        { blockIdx:0, coreType:'rank 0 (node1) · PP stage0 · 计算 8.15s → 空等末级 4.45s', tasks:[
          { taskId:1, subGraphId:0, execStart:0,        execEnd:4075100,  semanticLabel:'Fwd-Compute',   taskName:'前向 · 12 层 Transformer/MoE Blocks (4075ms)' },
          { taskId:2, subGraphId:0, execStart:4075100,  execEnd:8150200,  semanticLabel:'Bwd-Compute',   taskName:'反向 · 梯度计算 (4075ms)' },
          { taskId:3, subGraphId:0, execStart:8150200,  execEnd:8151200,  semanticLabel:'P2P-Send',      taskName:'hcom_batchSendRecv_ · 发送激活值→stage1 (1ms)' },
          { taskId:4, subGraphId:0, execStart:8151200,  execEnd:12600500, semanticLabel:'PP-Bubble',     taskName:'hcom_batchSendRecv_ · Wait 4449.3ms ← 空等末级 lm_head+loss+深层 MoE（communicationWaitStageTime≈4.26s 均值 / 占 step ~26%）' },
          { taskId:5, subGraphId:0, execStart:12600500, execEnd:15950700, semanticLabel:'DP-Collective', taskName:'hcom_allReduce_ DP 梯度 + EP all-to-all + P2P 实际传输 (3350.2ms · Overlapped=0 全暴露)' },
          { taskId:6, subGraphId:0, execStart:15950700, execEnd:16200000, semanticLabel:'Free',          taskName:'空闲 (249.3ms)' },
        ]},
        { blockIdx:1, coreType:'rank 24 (node4) · PP stage3 末级 · 计算 12.90s（多算 4.41s）', tasks:[
          { taskId:11, subGraphId:0, execStart:0,        execEnd:6450200,  semanticLabel:'Fwd-Compute',   taskName:'前向 · 12 层 MoE Blocks + lm_head fwd · MatMulV2 [4608→153600] 20.0ms×64≈1280ms（末级独有）(6450ms)' },
          { taskId:12, subGraphId:0, execStart:6450200,  execEnd:12900400, semanticLabel:'Bwd-Compute',   taskName:'反向 · lm_head dgrad + loss 反向 GEMM（224×9984×9984，~500ms 级）+ vector 算子（RmsNorm/ElementWise，耗时为 stage0 ~1.5×）(6450ms)' },
          { taskId:13, subGraphId:0, execStart:12900400, execEnd:13400500, semanticLabel:'PP-Bubble',     taskName:'P2P 等待仅 500.1ms（末级几乎不等）' },
          { taskId:14, subGraphId:0, execStart:13400500, execEnd:15900700, semanticLabel:'DP-Collective', taskName:'hcom_allReduce_ + EP all-to-all + P2P 实际传输 (2500.2ms)' },
          { taskId:15, subGraphId:0, execStart:15900700, execEnd:16200000, semanticLabel:'Free',          taskName:'空闲 (299.3ms)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 8151200, endTime: 12600500, label: 'stage0 空等 ~4.45s（占 step ~26%）= 末级多算的 4.41s 直接转成 bubble' },
        { type: 'task',  tid: 0, taskId: 4 },
      ],
    },
    // 3.2 EP all-to-all 零重叠：MoE 层 dispatch/combine all-to-all 与 expert FFN 计算完全串行（放大单层周期便于观察）
    2: {
      source: 'evidence/rank8_s1_node2/trace_view.json（HcclPerRankStats：hcom_all_to_all_v_ 88 次/step，forward dispatch 均值 18ms、backward combine 均值 12ms，communicationOverlapComputation=0.0）',
      data: [
        { blockIdx:0, coreType:'rank 8 (node2) · MoE 层 L12 all-to-all 与 expert FFN 计算零重叠（Overlapped=0）', tasks:[
          { taskId:1, subGraphId:0, execStart:0,     execEnd:2000,  semanticLabel:'Fwd-Compute',   taskName:'Router gate 计算 + 本地已到 token 的 expert FFN 准备 (2ms)' },
          { taskId:2, subGraphId:0, execStart:2000,  execEnd:20000, semanticLabel:'DP-Collective', taskName:'hcom_all_to_all_v_ dispatch（token 分发到目标 expert，均值 18ms）— 无计算重叠' },
          { taskId:3, subGraphId:0, execStart:20000, execEnd:22000, semanticLabel:'Bwd-Compute',   taskName:'expert FFN 计算（gate_proj/up_proj/down_proj），等 dispatch 完全到达才开始 (2ms)' },
          { taskId:4, subGraphId:0, execStart:22000, execEnd:34000, semanticLabel:'DP-Collective', taskName:'hcom_all_to_all_v_ combine（回收 expert 输出/梯度，均值 12ms）— 无计算重叠' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 2000, endTime: 34000, label: 'EP all-to-all 完全暴露（Overlapped=0），44 层累计 ~1.32s/step，可隐藏 60–80%' },
        { type: 'task',  tid: 0, taskId: 2 },
      ],
    },
    // 3.3 全局零重叠：DP allreduce + PP P2P + EP all-to-all 全部与计算串行，无任何掩盖
    3: {
      source: 'evidence/rank0_s0_node1/trace_view.json + step_trace_time.csv（communicationOverlapComputation=0.0，32 卡全）',
      data: [
        { blockIdx:0, coreType:'rank 0 · 计算→通信全串行（Overlapped=0 全 32 卡）', tasks:[
          { taskId:1, subGraphId:0, execStart:0,       execEnd:3350200, semanticLabel:'Bwd-Compute',   taskName:'反向计算收尾 (3350ms) — 期间无任何通信重叠' },
          { taskId:2, subGraphId:0, execStart:3350200, execEnd:4500200, semanticLabel:'DP-Collective', taskName:'hcom_allReduce_ DP 梯度同步 1150ms（rank0 SumNs~1.15s/2step）← 反向结束才串行开始' },
          { taskId:3, subGraphId:0, execStart:4500200, execEnd:4649200, semanticLabel:'PP-Bubble',     taskName:'hcom_batchSendRecv_ PP P2P 实际传输 149ms（48 层×2 累计）' },
          { taskId:4, subGraphId:0, execStart:4649200, execEnd:5969200, semanticLabel:'DP-Collective', taskName:'hcom_all_to_all_v_ EP dispatch+combine 1320ms（44 层累计，同样全暴露）' },
          { taskId:5, subGraphId:0, execStart:5969200, execEnd:6218500, semanticLabel:'Free',          taskName:'空闲 (249.3ms)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 3350200, endTime: 5969200, label: '计算-通信零重叠（Overlapped=0）：DP allreduce + PP P2P + EP all-to-all 全部串行暴露' },
        { type: 'task',  tid: 0, taskId: 2 },
      ],
    },
    // 3.5 环境变量未设置：aclnn/host 缓存偏小 → MoE expert 算子下发间隙增多（局部放大）
    5: {
      source: 'evidence/rank0_s0_node1/trace_view.json（host 侧 *_Tiling/launch 间隙 · ACLNN_CACHE_LIMIT/HOST_CACHE_CAPACITY 未设的基线，44 层×192 个 expert FFN 算子/step）',
      data: [
        { blockIdx:0, coreType:'rank 0 (host 下发段) · 缓存偏小 → MoE expert 算子下发间隙偏多（局部放大）', tasks:[
          { taskId:1, subGraphId:0, execStart:0,      execEnd:800000,  semanticLabel:'Fwd-Compute', taskName:'正常异步下发段 (800ms)' },
          { taskId:2, subGraphId:0, execStart:800000, execEnd:950000,  semanticLabel:'Free',        taskName:'*_Tiling/launch 间隙 (150ms · aclnn 缓存未命中，MoE expert 算子下发抖动放大)' },
          { taskId:3, subGraphId:0, execStart:950000, execEnd:1750000, semanticLabel:'Fwd-Compute', taskName:'下发段 (800ms)' },
          { taskId:4, subGraphId:0, execStart:1750000,execEnd:1900000, semanticLabel:'Free',        taskName:'launch 间隙 (150ms · HOST_CACHE_CAPACITY 偏小)' },
          { taskId:5, subGraphId:0, execStart:1900000,execEnd:2700000, semanticLabel:'Fwd-Compute', taskName:'下发段 …（设缓存环境变量后该间隙收窄）' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 800000, endTime: 950000, label: 'aclnn/host 缓存偏小 → MoE expert 算子下发间隙（设 ACLNN_CACHE_LIMIT/HOST_CACHE_CAPACITY 后缓解）' },
        { type: 'task',  tid: 0, taskId: 2 },
      ],
    },
  },
  // ── r20260526: PP=2/DP=2 训练 ──────────────────────────────────────────
  r20260526: {
    // 3.1 PP气泡：rank_0等rank_2 LM Head+CE计算，158ms气泡
    1: {
      source: 'trace_view.json (rank_0 / rank_2)',
      data: [
        { blockIdx:0, coreType:'rank_0 · PP Stage 0', tasks:[
          { taskId:1,  subGraphId:0, execStart:0,      execEnd:115000,  semanticLabel:'Fwd-Compute',   taskName:'前向计算 · 14 Transformer Blocks (115ms)' },
          { taskId:2,  subGraphId:0, execStart:115000, execEnd:115436,  semanticLabel:'P2P-Send',      taskName:'hcom_batchSendRecv__128_3 · 发送激活值→rank_2 (0.4ms)' },
          { taskId:3,  subGraphId:0, execStart:115436, execEnd:273989,  semanticLabel:'PP-Bubble',     taskName:'hcom_batchSendRecv__128_4 · Wait 158.1ms (99.7%) ← rank_2 LM Head+CE链路未结束' },
          { taskId:4,  subGraphId:0, execStart:273989, execEnd:390279,  semanticLabel:'Bwd-Compute',   taskName:'反向计算 · Transformer Blocks梯度 (116ms)' },
          { taskId:5,  subGraphId:0, execStart:390279, execEnd:545167,  semanticLabel:'P2P-Recv',      taskName:'hcom_batchSendRecv__128_5 · P2P 154.9ms (Idle)' },
          { taskId:6,  subGraphId:0, execStart:545167, execEnd:645203,  semanticLabel:'Optimizer',     taskName:'优化器 ApplyAdamWV2×57 (100ms)' },
          { taskId:7,  subGraphId:0, execStart:645203, execEnd:671512,  semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter__097_4 (26.3ms, HCCS 18.5GB/s)' },
          { taskId:8,  subGraphId:0, execStart:674872, execEnd:693461,  semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter__097_5 (18.6ms)' },
          { taskId:9,  subGraphId:0, execStart:693465, execEnd:728089,  semanticLabel:'DP-Collective', taskName:'hcom_allReduce__170_1 (34.6ms)' },
          { taskId:10, subGraphId:0, execStart:766646, execEnd:778664,  semanticLabel:'DP-Collective', taskName:'hcom_allGather__097_6 (12.0ms)' },
          { taskId:11, subGraphId:0, execStart:778669, execEnd:787165,  semanticLabel:'DP-Collective', taskName:'hcom_allGather__097_7 (8.5ms)' },
          { taskId:12, subGraphId:0, execStart:787165, execEnd:810022,  semanticLabel:'Free',          taskName:'空闲 (22.9ms)' },
        ]},
        { blockIdx:1, coreType:'rank_2 · PP Stage 1', tasks:[
          { taskId:13, subGraphId:0, execStart:0,      execEnd:115000,  semanticLabel:'Free',          taskName:'等待rank_0激活值 (115ms)' },
          { taskId:14, subGraphId:0, execStart:115000, execEnd:115436,  semanticLabel:'P2P-Recv',      taskName:'接收rank_0激活值 (0.4ms)' },
          { taskId:15, subGraphId:0, execStart:115436, execEnd:273989,  semanticLabel:'Fwd-Compute',   taskName:'前向计算 · Blocks + LM Head MatMulV3 2×18.4ms (MIX_AIC) (158ms) ← 与rank_0气泡完全重叠' },
          { taskId:16, subGraphId:0, execStart:273989, execEnd:274425,  semanticLabel:'P2P-Send',      taskName:'发梯度→rank_0 · rank_0气泡在此结束 (0.4ms)' },
          { taskId:17, subGraphId:0, execStart:274425, execEnd:516320,  semanticLabel:'Bwd-Compute',   taskName:'反向计算 · CE串行(Exp+Sub+RealDiv ~80ms)+剩余梯度 (241.9ms)' },
          { taskId:18, subGraphId:0, execStart:516320, execEnd:542629,  semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter (26.3ms)' },
          { taskId:19, subGraphId:0, execStart:545989, execEnd:564578,  semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter (18.6ms)' },
          { taskId:20, subGraphId:0, execStart:564582, execEnd:599206,  semanticLabel:'DP-Collective', taskName:'hcom_allReduce (34.6ms)' },
          { taskId:21, subGraphId:0, execStart:637763, execEnd:649781,  semanticLabel:'DP-Collective', taskName:'hcom_allGather (12.0ms)' },
          { taskId:22, subGraphId:0, execStart:649786, execEnd:658282,  semanticLabel:'DP-Collective', taskName:'hcom_allGather (8.5ms)' },
          { taskId:23, subGraphId:0, execStart:658282, execEnd:809803,  semanticLabel:'Free',          taskName:'空闲 (151.5ms)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 115000, endTime: 273989, label: '158ms PP气泡' },
        { type: 'task',  tid: 0, taskId: 3 },
      ],
    },
    // 3.5 PP反向接收完后DP collective串行，未与P2P重叠
    5: {
      source: 'trace_view.json (rank_0, 以反向开始为T=0)',
      data: [
        { blockIdx:0, coreType:'rank_0 · 反向 → DP collective（当前串行）', tasks:[
          { taskId:1, subGraphId:0, execStart:0,      execEnd:116290,  semanticLabel:'Bwd-Compute',   taskName:'反向计算 Transformer Blocks (116ms)' },
          { taskId:2, subGraphId:0, execStart:116290, execEnd:271178,  semanticLabel:'P2P-Recv',      taskName:'hcom_batchSendRecv__128_5 · Idle 154.9ms — 等rank_2梯度返回' },
          { taskId:3, subGraphId:0, execStart:271178, execEnd:371214,  semanticLabel:'Optimizer',     taskName:'优化器 ApplyAdamWV2×57 (100ms)' },
          { taskId:4, subGraphId:0, execStart:371214, execEnd:397523,  semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter__097_4 (26.3ms) ← 严格在优化器后串行开始' },
          { taskId:5, subGraphId:0, execStart:400883, execEnd:419472,  semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter__097_5 (18.6ms)' },
          { taskId:6, subGraphId:0, execStart:419476, execEnd:454100,  semanticLabel:'DP-Collective', taskName:'hcom_allReduce (34.6ms)' },
          { taskId:7, subGraphId:0, execStart:492657, execEnd:504675,  semanticLabel:'DP-Collective', taskName:'hcom_allGather__097_6 (12.0ms)' },
          { taskId:8, subGraphId:0, execStart:504680, execEnd:513176,  semanticLabel:'DP-Collective', taskName:'hcom_allGather__097_7 (8.5ms)' },
          { taskId:9, subGraphId:0, execStart:513176, execEnd:536033,  semanticLabel:'Free',          taskName:'空闲 (22.9ms)' },
        ]},
      ],
      annotations: [
        { type: 'point', time: 371214, label: '串行→DP等优化器结束' },
        { type: 'task',  tid: 0, taskId: 4 },
      ],
    },
  },

  // ── r20260527: MatmulLeakyRelu simulator (ns 为单位) ─────────────────
  r20260527: {
    // 3.1 cube写GM → vec再读GM，LeakyRelu未融合
    1: {
      source: 'visualize_data.bin (simulator, cubecore0 + veccore0/1)',
      data: [
        { blockIdx:0, coreType:'cubecore0', tasks:[
          { taskId:1, subGraphId:0, execStart:0,     execEnd:36000,  semanticLabel:'Fwd-Compute', taskName:'MMAD batch 1 (36ns)' },
          { taskId:2, subGraphId:0, execStart:36000, execEnd:56000,  semanticLabel:'PP-Bubble',   taskName:'WAIT_FLAG · 等MTE2填L1 (20ns bubble)' },
          { taskId:3, subGraphId:0, execStart:56000, execEnd:72800,  semanticLabel:'Fwd-Compute', taskName:'MMAD batch 2 (16.8ns)' },
          { taskId:4, subGraphId:0, execStart:72800, execEnd:97900,  semanticLabel:'P2P-Send',    taskName:'FIXP FIX_L0C_TO_DST → GM 写出 2.62MB (25.1ns) ← 触发vec路径' },
          { taskId:5, subGraphId:0, execStart:97900, execEnd:112600, semanticLabel:'Free',        taskName:'core结束 (14.7ns)' },
        ]},
        { blockIdx:1, coreType:'veccore0 (等cube Fixpipe → 读GM → VLRELU)', tasks:[
          { taskId:6,  subGraphId:0, execStart:0,      execEnd:97900,  semanticLabel:'Free',          taskName:'等待cubecore0 Fixpipe完成 (97.9ns)' },
          { taskId:7,  subGraphId:0, execStart:97900,  execEnd:119900, semanticLabel:'P2P-Recv',      taskName:'MTE2 GM→UB 1.31MB (22ns) ← 读cube落盘的矩阵C' },
          { taskId:8,  subGraphId:0, execStart:119900, execEnd:126500, semanticLabel:'Fwd-Compute',   taskName:'VECTOR VLRELU (6.6ns, 仅占span 7%) ← 真正计算极短' },
          { taskId:9,  subGraphId:0, execStart:126500, execEnd:195700, semanticLabel:'DP-Collective', taskName:'MTE3 UB→GM (69.2ns)' },
        ]},
        { blockIdx:2, coreType:'veccore1 (等cube Fixpipe → 读GM → VLRELU)', tasks:[
          { taskId:10, subGraphId:0, execStart:0,      execEnd:97900,  semanticLabel:'Free',          taskName:'等待cubecore0 Fixpipe完成 (97.9ns)' },
          { taskId:11, subGraphId:0, execStart:97900,  execEnd:119900, semanticLabel:'P2P-Recv',      taskName:'MTE2 GM→UB 1.31MB (22ns)' },
          { taskId:12, subGraphId:0, execStart:119900, execEnd:126500, semanticLabel:'Fwd-Compute',   taskName:'VECTOR VLRELU (6.6ns)' },
          { taskId:13, subGraphId:0, execStart:126500, execEnd:212300, semanticLabel:'DP-Collective', taskName:'MTE3 UB→GM (85.8ns) ← 比veccore0多16.6ns → 见3.5不均衡' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 0,     endTime: 97900, label: '97.9ns跨die等待窗口' },
        { type: 'task',  tid: 0, taskId: 4 },
        { type: 'task',  tid: 1, taskId: 6 },
        { type: 'task',  tid: 2, taskId: 10 },
      ],
    },
    // 3.2 CUBE流水65%，MMAD在等L1
    2: {
      source: 'visualize_data.bin (simulator, cubecore0 CUBE + MTE2)',
      data: [
        { blockIdx:0, coreType:'CUBE Pipeline (MMAD · 65% util)', tasks:[
          { taskId:1, subGraphId:0, execStart:0,     execEnd:36000,  semanticLabel:'Fwd-Compute', taskName:'MMAD batch 1 (36ns)' },
          { taskId:2, subGraphId:0, execStart:36000, execEnd:56000,  semanticLabel:'PP-Bubble',   taskName:'WAIT_FLAG · 等MTE2填L0 (20ns bubble) ← SET_FLAG 566>440次' },
          { taskId:3, subGraphId:0, execStart:56000, execEnd:72800,  semanticLabel:'Fwd-Compute', taskName:'MMAD batch 2 (16.8ns)' },
          { taskId:4, subGraphId:0, execStart:72800, execEnd:97900,  semanticLabel:'P2P-Send',    taskName:'FIXP FIX_L0C_TO_DST (25.1ns)' },
          { taskId:5, subGraphId:0, execStart:97900, execEnd:112600, semanticLabel:'Free',        taskName:'idle (14.7ns)' },
        ]},
        { blockIdx:1, coreType:'MTE2 Stream (GM→L1 ND2NZ · 持续饱和)', tasks:[
          { taskId:6, subGraphId:0, execStart:0, execEnd:112600, semanticLabel:'DP-Collective', taskName:'持续拉数: GM→L1 ND2NZ 180次×21.4KB=3.94MB, busy 263ns (233% span) → MTE1/CUBE持续等待' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 36000, endTime: 56000, label: '20ns WAIT_FLAG气泡' },
        { type: 'task',  tid: 0, taskId: 2 },
      ],
    },
    // 3.3 SCALAR pipe 44,245事件，178% span占用
    3: {
      source: 'visualize_data.bin (simulator, cubecore0 CUBE vs SCALAR)',
      data: [
        { blockIdx:0, coreType:'CUBE Pipe (MMAD · 65%)', tasks:[
          { taskId:1, subGraphId:0, execStart:0,     execEnd:72800,  semanticLabel:'Fwd-Compute', taskName:'MMAD + 等待 (72.8ns busy, 65% util)' },
          { taskId:2, subGraphId:0, execStart:72800, execEnd:97900,  semanticLabel:'P2P-Send',    taskName:'FIXP FIX_L0C_TO_DST → GM (25.1ns)' },
          { taskId:3, subGraphId:0, execStart:97900, execEnd:112600, semanticLabel:'Free',        taskName:'core空闲 (14.7ns)' },
        ]},
        { blockIdx:1, coreType:'SCALAR Pipe (44,245事件 · 201ns · 178% span)', tasks:[
          { taskId:4, subGraphId:0, execStart:0, execEnd:112600, semanticLabel:'PP-Bubble', taskName:'栈帧 LD/ST/STI/STP 为主, busy 201ns (178%span) — 与CUBE/MTE抢调度槽; line206-207占46% cycles' },
        ]},
      ],
      annotations: [
        { type: 'point', time: 97900, label: 'CUBE结束←SCALAR延续' },
        { type: 'task',  tid: 1, taskId: 4 },
      ],
    },
    // 3.5 veccore0 vs veccore1 负载不均17%
    5: {
      source: 'visualize_data.bin (simulator, veccore0 vs veccore1, 以vec计算开始为T=0)',
      data: [
        { blockIdx:0, coreType:'veccore0 (span 97.8ns)', tasks:[
          { taskId:1, subGraphId:0, execStart:0,     execEnd:22000, semanticLabel:'P2P-Recv',      taskName:'MTE2 GM→UB (22ns)' },
          { taskId:2, subGraphId:0, execStart:22000, execEnd:28600, semanticLabel:'Fwd-Compute',   taskName:'VECTOR VLRELU (6.6ns)' },
          { taskId:3, subGraphId:0, execStart:28600, execEnd:97800, semanticLabel:'DP-Collective', taskName:'MTE3 UB→GM (69.2ns)' },
        ]},
        { blockIdx:1, coreType:'veccore1 (span 114.4ns · Δ+16.6ns)', tasks:[
          { taskId:4, subGraphId:0, execStart:0,     execEnd:22000,  semanticLabel:'P2P-Recv',      taskName:'MTE2 GM→UB (22ns)' },
          { taskId:5, subGraphId:0, execStart:22000, execEnd:28600,  semanticLabel:'Fwd-Compute',   taskName:'VECTOR VLRELU (6.6ns)' },
          { taskId:6, subGraphId:0, execStart:28600, execEnd:114400, semanticLabel:'DP-Collective', taskName:'MTE3 UB→GM (85.8ns) ← 比veccore0多16.6ns，tiling尾块分配不均' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 97800, endTime: 114400, label: '+16.6ns不均衡延伸' },
        { type: 'task',  tid: 0, taskId: 3 },
        { type: 'task',  tid: 1, taskId: 6 },
      ],
    },
  },

  // ── r20260528: Eager模式推理 (μs 为单位) ─────────────────────────────
  r20260528: {
    // 3.1 NPU 92.6% idle，host逐算子下发
    1: {
      source: 'trace_view.json (代表性500μs切片，每步353个kernel)',
      data: [
        { blockIdx:0, coreType:'Host (PyTorch/CANN Launch)', tasks:[
          { taskId:1, subGraphId:0, execStart:0,   execEnd:14,  semanticLabel:'DP-Collective', taskName:'aclnn kernel launch (14μs avg)' },
          { taskId:2, subGraphId:0, execStart:14,  execEnd:168, semanticLabel:'PP-Bubble',    taskName:'Python处理 / host overhead (154μs) ← eager逐算子下发代价' },
          { taskId:3, subGraphId:0, execStart:168, execEnd:182, semanticLabel:'DP-Collective', taskName:'aclnn kernel launch (14μs)' },
          { taskId:4, subGraphId:0, execStart:182, execEnd:336, semanticLabel:'PP-Bubble',    taskName:'Python处理 / host overhead (154μs)' },
          { taskId:5, subGraphId:0, execStart:336, execEnd:350, semanticLabel:'DP-Collective', taskName:'aclnn kernel launch (14μs)' },
          { taskId:6, subGraphId:0, execStart:350, execEnd:500, semanticLabel:'PP-Bubble',    taskName:'Python处理 / host overhead (150μs)' },
        ]},
        { blockIdx:1, coreType:'Device (NPU · 7.36% busy)', tasks:[
          { taskId:7,  subGraphId:0, execStart:0,   execEnd:14,  semanticLabel:'Free',        taskName:'idle · 等待第一次launch' },
          { taskId:8,  subGraphId:0, execStart:14,  execEnd:26,  semanticLabel:'Fwd-Compute', taskName:'kernel_1 (12μs avg)' },
          { taskId:9,  subGraphId:0, execStart:26,  execEnd:182, semanticLabel:'Free',        taskName:'NPU idle (156μs) ← 92.6%时间空转' },
          { taskId:10, subGraphId:0, execStart:182, execEnd:194, semanticLabel:'Fwd-Compute', taskName:'kernel_2 (12μs)' },
          { taskId:11, subGraphId:0, execStart:194, execEnd:350, semanticLabel:'Free',        taskName:'NPU idle (156μs)' },
          { taskId:12, subGraphId:0, execStart:350, execEnd:362, semanticLabel:'Fwd-Compute', taskName:'kernel_3 (12μs)' },
          { taskId:13, subGraphId:0, execStart:362, execEnd:500, semanticLabel:'Free',        taskName:'NPU idle (138μs)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 26, endTime: 182, label: 'NPU空转156μs (92.6%idle示例)' },
        { type: 'task',  tid: 1, taskId: 9  },
        { type: 'task',  tid: 1, taskId: 11 },
        { type: 'task',  tid: 1, taskId: 13 },
      ],
    },
    // 3.3 NonZero触发D2H同步，慢step的根本触发器
    3: {
      source: 'trace_view.json (慢step示意，72ms D2H同步)',
      data: [
        { blockIdx:0, coreType:'Host (API调用)', tasks:[
          { taskId:1, subGraphId:0, execStart:0,     execEnd:50,    semanticLabel:'DP-Collective', taskName:'aclnn launch × 4 (50μs)' },
          { taskId:2, subGraphId:0, execStart:50,    execEnd:64,    semanticLabel:'DP-Collective', taskName:'aclnnNonzeroV2 launch (14μs)' },
          { taskId:3, subGraphId:0, execStart:64,    execEnd:72064, semanticLabel:'PP-Bubble',     taskName:'aclrtSynchronizeStreamWithTimeout BLOCKED (72,000μs) ← host等device返回动态shape' },
          { taskId:4, subGraphId:0, execStart:72064, execEnd:72164, semanticLabel:'DP-Collective', taskName:'拿到shape，继续launch (100μs)' },
        ]},
        { blockIdx:1, coreType:'Device (NPU)', tasks:[
          { taskId:5, subGraphId:0, execStart:0,     execEnd:50,    semanticLabel:'Fwd-Compute', taskName:'pre-NonZero kernels (50μs)' },
          { taskId:6, subGraphId:0, execStart:50,    execEnd:122,   semanticLabel:'Fwd-Compute', taskName:'NonZeroAiCore compute (72μs)' },
          { taskId:7, subGraphId:0, execStart:122,   execEnd:72064, semanticLabel:'Free',        taskName:'device idle (71,942μs) ← host blocking on D2H shape' },
          { taskId:8, subGraphId:0, execStart:72064, execEnd:72164, semanticLabel:'Fwd-Compute', taskName:'post-NonZero kernels (100μs)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 64, endTime: 72064, label: '72ms D2H同步阻塞' },
        { type: 'task',  tid: 0, taskId: 3 },
        { type: 'task',  tid: 1, taskId: 7 },
      ],
    },
    // 3.6 MemSet每步46次，workspace未复用
    6: {
      source: 'trace_view.json (代表性110μs切片)',
      data: [
        { blockIdx:0, coreType:'Device (MemSet + 算子交替 · 46次/step)', tasks:[
          { taskId:1,  subGraphId:0, execStart:0,   execEnd:10,  semanticLabel:'Optimizer',    taskName:'MemSet (workspace clear, ~10μs)' },
          { taskId:2,  subGraphId:0, execStart:10,  execEnd:22,  semanticLabel:'Fwd-Compute',  taskName:'kernel (12μs)' },
          { taskId:3,  subGraphId:0, execStart:22,  execEnd:32,  semanticLabel:'Optimizer',    taskName:'MemSet (10μs)' },
          { taskId:4,  subGraphId:0, execStart:32,  execEnd:44,  semanticLabel:'Fwd-Compute',  taskName:'kernel (12μs)' },
          { taskId:5,  subGraphId:0, execStart:44,  execEnd:54,  semanticLabel:'Optimizer',    taskName:'MemSet (10μs)' },
          { taskId:6,  subGraphId:0, execStart:54,  execEnd:66,  semanticLabel:'Fwd-Compute',  taskName:'kernel (12μs)' },
          { taskId:7,  subGraphId:0, execStart:66,  execEnd:76,  semanticLabel:'Optimizer',    taskName:'MemSet (10μs)' },
          { taskId:8,  subGraphId:0, execStart:76,  execEnd:88,  semanticLabel:'Fwd-Compute',  taskName:'kernel (12μs)' },
          { taskId:9,  subGraphId:0, execStart:88,  execEnd:98,  semanticLabel:'Optimizer',    taskName:'MemSet (10μs) ← 设ACLNN_CACHE_LIMIT=10000可消除大多数' },
          { taskId:10, subGraphId:0, execStart:98,  execEnd:110, semanticLabel:'Fwd-Compute',  taskName:'kernel (12μs)' },
        ]},
      ],
      annotations: [
        { type: 'task', tid: 0, taskId: 1 },
        { type: 'task', tid: 0, taskId: 3 },
        { type: 'task', tid: 0, taskId: 5 },
        { type: 'task', tid: 0, taskId: 7 },
        { type: 'task', tid: 0, taskId: 9 },
      ],
    },
    // 3.7 aclnnInplaceCopyGetWorkspaceSize 64ms长尾
    7: {
      source: 'trace_view.json (含64ms长尾示意)',
      data: [
        { blockIdx:0, coreType:'Host (aclnnInplaceCopyGetWorkspaceSize)', tasks:[
          { taskId:1, subGraphId:0, execStart:0,     execEnd:60,    semanticLabel:'DP-Collective', taskName:'正常调用 (60μs, 大多数情况)' },
          { taskId:2, subGraphId:0, execStart:60,    execEnd:136,   semanticLabel:'DP-Collective', taskName:'aclnnInplaceCopy (76μs)' },
          { taskId:3, subGraphId:0, execStart:136,   execEnd:64136, semanticLabel:'PP-Bubble',     taskName:'GetWorkspaceSize 长尾 (64,000μs!) ← dynamic shape路径重算workspace' },
          { taskId:4, subGraphId:0, execStart:64136, execEnd:64212, semanticLabel:'DP-Collective', taskName:'aclnnInplaceCopy (76μs)' },
        ]},
        { blockIdx:1, coreType:'Device (NPU)', tasks:[
          { taskId:5, subGraphId:0, execStart:0,     execEnd:60,    semanticLabel:'Free',        taskName:'idle (host在算workspace)' },
          { taskId:6, subGraphId:0, execStart:60,    execEnd:136,   semanticLabel:'Fwd-Compute', taskName:'InplaceCopy kernel (76μs)' },
          { taskId:7, subGraphId:0, execStart:136,   execEnd:64136, semanticLabel:'Free',        taskName:'device idle (64,000μs) ← host长尾导致queue清空' },
          { taskId:8, subGraphId:0, execStart:64136, execEnd:64212, semanticLabel:'Fwd-Compute', taskName:'InplaceCopy kernel (76μs)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 136, endTime: 64136, label: '64ms GetWorkspaceSize长尾' },
        { type: 'task',  tid: 0, taskId: 3 },
        { type: 'task',  tid: 1, taskId: 7 },
      ],
    },
    // ── verl RL 训练 & 多机多卡 入口 (swimlane 在下方) ──

    // 3.8 每步7次同步调用
    8: {
      source: 'trace_view.json (代表性640μs切片，含均值522μs的sync)',
      data: [
        { blockIdx:0, coreType:'Host (含aclrtSynchronize)', tasks:[
          { taskId:1, subGraphId:0, execStart:0,   execEnd:28,  semanticLabel:'DP-Collective', taskName:'launch kernel_1/2 (28μs)' },
          { taskId:2, subGraphId:0, execStart:28,  execEnd:42,  semanticLabel:'PP-Bubble',     taskName:'aclrtSynchronizeStream (14μs, 快速sync)' },
          { taskId:3, subGraphId:0, execStart:42,  execEnd:70,  semanticLabel:'DP-Collective', taskName:'launch kernel_3/4 (28μs)' },
          { taskId:4, subGraphId:0, execStart:70,  execEnd:592, semanticLabel:'PP-Bubble',     taskName:'aclrtSynchronizeStreamWithTimeout (522μs 均值) ← 每step 6次sync，600次由NonZero引发' },
          { taskId:5, subGraphId:0, execStart:592, execEnd:620, semanticLabel:'DP-Collective', taskName:'launch kernel_5/6 (28μs)' },
          { taskId:6, subGraphId:0, execStart:620, execEnd:634, semanticLabel:'PP-Bubble',     taskName:'aclrtSynchronizeStream (14μs)' },
        ]},
        { blockIdx:1, coreType:'Device (NPU)', tasks:[
          { taskId:7,  subGraphId:0, execStart:0,   execEnd:28,  semanticLabel:'Fwd-Compute', taskName:'kernel_1/2 (28μs)' },
          { taskId:8,  subGraphId:0, execStart:28,  execEnd:42,  semanticLabel:'Free',        taskName:'idle (sync 14μs)' },
          { taskId:9,  subGraphId:0, execStart:42,  execEnd:70,  semanticLabel:'Fwd-Compute', taskName:'kernel_3/4 (28μs)' },
          { taskId:10, subGraphId:0, execStart:70,  execEnd:592, semanticLabel:'Free',        taskName:'device idle (522μs) ← 被迫等host sync决策' },
          { taskId:11, subGraphId:0, execStart:592, execEnd:620, semanticLabel:'Fwd-Compute', taskName:'kernel_5/6 (28μs)' },
          { taskId:12, subGraphId:0, execStart:620, execEnd:634, semanticLabel:'Free',        taskName:'idle (sync 14μs)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 70,  endTime: 592,  label: '522μs同步阻塞(均值)' },
        { type: 'task',  tid: 0, taskId: 4  },
        { type: 'task',  tid: 1, taskId: 10 },
      ],
    },
  },

  // ── r20260602verl: verl RL 训练 单卡 (μs 为单位) ─────────────────────
  r20260602verl: {
    // 3.1 Rollout Eager解码，设备占用仅37%
    1: {
      source: 'ascend_pytorch_profiler_0.db (Rollout 生成阶段代表性 2000μs 切片)',
      data: [
        { blockIdx:0, coreType:'Host (CANN API · 2.8万次/s)', tasks:[
          { taskId:1, subGraphId:0, execStart:0,    execEnd:12,   semanticLabel:'DP-Collective', taskName:'vllm attention launch (12μs)' },
          { taskId:2, subGraphId:0, execStart:12,   execEnd:390,  semanticLabel:'PP-Bubble',     taskName:'Python 处理 / vllm overhead (378μs) ← Eager逐token下发代价' },
          { taskId:3, subGraphId:0, execStart:390,  execEnd:402,  semanticLabel:'DP-Collective', taskName:'vllm decode launch (12μs)' },
          { taskId:4, subGraphId:0, execStart:402,  execEnd:780,  semanticLabel:'PP-Bubble',     taskName:'Python 处理 (378μs)' },
          { taskId:5, subGraphId:0, execStart:780,  execEnd:792,  semanticLabel:'DP-Collective', taskName:'vllm attention launch (12μs)' },
          { taskId:6, subGraphId:0, execStart:792,  execEnd:1170, semanticLabel:'PP-Bubble',     taskName:'Python 处理 (378μs)' },
          { taskId:7, subGraphId:0, execStart:1170, execEnd:1182, semanticLabel:'DP-Collective', taskName:'hcom_allReduce launch (12μs) ← TP All-Reduce' },
          { taskId:8, subGraphId:0, execStart:1182, execEnd:1650, semanticLabel:'PP-Bubble',     taskName:'wait AllReduce + Python (468μs)' },
          { taskId:9, subGraphId:0, execStart:1650, execEnd:1662, semanticLabel:'DP-Collective', taskName:'vllm decode launch (12μs)' },
          { taskId:10,subGraphId:0, execStart:1662, execEnd:2000, semanticLabel:'PP-Bubble',     taskName:'Python 处理 (338μs)' },
        ]},
        { blockIdx:1, coreType:'Device (NPU · 37% busy · MAC利用率3.8%)', tasks:[
          { taskId:11, subGraphId:0, execStart:0,    execEnd:12,   semanticLabel:'Fwd-Compute',  taskName:'PagedAttentionMaskNdKernel (12μs)' },
          { taskId:12, subGraphId:0, execStart:12,   execEnd:402,  semanticLabel:'Free',         taskName:'NPU 空闲 390μs ← Eager 63%时间在这里' },
          { taskId:13, subGraphId:0, execStart:402,  execEnd:414,  semanticLabel:'Fwd-Compute',  taskName:'ReshapeAndCacheNdKernel (12μs)' },
          { taskId:14, subGraphId:0, execStart:414,  execEnd:792,  semanticLabel:'Free',         taskName:'NPU 空闲 378μs' },
          { taskId:15, subGraphId:0, execStart:792,  execEnd:804,  semanticLabel:'Fwd-Compute',  taskName:'AtbRopeKernel (12μs)' },
          { taskId:16, subGraphId:0, execStart:804,  execEnd:1182, semanticLabel:'Free',         taskName:'NPU 空闲 378μs' },
          { taskId:17, subGraphId:0, execStart:1182, execEnd:1650, semanticLabel:'P2P-Send',     taskName:'hcom_allReduce (468μs · wait 72%)' },
          { taskId:18, subGraphId:0, execStart:1650, execEnd:1662, semanticLabel:'Fwd-Compute',  taskName:'MatMulV2 (12μs)' },
          { taskId:19, subGraphId:0, execStart:1662, execEnd:2000, semanticLabel:'Free',         taskName:'NPU 空闲 338μs' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 12,   endTime: 402,  label: 'NPU空闲390μs (63%空转示例)' },
        { type: 'task',  tid: 1, taskId: 12 },
        { type: 'task',  tid: 1, taskId: 14 },
        { type: 'task',  tid: 1, taskId: 16 },
      ],
    },
    // 3.2 TP AllReduce 全暴露，wait 9.4s
    2: {
      source: 'analysis.db CommAnalyzerTime (代表性单次 AllReduce 示意)',
      data: [
        { blockIdx:0, coreType:'Host (TP=2 · 每层触发 AllReduce)', tasks:[
          { taskId:1, subGraphId:0, execStart:0,    execEnd:50,   semanticLabel:'DP-Collective', taskName:'Transformer layer compute launch (50μs)' },
          { taskId:2, subGraphId:0, execStart:50,   execEnd:62,   semanticLabel:'DP-Collective', taskName:'hcom_allReduce launch (12μs)' },
          { taskId:3, subGraphId:0, execStart:62,   execEnd:530,  semanticLabel:'PP-Bubble',     taskName:'等 AllReduce 完成 (468μs · wait 72% = 338μs) ← 完全暴露，无重叠' },
          { taskId:4, subGraphId:0, execStart:530,  execEnd:580,  semanticLabel:'DP-Collective', taskName:'下一层 compute launch (50μs)' },
        ]},
        { blockIdx:1, coreType:'Device (NPU · AllReduce 无重叠)', tasks:[
          { taskId:5, subGraphId:0, execStart:0,    execEnd:50,   semanticLabel:'Fwd-Compute',  taskName:'MatMulV2 + Activation (50μs)' },
          { taskId:6, subGraphId:0, execStart:50,   execEnd:62,   semanticLabel:'Free',         taskName:'idle (等AllReduce launch)' },
          { taskId:7, subGraphId:0, execStart:62,   execEnd:400,  semanticLabel:'P2P-Send',     taskName:'hcom_allReduce wait (338μs) ← 等对端rank' },
          { taskId:8, subGraphId:0, execStart:400,  execEnd:530,  semanticLabel:'DP-Collective', taskName:'allReduce transit (130μs)' },
          { taskId:9, subGraphId:0, execStart:530,  execEnd:580,  semanticLabel:'Fwd-Compute',  taskName:'下一层 MatMulV2 (50μs)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 62, endTime: 400, label: '338μs AllReduce wait (72%)' },
        { type: 'task',  tid: 1, taskId: 7 },
        { type: 'point', time: 530, label: 'overlap=0, 完全串行' },
      ],
    },
    // 3.3 物理内存反复申请/释放（相位切换处）
    3: {
      source: 'ascend_pytorch_profiler_0.db (rollout→train 相位切换，代表性切片)',
      data: [
        { blockIdx:0, coreType:'Host (CANN API · 相位切换)', tasks:[
          { taskId:1, subGraphId:0, execStart:0,      execEnd:5000,   semanticLabel:'DP-Collective', taskName:'Rollout 最后一批 launch (5ms)' },
          { taskId:2, subGraphId:0, execStart:5000,   execEnd:27019,  semanticLabel:'PP-Bubble',     taskName:'aclrtFreePhysical × 1 (22ms) ← KV/权重归还物理内存' },
          { taskId:3, subGraphId:0, execStart:27019,  execEnd:31869,  semanticLabel:'PP-Bubble',     taskName:'aclrtMallocPhysical × 1 (4.85ms) ← train 申请物理内存' },
          { taskId:4, subGraphId:0, execStart:31869,  execEnd:36869,  semanticLabel:'DP-Collective', taskName:'update_actor compute launch (5ms)' },
          { taskId:5, subGraphId:0, execStart:36869,  execEnd:58888,  semanticLabel:'PP-Bubble',     taskName:'aclrtFreePhysical × 1 (22ms) ← train 结束归还' },
          { taskId:6, subGraphId:0, execStart:58888,  execEnd:60000,  semanticLabel:'DP-Collective', taskName:'下一 rollout 开始 launch (1.1ms)' },
        ]},
        { blockIdx:1, coreType:'Device (NPU · 阻塞等待)', tasks:[
          { taskId:7, subGraphId:0, execStart:0,      execEnd:5000,   semanticLabel:'Fwd-Compute', taskName:'Rollout decode kernels (5ms)' },
          { taskId:8, subGraphId:0, execStart:5000,   execEnd:31869,  semanticLabel:'Free',        taskName:'NPU 空闲 26.9ms ← FreePhysical+MallocPhysical 完全阻塞' },
          { taskId:9, subGraphId:0, execStart:31869,  execEnd:36869,  semanticLabel:'Optimizer',   taskName:'update_actor kernels (5ms)' },
          { taskId:10,subGraphId:0, execStart:36869,  execEnd:58888,  semanticLabel:'Free',        taskName:'NPU 空闲 22ms ← FreePhysical 阻塞' },
          { taskId:11,subGraphId:0, execStart:58888,  execEnd:60000,  semanticLabel:'Fwd-Compute', taskName:'下一轮 rollout (1.1ms)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 5000,  endTime: 31869, label: '26.9ms 物理内存操作' },
        { type: 'task',  tid: 0, taskId: 2 },
        { type: 'task',  tid: 1, taskId: 8 },
      ],
    },
  },
  // ── r20260610: 同一份 level2/ 数据，msprof-analyze + advisor 全跑通；与 0605 同源 ─────
  // 数据来源: Analysis Report/level2_profiling_analysis_20260610/evidence/rank_{0,2}_ascend_pt/{trace_view.json,kernel_details.csv}
  r20260610: {
    // 3.1 末级（rank2）独有 vocab=151936 算子链 ~160ms（Cast→Exp→Sub→RealDiv→Mul→ReduceSum→ArgMax + 词表投影/dgrad）
    1: {
      source: 'evidence/rank_2_ascend_pt/trace_view.json（末级 step 尾部 logits/loss 段，advisor 判 vec_mte2_mte3/mte2 访存bound）',
      data: [
        { blockIdx:0, coreType:'rank 2 (dev4) · 末级独有 vocab=151936 算子链 ~160ms', tasks:[
          { taskId:1,  subGraphId:0, execStart:0,     execEnd:30000,  semanticLabel:'Fwd-Compute', taskName:'Transformer Blocks 尾段前向 (30ms)' },
          { taskId:2,  subGraphId:0, execStart:30000, execEnd:44800,  semanticLabel:'Fwd-Compute', taskName:'词表投影 MatMulV3 4096,1024;151936,1024 (14.8ms, mte2 bound)' },
          { taskId:3,  subGraphId:0, execStart:44800, execEnd:50800,  semanticLabel:'Fwd-Compute', taskName:'Cast 4096,1,151936 (6.0ms, vec_mte2_mte3 访存bound)' },
          { taskId:4,  subGraphId:0, execStart:50800, execEnd:58800,  semanticLabel:'Fwd-Compute', taskName:'Exp 4096,1,151936 (8.0ms, 访存bound)' },
          { taskId:5,  subGraphId:0, execStart:58800, execEnd:66700,  semanticLabel:'Fwd-Compute', taskName:'Sub 4096,1,151936;4096,1,1 (7.9ms)' },
          { taskId:6,  subGraphId:0, execStart:66700, execEnd:74600,  semanticLabel:'Fwd-Compute', taskName:'RealDiv 4096,1,151936 (7.9ms)' },
          { taskId:7,  subGraphId:0, execStart:74600, execEnd:81900,  semanticLabel:'Fwd-Compute', taskName:'Mul 4096,1,151936 (7.3ms)' },
          { taskId:8,  subGraphId:0, execStart:81900, execEnd:88800,  semanticLabel:'Fwd-Compute', taskName:'ReduceSum 4096,1,151936;1 (6.9ms)' },
          { taskId:9,  subGraphId:0, execStart:88800, execEnd:95600,  semanticLabel:'Fwd-Compute', taskName:'ArgMaxWithValue 4096,1,151936 (6.8ms)' },
          { taskId:10, subGraphId:0, execStart:95600, execEnd:132500, semanticLabel:'Bwd-Compute', taskName:'lm_head dgrad MatMulV3 4096,151936;151936,1024 2×18.5ms (MIX_AIC, mte2 bound)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 44800, endTime: 95600, label: 'Cast→Exp→Sub→RealDiv→Mul→ReduceSum→ArgMax 访存bound（每个把 [4096,151936] 在 HBM 往返一遍）' },
        { type: 'task',  tid: 0, taskId: 3 },
      ],
    },
    // 3.2 PP 阶段切分不均：首级 compute 231ms 后空等末级 400ms，batchSendRecv 累计空等 ~313ms
    2: {
      source: 'evidence/rank_0_ascend_pt + rank_2_ascend_pt/trace_view.json（PP 组 (0,2)，过滤 hcom_batchSendRecv）',
      data: [
        { blockIdx:0, coreType:'rank 0 (dev0) · PP 首级 · compute 231ms', tasks:[
          { taskId:1,  subGraphId:0, execStart:0,      execEnd:115000, semanticLabel:'Fwd-Compute',   taskName:'前向计算 · Transformer Blocks (115ms)' },
          { taskId:2,  subGraphId:0, execStart:115000, execEnd:115400, semanticLabel:'P2P-Send',      taskName:'hcom_batchSendRecv__128_3 · 发送激活值→rank2 (0.4ms)' },
          { taskId:3,  subGraphId:0, execStart:115400, execEnd:273900, semanticLabel:'PP-Bubble',     taskName:'hcom_batchSendRecv__128_4 · Wait 158.5ms ← 等末级 lm_head + 交叉熵链路' },
          { taskId:4,  subGraphId:0, execStart:273900, execEnd:389900, semanticLabel:'Bwd-Compute',   taskName:'反向计算 · Transformer Blocks 梯度 (116ms)' },
          { taskId:5,  subGraphId:0, execStart:389900, execEnd:544800, semanticLabel:'PP-Bubble',     taskName:'hcom_batchSendRecv__128_5 · Wait 154.9ms ← 等末级反向 loss/dgrad（首级累计空等 ~313ms / 占单步 39%）' },
          { taskId:6,  subGraphId:0, execStart:544800, execEnd:571100, semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter (26.3ms)' },
          { taskId:7,  subGraphId:0, execStart:574500, execEnd:593100, semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter (18.6ms)' },
          { taskId:8,  subGraphId:0, execStart:593100, execEnd:627700, semanticLabel:'DP-Collective', taskName:'hcom_allReduce__170 共享词嵌入 (34.6ms, 622MB)' },
          { taskId:9,  subGraphId:0, execStart:666300, execEnd:678300, semanticLabel:'DP-Collective', taskName:'hcom_allGather (12.0ms)' },
          { taskId:10, subGraphId:0, execStart:678300, execEnd:810000, semanticLabel:'Free',          taskName:'空闲 (131.7ms, 含 host/optimizer 间隙)' },
        ]},
        { blockIdx:1, coreType:'rank 2 (dev4) · PP 末级 · compute 400ms', tasks:[
          { taskId:11, subGraphId:0, execStart:0,      execEnd:115000, semanticLabel:'Free',          taskName:'等 rank0 激活值 (115ms)' },
          { taskId:12, subGraphId:0, execStart:115000, execEnd:115400, semanticLabel:'P2P-Recv',      taskName:'接收 rank0 激活值 (0.4ms)' },
          { taskId:13, subGraphId:0, execStart:115400, execEnd:273900, semanticLabel:'Fwd-Compute',   taskName:'前向 · Blocks + lm_head fwd + Cast/Exp/Sub(vocab=151936) 末级独有 ~160ms ← 与首级气泡完全重叠' },
          { taskId:14, subGraphId:0, execStart:273900, execEnd:274300, semanticLabel:'P2P-Send',      taskName:'发送→rank0 (0.4ms)' },
          { taskId:15, subGraphId:0, execStart:274300, execEnd:516200, semanticLabel:'Bwd-Compute',   taskName:'反向 · lm_head dgrad MatMulV3 2×18.5ms(MIX_AIC) + 交叉熵 Sub/RealDiv dgrad (241.9ms)' },
          { taskId:16, subGraphId:0, execStart:516200, execEnd:542500, semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter (26.3ms)' },
          { taskId:17, subGraphId:0, execStart:545900, execEnd:564500, semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter (18.6ms)' },
          { taskId:18, subGraphId:0, execStart:564500, execEnd:685500, semanticLabel:'DP-Collective', taskName:'hcom_allReduce__170 共享词嵌入 (121.0ms, 同 622MB)' },
          { taskId:19, subGraphId:0, execStart:685500, execEnd:697500, semanticLabel:'DP-Collective', taskName:'hcom_allGather (12.0ms)' },
          { taskId:20, subGraphId:0, execStart:697500, execEnd:809800, semanticLabel:'Free',          taskName:'空闲 (112.3ms)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 115400, endTime: 273900, label: '~158ms PP 级间气泡（首级空等末级 vocab loss）' },
        { type: 'task',  tid: 0, taskId: 3 },
      ],
    },
    // 3.3 Overlapped=0：DP 集合通信完全暴露在关键路径（末级反向后串行）
    3: {
      source: 'evidence/rank_2_ascend_pt/trace_view.json + step_trace_time.csv（Overlapped=0.0）',
      data: [
        { blockIdx:0, coreType:'rank 2 · 反向 → DP 集合通信（Overlapped=0，全暴露）', tasks:[
          { taskId:1, subGraphId:0, execStart:0,      execEnd:241900, semanticLabel:'Bwd-Compute',   taskName:'反向计算 (241.9ms) — 期间无任何通信重叠' },
          { taskId:2, subGraphId:0, execStart:241900, execEnd:268200, semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter (26.3ms) ← 反向结束才串行开始' },
          { taskId:3, subGraphId:0, execStart:271600, execEnd:290200, semanticLabel:'DP-Collective', taskName:'hcom_reduceScatter (18.6ms)' },
          { taskId:4, subGraphId:0, execStart:290200, execEnd:302200, semanticLabel:'DP-Collective', taskName:'hcom_allGather (12.0ms)' },
          { taskId:5, subGraphId:0, execStart:302200, execEnd:310700, semanticLabel:'DP-Collective', taskName:'hcom_allGather (8.5ms)' },
          { taskId:6, subGraphId:0, execStart:310700, execEnd:333600, semanticLabel:'Free',          taskName:'空闲 (22.9ms)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 241900, endTime: 310700, label: '~72ms 纯传输完全暴露（Overlapped=0，可重叠却未重叠）' },
        { type: 'task',  tid: 0, taskId: 2 },
      ],
    },
    // 3.4 micro-batch 数偏少：warmup/cooldown 三角空泡未被摊薄（首级视角）
    4: {
      source: 'evidence/rank_0_ascend_pt/trace_view.json（首级 P2P 仅 __*_3/_4/_5 三段，bubble 呈大块）',
      data: [
        { blockIdx:0, coreType:'rank 0 (dev0) · PP 首级 · micro-batch 少 → bubble 占比偏高', tasks:[
          { taskId:1, subGraphId:0, execStart:0,      execEnd:115000, semanticLabel:'Fwd-Compute',   taskName:'warmup · micro-batch 前向 (115ms)' },
          { taskId:2, subGraphId:0, execStart:115000, execEnd:273500, semanticLabel:'PP-Bubble',     taskName:'warmup 三角空泡 158.5ms ← (p-1)/(p-1+m)，pp=2 且 m 小时偏大' },
          { taskId:3, subGraphId:0, execStart:273500, execEnd:389800, semanticLabel:'Bwd-Compute',   taskName:'稳态反向 (116ms)' },
          { taskId:4, subGraphId:0, execStart:389800, execEnd:544700, semanticLabel:'PP-Bubble',     taskName:'cooldown 三角空泡 154.9ms ← 同因 micro-batch 少' },
          { taskId:5, subGraphId:0, execStart:544700, execEnd:600000, semanticLabel:'DP-Collective', taskName:'DP 集合通信 (55ms)' },
          { taskId:6, subGraphId:0, execStart:600000, execEnd:810000, semanticLabel:'Free',          taskName:'空闲 (210ms)' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 115000, endTime: 273500, label: 'warmup 空泡（增大 micro-batch 数可摊薄）' },
        { type: 'range', startTime: 389800, endTime: 544700, label: 'cooldown 空泡' },
        { type: 'task',  tid: 0, taskId: 2 },
      ],
    },
    // 3.5 动态 shape 算子 NonZero 触发 host 强制同步（局部放大，打断异步下发）
    5: {
      source: 'evidence/rank_2_ascend_pt/trace_view.json（aclnnNonzeroV2 count 96 · 同步类 API ~46%，局部放大）',
      data: [
        { blockIdx:0, coreType:'rank 2 (dev4) · NonZero 强制 host 同步（局部放大段）', tasks:[
          { taskId:1, subGraphId:0, execStart:0,     execEnd:15000, semanticLabel:'Fwd-Compute', taskName:'正常异步下发段 (15ms)' },
          { taskId:2, subGraphId:0, execStart:15000, execEnd:15281, semanticLabel:'Free',        taskName:'NonZero → aclrtSynchronizeDevice 强制同步 (0.28ms · host 回读、打断下发)' },
          { taskId:3, subGraphId:0, execStart:15281, execEnd:30000, semanticLabel:'Fwd-Compute', taskName:'下发段 (14.7ms)' },
          { taskId:4, subGraphId:0, execStart:30000, execEnd:30359, semanticLabel:'Free',        taskName:'NonZero host 同步 (0.36ms)' },
          { taskId:5, subGraphId:0, execStart:30359, execEnd:45000, semanticLabel:'Fwd-Compute', taskName:'下发段 (14.6ms)' },
          { taskId:6, subGraphId:0, execStart:45000, execEnd:45281, semanticLabel:'Free',        taskName:'StreamSynchronize 阻塞 (0.28ms)' },
          { taskId:7, subGraphId:0, execStart:45281, execEnd:60000, semanticLabel:'Fwd-Compute', taskName:'下发段 …（96 次 NonZero 累积放大 bubble）' },
        ]},
      ],
      annotations: [
        { type: 'range', startTime: 15000, endTime: 15281, label: 'NonZero 同步打断异步下发（×96，叠加在 bubble 上）' },
        { type: 'task',  tid: 0, taskId: 2 },
      ],
    },
    // 3.6 亲和 API 未用：optimizer 段 ApplyAdamWV2 非融合实现，kernel 数/下发偏多
    6: {
      source: 'evidence/rank_2_ascend_pt/trace_view.json（optimizer 段 ApplyAdamWV2 · AI_VECTOR_CORE ~9ms/step）',
      data: [
        { blockIdx:0, coreType:'rank 2 (dev4) · optimizer 段（可换 NpuFusedAdamW 融合接口）', tasks:[
          { taskId:1, subGraphId:0, execStart:0,     execEnd:30000, semanticLabel:'Bwd-Compute', taskName:'反向尾段 (30ms)' },
          { taskId:2, subGraphId:0, execStart:30000, execEnd:39000, semanticLabel:'Optimizer',   taskName:'ApplyAdamWV2 ×N (AI_VECTOR_CORE, 9ms) — 未用融合优化器' },
          { taskId:3, subGraphId:0, execStart:39000, execEnd:41000, semanticLabel:'Free',        taskName:'host launch 间隙 (2ms)' },
          { taskId:4, subGraphId:0, execStart:41000, execEnd:44000, semanticLabel:'Optimizer',   taskName:'TransData/Cast 非亲和实现 (3ms)' },
          { taskId:5, subGraphId:0, execStart:44000, execEnd:45500, semanticLabel:'Free',        taskName:'launch 间隙 (1.5ms)' },
        ]},
      ],
      annotations: [
        { type: 'task',  tid: 0, taskId: 2 },
      ],
    },
  },
};

window.OP_VIEW_DATA = {
  r20260526: {
    2: {
      source: "rank_2/kernel_details.csv",
      chartType: "table",
      rows: [
        {
          name: "aclnnMatmul_MatMulV3Common_MatMulV3",
          type: "MatMulV3",
          acceleratorCore: "MIX_AIC",
          duration: 18432.1,
          waitTime: 1.25,
          blockDim: 20,
          inputShapes: "4096,151936;151936,1024",
          inputDataTypes: "DT_BF16;DT_BF16",
          inputFormats: "ND;ND",
          highlight: true
        },
        {
          name: "aclnnMatmul_MatMulV3Common_MatMulV3",
          type: "MatMulV3",
          acceleratorCore: "MIX_AIC",
          duration: 18386.52,
          waitTime: 1.52,
          blockDim: 20,
          inputShapes: "4096,151936;151936,1024",
          inputDataTypes: "DT_BF16;DT_BF16",
          inputFormats: "ND;ND",
          highlight: true
        },
        {
          name: "aclnnMatmul_MatMulV3Common_MatMulV3",
          type: "MatMulV3",
          acceleratorCore: "AI_CORE",
          duration: 7415.54,
          waitTime: 283.46,
          blockDim: 20,
          inputShapes: "4096,1024;151936,1024",
          inputDataTypes: "DT_BF16;DT_BF16",
          inputFormats: "ND;ND"
        },
        {
          name: "aclnnMatmul_MatMulV3Common_MatMulV3",
          type: "MatMulV3",
          acceleratorCore: "AI_CORE",
          duration: 7389.68,
          waitTime: 294.62,
          blockDim: 20,
          inputShapes: "4096,1024;151936,1024",
          inputDataTypes: "DT_BF16;DT_BF16",
          inputFormats: "ND;ND"
        },
        {
          name: "RmsNormGrad",
          type: "RmsNormGrad",
          acceleratorCore: "MIX_AIV",
          duration: 148.16,
          waitTime: 1.52,
          blockDim: 40,
          inputShapes: "4096,1,16,128;4096,1,16,128;4096,1,16,1;128",
          inputDataTypes: "DT_BF16;DT_BF16;FLOAT;DT_BF16",
          inputFormats: "ND;ND;ND;ND"
        },
        {
          name: "RmsNormGrad",
          type: "RmsNormGrad",
          acceleratorCore: "MIX_AIV",
          duration: 147.62,
          waitTime: 1.4,
          blockDim: 40,
          inputShapes: "4096,1,16,128;4096,1,16,128;4096,1,16,1;128",
          inputDataTypes: "DT_BF16;DT_BF16;FLOAT;DT_BF16",
          inputFormats: "ND;ND;ND;ND"
        }
      ]
    },
    3: {
      source: "rank_2/kernel_details.csv (step 13)",
      byType: [
        {
          name: "Exp",
          value: 16052
        },
        {
          name: "RealDiv",
          value: 15706
        },
        {
          name: "ReduceSum",
          value: 6892
        },
        {
          name: "ArgMaxWithValue",
          value: 6844
        },
        {
          name: "Sub",
          value: 234
        },
        {
          name: "Mul",
          value: 117
        },
        {
          name: "Cast",
          value: 89
        }
      ],
      byCore: [
        {
          name: "AI_VECTOR_CORE",
          value: 103746
        },
        {
          name: "MIX_AIV",
          value: 6892
        }
      ]
    },
    6: {
      source: "rank_0/kernel_details.csv",
      chartType: "table",
      rows: [
        {
          name: "aclnnApplyAdamWV2_ApplyAdamWV2_ApplyAdamWV2",
          type: "ApplyAdamWV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 3680.76,
          waitTime: 0.27,
          blockDim: 40,
          inputShapes: "77791232;77791232;77791232;77791232;1",
          inputDataTypes: "FLOAT;FLOAT;FLOAT;FLOAT;INT64",
          inputFormats: "ND;ND;ND;ND;ND",
          highlight: true
        },
        {
          name: "aclnnApplyAdamWV2_ApplyAdamWV2_ApplyAdamWV2",
          type: "ApplyAdamWV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 303.2,
          waitTime: 0.13,
          blockDim: 40,
          inputShapes: "6291456;6291456;6291456;6291456;1",
          inputDataTypes: "FLOAT;FLOAT;FLOAT;FLOAT;INT64",
          inputFormats: "ND;ND;ND;ND;ND"
        },
        {
          name: "aclnnApplyAdamWV2_ApplyAdamWV2_ApplyAdamWV2",
          type: "ApplyAdamWV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 301.92,
          waitTime: 0.14,
          blockDim: 40,
          inputShapes: "6291456;6291456;6291456;6291456;1",
          inputDataTypes: "FLOAT;FLOAT;FLOAT;FLOAT;INT64",
          inputFormats: "ND;ND;ND;ND;ND"
        },
        {
          name: "aclnnApplyAdamWV2_ApplyAdamWV2_ApplyAdamWV2",
          type: "ApplyAdamWV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 300.4,
          waitTime: 0.12,
          blockDim: 40,
          inputShapes: "6291456;6291456;6291456;6291456;1",
          inputDataTypes: "FLOAT;FLOAT;FLOAT;FLOAT;INT64",
          inputFormats: "ND;ND;ND;ND;ND"
        },
        {
          name: "aclnnApplyAdamWV2_ApplyAdamWV2_ApplyAdamWV2",
          type: "ApplyAdamWV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 299.04,
          waitTime: 0.3,
          blockDim: 40,
          inputShapes: "6291456;6291456;6291456;6291456;1",
          inputDataTypes: "FLOAT;FLOAT;FLOAT;FLOAT;INT64",
          inputFormats: "ND;ND;ND;ND;ND"
        }
      ]
    }
  },
  r20260528: {
    2: {
      source: "kernel_details.csv",
      chartType: "table",
      rows: [
        {
          name: "aclnnIndexPutImpl_IndexPut_IndexPut",
          type: "IndexPut",
          acceleratorCore: "AI_CPU",
          duration: 234.624,
          waitTime: 224.749,
          blockDim: 0,
          inputShapes: "128,31;;2;3172;3172",
          inputDataTypes: "INT64;INT64;INT64;INT64;INT64",
          inputFormats: "ND;ND;ND;ND;ND",
          highlight: true
        },
        {
          name: "aclnnIndexPutImpl_IndexPut_IndexPut",
          type: "IndexPut",
          acceleratorCore: "AI_CPU",
          duration: 209.044,
          waitTime: 225.209,
          blockDim: 0,
          inputShapes: "128,22;;2;2564;2564",
          inputDataTypes: "INT64;INT64;INT64;INT64;INT64",
          inputFormats: "ND;ND;ND;ND;ND",
          highlight: true
        },
        {
          name: "aclnnIndexPutImpl_IndexPut_IndexPut",
          type: "IndexPut",
          acceleratorCore: "AI_CPU",
          duration: 208.104,
          waitTime: 221.379,
          blockDim: 0,
          inputShapes: "128,31;;2;3172;3172",
          inputDataTypes: "INT64;INT64;INT64;INT64;INT64",
          inputFormats: "ND;ND;ND;ND;ND",
          highlight: true
        },
        {
          name: "aclnnIndexPutImpl_IndexPut_IndexPut",
          type: "IndexPut",
          acceleratorCore: "AI_CPU",
          duration: 207.344,
          waitTime: 194.879,
          blockDim: 0,
          inputShapes: "128,31;;2;3172;3172",
          inputDataTypes: "INT64;INT64;INT64;INT64;INT64",
          inputFormats: "ND;ND;ND;ND;ND",
          highlight: true
        },
        {
          name: "aclnnIndexPutImpl_IndexPutV2_IndexPutV2",
          type: "IndexPutV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 160.103,
          waitTime: 44.03,
          blockDim: 48,
          inputShapes: "128,50;94;2;2;94;94",
          inputDataTypes: "INT64;INT64;INT64;INT64;INT64;INT64",
          inputFormats: "ND;ND;ND;ND;ND;ND"
        },
        {
          name: "aclnnIndexPutImpl_IndexPutV2_IndexPutV2",
          type: "IndexPutV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 159.923,
          waitTime: 28.51,
          blockDim: 48,
          inputShapes: "128,50;94;2;2;94;94",
          inputDataTypes: "INT64;INT64;INT64;INT64;INT64;INT64",
          inputFormats: "ND;ND;ND;ND;ND;ND"
        },
        {
          name: "aclnnIndexPutImpl_IndexPutV2_IndexPutV2",
          type: "IndexPutV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 159.523,
          waitTime: 38.55,
          blockDim: 48,
          inputShapes: "128,50;94;2;2;94;94",
          inputDataTypes: "INT64;INT64;INT64;INT64;INT64;INT64",
          inputFormats: "ND;ND;ND;ND;ND;ND"
        },
        {
          name: "aclnnIndexPutImpl_IndexPutV2_IndexPutV2",
          type: "IndexPutV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 153.323,
          waitTime: 33.72,
          blockDim: 48,
          inputShapes: "128,50;94;2;2;94;94",
          inputDataTypes: "INT64;INT64;INT64;INT64;INT64;INT64",
          inputFormats: "ND;ND;ND;ND;ND;ND"
        }
      ]
    },
    4: {
      source: "kernel_details.csv",
      chartType: "table",
      rows: [
        {
          name: "aclnnGather_GatherElements_GatherElements",
          type: "GatherElements",
          acceleratorCore: "AI_CPU",
          duration: 99.962,
          waitTime: 4.12,
          blockDim: 0,
          inputShapes: "128,1,50;128,1,16",
          inputDataTypes: "BOOL;INT64",
          inputFormats: "NCL;NCL",
          highlight: true
        },
        {
          name: "aclnnGather_GatherElements_GatherElements",
          type: "GatherElements",
          acceleratorCore: "AI_CPU",
          duration: 90.402,
          waitTime: 4.659,
          blockDim: 0,
          inputShapes: "128,1,50;128,1,16",
          inputDataTypes: "BOOL;INT64",
          inputFormats: "NCL;NCL",
          highlight: true
        },
        {
          name: "aclnnGather_GatherElements_GatherElements",
          type: "GatherElements",
          acceleratorCore: "AI_CPU",
          duration: 86.342,
          waitTime: 0.04,
          blockDim: 0,
          inputShapes: "128,1,50;128,1,16",
          inputDataTypes: "BOOL;INT64",
          inputFormats: "NCL;NCL",
          highlight: true
        },
        {
          name: "aclnnEmbedding_GatherV2AiCore_GatherV2",
          type: "GatherV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 105.502,
          waitTime: 0.096,
          blockDim: 48,
          inputShapes: "98166,16;128,31;1",
          inputDataTypes: "FLOAT;INT64;INT64",
          inputFormats: "ND;ND;ND"
        },
        {
          name: "aclnnEmbedding_GatherV2AiCore_GatherV2",
          type: "GatherV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 105.143,
          waitTime: 0,
          blockDim: 48,
          inputShapes: "98166,16;128,31;1",
          inputDataTypes: "FLOAT;INT64;INT64",
          inputFormats: "ND;ND;ND"
        },
        {
          name: "aclnnEmbedding_GatherV2AiCore_GatherV2",
          type: "GatherV2",
          acceleratorCore: "AI_VECTOR_CORE",
          duration: 104.962,
          waitTime: 0.126,
          blockDim: 48,
          inputShapes: "98166,16;128,31;1",
          inputDataTypes: "FLOAT;INT64;INT64",
          inputFormats: "ND;ND;ND"
        }
      ]
    }
  },
  r20260602verl: {
    4: {
      source: "ascend_pytorch_profiler_0.db (COMPUTE_TASK_INFO+TASK)",
      byType: [
        {
          name: "MatMulV2",
          value: 1636268
        },
        {
          name: "DSARandomUniform",
          value: 688346
        },
        {
          name: "MatMulV3",
          value: 505976
        },
        {
          name: "PagedAttentionMaskNdKernel",
          value: 491026
        },
        {
          name: "SwiGlu",
          value: 308106
        },
        {
          name: "AddRmsNorm",
          value: 274318
        },
        {
          name: "Slice",
          value: 243969
        },
        {
          name: "Other",
          value: 2324415
        }
      ],
      byCore: [
        {
          name: "AI_CORE",
          value: 3438280
        },
        {
          name: "AI_CPU",
          value: 690058
        },
        {
          name: "MIX_AIC",
          value: 2344089
        }
      ]
    },
    5: {
      source: "ascend_pytorch_profiler_0.db (TASK_PMU_INFO · ACL_AICORE_PIPE_UTILIZATION)",
      byType: [
        {
          name: "aic_mte2 (搬运)",
          value: 147000
        },
        {
          name: "aic_scalar",
          value: 133000
        },
        {
          name: "aiv_scalar",
          value: 237000
        },
        {
          name: "aic_mac (计算)",
          value: 38000
        },
        {
          name: "aiv_vec (计算)",
          value: 49000
        },
        {
          name: "aic_mte3 (写回)",
          value: 90000
        },
        {
          name: "Other",
          value: 306000
        }
      ],
      byCore: [
        {
          name: "AI_CORE",
          value: 408000,
          color: "#3A7BFF"
        },
        {
          name: "AI_VECTOR_CORE",
          value: 592000,
          color: "#FF8C42"
        }
      ]
    }
  },
  r20260527: {},
  // 注：r20260610 的算子视图不再手写——由 app.js initAcOpView 运行时读取
  // evidence/rank_2_ascend_pt/kernel_details.csv 自动聚合（见 §3.1 举证视图路径）
  // 注：r20260618ub 及之后的报告改用「侧车」——见各报告目录 chart-data.json（app.js loadReportChartData 自动并入）
};

// ─── 通信视图数据（来自各报告 communication.json / cluster_analysis.db） ─────────
// 数据来源:
//   r20260526: communication.json rank_0 hcom_batchSendRecv / op_statistic.csv DP集合通信
//   r20260602verl: ASCEND_PROFILER_OUTPUT/analysis.db CommAnalyzerMatrix/CommAnalyzerBandwidth
window.COMM_VIEW_DATA = {
  // ── r20260526: PP=2/DP=2 Level2 训练 ────────────────────────────────────────
  r20260526: {
    // 3.1 PP末级 P2P通信时序极端不对称：rank_0 Wait=158ms(99.7%)，rank_2 Wait≈0
    1: {
      source: 'communication.json rank_0 hcom_batchSendRecv wait/transit（Level2 step 13）',
      chartType: 'p2p-timing',
      stages: [
        {
          stageLabel: 'PP Stage 0',
          ranks: '0, 1',
          ops: [
            { direction: 'FWD Send → Stage 1', opName: 'hcom_batchSendRecv__128_3', transit_ms: 0.40, wait_ms: 0,      waitPct: 0.0,  note: '激活值下传，即时完成' },
            { direction: 'FWD Recv ← Stage 1', opName: 'hcom_batchSendRecv__128_4', transit_ms: 0.40, wait_ms: 158.10, waitPct: 99.7, note: 'Stage 1 LM Head(36.8ms)+CE(80ms)链路未结束' },
            { direction: 'BWD Recv ← Stage 1', opName: 'hcom_batchSendRecv__128_5', transit_ms: 0.40, wait_ms: 154.90, waitPct: 99.7, note: '等反向梯度从 Stage 1 回传' },
          ],
        },
        {
          stageLabel: 'PP Stage 1',
          ranks: '2, 3',
          ops: [
            { direction: 'FWD Recv ← Stage 0', opName: 'hcom_batchSendRecv__128_3', transit_ms: 0.40, wait_ms: 0, waitPct: 0.0, note: '收激活值后即刻开始 LM Head 前向' },
            { direction: 'FWD Send → Stage 0', opName: 'hcom_batchSendRecv__128_4', transit_ms: 0.40, wait_ms: 0, waitPct: 0.0, note: '此时 rank_0 的 158ms 气泡消除' },
            { direction: 'BWD Send → Stage 0', opName: 'hcom_batchSendRecv__128_5', transit_ms: 0.40, wait_ms: 0, waitPct: 0.0, note: 'CE 串行链路结束后回传梯度' },
          ],
        },
      ],
    },
    // 3.4 DP 集合通信 HCCS 带宽仅18.5 GB/s，利用率62%（4卡单节点）
    4: {
      source: 'communication.json rank_0–3 DP集合通信 HCCS（step 13，推断自 op_statistic.csv hcom_ 系列）',
      chartType: 'bw-table',
      theoryBw: 30,
      problemCols: ['rs', 'ar'],
      probRowThreshold: 15.0,
      summaryLabel: '4 卡平均',
      nodeRanges: {},
      rows: [
        { rank: 0, node: 'DP Group 0 (PP Stage 0)', ag_avg: 18.52, ag_min: 18.31, rs_avg: 18.47, rs_min: 18.21, ar_avg: 18.50, ar_min: 18.29, bc_avg: 18.48 },
        { rank: 1, node: 'DP Group 0 (PP Stage 0)', ag_avg: 18.54, ag_min: 18.33, rs_avg: 18.49, rs_min: 18.23, ar_avg: 18.52, ar_min: 18.30, bc_avg: 18.50 },
        { rank: 2, node: 'DP Group 1 (PP Stage 1)', ag_avg: 18.51, ag_min: 18.30, rs_avg: 18.45, rs_min: 18.20, ar_avg: 18.49, ar_min: 18.28, bc_avg: 18.47 },
        { rank: 3, node: 'DP Group 1 (PP Stage 1)', ag_avg: 18.53, ag_min: 18.32, rs_avg: 18.47, rs_min: 18.22, ar_avg: 18.51, ar_min: 18.29, bc_avg: 18.49 },
      ],
    },
  },

  // ── r20260602verl: verl RL训练 单卡（rank 0 视角，HCCS 8卡单节点）──────────
  r20260602verl: {
    // 3.2 TP All-Reduce 全暴露，9.4s 花在 wait：CommAnalyzerMatrix 带宽矩阵
    2: {
      source: 'analysis.db · CommAnalyzerMatrix / CommAnalyzerBandwidth（rank 0 → peer 1–7，HCCS，rollout 48s 窗口）',
      chartType: 'comm-matrix',
      srcRank: 0,
      commGroup: '单节点 8 卡全 HCCS 互联',
      theoryBw: 30,
      commSummary: 'hcom_allReduce 27,687 次 · 累计 12,954 ms · Wait 9,355 ms (72%) · 按字节加权带宽 ~10 GB/s · 逐 op 均值 5.9 GB/s（小包 / 延迟受限，通信-计算未重叠）',
      links: [
        { peer: 1, group: 'TP', bandwidth_GBps: 14.59, bytes_GB: 15.3,  note: 'TP 组，承载约 5× 字节量；AllReduce wait 72% = 9,355ms' },
        { peer: 2, group: 'DP', bandwidth_GBps: 7.63,  bytes_GB: 3.12,  note: '小包，延迟受限' },
        { peer: 3, group: 'DP', bandwidth_GBps: 7.65,  bytes_GB: 3.12,  note: '小包，延迟受限' },
        { peer: 4, group: 'DP', bandwidth_GBps: 7.64,  bytes_GB: 3.12,  note: '小包，延迟受限' },
        { peer: 5, group: 'DP', bandwidth_GBps: 7.67,  bytes_GB: 3.12,  note: '小包，延迟受限' },
        { peer: 6, group: 'DP', bandwidth_GBps: 7.63,  bytes_GB: 3.12,  note: '小包，延迟受限' },
        { peer: 7, group: 'DP', bandwidth_GBps: 7.66,  bytes_GB: 3.12,  note: '小包，延迟受限' },
      ],
    },
    // 3.6 HCCS 小包通信：链路均衡但带宽利用仅 33%（CommAnalyzerMatrix 链路均衡分析）
    6: {
      source: 'analysis.db · CommAnalyzerMatrix / CommAnalyzerBandwidth（rank 0 视角，HCCS 链路均衡分析）',
      chartType: 'comm-matrix',
      srcRank: 0,
      commGroup: '单节点 8 卡全 HCCS 互联',
      theoryBw: 30,
      commSummary: 'HCCS 链路均衡（DP 极差 < 1%）但带宽利用仅 33%（~10 GB/s ÷ 30 GB/s）· 逐 op 均值 5.9 GB/s · 典型小包 / 延迟受限 · 需补采其余 7 卡以点名 straggler',
      links: [
        { peer: 1, group: 'TP', bandwidth_GBps: 14.59, bytes_GB: 15.3,  note: 'TP 组，承载约 5× 字节量；逐 token AllReduce 串行' },
        { peer: 2, group: 'DP', bandwidth_GBps: 7.63,  bytes_GB: 3.12,  note: '均衡，极差 < 1%；小包低利用' },
        { peer: 3, group: 'DP', bandwidth_GBps: 7.65,  bytes_GB: 3.12,  note: '均衡' },
        { peer: 4, group: 'DP', bandwidth_GBps: 7.64,  bytes_GB: 3.12,  note: '均衡' },
        { peer: 5, group: 'DP', bandwidth_GBps: 7.67,  bytes_GB: 3.12,  note: '均衡' },
        { peer: 6, group: 'DP', bandwidth_GBps: 7.63,  bytes_GB: 3.12,  note: '均衡' },
        { peer: 7, group: 'DP', bandwidth_GBps: 7.66,  bytes_GB: 3.12,  note: '均衡' },
      ],
    },
  },

  // 注：r20260618ub 及之后的报告改用「侧车」——见各报告目录 chart-data.json（app.js loadReportChartData 自动并入）
};

// ─── FreeAnalysis 空闲段明细（直接来自 .db 文件 FreeAnalysis 表，按 duration 降序） ─────────
// 数据来源: Analysis Report/ascend_analysis_multi_20260602/free_analysis/cluster_analysis_output/cluster_analysis.db
window.FREE_ANALYSIS_DATA = {

  // 注：r20260618ub 及之后的报告改用「侧车」——见各报告目录 chart-data.json（app.js loadReportChartData 自动并入）
};

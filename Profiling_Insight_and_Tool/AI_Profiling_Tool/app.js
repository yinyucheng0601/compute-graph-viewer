// ============================================================
// MindStudioNext — 4 Tab Report Viewer
// ============================================================

// ---- 预置三份真实分析报告数据 ----
const REPORTS = [
  {
    id: 'r20260526',
    filename: '../Analysis Report/ascend_analysis_20260526/report.md',
    title: 'Level2 4 卡训练 Profiling 诊断报告',
    subtitle: 'PP=2 / DP=2 / TP=1',
    taskType: '单机多卡训练',
    reportDate: '2026-05-26',
    phs: {
      current: 63, grade: 'B+', estimated: 75, estGrade: 'A',
      subItems: [
        { name: '计算', value: 39 }, { name: '通信', value: 65 },
        { name: '调度', value: 82 }, { name: '内存', value: null }, { name: '均衡', value: 46 },
      ],
      estSubItems: [
        { name: '计算', value: 58 }, { name: '通信', value: 75 },
        { name: '调度', value: 88 }, { name: '内存', value: null }, { name: '均衡', value: 82 },
      ],
    },
    summary: {
      conclusion: '单步 810 ms 被 Pipeline 流水级负载不均完全主导：PP 末级（rank 2/3）计算 ~401 ms，PP 首级（rank 0/1）仅 ~231 ms，差值 170 ms',
      topBottleneck: 'rank 2/3 比 rank 0/1 多 ~169 ms 的「LM Head MatMul + Cross-Entropy 链路」计算，整段未在 PP 内任何位置与计算/通信重叠',
      maxGain: '行动清单 P0/P1 全部落地后节省 ~20% 单步耗时（约 160 ms / step，810 → ~650 ms）',
    },
    actions: [
      { id: 1, priority: 'P0', problem: 'PP 末级承担 LM Head + Loss，比首级多 169 ms 计算，首级 PP 接收侧空等 158 ms', benefit: '-15% 单步耗时（约 120 ms）', benefitNum: 15, difficulty: '中', location: 'pipeline_model_parallel_split_rank / num_layers_in_first_pipeline_stage', visualization: '通信视图 + Timeline 视图（系统调优）' },
      { id: 2, priority: 'P0', problem: 'LM Head MatMulV3 单次 18.4 ms × 2（MIX_AIC 路径），疑似走到非最优 tiling', benefit: '-3% 单步耗时（约 25 ms）', benefitNum: 3, difficulty: '中', location: 'lm_head 模块 — vocab 维度对齐检查（--make-vocab-size-divisible-by 128）', visualization: '算子视图 + 详情视图' },
      { id: 3, priority: 'P1', problem: 'Cross-Entropy 链路（Exp/Sub/RealDiv/Cast/Mul）单 step 累计 ~80 ms 全部串行，无算子融合', benefit: '-4% 单步耗时（约 35 ms）', benefitNum: 4, difficulty: '中', location: 'Loss 函数 → 替换为 aclnnSoftmaxCrossEntropyWithLogits', visualization: '算子视图' },
      { id: 4, priority: 'P1', problem: 'DP 集合通信 HCCS 带宽仅 18.5 GB/s（理论 ~30 GB/s），利用率 62%', benefit: '通信效率 65% → 75%（约 -1.5% 单步耗时）', benefitNum: 1.5, difficulty: '低', location: 'bucket_size_mb 扩大 / HCCL_ALGO=ring', visualization: '通信视图' },
      { id: 5, priority: 'P2', problem: 'PP 反向接收完成后才开始 DP collective，未与 P2P 重叠', benefit: '估算节省 ~30 ms', benefitNum: null, difficulty: '中', location: '--overlap-grad-reduce / --overlap-param-gather', visualization: 'Timeline 视图（系统调优）' },
      { id: 6, priority: 'P2', problem: 'ApplyAdamWV2 单实例 3.68 ms 突发（均值 23×）', benefit: '低', benefitNum: null, difficulty: '低', location: '--use-distributed-optimizer（Megatron）', visualization: '算子视图' },
    ],
    issues: [
      { id: '3.1', priority: 'P0', title: 'PP 末级承担 LM Head + Loss，比首级多 169 ms 计算',
        evidence: 'step_trace_time.csv：rank 0/1 Computing=231 ms，rank 2/3=400/401 ms，差值 ~170 ms；communication.json rank 0 hcom_batchSendRecv Wait=158.10 ms（99.7% 是等待，transit 仅 0.40 ms）',
        impact: '所有 4 卡被对齐到 810 ms，PP 首级有 312 ms 卡在 P2P send/recv 上空等（占单步 38%）',
        steps: ['确认框架是否把 LM Head/Loss 绑定到 last stage', '方案 A（推荐）：调整 num_layers_in_first_pipeline_stage，移动 1-2 个 Block', '方案 B：开启 VPP interleaved 1F1B（--num-virtual-pipeline-stages）', '方案 C（兜底）：tied embeddings + parallel_output=True'],
        verification: '重采后各 rank Computing 极差 < 10%（当前 73%）；hcom_batchSendRecv Wait < 30 ms',
        visualization: '主：通信视图 — 载入 communication_matrix.json，看 PP 通信域时序极端不对称；辅：Timeline 视图 — 对照 rank_0 与 rank_2 的 trace_view.json',
        codeLocations: [] },
      { id: '3.2', priority: 'P0', title: 'LM Head MatMulV3 单次 18.4 ms × 2，疑似非最优 Tiling',
        evidence: 'kernel_details.csv (rank 2)：两个 MatMulV3 实例耗时 18432/18386 us；Core Type 是 MIX_AIC 而非普通 AI_CORE',
        impact: '单 step 反向额外 36.8 ms，占单步 4.5%',
        steps: ['检查 lm_head 的 vocab 维度是否为 32 的倍数', '若未对齐，加 --make-vocab-size-divisible-by 128', '若仍走 MIX_AIC，显式 cast 为 bfloat16 后传入 matmul'],
        verification: '重采后 kernel_details.csv 中不再有 > 5 ms 的 MatMulV3 实例',
        visualization: '算子视图（主）— 载入 rank_2 kernel_details.csv，按 Duration 倒序；详情视图（辅）— 看 Roofline 落点',
        codeLocations: [] },
      { id: '3.3', priority: 'P1', title: 'Cross-Entropy 链路 ~80 ms 全部串行无融合',
        evidence: 'op_statistic.csv (rank 2)：Exp 16 ms、RealDiv 15.7 ms、ArgMaxWithValue 6.8 ms、ReduceSum 6.9 ms，rank 0 全部为 0',
        impact: '单 step 额外 ~80 ms，占单步 ~10%',
        steps: ['检查训练脚本 Loss 是手写展开还是 F.cross_entropy', '替换为 torch.nn.functional.cross_entropy 或 aclnnSoftmaxCrossEntropyWithLogits', 'ArgMaxWithValue/ReduceSum 移到 eval_interval 条件内'],
        verification: '重采后 Exp/RealDiv 应消失；rank 2 Computing 再减 ~30 ms',
        visualization: '算子视图 — 载入 rank_2 kernel_details.csv，过滤 Exp/RealDiv/Sub/ArgMaxWithValue',
        codeLocations: [] },
    ],
    noProblems: [
      'Host 下发延迟（launch API 均值 15 us，不构成瓶颈）',
      'HCCS 链路硬件一致（4 卡 bandwidth 全部 18.5–18.6 GB/s，极差 < 0.5%）',
      'Free Time 极差均匀（不存在 Host 下发型慢卡）',
      '算子下发拥塞（aclrtSynchronizeDevice 长耗时本质是 P2P 等待，非同步语义异常）',
    ],
    meta: {
      date: '2026-05-26',
      dataPath: 'd:/Projects/ProfilingTest/Profiling_output/level2/',
      range: '单机 4 卡，PP=2/DP=2/TP=1/EP=1，step 13 单步（warmup 12 + active 1），~810 ms',
      version: 'torch_npu 2.7.1 / CANN 8.3.RC1',
      skills: ['mindstudio_profiler_data_check', 'cluster-fast-slow-rank-detector', 'performance-health-score', 'msinsight-view-selector'],
      advisorStatus: '失败 — msprof-analyze 不在 PATH',
      output: './Analysis Report/ascend_analysis_20260526/',
    },
    diskFileInfo: {
      dir: 'level2/',
      source: '分布式训练 Profiling',
      isLLM: 'yes',
      model: 'Qwen2-7B（4 卡，PP=2/DP=2/TP=1）',
      size: '64.9 MB',
      link: 'https://gitcode.com/zhangruoyu2/msinsight-quick-start-demo/blob/main/GUI-test-data/training/single-node/level2.rar',
      linkText: 'level2.rar',
    },
    codeExamplesFabricated: true,
    codeExamples: [
      {
        label: 'PP 层分配调整（方案 A）',
        lang: 'python',
        issue: '3.1',
        before: `# pretrain_gpt.py — Megatron 并行参数构造
args.num_layers = 16
args.pipeline_model_parallel_size = 2
# 原配置：均等分层，LM Head 堆到末级
args.pipeline_model_parallel_split_rank = args.num_layers // 2  # 16 → 8+8
setup_model_and_optimizer(model_provider, args)`,
        after: `# pretrain_gpt.py — Megatron 并行参数构造
args.num_layers = 16
args.pipeline_model_parallel_size = 2
# 修改后：把 2 层 Block 从 stage 1 移到 stage 0
args.num_layers_in_first_pipeline_stage = (args.num_layers // 2) + 2  # 16 → 10+6
# stage0 231ms→~263ms，stage1 401ms→~369ms，差值 170ms→~106ms
setup_model_and_optimizer(model_provider, args)`,
      },
      {
        label: 'vocab 维度对齐',
        lang: 'python',
        issue: '3.2',
        before: `# arguments.py — 词表维度配置
tokenizer = build_tokenizer(args)
# 原配置：vocab_size 未对齐
vocab_size = tokenizer.vocab_size            # 50257，非 128 的倍数
args.padded_vocab_size = vocab_size
build_model(args)`,
        after: `# arguments.py — 词表维度配置
tokenizer = build_tokenizer(args)
# 修改后：对齐到 128 的倍数（等价于 --make-vocab-size-divisible-by 128）
import math
vocab_size = math.ceil(tokenizer.vocab_size / 128) * 128   # 50257 → 50304
args.padded_vocab_size = vocab_size
# 对齐后 lm_head MatMulV3 走纯 AI_CORE，18.4ms → ~5ms
build_model(args)`,
      },
      {
        label: 'Cross-Entropy 算子融合',
        lang: 'python',
        issue: '3.3',
        before: `# loss 计算（last pipeline stage）
logits = model(inputs)
# 原写法：手写 softmax + log + gather（触发 Exp/RealDiv/Sub 链路）
log_probs = logits - logits.max(dim=-1, keepdim=True).values
log_probs = log_probs - torch.log(torch.exp(log_probs).sum(dim=-1, keepdim=True))
loss = -log_probs.gather(dim=-1, index=labels.unsqueeze(-1)).squeeze(-1).mean()
loss.backward()`,
        after: `# loss 计算（last pipeline stage）
logits = model(inputs)
# 修改后：使用 F.cross_entropy（路由到 aclnnSoftmaxCrossEntropyWithLogits）
import torch.nn.functional as F
loss = F.cross_entropy(logits, labels, ignore_index=pad_token_id)
# 消除 Exp/RealDiv/Sub/ArgMaxWithValue 链路，节省 ~80ms/step
loss.backward()`,
      },
    ],
  },

  {
    id: 'r20260527',
    filename: '../Analysis Report/ascend_analysis_20260527/report.md',
    title: 'MatmulLeakyRelu 算子 simulator 诊断报告',
    subtitle: '单算子调优',
    taskType: '算子调优',
    reportDate: '2026-05-27',
    phs: {
      current: 38, grade: 'C', estimated: 70, estGrade: 'B+',
      subItems: [
        { name: '计算', value: 30 }, { name: '通信', value: null },
        { name: '调度', value: 65 }, { name: '内存', value: 35 },
      ],
      estSubItems: [
        { name: '计算', value: 78 }, { name: '通信', value: null },
        { name: '调度', value: 78 }, { name: '内存', value: 58 },
      ],
    },
    summary: {
      conclusion: 'Matmul → LeakyRelu 走"cube 写 GM → vec 再读 GM"非融合路径，3 颗 core 整体被 MTE2 主存搬运拖住，cube 真正算 MMAD 的时间仅占 cubecore span 的 65%，vec 算 VLRELU 只占 vec span 的 10%',
      topBottleneck: 'Matmul 结果与 LeakyRelu 未融合 — cube 的 Fixpipe 把 2.62 MB 矩阵 C 落回 GM，紧接着 2 个 vec core 各从 GM 再读 1.31 MB 做 LeakyRelu，额外 5.24 MB 总流量',
      maxGain: '行动清单 P0/P1 全部落地后保守预估总耗时下降 40%–55%（vec MTE2/MTE3 整段被消除 + cube Double Buffer 重叠）',
    },
    actions: [
      { id: 1, priority: 'P0', problem: 'Matmul→GM→Vec 往返，Fixpipe 写 2.62 MB + vec MTE2 再读 2.62 MB；vec 实际 VLRELU 只算 6.6 ns', benefit: '总耗时↓40%–55%（消除 vec 路径整段）', benefitNum: 50, difficulty: '中', location: 'matmul_leakyrelu_custom.cpp:119-139（Fixpipe 写出段）+ :207（LeakyRelu 入口）', visualization: '内存视图 + Timeline 视图（算子调优）' },
      { id: 2, priority: 'P0', problem: 'CUBE 流水仅占 cubecore span 65%（MMAD busy 72.8 ns / span 112.6 ns），MTE1 WAIT_FLAG 566 次 vs SET_FLAG 440 次', benefit: 'CUBE 利用率 65% → 85%（cube 耗时↓20%）', benefitNum: 20, difficulty: '低', location: 'matmul_leakyrelu_custom.cpp:116-139，打开 L0A/L0B/L1 Double Buffer（BUFFER_NUM=2）', visualization: 'Timeline 视图（算子调优）' },
      { id: 3, priority: 'P1', problem: 'cubecore0 SCALAR 事件 44,245 个，SCALAR pipe busy 201 ns（178% span），栈帧 LD/ST 主导', benefit: 'scalar 占用↓30%', benefitNum: null, difficulty: '中', location: 'matmul_leakyrelu_custom.cpp:206-207（占 46% cycles）', visualization: '源码视图 + Timeline 视图（算子调优）' },
      { id: 4, priority: 'P1', problem: 'MTE2 GM→L1（ND2NZ）单次平均 22 KB，180 次共 3.94 MB，busy 263 ns（233% 跨槽）', benefit: 'MTE2 阻塞时间↓25%', benefitNum: null, difficulty: '中', location: 'matmul_leakyrelu_custom.cpp:116-120 CopyIn 段，增大 DataCopy 块并对齐 512B', visualization: '详情视图' },
      { id: 5, priority: 'P2', problem: 'vec core 负载不均：veccore0 span 97.8 ns vs veccore1 span 114.4 ns（Δ 16.6 ns / 17%）', benefit: '总耗时↓2%–5%', benefitNum: null, difficulty: '中', location: 'host tiling 代码，检查尾块 round-robin 分配', visualization: 'Timeline 视图（算子调优）' },
      { id: 6, priority: 'P2', problem: 'CACHEMISS 累计 326 次，集中在 scalar 栈 PC 段', benefit: '低', benefitNum: null, difficulty: '低', location: '与 P1#3 联动，scalar 优化后预期自动减少', visualization: '源码视图' },
    ],
    issues: [
      { id: '3.1', priority: 'P0', title: 'Matmul→GM→Vec 往返：LeakyRelu 未与 Fixpipe 融合',
        evidence: 'pipe_instr_top.csv：cubecore0 FIXP/FIX_L0C_TO_DST 20 次写出 2.62 MB；每个 vec core MTE2/MOV_OUT_TO_UB 10 次读入 1.31 MB（合计读回 2.62 MB）；per_core_pipe.csv：vec 真正 VECTOR busy 仅 6.6 ns，搬运 vs 计算 ≈ 23:1',
        impact: 'vec 整段 span 97-114 ns 完全串在 cube 之后，无法与 cube 计算重叠，这是端到端耗时的单点决定因素',
        steps: ['查 matmul_intf.h 中 leakyrelu 字段支持情况（Atlas A2 Fixpipe 支持随路 relu/leakyrelu）', '方案 A（推荐）：IterateAll(D, leakyReluAlpha) 让 Fixpipe 直接输出已激活结果，删除 vec kernel', '方案 B（兜底）：将 LeakyRelu 搬到与 cube 同 kernel 的 mix mode，复用同一 GM workspace'],
        verification: '重跑 msprof op simulator；期望 vec core span < 10 ns，端到端耗时从 ~114 ns 降到 ~80 ns',
        visualization: '主：内存视图 — 载入 visualize_data.bin，查看 cube 写出和 vec 读入的 GM 地址重叠；辅：Timeline 视图（算子调优）',
        codeLocations: ['matmul_leakyrelu_custom.cpp:119-139', 'matmul_leakyrelu_custom.cpp:207'] },
      { id: '3.2', priority: 'P0', title: 'CUBE 流水仅占 cubecore span 65%，MMAD 在等 L1 数据',
        evidence: 'per_core_pipe.csv：cubecore0 CUBE busy 72.8 ns，span 112.6 ns，利用率 64.6%；MTE1 WAIT_FLAG 566 > SET_FLAG 440，多等 126 次；MTE2 busy 263 ns（233% span）',
        impact: '35% bubble；Double Buffer 后可让 CUBE 段缩短约 20%，cube core 利用率提升到 85%+',
        steps: ['找到 TPipe::InitBuffer(...) 中分配 L1A/L1B/L0A/L0B 的位置（:116 附近）', '把 buffer 个数从 1 改为 2（BUFFER_NUM = 2）', '改用 Iterate<false>() 以异步推进，主循环每两次 Iterate 之间不强同步'],
        verification: 'per_core_pipe.csv 中 CUBE util_pct ≥ 80%；MTE1 WAIT_FLAG ≤ SET_FLAG',
        visualization: 'Timeline 视图（算子调优）— 载入 visualize_data.bin，过滤 core0.cubecore0 的 MTE1/MTE2/CUBE 三条 pipe',
        codeLocations: ['matmul_leakyrelu_custom.cpp:116-139'] },
      { id: '3.6', priority: 'P2', title: 'CACHEMISS 累计 326 次，集中在 scalar 栈 PC 段',
        evidence: 'simulator per_core_event.csv：cubecore0 CACHEMISS 326 次，PC 区间 0x0800–0x0840 高度集中；反汇编定位到 matmul_leakyrelu_custom.cpp:206-207（LeakyReluCustom 函数头栈帧）；SCALAR LD/ST/STI/STP 指令在此处以 2 cycle/miss × 326 次 = 652 cycle 额外开销叠加于已高负载的 SCALAR pipe（44,245 事件/178% span）上',
        impact: '326 次 CACHEMISS 独立贡献约 2 ns 延迟，单独修复收益低；但与 P1#3 强关联——44,245 scalar 事件本身由 LeakyReluCustom 频繁调用产生，一旦 scalar 总量削减，函数栈帧访问频率下降，CACHEMISS 随之自然消除',
        steps: [
          '确认 LeakyReluCustom 编译后已内联（nm/objdump 输出不含 LeakyReluCustom 符号即已内联）',
          '若未内联：加 __attribute__((always_inline)) 或将函数体搬入同 kernel 的 struct inline 方法',
          'line206 局部变量 off 提至循环外层，避免每轮 SCALAR 栈帧反复写/读'
        ],
        verification: 'per_core_event.csv 中 CACHEMISS ≤ 30 次；SCALAR busy 从 201 ns 同步降至 < 70 ns（可与 P1#3 验证合并）',
        visualization: '源码视图 — visualize_data.bin PC 热图定位到 matmul_leakyrelu_custom.cpp:206-207，SCALAR 栈帧 LD/ST 密集',
        codeLocations: ['matmul_leakyrelu_custom.cpp:206-207'] },
    ],
    noProblems: [
      '多核切分到位（3 颗核均有事件，vec 两核事件数完全相等）',
      'FIXP 通道利用率 87%（接近饱和，不是瓶颈点）',
      'CUBE pipe 指令唯一性（80 次 MMAD，无冗余 CUBE 指令，单次 dur ~0.91 ns 符合预期）',
      'DataCopy 单次量 21.4 KB（已满足 ≥ 16 KB 经验阈值）',
    ],
    meta: {
      date: '2026-05-27',
      dataPath: 'd:/Projects/ProfilingTest/operator/visualize_data.bin',
      range: 'simulator 模式，1 cube + 2 vec 核，118.6 MB bin，68,713 事件',
      version: 'CANN 8.3.RC1（推断自 CANN toolkit）',
      skills: ['msot-msopprof-operator-profiler', 'ascendc-operator-performance-optim', 'performance-health-score', 'msinsight-view-selector'],
      advisorStatus: '未调用 — 纯 simulator bin 分析，advisor 主要面向多卡训练 DB',
      output: './Analysis Report/ascend_analysis_20260527/',
    },
    diskFileInfo: {
      dir: 'operator/',
      source: '算子 Simulator',
      isLLM: 'na',
      model: 'AscendC MatmulLeakyRelu 算子调优',
      size: '113 MB',
      link: 'https://gitcode.com/zhangruoyu2/msinsight-quick-start-demo/blob/main/GUI-test-data/operator/msprof-op-simulator/visualize_data.bin',
      linkText: 'visualize_data.bin',
    },
    codeExamplesFabricated: true,
    codeExamples: [
      {
        label: 'LeakyRelu Fixpipe 融合（方案 A）',
        lang: 'cpp',
        issue: '3.1',
        before: `// 原写法：cube 写 GM，vec 再读 GM（双倍流量）
template<...>
__aicore__ inline void MatmulLeakyReluCustom::Process() {
    // cube 阶段：结果写回 GM
    matmulObj.IterateAll(C);           // Fixpipe → GM (2.62MB 落盘)
    // vec 阶段：从 GM 读回做 LeakyRelu
    LeakyReluCustom(C, alpha, output); // MTE2 GM→UB (2.62MB 再读)
}`,
        after: `// 修改后：Fixpipe 随路 LeakyRelu（融合路径，消除 vec 路径）
template<...>
__aicore__ inline void MatmulLeakyReluCustom::Process() {
    // 直接在 IterateAll 中传入 leakyRelu 系数，Fixpipe 随路激活
    matmulObj.IterateAll(C, leakyReluAlpha);  // 输出已激活结果
    // LeakyReluCustom 整段删除
    // vec core span: 114ns → <10ns，端到端↓40-55%
}`,
      },
      {
        label: 'Double Buffer 开启（BUFFER_NUM=2）',
        lang: 'cpp',
        issue: '3.2',
        before: `// 原写法：单 Buffer，MTE2 与 CUBE 完全串行
TPipe pipe;
TBuf<QuePosition::A1> bufA1;
TPipe::InitBuffer(pipe, bufA1, 1, blockSize);  // BUFFER_NUM=1`,
        after: `// 修改后：Double Buffer，MTE2 与 MMAD 并行流水
TPipe pipe;
TBuf<QuePosition::A1> bufA1;
TPipe::InitBuffer(pipe, bufA1, 2, blockSize);  // BUFFER_NUM=2
// CUBE 利用率：65% → 85%，cube 段耗时↓20%
// 同时改用 Iterate<false>() 异步推进：
for (int i = 0; i < batchCount; i++) {
    matmulObj.Iterate<false>(A_i, B_i, C_i);  // 非阻塞
}`,
      },
    ],
  },

  {
    id: 'r20260528',
    filename: '../Analysis Report/eta_eager_l1_analysis_20260528/report.md',
    title: 'eta_eager_l1 推理 Profiling 性能分析报告',
    subtitle: '单卡 Eager 模式推理',
    taskType: '推理诊断',
    reportDate: '2026-05-28',
    phs: {
      current: 7, grade: 'D', estimated: 48, estGrade: 'B',
      subItems: [
        { name: '计算', value: 7 }, { name: '通信', value: null },
        { name: '调度', value: 7 }, { name: '内存', value: null },
      ],
      estSubItems: [
        { name: '计算', value: 50 }, { name: '通信', value: null },
        { name: '调度', value: 52 }, { name: '内存', value: null },
      ],
    },
    summary: {
      conclusion: '单卡推理被 Host 下发完全主导，NPU 100 个 step 中只用 7.36% 的墙钟在跑算子；其余 92.6% 是 device idle（Free Time）',
      topBottleneck: 'steps 呈双峰分布 — 59 个"慢 step"平均 86.7 ms（Free 82 ms），41 个"快 step"平均 18.7 ms（Free 14 ms），计算时间在所有 step 完全恒定 4.3 ms；瓶颈完全在 host launch 与 AI_CPU 算子',
      maxGain: '行动清单 P0/P1 全部落地后预估单步耗时从均值 58.8 ms 降到 ~18 ms，全程节省 ~3.9 s（~69%）',
    },
    actions: [
      { id: 1, priority: 'P0', problem: 'NPU 整体 idle 92.6%，每步 ~54 ms host 下发气泡，eager 模式逐算子下发 353 个 kernel/step，平均 12.26 us/kernel', benefit: '-65% 单步耗时', benefitNum: 65, difficulty: '中', location: 'torch.compile(backend="npu", mode="reduce-overhead") 或 TASK_QUEUE_ENABLE=2', visualization: 'Timeline 视图（系统调优）' },
      { id: 2, priority: 'P0', problem: 'IndexPut 算子全部跑在 AI_CPU 上，500 次调用 68.2 ms（占 NPU 计算 15.76%），单次 136 us 是普通 AI_VECTOR 算子的 13 倍', benefit: '-15% 单步耗时', benefitNum: 15, difficulty: '中', location: '业务代码中 tensor[idx] = val / torch.index_put_ → 改用 scatter_ 或 torch.where', visualization: '算子视图' },
      { id: 3, priority: 'P0', problem: 'NonZero 产生 D2H 同步，单次最大 72 ms（均值 522 us），是慢 step 的直接触发源', benefit: '-15% 单步耗时', benefitNum: 15, difficulty: '高', location: '业务代码中 torch.nonzero() → 改为 topk 或 boolean mask 静态索引', visualization: 'Timeline 视图（系统调优）' },
      { id: 4, priority: 'P0', problem: 'GatherElements 落 AI_CPU，400 次共 28.6 ms（占 NPU 6.6%），INT64 索引触发 fallback', benefit: '-7% 单步耗时', benefitNum: 7, difficulty: '低', location: 'torch.gather 调用 → 索引 .to(torch.int32)', visualization: '算子视图' },
      { id: 5, priority: 'P1', problem: 'MatMul 类算子 cube mac_ratio 均值 5.8%（scalar_ratio 81.1%），算子粒度过小（K 维 16-64），Cube 单元基本闲置', benefit: '中', benefitNum: null, difficulty: '中', location: '小 MatMul/Linear → 合并为 BatchMatMul 或增大 batch 维（K ≥ 128）', visualization: '详情视图' },
      { id: 6, priority: 'P1', problem: 'MemSet 每步触发 46 次（4600 次/100 step），占 NPU 计算 10.7%，workspace 未复用', benefit: '-3% 单步耗时', benefitNum: 3, difficulty: '中', location: 'ACLNN_CACHE_LIMIT=10000 + HOST_CACHE_CAPACITY=20', visualization: 'Timeline 视图（系统调优）' },
      { id: 7, priority: 'P1', problem: 'aclnnInplaceCopyGetWorkspaceSize 单次最大 64 ms（均值 60 us），host launch 尾延迟首位', benefit: '-2% 单步耗时', benefitNum: 2, difficulty: '低', location: '升级 CANN 到 8.3 latest hotfix；启用 _data_simplification: true', visualization: 'Timeline 视图（系统调优）' },
      { id: 8, priority: 'P2', problem: '每步 7 次同步调用（aclrtSynchronizeStream 600 次 + aclrtSynchronizeDevice 101 次），强制阻塞 host', benefit: '低', benefitNum: null, difficulty: '中', location: '业务代码中 .cpu()/.item()/print(tensor) 等显式同步点 → 移到后处理阶段', visualization: 'Timeline 视图（系统调优）' },
    ],
    issues: [
      { id: '3.1', priority: 'P0', title: 'NPU 92.6% 时间空转，host 下发模式无法跟上 device',
        evidence: 'step_trace_time.csv 100 步：Computing 总和 432.77 ms，Stage 总和 5883.72 ms，NPU 计算占比仅 7.36%；每步固定 353 个 kernel，平均 12.26 us/kernel；api_statistic.csv node launch 最大 71,944 us（单次 72 ms）',
        impact: '在 910B 量级硬件上，每个推理样本本应 ~5 ms 完成，实际 58.8 ms，吞吐损失 ~10×',
        steps: ['切换 torch.compile(model, backend="npu", mode="reduce-overhead")（torch_npu 2.6 已支持）', '或设置环境变量 TASK_QUEUE_ENABLE=2 让 host launch 异步化', '验证 Free/Stage 比从 0.93 降到 < 0.3'],
        verification: '重采后 step_trace_time.csv 的 Computing/Stage ≥ 50%；kernel_details.csv 的 Wait Time 总和从 5+ s 降到 < 1 s',
        visualization: 'Timeline 视图（系统调优）— 载入 trace_view.json，并排查看 PyTorch/CANN/Ascend Hardware 三泳道的水平间隙',
        codeLocations: [] },
      { id: '3.2', priority: 'P0', title: 'AI_CPU 算子 IndexPut 阻塞 device pipeline',
        evidence: 'op_statistic.csv：IndexPut Core Type = AI_CPU，500 次，总耗时 68,186 us，单次均值 136 us；kernel_details.csv：平均 Wait Time 1502 us（排所有算子第一）',
        impact: '500 × 1.5 ms = 750 ms 的额外 device idle，几乎与 IndexPut 自身耗时同量级',
        steps: ['搜索业务代码中 tensor[bool_mask] = val / _index_put_impl_ 调用', '改写为 t = torch.where(bool_mask, val, t)，强制走 AI_VECTOR_CORE', '或用 scatter_ 配合预先计算好的 INT32 索引'],
        verification: 'op_statistic.csv 中 IndexPut Core Type 从 AI_CPU 变为 AI_VECTOR_CORE；aten::_index_put_impl_ 的 Host Self Duration（当前 1.2 s）下降 ≥ 80%',
        visualization: '算子视图 — 载入 kernel_details.csv，过滤 Accelerator Core = AI_CPU',
        codeLocations: [] },
      { id: '3.3', priority: 'P0', title: 'NonZero 触发 D2H 同步，是慢 step 的根本触发器',
        evidence: 'api_statistic.csv：aclnnNonzeroV2 调用 600 次，最大 72009 us，方差 24,853,118（极端长尾）；aclrtSynchronizeStreamWithTimeout 调用 600 次（与 NonZero 数量完全一致）',
        impact: '双峰分布的成因 — 59 个慢 step（86.7 ms）vs 41 个快 step（18.7 ms）',
        steps: ['搜索 torch.nonzero()/(x>0).nonzero()/torch.where(x) 调用', '若为 top-k 索引：改用 torch.topk(x, k=固定值)', '若为稀疏 mask：改用 x.masked_select() 或 boolean mask 索引', '若动态 shape 无法消除：用 aclmdlSetDynamicShape 预注册 shape 集合'],
        verification: 'aclnnNonzeroV2 Max 从 72009 us 降到 < 5000 us；慢 step 占比从 59% 降到 < 10%',
        visualization: 'Timeline 视图（系统调优）— 搜索 aclnnNonzeroV2，观察后跟的 SynchronizeStreamWithTimeout 间隔',
        codeLocations: [] },
    ],
    noProblems: [
      '通信（单卡场景，Communication 列恒为 0，N/A）',
      '采集完整性（profiler_info.json 正常 Stop，8 个交付件齐全）',
      'Step 间稳定性（100 步 Computing 标准差 < 1%，4277–4477 us）',
      'Preparing 阶段（均值 218 us，dataloader 无瓶颈）',
    ],
    meta: {
      date: '2026-05-28',
      dataPath: 'd:/Projects/ProfilingTest/eta_eager_l1/1640123b27bd_12093.../ASCEND_PROFILER_OUTPUT/',
      range: '单卡（Device 0），step 10-109 共 100 步，采集时长 ~5.88 s，Level1，profile_memory=false',
      version: 'torch_npu 2.6.0 / CANN 8.3.RC1',
      skills: ['mindstudio_profiler_data_check', 'performance-health-score', 'msinsight-view-selector'],
      advisorStatus: '失败 — python/msprof-analyze 不在 PATH',
      output: './Analysis Report/eta_eager_l1_analysis_20260528/',
    },
    diskFileInfo: {
      dir: 'eta_eager_l1/',
      source: '推理 Profiling',
      isLLM: 'no',
      model: '推荐系统 / CTR 多特征 Embedding 模型',
      size: '261 MB',
      link: 'https://gitcode.com/zhangruoyu2/msinsight-quick-start-demo/blob/main/GUI-test-data/inference/torch-inductor/eta_eager_l1.tar.gz',
      linkText: 'eta_eager_l1.tar.gz',
    },
    codeExamplesFabricated: true,
    codeExamples: [
      {
        label: '切换图模式（优先方案）',
        lang: 'python',
        issue: '3.1',
        before: `# 原写法：eager 模式，每个算子逐个下发（353 kernel/step × 14μs）
model = MyModel().npu()
for batch in dataloader:
    output = model(batch)  # 353 次单独 aclnn 调用`,
        after: `# 修改后：torch.compile 图模式，批量下发消除 host bubble
import torch_npu
model = MyModel().npu()
model = torch.compile(model, backend="npu", mode="reduce-overhead")
# 或使用异步 task queue（不改代码）：
# 启动前设置：export TASK_QUEUE_ENABLE=2
for batch in dataloader:
    output = model(batch)  # NPU idle 从 92.6% 降至预估 < 30%`,
      },
      {
        label: 'IndexPut → torch.where 替换',
        lang: 'python',
        issue: '3.2',
        before: `# 数据预处理：padding 位置填充 pad_token
padding_mask = (lengths < max_len)
# 原写法：布尔索引赋值 → 触发 AI_CPU IndexPut（136μs/次，每 step 5 次共 68.2ms）
token_ids[padding_mask] = pad_token_id   # AI_CPU fallback
return token_ids`,
        after: `# 数据预处理：padding 位置填充 pad_token
padding_mask = (lengths < max_len)
# 修改后：torch.where 强制走 AI_VECTOR_CORE（~10μs/次）
token_ids = torch.where(padding_mask, pad_token_id, token_ids)
# Core Type: AI_CPU → AI_VECTOR_CORE，Wait Time 1502μs → ~50μs
return token_ids`,
      },
      {
        label: 'NonZero → topk 替换',
        lang: 'python',
        issue: '3.3',
        before: `# 取出有效 token 位置用于后续 gather
attention_mask = build_mask(batch)
# 原写法：nonzero 产生动态 shape，触发 D2H 同步（最大 72ms）
active_indices = (attention_mask > 0).nonzero(as_tuple=False)
# shape=(2, N)，N 每次不同 → host 必须等 device 完成才能继续
hidden = gather_active(hidden, active_indices)`,
        after: `# 取出有效 token 位置用于后续 gather
attention_mask = build_mask(batch)
# 修改后：topk 保持静态 shape，消除 D2H 同步
MAX_ACTIVE = 1024  # 根据业务上界设定固定值
_, active_indices = attention_mask.float().topk(MAX_ACTIVE, dim=-1)  # shape 恒定
# aclnnNonzeroV2 Max 72009μs → 0；慢 step 占比 59% → <5%
hidden = gather_active(hidden, active_indices)`,
      },
    ],
  },

  {
    id: 'r20260602verl',
    filename: '../Analysis Report/ascend_analysis_verl_20260602/report.md',
    title: 'verl RL 训练性能诊断报告',
    subtitle: 'Rollout + update_actor / 单卡',
    taskType: 'RL 训练',
    reportDate: '2026-06-02',
    phs: {
      current: 25, grade: 'D', estimated: 45, estGrade: 'B',
      subItems: [
        { name: '计算', value: 12 }, { name: '通信', value: 33 },
        { name: '调度', value: 39 }, { name: '内存', value: null },
      ],
      estSubItems: [
        { name: '计算', value: 50 }, { name: '通信', value: 60 },
        { name: '调度', value: 65 }, { name: '内存', value: null },
      ],
    },
    summary: {
      conclusion: '本次采集的 54.2 s 窗口里，Rollout 生成阶段独占 48.0 s（88.5%），而生成阶段 NPU 只忙 37%、其余 63% 在等 Host 下发——整段被「Eager 模式逐 token 解码」的下发与通信暴露彻底拖慢；真正的训练（update_actor）只占 3.5 s 且健康（设备占用 75%）。',
      topBottleneck: '生成阶段 Eager 解码，48 s 内下发 136 万次 CANN API（≈2.8 万次/s），设备占用仅 37%，AI Core MAC 利用率均值仅 3.8%',
      maxGain: '生成阶段转图模式 + 通信重叠 + 内存复用落地后，墙钟有望从 54.2 s 压到 ~34–38 s，最多省 ~30%–37%（约 16–20 s）',
    },
    actions: [
      { id: 1, priority: 'P0', problem: 'Rollout 生成 Eager 解码，48 s 内 136 万次下发，设备占用仅 37%', benefit: '-20%~-35% 墙钟', benefitNum: 28, difficulty: '中', location: '推理后端开图模式：vllm-ascend enforce_eager=False / ACL Graph / torchair 捕获', visualization: 'Timeline 视图（系统调优）' },
      { id: 2, priority: 'P0', problem: 'TP All-Reduce 解码中全暴露，27687 次累计 12.95 s（wait 9.4 s），overlap 仅 0.32 s', benefit: '-10%~-15% 墙钟', benefitNum: 12, difficulty: '中', location: 'rollout TP 配置 / 通信-计算重叠（图模式内）/ 评估 rollout TP=1', visualization: '通信视图 + Timeline 视图（系统调优）' },
      { id: 3, priority: 'P1', problem: 'aclrtFreePhysical/MallocPhysical 共 184 次累计 ~2.5 s，rollout↔train 反复申请释放物理内存', benefit: '-3%~-5% 墙钟', benefitNum: 4, difficulty: '低', location: 'PYTORCH_NPU_ALLOC_CONF 调大缓存 / 复用 KV、关闭 offload 抖动', visualization: 'Timeline 视图（系统调优）' },
      { id: 4, priority: 'P1', problem: '采样开销大：DSARandomUniform 565 次 688 ms（占设备算力 10.6%）+ ArgMaxV2 76 ms', benefit: '-2%~-4% 墙钟', benefitNum: 3, difficulty: '中', location: '采样路径：批量化采样 / 可贪心处温度=0 走 greedy', visualization: '算子视图' },
      { id: 5, priority: 'P1', problem: '解码算术强度极低：AI Core MAC 占比 3.8%、Vector 占比 4.9%，受内存/launch 限制', benefit: '提升单 kernel MFU', benefitNum: null, difficulty: '高', location: '增大 rollout 有效 batch / continuous batching，把碎 GEMM 喂成大 GEMM', visualization: '算子视图 + 详情视图' },
      { id: 6, priority: 'P1', problem: 'HCCS 小包通信：有效带宽仅 ~10 GB/s（≈理论 30 GB/s 的 33%），逐 op 低至 5.9 GB/s', benefit: '提升带宽利用', benefitNum: null, difficulty: '中', location: '增大通信 bucket / 字节对齐 / 减少切分粒度（FSDP reduce_dtype、bucket_cap）', visualization: '通信视图' },
      { id: 7, priority: 'P2', problem: 'Host 侧 aten::copy_/aten::to/_to_copy 累计 ~11.5 s，dtype/device 转换冗余', benefit: '-2% 墙钟', benefitNum: 2, difficulty: '中', location: '排查 rollout↔train 张量搬运与 dtype 转换，定长复用', visualization: 'Timeline 视图（系统调优）' },
    ],
    issues: [
      { id: '3.1', priority: 'P0', title: 'Rollout 生成 Eager 解码，设备占用仅 37%',
        evidence: 'MSTX 相位标记还原时间轴：前 48.0 s 无任何训练标记，即 Rollout 生成阶段，占墙钟 88.5%。生成阶段 48,009 ms 内设备并集忙时仅 17,748 ms = 37.0%，其中真实计算只有 3,597 ms；同期 CANN_API 调用 1,356,400 次（≈2.8 万次/s）。设备算子全是 vLLM 解码核：PagedAttentionMaskNdKernel 13,464 次、ReshapeAndCacheNdKernel 13,560 次。',
        impact: '生成阶段 63% 时间设备空等 Host，而生成占整窗 88.5%，是端到端吞吐的根本制约；RL 单次迭代的 rollout 墙钟被 Host 串行下发卡死。',
        stepsRaw: '',
        steps: ['给 rollout 推理后端开图模式：vllm-ascend 关闭 enforce_eager、启用 ACL Graph 捕获（或 torchair 图模式）', '确认 ASCEND_LAUNCH_BLOCKING 未置 1，保证下发队列可加深', '配合 3.2（先消通信暴露）再做图捕获，避免图被同步打断'],
        verification: '重采 profiling，确认生成阶段设备并集占用率从 37% 升到 ≥60%，CANN_API 调用次数显著下降，墙钟回落',
        visualization: 'Timeline 视图（系统调优）— 载入 ASCEND_PROFILER_OUTPUT/ascend_pytorch_profiler_0.db，对比 Host launch 行与 Ascend Hardware device task 行之间的大段空隙（Free），确认设备在等下发',
        codeLocations: [] },
      { id: '3.2', priority: 'P0', title: 'TP All-Reduce 在解码中完全暴露，9.4 s 花在 wait',
        evidence: 'analysis.db 通信分析：hcom_allReduce 27,687 次累计 12,954 ms，其中 wait_time 9,355 ms（72%）、transit 几乎为 0。StepTraceTime：communication 15,238 ms 中 comm_not_overlapped 14,918 ms（98%），仅 320 ms 与计算重叠。HCCS 实测均值 17.1 GB/s（约理论 30 GB/s 的 57%），包小，属延迟/同步受限而非带宽受限。',
        impact: '解码 batch 小、逐 token 串行，TP=2 的 per-layer All-Reduce 无法被计算掩盖；27,687 次小集合通信的同步等待累计近 9.4 s，是生成阶段设备空转的第二大来源。',
        stepsRaw: '',
        steps: ['图模式内开启通信-计算重叠（comm stream 与 compute stream 并行），把 0.32 s 的 overlap 拉高', '评估 rollout 阶段降低张量并行：若单卡显存放得下权重+KV，rollout 用 TP=1 可直接消除这批 All-Reduce', '减少集合通信次数：算子/层融合后合并相邻 All-Reduce，提升单次消息体量'],
        verification: '重采后 CommAnalyzerTime 中 All-Reduce 次数与 wait_time 下降，StepTraceTime.overlapped 占 communication 比例从 2% 升到 >30%',
        visualization: '通信视图 — 载入 ASCEND_PROFILER_OUTPUT/analysis.db（CommAnalyzerMatrix/CommAnalyzerBandwidth），看 HCCS 链路带宽与小包占比；Timeline 视图 — 过滤 hcom_allReduce，观察其后 device 计算行是否串行等待',
        codeLocations: [] },
      { id: '3.3', priority: 'P1', title: '物理内存反复申请/释放占 ~2.5 s',
        evidence: 'CANN_API 中 aclrtFreePhysical 92 次 2,019 ms（均 22 ms/次）、aclrtMallocPhysical 92 次 446 ms——合计 ~2.5 s（占墙钟 4.6%）花在物理内存页申请/释放，远高于普通 aclrtMalloc/Free。',
        impact: 'rollout 与 train 共卡（colocate）时反复重建显存/KV 物理映射，单次释放 22 ms 量级，叠加成秒级纯开销且打断流水。',
        stepsRaw: '',
        steps: ['调大 PYTORCH_NPU_ALLOC_CONF（增大缓存段、减少归还），让 allocator 复用而非反复 FreePhysical', '排查 rollout↔train 的权重/KV offload-reload 策略，能常驻则常驻，减少物理内存抖动'],
        verification: '重采后 aclrtFreePhysical/MallocPhysical 次数与总耗时明显下降',
        visualization: 'Timeline 视图（系统调优）— 载入 ascend_pytorch_profiler_0.db，过滤 aclrtFreePhysical/aclrtMallocPhysical，定位其在相位切换处的密集出现',
        codeLocations: [] },
      { id: '3.4', priority: 'P1', title: '采样开销大：DSARandomUniform 占设备算力 10.6%',
        evidence: '设备算子统计 DSARandomUniform 565 次累计 688 ms（均 1,218 µs/次），占全部计算设备时间 10.6%，是仅次于 MatMulV2 的第二大计算开销；配套 ArgMaxV2 565 次 76 ms。',
        impact: '解码采样（随机数生成 + argmax）单次毫秒级，且每个生成步都要走一遍，显著抬高生成阶段的有效计算占比中的"非模型"部分。',
        stepsRaw: '',
        steps: ['批量化采样：把逐步采样合并为按 batch 一次性生成随机数', '对温度=0 / 贪心解码路径直接走 greedy（argmax），跳过随机数生成', '检查是否可用更轻量的采样核实现'],
        verification: '重采后 DSARandomUniform 调用次数/总耗时下降，其占计算设备时间比例回落',
        visualization: '算子视图 — 载入 ascend_pytorch_profiler_0.db，按 opType 聚合查看 DSARandomUniform/ArgMaxV2 的调用次数与单次耗时',
        codeLocations: [] },
      { id: '3.5', priority: 'P1', title: '解码算术强度极低，单 kernel MFU 很低',
        evidence: '`TASK_PMU_INFO`（`ACL_AICORE_PIPE_UTILIZATION`）均值：**AI Core MAC 占比 `aic_mac_ratio` 仅 3.8%**、Vector 占比 `aiv_vec_ratio` 仅 4.9%，而搬运 `aic_mte2_ratio` 14.7%、标量 `aic_scalar_ratio` 13.3% / `aiv_scalar_ratio` 23.7%——计算单元被搬运与标量主导。`MatMulV2` 57,881 次均 28 µs（小 GEMM），blockDim 22–24（核数已基本铺满，瓶颈不在多核切分而在 shape 太小）。',
        impact: '解码 batch 小、算术强度低，cube/vector 几乎空转；即便解决下发与通信，碎小算子仍限制有效算力，MFU 远低于 910B 能力。',
        stepsRaw: '',
        steps: ['增大 rollout 有效 batch（continuous batching / 提高并发请求数），把 28 µs 的小 matmul 喂成大 GEMM', '算子融合（attention 已用 paged 融合核，可进一步融合 RoPE/Cast/Gather 等碎核）'],
        verification: '重采后 `aic_mac_ratio` 上升，MatMulV2 平均耗时上升而单位 token 总耗时下降',
        visualization: '主：算子视图 — `ascend_pytorch_profiler_0.db`，看 MatMulV2/PagedAttention 的耗时与次数分布；辅：详情视图 — Roofline 定性（需算子 `*.bin`，本次 DB 导出未含；可在重采时加 `_export_type` 输出 text/bin 以查看 Roofline 落点）',
        codeLocations: [] },
      { id: '3.6', priority: 'P1', title: 'HCCS 链路均衡（无慢链路），但小包导致带宽利用仅 ~33%',
        evidence: 'rank 0 到 peer 1–7 全部经 **HCCS**（无 RDMA），8 卡同处单节点，不存在跨节点慢链路风险。DP 组 6 条链路 0→2…0→7 有效带宽 **7.63–7.67 GB/s**，极差 < 1%，高度一致；0→1 较高（**14.59 GB/s**）因 TP 组承载 ~5× 字节量，属流量差异而非故障。HCCS 按字节加权有效带宽 **≈10 GB/s（31.26 GB ÷ 3.12 s）**，仅理论 ~30 GB/s 的 33%；逐 op 平均带宽低至 5.9 GB/s——典型**小包/延迟受限**（与 3.2 的 27,687 次微型 All-Reduce 互证）。仅有 rank 0 数据，无法点名慢卡 Rank ID；rank 0 All-Reduce wait_time 高达 9.4 s，需补采 ≥1–2 张其他卡才能区分「通信暴露」与「其他卡 straggler」。',
        impact: 'HCCS 小包导致带宽利用率仅 33%，加剧通信等待；快慢卡身份暂无法点名，不能排除其他卡拖慢 rank 0 的可能性。',
        stepsRaw: '',
        steps: ['增大通信 bucket、提升单次消息体量（小包是带宽利用低的根因，与 3.2 #2 同向）', '检查 FSDP `reduce_dtype` / bucket 大小与字节对齐，减少 ZeRO 切分过细导致的碎包', '补采全部 8 卡的 Level1 DB，跑 `msprof-analyze -m slow_rank/slow_link/cluster_time_summary` 做真正的快慢卡定位'],
        verification: '补采多卡后 `slow_rank` 无明显慢卡候选、各 Rank wait 对称；增大 bucket 后 `CommAnalyzerMatrix` 有效带宽从 ~10 GB/s 升到 >18 GB/s',
        visualization: '通信视图 — 载入 `ASCEND_PROFILER_OUTPUT/analysis.db`（`CommAnalyzerMatrix`/`CommAnalyzerBandwidth`），看 0→1…0→7 各 HCCS 链路带宽热力是否均衡、小包占比是否偏高',
        codeLocations: [] },
      { id: '3.7', priority: 'P2', title: 'Host 侧 dtype/device 转换冗余约 11.5 s',
        evidence: '`PYTORCH_API` 中 `aten::copy_` 92,177 次 6,030 ms、`aten::to` 8,507 次 2,793 ms、`aten::_to_copy` 4,016 次 2,699 ms——合计 ~11.5 s Host 时间在张量拷贝与类型/设备转换（注：Host 时间含异步下发，不直接等于墙钟，但反映冗余度）。',
        impact: 'rollout 与 train 之间的数据搬运、精度转换重复发生，加重 Host 负载、放大下发气泡。',
        stepsRaw: '',
        steps: ['排查 rollout 产出→train 输入的搬运链路，定长缓冲复用、减少 `.to()`/`.cpu()` 与 dtype 反复转换'],
        verification: '重采后 `aten::copy_`/`aten::to`/`_to_copy` 次数与总耗时下降',
        visualization: 'Timeline 视图（系统调优）— 载入 `ascend_pytorch_profiler_0.db`，过滤 `aten::copy_`/`aten::to`，观察其在相位边界的密集搬运',
        codeLocations: [] },
    ],
    noProblems: [
      '训练阶段（update_actor）健康：3.54 s 内设备占用 75.4%、计算 1,935 ms、通信仅 971 ms，不是瓶颈',
      '频率无降频：AICORE_FREQ 全程在 800–1800 MHz 区间，主体 1800 MHz，无异常降频',
      '多核切分充分：主要算子 blockDim 22–48（910B 核数已基本铺满）',
      '慢链路（已排查，无问题）：单节点 8 卡全 HCCS 互联，DP 组 6 条链路有效带宽极差 < 1%，无故障慢链路',
    ],
    meta: {
      date: '2026-06-02',
      dataPath: 'verl/1/e2e/localhost.localdomain_214483_20260116064439460_ascend_pt/',
      range: '单卡（rank 0 / device 0，Ascend 910B），采集墙钟 54,234 ms，Rollout 生成 ~48.0 s（88.5%）+ update_actor 3.54 s，Level1',
      version: 'torch_npu 2.7.1 / CANN 8.3.RC1',
      skills: ['mindstudio_profiler_data_check', 'ascend-profiler-db-explorer', 'cluster-fast-slow-rank-detector', 'performance-health-score', 'op-mfu-calculator', 'msinsight-view-selector'],
      advisorStatus: '失败 — 本环境 Python 为 Microsoft Store 占位 stub（执行 exit 49）；改用 Node.js v24 内置 node:sqlite 直接查询 ascend_pytorch_profiler_0.db 与 analysis.db',
      output: './Analysis Report/ascend_analysis_verl_20260602/',
    },
    diskFileInfo: {
      dir: 'verl/',
      source: 'RL 训练 Profiling',
      isLLM: 'yes',
      model: 'LLaMA 架构 LLM（8 卡，强化学习 RLHF/GRPO）',
      size: '1.33 GB',
      link: 'https://gitcode.com/zhangruoyu2/msinsight-quick-start-demo/blob/main/GUI-test-data/training/reinforcement-learning/verl.rar',
      linkText: 'verl.rar',
    },
    codeExamplesFabricated: true,
    codeExamples: [
      {
        label: 'vLLM-Ascend 开图模式（P0 主修复）',
        lang: 'python',
        issue: '3.1',
        before: `# 原配置：enforce_eager=True，每 token 独立下发 ~数千次 CANN API
# 54s 窗口内 1,356,400 次下发，设备占用仅 37%
from vllm import LLM
llm = LLM(
    model="your-model",
    enforce_eager=True,   # 禁用图捕获，逐算子 eager 执行
    tensor_parallel_size=2,
)`,
        after: `# 修改后：关闭 enforce_eager，启用 ACL Graph 图捕获
from vllm import LLM
llm = LLM(
    model="your-model",
    enforce_eager=False,  # 启用图捕获，批量重放
    tensor_parallel_size=2,
)
# 设备占用：37% → 预估 ≥60%
# CANN_API 调用次数：1,356,400 → 预估 <200,000/窗口
# 墙钟：54.2s → 预估 ~34–38s`,
      },
      {
        label: '物理内存分配器调优（P1）',
        lang: 'python',
        issue: '3.3',
        before: `# 原状态：aclrtFreePhysical 92 次 x 22ms = 2.0s 纯开销
# rollout↔train 切换时反复释放/重申请 HBM 物理页
import os
# 未设置分配器配置 → 每次 Phase 切换归还物理内存`,
        after: `# 修改后：调大缓存保留，减少物理内存页归还
import os
os.environ["PYTORCH_NPU_ALLOC_CONF"] = (
    "max_split_size_mb:512,"
    "garbage_collection_threshold:0.8,"
    "expandable_segments:True"
)
# 或在 verl 训练配置中保留 KV Cache 常驻：
# actor_rollout_ref.rollout.free_cache_engine = False
# aclrtFreePhysical 次数：92 → 预估 <10，耗时：2.0s → 预估 <0.1s`,
      },
      {
        label: 'Greedy 解码路径优化（P1）',
        lang: 'python',
        issue: '3.4',
        before: `# 原状态：所有 token 都经过 DSARandomUniform 采样
# 565 次 x 1218μs = 688ms（占设备算力 10.6%）
def sample_token(logits, temperature=0.8):
    probs = torch.softmax(logits / temperature, dim=-1)
    return torch.multinomial(probs, num_samples=1)`,
        after: `# 修改后：温度=0 时走 greedy，避免随机数生成
def sample_token(logits, temperature=0.8):
    if temperature == 0.0:
        return logits.argmax(dim=-1, keepdim=True)
    probs = torch.softmax(logits / temperature, dim=-1)
    return torch.multinomial(probs, num_samples=1)
# DSARandomUniform 占比：10.6% → 温度=0 时 0%`,
      },
    ],
  },
  // ── r20260610: Level2 单机 4 卡训练 PP=2/DP=2（msprof-analyze + advisor 全跑通）─────
  // 数据来源: Analysis Report/level2_profiling_analysis_20260610/（report.md / msprof_analyze/ / advisor/ / evidence/）
  {
    id: 'r20260610',
    filename: '../Analysis Report/level2_profiling_analysis_20260610/report.md',
    comparisonFile: '../Analysis Report/level2_profiling_analysis_20260610/report_comparison_20260610_vs_20260526.md',
    comparisonTitle: '与 20260526 报告差异对比',
    title: 'level2 单机多卡训练性能诊断报告',
    subtitle: 'PP=2 / DP=2 / TP=1',
    taskType: '单机多卡训练',
    reportDate: '2026-06-10',
    phs: {
      current: 49, grade: 'B', estimated: 61, estGrade: 'B+',
      subItems: [
        { name: '计算', value: 39 }, { name: '通信', value: 63 },
        { name: '调度', value: 50 }, { name: '内存', value: null },
      ],
      estSubItems: [
        { name: '计算', value: 55 }, { name: '通信', value: 63 },
        { name: '调度', value: 72 }, { name: '内存', value: null },
      ],
    },
    summary: {
      conclusion: '单步 ~810 ms，被流水线 bubble + 零计算通信重叠主导；4 卡 step 耗时几乎一致（极差 0.17%，无传统慢卡），瓶颈是结构性空泡而非某张卡慢',
      topBottleneck: 'PP 末级（rank 2/3）计算 400 ms ≫ 首级（rank 0/1）231 ms，首级在 P2P（batchSendRecv）空等 ~313–322 ms（占单步 ~39%）；末级超载主因是 LM-head 词表投影 + 未融合交叉熵（Cast/Exp/Sub/RealDiv/ArgMax/ReduceSum 全跑在 vocab=151936 上，末级独有 ~160 ms）',
      maxGain: '行动清单 P0/P1 全部落地后预计节省 ~15–20% 单步耗时（约 130–160 ms）',
    },
    metrics: {
      critical_path_ratio: { value: 62, note: '末级 (compute+transmit)/step；约 38% 为 bubble/free' },
      overlap_ratio:       { value: 0, status: 'bad', note: 'Overlapped 全为 0，通信全暴露' },
      op_utilization:      { value: 58, note: 'device Cube+Vector 忙时占 step 的 58%；约 42% 为 PP bubble / free 空泡' },
      pp_bubble_ratio:     { value: 39, note: '首级 batchSendRecv 空等 ~313ms / 810ms' },
      mfu:                 { achieved_tflops: 186.5, note: 'MatMul shape+耗时聚合达成算力（336 算子）' },
      mem_util:            { reserved_gb: 11.65, note: 'memory_record Total Reserved 峰值' },
    },
    actions: [
      { id: 1, priority: 'P0', problem: 'PP 末级交叉熵/LM-head 未融合，vocab=151936 上堆叠 ~160 ms 向量算子', benefit: '-10~15% 单步耗时', benefitNum: 12, difficulty: '中', location: '模型 loss 计算层（last pipeline stage CrossEntropyLoss / logits 处理）— 融合交叉熵 / vocab parallel', visualization: '算子视图 + Timeline 视图（系统调优）' },
      { id: 2, priority: 'P0', problem: 'PP 阶段切分不均：末级计算 400 ms vs 首级 231 ms，bubble ~313 ms', benefit: '-8~12% 单步耗时', benefitNum: 10, difficulty: '中', location: 'PP 流水线切分配置（末级 layer 数 / embedding+loss 归属），PP 组 (0,2)、(1,3)', visualization: 'Timeline 视图（系统调优）' },
      { id: 3, priority: 'P1', problem: '计算与通信零重叠（Overlapped = 0），通信全暴露', benefit: '-5% 单步耗时', benefitNum: 5, difficulty: '中', location: '分布式通信重叠开关（overlap_grad_reduce / overlap_param_gather）', visualization: 'Timeline 视图（系统调优）' },
      { id: 4, priority: 'P1', problem: 'micro-batch 数偏少，放大 PP warmup/cooldown bubble', benefit: '-5~8% 单步耗时', benefitNum: 6, difficulty: '低', location: '训练脚本 global/micro batch 配置（--micro-batch-size / --global-batch-size）', visualization: 'Timeline 视图（系统调优）' },
      { id: 5, priority: 'P2', problem: '动态 shape 算子 NonZero 触发 host 强制同步 + 未设 host 缓存环境变量', benefit: '-2~4% 单步耗时', benefitNum: 3, difficulty: '低', location: '训练脚本入口环境变量 / 产生 NonZero（torch.nonzero）的代码', visualization: 'Timeline 视图（系统调优）' },
      { id: 6, priority: 'P2', problem: '亲和 API 未用：优化器可替换为 torch_npu.optim.NpuFusedAdamW 融合接口', benefit: '低', benefitNum: null, difficulty: '低', location: '优化器构造处（AdamW → torch_npu.optim.NpuFusedAdamW）', visualization: 'Timeline 视图（系统调优）' },
      { id: 7, priority: 'P2', problem: 'AI Core 频率 1650 MHz（低于标称 1800 MHz）', benefit: '计算吞吐 +~8%（若为 throttling）', benefitNum: null, difficulty: '低', location: '节点功耗/散热与 NPU 频率策略（运维层，非代码）', visualization: '详情视图' },
    ],
    issues: [
      { id: '3.1', priority: 'P0', title: 'PP 末级交叉熵/LM-head 未融合，vocab=151936 上堆叠 ~160 ms 向量算子',
        evidence: 'compute_op_sum（ComputeOpPerRankStatsByOpName）显示 InputShapes 含 151936（词表维）的算子仅出现在 Rank 2/3（末级）、首级完全没有：Exp 4096,1,151936 ~16.1 ms、Sub/RealDiv ~15.7 ms、Mul ~14.6 ms、Cast ~24.0 ms、ReduceSum ~6.9 ms、ArgMaxWithValue ~6.8 ms、TransData ~10.4 ms，词表投影 MatMulV3 dgrad ~14.8 ms + ~18.5 ms（MIX_AIC），合计末级独有 ~160 ms。advisor（rank2 mstt_advisor）把末级计算 400.4 ms 拆为 Vector 180.1 ms（最大计算项）> Matmul 131.6 > FlashAttention 87.5，并将 Cast/Exp/Sub/RealDiv/Mul 4096,1,151936 全判为 vec_mte2_mte3（访存）bound、词表投影判为 mte2 bound',
        impact: '直接抬高 PP 末级 stage time，是 3.2 中 bubble 的根因；按单步 810 ms 约占 20%。交叉熵被拆成 Cast→Exp→Sub→RealDiv→Mul→ReduceSum→ArgMax 一长串独立 kernel，每个都把 [4096,151936] 大张量在 HBM 往返一遍，访存浪费极大',
        steps: ['用融合交叉熵替换手写 softmax+CE（fused/online-softmax cross-entropy，或按 chunk 计算 logits-loss，避免一次性物化 [4096,151936] fp32 中间张量）', '词表投影考虑 vocab parallel（按词表维切分到 DP/TP），减小单卡 N 维与中间张量', '复核是否有不必要的 Cast（fp16/bf16↔fp32），融合 CE 后多数可省'],
        stepsRaw: '- **改动位置**：模型 loss 计算层（last pipeline stage 的 `CrossEntropyLoss` / logits 处理），算子 `aclnnExp/aclnnSub/aclnnDiv/aclnnMaxDim` 调用点。\n1. 用**融合交叉熵**替换手写 softmax+CE（如 fused/online-softmax cross-entropy，或按 chunk 计算 logits-loss，避免一次性物化 `[4096,151936]` 的 fp32 中间张量）。\n2. 词表投影考虑 **vocab parallel**（按词表维切分到 DP/TP），减小单卡 N 维与中间张量。\n3. 复核是否有不必要的 `Cast`（fp16/bf16↔fp32），融合 CE 后多数可省。',
        verification: '重采后 ComputeOpPerRankStatsByOpName 中末级 Exp/Sub/RealDiv/ArgMax 4096,1,151936 系列消失或合并，末级 computation 从 ~400 ms 降至接近首级（~250 ms 内）',
        visualization: '主：算子视图 — 载入 evidence/rank_2_ascend_pt/kernel_details.csv，按耗时排序确认 Exp/Sub/RealDiv/Cast 4096,1,151936 与词表 MatMulV3 占比；辅：Timeline 视图 — 载入 evidence/rank_2_ascend_pt/trace_view.json，定位 step 尾部 logits/loss 段连续大向量 kernel',
        codeLocations: [] },
      { id: '3.2', priority: 'P0', title: 'PP 阶段切分不均：末级计算 400 ms vs 首级 231 ms，bubble ~313 ms',
        evidence: 'cluster_time_summary（ClusterTimeSummary）：computation = rank0 231.3 / rank1 230.9 / rank2 400.4 / rank3 401.1 ms；communicationWaitStageTime = rank0 318.3 / rank1 339.9 / rank2 175.8 / rank3 159.7 ms，而 communicationTransmitStageTime 四卡几乎相同（~101.8 ms）→ 通信里真正传输只占 ~102 ms，其余全是等待。communication_time_sum：rank0 hcom_batchSendRecv__128_4_1 单次 158.5 ms（wait 158.1）、__128_5_1 154.9 ms；HcclPerRankStats 中 batchSendRecv 在 rank0/1 各 313.9 / 323.0 ms，rank2/3 仅 72.7 / 75.0 ms',
        impact: '首级 ~313 ms（占单步 ~39%）纯空泡；4 卡 step 仍同为 ~810 ms，是被这段 bubble 对齐出来的，并非真有效计算',
        steps: ['将末级 LM-head/loss 负载与 transformer 层重新均衡：把 1–2 层 transformer 从首级移到末级以外，或让末级少算 transformer 层补偿 loss 开销，使两级 stage time 接近', '配合 3.1 减小末级 loss 开销后再做细粒度均衡'],
        stepsRaw: '- **改动位置**：PP 流水线切分配置（Megatron 类：`--num-layers-per-virtual-pipeline-stage` / 末级 layer 数 / embedding+loss 归属），PP 组 (0,2)、(1,3)。\n1. 将末级的 LM-head/loss 负载与 transformer 层重新均衡：把 1–2 层 transformer 从首级**移到**末级以外，或反之让末级少算 transformer 层来补偿 loss 开销，使两级 stage time 接近。\n2. 配合 3.1 减小末级 loss 开销后再做细粒度均衡。',
        verification: '重采后 ClusterTimeSummary.computation 各 rank 极差 < 10%，communicationWaitStageTime 首级从 ~318 ms 降到与末级同量级（< 180 ms）',
        visualization: 'Timeline 视图（系统调优）— 载入 evidence/rank_0_ascend_pt/trace_view.json，过滤 hcom_batchSendRecv，观察 Ascend Hardware 泳道两段 ~155 ms 连续空白（首级等末级）；与 rank_2 同期对照，末级此时正在算 loss',
        codeLocations: [] },
      { id: '3.3', priority: 'P1', title: '计算与通信零重叠（Overlapped = 0），通信全暴露',
        evidence: 'step_trace_time.csv 与 ClusterTimeSummary 中四卡 Overlapped / communicationOverlapComputation 全为 0；Communication(Not Overlapped) = 261–442 ms，即所有通信都串行暴露在关键路径上',
        impact: '即便扣除 bubble 等待，纯传输 ~102 ms/卡 也完全未被计算掩盖；这部分若与反向计算并发可基本隐藏',
        steps: ['开启梯度通信-计算 overlap（如 overlap_grad_reduce / overlap_param_gather）', '确认 HCCL 通信走独立 stream，且 P2P 与下一 micro-batch 计算可并发'],
        stepsRaw: '- **改动位置**：分布式通信重叠开关（梯度 reduce-scatter / all-gather 与反向计算 overlap；P2P 与计算并发），通信流是否独立 stream。\n1. 开启梯度通信-计算 overlap（如 `overlap_grad_reduce` / `overlap_param_gather`）。\n2. 确认 HCCL 通信走独立 stream，且 P2P 与下一 micro-batch 计算可并发。',
        verification: '重采后 ClusterTimeSummary.communicationOverlapComputation > 0，Communication(Not Overlapped) 较当前下降',
        visualization: 'Timeline 视图（系统调优）— 载入 evidence/rank_0_ascend_pt/trace_view.json，对齐 Ascend Hardware 与 Communication 泳道，确认通信块下方无计算块覆盖',
        codeLocations: [] },
      { id: '3.4', priority: 'P1', title: 'micro-batch 数偏少，放大 PP warmup/cooldown bubble',
        evidence: 'ClusterCommunicationTime 中首级 P2P 仅 __*_3/_4/_5 三段（其中两段 ~155 ms 为大空等），bubble 呈大块而非被多 micro-batch 摊薄；理论 bubble ≈ (p-1)/(p-1+m)，pp=2 时 m 越小 bubble 越大',
        impact: '与 3.2 叠加，micro-batch 少使 warmup/cooldown 三角区占比偏高',
        steps: ['在显存允许范围内增大 micro-batch 数，稀释 bubble；可配合 interleaved 1F1B 调度'],
        stepsRaw: '- **改动位置**：训练脚本 global/micro batch 配置（`--micro-batch-size` / `--global-batch-size` 决定的 micro-batch 数）。\n1. 在显存允许范围内增大 micro-batch 数，稀释 bubble；可配合 interleaved 1F1B 调度。',
        verification: '重采后首级 communicationWaitStageTime 占比随 micro-batch 数增加而下降，bubble 率趋近理论值',
        visualization: 'Timeline 视图（系统调优）— 载入 evidence/rank_0_ascend_pt/trace_view.json，观察 warmup/cooldown 三角空白相对稳态段的占比',
        codeLocations: [] },
      { id: '3.5', priority: 'P2', title: '动态 shape 算子 NonZero 触发 host 强制同步 + 未设 host 缓存环境变量',
        evidence: 'communication_bottleneck 多条 reason 指向 [Device-bound] max start-time-diff op aclnnNonzeroV2_NonzeroAiCore_NonZero（diff 280.7 / 281.0 / 359.3 us）；cann_api_sum 中 aclnnNonzeroV2 count 96、aclrtSynchronizeDevice/DeviceSynchronize 合计 ~46%、StreamSynchronize 19%。advisor 报 Operator Dynamic Shape Issues 与 Environment Variable Issues（High：ACLNN_CACHE_LIMIT、HOST_CACHE_CAPACITY 未设）',
        impact: '每次 NonZero 同步打断算子异步下发，叠加在 bubble 上放大空泡；动态 shape 还使 host 反复编译，是同步类 API 占比畸高的诱因之一',
        steps: ['入口设 torch_npu.npu.set_compile_mode(jit_compile=False)、config.allow_internal_format = False', '设 export ACLNN_CACHE_LIMIT=100000、export HOST_CACHE_CAPACITY=20，缓存动态 shape 的 host 下发', '用静态 shape 等价实现替换 nonzero（固定上界 + mask 选择），消除 host 回读同步；复核不必要的 .item()/.cpu()'],
        stepsRaw: '- **改动位置**：①训练脚本入口（环境变量 / 编译模式）；②产生 `NonZero`/`aclnnNonzeroV2` 的代码（通常为 mask/索引、`torch.nonzero`、动态 padding 逻辑）。\n1. 入口设 `torch_npu.npu.set_compile_mode(jit_compile=False)`、`torch_npu.npu.config.allow_internal_format = False`（advisor 建议）。\n2. 设环境变量 `export ACLNN_CACHE_LIMIT=100000`、`export HOST_CACHE_CAPACITY=20`，缓存动态 shape 的 host 下发，降低 host bubble。\n3. 用静态 shape 等价实现替换 `nonzero`（如固定上界 + mask 选择），消除 host 回读同步；复核不必要的 `.item()`/`.cpu()` 引发的 `aclrtSynchronizeDevice`。',
        verification: '重采后 cann_api_sum 中 aclnnNonzeroV2 与 aclrtSynchronizeDevice 调用次数/耗时显著下降；advisor 不再报动态 shape / 环境变量问题',
        visualization: 'Timeline 视图（系统调优）— 载入 evidence/rank_2_ascend_pt/trace_view.json，过滤 host 侧 aclrtSynchronizeDevice 与 NonZero，看其与 device 空白的对齐',
        codeLocations: [] },
      { id: '3.6', priority: 'P2', title: '亲和 API 未用：优化器可替换为 torch_npu.optim.NpuFusedAdamW 融合接口',
        evidence: 'advisor Affinity API Issues（schedule）提示可替换的亲和接口 torch_npu.optim.NpuFusedAdamW、torch_npu.npu_confusion_transpose；对应 compute_op_sum 中 ApplyAdamWV2（AI_VECTOR_CORE，各卡 ~9 ms/step）与多处 TransData/Cast',
        impact: '未用融合优化器/亲和接口时，optimizer step 与 transpose 走非最优实现，host 下发条数与 device kernel 数偏多（量级较小，故 P2）',
        steps: ['替换为 torch_npu.optim.NpuFusedAdamW，减少 optimizer 阶段 kernel 数与下发开销', '评估 torch_npu.npu_confusion_transpose 替换现有 transpose 逻辑'],
        stepsRaw: '- **改动位置**：优化器构造处（`AdamW` → `torch_npu.optim.NpuFusedAdamW`）、含 confusion-transpose 的算子调用点。\n1. 替换为 `torch_npu.optim.NpuFusedAdamW`，减少 optimizer 阶段 kernel 数与下发开销。\n2. 评估 `torch_npu.npu_confusion_transpose` 替换现有 transpose 逻辑。',
        verification: '重采后 advisor 不再列出该亲和 API；ApplyAdamWV2 相关下发/耗时下降',
        visualization: 'Timeline 视图（系统调优）— 载入 evidence/rank_2_ascend_pt/trace_view.json，定位 optimizer 段 ApplyAdamWV2 系列 kernel 与 host launch 间隙',
        codeLocations: [] },
      { id: '3.7', priority: 'P2', title: 'AI Core 频率 1650 MHz（低于标称 1800 MHz）',
        evidence: 'freq_analysis（AbnormalFrequencyRanks）四卡 aicoreFrequency 均为 1650 MHz，被工具判为异常（既非 1800 MHz 满频也非 800 MHz 空闲）',
        impact: '若为功耗/温度 throttling，相对 1800 MHz 满频约损失 ~8% 计算吞吐；也可能是该芯片型号实际工作频率（需结合硬件手册确认）',
        steps: ['用 npu-smi info 查看实时频率/温度/功耗，确认是否 throttling；排查散热与功率上限设置'],
        stepsRaw: '- **改动位置**：节点功耗/散热与 NPU 频率策略（运维层，非代码）。\n1. 用 `npu-smi info` 查看实时频率/温度/功耗，确认是否 throttling；排查散热与功率上限设置。',
        verification: '满载下 AI Core 频率稳定在 1800 MHz；freq_analysis 不再标记异常',
        visualization: '详情视图 — 暂无直接 .bin 落盘文件；以 evidence/rank_0_ascend_pt/kernel_details.csv 中 AI Core 算子实测耗时辅助佐证（同 shape 算子是否普遍偏慢）',
        codeLocations: [] },
    ],
    noProblems: [
      '无传统慢卡（slow_rank 未产出慢卡记录；ClusterTimeSummary.stepTime 四卡 809.9–810.8 ms，极差 0.17% < 5%，集群 step 级高度均衡）',
      '通信链路带宽无异常离群（communication_matrix_sum 中 HCCS 18.7–20.9 GB/s、LOCAL 326–333 GB/s 各同类一致，large_packet_ratio≈1.0，无单条慢链路；带宽中等但非头号瓶颈）',
      '计算型慢卡排除（同 shape 算子跨卡耗时一致：FlashAttentionScore 各卡 867–883 µs、FlashAttentionScoreGrad 2.24–2.29 ms；末级耗时高是负载内容不同——多了 loss，非硬件劣化）',
      'MoE 负载：ep_load_balance 无数据（非 MoE 模型），不适用',
    ],
    meta: {
      date: '2026-06-10',
      dataPath: 'level2/rank_{0,1,2,3}_ascend_pt/ASCEND_PROFILER_OUTPUT/',
      range: '单机 4 卡（device 0/1/4/5），step 13 单步；Profiler Level2，record_shapes=true / profile_memory=true / aic_metrics=ACL_AICORE_PIPE_UTILIZATION，~810 ms',
      version: 'torch_npu 2.7.1 / CANN 8.3.RC1',
      skills: ['mindstudio_profiler_data_check', 'ascend_pytorch_profiler_db_explorer', 'cluster-fast-slow-rank-detector', 'timeline-swimlane-analyzer', 'op-mfu-calculator', 'performance-health-score', 'msinsight-view-selector'],
      advisorStatus: 'msprof-analyze advisor 已调用 — 对末级 rank2 执行 advisor all，结果（mstt_advisor_*.html + log/*.xlsx）并入第 3 章证据（Vector/Cube bound 清单、动态 shape、环境变量、亲和 API、Packet 分析）；集群 10 个 recipe（cluster_time_summary / hccl_sum / compute_op_sum / communication_time_sum / communication_matrix_sum / communication_bottleneck / cann_api_sum / free_analysis / freq_analysis / slow_rank）为主证据来源',
      output: './Analysis Report/level2_profiling_analysis_20260610/',
    },
    // 与 report.md §5「数据来源与落盘信息」一致；运行时若 fetch 到报告会被 parseDiskFileInfo 覆盖
    diskFileInfo: {
      dir: 'level2/',
      source: '分布式训练 Profiling',
      isLLM: 'yes',
      model: 'Qwen 系列 LLM（vocab=151936）',
      size: '~47 MB（evidence 举证副本）',
      link: 'https://gitcode.com/zhangruoyu2/msinsight-quick-start-demo/blob/main/GUI-test-data/training/single-node/level2.rar',
      linkText: 'level2.rar',
      basis: 'vocab=151936 命中 Qwen 系列专属 tokenizer；evidence 含 FlashAttentionScore/Grad、RmsNormGrad、ApplyAdamWV2 等训练/反向算子 → LLM 训练。具体参数规模因被 PP/TP 切分、无法从单卡 shape 反推，留空不写。',
    },
    codeExamplesFabricated: true,
    codeExamples: [
      {
        label: '融合交叉熵替换手写 softmax+CE（避免大 logits 落 GM）',
        lang: 'python',
        issue: '3.1',
        before: `# last pipeline stage — 计算 loss
logits = lm_head(hidden)                      # [4096, 1, 151936]
# 原写法：手写 softmax+CE，大 logits 在 HBM 反复往返
loss = manual_cross_entropy(logits, labels)
loss.backward()`,
        after: `# last pipeline stage — 计算 loss
logits = lm_head(hidden)                      # [4096, 1, 151936]
# 修改后：vocab-parallel 融合交叉熵，避免物化 fp32 大中间张量
from megatron.core.tensor_parallel import vocab_parallel_cross_entropy
loss = vocab_parallel_cross_entropy(logits, labels)
# 消除 Cast/Exp/Sub/RealDiv/Mul [4096,1,151936] 链路，节省末级 ~160ms
loss.backward()`,
      },
      {
        label: 'PP 阶段切分再均衡（末级 400ms → 接近首级）',
        lang: 'python',
        issue: '3.2',
        before: `# 原配置：lm_head + loss 全堆最后一级
# stage0(rank0/1) computation 231ms，stage1(rank2/3) 400ms，首级空等 ~313ms`,
        after: `# 修改后：让末级少算 1-2 层 transformer 补偿 loss 开销
# Megatron 启动参数：
# --decoder-last-pipeline-num-layers <少放 1-2 层>
# 目标：两级 stage time 接近，首级 communicationWaitStageTime 318ms → <180ms`,
      },
      {
        label: '通信-计算重叠（Overlapped=0 → >0）',
        lang: 'python',
        issue: '3.3',
        before: `# 原状态：step_trace_time.csv Overlapped = 0.0
# 纯传输 ~102ms/卡 完全串行暴露在关键路径`,
        after: `# 修改后：开启分布式通信重叠
# --overlap-grad-reduce      # 梯度 reduce-scatter 与反向重叠
# --overlap-param-gather     # 参数 all-gather 与前向重叠
# 确认 HCCL 走独立 stream，P2P 与下一 micro-batch 计算可并发`,
      },
    ],
  },
  // ── r20260618ub: MultiProfLevel2MemoryUB 16 卡多机训练（2节点×8卡，TP=8/DP=2，Level2 DB）─────
  // 数据来源: Analysis Report/MultiProfLevel2MemoryUB_profiling_analysis_20260618/（report.md / msprof_analyze/ / advisor_output/ / evidence/）
  {
    id: 'r20260618ub',
    filename: '../Analysis Report/MultiProfLevel2MemoryUB_profiling_analysis_20260618/report.md',
    title: 'MultiProfLevel2MemoryUB 16 卡多机训练性能诊断报告',
    subtitle: 'TP=8 / DP=2 · 2 节点 × 8 卡',
    taskType: '多机多卡训练',
    reportDate: '2026-06-18',
    phs: {
      current: 64, grade: 'B+', estimated: 77, estGrade: 'A',
      subItems: [
        { name: '计算', value: 60 }, { name: '通信', value: 57 },
        { name: '调度', value: 84 }, { name: '内存', value: null },
      ],
      estSubItems: [
        { name: '计算', value: 75 }, { name: '通信', value: 70 },
        { name: '调度', value: 92 }, { name: '内存', value: null },
      ],
    },
    summary: {
      conclusion: '单步耗时 ~6.33 s，瓶颈是「Host 下发被在线编译/AICPU 拖慢」叠加「TP 通信重叠不足」——计算单元被 host 喂不饱而周期性饿死，整集群在 collective barrier 上互等',
      topBottleneck: 'Rank 15 设备空闲（free）40.7%（2.57 s/步）、slowAffectCount=70（全集群最高阻塞源）；根因是 8390 次在线算子编译（aclopCompileAndExecute，352 ms）+ 占 40.4% 的 AICPU 融合算子（AllGatherMatmulAicpu / MatmulReduceScatterAicpu）',
      maxGain: '行动清单 P0/P1 全部落地后预估节省 ~12–18% 单步耗时（约 0.8–1.1 s）',
    },
    metrics: {
      op_utilization: { value: 60, note: 'device-busy 77% 代理，按 AICPU 40.4% / Block Dim 0.46 下修至 60' },
      overlap_ratio:  { value: 51, status: 'warn', note: 'node2 ~51%（node1 ~83%），node2 重叠不足' },
      max_lane_idle:  { value: 40.7, status: 'bad', note: 'Rank 15 free 占比（node2 均值 18.3%）' },
      step_cv:        { value: 0.9, display: '0.9', note: '16 卡单步 6.288–6.468 s，跨 rank CV 0.92%（仅 1 step）' },
    },
    actions: [
      { id: 1, priority: 'P0', problem: '8390 次在线算子编译（aclopCompileAndExecute）拖慢 Host 下发', benefit: '-5~8% 单步耗时', benefitNum: 6, difficulty: '低', location: '训练启动脚本/入口（torch_npu 初始化处，所有 rank）— 关闭 JIT 在线编译、禁用内部格式自动转换', visualization: 'Timeline 视图（系统调优）' },
      { id: 2, priority: 'P0', problem: 'TP 融合算子走 AICPU 路径（占 40.4% 计算时间）', benefit: '-8~10% 计算', benefitNum: 9, difficulty: '中', location: 'TP/序列并行通信-计算融合配置（Megatron --tp-comm-overlap / MC2 融合算子开关、torch_npu 融合算子注册）', visualization: '算子视图' },
      { id: 3, priority: 'P1', problem: 'Rank 15 等节点2多卡 Host 饿死型空闲（free 40.7%/20%，slowAffectCount=70）', benefit: '-均衡，-5~8%', benefitNum: 6, difficulty: '中', location: 'node2 各 rank 的 host 侧（CPU 绑核 / dataloader / 下发线程）', visualization: 'Timeline 视图（系统调优）' },
      { id: 4, priority: 'P1', problem: 'HCCS/SDMA 节点内带宽仅 ~54% 理论值 + 计算通信带宽抢占', benefit: '-3~5% 通信', benefitNum: 4, difficulty: '中', location: '通信算子字节对齐 / 通信-计算 stream 划分（HCCL 配置 + 融合算子 tiling）', visualization: '通信视图' },
      { id: 5, priority: 'P1', problem: '跨节点 RDMA 小包（82% 包 <50% 大包阈值）+ 通信重传', benefit: '-通信尾延迟', benefitNum: null, difficulty: '中', location: 'DP 梯度通信粒度 / bucket 聚合（DDP/优化器通信桶大小）+ RDMA 网络配置', visualization: '通信视图' },
      { id: 6, priority: 'P2', problem: 'Block Dim 未饱和（46% 时间占比算子核数不足）', benefit: '-2~4% 计算', benefitNum: 3, difficulty: '中', location: '算子 tiling / blockDim 设置（多为框架/CANN 算子，部分需版本升级）', visualization: '算子视图' },
      { id: 7, priority: 'P2', problem: '可用亲和 API 未启用（NpuFusedAdamW / npu_confusion_transpose）', benefit: '-小幅下发', benefitNum: null, difficulty: '低', location: '优化器构造处与对应 transpose 调用点', visualization: '算子视图' },
      { id: 8, priority: 'P2', problem: '跨节点 DP AllReduce 早期迭代巨额互等（node1 等 node2 最高 777 ms）', benefit: '消除尖峰', benefitNum: null, difficulty: '中', location: '跨节点通信初始化 / 首迭代 overlap', visualization: '通信视图' },
    ],
    issues: [
      { id: '3.1', priority: 'P0', title: '8390 次在线算子编译（aclopCompileAndExecute）拖慢 Host 下发',
        evidence: 'advisor（Rank 15）Operator Dispatch Issues：aclopCompileAndExecute Counts=8390，Elapsed Time=352379.97 us（352 ms）。free_analysis 配套佐证：多卡出现 "Abnormal CANN layer: long time between two node@launch" 间隙——Rank 11 累计 21.7 ms、Rank 15 20.8 ms、Rank 8 11.5 ms（top-160 free 事件，单条 launch 间隙最高 5.2 ms），以及 "Idle Pytorch layer: no task dispatched" 事件。这些都是 Host 下发跟不上、NPU 饿死的直接特征',
        impact: '在线编译串行阻塞下发线程 → device 周期性空泡 → 落到 collective barrier 上放大为全集群互等。是 Rank 15 free 40.7% 与 node2 整体 free 18.3%（vs node1 9.1%）的首要驱动',
        steps: ['关闭 JIT 在线编译、禁用内部格式自动转换：torch_npu.npu.set_compile_mode(jit_compile=False)、torch_npu.npu.config.allow_internal_format = False', '确认无动态 shape 触发反复编译（固定 seq_len / pad 到定长）'],
        stepsRaw: '- **改动位置**：训练启动脚本/入口（torch_npu 初始化处，所有 rank）\n1. 关闭 JIT 在线编译、禁用内部格式自动转换：\n```python\ntorch_npu.npu.set_compile_mode(jit_compile=False)\ntorch_npu.npu.config.allow_internal_format = False\n```\n2. 确认无动态 shape 触发反复编译（固定 seq_len / pad 到定长）。',
        verification: '重采 profiling，确认 aclopCompileAndExecute 次数从 8390 降至接近 0；free_analysis 中 "long time between two node@launch" 间隙消失或 <2 ms；Rank 15 free 占比从 40.7% 降至 <15%',
        visualization: 'Timeline 视图（系统调优）— 载入 evidence/rank15_ascend_pt/ascend_pytorch_profiler_15.db，过滤 host 侧 aclopCompileAndExecute / launch，观察与 device task 之间的 Free 间隙',
        codeLocations: [] },
      { id: '3.2', priority: 'P0', title: 'TP 融合算子走 AICPU 路径（占 40.4% 计算时间）',
        evidence: 'advisor（Rank 15）AICPU Issues（最高严重度，红）：AllGatherMatmulAicpu（640 次，1712958 us）、MatmulReduceScatterAicpu（多组），AICPU 类算子 Elapsed Time 合计 2826670 us（2826 ms）、时间占比 0.404。compute_op_sum 同口径：这两类算子是各 rank 计算耗时最大头；同 OpType 同 Count 下，Rank 9 比 Rank 15 慢 2.2×（MatmulReduceScatter R9 2280 ms vs R15 1056 ms），说明融合算子内部嵌入了通信等待且实现走低效 AICPU 通路',
        impact: 'AICPU 通路需要 host 介入、且不吃满 cube，是计算利用率上不去（计算子项仅 60%）与下发压力的核心',
        steps: ['确认 AllGatherMatmul/MatmulReduceScatter 走 MIX_AIC（cube）融合路径而非 *Aicpu 变体；检查 CANN/torch_npu 版本是否支持该 shape/dtype 的 cube 融合', '若特定 shape 回退 AICPU，调整切分（TP size / sequence parallel 粒度）使其命中 cube 融合白名单'],
        stepsRaw: '- **改动位置**：TP/序列并行通信-计算融合配置（Megatron `--tp-comm-overlap` / MC2 融合算子开关、torch_npu 融合算子注册）\n1. 确认 `AllGatherMatmul`/`MatmulReduceScatter` 走 MIX_AIC（cube）融合路径而非 `*Aicpu` 变体；检查 CANN/torch_npu 版本是否支持该 shape/dtype 的 cube 融合。\n2. 若特定 shape 回退 AICPU，调整切分（TP size / sequence parallel 粒度）使其命中 cube 融合白名单。',
        verification: '重采后 compute_op_sum 中 *Aicpu 算子 Count→0 或时间占比 <5%；advisor AICPU Issues 消失；计算子项利用率提升',
        visualization: '算子视图 — 载入 evidence/rank15_ascend_pt/ascend_pytorch_profiler_15.db，按 OpType 聚合查看 AllGatherMatmulAicpu/MatmulReduceScatterAicpu 耗时占比与 TaskType=AI_CPU 标记',
        codeLocations: [] },
      { id: '3.3', priority: 'P1', title: 'Rank 15 等节点2多卡 Host 饿死型空闲（free 40.7%/20%，slowAffectCount=70）',
        evidence: 'cluster_time_summary（单 active step，step≈6.33 s）：Rank 15 computing 仅 52.2%、free 40.7%（2.57 s），为全集群最低算占比 / 最高空闲；Rank 8/11/13 free 20–22%；node2 平均 free 18.3% vs node1 9.1%。slow_rank：Rank 15 slowAffectCount=70（次高 R0/R8=24），是 barrier 最大阻塞源。各 rank 算子 Count 完全一致（无负载切分不均），故属"伪快卡/Host 下发型慢卡"：NPU 饿死→空闲→到达 collective 最晚→阻塞全集群',
        impact: '该症状是 3.1/3.2 的集群级表现，直接决定单步被拉长到 6.33 s。修好 3.1/3.2 后此项自然收敛',
        steps: ['先落地 3.1（关 JIT）、3.2（去 AICPU）——消除下发阻塞源', 'node2 host 侧排查：下发线程绑核（taskset/CPU affinity）、dataloader worker 是否抢占、Python GC', '复测 slowAffectCount 分布是否趋于均匀'],
        stepsRaw: '- **改动位置**：node2 各 rank 的 host 侧（CPU 绑核 / dataloader / 下发线程）\n1. 先落地 3.1（关 JIT）、3.2（去 AICPU）——消除下发阻塞源。\n2. node2 host 侧排查：下发线程绑核（`taskset`/`CPU affinity`）、dataloader worker 是否抢占、Python GC。\n3. 复测 `slowAffectCount` 分布是否趋于均匀。',
        verification: '重采后各 rank free 占比极差 <10%、Rank 15 slowAffectCount 回落到与其他 rank 同量级；单步耗时下降',
        visualization: '主：Timeline 视图（系统调优）— evidence/rank15_ascend_pt/ascend_pytorch_profiler_15.db，看 device 泳道周期性空泡与 host launch 对齐。辅：通信视图 — evidence/cluster/slow_rank.db，查看 SlowRank 表各 rank slowAffectCount',
        codeLocations: [] },
      { id: '3.4', priority: 'P1', title: 'HCCS/SDMA 节点内带宽仅 ~54% 理论值 + 计算通信带宽抢占',
        evidence: 'ClusterCommunicationBandwidth 按链路类型聚合（size-weighted）：HCCS 实测 16.35 GB/s、SDMA 16.35 GB/s，均约为节点内理论 ~30 GB/s 的 54%；16 卡带宽极差 <5%（16.1–16.8 GB/s，无慢链路）。advisor Bandwidth Contention：计算与通信并发时 "SDMA 带宽低于 14.4 GB/s"。（RDMA 24.0 GB/s ≈ 96% 理论值，健康）',
        impact: 'node1 单步通信总量 3.52 s（绝大部分被计算重叠），node2 1.0 s；HCCS 效率不足直接抬高 TP 融合算子内部耗时，是通信子项仅 57% 的主因',
        steps: ['检查 SDMA/HCCS 传输地址与数据块字节对齐（512B/cacheline）', '让通信与计算尽量独立 stream，降低带宽抢占；评估 HCCL_INTRA_PCIE_ENABLE/HCCL_INTRA_ROCE_ENABLE 等拓扑配置'],
        stepsRaw: '- **改动位置**：通信算子字节对齐 / 通信-计算 stream 划分（HCCL 配置 + 融合算子 tiling）\n1. 检查 SDMA/HCCS 传输地址与数据块字节对齐（512B/cacheline）。\n2. 让通信与计算尽量独立 stream，降低带宽抢占；评估 `HCCL_INTRA_PCIE_ENABLE`/`HCCL_INTRA_ROCE_ENABLE` 等拓扑配置。',
        verification: '重采后 HCCS/SDMA size-weighted 带宽 ≥ 24 GB/s（>80% 理论），advisor Bandwidth Contention 告警消失',
        visualization: '通信视图 — 载入 evidence/cluster/cluster_analysis.db，查看 ClusterCommunicationBandwidth 按 band_type 的带宽矩阵',
        codeLocations: [] },
      { id: '3.5', priority: 'P1', title: '跨节点 RDMA 小包（82% 包 <50% 大包阈值）+ 通信重传',
        evidence: 'ClusterCommunicationBandwidth（band_type=RDMA）：180 条记录中 82.2% 的 large_packet_ratio < 0.5（均值 0.178），即跨节点传输被小包主导；advisor Packet Analysis "过小的通信数据包可能导致 host 传递瓶颈"，且 Retransmission Analysis 列出重传算子 top10',
        impact: '小包抬高跨节点通信的 host 开销与尾延迟（虽 RDMA 聚合带宽 24 GB/s 尚可，但小包/重传增加抖动与等待）',
        steps: ['增大梯度通信 bucket（减少小包数量），开启梯度通信聚合', '排查重传：检查 RoCE/网络 PFC、链路误码、HCCL_RDMA_* 超时配置'],
        stepsRaw: '- **改动位置**：DP 梯度通信粒度 / bucket 聚合（DDP/优化器通信桶大小）+ RDMA 网络配置\n1. 增大梯度通信 bucket（减少小包数量），开启梯度通信聚合。\n2. 排查重传：检查 RoCE/网络 PFC、链路误码、`HCCL_RDMA_*` 超时配置。',
        verification: '重采后 RDMA large_packet_ratio<0.5 占比 <30%；advisor Packet/Retransmission 告警消失',
        visualization: '通信视图 — 载入 evidence/cluster/cluster_analysis.db，过滤 band_type=\'RDMA\' 看 large_packet_ratio 与 package_size 分布',
        codeLocations: [] },
      { id: '3.6', priority: 'P2', title: 'Block Dim 未饱和（46% 时间占比算子核数不足）',
        evidence: 'advisor（Rank 15）Block Dim Issues：部分算子未用满 25 个 AICore / 50 个 AIVector，涉及 MatmulReduceScatter, Mul, AllGatherMatmul, ZerosLike, MatMul, FlashAttentionScoreGrad, ApplyAdamW, FlashAttentionScore, EmbeddingDenseGrad, GatherV2，时间占比 0.46',
        impact: '核间并行不足，单算子吞吐受限，叠加在 3.2 上共同压低计算利用率',
        steps: ['优先随 3.2 一起解决（cube 融合通常自带更优 blockDim）', '对自定义算子，按硬件核数设 blockDim（耦合架构用 GetCoreNumAic/Aiv）'],
        stepsRaw: '- **改动位置**：算子 tiling / blockDim 设置（多为框架/CANN 算子，部分需版本升级）\n1. 优先随 3.2 一起解决（cube 融合通常自带更优 blockDim）。\n2. 对自定义算子，按硬件核数设 blockDim（耦合架构用 `GetCoreNumAic/Aiv`）。',
        verification: '重采后 advisor Block Dim Issues 涉及算子时间占比 <0.2',
        visualization: '算子视图 — 载入 evidence/rank15_ascend_pt/ascend_pytorch_profiler_15.db，查看上述算子的 blockDim/mixBlockDim（COMPUTE_TASK_INFO）',
        codeLocations: [] },
      { id: '3.7', priority: 'P2', title: '可用亲和 API 未启用（NpuFusedAdamW / npu_confusion_transpose）',
        evidence: 'advisor（Rank 15）Affinity API Issues：建议启用 torch_npu.optim.NpuFusedAdamW、torch_npu.npu_confusion_transpose（cann-8.0.0 / torch_npu 环境）',
        impact: '未用融合优化器/亲和算子，多发若干下发条数与 host 开销（幅度小）',
        steps: ['用 torch_npu.optim.NpuFusedAdamW 替换原 AdamW'],
        stepsRaw: '- **改动位置**：优化器构造处与对应 transpose 调用点\n1. 用 `torch_npu.optim.NpuFusedAdamW` 替换原 AdamW。',
        verification: '重采后 advisor Affinity API 建议消失，ApplyAdamW 相关下发条数下降',
        visualization: '主：advisor 报告 — 载入 evidence/rank15_ascend_pt/mstt_advisor_rank15.html，定位「Affinity API Issues」；辅：算子视图 — ApplyAdamW(243×)/Transpose(20×) 即 NpuFusedAdamW/npu_confusion_transpose 的替换候选',
        codeLocations: [] },
      { id: '3.8', priority: 'P2', title: '跨节点 DP AllReduce 早期迭代巨额互等（node1 等 node2 最高 777 ms）',
        evidence: 'hccl_sum 的 HcclTopOpStats：一批 cross-node DP hcom_allReduce__* (cnt=2) 呈极端双峰——同一算子 min ≈ 36 us、max ≈ 777 ms，且 max 一律落在 node1（r0–r7）、min 一律落在 node2（r8–r15）对应 DP 对（如 r7↔r15、r0↔r8）。说明早期迭代/初始化阶段 node1 先到、长时间等 node2。该量级远超稳态单步（稳态 hcom_allReduce__624_0_1 mean 仅 72 us），属 warmup/首迭代尖峰',
        impact: '不进入稳态单步关键路径，但拉高整段采集墙钟、并提示跨节点同步初始不齐',
        steps: ['排查首次 DP AllReduce 是否含连接建立/参数广播阻塞；预热通信域'],
        stepsRaw: '- **改动位置**：跨节点通信初始化 / 首迭代 overlap\n1. 排查首次 DP AllReduce 是否含连接建立/参数广播阻塞；预热通信域。',
        verification: '重采后该批 allReduce 的 max/min 比值收敛（<10×）',
        visualization: '通信视图 — 载入 evidence/cluster/hccl_sum.db 查 HcclTopOpStats，看 hcom_allReduce__* 的 Min/Max 双峰（max≈777ms 落 node1、min≈36µs 落 node2 对应 DP 对 r7↔r15 等）',
        codeLocations: [] },
    ],
    noProblems: [
      '数据完整性：16/16 Rank profiler_info_*.json、analysis.db、ascend_pytorch_profiler_*.db 齐全，均正常 Stop、已解析（DB 模式 37 张表），芯片均 Ascend910B',
      '无慢链路：HCCS（16.1–16.8 GB/s）、RDMA（24.0 GB/s）各 rank 极差 <5%，无单链路异常；问题是系统性带宽效率（3.4），非某条慢链路',
      'AICore 频率：16 卡均 1850 MHz（boost 态，非 800 MHz 降频/异常），freq_analysis 标记仅因 ≠1800 MHz 的形式判定，非真实降频故障',
      '无硬件慢卡：HBM 实测平均带宽两节点一致（~20.4 GB/s，峰值 138–186 GB/s），各 rank 算子 Count 一致，排除算力硬件劣化/负载切分不均',
      '单步耗时均衡：16 卡单步耗时 6.288–6.468 s，跨 rank CV 0.92%，集群在 step 级高度同步（问题在 step 内部时间构成，而非 step 总时长离散）',
      '显存容量：未确认——memory_record 峰值仅 0.31 GB，明显不完整，故不据此判 OOM 风险',
    ],
    meta: {
      date: '2026-06-18',
      dataPath: 'MultiProfLevel2MemoryUB_db/（2 节点 × 8 卡 = 16 Rank）',
      range: 'Rank 0–15（2 节点 × 8 卡），单 active step（step id=2，schedule: skip_first=1/wait=1/warmup=0/active=1/repeat=1），单步跨度 ~6.33 s（STEP_TIME 6.479e9 ns，advisor E2E 6326.994 ms）',
      version: 'Ascend910B · Megatron-LM(tp-dp-pp) · Level2 export_type=db / aic_metrics=ACL_AICORE_MEMORY_UB',
      skills: ['mindstudio_profiler_data_check', 'dataset-source-identifier', 'ascend-profiler-db-explorer', 'cluster-fast-slow-rank-detector', 'msprof-analyze-cli', 'op-mfu-calculator', 'performance-health-score', 'msinsight-view-selector'],
      advisorStatus: 'msprof-analyze advisor all 已调用（-d 指向 Rank 15 慢卡目录）— 用于头号慢卡根因下钻，输出（Operator Dispatch / AICPU / Block Dim / Bandwidth Contention / Packet / Retransmission / Affinity API）已并入第 2 章行动清单与第 3 章问题详情。原始输出：advisor_output/rank15/mstt_advisor_20260618120758.html。集群模式 slow_rank/cluster_time_summary/compute_op_sum/hccl_sum/cann_api_sum/free_analysis/freq_analysis 为主证据来源',
      output: './Analysis Report/MultiProfLevel2MemoryUB_profiling_analysis_20260618/',
    },
    // 与 report.md §5「数据来源与落盘信息」一致；运行时若 fetch 到报告会被 parseDiskFileInfo 覆盖
    diskFileInfo: {
      dir: 'MultiProfLevel2MemoryUB_db/',
      source: '分布式训练 Profiling（多机多卡）',
      isLLM: 'yes',
      model: 'Megatron-LM 训练的 Transformer LLM（具体模型家族/规模无确证依据，留空）',
      size: '~1.0 GB（16 × ~62 MB DB）',
      link: '',
      linkText: '',
      basis: 'algorithm=Megatron-LM(tp-dp-pp)（ClusterBaseInfo）；算子签名含 FlashAttentionScore(/Grad)、RmsNorm(/Grad)、SwiGlu(/Grad)、RotaryMul(RoPE)、ApplyAdamW、MatmulReduceScatter/AllGatherMatmul（TP 序列并行融合）→ 现代 Transformer LLM 训练；hidden≈5120、seq≈4096、head_dim=128。vocab 维未在任何算子 shape 中出现，无法据 tokenizer 词表定家族，模型名留空不猜。',
    },
    codeExamplesFabricated: true,
    codeExamples: [
      {
        label: '关闭 JIT 在线编译，消除 8390 次 aclopCompileAndExecute',
        lang: 'python',
        issue: '3.1',
        before: `# 原状态：默认 JIT 在线编译 + 内部格式自动转换
# advisor: aclopCompileAndExecute Counts=8390, Elapsed=352 ms
# free_analysis: "long time between two node@launch" 间隙，NPU 周期性饿死`,
        after: `# 修改后：训练入口（所有 rank）关闭在线编译
import torch_npu
torch_npu.npu.set_compile_mode(jit_compile=False)
torch_npu.npu.config.allow_internal_format = False
# 目标：aclopCompileAndExecute → ~0，Rank 15 free 40.7% → <15%`,
      },
      {
        label: 'TP 融合算子从 AICPU 切回 cube（MIX_AIC）路径',
        lang: 'python',
        issue: '3.2',
        before: `# 原状态：AllGatherMatmulAicpu / MatmulReduceScatterAicpu 走 AI_CPU
# AICPU 类算子 Elapsed 合计 2826 ms，时间占比 0.404（计算子项压到 60）`,
        after: `# 修改后：确认走 MIX_AIC cube 融合（Megatron / MindSpeed）
# --tp-comm-overlap                     # 开启 TP 通信-计算融合
# 检查 CANN/torch_npu 版本支持该 shape/dtype 的 cube 融合白名单；
# 若特定 shape 回退 AICPU，调整 TP size / sequence parallel 粒度命中白名单
# 目标：*Aicpu 算子 Count→0 或时间占比 <5%`,
      },
    ],
  },
  // ── r20260618pp: profile_dir 2 节点 × 4 卡 PP4·DP2 训练（msprof-analyze + advisor 全跑通）─────
  // 数据来源: Analysis Report/profile_dir_profiling_analysis_20260618/（report.md / msprof_analyze/ / advisor/ / evidence/）
  {
    id: 'r20260618pp',
    filename: '../Analysis Report/profile_dir_profiling_analysis_20260618/report.md',
    title: 'profile_dir 多机多卡训练性能诊断报告',
    subtitle: 'TP1·PP4·DP2 · 2 节点 × 4 卡',
    taskType: '多机多卡训练',
    reportDate: '2026-06-18',
    phs: {
      current: 75, grade: 'A', estimated: 85, estGrade: 'A',
      subItems: [
        { name: '计算', value: 64 }, { name: '通信', value: 93 },
        { name: '调度', value: 71 }, { name: '内存', value: null },
      ],
      estSubItems: [
        { name: '计算', value: 78 }, { name: '通信', value: 93 },
        { name: '调度', value: 88 }, { name: '内存', value: null },
      ],
    },
    summary: {
      conclusion: '单步 ~10.80 s，被「流水线最后一级（PP stage3，rank6/7）计算过载」主导——8 卡 step 时间几乎完全一致（CV≈0.01%），但负载严重不均，不存在硬件型快/慢卡',
      topBottleneck: 'stage3 计算 ~9.26 s/step，是其余各级（~6.15 s）的 1.51×（多 ~3.11 s）；其余 6 卡因此每步在 P2P recv 上空等 ~3.77 s 流水线 bubble（占 step ~35%）。根因是 lm_head/logits 投影（MatMulV2 ~16 ms×64≈1024 ms）+ loss 向量算子只落在末级两卡',
      maxGain: '若把 stage3 负载拉平到与其余级一致并开启计算-通信重叠，预计节省 ~26–30% 单步耗时（~2.8–3.0 s）',
    },
    metrics: {
      op_utilization: { value: 64, note: '各卡「计算时间/step」均值（device 计算占用口径）；cube 硬件利用率另达 ~92%，损耗在并行结构而非算子' },
      overlap_ratio:  { value: 0, status: 'bad', note: 'communicationOverlapComputation 8 卡全为 0.0——无任何通信被计算掩盖' },
      max_lane_idle:  { value: 35, status: 'bad', note: 'stage0–2 每步在 P2P recv 上空等 ~3.77 s（communicationWaitStageTime 均值），占 step ~35%' },
      step_cv:        { value: 0.012, display: '0.012', note: '8 卡单步 10796.6–10800.6 ms，跨 rank CV 0.012%（全局同步训练，无掉队 rank）' },
      mfu:            { achieved_tflops: 301.7, e2e_pct: 40, note: 'MatMul shape+耗时聚合达成算力（step4，转置安全用 Output shape 锚定 M/N）。芯片实测达成超 910B3/B4 峰值→判定 910B1（BF16 378.88 TF）：rank0/stage0 纯 transformer 达成 301.7 TF/s（MatMul MFU ~80%），rank6/stage3 含 lm_head+loss 仅 242.4 TF/s（~64%，大 N lm_head GEMM + loss 小 M GEMM 拉低）。端到端 step MFU（含 bubble+零重叠）≈ 算子达成率×计算占用率(~64%) ≈ 40% 出头，落实 #1/#2 后预计升至 ~55–60%' },
    },
    actions: [
      { id: 1, priority: 'P0', problem: 'PP 末级（stage3, rank6/7）计算过载，制造 ~35% 单步 bubble', benefit: '-26~30% 单步耗时（~2.8–3.0 s）', benefitNum: 28, difficulty: '中', location: '训练启动并行切分配置（Megatron/MindSpeed PP 层切分参数 --decoder-last-pipeline-num-layers）— 把末级 transformer 层数调少以抵消 lm_head+loss 的额外开销', visualization: '算子视图 + Timeline 视图（系统调优）' },
      { id: 2, priority: 'P0', problem: '计算-通信零重叠（Overlapped=0），暴露通信 100% 进关键路径', benefit: '-10~15% 单步耗时', benefitNum: 12, difficulty: '中', location: '训练框架并行调度与通信流配置（interleaved 1F1B / overlap_grad_reduce / 独立通信 stream）', visualization: 'Timeline 视图（系统调优）' },
      { id: 3, priority: 'P1', problem: '关键环境变量未设置（缓存 / 显存分配器）', benefit: '中（降 host 下发开销、缓解碎片）', benefitNum: null, difficulty: '低', location: '训练启动脚本环境变量段（ACLNN_CACHE_LIMIT / HOST_CACHE_CAPACITY / PYTORCH_NPU_ALLOC_CONF）', visualization: 'Timeline 视图（系统调优）' },
      { id: 4, priority: 'P1', problem: '动态 Shape 触发算子在线编译', benefit: '低~中', benefitNum: null, difficulty: '低', location: '训练入口初始化代码（jit_compile=False / allow_internal_format=False）', visualization: '算子视图' },
      { id: 5, priority: 'P2', problem: 'stage3 重载卡 AI Core 降频（rank6/7 低至 1200–1350 MHz）', benefit: '低', benefitNum: null, difficulty: '中', location: '节点散热/功耗策略 + 随 3.1 负载均衡一并复核', visualization: '算子视图' },
    ],
    issues: [
      { id: '3.1', priority: 'P0', title: 'PP 末级（stage3, rank6/7）计算过载，制造 ~35% 单步 bubble',
        evidence: 'cluster_time_summary → ClusterTimeSummary 表（step 4）：8 卡 step 时间几乎相同（10796.6–10800.6 ms，CV≈0.012%）——典型全局同步训练，无硬件型快/慢卡。但 stage3（rank6/7）计算均值 9257 ms、stage0–2 均值 6147 ms——末级多算 3110 ms/step（1.51×）。末级「多出来的活」定位到落盘算子（compute_op_sum/kernel_details.csv）：MatMulV2（lm_head/logits 投影，平均 16.0 ms/次 ×64 次 ≈ 1024 ms）仅出现在 stage3 的 rank6/7，rank0–5 完全没有；外加末级 loss 相关 vector 算子更重（stage3 vector 算子耗时是 stage0 的 ~1.6×）。后果：rank0–5 每步在 P2P recv 上空等 communicationWaitStageTime ≈ 3.51–4.05 s（均值 3.77 s，占 step ~35%）。hccl_sum 佐证：stage0–2 的 hcom_batchSendRecv_（PP P2P）Min 仅 1.25 ms、Max 达 100+ ms——绝大部分是等待而非传输',
        impact: '单步 ~10.80 s 被末级计算 gating。全集群每步约 6 卡 × 3.77 s ≈ 22.6 卡·秒空耗在 bubble（≈ 集群总算力时间的 26%）',
        steps: ['采用非均匀 PP 切分：减少最后一级的 decoder 层数（如 Megatron --decoder-last-pipeline-num-layers），让 stage3 计算从 ~9.26 s 降到 ~6.4 s', '或将 lm_head/loss 的计算量摊薄：开启 lm_head 张量切分（vocab-parallel cross-entropy），把 logits GEMM 与 CE 拆到多卡', '复采时提高 num_microbatches 并确认 1F1B 调度，进一步压低固有 bubble'],
        stepsRaw: '- **改动位置**：训练启动并行切分配置（Megatron/MindSpeed 的 PP 层切分参数）。目标——把末级 transformer 层数调少以抵消 lm_head+loss 的额外开销，使各 stage 总耗时拉平。\n1. 采用**非均匀 PP 切分**：减少最后一级的 decoder 层数（如 Megatron `--decoder-last-pipeline-num-layers`，差额 ~3.1 s 对应约 0.5 层的等效负载，按实测微调），让 stage3 计算从 ~9.26 s 降到 ~6.4 s。\n2. 或将 lm_head/loss 的计算量摊薄：开启 lm_head 的张量切分（当前 TP=1，可考虑对输出投影/词表做 TP 或 vocab-parallel cross-entropy）。\n3. 复采时建议把 `num_microbatches` 提高，并确认 1F1B 调度。',
        verification: '重采后再跑 msprof-analyze -m cluster_time_summary，确认 ClusterTimeSummary 中 stage3 计算与 stage0–2 极差 < 10%，且 stage0–2 的 communicationWaitStageTime 从 ~3.77 s 降到 < 1.5 s；单步 stepTime 降到 ~7.5–8.0 s',
        visualization: '主：算子视图 — 载入 evidence/rank6_s3_localhost/kernel_details.csv，按 Type 过滤 MatMulV2，确认该 lm_head 投影只在末级出现且单次 ~16 ms；对照 evidence/rank0_s0_ubuntu122/kernel_details.csv 无该算子。辅：Timeline 视图（系统调优）— 载入 evidence/rank0_s0_ubuntu122/trace_view.json，观察 P2P recv 处长达 ~3.8 s 的 device 空挡（bubble）',
        codeLocations: [] },
      { id: '3.2', priority: 'P0', title: '计算-通信零重叠（Overlapped=0），暴露通信 100% 进关键路径',
        evidence: '8 卡 step_trace_time.csv 与 ClusterTimeSummary 的 communicationOverlapComputation 列全部为 0.0——即没有任何通信被计算掩盖；Communication(Not Overlapped) = Communication（rank0 step4：4389.6 ms 全部暴露）。RDMA P2P 与 DP hcom_allReduce_（rank0/1 单卡 SumNs ~0.93–0.94 s/2step 的大 allreduce + rank6/7 各 270 个小 allreduce）均未与计算并行',
        impact: '暴露通信 + bubble 直接落在关键路径；即便链路本身健康，这部分时间也无法被掩盖。结合 3.1，stage0–2 暴露通信里约 80% 实为 stage 等待',
        steps: ['开启 interleaved 1F1B（virtual pipeline），用更细的 micro-stage 让前向/反向交错，压缩 bubble 并制造可重叠窗口', '开启梯度 reduce 与反向计算重叠（overlap_grad_reduce / 独立通信 stream），让 DP allreduce 隐藏到反向计算后面', '确认 P2P 使用独立 stream，避免与计算串行化'],
        stepsRaw: '- **改动位置**：训练框架的并行调度与通信流配置（PP 调度策略、DP 梯度 allreduce 与反向重叠开关）。\n1. 开启 **interleaved 1F1B（virtual pipeline）**，用更细的 micro-stage 让前向/反向交错。\n2. 开启 **梯度 reduce 与反向计算重叠**（`overlap_grad_reduce` / 独立通信 stream）。\n3. 确认 P2P 使用独立 stream，避免与计算串行化。',
        verification: '重采后 ClusterTimeSummary.communicationOverlapComputation > 0，且各卡「暴露通信」占 step 比例下降 ≥ 10 个百分点',
        visualization: 'Timeline 视图（系统调优）— 载入 evidence/rank0_s0_ubuntu122/trace_view.json，对齐 Communication 与 Computing 泳道，确认两者无重叠（通信段对应计算泳道为空）',
        codeLocations: [] },
      { id: '3.3', priority: 'P1', title: '关键环境变量未设置（缓存 / 显存分配器）',
        evidence: 'profiler_metadata.json 的 ENV_VARIABLES 中 ACLNN_CACHE_LIMIT、HOST_CACHE_CAPACITY、PYTORCH_NPU_ALLOC_CONF 等均为空；msprof-analyze advisor 的 Environment Variable Issues 明确建议：export ACLNN_CACHE_LIMIT=100000、export HOST_CACHE_CAPACITY=20、export PYTORCH_NPU_ALLOC_CONF=expandable_segments:True',
        impact: 'aclnn 缓存/host 缓存偏小会增加算子下发开销；expandable_segments 缺失易致显存分配器碎片（本次未开 profile_memory，碎片量未量化）',
        steps: ['设置上述三个环境变量后重训'],
        stepsRaw: '- **改动位置**：训练启动脚本环境变量段。\n1. 设置环境变量后重训：\n```bash\nexport ACLNN_CACHE_LIMIT=100000\nexport HOST_CACHE_CAPACITY=20\nexport PYTORCH_NPU_ALLOC_CONF=expandable_segments:True\n```',
        verification: '重采后 advisor 的 Environment Variable Issues 不再提示；对比 cann_api_sum 中 host 侧下发/Tiling API 总耗时下降',
        visualization: 'Timeline 视图（系统调优）— 载入 evidence/rank0_s0_ubuntu122/trace_view.json，过滤 host 侧 *_Tiling / launch API，观察下发间隙（设置缓存前的基线）',
        codeLocations: [] },
      { id: '3.4', priority: 'P1', title: '动态 Shape 触发算子在线编译',
        evidence: 'msprof-analyze advisor 的 Operator Dynamic Shape Issues 命中，建议 torch_npu.npu.set_compile_mode(jit_compile=False) 与 torch_npu.npu.config.allow_internal_format = False',
        impact: '动态 shape 走在线编译路径会引入额外 host 编译/下发开销，放大调度抖动',
        steps: ['关闭 jit_compile、禁用 internal_format，固定为静态 shape 编译路径'],
        stepsRaw: '- **改动位置**：训练入口初始化代码。\n1. 关闭 jit_compile、禁用 internal_format：\n```python\ntorch_npu.npu.set_compile_mode(jit_compile=False)\ntorch_npu.npu.config.allow_internal_format = False\n```',
        verification: '重采后 advisor 不再提示 Dynamic Shape；cann_api_sum 中编译相关 API 耗时下降',
        visualization: '算子视图 — 载入 evidence/rank0_s0_ubuntu122/kernel_details.csv，关注 OP State 列中非静态项，定位动态 shape 算子',
        codeLocations: [] },
      { id: '3.5', priority: 'P2', title: 'stage3 重载卡 AI Core 降频（rank6/7 低至 1200–1350 MHz）',
        evidence: 'freq_analysis → AbnormalFrequencyRanks：rank6 出现 1200/1250/1300… MHz，rank7 出现 1250/1300… MHz（额定 1800 MHz）；相比之下负载较轻的 rank0 仅 1700–1800 MHz。降频集中在计算最重的末级两卡',
        impact: '末级是 gating 路径，其降频会进一步拉长单步；但当前降频幅度温和（未到 800 MHz 全空闲档），影响次于 3.1/3.2。降频部分由 bubble 期空转与高负载功耗/散热共同导致，解决 3.1 后大概率缓解',
        steps: ['先落地 3.1 负载均衡，再复采观察 rank6/7 频率是否回升至 1800 MHz', '若仍降频，排查该物理节点（localhost）散热与功耗墙'],
        stepsRaw: '- **改动位置**：节点散热/功耗策略 + 随 3.1 负载均衡一并复核。\n1. 先落地 3.1 负载均衡，再复采观察 rank6/7 频率是否回升至 1800 MHz。\n2. 若仍降频，排查该物理节点（localhost）散热与功耗墙。',
        verification: '重采后 freq_analysis 中 rank6/7 不再出现 < 1500 MHz 的样本',
        visualization: '算子视图 — 载入 evidence/rank6_s3_localhost/kernel_details.csv，关注 cube 算子的 aic_total_cycles 与耗时关系，辅助判断是否降频拉长执行',
        codeLocations: [] },
    ],
    noProblems: [
      '通信链路健康：跨节点 PP P2P 走 RDMA，communication_time_sum → ClusterCommunicationBandwidth 实测 ~24.2 GB/s（≈ 理论 25 GB/s 的 97%），各 send/recv 高度一致；包大小 29.36 MB（大包，无小包/字节对齐问题）。节点内 LOCAL allreduce 达 ~661 GB/s。不存在慢链路',
      '无硬件型快/慢卡：8 卡 stepTime 极差 4 ms / CV≈0.012%，无掉队 rank；rank 间差异是结构性 PP 负载不均，非单卡硬件劣化',
      '算子内核效率高：cube（MAC 流水）利用率按耗时加权 86%–98%（cluster ~92%），MatMulV3 等主力 GEMM 形状规整、效率接近上限——瓶颈不在单算子实现，而在并行结构',
      'Host 下发未饿死 device：各卡 Free（step_trace 口径）仅 84–251 ms（< step 的 2.5%），free_analysis 显示空闲多为 device 任务运行中的小间隙（EVENT_RECORD/EVENT_WAIT），非 host 下发跟不上',
      '数据采集完整：8 卡 profiler_info_{rank}.json 齐全（采集正常 Stop），ASCEND_PROFILER_OUTPUT 已解析，DB/CSV/trace 交付件齐备',
    ],
    meta: {
      date: '2026-06-18',
      dataPath: 'D:\\Projects\\ProfilingTest\\profile_dir\\（8 个 *_ascend_pt 目录）',
      range: '8 Rank / 2 节点（ubuntu122=rank0–3，localhost=rank4–7）× 4 卡；并行 TP1·PP4·DP2·CP1；采集 schedule skip_first=2/warmup=1/active=2（2 个有效 step，step3/step4）；Profiler Level1，aic_metrics=ACL_AICORE_PIPE_UTILIZATION',
      version: 'torch_npu 2.7.1 / CANN 8.3.RC1 · stage0={0,1}/stage1={2,3}/stage2={4,5}/stage3={6,7}，PP 组 {0,2,4,6}/{1,3,5,7} 跨节点（P2P 走 RDMA）',
      skills: ['mindstudio_profiler_data_check', 'dataset-source-identifier', 'cluster-fast-slow-rank-detector', 'msprof-analyze-cli', 'op-mfu-calculator', 'performance-health-score', 'msinsight-view-selector'],
      advisorStatus: 'msprof-analyze advisor all 已调用 — 对集群数据跑 advisor all，命中 Environment Variable Issues / Operator Dynamic Shape Issues / Packet Analysis / Affinity API Issues（Affinity 因 with_stack=False 无栈，已忽略），结果已并入第 2 章行动清单（#3、#4）与第 3 章问题详情。集群模式 cluster_time_summary/compute_op_sum/hccl_sum/communication_time_sum/communication_matrix_sum/freq_analysis/free_analysis/cann_api_sum 为主证据来源',
      output: './Analysis Report/profile_dir_profiling_analysis_20260618/',
    },
    // 与 report.md §5「数据来源与落盘信息」一致；运行时若 fetch 到报告会被 parseDiskFileInfo 覆盖
    diskFileInfo: {
      dir: 'profile_dir/',
      source: '分布式训练 Profiling（PyTorch 框架 profiler，2 节点 × 4 卡）',
      isLLM: 'yes',
      model: 'Qwen2-7B 架构 LLM 训练（hidden=3584、28 注意力头、GQA 4 KV 头、head_dim=128；Qwen2 / Qwen2.5 具体版本未确证）',
      size: '~1.0 GB（8 卡原始落盘，单卡 trace_view ~119 MB + DB ~43 MB）；evidence 举证副本 ~260 MB',
      link: '',
      linkText: '',
      basis: '算子签名 FlashAttentionScore(/Grad)+RmsNorm(/Grad)+SwiGlu(/Grad)+RotaryPositionEmbedding(/Grad) → 现代 Transformer LLM；含 *Grad+ApplyAdamWV2 → 训练（非推理）。FlashAttention InputShapes 4096,1,3584、heads 1,28,4096,8、GQA KV 维 512 → hidden=3584、28 q 头、4 kv 头、head_dim=128，命中 Qwen2-7B 架构。具体词表大小（vocab）未在落盘中确证，Qwen2 vs Qwen2.5 版本与精确参数规模留空不写。',
    },
    codeExamplesFabricated: true,
    codeExamples: [
      {
        label: '非均匀 PP 切分：把末级 decoder 层数调少，拉平 stage3 负载',
        lang: 'bash',
        issue: '3.1',
        before: `# 原状态：均匀 PP4 切分，stage3 额外承担 lm_head + loss
# stage3 计算 ~9.26 s vs stage0-2 ~6.15 s（1.51×）
# → stage0-2 每步空等 ~3.77 s P2P bubble（占 step ~35%）`,
        after: `# 修改后：减少末级 decoder 层数抵消 lm_head/loss 开销（Megatron）
# --decoder-last-pipeline-num-layers <N-k>   # 差额 ~3.1s ≈ 0.5 层等效，按实测微调
# 或对输出投影/词表做张量切分：vocab-parallel cross-entropy
# 目标：stage3 计算与 stage0-2 极差 <10%，单步 10.8s → ~7.5-8.0s`,
      },
      {
        label: '开启计算-通信重叠（Overlapped=0 → >0）',
        lang: 'bash',
        issue: '3.2',
        before: `# 原状态：communicationOverlapComputation 8 卡全为 0.0
# 暴露通信（rank0 step4: 4389.6 ms）100% 落关键路径`,
        after: `# 修改后：interleaved 1F1B + 梯度 reduce 与反向重叠（Megatron / MindSpeed）
# --num-layers-per-virtual-pipeline-stage <V>  # interleaved 1F1B
# --overlap-grad-reduce                         # DP allreduce 隐藏到反向后
# 确认 P2P 走独立 stream，避免与计算串行化
# 目标：communicationOverlapComputation > 0，暴露通信占比 -10pp`,
      },
      {
        label: '设置关键环境变量（aclnn/host 缓存 + 显存分配器）',
        lang: 'bash',
        issue: '3.3',
        before: `# 原状态：profiler_metadata.json 的 ENV_VARIABLES 中三项均为空
# ACLNN_CACHE_LIMIT=        # aclnn 缓存偏小 → 算子下发开销大
# HOST_CACHE_CAPACITY=      # host 缓存偏小
# PYTORCH_NPU_ALLOC_CONF=   # 显存分配器易碎片`,
        after: `# 修改后：在训练启动脚本环境变量段加入（advisor 推荐值）
export ACLNN_CACHE_LIMIT=100000
export HOST_CACHE_CAPACITY=20
export PYTORCH_NPU_ALLOC_CONF=expandable_segments:True
# 目标：advisor 不再提示 Environment Variable Issues，
#       cann_api_sum 中 host 侧下发/Tiling API 总耗时下降`,
      },
      {
        label: '关闭 JIT 在线编译，固定静态 shape 路径',
        lang: 'python',
        issue: '3.4',
        before: `# 原状态：动态 shape 走在线编译路径（advisor 命中 Dynamic Shape Issues）
# jit_compile 默认开启 → 编译/下发抖动放大调度开销
# kernel_details.csv 中相关算子 OP State 为动态`,
        after: `# 修改后：训练入口初始化处关闭 JIT、禁用 internal_format
import torch_npu
torch_npu.npu.set_compile_mode(jit_compile=False)
torch_npu.npu.config.allow_internal_format = False
# 目标：advisor 不再提示 Dynamic Shape；
#       cann_api_sum 中编译相关 API 耗时下降`,
      },
      // 注：3.5（末级 AI Core 降频）属散热/功耗硬件项，需先落地 3.1 负载均衡后复采，
      //     无代码级改动，故不列入修改清单。
    ],
    // 源码级定位：左树右码浏览「性能问题定位分析/_src」中被根因定位命中的框架源码
    // 行号锚点取自 源码级定位_3.1与3.2_示例.md，已与 _src/Megatron-LM（core_v0.12.1 完整 clone）校对；
    // 路径统一指向完整仓真实文件（megatron/core/...），与泳道 OP_CODE_MAP 一致，便于点击联动。
    codeTree: {
      label: '性能问题定位分析 / _src（框架源码）',
      base: '性能问题定位分析/_src/',
      files: [
        { path: '性能问题定位分析/_src/Megatron-LM/megatron/core/models/gpt/gpt_model.py',
          lang: 'python', issue: '3.1', note: 'lm_head/loss 硬绑定在最后一个 PP stage：仅 post_process 才建 output_layer 并跑 logits 投影与 loss（MatMulV2 只在末级 rank6/7 出现）',
          anchors: [180, 197, 379, 389, 409] },
        { path: '性能问题定位分析/_src/Megatron-LM/megatron/core/transformer/transformer_block.py',
          lang: 'python', issue: '3.1', note: 'get_num_layers_to_build 默认均匀切分（28//4=7），不为 lm_head/loss 预留配额；非均匀分支与 account_for_loss 末级 -1',
          anchors: [105, 107, 111, 112, 117, 156, 157] },
        { path: '性能问题定位分析/_src/Megatron-LM/megatron/core/pipeline_parallel/schedules.py',
          lang: 'python', issue: '3.2', note: 'get_forward_backward_func：vp=None 走无交错 1F1B（bubble 最大）；grad_sync 仅在 overlap_grad_reduce 时生效（grad_sync_func=None 时全暴露）',
          anchors: [106, 108, 110, 742, 744, 751, 758] },
        { path: '性能问题定位分析/_src/Megatron-LM/megatron/core/distributed/distributed_data_parallel.py',
          lang: 'python', issue: '3.2', note: 'overlap_grad_reduce 的真正实现：=False 时 bucket_size→∞ 且不注册异步 hook；=True 时反向 hook 内 register_grad_ready 触发桶满即 all-reduce（与计算重叠）。本例为 False → grad 全暴露',
          anchors: [61, 408, 418, 419, 458, 470] },
        { path: '性能问题定位分析/_src/MindSpeed-LLM/mindspeed_llm/core/layerwise_disaggregated_training/initialize.py',
          lang: 'python', issue: '3.1 / 3.2', note: 'CLI 参数映射：--decoder-first/last-pipeline-num-layers、--account-for-loss-in-pipeline-split 及非均匀切分/虚拟流水的校验约束',
          anchors: [506, 507, 519] },
        { path: '性能问题定位分析/_src/MindSpeed-LLM/pretrain_gpt.py',
          lang: 'python', issue: '3.1 / 3.2', note: '训练入口：model_provider 按 pre_process/post_process 构建 GPTModel（post_process=末级才建 lm_head/loss），forward_step + pretrain 驱动 1F1B 调度——把启动脚本 args 串到上面三处框架根因',
          anchors: [42, 77, 82, 83, 216, 302] },
      ],
    },
  },
  {
    id: 'r20260715pangu',
    filename: '../Analysis Report/pangu2.0flash_profiling_analysis_20260715/report.md',
    title: 'Pangu 2.0 flash 72B 多机多卡训练性能诊断报告',
    subtitle: 'TP1·PP4·EP4·DP2 · 4 节点 × 8 卡',
    taskType: '多机多卡训练',
    reportDate: '2026-07-15',
    phs: {
      current: 73, grade: 'A', estimated: 86, estGrade: 'A',
      subItems: [
        { name: '计算', value: 58 }, { name: '通信', value: 91 },
        { name: '调度', value: 78 }, { name: '内存', value: null },
      ],
      estSubItems: [
        { name: '计算', value: 72 }, { name: '通信', value: 93 },
        { name: '调度', value: 90 }, { name: '内存', value: null },
      ],
    },
    summary: {
      conclusion: '单步 ~16.20 s，32 卡 step 时间高度一致（CV≈0.02%），但存在三重瓶颈——PP 末级计算过载 + EP all-to-all 暴露通信 + MoGE 路由负载不均',
      topBottleneck: 'PP stage3（rank24–31）计算 ~12.70 s/step，是其余各级（~8.29 s）的 1.54×（多 ~4.41 s）；stage0–2 的 24 卡因此每步空等 ~4.26 s 流水线 bubble（占 step ~26%）。EP=4 的 MoE all-to-all 完全暴露在关键路径（Overlapped=0），44 层 MoE 累计约 1.32 s/step 纯通信开销',
      maxGain: '拉平 stage3 负载 + 开启 EP 通信重叠 + 路由均衡优化，预计节省 ~30–35% 单步耗时（~4.9–5.7 s）',
    },
    metrics: {
      critical_path_ratio: { value: 98, status: 'ok', note: '98% 已达标（阈值 80%）：关键路径本身几乎无空闲，瓶颈在链路上的计算过载与零重叠通信，而非算子级空泡' },
      op_utilization: { value: 58, note: '< 60% 需优化' },
      overlap_ratio:  { value: 0, status: 'bad', note: '32 卡全为 0，通信完全串行' },
      pp_bubble_ratio: { value: 26.3, status: 'bad', note: 'stage0–2 空等 4.26s/step' },
      max_lane_idle:  { value: 27.5, status: 'bad', note: '> 10% 判为异常' },
      step_cv:        { value: 0.0002, display: '0.02%', note: '> 10% 判为训练不稳定' },
      mfu:            { achieved_tflops: 298.5, e2e_pct: 42, note: 'MatMul shape+耗时聚合达成算力（step4）。stage0 达成 298.5 TF/s 已超 910B3/B4 峰值→判定芯片为 910B1（BF16 378.88 TF）：rank0/stage0 纯 transformer+MoE MatMul MFU ~79%，rank24/stage3 含 lm_head+loss 仅 ~61%（大 N lm_head GEMM + loss/MTP 小 M GEMM 拉低）。端到端 step MFU（激活参数口径，含 bubble+零重叠）≈ 42%，落实第 2 章 #1–#4 后预计升至 ~55–60%' },
      mem_util:       { reserved_gb: 15, note: '⚠️ 估算（profile_memory 未开启），模型 ~2.5 GB + 优化器 ~5 GB + 激活 ~7 GB' },
    },
    actions: [
      { id: 1, priority: 'P0', problem: 'PP 末级（stage3, rank24–31）计算过载，制造 ~26% 单步 bubble', benefit: '-20~25% 单步耗时（~3.2–4.1 s）', benefitNum: 22, difficulty: '中', location: '训练启动并行切分配置（Megatron/MindSpeed PP 层切分参数 --decoder-last-pipeline-num-layers）— 把末级 transformer 层数调少以抵消 lm_head+loss+深层 MoE 的额外开销', visualization: '算子视图 + Timeline 视图（系统调优）' },
      { id: 2, priority: 'P0', problem: 'EP all-to-all 通信入关键路径且零重叠，44 层 MoE 累计 ~1.32 s/step', benefit: '-6~8% 单步耗时（~1.0–1.3 s）', benefitNum: 7, difficulty: '中', location: 'MindSpeed/Megatron MoE 层前向/反向调度逻辑 — 开启 EP communication overlap，dispatch 发起后立即执行本地 expert FFN', visualization: 'Timeline 视图（系统调优）' },
      { id: 3, priority: 'P0', problem: '计算-通信全局零重叠（Overlapped=0），DP allreduce + PP P2P 全部暴露', benefit: '-8~12% 单步耗时（叠加 #2 后）', benefitNum: 10, difficulty: '中', location: '训练框架并行调度与通信流配置（interleaved 1F1B / overlap_grad_reduce / 独立通信 stream）', visualization: 'Timeline 视图（系统调优）' },
      { id: 4, priority: 'P1', problem: 'MoGE 路由负载不均——深层 expert 热点，EP 组内算力浪费', benefit: '中（降 EP 同步等待 + 提 MFU）', benefitNum: null, difficulty: '中', location: 'MoGE router 负载均衡策略与 aux loss 配置（增大 aux loss 系数 / z-loss / 增加分组数 / capacity factor）', visualization: '算子视图' },
      { id: 5, priority: 'P1', problem: '关键环境变量未设置（缓存 / 显存分配器）', benefit: '中（降 host 下发开销、缓解碎片）', benefitNum: null, difficulty: '低', location: '训练启动脚本环境变量段（ACLNN_CACHE_LIMIT / HOST_CACHE_CAPACITY / PYTORCH_NPU_ALLOC_CONF）', visualization: 'Timeline 视图（系统调优）' },
      { id: 6, priority: 'P1', problem: '动态 Shape 触发算子在线编译', benefit: '低~中', benefitNum: null, difficulty: '低', location: '训练入口初始化代码（jit_compile=False / allow_internal_format=False / expert token padding）', visualization: '算子视图' },
      { id: 7, priority: 'P2', problem: 'stage3 重载卡 AI Core 降频（rank24–31 低至 1200–1350 MHz）', benefit: '低', benefitNum: null, difficulty: '中', location: 'node4 散热/功耗策略 + 随 #1 负载均衡一并复核', visualization: '算子视图' },
    ],
    issues: [
      { id: '3.1', priority: 'P0', title: 'PP 末级（stage3, rank24–31）计算过载，制造 ~26% 单步 bubble',
        evidence: 'cluster_time_summary → ClusterTimeSummary 表（step4，8 个代表 rank）：32 卡 step 时间高度一致（16200.0±5 ms，CV≈0.02%）——典型全局同步训练，无硬件型快/慢卡。但 stage3（rank24–31）计算均值 ~12700 ms，stage0–2 均值 ~8292 ms——末级多算 ~4408 ms/step（1.54×）。末级「多出来的活」定位到落盘算子（compute_op_sum/kernel_details.csv）：MatMulV2（lm_head 投影 [4608→153600]，平均 ~20.0 ms/次 ×64 次≈1280 ms）仅出现在 stage3，rank0–23 完全没有；外加 stage3 独有的 loss 反向 GEMM（~500 ms 级）与更重的 vector 算子（RmsNorm/ElementWise 总耗时是 stage0 的 ~1.5×）。后果：rank0–23 每步在 PP P2P recv 上空等 communicationWaitStageTime≈4.05–4.50 s（均值 4.26 s，占 step ~26%）。hccl_sum 佐证：stage0–2 的 hcom_batchSendRecv_（PP P2P）Min 仅 ~1.3 ms、Max 达 120+ ms——绝大部分是等待而非传输',
        impact: '单步 ~16.20 s 被末级计算 gating。全集群每步约 24 卡 × 4.26 s ≈ 102.2 卡·秒空耗在 bubble（≈ 集群总算力时间的 20%）',
        steps: ['采用非均匀 PP 切分：减少最后一级的 decoder 层数（Megatron --decoder-last-pipeline-num-layers），把末级 MoE 层从 12 层减至 9–10 层，让 stage3 计算从 ~12.70 s 降到 ~8.8 s', '或将 lm_head/loss 的计算量摊薄：开启 lm_head 张量切分（当前 TP=1，考虑 vocab-parallel cross-entropy），把 logits GEMM 与 CE loss 拆到 stage3 的 2 卡', '复采时把 num_microbatches 从当前值提高至 8–16，并确认 1F1B 调度，进一步压低固有 bubble'],
        stepsRaw: '- **改动位置**：训练启动并行切分配置（Megatron/MindSpeed 的 PP 层切分参数）。目标——把末级 transformer 层数调少以抵消 lm_head+loss+深层 MoE 的额外开销，使各 stage 总耗时拉平。\n1. 采用**非均匀 PP 切分**：减少最后一级的 decoder 层数（Megatron `--decoder-last-pipeline-num-layers`），把末级 MoE 层从 12 层减至 9–10 层，差额 ~4.4 s 对应约 2–3 层的等效负载，让 stage3 计算从 ~12.70 s 降到 ~8.8 s。\n2. 或将 lm_head/loss 的计算量摊薄：开启 lm_head 的张量切分（当前 TP=1，可考虑对输出投影/词表做 TP=2 或 vocab-parallel cross-entropy），把 logits GEMM [4608→153600] 与 CE loss 拆到 stage3 的 2 卡。\n3. 复采时建议把 `num_microbatches` 从当前值提高至 8–16，并确认 1F1B 调度，进一步压低固有 bubble。',
        verification: '重采后再跑 msprof-analyze -m cluster_time_summary，确认 ClusterTimeSummary 中 stage3 计算与 stage0–2 极差 < 10%，且 stage0–2 的 communicationWaitStageTime 从 ~4.26 s 降到 < 2.0 s；单步 stepTime 降到 ~11.5–12.5 s',
        visualization: '主：算子视图 — 载入 evidence/rank24_s3_node4/kernel_details.csv，按 Type 过滤 MatMulV2，确认 lm_head 投影 [4608→153600] 只在末级出现且单次 ~20 ms×64 次；对照 evidence/rank0_s0_node1/kernel_details.csv 无该算子。辅：Timeline 视图（系统调优）— 载入 evidence/rank0_s0_node1/trace_view.json，观察 P2P recv 处长达 ~4.5 s 的 device 空挡（bubble）',
        codeLocations: [] },
      { id: '3.2', priority: 'P0', title: 'EP all-to-all 通信入关键路径且零重叠，44 层 MoE 累计 ~1.32 s/step',
        evidence: 'EP=4 配置下，每层 MoE（L4–L47，共 44 层）在 forward 阶段执行 token dispatch all-to-all，backward 阶段执行 token combine all-to-all。hccl_sum → HcclPerRankStats：每 rank 的 hcom_all_to_all_v_ 调用次数 = 44 层×2（fwd+bwd）= 88 次/step；forward dispatch 均值 ~18 ms/次，合计 ~792 ms；backward combine 均值 ~12 ms/次，合计 ~528 ms——EP 通信总开销 = 1320 ms/step（≈ 实际传输 3350–3400 ms 中的 ~39%）。ClusterTimeSummary.communicationOverlapComputation 全 32 卡为 0.0——all-to-all 完全暴露，未与 MoE expert FFN 计算重叠',
        impact: '每 step 约 1.32 s 纯 EP 通信落在关键路径上；若能与 MoE expert 计算重叠，可隐藏 60–80% 的 all-to-all 耗时',
        steps: ['开启 EP communication overlap：dispatch all-to-all 发起后立即执行当前 rank 已有的 expert FFN 计算，不等待远端 token 到达；combine 阶段先发后算', '使用独立通信 stream 将 all-to-all 与 MatMul 计算流分离，允许硬件并行执行', '评估 EP 从 4 降为 2 的 trade-off（减少 all-to-all 调用次数和消息量，但单 EP rank 的 expert 数 32→16，需确认显存余量）'],
        stepsRaw: '- **改动位置**：MindSpeed/Megatron MoE 层的前向/反向调度逻辑。\n1. 开启 **EP communication overlap**：在 dispatch all-to-all 发起后立即执行当前 rank 已有的 expert FFN 计算，不等待远端 token 到达；同理在 combine 阶段先发后算。\n2. 使用**独立通信 stream** 将 all-to-all 与 MatMul 计算流分离，允许硬件并行执行。\n3. 评估 EP 从 4 降为 2 的 trade-off（减少 all-to-all 调用次数和消息量，但增加单个 EP rank 的 expert 数 32→16，需确认显存余量）。',
        verification: '重采后 ClusterTimeSummary.communicationOverlapComputation > 0，且 stage0–2 的「实际传输」从 ~3400 ms 下降 ≥ 800 ms；Timeline 视图中 all-to-all 通信段与 MoE expert 计算段有重叠',
        visualization: 'Timeline 视图（系统调优）— 载入 evidence/rank8_s1_node2/trace_view.json，定位 MoE 层（L12–L23）的 hcom_all_to_all_v_ 调用与相邻 MatMul（gate_proj/up_proj/down_proj）的时序关系，确认串行无重叠',
        codeLocations: [] },
      { id: '3.3', priority: 'P0', title: '计算-通信全局零重叠（Overlapped=0），DP allreduce + PP P2P 全部暴露',
        evidence: '32 卡 step_trace_time.csv 与 ClusterTimeSummary 的 communicationOverlapComputation 列全部为 0.0——即没有任何通信被计算掩盖。除 EP all-to-all（3.2）外：DP hcom_allReduce_（梯度同步）rank0 单卡 SumNs ~1.15 s/2step、rank24 单卡 SumNs ~0.89 s/2step，均未与反向计算重叠；PP P2P hcom_batchSendRecv_ 跨节点 RDMA 传输，包大小 ~37.7 MB，带宽 ~24.3 GB/s，耗时约 1.55 ms/次，累积 48 层×2（fwd+bwd）= 96 次≈149 ms/step，同样暴露',
        impact: '暴露通信+bubble 直接落在关键路径；当前 stage0–2 暴露通信约 7450–7850 ms，其中 ~57% 是 stage 等待（4.26 s）、~26% 是 EP all-to-all（1.32 s）、~17% 是 DP allreduce+PP P2P（~1.30 s）',
        steps: ['开启 interleaved 1F1B（virtual pipeline），用更细的 micro-stage 让前向/反向交错，压缩 bubble 并制造可重叠窗口', '开启梯度 reduce 与反向计算重叠（overlap_grad_reduce / 独立通信 stream），让 DP allreduce 隐藏到反向计算后面', '确认 PP P2P 与 EP all-to-all 均使用独立 stream，避免与计算串行化'],
        stepsRaw: '- **改动位置**：训练框架的并行调度与通信流配置（PP 调度策略、DP 梯度 allreduce 与反向重叠开关、EP 通信重叠开关）。\n1. 开启 **interleaved 1F1B（virtual pipeline）**，用更细的 micro-stage 让前向/反向交错，压缩 bubble 并制造可重叠窗口。\n2. 开启 **梯度 reduce 与反向计算重叠**（overlap_grad_reduce / 独立通信 stream），让 DP allreduce 隐藏到反向计算后面。\n3. 确认 PP P2P 与 EP all-to-all 均使用独立 stream，避免与计算串行化。',
        verification: '重采后 ClusterTimeSummary.communicationOverlapComputation > 0，且各卡「暴露通信」占 step 比例从当前的 ~46–48%（stage0–2）下降 ≤ 35%',
        visualization: 'Timeline 视图（系统调优）— 载入 evidence/rank0_s0_node1/trace_view.json，对齐 Communication 与 Computing 泳道，确认两者无重叠（通信段对应计算泳道为空）',
        codeLocations: [] },
      { id: '3.4', priority: 'P1', title: 'MoGE 路由负载不均——深层 expert 热点，EP 组内算力浪费',
        evidence: 'compute_op_sum → ComputeOpPerRankStatsByOpType（按 MoE 相关算子过滤）：L30–L47（深层 MoE）router gate score 分布明显偏斜，以 L36 为例 group 3（expert 24–31）中 expert 27 的 gate score 均值 0.87，组内其余 expert 均值 0.15–0.35，单 expert 收到该组 ~65% 的 token 分配。kernel_details.csv 中专家 FFN 的 MatMul（gate_proj/up_proj/down_proj）在不同 expert 间总耗时差异达 4–8×，高负载 expert 合计约 2.1 ms/token-group，低负载 expert 仅 ~0.3 ms/token-group；EP all-to-all buffer 高负载 expert 所在 rank 可达低负载 rank 的 3–5×',
        impact: 'EP 组内算力利用率不均——低负载 rank 提前完成 expert FFN 后空等 all-to-all 同步；深层 router 偏斜可能累积训练不稳定',
        steps: ['增大 MoGE aux loss 系数（当前默认 0.01 → 0.05），在 gate logit 上施加更强的均衡约束', '在 router 前增加 z-loss 正则项（系数 1e-4），抑制 gate logit 极端值（sigmoid score > 0.99）', '评估将 MoGE group 数从 8 增到 16（每组 expert 从 8 降为 4），进一步分散 token 分配', '开启 expert capacity factor 限制（如 capacity=1.25），对超限 token 做 drop/residual，防止单 expert 过载'],
        stepsRaw: '- **改动位置**：MoGE router 的负载均衡策略与 aux loss 配置。\n1. 增大 MoGE aux loss 系数（当前默认 0.01 → 0.05）。\n2. 在 router 前增加 z-loss 正则项（系数 1e-4）。\n3. 评估将 MoGE group 数从 8 增到 16。\n4. 开启 expert capacity factor 限制（如 capacity=1.25）。',
        verification: '重采后 kernel_details.csv 中各 expert FFN 的 MatMul 总耗时 CV < 0.3（当前 CV≈0.8）；router gate score 分布更均匀，无 expert 占比超 40%',
        visualization: '算子视图 — 载入 evidence/rank16_s2_node3/kernel_details.csv，按 Type 过滤 MoE expert 的 MatMul（gate_proj/up_proj/down_proj），对比不同 expert index 的 Duration 分布',
        codeLocations: [] },
      { id: '3.5', priority: 'P1', title: '关键环境变量未设置（缓存 / 显存分配器）',
        evidence: 'profiler_metadata.json 的 ENV_VARIABLES 中 ACLNN_CACHE_LIMIT、HOST_CACHE_CAPACITY、PYTORCH_NPU_ALLOC_CONF 等均为空；msprof-analyze advisor 的 Environment Variable Issues 明确建议：export ACLNN_CACHE_LIMIT=100000、export HOST_CACHE_CAPACITY=20、export PYTORCH_NPU_ALLOC_CONF=expandable_segments:True',
        impact: 'aclnn 缓存/host 缓存偏小会增加算子下发开销——对 MoE 模型尤其显著（每层 64 experts×3 MatMul=192 个算子，44 层≈8448 个 expert FFN 算子/step）；expandable_segments 缺失易致显存分配器碎片',
        steps: ['设置上述三个环境变量后重训；对 MoE 场景建议 ACLNN_CACHE_LIMIT 上调至 200000'],
        stepsRaw: '- **改动位置**：训练启动脚本环境变量段。\n1. 设置环境变量后重训：\n```bash\nexport ACLNN_CACHE_LIMIT=200000\nexport HOST_CACHE_CAPACITY=20\nexport PYTORCH_NPU_ALLOC_CONF=expandable_segments:True\n```',
        verification: '重采后 advisor 的 Environment Variable Issues 不再提示；对比 cann_api_sum 中 host 侧下发/Tiling API 总耗时下降',
        visualization: 'Timeline 视图（系统调优）— 载入 evidence/rank0_s0_node1/trace_view.json，过滤 host 侧 *_Tiling / launch API，观察 MoE 层算子下发间隙（设置缓存前的基线）',
        codeLocations: [] },
      { id: '3.6', priority: 'P1', title: '动态 Shape 触发算子在线编译',
        evidence: 'msprof-analyze advisor 的 Operator Dynamic Shape Issues 命中——MoE 场景中 expert dispatch 后的 token 数随路由动态变化，各 expert 的 MatMul M 维度不固定（从几十到数百），触发在线编译路径。建议 torch_npu.npu.set_compile_mode(jit_compile=False) 与 torch_npu.npu.config.allow_internal_format = False',
        impact: '动态 shape 走在线编译路径会引入额外 host 编译/下发开销，放大调度抖动——MoE expert FFN 的小 M MatMul 对编译延迟尤其敏感',
        steps: ['关闭 jit_compile、禁用 internal_format，固定为静态 shape 编译路径', '对 MoE expert 输入做 token padding/grouping，使 MatMul M 维度稳定在少数几个固定值（如 64/128/256），减少编译变体'],
        stepsRaw: '- **改动位置**：训练入口初始化代码。\n1. 关闭 jit_compile、禁用 internal_format：\n```python\ntorch_npu.npu.set_compile_mode(jit_compile=False)\ntorch_npu.npu.config.allow_internal_format = False\n```\n2. 对 MoE expert 输入做 token padding/grouping，使 MatMul M 维度稳定在少数几个固定值（如 64/128/256）。',
        verification: '重采后 advisor 不再提示 Dynamic Shape；cann_api_sum 中编译相关 API 耗时下降',
        visualization: '算子视图 — 载入 evidence/rank0_s0_node1/kernel_details.csv，关注 OP State 列中非静态项与 MoE expert MatMul 的 Input Shapes M 维度变化范围',
        codeLocations: [] },
      { id: '3.7', priority: 'P2', title: 'stage3 重载卡 AI Core 降频（rank24–31 低至 1200–1350 MHz）',
        evidence: 'freq_analysis → AbnormalFrequencyRanks：node4（stage3 所在节点）8 卡均出现降频样本——rank24 出现 1200/1250/1300… MHz，rank28 出现 1250/1300… MHz（额定 1800 MHz）；相比之下负载较轻的 node1–3 的卡基本维持在 1650–1800 MHz。降频集中在计算最重的末级 8 卡',
        impact: '末级是 gating 路径，其降频会进一步拉长单步；但当前降频幅度温和，影响次于 3.1/3.2/3.3。降频部分由 bubble 期空转与高负载功耗/散热共同导致，解决 3.1 后大概率缓解',
        steps: ['先落地 3.1 负载均衡，再复采观察 node4 8 卡频率是否回升至 1800 MHz', '若仍降频，排查 node4 物理散热（风扇转速/进风温度）与功耗墙（npu-smi 功率限制）'],
        stepsRaw: '- **改动位置**：node4 散热/功耗策略 + 随 3.1 负载均衡一并复核。\n1. 先落地 3.1 负载均衡，再复采观察 node4 8 卡频率是否回升至 1800 MHz。\n2. 若仍降频，排查 node4 物理散热与功耗墙。',
        verification: '重采后 freq_analysis 中 node4 各 rank 不再出现 < 1500 MHz 的样本',
        visualization: '算子视图 — 载入 evidence/rank24_s3_node4/kernel_details.csv，关注 cube 算子的 aic_total_cycles 与 Duration 关系，辅助判断是否降频拉长执行',
        codeLocations: [] },
    ],
    noProblems: [
      '通信链路健康：跨节点 PP P2P 走 RDMA，communication_time_sum → ClusterCommunicationBandwidth 实测 ~24.3 GB/s（≈ 理论 25 GB/s 的 97%），各 send/recv 高度一致，包大小 ~37.7 MB（大包，无小包/字节对齐问题）；跨节点 EP all-to-all 走 RDMA，实测带宽 ~22.8 GB/s；节点内 LOCAL allreduce 达 ~655 GB/s，LOCAL all-to-all 达 ~180 GB/s。不存在慢链路',
      '无硬件型快/慢卡：32 卡 stepTime 极差 < 10 ms / CV≈0.02%，无掉队 rank；rank 间耗时差异是结构性 PP 负载不均，非单卡硬件劣化',
      '算子内核效率高：cube（MAC 流水）利用率按耗时加权 84%–97%（cluster ~91%），MatMulV3 等主力 GEMM 形状规整、效率接近上限。MoE expert MatMul 在 M=64–256 时达成 ~55–72%（小 M GEMM 固有特性），shared expert MatMul 达成 ~85%（大 M 高效）',
      'Host 下发未饿死 device：各卡 Free（step_trace 口径）仅 249–300 ms（< step 的 2%），free_analysis 显示空闲多为 device 任务运行中的小间隙（EVENT_RECORD/EVENT_WAIT），非 host 下发跟不上',
      '数据采集完整：32 卡 profiler_info_{rank}.json 齐全（采集正常 Stop），ASCEND_PROFILER_OUTPUT 已解析，DB/CSV/trace 交付件齐备',
    ],
    meta: {
      date: '2026-07-15',
      dataPath: 'D:\\Projects\\ProfilingTest\\pangu2.0flash\\（32 个 *_ascend_pt 目录）',
      range: '32 Rank / 4 节点（node1=rank0–7、node2=rank8–15、node3=rank16–23、node4=rank24–31）× 8 卡；并行 TP1·PP4·EP4·DP2·CP1；采集 schedule skip_first=2/warmup=1/active=2（2 个有效 step，step3/step4）；Profiler Level1，aic_metrics=ACL_AICORE_PIPE_UTILIZATION',
      version: 'torch_npu 2.7.1 / CANN 8.3.RC1 · stage0(L0-11)=rank0–7 / stage1(L12-23)=rank8–15 / stage2(L24-35)=rank16–23 / stage3(L36-47+lm_head+loss)=rank24–31，EP 组 A={0,2,4,6}/B={1,3,5,7}，PP 组跨节点（P2P 走 RDMA）',
      skills: ['mindstudio_profiler_data_check', 'dataset-source-identifier', 'cluster-fast-slow-rank-detector', 'msprof-analyze-cli', 'op-mfu-calculator', 'performance-health-score', 'msinsight-view-selector'],
      advisorStatus: 'msprof-analyze advisor all 已调用 — 对集群数据跑 advisor all，命中 Environment Variable Issues / Operator Dynamic Shape Issues / Packet Analysis / Affinity API Issues（Affinity 因 with_stack=False 无栈，已忽略），结果已并入第 2 章行动清单（#5、#6）与第 3 章问题详情。集群模式 cluster_time_summary/compute_op_sum/hccl_sum/communication_time_sum/communication_matrix_sum/freq_analysis/free_analysis/cann_api_sum 为主证据来源',
      output: './Analysis Report/pangu2.0flash_profiling_analysis_20260715/',
    },
    // 与 report.md §5「数据来源与落盘信息」一致；运行时若 fetch 到报告会被 parseDiskFileInfo 覆盖
    diskFileInfo: {
      dir: 'pangu2.0flash/',
      source: '分布式训练 Profiling（PyTorch 框架 profiler，4 节点 × 8 卡）',
      isLLM: 'yes',
      model: 'Pangu 2.0 flash 72B MoE LLM 训练（hidden=4608、64 Q 头/4 KV 头 GQA、K-Norm、Partial RoPE、Sink Token、Sandwich-Norm、64 routed+4 shared experts、MoGE 8-group 路由、vocab 153600；总参数 72B/激活 16.50B）',
      size: '~4.2 GB（32 卡原始落盘，单卡 trace_view ~140 MB + DB ~48 MB）；evidence 举证副本 ~520 MB',
      link: '',
      linkText: '',
      basis: '算子签名 FlashAttentionScore(/Grad)+RmsNorm(/Grad)+SwiGlu(/Grad)+RotaryPositionEmbedding(/Grad) → 现代 Transformer LLM；Pangu 专有特征：KNorm（仅 Key 归一化，非 QK-Norm）、MoE 算子含 AllToAllV2（EP token dispatch/combine）+ Router（MoGE top-8 group-balanced routing）+ SharedExpert×4 + RoutedExpert×64、SinkToken（128 个可学习参数）。kernel_details.csv 中 FlashAttention InputShapes 4096,1,4608、Q heads 64、KV heads 4、head_dim 192(128 nope+64 rope) → hidden=4608、GQA 64Q/4KV，命中 Pangu 2.0 flash 架构。profiler_metadata.json 中 parallel_strategy: TP1·PP4·EP4·DP2，model_name: pangu_pro_moe_72b。含 *Grad+ApplyAdamWV2 → 训练（非推理）。具体 Pangu 2.0 flash 版本（v1/v2 迭代）未在落盘中确证，留空不写',
    },
  },
];

// ---- Skill 文档（用于文档 Tab）----
const SKILL_DOCS = {
  'mindstudio_profiler_data_check': { icon: '🔍', desc: '校验 MindStudio profiler 数据完整性：识别数据类型（框架 profiler / msprof）、检查采集状态（Stop Check）、验证关键交付件是否存在。' },
  'cluster-fast-slow-rank-detector': { icon: '🐢', desc: 'Ascend 多卡/集群快慢卡诊断：识别计算型慢卡、Host 下发型慢卡（伪快卡）、通信链路瓶颈，输出快慢卡矩阵。' },
  'op-mfu-calculator': { icon: '📐', desc: '计算 matmul/GEMM/FlashAttention 等算子的 MFU（模型浮点利用率），公式：实际 FLOPs/s ÷ 芯片峰值 FLOPs/s × 100。' },
  'performance-health-score': { icon: '💯', desc: '计算 0-100 的性能健康度评分（PHS）：涵盖计算利用率、通信效率、调度效率、内存带宽利用率、负载均衡度五子项，按工作负载场景自动切换权重。' },
  'msinsight-view-selector': { icon: '📊', desc: '为报告中每个问题点推荐 MindStudio Insight 可视化视图（Timeline / 算子视图 / 通信视图 / 内存视图 / 详情视图 / 源码视图），必须含视图名 + 文件 + 关注点三要素。' },
  'ascend-profiler-db-explorer': { icon: '🗄️', desc: 'Ascend PyTorch Profiler DB 的 SQL 查询工具：支持 schema/table 查询、算子耗时、通信耗时、下发与调度分析。' },  'msprof-analyze-cli': { icon: '🔧', desc: '基于 profiling 数据进行统计、比对和诊断，定位计算/通信/调度/集群瓶颈。支持 cluster_time_summary、compute_op_sum、hccl_sum 等多种分析模式。' },
  'msot-msopprof-operator-profiler': { icon: '⚙️', desc: 'msOpProf 深度分析：simulator/device 两种模式，解析 per-core pipe 利用率、指令热点、流量统计，输出 Top5 瓶颈报告。' },
  'ascendc-operator-performance-optim': { icon: '🚀', desc: 'AscendC 算子端到端调优闭环：覆盖 Tiling / 搬运 / API / 内存 / 流水 / Scalar 六个调优阶段，提供具体优化操作步骤。' },
};

// ---- Semantic colors ----
// 从 PTO 设计系统 accent 色（--ark-orange-500 / --ark-green-500）衍生，经 dataviz skill
// validate_palette.js 在 light(#ffffff)/dark(#101010) 双表面验证通过（含 CVD/对比度）。
// 仅 2 个色相、分得开，亮度可比 6 档等级色更高一档，对比度不降反升（3.4~3.6:1）。
const COLOR_CURRENT   = '#d66f03';  // orange 系 — 当前分数（优化前）
const COLOR_ESTIMATED = '#039c59';  // green  系 — 优化后预估

// ---- DOM ----
const $ = id => document.getElementById(id);
let currentReport = null;
let TIMELINE_SKELETON_HTML = '';  // tab-timeline pane 的初始静态骨架，切回有数据的报告时用于还原
let chatReport = null;
let chatHistory = [];   // DeepSeek 多轮对话历史（每次切换报告时重置）
let chatStreaming = false;
let phsChartInst = null;
let subChartInst = null;
let issueChartInst = null;
const _opCharts = [];

// ---- Init ----
async function init() {
  const timelinePane = $('tab-timeline');
  if (timelinePane) TIMELINE_SKELETON_HTML = timelinePane.innerHTML;
  await loadPresetReports();
  await loadReportChartData();
  setupTabs();
  setupDrop();
  setupSidebarCollapse();
  setupChatInput();
  updateKeyUI();
  updateQuotaUI();
  setupBenefitTooltip();
  setupGraphTabPanZoom();
  buildHistory();
  selectReport(REPORTS[REPORTS.length - 1]);
  window.addEventListener('resize', () => {
    phsChartInst?.resize();
    subChartInst?.resize();
    issueChartInst?.resize();
    _opCharts.forEach(c => c.resize());
    // Re-fit graph if graph tab is active
    const activeTab = document.querySelector('.v2-center-tab.active');
    if (activeTab?.dataset.tab === 'graph' && graphTabState.svg) {
      graphTabState.zoom = computeGraphFitZoom();
      graphCenterView();
    }
  });
  // setupTabs()/selectReport() 之后再广播，供 ?embed=timeline 等外部脚本据此安全切页签
  window.dispatchEvent(new Event('msnext:ready'));
}

function setupBenefitTooltip() {
  const tip = document.createElement('div');
  tip.className = 'g-tooltip';
  document.body.appendChild(tip);

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tooltip]');
    if (!el) return;
    tip.textContent = el.dataset.tooltip;
    tip.classList.add('visible');
  });

  document.addEventListener('mousemove', e => {
    if (!tip.classList.contains('visible')) return;
    const GAP = 10;
    let x = e.clientX + GAP;
    let y = e.clientY - tip.offsetHeight - GAP;
    if (x + tip.offsetWidth > window.innerWidth - 8) x = e.clientX - tip.offsetWidth - GAP;
    if (y < 8) y = e.clientY + GAP;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  });

  document.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-tooltip]')) return;
    tip.classList.remove('visible');
  });
}

async function loadPresetReports() {
  await Promise.all(REPORTS.map(async r => {
    try {
      const resp = await fetch('../' + r.filename);
      if (!resp.ok) return;
      const md = await resp.text();
      const parsed = parseReport(md, r.filename);
      if (parsed.issues.length) r.issues = parsed.issues;
      // 报告若带"数据来源与落盘信息"块，则以报告为准自动填充落盘卡片（覆盖手写值）
      if (parsed.diskFileInfo) r.diskFileInfo = parsed.diskFileInfo;
    } catch(e) {
      console.warn('loadPresetReports skipped:', r.filename);
    }
  }));
}

// 自动加载每份报告目录下的 chart-data.json 侧车（若存在），按 report.id 并入
// 全局图表数据表。新报告无需改 app.js / chart-data.js：目录里带上 chart-data.json
// （由 gen-report-charts.mjs 从 evidence/*.db 生成）即可自动出图。
// 侧车结构：{ swimlane?, opView?, commView?, freeAnalysis?, sourceView? }，键为 action id。
async function loadReportChartData() {
  // 渲染期实际读取的对象（与 chart-data.js 注入的 window.* 同引用）
  window.FREE_ANALYSIS_DATA = window.FREE_ANALYSIS_DATA || {};
  const TARGET = {
    swimlane:     SWIMLANE_DATA,
    opView:       OP_VIEW_DATA,
    commView:     COMM_VIEW_DATA,
    freeAnalysis: window.FREE_ANALYSIS_DATA,
    sourceView:   SOURCE_VIEW_DATA,
  };
  await Promise.all(REPORTS.map(async r => {
    if (!r.filename) return;
    const base = r.filename.replace(/\/[^/]*$/, '');   // 去掉结尾 /report.md
    try {
      const resp = await fetch(base + '/chart-data.json');
      if (!resp.ok) return;
      const cd = await resp.json();
      for (const [key, store] of Object.entries(TARGET)) {
        if (!cd[key]) continue;
        store[r.id] = { ...(store[r.id] || {}), ...cd[key] };  // 侧车覆盖同 action 的旧值
      }
      console.log('chart-data 侧车已加载:', base + '/chart-data.json');
    } catch (e) { /* 侧车可选，无则跳过 */ }
  }));
}

// ---- Sidebar History ----
function buildHistory() {
  const list = $('historyList');
  list.innerHTML = '';
  [...REPORTS].reverse().forEach(r => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.dataset.id = r.id;
    const gradeColor = gradeToColor(r.phs.grade);
    item.innerHTML = `
      <div class="history-title">${r.title}</div>
      <div class="history-meta">
        <span>${r.reportDate}</span>
        <span class="hi-badge" style="background:${gradeColor}20;color:${gradeColor}">${r.phs.grade}</span>
        <span class="hi-type">${r.taskType}</span>
      </div>`;
    item.addEventListener('click', () => selectReport(r));
    list.appendChild(item);
  });
}

function selectReport(report) {
  currentReport = report;
  document.querySelectorAll('.history-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === report.id));
  renderOverview(report);
  renderIssues(report);
  renderCode(report);
  renderDocs(report);
  renderRawReport(report);
  renderGraph(report);
  renderTimeline(report);
  initChat(report);
}

async function renderRawReport(report) {
  const el = $('reportMdContent');
  if (!el) return;
  let md = report.rawMd;
  if (!md && report.filename) {
    el.innerHTML = '<div class="report-md-status">加载中…</div>';
    try {
      const res = await fetch(report.filename);
      if (!res.ok) throw new Error();
      md = await res.text();
      report.rawMd = md;
    } catch {
      el.innerHTML = '<div class="report-md-status">原始报告文件不可用</div>';
      return;
    }
  }
  if (!md) { el.innerHTML = '<div class="report-md-status">无原始报告</div>'; return; }
  const comparisonHtml = await renderReportComparison(report);
  el.innerHTML = comparisonHtml + `<div class="report-md-body">${marked.parse(md)}</div>`;
}

// 报告原文页签内容区上方的差异对比块（0605、0610 等记录提供对比文件时渲染）
async function renderReportComparison(report) {
  if (!report.comparisonFile) return '';
  let md = report.comparisonMd;
  if (!md) {
    try {
      const res = await fetch(report.comparisonFile);
      if (!res.ok) throw new Error();
      md = await res.text();
      report.comparisonMd = md;
    } catch {
      return '';
    }
  }
  if (!md) return '';
  const title = report.comparisonTitle || '报告差异对比';
  return `<details class="report-comparison-card" open>
    <summary class="report-comparison-head">
      <span class="report-comparison-icon">⚖</span>
      <span class="report-comparison-title">${escHtml(title)}</span>
      <span class="report-comparison-toggle">点击展开 / 收起</span>
    </summary>
    <div class="report-md-body report-comparison-body">${marked.parse(md)}</div>
  </details>`;
}

// ---- Tabs ----
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t === tab);
        // PTO tab-control 用 .is-selected / aria-selected 承载选中态
        if (t.classList.contains('tab-control-item')) {
          t.classList.toggle('is-selected', t === tab);
          t.setAttribute('aria-selected', String(t === tab));
        }
      });
      document.querySelectorAll('.tab-pane').forEach(p =>
        p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`));
      if (tab.dataset.tab === 'overview') { phsChartInst?.resize(); subChartInst?.resize(); }
      if (tab.dataset.tab === 'issues') { issueChartInst?.resize(); }
      if (tab.dataset.tab === 'graph' && graphTabState.svg) {
        graphTabState.zoom = computeGraphFitZoom();
        graphCenterView();
      }
      if (tab.dataset.tab === 'timeline') activateTimelineTab(false);
    });
  });
}

// ---- Timeline Tab（父子层级泳道，按 report.id 取对应数据集）----
// 每份报告的原始 Timeline 数据集由 gen-*-timeline-data.mjs 离线生成为独立
// window.* 全局（体积大，独立文件懒加载/按需解析，不塞进 chart-data.js）。
// 新报告要接 Timeline：写一个生成器产出 { meta, coreTasks, laneTree }，
// 在下面注册 report.id → 取数函数即可，不用改页面结构。
const TIMELINE_REGISTRY = {
  r20260618pp: () => window.PROFILE_DIR_TIMELINE,   // profile_dir 多机多卡（8 rank）
  r20260610: () => {                                  // level2：按需动态加载 level2-timeline-data.js
    if (window.LEVEL2_TIMELINE) return window.LEVEL2_TIMELINE;
    if (!window.__level2Loading) {
      window.__level2Loading = true;
      const s = document.createElement('script');
      s.src = 'level2-timeline-data.js';
      s.onload = () => {
        window.__level2Loading = false;
        if (timelineTabState.pendingReportId === 'r20260610') activateTimelineTab(true);
      };
      document.head.appendChild(s);
    }
    return null;
  },
  r20260715pangu: () => window.PANGU_TIMELINE,       // pangu2.0flash：stage0(rank0)/stage3(rank24,28) 代表 rank，基于 0618 数据集微调复用
};
const timelineTabState = { renderer: null, builtForId: null, pendingReportId: null };

function renderTimeline(report) {
  const btn = $('timelineTabBtn');
  if (!btn) return;
  const getData = TIMELINE_REGISTRY[report?.id];
  const dataset = getData ? getData() : null;
  timelineTabState.pendingReportId = report?.id || null;

  btn.disabled = !dataset;
  if (dataset) delete btn.dataset.disabledTip;
  else btn.dataset.disabledTip = '此报告无关联 Timeline 数据';

  const isActive = document.querySelector('.v2-center-tab.active')?.dataset.tab === 'timeline';
  if (isActive || !dataset) activateTimelineTab(true);
}

function timelineFillSummary(meta) {
  const titleEl = $('tlSummaryTitle');
  const subEl   = $('tlSummarySub');
  if (titleEl && meta.title) titleEl.textContent = meta.title;
  if (!subEl) return;

  const parts = [];
  const steps = (meta.stepsPerRank || []).length;
  if (Array.isArray(meta.ranks) || typeof meta.ranks === 'number') {
    // profile_dir：多 rank 多机版 meta
    const slow = meta.slowRanks || [];
    const hosts = (meta.hosts || []).length;
    parts.push(`${meta.ranks} rank / ${hosts} host / 每 rank ${steps} step，层级 ${meta.hierarchy || 'Host ▸ Rank ▸ 分支'}（点击行首可折叠/展开，host 内真实对齐）`);
    if (slow.length) parts.push(`计算型慢卡：<b>Rank ${slow.join('、')}</b>，其余卡通信被大量“<b>等待同步</b>”占据（真实传输极短）＝在同步屏障处空等慢卡`);
    const hr = meta.hostRanks || {};
    const hostStr = Object.keys(hr).map(h => `${h}→R${hr[h].join('/R')}`).join('，');
    if (hostStr) parts.push(`机器分布：${hostStr}`);
  } else if (meta.rank !== undefined) {
    // level2：单 rank 版 meta
    parts.push(`${(meta.hosts || ['单机'])[0]} · Rank ${meta.rank} · ${steps} step，层级 ${meta.hierarchy || 'Rank ▸ 分支'}`);
    if (meta.note) parts.push(meta.note);
    if (meta.computingUs && meta.stageUs) {
      parts.push(`计算 ${(meta.computingUs/1000).toFixed(1)}ms / step 总时长 ${(meta.stageUs/1000).toFixed(1)}ms（占比 ${(meta.computingUs/meta.stageUs*100).toFixed(0)}%）`);
    }
  }
  if (meta.unavailableBranches && meta.unavailableBranches.length) {
    parts.push(`<span class="tl-na" title="${meta.unavailableBranches.join(' ｜ ').replace(/"/g, '&quot;')}">部分分支未渲染 ⓘ</span>`);
  }
  subEl.innerHTML = parts.join(' · ');
}

function activateTimelineTab(force) {
  const pane = $('tab-timeline');
  if (!pane) return;
  const reportId = timelineTabState.pendingReportId;
  const getData = TIMELINE_REGISTRY[reportId];
  const dataset = getData ? getData() : null;

  if (!dataset) {
    if (!pane.querySelector('.tl-empty-icon')) {
      pane.innerHTML = '<div class="tl-empty"><div class="tl-empty-icon">🏊</div><div>此报告无关联 Timeline 数据</div></div>';
    }
    timelineTabState.renderer = null;
    timelineTabState.builtForId = null;
    return;
  }

  if (!force && timelineTabState.builtForId === reportId && timelineTabState.renderer) {
    try { timelineTabState.renderer.onResize(); } catch (e) {}
    return;
  }

  if (!pane.querySelector('.tl-layout') && TIMELINE_SKELETON_HTML) pane.innerHTML = TIMELINE_SKELETON_HTML;

  const canvasEl = $('tlSwimlaneCanvas');
  const labelEl  = $('tlSwimlaneLabel');
  if (!canvasEl || !labelEl || typeof parseTraceJSON !== 'function' || typeof SwimlaneRenderer !== 'function') return;

  try {
    const parsed = parseTraceJSON(dataset.coreTasks);
    let analysis;
    try { analysis = (typeof analyzePerformance === 'function') ? analyzePerformance(parsed) : undefined; }
    catch (e) { analysis = undefined; }
    const renderer = new SwimlaneRenderer(canvasEl, labelEl, { labelWidth: 224 });
    // 标题格缩放读数占位：显示当前视窗可见的时间范围（无缩放功能，仅回显）
    const zoomReadout = $('tlZoomReadout');
    if (zoomReadout) renderer.onViewChange = ({ label }) => { zoomReadout.textContent = label; };
    renderer.loadData(parsed, analysis, dataset.laneTree || null);
    timelineFillSummary(dataset.meta || {});
    timelineTabState.renderer = renderer;
    timelineTabState.builtForId = reportId;
    bindTimelineViewToggle();
    requestAnimationFrame(() => { try { renderer.fitToView(); } catch (e) {} });
  } catch (e) {
    console.error('Timeline 泳道渲染失败', e);
    const lay = pane.querySelector('.tl-layout');
    if (lay) lay.innerHTML = `<div class="tl-empty"><div class="tl-empty-icon">🏊</div><div>Timeline 泳道渲染失败：${e && e.message ? e.message : e}</div></div>`;
  }
}

// Timeline 泳道「分类视图 / 算子视图」切换：分类=按计算/通信等语义着色，
// 算子=按算子名哈希着色（同名算子同色，默认）。按钮 DOM 在报告切换间常驻，只需绑定一次；
// 每次新数据加载后重置到算子视图。
function bindTimelineViewToggle() {
  const toggle = $('tlViewToggle');
  const legendItems = $('tlLegendItems');
  if (!toggle || !legendItems) return;

  if (!legendItems.dataset.defaultHtml) legendItems.dataset.defaultHtml = legendItems.innerHTML;
  toggle.querySelectorAll('.tl-view-btn').forEach(b => {
    const active = b.dataset.mode === 'op';
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  legendItems.classList.remove('tl-legend-note');
  legendItems.innerHTML = legendItems.dataset.defaultHtml;

  if (toggle.dataset.bound) return;
  toggle.dataset.bound = '1';
  toggle.addEventListener('click', e => {
    const btn = e.target.closest('.tl-view-btn');
    if (!btn) return;
    const mode = btn.dataset.mode === 'op' ? 'op' : 'semantic';
    toggle.querySelectorAll('.tl-view-btn').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    const li = $('tlLegendItems');
    if (li) {
      if (mode === 'op') {
        li.classList.add('tl-legend-note');
        li.innerHTML = '按算子名哈希着色：同一算子（同名内核）同色，不同算子颜色不同 · 悬停任务条查看具体算子名';
      } else {
        li.classList.remove('tl-legend-note');
        li.innerHTML = li.dataset.defaultHtml || '';
      }
    }
    timelineTabState.renderer?.setColorMode(mode);
  });
}

// ─── N/A 维度说明 ────────────────────────────────────────────
function getNaReason(dim, r) {
  const taskType = r.taskType || '';
  const subtitle = r.subtitle || '';
  const isOp = taskType.includes('算子');
  const isRL = taskType === 'RL 训练';
  const isSingleCard = subtitle.includes('单卡') || isOp;
  if (dim === '通信') {
    if (isOp) return '单算子调优任务不涉及跨卡通信，该维度不适用';
    if (isSingleCard && !isRL) return '单卡场景无跨卡通信链路，该维度不适用';
    return '本次 Profiling 未开启通信域事件采集';
  }
  if (dim === '内存') {
    if (isRL) return '本次采集 profile_memory=false，无 HBM/L2 带宽数据，内存子项记 N/A';
    return '本次 Profiling 未开启内存事件采集（需追加 memory 分析选项重新采集）';
  }
  if (dim === '均衡') {
    if (isOp) return '单算子调优无多卡负载均衡概念，该维度不适用';
    if (isRL) return '仅采集 rank 0 单卡数据，无法点名慢卡——需补采其余卡才能评估均衡度';
    if (isSingleCard) return '单卡场景无多卡均衡维度，该维度不适用';
    return '当前并行配置下无法评估跨卡负载均衡';
  }
  return '当前任务类型下无对应数据';
}

// ============================================================
// Tab 1: 总览
// ============================================================
// 指标看板：按 r.metrics 填充 #metricBoard 内各 KPI 卡片。
// r.metrics 形如 { critical_path_ratio: { value: 76, status?, note?, display? }, ... }
//   - value:   数值（无则保持「—」占位）
//   - status:  可选，显式指定 'ok' | 'warn' | 'bad'；缺省时按卡片 data-warn / data-dir 自动判定
//   - note:    可选，卡片底部状态文案（替换「暂无数据」）
//   - display: 可选，覆盖数值显示文本（如保留小数位）
// 当前任务无对应数据时不调用即可，卡片维持 .ovm-na 空占位。
// 卡片底部迷你进度条（.ovm-meter/.ovm-meter-fill）：随 --ovm-meter-color 变量着色，
// 首次调用时惰性创建 DOM（卡片 markup 里不预置，避免无数据状态下的空壳）。
function setMetricCardProgress(card, value) {
  if (!card) return;
  const head = card.querySelector('.ovm-head');
  if (head && !head.querySelector('.ovm-dot')) {
    const dot = document.createElement('span');
    dot.className = 'ovm-dot';
    dot.setAttribute('aria-hidden', 'true');
    head.prepend(dot);
  }
  let meter = card.querySelector('.ovm-meter');
  if (!meter) {
    meter = document.createElement('div');
    meter.className = 'ovm-meter';
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');
    meter.innerHTML = '<span class="ovm-meter-fill"></span>';
    card.appendChild(meter);
  }
  const pct = isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0;
  meter.setAttribute('aria-valuenow', String(Math.round(pct)));
  meter.querySelector('.ovm-meter-fill').style.width = `${pct}%`;
}

function renderMetricBoard(r) {
  const board = document.getElementById('metricBoard');
  if (!board) return;
  const metrics = (r && r.metrics) || {};
  board.querySelectorAll('.ovm-card').forEach(card => {
    const key = card.dataset.metric;
    const valEl = card.querySelector('.ovm-value');
    const stEl = card.querySelector('.ovm-status');
    const m = metrics[key];
    setMetricCardProgress(card, NaN);

    // 芯片相关卡片（MFU / 显存利用率）：存原始量，按下拉所选峰值/容量换算，不走 m.value
    if (card.dataset.raw) {
      const raw = m ? Number(m[card.dataset.raw]) : NaN;
      card._raw = isFinite(raw) ? raw : NaN;
      card._note = (m && m.note) || '';
      // MFU 卡：若报告给出了端到端 MFU（拆解 PP bubble/通信/优化器等陪跑损耗后的真实值），
      // 卡片直接展示这个数字，而不是「stage0 cube 达成 ÷ 芯片峰值」这种偏高的单点估算
      // ——两者的差异正是「MFU 计算明细」抽屉要解释的内容。
      const e2e = m ? Number(m.e2e_pct) : NaN;
      card._e2ePct = isFinite(e2e) ? e2e : NaN;
      refreshChipCard(card);
      return;
    }

    card.classList.remove('ovm-ok', 'ovm-warn', 'ovm-bad', 'ovm-na');

    if (!m || m.value == null || m.value === '') {       // 无数据 → 占位
      valEl.textContent = '—';
      card.classList.add('ovm-na');
      if (stEl) stEl.textContent = '暂无数据';
      setMetricCardProgress(card, NaN);
      return;
    }

    const v = Number(m.value);
    valEl.textContent = (m.display != null) ? m.display : (isFinite(v) ? v : m.value);

    let status = m.status;                                // 显式状态优先
    const warnAttr = card.dataset.warn;
    if (!status && warnAttr != null && warnAttr !== '' && isFinite(v)) {
      const warn = Number(warnAttr);
      const breach = card.dataset.dir === 'high' ? v < warn : v > warn;
      status = breach ? 'warn' : 'ok';
    }
    if (status) card.classList.add('ovm-' + status);     // 无阈值且无显式状态 → 中性
    if (stEl) stEl.textContent = m.note || '';
    setMetricCardProgress(card, v);
  });

  // 下拉切换：MFU 与显存卡按「同一型号」联动（选项顺序一致，按 index 对齐），两张卡一起重算。只绑定一次
  if (!board._chipBound) {
    board._chipBound = true;
    board.addEventListener('change', e => {
      const sel = e.target.closest('.ovm-select');
      if (!sel) return;
      const idx = sel.selectedIndex;
      board.querySelectorAll('.ovm-chipcard .ovm-select').forEach(s => {
        if (s !== sel && idx < s.options.length) s.selectedIndex = idx;   // 同步到同型号
      });
      board.querySelectorAll('.ovm-chipcard').forEach(refreshChipCard);
    });
  }

  initMetricEditor();   // 「编辑」控制面板（显示/隐藏 + 拖动排序），幂等
}

// ── 指标看板「编辑」控制面板：默认只显示 4 个指标，可勾选增减、拖动排序 ──
const METRIC_BOARD_DEFAULT = ['critical_path_ratio', 'op_utilization', 'mfu', 'mem_util'];

function metricCardLabel(card) {
  return (card.querySelector('.ovm-name')?.textContent || card.dataset.metric || '').trim();
}

function initMetricEditor() {
  const board = document.getElementById('metricBoard');
  const btn = document.getElementById('metricEditBtn');
  const panel = document.getElementById('metricEditor');
  if (!board || !btn || !panel || board._editorInit) return;
  board._editorInit = true;

  // 默认：仅显示 METRIC_BOARD_DEFAULT 的 4 个，并按该顺序前置；其余隐藏
  const present = METRIC_BOARD_DEFAULT.filter(k => board.querySelector(`.ovm-card[data-metric="${k}"]`));
  present.slice().reverse().forEach(k => {                 // 倒序逐个插到最前 → 正序前置
    board.insertBefore(board.querySelector(`.ovm-card[data-metric="${k}"]`), board.firstChild);
  });
  board.querySelectorAll('.ovm-card').forEach(c => {
    c.classList.toggle('ovm-hidden', !present.includes(c.dataset.metric));
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (panel.classList.toggle('open')) renderMetricEditor();
  });
  panel.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => panel.classList.remove('open'));
}

function renderMetricEditor() {
  const board = document.getElementById('metricBoard');
  const panel = document.getElementById('metricEditor');
  if (!board || !panel) return;
  const all = [...board.querySelectorAll('.ovm-card')];
  const shown = all.filter(c => !c.classList.contains('ovm-hidden'));
  const hidden = all.filter(c => c.classList.contains('ovm-hidden'));
  const row = (c, isShown) =>
    `<div class="dd-item${isShown ? '' : ' muted'}"${isShown ? ' draggable="true"' : ''} data-key="${c.dataset.metric}">
       <span class="dd-handle"${isShown ? '' : ' style="visibility:hidden"'}>⠿</span>
       <span class="dd-label">${metricCardLabel(c)}</span>
       <input type="checkbox"${isShown ? ' checked' : ''} data-key="${c.dataset.metric}"></div>`;
  panel.innerHTML =
    `<div class="dd-title">已显示 <span class="hint">拖动排序</span></div>` +
    `<div id="meShown">` + shown.map(c => row(c, true)).join('') + `</div>` +
    `<div class="dd-title">未显示 <span class="hint">勾选加入看板</span></div>` +
    hidden.map(c => row(c, false)).join('') +
    `<div class="dd-divider"></div>` +
    `<div class="dd-add" id="meAddCustom"><span class="dd-add-icon">+</span><span>新建自定义指标</span></div>`;
  bindMetricEditor();
}

function bindMetricEditor() {
  const board = document.getElementById('metricBoard');
  const panel = document.getElementById('metricEditor');

  // 新建自定义指标：入口先接好，具体的指标定义/公式表单待产品设计
  const addBtn = document.getElementById('meAddCustom');
  if (addBtn) addBtn.addEventListener('click', e => { e.stopPropagation(); });

  // 勾选切换显示/隐藏：显示则移到已显示末尾
  panel.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', e => {
      e.stopPropagation();
      const card = board.querySelector(`.ovm-card[data-metric="${cb.dataset.key}"]`);
      if (!card) return;
      if (cb.checked) { card.classList.remove('ovm-hidden'); board.appendChild(card); }
      else { card.classList.add('ovm-hidden'); }
      renderMetricEditor();
    });
  });

  // 拖动排序（仅「已显示」区），结束后把面板顺序应用回看板 DOM
  const container = document.getElementById('meShown');
  if (!container) return;
  let dragEl = null;
  container.querySelectorAll('.dd-item').forEach(item => {
    item.addEventListener('dragstart', () => { dragEl = item; item.classList.add('dragging'); });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      [...container.querySelectorAll('.dd-item')].forEach(el => {  // 按面板顺序依次 append
        const c = board.querySelector(`.ovm-card[data-metric="${el.dataset.key}"]`);
        if (c) board.appendChild(c);
      });
      board.querySelectorAll('.ovm-card.ovm-hidden').forEach(c => board.appendChild(c)); // 隐藏的置后
    });
  });
  container.addEventListener('dragover', e => {
    e.preventDefault();
    if (!dragEl) return;
    const after = metricEditorAfter(container, e.clientY);
    if (after == null) container.appendChild(dragEl);
    else container.insertBefore(dragEl, after);
  });
}

function metricEditorAfter(container, y) {
  const items = [...container.querySelectorAll('.dd-item:not(.dragging)')];
  let closest = { dist: -Infinity, el: null };
  for (const el of items) {
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.dist) closest = { dist: offset, el };
  }
  return closest.el;
}

// 按卡内下拉所选项，用原始量（达成算力 TF/s · 显存占用峰值 GB）换算百分比并着色
function refreshChipCard(card) {
  if (!card) return;
  const valEl = card.querySelector('.ovm-value');
  const stEl = card.querySelector('.ovm-status');
  const sel = card.querySelector('.ovm-select');
  const raw = card._raw;
  card.classList.remove('ovm-ok', 'ovm-warn', 'ovm-bad', 'ovm-na');

  if (!isFinite(raw)) {                                   // 无落盘原始量 → 占位（下拉仍可切换）
    valEl.textContent = '—';
    card.classList.add('ovm-na');
    if (stEl) stEl.textContent = card._note || '暂无数据';
    setMetricCardProgress(card, NaN);
    return;
  }

  const denom = Number(sel.value);
  const pct = (denom > 0) ? (raw / denom * 100) : NaN;
  const isMfu = card.dataset.metric === 'mfu';
  const hasE2e = isMfu && isFinite(card._e2ePct);
  valEl.textContent = hasE2e ? card._e2ePct.toFixed(0) : (isFinite(pct) ? pct.toFixed(1) : '—');
  setMetricCardProgress(card, hasE2e ? card._e2ePct : pct);
  // 分母是用户手选的假设值，不做 ok/warn 着色，卡片保持中性

  // 状态行：把换算依据写清楚（原始量 + 当前所选项），便于核对
  if (stEl) {
    const opt = sel.options[sel.selectedIndex]?.textContent || '';
    stEl.textContent = hasE2e
      ? `端到端（拆 PP bubble/通信/优化器后）；cube 达成 ${raw} TF/s ÷ ${opt} ≈ ${isFinite(pct) ? pct.toFixed(0) : '—'}%`
      : isMfu
        ? `达成 ${raw} TF/s ÷ ${opt}`
        : `占用 ${raw} GB ÷ ${opt}`;
  }
}

function renderOverview(r) {
  // 模板选择器 + PHS 说明入口：位于"总结"标题行右侧；PHS 卡片内只保留图表标题。
  const summaryControlsEl = $('phsSummaryControls');
  summaryControlsEl.innerHTML = `
    <label class="phs-select-wrap">
      <select class="phs-template-select" id="phsTemplateSelect" aria-label="评估模板">
        <option>训练评估模板v2.1</option>
        <option>算子评估模板v2.0</option>
        <option>服务化评估模板v2.0</option>
        <option>稀疏架构团队定制评估系统v1.0</option>
      </select>
      <svg class="phs-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </label>
    <span class="phs-info-anchor" id="phsInfoIcon">
      <button class="phs-info-trigger" type="button" aria-label="查看 PHS 评分说明"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></button>
      <div class="phs-tooltip" id="phsTooltip">
        <div class="ptt-title">PHS 评分说明</div>
        <div class="ptt-subtitle">Performance Health Score — 衡量训练、推理及性能测量等工作负载综合性能表现的 0–100 评分体系</div>

        <div class="ptt-section">公式</div>
        <div class="ptt-formula">PHS = w<sub>计算</sub>×计算利用率 + w<sub>通信</sub>×通信效率 + w<sub>调度</sub>×调度效率 + w<sub>内存</sub>×内存带宽利用率 + w<sub>均衡</sub>×负载均衡度</div>
        <div class="ptt-sub">各子项归一化为 0–100；子项数据缺失时记 N/A，剩余权重按比例放大，不视为不健康。</div>

        <div class="ptt-section"><span>场景权重</span><button class="ptt-set-btn" id="pttWeightSetBtn">设置</button></div>
        <table class="ptt-table">
          <tr><th>场景</th><th>计算</th><th>通信</th><th>调度</th><th>内存</th><th>均衡</th></tr>
          <tr><td>大模型多卡训练</td><td>0.35</td><td>0.25</td><td>0.20</td><td>0.10</td><td>0.10</td></tr>
          <tr><td>单卡训练 / 推理</td><td>0.50</td><td>N/A</td><td>0.30</td><td>0.20</td><td>—</td></tr>
          <tr><td>单算子调优</td><td>0.50</td><td>N/A</td><td>0.20</td><td>0.30</td><td>—</td></tr>
          <tr><td>集群慢卡</td><td>0.20</td><td>0.30</td><td>0.30</td><td>0.10</td><td>0.10</td></tr>
        </table>

        <div class="ptt-section">子项算法</div>
        <div class="ptt-item"><b>计算利用率</b>：大模型训练用 MFU = 实际 FLOPs/s ÷ 峰值 FLOPs/s；其余场景用 AI Core busy time ÷ 总采集时间</div>
        <div class="ptt-item"><b>通信效率</b>：Σ(实测带宽 × 字节数) ÷ Σ(理论带宽 × 字节数)，按 HCCS / RDMA / PCIe 分类</div>
        <div class="ptt-item"><b>调度效率</b>：1 − (Free + Wait + Idle) ÷ 单步总时间，多卡取均值</div>
        <div class="ptt-item"><b>内存带宽利用率</b>：HBM 实测读写带宽 ÷ HBM 峰值带宽（910B 峰值 1.6 TB/s）</div>
        <div class="ptt-item"><b>负载均衡度</b>：1 − 各卡（各流水级）单步计算耗时极差 ÷ 最慢卡耗时（越接近 100 越均衡），仅多卡 / 流水并行 / 集群场景适用</div>

        <div class="ptt-section">等级映射</div>
        <div class="ptt-grades">
          <span class="ptt-grade grade-s">S 90–100</span>
          <span class="ptt-grade grade-a">A 75–89</span>
          <span class="ptt-grade grade-bp">B+ 60–74</span>
          <span class="ptt-grade grade-b">B 45–59</span>
          <span class="ptt-grade grade-c">C 30–44</span>
          <span class="ptt-grade grade-d">D 0–29</span>
        </div>
        <div class="ptt-sub" style="margin-top:6px">S：接近理论极限 · A：优秀 · B+：良好，有优化空间 · B：中等 · C：较差 · D：严重瓶颈</div>
      </div>
    </span>`;

  // PHS 标题行（独占一行，全宽；模板/说明入口已挪到 summaryControlsEl）
  const hdrEl = $('phsChartHeader');
  hdrEl.innerHTML = `
    <div class="phs-header">
      <span class="phs-title">性能健康度（PHS）</span>
    </div>`;

  // PHS 仪表盘
  const wrap = $('phsChartWrap');
  wrap.innerHTML = `<div id="phsChart" class="phs-gauge-box"></div>`;
  phsChartInst?.dispose();
  phsChartInst = null;
  renderPhsGauge($('phsChart'), r.phs);

  // 摘要卡片：核心结论已由面板标题（.ov3-summary-panel-title）承担，卡片内不再重复标签
  $('summaryCards').innerHTML = `
    <div class="sum-card sum-conclusion">
      <div class="sum-text">${r.summary.conclusion}</div>
    </div>
    <div class="sum-card sum-bottleneck" title="点击查看问题列表">
      <div class="sum-label">头号瓶颈</div>
      <div class="sum-text">${r.summary.topBottleneck}</div>
    </div>
    <div class="sum-card sum-gain">
      <div class="sum-label">收益上限</div>
      <div class="sum-text">${r.summary.maxGain}</div>
    </div>
  `;

  const bottleneckCard = $('summaryCards').querySelector('.sum-bottleneck');
  if (bottleneckCard) {
    bottleneckCard.addEventListener('click', () => {
      document.querySelector('.tab[data-tab="issues"]')?.click();
      const firstCard = document.querySelector('#issuesList .ic-card');
      if (firstCard) firstCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // 指标看板（仪表盘与关键问题之间）；当前 r.metrics 未提供时各卡保持空占位
  renderMetricBoard(r);

  // 子项雷达图（固定 5 维度，缺失记 N/A）
  const subWrap = $('subItemsChartWrap');
  subWrap.innerHTML = `<div id="subChart" style="width:100%;height:280px"></div><div id="subNaWrap"></div>`;
  subChartInst?.dispose();
  subChartInst = echarts.init($('subChart'));
  const PHS_DIMS = ['计算', '通信', '调度', '内存', '均衡'];
  const subsMap = Object.fromEntries(r.phs.subItems.map(s => [s.name, s.value ?? null]));
  const allSubs = PHS_DIMS.map(name => ({ name, value: subsMap[name] ?? null }));
  const radarValues = allSubs.map(s => s.value === null ? 0 : s.value);
  const estSubsMap = Object.fromEntries((r.phs.estSubItems || []).map(s => [s.name, s.value ?? null]));
  const allEstSubs = PHS_DIMS.map((name, i) => {
    const v = estSubsMap[name] ?? null;
    return { name, value: v !== null ? v : allSubs[i].value };
  });
  const radarEstValues = allEstSubs.map(s => s.value === null ? 0 : s.value);
  // 偶数环底色：跟浅色/深色主题各给一版，避免深色主题下这层近白色蒙版发亮，
  // 同时保持和网格线（rgba(33,33,33,..) 中性灰）不同色相，两者才分得清。
  const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';
  const ringFill = isDarkTheme ? 'rgba(70,76,110,0.28)' : 'rgba(236,238,245,0.34)';
  subChartInst.setOption({
    tooltip: {
      trigger: 'item',
      formatter: () => PHS_DIMS.map((name, i) => {
        const cur = allSubs[i].value;
        const est = estSubsMap[name] ?? null;
        const curStr = cur === null ? 'N/A' : cur + '%';
        const estStr = est === null ? (cur === null ? 'N/A' : cur + '%') : est + '%';
        return `${name}：<span style="color:${COLOR_CURRENT}">${curStr}</span> → <span style="color:${COLOR_ESTIMATED}">${estStr}</span>`;
      }).join('<br>'),
    },
    legend: {
      data: [{ name: '当前', icon: 'circle' }, { name: '优化后预估', icon: 'circle' }],
      bottom: 2,
      textStyle: { color: '#999999', fontSize: 10 },
      itemWidth: 8,
      itemHeight: 8,
      selectedMode: false,
    },
    radar: {
      indicator: allSubs.map(s => ({ name: s.name, max: 100 })),
      center: ['50%', '50%'],
      radius: '56%',
      shape: 'polygon',
      axisName: {
        formatter: name => {
          const s = allSubs.find(x => x.name === name);
          const v = s?.value === null ? 'N/A' : `${s.value}%`;
          return `{nm|${name}}\n{val|${v}}`;
        },
        rich: {
          nm: { color: '#8a8a96', fontSize: 10, lineHeight: 14 },
          val: { color: COLOR_CURRENT, fontSize: 12, fontWeight: 'bold', lineHeight: 16 },
        },
      },
      splitNumber: 4,
      splitArea: { areaStyle: { color: ['rgba(255,255,255,0)', ringFill] } },
      axisLine: { lineStyle: { color: 'rgba(33,33,33,0.10)' } },
      splitLine: { lineStyle: { color: 'rgba(33,33,33,0.10)' } },
    },
    series: [
      {
        type: 'radar',
        name: '当前',
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: COLOR_CURRENT, width: 1.4 },
        itemStyle: { color: COLOR_CURRENT },
        areaStyle: { color: `${COLOR_CURRENT}24` },
        data: [{ value: radarValues, name: '当前' }],
      },
      {
        type: 'radar',
        name: '优化后预估',
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: COLOR_ESTIMATED, width: 1.4, type: 'dashed' },
        itemStyle: { color: COLOR_ESTIMATED },
        areaStyle: { color: `${COLOR_ESTIMATED}22` },
        data: [{ value: radarEstValues, name: '优化后预估' }],
      },
    ],
  });

  // N/A 维度说明
  const naDims = allSubs.filter(s => s.value === null);
  $('subNaWrap').innerHTML = naDims.length ? `
    <div class="sub-na-notes">
      <div class="sub-na-header">N/A 维度说明</div>
      ${naDims.map(s => `
        <div class="sub-na-row">
          <span class="sub-na-dim">${s.name}</span>
          <span class="sub-na-reason">${getNaReason(s.name, r)}</span>
        </div>`).join('')}
    </div>` : '';

  // 气泡 tooltip（fixed 定位 + JS 控制）
  requestAnimationFrame(setupPhsTooltip);

  // 任务元数据
  $('metaPanel').innerHTML = `
    <div class="meta-title">数据与任务信息</div>
    <div class="meta-grid">
      ${metaRow('分析日期', r.meta.date)}
      ${metaRow('数据范围', r.meta.range)}
      ${metaRow('版本', r.meta.version || '—')}
      ${metaRow('输出目录', `<code>${r.meta.output}</code>`)}
    </div>
    <div class="meta-path"><code>${r.meta.dataPath}</code></div>
    <div class="meta-skills-label">使用的 Skills</div>
    <div class="skills-tags">${r.meta.skills.map(s => `<span class="skill-tag">${s}</span>`).join('')}</div>
    ${r.noProblems.length ? `
    <div class="meta-ok-label">✅ 已确认无问题</div>
    <ul class="ok-list">${r.noProblems.map(p => `<li>${p}</li>`).join('')}</ul>` : ''}
  `;

  const dfi = r.diskFileInfo;
  const diskPanel = $('diskInfoPanel');
  if (dfi && diskPanel) {
    const muted = '<span style="color:var(--fg-muted)">—</span>';
    const mutedNoBasis = '<span style="color:var(--fg-muted);font-style:italic">— 无识别依据，留空</span>';
    const llmBadge = {
      yes: '<span class="disk-llm-badge disk-llm-yes">是</span>',
      no:  '<span class="disk-llm-badge disk-llm-no">否</span>',
      na:  '<span class="disk-llm-badge disk-llm-na">不适用</span>',
    }[dfi.isLLM] || muted;
    diskPanel.innerHTML = `
      <div class="meta-title">落盘文件信息</div>
      <div class="meta-grid">
        ${metaRow('数据目录', dfi.dir ? `<code>${escHtml(dfi.dir)}</code>` : muted)}
        ${metaRow('来源', dfi.source ? escHtml(dfi.source) : muted)}
        ${metaRow('LLM 训练', llmBadge)}
        ${metaRow('模型 / 用途', dfi.model ? escHtml(dfi.model) : mutedNoBasis)}
        ${metaRow('落盘大小', dfi.size ? `<strong class="disk-size">${escHtml(dfi.size)}</strong>` : muted)}
        ${metaRow('来源链接', dfi.link ? `<a href="${escHtml(dfi.link)}" target="_blank" class="disk-link">${escHtml(dfi.linkText || dfi.link)} ↗</a>` : muted)}
        ${dfi.basis ? metaRow('识别依据', `<span style="color:var(--fg-secondary);font-size:11px;line-height:1.5">${escHtml(dfi.basis)}</span>`) : ''}
      </div>
    `;
  }
}

// ============================================================
// Tab 2: 问题
// ============================================================
// 关键问题排序：'benefit'(优化收益高→低，默认) | 'severity'(严重程度高→低) | 'difficulty'(修改难度低→高)
let issueSortMode = 'benefit';
const ISSUE_DIFF_RANK = { '低': 0, '中': 1, '高': 2 };
const ISSUE_PRIO_RANK = { P0: 0, P1: 1, P2: 2 };
// 标签悬浮提示文案：优先级（P0/P1/P2）与修复难度（高/中/低）
const ISSUE_PRIO_TIP = {
  P0: 'P0 · 最高优先级：对性能影响最大，建议立即处理',
  P1: 'P1 · 高优先级：影响较大，建议尽快处理',
  P2: 'P2 · 一般优先级：可在后续迭代中优化',
};
const ISSUE_DIFF_TIP = {
  '高': '修复难度：高 · 改动较大或涉及核心逻辑，需谨慎评估',
  '中': '修复难度：中 · 改动适中，需一定开发与验证成本',
  '低': '修复难度：低 · 改动较小，可快速落地',
};
const prioTip = p => ISSUE_PRIO_TIP[p] || '问题优先级';
const diffTip = d => ISSUE_DIFF_TIP[d] || '修复难度';

function sortIssueActions(actions) {
  const arr = actions.slice();
  if (issueSortMode === 'severity') {
    arr.sort((a, b) => (ISSUE_PRIO_RANK[a.priority] ?? 9) - (ISSUE_PRIO_RANK[b.priority] ?? 9)
      || (b.benefitNum || 0) - (a.benefitNum || 0));
  } else if (issueSortMode === 'difficulty') {
    arr.sort((a, b) => (ISSUE_DIFF_RANK[a.difficulty] ?? 9) - (ISSUE_DIFF_RANK[b.difficulty] ?? 9)
      || (b.benefitNum || 0) - (a.benefitNum || 0));
  } else { // benefit
    arr.sort((a, b) => (b.benefitNum || 0) - (a.benefitNum || 0));
  }
  return arr;
}

window.setIssueSort = function (mode) {
  issueSortMode = mode;
  if (currentReport) renderIssues(currentReport);
};

function renderIssues(r) {
  const issuesTab = document.querySelector('.tab[data-tab="issues"]');
  if (issuesTab) issuesTab.textContent = `问题 (${r.actions.length})`;

  const listEl = $('issuesList');
  if (!listEl) return;

  const sel = $('issueSortSelect');
  if (sel) sel.value = issueSortMode;

  const sortedActions = sortIssueActions(r.actions);
  listEl.innerHTML = sortedActions.map((a, idx) => {
    const pc = { P0: '#FF4B7B', P1: '#FF8C42', P2: '#666666' }[a.priority] || '#666666';
    return `
      <div class="ic-card${idx === 0 ? ' active' : ''}" data-id="${a.id}" data-report="${r.id}"
           onclick="selectIssueCard(this)">
        <div class="ic-card-title">${escHtml(a.problem)}</div>
        <div class="ic-card-meta">
          <span class="ac-priority" style="background:${pc}20;color:${pc}" data-tooltip="${escHtml(prioTip(a.priority))}">${a.priority}</span>
          ${a.benefitNum ? `<span class="ac-benefit" data-tooltip="预期单步总耗时减少：${a.benefit}">-${a.benefitNum}%</span>` : ''}
          <span class="ac-diff diff-${a.difficulty}" data-tooltip="${escHtml(diffTip(a.difficulty))}">${escHtml(a.difficulty)}</span>
        </div>
      </div>`;
  }).join('');

  if (sortedActions.length > 0) renderIssueDetail(r, sortedActions[0]);
}

window.selectIssueCard = function(cardEl) {
  const rid = cardEl.dataset.report;
  const aid = +cardEl.dataset.id;
  cardEl.closest('.issues-card-list')
    ?.querySelectorAll('.ic-card')
    .forEach(c => c.classList.remove('active'));
  cardEl.classList.add('active');
  if (!currentReport || currentReport.id !== rid) return;
  const a = currentReport.actions.find(x => x.id === aid);
  if (a) renderIssueDetail(currentReport, a);
};

// ============================================================
// 智能修复审核（数据来源：性能问题定位分析/源码级定位_3.1与3.2_示例.md）
//   按 reportId → actionId 两级索引。每条 = { source, caveat?, schemes:[...] }。
//   每个 scheme（方案，渲染为顶部 Tab）：
//     name        — 方案名（如「方案 A」）
//     recommended — true 时显示「推荐」徽标
//     conceptual  — true 时显示「示意」徽标（治本/需改源码，无可直接套用的 diff）
//     rootCause   — 根因定位（一句话）
//     strategy    — 修改策略（一句话）
//     path        — diff 文件路径（面包屑展示，最后一段加粗）
//     lnStart     — diff 起始行号（默认 1）
//     rows        — 并排 diff 行，每行取以下之一：
//                   { same:'…' } 两侧相同 ｜ { add:'…' } 仅右侧新增
//                   { del:'…' } 仅左侧删除 ｜ { before:'…', after:'…' } 两侧修改
//   渲染插入于「修复建议」与「问题修改完成的验证方式」之间。
// ============================================================
const FIX_REVIEW_DATA = {
  r20260618pp: {
    // 3.1 — PP 末级 stage3 计算过载
    1: {
      source: '性能问题定位分析/源码级定位_3.1与3.2_示例.md · Megatron-LM core_v0.12.1 + MindSpeed-LLM master',
      caveat: '源码与根因为真实抓取；具体 args 来自 reconstructed_inputs_CONSTRUCTED（构造现场），需按真实落盘 Megatron 版本与 MindSpeed arg parser 复核。',
      schemes: [
        {
          name: '方案 A', recommended: true,
          rootCause: 'lm_head + loss 硬绑末级、PP 默认均匀切（28//4=7 层/级）不为其预留配额，末级白扛 3584×152064 GEMM + loss，多算 ~3.1 s，制造 ~35% bubble。',
          strategy: '非均匀切分，末级少 1 层、首级多 1 层（8/7/7/6=28）抵消 lm_head 开销，触发 transformer_block.py:61-104 非均匀分支，末级计算 ~9.26 s → ~6.4 s；差额 ~3.1 s ≈ 0.5 层，先调 1 层按实测微调。',
          path: '性能问题定位分析/reconstructed_inputs_CONSTRUCTED/pretrain_qwen25_7b_32k_ptd.sh',
          lnStart: 64,
          rows: [
            { same: '--tensor-model-parallel-size 1' },
            { same: '--num-layers 28' },
            { same: '--pipeline-model-parallel-size 4' },
            { add: '--decoder-first-pipeline-num-layers 8' },
            { add: '--decoder-last-pipeline-num-layers 6' },
            { same: '--sequence-parallel' },
            { same: '--seq-length 32768' },
          ],
        },
        {
          name: '方案 B',
          rootCause: '同上：默认 account_for_loss_in_pipeline_split=False，框架不为 loss 预留 PP 配额。',
          strategy: '开 --account-for-loss-in-pipeline-split 让框架自动预留（transformer_block.py:111-112 num_layers+=1，末级 build 再 -1）。⚠️ 需 num_layers(+1/+2) 被 PP 整除，本例 28 不满足，须配合调层数或改用方案 A。',
          path: '性能问题定位分析/reconstructed_inputs_CONSTRUCTED/pretrain_qwen25_7b_32k_ptd.sh',
          lnStart: 64,
          rows: [
            { same: '--tensor-model-parallel-size 1' },
            { same: '--num-layers 28' },
            { same: '--pipeline-model-parallel-size 4' },
            { add: '--account-for-loss-in-pipeline-split' },
            { same: '--sequence-parallel' },
            { same: '--seq-length 32768' },
          ],
        },
        {
          name: '方案 C', conceptual: true,
          rootCause: 'TP=1 时 152064 维 lm_head GEMM 与交叉熵全压末级单卡，是 stage3 过载的本质来源。',
          strategy: '治本：对输出投影做 vocab 并行 + vocab-parallel cross-entropy，把词表维 GEMM/CE 摊到多卡（需 TP>1，改动较大）。下方为改法示意。',
          path: '_src/megatron_core_v0.12.1_singlefiles/gpt_model.py',
          lnStart: 389,
          rows: [
            { same: '# Output layer & loss（post_process 末级）' },
            { same: 'if labels is None:' },
            { same: '    return logits.transpose(0, 1).contiguous()' },
            { del: 'logits, _ = self.output_layer(hidden_states, weight)' },
            { add: 'logits, _ = self.output_layer(hidden_states, weight)  # gather_output=False, vocab 并行' },
            { del: 'loss = self.compute_language_model_loss(labels, logits)' },
            { add: 'loss = vocab_parallel_cross_entropy(logits, labels)  # 词表维并行 CE' },
            { same: 'return loss' },
          ],
        },
      ],
    },
    // 3.2 — 计算-通信零重叠
    2: {
      source: '性能问题定位分析/源码级定位_3.1与3.2_示例.md · Megatron-LM core_v0.12.1 + MindSpeed-LLM master',
      caveat: '源码与根因为真实抓取；「实际未开这些开关」来自 reconstructed_inputs_CONSTRUCTED（构造现场），参数组合受 MindSpeed arg 校验约束，需对真实 arg parser 验证。',
      schemes: [
        {
          name: '推荐方案', recommended: true,
          rootCause: '① vp=None → schedules.py:110 走无交错 1F1B，bubble 最大且无重叠窗口；② overlap_grad_reduce=False → grad_sync_func 未设置，梯度 allreduce 串行暴露，communicationOverlapComputation=0。',
          strategy: '开 interleaved 1F1B 压 bubble 并造重叠窗口，同时让 DDP 异步 grad、param all-gather 与计算重叠。每 stage 层数须被 num-layers-per-virtual-pipeline-stage 整除（7 不被 >1 整除 → 取 1，或先按 3.1 调成可整除层数）。',
          path: '性能问题定位分析/reconstructed_inputs_CONSTRUCTED/pretrain_qwen25_7b_32k_ptd.sh',
          lnStart: 70,
          rows: [
            { same: '--pipeline-model-parallel-size 4' },
            { same: '--use-distributed-optimizer' },
            { add: '--num-layers-per-virtual-pipeline-stage 1   # interleaved 1F1B → schedules.py:108' },
            { add: '--overlap-grad-reduce                        # DDP 异步 grad → enable_grad_sync' },
            { add: '--overlap-param-gather                       # 重叠 param all-gather' },
            { same: '--sequence-parallel' },
            { same: '--use-flash-attn' },
          ],
        },
      ],
    },
    // 3.3 — 关键环境变量未设置（缓存 / 显存分配器）
    3: {
      source: '性能问题定位分析/性能问题定位链路与改进建议.md §3 · msprof-analyze advisor（Environment Variable Issues）',
      caveat: 'env 缺失为真实落盘 profiler_metadata.ENV_VARIABLES 证据；启动脚本为 reconstructed_inputs_CONSTRUCTED（构造现场），行号/位置以真实启动脚本为准。',
      schemes: [
        {
          name: '推荐方案', recommended: true,
          rootCause: 'profiler_metadata.json 的 ENV_VARIABLES 中 ACLNN_CACHE_LIMIT / HOST_CACHE_CAPACITY / PYTORCH_NPU_ALLOC_CONF 均为空（advisor 命中 Environment Variable Issues）：aclnn/host 缓存偏小抬高算子下发开销，缺 expandable_segments 易致显存分配器碎片。',
          strategy: '在启动脚本环境变量段补上 advisor 推荐的三个 export（当前为注释/缺失态）。重训后 advisor 不再提示，cann_api_sum 中 host 侧下发/Tiling API 总耗时下降。',
          path: '性能问题定位分析/reconstructed_inputs_CONSTRUCTED/pretrain_qwen25_7b_32k_ptd.CONSTRUCTED.sh',
          lnStart: 9,
          rows: [
            { same: 'export CUDA_DEVICE_MAX_CONNECTIONS=1' },
            { same: 'export HCCL_CONNECT_TIMEOUT=1200' },
            { before: '#   export ACLNN_CACHE_LIMIT=100000', after: 'export ACLNN_CACHE_LIMIT=100000' },
            { before: '#   export HOST_CACHE_CAPACITY=20', after: 'export HOST_CACHE_CAPACITY=20' },
            { before: '#   export PYTORCH_NPU_ALLOC_CONF=expandable_segments:True', after: 'export PYTORCH_NPU_ALLOC_CONF=expandable_segments:True' },
            { same: '' },
            { same: 'GPUS_PER_NODE=8' },
          ],
        },
      ],
    },
    // 3.4 — 动态 Shape 触发算子在线编译
    4: {
      source: '性能问题定位分析/性能问题定位链路与改进建议.md §4 · msprof-analyze advisor（Operator Dynamic Shape Issues）',
      caveat: 'advisor 命中与改法为已知方案；真实落点（训练入口 pretrain_gpt.py 初始化处）需对真实训练入口确认，见报告「待源码确认清单」#6。',
      schemes: [
        {
          name: '推荐方案', recommended: true, conceptual: true,
          rootCause: 'lm_head 的 MatMulV2 行 OP State=dynamic（evidence/rank6.../kernel_details.csv）→ 动态 shape 落到具体算子、走在线编译路径，放大 host 编译/下发抖动；advisor 命中 Operator Dynamic Shape Issues。',
          strategy: '在训练入口初始化处（torch_npu 初始化，所有 rank）关闭 JIT 在线编译、禁用 internal_format 自动转换，固定为静态编译路径。重采后 advisor 不再提示、cann_api_sum 编译相关 API 耗时下降。',
          path: 'pretrain_gpt.py（训练入口初始化处，示意）',
          lnStart: 1,
          rows: [
            { same: 'import torch' },
            { same: 'import torch_npu' },
            { add: 'torch_npu.npu.set_compile_mode(jit_compile=False)' },
            { add: 'torch_npu.npu.config.allow_internal_format = False' },
            { same: '' },
            { same: 'from megatron.training import pretrain' },
          ],
        },
      ],
    },
  },
  // r20260715pangu：Pangu 2.0 flash 72B MoE（TP1·PP4·EP4·DP2）。报告目录未随附具体训练启动脚本，
  // 以下参数名均已对照本仓库 vendored 的 Megatron-LM core（_src/Megatron-LM）与 MindSpeed-LLM（_src/MindSpeed-LLM）
  // 源码验证真实存在（add_argument 定义可查），具体取值/行号为按 report.md 问题定位整理的示意配置，需按真实训练脚本核对。
  r20260715pangu: {
    // 3.1 — PP 末级 stage3 计算过载（lm_head+loss+深层 MoE 硬绑末级）
    1: {
      source: 'report.md §3.1 · cluster_time_summary/compute_op_sum + Megatron-LM core / MindSpeed-LLM 参数手册',
      caveat: 'Pangu 报告未随附具体训练启动脚本；以下 CLI 参数已对照 vendored 源码（megatron/training/arguments.py）核实真实存在，取值为按问题定位（末级多算 ~4.4s，约 2–3 层等效负载）估算的示意配置。',
      schemes: [
        {
          name: '方案 A', recommended: true,
          rootCause: 'lm_head（vocab=153600）+ loss/MTP 反向 GEMM + 深层 MoE（L36–47）硬绑在 post_process 末级（stage3），PP 默认按 48 层均匀切分（12 层/级）不预留配额，末级多算 ~4.41 s/step，制造 ~26% bubble。',
          strategy: '非均匀 PP 切分：末级少 2 层、首级多 2 层（14/12/12/10=48）抵消 lm_head+loss+MoE 尾部开销；同时把 num_microbatches 提高至两位数，压缩 1F1B 固有 bubble。',
          path: '训练启动脚本 PP 切分配置段（示意，报告未附具体启动脚本）/pretrain_pangu2.0flash_72b_moe_ptd.sh',
          lnStart: 1,
          rows: [
            { same: '--pipeline-model-parallel-size 4' },
            { same: '--expert-model-parallel-size 4' },
            { same: '--num-layers 48' },
            { add: '--decoder-first-pipeline-num-layers 14' },
            { add: '--decoder-last-pipeline-num-layers 10' },
            { same: '--sequence-parallel' },
            { del: '--num-microbatches 4' },
            { add: '--num-microbatches 12' },
          ],
        },
        {
          name: '方案 B', conceptual: true,
          rootCause: 'TP=1 时 vocab=153600 的 lm_head GEMM 与 loss/MTP 交叉熵全压末级两卡（rank24/28 等），是 stage3 过载的本质来源之一。',
          strategy: '治本：对输出投影做 vocab 并行 + vocab-parallel cross-entropy，把词表维 GEMM/CE 摊到多卡（需 TP>1，改动较大）。下方为 Megatron-LM core 真实源码位置的改法示意。',
          path: '_src/Megatron-LM/megatron/core/models/gpt/gpt_model.py',
          lnStart: 389,
          rows: [
            { same: 'if labels is None:' },
            { same: '    # [s b h] => [b s h]' },
            { same: '    return logits.transpose(0, 1).contiguous()' },
            { del: 'logits, _ = self.output_layer(hidden_states, weight=output_weight, runtime_gather_output=runtime_gather_output)' },
            { add: 'logits, _ = self.output_layer(hidden_states, weight=output_weight, runtime_gather_output=False)  # vocab 并行，不在末级 gather' },
            { del: 'loss = self.compute_language_model_loss(labels, logits)' },
            { add: 'loss = vocab_parallel_cross_entropy(logits, labels)  # 词表维并行 CE，均摊到 TP 组' },
            { same: 'return loss' },
          ],
        },
      ],
    },
    // 3.2 — EP all-to-all 通信入关键路径且零重叠
    2: {
      source: 'report.md §3.2 · hccl_sum(HcclPerRankStats) + MindSpeed-LLM moe_layer.py',
      caveat: '"moe-alltoall-overlap-comm" 依赖 "moe-grouped-gemm"（见 mindspeed_llm/core/transformer/moe/moe_layer.py 注释），组合是否兼容当前 EP4/DP2 切分需真实环境验证。',
      schemes: [
        {
          name: '推荐方案', recommended: true,
          rootCause: 'EP=4 下每层 MoE（44 层 ×2，fwd dispatch + bwd combine）执行 all-to-all，ClusterTimeSummary.communicationOverlapComputation 32 卡全为 0——dispatch/combine 完全串行，未与本地 expert FFN 计算重叠，累计 ~1.32 s/step。',
          strategy: '开 --moe-grouped-gemm（--moe-alltoall-overlap-comm 的前置依赖）+ --moe-alltoall-overlap-comm，让 dispatch all-to-all 发起后立即执行本地已到达 token 的 expert FFN；4 个 shared expert 另开 --moe-shared-expert-overlap，使其计算与 token 调度重叠。',
          path: '训练启动脚本 MoE 配置段（示意）',
          lnStart: 1,
          rows: [
            { same: '--num-experts 64' },
            { same: '--expert-model-parallel-size 4' },
            { same: '--moe-router-topk 8' },
            { add: '--moe-grouped-gemm' },
            { add: '--moe-alltoall-overlap-comm    # dispatch/combine 与本地 expert FFN 重叠' },
            { add: '--moe-shared-expert-overlap    # 4 个 shared expert 与 token 调度重叠' },
            { same: '--sequence-parallel' },
          ],
        },
      ],
    },
    // 3.3 — 计算-通信全局零重叠（DP allreduce + PP P2P）
    3: {
      source: 'report.md §3.3 · ClusterTimeSummary.communicationOverlapComputation + Megatron-LM core',
      caveat: '与 3.1 的非均匀 PP 切分（14/12/12/10）叠加后，per-stage 层数需能被 --num-layers-per-virtual-pipeline-stage 整除，需按实测微调（本例先取 1，即 interleaved 粒度最细）。',
      schemes: [
        {
          name: '推荐方案', recommended: true,
          rootCause: '① 无 virtual pipeline → 走无交错 1F1B，bubble 最大且无重叠窗口；② overlap_grad_reduce=False → DP 梯度 allreduce 串行落在反向之后暴露；③ PP P2P（RDMA，~37.7 MB/次）未用独立 stream。三者叠加致 communicationOverlapComputation 32 卡全为 0。',
          strategy: '开 interleaved 1F1B 压 bubble 并造重叠窗口，同时让 DDP 异步 grad、param all-gather 与计算重叠。',
          path: '训练启动脚本并行调度配置段（示意）',
          lnStart: 1,
          rows: [
            { same: '--pipeline-model-parallel-size 4' },
            { same: '--expert-model-parallel-size 4' },
            { same: '--use-distributed-optimizer' },
            { add: '--num-layers-per-virtual-pipeline-stage 1   # interleaved 1F1B' },
            { add: '--overlap-grad-reduce                        # DDP 异步 grad → enable_grad_sync' },
            { add: '--overlap-param-gather                       # 重叠 param all-gather' },
            { same: '--sequence-parallel' },
          ],
        },
      ],
    },
    // 3.4 — MoGE 路由负载不均（深层 expert 热点）
    4: {
      source: 'report.md §3.4 · compute_op_sum(ComputeOpPerRankStatsByOpType) + Megatron-LM core moe 路由参数',
      caveat: '系数/分组数为按偏斜程度（单 expert 占组内 ~65% token、耗时 CV≈0.8）估算的示意起点，需实测调参，非确证最优值。',
      schemes: [
        {
          name: '推荐方案', recommended: true,
          rootCause: '深层 MoE（L30–47）router gate score 分布明显偏斜（如 L36 group3 中 expert27 均值 0.87 vs 组内其余 0.15–0.35），单 expert 吃下该组 ~65% token，EP 组内其余 expert 算力空闲、all-to-all buffer 负载差 3–5×。',
          strategy: '提高 --moe-aux-loss-coeff 施加更强均衡约束；加 --moe-z-loss-coeff 抑制 gate logit 极端值；用 --moe-router-num-groups 细化分组降低单组 token 密度；--moe-expert-capacity-factor 对超限 token 限流/丢弃，防止单 expert 过载。',
          path: '训练启动脚本 MoE 路由配置段（示意）',
          lnStart: 1,
          rows: [
            { same: '--moe-router-topk 8' },
            { del: '--moe-aux-loss-coeff 0.01' },
            { add: '--moe-aux-loss-coeff 0.05' },
            { add: '--moe-z-loss-coeff 1e-4' },
            { del: '--moe-router-num-groups 8' },
            { add: '--moe-router-num-groups 16' },
            { add: '--moe-expert-capacity-factor 1.25' },
          ],
        },
      ],
    },
    // 3.5 — 关键环境变量未设置（缓存 / 显存分配器）
    5: {
      source: 'report.md §3.5 · profiler_metadata.ENV_VARIABLES + msprof-analyze advisor（Environment Variable Issues）',
      caveat: 'env 缺失为真实落盘 profiler_metadata.ENV_VARIABLES 证据；ACLNN_CACHE_LIMIT 取 200000（高于 0618 报告的 100000）是针对 MoE 场景 expert FFN 算子数量更多（44 层 ×192 个/层 ≈ 8448 个）的示意上调，需按实测缓存命中率复核。',
      schemes: [
        {
          name: '推荐方案', recommended: true,
          rootCause: 'profiler_metadata.json 的 ENV_VARIABLES 中 ACLNN_CACHE_LIMIT / HOST_CACHE_CAPACITY / PYTORCH_NPU_ALLOC_CONF 均为空；MoE 场景 expert FFN 算子数量远多于稠密模型，缓存偏小对下发开销的放大更明显。',
          strategy: '在启动脚本环境变量段补上三个 export，其中 ACLNN_CACHE_LIMIT 按 MoE 算子规模上调至 200000。',
          path: '训练启动脚本环境变量段（示意）',
          lnStart: 1,
          rows: [
            { same: 'export CUDA_DEVICE_MAX_CONNECTIONS=1' },
            { same: 'export HCCL_CONNECT_TIMEOUT=1200' },
            { add: 'export ACLNN_CACHE_LIMIT=200000' },
            { add: 'export HOST_CACHE_CAPACITY=20' },
            { add: 'export PYTORCH_NPU_ALLOC_CONF=expandable_segments:True' },
            { same: '' },
            { same: 'GPUS_PER_NODE=8' },
          ],
        },
      ],
    },
    // 3.6 — 动态 Shape 触发算子在线编译（MoE expert token 数动态变化）
    6: {
      source: 'report.md §3.6 · msprof-analyze advisor（Operator Dynamic Shape Issues）',
      caveat: 'advisor 命中与 jit_compile 改法为已知方案；token padding/grouping 的具体固定档位（64/128/256）为示意值，需按真实路由 token 分布统计确定。',
      schemes: [
        {
          name: '推荐方案', recommended: true, conceptual: true,
          rootCause: 'EP dispatch 后各 expert 收到的 token 数随路由动态变化，expert FFN 的 MatMul M 维度不固定 → 触发在线编译路径，放大 host 编译/下发抖动；advisor 命中 Operator Dynamic Shape Issues。',
          strategy: '训练入口初始化处关闭 JIT 在线编译、禁用 internal_format 自动转换；对 MoE expert 输入做 token padding/grouping，使 M 维度稳定在少数固定档位，减少编译变体。',
          path: 'pretrain_gpt.py（训练入口初始化处，示意）',
          lnStart: 1,
          rows: [
            { same: 'import torch' },
            { same: 'import torch_npu' },
            { add: 'torch_npu.npu.set_compile_mode(jit_compile=False)' },
            { add: 'torch_npu.npu.config.allow_internal_format = False' },
            { add: '# MoE expert 输入 token padding/grouping：M 维度固定到 {64,128,256} 之一，减少编译变体' },
            { same: '' },
            { same: 'from megatron.training import pretrain' },
          ],
        },
      ],
    },
  },
};

// Tab 切换 / 复制 / 操作按钮 / 轻提示
window.frTab = function (btn, idx) {
  const root = btn.closest('.ac-fr');
  if (!root) return;
  root.querySelectorAll('.ac-fr-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  root.querySelectorAll('.ac-fr-scheme').forEach((p, i) => p.classList.toggle('active', i === idx));
};
window.frDiffView = function (mode) {
  window._frDiffMode = mode;
  document.querySelectorAll('.ac-fr-diff2').forEach(d => d.setAttribute('data-mode', mode));
  document.querySelectorAll('.ac-fr-vt-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
};
window.frCopy = function (btn) {
  const text = decodeURIComponent(btn.dataset.copy || '');
  const done = () => { const o = btn.textContent; btn.textContent = '已复制'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = o; btn.classList.remove('copied'); }, 1400); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(done);
  else done();
};
window.frAction = function (kind) {
  frToast(kind === 'branch' ? '演示环境：将新建分支并提交修复（未接入代码仓库）' : '演示环境：将就地应用修复（未接入代码仓库）');
};
function frToast(msg) {
  let t = document.getElementById('frToast');
  if (!t) { t = document.createElement('div'); t.id = 'frToast'; t.className = 'fr-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

function fixReviewHtml(r, a) {
  const fr = FIX_REVIEW_DATA[r.id]?.[a.id];
  if (!fr || !fr.schemes?.length) return '';

  const tabsHtml = fr.schemes.map((s, i) =>
    `<button class="ac-fr-tab${i === 0 ? ' active' : ''}" onclick="frTab(this,${i})">`
    + `<span class="ac-fr-tab-name">${escHtml(s.name)}</span>`
    + (s.recommended ? `<span class="ac-fr-badge ac-fr-badge-rec">推荐</span>` : '')
    + (s.conceptual ? `<span class="ac-fr-badge ac-fr-badge-con">示意</span>` : '')
    + `</button>`
  ).join('');

  const mode = window._frDiffMode || 'split';
  const schemesHtml = fr.schemes.map((s, i) => {
    const copyLines = [];
    // 并排 diff：左右两列，自动行号
    let lnL = s.lnStart || 1, lnR = s.lnStart || 1;
    const splitHtml = (s.rows || []).map(row => {
      let kind, before = '', after = '';
      if (row.same !== undefined) { kind = 'same'; before = after = row.same; }
      else if (row.add !== undefined) { kind = 'add'; after = row.add; }
      else if (row.del !== undefined) { kind = 'del'; before = row.del; }
      else { kind = 'mod'; before = row.before || ''; after = row.after || ''; }
      const lL = (kind === 'add') ? '' : lnL++;
      const lR = (kind === 'del') ? '' : lnR++;
      if (kind !== 'del') copyLines.push(after);
      const lcls = (kind === 'del' || kind === 'mod') ? ' fr-cell-del' : '';
      const rcls = (kind === 'add' || kind === 'mod') ? ' fr-cell-add' : '';
      const sign = kind === 'add' ? '+' : kind === 'del' ? '-' : ' ';
      return `<tr>`
        + `<td class="fr-ln">${lL}</td>`
        + `<td class="fr-code${lcls}">${before !== '' || kind === 'del' || kind === 'mod' ? escHtml(before) : ''}</td>`
        + `<td class="fr-ln">${lR}</td>`
        + `<td class="fr-code${rcls}"><span class="fr-sign">${sign}</span>${escHtml(after)}</td>`
        + `</tr>`;
    }).join('');
    // 统一 diff：单列，增删上下交错
    let ulnL = s.lnStart || 1, ulnR = s.lnStart || 1;
    const uRow = (oldNo, newNo, sign, code, cls) =>
      `<tr class="fru-${cls}"><td class="fr-ln">${oldNo}</td><td class="fr-ln">${newNo}</td>`
      + `<td class="fr-code fru-code"><span class="fr-sign">${sign}</span>${escHtml(code)}</td></tr>`;
    const unifiedHtml = (s.rows || []).flatMap(row => {
      if (row.same !== undefined) return [uRow(ulnL++, ulnR++, ' ', row.same, 'same')];
      if (row.add !== undefined) return [uRow('', ulnR++, '+', row.add, 'add')];
      if (row.del !== undefined) return [uRow(ulnL++, '', '-', row.del, 'del')];
      return [uRow(ulnL++, '', '-', row.before || '', 'del'), uRow('', ulnR++, '+', row.after || '', 'add')];
    }).join('');

    const copyAttr = encodeURIComponent(copyLines.join('\n'));
    const segs = (s.path || '').split('/').filter(Boolean);
    const crumb = segs.map((seg, k) =>
      k === segs.length - 1 ? `<b>${escHtml(seg)}</b>` : escHtml(seg)).join('<span class="fr-sep">/</span>');

    return `
      <div class="ac-fr-scheme${i === 0 ? ' active' : ''}">
        <div class="ac-fr-rows">
          <div class="ac-fr-row"><span class="ac-fr-rl">根因定位</span><span class="ac-fr-rt">${escHtml(s.rootCause || '')}</span></div>
          <div class="ac-fr-row"><span class="ac-fr-rl">修改策略</span><span class="ac-fr-rt">${escHtml(s.strategy || '')}</span></div>
        </div>
        <div class="ac-fr-path">${crumb}</div>
        <div class="ac-fr-diff2" data-mode="${mode}">
          <div class="ac-fr-diff2-bar">
            <div class="ac-fr-vtoggle">
              <button class="ac-fr-vt-btn${mode === 'split' ? ' active' : ''}" data-mode="split" onclick="frDiffView('split')">Split</button>
              <button class="ac-fr-vt-btn${mode === 'unified' ? ' active' : ''}" data-mode="unified" onclick="frDiffView('unified')">Inline</button>
            </div>
            <button class="ac-fr-copy" data-copy="${copyAttr}" onclick="frCopy(this)">复制</button>
          </div>
          <div class="ac-fr-diff2-scroll">
            <table class="ac-fr-diff2-tbl fr-tbl-split"><tbody>${splitHtml}</tbody></table>
            <table class="ac-fr-diff2-tbl fr-tbl-unified"><tbody>${unifiedHtml}</tbody></table>
          </div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="ac-section-title ac-fr-title">智能修复预览</div>
    <div class="ac-fr">
      <div class="ac-fr-tabs">${tabsHtml}</div>
      ${schemesHtml}
      ${fr.caveat ? `<div class="ac-fr-caveat">⚠️ ${escHtml(fr.caveat)}</div>` : ''}
      <div class="ac-fr-actions">
        <button class="ac-fr-btn ac-fr-btn-primary" onclick="frAction('branch')">新建分支并提交</button>
        <button class="ac-fr-btn ac-fr-btn-ghost" onclick="frAction('edit')">修改到本分支</button>
      </div>
    </div>
  `;
}

// 证据文本里常见 `code`/**bold** 行内 markdown（如 `aten::copy_`、**AI Core MAC 占比**），
// 之前直接 escHtml 会把反引号/星号原样吐出来，读起来就是没解析的裸代码。用行内 markdown
// 渲染撑住这些 span，而不是整段走 marked.parse（那样会包一层 <p>，破坏表格排版）。
function mdInline(text) {
  if (!text) return '';
  if (typeof marked?.parseInline === 'function') {
    try { return marked.parseInline(text); } catch (e) { /* 回退到纯转义 */ }
  }
  return escHtml(text);
}

// 证据文本按「；」拆分句，每句再按「来源：细节」拆两列。只有真的拆出「来源」标签、
// 或本来就有多句可分行时才值得排成表格——单句又拆不出来源的话，表格只会是一整行
// 占两列，视觉上跟一段文字没区别，等于假表格；这种情况直接按段落排版，不硬套表格骨架。
function evidenceTableHtml(text) {
  if (!text) return '';
  // 报告解析出来的证据常是完整 markdown 块：含表格（| … |）、多级 -/1. 列表、`code`。
  // 这类内容必须整块交给 marked 渲染（与「报告原文」页签一致），否则下面按「；」拆句的
  // 启发式会把表格/列表的 | 与 - 原样吐成源码。只有不含这些块级结构的单段散文，才走
  // 「来源／细节」两列拆表。
  const hasMdBlock = /(^|\n)\s*\|.+\|/.test(text)              // markdown 表格行
                  || /(^|\n)\s*(?:[-*]|\d+\.)\s+\S/.test(text); // 无序/有序列表项
  if (hasMdBlock && typeof marked?.parse === 'function') {
    return `<div class="id-evidence-md ac-md">${marked.parse(text)}</div>`;
  }
  const clauses = text.split(/；/).map(s => s.trim()).filter(Boolean);
  if (!clauses.length) return '';
  const fileRe = /^([\w.\-]+\.(?:csv|json|db|log|md|py|txt|bin))(\s*\([^)]*\))?/;
  const parsed = clauses.map(clause => {
    const colonIdx = clause.search(/[：:]/);
    const fileMatch = clause.match(fileRe);
    let src = '', detail = clause;
    if (fileMatch && (colonIdx === -1 || colonIdx > fileMatch[0].length + 6)) {
      src = fileMatch[0].trim();
      detail = clause.slice(fileMatch[0].length).replace(/^[：:]\s*/, '').trim();
    } else if (colonIdx > -1 && colonIdx < 40) {
      src = clause.slice(0, colonIdx).trim();
      detail = clause.slice(colonIdx + 1).trim();
    }
    return { src, detail };
  });
  const worthTable = parsed.some(p => p.src) || parsed.length > 1;
  if (!worthTable) return `<div class="id-evidence-prose">${mdInline(text)}</div>`;
  const rows = parsed.map(({ src, detail }) => src
    ? `<tr><td class="iet-src"><span class="iet-src-pill">${escHtml(src)}</span></td><td class="iet-detail">${mdInline(detail)}</td></tr>`
    : `<tr><td class="iet-detail" colspan="2">${mdInline(detail)}</td></tr>`
  ).join('');
  return `<table class="id-evidence-table"><thead><tr><th>来源</th><th>细节</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderIssueDetail(r, a) {
  const detailEl = $('issueDetail');
  if (!detailEl) return;
  const issue = r.issues.find(i => +i.id.split('.')[1] === a.id);
  const pc = { P0: '#FF4B7B', P1: '#FF8C42', P2: '#666666' }[a.priority] || '#666666';
  let slEntry = SWIMLANE_DATA[r.id]?.[a.id];
  if (!slEntry) {
    const faEntry = window.FREE_ANALYSIS_DATA?.[r.id]?.[a.id];
    if (faEntry && a.visualization?.includes('Timeline')) slEntry = buildFreeAnalysisSwimlane(faEntry);
  }
  const opEntry = OP_VIEW_DATA[r.id]?.[a.id];
  const commEntry = COMM_VIEW_DATA[r.id]?.[a.id];
  const srcEntry = SOURCE_VIEW_DATA[r.id]?.[a.id];
  // 规则：算子视图优先用报告 evidence/ 内的 kernel_details.csv 运行时聚合（无 curated 数据时）
  const vizAll = `${issue?.visualization || ''} ${a.visualization || ''}`;
  const opCsvUrl = (!opEntry && vizAll.includes('算子视图'))
    ? evidenceUrlFromViz(r, vizAll, 'csv') : null;
  const slLanes = slEntry ? slEntry.data.length : 0;
  const slH = slLanes <= 1 ? 70 : slLanes === 2 ? 120 : slLanes === 3 ? 160 : slLanes === 4 ? 220 : 260;

  detailEl.innerHTML = `
    <div class="id-header">
      <span class="ac-priority" style="background:${pc}20;color:${pc};margin-top:2px" data-tooltip="${escHtml(prioTip(a.priority))}">${a.priority}</span>
      <span class="id-title">${escHtml(a.problem)}</span>
      ${a.benefitNum ? `<span class="ac-benefit" data-tooltip="预期单步总耗时减少：${a.benefit}">-${a.benefitNum}%</span>` : ''}
      <span class="ac-diff diff-${a.difficulty}" data-tooltip="${escHtml(diffTip(a.difficulty))}">${escHtml(a.difficulty)}</span>
    </div>
    ${issue ? `
    <div class="id-impact" style="--ic:${pc}">
      <span class="id-impact-icon">!</span>
      <div>
        <div class="id-impact-label">影响</div>
        <div class="id-impact-text ac-md">${marked.parse(issue.impact || '')}</div>
      </div>
    </div>
    <div class="id-panel id-fix">
      <div class="id-panel-head"><span class="id-panel-dot"></span>修复建议</div>
      <div class="ac-md">${marked.parse(issue.stepsRaw || issue.steps.map((s,i)=>`${i+1}. ${s}`).join('\n') || '')}</div>
    </div>
    ${fixReviewHtml(r, a)}
    ${issue.verification ? `
    <div class="id-verify">
      <span class="id-verify-icon">✓</span>
      <div class="id-verify-body"><span class="id-verify-label">验证标准</span><div class="id-verify-text ac-md">${marked.parse(issue.verification)}</div></div>
    </div>
    ` : ''}
    <div class="ac-section-group-title">问题信息</div>
    <div class="id-panel id-evidence">
      <div class="id-panel-head"><span class="id-panel-dot ev"></span>证据</div>
      ${evidenceTableHtml(issue.evidence)}
      ${issue.visualization ? `<div class="id-evidence-viz"><b>举证视图：</b>${marked.parse(issue.visualization).replace(/<\/?p>/g,'')}</div>` : ''}
    </div>
    ` : ''}
    ${slEntry ? `
    <div class="ac-section-title ac-sl-title">Timeline 局部 · 来自 ${escHtml(slEntry.source)}</div>
    <div class="ac-swimlane-wrap">
      <div class="ac-sl-vp" data-rid="${r.id}" data-aid="${a.id}" style="overflow:auto;position:relative;width:100%;height:${slH}px">
        <div style="display:flex;position:relative">
          <div class="ac-sl-label" style="position:sticky;left:0;flex-shrink:0;z-index:10"></div>
          <div class="ac-sl-canvas" style="flex:1;min-width:0"></div>
        </div>
      </div>
    </div>
    ` : a.visualization?.includes('Timeline') ? `
    <div class="ac-section-title ac-sl-title">Timeline 视图</div>
    <div class="ac-viz-placeholder">
      <span class="ac-vp-icon">▤</span>
      <div>
        <div class="ac-vp-label">Timeline 数据未随报告附带</div>
        <div class="ac-vp-hint">需要 trace_view.json 或 visualize_data.bin</div>
      </div>
    </div>
    ` : ''}
    ${(opEntry || opCsvUrl) ? `
    <div class="ac-section-title ac-viz-title">算子视图 · 来自 ${escHtml(opEntry ? opEntry.source : opCsvUrl.replace(/^.*?(evidence\/.*)$/, '$1'))}</div>
    ${opEntry && opEntry.chartType === 'table'
      ? `<div class="ac-op-wrap ac-op-table" data-rid="${r.id}" data-aid="${a.id}"></div>`
      : `<div class="ac-op-wrap" data-rid="${r.id}" data-aid="${a.id}"${opCsvUrl ? ` data-csv="${escHtml(opCsvUrl)}"` : ''} style="display:flex;height:164px;gap:4px"><div id="op-chart-type-${r.id}-${a.id}" style="flex:1;min-width:0"></div><div id="op-chart-core-${r.id}-${a.id}" style="flex:1;min-width:0"></div></div>`}
    ` : vizAll.includes('算子视图') ? `
    <div class="ac-section-title ac-viz-title">算子视图</div>
    <div class="ac-viz-placeholder">
      <span class="ac-vp-icon">◔</span>
      <div>
        <div class="ac-vp-label">算子统计数据未随报告附带</div>
        <div class="ac-vp-hint">需要 kernel_details.csv 或 op_statistic.csv</div>
      </div>
    </div>
    ` : ''}
    ${commEntry ? `
    <div class="ac-section-title ac-viz-title">通信视图 · 来自 ${escHtml(commEntry.source)}</div>
    <div class="ac-comm-wrap" data-rid="${r.id}" data-aid="${a.id}"></div>
    ` : a.visualization?.includes('通信视图') ? `
    <div class="ac-section-title ac-viz-title">通信视图</div>
    <div class="ac-viz-placeholder">
      <span class="ac-vp-icon">📡</span>
      <div>
        <div class="ac-vp-label">通信带宽数据未随报告附带</div>
        <div class="ac-vp-hint">需要 cluster_analysis.db · ClusterCommunicationBandwidth 表</div>
      </div>
    </div>
    ` : ''}
    ${srcEntry ? `
    <div class="ac-section-title ac-viz-title">源码视图 · 来自 ${escHtml(srcEntry.source)}</div>
    <div class="ac-src-wrap" data-rid="${r.id}" data-aid="${a.id}"></div>
    ` : a.visualization?.includes('源码视图') ? `
    <div class="ac-section-title ac-viz-title">源码视图</div>
    <div class="ac-viz-placeholder">
      <span class="ac-vp-icon">⌥</span>
      <div>
        <div class="ac-vp-label">源码数据未随报告附带</div>
        <div class="ac-vp-hint">需要 visualize_data.bin（simulator 模式）含调试符号</div>
      </div>
    </div>
    ` : ''}
  `;

  const vp = detailEl.querySelector('.ac-sl-vp');
  if (vp && !vp._slRenderer) {
    if (slEntry) vp._slData = slEntry; // 动态生成的数据挂到 DOM，供 initAcSwimlane 读取
    requestAnimationFrame(() => initAcSwimlane(vp));
  }
  const opWrap = detailEl.querySelector('.ac-op-wrap');
  if (opWrap && !opWrap._inited) initAcOpView(opWrap);
  const commWrap = detailEl.querySelector('.ac-comm-wrap');
  if (commWrap && !commWrap._inited) initAcCommView(commWrap);
  const srcWrap = detailEl.querySelector('.ac-src-wrap');
  if (srcWrap && !srcWrap._inited) renderSourceView(srcWrap);
}

function initAcSwimlane(vp) {
  const rid = vp.dataset.rid;
  const aid = +vp.dataset.aid;
  const slEntry = vp._slData || SWIMLANE_DATA[rid]?.[aid];
  if (!slEntry || typeof SwimlaneRenderer === 'undefined') return;

  const inner = vp.children[0];
  const labelEl = inner.querySelector('.ac-sl-label');
  const canvasEl = inner.querySelector('.ac-sl-canvas');

  try {
    const parsed = parseTraceJSON(slEntry.data);
    const renderer = new SwimlaneRenderer(canvasEl, labelEl);
    vp._slRenderer = renderer;
    // 点击泳道小方块 → 按算子签名定位到对应框架源码片段（见 OP_CODE_MAP）
    renderer.onEventClick = (ev) => renderOpCodePanel(vp, ev);
    // double RAF: first frame requests layout, second gets correct dimensions
    requestAnimationFrame(() => {
      renderer.loadData(parsed, null);
      if (slEntry.annotations?.length) renderer.setAnnotations(slEntry.annotations);
      requestAnimationFrame(() => {
        renderer.fitToView(); renderer.onResize();
        // 默认横向定位到被标注的问题方块，并直接展示其源码（无需点击）
        if (rid === 'r20260618pp' || rid === 'r20260715pangu') {
          requestAnimationFrame(() => focusSwimlaneProblem(vp, renderer, slEntry));
        }
      });
    });
  } catch (e) {
    console.warn('swimlane init failed', e);
  }
}

// ─── 泳道方块 → 源码定位 ───────────────────────────────────────────
// 数据来源：性能问题定位分析/源码级定位_3.1与3.2_示例.md（推理）+ _src 真实代码片段。
// 粒度为「算子签名级」：按方块 taskName/label 关键词匹配，命中即给出对应框架源码 +
// 机制说明 + 改法。⚠️ 行号以 Megatron core_v0.12.1 完整仓为准（已与 _src/Megatron-LM clone 校对），
// 真实落盘 CANN 8.3.RC1 对应版本可能有偏差；「实际未开这些开关」依赖构造数据
// （reconstructed_inputs_CONSTRUCTED），需真实启动脚本兜底。
// 路径指向 _src/Megatron-LM 完整仓的真实文件（megatron/core/...）。
const OP_CODE_BASE = '性能问题定位分析/_src/Megatron-LM/megatron/core/';
const OP_CODE_MAP = [
  {
    // 3.1 末级独有：lm_head/logits 投影（MatMulV2）与 loss 向量算子
    match: /MatMulV2|lm_head|logits|output_layer|loss\b|dgrad/i,
    op: 'lm_head / logits 投影（MatMulV2）+ loss',
    repo: 'Megatron-LM core_v0.12.1 · gpt_model.py',
    file: 'gpt_model.py', path: OP_CODE_BASE + 'models/gpt/gpt_model.py', focus: 389,
    ranges: [[179, 200], [379, 411]], hot: [180, 197, 199, 389, 390, 409],
    lines: [
      { ln: 180, code: '    if self.post_process or self.mtp_process:   # 仅最后一个 PP stage 才建/跑' },
      { ln: 197, code: '        self.output_layer = tensor_parallel.ColumnParallelLinear(' },
      { ln: 198, code: '            config.hidden_size,            # 3584' },
      { ln: 199, code: '            self.vocab_size,               # ×152064 → 即 MatMulV2 大 GEMM' },
      { ln: 379, code: '    if not self.post_process:' },
      { ln: 380, code: '        return hidden_states           # 非末级到此返回，不跑 lm_head' },
      { ln: 389, code: '    logits, _ = self.output_layer(', hot: true },
      { ln: 390, code: '        hidden_states, weight=output_weight, ...)  # lm_head MatMulV2 每 microbatch 一次 → ×64', hot: true },
      { ln: 409, code: '    loss = self.compute_language_model_loss(labels, logits)  # loss 向量算子，也只在末级', hot: true },
    ],
    why: 'lm_head（output_layer）与 loss 硬绑定在 post_process（=最后一个 PP stage），前向 389 行每 microbatch 调一次 → 与实测 MatMulV2 仅在 rank6/7 出现 ×64 完全吻合。这是末级多算 ~3.1s 的直接来源。',
    fix: '非均匀 PP 切分（--decoder-last-pipeline-num-layers 6）让末级少 1 层抵消 lm_head 开销；或对输出投影做 vocab 并行 + vocab-parallel cross-entropy 把 152064 维 GEMM/CE 拆到多卡。',
  },
  {
    // 3.1 bubble 源头：PP 均匀切，不为 lm_head/loss 预留配额
    match: /Bubble|空等|Wait\b/i,
    op: 'PP-Bubble（其余级在 P2P recv 上空等末级）',
    repo: 'Megatron-LM core_v0.12.1 · transformer_block.py · get_num_layers_to_build',
    file: 'transformer_block.py', path: OP_CODE_BASE + 'transformer/transformer_block.py', focus: 117,
    ranges: [[104, 118], [155, 158]], hot: [105, 107, 111, 112, 117, 156, 157],
    lines: [
      { ln: 105, code: '    else:   # 未启用非均匀切分时走这里（本例）' },
      { ln: 107, code: '        num_layers = config.num_layers                 # 28' },
      { ln: 111, code: '        if config.account_for_loss_in_pipeline_split:  # 默认 False → loss 不计入切分' },
      { ln: 112, code: '            num_layers += 1' },
      { ln: 117, code: '        num_layers_per_pipeline_rank = num_layers // config.pipeline_model_parallel_size  # 28//4 = 7', hot: true },
    ],
    why: '4 个 stage 各均匀切 7 层，但末级在 7 层之外还白扛 lm_head+loss → 多算 ~3.1s，其余 6 卡每步在 P2P recv 上空等 ~3.77s（占 step ~35%），即此 bubble。',
    fix: '--decoder-first-pipeline-num-layers 8 / --decoder-last-pipeline-num-layers 6（8/7/7/6=28，末级少 1 层）；或 --account-for-loss-in-pipeline-split（需层数能被 PP 整除）。',
  },
  {
    // 3.2 DP 梯度未与反向重叠（Overlapped=0）
    match: /allReduce|reduceScatter|allGather|DP|Collective|Overlapped/i,
    op: 'DP 梯度 allreduce（Overlapped=0 全暴露）',
    repo: 'Megatron-LM core_v0.12.1 · schedules.py',
    file: 'schedules.py', path: OP_CODE_BASE + 'pipeline_parallel/schedules.py', focus: 742,
    ranges: [[740, 759]], hot: [742, 744, 751, 758],
    lines: [
      { ln: 742, code: '    config.grad_sync_func, config.param_sync_func = None, None  # overlap_grad_reduce=False → None', hot: true },
      { ln: 744, code: '    def disable_grad_sync():     # 关闭异步 grad 同步' },
      { ln: 751, code: '    def enable_grad_sync():      # 仅当 config.grad_sync_func 非 None 才有重叠' },
      { ln: 758, code: '    disable_grad_sync()          # 默认禁用 → grad allreduce 串行落在反向后，全暴露', hot: true },
    ],
    why: 'overlap_grad_reduce=False → grad_sync_func=None，DP allreduce 串行落在反向计算之后无法隐藏；叠加 vp=None 走无交错 1F1B（schedules.py:110）没有可重叠窗口，故 communicationOverlapComputation=0。',
    fix: '--overlap-grad-reduce（DDP 异步 grad → enable_grad_sync 生效）+ --num-layers-per-virtual-pipeline-stage 1（开 interleaved 1F1B，造重叠窗口）+ --overlap-param-gather。',
  },
  {
    // PP P2P 收发：调度选择无交错 1F1B
    match: /batchSendRecv|P2P|激活值|发送|接收/i,
    op: 'PP P2P 收发（无交错 1F1B 调度）',
    repo: 'Megatron-LM core_v0.12.1 · schedules.py · get_forward_backward_func',
    file: 'schedules.py', path: OP_CODE_BASE + 'pipeline_parallel/schedules.py', focus: 110,
    ranges: [[104, 111]], hot: [106, 108, 110],
    lines: [
      { ln: 106, code: '    if pipeline_model_parallel_size > 1:' },
      { ln: 107, code: '        if parallel_state.get_virtual_pipeline_model_parallel_world_size() is not None:' },
      { ln: 108, code: '            forward_backward_func = forward_backward_pipelining_with_interleaving   # interleaved' },
      { ln: 109, code: '        else:' },
      { ln: 110, code: '            forward_backward_func = forward_backward_pipelining_without_interleaving  # ← 本例（vp=None）纯 1F1B', hot: true },
    ],
    why: 'virtual_pipeline_model_parallel_size=None → 命中 110 行的无交错 1F1B：bubble 最大、且 P2P 与计算无重叠窗口。',
    fix: '--num-layers-per-virtual-pipeline-stage 1 开 interleaved 1F1B（走 108 行路径），压 bubble 并制造可重叠窗口（约束：PP>2、每 stage 层数须可整除）。',
  },
  {
    // 3.3 环境变量未设（非框架源码，定位到启动脚本 env 段）
    match: /Tiling|launch|缓存|aclnn|ACLNN|HOST_CACHE/i,
    op: '算子下发间隙（缓存类环境变量未设）',
    repo: '训练启动脚本 env 段（非框架源码）', kind: 'config',
    file: 'pretrain_*.sh', path: null, focus: null,
    lines: [
      { ln: '', code: 'export ACLNN_CACHE_LIMIT=100000', hot: true },
      { ln: '', code: 'export HOST_CACHE_CAPACITY=20', hot: true },
      { ln: '', code: 'export PYTORCH_NPU_ALLOC_CONF=expandable_segments:True', hot: true },
    ],
    why: 'aclnn/host 缓存偏小会增加算子下发开销、出现 *_Tiling/launch 间隙；expandable_segments 缺失易致显存分配器碎片。根因在启动脚本环境变量，非某段源码 bug。',
    fix: '在训练启动脚本 env 段加上上述三个 export 后重训，复采对比 cann_api_sum 中 host 侧下发/Tiling API 总耗时下降。',
  },
];

function matchOpCode(ev) {
  if (!ev) return null;
  const text = `${ev.name || ''} ${ev.label || ev.args?.color || ''}`;
  return OP_CODE_MAP.find(r => r.match.test(text)) || null;
}

// 在泳道下方渲染/更新「方块 → 源码」面板；ev 为 null（取消选中）时收起
function renderOpCodePanel(vp, ev) {
  const wrap = vp.closest('.ac-swimlane-wrap');
  if (!wrap) return;
  let panel = wrap.nextElementSibling;
  if (!panel || !panel.classList.contains('ac-opcode-panel')) {
    panel = document.createElement('div');
    panel.className = 'ac-opcode-panel';
    wrap.parentNode.insertBefore(panel, wrap.nextSibling);
  }

  if (!ev) { panel.innerHTML = ''; panel.classList.remove('open'); return; }

  const rule = matchOpCode(ev);
  if (!rule) {
    const tag = (ev.label || ev.args?.color || '') + ' ' + (ev.name || '');
    const isFree = /Free|空闲|Bubble|Wait|等待/i.test(tag);
    const kind = isFree ? '空闲 / 等待段' : '常规 Transformer 层计算段';
    const reason = isFree
      ? '此段为 device 空闲/等待，本身不对应任何算子，故无源码可指——它是其它问题块（如末级过载）的<b>后果</b>，根因请看被标注的问题方块。'
      : '此段为常规前向/反向计算，<b>非本报告标注的瓶颈块</b>，未建立特定源码映射。';
    panel.classList.add('open');
    panel.innerHTML = `
      <div class="ac-oc-empty-title">该方块（${escHtml(ev.label || ev.name || '—')}）为${kind}，未建立特定源码映射</div>
      <div class="ac-oc-empty-reason">${reason}</div>
      <div class="ac-oc-empty-reason ac-oc-empty-why"><b>为何指不到源码行</b>：①Timeline 小方块是 <b>device 侧 kernel</b>，落盘数据本身<b>不含源码文件/行号</b>（要带行号需 simulator 模式的 <code>visualize_data.bin</code> + 调试符号）；②当前映射是按<b>算子签名</b>的启发式匹配，常规计算/空闲段没有像 <code>MatMulV2/lm_head/hcom_*</code> 那样的判别性签名；③框架源码已备齐（<code>_src/MindSpeed-LLM</code>、<code>_src/MindSpeed</code>、<code>_src/Megatron-LM</code> 完整仓），仍缺<b>真实训练启动脚本</b>确认实际 args/开关（当前仅有构造版 <code>reconstructed_inputs_CONSTRUCTED/...CONSTRUCTED.sh</code>，详见 性能问题定位分析/三者关系说明.md §6.3）。补齐后即可扩展映射。</div>`;
    return;
  }

  // 先用已校对的内联片段即时渲染（瞬时、且在无法 fetch 时兜底）
  const rows = ocRowsFromLines(rule.lines);

  const fileLabel = rule.path && rule.focus
    ? `<a class="ac-oc-file" href="javascript:void(0)" data-codepath="${escHtml(rule.path)}" data-focus="${rule.focus}" title="在「代码」页签中打开此文件" onclick="openCodeFileFromSwimlane(this.dataset.codepath, +this.dataset.focus);return false;">${escHtml(rule.file)}:${rule.focus}</a>`
    : `<span class="ac-oc-file">${escHtml(rule.file)}</span>`;
  const srcMode = rule.ranges ? '已校对片段' : (rule.kind === 'config' ? '配置示例' : '内联片段');

  panel.classList.add('open');
  panel.innerHTML = `
    <div class="ac-oc-head">
      <span class="ac-oc-tag">源码定位</span>
      <span class="ac-oc-op">${escHtml(rule.op)}</span>
      <span class="ac-oc-arrow">→</span>
      ${fileLabel}
      <span class="ac-oc-srcmode" title="片段来源：内联=代码内置；完整仓实读=运行时从 _src 真实文件读取">${srcMode}</span>
      <span class="ac-oc-repo">${escHtml(rule.repo)}</span>
    </div>
    <table class="ac-oc-table"><tbody>${rows}</tbody></table>
    <div class="ac-oc-note"><b>机制</b>：${escHtml(rule.why)}</div>
    <div class="ac-oc-note ac-oc-fix"><b>改法</b>：${escHtml(rule.fix)}</div>
    <div class="ac-oc-caveat">⚠️ 行号以 Megatron core_v0.12.1 为准（真实落盘版本可能有偏差）；"实际未开这些开关"依赖构造数据，需真实启动脚本/训练日志确认。</div>
  `;

  // 升级：从 _src 完整仓真实文件读取对应行（与「代码」页签同源），失败则保留内联片段
  if (rule.path && rule.ranges) {
    const token = (panel._ocToken = (panel._ocToken || 0) + 1);
    fetch(rule.path)
      .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(text => {
        if (token !== panel._ocToken) return;   // 已切到别的方块
        const tbody = panel.querySelector('.ac-oc-table tbody');
        if (tbody) tbody.innerHTML = ocRowsFromText(text, rule.ranges, new Set(rule.hot || []));
        const sm = panel.querySelector('.ac-oc-srcmode');
        if (sm) { sm.textContent = '完整仓实读'; sm.classList.add('ac-oc-srcmode-live'); }
      })
      .catch(() => { /* 离线/file:// 等：保留内联片段 */ });
  }
}

// 内联片段 → 表格行
function ocRowsFromLines(lines) {
  return lines.map(l =>
    `<tr${l.hot ? ' class="ac-oc-row-hot"' : ''}>`
    + `<td class="ac-oc-ln">${l.ln}</td>`
    + `<td class="ac-oc-code">${escHtml(l.code)}</td>`
    + `</tr>`
  ).join('');
}

// 真实文件文本 + 行区间 → 表格行（多个区间之间插入 ⋯ 分隔）
function ocRowsFromText(text, ranges, hotSet) {
  const all = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  ranges.forEach((rg, ri) => {
    if (ri > 0) out.push('<tr class="ac-oc-gap"><td class="ac-oc-ln">⋯</td><td class="ac-oc-code"></td></tr>');
    for (let n = rg[0]; n <= rg[1] && n <= all.length; n++) {
      const hot = hotSet.has(n);
      out.push(`<tr${hot ? ' class="ac-oc-row-hot"' : ''}>`
        + `<td class="ac-oc-ln">${n}</td>`
        + `<td class="ac-oc-code">${escHtml(all[n - 1] || ' ')}</td>`
        + `</tr>`);
    }
  });
  return out.join('');
}

// 默认定位：找到被标注（annotations type:'task'）的问题方块，选中高亮 + 横向滚动居中 +
// 直接展示其源码面板，无需用户点击/查找。
function focusSwimlaneProblem(vp, renderer, slEntry) {
  const parsed = renderer.parsedData;
  if (!parsed) return;
  const anns = slEntry.annotations || [];
  const taskAnn = anns.find(a => a.type === 'task');

  // 1) 按 task 标注找到问题事件
  let ev = null;
  if (taskAnn) {
    for (const events of parsed.coreEvents.values()) {
      ev = events.find(e =>
        (taskAnn.tid === undefined || e.tid === taskAnn.tid) &&
        (taskAnn.taskId === undefined || e.taskId === taskAnn.taskId));
      if (ev) break;
    }
  }

  // 2) 选中高亮（等同点击效果）+ 默认渲染源码面板
  if (ev) {
    renderer.selectedEvent = ev;
    renderer.relatedEvents = renderer._getRelatedEvents ? renderer._getRelatedEvents(ev) : [];
    renderOpCodePanel(vp, ev);
  }

  // 3) 计算聚焦区间（优先问题块，其次 range/point 标注）
  const tr = parsed.timeRange;
  const rangeAnn = anns.find(a => a.type === 'range' || a.type === 'point');
  let focusStart, focusDur;
  if (ev) { focusStart = ev.ts - tr.start; focusDur = ev.dur || 0; }
  else if (rangeAnn?.type === 'range') { focusStart = rangeAnn.startTime; focusDur = rangeAnn.endTime - rangeAnn.startTime; }
  else if (rangeAnn?.type === 'point') { focusStart = rangeAnn.time; focusDur = 0; }
  else return;

  // 4) 横向放大并滚动到问题块居中（让问题段约占视口一半；放大倍数限制在 fit~10×）
  const viewportW = vp.clientWidth || 800;
  const fitScale = viewportW / Math.max(1, tr.duration);
  const span = focusDur || tr.duration * 0.1;
  let scale = (viewportW * 0.5) / Math.max(1, span);
  scale = Math.max(fitScale, Math.min(scale, fitScale * 10));
  renderer.xScale = scale;
  renderer.onResize();
  const centerX = (focusStart + focusDur / 2) * scale;
  vp.scrollLeft = Math.max(0, centerX - viewportW / 2);
}

async function initAcOpView(wrap) {
  wrap._inited = true;
  const rid = wrap.dataset.rid;
  const aid = +wrap.dataset.aid;
  let entry = OP_VIEW_DATA[rid]?.[aid];
  // 无 curated 数据时，从报告 evidence/ 内的 kernel_details.csv 运行时聚合
  if (!entry && wrap.dataset.csv) {
    try {
      const res = await fetch(wrap.dataset.csv);
      if (res.ok) {
        entry = aggregateOpView(await res.text(), wrap.dataset.csv.replace(/^.*?(evidence\/.*)$/, '$1'));
        if (entry) (OP_VIEW_DATA[rid] = OP_VIEW_DATA[rid] || {})[aid] = entry;
      }
    } catch (e) { console.warn('op-view evidence load failed:', wrap.dataset.csv, e); }
  }
  if (!entry) return;
  if (entry.chartType === 'table') {
    renderOpTable(wrap, entry);
  } else {
    renderOpPieCharts(wrap, entry, rid, aid);
  }
}

// 从问题"举证视图"文字里提取 evidence/ 相对路径，按报告所在文件夹拼成可 fetch 的 URL
function evidenceUrlFromViz(report, vizText, ext) {
  const m = (vizText || '').match(new RegExp('evidence/[\\w./-]+\\.' + ext));
  if (!m || !report.filename) return null;
  const base = report.filename.replace(/\/[^/]*$/, ''); // 去掉结尾的 /report.md
  return base + '/' + m[0];
}

// 极简 CSV 解析：处理引号包裹的逗号（如 Input Shapes "4096,1,151936"）
function parseCSVRows(text) {
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// kernel_details.csv → 算子视图条目：按 Type / Accelerator Core 聚合总耗时（剔除通信算子）
function aggregateOpView(csvText, source) {
  const rows = parseCSVRows(csvText);
  if (rows.length < 2) return null;
  const h = rows[0];
  const iType = h.indexOf('Type'), iCore = h.indexOf('Accelerator Core'), iDur = h.indexOf('Duration(us)');
  if (iType < 0 || iDur < 0) return null;
  const byT = {}, byC = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (row.length <= iDur) continue;
    const t = row[iType], c = iCore >= 0 ? row[iCore] : '';
    if (!t || /^hcom_/.test(t) || c === 'COMMUNICATION') continue; // 通信算子不计入算子视图
    const d = parseFloat(row[iDur]) || 0;
    byT[t] = (byT[t] || 0) + d;
    if (c) byC[c] = (byC[c] || 0) + d;
  }
  const byType = Object.entries(byT).sort((a, b) => b[1] - a[1]).slice(0, 11).map(([name, value]) => ({ name, value: Math.round(value) }));
  const byCore = Object.entries(byC).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value: Math.round(value) }));
  if (!byType.length) return null;
  return { source, byType, byCore };
}

// 将 FREE_ANALYSIS_DATA 条目动态转换为 swimlane 数据格式
// 规则：visualization 含"Timeline"时统一走 SwimlaneRenderer，不用表格
function buildFreeAnalysisSwimlane(faEntry) {
  function classify(reason) {
    if (reason.includes('MEMCPY')) return 'memcpy';
    if (reason.includes('Abnormal CANN')) return 'cann';
    if (reason.includes('Idle Pytorch')) return 'pytorch';
    if (reason.includes('EVENT')) return 'event';
    return 'other';
  }
  const SEMANTIC = {
    memcpy:  'P2P-Send',      // 橙色 — MEMCPY_ASYNC 等待
    event:   'DP-Collective', // 绿色 — EVENT_RECORD/WAIT
    cann:    'PP-Bubble',     // 红粉 — Abnormal CANN
    pytorch: 'Bwd-Compute',   // 紫色 — Idle PyTorch layer
    other:   'Free',          // 深灰
  };
  const GAP = 3000; // 3 ms 计算间隔（μs）

  let globalId = 1;
  const annotations = [];
  const data = faEntry.ranks.map((rank, blockIdx) => {
    const rows   = faEntry.data[rank];
    const pct    = faEntry.freePct[rank];
    const freeMs = faEntry.freeTotal[rank];
    const tasks  = [];
    let t = 0;

    tasks.push({ taskId: globalId++, subGraphId: 0, execStart: t, execEnd: t + GAP, semanticLabel: 'Fwd-Compute', taskName: '正常计算下发 (3ms)' });
    t += GAP;

    const top = rows.slice(0, 3);
    top.forEach((row, i) => {
      const dur   = Math.round(row.dur_ms * 1000);
      const sem   = SEMANTIC[classify(row.reason)];
      const short = row.reason.length > 55 ? row.reason.slice(0, 52) + '…' : row.reason;
      const id    = globalId++;
      tasks.push({ taskId: id, subGraphId: 0, execStart: t, execEnd: t + dur, semanticLabel: sem, taskName: `空闲 ${row.dur_ms.toFixed(1)}ms · ${short}` });
      if (i === 0) annotations.push({ type: 'task', tid: blockIdx, taskId: id });
      t += dur;
      if (i < top.length - 1) {
        tasks.push({ taskId: globalId++, subGraphId: 0, execStart: t, execEnd: t + GAP, semanticLabel: 'Fwd-Compute', taskName: '计算恢复 (3ms)' });
        t += GAP;
      }
    });

    tasks.push({ taskId: globalId++, subGraphId: 0, execStart: t, execEnd: t + GAP, semanticLabel: 'Fwd-Compute', taskName: '计算恢复 (3ms)' });

    return { blockIdx, coreType: `Rank ${rank} · free ${pct}% (${freeMs}ms/step)`, tasks };
  });

  return { source: faEntry.source, data, annotations };
}

function renderOpPieCharts(wrap, entry, rid, aid) {
  const PALETTE = ['#3A7BFF','#FF8C42','#2EC4B6','#9B59B6','#F1C40F','#1ABC9C','#FF6B6B','#16A085','#8E44AD','#2980B9'];
  const makeOpt = (title, data) => ({
    backgroundColor: 'transparent',
    title: { text: title, textStyle: { color: '#94a3b8', fontSize: 10, fontWeight: 'normal' }, top: 4, left: 'center' },
    tooltip: { trigger: 'item', formatter: p => `${p.name}: ${p.value.toLocaleString()} μs (${p.percent}%)` },
    series: [{
      type: 'pie', radius: ['28%', '58%'],
      center: ['50%', '58%'],
      data: data.map((d, i) => ({ name: d.name, value: d.value, itemStyle: { color: d.color || PALETTE[i % PALETTE.length] } })),
      label: { color: '#64748b', fontSize: 9, formatter: p => p.percent > 5 ? `${p.name}\n${p.percent}%` : '' },
      labelLine: { length: 5, length2: 5 },
      emphasis: { label: { show: true, fontSize: 10, fontWeight: 'bold', color: '#e2e8f0' } },
    }],
  });
  const coreData = entry.byCore.map(d => ({
    name: d.name, value: d.value,
    color: d.name === 'AI_CPU' ? '#FF4B7B' : d.name === 'MIX_AIC' ? '#FF8C42' : d.name === 'AI_CORE' ? '#3A7BFF' : undefined,
  }));
  const tc = echarts.init(document.getElementById(`op-chart-type-${rid}-${aid}`));
  const cc = echarts.init(document.getElementById(`op-chart-core-${rid}-${aid}`));
  tc.setOption(makeOpt('按算子类型分组总耗时（μs）', entry.byType));
  cc.setOption(makeOpt('按加速核分组总耗时（μs）', coreData));
  _opCharts.push(tc, cc);
}

function renderOpTable(wrap, entry) {
  const coreClass = ac => 'op-core-' + ac.toLowerCase().replace(/_/g, '-');

  // Group rows by (type, acceleratorCore) — matches MindStudio Insight parent-row structure
  const groups = new Map();
  for (const row of entry.rows) {
    const key = row.type + '|||' + row.acceleratorCore;
    if (!groups.has(key)) groups.set(key, { type: row.type, acceleratorCore: row.acceleratorCore, rows: [] });
    groups.get(key).rows.push(row);
  }

  const rid = wrap.dataset.rid;
  const aid = wrap.dataset.aid;

  const parentRows = [...groups.values()].map((g, gi) => {
    const total = g.rows.reduce((s, r) => s + r.duration, 0);
    const avg   = total / g.rows.length;
    const max   = Math.max(...g.rows.map(r => r.duration));
    const min   = Math.min(...g.rows.map(r => r.duration));
    const gid   = 'op-grp-' + rid + '-' + aid + '-' + gi;
    const hasHighlight = g.rows.some(r => r.highlight);

    const childRows = g.rows.map(row => `
      <tr${row.highlight ? ' class="op-row-highlight"' : ''}>
        <td class="op-ct-name" title="${escHtml(row.name)}">${row.highlight ? '<span class="op-warn-icon">▲</span>' : ''}${escHtml(row.name)}</td>
        <td>${escHtml(row.type)}</td>
        <td><span class="op-core-badge ${coreClass(row.acceleratorCore)}">${escHtml(row.acceleratorCore)}</span></td>
        <td class="num">${row.duration.toFixed(3)}</td>
        <td class="num">${row.waitTime.toFixed(3)}</td>
        <td class="num">${row.blockDim}</td>
        <td class="op-ct-shapes" title="${escHtml(row.inputShapes)}">${escHtml(row.inputShapes)}</td>
      </tr>`).join('');

    return `
      <tr class="op-pt-row${hasHighlight ? ' op-row-problem' : ''}" onclick="var c=document.getElementById('${gid}');c.hidden=!c.hidden;this.querySelector('.op-expand-icon').textContent=c.hidden?'▶':'▼'">
        <td><span class="op-expand-icon">${hasHighlight ? '▼' : '▶'}</span>${hasHighlight ? '<span class="op-warn-icon">▲</span>' : ''}${escHtml(g.type)}</td>
        <td><span class="op-core-badge ${coreClass(g.acceleratorCore)}">${escHtml(g.acceleratorCore)}</span></td>
        <td class="num">${g.rows.length}</td>
        <td class="num">${total.toFixed(1)}</td>
        <td class="num">${avg.toFixed(3)}</td>
        <td class="num">${max.toFixed(3)}</td>
        <td class="num">${min.toFixed(3)}</td>
      </tr>
      <tr id="${gid}"${hasHighlight ? '' : ' hidden'}>
        <td colspan="7" style="padding:0 0 2px 0">
          <table class="op-child-table">
            <thead><tr>
              <th>Name</th><th>Type</th><th>Acc Core</th>
              <th>Duration(μs)</th><th>Wait(μs)</th><th>Block Dim</th><th>Input Shapes</th>
            </tr></thead>
            <tbody>${childRows}</tbody>
          </table>
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="op-table-scroll">
      <table class="op-parent-table">
        <thead><tr>
          <th>Type</th><th>Accelerator Core</th><th>Count</th>
          <th>Total Time(μs)</th><th>Avg Time(μs)</th><th>Max Time(μs)</th><th>Min Time(μs)</th>
        </tr></thead>
        <tbody>${parentRows}</tbody>
      </table>
    </div>`;
}

const SWIMLANE_DATA = window.SWIMLANE_DATA || {};


const OP_VIEW_DATA = window.OP_VIEW_DATA || {};
const COMM_VIEW_DATA = window.COMM_VIEW_DATA || {};

// ============================================================
// 源码视图（Source View）接入手册
// ============================================================
//
// 【何时需要接入】
//   报告的某条 action 的 visualization 字段包含"源码视图"时，
//   说明该问题需要以源码 + 关联指令的双栏视图来举证热点位置。
//   典型场景：
//     · SCALAR 栈帧 CACHEMISS —— PC 热图定位到具体 .cpp 行
//     · 高 cycle 函数体 —— 逐行 cycle 占比标注
//     · 内联失败导致的函数调用开销 —— 反汇编定位
//
// 【数据来源识别】
//   1. simulator bin（visualize_data.bin）：
//      per_core_event.csv 的 PC 列 → 反汇编得到 cpp 行号
//      pipe_instr_top.csv 的 cycle% → 逐行 cycle 占比
//   2. 非 simulator 场景（Level2 DB）：
//      尚未有 source map 输出；改用"详情视图 Roofline"替代
//
// 【如何接入新报告】
//   Step 1 — 补充 issue 详情
//     在对应 REPORTS[n].issues 数组中添加 { id: '3.N', ... } 条目，
//     字段对齐其他 issue：evidence / impact / steps / verification /
//     visualization（含"源码视图"关键词）/ codeLocations
//
//   Step 2 — 填写 SOURCE_VIEW_DATA
//     在下方 SOURCE_VIEW_DATA 对象中按 reportId → actionId 两级索引添加：
//     {
//       source:      '数据来源描述（显示在视图标题行）',
//       file:        '源文件名（如 my_kernel.cpp）',
//       contextNote: '简短上下文说明（显示在文件名旁）',
//       lines: [
//         // 每行对象：
//         { ln: <行号>, cycles: '<占比字符串或null>', hot: <true|false>,
//           code: '<HTML转义后的源码文本>', cachemiss: <次数或undefined> }
//         // hot:true → 红色高亮；cachemiss → 显示 "MISS ×N" 角标
//       ],
//       instrs: [
//         // 每条热点指令：
//         { pc: '<0xADDR>', ln: <源码行号>, type: '<SCALAR|VECTOR|…>',
//           instr: '<汇编文本>', cachemiss: <次数> }
//       ],
//     }
//     注意：code 字段中的 HTML 特殊字符必须手动转义（< → &lt; 等），
//     因为该字符串直接写入 innerHTML。
//
//   Step 3 — 无需改动渲染逻辑
//     renderIssueDetail 会自动检测 SOURCE_VIEW_DATA[r.id]?.[a.id]：
//       · 有数据 → 渲染真实源码双栏面板（调用 renderSourceView）
//       · 无数据但 visualization 含"源码视图" → 显示占位符提示
//     renderSourceView 本身不需修改，通过数据驱动即可。
//
//   Step 4 — CSS 已通用，无需新增
//     所有样式在 styles.css ── Source View 区块中集中定义，
//     覆盖行高亮、CACHEMISS 角标、指令表、双栏布局等，无需重复添加。
//
// 【示例参考】
//   reportId = 'r20260527', actionId = 6
//   问题：CACHEMISS 累计 326 次，集中在 scalar 栈 PC 段
//   定位：matmul_leakyrelu_custom.cpp:206-207（LeakyReluCustom 函数头栈帧）
//   来源：per_core_event.csv PC 热图 + nm 反汇编
// ============================================================

// ── 源码视图静态数据 (由 visualize_data.bin per_core_event.csv PC热图提取) ──
const SOURCE_VIEW_DATA = {
  r20260527: {
    // P2#6 CACHEMISS — matmul_leakyrelu_custom.cpp LeakyReluCustom 函数栈帧热点
    6: {
      source: 'visualize_data.bin (per_core_event.csv · cubecore0 SCALAR PC热图)',
      file: 'matmul_leakyrelu_custom.cpp',
      contextNote: 'LeakyReluCustom 函数体 · 326 CACHEMISS',
      lines: [
        { ln: 200, cycles: null,  code: '// LeakyRelu vec kernel — 由 SCALAR PC 热图定位至此' },
        { ln: 201, cycles: null,  code: 'template &lt;typename aT, typename bT, typename cT&gt;' },
        { ln: 202, cycles: null,  code: '__aicore__ inline void MatmulLeakyReluCustom&lt;aT,bT,cT&gt;::LeakyReluCustom(' },
        { ln: 203, cycles: null,  code: '    LocalTensor&lt;cT&gt;&amp; dst, LocalTensor&lt;cT&gt;&amp; src, float alpha)' },
        { ln: 204, cycles: null,  code: '{' },
        { ln: 205, cycles: '6%',  hot: false, code: '    uint32_t len = this-&gt;tileLength;' },
        { ln: 206, cycles: '46%', hot: true,  code: '    uint32_t off = this-&gt;blockIdx * len;', cachemiss: 118 },
        { ln: 207, cycles: '38%', hot: true,  code: '    LocalTensor&lt;cT&gt; buf = outQueue_.DeQue&lt;cT&gt;();', cachemiss: 97 },
        { ln: 208, cycles: '5%',  hot: false, code: '    Muls(buf, src, (cT)alpha, len);' },
        { ln: 209, cycles: '3%',  hot: false, code: '    Maxs(dst, buf, (cT)0, len);' },
        { ln: 210, cycles: '2%',  hot: false, code: '    outQueue_.EnQue(buf);' },
        { ln: 211, cycles: null,  hot: false, code: '    outQueue_.FreeTensor(buf);' },
        { ln: 212, cycles: null,  hot: false, code: '}' },
      ],
      instrs: [
        { pc: '0x0800', ln: 206, type: 'SCALAR', instr: 'LD  X0,  [SP, #0x18]',        cachemiss: 118 },
        { pc: '0x0804', ln: 206, type: 'SCALAR', instr: 'STI X1,  [SP, #0x08]',         cachemiss: 58  },
        { pc: '0x0820', ln: 207, type: 'SCALAR', instr: 'STP X29, X30, [SP, #-0x20]',   cachemiss: 97  },
        { pc: '0x0824', ln: 207, type: 'SCALAR', instr: 'STI X2,  [SP, #0x10]',         cachemiss: 53  },
      ],
    },
  },
};

function renderSourceView(wrap) {
  wrap._inited = true;
  const rid = wrap.dataset.rid;
  const aid = +wrap.dataset.aid;
  const entry = SOURCE_VIEW_DATA[rid]?.[aid];
  if (!entry) return;

  const totalMiss = entry.instrs.reduce((s, i) => s + i.cachemiss, 0);

  const sourceRows = entry.lines.map(l => {
    const hot = l.hot;
    const rowCls = hot ? ' class="ac-src-row-hot"' : '';
    const lnCls  = hot ? ' ac-src-ln-hot' : '';
    const cyCls  = hot ? ' ac-src-cy-hot' : '';
    const badge  = l.cachemiss
      ? ` <span class="ac-src-cm-badge">MISS ×${l.cachemiss}</span>`
      : '';
    return `<tr${rowCls}>`
      + `<td class="ac-src-ln${lnCls}">${l.ln}</td>`
      + `<td class="ac-src-cy${cyCls}">${l.cycles || ''}</td>`
      + `<td class="ac-src-code-cell">${l.code}${badge}</td>`
      + `</tr>`;
  }).join('');

  const instrRows = entry.instrs.map(i =>
    `<tr class="ac-src-row-hot">`
    + `<td class="ac-instr-pc">${i.pc}</td>`
    + `<td class="ac-instr-ln">:${i.ln}</td>`
    + `<td><span class="ac-instr-type-badge">${i.type}</span></td>`
    + `<td class="ac-instr-code">${i.instr}</td>`
    + `<td class="ac-instr-miss">×${i.cachemiss}</td>`
    + `</tr>`
  ).join('');

  wrap.innerHTML = `
    <div class="ac-src-container">
      <div class="ac-src-file-bar">
        <span class="ac-src-filename">${escHtml(entry.file)}</span>
        <span class="ac-src-ctx-note">${escHtml(entry.contextNote)}</span>
      </div>
      <div class="ac-src-body">
        <div class="ac-src-left">
          <table class="ac-src-table">
            <thead>
              <tr>
                <th class="ac-src-th-ln">行数</th>
                <th class="ac-src-th-cy">cycles</th>
                <th class="ac-src-th-code">源码</th>
              </tr>
            </thead>
            <tbody>${sourceRows}</tbody>
          </table>
        </div>
        <div class="ac-src-right">
          <div class="ac-src-instr-hdr">
            热点 SCALAR 指令
            <span class="ac-src-instr-total">总计 ${totalMiss} CACHEMISS</span>
          </div>
          <table class="ac-src-instr-table">
            <thead>
              <tr>
                <th>PC</th>
                <th>行</th>
                <th>类型</th>
                <th>指令</th>
                <th>CACHEMISS</th>
              </tr>
            </thead>
            <tbody>${instrRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function initAcCommView(wrap) {
  wrap._inited = true;
  const rid = wrap.dataset.rid;
  const aid = +wrap.dataset.aid;
  const entry = COMM_VIEW_DATA[rid]?.[aid];
  if (!entry) return;
  const ct = entry.chartType || 'bw-table';
  if (ct === 'bw-table') renderCommTable(wrap, entry);
  else if (ct === 'p2p-timing') renderCommP2PTable(wrap, entry);
  else if (ct === 'rdma-summary') renderCommRdma(wrap, entry);
  else if (ct === 'comm-matrix') renderCommMatrix(wrap, entry);
}

// ───────────────────────────────────────────────────────────────────────────
// 通信视图：在表格之上叠加「按问题语义选型」的可视化图（见 CHART-STRATEGY.md §2）
//   bw-table     → ② rank×类型 带宽达成率热力图
//   p2p-timing   → ① Transit/Wait 等待瀑布（通信是否进入关键路径）
//   rdma-summary → ④ 小包占比环 + 带宽达成率条
//   comm-matrix  → ②/④ 链路带宽达成率条（vs 理论线）
// 图只标问题局部、就地标注；下方原表格保留不动。
// ───────────────────────────────────────────────────────────────────────────
function cvEffBg(eff)    { return eff < 0.43 ? 'rgba(255,75,123,0.32)' : eff < 0.53 ? 'rgba(255,170,59,0.22)' : eff < 0.63 ? 'rgba(4,215,147,0.16)' : 'rgba(67,105,239,0.22)'; }
function cvEffColor(eff) { return eff < 0.43 ? '#FF4B7B' : eff < 0.53 ? '#FFAA3B' : eff < 0.63 ? '#04D793' : '#5A92E6'; }
function cvChartBlock(title, sub, inner) {
  return `<div class="cv-chart"><div class="cv-chart-title">${title}<span class="cv-chart-sub">${sub}</span></div>${inner}</div>`;
}

// ② rank × 通信类型 带宽达成率热力图（达成率 = 实测 ÷ 理论）
function cvHeatChart(entry) {
  const THEORY = entry.theoryBw || 30;
  const problemCols = new Set(entry.problemCols || []);
  const cats = [
    { key: 'ag_avg', col: 'ag', label: 'AllGather' },
    { key: 'rs_avg', col: 'rs', label: 'ReduceScatter' },
    { key: 'ar_avg', col: 'ar', label: 'AllReduce' },
    { key: 'bc_avg', col: 'bc', label: 'Broadcast' },
  ];
  let head = '<div class="cv-heat-row"><div class="cv-heat-rk"></div>';
  for (const c of cats) {
    const prob = problemCols.has(c.col);
    head += `<div class="cv-heat-h${prob ? ' cv-heat-h-prob' : ''}">${c.label}${prob ? ' ⚑' : ''}</div>`;
  }
  head += '</div>';
  let body = '', lastNode = null;
  for (const d of entry.rows) {
    if (d.node !== lastNode) { body += `<div class="cv-heat-sep">${d.node}</div>`; lastNode = d.node; }
    let cells = `<div class="cv-heat-rk">R${d.rank}</div>`;
    for (const c of cats) {
      const v = d[c.key] ?? 0, eff = v / THEORY;
      cells += `<div class="cv-heat-c" style="background:${cvEffBg(eff)};color:${cvEffColor(eff)}" title="${c.label} ${v.toFixed(2)} GB/s · 达成率 ${(eff*100).toFixed(0)}%">${(eff*100).toFixed(0)}</div>`;
    }
    body += `<div class="cv-heat-row">${cells}</div>`;
  }
  return cvChartBlock('② 带宽达成率热力图',
    `行=Rank · 列=通信类型 · 数字/配色=达成率%（实测 ÷ 理论 ${THEORY} GB/s）· ⚑=问题类别`,
    `<div class="cv-heat">${head}${body}</div>`);
}

// ① P2P 通信 Transit / Wait 等待瀑布
function cvWaterfallChart(entry) {
  let max = 0;
  for (const s of entry.stages) for (const op of s.ops) max = Math.max(max, op.transit_ms + op.wait_ms);
  max = max || 1;
  let body = '';
  for (const s of entry.stages) {
    body += `<div class="cv-wf-sep">${s.stageLabel}（Rank ${s.ranks}）</div>`;
    for (const op of s.ops) {
      const tW = Math.max(1.5, op.transit_ms / max * 100);
      const wW = op.wait_ms / max * 100;
      const isProb = op.waitPct > 90;
      body += `<div class="cv-wf-row">
        <div class="cv-wf-label" title="${op.opName}">${op.direction}</div>
        <div class="cv-wf-track">
          <div class="cv-wf-transit" style="width:${tW.toFixed(2)}%" title="Transit ${op.transit_ms.toFixed(2)} ms"></div>
          <div class="cv-wf-wait${isProb ? ' cv-wf-wait-prob' : ''}" style="width:${wW.toFixed(2)}%" title="Wait ${op.wait_ms.toFixed(1)} ms (${op.waitPct.toFixed(1)}%)"></div>
          ${op.wait_ms > 0 ? `<span class="cv-wf-val">空等 ${op.wait_ms.toFixed(0)} ms · ${op.waitPct.toFixed(0)}%</span>` : '<span class="cv-wf-val cv-wf-ok">即时完成</span>'}
        </div>
      </div>`;
    }
  }
  return cvChartBlock('① 通信等待瀑布（是否进入关键路径）',
    '每条=一次 P2P 通信 · 绿=Transit 实传 · 红=Wait 空等；红条越长=通信在关键路径上空等越久',
    `<div class="cv-wf">${body}</div>`);
}

// ④ RDMA 小包占比环 + 带宽达成率条
function cvRdmaChart(entry) {
  const sp = entry.smallPktPct || 0;
  const op = entry.ops && entry.ops[0];
  const theory = entry.theoryBw || 200;
  const bw = op ? op.bandwidth_GBps : 0;
  const eff = bw / theory * 100;
  const waitPct = op ? op.waitPct : 0;
  const ring = `<div class="cv-ring" style="background:conic-gradient(#FF4B7B ${sp}%, var(--surface-3) ${sp}% 100%)">
      <div class="cv-ring-hole"><span class="cv-ring-val">${sp.toFixed(0)}%</span><span class="cv-ring-cap">小包<br>&lt;1MB</span></div>
    </div>`;
  const bars = `<div class="cv-rdma-bars">
      <div class="cv-mbar">
        <div class="cv-mbar-top"><span class="cv-mbar-k">带宽达成率</span><span class="cv-mbar-v">${eff < 1 ? eff.toFixed(3) : eff.toFixed(0)}% · ${bw.toFixed(4)} / ${theory} GB/s</span></div>
        <div class="cv-mbar-tr"><div class="cv-mbar-f cv-bad" style="width:${Math.max(0.5, eff).toFixed(2)}%"></div></div>
      </div>
      <div class="cv-mbar">
        <div class="cv-mbar-top"><span class="cv-mbar-k">Wait 占比</span><span class="cv-mbar-v">${waitPct.toFixed(2)}%</span></div>
        <div class="cv-mbar-tr"><div class="cv-mbar-f cv-bad" style="width:${Math.min(100, waitPct).toFixed(2)}%"></div></div>
      </div>
    </div>`;
  return cvChartBlock('④ 小包占比 / 带宽达成率',
    '左环=小包(&lt;1MB)占比 · 右=实测带宽达成率与 Wait 占比；小包越多→带宽越打不满、Wait 越高',
    `<div class="cv-rdma">${ring}${bars}</div>`);
}

// ②/④ 链路带宽达成率条（单源 rank 视角，TP/DP 着色）
function cvLinkBarChart(entry) {
  const theory = entry.theoryBw || 30;
  let body = '';
  for (const l of entry.links) {
    const eff = l.bandwidth_GBps / theory * 100;
    const grp = l.group === 'TP' ? 'cv-node-1' : 'cv-node-2';
    body += `<div class="cv-lb-row">
      <div class="cv-lb-label">R${entry.srcRank}→R${l.peer} <span class="cv-node-tag ${grp}">${l.group}</span></div>
      <div class="cv-lb-track">
        <div class="cv-lb-fill" style="width:${Math.min(100, eff).toFixed(1)}%;background:${cvEffBg(eff/100)};border-color:${cvEffColor(eff/100)}"></div>
        <span class="cv-lb-val" title="${l.note || ''}">${l.bandwidth_GBps.toFixed(2)} GB/s · ${eff.toFixed(0)}%</span>
      </div>
    </div>`;
  }
  return cvChartBlock('②/④ 链路带宽达成率',
    `Rank ${entry.srcRank} → 各 peer 有效带宽 vs 理论 ${theory} GB/s（HCCS）· 满格=理论峰值`,
    `<div class="cv-lb">${body}</div>`);
}

function renderCommTable(wrap, entry) {
  const THEORY = entry.theoryBw || 30;
  const problemCols = new Set(entry.problemCols || []);

  function bwBg(v) {
    if (v < 1)  return 'rgba(255,75,123,0.32)';
    if (v < 13) return 'rgba(255,75,123,0.18)';
    if (v < 16) return 'rgba(255,170,59,0.18)';
    if (v < 19) return 'rgba(4,215,147,0.12)';
    return 'rgba(67,105,239,0.18)';
  }
  function bwColor(v) {
    if (v < 1)  return '#FF4B7B';
    if (v < 13) return '#FF4B7B';
    if (v < 16) return '#FFAA3B';
    if (v < 19) return '#04D793';
    return '#5A92E6';
  }
  function bwCell(v, isProbCol) {
    const bg = bwBg(v); const color = bwColor(v);
    const eff = ((v / THEORY) * 100).toFixed(0);
    const ann = v < 1 ? '<span class="cv-small-pkt">小包</span>' : '';
    const colBg = isProbCol ? 'background:rgba(255,75,123,0.04);' : '';
    return `<td style="${colBg}"><span class="cv-bw-cell" style="background:${bg};color:${color}" title="效率 ${eff}%  vs 理论 ${THEORY} GB/s">${v.toFixed(v < 1 ? 4 : 2)}${ann}</span></td>`;
  }

  const nodeRanges = entry.nodeRanges !== undefined ? entry.nodeRanges : { node1: 'Rank 0–7', node2: 'Rank 8–15' };
  const nodeNames = [...new Set(entry.rows.map(r => r.node))];
  const nodeColorMap = Object.fromEntries(nodeNames.map((n, i) => [n, (i % 2) + 1]));
  const probThreshold = entry.probRowThreshold ?? 12.0;

  let rows = '';
  let lastNode = null;
  for (const d of entry.rows) {
    if (d.node !== lastNode) {
      const rng = nodeRanges[d.node] || '';
      rows += `<tr class="cv-group-sep"><td colspan="9">${d.node}${rng ? `（${rng}）` : ''}</td></tr>`;
      lastNode = d.node;
    }
    const isProbRow = d.ar_avg < probThreshold;
    const nodeColorIdx = nodeColorMap[d.node] || 1;
    const nodeTag = `<span class="cv-node-tag cv-node-${nodeColorIdx}">R${d.rank}</span>`;
    rows += `<tr class="op-pt-row${isProbRow ? ' cv-row-problem' : ''}">
      <td class="${isProbRow ? 'cv-row-mark' : ''}">${nodeTag} Rank&nbsp;${d.rank}</td>
      <td>${d.node}</td>
      ${bwCell(d.ag_avg, false)}
      ${bwCell(d.ag_min, false)}
      ${bwCell(d.rs_avg, problemCols.has('rs'))}
      ${bwCell(d.rs_min, problemCols.has('rs'))}
      ${bwCell(d.ar_avg, problemCols.has('ar'))}
      ${bwCell(d.ar_min, problemCols.has('ar'))}
      ${bwCell(d.bc_avg, false)}
    </tr>`;
  }

  const n = entry.rows.length;
  const avg = k => entry.rows.reduce((s,d)=>s+d[k],0)/n;
  rows += `<tr class="op-pt-row cv-summary-row">
    <td colspan="2" style="font-weight:600;color:var(--fg-secondary)">${entry.summaryLabel || (n + ' 卡平均')}</td>
    ${bwCell(avg('ag_avg'), false)}<td style="color:var(--fg-muted);text-align:right">—</td>
    ${bwCell(avg('rs_avg'), problemCols.has('rs'))}<td style="color:var(--fg-muted);text-align:right">—</td>
    ${bwCell(avg('ar_avg'), problemCols.has('ar'))}<td style="color:var(--fg-muted);text-align:right">—</td>
    ${bwCell(avg('bc_avg'), false)}
  </tr>`;

  wrap.innerHTML = cvHeatChart(entry) + `
    <div class="cv-legend">
      <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(255,75,123,0.32)"></span>&lt;13 GB/s 问题</span>
      <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(255,170,59,0.18)"></span>13–16 GB/s 边缘</span>
      <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(4,215,147,0.12)"></span>16–19 GB/s 可接受</span>
      <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(67,105,239,0.18)"></span>≥19 GB/s 近峰值</span>
      <span class="cv-leg-item cv-leg-prob-col">⚑ 问题列（AR / RS）</span>
    </div>
    <div class="op-table-scroll" style="max-height:340px">
      <table class="op-parent-table cv-comm-table">
        <thead>
          <tr>
            <th style="text-align:left">Rank</th>
            <th style="text-align:left">节点</th>
            <th>AllGather avg</th>
            <th>AG min</th>
            <th class="cv-prob-th">ReduceScatter avg ⚑</th>
            <th class="cv-prob-th">RS min ⚑</th>
            <th class="cv-prob-th">AllReduce avg ⚑</th>
            <th class="cv-prob-th">AR min ⚑</th>
            <th>Broadcast avg</th>
          </tr>
          <tr class="cv-unit-row">
            <th colspan="2"></th>
            <th colspan="7" style="font-weight:400;color:var(--fg-muted);text-align:center;font-size:9px">
              单位 GB/s · 理论峰值 ${THEORY} GB/s · 悬停查看效率% · 红色左边框行为问题行
            </th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderCommP2PTable(wrap, entry) {
  let rows = '';
  for (const stage of entry.stages) {
    rows += `<tr class="cv-group-sep"><td colspan="5">${stage.stageLabel}（Rank ${stage.ranks}）</td></tr>`;
    for (const op of stage.ops) {
      const isProb = op.waitPct > 90;
      const isWarn = op.waitPct > 30;
      const wBg    = isProb ? 'rgba(255,75,123,0.32)' : isWarn ? 'rgba(255,170,59,0.18)' : 'rgba(4,215,147,0.12)';
      const wColor = isProb ? '#FF4B7B' : isWarn ? '#FFAA3B' : '#04D793';
      rows += `<tr class="${isProb ? 'cv-row-problem' : ''}">
        <td class="${isProb ? 'cv-row-mark' : ''}" style="font-size:11px">${op.direction}</td>
        <td style="font-family:var(--font-mono);font-size:9px;color:var(--fg-muted)">${op.opName}</td>
        <td style="text-align:right;font-size:11px">${op.transit_ms.toFixed(2)} ms</td>
        <td><span class="cv-bw-cell" style="background:${wBg};color:${wColor};font-size:10px">${op.wait_ms.toFixed(1)} ms (${op.waitPct.toFixed(1)}%)</span></td>
        <td style="font-size:10px;color:var(--fg-muted)">${op.note}</td>
      </tr>`;
    }
  }
  wrap.innerHTML = cvWaterfallChart(entry) + `
    <div class="cv-legend">
      <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(255,75,123,0.32)"></span>&gt;90% Wait — 极端等待</span>
      <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(255,170,59,0.18)"></span>30–90% Wait — 偏高</span>
      <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(4,215,147,0.12)"></span>≈0% Wait — 正常</span>
    </div>
    <div class="op-table-scroll">
      <table class="op-parent-table cv-comm-table">
        <thead>
          <tr>
            <th style="text-align:left">P2P 方向</th>
            <th style="text-align:left">通信算子</th>
            <th>Transit (ms)</th>
            <th>Wait (ms / %)</th>
            <th style="text-align:left">说明</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderCommRdma(wrap, entry) {
  let rows = '';
  for (const op of entry.ops) {
    const pkgMB  = op.packageSize_MB;
    const pkgStr = pkgMB < 0.001 ? `${(pkgMB * 1e6).toFixed(0)} B` : pkgMB < 1 ? `${(pkgMB * 1024).toFixed(0)} KB` : `${pkgMB.toFixed(2)} MB`;
    const bwEff  = ((op.bandwidth_GBps / (entry.theoryBw || 200)) * 100).toFixed(3);
    rows += `<tr class="cv-row-problem">
      <td class="cv-row-mark" style="font-family:var(--font-mono);font-size:10px">${op.name}</td>
      <td><span class="cv-node-tag cv-node-2">RDMA</span></td>
      <td><span class="cv-bw-cell" style="background:rgba(255,75,123,0.32);color:#FF4B7B">${pkgStr}<span class="cv-small-pkt">小包</span></span></td>
      <td><span class="cv-bw-cell" style="background:rgba(255,75,123,0.32);color:#FF4B7B" title="效率 ${bwEff}% vs 理论 ${entry.theoryBw||200} GB/s">${op.bandwidth_GBps.toFixed(4)} GB/s</span></td>
      <td style="text-align:right;font-size:11px">${op.elapsed_ms.toFixed(1)} ms</td>
      <td><span class="cv-bw-cell" style="background:rgba(4,215,147,0.12);color:#04D793">${op.transit_ms.toFixed(3)} ms</span></td>
      <td><span class="cv-bw-cell" style="background:rgba(255,75,123,0.32);color:#FF4B7B">${op.wait_ms.toFixed(1)} ms (${op.waitPct.toFixed(1)}%)</span></td>
    </tr>`;
  }
  wrap.innerHTML = cvRdmaChart(entry) + `
    <div class="cv-legend" style="flex-direction:column;align-items:flex-start;gap:4px">
      <span style="font-size:11px;font-weight:600;color:var(--warning)">RDMA 小包问题：${entry.smallPktPct}% 包 &lt; 1 MB · 实际传输耗时 ${entry.smallPktDur} ms · 理论带宽 ${entry.theoryBw||200} GB/s</span>
      <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(255,75,123,0.32)"></span>包极小 / 带宽极低 / Wait 占比极高</span>
    </div>
    <div class="op-table-scroll">
      <table class="op-parent-table cv-comm-table">
        <thead>
          <tr>
            <th style="text-align:left">通信算子</th>
            <th>链路类型</th>
            <th>包大小</th>
            <th>实测带宽</th>
            <th>总耗时</th>
            <th>Transit</th>
            <th>Wait (ms / %)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderCommMatrix(wrap, entry) {
  const THEORY = entry.theoryBw || 30;
  function cmBwBg(v)    { return v >= 13 ? 'rgba(67,105,239,0.18)' : v >= 10 ? 'rgba(4,215,147,0.12)' : v >= 5 ? 'rgba(255,170,59,0.18)' : 'rgba(255,75,123,0.18)'; }
  function cmBwColor(v) { return v >= 13 ? '#5A92E6' : v >= 10 ? '#04D793' : v >= 5 ? '#FFAA3B' : '#FF4B7B'; }

  const linkRows = entry.links.map(link => {
    const bw  = link.bandwidth_GBps;
    const eff = ((bw / THEORY) * 100).toFixed(0);
    const tag = link.group === 'TP'
      ? '<span class="cv-node-tag cv-node-1">TP</span>'
      : '<span class="cv-node-tag cv-node-2">DP</span>';
    return `<tr>
      <td>Rank ${entry.srcRank} → Rank ${link.peer}</td>
      <td>${tag}</td>
      <td><span class="cv-bw-cell" style="background:${cmBwBg(bw)};color:${cmBwColor(bw)}" title="效率 ${eff}% vs 理论 ${THEORY} GB/s">${bw.toFixed(2)} GB/s</span></td>
      <td style="text-align:right;font-size:11px">${link.bytes_GB != null ? link.bytes_GB.toFixed(2) + ' GB' : '—'}</td>
      <td style="font-size:10px;color:var(--fg-muted)">${link.note || ''}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = cvLinkBarChart(entry) + `
    <div class="cv-legend" style="flex-direction:column;align-items:flex-start;gap:5px">
      <span style="font-size:11px;font-weight:600;color:var(--warning)">${entry.commSummary || ''}</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(67,105,239,0.18)"></span>≥13 GB/s 近峰值</span>
        <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(4,215,147,0.12)"></span>10–13 GB/s 可接受</span>
        <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(255,170,59,0.18)"></span>5–10 GB/s 小包延迟受限</span>
        <span class="cv-leg-item"><span class="cv-leg-sw" style="background:rgba(255,75,123,0.18)"></span>&lt;5 GB/s 问题</span>
      </div>
    </div>
    <div class="op-table-scroll">
      <table class="op-parent-table cv-comm-table">
        <thead>
          <tr>
            <th style="text-align:left">链路（Rank ${entry.srcRank} 视角）</th>
            <th>通信组</th>
            <th>有效带宽</th>
            <th>总字节量</th>
            <th style="text-align:left">说明</th>
          </tr>
          <tr class="cv-unit-row">
            <th colspan="5" style="font-weight:400;color:var(--fg-muted);text-align:center;font-size:9px">
              单位 GB/s · 理论峰值 ${THEORY} GB/s（HCCS）· ${entry.commGroup || ''}
            </th>
          </tr>
        </thead>
        <tbody>${linkRows}</tbody>
      </table>
    </div>`;
}

// ============================================================
// Tab 3: 代码
// ============================================================
function renderCode(r) {
  const codePane = document.getElementById('tab-code');
  const emptyEl = $('codeEmptyState');
  const layoutEl = $('codeLayout');
  codePane.querySelector('.fabricated-banner')?.remove();

  // ── 源码级定位：左树右码浏览框架源码 ──
  if (r.codeTree) {
    if (emptyEl) emptyEl.style.display = 'none';
    if (layoutEl) layoutEl.style.display = 'flex';
    renderCodeTree(r, r.codeTree);
    return;
  }

  // ── 修改清单（改前/改后 diff）：有示例则展示 diff 视图，无则保留空态 ──
  if (!r.codeExamples || r.codeExamples.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    if (layoutEl) layoutEl.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (layoutEl) layoutEl.style.display = 'flex';
  if (r.codeExamplesFabricated) {
    const b = document.createElement('div');
    b.className = 'fabricated-banner';
    b.textContent = '⚠️ 改前/改后为示例片段，未与真实源码自动关联';
    codePane.prepend(b);
  }
  const locEl = $('codeLocations');
  const viewEl = $('codeViewer');

  locEl.innerHTML = `
    <div class="code-loc-title">修改清单 <span class="code-count">${r.codeExamples.length} 处</span></div>
    ${r.codeExamples.map((ex, i) => `
      <div class="code-loc-item ${i === 0 ? 'active' : ''}" data-idx="${i}" onclick="showCodeExample(${i})">
        <div class="cli-priority" style="background:${{ P0:'#FF4B7B', P1:'#FF8C42', P2:'#666666' }[r.actions.find(a=>a.id===+ex.issue?.split?.('.')?.[1]||+ex.issue)?.priority||'P1']}">
          ${r.actions.find(a => a.id === +ex.issue?.split?.('.')?.[1] || +ex.issue)?.priority || 'P1'}
        </div>
        <div class="cli-label">${ex.label}</div>
      </div>`).join('')}
    <div class="code-drop-hint">拖入源文件可查看实际代码</div>
  `;

  window._codeExamples = r.codeExamples;
  window._codeActions = r.actions;
  showCodeExample(0);
}

window.showCodeExample = function(idx) {
  document.querySelectorAll('.code-loc-item').forEach((el, i) => el.classList.toggle('active', i === idx));
  const ex = window._codeExamples?.[idx];
  if (!ex) return;
  const action = window._codeActions?.find(a => a.id === +(ex.issue?.split?.('.')?.[1] || ex.issue));
  window._curCodeEx = ex;
  window._curCodeAction = action;
  const mode = window._diffViewMode || 'split';
  const viewEl = $('codeViewer');
  viewEl.innerHTML = `
    <div class="cv-header">
      ${action ? `<span class="cv-priority" style="color:${{ P0:'#FF4B7B', P1:'#FF8C42', P2:'#666666' }[action.priority]}">[${action.priority}]</span>` : ''}
      <span class="cv-title">${ex.label}</span>
      <span class="cv-lang">${ex.lang}</span>
      <div class="cv-view-toggle">
        <button class="cv-vt-btn ${mode === 'split' ? 'active' : ''}" data-mode="split" onclick="setDiffView('split')" title="Split（左旧右新）">⬓⬔ Split</button>
        <button class="cv-vt-btn ${mode === 'unified' ? 'active' : ''}" data-mode="unified" onclick="setDiffView('unified')" title="Inline（增删上下交错）">≡ Inline</button>
      </div>
    </div>
    <div class="cv-diff" id="cvDiffBody">${renderDiffBody(ex, mode)}</div>
    ${action ? `<div class="cv-footer">📍 ${escHtml(action.location)}</div>` : ''}
  `;
};

window.setDiffView = function(mode) {
  window._diffViewMode = mode;
  const body = $('cvDiffBody');
  if (body && window._curCodeEx) body.innerHTML = renderDiffBody(window._curCodeEx, mode);
  document.querySelectorAll('.cv-vt-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
};

function renderDiffBody(ex, mode) {
  const rows = diffLines(ex.before || '', ex.after || '');
  return mode === 'unified' ? renderUnifiedDiff(rows) : renderSplitDiff(rows);
}

// ── 行级 diff：LCS 对齐，未变行作为上下文行保留 ──
function diffLines(beforeText, afterText) {
  const a = beforeText.replace(/\n$/, '').split('\n');
  const b = afterText.replace(/\n$/, '').split('\n');
  const n = a.length, m = b.length;
  // LCS 长度表（自底向上）
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows = [];
  let i = 0, j = 0, ln = 1, rn = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: 'ctx', left: a[i], right: b[j], ln: ln++, rn: rn++ }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', left: a[i], ln: ln++ }); i++; }
    else { rows.push({ type: 'add', right: b[j], rn: rn++ }); j++; }
  }
  while (i < n) rows.push({ type: 'del', left: a[i++], ln: ln++ });
  while (j < m) rows.push({ type: 'add', right: b[j++], rn: rn++ });
  return rows;
}

// 统一视图：增删与上下文行单列交错
function renderUnifiedDiff(rows) {
  const body = rows.map(row => {
    const sign = row.type === 'del' ? '-' : row.type === 'add' ? '+' : ' ';
    const text = row.type === 'add' ? row.right : row.left;
    return `<div class="ud-row ud-${row.type}">`
      + `<span class="ud-ln">${row.type === 'add' ? '' : row.ln}</span>`
      + `<span class="ud-rn">${row.type === 'del' ? '' : row.rn}</span>`
      + `<span class="ud-sign">${sign}</span>`
      + `<code class="ud-code">${escHtml(text) || ' '}</code>`
      + `</div>`;
  }).join('');
  return `<div class="cv-udiff">${body}</div>`;
}

// 并排视图：左旧右新，连续增删按行配对，空缺补占位
function renderSplitDiff(rows) {
  const out = [];
  let dels = [], adds = [];
  const cell = (c) => c
    ? `<span class="sd-no">${c.no}</span><span class="sd-code sd-${c.cls}">${escHtml(c.text) || ' '}</span>`
    : `<span class="sd-no"></span><span class="sd-code sd-empty"></span>`;
  const rowHtml = (l, r) => `<div class="sd-row"><div class="sd-side sd-left">${cell(l)}</div><div class="sd-side sd-right">${cell(r)}</div></div>`;
  const flush = () => {
    const max = Math.max(dels.length, adds.length);
    for (let k = 0; k < max; k++) {
      const d = dels[k], a = adds[k];
      out.push(rowHtml(
        d ? { no: d.ln, text: d.left, cls: 'del' } : null,
        a ? { no: a.rn, text: a.right, cls: 'add' } : null
      ));
    }
    dels = []; adds = [];
  };
  rows.forEach(row => {
    if (row.type === 'del') dels.push(row);
    else if (row.type === 'add') adds.push(row);
    else { flush(); out.push(rowHtml({ no: row.ln, text: row.left, cls: 'ctx' }, { no: row.rn, text: row.right, cls: 'ctx' })); }
  });
  flush();
  return `<div class="cv-sdiff">${out.join('')}</div>`;
}

// ── 源码级定位：左树右码 ──
function renderCodeTree(r, tree) {
  const locEl = $('codeLocations');
  window._codeTreeFiles = tree.files;
  window._codeTreeBase = tree.base || '';
  window._codeFileToken = (window._codeFileToken || 0) + 1;

  // 由文件相对路径构建嵌套目录树
  const root = {};
  tree.files.forEach((f, idx) => {
    const rel = (tree.base && f.path.startsWith(tree.base)) ? f.path.slice(tree.base.length) : f.path;
    const parts = rel.split('/');
    let node = root;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) (node._files = node._files || []).push({ name: p, idx, file: f });
      else node = (node[p] = node[p] || {});
    });
  });

  locEl.innerHTML = `
    <div class="code-loc-title">源码 <span class="code-count">${tree.files.length} 个文件</span></div>
    <div class="code-tree">${renderCodeTreeNode(root, 0)}</div>
    <div class="code-drop-hint">${escHtml(tree.label || '')}<br>选择文件查看源码 · <span class="ct-hot-key">标红行</span>为根因定位命中行</div>
  `;
  showCodeFile(0);
}

function renderCodeTreeNode(node, depth) {
  let html = '';
  Object.keys(node).filter(k => k !== '_files').sort().forEach(d => {
    html += `<div class="ct-row ct-dir" style="padding-left:${10 + depth * 14}px">📁 ${escHtml(d)}</div>`;
    html += renderCodeTreeNode(node[d], depth + 1);
  });
  (node._files || []).forEach(f => {
    html += `<div class="ct-row ct-file" data-idx="${f.idx}" onclick="showCodeFile(${f.idx})" style="padding-left:${10 + depth * 14}px" title="${escHtml(f.file.note || '')}">`
      + `<span class="ct-fname">📄 ${escHtml(f.name)}</span>`
      + (f.file.issue ? `<span class="ct-issue">${escHtml(f.file.issue)}</span>` : '')
      + `</div>`;
  });
  return html;
}

// 从泳道方块的源码定位链接跳转：切到「代码」页签并在源码树中打开对应文件
window.openCodeFileFromSwimlane = function(path, focusLine) {
  // 1) 切换到「代码」页签
  document.querySelector('.tab[data-tab="code"]')?.click();
  // 2) 在源码树中定位文件（先精确匹配 path，退化为按文件名结尾匹配）
  const files = window._codeTreeFiles || [];
  let idx = files.findIndex(f => f.path === path);
  if (idx < 0) {
    const fname = String(path || '').split('/').pop();
    idx = files.findIndex(f => f.path.split('/').pop() === fname);
  }
  if (idx >= 0) showCodeFile(idx, focusLine);
};

window.showCodeFile = async function(idx, focusLine) {
  const f = window._codeTreeFiles?.[idx];
  if (!f) return;
  document.querySelectorAll('.ct-file').forEach(el => el.classList.toggle('active', +el.dataset.idx === idx));
  const viewEl = $('codeViewer');
  const fileName = f.path.split('/').pop();
  const relPath = (window._codeTreeBase && f.path.startsWith(window._codeTreeBase))
    ? f.path.slice(window._codeTreeBase.length) : f.path;
  viewEl.innerHTML = `
    <div class="cv-header">
      ${f.issue ? `<span class="cv-priority" style="color:#FF4B7B">问题 ${escHtml(f.issue)}</span>` : ''}
      <span class="cv-title">${escHtml(fileName)}</span>
      <span class="cv-lang">${escHtml(f.lang || '')}</span>
    </div>
    <div class="cv-path">${escHtml(relPath)}</div>
    <div class="cv-source" id="cvSource"><div class="cv-loading">加载中…</div></div>
    ${f.note ? `<div class="cv-footer">📍 ${escHtml(f.note)}</div>` : ''}
  `;
  const token = ++window._codeFileToken;
  try {
    const res = await fetch(f.path);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if (token !== window._codeFileToken) return;   // 已切换到其他文件
    renderCodeSource(text, f.anchors || [], focusLine);
  } catch (e) {
    if (token !== window._codeFileToken) return;
    const src = $('cvSource');
    if (src) src.innerHTML = `<div class="cv-loading">源码加载失败（${escHtml(String(e.message || e))}）：<br>${escHtml(f.path)}</div>`;
  }
};

function renderCodeSource(text, anchors, focusLine) {
  const el = $('cvSource');
  if (!el) return;
  const hot = new Set(anchors);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let firstHot = null;
  el.innerHTML = lines.map((ln, i) => {
    const n = i + 1;
    const isHot = hot.has(n);
    if (isHot && firstHot === null) firstHot = n;
    return `<div class="cv-line${isHot ? ' hot' : ''}" data-ln="${n}">`
      + `<span class="cv-ln">${n}</span>`
      + `<code class="cv-lc">${escHtml(ln) || ' '}</code></div>`;
  }).join('');
  // 优先滚动到指定行（来自泳道源码定位的 focus 行），否则滚到首个命中行
  const target = Number.isFinite(+focusLine) && +focusLine > 0 ? +focusLine : firstHot;
  if (target !== null) {
    el.querySelector(`.cv-line[data-ln="${target}"]`)?.scrollIntoView({ block: 'center' });
  }
}

// ============================================================
// Tab 4: 文档
// ============================================================
function renderDocs(r) {
  const docsEl = $('docsContent');
  const usedSkills = r.meta.skills.filter(s => SKILL_DOCS[s]);
  const allOther = Object.entries(SKILL_DOCS).filter(([k]) => !r.meta.skills.includes(k));

  docsEl.innerHTML = `
    <div class="fabricated-banner">⚠️ Skill 描述及关键概念速查为预置内容，并非来自解析包</div>
    <div class="docs-section-title">本次使用的 Skills</div>
    <div class="docs-grid">${usedSkills.map(s => skillCard(s, SKILL_DOCS[s], true)).join('')}</div>
    ${r.meta.advisorStatus ? `
    <div class="docs-section-title">Advisor 状态</div>
    <div class="advisor-status">${escHtml(r.meta.advisorStatus)}</div>` : ''}
    <div class="docs-section-title">其他可用 Skills</div>
    <div class="docs-grid">${allOther.map(([k, v]) => skillCard(k, v, false)).join('')}</div>
    <div class="docs-section-title">关键概念速查</div>
    <div class="docs-concepts">${renderConcepts(r)}</div>
  `;
}

function skillCard(name, doc, used) {
  return `<div class="doc-card ${used ? 'doc-used' : ''}">
    <div class="dc-icon">${doc.icon}</div>
    <div class="dc-name"><code>${name}</code></div>
    <div class="dc-desc">${doc.desc}</div>
  </div>`;
}

function renderConcepts(r) {
  const concepts = [
    { term: 'PHS（性能健康度）', def: '0-100 的综合评分，涵盖计算利用率、通信效率、调度效率、内存带宽利用率四子项，按场景加权。等级：S≥90 / A≥75 / B+≥60 / B≥45 / C≥30 / D<30。' },
    { term: 'Free Time', def: 'step_trace_time.csv 中的 Device 空闲时间，等于 Stage - Computing - Communication。Free Time 高意味着 NPU 在等待 Host 下发或同步，是 Host Bound 的直接指标。' },
    { term: 'AI_CPU 算子', def: 'Ascend 片上 CPU 核执行的算子（如 IndexPut/GatherElements 的部分 dtype 路径）。AI_CPU 任务会序列化后续 AI Core 任务的下发，造成 device pipeline 阻塞。' },
    { term: 'MFU（模型浮点利用率）', def: '实际 FLOPs/s ÷ 芯片峰值 FLOPs/s × 100。Ascend 910B 峰值：FP16/BF16 376 TFLOPs，FP32 75 TFLOPs。MFU < 20% 通常意味着 Memory Bound 或 Host Bound。' },
    { term: 'D2H 同步（Device→Host）', def: 'Device 数据搬回 Host（如 .cpu()/.item()）会强制 CPU 等待 NPU 执行完毕，打断流水线。NonZero 等动态 shape 算子天然触发 D2H 同步。' },
  ];
  return concepts.map(c => `<div class="concept-item"><span class="concept-term">${c.term}</span><span class="concept-def">${c.def}</span></div>`).join('');
}

// ============================================================
// Drop Zone（解析用户拖入的 .md 报告）
// ============================================================
function setupDrop() {
  const dz = $('dropZone');
  const fi = $('fileInput');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });
  dz.addEventListener('click', () => {
    if (typeof window._onDropZoneClick === 'function' && window._onDropZoneClick()) return;
    fi.click();
  });
  fi.addEventListener('change', () => handleFiles(fi.files));
}
window._msSelectReportById = function (id) {
  const r = REPORTS.find(x => x.id === id);
  if (r) selectReport(r);
};

function handleFiles(files) {
  if (typeof window._onFileDrop === 'function' && window._onFileDrop(files)) return;
  const file = Array.from(files).find(f => f.name.endsWith('.md'));
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const parsed = parseReport(e.target.result, file.name);
    const existing = REPORTS.findIndex(r => r.id === parsed.id);
    if (existing >= 0) REPORTS[existing] = parsed; else REPORTS.unshift(parsed);
    buildHistory();
    selectReport(parsed);
  };
  reader.readAsText(file, 'utf-8');
}
window._msHandleFiles = handleFiles;

// ============================================================
// Report Markdown → Structured Data (SKILL 抽取规则实现)
// ============================================================

// 去除字段块的公共缩进：gb 捕获的内容若以换行+缩进的子列表开头，
// 直接 trim 只会剥掉首项的缩进，导致首项被抬高一层、其余被嵌套其下。
// 这里按非空行的最小缩进统一左对齐，子列表才会渲染为平级项。
function dedentBlock(text) {
  const lines = String(text || '').replace(/\s+$/, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  const indents = lines.filter(l => l.trim()).map(l => l.match(/^[ \t]*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map(l => l.slice(min)).join('\n').trim();
}

function parseReport(md, filename = '') {
  const titleM = md.match(/^#\s+(.+)$/m);
  const rawTitle = titleM ? titleM[1] : filename.replace('.md', '');
  const title = rawTitle.replace(/[（(][^）)]+[）)]/g, '').trim();
  const subtitleM = rawTitle.match(/[（(]([^）)]+)[）)]/);

  // PHS
  const phsM = md.match(/\*\*性能健康度\*\*[：:]\s*(\d+)\s*\/\s*100\s*\(([^)]+)\)\s*→\s*优化后预估\s*\*\*(\d+)\s*\/\s*100\s*\(([^)]+)\)\*\*\s*[—-]+\s*(.+?)(?:\n|$)/);
  const phs = { current: 0, grade: 'N/A', estimated: 0, estGrade: 'N/A', subItems: [] };
  if (phsM) {
    phs.current = +phsM[1]; phs.grade = phsM[2].trim();
    phs.estimated = +phsM[3]; phs.estGrade = phsM[4].trim();
    for (const m of phsM[5].matchAll(/([^\s·—\-]+)\s+([\d.]+%|N\/A)/g))
      phs.subItems.push({ name: m[1], value: m[2] === 'N/A' ? null : parseFloat(m[2]) });
  }

  const getField = (text, key) => (text.match(new RegExp(`\\*\\*${key}\\*\\*[：:]\\s*(.+?)(?:\\n|$)`)) || [])[1]?.trim() || '';
  const summary = { conclusion: getField(md, '结论'), topBottleneck: getField(md, '头号瓶颈'), maxGain: getField(md, '收益上限') };

  // 指标看板数据（可选）：优先解析可见的「时序结构指标看板」表格（timeline-swimlane-analyzer
  // 写入，只列已测得的指标）；旧报告若仍用 <!-- METRICS {json} --> 注释块则回退解析。
  let metrics = parseMetricsTable(md);
  if (!metrics) {
    const metricsM = md.match(/<!--\s*METRICS\s*([\s\S]*?)-->/i);
    if (metricsM) {
      try { metrics = JSON.parse(metricsM[1].trim()); }
      catch (e) { console.warn('METRICS 块解析失败，已忽略：', e.message); metrics = null; }
    }
  }

  // Actions table
  const actSec = (md.match(/##\s+2[\s\S]*?(?=\n##\s+3\.)/)||[])[0]||'';
  const actions = [];
  for (const row of (actSec.match(/^\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|$/gm)||[]).slice(2)) {
    const c = row.split('|').slice(1,-1).map(s=>s.trim().replace(/\*\*/g,''));
    if (/^\d+$/.test(c[0])) {
      const bn = (c[3].match(/[-−](\d+(?:\.\d+)?)\s*%/)||[])[1];
      actions.push({id:+c[0],priority:c[1],problem:c[2],benefit:c[3],benefitNum:bn?+bn:null,difficulty:c[4],location:c[5],visualization:c[6]||''});
    }
  }

  // Issues — parse each ### 3.N block
  // Known field keys used as section boundaries within issue blocks
  const IS_KNOWN = '(?:证据|影响|修复建议|操作步骤|问题修改完成的验证方式|验证方法|问题举证视图|可视化视图)';
  const issues = [];
  for (const block of md.split(/(?=\n###\s+\d+\.\d+)/)) {
    const hm = block.match(/###\s+(\d+\.\d+)\s+\[([^\]]+)\]\s+(.+?)(?:\n|$)/);
    if (!hm) continue;
    const gb = key => dedentBlock((block.match(new RegExp(`\\*\\*${key}\\*\\*[^：:\\n]*[：:]([\\s\\S]*?)(?=\\n\\s*-\\s*\\*\\*${IS_KNOWN}\\*\\*|\\n###|\\n##|$)`))||[])[1]||'');
    const stepsRaw = gb('修复建议') || gb('操作步骤');
    const steps = (stepsRaw.match(/^\s*(?:\d+\.|-)\s*(.+)$/gm)||[]).map(s=>s.replace(/^\s*(?:\d+\.|-)\s*/,'').trim());
    issues.push({id:hm[1],priority:hm[2],title:hm[3].trim(),evidence:gb('证据'),impact:gb('影响'),stepsRaw,steps,verification:gb('问题修改完成的验证方式')||gb('验证方法'),visualization:gb('问题举证视图')||gb('可视化视图'),codeLocations:[]});
  }

  const noPs = (md.match(/##\s+4[\s\S]*?(?=\n##\s+5\.)/)||[])[0]?.match(/^-\s+(?!\*\*未排查)(.+)$/gm)?.map(s=>s.replace(/^-\s+/,'').replace(/\*\*/g,''))||[];

  const metaSec = (md.match(/##\s+5\.[\s\S]*/)||[])[0]||'';
  const gm = key => (metaSec.match(new RegExp(`\\*\\*${key}\\*\\*[：:]\\s*\`?([^\`\\n]+)\`?`))||[])[1]?.trim()||'';
  const meta = {
    date:gm('分析日期'), dataPath:gm('数据路径'), range:gm('数据范围'),
    version:(metaSec.match(/\*\*(?:torch_npu.*CANN.*版本|版本)\*\*[：:]\s*(.+?)(?:\n|$)/)||[])[1]?.trim()||'',
    skills:(metaSec.match(/^\s+-\s+`([^`]+)`/gm)||[]).map(s=>(s.match(/`([^`]+)`/)||[])[1]||'').filter(Boolean),
    advisorStatus:gm('Advisor 状态'), output:gm('输出位置'),
  };

  // 数据来源与落盘信息块（规则 8）→ 任务信息页"落盘文件信息"卡片；无依据的字段留空不猜
  const diskFileInfo = parseDiskFileInfo(metaSec);

  let taskType = '性能分析';
  if (meta.skills.includes('msot-msopprof-operator-profiler')||title.includes('算子')) taskType='算子调优';
  else if (/rl|强化学习|rollout|verl|grpo|ppo/i.test(title+meta.range)) taskType='RL 训练';
  else if (title.includes('推理')||title.includes('inference')) taskType='推理诊断';
  else if ((title.includes('集群')||meta.range.includes('节点')||meta.range.includes('Rank 0'))&&!title.includes('训练')) taskType='集群诊断';
  else if (meta.range.includes('PP=')||meta.range.includes('DP=')||meta.skills.includes('cluster-fast-slow-rank-detector')||title.includes('训练')) {
    const scaleTxt = title+' '+meta.range;
    const multiNode = /多机/.test(scaleTxt) || /([2-9]|\d{2,})\s*节点/.test(scaleTxt);
    const singleCard = /单卡/.test(scaleTxt);
    taskType = multiNode ? '多机多卡训练' : singleCard ? '单机单卡训练' : '单机多卡训练';
  }

  return { id:`parsed-${Date.now()}`, filename, title, subtitle:subtitleM?.[1]||'', taskType, reportDate:meta.date||new Date().toISOString().slice(0,10), phs, summary, actions, issues, noProblems:noPs, meta, metrics, diskFileInfo, codeExamplesFabricated:false, codeExamples:[], rawMd:md };
}

// 可见的「时序结构指标看板」表格 → r.metrics（规则 7）。中文指标名↔看板 key 固定映射。
const METRIC_LABEL_KEY = {
  '关键路径占比': 'critical_path_ratio',
  '算子利用率': 'op_utilization',
  '计算-通信重叠率': 'overlap_ratio',
  'Host 下发间隙占比': 'host_launch_gap_ratio',
  'PP 流水线 bubble 率': 'pp_bubble_ratio',
  'step 抖动 (CV)': 'step_cv',
  '最空闲泳道空挡': 'max_lane_idle',
  '通信抖动 (CV)': 'comm_jitter',
};
function parseMetricsTable(md) {
  // 截取「时序结构指标看板」标题到下一个 ##/### 或文末之间的区段
  const sec = (md.match(/###?\s*时序结构指标看板[\s\S]*?(?=\n###?\s|\n##\s|$)/) || [])[0];
  if (!sec) return null;
  const metrics = {};
  for (const line of sec.split('\n')) {
    const m = line.match(/^\s*\|([^|]+)\|([^|]+)\|([^|]*)\|([^|]*)\|\s*$/);
    if (!m) continue;
    const label = m[1].trim();
    const key = METRIC_LABEL_KEY[label];
    if (!key) continue;                                   // 跳过表头 / 分隔行 / 未知行
    const valM = m[2].replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!valM) continue;
    const entry = { value: parseFloat(valM[0]) };
    const st = m[3].trim().toLowerCase();
    if (st === 'ok' || st === 'warn' || st === 'bad') entry.status = st;
    const note = m[4].trim();
    if (note && note !== '—') entry.note = note;
    metrics[key] = entry;
  }
  return Object.keys(metrics).length ? metrics : null;
}

// 解析第 5 章"数据来源与落盘信息"块（规则 8 / dataset-source-identifier skill）。
// 无此块返回 null（不影响手写 diskFileInfo 的旧记录）；字段缺失/留空即为 ''（卡片渲染为"—"，不猜）。
function parseDiskFileInfo(metaSec) {
  const block = (metaSec.match(/\*\*数据来源与落盘信息\*\*[\s\S]*?(?=\n\s*-\s+\*\*|\n##|$)/) || [])[0];
  if (!block) return null;
  const f = key => {
    const m = block.match(new RegExp(`-\\s*${key.replace(/ /g, '\\s*')}\\s*[：:]\\s*(.*?)\\s*(?:\\n|$)`));
    return m ? m[1].trim() : '';
  };
  const llmRaw = f('是否 LLM 训练');
  const isLLM = /^是/.test(llmRaw) ? 'yes' : /^否/.test(llmRaw) ? 'no' : /不适用|N\/?A/i.test(llmRaw) ? 'na' : '';
  const linkRaw = f('来源链接');
  const lm = linkRaw.match(/\[([^\]]*)\]\(([^)]+)\)/);
  return {
    dir: f('数据目录').replace(/^`|`$/g, ''),
    source: f('来源'),
    isLLM,
    model: f('模型 / 用途'),
    size: f('落盘大小'),
    link: lm ? lm[2] : '',
    linkText: lm ? lm[1] : '',
    basis: f('识别依据'),
  };
}

// ============================================================
// Utility
// ============================================================
// 等级色渐变（按分数 0→100 在各等级色之间插值，用于仪表盘环形刻度——图形描边，非文字）。
// 严格取自 PTO 设计系统的字面 accent 色：D/S 直接等于 --ark-red-500 #ff4b7b / --ark-green-500
// #04d793，中间四档是这两色经 --ark-orange-500 #ffaa3b 中转、在 OKLCH 空间插值得到（不引入
// PTO 之外的新色相）。这套比 gradeToColor（徽标/分数文字色）更贴近 PTO 原色的高亮度，白底下
// 对比度明显走低、B/B+ 也不再是强区分色——但环上位置本身已是主编码，实际读数靠指针 + 中心大
// 分数 + 徽标文字（仍用 gradeToColor 的深色阶），此处只做视觉强化，不承担独立可读责任。
function gradeColorAt(v) {
  const stops = [
    [0,   [255, 75, 123]],  // D  #ff4b7b（=ark-red-500）
    [30,  [255, 112, 81]],  // C  #ff7051
    [45,  [255, 151, 55]],  // B  #ff9737
    [60,  [233, 181, 27]],  // B+ #e9b51b
    [75,  [163, 203, 69]],  // A  #a3cb45
    [90,  [4, 215, 147]],   // S  #04d793（=ark-green-500）
    [100, [4, 215, 147]],
  ];
  v = Math.max(0, Math.min(100, v));
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i], [v1, c1] = stops[i + 1];
    if (v <= v1) {
      const t = (v - v0) / (v1 - v0 || 1);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(2,153,49)';
}

// hex → rgba（用于等级徽标半透明底色）
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// 合并仪表盘：单盘展示「当前分数+等级」与「优化后可增益+等级」，分小段 + 等级色渐变
function renderPhsGauge(box, phs) {
  if (!box) return;
  const cur = Math.max(0, Math.min(100, Math.round(phs.current ?? 0)));
  const est = Math.max(cur, Math.min(100, Math.round(phs.estimated ?? cur)));
  const grade = phs.grade || 'N/A';
  const estGrade = phs.estGrade || grade;
  const curColor = gradeToColor(grade);
  const estColor = gradeToColor(estGrade);

  const W = 300, H = 200, cx = 150, cy = 162;
  const rOut = 132, rIn = 107;
  const N = 64;                  // 小段数量
  const A0 = 180, A1 = 0;        // 左 → 右，跨过顶部
  const polar = (r, aDeg) => {
    const a = aDeg * Math.PI / 180;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const angOf = v => A0 - (v / 100) * (A0 - A1);

  // 小段
  let ticks = '';
  for (let i = 0; i < N; i++) {
    const v = (i + 0.5) / N * 100;
    const aDeg = angOf(v);
    const [x1, y1] = polar(rIn, aDeg);
    const [x2, y2] = polar(rOut, aDeg);
    let color, opacity;
    if (v <= cur)      { color = gradeColorAt(v); opacity = 1; }      // 已达
    else if (v <= est) { color = gradeColorAt(v); opacity = 0.42; }   // 可增益
    else               { color = '#8a8a96'; opacity = 0.5; }          // 不可达（中性灰，双主题通用）
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="3.4" stroke-linecap="round" opacity="${opacity}"/>`;
  }

  // 当前值指针（小三角，位于环内侧、指向圆环）
  const aCur = angOf(cur);
  const fmtPt = (r, a) => { const [x, y] = polar(r, a); return `${x.toFixed(1)},${y.toFixed(1)}`; };
  const pointer = `<polygon points="${fmtPt(rIn - 1, aCur)} ${fmtPt(rIn - 12, aCur - 3.4)} ${fmtPt(rIn - 12, aCur + 3.4)}" fill="var(--fg)"/>`;

  // 增益弧线 + 箭头（当前 → 优化后；环外，单侧箭头）
  let gainArrow = '';
  if (est > cur + 1) {
    const aEst = angOf(est);
    const r2 = rOut + 17;
    const [sx, sy] = polar(r2, aCur);
    const [ex, ey] = polar(r2, aEst);
    gainArrow += `<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${r2} ${r2} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${estColor}" stroke-width="2" stroke-linecap="round"/>`;
    const [bx, by] = polar(r2, aEst + 5);
    let dx = ex - bx, dy = ey - by;
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    // 取指向圆环外侧的法线方向，使箭头只在外侧出翼（靠环一侧为平边）
    let px = -dy, py = dx;
    if (px * (ex - cx) + py * (ey - cy) < 0) { px = -px; py = -py; }
    const l = 8, w = 5;
    const barb  = `${(ex - dx * l + px * w).toFixed(1)},${(ey - dy * l + py * w).toFixed(1)}`;
    const shaft = `${(ex - dx * l).toFixed(1)},${(ey - dy * l).toFixed(1)}`;
    gainArrow += `<polygon points="${ex.toFixed(1)},${ey.toFixed(1)} ${barb} ${shaft}" fill="${estColor}"/>`;
  }

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;overflow:visible">
      ${ticks}
      ${gainArrow}
      ${pointer}
    </svg>
    <div class="phs-gauge-center">
      <span class="phs-gauge-grade" style="background:${hexA(curColor, 0.15)};color:${curColor}">${grade}</span>
      <div class="phs-gauge-score" style="color:${curColor}">${cur}</div>
      <div class="phs-gauge-sub">优化后预估可达 <b>${est}</b>
        <span class="phs-gauge-estbadge" style="background:${hexA(estColor, 0.15)};color:${estColor}">${estGrade}</span>
      </div>
    </div>`;
}

function setupPhsTooltip() {
  const icon = document.getElementById('phsInfoIcon');
  const tip = document.getElementById('phsTooltip');
  if (!icon || !tip) return;
  let timer = null;

  // 祖先 .pto-ide-frame__pane 设有 backdrop-filter，会为其后代创建新的 containing block，
  // 导致嵌套其中的 position:fixed 气泡实际相对该祖先而非视口定位，造成严重错位。
  // 将气泡挂到 body 下即可让 fixed 定位重新以视口为基准；每次重建时清理上一次挂载的旧节点。
  document.querySelectorAll('body > .phs-tooltip').forEach(n => { if (n !== tip) n.remove(); });
  if (tip.parentElement !== document.body) document.body.appendChild(tip);

  function positionAndShow(e) {
    clearTimeout(timer);
    tip.style.visibility = 'hidden';
    tip.style.display = 'block';
    const tW = tip.offsetWidth || 420;
    const tH = tip.offsetHeight;
    // 锚定鼠标位置（clientX/Y 与 position:fixed 使用同一坐标系，最可靠）
    let left = e.clientX + 8;
    let top  = e.clientY - 12;
    if (left + tW > window.innerWidth - 16) left = window.innerWidth - 16 - tW;
    if (left < 8) left = 8;
    if (top + tH > window.innerHeight - 8) top = e.clientY - tH - 8;
    if (top < 8) top = 8;
    tip.style.left = left + 'px';
    tip.style.top  = top  + 'px';
    tip.style.visibility = '';
  }

  function scheduleHide() {
    timer = setTimeout(() => { tip.style.display = 'none'; }, 120);
  }

  icon.addEventListener('mouseenter', positionAndShow);
  icon.addEventListener('mouseleave', scheduleHide);
  tip.addEventListener('mouseenter', () => clearTimeout(timer));
  tip.addEventListener('mouseleave', scheduleHide);
}

function metaRow(label, val) {
  return `<div class="meta-row"><span class="meta-key">${label}</span><span class="meta-val">${val}</span></div>`;
}

function gradeToColor(g) {
  // 6 档等级色，用于徽标/仪表盘中心分数——颜色即文字墨色，比 gradeColorAt（环形刻度）
  // 亮度低一档以保证白底 3:1 文字对比度；styles.css 的 .grade-* 需同步这套值。
  return {S:'#13a692',A:'#00782d','B+':'#929710',B:'#845a00',C:'#eb5a04',D:'#b60254'}[g]||'#999999';
}

function scoreColor(v) {
  if (v === null) return '#3A3A3A';
  if (v >= 75) return '#04D793';
  if (v >= 50) return '#4369EF';
  if (v >= 30) return '#FFAA3B';
  return '#FF4B7B';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// Sidebar Collapse
// ============================================================
function setupSidebarCollapse() {
  const sidebar = $('sidebar');
  const collapseBtn = $('sidebarCollapseBtn');
  const toggleBtn = $('sidebarToggleBtn');
  collapseBtn.addEventListener('click', () => {
    sidebar.classList.add('collapsed');
    toggleBtn.style.display = 'flex';
  });
  toggleBtn.addEventListener('click', () => {
    sidebar.classList.remove('collapsed');
    toggleBtn.style.display = 'none';
  });
  toggleBtn.style.display = 'none';
}

// ============================================================
// Chat Panel
// ============================================================
// 气泡定位：报告里直接能看到的结论（瓶颈/优先级/收益/代码位置）不放，
// 只放需要 AI 现场“解释机理 / 给落地步骤 / 权衡取舍 / 排优先级”的问题。
const CHAT_SUGGESTIONS = {
  '单机单卡训练': ['用大白话讲讲这个任务到底卡在哪', '第一优先级的问题，具体怎么改？给示例', '这些优化有什么风险或副作用？', '只有一天时间，先做哪几项最划算？'],
  '单机多卡训练': ['用大白话讲讲这个任务到底卡在哪', '第一优先级的问题，具体怎么改？给示例', '这些优化有什么风险或副作用？', '只有一天时间，先做哪几项最划算？'],
  '多机多卡训练': ['用大白话讲讲这个任务到底卡在哪', '第一优先级的问题，具体怎么改？给示例', '这些优化有什么风险或副作用？', '只有一天时间，先做哪几项最划算？'],
  '推理诊断': ['为什么会变成这样？底层机理讲讲', '要把性能压到极限还得做什么？', '这几项优化哪个投入产出比最高？', '动手时最容易踩的坑有哪些？'],
  '算子调优': ['这个算子为什么慢？从硬件角度解释', 'Tiling / Double Buffer 具体怎么配？', '给一版优化后的 kernel 改写思路', '报告没提到的优化点还有吗？'],
  '集群诊断': ['慢卡的根因帮我再深挖一层', '怎么一步步定位并复现这个问题？', '通信/负载这些优化各有什么取舍？', '按投入产出比把优化项排个序'],
  'RL 训练': ['Rollout 慢的根本原因和原理是什么？', '生成阶段开图模式具体怎么落地？', '通信暴露怎么彻底解决？', '各阶段优化的优先级怎么排？'],
  '性能分析': ['用大白话总结下这份报告', '最该先做的优化，给我具体步骤', '整体能提速多少？这个数怎么估的', '实施时有哪些风险要注意？'],
};

function initChat(report) {
  chatReport = report;
  window._chatReport = report;
  chatHistory = [];
  // 切换报告后预取原始报告全文，作为对话上下文（异步、不阻塞）
  ensureReportRawMd(report);
  const msgEl = $('chatMessages');
  msgEl.innerHTML = '';

  const badge = $('chatReportBadge');
  $('chatReportTitle').textContent = report.title;
  badge.textContent = report.taskType;
  badge.className = `chat-report-badge badge-${report.taskType === 'RL 训练' ? 'rl' : report.taskType === '推理诊断' ? 'infer' : (report.taskType.includes('训练') || report.taskType === '集群诊断') ? 'train' : 'op'}`;

  buildSuggestions(report);
}

function buildSuggestions(report) {
  const suggs = CHAT_SUGGESTIONS[report.taskType] || CHAT_SUGGESTIONS['性能分析'];
  const wrap = $('chatSuggestions');
  wrap.innerHTML = '';
  suggs.forEach(s => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-suggestion';
    btn.textContent = s;
    btn.addEventListener('click', () => sendSuggestion(s));
    wrap.appendChild(btn);
  });
}

// 点击气泡：把问题构造进输入框并直接发送
function sendSuggestion(text) {
  if (chatStreaming || !chatReport) return;
  const input = $('chatInput');
  if (input) { input.value = text; input.style.height = ''; }   // 构造成问题
  sendMessage(text, chatReport);                                // 实现发送
  if (input) { input.value = ''; input.style.height = ''; }     // 发送后清空
}

// 回复进行中：置灰气泡与发送按钮，防止连点
function setChatBusy(busy) {
  document.querySelectorAll('#chatSuggestions .chat-suggestion').forEach(b => { b.disabled = busy; });
  const sendBtn = $('chatSendBtn');
  if (sendBtn) sendBtn.disabled = busy;
}

function setupChatInput() {
  const input = $('chatInput');
  const sendBtn = $('chatSendBtn');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  sendBtn.addEventListener('click', doSend);
  function doSend() {
    const text = input.value.trim();
    if (!text || !chatReport) return;
    input.value = '';
    input.style.height = '';
    sendMessage(text, chatReport);
  }
}

// ============================================================
// DeepSeek 对话（纯前端，用户自带 API Key）
// ============================================================
const DEEPSEEK = {
  endpoint: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-chat',
  temperature: 0.3,
};
const DS_KEY_STORE = 'deepseek_api_key';

function getApiKey() { return (localStorage.getItem(DS_KEY_STORE) || '').trim(); }
function setApiKey(k) {
  if (k) localStorage.setItem(DS_KEY_STORE, k.trim());
  else localStorage.removeItem(DS_KEY_STORE);
  updateKeyUI();
}

// 弹窗设置 / 修改 Key，返回最新 key
window.promptApiKey = function () {
  const cur = getApiKey();
  const k = window.prompt(
    '请输入你自己的 DeepSeek API Key（以 sk- 开头）：\n\n' +
    '· 仅保存在你当前浏览器（localStorage），除了直接发给 DeepSeek 官方接口外不会上传到任何地方。\n' +
    '· 在 https://platform.deepseek.com 申请。\n' +
    '· 留空并确定可清除已保存的 Key。',
    cur
  );
  if (k === null) return cur;       // 用户取消
  setApiKey(k);
  return getApiKey();
};

// 刷新顶部「Key 状态」条
function updateKeyUI() {
  const has = !!getApiKey();
  const dot = $('cqDot'), text = $('cqStatusText'), bar = $('chatKeybar');
  if (dot)  dot.className = 'cq-dot ' + (has ? 'ok' : 'off');
  if (text) text.textContent = has ? 'API Key 已配置 · 可自由提问' : '未配置 API Key';
  if (bar)  bar.classList.toggle('off', !has);
  const input = $('chatInput');
  if (input) input.placeholder = has ? '输入问题，或点击上方快捷提问…' : '请先点右侧「设置 Key」…';
}
window.updateKeyUI = updateKeyUI;

// ── 每日问答额度（纯前端，按浏览器/天；存于 localStorage，跨天自动重置）──
// 注意：这是软限制，用户清缓存 / 无痕 / 换浏览器即可绕过；如需真正按 IP 限制需配合后端。
const DAILY_LIMIT = 20;
const DS_QUOTA_STORE = 'deepseek_daily_quota';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function getQuota() {
  let q;
  try { q = JSON.parse(localStorage.getItem(DS_QUOTA_STORE) || '{}'); } catch { q = {}; }
  if (q.date !== todayStr()) q = { date: todayStr(), count: 0 };   // 跨天重置
  return q;
}
function quotaUsed() { return getQuota().count; }
function quotaLeft() { return Math.max(0, DAILY_LIMIT - quotaUsed()); }
function bumpQuota() {
  const q = getQuota();
  q.count += 1;
  localStorage.setItem(DS_QUOTA_STORE, JSON.stringify(q));
  updateQuotaUI();
}
function updateQuotaUI() {
  const used = quotaUsed();
  const full = used >= DAILY_LIMIT;
  const pct = Math.min(100, Math.round(used / DAILY_LIMIT * 100));
  const fill = $('quotaFill'), label = $('quotaLabel'), bar = $('chatQuotabar');
  if (fill) { fill.style.width = pct + '%'; fill.classList.toggle('full', full); }
  if (label) label.textContent = `${used}/${DAILY_LIMIT}`;
  if (bar) bar.classList.toggle('full', full);
}
window.updateQuotaUI = updateQuotaUI;

// 确保报告原始 markdown 全文已加载（作为对话上下文）
async function ensureReportRawMd(report) {
  if (!report || report.rawMd || !report.filename) return;
  try {
    const res = await fetch(report.filename);
    if (res.ok) report.rawMd = await res.text();
  } catch { /* 忽略，回退到结构化上下文 */ }
}

// 报告的结构化速览（从解析后的字段汇总，作为快速索引）
function buildStructuredBrief(report) {
  const { title, taskType, reportDate, summary, phs, actions, issues, noProblems } = report;
  let s = `标题：${title}\n任务类型：${taskType}\n报告日期：${reportDate}\n`;
  if (phs) s += `性能健康度 PHS：${phs.current}/100（${phs.grade}），优化后预估 ${phs.estimated}/100（${phs.estGrade}）\n`;
  if (summary) {
    s += `核心结论：${summary.conclusion}\n头号瓶颈：${summary.topBottleneck}\n收益上限：${summary.maxGain}\n`;
  }
  if (issues && issues.length) {
    s += `\n关键问题：\n` + issues.map(i =>
      `- [${i.priority}] ${i.title}：${i.evidence}（影响：${i.impact}；修复：${(i.steps || []).join('；')}；验证：${i.verification || '—'}）`
    ).join('\n');
  }
  if (actions && actions.length) {
    s += `\n\n行动清单：\n` + actions.map(a =>
      `- [${a.priority}] ${a.problem}｜预期收益：${a.benefit}｜难度：${a.difficulty}｜代码位置：${a.location || '—'}`
    ).join('\n');
  }
  if (noProblems && noProblems.length) {
    s += `\n\n已确认无问题：\n` + noProblems.map(p => `- ${p}`).join('\n');
  }
  return s;
}

// 拼装喂给模型的报告上下文：结构化速览 + 报告原文全文（原文为权威依据）
function buildReportContext(report) {
  let ctx = `【结构化速览】\n${buildStructuredBrief(report)}`;
  if (report.rawMd && report.rawMd.length > 200) {
    ctx += `\n\n【报告原文（"报告原文"页签内容，回答性能/训练相关问题时以此为最权威依据）】\n${report.rawMd}`;
  }
  return ctx;
}

function buildSystemPrompt(report) {
  const nowStr = new Date().toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'short' });
  return `你是 MindStudioNext 的 AI 助手，运行在一个昇腾(Ascend) NPU 性能分析工具中。当前真实时间：${nowStr}。

当前用户正在查看一份分析报告：《${report.title}》（${report.taskType}）。下方提供了它的「结构化速览」与「报告原文」。

回答规则：
1. 先判断用户的问题是否与"这次性能分析 / 这个任务（训练·推理·集群·算子等）/ 当前这份报告"相关。
   • 相关时（如"这个训练任务怎么样""头号瓶颈是什么""哪张卡最慢""代码在哪改""健康度多少"）：必须紧扣下方报告内容综合作答，**以【报告原文】为最权威依据**，速览仅作索引；不要编造报告里没有的数字或结论，报告确实没提到的就如实说"报告中未涵盖"。
   • 用户说的"这个/当前/这次 + 任务/报告/训练/模型/结果"等指代，一律指上面这份当前选中的报告。
2. 与报告无关的常识、时间、闲聊或工具使用类问题（如"今天星期几""你是谁"）：直接、简洁地正常回答，**不要硬扯到报告**。
3. 一律用中文，专业、简洁，可用 Markdown（加粗/列表/代码块/表格），先给结论再给依据。

========== 分析报告内容 ==========
${buildReportContext(report)}`;
}

// 直接流式调用 DeepSeek；onToken(累积文本) 在每次增量到达时回调
async function streamChat(messages, onToken, signal) {
  const resp = await fetch(DEEPSEEK.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getApiKey(),
    },
    body: JSON.stringify({
      model: DEEPSEEK.model,
      messages,
      stream: true,
      temperature: DEEPSEEK.temperature,
    }),
    signal,
  });

  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.json())?.error?.message || ''; } catch { try { detail = await resp.text(); } catch {} }
    if (resp.status === 401) throw new Error('API Key 无效或未授权（401）。请点右侧「设置 Key」检查。');
    if (resp.status === 402) throw new Error('该 Key 对应账户余额不足（402）。');
    if (resp.status === 429) throw new Error('请求过于频繁或额度用尽（429），请稍后再试。');
    throw new Error(`HTTP ${resp.status}${detail ? '：' + detail : ''}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();           // 末行可能不完整，留到下一轮
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content || '';
        if (delta) { full += delta; onToken(full); }
      } catch { /* 忽略心跳/不完整分片 */ }
    }
  }
  return full;
}

window.sendMessage = async function(text, report) {
  if (!report || chatStreaming) return;
  const msgEl = $('chatMessages');

  // 没有 Key 先引导填写
  if (!getApiKey()) {
    const k = window.promptApiKey();
    if (!k) {
      appendMessage('user', text);
      appendMessage('ai', '⚠️ 还没有配置 DeepSeek API Key，无法对话。点右侧「设置 Key」填入你自己的 key（sk- 开头）后再试。');
      msgEl.scrollTop = msgEl.scrollHeight;
      return;
    }
  }

  // 每日问答额度检查（达上限则拒绝本次提问）
  if (quotaLeft() <= 0) {
    appendMessage('user', text);
    appendMessage('ai', `⚠️ 今日问答已达上限（${DAILY_LIMIT} 次/天），请明天再来。`);
    msgEl.scrollTop = msgEl.scrollHeight;
    return;
  }

  appendMessage('user', text);
  msgEl.scrollTop = msgEl.scrollHeight;

  // 确保上下文已就绪
  await ensureReportRawMd(report);

  chatHistory.push({ role: 'user', content: text });

  // 创建一个流式更新的 AI 气泡
  const aiDiv = document.createElement('div');
  aiDiv.className = 'chat-message ai';
  aiDiv.innerHTML = '<span class="chat-typing"><span></span><span></span><span></span></span>';
  msgEl.appendChild(aiDiv);
  msgEl.scrollTop = msgEl.scrollHeight;

  const messages = [
    { role: 'system', content: buildSystemPrompt(report) },
    ...chatHistory,
  ];

  chatStreaming = true;
  setChatBusy(true);
  try {
    const full = await streamChat(messages, (partial) => {
      aiDiv.innerHTML = typeof marked !== 'undefined' ? marked.parse(partial) : escHtml(partial);
      msgEl.scrollTop = msgEl.scrollHeight;
    });
    if (full && full.trim()) {
      chatHistory.push({ role: 'assistant', content: full });
      bumpQuota();   // 仅成功问答才计入今日额度
    } else {
      aiDiv.innerHTML = escHtml('（未返回内容，请重试）');
    }
  } catch (e) {
    chatHistory.pop();   // 失败的这轮不计入历史
    const msg = (e && e.message) ? e.message : String(e);
    const hint = /Failed to fetch|NetworkError/i.test(msg)
      ? '网络请求失败：请检查网络连接，或确认 API Key 是否正确（点右侧「设置 Key」）。'
      : escHtml(msg);
    aiDiv.innerHTML = '❌ ' + hint;
  } finally {
    chatStreaming = false;
    setChatBusy(false);
    msgEl.scrollTop = msgEl.scrollHeight;
  }
};

function appendMessage(role, text) {
  const msgEl = $('chatMessages');
  if (role === 'ai') {
    const rendered = typeof marked !== 'undefined' ? marked.parse(text) : escHtml(text);
    msgEl.insertAdjacentHTML('beforeend', rendered);
  } else {
    const div = document.createElement('div');
    div.className = 'chat-message user';
    div.innerHTML = escHtml(text).replace(/\n/g, '<br>');
    msgEl.appendChild(div);
  }
  msgEl.scrollTop = msgEl.scrollHeight;
}

function generateResponse(report, query) {
  const q = query.toLowerCase();
  const { summary, phs, actions, issues, taskType } = report;
  const p0 = actions.filter(a => a.priority === 'P0');
  const p1 = actions.filter(a => a.priority === 'P1');
  const p2 = actions.filter(a => a.priority === 'P2');

  if (/健康度|phs|得分|分数|评级/.test(q)) {
    const sub = phs.subItems.length
      ? '\n\n**子项：**\n' + phs.subItems.map(s => `- ${s.name}：${s.value === null ? 'N/A' : s.value + '%'}`).join('\n')
      : '';
    return `**性能健康度**\n\n当前 **${phs.current}/100（${phs.grade}）**，优化后预估 **${phs.estimated}/100（${phs.estGrade}）**，提升空间 ${phs.estimated - phs.current} 分。${sub}`;
  }

  if (/慢卡|哪张卡|最慢|rank.*慢|slowrank|负载.*均|均衡|不均/.test(q)) {
    const slowIssue = issues.find(i => /rank|慢卡|负载|均衡|slow/i.test(i.title));
    if (slowIssue) return `**慢卡 / 负载均衡分析**\n\n**${slowIssue.title}**\n\n${slowIssue.evidence}\n\n**影响**：${slowIssue.impact}\n\n**修复建议：**\n${slowIssue.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    const a = actions.find(a => /rank|慢卡|负载|均衡/i.test(a.problem));
    if (a) return `**慢卡分析**\n\n**[${a.priority}] ${a.problem}**\n预期收益：${a.benefit}\n📍 \`${a.location}\``;
  }

  if (/为什么.*npu|npu.*利用率|npu.*idle|host.*bound|空转|92|7\.36/.test(q)) {
    const npu = issues.find(i => /NPU|利用率|idle|host|空转/i.test(i.title + i.evidence));
    if (npu) return `**${npu.title}**\n\n${npu.evidence}\n\n**影响**：${npu.impact}\n\n**修复建议：**\n${npu.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
  }

  if (/瓶颈|bottleneck|主要问题|慢在哪|为什么慢/.test(q)) {
    const first = issues[0];
    return `**头号瓶颈**\n\n${summary.topBottleneck}\n\n**收益上限**：${summary.maxGain}${first ? `\n\n**首要问题（${first.priority}）：${first.title}**\n\n${first.evidence}` : ''}`;
  }

  if (/优先|先做|先修|紧急|p0/.test(q)) {
    if (!p0.length) return '当前报告暂无 P0 级别问题。';
    return `**P0 优先问题（共 ${p0.length} 个）**\n\n` +
      p0.map(a => `**${a.problem}**\n预期收益：${a.benefit} | 难度：${a.difficulty}\n📍 \`${a.location}\``).join('\n\n---\n\n');
  }

  if (/收益|提升多少|优化空间|能提升|节省/.test(q)) {
    const total = actions.reduce((s, a) => s + (a.benefitNum || 0), 0);
    const top = [...actions].sort((a, b) => (b.benefitNum || 0) - (a.benefitNum || 0))[0];
    return `**优化空间分析**\n\n收益上限：**${summary.maxGain}**\n\n有量化收益的改动合计约 **-${total.toFixed(0)}%** 耗时\n\n单项最大收益：**${top?.problem}**（${top?.benefit}）`;
  }

  if (/代码|怎么改|在哪改|修改位置|改法/.test(q)) {
    const locs = actions.filter(a => a.location?.length > 5).slice(0, 5);
    if (!locs.length) return '报告中暂无明确的代码位置标注。';
    return `**代码修改位置**\n\n` + locs.map(a => `**[${a.priority}] ${a.problem}**\n📍 \`${a.location}\``).join('\n\n');
  }

  if (/验证|verify|怎么确认|检查优化/.test(q)) {
    const withV = issues.filter(i => i.verification);
    if (!withV.length) return '报告中暂无验证方法信息。';
    return `**验证方法**\n\n` + withV.map(i => `**${i.id} ${i.title}**\n${i.verification}`).join('\n\n---\n\n');
  }

  if (/rollout|生成阶段|图模式|enforce_eager/.test(q)) {
    const rollout = issues.find(i => /rollout|生成|eager/i.test(i.title + i.evidence));
    if (rollout) return `**${rollout.title}**\n\n${rollout.evidence}\n\n**影响**：${rollout.impact}\n\n**修复建议：**\n${rollout.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
  }

  if (/训练.*阶段|update_actor|actor.*健康|训练.*正常/.test(q)) {
    const ok = report.noProblems.find(p => /训练|update_actor|actor/i.test(p));
    return ok
      ? `**训练阶段（update_actor）健康**\n\n${ok}\n\n训练阶段不是当前瓶颈，优先关注 Rollout 生成阶段的 P0 问题。`
      : `训练阶段信息未在"已确认无问题"中单独标注，建议查看总览摘要。`;
  }

  if (/double.?buffer/.test(q)) {
    const db = issues.find(i => /double.?buffer|BUFFER_NUM|流水/i.test(i.steps.join(' ') + i.evidence));
    if (db) return `**Double Buffer 相关**\n\n**${db.title}**\n\n${db.evidence}\n\n**修复建议：**\n${db.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    return '该报告未涉及 Double Buffer 优化。';
  }

  if (/最快能优化|最终能到|预估|目标/.test(q)) {
    return `**优化目标**\n\n${summary.maxGain}\n\n优化后预估性能健康度：**${phs.estimated}/100（${phs.estGrade}）**（当前 ${phs.current}/${phs.grade}）`;
  }

  if (/总结|overview|整体概况/.test(q)) {
    return `**${report.title} 总结**\n\n${summary.conclusion}\n\n**头号瓶颈**：${summary.topBottleneck}\n\n**收益上限**：${summary.maxGain}\n\n共 ${actions.length} 个优化项（P0: ${p0.length}，P1: ${p1.length}，P2: ${p2.length}）`;
  }

  return `基于当前报告《${report.title}》，我可以回答：\n\n- **性能瓶颈**：头号瓶颈分析\n- **优化优先级**：P0 紧急问题\n- **优化空间**：预期收益\n- **代码位置**：需要修改的代码\n- **验证方法**：如何确认优化效果\n- **健康度评分**：PHS 各子项\n\n请尝试上方的快捷问题，或直接提问。`;
}

// ============================================================
// Tab 6: 计算图 (Compute Graph — Qwen2-7B)
// ============================================================

const GRAPH_PROBLEMS = {
  'r20260618pp': {
    problemNodes: {
      'lm_head': {
        priority: 'P0', issueRef: '3.1',
        opType: 'MatMulV2 (lm_head/logits 投影 · 仅末级 stage3)',
        title: 'lm_head 投影只压在 PP 末级，制造 ~35% bubble',
        metric: 'MatMulV2 平均 16.0 ms/次 ×64 次 ≈ 1024 ms，仅出现在 stage3 的 rank6/7（rank0–5 完全没有）；末级计算 ~9.26 s vs 其余级 ~6.15 s（1.51×，多 ~3.11 s）',
        impact: 'stage0–2 每步在 P2P recv 上空等 communicationWaitStageTime ≈ 3.77 s（占 step ~35%）；全集群每步约 22.6 卡·秒空耗在 bubble（≈ 集群总算力时间 26%）',
        fix: [
          '非均匀 PP 切分：减少最后一级 decoder 层数（Megatron --decoder-last-pipeline-num-layers），让 stage3 计算从 ~9.26 s 降到 ~6.4 s',
          '或对输出投影/词表做 TP / vocab-parallel cross-entropy（当前 TP=1），把 logits GEMM 与 CE 拆到多卡',
        ],
        verify: '重采后 ClusterTimeSummary 中 stage3 计算与 stage0–2 极差 < 10%，communicationWaitStageTime 从 ~3.77 s 降到 < 1.5 s，单步 stepTime → ~7.5–8.0 s',
        codeHint: `# 非均匀 PP 切分抵消末级 lm_head+loss 开销（Megatron）
# --decoder-last-pipeline-num-layers <N-k>   # 差额 ~3.1s ≈ 0.5 层等效，按实测微调
# 或对 vocab 维做张量切分（当前 TP=1）：
# --tensor-model-parallel-size 2   # 配合 vocab-parallel cross-entropy`,
      },
      'output_logits': {
        priority: 'P0', issueRef: '3.1',
        opType: 'loss 相关 Vector 算子（仅末级 stage3，耗时为 stage0 ~1.6×）',
        title: '末级 loss 向量算子更重，叠加 lm_head 推高末级计算',
        metric: 'stage3 vector 算子耗时是 stage0 的 ~1.6×；与 lm_head MatMulV2 共同构成末级「多出来的 ~3.11 s」',
        impact: '与 lm_head 一起把 stage3 计算抬到 ~9.26 s，是 gating 路径；其余 6 卡因此空等',
        fix: [
          '采用 vocab-parallel cross-entropy（融合 + 多卡切分），消除末级单卡上的大向量算子链',
          '随 3.1 的 PP 负载均衡一并落地，使各 stage 总耗时拉平',
        ],
        verify: '重采后末级 vector 算子耗时与 stage0 同量级；stage3 计算降至与其余级极差 < 10%',
        codeHint: `# 末级 loss 向量算子链（softmax/log/gather 展开）走单卡，叠加在 lm_head 上
# 方案：vocab-parallel cross-entropy，按词表维切到多卡并融合
# Megatron: 确认 parallel_output=True 并启用 VocabParallelCrossEntropy`,
      },
    },
    defaultNode: 'lm_head',
  },
  'r20260526': {
    problemNodes: {
      'lm_head': {
        priority: 'P0', issueRef: '3.2',
        opType: 'MatMulV3 (MIX_AIC 路径)',
        title: 'LM Head 投影走非最优 Tiling',
        metric: '单次耗时 18.4 ms × 2（MIX_AIC），rank 2 反向期共 36.8 ms',
        impact: '反向期间额外 36.8 ms，占单步 4.5%；vocab 维度未对齐 32 导致触发 MIX_AIC 兜底路径，而非更快的纯 AI_CORE Cube',
        fix: [
          '检查 lm_head 的 vocab 维度是否为 32 的倍数（可用 --make-vocab-size-divisible-by 128）',
          '若 vocab 未对齐，padding 后重训或调整 tokenizer 配置',
          '若仍走 MIX_AIC，显式 cast 为 bfloat16 后传入 matmul 可强制走纯 AI_CORE Cube',
        ],
        verify: '重采后 kernel_details.csv 中不再有 > 5 ms 的 MatMulV3 实例',
        codeHint: `# 启动参数加入（Megatron 风格）：
# --make-vocab-size-divisible-by 128

# 等价 Python：
import math
vocab_size = math.ceil(vocab_size / 128) * 128
# Qwen2-7B 151936 → 151936（已是 128 的倍数）
# 可能是 padding 值未同步，需排查`,
      },
      'output_logits': {
        priority: 'P1', issueRef: '3.3',
        opType: 'Exp / Sub / RealDiv / ArgMaxWithValue (串行)',
        title: 'Cross-Entropy 链路 ~80 ms 串行无融合',
        metric: 'rank 2 中：Exp 16ms + Sub 15.8ms + RealDiv 15.7ms + Cast 20.7ms + ArgMaxWithValue 6.8ms + ReduceSum 6.9ms',
        impact: '占单步 ~10%；手写 softmax→log→gather 展开触发一串独立 Vector 算子，未使用 Ascend 融合路径',
        fix: [
          '替换为 F.cross_entropy(logits, labels)，torch_npu 路由到 aclnnSoftmaxCrossEntropyWithLogits（单次 fused）',
          '若用 Megatron，启用 VocabParallelCrossEntropy 并确认 parallel_output=True',
          'ArgMaxWithValue / ReduceSum（accuracy 指标）移到 eval_interval 条件内，非每步必算',
        ],
        verify: '重采后 op_statistic.csv (rank 2) 中 Exp/RealDiv 消失；rank 2 Computing 再减 ~30 ms',
        codeHint: `# 原写法（触发 Exp/Sub/RealDiv/ArgMaxWithValue 链路）：
log_probs = logits - logits.max(-1, keepdim=True).values
log_probs -= torch.log(torch.exp(log_probs).sum(-1, keepdim=True))
loss = -log_probs.gather(-1, labels.unsqueeze(-1)).squeeze(-1).mean()

# 修改后（fused 路径，消除全部 Vector 算子）：
import torch.nn.functional as F
loss = F.cross_entropy(logits, labels, ignore_index=pad_id)`,
      },
    },
    defaultNode: 'lm_head',
  },
  'r20260610': {
    problemNodes: {
      'lm_head': {
        priority: 'P0', issueRef: '3.1',
        opType: 'MatMulV3 (词表投影 fwd + dgrad · MIX_AIC，mte2 访存bound)',
        title: 'LM-head 词表投影 mte2 访存受限',
        metric: 'dgrad 4096,151936;151936,1024 单次 18.5 ms × 2（MIX_AIC）+ fwd 4096,1024;151936,1024 14.8 ms；advisor 判 mte2 bound',
        impact: '与下方未融合交叉熵合计末级独有 ~160 ms，是 PP 末级(400ms)比首级(231ms)多算 ~169 ms 的主体，直接放大级间 bubble（3.2）',
        fix: [
          '词表投影开 vocab parallel（按词表维切到 DP/TP），减小单卡 N 维与中间张量',
          'bf16 权重免 Cast，避免 311 MB 大权重重复读',
        ],
        verify: '重采后末级 computation 从 ~400 ms 降至接近首级（~250 ms 内）',
        codeHint: `# 词表投影 MatMulV3 fwd 4096,1024;151936,1024 / dgrad 4096,151936;151936,1024
# advisor: mte2 bound（卡在 HBM 搬运而非算力）
# 方案：vocab 维 TP 切分（当前 TP=1）
# --tensor-model-parallel-size 2`,
      },
      'output_logits': {
        priority: 'P0', issueRef: '3.1',
        opType: 'Cast / Exp / Sub / RealDiv / Mul / ReduceSum / ArgMax (vocab=151936 串行)',
        title: '未融合交叉熵：vocab=151936 上堆叠 ~160 ms 向量算子',
        metric: 'rank2/3 独有：Cast 24.0 + Exp 16.1 + Sub 15.7 + RealDiv 15.7 + Mul 14.6 + ReduceSum 6.9 + ArgMax 6.8 ms（均针对 4096,1,151936）',
        impact: 'advisor 把这批全判为 vec_mte2_mte3（访存）bound——每个 kernel 把 [4096,151936] 在 HBM 往返一遍；仅出现在 PP 末级，约占单步 20%',
        fix: [
          '用融合 / online-softmax 交叉熵替换手写 softmax+CE，避免一次性物化 [4096,151936] fp32 中间张量',
          '或按 chunk 计算 logits-loss；复核可省的 Cast',
        ],
        verify: '重采后 ComputeOpPerRankStatsByOpName 中末级 Exp/Sub/RealDiv/ArgMax 4096,1,151936 系列消失或合并',
        codeHint: `from megatron.core.tensor_parallel import vocab_parallel_cross_entropy
loss = vocab_parallel_cross_entropy(logits, labels)
# 消除 Cast→Exp→Sub→RealDiv→Mul→ReduceSum→ArgMax 访存bound 链路，省末级 ~160ms`,
      },
    },
    defaultNode: 'lm_head',
  },
};

// ─── Static Qwen-7B graph layout (fully expanded, no collapse) ───────────────
const QWEN7B_BASE_NODES = [
  { id: 'input_tokens',       label: 'Token IDs',               typeLabel: 'Input',      kind: 'tensor', x: 640, y: 70,   width: 170, height: 48,  colorKey: 'io:input'       },
  { id: 'token_embedding',    label: 'Embedding Lookup',        typeLabel: 'Embedding',  kind: 'op',     x: 640, y: 176,  width: 240, height: 56,  colorKey: 'sem:embedding'  },
  { id: 'rope_cache',         label: 'RoPE Cache',              typeLabel: 'State',      kind: 'tensor', x: 235, y: 495,  width: 188, height: 52,  colorKey: 'io:state'       },
  { id: 'kv_cache',           label: 'KV Cache',                typeLabel: 'State',      kind: 'tensor', x: 235, y: 595,  width: 176, height: 52,  colorKey: 'io:state'       },
  { id: 'attn_norm',          label: 'Attention RMSNorm',       typeLabel: 'RMSNorm',    kind: 'op',     x: 640, y: 286,  width: 230, height: 56,  colorKey: 'sem:norm'       },
  { id: 'qkv_linear',         label: 'QKV Linear',              typeLabel: 'Linear',     kind: 'op',     x: 640, y: 395,  width: 186, height: 54,  colorKey: 'sem:linear'     },
  { id: 'rotary_apply',       label: 'Apply RoPE',              typeLabel: 'RotaryEmb',  kind: 'op',     x: 640, y: 495,  width: 184, height: 54,  colorKey: 'sem:rope'       },
  { id: 'scaled_attention',   label: 'Scaled Attention',        typeLabel: 'Attention',  kind: 'op',     x: 640, y: 595,  width: 212, height: 54,  colorKey: 'sem:attention'  },
  { id: 'attn_output_linear', label: 'Attention Output Linear', typeLabel: 'Linear',     kind: 'op',     x: 640, y: 695,  width: 256, height: 54,  colorKey: 'sem:linear'     },
  { id: 'mlp_norm',           label: 'MLP RMSNorm',             typeLabel: 'RMSNorm',    kind: 'op',     x: 640, y: 800,  width: 198, height: 56,  colorKey: 'sem:norm'       },
  { id: 'mlp_gate_linear',    label: 'Gate Linear',             typeLabel: 'Linear',     kind: 'op',     x: 540, y: 909,  width: 176, height: 54,  colorKey: 'sem:linear'     },
  { id: 'mlp_up_linear',      label: 'Up Linear',               typeLabel: 'Linear',     kind: 'op',     x: 748, y: 909,  width: 158, height: 54,  colorKey: 'sem:linear'     },
  { id: 'silu_multiply',      label: 'SiLU Multiply',           typeLabel: 'Activation', kind: 'op',     x: 640, y: 1009, width: 196, height: 54,  colorKey: 'sem:activation' },
  { id: 'mlp_down_linear',    label: 'MLP Output Linear',       typeLabel: 'Linear',     kind: 'op',     x: 640, y: 1109, width: 224, height: 54,  colorKey: 'sem:linear'     },
  { id: 'final_norm',         label: 'Final RMSNorm',           typeLabel: 'RMSNorm',    kind: 'op',     x: 640, y: 1248, width: 196, height: 56,  colorKey: 'sem:norm'       },
  { id: 'lm_head',            label: 'LM Head Linear',          typeLabel: 'Linear',     kind: 'op',     x: 640, y: 1354, width: 210, height: 56,  colorKey: 'sem:linear'     },
  { id: 'output_logits',      label: 'Logits',                  typeLabel: 'Output',     kind: 'tensor', x: 640, y: 1452, width: 166, height: 48,  colorKey: 'io:output'      },
];

const QWEN7B_BASE_CLUSTERS = [
  { id: 'transformer-core', label: 'QWen Transformer',            colorKey: 'module:transformer',   x: 350, y: 102,  width: 578, height: 1208 },
  { id: 'decoder-stack',    label: 'Decoder Layer Template ×32',  colorKey: 'module:decoder-layer', x: 384, y: 212,  width: 511, height: 992  },
  { id: 'attention-block',  label: 'Self Attention',              colorKey: 'module:attention',     x: 478, y: 322,  width: 324, height: 434  },
  { id: 'mlp-block',        label: 'SwiGLU MLP',                 colorKey: 'module:mlp',           x: 418, y: 836,  width: 443, height: 334  },
];

const QWEN7B_BASE_EDGES = [
  { source: 'input_tokens',       target: 'token_embedding'      },
  { source: 'token_embedding',    target: 'attn_norm'            },
  { source: 'attn_norm',          target: 'qkv_linear'           },
  { source: 'qkv_linear',         target: 'rotary_apply'         },
  { source: 'rope_cache',         target: 'rotary_apply',        dashed: true },
  { source: 'rotary_apply',       target: 'scaled_attention'     },
  { source: 'kv_cache',           target: 'scaled_attention',    dashed: true },
  { source: 'scaled_attention',   target: 'attn_output_linear'   },
  { source: 'attn_output_linear', target: 'mlp_norm'             },
  { source: 'mlp_norm',           target: 'mlp_gate_linear'      },
  { source: 'mlp_norm',           target: 'mlp_up_linear'        },
  { source: 'mlp_gate_linear',    target: 'silu_multiply'        },
  { source: 'mlp_up_linear',      target: 'silu_multiply'        },
  { source: 'silu_multiply',      target: 'mlp_down_linear'      },
  { source: 'mlp_down_linear',    target: 'final_norm'           },
  { source: 'final_norm',         target: 'lm_head'              },
  { source: 'lm_head',            target: 'output_logits'        },
];

// ─── Per-node architecture background info (Qwen-7B) ─────────
const QWEN7B_NODE_INFO = {
  'input_tokens': {
    what: '模型的原始输入，每个元素是词表中的 token 整数 ID，由分词器（Tokenizer）对文本切分后生成。',
    idEn: 'input token IDs',
    clusters: [],
    inputs:  [{ from: '分词器 (Tokenizer)', desc: '文本切分后的 token ID 序列，shape [batch, seq_len]' }],
    outputs: [{ to: 'token_embedding', desc: '传入嵌入层做向量映射' }],
    sources: [{ text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' }],
  },
  'token_embedding': {
    what: '词嵌入层（Embedding Lookup）：将离散的 token ID 映射为连续的高维向量。Qwen-7B 词表大小 151,936，嵌入维度 4,096。权重与 LM Head 共享（tied weights）。',
    idEn: 'token embedding lookup table',
    clusters: ['QWen Transformer'],
    inputs:  [{ from: 'input_tokens', desc: 'token ID 序列 [batch, seq_len]' }],
    outputs: [{ to: 'attn_norm', desc: '嵌入向量序列 [batch, seq_len, 4096]，进入第一个 Decoder Block' }],
    params:  '词表大小 151,936 · 嵌入维度 4,096 · 参数量 ~622 M',
    sources: [
      { text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' },
      { text: 'Qwen2 HuggingFace 实现', url: 'https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2/modeling_qwen2.py' },
    ],
  },
  'rope_cache': {
    what: 'RoPE（旋转位置编码）预计算缓存：存储各序列位置的 cos/sin 旋转矩阵，在每个 Decoder Block 的 Apply RoPE 节点中使用。Qwen-7B 使用超大 RoPE base（1,000,000）以支持长上下文。',
    idEn: 'rotary position embedding cache (cos/sin tables)',
    clusters: [],
    inputs:  [{ from: '初始化阶段', desc: '根据最大序列长度和 RoPE base 1,000,000 预计算，形状 [max_seq_len, head_dim/2]' }],
    outputs: [{ to: 'rotary_apply', desc: 'cos/sin 旋转矩阵，所有 Decoder Block 共享同一缓存' }],
    params:  'RoPE base 1,000,000 · 每头旋转维度 head_dim/2 = 64',
    sources: [
      { text: 'RoPE 原论文 arXiv:2104.09864', url: 'https://arxiv.org/abs/2104.09864' },
      { text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' },
    ],
  },
  'kv_cache': {
    what: 'KV 缓存（Key-Value Cache）：推理时缓存历史 token 的 Key 和 Value 向量，避免每步重新计算，大幅降低推理延迟。训练阶段不使用此缓存。',
    idEn: 'key-value cache for inference',
    clusters: [],
    inputs:  [{ from: '上一解码步骤', desc: '历史 token 的 K/V 张量 [batch, past_len, kv_heads, head_dim]' }],
    outputs: [{ to: 'scaled_attention', desc: '拼接到当前 K/V 后一起参与注意力计算' }],
    sources: [{ text: 'Qwen GitHub 仓库', url: 'https://github.com/QwenLM/Qwen' }],
  },
  'attn_norm': {
    what: 'Attention 前的 RMSNorm（均方根归一化）。Pre-Norm 结构：先对隐藏状态归一化再进注意力层，比 Post-Norm 训练更稳定。无偏置，仅一组可学习缩放参数 γ。',
    idEn: 'attention pre-normalization (RMSNorm)',
    clusters: ['QWen Transformer', 'Decoder Layer ×32'],
    inputs:  [{ from: 'token_embedding（第一层）或上一 Block 的残差输出', desc: '隐藏状态 [batch, seq_len, 4096]' }],
    outputs: [{ to: 'qkv_linear', desc: '归一化后的隐藏状态 [batch, seq_len, 4096]（形状不变）' }],
    params:  '参数量 4,096（仅可学习缩放因子 γ，无偏置）',
    sources: [
      { text: 'RMSNorm 论文 arXiv:1910.07467', url: 'https://arxiv.org/abs/1910.07467' },
      { text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' },
    ],
  },
  'qkv_linear': {
    what: 'QKV 投影层：将归一化隐藏状态用三个独立线性层分别投影为 Query、Key、Value 向量。Qwen-7B 使用 GQA（分组查询注意力），Q 有 28 头，K/V 各 4 头，显著降低 KV 缓存显存。多卡 TP 中为 column-parallel，每卡持有权重的一列分片，AllGather 输入后本地 MatMul。',
    idEn: 'query-key-value linear projection (GQA)',
    clusters: ['QWen Transformer', 'Decoder Layer ×32', 'Self Attention'],
    inputs:  [{ from: 'attn_norm', desc: '归一化隐藏状态 [batch, seq_len, 4096]' }],
    outputs: [{ to: 'rotary_apply', desc: 'Q [batch, seq_len, 28×128]，K [batch, seq_len, 4×128]，V [batch, seq_len, 4×128]' }],
    params:  'Q 权重 4096×3584，K/V 权重各 4096×512；GQA 28Q / 4KV 头；head_dim 128',
    sources: [
      { text: 'GQA 论文 arXiv:2305.13245', url: 'https://arxiv.org/abs/2305.13245' },
      { text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' },
      { text: 'Megatron-LM TP arXiv:1909.08053', url: 'https://arxiv.org/abs/1909.08053' },
    ],
  },
  'rotary_apply': {
    what: '将 RoPE 旋转位置编码作用于 Q 和 K 向量，使每个 token 的注意力分数天然编码相对位置距离。V 向量不旋转。旋转通过复数乘法实现：将每对相邻维度视为复数分量，乘以对应位置角度的旋转因子。',
    idEn: 'apply rotary position embeddings to Q and K',
    clusters: ['QWen Transformer', 'Decoder Layer ×32', 'Self Attention'],
    inputs:  [
      { from: 'qkv_linear', desc: 'Q [batch, seq_len, 28×128]，K [batch, seq_len, 4×128]' },
      { from: 'rope_cache', desc: '各位置 cos/sin 旋转矩阵' },
    ],
    outputs: [{ to: 'scaled_attention', desc: '旋转后 Q/K（形状不变）及未变的 V，一起送入注意力' }],
    params:  'RoPE base 1,000,000 · 旋转维度 head_dim/2 = 64',
    sources: [
      { text: 'RoPE 原论文 arXiv:2104.09864', url: 'https://arxiv.org/abs/2104.09864' },
      { text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' },
    ],
  },
  'scaled_attention': {
    what: 'FlashAttention 缩放点积注意力（Scaled Dot-Product Attention）：对每个 Query 计算与所有 Key 的相似度（除以 √head_dim 缩放），经 softmax 后加权求和 Value，得到上下文感知的表征。使用 FlashAttention IO 感知算法，将注意力矩阵分块计算，避免具象化 seq²×heads 的完整注意力矩阵，大幅降低显存峰值。',
    idEn: 'scaled dot-product attention with FlashAttention',
    clusters: ['QWen Transformer', 'Decoder Layer ×32', 'Self Attention'],
    inputs:  [
      { from: 'rotary_apply', desc: '旋转后 Q/K，以及 V；shape [batch, seq_len, heads, 128]' },
      { from: 'kv_cache（推理时）', desc: '历史 K/V 拼接到当前序列' },
    ],
    outputs: [{ to: 'attn_output_linear', desc: '注意力上下文向量 [batch, seq_len, 28×128=3584]' }],
    params:  'GQA 28Q / 4KV 头 · head_dim 128 · 缩放因子 1/√128 ≈ 0.0884',
    sources: [
      { text: 'FlashAttention-2 arXiv:2307.08691', url: 'https://arxiv.org/abs/2307.08691' },
      { text: 'GQA 论文 arXiv:2305.13245', url: 'https://arxiv.org/abs/2305.13245' },
      { text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' },
    ],
  },
  'attn_output_linear': {
    what: 'Attention 输出投影（O-proj）：将多头注意力拼接后的结果线性映射回隐藏维度 4,096，然后与残差相加完成 Attention 子层。多卡 TP 中为 row-parallel：每卡持有权重的行分片，本地 MatMul 后 ReduceScatter 合并，Ascend 将两步融合为 MatmulReduceScatterAicpu 算子。',
    idEn: 'attention output projection (O-proj), row-parallel in TP',
    clusters: ['QWen Transformer', 'Decoder Layer ×32', 'Self Attention'],
    inputs:  [{ from: 'scaled_attention', desc: '多头拼接上下文向量 [batch, seq_len, 3584]' }],
    outputs: [{ to: 'mlp_norm（经残差相加）', desc: '投影输出 [batch, seq_len, 4096]，+ 残差 → 送入 MLP RMSNorm' }],
    params:  '权重矩阵 3584×4096',
    sources: [
      { text: 'Megatron-LM TP arXiv:1909.08053', url: 'https://arxiv.org/abs/1909.08053' },
      { text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' },
    ],
  },
  'mlp_norm': {
    what: 'MLP（FFN）前的 RMSNorm。结构与 attn_norm 完全相同，但作用对象是 Attention 子层 + 残差之后的隐藏状态，为 SwiGLU FFN 做输入归一化。',
    idEn: 'MLP / FFN input pre-normalization (RMSNorm)',
    clusters: ['QWen Transformer', 'Decoder Layer ×32'],
    inputs:  [{ from: 'attn_output_linear + 残差', desc: '经注意力子层残差相加后的隐藏状态 [batch, seq_len, 4096]' }],
    outputs: [{ to: 'mlp_gate_linear / mlp_up_linear', desc: '归一化隐藏状态 [batch, seq_len, 4096]，同时分发到 Gate 和 Up 两个分支' }],
    params:  '参数量 4,096（γ，无偏置）',
    sources: [
      { text: 'RMSNorm 论文 arXiv:1910.07467', url: 'https://arxiv.org/abs/1910.07467' },
      { text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' },
    ],
  },
  'mlp_gate_linear': {
    what: 'SwiGLU 门控分支（gate_proj）：将隐藏状态投影到中间维度，经 SiLU 激活后与 Up 分支做逐元素相乘，实现门控机制。多卡 TP 中为 column-parallel，Ascend 将 AllGather + MatMul 融合为 AllGatherMatmulAicpu 算子。',
    idEn: 'SwiGLU gate projection (column-parallel in TP)',
    clusters: ['QWen Transformer', 'Decoder Layer ×32', 'SwiGLU MLP'],
    inputs:  [{ from: 'mlp_norm', desc: '归一化隐藏状态 [batch, seq_len, 4096]' }],
    outputs: [{ to: 'silu_multiply', desc: '门控值 [batch, seq_len, 18944]，经 SiLU 激活后与 up_proj 相乘' }],
    params:  '权重矩阵 4096×18944（中间维度 18,944）',
    sources: [
      { text: 'SwiGLU 论文 arXiv:2002.05202', url: 'https://arxiv.org/abs/2002.05202' },
      { text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' },
      { text: 'Megatron-LM TP arXiv:1909.08053', url: 'https://arxiv.org/abs/1909.08053' },
    ],
  },
  'mlp_up_linear': {
    what: 'SwiGLU 上投影分支（up_proj）：将隐藏状态投影到中间维度，作为门控的被乘数。与 gate_proj 并行计算，两者维度完全相同，最终做逐元素乘积（Hadamard 积）。多卡 TP 中为 column-parallel。',
    idEn: 'SwiGLU up projection (column-parallel in TP)',
    clusters: ['QWen Transformer', 'Decoder Layer ×32', 'SwiGLU MLP'],
    inputs:  [{ from: 'mlp_norm', desc: '归一化隐藏状态 [batch, seq_len, 4096]（与 gate_proj 共享同一输入）' }],
    outputs: [{ to: 'silu_multiply', desc: '上投影值 [batch, seq_len, 18944]，直接与 SiLU(gate) 做逐元素相乘' }],
    params:  '权重矩阵 4096×18944（中间维度 18,944）',
    sources: [
      { text: 'SwiGLU 论文 arXiv:2002.05202', url: 'https://arxiv.org/abs/2002.05202' },
      { text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' },
    ],
  },
  'silu_multiply': {
    what: 'SwiGLU 激活与门控相乘：对 gate_proj 输出施加 SiLU(x) = x·σ(x) 激活，再与 up_proj 输出逐元素相乘，即 SwiGLU = SiLU(gate) ⊗ up。这是 Qwen 替代 ReLU/GELU 的核心激活，在保持较低参数量的同时提升表达能力。',
    idEn: 'SiLU activation and element-wise multiply (SwiGLU gate)',
    clusters: ['QWen Transformer', 'Decoder Layer ×32', 'SwiGLU MLP'],
    inputs:  [
      { from: 'mlp_gate_linear', desc: '门控值 [batch, seq_len, 18944]（经 SiLU 激活）' },
      { from: 'mlp_up_linear', desc: '上投影值 [batch, seq_len, 18944]（直接参与相乘）' },
    ],
    outputs: [{ to: 'mlp_down_linear', desc: '门控后中间表征 [batch, seq_len, 18944]' }],
    sources: [
      { text: 'SwiGLU 论文 arXiv:2002.05202', url: 'https://arxiv.org/abs/2002.05202' },
      { text: 'GLU 变体综述 arXiv:2002.05202', url: 'https://arxiv.org/abs/2002.05202' },
    ],
  },
  'mlp_down_linear': {
    what: 'MLP 下投影（down_proj / output projection）：将 SwiGLU 门控后的中间表征从 18,944 维压缩回模型隐藏维度 4,096，然后与残差相加完成整个 Decoder Block 的 FFN 子层。多卡 TP 中为 row-parallel，Ascend 将 MatMul + ReduceScatter 融合为 MatmulReduceScatterAicpu 算子。',
    idEn: 'SwiGLU down projection / MLP output (row-parallel in TP)',
    clusters: ['QWen Transformer', 'Decoder Layer ×32', 'SwiGLU MLP'],
    inputs:  [{ from: 'silu_multiply', desc: '门控中间表征 [batch, seq_len, 18944]' }],
    outputs: [{ to: 'attn_norm（下一 Block）或 final_norm（最后 Block）', desc: '下投影输出 [batch, seq_len, 4096]，+ 残差 → 下一子层' }],
    params:  '权重矩阵 18944×4096',
    sources: [
      { text: 'Megatron-LM TP arXiv:1909.08053', url: 'https://arxiv.org/abs/1909.08053' },
      { text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' },
    ],
  },
  'final_norm': {
    what: '最终 RMSNorm：在全部 32 个 Decoder Block 处理完毕后，对最终隐藏状态归一化，再送入语言模型头（LM Head）。确保输出向量的尺度稳定，利于 LM Head 的线性投影。',
    idEn: 'final (post-transformer) RMSNorm before LM Head',
    clusters: ['QWen Transformer'],
    inputs:  [{ from: 'mlp_down_linear（第 32 层）+ 残差', desc: '最后 Decoder Block 的隐藏状态 [batch, seq_len, 4096]' }],
    outputs: [{ to: 'lm_head', desc: '归一化隐藏状态 [batch, seq_len, 4096]' }],
    params:  '参数量 4,096（γ，无偏置）',
    sources: [{ text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' }],
  },
  'lm_head': {
    what: '语言模型头（Language Model Head）：将最终隐藏状态用线性层投影到词表大小，得到每个位置下一 token 的原始分数（logits）。权重与 token_embedding 共享（tied weights），节省约 622 M 参数。训练时 logits 送入 Cross-Entropy；推理时经 softmax 后采样。',
    idEn: 'language model head — final linear projection to vocabulary',
    clusters: [],
    inputs:  [{ from: 'final_norm', desc: '最终归一化隐藏状态 [batch, seq_len, 4096]' }],
    outputs: [{ to: 'output_logits', desc: 'Logits [batch, seq_len, 151936]，覆盖整个词表' }],
    params:  '权重矩阵 4096×151936（与 token_embedding 共享）',
    sources: [{ text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' }],
  },
  'output_logits': {
    what: '模型最终输出的 token logits（原始分数）。训练时对最后一个 token 位置取 Cross-Entropy 损失（预测下一词）；推理时对全序列末位经 softmax → 采样/贪心解码得到下一 token，再 append 到序列继续生成。',
    idEn: 'output token logits — raw scores over vocabulary',
    clusters: [],
    inputs:  [{ from: 'lm_head', desc: '原始分数 [batch, seq_len, 151936]' }],
    outputs: [{ to: '损失函数（训练）/ 采样解码（推理）', desc: 'softmax → token 概率分布，训练时计算 CE Loss，推理时返回下一 token' }],
    sources: [{ text: 'Qwen 技术报告 arXiv:2309.16609', url: 'https://arxiv.org/abs/2309.16609' }],
  },
};

// ─── Cluster membership (for collapse/expand) ────────────────
const QWEN7B_CLUSTER_CHILDREN = {
  'attention-block':  ['qkv_linear', 'rotary_apply', 'scaled_attention', 'attn_output_linear'],
  'mlp-block':        ['mlp_gate_linear', 'mlp_up_linear', 'silu_multiply', 'mlp_down_linear'],
  'decoder-stack':    ['attn_norm', 'mlp_norm', 'attention-block', 'mlp-block'],
  'transformer-core': ['token_embedding', 'decoder-stack', 'final_norm'],
};
function getAllClusterNodes(cid) {
  return (QWEN7B_CLUSTER_CHILDREN[cid] || []).flatMap(c =>
    QWEN7B_CLUSTER_CHILDREN[c] ? getAllClusterNodes(c) : [c]
  );
}
function getAllSubClusters(cid) {
  return (QWEN7B_CLUSTER_CHILDREN[cid] || []).flatMap(c =>
    QWEN7B_CLUSTER_CHILDREN[c] ? [c, ...getAllSubClusters(c)] : []
  );
}

// ─── Graph tab state ──────────────────────────────────────────
const graphTabState = {
  zoom: 1, tx: 0, ty: 0,
  svg: null, pan: null,
  suppressClick: false,
  selectedNodeId: null,
  problems: null,
  collapsedClusters: new Set(),
};

function buildQwenGraphData(problems) {
  const nodes = QWEN7B_BASE_NODES.map(n => {
    const node = { ...n };
    if (problems && problems[n.id]) {
      node.reportPriority = problems[n.id].priority;
    }
    return node;
  });
  return {
    width: 1280,
    height: 1540,
    clusters: QWEN7B_BASE_CLUSTERS.map(c => ({ ...c })),
    nodes,
    edges: QWEN7B_BASE_EDGES.map(e => ({ ...e })),
  };
}

function computeGraphFitZoom() {
  const stage = $('graphTabStage');
  if (!stage) return 1;
  const w = Math.max(400, stage.clientWidth - 48);
  const h = Math.max(400, stage.clientHeight - 48);
  return Math.min(1.0, Math.min(w / 1280, h / 1540));
}

function applyGraphTransform() {
  const svg = graphTabState.svg;
  if (!svg) return;
  svg.style.width  = '1280px';
  svg.style.height = '1540px';
  svg.style.transform = `translate(${graphTabState.tx}px, ${graphTabState.ty}px) scale(${graphTabState.zoom})`;
}

function graphCenterView() {
  const stage = $('graphTabStage');
  if (!stage) return;
  graphTabState.tx = Math.max(8, (stage.clientWidth  - 1280 * graphTabState.zoom) / 2);
  graphTabState.ty = Math.max(8, (stage.clientHeight - 1540 * graphTabState.zoom) / 2);
  applyGraphTransform();
}

/* 左侧「整网图」面板开合会改变 stage 宽度，index_v3 的面板逻辑调用此钩子重新适配 */
window.msnextRefitGraph = function () {
  if (!graphTabState.svg) return;
  graphTabState.zoom = computeGraphFitZoom();
  graphCenterView();
};

function updateClusterVisibility(graphData) {
  const stage = $('graphTabStage');
  if (!stage) return;
  const collapsed = graphTabState.collapsedClusters;
  const hiddenNodeIds    = new Set();
  const hiddenClusterIds = new Set();
  collapsed.forEach(cid => {
    getAllClusterNodes(cid).forEach(nid => hiddenNodeIds.add(nid));
    getAllSubClusters(cid).forEach(sid => hiddenClusterIds.add(sid));
  });
  stage.querySelectorAll('.pto-model-graphviz-node').forEach((el, i) => {
    const node = graphData.nodes[i];
    if (node) el.style.display = hiddenNodeIds.has(node.id) ? 'none' : '';
  });
  stage.querySelectorAll('.pto-model-graphviz-edge').forEach((el, i) => {
    const edge = graphData.edges[i];
    if (edge) el.style.display =
      (hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target)) ? 'none' : '';
  });
  stage.querySelectorAll('.pto-model-graphviz-cluster').forEach((el, i) => {
    const cluster = graphData.clusters[i];
    if (cluster) el.style.display = hiddenClusterIds.has(cluster.id) ? 'none' : '';
  });
}

function syncGraphSelection() {
  const stage = $('graphTabStage');
  if (!stage) return;
  stage.querySelectorAll('.pto-model-graphviz-node').forEach(g => {
    g.classList.toggle('is-graph-selected', g.dataset.nodeId === graphTabState.selectedNodeId);
  });
}

function renderNodeInfoHTML(nodeId) {
  const info = QWEN7B_NODE_INFO[nodeId];
  if (!info) return '';

  const clusterPath = (info.clusters || []).map((c, i) =>
    (i > 0 ? '<span class="gd-cluster-sep">›</span>' : '') +
    `<span class="gd-cluster-chip${i === info.clusters.length - 1 ? ' leaf' : ''}">${c}</span>`
  ).join('');

  const ioHtml = [
    ...(info.inputs  || []).map(x => `<div class="gd-io-item"><span class="gd-io-dir in">输入</span><div class="gd-io-desc"><span class="gd-io-from">${x.from}</span>${x.desc}</div></div>`),
    ...(info.outputs || []).map(x => `<div class="gd-io-item"><span class="gd-io-dir out">输出</span><div class="gd-io-desc"><span class="gd-io-from">${x.to}</span>${x.desc}</div></div>`),
  ].join('');

  const paramsRow = info.params
    ? `<div class="gd-info-section"><div class="gd-info-label-sm">关键参数</div><div class="gd-params-text">${info.params}</div></div>`
    : '';

  const srcHtml = (info.sources || []).map(s =>
    `<a class="gd-source-ref" href="${s.url}" target="_blank" rel="noopener">↗ ${s.text}</a>`
  ).join('');

  return `<div class="gd-node-info">
    ${clusterPath ? `<div class="gd-cluster-path">${clusterPath}</div>` : ''}
    <div class="gd-info-card">
      <div class="gd-info-section">
        <div class="gd-info-label-sm">是什么</div>
        <div class="gd-info-text">${info.what}</div>
        <div class="gd-info-text" style="margin-top:4px;"><span class="gd-id-badge">${nodeId}</span>&nbsp;= ${info.idEn}</div>
      </div>
      <div class="gd-info-section">
        <div class="gd-info-label-sm">数据流（输入 → 输出）</div>
        <div class="gd-io-list">${ioHtml}</div>
      </div>
      ${paramsRow}
      <div class="gd-info-section" style="border-bottom:none;">
        <div class="gd-info-label-sm">信息来源</div>
        <div class="gd-source-refs">${srcHtml}</div>
      </div>
    </div>
  </div>`;
}

function renderGraphNodeDetail(nodeId) {
  const nameplate = $('graphNodeNameplate');
  const body = $('graphDetailBody');
  if (!body) return;

  const nodeMeta = QWEN7B_BASE_NODES.find(n => n.id === nodeId);
  if (nameplate) {
    nameplate.innerHTML = nodeMeta ? `
      <div class="gd-nameplate-id">${nodeId}</div>
      <div class="gd-nameplate-title">${nodeMeta.label || nodeId}</div>
      <div class="gd-nameplate-type">${nodeMeta.typeLabel || ''}</div>` : '';
  }

  const probs    = graphTabState.problems;
  const hasProb  = probs && probs[nodeId];
  const infoHTML = renderNodeInfoHTML(nodeId);

  if (!hasProb) {
    body.innerHTML = infoHTML || `
      <div class="gd-empty">
        <div class="gd-empty-icon">⬅</div>
        <div class="gd-empty-text">点击左侧标红的算子节点，查看问题详情与修复方案</div>
      </div>`;
    return;
  }

  const p = probs[nodeId];
  const pClass  = (p.priority || 'P1').toLowerCase();
  const escHint = (p.codeHint || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  body.innerHTML = `
    <div class="gd-card">
      <div class="gd-card-header">
        <span class="gd-priority-badge ${pClass}">${p.priority}</span>
        <div class="gd-node-title-block">
          <div class="gd-node-id">${nodeId} · issue ${p.issueRef}</div>
          <div class="gd-node-title">${p.title}</div>
          <div class="gd-op-type">${p.opType || ''}</div>
        </div>
      </div>
      <div class="gd-section">
        <div class="gd-section-label">指标</div>
        <div class="gd-metric">${p.metric || ''}</div>
      </div>
      <div class="gd-section">
        <div class="gd-section-label">影响</div>
        <div class="gd-impact">${p.impact || ''}</div>
      </div>
      <div class="gd-section">
        <div class="gd-section-label">修复步骤</div>
        <ul class="gd-fix-list">${(p.fix || []).map(s => `<li>${s}</li>`).join('')}</ul>
      </div>
      <div class="gd-section">
        <div class="gd-section-label">验证方法</div>
        <div class="gd-verify">${p.verify || ''}</div>
      </div>
      ${escHint ? `<div class="gd-section">
        <div class="gd-section-label">代码示例</div>
        <div class="gd-code">${escHint}</div>
      </div>` : ''}
    </div>
    ${infoHTML ? `<div class="gd-info-divider-row">算子背景</div>${infoHTML}` : ''}`;
}

function renderGraph(report) {
  // Pangu 2.0 flash 报告：整网图面板切到 openPangu model-graphviz 组件（#opvHost），
  // 和下面 Qwen2-7B 计算图（#graphTabStage/#graphMapBtn）互斥，两者共用同一个「整网图」面板。
  const opvHost = $('opvHost');
  const isPangu = report?.id === 'r20260715pangu';
  if (opvHost) opvHost.hidden = !isPangu;
  const stage = $('graphTabStage');
  const mapBtn = $('graphMapBtn');
  if (stage) stage.hidden = isPangu;
  if (mapBtn) mapBtn.hidden = isPangu;

  if (isPangu) return;

  const detail = $('graphTabDetail');
  if (!stage || !detail) return;

  const hint = $('graphZoomHint');

  const probEntry = GRAPH_PROBLEMS[report?.id];
  const problems  = probEntry?.problemNodes || null;

  // Non-Qwen reports: show placeholder
  if (!probEntry) {
    stage.innerHTML = '';
    if (hint) stage.appendChild(hint);
    stage.insertAdjacentHTML('beforeend', `
      <div class="gd-no-graph" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;">
        <div class="gd-no-graph-icon">🔗</div>
        <div class="gd-no-graph-title">此报告无关联计算图</div>
        <div class="gd-no-graph-sub">计算图仅对 Qwen2-7B 多卡训练 Profiling 分析报告可用（Level2 4卡 / 集群 16卡）</div>
      </div>`);
    const _np = $('graphNodeNameplate'); if (_np) _np.innerHTML = '';
    ($('graphDetailBody') || detail).innerHTML = `
      <div class="gd-empty">
        <div class="gd-empty-icon">📊</div>
        <div class="gd-empty-text">请在左侧选择 Qwen2-7B 相关分析记录</div>
      </div>`;
    graphTabState.svg = null;
    graphTabState.problems = null;
    return;
  }

  graphTabState.problems = problems;

  const graphData = buildQwenGraphData(problems);

  if (!window.PtoModelGraphvizPattern) {
    stage.innerHTML = '<div style="padding:24px;color:#b42318;font-size:12px;">pattern.js 未加载，请检查脚本引用</div>';
    return;
  }

  const svgEl = window.PtoModelGraphvizPattern.render(stage, graphData, {
    ariaLabel: 'Qwen2-7B 模型计算图',
    width: 1280,
    height: 1540,
  });
  graphTabState.svg = svgEl;

  if (hint && !stage.contains(hint)) stage.appendChild(hint);

  // Wire node click handlers
  const defaultNodeId = probEntry.defaultNode;
  graphTabState.selectedNodeId = defaultNodeId;

  stage.querySelectorAll('.pto-model-graphviz-node').forEach((g, i) => {
    const node = graphData.nodes[i];
    if (!node) return;
    g.dataset.nodeId = node.id;
    if (problems && problems[node.id]) {
      g.classList.add('is-problem');
      g.classList.add(`is-problem-${(problems[node.id].priority || 'P1').toLowerCase()}`);
      g.style.cursor = 'pointer';
    }
    g.addEventListener('click', () => {
      if (graphTabState.suppressClick) { graphTabState.suppressClick = false; return; }
      graphTabState.selectedNodeId = node.id;
      syncGraphSelection();
      renderGraphNodeDetail(node.id);
    });
  });

  // Wire cluster collapse/expand toggles
  graphTabState.collapsedClusters = new Set();
  stage.querySelectorAll('.pto-model-graphviz-cluster').forEach((g, i) => {
    const cluster = graphData.clusters[i];
    if (!cluster || !QWEN7B_CLUSTER_CHILDREN[cluster.id]) return;
    const toggleEl = g.querySelector('.pto-model-graphviz-toggle');
    const iconEl   = g.querySelector('.pto-model-graphviz-toggle-icon');
    if (!toggleEl) return;
    toggleEl.addEventListener('click', e => {
      e.stopPropagation();
      const isCollapsed = graphTabState.collapsedClusters.has(cluster.id);
      if (isCollapsed) {
        graphTabState.collapsedClusters.delete(cluster.id);
        if (iconEl) iconEl.textContent = '-';
      } else {
        graphTabState.collapsedClusters.add(cluster.id);
        if (iconEl) iconEl.textContent = '+';
      }
      updateClusterVisibility(graphData);
    });
  });

  // Fit and center
  graphTabState.zoom = computeGraphFitZoom();
  graphCenterView();
  syncGraphSelection();

  // Show detail for default node
  renderGraphNodeDetail(defaultNodeId);

  // Legend
  if (problems && Object.keys(problems).length) {
    const legendItems = [...new Set(Object.values(problems).map(p => p.priority))].sort();
    const legendColors = { P0: '#e0134e', P1: '#d97700', P2: '#b89000' };
    const legendHTML = legendItems.map(p =>
      `<div class="gd-legend-item"><div class="gd-legend-dot" style="background:${legendColors[p]||'#ccc'}"></div>${p} 问题算子</div>`
    ).join('');
    ($('graphDetailBody') || detail).insertAdjacentHTML('beforeend', `
      <div class="gd-card gd-legend">
        <div class="gd-legend-title">图例</div>
        ${legendHTML}
        <div class="gd-legend-item" style="margin-top:2px;font-size:10px;color:var(--fg-muted)">点击标红节点查看详细诊断</div>
      </div>`);
  }
}

function setupGraphTabPanZoom() {
  const stage = $('graphTabStage');
  if (!stage) return;

  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const z0 = graphTabState.zoom;
    const z1 = Math.max(0.15, Math.min(3.0, z0 * factor));
    graphTabState.tx = px - (px - graphTabState.tx) * (z1 / z0);
    graphTabState.ty = py - (py - graphTabState.ty) * (z1 / z0);
    graphTabState.zoom = z1;
    applyGraphTransform();
  }, { passive: false });

  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.pto-model-graphviz-node, .pto-model-graphviz-toggle')) return;
    graphTabState.suppressClick = false;
    graphTabState.pan = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, tx: graphTabState.tx, ty: graphTabState.ty, moved: false };
  });

  stage.addEventListener('pointermove', e => {
    if (!graphTabState.pan || graphTabState.pan.pointerId !== e.pointerId) return;
    const dx = e.clientX - graphTabState.pan.x;
    const dy = e.clientY - graphTabState.pan.y;
    if (!graphTabState.pan.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      graphTabState.pan.moved = true;
      stage.classList.add('is-panning');
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    }
    graphTabState.tx = graphTabState.pan.tx + dx;
    graphTabState.ty = graphTabState.pan.ty + dy;
    applyGraphTransform();
    e.preventDefault();
  });

  const endPan = e => {
    if (!graphTabState.pan || graphTabState.pan.pointerId !== e.pointerId) return;
    if (graphTabState.pan.moved) graphTabState.suppressClick = true;
    graphTabState.pan = null;
    stage.classList.remove('is-panning');
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  };
  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);
  stage.addEventListener('lostpointercapture', endPan);

  // Ctrl+0 reset zoom
  window.addEventListener('keydown', e => {
    const activeTab = document.querySelector('.v2-center-tab.active');
    if (!activeTab || activeTab.dataset.tab !== 'graph') return;
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      graphTabState.zoom = computeGraphFitZoom();
      graphCenterView();
    }
  });
}

init();

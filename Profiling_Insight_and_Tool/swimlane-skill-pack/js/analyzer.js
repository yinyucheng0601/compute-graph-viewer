/**
 * analyzer.js - 算子性能分析模块
 * 从泳道图数据中提取性能指标并识别瓶颈
 */

'use strict';

/**
 * 主分析入口
 * @param {Object} parsedData - parser.js 返回的解析数据
 * @returns {Object} 分析结果
 */
function analyzePerformance(parsedData) {
  const { coreEvents, timeRange, colorMap } = parsedData;

  // 1. 计算每个核心的性能指标
  const coreMetrics = computeCoreMetrics(coreEvents, timeRange);

  // 2. 计算汇总指标
  const summaryMetrics = computeSummaryMetrics(coreMetrics, timeRange);

  // 3. 分析操作类型分布
  const opDistribution = analyzeOperationDistribution(parsedData.execEvents);

  // 4. 检测性能瓶颈
  const bottlenecks = detectBottlenecks(coreMetrics, summaryMetrics, opDistribution);

  // 5. 生成优化建议
  const recommendations = generateRecommendations(bottlenecks, summaryMetrics);

  // 6. 计算综合评分
  const rating = computeOverallRating(summaryMetrics);

  return {
    coreMetrics,
    summaryMetrics,
    opDistribution,
    bottlenecks,
    recommendations,
    rating,
  };
}

/**
 * 计算每个核心的性能指标
 */
function computeCoreMetrics(coreEvents, globalTimeRange) {
  const metrics = new Map();

  coreEvents.forEach((events, coreName) => {
    if (events.length === 0) return;

    // 时间范围 (使用全局起止时间)
    const spanStart = globalTimeRange.start;
    const spanEnd = globalTimeRange.end;
    const totalSpan = spanEnd - spanStart;

    // 活跃时间 (任务持续时间总和)
    let totalActiveTime = 0;
    events.forEach(e => { totalActiveTime += (e.dur || 0); });

    // 空闲时间 (总跨度 - 活跃时间)
    const idleTime = Math.max(0, totalSpan - totalActiveTime);

    // 核心利用率
    const utilization = totalSpan > 0 ? (totalActiveTime / totalSpan) * 100 : 0;

    // 计算 gap (任务间的空隙, 即气泡)
    const gaps = computeGaps(events);
    const totalGapTime = gaps.reduce((sum, g) => sum + g.duration, 0);
    const bubbleRate = totalActiveTime + totalGapTime > 0
      ? (totalGapTime / (totalActiveTime + totalGapTime)) * 100
      : 0;

    // 任务持续时间统计
    const durations = events.map(e => e.dur || 0);
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const maxDuration = Math.max(...durations);
    const minDuration = Math.min(...durations);
    const stdDuration = computeStdDev(durations);

    // 操作类型分布
    const opBreakdown = {};
    events.forEach(e => {
      const op = getEventOpType(e);
      if (!opBreakdown[op]) opBreakdown[op] = { count: 0, totalDuration: 0 };
      opBreakdown[op].count++;
      opBreakdown[op].totalDuration += (e.dur || 0);
    });

    // 核心类型
    const coreType = getCoreType(coreName);

    metrics.set(coreName, {
      coreName,
      coreType,
      taskCount: events.length,
      totalSpan,
      totalActiveTime,
      idleTime,
      utilization,
      totalGapTime,
      bubbleRate,
      gaps,
      avgDuration,
      maxDuration,
      minDuration,
      stdDuration,
      opBreakdown,
      events, // 保留原始事件引用
    });
  });

  return metrics;
}

/**
 * 计算任务间的 gap (空隙)
 */
function computeGaps(events) {
  if (events.length < 2) return [];
  const gaps = [];
  for (let i = 0; i < events.length - 1; i++) {
    const end = events[i].ts + (events[i].dur || 0);
    const nextStart = events[i + 1].ts;
    const gapDur = nextStart - end;
    if (gapDur > 0.01) { // 忽略极小的浮点误差
      gaps.push({
        start: end,
        end: nextStart,
        duration: gapDur,
        afterEventIndex: i,
      });
    }
  }
  return gaps;
}

/**
 * 计算汇总性能指标
 */
function computeSummaryMetrics(coreMetrics, timeRange) {
  const aicMetrics = [];
  const aivMetrics = [];

  coreMetrics.forEach(m => {
    if (m.coreType === 'AIC') aicMetrics.push(m);
    else if (m.coreType === 'AIV') aivMetrics.push(m);
  });

  const allMetrics = [...aicMetrics, ...aivMetrics];

  // 平均核心利用率
  const avgUtilization = allMetrics.length > 0
    ? allMetrics.reduce((s, m) => s + m.utilization, 0) / allMetrics.length : 0;
  const avgAicUtilization = aicMetrics.length > 0
    ? aicMetrics.reduce((s, m) => s + m.utilization, 0) / aicMetrics.length : 0;
  const avgAivUtilization = aivMetrics.length > 0
    ? aivMetrics.reduce((s, m) => s + m.utilization, 0) / aivMetrics.length : 0;

  // 平均气泡率
  const avgBubbleRate = allMetrics.length > 0
    ? allMetrics.reduce((s, m) => s + m.bubbleRate, 0) / allMetrics.length : 0;
  const avgAicBubbleRate = aicMetrics.length > 0
    ? aicMetrics.reduce((s, m) => s + m.bubbleRate, 0) / aicMetrics.length : 0;
  const avgAivBubbleRate = aivMetrics.length > 0
    ? aivMetrics.reduce((s, m) => s + m.bubbleRate, 0) / aivMetrics.length : 0;

  // AIC 负载均衡 (基于活跃时间的变异系数)
  const aicActiveTimes = aicMetrics.map(m => m.totalActiveTime);
  const aicLoadBalance = computeLoadBalance(aicActiveTimes);

  // AIV 负载均衡
  const aivActiveTimes = aivMetrics.map(m => m.totalActiveTime);
  const aivLoadBalance = computeLoadBalance(aivActiveTimes);

  // 总体负载均衡
  const allActiveTimes = allMetrics.map(m => m.totalActiveTime);
  const overallLoadBalance = computeLoadBalance(allActiveTimes);

  // 总执行时间
  const totalExecutionTime = timeRange.duration;

  // 最大/最小利用率
  const maxUtilization = allMetrics.length > 0 ? Math.max(...allMetrics.map(m => m.utilization)) : 0;
  const minUtilization = allMetrics.length > 0 ? Math.min(...allMetrics.map(m => m.utilization)) : 0;

  // 核心数量
  const aicCount = aicMetrics.length;
  const aivCount = aivMetrics.length;

  // 总任务数
  const totalTasks = allMetrics.reduce((s, m) => s + m.taskCount, 0);

  return {
    avgUtilization,
    avgAicUtilization,
    avgAivUtilization,
    avgBubbleRate,
    avgAicBubbleRate,
    avgAivBubbleRate,
    aicLoadBalance,
    aivLoadBalance,
    overallLoadBalance,
    totalExecutionTime,
    maxUtilization,
    minUtilization,
    aicCount,
    aivCount,
    totalTasks,
    aicMetrics,
    aivMetrics,
    allMetrics,
  };
}

/**
 * 计算负载均衡度 (100% = 完美均衡, 0% = 严重不均衡)
 * 基于变异系数 (CV = std_dev / mean)
 */
function computeLoadBalance(values) {
  if (values.length <= 1) return 100;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const stdDev = computeStdDev(values);
  const cv = stdDev / mean;
  return Math.max(0, Math.min(100, (1 - cv) * 100));
}

/**
 * 计算标准差
 */
function computeStdDev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * 分析操作类型分布
 */
function analyzeOperationDistribution(execEvents) {
  const opStats = {};

  execEvents.forEach(e => {
    const op = getEventOpType(e);
    if (!opStats[op]) {
      opStats[op] = { count: 0, totalDuration: 0, minDuration: Infinity, maxDuration: -Infinity };
    }
    opStats[op].count++;
    opStats[op].totalDuration += (e.dur || 0);
    opStats[op].minDuration = Math.min(opStats[op].minDuration, e.dur || 0);
    opStats[op].maxDuration = Math.max(opStats[op].maxDuration, e.dur || 0);
  });

  // 计算百分比并排序
  const totalDuration = Object.values(opStats).reduce((s, v) => s + v.totalDuration, 0);
  const sorted = Object.entries(opStats)
    .map(([op, stats]) => ({
      op,
      ...stats,
      percentage: totalDuration > 0 ? (stats.totalDuration / totalDuration) * 100 : 0,
      avgDuration: stats.count > 0 ? stats.totalDuration / stats.count : 0,
    }))
    .sort((a, b) => b.totalDuration - a.totalDuration);

  return { opStats: sorted, totalDuration };
}

/**
 * 检测性能瓶颈
 */
function detectBottlenecks(coreMetrics, summaryMetrics, opDistribution) {
  const bottlenecks = [];

  // 瓶颈 1: 核心利用率低
  if (summaryMetrics.avgUtilization < 50) {
    const worstCores = summaryMetrics.allMetrics
      .filter(m => m.utilization < 50)
      .sort((a, b) => a.utilization - b.utilization)
      .slice(0, 5);
    bottlenecks.push({
      id: 'low_utilization',
      type: '核心利用率低',
      severity: 'critical',
      severityLabel: '严重',
      value: summaryMetrics.avgUtilization,
      unit: '%',
      description: `平均核心利用率仅为 ${summaryMetrics.avgUtilization.toFixed(1)}%，核心大量时间处于空闲状态`,
      detail: `AIC 平均: ${summaryMetrics.avgAicUtilization.toFixed(1)}%，AIV 平均: ${summaryMetrics.avgAivUtilization.toFixed(1)}%`,
      affectedCores: worstCores.map(m => m.coreName),
      rootCause: [
        '任务粒度过小，调度开销占比高',
        '任务间依赖关系导致长时间等待',
        '内存访问不连续，导致 cache miss 频繁',
        'Tilesize 设置不合理，算术强度低',
      ],
      impact: '严重影响算子吞吐量，核心算力未得到充分利用',
      threshold: 50,
    });
  } else if (summaryMetrics.avgUtilization < 70) {
    bottlenecks.push({
      id: 'moderate_utilization',
      type: '核心利用率偏低',
      severity: 'warning',
      severityLabel: '警告',
      value: summaryMetrics.avgUtilization,
      unit: '%',
      description: `平均核心利用率为 ${summaryMetrics.avgUtilization.toFixed(1)}%，仍有较大优化空间`,
      detail: `AIC 平均: ${summaryMetrics.avgAicUtilization.toFixed(1)}%，AIV 平均: ${summaryMetrics.avgAivUtilization.toFixed(1)}%`,
      affectedCores: summaryMetrics.allMetrics
        .filter(m => m.utilization < 70)
        .sort((a, b) => a.utilization - b.utilization)
        .slice(0, 5)
        .map(m => m.coreName),
      rootCause: [
        '任务调度策略待优化',
        '等待前驱任务完成时间较长',
        '内存访问模式有优化空间',
      ],
      impact: '影响算子性能，存在优化空间',
      threshold: 70,
    });
  }

  // 瓶颈 2: 气泡率高
  if (summaryMetrics.avgBubbleRate > 20) {
    const worstCores = summaryMetrics.allMetrics
      .filter(m => m.bubbleRate > 20)
      .sort((a, b) => b.bubbleRate - a.bubbleRate)
      .slice(0, 5);
    bottlenecks.push({
      id: 'high_bubble_rate',
      type: '调度气泡率高',
      severity: 'critical',
      severityLabel: '严重',
      value: summaryMetrics.avgBubbleRate,
      unit: '%',
      description: `平均气泡率为 ${summaryMetrics.avgBubbleRate.toFixed(1)}%，任务间存在大量调度等待`,
      detail: `AIC 气泡率: ${summaryMetrics.avgAicBubbleRate.toFixed(1)}%，AIV 气泡率: ${summaryMetrics.avgAivBubbleRate.toFixed(1)}%`,
      affectedCores: worstCores.map(m => m.coreName),
      rootCause: [
        '任务粒度过小，调度开销与执行时间比值高',
        'stitch 参数设置过小，任务合并不足',
        '循环展开因子不合适，产生大量小任务',
      ],
      impact: '严重浪费核心算力，任务调度开销超过实际计算时间',
      threshold: 20,
    });
  } else if (summaryMetrics.avgBubbleRate > 10) {
    bottlenecks.push({
      id: 'moderate_bubble_rate',
      type: '调度气泡率偏高',
      severity: 'warning',
      severityLabel: '警告',
      value: summaryMetrics.avgBubbleRate,
      unit: '%',
      description: `平均气泡率为 ${summaryMetrics.avgBubbleRate.toFixed(1)}%，存在一定调度等待`,
      detail: `AIC 气泡率: ${summaryMetrics.avgAicBubbleRate.toFixed(1)}%，AIV 气泡率: ${summaryMetrics.avgAivBubbleRate.toFixed(1)}%`,
      affectedCores: summaryMetrics.allMetrics
        .filter(m => m.bubbleRate > 10)
        .sort((a, b) => b.bubbleRate - a.bubbleRate)
        .slice(0, 5)
        .map(m => m.coreName),
      rootCause: ['调度策略有优化空间', '任务粒度可适当增大'],
      impact: '影响算子性能，有优化潜力',
      threshold: 10,
    });
  }

  // 瓶颈 3: 负载不均衡
  const minBalance = Math.min(summaryMetrics.aicLoadBalance, summaryMetrics.aivLoadBalance);
  if (summaryMetrics.aicCount > 1 && summaryMetrics.aicLoadBalance < 70) {
    const aicTimes = summaryMetrics.aicMetrics.map(m => m.totalActiveTime);
    const maxTime = Math.max(...aicTimes);
    const minTime = Math.min(...aicTimes);
    const maxCore = summaryMetrics.aicMetrics.find(m => m.totalActiveTime === maxTime);
    const minCore = summaryMetrics.aicMetrics.find(m => m.totalActiveTime === minTime);
    bottlenecks.push({
      id: 'aic_imbalance',
      type: 'AIC 核心负载不均衡',
      severity: summaryMetrics.aicLoadBalance < 50 ? 'critical' : 'warning',
      severityLabel: summaryMetrics.aicLoadBalance < 50 ? '严重' : '警告',
      value: summaryMetrics.aicLoadBalance,
      unit: '%',
      description: `AIC 核心负载均衡度仅 ${summaryMetrics.aicLoadBalance.toFixed(1)}%，核心间工作量差异显著`,
      detail: `最忙: ${maxCore?.coreName} (${maxTime.toFixed(1)}μs), 最闲: ${minCore?.coreName} (${minTime.toFixed(1)}μs), 差值: ${(maxTime - minTime).toFixed(1)}μs`,
      affectedCores: summaryMetrics.aicMetrics
        .sort((a, b) => b.totalActiveTime - a.totalActiveTime)
        .slice(0, 3)
        .map(m => m.coreName),
      rootCause: [
        '任务分配策略不均，部分核心分配更多计算',
        'Tile 切分不均匀，导致工作量差异',
        '动态 shape 下边界 tile 处理时间更长',
      ],
      impact: '最快核心等待最慢核心，整体性能受限于负载最重的核心',
      threshold: 70,
    });
  }

  if (summaryMetrics.aivCount > 1 && summaryMetrics.aivLoadBalance < 70) {
    const aivTimes = summaryMetrics.aivMetrics.map(m => m.totalActiveTime);
    const maxTime = Math.max(...aivTimes);
    const minTime = Math.min(...aivTimes);
    const maxCore = summaryMetrics.aivMetrics.find(m => m.totalActiveTime === maxTime);
    const minCore = summaryMetrics.aivMetrics.find(m => m.totalActiveTime === minTime);
    bottlenecks.push({
      id: 'aiv_imbalance',
      type: 'AIV 核心负载不均衡',
      severity: summaryMetrics.aivLoadBalance < 50 ? 'critical' : 'warning',
      severityLabel: summaryMetrics.aivLoadBalance < 50 ? '严重' : '警告',
      value: summaryMetrics.aivLoadBalance,
      unit: '%',
      description: `AIV 核心负载均衡度仅 ${summaryMetrics.aivLoadBalance.toFixed(1)}%，向量核心工作量分布不均`,
      detail: `最忙: ${maxCore?.coreName} (${maxTime.toFixed(1)}μs), 最闲: ${minCore?.coreName} (${minTime.toFixed(1)}μs)`,
      affectedCores: summaryMetrics.aivMetrics
        .sort((a, b) => b.totalActiveTime - a.totalActiveTime)
        .slice(0, 3)
        .map(m => m.coreName),
      rootCause: [
        'Vector tile 切分不均',
        '动态轴处理导致部分核心工作量更多',
        '内存对齐问题影响某些核心的效率',
      ],
      impact: 'AIV 核心整体效率降低，部分核心空闲等待',
      threshold: 70,
    });
  }

  // 瓶颈 4: AIC/AIV 计算不平衡
  if (summaryMetrics.aicCount > 0 && summaryMetrics.aivCount > 0) {
    const aicAvgUtil = summaryMetrics.avgAicUtilization;
    const aivAvgUtil = summaryMetrics.avgAivUtilization;
    const imbalanceRatio = Math.abs(aicAvgUtil - aivAvgUtil);
    if (imbalanceRatio > 25) {
      const dominant = aicAvgUtil > aivAvgUtil ? 'AIC (Cube)' : 'AIV (Vector)';
      const idle = aicAvgUtil > aivAvgUtil ? 'AIV (Vector)' : 'AIC (Cube)';
      bottlenecks.push({
        id: 'aic_aiv_imbalance',
        type: 'Cube/Vector 计算不平衡',
        severity: 'warning',
        severityLabel: '警告',
        value: imbalanceRatio,
        unit: '%',
        description: `${dominant} 核心利用率 (${Math.max(aicAvgUtil, aivAvgUtil).toFixed(1)}%) 显著高于 ${idle} (${Math.min(aicAvgUtil, aivAvgUtil).toFixed(1)}%)`,
        detail: `AIC 利用率: ${aicAvgUtil.toFixed(1)}%，AIV 利用率: ${aivAvgUtil.toFixed(1)}%`,
        affectedCores: [],
        rootCause: [
          `算法计算主要集中在 ${dominant} 核心，导致另一类型核心空闲等待`,
          '算子计算结构偏向某种计算类型 (矩阵乘 vs 逐元素)',
          '任务调度未充分利用所有类型核心',
        ],
        impact: `${idle} 核心未被充分利用，硬件资源浪费`,
        threshold: 25,
      });
    }
  }

  // 瓶颈 5: 任务时间差异过大 (长尾任务)
  summaryMetrics.allMetrics.forEach(m => {
    if (m.taskCount > 5) {
      const cv = m.stdDuration / m.avgDuration;
      if (cv > 0.5 && m.maxDuration > m.avgDuration * 3) {
        bottlenecks.push({
          id: `long_tail_${m.coreName}`,
          type: `长尾任务 (${m.coreName})`,
          severity: 'info',
          severityLabel: '提示',
          value: m.maxDuration,
          unit: 'μs',
          description: `${m.coreName} 存在长尾任务，最长任务 ${m.maxDuration.toFixed(2)}μs，平均 ${m.avgDuration.toFixed(2)}μs，差异 ${cv.toFixed(1)}x`,
          detail: `变异系数: ${(cv * 100).toFixed(1)}%，最大/最小比: ${(m.maxDuration / m.minDuration).toFixed(1)}x`,
          affectedCores: [m.coreName],
          rootCause: [
            '边界 tile 大小与内部 tile 不一致',
            '内存访问模式在某些迭代中效率更低',
          ],
          impact: '少量长耗时任务影响整体执行时间',
          threshold: null,
        });
      }
    }
  });

  // 按严重程度排序
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  bottlenecks.sort((a, b) => (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99));

  return bottlenecks;
}

/**
 * 生成优化建议
 */
function generateRecommendations(bottlenecks, summaryMetrics) {
  const recs = [];

  bottlenecks.forEach(b => {
    switch (b.id) {
      case 'low_utilization':
      case 'moderate_utilization':
        recs.push({
          priority: b.id === 'low_utilization' ? 'high' : 'medium',
          priorityLabel: b.id === 'low_utilization' ? '高优先级' : '中优先级',
          title: '使用 L2 亲和调度',
          description: '启用 L2 亲和调度模式，减少核心间通信开销，提升数据局部性',
          code: `@pypto.jit(runtime_options={"device_sched_mode": 1})
def your_operator(A, B):
    # ... operator implementation`,
          relatedBottleneck: b.id,
          category: 'scheduling',
        });
        recs.push({
          priority: b.id === 'low_utilization' ? 'high' : 'medium',
          priorityLabel: b.id === 'low_utilization' ? '高优先级' : '中优先级',
          title: '调整 Cube Tilesize',
          description: '增大 Tilesize 提高算术强度，减少内存访问开销占比',
          code: `# 对于 Cube 计算密集型算子
pypto.set_cube_tile_shapes([128, 128], [128, 512], [128, 128])

# 或尝试更大的 tile
pypto.set_cube_tile_shapes([256, 256], [256, 512], [256, 256])`,
          relatedBottleneck: b.id,
          category: 'tiling',
        });
        if (summaryMetrics.avgAicUtilization < 50) {
          recs.push({
            priority: 'medium',
            priorityLabel: '中优先级',
            title: '启用 CubeNBuffer 合并同构子图',
            description: '合并相邻的同构子图，减少任务切换开销',
            code: `pypto.set_pass_options(cube_nbuffer_setting={0: 8})`,
            relatedBottleneck: b.id,
            category: 'graph_optimization',
          });
        }
        break;

      case 'high_bubble_rate':
      case 'moderate_bubble_rate':
        recs.push({
          priority: b.id === 'high_bubble_rate' ? 'high' : 'medium',
          priorityLabel: b.id === 'high_bubble_rate' ? '高优先级' : '中优先级',
          title: '开启 loop_unroll 优化',
          description: '对循环类任务开启 loop_unroll，减少循环调度开销，适用于动态轴范围较广的场景',
          code: `# 在最内层循环添加 unroll_list
for b_idx in pypto.loop(b_scalar, name="LOOP_b", idx_name="b_idx"):
    for s1_idx in pypto.loop(s1_scalar, name="LOOP_s1", idx_name="s1_idx"):
        # 最内层循环添加 unroll_list
        for s2_idx in pypto.loop(s2_loop,
                                  unroll_list=[8, 4, 2, 1],  # 根据循环次数调整
                                  name="LOOP_s2",
                                  idx_name="s2_idx"):
            # 计算逻辑
            pass

# ⚠️ 重要: loop_unroll 必须放在最内层循环！`,
          relatedBottleneck: b.id,
          category: 'loop_optimization',
        });
        recs.push({
          priority: b.id === 'high_bubble_rate' ? 'high' : 'medium',
          priorityLabel: b.id === 'high_bubble_rate' ? '高优先级' : '中优先级',
          title: '调整 Stitch 参数',
          description: '增大 stitch_function_max_num，允许更多任务合并执行',
          code: `@pypto.frontend.jit(
    runtime_options={
        "stitch_function_max_num": 128,  # 默认可能更小
        "stitch_inner_memory": 16384,    # 16KB 内存限制
    }
)
def your_operator(A, B):
    pass`,
          relatedBottleneck: b.id,
          category: 'scheduling',
        });
        recs.push({
          priority: 'medium',
          priorityLabel: '中优先级',
          title: '启用 L1Reuse 优化',
          description: '启用 L1 缓存复用，减少重复加载开销',
          code: `pypto.set_pass_options(cube_l1_reuse_setting={0: 8})`,
          relatedBottleneck: b.id,
          category: 'memory',
        });
        break;

      case 'aic_imbalance':
      case 'aiv_imbalance':
        recs.push({
          priority: 'medium',
          priorityLabel: '中优先级',
          title: '使用 sg_set_scope 合并子图',
          description: '通过子图范围控制，减少任务依赖和跨核通信，改善负载均衡',
          code: `# 将相关操作放在同一子图范围内
pypto.set_pass_options(sg_set_scope=1)
# ... 计算密集型操作 ...
tile_result = compute_intensive_op(data)
pypto.set_pass_options(sg_set_scope=-1)`,
          relatedBottleneck: b.id,
          category: 'scheduling',
        });
        recs.push({
          priority: 'medium',
          priorityLabel: '中优先级',
          title: '优化 Tile 切分策略',
          description: '调整 tile size 使任务分配更均匀，减少核心间负载差异',
          code: `# 对于 Vector 核心
pypto.set_vec_tile_shapes(64, 64)  # [tile_m, tile_n]

# 对于 Cube 核心
pypto.set_cube_tile_shapes([128, 128], [128, 256], [128, 128])

# 如有动态 shape，考虑使用 loop_unroll 处理边界
for idx, k in pypto.loop_unroll(total // 64,
                                  unroll_list=[64, 16, 4],
                                  name="Main"):
    if k <= 16:
        pypto.set_vec_tile_shapes(16, 64)
    else:
        pypto.set_vec_tile_shapes(64, 64)`,
          relatedBottleneck: b.id,
          category: 'tiling',
        });
        break;

      case 'aic_aiv_imbalance':
        recs.push({
          priority: 'medium',
          priorityLabel: '中优先级',
          title: '重新平衡 Cube/Vector 计算分配',
          description: summaryMetrics.avgAicUtilization > summaryMetrics.avgAivUtilization
            ? '当前 Cube 核心负载较重，可尝试将部分操作分配给 Vector 核心处理'
            : '当前 Vector 核心负载较重，可尝试增大矩阵计算 tile 以提高 Cube 核心利用率',
          code: `# 提高 AIC (Cube) 利用率: 增大矩阵 tile
pypto.set_cube_tile_shapes([256, 256], [256, 512], [256, 256])

# 提高 AIV (Vector) 利用率: 增大向量 tile
pypto.set_vec_tile_shapes(128, 128)

# 使用 L2 亲和调度确保数据局部性
@pypto.jit(runtime_options={"device_sched_mode": 1})`,
          relatedBottleneck: b.id,
          category: 'architecture',
        });
        break;
    }
  });

  // 去重 (同 category+title 的建议只保留一条)
  const seen = new Set();
  return recs.filter(r => {
    const key = `${r.category}:${r.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 计算综合性能评分
 */
function computeOverallRating(summaryMetrics) {
  // 各指标评分 (0-100)
  const utilizationScore = Math.min(100, summaryMetrics.avgUtilization);
  const bubbleScore = Math.max(0, 100 - summaryMetrics.avgBubbleRate * 3);
  const balanceScore = summaryMetrics.overallLoadBalance;

  // 加权平均
  const overallScore = utilizationScore * 0.4 + bubbleScore * 0.35 + balanceScore * 0.25;

  let stars, label, color;
  if (overallScore >= 90) {
    stars = 5; label = '优秀'; color = '#10B981';
  } else if (overallScore >= 75) {
    stars = 4; label = '良好'; color = '#3B82F6';
  } else if (overallScore >= 55) {
    stars = 3; label = '一般'; color = '#F59E0B';
  } else if (overallScore >= 35) {
    stars = 2; label = '较差'; color = '#EF4444';
  } else {
    stars = 1; label = '很差'; color = '#7F1D1D';
  }

  return {
    stars,
    label,
    color,
    score: overallScore,
    breakdown: {
      utilization: { score: utilizationScore, weight: 0.4 },
      bubble: { score: bubbleScore, weight: 0.35 },
      balance: { score: balanceScore, weight: 0.25 },
    },
  };
}

/**
 * 获取评级颜色
 */
function getRatingColor(value, metricType) {
  if (metricType === 'utilization') {
    if (value >= 90) return '#10B981';
    if (value >= 70) return '#3B82F6';
    if (value >= 50) return '#F59E0B';
    return '#EF4444';
  } else if (metricType === 'bubble') {
    if (value < 5) return '#10B981';
    if (value < 10) return '#3B82F6';
    if (value < 20) return '#F59E0B';
    return '#EF4444';
  } else if (metricType === 'balance') {
    if (value >= 90) return '#10B981';
    if (value >= 75) return '#3B82F6';
    if (value >= 60) return '#F59E0B';
    return '#EF4444';
  }
  return '#94A3B8';
}

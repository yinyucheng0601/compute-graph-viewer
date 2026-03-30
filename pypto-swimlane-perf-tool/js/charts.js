/**
 * charts.js - 性能指标图表渲染模块
 * 使用纯 Canvas API 绘制各类性能图表，无外部依赖
 */

'use strict';

const CHART_COLORS = {
  positive: '#10B981',    // 绿 - 好
  warning: '#F59E0B',     // 黄 - 警告
  critical: '#EF4444',    // 红 - 差
  neutral: '#3B82F6',     // 蓝 - 中性
  dim: '#334155',         // 暗 - 背景/网格
  text: '#94A3B8',        // 文字
  textBright: '#E2E8F0',  // 亮文字
  bg: '#1E293B',          // 图表背景
};

/**
 * 根据利用率获取颜色
 */
function getUtilizationColor(util) {
  if (util >= 80) return CHART_COLORS.positive;
  if (util >= 60) return CHART_COLORS.neutral;
  if (util >= 40) return CHART_COLORS.warning;
  return CHART_COLORS.critical;
}

/**
 * 根据气泡率获取颜色
 */
function getBubbleColor(bubble) {
  if (bubble < 5) return CHART_COLORS.positive;
  if (bubble < 10) return CHART_COLORS.neutral;
  if (bubble < 20) return CHART_COLORS.warning;
  return CHART_COLORS.critical;
}

/**
 * 渲染核心利用率柱状图
 * @param {HTMLElement} container
 * @param {Map} coreMetrics
 * @param {string} coreType - 'AIC' | 'AIV' | 'ALL'
 */
function renderUtilizationChart(container, coreMetrics, coreType = 'ALL') {
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const dpr = window.devicePixelRatio || 1;
  const W = container.clientWidth || 400;
  const H = container.clientHeight || 200;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 过滤核心
  let cores = [...coreMetrics.values()];
  if (coreType !== 'ALL') {
    cores = cores.filter(m => m.coreType === coreType);
  }
  cores = cores.sort((a, b) => {
    const numA = parseInt(a.coreName.replace(/\D/g, '')) || 0;
    const numB = parseInt(b.coreName.replace(/\D/g, '')) || 0;
    return numA - numB;
  });

  if (cores.length === 0) {
    ctx.fillStyle = CHART_COLORS.text;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('无数据', W / 2, H / 2);
    return;
  }

  const margin = { top: 15, right: 15, bottom: 35, left: 40 };
  const chartW = W - margin.left - margin.right;
  const chartH = H - margin.top - margin.bottom;

  ctx.fillStyle = CHART_COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // 网格线
  [0, 25, 50, 75, 100].forEach(val => {
    const y = margin.top + chartH - (val / 100) * chartH;
    ctx.strokeStyle = CHART_COLORS.dim;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = CHART_COLORS.text;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${val}%`, margin.left - 4, y + 3);
  });

  // 柱子
  const barWidth = Math.max(2, Math.min(16, chartW / cores.length - 2));
  const barSpacing = chartW / cores.length;

  cores.forEach((m, i) => {
    const x = margin.left + i * barSpacing + (barSpacing - barWidth) / 2;
    const barH = (m.utilization / 100) * chartH;
    const y = margin.top + chartH - barH;

    ctx.fillStyle = getUtilizationColor(m.utilization);
    ctx.fillRect(x, y, barWidth, barH);

    // X轴标签 (只显示部分)
    if (cores.length <= 30 || i % Math.ceil(cores.length / 15) === 0) {
      const numMatch = m.coreName.match(/\d+/);
      const label = numMatch ? numMatch[0] : m.coreName;
      ctx.fillStyle = CHART_COLORS.text;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(x + barWidth / 2, margin.top + chartH + 15);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  });

  // 100% 参考线
  ctx.strokeStyle = CHART_COLORS.positive;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left + chartW, margin.top);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * 渲染气泡率柱状图
 */
function renderBubbleChart(container, coreMetrics, coreType = 'ALL') {
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const dpr = window.devicePixelRatio || 1;
  const W = container.clientWidth || 400;
  const H = container.clientHeight || 200;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  let cores = [...coreMetrics.values()];
  if (coreType !== 'ALL') {
    cores = cores.filter(m => m.coreType === coreType);
  }
  cores = cores.sort((a, b) => {
    const numA = parseInt(a.coreName.replace(/\D/g, '')) || 0;
    const numB = parseInt(b.coreName.replace(/\D/g, '')) || 0;
    return numA - numB;
  });

  if (cores.length === 0) return;

  const maxBubble = Math.max(5, Math.ceil(Math.max(...cores.map(m => m.bubbleRate)) / 5) * 5);
  const margin = { top: 15, right: 15, bottom: 35, left: 40 };
  const chartW = W - margin.left - margin.right;
  const chartH = H - margin.top - margin.bottom;

  ctx.fillStyle = CHART_COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // 网格
  [0, 10, 20, 30, 50].forEach(val => {
    if (val > maxBubble) return;
    const y = margin.top + chartH - (val / maxBubble) * chartH;
    ctx.strokeStyle = CHART_COLORS.dim;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = CHART_COLORS.text;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${val}%`, margin.left - 4, y + 3);
  });

  const barWidth = Math.max(2, Math.min(16, chartW / cores.length - 2));
  const barSpacing = chartW / cores.length;

  cores.forEach((m, i) => {
    const x = margin.left + i * barSpacing + (barSpacing - barWidth) / 2;
    const barH = (m.bubbleRate / maxBubble) * chartH;
    const y = margin.top + chartH - barH;

    ctx.fillStyle = getBubbleColor(m.bubbleRate);
    ctx.fillRect(x, y, barWidth, Math.max(1, barH));

    if (cores.length <= 30 || i % Math.ceil(cores.length / 15) === 0) {
      const numMatch = m.coreName.match(/\d+/);
      const label = numMatch ? numMatch[0] : m.coreName;
      ctx.fillStyle = CHART_COLORS.text;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(x + barWidth / 2, margin.top + chartH + 15);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  });
}

/**
 * 渲染操作类型分布饼图/条形图
 */
function renderOperationBreakdown(container, opDistribution, colorMap) {
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const dpr = window.devicePixelRatio || 1;
  const W = container.clientWidth || 300;
  const H = container.clientHeight || 200;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = CHART_COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const top10 = opDistribution.opStats.slice(0, 10);
  if (top10.length === 0) return;

  const maxVal = top10[0].totalDuration;
  const margin = { top: 10, right: 80, bottom: 10, left: 10 };
  const barH = Math.max(8, Math.floor((H - margin.top - margin.bottom) / top10.length) - 3);
  const barSpacing = (H - margin.top - margin.bottom) / top10.length;
  const chartW = W - margin.left - margin.right;

  top10.forEach((op, i) => {
    const y = margin.top + i * barSpacing;
    const barWidth = maxVal > 0 ? (op.totalDuration / maxVal) * chartW : 0;

    ctx.fillStyle = colorMap[op.op] || '#64748B';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(margin.left, y + 1, Math.max(2, barWidth), barH);
    ctx.globalAlpha = 1;

    // 操作名称
    ctx.fillStyle = CHART_COLORS.textBright;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    const opLabel = op.op.length > 18 ? op.op.substring(0, 17) + '…' : op.op;
    ctx.fillText(opLabel, margin.left + Math.max(3, barWidth) + 4, y + barH / 2 + 4);

    // 百分比
    ctx.fillStyle = CHART_COLORS.text;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${op.percentage.toFixed(1)}%`, W - 4, y + barH / 2 + 4);
  });
}

/**
 * 渲染核心利用率热力图 (AIC/AIV 对比)
 */
function renderHeatmapChart(container, coreMetrics) {
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const dpr = window.devicePixelRatio || 1;
  const W = container.clientWidth || 400;
  const H = container.clientHeight || 150;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, W, H);

  const aicCores = [...coreMetrics.values()]
    .filter(m => m.coreType === 'AIC')
    .sort((a, b) => parseInt(a.coreName.replace(/\D/g, '')) - parseInt(b.coreName.replace(/\D/g, '')));

  const aivCores = [...coreMetrics.values()]
    .filter(m => m.coreType === 'AIV')
    .sort((a, b) => parseInt(a.coreName.replace(/\D/g, '')) - parseInt(b.coreName.replace(/\D/g, '')));

  const labelH = 18;
  const rowH = (H - labelH * 2 - 20) / 2;
  const allAIC = aicCores.length;
  const allAIV = aivCores.length;

  // AIC 行
  if (allAIC > 0) {
    const cellW = Math.min(20, (W - 60) / allAIC);
    ctx.fillStyle = CHART_COLORS.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`AIC (${allAIC})`, 4, labelH - 3);

    aicCores.forEach((m, i) => {
      const x = 55 + i * cellW;
      const color = getUtilizationColor(m.utilization);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7 + m.utilization / 333;
      ctx.fillRect(x, labelH, Math.max(1, cellW - 1), rowH);
      ctx.globalAlpha = 1;
    });
  }

  // AIV 行
  if (allAIV > 0) {
    const yOff = labelH + rowH + 10;
    const cellW = Math.min(14, (W - 60) / allAIV);
    ctx.fillStyle = CHART_COLORS.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`AIV (${allAIV})`, 4, yOff + labelH - 3);

    aivCores.forEach((m, i) => {
      const x = 55 + i * cellW;
      const color = getUtilizationColor(m.utilization);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7 + m.utilization / 333;
      ctx.fillRect(x, yOff + labelH, Math.max(1, cellW - 1), rowH);
      ctx.globalAlpha = 1;
    });
  }

  // 图例
  const legendY = H - 8;
  const legendColors = [
    { color: CHART_COLORS.positive, label: '≥80%' },
    { color: CHART_COLORS.neutral, label: '60-80%' },
    { color: CHART_COLORS.warning, label: '40-60%' },
    { color: CHART_COLORS.critical, label: '<40%' },
  ];
  let legendX = W - 160;
  legendColors.forEach(({ color, label }) => {
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY - 8, 8, 8);
    ctx.fillStyle = CHART_COLORS.text;
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, legendX + 10, legendY);
    legendX += 38;
  });
}

/**
 * 渲染迷你 sparkline (用于指标卡片)
 */
function renderSparkline(canvas, values, color = '#3B82F6') {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 80;
  const H = canvas.clientHeight || 30;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  if (values.length < 2) return;

  const maxV = Math.max(...values);
  const minV = Math.min(...values);
  const range = maxV - minV || 1;

  const stepX = W / (values.length - 1);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  values.forEach((v, i) => {
    const x = i * stepX;
    const y = H - ((v - minV) / range) * (H - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 填充区域
  ctx.fillStyle = color + '22';
  ctx.lineTo((values.length - 1) * stepX, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
}

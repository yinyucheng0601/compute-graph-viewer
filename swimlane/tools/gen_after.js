#!/usr/bin/env node
/**
 * gen_after.js
 *
 * 从 stitched_before.json 生成 stitched_after.json。
 * "After" = 消除 Stitch 组之间的气泡（Bubble），模拟优化后的理想执行形态。
 *
 * Bubble 根因（来自 device_stitch_context.cpp）：
 *   1. Workspace 地址重叠：前后两个 stitched function 的 workspace 内存范围有交叉，
 *      必须等 Stitch N 全部完成才能启动 Stitch N+1。
 *   2. Pool reset times 不匹配：内存池重置时序不一致，强制 serialization。
 *
 * 算法：
 *   1. 从 taskName "[Stitch N] ..." 提取每个 task 的 stitch index N
 *   2. 计算全局边界：
 *        globalEnd[N]   = max(execEnd)   across ALL cores where stitch == N
 *        globalStart[N] = min(execStart) across ALL cores where stitch == N
 *   3. 计算气泡大小：
 *        gap[N] = globalStart[N+1] - globalEnd[N]
 *   4. 累计偏移量：
 *        offset[0] = 0
 *        offset[N] = offset[N-1] + gap[N-1]
 *   5. 压缩每个 task：
 *        execStart -= offset[stitchIndex]
 *        execEnd   -= offset[stitchIndex]
 */

const fs = require('fs');
const path = require('path');

const beforePath = path.resolve(__dirname, '../samples/stitched_before.json');
const afterPath  = path.resolve(__dirname, '../samples/stitched_after.json');

const data = JSON.parse(fs.readFileSync(beforePath, 'utf8'));

function getStitchIndex(taskName) {
  const m = String(taskName).match(/^\[Stitch\s+(\d+)\]/);
  return m ? parseInt(m[1], 10) : 0;
}

// 收集所有 task
const allTasks = [];
for (const block of data) {
  for (const task of (block.tasks || [])) {
    allTasks.push({ n: getStitchIndex(task.taskName), s: task.execStart, e: task.execEnd });
  }
}

// 找所有 stitch index（升序）
const indices = [...new Set(allTasks.map(t => t.n))].sort((a, b) => a - b);

// 每个 stitch 的全局 [start, end]
const gStart = {}, gEnd = {};
for (const N of indices) {
  const ts = allTasks.filter(t => t.n === N);
  gStart[N] = Math.min(...ts.map(t => t.s));
  gEnd[N]   = Math.max(...ts.map(t => t.e));
}

// 累计偏移：offset[N] = 前面所有 gap 之和
const offset = {};
offset[indices[0]] = 0;
for (let i = 1; i < indices.length; i++) {
  const prev = indices[i - 1], curr = indices[i];
  const gap = Math.max(0, gStart[curr] - gEnd[prev]);
  offset[curr] = offset[prev] + gap;
}

// 生成 after 数据
const after = data.map(block => ({
  ...block,
  tasks: (block.tasks || []).map(task => {
    const N   = getStitchIndex(task.taskName);
    const off = offset[N] ?? 0;
    return {
      ...task,
      execStart: Math.round((task.execStart - off) * 1000) / 1000,
      execEnd:   Math.round((task.execEnd   - off) * 1000) / 1000,
    };
  }),
}));

fs.writeFileSync(afterPath, JSON.stringify(after));

// 打印统计
console.log(`Input:  ${beforePath}`);
console.log(`Output: ${afterPath}`);
console.log(`\nStitch groups: ${indices.length}`);
let totalGap = 0;
for (let i = 0; i < indices.length; i++) {
  const N    = indices[i];
  const prev = indices[i - 1];
  const gap  = i === 0 ? 0 : Math.max(0, gStart[N] - gEnd[prev]);
  totalGap  += gap;
  const tag  = gap > 0 ? `  <-- gap ${gap.toFixed(1)} removed` : '';
  console.log(`  [Stitch ${N}]  global [${gStart[N].toFixed(1)}, ${gEnd[N].toFixed(1)}]  gap_before=${gap.toFixed(1)}${tag}`);
}
console.log(`\nTotal bubble removed: ${totalGap.toFixed(1)} μs`);
const origSpan  = gEnd[indices[indices.length - 1]] - gStart[indices[0]];
const afterSpan = origSpan - totalGap;
console.log(`Timeline: ${origSpan.toFixed(1)} μs  →  ${afterSpan.toFixed(1)} μs  (${(totalGap / origSpan * 100).toFixed(1)}% reduction)`);

#!/usr/bin/env node
/**
 * gen_after.js
 *
 * 从 stitched_before.json 生成 stitched_after.json。
 * "After" = 消除 Stitch 组之间的气泡（Bubble），模拟优化后的理想执行形态。
 *
 * ── 气泡根因（device_stitch_context.cpp: ReuseStitch）────────────────
 *   Stitch N 与 Stitch N+1 之间存在全局同步屏障：
 *   必须等所有核都完成 Stitch N，才能在任意核上启动 Stitch N+1。
 *   这导致先完成的核（如 AIC 核在 ~200μs 结束 Stitch 0）
 *   要空等慢核（如 Fake Core 在 ~955μs 才结束 Stitch 0）约 750μs。
 *
 * ── 优化目标 ─────────────────────────────────────────────────────────
 *   移除全局屏障，让每个核独立调度：
 *   Stitch N+1 在某核上的 execStart = 该核 Stitch N 的 execEnd + ε。
 *   即【每核独立压缩】，不等其他核。
 *
 * ── 算法（per-core compaction）───────────────────────────────────────
 *   For each block (coreType):
 *     1. core_end_N   = max(execEnd)   of tasks where stitch == N
 *     2. core_start_N1 = min(execStart) of tasks where stitch == N+1
 *     3. per_core_gap  = core_start_N1 - core_end_N   (该核的等待时间)
 *     4. Shift Stitch N+1 tasks on this core:
 *          execStart -= per_core_gap
 *          execEnd   -= per_core_gap
 */

const fs   = require('fs');
const path = require('path');

const beforePath = path.resolve(__dirname, '../samples/stitched_before.json');
const afterPath  = path.resolve(__dirname, '../samples/stitched_after.json');

const data = JSON.parse(fs.readFileSync(beforePath, 'utf8'));

function getStitchIndex(taskName) {
  const m = String(taskName).match(/^\[Stitch\s+(\d+)\]/);
  return m ? parseInt(m[1], 10) : 0;
}

// 找所有 stitch index（升序）
const allStitchIndices = new Set();
for (const block of data)
  for (const task of (block.tasks || []))
    allStitchIndices.add(getStitchIndex(task.taskName));
const indices = [...allStitchIndices].sort((a, b) => a - b);

// ── per-core compaction ──────────────────────────────────────────────
const stats = [];

const after = data.map(block => {
  const tasks = block.tasks || [];

  // 按 stitch 分组
  const byStitch = {};
  for (const t of tasks) {
    const n = getStitchIndex(t.taskName);
    (byStitch[n] = byStitch[n] || []).push(t);
  }

  // 每段 stitch 间计算 per-core offset
  const coreOffsets = {}; // offset[N] = shift to apply to stitch N tasks on this core
  coreOffsets[indices[0]] = 0;

  for (let i = 1; i < indices.length; i++) {
    const prev = indices[i - 1], curr = indices[i];
    const prevTasks = byStitch[prev] || [];
    const currTasks = byStitch[curr] || [];
    if (!prevTasks.length || !currTasks.length) { coreOffsets[curr] = coreOffsets[prev] || 0; continue; }

    const coreEnd   = Math.max(...prevTasks.map(t => t.execEnd));
    const coreStart = Math.min(...currTasks.map(t => t.execStart));
    const gap       = Math.max(0, coreStart - coreEnd);
    coreOffsets[curr] = (coreOffsets[prev] || 0) + gap;

    if (gap > 0.5) {
      stats.push({ core: block.coreType, stitch: `${prev}→${curr}`, end0: coreEnd, start1: coreStart, gap });
    }
  }

  return {
    ...block,
    tasks: tasks.map(task => {
      const n   = getStitchIndex(task.taskName);
      const off = coreOffsets[n] ?? 0;
      return {
        ...task,
        execStart: Math.round((task.execStart - off) * 1000) / 1000,
        execEnd:   Math.round((task.execEnd   - off) * 1000) / 1000,
      };
    }),
  };
});

fs.writeFileSync(afterPath, JSON.stringify(after));

// ── 统计报告 ─────────────────────────────────────────────────────────
console.log(`Input:  ${beforePath}`);
console.log(`Output: ${afterPath}`);
console.log(`\nPer-core gaps removed (>0.5μs):`);
for (const s of stats) {
  console.log(`  ${s.core.padEnd(24)} Stitch ${s.stitch}  end0=${s.end0.toFixed(1).padStart(8)}  start1=${s.start1.toFixed(1).padStart(8)}  gap=${s.gap.toFixed(1).padStart(8)} μs`);
}

// 全局对比
const getSpan = (d) => {
  let min = Infinity, max = -Infinity;
  for (const b of d)
    for (const t of (b.tasks || [])) {
      if (t.execStart < min) min = t.execStart;
      if (t.execEnd   > max) max = t.execEnd;
    }
  return { min, max, span: max - min };
};

const before = getSpan(data), afterSpan = getSpan(after);
const totalGapRemoved = stats.reduce((s, r) => s + r.gap, 0);
console.log(`\nTimeline:`);
console.log(`  Before: [${before.min.toFixed(1)}, ${before.max.toFixed(1)}]  span=${before.span.toFixed(1)} μs`);
console.log(`  After:  [${afterSpan.min.toFixed(1)}, ${afterSpan.max.toFixed(1)}]  span=${afterSpan.span.toFixed(1)} μs`);
console.log(`  Largest AIC bubble removed: ${Math.max(...stats.map(s => s.gap)).toFixed(1)} μs`);

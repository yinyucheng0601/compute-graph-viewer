/**
 * parser.js - 泳道图 JSON 数据解析模块
 * 解析 merged_swimlane.json (Chrome Trace Format / Perfetto 格式)
 */

'use strict';

/**
 * 解析泳道图 JSON 数据
 * @param {Object} data - 原始 JSON 对象
 * @returns {Object} 解析结果
 */
function parseTraceJSON(data) {
  if (Array.isArray(data)) {
    return parseCoreTaskJSON(data);
  }

  if (!data || !Array.isArray(data.traceEvents)) {
    throw new Error('无效的泳道图 JSON 格式');
  }

  const events = data.traceEvents;

  // 1. 提取线程名称映射 (M 类型事件)
  const threadMap = buildThreadMap(events);

  // 2. 提取所有执行事件 (X 类型事件)
  const execEvents = events.filter(e => e.ph === 'X');

  // 3. 提取所有关联关系事件 (Flow events: s, t, f)
  const flowEvents = events.filter(e => e.ph === 's' || e.ph === 't' || e.ph === 'f');

  // 4. 提取计数器事件 (C 类型事件, 内存使用等)
  const counterEvents = events.filter(e => e.ph === 'C');

  // 5. 按核心分组执行事件
  const coreEvents = groupEventsByCore(execEvents, threadMap);

  // 6. 计算时间范围
  const timeRange = computeTimeRange(execEvents);

  // 7. 提取操作类型
  execEvents.forEach((event, index) => enrichTraceEvent(event, threadMap, index));

  const operationTypes = extractOperationTypes(execEvents);

  // 8. 计算操作颜色映射
  const colorMap = buildColorMap(operationTypes);

  // 9. 构建任务索引和关系网
  const taskIndex = buildTaskIndex(execEvents);
  const relations = buildRelations(execEvents, flowEvents);

  // 10. 构建任务分组 (按名称第一位数字)
  const groupBands = buildGroupBands(execEvents, timeRange);

  return {
    threadMap,
    execEvents,
    flowEvents,
    counterEvents,
    coreEvents,
    timeRange,
    operationTypes,
    colorMap,
    taskIndex,
    relations,
    groupBands,
    totalEventCount: execEvents.length,
    coreCount: coreEvents.size,
  };
}

function parseCoreTaskJSON(entries) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const threadMap = new Map();
  const coreEvents = new Map();
  const execEvents = [];
  const flowEvents = [];
  const counterEvents = [];
  const relations = new Map();

  let minTs = Infinity;

  normalizedEntries.forEach(entry => {
    (entry?.tasks || []).forEach(task => {
      const ts = Number(task?.execStart);
      if (Number.isFinite(ts)) minTs = Math.min(minTs, ts);
    });
  });

  if (!Number.isFinite(minTs)) minTs = 0;

  normalizedEntries.forEach((entry, laneIndex) => {
    const coreName = String(entry?.coreType || entry?.threadName || `Core_${laneIndex}`);
    const tid = laneIndex;
    threadMap.set(tid, coreName);

    const events = Array.isArray(entry?.tasks)
      ? entry.tasks.map((task, taskIndex) => normalizeCoreTaskEvent(task, coreName, tid, taskIndex, minTs))
      : [];

    events.sort((a, b) => a.ts - b.ts || (a.dur || 0) - (b.dur || 0));
    coreEvents.set(coreName, events);
    execEvents.push(...events);
  });

  const timeRange = computeTimeRange(execEvents);
  const operationTypes = extractOperationTypes(execEvents);
  const colorMap = buildColorMap(operationTypes);
  const taskIndex = buildTaskIndex(execEvents);
  const groupBands = buildGroupBands(execEvents, timeRange);

  return {
    threadMap,
    execEvents,
    flowEvents,
    counterEvents,
    coreEvents,
    timeRange,
    operationTypes,
    colorMap,
    taskIndex,
    relations,
    groupBands,
    totalEventCount: execEvents.length,
    coreCount: coreEvents.size,
  };
}

/**
 * 构建任务索引 (按 taskId 和 name)
 */
function buildTaskIndex(execEvents) {
  const index = {
    byTaskId: new Map(),
    byName: new Map()
  };

  execEvents.forEach(e => {
    const taskId = e.args?.taskId || e.args?.TaskId;
    if (taskId !== undefined) {
      if (!index.byTaskId.has(taskId)) index.byTaskId.set(taskId, []);
      index.byTaskId.get(taskId).push(e);
    }
    
    if (e.name) {
      if (!index.byName.has(e.name)) index.byName.set(e.name, []);
      index.byName.get(e.name).push(e);
    }
  });

  return index;
}

/**
 * 构建任务间的显式关联关系 (解析 Chrome Trace 的 flow events: s 和 f)
 */
function buildRelations(execEvents, flowEvents) {
  // src -> Set of dst
  const relations = new Map();

  // 1. 根据 id 组合 s (start) 和 f (finish) 事件
  const flowMap = new Map(); // id -> { s: event, f: event }
  flowEvents.forEach(e => {
    if (e.id === undefined) return;
    if (!flowMap.has(e.id)) flowMap.set(e.id, {});
    
    if (e.ph === 's') {
      flowMap.get(e.id).s = e;
    } else if (e.ph === 'f') {
      flowMap.get(e.id).f = e;
    }
  });

  // 2. 按 tid 分组 X 事件，以便快速查找
  const xByTid = new Map();
  execEvents.forEach(x => {
    if (!xByTid.has(x.tid)) xByTid.set(x.tid, []);
    xByTid.get(x.tid).push(x);
  });
  
  // 3. 将 flow 事件关联回具体的 X 事件
  flowMap.forEach(flow => {
    const sEvent = flow.s;
    const fEvent = flow.f;
    if (!sEvent || !fEvent) return; // 缺少成对的 s 或 f

    const srcTidEvents = xByTid.get(sEvent.tid);
    const dstTidEvents = xByTid.get(fEvent.tid);
    if (!srcTidEvents || !dstTidEvents) return;

    // 寻找 source X event (结束时间最接近 s.ts)
    let srcX = null;
    let minSrcDist = Infinity;
    for (const x of srcTidEvents) {
      const endTs = x.ts + (x.dur || 0);
      const dist = Math.min(Math.abs(x.ts - sEvent.ts), Math.abs(endTs - sEvent.ts));
      if (dist < minSrcDist) {
        minSrcDist = dist;
        srcX = x;
      }
    }

    // 寻找 destination X event (开始时间最接近 f.ts)
    let dstX = null;
    let minDstDist = Infinity;
    for (const x of dstTidEvents) {
      const dist = Math.abs(x.ts - fEvent.ts);
      if (dist < minDstDist) {
        minDstDist = dist;
        dstX = x;
      }
    }

    // 建立关联
    if (srcX && dstX && minSrcDist < 100 && minDstDist < 100) { // 设置一个合理的最大偏差容忍度
      if (!relations.has(srcX)) relations.set(srcX, new Set());
      relations.get(srcX).add(dstX);
      
      // 同时也建立反向关联，以便点击任意一个都能看到对方
      if (!relations.has(dstX)) relations.set(dstX, new Set());
      relations.get(dstX).add(srcX);
    }
  });

  return relations;
}


/**
 * 构建线程 ID → 核心名称映射
 */
function buildThreadMap(events) {
  const map = new Map();
  events
    .filter(e => e.ph === 'M' && e.name === 'thread_name' && e.args?.name)
    .forEach(e => {
      map.set(e.tid, e.args.name);
    });
  return map;
}

/**
 * 按核心分组执行事件，并排序
 */
function groupEventsByCore(execEvents, threadMap) {
  const coreEvents = new Map();

  execEvents.forEach(event => {
    const coreName = threadMap.get(event.tid) || `Core_${event.tid}`;
    if (!coreEvents.has(coreName)) {
      coreEvents.set(coreName, []);
    }
    coreEvents.get(coreName).push(event);
  });

  // 每个核心内按时间戳排序
  coreEvents.forEach((events, coreName) => {
    events.sort((a, b) => a.ts - b.ts);
  });

  return coreEvents;
}

/**
 * 计算所有事件的时间范围
 */
function computeTimeRange(execEvents) {
  if (execEvents.length === 0) return { start: 0, end: 0, duration: 0 };

  let minTs = Infinity;
  let maxEnd = -Infinity;

  execEvents.forEach(e => {
    const start = e.ts;
    const end = e.ts + (e.dur || 0);
    if (start < minTs) minTs = start;
    if (end > maxEnd) maxEnd = end;
  });

  return {
    start: minTs,
    end: maxEnd,
    duration: maxEnd - minTs,
  };
}

/**
 * 提取所有操作类型 (color 字段)
 */
function extractOperationTypes(execEvents) {
  const types = new Set();
  execEvents.forEach(e => {
    const opType = e.args?.color || extractOpFromName(e.name) || 'unknown';
    types.add(opType);
  });
  return [...types].sort();
}

/**
 * 从 event name 提取操作类型 (备用方法)
 * 格式: "0-3-5-24-3(bn-after-matmul2)"
 */
function extractOpFromName(name) {
  if (!name) return 'unknown';
  const match = name.match(/\(([^)]+)\)$/);
  return match ? match[1] : name;
}

function stripLabelSuffix(rawName, label) {
  if (!rawName || !label) return rawName || '';
  const suffix = `(${label})`;
  return rawName.endsWith(suffix) ? rawName.slice(0, -suffix.length).trim() : rawName;
}

function parseSeqNo(rawName) {
  const stitchMatch = String(rawName || '').match(/\[Stitch\s+(\d+)\]/i);
  if (stitchMatch) return Number(stitchMatch[1]);
  const numericPrefix = String(rawName || '').match(/^(\d+)-/);
  return numericPrefix ? Number(numericPrefix[1]) : null;
}

function normalizeCoreTaskEvent(task, coreName, tid, taskIndex, minTs) {
  const rawName = String(task?.taskName || task?.name || `task_${task?.taskId ?? taskIndex}`);
  const label = String(task?.semanticLabel || task?.label || extractOpFromName(rawName) || 'unknown');
  const start = Number(task?.execStart) || 0;
  const end = Number(task?.execEnd);
  const dur = Number.isFinite(end) ? Math.max(0.001, end - start) : Math.max(0.001, Number(task?.dur) || 0.001);
  const seqNo = parseSeqNo(rawName);

  return {
    pid: 0,
    tid,
    ph: 'X',
    ts: start,
    dur,
    name: rawName,
    label,
    rawName,
    displayName: stripLabelSuffix(rawName, label) || rawName,
    laneKind: coreName.startsWith('AIC') ? 'aic' : (coreName.startsWith('AIV') ? 'aiv' : 'other'),
    seqNo,
    taskId: task?.taskId ?? taskIndex,
    subGraphId: task?.subGraphId ?? null,
    inputRawMagic: Array.isArray(task?.inputRawMagic) ? task.inputRawMagic : [],
    outputRawMagic: Array.isArray(task?.outputRawMagic) ? task.outputRawMagic : [],
    args: {
      taskId: task?.taskId ?? taskIndex,
      color: label,
      subGraphId: task?.subGraphId ?? null,
    },
    relTs: start - minTs,
    relEnd: start - minTs + dur,
  };
}

function enrichTraceEvent(event, threadMap, index) {
  const label = String(event.args?.color || extractOpFromName(event.name) || 'unknown');
  const rawName = String(event.name || `${label}_${index}`);
  const coreName = threadMap.get(event.tid) || `Core_${event.tid}`;
  event.label = event.label || label;
  event.rawName = event.rawName || rawName;
  event.displayName = event.displayName || stripLabelSuffix(rawName, label) || rawName;
  event.laneKind = event.laneKind || (coreName.startsWith('AIC') ? 'aic' : (coreName.startsWith('AIV') ? 'aiv' : 'other'));
  event.seqNo = event.seqNo ?? parseSeqNo(rawName);
  event.taskId = event.taskId ?? (event.args?.taskId || event.args?.TaskId || index);
  event.inputRawMagic = Array.isArray(event.inputRawMagic) ? event.inputRawMagic : [];
  event.outputRawMagic = Array.isArray(event.outputRawMagic) ? event.outputRawMagic : [];
}

/**
 * 构建操作类型 → 颜色映射
 */
function buildColorMap(operationTypes) {
  // 预定义常见操作类型颜色
  const predefined = {
    'matmul': '#4A9EFF',
    'bn-after-matmul2': '#5BC8FF',
    'SoftMax': '#A78BFA',
    'softmax': '#A78BFA',
    'LayerNorm': '#34D399',
    'layernorm': '#34D399',
    'Add': '#FCD34D',
    'add': '#FCD34D',
    'Mul': '#F97316',
    'mul': '#F97316',
    'Cast': '#94A3B8',
    'cast': '#94A3B8',
    'Relu': '#FB7185',
    'relu': '#FB7185',
    'Transpose': '#22D3EE',
    'transpose': '#22D3EE',
    'Reshape': '#A3E635',
    'reshape': '#A3E635',
    'Gather': '#E879F9',
    'gather': '#E879F9',
  };

  const colorPalette = [
    '#4A9EFF', '#5BC8FF', '#A78BFA', '#34D399', '#FCD34D',
    '#F97316', '#FB7185', '#22D3EE', '#A3E635', '#E879F9',
    '#60A5FA', '#F472B6', '#4ADE80', '#FACC15', '#38BDF8',
    '#FB923C', '#C084FC', '#86EFAC', '#FDE68A', '#67E8F9',
  ];

  const colorMap = {};
  let paletteIndex = 0;

  operationTypes.forEach(opType => {
    if (predefined[opType]) {
      colorMap[opType] = predefined[opType];
    } else {
      colorMap[opType] = colorPalette[paletteIndex % colorPalette.length];
      paletteIndex++;
    }
  });

  colorMap['unknown'] = '#64748B';
  return colorMap;
}

/**
 * 获取事件的操作类型
 */
function getEventOpType(event) {
  return event.args?.color || extractOpFromName(event.name) || 'unknown';
}

/**
 * 解析 execution-hint 字段中的时间信息
 */
function parseExecutionHint(hint) {
  if (!hint) return null;
  const result = {};
  const avgMatch = hint.match(/Average Execution Time:\s*([\d.]+)/);
  const maxMatch = hint.match(/Max Execution Time:\s*([\d.]+)/);
  const minMatch = hint.match(/Min Execution Time:\s*([\d.]+)/);
  if (avgMatch) result.avg = parseFloat(avgMatch[1]);
  if (maxMatch) result.max = parseFloat(maxMatch[1]);
  if (minMatch) result.min = parseFloat(minMatch[1]);
  return result;
}

/**
 * 获取核心类型 (AIC / AIV / OTHER)
 */
function getCoreType(coreName) {
  if (coreName.startsWith('AIC')) return 'AIC';
  if (coreName.startsWith('AIV')) return 'AIV';
  return 'OTHER';
}

/**
 * 从任务名称中提取分组 ID（第一个数字段）
 * 例: "0-0-0-1-1(bn-after-matmul2)" → "0"
 *     "3-5-24-3(matmul)"            → "3"
 */
function extractGroupId(name) {
  if (!name) return null;
  const m = name.match(/^(\d+)/);
  return m ? m[1] : null;
}

/**
 * 构建任务分组区间数组，按名称第一位数字分组，计算每组的时间跨度
 * 返回 [{id, start, end, count}] (start/end 为相对于 timeRange.start 的偏移量，单位 μs)
 */
function buildGroupBands(execEvents, timeRange) {
  const groups = new Map(); // id -> {id, start, end, count}

  execEvents.forEach(e => {
    const gid = extractGroupId(e.name);
    if (gid === null) return;

    const relStart = e.ts - timeRange.start;
    const relEnd   = relStart + (e.dur || 0);

    if (!groups.has(gid)) {
      groups.set(gid, { id: gid, start: relStart, end: relEnd, count: 0 });
    }
    const g = groups.get(gid);
    if (relStart < g.start) g.start = relStart;
    if (relEnd   > g.end)   g.end   = relEnd;
    g.count++;
  });

  // 按开始时间排序
  return [...groups.values()].sort((a, b) => a.start - b.start);
}

/**
 * 对核心进行排序: AIC 在前，AIV 在后，按编号排序
 */
function sortCoreNames(coreNames) {
  return [...coreNames].sort((a, b) => {
    const typeA = getCoreType(a);
    const typeB = getCoreType(b);
    if (typeA !== typeB) {
      if (typeA === 'AIC') return -1;
      if (typeB === 'AIC') return 1;
      if (typeA === 'AIV') return -1;
      if (typeB === 'AIV') return 1;
    }
    // 同类型按编号排序
    const numA = parseInt(a.replace(/[^0-9]/g, '')) || 0;
    const numB = parseInt(b.replace(/[^0-9]/g, '')) || 0;
    return numA - numB;
  });
}

(function () {
  const STORAGE_META_KEY = 'swimSelectedFile';
  const STORAGE_TEXT_KEY = 'swimSelectedFileText';
  const PASS_IR_META_KEY = 'ptoSwimlaneProgramMeta';
  const PASS_IR_TEXT_KEY = 'ptoSwimlaneProgramText';
  const PASS_IR_FOCUS_KEY = 'ptoSwimlanePassFocus';
  const SOURCE_FLOW_FOCUS_KEY = 'ptoSwimlaneSourceFocus';
  const SOURCE_FLOW_META_KEY = 'vtSelectedFile';
  const SOURCE_FLOW_TEXT_KEY = 'vtSelectedFileText';
  const PASS_IR_COLOR_SYNC_EVENT = 'pto-pass-ir:set-color-mode';
  const ENABLE_SPLIT_VIEW = true;

  const dom = {
    searchInput: document.getElementById('swSearchInput'),
    searchToggleBtn: document.getElementById('swSearchToggle'),
    searchPrevBtn: document.getElementById('swSearchPrev'),
    searchNextBtn: document.getElementById('swSearchNext'),
    searchCount: document.getElementById('swSearchCount'),
    resourceToggleBtn: document.getElementById('swResourceToggleBtn'),
    resourcePanel: document.getElementById('swResourcePanel'),
    resourceCloseBtn: document.getElementById('swResourceCloseBtn'),
    resourceFolderStatus: document.getElementById('swResourceFolderStatus'),
    resourceFilesStatus: document.getElementById('swResourceFilesStatus'),
    openFolderBtn: document.getElementById('swOpenFolderBtn'),
    openLocalBtn: document.getElementById('swOpenLocalBtn'),
    openCompareBtn: document.getElementById('swOpenCompareBtn'),
    bindProgramBtn: document.getElementById('swBindProgramBtn'),
    folderInput: document.getElementById('swFolderInput'),
    fileInput: document.getElementById('swFileInput'),
    compareFileInput: document.getElementById('swCompareFileInput'),
    programFileInput: document.getElementById('swProgramFileInput'),
    zoomInBtn: document.getElementById('swZoomInBtn'),
    zoomOutBtn: document.getElementById('swZoomOutBtn'),
    zoomFitBtn: document.getElementById('swZoomFitBtn'),
    moreControlsBtn: document.getElementById('swMoreControlsBtn'),
    moreControlsMenu: document.getElementById('swMoreControlsMenu'),
    beforeBtn: document.getElementById('swBeforeBtn'),
    afterBtn: document.getElementById('swAfterBtn'),
    singleViewBtn: document.getElementById('swSingleViewBtn'),
    compareViewBtn: document.getElementById('swCompareViewBtn'),
    diffViewBtn: document.getElementById('swDiffViewBtn'),
    fileMeta: document.getElementById('swFileMeta'),
    summary: document.getElementById('swSummary'),
    emptyState: document.getElementById('swEmptyState'),
    viewer: document.getElementById('swViewer'),
    laneKindFilters: document.getElementById('swLaneKindFilters'),
    seqFilters: document.getElementById('swSeqFilters'),
    colorMode: document.getElementById('swColorMode'),
    sortMode: document.getElementById('swSortMode'),
    toggleBubblesBtn: document.getElementById('swToggleBubbles'),
    measureModeBtn: document.getElementById('swMeasureModeBtn'),
    clearRangeBtn: document.getElementById('swClearRangeBtn'),
    diffSummary: document.getElementById('swDiffSummary'),
    diffMetrics: document.getElementById('swDiffMetrics'),
    diffTopLanes: document.getElementById('swDiffTopLanes'),
    compareStatus: document.getElementById('swCompareStatus'),
    bindingStatus: document.getElementById('swBindingStatus'),
    rangeSummary: document.getElementById('swRangeSummary'),
    laneInsights: document.getElementById('swLaneInsights'),
    labelInsights: document.getElementById('swLabelInsights'),
    explanation: document.getElementById('swExplanation'),
    detailPanel: document.getElementById('swDetailPanel'),
    detailBadge: document.getElementById('swDetailBadge'),
    detailName: document.getElementById('swDetailName'),
    detailDataset: document.getElementById('swDetailDataset'),
    detailBody: document.getElementById('swDetailBody'),
    detailClose: document.getElementById('swDetailClose'),
    journeyPanel: document.getElementById('swJourneyPanel'),
    journeyClose: document.getElementById('swJourneyClose'),
    journeyToggle: document.getElementById('swJourneyToggle'),
    journeyCards: document.getElementById('swJourneyCards'),
    taskPopup: document.getElementById('swTaskPopup'),
  };

  const chartRefs = {
    primary: buildChartRefs('Primary'),
    compare: buildChartRefs('Compare'),
  };

  const state = {
    datasets: {
      primary: null,
      compare: null,
    },
    compareSource: null,
    fileName: '',
    pxPerUnit: 8,
    matches: [],
    activeMatchIndex: -1,
    selectedTaskRef: null,
    hoverTime: null,
    markers: [],
    nextMarkerId: 1,
    range: {
      start: null,
      end: null,
      selecting: false,
      chartKey: 'primary',
    },
    scrollSyncLock: false,
    compareMode: false,
    comparePresentation: 'diff', // 'compare' | 'diff'
    showBubbles: false,
    measureMode: false,
    filters: {
      laneKinds: new Set(['fake', 'aic', 'aiv', 'aicpu', 'other']),
      seqNos: new Set(),
      colorMode: 'semantic',
      sortMode: 'default',
      searchQuery: '',
    },
    bindings: {
      program: null,
      moduleDir: null,
    },
    builtinSelection: 'before',
    uiMode: 'default', // 'default' | 'task-popup' | 'split'
    splitSource: null,  // 'pass-ir' | 'source-flow'
    splitRestore: null,
  };

  const STITCH_COLORS = ['#7b57bf', '#4d79d4', '#4da56d', '#d98f55', '#45b5c4', '#c86aa0', '#00a6fb', '#eab308'];
  const LABEL_COLORS = {
    'Prolog-Quant': '#9b6bde',
    'Query-Linear': '#7b57bf',
    'Query-Dequant': '#4d79d4',
    'Query-Hadamard': '#6f63c5',
    'Weight-Linear': '#4da56d',
    'Key-Linear': '#d98f55',
    'Key-Hadamard': '#e39b63',
    'Key-LayerNorm': '#c86aa0',
    'Key-Rope2D': '#45b5c4',
    'fake': '#5c6370',
    'unknown': '#5c6370',
  };
  const LANE_KIND_COLORS = {
    fake: '#5c6370',
    aic: '#7b57bf',
    aiv: '#4d79d4',
    aicpu: '#4da56d',
    other: '#8a8f98',
  };
  const GAP_EMPHASIS_US = 24;
  const STRONG_GAP_US = 80;
  const MIN_BAR_SEGMENT_COUNTS_PX = 96;
  let overlayRenderFrame = 0;

  function buildChartRefs(prefix) {
    return {
      panel: document.getElementById(`sw${prefix}Panel`),
      panelTitle: document.getElementById(`sw${prefix}PanelTitle`),
      panelMeta: document.getElementById(`sw${prefix}PanelMeta`),
      laneHeader: document.getElementById(`sw${prefix}LaneHeader`),
      timelineViewport: document.getElementById(`sw${prefix}TimelineViewport`),
      timelineTrack: document.getElementById(`sw${prefix}TimelineTrack`),
      laneLabelViewport: document.getElementById(`sw${prefix}LaneLabelViewport`),
      laneLabelTrack: document.getElementById(`sw${prefix}LaneLabelTrack`),
      laneMainViewport: document.getElementById(`sw${prefix}LaneMainViewport`),
      laneMainTrack: document.getElementById(`sw${prefix}LaneMainTrack`),
      barElements: new Map(),
      laneElements: new Map(),
      overlay: null,
    };
  }

  function normalizeBuiltinSampleKey(value) {
    return String(value || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '')
      .replace(/^swimlane\//, '');
  }

  function listBuiltinSamples() {
    const samples = window.SWIMLANE_BUILTIN_SAMPLES || {};
    return Object.values(samples).filter((sample) => sample && sample.data);
  }

  function getBuiltinSample(file) {
    const samples = listBuiltinSamples();
    if (!samples.length) return null;
    const normalized = normalizeBuiltinSampleKey(file);
    if (!normalized) return samples[0];
    return samples.find((sample) => {
      const candidates = [sample.key, sample.name]
        .map(normalizeBuiltinSampleKey)
        .filter(Boolean);
      return candidates.includes(normalized) || candidates.some((candidate) => normalized.endsWith(`/${candidate}`));
    }) || null;
  }

  function normalizeRelativePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function baseName(value) {
    const normalized = normalizeRelativePath(value);
    const parts = normalized.split('/');
    return parts[parts.length - 1] || '';
  }

  async function collectHandleEntries(handle, prefix = '') {
    const out = [];
    for await (const [name, child] of handle.entries()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (child.kind === 'directory') {
        const sub = await collectHandleEntries(child, rel);
        out.push(...sub);
      } else if (/\.(json|py)$/i.test(name)) {
        const file = await child.getFile();
        out.push({ relativePath: rel, file });
      }
    }
    return out;
  }

  function collectInputEntries(fileList) {
    const files = Array.from(fileList || []);
    const entries = files
      .filter((file) => file && /\.(json|py)$/i.test(file.name))
      .map((file) => ({
        relativePath: normalizeRelativePath(file.webkitRelativePath || file.name),
        file,
      }));
    const folderName = entries.length
      ? entries[0].relativePath.split('/')[0]
      : '';
    return { entries, folderName: folderName || 'local-folder' };
  }

  function detectFolderResources(entries) {
    const normalizedEntries = entries.map((entry) => ({
      ...entry,
      relativePath: normalizeRelativePath(entry.relativePath || entry.file?.name),
      baseName: baseName(entry.relativePath || entry.file?.name).toLowerCase(),
    }));
    const pick = (matcher) => normalizedEntries.find((entry) => matcher(entry));
    const program = pick((entry) => entry.baseName === 'program.json');
    const merged = pick((entry) => entry.baseName === 'merged_swimlane.json');
    const before = pick((entry) => entry.baseName === 'stitched_before.json');
    const after = pick((entry) => entry.baseName === 'stitched_after.json');
    const source = pick((entry) => entry.baseName === 'lightning_indexer_prolog_quant.py')
      || pick((entry) => entry.baseName.endsWith('.py'));

    let primary = merged || null;
    let compare = null;

    if (!primary) {
      if (state.builtinSelection === 'after' && after) {
        primary = after;
        compare = before || null;
      } else if (before) {
        primary = before;
        compare = after || null;
      } else if (after) {
        primary = after;
      }
    }

    return {
      entryCount: normalizedEntries.length,
      program,
      primary,
      compare,
      source,
      hasBeforeAfterPair: !!(before && after),
    };
  }

  function laneRank(name) {
    if (/Fake Core/i.test(name)) return 0;
    if (/AIC_/i.test(name)) return 1;
    if (/AIV_/i.test(name)) return 2;
    if (/AICPU/i.test(name)) return 3;
    return 4;
  }

  function laneKindFromName(name) {
    if (/Fake Core/i.test(name)) return 'fake';
    if (/AIC_/i.test(name)) return 'aic';
    if (/AIV_/i.test(name)) return 'aiv';
    if (/AICPU/i.test(name)) return 'aicpu';
    return 'other';
  }

  function laneNumber(name) {
    const match = String(name || '').match(/(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  function laneMetrics(kind, lineCount) {
    if (kind === 'fake') {
      const barHeight = 5;
      const lineGap = 1;
      const topPad = 2;
      const bottomPad = 2;
      return {
        barHeight,
        lineGap,
        topPad,
        bottomPad,
        laneHeight: Math.max(18, topPad + lineCount * barHeight + Math.max(0, lineCount - 1) * lineGap + bottomPad),
      };
    }
    const barHeight = 11;
    const lineGap = 0;
    const topPad = 2;
    const bottomPad = 2;
    return {
      barHeight,
      lineGap,
      topPad,
      bottomPad,
      laneHeight: Math.max(16, topPad + lineCount * barHeight + Math.max(0, lineCount - 1) * lineGap + bottomPad),
    };
  }

  function stableHash(input) {
    let hash = 2166136261;
    const value = String(input || '');
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function hueColor(input, saturation, lightness) {
    const hash = stableHash(input);
    const hue = hash % 360;
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
  }

  function colorForTask(task, mode) {
    if (mode === 'stitch') {
      const index = Math.abs(task.seqNo || 0) % STITCH_COLORS.length;
      return STITCH_COLORS[index];
    }
    if (mode === 'engine') {
      return LANE_KIND_COLORS[task.laneKind] || LANE_KIND_COLORS.other;
    }
    if (mode === 'subgraph') {
      const key = task.subgraphKey || task.subGraphId || task.leafHash || task.label;
      return hueColor(key, 58, 56);
    }
    return LABEL_COLORS[task.label] || hueColor(task.label, 54, 54);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN').format(Math.round(value));
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return '—';
    return `${(value * 100).toFixed(1)}%`;
  }

  function formatTick(value) {
    if (!Number.isFinite(value)) return '—';
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}ms`;
    if (value >= 100) return `${Math.round(value)}μs`;
    if (value >= 10) return `${value.toFixed(1)}μs`;
    return `${value.toFixed(2)}μs`;
  }

  function buildTaskSegmentSpec(task, widthPx) {
    const semantic = String(task?.label || task?.displayName || task?.rawName || 'compute');
    const inputCount = Array.isArray(task?.inputRawMagic) ? task.inputRawMagic.length : 0;
    const outputCount = Array.isArray(task?.outputRawMagic) ? task.outputRawMagic.length : 0;
    const showCounts = widthPx >= MIN_BAR_SEGMENT_COUNTS_PX;
    return [
      {
        key: 'in',
        className: 'sw-bar-segment sw-bar-segment-in',
        text: showCounts ? `IN ${inputCount}` : 'IN',
      },
      {
        key: 'compute',
        className: 'sw-bar-segment sw-bar-segment-compute',
        text: semantic,
      },
      {
        key: 'out',
        className: 'sw-bar-segment sw-bar-segment-out',
        text: showCounts ? `OUT ${outputCount}` : 'OUT',
      },
    ];
  }

  function formatDelta(value, invertedGood) {
    if (!Number.isFinite(value) || value === 0) return '0';
    const prefix = value > 0 ? '+' : '';
    const cls = invertedGood ? (value < 0 ? 'is-good' : 'is-bad') : (value > 0 ? 'is-good' : 'is-bad');
    return `<span class="${cls}">${prefix}${value.toFixed(1)}%</span>`;
  }

  function computeNiceStep(span) {
    const safeSpan = Math.max(1, span);
    const rough = safeSpan / 7;
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const unit = rough / power;
    if (unit <= 1) return power;
    if (unit <= 2) return 2 * power;
    if (unit <= 5) return 5 * power;
    return 10 * power;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseSeqNo(rawName) {
    const stitchMatch = String(rawName || '').match(/\[Stitch\s+(\d+)\]/i);
    if (stitchMatch) return Number(stitchMatch[1]);
    const numericPrefix = String(rawName || '').match(/^(\d+)-/);
    return numericPrefix ? Number(numericPrefix[1]) : null;
  }

  function extractLabel(rawName) {
    const match = String(rawName || '').match(/\(([^)]+)\)$/);
    return match ? match[1] : 'unknown';
  }

  function stripLabelSuffix(rawName, label) {
    if (!rawName) return '';
    const suffix = label ? `(${label})` : '';
    return String(rawName).replace(/\s*\([^)]+\)\s*$/, '').replace(/^\[Stitch\s+\d+\]\s*/, '').replace(suffix, '').trim();
  }

  function cleanHintToken(value) {
    const text = String(value == null ? '' : value)
      .trim()
      .replace(/^[`'"]+|[`'"]+$/g, '')
      .replace(/[;,\]}]+$/g, '')
      .trim();
    return text || null;
  }

  function normalizeOpaqueId(value) {
    const cleaned = cleanHintToken(value);
    if (!cleaned) return null;
    return /^0x/i.test(cleaned) ? cleaned.toLowerCase() : cleaned;
  }

  function parseSafeIntegerLike(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Number.isSafeInteger(value) ? value : Math.trunc(value);
    }
    const normalized = normalizeOpaqueId(value);
    if (!normalized) return null;
    const parsed = /^0x/i.test(normalized)
      ? Number.parseInt(normalized, 16)
      : Number(normalized);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  function readHintField(text, names) {
    const source = String(text || '');
    if (!source) return null;
    const list = Array.isArray(names) ? names : [names];
    for (const name of list) {
      const match = source.match(new RegExp(`${name}\\s*(?:[:=]|\\.{2,}|\\s{2,})\\s*([^\\s,;]+)`, 'i'));
      if (match) return normalizeOpaqueId(match[1]);
    }
    return null;
  }

  function parseEventHint(value) {
    const text = String(value || '');
    return {
      rootHash: readHintField(text, 'rootHash'),
      callOpMagic: readHintField(text, 'callOpMagic'),
      leafHash: readHintField(text, 'leafHash'),
      taskId: parseSafeIntegerLike(readHintField(text, ['TaskId', 'taskId'])),
      seqNo: parseSafeIntegerLike(readHintField(text, ['seqNo', 'SeqNo'])),
    };
  }

  function parseRawMagicList(value) {
    const text = String(value || '');
    const matches = [...text.matchAll(/["']?rawmagic["']?\s*(?:[:=]|\.+)\s*([^,\s;}\]]+)/gi)];
    return [...new Set(matches.map((match) => normalizeOpaqueId(match[1])).filter(Boolean))];
  }

  function parseTraceTask(event, index, threadName, processName, minTs) {
    const args = event.args || {};
    const hint = parseEventHint(args['event-hint']);
    const label = String(args.color || extractLabel(event.name) || 'unknown');
    const ts = Number(event.ts) || 0;
    const dur = Number(event.dur) || 0;
    const end = ts + dur;
    const seqNo = parseSafeIntegerLike(args.seqNo) ?? hint.seqNo ?? parseSeqNo(event.name);
    const taskId = parseSafeIntegerLike(args.taskId) ?? hint.taskId ?? index;
    const rawName = String(event.name || `${label} · task_${taskId}`);
    return {
      id: `${threadName}-${taskId}-${index}`,
      pid: event.pid ?? 0,
      tid: event.tid ?? 0,
      threadName,
      laneKind: laneKindFromName(threadName),
      processName,
      rawName,
      displayName: stripLabelSuffix(rawName, label) || rawName,
      label,
      ts,
      relTs: ts - minTs,
      dur,
      end,
      relEnd: end - minTs,
      seqNo,
      taskId,
      subGraphId: args.subGraphId ?? null,
      subgraphKey: hint.leafHash != null ? `leaf:${hint.leafHash}` : null,
      rootHash: hint.rootHash,
      leafHash: hint.leafHash,
      callOpMagic: hint.callOpMagic,
      inputRawMagic: parseRawMagicList(args['ioperand-hint']),
      outputRawMagic: parseRawMagicList(args['ooperand-hint']),
      eventHint: String(args['event-hint'] || ''),
      executionHint: String(args['execution-hint'] || ''),
      line: 0,
      gapBefore: 0,
      gapAfter: 0,
      overlapDur: 0,
      rawArgs: {
        color: args.color,
        seqNo: args.seqNo,
        taskId: args.taskId,
      },
    };
  }

  function parseCoreTask(entry, laneIndex, task, taskIndex, minTs) {
    const threadName = String(entry?.coreType || `Core_${laneIndex}`);
    const ts = Number(task?.execStart) || 0;
    const end = Number(task?.execEnd);
    const safeEnd = Number.isFinite(end) ? end : ts;
    const label = String(task?.semanticLabel || task?.label || task?.taskLabel || `subGraph_${task?.subGraphId ?? 'unknown'}`);
    const rawName = String(task?.taskName || task?.name || `${label} · task_${task?.taskId ?? taskIndex}`);
    const seqNo = parseSafeIntegerLike(task?.seqNo) ?? parseSeqNo(rawName);
    const subGraphId = task?.subGraphId ?? null;
    return {
      id: `${threadName}-${task?.taskId ?? taskIndex}-${taskIndex}`,
      pid: 0,
      tid: laneIndex,
      threadName,
      laneKind: laneKindFromName(threadName),
      processName: 'Machine View',
      rawName,
      displayName: stripLabelSuffix(rawName, label) || rawName,
      label,
      ts,
      relTs: ts - minTs,
      dur: Math.max(0, safeEnd - ts),
      end: safeEnd,
      relEnd: safeEnd - minTs,
      seqNo,
      taskId: task?.taskId ?? taskIndex,
      subGraphId,
      subgraphKey: subGraphId != null ? `sg:${subGraphId}` : null,
      rootHash: normalizeOpaqueId(task?.rootHash),
      leafHash: normalizeOpaqueId(task?.leafHash),
      callOpMagic: normalizeOpaqueId(task?.callOpMagic),
      inputRawMagic: Array.isArray(task?.inputRawMagic) ? task.inputRawMagic.map((item) => normalizeOpaqueId(item)).filter(Boolean) : [],
      outputRawMagic: Array.isArray(task?.outputRawMagic) ? task.outputRawMagic.map((item) => normalizeOpaqueId(item)).filter(Boolean) : [],
      eventHint: String(task?.eventHint || ''),
      executionHint: String(task?.executionHint || ''),
      line: 0,
      gapBefore: 0,
      gapAfter: 0,
      overlapDur: 0,
      rawArgs: {},
    };
  }

  function sortAndFinalizeLanes(laneEntries) {
    const lanes = [];
    let globalMaxEnd = 1;
    const labelStats = new Map();
    const kindStats = new Map();
    const allSeqs = new Set();

    laneEntries.forEach((entry) => {
      const tasks = entry.tasks.slice().sort((a, b) => a.ts - b.ts || a.end - b.end);
      const lineEnds = [];
      let workDuration = 0;
      let totalGap = 0;
      let maxGap = 0;
      let bubbleCount = 0;
      const seqGroups = new Map();

      tasks.forEach((task, index) => {
        let line = lineEnds.findIndex((value) => task.ts >= value);
        if (line < 0) {
          line = lineEnds.length;
          lineEnds.push(task.end);
        } else {
          lineEnds[line] = task.end;
        }
        task.line = line;
        if (index > 0) {
          const prev = tasks[index - 1];
          const gap = Math.max(0, task.relTs - prev.relEnd);
          task.gapBefore = gap;
          prev.gapAfter = gap;
          totalGap += gap;
          maxGap = Math.max(maxGap, gap);
          if (gap >= GAP_EMPHASIS_US) bubbleCount += 1;
        }
        workDuration += task.dur;
        globalMaxEnd = Math.max(globalMaxEnd, task.relEnd);
        if (task.seqNo != null) allSeqs.add(task.seqNo);
        if (task.seqNo != null) {
          if (!seqGroups.has(task.seqNo)) seqGroups.set(task.seqNo, []);
          seqGroups.get(task.seqNo).push(task);
        }

        const label = task.label || 'unknown';
        if (!labelStats.has(label)) {
          labelStats.set(label, {
            label,
            count: 0,
            totalDur: 0,
            maxDur: 0,
            kinds: new Set(),
          });
        }
        const labelEntry = labelStats.get(label);
        labelEntry.count += 1;
        labelEntry.totalDur += task.dur;
        labelEntry.maxDur = Math.max(labelEntry.maxDur, task.dur);
        labelEntry.kinds.add(task.laneKind);
      });

      const firstTs = tasks.length ? tasks[0].relTs : 0;
      const lastEnd = tasks.length ? tasks[tasks.length - 1].relEnd : 1;
      const wallSpan = Math.max(1, lastEnd - firstTs);
      const utilization = workDuration / wallSpan;
      const seqGapStats = [];
      const seqKeys = [...seqGroups.keys()].sort((a, b) => a - b);
      for (let i = 0; i < seqKeys.length - 1; i += 1) {
        const cur = seqGroups.get(seqKeys[i]);
        const next = seqGroups.get(seqKeys[i + 1]);
        const gap = Math.max(0, next[0].relTs - cur[cur.length - 1].relEnd);
        seqGapStats.push(gap);
      }

      const lane = {
        threadName: entry.threadName,
        laneKind: entry.laneKind,
        threadKind: laneRank(entry.threadName),
        taskCount: tasks.length,
        tasks,
        lineCount: Math.max(1, lineEnds.length),
        workDuration,
        firstTs,
        lastEnd,
        wallSpan,
        utilization,
        totalGap,
        maxGap,
        avgGap: tasks.length > 1 ? totalGap / (tasks.length - 1) : 0,
        bubbleCount,
        seqGapAvg: seqGapStats.length ? seqGapStats.reduce((sum, item) => sum + item, 0) / seqGapStats.length : 0,
        seqGapMax: seqGapStats.length ? Math.max(...seqGapStats) : 0,
      };
      lanes.push(lane);

      if (!kindStats.has(lane.laneKind)) {
        kindStats.set(lane.laneKind, {
          laneCount: 0,
          taskCount: 0,
          workDuration: 0,
          utilizationTotal: 0,
          maxGapTotal: 0,
          seqGapTotal: 0,
        });
      }
      const kindEntry = kindStats.get(lane.laneKind);
      kindEntry.laneCount += 1;
      kindEntry.taskCount += lane.taskCount;
      kindEntry.workDuration += lane.workDuration;
      kindEntry.utilizationTotal += lane.utilization;
      kindEntry.maxGapTotal += lane.maxGap;
      kindEntry.seqGapTotal += lane.seqGapAvg;
    });

    lanes.sort((a, b) => laneRank(a.threadName) - laneRank(b.threadName) || laneNumber(a.threadName) - laneNumber(b.threadName));

    const labels = [...labelStats.values()].sort((a, b) => b.totalDur - a.totalDur || b.count - a.count);
    const kinds = {};
    kindStats.forEach((value, key) => {
      kinds[key] = {
        laneCount: value.laneCount,
        taskCount: value.taskCount,
        workDuration: value.workDuration,
        avgUtilization: value.laneCount ? value.utilizationTotal / value.laneCount : 0,
        avgMaxGap: value.laneCount ? value.maxGapTotal / value.laneCount : 0,
        avgSeqGap: value.laneCount ? value.seqGapTotal / value.laneCount : 0,
      };
    });

    return {
      lanes,
      labels,
      kinds,
      sequences: [...allSeqs].sort((a, b) => a - b),
      span: globalMaxEnd,
      maxEnd: globalMaxEnd,
    };
  }

  function buildDataset(raw, fileName) {
    if (Array.isArray(raw?.traceEvents)) {
      const traceEvents = raw.traceEvents;
      const processNames = new Map();
      const threadNames = new Map();
      const taskEvents = [];

      traceEvents.forEach((event) => {
        if (event?.name === 'process_name' && event.args?.name) {
          processNames.set(String(event.pid), String(event.args.name));
        } else if (event?.name === 'thread_name' && event.args?.name) {
          threadNames.set(`${event.pid}-${event.tid}`, String(event.args.name));
        }
      });

      traceEvents.forEach((event) => {
        if (event?.ph === 'X' && typeof event.ts === 'number') taskEvents.push(event);
      });

      const minTs = taskEvents.length ? Math.min(...taskEvents.map((event) => Number(event.ts) || 0)) : 0;
      const grouped = new Map();

      taskEvents.forEach((event, index) => {
        const threadKey = `${event.pid}-${event.tid}`;
        const threadName = threadNames.get(threadKey) || `Thread ${event.tid ?? 0}`;
        const processName = processNames.get(String(event.pid)) || `Process ${event.pid ?? 0}`;
        const task = parseTraceTask(event, index, threadName, processName, minTs);
        if (!grouped.has(threadName)) grouped.set(threadName, { threadName, laneKind: laneKindFromName(threadName), tasks: [] });
        grouped.get(threadName).tasks.push(task);
      });

      const finalized = sortAndFinalizeLanes([...grouped.values()]);
      return finalizeDataset(fileName, raw, finalized, 'trace');
    }

    if (Array.isArray(raw)) {
      const allTasks = [];
      raw.forEach((entry) => {
        (entry?.tasks || []).forEach((task) => {
          allTasks.push(Number(task?.execStart) || 0);
        });
      });
      const minTs = allTasks.length ? Math.min(...allTasks) : 0;
      const grouped = raw.map((entry, laneIndex) => ({
        threadName: String(entry?.coreType || `Core_${laneIndex}`),
        laneKind: laneKindFromName(entry?.coreType || `Core_${laneIndex}`),
        tasks: Array.isArray(entry?.tasks)
          ? entry.tasks.map((task, taskIndex) => parseCoreTask(entry, laneIndex, task, taskIndex, minTs))
          : [],
      }));
      const finalized = sortAndFinalizeLanes(grouped);
      return finalizeDataset(fileName, raw, finalized, 'core-task');
    }

    throw new Error('Unsupported swimlane json format.');
  }

  function finalizeDataset(fileName, raw, finalized, format) {
    const taskMap = new Map();
    const taskKeyMap = new Map();
    let totalTasks = 0;
    let totalWorkDuration = 0;
    finalized.lanes.forEach((lane) => {
      lane.tasks.forEach((task) => {
        totalTasks += 1;
        totalWorkDuration += task.dur;
        taskMap.set(task.id, task);
        const composite = makeTaskCompositeKey(task);
        if (composite && !taskKeyMap.has(composite)) taskKeyMap.set(composite, task);
      });
    });
    return {
      name: fileName,
      raw,
      format,
      lanes: finalized.lanes,
      span: finalized.span,
      taskMap,
      taskKeyMap,
      labels: finalized.labels,
      kinds: finalized.kinds,
      sequences: finalized.sequences,
      totalTasks,
      totalWorkDuration,
      laneCount: finalized.lanes.length,
      laneMap: new Map(finalized.lanes.map((lane) => [lane.threadName, lane])),
    };
  }

  function makeTaskCompositeKey(task) {
    const callOpMagic = normalizeOpaqueId(task.callOpMagic);
    if (callOpMagic) return `magic::${callOpMagic}`;
    const rootHash = normalizeOpaqueId(task.rootHash);
    const leafHash = normalizeOpaqueId(task.leafHash);
    if (rootHash || leafHash) return `hash::${rootHash || 'na'}::${leafHash || 'na'}::${task.seqNo != null ? task.seqNo : 'na'}::${task.label || ''}`;
    const lane = task.threadName || '';
    const seq = task.seqNo != null ? task.seqNo : 'na';
    const taskId = task.taskId != null ? task.taskId : task.id;
    return `${lane}::${seq}::${taskId}`;
  }

  function chipHtml(text) {
    return `<span class="stat-chip">${escapeHtml(text)}</span>`;
  }

  function statusPillHtml(label, value, tone = 'is-muted') {
    return `<span class="sw-status-pill ${tone}">
      <span class="sw-status-pill-label">${escapeHtml(label)}</span>
      <span class="sw-status-pill-value">${escapeHtml(value)}</span>
    </span>`;
  }

  function resourceRowHtml(label, value, tone = 'is-muted') {
    return `<div class="sw-resource-status-row ${tone}">
      <span class="sw-resource-status-label">${escapeHtml(label)}</span>
      <span class="sw-resource-status-value">${escapeHtml(value)}</span>
    </div>`;
  }

  function renderSummary() {
    const dataset = state.datasets.primary;
    if (!dataset) {
      dom.summary.innerHTML = '';
      return;
    }
    const primaryAic = dataset.kinds.aic || { laneCount: 0, avgUtilization: 0 };
    const primaryAiv = dataset.kinds.aiv || { laneCount: 0, avgUtilization: 0 };
    const chips = [
      chipHtml(`lanes ${dataset.laneCount}`),
      chipHtml(`tasks ${formatNumber(dataset.totalTasks)}`),
      chipHtml(`span ${formatTick(dataset.span)}`),
      chipHtml(`AIC ${primaryAic.laneCount} · ${formatPercent(primaryAic.avgUtilization)}`),
      chipHtml(`AIV ${primaryAiv.laneCount} · ${formatPercent(primaryAiv.avgUtilization)}`),
    ];
    dom.summary.innerHTML = chips.join('');
  }

  function renderBindingStatus() {
    const primary = state.datasets.primary;
    const compare = state.datasets.compare;
    const pills = [];
    if (primary) pills.push(statusPillHtml('主', primary.name, 'is-bound'));
    if (compare) pills.push(statusPillHtml('参', compare.name, 'is-compare'));
    if (state.bindings.program) pills.push(statusPillHtml('Program', state.bindings.program.name, 'is-program'));
    if (state.bindings.moduleDir?.sourceName) pills.push(statusPillHtml('码', state.bindings.moduleDir.sourceName, 'is-source'));
    if (dom.bindingStatus) dom.bindingStatus.innerHTML = pills.join('');
    renderResourcePanel();
  }

  function renderResourcePanel() {
    if (dom.resourceFolderStatus) {
      if (state.bindings.moduleDir) {
        dom.resourceFolderStatus.innerHTML = [
          resourceRowHtml('目录', state.bindings.moduleDir.name, 'is-bound'),
          resourceRowHtml('主泳道', state.bindings.moduleDir.primaryName || '未识别', state.bindings.moduleDir.primaryName ? 'is-bound' : 'is-muted'),
          resourceRowHtml('参考泳道', state.bindings.moduleDir.compareName || '未识别', state.bindings.moduleDir.compareName ? 'is-compare' : 'is-muted'),
          resourceRowHtml('Program', state.bindings.moduleDir.programName || '未识别', state.bindings.moduleDir.programName ? 'is-program' : 'is-muted'),
          resourceRowHtml('源码', state.bindings.moduleDir.sourceName || '未识别', state.bindings.moduleDir.sourceName ? 'is-source' : 'is-muted'),
        ].join('');
      } else {
        dom.resourceFolderStatus.innerHTML = resourceRowHtml('目录', '未绑定模块目录', 'is-muted');
      }
    }

    if (dom.resourceFilesStatus) {
      dom.resourceFilesStatus.innerHTML = [
        resourceRowHtml('主泳道', state.datasets.primary ? state.datasets.primary.name : '未载入', state.datasets.primary ? 'is-bound' : 'is-muted'),
        resourceRowHtml('参考泳道', state.datasets.compare ? state.datasets.compare.name : '未绑定', state.datasets.compare ? 'is-compare' : 'is-muted'),
        resourceRowHtml('Program', state.bindings.program ? state.bindings.program.name : '未绑定', state.bindings.program ? 'is-program' : 'is-muted'),
      ].join('');
    }
  }

  function laneKindsPresent() {
    const dataset = state.datasets.primary;
    if (!dataset) return [];
    const order = ['fake', 'aic', 'aiv', 'aicpu', 'other'];
    return order.filter((kind) => dataset.lanes.some((lane) => lane.laneKind === kind));
  }

  function renderLaneKindFilters() {
    const kindLabels = {
      fake: 'Fake',
      aic: 'AIC',
      aiv: 'AIV',
      aicpu: 'AICPU',
      other: 'Other',
    };
    const kinds = laneKindsPresent();
    dom.laneKindFilters.innerHTML = kinds.map((kind) => {
      const active = state.filters.laneKinds.has(kind);
      const color = colorForTask({ label: kind === 'fake' ? 'fake' : (kind === 'aic' ? 'Query-Linear' : (kind === 'aiv' ? 'Prolog-Quant' : 'unknown')), seqNo: 0 }, 'semantic');
      return `
        <button type="button" class="sw-chip-btn${active ? ' is-active' : ''}" data-kind-filter="${kind}">
          <span class="sw-chip-btn-dot" style="background:${color}"></span>
          ${kindLabels[kind] || kind}
        </button>`;
    }).join('');
    dom.laneKindFilters.querySelectorAll('[data-kind-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const kind = button.dataset.kindFilter;
        if (!kind) return;
        if (state.filters.laneKinds.has(kind)) {
          state.filters.laneKinds.delete(kind);
        } else {
          state.filters.laneKinds.add(kind);
        }
        if (!state.filters.laneKinds.size) state.filters.laneKinds.add(kind);
        renderAll();
      });
    });
  }

  function renderSeqFilters() {
    const seqs = collectAvailableSeqs();
    dom.seqFilters.innerHTML = seqs.map((seq) => {
      const active = state.filters.seqNos.size === 0 || state.filters.seqNos.has(seq);
      const color = STITCH_COLORS[Math.abs(seq) % STITCH_COLORS.length];
      return `
        <button type="button" class="sw-chip-btn${active ? ' is-active' : ' is-muted'}" data-seq-filter="${seq}">
          <span class="sw-chip-btn-dot" style="background:${color}"></span>
          Stitch ${seq}
        </button>`;
    }).join('');
    if (!seqs.length) {
      dom.seqFilters.innerHTML = '<div class="sw-list-empty">当前数据没有 stitch 维度。</div>';
      return;
    }
    dom.seqFilters.querySelectorAll('[data-seq-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const seq = Number(button.dataset.seqFilter);
        if (Number.isNaN(seq)) return;
        if (state.filters.seqNos.size === 0) {
          collectAvailableSeqs().forEach((item) => state.filters.seqNos.add(item));
        }
        if (state.filters.seqNos.has(seq)) state.filters.seqNos.delete(seq);
        else state.filters.seqNos.add(seq);
        if (state.filters.seqNos.size === collectAvailableSeqs().length) state.filters.seqNos.clear();
        renderAll();
      });
    });
  }

  function collectAvailableSeqs() {
    const seqs = new Set();
    ['primary', 'compare'].forEach((key) => {
      const dataset = state.datasets[key];
      if (!dataset) return;
      dataset.sequences.forEach((seq) => seqs.add(seq));
    });
    return [...seqs].sort((a, b) => a - b);
  }

  function shouldShowTask(task) {
    if (!state.filters.laneKinds.has(task.laneKind)) return false;
    if (state.filters.seqNos.size > 0 && task.seqNo != null && !state.filters.seqNos.has(task.seqNo)) return false;
    if (state.filters.seqNos.size > 0 && task.seqNo == null) return false;
    return true;
  }

  function getVisibleLanes(dataset) {
    if (!dataset) return [];
    const lanes = dataset.lanes
      .filter((lane) => state.filters.laneKinds.has(lane.laneKind))
      .map((lane) => {
        const visibleTasks = lane.tasks.filter(shouldShowTask);
        const visibleWork = visibleTasks.reduce((sum, task) => sum + task.dur, 0);
        const visibleMaxGap = visibleTasks.reduce((max, task) => Math.max(max, task.gapBefore || 0), 0);
        const visibleBubbleCount = visibleTasks.reduce((count, task) => count + ((task.gapBefore || 0) >= GAP_EMPHASIS_US ? 1 : 0), 0);
        return {
          lane,
          visibleTasks,
          visibleWork,
          visibleMaxGap,
          visibleBubbleCount,
          visibleUtilization: lane.wallSpan > 0 ? visibleWork / lane.wallSpan : 0,
        };
      })
      .filter((entry) => entry.visibleTasks.length > 0 || state.filters.seqNos.size === 0);

    const sorters = {
      default: (a, b) => laneRank(a.lane.threadName) - laneRank(b.lane.threadName) || laneNumber(a.lane.threadName) - laneNumber(b.lane.threadName),
      gap: (a, b) => b.visibleMaxGap - a.visibleMaxGap || b.lane.maxGap - a.lane.maxGap,
      util: (a, b) => b.visibleUtilization - a.visibleUtilization || b.lane.utilization - a.lane.utilization,
      taskCount: (a, b) => b.visibleTasks.length - a.visibleTasks.length || b.lane.taskCount - a.lane.taskCount,
      duration: (a, b) => b.visibleWork - a.visibleWork || b.lane.workDuration - a.lane.workDuration,
    };

    return lanes.sort(sorters[state.filters.sortMode] || sorters.default);
  }

  function computeVisibleSeqGap(tasks) {
    const seqGroups = new Map();
    tasks.forEach((task) => {
      if (task.seqNo == null) return;
      if (!seqGroups.has(task.seqNo)) seqGroups.set(task.seqNo, []);
      seqGroups.get(task.seqNo).push(task);
    });
    const seqKeys = [...seqGroups.keys()].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 0; i < seqKeys.length - 1; i += 1) {
      const cur = seqGroups.get(seqKeys[i]);
      const next = seqGroups.get(seqKeys[i + 1]);
      gaps.push(Math.max(0, next[0].relTs - cur[cur.length - 1].relEnd));
    }
    return gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : 0;
  }

  function computeVisibleLaneSpan(tasks) {
    if (!tasks.length) return 0;
    return Math.max(1, tasks[tasks.length - 1].relEnd - tasks[0].relTs);
  }

  function buildVisibleSummary(dataset) {
    const visibleLanes = getVisibleLanes(dataset);
    const labelStats = new Map();
    const kindStats = new Map();
    let totalTasks = 0;
    let totalWorkDuration = 0;
    let minTs = Infinity;
    let maxEnd = 0;

    visibleLanes.forEach((entry) => {
      const kind = entry.lane.laneKind;
      if (!kindStats.has(kind)) {
        kindStats.set(kind, {
          laneCount: 0,
          taskCount: 0,
          workDuration: 0,
          utilizationTotal: 0,
          maxGapTotal: 0,
          seqGapTotal: 0,
        });
      }
      const kindEntry = kindStats.get(kind);
      kindEntry.laneCount += 1;
      kindEntry.taskCount += entry.visibleTasks.length;
      kindEntry.workDuration += entry.visibleWork;
      kindEntry.utilizationTotal += entry.visibleUtilization;
      kindEntry.maxGapTotal += entry.visibleMaxGap;
      kindEntry.seqGapTotal += computeVisibleSeqGap(entry.visibleTasks);

      entry.visibleTasks.forEach((task) => {
        totalTasks += 1;
        totalWorkDuration += task.dur;
        minTs = Math.min(minTs, task.relTs);
        maxEnd = Math.max(maxEnd, task.relEnd);

        const label = task.label || 'unknown';
        if (!labelStats.has(label)) {
          labelStats.set(label, {
            label,
            count: 0,
            totalDur: 0,
            maxDur: 0,
            kinds: new Set(),
          });
        }
        const labelEntry = labelStats.get(label);
        labelEntry.count += 1;
        labelEntry.totalDur += task.dur;
        labelEntry.maxDur = Math.max(labelEntry.maxDur, task.dur);
        labelEntry.kinds.add(task.laneKind);
      });
    });

    const labels = [...labelStats.values()].sort((a, b) => b.totalDur - a.totalDur || b.count - a.count);
    const kinds = {};
    kindStats.forEach((value, key) => {
      kinds[key] = {
        laneCount: value.laneCount,
        taskCount: value.taskCount,
        workDuration: value.workDuration,
        avgUtilization: value.laneCount ? value.utilizationTotal / value.laneCount : 0,
        avgMaxGap: value.laneCount ? value.maxGapTotal / value.laneCount : 0,
        avgSeqGap: value.laneCount ? value.seqGapTotal / value.laneCount : 0,
      };
    });

    return {
      visibleLanes,
      labels,
      kinds,
      totalTasks,
      totalWorkDuration,
      laneCount: visibleLanes.length,
      span: Number.isFinite(minTs) ? Math.max(1, maxEnd - minTs) : 0,
      laneMap: new Map(visibleLanes.map((entry) => [entry.lane.threadName, entry])),
    };
  }

  function getSharedSpan() {
    const spans = ['primary', 'compare']
      .map((key) => state.datasets[key]?.span || 0)
      .filter((value) => value > 0);
    return spans.length ? Math.max(...spans) : 1;
  }

  function renderTimeline(refs, span) {
    refs.timelineTrack.innerHTML = '';
    const trackWidth = Math.max(refs.laneMainViewport.clientWidth - 24, Math.ceil(span * state.pxPerUnit) + 32);
    refs.timelineTrack.style.width = `${trackWidth}px`;
    const tickStep = computeNiceStep(span);
    const minorStep = tickStep / 5;

    for (let value = 0; value <= span + 0.0001; value += minorStep) {
      const x = 16 + Math.round(value * state.pxPerUnit);
      const tick = document.createElement('div');
      tick.className = (Math.round(value / tickStep) === value / tickStep) ? 'sw-tick-major' : 'sw-tick-minor';
      tick.style.left = `${x}px`;
      refs.timelineTrack.appendChild(tick);
    }

    for (let value = 0; value <= span + 0.0001; value += tickStep) {
      const x = 16 + Math.round(value * state.pxPerUnit);
      const label = document.createElement('div');
      label.className = 'sw-tick-label';
      label.style.left = `${x}px`;
      label.textContent = formatTick(value);
      refs.timelineTrack.appendChild(label);

      const sub = document.createElement('div');
      sub.className = 'sw-tick-sub';
      sub.style.left = `${x}px`;
      sub.textContent = formatNumber(value * 1000);
      refs.timelineTrack.appendChild(sub);
    }
  }

  function renderChart(chartKey) {
    const refs = chartRefs[chartKey];
    const dataset = state.datasets[chartKey];
    const isCompare = chartKey === 'compare';

    if (!dataset || (isCompare && !state.compareMode)) {
      refs.panel.hidden = true;
      if (refs.overlay) {
        refs.overlay.remove();
        refs.overlay = null;
      }
      refs.barElements.clear();
      refs.laneElements.clear();
      return;
    }

    refs.panel.hidden = false;
    refs.laneMainViewport.style.cursor = state.measureMode ? 'crosshair' : '';
    const visible = getVisibleLanes(dataset);
    const sharedSpan = getSharedSpan();

    refs.panelTitle.textContent = isCompare ? 'Reference' : 'Primary';
    refs.panelMeta.textContent = `${dataset.name} · ${visible.length}/${dataset.laneCount} lanes · ${formatTick(dataset.span)}`;
    refs.laneHeader.textContent = `${dataset.name}`;

    renderTimeline(refs, sharedSpan);
    refs.laneLabelTrack.innerHTML = '';
    refs.laneMainTrack.innerHTML = '';
    refs.barElements.clear();
    refs.laneElements.clear();

    const trackWidth = Math.max(refs.laneMainViewport.clientWidth - 24, Math.ceil(sharedSpan * state.pxPerUnit) + 32);
    refs.laneMainTrack.style.width = `${trackWidth}px`;

    let cursorTop = 0;
    visible.forEach((entry) => {
      const lane = entry.lane;
      const metrics = laneMetrics(lane.laneKind, lane.lineCount);
      lane._metrics = metrics;
      lane._top = cursorTop;
      lane._height = metrics.laneHeight;
      cursorTop += metrics.laneHeight;
    });

    refs.laneLabelTrack.style.height = `${cursorTop}px`;
    refs.laneMainTrack.style.height = `${cursorTop}px`;

    visible.forEach((entry) => {
      const lane = entry.lane;
      const metrics = lane._metrics;

      const labelRow = document.createElement('button');
      labelRow.type = 'button';
      labelRow.className = 'sw-lane-label-row';
      labelRow.style.top = `${lane._top}px`;
      labelRow.style.height = `${lane._height}px`;
      if (state.selectedTaskRef && state.selectedTaskRef.threadName === lane.threadName) labelRow.classList.add('is-selected');

      const copy = document.createElement('div');
      copy.className = 'sw-lane-label-copy';

      const name = document.createElement('div');
      name.className = 'sw-lane-label-name';
      name.textContent = lane.threadName;

      const meta = document.createElement('div');
      meta.className = 'sw-lane-label-meta';
      meta.textContent = `${entry.visibleTasks.length} tasks · util ${formatPercent(entry.visibleUtilization)} · max gap ${formatTick(entry.visibleMaxGap)}`;

      copy.appendChild(name);
      copy.appendChild(meta);

      const count = document.createElement('div');
      count.className = 'sw-lane-label-count';
      count.textContent = `${Math.round(entry.visibleUtilization * 100)}%`;

      labelRow.appendChild(copy);
      labelRow.appendChild(count);
      labelRow.addEventListener('click', () => {
        focusLane(chartKey, lane.threadName);
      });
      refs.laneLabelTrack.appendChild(labelRow);
      refs.laneElements.set(lane.threadName, labelRow);

      const laneRow = document.createElement('div');
      laneRow.className = 'sw-lane-row';
      laneRow.style.top = `${lane._top}px`;
      laneRow.style.height = `${lane._height}px`;
      refs.laneMainTrack.appendChild(laneRow);

      if (state.showBubbles) {
        entry.visibleTasks.forEach((task) => {
          const gap = task.gapBefore || 0;
          if (gap < GAP_EMPHASIS_US) return;
          const bubble = document.createElement('div');
          bubble.className = `sw-gap${gap >= STRONG_GAP_US ? ' is-strong' : ''}`;
          bubble.style.left = `${16 + Math.round((task.relTs - gap) * state.pxPerUnit)}px`;
          bubble.style.top = `${lane._top + 2}px`;
          bubble.style.width = `${Math.max(2, Math.round(gap * state.pxPerUnit))}px`;
          bubble.style.height = `${Math.max(8, lane._height - 4)}px`;
          bubble.title = `${lane.threadName} bubble ${formatTick(gap)}`;
          refs.laneMainTrack.appendChild(bubble);
        });
      }

      entry.visibleTasks.forEach((task) => {
        const bar = document.createElement('button');
        const widthPx = Math.max(3, Math.round(task.dur * state.pxPerUnit));
        bar.type = 'button';
        bar.className = 'sw-bar';
        bar.style.left = `${16 + Math.round(task.relTs * state.pxPerUnit)}px`;
        bar.style.top = `${lane._top + metrics.topPad + task.line * (metrics.barHeight + metrics.lineGap)}px`;
        bar.style.width = `${widthPx}px`;
        bar.style.height = `${metrics.barHeight}px`;
        bar.style.background = colorForTask(task, state.filters.colorMode);
        bar.dataset.taskId = task.id;
        bar.dataset.chartKey = chartKey;
        bar.dataset.search = `${task.rawName} ${task.label} ${task.threadName} ${task.seqNo ?? ''} ${task.callOpMagic ?? ''} ${task.rootHash ?? ''} ${task.leafHash ?? ''} ${task.inputRawMagic.join(' ')} ${task.outputRawMagic.join(' ')}`.toLowerCase();
        bar.title = `${task.rawName}\n${task.threadName}\nstart=${task.relTs.toFixed(2)} end=${task.relEnd.toFixed(2)} dur=${task.dur.toFixed(2)}\nseq=${task.seqNo ?? '—'} gap=${formatTick(task.gapBefore || 0)}`;
        bar.addEventListener('click', () => {
          selectTask(chartKey, task.id);
          showTaskPopup(task, lane, chartKey, bar);
        });

        const segmentWrap = document.createElement('span');
        segmentWrap.className = 'sw-bar-segments';
        buildTaskSegmentSpec(task, widthPx).forEach((segment) => {
          const label = document.createElement('span');
          label.className = segment.className;
          label.textContent = segment.text;
          segmentWrap.appendChild(label);
        });
        bar.appendChild(segmentWrap);
        refs.laneMainTrack.appendChild(bar);
        refs.barElements.set(task.id, bar);
      });
    });

    renderOverlay(chartKey, sharedSpan);
    syncOverlay(chartKey);
  }

  function renderOverlay(chartKey, span) {
    const refs = chartRefs[chartKey];
    if (refs.overlay) refs.overlay.remove();

    const overlay = document.createElement('div');
    overlay.className = 'sw-overlay-layer';

    if (state.range.start != null && state.range.end != null) {
      const start = Math.min(state.range.start, state.range.end);
      const end = Math.max(state.range.start, state.range.end);
      const fill = document.createElement('div');
      fill.className = 'sw-range-fill';
      fill.style.left = `${16 + Math.round(start * state.pxPerUnit)}px`;
      fill.style.width = `${Math.max(2, Math.round((end - start) * state.pxPerUnit))}px`;
      overlay.appendChild(fill);
    }

    if (state.hoverTime != null && state.hoverTime >= 0 && state.hoverTime <= span) {
      const line = document.createElement('div');
      line.className = 'sw-ruler-line';
      line.style.left = `${16 + Math.round(state.hoverTime * state.pxPerUnit)}px`;
      overlay.appendChild(line);

      const tag = document.createElement('div');
      tag.className = 'sw-ruler-tag';
      tag.style.left = `${16 + Math.round(state.hoverTime * state.pxPerUnit)}px`;
      tag.textContent = formatTick(state.hoverTime);
      overlay.appendChild(tag);
    }

    state.markers.forEach((marker) => {
      const markerLine = document.createElement('div');
      markerLine.className = 'sw-marker-line';
      markerLine.style.left = `${16 + Math.round(marker.time * state.pxPerUnit)}px`;
      overlay.appendChild(markerLine);

      const flag = document.createElement('button');
      flag.type = 'button';
      flag.className = 'sw-marker-flag';
      flag.style.left = `${16 + Math.round(marker.time * state.pxPerUnit)}px`;
      flag.style.borderColor = marker.color;
      flag.style.color = marker.color;
      flag.textContent = marker.label;
      flag.title = '单击删除，双击重命名';
      flag.addEventListener('click', (event) => {
        event.stopPropagation();
        removeMarker(marker.id);
      });
      flag.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        renameMarker(marker.id);
      });
      overlay.appendChild(flag);
    });

    refs.laneMainTrack.appendChild(overlay);
    refs.overlay = overlay;
  }

  function renderOverlaysOnly() {
    const sharedSpan = getSharedSpan();
    ['primary', 'compare'].forEach((chartKey) => {
      const refs = chartRefs[chartKey];
      const dataset = state.datasets[chartKey];
      if (!dataset || refs.panel.hidden) {
        if (refs.overlay) {
          refs.overlay.remove();
          refs.overlay = null;
        }
        return;
      }
      renderOverlay(chartKey, sharedSpan);
      syncOverlay(chartKey);
    });
  }

  function scheduleOverlayRender() {
    if (overlayRenderFrame) return;
    overlayRenderFrame = window.requestAnimationFrame(() => {
      overlayRenderFrame = 0;
      renderOverlaysOnly();
    });
  }

  function syncOverlay(chartKey) {
    const refs = chartRefs[chartKey];
    const scrollTop = refs.laneMainViewport.scrollTop;
    const scrollLeft = refs.laneMainViewport.scrollLeft;
    refs.laneLabelTrack.style.transform = `translateY(${-scrollTop}px)`;
    refs.timelineTrack.style.transform = `translateX(${-scrollLeft}px)`;
  }

  function mapSwimlaneColorModeToPassIr(mode) {
    if (mode === 'semantic') return 'semantic';
    if (mode === 'subgraph') return 'subgraph';
    if (mode === 'engine') return 'engineMemory';
    return null;
  }

  function syncSplitPassIrColorMode() {
    if (state.splitSource !== 'pass-ir') return;
    const iframe = document.getElementById('swGraphIframe');
    const mode = mapSwimlaneColorModeToPassIr(state.filters.colorMode);
    if (!iframe?.contentWindow || !mode) return;
    iframe.contentWindow.postMessage({
      type: PASS_IR_COLOR_SYNC_EVENT,
      mode,
    }, window.location.origin);
  }

  function focusLane(chartKey, threadName) {
    const refs = chartRefs[chartKey];
    const dataset = state.datasets[chartKey];
    if (!dataset) return;
    const lane = dataset.laneMap.get(threadName);
    if (!lane) return;
    refs.laneMainViewport.scrollTo({
      top: Math.max(0, lane._top - refs.laneMainViewport.clientHeight / 2),
      behavior: 'smooth',
    });
  }

  function selectTask(chartKey, taskId) {
    state.selectedTaskRef = {
      chartKey,
      taskId,
      threadName: state.datasets[chartKey]?.taskMap.get(taskId)?.threadName || null,
    };
    openTaskDetail(chartKey, taskId);
    updateBarSelection();
    renderLaneInsightCards();
  }

  function updateBarSelection() {
    ['primary', 'compare'].forEach((chartKey) => {
      const refs = chartRefs[chartKey];
      refs.barElements.forEach((bar, taskId) => {
        const isSelectedTask = !!state.selectedTaskRef && state.selectedTaskRef.taskId === taskId && state.selectedTaskRef.chartKey === chartKey;
        const isActiveMatch = state.activeMatchIndex >= 0
          && state.matches[state.activeMatchIndex]?.chartKey === chartKey
          && state.matches[state.activeMatchIndex]?.bar === bar;
        bar.classList.toggle('is-active', isSelectedTask || isActiveMatch);
      });
      refs.laneElements.forEach((row, threadName) => {
        row.classList.toggle('is-selected', !!state.selectedTaskRef && state.selectedTaskRef.threadName === threadName);
      });
    });
  }

  function openTaskDetail(chartKey, taskId) {
    const dataset = state.datasets[chartKey];
    const task = dataset?.taskMap.get(taskId);
    if (!task) return;
    const lane = dataset.laneMap.get(task.threadName);
    const compareTask = findCompareTask(task, chartKey);
    const typeStyles = {
      fake: { bg: 'rgba(92,99,112,0.18)', color: '#cfd4dc', label: 'FAKE' },
      aic: { bg: 'rgba(123,87,191,0.18)', color: '#cdb8ff', label: 'AIC' },
      aiv: { bg: 'rgba(77,121,212,0.18)', color: '#bfd4ff', label: 'AIV' },
      aicpu: { bg: 'rgba(77,165,109,0.18)', color: '#c4f2d0', label: 'AICPU' },
      other: { bg: 'rgba(255,255,255,0.12)', color: '#ffffff', label: 'TASK' },
    };
    const style = typeStyles[task.laneKind] || typeStyles.other;
    dom.detailBadge.textContent = style.label;
    dom.detailBadge.style.background = style.bg;
    dom.detailBadge.style.color = style.color;
    dom.detailName.textContent = task.rawName;
    dom.detailDataset.textContent = `${chartKey === 'compare' ? 'Reference' : 'Primary'} · ${dataset.name}`;
    dom.detailBody.innerHTML = buildDetailHtml(task, lane, compareTask);
    wireDetailButtons(task);
    dom.detailPanel.classList.add('open');
  }

  function closeDetail() {
    dom.detailPanel.classList.remove('open');
  }

  function buildDetailHtml(task, lane, compareTask) {
    const actionDisabled = !canTaskOpenPassIr(task);
    const actionRow = `
      <div class="detail-section">
        <div class="detail-section-title">Actions</div>
        <div class="sw-detail-actions">
          <button class="sw-detail-btn" data-detail-action="open-pass-ir"${actionDisabled ? ' disabled' : ''}>Open Pass IR</button>
          ${task.label ? '<button class="sw-detail-btn" data-detail-action="open-source-flow">Open Source Flow</button>' : ''}
        </div>
        <div class="sw-detail-note">${state.bindings.program ? `当前 Program: ${escapeHtml(state.bindings.program.name)}` : 'Program 入口已收口到顶部“资源”面板。'}</div>
      </div>`;

    const timingRows = [
      ['start', formatTick(task.relTs)],
      ['end', formatTick(task.relEnd)],
      ['duration', formatTick(task.dur)],
      ['gap_before', formatTick(task.gapBefore || 0)],
      ['gap_after', formatTick(task.gapAfter || 0)],
      ['lane_util', formatPercent(lane?.utilization ?? 0)],
      ['lane_max_gap', formatTick(lane?.maxGap ?? 0)],
    ];

    const graphRows = [
      ['seqNo', task.seqNo ?? '—'],
      ['taskId', task.taskId ?? '—'],
      ['subgraph', task.subGraphId ?? task.subgraphKey ?? '—'],
      ['callOpMagic', task.callOpMagic ?? '—'],
      ['rootHash', task.rootHash ?? '—'],
      ['leafHash', task.leafHash ?? '—'],
    ];

    const operandRows = [
      ['inputs', task.inputRawMagic.length ? task.inputRawMagic.join(', ') : '—'],
      ['outputs', task.outputRawMagic.length ? task.outputRawMagic.join(', ') : '—'],
    ];

    const compareSection = compareTask
      ? detailSection('Compare', [
        ['counterpart', compareTask.rawName],
        ['duration', `${formatTick(compareTask.dur)} (${signedTickDelta(task.dur - compareTask.dur)})`],
        ['gap_before', `${formatTick(compareTask.gapBefore || 0)} (${signedTickDelta((task.gapBefore || 0) - (compareTask.gapBefore || 0))})`],
      ])
      : '';

    const hintSection = task.eventHint || task.executionHint
      ? detailSection('Hints', [
        ...(task.eventHint ? [['event-hint', task.eventHint]] : []),
        ...(task.executionHint ? [['execution-hint', task.executionHint]] : []),
      ])
      : '';

    return [
      detailSection('Task', [
        ['label', task.label],
        ['lane', task.threadName],
        ['display', task.displayName || '—'],
      ]),
      detailSection('Timing', timingRows),
      detailSection('Graph Anchors', graphRows),
      detailSection('Operands', operandRows),
      compareSection,
      hintSection,
      actionRow,
    ].join('');
  }

  function detailSection(title, rows) {
    return `<div class="detail-section">
      <div class="detail-section-title">${escapeHtml(title)}</div>
      ${rows.map(([key, value]) => `
        <div class="detail-row">
          <span class="detail-row-key">${escapeHtml(String(key))}</span>
          <span class="detail-row-val">${escapeHtml(String(value ?? '—'))}</span>
        </div>`).join('')}
    </div>`;
  }

  function signedTickDelta(value) {
    if (!Number.isFinite(value) || value === 0) return '0';
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${formatTick(Math.abs(value))}`;
  }

  function findCompareTask(task, chartKey) {
    const otherKey = chartKey === 'primary' ? 'compare' : 'primary';
    const otherDataset = state.datasets[otherKey];
    if (!otherDataset) return null;
    const composite = makeTaskCompositeKey(task);
    return otherDataset.taskKeyMap.get(composite) || null;
  }

  function canTaskOpenPassIr(task) {
    return !!(task && state.bindings.program && (task.callOpMagic != null || task.label));
  }

  function canOpenPassIrView() {
    return !!state.bindings.program;
  }

  function canTaskOpenSourceFlow(task) {
    return !!(task && task.label);
  }

  function canOpenSourceFlowView() {
    return !!(state.bindings.moduleDir?.sourceText || state.bindings.moduleDir?.sourceName);
  }

  function getSelectedTaskState() {
    const ref = state.selectedTaskRef;
    if (!ref) {
      return {
        ref: null,
        task: null,
        dependencyTask: null,
        canShowDeps: false,
        canOpenPassIr: ENABLE_SPLIT_VIEW && canOpenPassIrView(),
        canOpenSourceFlow: ENABLE_SPLIT_VIEW && canOpenSourceFlowView(),
        passIrActionLabel: canOpenPassIrView() ? '打开 Pass IR' : 'Pass IR 分屏联动',
        sourceFlowActionLabel: canOpenSourceFlowView() ? '打开 Source Flow' : 'Source Flow 分屏联动',
        depReason: '先点击一个 task，再做深入联动。',
        passIrReason: state.bindings.program ? '未选中 task 时会先打开整体 Pass IR 视图。' : '先绑定 program.json 或整个模块目录。',
        sourceFlowReason: canOpenSourceFlowView() ? '未选中 task 时会先打开整体 Source Flow 视图。' : '先选择模块目录中的源码文件。',
      };
    }

    const dataset = state.datasets[ref.chartKey];
    const task = dataset?.taskMap.get(ref.taskId) || null;
    const dependencyTask = ref.chartKey === 'primary'
      ? task
      : (task ? findCompareTask(task, ref.chartKey) : null);

    const canShowDeps = !!dependencyTask;
    const taskCanOpenPassIr = canTaskOpenPassIr(task);
    const taskCanOpenSourceFlow = canTaskOpenSourceFlow(task);
    const canOpenPassIr = ENABLE_SPLIT_VIEW && (taskCanOpenPassIr || canOpenPassIrView());
    const canOpenSourceFlow = ENABLE_SPLIT_VIEW && (taskCanOpenSourceFlow || canOpenSourceFlowView());

    return {
      ref,
      task,
      dependencyTask,
      canShowDeps,
      canOpenPassIr,
      canOpenSourceFlow,
      passIrActionLabel: taskCanOpenPassIr ? 'Pass IR 分屏联动' : '打开 Pass IR',
      sourceFlowActionLabel: taskCanOpenSourceFlow ? 'Source Flow 分屏联动' : '打开 Source Flow',
      depReason: canShowDeps
        ? (ref.chartKey === 'primary' ? '主图会高亮当前任务的前后依赖。' : '将切回主图并高亮对应任务的前后依赖。')
        : (task ? '当前对比任务在主图里没有找到可映射的依赖视角。' : '先点击一个 task，再做深入联动。'),
      passIrReason: taskCanOpenPassIr
        ? '将带着当前任务焦点打开可交互 Pass IR 分屏。'
        : (!state.bindings.program
          ? '先绑定 program.json 或整个模块目录。'
          : '当前任务缺少定位锚点，将先打开整体 Pass IR 视图。'),
      sourceFlowReason: taskCanOpenSourceFlow
        ? '将按 semantic label 打开 Source Flow 分屏。'
        : (canOpenSourceFlowView()
          ? '当前任务缺少 semantic label，将先打开整体 Source Flow 视图。'
          : '先选择模块目录中的源码文件。'),
    };
  }

  function revealTaskInChart(chartKey, task) {
    const refs = chartRefs[chartKey];
    const bar = refs?.barElements.get(task?.id);
    if (!refs || !bar) return;
    const left = bar.offsetLeft + bar.offsetWidth / 2 - refs.laneMainViewport.clientWidth / 2;
    const top = bar.offsetTop + bar.offsetHeight / 2 - refs.laneMainViewport.clientHeight / 2;
    refs.laneMainViewport.scrollTo({
      left: Math.max(0, left),
      top: Math.max(0, top),
      behavior: 'smooth',
    });
  }

  function focusDependencyChainFromSelectedTask() {
    const selected = getSelectedTaskState();
    if (!selected.canShowDeps || !selected.dependencyTask) return;
    hideTaskPopup();
    if (selected.ref?.chartKey !== 'primary') clearDepLines();
    selectTask('primary', selected.dependencyTask.id);
    revealTaskInChart('primary', selected.dependencyTask);
    setUiMode(state.splitSource ? 'split' : 'default');
    renderDepLines(selected.dependencyTask);
  }

  function wireDetailButtons(task) {
    dom.detailBody.querySelectorAll('[data-detail-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.detailAction;
        if (action === 'open-pass-ir') openPassIrForTask(task);
        if (action === 'open-source-flow') openSourceFlowForTask(task);
      });
    });
  }

  function openPassIrForTask(task) {
    if (!state.bindings.program) return;
    try {
      sessionStorage.setItem(PASS_IR_META_KEY, JSON.stringify({ name: state.bindings.program.name }));
      sessionStorage.setItem(PASS_IR_TEXT_KEY, state.bindings.program.text);
      sessionStorage.setItem(PASS_IR_FOCUS_KEY, JSON.stringify({
        semanticLabel: task.label || null,
        callOpMagic: task.callOpMagic != null ? task.callOpMagic : null,
        laneName: task.threadName,
        seqNo: task.seqNo,
        source: 'swimlane',
      }));
      window.open('../pass-ir/index.html?action=open-file', '_blank');
    } catch (error) {
      console.error(error);
      alert('Failed to prepare Pass IR bridge.');
    }
  }

  function openSourceFlowForTask(task) {
    try {
      if (state.bindings.moduleDir?.sourceText && state.bindings.moduleDir?.sourceName) {
        sessionStorage.setItem(SOURCE_FLOW_META_KEY, JSON.stringify({ name: state.bindings.moduleDir.sourceName }));
        sessionStorage.setItem(SOURCE_FLOW_TEXT_KEY, state.bindings.moduleDir.sourceText);
      }
      if (task?.label) {
        sessionStorage.setItem(SOURCE_FLOW_FOCUS_KEY, JSON.stringify({
          semanticLabel: task.label || null,
          source: 'swimlane',
        }));
      } else {
        sessionStorage.removeItem(SOURCE_FLOW_FOCUS_KEY);
      }
      const sourceUrl = state.bindings.moduleDir?.sourceText && state.bindings.moduleDir?.sourceName
        ? '../source-flow/index.html?action=open-py-file'
        : '../source-flow/index.html';
      window.open(sourceUrl, '_blank');
    } catch (error) {
      console.error(error);
      alert('Failed to prepare Source Flow bridge.');
    }
  }

  function updateSearch() {
    state.filters.searchQuery = dom.searchInput.value.trim().toLowerCase();
    state.matches = [];
    state.activeMatchIndex = -1;

    ['primary', 'compare'].forEach((chartKey) => {
      const refs = chartRefs[chartKey];
      refs.barElements.forEach((bar) => {
        const query = state.filters.searchQuery;
        const isMatch = !!query && bar.dataset.search.includes(query);
        bar.classList.toggle('is-match', isMatch);
        bar.classList.toggle('is-dimmed', !!query && !isMatch);
        if (isMatch) state.matches.push({ chartKey, bar });
      });
    });

    if (state.matches.length) {
      focusMatch(0);
    } else {
      dom.searchCount.textContent = '0 / 0';
      updateBarSelection();
    }
  }

  function focusMatch(index) {
    if (!state.matches.length) {
      dom.searchCount.textContent = '0 / 0';
      return;
    }
    const nextIndex = ((index % state.matches.length) + state.matches.length) % state.matches.length;
    state.matches.forEach((match) => match.bar.classList.remove('is-active'));
    const target = state.matches[nextIndex];
    target.bar.classList.add('is-active');
    state.activeMatchIndex = nextIndex;
    dom.searchCount.textContent = `${nextIndex + 1} / ${state.matches.length}`;

    const refs = chartRefs[target.chartKey];
    refs.laneMainViewport.scrollTo({
      top: Math.max(0, target.bar.offsetTop - refs.laneMainViewport.clientHeight / 2),
      left: Math.max(0, target.bar.offsetLeft - 120),
      behavior: 'smooth',
    });
  }

  function goToNextMatch(step) {
    if (!state.matches.length) return;
    focusMatch(state.activeMatchIndex + step);
  }

  function removeMarker(markerId) {
    state.markers = state.markers.filter((marker) => marker.id !== markerId);
    renderOverlaysOnly();
  }

  function renameMarker(markerId) {
    const marker = state.markers.find((item) => item.id === markerId);
    if (!marker) return;
    const next = window.prompt('Marker label', marker.label);
    if (!next) return;
    marker.label = next;
    renderOverlaysOnly();
  }

  function addMarker(time) {
    const safeTime = Math.max(0, Math.min(getSharedSpan(), time));
    state.markers.push({
      id: state.nextMarkerId++,
      time: safeTime,
      label: `T${state.nextMarkerId - 1}`,
      color: '#79c0ff',
    });
    renderOverlaysOnly();
  }

  function getTimeFromClientX(chartKey, clientX) {
    const refs = chartRefs[chartKey];
    const rect = refs.laneMainViewport.getBoundingClientRect();
    const localX = clientX - rect.left + refs.laneMainViewport.scrollLeft - 16;
    const clamped = Math.max(0, localX);
    return clamped / state.pxPerUnit;
  }

  function syncScroll(chartKey) {
    const refs = chartRefs[chartKey];
    syncOverlay(chartKey);
    if (!state.compareMode || state.scrollSyncLock) return;
    const otherKey = chartKey === 'primary' ? 'compare' : 'primary';
    const otherRefs = chartRefs[otherKey];
    if (!state.datasets[otherKey] || otherRefs.panel.hidden) return;
    state.scrollSyncLock = true;
    otherRefs.laneMainViewport.scrollTop = refs.laneMainViewport.scrollTop;
    otherRefs.laneMainViewport.scrollLeft = refs.laneMainViewport.scrollLeft;
    syncOverlay(otherKey);
    state.scrollSyncLock = false;
  }

  function bindChartEvents(chartKey) {
    const refs = chartRefs[chartKey];
    refs.laneMainViewport.addEventListener('scroll', () => syncScroll(chartKey));

    refs.laneMainViewport.addEventListener('mousemove', (event) => {
      state.hoverTime = getTimeFromClientX(chartKey, event.clientX);
      if (state.range.selecting && state.range.chartKey === chartKey) {
        state.range.end = state.hoverTime;
      }
      scheduleOverlayRender();
    });

    refs.laneMainViewport.addEventListener('mouseleave', () => {
      if (state.range.selecting) return;
      state.hoverTime = null;
      scheduleOverlayRender();
    });

    refs.laneMainViewport.addEventListener('mousedown', (event) => {
      if (!state.measureMode) return;
      if (event.target.closest('.sw-bar')) return;
      state.range.selecting = true;
      state.range.chartKey = chartKey;
      state.range.start = getTimeFromClientX(chartKey, event.clientX);
      state.range.end = state.range.start;
      state.hoverTime = state.range.start;
      renderOverlaysOnly();
      event.preventDefault();
    });

    refs.timelineViewport.addEventListener('mousemove', (event) => {
      const rect = refs.timelineViewport.getBoundingClientRect();
      const localX = event.clientX - rect.left + refs.laneMainViewport.scrollLeft - 16;
      state.hoverTime = Math.max(0, localX) / state.pxPerUnit;
      scheduleOverlayRender();
    });

    refs.timelineViewport.addEventListener('mouseleave', () => {
      if (state.range.selecting) return;
      state.hoverTime = null;
      scheduleOverlayRender();
    });

    refs.timelineViewport.addEventListener('click', (event) => {
      const rect = refs.timelineViewport.getBoundingClientRect();
      const localX = event.clientX - rect.left + refs.laneMainViewport.scrollLeft - 16;
      addMarker(Math.max(0, localX) / state.pxPerUnit);
    });
  }

  function finishRangeSelection() {
    if (!state.range.selecting) return;
    state.range.selecting = false;
    if (state.range.start != null && state.range.end != null && Math.abs(state.range.end - state.range.start) < 2) {
      state.range.start = null;
      state.range.end = null;
    }
    renderAll();
  }

  function clearRangeSelection() {
    state.range.start = null;
    state.range.end = null;
    state.range.selecting = false;
    renderAll();
  }

  function rangeBounds() {
    if (state.range.start == null || state.range.end == null) return null;
    return {
      start: Math.min(state.range.start, state.range.end),
      end: Math.max(state.range.start, state.range.end),
    };
  }

  function overlapDuration(task, start, end) {
    const overlap = Math.min(task.relEnd, end) - Math.max(task.relTs, start);
    return Math.max(0, overlap);
  }

  function computeRangeMetrics(dataset) {
    const bounds = rangeBounds();
    if (!dataset || !bounds) return null;
    const span = Math.max(0.001, bounds.end - bounds.start);
    const visibleLanes = getVisibleLanes(dataset);
    const labelMap = new Map();
    const laneMap = new Map();
    let workAic = 0;
    let workAiv = 0;
    let workTotal = 0;
    let taskCount = 0;

    visibleLanes.forEach((entry) => {
      let laneOverlap = 0;
      entry.visibleTasks.forEach((task) => {
        const overlap = overlapDuration(task, bounds.start, bounds.end);
        if (overlap <= 0) return;
        taskCount += 1;
        laneOverlap += overlap;
        workTotal += overlap;
        if (task.laneKind === 'aic') workAic += overlap;
        if (task.laneKind === 'aiv') workAiv += overlap;

        if (!labelMap.has(task.label)) labelMap.set(task.label, 0);
        labelMap.set(task.label, labelMap.get(task.label) + overlap);
      });
      if (laneOverlap > 0) laneMap.set(entry.lane.threadName, laneOverlap);
    });

    const aicLaneCount = visibleLanes.filter((entry) => entry.lane.laneKind === 'aic').length;
    const aivLaneCount = visibleLanes.filter((entry) => entry.lane.laneKind === 'aiv').length;
    const aiCoreLaneCount = visibleLanes.filter((entry) => entry.lane.laneKind === 'aic' || entry.lane.laneKind === 'aiv').length;

    return {
      bounds,
      span,
      taskCount,
      aiCoreUtil: aiCoreLaneCount ? workTotal / (span * aiCoreLaneCount) : 0,
      cubeUtil: aicLaneCount ? workAic / (span * aicLaneCount) : 0,
      vectorUtil: aivLaneCount ? workAiv / (span * aivLaneCount) : 0,
      topLabels: [...labelMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      topLanes: [...laneMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }

  function renderRangeSummaryCard() {
    const primary = state.datasets.primary;
    const metrics = computeRangeMetrics(primary);
    if (!metrics) {
      dom.rangeSummary.innerHTML = '<div class="sw-list-empty">点击 <code>Measure</code> 后在主视图中拖拽时间范围，可立即看到该区间的利用率和热点标签。</div>';
      return;
    }
    dom.rangeSummary.innerHTML = [
      `<div class="sw-range-summary-pill">${formatTick(metrics.bounds.start)} → ${formatTick(metrics.bounds.end)} · ${formatTick(metrics.span)}</div>`,
      metricRow('AICore 利用率', formatPercent(metrics.aiCoreUtil), `${metrics.taskCount} tasks in range`),
      metricRow('Cube 利用率', formatPercent(metrics.cubeUtil), metrics.topLanes[0] ? `heaviest lane ${metrics.topLanes[0][0]}` : '—'),
      metricRow('Vector 利用率', formatPercent(metrics.vectorUtil), metrics.topLabels[0] ? `hot label ${metrics.topLabels[0][0]}` : '—'),
    ].join('');
  }

  function metricRow(title, value, sub) {
    return `
      <div class="sw-metric-row">
        <div>
          <div class="sw-ranked-item-title">${escapeHtml(title)}</div>
          <div class="sw-metric-row-sub">${escapeHtml(sub || '')}</div>
        </div>
        <div class="sw-metric-row-value">${escapeHtml(value)}</div>
      </div>`;
  }

  function renderLaneInsightCards() {
    const dataset = state.datasets.primary;
    if (!dataset) {
      dom.laneInsights.innerHTML = '';
      dom.labelInsights.innerHTML = '';
      dom.explanation.innerHTML = '';
      return;
    }

    const summary = buildVisibleSummary(dataset);
    const gapLanes = summary.visibleLanes
      .slice()
      .sort((a, b) => b.visibleMaxGap - a.visibleMaxGap || a.lane.threadKind - b.lane.threadKind)
      .slice(0, 5);
    dom.laneInsights.innerHTML = gapLanes.length
      ? gapLanes.map((entry) => `
        <div class="sw-ranked-item">
          <div class="sw-ranked-item-main">
            <div class="sw-ranked-item-title">${escapeHtml(entry.lane.threadName)}</div>
            <div class="sw-ranked-item-sub">${entry.visibleBubbleCount} visible bubbles · util ${formatPercent(entry.visibleUtilization)}</div>
          </div>
          <div class="sw-ranked-item-value">${formatTick(entry.visibleMaxGap)}</div>
        </div>`).join('')
      : '<div class="sw-list-empty">当前过滤条件下没有可见 lane。</div>';

    dom.labelInsights.innerHTML = summary.labels.length
      ? summary.labels.slice(0, 5).map((entry) => `
      <div class="sw-ranked-item">
        <div class="sw-ranked-item-main">
          <div class="sw-ranked-item-title">${escapeHtml(entry.label)}</div>
          <div class="sw-ranked-item-sub">${entry.count} tasks · kinds ${escapeHtml([...entry.kinds].join(', '))}</div>
        </div>
        <div class="sw-ranked-item-value">${formatTick(entry.totalDur)}</div>
      </div>`).join('')
      : '<div class="sw-list-empty">当前过滤条件下没有热点标签。</div>';

    const selectedDataset = state.selectedTaskRef ? state.datasets[state.selectedTaskRef.chartKey] : null;
    const selectedTask = selectedDataset?.taskMap.get(state.selectedTaskRef?.taskId) || null;
    const explanations = buildExplanations(summary, computeRangeMetrics(dataset), selectedTask);
    dom.explanation.innerHTML = explanations.length
      ? explanations.map((item) => `
        <div class="sw-explanation-item">
          <div class="sw-explanation-title">${escapeHtml(item.title)}</div>
          <div class="sw-explanation-body">${item.body}</div>
        </div>`).join('')
      : '<div class="sw-explanation-empty">没有识别到明显异常。可以切到 <code>gap</code> 排序或拉取一个局部时间区间继续看。</div>';

    renderJourneyPanel();
  }

  function buildExplanations(datasetSummary, rangeMetrics, selectedTask) {
    const items = [];
    const aic = datasetSummary.kinds.aic || { avgUtilization: 0, avgSeqGap: 0, avgMaxGap: 0 };
    const aiv = datasetSummary.kinds.aiv || { avgUtilization: 0, avgSeqGap: 0, avgMaxGap: 0 };

    if (aiv.avgUtilization < 0.36 && aiv.avgMaxGap > 120) {
      items.push({
        title: 'Vector lanes are sparse',
        body: `AIV 平均利用率只有 <code>${formatPercent(aiv.avgUtilization)}</code>，平均最大气泡约 <code>${formatTick(aiv.avgMaxGap)}</code>。这更像向量子图过碎，而不是单个 vector task 太慢。优先检查 <code>vec tile</code> 一致性，以及相关 op 是否被切进同一个同构子图。`,
      });
    }

    if (aic.avgUtilization > 0.78 && datasetSummary.labels.some((entry) => entry.label === 'Query-Linear' && entry.maxDur > 20)) {
      items.push({
        title: 'Cube is dense but still task-heavy',
        body: `AIC 已经很密，但 <code>Query-Linear</code> 仍然占据主导，单任务最长超过 <code>20μs</code>。这说明问题更可能在 <code>cube tile</code> 贴合度，而不是调度空洞。`,
      });
    }

    if (aic.avgSeqGap > 120 || aiv.avgSeqGap > 120) {
      items.push({
        title: 'Stitch barrier is visible',
        body: `lane 间跨 stitch 的平均等待仍然明显，AIC 约 <code>${formatTick(aic.avgSeqGap)}</code>，AIV 约 <code>${formatTick(aiv.avgSeqGap)}</code>。这通常意味着 workspace / pool reset 触发了串行化等待，适合用 Before/After diff 去验证 barrier 是否被消除。`,
      });
    }

    if (rangeMetrics && rangeMetrics.vectorUtil < rangeMetrics.cubeUtil * 0.55) {
      items.push({
        title: 'Selected range is vector-light',
        body: `当前区间的 Vector 利用率只有 <code>${formatPercent(rangeMetrics.vectorUtil)}</code>，明显低于 Cube 的 <code>${formatPercent(rangeMetrics.cubeUtil)}</code>。这类区间更适合看 <code>Query-Dequant / Key-LayerNorm / Key-Rope2D</code> 是否被拆散。`,
      });
    }

    if (selectedTask && selectedTask.callOpMagic != null) {
      items.push({
        title: 'This task can be chased upstream',
        body: `该 task 带有 <code>callOpMagic=${selectedTask.callOpMagic}</code>，可以直接跳到 Pass IR。相比盯着条形图本身，更重要的是确认它属于哪个 block graph，和前后依赖是否造成了额外等待。`,
      });
    }

    return items.slice(0, 3);
  }

  function renderDiffSummary() {
    const primary = state.datasets.primary;
    const compare = state.datasets.compare;
    const visible = !!(primary && compare && state.compareMode && state.comparePresentation === 'diff');
    dom.diffSummary.hidden = !visible;
    if (!visible) return;

    dom.compareStatus.textContent = `${primary.name} vs ${compare.name}`;

    const primarySummary = buildVisibleSummary(primary);
    const compareSummary = buildVisibleSummary(compare);
    const primaryAic = primarySummary.kinds.aic || { avgUtilization: 0, avgSeqGap: 0 };
    const compareAic = compareSummary.kinds.aic || { avgUtilization: 0, avgSeqGap: 0 };
    const primaryAiv = primarySummary.kinds.aiv || { avgUtilization: 0, avgSeqGap: 0 };
    const compareAiv = compareSummary.kinds.aiv || { avgUtilization: 0, avgSeqGap: 0 };
    const spanDelta = primarySummary.span - compareSummary.span;
    const aicGapDelta = primaryAic.avgSeqGap - compareAic.avgSeqGap;
    const aivGapDelta = primaryAiv.avgSeqGap - compareAiv.avgSeqGap;
    const taskDelta = primarySummary.totalTasks - compareSummary.totalTasks;

    dom.diffMetrics.innerHTML = [
      diffMetric('Span', signedTickDelta(spanDelta), spanDelta <= 0),
      diffMetric('Tasks', `${taskDelta > 0 ? '+' : ''}${taskDelta}`, taskDelta <= 0),
      diffMetric('AIC gap', signedTickDelta(aicGapDelta), aicGapDelta <= 0),
      diffMetric('AIV gap', signedTickDelta(aivGapDelta), aivGapDelta <= 0),
    ].join('');

    const top = computeLaneDiffs(primarySummary, compareSummary).slice(0, 4);
    dom.diffTopLanes.innerHTML = top.length
      ? top.map((item) => `
        <div class="sw-diff-item">
          <div class="sw-diff-item-main">
            <div class="sw-diff-item-title">${escapeHtml(item.threadName)}</div>
            <div class="sw-diff-item-sub">gap ${signedTickDelta(item.gapDelta)} · util ${(item.utilDelta > 0 ? '+' : '')}${(item.utilDelta * 100).toFixed(1)}%</div>
          </div>
          <div class="sw-diff-item-value">${signedTickDelta(item.spanDelta)}</div>
        </div>`).join('')
      : '<div class="sw-list-empty">两个 profile 暂时无法按 lane 对齐。</div>';
  }

  function diffMetric(label, valueHtml, improved) {
    return `
      <div class="sw-diff-metric">
        <div class="sw-diff-metric-label">${escapeHtml(label)}</div>
        <div class="sw-diff-metric-value ${improved ? 'is-good' : 'is-bad'}">${valueHtml}</div>
      </div>`;
  }

  function computeLaneDiffs(primary, compare) {
    const names = new Set([...primary.laneMap.keys(), ...compare.laneMap.keys()]);
    const rows = [];
    names.forEach((threadName) => {
      const a = primary.laneMap.get(threadName);
      const b = compare.laneMap.get(threadName);
      if (!a || !b) return;
      rows.push({
        threadName,
        spanDelta: computeVisibleLaneSpan(a.visibleTasks) - computeVisibleLaneSpan(b.visibleTasks),
        gapDelta: a.visibleMaxGap - b.visibleMaxGap,
        utilDelta: a.visibleUtilization - b.visibleUtilization,
      });
    });
    return rows.sort((left, right) => Math.abs(right.gapDelta) - Math.abs(left.gapDelta) || Math.abs(right.spanDelta) - Math.abs(left.spanDelta));
  }

  function renderChartsOnly() {
    renderChart('primary');
    renderChart('compare');
    updateSearch();
    updateBarSelection();
  }

  function renderAll() {
    renderControlState();
    renderSummary();
    renderBindingStatus();
    renderLaneKindFilters();
    renderSeqFilters();
    renderChartsOnly();
    renderRangeSummaryCard();
    renderLaneInsightCards();
    renderDiffSummary();
    updateMeta();
  }

  function renderControlState() {
    dom.singleViewBtn.classList.toggle('is-active', !state.compareMode);
    dom.compareViewBtn.classList.toggle('is-active', state.compareMode && state.comparePresentation === 'compare');
    dom.diffViewBtn.classList.toggle('is-active', state.compareMode && state.comparePresentation === 'diff');
    dom.measureModeBtn.classList.toggle('btn-primary', state.measureMode);
    dom.toggleBubblesBtn.classList.toggle('btn-primary', state.showBubbles);
  }

  function updateMeta() {
    const primary = state.datasets.primary;
    dom.fileMeta.textContent = primary ? primary.name : '没有载入数据';
    chartRefs.primary.laneHeader.textContent = primary ? primary.name : '';
    if (state.datasets.compare) chartRefs.compare.laneHeader.textContent = state.datasets.compare.name;
  }

  function fitZoom() {
    const primaryViewport = chartRefs.primary.laneMainViewport;
    const width = Math.max(primaryViewport.clientWidth - 40, 640);
    state.pxPerUnit = Math.max(8, width / getSharedSpan());
    renderChartsOnly();
  }

  function showViewer() {
    dom.emptyState.hidden = true;
    dom.viewer.hidden = false;
    // Auto-expand journey panel on first data load
    if (dom.journeyPanel && dom.journeyPanel.classList.contains('sw-journey-panel--hidden')) {
      dom.journeyPanel.classList.remove('sw-journey-panel--hidden');
      dom.journeyToggle && dom.journeyToggle.classList.add('sw-journey-toggle--hidden');
    }
  }

  function showEmpty() {
    dom.viewer.hidden = true;
    dom.emptyState.hidden = false;
  }

  async function loadFromObject(raw, fileName, targetKey) {
    const dataset = buildDataset(raw, fileName);
    state.datasets[targetKey] = dataset;
    if (targetKey === 'primary') {
      state.fileName = fileName;
      state.selectedTaskRef = null;
      closeDetail();
    }
    renderAll();
    showViewer();
    fitZoom();
  }

  async function loadFromText(text, fileName, targetKey) {
    const raw = JSON.parse(text);
    await loadFromObject(raw, fileName, targetKey);
  }

  async function xhrLoadText(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', file);
      xhr.onload = () => {
        if (xhr.status >= 400) reject(new Error(`Failed to load ${file}`));
        else resolve(xhr.responseText);
      };
      xhr.onerror = () => reject(new Error(`Failed to load ${file}`));
      xhr.send();
    });
  }

  async function maybeLoadBuiltin(file, targetKey) {
    const sample = getBuiltinSample(file);
    if (!sample) return false;
    await loadFromObject(sample.data, sample.name || 'builtin-swimlane.json', targetKey);
    return true;
  }

  async function loadFromQueryFile(file, targetKey) {
    if (await maybeLoadBuiltin(file, targetKey)) return true;
    const text = await xhrLoadText(file);
    await loadFromText(text, file.split('/').pop() || 'merged_swimlane.json', targetKey);
    if (targetKey === 'primary') await tryAutoBindProgram(file);
    return true;
  }

  async function tryAutoBindProgram(file) {
    if (!file || file.startsWith('builtin-')) return;
    const normalized = String(file).replace(/\\/g, '/');
    const slashIndex = normalized.lastIndexOf('/');
    if (slashIndex < 0) return;
    const sibling = `${normalized.slice(0, slashIndex)}/program.json`;
    try {
      const text = await xhrLoadText(sibling);
      await bindProgramText(text, 'program.json');
    } catch (_) {
      // best effort only
    }
  }

  async function loadFromSessionStorage() {
    const meta = sessionStorage.getItem(STORAGE_META_KEY);
    const text = sessionStorage.getItem(STORAGE_TEXT_KEY);
    if (!meta || !text) return false;
    try {
      const parsedMeta = JSON.parse(meta);
      await loadFromText(text, parsedMeta?.name || 'local-swimlane.json', 'primary');
      return true;
    } finally {
      sessionStorage.removeItem(STORAGE_META_KEY);
      sessionStorage.removeItem(STORAGE_TEXT_KEY);
    }
  }

  async function handleLocalFile(file, targetKey) {
    const text = await file.text();
    await loadFromText(text, file.name, targetKey);
  }

  async function bindProgramText(text, fileName) {
    try {
      JSON.parse(text);
      state.bindings.program = {
        name: fileName,
        text,
      };
      renderBindingStatus();
      renderLaneInsightCards();
    } catch (error) {
      console.error(error);
      alert('Selected Program JSON is invalid.');
    }
  }

  async function loadFolderResources(entries, folderName) {
    const resources = detectFolderResources(entries);
    if (!resources.primary) {
      throw new Error('所选文件夹里没有识别到 merged_swimlane.json / stitched_before.json / stitched_after.json。');
    }

    const primaryText = await resources.primary.file.text();
    const compareText = resources.compare ? await resources.compare.file.text() : null;
    const programText = resources.program ? await resources.program.file.text() : null;

    state.bindings.moduleDir = {
      name: folderName || 'local-folder',
      entryCount: resources.entryCount,
      hasBeforeAfterPair: resources.hasBeforeAfterPair,
      primaryName: baseName(resources.primary.relativePath),
      compareName: resources.compare ? baseName(resources.compare.relativePath) : null,
      programName: resources.program ? baseName(resources.program.relativePath) : null,
      sourceName: resources.source ? baseName(resources.source.relativePath) : null,
      sourceText: resources.source ? await resources.source.file.text() : null,
    };
    state.bindings.program = null;
    state.datasets.compare = null;
    state.compareSource = null;
    state.compareMode = false;
    state.comparePresentation = 'diff';

    await loadFromText(primaryText, baseName(resources.primary.relativePath), 'primary');

    if (compareText) {
      await loadFromText(compareText, baseName(resources.compare.relativePath), 'compare');
      state.compareSource = 'folder-auto';
      state.compareMode = true;
      state.comparePresentation = 'diff';
    }

    if (programText) {
      await bindProgramText(programText, baseName(resources.program.relativePath));
    } else {
      renderBindingStatus();
      renderLaneInsightCards();
    }

    renderAll();
  }

  async function openLocalFolder() {
    if (window.showDirectoryPicker) {
      try {
        const dirHandle = await window.showDirectoryPicker({ id: 'pto-swimlane-folder' });
        const entries = await collectHandleEntries(dirHandle);
        await loadFolderResources(entries, dirHandle.name || 'local-folder');
      } catch (error) {
        if (error?.name === 'AbortError') return;
        throw error;
      }
      return;
    }
    dom.folderInput?.click();
  }

  function closeResourcePanel() {
    if (!dom.resourcePanel || dom.resourcePanel.hidden) return;
    dom.resourcePanel.hidden = true;
    dom.resourceToggleBtn?.setAttribute('aria-expanded', 'false');
  }

  function closeMoreControlsMenu() {
    if (!dom.moreControlsMenu || dom.moreControlsMenu.hidden) return;
    dom.moreControlsMenu.hidden = true;
    dom.moreControlsBtn?.setAttribute('aria-expanded', 'false');
  }

  function openMoreControlsMenu() {
    if (!dom.moreControlsMenu) return;
    dom.moreControlsMenu.hidden = false;
    dom.moreControlsBtn?.setAttribute('aria-expanded', 'true');
  }

  function toggleMoreControlsMenu() {
    if (!dom.moreControlsMenu) return;
    if (dom.moreControlsMenu.hidden) openMoreControlsMenu();
    else closeMoreControlsMenu();
  }

  function openResourcePanel() {
    if (!dom.resourcePanel) return;
    renderResourcePanel();
    dom.resourcePanel.hidden = false;
    dom.resourceToggleBtn?.setAttribute('aria-expanded', 'true');
  }

  function toggleResourcePanel() {
    if (!dom.resourcePanel) return;
    if (dom.resourcePanel.hidden) openResourcePanel();
    else closeResourcePanel();
  }

  async function setCompareView(view) {
    if (view === 'single') {
      state.compareMode = false;
      renderAll();
      return true;
    }
    const ok = await ensureCompareDataset();
    if (!ok) {
      alert('请先绑定参考泳道，或切回内置 Before/After 样例。');
      return false;
    }
    state.compareMode = true;
    state.comparePresentation = view === 'compare' ? 'compare' : 'diff';
    renderAll();
    return true;
  }

  async function ensureCompareDataset() {
    if (state.datasets.compare) return true;
    if (state.builtinSelection === 'before') {
      await loadFromQueryFile('./samples/stitched_after.json', 'compare');
      state.compareSource = 'auto-builtin';
      return true;
    }
    if (state.builtinSelection === 'after') {
      await loadFromQueryFile('./samples/stitched_before.json', 'compare');
      state.compareSource = 'auto-builtin';
      return true;
    }
    return false;
  }

  function setToggleActive(isBefore) {
    dom.beforeBtn.classList.toggle('sw-toggle-active', isBefore);
    dom.afterBtn.classList.toggle('sw-toggle-active', !isBefore);
    state.builtinSelection = isBefore ? 'before' : 'after';
  }

  async function loadBuiltinSelection(selection) {
    state.builtinSelection = selection;
    state.bindings.moduleDir = null;
    state.bindings.program = null;
    setToggleActive(selection === 'before');
    const target = selection === 'before' ? './samples/stitched_before.json' : './samples/stitched_after.json';
    await loadFromQueryFile(target, 'primary');
    state.datasets.compare = null;
    state.compareSource = null;
    if (state.compareMode) {
      const compareTarget = selection === 'before' ? './samples/stitched_after.json' : './samples/stitched_before.json';
      await loadFromQueryFile(compareTarget, 'compare');
      state.compareSource = 'auto-builtin';
    }
  }

  dom.resourceToggleBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleResourcePanel();
  });
  dom.resourceCloseBtn?.addEventListener('click', closeResourcePanel);
  dom.openFolderBtn?.addEventListener('click', () => {
    closeResourcePanel();
    openLocalFolder().catch((error) => {
      console.error(error);
      alert(error?.message || 'Failed to read local folder.');
    });
  });
  dom.openLocalBtn?.addEventListener('click', () => {
    closeResourcePanel();
    dom.fileInput.click();
  });
  dom.openCompareBtn?.addEventListener('click', () => {
    closeResourcePanel();
    dom.compareFileInput.click();
  });
  dom.bindProgramBtn?.addEventListener('click', () => {
    closeResourcePanel();
    dom.programFileInput.click();
  });
  dom.folderInput?.addEventListener('change', async (event) => {
    const { entries, folderName } = collectInputEntries(event.target.files);
    if (!entries.length) {
      dom.folderInput.value = '';
      return;
    }
    try {
      await loadFolderResources(entries, folderName);
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Failed to parse folder JSON files.');
    } finally {
      dom.folderInput.value = '';
    }
  });
  dom.fileInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      state.bindings.moduleDir = null;
      state.bindings.program = null;
      await handleLocalFile(file, 'primary');
      if (state.compareSource === 'auto-builtin') {
        state.datasets.compare = null;
        state.compareMode = false;
      }
      state.compareSource = null;
      state.comparePresentation = 'diff';
      renderAll();
    } catch (error) {
      console.error(error);
      alert('Failed to parse swimlane JSON.');
    } finally {
      dom.fileInput.value = '';
    }
  });

  dom.compareFileInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await handleLocalFile(file, 'compare');
      state.compareSource = 'user-file';
      state.compareMode = true;
      state.comparePresentation = 'diff';
      renderAll();
    } catch (error) {
      console.error(error);
      alert('Failed to parse compare JSON.');
    } finally {
      dom.compareFileInput.value = '';
    }
  });

  dom.programFileInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await bindProgramText(await file.text(), file.name);
    } catch (error) {
      console.error(error);
      alert('Failed to read program JSON.');
    } finally {
      dom.programFileInput.value = '';
    }
  });

  dom.searchInput?.addEventListener('input', updateSearch);
  dom.searchToggleBtn?.addEventListener('click', () => {
    dom.searchToggleBtn.closest('.sw-search-group').classList.toggle('is-open');
    if (dom.searchToggleBtn.closest('.sw-search-group').classList.contains('is-open')) dom.searchInput.focus();
    else {
      dom.searchInput.value = '';
      updateSearch();
    }
  });
  dom.resourcePanel?.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  dom.moreControlsBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMoreControlsMenu();
  });
  dom.moreControlsMenu?.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  document.addEventListener('click', () => {
    closeResourcePanel();
    closeMoreControlsMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeResourcePanel();
      closeMoreControlsMenu();
    }
  });
  dom.searchPrevBtn?.addEventListener('click', () => goToNextMatch(-1));
  dom.searchNextBtn?.addEventListener('click', () => goToNextMatch(1));
  dom.zoomInBtn?.addEventListener('click', () => {
    state.pxPerUnit *= 1.2;
    renderChartsOnly();
  });
  dom.zoomOutBtn?.addEventListener('click', () => {
    state.pxPerUnit = Math.max(0.4, state.pxPerUnit / 1.2);
    renderChartsOnly();
  });
  dom.zoomFitBtn?.addEventListener('click', fitZoom);
  dom.beforeBtn?.addEventListener('click', () => {
    closeResourcePanel();
    loadBuiltinSelection('before').catch((error) => {
      console.error(error);
      alert('Failed to load built-in Before sample.');
    });
  });
  dom.afterBtn?.addEventListener('click', () => {
    closeResourcePanel();
    loadBuiltinSelection('after').catch((error) => {
      console.error(error);
      alert('Failed to load built-in After sample.');
    });
  });
  dom.singleViewBtn?.addEventListener('click', () => {
    setCompareView('single').catch((error) => {
      console.error(error);
      alert('Failed to switch view mode.');
    });
  });
  dom.compareViewBtn?.addEventListener('click', () => {
    setCompareView('compare').catch((error) => {
      console.error(error);
      alert('Failed to switch view mode.');
    });
  });
  dom.diffViewBtn?.addEventListener('click', () => {
    setCompareView('diff').catch((error) => {
      console.error(error);
      alert('Failed to switch view mode.');
    });
  });
  dom.toggleBubblesBtn?.addEventListener('click', () => {
    state.showBubbles = !state.showBubbles;
    dom.toggleBubblesBtn.classList.toggle('btn-primary', state.showBubbles);
    renderChartsOnly();
  });
  dom.measureModeBtn?.addEventListener('click', () => {
    state.measureMode = !state.measureMode;
    dom.measureModeBtn.classList.toggle('btn-primary', state.measureMode);
    renderChartsOnly();
  });
  dom.clearRangeBtn?.addEventListener('click', clearRangeSelection);
  dom.colorMode?.addEventListener('change', () => {
    state.filters.colorMode = dom.colorMode.value;
    renderChartsOnly();
    syncSplitPassIrColorMode();
  });
  dom.sortMode?.addEventListener('change', () => {
    state.filters.sortMode = dom.sortMode.value;
    renderAll();
  });
  dom.detailClose?.addEventListener('click', closeDetail);

  window.addEventListener('mouseup', finishRangeSelection);
  window.addEventListener('resize', () => {
    if (!state.datasets.primary) return;
    fitZoom();
  });

  bindChartEvents('primary');
  bindChartEvents('compare');

  async function init() {
    showEmpty();
    dom.toggleBubblesBtn.classList.add('btn-primary');
    dom.colorMode.value = state.filters.colorMode;
    dom.sortMode.value = state.filters.sortMode;
    dom.searchToggleBtn.closest('.sw-search-group').classList.add('is-open');

    const params = new URLSearchParams(location.search);
    const action = params.get('action');
    const file = params.get('file');

    try {
      if (action === 'open-file') {
        const loaded = await loadFromSessionStorage();
        if (!loaded) await loadBuiltinSelection('before');
        return;
      }
      if (file) {
        await loadFromQueryFile(file, 'primary');
        return;
      }
      await loadBuiltinSelection('before');
    } catch (error) {
      console.error(error);
      dom.fileMeta.textContent = '泳道文件加载失败';
      alert('Failed to load swimlane data.');
    }
  }

  // ─── Journey Guidance Panel ───────────────────────────────────────────────

  function buildHealthCardHtml(summary, explanations) {
    const aic = summary ? (summary.kinds.aic || { avgUtilization: 0 }) : null;
    const aiv = summary ? (summary.kinds.aiv || { avgUtilization: 0 }) : null;

    if (!summary) {
      return `
        <div class="sw-journey-card">
          <div class="sw-journey-card-title">
            <span class="sw-journey-step-num">1</span>全局认知
          </div>
          <div class="sw-journey-card-body">
            <div class="sw-journey-empty-hint">加载 swimlane 文件后自动填充</div>
          </div>
        </div>`;
    }

    const aicPct = formatPercent(aic.avgUtilization);
    const aivPct = formatPercent(aiv.avgUtilization);
    const spanStr = formatTick(summary.span);
    const aicClass = aic.avgUtilization < 0.5 ? 'is-warn' : 'is-good';
    const aivClass = aiv.avgUtilization < 0.36 ? 'is-warn' : 'is-good';
    const diagHtml = explanations.length
      ? `<div class="sw-journey-diagnosis">${escapeHtml(explanations[0].title)}：${explanations[0].body}</div>`
      : `<div class="sw-journey-diagnosis">未识别到明显异常。</div>`;

    return `
      <div class="sw-journey-card">
        <div class="sw-journey-card-title">
          <span class="sw-journey-step-num">1</span>全局认知
        </div>
        <div class="sw-journey-card-body">
          <div class="sw-journey-stat">
            <span class="sw-journey-stat-label">AIC 利用率</span>
            <span class="sw-journey-stat-value ${escapeHtml(aicClass)}">${escapeHtml(aicPct)}</span>
          </div>
          <div class="sw-journey-stat">
            <span class="sw-journey-stat-label">AIV 利用率</span>
            <span class="sw-journey-stat-value ${escapeHtml(aivClass)}">${escapeHtml(aivPct)}</span>
          </div>
          <div class="sw-journey-stat">
            <span class="sw-journey-stat-label">总 Span</span>
            <span class="sw-journey-stat-value">${escapeHtml(spanStr)}</span>
          </div>
          <div class="sw-journey-card-divider"></div>
          ${diagHtml}
        </div>
      </div>`;
  }

  function buildBottleneckCardHtml(summary) {
    if (!summary) {
      return `
        <div class="sw-journey-card">
          <div class="sw-journey-card-title">
            <span class="sw-journey-step-num">2</span>找瓶颈
          </div>
          <div class="sw-journey-card-body">
            <div class="sw-journey-empty-hint">加载数据后显示最大气泡 lane</div>
          </div>
        </div>`;
    }

    const topGapLanes = summary.visibleLanes
      .slice()
      .sort((a, b) => b.visibleMaxGap - a.visibleMaxGap)
      .slice(0, 3);

    const laneListHtml = topGapLanes.length
      ? topGapLanes.map((entry) => `
          <div class="sw-journey-stat">
            <span class="sw-journey-stat-label">${escapeHtml(entry.lane.threadName)}</span>
            <span class="sw-journey-stat-value is-warn">${escapeHtml(formatTick(entry.visibleMaxGap))}</span>
          </div>`).join('')
      : '<div class="sw-journey-empty-hint">没有可见 lane 数据</div>';

    const topLabels = (summary.labels || []).slice(0, 3);
    const labelListHtml = topLabels.length
      ? topLabels.map((e) => `
          <div class="sw-journey-stat">
            <span class="sw-journey-stat-label">${escapeHtml(e.label)}</span>
            <span class="sw-journey-stat-value">${escapeHtml(formatTick(e.totalDur))}</span>
          </div>`).join('')
      : '';

    return `
      <div class="sw-journey-card">
        <div class="sw-journey-card-title">
          <span class="sw-journey-step-num">2</span>找瓶颈
        </div>
        <div class="sw-journey-card-body">
          ${laneListHtml}
          ${labelListHtml ? `<div class="sw-journey-card-divider"></div>${labelListHtml}` : ''}
          <div class="sw-journey-card-divider"></div>
        </div>
        <div class="sw-journey-card-actions">
          <button class="sw-journey-btn" id="swJourneyBtnSortGap" type="button">按气泡排序</button>
        </div>
      </div>`;
  }

  function buildDeepDiveCardHtml() {
    const selected = getSelectedTaskState();
    const moduleDir = state.bindings.moduleDir;
    const resourceActionLabel = moduleDir || state.bindings.program ? '加载本地资源' : '加载本地资源';
    const moduleSection = moduleDir
      ? `<div class="sw-journey-program-bound is-folder">
           <span class="sw-journey-bound-check">✓</span>
           <span>${escapeHtml(moduleDir.name)} · ${escapeHtml(String(moduleDir.entryCount || 0))} 文件</span>
         </div>`
      : '';
    const programSection = state.bindings.program
      ? `<div class="sw-journey-program-bound">
           <span class="sw-journey-bound-check">✓</span>
           <span>${escapeHtml(state.bindings.program.name || 'program.json')}</span>
         </div>`
      : '';
    const selectedTaskHtml = selected.task
      ? `
          <div class="sw-journey-stat">
            <span class="sw-journey-stat-label">当前任务</span>
            <span class="sw-journey-stat-value">${escapeHtml(selected.task.label || selected.task.displayName || selected.task.rawName)}</span>
          </div>
          <div class="sw-journey-stat">
            <span class="sw-journey-stat-label">来源</span>
            <span class="sw-journey-stat-value">${escapeHtml(selected.ref?.chartKey === 'compare' ? 'Reference' : 'Primary')}</span>
          </div>`
      : '<div class="sw-journey-empty-hint">先点击一个 task，再打开依赖或分屏联动。</div>';

    return `
      <div class="sw-journey-card">
        <div class="sw-journey-card-title">
          <span class="sw-journey-step-num">3</span>深入任务
        </div>
        <div class="sw-journey-card-body">
          ${selectedTaskHtml}
          <div class="sw-journey-card-divider"></div>
          <div class="sw-journey-stat-label" style="margin-bottom:4px">模块资源</div>
          ${moduleSection}
          ${programSection}
          <button class="sw-journey-btn" id="swJourneyBtnResources" type="button">${escapeHtml(resourceActionLabel)}</button>
          <div class="sw-journey-card-divider"></div>
          <div class="sw-detail-note">旅程入口保留，但会统一打开顶部“资源”面板。</div>
          <div class="sw-detail-note">${escapeHtml(selected.depReason)}</div>
          <div class="sw-detail-note">${escapeHtml(selected.passIrReason)}</div>
          <div class="sw-detail-note">${escapeHtml(selected.sourceFlowReason)}</div>
        </div>
        <div class="sw-journey-card-actions">
          <button class="sw-journey-btn" id="swJourneyBtnDeps" type="button">显示前后依赖连线</button>
          <button class="sw-journey-btn" id="swJourneyBtnPassIr" type="button">${escapeHtml(selected.passIrActionLabel)}</button>
          <button class="sw-journey-btn" id="swJourneyBtnSourceFlow" type="button">${escapeHtml(selected.sourceFlowActionLabel)}</button>
        </div>
      </div>`;
  }

  function renderJourneyPanel() {
    if (!dom.journeyCards) return;
    const dataset = state.datasets.primary;
    const summary = dataset ? buildVisibleSummary(dataset) : null;
    const explanations = summary
      ? buildExplanations(summary, computeRangeMetrics(dataset), null)
      : [];

    dom.journeyCards.innerHTML = [
      buildHealthCardHtml(summary, explanations),
      buildBottleneckCardHtml(summary),
      buildDeepDiveCardHtml(),
    ].join('');

    // Wire Step 2 sort-by-gap button
    const sortGapBtn = document.getElementById('swJourneyBtnSortGap');
    if (sortGapBtn) {
      sortGapBtn.addEventListener('click', () => {
        dom.sortMode.value = 'gap';
        dom.sortMode.dispatchEvent(new Event('change'));
      });
    }

    const resourceBtn = document.getElementById('swJourneyBtnResources');
    if (resourceBtn) {
      resourceBtn.addEventListener('click', () => {
        openResourcePanel();
      });
    }

    const depsBtn = document.getElementById('swJourneyBtnDeps');
    if (depsBtn) {
      depsBtn.addEventListener('click', () => {
        const selected = getSelectedTaskState();
        if (!selected.canShowDeps) {
          openResourcePanel();
          return;
        }
        focusDependencyChainFromSelectedTask();
      });
    }

    const passIrBtn = document.getElementById('swJourneyBtnPassIr');
    if (passIrBtn) {
      passIrBtn.addEventListener('click', () => {
        const selected = getSelectedTaskState();
        if (!selected.canOpenPassIr) {
          openResourcePanel();
          return;
        }
        hideTaskPopup();
        openSplitView(canTaskOpenPassIr(selected.task) ? selected.task : null, 'pass-ir');
      });
    }

    const sourceFlowBtn = document.getElementById('swJourneyBtnSourceFlow');
    if (sourceFlowBtn) {
      sourceFlowBtn.addEventListener('click', () => {
        const selected = getSelectedTaskState();
        if (!selected.canOpenSourceFlow) {
          openResourcePanel();
          return;
        }
        hideTaskPopup();
        openSplitView(canTaskOpenSourceFlow(selected.task) ? selected.task : null, 'source-flow');
      });
    }
  }

  // Journey panel toggle events
  dom.journeyClose?.addEventListener('click', () => {
    dom.journeyPanel.classList.add('sw-journey-panel--hidden');
    dom.journeyToggle.classList.remove('sw-journey-toggle--hidden');
  });

  dom.journeyToggle?.addEventListener('click', () => {
    dom.journeyPanel.classList.remove('sw-journey-panel--hidden');
    dom.journeyToggle.classList.add('sw-journey-toggle--hidden');
    renderJourneyPanel();
  });

  // ─── UI Mode State Machine ─────────────────────────────────────────────────

  function setUiMode(mode) {
    state.uiMode = mode;
    document.body.dataset.uiMode = mode;
    const splitEl = document.getElementById('swSplitContainer');
    if (splitEl) {
      if (mode === 'split') splitEl.hidden = false;
      else if (mode === 'default') splitEl.hidden = true;
      // 'task-popup': leave split container as-is so popup can overlay it
    }
    if (mode !== 'task-popup') { hideTaskPopup(); clearDepLines(); }
  }

  // ─── Task In-place Popup ───────────────────────────────────────────────────

  function showTaskPopup(task, lane, chartKey, anchorEl) {
    const popup = document.getElementById('swTaskPopup');
    if (!popup) return;

    const rect = anchorEl.getBoundingClientRect();
    const popupW = 320;
    const popupMaxH = 480;
    let left = rect.left;
    let top = rect.bottom + 6;

    if (left + popupW > window.innerWidth - 16) left = window.innerWidth - popupW - 16;
    if (left < 8) left = 8;
    if (top + popupMaxH > window.innerHeight - 16) top = rect.top - popupMaxH - 6;
    if (top < 8) top = 8;

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    const typeStyles = {
      fake: { bg: 'rgba(92,99,112,0.25)', color: '#cfd4dc', label: 'FAKE' },
      aic: { bg: 'rgba(123,87,191,0.25)', color: '#cdb8ff', label: 'AIC' },
      aiv: { bg: 'rgba(77,121,212,0.25)', color: '#bfd4ff', label: 'AIV' },
      aicpu: { bg: 'rgba(77,165,109,0.25)', color: '#c4f2d0', label: 'AICPU' },
      other: { bg: 'rgba(255,255,255,0.1)', color: '#fff', label: 'TASK' },
    };
    const style = typeStyles[task.laneKind] || typeStyles.other;
    const badge = document.getElementById('swPopupBadge');
    badge.textContent = style.label;
    badge.style.background = style.bg;
    badge.style.color = style.color;
    document.getElementById('swPopupName').textContent = task.rawName;

    document.getElementById('swPopupBody').innerHTML = buildPopupBodyHtml(task, lane, chartKey);

    popup.hidden = false;
    setUiMode('task-popup');
    wirePopupButtons(task);
    if (chartKey === 'primary') renderDepLines(task);
    else clearDepLines();
  }

  function hideTaskPopup() {
    const popup = document.getElementById('swTaskPopup');
    if (popup) popup.hidden = true;
  }

  function buildPopupBodyHtml(task, lane, chartKey) {
    const sections = [];

    const facts = [
      ['semantic', task.label || '—'],
      ['duration', formatTick(task.dur)],
      ['start', formatTick(task.relTs)],
      ['gap before', formatTick(task.gapBefore || 0)],
      ['seqNo', task.seqNo ?? '—'],
      ['callOpMagic', task.callOpMagic ?? '—'],
    ];

    sections.push(`<div class="sw-popup-section">
    <div class="sw-popup-section-title">Task</div>
    ${facts.map(([k, v]) => `<div class="sw-popup-row"><span class="sw-popup-row-key">${escapeHtml(k)}</span><span class="sw-popup-row-val">${escapeHtml(String(v))}</span></div>`).join('')}
  </div>`);

    const ctx = [];
    if (task.seqNo != null) ctx.push(`Stitch ${task.seqNo}`);
    if (task.subGraphId != null) ctx.push(`subgraph ${task.subGraphId}`);
    if (task.label) ctx.push(task.label);
    if (ctx.length) {
      sections.push(`<div class="sw-popup-section">
      <div class="sw-popup-section-title">Context</div>
      <div class="sw-popup-row"><span class="sw-popup-row-val">${escapeHtml(ctx.join(' · '))}</span></div>
    </div>`);
    }

    sections.push(`<div class="sw-popup-section">
      <div class="sw-popup-section-title">I/O</div>
      <div class="sw-popup-row"><span class="sw-popup-row-key">in</span><span class="sw-popup-row-val">${escapeHtml(task.inputRawMagic.length ? task.inputRawMagic.join(', ') : '—')}</span></div>
      <div class="sw-popup-row"><span class="sw-popup-row-key">out</span><span class="sw-popup-row-val">${escapeHtml(task.outputRawMagic.length ? task.outputRawMagic.join(', ') : '—')}</span></div>
    </div>`);

    const splitDisabled = !ENABLE_SPLIT_VIEW;
    const passIrDisabled = splitDisabled || !canTaskOpenPassIr(task);
    const sourceFlowDisabled = splitDisabled || !canTaskOpenSourceFlow(task);
    sections.push(`<div class="sw-popup-actions">
    ${chartKey === 'primary' ? '<div class="sw-detail-note">主图依赖连线已自动显示，点击节点可快速定位。</div>' : ''}
    <button class="sw-popup-action-btn" data-popup-action="open-split-pass-ir"${passIrDisabled ? ' disabled' : ''}>Pass IR 分屏联动</button>
    ${task.label ? `<button class="sw-popup-action-btn" data-popup-action="open-split-source-flow"${sourceFlowDisabled ? ' disabled' : ''}>Source Flow 分屏联动</button>` : ''}
  </div>`);

    return sections.join('');
  }

  function wirePopupButtons(task) {
    const body = document.getElementById('swPopupBody');
    if (!body) return;
    body.querySelectorAll('[data-popup-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.popupAction;
        if (action === 'open-split-pass-ir') {
          openSplitView(task, 'pass-ir');
        } else if (action === 'open-split-source-flow') {
          openSplitView(task, 'source-flow');
        }
      });
    });
  }

  // ─── Split View ────────────────────────────────────────────────────────────

  function openSplitView(task, source) {
    if (!ENABLE_SPLIT_VIEW) return;
    if (source === 'pass-ir' && !canOpenPassIrView()) return;
    if (source === 'source-flow' && !canOpenSourceFlowView() && !canTaskOpenSourceFlow(task)) return;
    state.splitSource = source;

    const container = document.getElementById('swSplitContainer');
    const label = document.getElementById('swSplitLabel');
    const iframe = document.getElementById('swGraphIframe');
    const bottom = document.getElementById('swSplitBottom');
    const viewer = document.getElementById('swViewer');

    if (!container || !iframe) return;

    if (viewer && bottom && !bottom.contains(viewer)) {
      state.splitRestore = {
        parent: viewer.parentElement,
        nextSibling: viewer.nextSibling,
      };
      bottom.appendChild(viewer);
    }

    if (source === 'pass-ir') {
      label.textContent = 'Pass IR';
      try {
        sessionStorage.setItem(PASS_IR_META_KEY, JSON.stringify({ name: state.bindings.program?.name || '' }));
        sessionStorage.setItem(PASS_IR_TEXT_KEY, state.bindings.program?.text || '');
        if (task) {
          sessionStorage.setItem(PASS_IR_FOCUS_KEY, JSON.stringify({
            semanticLabel: task.label || null,
            callOpMagic: task.callOpMagic != null ? task.callOpMagic : null,
            laneName: task.threadName,
            seqNo: task.seqNo,
            source: 'swimlane',
          }));
        } else {
          sessionStorage.removeItem(PASS_IR_FOCUS_KEY);
        }
      } catch(e) { console.error(e); }
      iframe.src = `../pass-ir/index.html?action=open-file&embed=1`;
    } else if (source === 'source-flow') {
      label.textContent = 'Source Flow';
      try {
        if (state.bindings.moduleDir?.sourceText && state.bindings.moduleDir?.sourceName) {
          sessionStorage.setItem(SOURCE_FLOW_META_KEY, JSON.stringify({ name: state.bindings.moduleDir.sourceName }));
          sessionStorage.setItem(SOURCE_FLOW_TEXT_KEY, state.bindings.moduleDir.sourceText);
        }
        if (task?.label) {
          sessionStorage.setItem(SOURCE_FLOW_FOCUS_KEY, JSON.stringify({
            semanticLabel: task.label || null,
            source: 'swimlane',
          }));
        } else {
          sessionStorage.removeItem(SOURCE_FLOW_FOCUS_KEY);
        }
      } catch(e) { console.error(e); }
      iframe.src = state.bindings.moduleDir?.sourceText && state.bindings.moduleDir?.sourceName
        ? '../source-flow/index.html?action=open-py-file'
        : '../source-flow/index.html';
    }

    iframe.onload = () => {
      syncSplitPassIrColorMode();
    };
    setUiMode('split');
  }

  function closeSplitView() {
    const viewer = document.getElementById('swViewer');
    const restore = state.splitRestore;

    if (viewer && restore?.parent && viewer.parentElement !== restore.parent) {
      if (restore.nextSibling && restore.nextSibling.parentNode === restore.parent) {
        restore.parent.insertBefore(viewer, restore.nextSibling);
      } else {
        restore.parent.appendChild(viewer);
      }
    }
    state.splitRestore = null;

    const iframe = document.getElementById('swGraphIframe');
    if (iframe) {
      iframe.onload = null;
      iframe.src = '';
    }
    state.splitSource = null;
    setUiMode('default');
  }

  function initSplitDivider() {
    const divider = document.getElementById('swSplitDivider');
    const container = document.getElementById('swSplitContainer');
    const top = document.getElementById('swSplitTop');
    if (!divider || !container || !top) return;

    let dragging = false;
    let startY = 0;
    let startH = 0;

    divider.addEventListener('mousedown', (e) => {
      dragging = true;
      startY = e.clientY;
      startH = top.getBoundingClientRect().height;
      divider.classList.add('is-dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      const containerH = container.getBoundingClientRect().height;
      const newH = Math.max(80, Math.min(containerH - 80 - 5, startH + dy));
      top.style.height = `${newH}px`;
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        divider.classList.remove('is-dragging');
      }
    });
  }

  // ─── Dependency Lines ──────────────────────────────────────────────────────

  function renderDepLines(selectedTask) {
    const overlay = document.getElementById('swDepOverlay');
    if (!overlay) return;
    overlay.innerHTML = '';

    if (!selectedTask) return;

    const refs = chartRefs.primary;
    const dataset = state.datasets.primary;
    if (!dataset) return;

    const selectedBar = refs.barElements.get(selectedTask.id);
    if (!selectedBar) return;

    const viewport = refs.laneMainViewport;
    const viewportRect = viewport.getBoundingClientRect();

    function barCenter(bar) {
      const r = bar.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 - viewportRect.left + viewport.scrollLeft,
        y: r.top + r.height / 2 - viewportRect.top + viewport.scrollTop,
      };
    }

    const selCenter = barCenter(selectedBar);

    const inSet = new Set(selectedTask.inputRawMagic || []);
    const outSet = new Set(selectedTask.outputRawMagic || []);

    const visibleTasks = [];
    dataset.lanes.forEach((lane) => {
      lane.tasks.forEach((task) => {
        if (task.id !== selectedTask.id) visibleTasks.push(task);
      });
    });

    visibleTasks.forEach((task) => {
      const bar = refs.barElements.get(task.id);
      if (!bar) return;

      const taskOutputs = new Set(task.outputRawMagic || []);
      const taskInputs = new Set(task.inputRawMagic || []);

      const isIn = [...inSet].some((m) => taskOutputs.has(m));
      const isOut = [...outSet].some((m) => taskInputs.has(m));

      if (!isIn && !isOut) return;

      const targetCenter = barCenter(bar);
      const cls = isIn ? 'dep-line sw-dep-line-in' : 'dep-line sw-dep-line-out';
      const dotCls = isIn ? 'sw-dep-dot sw-dep-dot-in' : 'sw-dep-dot sw-dep-dot-out';

      const x1 = isIn ? targetCenter.x : selCenter.x;
      const y1 = isIn ? targetCenter.y : selCenter.y;
      const x2 = isIn ? selCenter.x : targetCenter.x;
      const y2 = isIn ? selCenter.y : targetCenter.y;
      const cx = (x1 + x2) / 2;
      const cy = Math.min(y1, y2) - Math.abs(y2 - y1) * 0.3 - 20;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', cls);
      path.setAttribute('d', `M ${x1},${y1} Q ${cx},${cy} ${x2},${y2}`);
      overlay.appendChild(path);

      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', dotCls);
      dot.setAttribute('cx', String(targetCenter.x));
      dot.setAttribute('cy', String(targetCenter.y));
      dot.setAttribute('r', '5');
      dot.addEventListener('click', () => {
        viewport.scrollTo({
          top: Math.max(0, targetCenter.y - viewport.clientHeight / 2),
          left: Math.max(0, targetCenter.x - viewport.clientWidth / 2),
          behavior: 'smooth',
        });
        bar.classList.add('is-active');
        setTimeout(() => bar.classList.remove('is-active'), 1500);
      });
      overlay.appendChild(dot);
    });
  }

  function clearDepLines() {
    const overlay = document.getElementById('swDepOverlay');
    if (overlay) overlay.innerHTML = '';
  }

  document.getElementById('swPopupClose')?.addEventListener('click', () => {
    hideTaskPopup();
    clearDepLines();
    setUiMode(state.splitSource ? 'split' : 'default');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.uiMode === 'task-popup') {
      hideTaskPopup();
      clearDepLines();
      setUiMode(state.splitSource ? 'split' : 'default');
    }
  });

  document.getElementById('swSplitClose')?.addEventListener('click', closeSplitView);
  initSplitDivider();

  chartRefs.primary.laneMainViewport.addEventListener('scroll', () => {
    if (state.uiMode === 'task-popup') {
      const dataset = state.datasets.primary;
      if (dataset && state.selectedTaskRef?.chartKey === 'primary') {
        const task = dataset.taskMap.get(state.selectedTaskRef.taskId);
        if (task) renderDepLines(task);
      }
    }
  });

  init();
})();

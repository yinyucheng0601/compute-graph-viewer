(function () {
  const STORAGE_META_KEY = 'swimSelectedFile';
  const STORAGE_TEXT_KEY = 'swimSelectedFileText';

  const searchInput = document.getElementById('swSearchInput');
  const searchPrevBtn = document.getElementById('swSearchPrev');
  const searchNextBtn = document.getElementById('swSearchNext');
  const searchCount = document.getElementById('swSearchCount');
  const openLocalBtn = document.getElementById('swOpenLocalBtn');
  const fileInput = document.getElementById('swFileInput');
  const zoomInBtn = document.getElementById('swZoomInBtn');
  const zoomOutBtn = document.getElementById('swZoomOutBtn');
  const zoomFitBtn = document.getElementById('swZoomFitBtn');
  const fileMeta = document.getElementById('swFileMeta');
  const summary = document.getElementById('swSummary');
  const emptyState = document.getElementById('swEmptyState');
  const viewer = document.getElementById('swViewer');
  const timelineViewport = document.getElementById('swTimelineViewport');
  const timelineTrack = document.getElementById('swTimelineTrack');
  const laneLabelTrack = document.getElementById('swLaneLabelTrack');
  const laneMainViewport = document.getElementById('swLaneMainViewport');
  const laneMainTrack = document.getElementById('swLaneMainTrack');

  const state = {
    fileName: '',
    raw: null,
    lanes: [],
    bars: [],
    stats: null,
    minTs: 0,
    maxTs: 0,
    span: 1,
    pxPerUnit: 3.2,
    activeMatchIndex: -1,
    matches: [],
    barElements: new Map(),
    laneHeights: new Map(),
  };

  function laneMetrics(threadKind, lineCount) {
    if (threadKind === 0) {
      const barHeight = 6;
      const lineGap = 2;
      const topPad = 4;
      const bottomPad = 4;
      return {
        barHeight,
        lineGap,
        topPad,
        bottomPad,
        laneHeight: Math.max(36, topPad + lineCount * barHeight + Math.max(0, lineCount - 1) * lineGap + bottomPad)
      };
    }

    const barHeight = 14;
    const lineGap = 2;
    const topPad = 2;
    const bottomPad = 2;
    return {
      barHeight,
      lineGap,
      topPad,
      bottomPad,
      laneHeight: Math.max(18, topPad + lineCount * barHeight + Math.max(0, lineCount - 1) * lineGap + bottomPad)
    };
  }

  function laneRank(name) {
    if (/Fake Core/i.test(name)) return 0;
    if (/AIC_/i.test(name)) return 1;
    if (/AIV_/i.test(name)) return 2;
    if (/AICPU/i.test(name)) return 3;
    return 4;
  }

  function laneNumber(name) {
    const match = name.match(/(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  function extractLabel(rawName) {
    const match = String(rawName || '').match(/\(([^)]+)\)$/);
    return match ? match[1] : 'unknown';
  }

  function colorForLabel(label) {
    const fixed = {
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
      'unknown': '#5c6370'
    };
    if (fixed[label]) return fixed[label];
    let hash = 0;
    const input = String(label);
    for (let i = 0; i < input.length; i += 1) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 54% 56%)`;
  }

  function formatNumber(num) {
    return new Intl.NumberFormat('zh-CN').format(num);
  }

  function formatTick(value) {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}ms`;
    if (value >= 100) return `${Math.round(value)}μs`;
    if (value >= 10) return `${value.toFixed(1)}μs`;
    return `${value.toFixed(2)}μs`;
  }

  function computeNiceStep(span) {
    const rough = span / 6;
    const power = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1))));
    const unit = rough / power;
    if (unit <= 1) return power;
    if (unit <= 2) return 2 * power;
    if (unit <= 5) return 5 * power;
    return 10 * power;
  }

  function finalizeLaneTasks(lanes) {
    let minTs = Infinity;
    let maxTs = -Infinity;

    lanes.forEach((lane) => {
      lane.tasks.sort((a, b) => a.ts - b.ts || a.end - b.end);
      const lineEnds = [];
      lane.tasks.forEach((task) => {
        let line = lineEnds.findIndex((value) => task.ts >= value);
        if (line < 0) {
          line = lineEnds.length;
          lineEnds.push(task.end);
        } else {
          lineEnds[line] = task.end;
        }
        task.line = line;
        minTs = Math.min(minTs, task.ts);
        maxTs = Math.max(maxTs, task.end);
      });
      lane.taskCount = lane.tasks.length;
      lane.lineCount = Math.max(1, lineEnds.length);
    });

    const sortedLanes = lanes.sort((a, b) => {
      return laneRank(a.threadName) - laneRank(b.threadName) || laneNumber(a.threadName) - laneNumber(b.threadName);
    });

    const stats = {
      fake: sortedLanes.filter((lane) => lane.threadKind === 0).length,
      aic: sortedLanes.filter((lane) => lane.threadKind === 1).length,
      aiv: sortedLanes.filter((lane) => lane.threadKind === 2).length,
      aicpu: sortedLanes.filter((lane) => lane.threadKind === 3).length,
      totalLanes: sortedLanes.length,
      totalTasks: sortedLanes.reduce((sum, lane) => sum + lane.taskCount, 0)
    };

    if (!Number.isFinite(minTs) || !Number.isFinite(maxTs) || maxTs <= minTs) {
      minTs = 0;
      maxTs = 1;
    }

    return { lanes: sortedLanes, stats, minTs, maxTs, span: maxTs - minTs };
  }

  function parseTraceEventSwimlane(raw) {
    const traceEvents = Array.isArray(raw?.traceEvents) ? raw.traceEvents : [];
    const processNames = new Map();
    const threadNames = new Map();
    const grouped = new Map();

    traceEvents.forEach((event) => {
      if (event?.name === 'process_name' && event.args?.name) {
        processNames.set(String(event.pid), String(event.args.name));
        return;
      }
      if (event?.name === 'thread_name' && event.args?.name) {
        threadNames.set(`${event.pid}-${event.tid}`, String(event.args.name));
      }
    });

    traceEvents.forEach((event, index) => {
      if (event?.cat !== 'event' || event?.ph === 'C' || typeof event?.ts !== 'number') return;

      const dur = typeof event?.dur === 'number' ? event.dur : 0;
      const end = event.ts + dur;
      const threadKey = `${event.pid}-${event.tid}`;
      const threadName = threadNames.get(threadKey) || `Thread ${event.tid ?? 0}`;
      const processName = processNames.get(String(event.pid)) || `Process ${event.pid ?? 0}`;
      const label = extractLabel(event.name);
      const task = {
        id: `${threadKey}-${index}`,
        pid: event.pid ?? 0,
        tid: event.tid ?? 0,
        ts: event.ts,
        dur,
        end,
        threadKey,
        threadName,
        processName,
        rawName: String(event.name || ''),
        label,
        line: 0
      };

      if (!grouped.has(threadName)) grouped.set(threadName, []);
      grouped.get(threadName).push(task);
    });

    const lanes = [...grouped.entries()].map(([threadName, tasks]) => {
      return {
        threadName,
        threadKind: laneRank(threadName),
        tasks
      };
    });

    return finalizeLaneTasks(lanes);
  }

  function parseCoreTaskSwimlane(raw) {
    const lanes = raw.map((entry, laneIndex) => {
      const threadName = String(entry?.coreType || `Core_${laneIndex}`);
      const tasks = Array.isArray(entry?.tasks) ? entry.tasks.map((task, taskIndex) => {
        const ts = Number(task?.execStart) || 0;
        const end = Number(task?.execEnd) || ts;
        const subGraphId = task?.subGraphId ?? 'unknown';
        const taskId = task?.taskId ?? taskIndex;
        return {
          id: `${threadName}-${taskId}-${taskIndex}`,
          pid: 0,
          tid: laneIndex,
          ts,
          dur: Math.max(0, end - ts),
          end,
          threadKey: `${laneIndex}`,
          threadName,
          processName: 'Machine View',
          rawName: `subGraph_${subGraphId} · task_${taskId}`,
          label: `subGraph_${subGraphId}`,
          line: 0,
        };
      }) : [];

      return {
        threadName,
        threadKind: laneRank(threadName),
        tasks,
      };
    });

    return finalizeLaneTasks(lanes);
  }

  function parseSwimlane(raw) {
    if (Array.isArray(raw)) return parseCoreTaskSwimlane(raw);
    if (Array.isArray(raw?.traceEvents)) return parseTraceEventSwimlane(raw);
    throw new Error('Unsupported swimlane json format.');
  }

  function renderSummary() {
    const { stats, span, fileName } = state;
    summary.innerHTML = '';
    if (!stats) return;

    const chips = [
      `文件：${fileName || '未命名'}`,
      `总泳道：${formatNumber(stats.totalLanes)}`,
      `Fake Core：${formatNumber(stats.fake)}`,
      `AIC：${formatNumber(stats.aic)}`,
      `AIV：${formatNumber(stats.aiv)}`,
      `Task：${formatNumber(stats.totalTasks)}`,
      `跨度：${formatTick(span)}`
    ];

    chips.forEach((text) => {
      const chip = document.createElement('div');
      chip.className = 'sw-chip';
      chip.textContent = text;
      summary.appendChild(chip);
    });
  }

  function renderTimeline(trackWidth) {
    timelineTrack.innerHTML = '';
    timelineTrack.style.width = `${trackWidth}px`;
    const tickStep = computeNiceStep(state.span);
    const minorStep = tickStep / 5;

    for (let value = 0; value <= state.span + 0.0001; value += minorStep) {
      const x = Math.round(value * state.pxPerUnit);
      const tick = document.createElement('div');
      tick.className = (Math.round(value / tickStep) === value / tickStep) ? 'sw-tick-major' : 'sw-tick-minor';
      tick.style.left = `${x}px`;
      timelineTrack.appendChild(tick);
    }

    for (let value = 0; value <= state.span + 0.0001; value += tickStep) {
      const x = Math.round(value * state.pxPerUnit);

      const label = document.createElement('div');
      label.className = 'sw-tick-label';
      label.style.left = `${x}px`;
      label.textContent = formatTick(value);
      timelineTrack.appendChild(label);

      const sub = document.createElement('div');
      sub.className = 'sw-tick-sub';
      sub.style.left = `${x}px`;
      sub.textContent = formatNumber(Math.round(value * 1000));
      timelineTrack.appendChild(sub);
    }
  }

  function renderLanes() {
    state.barElements.clear();
    laneLabelTrack.innerHTML = '';
    laneMainTrack.innerHTML = '';

    const leftWidth = 250;
    const trackWidth = Math.max(laneMainViewport.clientWidth - 24, Math.ceil(state.span * state.pxPerUnit) + 32);

    let cursorTop = 0;
    state.laneHeights.clear();

    state.lanes.forEach((lane) => {
      const metrics = laneMetrics(lane.threadKind, lane.lineCount);
      lane.top = cursorTop;
      lane.height = metrics.laneHeight;
      lane.metrics = metrics;
      cursorTop += metrics.laneHeight;
      state.laneHeights.set(lane.threadName, metrics.laneHeight);
    });

    const totalHeight = cursorTop;
    laneLabelTrack.style.height = `${totalHeight}px`;
    laneMainTrack.style.height = `${totalHeight}px`;
    laneMainTrack.style.width = `${trackWidth}px`;

    state.lanes.forEach((lane) => {
      const labelRow = document.createElement('div');
      labelRow.className = 'sw-lane-label-row';
      labelRow.style.top = `${lane.top}px`;
      labelRow.style.height = `${lane.height}px`;

      const labelName = document.createElement('div');
      labelName.className = 'sw-lane-label-name';
      labelName.textContent = lane.threadName;
      labelName.title = lane.threadName;

      const labelCount = document.createElement('div');
      labelCount.className = 'sw-lane-label-count';
      labelCount.textContent = String(lane.taskCount);

      labelRow.appendChild(labelName);
      labelRow.appendChild(labelCount);
      laneLabelTrack.appendChild(labelRow);

      const laneRow = document.createElement('div');
      laneRow.className = 'sw-lane-row';
      laneRow.style.top = `${lane.top}px`;
      laneRow.style.height = `${lane.height}px`;
      laneMainTrack.appendChild(laneRow);

      lane.tasks.forEach((task) => {
        const metrics = lane.metrics || laneMetrics(lane.threadKind, lane.lineCount);
        const bar = document.createElement('button');
        bar.type = 'button';
        bar.className = 'sw-bar';
        bar.title = `${task.rawName}\n${task.threadName}\nstart=${task.ts.toFixed(2)} end=${task.end.toFixed(2)} dur=${task.dur.toFixed(2)}`;
        bar.style.left = `${16 + Math.round((task.ts - state.minTs) * state.pxPerUnit)}px`;
        bar.style.top = `${lane.top + metrics.topPad + task.line * (metrics.barHeight + metrics.lineGap)}px`;
        bar.style.width = `${Math.max(3, Math.round(task.dur * state.pxPerUnit))}px`;
        bar.style.height = `${metrics.barHeight}px`;
        bar.style.background = colorForLabel(task.label);
        bar.dataset.taskId = task.id;
        bar.dataset.search = `${task.rawName} ${task.label} ${task.threadName}`.toLowerCase();
        bar.addEventListener('click', () => {
          state.barElements.forEach((element) => element.classList.remove('is-active'));
          bar.classList.add('is-active');
        });
        state.barElements.set(task.id, bar);
        laneMainTrack.appendChild(bar);
      });
    });

    renderTimeline(trackWidth);
    syncOverlay();
    updateSearch();
  }

  function syncOverlay() {
    const scrollTop = laneMainViewport.scrollTop;
    const scrollLeft = laneMainViewport.scrollLeft;
    laneLabelTrack.style.transform = `translateY(${-scrollTop}px)`;
    timelineTrack.style.transform = `translateX(${-scrollLeft}px)`;
  }

  function updateSearch() {
    const query = searchInput.value.trim().toLowerCase();
    state.matches = [];
    state.activeMatchIndex = -1;

    state.barElements.forEach((bar) => {
      bar.classList.remove('is-match');
      if (!query) return;
      if (bar.dataset.search.includes(query)) {
        bar.classList.add('is-match');
        state.matches.push(bar);
      }
    });

    if (state.matches.length > 0) {
      state.activeMatchIndex = 0;
      focusMatch(0);
    } else {
      searchCount.textContent = '0 / 0';
    }
  }

  function focusMatch(index) {
    if (!state.matches.length) {
      searchCount.textContent = '0 / 0';
      return;
    }
    state.matches.forEach((bar) => bar.classList.remove('is-active'));
    const target = state.matches[index];
    target.classList.add('is-active');
    state.activeMatchIndex = index;
    searchCount.textContent = `${index + 1} / ${state.matches.length}`;

    const top = target.offsetTop;
    const left = target.offsetLeft;
    laneMainViewport.scrollTo({
      top: Math.max(0, top - laneMainViewport.clientHeight / 2),
      left: Math.max(0, left - 120),
      behavior: 'smooth'
    });
  }

  function goToNextMatch(step) {
    if (!state.matches.length) return;
    const nextIndex = (state.activeMatchIndex + step + state.matches.length) % state.matches.length;
    focusMatch(nextIndex);
  }

  function updateMeta(fileName) {
    fileMeta.textContent = fileName;
  }

  function showViewer() {
    emptyState.hidden = true;
    viewer.hidden = false;
  }

  function showEmpty() {
    viewer.hidden = true;
    emptyState.hidden = false;
  }

  function fitZoom() {
    const width = Math.max(laneMainViewport.clientWidth - 40, 600);
    state.pxPerUnit = Math.max(1.6, width / state.span);
    renderLanes();
  }

  async function loadFromObject(raw, fileName) {
    const parsed = parseSwimlane(raw);
    state.raw = raw;
    state.fileName = fileName;
    state.lanes = parsed.lanes;
    state.stats = parsed.stats;
    state.minTs = parsed.minTs;
    state.maxTs = parsed.maxTs;
    state.span = parsed.span;
    updateMeta(fileName);
    renderSummary();
    showViewer();
    fitZoom();
  }

  async function loadFromText(text, fileName) {
    const raw = JSON.parse(text);
    await loadFromObject(raw, fileName);
  }

  async function loadFromQueryFile(file) {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`Failed to fetch ${file}`);
    const text = await res.text();
    await loadFromText(text, file.split('/').pop() || 'merged_swimlane.json');
  }

  async function loadFromSessionStorage() {
    const meta = sessionStorage.getItem(STORAGE_META_KEY);
    const text = sessionStorage.getItem(STORAGE_TEXT_KEY);
    if (!meta || !text) return false;
    try {
      const parsedMeta = JSON.parse(meta);
      await loadFromText(text, parsedMeta?.name || 'local-swimlane.json');
      return true;
    } finally {
      sessionStorage.removeItem(STORAGE_META_KEY);
      sessionStorage.removeItem(STORAGE_TEXT_KEY);
    }
  }

  async function handleLocalFile(file) {
    const text = await file.text();
    await loadFromText(text, file.name);
  }

  openLocalBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await handleLocalFile(file);
    } catch (error) {
      console.error(error);
      alert('Failed to read the selected swimlane json file.');
    } finally {
      fileInput.value = '';
    }
  });

  laneMainViewport?.addEventListener('scroll', syncOverlay);
  searchInput?.addEventListener('input', updateSearch);
  searchPrevBtn?.addEventListener('click', () => goToNextMatch(-1));
  searchNextBtn?.addEventListener('click', () => goToNextMatch(1));
  zoomInBtn?.addEventListener('click', () => {
    state.pxPerUnit *= 1.2;
    renderLanes();
  });
  zoomOutBtn?.addEventListener('click', () => {
    state.pxPerUnit = Math.max(0.5, state.pxPerUnit / 1.2);
    renderLanes();
  });
  zoomFitBtn?.addEventListener('click', fitZoom);
  window.addEventListener('resize', () => {
    if (!state.lanes.length) return;
    fitZoom();
  });

  (async function init() {
    showEmpty();
    const params = new URLSearchParams(location.search);
    const action = params.get('action');
    const file = params.get('file');

    try {
      if (action === 'open-file') {
        const loaded = await loadFromSessionStorage();
        if (!loaded) {
          fileMeta.textContent = '没有找到来自 Launcher 的本地文件内容，请重新选择。';
        }
        return;
      }
      if (file) {
        await loadFromQueryFile(file);
        return;
      }
    } catch (error) {
      console.error(error);
      fileMeta.textContent = '泳道文件加载失败';
      alert('Failed to load swimlane data.');
    }
  })();
})();

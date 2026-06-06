(function registerMatmulTilingPage(global) {
  'use strict';

  const Model = global.MatmulTilingModel;
  if (!Model) return;

  const CPP_KEYWORDS = new Set([
    'alignas', 'auto', 'break', 'case', 'class', 'const', 'constexpr', 'continue', 'else',
    'false', 'for', 'if', 'inline', 'namespace', 'return', 'struct', 'template', 'true',
    'typename', 'using', 'void', 'while',
  ]);
  const CPP_TYPES = new Set([
    'bool', 'float', 'half', 'int', 'int32_t', 'int64_t', 'uint16_t', 'uint32_t', 'uint64_t',
    'TCubeTiling', 'GlobalTensor', 'LocalTensor',
  ]);

  const SOURCE_LINES = [
    { text: 'struct TCubeTiling {', tag: 'tiling' },
    { text: '  uint32_t usedCoreNum;       // 调度核数', field: 'usedCoreNum' },
    { text: '  uint32_t M;                 // batch × seq 派生', field: 'M' },
    { text: '  uint32_t N;                 // output dim', field: 'N' },
    { text: '  uint32_t Ka;                // reduction K', field: 'K' },
    { text: '  uint32_t singleCoreM;', field: 'singleCoreM' },
    { text: '  uint32_t singleCoreN;', field: 'singleCoreN' },
    { text: '  uint32_t singleCoreK;', field: 'singleCoreK' },
    { text: '  uint32_t baseM;             // L0A/L0C 约束锚点', field: 'baseM' },
    { text: '  uint32_t baseN;             // L0B/L0C 约束锚点', field: 'baseN' },
    { text: '  uint32_t baseK;             // L0A/L0B 约束锚点', field: 'baseK' },
    { text: '  uint32_t dbL0A;             // DB 只影响第二份余量', field: 'dbL0A' },
    { text: '  uint32_t dbL0B;', field: 'dbL0B' },
    { text: '  uint32_t dbL0C;', field: 'dbL0C' },
    { text: '  uint32_t iterateOrder;      // 0: M-first, 1: N-first', field: 'iterateOrder' },
    { text: '};' },
    { text: '' },
    { text: 'void GetTiling(const Context& ctx, TCubeTiling& tiling) {' },
    { text: '  tiling.M = ctx.batch * ctx.seq;          // 主入口不裸填 M', field: 'M' },
    { text: '  tiling.N = ctx.weightN;', field: 'N' },
    { text: '  tiling.Ka = ctx.weightK;', field: 'K' },
    { text: '  // 本页 seed 是 safe default，不等于真实 CANN 自动 tiling 输出' },
    { text: '  CheckL0ASize(tiling.baseM * tiling.baseK * elemBytes);', field: 'L0A' },
    { text: '  CheckL0BSize(tiling.baseK * tiling.baseN * elemBytes);', field: 'L0B' },
    { text: '  CheckL0CSize(tiling.baseM * tiling.baseN * sizeof(float));', field: 'L0C' },
    { text: '  // GetL0cDB 在合法 base 上再判断 double buffer 可否开启' },
    { text: '}' },
    { text: '' },
    { text: '__aicore__ void MatMulKernel(GM_ADDR x, GM_ADDR w, GM_ADDR y) {' },
    { text: '  auto tiling = GET_TILING_DATA(tiling);' },
    { text: '  for (uint32_t m = 0; m < tiling.M; m += tiling.singleCoreM) {', field: 'singleCoreM' },
    { text: '    for (uint32_t n = 0; n < tiling.N; n += tiling.singleCoreN) {', field: 'singleCoreN' },
    { text: '      for (uint32_t k = 0; k < tiling.Ka; k += tiling.baseK) {', field: 'baseK' },
    { text: '        LoadData(L1, L0A, tiling.baseM, tiling.baseK);', field: 'L0A' },
    { text: '        LoadData(L1, L0B, tiling.baseK, tiling.baseN);', field: 'L0B' },
    { text: '        Mmad(L0C, L0A, L0B, tiling.baseM, tiling.baseN);', field: 'L0C' },
    { text: '      }' },
    { text: '    }' },
    { text: '  }' },
    { text: '}' },
  ];

  const FIELD_TO_BUFFERS = {
    baseM: ['L0A', 'L0C'],
    baseN: ['L0B', 'L0C'],
    baseK: ['L0A', 'L0B'],
    dbL0A: ['L0A'],
    dbL0B: ['L0B'],
    dbL0C: ['L0C'],
    L0A: ['L0A'],
    L0B: ['L0B'],
    L0C: ['L0C'],
    singleCoreM: ['L1'],
    singleCoreN: ['L1'],
    singleCoreK: ['L1'],
  };

  const BUFFER_FIELDS = {
    L0A: ['baseM', 'baseK', 'dbL0A'],
    L0B: ['baseN', 'baseK', 'dbL0B'],
    L0C: ['baseM', 'baseN', 'dbL0C'],
    L1: ['singleCoreM', 'singleCoreN', 'singleCoreK'],
  };

  const els = {};
  const initial = Model.createInitialState('prefill');
  const PLAYBACK_IDS = {
    shell: 'mtil-pb-shell',
    toggle: 'mtil-pb-toggle',
    collapsedButton: 'mtil-pb-collapsed',
    collapsedIcon: 'mtil-pb-collapsed-icon',
    controls: 'mtil-pb-controls',
    stepBack: 'mtil-pb-back',
    play: 'mtil-pb-play',
    stepForward: 'mtil-pb-fwd',
    replay: 'mtil-pb-replay',
    scrubber: 'mtil-pb-scrubber',
    scrubberLabel: 'mtil-pb-label',
    scrubberOpname: 'mtil-pb-opname',
    scrubberHover: 'mtil-pb-hover',
  };
  const DEFAULT_VIEW_SCALE = 1.67;
  const state = {
    scenario: initial.scenario,
    tilingSeed: initial.tilingSeed,
    eval: null,
    hoverField: null,
    hoverBuffer: null,
    currentCore: 0,
    kIndex: 0,
    inputTab: 'scenario',
    playing: false,
    timer: null,
    playback: null,
    applyStatusTimer: null,
    viewport: { scale: DEFAULT_VIEW_SCALE, panX: 0, panY: 0, dragging: false, lastX: 0, lastY: 0 },
    redrawFrame: 0,
    resizeObserver: null,
    axisHits: [],
    bufferSignature: '',
    bufferCells: {},
  };

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const ceil = (a, b) => Math.max(1, Math.ceil(Math.max(1, a) / Math.max(1, b)));

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function highlightAscendC(code) {
    const escaped = escapeHtml(code);
    const re = /(\/\/.*$)|(\/\*.*?\*\/)|(&quot;(?:\\.|[^&])*?&quot;)|(&#39;(?:\\.|[^&])*?&#39;)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;
    let out = '';
    let last = 0;
    let match;
    while ((match = re.exec(escaped)) !== null) {
      if (match.index > last) out += escaped.slice(last, match.index);
      if (match[1] || match[2]) out += `<span class="tk-comment">${match[0]}</span>`;
      else if (match[3] || match[4]) out += `<span class="tk-string">${match[0]}</span>`;
      else if (match[5]) out += `<span class="tk-number">${match[5]}</span>`;
      else if (match[6]) {
        const id = match[6];
        const next = escaped[re.lastIndex];
        if (CPP_KEYWORDS.has(id)) out += `<span class="tk-keyword">${id}</span>`;
        else if (CPP_TYPES.has(id)) out += `<span class="tk-type">${id}</span>`;
        else if (next === '(') out += `<span class="tk-fn">${id}</span>`;
        else out += id;
      }
      last = re.lastIndex;
    }
    if (last < escaped.length) out += escaped.slice(last);
    return out;
  }

  function getCss(name) {
    return global.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function collectEls() {
    [
      'presetSelect', 'chipSelect', 'sourceMeta', 'legalChip', 'codeLines', 'derivedM',
      'scenarioNote', 'keyStrip', 'advancedMnk', 'advancedGrid', 'constraintNotes',
      'perfLevel', 'intensityValue', 'dbGainValue', 'iterateValue', 'tilingCanvas',
      'tilingStage', 'tilingFallback', 'logicalReadout', 'bufferStage',
      'axisHotspots', 'axisPanel', 'capacityMeta', 'zoomOut', 'zoomIn', 'fitView', 'playbackMount',
      'applyInputs', 'applyStatus',
    ].forEach((id) => { els[id] = qs(`#${id}`); });
  }

  function init() {
    collectEls();
    renderSource();
    renderKeyStrip();
    bindControls();
    bindCanvas();
    bindResizeObservers();
    initPlayback();
    render();
    global.addEventListener('resize', scheduleLogicalRedraw);
  }

  function scheduleLogicalRedraw() {
    if (state.redrawFrame) return;
    state.redrawFrame = global.requestAnimationFrame(() => {
      state.redrawFrame = 0;
      drawLogicalCanvas();
    });
  }

  function bindResizeObservers() {
    if (!global.ResizeObserver) return;
    const targets = [els.tilingStage, els.tilingCanvas].filter(Boolean);
    if (!targets.length) return;
    state.resizeObserver = new global.ResizeObserver(scheduleLogicalRedraw);
    targets.forEach((target) => state.resizeObserver.observe(target));
  }

  function setInputTab(tab) {
    state.inputTab = tab;
    qsa('[data-input-tab]').forEach((button) => {
      const active = button.dataset.inputTab === tab;
      button.classList.toggle('is-active', active);
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    qsa('[data-input-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.inputPanel !== tab;
    });
    if (tab === 'code') drawLogicalCanvas();
  }

  function renderSource() {
    if (!els.codeLines) return;
    els.codeLines.innerHTML = SOURCE_LINES.map((line, index) => `
      <div class="mtil-source-line" data-line-index="${index}" ${line.field ? `data-field="${escapeHtml(line.field)}"` : ''}>
        <span class="mtil-source-line__number">${String(index + 1).padStart(2, '0')}</span>
        <span class="mtil-source-line__text">${highlightAscendC(line.text)}</span>
        <span class="mtil-source-line__tag">${escapeHtml(line.field || line.tag || '')}</span>
      </div>
    `).join('');
    qsa('[data-field]', els.codeLines).forEach((line) => {
      line.addEventListener('mouseenter', () => setHover(line.dataset.field || null));
      line.addEventListener('mouseleave', () => setHover(null));
      line.addEventListener('click', () => setHover(line.dataset.field || null, true));
    });
  }

  function renderKeyStrip() {
    if (!els.keyStrip) return;
    els.keyStrip.innerHTML = Object.entries(Model.SAFE_SEEDS).map(([id, preset]) => `
      <button class="btn btn-sm" type="button" data-key-preset="${id}" title="${escapeHtml(preset.why)}">
        ${escapeHtml(preset.label)}
      </button>
    `).join('');
  }

  function setHover(field, sticky = false) {
    state.hoverField = field;
    state.hoverBuffer = null;
    applyHighlights(sticky);
  }

  function setBufferHover(buffer) {
    state.hoverBuffer = buffer;
    state.hoverField = null;
    applyHighlights();
  }

  function applyHighlights() {
    const fields = new Set();
    const buffers = new Set();
    if (state.hoverField) {
      fields.add(state.hoverField);
      (FIELD_TO_BUFFERS[state.hoverField] || []).forEach((buffer) => buffers.add(buffer));
    }
    if (state.hoverBuffer) {
      buffers.add(state.hoverBuffer);
      (BUFFER_FIELDS[state.hoverBuffer] || []).forEach((field) => fields.add(field));
    }
    qsa('.mtil-source-line').forEach((line) => {
      line.classList.toggle('is-active', !!line.dataset.field && fields.has(line.dataset.field));
    });
    qsa('[data-field-host]').forEach((host) => {
      host.classList.toggle('is-active', fields.has(host.dataset.fieldHost));
    });
    qsa('.pto-aic-core__buffer, .pto-aic-core__cube', els.bufferStage).forEach((node) => {
      const key = node.dataset.bufferKey || (node.dataset.aicNode || '').replace('buffer:', '').replace('cube:', '');
      node.classList.toggle('is-mtil-focus', buffers.has(key));
    });
  }

  function bindControls() {
    document.addEventListener('input', (event) => {
      const target = event.target;
      if (target.matches('[data-scenario]')) {
        if (isEmptyNumberInput(target)) {
          setApplyStatus('等待输入完成');
          return;
        }
        writeScenarioValue(target.dataset.scenario, target.value);
        render();
        setApplyStatus('已实时更新', true);
      } else if (target.matches('[data-tiling]')) {
        if (isEmptyNumberInput(target)) {
          setApplyStatus('等待输入完成');
          return;
        }
        writeTilingValue(target.dataset.tiling, target.value);
        render();
        setApplyStatus('已实时更新', true);
      } else if (target.matches('[data-scenario-check]')) {
        state.scenario[target.dataset.scenarioCheck] = target.checked;
        render();
        setApplyStatus('已实时更新', true);
      }
    });

    document.addEventListener('change', (event) => {
      const target = event.target;
      if (target.matches('[data-control="preset"]')) {
        loadPreset(target.value);
      } else if (target.matches('[data-scenario]')) {
        if (isEmptyNumberInput(target)) {
          setApplyStatus('等待输入完成');
          return;
        }
        writeScenarioValue(target.dataset.scenario, target.value);
        render();
        setApplyStatus('已实时更新', true);
      } else if (target.matches('[data-scenario-check]')) {
        state.scenario[target.dataset.scenarioCheck] = target.checked;
        render();
        setApplyStatus('已实时更新', true);
      }
    });

    document.addEventListener('click', (event) => {
      const axisHotspot = event.target.closest('[data-axis-hotspot]');
      if (axisHotspot) {
        const hit = state.axisHits.find((item) => item.axis === axisHotspot.dataset.axisHotspot);
        if (hit) showAxisPanel(hit, event);
        return;
      }
      if (!event.target.closest('#tilingStage')) hideAxisPanel();
      const apply = event.target.closest('#applyInputs');
      const tab = event.target.closest('[data-input-tab]');
      const segment = event.target.closest('[data-segment]');
      const db = event.target.closest('[data-db-toggle]');
      const keyPreset = event.target.closest('[data-key-preset]');
      if (apply) {
        applyCurrentInputs();
        return;
      }
      if (tab) {
        setInputTab(tab.dataset.inputTab);
        return;
      }
      if (segment) {
        if (segment.dataset.segment === 'dtype') state.scenario.dtype = segment.dataset.value;
        if (segment.dataset.segment === 'iterateOrder') state.tilingSeed.iterateOrder = Number(segment.dataset.value);
        render();
        setApplyStatus('已实时更新', true);
      } else if (db) {
        const key = db.dataset.dbToggle;
        state.tilingSeed[key] = state.tilingSeed[key] ? 0 : 1;
        render();
        setApplyStatus('已实时更新', true);
      } else if (keyPreset) {
        loadPreset(keyPreset.dataset.keyPreset);
      }
    });

    els.zoomOut?.addEventListener('click', () => zoomBy(0.9));
    els.zoomIn?.addEventListener('click', () => zoomBy(1.1));
    els.fitView?.addEventListener('click', () => {
      state.viewport.scale = DEFAULT_VIEW_SCALE;
      state.viewport.panX = 0;
      state.viewport.panY = 0;
      hideAxisPanel();
      drawLogicalCanvas();
    });
  }

  function setApplyStatus(text, fresh = false) {
    if (!els.applyStatus) return;
    els.applyStatus.textContent = text;
    els.applyStatus.classList.toggle('is-fresh', !!fresh);
    if (state.applyStatusTimer) global.clearTimeout(state.applyStatusTimer);
    if (fresh) {
      state.applyStatusTimer = global.setTimeout(() => {
        els.applyStatus.textContent = '实时联动';
        els.applyStatus.classList.remove('is-fresh');
        state.applyStatusTimer = null;
      }, 1400);
    }
  }

  function isEmptyNumberInput(input) {
    return input?.matches?.('input[type="number"]') && String(input.value).trim() === '';
  }

  function applyCurrentInputs() {
    qsa('[data-scenario]').forEach((input) => {
      if (!input.disabled && !isEmptyNumberInput(input)) writeScenarioValue(input.dataset.scenario, input.value);
    });
    qsa('[data-tiling]').forEach((input) => {
      if (!isEmptyNumberInput(input)) writeTilingValue(input.dataset.tiling, input.value);
    });
    qsa('[data-scenario-check]').forEach((input) => {
      state.scenario[input.dataset.scenarioCheck] = input.checked;
    });
    state.currentCore = 0;
    state.kIndex = 0;
    stopPlayback();
    render();
    setApplyStatus('已应用到三个视图', true);
  }

  function writeScenarioValue(key, value) {
    if (key === 'chip' || key === 'dtype' || key === 'presetId') {
      state.scenario[key] = value;
      return;
    }
    const n = Number(value);
    state.scenario[key] = Number.isFinite(n) ? n : null;
  }

  function writeTilingValue(key, value) {
    const n = Number(value);
    state.tilingSeed[key] = Number.isFinite(n) ? n : state.tilingSeed[key];
  }

  function loadPreset(id) {
    const preset = Model.SAFE_SEEDS[id] || Model.SAFE_SEEDS.prefill;
    state.scenario = Model.clone(preset.scenario);
    state.tilingSeed = { ...Model.clone(preset.tiling), defaultSource: 'safe-seed' };
    state.currentCore = 0;
    state.kIndex = 0;
    state.bufferSignature = '';
    stopPlayback();
    render();
  }

  function render() {
    state.eval = Model.evaluate(state.scenario, state.tilingSeed);
    state.currentCore = clamp(state.currentCore, 0, Math.max(0, state.eval.derived.coreTiles - 1));
    state.kIndex = clamp(state.kIndex, 0, Math.max(0, state.eval.derived.kLoop - 1));
    syncControls();
    renderStatus();
    renderNotes();
    renderPerf();
    renderConstraints();
    renderLogicalReadout();
    drawLogicalCanvas();
    markSourceProblems();
    applyHighlights();
    syncPlayback();
  }

  function syncControls() {
    const { scenario, tilingSeed } = state;
    if (els.presetSelect) els.presetSelect.value = scenario.presetId || 'prefill';
    if (els.chipSelect) els.chipSelect.value = scenario.chip;
    qsa('[data-scenario]').forEach((input) => {
      const key = input.dataset.scenario;
      if (document.activeElement !== input) input.value = scenario[key] ?? '';
    });
    qsa('[data-tiling]').forEach((input) => {
      const key = input.dataset.tiling;
      if (document.activeElement !== input) input.value = tilingSeed[key] ?? '';
    });
    if (els.advancedMnk) els.advancedMnk.checked = !!scenario.advancedMnk;
    qsa('[data-scenario^="override"]').forEach((input) => {
      input.disabled = !scenario.advancedMnk;
    });
    qsa('[data-segment="dtype"]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.value === scenario.dtype);
    });
    qsa('[data-segment="iterateOrder"]').forEach((button) => {
      button.classList.toggle('is-selected', Number(button.dataset.value) === Number(tilingSeed.iterateOrder));
    });
    qsa('[data-db-toggle]').forEach((button) => {
      const key = button.dataset.dbToggle;
      const buffer = button.dataset.bufferKey;
      const item = state.eval?.constraints?.[buffer];
      const on = !!tilingSeed[key];
      const warning = !!on && !!item?.dbWouldOver;
      const error = !!item?.over;
      const dbRole = buffer === 'L0C'
        ? 'L0C accumulator 双份余量检查'
        : `${buffer} 双缓冲；L0A/L0B 同开时计入 DB overlap 估算`;
      const capacity = item ? `${Model.formatBytes(item.used)} / ${Model.formatBytes(item.full)}` : '';
      const status = error
        ? '当前 base tile 已超过容量'
        : warning
          ? '当前 base tile 合法，但打开 DB 后第二份放不下'
          : on
            ? '已开启'
            : '已关闭';
      button.classList.toggle('is-selected', on);
      button.classList.toggle('is-warning', warning);
      button.classList.toggle('is-error', error);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.title = `${dbRole} · ${status}${capacity ? ` · ${capacity}` : ''}`;
    });
    qsa('[data-key-preset]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.keyPreset === scenario.presetId);
    });
  }

  function renderStatus() {
    const { tiling, constraints, derived } = state.eval;
    const preset = Model.SAFE_SEEDS[state.scenario.presetId] || Model.SAFE_SEEDS.prefill;
    if (els.derivedM) els.derivedM.textContent = `M = ${tiling.M} (${state.scenario.batch}×${state.scenario.seq})`;
    if (els.scenarioNote) els.scenarioNote.textContent = preset.why;
    if (els.sourceMeta) els.sourceMeta.textContent = `${tiling.chip} · ${tiling.dtype} · safe default seed`;
    if (els.legalChip) {
      els.legalChip.textContent = constraints.legal
        ? (constraints.hasDbWarning ? 'legal · DB warning' : 'legal')
        : 'illegal';
      els.legalChip.classList.toggle('is-error', !constraints.legal);
      els.legalChip.classList.toggle('is-warning', constraints.legal && constraints.hasDbWarning);
    }
    if (els.capacityMeta) {
      const cap = constraints.cap;
      els.capacityMeta.textContent = `芯片容量按 compute 口径；L0C 始终按 FP32 accumulator`;
    }
  }

  function renderNotes() {
    if (!els.constraintNotes) return;
    const { constraints, derived } = state.eval;
    const notes = constraints.notes.slice();
    if (derived.coreMismatch) {
      notes.push({
        field: 'usedCoreNum',
        level: 'warning',
        text: `usedCoreNum=${state.eval.tiling.usedCoreNum}，输出分块=${derived.coreTiles}，核数不一定整除。`,
      });
    }
    if (!notes.length) {
      notes.push({ level: 'info', text: '当前 base tile 满容量合法；DB 余量按第二层单独判断。' });
    }
    els.constraintNotes.innerHTML = notes.map((note) => `
      <span class="mtil-note is-${escapeHtml(note.level || 'info')}" ${note.field ? `data-note-field="${escapeHtml(note.field)}"` : ''}>${escapeHtml(note.text)}</span>
    `).join('');
  }

  function renderPerf() {
    const { perf } = state.eval;
    if (els.perfLevel) {
      const label = perf.level === 'good' ? 'green' : perf.level === 'warn' ? 'yellow' : 'red';
      els.perfLevel.textContent = label;
      els.perfLevel.classList.toggle('is-warning', perf.level === 'warn');
      els.perfLevel.classList.toggle('is-error', perf.level === 'bad');
    }
    if (els.intensityValue) els.intensityValue.textContent = perf.intensity.toFixed(1);
    if (els.dbGainValue) els.dbGainValue.textContent = `${Math.round(perf.dbGain * 100)}%`;
    if (els.iterateValue) els.iterateValue.textContent = `${perf.iterateLabel}${perf.iterateMatches ? '' : ` → ${perf.iteratePreferred}`}`;
  }

  function markSourceProblems() {
    const { constraints } = state.eval;
    const errorFields = new Set();
    const warningFields = new Set();
    ['L0A', 'L0B', 'L0C', 'L1'].forEach((key) => {
      if (constraints[key].over) {
        errorFields.add(key);
        (BUFFER_FIELDS[key] || []).forEach((field) => errorFields.add(field));
      } else if (constraints[key].dbWouldOver) {
        warningFields.add(key);
        (BUFFER_FIELDS[key] || []).forEach((field) => warningFields.add(field));
      }
    });
    if (!constraints.align.baseM) warningFields.add('baseM');
    if (!constraints.align.baseN) warningFields.add('baseN');
    constraints.notes.forEach((note) => {
      if (note.level === 'warning' && note.field) warningFields.add(note.field);
    });
    qsa('.mtil-source-line').forEach((line) => {
      const field = line.dataset.field;
      line.classList.toggle('is-error', !!field && errorFields.has(field));
      line.classList.toggle('is-warning', !!field && !errorFields.has(field) && warningFields.has(field));
    });
    qsa('[data-field-host]').forEach((host) => {
      const field = host.dataset.fieldHost;
      host.classList.toggle('is-error', errorFields.has(field));
      host.classList.toggle('is-warning', !errorFields.has(field) && warningFields.has(field));
    });
  }

  // Signature includes base dims + dtype so the grid re-renders when the tile
  // shape (and therefore the C0 cell grid) changes — not just on chip change.
  function chipSignature(cap) {
    const t = state.eval.tiling;
    return [t.chip, t.dtype, t.baseM, t.baseN, t.baseK, cap.L0A, cap.L0B, cap.L0C, Model.capL1(cap)].join(':');
  }

  // Grid mirrors the base tile at C0 (16-element) granularity, so the
  // architecture cells ARE the tile that used to live in the separate strip.
  function gridForBuffer(key) {
    const t = state.eval.tiling;
    const c0 = Model.C0_SIZE;
    if (key === 'L1') return { rows: 12, cols: 12, cellSize: 9, gap: 1, band: { from: 0, to: 0 } };
    const dims = { L0A: [t.baseM, t.baseK], L0B: [t.baseK, t.baseN], L0C: [t.baseM, t.baseN] }[key];
    const rows = clamp(Math.ceil(dims[0] / c0), 1, 12);
    const cols = clamp(Math.ceil(dims[1] / c0), 1, 16);
    const cellSize = (rows > 8 || cols > 12) ? 8 : 10;
    return { rows, cols, cellSize, gap: 1, band: { from: 0, to: 0 } };
  }

  function matmulPreset() {
    const { constraints } = state.eval;
    const cap = constraints.cap;
    const l1Full = Model.capL1(cap);
    const t = state.eval.tiling;
    const grids = {
      L1: gridForBuffer('L1'),
      L0A: gridForBuffer('L0A'),
      L0B: gridForBuffer('L0B'),
      L0C: gridForBuffer('L0C'),
    };
    state.bufferCells = Object.fromEntries(Object.entries(grids).map(([key, grid]) => [key, grid.rows * grid.cols]));
    return {
      id: `matmul-${state.eval.tiling.chip}`,
      name: 'MatMul Tiling AIC',
      title: 'AIC MatMul Tile',
      stageClassName: 'pto-aic-core--matmul',
      routes: [
        { from: 'buffer:L1', to: 'buffer:L0A', color: 'transport', style: 'lane-h', fromSide: 'right', toSide: 'left' },
        { from: 'buffer:L1', to: 'buffer:L0B', color: 'transport', style: 'lane-h', fromSide: 'right', toSide: 'left' },
        { from: 'buffer:L0A', to: 'cube:CUBE', color: 'transport', style: 'elbow-h', fromSide: 'right', toSide: 'left' },
        { from: 'buffer:L0B', to: 'cube:CUBE', color: 'transport', style: 'elbow-h', fromSide: 'right', toSide: 'left' },
        { from: 'cube:CUBE', to: 'buffer:L0C', color: 'transport', style: 'elbow-h', fromSide: 'right', toSide: 'left' },
      ],
      layout: {
        kind: 'group',
        className: 'pto-aic-core__layout',
        children: [
          {
            kind: 'group',
            className: 'pto-aic-core__top-row',
            children: [
              { kind: 'buffer', key: 'L1', label: 'L1', capacity: `${Model.formatBytes(l1Full)} compute`, grid: grids.L1, frame: { minWidth: 164 } },
              {
                kind: 'group',
                className: 'pto-aic-core__transport-stack',
                children: [
                  { kind: 'buffer-lane', transport: 'MTE1', buffer: { kind: 'buffer', key: 'L0A', label: 'L0A', capacity: `${t.baseM}×${t.baseK} ${t.dtype}`, grid: grids.L0A, frame: { minWidth: 150 } } },
                  { kind: 'buffer-lane', transport: 'MTE1', buffer: { kind: 'buffer', key: 'L0B', label: 'L0B', capacity: `${t.baseK}×${t.baseN} ${t.dtype}`, grid: grids.L0B, frame: { minWidth: 150 } } },
                ],
              },
              { kind: 'cube', label: 'CUBE', frame: { width: 120, height: 120 } },
              { kind: 'buffer', key: 'L0C', label: 'L0C', capacity: `${t.baseM}×${t.baseN} fp32`, grid: grids.L0C, frame: { minWidth: 164 } },
            ],
          },
        ],
      },
    };
  }

  function renderConstraints() {
    if (!els.bufferStage || !global.PtoAicCorePattern) return;
    const signature = chipSignature(state.eval.constraints.cap);
    if (signature !== state.bufferSignature) {
      global.PtoAicCorePattern.render(els.bufferStage, matmulPreset());
      state.bufferSignature = signature;
      bindBufferHover();
    }
    global.PtoAicCorePattern.setBufferBlocks(els.bufferStage, bufferBlocks());
    updateBufferOccupancy();
  }

  function bindBufferHover() {
    ['L1', 'L0A', 'L0B', 'L0C'].forEach((key) => {
      const node = qs(`[data-buffer-key="${key}"]`, els.bufferStage);
      node?.addEventListener('mouseenter', () => setBufferHover(key));
      node?.addEventListener('mouseleave', () => setBufferHover(null));
    });
    const cube = qs('[data-aic-node="cube:CUBE"]', els.bufferStage);
    cube?.addEventListener('mouseenter', () => setBufferHover('L0C'));
    cube?.addEventListener('mouseleave', () => setBufferHover(null));
  }

  // Cell fill = tile state at the current step (not raw capacity):
  // L0A/L0B hold the fully-loaded base tile; L0C accumulates with K; L1 stages.
  function bufferBlocks() {
    const { constraints, derived } = state.eval;
    const kProgress = (state.kIndex + 1) / Math.max(1, derived.kLoop);
    const blocks = ['L1', 'L0A', 'L0B', 'L0C'].map((key) => {
      const item = constraints[key];
      const cells = Math.max(1, state.bufferCells[key] || 24);
      const fill = key === 'L0C' ? kProgress : key === 'L1' ? Math.min(1, item.ratio) : 1;
      const usedCells = clamp(Math.ceil(cells * fill), 1, cells);
      return {
        buffer: key,
        cellRange: [0, usedCells - 1],
        label: `${key} ${percent(item.ratio)}`,
        sourceTile: `${Model.formatBytes(item.used)} / ${Model.formatBytes(item.full)}`,
        state: item.over ? 'error' : item.dbWouldOver ? 'warning' : 'loaded',
        tone: item.tone,
      };
    });
    // L1 stays full within a core; show WHICH base-tile slice is being read out
    // to L0 right now — a playhead that sweeps its staged data as K advances.
    const l1Cells = Math.max(1, state.bufferCells.L1 || 24);
    const l1Used = clamp(Math.ceil(l1Cells * Math.min(1, constraints.L1.ratio)), 1, l1Cells);
    const headLen = Math.max(1, Math.round(l1Used / 8));
    const headStart = clamp(Math.round(kProgress * (l1Used - headLen)), 0, Math.max(0, l1Used - headLen));
    blocks.push({
      buffer: 'L1',
      cellRange: [headStart, headStart + headLen - 1],
      label: `L1 读取 slice ${state.kIndex + 1}/${derived.kLoop}`,
      state: 'accumulating',
      tone: 'accumulator',
    });
    return blocks;
  }

  // Occupancy written directly onto each architecture buffer unit (no side cards):
  // appends a "used/full · NN%" chip into the buffer's capacity label, tinted by state.
  function updateBufferOccupancy() {
    if (!els.bufferStage) return;
    const { constraints, derived } = state.eval;
    const kNote = `K tile ${state.kIndex + 1}/${derived.kLoop}`;
    const tileNotes = {
      L1: `读 slice ${state.kIndex + 1}/${derived.kLoop}`,
      L0A: kNote,
      L0B: kNote,
      L0C: `acc ${percent((state.kIndex + 1) / Math.max(1, derived.kLoop))} K`,
    };
    ['L1', 'L0A', 'L0B', 'L0C'].forEach((key) => {
      const item = constraints[key];
      const node = qs(`[data-buffer-key="${key}"]`, els.bufferStage);
      const capacity = node && qs('.pto-aic-core__buffer-capacity', node);
      if (!capacity) return;
      if (!capacity.dataset.baseCapacity) capacity.dataset.baseCapacity = capacity.textContent.trim();
      const cls = item.over ? 'is-error' : item.dbWouldOver ? 'is-warning' : '';
      const title = item.over
        ? '超满容量：tiling 非法'
        : item.dbWouldOver
          ? '当前打开 DB，但第二份放不下'
          : item.dbEligible
            ? '满容量合法，DB 余量足够'
            : '满容量合法；未开 DB 或需切小 base';
      capacity.innerHTML = `<span>${escapeHtml(capacity.dataset.baseCapacity)}</span>`
        + `<span class="mtil-tile-note">${escapeHtml(tileNotes[key])}</span>`
        + `<span class="mtil-occ ${cls}" title="${escapeHtml(`${Model.formatBytes(item.used)} / ${Model.formatBytes(item.full)} · ${title}`)}">`
        + `${percent(item.ratio)} · ${escapeHtml(Model.formatBytes(item.used))}</span>`;
    });
  }

  function percent(value) {
    return `${Math.round((Number(value) || 0) * 100)}%`;
  }

  function renderLogicalReadout() {
    if (!els.logicalReadout) return;
    const { tiling, derived } = state.eval;
    const core = state.currentCore;
    const mIndex = core % derived.mIter;
    const nIndex = Math.floor(core / derived.mIter);
    const m0 = mIndex * tiling.singleCoreM;
    const m1 = Math.min(tiling.M, m0 + tiling.singleCoreM);
    const n0 = nIndex * tiling.singleCoreN;
    const n1 = Math.min(tiling.N, n0 + tiling.singleCoreN);
    // Narrative readout lives here (clean DOM); M/N/K live on the cube axes,
    // so we don't repeat them as chips.
    const lead = `输出分块 ${core + 1}/${derived.coreTiles} → C[${m0}:${m1}, ${n0}:${n1}]`;
    const kAcc = `K 累加 ${state.kIndex + 1}/${derived.kLoop}`;
    els.logicalReadout.innerHTML = `<span class="stat-chip mtil-readout-lead">${escapeHtml(lead)}</span>`
      + `<span class="stat-chip mtil-readout-k">${escapeHtml(kAcc)}</span>`
      + `<span class="stat-chip">base ${tiling.baseM}×${tiling.baseN}×${tiling.baseK}</span>`;
  }

  function bindCanvas() {
    const canvas = els.tilingCanvas;
    if (!canvas) return;
    canvas.addEventListener('wheel', (event) => {
      if (!event.metaKey) return;
      event.preventDefault();
      hideAxisPanel();
      zoomBy(event.deltaY < 0 ? 1.08 : 0.92);
    }, { passive: false });
    canvas.addEventListener('pointerdown', (event) => {
      const hit = axisHitFromEvent(event);
      if (hit) {
        event.preventDefault();
        state.viewport.dragging = false;
        showAxisPanel(hit, event);
        return;
      }
      hideAxisPanel();
      state.viewport.dragging = true;
      state.viewport.lastX = event.clientX;
      state.viewport.lastY = event.clientY;
      canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!state.viewport.dragging) {
        canvas.style.cursor = axisHitFromEvent(event) ? 'help' : 'grab';
        return;
      }
      hideAxisPanel();
      state.viewport.panX += event.clientX - state.viewport.lastX;
      state.viewport.panY += event.clientY - state.viewport.lastY;
      state.viewport.lastX = event.clientX;
      state.viewport.lastY = event.clientY;
      drawLogicalCanvas();
    });
    canvas.addEventListener('pointerup', (event) => {
      state.viewport.dragging = false;
      canvas.releasePointerCapture?.(event.pointerId);
      canvas.style.cursor = axisHitFromEvent(event) ? 'help' : 'grab';
    });
    canvas.addEventListener('click', (event) => {
      const hit = axisHitFromEvent(event);
      if (hit) {
        showAxisPanel(hit, event);
        return;
      }
      hideAxisPanel();
    });
    canvas.addEventListener('dblclick', () => {
      stopPlayback();
      setStep(currentStepIndex() + 1);
    });
    canvas.addEventListener('pointerleave', () => {
      if (!state.viewport.dragging) canvas.style.cursor = 'grab';
    });
  }

  function axisHitFromEvent(event) {
    if (!els.tilingCanvas) return null;
    const rect = els.tilingCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const margin = 10;
    return state.axisHits.find((item) => (
      x >= item.x - margin
        && x <= item.x + item.width + margin
        && y >= item.y - margin
        && y <= item.y + item.height + margin
    )) || null;
  }

  function showAxisPanel(hit, event) {
    if (!els.axisPanel || !els.tilingStage) return;
    els.axisPanel.innerHTML = `<strong>${escapeHtml(hit.title)}</strong><span>${escapeHtml(hit.body)}</span>`;
    const stageRect = els.tilingStage.getBoundingClientRect();
    const targetRect = event.target?.getBoundingClientRect?.();
    const clientX = event.clientX || (targetRect ? targetRect.left + targetRect.width / 2 : stageRect.left + hit.x + hit.width / 2);
    const clientY = event.clientY || (targetRect ? targetRect.top + targetRect.height / 2 : stageRect.top + hit.y + hit.height / 2);
    const panelX = clamp(clientX - stageRect.left + 14, 12, Math.max(12, stageRect.width - 312));
    const panelY = clamp(clientY - stageRect.top + 14, 12, Math.max(12, stageRect.height - 104));
    els.axisPanel.style.transform = `translate(${Math.round(panelX)}px, ${Math.round(panelY)}px)`;
    els.axisPanel.hidden = false;
  }

  function hideAxisPanel() {
    if (els.axisPanel) els.axisPanel.hidden = true;
  }

  function zoomBy(factor) {
    state.viewport.scale = clamp(state.viewport.scale * factor, 0.55, 2.2);
    drawLogicalCanvas();
  }

  function fitCanvas(canvas, cssWidth, cssHeight) {
    const dpr = global.devicePixelRatio || 1;
    const width = Math.floor(cssWidth * dpr);
    const height = Math.floor(cssHeight * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function drawLogicalCanvas() {
    const canvas = els.tilingCanvas;
    if (!canvas || !state.eval) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(480, Math.floor(rect.width || canvas.clientWidth || 760));
    const height = Math.max(260, Math.floor(rect.height || canvas.clientHeight || 360));
    const ctx = fitCanvas(canvas, width, height);
    if (!ctx) {
      if (els.tilingFallback) els.tilingFallback.hidden = false;
      return;
    }
    if (els.tilingFallback) els.tilingFallback.hidden = true;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getCss('--surface-2') || '#1c1c1c';
    ctx.fillRect(0, 0, width, height);
    drawCanvasBackdrop(ctx, width, height);
    drawTilingGrid(ctx, width, height);
  }

  function drawCanvasBackdrop(ctx, width, height) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = getCss('--border-subtle') || 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    const gap = 48;
    for (let x = -gap; x < width + gap; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + height * 0.5, height);
      ctx.stroke();
    }
    ctx.restore();
  }

  const ISO_COS = Math.cos(Math.PI / 6);
  const ISO_SIN = Math.sin(Math.PI / 6);

  function toRgb(color) {
    if (!color) return [255, 255, 255];
    const value = color.trim();
    if (value.startsWith('#')) {
      const hex = value.slice(1);
      const full = hex.length === 3 ? hex.split('').map((x) => x + x).join('') : hex.slice(0, 6);
      const n = Number.parseInt(full, 16);
      if (Number.isFinite(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((s) => Number.parseFloat(s));
      return [p[0] || 0, p[1] || 0, p[2] || 0];
    }
    return [255, 255, 255];
  }

  function alpha(color, opacity) {
    const [r, g, b] = toRgb(color);
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${opacity})`;
  }

  // Solid, depth-sorted faces (top brightest → south darkest). Unlike the old
  // translucent set, only ghost (remaining-K) cells stay see-through so the
  // active column reads instead of piling into a white wash.
  function shade(color, mul, a = 1) {
    const [r, g, b] = toRgb(color);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * mul)));
    return `rgba(${f(r)}, ${f(g)}, ${f(b)}, ${a})`;
  }

  function facesFrom(color, a = 1) {
    return {
      top: shade(color, 1, a),
      east: shade(color, 0.8, a),
      south: shade(color, 0.64, a),
      edge: 'rgba(8, 12, 18, 0.55)',
    };
  }

  function facePalette() {
    const success = getCss('--success') || '#04d793';
    const warning = getCss('--warning') || '#ffaa3b';
    const primary = getCss('--primary-hover') || getCss('--primary') || '#5a92e6';
    const danger = getCss('--danger') || '#ff4b7b';
    return {
      gray: { top: '#474747', east: '#3a3a3a', south: '#2f2f2f', edge: 'rgba(16, 16, 16, 0.62)' },
      slab: facesFrom(primary, 0.5),
      base: facesFrom(warning, 1),
      k: facesFrom(success, 1),
      over: facesFrom(danger, 1),
      ghost: { top: alpha(success, 0.09), east: alpha(success, 0.06), south: alpha(success, 0.045), edge: alpha(success, 0.24) },
    };
  }

  function isoPoint(originX, originY, unit, zUnit, c, r, k) {
    return {
      x: originX + (c - r) * ISO_COS * unit,
      y: originY + (c + r) * ISO_SIN * unit - k * zUnit,
    };
  }

  function drawIsoCube(ctx, originX, originY, unit, zUnit, c, r, k, faces) {
    const gap = 0.12;
    const p = (cc, rr, kk) => isoPoint(originX, originY, unit, zUnit, cc, rr, kk);
    const c0 = c + gap;
    const c1 = c + 1 - gap;
    const r0 = r + gap;
    const r1 = r + 1 - gap;
    const k0 = k + gap;
    const k1 = k + 1 - gap;
    const t0 = p(c0, r0, k1);
    const t1 = p(c1, r0, k1);
    const t2 = p(c1, r1, k1);
    const t3 = p(c0, r1, k1);
    const e3 = p(c1, r0, k0);
    const e2 = p(c1, r1, k0);
    const s3 = p(c0, r1, k0);
    drawQuad(ctx, t1, e3, e2, t2, faces.east, faces.edge);
    drawQuad(ctx, t3, t2, e2, s3, faces.south, faces.edge);
    drawQuad(ctx, t0, t1, t2, t3, faces.top, faces.edge);
  }

  function drawQuad(ctx, p0, p1, p2, p3, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }

  function drawAxisLabelChip(ctx, text, point, align, color) {
    const paddingX = 9;
    const height = 26;
    const width = Math.min(380, Math.max(168, ctx.measureText(text).width + paddingX * 2));
    const x = align === 'right' ? point.x - width : align === 'left' ? point.x : point.x - width / 2;
    const y = point.y - height / 2;
    ctx.save();
    ctx.beginPath();
    roundedRectPath(ctx, x, y, width, height, 8);
    ctx.fillStyle = alpha(getCss('--surface-1') || '#161616', 0.88);
    ctx.fill();
    ctx.strokeStyle = getCss('--border-default') || 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, align === 'right' ? x + width - paddingX : align === 'left' ? x + paddingX : x + width / 2, point.y);
    ctx.restore();
    return { x, y, width, height };
  }

  function drawTilingGrid(ctx, width, height) {
    const { tiling, derived, constraints } = state.eval;
    const totalM = Math.max(1, derived.logicalTilesM);
    const totalN = Math.max(1, derived.logicalTilesN);
    const totalK = Math.max(1, derived.kLoop);
    const rows = Math.min(8, totalM);
    const cols = Math.min(12, totalN);
    const depth = Math.min(5, totalK);
    const scale = state.viewport.scale;
    const unit = Math.max(14, Math.min((width - 132) / ((cols + rows) * ISO_COS), (height - 100) / ((cols + rows) * ISO_SIN + depth * 10))) * scale;
    const zUnit = unit * 0.78;
    const ox = width / 2 - ((cols - rows) / 2) * ISO_COS * unit + state.viewport.panX;
    const oy = height / 2 - (((cols + rows) * ISO_SIN * unit - depth * zUnit) / 2) + state.viewport.panY + 12;

    const core = state.currentCore;
    const mCore = core % derived.mIter;
    const nCore = Math.floor(core / derived.mIter);
    const slabRowsStart = Math.floor((mCore * derived.baseMLoop / totalM) * rows);
    const slabRowsEnd = Math.max(slabRowsStart + 1, Math.ceil(((mCore + 1) * derived.baseMLoop / totalM) * rows));
    const slabColsStart = Math.floor((nCore * derived.baseNLoop / totalN) * cols);
    const slabColsEnd = Math.max(slabColsStart + 1, Math.ceil(((nCore + 1) * derived.baseNLoop / totalN) * cols));
    const kFill = Math.max(1, Math.ceil(((state.kIndex + 1) / totalK) * depth));
    const hasIllegal = !constraints.legal;

    // Two passes: solid gray "other tiles" first (depth-sorted), then the active
    // single-core slab on top — accumulated K filled, remaining K ghosted.
    const P = facePalette();
    const grayCells = [];
    const activeCells = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const inSlab = r >= slabRowsStart && r < slabRowsEnd && c >= slabColsStart && c < slabColsEnd;
        const isBase = r === slabRowsStart && c === slabColsStart;
        for (let k = 0; k < depth; k += 1) {
          (inSlab ? activeCells : grayCells).push({ c, r, k, isBase });
        }
      }
    }
    const byDepth = (a, b) => (a.c + a.r + a.k) - (b.c + b.r + b.k);
    grayCells.sort(byDepth);
    activeCells.sort(byDepth);
    for (const cell of grayCells) {
      drawIsoCube(ctx, ox, oy, unit, zUnit, cell.c, cell.r, cell.k, P.gray);
    }
    for (const cell of activeCells) {
      let faces;
      if (hasIllegal && cell.isBase) faces = P.over;
      else if (cell.k < kFill) faces = cell.isBase ? P.base : P.k;
      else faces = P.ghost;
      drawIsoCube(ctx, ox, oy, unit, zUnit, cell.c, cell.r, cell.k, faces);
    }

    drawAxisLabels(ctx, ox, oy, unit, zUnit, rows, cols, depth, tiling, derived, width, height);
    drawCanvasLegend(ctx, width, tiling, derived, constraints);
  }

  function drawAxisLabels(ctx, ox, oy, unit, zUnit, rows, cols, depth, tiling, derived, width, height) {
    const muted = getCss('--foreground-muted') || 'rgba(255,255,255,0.44)';
    const fg = getCss('--foreground-secondary') || 'rgba(255,255,255,0.66)';
    const p = (c, r, k) => isoPoint(ox, oy, unit, zUnit, c, r, k);
    const hits = [];
    const addAxisHit = (axis, box) => {
      const descriptions = {
        M: {
          title: 'M 轴：输出行',
          body: `M=${tiling.M}，按 baseM=${tiling.baseM} 切成 ${derived.logicalTilesM} 个输出行 tile。`,
        },
        N: {
          title: 'N 轴：输出列',
          body: `N=${tiling.N}，按 baseN=${tiling.baseN} 切成 ${derived.logicalTilesN} 个输出列 tile。`,
        },
        K: {
          title: 'K 轴：归约累加',
          body: `K=${tiling.K}，按 baseK=${tiling.baseK} 做 ${derived.kLoop} 次 reduction，逐步累加到 L0C。`,
        },
      };
      hits.push({ axis, ...box, ...descriptions[axis] });
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = muted;
    ctx.font = '600 10px ui-monospace, monospace';
    for (let c = 0; c <= cols; c += 1) {
      const point = p(c, rows + 0.5, 0);
      ctx.fillText(String(Math.round(c * tiling.N / cols)), point.x, point.y + 2);
    }
    ctx.font = '700 12px Inter, sans-serif';
    const nLabel = `N = ${tiling.N} 输出列 (${derived.logicalTilesN} base tiles)`;
    const nBox = drawAxisLabelChip(ctx, nLabel, { x: 24, y: height - 28 }, 'left', fg);
    addAxisHit('N', nBox);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = muted;
    ctx.font = '600 10px ui-monospace, monospace';
    for (let r = 0; r <= rows; r += 1) {
      const point = p(cols + 0.5, r, 0);
      ctx.fillText(String(Math.round(r * tiling.M / rows)), point.x + 2, point.y + 4);
    }
    ctx.font = '700 12px Inter, sans-serif';
    const mLabel = `M = ${tiling.M} 输出行 (${derived.logicalTilesM} base tiles)`;
    const mBox = drawAxisLabelChip(ctx, mLabel, { x: width - 24, y: height - 28 }, 'right', fg);
    addAxisHit('M', mBox);

    ctx.fillStyle = getCss('--success') || fg;
    ctx.font = '700 12px Inter, sans-serif';
    const kLabel = `K = ${tiling.K} · reduction ${derived.kLoop} loop ↑`;
    const kBox = drawAxisLabelChip(ctx, kLabel, { x: width / 2, y: 44 }, 'center', getCss('--success') || fg);
    addAxisHit('K', kBox);
    state.axisHits = hits;
    syncAxisHotspots();
  }

  function syncAxisHotspots() {
    if (!els.axisHotspots) return;
    const margin = 10;
    els.axisHotspots.innerHTML = state.axisHits.map((hit) => `
      <button
        class="mtil-axis-hotspot"
        type="button"
        data-axis-hotspot="${escapeHtml(hit.axis)}"
        aria-label="${escapeHtml(hit.title)}"
        title="${escapeHtml(hit.title)}"
        style="left:${Math.round(hit.x - margin)}px;top:${Math.round(hit.y - margin)}px;width:${Math.round(hit.width + margin * 2)}px;height:${Math.round(hit.height + margin * 2)}px"
      ></button>
    `).join('');
  }

  // The narrative (输出分块 / 输出区 / K 累加) lives in the DOM readout below the
  // canvas; here we only keep the spatial constraint badge so it doesn't repeat.
  function drawCanvasLegend(ctx, width, tiling, derived, constraints) {
    const fg = getCss('--foreground') || '#fff';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = constraints.legal ? (getCss('--success') || fg) : (getCss('--danger') || fg);
    ctx.font = '700 12px ui-monospace, monospace';
    ctx.fillText(constraints.legal ? 'constraint legal' : 'constraint illegal', width - 18, 18);
  }

  // ── Tile-step playback (floating-playback-control pattern) ──────────────
  // Schedule = every output tile × every K loop step. Stepping/playing
  // drives state.currentCore + state.kIndex, so the cube + buffer occupancy
  // animate through the tiling instead of reading as one static picture.
  function derivedSafe() {
    return state.eval?.derived || { coreTiles: 1, kLoop: 1 };
  }

  function totalSteps() {
    const d = derivedSafe();
    return Math.max(1, d.coreTiles * d.kLoop);
  }

  function currentStepIndex() {
    const d = derivedSafe();
    return clamp(state.currentCore, 0, d.coreTiles - 1) * d.kLoop + clamp(state.kIndex, 0, d.kLoop - 1);
  }

  function stepLabel(step) {
    const d = derivedSafe();
    const total = totalSteps();
    const idx = ((Math.round(step) % total) + total) % total;
    const core = Math.floor(idx / d.kLoop);
    const k = idx % d.kLoop;
    return `输出块 ${core + 1}/${d.coreTiles} · K ${k + 1}/${d.kLoop}`;
  }

  function setStep(step) {
    const d = derivedSafe();
    const total = totalSteps();
    const idx = ((Math.round(step) % total) + total) % total;
    const prevCore = state.currentCore;
    state.currentCore = Math.floor(idx / d.kLoop);
    state.kIndex = idx % d.kLoop;
    render();
    pulseLoad(state.currentCore !== prevCore);
  }

  // Each K step reloads a fresh A/B slice into L0A/L0B (MTE1) — flash them so the
  // load→accumulate pipeline reads. L1 only reloads when the core switches.
  function pulseLoad(coreChanged) {
    if (!els.bufferStage) return;
    const glow = getCss('--warning') || '#ffcf59';
    const ring = (node, lift) => node?.animate?.([
      { boxShadow: `0 0 0 0 ${alpha(glow, 0)}` },
      { boxShadow: `0 0 0 ${lift}px ${alpha(glow, 0.65)}` },
      { boxShadow: `0 0 0 0 ${alpha(glow, 0)}` },
    ], { duration: 340, easing: 'ease-out' });
    ['L0A', 'L0B'].forEach((key) => ring(qs(`[data-buffer-key="${key}"]`, els.bufferStage), 4));
    if (coreChanged) ring(qs('[data-buffer-key="L1"]', els.bufferStage), 5);
    qsa('.pto-aic-core__transport-pill', els.bufferStage).forEach((pill) => {
      pill.animate?.([{ opacity: 0.4 }, { opacity: 1 }, { opacity: 0.55 }], { duration: 340, easing: 'ease-out' });
    });
  }

  function initPlayback() {
    const helper = global.PtoFloatingPlaybackControl;
    if (!helper?.createControl || !els.playbackMount) return;
    els.playbackMount.innerHTML = '';
    const control = helper.createControl({
      ids: PLAYBACK_IDS,
      className: 'pto-floating-playback--mtil',
      showTimeline: true,
    });
    els.playbackMount.appendChild(control);
    state.playback = helper.init({ root: control, isPlaying: () => state.playing });
    helper.initScrubberHover({
      root: control,
      getTotalSteps: () => totalSteps(),
      getLabelForStep: (step) => stepLabel(step),
    });
    qs(`#${PLAYBACK_IDS.stepBack}`)?.addEventListener('click', () => { stopPlayback(); setStep(currentStepIndex() - 1); });
    qs(`#${PLAYBACK_IDS.stepForward}`)?.addEventListener('click', () => { stopPlayback(); setStep(currentStepIndex() + 1); });
    qs(`#${PLAYBACK_IDS.replay}`)?.addEventListener('click', () => { stopPlayback(); setStep(0); });
    qs(`#${PLAYBACK_IDS.play}`)?.addEventListener('click', togglePlay);
    qs(`#${PLAYBACK_IDS.scrubber}`)?.addEventListener('input', (event) => {
      stopPlayback();
      setStep(Number(event.target.value) || 0);
    });
  }

  function togglePlay() {
    state.playing = !state.playing;
    if (state.playing) {
      state.timer = global.setInterval(() => setStep(currentStepIndex() + 1), 360);
    } else if (state.timer) {
      global.clearInterval(state.timer);
      state.timer = null;
    }
    syncPlayback();
  }

  function stopPlayback() {
    state.playing = false;
    if (state.timer) {
      global.clearInterval(state.timer);
      state.timer = null;
    }
    syncPlayback();
  }

  function syncPlayback() {
    const helper = global.PtoFloatingPlaybackControl;
    const total = totalSteps();
    const cur = currentStepIndex();
    const scrubber = qs(`#${PLAYBACK_IDS.scrubber}`);
    const label = qs(`#${PLAYBACK_IDS.scrubberLabel}`);
    const opname = qs(`#${PLAYBACK_IDS.scrubberOpname}`);
    const play = qs(`#${PLAYBACK_IDS.play}`);
    if (scrubber) {
      scrubber.max = String(Math.max(0, total - 1));
      scrubber.value = String(cur);
    }
    if (label) label.textContent = `${cur + 1} / ${total}`;
    if (opname) opname.textContent = stepLabel(cur);
    if (play && helper?.iconLabel) {
      play.innerHTML = state.playing ? helper.iconLabel('pause', 'Pause') : helper.iconLabel('play', 'Play');
    }
    state.playback?.sync?.({ playing: state.playing });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window);

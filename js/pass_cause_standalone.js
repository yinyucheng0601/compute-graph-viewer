/**
 * pass_cause_standalone.js - Minimal Pass Cause Explainer page.
 */
(function () {
  const state = {
    navIndex: null,
    pairs: [],
    pairResults: new Map(),
    activeResult: null,
    currentGraph: null,
    currentLayout: null,
    currentLoadInfo: null,
    localFileRefs: new Map(),
    tx: 0,
    ty: 0,
    scale: 1,
    currentSide: 'after',
    colorMode: 'semantic',
    panning: false,
    panStart: null,
    renderCache: null,
  };

  const AUTOSTART = [
    { passName: 'RemoveRedundantOp', pathId: 'PATH0_6' },
    { passName: 'MergeViewAssemble', pathId: 'PATH0_6' },
    { passName: 'RemoveRedundantReshape', pathId: 'PATH0_6' },
    { passName: 'DuplicateOp', pathId: 'PATH0_6' },
    { passName: 'CommonOperationEliminate', pathId: 'PATH0_6' },
    { passName: 'SplitReshape', pathId: 'PATH0_6' },
  ];

  const els = {
    openBtn: document.getElementById('openPassFolderBtn'),
    dirInput: document.getElementById('passFolderInput'),
    passFilterSelect: document.getElementById('passFilterSelect'),
    pairSelect: document.getElementById('pairSelect'),
    coverage: document.getElementById('pairCoverageLabel'),
    status: document.getElementById('explainStatus'),
    current: document.getElementById('currentPairLabel'),
    viewport: document.getElementById('explainViewport'),
    graphRoot: document.getElementById('explainGraphRoot'),
    nodesLayer: document.getElementById('nodesLayer'),
    edgesSvg: document.getElementById('edgesSvg'),
    emptyState: document.getElementById('explainEmptyState'),
    ghostTray: document.getElementById('passCauseGhostTray'),
    fitBtn: document.getElementById('fitExplainBtn'),
    beforeBtn: document.getElementById('showBeforeBtn'),
    afterBtn: document.getElementById('showAfterBtn'),
    colorModeBtn: document.getElementById('colorModeBtn'),
    colorModeLabel: document.getElementById('colorModeLabel'),
    colorModeMenu: document.getElementById('colorModeMenu'),
  };

  function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/');
  }

  function normalizePassName(value) {
    return window.PtoPassCausePairs?.normalizePassName?.(value) || String(value || '').replace(/\d+$/g, '');
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text || '';
  }

  function sideForRef(fileRef) {
    const pair = state.activeResult?.pair;
    if (!pair || !fileRef) return state.currentSide;
    if (fileRef === pair.beforeRef?.ref) return 'before';
    if (fileRef === pair.afterRef?.ref) return 'after';
    return state.currentSide;
  }

  function graphRefName(ref) {
    return String(ref || '').replace(/^local::/, '').split('/').pop();
  }

  function readJsonRef(fileRef) {
    const localFile = state.localFileRefs.get(fileRef);
    if (localFile) return localFile.text().then(text => JSON.parse(text));
    return fetch(fileRef).then(response => {
      if (!response.ok) throw new Error(`读取 ${fileRef} 失败：${response.status}`);
      return response.json();
    });
  }

  function edgeId(edge) {
    return `${edge.source}->${edge.target}`;
  }

  function semanticColorMap(graph) {
    if (window.PtoPassCauseSemantic?.buildNodeColorMap) {
      return window.PtoPassCauseSemantic.buildNodeColorMap(graph);
    }
    if (typeof buildColorMap !== 'function' || typeof getSemanticKey !== 'function') return null;
    const keyMap = buildColorMap((graph.nodes || []).map(node => getSemanticKey(node)));
    const nodeMap = new Map();
    (graph.nodes || []).forEach(node => nodeMap.set(node.id, keyMap.get(getSemanticKey(node))));
    return nodeMap;
  }

  function buildNodeColorMap(graph) {
    const mode = state.colorMode;
    if (!graph || mode === 'none') return null;
    if (mode === 'semantic') return semanticColorMap(graph);
    if (mode === 'latency') {
      const map = new Map();
      (graph.nodes || []).forEach(node => {
        const color = node.type === 'op' && typeof latencyToColor === 'function'
          ? latencyToColor(node.data?.latency)
          : null;
        if (color) map.set(node.id, color);
      });
      return map;
    }
    if (mode === 'subgraph') {
      const keys = (graph.nodes || [])
        .filter(node => node.type === 'op' && node.data?.subgraphId != null)
        .map(node => `SG:${node.data.subgraphId}`);
      const palette = typeof buildColorMap === 'function' ? buildColorMap(keys) : new Map();
      const map = new Map();
      (graph.nodes || []).forEach(node => {
        if (node.type === 'op' && node.data?.subgraphId != null) {
          map.set(node.id, palette.get(`SG:${node.data.subgraphId}`));
        }
      });
      return map;
    }
    return null;
  }

  function afterChangedSets(result) {
    const changedNodes = new Set();
    const changedEdges = new Set();
    const diff = result?.diff;
    if (!diff) return { changedNodes, changedEdges };

    (diff.nodes.added || []).forEach(node => changedNodes.add(node.id));
    (diff.nodes.modified || []).forEach(item => changedNodes.add(item.id || item.after?.id));
    (diff.edges.added || []).forEach(edge => {
      changedEdges.add(edgeId(edge));
      changedNodes.add(edge.source);
      changedNodes.add(edge.target);
    });
    (diff.rewires || []).forEach(item => {
      if (item.afterInputTensorId) changedNodes.add(item.afterInputTensorId);
      if (item.consumerOpId) changedNodes.add(item.consumerOpId);
      (item.edgeIds || []).forEach(id => changedEdges.add(id));
    });

    return { changedNodes, changedEdges };
  }

  function applyDiffDimming(side) {
    els.nodesLayer?.querySelectorAll('.cause-node-dim-unchanged, .cause-diff-emphasis')
      .forEach(el => el.classList.remove('cause-node-dim-unchanged', 'cause-diff-emphasis'));
    els.edgesSvg?.querySelectorAll('.cause-edge-dim-unchanged, .cause-diff-emphasis')
      .forEach(el => el.classList.remove('cause-edge-dim-unchanged', 'cause-diff-emphasis'));

    if (side !== 'after' || !state.activeResult?.diff) return;
    const { changedNodes, changedEdges } = afterChangedSets(state.activeResult);

    els.nodesLayer?.querySelectorAll('.node-card[data-node-id]').forEach(el => {
      if (changedNodes.has(el.dataset.nodeId)) el.classList.add('cause-diff-emphasis');
      else el.classList.add('cause-node-dim-unchanged');
    });
    els.edgesSvg?.querySelectorAll('.edge[data-source][data-target]').forEach(el => {
      const id = `${el.dataset.source}->${el.dataset.target}`;
      if (changedEdges.has(id)) el.classList.add('cause-diff-emphasis');
      else el.classList.add('cause-edge-dim-unchanged');
    });
  }

  function displayGraph(graph, loadInfo = {}) {
    window.PtoPassCauseSemantic?.annotateGraph?.(graph);
    state.currentGraph = graph;
    state.currentLoadInfo = loadInfo;
    state.currentSide = loadInfo.side || sideForRef(loadInfo.fileRef) || state.currentSide;
    updateSideButtons(state.currentSide);
    if (els.emptyState) els.emptyState.hidden = true;
    state.currentLayout = computeLayout(graph, { nodeWidth: 225 });
    state.renderCache = renderGraph(
      graph,
      state.currentLayout,
      els.nodesLayer,
      els.edgesSvg,
      () => {},
      buildNodeColorMap(graph),
      state.colorMode,
      { delegateEvents: true }
    );
    applyDiffDimming(state.currentSide);
    fitGraph();
    window.dispatchEvent(new CustomEvent('pto-pass-ir:graph-rendered', {
      detail: { side: state.currentSide, loadInfo: state.currentLoadInfo },
    }));
    requestAnimationFrame(() => window.PtoPassCausePlayback?.applyHighlight?.());
  }

  function displayGraphRef(fileRef) {
    return readJsonRef(fileRef).then(data => {
      const graph = parseGraph(data);
      displayGraph(graph, {
        fileRef,
        fileName: graphRefName(fileRef),
        side: sideForRef(fileRef),
        loadedAt: Date.now(),
      });
      return graph;
    });
  }

  function focusNodeById(nodeId) {
    if (!nodeId || !state.currentGraph || !state.currentLayout) return false;
    const pos = state.currentLayout.positions.get(nodeId);
    if (!pos) return false;
    state.scale = Math.max(0.12, state.scale);
    state.tx = els.viewport.clientWidth / 2 - (pos.x + pos.w / 2) * state.scale;
    state.ty = els.viewport.clientHeight / 2 - (pos.y + pos.h / 2) * state.scale;
    applyTransform(true);
    return true;
  }

  window.PtoPassIrState = {
    readJsonRef,
    loadGraphRef: displayGraphRef,
    getCurrentGraph: () => state.currentGraph,
    getCurrentLoadInfo: () => state.currentLoadInfo ? { ...state.currentLoadInfo } : null,
    getCurrentSide: () => state.currentSide,
    focusNodeById,
    showStepGhost,
  };

  function applyTransform(animate = false) {
    if (!els.graphRoot) return;
    els.graphRoot.style.transition = animate ? 'transform 180ms var(--easing-default)' : '';
    els.graphRoot.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    if (animate) setTimeout(() => { els.graphRoot.style.transition = ''; }, 200);
  }

  function fitGraph() {
    if (!state.currentLayout || !els.viewport) return;
    const w = Math.max(1, state.currentLayout.canvasW || 1);
    const h = Math.max(1, state.currentLayout.canvasH || 1);
    const vw = Math.max(1, els.viewport.clientWidth);
    const vh = Math.max(1, els.viewport.clientHeight);
    state.scale = Math.max(0.08, Math.min(1.1, Math.min(vw / w, vh / h) * 0.86));
    state.tx = (vw - w * state.scale) / 2;
    state.ty = (vh - h * state.scale) / 2;
    applyTransform(false);
  }

  function collectPairs(navIndex) {
    return window.PtoPassCausePairs.buildPairsFromNavIndex(navIndex);
  }

  function readyPairs() {
    return (state.pairs || []).filter(pair => pair.status === 'ready');
  }

  function filteredReadyPairs() {
    const passName = els.passFilterSelect?.value || 'all';
    const list = readyPairs();
    if (!passName || passName === 'all') return list;
    return list.filter(pair => pair.passName === passName);
  }

  function coverageStats() {
    const all = state.pairs || [];
    const ready = all.filter(pair => pair.status === 'ready');
    return {
      schemaPasses: window.PtoPassCauseSourceSchema?.PASS_SOURCE_SCHEMA?.length || 0,
      dumpPasses: new Set(all.map(pair => pair.passName)).size,
      readyPasses: new Set(ready.map(pair => pair.passName)).size,
      totalPairs: all.length,
      readyPairs: ready.length,
      missingPairs: all.length - ready.length,
    };
  }

  function updateCoverageLabel() {
    if (!els.coverage) return;
    const stats = coverageStats();
    if (!stats.totalPairs) {
      els.coverage.textContent = '未加载';
      els.coverage.title = '';
      return;
    }
    const text = `源码 ${stats.schemaPasses} · dump ${stats.dumpPasses} · ready ${stats.readyPasses} pass / ${stats.readyPairs} pair`;
    els.coverage.textContent = text;
    els.coverage.title = `已解析 ${stats.totalPairs} 个 pair，ready ${stats.readyPairs}，缺失 ${stats.missingPairs}`;
  }

  function loopLabelForPath(pathId) {
    if (pathId === 'PATH0_4') return 'RESHAPE';
    const map = { PATH0_6: 32, PATH0_8: 16, PATH0_10: 8, PATH0_12: 4, PATH0_14: 2, PATH0_16: 1 };
    return map[pathId] ? `MAIN x${map[pathId]}` : pathId;
  }

  function pairLabel(pair) {
    const target = pair.snapshotKey === 'main' ? loopLabelForPath(pair.pathId) : `${loopLabelForPath(pair.pathId)} ${pair.snapshotKey}`;
    return `P${String(pair.passIndex).padStart(2, '0')} ${pair.passName} - ${target}`;
  }

  function populatePassFilter() {
    if (!els.passFilterSelect) return;
    const current = els.passFilterSelect.value || 'all';
    els.passFilterSelect.innerHTML = '';

    const stats = coverageStats();
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `全部 Pass (${stats.readyPasses}/${stats.dumpPasses})`;
    els.passFilterSelect.appendChild(allOpt);

    const readyByPass = new Map();
    readyPairs().forEach(pair => {
      if (!readyByPass.has(pair.passName)) readyByPass.set(pair.passName, []);
      readyByPass.get(pair.passName).push(pair);
    });

    const passRows = [...new Map((state.pairs || []).map(pair => [pair.passName, pair])).values()]
      .sort((a, b) => {
        const ai = Number.isFinite(a.passIndex) ? a.passIndex : 9999;
        const bi = Number.isFinite(b.passIndex) ? b.passIndex : 9999;
        if (ai !== bi) return ai - bi;
        return String(a.passName).localeCompare(String(b.passName));
      });

    passRows.forEach(pair => {
      const opt = document.createElement('option');
      const readyCount = readyByPass.get(pair.passName)?.length || 0;
      const schema = pair.sourceSchema || window.PtoPassCauseSourceSchema?.getPassSchema?.(pair.passName);
      const tier = window.PtoPassCauseSourceSchema?.coverageLabel?.(schema?.coverageTier || pair.coverageTier) || '未知';
      opt.value = pair.passName;
      opt.textContent = `P${String(pair.passIndex).padStart(2, '0')} ${pair.passName} (${readyCount}) · ${tier}`;
      opt.disabled = readyCount === 0;
      els.passFilterSelect.appendChild(opt);
    });

    const hasCurrent = [...els.passFilterSelect.options].some(opt => opt.value === current && !opt.disabled);
    els.passFilterSelect.value = hasCurrent ? current : 'all';
    els.passFilterSelect.disabled = state.pairs.length === 0;
  }

  function populatePairSelect() {
    if (!els.pairSelect) return;
    els.pairSelect.innerHTML = '';
    const pairs = filteredReadyPairs();
    pairs.forEach(pair => {
      const option = document.createElement('option');
      option.value = pair.id;
      option.textContent = pairLabel(pair);
      els.pairSelect.appendChild(option);
    });
    els.pairSelect.disabled = pairs.length === 0;
    updateCoverageLabel();
  }

  function structuralScore(result) {
    const stats = result?.diff?.stats;
    if (!stats) return 0;
    return Math.abs(stats.netNodes || 0) * 3
      + Math.abs(stats.netEdges || 0)
      + stats.addedNodes
      + stats.removedNodes
      + stats.modifiedNodes
      + stats.addedEdges
      + stats.removedEdges
      + stats.rewires * 2
      + (result?.explanations || []).length;
  }

  function preferredCandidates() {
    const candidates = [];
    for (const preferred of AUTOSTART) {
      const match = readyPairs().find(pair => (
        normalizePassName(pair.passName) === preferred.passName
        && pair.pathId === preferred.pathId
        && pair.snapshotKey === 'main'
      ));
      if (match) candidates.push(match);
    }
    readyPairs().forEach(pair => {
      if (!candidates.some(item => item.id === pair.id)) candidates.push(pair);
    });
    return candidates;
  }

  async function explainPair(pair) {
    if (state.pairResults.has(pair.id)) return state.pairResults.get(pair.id);
    const result = await window.PtoPassCauseExplainer.explainPair(pair);
    state.pairResults.set(pair.id, result);
    return result;
  }

  async function findAutoStartResult() {
    const candidates = preferredCandidates();
    let best = null;
    for (const pair of candidates) {
      setStatus(`扫描结构变化：${pairLabel(pair)}`);
      const result = await explainPair(pair);
      if (structuralScore(result) > 0 && (result.explanations || []).length > 0) {
        if (AUTOSTART.some(item => item.passName === normalizePassName(pair.passName) && item.pathId === pair.pathId)) return result;
        if (!best || structuralScore(result) > structuralScore(best)) best = result;
      }
    }
    if (best) return best;
    if (!candidates.length) return null;
    return explainPair(candidates[0]);
  }

  function updateSideButtons(side) {
    state.currentSide = side;
    els.beforeBtn?.classList.toggle('is-selected', side === 'before');
    els.afterBtn?.classList.toggle('is-selected', side === 'after');
  }

  function initialSideForResult(result) {
    const stats = result?.diff?.stats;
    if (!stats) return 'after';
    if ((stats.removedNodes || 0) > (stats.addedNodes || 0)) return 'before';
    return 'after';
  }

  function graphForSide(result, side) {
    return side === 'before' ? result.beforeGraph : result.afterGraph;
  }

  function refForSide(pair, side) {
    return side === 'before' ? pair.beforeRef : pair.afterRef;
  }

  function showStepGhost(step, side = state.currentSide) {
    if (!els.ghostTray) return;
    if (!step || !step.counts || (side !== 'after' && side !== 'before')) {
      els.ghostTray.hidden = true;
      els.ghostTray.innerHTML = '';
      return;
    }
    const c = step.counts || {};
    const chips = [];
    if (c.removedOps) chips.push(`op -${c.removedOps}`);
    if (c.removedTensors) chips.push(`tensor -${c.removedTensors}`);
    if (c.removedEdges) chips.push(`edge -${c.removedEdges}`);
    if (c.rewiredEdges) chips.push(`重连 ${c.rewiredEdges}`);
    if (c.addedOps) chips.push(`op +${c.addedOps}`);
    if (c.addedTensors) chips.push(`tensor +${c.addedTensors}`);
    if (c.fieldChanges) chips.push(`字段 ${c.fieldChanges}`);
    if (!chips.length) {
      els.ghostTray.hidden = true;
      return;
    }
    const title = side === 'after' && (c.removedOps || c.removedTensors)
      ? 'After 中隐藏了 Before 被删除对象'
      : (side === 'before' ? 'Before 中将被改写的对象' : '当前步骤变化');
    els.ghostTray.innerHTML = `
      <div class="pass-cause-ghost-title">${title}</div>
      <div class="pass-cause-ghost-chips">
        ${chips.map(text => `<span class="stat-chip">${text}</span>`).join('')}
      </div>
    `;
    els.ghostTray.hidden = false;
  }

  function setActiveResult(result, { autoplay = false } = {}) {
    state.activeResult = result;
    const pair = result?.pair;
    if (!pair) return;
    if (els.current) els.current.textContent = pairLabel(pair);
    if (els.passFilterSelect && els.passFilterSelect.value !== 'all') {
      els.passFilterSelect.value = pair.passName;
      populatePairSelect();
    }
    if (els.pairSelect) {
      const hasPairOption = [...els.pairSelect.options].some(opt => opt.value === pair.id);
      if (!hasPairOption && els.passFilterSelect) {
        els.passFilterSelect.value = 'all';
        populatePairSelect();
      }
      els.pairSelect.value = pair.id;
    }
    document.body.classList.remove('is-explain-panel-closed');
    setStatus(structuralScore(result) > 0 ? '已就绪' : '这组 Before/After 没有结构变化');
    const initialSide = initialSideForResult(result);
    const initialRef = refForSide(pair, initialSide);
    updateSideButtons(initialSide);
    displayGraph(graphForSide(result, initialSide), {
      fileRef: initialRef?.ref || null,
      fileName: initialRef?.fileName || '',
      side: initialSide,
      loadedAt: Date.now(),
    });
    showStepGhost((result.explanations || [])[0], initialSide);
    window.PtoPassCausePanel?.renderResult?.(result);
    if (autoplay) setTimeout(() => window.PtoPassCausePlayback?.play?.(), 350);
  }

  async function choosePair(pairId, options = {}) {
    const pair = readyPairs().find(item => item.id === pairId);
    if (!pair) return;
    setStatus(`解释中：${pairLabel(pair)}`);
    const result = await explainPair(pair);
    setActiveResult(result, options);
  }

  function mapEntries(entries, sourceLabel) {
    state.localFileRefs.clear();
    const builderEntries = [];
    for (const entry of entries || []) {
      const rel = normalizePath(entry.relativePath || '');
      if (!rel.toLowerCase().endsWith('.json')) continue;
      const ref = `local::${rel}`;
      state.localFileRefs.set(ref, entry.file);
      builderEntries.push({ relativePath: rel, ref });
    }
    state.navIndex = window.buildNavIndexFromFileEntries(builderEntries, { basePath: sourceLabel || 'local' });
    state.pairResults.clear();
    state.pairs = collectPairs(state.navIndex);
    populatePassFilter();
    populatePairSelect();
    updateCoverageLabel();
  }

  async function loadEntries(entries, sourceLabel) {
    setStatus('正在建立 Pass 索引');
    mapEntries(entries, sourceLabel);
    if (!readyPairs().length) {
      setStatus('没有找到可用的 Before/After 配对');
      return;
    }
    const stats = coverageStats();
    setStatus(`已解析 ${stats.dumpPasses} 个 Pass，正在自动选择有结构变化的配对`);
    const result = await findAutoStartResult();
    if (result) setActiveResult(result, { autoplay: true });
  }

  function colorModeLabel(mode) {
    if (mode === 'semantic') return 'Semantic';
    if (mode === 'latency') return 'Latency';
    if (mode === 'subgraph') return 'Subgraph';
    return 'None';
  }

  function setColorMode(mode) {
    state.colorMode = mode || 'semantic';
    if (els.colorModeLabel) els.colorModeLabel.textContent = colorModeLabel(state.colorMode);
    els.colorModeMenu?.querySelectorAll('[data-color-mode]').forEach(btn => {
      btn.classList.toggle('is-selected', btn.dataset.colorMode === state.colorMode);
    });
    if (state.currentGraph) displayGraph(state.currentGraph, state.currentLoadInfo || {});
  }

  function positionColorModeMenu() {
    if (!els.colorModeBtn || !els.colorModeMenu) return;
    const rect = els.colorModeBtn.getBoundingClientRect();
    const menuWidth = 188;
    const margin = 12;
    const left = Math.max(margin, Math.min(window.innerWidth - menuWidth - margin, rect.right - menuWidth));
    const top = Math.max(margin, rect.bottom + 8);
    els.colorModeMenu.style.left = `${left}px`;
    els.colorModeMenu.style.top = `${top}px`;
  }

  function setColorModeMenuOpen(open) {
    if (!els.colorModeMenu) return;
    els.colorModeMenu.hidden = !open;
    els.colorModeBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) positionColorModeMenu();
  }

  async function collectHandleEntries(handle, prefix = '') {
    const out = [];
    for await (const [name, child] of handle.entries()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (child.kind === 'directory') {
        out.push(...await collectHandleEntries(child, rel));
      } else if (name.toLowerCase().endsWith('.json')) {
        out.push({ relativePath: rel, file: await child.getFile() });
      }
    }
    return out;
  }

  async function openFolder() {
    if (window.showDirectoryPicker) {
      const handle = await window.showDirectoryPicker({ id: 'pto-pass-explain-folder' });
      const entries = await collectHandleEntries(handle);
      await loadEntries(entries, handle.name || 'local');
      return;
    }
    els.dirInput?.click();
  }

  function bindViewport() {
    if (!els.viewport) return;
    els.viewport.addEventListener('mousedown', event => {
      state.panning = true;
      state.panStart = { x: event.clientX - state.tx, y: event.clientY - state.ty };
      els.viewport.classList.add('is-panning');
    });
    window.addEventListener('mousemove', event => {
      if (!state.panning || !state.panStart) return;
      state.tx = event.clientX - state.panStart.x;
      state.ty = event.clientY - state.panStart.y;
      applyTransform(false);
    });
    window.addEventListener('mouseup', () => {
      state.panning = false;
      state.panStart = null;
      els.viewport.classList.remove('is-panning');
    });
    els.viewport.addEventListener('wheel', event => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? 0.9 : 1.1;
      const nextScale = Math.max(0.05, Math.min(3, state.scale * delta));
      const rect = els.viewport.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      state.tx = mx - (mx - state.tx) * (nextScale / state.scale);
      state.ty = my - (my - state.ty) * (nextScale / state.scale);
      state.scale = nextScale;
      applyTransform(false);
    }, { passive: false });
  }

  function bindEvents() {
    const handleOpenClick = () => {
      openFolder().catch(error => {
        if (error?.name !== 'AbortError') {
          console.error(error);
          setStatus(error?.message || '打开文件夹失败');
        }
      });
    };
    els.openBtn?.addEventListener('click', handleOpenClick);
    document.querySelectorAll('[data-open-pass-folder]').forEach(btn => {
      if (btn === els.openBtn) return;
      btn.addEventListener('click', handleOpenClick);
    });
    els.dirInput?.addEventListener('change', event => {
      const files = [...(event.target.files || [])].filter(file => file.name.toLowerCase().endsWith('.json'));
      const entries = files.map(file => ({
        relativePath: normalizePath(file.webkitRelativePath || file.name),
        file,
      }));
      const folderName = files[0]?.webkitRelativePath?.split('/')?.[0] || 'local-folder';
      loadEntries(entries, folderName).catch(error => {
        console.error(error);
        setStatus(error?.message || '加载文件夹失败');
      });
      event.target.value = '';
    });
    els.passFilterSelect?.addEventListener('change', () => {
      populatePairSelect();
      const firstPairId = els.pairSelect?.value;
      if (!firstPairId) {
        setStatus('这个 Pass 没有 ready 的 Before/After 配对');
        return;
      }
      choosePair(firstPairId, { autoplay: false });
    });
    els.pairSelect?.addEventListener('change', () => choosePair(els.pairSelect.value, { autoplay: false }));
    els.fitBtn?.addEventListener('click', fitGraph);
    els.beforeBtn?.addEventListener('click', () => {
      const pair = state.activeResult?.pair;
      if (pair?.beforeRef?.ref) {
        updateSideButtons('before');
        displayGraphRef(pair.beforeRef.ref);
      }
    });
    els.afterBtn?.addEventListener('click', () => {
      const pair = state.activeResult?.pair;
      if (pair?.afterRef?.ref) {
        updateSideButtons('after');
        displayGraphRef(pair.afterRef.ref);
      }
    });
    els.colorModeBtn?.addEventListener('click', event => {
      event.stopPropagation();
      setColorModeMenuOpen(Boolean(els.colorModeMenu?.hidden));
    });
    els.colorModeMenu?.addEventListener('click', event => {
      const btn = event.target.closest('[data-color-mode]');
      if (!btn) return;
      setColorMode(btn.dataset.colorMode);
      setColorModeMenuOpen(false);
    });
    document.addEventListener('click', event => {
      if (!els.colorModeMenu || els.colorModeMenu.hidden) return;
      if (event.target.closest('#colorModeBtn') || event.target.closest('#colorModeMenu')) return;
      setColorModeMenuOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') setColorModeMenuOpen(false);
    });
    window.addEventListener('resize', () => {
      fitGraph();
      if (els.colorModeMenu && !els.colorModeMenu.hidden) positionColorModeMenu();
    });
  }

  bindViewport();
  bindEvents();
  setColorMode('semantic');
  setStatus('打开 Pass 文件夹开始');
})();

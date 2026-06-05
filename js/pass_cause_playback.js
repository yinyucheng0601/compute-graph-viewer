/**
 * pass_cause_playback.js - Rule-step playback and graph highlight overlay.
 */
(function () {
  const STEP_EVENT = 'pto-pass-cause:step-change';
  let root = null;
  let result = null;
  let activeIndex = -1;
  let activeStep = null;
  let playTimer = 0;
  let splitTimer = 0;
  let loadingRef = null;
  let timelineSteps = null;
  let timelineMeta = {};
  let timelineIndex = -1;
  let timelineTimer = 0;
  let timelineHighlightStep = null;
  let timelineHighlightSide = 'after';
  let highlightOwner = null;
  let controlsRoot = null;
  const touchedNodes = new Set();
  const touchedEdges = new Set();
  const badges = new Set();
  const PLAY_STEP_INTERVAL_MS = 1900;
  const PLAY_TIMELINE_INTERVAL_MS = 2300;

  function escAttr(value) {
    if (window.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function controlsHtml() {
    return `
      <button class="btn btn-ghost btn-icon pass-cause-playback-btn" data-action="prev" type="button" title="上一步" aria-label="上一步">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M8.5 3L5 6.5L8.5 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="btn btn-solid btn-icon pass-cause-playback-main" data-action="play" type="button" title="播放" aria-label="播放">
        <svg data-role="play-icon" width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M4.4 3.1v6.8l5.3-3.4-5.3-3.4z" fill="currentColor"/></svg>
        <svg data-role="pause-icon" width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M4 3.2h1.7v6.6H4V3.2zm3.3 0H9v6.6H7.3V3.2z" fill="currentColor"/></svg>
      </button>
      <button class="btn btn-ghost btn-icon pass-cause-playback-btn" data-action="next" type="button" title="下一步" aria-label="下一步">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M4.5 3L8 6.5L4.5 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    `;
  }

  function handleControlClick(event) {
    const action = event.target.closest('[data-action]')?.dataset?.action;
    if (!action) return;
    if (action === 'prev') hasTimeline() ? selectTimelineStep(timelineIndex - 1) : selectStep(activeIndex - 1);
    if (action === 'next') hasTimeline() ? selectTimelineStep(timelineIndex + 1) : selectStep(activeIndex + 1);
    if (action === 'play') togglePlay();
  }

  function bindControlClicks(target) {
    if (!target || target.dataset.passCausePlaybackControlsBound === 'true') return;
    target.addEventListener('click', handleControlClick);
    target.dataset.passCausePlaybackControlsBound = 'true';
  }

  function ensureControlDom() {
    const externalControls = document.getElementById('passPlaybackNavControls');
    if (externalControls) {
      controlsRoot = externalControls;
      controlsRoot.hidden = false;
      controlsRoot.classList.add('pass-cause-playback-controls');
      if (!controlsRoot.querySelector('[data-action="play"]')) controlsRoot.innerHTML = controlsHtml();
      bindControlClicks(controlsRoot);
      return controlsRoot;
    }
    controlsRoot = root?.querySelector('[data-role="controls"]') || null;
    if (controlsRoot) bindControlClicks(controlsRoot);
    return controlsRoot;
  }

  function controlButton(action) {
    return controlsRoot?.querySelector?.(`[data-action="${action}"]`)
      || root?.querySelector?.(`[data-action="${action}"]`)
      || null;
  }

  function updatePlayVisual(btn, isPlaying) {
    if (!btn) return;
    const label = isPlaying ? '暂停' : '播放';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.classList.toggle('is-playing', isPlaying);
    const playIcon = btn.querySelector('[data-role="play-icon"]');
    const pauseIcon = btn.querySelector('[data-role="pause-icon"]');
    if (playIcon) playIcon.hidden = false;
    if (pauseIcon) pauseIcon.hidden = false;
  }

  function updateControlState(hasSteps, isPlaying) {
    const prevBtn = controlButton('prev');
    const nextBtn = controlButton('next');
    const playBtn = controlButton('play');
    updatePlayVisual(playBtn, isPlaying);
    [prevBtn, nextBtn, playBtn].forEach(btn => {
      if (btn) btn.disabled = !hasSteps;
    });
  }

  function ensureDom() {
    if (root) {
      ensureControlDom();
      return root;
    }
    const hasExternalControls = !!document.getElementById('passPlaybackNavControls');
    root = document.getElementById('passCausePlayback');
    if (!root) {
      root = document.createElement('div');
      root.id = 'passCausePlayback';
      root.className = 'pass-cause-playback';
      root.hidden = hasExternalControls;
      document.body.appendChild(root);
    }
    root.classList.toggle('is-controls-in-nav', hasExternalControls);
    root.innerHTML = `
      ${hasExternalControls ? '' : `<div class="pass-cause-playback-controls" data-role="controls">${controlsHtml()}</div>`}
      <div class="pass-cause-playback-track">
        <input class="pass-cause-playback-range" data-role="range" type="range" min="0" max="0" value="0">
      </div>
      <div class="pass-cause-playback-meta" data-role="meta">暂无规则步骤</div>
    `;
    ensureControlDom();
    root.querySelector('[data-role="range"]')?.addEventListener('input', (event) => {
      hasTimeline() ? selectTimelineStep(Number(event.target.value)) : selectStep(Number(event.target.value));
    });
    return root;
  }

  function hasTimeline() {
    return Array.isArray(timelineSteps) && timelineSteps.length > 0;
  }

  function clearHighlights() {
    document.getElementById('explainGraphRoot')?.classList.remove('is-step-dim-mode');
    touchedNodes.forEach(el => el.classList.remove('cause-node-highlight', 'cause-node-muted', 'cause-node-remove', 'cause-node-add', 'cause-node-rewire'));
    touchedEdges.forEach(el => el.classList.remove('cause-edge-highlight', 'cause-edge-removed', 'cause-edge-added', 'cause-edge-rewire'));
    badges.forEach(el => el.remove());
    touchedNodes.clear();
    touchedEdges.clear();
    badges.clear();
  }

  function currentSide() {
    return window.PtoPassIrState?.getCurrentLoadInfo?.()?.side || 'after';
  }

  function stepPayloadForSide(step, side) {
    if (!step) return null;
    return side === 'before' ? (step.before || null) : (step.after || null);
  }

  function highlightClassFor(step, side) {
    const type = step?.transition?.type || step?.changeType || '';
    if (side === 'before' && String(type).includes('remove')) return 'cause-node-remove';
    if (side === 'after' && String(type).includes('remove')) return 'cause-node-rewire';
    if (String(type).includes('add') || String(type).includes('split-fanout')) return 'cause-node-add';
    return 'cause-node-highlight';
  }

  function edgeClassForStep(step, side) {
    const type = step?.transition?.type || step?.changeType || '';
    if (side === 'before' && String(type).includes('remove')) return 'cause-edge-removed';
    if (side === 'after' && String(type).includes('remove')) return 'cause-edge-rewire';
    if (String(type).includes('add') || String(type).includes('split-fanout')) return 'cause-edge-added';
    return 'cause-edge-highlight';
  }

  function addBadge(nodeEl, text) {
    if (!nodeEl || !text) return;
    const badge = document.createElement('span');
    badge.className = 'cause-node-badge';
    badge.textContent = text;
    nodeEl.appendChild(badge);
    badges.add(badge);
  }

  function domIndex() {
    return window.PtoPassIrState?.getRenderCache?.() || {};
  }

  function nodeElementById(nodeId) {
    const renderNodeId = window.PtoPassIrState?.resolveRenderNodeId?.(nodeId) || nodeId;
    const cache = domIndex();
    if (cache.nodeElementsById?.has(renderNodeId)) return cache.nodeElementsById.get(renderNodeId);
    const nodesLayer = document.getElementById('nodesLayer');
    return nodesLayer?.querySelector?.(`[data-node-id="${escAttr(renderNodeId)}"]`) || null;
  }

  function edgeElementsById(id) {
    const cache = domIndex();
    if (cache.edgeElementsById?.has(id)) return cache.edgeElementsById.get(id);
    const edgesSvg = document.getElementById('edgesSvg');
    const parts = String(id).split('->');
    if (parts.length !== 2 || !edgesSvg) return [];
    return [...edgesSvg.querySelectorAll(`[data-source="${escAttr(parts[0])}"][data-target="${escAttr(parts[1])}"]`)];
  }

  function activeHighlightTarget() {
    if (highlightOwner === 'timeline') {
      return { step: timelineHighlightStep, side: timelineHighlightSide || currentSide() };
    }
    return { step: activeStep, side: currentSide() };
  }

  function applyHighlight(options = {}) {
    clearHighlights();
    const target = options.step ? { step: options.step, side: options.side || currentSide() } : activeHighlightTarget();
    const step = target.step;
    const side = target.side || currentSide();
    if (!step) return;
    const payload = stepPayloadForSide(step, side) || {};
    const nodeIds = new Set([
      ...(payload.primaryNodeIds || []),
      ...(payload.secondaryNodeIds || []),
      ...(!payload.primaryNodeIds?.length && !payload.secondaryNodeIds?.length ? (step.nodeIds || []) : []),
    ]);
    const primaryNodeIds = new Set(payload.primaryNodeIds || step.nodeIds || []);
    const edgeIds = new Set(payload.edgeIds || step.edgeIds || []);
    const graphRoot = document.getElementById('explainGraphRoot');
    const nodeClass = highlightClassFor(step, side);
    const edgeClass = edgeClassForStep(step, side);

    if (payload.dimOthers) {
      graphRoot?.classList.add('is-step-dim-mode');
    }

    nodeIds.forEach(nodeId => {
      const nodeEl = nodeElementById(nodeId);
      if (nodeEl) {
        nodeEl.classList.add('cause-node-highlight');
        if (primaryNodeIds.has(nodeId)) nodeEl.classList.add(nodeClass);
        addBadge(nodeEl, payload.badges?.[nodeId]);
        touchedNodes.add(nodeEl);
      }
    });

    edgeIds.forEach(id => {
      edgeElementsById(id).forEach(edgeEl => {
        edgeEl.classList.add('cause-edge-highlight');
        edgeEl.classList.add(edgeClass);
        touchedEdges.add(edgeEl);
      });
    });
  }

  function stepTargetRef(step, side = null) {
    if (!step || !result?.pair) return null;
    const targetSide = side || step.focusSide || 'after';
    if (targetSide === 'before') return step.before?.graphRef || result.pair.beforeRef?.ref;
    return step.after?.graphRef || result.pair.afterRef?.ref;
  }

  function loadStepSide(step, side) {
    const targetRef = stepTargetRef(step, side);
    if (!targetRef || !window.PtoPassIrState?.loadGraphRef) {
      window.PtoPassIrState?.fitCurrentGraph?.();
      requestAnimationFrame(() => applyHighlight({ focus: false }));
      return Promise.resolve();
    }
    const currentRef = window.PtoPassIrState.getCurrentLoadInfo?.()?.fileRef || null;
    if (currentRef === targetRef || loadingRef === targetRef) {
      window.PtoPassIrState?.fitCurrentGraph?.();
      requestAnimationFrame(() => applyHighlight({ focus: false }));
      return Promise.resolve();
    }
    loadingRef = targetRef;
    return window.PtoPassIrState.loadGraphRef(targetRef, {
      fit: true,
      animate: false,
    })
      .finally(() => {
        loadingRef = null;
        requestAnimationFrame(() => applyHighlight({ focus: false }));
      });
  }

  function syncGraphForStep(step) {
    if (splitTimer) {
      clearTimeout(splitTimer);
      splitTimer = 0;
    }
    const isSplit = step?.sideMode === 'split' || step?.transition?.type === 'remove-and-rewire';
    if (!isSplit) {
      loadStepSide(step, step?.focusSide || 'after');
      window.PtoPassIrState?.showStepGhost?.(step, step?.focusSide || 'after');
      return;
    }
    loadStepSide(step, 'before').then(() => {
      window.PtoPassIrState?.showStepGhost?.(step, 'before');
      splitTimer = setTimeout(() => {
        loadStepSide(step, 'after').then(() => {
          window.PtoPassIrState?.showStepGhost?.(step, 'after');
        });
      }, step?.transition?.durationMs || 900);
    });
  }

  function render() {
    const el = ensureDom();
    if (hasTimeline()) {
      renderTimeline(el);
      return;
    }
    const steps = result?.explanations || [];
    const hasSteps = steps.length > 0;
    el.classList.toggle('is-empty', !hasSteps);
    el.classList.remove('is-pass-timeline');
    const range = el.querySelector('[data-role="range"]');
    const meta = el.querySelector('[data-role="meta"]');

    if (range) {
      range.max = String(Math.max(0, steps.length - 1));
      range.value = String(Math.max(0, activeIndex));
      range.disabled = !hasSteps;
    }
    if (meta) {
      meta.textContent = hasSteps
        ? `${activeIndex + 1}/${steps.length} · ${sideLabel(activeStep?.sideMode || activeStep?.focusSide || 'after')} · ${activeStep?.title || ''}`
        : '等待 Before/After 配对';
    }
    updateControlState(hasSteps, !!playTimer);
  }

  function renderTimeline(el) {
    const steps = timelineSteps || [];
    const hasSteps = steps.length > 0;
    el.classList.toggle('is-empty', !hasSteps);
    el.classList.toggle('is-pass-timeline', hasSteps);
    const range = el.querySelector('[data-role="range"]');
    const meta = el.querySelector('[data-role="meta"]');
    const active = steps[timelineIndex] || null;

    if (range) {
      range.max = String(Math.max(0, steps.length - 1));
      range.value = String(Math.max(0, timelineIndex));
      range.disabled = !hasSteps;
    }
    if (meta) {
      const prefix = timelineMeta.title ? `${timelineMeta.title} · ` : '';
      meta.textContent = active
        ? `${prefix}${timelineIndex + 1}/${steps.length} · ${active.label || active.fileRef || ''}`
        : `${prefix}等待 Pass 序列`;
    }
    updateControlState(hasSteps, !!timelineTimer);
  }

  function dispatchStep() {
    window.dispatchEvent(new CustomEvent(STEP_EVENT, {
      detail: {
        result,
        step: activeStep,
        index: activeIndex,
      },
    }));
  }

  function dispatchTimelineStep(step) {
    window.dispatchEvent(new CustomEvent(STEP_EVENT, {
      detail: {
        mode: 'timeline',
        result,
        timelineStep: step || null,
        timelineIndex,
        timelineCount: timelineSteps?.length || 0,
      },
    }));
  }

  function sideLabel(side) {
    if (side === 'split') return 'Before -> After';
    return side === 'before' ? 'Before' : 'After';
  }

  function selectStep(index, options = {}) {
    const steps = result?.explanations || [];
    if (!steps.length) {
      activeIndex = -1;
      activeStep = null;
      render();
      clearHighlights();
      dispatchStep();
      return;
    }
    if (index < 0) index = steps.length - 1;
    if (index >= steps.length) index = 0;
    activeIndex = index;
    activeStep = steps[activeIndex];
    highlightOwner = 'rule';
    render();
    dispatchStep();
    if (options.load !== false) syncGraphForStep(activeStep);
    else requestAnimationFrame(() => applyHighlight());
  }

  function setResult(nextResult) {
    stopPlay();
    result = nextResult || null;
    activeIndex = -1;
    activeStep = null;
    if (splitTimer) {
      clearTimeout(splitTimer);
      splitTimer = 0;
    }
    ensureDom();
    render();
    const steps = result?.explanations || [];
    if (steps.length) selectStep(0);
    else clearHighlights();
  }

  function stopPlay() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = 0;
      if (splitTimer) {
        clearTimeout(splitTimer);
        splitTimer = 0;
      }
      render();
    }
    if (timelineTimer) {
      clearInterval(timelineTimer);
      timelineTimer = 0;
      render();
    }
  }

  function togglePlay() {
    if (hasTimeline()) {
      toggleTimelinePlay();
      return;
    }
    if (playTimer) {
      stopPlay();
      return;
    }
    const steps = result?.explanations || [];
    if (!steps.length) return;
    playTimer = setInterval(() => selectStep(activeIndex + 1), PLAY_STEP_INTERVAL_MS);
    render();
  }

  function play() {
    if (hasTimeline()) {
      playTimeline();
      return;
    }
    if (playTimer) return;
    const steps = result?.explanations || [];
    if (!steps.length) return;
    playTimer = setInterval(() => selectStep(activeIndex + 1), PLAY_STEP_INTERVAL_MS);
    render();
  }

  function selectTimelineStep(index, options = {}) {
    const steps = timelineSteps || [];
    if (!steps.length) {
      timelineIndex = -1;
      render();
      return Promise.resolve();
    }
    if (index < 0) index = steps.length - 1;
    if (index >= steps.length) index = 0;
    timelineIndex = index;
    const step = steps[timelineIndex];
    timelineHighlightStep = step.ghostStep || null;
    timelineHighlightSide = step.side || 'after';
    highlightOwner = timelineHighlightStep ? 'timeline' : null;
    render();
    dispatchTimelineStep(step);
    clearHighlights();
    if (step.navPassIndex != null) window.navSelectPassIndex?.(step.navPassIndex, { load: false });
    if (step.pathId) window.navSelectPath?.(step.pathId, { load: false });
    if (!step.fileRef || !window.PtoPassIrState?.loadGraphRef) return Promise.resolve();
    return window.PtoPassIrState.loadGraphRef(step.fileRef, {
      fit: options.fit !== false && (timelineIndex === 0 || options.fit === true),
      animate: options.animate !== false,
      side: step.side || 'after',
    }).then(() => {
      if (step.ghostStep && window.PtoPassIrState?.showStepGhost) {
        window.PtoPassIrState.showStepGhost(step.ghostStep, step.side || 'after');
      }
      if (step.ghostStep) {
        requestAnimationFrame(() => requestAnimationFrame(() => applyHighlight({
          step: step.ghostStep,
          side: step.side || 'after',
        })));
      }
    }).catch(error => {
      console.error('Pass timeline load failed:', error);
    });
  }

  function playTimeline() {
    if (timelineTimer || !hasTimeline()) return;
    timelineTimer = setInterval(() => selectTimelineStep(timelineIndex + 1), PLAY_TIMELINE_INTERVAL_MS);
    render();
  }

  function toggleTimelinePlay() {
    if (timelineTimer) {
      stopPlay();
      return;
    }
    playTimeline();
  }

  function setTimeline(steps, meta = {}) {
    stopPlay();
    timelineSteps = Array.isArray(steps) ? steps.filter(step => step && step.fileRef) : null;
    timelineMeta = meta || {};
    timelineIndex = -1;
    timelineHighlightStep = null;
    highlightOwner = null;
    ensureDom();
    render();
    if (hasTimeline()) {
      const initial = Number.isInteger(meta.initialIndex) ? meta.initialIndex : 0;
      selectTimelineStep(initial, { fit: true, animate: meta.animateInitial !== false });
    }
  }

  window.addEventListener('pto-pass-ir:graph-rendered', () => {
    const target = activeHighlightTarget();
    if (target.step) applyHighlight({ step: target.step, side: target.side });
  });

  window.PtoPassCausePlayback = {
    setResult,
    setTimeline,
    selectStep,
    selectTimelineStep,
    play,
    stop: stopPlay,
    getActiveStep: () => activeStep,
    clear: () => {
      result = null;
      activeIndex = -1;
      activeStep = null;
      timelineSteps = null;
      timelineMeta = {};
      timelineIndex = -1;
      stopPlay();
      clearHighlights();
      render();
    },
    applyHighlight,
  };
})();

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

  function escAttr(value) {
    if (window.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function ensureDom() {
    if (root) return root;
    root = document.getElementById('passCausePlayback');
    if (!root) {
      root = document.createElement('div');
      root.id = 'passCausePlayback';
      root.className = 'pass-cause-playback';
      document.body.appendChild(root);
    }
    root.innerHTML = `
      <button class="btn btn-ghost btn-icon pass-cause-playback-btn" data-action="prev" type="button" title="上一个规则">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M8.5 3L5 6.5L8.5 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="btn btn-solid pass-cause-playback-main" data-action="play" type="button">播放</button>
      <button class="btn btn-ghost btn-icon pass-cause-playback-btn" data-action="next" type="button" title="下一个规则">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M4.5 3L8 6.5L4.5 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="pass-cause-playback-track">
        <input class="pass-cause-playback-range" data-role="range" type="range" min="0" max="0" value="0">
      </div>
      <div class="pass-cause-playback-meta" data-role="meta">暂无规则步骤</div>
    `;
    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset?.action;
      if (!action) return;
      if (action === 'prev') selectStep(activeIndex - 1);
      if (action === 'next') selectStep(activeIndex + 1);
      if (action === 'play') togglePlay();
    });
    root.querySelector('[data-role="range"]')?.addEventListener('input', (event) => {
      selectStep(Number(event.target.value));
    });
    return root;
  }

  function clearHighlights() {
    document.querySelectorAll('.node-card.cause-node-highlight, .node-card.cause-node-muted, .node-card.cause-node-remove, .node-card.cause-node-add, .node-card.cause-node-rewire')
      .forEach(el => el.classList.remove('cause-node-highlight', 'cause-node-muted', 'cause-node-remove', 'cause-node-add', 'cause-node-rewire'));
    document.querySelectorAll('.edge.cause-edge-highlight, .edge.cause-edge-removed, .edge.cause-edge-added, .edge.cause-edge-rewire')
      .forEach(el => el.classList.remove('cause-edge-highlight', 'cause-edge-removed', 'cause-edge-added', 'cause-edge-rewire'));
    document.querySelectorAll('.cause-node-badge').forEach(el => el.remove());
  }

  function currentSide() {
    return window.PtoPassIrState?.getCurrentLoadInfo?.()?.side || 'after';
  }

  function stepPayloadForCurrentSide(step) {
    if (!step) return null;
    return currentSide() === 'before' ? (step.before || null) : (step.after || null);
  }

  function highlightClassFor(step) {
    const side = currentSide();
    const type = step?.transition?.type || step?.changeType || '';
    if (side === 'before' && String(type).includes('remove')) return 'cause-node-remove';
    if (side === 'after' && String(type).includes('remove')) return 'cause-node-rewire';
    if (String(type).includes('add') || String(type).includes('split-fanout')) return 'cause-node-add';
    return 'cause-node-highlight';
  }

  function edgeClassForStep(step) {
    const side = currentSide();
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
  }

  function applyHighlight() {
    clearHighlights();
    if (!activeStep) return;
    const payload = stepPayloadForCurrentSide(activeStep) || {};
    const nodeIds = new Set([
      ...(payload.primaryNodeIds || []),
      ...(payload.secondaryNodeIds || []),
      ...(!payload.primaryNodeIds?.length && !payload.secondaryNodeIds?.length ? (activeStep.nodeIds || []) : []),
    ]);
    const primaryNodeIds = new Set(payload.primaryNodeIds || activeStep.nodeIds || []);
    const edgeIds = new Set(payload.edgeIds || activeStep.edgeIds || []);
    const nodesLayer = document.getElementById('nodesLayer');
    const edgesSvg = document.getElementById('edgesSvg');
    if (!nodesLayer || !edgesSvg) return;
    const nodeClass = highlightClassFor(activeStep);
    const edgeClass = edgeClassForStep(activeStep);

    if (payload.dimOthers) {
      nodesLayer.querySelectorAll('.node-card[data-node-id]').forEach(nodeEl => {
        if (!nodeIds.has(nodeEl.dataset.nodeId)) nodeEl.classList.add('cause-node-muted');
      });
    }

    nodeIds.forEach(nodeId => {
      const nodeEl = nodesLayer.querySelector(`[data-node-id="${escAttr(nodeId)}"]`);
      if (nodeEl) {
        nodeEl.classList.add('cause-node-highlight');
        if (primaryNodeIds.has(nodeId)) nodeEl.classList.add(nodeClass);
        addBadge(nodeEl, payload.badges?.[nodeId]);
      }
    });

    edgeIds.forEach(id => {
      const parts = String(id).split('->');
      if (parts.length !== 2) return;
      edgesSvg.querySelectorAll(`[data-source="${escAttr(parts[0])}"][data-target="${escAttr(parts[1])}"]`)
        .forEach(edgeEl => {
          edgeEl.classList.add('cause-edge-highlight');
          edgeEl.classList.add(edgeClass);
        });
    });

    const focusId = [...primaryNodeIds][0] || [...nodeIds][0];
    if (focusId) window.PtoPassIrState?.focusNodeById?.(focusId);
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
      requestAnimationFrame(applyHighlight);
      return Promise.resolve();
    }
    const currentRef = window.PtoPassIrState.getCurrentLoadInfo?.()?.fileRef || null;
    if (currentRef === targetRef || loadingRef === targetRef) {
      requestAnimationFrame(applyHighlight);
      return Promise.resolve();
    }
    loadingRef = targetRef;
    return window.PtoPassIrState.loadGraphRef(targetRef)
      .finally(() => {
        loadingRef = null;
        requestAnimationFrame(applyHighlight);
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
    const steps = result?.explanations || [];
    const hasSteps = steps.length > 0;
    el.classList.toggle('is-empty', !hasSteps);
    const range = el.querySelector('[data-role="range"]');
    const meta = el.querySelector('[data-role="meta"]');
    const playBtn = el.querySelector('[data-action="play"]');
    const prevBtn = el.querySelector('[data-action="prev"]');
    const nextBtn = el.querySelector('[data-action="next"]');

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
    if (playBtn) playBtn.textContent = playTimer ? '暂停' : '播放';
    [prevBtn, nextBtn, playBtn].forEach(btn => {
      if (btn) btn.disabled = !hasSteps;
    });
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
    render();
    dispatchStep();
    if (options.load !== false) syncGraphForStep(activeStep);
    else requestAnimationFrame(applyHighlight);
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
  }

  function togglePlay() {
    if (playTimer) {
      stopPlay();
      return;
    }
    const steps = result?.explanations || [];
    if (!steps.length) return;
    playTimer = setInterval(() => selectStep(activeIndex + 1), 1400);
    render();
  }

  function play() {
    if (playTimer) return;
    const steps = result?.explanations || [];
    if (!steps.length) return;
    playTimer = setInterval(() => selectStep(activeIndex + 1), 1400);
    render();
  }

  window.addEventListener('pto-pass-ir:graph-rendered', () => {
    if (activeStep) applyHighlight();
  });

  window.PtoPassCausePlayback = {
    setResult,
    selectStep,
    play,
    stop: stopPlay,
    getActiveStep: () => activeStep,
    clear: () => {
      result = null;
      activeIndex = -1;
      activeStep = null;
      stopPlay();
      clearHighlights();
      render();
    },
    applyHighlight,
  };
})();

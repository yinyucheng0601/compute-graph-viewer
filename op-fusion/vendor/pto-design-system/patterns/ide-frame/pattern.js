(function registerPtoIdeFrame(global) {
  'use strict';

  const qs = (root, selector) => root.querySelector(selector);
  const qsa = (root, selector) => Array.from(root.querySelectorAll(selector));
  let playbackUid = 0;

  function parseNumberList(value, fallback) {
    if (!value) return fallback;
    const list = String(value)
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item));
    return list.length ? list : fallback;
  }

  function directPanes(split) {
    return Array.from(split.children).filter((child) => child.matches?.('[data-ide-pane]'));
  }

  function splitStorageKey(frame, split, index) {
    const host = frame.dataset.host || 'standalone';
    const id = split.dataset.ideSplit || `split-${index + 1}`;
    return split.dataset.storageKey || `pto-ide-frame-${host}-${id}-v3`;
  }

  function initialSizesForSplit(split, panes, direction, fallbackSizes, gutterSize) {
    const pixelSizes = parseNumberList(split.dataset.pixelSizes || split.dataset.defaultPixels, []);
    if (!pixelSizes.length) return fallbackSizes;
    const fallback = Array.isArray(fallbackSizes) && fallbackSizes.length === panes.length
      ? fallbackSizes
      : Array.from({ length: panes.length }, () => 1);

    const rect = split.getBoundingClientRect();
    const styles = global.getComputedStyle?.(split);
    const paddingA = direction === 'vertical'
      ? Number.parseFloat(styles?.paddingTop || '0')
      : Number.parseFloat(styles?.paddingLeft || '0');
    const paddingB = direction === 'vertical'
      ? Number.parseFloat(styles?.paddingBottom || '0')
      : Number.parseFloat(styles?.paddingRight || '0');
    const rawSize = direction === 'vertical' ? rect.height : rect.width;
    const available = rawSize - paddingA - paddingB - Math.max(0, panes.length - 1) * gutterSize;
    if (!Number.isFinite(available) || available <= 0) return fallbackSizes;

    const fixedPixels = panes.map((_pane, index) => {
      const value = Number(pixelSizes[index]);
      return Number.isFinite(value) && value > 0 ? Math.min(value, available) : 0;
    });
    const fixedTotal = fixedPixels.reduce((sum, size) => sum + size, 0);
    const flexibleIndexes = panes
      .map((_pane, index) => index)
      .filter((index) => fixedPixels[index] <= 0);
    const remaining = Math.max(0, available - fixedTotal);
    const flexibleWeight = flexibleIndexes.reduce((sum, index) => {
      const weight = Number(fallback[index]);
      return sum + (Number.isFinite(weight) && weight > 0 ? weight : 1);
    }, 0);
    const resolvedPixels = fixedPixels.map((size, index) => {
      if (size > 0) return size;
      const weight = Number(fallback[index]);
      const safeWeight = Number.isFinite(weight) && weight > 0 ? weight : 1;
      return flexibleWeight > 0 ? remaining * safeWeight / flexibleWeight : remaining / Math.max(1, flexibleIndexes.length);
    });

    return resolvedPixels.map((size) => size / available * 100);
  }

  function initSplit(frame, split, index, options = {}) {
    const helper = global.PtoWorkbenchShell;
    if (!helper?.initResizablePanes) return null;

    const panes = directPanes(split);
    if (panes.length < 2) return null;

    const direction = split.dataset.splitDirection || split.dataset.direction || 'horizontal';
    const configuredSizes = parseNumberList(split.dataset.sizes, options.sizes);
    const minSize = parseNumberList(split.dataset.minSize, options.minSize || 0);
    const gutterSize = Number.isFinite(Number(split.dataset.gutterSize))
      ? Number(split.dataset.gutterSize)
      : (options.gutterSize || 7);
    const sizes = initialSizesForSplit(split, panes, direction, configuredSizes, gutterSize);

    return helper.initResizablePanes({
      root: split,
      panes,
      direction,
      sizes,
      minSize,
      gutterSize,
      storageKey: splitStorageKey(frame, split, index),
      keyboard: split.dataset.keyboard !== 'false',
      onResize: options.onResize,
    });
  }

  function playbackIds(index) {
    const prefix = `ide-floating-playback-${index + 1}`;
    return {
      shell: `${prefix}-shell`,
      toggle: `${prefix}-toggle`,
      collapsedButton: `${prefix}-collapsed-btn`,
      collapsedIcon: `${prefix}-collapsed-icon`,
      controls: `${prefix}-controls`,
      stepBack: `${prefix}-step-back`,
      play: `${prefix}-play`,
      stepForward: `${prefix}-step-fwd`,
      replay: `${prefix}-replay`,
      scrubber: `${prefix}-scrubber`,
      scrubberLabel: `${prefix}-scrubber-label`,
      scrubberOpname: `${prefix}-scrubber-opname`,
      scrubberHover: `${prefix}-scrubber-hover`,
    };
  }

  function byId(root, id) {
    return root.querySelector(`#${id}`);
  }

  function initFloatingPlayback(mount, index, options = {}) {
    const helper = global.PtoFloatingPlaybackControl;
    if (!helper?.createControl || !helper?.init) return null;

    const ids = playbackIds(playbackUid++);
    let generated = false;
    let control = mount.querySelector('.pto-floating-playback');
    if (!control) {
      control = helper.createControl({
        ids,
        className: 'pto-floating-playback--preview pto-ide-frame__floating-playback',
      });
      mount.appendChild(control);
      generated = true;
    }

    const totalSteps = Math.max(1, Number(mount.dataset.totalSteps || options.totalSteps || 1) || 1);
    const state = {
      step: Math.max(0, Number(mount.dataset.step || options.step || 0) || 0),
      playing: !!options.playing,
    };
    const destroyFns = [];

    const play = byId(control, ids.play) || control.querySelector('.pto-floating-playback__button--primary');
    const stepBack = byId(control, ids.stepBack);
    const stepForward = byId(control, ids.stepForward);
    const replay = byId(control, ids.replay);
    const scrubber = byId(control, ids.scrubber) || control.querySelector('.pto-floating-playback__scrubber');
    const label = byId(control, ids.scrubberLabel) || control.querySelector('.pto-floating-playback__counter');
    const opname = byId(control, ids.scrubberOpname) || control.querySelector('.pto-floating-playback__opname');

    const playback = helper.init({
      root: control,
      isPlaying: () => state.playing,
    });

    const hover = helper.initScrubberHover?.({
      root: control,
      totalSteps,
      getLabelForStep: (step) => `Step ${step}`,
    });

    const clampStep = (step) => Math.max(0, Math.min(totalSteps - 1, step));
    const render = () => {
      state.step = clampStep(state.step);
      if (scrubber) {
        scrubber.max = String(totalSteps - 1);
        scrubber.value = String(state.step);
      }
      if (label) label.textContent = `${state.step} / ${totalSteps - 1}`;
      if (opname) opname.textContent = mount.dataset.playbackState || '-';
      if (play && helper.iconLabel) {
        play.innerHTML = state.playing ? helper.iconLabel('pause', 'Pause') : helper.iconLabel('play', 'Play');
      }
      playback.sync({ playing: state.playing });
    };

    const listen = (target, eventName, handler) => {
      if (!target) return;
      target.addEventListener(eventName, handler);
      destroyFns.push(() => target.removeEventListener(eventName, handler));
    };

    listen(play, 'click', () => {
      state.playing = !state.playing;
      render();
    });
    listen(stepBack, 'click', () => {
      state.playing = false;
      state.step -= 1;
      render();
    });
    listen(stepForward, 'click', () => {
      state.playing = false;
      state.step += 1;
      render();
    });
    listen(replay, 'click', () => {
      state.playing = false;
      state.step = 0;
      render();
    });
    listen(scrubber, 'input', () => {
      state.playing = false;
      state.step = Number(scrubber.value) || 0;
      render();
    });

    render();

    return {
      control,
      playback,
      hover,
      destroy() {
        destroyFns.splice(0).forEach((destroy) => destroy());
        hover?.destroy?.();
        playback.destroy?.();
        if (generated) control.remove();
      },
    };
  }

  function initExplorerToggle(frame, splits, splitInstances) {
    const toggle = qs(frame, '[data-ide-toggle="explorer"]');
    const explorer = qs(frame, '[data-ide-pane="explorer"]');
    const mainSplit = qs(frame, '[data-ide-split="standalone-main"]');
    if (!toggle || !explorer || !mainSplit) return null;

    const splitIndex = splits.indexOf(mainSplit);
    const resizeInstance = splitInstances[splitIndex];
    const panes = directPanes(mainSplit);
    const visiblePanes = panes.filter((pane) => pane !== explorer);
    const explorerGutter = explorer.nextElementSibling?.matches?.('.pto-workbench-shell__split-gutter')
      ? explorer.nextElementSibling
      : null;
    let expandedSizes = parseNumberList(mainSplit.dataset.sizes, [22, 50, 28]);
    let expanded = frame.dataset.explorerCollapsed !== 'true';

    const collapsedSizesFor = (sizes) => {
      const configured = parseNumberList(toggle.dataset.collapsedSizes, []);
      if (configured.length === sizes.length) return configured;

      const remaining = sizes.slice(1);
      const remainingTotal = remaining.reduce((sum, size) => sum + size, 0);
      if (remainingTotal <= 0) return [0, 64, 36];
      return [
        0,
        ...remaining.map((size) => size / remainingTotal * 100),
      ];
    };

    const applyCollapsedFill = (sizes) => {
      const visibleSizes = sizes.slice(1);
      visiblePanes.forEach((pane, index) => {
        const grow = Number.isFinite(visibleSizes[index]) && visibleSizes[index] > 0
          ? visibleSizes[index]
          : 1;
        pane.style.flex = `${grow} 1 0%`;
        pane.style.flexBasis = '0%';
        pane.style.width = 'auto';
      });
      explorer.style.flex = '0 0 0px';
      explorer.style.flexBasis = '0px';
      explorer.style.width = '0px';
    };

    const render = (nextSizes = null) => {
      frame.dataset.explorerCollapsed = String(!expanded);
      mainSplit.dataset.explorerCollapsed = String(!expanded);
      toggle.classList.toggle('is-selected', expanded);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-pressed', String(expanded));
      explorer.setAttribute('aria-hidden', String(!expanded));
      explorer.hidden = !expanded;
      if (explorerGutter) explorerGutter.hidden = !expanded;

      const sizes = nextSizes || (!expanded ? collapsedSizesFor(expandedSizes) : null);
      if (sizes && resizeInstance?.setSizes) {
        resizeInstance.setSizes(sizes);
        resizeInstance.refresh?.();
      }
      if (!expanded) applyCollapsedFill(sizes || collapsedSizesFor(expandedSizes));
    };

    const onClick = () => {
      if (expanded) {
        const currentSizes = resizeInstance?.getSizes?.();
        if (currentSizes?.length === expandedSizes.length && currentSizes.every((size) => Number.isFinite(size) && size > 0)) {
          expandedSizes = currentSizes;
        }
        expanded = false;
        render(collapsedSizesFor(expandedSizes));
        return;
      }

      expanded = !expanded;
      render(expandedSizes);
    };

    toggle.addEventListener('click', onClick);
    render(expanded ? null : collapsedSizesFor(expandedSizes));

    return {
      destroy() {
        toggle.removeEventListener('click', onClick);
        explorer.removeAttribute('aria-hidden');
        explorer.hidden = false;
        if (explorerGutter) explorerGutter.hidden = false;
        delete mainSplit.dataset.explorerCollapsed;
        delete frame.dataset.explorerCollapsed;
      },
    };
  }

  function init(root, options = {}) {
    const frame = typeof root === 'string' ? qs(document, root) : root;
    if (!frame || frame.dataset.ideFrameReady === 'true') return null;
    frame.dataset.ideFrameReady = 'true';

    const splitOptions = options.splitOptions || {};
    const splits = qsa(frame, '[data-ide-split]');
    const splitInstances = splits
      .map((split, index) => initSplit(frame, split, index, splitOptions[split.dataset.ideSplit] || splitOptions.default || {}));
    const resizeInstances = splitInstances.filter(Boolean);
    const explorerToggle = initExplorerToggle(frame, splits, splitInstances);

    const playbackOptions = options.playback || {};
    const playbackInstances = qsa(frame, '[data-ide-floating-playback]')
      .map((mount, index) => initFloatingPlayback(mount, index, playbackOptions))
      .filter(Boolean);

    options.onInit?.({
      frame,
      host: frame.dataset.host || 'standalone',
      splits,
      resizeInstances,
      explorerToggle,
      playbackInstances,
    });

    return {
      frame,
      resizeInstances,
      explorerToggle,
      playbackInstances,
      destroy() {
        explorerToggle?.destroy?.();
        resizeInstances.splice(0).forEach((instance) => instance.destroy());
        playbackInstances.splice(0).forEach((instance) => instance.destroy());
        delete frame.dataset.ideFrameReady;
      },
      refresh() {
        resizeInstances.forEach((instance) => instance.refresh?.());
      },
    };
  }

  function initAll(options = {}) {
    const instances = qsa(document, '[data-ide-frame]')
      .map((root) => init(root, options))
      .filter(Boolean);
    const isEmbedPreview = document.documentElement.dataset.embedPreview === 'true';

    const syncFrameHeight = () => {
      if (!isEmbedPreview || global.parent === global) return;
      const contentNode = document.querySelector('.pto-ide-frame-preview') || document.body;
      const nextHeight = Math.ceil(contentNode.getBoundingClientRect().height);
      if (nextHeight > 0) {
        global.parent.postMessage({
          type: 'pto-pattern-preview-height',
          pathname: global.location.pathname,
          height: nextHeight + 4,
        }, '*');
      }
    };

    if (isEmbedPreview) {
      global.requestAnimationFrame(syncFrameHeight);
      global.setTimeout(syncFrameHeight, 180);
    }

    return instances;
  }

  global.PtoIdeFrame = {
    init,
    initAll,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initAll(), { once: true });
  } else {
    initAll();
  }
})(window);

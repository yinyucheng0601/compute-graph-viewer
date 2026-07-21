(function attachPtoWorkbenchShell(global) {
  'use strict';

  const DEFAULT_ZOOM_MIN = 0.4;
  const DEFAULT_ZOOM_MAX = 1.2;
  const DEFAULT_ZOOM_STEP = 0.1;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, precision = 2) => {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  };

  const asElement = (target, root = document) => {
    if (!target) return null;
    if (target instanceof Element) return target;
    return root.querySelector(target);
  };

  const normalizeDirection = (direction) => (
    direction === 'vertical' ? 'vertical' : 'horizontal'
  );

  const axisFor = (direction) => {
    const resolved = normalizeDirection(direction);
    return resolved === 'vertical'
      ? {
          direction: resolved,
          coordinate: 'clientY',
          size: 'height',
          sizeStyle: 'height',
          minStyle: 'minHeight',
          cursor: 'row-resize',
          ariaOrientation: 'horizontal',
          negativeKeys: new Set(['ArrowUp']),
          positiveKeys: new Set(['ArrowDown']),
        }
      : {
          direction: resolved,
          coordinate: 'clientX',
          size: 'width',
          sizeStyle: 'width',
          minStyle: 'minWidth',
          cursor: 'col-resize',
          ariaOrientation: 'vertical',
          negativeKeys: new Set(['ArrowLeft']),
          positiveKeys: new Set(['ArrowRight']),
        };
  };

  const normalizePanes = (panes, root = document) => {
    const items = panes
      ? Array.from(panes)
      : Array.from(root.querySelectorAll?.('[data-split-pane]') || []);
    return items.map((pane) => asElement(pane, root)).filter(Boolean);
  };

  const normalizeSizes = (sizes, paneCount) => {
    const fallback = Array.from({ length: paneCount }, () => 100 / paneCount);
    if (!Array.isArray(sizes) || sizes.length !== paneCount) return fallback;
    if (!sizes.every((item) => Number.isFinite(item) && item > 0)) return fallback;
    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (total <= 0) return fallback;
    return sizes.map((size) => size / total * 100);
  };

  const normalizeMinSizes = (minSize, paneCount) => {
    if (Array.isArray(minSize)) {
      return Array.from({ length: paneCount }, (_item, index) => {
        const value = Number(minSize[index]);
        return Number.isFinite(value) ? Math.max(0, value) : 0;
      });
    }
    const value = Number(minSize);
    return Array.from({ length: paneCount }, () => (
      Number.isFinite(value) ? Math.max(0, value) : 0
    ));
  };

  const readStoredSizes = (key, fallback) => {
    if (!key) return fallback.slice();
    try {
      const value = JSON.parse(global.localStorage?.getItem(key) || 'null');
      if (
        Array.isArray(value)
        && value.length === fallback.length
        && value.every((item) => Number.isFinite(item) && item > 0)
      ) {
        return normalizeSizes(value, fallback.length);
      }
    } catch (_error) {
      return fallback.slice();
    }
    return fallback.slice();
  };

  const writeStoredSizes = (key, sizes) => {
    if (!key) return;
    try {
      global.localStorage?.setItem(key, JSON.stringify(sizes.map((item) => round(item, 2))));
    } catch (_error) {
      // Storage can be unavailable in sandboxed previews; drag state still applies.
    }
  };

  function createSplitGutter(index, direction = 'horizontal', options = {}) {
    const axis = axisFor(direction);
    const gutter = document.createElement('div');
    gutter.className = options.gutterClass || 'pto-workbench-shell__split-gutter';
    gutter.dataset.splitIndex = String(index);
    gutter.dataset.splitDirection = axis.direction;
    gutter.setAttribute('role', 'separator');
    gutter.setAttribute('aria-orientation', axis.ariaOrientation);
    gutter.setAttribute('aria-label', options.gutterLabel || 'Resize adjacent panes');
    gutter.tabIndex = options.keyboard === false ? -1 : 0;
    return gutter;
  }

  function getZoomLevels(options = {}) {
    const min = Number.isFinite(options.min) ? options.min : DEFAULT_ZOOM_MIN;
    const max = Number.isFinite(options.max) ? options.max : DEFAULT_ZOOM_MAX;
    const step = Number.isFinite(options.step) ? options.step : DEFAULT_ZOOM_STEP;
    const levels = [];
    for (let value = min; value <= max + step / 2; value += step) {
      levels.push(round(value, 2));
    }
    return levels;
  }

  function nearestZoomIndex(levels, value) {
    const fallback = levels.indexOf(1);
    if (!Number.isFinite(value)) return fallback >= 0 ? fallback : 0;
    let bestIndex = 0;
    let bestDistance = Infinity;
    levels.forEach((level, index) => {
      const distance = Math.abs(level - value);
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    });
    return bestIndex;
  }

  function panePixelSizes(panes, axis) {
    return panes.map((pane) => pane.getBoundingClientRect()[axis.size]);
  }

  function panePercentSizes(panes, axis) {
    const sizes = panePixelSizes(panes, axis);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (total <= 0) return [];
    return sizes.map((size) => size / total * 100);
  }

  function applyPaneSizes(panes, axis, sizes) {
    panes.forEach((pane, index) => {
      const size = Number.isFinite(sizes[index]) && sizes[index] > 0 ? sizes[index] : 1;
      pane.style.flex = `${size} 1 0%`;
      pane.style.flexBasis = '0%';
      pane.style[axis.sizeStyle] = 'auto';
    });
  }

  function resolvePairDelta(startSizes, pairIndex, delta, minSizes) {
    const nextSizes = startSizes.slice();
    const leftIndex = pairIndex;
    const rightIndex = pairIndex + 1;
    const pairTotal = startSizes[leftIndex] + startSizes[rightIndex];
    const leftMin = minSizes[leftIndex] || 0;
    const rightMin = minSizes[rightIndex] || 0;
    const maxLeft = Math.max(leftMin, pairTotal - rightMin);
    const nextLeft = clamp(startSizes[leftIndex] + delta, leftMin, maxLeft);
    nextSizes[leftIndex] = nextLeft;
    nextSizes[rightIndex] = Math.max(rightMin, pairTotal - nextLeft);
    return nextSizes;
  }

  function applyPixelSizesAsPercent(panes, axis, pixelSizes) {
    const total = pixelSizes.reduce((sum, size) => sum + size, 0);
    if (total <= 0) return [];
    const percent = pixelSizes.map((size) => size / total * 100);
    applyPaneSizes(panes, axis, percent);
    return percent;
  }

  function setResizeState(active, direction) {
    document.body.classList.toggle('pto-is-pane-resizing', active);
    if (active) {
      document.body.dataset.ptoResizeDirection = direction;
    } else {
      delete document.body.dataset.ptoResizeDirection;
    }
  }

  function initResizablePanes(rawOptions = {}) {
    const root = asElement(rawOptions.root) || document;
    const panes = normalizePanes(rawOptions.panes, root);
    if (panes.length < 2) {
      return {
        destroy() {},
        getSizes: () => [],
        setSizes() {},
        refresh() {},
      };
    }

    const parent = panes[0].parentElement;
    const axis = axisFor(rawOptions.direction);
    const fallbackSizes = normalizeSizes(rawOptions.sizes || rawOptions.defaultSize, panes.length);
    const initialSizes = readStoredSizes(rawOptions.storageKey, fallbackSizes);
    const minSizes = normalizeMinSizes(rawOptions.minSize ?? 0, panes.length);
    const gutterSize = Number.isFinite(rawOptions.gutterSize) ? rawOptions.gutterSize : 10;
    const keyboardStep = Number.isFinite(rawOptions.keyboardStep) ? rawOptions.keyboardStep : 24;
    const destroyFns = [];

    if (parent) parent.dataset.splitDirection = axis.direction;
    if (root.dataset) root.dataset.splitDirection = axis.direction;
    root.style?.setProperty?.('--pto-workbench-shell-gutter', `${gutterSize}px`);
    parent?.style?.setProperty?.('--pto-workbench-shell-gutter', `${gutterSize}px`);
    applyPaneSizes(panes, axis, initialSizes);

    const emit = (name, sizes, event) => {
      if (name === 'start') rawOptions.onDragStart?.(sizes, event);
      if (name === 'drag') rawOptions.onDrag?.(sizes, event);
      if (name === 'end') rawOptions.onDragEnd?.(sizes, event);
      rawOptions.onResize?.(sizes, { phase: name, event, direction: axis.direction });
    };

    panes.slice(0, -1).forEach((pane, index) => {
      const gutter = createSplitGutter(index + 1, axis.direction, rawOptions);
      gutter.style.setProperty('--pto-workbench-shell-gutter', `${gutterSize}px`);
      pane.after(gutter);
      rawOptions.onGutterCreate?.(gutter, { index, direction: axis.direction });

      const applyDelta = (startSizes, delta, event, phase) => {
        const nextPixels = resolvePairDelta(startSizes, index, delta, minSizes);
        const nextSizes = applyPixelSizesAsPercent(panes, axis, nextPixels);
        emit(phase, nextSizes, event);
        return nextSizes;
      };

      const onPointerDown = (event) => {
        if (event.button != null && event.button !== 0) return;
        event.preventDefault();
        gutter.setPointerCapture?.(event.pointerId);
        setResizeState(true, axis.direction);
        const startCoordinate = event[axis.coordinate];
        const startSizes = panePixelSizes(panes, axis);
        emit('start', panePercentSizes(panes, axis), event);

        const onMove = (moveEvent) => {
          const delta = moveEvent[axis.coordinate] - startCoordinate;
          applyDelta(startSizes, delta, moveEvent, 'drag');
        };

        const onUp = (upEvent) => {
          global.removeEventListener('pointermove', onMove);
          global.removeEventListener('pointerup', onUp);
          gutter.releasePointerCapture?.(upEvent.pointerId);
          setResizeState(false, axis.direction);
          const sizes = panePercentSizes(panes, axis);
          writeStoredSizes(rawOptions.storageKey, sizes);
          emit('end', sizes, upEvent);
        };

        global.addEventListener('pointermove', onMove);
        global.addEventListener('pointerup', onUp, { once: true });
      };

      const onKeyDown = (event) => {
        if (rawOptions.keyboard === false) return;
        const multiplier = event.shiftKey ? 4 : 1;
        let delta = 0;
        if (axis.negativeKeys.has(event.key)) delta = -keyboardStep * multiplier;
        if (axis.positiveKeys.has(event.key)) delta = keyboardStep * multiplier;
        if (!delta) return;
        event.preventDefault();
        const sizes = applyDelta(panePixelSizes(panes, axis), delta, event, 'drag');
        writeStoredSizes(rawOptions.storageKey, sizes);
        emit('end', sizes, event);
      };

      gutter.addEventListener('pointerdown', onPointerDown);
      gutter.addEventListener('keydown', onKeyDown);
      destroyFns.push(() => {
        gutter.removeEventListener('pointerdown', onPointerDown);
        gutter.removeEventListener('keydown', onKeyDown);
        gutter.remove();
      });
    });

    return {
      destroy() {
        setResizeState(false, axis.direction);
        destroyFns.splice(0).forEach((fn) => fn());
        panes.forEach((pane) => {
          pane.style.flex = '';
          pane.style.flexBasis = '';
          pane.style[axis.sizeStyle] = '';
        });
        if (parent) delete parent.dataset.splitDirection;
        if (root.dataset) delete root.dataset.splitDirection;
      },
      getSizes: () => panePercentSizes(panes, axis),
      setSizes(nextSizes) {
        const sizes = normalizeSizes(nextSizes, panes.length);
        applyPaneSizes(panes, axis, sizes);
        writeStoredSizes(rawOptions.storageKey, sizes);
        rawOptions.onResize?.(sizes, { phase: 'api', direction: axis.direction });
      },
      refresh() {
        rawOptions.onResize?.(panePercentSizes(panes, axis), {
          phase: 'refresh',
          direction: axis.direction,
        });
      },
    };
  }

  function initNestedResizablePanes(rawOptions = {}) {
    const configs = Array.isArray(rawOptions)
      ? rawOptions
      : (rawOptions.splits || []);
    const defaults = Array.isArray(rawOptions) ? {} : (rawOptions.defaults || {});
    const instances = configs.map((config) => initResizablePanes({ ...defaults, ...config }));
    return {
      instances,
      destroy() {
        instances.splice(0).forEach((instance) => instance.destroy());
      },
      getSizes() {
        return instances.map((instance) => instance.getSizes());
      },
      refresh() {
        instances.forEach((instance) => instance.refresh());
      },
    };
  }

  function initCanvasControls(rawOptions = {}) {
    const root = asElement(rawOptions.root) || document;
    const levels = rawOptions.levels || getZoomLevels(rawOptions);
    let zoomIndex = nearestZoomIndex(levels, rawOptions.defaultZoom ?? 1);
    let detailsVisible = rawOptions.detailsVisible ?? true;
    const detailToggle = asElement(rawOptions.detailToggle, root);
    const zoomOut = asElement(rawOptions.zoomOut, root);
    const zoomIn = asElement(rawOptions.zoomIn, root);
    const zoomReset = asElement(rawOptions.zoomReset, root);
    const zoomReadout = asElement(rawOptions.zoomReadout, root) || zoomReset;

    const apply = (source = 'sync') => {
      const zoom = levels[zoomIndex] || 1;
      rawOptions.onZoomChange?.(zoom, { source, zoomIndex, levels });
      rawOptions.onDetailChange?.(detailsVisible, { source });
      if (detailToggle) {
        detailToggle.textContent = detailsVisible
          ? (rawOptions.detailOnLabel || 'Details on')
          : (rawOptions.detailOffLabel || 'Details off');
        detailToggle.setAttribute('aria-pressed', detailsVisible ? 'true' : 'false');
      }
      if (zoomReadout) zoomReadout.textContent = `${Math.round(zoom * 100)}%`;
      if (zoomOut) zoomOut.disabled = zoomIndex <= 0;
      if (zoomIn) zoomIn.disabled = zoomIndex >= levels.length - 1;
    };

    const setZoom = (nextZoom, source = 'api') => {
      zoomIndex = nearestZoomIndex(levels, nextZoom);
      apply(source);
    };

    const listeners = [];
    const add = (node, type, handler) => {
      if (!node) return;
      node.addEventListener(type, handler);
      listeners.push(() => node.removeEventListener(type, handler));
    };

    add(detailToggle, 'click', () => {
      detailsVisible = !detailsVisible;
      apply('detail-toggle');
    });
    add(zoomOut, 'click', () => {
      zoomIndex = Math.max(0, zoomIndex - 1);
      apply('zoom-out');
    });
    add(zoomIn, 'click', () => {
      zoomIndex = Math.min(levels.length - 1, zoomIndex + 1);
      apply('zoom-in');
    });
    add(zoomReset, 'click', () => setZoom(rawOptions.resetZoom ?? 1, 'zoom-reset'));

    apply('init');

    return {
      destroy() {
        listeners.splice(0).forEach((fn) => fn());
      },
      getZoom: () => levels[zoomIndex] || 1,
      getDetailsVisible: () => detailsVisible,
      setZoom,
      setDetailsVisible(nextValue, source = 'api') {
        detailsVisible = Boolean(nextValue);
        apply(source);
      },
      refresh: apply,
    };
  }

  function createRafCallback(callback) {
    let frame = 0;
    return (...args) => {
      if (frame) global.cancelAnimationFrame(frame);
      frame = global.requestAnimationFrame(() => {
        frame = 0;
        callback?.(...args);
      });
    };
  }

  function initWorkbenchShell(rawOptions = {}) {
    const root = asElement(rawOptions.root) || document;
    const scheduleLayout = createRafCallback(rawOptions.onLayout);
    const resizable = initResizablePanes({
      root,
      panes: rawOptions.panes,
      direction: rawOptions.direction || 'horizontal',
      sizes: rawOptions.sizes,
      defaultSize: rawOptions.defaultSize,
      minSize: rawOptions.minSize,
      gutterSize: rawOptions.gutterSize,
      storageKey: rawOptions.storageKey,
      gutterClass: rawOptions.gutterClass,
      gutterLabel: rawOptions.gutterLabel,
      keyboard: rawOptions.keyboard,
      keyboardStep: rawOptions.keyboardStep,
      onDragStart: rawOptions.onDragStart,
      onDrag: (sizes, event) => {
        rawOptions.onDrag?.(sizes, event);
        scheduleLayout('drag');
      },
      onDragEnd: (sizes, event) => {
        rawOptions.onDragEnd?.(sizes, event);
        scheduleLayout('drag-end');
      },
    });

    const canvasControls = rawOptions.canvasControls
      ? initCanvasControls({
          ...rawOptions.canvasControls,
          root,
        })
      : null;

    let resizeObserver = null;
    if (rawOptions.observeResize !== false && 'ResizeObserver' in global) {
      resizeObserver = new ResizeObserver(() => scheduleLayout('resize'));
      resizeObserver.observe(root);
    }

    return {
      destroy() {
        resizable.destroy();
        canvasControls?.destroy();
        resizeObserver?.disconnect();
      },
      resizable,
      canvasControls,
      refreshLayout: scheduleLayout,
    };
  }

  global.PtoWorkbenchShell = {
    createSplitGutter,
    getZoomLevels,
    initCanvasControls,
    initNestedResizablePanes,
    initResizablePanes,
    initWorkbenchShell,
  };
})(window);

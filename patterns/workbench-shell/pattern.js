(function attachPtoWorkbenchShell(global) {
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

  const normalizePanes = (panes, root = document) =>
    (panes || []).map((pane) => asElement(pane, root)).filter(Boolean);

  const readStoredSizes = (key, fallback) => {
    if (!key) return fallback.slice();
    try {
      const value = JSON.parse(global.localStorage?.getItem(key) || 'null');
      if (Array.isArray(value) && value.length === fallback.length && value.every((item) => Number.isFinite(item) && item > 0)) {
        return value;
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
      // Storage may be unavailable in private previews. The live drag state still applies.
    }
  };

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

  function createGutter(index, direction, options = {}) {
    const gutter = document.createElement('div');
    gutter.className = options.gutterClass || 'pto-workbench-shell__split-gutter';
    gutter.dataset.splitIndex = String(index);
    gutter.dataset.splitDirection = direction;
    gutter.setAttribute('role', 'separator');
    gutter.setAttribute('aria-orientation', 'vertical');
    gutter.setAttribute('aria-label', options.gutterLabel || '调整相邻栏宽度');
    gutter.tabIndex = 0;
    return gutter;
  }

  function createSplitGutter(options = {}) {
    return createGutter(
      Number.isFinite(options.index) ? options.index : 1,
      options.direction || 'horizontal',
      {
        gutterClass: options.gutterClass || options.className,
        gutterLabel: options.gutterLabel || options.label,
      },
    );
  }

  function getPaneSizes(panes) {
    const widths = panes.map((pane) => pane.getBoundingClientRect().width);
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (total <= 0) return [];
    return widths.map((width) => width / total * 100);
  }

  function paneBasis(size, totalGutter) {
    const gutterShare = round(totalGutter * size / 100, 3);
    return `calc(${round(size, 3)}% - ${gutterShare}px)`;
  }

  function applyPaneSizes(panes, sizes, gutterSize = 0) {
    const totalGutter = gutterSize * Math.max(0, panes.length - 1);
    panes.forEach((pane, index) => {
      const basis = paneBasis(sizes[index], totalGutter);
      pane.style.width = basis;
      pane.style.flexBasis = basis;
    });
  }

  function initFallbackSplit(panes, options) {
    const sizes = options.sizes;
    const minSizes = options.minSize;
    const destroyFns = [];
    applyPaneSizes(panes, sizes, options.gutterSize);

    panes.slice(0, -1).forEach((pane, index) => {
      const gutter = createGutter(index + 1, 'horizontal', options);
      pane.after(gutter);

      const onPointerDown = (event) => {
        event.preventDefault();
        gutter.setPointerCapture?.(event.pointerId);
        document.body.classList.add(options.resizingClass);
        options.onDragStart?.(getPaneSizes(panes), event);

        const startX = event.clientX;
        const startWidths = panes.map((item) => item.getBoundingClientRect().width);
        const totalWidth = startWidths.reduce((sum, width) => sum + width, 0);
        const leftIndex = index;
        const rightIndex = index + 1;

        const onMove = (moveEvent) => {
          const dx = moveEvent.clientX - startX;
          let leftWidth = startWidths[leftIndex] + dx;
          let rightWidth = startWidths[rightIndex] - dx;
          const leftMin = minSizes[leftIndex] || 0;
          const rightMin = minSizes[rightIndex] || 0;

          if (leftWidth < leftMin) {
            rightWidth -= leftMin - leftWidth;
            leftWidth = leftMin;
          }
          if (rightWidth < rightMin) {
            leftWidth -= rightMin - rightWidth;
            rightWidth = rightMin;
          }

          const totalGutter = options.gutterSize * Math.max(0, panes.length - 1);
          const nextLeftSize = clamp(leftWidth, leftMin, totalWidth) / totalWidth * 100;
          const nextRightSize = clamp(rightWidth, rightMin, totalWidth) / totalWidth * 100;
          panes[leftIndex].style.width = paneBasis(nextLeftSize, totalGutter);
          panes[leftIndex].style.flexBasis = panes[leftIndex].style.width;
          panes[rightIndex].style.width = paneBasis(nextRightSize, totalGutter);
          panes[rightIndex].style.flexBasis = panes[rightIndex].style.width;
          options.onDrag?.(getPaneSizes(panes), moveEvent);
        };

        const onUp = (upEvent) => {
          global.removeEventListener('pointermove', onMove);
          global.removeEventListener('pointerup', onUp);
          document.body.classList.remove(options.resizingClass);
          const nextSizes = getPaneSizes(panes);
          writeStoredSizes(options.storageKey, nextSizes);
          options.onDragEnd?.(nextSizes, upEvent);
        };

        global.addEventListener('pointermove', onMove);
        global.addEventListener('pointerup', onUp, { once: true });
      };

      gutter.addEventListener('pointerdown', onPointerDown);
      destroyFns.push(() => {
        gutter.removeEventListener('pointerdown', onPointerDown);
        gutter.remove();
      });
    });

    return {
      destroy() {
        destroyFns.splice(0).forEach((fn) => fn());
        panes.forEach((pane) => {
          pane.style.width = '';
          pane.style.flexBasis = '';
        });
      },
      getSizes: () => getPaneSizes(panes),
    };
  }

  function initResizablePanes(rawOptions = {}) {
    const root = asElement(rawOptions.root) || document;
    const panes = normalizePanes(rawOptions.panes, root);
    if (panes.length < 2) {
      return { destroy() {}, getSizes: () => [] };
    }

    const fallbackSizes = rawOptions.sizes || panes.map(() => 100 / panes.length);
    const options = {
      sizes: readStoredSizes(rawOptions.storageKey, fallbackSizes),
      minSize: rawOptions.minSize || panes.map(() => 220),
      gutterSize: rawOptions.gutterSize || 12,
      gutterClass: rawOptions.gutterClass,
      gutterLabel: rawOptions.gutterLabel,
      storageKey: rawOptions.storageKey,
      resizingClass: rawOptions.resizingClass || 'pto-is-pane-resizing',
      onDragStart: rawOptions.onDragStart,
      onDrag: rawOptions.onDrag,
      onDragEnd: rawOptions.onDragEnd,
    };

    root.style?.setProperty?.('--pto-workbench-shell-gutter', `${options.gutterSize}px`);

    if (typeof global.Split === 'function') {
      const split = global.Split(panes, {
        sizes: options.sizes,
        minSize: options.minSize,
        gutterSize: options.gutterSize,
        snapOffset: rawOptions.snapOffset ?? 0,
        cursor: 'col-resize',
        gutter: (index, direction) => createGutter(index, direction, options),
        onDragStart: (sizes) => {
          document.body.classList.add(options.resizingClass);
          options.onDragStart?.(sizes);
        },
        onDrag: (sizes) => {
          options.onDrag?.(sizes);
        },
        onDragEnd: (sizes) => {
          document.body.classList.remove(options.resizingClass);
          writeStoredSizes(options.storageKey, sizes);
          options.onDragEnd?.(sizes);
        },
      });
      return {
        destroy() {
          document.body.classList.remove(options.resizingClass);
          split.destroy();
        },
        getSizes: () => getPaneSizes(panes),
      };
    }

    return initFallbackSplit(panes, options);
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
        detailToggle.textContent = detailsVisible ? (rawOptions.detailOnLabel || '细节开') : (rawOptions.detailOffLabel || '细节关');
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
      sizes: rawOptions.sizes,
      minSize: rawOptions.minSize,
      gutterSize: rawOptions.gutterSize,
      storageKey: rawOptions.storageKey,
      gutterClass: rawOptions.gutterClass,
      gutterLabel: rawOptions.gutterLabel,
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

  const api = {
    getZoomLevels,
    createSplitGutter,
    initResizablePanes,
    initCanvasControls,
    initWorkbenchShell,
  };
  global.PtoWorkbenchShell = api;
  global.PtoWorkbenchShellPattern = global.PtoWorkbenchShellPattern || api;
})(window);

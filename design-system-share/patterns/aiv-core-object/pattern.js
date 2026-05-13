(function registerPtoAivCorePattern(global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ROUTE_COLORS = {
    memory: '#4d97ff',
    compute: '#29c7a6',
    cache: '#a4b0bd',
    control: '#ff9a54',
  };

  const PRESETS = {
    aivOfficialV1: {
      id: 'aivOfficialV1',
      name: 'AIV Core Object',
      title: 'AIV',
      routes: [
        { from: 'cache:DCache', to: 'buffer:UB', color: 'cache', style: 'elbow-h', fromSide: 'right', toSide: 'left', toBias: 0.60 },
        { from: 'cache:ICache', to: 'exec:SIMT', color: 'cache', style: 'elbow-h', fromSide: 'right', toSide: 'top', fromBias: 0.38, toBias: 0.14, dashArray: '4 3', offset: -12 },
        { from: 'cache:ICache', to: 'exec:SIMD', color: 'cache', style: 'elbow-h', fromSide: 'right', toSide: 'top', fromBias: 0.62, toBias: 0.14, dashArray: '4 3', offset: -12 },
        { from: 'scalar:Scalar', to: 'exec:SIMT', color: 'control', style: 'elbow-h', fromSide: 'right', toSide: 'top', fromBias: 0.5, toBias: 0.26 },
        { from: 'scalar:Scalar', to: 'exec:SIMD', color: 'control', style: 'elbow-h', fromSide: 'right', toSide: 'top', fromBias: 0.5, toBias: 0.72 },
        { from: 'buffer:UB', to: 'exec:SIMD', color: 'memory', style: 'elbow-h', fromSide: 'right', toSide: 'left', fromBias: 0.64, toBias: 0.78, offset: 6 },
        { from: 'buffer:UB', to: 'exec:SIMT', color: 'memory', style: 'elbow-h', fromSide: 'right', toSide: 'left', fromBias: 0.42, toBias: 0.82, dashArray: '6 4', offset: 14 },
        { from: 'exec:SIMT', to: 'vector:Vector', color: 'compute', style: 'horizontal', fromSide: 'right', toSide: 'left', fromBias: 0.5 },
        { from: 'exec:SIMD', to: 'vector:Vector', color: 'compute', style: 'horizontal', fromSide: 'right', toSide: 'left', fromBias: 0.5 }
      ],
      layout: {
        kind: 'group',
        className: 'pto-aiv-core__layout',
        children: [
          {
            kind: 'group',
            className: 'pto-aiv-core__cache-stack',
            children: [
              {
                kind: 'cache',
                label: 'DCache',
                grid: { rows: 4, cols: 12, cellSize: 12, gap: 1 }
              },
              {
                kind: 'cache',
                label: 'ICache',
                grid: { rows: 4, cols: 12, cellSize: 12, gap: 1 }
              }
            ]
          },
          {
            kind: 'group',
            className: 'pto-aiv-core__center-stack',
            children: [
              {
                kind: 'scalar',
                label: 'Scalar',
                frame: { width: 286, height: 72 }
              },
              {
                kind: 'buffer',
                key: 'UB',
                label: 'UB',
                capacity: '64kb',
                grid: { rows: 8, cols: 19, cellSize: 12, gap: 1, band: { from: 8, to: 9 } }
              }
            ]
          },
          {
            kind: 'group',
            className: 'pto-aiv-core__exec-stack',
            children: [
              {
                kind: 'exec',
                label: 'SIMT',
                chipLabel: 'Warp Scheduler',
                chipTone: 'control',
                grid: { rows: 3, cols: 13, cellSize: 12, gap: 1, band: { from: 5, to: 6 } }
              },
              {
                kind: 'exec',
                label: 'SIMD',
                chipLabel: 'Aux Scalar',
                chipTone: 'compute',
                grid: { rows: 3, cols: 13, cellSize: 12, gap: 1, band: { from: 5, to: 6 } }
              }
            ]
          },
          {
            kind: 'vector',
            label: 'Vector',
            frame: { width: 114, height: 232 }
          }
        ]
      }
    }
  };

  function resolvePreset(presetOrKey) {
    if (typeof presetOrKey === 'string') return PRESETS[presetOrKey] || null;
    return presetOrKey || null;
  }

  function node(tagName, className, textContent) {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    if (textContent !== undefined) el.textContent = textContent;
    return el;
  }

  function svgNode(tagName, attrs) {
    const el = document.createElementNS(SVG_NS, tagName);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      el.setAttribute(key, value);
    });
    return el;
  }

  function applyFrameStyle(el, frame) {
    if (!frame) return;
    if (frame.width != null) el.style.width = `${frame.width}px`;
    if (frame.height != null) el.style.height = `${frame.height}px`;
    if (frame.minWidth != null) el.style.minWidth = `${frame.minWidth}px`;
    if (frame.minHeight != null) el.style.minHeight = `${frame.minHeight}px`;
  }

  function gridContentWidth(gridConfig) {
    const cols = Math.max(1, Number(gridConfig?.cols || 8));
    const cellSize = Number(gridConfig?.cellSize || 12);
    const gap = Number(gridConfig?.gap || 1);
    return cols * cellSize + Math.max(0, cols - 1) * gap;
  }

  function buildGrid(gridConfig, tone) {
    const grid = node('div', `pto-aiv-core__grid pto-aiv-core__grid--${tone}`);
    const rows = Math.max(1, Number(gridConfig?.rows || 4));
    const cols = Math.max(1, Number(gridConfig?.cols || 8));
    const cellSize = Number(gridConfig?.cellSize || 12);
    const gap = Number(gridConfig?.gap || 1);
    const band = gridConfig?.band || null;

    grid.style.setProperty('--pto-aiv-grid-cols', String(cols));
    grid.style.setProperty('--pto-aiv-grid-cell-size', `${cellSize}px`);
    grid.style.setProperty('--pto-aiv-grid-gap', `${gap}px`);

    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      for (let colIndex = 0; colIndex < cols; colIndex += 1) {
        const cell = node('span', `pto-aiv-core__cell pto-aiv-core__cell--${tone}`);
        if (band && colIndex >= band.from && colIndex <= band.to) {
          cell.classList.add('is-band');
        }
        grid.appendChild(cell);
      }
    }

    return grid;
  }

  function buildCache(cacheConfig) {
    const card = node('section', 'pto-aiv-core__cache');
    card.dataset.aivNode = `cache:${cacheConfig.label || 'Cache'}`;
    const width = gridContentWidth(cacheConfig.grid) + 28;
    card.style.width = `${width}px`;
    applyFrameStyle(card, cacheConfig.frame);
    card.appendChild(node('span', 'pto-aiv-core__cache-label', cacheConfig.label || 'Cache'));
    card.appendChild(buildGrid(cacheConfig.grid, 'cache'));
    return card;
  }

  function buildScalarBar(scalarConfig) {
    const bar = node('section', 'pto-aiv-core__scalar');
    bar.dataset.aivNode = `scalar:${scalarConfig.label || 'Scalar'}`;
    applyFrameStyle(bar, scalarConfig.frame);
    bar.appendChild(node('span', 'pto-aiv-core__scalar-label', scalarConfig.label || 'Scalar'));
    return bar;
  }

  function buildBuffer(bufferConfig) {
    const card = node('section', 'pto-aiv-core__buffer');
    card.dataset.aivNode = `buffer:${bufferConfig.key || bufferConfig.label || ''}`;

    const header = node('header', 'pto-aiv-core__buffer-header');
    header.appendChild(node('span', 'pto-aiv-core__buffer-label', bufferConfig.label || ''));
    header.appendChild(node('span', 'pto-aiv-core__buffer-capacity', bufferConfig.capacity || ''));
    const width = gridContentWidth(bufferConfig.grid) + 28;
    card.style.width = `${width}px`;
    applyFrameStyle(card, bufferConfig.frame);
    card.appendChild(header);
    card.appendChild(buildGrid(bufferConfig.grid, 'memory'));

    return card;
  }

  function buildExecCard(execConfig) {
    const card = node('section', 'pto-aiv-core__exec');
    card.dataset.aivNode = `exec:${execConfig.label || 'Exec'}`;

    const header = node('header', 'pto-aiv-core__exec-header');
    header.appendChild(node('span', 'pto-aiv-core__exec-label', execConfig.label || 'Exec'));
    if (execConfig.chipLabel) {
      header.appendChild(node('span', `pto-aiv-core__exec-chip is-${execConfig.chipTone || 'control'}`, execConfig.chipLabel));
    }
    const width = gridContentWidth(execConfig.grid) + 28;
    card.style.width = `${width}px`;
    applyFrameStyle(card, execConfig.frame);
    card.appendChild(header);
    card.appendChild(buildGrid(execConfig.grid, 'memory'));
    return card;
  }

  function buildVector(vectorConfig) {
    const card = node('section', 'pto-aiv-core__vector');
    card.dataset.aivNode = `vector:${vectorConfig.label || 'Vector'}`;
    applyFrameStyle(card, vectorConfig.frame);
    card.appendChild(node('span', 'pto-aiv-core__vector-label', vectorConfig.label || 'Vector'));
    return card;
  }

  const COLUMN_SELECTOR = '.pto-aiv-core__cache-stack, .pto-aiv-core__center-stack, .pto-aiv-core__exec-stack';

  function resolveLaneX(root, fromEl, toEl) {
    const rootRect = root.getBoundingClientRect();
    const fromColumn = fromEl.closest(COLUMN_SELECTOR) || fromEl;
    const toColumn = toEl.closest(COLUMN_SELECTOR) || toEl;
    if (fromColumn === toColumn) return null;
    const fromRight = fromColumn.getBoundingClientRect().right - rootRect.left;
    const toLeft = toColumn.getBoundingClientRect().left - rootRect.left;
    if (fromRight < toLeft) return (fromRight + toLeft) / 2;
    const fromLeft = fromColumn.getBoundingClientRect().left - rootRect.left;
    const toRight = toColumn.getBoundingClientRect().right - rootRect.left;
    if (toRight < fromLeft) return (toRight + fromLeft) / 2;
    return null;
  }

  function edgePoint(root, nodeEl, side, bias) {
    const rootRect = root.getBoundingClientRect();
    const rect = nodeEl.getBoundingClientRect();
    const cx = rect.left - rootRect.left + rect.width / 2;
    const cy = rect.top - rootRect.top + rect.height / 2;
    const biasRatio = Math.max(0, Math.min(1, Number.isFinite(bias) ? bias : 0.5));
    const xAtBias = rect.left - rootRect.left + rect.width * biasRatio;
    const yAtBias = rect.top - rootRect.top + rect.height * biasRatio;
    if (side === 'left') return { x: rect.left - rootRect.left, y: yAtBias };
    if (side === 'right') return { x: rect.right - rootRect.left, y: yAtBias };
    if (side === 'top') return { x: xAtBias, y: rect.top - rootRect.top };
    if (side === 'bottom') return { x: xAtBias, y: rect.bottom - rootRect.top };
    return { x: cx, y: cy };
  }

  function routePath(fromPoint, toPoint, route, laneX, corridorY) {
    if (route.style === 'horizontal') {
      return `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${fromPoint.y}`;
    }

    if (route.style === 'straight') {
      if (Math.abs(fromPoint.y - toPoint.y) < 0.5 || Math.abs(fromPoint.x - toPoint.x) < 0.5) {
        return `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
      }
      return `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
    }

    if (route.style === 'elbow-v') {
      const midY = fromPoint.y + (toPoint.y - fromPoint.y) / 2;
      return `M ${fromPoint.x} ${fromPoint.y} L ${fromPoint.x} ${midY} L ${toPoint.x} ${midY} L ${toPoint.x} ${toPoint.y}`;
    }

    const offset = Number.isFinite(route.offset) ? route.offset : 0;

    if (route.style === 'detour' && Number.isFinite(corridorY)) {
      const riseX = toPoint.x - 20 + offset;
      return `M ${fromPoint.x} ${fromPoint.y} L ${fromPoint.x} ${corridorY} L ${riseX} ${corridorY} L ${riseX} ${toPoint.y} L ${toPoint.x} ${toPoint.y}`;
    }

    const toSide = route.toSide || 'left';
    if (toSide === 'top' || toSide === 'bottom') {
      const apexY = toSide === 'top' ? toPoint.y - 14 : toPoint.y + 14;
      const exitX = fromPoint.x + (fromPoint.x < toPoint.x ? 14 : -14);
      return `M ${fromPoint.x} ${fromPoint.y} L ${exitX} ${fromPoint.y} L ${exitX} ${apexY} L ${toPoint.x} ${apexY} L ${toPoint.x} ${toPoint.y}`;
    }

    const midX = (Number.isFinite(laneX) ? laneX : fromPoint.x + (toPoint.x - fromPoint.x) / 2) + offset;
    return `M ${fromPoint.x} ${fromPoint.y} L ${midX} ${fromPoint.y} L ${midX} ${toPoint.y} L ${toPoint.x} ${toPoint.y}`;
  }

  function createOverlay(stage, preset) {
    const svg = svgNode('svg', { class: 'pto-aiv-core__overlay', viewBox: '0 0 10 10', preserveAspectRatio: 'none' });
    const defs = svgNode('defs');
    Object.entries(ROUTE_COLORS).forEach(([key, color]) => {
      const marker = svgNode('marker', {
        id: `pto-aiv-arrow-${key}`,
        markerWidth: '8',
        markerHeight: '8',
        refX: '7',
        refY: '4',
        orient: 'auto',
      });
      marker.appendChild(svgNode('path', {
        d: 'M1,1 L7,4 L1,7',
        fill: 'none',
        stroke: color,
        'stroke-width': '1.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }));
      defs.appendChild(marker);
    });
    svg.appendChild(defs);

    const routeEls = (preset.routes || []).map((route) => {
      const path = svgNode('path', {
        class: 'pto-aiv-core__route',
        fill: 'none',
        'stroke-width': route.strokeWidth || '1.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      });
      svg.appendChild(path);
      return { route, path };
    });

    stage.appendChild(svg);

    function update() {
      const rect = stage.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);

      const stageRect = stage.getBoundingClientRect();
      const centerStack = stage.querySelector('.pto-aiv-core__center-stack');
      const centerBottom = centerStack
        ? centerStack.getBoundingClientRect().bottom - stageRect.top
        : null;

      routeEls.forEach(({ route, path }) => {
        const fromEl = stage.querySelector(`[data-aiv-node="${route.from}"]`);
        const toEl = stage.querySelector(`[data-aiv-node="${route.to}"]`);
        if (!fromEl || !toEl) return;

        const fromPoint = edgePoint(stage, fromEl, route.fromSide || 'right', route.fromBias);
        const toPoint = edgePoint(stage, toEl, route.toSide || 'left', route.toBias);
        const laneX = resolveLaneX(stage, fromEl, toEl);
        const corridorY = route.corridor === 'below-center' && Number.isFinite(centerBottom)
          ? centerBottom + 14 + (Number.isFinite(route.corridorOffset) ? route.corridorOffset : 0)
          : null;
        const color = ROUTE_COLORS[route.color] || ROUTE_COLORS.memory;

        path.setAttribute('d', routePath(fromPoint, toPoint, route, laneX, corridorY));
        path.setAttribute('stroke', color);
        path.setAttribute('marker-end', `url(#pto-aiv-arrow-${route.color || 'memory'})`);
        if (route.dashArray) {
          path.setAttribute('stroke-dasharray', route.dashArray);
        } else {
          path.removeAttribute('stroke-dasharray');
        }
      });
    }

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(update)
      : null;
    resizeObserver?.observe(stage);
    stage.querySelectorAll('[data-aiv-node]').forEach((el) => resizeObserver?.observe(el));
    requestAnimationFrame(() => requestAnimationFrame(update));
    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
      document.fonts.ready.then(update);
    }

    return {
      svg,
      update,
      destroy() {
        resizeObserver?.disconnect();
        svg.remove();
      },
    };
  }

  function buildGroup(groupConfig) {
    const group = node('div', groupConfig.className || '');
    (groupConfig.children || []).forEach((child) => group.appendChild(buildColumn(child)));
    return group;
  }

  function buildColumn(columnConfig) {
    if (columnConfig.kind === 'cache') return buildCache(columnConfig);
    if (columnConfig.kind === 'scalar') return buildScalarBar(columnConfig);
    if (columnConfig.kind === 'buffer') return buildBuffer(columnConfig);
    if (columnConfig.kind === 'exec') return buildExecCard(columnConfig);
    if (columnConfig.kind === 'vector') return buildVector(columnConfig);
    if (columnConfig.kind === 'group') return buildGroup(columnConfig);
    return node('div', '', '');
  }

  function render(container, presetOrKey) {
    const preset = resolvePreset(presetOrKey);
    if (!container || !preset) return null;

    container.innerHTML = '';
    const stage = node('section', 'pto-aiv-core');
    stage.dataset.ptoAivCore = preset.id;

    stage.appendChild(node('h2', 'pto-aiv-core__title', preset.title || 'AIV'));
    stage.appendChild(buildColumn(preset.layout));
    const overlay = createOverlay(stage, preset);

    container.appendChild(stage);
    return { container, preset, stage, overlay };
  }

  global.PtoAivCorePattern = {
    presets: PRESETS,
    resolvePreset,
    render,
  };
})(window);

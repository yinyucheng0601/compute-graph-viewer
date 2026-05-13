(function registerPtoAicCorePattern(global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ROUTE_COLORS = {
    memory: '#4d97ff',
    compute: '#29c7a6',
    cache: '#a4b0bd',
    transport: '#ffcf59',
    control: '#ff9a54',
  };

  const PRESETS = {
    aicDraftV1: {
      id: 'aicDraftV1',
      name: 'AIC Core Object Draft',
      title: 'AIC',
      stageClassName: 'pto-aic-core--draft',
      routes: [
        { from: 'buffer:L1', to: 'buffer:L0A', color: 'transport', style: 'lane-h', fromSide: 'right', toSide: 'left' },
        { from: 'buffer:L1', to: 'buffer:L0B', color: 'transport', style: 'lane-h', fromSide: 'right', toSide: 'left' },
        { from: 'buffer:L1', to: 'buffer:BT', color: 'transport', style: 'lane-h', fromSide: 'right', toSide: 'left' },
        { from: 'buffer:L1', to: 'buffer:FP', color: 'transport', style: 'lane-h', fromSide: 'right', toSide: 'left' },
        { from: 'buffer:L0A', to: 'cube:CUBE', color: 'transport', style: 'elbow-h', fromSide: 'right', toSide: 'left' },
        { from: 'buffer:L0B', to: 'cube:CUBE', color: 'transport', style: 'elbow-h', fromSide: 'right', toSide: 'left' },
        { from: 'buffer:BT', to: 'cube:CUBE', color: 'transport', style: 'elbow-h', fromSide: 'right', toSide: 'left' },
        { from: 'cube:CUBE', to: 'buffer:L0C', color: 'transport', style: 'elbow-h', fromSide: 'right', toSide: 'left' },
        { from: 'buffer:FP', to: 'scheduler:Dispatch', color: 'transport', style: 'elbow-v', fromSide: 'bottom', toSide: 'top' },
        { from: 'cache:DCache', to: 'scalar:Scalar', color: 'cache', style: 'lane-h', fromSide: 'right', toSide: 'left' },
        { from: 'cache:ICache', to: 'scalar:Scalar', color: 'cache', style: 'lane-h', fromSide: 'right', toSide: 'left' },
        { from: 'scalar:Scalar', to: 'scheduler:Dispatch', color: 'control', style: 'straight', fromSide: 'right', toSide: 'left' },
        { from: 'scheduler:Dispatch', to: 'queue:Cube Queue', color: 'control', style: 'elbow-h', fromSide: 'right', toSide: 'left', dashArray: '4 3' },
        { from: 'scheduler:Dispatch', to: 'queue:FixPipe Queue', color: 'control', style: 'elbow-h', fromSide: 'right', toSide: 'left', dashArray: '4 3' },
        { from: 'scheduler:Dispatch', to: 'queue:MTE1 Queue', color: 'control', style: 'elbow-h', fromSide: 'right', toSide: 'left', dashArray: '4 3' },
        { from: 'scheduler:Dispatch', to: 'queue:MTE2 Queue', color: 'control', style: 'elbow-h', fromSide: 'right', toSide: 'left', dashArray: '4 3' }
      ],
      layout: {
        kind: 'group',
        className: 'pto-aic-core__layout',
        children: [
          {
            kind: 'group',
            className: 'pto-aic-core__top-row',
            children: [
              {
                kind: 'buffer',
                key: 'L1',
                label: 'L1',
                capacity: '512kb',
                grid: { rows: 26, cols: 10, cellSize: 12, gap: 1, band: { from: 4, to: 5 } },
              },
              {
                kind: 'group',
                className: 'pto-aic-core__transport-stack',
                children: [
                  {
                    kind: 'buffer-lane',
                    transport: 'MTE1',
                    buffer: {
                      kind: 'buffer',
                      key: 'L0A',
                      label: 'L0A',
                      capacity: '64kb',
                      grid: { rows: 4, cols: 10, cellSize: 12, gap: 1, band: { from: 4, to: 5 } },
                    },
                  },
                  {
                    kind: 'buffer-lane',
                    transport: 'MTE1',
                    buffer: {
                      kind: 'buffer',
                      key: 'L0B',
                      label: 'L0B',
                      capacity: '64kb',
                      grid: { rows: 4, cols: 10, cellSize: 12, gap: 1, band: { from: 4, to: 5 } },
                    },
                  },
                  {
                    kind: 'buffer-lane',
                    transport: 'MTE1',
                    buffer: {
                      kind: 'buffer',
                      key: 'BT',
                      label: 'BT',
                      capacity: '64kb',
                      grid: { rows: 4, cols: 10, cellSize: 12, gap: 1, band: { from: 4, to: 5 } },
                    },
                  },
                  {
                    kind: 'buffer-lane',
                    transport: 'FixPipe',
                    buffer: {
                      kind: 'buffer',
                      key: 'FP',
                      label: 'FP',
                      capacity: '64kb',
                      grid: { rows: 4, cols: 10, cellSize: 12, gap: 1, band: { from: 4, to: 5 } },
                    },
                  },
                ],
              },
              {
                kind: 'cube',
                label: 'CUBE',
                frame: { width: 142, height: 142 },
              },
              {
                kind: 'buffer',
                key: 'L0C',
                label: 'L0C',
                capacity: '512kb',
                grid: { rows: 16, cols: 10, cellSize: 12, gap: 1, band: { from: 6, to: 7 } },
              },
            ],
          },
          {
            kind: 'group',
            className: 'pto-aic-core__bottom-row',
            children: [
              {
                kind: 'group',
                className: 'pto-aic-core__cache-stack',
                children: [
                  { kind: 'cache', label: 'DCache', frame: { width: 92, height: 36 } },
                  { kind: 'cache', label: 'ICache', frame: { width: 92, height: 36 } },
                ],
              },
              {
                kind: 'scalar',
                label: 'Scalar',
                frame: { width: 86, height: 78 },
              },
              {
                kind: 'scheduler',
                label: 'Dispatch',
                frame: { width: 62, height: 62 },
              },
              {
                kind: 'queue-stack',
                className: 'pto-aic-core__queue-stack',
                items: [
                  { kind: 'queue', label: 'Cube Queue', frame: { width: 112, height: 28 } },
                  { kind: 'queue', label: 'FixPipe Queue', frame: { width: 112, height: 28 } },
                  { kind: 'queue', label: 'MTE1 Queue', frame: { width: 112, height: 28 } },
                  { kind: 'queue', label: 'MTE2 Queue', frame: { width: 112, height: 28 } },
                ],
              },
            ],
          },
        ],
      },
    },
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

  function keyFromLabel(label) {
    return String(label || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function applyFrameStyle(el, frame) {
    if (!frame) return;
    if (frame.width != null) el.style.width = `${frame.width}px`;
    if (frame.height != null) el.style.height = `${frame.height}px`;
    if (frame.minWidth != null) el.style.minWidth = `${frame.minWidth}px`;
    if (frame.minHeight != null) el.style.minHeight = `${frame.minHeight}px`;
  }

  function buildGrid(gridConfig) {
    const grid = node('div', 'pto-aic-core__grid');
    const rows = Math.max(1, Number(gridConfig?.rows || 8));
    const cols = Math.max(1, Number(gridConfig?.cols || 8));
    const cellSize = Number(gridConfig?.cellSize || 18);
    const gap = Number(gridConfig?.gap || 3);
    const band = gridConfig?.band || null;

    grid.style.setProperty('--pto-aic-grid-cols', String(cols));
    grid.style.setProperty('--pto-aic-grid-cell-size', `${cellSize}px`);
    grid.style.setProperty('--pto-aic-grid-gap', `${gap}px`);

    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      for (let colIndex = 0; colIndex < cols; colIndex += 1) {
        const cell = node('span', 'pto-aic-core__cell');
        if (band && colIndex >= band.from && colIndex <= band.to) {
          cell.classList.add('is-band');
        }
        grid.appendChild(cell);
      }
    }

    return grid;
  }

  function buildBuffer(bufferConfig) {
    const card = node('section', 'pto-aic-core__buffer');
    card.dataset.bufferKey = bufferConfig.key || bufferConfig.label || '';
    card.dataset.aicNode = `buffer:${bufferConfig.key || bufferConfig.label || ''}`;

    const header = node('header', 'pto-aic-core__buffer-header');
    header.appendChild(node('span', 'pto-aic-core__buffer-label', bufferConfig.label || ''));
    header.appendChild(node('span', 'pto-aic-core__buffer-capacity', bufferConfig.capacity || ''));
    const grid = buildGrid(bufferConfig.grid);
    const gridCols = Math.max(1, Number(bufferConfig.grid?.cols || 8));
    const cellSize = Number(bufferConfig.grid?.cellSize || 18);
    const gap = Number(bufferConfig.grid?.gap || 3);
    const gridWidth = gridCols * cellSize + Math.max(0, gridCols - 1) * gap;
    const horizontalPadding = 20;

    card.style.width = `${gridWidth + horizontalPadding}px`;
    applyFrameStyle(card, bufferConfig.frame);
    card.appendChild(header);
    card.appendChild(grid);

    return card;
  }

  function buildCache(cacheConfig) {
    const card = node('section', 'pto-aic-core__cache');
    card.dataset.aicNode = `cache:${cacheConfig.label || 'Cache'}`;
    applyFrameStyle(card, cacheConfig.frame);
    card.appendChild(node('span', 'pto-aic-core__cache-label', cacheConfig.label || 'Cache'));
    return card;
  }

  function buildTransportPill(label) {
    const pill = node('span', 'pto-aic-core__transport-pill', label || '');
    return pill;
  }

  function buildBufferLane(laneConfig) {
    const lane = node('div', 'pto-aic-core__buffer-lane');
    lane.appendChild(buildTransportPill(laneConfig.transport));
    lane.appendChild(buildColumn(laneConfig.buffer));
    return lane;
  }

  function buildCube(cubeConfig) {
    const cube = node('section', 'pto-aic-core__cube');
    cube.dataset.aicNode = `cube:${cubeConfig.label || 'CUBE'}`;
    applyFrameStyle(cube, cubeConfig.frame);
    cube.appendChild(node('span', 'pto-aic-core__cube-label', cubeConfig.label || 'CUBE'));
    return cube;
  }

  function buildScalar(scalarConfig) {
    const scalar = node('section', 'pto-aic-core__scalar');
    scalar.dataset.aicNode = `scalar:${scalarConfig.label || 'Scalar'}`;
    applyFrameStyle(scalar, scalarConfig.frame);
    scalar.appendChild(node('span', 'pto-aic-core__scalar-label', scalarConfig.label || 'Scalar'));
    return scalar;
  }

  function buildScheduler(schedulerConfig) {
    const scheduler = node('section', 'pto-aic-core__scheduler');
    scheduler.dataset.aicNode = `scheduler:${schedulerConfig.label || 'Dispatch'}`;
    applyFrameStyle(scheduler, schedulerConfig.frame);
    scheduler.appendChild(node('span', 'pto-aic-core__scheduler-label', schedulerConfig.label || 'Dispatch'));
    return scheduler;
  }

  function buildQueue(queueConfig) {
    const queue = node('section', 'pto-aic-core__queue');
    queue.dataset.aicNode = `queue:${queueConfig.label || 'Queue'}`;
    applyFrameStyle(queue, queueConfig.frame);
    queue.appendChild(node('span', 'pto-aic-core__queue-label', queueConfig.label || 'Queue'));
    return queue;
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

  function routePath(fromPoint, toPoint, route) {
    if (route.style === 'lane-h') {
      return `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
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

    const midX = fromPoint.x + (toPoint.x - fromPoint.x) / 2;
    return `M ${fromPoint.x} ${fromPoint.y} L ${midX} ${fromPoint.y} L ${midX} ${toPoint.y} L ${toPoint.x} ${toPoint.y}`;
  }

  function createOverlay(stage, preset) {
    const svg = svgNode('svg', { class: 'pto-aic-core__overlay', viewBox: '0 0 10 10', preserveAspectRatio: 'none' });
    const defs = svgNode('defs');
    Object.entries(ROUTE_COLORS).forEach(([key, color]) => {
      const marker = svgNode('marker', {
        id: `pto-aic-arrow-${key}`,
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
        class: 'pto-aic-core__route',
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

      routeEls.forEach(({ route, path }) => {
        const fromEl = stage.querySelector(`[data-aic-node="${route.from}"]`);
        const toEl = stage.querySelector(`[data-aic-node="${route.to}"]`);
        if (!fromEl || !toEl) return;

        const fromPoint = edgePoint(stage, fromEl, route.fromSide || 'right', route.fromBias);
        const toPoint = edgePoint(stage, toEl, route.toSide || 'left', route.toBias);
        const color = ROUTE_COLORS[route.color] || ROUTE_COLORS.transport;
        const resolvedFromPoint = route.style === 'lane-h'
          ? { x: fromPoint.x, y: toPoint.y }
          : fromPoint;

        path.setAttribute('d', routePath(resolvedFromPoint, toPoint, route));
        path.setAttribute('stroke', color);
        path.setAttribute('marker-end', `url(#pto-aic-arrow-${route.color || 'transport'})`);
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
    requestAnimationFrame(update);

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
    if (columnConfig.kind === 'buffer') return buildBuffer(columnConfig);
    if (columnConfig.kind === 'cache') return buildCache(columnConfig);
    if (columnConfig.kind === 'buffer-lane') return buildBufferLane(columnConfig);
    if (columnConfig.kind === 'cube') return buildCube(columnConfig);
    if (columnConfig.kind === 'scalar') return buildScalar(columnConfig);
    if (columnConfig.kind === 'scheduler') return buildScheduler(columnConfig);
    if (columnConfig.kind === 'queue') return buildQueue(columnConfig);
    if (columnConfig.kind === 'group') return buildGroup(columnConfig);
    return node('div', '', '');
  }

  function render(container, presetOrKey) {
    const preset = resolvePreset(presetOrKey);
    if (!container || !preset) return null;

    container.innerHTML = '';
    const stage = node('section', `pto-aic-core ${preset.stageClassName || ''}`.trim());
    stage.dataset.ptoAicCore = preset.id;

    stage.appendChild(node('h2', 'pto-aic-core__title', preset.title || 'AIC'));
    stage.appendChild(buildColumn(preset.layout));
    const overlay = createOverlay(stage, preset);

    container.appendChild(stage);
    return { container, preset, stage, overlay };
  }

  global.PtoAicCorePattern = {
    presets: PRESETS,
    resolvePreset,
    render,
  };
})(window);

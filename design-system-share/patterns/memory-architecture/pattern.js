(function registerPtoMemoryArchitecturePattern(global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ROUTE_TONES = {
    transport: {
      line: '#ffcf59',
      fill: '#ffdf1f',
      stroke: '#ffdf1f',
      text: '#111111',
    },
    direct: {
      line: '#4d97ff',
      fill: '#2d75df',
      stroke: '#5db8ff',
      text: '#ffffff',
    },
    directReturn: {
      line: '#29c7a6',
      fill: '#29c7a6',
      stroke: '#5be5c2',
      text: '#ffffff',
    },
  };

  const PRESETS = {
    ascend950b: {
      id: 'ascend950b',
      name: 'Ascend 950B Memory Architecture',
      rails: [
        {
          key: 'GM',
          label: 'Global Memory',
          tone: 'memory-shell',
          grid: {
            rows: 82,
            cols: 8,
            cellSize: 12,
            gap: 4,
            shape: 'hex',
          },
        },
        {
          key: 'L2',
          label: 'L2 Cache',
          tone: 'memory-rail',
          grid: {
            rows: 82,
            cols: 4,
            cellSize: 12,
            gap: 4,
            shape: 'dot',
          },
        },
      ],
      cores: [
        {
          id: 'mem950-aiv1',
          kind: 'aiv',
          title: 'AIV 1',
          presetKey: 'aivOfficialV1',
        },
        {
          id: 'mem950-aic',
          kind: 'aic',
          title: 'AIC',
          presetKey: 'aicDraftV1',
        },
        {
          id: 'mem950-aiv2',
          kind: 'aiv',
          title: 'AIV 2',
          presetKey: 'aivOfficialV1',
        },
      ],
      routes: [
        {
          id: 'l2-to-aiv1-dcache',
          label: 'MTE2',
          tone: 'transport',
          from: '[data-mem950-node="rail:L2"]',
          to: '#mem950-aiv1 [data-aiv-node="cache:DCache"]',
          fromSide: 'right',
          toSide: 'left',
          toBias: 0.50,
          style: 'lane-h-target',
          labelDy: 0,
        },
        {
          id: 'l2-to-aiv1',
          label: 'MTE2',
          tone: 'transport',
          from: '[data-mem950-node="rail:L2"]',
          to: '#mem950-aiv1 [data-aiv-node="buffer:UB"]',
          fromSide: 'right',
          toSide: 'left',
          toBias: 0.58,
          style: 'lane-h-target',
          labelDy: 0,
        },
        {
          id: 'aiv1-to-l2',
          label: 'MTE3',
          tone: 'transport',
          from: '#mem950-aiv1 [data-aiv-node="buffer:UB"]',
          to: '[data-mem950-node="rail:L2"]',
          fromSide: 'left',
          toSide: 'right',
          fromBias: 0.82,
          style: 'lane-h-source',
          labelDy: 0,
        },
        {
          id: 'l2-to-aic',
          label: 'MTE2',
          tone: 'transport',
          from: '[data-mem950-node="rail:L2"]',
          to: '#mem950-aic [data-aic-node="buffer:L1"]',
          fromSide: 'right',
          toSide: 'left',
          toBias: 0.58,
          style: 'lane-h-target',
          labelDy: 0,
        },
        {
          id: 'l2-to-aic-dcache',
          label: 'MTE2',
          tone: 'transport',
          from: '[data-mem950-node="rail:L2"]',
          to: '#mem950-aic [data-aic-node="cache:DCache"]',
          fromSide: 'right',
          toSide: 'left',
          toBias: 0.50,
          style: 'lane-h-target',
          labelDy: 0,
        },
        {
          id: 'aic-to-aiv1',
          label: 'L0C→UB',
          tone: 'direct',
          from: '#mem950-aic [data-aic-node="buffer:L0C"]',
          to: '#mem950-aiv1 [data-aiv-node="buffer:UB"]',
          fromSide: 'right',
          toSide: 'right',
          fromBias: 0.24,
          toBias: 0.70,
          style: 'elbow-h',
          corridorRight: 40,
          labelDy: 0,
        },
        {
          id: 'aiv2-to-aic',
          label: 'UB→L1',
          tone: 'directReturn',
          from: '#mem950-aiv2 [data-aiv-node="buffer:UB"]',
          to: '#mem950-aic [data-aic-node="buffer:L1"]',
          fromSide: 'right',
          toSide: 'right',
          fromBias: 0.30,
          toBias: 0.74,
          style: 'elbow-h',
          corridorRight: 84,
          labelDy: 0,
        },
        {
          id: 'l2-to-aiv2',
          label: 'MTE2',
          tone: 'transport',
          from: '[data-mem950-node="rail:L2"]',
          to: '#mem950-aiv2 [data-aiv-node="buffer:UB"]',
          fromSide: 'right',
          toSide: 'left',
          toBias: 0.58,
          style: 'lane-h-target',
          labelDy: 0,
        },
        {
          id: 'l2-to-aiv2-dcache',
          label: 'MTE2',
          tone: 'transport',
          from: '[data-mem950-node="rail:L2"]',
          to: '#mem950-aiv2 [data-aiv-node="cache:DCache"]',
          fromSide: 'right',
          toSide: 'left',
          toBias: 0.50,
          style: 'lane-h-target',
          labelDy: 0,
        },
        {
          id: 'aiv2-to-l2',
          label: 'MTE3',
          tone: 'transport',
          from: '#mem950-aiv2 [data-aiv-node="buffer:UB"]',
          to: '[data-mem950-node="rail:L2"]',
          fromSide: 'left',
          toSide: 'right',
          fromBias: 0.82,
          style: 'lane-h-source',
          labelDy: 0,
        },
      ],
      notes: [
        '1 AIC + 2 AIV memory-stage layout',
        'L2/GM → DCache, L1, or UB via MTE2',
        'UB → L2/GM via MTE3',
        '950 direct CV lanes: L0C→UB and UB→L1',
      ],
      details: [
        {
          selector: '[data-aiv-node="buffer:UB"]',
          rows: [
            ['bank', '8组 x 2个/组'],
            ['单bank', '16KB'],
            ['对齐', '32B'],
            ['搬运', 'MTE2/MTE3'],
          ],
          bankGrid: { groups: 8, banksPerGroup: 2 },
        },
        {
          selector: '[data-aiv-node="exec:SIMT"]',
          rows: [
            ['DCache', '128KB'],
            ['RegFile', '128KB'],
          ],
        },
        {
          selector: '[data-aiv-node="exec:SIMD"]',
          rows: [
            ['RegFile', 'SIMD RF'],
          ],
        },
        {
          selector: '#mem950-aic [data-aic-node="buffer:L1"]',
          rows: [
            ['对齐', '32B'],
            ['建议布局', 'NZ'],
          ],
        },
        {
          selector: '#mem950-aic [data-aic-node="buffer:L0A"]',
          rows: [
            ['搬运对齐', '512B'],
            ['推荐布局', 'NZ'],
          ],
        },
        {
          selector: '#mem950-aic [data-aic-node="buffer:L0B"]',
          rows: [
            ['搬运对齐', '512B'],
            ['推荐布局', 'ZN'],
          ],
        },
        {
          selector: '#mem950-aic [data-aic-node="buffer:FP"]',
          rows: [
            ['流水', 'FixPipe'],
            ['输出', '量化/激活'],
          ],
        },
        {
          selector: '#mem950-aic [data-aic-node="buffer:L0C"]',
          rows: [
            ['搬运对齐', '64B'],
            ['推荐布局', 'NZ'],
          ],
        },
      ],
    },
    ascend910b: {
      id: 'ascend910b',
      name: 'Ascend 910B Memory Architecture',
      rails: [
        {
          key: 'GM',
          label: 'Global Memory',
          tone: 'memory-shell',
          grid: {
            rows: 66,
            cols: 8,
            cellSize: 12,
            gap: 4,
            shape: 'hex',
          },
        },
        {
          key: 'L2',
          label: 'L2 Cache',
          tone: 'memory-rail',
          grid: {
            rows: 66,
            cols: 4,
            cellSize: 12,
            gap: 4,
            shape: 'dot',
          },
        },
      ],
      cores: [
        {
          id: 'mem950-aic',
          kind: 'aic',
          title: 'AIC',
          presetKey: 'aicDraftV1',
        },
        {
          id: 'mem950-aiv1',
          kind: 'aiv',
          title: 'AIV',
          presetKey: 'aiv910bSimd',
        },
      ],
      routes: [
        {
          id: 'l2-to-aic',
          label: 'MTE2',
          tone: 'transport',
          from: '[data-mem950-node="rail:L2"]',
          to: '#mem950-aic [data-aic-node="buffer:L1"]',
          fromSide: 'right',
          toSide: 'left',
          toBias: 0.58,
          style: 'lane-h-target',
          labelDy: 0,
        },
        {
          id: 'l2-to-aic-dcache',
          label: 'MTE2',
          tone: 'transport',
          from: '[data-mem950-node="rail:L2"]',
          to: '#mem950-aic [data-aic-node="cache:DCache"]',
          fromSide: 'right',
          toSide: 'left',
          toBias: 0.50,
          style: 'lane-h-target',
          labelDy: 0,
        },
        {
          id: 'l2-to-aiv1-dcache',
          label: 'MTE2',
          tone: 'transport',
          from: '[data-mem950-node="rail:L2"]',
          to: '#mem950-aiv1 [data-aiv-node="cache:DCache"]',
          fromSide: 'right',
          toSide: 'left',
          toBias: 0.50,
          style: 'lane-h-target',
          labelDy: 0,
        },
        {
          id: 'l2-to-aiv1',
          label: 'MTE2',
          tone: 'transport',
          from: '[data-mem950-node="rail:L2"]',
          to: '#mem950-aiv1 [data-aiv-node="buffer:UB"]',
          fromSide: 'right',
          toSide: 'left',
          toBias: 0.58,
          style: 'lane-h-target',
          labelDy: 0,
        },
        {
          id: 'aiv1-to-l2',
          label: 'MTE3',
          tone: 'transport',
          from: '#mem950-aiv1 [data-aiv-node="buffer:UB"]',
          to: '[data-mem950-node="rail:L2"]',
          fromSide: 'left',
          toSide: 'right',
          fromBias: 0.82,
          style: 'lane-h-source',
          labelDy: 0,
        },
      ],
      notes: [
        '910B baseline: 1 AIC + 1 AIV view',
        'AIV path is SIMD/vector oriented',
        'AIC/AIV data exchange is modeled through GM/L2',
        'No 950 SSBuf/C-V direct lane or SIMT island',
      ],
      details: [
        {
          selector: '[data-aiv-node="buffer:UB"]',
          rows: [
            ['驻留', 'AIV 本地'],
            ['执行', 'SIMD'],
            ['对齐', '32B'],
            ['搬运', 'MTE2/MTE3'],
          ],
        },
        {
          selector: '[data-aiv-node="exec:SIMD"]',
          rows: [
            ['调度', 'Vector Pipe'],
            ['SIMT', '无'],
          ],
        },
        {
          selector: '#mem950-aic [data-aic-node="buffer:L1"]',
          rows: [
            ['对齐', '32B'],
            ['角色', 'AIC 输入'],
          ],
        },
        {
          selector: '#mem950-aic [data-aic-node="buffer:L0A"]',
          rows: [
            ['搬运对齐', '512B'],
            ['推荐布局', 'NZ'],
          ],
        },
        {
          selector: '#mem950-aic [data-aic-node="buffer:L0B"]',
          rows: [
            ['搬运对齐', '512B'],
            ['推荐布局', 'ZN'],
          ],
        },
        {
          selector: '#mem950-aic [data-aic-node="buffer:L0C"]',
          rows: [
            ['角色', 'Cube 输出'],
            ['回写', '经 GM/L2'],
          ],
        },
      ],
    },
  };

  const NODE_DEFINITIONS = {
    'mem950:rail:GM': {
      title: 'GM / Global Memory',
      text: '全局内存，承担跨 AIC/AIV 的主数据驻留；数据通常经 L2 和 MTE 搬入片上 buffer。',
    },
    'mem950:rail:L2': {
      title: 'L2 Cache',
      text: '片上共享缓存层，连接 GM 与各计算核本地缓存、L1 或 UB。',
    },
    'mem950:core:AIC': {
      title: 'AIC / Cube Core',
      text: '矩阵计算核心，围绕 L1、L0A/L0B/L0C 和 Cube/FixPipe 流水组织数据。',
    },
    'mem950:core:AIV1': {
      title: 'AIV / Vector Core',
      text: '向量计算核心，950 视图中包含 UB、SIMD、SIMT、Scalar 和 Vector 执行单元。',
    },
    'mem950:core:AIV2': {
      title: 'AIV / Vector Core',
      text: '第二个 AIV 核；950 视图按 1 个 AIC 配 2 个 AIV 展示 AIC:AIV = 1:2。',
    },
    'mem950:core:AIV': {
      title: 'AIV / Vector Core',
      text: '910B 基线视图中的 AIV 核，主要按 SIMD/Vector 执行路径建模，不包含 950 的 SIMT island。',
    },
    'aiv:cache:DCache': {
      title: 'DCache',
      text: 'AIV 数据缓存，用于承接来自 L2/GM 的数据访问路径。',
    },
    'aiv:cache:ICache': {
      title: 'ICache',
      text: 'AIV 指令缓存，用于取指和执行流控制。',
    },
    'aiv:scalar:Scalar': {
      title: 'Scalar',
      text: 'AIV 标量控制侧，参与调度、同步和控制类指令执行。',
    },
    'aiv:buffer:UB': {
      title: 'UB / Unified Buffer',
      text: 'AIV 本地统一缓冲区；信息行补充驻留、对齐、bank 或搬运路径，具体内容随 910B/950 preset 变化。',
    },
    'aiv:exec:SIMT': {
      title: 'SIMT',
      text: '950 新增的 SIMT 执行侧，包含 Warp Scheduler、SIMT DCache 和 SIMT Register File。',
    },
    'aiv:exec:SIMD': {
      title: 'SIMD',
      text: '向量/SIMD 执行侧，面向传统 Ascend C 向量算子和 SIMD Register File。',
    },
    'aiv:vector:Vector': {
      title: 'Vector',
      text: '向量计算执行单元，消费 UB、SIMD/SIMT 侧准备的数据。',
    },
    'aic:buffer:L1': {
      title: 'L1',
      text: 'AIC 本地输入缓冲层，承接来自 L2/GM 的 MTE2 数据搬运。',
    },
    'aic:buffer:L0A': {
      title: 'L0A',
      text: 'Cube A 矩阵输入缓冲；950 信息层标注为 64KB 容量、512B 搬运对齐和 NZ 推荐布局。',
    },
    'aic:buffer:L0B': {
      title: 'L0B',
      text: 'Cube B 矩阵输入缓冲；950 信息层标注为 64KB 容量、512B 搬运对齐和 ZN 推荐布局。',
    },
    'aic:buffer:BT': {
      title: 'BT',
      text: 'Cube 侧辅助 buffer，当前图按 64KB 展示，用于矩阵流水中的辅助数据驻留。',
    },
    'aic:buffer:FP': {
      title: 'FP / FixPipe Buffer',
      text: 'FixPipe 相关缓冲，服务 Cube 输出后的搬出、量化或激活流水。',
    },
    'aic:buffer:L0C': {
      title: 'L0C',
      text: 'Cube 输出/累加结果缓冲；950 图中标注为 512KB，并通过直连通路送往 AIV UB。',
    },
    'aic:cache:DCache': {
      title: 'DCache',
      text: 'AIC 数据缓存，用于 AIC 侧数据访问和 MTE 搬运路径。',
    },
    'aic:cache:ICache': {
      title: 'ICache',
      text: 'AIC 指令缓存，用于取指和控制流水。',
    },
    'aic:cube:CUBE': {
      title: 'CUBE',
      text: 'AIC 矩阵计算单元，主要消费 L0A/L0B 数据并将结果写入 L0C。',
    },
    'aic:scalar:Scalar': {
      title: 'Scalar',
      text: 'AIC 标量控制侧，参与调度、同步和控制类指令执行。',
    },
    'aic:scheduler:Dispatch': {
      title: 'Dispatch',
      text: 'AIC 指令分发节点，将指令送入 Cube、FixPipe、MTE1、MTE2 等独立队列。',
    },
    'aic:queue:Cube Queue': {
      title: 'Cube Queue',
      text: 'Cube 指令队列，用于排队矩阵计算相关指令。',
    },
    'aic:queue:FixPipe Queue': {
      title: 'FixPipe Queue',
      text: 'FixPipe 指令队列，用于排队输出处理、量化或激活相关流水。',
    },
    'aic:queue:MTE1 Queue': {
      title: 'MTE1 Queue',
      text: 'MTE1 指令队列，服务 AIC 内部到 L0A/L0B/BT 等路径的数据搬运。',
    },
    'aic:queue:MTE2 Queue': {
      title: 'MTE2 Queue',
      text: 'MTE2 指令队列，服务从 L2/GM 到 AIC 本地缓存或 L1 的搬运。',
    },
  };

  const ROUTE_DEFINITIONS = {
    MTE2: {
      title: 'MTE2 数据搬运',
      text: '从 L2/GM 向 AIC/AIV 本地缓存、L1 或 UB 搬入数据的通路。',
    },
    MTE3: {
      title: 'MTE3 数据搬运',
      text: '从 AIV UB 等本地 buffer 将数据写回 L2/GM 的通路。',
    },
    'L0C→UB': {
      title: 'L0C → UB 直连',
      text: '950 增加的 AIC 到 AIV 直连数据通路，用于把 L0C 结果直接送入 UB。',
    },
    'UB→L1': {
      title: 'UB → L1 直连',
      text: '950 增加的 AIV 到 AIC 直连数据通路，用于把 UB 数据回送到 AIC L1。',
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

  function cloneCorePreset(coreConfig) {
    const helper = coreConfig.kind === 'aiv'
      ? global.PtoAivCorePattern
      : global.PtoAicCorePattern;
    const basePreset = helper?.resolvePreset?.(coreConfig.presetKey);
    if (!basePreset) return null;

    return {
      ...basePreset,
      id: `${basePreset.id}-${coreConfig.id}`,
      title: coreConfig.title,
    };
  }

  function buildRail(railConfig) {
    const rail = node('div', `pto-mem950__rail is-${railConfig.tone || 'memory-shell'}`);
    rail.dataset.mem950Node = `rail:${railConfig.key}`;
    rail.style.width = `${railContentWidth(railConfig.grid) + 36}px`;
    rail.appendChild(buildRailGrid(railConfig.grid));
    rail.appendChild(node('span', 'pto-mem950__rail-label', railConfig.label));
    return rail;
  }

  function railContentWidth(gridConfig) {
    const cols = Math.max(1, Number(gridConfig?.cols || 1));
    const cellSize = Math.max(4, Number(gridConfig?.cellSize || 12));
    const gap = Math.max(0, Number(gridConfig?.gap || 4));
    return cols * cellSize + Math.max(0, cols - 1) * gap;
  }

  function buildRailGrid(gridConfig) {
    const grid = node('div', 'pto-mem950__rail-grid');
    const rows = Math.max(1, Number(gridConfig?.rows || 1));
    const cols = Math.max(1, Number(gridConfig?.cols || 1));
    const cellSize = Math.max(4, Number(gridConfig?.cellSize || 12));
    const gap = Math.max(0, Number(gridConfig?.gap || 4));
    const shape = gridConfig?.shape || 'dot';

    grid.style.setProperty('--pto-mem950-rail-cols', String(cols));
    grid.style.setProperty('--pto-mem950-rail-cell-size', `${cellSize}px`);
    grid.style.setProperty('--pto-mem950-rail-gap', `${gap}px`);

    for (let index = 0; index < rows * cols; index += 1) {
      const cell = node('span', `pto-mem950__rail-cell is-${shape}`);
      grid.appendChild(cell);
    }

    return grid;
  }

  function buildCoreSlot(coreConfig) {
    const slot = node('section', `pto-mem950__core-slot is-${coreConfig.kind}`);
    slot.id = coreConfig.id;
    slot.dataset.mem950Node = `core:${coreConfig.title.replace(/\s+/g, '')}`;
    const mount = node('div', 'pto-mem950__core-mount');
    slot.appendChild(mount);
    return { slot, mount };
  }

  function renderCoreIntoSlot(slotMount, coreConfig) {
    const helper = coreConfig.kind === 'aiv'
      ? global.PtoAivCorePattern
      : global.PtoAicCorePattern;
    const preset = cloneCorePreset(coreConfig);
    if (!helper || !preset) {
      slotMount.appendChild(node('div', 'pto-mem950__missing', `${coreConfig.title} renderer unavailable`));
      return null;
    }
    return helper.render(slotMount, preset);
  }

  function appendDetailRows(target, rows) {
    if (!target || !Array.isArray(rows) || rows.length === 0) return;
    const list = node('div', 'detail-spec-list');
    rows.forEach(([label, value]) => {
      const row = node('div', 'detail-spec-row');
      row.appendChild(node('span', 'detail-spec-label', label));
      row.appendChild(node('span', 'detail-spec-value', value));
      list.appendChild(row);
    });
    target.appendChild(list);
  }

  function appendBankMiniGrid(target, bankGrid) {
    if (!target || !bankGrid) return;
    const groups = Math.max(1, Number(bankGrid.groups || 1));
    const banksPerGroup = Math.max(1, Number(bankGrid.banksPerGroup || 1));
    const grid = node('div', 'bank-mini-grid');
    grid.style.setProperty('--bank-mini-grid-groups', String(groups));
    for (let groupIndex = 0; groupIndex < groups; groupIndex += 1) {
      const group = node('span', 'bank-group');
      group.style.setProperty('--bank-mini-grid-bank-count', String(banksPerGroup));
      for (let bankIndex = 0; bankIndex < banksPerGroup; bankIndex += 1) {
        group.appendChild(node('span'));
      }
      grid.appendChild(group);
    }
    target.appendChild(grid);
  }

  function applyPresetDetails(stage, preset) {
    (preset.details || []).forEach((detail) => {
      stage.querySelectorAll(detail.selector).forEach((target) => {
        appendDetailRows(target, detail.rows);
        appendBankMiniGrid(target, detail.bankGrid);
      });
    });
  }

  function renderArchitecture(container, presetOrKey) {
    const preset = resolvePreset(presetOrKey);
    if (!container || !preset) return null;

    container.innerHTML = '';
    container.dataset.ptoMemArch = 'true';
    container.dataset.ptoMemArchPreset = preset.id;

    const stage = node('section', 'pto-mem950');
    stage.dataset.ptoMemArchStage = preset.id;

    const layout = node('div', 'pto-mem950__layout');
    const rails = node('div', 'pto-mem950__rails');
    const stack = node('div', 'pto-mem950__stack');

    (preset.rails || []).forEach((railConfig) => rails.appendChild(buildRail(railConfig)));

    (preset.cores || []).forEach((coreConfig) => {
      const { slot, mount } = buildCoreSlot(coreConfig);
      stack.appendChild(slot);
      renderCoreIntoSlot(mount, coreConfig);
    });

    layout.appendChild(rails);
    layout.appendChild(stack);
    stage.appendChild(layout);
    applyPresetDetails(stage, preset);

    if ((preset.notes || []).length > 0) {
      const notes = node('div', 'pto-mem950__notes');
      preset.notes.forEach((item) => notes.appendChild(node('span', 'pto-mem950__note', item)));
      stage.appendChild(notes);
    }

    container.appendChild(stage);

    return {
      container,
      preset,
      stage,
    };
  }

  function rootScaleMetrics(root) {
    const rootRect = root.getBoundingClientRect();
    const width = Math.max(1, root.offsetWidth || rootRect.width || 1);
    const height = Math.max(1, root.offsetHeight || rootRect.height || 1);
    return {
      rootRect,
      width,
      height,
      scaleX: rootRect.width ? rootRect.width / width : 1,
      scaleY: rootRect.height ? rootRect.height / height : 1,
    };
  }

  function rootForContainer(container) {
    return container?.querySelector?.('.pto-mem950') || (container?.classList?.contains('pto-mem950') ? container : null);
  }

  function setDetailVisibility(container, visible) {
    const root = rootForContainer(container);
    if (!root) return;
    root.classList.toggle('details-hidden', !visible);
  }

  function applyCanvasScale(container, zoom = 1) {
    const host = container?.querySelector?.('[data-pto-mem-arch="true"]') || container;
    const root = rootForContainer(host);
    if (!host || !root) return null;
    const scale = Math.max(0.4, Math.min(1.2, Number(zoom) || 1));
    host.style.position = 'relative';
    host.style.zoom = '';
    root.style.position = 'absolute';
    root.style.left = '0';
    root.style.top = '0';
    root.style.transform = `scale(${scale})`;
    root.style.transformOrigin = 'top left';
    root.style.setProperty('--architecture-zoom', String(scale));
    const tooltip = root.querySelector('.pto-mem950__hover-tip');
    if (tooltip) {
      tooltip.style.transform = `scale(${1 / scale})`;
      tooltip.style.transformOrigin = 'top left';
    }
    host.style.width = `${Math.ceil(root.offsetWidth * scale)}px`;
    host.style.height = `${Math.ceil(root.offsetHeight * scale)}px`;
    host.style.setProperty('--architecture-zoom', String(scale));
    return {
      scale,
      width: Math.ceil(root.offsetWidth * scale),
      height: Math.ceil(root.offsetHeight * scale),
    };
  }

  function edgePoint(root, nodeEl, side, bias) {
    const { rootRect, scaleX, scaleY } = rootScaleMetrics(root);
    const rect = nodeEl.getBoundingClientRect();
    const localLeft = (rect.left - rootRect.left) / scaleX;
    const localTop = (rect.top - rootRect.top) / scaleY;
    const localWidth = rect.width / scaleX;
    const localHeight = rect.height / scaleY;
    const biasRatio = Math.max(0, Math.min(1, Number.isFinite(bias) ? bias : 0.5));
    const xAtBias = localLeft + localWidth * biasRatio;
    const yAtBias = localTop + localHeight * biasRatio;

    if (side === 'left') return { x: localLeft, y: yAtBias };
    if (side === 'right') return { x: localLeft + localWidth, y: yAtBias };
    if (side === 'top') return { x: xAtBias, y: localTop };
    if (side === 'bottom') return { x: xAtBias, y: localTop + localHeight };
    return {
      x: localLeft + localWidth / 2,
      y: localTop + localHeight / 2,
    };
  }

  function pointsToPath(points) {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  }

  function resolveLaneX(root, route, fromPoint, toPoint) {
    const { rootRect, width, scaleX } = rootScaleMetrics(root);
    if (Number.isFinite(route.corridorRight)) {
      const stackEl = root.querySelector('.pto-mem950__stack');
      if (stackEl) {
        const stackRect = stackEl.getBoundingClientRect();
        const stackRight = (stackRect.right - rootRect.left) / scaleX;
        return Math.max(0, stackRight - route.corridorRight);
      }
      return Math.max(0, width - route.corridorRight);
    }
    if (Number.isFinite(route.corridorLeft)) return route.corridorLeft;
    return fromPoint.x + (toPoint.x - fromPoint.x) / 2;
  }

  function resolveLaneY(root, route, fromPoint, toPoint) {
    const { height } = rootScaleMetrics(root);
    if (Number.isFinite(route.corridorTop)) return route.corridorTop;
    if (Number.isFinite(route.corridorBottom)) return Math.max(0, height - route.corridorBottom);
    return fromPoint.y + (toPoint.y - fromPoint.y) / 2;
  }

  function routeGeometry(root, route, fromPoint, toPoint) {
    if (route.style === 'lane-h-target') {
      const start = { x: fromPoint.x, y: toPoint.y };
      const end = { x: toPoint.x, y: toPoint.y };
      return {
        points: [start, end],
        labelPoint: {
          x: (start.x + end.x) / 2,
          y: start.y + (route.labelDy || 0),
        },
      };
    }

    if (route.style === 'lane-h-source') {
      const start = { x: fromPoint.x, y: fromPoint.y };
      const end = { x: toPoint.x, y: fromPoint.y };
      return {
        points: [start, end],
        labelPoint: {
          x: (start.x + end.x) / 2,
          y: start.y + (route.labelDy || 0),
        },
      };
    }

    if (route.style === 'elbow-v') {
      const laneY = resolveLaneY(root, route, fromPoint, toPoint);
      const points = [
        fromPoint,
        { x: fromPoint.x, y: laneY },
        { x: toPoint.x, y: laneY },
        toPoint,
      ];
      return {
        points,
        labelPoint: {
          x: (points[1].x + points[2].x) / 2,
          y: points[1].y + (route.labelDy || 0),
        },
      };
    }

    const laneX = resolveLaneX(root, route, fromPoint, toPoint);
    const points = [
      fromPoint,
      { x: laneX, y: fromPoint.y },
      { x: laneX, y: toPoint.y },
      toPoint,
    ];
    return {
      points,
      labelPoint: {
        x: (fromPoint.x + laneX) / 2,
        y: fromPoint.y + (route.labelDy || 0),
      },
    };
  }

  function escapedAttr(value) {
    if (global.CSS && typeof global.CSS.escape === 'function') return global.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function nodeKeyForElement(el) {
    if (!el) return '';
    if (el.dataset?.mem950Node) return `mem950:${el.dataset.mem950Node}`;
    if (el.dataset?.aivNode) return `aiv:${el.dataset.aivNode}`;
    if (el.dataset?.aicNode) return `aic:${el.dataset.aicNode}`;
    if (el.dataset?.aicTransportTo) return `aic:transport:${el.textContent?.trim() || 'transport'}`;
    return '';
  }

  function nodeLabelForElement(el) {
    const key = nodeKeyForElement(el);
    const definition = NODE_DEFINITIONS[key];
    if (definition?.title) return definition.title;
    const raw = key.split(':').slice(1).join(':') || el?.textContent?.trim() || 'Element';
    return raw.replace(/^buffer:/, '').replace(/^cache:/, '').replace(/^exec:/, '').replace(/^rail:/, '');
  }

  function definitionForElement(el) {
    const key = nodeKeyForElement(el);
    if (NODE_DEFINITIONS[key]) return NODE_DEFINITIONS[key];
    if (el?.dataset?.aicTransportTo) {
      return {
        title: el.textContent?.trim() || 'Transport',
        text: `AIC 内部搬运/流水标签，目标硬件块是 ${el.dataset.aicTransportTo.replace(/^buffer:/, '')}。`,
      };
    }
    return {
      title: nodeLabelForElement(el),
      text: '图中的硬件结构节点；hover 相关线路可查看它参与的数据路径。',
    };
  }

  function definitionForRoute(route, fromEl, toEl) {
    const base = ROUTE_DEFINITIONS[route?.label] || {
      title: route?.label || 'Data route',
      text: '图中的数据或控制通路。',
    };
    const fromLabel = nodeLabelForElement(fromEl);
    const toLabel = nodeLabelForElement(toEl);
    return {
      title: base.title,
      text: `${base.text} 路径：${fromLabel} → ${toLabel}。`,
    };
  }

  function makeRouteState(root, route) {
    const group = root.querySelector(`[data-route-id="${escapedAttr(route.id)}"]`);
    const fromEl = root.querySelector(route.from);
    const toEl = root.querySelector(route.to);
    return { route, group, fromEl, toEl };
  }

  function targetContainsEndpoint(targetEl, endpointEl) {
    return Boolean(targetEl && endpointEl && (targetEl === endpointEl || targetEl.contains(endpointEl) || endpointEl.contains(targetEl)));
  }

  function attachHoverInteractions(container, presetOrKey) {
    const preset = resolvePreset(presetOrKey);
    const root = container?.querySelector?.('.pto-mem950') || container;
    if (!root || !preset) return null;

    const targetSelector = '[data-mem950-node], [data-aiv-node], [data-aic-node], [data-aic-transport-to]';
    const hoverTargets = Array.from(root.querySelectorAll(targetSelector));
    hoverTargets.forEach((el) => {
      el.classList.add('is-hoverable');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    });

    const routeStates = () => (preset.routes || []).map((route) => makeRouteState(root, route));
    routeStates().forEach(({ route, group, fromEl, toEl }) => {
      if (!group) return;
      group.classList.add('is-hoverable');
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-label', `${route.label || route.id}: ${nodeLabelForElement(fromEl)} to ${nodeLabelForElement(toEl)}`);
    });

    const tooltip = node('div', 'pto-mem950__hover-tip');
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    root.appendChild(tooltip);

    let activeEl = null;

    function clearHover() {
      root.classList.remove('is-hovering');
      root.querySelectorAll('.is-hovered, .is-related').forEach((el) => {
        el.classList.remove('is-hovered', 'is-related');
      });
      activeEl = null;
    }

    function showTooltip(definition) {
      tooltip.innerHTML = `<strong>${definition.title}</strong><span>${definition.text}</span>`;
      tooltip.hidden = false;
    }

    function hideTooltip() {
      tooltip.hidden = true;
    }

    function placeTooltip(clientX, clientY) {
      if (tooltip.hidden) return;
      const { rootRect, width, height, scaleX, scaleY } = rootScaleMetrics(root);
      const localX = (clientX - rootRect.left) / scaleX;
      const localY = (clientY - rootRect.top) / scaleY;
      const screenGap = 14;
      const edgeGap = 12;
      const edgeGapX = edgeGap / scaleX;
      const edgeGapY = edgeGap / scaleY;
      const tooltipLocalWidth = tooltip.offsetWidth / scaleX;
      const tooltipLocalHeight = tooltip.offsetHeight / scaleY;
      const maxLeft = Math.max(0, width - tooltipLocalWidth - edgeGapX);
      const maxTop = Math.max(0, height - tooltipLocalHeight - edgeGapY);
      const left = Math.min(maxLeft, Math.max(edgeGapX, localX + screenGap / scaleX));
      const top = Math.min(maxTop, Math.max(edgeGapY, localY + screenGap / scaleY));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    function placeTooltipNearElement(el) {
      const rect = el.getBoundingClientRect();
      placeTooltip(rect.left + rect.width / 2, rect.top + Math.min(rect.height, 48));
    }

    function identifyTarget(target) {
      const routeEl = target.closest?.('[data-route-id]');
      if (routeEl && root.contains(routeEl)) {
        const route = (preset.routes || []).find((item) => item.id === routeEl.dataset.routeId);
        if (route) return { type: 'route', el: routeEl, route };
      }
      const nodeEl = target.closest?.(targetSelector);
      if (nodeEl && root.contains(nodeEl)) return { type: 'node', el: nodeEl };
      return null;
    }

    function applyNodeHover(el) {
      const states = routeStates();
      el.classList.add('is-hovered');
      if (el.dataset?.mem950Node?.startsWith('core:')) {
        el.querySelectorAll('[data-aiv-node], [data-aic-node], [data-aic-transport-to]').forEach((child) => child.classList.add('is-related'));
      }
      states.forEach(({ group, fromEl, toEl }) => {
        const isRelated = targetContainsEndpoint(el, fromEl) || targetContainsEndpoint(el, toEl);
        if (!isRelated) return;
        group?.classList.add('is-related');
        if (fromEl && fromEl !== el && !el.contains(fromEl)) fromEl.classList.add('is-related');
        if (toEl && toEl !== el && !el.contains(toEl)) toEl.classList.add('is-related');
      });
      showTooltip(definitionForElement(el));
    }

    function applyRouteHover(routeEl, route) {
      const state = makeRouteState(root, route);
      routeEl.classList.add('is-hovered');
      state.fromEl?.classList.add('is-related');
      state.toEl?.classList.add('is-related');
      showTooltip(definitionForRoute(route, state.fromEl, state.toEl));
    }

    function activate(targetInfo, event) {
      if (!targetInfo) {
        clearHover();
        hideTooltip();
        return;
      }
      if (targetInfo.el === activeEl) {
        if (event?.clientX != null) placeTooltip(event.clientX, event.clientY);
        return;
      }
      clearHover();
      root.classList.add('is-hovering');
      activeEl = targetInfo.el;
      if (targetInfo.type === 'route') applyRouteHover(targetInfo.el, targetInfo.route);
      if (targetInfo.type === 'node') applyNodeHover(targetInfo.el);
      if (event?.clientX != null) placeTooltip(event.clientX, event.clientY);
      else placeTooltipNearElement(targetInfo.el);
    }

    function handlePointerOver(event) {
      activate(identifyTarget(event.target), event);
    }

    function handlePointerMove(event) {
      if (!tooltip.hidden) placeTooltip(event.clientX, event.clientY);
    }

    function handlePointerLeave() {
      clearHover();
      hideTooltip();
    }

    function handleFocusIn(event) {
      activate(identifyTarget(event.target), null);
    }

    function handleFocusOut(event) {
      if (!root.contains(event.relatedTarget)) {
        clearHover();
        hideTooltip();
      }
    }

    root.addEventListener('pointerover', handlePointerOver);
    root.addEventListener('pointermove', handlePointerMove);
    root.addEventListener('pointerleave', handlePointerLeave);
    root.addEventListener('focusin', handleFocusIn);
    root.addEventListener('focusout', handleFocusOut);

    return {
      destroy() {
        root.removeEventListener('pointerover', handlePointerOver);
        root.removeEventListener('pointermove', handlePointerMove);
        root.removeEventListener('pointerleave', handlePointerLeave);
        root.removeEventListener('focusin', handleFocusIn);
        root.removeEventListener('focusout', handleFocusOut);
        clearHover();
        tooltip.remove();
      },
    };
  }

  function createRouteOverlay(container, presetOrKey) {
    const preset = resolvePreset(presetOrKey);
    const root = container?.querySelector?.('.pto-mem950') || container;
    if (!root || !preset) return null;

    const svg = svgNode('svg', {
      class: 'pto-mem950__overlay',
      viewBox: '0 0 10 10',
      preserveAspectRatio: 'none',
    });
    const defs = svgNode('defs');
    svg.appendChild(defs);

    Object.entries(ROUTE_TONES).forEach(([key, tone]) => {
      const marker = svgNode('marker', {
        id: `pto-mem950-arrow-${key}`,
        markerWidth: '8',
        markerHeight: '8',
        refX: '6.4',
        refY: '4',
        orient: 'auto',
        markerUnits: 'userSpaceOnUse',
      });
      marker.appendChild(svgNode('path', {
        d: 'M1.5,1.5 L6.4,4 L1.5,6.5',
        fill: 'none',
        stroke: tone.line,
        'stroke-width': '1.6',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }));
      defs.appendChild(marker);
    });

    const routeEls = (preset.routes || []).map((route) => {
      const group = svgNode('g', { 'data-route-id': route.id, 'data-route-label': route.label || '' });
      const path = svgNode('path', {
        fill: 'none',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-width': route.strokeWidth || '2',
      });
      const labelGroup = svgNode('g');
      const labelBg = svgNode('rect', { rx: '11', ry: '11' });
      const labelText = svgNode('text', {
        'font-size': route.fontSize || '10',
        'font-weight': '700',
        'font-family': 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      });
      labelText.textContent = route.label || '';
      labelGroup.appendChild(labelBg);
      labelGroup.appendChild(labelText);
      group.appendChild(path);
      group.appendChild(labelGroup);
      svg.appendChild(group);
      return { route, group, path, labelGroup, labelBg, labelText };
    });

    root.appendChild(svg);

    function update() {
      const rect = root.getBoundingClientRect();
      const width = root.offsetWidth || rect.width;
      const height = root.offsetHeight || rect.height;
      svg.setAttribute('viewBox', `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);

      routeEls.forEach((entry) => {
        const fromEl = root.querySelector(entry.route.from);
        const toEl = root.querySelector(entry.route.to);
        if (!fromEl || !toEl) {
          entry.path.style.display = 'none';
          entry.labelGroup.style.display = 'none';
          return;
        }

        const fromPoint = edgePoint(root, fromEl, entry.route.fromSide || 'right', entry.route.fromBias);
        const toPoint = edgePoint(root, toEl, entry.route.toSide || 'left', entry.route.toBias);
        const geometry = routeGeometry(root, entry.route, fromPoint, toPoint);
        const tone = ROUTE_TONES[entry.route.tone] || ROUTE_TONES.transport;

        entry.path.style.display = '';
        entry.group.dataset.routeLabel = entry.route.label || '';
        entry.group.dataset.routeFromNode = nodeKeyForElement(fromEl);
        entry.group.dataset.routeToNode = nodeKeyForElement(toEl);
        entry.path.setAttribute('d', pointsToPath(geometry.points));
        entry.path.setAttribute('stroke', tone.line);
        entry.path.setAttribute('marker-end', `url(#pto-mem950-arrow-${entry.route.tone || 'transport'})`);
        if (entry.route.dashArray) {
          entry.path.setAttribute('stroke-dasharray', entry.route.dashArray);
        } else {
          entry.path.removeAttribute('stroke-dasharray');
        }

        if (!entry.route.label) {
          entry.labelGroup.style.display = 'none';
          return;
        }

        entry.labelGroup.style.display = '';
        entry.labelText.setAttribute('x', String(geometry.labelPoint.x));
        entry.labelText.setAttribute('y', String(geometry.labelPoint.y));
        entry.labelText.setAttribute('fill', tone.text);
        const textBox = entry.labelText.getBBox();
        const paddingX = 8;
        const paddingY = 4;
        entry.labelBg.setAttribute('x', String(geometry.labelPoint.x - textBox.width / 2 - paddingX));
        entry.labelBg.setAttribute('y', String(geometry.labelPoint.y - textBox.height / 2 - paddingY));
        entry.labelBg.setAttribute('width', String(textBox.width + paddingX * 2));
        entry.labelBg.setAttribute('height', String(textBox.height + paddingY * 2));
        entry.labelBg.setAttribute('fill', tone.fill);
        entry.labelBg.setAttribute('stroke', tone.stroke);
        entry.labelBg.setAttribute('stroke-width', '1');
      });
    }

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(update)
      : null;
    resizeObserver?.observe(root);
    root.querySelectorAll('[data-mem950-node], [data-aiv-node], [data-aic-node]').forEach((el) => resizeObserver?.observe(el));
    requestAnimationFrame(() => requestAnimationFrame(update));
    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
      document.fonts.ready.then(update);
    }

    return {
      svg,
      update,
      render() {
        update();
      },
      destroy() {
        resizeObserver?.disconnect();
        svg.remove();
      },
    };
  }

  function renderBufferGrid() {
    return null;
  }

  global.PtoMemoryArchitecturePattern = {
    presets: PRESETS,
    resolvePreset,
    renderArchitecture,
    createRouteOverlay,
    attachHoverInteractions,
    setDetailVisibility,
    applyCanvasScale,
    renderBufferGrid,
  };
})(window);

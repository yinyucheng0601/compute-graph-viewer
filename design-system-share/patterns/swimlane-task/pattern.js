(function registerPtoSwimlaneTaskPattern(global) {
  'use strict';

  const DEFAULTS = {
    minBarSegmentCountsPx: 84,
    sideRatio: 0.2,
    minInWidth: 10,
    maxInWidth: 42,
    minOutWidth: 12,
    maxOutWidth: 48,
    selectedLightenAmount: 14,
    emphasizedLightenAmount: 8,
    toneDownRatio: 0.16,
    toneDownTarget: '#171a20',
    baseFillAlpha: 0.18,
    borderSelected: 'rgba(255,255,255,0.88)',
    borderRelated: 'rgba(255,255,255,0.34)',
    borderDefault: 'rgba(255,255,255,0.10)',
    textColor: 'rgba(255,255,255,0.92)',
    topHighlight: 'rgba(255,255,255,0.04)',
  };

  const DEFAULT_STITCH_COLORS = ['#735bb4', '#4d70ba', '#4a9568', '#ba8053', '#45a2ad', '#b46494', '#238fcf', '#c99524'];

  const DEFAULT_CATEGORICAL_COLORMAP = [
    '#5b8def',
    '#f2a23a',
    '#a97ae6',
    '#38b8b2',
    '#e46b8a',
    '#43a3d9',
    '#8b929e',
    '#76b85a',
    '#c58b5f',
    '#d86ad9',
    '#d7b84e',
    '#6d88d7',
  ];

  const DEFAULT_SEMANTIC_DOMAIN = [
    'matmul',
    'vec_softmax',
    'vec_layernorm',
    'vec_elementwise',
    'vec_reduce',
    'mte_load',
    'cpu_sched',
  ];

  const DEFAULT_LABEL_COLORS = {
    'Prolog-Quant': '#8d6bc7',
    'Query-Linear': '#735bb4',
    'Query-Dequant': '#4d70ba',
    'Query-Hadamard': '#6f63b8',
    'Weight-Linear': '#4a9568',
    'Key-Linear': '#ba8053',
    'Key-Hadamard': '#c48b60',
    'Key-LayerNorm': '#b46494',
    'Key-Rope2D': '#45a2ad',
    fake: '#6f6a64',
    unknown: '#6f6a64',
  };

  const DEFAULT_LANE_KIND_COLORS = {
    fake: '#6f6a64',
    aic: '#735bb4',
    AIC: '#735bb4',
    aiv: '#4d70ba',
    AIV: '#4d70ba',
    aicpu: '#4a9568',
    AICCtrl: '#4a9568',
    AICSched: '#4a9568',
    MTEIn: '#ba8053',
    MTEOut: '#ba8053',
    other: '#8c847c',
  };

  function buildTaskSegmentSpec(task, widthPx) {
    const semantic = String(task?.label || task?.displayName || task?.rawName || 'compute');
    const inputCount = Array.isArray(task?.inputRawMagic) ? task.inputRawMagic.length : 0;
    const outputCount = Array.isArray(task?.outputRawMagic) ? task.outputRawMagic.length : 0;
    const showCounts = widthPx >= DEFAULTS.minBarSegmentCountsPx;

    return [
      { key: 'in', text: showCounts ? `IN ${inputCount}` : 'IN' },
      { key: 'compute', text: semantic },
      { key: 'out', text: showCounts ? `OUT ${outputCount}` : 'OUT' },
    ];
  }

  function lightenHexColor(hex, amount) {
    if (!hex || hex[0] !== '#') return hex;
    const value = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (value >> 16) + amount);
    const g = Math.min(255, ((value >> 8) & 0xff) + amount);
    const b = Math.min(255, (value & 0xff) + amount);
    const toHex = (channel) => Math.round(channel).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function alphaHexColor(color, alpha) {
    if (!color || color[0] !== '#') return color;
    const value = parseInt(color.slice(1), 16);
    const r = value >> 16;
    const g = (value >> 8) & 0xff;
    const b = value & 0xff;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function mixHexColors(base, target, ratio) {
    if (!base || !target || base[0] !== '#' || target[0] !== '#') return base;
    const from = parseInt(base.slice(1), 16);
    const to = parseInt(target.slice(1), 16);
    const mix = (lhs, rhs) => Math.round(lhs + (rhs - lhs) * ratio);
    const r = mix(from >> 16, to >> 16);
    const g = mix((from >> 8) & 0xff, (to >> 8) & 0xff);
    const b = mix(from & 0xff, to & 0xff);
    const toHex = (channel) => Math.round(channel).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function stableHash(input) {
    let hash = 2166136261;
    const value = String(input || '');
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function hslToHex(hueDegrees, saturationPct, lightnessPct) {
    const h = (((hueDegrees % 360) + 360) % 360) / 360;
    const s = Math.max(0, Math.min(1, saturationPct / 100));
    const l = Math.max(0, Math.min(1, lightnessPct / 100));
    const hue2rgb = (p, q, t) => {
      let next = t;
      if (next < 0) next += 1;
      if (next > 1) next -= 1;
      if (next < 1 / 6) return p + (q - p) * 6 * next;
      if (next < 1 / 2) return q;
      if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
      return p;
    };

    let r;
    let g;
    let b;
    if (s === 0) {
      r = l;
      g = l;
      b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    const toHex = (value) => Math.round(value * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function hashColor(input, saturation = 46, lightness = 48) {
    return hslToHex(stableHash(input) % 360, saturation, lightness);
  }

  function colorFromColormap(input, palette = DEFAULT_CATEGORICAL_COLORMAP, domain = []) {
    const colors = Array.isArray(palette) && palette.length ? palette : DEFAULT_CATEGORICAL_COLORMAP;
    const key = String(input || 'unknown');
    const domainIndex = Array.isArray(domain) ? domain.indexOf(key) : -1;
    const colorIndex = domainIndex >= 0 ? domainIndex : stableHash(key) % colors.length;
    return colors[colorIndex % colors.length];
  }

  function categoricalHashColor(input, saturation = 44, lightness = 46, hueSet = null) {
    if (Array.isArray(hueSet) && hueSet.length) {
      const hue = hueSet[stableHash(input) % hueSet.length];
      return hslToHex(hue, saturation, lightness);
    }
    return colorFromColormap(input);
  }

  function normalizeTaskColorKey(task) {
    return String(
      task?.colorKey ||
      task?.opType ||
      task?.label ||
      task?.displayName ||
      task?.rawName ||
      task?.opName ||
      'unknown'
    );
  }

  function createTaskColormap(options = {}) {
    const stitchColors = options.stitchColors || DEFAULT_STITCH_COLORS;
    const colormap = options.colormap || options.palette || DEFAULT_CATEGORICAL_COLORMAP;
    const semanticDomain = options.semanticDomain || DEFAULT_SEMANTIC_DOMAIN;
    const labelColors = {
      ...DEFAULT_LABEL_COLORS,
      ...(options.labelColors || {}),
    };
    const laneKindColors = {
      ...DEFAULT_LANE_KIND_COLORS,
      ...(options.laneKindColors || {}),
    };
    const semanticAliases = options.semanticAliases || {};
    const saturation = options.saturation ?? 46;
    const lightness = options.lightness ?? 48;
    const subgraphSaturation = options.subgraphSaturation ?? 48;
    const subgraphLightness = options.subgraphLightness ?? 48;
    const categoricalHues = options.categoricalHues || null;

    const normalizeSemanticKey = (task) => {
      const key = normalizeTaskColorKey(task);
      return semanticAliases[key] || key;
    };

    return {
      colorForLaneKind(kind) {
        return laneKindColors[kind] || laneKindColors.other;
      },
      colorForTask(task, mode = 'semantic') {
        if (mode === 'stitch') {
          const index = Math.abs(task?.seqNo || task?.sequence || 0) % stitchColors.length;
          return stitchColors[index];
        }
        if (mode === 'engine') {
          return this.colorForLaneKind(task?.laneKind || task?.lane?.kind);
        }
        if (mode === 'subgraph') {
          const key = task?.subgraphKey || task?.subGraphId || task?.leafHash || normalizeSemanticKey(task);
          return categoricalHues
            ? categoricalHashColor(key, subgraphSaturation, subgraphLightness, categoricalHues)
            : colorFromColormap(key, colormap);
        }
        const key = normalizeSemanticKey(task);
        if (labelColors[key]) return labelColors[key];
        if (categoricalHues) return categoricalHashColor(key, saturation, lightness, categoricalHues);
        return colorFromColormap(key, colormap, semanticDomain);
      },
      legendForKeys(keys, mode = 'semantic') {
        return keys.map((item) => {
          const key = typeof item === 'string' ? item : item.key;
          const label = typeof item === 'string' ? item : (item.label || item.key);
          return {
            key,
            label,
            color: this.colorForTask({ colorKey: key, label: key }, mode),
          };
        });
      },
    };
  }

  function resolveDisplayColor(baseColor, options = {}) {
    if (options.isSelected) return lightenHexColor(baseColor, DEFAULTS.selectedLightenAmount);
    if (options.isEmphasized) return lightenHexColor(baseColor, DEFAULTS.emphasizedLightenAmount);
    return baseColor;
  }

  function resolveBorderColor(options = {}) {
    if (options.isSelected) return DEFAULTS.borderSelected;
    if (options.isRelated) return DEFAULTS.borderRelated;
    return DEFAULTS.borderDefault;
  }

  function drawTaskBar(ctx, options) {
    const task = options.task || {};
    const barX = options.x || 0;
    const barY = options.y || 0;
    const width = Math.max(0, options.width || 0);
    const height = Math.max(0, options.height || 0);
    const radius = options.radius ?? 2;
    const fontFamily = options.fontFamily || 'sans-serif';
    const baseColor = options.baseColor || '#5f6775';
    const displayColor = resolveDisplayColor(baseColor, {
      isSelected: options.isSelected,
      isEmphasized: options.isEmphasized,
    });
    const tonedColor = mixHexColors(displayColor, DEFAULTS.toneDownTarget, DEFAULTS.toneDownRatio);
    const borderColor = resolveBorderColor({
      isSelected: options.isSelected,
      isRelated: options.isRelated,
    });

    const inW = Math.max(DEFAULTS.minInWidth, Math.min(width * DEFAULTS.sideRatio, DEFAULTS.maxInWidth));
    const outW = Math.max(DEFAULTS.minOutWidth, Math.min(width * DEFAULTS.sideRatio, DEFAULTS.maxOutWidth));
    const computeW = Math.max(0, width - inW - outW);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(barX, barY, width, height, radius + 1);
    ctx.clip();

    ctx.fillStyle = alphaHexColor(tonedColor, DEFAULTS.baseFillAlpha);
    ctx.fillRect(barX, barY, width, height);

    [
      { x: barX, w: inW, fill: mixHexColors(tonedColor, '#ffffff', 0.10) },
      { x: barX + inW, w: computeW, fill: tonedColor },
      { x: barX + inW + computeW, w: outW, fill: mixHexColors(tonedColor, '#0b0f17', 0.18) },
    ].forEach((segment) => {
      if (segment.w <= 0) return;
      ctx.fillStyle = segment.fill;
      ctx.fillRect(segment.x, barY, segment.w, height);
    });

    ctx.fillStyle = DEFAULTS.topHighlight;
    ctx.fillRect(barX, barY, width, 1);
    ctx.restore();

    ctx.beginPath();
    ctx.roundRect(barX + 0.5, barY + 0.5, Math.max(0, width - 1), Math.max(0, height - 1), radius + 1);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = options.isSelected ? 1.4 : 1;
    ctx.stroke();

    if (width < 28) {
      return {
        displayColor,
        tonedColor,
        borderColor,
        segmentWidths: { inW, computeW, outW },
      };
    }

    const segments = buildTaskSegmentSpec(task, width);
    const font = width >= 72 ? `600 9px ${fontFamily}` : `600 8px ${fontFamily}`;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(barX + 1, barY + 1, Math.max(0, width - 2), Math.max(0, height - 2), radius);
    ctx.clip();
    ctx.font = font;
    ctx.textBaseline = 'middle';

    [
      { x: barX, w: inW, align: 'center', text: segments[0].text },
      { x: barX + inW, w: computeW, align: 'left', text: segments[1].text },
      { x: barX + inW + computeW, w: outW, align: 'center', text: segments[2].text },
    ].forEach((segment, index) => {
      if (segment.w < (index === 1 ? 20 : 14)) return;
      ctx.fillStyle = DEFAULTS.textColor;
      if (segment.align === 'left') {
        ctx.textAlign = 'left';
        const maxChars = Math.max(4, Math.floor((segment.w - 8) / 6));
        const label = segment.text.length > maxChars ? `${segment.text.slice(0, Math.max(0, maxChars - 1))}…` : segment.text;
        ctx.fillText(label, segment.x + 5, barY + height / 2 + 0.5);
        return;
      }

      ctx.textAlign = 'center';
      if (segment.w < segment.text.length * 5.2) return;
      ctx.fillText(segment.text, segment.x + segment.w / 2, barY + height / 2 + 0.5);
    });

    ctx.restore();

    return {
      displayColor,
      tonedColor,
      borderColor,
      segmentWidths: { inW, computeW, outW },
    };
  }

  global.PtoSwimlaneTaskPattern = {
    defaults: DEFAULTS,
    buildTaskSegmentSpec,
    lightenHexColor,
    alphaHexColor,
    mixHexColors,
    stableHash,
    hslToHex,
    hashColor,
    colorFromColormap,
    categoricalHashColor,
    createTaskColormap,
    resolveDisplayColor,
    resolveBorderColor,
    drawTaskBar,
  };
})(window);

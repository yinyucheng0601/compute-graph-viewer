(function registerPtoSwimlaneTaskPattern(global) {
  'use strict';

  const DEFAULTS = {
    minBarSegmentCountsPx: 84,
    sideRatio: 0.2,
    minInWidth: 10,
    maxInWidth: 42,
    minOutWidth: 12,
    maxOutWidth: 48,
    selectedLightenAmount: 28,
    emphasizedLightenAmount: 14,
    baseFillAlpha: 0.24,
    borderSelected: 'rgba(255,255,255,0.88)',
    borderRelated: 'rgba(255,255,255,0.46)',
    borderDefault: 'rgba(255,255,255,0.16)',
    textColor: 'rgba(255,255,255,0.92)',
    topHighlight: 'rgba(255,255,255,0.08)',
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
    return `rgb(${r},${g},${b})`;
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
    return `rgb(${r},${g},${b})`;
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

    ctx.fillStyle = alphaHexColor(displayColor, DEFAULTS.baseFillAlpha);
    ctx.fillRect(barX, barY, width, height);

    [
      { x: barX, w: inW, fill: mixHexColors(displayColor, '#ffffff', 0.16) },
      { x: barX + inW, w: computeW, fill: displayColor },
      { x: barX + inW + computeW, w: outW, fill: mixHexColors(displayColor, '#0b0f17', 0.2) },
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
    resolveDisplayColor,
    resolveBorderColor,
    drawTaskBar,
  };
})(window);

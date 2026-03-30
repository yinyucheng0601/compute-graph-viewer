/**
 * PTO Theme Tokens — JS version for canvas/WebGL renderers
 * Use this instead of hardcoding hex values in JS files.
 *
 * Consumers: model-architecture/app.js, js/nav.js, js/scan_passes.js,
 *            indexer-exec/index.html inline scripts
 */
export const PTO_TOKENS = {
  dark: {
    // Neutral surfaces
    background:         '#0b1220',
    backgroundElevated: '#14181f',
    surface1:           '#11161c',
    surface2:           '#171d25',
    surface3:           '#1d2530',

    // Foreground
    foreground:          '#eaeaea',
    foregroundSecondary: '#b3b3b3',
    foregroundMuted:     '#8b8f97',
    foregroundDisabled:  '#6f6f6f',

    // Border
    borderSubtle:  'rgba(255,255,255,0.06)',
    borderDefault: 'rgba(255,255,255,0.10)',
    borderStrong:  'rgba(255,255,255,0.16)',

    // Brand
    primary:         '#4369efff',
    primaryHover:    '#5a92e6',
    primaryFg:       '#f5f9ff',
    accent:          '#7c8db8',

    // Status
    success: '#04d793ff',
    warning: '#ffaa3bff',
    danger:  '#ff4b7bff',

    // Interaction States
    stateHover:    'rgba(255,255,255,0.06)',
    statePress:    'rgba(255,255,255,0.10)',
    stateSelected: 'rgba(67,105,239,0.14)',
    stateFocus:    'rgba(67,105,239,0.20)',

    // Disabled
    surfaceDisabled: 'rgba(255,255,255,0.04)',
    borderDisabled:  'rgba(255,255,255,0.06)',

    // View — Swimlane
    swStitch0: '#7f8ca8',
    swStitch1: '#5f8fd8',

    // View — Execution Overlay
    eoQuery:  '#4369efff',
    eoKey:    '#8799c4',
    eoWeight: '#00af93ff',
  },
};

/** Shorthand: get the current theme tokens (always dark for now) */
export const t = PTO_TOKENS.dark;

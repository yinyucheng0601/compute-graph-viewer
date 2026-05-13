---
version: alpha
name: PTO
description: Dark-first developer workstation design system for PTO modules, graph surfaces, operator workbenches, and review previews.
colors:
  primary: "#4369EF"
  primary-hover: "#5A92E6"
  accent: "#7C8DB8"
  success: "#04D793"
  warning: "#FFAA3B"
  danger: "#FF4B7B"
  background: "#101010"
  background-elevated: "#141414"
  surface-1: "#161616"
  surface-2: "#1C1C1C"
  surface-3: "#262626"
  surface-4: "#313131"
  foreground: "#E6E6E6"
  foreground-secondary: "#999999"
  foreground-muted: "#666666"
  border-subtle: "#202020"
  border-default: "#292929"
  border-strong: "#3A3A3A"
  primary-foreground: "#F5F9FF"
typography:
  display:
    fontFamily: "Inter, Source Han Sans SC, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0
  title-1:
    fontFamily: "Inter, Source Han Sans SC, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  title-2:
    fontFamily: "Inter, Source Han Sans SC, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  body:
    fontFamily: "Inter, Source Han Sans SC, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: "Inter, Source Han Sans SC, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  label:
    fontFamily: "Inter, Source Han Sans SC, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0.5px
  mono:
    fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
rounded:
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 999px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#000000"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: 36px
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "#000000"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: 36px
    padding: 12px
  primary-foreground-swatch:
    backgroundColor: "{colors.primary-foreground}"
    textColor: "{colors.background}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 8px
  button-solid:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: 36px
    padding: 12px
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: 36px
    padding: 12px
  button-ghost:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.foreground-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: 36px
    padding: 12px
  input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 34px
    padding: 12px
  panel:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 16px
  panel-shell:
    backgroundColor: "{colors.background-elevated}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: 16px
  card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 16px
  card-selected:
    backgroundColor: "{colors.surface-4}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 16px
  tag:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.foreground-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: 20px
    padding: 8px
  metadata:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.foreground-secondary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 8px
  muted-rule:
    backgroundColor: "{colors.foreground-muted}"
    height: 1px
  tag-accent:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: 20px
    padding: 8px
  status-success:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: 20px
    padding: 8px
  status-warning:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.warning}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: 20px
    padding: 8px
  status-danger:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.danger}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: 20px
    padding: 8px
  divider-subtle:
    backgroundColor: "{colors.border-subtle}"
    textColor: "{colors.foreground}"
    height: 1px
  divider-default:
    backgroundColor: "{colors.border-default}"
    textColor: "{colors.foreground}"
    height: 1px
  divider-strong:
    backgroundColor: "{colors.border-strong}"
    textColor: "{colors.foreground}"
    height: 1px
---

# PTO DESIGN.md

## 1. Visual Theme & Atmosphere

PTO is not a marketing site. It is a developer workstation for understanding what data becomes across source, pass, runtime, and hardware views.

The UI should feel:

- Technical, calm, and precise
- Dense enough for expert work, but never visually noisy
- Dark-first by default for graph and timeline work
- Capable of light mode, but never pastel, playful, or decorative
- Consistent across modules so the user feels they are moving through one toolchain, not several disconnected pages

The visual benchmark is closer to developer-focused dark products such as Cursor, OpenCode AI, Warp, and Resend than to consumer dashboards.

Do not optimize for “pretty card gallery” aesthetics.
Optimize for:

- traceability
- evidence visibility
- fast scanning
- state clarity
- low visual drift across modules

## 2. Product Surfaces

PTO has three major surface types. They must not be styled as if they are the same thing.

### A. Workbench Surface

Used by:

- `op-ide-assistant`
- `op-ide-assistant-v2`
- future operator workbenches

Characteristics:

- three-column or split-pane workflows
- form inputs, code panes, agent chat, action bars
- strong panel shells and clear affordances

### B. Visualization Surface

Used by:

- `pass-ir`
- `swimlane`
- `mem_viewer`
- `execution-overlay`

Characteristics:

- canvas / SVG / minimap / overlays
- neutral dark stage
- restrained chrome
- color reserved for meaning, not decoration

### C. Preview / Review Surface

Used by:

- `design-system-preview.html`
- component previews
- design system review pages

Characteristics:

- explanatory, not product-like
- token demonstrations
- side-by-side comparisons

## 3. Pattern Sources

PTO has reusable graph, timeline, and hardware visualization primitives that are more specific than base components. These are pattern sources, not decorative examples.

The shared pattern registry is:

- `patterns/patterns.json`

Current pattern sources:

- `patterns/swimlane-task/pattern.json`
- `patterns/swimlane-task/pattern.html`
- `patterns/swimlane-task/pattern.css`
- `patterns/swimlane-task/pattern.js`
- `patterns/memory-architecture/pattern.json`
- `patterns/memory-architecture/pattern.html`
- `patterns/memory-architecture/pattern.css`
- `patterns/memory-architecture/pattern.js`
- `patterns/aic-core-object/pattern.json`
- `patterns/aic-core-object/pattern.html`
- `patterns/aic-core-object/pattern.css`
- `patterns/aic-core-object/pattern.js`
- `patterns/aiv-core-object/pattern.json`
- `patterns/aiv-core-object/pattern.html`
- `patterns/aiv-core-object/pattern.css`
- `patterns/aiv-core-object/pattern.js`
- `patterns/pass-ir-graph-node/pattern.json`
- `patterns/pass-ir-graph-node/pattern.html`
- `patterns/pass-ir-graph-node/pattern.css`
- `patterns/pass-ir-graph-node/pattern.js`

Rules:

- preview pages may wrap a pattern for layout, but must not redefine the pattern's internal classes
- agents must read the pattern JSON before reusing a graph or timeline primitive
- allowed overrides must be explicit CSS variables or geometry fields documented by the pattern
- forbidden overrides include internal radius, segment typography, divider shadows, and state rules unless the pattern source itself is updated

For swimlane task bars, reuse pattern id `swimlane-task-bar`. The canonical source is the canvas renderer in `patterns/swimlane-task/pattern.js`, aligned to `pypto-swimlane-perf-tool/js/swimlane.js`. Do not rebuild it with DOM/CSS or rewrite segment math, color mixing, border alpha, or label truncation locally.

For memory hierarchy diagrams, reuse pattern id `memory-architecture-layout`. The canonical source is the hybrid renderer in `patterns/memory-architecture/pattern.js`, extracted from `mem_viewer` DOM, BPG grid logic, and MTE overlay behavior. New hardware pages such as 950B should extend the preset/config surface there instead of copying `mem_viewer/index.html` or redrawing route geometry in page-local code.

For AIC internal object shells, reuse pattern id `aic-core-object`. The canonical source is `patterns/aic-core-object/pattern.js`, driven by preset data rather than handwritten page DOM. Extend the preset to add or resize intermediate buffers for 950B; do not restyle the object chrome or clone the generated markup in local pages.

For AIV internal object shells, reuse pattern id `aiv-core-object`. The canonical source is `patterns/aiv-core-object/pattern.js`, driven by preset data for DCache, ICache or ND-DNA Cache, UB, Scalar, SIMT, SIMD, Aux Scalar, and Vector. Keep AIC and AIV spacing, buffer grid math, and route treatment visually consistent when widening or rescaling architecture diagrams.

For Pass-IR graph nodes, reuse pattern id `pass-ir-graph-node`. The canonical source is `patterns/pass-ir-graph-node/pattern.js`, extracted from the real Pass-IR `css/style.css` and `js/renderer.js` contract. It covers op, tensor, incast, outcast, selected, compact, and group cards. Compact group cards keep the Group Node shell, title, count, and thumbnail stack while dropping detailed rows. Do not use the old static graph-node examples in `design-system-preview.html` or `pass-ir/node-preview.html` as source of truth.

Current extraction progress:

- `swimlane-task-bar`: shared canvas renderer registered and previewed
- `memory-architecture-layout`: shared full-stage 950B renderer registered and previewed
- `aic-core-object`: shared config-driven object renderer registered and previewed
- `aiv-core-object`: shared config-driven object renderer registered and previewed
- `pass-ir-graph-node`: shared hybrid renderer registered and previewed; original Pass-IR business page still uses its local renderer until a separate integration pass is approved

## 4. Color Palette & Roles

### Core UI Palette

Use token source of truth from:

- `tokens/foundation.css`
- `tokens/semantic.css`
- `tokens/components.css`

The design rule is:

- neutral surfaces carry layout
- accent colors carry meaning
- never use large-area saturated fills for normal UI panels

### Semantic Roles

- `primary`: the main interactive accent
- `accent`: auxiliary emphasis
- `success`: healthy / positive result
- `warning`: caution / pending concern
- `danger`: breakage / invalid / destructive

### Data Visualization Colors

Visualization colors are a separate system from general UI colors.

Examples:

- pass-ir node types
- swimlane semantic labels
- mem-viewer storage tier ramps

These colors may be vivid, but only inside charts, graphs, chips, legends, and traces.

Do not reuse visualization colors as generic panel backgrounds.

## 5. Typography Rules

### Type Families

- Display: `Space Grotesk`
- Body UI: `Inter`
- Code / metrics / IDs: `Space Mono` or the shared mono token family

### Typography Intent

- Titles should be compact and controlled, not editorially oversized
- Labels and metadata should be explicit and easy to scan
- Code and numeric identifiers should always use mono

### Hierarchy

- Page title: strong but compact
- Panel title: one clear level below page title
- Section label: quiet, uppercase or mono where appropriate
- Metadata: muted, never low-contrast to the point of illegibility

## 6. Component Stylings

### Buttons

Buttons should be grouped into a small, stable set:

- primary action
- secondary action
- ghost/icon action
- selected toggle / segmented state

Do not invent page-local button archetypes unless they are first proven in preview pages and absorbed into tokens.

### Inputs

Inputs must feel like tool inputs, not consumer rounded pills by default.

Rules:

- clear boundaries
- readable placeholder text
- focused state must be obvious
- repeated row layouts must align as a grid

### Panels

All modules should use a consistent shell language:

- rounded container
- consistent border alpha
- stable elevation hierarchy
- similar header/body/footer rhythm

### Code Editors

Code panes are not generic cards.

They should read as editor surfaces:

- fixed mono typography
- line-number gutter
- horizontal scroll for long lines
- predictable top chrome
- quiet syntax colors

## 7. Layout Principles

### Pane Logic

For three-column workbenches:

- left = fixed utility rail or form rail
- center = primary content, stretches
- right = fixed assistant / detail rail

If a module breaks this pattern, it must be intentional and documented.

### Spacing

Use token spacing consistently.

Avoid:

- random 7px / 13px / 19px spacing
- one-off panel padding overrides unless strictly necessary

### Alignment

Repeated structures must align to visible grids:

- form rows
- button rows
- stat cards
- legends

Misalignment is one of the fastest ways PTO looks inconsistent.

## 8. Depth & Elevation

Dark PTO should rely on:

- subtle border contrast
- low-to-medium elevation
- restrained glass/blur usage

Do not stack multiple styling tricks at once:

- strong blur
- bright gradients
- high drop shadow
- saturated fills

Pick one emphasis mechanism, not four.

## 9. Do’s and Don’ts

### Do

- keep neutral surfaces consistent across modules
- reserve saturated color for semantic meaning
- build preview pages before spreading a new visual pattern
- keep forms, panels, and code panes rhythmically aligned
- maintain both light and dark previews for shared system elements

### Don’t

- hardcode colors in module CSS when a token exists
- use inline styles for reusable UI states
- let each module invent its own panel chrome
- use visualization colors as generic UI decoration
- treat tokens as optional suggestions

## 10. Responsive Behavior

Desktop first, but responsive.

Rules:

- fixed side rails may collapse only below clear breakpoints
- center work area should remain dominant
- toolbars should wrap cleanly rather than overflow unpredictably
- chat input, form rows, and code tabs should remain usable on smaller widths

Do not solve narrow layouts by shrinking text until unreadable.

## 11. Design System Governance

### Source of Truth

The source of truth for implementation tokens is:

- `tokens/foundation.css`
- `tokens/semantic.css`
- `tokens/components.css`

Generated artifacts:

- `tokens/tokens.js`
- `tokens/tokens.json`

must be generated from those CSS sources, not edited by hand.

### Review Rule

Any new shared visual pattern must:

1. appear in a preview page
2. be named in tokens or component docs
3. be reused in at least one product surface

### Module Rule

A module is not considered “design-system integrated” until:

- it imports the shared token chain
- it avoids unapproved hardcoded UI colors
- its core UI patterns appear in preview or review material

## 12. Prompt Guide For Agents

When asking an AI agent to build PTO UI, use directions like:

- “Use PTO’s dark-first developer workstation style”
- “Keep left/right rails fixed width and center content flexible”
- “Use neutral panel shells and reserve vivid color for semantic signals”
- “Treat code panes as editor surfaces, not cards”
- “Align forms to a visible grid and avoid pill-like consumer inputs unless explicitly requested”

Avoid directions like:

- “make it more modern”
- “make it more premium”
- “make it more stylish”

Those usually increase inconsistency instead of reducing it.

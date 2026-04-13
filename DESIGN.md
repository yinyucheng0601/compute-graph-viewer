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

- `button-preview.html`
- component previews
- design system review pages

Characteristics:

- explanatory, not product-like
- token demonstrations
- side-by-side comparisons

## 3. Color Palette & Roles

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

## 4. Typography Rules

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

## 5. Component Stylings

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

## 6. Layout Principles

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

## 7. Depth & Elevation

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

## 8. Do’s and Don’ts

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

## 9. Responsive Behavior

Desktop first, but responsive.

Rules:

- fixed side rails may collapse only below clear breakpoints
- center work area should remain dominant
- toolbars should wrap cleanly rather than overflow unpredictably
- chat input, form rows, and code tabs should remain usable on smaller widths

Do not solve narrow layouts by shrinking text until unreadable.

## 10. Design System Governance

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

## 11. Prompt Guide For Agents

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

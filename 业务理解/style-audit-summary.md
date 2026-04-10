# PTO Style Audit Summary

## Scope

- Scanned active style sources across `css/`, `js/`, `swimlane/`, `mem_viewer/`, `model-architecture/`, `execution-overlay/`, `source-flow/`, `pass-ir/`, and `indexer-exec/`
- Excluded `archive/`, `vendor/`, `.git/`, and other third-party/minified sources from the primary conclusions
- Parsed 51 active files containing CSS, HTML, JS, and inline style definitions

## How To Use This Audit

- Every issue below is grouped by module
- Every module section includes concrete source files and line references
- The intended workflow is:
  - find the module section
  - open the listed files
  - normalize the tokens or literals called out in the evidence

## High-Level Findings

- The project has a partial global dark token layer, but it is not the single source of truth
- Multiple modules redefine the same semantic token names with different values
- Several major modules still hardcode colors in JS, so CSS-only tokenization is not enough
- The current codebase is dark-mode-first and not ready for a reliable light/dark switch

## Token vs Hardcoded Ratio

| Module | Files | Hardcoded | Token Uses | Hardcoded % |
| --- | ---: | ---: | ---: | ---: |
| `(root)` | 2 | 964 | 3705 | 20.6% |
| `css` | 1 | 245 | 142 | 63.3% |
| `pass-ir` | 1 | 19 | 11 | 63.3% |
| `source-flow` | 1 | 79 | 49 | 61.7% |
| `execution-overlay` | 3 | 63 | 63 | 50.0% |
| `swimlane` | 6 | 380 | 193 | 66.3% |
| `mem_viewer` | 12 | 305 | 99 | 75.5% |
| `js` | 12 | 104 | 14 | 88.1% |
| `model-architecture` | 5 | 285 | 24 | 92.2% |
| `indexer-exec` | 1 | 78 | 6 | 92.9% |

## Global Foundation Layer

### Module

- `global`

### Primary Sources

- [css/style.css](/Users/yin/pto/css/style.css#L1)

### Evidence

- Global semantic-like tokens already exist in [css/style.css](/Users/yin/pto/css/style.css#L2):
  - `--canvas-bg`
  - `--text-primary`
  - `--text-secondary`
  - `--text-label`
  - `--tag-bg`
  - `--tag-border`
  - `--toolbar-bg`
  - `--toolbar-border`
  - `--toolbar-height`
- Raw palette values are still mixed into the same layer in [css/style.css](/Users/yin/pto/css/style.css#L7):
  - `#3577F6`
  - `#A855F7`
  - `#C9107D`
  - `rgba(255, 255, 255, 0.07)`
  - `rgba(255, 255, 255, 0.10)`
- Component rules still depend on literals instead of aliases in [css/style.css](/Users/yin/pto/css/style.css#L108) and [css/style.css](/Users/yin/pto/css/style.css#L148)

### Current Problems

- Foundation and semantic layers are mixed together
- No shared spacing scale exists
- No shared radius scale exists
- The file behaves like both a token source and a component stylesheet

### What To Change

- Keep this file as the single semantic token contract
- Move raw palette values into a dedicated foundation section
- Add spacing, radius, control-height, and shadow tokens here before module refactors

## Module Audit

### `swimlane`

#### Sources

- [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L1)
- [swimlane/index.html](/Users/yin/pto/swimlane/index.html)
- [swimlane/app.js](/Users/yin/pto/swimlane/app.js)

#### Evidence

- Local module token layer in [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L1):
  - `--sw-card-bg`
  - `--sw-card-border`
  - `--sw-text-dim`
  - `--sw-highlight`
  - `--sw-stitch-*`
- Search control uses pill geometry and raw white-alpha surfaces in [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L45)
- Resource panel introduces another local surface system in [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L107)
- Section headers and status rows use direct alpha values instead of shared aliases in [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L154) and [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L190)

#### Typical Component Drift

- Search and filter controls are pill-based
- Resource panel cards use `18px`, `14px`, and `10px` radius values
- Text sizes cluster around `10px`, `11px`, `12px`

#### Current Problems

- Good local naming, but values are still mostly literals
- Surface ramp is duplicated with `rgba(255,255,255,0.03~0.10)`
- This module partially extends the global system and partially forks it

#### What To Change

- Keep the `--sw-*` namespace only for view-specific tokens
- Re-point all neutral surfaces, text, and borders to global semantic aliases
- Remove direct white-alpha literals where a semantic surface or border token should exist

### `mem_viewer`

#### Sources

- [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L1)
- [mem_viewer/index.html](/Users/yin/pto/mem_viewer/index.html)
- [mem_viewer/js](/Users/yin/pto/mem_viewer/js)

#### Evidence

- Local token redefinitions in [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L7):
  - `--text-primary`
  - `--text-secondary`
  - `--text-dim`
  - `--bg-page`
  - `--bg-panel`
  - `--border-color`
- Module-only sizing tokens in [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L11):
  - `--mem-card-lg-w`
  - `--mem-card-sm-w`
  - `--mem-card-gap`
- Compact card density override in [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L48)
- Badge styling introduces its own accent and geometry system in [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L78)
- Overlay and grip surfaces use more raw literals in [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L96) and [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L157)

#### Typical Component Drift

- Buttons: `.mv-btn`, `.mv-btn-primary`, `.mv-cp-btn`
- Cards are denser and narrower than the global card system
- Playback / toolbar UI uses its own border and blur language

#### Current Problems

- Re-defines shared text semantics locally
- Creates a separate button language instead of extending the global one
- Mixes reusable sizing tokens with local appearance tokens in one file

#### What To Change

- Keep layout sizing tokens if they are truly module-specific
- Stop redefining `--text-primary`, `--text-secondary`, and similar global semantics
- Normalize buttons and badges onto the global control system

### `model-architecture`

#### Sources

- [model-architecture/styles.css](/Users/yin/pto/model-architecture/styles.css)
- [model-architecture/app.js](/Users/yin/pto/model-architecture/app.js#L29)

#### Evidence

- CSS layer appears token-friendly, but the rendering palette is hardcoded in JS in [model-architecture/app.js](/Users/yin/pto/model-architecture/app.js#L29):
  - `BG`
  - `INK`
  - `LINE`
  - `PAPER`
  - `PAPER_ALT`
  - `MUTED`
  - `TP_COLOR`
  - `EP_COLOR`
  - `COLLECTIVE_COLOR`
  - `LOCAL_COLOR`
- These colors drive graph rendering directly, so changing CSS tokens will not update the actual visualization

#### Typical Component Drift

- Graph panels look aligned with the global toolbar
- Actual rendered nodes and edges use a separate hardcoded visual language

#### Current Problems

- This module is not theme-switchable in practice
- JS hardcoded colors block semantic token adoption
- It is one of the highest-risk areas for any design system migration

#### What To Change

- Extract all graph rendering colors into a JS token map
- Name them semantically, not structurally
- Have CSS and JS consume the same token source

### `execution-overlay`

#### Sources

- [execution-overlay/styles.css](/Users/yin/pto/execution-overlay/styles.css#L1)
- [execution-overlay/app.js](/Users/yin/pto/execution-overlay/app.js)

#### Evidence

- Local semantic groups are already structured well in [execution-overlay/styles.css](/Users/yin/pto/execution-overlay/styles.css#L1):
  - `--eo-bg-*`
  - `--eo-line`
  - `--eo-line-strong`
  - `--eo-query`
  - `--eo-key`
  - `--eo-weight`
  - `--eo-shared`
- UI surfaces and chips consistently reuse those tokens in [execution-overlay/styles.css](/Users/yin/pto/execution-overlay/styles.css#L63) and [execution-overlay/styles.css](/Users/yin/pto/execution-overlay/styles.css#L103)
- Remaining drift still exists:
  - raw node background `#292d35` in [execution-overlay/styles.css](/Users/yin/pto/execution-overlay/styles.css#L69)
  - hardcoded heat gradient in [execution-overlay/styles.css](/Users/yin/pto/execution-overlay/styles.css#L119)

#### Typical Component Drift

- Best semantic grouping among all active modules
- Component tokens and view tokens are already separated conceptually

#### Current Problems

- A few important surfaces are still literals
- Some active-state decisions still rely on local meaning instead of global semantics

#### What To Change

- Use this module as the migration template
- Repoint residual literals to global semantic tokens
- Keep pipeline-specific tokens as module/view-level tokens

### `source-flow`

#### Sources

- [source-flow/index.html](/Users/yin/pto/source-flow/index.html#L9)

#### Evidence

- Reuses global toolbar tokens in [source-flow/index.html](/Users/yin/pto/source-flow/index.html#L10)
- Creates its own view toggle system in [source-flow/index.html](/Users/yin/pto/source-flow/index.html#L52)
- Active state uses a separate purple palette in [source-flow/index.html](/Users/yin/pto/source-flow/index.html#L85)
- File load CTA is another separate style in [source-flow/index.html](/Users/yin/pto/source-flow/index.html#L198)
- Diff state colors are hardcoded in [source-flow/index.html](/Users/yin/pto/source-flow/index.html#L225)

#### Typical Component Drift

- Buttons use smaller radii than other modules
- Monospace is used directly at component level
- Purple is treated as primary here, not blue

#### Current Problems

- Inline `<style>` block acts as a mini design system
- Control states diverge from the rest of the product
- Diff semantics are hardcoded instead of tokenized

#### What To Change

- Extract view controls onto global button / segmented-control tokens
- Keep diff colors as semantic state tokens, not local literals
- Reduce inline style ownership in this file

### `pass-ir`

#### Sources

- [pass-ir/index.html](/Users/yin/pto/pass-ir/index.html#L8)

#### Evidence

- Control panel is fully restyled inline in [pass-ir/index.html](/Users/yin/pto/pass-ir/index.html#L9)
- The panel uses its own surfaces and alpha values in [pass-ir/index.html](/Users/yin/pto/pass-ir/index.html#L10)
- Button active state uses a purple accent in [pass-ir/index.html](/Users/yin/pto/pass-ir/index.html#L72)
- Typography and labels use more local alpha-based text colors in [pass-ir/index.html](/Users/yin/pto/pass-ir/index.html#L30) and [pass-ir/index.html](/Users/yin/pto/pass-ir/index.html#L40)

#### Typical Component Drift

- Control buttons are `40px` high
- Panel geometry is close to the global system, but color semantics differ

#### Current Problems

- Small file, but still forks the global component styles
- Uses inline panel rules that duplicate shared patterns

#### What To Change

- Replace local panel/button styling with shared component tokens
- Keep only feature-specific layout in this file

### `indexer-exec`

#### Sources

- [indexer-exec/index.html](/Users/yin/pto/indexer-exec/index.html#L10)

#### Evidence

- Full module theme is inlined in [indexer-exec/index.html](/Users/yin/pto/indexer-exec/index.html#L10)
- Root palette is slate-heavy and separate from the rest of PTO in [indexer-exec/index.html](/Users/yin/pto/indexer-exec/index.html#L23):
  - `#111215`
  - `#0c0e13`
  - `#1A2030`
  - `#334155`
  - `#475569`
  - `#64748B`
  - `#94A3B8`
- Controls and left panel use their own shape language in [indexer-exec/index.html](/Users/yin/pto/indexer-exec/index.html#L103) and [indexer-exec/index.html](/Users/yin/pto/indexer-exec/index.html#L143)
- Node cards override the pass-ir card system in [indexer-exec/index.html](/Users/yin/pto/indexer-exec/index.html#L151)

#### Typical Component Drift

- Monospace-first UI rather than mixed sans + mono
- Slate neutral palette reads like a different product
- Control sizes and radii diverge from global controls

#### Current Problems

- Highest style drift among active modules
- Inline styles make normalization expensive
- Shares structure with other PTO views but not their visual system

#### What To Change

- Normalize neutrals and text colors first
- Replace inline control and card surfaces with global component tokens
- Move special graph accents into semantic state tokens

## Cross-Module Token Conflicts

### Repeated Token Names With Different Meanings

- `--text-primary`
- `--text-secondary`
- `--text-label`
- `--canvas-bg`
- `--tag-bg`
- `--tag-border`
- `--toolbar-bg`
- `--toolbar-border`
- `--toolbar-height`

### Concrete Sources

- Global definitions in [css/style.css](/Users/yin/pto/css/style.css#L2)
- Swimlane local values in [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L1)
- Mem viewer local values in [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L7)

### Problem

- Same names are being used for different effective meanings
- That makes future light-mode aliasing unsafe

### Fix Direction

- Only define global semantic tokens once
- Modules should consume them or define namespaced view tokens only

## Component Drift Checklist

### Buttons

#### Sources

- Global buttons in [css/style.css](/Users/yin/pto/css/style.css#L178)
- Swimlane controls in [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L45)
- Mem viewer badges and controls in [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L78)
- Source flow toggles in [source-flow/index.html](/Users/yin/pto/source-flow/index.html#L52)
- Pass IR control buttons in [pass-ir/index.html](/Users/yin/pto/pass-ir/index.html#L53)
- Indexer exec controls in [indexer-exec/index.html](/Users/yin/pto/indexer-exec/index.html#L143)

#### Problems

- Heights vary from `22px` to `40px`
- Radius varies from `4px` to `999px`
- Active color semantics vary between blue, purple, white, gray, and slate
- Font family rules are inconsistent between sans and monospace

### Cards / Panels

#### Sources

- Global card language in [css/style.css](/Users/yin/pto/css/style.css#L392)
- Swimlane resource panels in [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L107)
- Mem viewer panels in [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L96)
- Execution overlay panels in [execution-overlay/styles.css](/Users/yin/pto/execution-overlay/styles.css#L69)
- Indexer exec node cards in [indexer-exec/index.html](/Users/yin/pto/indexer-exec/index.html#L151)

#### Problems

- Radius and border thickness drift by module
- Neutral surfaces are implemented differently in each module
- Hover and selected states do not follow a shared state ramp

### Inputs / Search / File Load

#### Sources

- Swimlane search shell in [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L45)
- Source flow file load CTA in [source-flow/index.html](/Users/yin/pto/source-flow/index.html#L198)
- Pass IR panel buttons in [pass-ir/index.html](/Users/yin/pto/pass-ir/index.html#L53)

#### Problems

- Search shells, file-load buttons, and panel toggles all use different geometry and accent rules

### Tables / Data Surfaces

#### Sources

- Global node-card / data-row patterns in [css/style.css](/Users/yin/pto/css/style.css#L466)
- Mem viewer detail rows in [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L217)
- Indexer exec data rows in [indexer-exec/index.html](/Users/yin/pto/indexer-exec/index.html#L193)

#### Problems

- No unified table or data-row component exists
- Row typography and density differ significantly by module

## Repeated Colors And Surface Patterns

### Main Repeated Colors

- Blue family:
  - `#3577F6`
  - `#3b82f6`
  - `#4a8bf5`
  - `#4c80ff`
- Purple family:
  - `#A855F7`
  - `#8b5cf6`
  - `#7c3aed`
  - `#7b57bf`
- Neutral surfaces:
  - `#1A1A1A`
  - `#111215`
  - `#17181d`
  - `#202020`
  - `#292d35`
  - `rgba(255,255,255,0.03)`
  - `rgba(255,255,255,0.04)`
  - `rgba(255,255,255,0.05)`
  - `rgba(255,255,255,0.06)`
  - `rgba(255,255,255,0.07)`
  - `rgba(255,255,255,0.08)`
  - `rgba(255,255,255,0.10)`

### Main Sources

- [css/style.css](/Users/yin/pto/css/style.css#L2)
- [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L1)
- [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L7)
- [execution-overlay/styles.css](/Users/yin/pto/execution-overlay/styles.css#L1)
- [source-flow/index.html](/Users/yin/pto/source-flow/index.html#L85)
- [pass-ir/index.html](/Users/yin/pto/pass-ir/index.html#L72)
- [indexer-exec/index.html](/Users/yin/pto/indexer-exec/index.html#L23)
- [model-architecture/app.js](/Users/yin/pto/model-architecture/app.js#L29)

## Recommended Dark Semantic Tokens

### Core

- `--background: #0F0F0F`
- `--foreground: rgba(255,255,255,0.92)`
- `--muted-foreground: #8B8B8B`
- `--card: #181818`
- `--card-foreground: rgba(255,255,255,0.92)`
- `--border: rgba(255,255,255,0.10)`
- `--border-subtle: rgba(255,255,255,0.06)`

### Accent / State

- `--primary: #8AB4F8`
- `--primary-foreground: #0F1115`
- `--accent: #8B5CF6`
- `--success: #4DA56D`
- `--warning: #F59E0B`
- `--danger: #F97316`

### Geometry

- `--radius-sm: 6px`
- `--radius-md: 8px`
- `--radius-lg: 12px`
- `--radius-pill: 999px`
- `--space-1: 4px`
- `--space-2: 8px`
- `--space-3: 12px`
- `--space-4: 16px`
- `--control-sm: 28px`
- `--control-md: 34px`
- `--control-lg: 40px`

## Migration Priority

1. Freeze the global semantic token contract in [css/style.css](/Users/yin/pto/css/style.css#L2)
2. Remove repeated semantic token definitions from [swimlane/styles.css](/Users/yin/pto/swimlane/styles.css#L1) and [mem_viewer/styles/main.css](/Users/yin/pto/mem_viewer/styles/main.css#L7)
3. Extract JS palettes from [model-architecture/app.js](/Users/yin/pto/model-architecture/app.js#L29) and the shared `js/` folder into token maps
4. Normalize control styles across [source-flow/index.html](/Users/yin/pto/source-flow/index.html#L52), [pass-ir/index.html](/Users/yin/pto/pass-ir/index.html#L53), and [indexer-exec/index.html](/Users/yin/pto/indexer-exec/index.html#L143)
5. Add a light-mode alias layer only after token identity is stable

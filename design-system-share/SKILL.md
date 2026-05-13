---
name: pto-new-module-design-system
description: Enforce PTO design-system-first module creation. Use when building a new page in PTO style, or when retrofitting an existing demo to PTO. Reuse the existing design system by default; do not invent new visual styles.
---

# PTO Design System Skill (shareable bundle)

This bundle lets any AI generate or retrofit pages in PTO visual style.

## How to use this bundle

1. Send the entire `design-system-share/` folder (this file + `DESIGN.md` + `design-system-preview.html` + `tokens/` + `css/` + `references/` + `patterns/`) to the AI together.
2. Tell the AI which workflow you want:
   - **New page from product requirement** → see *Workflow A*.
   - **Retrofit an existing demo to PTO style** → see *Workflow B*.
3. Open `design-system-preview.html` in a browser to confirm the visual target.

The rule: pages must consume the existing PTO design system. Do not invent a new button, toggle, badge, card, panel, spacing scale, or color language.

## Required baseline (read in this order)

1. `DESIGN.md` — full system spec: theme, surfaces, palette, typography, spacing, components, governance. **Read this first.**
2. `references/quick-reference.md` — one-page cheat sheet of tokens and class names.
3. `design-system-preview.html` — live visual reference, open in a browser.
4. `tokens/foundation.css`, `tokens/semantic.css`, `tokens/components.css` — token implementation (CSS variables).
5. `css/style.css` — concrete class implementations.

For layout-heavy work, also inspect `patterns/` (graph nodes, swimlane tasks, memory architecture, AIV/AIC core, pass-IR nodes).

## Workflow A — New page from product requirement

Before writing code, list the UI pieces the page needs:

- header / toolbar
- buttons (entry / commit)
- toggle, toggle group
- chip filter
- labels / badges
- card, inspector, popup
- input, select
- data-viz-only patterns

Map each piece to the existing system using `references/pto-design-system-map.md` and the preview page.

Then write the page using:

- HTML class names from `css/style.css`
- Colors / spacing / type via CSS variables from `tokens/*.css` (e.g. `var(--color-surface-2)`, `var(--space-3)`)
- Layout via flex/grid composition; layout classes may be module-local
- Patterns (graph node, swimlane, memory tier, etc.) from `patterns/` if applicable

## Workflow B — Retrofit existing demo to PTO style

When the user already has an HTML/CSS demo and wants it migrated to PTO style:

1. Read the demo top-to-bottom and list every visual element (buttons, inputs, panels, badges, toggles, headings, surfaces, hard-coded colors).
2. For each element, map to PTO using `references/pto-design-system-map.md` + the preview page + `references/quick-reference.md`.
3. Produce a **migration table** so the user can review before applying:

   | Element in demo | PTO equivalent | Class / token to use |
   |---|---|---|
   | `<button class="cta">Run</button>` | solid button | `btn btn-solid` |
   | `background: #1a1a1a` | surface-2 | `var(--color-surface-2)` |
   | `padding: 16px` | space-4 | `var(--space-4)` |

4. After the migration table is shown, replace classes and inline styles in the HTML; replace hard-coded colors / shadows / radii / spacing with tokens.
5. Skip the preview-gate — no new style is being created, only consuming the existing system.
6. In the final response list:
   - Which PTO classes / tokens were used.
   - Any element that did **not** find an equivalent → flag for user decision (do not invent a new style silently).

## Hard rules

- Do not create a new private button / toggle / badge / card system.
- Do not hard-code colors, radii, shadows, font sizes, borders, or spacing when an existing token fits.
- Do not add new module-local visual tokens unless the user has approved a preview first.
- Do not ship the business module with unapproved new visuals.

Module-specific layout and structure classes are allowed. New visual language is not.

## Approval gate for missing styles (Workflow A only)

If the current system cannot satisfy a needed pattern:

1. Stop before writing the final module style.
2. Create a preview page (`<module>/component-preview.html`) showing:
   - the closest existing system pattern
   - the proposed new pattern
   - state coverage (normal / hover / active / selected)
   - token usage
   - why the current system is insufficient
3. Wait for explicit user approval.
4. After approval: absorb the new pattern into the shared system first, then consume it from the new module.

See `references/preview-gate.md` for the full rule.

## Expected outputs

In the final response, explicitly state:

- which existing system pieces were reused
- which needs exceeded the current system (if any)
- whether a preview page was created
- whether the user approved new visuals
- whether approved visuals were absorbed into the shared system
- (Workflow B) the full migration table

## References

- `references/quick-reference.md` — token + class cheat sheet
- `references/pto-design-system-map.md` — element classification rules
- `references/preview-gate.md` — approval workflow
- `DESIGN.md` — canonical system spec

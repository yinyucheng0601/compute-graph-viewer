# PTO Design System Map

Use this as the default classification when building a new module.

## Shared component families

- `Buttons`: `soft`, `solid`
- `Toggle`
- `Toggle Group`
- `Chip Filter`
- `Labels & Badges`
- `Card`
- `Data Viz Exempt`
- `Graph Node Pattern`
- `Swimlane Event Pattern`

The source of truth for target appearance is `/Users/yin/pto/design-system-preview.html`.

## Matching guidance

### Buttons

- `soft`: open, import, load, select, browse, local resource entry
- `solid`: primary workflow commit such as run, generate, apply, execute

Do not split equivalent entry actions into multiple visual styles. For example:

- `Open Pass Folder`
- `Open single JSON`
- `加载本地资源`

These should map to the same entry-button style.

### Toggle and toggle group

Use for mode switches, compact/semantic switches, before/after, TB/LR, and similar mutually exclusive controls.

Do not create pill-only one-off styles when the behavior is still a toggle group.

### Labels and badges

Status labels should be based on the neutral badge shape plus semantic color. Do not create unrelated tag shapes unless they are truly data-viz specific.

### Card

Use for inspector panels, action-list panels, popup detail cards, and compact in-place info blocks.

Do not treat every large surface as a card. Large canvases and viz shells belong outside this class.

### Data Viz Exempt

Allowed exemptions:

- color maps
- graph node semantic accents
- swimlane event colors
- stitch colors
- dependency line/dot colors
- other visualization-only encodings

Even exempt patterns should be previewed and documented when they materially affect readability.

## Forbidden moves

- Creating a new `.xxx-btn` visual system when shared buttons already fit
- Hard-coding neutral grays, borders, shadows, or radii inside a new module
- Introducing a new type scale disconnected from existing tokens
- Shipping unapproved new component visuals directly in the module

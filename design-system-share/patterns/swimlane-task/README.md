# Swimlane Task Bar Pattern

This pattern is the reusable source for PTO swimlane task bars.

The visual contract comes from `pypto-swimlane-perf-tool/js/swimlane.js` task-bar rendering. This is a canvas pattern, not a DOM button or chip.

Source files:

- `pattern.js` exposes `window.PtoSwimlaneTaskPattern.drawTaskBar`
- `pattern.html` is the standalone preview
- `pattern.css` styles only the preview shell and canvas rows

Allowed render inputs:

- `x`
- `y`
- `width`
- `height`
- `baseColor`
- `task.label`
- `task.displayName`
- `task.rawName`
- `task.inputRawMagic`
- `task.outputRawMagic`
- `isSelected`
- `isRelated`
- `isEmphasized`
- `fontFamily`

Do not rewrite segment width math, fill alpha, border alpha, font thresholds, or text truncation rules outside `pattern.js`.

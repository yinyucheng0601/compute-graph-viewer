# Swimlane Task Bar Pattern

This pattern is the reusable source for PTO swimlane task bars and their hover tips.

The task-bar visual contract comes from `pypto-swimlane-perf-tool/js/swimlane.js` task-bar rendering. The hover tip behavior mirrors the PMU swimlane `.sl-tooltip` interaction. This is a canvas pattern, not a DOM button or chip.

Source files:

- `pattern.js` exposes `window.PtoSwimlaneTaskPattern.drawTaskBar`, `formatTaskTooltip`, and `initHoverTooltip`
- `pattern.html` is the standalone preview
- `pattern.css` styles only the preview shell, canvas rows, and shared tooltip

Allowed render inputs:

- `x`
- `y`
- `width`
- `height`
- `baseColor`
- `task.label`
- `task.displayName`
- `task.rawName`
- `task.opName`
- `task.laneKind`
- `task.laneId`
- `task.totalCycle`
- `task.clcCycle`
- `task.gap`
- `task.gapRatio`
- `task.status`
- `task.dominantCounter`
- `task.wrapId`
- `task.inputRawMagic`
- `task.outputRawMagic`
- `isSelected`
- `isRelated`
- `isEmphasized`
- `fontFamily`

`inputRawMagic` and `outputRawMagic` are optional. The pattern only renders the
IN/OUT subsegments when those arrays exist and contain data; otherwise the task
renders as a single compute/body bar.

Do not rewrite segment width math, fill alpha, border alpha, font thresholds, text truncation rules, tooltip copy, or tooltip positioning outside `pattern.js`.

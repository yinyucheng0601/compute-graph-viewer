# Swimlane Task Bar Pattern

This pattern is the reusable source for PTO swimlane task bars.

The visual contract comes from `pypto-swimlane-perf-tool/js/swimlane.js` task-bar rendering. This is a canvas pattern, not a DOM button or chip.

Color contract:

- Callers provide a semantic `baseColor`, usually from `PtoSwimlaneTaskPattern.createTaskColormap()`.
- Dense swimlanes should use `createTaskColormap()` to map task categories, engine lanes, stitches, or subgraphs to stable colors, then pass the category color into `drawTaskBar`.
- The default semantic colormap maps a stable task domain onto a categorical palette, then falls back to hash indexing into the same palette for unknown keys. It must not use raw `hash % 360` hue selection because nearby task keys can cluster into one hue family.
- `drawTaskBar` tones the received color toward the dark workbench surface before painting segments, so dense rows stay readable without becoming neon.
- Selection/emphasis may lightly raise luminance, but should not change category identity.

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

Colormap API:

- `createTaskColormap(options).colorForTask(task, mode)`
- modes: `semantic`, `engine`, `stitch`, `subgraph`
- `legendForKeys(keys, mode)` returns stable legend color entries

Do not rewrite segment width math, fill alpha, border alpha, font thresholds, text truncation, stable hash, or colormap mode rules outside `pattern.js`.

# PTO Design System Dependency

PTO treats `pto-design-system` as the canonical source for design-system tokens, shared CSS, reusable patterns, preview pages, and agent-facing skill documentation.

Canonical repository:

```text
https://github.com/yinyucheng0601/pto-design-system.git
```

Online preview:

```text
https://yinyucheng0601.github.io/pto-design-system/design-system-preview.html
```

## Local Layout

```text
pto/
├── vendor/pto-design-system/  # Git submodule; canonical source pinned by commit
├── design-system-share/       # AI/shareable copy generated from the canonical source
├── tokens/                    # Runtime mirror for legacy/static PTO pages
├── css/                       # Runtime mirror for legacy/static PTO pages
└── patterns/                  # Runtime mirror for legacy/static PTO pages
```

Do not edit `design-system-share/`, `tokens/`, `css/`, or `patterns/` as the source of truth for design-system changes. Edit and push `pto-design-system`, then sync it into PTO.

## Initialize Or Update The Submodule

```bash
git submodule update --init --recursive vendor/pto-design-system
```

Update to the latest canonical design system:

```bash
git -C vendor/pto-design-system fetch origin main
git -C vendor/pto-design-system checkout main
git -C vendor/pto-design-system pull --ff-only origin main
```

## Sync Into PTO

Preview what would be copied:

```bash
node scripts/sync-design-system.mjs
```

Write the canonical files into `design-system-share/` and overwrite matching runtime mirror files under `tokens/`, `css/`, `patterns/`, and `assets/`:

```bash
node scripts/sync-design-system.mjs --write
```

Make `design-system-share/` a clean mirror of the canonical package:

```bash
node scripts/sync-design-system.mjs --write --clean-share
```

Use `--clean-share` only after checking `git status`, because it removes files in `design-system-share/` that are not present in `vendor/pto-design-system/`.

## Policy

- `vendor/pto-design-system/` is the dependency source.
- `design-system-share/` is a generated/shareable package for AI tools.
- `tokens/`, `css/`, `patterns/`, and `assets/` are runtime mirrors kept for existing static PTO pages.
- New PTO pages should prefer local repository paths, not GitHub Pages URLs, so local development remains offline-capable and version-pinned.
- Avoid hand-copying design-system folders; use `scripts/sync-design-system.mjs` so drift is visible.

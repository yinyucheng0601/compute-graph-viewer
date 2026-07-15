# AGENTS.md

## Module

This directory is a standalone static openPangu-2.0-Flash architecture viewer with synthetic profiling overlays.

## Run and verify

```sh
npm run check
npm run serve
```

Open `http://127.0.0.1:8794/`. Do not validate through `file://`; the overlay requires same-origin iframe DOM access.

## Dependency rule

Keep every runtime dependency inside this directory and update `dependency-manifest.json` when dependencies change. Do not replace the vendored PTO design-system files with parent-directory references.

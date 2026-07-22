# AGENTS.md

## Module

This directory is a standalone static snapshot of the DeepSeek V3.2 report overlay.

## Run and verify

```sh
npm run check
npm run serve
```

Open `http://127.0.0.1:8792/`. Do not validate through `file://`; the overlay requires same-origin iframe DOM access.

## Dependency rule

Keep every runtime dependency inside this directory and update `dependency-manifest.json` when dependencies change. Do not replace the vendored PTO design-system files with parent-directory references.

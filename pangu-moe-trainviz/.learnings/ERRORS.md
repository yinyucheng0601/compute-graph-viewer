## [ERR-20260713-001] apply_patch context mismatch

**Logged**: 2026-07-13T15:40:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
Two otherwise valid multi-hunk patches failed because nearby HTML/CSS context did not match the source exactly.

### Error
```
apply_patch verification failed: Failed to find expected lines
```

### Context
- Editing `op-rank-time-openpangu-flash-css3d.html`.
- The source used raw double quotes inside template literals while the failed patch context contained escaped quotes.
- A follow-up `rg` command also had an unmatched shell quote while locating the exact line.
- A later CSS hunk assumed a neighboring rule body that differed from the file; splitting style and coordinate edits resolved it.
- Recurred at 2026-07-15T00:00:00+08:00 when a broad `**Priority**: low` patch hunk updated the first error entry instead of the intended later entry. Metadata edits also require entry-specific heading context.

### Suggested Fix
Read the exact source hunk first, use single-quoted search patterns, and split unrelated hunks into separate patches.

### Metadata
- Reproducible: yes
- Related Files: op-rank-time-openpangu-flash-css3d.html

---

## [ERR-20260714-004] node module extraction regex escaping

**Logged**: 2026-07-14T16:09:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
An inline Node syntax-check command failed before reading the page because the shell/JavaScript regular-expression escaping produced an unterminated regexp.

### Error
```
Unterminated regexp literal
SyntaxError: Invalid regular expression flags
```

### Context
- Target: `op-rank-time-openpangu-flash-events.html`.
- The failure was in the validation command, not in the page module.
- The command tried to extract `<script type="module">` with a regex embedded inside a shell-quoted `node -e` expression.
- Recurred at 2026-07-14T16:42:00+08:00 when a second inline assertion mixed shell double quotes, JavaScript template-literal backticks, and `${...}` text, producing `zsh: unmatched "` before Node ran.
- Recurred at 2026-07-14T19:20:00+08:00 when a generic inline-script checker passed the ES module body to `vm.Script`, then a follow-up single-quoted `node -e` expression was truncated by embedded single quotes.
- Recurred at 2026-07-15T00:00:00+08:00 when the checker skipped `type="module"` but still passed `type="importmap"` JSON to `vm.Script`. Inline HTML validators must skip every non-classic script type, not just modules.

### Suggested Fix
Extract the module using `indexOf`/`slice` delimiters inside Node instead of stacking shell, JavaScript string, and regular-expression escaping. For assertions containing backticks or `${...}`, single-quote the entire `node -e` program or avoid embedding the source fragment.

### Metadata
- Reproducible: yes
- Related Files: op-rank-time-openpangu-flash-events.html

### Resolution
- **Resolved**: 2026-07-14T16:10:00+08:00
- **Notes**: Replaced the regex with delimiter-based `indexOf` extraction, parsed the module with `vm.SourceTextModule`, and used a shell-safe double-quoted Node program.

---

## [ERR-20260713-002] browser runtime unavailable

**Logged**: 2026-07-13T16:05:00+08:00
**Priority**: low
**Status**: pending
**Area**: frontend

### Summary
The in-app browser runtime initialized, but browser discovery returned no available browser instances for localhost visual QA.

### Error
```
No browser is available
agent.browsers.list() => []
```

### Context
- Target: `http://localhost:8765/pangu-moe-trainviz/op-rank-time-openpangu-flash-css3d.html`
- The local HTTP server returned 200 OK.
- Browser bootstrap troubleshooting was read and the existing runtime was reused as required.
- Recurred on 2026-07-14 while validating `op-rank-time-openpangu-flash-events.html`: the exact page returned HTTP 200 and module syntax passed, but `agent.browsers.list()` again returned `[]`.
- Recurred on 2026-07-15 while validating the 80% side-view default and persistent PP `===` bridge. The user-provided screenshot was inspected, module/source assertions and HTTP 200 passed, but browser discovery still returned `[]`, so automated visual QA remained unavailable.
- Recurred again on 2026-07-15 while validating phase-specific PP bridge metrics and tooltip priority. Module syntax, source assertions, removal of stale EP copy, and HTTP 200 passed; browser discovery still returned `[]`.
- Recurred on 2026-07-15 while validating the persistent Lens toolbar fix on the same events page; browser discovery still returned `[]` after the required troubleshooting flow.

### Suggested Fix
Start or attach an in-app browser instance, then rerun screenshot and interaction verification.

### Metadata
- Reproducible: yes
- Related Files: op-rank-time-openpangu-flash-css3d.html

---

## [ERR-20260715-001] apply_patch empty update hunk

**Logged**: 2026-07-15T09:40:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
An `apply_patch` call failed because it included an empty second file update.

### Error
```
apply_patch verification failed: invalid hunk at line 39, Update hunk does not contain any lines
```

### Context
- The intended learning entry was valid, but the patch also declared an `ERRORS.md` update without any hunk body.
- No target file was changed by the failed call.

### Suggested Fix
Do not include a file in a multi-file patch until its actual hunk is ready; apply independent documentation updates separately when necessary.

### Metadata
- Reproducible: yes
- Related Files: pangu-moe-trainviz/.learnings/LEARNINGS.md, pangu-moe-trainviz/.learnings/ERRORS.md

### Resolution
- **Resolved**: 2026-07-15T09:40:00+08:00
- **Notes**: Reapplied the learning patch without the empty update and added this error in a separate patch.

---

## [ERR-20260714-003] rtk curl wrapper false failure

**Logged**: 2026-07-14T15:31:41+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The filtered `rtk curl` wrapper reported `FAILED: curl` even though the preview server was listening and raw curl returned HTTP 200.

### Error
```
FAILED: curl
```

### Context
- Target: `http://127.0.0.1:8765/pangu-moe-trainviz/op-rank-time-openpangu-flash-events.html`
- `rtk lsof` confirmed the Python server was listening on port 8765.
- `rtk proxy curl -I` succeeded for both `127.0.0.1` and `[::1]`.

### Suggested Fix
Use `rtk proxy curl` for exact raw HTTP validation when the filtered wrapper returns an unexplained failure.

### Metadata
- Reproducible: unknown
- Related Files: op-rank-time-openpangu-flash-events.html

### Resolution
- **Resolved**: 2026-07-14T15:31:41+08:00
- **Notes**: Revalidated the exact page with raw curl; HTTP 200 and the expected content length were returned.

---

# Netflix safe seeking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct Netflix HTML5 seeking with a safe main-world bridge while preserving direct seeking for generic HTML5 players.

**Architecture:** Extend `PlatformAdapter` with `seekTo(timeSeconds, resume)`. The shortcut layer calls that contract only. The generic adapter uses `video.currentTime`; `NetflixAdapter` uses an injected `NetflixSeekTransport`, whose production implementation injects a stable `netflix-bridge.js` page script and exchanges seek/result `CustomEvent`s with Netflix’s internal player API.

**Tech Stack:** TypeScript, MV3 manifest, Vite/Rollup, vanilla DOM events, Vitest, Playwright Chromium fixture.

**Spec:** `docs/superpowers/specs/2026-08-22-netflix-safe-seeking-design.md`

## Global Constraints

- Netflix must never receive a direct `video.currentTime = ...` assignment.
- Generic HTML5 players keep using `currentTime` and `play()`.
- A missing or changed Netflix internal API is a safe no-op, never a direct-seek fallback.
- Cue times remain seconds in SubJap; the bridge receives milliseconds.
- Use `npm.cmd` / `npx.cmd` for Node commands on Windows.
- Preserve existing uncommitted shortcut changes and unrelated user changes.

### Task 1: Add the adapter seek contract

**Files:**
- Modify: `src/core/types.ts` (`PlatformAdapter`)
- Modify: `src/adapters/registry.ts` (generic fallback adapter)
- Test: create `src/adapters/generic-html5.test.ts`

**Interfaces:**
- Produce `seekTo(timeSeconds: number, resume: boolean): Promise<boolean>` on every `PlatformAdapter`.
- Generic implementation resolves the current video, assigns `currentTime`, optionally calls `play()`, and returns `true`; no video returns `false`.

- [ ] **Step 1: Write failing generic adapter tests**

Test the exported generic adapter with a fake video: `seekTo(12, true)` updates `currentTime` and calls `play`; `seekTo(12, false)` does not call `play`; no video returns `false`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm.cmd test -- src/adapters/generic-html5.test.ts`

Expected: FAIL because `seekTo` and the exported adapter test surface do not exist.

- [ ] **Step 3: Implement the minimal contract**

Add the method to `PlatformAdapter`, export the generic fallback adapter for testing, and implement the three cases in `src/adapters/registry.ts`.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npm.cmd test -- src/adapters/generic-html5.test.ts`; then `npx.cmd tsc --noEmit`.

Expected: focused tests pass and no type errors remain.

### Task 2: Route shortcuts through the adapter

**Files:**
- Modify: `src/content/shortcuts.ts`
- Modify: `src/content/shortcuts.test.ts`

**Interfaces:**
- `installPlaybackShortcuts` consumes `Pick<PlatformAdapter, "getCurrentTime" | "seekTo">`.
- On a valid shortcut target it calls `adapter.seekTo(seekTime, true)` and never accesses a video element directly.

- [ ] **Step 1: Add a failing test proving the shortcut delegates**

Use a fake adapter with `getCurrentTime` and a `seekTo` spy; dispatch `s` and assert `seekTo(10, true)` is called. Also assert a rejected seek is caught without an unhandled error.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm.cmd test -- src/content/shortcuts.test.ts`

Expected: FAIL because the current shortcut implementation still requires `getVideoElement` and writes `currentTime` itself.

- [ ] **Step 3: Implement the delegation**

Replace the direct video lookup/write/play block with an awaited/fire-and-forget `adapter.seekTo` call, preserving key filtering and `preventDefault` behavior.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- src/content/shortcuts.test.ts src/adapters/generic-html5.test.ts`.

Expected: all focused tests pass.

### Task 3: Implement the Netflix bridge transport

**Files:**
- Create: `src/adapters/netflix-seek-bridge.ts`
- Create: `src/adapters/netflix-seek-bridge.test.ts`
- Create: `src/netflix-bridge.ts`
- Modify: `src/adapters/netflix.ts`
- Modify: `src/adapters/netflix.test.ts`
- Modify: `src/manifest.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- `NetflixSeekTransport`: `seek(timeSeconds: number, resume: boolean): Promise<boolean>`.
- `NetflixSeekBridge`: injects `netflix-bridge.js` once, dispatches `subjap:netflix-seek`, and resolves from `subjap:netflix-seek-result` with a timeout-safe `false`.
- `NetflixAdapter` constructor accepts an optional `NetflixSeekTransport`; production defaults to `NetflixSeekBridge`, tests can inject a fake transport.
- `NetflixAdapter.seekTo` delegates to the transport and never writes `video.currentTime`.

- [ ] **Step 1: Write failing transport and adapter tests**

Cover request payload conversion from seconds to milliseconds, success acknowledgement, timeout/error result, invalid input rejection, and Netflix adapter delegation with a fake transport. Spy on the video’s `currentTime` setter and assert it is never invoked.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm.cmd test -- src/adapters/netflix-seek-bridge.test.ts src/adapters/netflix.test.ts`

Expected: FAIL because the transport, adapter constructor injection, and `seekTo` method are absent.

- [ ] **Step 3: Implement the isolated-world transport**

Inject `chrome.runtime.getURL("netflix-bridge.js")` into `document.head`/`document.documentElement` once. Register a result listener keyed by `requestId`, dispatch finite non-negative millisecond targets, and resolve `false` on bridge error or timeout. Remove per-request listeners after completion.

- [ ] **Step 4: Implement the page bridge**

In `src/netflix-bridge.ts`, install an idempotent document listener. Validate the event marker and finite non-negative `timeMs`, resolve the active watch session through `window.netflix.appContext.state.playerApp.getAPI().videoPlayer`, call `player.seek(timeMs)`, optionally call the exposed player/video play method, and dispatch an acknowledgement with `ok` or a short error string. Catch all missing API/exception cases.

- [ ] **Step 5: Make the bridge a stable web-accessible build entry**

Add `src/netflix-bridge.ts` as a Vite input with stable output name `netflix-bridge.js`, and add that file to the Netflix-only `web_accessible_resources` entry in `src/manifest.ts` alongside `dict/*`.

- [ ] **Step 6: Wire NetflixAdapter and run focused tests**

Delegate `seekTo` to the injected transport, then run the bridge and Netflix adapter tests. Expected: all pass and no `currentTime` setter is touched by the Netflix path.

### Task 4: Update production wiring and fixture regression

**Files:**
- Modify: `src/content/index.ts`
- Modify: `tests/fixture/main.ts`
- Modify: `tests/e2e/fixture.spec.ts`

**Interfaces:**
- Production content script continues to create `NetflixAdapter()` with its production bridge default.
- Fixture creates `NetflixAdapter` with a fake `NetflixSeekTransport` that updates its simulated clock, so the browser scenario remains deterministic without a real Netflix page API.

- [ ] **Step 1: Add the failing E2E regression for bridge-safe seeking**

Extend the existing `q/s/d` scenario to use the fixture transport and assert the shortcuts still seek, while the injected transport path is used. Add a fixture assertion that an unavailable transport leaves the clock unchanged rather than throwing.

- [ ] **Step 2: Run the focused E2E test and verify failure**

Run: `npx.cmd playwright test tests/e2e/fixture.spec.ts -g "navigue entre"`

Expected: FAIL until the fixture uses the new adapter transport contract.

- [ ] **Step 3: Wire the content script and fixture**

Keep production `new NetflixAdapter()` unchanged at the call site, update the fixture adapter construction to inject its simulated transport, and change the shortcut installation to use the adapter’s `seekTo` method.

- [ ] **Step 4: Run the focused E2E regression**

Run: `npx.cmd playwright test tests/e2e/fixture.spec.ts -g "navigue entre"`.

Expected: PASS, including the form-focus guard and all three shortcut positions.

### Task 5: Full verification and handoff

**Files:**
- No additional source files; inspect all modified files and generated build output.

- [ ] **Step 1: Run the complete unit suite**

Run: `npm.cmd test`

Expected: 0 failures.

- [ ] **Step 2: Run typecheck and lint**

Run: `npx.cmd tsc --noEmit`; then `npm.cmd run lint`.

Expected: typecheck succeeds; lint has zero errors and does not add warnings beyond the existing baseline.

- [ ] **Step 3: Build the extension and verify the bridge asset**

Run: `npm.cmd run build`; verify `dist/netflix-bridge.js` exists and the manifest lists it as a web-accessible resource.

- [ ] **Step 4: Run all Playwright fixture scenarios**

Run: `npx.cmd playwright test`

Expected: all scenarios pass. Report that this validates the fixture transport, not a real Netflix DRM session.

- [ ] **Step 5: Inspect final diff and status**

Run: `git diff --check; git status --short; git diff --stat`.

Expected: only the bridge implementation, adapter contract, fixture/tests, plan/spec documents, and the pre-existing shortcut changes are present; no `test-results/` or `playwright-report/` files are added.

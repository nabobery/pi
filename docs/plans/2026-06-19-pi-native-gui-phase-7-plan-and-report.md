# Pi Native GUI Phase 7 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the Pi native desktop GUI baseline with deterministic Electron E2E proof, strict coverage, renderer behavior tests, and process-boundary/security regression tests without adding new product scope.

**Architecture:** Electron main remains the only owner of Pi runtime objects, filesystem access, shell access, and session-driver lifecycle state. The preload bridge exposes only the typed `window.piGui.invoke` and `window.piGui.subscribe` client boundary, while React continues to consume immutable store snapshots and typed GUI events. Phase 7 adds a test-only fake session driver and E2E build shim so desktop reliability can be proven without real provider credentials, paid tokens, or a browser/server runtime boundary.

**Tech Stack:** Electron, Playwright Electron, Effect Schema, TypeScript, React, React DOM, happy-dom, Vitest, V8 coverage, oxlint, oxfmt, electron-vite.

---

## Phase 7 Scope

Phase 7 is the **P0 Hardening And Proof** phase for `packages/gui`.

In scope:

- Keep existing coverage thresholds:
  - 80% lines
  - 80% statements
  - 80% functions
  - 70% branches
- Add focused tests until `npm --prefix packages/gui run test:coverage` passes.
- Add deterministic Electron E2E coverage that never calls real model providers.
- Use a test-only fake session driver only when:
  - `NODE_ENV === "test"`
  - `PI_GUI_TEST_FAKE_DRIVER === "1"`
- Keep `PiSdkSessionDriver` as the production default.
- Keep Electron main as the only runtime owner.
- Keep renderer as a typed client.
- Replace sleep-style E2E flushing with explicit receipt/event waits.
- Capture E2E diagnostics from:
  - main process console
  - renderer console
  - page errors
  - Electron process exit
- Prove secure preload surface:
  - `window.piGui.invoke`
  - `window.piGui.subscribe`
- Prove raw Electron IPC event objects are not delivered to renderer subscribers.
- Prove malformed renderer commands return `InvalidRendererCommand`.
- Prove catalog parse failures become bootstrap warnings and do not prevent startup.
- Prove selected workspace/session restore across app restart.
- Prove fake prompt run lifecycle:
  - accepted receipt
  - `run.started`
  - timeline delta
  - tool start/update/finish
  - `run.completed`
- Prove fake long-running prompt cancellation:
  - `run.cancelled`
- Prove extension UI request and response flow.
- Add DOM-based renderer tests for extracted app panels.
- Keep coverage exclusions limited to entrypoint wrappers.
- Strengthen process-boundary tests.

Out of scope:

- `/resume`
- `/tree`
- `/compact`
- `/share`
- Slash command palette
- Background sessions
- Queue editing
- Full settings editor
- Saving trust decisions
- New desktop product features
- WebSocket/server runtime boundary
- Real-provider E2E tests
- Network-backed model calls
- Paid-token validation

## Implemented Changes

### Deterministic Electron E2E Harness

Modified `packages/gui/test/electron/shell.spec.ts`.

- Launches Electron with isolated temp state per test:
  - temp `HOME`
  - temp workspace path
  - `NODE_ENV=test`
  - `PI_GUI_TEST_FAKE_DRIVER=1`
  - `ELECTRON_ENABLE_LOGGING=1`
- Cleans temp `HOME` and temp workspace after each test.
- Restarts Electron with the same isolated `HOME` to prove persisted catalog selection restore.
- Captures diagnostics:
  - Electron main-process console errors
  - renderer console errors
  - renderer page errors
  - main-process exit code/signal
- Fails tests if unexpected diagnostics are observed.
- Uses explicit wait helpers:
  - `invokeAndWait`
  - `waitForEvents`
  - `waitForMatchingEvent`
- Removes timing flush assumptions.
- Subscribes before actions that emit expected events, avoiding missed fast IPC events.
- Makes timeout errors include observed receipts and observed event tags.

E2E scenarios now covered:

- secure shell launches
- `window.piGui` exposes only `invoke` and `subscribe`
- bootstrap emits accepted and completed receipts
- workspace add
- workspace sync
- session create
- close then open session
- app restart with selected workspace/session restore
- explicit session open after restart
- fake prompt send with run/timeline/tool/completion events
- fake long-running prompt cancel
- fake extension confirm request render and resolution
- malformed renderer command returns `InvalidRendererCommand`
- invalid catalog file returns `CatalogParseFailed` warning and still starts

Important behavior decisions:

- `session.create` opens the runtime by design through `SessionSupervisor.createSession()`.
- E2E exercises `session.open` by closing the created runtime first, then reopening it.
- Restart restore verifies catalog selection, then explicitly opens the selected session before sending prompts.

### Test-Only Fake Session Driver

Added `packages/gui/src/main/session/fake-session-driver.ts`.

- Implements the `SessionDriver` interface for deterministic tests.
- Exports `PI_GUI_FAKE_DRIVER_ENV`.
- Exports `FAKE_RUNTIME_PROMPTS` constants for E2E scenario selection.
- Enables fake driver only through `shouldUseFakeSessionDriver()` when both test conditions are true.
- Uses one `activeRun` object per fake runtime state.
- Clears `activeRun` on:
  - resolve
  - reject
  - cancel
  - close
- Makes cancel idempotent.
- Rejects overlapping fake runs with a clear error.
- Throws a clear error for invalid session paths that do not end in `.jsonl`.
- Derives the runtime session ID from Pi session filenames by using the suffix after the final underscore.
- Emits deterministic assistant text deltas.
- Emits deterministic tool start/update/finish runtime events.
- Supports delayed completion for cancel tests.
- Supports extension UI request injection for confirm/input/select/editor scenarios.
- Never imports renderer code.

Modified `packages/gui/src/main/ipc-router.ts`.

- Selects `FakeSessionDriver` only when `shouldUseFakeSessionDriver()` is true.
- Keeps `PiSdkSessionDriver` as the production default.
- Keeps `SessionSupervisor` as the owner of runtime lifecycle semantics.

Added `packages/gui/test/main/session/fake-session-driver.test.ts`.

- Proves fake-driver env flag is ignored outside `NODE_ENV=test`.
- Proves deterministic runtime events.
- Proves steering delivery mode returns a completion promise.
- Proves cancel is idempotent.
- Proves overlapping fake runs are rejected.
- Proves invalid fake session paths fail clearly.

### Test-Only Runtime Build Shim

Added `packages/gui/src/main/test-runtime-shim.ts`.

- Provides the narrow runtime export surface required for Electron E2E fake-runtime builds.
- Throws clear errors if the real SDK runtime creation functions are accidentally used in an E2E fake-runtime build.
- Keeps the Electron E2E app launch independent from real provider credentials and real Pi SDK runtime initialization.
- Uses `process.env.HOME ?? homedir()` for isolated E2E state.

Modified `packages/gui/electron.vite.config.ts`.

- Adds `PI_GUI_E2E_BUILD=1` support.
- Aliases `@earendil-works/pi-coding-agent/runtime` to the test runtime shim only during E2E builds.
- Bundles the base coding-agent package only for E2E fake-runtime builds.
- Keeps production builds pointed at the normal Pi runtime subpath.

Modified `packages/gui/package.json`.

- Changes `test:electron` to:

```bash
PI_GUI_E2E_BUILD=1 npm run build && playwright test -c playwright.config.ts
```

Reason:

- Electron E2E should prove GUI contracts and runtime supervision deterministically.
- Real SDK/provider behavior belongs in focused SDK tests and manual smoke tests, not in P0 desktop E2E.

### IPC Serialization And Catalog Isolation

Modified `packages/gui/src/main/ipc-router.ts`.

- Serializes GUI errors to plain contract-shaped values before returning them through IPC.
- Applies the same plain serialization to bootstrap warnings.
- Preserves `_tag`, `message`, and optional string `cause`.

Reason:

- Effect tagged errors are `Error` subclasses.
- Electron structured clone can strip class/error instance fields.
- Renderer and E2E should receive the same typed shape that Effect Schema expects.

Modified `packages/gui/src/main/catalog/json-catalog-store.ts`.

- `defaultCatalogPath()` now respects `process.env.HOME ?? homedir()`.

Reason:

- Electron E2E sets isolated `HOME`.
- The GUI should not read or mutate the developer's real `~/.pi/gui/catalog.json` during tests.

### Preload Transport Hardening

Added `packages/gui/src/preload/electron-transport.ts`.

- Extracts Electron IPC transport creation from the preload entrypoint.
- Drops the raw Electron event argument before delivering event payloads to the renderer API.
- Keeps fixed IPC channels:
  - `PI_GUI_INVOKE_CHANNEL`
  - `PI_GUI_EVENT_CHANNEL`

Modified `packages/gui/src/preload/index.ts`.

- Uses `createPiGuiElectronTransport(ipcRenderer)`.
- Keeps `contextBridge.exposeInMainWorld("piGui", createPiGuiApi(...))` as the only exposed surface.

Added `packages/gui/test/preload/electron-transport.test.ts`.

- Proves fixed channels are used.
- Proves raw Electron event objects are not delivered to renderer listeners.
- Proves unsubscribe removes the exact installed listener.

Modified `packages/gui/test/preload/pi-gui-api.test.ts`.

- Proves the public renderer API key surface remains exactly:
  - `invoke`
  - `subscribe`
- Proves transport event payloads are delivered without exposing transport internals.

### Renderer Component Extraction

Modified `packages/gui/src/renderer/app/App.tsx`.

- Keeps `ReadyApp` as the shell orchestrator.
- Moves behavior-heavy local UI pieces into testable components.
- Keeps state in `app-store.ts`.
- Does not introduce React context or a new state library.

Added `packages/gui/src/renderer/app/app-panels.tsx`.

Extracted components:

- `RuntimeControls`
- `Composer`
- `SettingsTrustPanel`
- `ExtensionUiInlineState`
- `ExtensionUiLayer`

Behavior preserved:

- Runtime controls preserve model IDs containing `/` by using option indexes rather than parsing display text.
- Composer renders:
  - `Send` when ready
  - `Steer`, `Follow-up`, and `Cancel` when running/cancelling
- Composer preserves draft if send is rejected by the store.
- Composer clears draft after accepted send through `ReadyApp`.
- Extension confirm/input/select/editor requests submit through typed store commands.
- Escape cancels active extension requests.
- `getEditorText` responds once per request ID.
- Settings buttons route to typed global/project open/reveal commands.

### Renderer DOM Tests

Added exact-pinned dev dependency:

- `happy-dom: 20.10.5`

Modified `packages/gui/vitest.config.ts`.

- Includes `test/**/*.test.tsx`.
- Keeps default test environment as `node`.
- Uses per-file `@vitest-environment happy-dom` comments for renderer DOM tests.
- Excludes only entrypoint wrappers from coverage:
  - `src/main/main.ts`
  - `src/preload/index.ts`
  - `src/renderer/main.tsx`

Added `packages/gui/test/renderer/app-panels.test.tsx`.

- Tests composer send/steer/follow-up/cancel behavior through DOM events.
- Tests runtime controls and slash-containing model IDs.
- Tests settings global/project open/reveal routing.
- Tests extension inline state rendering.
- Tests confirm submit.
- Tests Escape cancel.
- Tests input/select/editor submit.
- Tests `getEditorText` one-shot response.

Added `packages/gui/test/renderer/App.test.tsx`.

- Tests startup loading shell.
- Tests failed bootstrap state.
- Tests ready shell rendering.
- Tests dependent state loading through typed commands.
- Tests prompt sending.
- Tests runtime settings routing.

Added `packages/gui/test/renderer/catalog-view.test.tsx`.

- Tests empty workspace state.
- Tests missing workspace state.
- Tests selected session metadata.
- Tests archived sessions.
- Tests user/assistant/tool/error timeline rows.
- Tests workspace/session controls through rendered DOM events.

### Main-Process And Security Proof Tests

Added `packages/gui/test/main/window.test.ts`.

- Proves packaged file target loads.
- Proves dev URL target loads.
- Proves `ready-to-show` calls `show`.
- Proves navigation guard allows app URLs.
- Proves navigation guard blocks disallowed URLs.
- Proves `window.open` is denied.

Modified `packages/gui/test/main/content-security-policy.test.ts`.

- Proves CSP header registration preserves existing response headers.
- Proves production/dev CSP helpers still produce expected policies.

Added `packages/gui/test/main/session/highlight-js-electron.test.ts`.

- Proves the Electron build highlight.js shim is importable.

Modified `packages/gui/test/main/bootstrap.test.ts`.

- Adds focused startup/bootstrap failure coverage.

Modified `packages/gui/test/main/session/extension-host-ui-service.test.ts`.

- Adds coverage for:
  - notify/status/title/editor updates
  - paste/get editor text mirror
  - unsupported rich UI compatibility events
  - unsupported custom UI rejection
  - unsupported theme behavior
  - pending request cancellation on session close

Modified `packages/gui/test/shared/process-boundaries.test.ts`.

- Renderer cannot import:
  - `electron`
  - `node:*`
  - main modules
  - Pi runtime packages
- Preload cannot import:
  - main modules
  - renderer modules
  - Pi runtime packages
- Main cannot import renderer modules.
- Contracts cannot import:
  - Electron
  - Node modules
  - main modules
  - preload modules
  - renderer modules
  - Pi runtime packages

### Ignore And Generated Artifacts

Staged `.gitignore` currently changes:

```diff
-# plans/
+plans/
```

Review note:

- This appears unrelated to Phase 7 hardening.
- It ignores root-level `plans/`, not `docs/plans/`.
- The working tree currently has this hunk reverted.
- Unless this was intentional, do not include it in the final commit.

Generated E2E artifacts:

- `packages/gui/test-results/` was produced during failing Playwright runs and removed after verification.
- No Playwright output artifacts should be committed.

## Task-By-Task Implementation Plan

### Task 1: Add Fake Driver Flag Guard

**Files:**

- Create: `packages/gui/src/main/session/fake-session-driver.ts`
- Test: `packages/gui/test/main/session/fake-session-driver.test.ts`

**Step 1: Write the failing test**

Add a test that proves fake runtime is enabled only when both `NODE_ENV=test` and `PI_GUI_TEST_FAKE_DRIVER=1` are present.

Expected assertion:

```ts
expect(shouldUseFakeSessionDriver({ NODE_ENV: "test", PI_GUI_TEST_FAKE_DRIVER: "1" })).toBe(true);
expect(shouldUseFakeSessionDriver({ NODE_ENV: "production", PI_GUI_TEST_FAKE_DRIVER: "1" })).toBe(false);
expect(shouldUseFakeSessionDriver({ NODE_ENV: "test" })).toBe(false);
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/fake-session-driver.test.ts
```

Expected:

- FAIL because `fake-session-driver.ts` does not exist yet.

**Step 3: Implement minimal fake-driver flag**

Add:

```ts
export const PI_GUI_FAKE_DRIVER_ENV = "PI_GUI_TEST_FAKE_DRIVER";

export function shouldUseFakeSessionDriver(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.NODE_ENV === "test" && env[PI_GUI_FAKE_DRIVER_ENV] === "1";
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/fake-session-driver.test.ts
```

Expected:

- PASS.

**Step 5: Commit checkpoint**

```bash
git add packages/gui/src/main/session/fake-session-driver.ts packages/gui/test/main/session/fake-session-driver.test.ts
git commit -m "test(gui): add test-only fake runtime guard"
```

### Task 2: Implement Fake Session Driver Lifecycle

**Files:**

- Modify: `packages/gui/src/main/session/fake-session-driver.ts`
- Modify: `packages/gui/test/main/session/fake-session-driver.test.ts`

**Step 1: Write failing lifecycle tests**

Add tests for:

- open session
- deterministic model thinking snapshot
- deterministic assistant/tool runtime events
- transcript snapshot
- idempotent cancel
- overlapping run rejection
- invalid path rejection

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/fake-session-driver.test.ts
```

Expected:

- FAIL because the driver methods are not implemented.

**Step 3: Implement minimal driver**

Implement `SessionDriver` methods:

- `openSession`
- `closeSession`
- `sendMessage`
- `cancelRun`
- `getTranscript`
- `getModelThinking`
- `setModel`
- `setThinkingLevel`
- `subscribe`

Use one `activeRun` object per open session and clear it through `settleActiveRun()`.

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/fake-session-driver.test.ts
```

Expected:

- PASS.

**Step 5: Commit checkpoint**

```bash
git add packages/gui/src/main/session/fake-session-driver.ts packages/gui/test/main/session/fake-session-driver.test.ts
git commit -m "test(gui): add deterministic fake session driver"
```

### Task 3: Wire Fake Driver Into Electron Main

**Files:**

- Modify: `packages/gui/src/main/ipc-router.ts`
- Test: `packages/gui/test/main/session/fake-session-driver.test.ts`

**Step 1: Write/confirm guard test**

Confirm the flag guard proves production cannot select the fake driver.

**Step 2: Modify IPC router driver selection**

Use:

```ts
const driver: SessionDriver = shouldUseFakeSessionDriver()
	? new FakeSessionDriver({ extensionHostUiService })
	: new PiSdkSessionDriver({ runtimeSupervisor });
```

**Step 3: Run focused test**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/fake-session-driver.test.ts
```

Expected:

- PASS.

**Step 4: Commit checkpoint**

```bash
git add packages/gui/src/main/ipc-router.ts packages/gui/src/main/session/fake-session-driver.ts packages/gui/test/main/session/fake-session-driver.test.ts
git commit -m "test(gui): wire fake runtime into test ipc path"
```

### Task 4: Add E2E Runtime Build Shim

**Files:**

- Create: `packages/gui/src/main/test-runtime-shim.ts`
- Modify: `packages/gui/electron.vite.config.ts`
- Modify: `packages/gui/package.json`
- Modify: `package-lock.json`

**Step 1: Run Electron E2E to expose launch/runtime import failures**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected:

- FAIL if the packaged Electron app tries to resolve unavailable runtime modules in the fake-runtime test build.

**Step 2: Add test runtime shim**

Create a minimal shim for the runtime exports that GUI main imports during E2E fake-runtime builds.

Important:

- Runtime creation functions should throw clear errors.
- Settings/trust helpers should return deterministic defaults.
- The shim must not import renderer code.

**Step 3: Alias runtime subpath only during E2E build**

In `packages/gui/electron.vite.config.ts`, use `PI_GUI_E2E_BUILD=1` to choose the shim.

**Step 4: Update Electron test script**

Use:

```json
"test:electron": "PI_GUI_E2E_BUILD=1 npm run build && playwright test -c playwright.config.ts"
```

**Step 5: Run Electron E2E**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected:

- Electron launches.
- Remaining failures are scenario assertions, not startup failures.

**Step 6: Commit checkpoint**

```bash
git add packages/gui/src/main/test-runtime-shim.ts packages/gui/electron.vite.config.ts packages/gui/package.json package-lock.json
git commit -m "test(gui): add e2e fake runtime build shim"
```

### Task 5: Harden Electron E2E Waits

**Files:**

- Modify: `packages/gui/test/electron/shell.spec.ts`

**Step 1: Replace sleep/flush waits**

Add helpers:

- `invokeAndWait`
- `waitForEvents`
- `waitForMatchingEvent`

Each helper must:

- subscribe before the action when possible
- set an explicit timeout
- clean up the subscription on resolve/reject/timeout
- include observed events in timeout errors

**Step 2: Add diagnostics capture**

Capture:

- `app.on("console")`
- `page.on("console")`
- `page.on("pageerror")`
- `app.process().once("exit")`

**Step 3: Run Electron E2E**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected:

- E2E failures, if any, include useful observed receipts/events.

**Step 4: Commit checkpoint**

```bash
git add packages/gui/test/electron/shell.spec.ts
git commit -m "test(gui): make electron e2e waits diagnostic"
```

### Task 6: Add E2E Product Baseline Scenarios

**Files:**

- Modify: `packages/gui/test/electron/shell.spec.ts`
- Modify: `packages/gui/src/main/catalog/json-catalog-store.ts`
- Modify: `packages/gui/src/main/ipc-router.ts`

**Step 1: Add secure shell scenario**

Assert:

- app loads
- composer exists
- `window.piGui` exists
- no `process`
- no `require`
- no `ipcRenderer`
- no `electronAPI`
- API keys are exactly `invoke` and `subscribe`

**Step 2: Add lifecycle scenario**

Assert:

- bootstrap
- workspace add
- workspace sync
- session create
- session close
- session open
- restart
- bootstrap restore
- explicit session open
- prompt send
- cancel delayed prompt

**Step 3: Add extension UI scenario**

Assert:

- fake confirm prompt emits `extensionUi.requested`
- dialog renders
- confirm click emits `extensionUi.resolved`

**Step 4: Add malformed command and invalid catalog scenario**

Assert:

- invalid catalog emits `CatalogParseFailed` warning
- backup path contains `.invalid`
- malformed `workspace.add` returns `InvalidRendererCommand`

**Step 5: Fix catalog and IPC clone issues**

If invalid catalog warning does not cross IPC correctly:

- make `defaultCatalogPath()` respect `process.env.HOME`
- serialize bootstrap warnings and command errors into plain GUI error objects

**Step 6: Run Electron E2E**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected:

- PASS.

**Step 7: Commit checkpoint**

```bash
git add packages/gui/test/electron/shell.spec.ts packages/gui/src/main/catalog/json-catalog-store.ts packages/gui/src/main/ipc-router.ts
git commit -m "test(gui): prove desktop shell e2e baseline"
```

### Task 7: Extract Renderer Panels

**Files:**

- Modify: `packages/gui/src/renderer/app/App.tsx`
- Create: `packages/gui/src/renderer/app/app-panels.tsx`

**Step 1: Move behavior-heavy panels**

Extract:

- `RuntimeControls`
- `Composer`
- `SettingsTrustPanel`
- `ExtensionUiInlineState`
- `ExtensionUiLayer`

**Step 2: Keep store ownership unchanged**

Do not introduce:

- React context
- Redux/Zustand/Jotai
- global mutable state

**Step 3: Run typecheck**

Run:

```bash
npm --prefix packages/gui run typecheck
```

Expected:

- PASS.

**Step 4: Commit checkpoint**

```bash
git add packages/gui/src/renderer/app/App.tsx packages/gui/src/renderer/app/app-panels.tsx
git commit -m "test(gui): extract renderer panels for behavior tests"
```

### Task 8: Add Renderer DOM Test Environment

**Files:**

- Modify: `packages/gui/package.json`
- Modify: `package-lock.json`
- Modify: `packages/gui/vitest.config.ts`

**Step 1: Install exact-pinned DOM test dependency**

Run:

```bash
npm install --workspace packages/gui --save-dev --save-exact happy-dom@20.10.5 --ignore-scripts
```

Expected:

- `packages/gui/package.json` includes `"happy-dom": "20.10.5"`.
- `package-lock.json` is updated.

**Step 2: Include TSX tests**

Update `packages/gui/vitest.config.ts`:

```ts
include: ["test/**/*.test.ts", "test/**/*.test.tsx"];
```

**Step 3: Keep environment local to renderer tests**

Use file headers:

```ts
/**
 * @vitest-environment happy-dom
 */
```

**Step 4: Run package check**

Run:

```bash
npm --prefix packages/gui run check
```

Expected:

- PASS.

**Step 5: Commit checkpoint**

```bash
git add packages/gui/package.json package-lock.json packages/gui/vitest.config.ts
git commit -m "test(gui): add renderer dom test environment"
```

### Task 9: Add Renderer Behavior Tests

**Files:**

- Create: `packages/gui/test/renderer/app-panels.test.tsx`
- Create: `packages/gui/test/renderer/App.test.tsx`
- Create: `packages/gui/test/renderer/catalog-view.test.tsx`

**Step 1: Test app panels through DOM events**

Cover:

- composer ready send
- composer running steer/follow-up/cancel
- runtime model selector with slash-containing IDs
- settings open/reveal buttons
- extension confirm/input/select/editor submit
- Escape cancel
- `getEditorText` one-shot response

**Step 2: Test ReadyApp behavior**

Cover:

- loading shell
- failed bootstrap shell
- selected workspace/session shell
- settings/trust/transcript load commands
- prompt send and draft clear
- model/thinking commands

**Step 3: Test catalog view behavior**

Cover:

- empty workspace
- missing workspace
- selected session metadata
- archived sessions
- user/assistant/tool/error timeline rows
- workspace/session controls

**Step 4: Run renderer tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/App.test.tsx test/renderer/app-panels.test.tsx test/renderer/catalog-view.test.tsx
```

Expected:

- PASS.

**Step 5: Commit checkpoint**

```bash
git add packages/gui/test/renderer/App.test.tsx packages/gui/test/renderer/app-panels.test.tsx packages/gui/test/renderer/catalog-view.test.tsx
git commit -m "test(gui): cover renderer behavior with dom tests"
```

### Task 10: Harden Preload API Proof

**Files:**

- Create: `packages/gui/src/preload/electron-transport.ts`
- Modify: `packages/gui/src/preload/index.ts`
- Create: `packages/gui/test/preload/electron-transport.test.ts`
- Modify: `packages/gui/test/preload/pi-gui-api.test.ts`

**Step 1: Extract Electron transport**

Move raw `ipcRenderer` handling into `electron-transport.ts`.

**Step 2: Drop raw Electron events**

The installed handler should call:

```ts
listener(value);
```

not:

```ts
listener(event);
```

**Step 3: Test transport behavior**

Assert:

- invoke uses `PI_GUI_INVOKE_CHANNEL`
- subscribe uses `PI_GUI_EVENT_CHANNEL`
- raw Electron event is never delivered to renderer listener
- unsubscribe removes listener

**Step 4: Test API surface**

Assert:

```ts
expect(Reflect.ownKeys(api)).toEqual(["invoke", "subscribe"]);
```

**Step 5: Run preload tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/preload/electron-transport.test.ts test/preload/pi-gui-api.test.ts
```

Expected:

- PASS.

**Step 6: Commit checkpoint**

```bash
git add packages/gui/src/preload/electron-transport.ts packages/gui/src/preload/index.ts packages/gui/test/preload/electron-transport.test.ts packages/gui/test/preload/pi-gui-api.test.ts
git commit -m "test(gui): prove preload api boundary"
```

### Task 11: Add Main-Process Security And Coverage Tests

**Files:**

- Create: `packages/gui/test/main/window.test.ts`
- Modify: `packages/gui/test/main/content-security-policy.test.ts`
- Create: `packages/gui/test/main/session/highlight-js-electron.test.ts`
- Modify: `packages/gui/test/main/bootstrap.test.ts`
- Modify: `packages/gui/test/main/session/extension-host-ui-service.test.ts`

**Step 1: Test window creation**

Cover:

- file target load
- URL target load
- `ready-to-show`
- navigation guard
- denied popups

**Step 2: Test CSP registration**

Cover:

- dev policy
- production policy
- header registration preserves existing headers

**Step 3: Test Electron build shims**

Cover:

- `highlight-js-electron.ts` can be imported in main-process test context.

**Step 4: Test extension host UI uncovered branches**

Cover:

- notify/status/title/editor update events
- compatibility events
- custom UI rejection
- theme fallback behavior
- cancellation of pending session requests

**Step 5: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/window.test.ts test/main/content-security-policy.test.ts test/main/session/highlight-js-electron.test.ts test/main/session/extension-host-ui-service.test.ts
```

Expected:

- PASS.

**Step 6: Commit checkpoint**

```bash
git add packages/gui/test/main/window.test.ts packages/gui/test/main/content-security-policy.test.ts packages/gui/test/main/session/highlight-js-electron.test.ts packages/gui/test/main/bootstrap.test.ts packages/gui/test/main/session/extension-host-ui-service.test.ts
git commit -m "test(gui): cover main process security paths"
```

### Task 12: Strengthen Process Boundary Tests

**Files:**

- Modify: `packages/gui/test/shared/process-boundaries.test.ts`

**Step 1: Add renderer boundary assertions**

Renderer must not import:

- `electron`
- `node:*`
- main modules
- Pi runtime packages

**Step 2: Add preload boundary assertions**

Preload must not import:

- main modules
- renderer modules
- Pi runtime packages

**Step 3: Add main boundary assertions**

Main must not import renderer modules.

**Step 4: Add contracts boundary assertions**

Contracts must not import:

- Electron
- Node modules
- main modules
- preload modules
- renderer modules
- Pi runtime packages

**Step 5: Run boundary test**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/shared/process-boundaries.test.ts
```

Expected:

- PASS.

**Step 6: Commit checkpoint**

```bash
git add packages/gui/test/shared/process-boundaries.test.ts
git commit -m "test(gui): strengthen process boundary audit"
```

### Task 13: Restore Strict Coverage

**Files:**

- Modify: `packages/gui/vitest.config.ts`
- Modify tests from previous tasks as needed.

**Step 1: Exclude only entrypoint wrappers**

Exclude:

```ts
"src/main/main.ts",
"src/preload/index.ts",
"src/renderer/main.tsx",
```

Do not exclude behavior-heavy modules such as:

- `App.tsx`
- `app-panels.tsx`
- `catalog-view.tsx`
- `ipc-router.ts`
- `session-supervisor.ts`
- `extension-host-ui-service.ts`

**Step 2: Run coverage**

Run:

```bash
npm --prefix packages/gui run test:coverage
```

Expected:

- PASS with thresholds:
  - statements >= 80
  - branches >= 70
  - functions >= 80
  - lines >= 80

**Step 3: Add targeted tests if coverage fails**

Add tests only for meaningful behavior gaps.

**Step 4: Commit checkpoint**

```bash
git add packages/gui/vitest.config.ts packages/gui/test
git commit -m "test(gui): restore strict coverage thresholds"
```

### Task 14: Final Verification

**Files:**

- No new code files expected.
- Review staged files only.

**Step 1: Run package format check**

Run:

```bash
npm --prefix packages/gui run format:check
```

Expected:

- PASS.

**Step 2: Run package lint**

Run:

```bash
npm --prefix packages/gui run lint
```

Expected:

- PASS.

**Step 3: Run package typecheck**

Run:

```bash
npm --prefix packages/gui run typecheck
```

Expected:

- PASS.

**Step 4: Run package tests**

Run:

```bash
npm --prefix packages/gui run check
```

Expected:

- PASS.

**Step 5: Run coverage**

Run:

```bash
npm --prefix packages/gui run test:coverage
```

Expected:

- PASS.

**Step 6: Run Electron E2E**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected:

- PASS.

**Step 7: Run root check**

Run:

```bash
npm run check
```

Expected:

- PASS.

**Step 8: Run whitespace checks**

Run:

```bash
git diff --check
git diff --staged --check
```

Expected:

- PASS.

**Step 9: Review staged diff**

Run:

```bash
git diff --staged --stat
git diff --staged --name-only
```

Expected:

- Only intended GUI hardening files are staged.
- No generated Playwright artifacts are staged.
- No internal docs are staged unless explicitly requested.

**Step 10: Commit**

Suggested commit message:

```text
test(gui): harden desktop E2E and coverage proof

- add a test-only fake session driver with deterministic prompt, cancel, tool, and extension UI flows
- make Electron E2E use isolated HOME/workspaces, explicit receipt/event waits, and startup diagnostics
- split renderer panels for focused DOM behavior coverage across composer, settings, runtime controls, extension UI, and catalog views
- tighten preload, IPC, CSP, window, and process-boundary security proof tests
- add happy-dom for renderer unit tests and keep coverage exclusions limited to entrypoint wrappers
```

## Verification Results

Focused tests run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/fake-session-driver.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/preload/electron-transport.test.ts test/preload/pi-gui-api.test.ts
```

Results:

- `fake-session-driver.test.ts`: 4 tests passed.
- `electron-transport.test.ts`: 1 test passed.
- `pi-gui-api.test.ts`: 7 tests passed.

Final verification run:

```bash
npm --prefix packages/gui run format:check
npm --prefix packages/gui run lint
npm --prefix packages/gui run typecheck
npm --prefix packages/gui run test:coverage
npm --prefix packages/gui run test:electron
npm --prefix packages/gui run check
npm run check
git diff --check
git diff --staged --check
```

Results:

- `format:check`: passed.
- `lint`: passed.
- `typecheck`: passed.
- `test:coverage`: passed.
- `test:electron`: passed with 4 Electron tests.
- `packages/gui run check`: passed with 28 files / 156 tests.
- root `npm run check`: passed.
- `git diff --check`: passed.
- `git diff --staged --check`: passed.

Coverage result:

```text
Statements   : 80.46%
Branches     : 71.37%
Functions    : 84.9%
Lines        : 82.27%
```

Threshold status:

- Statements >= 80: passed.
- Branches >= 70: passed.
- Functions >= 80: passed.
- Lines >= 80: passed.

## Best-Practice Notes

- The fake runtime is explicitly test-only and cannot be enabled in production mode.
- Electron main remains the runtime owner.
- Renderer remains a typed client through preload.
- No WebSocket server was introduced.
- No real provider credentials are needed for E2E.
- The E2E fixture isolates `HOME`, so tests do not touch the user's real Pi catalog.
- The preload API remains intentionally tiny.
- The raw Electron event object is dropped at the preload transport boundary.
- Coverage exclusions are limited to entrypoint wrappers.
- Renderer tests use DOM events instead of direct React element traversal for behavior.
- Dependency addition is exact-pinned and development-only.

## Known Follow-Ups

- Decide whether the staged `.gitignore` `plans/` change is intentional. If not, unstage/revert it before committing.
- Keep `docs/plans/*.md` internal/untracked unless the user explicitly asks to stage planning docs.
- Consider adding a future E2E scenario for input/select/editor extension UI variants when those become important user-facing flows.
- Consider a future `/resume` and `/tree` parity phase after this P0 reliability baseline is merged.

## Final State

Phase 7 establishes the GUI's P0 reliability baseline:

- Unit tests pass.
- Strict coverage thresholds pass.
- Electron E2E passes without provider credentials.
- Root check passes.
- IPC and preload boundaries have security regression tests.
- Renderer behavior has DOM tests.
- Main process security paths have focused tests.
- No Phase 8 product scope was added.

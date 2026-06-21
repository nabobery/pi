# Pi Native GUI Phase 4 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the SDK-backed session runtime layer so Pi GUI can create, open, close, and snapshot real Pi agent session runtimes without implementing prompt execution yet.

**Architecture:** Phase 4 keeps Electron main as the only process that owns Pi SDK objects. The Phase 3 catalog remains the file-backed source of truth for workspaces and session discovery, while the new session supervisor manages opened runtime records keyed by `workspaceId + sessionId`. Preload remains a fixed typed IPC bridge, and the renderer consumes only Effect Schema contracts and renderer-local store modules.

**Tech Stack:** Electron IPC, Effect Schema, TypeScript, Pi coding-agent runtime APIs, `SessionManager`, React `useSyncExternalStore`, electron-vite, oxlint, oxfmt, Vitest.

---

## Phase 4 Scope

Phase 4 is the **SDK Session Driver And Session Supervisor** phase from `docs/plans/2026-06-18-pi-native-gui-implementation-phases.md`.

In scope:

- Add real Pi SDK runtime creation for catalog-created and catalog-opened sessions.
- Add `packages/gui/src/main/session/**` as the main-process runtime integration layer.
- Keep runtime records keyed by `workspaceId:sessionId`.
- Route `session.create`, `session.open`, `session.close`, and `session.getTranscript` through a `SessionSupervisor`.
- Keep workspace and catalog commands routed through the Phase 3 `CatalogService`.
- Bind extensions in existing Pi `"rpc"` mode.
- Project static transcript snapshots from persisted Pi session entries.
- Render runtime status and static transcript entries in the existing minimal desktop shell.
- Keep all renderer/preload boundaries typed and runtime-validated with Effect Schema.
- Add a narrow coding-agent runtime export for GUI usage while preserving the documented root package import surface for extensions.
- Add regression tests for duplicate session IDs across workspaces, runtime lifecycle failures, runtime error context, extension root imports, IPC routing, and process boundaries.

Out of scope:

- Prompt execution.
- Prompt streaming.
- Tool event rendering.
- Composer send/cancel behavior.
- Model and thinking controls.
- Trust/settings UI.
- GUI extension UI prompts.
- Slash commands.
- `/resume`, `/tree`, `/compact`, `/share`.
- Background sessions and queues.
- Packaging, signing, notifications, and remote runtime adapters.

## Implemented Changes

### GUI Runtime Contracts

Modified `packages/gui/src/contracts/**`.

- Added `workspaceId` to runtime-scoped commands:
  - `session.close`
  - `session.getTranscript`
  - `session.sendMessage`
  - `session.cancelRun`
  - `session.setModel`
  - `session.setThinkingLevel`
- Kept deferred runtime mutation commands returning `CommandNotImplemented` in Phase 4.
- Added `replacing` to `SessionStatus`.
- Added `workspaceId` to `session.closed`.
- Added `workspaceId` to `TimelineSnapshot` so transcript snapshots are self-describing and safe when two workspaces contain the same `sessionId`.
- Added `decodeTimelineSnapshot()`.
- Added typed runtime errors:
  - `SessionRuntimeNotFound`
  - `SessionRuntimeCreateFailed`
  - `SessionRuntimeOpenFailed`
  - `SessionRuntimeCloseFailed`
  - `SessionRuntimeBindFailed`
  - `SessionAlreadyOpen`
  - `SessionTranscriptReadFailed`

### Coding-Agent Runtime Export

Added `packages/coding-agent/src/runtime.ts`.

The new runtime subpath exports the narrow SDK surface the GUI needs:

- `getAgentDir`
- `AgentSessionRuntime`
- `CreateAgentSessionRuntimeFactory`
- `CreateAgentSessionRuntimeResult`
- `createAgentSessionRuntime`
- `AgentSessionRuntimeDiagnostic`
- `AgentSessionServices`
- `CreateAgentSessionFromServicesOptions`
- `CreateAgentSessionServicesOptions`
- `createAgentSessionFromServices`
- `createAgentSessionServices`
- `SessionManager`
- `SessionEntry`

Modified `packages/coding-agent/package.json`:

- Added package export:

```json
"./runtime": {
  "types": "./dist/runtime.d.ts",
  "import": "./dist/runtime.js"
}
```

Reason:

- GUI runtime code can import `@earendil-works/pi-coding-agent/runtime` without coupling to deep internal paths.
- The full root package export remains intact for SDK consumers and extensions.
- The GUI avoids importing the full coding-agent root in Electron main, reducing bundle/cycle pressure.

### Extension Loader Preservation

Modified `packages/coding-agent/src/core/extensions/loader.ts`.

- Preserved the documented extension import behavior for `@earendil-works/pi-coding-agent`.
- Kept virtual modules mapped to the package root surface instead of a GUI-specific facade.
- Improved source-mode aliases so tests and source checkouts prefer:
  - `agent/src/index.ts`
  - `ai/src/index.ts`
  - `ai/src/oauth.ts`
  - `tui/src/index.ts`
  - `coding-agent/src/index.ts`
- Preserved dist fallback for packaged builds.
- Added a `require.resolve()` fallback when `import.meta.resolve` is unavailable in transformed Vitest modules.

Added regression coverage in `packages/coding-agent/test/extensions-runner.test.ts`:

- An extension importing `VERSION` from `@earendil-works/pi-coding-agent` loads successfully and registers a flag.

### Main Runtime Layer

Added `packages/gui/src/main/session/session-key.ts`.

- Defines `RuntimeSessionKey`.
- Defines `createRuntimeSessionKey(workspaceId, sessionId)`.
- Runtime key shape is `${workspaceId}:${sessionId}`.

Added `packages/gui/src/main/session/session-driver.ts`.

- Defines `SessionDriver`.
- Phase 4 driver methods:
  - `openSession(request)`
  - `closeSession(handle)`
  - `getTranscript(handle)`
  - `subscribe(handle, listener)`
- Defines `RuntimeSessionHandle` with:
  - `key`
  - `runtime`
  - `sessionFilePath`
  - `sessionId`
  - `sessionManager`
  - `workspaceId`
  - `workspacePath`

Decision:

- The final implementation removed `SessionDriver.createSession`.
- Catalog creation remains owned by Phase 3 `CatalogService`, which creates and persists the session file.
- The runtime driver opens catalog-created sessions and attaches runtime state.
- This avoids an unused creation abstraction and keeps Pi session files as the source of truth.

Added `packages/gui/src/main/session/runtime-supervisor.ts`.

- Wraps Pi runtime construction with:
  - `createAgentSessionRuntime`
  - `createAgentSessionServices`
  - `createAgentSessionFromServices`
  - `getAgentDir`
- Binds extensions with:

```ts
mode: "rpc"
```

- Maps runtime creation and bind failures to typed GUI runtime errors.
- Includes known `workspaceId`, `sessionId`, and `sessionFilePath` in runtime errors when available.
- Disposes partial runtime state when extension binding fails.

Added `packages/gui/src/main/session/pi-sdk-session-driver.ts`.

- Opens session managers with `SessionManager.open(sessionFilePath, sessionDir, workspacePath)`.
- Creates runtime handles through `RuntimeSupervisor`.
- Closes runtime handles through `runtime.dispose()`.
- Projects static transcript snapshots from `sessionManager.getEntries()`.
- Maps open, close, transcript, create, and bind failures to typed GUI errors with known context.
- Uses the new `@earendil-works/pi-coding-agent/runtime` import path.

Added `packages/gui/src/main/session/session-supervisor.ts`.

- Depends on `SessionDriver`, `CatalogService`, and `RendererEventBus`.
- Manages opened runtime records in `Map<RuntimeSessionKey, ManagedSessionRecord>`.
- Routes:
  - `createSession(workspaceId)`
  - `openSession(workspaceId, sessionId)`
  - `closeSession(workspaceId, sessionId)`
  - `getTranscript(workspaceId, sessionId)`
- Emits:
  - `session.statusChanged`
  - `session.opened`
  - `session.closed`
- Emits `opening` before runtime open.
- Emits `ready` after runtime handle creation and subscription.
- Emits `failed` if runtime open fails.
- Closes atomically:
  - first disposes runtime,
  - then unsubscribes,
  - then removes the runtime record,
  - then emits `session.closed`.
- If close disposal fails, it keeps the runtime record and subscription and does not emit `session.closed`.

Added `packages/gui/src/main/session/timeline-projection.ts`.

- Projects persisted Pi session entries into `TimelineSnapshot`.
- Supports user, assistant, tool, and system-style entries.
- Converts text arrays into contiguous transcript text.
- Skips entries that do not project to displayable text.
- Includes `workspaceId` and `sessionId` in every snapshot.

Added `packages/gui/src/main/session/highlight-js-electron.ts`.

- Provides a minimal safe `highlight.js` shim for Electron main bundling.
- Escapes HTML for `highlight()` and `highlightAuto()`.
- Avoids dragging syntax-highlighting internals into the runtime bundle.

### Electron IPC Routing

Modified `packages/gui/src/main/ipc-router.ts`.

- Production IPC registration now constructs:
  - `CatalogService`
  - `RuntimeSupervisor`
  - `PiSdkSessionDriver`
  - `SessionSupervisor`
- Runtime commands route through `SessionSupervisor`:
  - `session.create`
  - `session.open`
  - `session.close`
  - `session.getTranscript`
- Catalog commands remain direct `CatalogService` routes:
  - workspace commands
  - `session.rename`
  - `session.archive`
  - `session.unarchive`
- Later runtime mutation commands still return `CommandNotImplemented`.
- Existing sender validation and receipt emission remain in place.

### Renderer Store And UI

Modified `packages/gui/src/renderer/app/app-store.ts`.

- Added runtime APIs:
  - `closeSession(workspaceId, sessionId)`
  - `getTranscript(workspaceId, sessionId)`
- Added `timelines` to renderer state.
- Applies:
  - `session.opened`
  - `session.statusChanged`
  - `session.closed`
- Stores transcript snapshots by explicit `workspaceId:sessionId`.
- Removes the previous workspace inference path so duplicate session IDs across workspaces are safe.
- Removes timeline state on `session.closed`.
- Continues to decode invoke results and pushed events before state mutation.

Modified `packages/gui/src/renderer/app/App.tsx`.

- Loads transcript snapshots for the selected ready session.
- Leaves composer disabled.
- Does not implement prompt send behavior.

Modified `packages/gui/src/renderer/app/catalog-view.tsx`.

- Displays selected session metadata.
- Displays static transcript entries when available.
- Keeps the empty transcript fallback when no static transcript is loaded.

Modified `packages/gui/src/renderer/styles/app.css`.

- Added minimal transcript list styles.
- Kept the Phase 1-3 minimal shell visual language.

### Build And Test Configuration

Modified `packages/gui/electron.vite.config.ts`.

- Bundles internal Pi workspace dependencies needed by Electron main:
  - `@earendil-works/pi-agent-core`
  - `@earendil-works/pi-ai`
  - `@earendil-works/pi-ai/oauth`
  - `@earendil-works/pi-coding-agent/runtime`
  - `@earendil-works/pi-tui`
- Externalizes build-time/runtime-heavy dependencies:
  - `@babel/core`
  - `highlight.js`
  - `jiti`
- Adds source aliases for the internal Pi packages.
- Aliases `highlight.js/lib/index.js` to the GUI Electron shim.

Modified `packages/gui/tsconfig.json` and `packages/gui/vitest.config.ts`.

- Added aliases for internal Pi package source paths.
- Added alias for `@earendil-works/pi-coding-agent/runtime`.

Modified `packages/gui/package.json` and `package-lock.json`.

- Added `@earendil-works/pi-coding-agent` as a GUI runtime dependency.

## Implementation Plan

### Task 1: Extend Runtime Contracts

**Files:**

- Modify: `packages/gui/src/contracts/commands.ts`
- Modify: `packages/gui/src/contracts/errors.ts`
- Modify: `packages/gui/src/contracts/events.ts`
- Modify: `packages/gui/src/contracts/snapshots.ts`
- Test: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Write failing command contract tests**

Assert `session.close` and `session.getTranscript` require `workspaceId`.

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected before implementation: command decoding accepts missing `workspaceId` or runtime command construction fails to express workspace identity.

**Step 2: Add workspace-scoped runtime commands**

Add `workspaceId` to all runtime-scoped session commands, including deferred commands.

**Step 3: Add runtime errors and statuses**

Add `replacing` to `SessionStatus`, runtime tagged errors to `GuiError`, and `workspaceId` to `session.closed`.

**Step 4: Add workspace-scoped timeline snapshots**

Add `workspaceId` to `TimelineSnapshot` and add `decodeTimelineSnapshot()`.

**Step 5: Verify contracts**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected: all contract tests pass.

### Task 2: Add Coding-Agent Runtime Export

**Files:**

- Create: `packages/coding-agent/src/runtime.ts`
- Modify: `packages/coding-agent/package.json`
- Modify: `packages/coding-agent/src/core/extensions/loader.ts`
- Test: `packages/coding-agent/test/extensions-runner.test.ts`

**Step 1: Write root extension import regression**

Add a test extension that imports `VERSION` from `@earendil-works/pi-coding-agent` and registers a flag.

Run:

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/extensions-runner.test.ts -t "lets extensions import documented root package symbols"
```

Expected before implementation: failure if extension imports are narrowed or aliases cannot resolve package roots in source mode.

**Step 2: Add runtime subpath**

Create `packages/coding-agent/src/runtime.ts` and export only the runtime APIs needed by GUI.

**Step 3: Add package export**

Add `./runtime` to `packages/coding-agent/package.json`.

**Step 4: Preserve extension root import behavior**

Keep extension virtual modules mapped to `../../index.ts` and improve source/dist alias fallback.

**Step 5: Verify coding-agent regression**

Run:

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/extensions-runner.test.ts -t "lets extensions import documented root package symbols"
```

Expected: the targeted regression passes.

### Task 3: Add Runtime Key And Transcript Projection

**Files:**

- Create: `packages/gui/src/main/session/session-key.ts`
- Create: `packages/gui/src/main/session/timeline-projection.ts`
- Test: `packages/gui/test/main/session/session-key.test.ts`
- Test: `packages/gui/test/main/session/timeline-projection.test.ts`

**Step 1: Write failing runtime key tests**

Assert `workspace-a:session-1` and `workspace-b:session-1` are distinct runtime keys.

**Step 2: Implement runtime key helper**

Add `createRuntimeSessionKey(workspaceId, sessionId)`.

**Step 3: Write failing timeline projection tests**

Assert persisted message roles project to `user`, `assistant`, `tool`, and `system` transcript entries and include `workspaceId`.

**Step 4: Implement timeline projection**

Project known persisted entry shapes into `TimelineSnapshot`.

**Step 5: Verify tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-key.test.ts test/main/session/timeline-projection.test.ts
```

Expected: tests pass.

### Task 4: Add Runtime Supervisor And SDK Driver

**Files:**

- Create: `packages/gui/src/main/session/runtime-supervisor.ts`
- Create: `packages/gui/src/main/session/session-driver.ts`
- Create: `packages/gui/src/main/session/pi-sdk-session-driver.ts`
- Test: `packages/gui/test/main/session/runtime-supervisor.test.ts`
- Test: `packages/gui/test/main/session/pi-sdk-session-driver.test.ts`

**Step 1: Write failing runtime supervisor tests**

Assert runtime creation calls the injected runtime factory, binds extensions in `"rpc"` mode, and disposes partial runtime state when binding fails.

**Step 2: Implement runtime supervisor**

Use `createAgentSessionRuntime`, `createAgentSessionServices`, `createAgentSessionFromServices`, and `getAgentDir` from `@earendil-works/pi-coding-agent/runtime`.

**Step 3: Write failing SDK driver tests**

Assert the driver opens from `SessionManager.open`, creates runtime handles, snapshots transcripts, closes runtime handles, and maps failures with workspace/session/file context.

**Step 4: Implement SDK driver**

Implement `openSession`, `closeSession`, `getTranscript`, and `subscribe`.

**Step 5: Verify tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/runtime-supervisor.test.ts test/main/session/pi-sdk-session-driver.test.ts
```

Expected: tests pass.

### Task 5: Add Session Supervisor

**Files:**

- Create: `packages/gui/src/main/session/session-supervisor.ts`
- Test: `packages/gui/test/main/session/session-supervisor.test.ts`

**Step 1: Write failing open lifecycle tests**

Assert opening two records with the same `sessionId` in different workspaces creates two runtime records and emits `opening`, `opened`, and `ready`.

**Step 2: Write failing close lifecycle tests**

Assert close disposes, unsubscribes, removes the record, and emits `session.closed`.

**Step 3: Write failing failure lifecycle tests**

Assert open failure emits `failed` and close failure keeps the runtime record/subscription without emitting `closed`.

**Step 4: Implement session supervisor**

Use `CatalogService` as the catalog owner and `SessionDriver` as the runtime owner. Store runtime records in a `Map<RuntimeSessionKey, ManagedSessionRecord>`.

**Step 5: Verify tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
```

Expected: tests pass.

### Task 6: Route IPC Through Session Supervisor

**Files:**

- Modify: `packages/gui/src/main/ipc-router.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write failing IPC routing tests**

Assert runtime session commands route through an injected `sessionSupervisor`.

**Step 2: Wire production IPC runtime dependencies**

Construct `CatalogService`, `RuntimeSupervisor`, `PiSdkSessionDriver`, and `SessionSupervisor` in `registerGuiIpcHandlers()`.

**Step 3: Route runtime commands**

Route `session.create`, `session.open`, `session.close`, and `session.getTranscript` through `SessionSupervisor`.

**Step 4: Preserve direct catalog routes**

Keep workspace commands and catalog-only session commands routed through `CatalogService`.

**Step 5: Verify IPC tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
```

Expected: tests pass.

### Task 7: Update Renderer Store And Static Transcript UI

**Files:**

- Modify: `packages/gui/src/renderer/app/app-store.ts`
- Modify: `packages/gui/src/renderer/app/App.tsx`
- Modify: `packages/gui/src/renderer/app/catalog-view.tsx`
- Modify: `packages/gui/src/renderer/styles/app.css`
- Test: `packages/gui/test/renderer/app-store.test.ts`

**Step 1: Write failing renderer store tests**

Assert the store handles `session.opened`, `session.statusChanged`, `session.closed`, and `session.getTranscript`.

**Step 2: Write duplicate session ID regression**

Assert transcript results are stored by explicit `workspaceId:sessionId`, not inferred by scanning catalogs.

**Step 3: Implement store updates**

Add `timelines`, `closeSession`, `getTranscript`, runtime event handling, and timeline result handling.

**Step 4: Render static transcripts**

Show transcript entries in the existing main pane when available.

**Step 5: Verify renderer tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
```

Expected: tests pass.

### Task 8: Preserve Process Boundaries And Build Aliases

**Files:**

- Modify: `packages/gui/electron.vite.config.ts`
- Modify: `packages/gui/tsconfig.json`
- Modify: `packages/gui/vitest.config.ts`
- Create: `packages/gui/src/main/session/highlight-js-electron.ts`
- Create: `packages/gui/src/types/highlight-js.d.ts`
- Test: `packages/gui/test/shared/process-boundaries.test.ts`

**Step 1: Write or update boundary tests**

Assert renderer and preload do not import main modules or Pi SDK/runtime packages.

**Step 2: Add GUI runtime aliases**

Alias `@earendil-works/pi-coding-agent/runtime` to source for tests/build.

**Step 3: Configure electron-vite dependency handling**

Bundle internal Pi source dependencies required by Electron main and externalize heavy transitive build/runtime dependencies.

**Step 4: Add highlight shim**

Provide a small HTML-escaping shim for `highlight.js/lib/index.js` in Electron main.

**Step 5: Verify boundary tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/shared/process-boundaries.test.ts
```

Expected: tests pass.

## Review Remediation Included

After implementation review, Phase 4 included these fixes before final verification:

- `TimelineSnapshot` was changed to include `workspaceId`.
- Renderer timeline storage was changed to use explicit snapshot identity instead of scanning catalogs by `sessionId`.
- The global extension virtual API facade was removed from the plan and implementation.
- `@earendil-works/pi-coding-agent/runtime` was added as the narrow GUI runtime import surface.
- `SessionDriver.createSession` was removed because production creation is catalog-first in Phase 4.
- Runtime open failure now emits `failed`.
- Runtime close failure now keeps the runtime record and subscription intact.
- Runtime errors now preserve known `workspaceId`, `sessionId`, and `sessionFilePath`.
- A coding-agent regression test now protects documented extension root imports.

## Verification

Focused GUI contract test:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Result:

- 16 tests passed.

Focused GUI session tests:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts test/main/session/pi-sdk-session-driver.test.ts test/main/session/timeline-projection.test.ts test/main/session/runtime-supervisor.test.ts
```

Result:

- 4 files passed.
- 13 tests passed.

Focused GUI renderer, IPC, and boundary tests:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts test/main/ipc-router.test.ts test/shared/process-boundaries.test.ts
```

Result:

- 3 files passed.
- 22 tests passed.

Coding-agent extension root import regression:

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/extensions-runner.test.ts -t "lets extensions import documented root package symbols"
```

Result:

- 1 targeted test passed.

GUI package check:

```bash
cd packages/gui
npm run check
```

Result:

- `oxfmt --check` passed.
- `oxlint` passed.
- `tsgo --noEmit -p tsconfig.json` passed.
- GUI Vitest suite passed:
  - 19 files passed.
  - 85 tests passed.

Root check:

```bash
npm run check
```

Result:

- Biome check passed and fixed formatting before final staged verification.
- Pinned dependency check passed.
- TypeScript relative import check passed.
- Coding-agent shrinkwrap check passed.
- Root `tsgo --noEmit` passed.
- Browser smoke check passed.
- GUI package check passed.

## Final State

Phase 4 now gives Pi GUI a real SDK-backed runtime attachment layer:

- The main process can create/open catalog sessions and attach live Pi runtimes.
- The main process can close runtimes without leaking renderer trust or SDK objects.
- Static transcript snapshots come from Pi session files.
- Renderer state is workspace-safe and schema-validated.
- Prompt execution and streaming remain correctly deferred to Phase 5.
- Extension root imports remain compatible with existing documented examples.

## Deferred To Phase 5+

- Prompt composer send behavior.
- Agent run lifecycle and cancellation.
- Timeline streaming and tool event rendering.
- Model and thinking controls.
- Extension UI request handling.
- Trust/settings surfaces.
- `/tree`, `/resume`, `/compact`, `/share`, and slash command parity.

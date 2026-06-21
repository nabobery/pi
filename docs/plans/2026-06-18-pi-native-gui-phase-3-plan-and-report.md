# Pi Native GUI Phase 3 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the Pi GUI workspace and session catalog layer so the desktop shell can persist workspaces, discover Pi sessions, create file-backed sessions, and navigate catalog state without starting an agent runtime.

**Architecture:** Phase 3 keeps the GUI Pi-native by treating Pi transcript files and `SessionManager` as the source of truth while the GUI owns only catalog metadata and selected UI state. Electron main owns catalog persistence, filesystem validation, Pi session discovery, and typed IPC command routing; preload remains a narrow transport bridge; renderer consumes a validated React external store backed by Effect Schema contracts.

**Tech Stack:** Electron IPC, Effect Schema, TypeScript, React, `useSyncExternalStore`, Pi `SessionManager`, JSON catalog persistence, oxlint, oxfmt, Vitest, Playwright Electron.

---

## Phase 3 Scope

Phase 3 is the **Workspace Catalog And Session Catalog** phase from `docs/plans/2026-06-18-pi-native-gui-implementation-phases.md`.

In scope:

- Persist GUI catalog metadata at `~/.pi/gui/catalog.json`.
- Add workspace catalog state, selected workspace state, missing workspace recovery, and workspace folder picker support.
- Add session catalog state, selected session per workspace, archive metadata, rename metadata, and real file-backed session creation.
- Reuse Pi `SessionManager` for session discovery, session creation, and `session_info` persistence.
- Extend `packages/gui/src/contracts/**` instead of creating a parallel protocol.
- Decode disk JSON, IPC commands, IPC results, IPC events, and bootstrap payloads with Effect Schema.
- Keep preload as a tiny fixed-channel transport surface.
- Add renderer-side validated API wrapper before catalog state consumes preload values.
- Render a minimal workspace/session sidebar and session metadata pane.
- Keep archived sessions visually separated and collapsed by default.
- Add bootstrap warnings for recoverable catalog parse failures so the renderer can show the warning without racing event subscription.
- Preserve Electron sender validation before catalog mutation.
- Add unit, IPC, renderer-store, preload, and Electron smoke coverage.

Out of scope:

- Agent runtime creation.
- Session supervisor.
- Prompt execution.
- Transcript rendering.
- Model controls.
- Trust/settings UI.
- Extension UI.
- Slash commands.
- `/tree`, `/resume`, `/compact`, `/share`.
- Tailwind, icon libraries, Framer Motion, packaging, signing, notifications, or remote runtime adapters.

## Implemented Changes

### Coding-Agent Session Support

- Modified `packages/coding-agent/src/core/session-manager.ts`.
- Added public `SessionManager.ensureSessionFile(): string | undefined`.
- Behavior:
  - Returns `undefined` for in-memory sessions.
  - Returns the existing session file path without rewriting when the file already exists.
  - Writes the current session entries, including the header, when a persisted session file is missing.
  - Marks the manager flushed after writing.
- Added regression coverage in `packages/coding-agent/test/session-manager/file-operations.test.ts`.

### GUI Contract Surface

Modified `packages/gui/src/contracts/**`:

- Extended `WorkspaceSnapshot` with:
  - `lastOpenedAt`
  - `sortOrder`
  - `missing`
  - optional `selected`
- Extended `SessionSnapshot` with:
  - `updatedAt`
  - `preview`
  - `messageCount`
  - optional `sessionFilePath`
  - optional `archivedAt`
- Added `WorkspaceCatalogSnapshot`.
- Added `SessionCatalogSnapshot`.
- Added bootstrap warnings on `BootstrapSnapshot`.
- Added snapshot decoders:
  - `decodeWorkspaceCatalogSnapshot()`
  - `decodeSessionCatalogSnapshot()`
- Changed Phase 2 command success payloads from `Void` to catalog snapshots where needed.
- Added commands:
  - `workspace.pickDirectory`
  - `workspace.remove`
  - `session.rename`
  - `session.archive`
  - `session.unarchive`
- Updated session mutation commands to include `workspaceId` so session identity is `workspaceId + sessionId`.
- Added events:
  - `workspace.synced`
  - `session.selected`
- Added tagged catalog errors:
  - `InvalidWorkspacePath`
  - `WorkspaceNotFound`
  - `WorkspacePathMissing`
  - `CatalogReadFailed`
  - `CatalogParseFailed`
  - `CatalogWriteFailed`
  - `SessionNotFound`
  - `SessionFileMissing`
  - `SessionSyncFailed`
  - `SessionCreateFailed`
  - `SessionRenameFailed`

### JSON Catalog Store

Added `packages/gui/src/main/catalog/json-catalog-store.ts`.

Catalog file shape:

```ts
{
	version: 1,
	revision,
	selectedWorkspaceId,
	selectedSessionByWorkspace,
	workspaces,
	sessions,
}
```

Implemented behavior:

- Defaults to `~/.pi/gui/catalog.json`.
- Creates empty state when the catalog file is missing.
- Decodes catalog JSON with Effect Schema.
- Normalizes and clones state before returning it to callers.
- Serializes writes through a promise queue.
- Writes atomically by writing a temp file in the catalog directory and renaming it into place.
- On malformed JSON:
  - renames the bad file to a timestamped `.invalid` backup when possible,
  - stores a `CatalogParseFailed` startup warning,
  - continues with an empty catalog.

### Catalog Service

Added `packages/gui/src/main/catalog/catalog-service.ts`.

Implemented workspace behavior:

- `addWorkspace(path)`
  - canonicalizes with `realpath`,
  - rejects missing paths as `InvalidWorkspacePath`,
  - derives deterministic workspace IDs from canonical paths,
  - upserts workspace metadata,
  - selects the workspace,
  - syncs sessions.
- `selectWorkspace(workspaceId)`
  - requires an existing workspace,
  - updates `lastOpenedAt`,
  - preserves `missing` instead of marking stale paths healthy.
- `syncWorkspace(workspaceId)`
  - verifies the workspace path still exists,
  - marks missing paths recoverable as `WorkspacePathMissing`,
  - lists Pi sessions through `SessionManager.list`,
  - merges discovered sessions with GUI metadata,
  - preserves archive metadata,
  - clears selected session when its file disappears.
- `removeWorkspace(workspaceId)`
  - removes only GUI catalog metadata,
  - removes selected session state for that workspace,
  - never deletes Pi session files.

Implemented session behavior:

- `createSession(workspaceId)`
  - requires an existing non-missing workspace,
  - revalidates the workspace with `realpath`,
  - creates a real Pi session with `SessionManager.create`,
  - calls `ensureSessionFile()`,
  - stores title `New session`,
  - selects the new session.
- `openSession(workspaceId, sessionId)`
  - finds by `workspaceId + sessionId`,
  - verifies the file path when present,
  - selects the session,
  - does not start an `AgentSessionRuntime`.
- `renameSession(workspaceId, sessionId, title)`
  - trims and rejects empty titles,
  - opens the session file,
  - calls `ensureSessionFile()`,
  - appends `session_info`,
  - updates GUI catalog title and timestamp.
- `archiveSession(workspaceId, sessionId)` and `unarchiveSession(workspaceId, sessionId)`
  - update only GUI `archivedAt` metadata,
  - do not mutate transcript files.

### Electron IPC Router

Modified `packages/gui/src/main/ipc-router.ts`.

Implemented behavior:

- Keeps sender validation before command decoding and catalog mutation.
- Registers only trusted renderer senders.
- Handles `app.bootstrap` with app info, workspace catalog, and bootstrap warnings.
- Handles:
  - `workspace.add`
  - `workspace.pickDirectory`
  - `workspace.select`
  - `workspace.sync`
  - `workspace.remove`
  - `session.create`
  - `session.open`
  - `session.rename`
  - `session.archive`
  - `session.unarchive`
- Publishes catalog events and receipts:
  - `workspace.catalogUpdated`
  - `session.catalogUpdated`
  - `workspace.synced`
  - `session.selected`
  - `receipt.emitted`
- Publishes recoverable workspace catalog state when a workspace path is missing.
- Leaves later-phase commands as `CommandNotImplemented`.

### Preload And Renderer Boundary

Modified `packages/gui/src/preload/pi-gui-api.ts`.

- Kept preload as a fixed-channel transport bridge.
- Did not expose raw `ipcRenderer`, raw Electron events, dynamic channel names, Node APIs, or main-process modules.

Modified renderer modules:

- Added `packages/gui/src/renderer/app/app-store.ts`.
- Added `packages/gui/src/renderer/app/catalog-view.tsx`.
- Modified `packages/gui/src/renderer/app/bootstrap-loader.ts`.
- Modified `packages/gui/src/renderer/app/App.tsx`.

Renderer behavior:

- Wraps preload with `createValidatedRendererCatalogApi()`.
- Decodes invoke results and events with Effect Schema before state consumes them.
- Converts malformed invoke results into `InternalIpcError`.
- Drops malformed pushed events.
- Uses `useSyncExternalStore` for catalog state.
- Keeps the underlying IPC subscription alive across React subscribe/unsubscribe cycles.
- Seeds initial inline error state from bootstrap warnings.
- Applies:
  - `workspace.catalogUpdated`
  - `session.catalogUpdated`
  - `workspace.synced`
  - `session.selected`
- Supports:
  - empty workspace state,
  - workspace list,
  - selected workspace,
  - missing workspace state,
  - session list,
  - archived session group,
  - selected session metadata,
  - inline errors.
- Adds inline session rename instead of blocking `globalThis.prompt`.

### Build And Test Configuration

Modified GUI config:

- `packages/gui/electron.vite.config.ts`
- `packages/gui/vitest.config.ts`
- `packages/gui/tsconfig.json`

Key config decisions:

- GUI tests/builds resolve `@earendil-works/pi-agent-core` to `../agent/src/index.ts`.
- GUI tests/builds resolve `@earendil-works/pi-ai` to `../ai/src/index.ts`.
- This avoids the previous brittle partial alias to only the agent `uuid.ts` file.

## Implementation Plan

### Task 1: Add SessionManager File Ensuring

**Files:**

- Modify: `packages/coding-agent/src/core/session-manager.ts`
- Test: `packages/coding-agent/test/session-manager/file-operations.test.ts`

**Step 1: Write failing tests**

Add tests for:

- New persisted sessions write a header-only JSONL file.
- Existing session files are not rewritten.
- In-memory sessions return `undefined`.
- `appendSessionInfo()` persists after ensuring the file exists.

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/session-manager/file-operations.test.ts
```

Expected before implementation: `ensureSessionFile` does not exist.

**Step 3: Implement `ensureSessionFile()`**

Add a public method on `SessionManager`:

```ts
ensureSessionFile(): string | undefined {
	if (!this.persist || !this.sessionFile) return undefined;
	if (existsSync(this.sessionFile)) return this.sessionFile;
	this._rewriteFile();
	this.flushed = true;
	return this.sessionFile;
}
```

**Step 4: Run tests and verify pass**

Run the same command.

Expected: all `file-operations.test.ts` tests pass.

**Step 5: Stage explicit files**

Run:

```bash
git add packages/coding-agent/src/core/session-manager.ts packages/coding-agent/test/session-manager/file-operations.test.ts
```

### Task 2: Extend GUI Contracts

**Files:**

- Modify: `packages/gui/src/contracts/commands.ts`
- Modify: `packages/gui/src/contracts/errors.ts`
- Modify: `packages/gui/src/contracts/events.ts`
- Modify: `packages/gui/src/contracts/snapshots.ts`
- Test: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Write failing contract tests**

Add tests that decode:

- new workspace/session commands,
- workspace/session catalog snapshots,
- workspace/session catalog events,
- catalog tagged errors,
- bootstrap snapshots with warnings.

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected before implementation: unknown commands, snapshots, events, or errors fail to decode.

**Step 3: Implement contract changes**

Use Effect Schema for every new payload and error. Keep command/event unions as the only contract entrypoints. Include `workspaceId` on session mutation commands:

```ts
payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId }
```

**Step 4: Run tests and verify pass**

Run the same command.

Expected: contract tests pass.

**Step 5: Stage explicit files**

Run:

```bash
git add packages/gui/src/contracts/commands.ts packages/gui/src/contracts/errors.ts packages/gui/src/contracts/events.ts packages/gui/src/contracts/snapshots.ts packages/gui/test/contracts/contracts.test.ts
```

### Task 3: Add JsonCatalogStore

**Files:**

- Create: `packages/gui/src/main/catalog/json-catalog-store.ts`
- Test: `packages/gui/test/main/catalog/json-catalog-store.test.ts`

**Step 1: Write failing store tests**

Cover:

- missing file returns empty state,
- valid JSON decodes,
- malformed JSON is backed up and returns empty state,
- startup parse warning is available,
- concurrent writes serialize.

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/catalog/json-catalog-store.test.ts
```

Expected before implementation: module does not exist or tests fail.

**Step 3: Implement store**

Implement:

- `CatalogFileState` schema,
- `defaultCatalogPath()`,
- `read()`,
- `update()`,
- write queue,
- temp-file write plus rename,
- invalid-file backup,
- `getStartupWarning()`.

Do not manually coerce disk JSON. Decode with `Schema.decodeUnknown(CatalogFileState)`.

**Step 4: Run tests and verify pass**

Run the same command.

Expected: store tests pass.

**Step 5: Stage explicit files**

Run:

```bash
git add packages/gui/src/main/catalog/json-catalog-store.ts packages/gui/test/main/catalog/json-catalog-store.test.ts
```

### Task 4: Add CatalogService

**Files:**

- Create: `packages/gui/src/main/catalog/catalog-service.ts`
- Test: `packages/gui/test/main/catalog/catalog-service.test.ts`

**Step 1: Write failing service tests**

Cover:

- invalid workspace path rejection,
- canonical workspace add/select,
- session sync from Pi storage,
- archive metadata preservation,
- disappeared sessions removed from GUI catalog only,
- file-backed session creation,
- open/select behavior,
- rename through `SessionManager.appendSessionInfo()`,
- archive/unarchive metadata-only behavior,
- duplicate Pi session IDs across workspaces,
- missing workspace path recovery.

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/catalog/catalog-service.test.ts
```

Expected before implementation: module does not exist or behavior is missing.

**Step 3: Implement service**

Implement workspace and session methods described in the implemented changes section. Use `realpath` for workspace canonicalization and recovery checks. Use `SessionManager.list`, `SessionManager.create`, `SessionManager.open`, `ensureSessionFile()`, and `appendSessionInfo()`.

**Step 4: Run tests and verify pass**

Run the same command.

Expected: service tests pass.

**Step 5: Stage explicit files**

Run:

```bash
git add packages/gui/src/main/catalog/catalog-service.ts packages/gui/test/main/catalog/catalog-service.test.ts
```

### Task 5: Wire IPC Router

**Files:**

- Modify: `packages/gui/src/main/ipc-router.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write failing IPC tests**

Cover:

- bootstrap returns workspace catalog,
- bootstrap returns parse warnings in payload,
- `workspace.add` emits workspace/session events,
- folder-picker cancel is no-op success,
- session create writes a JSONL file,
- session open selects without runtime creation,
- session rename persists `session_info`,
- archive/unarchive updates metadata,
- missing workspace sync emits recoverable catalog state,
- sender validation prevents mutation.

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
```

Expected before implementation: commands are unimplemented or events are missing.

**Step 3: Implement IPC handlers**

Route Phase 3 commands to `CatalogService`. Publish receipts and catalog events. Keep later-phase commands as `CommandNotImplemented`.

**Step 4: Run tests and verify pass**

Run the same command.

Expected: IPC tests pass.

**Step 5: Stage explicit files**

Run:

```bash
git add packages/gui/src/main/ipc-router.ts packages/gui/test/main/ipc-router.test.ts
```

### Task 6: Add Renderer Store And Validated Boundary

**Files:**

- Create: `packages/gui/src/renderer/app/app-store.ts`
- Modify: `packages/gui/src/renderer/app/bootstrap-loader.ts`
- Test: `packages/gui/test/renderer/app-store.test.ts`
- Test: `packages/gui/test/renderer/bootstrap-loader.test.ts`

**Step 1: Write failing renderer-store tests**

Cover:

- applying workspace and session catalog events,
- React unsubscribe/resubscribe does not drop the underlying IPC subscription,
- malformed invoke results become `InternalIpcError`,
- malformed pushed events are dropped,
- bootstrap warnings seed initial inline error state.

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts test/renderer/bootstrap-loader.test.ts
```

Expected before implementation: store module or warning behavior is missing.

**Step 3: Implement store**

Implement:

- `RendererCatalogTransport`,
- `RendererCatalogApi`,
- `createValidatedRendererCatalogApi()`,
- `createGuiCatalogStore()`,
- `useCatalogStore()`,
- event reducers,
- schema-decoded result application.

**Step 4: Run tests and verify pass**

Run the same command.

Expected: renderer tests pass.

**Step 5: Stage explicit files**

Run:

```bash
git add packages/gui/src/renderer/app/app-store.ts packages/gui/src/renderer/app/bootstrap-loader.ts packages/gui/test/renderer/app-store.test.ts packages/gui/test/renderer/bootstrap-loader.test.ts
```

### Task 7: Add Catalog Renderer UI

**Files:**

- Modify: `packages/gui/src/renderer/app/App.tsx`
- Create: `packages/gui/src/renderer/app/catalog-view.tsx`
- Modify: `packages/gui/src/renderer/styles/app.css`

**Step 1: Keep UI minimal**

Render:

- workspace section,
- empty workspace state,
- missing workspace state,
- session section,
- archived group,
- selected session metadata,
- disabled composer placeholder.

**Step 2: Replace blocking rename prompt**

Use inline rename form with:

- text input,
- save button,
- cancel button,
- Escape cancel,
- empty-title submit disabled.

**Step 3: Wire all commands through store**

Use workspace-scoped session commands:

```ts
store.renameSession(session.workspaceId, session.id, nextTitle);
store.archiveSession(session.workspaceId, session.id);
store.unarchiveSession(session.workspaceId, session.id);
store.openSession(session.workspaceId, session.id);
```

**Step 4: Run package check**

Run:

```bash
npm --prefix packages/gui run check
```

Expected: format, lint, typecheck, and GUI tests pass.

**Step 5: Stage explicit files**

Run:

```bash
git add packages/gui/src/renderer/app/App.tsx packages/gui/src/renderer/app/catalog-view.tsx packages/gui/src/renderer/styles/app.css
```

### Task 8: Align GUI Build And Test Aliases

**Files:**

- Modify: `packages/gui/electron.vite.config.ts`
- Modify: `packages/gui/vitest.config.ts`
- Modify: `packages/gui/tsconfig.json`

**Step 1: Remove partial package alias**

Do not alias `@earendil-works/pi-agent-core` to only `uuid.ts`.

**Step 2: Align runtime/test/typecheck resolution**

Set Vite and Vitest aliases to match TypeScript paths for:

- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`

**Step 3: Run GUI check**

Run:

```bash
npm --prefix packages/gui run check
```

Expected: package check passes.

**Step 4: Run Electron smoke test**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected: Electron secure shell smoke test passes. In a sandboxed environment this may require permission to launch Electron.

**Step 5: Stage explicit files**

Run:

```bash
git add packages/gui/electron.vite.config.ts packages/gui/vitest.config.ts packages/gui/tsconfig.json
```

## Testing And Verification

### Required Commands

Run:

```bash
npm --prefix packages/gui run check
```

Expected:

- `format:check` passes.
- `lint` passes.
- `typecheck` passes.
- GUI unit tests pass.

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected:

- Electron build passes.
- Playwright Electron secure shell test passes.

Run:

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/session-manager/file-operations.test.ts
```

Expected:

- Session manager file operation tests pass.

Run:

```bash
npm run check
```

Expected:

- Root check passes.

Run:

```bash
./test.sh
```

Expected:

- Full non-e2e test suite should be attempted.
- Known current failures are outside the Phase 3 GUI change path:
  - `packages/agent` cannot resolve `@earendil-works/pi-ai`.
  - some `packages/coding-agent` tests depend on built package/dist resolution such as `@earendil-works/pi-tui/dist/index.js`.
  - sandboxed runs may also block localhost binding, home-directory writes, network/DNS, or missing `fd` downloads.

### Verification Completed

Completed successfully:

```bash
npm --prefix packages/gui run check
```

Result:

- GUI format check passed.
- GUI lint passed.
- GUI typecheck passed.
- GUI tests passed.

Completed successfully with Electron launch permission:

```bash
npm --prefix packages/gui run test:electron
```

Result:

- Electron build passed.
- Playwright Electron smoke test passed.

Completed successfully:

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/session-manager/file-operations.test.ts
```

Result:

- 24 tests passed.

Completed successfully:

```bash
npm run check
```

Result:

- Root check passed.
- GUI package check passed as part of root check.

Attempted:

```bash
./test.sh
```

Result:

- Failed on existing repo-wide issues outside this Phase 3 GUI implementation path.
- Escalated run fixed sandbox-only localhost failures, but package/dist resolution failures remained.

## Review Notes

### Correctness

- Session identity is workspace-scoped for all mutating/opening commands.
- Missing workspace paths remain recoverable and are not accidentally marked healthy by selection.
- Session creation revalidates the workspace path immediately before writing a Pi session file.
- Catalog parse failures are backed up and surfaced as bootstrap warnings instead of racing renderer subscription.
- Archive/unarchive changes only GUI catalog metadata.
- Rename persists through Pi `session_info`.

### Security

- Electron sender validation still runs before command decoding and catalog mutation.
- Preload exposes only fixed invoke/subscribe functions.
- Renderer validates transport payloads with Effect Schema before state consumes them.
- Malformed pushed events are dropped.
- Malformed invoke results become typed error envelopes.

### Maintainability

- Catalog persistence and catalog behavior are separated:
  - `JsonCatalogStore` handles disk state.
  - `CatalogService` handles workspace/session behavior.
  - `ipc-router` handles Electron command routing and event publishing.
  - renderer store handles view state.
- Renderer UI is split so `App.tsx` remains bootstrap/store wiring and `catalog-view.tsx` owns catalog layout.
- Vite, Vitest, and TypeScript package resolution are aligned.

## Commit Message

Recommended commit message:

```text
feat: add Pi GUI workspace and session catalog

- Add Effect Schema contracts for workspace/session snapshots, catalog commands, events, bootstrap warnings, and tagged catalog errors
- Add GUI catalog persistence with atomic JSON writes, invalid-catalog backup, workspace selection, session sync, archive state, and missing-path recovery
- Add Pi-backed session creation/rename by exposing SessionManager.ensureSessionFile()
- Wire Electron IPC for workspace add/pick/select/sync/remove and session create/open/rename/archive/unarchive with sender validation
- Add renderer catalog store, validated IPC boundary, bootstrap warning seeding, sidebar/session catalog UI, inline rename, and minimal session metadata pane
- Cover catalog store/service, IPC routing, renderer store, preload, contracts, bootstrap warnings, and SessionManager persistence behavior with tests
```

# Pi Native GUI Phase 9 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Pi-native slash command discovery and a desktop `/resume` flow without introducing a second agent runtime.

**Architecture:** Electron main remains the typed host for Pi runtime handles, command discovery, resume search, and session actions. Pi owns runtime truth through the SDK and `AgentSession`; the GUI owns Effect Schema IPC contracts, bounded projections, and safe desktop actions. React continues to consume immutable external-store snapshots, with command and resume UI state split into a focused renderer slice.

**Tech Stack:** Electron, Effect Schema, TypeScript, React, Vitest, happy-dom, Playwright Electron, oxlint, oxfmt, Pi coding-agent runtime.

---

## Phase 9 Scope

Phase 9 is the **P0/P1 Slash Commands And Native Resume** phase for `packages/gui`.

In scope:

- Add a keyboard-first slash command palette for the desktop app.
- Discover built-in Pi commands and dynamic extension, prompt-template, and skill commands from the active runtime session.
- Keep unsupported TUI-only built-ins visible but disabled in the desktop command palette.
- Add native `/resume` search and session selection without dropping into the TUI.
- Support resume search across:
  - current workspace
  - known GUI workspaces
- Keep known-workspace search bounded to configured GUI workspaces only.
- Support resume search controls:
  - plain fuzzy tokens
  - quoted phrases
  - `re:<pattern>` regex search
  - named-session filter
  - archived-session toggle
  - threaded, recent, and relevance sorting
  - path visibility toggle
- Support resume actions:
  - open
  - rename
  - archive
  - unarchive
- Keep dynamic slash command execution on the existing `session.sendMessage` / Pi SDK prompt path.
- Keep GUI-supported built-ins as typed desktop host actions.
- Keep all new IPC commands, snapshots, and errors validated with Effect Schema.
- Preserve Phase 8 behavior:
  - multiple open runtimes
  - background activity
  - queues
  - restore queued messages
  - runtime overlays
  - `workspaceId:sessionId` session state keys

Out of scope:

- GUI-native `/tree`
- GUI-native `/compact`
- GUI-native `/share`
- import/export
- fork/clone
- login/logout
- WebSocket or Node server runtime boundary
- unbounded filesystem scans
- persisting palette or resume picker transient UI state across app restart

## Current Baseline

Before Phase 9:

- The desktop GUI had runtime/session navigation, prompt execution, model/settings/trust controls, extension UI, background session state, queues, and activity badges.
- Slash commands were not discoverable in the GUI.
- Dynamic extension/prompt/skill commands were available to Pi runtime internals but not exposed through a GUI command catalog.
- Resume was still a TUI-centered workflow.
- The TUI resume search logic lived in the TUI package and was not reusable by the GUI.
- `app-store.ts` already owned many renderer projections, so adding command and resume state directly risked crossing the maintainability threshold.

Phase 9 builds on the existing Pi-native desktop architecture:

- `SessionSupervisor` owns active runtime handles in Electron main.
- `PiSdkSessionDriver` adapts real Pi SDK runtime sessions.
- `FakeSessionDriver` powers deterministic GUI and Electron tests.
- `ipc-router.ts` validates renderer commands and routes them through typed services.
- `app-store.ts` exposes immutable snapshots through `useSyncExternalStore`.
- Renderer components stay plain React components; no new state library is introduced.

## Implementation Plan

### Task 1: Add Command And Resume Contracts

**Files:**

- Modify: `packages/gui/src/contracts/commands.ts`
- Modify: `packages/gui/src/contracts/snapshots.ts`
- Modify: `packages/gui/src/contracts/errors.ts`
- Test: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Write failing contract tests**

Add schema encode/decode coverage for:

- `session.getSlashCommands`
- `resume.search`
- `resume.open`
- `resume.rename`
- `resume.archive`
- `resume.unarchive`
- `SlashCommandCatalogSnapshot`
- `ResumeSearchSnapshot`
- command/resume error types

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected:

- Tests fail because the schemas and command classes do not exist yet.

**Step 2: Add Effect Schema snapshots**

Add:

- `SlashCommandSourceSnapshot`
- `SlashCommandAvailability`
- `SlashCommandSourceInfoSnapshot`
- `SlashCommandSnapshot`
- `SlashCommandCatalogSnapshot`
- `ResumeScope`
- `ResumeSortMode`
- `ResumeNameFilter`
- `ResumeSessionSnapshot`
- `ResumeSearchSnapshot`

**Step 3: Add Effect Schema commands**

Add:

- `SessionGetSlashCommands`
- `ResumeSearch`
- `ResumeOpen`
- `ResumeRename`
- `ResumeArchive`
- `ResumeUnarchive`

Include each command in `GuiCommand`.

**Step 4: Add typed errors**

Add:

- `SlashCommandCatalogUnavailable`
- `ResumeSearchFailed`
- `ResumeOpenFailed`
- `ResumeRenameFailed`
- `ResumeArchiveFailed`

Include each error in `GuiError`.

**Step 5: Run contract tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected:

- Contract tests pass.

### Task 2: Extract Shared Session Search

**Files:**

- Create: `packages/coding-agent/src/core/session-search.ts`
- Modify: `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts`
- Modify: `packages/coding-agent/src/runtime.ts`
- Test: `packages/coding-agent/test/session-selector-search.test.ts`

**Step 1: Write failing search tests**

Cover:

- plain fuzzy tokens
- quoted phrases
- invalid regex as no-match
- unsafe regex as no-match
- named filter
- recent sort
- relevance sort
- threaded parent/child ordering
- alphanumeric fuzzy parity behavior

Run:

```bash
cd packages/coding-agent
node ../../node_modules/vitest/vitest.mjs --run test/session-selector-search.test.ts
```

Expected:

- Tests fail until shared search behavior exists.

**Step 2: Add dependency-free search helper**

Create `packages/coding-agent/src/core/session-search.ts` with:

- `parseSearchQuery`
- `matchSession`
- `filterAndSortSessions`
- `hasSessionName`

The helper must not import renderer, Electron, or TUI code.

**Step 3: Preserve TUI behavior**

Port the existing fuzzy scoring behavior into the shared helper:

- case-insensitive subsequence matching
- word-boundary score reward
- consecutive-match score reward
- gap penalty
- exact-match reward
- alphanumeric swapped matching

**Step 4: Harden regex search**

Add conservative limits:

- max regex pattern length: `200`
- cap searched transcript text per session: `200_000`
- reject obvious nested quantifier patterns before compilation

Invalid or unsafe regex queries should return no results, not throw.

**Step 5: Add threaded ordering**

Use `SessionInfo.parentSessionPath` to build a dependency-free parent/child tree and flatten it so parent sessions appear before descendants while root subtrees sort by latest modified time.

**Step 6: Re-export through TUI search module and runtime entrypoint**

Update:

- `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts`
- `packages/coding-agent/src/runtime.ts`

**Step 7: Run search tests**

Run:

```bash
cd packages/coding-agent
node ../../node_modules/vitest/vitest.mjs --run test/session-selector-search.test.ts
```

Expected:

- Search tests pass.

### Task 3: Add Runtime Command Discovery

**Files:**

- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Modify: `packages/coding-agent/src/modes/rpc/rpc-mode.ts`
- Modify: `packages/coding-agent/src/runtime.ts`
- Modify: `packages/gui/src/main/session/session-driver.ts`
- Modify: `packages/gui/src/main/session/pi-sdk-session-driver.ts`
- Modify: `packages/gui/src/main/session/fake-session-driver.ts`
- Modify: `packages/gui/src/main/session/session-supervisor.ts`
- Test: `packages/gui/test/main/session/slash-command-service.test.ts`

**Step 1: Add public AgentSession helper**

Add `AgentSession.getCommands()` to return dynamic commands only:

- extension commands
- prompt templates
- skill commands

Do not include host-specific built-ins here.

**Step 2: Reuse helper from RPC**

Update RPC `get_commands` to call `session.getCommands()` so RPC and GUI do not drift.

**Step 3: Extend GUI driver boundary**

Add optional `getSlashCommands(handle)` to `SessionDriver`.

**Step 4: Implement SDK driver projection**

Map `AgentSession.getCommands()` results into GUI `SlashCommandSnapshot` values:

- extension commands: `sendable`
- skill commands: `sendable`
- prompt-template commands: `insertOnly`

**Step 5: Implement fake driver support**

Add deterministic fake extension/prompt/skill command fixtures for service and renderer tests.

**Step 6: Add supervisor method**

Add `SessionSupervisor.getSlashCommands(workspaceId, sessionId)` and require an open runtime record.

**Step 7: Run targeted service tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/slash-command-service.test.ts
```

Expected:

- Slash command service tests pass.

### Task 4: Add Main-Process Services And IPC Routes

**Files:**

- Create: `packages/gui/src/main/session/slash-command-service.ts`
- Create: `packages/gui/src/main/session/resume-service.ts`
- Modify: `packages/gui/src/main/ipc-router.ts`
- Modify: `packages/gui/src/main/test-runtime-shim.ts`
- Test: `packages/gui/test/main/session/slash-command-service.test.ts`
- Test: `packages/gui/test/main/session/resume-service.test.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Add SlashCommandService tests**

Cover:

- built-in commands appear first
- `/resume`, `/new`, `/settings`, `/trust`, `/model`, and `/name` are GUI actions
- unsupported built-ins are deferred with a reason
- dynamic commands are included
- dynamic command name conflicts are marked `conflict`

**Step 2: Implement SlashCommandService**

Merge:

- `BUILTIN_SLASH_COMMANDS`
- runtime dynamic commands from `SessionSupervisor`

Classify commands as:

- `guiAction`
- `insertOnly`
- `sendable`
- `deferred`
- `conflict`

**Step 3: Add ResumeService tests**

Cover:

- current-workspace search
- known-workspace search bounded to configured GUI workspaces
- archive filtering
- named filtering
- threaded metadata/order
- unsafe regex behavior
- open delegates through `SessionSupervisor.openSession`
- rename uses catalog persistence
- archive/unarchive stays GUI catalog-owned

**Step 4: Implement ResumeService**

Use:

- `CatalogService.getWorkspaceCatalog()`
- `CatalogService.syncWorkspace(workspaceId)`
- Pi `SessionManager.list(cwd, sessionDir)`
- shared `filterAndSortSessions`
- `SessionSupervisor.openSession(workspaceId, sessionId)`

Do not persist transcript search text into the GUI catalog.

**Step 5: Route new commands through IPC**

Update `ipc-router.ts` to handle:

- `SessionGetSlashCommands`
- `ResumeSearch`
- `ResumeOpen`
- `ResumeRename`
- `ResumeArchive`
- `ResumeUnarchive`

Keep sender validation, origin policy, typed receipts, and typed error serialization unchanged.

**Step 6: Run targeted main tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/slash-command-service.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/session/resume-service.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
```

Expected:

- Main-process tests pass.

### Task 5: Add Renderer Store Slice

**Files:**

- Modify: `packages/gui/src/renderer/app/app-store.ts`
- Create: `packages/gui/src/renderer/app/phase9-store.ts`
- Test: `packages/gui/test/renderer/app-store.test.ts`

**Step 1: Write failing store tests**

Cover:

- slash command catalog loading
- stale slash command catalog responses are ignored
- resume search state
- stale resume search responses are ignored
- newer searches preserve unrelated state changes
- resume open closes picker on success
- rename/archive/unarchive refresh resume results
- `/name` creates a current-session rename request

**Step 2: Add focused store state**

Add:

- `CommandPaletteState`
- `ResumePickerState`
- `slashCommandCatalogsBySessionKey`
- `sessionRenameRequestsBySessionKey`

**Step 3: Split command/resume actions into a slice**

Create `phase9-store.ts` with:

- `createPhase9StoreActions`
- `emptyCommandPaletteState`
- `emptyResumePickerState`

Keep `app-store.ts` as the composition surface.

**Step 4: Use functional updates for async paths**

Use `updateState((current) => next)` for Phase 9 async paths so awaited IPC cannot overwrite newer external-store state.

**Step 5: Add request sequencing**

Track private counters:

- `slashCatalogSequence`
- `resumeSearchSequence`

Ignore stale responses after newer requests start.

**Step 6: Keep `app-store.ts` under the review threshold**

Confirm line count:

```bash
wc -l packages/gui/src/renderer/app/app-store.ts packages/gui/src/renderer/app/phase9-store.ts
```

Expected:

- `app-store.ts` remains below 1,000 lines.

**Step 7: Run store tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
```

Expected:

- Renderer store tests pass.

### Task 6: Add Command Palette And Resume Picker UI

**Files:**

- Modify: `packages/gui/src/renderer/app/App.tsx`
- Modify: `packages/gui/src/renderer/app/app-panels.tsx`
- Modify: `packages/gui/src/renderer/app/catalog-view.tsx`
- Create: `packages/gui/src/renderer/app/command-palette.tsx`
- Create: `packages/gui/src/renderer/app/modal-dialog.tsx`
- Modify: `packages/gui/src/renderer/styles/app.css`
- Test: `packages/gui/test/renderer/command-palette.test.tsx`
- Test: `packages/gui/test/renderer/modal-dialog.test.tsx`
- Test: `packages/gui/test/renderer/catalog-view.test.tsx`
- Test: `packages/gui/test/renderer/app-panels.test.tsx`

**Step 1: Add CommandPalette tests**

Cover:

- `Cmd/Ctrl+K` opens the palette
- composer slash entry opens inline command suggestions
- dynamic commands insert `/${name} ` into the composer
- `/resume` opens the resume picker
- `/new` creates a session
- `/settings` and `/trust` focus settings/trust UI
- `/model` focuses runtime controls
- `/name` opens the existing current-session rename flow
- deferred/conflict commands are disabled

**Step 2: Add ResumePicker tests**

Cover:

- search input
- debounce for query changes
- immediate search for filter toggles
- scope/sort/name/archive/path controls
- open session action
- rename action
- archive/unarchive action
- empty/loading/error states
- keyboard selection and Enter open

**Step 3: Add shared modal tests**

Cover:

- initial focus
- Escape close from input and non-input focus
- focus trap
- backdrop click policy
- focus restoration

**Step 4: Implement ModalDialog**

Add a small local helper with:

- `role="dialog"`
- `aria-modal="true"`
- `aria-labelledby`
- initial focus
- Tab/Shift+Tab focus cycling
- Escape close at the dialog level
- backdrop close only when clicking the backdrop itself
- previous-focus restoration on unmount

Do not add a new dependency.

**Step 5: Implement CommandPalette**

Keep UI compact and keyboard-first:

- no landing page
- no decorative hero
- no nested cards
- dense command rows
- clear source and disabled reason

**Step 6: Implement ResumePicker**

Show each result with:

- title/name
- preview
- workspace
- modified/session metadata
- message count
- open/running/archived badges
- path only when enabled

**Step 7: Wire `/name` to existing rename UI**

Use a store-level rename request counter keyed by `workspaceId:sessionId`. `SessionList` consumes it and starts the existing sidebar rename flow for the selected session.

**Step 8: Run renderer tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/command-palette.test.tsx
node ../../node_modules/vitest/dist/cli.js --run test/renderer/modal-dialog.test.tsx
node ../../node_modules/vitest/dist/cli.js --run test/renderer/catalog-view.test.tsx
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-panels.test.tsx
```

Expected:

- Renderer tests pass.

### Task 7: Review Remediation And Verification

**Files:**

- Modify only files already in the Phase 9 implementation scope.
- Keep generated test artifacts out of the worktree.
- Keep `docs/plans` untracked/internal unless explicitly asked to stage it.

**Step 1: Fix stale async state**

Confirm all Phase 9 async store paths merge against current state after awaits:

- `getSlashCommands`
- `searchResume`
- `resumeOpenSession`
- `renameResumeSession`
- `resumeArchiveSession`
- `resumeUnarchiveSession`

**Step 2: Confirm store decomposition**

Run:

```bash
wc -l packages/gui/src/renderer/app/app-store.ts packages/gui/src/renderer/app/phase9-store.ts
```

Expected:

- `app-store.ts` below 1,000 lines.

**Step 3: Confirm `/name` semantics**

Verify:

- `SlashCommandService` marks `/name` as `guiAction`.
- `CommandPalette` invokes `requestSessionRename`.
- `SessionSection` starts the existing rename flow.

**Step 4: Confirm modal focus behavior**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/modal-dialog.test.tsx
```

Expected:

- Focus management tests pass.

**Step 5: Confirm search hardening**

Run:

```bash
cd packages/coding-agent
node ../../node_modules/vitest/vitest.mjs --run test/session-selector-search.test.ts
```

Expected:

- Unsafe regex and threaded-order tests pass.

**Step 6: Run package and root verification**

Run:

```bash
npm --prefix packages/gui run check
npm --prefix packages/gui run test:coverage
npm run check
```

Expected:

- GUI check passes.
- GUI coverage passes configured thresholds.
- Root check passes.

**Step 7: Attempt Electron verification**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected:

- If local Electron launch is stable, tests pass.
- If the known local launch issue remains, record `Process failed to launch!` separately from source-level verification.

## Implemented Changes

### Coding-Agent Core

Added `packages/coding-agent/src/core/session-search.ts`.

- Added dependency-free session search helpers:
  - `parseSearchQuery`
  - `matchSession`
  - `filterAndSortSessions`
  - `hasSessionName`
- Preserved TUI-style fuzzy scoring in the shared helper.
- Added quoted phrase handling.
- Added `re:<pattern>` regex mode.
- Added regex safety gates:
  - max pattern length
  - nested-quantifier rejection
  - per-session searched text cap
- Added threaded parent/child flattening based on `parentSessionPath`.
- Updated `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts` to re-export the shared helper.
- Exported search helper types from `packages/coding-agent/src/runtime.ts`.

Modified `packages/coding-agent/src/core/agent-session.ts`.

- Added `AgentSession.getCommands()` as the public dynamic command discovery helper.
- The helper returns extension, prompt-template, and skill commands.
- Host-specific built-ins remain outside this helper.

Modified `packages/coding-agent/src/modes/rpc/rpc-mode.ts`.

- Updated RPC `get_commands` to call `session.getCommands()`.
- This keeps RPC and GUI dynamic command discovery aligned.

### GUI Contracts

Modified `packages/gui/src/contracts/commands.ts`.

Added commands:

- `SessionGetSlashCommands`
- `ResumeSearch`
- `ResumeOpen`
- `ResumeRename`
- `ResumeArchive`
- `ResumeUnarchive`

Modified `packages/gui/src/contracts/snapshots.ts`.

Added slash command snapshots:

- `SlashCommandSourceSnapshot`
- `SlashCommandAvailability`
- `SlashCommandSourceInfoSnapshot`
- `SlashCommandSnapshot`
- `SlashCommandCatalogSnapshot`

Added resume snapshots:

- `ResumeScope`
- `ResumeSortMode`
- `ResumeNameFilter`
- `ResumeSessionSnapshot`
- `ResumeSearchSnapshot`

Modified `packages/gui/src/contracts/errors.ts`.

Added errors:

- `SlashCommandCatalogUnavailable`
- `ResumeSearchFailed`
- `ResumeOpenFailed`
- `ResumeRenameFailed`
- `ResumeArchiveFailed`

### GUI Main Process

Added `packages/gui/src/main/session/slash-command-service.ts`.

- Merges built-in Pi commands with dynamic runtime commands.
- Marks `/resume`, `/new`, `/settings`, `/trust`, `/model`, and `/name` as GUI actions.
- Marks unsupported built-ins as deferred with a clear disabled reason.
- Marks dynamic commands that conflict with built-ins as `conflict`.
- Sorts commands by source and name.

Added `packages/gui/src/main/session/resume-service.ts`.

- Searches current or known GUI workspaces.
- Keeps known-workspace search bounded to configured GUI workspaces.
- Uses `SessionManager.list()` for Pi session metadata.
- Uses shared `filterAndSortSessions()`.
- Keeps transcript search text out of the GUI catalog.
- Opens selected sessions by syncing the catalog and delegating to `SessionSupervisor.openSession()`.
- Uses existing catalog rename/archive/unarchive persistence.
- Avoids duplicate workspace catalog calls inside workspace candidate listing.

Modified runtime/session driver files:

- `packages/gui/src/main/session/session-driver.ts`
- `packages/gui/src/main/session/pi-sdk-session-driver.ts`
- `packages/gui/src/main/session/fake-session-driver.ts`
- `packages/gui/src/main/session/session-supervisor.ts`
- `packages/gui/src/main/session/runtime-supervisor.ts`
- `packages/gui/src/main/test-runtime-shim.ts`

Implemented:

- Optional driver-level `getSlashCommands()`.
- SDK projection from `AgentSession.getCommands()` to GUI command snapshots.
- Fake-driver command fixtures.
- Supervisor-level `getSlashCommands()`.
- Test-runtime-shim support for E2E fake builds.

Modified `packages/gui/src/main/ipc-router.ts`.

- Routed all new command and resume IPC commands.
- Preserved sender validation and origin policy.
- Preserved typed receipts.
- Preserved typed error serialization.
- Published updated session catalogs for resume open, rename, archive, and unarchive actions.

### GUI Renderer

Modified `packages/gui/src/renderer/app/app-store.ts`.

- Added command palette state.
- Added resume picker state.
- Added slash command catalog cache keyed by `workspaceId:sessionId`.
- Added session rename request counters keyed by `workspaceId:sessionId`.
- Kept the public `GuiCatalogStore` interface stable for existing GUI components.
- Composed Phase 9 actions from a focused slice.

Added `packages/gui/src/renderer/app/phase9-store.ts`.

- Added `createPhase9StoreActions()`.
- Added `emptyCommandPaletteState()`.
- Added `emptyResumePickerState()`.
- Used functional state updates for Phase 9 async paths.
- Added request sequencing for:
  - slash command catalog loads
  - resume searches
- Ignored stale async responses from older requests.

Added `packages/gui/src/renderer/app/modal-dialog.tsx`.

- Adds shared modal behavior:
  - focus initial target on open
  - focus first focusable or dialog fallback
  - trap Tab/Shift+Tab focus
  - close on Escape at dialog level
  - close on backdrop mousedown only when target is the backdrop
  - restore previous focus on unmount

Added `packages/gui/src/renderer/app/command-palette.tsx`.

- Adds `CommandPalette`.
- Adds `ResumePicker`.
- Supports `Cmd/Ctrl+K`.
- Supports composer slash entry.
- Inserts dynamic commands into composer drafts.
- Dispatches GUI built-ins through typed store actions.
- Opens `/resume` natively.
- Wires `/name` to the existing session rename flow.
- Debounces resume query typing.
- Runs filter toggles immediately.
- Shows compact loading, empty, no-match, and error states.

Modified `packages/gui/src/renderer/app/catalog-view.tsx`.

- Added support for `sessionRenameRequestsBySessionKey`.
- Starts the existing selected-session rename flow when `/name` is invoked.

Modified `packages/gui/src/renderer/app/App.tsx`, `packages/gui/src/renderer/app/app-panels.tsx`, and `packages/gui/src/renderer/styles/app.css`.

- Mounted command palette and resume picker.
- Wired keyboard entry points.
- Added compact command/resume styling consistent with existing GUI density.

## Review Remediation Completed

The staged review identified several required gaps. These were addressed before treating the implementation as ready.

### Stale Async Renderer State

Fixed in `packages/gui/src/renderer/app/phase9-store.ts`.

- Replaced captured-state writes with functional `updateState((current) => next)` calls.
- Added `slashCatalogSequence`.
- Added `resumeSearchSequence`.
- Older async responses no longer overwrite newer command/resume state.

### Store Decomposition

Fixed by creating `packages/gui/src/renderer/app/phase9-store.ts`.

Current line counts after remediation:

```text
931 packages/gui/src/renderer/app/app-store.ts
282 packages/gui/src/renderer/app/phase9-store.ts
93 packages/gui/src/renderer/app/modal-dialog.tsx
```

`app-store.ts` is below the 1,000-line review threshold.

### `/name` Semantics

Implemented `/name` as a GUI action.

- `SlashCommandService` classifies `/name` as `guiAction`.
- `CommandPalette` calls `store.requestSessionRename(...)`.
- `SessionSection` opens the existing sidebar rename form for the selected session.

### Modal Focus Management

Added `ModalDialog`.

- `CommandPalette` and `ResumePicker` use the shared dialog helper.
- Focus behavior is covered by `packages/gui/test/renderer/modal-dialog.test.tsx`.

### Resume Search Debounce

Implemented in `ResumePicker`.

- Query typing is debounced.
- Filter/scope/sort/archive controls search immediately.
- Store-level request sequencing guards stale responses.

### Search Parity And Regex Hardening

Implemented in `packages/coding-agent/src/core/session-search.ts`.

- TUI fuzzy behavior was moved into the shared helper.
- Threaded tree ordering uses parent/child session metadata.
- Regex search has conservative pattern and searched-text limits.
- Unsafe regex is treated as no-match and covered by tests.

### ResumeService Work Reduction

Reduced duplicate catalog reads in `ResumeService`.

- `listCandidates()` fetches workspace catalog once.
- `listWorkspaceCandidates()` receives the catalog snapshot and only syncs the target workspace sessions.

## Added And Updated Tests

### Coding Agent

Modified `packages/coding-agent/test/session-selector-search.test.ts`.

Added coverage for:

- unsafe regex no-match
- alphanumeric fuzzy parity behavior
- threaded parent/child ordering
- existing quoted phrase, regex, named filter, recent, and relevance behavior

### GUI Contracts

Modified `packages/gui/test/contracts/contracts.test.ts`.

Added coverage for:

- slash command catalog schemas
- resume search schemas
- resume command contracts
- command/resume errors

### GUI Main Process

Added `packages/gui/test/main/session/slash-command-service.test.ts`.

Covered:

- built-in command classification
- `/name` as a GUI action
- dynamic command conflicts
- source ordering

Added `packages/gui/test/main/session/resume-service.test.ts`.

Covered:

- archive filtering
- threaded metadata/order
- unsafe regex behavior
- known-workspace scope
- resume open/rename/archive/unarchive paths

### GUI Renderer

Modified `packages/gui/test/renderer/app-store.test.ts`.

Covered:

- stale resume result ordering
- command catalog loading
- state preservation after concurrent updates
- rename request counters

Added `packages/gui/test/renderer/command-palette.test.tsx`.

Covered:

- command palette rendering
- `/name`
- Escape from non-input focus
- focus restoration
- resume picker search behavior
- resume picker actions

Added `packages/gui/test/renderer/modal-dialog.test.tsx`.

Covered:

- initial focus
- focus trap
- focus fallback
- Escape close
- backdrop close policy
- focus restoration

Modified:

- `packages/gui/test/renderer/app-panels.test.tsx`
- `packages/gui/test/renderer/catalog-view.test.tsx`

Updated fixtures and assertions for the new store contract and rename-request flow.

## Verification

Focused tests passed:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/command-palette.test.tsx
node ../../node_modules/vitest/dist/cli.js --run test/renderer/modal-dialog.test.tsx
node ../../node_modules/vitest/dist/cli.js --run test/main/session/resume-service.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/session/slash-command-service.test.ts
```

Results:

- `test/renderer/app-store.test.ts`: 20 tests passed.
- `test/renderer/command-palette.test.tsx`: 9 tests passed.
- `test/renderer/modal-dialog.test.tsx`: 4 tests passed.
- `test/main/session/resume-service.test.ts`: 3 tests passed.
- `test/main/session/slash-command-service.test.ts`: 2 tests passed.

Coding-agent search test passed:

```bash
cd packages/coding-agent
node ../../node_modules/vitest/vitest.mjs --run test/session-selector-search.test.ts
```

Result:

- `test/session-selector-search.test.ts`: 12 tests passed.

GUI package check passed:

```bash
npm --prefix packages/gui run check
```

Result:

- Format check passed.
- `oxlint` passed.
- Typecheck passed.
- GUI Vitest passed: 32 test files, 192 tests.

GUI coverage passed:

```bash
npm --prefix packages/gui run test:coverage
```

Result:

- Test files: 32 passed.
- Tests: 192 passed.
- Statements: 80.52%.
- Branches: 71.81%.
- Functions: 85.05%.
- Lines: 82.49%.

Root check passed:

```bash
npm run check
```

Result:

- Biome check passed with no fixes applied.
- Pinned dependency check passed.
- TypeScript relative import check passed.
- Coding-agent shrinkwrap check passed.
- Browser smoke check passed.
- GUI check passed.

Electron test attempted:

```bash
npm --prefix packages/gui run test:electron
```

Result:

- Electron fake-runtime build succeeded.
- Playwright Electron failed to launch the process:

```text
Error: Process failed to launch!
```

This matches the known local Electron launch failure from prior GUI phases. The failure is tracked as an environment launch issue, not as a source-level assertion failure.

Generated `packages/gui/test-results/` artifacts from the failed Electron launch attempt were removed.

## Final Staged Snapshot

The implementation is staged as source/test changes only.

Staged scope:

- coding-agent runtime dynamic command discovery
- shared session search helper
- GUI command/resume contracts
- GUI main services
- GUI IPC routing
- GUI renderer command/resume state slice
- command palette and resume picker UI
- modal focus helper
- focused tests

Internal docs remain untracked unless explicitly staged.

## Follow-Ups

- Add targeted Electron E2E for `Cmd/Ctrl+K`, `/resume`, resume search, and opening a session once the local Electron launch issue is resolved.
- Add deeper `ResumeService` fixture tests that exercise real session files across multiple known workspaces.
- Implement GUI-native `/tree` using the same host-command pattern.
- Implement GUI-native `/compact` with typed host actions and clear runtime ownership.
- Decide whether `/share`, import/export, fork/clone, and login/logout belong in the desktop host or should remain deferred until there is a stronger UX contract.


# Pi Native GUI Phase 10 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Pi-native desktop `/tree` and `/compact` parity as typed GUI host actions without routing through slash-text execution or introducing a secondary runtime transport.

**Architecture:** Electron main remains the owner of Pi runtime truth through `SessionSupervisor`, `SessionDriver`, and SDK-backed runtime handles. The renderer receives Effect Schema validated snapshots and events, keeps only immutable UI projections, and manages tree/compaction modal state locally through a focused store slice. Slash commands expose `/tree` and `/compact` as GUI actions, while Pi runtime APIs perform navigation, labeling, branch summaries, manual compaction, and cancellation.

**Tech Stack:** Electron, Effect Schema, TypeScript, React, `useSyncExternalStore`, Vitest, happy-dom, Playwright Electron, oxlint, oxfmt, Pi coding-agent runtime.

---

## Phase 10 Scope

Phase 10 is the **P0/P1 Native Tree Navigation And Manual Compaction** phase for `packages/gui`.

In scope:

- Add GUI-native `/tree` and `/compact` parity.
- Treat `/tree` and `/compact` as built-in `guiAction` slash commands.
- Add typed IPC commands:
  - `session.getTree`
  - `session.navigateTree`
  - `session.setTreeEntryLabel`
  - `session.compact`
  - `session.cancelCompaction`
  - `session.cancelTreeNavigation`
- Add flat tree snapshots rather than recursive renderer payloads.
- Add tree and compaction event contracts.
- Project Pi session-manager tree data into renderer-safe snapshots.
- Navigate to user/custom entries and return composer text when Pi runtime provides it.
- Navigate to assistant/tool/other entries and clear composer when Pi runtime does not provide editor text.
- Support branch summary modes:
  - no summary
  - default summary
  - custom focus instructions
- Support tree entry labels through `appendLabelChange()`.
- Support manual compaction with optional custom instructions.
- Support compaction cancellation through `abortCompaction()`.
- Support branch-summary cancellation through `abortBranchSummary()` when available.
- Keep prompt runs as a hard runtime-busy boundary for tree navigation and manual compaction.
- Add `navigating` and `compacting` session statuses.
- Keep Electron IPC as the transport.
- Keep `SessionSupervisor` as the runtime lifecycle owner.
- Keep renderer state as validated projections and transient UI state only.
- Keep `app-store.ts` below the maintainability threshold by extracting result appliers and tree/compaction state.
- Cover contracts, IPC routes, supervisor lifecycle, projection, store behavior, and renderer interactions with focused tests.
- Use `oxlint` and `oxfmt` as GUI package lint/format authority.

Out of scope:

- GUI-native `/share`
- import/export
- fork/clone session tools
- multi-window tree tools
- Node WebSocket server
- persistent tree navigator UI state across restart
- replacing Pi runtime tree or compaction semantics
- large renderer redesign

## Current Baseline

Before Phase 10:

- Phase 9 exposed slash command discovery and a native `/resume` flow.
- `/tree` and `/compact` were still not implemented as GUI-native desktop workflows.
- The GUI command palette could show unsupported built-ins as disabled.
- The main process already owned runtime handles through `SessionSupervisor`.
- The renderer already used `useSyncExternalStore` over immutable snapshots.
- `app-store.ts` was approaching the maintainability threshold and needed another slice before adding more modal state.
- The fake session driver supported prompt, queue, extension UI, model, and settings flows, but not deterministic branch trees or compaction.

Phase 10 builds on the existing Pi-native desktop architecture:

- `SessionSupervisor` owns active runtime handles in Electron main.
- `PiSdkSessionDriver` adapts real Pi SDK runtime sessions.
- `FakeSessionDriver` powers deterministic GUI and Electron tests.
- `ipc-router.ts` validates renderer commands and routes them through typed services.
- `SlashCommandService` classifies desktop-supported built-ins as `guiAction`.
- `app-store.ts` exposes immutable React external-store snapshots.
- Renderer components remain plain React components without a new state library.

## Implementation Plan

### Task 1: Add Tree And Compaction Contracts

**Files:**

- Modify: `packages/gui/src/contracts/snapshots.ts`
- Modify: `packages/gui/src/contracts/commands.ts`
- Modify: `packages/gui/src/contracts/errors.ts`
- Modify: `packages/gui/src/contracts/events.ts`
- Test: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Write failing contract tests**

Add decode coverage for:

- `SessionTreeEntrySnapshot`
- `SessionTreeSnapshot`
- `TreeNavigationSnapshot`
- `SessionCompactionSnapshot`
- `SessionGetTree`
- `SessionNavigateTree`
- `SessionSetTreeEntryLabel`
- `SessionCompact`
- `SessionCancelCompaction`
- `SessionCancelTreeNavigation`
- `tree.updated`
- `tree.navigationStarted`
- `tree.navigationCompleted`
- `tree.navigationFailed`
- `compaction.started`
- `compaction.completed`
- `compaction.failed`
- `compaction.cancelled`

Example test shape:

```ts
await expect(
	decodeGuiCommand(
		new SessionNavigateTree({
			requestId: requestIdFromString("request-tree-nav"),
			workspaceId,
			sessionId,
			targetEntryId: "entry-user-1",
			summaryMode: "custom",
			customInstructions: "focus on decisions",
		}),
	),
).resolves.toBeInstanceOf(SessionNavigateTree);
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected:

- New tests fail because schemas, commands, errors, and events are not defined.

**Step 3: Add snapshot schemas**

Add:

- `TreeFilterMode`
- `TreeEntryKind`
- `SessionTreeEntrySnapshot`
- `SessionTreeSnapshot`
- `TreeNavigationSummaryMode`
- `TreeNavigationSnapshot`
- `SessionCompactionSnapshot`

Keep tree payloads flat:

```ts
export const SessionTreeEntrySnapshot = Schema.Struct({
	entryId: Schema.String,
	parentId: Schema.Union(Schema.String, Schema.Null),
	childIds: Schema.Array(Schema.String),
	depth: Schema.Number,
	kind: TreeEntryKind,
	textPreview: Schema.String,
	label: Schema.optional(Schema.String),
	labelTimestamp: Schema.optional(Schema.String),
	isActiveLeaf: Schema.Boolean,
	isActivePath: Schema.Boolean,
	hasChildren: Schema.Boolean,
	searchText: Schema.String,
});
```

**Step 4: Add command schemas**

Add:

- `SessionGetTree`
- `SessionNavigateTree`
- `SessionSetTreeEntryLabel`
- `SessionCompact`
- `SessionCancelCompaction`
- `SessionCancelTreeNavigation`

Include all new commands in `GuiCommand`.

**Step 5: Add typed errors**

Add:

- `SessionTreeUnavailable`
- `SessionTreeNavigationFailed`
- `SessionTreeLabelUpdateFailed`
- `SessionCompactFailed`
- `SessionCompactionNotActive`

Include all new errors in `GuiError`.

**Step 6: Add events**

Add:

- `TreeUpdated`
- `TreeNavigationStarted`
- `TreeNavigationCompleted`
- `TreeNavigationFailed`
- `CompactionStarted`
- `CompactionCompleted`
- `CompactionFailed`
- `CompactionCancelled`

Include all new events in `GuiEvent`.

**Step 7: Run contract tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected:

- Contract tests pass.

**Step 8: Commit**

```bash
git add packages/gui/src/contracts packages/gui/test/contracts/contracts.test.ts
git commit -m "feat(gui): add tree and compaction contracts"
```

### Task 2: Add Tree Projection

**Files:**

- Create: `packages/gui/src/main/session/tree-projection.ts`
- Test: `packages/gui/test/main/session/tree-projection.test.ts`

**Step 1: Write failing projection tests**

Cover:

- active leaf
- active path
- labels
- user entries
- assistant entries
- tool entries
- compaction entries
- branch-summary entries
- unknown/custom entries
- missing parent IDs
- stable depth and child IDs

Example test shape:

```ts
const snapshot = projectSessionTreeSnapshot({
	workspaceId,
	sessionId,
	leafEntryId: "assistant-1",
	tree,
	getLabel: (entryId) => (entryId === "user-1" ? "start" : undefined),
	now: () => new Date("2026-06-20T00:00:00.000Z"),
});

expect(snapshot.entries).toContainEqual(
	expect.objectContaining({
		entryId: "assistant-1",
		kind: "assistant",
		isActiveLeaf: true,
		isActivePath: true,
	}),
);
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/tree-projection.test.ts
```

Expected:

- Test fails because `tree-projection.ts` does not exist.

**Step 3: Add projection implementation**

Create `projectSessionTreeSnapshot()` with:

- recursive Pi tree walk
- active path collection
- flat `SessionTreeEntrySnapshot[]`
- `kind` inference from Pi entry type and message role
- text preview extraction
- label lookup through node metadata or `getLabel(entryId)`
- stable `updatedAt`

Keep helper functions local:

- `projectNode`
- `collectActivePath`
- `getEntryKind`
- `getTextPreview`
- `extractText`
- `getEntryId`
- `getParentId`

**Step 4: Run projection tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/tree-projection.test.ts
```

Expected:

- Projection tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/main/session/tree-projection.ts packages/gui/test/main/session/tree-projection.test.ts
git commit -m "feat(gui): project session trees for renderer"
```

### Task 3: Extend Runtime Driver APIs

**Files:**

- Modify: `packages/gui/src/main/session/runtime-supervisor.ts`
- Modify: `packages/gui/src/main/session/session-driver.ts`
- Modify: `packages/gui/src/main/session/pi-sdk-session-driver.ts`
- Modify: `packages/gui/src/main/session/fake-session-driver.ts`
- Test: `packages/gui/test/main/session/pi-sdk-session-driver.test.ts`
- Test: `packages/gui/test/main/session/fake-session-driver.test.ts`

**Step 1: Write failing driver tests**

Cover:

- real SDK driver reads tree through `sessionManager.getTree()` and `getLeafId()`
- SDK driver labels through `appendLabelChange(id, label)`
- SDK driver navigates through `runtime.session.navigateTree()`
- SDK driver compacts through `runtime.session.compact()`
- SDK driver cancels compaction through `abortCompaction()`
- SDK driver cancels branch summary through `abortBranchSummary()`
- fake driver returns deterministic tree snapshots
- fake driver returns `editorText` for user entries
- fake driver clears composer for assistant/tool entries
- fake driver emits compaction lifecycle events

**Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/pi-sdk-session-driver.test.ts test/main/session/fake-session-driver.test.ts
```

Expected:

- Tests fail because driver interface methods do not exist.

**Step 3: Extend runtime interfaces**

In `runtime-supervisor.ts`, extend `RuntimeAgentSession` with optional Pi runtime methods:

```ts
compact?(customInstructions?: string): Promise<{
	firstKeptEntryId: string;
	summary: string;
	tokensBefore: number;
}>;
navigateTree?(
	targetId: string,
	options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: { id: string } }>;
abortCompaction?(): void;
abortBranchSummary?(): void;
```

In `session-driver.ts`, extend:

- `RuntimeTranscriptSessionManager`
- `NavigateRuntimeTreeRequest`
- `SessionDriver`

**Step 4: Implement SDK driver methods**

In `pi-sdk-session-driver.ts`, implement:

- `getTree(handle)`
- `navigateTree(handle, request)`
- `setTreeEntryLabel(handle, entryId, label)`
- `compact(handle, customInstructions)`
- `cancelCompaction(handle)`
- `cancelTreeNavigation(handle)`

Wrap runtime failures in typed GUI errors.

**Step 5: Implement fake driver methods**

In `fake-session-driver.ts`, add deterministic:

- fake tree state
- labels map
- leaf ID
- `getTree()`
- `navigateTree()`
- `setTreeEntryLabel()`
- `compact()`
- `cancelCompaction()`
- `cancelTreeNavigation()`

**Step 6: Run driver tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/pi-sdk-session-driver.test.ts test/main/session/fake-session-driver.test.ts
```

Expected:

- Driver tests pass.

**Step 7: Commit**

```bash
git add packages/gui/src/main/session/runtime-supervisor.ts packages/gui/src/main/session/session-driver.ts packages/gui/src/main/session/pi-sdk-session-driver.ts packages/gui/src/main/session/fake-session-driver.ts packages/gui/test/main/session
git commit -m "feat(gui): add tree and compaction runtime driver APIs"
```

### Task 4: Add Supervisor Lifecycle

**Files:**

- Modify: `packages/gui/src/main/session/session-supervisor.ts`
- Test: `packages/gui/test/main/session/session-supervisor.test.ts`

**Step 1: Write failing supervisor tests**

Cover:

- `getTree()` delegates to driver.
- `setTreeEntryLabel()` publishes `tree.updated`.
- `navigateTree()` publishes started, status, tree updated, completed, ready.
- navigation rejects while prompt run is active.
- `compact()` publishes started, status, tree updated, completed, ready.
- compaction rejects while prompt run is active.
- manual compaction suppresses duplicate runtime compaction events.
- runtime-origin `compaction_end` maps to completed.
- runtime-origin `compaction_end` with `errorMessage` maps to failed.
- runtime-origin aborted `compaction_end` maps to cancelled.
- `cancelCompaction()` delegates to driver and returns status to ready.
- `cancelTreeNavigation()` delegates to driver.

**Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
```

Expected:

- Tests fail until supervisor APIs and event handling exist.

**Step 3: Add supervisor methods**

Add methods:

- `getTree(workspaceId, sessionId)`
- `setTreeEntryLabel(workspaceId, sessionId, entryId, label)`
- `navigateTree(request)`
- `compact(workspaceId, sessionId, customInstructions)`
- `cancelCompaction(workspaceId, sessionId)`
- `cancelTreeNavigation(workspaceId, sessionId)`

Add `manualCompactionActive` to `ManagedSessionRecord`.

**Step 4: Add runtime event handling**

In `handleRuntimeEvent()`:

- translate runtime `compaction_start` into `compaction.started` only when not already manually tracked
- translate runtime `compaction_end` into:
  - `compaction.cancelled` when aborted
  - `compaction.failed` when `errorMessage` exists
  - `compaction.completed` after transcript/tree refresh on success

**Step 5: Run supervisor tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
```

Expected:

- Supervisor tests pass.

**Step 6: Commit**

```bash
git add packages/gui/src/main/session/session-supervisor.ts packages/gui/test/main/session/session-supervisor.test.ts
git commit -m "feat(gui): supervise tree navigation and compaction"
```

### Task 5: Route IPC Commands

**Files:**

- Modify: `packages/gui/src/main/ipc-router.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write failing IPC route tests**

Cover:

- `session.getTree`
- `session.navigateTree`
- `session.setTreeEntryLabel`
- `session.compact`
- `session.cancelCompaction`
- `session.cancelTreeNavigation`
- product-safe fallback message for unimplemented commands

**Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
```

Expected:

- New command routes fail.

**Step 3: Route commands**

In `ipc-router.ts`:

- import all new command classes
- route through `sessionSupervisor`
- publish accepted/completed receipts consistently with existing commands
- return typed success payloads
- replace internal phase fallback text with:

```ts
message: `${command._tag} is not implemented`;
```

**Step 4: Run IPC tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
```

Expected:

- IPC tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/main/ipc-router.ts packages/gui/test/main/ipc-router.test.ts
git commit -m "feat(gui): route tree and compaction IPC commands"
```

### Task 6: Add Slash Command Built-Ins

**Files:**

- Modify: `packages/gui/src/main/session/slash-command-service.ts`
- Test: `packages/gui/test/main/session/slash-command-service.test.ts`

**Step 1: Write failing slash command tests**

Assert:

- `/tree` is a built-in `guiAction`
- `/compact` is a built-in `guiAction`
- extension conflicts still resolve correctly

**Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/slash-command-service.test.ts
```

Expected:

- `/tree` and `/compact` are not yet GUI actions.

**Step 3: Mark built-ins as GUI actions**

Update:

```ts
const GUI_ACTION_COMMANDS = new Set(["resume", "new", "settings", "trust", "model", "name", "tree", "compact"]);
```

**Step 4: Run slash command tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/slash-command-service.test.ts
```

Expected:

- Slash command service tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/main/session/slash-command-service.ts packages/gui/test/main/session/slash-command-service.test.ts
git commit -m "feat(gui): expose tree and compact slash actions"
```

### Task 7: Add Renderer Store Slice

**Files:**

- Create: `packages/gui/src/renderer/app/tree-and-compaction-store.ts`
- Create: `packages/gui/src/renderer/app/app-result-appliers.ts`
- Modify: `packages/gui/src/renderer/app/app-store.ts`
- Test: `packages/gui/test/renderer/app-store.test.ts`

**Step 1: Write failing store tests**

Cover:

- tree load success stores snapshot by `workspaceId:sessionId`
- rejected tree load clears loading and shows error
- navigation result applies transcript/tree/composer draft
- compaction result applies transcript/tree and closes dialog
- compaction cancellation sends `session.cancelCompaction` and clears pending state
- compaction events update status and modal state

**Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
```

Expected:

- Store tests fail because tree/compaction state and actions do not exist.

**Step 3: Add tree and compaction store slice**

Create `tree-and-compaction-store.ts` with:

- `TreeNavigatorState`
- `CompactDialogState`
- `createTreeAndCompactionStoreActions()`
- `emptyTreeNavigatorState()`
- `emptyCompactDialogState()`
- `applyTreeEvent()`
- `applyNavigationResult()`
- `applyCompactionResult()`

Add actions:

- `openTreeNavigator()`
- `closeTreeNavigator()`
- `getTree()`
- `navigateTree()`
- `cancelTreeNavigation()`
- `setTreeEntryLabel()`
- `setTreeNavigatorQuery()`
- `setTreeNavigatorFilterMode()`
- `setTreeNavigatorSelectedEntry()`
- `expandTreeNavigatorEntry()`
- `collapseTreeNavigatorEntry()`
- `openCompactDialog()`
- `closeCompactDialog()`
- `setCompactInstructions()`
- `compactSession()`
- `cancelCompaction()`

**Step 4: Extract result appliers**

Create `app-result-appliers.ts` so `app-store.ts` does not keep growing:

- `applyCommandResultData(state, data)`
- `decodeQueueRestoreData(data)`

Move command-result decode/apply logic out of `app-store.ts`.

**Step 5: Wire app store**

In `app-store.ts`:

- add `treesBySessionKey`
- add `treeNavigator`
- add `compactDialog`
- expose tree/compaction store methods in `GuiCatalogStore`
- apply `tree.*` and `compaction.*` events
- import `createTreeAndCompactionStoreActions()`

**Step 6: Run store tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
```

Expected:

- Store tests pass.
- `packages/gui/src/renderer/app/app-store.ts` remains below 1k lines.

**Step 7: Commit**

```bash
git add packages/gui/src/renderer/app/app-store.ts packages/gui/src/renderer/app/app-result-appliers.ts packages/gui/src/renderer/app/tree-and-compaction-store.ts packages/gui/test/renderer/app-store.test.ts
git commit -m "feat(gui): add tree and compaction renderer state"
```

### Task 8: Add Tree Navigator And Compact Dialog UI

**Files:**

- Create: `packages/gui/src/renderer/app/tree-navigator.tsx`
- Modify: `packages/gui/src/renderer/app/App.tsx`
- Modify: `packages/gui/src/renderer/app/command-palette.tsx`
- Modify: `packages/gui/src/renderer/styles/app.css`
- Test: `packages/gui/test/renderer/tree-navigator.test.tsx`
- Test: `packages/gui/test/renderer/command-palette.test.tsx`
- Test: `packages/gui/test/renderer/app-panels.test.tsx`
- Test: `packages/gui/test/renderer/catalog-view.test.tsx`

**Step 1: Write failing renderer tests**

Cover:

- command palette opens tree navigator for `/tree`
- command palette opens compact dialog for `/compact`
- ArrowRight expands collapsed parent
- ArrowRight on expanded parent selects first visible child
- ArrowLeft collapses expanded parent
- ArrowLeft on child selects parent
- Enter starts navigation
- compact cancel remains enabled while compacting
- compact cancel calls `session.cancelCompaction`

**Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/tree-navigator.test.tsx test/renderer/command-palette.test.tsx test/renderer/app-panels.test.tsx test/renderer/catalog-view.test.tsx
```

Expected:

- Tests fail because components and command actions are not wired.

**Step 3: Implement `TreeNavigator`**

Create a modal with:

- search input
- filter select:
  - `default`
  - `no-tools`
  - `user-only`
  - `labeled-only`
  - `all`
- summary select:
  - `none`
  - `default`
  - `custom`
- branch-summary instructions input for custom mode
- accessible tree list with `role="tree"` and `role="treeitem"`
- selected state
- active path and active leaf styling hooks
- label input
- Go button

Keyboard rules:

- Up/Down move selection
- Home/End jump to first/last visible entry
- Right expands collapsed selected parent
- Right on expanded parent moves to first visible child
- Left collapses expanded selected parent
- Left on child moves to parent
- Enter starts navigation

**Step 4: Implement `CompactDialog`**

Create a modal with:

- optional instructions textarea
- Compact button
- Cancel button
- inline error state
- compacting/cancelling state

Behavior:

- idle Cancel closes dialog
- compacting Cancel calls `cancelCompaction()`
- Close is disabled while compacting

**Step 5: Wire app shell**

In `App.tsx`, mount:

- `TreeNavigator`
- `CompactDialog`

near existing command/resume/settings modal layer.

**Step 6: Wire command palette**

In `command-palette.tsx`:

- `/tree` closes palette and calls `store.openTreeNavigator(workspaceId, sessionId)`
- `/compact` closes palette and calls `store.openCompactDialog(workspaceId, sessionId)`

**Step 7: Add minimal styles**

In `app.css`, add:

- dense tree rows
- stable line height
- active path
- active leaf
- label pill
- selected row
- compact textarea styling
- tree action layout

**Step 8: Run renderer tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/tree-navigator.test.tsx test/renderer/command-palette.test.tsx test/renderer/app-panels.test.tsx test/renderer/catalog-view.test.tsx
```

Expected:

- Renderer tests pass.

**Step 9: Commit**

```bash
git add packages/gui/src/renderer/app/tree-navigator.tsx packages/gui/src/renderer/app/App.tsx packages/gui/src/renderer/app/command-palette.tsx packages/gui/src/renderer/styles/app.css packages/gui/test/renderer
git commit -m "feat(gui): add tree navigator and compact dialog"
```

### Task 9: Remove Internal Planning Labels

**Files:**

- Modify any staged GUI source/test file containing internal phase labels.

**Step 1: Scan staged files**

Run:

```bash
git grep --cached -n -E "phase10|Phase10|Phase 10|not implemented in Phase|\bPhase\b|phase content" -- packages/gui/src packages/gui/test
```

Expected before cleanup:

- Any internal planning labels are listed.

**Step 2: Rename phase-specific store**

Use product/domain names:

- `phase10-store.ts` -> `tree-and-compaction-store.ts`
- `createPhase10StoreActions` -> `createTreeAndCompactionStoreActions`
- `Phase10StoreActions` -> `TreeAndCompactionStoreActions`
- `phase10Actions` -> `treeAndCompactionActions`

**Step 3: Replace test labels**

Replace test descriptions such as:

- `"Phase 10 built-ins"` -> `"supported GUI built-ins"`
- `"decodes phase 3 catalog events"` -> `"decodes catalog events"`
- `"not implemented in Phase 4"` -> `"is not implemented"`

**Step 4: Re-run leak scan**

Run:

```bash
git grep --cached -n -E "phase10|Phase10|Phase 10|not implemented in Phase|\bPhase\b|phase content" -- packages/gui/src packages/gui/test
```

Expected:

- No output.

**Step 5: Commit**

```bash
git add packages/gui/src packages/gui/test
git commit -m "fix(gui): remove internal planning labels"
```

### Task 10: Final Verification

**Files:**

- All modified Phase 10 files.

**Step 1: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/session/tree-projection.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts test/renderer/tree-navigator.test.tsx test/renderer/command-palette.test.tsx test/renderer/app-panels.test.tsx test/renderer/catalog-view.test.tsx
```

Expected:

- All focused tests pass.

**Step 2: Run GUI package check**

Run:

```bash
npm --prefix packages/gui run check
```

Expected:

- `oxfmt --check` passes.
- `oxlint` passes.
- `tsgo --noEmit -p tsconfig.json` passes.
- GUI Vitest suite passes.

**Step 3: Run root check**

Run:

```bash
npm run check
```

Expected:

- Biome check passes.
- pinned dependency check passes.
- TS relative import check passes.
- shrinkwrap check passes.
- root typecheck passes.
- browser smoke passes.
- GUI package check passes.

**Step 4: Run Electron E2E**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected:

- Electron launches and Playwright specs pass in a desktop-capable environment.
- If Electron cannot launch in the current environment, record the exact launch error as a verification gap.

**Step 5: Commit**

```bash
git add packages/gui
git commit -m "feat(gui): add native tree navigation and compaction controls"
```

## Implementation Report

### Completed Changes

Contracts:

- Added tree and compaction command contracts in `packages/gui/src/contracts/commands.ts`.
- Added tree, navigation, compaction, filter, and status snapshots in `packages/gui/src/contracts/snapshots.ts`.
- Added tree and compaction typed errors in `packages/gui/src/contracts/errors.ts`.
- Added tree and compaction events in `packages/gui/src/contracts/events.ts`.
- Added contract decode tests in `packages/gui/test/contracts/contracts.test.ts`.

Main process:

- Added `projectSessionTreeSnapshot()` in `packages/gui/src/main/session/tree-projection.ts`.
- Extended `RuntimeAgentSession` and `SessionDriver` for tree navigation, labels, compaction, and cancellation.
- Implemented SDK driver methods in `packages/gui/src/main/session/pi-sdk-session-driver.ts`.
- Implemented deterministic fake driver tree and compaction behavior in `packages/gui/src/main/session/fake-session-driver.ts`.
- Added supervisor methods for tree read, tree navigation, label updates, manual compaction, and cancellation.
- Added runtime-origin compaction event translation in `SessionSupervisor`.
- Added manual compaction event de-duplication through `manualCompactionActive`.
- Routed all new IPC commands in `packages/gui/src/main/ipc-router.ts`.
- Marked `/tree` and `/compact` as built-in GUI actions in `packages/gui/src/main/session/slash-command-service.ts`.

Renderer:

- Added `packages/gui/src/renderer/app/tree-and-compaction-store.ts`.
- Added `packages/gui/src/renderer/app/app-result-appliers.ts`.
- Reduced `packages/gui/src/renderer/app/app-store.ts` below 1k lines.
- Added `TreeNavigator` and `CompactDialog` in `packages/gui/src/renderer/app/tree-navigator.tsx`.
- Mounted both modals in `packages/gui/src/renderer/app/App.tsx`.
- Wired `/tree` and `/compact` command palette actions in `packages/gui/src/renderer/app/command-palette.tsx`.
- Added compact tree and dialog styling in `packages/gui/src/renderer/styles/app.css`.

Tests:

- Added tree projection tests.
- Added supervisor tree/compaction lifecycle tests.
- Added IPC route tests for all new commands.
- Added renderer store tests for rejected tree loading and compaction cancellation.
- Added tree navigator keyboard and compact dialog cancellation tests.
- Updated command palette, app panel, and catalog view stubs for new store surface.

Internal cleanup:

- Renamed phase-specific renderer store naming to product/domain naming.
- Replaced internal phase fallback messages and test labels with product-safe text.
- Verified staged GUI source/tests do not contain internal phase labels.

### Verification Results

Focused tests run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts test/renderer/tree-navigator.test.tsx test/renderer/command-palette.test.tsx test/renderer/app-panels.test.tsx test/renderer/catalog-view.test.tsx
```

Result:

- Passed.

Package check run:

```bash
npm --prefix packages/gui run check
```

Result:

- Passed.
- 34 GUI test files passed.
- 209 GUI tests passed.

Root check run:

```bash
npm run check
```

Result:

- Passed.

Electron E2E run:

```bash
npm --prefix packages/gui run test:electron
```

Result:

- Production Electron build succeeded.
- Playwright Electron specs failed because the Electron process could not launch in the current environment.
- Error reported by Playwright: `Error: Process failed to launch!`
- This remains an environment verification gap, not a unit/type/lint failure.

Internal label scan:

```bash
git grep --cached -n -E "phase10|Phase10|Phase 10|not implemented in Phase|\bPhase\b|phase content" -- packages/gui/src packages/gui/test
```

Result:

- No matches after remediation.

### Current Review Findings Before Merge

1. Manual compaction cancellation can publish contradictory lifecycle states.

   Current risk:

   - `cancelCompaction()` publishes `compaction.cancelled`.
   - The original in-flight `compact()` promise can still reject after `abortCompaction()`.
   - `compact()` then publishes `compaction.failed`.

   Required fix:

   - Track a manual cancellation flag on the session record.
   - If cancellation was requested, treat the compact rejection as cancelled.
   - Publish only `compaction.cancelled`.
   - Return a cancelled snapshot or a typed cancellation result rather than surfacing a failure.

2. Tree navigation cancellation is routed but not exposed as usable pending UI.

   Current risk:

   - `cancelTreeNavigation()` exists in contracts, IPC, driver, and store.
   - `TreeNavigator` starts navigation fire-and-forget.
   - There is no `navigationPending` or `navigationCancelling` modal state.
   - Escape does not cancel a long branch summary navigation.

   Required fix:

   - Add pending/cancelling tree navigation state.
   - Keep the tree modal open while summary navigation is running.
   - Add Cancel/Escape behavior that calls `session.cancelTreeNavigation`.
   - Add renderer tests for the cancellation path.

## Final Commit Recommendation

Use one Conventional Commit with a detailed body:

```text
feat(gui): add native tree navigation and compaction controls

- add typed tree and compaction IPC commands, snapshots, events, and errors
- project Pi session trees into flat renderer-safe snapshots with labels and active path state
- wire supervisor and drivers for tree navigation, label updates, manual compaction, and cancellation
- add tree navigator and compact dialog UI with search, filters, keyboard navigation, labels, and slash-command actions
- extract renderer result appliers and cover contracts, IPC, supervisor, projection, store, and component behavior with tests
```

## Execution Handoff

Plan complete and saved to `docs/plans/2026-06-20-pi-native-gui-phase-10-plan-and-report.md`. Two execution options:

1. **Subagent-Driven (this session)** - Dispatch a fresh subagent per remaining remediation task, review between tasks, fast iteration.

2. **Parallel Session (separate)** - Open a new session with `superpowers:executing-plans`, batch execution with checkpoints.

Recommended next step:

- Fix the two current review findings before merging Phase 10.

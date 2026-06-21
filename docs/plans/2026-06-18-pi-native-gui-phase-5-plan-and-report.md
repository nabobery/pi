# Pi Native GUI Phase 5 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the first user-visible Pi prompt loop so the desktop GUI can send prompts to an opened Pi runtime, stream assistant and tool events into the timeline, cancel active runs, and preserve per-session composer drafts.

**Architecture:** Phase 5 keeps Electron main as the owner of Pi SDK runtime objects and treats the renderer as a typed read-model client. `SessionSupervisor` owns run lifecycle state, `PiSdkSessionDriver` owns the Pi `AgentSession.prompt()` / `abort()` seam, IPC remains Effect Schema validated, and the renderer store applies immutable event reductions through `useSyncExternalStore`.

**Tech Stack:** Electron IPC, Effect Schema, TypeScript, Pi coding-agent runtime APIs, React `useSyncExternalStore`, oxlint, oxfmt, Vitest.

---

## Phase 5 Scope

Phase 5 is the **Prompt Loop, Timeline, Composer** phase from `docs/plans/2026-06-18-pi-native-gui-implementation-phases.md`.

In scope:

- Implement `session.sendMessage` against an already opened runtime session.
- Implement `session.cancelRun` against the active Pi runtime run.
- Return prompt send success after Pi preflight acceptance, not after the full run completes.
- Preserve preflight-rejected composer drafts.
- Stream typed runtime events into a renderer timeline read model.
- Support idle prompt sends.
- Support active-run `Steer` sends.
- Support active-run `Follow-up` sends.
- Reject delivery-mode sends when no run is active.
- Track active run identity in `SessionSupervisor`.
- Emit run lifecycle events:
  - `run.started`
  - `run.completed`
  - `run.failed`
  - `run.cancelled`
- Emit runtime timeline events:
  - `timeline.messageDelta`
  - `tool.started`
  - `tool.updated`
  - `tool.finished`
  - `queue.updated`
- Add `cancelling` to session status.
- Keep final transcript snapshots Pi-owned by refreshing through the driver on completion.
- Add renderer-local composer drafts keyed by `workspaceId:sessionId`.
- Add minimal composer controls:
  - idle `Send`
  - running `Steer`
  - running `Follow-up`
  - running/cancelling `Cancel`
- Add deterministic fake-driver tests before relying on real provider behavior.

Out of scope:

- Model selector or thinking controls.
- Settings and trust UI.
- Extension UI prompts.
- Slash command palette.
- `/tree`, `/resume`, `/compact`, `/share`.
- Full queue editor.
- Background sessions.
- Image attachments.
- Broad Electron E2E coverage.
- Real-provider tests or paid-token validation.
- Phase 6+ TUI parity work.

## Implemented Changes

### Coding-Agent Runtime Export

Modified `packages/coding-agent/src/runtime.ts`.

- Re-exported the narrow runtime types needed by the GUI driver:
  - `AgentSessionEvent`
  - `PromptOptions`

Reason:

- `packages/gui` can type the SDK prompt and subscription seam through the public `@earendil-works/pi-coding-agent/runtime` subpath.
- The GUI avoids deep imports into `packages/coding-agent/src/core/**`.

### GUI Contract Surface

Modified `packages/gui/src/contracts/**`.

- Extended `session.sendMessage` payload with:
  - `deliveryMode?: "steer" | "followUp"`
- Added `cancelling` to `SessionStatus`.
- Added richer timeline entries:
  - `kind: "error"`
  - optional `toolCallId`
  - optional `toolName`
  - optional `isLive`
  - optional `isError`
- Added `workspaceId` and `runId` to runtime stream events where needed:
  - `timeline.messageDelta`
  - `tool.started`
  - `tool.updated`
  - `tool.finished`
  - `run.started`
  - `run.completed`
  - `run.failed`
- Added `workspaceId` to `queue.updated`.
- Added `run.cancelled`.
- Added prompt and cancel errors:
  - `SessionPromptRejected`
  - `SessionPromptFailed`
  - `SessionCancelFailed`
  - `SessionRunNotActive`
- Extended `GuiError` and `GuiEvent` unions with the new Phase 5 variants.

### Main Session Driver Seam

Modified `packages/gui/src/main/session/session-driver.ts`.

- Extended `SessionDriver` with:
  - `sendMessage(handle, request)`
  - `cancelRun(handle)`
- Changed `subscribe(handle, listener)` to receive runtime session events.
- Added `SendRuntimeMessageRequest`.
- Added `SendRuntimeMessageResult`.
- Exposed `RuntimeSessionEvent` as the GUI-facing alias for `AgentSessionEvent`.

Modified `packages/gui/src/main/session/runtime-supervisor.ts`.

- Extended `RuntimeAgentSession` with:
  - `prompt(text, options?)`
  - `abort()`
  - `subscribe(listener)`
- Kept the runtime object owned by Electron main.

Modified `packages/gui/src/main/session/pi-sdk-session-driver.ts`.

- Implemented `sendMessage()` by calling:

```ts
handle.runtime.session.prompt(request.message, {
	...(request.deliveryMode ? { streamingBehavior: request.deliveryMode } : {}),
	source: "rpc",
	preflightResult: (success) => {
		// resolve or reject command acceptance
	},
});
```

- Returns after `preflightResult(true)` and exposes the prompt completion promise separately.
- Maps preflight rejection to `SessionPromptRejected`.
- Keeps post-acceptance completion/failure async for `SessionSupervisor`.
- Implements `cancelRun()` through `handle.runtime.session.abort()`.
- Maps abort failures to `SessionCancelFailed`.
- Subscribes to `handle.runtime.session.subscribe(listener)`.

### Session Supervisor Runtime Loop

Modified `packages/gui/src/main/session/session-supervisor.ts`.

- Added `activeRunId` to each managed runtime record.
- Added a monotonic per-supervisor run sequence for generated run IDs.
- Implemented `sendMessage(request)`.
- Normal idle prompt path:
  - calls `driver.sendMessage()`
  - publishes `session.sendMessage.accepted` only after preflight success
  - creates and stores a run ID
  - emits `run.started`
  - emits `session.statusChanged` with `running`
  - attaches completion/failure handlers to the prompt completion promise
- Active delivery-mode path:
  - requires an existing `activeRunId`
  - calls `driver.sendMessage()` with `deliveryMode`
  - publishes only `session.sendMessage.accepted`
  - does not emit `run.started`
  - does not replace `activeRunId`
  - does not mark the session `ready` when the queued prompt promise resolves
- Preflight rejection path:
  - propagates the typed failure
  - emits no run lifecycle events
  - leaves session status unchanged
- Completion path:
  - refreshes transcript through `driver.getTranscript()`
  - emits `run.completed` with the snapshot
  - clears `activeRunId`
  - marks the session `ready`
- Failure path:
  - emits `run.failed`
  - clears `activeRunId`
  - marks the session `failed`
  - keeps the runtime open
- Cancel path:
  - requires an active run
  - marks status `cancelling`
  - calls `driver.cancelRun()`
  - on success, clears `activeRunId`, emits `run.cancelled`, and marks `ready`
  - on failure, restores `running`, keeps `activeRunId`, and throws `SessionCancelFailed`
- Runtime event translation:
  - `message_update` with `text_delta` -> `timeline.messageDelta`
  - `tool_execution_start` -> `tool.started`
  - `tool_execution_update` -> `tool.updated`
  - `tool_execution_end` -> `tool.finished`
  - `queue_update` -> `queue.updated`
- Runtime stream events without an active run are ignored except `queue_update`.

### Electron IPC Routing

Modified `packages/gui/src/main/ipc-router.ts`.

- Extended injected `sessionSupervisor` route surface with:
  - `sendMessage`
  - `cancelRun`
- Routed `SessionSendMessage` through `SessionSupervisor.sendMessage()`.
- Routed `SessionCancelRun` through `SessionSupervisor.cancelRun()`.
- Stopped publishing generic `.accepted` receipts for `session.sendMessage` and `session.cancelRun`.
- Left `session.sendMessage.accepted` ownership inside `SessionSupervisor`, because Pi preflight determines acceptance.
- Kept generic completed receipts after the supervisor command resolves.
- Preserved typed failure envelopes for preflight/cancel errors.

### Renderer Store

Modified `packages/gui/src/renderer/app/app-store.ts`.

- Added store methods:
  - `sendMessage(workspaceId, sessionId, message, deliveryMode?)`
  - `cancelRun(workspaceId, sessionId)`
  - `setComposerDraft(workspaceId, sessionId, value)`
- Added `composerDrafts` to renderer state.
- Changed internal command invocation to return a boolean acceptance result.
- Kept existing non-prompt public methods as `Promise<void>` through a small `invokeVoid()` wrapper.
- `sendMessage()` now returns `true` for accepted command results and `false` for pre-acceptance failures.
- Applies runtime events immutably:
  - `run.started` sets session status to `running`
  - `timeline.messageDelta` appends into one live assistant row per run
  - `tool.started` inserts or updates one tool row per `toolCallId`
  - `tool.updated` patches that tool row
  - `tool.finished` marks the tool row non-live and records error state
  - `run.completed` marks ready and replaces timeline with the snapshot when present
  - `run.failed` marks failed and appends an error row
  - `run.cancelled` marks ready
- Keeps `useSyncExternalStore` as the only renderer state integration.
- Keeps event state as immutable snapshots.

### Renderer UI

Modified `packages/gui/src/renderer/app/App.tsx`.

- Replaced disabled placeholder composer with a working form.
- Enables the composer when the selected session is:
  - `ready`
  - `running`
  - `cancelling`
- Idle state:
  - shows `Send`
  - submits through the form
- Running state:
  - shows `Steer`
  - shows `Follow-up`
  - shows `Cancel`
- Cancelling state:
  - keeps composer visible
  - disables prompt and cancel actions
- Blocks empty or whitespace-only sends.
- Awaits `store.sendMessage()`.
- Clears the draft only when the send is accepted.
- Preserves drafts when switching sessions because drafts are keyed by `workspaceId:sessionId`.

Modified `packages/gui/src/renderer/app/catalog-view.tsx`.

- Renders live transcript rows with `running` status text.
- Renders tool rows with tool names when available.
- Renders empty tool output as `Waiting for tool output.`
- Renders error timeline rows through the extended timeline snapshot shape.

Modified `packages/gui/src/renderer/styles/app.css`.

- Added minimal styles for:
  - live transcript rows
  - error transcript rows
  - composer action groups
- Kept the existing technical/minimal GUI style.
- Did not add a dashboard redesign, decorative visuals, icon library, or Tailwind.

## Implementation Plan

### Task 1: Extend Contracts For Prompt Loop Events

**Files:**

- Modify: `packages/gui/src/contracts/commands.ts`
- Modify: `packages/gui/src/contracts/errors.ts`
- Modify: `packages/gui/src/contracts/events.ts`
- Modify: `packages/gui/src/contracts/snapshots.ts`
- Test: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Write failing contract tests**

Add tests that prove:

- `SessionSendMessage` accepts no `deliveryMode` for idle sends.
- `SessionSendMessage` accepts `deliveryMode: "steer"`.
- `SessionSendMessage` accepts `deliveryMode: "followUp"`.
- Invalid delivery modes fail decoding.
- Runtime stream events require `workspaceId`.
- `run.cancelled` decodes.
- `SessionPromptRejected`, `SessionPromptFailed`, `SessionCancelFailed`, and `SessionRunNotActive` decode through `GuiError`.
- `SessionStatus` accepts `cancelling`.

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected before implementation: failures for unknown fields, missing event variants, missing status, and missing error tags.

**Step 3: Implement contract changes**

Update the schemas and unions listed in this task.

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected: contract tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/contracts packages/gui/test/contracts/contracts.test.ts
git commit -m "feat(gui): extend prompt loop contracts"
```

### Task 2: Extend The Runtime Driver Seam

**Files:**

- Modify: `packages/coding-agent/src/runtime.ts`
- Modify: `packages/gui/src/main/session/session-driver.ts`
- Modify: `packages/gui/src/main/session/runtime-supervisor.ts`
- Modify: `packages/gui/src/main/session/pi-sdk-session-driver.ts`
- Test: `packages/gui/test/main/session/pi-sdk-session-driver.test.ts`

**Step 1: Write failing driver tests**

Add tests for:

- `sendMessage()` returns after `preflightResult(true)`.
- `sendMessage()` passes `source: "rpc"`.
- `sendMessage()` passes `streamingBehavior` for delivery-mode sends.
- Preflight rejection maps to `SessionPromptRejected`.
- Post-acceptance completion remains available through the returned promise.
- `cancelRun()` calls `runtime.session.abort()`.
- `subscribe()` forwards runtime session events.

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/pi-sdk-session-driver.test.ts
```

Expected before implementation: compile or runtime failures for missing driver methods and missing runtime session APIs.

**Step 3: Add narrow runtime type exports**

Export `AgentSessionEvent` and `PromptOptions` from `packages/coding-agent/src/runtime.ts`.

**Step 4: Implement driver seam**

Update `SessionDriver`, `RuntimeAgentSession`, and `PiSdkSessionDriver` as described in the implemented changes.

**Step 5: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/pi-sdk-session-driver.test.ts
```

Expected: driver tests pass without real provider credentials.

**Step 6: Commit**

```bash
git add packages/coding-agent/src/runtime.ts packages/gui/src/main/session/session-driver.ts packages/gui/src/main/session/runtime-supervisor.ts packages/gui/src/main/session/pi-sdk-session-driver.ts packages/gui/test/main/session/pi-sdk-session-driver.test.ts
git commit -m "feat(gui): add prompt runtime driver seam"
```

### Task 3: Implement SessionSupervisor Run Lifecycle

**Files:**

- Modify: `packages/gui/src/main/session/session-supervisor.ts`
- Test: `packages/gui/test/main/session/session-supervisor.test.ts`

**Step 1: Write failing supervisor tests**

Add tests for:

- Accepted idle prompt emits `session.sendMessage.accepted`.
- Accepted idle prompt emits `run.started`.
- Accepted idle prompt marks the session `running`.
- Text deltas include `workspaceId`, `sessionId`, and `runId`.
- Tool start/update/end events are translated in order.
- Queue updates include steering and follow-up counts.
- Run completion refreshes transcript and marks ready.
- Post-acceptance prompt failure emits `run.failed` and marks failed.
- Active `deliveryMode: "steer"` emits accepted receipt only.
- Active `deliveryMode: "followUp"` emits accepted receipt only.
- Delivery mode with no active run throws `SessionRunNotActive`.
- Cancel without an active run throws `SessionRunNotActive`.
- Cancel success emits `run.cancelled` and marks ready.
- Cancel failure restores `running`, keeps the active run, and does not emit `run.cancelled`.

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
```

Expected before implementation: failures for missing send/cancel behavior and missing event translations.

**Step 3: Implement minimal supervisor behavior**

Add `activeRunId`, run ID generation, send/cancel methods, lifecycle helpers, and runtime event translation.

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
```

Expected: supervisor tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/main/session/session-supervisor.ts packages/gui/test/main/session/session-supervisor.test.ts
git commit -m "feat(gui): manage prompt run lifecycle"
```

### Task 4: Route Prompt And Cancel IPC

**Files:**

- Modify: `packages/gui/src/main/ipc-router.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write failing IPC tests**

Add tests that prove:

- `session.sendMessage` routes through the injected `SessionSupervisor`.
- `session.cancelRun` routes through the injected `SessionSupervisor`.
- `session.sendMessage` does not emit the generic preflight accepted receipt before supervisor preflight succeeds.
- Successful prompt start returns `{ ok: true, data: undefined }`.
- Successful cancel returns `{ ok: true, data: undefined }`.

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
```

Expected before implementation: routing and receipt tests fail.

**Step 3: Implement IPC routing**

Extend the injected supervisor surface and route `SessionSendMessage` and `SessionCancelRun` through it.

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
```

Expected: IPC tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/main/ipc-router.ts packages/gui/test/main/ipc-router.test.ts
git commit -m "feat(gui): route prompt ipc through supervisor"
```

### Task 5: Add Renderer Prompt Store State

**Files:**

- Modify: `packages/gui/src/renderer/app/app-store.ts`
- Test: `packages/gui/test/renderer/app-store.test.ts`

**Step 1: Write failing renderer-store tests**

Add tests for:

- Composer drafts are isolated by `workspaceId:sessionId`.
- `sendMessage()` creates a `SessionSendMessage` command.
- `sendMessage()` returns `true` on accepted command results.
- `sendMessage()` returns `false` on pre-acceptance failures.
- Pre-acceptance failure preserves the draft.
- `cancelRun()` creates a `SessionCancelRun` command.
- `run.started` marks the session running.
- `timeline.messageDelta` accumulates one live assistant row.
- `tool.started`, `tool.updated`, and `tool.finished` update one tool row per `toolCallId`.
- `run.completed` replaces the live timeline with the transcript snapshot.
- `run.failed` appends an error row and marks failed.
- `run.cancelled` marks ready.

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
```

Expected before implementation: store API and event reduction tests fail.

**Step 3: Implement store state and reducers**

Add `composerDrafts`, `sendMessage()`, `cancelRun()`, `setComposerDraft()`, boolean command acceptance, and immutable runtime event reducers.

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
```

Expected: renderer-store tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/renderer/app/app-store.ts packages/gui/test/renderer/app-store.test.ts
git commit -m "feat(gui): add prompt timeline store state"
```

### Task 6: Wire Minimal Composer And Timeline UI

**Files:**

- Modify: `packages/gui/src/renderer/app/App.tsx`
- Modify: `packages/gui/src/renderer/app/catalog-view.tsx`
- Modify: `packages/gui/src/renderer/styles/app.css`

**Step 1: Wire composer draft state**

Use `store.setComposerDraft()` for the selected `workspaceId:sessionId` key.

**Step 2: Wire idle send**

Submit trimmed text through `store.sendMessage(workspaceId, sessionId, message)`.

**Step 3: Preserve draft on failed acceptance**

Clear the draft only when `store.sendMessage()` resolves `true`.

**Step 4: Wire running controls**

Render `Steer`, `Follow-up`, and `Cancel` when the selected session status is `running` or `cancelling`.

**Step 5: Render timeline runtime rows**

Render live rows, tool rows, and error rows with minimal styling.

**Step 6: Run focused store and package checks**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
npm run check
```

Expected: renderer store tests and package checks pass.

**Step 7: Commit**

```bash
git add packages/gui/src/renderer/app/App.tsx packages/gui/src/renderer/app/catalog-view.tsx packages/gui/src/renderer/styles/app.css
git commit -m "feat(gui): wire prompt composer controls"
```

### Task 7: Final Verification

**Files:**

- All staged Phase 5 files.

**Step 1: Run focused Phase 5 tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/session/pi-sdk-session-driver.test.ts test/main/session/session-supervisor.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts test/renderer/app-store.test.ts
```

Expected: all focused tests pass.

**Step 2: Run package check**

Run:

```bash
npm --prefix packages/gui run check
```

Expected: format check, oxlint, tsgo, and package-local Vitest pass.

**Step 3: Run root check**

Run:

```bash
npm run check
```

Expected: root checks pass with no remaining formatting rewrites.

**Step 4: Review staged diff**

Run:

```bash
git status --short
git diff --staged --stat
git diff --staged --check
```

Expected:

- Only intended Phase 5 files are staged.
- No unrelated `.gitignore` hunk is staged.
- No whitespace errors.

**Step 5: Commit**

```bash
git add packages/coding-agent/src/runtime.ts packages/gui/src/contracts packages/gui/src/main/session packages/gui/src/main/ipc-router.ts packages/gui/src/renderer/app packages/gui/src/renderer/styles/app.css packages/gui/test
git commit -m "feat(gui): add Pi prompt loop and live session composer"
```

## Verification Performed

The current Phase 5 staged implementation was verified with:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts test/main/session/pi-sdk-session-driver.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
npm run check
```

Root verification was also run:

```bash
npm run check
```

Observed result:

- GUI package checks passed.
- Root checks passed.
- `git diff --staged --check` passed.
- The unrelated `.gitignore` hunk was removed from the staged set.

## Known Review Follow-Up

The staged implementation satisfies the required Phase 5 lifecycle remediation items, but one renderer polish issue should be fixed before merge:

- On `run.cancelled`, `packages/gui/src/renderer/app/app-store.ts` currently marks the session `ready` but does not clear `isLive` from live assistant/tool timeline rows.
- Because `packages/gui/src/renderer/app/catalog-view.tsx` renders `entry.isLive ? " running" : ""`, a cancelled run can leave stale `assistant running` or tool running text in the timeline.

Recommended fix:

1. Add a renderer-store regression:
   - apply `run.started`
   - apply `timeline.messageDelta`
   - apply `run.cancelled`
   - assert session status is `ready`
   - assert the timeline has no `isLive: true` entries for that session
2. Update the `run.cancelled` reducer to mark live entries for that `workspaceId:sessionId` as `isLive: false`.
3. Re-run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
npm run check
cd ../..
npm run check
```

This is still Phase 5 scope because it is cancellation timeline cleanup, not Phase 6+ functionality.

## Deferred To Phase 6+

- Model display and model selector.
- Thinking level display and selector.
- Settings summary and trust status.
- Extension UI prompts.
- Slash command palette.
- `/tree`, `/resume`, `/compact`, `/share`.
- Full queue editor.
- Background sessions.
- Image attachments.
- Broad Electron E2E coverage.

## Final Notes

- Phase 5 keeps the GUI SDK-first rather than adding a Node WebSocket server boundary.
- Prompt acceptance is owned by Pi preflight, not generic IPC receipt emission.
- Final transcript snapshots remain Pi-owned truth; renderer live rows are temporary read-model state.
- The renderer store remains local and simple; no new state library was introduced.
- Fake driver/session tests are the right proof layer for Phase 5 because they verify the same `SessionDriver` seam used by the real SDK driver.

# Pi Native GUI Phase 8 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Pi-native background session behavior to the desktop GUI: multiple open runtime sessions, selected-session focus independent from running sessions, session-scoped queues, unread/activity state, and restore-all queued messages.

**Architecture:** Electron main remains the owner of Pi runtime handles, queue truth, runtime caps, and driver lifecycle. The renderer receives typed Effect Schema events and stores only immutable session-keyed projections for timelines, queues, activity badges, and runtime overlays. React continues to consume the existing `useSyncExternalStore` store; no WebSocket boundary, new state library, or runtime rewrite is introduced.

**Tech Stack:** Electron, Effect Schema, TypeScript, React, Vitest, happy-dom, Playwright Electron, oxlint, oxfmt.

---

## Phase 8 Scope

Phase 8 is the **P0/P1 Background Sessions, Queues, And Activity State** phase for `packages/gui`.

In scope:

- Keep multiple runtime sessions open in one GUI app instance.
- Keep selected session focus independent from running sessions.
- Make `session.open` idempotent for already-open runtime sessions.
- Add a configurable runtime-open cap, defaulting to 4 open sessions.
- Reject new runtime opens before catalog mutation when the open-runtime cap is reached.
- Add queue snapshot contracts with full steering/follow-up message text, counts, and delivery modes.
- Add restore-all queued messages through Pi runtime `clearQueue()`.
- Store queue state per `workspaceId:sessionId`.
- Preserve runtime status overlays when catalog sync returns stale idle file metadata.
- Mark background activity as unread in the renderer.
- Mark background extension UI requests as needs-input without stealing focus.
- Add sidebar badges for unread, queued, and needs-input state.
- Add per-session sidebar cancel and close actions.
- Only show close for sessions with an open runtime.
- Add a compact selected-session queue panel with restore-to-composer.
- Extend fake runtime driver support for deterministic queue tests.
- Keep renderer state split into focused projection helpers instead of growing `app-store.ts` past 1k lines.

Out of scope:

- Targeted queue item remove/replace.
- Persisting unread/activity state across app restart.
- OS notifications.
- WebSocket/server runtime boundary.
- Real-provider Electron E2E.
- Full TUI parity commands such as `/tree`, `/resume`, `/compact`, and `/share`.

## Current Baseline

Before Phase 8:

- The GUI had a single focused-session mental model.
- Opening an already-open runtime failed with `SessionAlreadyOpen`.
- Queue updates only carried counts.
- The renderer had no durable per-session queue/activity projection.
- Background events could not be represented clearly in the sidebar.
- Extension UI requests were selected-session scoped.
- Close/cancel actions were not available as compact per-session sidebar controls.

Phase 8 builds on the Phase 1-7 architecture:

- `SessionSupervisor` owns runtime handles in Electron main.
- `PiSdkSessionDriver` adapts Pi SDK runtime sessions.
- `FakeSessionDriver` powers deterministic GUI/Electron tests.
- `ipc-router.ts` validates command/result/event contracts.
- `app-store.ts` exposes immutable React external-store snapshots.
- Renderer components remain plain React components without a new state library.

## Implementation Plan

### Task 1: Add Queue And Activity Contracts

**Files:**

- Modify: `packages/gui/src/contracts/snapshots.ts`
- Modify: `packages/gui/src/contracts/events.ts`
- Modify: `packages/gui/src/contracts/commands.ts`
- Modify: `packages/gui/src/contracts/errors.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Steps:**

1. Add `QueueMode`, `QueueMessageSnapshot`, `QueueSnapshot`, `QueueRestoreSnapshot`, and `SessionActivitySnapshot`.
2. Extend `queue.updated` to include full message arrays, delivery modes, counts, and the complete queue snapshot.
3. Add `session.activityUpdated`.
4. Add `session.restoreQueuedMessages`.
5. Add typed errors:
   - `SessionOpenLimitReached`
   - `SessionRuntimeNotOpen`
   - `SessionQueueRestoreFailed`
6. Keep schemas Effect Schema validated at IPC boundaries.
7. Add routing coverage for `session.restoreQueuedMessages`.

### Task 2: Extend Runtime Driver Queue APIs

**Files:**

- Modify: `packages/gui/src/main/session/runtime-supervisor.ts`
- Modify: `packages/gui/src/main/session/session-driver.ts`
- Modify: `packages/gui/src/main/session/pi-sdk-session-driver.ts`
- Modify: `packages/gui/src/main/session/fake-session-driver.ts`
- Create: `packages/gui/src/main/session/queue-projection.ts`
- Test: `packages/gui/test/main/session/pi-sdk-session-driver.test.ts`
- Test: `packages/gui/test/main/session/fake-session-driver.test.ts`

**Steps:**

1. Extend `RuntimeAgentSession` with:
   - `getSteeringMessages()`
   - `getFollowUpMessages()`
   - `clearQueue()`
   - `steeringMode`
   - `followUpMode`
2. Extend `SessionDriver` with:
   - `getQueue(handle)`
   - `restoreQueuedMessages(handle)`
3. Add `projectQueueSnapshot()` and `projectQueueRestoreSnapshot()` as the canonical queue mappers.
4. Implement SDK queue projection through Pi runtime APIs.
5. Implement fake driver queue state and deterministic `queue_update` events.
6. Ensure restore uses the runtime queue event as the single queue-update publication source.

### Task 3: Update Session Supervisor Runtime Semantics

**Files:**

- Modify: `packages/gui/src/main/session/session-supervisor.ts`
- Test: `packages/gui/test/main/session/session-supervisor.test.ts`

**Steps:**

1. Track per-runtime:
   - `activeRunId`
   - `queueSnapshot`
   - `lastActivitySequence`
   - `needsInput`
   - runtime `session`
2. Add `maxOpenSessions`, default `4`.
3. Make already-open `session.open` idempotent.
4. Add `getSessionCatalog(workspaceId)` to `SessionCatalogRuntimeService`.
5. Preflight new runtime opens before catalog mutation when the cap is reached.
6. Preflight session creation before catalog mutation when the cap is reached.
7. Convert runtime `queue_update` events into typed `queue.updated` and `session.activityUpdated`.
8. Add `restoreQueuedMessages()` that:
   - requires an open runtime
   - delegates to the driver
   - returns restored text
   - does not publish a duplicate cleared queue after Pi runtime emits `queue_update`
9. Reuse `projectQueueSnapshot()` instead of duplicate queue mapping logic.

### Task 4: Add Renderer Queue, Activity, And Runtime Projections

**Files:**

- Modify: `packages/gui/src/renderer/app/app-store.ts`
- Create: `packages/gui/src/renderer/app/session-state-projections.ts`
- Test: `packages/gui/test/renderer/app-store.test.ts`

**Steps:**

1. Add session-keyed state:
   - `queuesBySessionKey`
   - `runtimeOverlaysBySessionKey`
   - `activityBySessionKey`
2. Add `SessionRuntimeOverlay` with:
   - `status`
   - `isOpen`
3. Extract pure projection helpers into `session-state-projections.ts`.
4. Merge catalog updates with runtime overlays.
5. Mark non-selected runtime events unread.
6. Clear unread on session selection.
7. Store queue updates by exact session key.
8. Restore all queued text into the matching composer draft.
9. Preserve pending extension `needsInput` when main activity updates arrive.
10. Remove closed-session queue, overlay, activity, transcript, model/thinking, and extension UI projections.
11. Keep `app-store.ts` below the 1k-line maintainability threshold.

### Task 5: Add Minimal Queue And Activity UI

**Files:**

- Modify: `packages/gui/src/renderer/app/App.tsx`
- Modify: `packages/gui/src/renderer/app/app-panels.tsx`
- Modify: `packages/gui/src/renderer/app/catalog-view.tsx`
- Modify: `packages/gui/src/renderer/styles/app.css`
- Test: `packages/gui/test/renderer/app-panels.test.tsx`
- Test: `packages/gui/test/renderer/catalog-view.test.tsx`

**Steps:**

1. Add selected-session `QueuePanel`.
2. Show:
   - total pending count
   - steering group
   - follow-up group
   - delivery modes
3. Add `Restore to composer`.
4. Add sidebar badges:
   - `Unread`
   - `Input`
   - queued count
5. Add sidebar cancel for running/cancelling sessions.
6. Add sidebar close only for open runtime sessions.
7. Keep row-body click as the only select/open interaction.
8. Keep styling compact and consistent with the existing Pi GUI.

### Task 6: Verify And Review

**Files:**

- Test all modified GUI package files.
- Keep generated test artifacts out of the worktree.

**Commands:**

```bash
git diff --cached --check
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/catalog-view.test.tsx
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-panels.test.tsx
npm --prefix packages/gui run check
npm --prefix packages/gui run test:coverage
npm --prefix packages/gui run test:electron
npm run check
```

Expected:

- Focused tests pass.
- GUI package check passes.
- Coverage passes configured thresholds.
- Root check passes.
- Electron E2E either passes or records an environment launch failure separately from source assertions.

## Implemented Changes

### Contracts

Added queue and activity snapshots:

- `QueueMode`
- `QueueMessageKind`
- `QueueMessageSnapshot`
- `QueueSnapshot`
- `QueueRestoreSnapshot`
- `SessionActivitySnapshot`

Extended events:

- `queue.updated` now carries full queue messages, counts, modes, and the complete queue snapshot.
- `session.activityUpdated` carries queue/activity projection data.

Added command:

- `session.restoreQueuedMessages`

Added typed errors:

- `SessionOpenLimitReached`
- `SessionRuntimeNotOpen`
- `SessionQueueRestoreFailed`

### Main Runtime Layer

Updated `SessionSupervisor`:

- `session.open` returns successfully when the runtime is already open.
- Already-open selection still refreshes catalog selection.
- New runtime opens are rejected after the configured open-session cap.
- Runtime cap rejection happens before catalog mutation for new opens and new session creation.
- Runtime records track queue snapshots and last queue activity sequence.
- `queue_update` runtime events publish full `queue.updated` payloads.
- `queue_update` runtime events also publish `session.activityUpdated`.
- `restoreQueuedMessages()` delegates to the driver and returns restored message text.
- Queue restore no longer double-publishes a cleared queue event from the supervisor.
- Queue projection reuses `projectQueueSnapshot()`.

Updated session drivers:

- `SessionDriver` now exposes `getQueue()` and `restoreQueuedMessages()`.
- `PiSdkSessionDriver` projects queue state from Pi runtime APIs:
  - `getSteeringMessages()`
  - `getFollowUpMessages()`
  - `clearQueue()`
  - `steeringMode`
  - `followUpMode`
- `FakeSessionDriver` stores steering/follow-up queues, emits deterministic queue updates, and supports restore-all.

### Renderer Store

Added session-keyed state:

- `queuesBySessionKey`
- `runtimeOverlaysBySessionKey`
- `activityBySessionKey`

Renderer behavior:

- Catalog updates merge with runtime overlays instead of replacing live status.
- Runtime events for non-selected sessions mark unread activity.
- Selecting a session clears its unread flag.
- Queue updates are scoped to the exact session key.
- Restore-all appends restored queue text to the matching composer draft.
- Extension UI requests mark needs-input for the owning session without selecting it.
- Main activity updates preserve pending renderer extension `needsInput` while requests remain pending.
- Closing a session removes queue, overlay, activity, transcript, model/thinking, and extension UI projections for that session.
- Projection logic moved into `session-state-projections.ts`.
- `app-store.ts` is 880 lines after extraction.

### UI

Added selected-session queue panel:

- Shows steering/follow-up groups.
- Shows delivery modes.
- Shows total pending count.
- Restores queued messages into the composer.

Updated session sidebar:

- Shows compact `Unread`, `Input`, and queued-count badges.
- Adds row-level cancel for running/cancelling sessions.
- Adds row-level close for open runtime sessions only.
- Row actions do not select the session.

## Test Plan

Focused tests added or updated:

- `packages/gui/test/main/session/session-supervisor.test.ts`
  - idempotent open
  - runtime open cap
  - cap rejection before catalog mutation
  - rich queue update events
  - restore queued messages without duplicate supervisor publication
- `packages/gui/test/renderer/app-store.test.ts`
  - session-scoped queue state
  - unread clearing on selection
  - restore-to-composer
  - catalog sync preserving runtime overlays
  - background extension needs-input
  - main activity update preserving pending extension needs-input
- `packages/gui/test/renderer/app-panels.test.tsx`
  - queue panel render and restore action
- `packages/gui/test/renderer/catalog-view.test.tsx`
  - sidebar activity badges
  - per-session cancel/close actions
  - no close action for catalog-only idle sessions
- `packages/gui/test/main/ipc-router.test.ts`
  - restore command routing
- `packages/gui/test/main/session/fake-session-driver.test.ts`
  - fake queue store and restore behavior
- `packages/gui/test/main/session/pi-sdk-session-driver.test.ts`
  - driver type compatibility for queue APIs

## Final Report

Phase 8 implements the runtime, contract, renderer, and UI foundations for Pi-native background sessions and queues.

Completed acceptance criteria:

- A session can remain open and running while another session is selected.
- Opening an already-open session is idempotent.
- Background events are keyed by `workspaceId:sessionId`.
- Sidebar shows runtime activity through compact badges and row actions.
- Queue updates carry full steering/follow-up queue state.
- Restore-all queued messages appends restored text into the matching composer draft.
- Background extension UI requests mark needs-input without switching selected session.
- Closing/cancelling actions are row scoped.
- Catalog sync does not erase runtime overlays.
- Runtime open cap rejects new opens before catalog mutation.
- Queue restore avoids duplicate queue publications.
- Renderer store projection helpers keep `app-store.ts` below 1k lines.

Verification completed:

```bash
git diff --cached --check
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/catalog-view.test.tsx
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-panels.test.tsx
npm --prefix packages/gui run check
npm --prefix packages/gui run test:coverage
npm run check
```

All commands above passed.

Electron E2E status:

```bash
npm --prefix packages/gui run test:electron
```

Result:

- Electron build succeeded.
- Playwright Electron launch failed before assertions with `Process failed to launch!`.
- This matches the existing local Electron launch failure pattern observed during Phase 8 verification.
- No source assertion failure was observed from Electron E2E.

## Known Deferred Items

- Add deterministic Electron E2E for a two-session background run once the local Electron launch issue is resolved.
- Targeted queue item remove/replace remains deferred until Pi exposes stable per-item queue APIs.
- Persist unread/activity state across app restart.
- Add OS notifications for background completion or needs-input events.
- Add full TUI parity commands:
  - `/tree`
  - `/resume`
  - `/compact`
  - `/share`
- Add richer session search/filtering after the sidebar runtime model stabilizes.

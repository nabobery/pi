# Pi Native GUI Phase 11 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Pi-native GUI Control Plane for `/trust`, focused `/settings`, and resource visibility while preserving Pi-owned runtime truth and typed Electron boundaries.

**Architecture:** Electron main remains the only process that talks to Pi managers, project trust storage, runtime sessions, and resource loaders. The renderer receives Effect Schema validated snapshots and sends typed commands by stable IDs rather than paths or arbitrary settings documents. Resource reloads use the existing Pi SDK session reload path and are blocked when runtime state is busy.

**Tech Stack:** Electron, Effect Schema, TypeScript, React, `useSyncExternalStore`, Vitest, happy-dom, Playwright Electron, oxlint, oxfmt, Pi coding-agent runtime.

---

## Phase 11 Scope

Phase 11 is the **P0/P1 Trust, Settings, And Resource Control Plane** phase for `packages/gui`.

In scope:

- Add a compact desktop Control Plane surface opened by `/trust`, `/settings`, sidebar actions, and command palette actions.
- Add three Control Plane tabs:
  - `Trust`
  - `Settings`
  - `Resources`
- Keep trust, settings, and resource truth in Pi-owned main-process services.
- Add typed Effect Schema contracts for trust decisions, settings editor snapshots, settings updates, resource inventory, resource reload, and resource source actions.
- Persist trust decisions through `ProjectTrustStore` using option IDs resolved in Electron main.
- Keep the renderer from sending arbitrary trust paths or settings file paths.
- Add focused common settings editing with global writes only.
- Show effective setting values and their sources.
- Add resource inventory for skills, extensions, extension load errors, diagnostics, source path metadata, source scope, and origin.
- Reload resources through Pi runtime sessions using `AgentSession.reload()`.
- Block resource reload while sessions are streaming, compacting, navigating, or otherwise runtime-busy.
- Publish refreshed trust, settings, and resource snapshots after trust/settings/resource actions.
- Add source open/reveal actions for main-computed known source paths only.
- Preserve `useSyncExternalStore` renderer state management.
- Extract Control Plane state/actions out of `app-store.ts`.
- Rename phase-named renderer store code to product-facing names.
- Fix Phase 10 entry blockers:
  - manual compaction cancellation must not emit both `compaction.cancelled` and `compaction.failed`
  - tree navigation must expose pending/cancelling state and make Escape/Cancel call `session.cancelTreeNavigation`
- Fix review findings:
  - compare settings saves against the initial user draft rather than global values
  - report trust persistence separately from resource reload failure
  - restore cancellation state when cancel driver calls fail
  - reject invalid empty setting strings through Effect Schema
  - avoid stale renderer state writes after async Control Plane commands

Out of scope:

- Per-skill enable/disable.
- Per-extension enable/disable.
- Installing or removing packages, extensions, or skills.
- Editing project-local common settings through the GUI.
- Prompt manager GUI.
- Theme manager GUI.
- Rich extension custom components beyond the existing GUI primitives.
- Sharing/export enhancements.
- Node WebSocket server or typed React client/server boundary.
- Separate GUI registry for skills, extensions, models, or settings.

## Current Baseline

Before Phase 11:

- The GUI had session, prompt, slash command, resume, tree, and compaction flows.
- Electron main owned active runtime sessions through `SessionSupervisor`.
- `PiSdkSessionDriver` adapted real Pi SDK runtime sessions.
- `FakeSessionDriver` powered deterministic GUI tests.
- The renderer used `useSyncExternalStore` over immutable snapshots.
- Settings summary existed, but the GUI did not expose a focused settings editor.
- Trust status existed, but `/trust` did not provide a desktop trust decision workflow.
- Resource loading remained runtime-owned, but the GUI did not expose inventory, diagnostics, source metadata, or reload.
- Tree and compaction cancellation had edge cases around cancellation failures and duplicate terminal events.
- `app-store.ts` needed another focused extraction before adding the Control Plane surface.

Phase 11 builds on the existing Pi-native desktop architecture:

- Runtime services and manager APIs stay in Electron main.
- IPC remains explicit, typed, and Effect Schema validated.
- Renderer state remains a projection and never becomes the source of truth.
- Slash commands can open GUI-native surfaces without sending slash text through the runtime prompt path.
- The desktop GUI remains minimal: dense controls, direct actions, and no marketplace or dashboard expansion.

## Implemented Changes

### Control Plane Contracts

- Extended trust snapshots with stable trust option IDs.
- Added `TrustSaveDecision` command payload using `{ workspaceId, optionId }`.
- Added trust errors for invalid decisions and persistence failures.
- Added settings editor snapshot contracts for fields, values, sources, and editable metadata.
- Added `SettingsGetEditorSnapshot` and `SettingsUpdateCommon` commands.
- Added settings errors for read failures, invalid updates, and write failures.
- Added resource inventory contracts for skills, extensions, diagnostics, source metadata, and extension load errors.
- Added `ResourcesGetInventory`, `ResourcesReload`, `ResourcesOpenSource`, and `ResourcesRevealSource` commands.
- Added resource errors for inventory read, reload failure, unavailable source, and source open failure.
- Tightened Effect Schema validation for non-empty trust option IDs, provider/model strings, enabled model IDs, and resource IDs.
- Added round-trip and invalid-decode contract coverage.

### Electron Main Services

- Added `SettingsBridgeService.getEditorSnapshot(workspaceId)`.
- Added `SettingsBridgeService.updateCommonSettings(workspaceId, patch)`.
- Routed settings writes through `SettingsManager` setters.
- Called `flush()` after settings writes and surfaced drained write errors.
- Published refreshed `settings.summaryUpdated` and `settings.editorUpdated` events.
- Kept the GUI from hand-writing JSON settings files.
- Added `ResourceBridgeService` for inventory, reload, source open, and source reveal actions.
- Added resource inventory projection from Pi resource loader state.
- Extended runtime/session interfaces so the GUI can call SDK-backed resource reload.
- Added reload blocking when runtime state is busy.
- Published resource inventory updates and resource reload errors as typed GUI events.
- Updated trust save flow so Electron main resolves the current trust option ID and persists only its main-owned update set.
- Refreshed trust, settings, and resources after trust save.
- Made resource reload after trust save best-effort, so successful trust persistence is not reported as failed after mutation.

### Runtime And Cancellation Safety

- Added driver/supervisor reload support that calls the Pi SDK session reload path.
- Preserved runtime-busy boundaries for streaming, compaction, and tree navigation.
- Restored prior compaction state if `cancelCompaction` driver calls fail.
- Restored prior tree navigation state if `cancelTreeNavigation` driver calls fail.
- Prevented failed cancel calls from marking later runtime failures as user cancellation.
- Preserved Phase 10 invariants so manual compaction cancellation does not emit both cancelled and failed.
- Ensured tree Escape/Cancel paths call the runtime cancellation method.

### Renderer Control Plane

- Added `ControlPlaneDialog` with `Trust`, `Settings`, and `Resources` tabs.
- Added `/trust` command behavior that opens Control Plane on the Trust tab.
- Added `/settings` command behavior that opens Control Plane on the Settings tab.
- Added command palette and sidebar entry points for the Control Plane.
- Added Trust tab state for loading, saving, errors, refreshed status, and available trust options.
- Added Settings tab state for editor snapshot, effective values, source labels, dirty detection, save state, and errors.
- Built settings patches by comparing the user draft against the initial loaded draft.
- Avoided sending unchanged project-sourced effective settings as global writes.
- Added Resources tab state for inventory, reload progress, diagnostics, extension load errors, source open, and source reveal.
- Kept resource open/reveal commands ID-based rather than path-based.
- Extracted Control Plane state/actions/event appliers into `control-plane-store.ts`.
- Renamed `phase9-store.ts` to `command-palette-store.ts`.
- Kept `app-store.ts` below the maintainability threshold.
- Used `updateState`/`getState` style updates after async calls to avoid overwriting concurrent events with stale captured snapshots.

### Tests And Verification

- Added contract tests for invalid trust IDs, invalid settings patches, invalid resource IDs, and snapshot round-trips.
- Added IPC tests for trust save behavior when resource reload is blocked.
- Added main service tests for settings writes, resource inventory, resource reload, and source metadata.
- Added session supervisor tests for reload blocking, reload success, and cancellation failure restoration.
- Added renderer tests for `/trust`, `/settings`, settings dirty/save behavior, resource reload updates, source actions, and concurrent event preservation.
- Verified package-local GUI checks.
- Verified root checks.

## Implementation Plan

### Task 1: Fix Phase 10 Entry Blockers

**Files:**

- Modify: `packages/gui/src/main/session/session-supervisor.ts`
- Modify: `packages/gui/src/main/session/session-driver.ts`
- Modify: `packages/gui/src/main/session/runtime-supervisor.ts`
- Modify: `packages/gui/src/renderer/app/tree-and-compaction-store.ts`
- Modify: `packages/gui/src/renderer/app/tree-navigator.tsx`
- Test: `packages/gui/test/main/session/session-supervisor.test.ts`
- Test: `packages/gui/test/renderer/tree-navigator.test.tsx`

**Step 1: Write failing compaction cancellation test**

Add a test where `driver.cancelCompaction()` rejects after compaction has entered a cancelling state.

Expected assertions:

- `compaction.cancelled` is not emitted.
- The previous compaction status is restored.
- The thrown error is typed as a GUI cancellation failure.

**Step 2: Write failing tree cancellation test**

Add a test where tree navigation is active and `driver.cancelTreeNavigation()` rejects.

Expected assertions:

- The previous tree navigation status is restored.
- The cancellation failure is surfaced as a typed GUI error.
- A later runtime failure is not treated as user cancellation.

**Step 3: Run focused tests to verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts test/renderer/tree-navigator.test.tsx
```

Expected:

- New tests fail because cancel failure state restoration is missing or incomplete.

**Step 4: Implement cancellation state restoration**

In `SessionSupervisor`:

- Capture previous compaction state before setting cancelling flags.
- Wrap driver cancel calls in `try/catch`.
- Restore previous state on driver failure.
- Throw the existing typed GUI cancel error.
- Do not emit `compaction.cancelled` on failure.
- Do not record failed cancel as user cancellation.

Repeat the same pattern for tree navigation cancellation.

**Step 5: Wire renderer Escape/Cancel to runtime cancellation**

In tree navigator and store code:

- Expose pending/cancelling state.
- Disable duplicate cancel actions while cancellation is already in progress.
- Ensure Escape invokes `session.cancelTreeNavigation`.
- Ensure Cancel invokes `session.cancelTreeNavigation`.

**Step 6: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts test/renderer/tree-navigator.test.tsx
```

Expected:

- Session supervisor and tree navigator tests pass.

**Step 7: Commit**

```bash
git add packages/gui/src/main/session packages/gui/src/renderer/app/tree-and-compaction-store.ts packages/gui/src/renderer/app/tree-navigator.tsx packages/gui/test/main/session/session-supervisor.test.ts packages/gui/test/renderer/tree-navigator.test.tsx
git commit -m "fix: preserve GUI cancellation state on failed cancel"
```

### Task 2: Add Control Plane Contracts

**Files:**

- Modify: `packages/gui/src/contracts/commands.ts`
- Modify: `packages/gui/src/contracts/errors.ts`
- Modify: `packages/gui/src/contracts/events.ts`
- Modify: `packages/gui/src/contracts/snapshots.ts`
- Test: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Write failing trust contract tests**

Cover:

- `TrustOptionSnapshot` includes a stable `id`.
- `TrustSaveDecision` accepts `{ workspaceId, optionId }`.
- Empty or whitespace-only `optionId` is rejected.
- Trust errors decode and encode.

**Step 2: Write failing settings contract tests**

Cover:

- `SettingsGetEditorSnapshot`.
- `SettingsUpdateCommon`.
- `SettingsEditorSnapshot`.
- `SettingsFieldSnapshot`.
- `SettingsSource`.
- Empty `defaultProvider` is rejected.
- Empty `defaultModel` is rejected.
- Empty enabled model IDs are rejected.
- Valid empty arrays are accepted where they intentionally clear a setting.

**Step 3: Write failing resource contract tests**

Cover:

- `ResourcesGetInventory`.
- `ResourcesReload`.
- `ResourcesOpenSource`.
- `ResourcesRevealSource`.
- `ResourceInventorySnapshot`.
- `SkillResourceSnapshot`.
- `ExtensionResourceSnapshot`.
- `ResourceDiagnosticSnapshot`.
- Empty or whitespace-only resource IDs are rejected.

**Step 4: Run contract tests to verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected:

- New tests fail because commands, snapshots, events, and errors are not defined.

**Step 5: Implement snapshot contracts**

Add typed snapshots for:

- trust option IDs
- settings editor fields
- settings sources
- resource skills
- resource extensions
- resource diagnostics
- inventory metadata

Use `Schema.NonEmptyTrimmedString` for stable IDs and string fields that cannot validly be empty.

**Step 6: Implement command contracts**

Add commands:

- `TrustSaveDecision`
- `SettingsGetEditorSnapshot`
- `SettingsUpdateCommon`
- `ResourcesGetInventory`
- `ResourcesReload`
- `ResourcesOpenSource`
- `ResourcesRevealSource`

Include each command in the `GuiCommand` union.

**Step 7: Implement error and event contracts**

Add errors:

- `TrustDecisionInvalid`
- `TrustDecisionSaveFailed`
- `SettingsEditorReadFailed`
- `SettingsUpdateInvalid`
- `SettingsUpdateFailed`
- `ResourceInventoryReadFailed`
- `ResourceReloadFailed`
- `ResourceSourceUnavailable`
- `ResourceSourceOpenFailed`

Add events:

- trust status refresh events as needed by existing trust flow
- `settings.editorUpdated`
- resource inventory/reload events
- resource reload error events

**Step 8: Run contract tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected:

- Contract tests pass.

**Step 9: Commit**

```bash
git add packages/gui/src/contracts packages/gui/test/contracts/contracts.test.ts
git commit -m "feat: add GUI control plane contracts"
```

### Task 3: Add Settings Bridge Editor Flow

**Files:**

- Modify: `packages/gui/src/main/settings/settings-bridge-service.ts`
- Modify: `packages/gui/src/main/ipc-router.ts`
- Test: `packages/gui/test/main/settings/settings-bridge-service.test.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write failing settings editor snapshot tests**

Cover:

- `getEditorSnapshot(workspaceId)` returns the focused editable fields.
- Each field includes effective value.
- Each field includes source as `default`, `global`, or `project`.
- Missing project overrides still produce useful default/global values.

**Step 2: Write failing settings update tests**

Cover:

- `updateCommonSettings(workspaceId, patch)` calls `SettingsManager` setters.
- `flush()` is called after writes.
- `drainErrors()` failures are returned as typed settings update failures.
- Empty provider/model patches are rejected before setters run.
- Phase 11 writes common settings globally only.

**Step 3: Run focused tests to verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/settings/settings-bridge-service.test.ts test/main/ipc-router.test.ts
```

Expected:

- New tests fail because editor snapshot/update routing is missing.

**Step 4: Implement editor snapshot projection**

In `SettingsBridgeService`:

- Read current effective settings through existing settings manager APIs.
- Build one row per focused editable field.
- Include source metadata for each row.
- Include current global value where available.
- Avoid exposing raw settings file documents to the renderer.

Focused fields:

- `defaultProvider`
- `defaultModel`
- `defaultThinkingLevel`
- `enabledModels`
- `enableSkillCommands`
- `steeringMode`
- `followUpMode`
- `defaultProjectTrust`
- `compaction.enabled`
- `images.autoResize`
- `images.blockImages`

**Step 5: Implement common settings update**

In `SettingsBridgeService`:

- Validate the patch through Effect Schema.
- Call only supported `SettingsManager` setters.
- Call `flush()`.
- Inspect `drainErrors()`.
- Return typed errors on invalid input or failed persistence.
- Publish refreshed settings summary and editor snapshot from the IPC router.

**Step 6: Register IPC handlers**

In `ipc-router.ts`:

- Register `SettingsGetEditorSnapshot`.
- Register `SettingsUpdateCommon`.
- Validate sender frame.
- Decode payloads and encode results through Effect Schema.
- Publish `settings.summaryUpdated` and `settings.editorUpdated` after successful updates.

**Step 7: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/settings/settings-bridge-service.test.ts test/main/ipc-router.test.ts
```

Expected:

- Settings bridge and IPC tests pass.

**Step 8: Commit**

```bash
git add packages/gui/src/main/settings/settings-bridge-service.ts packages/gui/src/main/ipc-router.ts packages/gui/test/main/settings/settings-bridge-service.test.ts packages/gui/test/main/ipc-router.test.ts
git commit -m "feat: add GUI settings editor bridge"
```

### Task 4: Add Trust Save Flow

**Files:**

- Modify: `packages/gui/src/main/ipc-router.ts`
- Modify: `packages/gui/src/main/settings/settings-bridge-service.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write failing trust save tests**

Cover:

- Renderer sends `workspaceId` and `optionId`, not a path.
- Main resolves the current option from `getProjectTrustOptions(cwd)`.
- Unknown option IDs fail with `TrustDecisionInvalid`.
- Valid option IDs persist through `ProjectTrustStore.setMany(option.updates)`.
- Trust save publishes refreshed trust status.
- Trust save publishes refreshed settings summary.
- Trust save publishes refreshed settings editor snapshot.
- Trust save triggers runtime resource reload when a session is open.

**Step 2: Write failing trust-save reload-blocked test**

Cover:

- Trust persistence succeeds.
- Resource reload is blocked because runtime is busy.
- The command still returns trust-save success.
- A typed resource reload error is published separately.

**Step 3: Run IPC tests to verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
```

Expected:

- New trust save tests fail because option-ID trust persistence and separated reload errors are missing.

**Step 4: Implement trust option resolution**

In the trust save handler:

- Resolve `workspaceId` to the current workspace path in main.
- Call `getProjectTrustOptions(cwd)`.
- Generate or read stable option IDs from the current trust options.
- Match the requested `optionId`.
- Reject unknown IDs with `TrustDecisionInvalid`.
- Call `ProjectTrustStore.setMany(option.updates)`.

**Step 5: Refresh snapshots after persistence**

After trust save:

- Refresh trust status.
- Refresh settings summary.
- Refresh settings editor snapshot.
- Publish the refreshed events even if resource reload later fails.

**Step 6: Trigger best-effort resource reload**

If a runtime session is open for the workspace:

- Call supervisor resource reload.
- If reload succeeds, publish resource inventory.
- If reload is blocked or fails, publish a typed `ResourceReloadFailed` application error.
- Do not change the trust save command result after trust has already persisted.

**Step 7: Run IPC tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
```

Expected:

- Trust save tests pass.

**Step 8: Commit**

```bash
git add packages/gui/src/main/ipc-router.ts packages/gui/src/main/settings/settings-bridge-service.ts packages/gui/test/main/ipc-router.test.ts
git commit -m "feat: add GUI trust decision persistence"
```

### Task 5: Add Resource Bridge And Inventory Projection

**Files:**

- Create: `packages/gui/src/main/resources/resource-bridge-service.ts`
- Create: `packages/gui/src/main/session/resource-inventory-projection.ts`
- Modify: `packages/gui/src/main/session/session-driver.ts`
- Modify: `packages/gui/src/main/session/pi-sdk-session-driver.ts`
- Modify: `packages/gui/src/main/session/runtime-supervisor.ts`
- Modify: `packages/gui/src/main/session/session-supervisor.ts`
- Modify: `packages/gui/src/main/ipc-router.ts`
- Test: `packages/gui/test/main/resources/resource-bridge-service.test.ts`
- Test: `packages/gui/test/main/session/session-supervisor.test.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write failing resource inventory tests**

Cover:

- Skills are included with ID, name, source path, source scope, and origin.
- Extensions are included with ID, name, source path, source scope, and origin.
- Extension load errors are included inline.
- Resource diagnostics are included.
- Resource source paths remain main-owned metadata.

**Step 2: Write failing resource reload tests**

Cover:

- Reload calls Pi session `reload()`.
- Reload is blocked while streaming.
- Reload is blocked while compacting.
- Reload is blocked while tree navigation is active.
- Reload returns typed `ResourceReloadFailed` on blocked or failed reload.
- Successful reload publishes updated inventory.

**Step 3: Write failing source action tests**

Cover:

- `ResourcesOpenSource` accepts resource IDs only.
- `ResourcesRevealSource` accepts resource IDs only.
- Unknown resource IDs fail with `ResourceSourceUnavailable`.
- Source actions use only paths from the computed main-process inventory.

**Step 4: Run focused tests to verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/resources/resource-bridge-service.test.ts test/main/session/session-supervisor.test.ts test/main/ipc-router.test.ts
```

Expected:

- New tests fail because resource bridge and reload support are missing.

**Step 5: Add inventory projection**

In `resource-inventory-projection.ts`:

- Project `resourceLoader.getSkills()` into `SkillResourceSnapshot[]`.
- Project `resourceLoader.getExtensions()` into `ExtensionResourceSnapshot[]`.
- Include extension load errors.
- Include diagnostics.
- Include stable IDs.
- Preserve source path, source scope, and origin metadata.
- Avoid exposing mutable runtime objects.

**Step 6: Add resource bridge service**

In `resource-bridge-service.ts`:

- Implement `getInventory(workspaceId)`.
- Implement `reload(workspaceId)`.
- Implement `openSource(workspaceId, resourceId)`.
- Implement `revealSource(workspaceId, resourceId)`.
- Resolve source actions against the current main-owned inventory.
- Fail closed for unknown IDs and unavailable paths.

**Step 7: Extend session runtime interfaces**

In session driver and supervisor types:

- Add `reloadSessionResources(sessionKey)` or equivalent workspace reload method.
- Add runtime access to the Pi SDK session reload path.
- Add access to `services.resourceLoader` after reload.

**Step 8: Implement SDK reload**

In `PiSdkSessionDriver`:

- Call `AgentSession.reload()`.
- Return projected inventory from the reloaded runtime services.
- Preserve existing runtime lifecycle ownership.

**Step 9: Block reload during busy runtime states**

In `SessionSupervisor`:

- Reject reload while streaming.
- Reject reload while compacting.
- Reject reload while tree navigation is active.
- Return typed reload errors instead of racing runtime state.

**Step 10: Register IPC handlers**

In `ipc-router.ts`:

- Register resource inventory, reload, open source, and reveal source handlers.
- Validate sender frame.
- Decode commands and encode results through Effect Schema.
- Publish resource inventory updates after successful reload.
- Publish typed app errors after failed reload.

**Step 11: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/resources/resource-bridge-service.test.ts test/main/session/session-supervisor.test.ts test/main/ipc-router.test.ts
```

Expected:

- Resource bridge, supervisor, and IPC tests pass.

**Step 12: Commit**

```bash
git add packages/gui/src/main/resources/resource-bridge-service.ts packages/gui/src/main/session packages/gui/src/main/ipc-router.ts packages/gui/test/main/resources/resource-bridge-service.test.ts packages/gui/test/main/session/session-supervisor.test.ts packages/gui/test/main/ipc-router.test.ts
git commit -m "feat: add GUI resource inventory and reload"
```

### Task 6: Add Renderer Control Plane Store

**Files:**

- Create: `packages/gui/src/renderer/app/control-plane-store.ts`
- Rename: `packages/gui/src/renderer/app/phase9-store.ts` to `packages/gui/src/renderer/app/command-palette-store.ts`
- Modify: `packages/gui/src/renderer/app/app-store.ts`
- Modify: `packages/gui/src/renderer/app/app-result-appliers.ts`
- Modify: `packages/gui/src/renderer/app/app-panels.tsx`
- Test: `packages/gui/test/renderer/app-store.test.ts`
- Test: `packages/gui/test/renderer/app-panels.test.tsx`
- Test: `packages/gui/test/renderer/command-palette.test.tsx`

**Step 1: Write failing store tests**

Cover:

- Opening Control Plane loads trust status, settings editor snapshot, and resource inventory.
- Opening Control Plane on Trust tab preserves concurrent events received during async loads.
- Opening Control Plane on Settings tab preserves concurrent events received during async loads.
- Resource reload state updates without replacing unrelated app state.
- Source open/reveal commands send resource IDs, not paths.

**Step 2: Run renderer store tests to verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts test/renderer/app-panels.test.tsx test/renderer/command-palette.test.tsx
```

Expected:

- New tests fail because Control Plane store state/actions do not exist.

**Step 3: Extract Control Plane state**

Create `control-plane-store.ts` with:

- snapshot shape
- initial state
- action builders
- event appliers
- async command helpers
- reload state helpers
- error state helpers

Use `getState()` after awaits before applying updates, so async loads cannot overwrite concurrent event updates.

**Step 4: Rename phase-named store module**

Rename:

- `phase9-store.ts` to `command-palette-store.ts`

Update all imports and tests. Keep product-facing source names only.

**Step 5: Wire app-store composition**

In `app-store.ts`:

- Import Control Plane store helpers.
- Expose Control Plane state and actions.
- Keep the file under 1000 lines.
- Preserve existing `useSyncExternalStore` subscription behavior.

**Step 6: Wire event appliers**

In `app-result-appliers.ts`:

- Apply `settings.editorUpdated`.
- Apply resource inventory updates.
- Apply resource reload errors.
- Preserve existing session, tree, compaction, catalog, and command palette appliers.

**Step 7: Run renderer store tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts test/renderer/app-panels.test.tsx test/renderer/command-palette.test.tsx
```

Expected:

- Renderer store tests pass.

**Step 8: Check app-store line count**

Run:

```bash
wc -l packages/gui/src/renderer/app/app-store.ts packages/gui/src/renderer/app/control-plane-store.ts packages/gui/src/renderer/app/command-palette-store.ts
```

Expected:

- `packages/gui/src/renderer/app/app-store.ts` is below 1000 lines.

**Step 9: Commit**

```bash
git add packages/gui/src/renderer/app/app-store.ts packages/gui/src/renderer/app/app-result-appliers.ts packages/gui/src/renderer/app/app-panels.tsx packages/gui/src/renderer/app/control-plane-store.ts packages/gui/src/renderer/app/command-palette-store.ts packages/gui/test/renderer/app-store.test.ts packages/gui/test/renderer/app-panels.test.tsx packages/gui/test/renderer/command-palette.test.tsx
git commit -m "feat: add GUI control plane store"
```

### Task 7: Add Control Plane Dialog

**Files:**

- Create: `packages/gui/src/renderer/app/control-plane.tsx`
- Modify: `packages/gui/src/renderer/app/App.tsx`
- Modify: `packages/gui/src/renderer/app/app-panels.tsx`
- Modify: `packages/gui/src/renderer/app/command-palette.tsx`
- Modify: `packages/gui/src/renderer/styles/app.css`
- Test: `packages/gui/test/renderer/control-plane.test.tsx`
- Test: `packages/gui/test/renderer/command-palette.test.tsx`
- Test: `packages/gui/test/renderer/catalog-view.test.tsx`

**Step 1: Write failing Trust tab tests**

Cover:

- `/trust` opens Control Plane on the Trust tab.
- The tab shows trust status, source, `requiresTrust`, saved path, and available options.
- Selecting and saving an option calls the store trust command with `optionId`.
- Save loading and error states render.
- Refreshed trust state renders after save.

**Step 2: Write failing Settings tab tests**

Cover:

- `/settings` opens Control Plane on the Settings tab.
- Each settings row shows effective value and source.
- No-op save is disabled.
- Editing a project-sourced effective setting and then reverting does not send a global patch.
- Save sends only fields changed by the user.
- Save error state renders.

**Step 3: Write failing Resources tab tests**

Cover:

- Skills render with source metadata and diagnostics.
- Extensions render with source metadata and diagnostics.
- Extension load errors render inline.
- Reload calls the store reload command.
- Open source calls the store command with a resource ID.
- Reveal source calls the store command with a resource ID.

**Step 4: Run renderer tests to verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/control-plane.test.tsx test/renderer/command-palette.test.tsx test/renderer/catalog-view.test.tsx
```

Expected:

- New tests fail because the Control Plane UI is missing.

**Step 5: Implement dialog shell**

In `control-plane.tsx`:

- Render a compact modal/dialog surface.
- Add tab controls for Trust, Settings, and Resources.
- Keep layout dense and tool-like.
- Avoid marketing copy, hero styling, nested cards, and decorative surfaces.

**Step 6: Implement Trust tab**

Render:

- current trust status
- trust source
- `requiresTrust`
- saved trust path
- available options
- Save action
- loading state
- error state

Send only `optionId` and `workspaceId` through the store command.

**Step 7: Implement Settings tab**

Render:

- one row per focused setting
- effective value
- source badge
- appropriate editor control:
  - select where known options exist
  - toggle for booleans
  - multi-select style control for enabled models
  - text fallback only where registry data is unavailable
- Save button
- dirty state
- saving state
- error state
- open global/project settings actions for advanced editing

Track:

- loaded `initialDraft`
- current `draft`
- patch computed from `draft` vs `initialDraft`

Do not compute patches against global values.

**Step 8: Implement Resources tab**

Render:

- Skills section
- Extensions section
- source scope
- origin
- diagnostics
- extension load errors
- Reload action
- Open Source action
- Reveal Source action

Do not implement install, remove, per-skill enable/disable, or per-extension enable/disable.

**Step 9: Wire command palette and sidebar actions**

Ensure:

- `/trust` opens Control Plane on Trust tab.
- `/settings` opens Control Plane on Settings tab.
- Sidebar Trust action opens Trust tab.
- Sidebar Settings action opens Settings tab.
- Sidebar Resources action opens Resources tab.
- Command palette actions use GUI actions rather than slash-text prompt execution.

**Step 10: Add styling**

In `app.css`:

- Add compact dialog layout.
- Add tab styles.
- Add dense settings rows.
- Add resource list styles.
- Preserve existing color system and spacing scale.
- Verify text does not overflow controls at common desktop widths.

**Step 11: Run renderer tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/control-plane.test.tsx test/renderer/command-palette.test.tsx test/renderer/catalog-view.test.tsx
```

Expected:

- Renderer Control Plane tests pass.

**Step 12: Commit**

```bash
git add packages/gui/src/renderer/app/control-plane.tsx packages/gui/src/renderer/app/App.tsx packages/gui/src/renderer/app/app-panels.tsx packages/gui/src/renderer/app/command-palette.tsx packages/gui/src/renderer/styles/app.css packages/gui/test/renderer/control-plane.test.tsx packages/gui/test/renderer/command-palette.test.tsx packages/gui/test/renderer/catalog-view.test.tsx
git commit -m "feat: add GUI control plane dialog"
```

### Task 8: Final Verification And Review Cleanup

**Files:**

- Review: `packages/gui/src/contracts/commands.ts`
- Review: `packages/gui/src/contracts/errors.ts`
- Review: `packages/gui/src/contracts/events.ts`
- Review: `packages/gui/src/contracts/snapshots.ts`
- Review: `packages/gui/src/main/ipc-router.ts`
- Review: `packages/gui/src/main/resources/resource-bridge-service.ts`
- Review: `packages/gui/src/main/session/session-supervisor.ts`
- Review: `packages/gui/src/main/settings/settings-bridge-service.ts`
- Review: `packages/gui/src/renderer/app/control-plane.tsx`
- Review: `packages/gui/src/renderer/app/control-plane-store.ts`
- Review: `packages/gui/src/renderer/app/app-store.ts`

**Step 1: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/control-plane.test.tsx test/renderer/app-store.test.ts
```

Expected:

- Control Plane renderer and store tests pass.

**Step 2: Run main-process focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts test/main/ipc-router.test.ts test/main/resources/resource-bridge-service.test.ts test/main/settings/settings-bridge-service.test.ts
```

Expected:

- Main service, IPC, reload, and cancellation tests pass.

**Step 3: Run contract tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected:

- Contract tests pass.

**Step 4: Run GUI package check**

Run:

```bash
npm --prefix packages/gui run check
```

Expected:

- `format:check` passes.
- `lint` passes.
- `typecheck` passes.
- GUI unit and Electron smoke checks pass.

**Step 5: Run root check**

Run:

```bash
npm run check
```

Expected:

- Root formatting, dependency, shrinkwrap, typecheck, and GUI checks pass.

**Step 6: Scan for internal phase leakage in source**

Run:

```bash
rg -n "phase|Phase|pi-native-gui|plan-and-report|P0|P1" packages/gui/src packages/gui/test packages/coding-agent/src/runtime.ts
```

Expected:

- No output from modified source or test files.
- Internal planning language remains only under `docs/plans`.

**Step 7: Review staged boundary**

Run:

```bash
git status --short --untracked-files=all
git diff --cached --name-status
git diff --cached --stat
```

Expected:

- Only intended implementation and test files are staged.
- Internal plan docs stay untracked unless explicitly requested.

**Step 8: Commit**

```bash
git add packages/coding-agent/src/runtime.ts packages/gui/src packages/gui/test
git commit -m "feat: add Pi GUI trust, settings, and resources control plane"
```

## Final Verification Results

The completed implementation was verified with:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/control-plane.test.tsx test/renderer/app-store.test.ts
```

Result:

- Passed.
- Covered Control Plane renderer behavior and async store update safety.

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts test/main/ipc-router.test.ts
```

Result:

- Passed.
- Covered cancellation failure restoration, reload blocking, and trust save reload behavior.

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Result:

- Passed.
- Covered Effect Schema command, snapshot, error, event, and invalid decode behavior.

```bash
npm --prefix packages/gui run check
```

Result:

- Passed.
- GUI formatting, linting, typechecking, tests, and Electron smoke checks completed successfully.

```bash
npm run check
```

Result:

- Passed.
- Root checks completed successfully, including GUI package checks.

## Review Notes

- No Node WebSocket boundary was introduced.
- No separate GUI registry was introduced.
- Renderer commands use stable IDs and typed patches, not arbitrary paths or raw settings documents.
- Trust persistence is main-owned and option-ID based.
- Settings writes are global-only for Phase 11.
- Project settings remain visible through source indicators and open/reveal actions.
- Resource reload is SDK-driven through Pi runtime sessions.
- Resource source actions are allowlisted through main-computed inventory metadata.
- The renderer store extraction keeps `app-store.ts` below the maintainability threshold.
- Phase/internal naming was removed from live GUI source and tests.
- `docs/plans` remains the only place for phase-oriented planning language.

## Deferred

Keep these for later phases:

- Per-skill enable/disable.
- Per-extension enable/disable.
- Skill or extension installation.
- Skill or extension removal.
- Project-local common settings editing.
- Prompt manager.
- Theme manager.
- Sharing/export enhancements.
- Rich extension custom components beyond existing GUI primitives.
- Packaging/signing updates for desktop distribution.


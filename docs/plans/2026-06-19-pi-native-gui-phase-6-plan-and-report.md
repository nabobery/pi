# Pi Native GUI Phase 6 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Pi-native runtime controls, settings/trust visibility, and the first desktop extension UI layer to `packages/gui`.

**Architecture:** Electron main remains the only process that owns Pi runtime objects and filesystem/shell access. The preload bridge exposes typed Effect Schema IPC commands only, while React consumes immutable renderer-store snapshots through `useSyncExternalStore`. Phase 6 stays SDK-first and does not add a Node WebSocket server.

**Tech Stack:** Electron IPC, Effect Schema, TypeScript, Pi coding-agent runtime APIs, React `useSyncExternalStore`, oxlint, oxfmt, Vitest.

---

## Phase 6 Scope

Phase 6 is the **Runtime Controls, Settings/Trust Visibility, Extension UI Layer** phase from `docs/plans/2026-06-18-pi-native-gui-implementation-phases.md`.

In scope:

- Add typed model and thinking-level runtime contracts.
- Add typed settings summary and trust status contracts.
- Add typed extension UI request, update, response, and compatibility contracts.
- Keep all new IPC payloads validated with Effect Schema.
- Extend the coding-agent runtime subpath with only the runtime types/helpers required by GUI main.
- Let Electron main compute and open/reveal only Pi-known settings paths.
- Surface display-only trust status and trust options.
- Add model and thinking selectors to the active session shell.
- Add a small settings/trust summary panel.
- Bind Pi extensions with a native GUI `ExtensionUIContext`.
- Support blocking extension UI methods:
  - `confirm`
  - `input`
  - `select`
  - `editor`
- Support non-blocking extension UI methods:
  - `notify`
  - `setStatus`
  - `setTitle`
  - `setEditorText`
  - `pasteToEditor`
  - `getEditorText`
- Publish compatibility issues for unsupported TUI-only extension APIs.
- Preserve session scoping with `workspaceId:sessionId` for runtime, transcript, model/thinking, composer draft, and extension UI state.
- Add focused tests for the new service boundaries and renderer store reducers.

Out of scope:

- Full settings editor.
- Saving trust decisions from GUI.
- Full `/trust` parity.
- Slash command palette.
- `/tree`, `/resume`, `/compact`, `/share`.
- Custom extension component rendering.
- Extension autocomplete providers.
- Theme mutation support.
- Background sessions.
- WebSocket server or browser/server runtime boundary.
- Real-provider tests or paid-token validation.

## Implemented Changes

### Coding-Agent Runtime Export

Modified `packages/coding-agent/src/runtime.ts`.

- Re-exported runtime service types used by GUI main:
  - `AgentSessionServices`
  - `ExtensionUIContext`
  - `ExtensionUIDialogOptions`
  - `WorkingIndicatorOptions`
  - `AuthStorage`
  - `ModelRegistry`
  - `SettingsManager`
  - `ProjectTrustStore`
  - `getProjectTrustOptions`
  - `hasTrustRequiringProjectResources`
- Re-exported Pi AI model helpers needed by model snapshots:
  - `Api`
  - `Model`
  - `getSupportedThinkingLevels`

Reason:

- `packages/gui` can depend on the public `@earendil-works/pi-coding-agent/runtime` subpath.
- GUI main avoids deep imports into coding-agent internals.
- Renderer and preload remain forbidden from importing the coding-agent runtime package.

### GUI Contract Surface

Modified `packages/gui/src/contracts/**`.

- Added `ThinkingLevel`.
- Added `ModelOptionSnapshot`.
- Expanded `ModelThinkingSnapshot` with:
  - `workspaceId`
  - `sessionId`
  - selected provider/model/name
  - selected thinking level
  - available thinking levels
  - selectable model list
- Added `SettingsSummarySnapshot`.
- Added `TrustStatusSnapshot`.
- Added `ExtensionUiRequestSnapshot`.
- Added `ExtensionUiStateSnapshot`.
- Added command schemas:
  - `session.setModel`
  - `session.setThinkingLevel`
  - `extensionUi.respond`
  - `extensionUi.updateEditorText`
  - `settings.getSummary`
  - `settings.openGlobalFile`
  - `settings.revealGlobalFile`
  - `settings.openProjectFile`
  - `settings.revealProjectFile`
  - `trust.getStatus`
- Added event schemas:
  - `modelThinking.updated`
  - `settings.summaryUpdated`
  - `trust.statusUpdated`
  - `extensionUi.requested`
  - `extensionUi.resolved`
  - `extensionUi.updated`
  - `extensionUi.compatibilityIssue`
- Added typed errors:
  - `SessionModelNotFound`
  - `SessionModelAuthUnavailable`
  - `SessionModelSetFailed`
  - `SessionThinkingSetFailed`
  - `SettingsSummaryReadFailed`
  - `SettingsFileUnavailable`
  - `SettingsFileOpenFailed`
  - `TrustStatusReadFailed`
  - `ExtensionUiRequestNotFound`
  - `ExtensionUiSessionMismatch`
  - `ExtensionUiResponseInvalid`
  - `ExtensionUiRequestCancelled`

Important contract decisions:

- `session.setModel` and `session.setThinkingLevel` return `ModelThinkingSnapshot`.
- `TrustStatusSnapshot.options.updates` preserves `decision: true | false | null`.
- `extensionUi.respond` is session-scoped with `workspaceId`, `sessionId`, and `extensionUiRequestId`.
- `extensionUi.updateEditorText` mirrors renderer composer state into main so `ExtensionUIContext.getEditorText()` can stay synchronous, matching the Pi runtime API.

### Main Runtime Driver And Supervisor

Modified `packages/gui/src/main/session/session-driver.ts`.

- Extended `SessionDriver` with:
  - `getModelThinking(handle)`
  - `setModel(handle, provider, modelId)`
  - `setThinkingLevel(handle, level)`

Modified `packages/gui/src/main/session/runtime-supervisor.ts`.

- Extended `RuntimeAgentSession` with:
  - `model`
  - `thinkingLevel`
  - `getAvailableThinkingLevels()`
  - `setModel(model)`
  - `setThinkingLevel(level)`
  - `supportsThinking()`
- Added optional `createExtensionUiContext`.
- Passed the GUI extension UI context into `session.bindExtensions({ mode: "rpc", uiContext })`.
- Narrowed `ManagedAgentRuntime.services` to `RuntimeAgentServices` for GUI usage.

Modified `packages/gui/src/main/session/pi-sdk-session-driver.ts`.

- Implemented `getModelThinking()`.
- Implemented `setModel()`.
- Implemented `setThinkingLevel()`.
- Maps missing registry/model/auth and set failures to typed GUI errors.
- Builds model options from the runtime model registry when available.
- Uses `getSupportedThinkingLevels(model)` so per-model `thinkingLevelMap` exclusions are respected.

Modified `packages/gui/src/main/session/session-supervisor.ts`.

- Publishes `modelThinking.updated` after runtime open.
- Publishes `modelThinking.updated` after model or thinking changes.
- Handles `thinking_level_changed` runtime events by refreshing model/thinking state.
- Requires an installed extension UI service for extension responses and editor mirror updates.
- Cancels pending extension UI requests before closing a runtime session.
- Throws `WorkspaceNotFound` instead of using `workspaceId` as a path fallback.

### Settings And Trust Bridge

Added `packages/gui/src/main/settings/settings-bridge-service.ts`.

- Computes settings paths from trusted main-process inputs only:
  - global: `<agentDir>/settings.json`
  - project: `<workspace>/.pi/settings.json`
- Reads effective settings through `SettingsManager.create()`.
- Reads trust state through `ProjectTrustStore`.
- Reads trust options through `getProjectTrustOptions()`.
- Uses `hasTrustRequiringProjectResources()` for display-only trust warnings.
- Opens/reveals only computed settings paths.
- Throws `SettingsFileUnavailable` when the computed path does not exist.
- Throws `SettingsFileOpenFailed` when Electron shell open/reveal fails.
- Throws `SettingsFileOpenFailed` when no shell adapter is installed instead of returning false success.
- Throws typed read failures for missing workspaces rather than treating workspace IDs as paths.

Out of scope in this service:

- Editing settings.
- Saving trust decisions.
- Arbitrary renderer-provided file paths.

### Extension Host UI Service

Added `packages/gui/src/main/session/extension-host-ui-service.ts`.

- Creates per-session `ExtensionUIContext` objects for Pi extensions.
- Supports blocking requests:
  - `confirm`
  - `input`
  - `select`
  - `editor`
- Publishes `extensionUi.requested` events with session-scoped request IDs.
- Resolves responses through `extensionUi.respond`.
- Rejects wrong response kinds with `ExtensionUiResponseInvalid`.
- Rejects unknown requests with `ExtensionUiRequestNotFound`.
- Rejects request IDs pending in another session with `ExtensionUiSessionMismatch`.
- Handles timeout and `AbortSignal` cleanup using the same default-value model as Pi RPC mode:
  - `confirm` resolves `false`
  - string dialogs resolve `undefined`
- Cancels pending session requests on runtime close.
- Supports non-blocking UI:
  - `notify`
  - `setStatus`
  - `setTitle`
  - `setEditorText`
  - `pasteToEditor`
  - `getEditorText`
- Implements synchronous `getEditorText()` from a main-side mirror updated by renderer composer changes.
- Publishes compatibility issues for unsupported TUI-only APIs:
  - terminal input hooks
  - custom widgets/components
  - custom header/footer/editor
  - autocomplete providers
  - theme mutation
  - tool expansion controls

### Electron IPC Router

Modified `packages/gui/src/main/ipc-router.ts`.

- Instantiates:
  - `ExtensionHostUiService`
  - `RuntimeSupervisor` with `createExtensionUiContext`
  - `SettingsBridgeService`
  - `SessionSupervisor` with extension UI service
- Routes model/thinking commands through `SessionSupervisor`.
- Routes settings and trust commands through `SettingsBridgeService`.
- Routes `extensionUi.respond` through `SessionSupervisor.respondToExtensionUi()`.
- Routes `extensionUi.updateEditorText` through `SessionSupervisor.updateExtensionEditorText()`.
- Publishes settings/trust context after `session.create` and `session.open`.
- Emits typed `app.error` if session runtime-context preload fails instead of silently swallowing the error.
- Preserves the existing single invoke channel and renderer event channel.
- Keeps sender validation through `AppOriginPolicy`.

### Renderer Store

Modified `packages/gui/src/renderer/app/app-store.ts`.

- Added state maps:
  - `modelThinkingBySessionKey`
  - `settingsSummaryByWorkspaceId`
  - `trustStatusByWorkspaceId`
  - `extensionUiBySessionKey`
- Added methods:
  - `setModel()`
  - `setThinkingLevel()`
  - `getSettingsSummary()`
  - `getTrustStatus()`
  - `openSettingsFile()`
  - `revealSettingsFile()`
  - `respondToExtensionUi()`
- Added renderer composer draft mirroring through `extensionUi.updateEditorText`.
- Applies new event types immutably.
- Clears model/thinking and extension UI state when a session closes.
- Decodes model/thinking, settings, and trust command results.
- Preserves `useSyncExternalStore` as the React state integration boundary.

### Renderer UI

Modified `packages/gui/src/renderer/app/App.tsx`.

- Added runtime controls near the session header:
  - model selector
  - thinking-level selector
- Uses option indexes for model selector values so model IDs containing `/` are not corrupted.
- Added a compact settings/trust panel in the sidebar.
- Added open/reveal buttons for global/project settings.
- Added extension inline state strip for:
  - title
  - statuses
  - notifications
  - compatibility issues
- Added `ExtensionUiLayer` for blocking extension dialogs.
- Added Escape cancel behavior.
- Added dialog semantics:
  - `role="dialog"`
  - `aria-modal="true"`
  - `aria-labelledby`
- Added one-shot response handling for `getEditorText` requests.

Modified `packages/gui/src/renderer/styles/app.css`.

- Added restrained styles for:
  - runtime controls
  - settings/trust summary list
  - extension inline strip
  - extension modal
- Kept the existing minimal operational desktop style.
- Did not add decorative hero content, nested cards, gradients, or marketing layout.

## Implementation Plan

### Task 1: Extend Phase 6 Contracts

**Files:**

- Modify: `packages/gui/src/contracts/commands.ts`
- Modify: `packages/gui/src/contracts/errors.ts`
- Modify: `packages/gui/src/contracts/events.ts`
- Modify: `packages/gui/src/contracts/snapshots.ts`
- Test: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Write failing contract tests**

Add tests proving the new commands, events, snapshots, and errors decode through Effect Schema.

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected before implementation: failures for unknown Phase 6 command/event/error tags.

**Step 3: Implement contract schemas**

Add the Phase 6 schemas and include them in the `GuiCommand`, `GuiEvent`, and `GuiError` unions.

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
git commit -m "feat(gui): add runtime control contracts"
```

### Task 2: Export Narrow Runtime Helpers

**Files:**

- Modify: `packages/coding-agent/src/runtime.ts`
- Test: `packages/gui/test/shared/process-boundaries.test.ts`

**Step 1: Write failing boundary test**

Add or update process-boundary tests to prove renderer/preload do not import `@earendil-works/pi-coding-agent`, while GUI main can import the runtime subpath.

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/shared/process-boundaries.test.ts
```

Expected before implementation: missing runtime exports or boundary failures.

**Step 3: Export only required runtime helpers**

Expose settings, trust, model registry, extension UI context types, and `getSupportedThinkingLevels` through `@earendil-works/pi-coding-agent/runtime`.

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/shared/process-boundaries.test.ts
```

Expected: process boundary tests pass.

**Step 5: Commit**

```bash
git add packages/coding-agent/src/runtime.ts packages/gui/test/shared/process-boundaries.test.ts
git commit -m "feat(gui): expose runtime helpers for desktop"
```

### Task 3: Add Runtime Model And Thinking Driver Support

**Files:**

- Modify: `packages/gui/src/main/session/session-driver.ts`
- Modify: `packages/gui/src/main/session/runtime-supervisor.ts`
- Modify: `packages/gui/src/main/session/pi-sdk-session-driver.ts`
- Modify: `packages/gui/src/main/session/session-supervisor.ts`
- Test: `packages/gui/test/main/session/pi-sdk-session-driver.test.ts`
- Test: `packages/gui/test/main/session/session-supervisor.test.ts`

**Step 1: Write failing driver and supervisor tests**

Add tests for:

- model list snapshot
- model switch success
- missing model
- missing auth
- thinking level switch
- model-specific thinking levels
- `modelThinking.updated` event on open and mutations

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/pi-sdk-session-driver.test.ts test/main/session/session-supervisor.test.ts
```

Expected before implementation: missing driver methods and missing events.

**Step 3: Implement driver and supervisor support**

Implement the model/thinking methods and typed error mapping. Use `getSupportedThinkingLevels(model)` for model option snapshots.

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/pi-sdk-session-driver.test.ts test/main/session/session-supervisor.test.ts
```

Expected: driver and supervisor tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/main/session packages/gui/test/main/session
git commit -m "feat(gui): add runtime model controls"
```

### Task 4: Add Settings And Trust Bridge

**Files:**

- Create: `packages/gui/src/main/settings/settings-bridge-service.ts`
- Test: `packages/gui/test/main/settings/settings-bridge-service.test.ts`

**Step 1: Write failing service tests**

Add tests for:

- global and project settings path computation
- missing workspace failure
- trust `null` update preservation
- settings file unavailable
- no shell adapter failure
- shell open/reveal using computed paths only

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/settings/settings-bridge-service.test.ts
```

Expected before implementation: missing service and missing typed errors.

**Step 3: Implement service**

Create `SettingsBridgeService` using `SettingsManager`, `ProjectTrustStore`, `getProjectTrustOptions`, and Electron shell adapter injection.

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/settings/settings-bridge-service.test.ts
```

Expected: settings/trust service tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/main/settings/settings-bridge-service.ts packages/gui/test/main/settings/settings-bridge-service.test.ts
git commit -m "feat(gui): add settings and trust bridge"
```

### Task 5: Add Extension Host UI Service

**Files:**

- Create: `packages/gui/src/main/session/extension-host-ui-service.ts`
- Modify: `packages/gui/src/main/session/runtime-supervisor.ts`
- Modify: `packages/gui/src/main/session/session-supervisor.ts`
- Test: `packages/gui/test/main/session/extension-host-ui-service.test.ts`
- Test: `packages/gui/test/main/session/session-supervisor.test.ts`

**Step 1: Write failing extension host tests**

Add tests for:

- confirm response resolution
- input/select/editor response resolution
- wrong response kind rejection
- wrong-session rejection
- unrelated missing request rejection
- timeout cleanup
- AbortSignal cleanup
- session close cancellation
- renderer editor text mirror
- unsupported API compatibility events

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/extension-host-ui-service.test.ts test/main/session/session-supervisor.test.ts
```

Expected before implementation: service missing and supervisor extension UI behavior missing.

**Step 3: Implement service and binding**

Create `ExtensionHostUiService`, pass its context to `RuntimeSupervisor`, and route cancellation/response/editor mirror through `SessionSupervisor`.

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/extension-host-ui-service.test.ts test/main/session/session-supervisor.test.ts
```

Expected: extension host and supervisor tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/main/session/extension-host-ui-service.ts packages/gui/src/main/session/runtime-supervisor.ts packages/gui/src/main/session/session-supervisor.ts packages/gui/test/main/session/extension-host-ui-service.test.ts packages/gui/test/main/session/session-supervisor.test.ts
git commit -m "feat(gui): add native extension ui host"
```

### Task 6: Route Phase 6 IPC

**Files:**

- Modify: `packages/gui/src/main/ipc-router.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write failing IPC tests**

Add tests for:

- `session.setModel`
- `session.setThinkingLevel`
- `settings.getSummary`
- `settings.openGlobalFile`
- `settings.revealGlobalFile`
- `settings.openProjectFile`
- `settings.revealProjectFile`
- `trust.getStatus`
- `extensionUi.respond`
- `extensionUi.updateEditorText`
- typed `app.error` when runtime-context preload fails

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
```

Expected before implementation: missing routes and missing emitted events.

**Step 3: Implement routes**

Instantiate and wire `SettingsBridgeService`, `ExtensionHostUiService`, and the expanded `SessionSupervisor` route surface.

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
```

Expected: IPC router tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/main/ipc-router.ts packages/gui/test/main/ipc-router.test.ts
git commit -m "feat(gui): route runtime settings and extension ipc"
```

### Task 7: Extend Renderer Store

**Files:**

- Modify: `packages/gui/src/renderer/app/app-store.ts`
- Test: `packages/gui/test/renderer/app-store.test.ts`

**Step 1: Write failing renderer store tests**

Add tests for:

- model/thinking event reduction
- settings summary event reduction
- trust status event reduction
- extension request add/remove
- extension update reduction
- composer draft mirror command
- session close cleanup
- immutable snapshot changes

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
```

Expected before implementation: missing store state and methods.

**Step 3: Implement renderer store changes**

Add Phase 6 state maps, commands, result decoding, and event reducers.

**Step 4: Run test to verify it passes**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
```

Expected: renderer store tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/renderer/app/app-store.ts packages/gui/test/renderer/app-store.test.ts
git commit -m "feat(gui): store runtime settings and extension state"
```

### Task 8: Add Minimal Phase 6 UI

**Files:**

- Modify: `packages/gui/src/renderer/app/App.tsx`
- Modify: `packages/gui/src/renderer/styles/app.css`

**Step 1: Add runtime controls**

Add model and thinking selectors near the active session header. Use stable option indexes rather than delimiter-based values.

**Step 2: Add settings/trust panel**

Add a compact sidebar panel with effective model/provider/skill/trust status and open/reveal buttons.

**Step 3: Add extension UI layer**

Add inline extension state and a blocking dialog layer for confirm/input/select/editor requests.

**Step 4: Add accessibility behavior**

Add dialog semantics, Escape cancellation, and one-shot `getEditorText` responses.

**Step 5: Run checks**

Run:

```bash
npm --prefix packages/gui run check
```

Expected: format, lint, typecheck, and GUI tests pass.

**Step 6: Commit**

```bash
git add packages/gui/src/renderer/app/App.tsx packages/gui/src/renderer/styles/app.css
git commit -m "feat(gui): render runtime settings and extension ui"
```

## Test Plan

Focused tests used during implementation:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/extension-host-ui-service.test.ts test/main/settings/settings-bridge-service.test.ts test/main/session/session-supervisor.test.ts test/main/ipc-router.test.ts test/renderer/app-store.test.ts
```

Additional targeted tests for review fixes:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/pi-sdk-session-driver.test.ts test/main/settings/settings-bridge-service.test.ts test/main/ipc-router.test.ts
```

Package check:

```bash
npm --prefix packages/gui run check
```

Root check:

```bash
npm run check
```

Final staged whitespace check:

```bash
git diff --staged --check
```

## Verification Report

Final verification completed after implementation:

- `node ../../node_modules/vitest/dist/cli.js --run test/main/session/pi-sdk-session-driver.test.ts test/main/settings/settings-bridge-service.test.ts test/main/ipc-router.test.ts`
  - Result: passed, 32 tests.
- `npm --prefix packages/gui run check`
  - Result: passed.
  - GUI test result: 21 files passed, 123 tests passed.
- `npm run check`
  - Result: passed.
  - Includes root Biome check, pinned dependency check, TypeScript import check, shrinkwrap check, root `tsgo --noEmit`, browser smoke check, and GUI check.
- `git diff --staged --check`
  - Result: passed.

## Review Fixes Folded Into Phase 6

The staged implementation was reviewed and then tightened before final verification.

Fixed:

- Model option snapshots now use Pi core `getSupportedThinkingLevels(model)` instead of hardcoding thinking levels.
- Settings open/reveal now require a shell adapter and fail with `SettingsFileOpenFailed` when absent.
- Session runtime-context preload failures now emit typed `app.error` events instead of being silently swallowed.
- Extension UI response matching distinguishes wrong-session requests from unrelated missing requests.
- Extension UI blocking requests clean up on timeout and abort.
- Renderer model selector uses stable option indexes so model IDs containing `/` are preserved.
- Trust options preserve `decision: null`.
- Missing workspace IDs fail with typed errors instead of being treated as filesystem paths.
- `extensionUi.respond` fails when no extension UI service is installed instead of no-oping.

## Commit Message

Recommended final commit message:

```git
feat(gui): add runtime controls and extension UI bridge
```

Recommended body:

```git
- Expand Effect Schema IPC contracts for model/thinking snapshots, settings/trust summaries, and session-scoped extension UI commands/events.
- Wire Electron main to Pi runtime model switching, thinking-level updates, settings file open/reveal, trust status, and extension UI request handling.
- Add a native extension UI host with scoped request resolution, timeout/abort cleanup, compatibility events, and composer draft mirroring.
- Render model/thinking controls, settings/trust visibility, extension inline state, and blocking extension dialogs in the desktop shell.
- Use Pi core thinking-level rules for model options and surface preload failures through typed app.error events.
- Cover runtime controls, settings/trust, extension UI, IPC routing, and renderer store behavior with focused tests.
```

## Deferred Follow-Ups

- Split `App.tsx` Phase 6 UI into smaller components if Phase 7 adds more shell UI.
- Add full settings editor in a later phase.
- Add GUI trust decision saving in a later phase.
- Add slash-command parity and TUI flow parity incrementally.
- Add Playwright/Electron smoke coverage for modal rendering and settings buttons once the desktop shell stabilizes.

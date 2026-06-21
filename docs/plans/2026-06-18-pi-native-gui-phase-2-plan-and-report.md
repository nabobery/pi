# Pi Native GUI Phase 2 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the temporary Phase 1 GUI bridge with durable Effect Schema contracts and a typed Electron IPC command/event protocol.

**Architecture:** Phase 2 keeps the GUI as a Pi-native desktop host while limiting this PR to protocol and boundary work. Main owns Electron IPC validation and sender trust, preload exposes a fixed typed bridge, and renderer remains a browser client that imports only GUI contracts and renderer-local modules. The Pi SDK/session driver remains deferred to Phase 4.

**Tech Stack:** Electron IPC, Electron context isolation, Effect Schema, TypeScript, React, electron-vite, oxlint, oxfmt, Vitest, Playwright Electron.

---

## Phase 2 Scope

Phase 2 is the **Effect Schema Contracts And IPC Bridge** phase from `docs/plans/2026-06-18-pi-native-gui-implementation-phases.md`.

In scope:

- Add `packages/gui/src/contracts/**` as the only shared contract surface for main, preload, and renderer.
- Define branded IDs, tagged command schemas, tagged event schemas, tagged error schemas, result envelopes, and minimal read-model snapshots.
- Replace the temporary `window.piGui.getAppInfo()` bridge with:
  - `window.piGui.invoke(command): Promise<GuiCommandResult>`
  - `window.piGui.subscribe(listener): () => void`
- Add one fixed invoke channel: `pi-gui:invoke`.
- Add one fixed event channel: `pi-gui:event`.
- Decode renderer commands in Electron main with Effect Schema before routing.
- Reuse Phase 1 `AppOriginPolicy` sender validation before command handling and event sender registration.
- Return renderer-safe success/failure envelopes instead of throwing raw errors across IPC.
- Emit typed bootstrap receipt events.
- Decode invoke results and pushed events in preload before exposing them to renderer code.
- Keep handlers intentionally shallow: `app.bootstrap` returns static bootstrap data; non-bootstrap commands return `CommandNotImplemented`.
- Keep renderer UI visually unchanged except for replacing startup plumbing with `AppBootstrap`.

Out of scope:

- Pi SDK imports.
- Session driver or runtime supervisor.
- Workspace/session catalog behavior.
- Prompt streaming, tool rendering, timeline persistence, or real session transcripts.
- Settings, trust, extensions, slash commands, `/resume`, `/tree`, `/compact`, and `/share`.
- Tailwind, icon libraries, animation, runtime UI redesign, or package signing.

## Implemented Changes

### Dependencies And Tooling

- Added `effect@3.21.3` to `packages/gui` runtime dependencies.
- Added `@effect/language-service@0.86.2` to `packages/gui` dev dependencies.
- Added `@effect/language-service` to `packages/gui/tsconfig.json` plugins.
- Updated `packages/gui/oxlint.config.ts` so the new contract and IPC code stays inside the package-local lint boundary.
- Updated `package-lock.json` with `npm install --ignore-scripts`.
- Updated root `esbuild` to `0.28.1` and added the root `esbuild` override.
- Regenerated `packages/coding-agent/npm-shrinkwrap.json` after the lockfile refresh.
- Updated `scripts/generate-coding-agent-shrinkwrap.mjs` for the new intentional `protobufjs@7.6.4` postinstall allowlist entry.

### Contract Surface

Added `packages/gui/src/contracts/`:

- `ids.ts`
  - `WorkspaceId`
  - `SessionId`
  - `RunId`
  - `RequestId`
  - `EventId`
  - `CatalogRevision`
  - `ExtensionUiRequestId`
  - String constructors such as `requestIdFromString()` and `eventIdFromString()`
- `errors.ts`
  - `InvalidRendererCommand`
  - `UnauthorizedIpcSender`
  - `CommandNotImplemented`
  - `InternalIpcError`
  - `GuiError`
  - `decodeGuiError()`
- `commands.ts`
  - `AppBootstrap`
  - `RendererReady`
  - `WorkspaceAdd`
  - `WorkspaceSelect`
  - `WorkspaceSync`
  - `SessionCreate`
  - `SessionOpen`
  - `SessionClose`
  - `SessionSendMessage`
  - `SessionCancelRun`
  - `SessionSetModel`
  - `SessionSetThinkingLevel`
  - `SessionGetTranscript`
  - `ExtensionUiRespond`
  - `GuiCommand`
  - `decodeGuiCommand()`
- `events.ts`
  - `AppReady`
  - `AppError`
  - `ReceiptEmitted`
  - `WorkspaceCatalogUpdated`
  - `SessionCatalogUpdated`
  - `SessionOpened`
  - `SessionClosed`
  - `SessionStatusChanged`
  - `TimelineMessageDelta`
  - `ToolStarted`
  - `ToolUpdated`
  - `ToolFinished`
  - `QueueUpdated`
  - `RunStarted`
  - `RunCompleted`
  - `RunFailed`
  - `ExtensionUiRequested`
  - `ExtensionUiResolved`
  - `ExtensionUiCompatibilityIssue`
  - `GuiEvent`
  - `decodeGuiEvent()`
- `results.ts`
  - `GuiCommandSuccess`
  - `GuiCommandFailure`
  - `GuiCommandResult`
  - `decodeGuiCommandResult()`
- `snapshots.ts`
  - `AppInfoSnapshot`
  - `WorkspaceSnapshot`
  - `SessionStatus`
  - `SessionSnapshot`
  - `TimelineSnapshot`
  - `ModelThinkingSnapshot`
  - `SettingsSummarySnapshot`
  - `ExtensionUiRequestSnapshot`
  - `BootstrapSnapshot`
  - `WorkspaceCatalogSnapshot`
  - `RunSnapshot`
  - `decodeBootstrapSnapshot()`
- `index.ts`
  - Re-exports the contract modules as the package-local shared contract entrypoint.

### Shared Channels

Updated `packages/gui/src/shared/contracts.ts`:

- Removed the Phase 1 `APP_GET_INFO_CHANNEL`-oriented bridge.
- Added the fixed invoke channel:

```ts
export const PI_GUI_INVOKE_CHANNEL = "pi-gui:invoke";
```

- Added the fixed event channel:

```ts
export const PI_GUI_EVENT_CHANNEL = "pi-gui:event";
```

- Kept the renderer-facing `AppInfo` shape through the schema-backed `AppInfoSnapshot` type.

### Electron Main IPC Router

Added `packages/gui/src/main/ipc-router.ts`:

- `RendererEventBus`
  - Maintains a monotonic event sequence number.
  - Registers only trusted renderer `WebContents` senders.
  - Keys senders by `WebContents.id`.
  - Removes senders on the `destroyed` event.
  - Skips destroyed senders during publish.
  - Publishes only typed `GuiEvent` values.
- `createGuiInvokeHandler()`
  - Extracts a request ID before decoding so malformed requests still receive an error envelope.
  - Validates `event.senderFrame` with `AppOriginPolicy`.
  - Registers the sender only after sender validation succeeds.
  - Decodes unknown command payloads through `decodeGuiCommand()`.
  - Maps decode failures to `InvalidRendererCommand`.
  - Routes `app.bootstrap`.
  - Maps non-bootstrap commands to `CommandNotImplemented`.
- `registerGuiIpcHandlers()`
  - Registers one Electron handler for `pi-gui:invoke`.
  - Returns the event bus for future main-process integration.

The implemented bootstrap command returns:

```ts
{
	ok: true,
	requestId: command.requestId,
	data: {
		appInfo: createAppInfo(options.app, options.mode),
	},
}
```

The implemented bootstrap command emits:

- `app.bootstrap.accepted`
- `app.bootstrap.completed`

Both receipts are published as `ReceiptEmitted` events on `pi-gui:event`.

### Electron Main Integration

Updated main-process wiring:

- `packages/gui/src/main/ipc.ts`
  - Removed the temporary `app:get-info` registration.
  - Delegates GUI IPC registration to `registerGuiIpcHandlers()`.
- `packages/gui/src/main/bootstrap.ts`
  - Uses the new GUI IPC registration path.
- `packages/gui/src/main/main.ts`
  - Preserves the guarded startup behavior from Phase 1.

### Preload Bridge

Updated `packages/gui/src/preload/pi-gui-api.ts`:

- Exposes only:

```ts
export interface PiGuiApi {
	invoke(command: GuiCommand): Promise<GuiCommandResult>;
	subscribe(listener: (event: GuiEvent) => void): () => void;
}
```

- Sends commands only on `pi-gui:invoke`.
- Subscribes only to `pi-gui:event`.
- Decodes invoke results with `decodeGuiCommandResult()`.
- Converts malformed invoke results into an `InternalIpcError` result envelope using the original command request ID.
- Decodes event payloads with `decodeGuiEvent()`.
- Drops malformed pushed events instead of delivering them to renderer subscribers.

Updated `packages/gui/src/preload/index.ts`:

- Keeps raw `ipcRenderer` inside preload.
- Strips Electron event objects before calling preload API listeners.
- Returns subscription cleanup functions that remove the Electron listener.
- Does not expose dynamic channel names, Node APIs, raw Electron APIs, or `ipcRenderer`.

### Renderer Bootstrap

Added `packages/gui/src/renderer/app/bootstrap-loader.ts`:

- Sends `new AppBootstrap({ requestId: requestIdFromString("renderer-bootstrap") })`.
- Treats invoke rejection, failure envelopes, and malformed success payloads as visible failed startup state.
- Decodes bootstrap data with `decodeBootstrapSnapshot()`.

Updated `packages/gui/src/renderer/app/App.tsx`:

- Replaced `getAppInfo()` loading with `loadBootstrapState(window.piGui)`.
- Preserved Phase 1 shell UI and startup states.
- Shows `Pi could not start` for malformed bootstrap success data instead of leaving the renderer stuck in loading.

### Process Boundaries

Updated process-boundary tests so Phase 2 keeps these constraints:

- Renderer imports only renderer-local modules and `src/contracts/**`.
- Preload imports only preload-local modules, Electron preload APIs, and `src/contracts/**`.
- Main imports contracts plus Electron/main modules.
- No `@earendil-works/pi-coding-agent` import exists in Phase 2.

### Tests Added Or Updated

Added `packages/gui/test/contracts/contracts.test.ts`:

- Valid command decode.
- Unknown command tag rejection.
- Missing required payload rejection.
- Invalid branded ID rejection.
- Branded ID constructor success.
- Event decoding.
- Error serialization decoding.
- Exported schema union presence.

Added `packages/gui/test/main/ipc-router.test.ts`:

- Trusted renderer bootstrap success.
- Missing sender frame rejection.
- Untrusted sender rejection.
- Malformed payload rejection.
- Non-bootstrap `CommandNotImplemented` behavior.
- Trusted sender auto-registration and bootstrap receipt delivery.
- Sender cleanup after `WebContents` destruction.

Updated `packages/gui/test/preload/pi-gui-api.test.ts`:

- Public API exposes only `invoke` and `subscribe`.
- Invoke uses the fixed `pi-gui:invoke` channel.
- Subscribe uses the fixed `pi-gui:event` channel.
- Cleanup unsubscribes.
- Malformed event payloads are dropped.
- Valid event payloads are decoded before delivery.
- Malformed invoke results become `InternalIpcError` envelopes.

Added `packages/gui/test/renderer/bootstrap-loader.test.ts`:

- Valid bootstrap data returns ready state.
- Malformed successful bootstrap payload returns failed state.

Updated `packages/gui/test/electron/shell.spec.ts`:

- Smoke expectations use `["invoke", "subscribe"]` instead of `["getAppInfo"]`.

Updated `packages/gui/test/shared/process-boundaries.test.ts`:

- Allows renderer/preload contract imports.
- Continues to block main imports and Pi runtime imports from renderer/preload.

## Implementation Plan

### Task 1: Add Effect Schema Dependencies

**Files:**

- Modify: `packages/gui/package.json`
- Modify: `packages/gui/tsconfig.json`
- Modify: `package-lock.json`

**Step 1: Add exact dependencies**

Add:

```json
{
	"dependencies": {
		"effect": "3.21.3"
	},
	"devDependencies": {
		"@effect/language-service": "0.86.2"
	}
}
```

**Step 2: Add TypeScript plugin**

Add the Effect language service plugin to `packages/gui/tsconfig.json`:

```json
{
	"compilerOptions": {
		"plugins": [{ "name": "@effect/language-service" }]
	}
}
```

**Step 3: Refresh lockfile safely**

Run:

```bash
npm install --ignore-scripts
```

Expected: lockfile refreshes without lifecycle scripts.

**Step 4: Verify dependency pins**

Run:

```bash
npm --prefix packages/gui run typecheck
```

Expected: Typecheck reaches missing contract implementation errors until later tasks are complete.

### Task 2: Add Contract Decode Tests

**Files:**

- Create: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Write failing tests for commands**

Add tests for:

- `decodeGuiCommand(new AppBootstrap(...))`
- unknown `_tag`
- missing required fields
- invalid branded IDs

Use this command shape:

```ts
new AppBootstrap({ requestId: requestIdFromString("request-1") });
```

**Step 2: Write failing tests for events and errors**

Add tests for:

- `decodeGuiEvent(new ReceiptEmitted(...))`
- `decodeGuiError(new CommandNotImplemented(...))`
- exported `GuiCommand`, `GuiEvent`, and `GuiError` unions

**Step 3: Run tests and verify RED**

Run:

```bash
npm --prefix packages/gui run test:run -- test/contracts/contracts.test.ts
```

Expected before implementation: FAIL because `src/contracts/**` does not exist.

### Task 3: Add Contract Modules

**Files:**

- Create: `packages/gui/src/contracts/ids.ts`
- Create: `packages/gui/src/contracts/errors.ts`
- Create: `packages/gui/src/contracts/snapshots.ts`
- Create: `packages/gui/src/contracts/commands.ts`
- Create: `packages/gui/src/contracts/events.ts`
- Create: `packages/gui/src/contracts/results.ts`
- Create: `packages/gui/src/contracts/index.ts`
- Test: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Implement branded IDs**

Implement non-empty branded string IDs:

```ts
const NonEmptyId = Schema.String.pipe(Schema.minLength(1));
export const RequestId = NonEmptyId.pipe(Schema.brand("@PiGui/RequestId"));
export const requestIdFromString = RequestId.make;
```

Repeat for workspace, session, run, event, catalog revision, and extension UI request IDs.

**Step 2: Implement tagged errors**

Use `Schema.TaggedError` for renderer-safe errors:

```ts
export class InvalidRendererCommand extends Schema.TaggedError<InvalidRendererCommand>()(
	"InvalidRendererCommand",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}
```

Export the `GuiError` union and `decodeGuiError()`.

**Step 3: Implement snapshots**

Create minimal read models only:

- `AppInfoSnapshot`
- `BootstrapSnapshot`
- `WorkspaceCatalogSnapshot`
- `SessionSnapshot`
- `TimelineSnapshot`
- `ModelThinkingSnapshot`
- `SettingsSummarySnapshot`
- `ExtensionUiRequestSnapshot`
- `RunSnapshot`

Do not add runtime-owned Pi transcript behavior here.

**Step 4: Implement commands**

Use `Schema.TaggedRequest` for all Phase 2 command tags:

```ts
export class AppBootstrap extends Schema.TaggedRequest<AppBootstrap>()("app.bootstrap", {
	failure: GuiError,
	success: BootstrapSnapshot,
	payload: { requestId: RequestId },
}) {}
```

Export `GuiCommand` and `decodeGuiCommand()`.

**Step 5: Implement events**

Use tagged schema classes for events:

```ts
export class ReceiptEmitted extends Schema.TaggedClass<ReceiptEmitted>()("receipt.emitted", {
	eventId: EventId,
	sequence: Schema.Number,
	receipt: Schema.String,
	requestId: RequestId,
}) {}
```

Export `GuiEvent` and `decodeGuiEvent()`.

**Step 6: Implement result envelopes**

Add:

```ts
export const GuiCommandResult = Schema.Union(GuiCommandSuccess, GuiCommandFailure);
export const decodeGuiCommandResult = (value: unknown): Promise<GuiCommandResult> =>
	Effect.runPromise(Schema.decodeUnknown(GuiCommandResult)(value));
```

**Step 7: Verify contracts**

Run:

```bash
npm --prefix packages/gui run test:run -- test/contracts/contracts.test.ts
```

Expected: PASS.

### Task 4: Add IPC Router Tests

**Files:**

- Create: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write trusted sender bootstrap test**

Assert trusted senders receive:

- successful `AppBootstrap` result
- app name/version/mode data

**Step 2: Write sender rejection tests**

Assert:

- missing `senderFrame` returns `UnauthorizedIpcSender`
- untrusted sender URL returns `UnauthorizedIpcSender`
- neither case sends receipt events

**Step 3: Write malformed command test**

Assert unknown `_tag` returns `InvalidRendererCommand`.

**Step 4: Write non-bootstrap test**

Assert `session.open` returns `CommandNotImplemented`.

**Step 5: Write receipt delivery test**

Assert a trusted invoke automatically registers the sender and sends:

- `app.bootstrap.accepted`
- `app.bootstrap.completed`

**Step 6: Write destroyed sender cleanup test**

Assert the bus removes senders when their `destroyed` callback fires.

**Step 7: Run tests and verify RED**

Run:

```bash
npm --prefix packages/gui run test:run -- test/main/ipc-router.test.ts
```

Expected before implementation: FAIL because `ipc-router.ts` does not exist.

### Task 5: Implement IPC Router

**Files:**

- Create: `packages/gui/src/main/ipc-router.ts`
- Modify: `packages/gui/src/main/ipc.ts`
- Modify: `packages/gui/src/main/bootstrap.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`
- Test: `packages/gui/test/main/bootstrap.test.ts`

**Step 1: Define invoke event shape**

Define the narrowed testable IPC event type:

```ts
export interface GuiIpcInvokeEvent {
	senderFrame: { url: string } | null;
	sender: RendererEventSender;
}
```

**Step 2: Implement `RendererEventBus`**

Use a sender registry keyed by `WebContents.id`:

```ts
private sequence = 0;
private senders = new Map<number, RendererEventSender>();
```

Register senders only after trust validation.

**Step 3: Publish typed events only**

Make `publish()` accept only `GuiEvent`:

```ts
private publish(event: GuiEvent): void
```

**Step 4: Implement sender validation**

Reuse `isAllowedAppUrl(policy, event.senderFrame.url)`.

Return `UnauthorizedIpcSender` instead of throwing.

**Step 5: Decode commands**

Use:

```ts
await decodeGuiCommand(payload);
```

Map failures to `InvalidRendererCommand`.

**Step 6: Route commands**

Implement only `AppBootstrap`:

- publish accepted receipt
- return static bootstrap data from `createAppInfo()`
- publish completed receipt

Return `CommandNotImplemented` for all other commands.

**Step 7: Register the Electron handler**

Register one handler:

```ts
ipcMain.handle(PI_GUI_INVOKE_CHANNEL, (event, payload) => handler(event, payload));
```

**Step 8: Verify IPC router**

Run:

```bash
npm --prefix packages/gui run test:run -- test/main/ipc-router.test.ts
```

Expected: PASS.

### Task 6: Replace Shared Channel Contracts

**Files:**

- Modify: `packages/gui/src/shared/contracts.ts`
- Modify: `packages/gui/test/main/ipc.test.ts`

**Step 1: Remove temporary app-info channel**

Remove the Phase 1 `APP_GET_INFO_CHANNEL` bridge.

**Step 2: Add fixed channels**

Add:

```ts
export const PI_GUI_INVOKE_CHANNEL = "pi-gui:invoke";
export const PI_GUI_EVENT_CHANNEL = "pi-gui:event";
```

**Step 3: Retire old IPC test**

Delete or replace `packages/gui/test/main/ipc.test.ts` because the old `app:get-info` handler no longer exists.

**Step 4: Verify main tests**

Run:

```bash
npm --prefix packages/gui run test:run -- test/main
```

Expected: main tests pass.

### Task 7: Update Preload API Tests

**Files:**

- Modify: `packages/gui/test/preload/pi-gui-api.test.ts`

**Step 1: Update public surface expectation**

Assert:

```ts
expect(Object.keys(api)).toEqual(["invoke", "subscribe"]);
```

**Step 2: Assert fixed invoke channel**

Assert `invoke()` calls:

```ts
transport.invoke("pi-gui:invoke", command);
```

**Step 3: Assert fixed event channel and cleanup**

Assert `subscribe()` calls:

```ts
transport.on("pi-gui:event", expect.any(Function));
```

Then assert cleanup calls the transport unsubscribe function.

**Step 4: Assert malformed events are dropped**

Pass an event with an invalid branded ID and assert the renderer listener is not called.

**Step 5: Assert valid events are decoded**

Pass `new ReceiptEmitted(...)` and assert the listener receives a typed event.

**Step 6: Assert malformed invoke results are normalized**

Return an invalid result from transport and assert the API returns an `InternalIpcError` envelope.

**Step 7: Run tests and verify RED**

Run:

```bash
npm --prefix packages/gui run test:run -- test/preload/pi-gui-api.test.ts
```

Expected before implementation: FAIL because preload still exposes `getAppInfo`.

### Task 8: Implement Preload Bridge

**Files:**

- Modify: `packages/gui/src/preload/pi-gui-api.ts`
- Modify: `packages/gui/src/preload/index.ts`
- Modify: `packages/gui/src/preload/window.d.ts`
- Test: `packages/gui/test/preload/pi-gui-api.test.ts`

**Step 1: Define API types**

Expose only:

```ts
invoke(command: GuiCommand): Promise<GuiCommandResult>;
subscribe(listener: (event: GuiEvent) => void): () => void;
```

**Step 2: Implement invoke decoding**

Call the fixed channel and decode with `decodeGuiCommandResult()`.

If decoding fails, return:

```ts
{
	ok: false,
	requestId: command.requestId,
	error: new InternalIpcError({
		message: "Invalid IPC response",
		cause: getErrorMessage(error),
	}),
}
```

**Step 3: Implement event decoding**

Decode pushed event values with `decodeGuiEvent()`.

Call renderer listeners only after successful decode.

**Step 4: Strip Electron event objects**

In `src/preload/index.ts`, keep the handler shape:

```ts
const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
	listener(value);
};
```

Do not forward the Electron event object.

**Step 5: Verify preload tests**

Run:

```bash
npm --prefix packages/gui run test:run -- test/preload/pi-gui-api.test.ts
```

Expected: PASS.

### Task 9: Add Renderer Bootstrap Loader Tests

**Files:**

- Create: `packages/gui/test/renderer/bootstrap-loader.test.ts`

**Step 1: Write ready-state test**

Mock `invoke()` to return a valid bootstrap success envelope and assert `status: "ready"`.

**Step 2: Write malformed-success test**

Mock `invoke()` to return `ok: true` with malformed `data` and assert:

```ts
{
	status: "failed",
	message: "Invalid bootstrap response",
}
```

**Step 3: Run tests and verify RED**

Run:

```bash
npm --prefix packages/gui run test:run -- test/renderer/bootstrap-loader.test.ts
```

Expected before implementation: FAIL because `bootstrap-loader.ts` does not exist.

### Task 10: Implement Renderer Bootstrap Loader

**Files:**

- Create: `packages/gui/src/renderer/app/bootstrap-loader.ts`
- Modify: `packages/gui/src/renderer/app/App.tsx`
- Test: `packages/gui/test/renderer/bootstrap-loader.test.ts`

**Step 1: Implement load state**

Define:

```ts
export type LoadState =
	| { status: "loading" }
	| { status: "ready"; appInfo: AppInfo }
	| { status: "failed"; message: string };
```

**Step 2: Invoke bootstrap command**

Call:

```ts
api.invoke(new AppBootstrap({ requestId: requestIdFromString("renderer-bootstrap") }));
```

**Step 3: Decode bootstrap data**

Decode success data with `decodeBootstrapSnapshot()`.

Map decode failure to `Invalid bootstrap response`.

**Step 4: Catch all startup failures**

Use one `try/catch` so invoke rejection, error envelopes, and malformed success payloads all become visible failure states.

**Step 5: Update `App.tsx`**

Replace direct app-info loading with:

```ts
void loadBootstrapState(window.piGui).then((nextLoadState) => {
	if (isMounted) setLoadState(nextLoadState);
});
```

**Step 6: Verify renderer tests**

Run:

```bash
npm --prefix packages/gui run test:run -- test/renderer/bootstrap-loader.test.ts
```

Expected: PASS.

### Task 11: Update Electron Smoke And Process Boundary Tests

**Files:**

- Modify: `packages/gui/test/electron/shell.spec.ts`
- Modify: `packages/gui/test/shared/process-boundaries.test.ts`

**Step 1: Update preload API smoke expectation**

Replace:

```ts
["getAppInfo"]
```

with:

```ts
["invoke", "subscribe"]
```

**Step 2: Keep Node/Electron exposure assertions**

Continue asserting the renderer does not expose:

- `window.process`
- `window.require`
- `window.ipcRenderer`
- raw Electron APIs

**Step 3: Update process-boundary allowlist**

Allow renderer and preload imports from `src/contracts/**`.

Continue to reject:

- renderer/preload imports from `src/main/**`
- renderer/preload imports from `@earendil-works/pi-coding-agent`

**Step 4: Verify boundary tests**

Run:

```bash
npm --prefix packages/gui run test:run -- test/shared/process-boundaries.test.ts
```

Expected: PASS.

### Task 12: Final Verification

**Files:**

- All Phase 2 files.

**Step 1: Run focused tests**

Run:

```bash
npm --prefix packages/gui run test:run -- test/contracts/contracts.test.ts
npm --prefix packages/gui run test:run -- test/main/ipc-router.test.ts
npm --prefix packages/gui run test:run -- test/preload/pi-gui-api.test.ts
npm --prefix packages/gui run test:run -- test/renderer/bootstrap-loader.test.ts
```

Expected: all pass.

**Step 2: Run GUI package check**

Run:

```bash
npm --prefix packages/gui run check
```

Expected: format, lint, typecheck, and all GUI unit tests pass.

**Step 3: Run root check**

Run:

```bash
npm run check
```

Expected: root Biome, pinned dependency check, import check, shrinkwrap check, root `tsgo`, browser smoke, and GUI package check all pass.

**Step 4: Run GUI audits**

Run:

```bash
npm audit --workspace @earendil-works/pi-gui --omit=dev --json
npm audit --workspace @earendil-works/pi-gui --json
```

Expected:

- Production audit has zero vulnerabilities.
- Full audit currently reports one low dev-only advisory for `vite@7.3.5 -> esbuild@0.27.7` (`GHSA-g7r4-m6w7-qqqr`).

Do not force Vite 8 while `electron-vite@5.0.0` peers only with Vite 5, 6, or 7. Do not downgrade Vite to 7.2.x because that reintroduces high Vite advisories. Treat the remaining full-audit item as a documented dev-only toolchain constraint until `electron-vite` supports Vite 8 or Vite 7 receives a compatible fix.

**Step 5: Run Electron smoke test when GUI launch is available**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected: Electron builds and launches, the shell renders, `window.piGui` exposes only `invoke` and `subscribe`, and bootstrap receipts are observable.

This command may require macOS GUI launch permission when run from the managed sandbox.

**Step 6: Commit**

Use explicit paths only:

```bash
git add \
	package.json \
	package-lock.json \
	packages/coding-agent/npm-shrinkwrap.json \
	scripts/generate-coding-agent-shrinkwrap.mjs \
	packages/gui/package.json \
	packages/gui/tsconfig.json \
	packages/gui/oxlint.config.ts \
	packages/gui/src/contracts \
	packages/gui/src/main/bootstrap.ts \
	packages/gui/src/main/ipc-router.ts \
	packages/gui/src/main/ipc.ts \
	packages/gui/src/main/main.ts \
	packages/gui/src/preload \
	packages/gui/src/renderer/app \
	packages/gui/src/shared/contracts.ts \
	packages/gui/test \
	docs/plans/2026-06-18-pi-native-gui-phase-2-plan-and-report.md
git commit -m "feat(gui): add schema IPC bridge"
```

Do not use `git add .` or `git add -A`.

## Verification Completed

The implemented Phase 2 work was verified with:

```bash
npm --prefix packages/gui run typecheck
npm --prefix packages/gui run test:run -- test/main/ipc-router.test.ts
npm --prefix packages/gui run check
npm run check
```

All passed.

The GUI production audit was verified with:

```bash
npm audit --workspace @earendil-works/pi-gui --omit=dev --json
```

Result: zero production vulnerabilities.

The full GUI audit was verified with:

```bash
npm audit --workspace @earendil-works/pi-gui --json
```

Result: one low dev-only advisory remains through `vite@7.3.5 -> esbuild@0.27.7`. This is intentionally not forced in Phase 2 because the supported Electron build stack is currently `electron-vite@5.0.0` with Vite 5, 6, or 7. Vite 8 would violate the `electron-vite` peer range, and Vite 7.2.x reintroduces high Vite advisories.

`npm --prefix packages/gui run test:electron` was not re-run successfully from the managed sandbox after remediation because Electron launch requires GUI permission. Run it in a normal macOS desktop session before final merge if Electron smoke coverage is required for this PR.

## Review Notes

- Phase 2 intentionally does not import `@earendil-works/pi-coding-agent`.
- `AppBootstrap` is the only implemented command handler.
- All non-bootstrap commands are present in the contract and return typed `CommandNotImplemented` failures.
- Receipt events are delivered only after trusted sender validation.
- Preload validates events and invoke results as defense in depth.
- Main remains the authoritative validation boundary.
- Renderer startup is now robust against malformed successful bootstrap payloads.
- The event bus publishes only `GuiEvent`, not `unknown`.

## Follow-Up For Phase 3

- Add a schema-decoded workspace catalog.
- Persist GUI-owned workspace metadata without copying Pi transcripts.
- Add workspace add/select/sync commands behind the existing `pi-gui:invoke` protocol.
- Emit `workspace.catalogUpdated` and `session.catalogUpdated` events through the existing typed event bus.
- Keep renderer catalog state as read models derived from typed events.
- Keep Pi SDK/session runtime integration deferred until Phase 4.

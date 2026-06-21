# Pi Native GUI Phase 12 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Pi-native desktop support for rich extension UI, image attachments, session export, and GitHub gist sharing while preserving Pi-owned runtime truth and typed Electron boundaries.

**Architecture:** Electron main remains the only owner of privileged desktop APIs, Pi SDK sessions, filesystem export, image file reads, clipboard images, shell open/reveal, and GitHub CLI sharing. The renderer receives Effect Schema validated snapshots, stores only UI projections, and invokes narrow command IDs rather than filesystem paths or arbitrary URLs. Pi runtime stays the source of truth for sessions, transcripts, queueing, export, sharing inputs, image settings, extension state, and resource ownership.

**Tech Stack:** Electron, Effect Schema, TypeScript, React, `useSyncExternalStore`, Vitest, happy-dom, Playwright Electron, oxlint, oxfmt, Pi coding-agent runtime.

---

## Phase 12 Scope

Phase 12 is the **P1 Rich Extension UI, Image Attachments, Export, And Share** phase for `packages/gui`.

In scope:

- Render safe rich extension UI primitives:
  - text widgets from `ctx.ui.setWidget`
  - session notifications
  - compatibility issues
  - improved extension editor modal behavior
- Keep custom extension renderer components deferred and report them as compatibility issues.
- Add image attachment UX:
  - file picker
  - clipboard paste
  - preview thumbnails
  - remove and clear actions
  - send attachments with prompt, steer, and follow-up messages
  - respect `images.blockImages`
  - respect `images.autoResize`
  - cap pending attachment count and memory usage
- Add export UX:
  - HTML export
  - JSONL export
  - save dialog
  - typed cancellation result
  - tracked artifact IDs
  - open and reveal actions through Electron main
- Add share UX:
  - explicit user confirmation
  - typed IPC confirmation
  - `gh auth status`
  - secret GitHub gist creation
  - Pi share-viewer URL construction
  - tracked external artifact IDs
  - typed auth, unavailable, upload, timeout, and malformed URL failures
- Add Effect Schema contracts for every new command, result, snapshot, and error.
- Keep the SDK-first architecture. Do not introduce a Node WebSocket server, HTTP backend, TUI wrapper, or browser/server runtime boundary.
- Use existing Pi image/export/share utilities through narrow runtime exports.
- Keep `packages/gui` under Oxc ownership for lint and formatting.
- Keep large orchestration files below the maintainability threshold.

Out of scope:

- OS-level notifications.
- Arbitrary extension-provided renderer code.
- Extension custom component rendering.
- Cloud share providers other than GitHub gist.
- Packaged release/signing.
- Multi-window artifact management.
- Persistent attachment cache across app restarts.
- Full artifact history or downloads manager.
- TUI wrapping or terminal embedding.

## Current Baseline

Before Phase 12:

- The GUI could open workspaces and sessions, run prompts, stream timelines, cancel runs, manage queues, select models, manage trust/settings/resources, navigate trees, and compact sessions.
- `SessionSupervisor` owned active Pi runtime handles in Electron main.
- `PiSdkSessionDriver` adapted real Pi SDK sessions.
- `FakeSessionDriver` powered deterministic tests.
- IPC commands and events were Effect Schema validated.
- The renderer used `useSyncExternalStore` over immutable snapshots.
- Extension UI supported basic prompts and editor text mirroring, but not widgets or richer notification state.
- The composer was text-only.
- Export and share parity were not exposed in desktop form.
- Artifact open/reveal needed a main-owned registry so the renderer never passed arbitrary paths or URLs to Electron shell APIs.
- `app-store.ts` and `session-supervisor.ts` were close to the maintainability threshold and needed focused extraction as the phase added new surface area.

Phase 12 builds on the existing Pi-native architecture:

- Runtime truth stays in Pi and Electron main.
- Renderer state remains a projection.
- Every renderer command is decoded at the IPC boundary.
- Every privileged desktop action is handled in main.
- File paths and external URLs are main-owned artifacts, not renderer authority.

## Implemented Changes

### Contracts

- Added image attachment snapshot contracts:
  - `ImageAttachmentSnapshot`
  - `ImageAttachmentListSnapshot`
  - source, filename, MIME type, source size, preview data URL, dimension note, and timestamp fields
- Added export snapshot contracts:
  - `SessionExportSnapshot`
  - `SessionExportResultSnapshot`
  - typed `exported` and `cancelled` result variants
- Added share snapshot contracts:
  - `SessionShareSnapshot`
  - gist URL
  - preview URL
  - optional external artifact ID
- Added text widget contract:
  - `ExtensionWidgetSnapshot`
- Added commands:
  - `composer.pickImages`
  - `composer.pasteImageFromClipboard`
  - `composer.removeImageAttachment`
  - `composer.clearImageAttachments`
  - `session.export`
  - `session.share`
  - `artifact.open`
  - `artifact.reveal`
  - `artifact.openExternal`
- Extended `session.sendMessage` with optional `attachmentIds`.
- Added typed errors:
  - `ImageAttachmentBlocked`
  - `ImageAttachmentUnsupportedMime`
  - `ImageAttachmentReadFailed`
  - `ImageAttachmentResizeFailed`
  - `ImageAttachmentTooLarge`
  - `ImageAttachmentLimitExceeded`
  - `ImageAttachmentNotFound`
  - `SessionExportUnavailable`
  - `SessionExportFailed`
  - `SessionShareUnavailable`
  - `SessionShareAuthFailed`
  - `SessionShareFailed`
  - `ArtifactNotFound`
  - `ArtifactOpenFailed`
- Added runtime decoding tests for valid payloads and invalid payloads.
- Added `confirmed: true` to `session.share` so explicit confirmation is part of the typed IPC contract.

### Electron Main Services

- Added `ArtifactService`.
- Main tracks file artifacts by generated artifact ID.
- Main tracks external artifacts by generated artifact ID.
- Renderer can only open/reveal/openExternal using known artifact IDs.
- Added `ShareService`.
- Share service checks GitHub CLI auth before creating a gist.
- Share service exports HTML to a temp file through Pi session export APIs.
- Share service creates a secret gist using `gh gist create <file>`.
- Share service parses and validates GitHub gist URLs.
- Share service creates Pi share-viewer URLs through `getShareViewerUrl()`.
- Share service enforces a 30 second subprocess timeout.
- Share service bounds stdout/stderr capture to avoid unbounded memory growth.
- Share service maps missing `gh`, auth failure, gist failure, timeout, and malformed output to typed errors.
- Added `ImageAttachmentService`.
- Image attachment service owns base64 image payloads in main memory.
- Image attachment service returns renderer-safe preview snapshots.
- Image attachment service supports file picker inputs.
- Image attachment service supports clipboard image inputs.
- Image attachment service validates PNG, JPEG, GIF, and WebP.
- Image attachment service respects `images.blockImages`.
- Image attachment service respects `images.autoResize` for send payloads.
- Image attachment service caps:
  - `MAX_ATTACHMENTS_PER_SESSION = 8`
  - `MAX_IMAGE_SOURCE_BYTES = 50 * 1024 * 1024`
  - `MAX_SESSION_IMAGE_SOURCE_BYTES = 100 * 1024 * 1024`
  - `MAX_PREVIEW_BYTES = 512 * 1024`
  - `MAX_PREVIEW_DIMENSION = 512`
- Image attachment service uses file `stat` preflight before reading selected files.
- Image attachment service generates bounded previews with Pi image resizing utilities.
- Image attachment service consumes attachments on send and clears them on session close.

### Session Runtime

- Extended `SessionDriver.SendRuntimeMessageRequest` with optional `images`.
- Updated `PiSdkSessionDriver.sendMessage()` to pass Pi image content into `session.prompt(...)`.
- Preserved text-only behavior when no attachments are present.
- Allowed attachments for prompts, steering messages, and follow-up messages.
- Updated `SessionSupervisor.sendMessage()` to resolve attachment IDs through the main-owned image attachment resolver.
- Added send-time image setting recheck through `consumeForSend()`.
- Added export support through `SessionSupervisor.exportSession()`.
- Added `session-export.ts` so export busy checks and artifact tracking stay out of the larger supervisor class.
- Added `session-attachments.ts` so image consumption stays out of the larger supervisor class.
- Added `session-supervisor-utils.ts` to keep shared supervisor utility functions focused.
- Kept `app-store.ts` and `session-supervisor.ts` below the maintainability threshold.

### Extension UI

- Extended extension UI state with widgets.
- `ExtensionHostUiService.setWidget()` now renders only safe text widgets.
- String widget content is split into lines.
- String array widget content is accepted as lines.
- Empty widget content clears the widget.
- Unsupported widget payloads are reported as compatibility issues.
- Session notifications are retained as compact session-scoped state.
- Compatibility issues remain session-scoped and bounded.
- Renderer displays widget lines as plain text, never HTML.
- Extension editor modal behavior was polished for focus, submit, cancellation, and textarea sizing.

### Renderer UX

- Added composer image buttons:
  - `Add image`
  - `Paste image`
- Added attachment preview strip with thumbnails, source/filename, and remove action.
- Composer send is allowed when there is text or at least one unblocked image attachment.
- Composer send clears accepted draft text and attachments together.
- Images are disabled when `images.blockImages` is enabled.
- Stale attachments are cleared when image blocking becomes active.
- Added export/share controls near the active session surface.
- Export controls support HTML and JSONL.
- Export result shows open and reveal actions for the returned artifact ID.
- Share action requires renderer confirmation before constructing the typed command.
- Share result shows an open action for the returned external artifact ID.
- Added per-session export/share pending and last-error state through `desktop-artifacts-store.ts`.
- Disabled duplicate export/share actions while an export/share operation is pending.
- Kept UI compact and text-first.

### Fake Runtime And Tests

- Extended the fake session driver for deterministic image, widget, export, and share paths.
- Added contract tests for:
  - image attachment snapshots
  - export snapshots
  - export result variants
  - share snapshots
  - share confirmation
  - malformed URLs
  - image size/count errors
- Added main-process tests for:
  - image picker success
  - blocked images
  - unsupported MIME
  - oversized files
  - too many attachments
  - clipboard success
  - empty clipboard
  - send-time image block recheck
  - attachment remove/clear/consume
  - artifact open/reveal/openExternal
  - artifact not found
  - artifact wrong kind
  - shell failure wrapping
  - share success
  - missing GitHub CLI
  - unauthenticated GitHub CLI
  - gist upload failure
  - malformed gist URL
  - gist timeout
  - IPC routes for image/export/share/artifact commands
  - export cancellation result
- Added renderer tests for:
  - attachment preview rendering
  - attachment remove action
  - attachment-only send behavior
  - export/share operation state
  - typed share confirmation command
  - renderer fixture compatibility with new store state

## Implementation Plan

### Task 1: Add Rich Desktop Contracts

**Files:**

- Modify: `packages/gui/src/contracts/commands.ts`
- Modify: `packages/gui/src/contracts/errors.ts`
- Modify: `packages/gui/src/contracts/snapshots.ts`
- Test: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Write failing contract tests**

Add tests for:

- `ImageAttachmentSnapshot`
- `ImageAttachmentListSnapshot`
- `SessionExportSnapshot`
- `SessionExportResultSnapshot`
- `SessionShareSnapshot`
- `ExtensionWidgetSnapshot`
- image commands
- export/share commands
- artifact commands
- image/export/share/artifact errors

**Step 2: Run the contract test and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected:

- Fails because schemas and tagged requests are not yet defined.

**Step 3: Implement the schemas**

Add:

```ts
export const SessionExportResultSnapshot = Schema.Union(
	Schema.Struct({ status: Schema.Literal("exported"), artifact: SessionExportSnapshot }),
	Schema.Struct({
		status: Schema.Literal("cancelled"),
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		format: Schema.Literal("html", "jsonl"),
	}),
);
```

Add `confirmed: Schema.Literal(true)` to `SessionShare`.

**Step 4: Run contract tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
```

Expected:

- Contract tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/contracts packages/gui/test/contracts/contracts.test.ts
git commit -m "feat(gui): add desktop media and sharing contracts"
```

### Task 2: Add Main-Owned Artifact Registry

**Files:**

- Create: `packages/gui/src/main/artifacts/artifact-service.ts`
- Modify: `packages/gui/src/main/ipc-router.ts`
- Test: `packages/gui/test/main/artifacts/artifact-service.test.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write failing artifact service tests**

Cover:

- file artifact open
- file artifact reveal
- external artifact open
- missing artifact
- wrong artifact kind
- shell failure wrapping
- invalid external URL rejection

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/artifact-service.test.ts
```

Expected:

- Fails because `ArtifactService` does not exist.

**Step 3: Implement `ArtifactService`**

Implement:

- `trackFile(path): artifactId`
- `trackExternal(url): artifactId`
- `open(artifactId)`
- `reveal(artifactId)`
- `openExternal(artifactId)`

Use Electron shell only in main wiring. Keep tests on an injected shell adapter.

**Step 4: Route IPC commands**

In `ipc-router.ts`, route:

- `artifact.open`
- `artifact.reveal`
- `artifact.openExternal`

**Step 5: Run tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/artifact-service.test.ts test/main/ipc-router.test.ts
```

Expected:

- Artifact service and IPC tests pass.

**Step 6: Commit**

```bash
git add packages/gui/src/main/artifacts/artifact-service.ts packages/gui/src/main/ipc-router.ts packages/gui/test/main/artifacts/artifact-service.test.ts packages/gui/test/main/ipc-router.test.ts
git commit -m "feat(gui): add tracked desktop artifacts"
```

### Task 3: Add Main-Owned Image Attachment Service

**Files:**

- Create: `packages/gui/src/main/composer/image-attachment-service.ts`
- Modify: `packages/gui/src/main/ipc-router.ts`
- Modify: `packages/gui/src/main/settings/settings-bridge-service.ts`
- Test: `packages/gui/test/main/composer/image-attachment-service.test.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write failing image service tests**

Cover:

- selected image success
- unsupported MIME
- blocked images
- too many pending attachments
- oversized source file
- clipboard image success
- empty clipboard failure
- remove
- clear
- consume
- consume-for-send block recheck

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/composer/image-attachment-service.test.ts
```

Expected:

- Fails because the service does not exist.

**Step 3: Implement service state**

Keep pending attachments in main memory:

```ts
private readonly attachmentsBySession = new Map<string, StoredImageAttachment[]>();
```

Store full image base64 only in main. Return preview snapshots to renderer.

**Step 4: Implement limits**

Use:

```ts
export const MAX_ATTACHMENTS_PER_SESSION = 8;
export const MAX_IMAGE_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_SESSION_IMAGE_SOURCE_BYTES = 100 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 512 * 1024;
export const MAX_PREVIEW_DIMENSION = 512;
```

Use `stat()` before reading files.

**Step 5: Implement preview generation**

Use Pi image resize utilities:

```ts
await resizeImage(buffer, mimeType, {
	maxWidth: MAX_PREVIEW_DIMENSION,
	maxHeight: MAX_PREVIEW_DIMENSION,
	maxBytes: MAX_PREVIEW_BYTES,
});
```

**Step 6: Wire Electron file picker and clipboard**

In `registerGuiIpcHandlers()`:

- `dialog.showOpenDialog(...)`
- `clipboard.readImage()`
- `nativeImage.toPNG()` through Electron image object

Renderer never receives raw filesystem authority.

**Step 7: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/composer/image-attachment-service.test.ts test/main/ipc-router.test.ts
```

Expected:

- Image service and IPC tests pass.

**Step 8: Commit**

```bash
git add packages/gui/src/main/composer/image-attachment-service.ts packages/gui/src/main/ipc-router.ts packages/gui/src/main/settings/settings-bridge-service.ts packages/gui/test/main/composer/image-attachment-service.test.ts packages/gui/test/main/ipc-router.test.ts
git commit -m "feat(gui): add main-owned image attachments"
```

### Task 4: Send Images Through Runtime Driver

**Files:**

- Modify: `packages/gui/src/main/session/session-driver.ts`
- Modify: `packages/gui/src/main/session/pi-sdk-session-driver.ts`
- Modify: `packages/gui/src/main/session/fake-session-driver.ts`
- Modify: `packages/gui/src/main/session/session-supervisor.ts`
- Create: `packages/gui/src/main/session/session-attachments.ts`
- Test: `packages/gui/test/main/session/session-supervisor.test.ts`

**Step 1: Write failing supervisor tests**

Cover:

- selected attachment IDs are consumed before send
- `ImageContent[]` reaches the driver
- `consumeForSend()` is preferred over plain `consume()`
- send-time image block recheck prevents sending stale attachments

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
```

Expected:

- Fails because runtime send does not accept image content.

**Step 3: Extend driver request type**

Add:

```ts
images?: ImageContent[];
```

to runtime send request types.

**Step 4: Update SDK driver**

Call:

```ts
session.prompt(message, { images, streamingBehavior, source: "rpc", preflightResult });
```

when image payloads are present.

**Step 5: Update supervisor**

Resolve attachments before calling driver send:

```ts
const images = await consumeSessionImages(this.imageAttachmentService, workspaceId, sessionId, attachmentIds);
```

Pass images to prompt, steer, and follow-up sends.

**Step 6: Run supervisor tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
```

Expected:

- Supervisor tests pass.

**Step 7: Commit**

```bash
git add packages/gui/src/main/session packages/gui/test/main/session/session-supervisor.test.ts
git commit -m "feat(gui): send image attachments through Pi sessions"
```

### Task 5: Add Session Export

**Files:**

- Modify: `packages/gui/src/main/session/session-driver.ts`
- Modify: `packages/gui/src/main/session/pi-sdk-session-driver.ts`
- Modify: `packages/gui/src/main/session/fake-session-driver.ts`
- Modify: `packages/gui/src/main/session/session-supervisor.ts`
- Create: `packages/gui/src/main/session/session-export.ts`
- Modify: `packages/gui/src/main/ipc-router.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`
- Test: `packages/gui/test/main/session/session-supervisor.test.ts`

**Step 1: Write failing export tests**

Cover:

- HTML export calls Pi session export.
- JSONL export calls Pi session export.
- export is blocked while session is busy.
- export result includes tracked artifact ID.
- cancelled save dialog returns typed `cancelled` result.

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts test/main/session/session-supervisor.test.ts
```

Expected:

- Fails because export routes are missing.

**Step 3: Add driver export method**

Add `exportSession(handle, request)` to `SessionDriver`.

**Step 4: Implement SDK export**

Use Pi session export APIs through the runtime package. Keep narrow exports in `@earendil-works/pi-coding-agent/runtime` if needed.

**Step 5: Implement supervisor export**

Move the busy-state check and artifact tracking into `session-export.ts` so `SessionSupervisor` stays focused.

**Step 6: Implement IPC route**

In `ipc-router.ts`:

- if `outputPath` is omitted, use `dialog.showSaveDialog`
- if save dialog is cancelled, return `{ status: "cancelled", workspaceId, sessionId, format }`
- otherwise call `sessionSupervisor.exportSession(...)`
- return `{ status: "exported", artifact }`

**Step 7: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts test/main/session/session-supervisor.test.ts
```

Expected:

- Export tests pass.

**Step 8: Commit**

```bash
git add packages/gui/src/main/session packages/gui/src/main/ipc-router.ts packages/gui/test/main/ipc-router.test.ts packages/gui/test/main/session/session-supervisor.test.ts
git commit -m "feat(gui): add session export artifacts"
```

### Task 6: Add GitHub Gist Share

**Files:**

- Create: `packages/gui/src/main/artifacts/share-service.ts`
- Modify: `packages/gui/src/main/ipc-router.ts`
- Test: `packages/gui/test/main/artifacts/share-service.test.ts`
- Test: `packages/gui/test/main/ipc-router.test.ts`

**Step 1: Write failing share tests**

Cover:

- successful share checks `gh auth status`
- successful share exports HTML to temp file
- successful share runs `gh gist create <file>`
- successful share does not pass `--public=false`
- missing `gh` maps to `SessionShareUnavailable`
- unauthenticated `gh` maps to `SessionShareAuthFailed`
- gist failure maps to `SessionShareFailed`
- malformed gist URL maps to `SessionShareFailed`
- timeout maps to `SessionShareFailed`
- returned preview URL is tracked as an external artifact

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/share-service.test.ts
```

Expected:

- Fails because share service does not exist.

**Step 3: Implement share service**

Use:

```ts
gh auth status
gh gist create <tempHtmlFile>
```

Do not use `--public=false`; GitHub CLI secret gist is the default.

**Step 4: Add timeout and bounded output**

Use:

```ts
const SHARE_COMMAND_TIMEOUT_MS = 30_000;
const MAX_SHARE_COMMAND_OUTPUT_BYTES = 64 * 1024;
```

Kill the child process after timeout and return a typed failure.

**Step 5: Route IPC**

In `ipc-router.ts`, require decoded `SessionShare` command. The command already carries `confirmed: true`; malformed or unconfirmed payloads are rejected before routing.

**Step 6: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/share-service.test.ts test/main/ipc-router.test.ts
```

Expected:

- Share service and IPC tests pass.

**Step 7: Commit**

```bash
git add packages/gui/src/main/artifacts/share-service.ts packages/gui/src/main/ipc-router.ts packages/gui/test/main/artifacts/share-service.test.ts packages/gui/test/main/ipc-router.test.ts
git commit -m "feat(gui): add secret gist sharing"
```

### Task 7: Add Extension Widgets And Notifications

**Files:**

- Modify: `packages/gui/src/main/session/extension-host-ui-service.ts`
- Modify: `packages/gui/src/renderer/app/app-store.ts`
- Modify: `packages/gui/src/renderer/app/app-panels.tsx`
- Test: `packages/gui/test/main/session/extension-host-ui-service.test.ts`
- Test: `packages/gui/test/renderer/app-panels.test.tsx`

**Step 1: Write failing extension UI tests**

Cover:

- string widget payload splits on newlines
- string array widget payload is accepted
- empty widget clears the widget
- unsupported widget payload emits compatibility issue
- renderer displays widget lines as text
- renderer never renders widget HTML
- notifications are session-scoped and bounded

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/extension-host-ui-service.test.ts test/renderer/app-panels.test.tsx
```

Expected:

- Fails because widgets are not implemented.

**Step 3: Implement main widget projection**

In `ExtensionHostUiService.setWidget()`:

- accept strings
- accept string arrays
- split strings by newline
- clear empty content
- reject unsupported payloads with compatibility issue events

**Step 4: Implement renderer projection**

In renderer store and panels:

- add `widgets` to extension UI session state
- render widget lines as plain text
- keep notification and compatibility issue logs compact

**Step 5: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/session/extension-host-ui-service.test.ts test/renderer/app-panels.test.tsx
```

Expected:

- Extension UI tests pass.

**Step 6: Commit**

```bash
git add packages/gui/src/main/session/extension-host-ui-service.ts packages/gui/src/renderer/app packages/gui/test/main/session/extension-host-ui-service.test.ts packages/gui/test/renderer/app-panels.test.tsx
git commit -m "feat(gui): render safe extension widgets"
```

### Task 8: Add Renderer Composer And Artifact UX

**Files:**

- Modify: `packages/gui/src/renderer/app/App.tsx`
- Modify: `packages/gui/src/renderer/app/app-panels.tsx`
- Modify: `packages/gui/src/renderer/app/app-store.ts`
- Create: `packages/gui/src/renderer/app/desktop-artifacts-store.ts`
- Modify: `packages/gui/src/renderer/app/app-result-appliers.ts`
- Modify: `packages/gui/src/renderer/styles/app.css`
- Test: `packages/gui/test/renderer/app-panels.test.tsx`
- Test: `packages/gui/test/renderer/app-store.test.ts`
- Test: `packages/gui/test/renderer/command-palette.test.tsx`
- Test: `packages/gui/test/renderer/tree-navigator.test.tsx`
- Test: `packages/gui/test/renderer/catalog-view.test.tsx`

**Step 1: Write failing renderer tests**

Cover:

- image buttons call store actions
- image previews render
- remove image calls store action
- attachment-only send is allowed
- blocked images disable image buttons
- blocked images clear stale attachments
- export/share buttons call store actions
- export/share pending state disables duplicate actions
- share command includes `confirmed: true`
- export `cancelled` result is a no-op
- export `exported` result stores artifact snapshot

**Step 2: Run renderer tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-panels.test.tsx test/renderer/app-store.test.ts
```

Expected:

- Fails because renderer state/actions/UI are missing.

**Step 3: Add store slice**

Create `desktop-artifacts-store.ts` with:

- image attachment command actions
- export command action
- share command action
- artifact open/reveal/openExternal command actions
- per-session export/share pending and error state

**Step 4: Add result appliers**

In `app-result-appliers.ts`:

- decode image attachment list snapshots
- decode export result snapshots
- store only exported artifact results
- treat cancelled export results as no-op
- decode share snapshots

**Step 5: Add UI**

In `App.tsx` and `app-panels.tsx`:

- render composer attachment controls
- render attachment preview strip
- clear stale attachments when image blocking is enabled
- render export/share actions
- render per-session operation status
- route open/reveal/open share through artifact IDs

**Step 6: Run renderer tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-panels.test.tsx test/renderer/app-store.test.ts
```

Expected:

- Renderer tests pass.

**Step 7: Commit**

```bash
git add packages/gui/src/renderer/app packages/gui/src/renderer/styles/app.css packages/gui/test/renderer
git commit -m "feat(gui): add image export and share controls"
```

### Task 9: Keep Large Files Below Threshold

**Files:**

- Modify: `packages/gui/src/renderer/app/app-store.ts`
- Create: `packages/gui/src/renderer/app/desktop-artifacts-store.ts`
- Modify: `packages/gui/src/main/session/session-supervisor.ts`
- Create: `packages/gui/src/main/session/session-attachments.ts`
- Create: `packages/gui/src/main/session/session-export.ts`
- Create: `packages/gui/src/main/session/session-supervisor-utils.ts`

**Step 1: Check file sizes**

Run:

```bash
wc -l packages/gui/src/renderer/app/app-store.ts packages/gui/src/main/session/session-supervisor.ts
```

Expected:

- Both files are under 1,000 lines after extraction.

**Step 2: Extract renderer desktop artifact actions**

Move image/export/share/artifact action creation into `desktop-artifacts-store.ts`.

**Step 3: Extract supervisor helpers**

Move image consumption, export logic, and pure helper utilities into focused modules.

**Step 4: Run package check**

Run:

```bash
npm --prefix packages/gui run check
```

Expected:

- Format, lint, typecheck, and GUI tests pass.

**Step 5: Commit**

```bash
git add packages/gui/src/renderer/app packages/gui/src/main/session
git commit -m "refactor(gui): split desktop artifact and session helpers"
```

### Task 10: Remove Internal Planning Labels

**Files:**

- Modify: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Search staged GUI files**

Run:

```bash
git grep --cached -n -E "phase[0-9]|Phase[0-9]|Phase [0-9]|phase [0-9]|phase content" -- packages/gui/src packages/gui/test packages/coding-agent/src/runtime.ts
```

Expected:

- No output.

**Step 2: Rename behavior test labels**

Use product-facing test names, for example:

```ts
test("decodes rich desktop attachment export and share snapshots and errors", async () => {
	// ...
});
```

**Step 3: Repeat the staged scan**

Run:

```bash
git grep --cached -n -E "phase[0-9]|Phase[0-9]|Phase [0-9]|phase [0-9]|phase content" -- packages/gui/src packages/gui/test packages/coding-agent/src/runtime.ts
```

Expected:

- No output.

**Step 4: Commit**

```bash
git add packages/gui/test/contracts/contracts.test.ts
git commit -m "test(gui): remove internal planning labels"
```

### Task 11: Validate The Whole Package

**Files:**

- All changed GUI files.

**Step 1: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/composer/image-attachment-service.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/share-service.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/artifact-service.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-panels.test.tsx
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
- `oxlint` passes with no warnings.
- `tsgo --noEmit -p tsconfig.json` passes.
- GUI Vitest suite passes.

**Step 3: Run root check**

Run:

```bash
npm run check
```

Expected:

- Biome root check passes.
- pinned dependency check passes.
- TypeScript import check passes.
- shrinkwrap check passes.
- root `tsgo --noEmit` passes.
- browser smoke check passes.
- GUI check passes.

**Step 4: Commit**

```bash
git add packages/coding-agent/src/runtime.ts packages/gui/src packages/gui/test
git commit -m "feat(gui): add native image attachments export and share"
```

### Task 12: Fix Remaining Review Finding Before Merge

**Files:**

- Modify: `packages/gui/src/contracts/snapshots.ts`
- Modify: `packages/gui/src/main/artifacts/artifact-service.ts`
- Test: `packages/gui/test/main/artifacts/artifact-service.test.ts`
- Test: `packages/gui/test/contracts/contracts.test.ts`

**Step 1: Write failing URL allow-list tests**

Add tests that reject:

```ts
service.trackExternal("https://example.com/not-owned");
```

and reject share snapshots with:

```ts
previewUrl: "https://example.com/session/#abc123";
```

**Step 2: Run tests and verify failure**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/artifact-service.test.ts test/contracts/contracts.test.ts
```

Expected:

- Tests fail because the current preview URL helper accepts any HTTPS URL.

**Step 3: Tighten allowed preview URL validation**

Restrict share preview URLs to the Pi share viewer base. The default is:

```ts
https://pi.dev/session/
```

If runtime configuration supports `PI_SHARE_VIEWER_URL`, validate against the exact configured base in main before tracking the URL.

**Step 4: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/artifact-service.test.ts test/contracts/contracts.test.ts
```

Expected:

- URL allow-list tests pass.

**Step 5: Run full validation**

Run:

```bash
npm --prefix packages/gui run check
npm run check
```

Expected:

- Both checks pass with no warnings.

**Step 6: Commit**

```bash
git add packages/gui/src/contracts/snapshots.ts packages/gui/src/main/artifacts/artifact-service.ts packages/gui/test/main/artifacts/artifact-service.test.ts packages/gui/test/contracts/contracts.test.ts
git commit -m "fix(gui): restrict external artifact URLs"
```

## Verification

Current staged implementation was verified with:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/contracts/contracts.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/composer/image-attachment-service.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/share-service.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/artifact-service.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/ipc-router.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/main/session/session-supervisor.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-store.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/renderer/app-panels.test.tsx
```

Focused tests passed.

Package check:

```bash
npm --prefix packages/gui run check
```

Passed:

- Oxfmt format check.
- Oxlint.
- GUI package typecheck.
- GUI Vitest suite: 39 files, 248 tests.

Root check:

```bash
npm run check
```

Passed:

- Biome root check.
- pinned dependency check.
- TypeScript relative import check.
- shrinkwrap check.
- root `tsgo --noEmit`.
- browser smoke check.
- GUI package check.

Staged whitespace check:

```bash
git diff --cached --check
```

Passed.

Internal planning label scan:

```bash
git grep --cached -n -E "phase[0-9]|Phase[0-9]|Phase [0-9]|phase [0-9]|phase content" -- packages/gui/src packages/gui/test packages/coding-agent/src/runtime.ts
```

Passed with no output.

File size check:

```bash
wc -l packages/gui/src/renderer/app/app-store.ts packages/gui/src/main/session/session-supervisor.ts
```

Result:

```text
984 packages/gui/src/renderer/app/app-store.ts
982 packages/gui/src/main/session/session-supervisor.ts
```

## Review Notes

### Completed Review Fixes

- Export cancel is now typed as `{ status: "cancelled" }` rather than `ok: true` with `undefined` data.
- Share confirmation is now part of the typed IPC command through `confirmed: true`.
- Image attachment limits prevent unbounded pending file count, per-file size, session total size, and preview size.
- GitHub gist creation uses secret-default `gh gist create <file>` instead of `--public=false`.
- Share subprocess execution has timeout and bounded output.
- `app-store.ts` and `session-supervisor.ts` are below the maintainability threshold.
- Staged GUI source/tests no longer contain internal planning labels.
- Renderer uses per-session export/share pending and error state.

### Open Review Finding Before Commit

External artifact URL validation is still broader than intended.

Current issue:

- `isAllowedExternalArtifactUrl()` allows any HTTPS URL through `isAllowedSharePreviewUrlString()`.
- `ArtifactService.trackExternal()` stores any URL that passes this helper.
- A future caller could track and open `https://example.com/...`.

Required fix:

- Restrict preview URLs to the Pi share-viewer base, or validate against the exact configured share-viewer base in Electron main.
- Add tests rejecting arbitrary HTTPS URLs.

## Final Commit Recommendation

Use a product-facing Conventional Commit without internal phase labels:

```text
feat(gui): add native image attachments, export, and share

- Add typed Effect Schema contracts for image attachments, export results, share snapshots, artifact commands, and rich extension widgets.
- Route desktop-only capabilities through Electron main with narrow IPC commands for image picking, clipboard paste, export open/reveal, and share link opening.
- Add session-scoped image attachment handling with MIME validation, block-image enforcement, send-time consumption, size/count caps, and bounded previews.
- Add HTML/JSONL export and GitHub secret gist sharing through Pi runtime APIs, typed cancellation/failure states, and tracked artifact IDs.
- Render attachment previews, export/share actions, session notifications, compatibility issues, and plain-text extension widgets in the React GUI.
- Split renderer artifact actions and session helper modules to keep large orchestration files below the maintainability threshold.
- Cover contracts, IPC routes, artifact/share services, image attachment limits, supervisor image sends, and renderer export/share state with focused tests.
```

Do not commit with this message until the external artifact URL allow-list review finding is fixed.

## Deferred

- OS notifications.
- Rich custom extension renderer components.
- Persistent attachment cache.
- Full artifact manager.
- Cloud sharing providers beyond GitHub gist.
- Packaged release/signing work.
- Electron E2E updates for all export/share happy paths.

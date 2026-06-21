# Pi-Native GUI Feature List

Date: 2026-06-17

Document type: Explanation and planning reference.

Audience: Pi maintainers and contributors planning a first-party desktop GUI package.

Goal: Define the feature set for a Pi-native desktop app that combines a minimal Pi host with TUI parity over time, while staying simple, extensible, and aligned with Pi's architecture.

Related research: `docs/plans/2026-06-17-pi-native-gui-reference-research.md`

## Product Position

Pi GUI should be a native desktop host for Pi, not a new agent platform.

The app combines two goals:

1. Minimal Pi Host: a focused desktop shell for Pi sessions, session navigation, prompt execution, extension UI, model/settings, and clean transcript rendering.
2. TUI Parity: desktop equivalents for the important interactive Pi flows: `/resume`, `/tree`, `/settings`, `/trust`, `/compact`, `/share`, extensions, and custom UI compatibility.

The product principle is "no compromise, but no pile-on." TUI parity is required for the full product, but it should arrive through deliberate phases. P0 should prove the architecture and deliver a usable core. P1 should make the GUI a serious replacement host for most TUI workflows. P2 should add heavier workbench features only after the Pi-native base is stable.

## Design Philosophy

Pi's GUI should feel like Pi with a window.

The default screen should be immediately useful:

- choose a workspace
- choose or create a session
- type a prompt
- watch Pi work
- continue, steer, branch, compact, or resume without leaving the app

The UI should avoid dashboards, decorative landing pages, large marketing surfaces, and unrelated IDE features. It should be quiet, dense enough for repeated work, and minimal enough that Pi's transcript and extensions remain the focus.

Core design rules:

- Session-first: everything starts from a workspace and session.
- Transcript truth stays with Pi session files.
- The app stores navigation metadata, not duplicate conversation truth.
- Extension UI is a first-class product surface.
- Advanced features should appear through context, not permanent clutter.
- Every privileged action crosses a typed, validated Electron boundary.
- Every phase has explicit non-goals.

## Architecture Principles Behind The Feature List

### SDK-First Runtime

The first runtime adapter should be `PiSdkSessionDriver` running in Electron main. The renderer should speak only to typed GUI commands and events. It should not import `@earendil-works/pi-coding-agent` or know whether the backend is the SDK, RPC, or a future WebSocket server.

Future adapters are allowed, but they are not P0:

- `PiRpcSessionDriver` for subprocess isolation if needed.
- `PiWsSessionDriver` if Pi later ships an official local WebSocket server.

### Effect Schema Contracts

Effect Schema is part of the feature set, not only implementation detail.

Every command, event, catalog entry, settings snapshot, extension UI request, and test receipt should have a schema. Renderer-to-main commands should be shaped as tagged requests with success and failure schemas. Main-to-renderer events should be tagged event unions. Errors should be serializable, specific, and user-actionable.

### Secure Electron Host

The desktop shell must use secure Electron defaults:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- preload bridge through `contextBridge`
- no raw `ipcRenderer` exposed to the renderer
- no unvalidated renderer payloads reaching filesystem, shell, auth, or Pi runtime APIs

### Deep Modules And Real Seams

The package should avoid shallow pass-through modules. A module earns its place when it gives callers leverage behind a small interface and keeps implementation details local.

Important seams:

- Session driver seam: GUI commands to Pi runtime behavior.
- IPC router seam: renderer commands to privileged main handlers.
- Catalog seam: GUI navigation metadata to persisted JSON.
- Extension host UI seam: Pi extension UI primitives to desktop UI.
- Runtime supervisor seam: workspace-scoped Pi settings, resources, auth, and models.

## P0: Usable Minimal Pi Host

P0 proves the desktop app is a secure, typed, SDK-backed Pi host. It should be small enough to ship, but complete enough that a developer can use it for a real single-session task.

### P0 Outcome

A user can open the app, add a workspace, create or open a Pi session, send prompts, see streaming responses and tool activity, cancel a run, change model/thinking settings, handle basic extension UI prompts, quit, reopen, and continue the same session.

### P0 Feature Areas

#### 1. Desktop Shell

Required:

- Electron app under a first-party Pi GUI package.
- Main, preload, and renderer split.
- Single main window.
- Secure `BrowserWindow` configuration.
- Strict preload bridge exposing only typed GUI methods.
- Basic menu items for new session, open workspace, settings, reload, and quit.
- App bootstrap state with loading, ready, and failure views.

Acceptance:

- Renderer cannot access Node.js APIs directly.
- Renderer cannot call arbitrary IPC channels.
- A failed bootstrap produces a typed error view, not a blank window.

Non-goals:

- Auto-update flow.
- Code signing and notarization automation.
- Multiple windows.

#### 2. Typed Contracts

Required:

- Effect Schema contract module for IDs, commands, events, snapshots, catalog entries, settings snapshots, extension UI requests, and errors.
- Branded IDs for workspace, session, run, request, and event identities.
- Tagged command/request schemas for renderer-to-main calls.
- Tagged event schemas for main-to-renderer pushes.
- Specific serializable errors for validation, missing workspace, missing session, runtime startup failure, session busy, session operation failure, and unsupported extension UI.

Acceptance:

- Invalid IPC payloads are rejected before reaching service logic.
- Command failures preserve structured error details across IPC.
- Contract tests cover decode success and failure.

Non-goals:

- Public external protocol stability.
- Generated SDK for third-party consumers.

#### 3. Workspace Catalog

Required:

- Add workspace by folder picker.
- Remove workspace from GUI catalog without deleting files.
- Select workspace.
- Persist recent workspaces, display name, path, last opened time, and ordering.
- Detect missing workspace path and show a recoverable state.
- Sync known sessions for a workspace from Pi session storage.

Acceptance:

- Workspace metadata is persisted in a GUI-owned catalog.
- Malformed catalog files are reported and recoverable.
- Pi session files remain untouched by workspace catalog changes.

Non-goals:

- Worktrees.
- Remote workspaces.
- Workspace search across all filesystem paths.

#### 4. Session Catalog

Required:

- Create session in selected workspace.
- Open existing session.
- Rename session.
- Archive/unarchive session in GUI catalog.
- Display session title, status, updated time, preview snippet, and optional session file path.
- Rebuild missing catalog entries from Pi session files where practical.

Acceptance:

- Session list is useful after app restart.
- Session catalog stores pointers and metadata, not full transcript history.
- Deleting or archiving in the GUI does not silently delete Pi transcript files.

Non-goals:

- Permanent deletion.
- Cross-workspace global session search.
- Full transcript indexing.

#### 5. Active Session Runtime

Required:

- SDK-backed `PiSdkSessionDriver`.
- `SessionSupervisor` in Electron main.
- One focused active session at a time.
- Create and bind `AgentSessionRuntime`.
- Rebind subscriptions after runtime session replacement.
- Dispose runtime on close.
- Abort current run.

Acceptance:

- A real Pi prompt runs through the SDK.
- Runtime events stream into the renderer through typed events.
- Closing a session does not leave active listeners or orphaned prompts.

Non-goals:

- Background concurrent sessions.
- Runtime adapter registry beyond SDK.
- WebSocket server wrapper.

#### 6. Transcript And Timeline

Required:

- Render user messages.
- Render streaming assistant text.
- Render completed assistant messages.
- Render tool start, update, result, and failure rows.
- Render model/thinking changes if present in session history.
- Render compact, readable error rows.
- Restore transcript from Pi session state after reopening.

Acceptance:

- A user can understand what Pi is doing without reading raw JSONL.
- Tool activity is visible but not noisy by default.
- Timeline updates in order for the active session.

Non-goals:

- Full custom renderer API for extension-defined transcript rendering.
- Rich diff visualization.
- Full cost/token analytics dashboard.

#### 7. Composer

Required:

- Multi-line text input.
- Submit prompt.
- Cancel active run.
- Show current session status.
- Disable or redirect submit when session is busy.
- Support explicit delivery mode when busy: steer or follow-up.
- Preserve draft when switching settings views.

Acceptance:

- Prompt submission maps to Pi `prompt`.
- Busy-session submission requires user intent.
- Cancel maps to Pi abort semantics.

Non-goals:

- Image attachments.
- File attachments.
- Slash command palette.
- Voice input.

#### 8. Model And Thinking Controls

Required:

- Show current provider/model.
- Show current thinking level.
- Change model for the active session.
- Change thinking level for the active session.
- Show auth/model errors from Pi in a structured way.

Acceptance:

- Controls reflect the current Pi session state.
- Model changes persist through Pi session mechanisms where applicable.
- Missing credentials produce clear guidance.

Non-goals:

- Full provider account management.
- Model marketplace.
- Usage/billing dashboards.

#### 9. Basic Settings

Required:

- Show global and project settings entry points.
- Display default provider/model/thinking summary.
- Display project trust status.
- Display enabled skill commands status.
- Open settings files in the system editor or file manager through safe main-process commands.

Acceptance:

- User can inspect where Pi settings come from.
- GUI does not create a parallel settings model for Pi-owned settings.

Non-goals:

- Complete settings editor.
- Package install/uninstall UI.
- Theme editor.

#### 10. Extension UI Bridge, Basic

Required:

- Implement desktop host behavior for:
  - `confirm`
  - `input`
  - `select`
  - `notify`
  - `setStatus`
  - `setTitle`
  - `setEditorText`
  - `getEditorText`
  - `editor`
- Emit typed compatibility issue events for unsupported TUI-only features.
- Track pending extension UI requests per session.
- Resolve or cancel pending requests when a session closes.

Acceptance:

- A permission-gate extension using confirm can work in the GUI.
- Extension prompts are session-scoped and cannot bleed into another session.
- Unsupported custom UI is explicit, not silent.

Non-goals:

- Full `ctx.ui.custom()` React hosting.
- Raw terminal input support.
- Custom editor component replacement.

#### 11. Minimal Visual Design

Required:

- Three primary regions:
  - narrow workspace/session sidebar
  - main timeline
  - composer/status area
- Quiet typography and restrained color.
- No landing page.
- No decorative dashboard.
- Dense but readable session list.
- Tool rows visually subordinate to messages.
- Keyboard-friendly focus order.

Acceptance:

- First screen is the app, not marketing.
- Core workflow is visible without onboarding text.
- UI remains legible on a normal laptop window.

Non-goals:

- Highly animated interface.
- Theme marketplace.
- Heavy illustrations.

#### 12. P0 Tests And Proof

Required:

- Contract decode tests.
- IPC invalid-payload tests.
- Driver smoke test with fixture workspace.
- Electron E2E:
  - launch
  - add workspace
  - create session
  - send prompt
  - observe streaming event
  - complete run
  - quit and reopen session
- Receipt events for deterministic waits:
  - bootstrap completed
  - workspace synced
  - session opened
  - prompt accepted
  - run completed

Acceptance:

- No sleep-based E2E waits for runtime completion.
- The app is proven through the real Electron surface.

Non-goals:

- Full packaged release matrix.
- Live provider matrix.

## P1: TUI Parity Host

P1 makes the desktop app a serious alternative host for most interactive Pi workflows. It should preserve the minimal shell while adding the flows that make Pi powerful in the terminal.

### P1 Outcome

A user can do most routine TUI session work in the GUI: resume, branch, compact, trust, configure settings, use slash commands, queue messages, manage skills/extensions, handle richer extension UI, and run more than one session without event bleed.

### P1 Feature Areas

#### 1. Background Sessions

Required:

- Multiple known sessions can be open at once.
- More than one session can run concurrently.
- Selected session state is separate from runtime state.
- Sidebar shows per-session status.
- Background sessions stream events into their own records.
- User can switch sessions while another run continues.

Acceptance:

- Session A can run while Session B is focused.
- Events from Session A never update Session B.
- Background completion is visible without stealing focus.

Non-goals:

- Unlimited concurrency.
- Remote session sharing.

#### 2. Queue And Delivery UI

Required:

- Show queued steering messages.
- Show queued follow-up messages.
- Replace or remove queued messages where Pi supports it.
- Make steer vs follow-up explicit when submitting during a run.
- Reflect Pi queue mode settings.

Acceptance:

- User can understand what will happen after the current turn.
- Queue UI maps to Pi semantics, not invented GUI-only behavior.

#### 3. Slash Commands And Command Palette

Required:

- Show Pi slash commands.
- Show extension commands.
- Show skill commands when enabled.
- Provide command palette from composer.
- Insert command templates or execute commands depending on Pi semantics.
- Surface command errors in the timeline.

Acceptance:

- Common TUI command workflows have a discoverable GUI equivalent.
- Extension commands execute through Pi, not through duplicated GUI code.

#### 4. `/resume` Equivalent

Required:

- Session picker for current workspace.
- Search sessions.
- Sort sessions.
- Filter named sessions.
- Rename from picker.
- Archive/unarchive from picker.
- Show session path when requested.

Acceptance:

- The GUI can replace the common `/resume` and `pi -r` workflow for a workspace.

Non-goals:

- Permanent delete unless moved to trash safely and explicitly.

#### 5. `/tree` Equivalent

Required:

- Tree view for current session.
- Navigate entries.
- Fold/unfold branch segments.
- Filter modes matching Pi concepts: default, no-tools, user-only, labeled-only, all.
- Select user message and place text into composer.
- Select assistant/tool/other entry and continue from that point.
- Label/unlabel entries if Pi API supports it cleanly.

Acceptance:

- User can branch in-place from a prior point.
- GUI respects Pi's active leaf model.
- Branch navigation does not corrupt session files.

Non-goals:

- A visual graph editor.
- Cross-session branch merging.

#### 6. Branch Summary Flow

Required:

- Prompt for branch summary when tree navigation needs it.
- Options:
  - no summary
  - default summary
  - custom focus instructions
- Show resulting summary entry in timeline.

Acceptance:

- GUI behavior matches Pi's branch summary semantics.

#### 7. `/compact` Equivalent

Required:

- Run manual compaction.
- Optional custom compaction instructions.
- Show compaction start/end events.
- Show compaction failure with typed error.
- Allow abort where Pi supports it.

Acceptance:

- User can manage long sessions without returning to TUI.

#### 8. `/trust` Equivalent

Required:

- Detect untrusted project-local resources.
- Show project trust prompt in GUI.
- Allow trust, distrust, and parent-folder trust where Pi supports it.
- Explain what trusting enables: settings, resources, package installs, project extensions.
- Persist decision through Pi trust mechanisms.

Acceptance:

- GUI does not silently load project-local executable resources.
- Trust decisions match Pi's trust model.

#### 9. Settings Editor, Focused

Required:

- Edit common settings:
  - default provider
  - default model
  - default thinking level
  - enabled models
  - enable skill commands
  - default project trust
  - compaction basics
  - image block/resize behavior
  - steering/follow-up mode
- Show whether a setting is global or project-local.
- Decode settings through Effect Schema before writing GUI-owned edits.
- Prefer Pi settings managers for Pi-owned writes.

Acceptance:

- User can perform common `/settings` tasks in the GUI.
- Advanced settings can still be opened as JSON.

Non-goals:

- Editing every possible Pi setting through bespoke controls.

#### 10. Skill And Extension Manager

Required:

- List discovered skills.
- List discovered extensions.
- Show source: global, project, package, explicit path.
- Enable/disable where Pi settings support it.
- Show load errors.
- Reload resources.
- Open skill/extension file location.

Acceptance:

- User can understand what is extending Pi in the current workspace.
- GUI does not invent a separate extension registry.

#### 11. Richer Extension UI Compatibility

Required:

- Render simple `setWidget` content in a desktop panel.
- Support extension notifications with session association.
- Support editor modal flows.
- Keep compatibility issue log per session.
- Provide a documented unsupported path for `ctx.ui.custom()` TUI components.

Acceptance:

- Extensions can be useful in GUI without being rewritten.
- Unsupported UI is understandable and actionable.

Non-goals:

- Arbitrary TUI component rendering in React.
- Extension-provided untrusted renderer code.

#### 12. Image Attachments

Required:

- Add image attachment to composer.
- Paste image from clipboard.
- Preview/remove image before send.
- Respect Pi image settings such as block images and auto-resize behavior.
- Send image through Pi prompt options.

Acceptance:

- Image flows use Pi SDK semantics.
- Attachment size/type errors are clear.

#### 13. Session Export And Share

Required:

- Export session to HTML where Pi supports it.
- Surface `/share` equivalent if the underlying Pi API is available and safe.
- Make network/upload action explicit.
- Show result link or file path.

Acceptance:

- User can perform common session sharing/export tasks without terminal commands.

Non-goals:

- New cloud sharing service.
- Account system.

#### 14. P1 Tests And Proof

Required:

- Two-session event isolation tests.
- Background session E2E.
- Tree navigation E2E.
- Trust prompt E2E.
- Settings write/read tests.
- Extension UI request/response tests.
- Queue behavior tests.
- Image attachment smoke test.

Acceptance:

- TUI parity workflows are tested through GUI seams, not mocked only at React level.

## P2: Advanced Desktop Workbench

P2 adds heavier desktop capabilities after the Pi-native host and TUI parity are proven. These features are valuable, but they should not distort P0 or P1.

### P2 Outcome

The app becomes a fuller desktop workbench for long-running agent work while still preserving Pi's minimal core and extension-first philosophy.

### P2 Feature Areas

#### 1. Worktree Catalog

Required:

- Show linked worktrees for a workspace.
- Create worktree.
- Remove worktree safely.
- Show branch, path, and status.
- Associate sessions with workspace/worktree context.

Acceptance:

- Worktrees help organize agent work without becoming a full Git client.

Non-goals:

- Full source control suite.
- PR management system.

#### 2. Integrated Terminal

Required:

- Workspace-scoped terminal panel.
- Multiple terminal sessions per workspace.
- Resize/write/close terminal.
- Preserve terminal title/status while app is open.
- Respect configured shell path where applicable.

Acceptance:

- Terminal is useful for adjacent manual commands.
- Terminal does not become required for basic Pi usage.

#### 3. Git And Diff Views

Required:

- Show changed files for current workspace.
- Show file diff.
- Stage/unstage selected files if safe.
- Surface Pi tool-created changes in context.

Acceptance:

- User can inspect agent changes without leaving the app.

Non-goals:

- Complete Git porcelain.
- Complex merge conflict editor.

#### 4. Notifications

Required:

- In-app notification center.
- Optional OS notifications for background session completion/failure.
- Notification preferences.
- Session-linked notification click behavior.

Acceptance:

- Long-running background sessions are observable without focus stealing.

#### 5. Diagnostics And Logs

Required:

- Runtime diagnostics view.
- Export logs.
- Show contract decode failures.
- Show extension compatibility issues.
- Show app/version/runtime info.

Acceptance:

- Maintainers can debug GUI issues without asking users for raw terminal spelunking.

#### 6. Packaged App Release Path

Required:

- Packaged app smoke tests.
- macOS signing/notarization plan.
- Linux packaging plan.
- Release artifact verification.
- Dependency and lockfile review process aligned with Pi rules.

Acceptance:

- A release candidate is tested as a real desktop app, not only through dev server.

#### 7. Optional Runtime Adapters

Required only if justified:

- `PiRpcSessionDriver` for subprocess isolation.
- `PiWsSessionDriver` for a future official Pi server.
- Driver contract compatibility tests.

Acceptance:

- Renderer and most UI state do not change when switching drivers.

#### 8. Custom Extension UI Host

Required only after compatibility design:

- A safe React-native extension UI contract.
- No execution of arbitrary extension renderer code.
- Explicit capability negotiation.
- Fallback compatibility issue when unsupported.

Acceptance:

- GUI can support richer extension UI without compromising security or simplicity.

## Cross-Phase Non-Goals

These should remain out of scope unless explicitly reopened:

- Replacing the Pi TUI.
- Forking Pi's runtime semantics.
- Duplicating transcript storage as the source of truth.
- Building a permanent custom WebSocket server before Pi has an official server need.
- Turning the GUI into a full IDE.
- Cloud account system.
- Extension marketplace.
- Arbitrary untrusted renderer plugins.
- Full provider billing/usage dashboard.
- Full GitHub/PR/review product.

## Scope Guardrails

Every proposed feature should answer:

1. Does this make Pi easier to use as a desktop host?
2. Does this preserve Pi's existing runtime/session/extension semantics?
3. Can this be implemented behind a typed seam?
4. Is this required for P0, P1, or P2?
5. What feature does this displace if we add it now?

Default decisions:

- If it is needed to run a real Pi session, it belongs in P0.
- If it is needed for normal TUI parity, it belongs in P1.
- If it is a desktop workbench enhancement, it belongs in P2.
- If it is a separate product surface, it is out of scope.

## Suggested Feature Priority Summary

| Feature | Phase | Reason |
| --- | --- | --- |
| Secure Electron shell | P0 | Required host foundation |
| Effect Schema contracts | P0 | Required safety and extensibility |
| SDK-backed session driver | P0 | Required Pi-native runtime |
| Workspace catalog | P0 | Required navigation |
| Session catalog | P0 | Required navigation |
| Prompt streaming | P0 | Required core use |
| Tool timeline | P0 | Required transparency |
| Basic extension UI | P0 | Required extensibility |
| Model/thinking controls | P0 | Required normal use |
| Resume picker | P1 | TUI parity |
| Tree navigation | P1 | TUI parity |
| Trust flow | P1 | TUI parity and safety |
| Settings editor | P1 | TUI parity |
| Skill/extension manager | P1 | Extensibility |
| Background sessions | P1 | Serious desktop workflow |
| Queue UI | P1 | Pi message semantics |
| Image attachments | P1 | Current Pi capability surfaced in GUI |
| Share/export | P1 | TUI parity |
| Worktrees | P2 | Workbench enhancement |
| Integrated terminal | P2 | Workbench enhancement |
| Git diff views | P2 | Workbench enhancement |
| Packaged release path | P2 | Distribution maturity |
| Future runtime adapters | P2 | Optional architecture evolution |

## Definition Of Done By Phase

### P0 Done

- A developer can complete a real single-session Pi task in the GUI.
- The app restarts and reopens the session.
- Basic extension prompts work.
- IPC and persistence boundaries are schema-validated.
- Real Electron E2E passes.

### P1 Done

- A developer can use the GUI for most routine TUI workflows.
- Resume, tree, trust, compact, settings, skills/extensions, and queue flows are represented.
- Background sessions are reliable and isolated.
- Extension compatibility is explicit and documented.

### P2 Done

- Desktop workbench features are available without bloating the default experience.
- Packaged app smoke tests prove release viability.
- Optional runtime adapters preserve the same renderer contract.

## Final Feature Direction

Build Pi GUI as a minimal desktop host first and a TUI-parity host second.

That means P0 should be small, real, and secure. P1 should deliver the TUI workflows that make Pi powerful. P2 should add heavier desktop workbench features only after the Pi-native center holds.

This gives Pi GUI a strong product identity: a simple desktop surface for a deeply extensible agent runtime.

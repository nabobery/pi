# Pi-Native GUI Implementation Phases

Date: 2026-06-18
Status: Draft for review
Companion doc: `docs/plans/2026-06-18-pi-native-gui-technical-plan.md`

## Purpose

This document turns the Pi-native GUI architecture plan into an execution plan. It breaks the work into reviewable technical phases, lists the tasks in each phase, defines acceptance gates, and records the linting/formatting decision to use `oxlint` and `oxfmt` for the GUI package.

The intended reader is a Pi contributor implementing the GUI in small pull requests.

## Implementation Principles

- Build a Pi-native host, not a separate agent runtime.
- Keep Pi as the source of truth for sessions, transcripts, settings, trust, extensions, and model behavior.
- Keep the GUI source of truth thin: workspace catalog, selected session, desktop read models, UI state.
- Use the Pi SDK in Electron main for P0/P1.
- Keep a protocol-shaped `SessionDriver` boundary so a future WebSocket/subprocess driver remains possible.
- Use Effect Schema at every IPC and persisted JSON boundary.
- Keep Electron secure by default: preload bridge, context isolation, sandbox, no renderer Node access.
- Keep the renderer a typed React client.
- Add functionality in vertical slices that prove real behavior through the app surface.
- Avoid P2 work until P0/P1 are stable.

## Tooling Decision: Oxlint And Oxfmt

The GUI package should use Oxc tooling:

- `oxlint` for linting.
- `oxfmt` for formatting.

Use this for `packages/gui` from the first implementation phase.

### Why

- The GUI will add React, Electron, Effect, and IPC-heavy TypeScript. Fast local feedback matters.
- `oxlint` gives a focused JS/TS lint lane and supports config files, safe fixes, warning failure, machine-readable output, and type-aware options.
- `oxfmt` gives a dedicated formatter with config files, `--check`, package JSON sorting, Tailwind sorting options, and editor/CI integration.
- Keeping GUI lint/format separate at first avoids forcing an immediate repo-wide Biome migration.

### Important Repo Constraint

The current root `biome.json` includes:

- `packages/*/src/**/*.ts`
- `packages/*/test/**/*.ts`

That means a new `packages/gui/src/**/*.ts` or `packages/gui/test/**/*.ts` file would currently be formatted and linted by Biome during root `npm run check`.

To actually use `oxlint` and `oxfmt` for GUI, Phase 1 must do one of these:

1. Recommended: exclude `packages/gui` from the root Biome include list and add package-local Oxc scripts.
2. Alternative: migrate the whole repo from Biome to Oxc in a dedicated tooling PR.

Do not mix Biome formatting and Oxfmt formatting on the same files. That will create churn and confusing review diffs.

### Initial GUI Tooling Shape

Add package-local dev dependencies, pinned exactly:

```json
{
  "devDependencies": {
    "oxfmt": "<exact-version>",
    "oxlint": "<exact-version>"
  }
}
```

Add package-local scripts:

```json
{
  "scripts": {
    "lint": "oxlint src test",
    "lint:fix": "oxlint --fix src test",
    "format": "oxfmt src test *.ts *.json",
    "format:check": "oxfmt --check src test *.ts *.json",
    "check": "npm run format:check && npm run lint && tsgo --noEmit -p tsconfig.json"
  }
}
```

Adjust paths once the actual package layout exists. Keep globs quoted when shell expansion could differ between environments.

Add `packages/gui/.oxlintrc.json`:

```json
{
  "$schema": "../../node_modules/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error",
    "suspicious": "error",
    "perf": "warn"
  },
  "plugins": ["react", "react-hooks", "typescript", "unicorn", "oxc"],
  "rules": {
    "typescript/no-explicit-any": "error"
  },
  "ignorePatterns": ["dist/**", "out/**", "node_modules/**"]
}
```

Add `packages/gui/.oxfmtrc.json`:

```json
{
  "$schema": "../../node_modules/oxfmt/configuration_schema.json",
  "useTabs": true,
  "tabWidth": 3,
  "printWidth": 120,
  "semi": true,
  "trailingComma": "all",
  "sortPackageJson": true,
  "ignorePatterns": ["dist/**", "out/**", "node_modules/**"]
}
```

The tab width and line width intentionally match the current root Biome style. This keeps GUI diffs visually consistent with the rest of Pi while still using Oxc.

### Root Check Integration

Phase 1 should add a root script such as:

```json
{
  "scripts": {
    "check:gui": "npm --prefix packages/gui run check"
  }
}
```

Then update root `check` later, after the GUI package has meaningful code:

```text
biome existing packages
check pinned deps
check imports
check shrinkwrap
tsgo root
browser smoke
check:gui
```

If root `tsgo --noEmit` already covers the GUI package through workspace configs, avoid duplicate expensive type checks. If it does not, keep the GUI package `tsgo` check.

## Phase Map

P0 phases:

- Phase 1: Tooling, package skeleton, secure shell.
- Phase 2: Effect Schema contracts and IPC bridge.
- Phase 3: Workspace catalog and session catalog.
- Phase 4: SDK session driver and session supervisor.
- Phase 5: Prompt loop, timeline, composer.
- Phase 6: Runtime controls, settings summary, trust status, basic extension UI.
- Phase 7: P0 hardening and proof.

P1 phases:

- Phase 8: Background sessions and queues.
- Phase 9: Slash commands and `/resume`.
- Phase 10: `/tree`, branch summary, and `/compact`.
- Phase 11: `/trust`, focused settings, skills/extensions.
- Phase 12: richer extension UI, images, export/share.
- Phase 13: P1 hardening and release readiness.

Deferred P2:

- worktrees, terminal, git/diff workbench, notifications, packaged release matrix, future remote runtime adapters, arbitrary custom extension UI host.

## Phase 1: Tooling, Package Skeleton, Secure Shell

Goal: create the GUI package and prove the desktop shell/tooling boundary before runtime complexity arrives.

### Tasks

- Add `packages/gui/package.json`.
- Add `packages/gui/CHANGELOG.md`.
- Add `packages/gui/tsconfig.json`.
- Add `packages/gui/tsconfig.build.json` if needed.
- Add `packages/gui/electron.vite.config.ts`.
- Add `packages/gui/index.html`.
- Add main, preload, and renderer entrypoints:
  - `src/main/main.ts`
  - `src/preload/index.ts`
  - `src/renderer/main.tsx`
- Add a minimal React shell with the intended three regions:
  - sidebar
  - timeline
  - composer/status
- Add `oxlint` and `oxfmt` package-local scripts and config.
- Exclude `packages/gui` from root Biome formatting/linting or otherwise prevent tool conflict.
- Add a root `check:gui` script.
- Add Electron secure `BrowserWindow` settings:
  - `nodeIntegration: false`
  - `contextIsolation: true`
  - `sandbox: true`
  - `webSecurity: true`
  - preload script configured
- Add window navigation and `window.open` guards.
- Add a placeholder preload API that does not expose raw Electron APIs.

### Output Files

- `packages/gui/package.json`
- `packages/gui/.oxlintrc.json`
- `packages/gui/.oxfmtrc.json`
- `packages/gui/electron.vite.config.ts`
- `packages/gui/src/main/main.ts`
- `packages/gui/src/preload/index.ts`
- `packages/gui/src/preload/window.d.ts`
- `packages/gui/src/renderer/main.tsx`
- `packages/gui/src/renderer/app/App.tsx`

### Acceptance Gate

- `npm --prefix packages/gui run format:check` passes.
- `npm --prefix packages/gui run lint` passes.
- `npm --prefix packages/gui run check` passes.
- The app launches a secure empty shell.
- Renderer cannot access Node globals.
- Preload exposes only a small typed API placeholder.
- No Pi runtime code is imported by renderer or preload.
- Root `npm run check` remains compatible with the new package.

### Review Boundary

This phase should not include real Pi sessions, catalogs, settings, or extension UI. It is a tooling and shell PR.

## Phase 2: Effect Schema Contracts And IPC Bridge

Goal: establish the durable GUI protocol before implementing business behavior.

### Tasks

- Add `src/contracts`.
- Define branded IDs:
  - `WorkspaceId`
  - `SessionId`
  - `RunId`
  - `RequestId`
  - `EventId`
  - `CatalogRevision`
  - `ExtensionUiRequestId`
- Define command schemas with Effect Schema.
- Define event schemas with Effect Schema.
- Define error schemas with tagged errors.
- Define snapshot/read-model schemas:
  - workspace snapshot
  - session snapshot
  - timeline snapshot
  - model/thinking snapshot
  - settings summary snapshot
  - extension UI request snapshot
- Add a single `pi-gui:invoke` IPC channel.
- Add a single typed event subscription path.
- Decode every renderer command in main using `Schema.decodeUnknown`.
- Return renderer-safe typed errors.
- Add sequence numbers to pushed events.
- Add receipt events for E2E readiness.

### Initial Commands

- `app.bootstrap`
- `app.rendererReady`
- `workspace.add`
- `workspace.select`
- `workspace.sync`
- `session.create`
- `session.open`
- `session.close`
- `session.sendMessage`
- `session.cancelRun`
- `session.setModel`
- `session.setThinkingLevel`
- `session.getTranscript`
- `extensionUi.respond`

### Initial Events

- `app.ready`
- `app.error`
- `receipt.emitted`
- `workspace.catalogUpdated`
- `session.catalogUpdated`
- `session.opened`
- `session.closed`
- `session.statusChanged`
- `timeline.messageDelta`
- `tool.started`
- `tool.updated`
- `tool.finished`
- `queue.updated`
- `run.started`
- `run.completed`
- `run.failed`
- `extensionUi.requested`
- `extensionUi.resolved`
- `extensionUi.compatibilityIssue`

### Tests

- Valid command decode.
- Invalid command tag rejection.
- Missing required payload rejection.
- Invalid branded ID rejection.
- IPC handler maps parse errors to `InvalidRendererCommand`.
- Renderer never receives raw thrown errors.

### Acceptance Gate

- Contracts are the only shared dependency between main/preload/renderer.
- Main decodes every IPC payload.
- Renderer commands are impossible to route without schema decode.
- Invalid payload tests pass.
- Receipt event type exists and is used by bootstrap.

### Review Boundary

This phase should keep handlers mostly stubbed. The purpose is boundary correctness, not full app behavior.

## Phase 3: Workspace Catalog And Session Catalog

Goal: let the GUI remember workspaces and discover Pi sessions without owning transcripts.

### Tasks

- Add `WorkspaceCatalogService`.
- Add catalog schemas:
  - workspace entry
  - session catalog entry
  - selected workspace/session state
  - archive/pin metadata
  - catalog revision
- Decide catalog path:
  - preferred desktop path: application support directory
  - alternative Pi-adjacent path: `~/.pi/gui/catalog.json`
- Implement catalog load/save with schema decode.
- Implement invalid catalog recovery:
  - preserve invalid file
  - emit diagnostic
  - start empty only after preserving user data
- Implement add/select/remove workspace.
- Implement workspace sync using Pi `SessionManager.list(cwd)`.
- Add session read-model projection:
  - title/name
  - first message/preview
  - modified time
  - session file path
  - parent session path
  - archived flag from GUI catalog
- Add renderer sidebar state.
- Add selected workspace/session persistence.

### Tests

- Catalog decode success.
- Catalog decode failure preserves invalid input.
- Workspace add persists.
- Workspace remove does not delete session files.
- Sync rebuilds sessions from `SessionManager.list`.
- Archive flag survives sync.

### Acceptance Gate

- User can add a workspace.
- Existing Pi sessions appear.
- User can select a session.
- Restart restores selected workspace/session metadata.
- GUI does not duplicate transcript entries.
- Catalog is rebuildable from Pi sessions plus GUI metadata.

### Review Boundary

This phase can open session metadata, but should not yet run prompts.

## Phase 4: SDK Session Driver And Session Supervisor

Goal: create/open real Pi sessions through the SDK and translate runtime lifecycle into GUI events.

### Tasks

- Add `SessionDriverService` interface.
- Add `PiSdkSessionDriver`.
- Add `RuntimeSupervisor`.
- Add `SessionSupervisor`.
- Integrate:
  - `createAgentSessionRuntime`
  - `createAgentSessionServices`
  - `createAgentSessionFromServices`
  - `SessionManager.create`
  - `SessionManager.open`
  - `SessionManager.continueRecent` only if needed
  - `AuthStorage`
  - `ModelRegistry`
- Create managed session records:
  - workspace ID
  - session ID
  - session file
  - runtime
  - active Pi session
  - status
  - listener cleanup
  - pending extension UI requests
  - event queue
- Bind session extensions after opening.
- Subscribe to Pi session events.
- Rebind subscriptions after runtime replacement.
- Dispose sessions on close.
- Emit session snapshot events.

### Session States

- `opening`
- `ready`
- `running`
- `cancelling`
- `replacing`
- `compacting`
- `closed`
- `failed`

### Tests

- Create session through driver.
- Open existing session through driver.
- Close disposes runtime.
- Runtime replacement rebinds subscriptions.
- Events include workspace/session IDs.
- Event lanes are ordered per session.

### Acceptance Gate

- GUI can create a real Pi session.
- GUI can open an existing Pi session.
- Session snapshot reaches renderer.
- Runtime replacement does not leave stale listeners.
- No renderer import of Pi SDK.

### Review Boundary

This phase proves runtime ownership and session lifecycle, but prompt streaming can remain minimal.

## Phase 5: Prompt Loop, Timeline, Composer

Goal: deliver the core Pi desktop loop: type a prompt, stream the response, see tools, cancel when needed.

### Tasks

- Implement `session.sendMessage`.
- Implement `session.cancelRun`.
- Map Pi prompt behavior:
  - idle prompt
  - steering during run
  - follow-up during run
  - rejection when not accepted
- Translate runtime events:
  - message start
  - text delta
  - thinking delta
  - tool start
  - tool update
  - tool end
  - queue update
  - run start
  - run complete
  - run failure
- Implement renderer event store using `useSyncExternalStore`.
- Implement timeline reducer/selectors.
- Render transcript snapshot.
- Render streaming assistant text.
- Render thinking blocks when present.
- Render tool rows.
- Render errors.
- Add composer draft state per session.
- Add send/cancel buttons.
- Add keyboard send.
- Add run receipts.

### Tests

- Prompt accepted receipt.
- Run started receipt.
- Text delta updates timeline.
- Tool events render in order.
- Run completed receipt.
- Cancel updates status.
- Session draft does not bleed between sessions.

### Acceptance Gate

- User can send a real Pi prompt.
- User can observe streaming output.
- User can see tool activity.
- User can cancel a run.
- Timeline is driven by typed events, not JSONL file scraping.
- E2E waits on receipts, not sleeps.

### Review Boundary

This is the first phase where the app should feel usable, but it should still avoid TUI parity extras.

## Phase 6: Runtime Controls, Settings Summary, Trust Status, Basic Extension UI

Goal: make the minimal host practical and preserve Pi extensibility.

### Tasks

- Implement model display.
- Implement model selector from available models.
- Implement thinking level display.
- Implement thinking level selector.
- Surface auth/model errors as typed errors.
- Add `SettingsBridgeService`.
- Show:
  - global settings path
  - project settings path
  - default provider/model/thinking
  - enabled skill command status
  - project trust status
- Add safe open/reveal settings file commands.
- Add `ExtensionHostUiService`.
- Support extension UI:
  - `confirm`
  - `input`
  - `select`
  - `notify`
  - `setStatus`
  - `setTitle`
  - `setEditorText`
  - `getEditorText`
  - `editor`
- Add unsupported extension UI compatibility issue events.
- Cancel pending extension UI requests when session closes/replaces.

### Tests

- Model selector reflects runtime state.
- Thinking selector updates runtime state.
- Missing auth maps to typed remediation error.
- Settings summary decodes.
- Trust status displays.
- Extension confirm request resolves.
- Extension input/select request resolves.
- Extension UI request cannot be answered from another session.
- Unsupported UI emits compatibility issue.

### Acceptance Gate

- User can inspect and change active model/thinking.
- User can inspect Pi settings/trust source.
- Basic extension UI works through GUI.
- Unsupported extension UI is explicit.

### Review Boundary

Do not build a full settings editor yet. Keep P0 to summaries and safe file entry points.

## Phase 7: P0 Hardening And Proof

Goal: make P0 credible enough to become the foundation for TUI parity.

### Tasks

- Add full P0 Electron E2E suite.
- Add restart/reopen test.
- Add app bootstrap receipt.
- Add workspace synced receipt.
- Add session opened receipt.
- Add prompt accepted/run completed receipts.
- Add diagnostics for:
  - IPC decode failures
  - catalog parse failures
  - runtime errors
  - extension compatibility issues
- Add import-boundary checks if existing repo scripts do not catch GUI violations.
- Update package README or docs if needed.
- Verify root `npm run check`.

### P0 E2E Scenarios

- Launch app.
- Add workspace.
- Sync workspace.
- Create session.
- Send prompt with faux provider or controlled test driver.
- Observe streaming/timeline update.
- Complete run.
- Quit.
- Reopen.
- Restore workspace/session.
- Extension confirm flow.

### Acceptance Gate

- P0 definition of done is satisfied.
- `npm --prefix packages/gui run check` passes.
- Root `npm run check` passes.
- No sleep-based runtime waits in E2E.
- No known Electron security regression.
- P0 is ready for internal use/review.

## Phase 8: Background Sessions And Queues

Goal: support concurrent Pi work without event bleed.

### Tasks

- Allow multiple open managed session records.
- Add selected session vs running session distinction.
- Add sidebar per-session status:
  - idle
  - running
  - queued
  - needs input
  - failed
  - completed
- Let background sessions stream into their own event lanes.
- Add unread/activity markers.
- Add per-session close/cancel.
- Add queue UI:
  - steering queue
  - follow-up queue
  - mode display
  - remove/replace only where Pi supports it
- Add practical concurrency limit if needed.

### Tests

- Session A runs while Session B is selected.
- Session A events do not mutate Session B timeline.
- Background completion updates sidebar.
- Queue updates stay session-scoped.
- Closing a background session disposes only that session.

### Acceptance Gate

- User can switch away from a running session.
- No event bleed.
- Queue semantics map to Pi behavior.

## Phase 9: Slash Commands And `/resume`

Goal: make common TUI command discovery and resume flows native in desktop.

### Tasks

- Add command palette.
- List built-in slash commands.
- List extension commands.
- List skill commands when enabled.
- Show command source and description.
- Execute or insert command templates based on Pi semantics.
- Add command errors as timeline rows.
- Add `/resume` equivalent picker:
  - current workspace sessions
  - all workspaces if supported cleanly
  - search
  - sort by threaded/recent/fuzzy
  - named filter
  - rename
  - archive/unarchive
  - path toggle

### Tests

- Built-in commands appear.
- Extension/skill commands appear with source metadata.
- Command execution routes through Pi.
- Resume search filters correctly.
- Rename persists through Pi/session manager.
- Archive is GUI-only unless Pi supports archive.

### Acceptance Gate

- User can discover and run common commands.
- User can resume sessions without returning to TUI.

## Phase 10: `/tree`, Branch Summary, And `/compact`

Goal: implement Pi's most important session-navigation semantics in desktop form.

### Tasks

- Add tree view for active session.
- Render active leaf.
- Render active path.
- Add fold/unfold.
- Add search.
- Add filter modes:
  - default
  - no-tools
  - user-only
  - labeled-only
  - all
- Implement entry selection semantics:
  - selecting user message moves leaf to parent and places text in composer
  - selecting assistant/tool/other entry moves leaf to that entry and clears composer
- Add label/unlabel where Pi supports it.
- Add branch summary flow:
  - no summary
  - default summary
  - custom focus instructions
- Add manual compaction:
  - optional custom instructions
  - start/end events
  - failure events
  - abort where supported

### Tests

- Tree renders from Pi session tree.
- Active leaf semantics match TUI docs.
- User-message selection populates composer.
- Assistant/tool selection clears composer.
- Branch summary choices map to Pi behavior.
- Compaction start/end/failure render correctly.

### Acceptance Gate

- User can branch and compact from GUI.
- GUI does not corrupt session files.
- Tree behavior is compatible with TUI mental model.

## Phase 11: `/trust`, Focused Settings, Skills And Extensions

Goal: expose the Pi extensibility control plane without becoming a full settings IDE.

### Tasks

- Add `/trust` equivalent.
- Detect untrusted project-local resources.
- Show trust prompt.
- Persist trust/distrust/parent trust through Pi trust manager.
- Reload resources after trust changes.
- Add focused settings editor:
  - default provider
  - default model
  - default thinking level
  - enabled models
  - skill commands
  - compaction basics
  - image block/resize behavior
  - steering/follow-up mode
- Show setting source:
  - global
  - project
  - effective value
- Add skills list.
- Add extensions list.
- Show source:
  - global
  - project
  - package
  - explicit path
- Show load errors.
- Add reload resources.
- Add open source location.

### Tests

- Trust prompt appears for untrusted project resources.
- Trust decision persists.
- Resource reload reflects trust change.
- Settings edits validate through schema.
- Settings writes go through Pi managers where available.
- Skills/extensions list includes source and errors.

### Acceptance Gate

- User can manage trust and common settings from GUI.
- User can see what is extending Pi in the workspace.
- GUI does not invent a separate extension registry.

## Phase 12: Richer Extension UI, Images, Export And Share

Goal: complete practical P1 parity workflows.

### Tasks

- Render simple `setWidget` content in a desktop panel.
- Add session-scoped notification center.
- Add compatibility issue log.
- Improve editor modal flows.
- Add image attachments:
  - file picker
  - paste from clipboard
  - preview
  - remove
  - respect `images.blockImages`
  - respect auto-resize settings
- Add export:
  - HTML
  - JSONL where Pi supports it
- Add share through Pi's GitHub secret gist flow.
- Add safe open/copy/reveal for exported artifacts.

### Tests

- Widget renders session-scoped content.
- Compatibility issue log records unsupported UI.
- Image file attachment sends through Pi prompt options.
- Clipboard image attachment works.
- Block-images setting prevents send.
- Export returns path.
- Share returns URL or typed failure.

### Acceptance Gate

- Common media and sharing workflows work from GUI.
- Extension UI compatibility is useful without executing extension renderer code.

## Phase 13: P1 Hardening And Release Readiness

Goal: make the P1 GUI reliable enough to become a serious TUI alternative.

### Tasks

- Add full P1 E2E suite.
- Add background session stress tests.
- Add event-ordering tests.
- Add restart/reopen with multiple sessions.
- Add import-boundary checks.
- Add diagnostics snapshot test.
- Add accessibility pass for core workflows.
- Add keyboard navigation pass.
- Add performance pass for long timelines.
- Add docs:
  - architecture overview
  - extension compatibility matrix
  - development commands
  - troubleshooting
- Evaluate packaged app smoke tests, but keep full release automation P2 unless needed.

### Acceptance Gate

- P1 definition of done is satisfied.
- No event bleed under concurrent sessions.
- Long timelines remain usable.
- `npm --prefix packages/gui run check` passes.
- Root `npm run check` passes.
- P1 workflows are documented.

## P2 Deferred Backlog

Keep these out of P0/P1 implementation PRs:

- Worktree catalog.
- Integrated terminal.
- Git and diff views.
- OS notifications.
- Diagnostics/log viewer UI beyond basic issue panels.
- Full packaged release matrix.
- Future WebSocket/subprocess driver.
- Remote runtime daemon.
- Arbitrary custom extension UI host.
- Extension marketplace.
- Model marketplace.
- Usage/billing dashboard.
- Full theme editor.

## Suggested PR Breakdown

1. `docs`: architecture and phase docs.
2. `feat(gui)`: package skeleton, Electron shell, Oxc tooling.
3. `feat(gui)`: contracts and IPC bridge.
4. `feat(gui)`: workspace/session catalog.
5. `feat(gui)`: SDK session driver and supervisor.
6. `feat(gui)`: prompt loop and timeline.
7. `feat(gui)`: model/thinking/settings/trust summary.
8. `feat(gui)`: basic extension UI bridge.
9. `feat(gui)`: P0 E2E and hardening.
10. `feat(gui)`: background sessions and queue UI.
11. `feat(gui)`: command palette and resume.
12. `feat(gui)`: tree, branch summary, compact.
13. `feat(gui)`: trust/settings/skills/extensions.
14. `feat(gui)`: richer extension UI, images, export/share.
15. `feat(gui)`: P1 hardening.

## Implementation Checklist Template

Use this checklist for each phase PR:

- Scope matches one phase.
- No P2 features included.
- Renderer imports only contracts/preload-safe client modules.
- Main owns Pi SDK and privileged APIs.
- IPC payloads are decoded with Effect Schema.
- Persisted GUI JSON is decoded with Effect Schema.
- Extension UI requests are session-scoped.
- Tests cover the phase acceptance gate.
- `npm --prefix packages/gui run format:check` passes.
- `npm --prefix packages/gui run lint` passes.
- `npm --prefix packages/gui run check` passes.
- Root `npm run check` passes after code changes.
- Changelog updated if package exists and code behavior changes.

## Final Recommendation

Start Phase 1 with tooling and the secure shell. The Oxc decision should land there, before GUI code grows, because lint/format ownership affects every later diff.

Keep the first real runtime behavior for Phase 4 and the first user-visible Pi loop for Phase 5. That sequence gives reviewers clean boundaries: shell, contracts, catalog, runtime, prompt loop, then parity.

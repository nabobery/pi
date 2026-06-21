# Pi-Native GUI Reference Research

Date: 2026-06-17

Audience: Pi maintainers and contributors evaluating a first-party desktop GUI package.

Scope: Research `pingdotgg/t3code`, `Emanuele-web04/synara`, and `minghinmatthewlam/pi-gui` for architecture decisions that should inform a Pi-native Electron app. This document focuses on runtime boundaries, typed contracts, extensibility, session supervision, desktop process structure, and test strategy.

## Executive Recommendation

It makes sense to develop a Pi-native desktop GUI package using Electron, Effect, TypeScript, Vite, React, Tailwind, and Effect Schema.

The GUI should be SDK-driver-first, not WebSocket-server-first. Pi already exposes `createAgentSession()`, `createAgentSessionRuntime()`, `AgentSessionRuntime`, extension UI contexts, session replacement, prompting, steering, follow-up, compaction, tree navigation, model selection, and event subscription. Pi's RPC docs explicitly say Node.js/TypeScript embedders should consider using `AgentSession` directly instead of spawning a subprocess. A desktop app in this monorepo is exactly that embedding use case.

The durable boundary should still be a protocol-shaped `SessionDriver`, but its first implementation should be `PiSdkSessionDriver` running in Electron main. A future `PiRpcSessionDriver` or `PiWsSessionDriver` can be added later if Pi grows an official local server. The renderer should not know which driver is active.

Effect Schema should define every command, event, snapshot, and IPC payload that crosses the main/preload/renderer boundary. The reference repos show why: TS-only IPC contracts scale quickly, but without runtime decoding they become unsafe at the exact boundary where untrusted renderer inputs meet filesystem, shell, auth, and agent runtime operations.

## Pi Constraints And Runtime Sources

Current Pi package shape:

- `@earendil-works/pi-agent-core`: lower-level agent runtime and harness.
- `@earendil-works/pi-coding-agent`: CLI plus SDK, sessions, resources, settings, extensions, RPC mode, and interactive mode.
- `@earendil-works/pi-ai`: provider abstraction.
- `@earendil-works/pi-tui`: terminal UI library.

GUI-relevant Pi facts:

- `packages/coding-agent/docs/sdk.md` documents the SDK as the way to build custom web, desktop, and mobile interfaces.
- `AgentSession` owns message history, model state, thinking level, compaction, queueing, event streaming, and abort.
- `AgentSessionRuntime` owns session replacement across new session, switch session, fork, and import flows.
- Runtime replacement invalidates old session subscriptions, so a GUI supervisor must rebind subscriptions after replacement.
- Extensions expose UI primitives through `ExtensionUIContext`: confirm, input, select, notify, status, widgets, title, editor text, custom UI, autocomplete, and editor replacement.
- Session files remain the canonical transcript truth. The GUI should store navigation and rendering indexes, not a duplicate transcript database.
- Pi does not include a built-in sandbox/permission layer. A desktop app must communicate this clearly and can later add policy UI, but it cannot pretend Electron itself isolates tool execution.

The GUI should therefore wrap Pi rather than compete with it:

- Pi runtime owns turns, tools, extensions, transcript writes, model behavior, and session lifecycle.
- GUI owns windows, IPC, catalog metadata, renderer state, notifications, update flow, visual timeline, and host implementations of extension UI.
- A typed driver boundary translates Pi events into GUI events and GUI commands into Pi SDK calls.

## Current Framework Guidance

Electron:

- Keep `nodeIntegration: false`.
- Keep `contextIsolation: true`.
- Keep sandboxing enabled where possible.
- Expose a narrow preload API through `contextBridge.exposeInMainWorld`.
- Treat renderer inputs as untrusted and validate them in main before invoking privileged APIs.

electron-vite:

- Use separate build entries for `main`, `preload`, and `renderer`.
- Use the dev flow where main/preload build first, renderer starts on the Vite dev server, then Electron launches.
- Keep the package scripts explicit so packaged smoke tests exercise the same entrypoints.

Effect:

- Use `Schema.decodeUnknown(schema)(value)` or equivalent decoders at process and persistence boundaries.
- Use branded identifiers for workspace, session, run, request, and event IDs.
- Use tagged request/event schemas for command/event unions.
- Use `Effect.Service` and Layers for Electron main services when there is real runtime wiring.

## Repository Analysis: T3 Code

Repository: `pingdotgg/t3code`

### What It Built

T3 Code is a browser app and local Node WebSocket server around `codex app-server` over JSON-RPC stdio. The main runtime graph is:

- React + Vite browser app.
- WebSocket transport state machine in the client.
- Node server with WebSocket and HTTP static serving.
- Ordered push bus for server-to-client events.
- Startup readiness gate before clients receive the welcome payload.
- Provider service that talks to the underlying agent runtime.
- Orchestration engine that persists and projects domain events.
- Queue-backed workers for runtime ingestion, provider command reaction, and checkpointing.
- Runtime receipt bus for deterministic async milestones such as turn quiescence.

### Good Decisions

Typed contract package:

T3 Code has a dedicated `packages/contracts` package with Effect Schema definitions. It uses branded IDs, structured schemas, tagged errors, and explicit protocol modules. This is the most directly transferable practice.

Ordered outbound event path:

Server pushes flow through a single ordered path. For a GUI, the equivalent is a main-process event bus that serializes per-session events before they reach the renderer. This avoids subtle UI races when assistant deltas, tool updates, session status changes, and host UI requests interleave.

Startup readiness:

The server waits for startup barriers before sending a welcome event. A Pi GUI should do the same for app boot: load catalog, initialize Pi auth/model registry, hydrate settings, create the driver, then publish a typed `app.ready` or `bootstrap.completed` snapshot.

Runtime receipts:

Receipts are lightweight, typed milestone events used by tests and orchestration code instead of polling. Pi GUI should adopt this for Electron E2E and driver tests:

- `run.accepted`
- `run.quiescent`
- `session.rebound`
- `catalog.synced`
- `extension-ui.requested`
- `extension-ui.resolved`

Queue-backed workers:

T3 Code uses queue-backed workers for follow-up work. Pi GUI should use this selectively, not broadly. Good candidates:

- catalog sync
- transcript projection
- notification fanout
- session list refresh
- packaged app diagnostics

Server-authoritative event sourcing:

T3 Code's later plans move toward a durable event store and projection pipeline. This is valuable for multi-client/web server architecture. For Pi GUI v1, full event sourcing would be too heavy. The useful part is conceptual: commands should validate first, events should describe committed facts, projections should be rebuildable.

### What To Incorporate

- Create a GUI contracts module using Effect Schema from the beginning.
- Use branded IDs for `WorkspaceId`, `SessionId`, `RunId`, `RequestId`, and `EventId`.
- Decode IPC commands and pushed events at the boundary.
- Add an ordered per-session event fanout.
- Add readiness/bootstrap state rather than rendering partially initialized runtime state.
- Add receipt events that tests can await.
- Keep command schemas, event schemas, read-model schemas, and bootstrap schemas separate once the contract file grows.

### What Not To Copy

- Do not put a Node WebSocket server in front of Pi's SDK for v1.
- Do not duplicate the whole orchestration/event-store architecture before there is a multi-client runtime or remote server requirement.
- Do not treat provider adapters as the main abstraction. Pi itself is the provider/runtime for this GUI.

## Repository Analysis: Synara

Repository: `Emanuele-web04/synara`

### What It Built

Synara is a more productized sibling of the T3 Code shape. It has:

- desktop, web, server, contracts, and shared packages
- Effect services and layers in server domains
- provider adapter registry for many agent/provider backends
- server-side auth, settings, terminal, git, workspace, persistence, orchestration, and diagnostics modules
- extensive migrations and read-model projection infrastructure

The most valuable Synara document is its repo scan on architecture boundaries. It identifies that the package split is solid, but the module boundaries became too thick in:

- server manager
- WebSocket server
- Electron main
- large contracts files

### Good Decisions

Services vs Layers distinction:

Synara uses a useful convention:

- `Services`: pure interfaces or stable domain APIs.
- `Layers`: live wiring, Effect provisioning, concrete runtime assembly.

This fits Pi GUI well. Electron main has many native services with side effects, so a Services/Layers split will prevent the main process from becoming a grab bag.

Boundary refactoring discipline:

Synara explicitly calls out god-file risks and proposes splits by responsibility. That is directly relevant because `pi-gui` already demonstrates how quickly Electron main can become large.

Protocol evolution awareness:

The repo scan recommends splitting large contract surfaces into command schemas, event schemas, read models, bootstrap payloads, and helper constants. Pi GUI should adopt that as soon as the first contract file becomes hard to scan.

Provider runtime registry:

Synara's provider registry is useful as a pattern, not as a feature requirement. For Pi GUI, the registry should be a driver registry:

- `PiSdkSessionDriver` for v1.
- `PiRpcSessionDriver` if subprocess mode is needed.
- `PiWsSessionDriver` if Pi later ships an official local server.

ADR-lite docs:

Synara recommends short architecture documents rather than large formal RFCs. Pi GUI should create small docs for:

- desktop shell boundaries
- session driver contract
- extension UI host model
- renderer state model
- packaged app smoke tests

### What To Incorporate

- Split Electron main into services early:
  - `WindowService`
  - `IpcRouter`
  - `SessionDriverService`
  - `WorkspaceCatalogService`
  - `ExtensionHostUiService`
  - `NotificationService`
  - `TerminalService` if integrated terminals are included
  - `SettingsService`
  - `DiagnosticsService`
- Use Effect Services/Layers only where they buy lifecycle clarity. Avoid wrapping simple pure helpers.
- Keep contracts modular and evolution-aware.
- Add architecture notes as part of the package, not after the design becomes folklore.
- Add testable service boundaries before adding advanced features like worktrees or multiple runtime drivers.

### What Not To Copy

- Do not copy the multi-provider server architecture into Pi. Pi is the runtime.
- Do not start with SQLite event sourcing unless the GUI must support multi-window/multi-process recovery beyond the catalog.
- Do not allow `main.ts`, IPC registration, or contract files to become the central dumping ground.

## Repository Analysis: Pi GUI

Repository: `minghinmatthewlam/pi-gui`

### What It Built

Pi GUI is the closest reference. It is an Electron desktop app for Pi sessions. It depends on upstream Pi packages and is intentionally not a standalone runtime.

Package shape:

- `apps/desktop`: Electron shell and renderer.
- `packages/session-driver`: durable app-facing session contract.
- `packages/pi-sdk-driver`: implementation backed by Pi SDK.
- `packages/catalogs`: workspace/session/worktree catalogs.

It has plans for a Pi desktop MVP and Codex-parity phase. The MVP plan recommends:

- Electron app.
- In-process SDK-backed driver.
- No large custom permanent app server before official Pi server exists.
- Durable `SessionDriver` boundary.
- Thin workspace/session catalog.
- Transcript truth remains in Pi session files/runtime.
- Real Electron E2E as proof, not just unit tests.

This matches the right direction for a Pi-native package.

### Good Decisions

SDK-backed `SessionDriver`:

The driver isolates the renderer and desktop app from the backend implementation. This is the key transferable design. The UI calls create/open/send/cancel/subscribe/close style methods and receives typed events.

Session supervisor:

The `SessionSupervisor` manages records keyed by workspace/session, runtime/session references, listeners, pending host UI requests, queued messages, event queue, extension UI state, and session commands. This is exactly the shape Pi GUI needs, but Pi-native should implement it with stricter schemas and smaller modules.

Runtime supervisor:

The runtime supervisor reads Pi settings, auth, models, skills, extensions, and scoped model configuration for a workspace. Pi-native GUI should include this capability because provider/model setup is a first-class desktop workflow.

Thin catalog:

The catalog stores workspace and session metadata for navigation:

- workspace path, display name, last opened, ordering
- session title, updated time, preview, status, session file path

It does not duplicate full transcripts. This is the right model for Pi.

Extension UI bridge:

The session supervisor maps Pi extension UI requests into host UI requests. This preserves Pi's extensibility philosophy: extensions do not become terminal-only. The GUI becomes another host for the same extension primitives.

Parallel session direction:

The phase 1 plan correctly treats background sessions as a first-order state model problem:

- per-session status
- no event bleed
- background sessions update while not selected
- selected UI state separate from runtime state
- queued message handling per session

Secure Electron defaults:

The app uses a preload script, `contextBridge`, `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.

Packaged app test lanes:

The desktop package has segmented scripts for core E2E, live/native E2E, packaged smoke tests, terminal tests, notification tests, and release zip tests. A Pi-native GUI should not consider itself done until packaged runtime paths are tested.

### Gaps To Fix In Pi-Native Implementation

TS-only contract:

`packages/session-driver` is a TypeScript interface package. That is useful at compile time but not enough for Electron IPC. Pi-native should define the same concepts with Effect Schema and derive types from schemas.

Large Electron main:

The Electron `main.ts` in the reference app is over 1,300 lines and directly registers many app concerns. Pi-native should split main-process services from day one.

Large IPC surface:

The IPC file is a large typed channel registry without runtime validation. Pi-native should build an `IpcRouter` that maps `Schema.TaggedRequest` commands to handlers and decodes both inputs and outputs.

Manual settings coercion:

Runtime settings and catalog reads do manual JSON/type coercion. Pi-native should decode catalog/settings files through Effect Schema and return structured parse errors.

Potential sync IPC:

Avoid synchronous IPC for convenience APIs unless absolutely necessary. Clipboard/image and file path flows should prefer async invocations where possible.

### What To Incorporate

- Keep the `SessionDriver` idea.
- Use an SDK-backed first driver.
- Add a `SessionSupervisor` in Electron main.
- Add a runtime/settings supervisor for models, auth, skills, extensions, defaults, and scoped models.
- Store workspace/session catalog metadata separately from transcripts.
- Translate extension UI primitives into desktop host UI requests.
- Support background session event fanout early even if v0 only focuses one active session.
- Add packaged Electron smoke tests and restart/reopen tests.

### What Not To Copy

- Do not use TS-only IPC as the safety boundary.
- Do not let Electron main become the app runtime, window manager, IPC router, catalog store, terminal host, notification system, and session supervisor in one file.
- Do not include worktrees, terminal, updater, computer-use, and deep settings in the first Pi-native package unless the initial milestone explicitly needs them.

## Cross-Repo Patterns Worth Adopting

### 1. SDK-First Runtime Boundary

The strongest answer to "WebSocket server or SDK-driver-first?" is:

Use SDK-driver-first for v1, with a protocol-shaped driver interface.

Rationale:

- Pi is a Node/TypeScript package and already exports the runtime APIs.
- Electron main is a Node process, so an in-process SDK driver avoids subprocess and socket complexity.
- Pi's own RPC docs recommend direct SDK use for Node/TypeScript embedders.
- A typed driver keeps the future WebSocket migration possible without paying the server tax now.

### 2. Effect Schema Contracts Everywhere Data Crosses A Boundary

Use Effect Schema for:

- renderer-to-main commands
- main-to-renderer events
- catalog JSON files
- settings JSON files
- persisted GUI read models
- extension host UI requests/responses
- packaged app diagnostics events
- E2E receipt events

Suggested primitives:

- branded IDs
- `Schema.TaggedStruct` for event unions
- `Schema.TaggedRequest` for command/request unions
- `Schema.TaggedErrorClass` for typed failures
- `Schema.decodeUnknown` at every external input boundary

### 3. Thin Catalog, Pi Transcript Truth

The GUI should own:

- workspace list
- workspace ordering/pinning
- last selected workspace/session
- session display title
- preview snippet
- status
- archived state
- session file path pointer
- renderer layout preferences

Pi should own:

- transcript entries
- branch/tree state
- compaction entries
- model/thinking entries
- extension-persisted session state
- session file format and migration

### 4. Ordered Per-Session Event Fanout

Assistant deltas, tool updates, queue updates, host UI requests, status changes, model changes, and run completion should be serialized per session before they enter renderer state.

This does not require global serialization. Different sessions can run concurrently, but each session needs an ordered lane.

### 5. Extension UI As A First-Class Host Contract

Pi's extensibility philosophy is not just custom tools. It includes commands, lifecycle hooks, UI prompts, widgets, editor control, status, title, and custom interactive components.

The desktop app should define compatibility levels:

- `native`: confirm, input, select, notify, status, title, set editor text, get editor text, editor dialog.
- `rendered`: widgets that can map to React panels.
- `unsupported`: TUI-specific custom components or raw terminal input. Emit a typed compatibility issue instead of silently dropping them.

### 6. Test Receipts And Packaged Smoke Tests

The references converge on real app proof:

- driver smoke tests
- Electron E2E
- restart/reopen tests
- packaged app smoke tests
- boundary tests proving renderer imports only contracts/preload API, not Pi runtime internals
- receipt-based waits instead of sleeps

## Proposed Pi-Native Package Architecture

Recommended initial package:

```text
packages/gui/
  package.json
  electron.vite.config.ts
  src/
    contracts/
      ids.ts
      commands.ts
      events.ts
      snapshots.ts
      extension-ui.ts
      catalog.ts
      errors.ts
      index.ts
    main/
      main.ts
      app-layer.ts
      services/
        WindowService.ts
        IpcRouter.ts
        SessionDriverService.ts
        SessionSupervisor.ts
        RuntimeSupervisor.ts
        WorkspaceCatalogService.ts
        ExtensionHostUiService.ts
        SettingsService.ts
        DiagnosticsService.ts
      layers/
        ElectronWindowLayer.ts
        ElectronIpcLayer.ts
        PiSdkDriverLayer.ts
        JsonCatalogLayer.ts
    preload/
      index.ts
    renderer/
      app/
      components/
      state/
      routes/
      styles/
    test/
      driver/
      electron/
      fixtures/
```

This single-package start keeps monorepo overhead low. If contract reuse grows, extract `packages/gui-contracts` later. If the driver becomes useful outside Electron, extract `packages/gui-session-driver` later. Do not create extra packages before a second consumer exists.

### Main Process

Main process responsibilities:

- create windows and menus
- own privileged filesystem/native APIs
- create and manage Pi SDK runtimes
- decode IPC commands
- publish typed renderer events
- persist GUI catalogs/settings
- implement extension UI host requests
- emit diagnostics and test receipts

Main process should not:

- render business UI
- duplicate Pi transcripts
- expose raw Pi SDK objects to renderer
- accept unvalidated renderer payloads
- own all app logic in `main.ts`

### Preload

Preload should expose a narrow `window.piGui` API:

- `invoke(command)` for typed commands
- `subscribe(listener)` for typed events
- perhaps small convenience wrappers generated from command schemas

Preload should not import Pi runtime packages. It should import only contracts and Electron preload-safe code.

### Renderer

Renderer responsibilities:

- React UI
- local view state
- normalized read models from typed events
- composer state
- host UI dialogs
- timeline rendering
- settings screens

Renderer should not:

- call filesystem/shell directly
- import `@earendil-works/pi-coding-agent`
- decide session lifecycle semantics
- infer completion by polling transcript files

### Session Driver Contract

Initial command/event surface:

```text
Commands:
  app.bootstrap
  workspace.add
  workspace.remove
  workspace.select
  workspace.sync
  session.create
  session.open
  session.close
  session.rename
  session.archive
  session.unarchive
  session.sendMessage
  session.replaceQueuedMessages
  session.cancelRun
  session.setModel
  session.setThinkingLevel
  session.compact
  session.reload
  session.getTranscript
  session.getTree
  session.navigateTree
  extensionUi.respond

Events:
  app.ready
  app.error
  workspace.updated
  catalog.updated
  session.opened
  session.updated
  session.closed
  assistant.delta
  tool.started
  tool.updated
  tool.finished
  queue.updated
  run.started
  run.completed
  run.failed
  extensionUi.requested
  extensionUi.updated
  extensionUi.compatibilityIssue
  receipt.emitted
```

The exact names can change, but the separation should hold: renderer sends commands; main emits committed events and snapshots.

### Session Supervisor

The supervisor should maintain one record per workspace/session:

- `workspaceRef`
- `sessionRef`
- `runtime`
- `session`
- `status`
- `runningRunId`
- `queuedMessages`
- `listeners`
- `pendingHostUiRequests`
- `extensionUiState`
- `catalogSnapshot`
- `unsubscribeAgent`

Invariants:

- Events from one session never update another session.
- Runtime replacement rebinds subscriptions before emitting a ready/opened event.
- Closing a session aborts active work, clears pending UI requests, unsubscribes listeners, and disposes runtime.
- Catalog state updates only after the underlying Pi operation has been accepted or committed.
- Renderer-visible status is derived from driver state plus Pi session events, not from optimistic UI alone.

### Runtime Supervisor

The runtime supervisor should wrap Pi workspace-scoped resources:

- `AuthStorage`
- `ModelRegistry`
- `SettingsManager`
- `DefaultResourceLoader`
- `SessionManager`
- trusted project-local extensions/skills
- default model/thinking selection
- scoped model patterns
- provider auth actions

Effect Schema should decode all GUI-owned settings snapshots. Pi-owned settings should be changed through Pi APIs/managers where possible.

### Catalog Persistence

Use JSON first unless requirements justify SQLite.

Files:

- `gui-workspaces.json`
- `gui-sessions.json`
- `gui-settings.json`

Requirements:

- atomic writes
- schema decode on read
- backup or quarantine malformed files
- no transcript duplication
- stable session file pointers
- rebuild command from Pi session files if catalog is missing

SQLite can be reconsidered when the GUI needs durable projections for multi-window concurrency, large search, or event history.

## Extensibility Model

Pi-native GUI should follow Pi's existing extensibility philosophy:

- same Pi extension discovery model
- same extension command model
- same extension UI primitives where possible
- same session persistence semantics
- same project trust boundary for project-local extensions
- GUI-specific compatibility events instead of terminal-only crashes

Recommended extension host mapping:

| Pi extension UI primitive | GUI mapping |
| --- | --- |
| `confirm` | modal dialog |
| `input` | modal text input |
| `select` | modal select/listbox |
| `notify` | in-app toast plus optional OS notification |
| `setStatus` | status bar item |
| `setTitle` | window/session title update |
| `setWidget` | renderer panel attached to composer/timeline |
| `setEditorText` | composer text update |
| `getEditorText` | renderer composer query |
| `editor` | multi-line modal/editor sheet |
| `custom` | compatibility issue in v1; optional React host API later |
| `onTerminalInput` | unsupported unless integrated terminal is focused |

This preserves extension behavior without pretending TUI components are automatically portable to React.

## Electron Security And Native Boundaries

Baseline:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- no direct remote module
- no raw `ipcRenderer` exposed to renderer
- no arbitrary channel names from renderer
- all IPC inputs decoded by Effect Schema
- all privileged commands check workspace/session scope
- file picker paths must be user-selected or workspace-contained
- shell open commands must be narrow and explicit

The app should document that Pi tool execution runs with the user's process permissions unless the user configures containerization/sandboxing. Electron process isolation protects the GUI boundary; it is not an agent-tool sandbox.

## UI And Frontend Direction

Use React + Vite + Tailwind for the renderer.

Recommended state model:

- a command client generated or hand-wrapped from Effect Schema commands
- an event reducer for app/session/catalog state
- per-session timeline state keyed by `sessionRef`
- selected view state separate from runtime state
- optimistic UI only for local composer drafts, not committed session state
- receipts for E2E synchronization

Initial product surface:

- workspace sidebar
- session list per workspace
- main timeline
- composer with text and image attachments
- model/thinking controls
- queued message display
- run cancel
- extension host UI dialogs
- settings for providers/models/skills/extensions

Deferred unless explicitly scoped:

- worktrees
- integrated terminal
- computer-use
- updater
- remote/mobile clients
- multi-provider registry outside Pi
- full custom extension component hosting

## Testing Strategy

Minimum tests before calling the package usable:

- contract decode tests for every command/event union
- IPC router tests for invalid payload rejection
- driver smoke test with a fixture workspace
- session supervisor tests for event isolation across two sessions
- extension host UI request/response test
- catalog malformed-file recovery test
- Electron E2E for create/open/send/restart/reopen
- packaged app smoke test for main/preload/renderer entrypoints
- boundary test that renderer does not import Pi runtime packages

Avoid sleeps in E2E. Emit receipts from main and wait for them.

Useful receipt examples:

- `bootstrap.completed`
- `workspace.synced`
- `session.created`
- `prompt.accepted`
- `assistant.delta.received`
- `run.completed`
- `session.reopened`

## Decisions To Adopt, Adapt, Or Avoid

| Decision | Source | Recommendation |
| --- | --- | --- |
| SDK-backed session driver | `pi-gui`, Pi SDK docs | Adopt |
| Protocol-shaped durable boundary | `pi-gui`, T3 Code | Adopt |
| Effect Schema contracts | T3 Code, Synara, user direction | Adopt |
| Ordered event push/fanout | T3 Code | Adopt |
| Startup readiness gate | T3 Code | Adopt |
| Runtime receipts for tests | T3 Code | Adopt |
| Thin workspace/session catalog | `pi-gui` | Adopt |
| Extension UI host requests | `pi-gui`, Pi extensions | Adopt |
| Services/Layers split | Synara | Adopt, but keep it pragmatic |
| ADR-lite architecture docs | Synara | Adopt |
| WebSocket server wrapper | T3 Code, Synara | Avoid for v1; keep future driver option |
| Full event-sourced SQLite orchestration | T3 Code, Synara | Avoid for v1; revisit when requirements demand |
| Multi-provider adapter registry | Synara | Adapt into driver registry only |
| TS-only IPC contracts | `pi-gui` | Avoid |
| Large Electron `main.ts` | `pi-gui`, Synara scan | Avoid |

## Phased Plan

### Phase 0: Architecture Skeleton

- Add `packages/gui`.
- Add Electron/electron-vite/React/Tailwind build skeleton.
- Add Effect Schema contract modules.
- Add secure preload bridge.
- Add IPC router with schema decoding.
- Add JSON catalog service with schema decoding and atomic writes.
- Add `PiSdkSessionDriver` interface and no-op/fake driver tests.

### Phase 1: Real Pi Session Loop

- Wire `createAgentSessionRuntime()` through `SessionSupervisor`.
- Create/open/list sessions for a workspace.
- Send a prompt and stream assistant deltas.
- Show tool start/update/finish rows.
- Cancel current run.
- Persist and restore workspace/session selection.
- Reopen existing Pi session file.
- Add receipt-based Electron E2E.

### Phase 2: Pi-Native Extensibility

- Bind extension UI context.
- Implement confirm/input/select/notify/status/title/editor text.
- Emit compatibility issues for unsupported TUI-only APIs.
- Add skill/extension listing and enablement settings.
- Add model/thinking controls.
- Add queued message display and replacement.

### Phase 3: Parallel Sessions And Product Hardening

- Allow multiple sessions to run while one is focused.
- Add per-session event lanes.
- Add resource limits and cancellation policies.
- Add packaged app smoke tests.
- Add malformed catalog recovery.
- Add diagnostics screen/log export.

### Phase 4: Future Runtime Driver

- Add optional `PiRpcSessionDriver` if subprocess isolation is needed.
- Add optional `PiWsSessionDriver` if Pi ships an official local WebSocket server.
- Keep renderer unchanged by preserving the SessionDriver contract.

## Open Questions

- Should `packages/gui` be published, or is it a repo-local app package only?
- Should GUI catalogs live under `~/.pi/gui` or inside the existing agent dir?
- What is the first supported platform: macOS only, or macOS plus Linux?
- Should project-local extension trust reuse the exact interactive-mode trust prompts, or should the GUI add a richer trust screen?
- How much of `ExtensionUIContext.custom()` should be supported in React, if any, in the first release?
- Should the GUI expose integrated terminal in v1, or leave terminal workflows to the existing TUI?

## Final Position

A Pi-native GUI package is a good fit for this codebase if it stays true to Pi's architecture:

- Pi remains the agent runtime.
- The GUI is a host for Pi sessions and extensions.
- Electron main owns native privileges and Pi SDK integration.
- Renderer receives typed projections and sends typed commands.
- Effect Schema validates every boundary.
- The first backend is SDK-driven.
- WebSocket/server mode remains a future driver, not the initial architecture.

This keeps the desktop app extensible by design without making it a parallel agent platform.

## Research Sources

- `/tmp/pi-gui-research/t3code/docs/architecture/overview.md`
- `/tmp/pi-gui-research/t3code/docs/architecture/runtime-modes.md`
- `/tmp/pi-gui-research/t3code/.plans/02-typed-ipc-boundaries.md`
- `/tmp/pi-gui-research/t3code/.plans/10-unify-process-session-abstraction.md`
- `/tmp/pi-gui-research/t3code/.plans/14-server-authoritative-event-sourcing-cleanup.md`
- `/tmp/pi-gui-research/t3code/packages/contracts/src`
- `/tmp/pi-gui-research/synara/.docs/architecture.md`
- `/tmp/pi-gui-research/synara/.plans/02-typed-ipc-boundaries.md`
- `/tmp/pi-gui-research/synara/.plans/14-server-authoritative-event-sourcing-cleanup.md`
- `/tmp/pi-gui-research/synara/docs/repo-scan-2026-04-16/01-architecture-and-boundaries.md`
- `/tmp/pi-gui-research/synara/packages/contracts/src`
- `/tmp/pi-gui-research/pi-gui/README.md`
- `/tmp/pi-gui-research/pi-gui/plans/pi-app-mvp/plan.md`
- `/tmp/pi-gui-research/pi-gui/plans/phase-1-codex-parity/plan.md`
- `/tmp/pi-gui-research/pi-gui/packages/session-driver/src`
- `/tmp/pi-gui-research/pi-gui/packages/pi-sdk-driver/src`
- `/tmp/pi-gui-research/pi-gui/apps/desktop/electron`
- `packages/coding-agent/docs/sdk.md`
- `packages/coding-agent/docs/rpc.md`
- `packages/coding-agent/docs/extensions.md`
- `packages/coding-agent/src/core/sdk.ts`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/coding-agent/src/core/agent-session-runtime.ts`
- `packages/coding-agent/src/core/extensions/types.ts`
- Context7 documentation lookup for Electron, Effect, and electron-vite on 2026-06-17.

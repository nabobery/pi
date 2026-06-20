# Pi GUI

Pi GUI is the native desktop shell for Pi sessions. Electron main owns the Pi runtime, preload exposes the typed `piGui` bridge, and React renders a projection of typed commands, events, snapshots, and errors.

## Development Commands

Run package checks from the repository root:

```sh
npm --prefix packages/gui run format:check
npm --prefix packages/gui run lint
npm --prefix packages/gui run typecheck
npm --prefix packages/gui run test:run
npm --prefix packages/gui run test:coverage
npm --prefix packages/gui run test:electron
npm --prefix packages/gui run check
```

Run root verification after GUI code changes:

```sh
npm run check
```

Electron E2E uses the fake runtime by setting `PI_GUI_TEST_FAKE_DRIVER=1` inside the test fixture. It must use isolated `HOME` directories and must not call real providers or require GitHub CLI auth.

## Architecture

Main process:

- owns Pi runtime sessions through `SessionDriver`
- validates renderer commands with Effect Schema contracts
- emits typed GUI events and command receipts
- owns filesystem, shell, resource, settings, export, and share operations

Preload:

- exposes only `window.piGui.invoke` and `window.piGui.subscribe`
- does not expose raw `ipcRenderer`
- validates the renderer boundary through the shared transport wrapper

Renderer:

- imports contracts and renderer code only
- keeps session state as projections of main-process snapshots and events
- sends typed commands through preload

`PiSdkSessionDriver` is the production runtime seam. `FakeSessionDriver` is only for deterministic tests and Electron E2E.

## Artifact And Share Security

File artifacts are opened or revealed by artifact ID after main-process tracking. External artifacts are shell-openable only after the main-process artifact URL policy accepts them.

Allowed external URLs:

- GitHub gist URLs matching `https://gist.github.com/<owner-or-id>/...`
- Pi share preview URLs matching the configured `getShareViewerUrl(gistId)` result

Share preview URLs must use HTTPS and include a non-empty hash/gist ID. Arbitrary HTTPS URLs are rejected even when they pass general contract serialization.

## Extension Compatibility

Native:

- command catalog projection
- confirm, input, select, editor, status, title, notification, and widget UI requests
- resource inventory display and source open/reveal

Rendered:

- transcript/timeline events
- queue updates
- tool lifecycle events
- compatibility issue reporting

Reported unsupported:

- runtime APIs missing from a session driver
- resource source paths that cannot be resolved
- unsafe external artifact URLs

Deferred:

- packaged app signing and notarization
- real-provider Electron E2E
- remote runtime transport

## Troubleshooting

Electron launch failure:

- run `npm --prefix packages/gui run test:electron`
- if the build succeeds but launch fails under a sandbox, rerun with desktop window/process permissions
- inspect `packages/gui/test-results/**/error-context.md`

E2E build shim failure:

- update `src/main/test-runtime-shim.ts` whenever main-process code imports a runtime export that E2E aliases to the shim
- keep shim behavior deterministic and provider-free

Coverage failure:

- run `npm --prefix packages/gui run test:coverage`
- add focused tests for meaningful uncovered behavior
- do not lower thresholds or exclude non-entrypoint code

Share failure:

- missing `gh` reports share unavailable
- unauthenticated `gh` reports auth failure
- upload timeout or malformed gist output reports share failed

Sandbox and permissions:

- automated tests must use fake runtime mode
- Electron E2E may require window-system access
- renderer code must not import Electron, Node, Pi SDK, or main-process modules

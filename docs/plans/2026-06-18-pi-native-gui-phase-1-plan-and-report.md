# Pi Native GUI Phase 1 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the first Pi-native desktop GUI package as a secure Electron shell with local GUI tooling, tests, and no Pi runtime integration yet.

**Architecture:** Phase 1 creates `packages/gui` as a first-party workspace package with Electron main, preload, and React renderer processes. The main process owns the Electron security boundary, the preload exposes a minimal typed bridge, and the renderer remains a pure browser client. Runtime contracts, session drivers, Effect Schema IPC, prompt streaming, catalogs, settings flows, and extension surfaces are intentionally deferred to later phases.

**Tech Stack:** Electron, React, electron-vite, TypeScript, oxlint, oxfmt, Vitest, Playwright Electron.

---

## Phase 1 Scope

Phase 1 is the **Skeleton Shell** phase from `docs/plans/2026-06-18-pi-native-gui-implementation-phases.md`.

In scope:

- Create `packages/gui` as `@earendil-works/pi-gui`.
- Wire Electron main, preload, and renderer entrypoints.
- Render a minimal desktop shell with sidebar, timeline, composer/status, and startup states.
- Establish GUI-local `oxlint` and `oxfmt` ownership.
- Add secure Electron defaults and trust-boundary tests.
- Add package-local unit checks and Playwright Electron smoke testing.
- Integrate GUI checks into root `npm run check`.

Out of scope:

- Pi runtime imports.
- Session catalog, workspace catalog, prompt streaming, and timeline persistence.
- Effect Schema contracts and service layers.
- Settings, trust, extensions, slash commands, `/resume`, `/tree`, `/compact`, and `/share`.
- Tailwind, icons, Effect, `@effect/language-service`, and packaging/signing.

## Implemented Changes

### Package Skeleton And Tooling

- Added `packages/gui/package.json` with scripts for `dev`, `build`, `preview`, `format`, `format:check`, `lint`, `lint:fix`, `typecheck`, `test:run`, `test:coverage`, `test:electron`, and `check`.
- Added `packages/gui/electron.vite.config.ts` with explicit main, preload, and renderer build entrypoints.
- Added `packages/gui/tsconfig.json` and `packages/gui/tsconfig.build.json`.
- Added `packages/gui/oxlint.config.ts` and `packages/gui/oxfmt.config.ts`.
- Added `packages/gui/CHANGELOG.md` with an `[Unreleased]` entry.
- Updated root `package.json` with `check:gui` and appended it to root `check`.
- Updated root `biome.json` so GUI `src` and `test` files are not formatted/linted by Biome.
- Updated root `tsconfig.json` to exclude `packages/gui/**`; GUI DOM/JSX typechecking is package-local.

### Dependency Decisions

The requested dependency set could not be installed exactly as written because of peer and registry constraints. The implemented package uses exact pins that install and validate together:

- `react@19.2.7`
- `react-dom@19.2.7`
- `electron@42.4.0`
- `electron-vite@5.0.0`
- `vite@7.3.5`
- `@vitejs/plugin-react@5.2.0`
- `oxlint@1.70.0`
- `oxfmt@0.55.0`
- `vitest@4.1.9`
- `@vitest/coverage-v8@4.1.9`
- `@playwright/test@1.61.0`
- `@types/react@19.2.17`
- `@types/react-dom@19.2.3`

Reasoning:

- `electron-vite@5.0.0` peers with Vite 5, 6, or 7, so `vite@8.0.16` was not compatible.
- `@vitejs/plugin-react@6.0.2` peers with Vite 8, so `@vitejs/plugin-react@5.2.0` was used with Vite 7.
- `electron@42.4.1` was blocked by the repo's npm minimum release age gate, so `electron@42.4.0` was used.

### Electron Main Process

- Added `src/main/window-options.ts` for secure `BrowserWindow` options:
  - `contextIsolation: true`
  - `sandbox: true`
  - `nodeIntegration: false`
  - `webSecurity: true`
  - `webviewTag: false`
  - `allowRunningInsecureContent: false`
  - `experimentalFeatures: false`
- Added `src/main/app-origin-policy.ts` as the canonical renderer trust boundary.
- Restricted allowed renderer URLs to:
  - the packaged `dist/renderer/index.html` file URL
  - the configured electron-vite dev origin when explicitly set
- Rejected arbitrary `file:`, `http:`, `https:`, `javascript:`, and malformed URLs.
- Added fail-closed validation for invalid `ELECTRON_RENDERER_URL`.
- Added `src/main/bootstrap.ts` so renderer target and origin policy creation run inside the guarded `app.whenReady()` startup path.
- Added startup error handling that logs `Failed to start Pi GUI` and exits with code `1`.
- Denied Electron permission requests by default.
- Denied all `window.open` calls.
- Added CSP via Electron session headers, with production and Vite-dev variants.

### Preload Bridge And Shared Contracts

- Added `src/shared/contracts.ts` for shared `AppInfo` and `APP_GET_INFO_CHANNEL`.
- Added `src/preload/index.ts` and `src/preload/pi-gui-api.ts`.
- Exposed only:

```ts
window.piGui.getAppInfo(): Promise<AppInfo>
```

- Did not expose raw `ipcRenderer`, Electron objects, Node APIs, or dynamic channel names.
- Added `src/preload/window.d.ts` for renderer typing.
- Added sender-origin validation for the `app:get-info` IPC handler.

### Renderer Shell

- Added `src/renderer/index.html`.
- Added `src/renderer/main.tsx`.
- Added `src/renderer/app/App.tsx`.
- Added `src/renderer/styles/app.css`.
- Rendered a minimal three-region app shell:
  - sidebar
  - session timeline
  - composer/status
- Included loading, ready, and failure states.
- Used plain CSS variables and static styles only.
- Did not add Tailwind, icon libraries, motion libraries, or product/runtime UI.

## Implementation Plan

### Task 1: Create GUI Package Skeleton

**Files:**

- Create: `packages/gui/package.json`
- Create: `packages/gui/CHANGELOG.md`
- Create: `packages/gui/tsconfig.json`
- Create: `packages/gui/tsconfig.build.json`

**Step 1: Add package manifest**

Create `@earendil-works/pi-gui` with exact pinned dependencies and scripts for development, build, lint, format, typecheck, unit tests, coverage, Electron smoke tests, and package-local `check`.

**Step 2: Add TypeScript configs**

Extend `../../tsconfig.base.json`, add DOM libs and `jsx: "react-jsx"` locally, include GUI `src`, `test`, and config files, and keep root Node-oriented typechecking separate.

**Step 3: Add changelog**

Create `packages/gui/CHANGELOG.md` and add the Phase 1 package under `[Unreleased] -> Added`.

**Step 4: Verify package metadata**

Run:

```bash
npm --prefix packages/gui run typecheck
```

Expected: Typecheck passes once source files exist.

### Task 2: Configure Electron-Vite

**Files:**

- Create: `packages/gui/electron.vite.config.ts`
- Create: `packages/gui/src/main/main.ts`
- Create: `packages/gui/src/preload/index.ts`
- Create: `packages/gui/src/renderer/index.html`
- Create: `packages/gui/src/renderer/main.tsx`

**Step 1: Add failing build expectation**

Run:

```bash
npm --prefix packages/gui run build
```

Expected before implementation: build fails because entrypoints do not exist.

**Step 2: Add electron-vite config**

Configure main, preload, and renderer entrypoints. Preload output must be CommonJS `index.js` because sandboxed preload scripts are executed as classic scripts.

**Step 3: Add minimal entrypoints**

Add empty but valid main, preload, HTML, and React root entrypoints.

**Step 4: Verify build**

Run:

```bash
npm --prefix packages/gui run build
```

Expected: Electron main, preload, and renderer bundles are emitted.

### Task 3: Add Secure BrowserWindow And Origin Policy

**Files:**

- Create: `packages/gui/src/main/window-options.ts`
- Create: `packages/gui/src/main/app-origin-policy.ts`
- Create: `packages/gui/src/main/window.ts`
- Test: `packages/gui/test/main/window-options.test.ts`
- Test: `packages/gui/test/main/app-origin-policy.test.ts`

**Step 1: Write failing secure-window tests**

Assert `createMainWindowOptions()` returns secure `webPreferences`.

**Step 2: Write failing origin-policy tests**

Assert packaged renderer URLs are allowed, arbitrary local files are blocked, configured dev origins are allowed, external origins are blocked, and invalid dev renderer URLs fail closed.

**Step 3: Implement secure window options**

Add `contextIsolation`, `sandbox`, disabled Node integration, and related secure defaults.

**Step 4: Implement origin policy**

Allow only the known packaged renderer entrypoint or explicitly configured electron-vite dev origin.

**Step 5: Verify tests**

Run:

```bash
npm --prefix packages/gui run test:run -- test/main/window-options.test.ts test/main/app-origin-policy.test.ts
```

Expected: Both test files pass.

### Task 4: Add Guarded Startup Bootstrap

**Files:**

- Create: `packages/gui/src/main/bootstrap.ts`
- Modify: `packages/gui/src/main/main.ts`
- Test: `packages/gui/test/main/bootstrap.test.ts`

**Step 1: Write failing bootstrap test**

Assert invalid `ELECTRON_RENDERER_URL` is handled through the guarded startup path after `app.whenReady()`, logs `Failed to start Pi GUI`, and exits with code `1`.

**Step 2: Implement bootstrap seam**

Move renderer target and origin policy creation into `startPiGui()`, called from `main.ts`. Keep `main.ts` as thin Electron wiring.

**Step 3: Verify startup test**

Run:

```bash
npm --prefix packages/gui run test:run -- test/main/bootstrap.test.ts
```

Expected: Startup failure handling test passes.

### Task 5: Add CSP And IPC Boundary

**Files:**

- Create: `packages/gui/src/main/content-security-policy.ts`
- Create: `packages/gui/src/main/ipc.ts`
- Create: `packages/gui/src/main/app-info.ts`
- Create: `packages/gui/src/shared/contracts.ts`
- Test: `packages/gui/test/main/content-security-policy.test.ts`
- Test: `packages/gui/test/main/ipc.test.ts`
- Test: `packages/gui/test/main/app-info.test.ts`

**Step 1: Write failing CSP tests**

Assert production CSP is strict and dev CSP only adds Vite/HMR allowances.

**Step 2: Write failing IPC tests**

Assert trusted renderer senders receive app info and untrusted or missing sender frames are rejected.

**Step 3: Implement shared contracts**

Move `AppInfo` and `APP_GET_INFO_CHANNEL` to `src/shared/contracts.ts`.

**Step 4: Implement CSP registration**

Set CSP using Electron session `webRequest.onHeadersReceived`.

**Step 5: Implement IPC handler**

Register `app:get-info` with sender-origin validation.

**Step 6: Verify tests**

Run:

```bash
npm --prefix packages/gui run test:run -- test/main/content-security-policy.test.ts test/main/ipc.test.ts test/main/app-info.test.ts
```

Expected: CSP, IPC, and app-info tests pass.

### Task 6: Add Preload API

**Files:**

- Create: `packages/gui/src/preload/index.ts`
- Create: `packages/gui/src/preload/pi-gui-api.ts`
- Create: `packages/gui/src/preload/window.d.ts`
- Test: `packages/gui/test/preload/pi-gui-api.test.ts`

**Step 1: Write failing preload API test**

Assert the API exposes only `getAppInfo` and invokes only `app:get-info`.

**Step 2: Implement preload bridge**

Expose `window.piGui` through `contextBridge.exposeInMainWorld`.

**Step 3: Verify preload test**

Run:

```bash
npm --prefix packages/gui run test:run -- test/preload/pi-gui-api.test.ts
```

Expected: Preload API test passes.

### Task 7: Add Minimal Renderer Shell

**Files:**

- Create: `packages/gui/src/renderer/app/App.tsx`
- Create: `packages/gui/src/renderer/styles/app.css`
- Modify: `packages/gui/src/renderer/main.tsx`
- Modify: `packages/gui/src/renderer/index.html`
- Test: `packages/gui/test/shared/process-boundaries.test.ts`

**Step 1: Write process-boundary test**

Assert renderer and preload do not import from `src/main/**`.

**Step 2: Implement shell UI**

Render loading, failure, and ready states. The ready state contains the sidebar, timeline, and composer/status regions.

**Step 3: Keep styling local and minimal**

Use plain CSS. Do not add Tailwind, icon packages, or runtime UI controls.

**Step 4: Verify process-boundary test**

Run:

```bash
npm --prefix packages/gui run test:run -- test/shared/process-boundaries.test.ts
```

Expected: Process-boundary test passes.

### Task 8: Add GUI Tooling And Root Integration

**Files:**

- Create: `packages/gui/oxlint.config.ts`
- Create: `packages/gui/oxfmt.config.ts`
- Create: `packages/gui/vitest.config.ts`
- Create: `packages/gui/playwright.config.ts`
- Modify: `package.json`
- Modify: `biome.json`
- Modify: `tsconfig.json`
- Test: `packages/gui/test/root-typescript-scope.test.ts`

**Step 1: Write root TypeScript scope test**

Assert root `tsconfig.json` does not add DOM/JSX globals and excludes `packages/gui/**`.

**Step 2: Add Oxc configs**

Configure `oxlint` with React, React hooks, TypeScript, Oxc, correctness, suspicious, and performance categories. Configure `oxfmt` with tabs, semicolons, trailing commas, `printWidth: 120`, and package JSON sorting.

**Step 3: Wire root checks**

Add `check:gui` and append it to root `check`. Exclude GUI from root Biome ownership.

**Step 4: Verify GUI check**

Run:

```bash
npm --prefix packages/gui run check
```

Expected: format, lint, typecheck, and unit tests pass.

### Task 9: Add Electron Smoke Test

**Files:**

- Create: `packages/gui/test/electron/shell.spec.ts`
- Modify: `packages/gui/playwright.config.ts`

**Step 1: Write Electron smoke test**

Assert the app launches, renders the shell, exposes only `window.piGui.getAppInfo`, returns app metadata, and does not expose `window.process`, `window.require`, `window.ipcRenderer`, or raw Electron APIs.

**Step 2: Verify smoke test**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected: Electron app builds and smoke test passes.

### Task 10: Final Verification

**Files:**

- All Phase 1 files.

**Step 1: Run GUI package check**

Run:

```bash
npm --prefix packages/gui run check
```

Expected: Pass.

**Step 2: Run Electron smoke test**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected: Pass.

**Step 3: Run root check**

Run:

```bash
npm run check
```

Expected: Pass.

**Step 4: Remove generated test metadata**

Ensure `packages/gui/test-results/.last-run.json` is not staged or committed.

**Step 5: Commit**

Use:

```bash
git add package.json package-lock.json biome.json tsconfig.json packages/gui docs/plans/2026-06-18-pi-native-gui-phase-1-plan-and-report.md
git commit -m "feat(gui): add secure Pi native desktop shell"
```

## Verification Completed

The implemented Phase 1 work was verified with:

```bash
npm --prefix packages/gui run check
npm --prefix packages/gui run test:electron
npm run check
```

All passed.

The Electron smoke test requires macOS GUI launch permission when run from the managed sandbox.

`npm audit` was not run because it sends private dependency graph metadata to npm's external advisory service. Run it only with explicit approval.

## Follow-Up For Phase 2

- Add Effect Schema command/event contracts at the IPC boundary.
- Replace the temporary `getAppInfo`-only bridge with typed GUI command/event APIs.
- Introduce the Pi SDK/session driver in Electron main only.
- Keep renderer free of Node, Electron, and Pi runtime imports.
- Reuse `AppOriginPolicy`, `startPiGui`, shared contracts, and sender validation for all future IPC.

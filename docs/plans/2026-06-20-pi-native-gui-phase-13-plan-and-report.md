# Pi Native GUI Phase 13 Implementation Plan And Report

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the Pi native GUI for release readiness by closing security gaps, restoring strict coverage gates, fixing Electron E2E build parity, and documenting the package architecture and verification workflow.

**Architecture:** Phase 13 is a hardening phase, not a feature phase. Electron main remains the owner of Pi runtime sessions, shell operations, filesystem access, share/export, settings, resources, and all external URL opening; preload exposes only the typed `piGui` bridge; the renderer remains a projection over Effect Schema validated commands, events, snapshots, and errors. The implementation keeps the SDK-first desktop architecture and does not add a WebSocket server, subprocess runtime boundary, or renderer-owned privileged state.

**Tech Stack:** Electron, Effect Schema, TypeScript, React, `useSyncExternalStore`, Vitest with V8 coverage, Playwright Electron, happy-dom, oxlint, oxfmt, Pi coding-agent runtime.

---

## Phase 13 Scope

Phase 13 is the **Hardening And Release Readiness** phase for `packages/gui`.

In scope:

- Fix the Phase 12 external artifact URL security finding.
- Move shell-openable external artifact validation to an Electron main-process policy.
- Keep contract-level URL helpers as serialization sanity checks only.
- Preserve tracked artifact IDs as the only renderer authority for file and external artifact opening.
- Fix Electron E2E runtime shim parity so main-process imports resolve in fake-runtime builds.
- Restore strict coverage gates without lowering thresholds.
- Add meaningful tests for the high-risk hardening areas:
  - artifact URL policy
  - share service success and failure paths
  - command runner failures and timeouts
  - runtime shim exports
  - resource bridge failure paths
  - session export guards
  - SDK session adapter branches
  - fake session driver parity
  - renderer artifact, tree, compaction, and Control Plane store behavior
- Add package documentation for GUI commands, architecture boundaries, artifact/share security, extension compatibility, and troubleshooting.
- Re-run package, coverage, Electron E2E, root, staged hygiene, and internal-label checks.
- Use `oxlint` and `oxfmt` as the package lint/format gates.

Out of scope:

- New P2 GUI features.
- Packaged app signing or notarization.
- Real-provider Electron E2E.
- Cloud share providers beyond GitHub gist.
- Remote runtime transport.
- Node WebSocket server or browser/server runtime boundary.
- Renderer imports of Electron, Node, Pi SDK runtime, or main-process modules.
- Broad rewrites of large orchestration files.

## Current Baseline

Before Phase 13:

- The GUI had the P1 desktop feature surface in place.
- `npm --prefix packages/gui run check` passed with 248 Vitest tests.
- `npm --prefix packages/gui run test:coverage` failed the configured gates:
  - statements: 70.96%
  - branches: 61.97%
  - functions: 71.1%
  - lines: 73.32%
- `npm --prefix packages/gui run test:electron` failed at build time because `share-service.ts` imported `getShareViewerUrl`, but `src/main/test-runtime-shim.ts` did not export it.
- External artifact URL validation still used the broad contract helper and allowed arbitrary HTTPS URLs through the shell-open policy.
- Phase 12 had no `packages/gui/README.md` describing development commands, security model, fake-runtime mode, or troubleshooting.

Phase 13 builds on the existing Pi-native architecture:

- Main process owns runtime truth and privileged desktop effects.
- Preload exposes a narrow typed bridge.
- Renderer sends typed command IDs and artifact IDs, not arbitrary privileged values.
- Effect Schema contracts validate the IPC boundary.
- Tests use fake runtime mode and deterministic adapters, not real providers or GitHub CLI credentials.

## Implemented Changes

### Artifact And Share Security

- Added `packages/gui/src/main/artifacts/artifact-url-policy.ts`.
- Added `createExternalArtifactUrlPolicy()`.
- Allowed GitHub gist URLs only through the main-process artifact URL policy.
- Allowed Pi share preview URLs only when they exactly match the configured `getShareViewerUrl(gistId)` result.
- Required share preview URLs to use HTTPS and include a non-empty hash/gist ID.
- Rejected arbitrary HTTPS URLs such as `https://example.com/session/#abc123`.
- Rejected wrong share hosts, wrong paths, missing hashes, empty hashes, malformed URLs, and malformed configured preview factories.
- Updated `ArtifactService` so `trackExternal()` uses the main-process artifact URL policy instead of the broad contract helper.
- Kept `ArtifactServiceOptions.isAllowedExternalUrl` only as a deterministic test seam.
- Updated `ShareService` to inject only share preview URL generation through `getShareViewerUrl`.
- Removed caller-provided share preview allow-list injection from `ShareServiceOptions`.
- Derived `ShareService` preview validation internally from the configured `getShareViewerUrl` factory.
- Kept `shell.openExternal()` behind tracked artifact IDs and the main-owned artifact registry.

### Electron E2E Runtime Shim

- Exported `getShareViewerUrl(gistId)` from `src/main/test-runtime-shim.ts`.
- Added deterministic fake-runtime exports needed by Electron E2E builds:
  - `detectSupportedImageMimeTypeFromFile`
  - `resizeImage`
  - `formatDimensionNote`
- Kept fake runtime mode provider-free and deterministic.
- Aligned fake-runtime image MIME sniffing with production behavior:
  - reads only the bounded 4100 byte sniff window
  - rejects JPEG-LS
  - validates PNG IHDR shape
  - rejects animated PNG
  - accepts supported JPEG, PNG, GIF, and WebP signatures
- Kept unsupported Pi SDK factories explicit by throwing clear fake-runtime errors.

### Coverage Hardening

- Added focused artifact service tests for:
  - arbitrary HTTPS rejection
  - wrong share preview path rejection
  - missing hash rejection
  - injected artifact URL policy behavior
  - wrong artifact kind behavior
  - shell failure wrapping
- Added artifact URL policy tests for:
  - GitHub gist URLs
  - configured share preview URLs
  - non-HTTPS URLs
  - wrong host
  - wrong path
  - extra query parameters
  - missing hash
  - empty hash
  - malformed configured preview factory
- Added share service tests for:
  - successful share
  - injected share preview URL generation
  - malformed generated preview URL rejection
  - missing GitHub CLI
  - unauthenticated GitHub CLI
  - upload failure
  - malformed gist URL output
  - timeout mapping
- Added default command runner tests for:
  - mocked `gh auth status`
  - mocked `gh gist create`
  - `spawn` ENOENT mapping
  - timeout kill behavior
  - per-test `spawn` mock reset
- Added runtime shim tests for:
  - deterministic paths and defaults
  - unavailable runtime factory errors
  - MIME sniffing parity
  - no-op image resize helpers
  - dimension note formatting
- Added resource bridge service tests for:
  - active session inventory delegation
  - workspace reload result selection
  - source open failure wrapping
  - source reveal failure wrapping
  - unavailable sources
  - missing workspaces
  - reload read failures
- Added fake session driver tests for:
  - tree navigation
  - labels
  - compaction
  - exports
  - slash command snapshots
  - closed runtime rejection
  - active run closure behavior
- Added Pi SDK session driver tests for:
  - queue projection
  - slash commands
  - export paths
  - tree navigation projection
  - tree labels
  - compaction projection
  - runtime adapter failure mapping
  - model registry and auth gating
- Added session export tests for:
  - idle export with artifact tracking
  - export without artifact tracker
  - export rejection during active run
  - export rejection during manual compaction
  - export rejection during tree navigation
- Added renderer store and Control Plane tests for:
  - attachment and artifact command routing
  - export/share error state
  - settings patch construction
  - editor draft normalization
  - trust/settings/resource tab rendering
  - resource button action routing
  - tree loading
  - tree navigation result application
  - tree cancellation state
  - compaction result application
  - compaction cancellation error state
  - Control Plane partial load failures
  - targeted trust/resource/settings updates

### Documentation

- Added `packages/gui/README.md`.
- Documented GUI development commands:
  - `format:check`
  - `lint`
  - `typecheck`
  - `test:run`
  - `test:coverage`
  - `test:electron`
  - package `check`
  - root `npm run check`
- Documented the main/preload/renderer architecture split.
- Documented `SessionDriver` as the production runtime seam.
- Documented `FakeSessionDriver` as deterministic test and E2E infrastructure.
- Documented artifact/share security:
  - file artifacts are opened by tracked artifact ID
  - external artifacts are shell-openable only after main-process policy approval
  - arbitrary HTTPS URLs are rejected
- Documented extension compatibility:
  - native
  - rendered
  - reported unsupported
  - deferred
- Documented troubleshooting for:
  - Electron launch failure
  - E2E build shim failure
  - coverage failure
  - share failure
  - sandbox and permissions

### Hygiene And Release Readiness

- Removed generated `packages/gui/test-results/.last-run.json` from the worktree after Electron E2E runs.
- Kept planning docs untracked and out of the staged GUI commit unless explicitly requested.
- Ran staged scans for:
  - skipped tests
  - focused tests
  - `console.log`
  - internal phase labels
  - forbidden renderer imports
- Verified no staged renderer imports of Electron, Node, Pi SDK runtime, or main-process modules.
- Verified no staged internal phase labels in GUI source, tests, or README.
- Verified no staged broad renderer authority over shell paths or external URLs.

## Implementation Plan

### Task 1: Add Main-Process Artifact URL Policy

**Files:**

- Create: `packages/gui/src/main/artifacts/artifact-url-policy.ts`
- Modify: `packages/gui/src/main/artifacts/artifact-service.ts`
- Test: `packages/gui/test/main/artifacts/artifact-service.test.ts`
- Test: `packages/gui/test/main/artifacts/artifact-url-policy.test.ts`

**Step 1: Write failing artifact service security tests**

Add tests that assert:

- `trackExternal("https://example.com/session/#abc123")` throws `ArtifactOpenFailed`.
- `trackExternal("https://pi.dev/not-session/#abc123")` throws `ArtifactOpenFailed`.
- `trackExternal("https://pi.dev/session/")` throws `ArtifactOpenFailed`.
- Valid configured share preview URLs still track and open.

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/artifact-service.test.ts
```

Expected:

- New arbitrary HTTPS rejection tests fail before implementation.

**Step 2: Write failing artifact URL policy tests**

Add tests that assert:

- GitHub gist URLs pass.
- Configured Pi share preview URLs pass.
- Non-HTTPS URLs fail.
- Wrong hosts fail.
- Wrong paths fail.
- Missing or empty hash fails.
- Malformed configured preview factory fails.

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/artifact-url-policy.test.ts
```

Expected:

- New policy tests fail because the policy module does not exist.

**Step 3: Implement minimal policy module**

Create `createExternalArtifactUrlPolicy()` with:

- default `getShareViewerUrl` from `@earendil-works/pi-coding-agent/runtime`
- optional `getShareViewerUrl` test seam
- GitHub gist URL allow-list
- exact share preview URL comparison against `getShareViewerUrl(gistId)`
- safe `URL` parsing that returns `false` for malformed values

**Step 4: Wire `ArtifactService` to the policy**

Update `ArtifactService`:

- replace contract helper usage with `this.isAllowedExternalUrl`
- default to `createExternalArtifactUrlPolicy()`
- keep `isAllowedExternalUrl` as an optional deterministic test seam
- keep `shell.openExternal()` unchanged and reachable only through tracked external artifact IDs

**Step 5: Run focused tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/artifact-service.test.ts test/main/artifacts/artifact-url-policy.test.ts
```

Expected:

- Tests pass.

### Task 2: Harden Share Service URL Generation And Command Runner Coverage

**Files:**

- Modify: `packages/gui/src/main/artifacts/share-service.ts`
- Modify: `packages/gui/test/main/artifacts/share-service.test.ts`
- Create: `packages/gui/test/main/artifacts/share-service-process.test.ts`

**Step 1: Write failing share service preview policy test**

Add a test that injects:

```ts
getShareViewerUrl: (gistId) => `http://share.local/session/#${gistId}`
```

Expected assertion:

- `share()` rejects with message `Share preview URL is not allowed`.
- `trackExternal` is not called.

**Step 2: Remove broad preview policy injection**

Update `ShareServiceOptions`:

- keep `getShareViewerUrl?: ShareViewerUrlFactory`
- remove caller-provided `isAllowedPreviewUrl`

Update constructor:

- assign `this.getShareViewerUrl`
- derive `this.isAllowedPreviewUrl = createExternalArtifactUrlPolicy({ getShareViewerUrl: this.getShareViewerUrl })`

**Step 3: Add default command runner tests**

Create process-level tests that mock `node:child_process` `spawn`.

Cover:

- successful `gh auth status` and `gh gist create`
- ENOENT maps to `SessionShareUnavailable`
- timeout kills the child and maps to a timed-out share failure

Add:

```ts
beforeEach(() => {
  vi.mocked(spawn).mockReset();
});
```

**Step 4: Run focused share tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/share-service.test.ts test/main/artifacts/share-service-process.test.ts
```

Expected:

- Tests pass.

### Task 3: Fix Electron E2E Runtime Shim Parity

**Files:**

- Modify: `packages/gui/src/main/test-runtime-shim.ts`
- Create: `packages/gui/test/main/test-runtime-shim.test.ts`

**Step 1: Run Electron E2E to reproduce build failure**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected before implementation:

- Build fails because `getShareViewerUrl` is missing from the fake-runtime shim.

**Step 2: Add runtime shim exports**

Add deterministic exports:

- `getShareViewerUrl(gistId)`
- `detectSupportedImageMimeTypeFromFile(filePath)`
- `resizeImage(inputBytes, mimeType)`
- `formatDimensionNote(result)`

Keep runtime factory exports throwing explicit fake-runtime errors.

**Step 3: Mirror production MIME sniffing semantics**

Implement:

- bounded file read of 4100 bytes
- JPEG-LS rejection when byte 4 is `0xf7`
- PNG IHDR validation
- APNG rejection when `acTL` appears before `IDAT`
- GIF and WebP signature detection

Do not add dynamic imports or provider-dependent behavior.

**Step 4: Add runtime shim tests**

Cover:

- deterministic agent/session/share paths
- default settings values
- unsupported runtime factory errors
- JPEG, PNG, GIF, WebP detection
- invalid PNG rejection
- APNG rejection
- JPEG-LS rejection
- no-op resize and dimension note formatting

**Step 5: Run focused shim tests**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/test-runtime-shim.test.ts
```

Expected:

- Tests pass.

### Task 4: Restore Coverage Gates With Focused Tests

**Files:**

- Modify: `packages/gui/test/main/resources/resource-bridge-service.test.ts`
- Modify: `packages/gui/test/main/session/fake-session-driver.test.ts`
- Modify: `packages/gui/test/main/session/pi-sdk-session-driver.test.ts`
- Create: `packages/gui/test/main/session/session-export.test.ts`
- Modify: `packages/gui/test/renderer/control-plane.test.tsx`
- Create: `packages/gui/test/renderer/desktop-artifacts-store.test.ts`
- Create: `packages/gui/test/renderer/tree-and-control-plane-store.test.ts`

**Step 1: Add resource bridge tests**

Cover:

- active session inventory delegation
- workspace reload result selection
- source open failure wrapping
- source reveal failure wrapping
- unavailable source errors
- missing workspace errors
- reload read failure wrapping

**Step 2: Add fake session driver tests**

Cover:

- tree navigation for user entries restores composer text
- tree navigation for assistant entries clears composer text
- missing tree entries fail
- labels trim and clear
- compaction returns deterministic summary
- export returns deterministic paths
- slash command snapshots include fake extension, prompt, and skill commands
- closed runtime handles reject later access

**Step 3: Add Pi SDK session driver tests**

Cover:

- queue projection
- slash command availability projection
- tree navigation projection
- tree label projection
- compaction projection
- export path projection
- failure mapping for tree, export, compaction, queue, resources, and thinking
- model registry and auth gating

**Step 4: Add session export tests**

Cover:

- idle export with artifact tracker
- export without artifact tracker
- export rejected during active run
- export rejected during manual compaction
- export rejected during tree navigation

**Step 5: Add renderer store tests**

Cover:

- artifact and attachment command routing through typed renderer API
- export/share error state
- tree load and navigation state
- compaction result and cancel error state
- Control Plane load success
- Control Plane partial failure
- targeted trust/resource/settings updates

**Step 6: Add Control Plane render tests**

Cover:

- settings draft normalization
- common settings patch creation
- trust/settings/resource tab loaded states
- empty states
- resource reload/open/reveal action routing

**Step 7: Run focused test groups**

Run:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run \
  test/main/resources/resource-bridge-service.test.ts \
  test/main/session/fake-session-driver.test.ts \
  test/main/session/pi-sdk-session-driver.test.ts \
  test/main/session/session-export.test.ts \
  test/renderer/control-plane.test.tsx \
  test/renderer/desktop-artifacts-store.test.ts \
  test/renderer/tree-and-control-plane-store.test.ts
```

Expected:

- Focused tests pass.

### Task 5: Add GUI Release Readiness Documentation

**Files:**

- Create: `packages/gui/README.md`

**Step 1: Document development commands**

Document:

- package format, lint, typecheck, test, coverage, Electron E2E, and check commands
- root verification command
- fake runtime mode constraints

**Step 2: Document architecture boundaries**

Document:

- main process responsibilities
- preload bridge responsibilities
- renderer responsibilities
- `PiSdkSessionDriver` production seam
- `FakeSessionDriver` deterministic test seam

**Step 3: Document artifact/share security**

Document:

- file artifacts use tracked artifact IDs
- external artifacts require main-process allow-list approval
- GitHub gist and configured Pi share preview URLs are allowed
- arbitrary HTTPS URLs are rejected

**Step 4: Document extension compatibility and troubleshooting**

Document:

- native extension surfaces
- rendered surfaces
- reported unsupported cases
- deferred cases
- Electron launch failure
- E2E shim failure
- coverage failure
- share failure
- sandbox and permissions

### Task 6: Run Full Verification And Hygiene

**Files:**

- Verify staged GUI source, tests, and README.
- Keep untracked planning docs out of staged GUI commit unless explicitly requested.

**Step 1: Run package check**

Run:

```bash
npm --prefix packages/gui run check
```

Expected:

- `format:check`, `lint`, `typecheck`, and `test:run` pass.

**Step 2: Run coverage gate**

Run:

```bash
npm --prefix packages/gui run test:coverage
```

Expected:

- Coverage passes existing thresholds:
  - statements >= 80
  - branches >= 70
  - functions >= 80
  - lines >= 80

**Step 3: Run Electron E2E**

Run:

```bash
npm --prefix packages/gui run test:electron
```

Expected:

- Electron build succeeds.
- Playwright Electron tests pass.
- No real provider or GitHub CLI credentials are required.

**Step 4: Remove generated E2E state**

Remove if generated:

```bash
rm packages/gui/test-results/.last-run.json
```

Expected:

- No generated Playwright state remains in `git status`.

**Step 5: Run root check**

Run:

```bash
npm run check
```

Expected:

- Root check passes.
- Biome reports no fixes applied or only intentional changes are kept.

**Step 6: Run staged hygiene scans**

Run:

```bash
git diff --check --cached
git grep --cached -n -E "test\\.skip|describe\\.skip|\\.only\\(|console\\.log|phase [0-9]|Phase [0-9]" -- packages/gui
git grep --cached -n -E "from ['\"]electron|from ['\"]node:|from ['\"]@earendil-works/pi-coding-agent|from ['\"].*src/main|from ['\"].*/main/|require\\(['\"]electron|require\\(['\"]node:" -- packages/gui/src/renderer packages/gui/test/renderer
```

Expected:

- No whitespace errors.
- No skipped/focused tests.
- No `console.log`.
- No internal phase labels in shipped GUI source, tests, or README.
- No renderer imports of Electron, Node, Pi SDK runtime, or main-process modules.

## Verification Results

### Focused Tests

Command:

```bash
cd packages/gui
node ../../node_modules/vitest/dist/cli.js --run test/main/artifacts/share-service.test.ts test/main/artifacts/share-service-process.test.ts test/main/artifacts/artifact-url-policy.test.ts test/main/test-runtime-shim.test.ts
```

Result:

- 4 test files passed.
- 25 tests passed.

### Package Check

Command:

```bash
npm --prefix packages/gui run check
```

Result:

- `format:check` passed.
- `lint` passed.
- `typecheck` passed.
- `test:run` passed.
- 45 test files passed.
- 294 tests passed.

### Coverage

Command:

```bash
npm --prefix packages/gui run test:coverage
```

Result:

- 45 test files passed.
- 294 tests passed.
- Statements: 80.13%.
- Branches: 72.21%.
- Functions: 82.39%.
- Lines: 82.17%.
- Existing thresholds passed without lowering thresholds.

### Electron E2E

Command:

```bash
npm --prefix packages/gui run test:electron
```

Result:

- Electron build passed.
- 4 Playwright Electron tests passed.
- Fake runtime mode worked after shim parity fixes.

### Root Check

Command:

```bash
npm run check
```

Result:

- Biome checked 657 files and applied no fixes.
- Pinned dependency check passed.
- TypeScript relative import check passed.
- Coding-agent shrinkwrap check passed.
- Browser smoke check passed.
- GUI package check passed.

### Staged Hygiene

Commands:

```bash
git diff --check --cached
git grep --cached -n -E "test\\.skip|describe\\.skip|\\.only\\(|console\\.log|phase [0-9]|Phase [0-9]" -- packages/gui
git grep --cached -n -E "from ['\"]electron|from ['\"]node:|from ['\"]@earendil-works/pi-coding-agent|from ['\"].*src/main|from ['\"].*/main/|require\\(['\"]electron|require\\(['\"]node:" -- packages/gui/src/renderer packages/gui/test/renderer
```

Result:

- No staged whitespace errors.
- No staged skipped/focused tests.
- No staged `console.log`.
- No staged internal phase labels.
- No staged renderer imports of Electron, Node, Pi SDK runtime, or main-process modules.

## Final State

Phase 13 completed the intended hardening work:

- Arbitrary HTTPS external artifact URLs are rejected before shell opening.
- External shell opening is governed by a main-process allow-list policy.
- Share preview URL validation cannot be bypassed by injecting an independent allow-list into `ShareService`.
- Electron E2E fake-runtime shim exports match production imports.
- Fake-runtime image MIME behavior matches production semantics closely enough for deterministic E2E.
- Coverage gates pass without lowering thresholds.
- Electron E2E passes.
- Root check passes.
- GUI package docs now describe commands, architecture, security model, compatibility, and troubleshooting.

Known residual risks:

- Statement coverage passes with only a modest margin and should be kept under observation as new GUI code lands.
- P1 Electron E2E coverage still exercises the critical shell/session/extension flows, but not every P1 scenario listed in the broader release-readiness wishlist.
- Large orchestration files remain worth monitoring, but Phase 13 avoided broad rewrites by design.

## Suggested Commit Message

```text
fix(gui): harden artifact sharing and release readiness checks

- add main-process external artifact URL policy for GitHub gist and Pi share preview URLs
- reject arbitrary HTTPS artifact URLs before shell opening
- keep share preview allow-list derived from share URL generation instead of caller-provided policy
- align Electron fake-runtime shim with production share URL and image MIME behavior
- cover share failures, artifact policy edge cases, runtime shim exports, export/session guards, resource bridge errors, and renderer control-plane flows
- document GUI development commands, architecture boundaries, artifact/share security, extension compatibility, and troubleshooting
```

# Productionization TODO

Last updated: 2026-04-25

This file is the restart-friendly source of truth for productionization work. If a session fails, the next agent should start here, then read `AGENTS.md` and `README.md`.

## Locked Decisions

- [x] Keep `Vue 3 + Vite + TypeScript`.
- [x] Keep the app fully client-side and privacy-first. No backend, no tracking, no analytics by default.
- [x] Keep the modular tooling model. This is not reverting to a single-purpose deleted-messages app.
- [x] Keep the shared multi-account auth/session pipeline as platform infrastructure reused by all modules.
- [x] Keep `Scheduled Messages` and `LLM Context Export` as first-class modules in the same app.
- [x] Keep `GramJS` for user MTProto flows in the short term, but isolate it behind a typed gateway and move heavy work off the main thread.
- [x] Keep bot support via HTTP Bot API where MTProto is unnecessary.
- [ ] Decide the long-term product/repo naming strategy. The repository name still reflects the older deleted-messages scope.

## Audit Snapshot

Audit run on 2026-04-25:

- Passed: `npm run lint`
- Passed: `npm run check:i18n`
- Passed: `npm run type-check`
- Passed: `npm run test:unit`
- Passed: `npm run test:component`
- Passed: `npm run build`

Current risks and hotspots:

- `src/services/telegram/client.ts` is about 1900 lines and concentrates too many concerns.
- `src/components/auth/LoginModal.vue` is about 1000 lines and owns too much auth orchestration/UI state.
- `src/modules/export-deleted/ExportView.vue` and `src/modules/resend/ResendView.vue` are both very large route components.
- The production build succeeds but still emits GramJS/browser-shim warnings and ships a main chunk around `1.23 MB` minified.
- Secrets are still persisted in `localStorage` today (`accounts`, `api credentials`, session strings).
- Tests are good at the pure-service layer, but the Telegram integration itself is mostly mocked rather than directly covered.
- Public docs lag behind the real product direction. They still describe a narrower feature set than the app actually targets.

## Progress Update

Completed on this branch so far:

- Documentation was aligned around the modular product direction.
- Dependency versions were pinned and local/CI installs were moved to deterministic `npm ci`.
- Node/tooling policy files were added (`.nvmrc`, `.node-version`, `.npmrc`, `engines.node`).
- CI now enforces coverage and bundle-budget checks and gates preview/deploy paths behind the main quality bar.
- A typed Telegram gateway scaffold now wraps the legacy singleton behind explicit domains.
- Service-layer consumers for export, resend, scheduled messages, and LLM export now use the gateway instead of importing the legacy singleton directly.

## Definition Of Done

The productionization effort is done only when all of the following are true:

- Builds are deterministic and use pinned dependency versions.
- CI uses `npm ci`, enforces the full quality gate, and has meaningful bundle/test thresholds.
- Telegram integration is split into typed, testable boundaries instead of a single giant service.
- Long-running Telegram operations do not block the main UI thread.
- Secrets are no longer stored in plaintext `localStorage`.
- The app has a stable shell for modular tools, jobs, account state, and recovery flows.
- All first-class modules have acceptable UX parity and consistent patterns.
- Integration and E2E coverage is strong enough to trust releases.
- Documentation matches the actual product vision and engineering workflow.

## Workstreams

| ID | Workstream | Goal | Primary Areas |
|----|------------|------|---------------|
| WS1 | Product and scope | Lock product direction and supported module set | `README.md`, `AGENTS.md`, `TODO.md` |
| WS2 | Toolchain and CI | Deterministic installs, stronger gates, safer releases | `package.json`, lockfile, `.github/workflows/` |
| WS3 | Telegram platform | Typed gateway, worker isolation, smaller service surface | `src/services/telegram/` |
| WS4 | Auth and accounts | Shared auth platform, session recovery, secure secret handling | `src/components/auth/`, `src/stores/accounts.ts` |
| WS5 | Storage and migration | Safer persistence, IndexedDB schema, quota and migration logic | `src/services/storage/`, `src/utils/` |
| WS6 | App shell and UX | Production shell, consistent navigation, job/status model | `src/App.vue`, `src/router/`, `src/views/`, shared components |
| WS7 | Module rewrite | Bring each module onto the new platform patterns | `src/modules/` |
| WS8 | Quality and release | Testing depth, accessibility, performance, launch checklist | `tests/`, CI, docs |

## Phase 0: Scope Lock And Freeze

Goal: make sure engineering is building the right product before rewriting architecture.

Tasks:

- [ ] Confirm the public product name and whether the repo should eventually be renamed.
- [x] Confirm that the first-class module set for the productionized app is:
  - `Account Info`
  - `Export Deleted Messages`
  - `Backups`
  - `Resend Messages`
  - `Scheduled Messages`
  - `LLM Context Export`
- [ ] Normalize how `Backups` is surfaced so docs, nav, and the landing/module registry tell the same story.
- [ ] Confirm whether any current modules should be hidden behind capability flags while being rebuilt.
- [ ] Decide which locales are fully maintained for launch versus best-effort.
- [ ] Define browser support targets.
- [ ] Freeze net-new feature work unless it directly supports productionization.

Exit criteria:

- Product scope is written down and accepted.
- Everyone agrees the app remains a modular Telegram tool platform.
- No future task assumes `Scheduled` or `LLM Export` are experimental by default.

## Phase 1: Toolchain And CI Hardening

Goal: make the repo reproducible before large refactors begin.

Tasks:

- [x] Replace `"latest"` dependency ranges in `package.json` with exact versions.
- [x] Switch CI workflows from `npm install` to `npm ci`.
- [x] Add an explicit Node version policy (`.nvmrc`, `.node-version`, or `engines`).
- [x] Add dependency update automation with review gates.
- [x] Add a bundle-size reporting step.
- [x] Add coverage thresholds for unit/component tests.
- [x] Make `build` depend on the same deterministic install path used in CI.
- [x] Review preview/deploy workflows to ensure they do not bypass failing gates.

Exit criteria:

- Fresh clone + `npm ci` works reliably.
- CI and local installs resolve to the same dependency tree.
- Dependency changes become deliberate instead of ambient.

## Phase 2: Telegram Platform Decomposition

Goal: replace the monolithic Telegram service with explicit boundaries.

Tasks:

- [x] Define gateway interfaces for:
  - auth/session
  - dialogs/chat discovery
  - admin log export
  - sender/entity resolution
  - media download
  - message/file send
  - scheduled messages
  - account info/profile
- [ ] Split `src/services/telegram/client.ts` into smaller modules behind those interfaces.
- [ ] Remove ad hoc lazy store imports where possible by pushing state sync upward.
- [ ] Introduce a single error model for recoverable auth errors, flood waits, revoked sessions, and retryable media/send failures.
- [ ] Move long-running Telegram operations into a Web Worker boundary where practical.
- [ ] Keep the browser shims centralized and minimal.
- [ ] Document exactly which GramJS behaviors are wrapped and which are passed through.

Exit criteria:

- No single Telegram service file owns the whole MTProto lifecycle.
- UI code depends on typed use-cases/gateways, not on one giant singleton API.
- Long-running MTProto work is isolated from the main thread or has a concrete worker migration plan with partial implementation started.

## Phase 3: Auth, Accounts, And Secret Storage

Goal: turn auth into a platform capability instead of route-local complexity.

Tasks:

- [ ] Replace the current `LoginModal.vue` flow ownership with a state-machine or use-case driven auth flow.
- [ ] Separate presentation state from auth orchestration logic.
- [ ] Migrate secrets out of plaintext `localStorage`.
- [ ] Decide whether encrypted IndexedDB uses:
  - browser-managed WebCrypto only
  - user-provided passphrase
  - device-local key wrapping strategy
- [ ] Implement migration from current `localStorage` data to the new storage model.
- [ ] Preserve multi-account session isolation and session recovery behavior.
- [ ] Make account switching resilient during in-flight work.
- [ ] Keep bot and user flows visually consistent while respecting capability differences.

Exit criteria:

- Auth steps are testable outside the modal component.
- Secrets are no longer stored as plain JSON in `localStorage`.
- Session migration is safe and documented.

## Phase 4: App Shell And UX Rewrite

Goal: move from landing-page-first prototype flows to a production tool workspace.

Tasks:

- [ ] Replace the current landing-grid-first shell with a persistent application shell.
- [ ] Add stable navigation for modules and account context.
- [ ] Add a shared jobs/progress area for export, resend, archive, and scheduled-message operations.
- [ ] Replace browser `confirm()` prompts with proper in-app confirmation UI.
- [ ] Remove first-run modal patterns that feel like prototype scaffolding.
- [ ] Standardize error, warning, retry, flood-wait, and reconnect states.
- [ ] Replace emoji-heavy functional UI with a consistent icon system.
- [ ] Keep the existing design principles from `AGENTS.md`:
  - minimal radius
  - subtle shadows
  - fast transitions
  - absolute dates
  - no hover-only controls
  - no floating/fake productivity chrome
- [ ] Ensure the shell works on desktop and mobile without hiding critical actions.

Exit criteria:

- The app reads like a cohesive workspace instead of separate large forms on isolated pages.
- Long-running work is visible, interruptible, and recoverable.
- The UI language is consistent across all modules.

## Phase 5: Module Rewrites

Goal: port each first-class module onto the new platform patterns without shrinking product scope.

### 5.1 Account Info

- [ ] Separate user and bot capability mapping from the view layer.
- [ ] Improve session-health display and recovery actions.
- [ ] Add stronger tests around account switching and stale sessions.

### 5.2 Export Deleted Messages

- [ ] Split chat selection, export configuration, and progress orchestration into smaller pieces.
- [ ] Add clearer permissions preflight and export limitations.
- [ ] Make backup creation and ZIP generation feel like part of the job model, not one-off route logic.
- [ ] Re-check large-export handling and quota decisions.

### 5.3 Backups

- [ ] Rebuild backups as a management surface, not just a simple list.
- [ ] Add search, sorting, filters, and bulk actions.
- [ ] Make storage usage and cleanup strategy clearer.

### 5.4 Resend Messages

- [ ] Split configuration, preview, validation, and sending logic.
- [ ] Preserve HTML escaping and safe preview behavior.
- [ ] Make batching rules easier to inspect before starting a send job.

### 5.5 Scheduled Messages

- [ ] Keep this module as a first-class citizen in the shell.
- [ ] Reuse shared progress, flood-wait, and cancellation patterns.
- [ ] Harden delete flows, selection UX, and chat-level status handling.

### 5.6 LLM Context Export

- [ ] Keep this module in the main product.
- [ ] Make it explicit that this is an export/formatting workflow, not an embedded AI assistant.
- [ ] Separate formatting templates, archive construction, and UI orchestration.
- [ ] Audit the template/custom-format UX for i18n and injection safety.

Exit criteria:

- Every first-class module uses shared platform primitives.
- No module requires its own parallel auth/session architecture.
- UX and state handling feel consistent across modules.

## Phase 6: Testing, Security, And Performance

Goal: make releases trustworthy.

Tasks:

- [ ] Add direct tests around the Telegram gateway boundary instead of only mocking it from higher layers.
- [ ] Expand component coverage beyond `LoginModal`.
- [ ] Keep Playwright coverage for primary flows and add smoke coverage for all first-class modules.
- [ ] Add accessibility checks for keyboard navigation and visible focus states.
- [ ] Review all `v-html` and HTML parse-mode flows for safety.
- [ ] Remove or gate raw `console.*` usage behind a structured logger policy.
- [ ] Remove hardcoded user-facing TypeScript strings or intentionally document exceptions.
- [ ] Add bundle budgets and investigate the current large main chunk.
- [ ] Revisit GramJS/browser shim warnings until the acceptable residual set is documented.

Exit criteria:

- The hardest integration points have direct automated coverage.
- Build size and runtime warnings are understood and controlled.
- Security-sensitive flows have explicit review and tests.

## Phase 7: Release Readiness

Goal: ship a trustworthy productionized app rather than an endless refactor branch.

Tasks:

- [ ] Write migration notes for existing users.
- [ ] Finalize public docs and screenshots.
- [ ] Prepare release checklist and rollback plan.
- [ ] Run full manual QA on desktop/mobile and dark/light modes.
- [ ] Validate recovery from interrupted exports/resends and stale sessions.
- [ ] Re-run performance and bundle checks on the final build.

Exit criteria:

- Release steps are documented and repeatable.
- User data migration is understood.
- Docs describe the real product, not the old prototype.

## Suggested Parallel Agent Packets

If multiple agents are used later, keep write ownership disjoint.

Packet A: Docs and CI baseline

- Ownership: `README.md`, `TODO.md`, `AGENTS.md`, `.github/workflows/`, `package.json`
- Goal: lock scope, deterministic installs, quality gates, public docs

Packet B: Telegram platform split

- Ownership: `src/services/telegram/`, shims, related types
- Goal: decompose the giant Telegram service and define the new gateway boundary

Packet C: Auth and secrets

- Ownership: `src/components/auth/`, `src/stores/accounts.ts`, storage persistence for credentials/sessions
- Goal: state-machine auth flow and secure secret persistence

Packet D: Shell and shared UX

- Ownership: `src/App.vue`, `src/router/`, shared layout/common components
- Goal: persistent shell, navigation, job model, confirmations, system states

Packet E: Export, backups, resend

- Ownership: `src/modules/export-deleted/`, `src/views/BackupsView.vue`, `src/modules/resend/`, relevant services
- Goal: migrate core data workflows onto the new platform

Packet F: Scheduled and LLM export

- Ownership: `src/modules/scheduled/`, `src/services/scheduled/`, `src/modules/llm-export/`, `src/services/llm-export/`
- Goal: keep both advanced modules first-class while aligning them with the new shell and service patterns

## Restart Checklist

When a new session starts:

1. Read `TODO.md`, `AGENTS.md`, and `README.md`.
2. Run `git status --short` and do not overwrite unrelated user changes.
3. Confirm which phase and workstream are active.
4. Inspect the current hotspot files before editing:
   - `src/services/telegram/client.ts`
   - `src/components/auth/LoginModal.vue`
   - `src/modules/export-deleted/ExportView.vue`
   - `src/modules/resend/ResendView.vue`
   - `src/modules/scheduled/ScheduledView.vue`
   - `src/modules/llm-export/LlmExportView.vue`
5. Pick the next unchecked task in the active phase.
6. Update this file when decisions or status change.

## Verification Commands

Run the smallest useful set for the area you changed. Before a major merge, run all of them.

```bash
npm ci
npm run lint
npm run check:i18n
npm run type-check
npm run test:unit
npm run test:component
npm run test:e2e
npm run build
```

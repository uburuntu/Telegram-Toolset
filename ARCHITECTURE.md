# Production Architecture Plan

This document is the implementation plan for structural issues that cannot be solved safely with isolated patches. It complements `TODO.md`: the TODO defines priority, while this document defines the target boundaries, migration order, and acceptance criteria.

## Guardrails

- Keep the product browser-only, on-device, and free of analytics or backend dependencies.
- Preserve the modular workspace and the shared multi-account platform.
- Keep account removal recoverable by default. Hard deletion remains explicit and opt-in.
- Treat `Scheduled Messages` and `LLM Context Export` as production modules.
- Keep GramJS behind a browser-specific adapter; do not let its runtime types spread through the application.
- Prefer staged migrations with repair paths over destructive schema resets.
- Require a live Telegram smoke pass for changes to authentication, sessions, peers, or mutation semantics.

## Architectural Outcome

The target platform has five explicit layers:

1. **Identity and account repository** — stable Telegram principals, versioned local records, encrypted secrets, and recoverable ownership.
2. **Session coordinator** — the only component allowed to activate, authenticate, reconnect, or disconnect a Telegram user session.
3. **Account-affine job runtime** — request-scoped export, resend, scheduled, and archive jobs with immutable ownership and cancellation context.
4. **Typed Telegram gateway** — domain contracts using stable peer references and operation-specific retry semantics.
5. **Module workflows** — thin route components backed by testable state machines and a persistent job surface in the app shell.

These layers define dependency direction. The execution sequence below is the authoritative
migration order and inserts repository, bounded-execution, and release-confidence work at the
points where their prerequisites exist. UI decomposition before the platform contracts exist
would only move the current coupling into more files.

## 1. Stable Principal Identity

### Problem

`SavedAccount.id` is a random local UUID. Backups and LLM exports use it as their ownership authority, but user accounts do not persist Telegram's immutable user ID. Re-login updates the same local UUID, and archive recovery uses a phone number.

This creates three structural risks:

- A replacement login can bind an existing local account and its data to a different Telegram identity.
- Phone-number reassignment or formatting differences can recover the wrong data or fail to recover valid data.
- Loss of local account metadata can leave IndexedDB records permanently owned by an unreachable UUID.

Relevant boundaries:

- `src/types/account.ts`
- `src/components/auth/LoginModal.vue`
- `src/stores/accounts.ts`
- `src/services/storage/backup-manager.ts`
- `src/services/llm-export/store.ts`

### Target

Introduce a versioned principal model:

```ts
type TelegramPrincipal =
  | { kind: 'user'; telegramUserId: string }
  | { kind: 'bot'; telegramUserId: string }
```

- Keep the local UUID as an installation-scoped record key, not as proof of Telegram identity.
- Persist the principal on every account and account-owned record.
- Store canonical phone numbers only as display and recovery hints.
- Require a re-login to match the persisted principal. A mismatch creates a new account and archives the previous account's data.
- Add an explicit repair flow for records whose local owner metadata is missing or cannot be reconciled.
- Model record state on independent axes instead of adding overloaded ownership labels:
  - ownership verification: `verified | unverified | legacy`
  - lifecycle: `active | archived`
  - record health: `healthy | quarantined`
- Define legal transitions and authorization for each axis. Quarantine never grants ownership, and
  archive/recovery never silently upgrades verification.

### Migration

1. Add optional principal fields and write them for every newly authenticated account.
2. Backfill principals when an existing account next authenticates successfully.
3. Stamp new backups and exports with both local owner ID and principal.
4. Migrate old records onto the verification, lifecycle, and health axes; never guess silently.
5. Offer explicit claim/reconcile actions for ambiguous records.
6. Only make principal matching mandatory after the repair path is available.

### Exit criteria

- Re-login with a different Telegram user ID cannot inherit existing account-owned data.
- Removing and re-adding the same principal recovers its archived data.
- Phone formatting and number reassignment are not ownership authorities.
- Metadata loss produces a repairable quarantine state, not invisible records.
- Persisted state combinations and transitions are validated, and invalid combinations fail closed.

## 2. Session Coordination

### Problem

Session lifecycle is split between `useActiveUserSessionSync`, `LoginModal`, the account store, and the mutable `telegramService` singleton. User activation is partly serialized, while transitions to bot or no account can disconnect independently. Slow completions can therefore overwrite the final account selection.

### Target

Create one `TelegramSessionCoordinator` with a monotonic generation and a serialized command queue:

- `activate(accountId)`
- `deactivate()`
- `beginAuthentication(candidateCredentials)`
- `completeAuthentication(principal, session)`
- `reconnect(accountId)`
- `dispose()`

Every asynchronous completion must compare its captured generation before publishing state. The coordinator owns connection state; stores consume typed snapshots instead of inferring state from the GramJS client.

Candidate API credentials remain scoped to an authentication attempt and are committed only after successful authentication. Replacing shared credentials must be a separate explicit operation with rollback.

Before replacing a session, the coordinator cancels account-affine mutation jobs and waits only
to a defined deadline. A job that does not settle is fenced from further gateway calls, recorded
as `abandoned` or `delivery_uncertain`, and cannot block the session command queue indefinitely.

### Exit criteria

- Rapid user A → user B → bot → no-account transitions always end in the final requested state.
- No stale activation can reconnect after a later deactivation.
- Failed or cancelled login does not replace working shared credentials.
- Unauthorized and failed connections release network resources and report an honest typed state.
- Session lifecycle tests use deferred promises to exercise every ordering, not only happy paths.
- A never-settling gateway promise cannot block a later account activation beyond the configured
  cancellation deadline, and its late completion cannot publish state or start another mutation.

## 3. Account-Affine Job Runtime

### Problem

Long-running work is owned by route components or mutable singleton controllers. Some operations read the active account again at completion. Account removal archives existing records without waiting for in-flight writes. Cancellation generally stops UI orchestration but cannot cancel every GramJS or IndexedDB boundary.

Affected flows include deleted-message export, resend, scheduled scanning/deletion, chat-history export, archive construction, and ZIP generation.

### Target

Introduce request-scoped jobs with immutable context:

```ts
interface JobContext {
  operationId: string
  accountId: string
  principal: TelegramPrincipal
  sessionGeneration: number
  peer?: PeerRef
  signal: AbortSignal
}
```

- Jobs own their controller; services do not expose shared mutable controllers.
- Callbacks and persistence commits verify operation ID, account ID, and session generation.
- Export ownership is captured at job creation and never read from current global state.
- Persistence is part of the job, not a route-level continuation.
- Account removal advances a durable account epoch and marks the account `quiescing`
  transactionally. Every tab rejects new jobs and stale commits for the prior epoch before data is
  archived.
- Cancellation has a bounded deadline. Jobs that cannot settle are durably fenced as abandoned;
  ambiguous mutations retain a `delivery_uncertain` outcome for explicit reconciliation.
- The app shell exposes active and recently completed jobs so route changes do not silently destroy operational state.
- Destructive multi-peer jobs return per-peer outcomes and preserve confirmed successes when a later peer fails.

### Exit criteria

- Switching or removing accounts during every await boundary cannot misattribute data or mutate the new account's UI.
- A cancelled job cannot report completion.
- Starting a second job cannot let the first job clear or cancel its controller.
- Account removal cannot race a late owned-record write.
- A job from another tab or an abandoned transport cannot commit against an obsolete account epoch.
- Scheduled deletion reports partial success accurately.
- Route unmounting does not define job lifetime.

## 4. Stable Telegram Peer References

### Problem

The code alternates between raw GramJS IDs, marked Bot API-style IDs, and inferred chat types. Backups persist only a raw `chatId`; LLM exports persist a marked ID; some tests place marked IDs in the raw field. `StringSession` preserves connection/authentication material but not the in-memory entity cache, so a cold client can lack both the peer type and access hash needed to reconstruct an input peer after restart.

### Target

Define and persist one peer value:

```ts
interface PeerRef {
  kind: 'user' | 'group' | 'supergroup' | 'channel'
  rawId: string
  accessHash?: string
}
```

- Telegram gateway methods accept `PeerRef`, not bare `bigint`.
- Persist the access hash for peer kinds that require one to reconstruct an MTProto input peer
  after a cold start. Missing or stale hashes go through an explicit resolver/refresh path.
- Derive Bot API-style marked IDs at adapter boundaries; do not persist both raw and marked IDs
  as independent authorities that can disagree.
- All storage schemas persist the complete canonical reference.
- Conversion between GramJS entities and `PeerRef` occurs in one adapter.
- Existing records migrate through explicit resolution; unresolved records remain readable and repairable.

### Exit criteria

- User, basic group, supergroup, and channel references survive a full reload with an empty entity cache.
- A missing or stale access hash produces a typed resolution/repair path rather than peer-type guessing.
- Scheduled deletion, resend, export, and backup restore use the same peer representation.
- Tests use production-shaped peer fixtures.

## 5. Telegram Gateway and Retry Semantics

### Problem

The current gateway is a facade over the same large singleton. Contracts still leak monolith-owned types and opaque GramJS handles. Generic retries treat reads, downloads, and mutations alike. Retrying a send after an ambiguous transport failure can duplicate a Telegram message.

### Target

Split the Telegram boundary by capability:

- `SessionGateway`
- `DialogGateway`
- `AdminLogGateway`
- `MessageReadGateway`
- `MessageSendGateway`
- `ScheduledGateway`
- `MediaGateway`
- `EntityGateway`

Inject these interfaces into domain services. Keep runtime validation and GramJS type assertions inside a single browser adapter.

Define operation-specific retry policies:

- Reads and downloads may retry classified transient failures.
- Flood waits use one typed path and a cancellable clock.
- Mutations retry automatically only when failure is known to precede server acceptance.
- Ambiguous send failures return `delivery_uncertain` unless a stable Telegram deduplication/random ID can be reused.
- Permission, authentication, flood-wait, transport, and cancellation failures remain distinct typed results.

### Exit criteria

- Domain services can run against deterministic in-memory gateways without replacing a global module.
- No production test hook is selected through arbitrary `window` globals.
- A simulated accepted-send/lost-response failure cannot create a second logical send.
- Gateway contracts contain no GramJS classes or `unknown` handles outside the adapter.

## 6. Transactional Account and Storage Repository

### Problem

Account metadata is in localStorage while secrets and owned data are in IndexedDB. Multi-step add, update, and remove operations can partially commit. One corrupt secret rejects the whole account load. First-use vault-key creation is coordinated only within one tab. By-ID backup/export operations do not enforce ownership.

IndexedDB connections also lack blocked-upgrade, version-change, termination, and retry handling.

### Target

- Move account metadata and lifecycle state behind one versioned IndexedDB repository.
- Use a durable operation journal when a workflow spans stores or browser APIs that cannot share one transaction.
- Reconcile incomplete journal entries on startup.
- Load and validate secrets per account; quarantine one corrupt record without hiding valid accounts.
- Version vault payloads and stored domain records and validate decoded shapes.
- Bind encrypted payloads to record identity and version with authenticated additional data.
- Coordinate first-use key creation and lifecycle mutations across tabs using an add-if-absent winner read plus Web Locks where available.
- Use `BroadcastChannel` to invalidate stale in-memory account and ownership state across tabs.
- Require account, principal, and account-epoch context on create, save, commit, get, download,
  delete, merge, claim, and archive repository methods.
- Reject mixed-owner merges.
- Return active and archived lists from one consistent lifecycle read rather than mutating recovery during a concurrent list call.
- Surface `navigator.storage.persisted()` state where supported and request persistence only when
  the user starts a durable local-data workflow. Treat denied and unsupported persistence as
  best-effort storage, not as a durable-backup claim.
- Provide an explicit download/export fallback for best-effort storage and reconcile records lost
  to browser eviction without hiding the remaining inventory.

The vault's threat model must be documented accurately: same-origin script execution can use a stored non-extractable key. Encryption protects against accidental plaintext persistence, not XSS or browser-profile compromise.

### Exit criteria

- Failure injection at every add/update/remove boundary either rolls back or leaves a journaled recoverable state.
- One corrupt account does not hide other accounts and can be retried or removed explicitly.
- Two tabs cannot create incompatible vault keys or race archive recovery.
- Cross-tab account removal advances a durable epoch that transactionally rejects every late write
  from the previous epoch.
- Schema upgrades handle blocked and terminated connections without requiring silent data loss.
- Repository methods cannot read or delete another principal's owned data.
- Real IndexedDB and WebCrypto integration tests cover upgrades, rollback, key persistence, corruption, and recovery.
- Denied persistence and simulated browser eviction produce a visible, recoverable state with a
  tested export fallback; the UI never describes best-effort data as a durable backup.

## 7. Local Data Management

### Problem

Archived inventory is device-global, but its management route requires an active user account. After removing the last account, a user cannot inspect or delete retained local data without adding another Telegram account. Retained shared credentials also have no dedicated clear action.

### Target

Add an account-independent local-data workspace:

- List records by the independent verification, lifecycle, and health axes without exposing
  content until ownership rules permit it.
- Show why each record is in its current state.
- Support explicit claim, export, delete, credential-clear, and opt-in bulk purge actions.
- Keep account removal separate from hard deletion.
- If delayed garbage collection is added, make it opt-in, previewable, cancellable, and covered by recovery tests.

### Exit criteria

- Removing the final account does not strand retained data or credentials.
- Another Telegram account cannot inspect archived content solely because it is active.
- Every destructive action states its scope and has a tested recovery boundary.

## 8. Bounded Export and Worker Execution

### Problem

The quota strategy can return streaming or metadata-only behavior, but the export path still hard-codes IndexedDB and buffers media and ZIP output in memory. Large exports can perform expensive Telegram work and then fail at storage or heap limits. GramJS and all locales are also pulled into the initial application path, leaving the main bundle near its budget.

### Target

- Make storage strategy an executable job policy, not advisory metadata.
- Estimate early, reserve conservatively, and fail before network work when no supported strategy is safe.
- Stream media and archive output where browser capabilities permit it.
- Move compression, formatting, and other CPU-heavy stages to workers.
- Define bounded queues and backpressure between Telegram download, persistence, and archive stages.
- Start with a 64 MiB aggregate in-memory queue cap and 8 MiB stream chunks. Larger individual
  media must stream or fail before download rather than bypassing the cap.
- Lazy-load non-current locales.
- Defer GramJS, authentication UI, and user-session coordination until a user capability requires them.
- Keep browser shims narrow, version-tested, and isolated from unrelated routes.

### Exit criteria

- A forced low-quota test chooses a real supported behavior and leaves no partial hidden records.
- A 250 MiB mixed-media fixture completes with at most 96 MiB of Chromium JS-heap growth above
  the idle baseline and never exceeds the configured 64 MiB application buffer cap.
- Cancellation terminates worker and persistence stages within five seconds; late worker messages
  and writes are rejected by operation ID and account epoch.
- Production-route smoke tests fail on Node-externalization runtime errors, blank routes, page errors, and unexpected console errors.
- Every checked bundle metric is at least 10% below its committed budget after Stage E. Budgets
  are not raised merely to make an existing artifact pass.

## 9. Module Workflow Decomposition

### Problem

Authentication, export, resend, scheduled, account-info, and LLM route components combine rendering, state transitions, Telegram calls, persistence, and error policy. The module registry duplicates route and localization metadata, while declared permissions are not an enforceable capability model.

### Target

After the platform layers above exist:

- Extract typed workflow state machines or composables from route components.
- Keep components responsible for rendering and user events only.
- Make the module registry authoritative for route metadata, account capability, localization keys, navigation placement, and required permissions.
- Treat Backups/local data as a stable workspace resource without demoting first-class modules.
- Standardize loading, retry, empty, partial-success, and terminal-error states.
- Wrap routed content in a shell-level error boundary and provide a recoverable not-found route.

### Exit criteria

- Workflow state transitions can be tested without mounting a full route.
- Route components do not import the GramJS singleton.
- Required permissions are checked through typed capabilities.
- Every async screen distinguishes loading failure from a valid empty result.
- Every route and modal passes automated WCAG 2.2 AA checks plus keyboard-only focus-order,
  focus-return, Escape, and destructive-confirmation tests.
- Arabic and Persian workflow tests run at mobile and desktop widths and assert document
  direction, logical control order, no clipped primary content, and equivalent keyboard behavior.

## 10. Release Confidence

### Current gaps

- Storage-manager and account-store tests mock IndexedDB and WebCrypto at the most important boundaries.
- Coverage measures imported files and excludes several critical paths.
- Playwright exercises the Vite development server, not the built artifact.
- Resend and several production routes lack end-to-end workflow coverage.
- Locale checks do not compile every message or address the existing untranslated feature backlog.
- Browser support is undefined while the build target is `esnext`.
- Most Telegram behavior is validated behind mocks.

### Required test layers

1. **Pure domain tests**
   - ownership transitions
   - peer conversion
   - retry classification
   - state machines
2. **Browser integration tests**
   - real IndexedDB transactions and upgrades
   - WebCrypto key cloning and corruption
   - cross-tab coordination
   - quota, persistence denial, and simulated eviction/recovery
3. **Production artifact smoke**
   - every route in Chromium
   - page-error and console-error failure policy
   - deep-link and lazy-chunk loading
4. **Workflow E2E**
   - secure-account restoration
   - account switching during each job phase
   - seeded-IndexedDB resend through the send boundary, plus scheduled, account info, LLM export,
     and backups
   - desktop and mobile ownership/destructive actions
5. **Live Telegram smoke**
   - user and bot login
   - account switching and re-login
   - export and resend
   - scheduled discovery and deletion
   - account info and LLM export

For every change that affects authentication, storage schema, ownership, peer representation, or
mutation semantics, attach a dated live-smoke matrix to that PR/release. Each row records pass/fail,
the tested account/browser, and the archive/recovery/claim/delete no-data-loss assertions where
applicable; an old note is not release evidence for a new migration.

Coverage thresholds should expand only after the relevant integration seams are testable. A higher percentage over mocked or selectively imported files is not a release criterion.

## Execution Sequence

### Stage A — Identity and session integrity

- Add stable principals and the non-destructive migration states.
- Build the session coordinator and candidate-credential flow.
- Add deterministic account-switch and re-login race tests.

### Stage B — Job ownership and lifecycle

- Introduce job context and the shell job registry.
- Move export persistence into the export job.
- Add bounded cancellation and explicit abandoned/delivery-uncertain outcomes.
- Convert scheduled deletion to explicit per-chat outcomes.

### Stage C — Storage integrity

- Introduce the transactional account repository and journal.
- Add the durable account epoch and cross-tab account-removal quiesce barrier.
- Harden vault initialization, payload validation, and per-record quarantine.
- Enforce ownership at every repository boundary.
- Integrate persistence status, best-effort-storage UX, and eviction recovery.
- Add the account-independent local-data workspace.

### Stage D — Telegram boundary

- Introduce `PeerRef` and migrate stored records.
- Split and inject capability gateways.
- Separate read/download retry policy from mutation delivery semantics.

### Stage E — Bounded execution and delivery

- Add worker-backed export/archive pipelines with the committed byte, heap, and cancellation caps.
- Implement real quota strategies.
- Defer GramJS and locales from the initial route.
- Expand the production-artifact browser smoke (a Chromium boot/lazy-route baseline exists) to every route and define the supported browser floor.

### Stage F — Workflow decomposition

- Move route orchestration into state machines using the completed platform contracts.
- Make the module registry authoritative.
- Complete route, WCAG/keyboard, mobile/desktop RTL, and live Telegram validation against the
  explicit gates above.

Each stage should leave the application releasable, preserve migration rollback, and include explicit compatibility tests for data written by the previous stage.

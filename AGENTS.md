# Design System & Development Guidelines

## Design Philosophy

Clean, professional, fast. No gimmicks. The interface should feel like a native tool, not a flashy website.

**Respect the user**: No cookie popups, no notifications/badges, no onboarding tours, no update prompts, no newsletter, no AI, no review begging. Request permissions only when the feature is used.

## Product Vision

This repository is no longer treated as a single-purpose deleted-messages utility. The product direction is a modular Telegram tooling workspace built on a shared multi-account auth/session platform.

- `Scheduled Messages` and `LLM Context Export` are first-class modules, not lab-only features.
- `LLM Context Export` is an export/formatting workflow for external assistants, not an in-app AI product.
- Productionization work should simplify and harden the platform without collapsing the module system.

## Documentation Map

- `README.md` is the public product/development overview.
- `AGENTS.md` is the single agent-facing guide for repo rules, architecture notes, product direction, and the staged productionization order.
- If docs and current code disagree, treat the codebase as the source of current behavior and this guide as the source of target direction.

## Documentation Durability

- Long-lived docs in this repo should capture durable guidance: product direction, architecture, operating rules, recurring pitfalls, and priority order.
- Do not put point-in-time coordination data in `AGENTS.md` or other durable docs. That includes PR numbers, branch names, commit SHAs, CI run IDs, "safe merge checkpoints", temporary statuses, and notes that only make sense right now.
- If a detail would read as strange after a few commits, a month, or to a different person, it does not belong in durable docs.
- Put ephemeral status in PR descriptions, issues, commit messages, or short-lived handoff comments instead.

## Returning Later

- Read this file first, then `README.md`.
- Re-establish the baseline with the standard verification commands before changing behavior.
- Prioritize live Telegram validation and safe local-data lifecycle follow-through before major rewrites or visual refreshes.

## Border Radius

Use minimal rounding for a professional appearance:

| Element | Tailwind Class | Pixels |
|---------|---------------|--------|
| Buttons | `rounded-md` | 6px |
| Cards | `rounded-lg` | 8px |
| Inputs | `rounded` | 4px |
| Modals | `rounded-xl` | 12px |
| Pills/Badges | `rounded-full` | Full |
| Tooltips | `rounded` | 4px |

**Never use**: `rounded-2xl`, `rounded-3xl` for main UI elements.

## Shadows

Subtle, functional shadows only:

| Use Case | Tailwind Class |
|----------|---------------|
| Cards (resting) | `shadow-sm` |
| Cards (hover) | `shadow` |
| Modals | `shadow-lg` |
| Dropdowns | `shadow-lg` |
| Buttons | No shadow |

## Animations & Transitions

Instant feedback. Animations should be imperceptible, not decorative.

| Type | Duration | Easing |
|------|----------|--------|
| Hover effects | 100ms | ease-out |
| State changes | 100ms | ease-out |
| Modal open/close | 100ms | ease-out |
| Page transitions | 100ms | ease-out |
| Loading spinners | 600ms | linear |

```css
/* Standard transition */
transition: all 100ms ease-out;

/* Tailwind */
transition-all duration-100 ease-out
```

**Never use**: Slow transitions (>150ms for interactions), bouncy effects, or decorative animations.

## Color Palette

Telegram-inspired, with good dark mode support:

### Light Mode
- Background: `bg-gray-50` (#f9fafb)
- Card: `bg-white` (#ffffff)
- Text: `text-gray-900` (#111827)
- Muted: `text-gray-500` (#6b7280)
- Border: `border-gray-200` (#e5e7eb)

### Dark Mode
- Background: `dark:bg-gray-950` (#030712)
- Card: `dark:bg-gray-900` (#111827)
- Text: `dark:text-white` (#ffffff)
- Muted: `dark:text-gray-400` (#9ca3af)
- Border: `dark:border-gray-800` (#1f2937)

### Accent Colors
- Primary: `blue-600` (#2563eb)
- Primary Hover: `blue-700` (#1d4ed8)
- Success: `green-600` (#16a34a)
- Warning: `amber-500` (#f59e0b)
- Error: `red-600` (#dc2626)
- Bot Accent: `purple-600` (#9333ea)

## Typography

System fonts for performance, clear hierarchy:

```css
font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

| Element | Classes |
|---------|---------|
| Page Title | `text-2xl font-bold` |
| Section Title | `text-lg font-semibold` |
| Card Title | `text-base font-medium` |
| Body | `text-sm` |
| Caption | `text-xs text-gray-500` |

## Spacing

8px grid system:

- `p-1` = 4px
- `p-2` = 8px
- `p-3` = 12px
- `p-4` = 16px
- `p-6` = 24px
- `p-8` = 32px

Use consistent spacing within component types.

## Component Patterns

### Buttons

```html
<!-- Primary -->
<button class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-150">
  Action
</button>

<!-- Secondary -->
<button class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-150">
  Cancel
</button>
```

### Cards

```html
<div class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow transition-shadow duration-150">
  Content
</div>
```

### Inputs

```html
<input class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-150" />
```

### Modals

```html
<div class="bg-white dark:bg-gray-900 rounded-xl shadow-lg max-w-md w-full p-6">
  Content
</div>
```

## Things to Avoid

1. **Excessive rounding** - No `rounded-2xl` or `rounded-3xl`
2. **Heavy shadows** - No `shadow-xl` or `shadow-2xl`
3. **Slow animations** - Nothing over 150ms for interactions
4. **Gradient backgrounds** - Keep backgrounds solid
5. **Decorative icons** - Icons should be functional
6. **Bouncy/spring effects** - Keep animations linear/ease-out
7. **Parallax or scroll effects** - Keep it simple
8. **Excessive spacing** - Don't waste screen space
9. **Text truncation** - Never truncate primary content; OK for navigation previews
10. **Right-aligned text** - Left-align everything
11. **Relative dates** - Use absolute dates ("Dec 22, 2024" not "2 days ago")
12. **Hover-only controls** - All actions must be visible without hovering
13. **cursor-pointer on buttons** - Native cursor is sufficient; don't add to `<button>` or `<label>`
14. **Floating controls** - Controls stay in place; content scrolls

## Accessibility

- Maintain 4.5:1 contrast ratio for text
- All interactive elements must have focus states
- Use semantic HTML elements
- Support keyboard navigation
- Respect `prefers-reduced-motion`

## Responsive Breakpoints

```css
sm: 640px   /* Mobile landscape */
md: 768px   /* Tablet */
lg: 1024px  /* Desktop */
xl: 1280px  /* Large desktop */
```

Mobile-first approach: default styles for mobile, add complexity at larger breakpoints.

## Core Architecture (Web App)

- **App shell**: Vue 3 + Vite + TS, Pinia stores, Vue Router. The current app is landing-first; the production target is a persistent workspace shell with stable module navigation and visible long-running jobs.
- **Modules system**: `src/modules/index.ts` is the registry for first-class, expandable tools. New modules must plug into shared auth, permissions, navigation, and QA patterns.
- **Auth UX**: Multi-account auth/session handling is a shared platform capability, not a one-off flow owned by a single module.
- **Telegram clients**:
  - **User**: GramJS via `telegramService` (MTProto) for dialogs/admin log/export/resend. Production direction is a typed Telegram gateway with smaller modules and worker isolation for heavy tasks.
  - **Bot**: HTTP Bot API for `getMe` validation (no MTProto needed).
- **Account Info module**: Replaces bot-only view; shows data for both user and bot accounts. For bots, uses `getMe` to display name, username, capabilities (join groups, privacy mode, inline, web app).
- **Storage**: IndexedDB for backups/media/export caches and encrypted account secrets. Non-sensitive metadata and preferences may stay in localStorage, but API credentials, bot tokens, and user session strings must persist via encrypted IndexedDB + WebCrypto with legacy migration support. Backups and LLM exports should carry ownership metadata, archive on account removal rather than being hard-deleted by default, and surface explicit claim/delete actions when local data needs manual cleanup.
- **Internationalization**: `vue-i18n` is required for user-facing copy. Current locales include `en`, `ru`, `ar`, `es`, `fa`, `id`, `pt`, `tr`, `uk`, `uz`; production work must preserve escaping safety and completeness standards.
- **Security/Privacy**: On-device only; no backend, no analytics, no tracking. Sensitive inputs must stay masked, validated, and minimally persisted.
- **CI/Test**: Vitest (unit/component), Playwright (E2E plus a production-build Chromium smoke over the built `dist`), GitHub Actions with Corepack-pinned, deterministic `npm ci` installs, a rollback-safe (latest-commit-gated) Pages deploy, and desktop/mobile Playwright coverage in CI. The next gap is stronger live-integration and full route-level coverage, not basic CI plumbing.
- **Architecture plan**: Follow the productionization dependency order below. Stable principals and session/job coordination precede service and view decomposition.

## Productionization Dependency Order

Follow these staged dependencies when implementing structural work:

1. Establish stable principals and one session coordinator.
2. Introduce account-affine jobs with bounded cancellation and explicit uncertain outcomes.
3. Harden the transactional account/storage repository, durable account-removal quiescing, and
   local-data lifecycle.
4. Migrate stable peer references, capability gateways, and mutation-safe retry semantics.
5. Add bounded worker execution, executable quota policies, and production-artifact checks.
6. Decompose route workflows after those platform contracts exist.

At every stage, preserve the modular product surface and keep `Scheduled Messages` and
`LLM Context Export` fully supported within the shared shell.

## Service Layer Architecture

### Session Coordinator (`services/telegram/session-coordinator.ts`)

The single owner of user-session lifecycle transitions. It is framework-agnostic and backend-injected so it is unit-testable with deferred promises.
- **Serialized command queue**: `activate()`, `deactivate()`, `hold()` run one-at-a-time through one queue.
- **Monotonic generation**: every request is stamped; async completions only publish a typed `SessionSnapshot` when still the latest request, so "last request wins" and "no stale activation after a later deactivation" are structural.
- **Typed snapshot**: `idle | active | needs_login | error`; stores/UIs consume this instead of inferring state from the GramJS client.
- **Bounded pre-swap cancellation**: before a swap it cancels account-affine mutations but waits only to a deadline; a never-settling mutation cannot block a later activation, and the generation fence prevents late completions from publishing state or starting work.
- **Instance/backends**: `session-coordinator-instance.ts` binds the coordinator to `telegramService` + `resendService`; `useActiveUserSessionSync` computes the desired session and delegates all serialization to it. Richer per-job `abandoned` / `delivery_uncertain` fencing belongs to the job runtime.

### Candidate credentials (`components/auth/LoginModal.vue`)

Entered API credentials are held in-form and committed to shared storage only after Telegram accepts the login (commit-on-success). A failed or abandoned login never overwrites working shared credentials; replacing them stays a discrete, rollback-safe account-store operation.

### Account-Affine Job Runtime (`types/job.ts`, `services/jobs/`, `stores/jobs.ts`)

A job is a request-scoped unit of long-running work (export, resend, scheduled scan/delete, chat-history, archive) whose ownership is captured once and never re-read from global state at completion.
- **`JobContext`**: immutable `{ operationId, accountId, principal, sessionGeneration, accountEpoch, signal }` stamped at creation. `createJobContext()` owns its own `AbortController` (linked to an optional parent signal), so starting a second job can never clear or cancel the first job's controller. `isContextCurrent()` / `isCommitAllowed()` are pure fences over session generation and account epoch.
- **Account epoch (`stores/accounts.ts`)**: a monotonic per-account counter persisted per account in `localStorage`. `removeAccount()` advances the epoch *before* archival begins and rolls it back if removal aborts. A job captures the epoch at start; a later removal advances it so a late owned-record write fails its commit instead of orphaning data that archival already skipped. Because `localStorage` is synchronously consistent across same-origin tabs, reading the epoch at commit time also fences a stale write whose account was removed in another tab. The tombstone key is never deleted on removal (that advanced value is what keeps fencing late writes); broader cross-tab invalidation of cached account/ownership state is handled separately by the cross-tab invalidation channel.
- **Commit fence (`CommitOptions.ensureCommittable`)**: threaded into the backup and LLM-export persistence boundaries (`backupManager.createBackup`, `saveChatExportBundle`). It runs synchronously immediately before the durable write and throws an `AbortError` when the owning account was removed mid-run. Views build it from the captured epoch.
- **Multi-peer outcomes (`MultiPeerResult` / `summarizeMultiPeerResult`)**: destructive jobs across many peers record a per-peer `DeliveryOutcome` (`delivered | failed | skipped | delivery_uncertain | abandoned`). `scheduledService.deleteScheduledMessagesByPeer` reconciles each confirmed peer as it settles, so a later peer's failure never discards earlier confirmed deletions, and the view reports full/partial/failed accurately.
- **Shell job registry (`stores/jobs.ts`)**: `useJobsStore` is a pure, observable projection of active and recently completed `JobRecord`s so the app shell can surface long-running work. Wiring view-owned tasks into this registry (so route unmounting no longer defines job lifetime) touches mutation flows, so it must go through a live Telegram smoke pass.

### Telegram Service (`services/telegram/client.ts`)

Central singleton for all Telegram MTProto operations via GramJS:
- **Connection lifecycle**: `connect()`, `disconnect()`, session persistence coordinated through the account store and secure vault
- **State integrity**: unauthorized `connect()` and `disconnect()` paths have direct unit coverage for honest connection-state transitions
- **Authentication**: Phone + code + 2FA password flow; session string storage
- **Entity cache**: In-memory `Map<bigint, Entity>` to avoid redundant `getEntity()` calls
- **Key methods**:
  - `getAdminLog()` - fetch deleted messages from chat admin log
  - `resolveSenderInfo()` - get sender name/username from cache or API
  - `canSendToChat()` - permission check before resend
  - `sendMessage()` / `sendFile()` - send text/media with retry support

### Rate Limiter (`services/telegram/rate-limiter.ts`)

Centralized rate limiting and retry logic:
- **Semaphore**: Controls concurrent operations (e.g., max 3 parallel downloads)
- **withRetry()**: Generic retry wrapper with exponential backoff
- **FloodWait handling**: Parses `FloodWaitError` from various formats, waits accordingly
- **Progress utilities**: `formatDuration()`, `calculateETA()` for UI feedback

### Delete Trace Service (`services/delete-trace/delete-trace-service.ts`)

Finds and removes messages attributed to the active user in explicitly selected chats.
- **Server-side filtering**: Uses paginated `messages.search` requests with `from_id` set to the active user, so unrelated chat history is never downloaded. Pages and deletion batches are capped at 100 message IDs.
- **Review before mutation**: Scanning is a separate, cancellable read phase. Partial chat scans are discarded and cannot feed deletion.
- **Retry semantics**: Reads retry transient failures. Message deletion is idempotent by ID, so transient failures and explicit flood waits may retry; permanent 4xx RPC failures stop immediately, and a GramJS-internal exhausted retry loop is not multiplied externally.
- **Ambiguous outcomes**: After an exhausted transport/server failure, the service reads the batch back once to confirm which IDs still exist. Unreconciled requests are reported as `delivery_uncertain`, never as success.
- **Identity limit**: Telegram only returns messages attributed to the user principal. Anonymous admin posts and posts sent as a channel are intentionally reported as outside the scan.

### Export Service (`services/export/export-service.ts`)

Two-phase export: metadata first, then media:
1. **Phase 1**: Iterate admin log, build `DeletedMessage[]`, resolve sender info
2. **Phase 2**: Parallel media downloads using Semaphore (default: 4 concurrent)
- **Cancellation**: Cooperative `AbortController` checks between stages; some in-flight GramJS calls cannot be interrupted until they settle
- **Progress callbacks**: `onProgress(ExportProgress)`, `onFloodWait(seconds)`, `onError(error, messageId)`, `onFloodWaitCountdown(remainingSeconds)`
- **Error resilience**: Read/download retries continue past individual media failures; mutation retry semantics still require dedicated hardening

### Resend Service (`services/resend/resend-service.ts`)

Batch-aware message resending:
- **Message batching**: Groups consecutive text-only messages from same sender within time window
- **Header formatting**: Configurable (sender name, username, date, reply links, hidden links)
- **Media handling**: Retrieves blobs from IndexedDB, sends via `sendFile()`
- **Cancellation**: Same `AbortController` pattern as export

### Storage Services (`services/storage/`)

- **backup-manager.ts**: CRUD for backups (metadata + messages) in IndexedDB
- **indexed-db.ts**: Low-level IndexedDB wrapper with versioned schema
- **quota.ts**: Storage quota monitoring, cleanup strategies
- **Ownership model (`record-ownership.ts`)**: ownership is normalized onto three independent axes — `ownerVerification` (`verified | unverified | legacy`), `lifecycle` (`active | archived`), and `recordHealth` (`healthy | quarantined`) — with the legacy `ownershipState` (`owned | archived | legacy`) mirrored for backward compatibility. Records carry both the local `ownerAccountId` and the stable `ownerPrincipal`. Validation fails closed: internally inconsistent combinations (e.g. a non-`verified` record that still carries an `ownerPrincipal`) are quarantined rather than shown under a false owner. `archiveOwnership` is idempotent; `claimOwnership` forces `ownerPrincipal` to the claiming account's principal. Recovery is principal-first, with a `phone-bridge` channel for pre-principal records that never upgrades verification.
- **Quarantine + explicit repair**: `listQuarantinedBackups` / `listQuarantinedChatExports` surface health-quarantined records, and `reconcileBackup` / `reconcileChatExport` are deliberate user-driven repairs that never run automatically.
- **Commit fence**: persistence entry points accept `CommitOptions.ensureCommittable` and call it immediately before the durable write so a removed owning account cannot orphan a late owned record.

## Type System (`types/`)

Key interfaces (all exported from `types/index.ts`):
- `DeletedMessage`: Core message representation with sender info, media, timestamps
- `ExportConfig` / `ResendConfig`: Operation configuration matching Python models
- `ExportProgress`: Real-time progress tracking (current/total, phase, ETA, errors)
- `Backup` / `ChatInfo` / `UserInfo`: Domain models for storage and UI
- `JobContext` / `JobRecord` / `JobProgress`: Account-affine job runtime primitives
- `DeliveryOutcome` / `PeerOutcome` / `MultiPeerResult` + `summarizeMultiPeerResult`: per-peer results for destructive multi-peer jobs
- `CommitOptions`: commit-fence hook threaded into persistence boundaries

## Module Views

Lazy-loaded route components in `modules/`:
- **ExportView**: Chat selection → export config → progress with cancel/ETA
- **ResendView**: Backup/chat selection → full resend config → progress
- **ScheduledView**: Scheduled message discovery, filtering, and deletion workflows
- **DeleteTraceView**: Multi-chat, optional-date-range scan and reviewed deletion of the active user's messages
- **LlmExportView**: Chat-history export and archive formatting for external assistants/tools
- **AccountInfoView**: Displays current account details (user or bot)

## Key Design Decisions

1. **Client-side only**: No backend; non-sensitive UI state may live in localStorage, while account secrets and larger data sets live in IndexedDB. Privacy-first.
2. **GramJS for users, Bot API for bots**: MTProto complexity only where needed.
3. **Entity caching**: Avoids N+1 queries when resolving sender info for many messages.
4. **Semaphore concurrency**: Prevents overwhelming Telegram API during media downloads.
5. **AbortController cancellation**: Standard pattern for interruptible long operations.
6. **Two-phase export**: Allows progress feedback and early metadata availability.
7. **Batched resend**: Reduces API calls by combining short consecutive messages.
8. **Centralized retry utilities**: `withRetry()` handles cancellable backoff and FloodWait parsing for retry-safe operations. Do not apply generic retries to ambiguous sends.

## GramJS Browser Integration (Critical)

GramJS is designed for Node.js but works in browsers with proper shimming. These lessons are hard-won:

### 1. DO NOT call `connect()` before `client.start()`

```javascript
// ❌ WRONG - causes TIMEOUT errors
await telegramService.initClient(apiId, apiHash)
await telegramService.connect()  // <-- This breaks things
await telegramService.startUserAuth(phone)

// ✅ CORRECT - client.start() handles connection internally
await telegramService.initClient(apiId, apiHash)
await telegramService.startUserAuth(phone)  // This calls client.start() which connects
```

`client.start()` internally calls `connect()`. Double-connecting puts the client in a bad state causing authentication timeouts.

### 2. Required Browser Shims (in `src/shims/`)

GramJS imports Node.js modules that don't exist in browsers. Vite aliases redirect them:

| Node Module | Shim File | Purpose |
|------------|-----------|---------|
| `util` | `src/shims/util.ts` | `util.inspect.custom` symbol for GramJS debugging |
| `os` | `src/shims/os.ts` | `os.type()`, `os.release()` for device info in MTProto |
| `events` | `src/shims/events.ts` | Browser `EventEmitter` compatibility for GramJS dependencies |
| `crypto` | `src/shims/telegram/CryptoFile.ts` | Custom browser-compatible subset used by GramJS |
| `telegram/extensions/PromisedNetSockets` | `src/shims/telegram/PromisedNetSockets.ts` | Throws error - WebSocket is used instead |

These are configured in `vite.config.ts` via `resolve.alias` and `optimizeDeps.esbuildOptions.plugins`.

### 3. Session Isolation for Multi-Account

Each account must have its own session string. **Never** use a single global `telegram_session` localStorage key:

```javascript
// ❌ WRONG - session leakage between accounts
constructor() {
  this.session = new StringSession(localStorage.getItem('telegram_session') || '')
}

// ✅ CORRECT - session comes from the active account's SavedAccount.sessionString
async useUserAccountSession(data: { sessionString, apiId, apiHash }) {
  this.session = new StringSession(data.sessionString || '')
  await this.initClient(data.apiId, data.apiHash)
  // ...
}
```

### 4. Race Condition: Auth Flow vs Account Watcher

When active-account session synchronization runs during login, it can interfere with the in-progress auth flow. Keep the guard in the session-sync boundary:

```javascript
watch([() => accountsStore.activeAccount?.id, showLoginModal], async () => {
  if (showLoginModal.value) {
    return
  }
  // ... sync session
})
```

### 5. `_rawMessage` is Runtime-Only

`DeletedMessage._rawMessage` holds a raw GramJS object for media downloads. It's **non-serializable** (has circular refs, functions, BigInt). Strip it at persistence boundaries:

```javascript
// In indexed-db.ts saveMessages()
const sanitized = stripRawMessage(message)
await store.put({ ...sanitized, backupId })

// In zip-generator.ts
const clean = stripRawMessage(msg)  // Before JSON.stringify
```

### 6. BigInt JSON Serialization

`JSON.stringify()` throws on `bigint`. Use a replacer:

```javascript
function safeJsonStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v, space)
}
```

### 7. HTML Escaping for Resend

When using `parseMode: 'html'` for resend, escape user text to prevent injection:

```javascript
// App-generated safe markup (links, pre) is fine
// User message text must be escaped
textParts.push(escapeHtml(message.text))
```

### 8. Reactive Proxies at Structured-Clone Boundaries

The structured clone algorithm (IndexedDB `put`/`add`, `postMessage`, Web Workers, `structuredClone`) rejects `Proxy` objects. **Every Vue `reactive`/`ref` value is a Proxy**, so a record built from store/UI state (e.g. a chat's `peerRef`, an account's `principal`) throws `DataCloneError: The object can not be cloned.` — but **only on WebKit/Safari**; Chromium clones reactive proxies, so CI and Chrome hide the bug. Snapshot to plain data with `toPlainSnapshot` (`utils/reactive-snapshot.ts`) before any structured-clone boundary:

```javascript
// indexed-db.ts enforces this for ALL writes — no `.put()` may bypass it.
await store.put(toPlainSnapshot(record))
```

It deep-unwraps reactivity while preserving clone-safe leaves (bigint, Date, Blob, ArrayBuffer, typed arrays, CryptoKey) and is a no-op on already-plain data. Apply the same snapshot to any future `postMessage`/Worker payload that may carry reactive state (see the "move long-running work off the main thread" direction).

## vue-i18n Special Characters (Critical)

vue-i18n v11 uses a message compiler that interprets certain characters as syntax. Using them literally in translation values causes `SyntaxError` at runtime, which **silently crashes the entire component** (no visible error in the UI — the component just disappears). `npm run check:i18n` guards this by parsing every value with the same `@intlify/message-compiler` vue-i18n uses at runtime, so malformed syntax and mismatched placeholders fail CI instead of shipping.

### Characters that MUST be escaped in i18n JSON values:

Per the [official docs](https://vue-i18n.intlify.dev/guide/essentials/syntax#literal-interpolation), these characters are special in vue-i18n v11 message format:

| Character | Meaning in vue-i18n | Escape syntax | Example |
|-----------|---------------------|---------------|---------|
| `@` | Linked message (`@:key`) | `{'@'}` | `"Include {'@'}username"` |
| `{` | Named interpolation start | `{'{'}` | — |
| `}` | Named interpolation end | `{'}'}` | — |
| `$` | Implicit message reference | `{'$'}` | — |
| `|` | Plural separator | `{'|'}` (unless intentional pluralization) | — |

### Rules:
1. **Never put `@` directly in i18n values** unless it's intentional linked message syntax. Always use `{'@'}`.
2. **Never put `{{...}}` in i18n values.** Rewrite the description to avoid template syntax characters (e.g., "Variables: sender, text, date — wrap in double curly braces").
3. **`|` is OK for pluralization** (e.g., `"{count} message | {count} messages"`). Escape with `{'|'}` only if you need a literal pipe character.
4. **The error is silent in production** — the component simply won't render, with no user-visible error message. The only clue is a `SyntaxError: 10` in the browser console.

## Implementation Status

Point-in-time status is intentionally not tracked in this durable guide. For what exists today, read
the code; for the staged direction, see the Product Vision and Productionization Dependency Order
sections above. Record per-change status in pull requests and commit messages rather than here.

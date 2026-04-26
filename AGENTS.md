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

- `TODO.md` is the restart brief and priority order for future work.
- `README.md` is the public product/development overview.
- `AGENTS.md` is the single agent-facing guide for repo rules, architecture notes, and product direction.
- If docs and current code disagree, treat the codebase as the source of current behavior and `TODO.md` as the source of target direction.

## Documentation Durability

- Long-lived docs in this repo should capture durable guidance: product direction, architecture, operating rules, recurring pitfalls, and priority order.
- Do not put point-in-time coordination data in `AGENTS.md`, `TODO.md`, or other durable docs. That includes PR numbers, branch names, commit SHAs, CI run IDs, "safe merge checkpoints", temporary statuses, and notes that only make sense right now.
- If a detail would read as strange after a few commits, a month, or to a different person, it does not belong in durable docs.
- Put ephemeral status in PR descriptions, issues, commit messages, or short-lived handoff comments instead.

## Returning Later

- Read `TODO.md` first, then this file, then `README.md`.
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
- **CI/Test**: Vitest (unit/component), Playwright (E2E), GitHub Actions with deterministic `npm ci` installs and desktop/mobile Playwright coverage in CI. The next gap is stronger live-integration and route-level coverage, not basic CI plumbing.

## Productionization Priorities

1. Decompose oversized services and route components instead of adding more logic to them.
2. Preserve the modular product surface and the shared auth/session platform.
3. Pin dependency versions and make CI reproducible.
4. Move long-running Telegram work off the main thread where practical.
5. Harden account-owned data lifecycle and migration paths.
6. Keep `Scheduled Messages` and `LLM Context Export` fully supported within the same shell.

## Service Layer Architecture

### Telegram Service (`services/telegram/client.ts`)

Central singleton for all Telegram MTProto operations via GramJS:
- **Connection lifecycle**: `connect()`, `disconnect()`, session persistence coordinated through the account store and secure vault
- **State integrity**: unauthorized `connect()` and `disconnect()` paths now have direct unit coverage for honest connection-state transitions
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

### Export Service (`services/export/export-service.ts`)

Two-phase export: metadata first, then media:
1. **Phase 1**: Iterate admin log, build `DeletedMessage[]`, resolve sender info
2. **Phase 2**: Parallel media downloads using Semaphore (default: 4 concurrent)
- **Cancellation**: `AbortController` passed through; checked at each step
- **Progress callbacks**: `onProgress(ExportProgress)`, `onFloodWait(seconds)`, `onError(error, messageId)`, `onFloodWaitCountdown(remainingSeconds)`
- **Error resilience**: Retries on transient failures; continues on single-file failures

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
- **Ownership model**: Backup/export records may be `owned`, `archived`, or `legacy`. New records should be owned, removed-account data should archive, and legacy visibility may exist only as a clearly labeled migration bridge with explicit claim/delete actions.

## Type System (`types/`)

Key interfaces (all exported from `types/index.ts`):
- `DeletedMessage`: Core message representation with sender info, media, timestamps
- `ExportConfig` / `ResendConfig`: Operation configuration matching Python models
- `ExportProgress`: Real-time progress tracking (current/total, phase, ETA, errors)
- `Backup` / `ChatInfo` / `UserInfo`: Domain models for storage and UI

## Module Views

Lazy-loaded route components in `modules/`:
- **ExportView**: Chat selection → export config → progress with cancel/ETA
- **ResendView**: Backup/chat selection → full resend config → progress
- **ScheduledView**: Scheduled message discovery, filtering, and deletion workflows
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
8. **Centralized retry logic**: `withRetry()` handles FloodWait uniformly across all operations.

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
| `crypto` | `src/shims/telegram/CryptoFile.ts` | Re-exports GramJS's own browser crypto (`telegram/crypto/crypto`) |
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

When `App.vue` watches `activeAccount` to sync the Telegram client, it can interfere with an in-progress login flow. Guard the watcher:

```javascript
watch(() => accountsStore.activeAccount, async (account) => {
  // Skip during active login flow
  if (accountsStore.authFlow.step !== 'idle' && accountsStore.authFlow.step !== 'complete') {
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

## vue-i18n Special Characters (Critical)

vue-i18n v9 has a message compiler that interprets certain characters as syntax. Using them literally in translation values causes `SyntaxError` at runtime, which **silently crashes the entire component** (no visible error in the UI — the component just disappears).

### Characters that MUST be escaped in i18n JSON values:

Per the [official docs](https://vue-i18n.intlify.dev/guide/essentials/syntax#literal-interpolation), these characters are special in vue-i18n v9 message format:

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

## Current Implementation Status

### Completed Foundation
- Rate limiter with FloodWait handling and exponential backoff
- Export service with parallel downloads, retry, cancellation
- Resend service with batching, media, header formatting
- Telegram service enhancements (entity cache, sender resolution, sendFile)
- ExportView and ResendView with full config options and progress display
- Unit tests for rate-limiter, export-service, resend-service (86 tests)
- E2E tests for export/resend flows with mocked Telegram
- Error UX: ErrorBoundary, ErrorAlert components, user-friendly error messages
- ZIP export integration (download as ZIP option in ExportView)
- ZIP export filename sanitization for archive safety
- Multi-account session isolation (issue #4)
- Encrypted IndexedDB + WebCrypto storage for API credentials, bot tokens, and user session strings, with migration from legacy plaintext localStorage
- Account-owned backup and LLM export metadata with archive-on-remove and auto-recovery for the same phone number
- Explicit claim/delete UI for legacy and archived local backups/exports
- Auth modal keyboard/focus/error accessibility hardening
- Deterministic installs and reproducible preview deploy path in CI
- Mobile Playwright projects promoted into CI
- Direct Telegram connection-state tests
- App-level live-region improvements for shared errors and toast messages
- App shell cleanup: first-run privacy gate removed, active user session sync extracted from `App.vue` into a composable
- BigInt-safe JSON serialization utilities
- `_rawMessage` stripping at persistence boundaries
- Resend HTML escaping for user safety

### Productionization Gaps
- `telegramService` is still a very large singleton with too many responsibilities.
- Auth, export, and resend views still own too much orchestration and UI logic.
- Account-owned data cleanup must continue to default to recoverable archive/quarantine behavior, not immediate hard delete.
- If local-data cleanup grows beyond the current explicit claim/delete flow, keep delayed GC or bulk purge opt-in, documented, and tested.
- The build still carries GramJS/browser-shim warnings and a heavy main bundle.
- Tests are stronger at mocked service behavior than at real Telegram integration boundaries.
- Documentation can drift behind the actual product direction if `TODO.md`, `README.md`, and `AGENTS.md` are not updated together.

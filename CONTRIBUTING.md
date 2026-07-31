# Contributing to Telegram Toolset

Telegram Toolset is a privacy-sensitive client for real Telegram accounts. Contributions should keep
the product modular while treating authentication, destructive actions, and local data as shared
platform concerns.

## Before You Start

- Search existing issues and pull requests for related work.
- Open a feature request before a large workflow, architecture, or storage change.
- Never include API credentials, session strings, bot tokens, phone numbers, or private chat content
  in issues, fixtures, screenshots, commits, or CI logs.
- Read [`AGENTS.md`](./AGENTS.md) for the current architecture and UI constraints.

## Development Setup

```bash
corepack enable
npm ci
npm run dev
```

Use Node 22 as constrained by `package.json`. The development app is client-only; most automated
Telegram workflows should use injected mocks rather than a live account.

## Tool Checklist

### 1. Register the route

Add one entry to `src/modules/index.ts`:

```ts
{
  id: 'example-tool',
  name: 'Example Tool',
  description: 'Do one Telegram job clearly',
  icon: 'example',
  accountType: 'user',
  route: {
    path: '/example',
    name: 'example-tool',
    component: () => import('./example/ExampleView.vue'),
    meta: { requiresAuth: true, accountType: 'user' },
  },
}
```

The registry controls product navigation and route auth. Do not add a second source of module truth.

### 2. Reuse platform capabilities

- Authentication and account switching belong to the app shell.
- Features call typed domains from `services/telegram/gateway/`, not the legacy Telegram singleton.
- Chat selection uses the shared `ChatSelector` and a tool-specific `ChatSelectorConfig`.
- Long-running account-affine work uses `createJobContext()` and `runJob()`.
- Durable writes preserve ownership metadata and use commit fences where an account can disappear
  mid-operation.

### 3. Treat Telegram mutations explicitly

- Separate discovery/review from mutation for destructive work.
- Show the exact target and payload before the action.
- Retry only operations that are safe to repeat. A timed-out send may already have reached Telegram.
- Reconcile ambiguous outcomes when Telegram provides a reliable read-back path.
- Browser automation must use mock Telegram data. Do not click destructive controls against a real
  account during automated or visual QA.

### 4. Complete the user experience

- Add user-facing copy to all locale files in `src/i18n/locales/`.
- Keep layouts useful on mobile and desktop, in light and dark mode.
- Use absolute dates for historical Telegram data.
- Include loading, empty, partial, error, cancellation, and retry states where the workflow needs
  them.
- Preserve keyboard navigation, visible focus, semantic HTML, and sufficient contrast.

### 5. Test at the right layers

- Unit tests for parsing, retry policy, ownership, and service outcomes.
- Component tests for interaction and state transitions.
- Playwright for the critical route workflow and responsive behavior.
- Production-build smoke coverage when lazy chunks, routing, or browser shims change.

Run the complete local gate before requesting review:

```bash
npm run lint
npm run check:i18n
npm run type-check
npm run test:unit:coverage
npm run test:component:coverage
npm run build
npm run bundle:check
npm run test:e2e
npm run test:e2e:dist
```

## Pull Requests

Keep commits focused and the pull-request description operational. Include:

- the user problem and resulting workflow;
- Telegram calls, storage changes, and mutation semantics;
- screenshots for visible desktop/mobile changes;
- exact commands and live-safe validation performed; and
- remaining risks or validation that requires the temporary preview.

Pull requests from repository branches receive a temporary Surge deployment after the full CI gate
passes.

## Public Assets

The README and website share the generated 1280×640 social image at `public/social-preview.png`.
Change its deterministic HTML/CSS source in `scripts/generate-social-preview.mjs`, then regenerate it:

```bash
npm run social:generate
```

Do not hand-edit the PNG. Keep it below GitHub's social-preview upload limit and verify the rendered
image at its original dimensions before committing it.

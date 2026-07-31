<p align="center">
  <img src="./public/social-preview.png" alt="Telegram Toolset - useful Telegram tools, all in one place" width="1280" />
</p>

# Telegram Toolset

A growing toolbox for Telegram users. It covers useful jobs that many people need but the official
apps do not support and may never add.

Connect an account once, then use every compatible tool from the same workspace. New tools can reuse
the login flow, account switcher, chat picker, local storage, translations, and test setup instead of
building them again.

[**Open Telegram Toolset**](https://telegram-toolset.rmbk.me/) |
[See the tools](#tools) |
[Add a new tool](#adding-a-new-tool)

[![CI](https://github.com/uburuntu/Telegram-Toolset/actions/workflows/ci.yml/badge.svg)](https://github.com/uburuntu/Telegram-Toolset/actions/workflows/ci.yml)
[![Live app](https://img.shields.io/badge/live-telegram--toolset.rmbk.me-2563eb)](https://telegram-toolset.rmbk.me/)
[![License: MIT](https://img.shields.io/badge/license-MIT-16a34a.svg)](./LICENSE)

## Why This Exists

Telegram's official apps are built for everyone, so they focus on features with the widest use. Many
people still want tools for jobs that are too specific, too advanced, or too sensitive to become
built-in features. Telegram Toolset gives those useful extras one home.

- **Useful first.** Each tool solves a real job Telegram users already have.
- **One connection.** Sign in once; compatible tools reuse the same account setup.
- **Easy to grow.** Shared building blocks make the next tool much easier to add.
- **Private by default.** The app runs in your browser, with no application backend or tracking.
- **Careful with changes.** Destructive tools show what they found before changing anything.

## Tools

| Tool | What it does | Account |
| --- | --- | --- |
| **Account Info** | View profile, security, session, and bot details | User or bot |
| **Export Deleted Messages** | Export deleted messages from chats where you can read the admin log | User |
| **Backups** | Browse and manage exports stored in this browser | User |
| **Resend Messages** | Re-send an export with formatting and batching controls | User |
| **Scheduled Messages** | Find and manage scheduled messages across chats | User |
| **Delete My Messages** | Find your messages, review them, then delete the selected results | User |
| **LLM Context Export** | Export chat history as Markdown, JSON, or plain text for other tools | User |

## Use It

Open [telegram-toolset.rmbk.me](https://telegram-toolset.rmbk.me/), connect an account, and choose a
tool. Nothing needs to be installed.

User-account tools require an API ID and hash from [my.telegram.org](https://my.telegram.org).
Bot tools require a token from [@BotFather](https://t.me/BotFather).

> [!IMPORTANT]
> Telegram sessions and bot tokens stay in this browser. Sensitive account data is encrypted in
> IndexedDB with WebCrypto. The app has no backend, analytics service, or tracking pixel.

<a id="adding-a-new-module"></a>

## Adding a New Tool

The platform handles the common work: login, account switching, chat selection, long-running jobs,
local storage, translations, and browser testing. A new tool can focus on the Telegram job it solves.

1. Add the tool and its route to [`src/modules/index.ts`](./src/modules/index.ts).
2. Build its screen under `src/modules/<tool>/` using shared workspace components.
3. Add any Telegram operations to the typed gateway instead of calling GramJS directly.
4. Use the shared job runtime for long-running or destructive work.
5. Add all user-facing text to the 10 locale files.
6. Cover the service logic, screen behavior, and main browser workflow.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the detailed checklist and example module entry.

## Run Locally

Requirements: Node.js `22.14+` (Node 22) and the Corepack-pinned npm version in `package.json`.

```bash
corepack enable
npm ci
npm run dev
```

Run the full quality gate before requesting review:

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

## Technical Overview

```text
Vue workspace
  |-- typed Telegram gateway -- GramJS / MTProto for user accounts
  |-- Bot API client ---------- getMe for bot accounts
  |-- account-affine jobs ----- cancellation, progress, and outcome fencing
  `-- encrypted local storage - sessions, exports, backups, and ownership metadata
```

| Path | Responsibility |
| --- | --- |
| [`src/modules/`](./src/modules) | Lazy tool workflows and route-owned UI |
| [`src/components/`](./src/components) | Shared account, chat, storage, and shell components |
| [`src/services/telegram/gateway/`](./src/services/telegram/gateway) | Typed Telegram boundary used by tools |
| [`src/services/jobs/`](./src/services/jobs) | Long-running, account-aware job ownership |
| [`src/services/storage/`](./src/services/storage) | IndexedDB, encrypted secrets, ownership, and recovery |
| [`src/i18n/locales/`](./src/i18n/locales) | Complete message catalogs for 10 locales |
| [`tests/`](./tests) | Unit, component, browser, mobile, and production-build coverage |

Detailed architecture constraints and browser integration lessons live in [`AGENTS.md`](./AGENTS.md).

## Contributing and Security

- Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a substantial pull request.
- Report vulnerabilities privately using [`SECURITY.md`](./SECURITY.md). Never put Telegram
  credentials, session strings, bot tokens, or private chat content in a public issue.
- Historical desktop binaries remain under Releases, but the maintained product is the web app.

## License

[MIT](./LICENSE). Copyright 2024-2026 rmbk and contributors.

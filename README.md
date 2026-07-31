# Telegram Toolset

[![CI](https://github.com/uburuntu/Telegram-Toolset/actions/workflows/ci.yml/badge.svg)](https://github.com/uburuntu/Telegram-Toolset/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Telegram Toolset is a privacy-first, browser-only workspace for advanced Telegram operations. The repository began as a deleted-messages manager and has grown into a broader modular tool platform built around a shared multi-account auth pipeline.

The app runs entirely on-device. There is no backend, no tracking, and no server-side storage of Telegram data.

## Current Product Surface

| Module | Description | Account Type |
|--------|-------------|--------------|
| **Account Info** | Inspect profile metadata, user security/session policies, and bot capabilities | Any |
| **Export Deleted Messages** | Export deleted messages from chats where the user has the required rights | User |
| **Backups** | Manage saved exports, archived local backups, and recovery lifecycle actions | User |
| **Resend Messages** | Re-send exported content with formatting and batching controls | User |
| **Scheduled Messages** | View and manage scheduled messages across chats | User |
| **Delete My Messages** | Find and permanently remove messages sent by the current user in selected chats | User |
| **LLM Context Export** | Export chat history in assistant-friendly formats for external tools | User |

`Account Info`, `Export Deleted Messages`, `Resend Messages`, `Scheduled Messages`, `Delete My Messages`, and `LLM Context Export` are surfaced from the module registry in `src/modules/index.ts`. `Backups` is part of the supported product surface, exposed as its own authenticated route/workspace rather than as a landing-page module card.

## Product Direction

- Keep a single modular app shell rather than separate one-off apps.
- Keep the shared auth/session pipeline as reusable platform infrastructure.
- Keep `Scheduled Messages` and `LLM Context Export` as first-class modules.
- Keep the app client-side and privacy-first.
- Productionize the architecture instead of layering more logic onto oversized views and services.

Platform direction, the staged dependency order, and repo rules live in [AGENTS.md](./AGENTS.md).

## Architecture At A Glance

- `Vue 3 + Vite + TypeScript`
- `Pinia` for shared state
- `Vue Router` for lazy-loaded module routes
- `GramJS` for user MTProto flows
- Telegram Bot HTTP API for bot validation flows
- `IndexedDB` for backups, media, export caches, encrypted account secrets, and recoverable account-owned archives with explicit claim/delete lifecycle actions
- `vue-i18n` for localization
- `Vitest` + `Playwright` + GitHub Actions for quality gates

## Development

```bash
npm ci
npm run dev
npm run lint
npm run check:i18n
npm run type-check
npm run test:unit
npm run test:component
npm run test:e2e
npm run build
npm run bundle:check
npm run test:e2e:dist
```

## Working In This Repo

Read this before making substantial changes:

- [AGENTS.md](./AGENTS.md) for design system rules, architecture notes, the staged productionization order, critical Telegram/browser lessons, and agent-facing repo guidance

Key contribution rules:

- Reuse the shared auth/session platform instead of duplicating login flows inside modules.
- Treat the module registry in `src/modules/index.ts` as a first-class product surface.
- Preserve the privacy model: no backend, no silent data export, no tracking.
- Keep UI changes aligned with the design system in `AGENTS.md`.

## Requirements

- **User accounts**: API credentials from [my.telegram.org](https://my.telegram.org)
- **Bots**: Token from [@BotFather](https://t.me/BotFather)

## License

MIT

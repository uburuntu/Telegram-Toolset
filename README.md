# Telegram Toolset

[![CI](https://github.com/uburuntu/Telegram-Toolset/actions/workflows/ci.yml/badge.svg)](https://github.com/uburuntu/Telegram-Toolset/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Power tools for Telegram that aren't available in official apps. Runs entirely in your browser - no server, no tracking, no data collection.

**[telegram-toolset.rmbk.me](https://telegram-toolset.rmbk.me)**

## Tools

| Tool | Description | Account Type |
|------|-------------|--------------|
| **Export Deleted Messages** | Save deleted messages from channels/groups where you have admin access | User |
| **Resend Messages** | Re-send exported messages to any chat with formatting options | User |
| **Account Info** | View account details and bot capabilities | Any |

## Privacy

- 100% client-side - connects directly to Telegram
- Session stored only in your browser's localStorage
- Open source - verify the code yourself

## Development

```bash
npm install      # Install dependencies
npm run dev      # Start dev server (http://localhost:5173)
npm run lint     # Run linter
npm test         # Run all tests
npm run build    # Build for production
```

## Adding a New Module

Want to add a new tool? Here's how:

### 1. Create the module folder

```
src/modules/your-module/
  └── YourModuleView.vue
```

### 2. Register in `src/modules/index.ts`

```typescript
{
  id: 'your-module',
  name: 'Your Module Name',
  description: 'What it does',
  icon: 'download',  // or 'send', 'user', 'bot'
  accountType: 'user',  // or 'bot', 'any'
  route: {
    path: '/your-module',
    name: 'your-module',
    component: () => import('./your-module/YourModuleView.vue'),
    meta: { requiresAuth: true, accountType: 'user' },
  },
}
```

### 3. Follow existing patterns

- Use `telegramService` for Telegram API calls
- Use Pinia stores for state management
- Follow the design system in `AGENTS.md`
- Add unit tests in `tests/unit/`

### 4. Open a PR

```bash
git checkout -b feature/your-module
npm run lint && npm test
git commit -m "Add your-module"
```

CI will automatically run lint, typecheck, and tests on your PR.

## Requirements

- **User Accounts**: API credentials from [my.telegram.org](https://my.telegram.org)
- **Bots**: Token from [@BotFather](https://t.me/BotFather)

## Tech Stack

Vue 3 + TypeScript + Vite, Pinia, Vue Router, TailwindCSS, GramJS (MTProto), IndexedDB, Vitest + Playwright

## License

MIT

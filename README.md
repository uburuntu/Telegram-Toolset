# Telegram Toolset

[![CI](https://github.com/rmbk/telegram-toolset/actions/workflows/ci.yml/badge.svg)](https://github.com/rmbk/telegram-toolset/actions/workflows/ci.yml)
[![Deploy](https://github.com/rmbk/telegram-toolset/actions/workflows/deploy.yml/badge.svg)](https://github.com/rmbk/telegram-toolset/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**[telegram-toolset.rmbk.me](https://telegram-toolset.rmbk.me)**

Power tools for Telegram that aren't available in official apps. 100% on-device, open source, and privacy-focused.

## Features

- **Export Deleted Messages** - Save deleted messages from channels/groups where you have admin access
- **Resend Messages** - Re-send previously exported messages to any chat
- **Account Info** - View account details and bot capabilities
- **Multi-Account** - Support for both user accounts and bot tokens
- **Offline Storage** - All data stored locally in your browser (IndexedDB)
- **Bilingual** - English and Russian language support

## Privacy First

- Runs entirely in your browser - no server backend
- Your Telegram session never leaves your device
- No tracking, no cookies, no data collection
- Open source - verify the code yourself

## Tech Stack

- **Vue 3** + TypeScript + Vite
- **Pinia** for state management
- **Vue Router** for navigation
- **TailwindCSS** for styling
- **GramJS** for Telegram MTProto (user accounts)
- **IndexedDB** for local storage
- **Vitest** + Playwright for testing

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run linter
npm run lint

# Run tests
npm test

# Build for production
npm run build
```

## Requirements

To use this app, you need:

1. **For User Accounts**: Telegram API credentials from [my.telegram.org](https://my.telegram.org)
2. **For Bots**: A bot token from [@BotFather](https://t.me/BotFather)

## License

MIT License - see [LICENSE](LICENSE) file.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `npm test && npm run lint`
4. Submit a pull request

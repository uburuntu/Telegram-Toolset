# Design System & Development Guidelines

## Design Philosophy

Clean, professional, fast. No gimmicks. The interface should feel like a native tool, not a flashy website.

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

Fast animations create a responsive feel:

| Type | Duration | Easing |
|------|----------|--------|
| Hover effects | 100ms | ease-out |
| State changes | 150ms | ease-out |
| Modal open/close | 150ms | ease-out |
| Page transitions | 200ms | ease-out |
| Loading spinners | 600ms | linear |

```css
/* Standard transition */
transition: all 150ms ease-out;

/* Tailwind */
transition-all duration-150 ease-out
```

**Never use**: Slow transitions (>300ms), bouncy effects, or decorative animations.

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
3. **Slow animations** - Nothing over 200ms for interactions
4. **Gradient backgrounds** - Keep backgrounds solid
5. **Decorative icons** - Icons should be functional
6. **Bouncy/spring effects** - Keep animations linear/ease-out
7. **Parallax or scroll effects** - Keep it simple
8. **Excessive spacing** - Don't waste screen space

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

- **App shell**: Vue 3 + Vite + TS, Pinia stores, Vue Router (landing-first, modules are lazy routes).
- **Modules system**: `src/modules/index.ts` registers tools with `accountType` and `requiredPermissions`; modules are lazy-loaded.
- **Auth UX**: Landing shows modules first; login modal opens on-demand. Supports multiple accounts (user/bot), stored in localStorage with active account switcher.
- **Telegram clients**:
  - **User**: GramJS via `telegramService` (MTProto) for dialogs/admin log/export/resend.
  - **Bot**: HTTP Bot API for `getMe` validation (no MTProto needed).
- **Account Info module**: Replaces bot-only view; shows data for both user and bot accounts. For bots, uses `getMe` to display name, username, capabilities (join groups, privacy mode, inline, web app).
- **Storage**: IndexedDB for backups/media (hybrid strategy in quota manager). Sessions in localStorage only; no server.
- **Internationalization**: `vue-i18n` with EN/RU; locale persisted in localStorage; language switcher uses `i18n.global.locale`.
- **Security/Privacy**: On-device only; bot token input masking and validation; API ID/Hash only stored locally.
- **CI/Test** (from plan): Vitest (unit/component), Playwright (E2E), GitHub Actions for lint/type/test/build.


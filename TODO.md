# Restart TODO

Last updated: 2026-04-26

This file is the re-entry brief for the next time someone picks up the repo. If the code and docs disagree, trust the code for current behavior and use this file for priority order.

## Current Checkpoint

Safe merge checkpoint:

- PR `#16`
- Branch: `chore/reviewer-followups`

What that stabilization batch adds:

- auth modal accessibility and keyboard behavior
- reproducible preview deploy path in CI
- mobile Playwright projects promoted into CI
- ZIP export filename sanitization
- direct Telegram connection-state tests
- app-level accessibility announcements for toasts and shared errors

Verified on the current branch:

- `npm run lint`
- `npm run type-check`
- `npm run test:unit`
- `npm run test:component`
- `npm run build`
- `npx playwright test --project=mobile-chrome`
- `npx playwright test --project=mobile-safari`
- PR CI run `24941732891` green

## First Steps When Returning

1. Pull latest `main` and confirm PR `#16` was merged cleanly.
2. Re-run:
   - `npm ci`
   - `npm run lint`
   - `npm run type-check`
   - `npm run test:unit`
   - `npm run test:component`
   - `npm run build`
3. If touching auth, routing, or module navigation, also run `npm run test:e2e` or the affected Playwright projects.
4. Read `AGENTS.md` before changing architecture or UI patterns.

## Highest-Priority Unresolved Risks

- Secrets are still stored in plaintext `localStorage`.
  - Affected data includes API credentials, bot tokens, and user session strings.
- Backups and LLM exports are not scoped to the owning account.
  - Account removal does not fully clean up account-owned stored data.
- The first-run privacy gate in `src/App.vue` still blocks the shell and conflicts with the product guidance in `AGENTS.md`.
- Live Telegram integration still needs periodic real-world smoke validation.
  - CI is good, but most Telegram behavior is still tested behind mocks.
- `src/services/telegram/client.ts` remains too large and still owns too many concerns.
- The production build still emits GramJS/browser-shim warnings and ships a heavy main chunk.

## Recommended Next Milestone

Do this before any large rewrite or visual redesign:

### A. Secure Storage And Account-Owned Data

- Move secrets out of plaintext `localStorage`.
- Use encrypted IndexedDB + WebCrypto for persisted credentials/session material.
- Add a migration path from the current account/session format.
- Add `ownerAccountId`-style scoping to backups and LLM export records.
- Delete or archive account-owned persisted data when an account is removed.

Exit criteria:

- no raw credentials or session strings in `localStorage`
- stored exports/backups are account-scoped
- migration behavior is documented and tested

### B. Live Telegram Smoke Pass

After storage work, do one manual validation pass and record the result:

- user login
- bot login
- account switching
- export
- resend
- scheduled messages
- account info

Exit criteria:

- one written smoke-test note exists in the repo or PR
- no auth/session regressions are discovered after the storage migration

## Next Milestone After That

### Platform Decomposition

- Split `src/services/telegram/client.ts` into smaller gateway-backed modules.
- Extract auth orchestration out of `LoginModal.vue`.
- Add direct coverage for routes and flows still under-tested:
  - `account-info`
  - `scheduled`
  - `llm-export`
  - `/backups`
  - real resend flow orchestration
- Move long-running Telegram work off the main thread where practical.

## Avoid On Return

- Do not start with a blind full rewrite.
- Do not rename the repo/product as a prerequisite for real engineering work.
- Do not add new modules before storage/auth hardening is finished.
- Do not spend the first milestone on visual polish or bundle work alone.

## Docs Discipline

When scope or priorities change, update these together in the same PR:

- `TODO.md`
- `AGENTS.md`
- `README.md`

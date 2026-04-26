# Restart TODO

This file is the restart brief for the next time someone picks up the repo. It should stay useful after merges, branch changes, and time away. If the code and docs disagree, trust the code for current behavior and use this file for priority order.

## Current Baseline

- API credentials, bot tokens, and user session strings now persist through encrypted IndexedDB + WebCrypto.
- Legacy plaintext auth data in `localStorage` is migrated on load and rewritten to sanitized metadata.

## First Steps When Returning

1. Pull latest `main`.
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

- Backups and LLM exports are not scoped to the owning account.
  - Account removal and cleanup still need a recoverable lifecycle, not immediate destructive deletion.
- The first-run privacy gate in `src/App.vue` still blocks the shell and conflicts with the product guidance in `AGENTS.md`.
- Live Telegram integration still needs periodic real-world smoke validation.
  - CI is good, but most Telegram behavior is still tested behind mocks.
- `src/services/telegram/client.ts` remains too large and still owns too many concerns.
- The production build still emits GramJS/browser-shim warnings and ships a heavy main chunk.

## Recommended Next Milestone

Do this before any large rewrite or visual redesign:

### A. Account-Owned Data With Recoverable Cleanup

- Add `ownerAccountId`-style scoping to backups and LLM export records.
- Keep auth/session removal separate from backup/export cleanup.
- On account removal, move owned data into a recoverable archive/quarantine state first.
- Add an explicit purge path or delayed garbage collection after a grace period.
- Document the recovery path so reconnect or migration issues do not force data loss.

Exit criteria:

- stored exports/backups are account-scoped
- account removal does not immediately destroy recoverable user data
- purge/archive behavior is documented and tested

### B. Live Telegram Smoke Pass

After the account-owned data work, do one manual validation pass and record the result:

- user login
- bot login
- account switching
- export
- resend
- scheduled messages
- account info

Exit criteria:

- one written smoke-test note exists in the repo or PR
- no auth/session regressions are discovered after the storage migration and data-lifecycle changes

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
- Do not hard-delete account-owned backups/exports as the default cleanup behavior.

## Docs Discipline

Keep long-lived docs durable. Do not record point-in-time coordination details here or in `AGENTS.md`, such as PR numbers, branch names, commit SHAs, CI run IDs, temporary statuses, or "current checkpoint" notes.

When scope or priorities change, update these together in the same PR:

- `TODO.md`
- `AGENTS.md`
- `README.md`

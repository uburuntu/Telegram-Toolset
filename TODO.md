# Restart TODO

This file is the restart brief for the next time someone picks up the repo. It should stay useful after merges, branch changes, and time away. If the code and docs disagree, trust the code for current behavior and use this file for priority order.

## Current Baseline

- API credentials, bot tokens, and user session strings persist through encrypted IndexedDB + WebCrypto.
- Legacy plaintext auth data in `localStorage` is migrated on load and rewritten to sanitized metadata.
- Backups and LLM exports persist with account ownership metadata.
- Removing a user account archives its owned backups/exports instead of deleting them, and adding the same phone again recovers archived data automatically.
- Backups and LLM exports expose explicit legacy claim/delete actions and archived delete actions in the UI.
- Privacy messaging lives in the normal product chrome rather than behind a first-run privacy modal.

## First Steps When Returning

1. Pull latest `main`.
2. Re-run:
   - `npm ci`
   - `npm run lint`
   - `npm run check:i18n`
   - `npm run type-check`
   - `npm run test:unit`
   - `npm run test:component`
   - `npm run build`
   - `npm run bundle:check`
3. If touching auth, routing, or module navigation, also run `npm run test:e2e` (or the affected Playwright projects) and `npm run test:e2e:dist` for a production-build smoke over the built artifact.
4. Read `AGENTS.md` before changing architecture or UI patterns.

## Highest-Priority Unresolved Risks

- Live Telegram integration still needs periodic real-world smoke validation.
  - CI is good, but most Telegram behavior is still tested behind mocks.
- Local-data lifecycle is explicit now, but any future cleanup work must stay recoverable by default.
  - Only add delayed GC, bulk purge, or more aggressive cleanup if it is deliberate, documented, and tested.
- User-account ownership still relies on a local UUID and phone hints rather than a persisted immutable Telegram user ID.
- Long-running jobs and session transitions are not yet coordinated by account and session generation.
- `src/services/telegram/client.ts` remains too large and still owns too many concerns.
- The production build still emits GramJS/browser-shim warnings and ships a heavy main chunk.

## Recommended Next Milestone

Do this before any large rewrite or visual redesign:

### A. Live Telegram Smoke Pass

After the storage and data-lifecycle changes, do one manual validation pass and record the result:

- user login
- bot login
- account switching and re-login
- export
- resend
- scheduled messages
- LLM context export
- account info
- backup/local-data ownership actions

Exit criteria:

- every auth, storage-schema, ownership, peer, or mutation-semantics PR/release has a dated smoke
  result attached to that change
- the result records an explicit pass/fail for each workflow above, including archive, recovery,
  claim, deletion, and no-data-loss assertions
- no auth/session or local-data lifecycle regressions remain unresolved

### B. Account-Owned Data Follow-Through

- Keep account-owned data cleanup explicit and recoverable by default.
- If needed, add delayed garbage collection or bulk purge only as an opt-in follow-up.
- Keep hard delete opt-in and separate from account removal.
- Document any lifecycle changes so reconnect or migration issues do not force data loss.

Exit criteria:

- any new cleanup behavior is explicit, documented, and tested
- archive/recovery behavior remains separate from account removal
- reconnect or migration bugs cannot silently destroy local data

## Next Milestone After That

### Platform Decomposition

Follow [ARCHITECTURE.md](./ARCHITECTURE.md) in dependency order:

1. Add stable Telegram principals and a serialized session coordinator.
2. Introduce account-affine jobs with bounded cancellation and explicit uncertain outcomes.
3. Harden the account/storage repository, durable account-removal quiescing, ownership
   enforcement, persistence status, and cross-tab recovery.
4. Standardize peer references, split the Telegram gateway, and separate mutation retry semantics.
5. Add bounded worker/streaming pipelines and expand the production-artifact browser smoke to every route.
6. Decompose route workflows after those platform contracts exist.

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
- `ARCHITECTURE.md` when platform boundaries or sequencing change

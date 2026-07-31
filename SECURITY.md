# Security Policy

## Supported Version

Security fixes target the current `main` branch and the web deployment at
[telegram-toolset.rmbk.me](https://telegram-toolset.rmbk.me/). Historical desktop releases are kept
for archival purposes and are not actively supported.

## Report a Vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/uburuntu/Telegram-Toolset/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Include, where applicable:

- the affected route, browser, and account type;
- impact and realistic attack scenario;
- minimal reproduction steps using synthetic data;
- whether the issue affects credentials, sessions, ownership, local storage, or Telegram mutations;
  and
- a suggested mitigation if you have one.

Never send real API hashes, session strings, bot tokens, phone numbers, authorization hashes, private
chat content, or an IndexedDB export containing account data. Redact screenshots and logs before
attaching them.

## Sensitive Areas

Extra care is required around:

- multi-account session isolation and auth transitions;
- encrypted IndexedDB secrets and legacy migration;
- cross-account ownership, archival, claim, and deletion;
- HTML formatting of user-authored Telegram content;
- Telegram mutation retries and uncertain delivery outcomes; and
- data crossing structured-clone, download, clipboard, or external-link boundaries.

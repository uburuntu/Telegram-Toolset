/**
 * Browser shim for GramJS' Node-only NetSocket implementation.
 *
 * In the browser, GramJS uses WebSockets (see `telegram/platform` isBrowser).
 * However, the package still imports `PromisedNetSockets` eagerly via
 * `telegram/extensions/index.js`, which drags in `socks`/`net` and crashes under Vite.
 *
 * This shim prevents the crash. It should never be instantiated in the browser.
 */

export class PromisedNetSockets {
  constructor() {
    throw new Error(
      'PromisedNetSockets is not available in the browser. Ensure GramJS is configured to use WebSockets (useWSS).',
    )
  }
}

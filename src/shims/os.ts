/**
 * Minimal browser shim for Node's `os` module.
 *
 * GramJS imports `telegram/client/os.js` which `require("os")` and then calls
 * `os.type()` / `os.release()` to populate `deviceModel`/`systemVersion`.
 *
 * In the browser, Vite externalizes Node built-ins by default, so `os` becomes
 * an empty stub and GramJS crashes.
 */

type Endianness = 'LE' | 'BE'

const osShim = {
  EOL: '\n',
  type: () => 'Browser',
  release: () => '0',
  platform: () => 'browser',
  arch: () => 'unknown',
  endianness: (): Endianness => 'LE',
  hostname: () => '',
  homedir: () => '/',
  tmpdir: () => '/tmp',
  cpus: () => [],
  freemem: () => 0,
  totalmem: () => 0,
  uptime: () => 0,
}

export default osShim

// Named exports (for compatibility with `import * as os from 'os'`)
export const EOL = osShim.EOL
export const type = osShim.type
export const release = osShim.release
export const platform = osShim.platform
export const arch = osShim.arch
export const endianness = osShim.endianness
export const hostname = osShim.hostname
export const homedir = osShim.homedir
export const tmpdir = osShim.tmpdir
export const cpus = osShim.cpus
export const freemem = osShim.freemem
export const totalmem = osShim.totalmem
export const uptime = osShim.uptime



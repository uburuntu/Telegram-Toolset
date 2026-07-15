// Playwright's web server honors http(s)_proxy, which can intercept requests to
// the local dev/preview server and hang startup. Force localhost to bypass any
// configured proxy so the server is always reachable directly.
export function bypassLocalProxy(): void {
  const noProxyHosts = new Set(
    [process.env.NO_PROXY, process.env.no_proxy]
      .flatMap((value) => value?.split(',') ?? [])
      .map((host) => host.trim())
      .filter(Boolean),
  )
  noProxyHosts.add('localhost')
  noProxyHosts.add('127.0.0.1')
  const normalizedNoProxy = [...noProxyHosts].join(',')
  process.env.NO_PROXY = normalizedNoProxy
  process.env.no_proxy = normalizedNoProxy
}

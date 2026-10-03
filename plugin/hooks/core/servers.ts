// Server origins (SPEC sections 31 and 33). The mod talks to exactly one origin; community servers are separate worlds.
// Plain string parsing, so it runs anywhere ES2023 does.

export const DEFAULT_SERVER = 'https://spinlings.dev'

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

/**
 * A server URL reduced to its origin, e.g. ` HTTPS://Spinlings.dev/v1/x ` -> `https://spinlings.dev`. A bare host means
 * https. Only https is allowed, except http on localhost, 127.0.0.1 and [::1]. Credentials, non-ASCII hosts and bad
 * ports are refused: the result is null.
 */
export function normalizeServerUrl(url: string): string | null {
  let s = url.trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s
  const m = /^(https?):\/\/([^/?#]*)(?:[/?#].*)?$/i.exec(s)
  if (!m) return null
  const scheme = m[1]!.toLowerCase()
  const authority = m[2]!.toLowerCase()
  if (authority.includes('@')) return null
  const hp = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(authority)
  if (!hp) return null
  let host = hp[1]!
  if (!host.startsWith('[')) {
    host = host.replace(/\.$/, '')
    if (host.length === 0 || host.length > 253 || !host.split('.').every(l => LABEL.test(l))) return null
  }
  const local = LOCAL.has(host)
  if (scheme === 'http' && !local) return null
  if (!local && !host.startsWith('[') && !host.includes('.')) return null
  const port = hp[2] === undefined ? undefined : Number(hp[2])
  if (port !== undefined && (port < 1 || port > 65535)) return null
  const keep = port !== undefined && port !== (scheme === 'https' ? 443 : 80)
  return `${scheme}://${host}${keep ? ':' + port : ''}`
}

/** True when a URL the server handed over (a sign-in page) lives on that same server's origin. */
export function isOnServer(url: string, origin: string): boolean {
  return /^https?:\/\//i.test(url.trim()) && normalizeServerUrl(url) === origin
}

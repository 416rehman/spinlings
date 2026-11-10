// Claude Code's plugin list as 2.1.319 writes it (JSON.stringify(list, null, 2), each entry in its schema's key order:
// source, installLocation, lastUpdated, autoUpdate), with another marketplace whose git URL carries a token: the
// canary no flow may ever let out of the file. Shared by the Node and SDK suites; not a test file itself.
export const CANARY = 'CANARY123'

export function list(spinlings: Record<string, unknown> = {}): Record<string, Record<string, unknown>> {
  return {
    'claude-plugins-official': {
      source: { source: 'github', repo: 'anthropics/claude-plugins-official' },
      installLocation: '/home/a/.claude/plugins/marketplaces/claude-plugins-official', lastUpdated: '2026-11-01T10:00:00.000Z',
    },
    private: {
      source: { source: 'git', url: `https://user:${CANARY}@host/x.git` },
      installLocation: '/home/a/.claude/plugins/marketplaces/private', lastUpdated: '2026-11-01T10:00:01.000Z',
    },
    spinlings: {
      source: { source: 'git', url: 'https://github.com/416rehman/spinlings.git' },
      installLocation: '/home/a/.claude/plugins/marketplaces/spinlings', lastUpdated: '2026-11-01T10:00:02.000Z', ...spinlings,
    },
  }
}

export const cc = (l: unknown) => JSON.stringify(l, null, 2)

/**
 * The base64 letters fixed by the canary alone when it sits `k` bytes past a multiple of three in an encoded text:
 * whatever surrounds it, a base64 copy of anything holding the canary holds one of these three.
 */
function b64Core(k: number): string {
  const raw = 'x'.repeat(k) + CANARY + 'yy'
  const out = btoa(raw)
  let core = ''
  for (let i = 0; i < out.length; i++) if (6 * i >= 8 * k && 6 * i + 6 <= 8 * (k + CANARY.length)) core += out[i]
  return core
}

const hex = [...new TextEncoder().encode(CANARY)].map(b => b.toString(16).padStart(2, '0')).join('')

/**
 * What a copy of the list would show of it, in any common form: the canary as text, as base64 at each alignment, as
 * hex either case, as \u escapes; and the fixture's other words (another marketplace's name, its git host, a path).
 */
export const LEAKS: readonly string[] = [
  CANARY, b64Core(0), b64Core(1), b64Core(2), hex,
  [...CANARY].map(ch => `\\u00${ch.charCodeAt(0).toString(16)}`).join(''),
  'host/x.git', 'claude-plugins-official', 'marketplaces/private', '/home/a/.claude',
]

/** The leaks found in `text` (JSON.stringify of what a flow kept, said or sent): empty when none. */
export function leaksIn(text: string): string[] {
  const lower = text.toLowerCase()
  return LEAKS.filter(l => (l === hex ? lower.includes(hex) : text.includes(l)))
}

/** UTF-8 text as base64, the way $.fs.read answers `{ as: 'bytes' }`. */
export function b64(text: string): string {
  let raw = ''
  for (const byte of new TextEncoder().encode(text)) raw += String.fromCharCode(byte)
  return btoa(raw)
}

/** Where an installed copy's plugin list is, and its lock: the only paths the mod may name. */
export const REGISTRY_RE = /[\\/]plugins[\\/]known_marketplaces\.json$/
export const LOCK_RE = /[\\/]plugins[\\/]known_marketplaces\.json\.lock$/

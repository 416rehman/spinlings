// Versions (SPEC 32): how two compare, and which are releases. Shared by the mod, its release notes and the server.
import { RELEASE_RE } from './schemas.ts'

const parse = (v: string) => {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v)
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null
}

/** `1.2.3`, with or without a pre-release tag: a version compareSemver can order. */
export const isVersion = (v: string): boolean => parse(v) !== null

/** -1, 0 or 1; pre-release tags sort before their release. Unreadable versions compare equal. */
export function compareSemver(a: string, b: string): number {
  const x = parse(a), y = parse(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i]! < y.n[i]! ? -1 : 1
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre < y.pre ? -1 : 1
}

/**
 * A release, `1.2.3`: the only kind of version the mod offers as an update. A pre-release tag is a server's free
 * text (a community server could write anything there), and the marketplace carries releases.
 */
export function isRelease(v: string): boolean {
  return RELEASE_RE.test(v)
}

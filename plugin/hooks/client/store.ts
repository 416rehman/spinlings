// The $.store layout and a checked reader for every record in it. The store is shared by every session on the machine
// and survives versions of this mod, so nothing is trusted on the way back in: each reader rebuilds its record field
// by field and falls back to a default. Online data lives under `server:{origin}:` (SPEC 33), the offline save under
// `offline:v1` (SPEC 28); neither world's backend ever reads the other's keys.
import type { CardsResponse, MeResponse, ReleaseNote, VersionResponse } from '../core/api.ts'
import type { Family } from '../core/types.ts'
import { FAMILIES } from '../core/families.ts'
import { parse, parseCardsResponse, parseMeResponse, parseVersionResponse, releaseNotesSchema, RELEASE_RE, SEMVER_RE } from '../core/schemas.ts'
import type { World } from './types.ts'
import type { ReleaseRecord } from './whatsnew.ts'

export const KEYS = {
  prefs: 'prefs',
  presence: 'presence',
  privacy: 'privacy',
  /** the auto-update offer: how often it was made, when it may come again, Don't ask again (client/autoupdate.ts) */
  autoUpdate: 'autoupdate',
  /** the one-press switch's own record that it turned auto-update on (client/autoswitch.ts); never any file text */
  autoSwitch: 'autoupdate:mine',
  /** a Turn it on under way (client/autoswitch.ts): its own key, so one session's press never overwrites another's record */
  autoSwitchPending: 'autoupdate:pending',
  /** the newest mod version that has run on this computer (client/whatsnew.ts): `updated` greets each version once */
  release: 'release',
  /** the offline save: written only by the offline engine (client/local/**) */
  offline: 'offline:v1',
  offlineMeta: 'offline:meta',
  session: (origin: string) => `server:${origin}:session`,
  cache: (origin: string) => `server:${origin}:cache`,
  meta: (origin: string) => `server:${origin}:meta`,
  /**
   * spinlings.dev's release notes from its last version answer, kept apart from the meta: a session of an older mod
   * rewrites the meta with its own reader, which knows nothing of notes
   */
  notes: (origin: string) => `server:${origin}:notes`,
  season: (origin: string, season: number) => `server:${origin}:season:${season}`,
} as const

/** Every key one server origin owns: what "forget this server" removes. */
export function serverKeys(keys: readonly string[], origin: string): string[] {
  return keys.filter(k => k.startsWith(`server:${origin}:`))
}

const str = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' && v.length <= max ? v : fallback)
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const strs = (v: unknown, max: number, each: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= each).slice(-max) : []
const world = (v: unknown): World | null => (v === 'online' || v === 'offline' ? v : null)
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {})

// ---------- prefs (machine-wide) ----------

export type StoredPrefs = {
  quiet: boolean
  motion: boolean
  sound: boolean
  /** the active world; null before the first run */
  world: World | null
  /** 0.1.0's `world` option as last applied; kept as stored, never read (the option is gone) */
  worldOption: World | null
  /** the server in use, from /spin server (or 0.1.0's server_url option); null falls back to serverOption */
  server: string | null
  /** 0.1.0's server_url option as last applied: the server while /spin server never chose one; never rewritten */
  serverOption: string | null
  /** one-time hints already shown (SPEC 21.3) */
  hints: string[]
  /** the UTC day of the last daily hello banner */
  helloDay: string
  /** the newest mod version the band said is out (or is needed): each is news once */
  updateSeen: string
  /** the newest mod version the band said this one can't play online without: news once, even when told as out before */
  neededSeen: string
  /** community origins the player agreed to once (SPEC 33) */
  communityOk: string[]
}

export function readPrefs(v: unknown): StoredPrefs {
  const r = obj(v)
  return {
    quiet: bool(r.quiet, false),
    motion: bool(r.motion, true),
    sound: bool(r.sound, false),
    world: world(r.world),
    worldOption: world(r.worldOption),
    server: typeof r.server === 'string' && r.server.length <= 200 ? r.server : null,
    serverOption: typeof r.serverOption === 'string' && r.serverOption.length <= 200 ? r.serverOption : null,
    hints: strs(r.hints, 64, 40),
    helloDay: str(r.helloDay, 10),
    updateSeen: typeof r.updateSeen === 'string' && SEMVER_RE.test(r.updateSeen) ? r.updateSeen : '',
    neededSeen: typeof r.neededSeen === 'string' && SEMVER_RE.test(r.neededSeen) ? r.neededSeen : '',
    communityOk: strs(r.communityOk, 16, 200),
  }
}

// ---------- per server origin ----------

/** A session token as kept: base64url, 20 to 128 characters (SPEC 27). */
export function readToken(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(v) ? v : null
}

/** At most this many cards are cached per server, so the cache never crowds the offline save out of the 4 MiB store. */
export const CACHE_MAX_CARDS = 1500

export type Cache = { me: MeResponse; cards: CardsResponse | null }

/** The last answers, for an instant pane before the server answers; re-validated like any server answer. */
export function readCache(v: unknown): Cache | null {
  const r = obj(v)
  try {
    const me = parseMeResponse(r.me)
    let cards: CardsResponse | null = null
    try {
      cards = r.cards === null || r.cards === undefined ? null : parseCardsResponse(r.cards)
    } catch {
      cards = null
    }
    return { me, cards }
  } catch {
    return null
  }
}

export function cacheRecord(me: MeResponse, cards: CardsResponse | null): Cache {
  return { me: parseMeResponse(me), cards: cards && cards.cards.length <= CACHE_MAX_CARDS ? parseCardsResponse(cards) : null }
}

export type ServerMeta = {
  /** the UTC day of the last version check (once a day, SPEC 32) */
  versionDay: string
  /** the mod version that read the capabilities; an update refreshes them even on the same day */
  versionClient: string
  version: VersionResponse | null
  /** the welcome moment has been acted on in this world */
  welcomed: boolean
  /** the UTC day the passkey offer last showed (never more than once a week, SPEC 30) */
  passkeyDay: string
  /** the last duel start: waiting battles duel only after 20 quiet minutes */
  lastDuelAt: number
  /** the player deleted this server's account: no silent re-join until they ask (/spin world online) */
  deleted: boolean
}

export function readMeta(v: unknown): ServerMeta {
  const r = obj(v)
  let version: VersionResponse | null = null
  try {
    version = r.version === undefined || r.version === null ? null : parseVersionResponse(r.version)
  } catch {
    version = null
  }
  return {
    versionDay: str(r.versionDay, 10), versionClient: str(r.versionClient, 32), version, welcomed: bool(r.welcomed, false), passkeyDay: str(r.passkeyDay, 10),
    lastDuelAt: num(r.lastDuelAt), deleted: bool(r.deleted, false),
  }
}

/** The newest version that has run here, or null when none is recorded (a first run, or a mod from before 0.3.0). */
export function readRelease(v: unknown): ReleaseRecord | null {
  const r = obj(v)
  return r.v === 1 && typeof r.ran === 'string' && RELEASE_RE.test(r.ran) ? { v: 1, ran: r.ran } : null
}

/** What spinlings.dev's last version answer said each release brings, through the reader's bounds; [] when unreadable. */
export function readNotes(v: unknown): ReleaseNote[] {
  const r = obj(v)
  if (r.v !== 1) return []
  try {
    return parse(releaseNotesSchema, r.notes)
  } catch {
    return []
  }
}

export type OfflineMeta = { welcomed: boolean; lastDuelAt: number }

export function readOfflineMeta(v: unknown): OfflineMeta {
  const r = obj(v)
  return { welcomed: bool(r.welcomed, false), lastDuelAt: num(r.lastDuelAt) }
}

// ---------- presence (one lamp per machine, SPEC 6) ----------

export type Lease = { holder: string; until: number }
export type StoredPresence = {
  lease: Lease | null
  /** presence minutes toward the next pack, and which family each was spent in */
  minutes: number
  tally: Record<Family, number>
  /** the wall-clock minute counted last: two sessions never count one minute twice */
  lastMinute: number
  /** the server said no: a full bank waits until the world in play has room, spacing until `blockedUntil` */
  blocked: 'bank' | 'spacing' | null
  blockedUntil: number
}

export function emptyTally(): Record<Family, number> {
  return { haiku: 0, sonnet: 0, opus: 0, fable: 0 }
}

export function readPresence(v: unknown): StoredPresence {
  const r = obj(v)
  const l = obj(r.lease)
  const lease = typeof l.holder === 'string' && l.holder.length <= 64 && typeof l.until === 'number' ? { holder: l.holder, until: l.until } : null
  const tally = emptyTally()
  const t = obj(r.tally)
  for (const f of FAMILIES) tally[f] = Math.min(100_000, Math.floor(num(t[f])))
  const blocked = r.blocked === 'bank' || r.blocked === 'spacing' ? r.blocked : null
  return {
    lease, minutes: Math.min(100_000, Math.floor(num(r.minutes))), tally, lastMinute: num(r.lastMinute), blocked,
    blockedUntil: num(r.blockedUntil),
  }
}

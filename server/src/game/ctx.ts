// The foundation every route builds on: typed API routes with strict request parsing, server
// randomness, the caller's player row and its version guard (SPEC 16), frozen seasons (SPEC 32)
// and day arithmetic. Platform-free, like the rest of the server.
import { API_ROUTES } from '../../../plugin/hooks/core/api.ts'
import type { ApiOp, ApiRequest, ApiResponse } from '../../../plugin/hooks/core/api.ts'
import { rngFromSeed } from '../../../plugin/hooks/core/rng.ts'
import { cleanText, parsePathParam, parseRequest, SchemaError } from '../../../plugin/hooks/core/schemas.ts'
import { toHex } from '../../../plugin/hooks/core/sha256.ts'
import { GENERATOR_VERSION, installSeason, seasonSpecies } from '../../../plugin/hooks/core/species.ts'
import type { Rng, Species } from '../../../plugin/hooks/core/types.ts'
import { seasonOf, utcDay } from '../../../plugin/hooks/core/world.ts'
import type { Api, Ctx, PlayerCtx } from '../app.ts'
import { guard, stmt } from '../db.ts'
import type { Db, SqlParam, Stmt } from '../db.ts'
import { fail, json } from '../http.ts'
import type { PlayerRow, SeasonRow } from '../schema.ts'
import { GIFT_WORDS } from './words.ts'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** What minting, notices and grants need from a request: Ctx and PlayerCtx both are one. */
export type Env = { readonly db: Db; readonly now: number; randomBytes(n: number): Uint8Array }

// ---- randomness (crypto.getRandomValues in production, seeded in tests) ------------------------

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** RFC 4648 base32, lower case, unpadded. */
export function base32(bytes: Uint8Array): string {
  let out = '', bits = 0, value = 0
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

/** A random 128-bit id: 26 base32 characters (SPEC 26.3). Cards, packs, battles, offers, notices. */
export const newId = (env: Pick<Env, 'randomBytes'>): string => base32(env.randomBytes(16))

/** 128 random bits as hex: a battle or Mythic seed. */
export const newSeed = (env: Pick<Env, 'randomBytes'>): string => toHex(env.randomBytes(16))

/** A fresh stream for server rolls (packs, catches, bounties, fusions), seeded with 128 random bits. */
export const rngOf = (env: Pick<Env, 'randomBytes'>): Rng => rngFromSeed(newSeed(env))

/** Uniform integer in [0, n), without modulo bias. */
export function randomInt(env: Pick<Env, 'randomBytes'>, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError('randomInt range')
  const limit = 2 ** 32 - (2 ** 32 % n)
  for (;;) {
    const b = env.randomBytes(4)
    const v = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0
    if (v < limit) return v % n
  }
}

export const pickWord = (env: Pick<Env, 'randomBytes'>, list: readonly string[]): string => list[randomInt(env, list.length)]!

/** word-word-word-dddd (GIFT_CODE_RE): three gift words drawn with replacement plus 4 digits, about 44 bits. */
export function newGiftCode(env: Pick<Env, 'randomBytes'>): string {
  const digits = String(randomInt(env, 10_000)).padStart(4, '0')
  return `${pickWord(env, GIFT_WORDS)}-${pickWord(env, GIFT_WORDS)}-${pickWord(env, GIFT_WORDS)}-${digits}`
}

// ---- typed routes ------------------------------------------------------------------------------

type RouteOptions = { limit?: string }

/**
 * The request of an API operation, checked strictly: the JSON body against REQUEST_SCHEMAS (unknown
 * keys refused) and every `:name` path segment against PATH_PARAMS. Any mismatch is a 400 naming the
 * path, never echoing a value.
 */
export function requestOf<K extends ApiOp>(ctx: Pick<Ctx, 'body' | 'params'>, op: K): ApiRequest<K> {
  try {
    const out = { ...(parseRequest(op, ctx.body) as Record<string, unknown>) }
    for (const [, name] of API_ROUTES[op].path.matchAll(/:([A-Za-z]+)/g)) {
      const value = parsePathParam(name!, ctx.params[name!] ?? '')
      out[name!] = name === 'season' ? Number(value) : value
    }
    return out as ApiRequest<K>
  } catch (err) {
    if (err instanceof SchemaError) fail('bad_request', cleanText(err.message, 200))
    throw err
  }
}

/**
 * Adds an authenticated API operation at its API_ROUTES method and path. The handler gets the parsed
 * request (path parameters and body fields in one object) and returns the response object, which
 * TypeScript holds to ApiResponse<K>. The current season is installed first. Touch hooks run first
 * unless `touch: false`.
 */
export function apiRoute<K extends ApiOp>(
  api: Api, op: K,
  handler: (ctx: PlayerCtx, req: ApiRequest<K>) => Promise<ApiResponse<K>>,
  o: RouteOptions & { touch?: boolean } = {},
): void {
  const route = API_ROUTES[op]
  if (!route.auth) throw new Error(`${op} is public: use publicRoute`)
  api.add({
    method: route.method, path: route.path, ...o,
    handler: async ctx => {
      const req = requestOf(ctx, op)
      await ensureSeason(ctx.db, seasonOf(ctx.now))
      return json(await handler(ctx, req))
    },
  })
}

/** Adds a public API operation. Return a Response instead of the object to set your own headers. */
export function publicRoute<K extends ApiOp>(
  api: Api, op: K,
  handler: (ctx: Ctx, req: ApiRequest<K>) => Promise<ApiResponse<K> | Response>,
  o: RouteOptions = {},
): void {
  const route = API_ROUTES[op]
  if (route.auth) throw new Error(`${op} needs a session: use apiRoute`)
  api.add({
    method: route.method, path: route.path, public: true, ...o,
    handler: async ctx => {
      const req = requestOf(ctx, op)
      await ensureSeason(ctx.db, seasonOf(ctx.now))
      const res = await handler(ctx, req)
      return res instanceof Response ? res : json(res)
    },
  })
}

/** A JSON answer the client and any proxy may keep for `seconds` (public, identical for everyone). */
export const cached = (data: unknown, seconds: number): Response =>
  json(data, 200, { 'Cache-Control': `public, max-age=${seconds}${seconds >= 31_536_000 ? ', immutable' : ''}` })

/** Another player's object is as invisible as a missing one (SPEC 26.3). */
export const notFound = (what: string): never => fail('not_found', `No such ${what}`)

// ---- the player row ----------------------------------------------------------------------------

export function loadPlayer(db: Db, id: string): Promise<PlayerRow | undefined> {
  return db.get<PlayerRow>('SELECT * FROM players WHERE id = ?', id)
}

/** Aborts the batch unless the player row is still the one this attempt read. */
export const playerGuard = (p: Pick<PlayerRow, 'id' | 'version'>): Stmt =>
  guard('SELECT 1 FROM players WHERE id = ? AND version = ?', p.id, p.version)

export const bumpPlayer = (id: string): Stmt => stmt('UPDATE players SET version = version + 1 WHERE id = ?', id)

const COLUMN = /^[a-z][a-z0-9_]*$/

/** UPDATE players SET <col> = ?, ... for the given player. Column names come from code, never input. */
export function setPlayer(id: string, fields: Readonly<Record<string, SqlParam>>): Stmt {
  const cols = Object.keys(fields)
  if (!cols.length || !cols.every(c => COLUMN.test(c))) throw new Error('setPlayer: bad columns')
  return stmt(`UPDATE players SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map(c => fields[c]!), id)
}

/** Relative, so it composes with any other write to the same row in one batch (and other players'). */
export const addSparks = (id: string, delta: number): Stmt => stmt('UPDATE players SET sparks = sparks + ? WHERE id = ?', delta, id)

/** Refuses a spend the player cannot afford (the version guard keeps `sparks` current). */
export function mustAfford(p: Pick<PlayerRow, 'sparks'>, cost: number): void {
  if (p.sparks < cost) fail('insufficient_sparks', `That needs ${cost} sparks`)
}

/**
 * One atomic write for the caller (SPEC 16): the player's version guard, then `stmts` (their own
 * guards first, then writes), then the player's version bump. A Conflict re-runs the whole handler.
 */
export function commit(ctx: { readonly db: Db; readonly player: Pick<PlayerRow, 'id' | 'version'> }, stmts: readonly Stmt[]) {
  return ctx.db.batch([playerGuard(ctx.player), ...stmts, bumpPlayer(ctx.player.id)])
}

/** A JSON column, or `fallback` when it is empty or unreadable. */
export function readJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export const teamOf = (p: Pick<PlayerRow, 'team'>): string[] => readJson<string[]>(p.team, [])

// ---- days --------------------------------------------------------------------------------------

/** Midnight UTC of a 'YYYY-MM-DD' day, in ms. */
export const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`)

/** The day `n` days after `day` (n may be negative). */
export const addDays = (day: string, n: number): string => utcDay(dayStart(day) + n * DAY)

export const today = (now: number): string => utcDay(now)

// ---- frozen seasons (SPEC 32) ------------------------------------------------------------------

/** per database: season -> the generator version its stored species were made with */
const installed = new WeakMap<Db, Map<number, number>>()

/**
 * Makes core's seasonSpecies(season) answer with this server's frozen species: read from `seasons`,
 * or generated with the current GENERATOR_VERSION and stored the first time anyone needs the season.
 * Cheap after the first call per isolate. Call it before minting or computing stats for a season;
 * apiRoute, publicRoute and the card loaders in mint.ts already do.
 */
export async function ensureSeason(db: Db, season: number): Promise<{ generator: number; species: readonly Species[] }> {
  let done = installed.get(db)
  if (!done) installed.set(db, (done = new Map()))
  const known = done.get(season)
  if (known !== undefined) return { generator: known, species: seasonSpecies(season) }
  const read = () => db.get<SeasonRow>('SELECT season, generator, species_json FROM seasons WHERE season = ?', season)
  let row = await read()
  if (!row) {
    await db.batch([stmt(
      'INSERT INTO seasons (season, generator, species_json) VALUES (?, ?, ?) ON CONFLICT (season) DO NOTHING',
      season, GENERATOR_VERSION, JSON.stringify(seasonSpecies(season)),
    )])
    row = (await read())!
  }
  const species = JSON.parse(row.species_json) as Species[]
  if (!installSeason(season, species)) throw new Error(`season ${season} is stored broken`)
  done.set(season, row.generator)
  return { generator: row.generator, species: seasonSpecies(season) }
}

export async function ensureSeasons(db: Db, seasons: Iterable<number>): Promise<void> {
  for (const s of new Set(seasons)) await ensureSeason(db, s)
}

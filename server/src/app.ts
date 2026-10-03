// The request loop shared by the Worker and Node: limits, routing, sessions, the optimistic handler
// pattern over the async Db (SPEC 16), the client version gate (SPEC 32) and the retention sweep
// (SPEC 20.4). Endpoints live in ./routes/ and arrive through registerRoutes, so adding one never
// touches this file.
import { SEMVER_RE } from '../../plugin/hooks/core/schemas.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import { bearerToken, DEFAULT_DIFFICULTY, findSession, hashToken, issueChallenge } from './auth.ts'
import type { SessionPlayer } from './auth.ts'
import { Conflict, stmt, withRetry } from './db.ts'
import type { Db } from './db.ts'
import { createRouter, errorResponse, fail, HttpError, json, readJson, secure } from './http.ts'
import type { Method } from './http.ts'
import { createAddressKey, createRateLimits, pruneJoinCounters, RATES } from './ratelimit.ts'
import type { Rate } from './ratelimit.ts'
import { registerRoutes } from './routes/index.ts'
import type { PlayerRow } from './schema.ts'

export type Config = {
  /** proof-of-work bits for new join challenges */
  difficulty: number
  /** the HMAC key for address keys; a Worker secret, at least 32 characters */
  secret: string
  /** named in-memory buckets: RATES plus anything a route wants to spend from */
  rates: Readonly<Record<string, Rate>>
  /**
   * The one origin this server answers as (SPEC 31), e.g. https://spinlings.dev: the passkey rp.id
   * and the base of every link it hands out. Unset, each request's own origin is used.
   */
  origin?: string
  /** mods older than this get 426 upgrade_required (SPEC 32) */
  minClient: string
}

export type AppOptions = {
  db: Db
  config: Partial<Config> & { secret: string }
  now?: () => number
  randomBytes?: (n: number) => Uint8Array
  /** where unexpected errors go; it only ever receives a route pattern and an error name */
  log?: (message: string) => void
  /** extra routes registered after ./routes/ (tests, local tools) */
  register?: (api: Api) => void
}

export type Ctx = {
  readonly req: Request
  readonly url: URL
  readonly params: Readonly<Record<string, string>>
  /** the parsed JSON body of POST, PUT and PATCH (validate it strictly), otherwise undefined */
  readonly body: unknown
  readonly db: Db
  readonly config: Config
  /** the request's one instant; use it instead of a clock */
  readonly now: number
  /** config.origin, else this request's origin: build links and the passkey rp from it */
  readonly origin: string
  /** HMAC(SECRET, day + address), cut to 16 bytes: the only form of the caller's address there is */
  readonly addressKey: string
  /** the caller, read fresh for this attempt; null on public routes */
  readonly player: PlayerRow | null
  randomBytes(n: number): Uint8Array
  /**
   * Spends one token from a named in-memory bucket, keyed by the token (else the address key).
   * Every attempt spends again; a route's own `limit` is spent once.
   */
  limit(name: string, key?: string): void
}
export type PlayerCtx = Ctx & { readonly player: PlayerRow; /** the caller's session (one per device) */ readonly sessionId: string }

export type Handler<C> = (ctx: C) => Response | Promise<Response>

/**
 * A handler reads, decides, then commits at most one db.batch that starts with a guard for
 * everything it read (SPEC 16). On Conflict the app runs it again from the top with a fresh player
 * row, up to 3 more times, then answers 409 conflict. So a handler has no other side effects.
 * `limit` names an in-memory bucket spent once before the first attempt. `touch: false` skips the
 * touch hooks for a read that never needs them (they run by default on every authenticated route).
 */
export type RouteSpec =
  | { method: Method; path: string; public: true; limit?: string; handler: Handler<Ctx> }
  | { method: Method; path: string; public?: false; limit?: string; touch?: boolean; handler: Handler<PlayerCtx> }

export type Api = {
  add(route: RouteSpec): void
  /**
   * Runs before every authenticated handler (unless the route says `touch: false`), inside the same
   * retry loop: daily resets, settling abandoned battles, returning expired gifts. It commits its own
   * batch and must be cheap when there is nothing to do. After changing the player row, return the
   * row as it is now: the next hook and the handler get it.
   */
  onTouch(hook: (ctx: PlayerCtx) => Promise<PlayerRow | void>): void
  /** Runs on the hourly sweep after the built-in retention deletes. */
  onSweep(hook: (db: Db, now: number) => Promise<void>): void
}

export type App = ((req: Request, client: { ip: string }) => Promise<Response>) & {
  /** Retention (SPEC 20.4): the Worker's cron and the Node timer call this hourly. */
  sweep(now?: number): Promise<void>
}

const MAX_URL = 2048
const HAS_BODY = new Set(['POST', 'PUT', 'PATCH'])
const RETRIES = 3
export const MIN_CLIENT = '0.1.0'
/** Always answered, whatever the client: how an old mod learns it is old. */
const UNGATED = new Set(['/v1/version', '/v1/health'])

export function createApp(options: AppOptions): App {
  const { db } = options
  const now = options.now ?? Date.now
  const randomBytes = options.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)))
  const log = options.log ?? ((message: string) => console.error(message))
  const config: Config = {
    difficulty: options.config.difficulty ?? DEFAULT_DIFFICULTY,
    secret: options.config.secret,
    rates: { ...RATES, ...options.config.rates },
    minClient: options.config.minClient ?? MIN_CLIENT,
    ...(options.config.origin ? { origin: originOf(options.config.origin) } : {}),
  }
  if (typeof config.secret !== 'string' || config.secret.length < 32) throw new Error('SECRET must be at least 32 characters')
  if (!SEMVER_RE.test(config.minClient)) throw new Error('minClient must be a semver')
  const addressKey = createAddressKey(config.secret)
  const limits = createRateLimits(config.rates)
  const router = createRouter<RouteSpec>()
  const touchHooks: ((ctx: PlayerCtx) => Promise<PlayerRow | void>)[] = []
  const sweepHooks: ((db: Db, now: number) => Promise<void>)[] = []
  const api: Api = {
    add(route) {
      if (route.limit && !config.rates[route.limit]) throw new Error(`unknown rate limit ${route.limit}`)
      router.add(route.method, route.path, route)
    },
    onTouch: hook => { touchHooks.push(hook) },
    onSweep: hook => { sweepHooks.push(hook) },
  }

  api.add({
    method: 'GET', path: '/v1/health', public: true,
    handler: async ctx => json({ ok: (await ctx.db.get<{ ok: number }>('SELECT 1 AS ok'))?.ok === 1 }),
  })
  api.add({
    method: 'GET', path: '/v1/challenge', public: true,
    handler: async ctx => json(await issueChallenge(ctx.db, {
      now: ctx.now, randomBytes: ctx.randomBytes, difficulty: ctx.config.difficulty, addressKey: ctx.addressKey,
    })),
  })
  registerRoutes(api)
  options.register?.(api)

  const spend = (name: string, key: string, at: number) => {
    const wait = limits.take(name, key, at)
    if (wait > 0) throw new HttpError('rate_limited', 'Slow down', 429, { 'Retry-After': String(Math.ceil(wait / 1000)) })
  }

  async function handle(req: Request, ip: string, at: number, seen: { pattern: string }): Promise<Response> {
    if (req.url.length > MAX_URL) throw new HttpError('too_large', 'URL too long', 414)
    const url = new URL(req.url)
    const address = await addressKey(ip, at)
    spend('ip', address, at)

    const match = router.match(req.method, url.pathname)
    if (match.kind === 'none') fail('not_found', 'Not found')
    if (match.kind === 'method') throw new HttpError('not_allowed', 'Method not allowed', 405, { Allow: match.allow.join(', ') })
    seen.pattern = match.pattern
    const route = match.value
    if (url.pathname.startsWith('/v1/') && !UNGATED.has(url.pathname) && tooOld(req.headers.get('x-spinlings-client'), config.minClient)) {
      fail('upgrade_required', 'This Spinlings is too old for the server: claude plugin update spinlings@spinlings')
    }

    let tokenHash: string | null = null
    if (!route.public) {
      const token = bearerToken(req)
      if (!token) fail('unauthorized', 'Unauthorized')
      tokenHash = hashToken(token)
      spend('token', tokenHash, at)
    }
    const body = HAS_BODY.has(req.method) ? await readJson(req) : undefined
    if (route.limit) spend(route.limit, tokenHash ?? address, at)

    const base = {
      req, url, params: match.params, body, db, config, now: at, origin: config.origin ?? url.origin, addressKey: address, randomBytes,
      limit: (name: string, key?: string) => spend(name, key ?? tokenHash ?? address, at),
    }
    const today = utcDay(at)

    const res = await withRetry(async () => {
      if (route.public) return route.handler({ ...base, player: null })
      const signedIn: SessionPlayer = (await findSession(db, tokenHash!)) ?? fail('unauthorized', 'Unauthorized')
      const { session } = signedIn
      let { player } = signedIn
      if (player.last_seen !== today || session.lastUsedDay !== today) {
        // days, not times (SPEC 20.4); no version bump, since nothing guards on them
        await db.batch([
          stmt('UPDATE players SET last_seen = ? WHERE id = ? AND last_seen != ?', today, player.id, today),
          stmt('UPDATE sessions SET last_used_day = ? WHERE id = ?', today, session.id),
        ])
        player = { ...player, last_seen: today }
      }
      const ctxFor = (p: PlayerRow): PlayerCtx => ({ ...base, player: p, sessionId: session.id })
      if (route.touch !== false) for (const hook of touchHooks) player = (await hook(ctxFor(player))) ?? player
      return route.handler(ctxFor(player))
    }, RETRIES)
    if (!(res instanceof Response)) throw new TypeError('handler returned no Response')
    return res
  }

  const app = async (req: Request, client: { ip: string }) => {
    const seen = { pattern: '-' }
    let res: Response
    try {
      res = await handle(req, client.ip, now(), seen)
    } catch (err) {
      if (err instanceof HttpError) res = errorResponse(err.code, err.message, err.status, err.headers)
      else if (err instanceof Conflict) res = errorResponse('conflict', 'Something changed meanwhile, try again')
      else {
        log(`spinlings: ${seen.pattern} failed: ${describe(err)}`)
        res = errorResponse('unavailable', 'Something went wrong', 500)
      }
    }
    res = secure(res)
    if (req.method !== 'HEAD') return res
    await res.body?.cancel()
    return new Response(null, res)
  }

  /** The auth tables' retention, then every route module's own (game/retention.ts and the rest). */
  async function sweep(at = now()) {
    await db.batch([stmt('DELETE FROM challenges WHERE expires_at <= ?', at), pruneJoinCounters(at)])
    for (const hook of sweepHooks) await hook(db, at)
  }

  return Object.assign(app, { sweep })
}

/** An origin as given in config, reduced to scheme://host[:port]. */
function originOf(origin: string): string {
  const u = new URL(origin)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
    throw new Error('ORIGIN must be https (or http://localhost)')
  }
  return u.origin
}

/**
 * True only for a well-formed client version below `min`; a missing or odd header passes. A
 * pre-release sorts before its release, as the mod's own compareSemver has it (client/remote.ts).
 */
export function tooOld(client: string | null, min: string): boolean {
  if (!client || client.length > 48 || !SEMVER_RE.test(client)) return false
  const split = (v: string) => {
    const at = v.indexOf('-')
    return { n: (at < 0 ? v : v.slice(0, at)).split('.').map(Number), pre: at < 0 ? null : v.slice(at + 1) }
  }
  const a = split(client), b = split(min)
  for (let i = 0; i < 3; i++) if (a.n[i]! !== b.n[i]!) return a.n[i]! < b.n[i]!
  if (a.pre === b.pre || a.pre === null) return false
  return b.pre === null || a.pre < b.pre
}

/** The error's name and where it was thrown; never its message, which can carry request data. */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return typeof err
  const frame = err.stack?.split('\n').find(l => l.trim().startsWith('at '))?.trim().slice(3)
  return frame ? `${err.name} at ${frame}` : err.name
}


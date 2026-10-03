// A whole server over an in-memory database with a clock you move, and players who join through the
// real proof of work and call operations by name. Every answer is read with the client's own
// tolerant reader AND must be exactly what it parsed: a field the wire contract does not list fails
// the test (SPEC 20.9). The battles, collection, social and site tests build on this.
import assert from 'node:assert/strict'
import { API_ROUTES, routeOf } from '../../plugin/hooks/core/api.ts'
import type { ApiOp, ApiRequest, ApiResponse, MeResponse } from '../../plugin/hooks/core/api.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { parseResponse } from '../../plugin/hooks/core/schemas.ts'
import { solveProofOfWork } from '../../plugin/hooks/core/sha256.ts'
import type { Family } from '../../plugin/hooks/core/types.ts'
import { createApp } from '../../server/src/app.ts'
import { DAY, HOUR, MINUTE } from '../../server/src/game/ctx.ts'
import type { Api, AppOptions } from '../../server/src/app.ts'
import { hashToken } from '../../server/src/auth.ts'
import type { Db } from '../../server/src/db.ts'
import { openDatabase } from '../../server/src/node.ts'
import type { PlayerRow } from '../../server/src/schema.ts'

export const SECRET = 'scaffold-secret-0123456789abcdef!'
/** 2026-10-02 12:00 UTC: season 1, day 2 */
export const T0 = Date.UTC(2026, 9, 2, 12)
export { DAY, HOUR, MINUTE }
export const CLIENT = '0.1.0'
/** A new player's first pack charge is accepted this long after joining, like any next charge. */
export const FIRST_CHARGE = ECONOMY.packs.chargeSpacingMs

export class ApiFailure extends Error {
  readonly status: number
  readonly code: string
  readonly headers: Headers
  constructor(status: number, code: string, message: string, headers: Headers) {
    super(`${status} ${code}: ${message}`)
    this.status = status
    this.code = code
    this.headers = headers
  }
}

/** Fails unless the client's tolerant reader keeps every field: nothing undocumented, nothing mapped to a fallback. */
export function exact<K extends ApiOp>(op: K, body: unknown): ApiResponse<K> {
  const parsed = parseResponse(op, body)
  assert.deepEqual(parsed, body, `${op} answered fields the wire contract does not list`)
  return parsed as ApiResponse<K>
}

export type RequestOptions = { body?: unknown; token?: string | null; ip?: string; client?: string | null; headers?: Record<string, string> }

export type Player = {
  readonly id: string
  token: string
  readonly me: MeResponse
  /** an operation as this player; throws ApiFailure on an error answer */
  call<K extends ApiOp>(op: K, req?: ApiRequest<K>): Promise<ApiResponse<K>>
  /** the error an operation answers with (fails if it succeeds) */
  fails<K extends ApiOp>(op: K, req?: ApiRequest<K>): Promise<ApiFailure>
  /** the player's row as stored */
  row(): Promise<PlayerRow>
}

export type Server = {
  db: Db
  app: ReturnType<typeof createApp>
  now(): number
  tick(ms: number): void
  set(ms: number): void
  /** a raw request: path, method and options */
  request(method: string, path: string, o?: RequestOptions): Promise<Response>
  /** an operation by name, with an optional token */
  call<K extends ApiOp>(op: K, req?: ApiRequest<K>, token?: string | null, ip?: string): Promise<ApiResponse<K>>
  /** a fresh player through GET /v1/challenge and POST /v1/join; each join comes from its own address */
  join(family?: Family): Promise<Player>
  /** a Player for a token already held (a sign-in, a reset) */
  as(token: string): Promise<Player>
}

export type ServerOptions = {
  now?: number
  difficulty?: number
  origin?: string
  register?: (api: Api) => void
  randomBytes?: AppOptions['randomBytes']
  log?: (message: string) => void
  /** another database than a fresh in-memory node:sqlite one (e.g. local D1); it must be migrated */
  db?: Db
}

let addresses = 0

export function server(o: ServerOptions = {}): Server {
  let now = o.now ?? T0
  const db = o.db ?? openDatabase(':memory:').db
  const app = createApp({
    db, now: () => now, register: o.register, randomBytes: o.randomBytes, log: o.log ?? (() => {}),
    config: { secret: SECRET, difficulty: o.difficulty ?? 4, ...(o.origin ? { origin: o.origin } : {}) },
  })

  const request = (method: string, path: string, r: RequestOptions = {}) => {
    const headers: Record<string, string> = { ...(r.client === null ? {} : { 'x-spinlings-client': r.client ?? CLIENT }), ...r.headers }
    if (r.token) headers.authorization = `Bearer ${r.token}`
    if (r.body !== undefined) headers['content-type'] = 'application/json'
    return app(new Request(`http://localhost:8787${path}`, { method, headers, body: r.body === undefined ? undefined : JSON.stringify(r.body) }), {
      ip: r.ip ?? '192.0.2.1',
    })
  }

  async function call<K extends ApiOp>(op: K, req?: ApiRequest<K>, token?: string | null, ip?: string): Promise<ApiResponse<K>> {
    const { method, path, body } = routeOf(op, (req ?? {}) as ApiRequest<K>)
    const res = await request(method, path, { token: token ?? null, ip, ...(body ? { body } : {}) })
    const json = (await res.json()) as unknown
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } }).error
      throw new ApiFailure(res.status, err?.code ?? '?', err?.message ?? '', res.headers)
    }
    return exact(op, json)
  }

  const as = async (token: string): Promise<Player> => {
    const me = await call('me', {}, token)
    const id = (await db.get<{ player_id: string }>('SELECT player_id FROM sessions WHERE token_hash = ?', hashToken(token)))!.player_id
    const player: Player = {
      id, token, me,
      call: (op, req) => call(op, req, player.token),
      fails: async (op, req) => {
        try {
          await call(op, req, player.token)
        } catch (err) {
          if (err instanceof ApiFailure) return err
          throw err
        }
        return assert.fail(`${op} should have failed`)
      },
      row: async () => (await db.get<PlayerRow>('SELECT * FROM players WHERE id = ?', id))!,
    }
    return player
  }

  return {
    db, app, request, call, as,
    now: () => now,
    tick: ms => { now += ms },
    set: ms => { now = ms },
    async join(family = 'haiku') {
      const ip = `198.51.${(addresses >> 8) & 255}.${addresses++ & 255}`
      const { challenge, difficulty } = await call('challenge', {}, null, ip)
      const nonce = solveProofOfWork(challenge, difficulty)!
      const { token } = await call('join', { challenge, nonce, family }, null, ip)
      return as(token)
    },
  }
}

/** Every API operation's route, for tables of tests. */
export const ROUTES = API_ROUTES

/** Row counts of the given tables. */
export async function counts(db: Db, tables: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of tables) out[t] = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))!.n
  return out
}

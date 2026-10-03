// RemoteBackend: the online world over HTTP, to exactly one server origin (SPEC 12, 28, 32, 33). Every operation goes
// through one door: the request is checked by the strict request schema, sent with X-Spinlings-Client and (only on
// authenticated routes) the bearer token, logged for /spin privacy with the token redacted, raced against a timeout,
// and read tolerantly. Plus the join (proof of work solved in slices, off any hook), the version handshake and the
// per-origin session in $.store.
import type { ApiOp, ApiRequest, ApiResponse, JoinResponse, VersionResponse } from '../core/api.ts'
import { API_ROUTES } from '../core/api.ts'
import type { Family } from '../core/types.ts'
import { RULES_VERSION } from '../core/battle.ts'
import { SchemaError } from '../core/schemas.ts'
import { isOnServer } from '../core/servers.ts'
import { sha256 } from '../core/sha256.ts'
import { GENERATOR_VERSION } from '../core/species.ts'
import { buildRequest, readAnswer, sentEntry } from './net.ts'
import { KEYS, readToken } from './store.ts'
import type { Backend, Fx, HttpAnswer, HttpInit, Sent, Timer } from './types.ts'
import { BackendError } from './types.ts'

/**
 * This mod's version: sent as X-Spinlings-Client and compared with the server's minClient. A release bumps it with
 * plugin.json's `version` (test/e2e/manifest.test.ts holds the two, and the server's LATEST_CLIENT, equal).
 */
export const CLIENT_VERSION = '0.2.0'
/** How a player updates the mod: the one line the band, the pane's version chip and /spin version all give. */
export const UPDATE_COMMAND = 'claude plugin update spinlings@spinlings'
export const TIMEOUT_MS = 15_000

export type RemoteDeps = {
  origin: string
  fetch(url: string, init: HttpInit): Promise<HttpAnswer>
  /** this origin's session token, or null before the join */
  token(): Promise<string | null>
  now(): Promise<number>
  after(ms: number, fn: () => void): Timer
  /** each request as it leaves, token already redacted (the privacy log) */
  sent(entry: Sent): Promise<void> | void
}

export function createRemoteBackend(deps: RemoteDeps): Backend {
  async function send(url: string, init: HttpInit): Promise<HttpAnswer> {
    let timer: Timer | null = null
    const timeout = new Promise<never>((_, reject) => {
      timer = deps.after(TIMEOUT_MS, () => reject(new BackendError('unavailable', 'timeout', 0, 'The server took too long to answer')))
    })
    try {
      return await Promise.race([deps.fetch(url, init), timeout])
    } catch (err) {
      if (err instanceof BackendError) throw err
      throw new BackendError('unavailable', 'network', 0, 'The server could not be reached')
    } finally {
      ;(timer as Timer | null)?.cancel()
    }
  }

  async function call<K extends ApiOp>(op: K, req: ApiRequest<K>): Promise<ApiResponse<K>> {
    const token = API_ROUTES[op].auth ? await deps.token() : null
    let built
    try {
      built = buildRequest(deps.origin, op, req, token, CLIENT_VERSION)
    } catch (err) {
      if (err instanceof SchemaError) throw new BackendError('bad_request', 'refused', 0, `That request is not one the server takes (${err.path})`)
      throw err
    }
    await deps.sent(sentEntry(await deps.now(), built, token))
    const answer = readAnswer(op, await send(built.url, built.init))
    if ((op === 'authStart' || op === 'passkeyStart') && !isOnServer((answer as { url: string }).url, deps.origin)) {
      throw new BackendError('unavailable', 'bad_response', 200, 'The sign-in page is not on this server')
    }
    return answer
  }

  const api: Record<string, unknown> = { call }
  for (const op of Object.keys(API_ROUTES) as ApiOp[]) api[op] = (req: never) => call(op, req)
  return api as unknown as Backend
}

// ---------- the session, per server origin (SPEC 27, 33) ----------

export async function loadToken(store: Fx['store'], origin: string): Promise<string | null> {
  return readToken(await store.get(KEYS.session(origin)))
}

export async function saveToken(store: Fx['store'], origin: string, token: string): Promise<void> {
  await store.set(KEYS.session(origin), token)
}

export async function forgetToken(store: Fx['store'], origin: string): Promise<void> {
  await store.delete(KEYS.session(origin))
}

// ---------- the join (SPEC 30.1): challenge, proof of work, join ----------

/** A sane server asks for 18 bits; above this the mod declines the work and plays offline instead. */
export const POW_MAX_BITS = 20
/** Hashes per slice: a few milliseconds of work between clock callbacks, so the hooks thread is never held. */
export const POW_SLICE = 4096
export const POW_MAX_TRIES = 1 << 23

function leadingZeroBits(bytes: Uint8Array): number {
  let n = 0
  for (const b of bytes) {
    if (b === 0) { n += 8; continue }
    return n + Math.clz32(b) - 24
  }
  return n
}

/**
 * Finds a nonce (a base-36 counter) whose sha256(challenge + ':' + nonce) starts with `difficulty` zero bits, or, in
 * `hex` mode, ceil(difficulty / 4) zero hex digits (SPEC 11's older wording, which every server accepts).
 * `pause` runs between slices; it resolves on a fresh clock callback.
 */
export async function solvePow(challenge: string, difficulty: number, pause: () => Promise<void>, mode: 'bits' | 'hex' = 'bits', maxTries = POW_MAX_TRIES): Promise<string | null> {
  const need = mode === 'hex' ? Math.ceil(difficulty / 4) * 4 : difficulty
  for (let start = 0; start < maxTries; start += POW_SLICE) {
    for (let i = start; i < Math.min(start + POW_SLICE, maxTries); i++) {
      const nonce = i.toString(36)
      if (leadingZeroBits(sha256(challenge + ':' + nonce)) >= need) return nonce
    }
    await pause()
  }
  return null
}

/**
 * Joins anonymously: no name, no email, only the family of the model in use (SPEC 20.2). `pause` runs between slices
 * of the proof of work (one that throws stops it); `wanted` is asked before each request, and once it says no the join
 * stops there, with nothing more sent.
 */
export async function joinServer(backend: Backend, family: Family, pause: () => Promise<void>, wanted: () => boolean = () => true): Promise<JoinResponse> {
  const stop = () => new BackendError('unavailable', 'refused', 0, 'The join was called off')
  for (const mode of ['bits', 'hex'] as const) {
    if (!wanted()) throw stop()
    const { challenge, difficulty } = await backend.challenge({})
    if (difficulty > POW_MAX_BITS) throw new BackendError('unavailable', 'refused', 0, 'The server asks for more work than it should')
    const nonce = await solvePow(challenge, difficulty, pause, mode)
    if (nonce === null) throw new BackendError('unavailable', 'refused', 0, 'Could not finish the join puzzle')
    if (!wanted()) throw stop()
    try {
      return await backend.join({ challenge, nonce, family })
    } catch (err) {
      // a server that still counts whole hex digits refuses a bit-exact proof once; the second round satisfies both
      if (mode === 'bits' && difficulty % 4 !== 0 && err instanceof BackendError && err.code === 'bad_request') continue
      throw err
    }
  }
  throw new BackendError('unavailable', 'refused', 0, 'The server refused the join')
}

// ---------- the version handshake (SPEC 32) ----------

/** -1, 0 or 1; pre-release tags sort before their release. Unreadable versions compare equal. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v)
    return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null
  }
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
  return /^\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(v)
}

export type VersionStatus = {
  /** this mod is older than minClient: online actions are read-only, the offline world keeps working */
  readOnly: boolean
  /** a newer release to announce once, or null */
  update: string | null
  /**
   * the release to update to, or null when this one is current: latestClient, or minClient when a lagging server's
   * latestClient is not above it (read-only with nothing newer named). Never a pre-release.
   */
  target: string | null
  features: string[]
  /** the server simulates battles with this mod's rules: live animation and Perfect timing */
  rulesMatch: boolean
  /** the server's species generator matches this mod's: no frozen season needs fetching */
  generatorMatch: boolean
}

export function versionStatus(v: VersionResponse, client = CLIENT_VERSION): VersionStatus {
  const newer = (x: string) => isRelease(x) && compareSemver(x, client) > 0
  const target = [v.latestClient, v.minClient].filter(newer).reduce<string | null>((best, x) => (best === null || compareSemver(x, best) > 0 ? x : best), null)
  return {
    readOnly: compareSemver(client, v.minClient) < 0,
    update: newer(v.latestClient) ? v.latestClient : null,
    target,
    features: v.features.slice(0, 64),
    rulesMatch: v.rules === RULES_VERSION,
    generatorMatch: v.generator === GENERATOR_VERSION,
  }
}

/** The handshake runs once per UTC day while online. */
export function versionDue(lastDay: string, today: string): boolean {
  return lastDay !== today
}

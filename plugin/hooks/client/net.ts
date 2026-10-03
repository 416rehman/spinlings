// The wire, pure: how one operation becomes one HTTP request to the one configured origin, how an answer is read
// (no redirects, 256 KB cap, JSON only, validated by the shared schemas), and the privacy log of what was sent
// (SPEC 12, 32). remote.ts does the sending through an injected fetch.
import type { ApiErrorCode, ApiOp, ApiRequest, ApiResponse } from '../core/api.ts'
import { API_ROUTES, routeOf } from '../core/api.ts'
import { ECONOMY } from '../core/economy.ts'
import { SchemaError, parseApiError, parsePathParam, parseRequest, parseResponse } from '../core/schemas.ts'
import { normalizeServerUrl } from '../core/servers.ts'
import type { HttpAnswer, HttpInit, Sent } from './types.ts'
import { BackendError } from './types.ts'
import { fit, safe } from './text.ts'

export const RESPONSE_MAX_BYTES = ECONOMY.client.responseMaxBytes
export const PRIVACY_MAX = ECONOMY.client.privacyLog

/** A server address reduced to its origin, or null when it may not be used (https only; http for localhost). */
export function serverOrigin(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length <= 200 ? normalizeServerUrl(raw) : null
}

export function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, '')
}

export type Built = { url: string; init: HttpInit; method: string; path: string; body: string }

/**
 * One operation as a request. The request is checked with the same strict schema the server uses, so the mod never
 * sends a field the documented shape lacks (SPEC 20.9), and every path and query parameter is format-checked before
 * it is encoded. Throws SchemaError for a bad request.
 */
export function buildRequest<K extends ApiOp>(origin: string, op: K, req: ApiRequest<K>, token: string | null, client: string): Built {
  const route = API_ROUTES[op]
  const fields = req as Record<string, unknown>
  for (const m of route.path.matchAll(/:([A-Za-z]+)/g)) parsePathParam(m[1]!, String(fields[m[1]!] ?? ''))
  for (const name of route.query ?? []) if (fields[name] !== undefined) parsePathParam(name, String(fields[name]))
  const { method, path, body } = routeOf(op, req)
  const checked = parseRequest(op, body ?? undefined)
  const headers: Record<string, string> = { accept: 'application/json', 'x-spinlings-client': client }
  if (route.auth) {
    if (!token) throw new BackendError('unauthorized', 'unauthorized', 0, 'Not signed in on this server')
    headers.authorization = 'Bearer ' + token
  }
  if (body === null) return { url: origin + path, init: { method, headers }, method, path, body: '' }
  const text = JSON.stringify(checked ?? {})
  headers['content-type'] = 'application/json'
  return { url: origin + path, init: { method, headers, body: text }, method, path, body: text }
}

function byteLength(text: string): number {
  if (text.length > RESPONSE_MAX_BYTES || text.length * 3 <= RESPONSE_MAX_BYTES) return text.length
  return new TextEncoder().encode(text).length
}

const fail = (code: ApiErrorCode, kind: BackendError['kind'], status: number, message: string) => new BackendError(code, kind, status, message)

/** Reads one answer: redirects refused, bodies over the cap rejected unparsed, everything else validated tolerantly. */
export function readAnswer<K extends ApiOp>(op: K, res: HttpAnswer): ApiResponse<K> {
  const status = typeof res.status === 'number' ? res.status : 0
  if (status >= 300 && status < 400) throw fail('unavailable', 'redirect', status, 'The server tried to send us somewhere else')
  const text = typeof res.text === 'string' ? res.text : ''
  const headers = res.headers ?? {}
  const declared = Number(headers['content-length'])
  if ((Number.isFinite(declared) && declared > RESPONSE_MAX_BYTES) || byteLength(text) > RESPONSE_MAX_BYTES) {
    throw fail('unavailable', 'too_large', status, 'The server sent more than we accept')
  }
  let json: unknown
  let parsed = false
  if (/^application\/json(\s*;|$)/i.test((headers['content-type'] ?? '').trim())) {
    try {
      json = JSON.parse(text)
      parsed = true
    } catch {
      parsed = false
    }
  }
  if (status < 200 || status >= 300) {
    let code: ApiErrorCode = status === 401 ? 'unauthorized' : status === 426 ? 'upgrade_required' : status === 429 ? 'rate_limited' : 'unavailable'
    let message = `The server answered ${status}`
    if (parsed) {
      try {
        const err = parseApiError(json).error
        code = err.code
        message = safe(err.message, 120) || message
      } catch {
        // an error body we cannot read keeps the generic code and message
      }
    }
    throw fail(code, status === 401 ? 'unauthorized' : 'refused', status, message)
  }
  if (!parsed) throw fail('unavailable', 'bad_response', status, 'The server did not answer in JSON')
  try {
    return parseResponse(op, json) as ApiResponse<K>
  } catch (err) {
    throw fail('unavailable', 'bad_response', status, err instanceof SchemaError ? `Unexpected answer at ${safe(err.path, 60)}` : 'Unexpected answer')
  }
}

// ---------- privacy log (SPEC 12: the last 20 request paths and bodies, the token redacted) ----------

/**
 * Removes the token, and anything token-shaped, from text about to be logged: the sign-in poll's id too, since it
 * collects a session once (SPEC 29) and the log is kept and shown.
 */
export function redact(text: string, token: string | null): string {
  let out = token && token.length >= 8 ? text.split(token).join('[token]') : text
  out = out.replace(/("token"\s*:\s*")[^"]*(")/g, '$1[token]$2').replace(/Bearer\s+[A-Za-z0-9_-]+/g, 'Bearer [token]')
  return out.replace(/(\/v1\/auth\/poll\/)[^/?#\s]+/g, '$1[id]')
}

export function sentEntry(at: number, built: Pick<Built, 'method' | 'path' | 'body'>, token: string | null): Sent {
  return { at, method: built.method, path: fit(redact(built.path, token), 200), body: fit(redact(built.body, token), 400) }
}

export function pushSent(log: readonly Sent[], entry: Sent): Sent[] {
  return [...log, entry].slice(-PRIVACY_MAX)
}

/** The log as kept in the store, checked field by field (the store is shared and could hold anything). */
export function parseSent(v: unknown): Sent[] {
  if (!Array.isArray(v)) return []
  const out: Sent[] = []
  for (const e of v.slice(-PRIVACY_MAX)) {
    if (typeof e !== 'object' || e === null) continue
    const r = e as Record<string, unknown>
    if (typeof r.at !== 'number' || typeof r.method !== 'string' || typeof r.path !== 'string' || typeof r.body !== 'string') continue
    out.push({ at: r.at, method: safe(r.method, 8), path: safe(r.path, 200), body: safe(r.body, 400) })
  }
  return out
}

/** A share link on the server: a card `/c/`, a gift `/g/`, a profile `/u/`. */
export function pageUrl(origin: string, kind: 'c' | 'g' | 'u', id: string): string {
  return `${origin}/${kind}/${encodeURIComponent(id)}`
}

/** A URL as a Link may carry it: printable ASCII exactly as the URL parser spells it, or null (the engine refuses the rest). */
export function linkHref(url: string): string | null {
  try {
    const href = new URL(url).href
    return href.length <= 2048 && /^[\x21-\x7e]+$/.test(href) ? href : null
  } catch {
    return null
  }
}

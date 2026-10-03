// HTTP plumbing: a tiny router, JSON / HTML / PNG responses with the SPEC 12 headers, ApiError
// bodies, and a JSON body reader that refuses anything over 16 KB before parsing it.
import type { ApiError } from '../../plugin/hooks/core/api.ts'

export type ErrorCode = ApiError['error']['code']
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_allowed: 403,
  not_found: 404,
  conflict: 409,
  insufficient_sparks: 409,
  expired: 410,
  too_large: 413,
  cap_reached: 429,
  rate_limited: 429,
  unavailable: 503,
  upgrade_required: 426,
}

export class HttpError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly headers: Record<string, string>
  constructor(code: ErrorCode, message: string, status = STATUS[code], headers: Record<string, string> = {}) {
    super(message)
    this.name = 'HttpError'
    this.code = code
    this.status = status
    this.headers = headers
  }
}

export function fail(code: ErrorCode, message: string): never {
  throw new HttpError(code, message)
}

// Pages carry no scripts, forms or frames. API responses get the same headers and no CORS.
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
}

/** Returns the response with every security header it lacks, and any CORS header removed. */
export function secure(res: Response): Response {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v)
  for (const k of [...out.headers.keys()]) if (k.startsWith('access-control-')) out.headers.delete(k)
  return out
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })
}

export function errorResponse(code: ErrorCode, message: string, status = STATUS[code], headers: Record<string, string> = {}): Response {
  const body: ApiError = { error: { code, message } }
  return json(body, status, headers)
}

/** Pages default to no-store: a gift page's URL is itself the secret. */
export function html(body: string, status = 200, cache = 'no-store'): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache } })
}

export function png(bytes: Uint8Array, cache = 'public, max-age=3600'): Response {
  return new Response(bytes as BodyInit, { headers: { 'Content-Type': 'image/png', 'Cache-Control': cache } })
}

const HTML_SPECIAL = /[&<>"']/g
const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** HTML-escapes text and attribute values. */
export const escapeHtml = (s: string) => String(s).replace(HTML_SPECIAL, c => ENTITY[c]!)

// ---- Body --------------------------------------------------------------------------------------

export const BODY_LIMIT = 16 * 1024

/** Reads a JSON body: application/json only, at most `limit` bytes (checked before parsing), valid UTF-8. */
export async function readJson(req: Request, limit = BODY_LIMIT): Promise<unknown> {
  if (!/^application\/json\s*(;|$)/i.test(req.headers.get('content-type') ?? '')) {
    fail('bad_request', 'Expected an application/json body')
  }
  const declared = req.headers.get('content-length')
  if (declared !== null && !(Number(declared) <= limit)) fail('too_large', 'Body too large')
  const bytes = await readCapped(req, limit)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail('bad_request', 'Body is not valid UTF-8')
  }
  try {
    return JSON.parse(text)
  } catch {
    fail('bad_request', 'Body is not valid JSON')
  }
}

async function readCapped(req: Request, limit: number): Promise<Uint8Array> {
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      reader.cancel().catch(() => {})
      fail('too_large', 'Body too large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

// ---- Router ------------------------------------------------------------------------------------

type Compiled<T> = { method: Method; pattern: string; segments: string[]; shape: string; rank: string; value: T }

export type Match<T> =
  | { kind: 'found'; value: T; params: Record<string, string>; pattern: string }
  | { kind: 'method'; allow: string[] }
  | { kind: 'none' }

const PARAM = /^:[a-z][A-Za-z0-9]*$/
const LITERAL = /^[A-Za-z0-9._~-]+$/

/** Method + path patterns such as `/v1/battles/:id/finish`. Literal segments outrank params. */
export function createRouter<T>() {
  const routes: Compiled<T>[] = []
  return {
    add(method: Method, pattern: string, value: T): void {
      const segments = pattern === '/' ? [''] : pattern.split('/').slice(1)
      if (!pattern.startsWith('/') || (pattern !== '/' && segments.some(s => !PARAM.test(s) && !LITERAL.test(s)))) {
        throw new Error(`bad route pattern ${pattern}`)
      }
      const names = segments.filter(s => s.startsWith(':'))
      if (new Set(names).size !== names.length) throw new Error(`duplicate param in ${pattern}`)
      const shape = segments.map(s => (s.startsWith(':') ? ':' : s)).join('/')
      if (routes.some(r => r.method === method && r.shape === shape)) throw new Error(`duplicate route ${method} ${pattern}`)
      const rank = segments.map(s => (s.startsWith(':') ? '1' : '0')).join('')
      routes.push({ method, pattern, segments, shape, rank, value })
    },

    match(method: string, pathname: string): Match<T> {
      const parts = pathname.split('/').slice(1)
      let best: { route: Compiled<T>; params: Record<string, string> } | null = null
      const allow = new Set<string>()
      for (const route of routes) {
        if (route.segments.length !== parts.length) continue
        const params: Record<string, string> = {}
        let ok = true
        for (let i = 0; i < parts.length && ok; i++) {
          const seg = route.segments[i]!
          if (seg.startsWith(':')) {
            if (parts[i] === '') ok = false
            else params[seg.slice(1)] = decodeSegment(parts[i]!)
          } else ok = seg === parts[i]
        }
        if (!ok) continue
        const wanted = method === 'HEAD' ? 'GET' : method
        if (route.method !== wanted) {
          allow.add(route.method)
          if (route.method === 'GET') allow.add('HEAD')
          continue
        }
        if (!best || route.rank < best.route.rank) best = { route, params }
      }
      if (best) return { kind: 'found', value: best.route.value, params: best.params, pattern: best.route.pattern }
      return allow.size ? { kind: 'method', allow: [...allow].sort() } : { kind: 'none' }
    },
  }
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    fail('bad_request', 'Malformed path')
  }
}

// Cloudflare entry: a plain stateless module Worker over D1 (binding DB). Every isolate runs the
// same app; D1 batches keep handlers atomic (SPEC 16). Nothing about a request is ever logged.
import { createApp } from './app.ts'
import type { App } from './app.ts'
import type { D1Database, EdgeCache, ExecutionContext, ScheduledController } from './cloudflare.d.ts'
import { d1Db } from './db.ts'
import { errorResponse, secure } from './http.ts'
import { ENTRY_RE } from './pages-meet.ts'

type Env = {
  DB: D1Database
  /** `wrangler secret put SECRET`: the HMAC key for address keys */
  SECRET?: string
  POW_DIFFICULTY?: string
  /**
   * The one origin this server answers as (SPEC 31, 33): every link and the passkey rp.id. Required,
   * so the host a request happens to arrive on never becomes a second origin.
   */
  ORIGIN?: string
}

const apps = new WeakMap<object, App>()

function appFor(env: Env): App | null {
  let app = apps.get(env.DB)
  if (app) return app
  if (!env.SECRET || env.SECRET.length < 32 || !env.ORIGIN) return null
  const difficulty = Number(env.POW_DIFFICULTY)
  try {
    app = createApp({
      db: d1Db(env.DB),
      config: { secret: env.SECRET, origin: env.ORIGIN, ...(env.POW_DIFFICULTY && Number.isInteger(difficulty) ? { difficulty } : {}) },
    })
  } catch {
    return null // an ORIGIN that is not https
  }
  apps.set(env.DB, app)
  return app
}

/** The share images (SPEC 9): the landing's meadow and every postcard. */
const SHARE_PNG = /^\/(?:og\/meadow(?:-\d{8})?|w\/[a-z0-9-]+)\.png$/

/** A cached response's browser TTL can be rewritten by the zone; keep the share route's policy. */
const shareCacheControl = (path: string) => path === '/og/meadow.png' ? 'public, max-age=3600' : 'public, max-age=86400'

/**
 * Share images are public, the same bytes for whoever asks, and costly to draw, so the Worker keeps
 * each 200 in the zone's cache by path and pin (their own Cache-Control says how long) and answers
 * repeats from there without running the app. Every other request, and any other answer, passes
 * straight through, as does everything when the cache is missing or fails.
 */
export async function viaEdgeCache(req: Request, cache: EdgeCache | undefined, ctx: Pick<ExecutionContext, 'waitUntil'>, answer: () => Promise<Response>): Promise<Response> {
  const url = new URL(req.url)
  if (!cache || req.method !== 'GET' || !SHARE_PNG.test(url.pathname)) return answer()
  // a postcard's pin (?e=, pages.ts) picks its creature; nothing else in the query changes the picture
  const e = url.searchParams.get('e') ?? ''
  const key = new Request(url.origin + url.pathname + (url.pathname.startsWith('/w/') && ENTRY_RE.test(e) ? `?e=${e}` : ''))
  const hit = await cache.match(key).catch(() => undefined)
  if (hit) {
    if (hit.status !== 200 || hit.headers.get('content-type') !== 'image/png') return hit
    const res = new Response(hit.body, hit)
    res.headers.set('Cache-Control', shareCacheControl(url.pathname))
    return res
  }
  const res = await answer()
  if (res.status === 200 && res.headers.get('content-type') === 'image/png') ctx.waitUntil(cache.put(key, res.clone()).catch(() => {}))
  return res
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = appFor(env)
    if (!app) {
      console.error('spinlings: SECRET (32+ characters) and an https ORIGIN must both be set')
      return secure(errorResponse('unavailable', 'This server is not set up yet', 503))
    }
    const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default
    // Cloudflare sets CF-Connecting-IP itself; the app turns it into a daily keyed hash at once.
    return viaEdgeCache(request, cache, ctx, () => app(request, { ip: request.headers.get('cf-connecting-ip') ?? '' }))
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const app = appFor(env)
    if (app) ctx.waitUntil(app.sweep())
  },
}

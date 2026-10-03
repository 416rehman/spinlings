// Cloudflare entry: a plain stateless module Worker over D1 (binding DB). Every isolate runs the
// same app; D1 batches keep handlers atomic (SPEC 16). Nothing about a request is ever logged.
import { createApp } from './app.ts'
import type { App } from './app.ts'
import type { D1Database, ExecutionContext, ScheduledController } from './cloudflare.d.ts'
import { d1Db } from './db.ts'
import { errorResponse, secure } from './http.ts'

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = appFor(env)
    if (!app) {
      console.error('spinlings: SECRET (32+ characters) and an https ORIGIN must both be set')
      return secure(errorResponse('unavailable', 'This server is not set up yet', 503))
    }
    // Cloudflare sets CF-Connecting-IP itself; the app turns it into a daily keyed hash at once.
    return app(request, { ip: request.headers.get('cf-connecting-ip') ?? '' })
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const app = appFor(env)
    if (app) ctx.waitUntil(app.sweep())
  },
}

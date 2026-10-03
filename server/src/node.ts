// Self-hosting entry: the same app over node:http and node:sqlite, with server/migrations applied at
// start. Importing this file only exports openDatabase and serve (the e2e tests boot the server
// in-process with them); running it starts the server.
//   SPINLINGS_DB    database file (default server/data/spinlings.db; ':memory:' for a throwaway)
//   SECRET          HMAC key for address keys, 32+ characters (outside production a random one is
//                   made per run, with a warning)
//   PORT            listen port (default 8787; 0 picks a free one)
//   HOST            listen address (default 127.0.0.1; set 0.0.0.0 to expose it)
//   PUBLIC_URL      origin the server is reached at (default http://localhost:PORT); request URLs
//                   are built from it, never from the Host header. It is also the passkey rp.id, so
//                   it must be https (or http://localhost). ORIGIN (SPEC 33) is read too.
//   TRUST_PROXY     how many reverse proxies sit in front (default 0); the client address is then
//                   read from X-Forwarded-For instead of the socket
//   POW_DIFFICULTY  join proof-of-work bits (default 18)
import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import type { App } from './app.ts'
import { migrateSqlite, nodeDb } from './db.ts'
import type { Db, Migration } from './db.ts'
import { BODY_LIMIT, errorResponse, secure } from './http.ts'

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir).filter(n => n.endsWith('.sql')).sort().map(name => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}

/** Opens (creating if needed) a SQLite database and applies any migrations it lacks. */
export function openDatabase(file: string): { sqlite: DatabaseSync; db: Db } {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const sqlite = new DatabaseSync(file)
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000')
  migrateSqlite(sqlite, loadMigrations())
  return { sqlite, db: nodeDb(sqlite) }
}

const HOUR = 3_600_000
const self = fileURLToPath(import.meta.url)
const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
if (process.argv[1] && same(resolve(process.argv[1]), self)) start()

function start() {
  const env = process.env
  const port = env.PORT ? Number(env.PORT) : 8787
  const host = env.HOST || '127.0.0.1'
  const trustProxy = env.TRUST_PROXY === 'true' ? 1 : Math.max(0, Math.floor(Number(env.TRUST_PROXY) || 0))
  const difficulty = Number(env.POW_DIFFICULTY)
  const file = env.SPINLINGS_DB || fileURLToPath(new URL('../data/spinlings.db', import.meta.url))
  const configured = env.PUBLIC_URL || env.ORIGIN
  const origin = configured ? new URL(configured).origin : null
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be 0-65535')

  let secret = env.SECRET ?? ''
  if (secret.length < 32) {
    if (env.NODE_ENV === 'production') throw new Error('SECRET must be set to 32 or more characters')
    secret = randomBytes(32).toString('hex')
    console.warn('spinlings: SECRET is not set, so this run uses a random one (join limits restart with the server)')
  }

  const { sqlite, db } = openDatabase(file)
  const app = createApp({
    db,
    config: {
      secret,
      ...(origin ? { origin } : {}),
      ...(env.POW_DIFFICULTY && Number.isInteger(difficulty) ? { difficulty } : {}),
    },
  })
  const sweep = () => app.sweep().catch(err => console.error(`spinlings: sweep failed: ${err instanceof Error ? err.name : typeof err}`))
  void sweep()
  setInterval(sweep, HOUR).unref()

  void serve({ app, port, host, trustProxy, origin }).then(served => {
    console.log(`spinlings listening on http://${host}:${served.port} (${file === ':memory:' ? 'in-memory database' : 'database ready'})`)
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        void served.close().finally(() => {
          sqlite.close()
          process.exit(0)
        })
      })
    }
  })
}

export type ServeOptions = {
  app: App
  /** 0 picks a free port */
  port?: number
  host?: string
  /** reverse proxies in front: the client address is then read from X-Forwarded-For */
  trustProxy?: number
  /** the origin request URLs are built from, never the Host header; default http://localhost:{port} */
  origin?: string | null
}

export type Served = { server: Server; port: number; origin: string; close(): Promise<void> }

/** Serves an app over node:http: the body cap before parsing, request timeouts, and only error names logged. */
export function serve(o: ServeOptions): Promise<Served> {
  const { app } = o
  const trustProxy = o.trustProxy ?? 0
  let publicUrl = ''

  const clientIp = (req: IncomingMessage) => {
    const socket = req.socket.remoteAddress ?? ''
    if (!trustProxy) return socket
    const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map(s => s.trim()).filter(Boolean)
    return chain[chain.length - trustProxy] ?? socket
  }

  /** The body, or null once it passes `limit` (reading stops there). */
  const readBody = (req: IncomingMessage, limit: number) => new Promise<Buffer | null>((done, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= limit) return void chunks.push(chunk)
      req.removeAllListeners('data')
      req.pause()
      done(null)
    })
    req.on('end', () => done(Buffer.concat(chunks)))
    req.on('close', () => done(null)) // a no-op after 'end'
    req.on('error', reject)
  })

  const send = async (out: ServerResponse, res: Response, close = false) => {
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => { headers[key] = value })
    if (close) headers.connection = 'close'
    const body = res.body ? Buffer.from(await res.arrayBuffer()) : undefined
    out.writeHead(res.status, headers)
    out.end(body)
  }

  const handle = async (req: IncomingMessage, out: ServerResponse) => {
    const method = req.method ?? 'GET'
    const path = req.url ?? ''
    if (!path.startsWith('/')) return send(out, secure(errorResponse('bad_request', 'Bad request')), true)
    // Room for the app to answer "too large" itself, but never more than that in memory.
    const cap = BODY_LIMIT + 1
    if (Number(req.headers['content-length'] ?? 0) > cap) return send(out, secure(errorResponse('too_large', 'Body too large')), true)
    let body: Buffer | null = null
    if (method !== 'GET' && method !== 'HEAD') {
      body = await readBody(req, cap)
      if (!body) return send(out, secure(errorResponse('too_large', 'Body too large')), true)
    }
    let request: Request
    try {
      const headers = new Headers()
      for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!)
      request = new Request(publicUrl + path, { method, headers, body: body && new Uint8Array(body) })
    } catch {
      return send(out, secure(errorResponse('bad_request', 'Bad request')), true)
    }
    await send(out, await app(request, { ip: clientIp(req) }))
  }

  const server = createServer((req, out) => {
    handle(req, out).catch(err => {
      console.error(`spinlings: request failed: ${err instanceof Error ? err.name : typeof err}`)
      if (!out.headersSent) out.writeHead(500, { 'content-type': 'application/json; charset=utf-8', connection: 'close' })
      out.end()
    })
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000

  return new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(o.port ?? 8787, o.host ?? '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : (o.port ?? 8787)
      publicUrl = o.origin ? new URL(o.origin).origin : `http://localhost:${port}`
      const close = () => new Promise<void>(closed => {
        server.close(() => closed())
        server.closeAllConnections()
      })
      done({ server, port, origin: publicUrl, close })
    })
  })
}

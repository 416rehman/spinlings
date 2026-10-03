// The async Db every handler runs on (SPEC 16): Cloudflare D1 in production, node:sqlite when
// self-hosting and in tests. D1 has no interactive transactions, so a handler reads, decides, then
// writes one atomic batch that starts with guards for everything it assumed. A failed guard (or a
// lost race on a unique key) rolls the whole batch back and surfaces as Conflict; withRetry re-runs
// the handler from its reads. Bound parameters only. Platform-free: no node: or cloudflare: imports.
import type { D1Database } from './cloudflare.d.ts'

export type SqlValue = string | number | null
/** booleans bind as 1 / 0 */
export type SqlParam = SqlValue | boolean
export type Row = Record<string, SqlValue>
export type Stmt = { readonly sql: string; readonly params: readonly SqlValue[] }

export type Db = {
  all<T = Row>(sql: string, ...params: SqlParam[]): Promise<T[]>
  get<T = Row>(sql: string, ...params: SqlParam[]): Promise<T | undefined>
  /** Atomic: every statement commits, or none do. Results are per statement, in order. */
  batch(stmts: readonly Stmt[]): Promise<{ changes: number }[]>
}

/** Someone else changed what this handler read: re-run it from its reads. */
export class Conflict extends Error {
  constructor(message = 'conflict') {
    super(message)
    this.name = 'Conflict'
  }
}

function bind(params: readonly SqlParam[]): SqlValue[] {
  return params.map(p => {
    if (typeof p === 'boolean') return p ? 1 : 0
    if (p === null || typeof p === 'string' || (typeof p === 'number' && Number.isFinite(p))) return p
    throw new TypeError(`unsupported SQL parameter of type ${typeof p}`)
  })
}

export const stmt = (sql: string, ...params: SqlParam[]): Stmt => ({ sql, params: bind(params) })

/**
 * A statement that aborts its batch unless `condition` is 1, e.g.
 * `guard('SELECT 1 FROM cards WHERE id = ? AND owner_id = ? AND version = ?', id, me, v)`.
 * No row (NULL) breaks _guard's NOT NULL and 0 breaks its CHECK, so the batch rolls back.
 * `condition` is SQL written in code, never input; values go in `params`.
 */
export const guard = (condition: string, ...params: SqlParam[]): Stmt =>
  stmt(`INSERT INTO _guard (ok) VALUES ((${condition}))`, ...params)

const CLEAR_GUARDS: Stmt = { sql: 'DELETE FROM _guard', params: [] }

const GUARD_FAILED = /_guard\.ok|guard_ok/
const UNIQUE_FAILED = /UNIQUE constraint failed|PRIMARY KEY constraint failed/

/** Guard failures and unique-key races are conflicts; anything else is a real error. */
export function asConflict(err: unknown): unknown {
  const text = (e: unknown) => (e instanceof Error ? e.message : String(e))
  const message = `${text(err)} ${err instanceof Error && err.cause !== undefined ? text(err.cause) : ''}`
  return GUARD_FAILED.test(message) || UNIQUE_FAILED.test(message) ? new Conflict() : err
}

/**
 * Runs fn, and on Conflict runs it again from the top, up to `retries` more times; the last
 * Conflict propagates (the app answers 409 conflict). fn must do its reads inside.
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof Conflict) || attempt >= retries) throw err
    }
  }
}

// ---- Cloudflare D1 ------------------------------------------------------------------------------

export function d1Db(d1: D1Database): Db {
  const prepare = (sql: string, params: readonly SqlValue[]) => d1.prepare(sql).bind(...params)
  return {
    async all<T>(sql: string, ...params: SqlParam[]) {
      return (await prepare(sql, bind(params)).all<T>()).results
    },
    async get<T>(sql: string, ...params: SqlParam[]) {
      return (await prepare(sql, bind(params)).first<T>()) ?? undefined
    },
    async batch(stmts) {
      if (!stmts.length) return []
      try {
        const results = await d1.batch([...stmts, CLEAR_GUARDS].map(s => prepare(s.sql, s.params)))
        return results.slice(0, -1).map(r => ({ changes: r.meta.changes }))
      } catch (err) {
        throw asConflict(err)
      }
    },
  }
}

// ---- node:sqlite DatabaseSync -------------------------------------------------------------------

type Statement = {
  all(...params: SqlValue[]): unknown[]
  get(...params: SqlValue[]): unknown
  run(...params: SqlValue[]): { changes: number | bigint }
}
/** The slice of node:sqlite's DatabaseSync used here, so this file never imports node:sqlite. */
export type SqliteDatabase = { prepare(sql: string): Statement; exec(sql: string): void }

const STATEMENT_CACHE = 256
// node:sqlite rows have a null prototype; D1 rows are plain objects.
const plain = <T>(row: unknown) => ({ ...(row as object) }) as T

/**
 * DatabaseSync is synchronous, so a batch runs start to finish without yielding: nothing else in
 * this process interleaves, and BEGIN IMMEDIATE (with a busy_timeout) serializes other processes.
 */
export function nodeDb(sqlite: SqliteDatabase): Db {
  const cache = new Map<string, Statement>()
  const prepare = (sql: string) => {
    let s = cache.get(sql)
    if (!s) {
      s = sqlite.prepare(sql)
      if (cache.size >= STATEMENT_CACHE) cache.delete(cache.keys().next().value!)
      cache.set(sql, s)
    }
    return s
  }
  return {
    async all<T>(sql: string, ...params: SqlParam[]) {
      return prepare(sql).all(...bind(params)).map(r => plain<T>(r))
    },
    async get<T>(sql: string, ...params: SqlParam[]) {
      const row = prepare(sql).get(...bind(params))
      return row === undefined ? undefined : plain<T>(row)
    },
    async batch(stmts) {
      if (!stmts.length) return []
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const out = [...stmts, CLEAR_GUARDS].map(s => ({ changes: Number(prepare(s.sql).run(...s.params).changes) }))
        sqlite.exec('COMMIT')
        return out.slice(0, -1)
      } catch (err) {
        try { sqlite.exec('ROLLBACK') } catch { /* the original error matters more */ }
        throw asConflict(err)
      }
    },
  }
}

// ---- Migrations ---------------------------------------------------------------------------------

export type Migration = { name: string; sql: string }

const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/

/**
 * Applies `server/migrations/NNNN_name.sql` files that are not yet recorded, in name order, each in
 * its own transaction. Records them in d1_migrations exactly as `wrangler d1 migrations apply`
 * does, so a database migrated by either one is up to date for the other.
 * Returns the names it applied.
 */
export function migrateSqlite(sqlite: SqliteDatabase, migrations: readonly Migration[]): string[] {
  for (const m of migrations) if (!MIGRATION_NAME.test(m.name)) throw new Error(`bad migration name ${m.name}`)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS "d1_migrations"(
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`)
  const applied = new Set(sqlite.prepare('SELECT name FROM d1_migrations').all().map(r => (r as { name: string }).name))
  const done: string[] = []
  for (const m of [...migrations].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (applied.has(m.name)) continue
    sqlite.exec('BEGIN IMMEDIATE')
    try {
      sqlite.exec(m.sql)
      sqlite.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(m.name)
      sqlite.exec('COMMIT')
    } catch (err) {
      try { sqlite.exec('ROLLBACK') } catch { /* the original error matters more */ }
      throw err
    }
    done.push(m.name)
  }
  return done
}

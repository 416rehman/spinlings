// Cloudflare D1 as the Worker sees it, run locally by wrangler's workerd (the real D1 engine, in
// memory), with every migration applied the way `wrangler d1 migrations apply` splits it. The D1
// suites share this; each one is skipped, with the reason, when wrangler cannot start here.
import { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { D1Database } from '../../server/src/cloudflare.d.ts'
import { d1Db } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { loadMigrations } from '../../server/src/node.ts'

export type LocalD1 = {
  /** the app's Db over it */
  db: Db
  /** the raw binding, for SQL exactly as wrangler runs it */
  d1: D1Database
  /** wrangler's own statement splitter */
  split(sql: string): string[]
}

const config = fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url))

/** A fresh, migrated local D1, disposed when the test file ends; `{ skip }` when wrangler cannot start. */
export async function localD1(): Promise<LocalD1 | { skip: string }> {
  try {
    process.env.WRANGLER_SEND_METRICS = 'false'
    const { getPlatformProxy, unstable_splitSqlQuery } = await import('wrangler')
    const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: config, persist: false })
    after(() => proxy.dispose())
    const d1 = proxy.env.DB
    for (const m of loadMigrations()) await d1.batch(unstable_splitSqlQuery(m.sql).map(s => d1.prepare(s)))
    return { db: d1Db(d1), d1, split: unstable_splitSqlQuery }
  } catch (err) {
    return { skip: `wrangler could not start local D1: ${err instanceof Error ? err.message : String(err)}` }
  }
}

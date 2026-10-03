// The Db contract and the app over Cloudflare D1, run locally by wrangler's workerd (the real D1
// engine, in memory). Skipped only when wrangler cannot start here.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { loadMigrations } from '../../server/src/node.ts'
import { localD1 } from './d1-helpers.ts'
import { dbSuite, T0, testApp } from './infra-helpers.ts'

const local = await localD1()

if ('skip' in local) {
  describe('Db over local D1', () => { it('runs', { skip: local.skip }, () => {}) })
} else {
  const db: Db = local.db
  dbSuite('local D1', async () => db)

  describe('app over local D1', () => {
    it('serves health and hands out a challenge', async () => {
      const { app } = testApp({ db })
      const health = await app(new Request('http://x/v1/health'), { ip: '192.0.2.1' })
      assert.deepEqual(await health.json(), { ok: true })
      const res = await app(new Request('http://x/v1/challenge'), { ip: '192.0.2.1' })
      assert.equal(res.status, 200)
      const { challenge } = (await res.json()) as { challenge: string }
      assert.equal((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM challenges WHERE id = ?', challenge))!.n, 1)
    })

    it('runs the retention sweep', async () => {
      const { app } = testApp({ db, now: () => T0 })
      const hour = Math.floor(T0 / 3_600_000)
      await db.batch([
        stmt(`INSERT INTO challenges (id, difficulty, expires_at) VALUES ('d1-old', 18, ?), ('d1-live', 18, ?)`, T0 - 1, T0 + 60_000),
        stmt(`INSERT INTO join_counters (key, hour, joins) VALUES ('d1-old', ?, 1), ('d1-live', ?, 1)`, hour - 25, hour - 23),
      ])
      await app.sweep()
      const keys = async (sql: string) => (await db.all<{ k: string }>(sql)).map(r => r.k)
      assert.deepEqual(await keys(`SELECT id AS k FROM challenges WHERE id LIKE 'd1-%' ORDER BY 1`), ['d1-live'])
      assert.deepEqual(await keys(`SELECT key AS k FROM join_counters WHERE key LIKE 'd1-%' ORDER BY 1`), ['d1-live'])
    })
  })

  describe('migration files', () => {
    it('split into statements the way wrangler applies them', () => {
      for (const m of loadMigrations()) assert.equal(local.split(m.sql).length, (m.sql.match(/;\s*$/gm) ?? []).length, m.name)
    })
  })
}

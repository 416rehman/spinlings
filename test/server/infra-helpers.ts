// Shared by the infra tests: a migrated in-memory database, a test app, and the Db contract suite
// that every adapter (node:sqlite here, local D1 in infra-d1) must pass.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApp } from '../../server/src/app.ts'
import type { AppOptions } from '../../server/src/app.ts'
import { Conflict, guard, stmt, withRetry } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { openDatabase } from '../../server/src/node.ts'

export { T0 } from './scaffold-helpers.ts'
export const SECRET = '0123456789abcdef0123456789abcdef'
export const realRandom = (n: number) => crypto.getRandomValues(new Uint8Array(n))

export const freshDb = () => openDatabase(':memory:').db

export function testApp(extra: Partial<Omit<AppOptions, 'config'>> & { config?: Partial<AppOptions['config']> } = {}) {
  const db = extra.db ?? freshDb()
  const app = createApp({ ...extra, db, config: { secret: SECRET, ...extra.config } })
  return { db, app }
}

/** A player row with one session, written directly. */
export async function addPlayer(db: Db, id: string, tokenHash: string, over: Record<string, string | number> = {}) {
  const row: Record<string, string | number> = {
    id, handle: `soft-otter-${id}`, joined: '2026-10-01', last_seen: '2026-10-01', season: 1, ...over,
  }
  const cols = Object.keys(row)
  await db.batch([
    stmt(`INSERT INTO players (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...Object.values(row)),
    stmt(`INSERT INTO sessions (id, player_id, token_hash, created_day, last_used_day) VALUES (?, ?, ?, '2026-10-01', '2026-10-01')`, `s-${id}`, id, tokenHash),
  ])
}

export const conflicted = async (p: Promise<unknown>) => {
  await assert.rejects(p, (err: unknown) => err instanceof Conflict)
}

let tables = 0

/** The Db contract. `open` must return a migrated database (it needs _guard); tests make their own tables. */
export function dbSuite(name: string, open: () => Promise<Db>) {
  describe(`Db over ${name}`, () => {
    const fresh = async () => {
      const db = await open()
      const t = `t${++tables}`
      await db.batch([stmt(`CREATE TABLE ${t} (id TEXT PRIMARY KEY, n INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0) STRICT`)])
      const ids = async () => (await db.all<{ id: string }>(`SELECT id FROM ${t} ORDER BY id`)).map(r => r.id)
      const n = async (id: string) => (await db.get<{ n: number }>(`SELECT n FROM ${t} WHERE id = ?`, id))?.n
      return { db, t, ids, n }
    }

    it('reads, writes and reports changes per statement', async () => {
      const { db, t, ids, n } = await fresh()
      const out = await db.batch([
        stmt(`INSERT INTO ${t} (id, n) VALUES (?, ?), (?, ?)`, 'a', 1, 'b', 2),
        stmt(`UPDATE ${t} SET n = n + 1 WHERE id = ?`, 'zzz'),
        stmt(`UPDATE ${t} SET n = n + 1`),
      ])
      assert.deepEqual(out.map(r => r.changes), [2, 0, 2])
      assert.equal(await n('b'), 3)
      assert.equal(await db.get(`SELECT n FROM ${t} WHERE id = ?`, 'nope'), undefined)
      assert.deepEqual(await ids(), ['a', 'b'])
      assert.deepEqual(await db.all(`SELECT id, n FROM ${t} WHERE id = ?`, 'a'), [{ id: 'a', n: 2 }])
      assert.deepEqual(await db.batch([]), [])
    })

    it('binds booleans as 1 and 0 and refuses other values', async () => {
      const { db } = await fresh()
      const row = (await db.get<{ t: number; f: number }>('SELECT ? AS t, ? AS f', true, false))!
      assert.deepEqual([row.t, row.f], [1, 0])
      await assert.rejects(db.get('SELECT ?', undefined as never), TypeError)
      await assert.rejects(db.get('SELECT ?', NaN), TypeError)
      assert.throws(() => stmt('SELECT ?', {} as never), TypeError)
    })

    it('treats bound strings as data, never SQL', async () => {
      const { db, t, ids } = await fresh()
      await db.batch([stmt(`INSERT INTO ${t} (id, n) VALUES (?, 1)`, `x'); DROP TABLE ${t}; --`)])
      assert.deepEqual(await ids(), [`x'); DROP TABLE ${t}; --`])
    })

    it('a passing guard lets the batch commit, and _guard is empty afterwards', async () => {
      const { db, t, n } = await fresh()
      await db.batch([stmt(`INSERT INTO ${t} (id, n) VALUES ('a', 1)`)])
      await db.batch([
        guard(`SELECT 1 FROM ${t} WHERE id = ? AND version = ?`, 'a', 0),
        stmt(`UPDATE ${t} SET n = 5, version = version + 1 WHERE id = ?`, 'a'),
      ])
      assert.equal(await n('a'), 5)
      assert.equal((await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM _guard'))!.c, 0)
    })

    it('a failing guard leaves no writes at all, before or after it', async () => {
      const { db, t, ids, n } = await fresh()
      await db.batch([stmt(`INSERT INTO ${t} (id, n) VALUES ('keep', 0)`)])
      for (const condition of [`SELECT 1 FROM ${t} WHERE id = 'missing'`, `SELECT n = 99 FROM ${t} WHERE id = 'keep'`]) {
        await conflicted(db.batch([
          stmt(`INSERT INTO ${t} (id, n) VALUES ('before', 1)`),
          stmt(`UPDATE ${t} SET n = 7 WHERE id = 'keep'`),
          guard(condition),
          stmt(`INSERT INTO ${t} (id, n) VALUES ('after', 1)`),
        ]))
      }
      assert.deepEqual(await ids(), ['keep'])
      assert.equal(await n('keep'), 0)
      assert.equal((await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM _guard'))!.c, 0)
    })

    it('a guard sees the writes earlier in its own batch', async () => {
      const { db, t } = await fresh()
      await conflicted(db.batch([
        stmt(`INSERT INTO ${t} (id, n) VALUES ('a', 1)`),
        guard(`SELECT n > 1 FROM ${t} WHERE id = 'a'`),
      ]))
      await db.batch([stmt(`INSERT INTO ${t} (id, n) VALUES ('a', 2)`), guard(`SELECT n > 1 FROM ${t} WHERE id = 'a'`)])
    })

    it('reports a lost race on a unique key as a Conflict, and other errors as themselves', async () => {
      const { db, t, ids } = await fresh()
      await db.batch([stmt(`INSERT INTO ${t} (id, n) VALUES ('a', 1)`)])
      await conflicted(db.batch([stmt(`INSERT INTO ${t} (id, n) VALUES ('b', 1)`), stmt(`INSERT INTO ${t} (id, n) VALUES ('a', 2)`)]))
      await assert.rejects(
        db.batch([stmt(`INSERT INTO ${t} (id, n) VALUES ('c', 1)`), stmt(`INSERT INTO ${t} (id, n) VALUES ('d', NULL)`)]),
        (err: unknown) => !(err instanceof Conflict) && /NOT NULL/.test(String(err)),
      )
      await assert.rejects(db.batch([stmt('NOT SQL')]), (err: unknown) => !(err instanceof Conflict))
      assert.deepEqual(await ids(), ['a'])
    })

    it('runs DELETE ... RETURNING to completion through get', async () => {
      const { db, t, ids } = await fresh()
      await db.batch([stmt(`INSERT INTO ${t} (id, n) VALUES ('a', 1), ('b', 1)`)])
      assert.ok((await db.get<{ id: string }>(`DELETE FROM ${t} WHERE n = 1 RETURNING id`))?.id)
      assert.deepEqual(await ids(), [])
    })

    it('withRetry: concurrent read-guard-write handlers never lose an update', async () => {
      const { db, t, n } = await fresh()
      await db.batch([stmt(`INSERT INTO ${t} (id, n) VALUES ('c', 0)`)])
      let attempts = 0
      const bump = () => withRetry(async () => {
        attempts++
        const row = (await db.get<{ n: number; version: number }>(`SELECT n, version FROM ${t} WHERE id = 'c'`))!
        await new Promise(r => setTimeout(r, 1)) // let the other writers read the same version
        await db.batch([
          guard(`SELECT 1 FROM ${t} WHERE id = 'c' AND version = ?`, row.version),
          stmt(`UPDATE ${t} SET n = ?, version = version + 1 WHERE id = 'c'`, row.n + 1),
        ])
        return row.n + 1
      }, 3)
      const results = await Promise.allSettled([bump(), bump(), bump()])
      const won = results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<number>).value)
      assert.deepEqual(won.sort(), [1, 2, 3])
      assert.equal(await n('c'), 3)
      assert.ok(attempts > 3, `conflicts were retried (${attempts} attempts)`)
    })

    it('withRetry gives up after its retries and passes other errors straight through', async () => {
      let runs = 0
      await conflicted(withRetry(async () => { runs++; throw new Conflict() }, 3))
      assert.equal(runs, 4)
      runs = 0
      await assert.rejects(withRetry(async () => { runs++; throw new RangeError('no') }, 3), RangeError)
      assert.equal(runs, 1)
    })
  })
}

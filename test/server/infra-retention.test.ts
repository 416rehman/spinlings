// SPEC 20.4: the hourly sweep deletes what the server must not keep, and nothing it must.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { T0, testApp } from './infra-helpers.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const day = (offset: number) => new Date(T0 + offset * DAY).toISOString().slice(0, 10)

async function seed(db: Db) {
  const battle = (id: string, state: string, startedAt: number, settled: string | null) => stmt(
    `INSERT INTO battles (id, attacker_id, kind, state, setup, opponent, started_at, settled) VALUES (?, 'p', 'wild', ?, '{}', '{}', ?, ?)`,
    id, state, startedAt, settled,
  )
  const offer = (id: string, state: string, resolved: string | null) => stmt(
    `INSERT INTO offers (id, from_id, to_id, from_handle, to_handle, give, get, state, created, expires_at, resolved)
     VALUES (?, 'p', 'q', 'soft-otter-1', 'shy-wren-2', '[]', '[]', ?, ?, 0, ?)`,
    id, state, day(-40), resolved,
  )
  const gift = (code: string, state: string, resolved: string | null) => stmt(
    `INSERT INTO gifts (code, giver_id, card_id, state, created, expires, resolved) VALUES (?, 'p', 'c', ?, ?, ?, ?)`,
    code, state, day(-40), day(-26), resolved,
  )
  await db.batch([
    stmt('INSERT INTO challenges (id, difficulty, expires_at) VALUES (?, 18, ?), (?, 18, ?)', 'old', T0 - 1, 'live', T0 + 60_000),
    stmt('INSERT INTO join_counters (key, hour, joins) VALUES (?, ?, 1), (?, ?, 1)', 'old', T0 / HOUR - 25, 'live', T0 / HOUR - 23),
    stmt('INSERT INTO trader_uses (player_id, day, deal) VALUES (?, ?, 0), (?, ?, 0)', 'p', day(-1), 'p', day(0)),
    stmt('INSERT INTO retired_handles (handle, until) VALUES (?, ?), (?, ?)', 'old-fox-1', day(0), 'live-fox-2', day(1)),
    stmt(`INSERT INTO notices (id, player_id, day, kind, text) VALUES (?, 'p', ?, 'defense-win', 'x'), (?, 'p', ?, 'defense-win', 'x')`,
      'old', day(-31), 'live', day(-29)),
    offer('old', 'declined', day(-31)), offer('live', 'accepted', day(-29)), offer('open', 'open', null),
    gift('old', 'claimed', day(-31)), gift('live', 'returned', day(-29)), gift('open', 'open', null),
    battle('old', 'settled', T0 - 9 * DAY, day(-8)), battle('live', 'settled', T0 - 7 * DAY, day(-6)),
    battle('lost', 'open', T0 - 8 * DAY, null), battle('open', 'open', T0 - HOUR, null),
  ])
}

describe('retention sweep', () => {
  it('deletes expired and aged rows and keeps the rest', async () => {
    const seen: number[] = []
    const { db, app } = testApp({ now: () => T0, register: api => api.onSweep(async (_db, now) => { seen.push(now) }) })
    await seed(db)
    await app.sweep()
    const keys = async (table: string, key: string) => (await db.all<Record<string, string>>(`SELECT ${key} AS k FROM ${table} ORDER BY 1`)).map(r => r.k)
    assert.deepEqual(await keys('challenges', 'id'), ['live'])
    assert.deepEqual(await keys('join_counters', 'key'), ['live'])
    assert.deepEqual(await keys('trader_uses', 'day'), [day(0)])
    assert.deepEqual(await keys('retired_handles', 'handle'), ['live-fox-2'])
    assert.deepEqual(await keys('notices', 'id'), ['live'])
    assert.deepEqual(await keys('offers', 'id'), ['live', 'open'])
    assert.deepEqual(await keys('gifts', 'code'), ['live', 'open'])
    assert.deepEqual(await keys('battles', 'id'), ['live', 'open'])
    assert.deepEqual(seen, [T0])
  })

  it('is safe to run on an empty database and twice in a row', async () => {
    const { db, app } = testApp({ now: () => T0 })
    await app.sweep()
    await db.batch([
      stmt('INSERT INTO challenges (id, difficulty, expires_at) VALUES (?, 18, ?)', 'old', T0 - 1),
      stmt('INSERT INTO join_counters (key, hour, joins) VALUES (?, ?, 1)', 'old', T0 / HOUR - 25),
    ])
    await app.sweep()
    await app.sweep(T0 + DAY)
    const left = await db.get<{ c: number; j: number }>('SELECT (SELECT COUNT(*) FROM challenges) AS c, (SELECT COUNT(*) FROM join_counters) AS j')
    assert.deepEqual(left, { c: 0, j: 0 })
  })
})

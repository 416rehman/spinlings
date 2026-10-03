// The Db contract over node:sqlite, the migrations runner, and the schema's own constraints.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { asConflict, Conflict, migrateSqlite, nodeDb, stmt } from '../../server/src/db.ts'
import { loadMigrations } from '../../server/src/node.ts'
import { addPlayer, dbSuite, freshDb } from './infra-helpers.ts'

dbSuite('node:sqlite', async () => freshDb())

describe('migrations', () => {
  const names = (sqlite: DatabaseSync) =>
    sqlite.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(r => (r as { name: string }).name)

  it('apply every file once and record it the way wrangler does', () => {
    const sqlite = new DatabaseSync(':memory:')
    const files = loadMigrations()
    assert.ok(files.some(f => f.name === '0001_init.sql'))
    assert.deepEqual(migrateSqlite(sqlite, files), files.map(f => f.name))
    assert.deepEqual(migrateSqlite(sqlite, files), [])
    assert.deepEqual(names(sqlite), files.map(f => f.name))
    const columns = sqlite.prepare('PRAGMA table_info(d1_migrations)').all().map(r => (r as { name: string }).name)
    assert.deepEqual(columns, ['id', 'name', 'applied_at'])
  })

  it('pick up where wrangler left off', () => {
    const sqlite = new DatabaseSync(':memory:')
    const [init] = loadMigrations()
    migrateSqlite(sqlite, [init!])
    const next = { name: '0002_more.sql', sql: 'CREATE TABLE more (x INTEGER) STRICT;' }
    assert.deepEqual(migrateSqlite(sqlite, [next, init!]), ['0002_more.sql'])
    assert.deepEqual(names(sqlite), ['0001_init.sql', '0002_more.sql'])
  })

  it('apply a failing file not at all', () => {
    const sqlite = new DatabaseSync(':memory:')
    migrateSqlite(sqlite, loadMigrations())
    const broken = { name: '9999_broken.sql', sql: 'CREATE TABLE extra (x INTEGER) STRICT; NOT SQL;' }
    assert.throws(() => migrateSqlite(sqlite, [broken]))
    assert.equal(sqlite.prepare(`SELECT name FROM sqlite_master WHERE name = 'extra'`).get(), undefined)
    assert.deepEqual(names(sqlite), loadMigrations().map(f => f.name))
  })

  it('refuse names wrangler would not order the same way', () => {
    assert.throws(() => migrateSqlite(new DatabaseSync(':memory:'), [{ name: '1_x.sql', sql: '' }]), /bad migration name/)
  })

  it('carry no transaction statements, which D1 refuses', () => {
    for (const f of loadMigrations()) assert.doesNotMatch(f.sql, /\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i, f.name)
  })
})

describe('schema', () => {
  const tables = async () => (await freshDb().all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map(r => r.name)

  it('has every table and the lookup indexes', async () => {
    const all = await tables()
    for (const t of [
      '_guard', 'players', 'cards', 'album', 'wishes', 'fusions', 'packs', 'battles', 'offers', 'gifts', 'notices',
      'firsts', 'mythics', 'trader_uses', 'retired_handles', 'challenges', 'join_counters', 'd1_migrations',
      'sessions', 'passkeys', 'auth_polls', 'drops', 'redemptions', 'seasons',
    ]) assert.ok(all.includes(t), `missing table ${t}`)
    const indexes = (await freshDb().all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index'`)).map(r => r.name)
    for (const i of ['players_match', 'players_board', 'cards_for_trade', 'cards_market', 'wishes_species', 'gifts_open', 'battles_open', 'join_counters_hour']) {
      assert.ok(indexes.includes(i), `missing index ${i}`)
    }
  })

  it('uses the matchmaking index', async () => {
    const plan = await freshDb().all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT id FROM players WHERE team_size > 0 AND rating BETWEEN ? AND ? AND last_seen >= ?`, 850, 1150, '2026-09-18',
    )
    assert.match(plan.map(p => p.detail).join(' '), /players_match/)
  })

  it('walks only listed cards for the trade board, never the whole cards table', async () => {
    const plan = await freshDb().all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT c.* FROM cards c JOIN players p ON p.id = c.owner_id
       WHERE c.id >= ? AND c.for_trade = 1 AND c.state = 'owned' AND c.bound = 0 AND c.locked_until <= ? AND c.owner_id != ? AND p.last_seen >= ?
       ORDER BY c.id LIMIT 80`, 'a', 0, 'me', '2026-09-18',
    )
    assert.match(plan.map(p => p.detail).join(' '), /cards_market/)
  })

  it('stores no address, agent, email or timestamp of activity for a player', async () => {
    const db = freshDb()
    const columns = (await db.all<{ name: string; type: string }>('SELECT name, type FROM pragma_table_info(?)', 'players')).map(c => c.name)
    for (const banned of [/(^|_)ip(_|$)/, /addr/, /agent/, /mail/, /(^|_)tz(_|$)|timezone/, /created_at/]) {
      assert.equal(columns.some(c => banned.test(c)), false, `players has a column like ${banned}`)
    }
    const typeOf = async (table: string, column: string) =>
      (await db.get<{ type: string }>('SELECT type FROM pragma_table_info(?) WHERE name = ?', table, column))?.type
    assert.equal(await typeOf('players', 'last_seen'), 'TEXT')
    assert.equal(await typeOf('players', 'joined'), 'TEXT')
  })

  it('enforces types and checks', async () => {
    const db = freshDb()
    await addPlayer(db, 'p1', 'h1')
    const card = (over: Record<string, string | number>) => {
      const c = { id: 'c1', family: 'opus', rarity: 'rare', state: 'owned', dna: 7, level: 1, ...over }
      return db.batch([stmt(
        `INSERT INTO cards (id, owner_id, species, season, family, rarity, dna, genes, traits, level, origin, minted, state)
         VALUES (?, 'p1', 's1-opus-0', 1, ?, ?, ?, '[1,2,3,4]', '["sturdy"]', ?, 'pack', '2026-10-02', ?)`,
        c.id, c.family, c.rarity, c.dna, c.level, c.state,
      )])
    }
    await card({})
    await assert.rejects(card({ id: 'c2', family: 'dragon' }), /CHECK/)
    await assert.rejects(card({ id: 'c3', state: 'lost' }), /CHECK/)
    await assert.rejects(card({ id: 'c4', dna: 2 ** 32 }), /CHECK/)
    await assert.rejects(card({ id: 'c5', dna: 'x' }), /INTEGER|datatype/i)
    await assert.rejects(card({ id: 'c6', level: 11 }), /CHECK/)
    await assert.rejects(db.batch([stmt(`UPDATE players SET sparks = -1 WHERE id = 'p1'`)]), /CHECK/)
    await assert.rejects(addPlayer(db, 'p2', 'h1'), (err: unknown) => err instanceof Conflict) // token hashes are unique
  })
})

describe('asConflict', () => {
  it('maps guard and unique failures, including D1-shaped ones, and nothing else', () => {
    const d1 = (m: string) => new Error(`D1_ERROR: ${m}`, { cause: new Error(m) })
    assert.ok(asConflict(d1('NOT NULL constraint failed: _guard.ok: SQLITE_CONSTRAINT')) instanceof Conflict)
    assert.ok(asConflict(d1('CHECK constraint failed: guard_ok: SQLITE_CONSTRAINT')) instanceof Conflict)
    assert.ok(asConflict(d1('UNIQUE constraint failed: players.handle: SQLITE_CONSTRAINT')) instanceof Conflict)
    const other = d1('CHECK constraint failed: sparks >= 0')
    assert.equal(asConflict(other), other)
  })

  it('leaves the node:sqlite connection usable after a failed batch', async () => {
    const sqlite = new DatabaseSync(':memory:')
    migrateSqlite(sqlite, loadMigrations())
    const db = nodeDb(sqlite)
    await assert.rejects(db.batch([stmt('NOT SQL')]))
    await db.batch([stmt(`INSERT INTO retired_handles (handle, until) VALUES ('a', '2026-11-01')`)])
    assert.equal((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM retired_handles'))!.n, 1)
  })
})

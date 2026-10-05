import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { NAMED_MYTHICS, namedMythic } from '../../plugin/hooks/core/named-mythics.ts'
import { migrateSqlite } from '../../server/src/db.ts'
import { loadMigrations, openDatabase } from '../../server/src/node.ts'
import { forceMythics, namedEncounterLoss, namedEncounterRace } from './named-mythics-helpers.ts'
import { server, T0 } from './scaffold-helpers.ts'

describe('named Mythics', () => {
  it('changes only the embedded names of an ordinary Mythic roll', () => {
    const card = toBattleCard({ ...generateMythic({ seed: 'one-ordinary-roll', dna: 42, now: T0, level: 7, shiny: true }), id: 'wild-0' })
    const before = structuredClone(card)
    for (const entry of NAMED_MYTHICS) {
      const named = namedMythic(card, entry)
      assert.deepEqual(named.form!.names, [entry.name, entry.name, entry.name])
      assert.deepEqual({ ...named, form: { ...named.form, names: before.form!.names } }, before)
    }
    assert.deepEqual(card, before)
    assert.throws(() => namedMythic({ ...card, species: 'promo' }, NAMED_MYTHICS[0]), TypeError)
  })

  it('adds only an owner-free reservation table to an already released database', () => {
    const sqlite = new DatabaseSync(':memory:'), files = loadMigrations()
    const old = files.filter(f => f.name < '0004_')
    migrateSqlite(sqlite, old)
    const schema = () => sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT IN ('d1_migrations', 'named_mythic_encounters') ORDER BY name").all()
    const before = schema()
    assert.deepEqual(migrateSqlite(sqlite, files), ['0004_named_mythic_encounters.sql'])
    assert.deepEqual(schema(), before)
    assert.deepEqual(sqlite.prepare('PRAGMA table_info(named_mythic_encounters)').all().map(r => r.name), ['id'])
    assert.deepEqual(migrateSqlite(sqlite, files), [])
    sqlite.close()
  })

  it('the gentle first encounter and opened packs never spend named Mythics, even at forced wild Mythic odds', async () => {
    await forceMythics(async () => {
      const s = server(), p = await s.join()
      assert.notEqual((await p.call('startBattle', { kind: 'wild', family: 'haiku' })).setup.defender[0]!.species, 'mythic')
      for (const pack of p.me.packs) {
        const opened = await p.call('openPack', { packId: pack.id })
        assert.ok(opened.cards.every(c => c.species !== 'mythic'))
      }
      assert.deepEqual(await s.db.all('SELECT * FROM named_mythic_encounters'), [])
    })
  })

  it('reserves four simultaneous encounters atomically, keeps catches and never refunds abandoned or deleted ones', { timeout: 30_000 },
    () => namedEncounterRace(openDatabase(':memory:').db))
  it('a lost encounter consumes its name permanently', () => namedEncounterLoss(openDatabase(':memory:').db))
})

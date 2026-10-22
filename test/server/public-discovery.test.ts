import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { mintCard, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import type { Card, NewCard } from '../../plugin/hooks/core/types.ts'
import { migrateSqlite, nodeDb, stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { mintCards, publicCard } from '../../server/src/game/mint.ts'
import { HttpError, wireJson } from '../../server/src/http.ts'
import { loadMigrations } from '../../server/src/node.ts'
import { discoveryCredits, PUBLIC_MYTHICS_PAGE, publicMythics, speciesCredit } from '../../server/src/public-collection.ts'
import { localD1 } from './d1-helpers.ts'
import { addPlayer } from './infra-helpers.ts'
import { server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'
import { assertNoIds, assertPublic } from './social-helpers.ts'

const handle = (p: Player) => p.me.player.handle
async function give(s: Server, p: Player, cards: readonly NewCard[]) {
  const minted = await mintCards({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }, p.id, cards)
  await s.db.batch(minted.stmts)
  return minted.cards
}
async function newSpecies(s: Server, p: Player): Promise<Card> {
  const taken = new Set((await s.db.all<{ species: string }>('SELECT species FROM firsts')).map(r => r.species))
  const species = seasonSpecies(1).find(x => !x.legendary && !taken.has(x.id))!
  return (await give(s, p, [mintCard({ species, rarity: 'common', shiny: false, dna: 23, origin: 'pack', now: s.now() })]))[0]!
}
const mythic = (s: Server, seed: string) => generateMythic({ seed, dna: 9, now: s.now(), origin: 'catch' })

describe('website discovery credit', () => {
  it('credits species discovery on every copy, independently of its first stamp or current owner', async () => {
    const s = server(), f = await s.join(), o = await s.join()
    const first = await newSpecies(s, f)
    assert.equal(first.firstFind, true)
    assert.deepEqual(await s.db.get('SELECT player_id, handle FROM firsts WHERE species = ?', first.species), { player_id: f.id, handle: handle(f) })
    const { id: _, ...copy } = first
    const second = (await give(s, o, [copy]))[0]!
    assert.equal(second.firstFind, undefined)
    await s.db.batch([stmt('UPDATE cards SET owner_id = ? WHERE id = ?', o.id, first.id)])
    const credits = await discoveryCredits(s.db, [first, second])
    assert.deepEqual([...credits.values()], [{ kind: 'species', handle: handle(f) }, { kind: 'species', handle: handle(f) }])
    assert.deepEqual(await speciesCredit(s.db, first.species), { handle: handle(f) })
    await s.db.batch([stmt('DELETE FROM cards WHERE id = ?', first.id)])
    assert.deepEqual(await speciesCredit(s.db, second.species), { handle: handle(f) }, 'the original physical card need not survive')
    await f.call('setLeaderboard', { optIn: false })
    assert.deepEqual(await speciesCredit(s.db, second.species), { handle: handle(f) }, 'board visibility hides stats, not discovery stamps')
  })

  it('distinguishes an unseen species from an anonymous find and rejects invented embedded attribution', async () => {
    const s = server(), f = await s.join()
    const found = new Set((await s.db.all<{ species: string }>('SELECT species FROM firsts')).map(r => r.species))
    const missing = seasonSpecies(1).find(x => !found.has(x.id))!
    assert.equal(await speciesCredit(s.db, missing.id), null)
    assert.equal(await speciesCredit(s.db, 'mythic'), null)
    const first = await newSpecies(s, f)
    await s.db.batch([stmt(`UPDATE firsts SET handle = 'stale-moth-42' WHERE species = ?`, first.species)])
    assert.deepEqual(await speciesCredit(s.db, first.species), { handle: null })
    const ghost = toBattleCard({ ...mythic(s, 'unclaimed-shape'), id: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' })
    ghost.form = { ...ghost.form!, discoveredBy: 'invented-finder-42' }
    const credits = await discoveryCredits(s.db, [first, ghost])
    assert.deepEqual(credits.get(first.id), { handle: null, kind: 'species' })
    assert.equal(credits.has(ghost.id), false)
    assert.ok(!JSON.stringify([...credits]).includes('invented-finder-42'))
  })

  it('unlinks earlier finds on rename, correctly credits same-day later finds, and erases credit on deletion', async () => {
    const s = server(), f = await s.join(), other = await s.join()
    const first = await newSpecies(s, f)
    const old = handle(f), { handle: renamed } = await f.call('rerollHandle', {})
    assert.notEqual(old, renamed)
    assert.deepEqual(await speciesCredit(s.db, first.species), { handle: null })
    assert.deepEqual(await s.db.get('SELECT handle FROM firsts WHERE species = ?', first.species), { handle: null })
    const later = await newSpecies(s, f)
    assert.deepEqual(await speciesCredit(s.db, later.species), { handle: renamed }, 'a new find under the new handle is exact even on the rename day')
    await s.db.batch([stmt('UPDATE cards SET owner_id = ? WHERE id = ?', other.id, later.id)])
    await f.call('deleteMe')
    assert.deepEqual(await speciesCredit(s.db, later.species), { handle: null })
    assert.deepEqual(await s.db.get('SELECT player_id, handle FROM firsts WHERE species = ?', later.species), { player_id: null, handle: null })
    const after = [...await discoveryCredits(s.db, [first, later])]
    assert.ok(!JSON.stringify(after).includes(old) && !JSON.stringify(after).includes(renamed))
  })

  it('batch-loads credit with bounded parameter lists and never serializes player ids or discovery dates', async () => {
    const s = server(), f = await s.join()
    const cards = (await f.call('cards')).cards
    let reads = 0, max = 0
    const db: Db = {
      all: async (sql, ...params) => { reads++; max = Math.max(max, params.length); return s.db.all(sql, ...params) },
      get: async () => assert.fail('credit batching does not read per-card'), batch: async () => assert.fail('credit reads never write'),
    }
    const many = Array.from({ length: 200 }, (_, i) => ({ ...cards[i % cards.length]!, id: `copy-${i}` }))
    const out = await discoveryCredits(db, many)
    assert.equal(out.size, 200); assert.equal(reads, 1); assert.ok(max <= 90)
    assertNoIds([...out], [f.id], 'discovery credit')
    assert.ok(!JSON.stringify([...out]).includes('2026-10-'))
  })
})

describe('the caught Mythic catalogue', () => {
  it('shows real caught art, separates finder from holder, and retains safe historical records when the card disappears', async () => {
    const s = server(), f = await s.join(), o = await s.join()
    const [caught] = await give(s, f, [mythic(s, 'public-mythic')])
    await s.db.batch([
      stmt('UPDATE cards SET owner_id = ? WHERE id = ?', o.id, caught!.id),
      stmt(`UPDATE cards SET form = json_set(form, '$.discoveredBy', 'invented-finder-42') WHERE id = ?`, caught!.id),
      stmt(`INSERT INTO named_mythic_encounters (id) VALUES ('unused-roster-reservation')`),
    ])
    const out = await publicMythics(s.db, s.now())
    assert.equal(out.total, 1); assert.equal(out.mythics.length, 1)
    assert.equal(out.mythics[0]!.name, caught!.form!.names[2]); assert.equal(out.mythics[0]!.handle, handle(f))
    assert.equal(out.mythics[0]!.card!.id, caught!.id)
    assert.equal(out.mythics[0]!.card!.form!.discoveredBy, handle(f))
    assertPublic(JSON.parse(wireJson(out.mythics[0]!.card)), 'Mythic catalogue')
    assertNoIds(out, [f.id, o.id], 'Mythic catalogue')
    assert.ok(!wireJson(out).includes('invented-finder-42') && !wireJson(out).includes('unused-roster-reservation'))
    assert.deepEqual((await discoveryCredits(s.db, [caught!])).get(caught!.id), { kind: 'mythic', handle: handle(f) })
    await s.db.batch([stmt('DELETE FROM cards WHERE id = ?', caught!.id)])
    const gone = await publicMythics(s.db, s.now())
    assert.deepEqual(gone.mythics, [{ name: caught!.form!.names[2], handle: handle(f), card: null }])
    await f.call('rerollHandle', {})
    assert.deepEqual((await publicMythics(s.db, s.now())).mythics, [{ name: caught!.form!.names[2], handle: null, card: null }])
    await f.call('deleteMe')
    assert.equal((await publicMythics(s.db, s.now())).mythics[0]!.handle, null)
  })

  it('pages alphabetically without day cursors or leaking unclaimed/future records', async () => {
    const s = server(), f = await s.join()
    const cards = await give(s, f, Array.from({ length: 53 }, (_, i) => {
      const base = mythic(s, `catalogue-mythic-${i}`)
      const name = `Lantern ${String.fromCharCode(65 + i % 13)}moss`
      return { ...base, form: { ...base.form!, names: [name, name, name] as [string, string, string] } }
    }))
    const expected = [...cards].sort((a, b) => a.form!.names[2].localeCompare(b.form!.names[2]) || a.id.localeCompare(b.id))
    const seen: string[] = []
    let after: string | undefined
    do {
      const out = await publicMythics(s.db, s.now(), after ? { after } : {})
      assert.equal(out.total, 53); assert.ok(out.mythics.length <= PUBLIC_MYTHICS_PAGE)
      assert.deepEqual(Object.keys(out).sort(), ['mythics', ...(out.next ? ['next'] : []), 'total'].sort())
      for (const entry of out.mythics) assert.deepEqual(Object.keys(entry).sort(), ['card', 'handle', 'name'])
      seen.push(...out.mythics.map(x => x.card!.id)); after = out.next
    } while (after)
    assert.deepEqual(seen, expected.map(c => c.id)); assert.equal(new Set(seen).size, 53)
    const [future] = await give(s, f, [mythic(s, 'future-row')])
    await s.db.batch([stmt(`UPDATE mythics SET day = '2099-01-01' WHERE card_id = ?`, future!.id)])
    assert.equal((await publicMythics(s.db, s.now())).total, 53)
    await assert.rejects(publicMythics(s.db, s.now(), { after: 'eA' }), HttpError)
    await assert.rejects(publicMythics(s.db, s.now(), new URLSearchParams('after=x&after=y')), HttpError)
    await assert.rejects(publicMythics(s.db, s.now(), new URLSearchParams('finder=anything')), HttpError)
  })
})

async function rollbackWrites(db: Db) {
  // Statements emitted by the previous Worker, which does not know firsts.handle exists.
  await addPlayer(db, 'rollback-finder', 'unused-test-session-hash', { handle: 'quiet-moss-42' })
  await db.batch([stmt(`INSERT INTO firsts (species, season, player_id, card_id, day) VALUES ('s1-haiku-0', 1, 'rollback-finder', 'old-worker-card', '2026-10-02')`)])
  assert.deepEqual(await speciesCredit(db, 's1-haiku-0'), { handle: 'quiet-moss-42' })
  await db.batch([stmt(`UPDATE players SET handle = 'bright-moss-42' WHERE id = 'rollback-finder'`)])
  assert.deepEqual(await db.get(`SELECT handle FROM firsts WHERE species = 's1-haiku-0'`), { handle: null })
  await db.batch([stmt(`UPDATE players SET handle = 'quiet-moss-42' WHERE id = 'rollback-finder'`)])
  assert.deepEqual(await speciesCredit(db, 's1-haiku-0'), { handle: null }, 'returning to an earlier handle cannot revive erased credit')
  await db.batch([stmt(`INSERT INTO firsts (species, season, player_id, card_id, day) VALUES ('s1-haiku-1', 1, 'rollback-finder', 'old-worker-second-card', '2026-10-02')`)])
  assert.deepEqual(await speciesCredit(db, 's1-haiku-1'), { handle: 'quiet-moss-42' })
  await db.batch([stmt(`UPDATE firsts SET player_id = NULL WHERE player_id = 'rollback-finder'`), stmt(`DELETE FROM players WHERE id = 'rollback-finder'`)])
  assert.deepEqual(await db.all(`SELECT player_id, handle FROM firsts ORDER BY species`), [{ player_id: null, handle: null }, { player_id: null, handle: null }])
}

describe('discovery-handle migration', () => {
  it('backfills only unambiguous historical handles and preserves the old row/column contract', async () => {
    const sqlite = new DatabaseSync(':memory:'), files = loadMigrations(), old = files.filter(f => f.name < '0005_')
    migrateSqlite(sqlite, old)
    const db = nodeDb(sqlite)
    const cases = [
      ['never-renamed', '', '2026-10-02', 'quiet-moss-10'],
      ['renamed-before', '2026-10-01', '2026-10-02', 'quiet-moss-11'],
      ['renamed-same-day', '2026-10-02', '2026-10-02', null],
      ['renamed-after', '2026-10-03', '2026-10-02', null],
    ] as const
    for (const [i, [id, rename, day]] of cases.entries()) {
      await addPlayer(db, id, `unused-test-${i}`, { handle: `quiet-moss-${10 + i}`, handle_day: rename })
      await db.batch([stmt('INSERT INTO firsts (species, season, player_id, card_id, day) VALUES (?, 1, ?, ?, ?)', `s1-haiku-${i}`, id, `old-card-${i}`, day)])
    }
    const before = await db.all('SELECT species, season, player_id, card_id, day FROM firsts ORDER BY species')
    assert.deepEqual(migrateSqlite(sqlite, files), ['0005_discovery_handles.sql'])
    assert.deepEqual(await db.all('SELECT species, season, player_id, card_id, day FROM firsts ORDER BY species'), before)
    for (const [i, [, , , expected]] of cases.entries()) assert.deepEqual(await speciesCredit(db, `s1-haiku-${i}`), { handle: expected })
    assert.deepEqual(migrateSqlite(sqlite, files), [])
    sqlite.close()
  })

  it('keeps rename/delete privacy even when rollback code writes only the old columns', async () => {
    const sqlite = new DatabaseSync(':memory:')
    migrateSqlite(sqlite, loadMigrations())
    await rollbackWrites(nodeDb(sqlite))
    sqlite.close()
  })

  it('indexes affected species holders and alphabetical Mythic pages', async () => {
    const sqlite = new DatabaseSync(':memory:')
    migrateSqlite(sqlite, loadMigrations())
    const db = nodeDb(sqlite)
    const holders = await db.all<{ detail: string }>(`EXPLAIN QUERY PLAN SELECT owner_id FROM cards
      WHERE id IN (SELECT card_id FROM mythics WHERE finder_id = ?)
      OR species IN (SELECT species FROM firsts WHERE player_id = ?)`, 'finder', 'finder')
    assert.match(holders.map(r => r.detail).join(' '), /cards_species_owner/)
    const catalogue = await db.all<{ detail: string }>(`EXPLAIN QUERY PLAN SELECT card_id, name FROM mythics
      WHERE day <= ? ORDER BY lower(name), card_id LIMIT 25`, '2026-10-02')
    assert.match(catalogue.map(r => r.detail).join(' '), /mythics_name/)
    sqlite.close()
  })
})

describe('discovery handles on real D1', async () => {
  const local = await localD1()
  it('applies and runs trigger bodies, then resolves real species/Mythic credit with bounded pages', { skip: 'skip' in local ? local.skip : false }, async () => {
    if ('skip' in local) return
    await rollbackWrites(local.db)
    const s = server({ db: local.db }), f = await s.join(), o = await s.join()
    const first = await newSpecies(s, f), [caught] = await give(s, f, [mythic(s, 'd1-public-mythic')])
    await s.db.batch([stmt('UPDATE cards SET owner_id = ? WHERE id = ?', o.id, caught!.id)])
    assert.deepEqual(await speciesCredit(s.db, first.species), { handle: handle(f) })
    const credits = await discoveryCredits(s.db, [first, caught!])
    assert.deepEqual(credits.get(first.id), { kind: 'species', handle: handle(f) })
    assert.deepEqual(credits.get(caught!.id), { kind: 'mythic', handle: handle(f) })
    assert.deepEqual((await publicMythics(s.db, s.now())).mythics[0]!.card, publicCard((await o.call('cards')).cards.find(c => c.id === caught!.id)!))
    await f.call('rerollHandle', {})
    assert.deepEqual(await speciesCredit(s.db, first.species), { handle: null })
    assert.equal((await publicMythics(s.db, s.now())).mythics[0]!.handle, null)
  })
})

// Shared authoritative encounter scenarios on SQLite and the real local D1 adapter.
import assert from 'node:assert/strict'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { NAMED_MYTHICS } from '../../plugin/hooks/core/named-mythics.ts'
import { Conflict, guard, stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { prepareStart } from '../../server/src/game/battles.ts'
import { commit } from '../../server/src/game/ctx.ts'
import { HOUR, DAY, server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

export async function forceMythics<T>(fn: () => Promise<T>): Promise<T> {
  const wild = ECONOMY.wild as { mythicChance: number }
  const old = wild.mythicChance
  wild.mythicChance = 1
  try { return await fn() } finally { wild.mythicChance = old }
}

export const metWild = (s: Server, p: Player, strong = true) => s.db.batch([
  stmt('UPDATE players SET last_wild_at = ? WHERE id = ?', s.now() - HOUR, p.id),
  stmt('UPDATE cards SET stats = ?, tired_until = 0 WHERE owner_id = ?',
    JSON.stringify(strong ? { hp: 999, atk: 999, def: 999, spd: 999 } : { hp: 1, atk: 1, def: 1, spd: 1 }), p.id),
])

/** All four starts read the empty roster before any can commit: retries must resolve this actual race. */
function gatedDb(base: Db) {
  let armed = false, arrived = 0, conflicts = 0
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const db: Db = {
    async all<T>(sql, ...params) {
      const rows = await base.all<T>(sql, ...params)
      if (armed && sql.startsWith('SELECT id FROM named_mythic_encounters') && arrived < NAMED_MYTHICS.length) {
        if (++arrived === NAMED_MYTHICS.length) release()
        await barrier
      }
      return rows
    },
    get: (sql, ...params) => base.get(sql, ...params),
    async batch(stmts) {
      try { return await base.batch(stmts) }
      catch (err) { if (err instanceof Conflict) conflicts++; throw err }
    },
  }
  return { db, arm: () => { armed = true }, conflicts: () => conflicts }
}

export async function namedEncounterRace(base: Db): Promise<void> {
  await forceMythics(async () => {
    const gate = gatedDb(base), s = server({ db: gate.db })
    const players = await Promise.all(NAMED_MYTHICS.map(() => s.join()))
    await Promise.all(players.map(p => metWild(s, p)))
    const before = (await players[0]!.row()).last_wild_at
    const proposed = await prepareStart({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) },
      await players[0]!.row(), { kind: 'wild', family: 'haiku' })
    assert.equal(proposed.response.setup.defender[0]!.form!.names[2], 'Dario')
    assert.deepEqual(await s.db.all('SELECT * FROM named_mythic_encounters'), [], 'preparing never spends a reservation')
    await assert.rejects(commit({ db: s.db, player: await players[0]!.row() }, [...proposed.stmts, guard('SELECT 0')]), Conflict)
    assert.deepEqual(await s.db.all('SELECT * FROM named_mythic_encounters'), [], 'an aborted start rolls back the reservation too')
    assert.equal((await players[0]!.row()).last_wild_at, before)
    assert.equal((await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM battles'))!.n, 0)

    gate.arm()
    const beforeRace = gate.conflicts()
    const starts = await Promise.all(players.map(p => p.call('startBattle', { kind: 'wild', family: 'haiku' })))
    const names = starts.map(b => b.setup.defender[0]!.form!.names[2])
    assert.deepEqual([...names].sort(), NAMED_MYTHICS.map(m => m.name).sort())
    assert.ok(gate.conflicts() - beforeRace >= 3, 'the concurrent starts actually lost races and retried')
    const reserved = NAMED_MYTHICS.map(m => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id))
    assert.deepEqual(await s.db.all('SELECT * FROM named_mythic_encounters ORDER BY id'), reserved)
    assert.deepEqual((await s.db.all<{ name: string }>('PRAGMA table_info(named_mythic_encounters)')).map(c => c.name), ['id'])
    assert.deepEqual(await s.db.all('PRAGMA foreign_key_list(named_mythic_encounters)'), [], 'a reservation cannot retain or depend on a player')

    const index = names.indexOf('Dario'), p = players[index]!, start = starts[index]!
    s.set(start.finishAfter + 60_000)
    const won = await p.call('finishBattle', { battleId: start.id, inputs: [] })
    assert.equal(won.result, 'win')
    assert.equal(won.catchOptions[0]!.form!.names[2], 'Dario')
    const { card } = await p.call('catchCreature', { battleId: start.id, index: 0 })
    assert.deepEqual(card.form!.names, ['Dario', 'Dario', 'Dario'])
    assert.equal(card.form!.seed, start.setup.defender[0]!.form!.seed)
    assert.deepEqual(card.genes, start.setup.defender[0]!.genes)
    assert.equal((await p.call('cards')).cards.find(c => c.id === card.id)!.form!.names[2], 'Dario')
    assert.equal((await s.db.get<{ name: string }>('SELECT name FROM mythics WHERE card_id = ?', card.id))!.name, 'Dario')

    // Leaving the other three encounters cannot offer them again; neither deletion nor retention refunds them.
    s.tick(ECONOMY.battle.abandonMs + 60_000)
    for (let i = 0; i < players.length; i++) if (i !== index) {
      await players[i]!.call('me')
      assert.equal((await s.db.get<{ state: string }>('SELECT state FROM battles WHERE id = ?', starts[i]!.id))!.state, 'settled')
      assert.equal((await players[i]!.fails('catchCreature', { battleId: starts[i]!.id, index: 0 })).code, 'conflict')
    }
    for (const who of players) await who.call('deleteMe')
    assert.equal(await s.db.get('SELECT id FROM cards WHERE id = ?', card.id), undefined)
    s.tick(91 * DAY)
    await s.app.sweep(s.now())
    assert.deepEqual(await s.db.all('SELECT * FROM named_mythic_encounters ORDER BY id'), reserved,
      'only fixed roster ids remain after accounts, cards, battles and retained rows go')

    const next = await s.join()
    await metWild(s, next)
    const ordinary = (await next.call('startBattle', { kind: 'wild', family: 'opus' })).setup.defender[0]!
    assert.equal(ordinary.species, 'mythic', 'exhaustion preserves the normal Mythic chance')
    assert.ok(!NAMED_MYTHICS.some(m => m.name === ordinary.form!.names[2]))
    assert.deepEqual(await s.db.all('SELECT * FROM named_mythic_encounters ORDER BY id'), reserved)
  })
}

export async function namedEncounterLoss(db: Db): Promise<void> {
  await forceMythics(async () => {
    const s = server({ db }), p = await s.join()
    await metWild(s, p, false)
    const start = await p.call('startBattle', { kind: 'wild', family: 'opus' })
    assert.equal(start.setup.defender[0]!.form!.names[2], 'Dario')
    s.set(start.finishAfter + 60_000)
    const lost = await p.call('finishBattle', { battleId: start.id, inputs: [] })
    assert.deepEqual([lost.result, lost.catchOptions], ['loss', []])
    await p.call('deleteMe')
    assert.deepEqual(await db.all('SELECT * FROM named_mythic_encounters'), [{ id: 'dario' }])
    const next = await s.join()
    await metWild(s, next)
    assert.equal((await next.call('startBattle', { kind: 'wild', family: 'opus' })).setup.defender[0]!.form!.names[2], 'Marshmallow Menace')
  })
}

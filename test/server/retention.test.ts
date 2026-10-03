// What the hourly sweep forgets about players (SPEC 20.4, 29): exact times once no rule reads them,
// on player rows, battles and cards, a finish's stored answer, and whole accounts nobody can reach
// any more.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { stmt } from '../../server/src/db.ts'
import type { BattleRow, CardRow } from '../../server/src/schema.ts'
import { DAY, FIRST_CHARGE, HOUR, MINUTE, server, T0 } from './scaffold-helpers.ts'

describe('the sweep and players', () => {
  it('turns exact times back to 0 a day after the last, which every rule reads as long ago', async () => {
    const s = server()
    const p = await s.join()
    const q = await s.join()
    s.tick(FIRST_CHARGE)
    await p.call('chargePack', { family: 'opus' })
    const wild = await p.call('startBattle', { kind: 'wild', family: 'opus' })
    s.set(wild.finishAfter)
    await p.call('finishBattle', { battleId: wild.id, inputs: [] })
    await p.fails('claim', { code: 'quiet-otter-lamp-0000' })
    const marked = await p.row()
    assert.ok(marked.last_wild_at && marked.last_charge_at && marked.charges !== '[]' && marked.claim_hour)

    s.tick(DAY + MINUTE)
    await q.call('chargePack', { family: 'fable' }) // q charged just now: its marks still count
    await s.app.sweep(s.now())
    const row = await p.row()
    assert.deepEqual(
      [row.last_wild_at, row.last_duel_at, row.last_charge_at, row.charges, row.claim_hour, row.claim_tries],
      [0, 0, 0, '[]', 0, 0],
    )
    assert.ok(row.version > marked.version, 'handlers that read the old row run again')
    const me = (await p.call('me')).player
    assert.deepEqual([me.nextWildAt, me.nextChargeAt, me.rested], [0, 0, true])
    assert.equal((await q.row()).last_charge_at, s.now())
    assert.equal((await s.db.get<{ outcome: string | null }>('SELECT outcome FROM battles WHERE id = ?', wild.id))!.outcome, null,
      'a finish\'s stored answer goes too')
  })

  it("keeps a settled battle's day, not its times, and turns a passed catch window, duel start, revenge, lock or tiredness back to 0", async () => {
    const s = server()
    const p = await s.join()
    await s.join() // someone to duel
    await s.db.batch([stmt('UPDATE cards SET stats = ? WHERE owner_id = ?', JSON.stringify({ hp: 999, atk: 999, def: 999, spd: 999 }), p.id)])
    const wild = await p.call('startBattle', { kind: 'wild', family: 'opus' })
    s.set(wild.finishAfter)
    assert.ok((await p.call('finishBattle', { battleId: wild.id, inputs: [] })).catchOptions.length, 'the first wild win catches')
    const duel = await p.call('startBattle', { kind: 'duel', family: 'opus' })
    s.set(duel.finishAfter)
    await p.call('finishBattle', { battleId: duel.id, inputs: [] })
    const battle = async (id: string) => {
      const b = (await s.db.get<BattleRow>('SELECT * FROM battles WHERE id = ?', id))!
      return [b.kind, b.settled, b.started_at, b.finish_after, b.catch_until]
    }
    // the duel beat the other player: their defense loss keeps revenge open for a day after the finish
    const revengeUntil = async () =>
      (await s.db.get<{ revenge_until: number | null }>(`SELECT revenge_until FROM notices WHERE kind = 'defense-loss'`))?.revenge_until
    // settled, a wild battle keeps its day; a duel its start, for the pair limit's 24 hours
    const catchUntil = wild.finishAfter + ECONOMY.battle.catchWindowMs
    assert.deepEqual(await battle(wild.id), ['wild', '2026-10-02', 0, 0, catchUntil])
    assert.deepEqual(await battle(duel.id), ['duel', '2026-10-02', duel.startedAt, 0, 0])
    const [passed, coming] = p.me.player.team
    await s.db.batch([
      stmt('UPDATE cards SET tired_until = ?, locked_until = ? WHERE id = ?', s.now() - 1, s.now(), passed!),
      stmt('UPDATE cards SET tired_until = ?, locked_until = ? WHERE id = ?', s.now() + DAY + HOUR, s.now() + 2 * DAY, coming!),
    ])
    const card = async (id: string) => (await s.db.get<CardRow>('SELECT * FROM cards WHERE id = ?', id))!
    const before = await card(passed!)

    await s.app.sweep(s.now())
    assert.deepEqual(await battle(wild.id), ['wild', '2026-10-02', 0, 0, catchUntil], 'the catch window is still open')
    assert.deepEqual(await battle(duel.id), ['duel', '2026-10-02', duel.startedAt, 0, 0])
    assert.equal(await revengeUntil(), duel.finishAfter + DAY, 'the revenge is still open')
    const swept = await card(passed!)
    assert.deepEqual([swept.tired_until, swept.locked_until], [0, 0])
    assert.ok(swept.version > before.version, 'handlers that read the old card run again')
    assert.deepEqual([(await card(coming!)).tired_until, (await card(coming!)).locked_until], [s.now() + DAY + HOUR, s.now() + 2 * DAY])

    s.tick(DAY + MINUTE)
    await s.app.sweep(s.now())
    assert.deepEqual(await battle(wild.id), ['wild', '2026-10-02', 0, 0, 0])
    assert.deepEqual(await battle(duel.id), ['duel', '2026-10-02', 0, 0, 0])
    assert.equal(await revengeUntil(), null, "the attacker's finish time goes with the revenge")
    assert.deepEqual([(await card(coming!)).tired_until, (await card(coming!)).locked_until], [s.now() - MINUTE + HOUR, s.now() - MINUTE + DAY])
    assert.equal((await p.fails('catchCreature', { battleId: wild.id, index: 0 })).code, 'expired', 'a late catch is told it wandered off, as before')
  })

  it('deletes an account nobody can reach any more: no session left and no passkey', async () => {
    const s = server()
    const gone = await s.join()
    const keyed = await s.join()
    const active = await s.join()
    await s.db.batch([stmt(
      `INSERT INTO passkeys (id, player_id, credential_id, user_id, alg, public_key, created_day) VALUES ('k1', ?, 'cred', 'u', -7, '{}', '2026-10-02')`,
      keyed.id,
    )])
    s.set(T0 + 181 * DAY)
    await active.call('me')
    await s.app.sweep(s.now())
    const ids = (await s.db.all<{ id: string }>('SELECT id FROM players ORDER BY id')).map(r => r.id)
    assert.deepEqual(ids, [keyed.id, active.id].sort(), 'the passkey can still sign in; the other is in use')
    assert.equal(await s.db.get('SELECT 1 FROM cards WHERE owner_id = ?', gone.id), undefined)
    assert.equal((await s.request('GET', `/u/${gone.me.player.handle}`, { client: null })).status, 404)
    assert.ok(await s.db.get('SELECT 1 FROM retired_handles WHERE handle = ?', gone.me.player.handle), 'its handle rests 30 days like any other')
  })
})

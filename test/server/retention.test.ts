// What the hourly sweep forgets about players (SPEC 20.4, 29): exact times once no rule reads them,
// a finish's stored answer, and whole accounts nobody can reach any more.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stmt } from '../../server/src/db.ts'
import { DAY, FIRST_CHARGE, MINUTE, server, T0 } from './scaffold-helpers.ts'

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

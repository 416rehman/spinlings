// Battles over Cloudflare D1, run locally by wrangler's workerd (the real D1 engine, in memory): the
// guards a battle relies on (one open battle, the pair limit, the battle's own state), the touch
// query for abandoned battles, catching and revenge. Skipped only when wrangler cannot start here.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { Conflict, guard, stmt } from '../../server/src/db.ts'
import { localD1 } from './d1-helpers.ts'
import { MINUTE, server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const local = await localD1()

const STRONG = JSON.stringify({ hp: 999, atk: 999, def: 999, spd: 999 })
const strong = (s: Server, p: Player) => s.db.batch([stmt('UPDATE cards SET stats = ?, tired_until = 0 WHERE owner_id = ?', STRONG, p.id)])

if ('skip' in local) {
  describe('battles over local D1', () => { it('runs', { skip: local.skip }, () => {}) })
} else {
  describe('battles over local D1', () => {
    it('start, finish, catch, a duel with its defense notice, revenge and an abandoned battle', async () => {
      const s = server({ db: local.db })
      const a = await s.join('haiku')
      const b = await s.join('opus')

      await strong(s, a)
      const wild = await a.call('startBattle', { kind: 'wild', family: 'haiku' })
      s.set(wild.finishAfter)
      const won = await a.call('finishBattle', { battleId: wild.id, inputs: [] })
      assert.deepEqual([won.result, won.catchOptions.length > 0], ['win', true], 'the first wild win always catches')
      assert.equal((await a.call('catchCreature', { battleId: wild.id, index: 0 })).card.origin, 'catch')
      assert.equal((await a.fails('catchCreature', { battleId: wild.id, index: 0 })).code, 'conflict')

      // the one-open-battle guard holds on D1
      const open = await a.call('startBattle', { kind: 'duel', family: 'haiku' })
      await assert.rejects(
        s.db.batch([guard(`SELECT NOT EXISTS (SELECT 1 FROM battles WHERE attacker_id = ? AND state = 'open')`, a.id), stmt('SELECT 1')]),
        (e: unknown) => e instanceof Conflict,
      )
      assert.deepEqual(open.opponent, { kind: 'player', handle: b.me.player.handle, league: 'Pebble' })
      s.set(open.finishAfter)
      assert.equal((await a.call('finishBattle', { battleId: open.id, inputs: [] })).result, 'win')
      const told = await b.call('me')
      assert.deepEqual(told.notices.map(n => [n.kind, n.handle]), [['defense-loss', a.me.player.handle]])

      await strong(s, b)
      await s.db.batch([stmt('UPDATE cards SET stats = ? WHERE owner_id = ?', JSON.stringify({ hp: 1, atk: 1, def: 1, spd: 1 }), a.id)])
      const revenge = await b.call('startBattle', { kind: 'duel', family: 'opus', revenge: a.me.player.handle })
      s.set(revenge.finishAfter)
      const paid = await b.call('finishBattle', { battleId: revenge.id, inputs: [] })
      assert.deepEqual([paid.result, paid.sparks], ['win', ECONOMY.battle.sparks.duelWin + ECONOMY.battle.revengeBonus])

      // left open, it settles on the defender's next request 10 minutes on
      s.tick(2 * MINUTE)
      await strong(s, a)
      await s.db.batch([stmt(`UPDATE players SET recent_opponents = '[]' WHERE id = ?`, a.id)])
      const left = await a.call('startBattle', { kind: 'duel', family: 'haiku' })
      assert.equal(left.opponent.kind, 'player')
      s.tick(ECONOMY.battle.abandonMs)
      await b.call('me')
      const row = await s.db.get<{ state: string; setup: string }>('SELECT state, setup FROM battles WHERE id = ?', left.id)
      assert.deepEqual(row, { state: 'settled', setup: '{}' })
      assert.equal((await a.call('me')).player.battles, 3)
    })
  })
}

// The collection over Cloudflare D1, run locally by wrangler's workerd (the real D1 engine, in
// memory): a collection's whole life, and its guards deciding real races. Skipped only when wrangler
// cannot start here.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sha256Hex } from '../../plugin/hooks/core/sha256.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { mintFor, traderDeals } from '../../plugin/hooks/core/trader.ts'
import { Conflict, stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { setPlayer } from '../../server/src/game/ctx.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { localD1 } from './d1-helpers.ts'
import { ApiFailure, DAY, FIRST_CHARGE, server, T0 } from './scaffold-helpers.ts'

const local = await localD1()

/** Holds the next `n` batches until all have arrived, so every racer reads before any writes. */
function racing(base: Db) {
  let need = 0, lost = 0
  let waiting: (() => void)[] = []
  const release = () => { need = 0; const go = waiting; waiting = []; for (const f of go) f() }
  const db: Db = {
    all: base.all,
    get: base.get,
    async batch(stmts) {
      if (need > 0) await new Promise<void>(resolve => { waiting.push(resolve); if (waiting.length >= need) release() })
      try {
        return await base.batch(stmts)
      } catch (err) {
        if (err instanceof Conflict) lost++
        throw err
      }
    },
  }
  return {
    db,
    async race<T>(n: number, run: () => Promise<T>): Promise<[T, number]> {
      need = n
      lost = 0
      const timer = setTimeout(release, 5000)
      try { return [await run(), lost] } finally { clearTimeout(timer) }
    },
  }
}

const settle = (calls: Promise<unknown>[]) =>
  Promise.all(calls.map(c => c.then(() => 'ok', (e: unknown) => (e instanceof ApiFailure ? e.code : String(e)))))

if ('skip' in local) {
  describe('collection over local D1', () => { it('runs', { skip: local.skip }, () => {}) })
} else {
  describe('collection over local D1', () => {
    it('charges, buys, opens, lists, fuses, recycles, crafts, wishes, trades with the Trader and redeems', async () => {
      const s = server({ db: local.db })
      const p = await s.join('sonnet')
      await local.db.batch([setPlayer(p.id, { sparks: 5000, joined: '2026-09-28', battles: 10 })])
      s.tick(FIRST_CHARGE)
      await p.call('chargePack', { family: 'opus' })
      for (let i = 0; i < 9; i++) await p.call('buyPack', { family: 'haiku' })
      assert.equal((await p.fails('chargePack', { family: 'opus' })).code, 'cap_reached')
      const free = (await p.call('openPack', { packId: (await p.call('me')).packs.find(k => k.source === 'bought')!.id })).cards
      assert.ok(free.every(x => x.origin === 'pack' && x.family === 'haiku' && x.lockedUntil === 0 && !x.bound))
      assert.equal((await p.fails('chargePack', { family: 'opus' })).code, 'rate_limited')
      s.tick(DAY)
      assert.equal((await p.call('chargePack', { family: 'opus' })).packs.length, 12, 'the bank guard passes on D1 with room')
      assert.equal((await p.call('setForTrade', { cardId: free[0]!.id, forTrade: true })).card.forTrade, true)
      await p.call('setTeam', { cardIds: [free[1]!.id] })
      const fused = await p.call('fuse', { cardId: free[1]!.id, otherId: free[2]!.id })
      assert.equal(fused.card.species, 'fusion')
      assert.deepEqual((await p.call('me')).player.team, [])
      assert.ok((await p.call('recycle', { cardId: free[3]!.id })).gained > 0)
      assert.equal((await p.call('craft', { speciesId: 's1-fable-8', rarity: 'legendary' })).card.stage, 3)
      assert.deepEqual((await p.call('setWishlist', { species: ['s1-opus-2'] })).wishlist, ['s1-opus-2'])
      const deal = traderDeals(s.now())[0]!
      const fresh = Array.from({ length: deal.give.count }, (_, i) =>
        mintFor(deal.give.family ?? 'opus', deal.give.rarity ?? 'common', rngFromSeed(`d1/${i}`), s.now(), 'pack'))
      const minted = await mintCards({ db: local.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }, p.id, fresh)
      await local.db.batch(minted.stmts)
      assert.equal((await p.call('traderDeal', { dealId: deal.id, cardIds: minted.cards.map(x => x.id) })).consumed.length, deal.give.count)
      await local.db.batch([stmt(
        `INSERT INTO drops (id, code_hash, code_plain, kind, reward_json, starts_at, ends_at, created_at) VALUES ('d1', ?, 'HELLO', 'public', ?, 0, ?, 0)`,
        sha256Hex('HELLO'), JSON.stringify({ type: 'pack', count: 1 }), T0 + 9 * DAY,
      )])
      assert.equal((await p.call('redeem', { code: 'hello' })).packs.length, 1)
      assert.equal((await p.fails('redeem', { code: 'HELLO' })).code, 'conflict')
    })

    it('lets the guards decide races: one opening per pack, one buyer of the last unit', async () => {
      const r = racing(local.db)
      const s = server({ db: r.db, now: T0 + 20 * DAY })
      const p = await s.join()
      const q = await s.join()
      const pack = (await p.call('me')).packs[0]!
      const [opens, lostOpen] = await r.race(2, () => settle([p.call('openPack', { packId: pack.id }), p.call('openPack', { packId: pack.id })]))
      assert.deepEqual([opens.sort(), lostOpen], [['not_found', 'ok'], 1])
      await local.db.batch([stmt(
        `INSERT INTO drops (id, code_hash, code_plain, kind, reward_json, supply, starts_at, ends_at, created_at) VALUES ('d2', ?, 'LAST', 'public', ?, 1, 0, ?, 0)`,
        sha256Hex('LAST'), JSON.stringify({ type: 'card', rarity: 'rare' }), T0 + 30 * DAY,
      )])
      const [last, lostLast] = await r.race(2, () => settle([p.call('redeem', { code: 'LAST' }), q.call('redeem', { code: 'LAST' })]))
      assert.deepEqual([last.sort(), lostLast], [['cap_reached', 'ok'], 1])
      assert.deepEqual(await local.db.get(`SELECT redeemed FROM drops WHERE id = 'd2'`), { redeemed: 1 })
    })
  })
}

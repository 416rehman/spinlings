// The Wandering Trader (SPEC 19, 24, 26): three deals a day from the date hash, each once per player
// per day, paid only with free cards (not bound, held or trade-locked), which it consumes.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { mintFor, traderDeals } from '../../plugin/hooks/core/trader.ts'
import type { Card, Family, NewCard, Rarity, TraderDeal } from '../../plugin/hooks/core/types.ts'
import { stmt } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import type { MintOptions } from '../../server/src/game/mint.ts'
import { counts, DAY, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n))
let seed = 0

async function give(s: Server, p: Player, cards: NewCard[], o: MintOptions = {}): Promise<Card[]> {
  const minted = await mintCards({ db: s.db, now: s.now(), randomBytes: rand }, p.id, cards, o)
  await s.db.batch(minted.stmts)
  return minted.cards
}

const card = (s: Server, family: Family, rarity: Rarity) => mintFor(family, rarity, rngFromSeed(`trader/${seed++}`), s.now(), 'pack')

/** Exactly what a deal asks for: its count, of its family and rarity where it names them. */
const payment = (s: Server, deal: TraderDeal, other = false): NewCard[] =>
  Array.from({ length: deal.give.count }, () => {
    const family = deal.give.family ?? 'sonnet'
    return card(s, other ? (family === 'opus' ? 'haiku' : 'opus') : family, deal.give.rarity ?? 'common')
  })

const ids = (cards: readonly { id: string }[]) => cards.map(c => c.id)

describe('the Wandering Trader', () => {
  it("shows today's three deals from the date, none used yet", async () => {
    const s = server()
    const p = await s.join()
    const view = await p.call('trader')
    assert.equal(view.day, '2026-10-02')
    assert.deepEqual(view.deals, traderDeals(T0).map(d => ({ ...d, used: false })))
  })

  it('takes exactly what each deal asks, gives what it promises, and makes each deal once a day', async () => {
    const s = server()
    const p = await s.join()
    for (const deal of traderDeals(T0)) {
      const paid = await give(s, p, payment(s, deal))
      const res = await p.call('traderDeal', { dealId: deal.id, cardIds: ids(paid) })
      assert.deepEqual(res.consumed, ids(paid))
      if (deal.get.kind === 'pack') {
        assert.deepEqual([res.cards.length, res.packs.map(k => [k.family, k.source])], [0, Array(deal.get.count).fill([deal.get.family, 'trader'])])
      } else {
        assert.equal(res.packs.length, 0)
        assert.deepEqual(res.cards.map(c => [c.family, c.rarity, c.origin, c.season, c.bound]), Array(deal.get.count).fill([deal.get.family, deal.get.rarity, 'trader', 1, false]))
      }
      const left = new Set(ids((await p.call('cards')).cards))
      assert.ok(paid.every(c => !left.has(c.id)) && res.cards.every(c => left.has(c.id)))
      const again = await give(s, p, payment(s, deal))
      const twice = await p.fails('traderDeal', { dealId: deal.id, cardIds: ids(again) })
      assert.deepEqual([twice.status, twice.code], [409, 'conflict'])
    }
    assert.ok((await p.call('trader')).deals.every(d => d.used))
    s.tick(DAY)
    const tomorrow = await p.call('trader')
    assert.ok(tomorrow.deals.every(d => !d.used && d.id.startsWith('2026-10-03-')))
    const stale = await p.fails('traderDeal', { dealId: traderDeals(T0)[0]!.id, cardIds: [ids((await p.call('cards')).cards)[0]!] })
    assert.deepEqual([stale.status, stale.code], [404, 'not_found'])
  })

  it("keeps each player's stock to themselves", async () => {
    const s = server()
    const p = await s.join()
    const q = await s.join()
    const deal = traderDeals(T0)[1]!
    await p.call('traderDeal', { dealId: deal.id, cardIds: ids(await give(s, p, payment(s, deal))) })
    assert.deepEqual((await q.call('trader')).deals.map(d => d.used), [false, false, false])
    await q.call('traderDeal', { dealId: deal.id, cardIds: ids(await give(s, q, payment(s, deal))) })
  })

  it('refuses the wrong cards, bound, held or trade-locked ones, and changes nothing', async () => {
    const s = server()
    const p = await s.join()
    const deal = traderDeals(T0).find(d => d.give.family)!
    const good = await give(s, p, payment(s, deal))
    const wrongFamily = await give(s, p, payment(s, deal, true))
    const locked = await give(s, p, payment(s, deal), { lockedUntil: T0 + DAY })
    const [held] = await give(s, p, payment(s, deal).slice(0, 1))
    await s.db.batch([stmt(`UPDATE cards SET state = 'escrow', escrow_ref = 'o1', version = version + 1 WHERE id = ?`, held!.id)])
    const starter = (await p.call('cards')).cards.find(c => c.origin === 'starter')!
    const before = await counts(s.db, ['cards', 'packs', 'trader_uses'])
    const tries: [string[], RegExp][] = [
      [ids(good).slice(1), /wants \d cards/],
      [[...ids(good), ...ids(wrongFamily)].slice(0, deal.give.count + 1), /wants \d cards/],
      [ids(wrongFamily), /wants (haiku|sonnet|opus|fable) cards/],
      [ids(locked), /cannot be traded/],
      [[held!.id, ...ids(good).slice(1)], /cannot be traded/],
      [[starter.id, ...ids(good).slice(1)], /cannot be traded/],
    ]
    for (const [cardIds, why] of tries) {
      const err = await p.fails('traderDeal', { dealId: deal.id, cardIds })
      assert.equal(err.code, 'not_allowed', why.source)
      assert.match(err.message, why)
    }
    assert.equal((await p.fails('traderDeal', { dealId: deal.id, cardIds: [good[0]!.id, good[0]!.id] })).status, 400)
    assert.equal((await p.fails('traderDeal', { dealId: '2026-10-02-7', cardIds: ids(good) })).status, 404)
    assert.equal((await p.fails('traderDeal', { dealId: 'today', cardIds: ids(good) })).status, 400)
    assert.deepEqual(await counts(s.db, ['cards', 'packs', 'trader_uses']), before)
    assert.equal((await p.call('traderDeal', { dealId: deal.id, cardIds: ids(good) })).consumed.length, deal.give.count)
  })

  it('takes paid cards off the team', async () => {
    const s = server()
    const p = await s.join()
    const deal = traderDeals(T0)[0]!
    const paid = await give(s, p, payment(s, deal))
    const starter = (await p.call('cards')).cards.find(c => c.origin === 'starter')!
    await p.call('setTeam', { cardIds: [paid[0]!.id, starter.id] })
    await p.call('traderDeal', { dealId: deal.id, cardIds: ids(paid) })
    assert.deepEqual((await p.call('me')).player.team, [starter.id])
    assert.equal((await p.row()).team_size, 1)
  })
})

// Social over Cloudflare D1, run locally by wrangler's workerd (the real D1 engine, in memory): the
// guards behind accepting, paying, claiming and settling, races between them, and a drop written
// exactly as scripts/admin/drop.ts sends it through `wrangler d1 execute --command`. Skipped only
// when wrangler cannot start here.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stmt } from '../../server/src/db.ts'
import { commands, insertStmts, planDrop } from '../../scripts/admin/drop.ts'
import { localD1 } from './d1-helpers.ts'
import { ApiFailure, DAY, HOUR, server, T0 } from './scaffold-helpers.ts'
import { fresh, list, trust } from './social-helpers.ts'

const local = await localD1()

if ('skip' in local) {
  describe('social over local D1', () => { it('runs', { skip: local.skip }, () => {}) })
} else {
  const codes = (out: PromiseSettledResult<unknown>[]) => out.flatMap(r => (r.status === 'rejected' ? [(r.reason as ApiFailure).code] : []))

  describe('social over local D1', () => {
    it('offers: the swap with no fee, and two accepts racing', async () => {
      const s = server({ db: local.db })
      const [a, b] = [await s.join(), await s.join()]
      await trust(s, a, b)
      const [x] = await fresh(s, a, 1)
      const [z] = await fresh(s, b, 1)
      await list(b, z!)
      const { offer } = await a.call('offer', { to: b.me.player.handle, give: [x!.id], get: [z!.id] })
      const out = await Promise.allSettled([b.call('acceptOffer', { offerId: offer.id }), b.call('acceptOffer', { offerId: offer.id })])
      assert.deepEqual(codes(out), ['conflict'])
      const owners = await s.db.all<{ id: string; owner_id: string; state: string }>('SELECT id, owner_id, state FROM cards WHERE id IN (?, ?) ORDER BY id', x!.id, z!.id)
      assert.deepEqual(owners.map(o => [o.owner_id, o.state]).sort(), [[a.id, 'owned'], [b.id, 'owned']].sort())
      assert.equal(owners.find(o => o.id === x!.id)!.owner_id, b.id)
      assert.deepEqual([(await a.row()).sparks, (await b.row()).sparks], [a.me.player.sparks, b.me.player.sparks])
    })

    it('gifts: one claimant wins a race, and a lapsed gift comes home with the sweep', async () => {
      const s = server({ db: local.db })
      const a = await s.join()
      await trust(s, a)
      const [x, y] = await fresh(s, a, 2)
      const { gift } = await a.call('gift', { cardId: x!.id })
      const [c, d] = [await s.join(), await s.join()]
      const out = await Promise.allSettled([c.call('claim', { code: gift.code }), d.call('claim', { code: gift.code })])
      assert.deepEqual(codes(out), ['not_found'])
      const lapsing = (await a.call('gift', { cardId: y!.id })).gift
      s.set(lapsing.expiresAt + HOUR)
      await s.app.sweep(s.now())
      assert.deepEqual(await s.db.get('SELECT state FROM gifts WHERE code = ?', lapsing.code), { state: 'returned' })
      assert.deepEqual(await s.db.get('SELECT owner_id, state FROM cards WHERE id = ?', y!.id), { owner_id: a.id, state: 'owned' })
    })

    it('market: two buyers racing (one wins, the other hears it is sold), a swap, stats and a lapse with the sweep', async () => {
      const s = server({ db: local.db })
      const [a, b, c] = [await s.join(), await s.join(), await s.join()]
      const [x, y, z] = await fresh(s, a, 3)
      const [pay] = await fresh(s, c, 1)
      const { listing } = await a.call('listCard', { cardId: x!.id, price: 20 })
      const out = await Promise.allSettled([b.call('buyListing', { listingId: listing.id }), c.call('buyListing', { listingId: listing.id })])
      assert.deepEqual(codes(out), ['conflict'])
      assert.equal((await a.row()).sparks, a.me.player.sparks + 20)
      const swap = (await a.call('listCard', { cardId: y!.id, want: { rarity: 'common' } })).listing
      assert.equal((await c.call('buyListing', { listingId: swap.id, cardId: pay!.id })).listing.state, 'sold')
      assert.deepEqual(await s.db.get('SELECT owner_id FROM cards WHERE id = ?', pay!.id), { owner_id: a.id })
      // sales count once per buyer: c bought the swap, and b or c the raced card
      const buyers = out[0]!.status === 'fulfilled' ? 2 : 1
      const me = await a.call('me')
      assert.equal(me.player.stats!.marketSales, buyers)
      // the boards show the last midnight's numbers
      s.set((Math.floor(s.now() / DAY) + 1) * DAY)
      assert.equal((await a.call('rankings', { board: 'sales', period: 'season' })).me!.value, buyers)
      const lapsing = (await a.call('listCard', { cardId: z!.id, price: 3 })).listing
      s.set(Date.parse(`${lapsing.day}T00:00:00Z`) + 15 * DAY + HOUR)
      await s.app.sweep(s.now())
      assert.deepEqual(await s.db.get('SELECT state FROM listings WHERE id = ?', lapsing.id), { state: 'expired' })
      assert.deepEqual(await s.db.get('SELECT owner_id, state FROM cards WHERE id = ?', z!.id), { owner_id: a.id, state: 'owned' })
    })

    it('a drop sent the way wrangler d1 execute --command sends it, then redeemed once per player', async () => {
      const plan = planDrop({
        code: 'FOUNDERS-D1',
        reward: [{ type: 'egg', promo: { seed: 'd1-egg', name: 'Glimmerkin', family: 'fable', rarity: 'rare', foil: true, stamp: "Founder's · Oct 2026" } }, { type: 'pack', count: 1 }],
        starts: T0 - HOUR, ends: T0 + DAY,
      }, { now: T0, randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) })
      for (const sql of commands(insertStmts(plan.rows))) await local.d1.batch(local.split(sql).map(q => local.d1.prepare(q)))
      const s = server({ db: local.db })
      const p = await s.join()
      const got = await p.call('redeem', { code: 'founders-d1' })
      assert.equal(got.cards[0]!.form!.stamp, "Founder's · Oct 2026")
      assert.equal((await p.fails('redeem', { code: 'FOUNDERSD1' })).code, 'conflict')
    })
  })
}

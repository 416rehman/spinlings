// Gifts and claims (SPEC 8, 15, 24, 26): escrow under a code, claiming with no trust gate, the
// exact claim cap, cancelling, lapsing, the giver's bonus pack, races and storage limits.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GIFT_CODE_RE } from '../../plugin/hooks/core/schemas.ts'
import type { Card } from '../../plugin/hooks/core/types.ts'
import { stmt } from '../../server/src/db.ts'
import { battleFinished } from '../../server/src/game/pacing.ts'
import type { CardRow, GiftRow } from '../../server/src/schema.ts'
import { ApiFailure, DAY, HOUR, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'
import { fresh, midnight, snapshot, trust } from './social-helpers.ts'

const cardIn = async (p: Player, id: string): Promise<Card | undefined> => (await p.call('cards')).cards.find(c => c.id === id)
const cardRow = async (s: Server, id: string) => (await s.db.get<CardRow>('SELECT * FROM cards WHERE id = ?', id))!
const giftRow = async (s: Server, code: string) => (await s.db.get<GiftRow>('SELECT * FROM gifts WHERE code = ?', code))!
const handle = (p: Player) => p.me.player.handle

async function giver(s = server()) {
  const a = await s.join()
  await trust(s, a)
  const [x, y] = await fresh(s, a, 2)
  return { s, a, x: x!, y: y! }
}

describe('making a gift', () => {
  it('holds one tradeable card under a word code for at least 14 days, off the team', async () => {
    const { s, a, x } = await giver()
    await a.call('setTeam', { cardIds: [x.id] })
    const { gift } = await a.call('gift', { cardId: x.id })
    assert.match(gift.code, GIFT_CODE_RE)
    assert.deepEqual([gift.card.id, gift.card.state, gift.createdAt, gift.expiresAt], [x.id, 'escrow', Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 17)])
    assert.ok(midnight(gift.expiresAt) && gift.expiresAt - T0 >= 14 * DAY)
    assert.equal((await cardRow(s, x.id)).escrow_ref, gift.code)
    const me = await a.call('me')
    assert.deepEqual([me.player.team, me.gifts.map(g => g.code)], [[], [gift.code]])
  })

  it('waits for the trust gate and takes only free cards; at most 10 open gifts', async () => {
    const s = server()
    const a = await s.join()
    const cards = await fresh(s, a, 11)
    assert.equal((await a.fails('gift', { cardId: cards[0]!.id })).code, 'not_allowed', 'not yet trusted')
    await trust(s, a)
    const starter = (await a.call('cards')).cards.find(c => c.bound)!
    const [welcome] = (await a.call('openPack', { packId: a.me.packs[0]!.id })).cards
    assert.equal((await a.fails('gift', { cardId: starter.id })).code, 'not_allowed')
    assert.equal((await a.fails('gift', { cardId: welcome!.id })).code, 'not_allowed')
    for (const c of cards.slice(0, 10)) await a.call('gift', { cardId: c.id })
    assert.equal((await a.fails('gift', { cardId: cards[0]!.id })).code, 'not_allowed', 'already held')
    const full = await a.fails('gift', { cardId: cards[10]!.id })
    assert.deepEqual([full.status, full.code], [429, 'cap_reached'])
  })
})

describe('claiming', () => {
  it('moves the card to anyone but the giver, trust gate or not, trade-locked 24 hours, with word to the giver', async () => {
    const { s, a, x } = await giver()
    await s.db.batch([stmt('UPDATE cards SET arena_sonnet = 4 WHERE id = ?', x.id)])
    const { gift } = await a.call('gift', { cardId: x.id })
    assert.equal((await a.fails('claim', { code: gift.code })).code, 'not_allowed', 'not your own')
    const c = await s.join()
    const { card } = await c.call('claim', { code: gift.code })
    assert.deepEqual([card.id, card.state, card.forTrade, card.lockedUntil, card.bound], [x.id, 'owned', false, T0 + DAY, false])
    // it arrives as a gift today: nothing says when or how the giver got it
    assert.deepEqual([card.origin, card.mintedAt, card.raisedIn], ['gift', Date.UTC(2026, 9, 2), undefined])
    assert.deepEqual(await cardIn(c, x.id), card)
    const r = await cardRow(s, x.id)
    assert.deepEqual([r.owner_id, r.escrow_ref, r.arena_sonnet], [c.id, null, 0])
    assert.equal(await cardIn(a, x.id), undefined)
    const g = await giftRow(s, gift.code)
    assert.deepEqual([g.state, g.claimed_by, g.resolved], ['claimed', c.id, '2026-10-02'])
    const me = await a.call('me')
    assert.equal(me.gifts.length, 0)
    assert.equal(me.notices.find(n => n.kind === 'gift-claimed')!.handle, handle(c))
    // one-shot: the claimant again is a conflict, anyone else finds nothing
    assert.equal((await c.fails('claim', { code: gift.code })).code, 'conflict')
    assert.equal((await (await s.join()).fails('claim', { code: gift.code })).code, 'not_found')
  })

  it('answers a wrong, spent, cancelled or lapsed code alike', async () => {
    const { s, a, x, y } = await giver()
    const c = await s.join()
    const cancelled = (await a.call('gift', { cardId: x.id })).gift
    await a.call('cancelGift', { code: cancelled.code })
    const lapsing = (await a.call('gift', { cardId: y.id })).gift
    s.set(lapsing.expiresAt)
    const answers = []
    for (const code of ['quiet-otter-lamp-0000', cancelled.code, lapsing.code]) {
      const err = await c.fails('claim', { code })
      answers.push([err.status, err.code, err.message])
    }
    assert.equal(new Set(answers.map(x => JSON.stringify(x))).size, 1)
    assert.deepEqual(answers[0]!.slice(0, 2), [404, 'not_found'])
  })

  it('caps claim attempts at 5 an hour, right or wrong, counted exactly in the database', async () => {
    const { s, a, x } = await giver()
    const { gift } = await a.call('gift', { cardId: x.id })
    const c = await s.join()
    for (let i = 0; i < 5; i++) assert.equal((await c.fails('claim', { code: `quiet-otter-lamp-${1000 + i}` })).code, 'not_found')
    const capped = await c.fails('claim', { code: gift.code })
    assert.equal(capped.status, 429)
    assert.deepEqual([(await c.row()).claim_tries, (await c.row()).claim_hour], [5, Math.floor(T0 / HOUR)])
    // another isolate (fresh in-memory buckets) still refuses: the cap lives on the player row
    const elsewhere = server({ db: s.db, now: s.now() })
    const again = await (await elsewhere.as(c.token)).fails('claim', { code: gift.code })
    assert.deepEqual([again.status, again.code], [429, 'rate_limited'])
    assert.ok(Number(again.headers.get('retry-after')) > 0)
    s.tick(HOUR)
    assert.equal((await c.call('claim', { code: gift.code })).card.id, x.id)
  })

  it('two claimants at once: one gets the card, the other finds nothing', async () => {
    const { s, a, x } = await giver()
    const { gift } = await a.call('gift', { cardId: x.id })
    const [c, d] = [await s.join(), await s.join()]
    const out = await Promise.allSettled([c.call('claim', { code: gift.code }), d.call('claim', { code: gift.code })])
    const won = out.filter(r => r.status === 'fulfilled')
    assert.equal(won.length, 1)
    assert.deepEqual(out.flatMap(r => (r.status === 'rejected' ? [(r.reason as ApiFailure).code] : [])), ['not_found'])
    assert.ok([c.id, d.id].includes((await cardRow(s, x.id)).owner_id))
  })
})

describe('cancelling and lapsing', () => {
  it('only the giver takes a gift back; anyone else finds nothing and changes nothing', async () => {
    const { s, a, x } = await giver()
    const { gift } = await a.call('gift', { cardId: x.id })
    const b = await s.join()
    await b.call('me')
    const before = await snapshot(s.db)
    assert.equal((await b.fails('cancelGift', { code: gift.code })).code, 'not_found')
    assert.equal((await b.fails('cancelGift', { code: 'brave-wren-kite-1234' })).code, 'not_found')
    assert.deepEqual(await snapshot(s.db), before)
    const back = (await a.call('cancelGift', { code: gift.code })).gift
    assert.deepEqual([back.code, back.card.id, back.card.state], [gift.code, x.id, 'owned'])
    assert.equal((await giftRow(s, gift.code)).state, 'cancelled')
    assert.equal((await a.fails('cancelGift', { code: gift.code })).code, 'conflict')
  })

  it('comes home at the giver’s touch once lapsed, or with the hourly sweep', async () => {
    const { s, a, x, y } = await giver()
    const one = (await a.call('gift', { cardId: x.id })).gift
    s.set(one.expiresAt - 1)
    await a.call('me')
    assert.equal((await giftRow(s, one.code)).state, 'open', 'not before its day')
    s.set(one.expiresAt)
    const me = await a.call('me')
    assert.deepEqual([(await cardIn(a, x.id))!.state, (await giftRow(s, one.code)).state, me.gifts.length], ['owned', 'returned', 0])
    assert.ok(me.notices.some(n => n.kind === 'gift-returned' && n.handle === undefined))
    const two = (await a.call('gift', { cardId: y.id })).gift
    s.set(two.expiresAt + HOUR)
    await s.app.sweep(s.now())
    assert.deepEqual([(await cardRow(s, y.id)).state, (await giftRow(s, two.code)).state], ['owned', 'returned'])
  })
})

describe('the giver’s bonus pack', () => {
  const play = (s: Server, p: Player, days: number[]) => s.db.batch(days.map(d => battleFinished(p.id, T0 + d * DAY)))

  /** The hourly sweep at hour `h` of day `d` (day 0 is T0's). */
  const sweepAt = async (s: Server, d: number, h: number) => {
    s.set(Date.UTC(2026, 9, 2 + d, h, 17))
    await s.app.sweep(s.now())
  }

  it('pays once, with the first sweep of a day after a claimant who joined after the gift has finished 5 battles on 2 days', async () => {
    const { s, a, x } = await giver()
    const { gift } = await a.call('gift', { cardId: x.id })
    const c = await s.join()
    await c.call('claim', { code: gift.code })
    assert.equal((await giftRow(s, gift.code)).bonus, 1)
    const packs = async () => (await a.call('me')).packs.filter(p => p.source === 'bonus').length
    await play(s, c, [0, 0, 0, 0, 0])
    await sweepAt(s, 1, 0)
    assert.equal(await packs(), 0, '5 battles, but all on one day')
    await play(s, c, [1])
    await sweepAt(s, 1, 13)
    assert.equal(await packs(), 0, 'the giver hears nothing the moment the claimant plays, touch or sweep')
    await sweepAt(s, 2, 0)
    assert.equal(await packs(), 1)
    const bonus = (await a.call('me')).notices.find(n => n.kind === 'bonus-pack')!
    assert.equal(bonus.handle, undefined, 'and never who, or how much they played')
    assert.ok(!bonus.text.includes(handle(c)))
    await play(s, c, [1, 1, 2])
    await sweepAt(s, 3, 0)
    assert.equal(await packs(), 1, 'once per gift')
    assert.equal((await giftRow(s, gift.code)).bonus, 2)
  })

  it('never pays for a claimant who was already playing when the gift was made', async () => {
    const { s, a, x } = await giver()
    const c = await s.join()
    await s.db.batch([stmt('UPDATE players SET joined = ? WHERE id = ?', '2026-10-01', c.id)])
    const { gift } = await a.call('gift', { cardId: x.id })
    await c.call('claim', { code: gift.code })
    assert.equal((await giftRow(s, gift.code)).bonus, 0)
    await play(s, c, [0, 0, 0, 1, 1, 2])
    await sweepAt(s, 3, 0)
    assert.equal((await a.call('me')).packs.filter(p => p.source === 'bonus').length, 0)
  })
})

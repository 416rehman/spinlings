// The market (SPEC 8, 15, 16, 20, 24, 26): listing into escrow, buying for sparks, for a card or both while the
// seller is away, cancelling, lapsing, racing buyers, browsing with filters, sorts and pages, recent sale prices
// with no names, and every refusal leaving every table as it was.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import type { ListingView, MarketWant } from '../../plugin/hooks/core/api.ts'
import type { Card, Family, Rarity } from '../../plugin/hooks/core/types.ts'
import { SEASON_MS } from '../../plugin/hooks/core/world.ts'
import { stmt } from '../../server/src/db.ts'
import type { CardRow, ListingRow } from '../../server/src/schema.ts'
import { DAY, HOUR, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'
import { assertNoIds, assertPublic, fresh, list, midnight, snapshot } from './social-helpers.ts'

const handle = (p: Player) => p.me.player.handle
const cardIn = async (p: Player, id: string): Promise<Card | undefined> => (await p.call('cards')).cards.find(c => c.id === id)
const cardRow = async (s: Server, id: string) => (await s.db.get<CardRow>('SELECT * FROM cards WHERE id = ?', id))!
const listingRow = async (s: Server, id: string) => (await s.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', id))!
const sparks = async (p: Player) => (await p.row()).sparks
const setSparks = (s: Server, p: Player, n: number) => s.db.batch([stmt('UPDATE players SET sparks = ? WHERE id = ?', n, p.id)])
const LISTING_KEYS = ['card', 'day', 'id', 'price', 'seller', 'state', 'want']

/** a seller and a buyer, each with fresh cards; the seller rich enough to buy too */
async function world(n = 3) {
  const s = server()
  const a = await s.join('opus')
  const b = await s.join('haiku')
  const cards = await fresh(s, a, n)
  return { s, a, b, cards }
}

/** One card of exactly this kind in the player's collection. */
async function one(s: Server, p: Player, family: Family, rarity: Rarity, o: { shiny?: boolean; foil?: boolean; species?: string } = {}): Promise<Card> {
  const [c] = await fresh(s, p, 1, { family, rarity, ...(o.species ? { species: o.species } : {}) })
  if (o.shiny !== undefined || o.foil !== undefined) {
    await s.db.batch([stmt('UPDATE cards SET shiny = ?, foil = ? WHERE id = ?', o.shiny === true, o.foil === true, c!.id)])
  }
  return (await cardIn(p, c!.id))!
}

describe('listing', () => {
  it('holds the card in escrow, off the team, and shows the public card, the seller, the terms and the day only', async () => {
    const { s, a, cards: [x, y] } = await world()
    const team = (await a.call('me')).player.team
    await a.call('setTeam', { cardIds: [x!.id, ...team.slice(0, 2)] })
    const v0 = (await a.row()).cards_version
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 40, want: { family: 'sonnet', rarity: 'rare' } })
    assert.deepEqual(Object.keys(listing).sort(), LISTING_KEYS)
    assert.deepEqual([listing.seller, listing.price, listing.want, listing.day, listing.state, listing.card.id],
      [handle(a), 40, { family: 'sonnet', rarity: 'rare' }, '2026-10-02', 'open', x!.id])
    assertPublic(listing.card, 'listing')
    assertNoIds(listing, [a.id], 'listing')
    const held = (await cardIn(a, x!.id))!
    assert.equal(held.state, 'escrow')
    assert.equal((await cardRow(s, x!.id)).escrow_ref, listing.id)
    const me = await a.call('me')
    assert.ok(!me.player.team.includes(x!.id), 'off the team')
    assert.deepEqual(me.listings!.map(l => l.id), [listing.id])
    assert.ok((await a.row()).cards_version > v0)
    const row = await listingRow(s, listing.id)
    assert.deepEqual([row.kind, row.expires], ['both', '2026-10-17'], 'lapses at the first midnight 14 days on')
    assert.equal((await a.call('listCard', { cardId: y!.id, price: 5 })).listing.state, 'open', 'sparks only')
  })

  it('refuses bound, held and someone else\'s cards, the last card on the team and a species still to come, changing nothing', async () => {
    const { s, a, b, cards: [x, y] } = await world()
    const starter = (await a.call('cards')).cards.find(c => c.bound)!
    await a.call('offer', { to: handle(b), give: [y!.id], get: [] })
    const [theirs] = await fresh(s, b, 1)
    await a.call('setTeam', { cardIds: [x!.id] })
    const cases: [string, Parameters<Player['call']>[1], string][] = [
      ['a bound starter', { cardId: starter.id, price: 5 }, 'not_allowed'],
      ['a card held for an offer', { cardId: y!.id, price: 5 }, 'not_allowed'],
      ['the last card on the team', { cardId: x!.id, price: 5 }, 'not_allowed'],
      ['someone else\'s card', { cardId: theirs!.id, price: 5 }, 'not_found'],
      ['no such card', { cardId: 'nosuchcardanywhere0000000a', price: 5 }, 'not_found'],
    ]
    for (const [what, req, code] of cases) {
      const before = await snapshot(s.db)
      assert.equal((await a.fails('listCard', req as never)).code, code, what)
      assert.deepEqual(await snapshot(s.db), before, `${what}: nothing changed`)
    }
    const [z] = await fresh(s, a, 1)
    const later = await a.fails('listCard', { cardId: z!.id, want: { species: 's2-opus-1' } })
    assert.deepEqual([later.code, later.message], ['bad_request', '400 bad_request: That creature has not appeared yet'])
  })

  it('keeps a listed card out of every other action: fuse, recycle, team, trade list, offers, gifts and a second listing', async () => {
    const { s, a, b, cards: [x, y] } = await world()
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 10 })
    const before = await snapshot(s.db)
    for (const [op, req] of [
      ['fuse', { cardId: x!.id, otherId: y!.id }], ['fuse', { cardId: y!.id, otherId: x!.id }], ['recycle', { cardId: x!.id }],
      ['setTeam', { cardIds: [x!.id] }], ['setForTrade', { cardId: x!.id, forTrade: true }], ['gift', { cardId: x!.id }],
      ['offer', { to: handle(b), give: [x!.id], get: [] }], ['listCard', { cardId: x!.id, price: 3 }],
    ] as const) {
      const err = await a.fails(op, req as never)
      assert.equal(err.code, 'not_allowed', op)
      assert.match(err.message, /held for a trade, a gift or the market/, op)
    }
    assert.deepEqual(await snapshot(s.db), before)
    // nor is it battling: it waits off the team, and the bench never picks it
    assert.ok(!(await a.call('startBattle', { kind: 'wild', family: 'opus' })).setup.attacker.some(c => c.id === x!.id))
    assert.equal((await listingRow(s, listing.id)).state, 'open')
  })

  it(`keeps at most ${ECONOMY.market.open} open listings (storage, not a quota): taking one off makes room`, async () => {
    const { s, a } = await world(0)
    const cards = await fresh(s, a, ECONOMY.market.open + 1)
    const open: ListingView[] = []
    for (const c of cards.slice(0, -1)) open.push((await a.call('listCard', { cardId: c.id, price: 1 })).listing)
    const full = await a.fails('listCard', { cardId: cards.at(-1)!.id, price: 1 })
    assert.deepEqual([full.status, full.code], [429, 'cap_reached'])
    assert.equal((await a.call('me')).listings!.length, ECONOMY.market.open)
    await a.call('cancelListing', { listingId: open[0]!.id })
    assert.equal((await a.call('listCard', { cardId: cards.at(-1)!.id, price: 1 })).listing.state, 'open')
  })

  it('parses requests strictly', async () => {
    const { s, a, cards: [x] } = await world()
    const post = (path: string, body: unknown) => s.request('POST', path, { token: a.token, body })
    for (const body of [
      { cardId: x!.id }, { cardId: x!.id, price: 0 }, { cardId: x!.id, price: -5 }, { cardId: x!.id, price: 2.5 }, { cardId: x!.id, price: 1_000_001 },
      { cardId: x!.id, price: 5, note: 'hi' }, { cardId: x!.id, want: {} }, { cardId: x!.id, want: { species: 's1-opus-1', family: 'opus' } },
      { cardId: x!.id, want: { shiny: false } }, { cardId: x!.id, want: { stats: { hp: 1 } } }, { cardId: [x!.id], price: 5 },
      { cardId: x!.id, price: '5' },
    ]) assert.equal((await post('/v1/market', body)).status, 400, JSON.stringify(body))
    assert.equal((await post('/v1/market/bad*id/buy', {})).status, 400)
    assert.equal((await post('/v1/market/abc/buy', { cardId: x!.id, price: 1 })).status, 400)
    assert.equal((await post('/v1/market/abc/cancel', { now: true })).status, 400)
    assert.equal((await s.request('POST', '/v1/market', { body: { cardId: x!.id, price: 5 } })).status, 401)
    assert.equal((await s.request('GET', '/v1/market?owner=me', { token: a.token })).status, 400, 'an unknown query field')
    assert.equal((await s.request('GET', '/v1/market?sort=newest&sort=cheapest', { token: a.token })).status, 400, 'a field twice')
  })
})

describe('buying', () => {
  it('for sparks: the card to the buyer, every spark to the seller, while the seller is away, with a day-only notice', async () => {
    const { s, a, b, cards: [x] } = await world()
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 60 })
    await s.db.batch([stmt('UPDATE cards SET arena_opus = 5 WHERE id = ?', x!.id)])
    s.tick(3 * DAY + 5 * HOUR)
    await b.call('me') // the buyer's daily hello, before counting their sparks; the seller stays away
    const [sa, sb] = [await sparks(a), await sparks(b)]
    const va = (await a.row()).version
    const res = await b.call('buyListing', { listingId: listing.id })
    assert.deepEqual([res.listing.state, res.listing.id, res.card.id, res.sparks], ['sold', listing.id, x!.id, sb - 60])
    assert.deepEqual([await sparks(a), await sparks(b)], [sa + 60, sb - 60], 'no fee')
    assert.ok((await a.row()).version > va, 'the seller\'s row moved with the sale')
    // the card arrives as a gift today: home, free to trade, nothing of the seller on it
    assert.deepEqual([res.card.state, res.card.lockedUntil, res.card.origin, res.card.mintedAt, res.card.forTrade], ['owned', 0, 'gift', Date.UTC(2026, 9, 5), false])
    assert.deepEqual(await cardIn(b, x!.id), res.card)
    const r = await cardRow(s, x!.id)
    assert.deepEqual([r.owner_id, r.escrow_ref, r.arena_opus], [b.id, null, 0])
    assert.ok((await b.call('me')).player.seen.includes(x!.species), 'into the buyer\'s album')
    assert.equal(await cardIn(a, x!.id), undefined)
    const me = await a.call('me')
    assert.deepEqual(me.listings, [])
    const news = me.notices.find(n => n.kind === 'market-sold')!
    assert.deepEqual([news.day, news.handle, news.text], ['2026-10-05', handle(b), 'Your card sold for 60 sparks'])
    assert.equal(me.player.stats!.marketSales, 1)
    // the sale keeps its price for pricing, and nobody's name
    const sale = (await s.db.all<Record<string, unknown>>('SELECT * FROM market_sales'))
    assert.deepEqual(sale, [{ id: 1, species: x!.species, rarity: x!.rarity, shiny: x!.shiny ? 1 : 0, foil: x!.foil ? 1 : 0, price: 60, day: '2026-10-05' }])
    // one-shot
    const again = await b.fails('buyListing', { listingId: listing.id })
    assert.deepEqual([again.status, again.code, again.message], [409, 'conflict', '409 conflict: Already sold'])
  })

  it('refuses the seller, a buyer short of sparks and an unknown listing, changing nothing', async () => {
    const { s, a, b, cards: [x] } = await world()
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 60 })
    await setSparks(s, b, 59)
    const before = await snapshot(s.db)
    assert.equal((await a.fails('buyListing', { listingId: listing.id })).code, 'not_allowed', 'not your own')
    assert.equal((await b.fails('buyListing', { listingId: listing.id })).code, 'insufficient_sparks')
    assert.equal((await b.fails('buyListing', { listingId: 'nosuchlistinganywhere00000' })).code, 'not_found')
    assert.deepEqual(await snapshot(s.db), before)
    await setSparks(s, b, 60)
    assert.equal((await b.call('buyListing', { listingId: listing.id })).sparks, 0, 'exactly enough is enough')
  })

  it('for a card: exactly one of the buyer\'s that fits the want, which goes to the seller', async () => {
    const { s, a, b, cards: [x] } = await world()
    const want: MarketWant = { family: 'sonnet', rarity: 'rare' }
    const { listing } = await a.call('listCard', { cardId: x!.id, want })
    const common = await one(s, b, 'sonnet', 'common')
    const wrongFamily = await one(s, b, 'fable', 'epic')
    const epic = await one(s, b, 'sonnet', 'epic')
    const [theirs] = await fresh(s, a, 1)
    const before = await snapshot(s.db)
    assert.equal((await b.fails('buyListing', { listingId: listing.id })).code, 'bad_request', 'a card is needed')
    assert.equal((await b.fails('buyListing', { listingId: listing.id, cardId: common.id })).code, 'not_allowed', 'below the rarity')
    assert.equal((await b.fails('buyListing', { listingId: listing.id, cardId: wrongFamily.id })).code, 'not_allowed', 'another family')
    assert.equal((await b.fails('buyListing', { listingId: listing.id, cardId: theirs!.id })).code, 'not_found', 'the seller\'s own card')
    assert.deepEqual(await snapshot(s.db), before)
    const sb = await sparks(b)
    const res = await b.call('buyListing', { listingId: listing.id, cardId: epic.id })
    assert.deepEqual([res.card.id, res.sparks], [x!.id, sb], 'a rarer card fits a minimum rarity; no sparks asked')
    const paid = (await cardIn(a, epic.id))!
    assert.deepEqual([paid.state, paid.origin, paid.lockedUntil], ['owned', 'gift', 0])
    assert.equal(await cardIn(b, epic.id), undefined)
    assert.equal((await a.call('me')).notices.find(n => n.kind === 'market-sold')!.text, 'Your card sold for a card in return')
  })

  it('matches a species, shiny and foil exactly as asked, and takes sparks and a card together', async () => {
    const { s, a, b, cards: [x, y] } = await world()
    const species = 's1-fable-3'
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 15, want: { species, shiny: true, foil: true } })
    const plain = await one(s, b, 'fable', 'rare', { species })
    const shinyOnly = await one(s, b, 'fable', 'rare', { species, shiny: true })
    const other = await one(s, b, 'fable', 'rare', { species: 's1-fable-4', shiny: true, foil: true })
    const right = await one(s, b, 'fable', 'common', { species, shiny: true, foil: true })
    for (const c of [plain, shinyOnly, other]) assert.equal((await b.fails('buyListing', { listingId: listing.id, cardId: c.id })).code, 'not_allowed', c.id)
    const sb = await sparks(b)
    assert.equal((await b.call('buyListing', { listingId: listing.id, cardId: right.id })).sparks, sb - 15)
    assert.equal((await a.call('me')).notices.find(n => n.kind === 'market-sold')!.text, 'Your card sold for 15 sparks and a card')
    // a sparks-only listing takes no card
    const { listing: plainSale } = await a.call('listCard', { cardId: y!.id, price: 5 })
    assert.equal((await b.fails('buyListing', { listingId: plainSale.id, cardId: plain.id })).code, 'bad_request')
  })

  it('never takes a bound card, a held one or the buyer\'s last team card in a swap', async () => {
    const { s, a, b, cards: [x] } = await world()
    const { listing } = await a.call('listCard', { cardId: x!.id, want: { rarity: 'common' } })
    const starter = (await b.call('cards')).cards.find(c => c.bound)!
    const [held, last] = await fresh(s, b, 2)
    await b.call('gift', { cardId: held!.id })
    await b.call('setTeam', { cardIds: [last!.id] })
    for (const c of [starter, held!, last!]) assert.equal((await b.fails('buyListing', { listingId: listing.id, cardId: c.id })).code, 'not_allowed', c.id)
    assert.equal((await listingRow(s, listing.id)).state, 'open')
  })
})

describe('cancelling and lapsing', () => {
  it('only the seller takes a listing off (anyone else finds nothing), and the card comes home', async () => {
    const { s, a, b, cards: [x] } = await world()
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 9 })
    const before = await snapshot(s.db)
    assert.equal((await b.fails('cancelListing', { listingId: listing.id })).code, 'not_found')
    assert.deepEqual(await snapshot(s.db), before)
    const res = (await a.call('cancelListing', { listingId: listing.id })).listing
    assert.deepEqual([res.state, res.card.id], ['cancelled', x!.id])
    assert.equal((await cardIn(a, x!.id))!.state, 'owned')
    assert.equal((await a.fails('cancelListing', { listingId: listing.id })).code, 'conflict')
    const gone = await b.fails('buyListing', { listingId: listing.id })
    assert.deepEqual([gone.code, gone.message], ['conflict', '409 conflict: That listing was taken off the market'])
    assert.deepEqual((await a.call('me')).listings, [])
  })

  it('a sold listing cannot be taken off', async () => {
    const { a, b, cards: [x] } = await world()
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 9 })
    await b.call('buyListing', { listingId: listing.id })
    assert.equal((await a.fails('cancelListing', { listingId: listing.id })).message, '409 conflict: Already sold')
  })

  it('lapses at the first midnight 14 days on: the hourly sweep sends the card home with word of it', async () => {
    const { s, a, b, cards: [x] } = await world()
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 9 })
    const lapse = Date.UTC(2026, 9, 17)
    assert.ok(midnight(lapse) && lapse - T0 >= 14 * DAY)
    s.set(lapse - 1)
    await s.app.sweep(s.now())
    assert.equal((await listingRow(s, listing.id)).state, 'open', 'not a moment early')
    assert.ok((await b.call('market', {})).listings.some(l => l.id === listing.id))
    s.set(lapse + HOUR)
    assert.ok(!(await b.call('market', {})).listings.some(l => l.id === listing.id), 'a lapsed listing is off the market at once')
    await s.app.sweep(s.now())
    const row = await listingRow(s, listing.id)
    assert.deepEqual([row.state, row.resolved], ['expired', '2026-10-17'])
    assert.equal((await cardRow(s, x!.id)).state, 'owned')
    const news = (await a.call('me')).notices.find(n => n.kind === 'market-expired')!
    assert.deepEqual([news.day, news.handle, news.text], ['2026-10-17', undefined, 'Your listing ran out of time, so your card is home again'])
    assert.equal((await b.fails('buyListing', { listingId: listing.id })).code, 'expired')
    // and 30 days after it closed, the row goes
    s.set(lapse + 31 * DAY)
    await s.app.sweep(s.now())
    assert.equal(await s.db.get('SELECT 1 FROM listings WHERE id = ?', listing.id), undefined)
  })

  it('a buyer arriving after the lapse but before the sweep sends the card home, and is told it ran out of time', async () => {
    const { s, a, b, cards: [x] } = await world()
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 9 })
    s.set(Date.UTC(2026, 9, 17, 3))
    const late = await b.fails('buyListing', { listingId: listing.id })
    assert.deepEqual([late.status, late.code], [410, 'expired'])
    assert.equal((await listingRow(s, listing.id)).state, 'expired')
    assert.equal((await cardRow(s, x!.id)).state, 'owned')
  })

  it('the seller\'s own visit sends a lapsed listing\'s card home too', async () => {
    const { s, a, cards: [x] } = await world()
    await a.call('listCard', { cardId: x!.id, price: 9 })
    s.set(Date.UTC(2026, 9, 18))
    const me = await a.call('me')
    assert.deepEqual(me.listings, [])
    assert.equal((await cardIn(a, x!.id))!.state, 'owned')
  })
})

describe('races', () => {
  const settled = async (...calls: Promise<unknown>[]) => {
    const out = await Promise.allSettled(calls)
    return { ok: out.filter(r => r.status === 'fulfilled').length, errors: out.flatMap(r => (r.status === 'rejected' ? [r.reason as Error & { code: string }] : [])) }
  }

  it('two buyers at once: exactly one wins, the other is told it is already sold, and the sparks move once', async () => {
    for (let i = 0; i < 3; i++) {
      const { s, a, b, cards: [x] } = await world()
      const c = await s.join()
      const { listing } = await a.call('listCard', { cardId: x!.id, price: 20 })
      const [sa, sb, sc] = [await sparks(a), await sparks(b), await sparks(c)]
      const r = await settled(b.call('buyListing', { listingId: listing.id }), c.call('buyListing', { listingId: listing.id }))
      assert.equal(r.ok, 1)
      assert.deepEqual(r.errors.map(e => [e.code, e.message]), [['conflict', '409 conflict: Already sold']])
      const owner = (await cardRow(s, x!.id)).owner_id
      assert.ok([b.id, c.id].includes(owner))
      assert.equal(await sparks(a), sa + 20)
      assert.equal((await sparks(b)) + (await sparks(c)), sb + sc - 20)
    }
  })

  it('buy against cancel: exactly one wins, and the card has exactly one owner', async () => {
    for (let i = 0; i < 3; i++) {
      const { s, a, b, cards: [x] } = await world()
      const { listing } = await a.call('listCard', { cardId: x!.id, price: 20 })
      const r = await settled(b.call('buyListing', { listingId: listing.id }), a.call('cancelListing', { listingId: listing.id }))
      assert.equal(r.ok, 1)
      const state = (await listingRow(s, listing.id)).state
      const row = await cardRow(s, x!.id)
      assert.deepEqual([row.state, row.owner_id], ['owned', state === 'sold' ? b.id : a.id])
    }
  })

  it('a swap card the buyer spends elsewhere at the same moment ends with exactly one owner', async () => {
    const { s, a, b, cards: [x] } = await world()
    const { listing } = await a.call('listCard', { cardId: x!.id, want: { rarity: 'common' } })
    const [pay] = await fresh(s, b, 1)
    const r = await settled(b.call('buyListing', { listingId: listing.id, cardId: pay!.id }), b.call('recycle', { cardId: pay!.id }))
    assert.equal(r.ok, 1)
    const paid = await s.db.get<CardRow>('SELECT * FROM cards WHERE id = ?', pay!.id)
    const sold = (await listingRow(s, listing.id)).state === 'sold'
    assert.equal(paid?.owner_id, sold ? a.id : undefined)
  })
})

describe('browsing', () => {
  /** a lists a spread of cards: kinds, families, rarities and prices */
  async function stall() {
    const { s, a, b } = await world(0)
    const spec: [Family, Rarity, number, MarketWant | undefined, boolean, boolean][] = [
      ['opus', 'common', 10, undefined, false, false],
      ['opus', 'rare', 50, undefined, true, false],
      ['sonnet', 'epic', 0, { family: 'opus' }, false, true],
      ['fable', 'rare', 30, { rarity: 'rare' }, false, false],
      ['haiku', 'common', 30, undefined, false, false],
    ]
    const listed: ListingView[] = []
    for (const [family, rarity, price, want, shiny, foil] of spec) {
      const c = await one(s, a, family, rarity, { shiny, foil })
      listed.push((await a.call('listCard', { cardId: c.id, ...(price ? { price } : {}), ...(want ? { want } : {}) })).listing)
      s.tick(DAY)
    }
    return { s, a, b, listed }
  }
  const ids = (ls: readonly ListingView[]) => ls.map(l => l.id)

  it('sorts newest first by default, cheapest and priciest by sparks (a card-only listing counts 0, ties by id)', async () => {
    const { b, listed } = await stall()
    assert.deepEqual(ids((await b.call('market', {})).listings), ids([...listed].reverse()))
    const byPrice = (dir: 1 | -1) => [...listed].sort((x, y) => dir * (x.price - y.price) || (x.id < y.id ? -dir : dir))
    assert.deepEqual(ids((await b.call('market', { sort: 'cheapest' })).listings), ids(byPrice(1)))
    assert.deepEqual(ids((await b.call('market', { sort: 'priciest' })).listings), ids(byPrice(-1)))
  })

  it('filters by family, rarity, species, shiny, foil, kind and price', async () => {
    const { b, listed } = await stall()
    const q = async (req: Parameters<Player['call']>[1]) => ids((await b.call('market', req as never)).listings).sort()
    const pick = (...i: number[]) => i.map(k => listed[k]!.id).sort()
    assert.deepEqual(await q({ family: 'opus' }), pick(0, 1))
    assert.deepEqual(await q({ rarity: 'rare' }), pick(1, 3))
    assert.deepEqual(await q({ species: listed[2]!.card.species }), pick(2))
    assert.deepEqual(await q({ shiny: true }), pick(1))
    assert.deepEqual(await q({ foil: true }), pick(2))
    assert.deepEqual(await q({ shiny: false, foil: false }), pick(0, 3, 4))
    assert.deepEqual(await q({ kind: 'sparks' }), pick(0, 1, 4))
    assert.deepEqual(await q({ kind: 'swap' }), pick(2))
    assert.deepEqual(await q({ kind: 'both' }), pick(3))
    assert.deepEqual(await q({ minPrice: 30, maxPrice: 30 }), pick(3, 4))
    assert.deepEqual(await q({ minPrice: 31 }), pick(1))
    assert.deepEqual(await q({ maxPrice: 0 }), pick(2))
    assert.deepEqual(await q({ family: 'opus', rarity: 'rare', maxPrice: 49 }), [])
    assert.equal((await b.fails('market', { minPrice: 40, maxPrice: 30 })).code, 'bad_request')
  })

  it('pages through every listing exactly once in every sort, with the cursor its sort gave', async () => {
    const { s, a, b } = await world(0)
    const cards = await fresh(s, a, ECONOMY.market.page + 7)
    for (const [i, c] of cards.entries()) {
      await a.call('listCard', { cardId: c.id, price: 1 + (i % 4) })
      if (i % 10 === 9) s.tick(DAY)
    }
    for (const sort of ['newest', 'cheapest', 'priciest'] as const) {
      const seen: string[] = []
      let after: string | undefined
      let pages = 0
      do {
        const page = await b.call('market', { sort, ...(after ? { after } : {}) })
        seen.push(...ids(page.listings))
        after = page.next
        pages++
      } while (after)
      assert.equal(pages, 2, sort)
      assert.equal(seen.length, cards.length, sort)
      assert.equal(new Set(seen).size, cards.length, `${sort}: no listing twice`)
    }
    assert.equal((await b.fails('market', { sort: 'cheapest', after: '2026-10-02.abcdefghijklmnopqrstuvwxyz' })).code, 'bad_request', 'a cursor of another sort')
  })

  it('shows each species\' last few sales for sparks, newest first, by day and with no names', async () => {
    const { s, a, b } = await world(0)
    const species = 's1-opus-2'
    const prices: number[] = []
    for (let i = 0; i < ECONOMY.market.recentSales + 2; i++) {
      const c = await one(s, a, 'opus', 'common', { species })
      const price = 10 + i
      const { listing } = await a.call('listCard', { cardId: c.id, price })
      // a different buyer each time: a seller's sales to one buyer keep one price a season
      await (i ? await s.join() : b).call('buyListing', { listingId: listing.id })
      prices.push(price)
      s.tick(DAY)
    }
    // a swap sale has no sparks to show
    const swapped = await one(s, a, 'opus', 'common', { species })
    const { listing: sw } = await a.call('listCard', { cardId: swapped.id, want: { rarity: 'common' } })
    const [pay] = await fresh(s, b, 1)
    await b.call('buyListing', { listingId: sw.id, cardId: pay!.id })
    const onSale = await one(s, a, 'opus', 'rare', { species })
    await a.call('listCard', { cardId: onSale.id, price: 99 })
    const res = await b.call('market', { species })
    assert.deepEqual(res.prices.map(p => p.species), [species])
    const sales = res.prices[0]!.sales
    assert.deepEqual(sales.map(x => x.price), prices.slice(-ECONOMY.market.recentSales).reverse())
    for (const sale of sales) assert.deepEqual(Object.keys(sale).sort(), ['day', 'foil', 'price', 'rarity', 'shiny'])
    assert.equal(sales[0]!.day, '2026-10-08')
    assertNoIds(res, [a.id, b.id], 'market')
    assert.ok(!JSON.stringify(res.prices).includes(handle(a)) && !JSON.stringify(res.prices).includes(handle(b)), 'no handles in prices')
  })

  it('shows another player\'s listing exactly as public: the card, the handle, the terms and the day', async () => {
    const { s, a, b } = await world(0)
    const c = await one(s, a, 'opus', 'rare')
    await s.db.batch([stmt(`UPDATE cards SET raised_in = 'fable', tired_until = ?, arena_fable = 3 WHERE id = ?`, T0 + HOUR, c.id)])
    await a.call('listCard', { cardId: c.id, price: 8 })
    const [l] = (await b.call('market', {})).listings
    assert.deepEqual(Object.keys(l!).sort(), LISTING_KEYS.filter(k => k !== 'want'))
    assertPublic(l!.card, 'market')
    assert.equal(l!.card.raisedIn, undefined, 'never the arena it grew up in')
    assertNoIds(l, [a.id], 'market')
    assert.match(l!.day, /^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('deletion', () => {
  it('takes the seller\'s listings along; sale prices stay, naming nobody', async () => {
    const { s, a, b, cards: [x, y] } = await world()
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 7 })
    const { listing: open } = await a.call('listCard', { cardId: y!.id, price: 7 })
    await b.call('buyListing', { listingId: listing.id })
    await a.call('deleteMe')
    assert.deepEqual(await s.db.all('SELECT id FROM listings'), [])
    assert.equal((await s.db.all('SELECT * FROM market_sales')).length, 1)
    assert.equal((await b.fails('buyListing', { listingId: open.id })).code, 'not_found')
    assert.ok((await b.call('cards')).cards.some(c => c.id === x!.id), 'what was bought stays bought')
    assert.ok(!(await b.call('market', {})).listings.length)
  })

  it('forgets every pair of seller and buyer that names the player, both ways', async () => {
    const { s, a, b, cards: [x] } = await world(1)
    const c = await s.join()
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 1 })
    await b.call('buyListing', { listingId: listing.id })
    const { listing: back } = await b.call('listCard', { cardId: x!.id, price: 1 })
    await c.call('buyListing', { listingId: back.id })
    assert.equal((await s.db.all('SELECT * FROM sold_to')).length, 2)
    await b.call('deleteMe')
    assert.deepEqual(await s.db.all('SELECT * FROM sold_to'), [])
  })
})

describe('what a sale counts for', () => {
  const sales = async (p: Player) => (await p.call('me')).player.stats!.marketSales
  const priceRows = async (s: Server) => (await s.db.all<{ price: number }>('SELECT price FROM market_sales ORDER BY id')).map(r => r.price)

  it('counts each buyer once, so two accounts passing a card back and forth add nothing and set no price', async () => {
    const { s, a, b, cards: [x] } = await world(1)
    for (let i = 0; i < 6; i++) {
      for (const [seller, buyer] of [[a, b], [b, a]] as const) {
        const { listing } = await seller.call('listCard', { cardId: x!.id, price: 1 + i })
        await buyer.call('buyListing', { listingId: listing.id })
      }
    }
    assert.deepEqual([await sales(a), await sales(b)], [1, 1])
    assert.deepEqual([(await a.row()).s_sales, (await b.row()).s_sales], [1, 1])
    assert.deepEqual(await priceRows(s), [1, 1], 'one price each way, the first')
    // a new buyer counts, and sets a price
    const c = await s.join()
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 40 })
    await c.call('buyListing', { listingId: listing.id })
    assert.equal(await sales(a), 2)
    assert.deepEqual(await priceRows(s), [1, 1, 40])
    // a new season: the same buyer counts for that season's board once more, not all time
    s.set(T0 + SEASON_MS)
    const { listing: next } = await c.call('listCard', { cardId: x!.id, price: 5 })
    await a.call('buyListing', { listingId: next.id })
    const { listing: again } = await a.call('listCard', { cardId: x!.id, price: 6 })
    await c.call('buyListing', { listingId: again.id })
    const row = await a.row()
    assert.deepEqual([row.market_sales, row.stats_season, row.s_sales], [2, 2, 1])
  })

  it('keeps a price only for a sale for sparks alone', async () => {
    const { s, a, b, cards: [x, y] } = await world(2)
    const [pay] = await fresh(s, b, 1)
    const { listing: both } = await a.call('listCard', { cardId: x!.id, price: 10, want: { rarity: 'common' } })
    await b.call('buyListing', { listingId: both.id, cardId: pay!.id })
    const c = await s.join()
    const [cpay] = await fresh(s, c, 1)
    const { listing: swap } = await a.call('listCard', { cardId: y!.id, want: { rarity: 'common' } })
    await c.call('buyListing', { listingId: swap.id, cardId: cpay!.id })
    assert.deepEqual(await priceRows(s), [], 'ten sparks and a card is not a ten-spark price')
    assert.equal(await sales(a), 2, 'both still count as sales')
  })
})

describe('list for trade alongside the market', () => {
  it('a card on the trade list can still be listed, and comes home still marked', async () => {
    const { a, cards: [x] } = await world()
    await list(a, x!)
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 3 })
    await a.call('cancelListing', { listingId: listing.id })
    const home = (await cardIn(a, x!.id))!
    assert.deepEqual([home.state, home.forTrade], ['owned', true])
  })
})

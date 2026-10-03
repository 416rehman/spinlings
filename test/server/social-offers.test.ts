// Offers (SPEC 8, 15, 16, 24, 26): escrow, the atomic swap with no fee and no lock, decline,
// cancel, counter, expiry, no account limits, storage limits, races and strict request parsing.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import type { Card } from '../../plugin/hooks/core/types.ts'
import { stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { openDatabase } from '../../server/src/node.ts'
import type { CardRow } from '../../server/src/schema.ts'
import { ApiFailure, DAY, HOUR, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'
import { fresh, list, midnight, snapshot, trust } from './social-helpers.ts'

const cardIn = async (p: Player, id: string): Promise<Card | undefined> => (await p.call('cards')).cards.find(c => c.id === id)
const row = async (s: Server, id: string) => (await s.db.get<CardRow>('SELECT * FROM cards WHERE id = ?', id))!
const handle = (p: Player) => p.me.player.handle

/**
 * A database that holds back one batch: next(sql) catches the next batch running a statement like
 * `sql`, `reached` resolves once it waits, and release() lets it write, so another request can run
 * in between one handler's reads and its write.
 */
function holding(): { db: Db; next(sql: RegExp): { reached: Promise<void>; release(): void } } {
  const base = openDatabase(':memory:').db
  let gate: { sql: RegExp; arrive(): void; go: Promise<void> } | undefined
  const db: Db = {
    all: base.all,
    get: base.get,
    async batch(stmts) {
      const g = gate
      if (g && stmts.some(st => g.sql.test(st.sql))) {
        gate = undefined
        g.arrive()
        await g.go
      }
      return base.batch(stmts)
    },
  }
  return {
    db,
    next(sql) {
      let arrive!: () => void, release!: () => void
      const reached = new Promise<void>(resolve => { arrive = resolve })
      const go = new Promise<void>(resolve => { release = resolve })
      gate = { sql, arrive, go }
      return { reached, release }
    },
  }
}

/** a and b, a with two fresh cards, b with one listed for trade */
async function pair(s = server()) {
  const a = await s.join('haiku')
  const b = await s.join('opus')
  await trust(s, a, b)
  const [x, y] = await fresh(s, a, 2)
  const [z] = await fresh(s, b, 1)
  await list(b, z!)
  return { s, a, b, x: x!, y: y!, z: z! }
}

describe('sending an offer', () => {
  it('holds the cards for it, off the team, and tells the receiver who it is from, not when', async () => {
    const { s, a, b, x, z } = await pair()
    await a.call('setTeam', { cardIds: [x.id] })
    const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [z.id] })
    assert.deepEqual(
      { ...offer, give: offer.give.map(c => c.id), get: offer.get.map(c => c.id) },
      { id: offer.id, from: handle(a), to: handle(b), give: [x.id], get: [z.id], state: 'open', createdAt: Date.UTC(2026, 9, 2), expiresAt: Date.UTC(2026, 9, 6) },
    )
    assert.ok(midnight(offer.expiresAt) && offer.expiresAt - T0 >= 72 * HOUR, 'expires at a midnight at least 72 hours on')
    const held = (await cardIn(a, x.id))!
    assert.equal(held.state, 'escrow')
    assert.equal((await row(s, x.id)).escrow_ref, offer.id)
    const me = await a.call('me')
    assert.deepEqual(me.player.team, [])
    assert.deepEqual(me.offers.outgoing.map(o => o.id), [offer.id])
    const inbox = await b.call('me')
    assert.deepEqual(inbox.offers.incoming.map(o => o.id), [offer.id])
    const news = inbox.notices.find(n => n.kind === 'offer-received')!
    assert.equal(news.handle, handle(a))
    assert.ok(!news.text.includes(handle(a)), 'the text names nobody; the handle rides along')
  })

  it('refuses what cannot be traded: bound, held, unlisted or someone else’s', async () => {
    const { s, a, b, x, y, z } = await pair()
    const c = await s.join()
    await trust(s, c)
    const [w] = await fresh(s, c, 1)
    await list(c, w!)
    const starter = (await a.call('cards')).cards.find(k => k.bound)!
    const [welcome] = (await a.call('openPack', { packId: a.me.packs[0]!.id })).cards
    const [unlisted] = await fresh(s, b, 1)
    await a.call('offer', { to: handle(b), give: [y.id], get: [] })
    const to = handle(b)
    const cases: [string, Parameters<Player['call']>[1], string][] = [
      ['a bound starter', { to, give: [starter.id], get: [] }, 'not_allowed'],
      ['a card already held for an offer', { to, give: [y.id], get: [] }, 'not_allowed'],
      ['their card not on their trade list', { to, give: [x.id], get: [unlisted!.id] }, 'not_found'],
      ['a third player’s listed card', { to, give: [x.id], get: [w!.id] }, 'not_found'],
      ['their card as mine', { to, give: [z.id], get: [] }, 'not_found'],
      ['an unknown handle', { to: 'no-such-player-99', give: [x.id], get: [] }, 'not_found'],
      ['myself', { to: handle(a), give: [x.id], get: [] }, 'not_allowed'],
    ]
    for (const [what, req, code] of cases) {
      const before = await snapshot(s.db)
      assert.equal((await a.fails('offer', req as never)).code, code, what)
      assert.deepEqual(await snapshot(s.db), before, `${what}: nothing changed`)
    }
    assert.equal((await a.call('offer', { to, give: [welcome!.id], get: [] })).offer.state, 'open', 'a welcome card trades at once')
  })

  it('has no account limits: two players on their first day send, counter and accept', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    const [x] = await fresh(s, a, 1)
    const [z] = await fresh(s, b, 1)
    await list(b, z!)
    const { offer } = await a.call('offer', { to: handle(b), give: [x!.id], get: [] })
    const counter = (await b.call('counterOffer', { offerId: offer.id, give: [z!.id], get: [x!.id] })).offer
    assert.equal((await a.call('acceptOffer', { offerId: counter.id })).offer.state, 'accepted')
    assert.equal((await cardIn(a, z!.id))!.state, 'owned')
    assert.equal((await a.call('me')).player.canTrade, true, 'a 0.1.0 mod reads its old gate as passed')
  })

  it(`keeps at most ${ECONOMY.trade.openOutgoing} open outgoing offers (storage, not a quota): cancelling makes room`, async () => {
    const { s, a, b } = await pair()
    const n = ECONOMY.trade.openOutgoing
    const cards = await fresh(s, a, n + 1)
    const sent = []
    for (const c of cards.slice(0, n)) sent.push((await a.call('offer', { to: handle(b), give: [c.id], get: [] })).offer)
    const full = await a.fails('offer', { to: handle(b), give: [cards[n]!.id], get: [] })
    assert.deepEqual([full.status, full.code], [429, 'cap_reached'])
    await a.call('cancelOffer', { offerId: sent[0]!.id })
    assert.equal((await a.call('offer', { to: handle(b), give: [cards[n]!.id], get: [] })).offer.state, 'open')
  })

  it('parses requests strictly: no unknown keys, card data, bad sizes or bad ids', async () => {
    const { s, a, b, x, z } = await pair()
    const post = (path: string, body: unknown) => s.request('POST', path, { token: a.token, body })
    for (const body of [
      { to: handle(b), give: [x.id], get: [], note: 'hi' },
      { to: handle(b), give: [], get: [] },
      { to: handle(b), give: [x.id, x.id], get: [] },
      { to: handle(b), give: ['a', 'b', 'c', 'd'], get: [] },
      { to: handle(b), give: [x], get: [] },
      { to: handle(b), give: [x.id], get: [z.id], stats: { hp: 999, atk: 1, def: 1, spd: 1 } },
      { to: 'not a handle!', give: [x.id], get: [] },
    ]) assert.equal((await post('/v1/offers', body)).status, 400, JSON.stringify(body).slice(0, 60))
    assert.equal((await post('/v1/offers/bad*id/accept', {})).status, 400)
    assert.equal((await post('/v1/offers/abc/accept', { yes: true })).status, 400)
    assert.equal((await s.request('POST', '/v1/offers', { body: { to: handle(b), give: [x.id], get: [] } })).status, 401)
  })
})

describe('accepting', () => {
  it('swaps the cards at once with no fee and no lock, and lets nothing of the old owner travel', async () => {
    const { s, a, b, x, z } = await pair()
    await b.call('setTeam', { cardIds: [z.id] })
    // z has battled under b (arena counts, tired), which must not reach a
    await s.db.batch([stmt('UPDATE cards SET arena_opus = 7, arena_fable = 2, tired_until = ? WHERE id = ?', T0 + HOUR, z.id)])
    const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [z.id] })
    const [sa, sb] = [(await a.row()).sparks, (await b.row()).sparks]
    const versions = [(await a.row()).cards_version, (await b.row()).cards_version]
    const res = (await b.call('acceptOffer', { offerId: offer.id })).offer
    assert.deepEqual([res.state, res.from, res.to, res.give.map(c => c.id), res.get.map(c => c.id)], ['accepted', handle(a), handle(b), [x.id], [z.id]])
    assert.deepEqual([(await a.row()).sparks, (await b.row()).sparks], [sa, sb], 'no fee')
    for (const [p, id] of [[a, z.id], [b, x.id]] as const) {
      const c = (await cardIn(p, id))!
      assert.deepEqual([c.state, c.forTrade, c.tiredUntil, c.lockedUntil], ['owned', false, 0, 0], id)
      const r = await row(s, id)
      assert.deepEqual([r.owner_id, r.escrow_ref, r.arena_haiku, r.arena_sonnet, r.arena_opus, r.arena_fable], [p.id, null, 0, 0, 0, 0])
    }
    assert.equal(await cardIn(a, x.id), undefined)
    assert.deepEqual((await b.call('me')).player.team, [], 'a card traded away leaves the team')
    assert.ok((await a.row()).cards_version > versions[0]! && (await b.row()).cards_version > versions[1]!)
    const news = (await a.call('me')).notices.find(n => n.kind === 'offer-accepted')!
    assert.equal(news.handle, handle(b))
    // the album counts a species received, and a received card trades on at once
    assert.ok((await a.call('me')).player.seen.includes(z.species))
    assert.equal((await a.call('gift', { cardId: z.id })).gift.card.id, z.id)
    // and a repeat is refused cleanly
    assert.equal((await b.fails('acceptOffer', { offerId: offer.id })).code, 'conflict')
  })

  it('a pure gift-trade asks for nothing and costs nobody anything', async () => {
    const { a, b, x } = await pair()
    const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [] })
    const [sa, sb] = [(await a.row()).sparks, (await b.row()).sparks]
    await b.call('acceptOffer', { offerId: offer.id })
    assert.deepEqual([(await a.row()).sparks, (await b.row()).sparks], [sa, sb])
    assert.equal((await cardIn(b, x.id))!.state, 'owned')
  })

  it('goes through with no sparks at all, and is refused, with nothing moving, when a card is no longer free', async () => {
    const { s, a, b, x, y, z } = await pair()
    const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [z.id] })
    await s.db.batch([stmt('UPDATE players SET sparks = 0 WHERE id IN (?, ?)', a.id, b.id)])
    const other = (await a.call('offer', { to: handle(b), give: [y.id], get: [] })).offer
    assert.equal((await b.call('acceptOffer', { offerId: other.id })).offer.state, 'accepted', 'no fee to pay')
    // the card asked for is now held for b's own offer elsewhere
    await b.call('offer', { to: handle(a), give: [z.id], get: [] })
    assert.equal((await b.fails('acceptOffer', { offerId: offer.id })).code, 'not_allowed')
    // ...or gone altogether
    await b.call('cancelOffer', { offerId: (await b.call('me')).offers.outgoing[0]!.id })
    await b.call('recycle', { cardId: z.id })
    assert.equal((await b.fails('acceptOffer', { offerId: offer.id })).code, 'conflict')
    assert.equal((await cardIn(a, x.id))!.state, 'escrow', 'the offer stays open for a to cancel')
    assert.equal((await a.call('cancelOffer', { offerId: offer.id })).offer.state, 'cancelled')
    assert.equal((await cardIn(a, x.id))!.state, 'owned')
  })
})

describe('declining, cancelling and countering', () => {
  it('declining brings the sender’s cards home with word of it; repeats are conflicts', async () => {
    const { a, b, x, z } = await pair()
    const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [z.id] })
    const res = (await b.call('declineOffer', { offerId: offer.id })).offer
    assert.deepEqual([res.state, res.give.map(c => c.id), res.get.map(c => c.id)], ['declined', [x.id], [z.id]])
    assert.equal((await cardIn(a, x.id))!.state, 'owned')
    const news = (await a.call('me')).notices.find(n => n.kind === 'offer-declined')!
    assert.equal(news.handle, handle(b))
    assert.equal((await b.fails('declineOffer', { offerId: offer.id })).code, 'conflict')
    assert.equal((await b.fails('acceptOffer', { offerId: offer.id })).code, 'conflict')
    assert.equal((await b.fails('counterOffer', { offerId: offer.id, give: [z.id], get: [] })).code, 'conflict')
    assert.equal((await a.fails('cancelOffer', { offerId: offer.id })).code, 'conflict')
  })

  it('cancelling brings the caller’s cards home and simply leaves the receiver’s inbox', async () => {
    const { a, b, x } = await pair()
    const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [] })
    const noticesBefore = (await b.call('me')).notices.length
    assert.equal((await a.call('cancelOffer', { offerId: offer.id })).offer.state, 'cancelled')
    assert.equal((await cardIn(a, x.id))!.state, 'owned')
    const inbox = await b.call('me')
    assert.deepEqual([inbox.offers.incoming.length, inbox.notices.length], [0, noticesBefore])
    assert.equal((await b.fails('acceptOffer', { offerId: offer.id })).code, 'conflict')
  })

  it('a counter declines and sends the roles swapped, and may ask for the cards coming home', async () => {
    const { s, a, b, x, y, z } = await pair()
    const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [z.id] })
    // y is a's but not listed: a counter may not ask for it
    assert.equal((await b.fails('counterOffer', { offerId: offer.id, give: [z.id], get: [y.id] })).code, 'not_found')
    const counter = (await b.call('counterOffer', { offerId: offer.id, give: [z.id], get: [x.id] })).offer
    assert.deepEqual([counter.from, counter.to, counter.state, counter.give.map(c => c.id), counter.get.map(c => c.id)],
      [handle(b), handle(a), 'open', [z.id], [x.id]])
    assert.equal((await s.db.get<{ state: string }>('SELECT state FROM offers WHERE id = ?', offer.id))!.state, 'declined')
    assert.equal((await cardIn(a, x.id))!.state, 'owned', 'x came home')
    assert.equal((await cardIn(b, z.id))!.state, 'escrow')
    const me = await a.call('me')
    assert.deepEqual([me.offers.outgoing.length, me.offers.incoming.map(o => o.id)], [0, [counter.id]])
    assert.deepEqual(me.notices.filter(n => n.kind === 'offer-received').map(n => n.handle), [handle(b)])
    await a.call('acceptOffer', { offerId: counter.id })
    assert.equal((await cardIn(a, z.id))!.state, 'owned')
    assert.equal((await cardIn(b, x.id))!.state, 'owned')
  })
})

describe('expiry', () => {
  it('ends an offer at its midnight: accepting then says expired, and the cards are home with word of it', async () => {
    const { s, a, b, x, z } = await pair()
    const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [z.id] })
    s.set(offer.expiresAt - 1)
    assert.equal((await b.call('me')).offers.incoming.length, 1)
    s.set(offer.expiresAt)
    const err = await b.fails('acceptOffer', { offerId: offer.id })
    assert.deepEqual([err.status, err.code], [410, 'expired'])
    assert.equal((await cardIn(a, x.id))!.state, 'owned')
    const me = await a.call('me')
    assert.equal(me.offers.outgoing.length, 0)
    assert.equal(me.notices.find(n => n.kind === 'offer-expired')!.handle, handle(b))
  })

  it('settles at either side’s touch, and by the hourly sweep for players who never come back', async () => {
    const { s, a, b, x, y, z } = await pair()
    const one = (await a.call('offer', { to: handle(b), give: [x.id], get: [] })).offer
    s.set(one.expiresAt + HOUR)
    await a.call('me')
    assert.equal((await row(s, x.id)).state, 'owned', "the sender's touch")
    const two = (await a.call('offer', { to: handle(b), give: [y.id], get: [z.id] })).offer
    s.set(two.expiresAt + HOUR)
    await b.call('me')
    assert.equal((await row(s, y.id)).state, 'owned', "the receiver's touch")
    const [w] = await fresh(s, a, 1)
    const three = (await a.call('offer', { to: handle(b), give: [w!.id], get: [] })).offer
    s.set(three.expiresAt + HOUR)
    await s.app.sweep(s.now())
    assert.deepEqual([(await row(s, w!.id)).state, (await s.db.get<{ state: string }>('SELECT state FROM offers WHERE id = ?', three.id))!.state], ['owned', 'expired'])
    const notices = await s.db.all<{ kind: string }>(`SELECT kind FROM notices WHERE player_id = ? AND kind = 'offer-expired'`, a.id)
    assert.equal(notices.length, 3)
    // resolved offers go 30 days on (retention)
    s.tick(31 * DAY)
    await s.app.sweep(s.now())
    assert.equal((await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM offers'))!.n, 0)
  })
})

describe('races', () => {
  const settled = async (...calls: Promise<unknown>[]) => {
    const out = await Promise.allSettled(calls)
    return {
      ok: out.filter(r => r.status === 'fulfilled').length,
      codes: out.flatMap(r => (r.status === 'rejected' ? [(r.reason as ApiFailure).code] : [])),
    }
  }

  it('two accepts at once: one swap, one conflict', async () => {
    const { s, a, b, x, z } = await pair()
    const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [z.id] })
    const r = await settled(b.call('acceptOffer', { offerId: offer.id }), b.call('acceptOffer', { offerId: offer.id }))
    assert.deepEqual([r.ok, r.codes], [1, ['conflict']])
    assert.deepEqual([(await row(s, x.id)).owner_id, (await row(s, z.id)).owner_id], [b.id, a.id], 'swapped once')
  })

  it('accept against cancel: exactly one wins and every card ends up with exactly one owner', async () => {
    for (let i = 0; i < 4; i++) {
      const { s, a, b, x, z } = await pair()
      const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [z.id] })
      const r = await settled(b.call('acceptOffer', { offerId: offer.id }), a.call('cancelOffer', { offerId: offer.id }))
      assert.equal(r.ok, 1)
      const state = (await s.db.get<{ state: string }>('SELECT state FROM offers WHERE id = ?', offer.id))!.state
      const [rx, rz] = [await row(s, x.id), await row(s, z.id)]
      assert.deepEqual([rx.state, rz.state], ['owned', 'owned'])
      assert.deepEqual([rx.owner_id, rz.owner_id], state === 'accepted' ? [b.id, a.id] : [a.id, b.id])
    }
  })

  it('the same card offered to two players at once is held for one offer only', async () => {
    const { s, a, b, x } = await pair()
    const c = await s.join()
    const r = await settled(
      a.call('offer', { to: handle(b), give: [x.id], get: [] }),
      a.call('offer', { to: handle(c), give: [x.id], get: [] }),
    )
    assert.equal(r.ok, 1)
    assert.ok(['not_allowed', 'conflict'].includes(r.codes[0]!))
    const open = await s.db.all<{ id: string }>(`SELECT id FROM offers WHERE state = 'open'`)
    assert.equal(open.length, 1)
    assert.equal((await row(s, x.id)).escrow_ref, open[0]!.id)
  })

  it('a spend the sender began before an accept moved their row re-runs and goes through, never a server error', async () => {
    const held = holding()
    const { s, a, b, x, z } = await pair(server({ db: held.db }))
    const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [z.id] })
    const cost = ECONOMY.packs.buyCost
    await s.db.batch([stmt('UPDATE players SET sparks = ? WHERE id = ?', cost + 5, a.id)])
    // a's buy has read its row; b's accept moves a's row (its album) before the buy writes
    const gate = held.next(/INSERT INTO packs/)
    const buying = a.call('buyPack', { family: 'opus' })
    await gate.reached
    const v = (await a.row()).version
    await b.call('acceptOffer', { offerId: offer.id })
    assert.ok((await a.row()).version > v, 'the accept moved the sender\'s version')
    gate.release()
    await buying
    assert.equal((await a.row()).sparks, 5, 'no fee: the pack is all that was paid')
  })

  it('an accept and the sender spending their sparks both go through: there is no fee to race', async () => {
    const { s, a, b, x, z } = await pair()
    const { offer } = await a.call('offer', { to: handle(b), give: [x.id], get: [z.id] })
    await s.db.batch([stmt('UPDATE players SET sparks = 150 WHERE id = ?', a.id)])
    const r = await settled(b.call('acceptOffer', { offerId: offer.id }), a.call('buyPack', { family: 'opus' }))
    assert.deepEqual([r.ok, r.codes], [2, []])
    assert.equal((await a.row()).sparks, 0)
  })
})

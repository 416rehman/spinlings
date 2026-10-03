// The required social tests of SPEC 20.9 and 26.7: the authorization matrix (another player's
// offer, gift, listing or card is a 404 and changes nothing), exposure (anything about another
// player carries only the public fields) and enumeration (guessing reveals nothing beyond public
// profiles).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ApiOp, ApiRequest } from '../../plugin/hooks/core/api.ts'
import { DAY_RE } from '../../plugin/hooks/core/schemas.ts'
import { stmt } from '../../server/src/db.ts'
import { base32 } from '../../server/src/game/ctx.ts'
import { HOUR, server } from './scaffold-helpers.ts'
import type { Player } from './scaffold-helpers.ts'
import { assertNoIds, assertPublic, fresh, list, midnight, snapshot, trust } from './social-helpers.ts'

const handle = (p: Player) => p.me.player.handle

/** a sent b an offer, holds an open gift and a market listing wanting a card; m is a third player with cards of their own. */
async function world() {
  const s = server()
  const [a, b, m] = [await s.join(), await s.join(), await s.join()]
  await trust(s, a, b, m)
  const [x, y, g, l] = await fresh(s, a, 4)
  const [z] = await fresh(s, b, 1)
  const [mc] = await fresh(s, m, 1)
  await list(a, y!)
  await list(b, z!)
  const { offer } = await a.call('offer', { to: handle(b), give: [x!.id], get: [z!.id] })
  const { gift } = await a.call('gift', { cardId: g!.id })
  const { listing } = await a.call('listCard', { cardId: l!.id, price: 5, want: { rarity: 'common' } })
  for (const p of [a, b, m]) await p.call('me') // today's touch done, so a refused call writes nothing
  return { s, a, b, m, x: x!, y: y!, z: z!, mc: mc!, offer, gift, listing }
}

describe('the authorization matrix (SPEC 26.7)', () => {
  it("answers 404 to anyone acting on another player's offer, gift or card, and changes nothing", async () => {
    const { s, a, b, m, x, y, z, mc, offer, gift, listing } = await world()
    type Case = [Player, ApiOp, unknown, string]
    const cases: Case[] = [
      [m, 'acceptOffer', { offerId: offer.id }, 'a stranger accepting'],
      [m, 'declineOffer', { offerId: offer.id }, 'a stranger declining'],
      [m, 'counterOffer', { offerId: offer.id, give: [mc.id], get: [] }, 'a stranger countering'],
      [m, 'cancelOffer', { offerId: offer.id }, 'a stranger cancelling'],
      [a, 'acceptOffer', { offerId: offer.id }, 'the sender accepting their own offer'],
      [a, 'declineOffer', { offerId: offer.id }, 'the sender declining their own offer'],
      [a, 'counterOffer', { offerId: offer.id, give: [y.id], get: [] }, 'the sender countering their own offer'],
      [b, 'cancelOffer', { offerId: offer.id }, 'the receiver cancelling'],
      [m, 'cancelGift', { code: gift.code }, "a stranger taking back a's gift"],
      [b, 'cancelGift', { code: gift.code }, "the other trader taking back a's gift"],
      [m, 'gift', { cardId: y.id }, "a stranger gifting a's card"],
      [m, 'offer', { to: handle(b), give: [y.id], get: [] }, "a stranger offering a's card"],
      [m, 'offer', { to: handle(a), give: [mc.id], get: [z.id] }, "asking a for b's card"],
      [m, 'offer', { to: handle(b), give: [mc.id], get: [x.id] }, "asking b for a's card"],
      [m, 'cancelListing', { listingId: listing.id }, "a stranger taking a's card off the market"],
      [b, 'cancelListing', { listingId: listing.id }, "another trader taking a's card off the market"],
      [m, 'listCard', { cardId: y.id, price: 5 }, "a stranger listing a's card"],
      [m, 'buyListing', { listingId: listing.id, cardId: z.id }, "paying for a's listing with b's card"],
      [b, 'buyListing', { listingId: listing.id, cardId: y.id }, "paying a with a's own card"],
    ]
    for (const [p, op, req, what] of cases) {
      const before = await snapshot(s.db)
      const err = await p.fails(op, req as ApiRequest<typeof op>)
      assert.deepEqual([err.status, err.code], [404, 'not_found'], what)
      assert.deepEqual(await snapshot(s.db), before, `${what}: every table unchanged`)
    }
    // and the rightful parties still can
    assert.equal((await b.call('declineOffer', { offerId: offer.id })).offer.state, 'declined')
    assert.equal((await a.call('cancelGift', { code: gift.code })).gift.card.state, 'owned')
    assert.equal((await a.call('cancelListing', { listingId: listing.id })).listing.state, 'cancelled')
  })
})

describe('exposure (SPEC 20.3, 20.9)', () => {
  it('shows other players only handles, leagues, public battle cards, days, ratings on boards and public game counts', async () => {
    const { a, b, m, offer } = await world()
    await b.call('setLeaderboard', { optIn: true })
    const ids = [a.id, b.id, m.id]
    const answers: [string, unknown][] = []

    const profile = await m.call('profile', { handle: handle(a) })
    answers.push(['profile', profile])
    for (const c of [...profile.team, ...profile.forTrade]) assertPublic(c, 'profile')

    const top = (await m.call('leaderboard')).top
    answers.push(['leaderboard', top])
    for (const r of top) assert.deepEqual(Object.keys(r).sort(), ['handle', 'league', 'rating'])

    const market = await m.call('market', {})
    answers.push(['market', market])
    for (const l of market.listings) {
      assert.deepEqual(Object.keys(l).sort(), ['card', 'day', 'id', 'price', 'seller', 'state', 'want'])
      assert.match(l.day, DAY_RE)
      assertPublic(l.card, 'market')
    }
    const ranks = await m.call('rankings', { board: 'species' })
    answers.push(['rankings', ranks])
    for (const r of [...ranks.top, ...(ranks.me ? [ranks.me] : [])]) assert.deepEqual(Object.keys(r).sort(), ['handle', 'league', 'rank', 'value'])

    await m.call('setWishlist', { species: [] })
    const board = await m.call('board')
    answers.push(['board', board])
    for (const r of board.recent) {
      assert.deepEqual(Object.keys(r).sort(), ['card', 'handle'])
      assertPublic(r.card, 'board')
    }

    for (const p of [a, b]) {
      const me = await p.call('me')
      for (const o of [...me.offers.incoming, ...me.offers.outgoing]) {
        answers.push(['offer', o])
        for (const c of [...o.give, ...o.get]) assertPublic(c, 'offer')
        assert.ok(midnight(o.createdAt) && midnight(o.expiresAt), 'offers carry days, never times')
      }
      for (const n of me.notices) {
        answers.push(['notice', n])
        assert.match(n.day, DAY_RE)
        if (n.handle) assert.ok(!n.text.includes(n.handle), 'notice text names nobody')
      }
    }
    // the accepted view too
    answers.push(['accept', (await b.call('acceptOffer', { offerId: offer.id })).offer])
    for (const [where, body] of answers) {
      assertNoIds(body, ids, where)
      const json = JSON.stringify(body)
      for (const k of ['"joined', '"lastSeen', '"last_seen', '"battles"', '"wins"', '"losses"', '"sparks"', '"mintedAt"', '"lockedUntil"', '"tiredUntil"', '"origin"', '"arena']) {
        assert.ok(!json.includes(k), `${where} shows ${k}`)
      }
      if (where !== 'leaderboard') assert.ok(!json.includes('"rating"'), `${where} shows a rating`)
      assert.ok(!/"\w*(At|Until|Time)"/.test(json.replace(/"(createdAt|expiresAt)"/g, '')), `${where} shows a time`)
    }
  })
})

describe('what never links back to the player (SPEC 20.1-20.3)', () => {
  it('never shows anyone else where a card was raised: profile, pages, board, offers or a duel', async () => {
    const { s, a, b, m, y } = await world()
    // a's cards were raised under opus: the arena is the model a uses
    await s.db.batch([
      stmt(`UPDATE cards SET raised_in = 'opus', stage = 2, level = 4 WHERE owner_id = ?`, a.id),
      stmt('UPDATE players SET team_size = 0 WHERE id = ?', b.id), // so m's duel can only meet a
    ])
    await m.call('setWishlist', { species: [] })
    const duel = await m.call('startBattle', { kind: 'duel', family: 'haiku' })
    assert.deepEqual(duel.opponent, { kind: 'player', handle: handle(a), league: 'Pebble' })
    const seen: [string, unknown][] = [
      ['profile', await m.call('profile', { handle: handle(a) })],
      ['board', await m.call('board')],
      ['offers', (await b.call('me')).offers],
      ['duel', duel.setup.defender],
    ]
    for (const [where, body] of seen) assert.ok(!JSON.stringify(body).includes('raisedIn'), `${where} shows raisedIn`)
    for (const path of [`/u/${handle(a)}`, `/c/${y.id}`]) {
      const html = await (await s.request('GET', path, { client: null })).text()
      assert.doesNotMatch(html, /raised under|opus-raised/i, path)
    }
    assert.ok((await a.call('cards')).cards.every(c => c.raisedIn === 'opus'), 'the owner still sees their own')
  })

  it('leaves nothing that shows a rerolled handle beside the old one', async () => {
    const { a, b, offer } = await world()
    const old = handle(a)
    const { handle: renamed } = await a.call('rerollHandle', {})
    const me = await b.call('me')
    assert.ok(!JSON.stringify(me).includes(renamed), 'b only ever met the old handle')
    assert.equal(me.offers.incoming.find(o => o.id === offer.id)!.from, old, 'the open offer keeps the handle it was sent with')
    assert.ok(me.notices.every(n => n.handle === undefined), 'and its notice no longer names anyone')
    assert.equal((await b.call('acceptOffer', { offerId: offer.id })).offer.from, old)
  })

  it('names a receiver who rerolled on no news of an offer sent to the old handle: accepted, declined or expired', async () => {
    const { s, a, b, offer, y } = await world()
    const [w] = await fresh(s, a, 1)
    const declined = (await a.call('offer', { to: handle(b), give: [y.id], get: [] })).offer
    const lapsing = (await a.call('offer', { to: handle(b), give: [w!.id], get: [] })).offer
    const { handle: renamed } = await b.call('rerollHandle', {})
    await b.call('acceptOffer', { offerId: offer.id })
    await b.call('declineOffer', { offerId: declined.id })
    // b does nothing more: the sweep ends the last one
    s.set(lapsing.expiresAt + HOUR)
    await s.app.sweep(s.now())
    const me = await a.call('me')
    assert.deepEqual(
      me.notices.filter(n => n.kind.startsWith('offer-')).map(n => [n.kind, n.handle]).sort(),
      [['offer-accepted', undefined], ['offer-declined', undefined], ['offer-expired', undefined]],
    )
    assert.ok(!JSON.stringify(me).includes(renamed), 'a only ever met the old handle')
  })

  it('sends a counter-offer to the handle the offer came from, and names a sender who rerolled on no news of it', async () => {
    const { a, b, x, z, offer } = await world()
    const old = handle(a)
    const { handle: renamed } = await a.call('rerollHandle', {})
    const counter = (await b.call('counterOffer', { offerId: offer.id, give: [z.id], get: [x.id] })).offer
    assert.equal(counter.to, old, 'the counter keeps the handle b knows')
    assert.ok(!JSON.stringify(await b.call('me')).includes(renamed), 'b only ever met the old handle')
    // a answers it: b's news of that names nobody
    await a.call('acceptOffer', { offerId: counter.id })
    const me = await b.call('me')
    assert.deepEqual(me.notices.filter(n => n.kind === 'offer-accepted').map(n => n.handle), [undefined])
    assert.ok(!JSON.stringify(me).includes(renamed), 'b still only met the old handle')
  })
})

describe('enumeration (SPEC 26.7)', () => {
  it('guessed handles, offer ids and gift codes all look like nothing, under rate limits', async () => {
    const { s, m, offer, gift, listing } = await world()
    const bodyOf = async (method: string, path: string, body?: unknown) => {
      const res = await s.request(method, path, { token: m.token, ...(body ? { body } : {}) })
      return `${res.status} ${await res.text()}`
    }
    // a real offer that is not yours answers exactly like a made-up one
    const random = base32(crypto.getRandomValues(new Uint8Array(16)))
    assert.equal(await bodyOf('POST', `/v1/offers/${offer.id}/accept`, {}), await bodyOf('POST', `/v1/offers/${random}/accept`, {}))
    assert.equal(await bodyOf('POST', `/v1/gifts/${gift.code}/cancel`, {}), await bodyOf('POST', '/v1/gifts/quiet-otter-lamp-4821/cancel', {}))
    assert.equal(await bodyOf('POST', `/v1/market/${listing.id}/cancel`, {}), await bodyOf('POST', `/v1/market/${random}/cancel`, {}))
    // handles: 404s with one body, then the profile bucket runs dry
    const seen = new Set<string>()
    let limited = false
    for (let i = 0; i < 70 && !limited; i++) {
      const answer = await bodyOf('GET', `/v1/players/soft-otter-${10 + i}`)
      if (answer.startsWith('429')) limited = true
      else seen.add(answer)
    }
    assert.ok(limited, 'lookups are rate-limited')
    assert.equal(seen.size, 1)
    assert.match([...seen][0]!, /^404 /)
  })
})

// The wire contract, both ends at once: the real Node server booted in-process (node:http over
// node:sqlite), driven only through the mod's own RemoteBackend (client/remote.ts over client/net.ts:
// buildRequest, the strict request schemas, readAnswer and the tolerant response reader). Every one
// of the API_ROUTES operations must succeed at least once, every answer must be exactly what the
// client keeps (no undocumented field, no fallback), every error must arrive as a known code, and
// every request the mod sent must be exactly a documented shape (SPEC 20.9, 26, 32).
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { CLIENT_VERSION, createRemoteBackend } from '../../plugin/hooks/client/remote.ts'
import { BackendError } from '../../plugin/hooks/client/types.ts'
import { API_ROUTES } from '../../plugin/hooks/core/api.ts'
import type { ApiErrorCode, ApiOp, ApiRequest, OfferView } from '../../plugin/hooks/core/api.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { parseApiError, parsePathParam, parseRequest } from '../../plugin/hooks/core/schemas.ts'
import { familySpecies } from '../../plugin/hooks/core/species.ts'
import { traderGiveProblem } from '../../plugin/hooks/core/trader.ts'
import type { Card } from '../../plugin/hooks/core/types.ts'
import { seasonOf, utcDay } from '../../plugin/hooks/core/world.ts'
import { insertStmts, planDrop } from '../../scripts/admin/drop.ts'
import { battle, bootServer, connect, T0 } from '../../scripts/e2e.ts'
import type { Boot, Client, Wire } from '../../scripts/e2e.ts'
import { stmt } from '../../server/src/db.ts'
import { softAuthenticator } from '../server/passkeys-helpers.ts'

const DAY = 86_400_000
const ROUTE_RES = (Object.keys(API_ROUTES) as ApiOp[]).map(op => ({
  op, method: API_ROUTES[op].method, re: new RegExp('^' + API_ROUTES[op].path.replace(/:[A-Za-z]+/g, '[^/]+') + '$'),
}))

/** Which operation an exchange on the wire was. */
function opOf(w: Pick<Wire, 'method' | 'url'>): ApiOp | null {
  const path = new URL(w.url).pathname
  return ROUTE_RES.find(r => r.method === w.method && r.re.test(path))?.op ?? null
}

/** The page's data attributes, as the passkey script reads them. */
function pageData(html: string): { ticket: string; options: never } {
  const attr = (name: string) => {
    const m = new RegExp(`${name}="([^"]*)"`).exec(html)
    assert.ok(m, `the page carries ${name}`)
    return m[1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  }
  return { ticket: attr('data-ticket'), options: JSON.parse(attr('data-options')) as never }
}

describe('the wire contract: the mod\'s RemoteBackend against the real server', () => {
  let boot: Boot
  let a: Client, b: Client, c: Client
  const errors = new Map<ApiErrorCode, string>()

  /** A refusal, checked end to end: an exact ApiError body with a known code, read by the mod as that code. */
  async function refused<K extends ApiOp>(who: Client, op: K, req: ApiRequest<K>, code: ApiErrorCode, status: number) {
    const err = await who.fails(op, req, code)
    const last = who.wire.at(-1)!
    assert.equal(last.status, status, `${op}: HTTP ${status}`)
    assert.equal(err.status, status)
    const body = JSON.parse(last.text) as unknown
    assert.deepEqual(parseApiError(body), body, `${op}: the error body is exactly an ApiError`)
    assert.equal(last.answer['content-type'], 'application/json; charset=utf-8')
    errors.set(code, op)
    return err
  }

  /** Past the trust gate and rich, straight in the database: this suite checks shapes, the e2e run plays the days out. */
  const trust = (who: Client) => boot.db.batch([stmt('UPDATE players SET battles = 10, joined = ?, sparks = 5000 WHERE handle = ?', utcDay(T0 - 3 * DAY), handleOf(who))])
  const handles = new Map<Client, string>()
  const everyone: Client[] = []
  const handleOf = (who: Client) => handles.get(who)!
  const cards = async (who: Client) => (await who.call('cards', {})).cards
  const freeCards = async (who: Client) => {
    const team = (await who.me()).player.team
    return (await cards(who)).filter(x => !x.bound && x.state === 'owned' && x.lockedUntil <= boot.clock.now() && !team.includes(x.id))
  }

  before(async () => {
    boot = await bootServer({ difficulty: 8 })
    a = connect(boot, 'a', 'opus')
    b = connect(boot, 'b', 'haiku')
    c = connect(boot, 'c', 'fable')
    everyone.push(a, b, c)
  })
  after(async () => { await boot.close() })

  it('public operations: version, world, a frozen season, challenge and join', async () => {
    const v = await a.call('version', {})
    assert.equal(v.api, 1)
    await a.call('world', {})
    const s = await a.call('season', { season: seasonOf(boot.clock.now()) })
    assert.equal(s.species.length, 36)
    await refused(a, 'season', { season: seasonOf(boot.clock.now()) + 1 }, 'not_found', 404)
    for (const who of [a, b]) handles.set(who, (await who.join()).player.handle)
  })

  it('the caller\'s own state: me, cards, devices, team, wishlist, leaderboard and handle', async () => {
    const me = await a.me()
    assert.equal(me.now, boot.clock.now())
    assert.equal((await cards(a)).length, 3)
    assert.deepEqual(await a.call('devices', {}), { sessions: 1, passkeys: 0 })
    const team = me.player.team
    assert.deepEqual((await a.call('setTeam', { cardIds: [...team].reverse() })).team, [...team].reverse())
    const wish = familySpecies(1, 'fable').slice(0, 2).map(s => s.id)
    assert.deepEqual((await a.call('setWishlist', { species: wish })).wishlist, wish)
    assert.deepEqual(await a.call('setLeaderboard', { optIn: true }), { leaderboard: true })
    assert.deepEqual((await b.call('leaderboard', {})).top.map(r => r.handle), [handleOf(a)])
    const renamed = await a.call('rerollHandle', {})
    handles.set(a, renamed.handle)
    await refused(a, 'rerollHandle', {}, 'rate_limited', 429)
    assert.ok(Number(a.wire.at(-1)!.answer['retry-after']) > 0, 'a wait comes with Retry-After')
  })

  it('packs: buy (and too few sparks), charge (and too soon), open', async () => {
    await refused(a, 'buyPack', { family: 'opus' }, 'insufficient_sparks', 409)
    boot.clock.tick(ECONOMY.packs.chargeSpacingMs)
    const charged = await a.call('chargePack', { family: 'opus' })
    assert.equal(charged.packs.length, 3)
    await refused(a, 'chargePack', { family: 'opus' }, 'rate_limited', 429)
    await trust(a)
    await trust(b)
    for (let i = 0; i < 3; i++) await a.call('buyPack', { family: 'sonnet' })
    for (const p of (await a.me()).packs) assert.equal((await a.call('openPack', { packId: p.id })).cards.length, 5)
    for (const p of (await b.me()).packs) await b.call('openPack', { packId: p.id })
    for (let i = 0; i < 2; i++) await b.call('buyPack', { family: 'fable' })
    for (const p of (await b.me()).packs) await b.call('openPack', { packId: p.id })
    await refused(a, 'openPack', { packId: 'nosuchpackanywhere00000000' }, 'not_found', 404)
  })

  it('battles: a wild win with its catch, a Rival duel, and the minimum duration', async () => {
    let caught = false
    for (let i = 0; i < 12 && !caught; i++) {
      boot.clock.until((await a.me()).player.nextWildAt)
      const { start, fin } = await battle(boot, a, 'wild', { early: i === 0 })
      if (fin.catchOptions.length) {
        await a.call('catchCreature', { battleId: start.id, index: 0 })
        caught = true
        await refused(a, 'catchCreature', { battleId: start.id, index: 0 }, 'conflict', 409)
      }
    }
    assert.ok(caught)
    boot.clock.until((await a.me()).player.nextDuelAt)
    const duel = await battle(boot, a, 'duel')
    assert.ok(['player', 'rival'].includes(duel.start.opponent.kind))
    assert.deepEqual(await a.call('finishBattle', { battleId: duel.start.id, inputs: [] }), duel.fin, 'a finish asked again answers the same')
    await refused(b, 'finishBattle', { battleId: duel.start.id, inputs: [] }, 'not_found', 404)
  })

  it('cards: fuse, recycle, craft, for-trade (and the refusals)', async () => {
    const [x, y, z] = await freeCards(a)
    await refused(a, 'fuse', { cardId: x!.id, otherId: x!.id }, 'bad_request', 400)
    const fused = await a.call('fuse', { cardId: x!.id, otherId: y!.id })
    assert.equal(fused.card.form?.kind, 'fusion')
    const r = await a.call('recycle', { cardId: z!.id })
    assert.ok(r.gained > 0)
    const bound = (await cards(a)).find(k => k.bound)!
    await refused(a, 'recycle', { cardId: bound.id }, 'not_allowed', 403)
    const species = familySpecies(seasonOf(boot.clock.now()), 'opus')
    await a.call('craft', { speciesId: species.find(s => !s.legendary)!.id, rarity: 'common' })
    await refused(a, 'craft', { speciesId: species.find(s => !s.legendary)!.id, rarity: 'legendary' }, 'bad_request', 400)
    const listed = (await freeCards(a))[0]!
    assert.equal((await a.call('setForTrade', { cardId: listed.id, forTrade: true })).card.forTrade, true)
    assert.equal((await a.call('setForTrade', { cardId: listed.id, forTrade: false })).card.forTrade, false)
  })

  it('the Wandering Trader: today\'s deals and one paid for', async () => {
    let paid = false
    for (let day = 0; day < 8 && !paid; day++, boot.clock.tick(DAY)) {
      const { deals } = await a.call('trader', {})
      const pool = (await freeCards(a)).filter(k => k.species !== 'mythic')
      for (const deal of deals) {
        const give = pool.filter(k => (!deal.give.family || k.family === deal.give.family) && (!deal.give.rarity || k.rarity === deal.give.rarity)).slice(0, deal.give.count)
        if (traderGiveProblem(deal, give, boot.clock.now())) continue
        const got = await a.call('traderDeal', { dealId: deal.id, cardIds: give.map(k => k.id) })
        assert.deepEqual(got.consumed, give.map(k => k.id))
        await refused(a, 'traderDeal', { dealId: deal.id, cardIds: give.map(k => k.id) }, 'conflict', 409)
        paid = true
        break
      }
    }
    assert.ok(paid, 'a deal could be paid within a week')
  })

  it('players: profile, board, offers (decline, cancel, counter, accept, expire), gifts and claims', async () => {
    const mine = (await freeCards(a)).filter(k => k.species.startsWith('s'))
    const theirs = (await freeCards(b)).filter(k => k.species.startsWith('s') && !mine.some(m => m.species === k.species))
    const [m1, m2, m3] = mine
    const [t1] = theirs
    await b.call('setForTrade', { cardId: t1!.id, forTrade: true })
    await a.call('setForTrade', { cardId: m1!.id, forTrade: true })
    await a.call('setWishlist', { species: [t1!.species] })
    await b.call('setWishlist', { species: [m1!.species] })
    const profile = await a.call('profile', { handle: handleOf(b) })
    assert.ok(profile.forTrade.some(k => k.id === t1!.id))
    await refused(a, 'profile', { handle: 'nobody-here-00' }, 'not_found', 404)
    const board = await a.call('board', {})
    assert.equal(board.matches[0]?.theirs.id, t1!.id)

    const send = async (give: Card[], get: Card[]): Promise<OfferView> =>
      (await a.call('offer', { to: handleOf(b), give: give.map(k => k.id), get: get.map(k => k.id) })).offer
    const declined = await send([m2!], [])
    assert.equal((await b.call('declineOffer', { offerId: declined.id })).offer.state, 'declined')
    await refused(b, 'declineOffer', { offerId: declined.id }, 'conflict', 409)
    const cancelled = await send([m2!], [])
    await refused(b, 'cancelOffer', { offerId: cancelled.id }, 'not_found', 404)
    assert.equal((await a.call('cancelOffer', { offerId: cancelled.id })).offer.state, 'cancelled')
    const countered = await send([m2!], [t1!])
    const counter = (await b.call('counterOffer', { offerId: countered.id, give: [t1!.id], get: [m1!.id] })).offer
    assert.equal(counter.from, handleOf(b))
    const [sa, sb] = [(await a.me()).player.sparks, (await b.me()).player.sparks]
    assert.equal((await a.call('acceptOffer', { offerId: counter.id })).offer.state, 'accepted')
    assert.equal((await a.me()).player.sparks, sa - ECONOMY.trade.fee)
    assert.equal((await b.me()).player.sparks, sb - ECONOMY.trade.fee)
    const lapsing = await send([m3!], [])
    boot.clock.tick(4 * DAY)
    await refused(b, 'acceptOffer', { offerId: lapsing.id }, 'expired', 410)

    const g1 = (await a.call('gift', { cardId: m2!.id })).gift
    assert.equal((await a.call('cancelGift', { code: g1.code })).gift.code, g1.code)
    await refused(a, 'cancelGift', { code: g1.code }, 'conflict', 409)
    const g2 = (await a.call('gift', { cardId: m2!.id })).gift
    handles.set(c, (await c.join()).player.handle)
    await refused(c, 'claim', { code: 'quiet-otter-lamp-0000' }, 'not_found', 404)
    assert.equal((await c.call('claim', { code: g2.code })).card.id, m2!.id)
  })

  it('drops: a code redeemed once, then refused', async () => {
    const plan = planDrop({ code: 'CONTRACT', reward: { type: 'pack', count: 1 }, starts: boot.clock.now() - DAY, ends: boot.clock.now() + 30 * DAY },
      { now: boot.clock.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) })
    await boot.db.batch(insertStmts(plan.rows))
    const got = await c.call('redeem', { code: 'contract' })
    assert.deepEqual(got.packs.map(p => p.source), ['promo'])
    await refused(c, 'redeem', { code: 'CONTRACT' }, 'conflict', 409)
  })

  it('passkeys: save one from the add page, sign in with it from another machine, reset access', async () => {
    const auth = await softAuthenticator()
    const add = await b.call('passkeyStart', {})
    assert.ok(add.url.startsWith(boot.origin + '/passkey/add?t='), 'the page is on the server\'s own origin')
    const page = pageData(await (await fetch(add.url)).text())
    const posted = await fetch(`${boot.origin}/passkey/add/finish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: page.ticket, ...(await auth.create(page.options, boot.origin)) }),
    })
    assert.equal(posted.status, 200)
    assert.deepEqual(await b.call('authPoll', { pollId: add.pollId }), { status: 'added' })

    const laptop = connect(boot, 'b-laptop', 'haiku')
    everyone.push(laptop)
    const start = await laptop.call('authStart', {})
    assert.deepEqual(await laptop.call('authPoll', { pollId: start.pollId }), { status: 'pending' })
    const signin = pageData(await (await fetch(start.url)).text())
    const finished = await fetch(`${boot.origin}/passkey/signin/finish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: signin.ticket, ...(await auth.get(signin.options, boot.origin)) }),
    })
    assert.equal(finished.status, 200)
    const done = await laptop.call('authPoll', { pollId: start.pollId })
    assert.equal(done.status, 'done')
    assert.ok(done.status === 'done' && done.me.player.handle === handleOf(b))
    laptop.token = done.status === 'done' ? done.token : null
    await refused(laptop, 'authPoll', { pollId: start.pollId }, 'not_found', 404)
    assert.deepEqual(await laptop.call('devices', {}), { sessions: 2, passkeys: 1 })
    assert.ok((await b.me()).notices.some(n => n.kind === 'new-device'))

    const old = b.token
    const { token } = await laptop.call('resetToken', {})
    await refused(b, 'me', {}, 'unauthorized', 401)
    b.token = token
    assert.deepEqual(await b.call('devices', {}), { sessions: 1, passkeys: 0 }, 'reset access ends every way in, passkeys too')
    assert.notEqual(old, token)
  })

  it('an old mod is refused with upgrade_required, except the version handshake', async () => {
    const strict = await bootServer({ difficulty: 8, minClient: '9.0.0' })
    try {
      const old = connect(strict, 'old', 'opus')
      old.token = 'a'.repeat(64)
      assert.equal((await old.call('version', {})).minClient, '9.0.0')
      await refused(old, 'me', {}, 'upgrade_required', 426)
    } finally {
      await strict.close()
    }
  })

  it('a full bank is cap_reached', async () => {
    await trust(c)
    for (let i = 0; i < ECONOMY.packs.bank; i++) await c.call('buyPack', { family: 'fable' })
    boot.clock.tick(DAY)
    await refused(c, 'chargePack', { family: 'fable' }, 'cap_reached', 429)
  })

  it('deleting the account ends every session', async () => {
    assert.deepEqual(await c.call('deleteMe', {}), { deleted: true })
    await refused(c, 'me', {}, 'unauthorized', 401)
  })

  it('every operation answered successfully at least once', () => {
    const ok = new Set<ApiOp>()
    for (const who of everyone) for (const w of who.wire) if (w.status >= 200 && w.status < 300) ok.add(opOf(w)!)
    const all = Object.keys(API_ROUTES) as ApiOp[]
    assert.deepEqual(all.filter(op => !ok.has(op)), [], 'operations never exercised')
    for (const code of ['bad_request', 'unauthorized', 'not_allowed', 'not_found', 'conflict', 'insufficient_sparks', 'expired', 'rate_limited', 'cap_reached', 'upgrade_required'] as const) {
      assert.ok(errors.has(code), `the ${code} refusal was seen`)
    }
  })

  it('every request the mod sent was exactly a documented shape, with the token only where it belongs', () => {
    for (const who of everyone) {
      for (const w of who.wire) {
        const op = opOf(w)
        assert.ok(op, `${w.method} ${w.url} is an API operation`)
        assert.equal(w.headers['x-spinlings-client'], CLIENT_VERSION)
        assert.equal('authorization' in w.headers, API_ROUTES[op].auth, `${op}: the token rides only on authenticated routes`)
        assert.ok(!Object.keys(w.headers).some(h => h === 'cookie'))
        for (const [k, v] of new URL(w.url).searchParams) {
          assert.ok(API_ROUTES[op].query?.includes(k), `${op}: ?${k} is a documented query field`)
          assert.equal(parsePathParam(k, v), v)
        }
        if (w.body === undefined) {
          assert.ok(w.method === 'GET' || w.method === 'DELETE')
          continue
        }
        const body = JSON.parse(w.body) as unknown
        assert.deepEqual(parseRequest(op, body), body, `${op}: the body is exactly its request schema`)
      }
    }
  })

  it('the server logged no unexpected error', () => {
    assert.deepEqual(boot.errors, [])
  })
})

describe('the mod refuses what it must not send or accept', () => {
  it('an unauthenticated route never carries the token, and a request the schema refuses never leaves', async () => {
    const boot = await bootServer({ difficulty: 8 })
    try {
      const sent: string[] = []
      const api = createRemoteBackend({
        origin: boot.origin,
        fetch: async (url, init) => {
          sent.push(url)
          const res = await fetch(url, init)
          const headers: Record<string, string> = {}
          res.headers.forEach((v, k) => { headers[k] = v })
          return { status: res.status, ok: res.ok, headers, text: await res.text() }
        },
        token: async () => 'b'.repeat(64),
        now: async () => boot.clock.now(),
        after: () => ({ cancel() {} }),
        sent: () => {},
      })
      await assert.rejects(api.call('setTeam', { cardIds: ['x'], extra: 1 } as never), (e: unknown) => e instanceof BackendError && e.code === 'bad_request')
      await assert.rejects(api.call('profile', { handle: '../me' }), (e: unknown) => e instanceof BackendError && e.code === 'bad_request')
      assert.deepEqual(sent, [], 'nothing was sent')
      await api.call('world', {})
      await assert.rejects(api.call('me', {}), (e: unknown) => e instanceof BackendError && e.code === 'unauthorized')
    } finally {
      await boot.close()
    }
  })
})

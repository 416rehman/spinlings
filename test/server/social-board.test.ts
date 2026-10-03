// What players see of each other (SPEC 8, 19, 20.3, 26.4): profiles by exact handle, the opt-in
// leaderboard and the trade board with its matches, recent listings and the Wandering Trader.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { leagueOf } from '../../plugin/hooks/core/economy.ts'
import { stmt } from '../../server/src/db.ts'
import { MINUTE, server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'
import { assertNoIds, assertPublic, fresh, list, trust } from './social-helpers.ts'

const handle = (p: Player) => p.me.player.handle
const asleep = (s: Server, ...players: Player[]) => s.db.batch(players.map(p => stmt(`UPDATE players SET last_seen = '2026-09-10' WHERE id = ?`, p.id)))

describe('profiles', () => {
  it('show exactly the handle, league, team, cards on the trade list and the album count', async () => {
    const s = server()
    const [a, b] = [await s.join(), await s.join('sonnet')]
    await trust(s, b)
    const [w, held] = await fresh(s, b, 2)
    await list(b, w!, held!)
    await b.call('offer', { to: handle(a), give: [held!.id], get: [] })
    await s.db.batch([stmt('UPDATE players SET rating = 1350 WHERE id = ?', b.id)])
    const profile = await a.call('profile', { handle: handle(b) })
    assert.deepEqual(Object.keys(profile).sort(), ['forTrade', 'handle', 'league', 'seenCount', 'team'])
    const team = (await b.call('me')).player.team
    const album = (await b.call('me')).player.seen.length
    assert.deepEqual([profile.handle, profile.league, profile.team.map(c => c.id), profile.forTrade.map(c => c.id), profile.seenCount],
      [handle(b), 'Grove', team, [w!.id], album])
    for (const c of [...profile.team, ...profile.forTrade]) assertPublic(c, 'profile')
    assertNoIds(profile, [a.id, b.id], 'profile')
    assert.ok(!JSON.stringify(profile).includes('1350'), 'no rating')
    assert.equal((await a.call('profile', { handle: handle(a) })).handle, handle(a), 'your own public profile')
  })

  it('are found by exact handle only: a rerolled or deleted handle is a 404 like one that never existed', async () => {
    const s = server()
    const [a, b, c] = [await s.join(), await s.join(), await s.join()]
    const old = handle(b)
    const fresh = (await b.call('rerollHandle', {})).handle
    await c.call('deleteMe')
    const bodies = new Set<string>()
    for (const h of [old, handle(c), 'never-was-here-12', old.toUpperCase()]) {
      const res = await s.request('GET', `/v1/players/${h}`, { token: a.token })
      assert.equal(res.status, 404, h)
      bodies.add(await res.text())
    }
    assert.equal(bodies.size, 1)
    assert.equal((await a.call('profile', { handle: fresh })).handle, fresh)
    assert.equal((await s.request('GET', '/v1/players/bad%20handle', { token: a.token })).status, 400)
    assert.equal((await s.request('GET', `/v1/players/${fresh}`)).status, 401)
  })

  it('cost a profile token per lookup: 60 a minute, shared with offers by handle', async () => {
    const s = server()
    const [a, b] = [await s.join(), await s.join()]
    for (let i = 0; i < 60; i++) await a.fails('profile', { handle: `nobody-here-${i}` })
    const limited = await a.fails('profile', { handle: handle(b) })
    assert.deepEqual([limited.status, limited.code], [429, 'rate_limited'])
    assert.equal((await a.fails('offer', { to: handle(b), give: ['x'], get: [] })).status, 429)
    s.tick(MINUTE)
    assert.equal((await a.call('profile', { handle: handle(b) })).handle, handle(b))
  })
})

describe('the leaderboard', () => {
  it('lists only players who opted in, best first, with handle, league and rating', async () => {
    const s = server()
    const [a, b, c] = [await s.join(), await s.join(), await s.join()]
    await s.db.batch([
      stmt('UPDATE players SET rating = 1200 WHERE id = ?', a.id),
      stmt('UPDATE players SET rating = 1750 WHERE id = ?', b.id),
      stmt('UPDATE players SET rating = 1900 WHERE id = ?', c.id),
    ])
    assert.deepEqual((await a.call('leaderboard')).top, [])
    await a.call('setLeaderboard', { optIn: true })
    await b.call('setLeaderboard', { optIn: true })
    const { top } = await c.call('leaderboard')
    assert.deepEqual(top, [
      { handle: handle(b), league: leagueOf(1750).name, rating: 1750 },
      { handle: handle(a), league: leagueOf(1200).name, rating: 1200 },
    ])
    await a.call('setLeaderboard', { optIn: false })
    assert.deepEqual((await c.call('leaderboard')).top.map(r => r.handle), [handle(b)])
  })
})

describe('the trade board', () => {
  const [S1, S2, S3] = ['s1-haiku-0', 's1-opus-1', 's1-fable-2']

  /** a wishes for S1 and lists an S2; b lists an S1 and wishes for S2: a match. */
  async function market() {
    const s = server()
    const [a, b, c, d] = [await s.join(), await s.join(), await s.join(), await s.join()]
    await trust(s, a, b, c, d)
    const [mine] = await fresh(s, a, 1, { species: S2 })
    const [theirs, weaker] = await fresh(s, b, 2, { species: S1 })
    await list(a, mine!)
    await list(b, theirs!, weaker!)
    await s.db.batch([stmt('UPDATE cards SET power = 1 WHERE id = ?', weaker!.id)])
    await a.call('setWishlist', { species: [S1, S3] })
    await b.call('setWishlist', { species: [S2] })
    return { s, a, b, c, d, mine: mine!, theirs: theirs! }
  }

  it("matches: their listed card I wish for, my listed card they wish for, one pair per player", async () => {
    const { s, a, b, c, d, mine, theirs } = await market()
    // c lists an S1 but wants nothing a lists; d would match but has not been seen for weeks
    const [cs] = await fresh(s, c, 1, { species: S1 })
    await list(c, cs!)
    await c.call('setWishlist', { species: [S3] })
    const [ds] = await fresh(s, d, 1, { species: S1 })
    await list(d, ds!)
    await d.call('setWishlist', { species: [S2] })
    await asleep(s, d)
    const board = await a.call('board')
    assert.deepEqual(board.matches.map(m => [m.handle, m.theirs.id, m.mine.id]), [[handle(b), theirs.id, mine.id]])
    assert.deepEqual(board.recent, [], 'recent listings only when nothing matches')
    for (const m of board.matches) {
      assertPublic(m.theirs, 'match')
      assertPublic(m.mine, 'match')
    }
    assertNoIds(board, [a.id, b.id, c.id, d.id], 'board')
    // the other way round, b sees a
    assert.deepEqual((await b.call('board')).matches.map(m => [m.handle, m.theirs.id, m.mine.id]), [[handle(a), mine.id, theirs.id]])
  })

  it("recent listings when nothing matches: active players only, at most 2 each, never the caller's", async () => {
    const { s, a, b, c, d } = await market()
    await a.call('setWishlist', { species: [] })
    const [cs] = await fresh(s, c, 1)
    await list(c, cs!)
    const [ds] = await fresh(s, d, 1)
    await list(d, ds!)
    const [more] = await fresh(s, b, 1)
    await list(b, more!)
    await asleep(s, d)
    const board = await a.call('board')
    assert.deepEqual(board.matches, [])
    const by = (p: Player) => board.recent.filter(r => r.handle === handle(p)).length
    assert.deepEqual([by(a), by(b), by(c), by(d)], [0, 2, 1, 0])
    for (const r of board.recent) assertPublic(r.card, 'recent')
    assertNoIds(board, [a.id, b.id, c.id, d.id], 'board')
  })

  it("always carries today's Wandering Trader deals, as GET /v1/trader shows them", async () => {
    const { a } = await market()
    const board = await a.call('board')
    assert.equal(board.trader.length, 3)
    assert.deepEqual(board.trader, (await a.call('trader')).deals)
  })

  it('never orders players by when they were last seen', async () => {
    const s = server()
    const a = await s.join()
    await trust(s, a)
    await a.call('setWishlist', { species: [S1] })
    const [mine] = await fresh(s, a, 1, { species: S2 })
    await list(a, mine!)
    const others: Player[] = []
    for (let i = 0; i < 6; i++) {
      const p = await s.join()
      await trust(s, p)
      const [c] = await fresh(s, p, 1, { species: S1 })
      await list(p, c!)
      await p.call('setWishlist', { species: [S2] })
      others.push(p)
    }
    await s.db.batch(others.map((p, i) => stmt('UPDATE players SET last_seen = ? WHERE id = ?', `2026-09-${20 + i}`, p.id)))
    const orders = new Set<string>()
    for (let i = 0; i < 8; i++) orders.add((await a.call('board')).matches.map(m => m.handle).join(' '))
    assert.ok(orders.size > 1, 'the order changes from call to call')
    assert.equal([...orders][0]!.split(' ').length, 6)
  })
})

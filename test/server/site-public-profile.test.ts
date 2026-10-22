// Routed public camps: complete held-card browsing, midnight-only stats, and no private owner fields.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cardName, stageFor } from '../../plugin/hooks/core/cards.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import type { Card } from '../../plugin/hooks/core/types.ts'
import { seasonOf, utcDay } from '../../plugin/hooks/core/world.ts'
import { stmt } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { publish } from '../../server/src/game/stats.ts'
import { PROFILE_CSP } from '../../server/src/pages-profile.ts'
import { PUBLIC_INVENTORY_PAGE } from '../../server/src/public-collection.ts'
import { DAY, server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const handle = (p: Player) => p.me.player.handle
const textOf = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const collection = (html: string) => html.slice(html.indexOf('id="collection"'), html.indexOf('</section>', html.indexOf('id="collection"')))
const ids = (html: string) => [...collection(html).matchAll(/<a\b[^>]*class="cardlink"[^>]*href="\/c\/([a-z2-7]{26})"/g)].map(match => match[1]!)
const next = (html: string) => collection(html).match(/<a\b[^>]*rel="next"[^>]*href="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&')
let addresses = 0

async function get(s: Server, path: string) {
  const response = await s.request('GET', path, { client: null, ip: `198.51.100.${++addresses}` })
  return { response, html: await response.text() }
}

async function setup(n = 65) {
  const s = server(), owner = await s.join(), other = await s.join('opus')
  await s.db.batch([stmt('DELETE FROM cards WHERE owner_id = ?', owner.id), stmt(`UPDATE players SET team = '[]', team_size = 0 WHERE id = ?`, owner.id)])
  const minted = await mintCards({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }, owner.id,
    Array.from({ length: n }, (_, i) => {
      const level = 1 + i % 9
      return { ...mintFor(i < 55 ? 'haiku' : 'opus', 'rare', rngFromSeed(`public-profile/${i}`), s.now(), 'pack'), level, stage: stageFor(level) }
    }))
  await s.db.batch(minted.stmts)
  const cards = (await owner.call('cards')).cards
  await owner.call('setTeam', { cardIds: cards.slice(0, 3).map(card => card.id) })
  return { s, owner, other, cards }
}

const pathFor = (p: Player) => '/u/' + encodeURIComponent(handle(p))
const ordered = (cards: Card[]) => [...cards].sort((a, b) => cardName(a).toLowerCase().localeCompare(cardName(b).toLowerCase()) || a.id.localeCompare(b.id))

describe('the public profile route', () => {
  it('shows and pages the entire collection beyond team and trade pins, with ordinary clickable card links', async () => {
    const { s, owner, other, cards } = await setup()
    const oldProfile = await owner.call('profile', { handle: handle(owner) })
    assert.equal(oldProfile.team.length, 3); assert.deepEqual(oldProfile.forTrade, [])
    const before = await owner.row()
    let path: string | undefined = pathFor(owner)
    const found: string[] = []
    while (path) {
      const { response, html } = await get(s, path)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-security-policy'), PROFILE_CSP)
      assert.equal(response.headers.get('set-cookie'), null)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.match(html, /noindex/)
      assert.ok(html.includes('id="collection"') && html.includes('id="team"'))
      assert.doesNotMatch(textOf(html), /achievements?/i, 'no invented achievement system')
      const shown = ids(html)
      assert.ok(shown.length <= PUBLIC_INVENTORY_PAGE)
      found.push(...shown)
      path = next(html)
      if (path) {
        const url = new URL(path, 'http://localhost:8787')
        assert.equal(url.origin, 'http://localhost:8787')
        assert.equal(url.pathname, pathFor(owner)); assert.equal(url.hash, '#collection')
        assert.ok(url.searchParams.get('after'))
      }
    }
    assert.deepEqual(found, ordered(cards).map(card => card.id))
    assert.equal(new Set(found).size, cards.length)
    assert.ok(cards.slice(3).every(card => found.includes(card.id)), 'unlisted cards beyond the three team slots are visible')
    const foreign = (await other.call('cards')).cards.map(card => card.id)
    assert.ok(found.every(id => !foreign.includes(id)))
    assert.deepEqual(await owner.row(), before, 'visiting a camp does not touch activity or game state')
    assert.deepEqual(await owner.call('profile', { handle: handle(owner) }), oldProfile, 'the strict v1 profile stays unchanged')
  })

  it('applies filters before paging and carries safe family/sort links through next and first pages', async () => {
    const { s, owner, cards } = await setup()
    let path: string | undefined = pathFor(owner) + '?family=haiku&sort=level'
    const found: string[] = []
    let page = 0
    while (path) {
      const { response, html } = await get(s, path)
      assert.equal(response.status, 200)
      assert.match(collection(html), /<option value="haiku" selected>Haiku<\/option>/)
      found.push(...ids(html)); page++
      if (page > 1) {
        assert.ok(collection(html).includes(`href="${pathFor(owner)}?family=haiku&amp;sort=level#collection">Back to first page`))
      }
      path = next(html)
      if (path) {
        const url = new URL(path, 'http://localhost:8787')
        assert.equal(url.searchParams.get('family'), 'haiku'); assert.equal(url.searchParams.get('sort'), 'level')
      }
    }
    const expected = cards.filter(card => card.family === 'haiku').sort((a, b) => b.level - a.level || b.id.localeCompare(a.id))
    assert.deepEqual(found, expected.map(card => card.id)); assert.equal(page, 3)
    const empty = await get(s, pathFor(owner) + '?family=sonnet')
    assert.equal(empty.response.status, 200); assert.deepEqual(ids(empty.html), [])
    assert.match(textOf(empty.html), /No cards match these filters/)
  })

  it('escapes reflected search links and refuses private selectors and cross-profile cursors without echoing them', async () => {
    const { s, owner, other } = await setup()
    const first = await get(s, pathFor(owner)), cursorPath = next(first.html)!
    const cursor = new URL(cursorPath, 'http://localhost:8787').searchParams.get('after')!
    const reflected = await get(s, pathFor(owner) + '?q=' + encodeURIComponent('"<img src=x onerror=x>'))
    assert.equal(reflected.response.status, 200)
    assert.match(reflected.html, /value="&quot;&lt;img src=x onerror=x&gt;"/)
    assert.doesNotMatch(reflected.html.replace(/\bvalue="[^"]*"/g, ''), /<img src=x|\sonerror=x|href="javascript:/i)
    for (const query of ['?owner=' + other.id, '?family=unknown', '?family=haiku&family=opus', '?after=' + cursor]) {
      const target = query.startsWith('?after=') ? other : owner
      const invalid = await get(s, pathFor(target) + query)
      assert.equal(invalid.response.status, 400)
      assert.ok(!invalid.html.includes(other.id) && !invalid.html.includes(cursor))
    }
  })

  it('shows all-time, current-season stats and rating rank only from midnight snapshots', async () => {
    const { s, owner, other } = await setup(4)
    const season = seasonOf(s.now())
    const midnight = { rating: 1350, battles: 20, duel_wins: 13, duel_losses: 5, beaten: 7, wild_wins: 23, catches: 11,
      species_count: 19, first_finds: 3, mythics_found: 2, market_sales: 4, s_duel_wins: 8, s_beaten: 6, s_species: 12, s_mythics: 1, s_sales: 2 }
    await s.db.batch([
      stmt(`UPDATE players SET pub_day = '', pub_stats = '{}', stats_season = ?, season = ?, ${Object.keys(midnight).map(key => key + ' = ?').join(', ')} WHERE id = ?`, season, season, ...Object.values(midnight), owner.id),
      stmt(`UPDATE players SET pub_day = '', rating = 1800, battles = 1 WHERE id = ?`, other.id),
      publish(owner.id, s.now()),
      stmt('UPDATE players SET rating = 9876, duel_wins = 7654, beaten = 7654, species_count = 7654, s_duel_wins = 7654, s_beaten = 7654, s_species = 7654, s_mythics = 7654, s_sales = 7654 WHERE id = ?', owner.id),
    ])
    const page = await get(s, pathFor(owner))
    assert.equal(page.response.status, 200)
    const visible = textOf(page.html)
    assert.match(visible, /#2 · 1350 rating/)
    const stats = page.html.slice(page.html.indexOf('id="stats"'), page.html.indexOf('</section>', page.html.indexOf('id="stats"')))
    assert.match(textOf(stats), /All time/)
    assert.match(textOf(stats), /13 wins and 5 losses/)
    assert.match(textOf(stats), /23 Wild wins/)
    const current = textOf(stats.slice(stats.indexOf(`<h3>Season ${season}</h3>`)))
    assert.match(current, /Duel wins 8 Players beaten 6 Species collected 12 Mythics found 1 Market sales 2/)
    assert.doesNotMatch(visible, /9876|7654/)
    assert.match(visible, /19 species collected/)
    s.set(s.now() + 28 * DAY)
    const future = await get(s, pathFor(owner))
    const futureStats = future.html.slice(future.html.indexOf('class="season-stats"'))
    assert.match(textOf(futureStats), /Duel wins 0 Players beaten 0 Species collected 0 Mythics found 0 Market sales 0/)
  })

  it('shows a real rating place beyond the leaderboard top fifty, and hides both rank and stats when opted out', async () => {
    const { s, owner } = await setup(4)
    await s.db.batch([
      stmt(`UPDATE players SET pub_day = '', rating = 1200, battles = 2 WHERE id = ?`, owner.id),
      ...Array.from({ length: 51 }, (_, i) => stmt('INSERT INTO players (id, handle, joined, last_seen, season, rating, battles) VALUES (?, ?, ?, ?, 1, 1500, 1)',
        'rank-fixture-' + i, 'ranked-trainer-' + i, utcDay(s.now()), utcDay(s.now()))),
    ])
    const ranked = await get(s, pathFor(owner))
    assert.match(textOf(ranked.html), /#52 · 1200 rating/)
    await owner.call('setLeaderboard', { optIn: false })
    const hidden = await get(s, pathFor(owner))
    assert.equal(hidden.response.status, 200)
    assert.doesNotMatch(hidden.html, /id="stats"|href="#stats"|class="season-stats"/)
    assert.doesNotMatch(textOf(hidden.html), /#52|1200 rating|All time|Updated daily|Unranked/)
    assert.deepEqual(ids(hidden.html), ids(ranked.html), 'hiding board stats does not hide the public collection')
    const profile = await owner.call('profile', { handle: handle(owner) })
    assert.equal(profile.stats, undefined)
  })

  it('renders public faces without private fields or associating a foreign card from a stale team', async () => {
    const { s, owner, other, cards } = await setup(8)
    const foreign = (await other.call('cards')).cards[0]!
    await s.db.batch([
      stmt('UPDATE players SET team = ?, team_size = 2, joined = ?, last_seen = ?, sparks = ?, recent_opponents = ? WHERE id = ?',
        JSON.stringify([cards[0]!.id, foreign.id]), '1997-04-03', '1997-02-13', 654321, JSON.stringify([other.id]), owner.id),
      stmt(`UPDATE cards SET xp = 456789, raised_in = 'opus', arena_opus = 65432, state = 'escrow', escrow_ref = 'fixture-private-escrow-reference', locked_until = 987654321, tired_until = 987654322, minted = '1998-03-01' WHERE id = ?`, cards[1]!.id),
    ])
    const { response, html } = await get(s, pathFor(owner))
    assert.equal(response.status, 200)
    assert.ok(ids(html).includes(cards[1]!.id), 'escrow changes availability, not the held card public face')
    for (const sentinel of [owner.id, other.id, owner.token, other.token, foreign.id, 'fixture-private-escrow-reference', '1997-04-03', '1997-02-13', '1998-03-01', '987654321', '987654322']) assert.ok(!html.includes(sentinel), 'private identity, activity, availability and foreign owner cards stay absent')
    assert.doesNotMatch(textOf(html), /654321|456789|65432/)
    assert.doesNotMatch(html, /"(?:owner_id|raisedIn|mintedAt|lockedUntil|tiredUntil|escrowRef|token|version)"\s*:/)
    assert.equal((await get(s, '/u/missing-player-89')).response.status, 404)
  })

  it('keeps routed collection reads bounded as the inventory grows beyond one page', async () => {
    const { s, owner } = await setup(120)
    const all = s.db.all.bind(s.db), one = s.db.get.bind(s.db)
    let reads = 0, maxParams = 0
    s.db.all = async (sql, ...params) => { reads++; maxParams = Math.max(maxParams, params.length); return all(sql, ...params) }
    s.db.get = async (sql, ...params) => { reads++; maxParams = Math.max(maxParams, params.length); return one(sql, ...params) }
    const first = await get(s, pathFor(owner))
    assert.equal(first.response.status, 200); assert.equal(ids(first.html).length, PUBLIC_INVENTORY_PAGE)
    assert.ok(reads <= 20, `profile used ${reads} reads`)
    assert.ok(maxParams <= 100)
    reads = 0
    const second = await get(s, next(first.html)!)
    assert.equal(second.response.status, 200); assert.ok(reads <= 20, `next profile page used ${reads} reads`)
  })

  it('offers the signed-in public-profile action without embedding an account into the public shell', async () => {
    const { s, owner } = await setup(4)
    const response = await s.request('GET', '/account', { token: owner.token, client: null })
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, /<a\b[^>]*id="profile-open"[^>]*>View public profile<\/a>/)
    assert.ok(html.indexOf('id="profile-open"') > html.indexOf('id="dashboard" hidden'), 'the action lives in the signed-in dashboard')
    for (const privateValue of [handle(owner), owner.id, owner.token]) assert.ok(!html.includes(privateValue))
  })

  it('uses one compact native filter form, preserving selections while resetting pagination', async () => {
    const { s, owner } = await setup(4)
    const query = new URLSearchParams({ q: 'plum', family: 'haiku', rarity: 'rare', sort: 'atk', kind: 'species', finish: 'foil', trait: 'sturdy' })
    const page = await get(s, pathFor(owner) + '?' + query)
    assert.equal(page.response.status, 200)
    assert.equal(page.response.headers.get('content-security-policy'), PROFILE_CSP)
    assert.ok(PROFILE_CSP.includes("form-action 'self'") && PROFILE_CSP.includes("connect-src 'none'"))
    const form = collection(page.html).match(/<form\b[\s\S]*?<\/form>/)?.[0]
    assert.ok(form)
    assert.ok(form.includes(`method="get" action="${pathFor(owner)}#collection"`))
    assert.match(form, /role="search" aria-label="Filter collection"/)
    assert.deepEqual([...form.matchAll(/<(?:input|select)\b[^>]*name="([^"]+)"/g)].map(match => match[1]).sort(), ['family', 'finish', 'kind', 'q', 'rarity', 'sort', 'trait'])
    assert.doesNotMatch(form, /name="after"|\sonchange=|filter-links/)
    assert.match(form, /id="collection-search"[^>]*maxlength="40"[^>]*value="plum"/)
    for (const [key, value] of query) {
      if (key === 'q') continue
      const select = form.match(new RegExp(`<select id="collection-${key}"[^>]*>([\\s\\S]*?)<\\/select>`))![1]!
      assert.ok(select.includes(`<option value="${value}" selected>`), `${key} stays selected`)
      assert.ok(form.includes(`for="collection-${key}"`), `${key} has a visible associated label`)
    }
    assert.match(form, /<details class="collection-more" open>/)
    assert.ok(form.includes(`href="${pathFor(owner)}#collection">Reset</a>`))
    assert.match(form, /<button class="pbtn" type="submit"><span class="face">Apply<\/span>/)
    const plain = await get(s, pathFor(owner))
    assert.match(plain.html, /<details class="collection-more">/)
    assert.doesNotMatch(collection(plain.html), /card-inspect|inspect-body|Card details/)
    assert.equal(ids(plain.html).length, 4, 'each whole card still links to its dedicated page')
    for (const path of ['/c/' + ids(plain.html)[0], '/market', '/odds']) {
      const other = await get(s, path)
      assert.match(other.response.headers.get('content-security-policy')!, /form-action 'none'/, 'filter permission is scoped to profiles')
    }
  })
})

// The public game pages of 0.2.0 (SPEC 8, 20): /boards, /market and a trainer's stats on their camp.
// Strict like every site page, readable without script, every number as of the last UTC midnight,
// hidden players nowhere, no dates, every handle and card a link, and buying shown as a line to type.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import { stmt } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { count } from '../../server/src/game/stats.ts'
import { BOARD_COMMAND, MARKET_COMMAND, wantWords } from '../../server/src/pages-boards.ts'
import { REPO, SITE_CSP } from '../../server/src/pages-html.ts'
import { SITE_ASSETS } from '../../server/static/site.gen.ts'
import { DAY, server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

type Page = { status: number; headers: Headers; html: string }

async function get(s: Server, path: string, o: { ip?: string; token?: string } = {}): Promise<Page> {
  const res = await s.request('GET', path, { ...o, client: null })
  return { status: res.status, headers: res.headers, html: await res.text() }
}

const textOf = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ ([,.])/g, '$1')
const env = (s: Server) => ({ db: s.db, now: s.now(), randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) })
const handle = (p: Player) => p.me.player.handle
const nextMidnight = (s: Server) => s.set((Math.floor(s.now() / DAY) + 1) * DAY)

/** A strict site page: SITE_CSP (connect-src 'none'), our two scripts only, nothing from elsewhere, no inline code. */
function assertSitePage(p: Page) {
  assert.equal(p.status, 200)
  assert.equal(p.headers.get('content-security-policy'), SITE_CSP)
  assert.match(SITE_CSP, /connect-src 'none'/)
  assert.equal(p.headers.get('set-cookie'), null)
  const scripts = [...p.html.matchAll(/<script\b([^>]*)>/g)].map(m => m[1])
  assert.deepEqual(scripts, [` src="/static/${SITE_ASSETS.sky}"`, ` type="module" src="/static/${SITE_ASSETS.site}"`])
  assert.doesNotMatch(p.html, /\son[a-z]+\s*=|javascript:|<form\b|<iframe\b/i)
  for (const [url] of p.html.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) assert.ok(url.startsWith(REPO) || url.startsWith('http://localhost:8787/'), url)
}

/** Stats straight onto a player's row, as the counters would have them. */
async function setStats(s: Server, p: Player, o: Record<string, number>) {
  const cols = Object.keys(o)
  await s.db.batch([stmt(`UPDATE players SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map(c => o[c]!), p.id)])
}

async function looseCards(s: Server, p: Player, n: number, seed = 'm') {
  const fresh = Array.from({ length: n }, (_, i) => mintFor('sonnet', 'rare', rngFromSeed(`${seed}-${i}`), s.now(), 'trader', false))
  const { cards, stmts } = await mintCards(env(s), p.id, fresh)
  await s.db.batch(stmts)
  return cards
}

// ---- the boards --------------------------------------------------------------------------------

describe('the leaderboards page', () => {
  it('shows a board as of the last midnight: ranks, handles linking to camps, leagues and numbers, the top three on a podium', async () => {
    const s = server()
    const [a, b, c, d] = [await s.join('haiku'), await s.join('opus'), await s.join('sonnet'), await s.join('fable')]
    await setStats(s, a, { rating: 1720, battles: 9, duel_wins: 31 })
    await setStats(s, b, { rating: 1310, battles: 4, duel_wins: 12 })
    await setStats(s, c, { rating: 1110, battles: 2, duel_wins: 4 })
    await setStats(s, d, { rating: 1990, battles: 50, duel_wins: 99, board_hidden: 1 })
    nextMidnight(s)
    const p = await get(s, '/boards')
    assertSitePage(p)
    assert.equal(p.headers.get('cache-control'), 'public, max-age=300')
    const text = textOf(p.html)
    const rows = [...p.html.matchAll(/<li class="r[^"]*" style="--v:\d+%">([\s\S]*?)<\/li>/g)].map(m => textOf(m[1]!).trim())
    assert.deepEqual(rows, [
      `1 ${handle(a)} Star 1,720 rating`, `2 ${handle(b)} Grove 1,310 rating`, `3 ${handle(c)} Brook 1,110 rating`,
    ])
    for (const p2 of [a, b, c]) assert.ok(p.html.includes(`href="/u/${handle(p2)}"`), 'each handle links to its camp')
    assert.ok(!text.includes(handle(d)), 'a hidden player is on no board')
    // the podium: number one in the middle, each lead creature drawn, each plate naming its trainer
    const podium = p.html.match(/<ol class="podium"[^>]*>([\s\S]*?)<\/ol>/)![1]!
    assert.equal((podium.match(/<li class="pod p\d"/g) ?? []).length, 3)
    assert.match(textOf(podium), new RegExp(`Number 1: ${handle(a)} 1,720 rating`))
    assert.equal((podium.match(/<svg class="spr/g) ?? []).length, 3)
    // never a date or a time
    assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b/)
    // six boards and two periods, each a plain link; the one shown is marked
    const tabs = [...p.html.matchAll(/<a class="tab" href="([^"]+)"( aria-current="page")?>/g)]
    assert.deepEqual(tabs.map(t => t[1]), ['/boards', '/boards?board=beaten', '/boards?board=duelWins', '/boards?board=species', '/boards?board=mythics', '/boards?board=sales'])
    assert.deepEqual(tabs.map(t => !!t[2]), [true, false, false, false, false, false])
    assert.match(p.html, /<nav class="period" aria-label="When"><a href="\/boards" aria-current="page">All time<\/a><a href="\/boards\?period=season">Season \d+<\/a><\/nav>/)
    assert.ok(text.includes(BOARD_COMMAND), 'where to see your own place')
  })

  it('switches board and period by address, keeps today\'s moves out until midnight, and treats junk as the default', async () => {
    const s = server()
    const [a, b] = [await s.join('haiku'), await s.join('opus')]
    await setStats(s, a, { duel_wins: 7, s_duel_wins: 2, stats_season: 1 })
    await setStats(s, b, { duel_wins: 3, s_duel_wins: 3, stats_season: 1 })
    nextMidnight(s)
    // today a counts four more wins: nobody sees them before the next midnight
    await s.db.batch(count(a.id, s.now(), { duelWins: 4 }))
    const all = textOf((await get(s, '/boards?board=duelWins')).html)
    assert.ok(all.includes(`1 ${handle(a)} Pebble 7 duel wins`) && all.includes(`2 ${handle(b)} Pebble 3 duel wins`), all)
    const season = await get(s, '/boards?board=duelWins&period=season')
    assert.match(season.html, /<a class="tab" href="\/boards\?board=duelWins&amp;period=season" aria-current="page">/)
    assert.ok(textOf(season.html).includes('this season'))
    nextMidnight(s)
    assert.ok(textOf((await get(s, '/boards?board=duelWins')).html).includes(`1 ${handle(a)} Pebble 11 duel wins`), 'and after midnight they are')
    assert.equal((await get(s, '/boards?board=<script>&period=never')).html, (await get(s, '/boards')).html)
    const moved = await s.request('GET', '/leaderboards?board=sales', { client: null })
    assert.equal(moved.status, 301)
    assert.equal(moved.headers.get('location'), '/boards?board=sales')
  })

  it('invites players in when a board is empty, with open spots on the podium', async () => {
    const s = server()
    await s.join('haiku')
    const p = await get(s, '/boards?board=mythics')
    assertSitePage(p)
    const text = textOf(p.html)
    assert.ok(text.includes('Nobody on this board yet.') && text.includes('The first name here could be yours.'))
    assert.equal((p.html.match(/<li class="pod p\d open"/g) ?? []).length, 3)
    assert.ok(text.includes('/plugin install spinlings@spinlings'), 'and how to join')
    assert.doesNotMatch(p.html, /<ol class="ranks">/)
  })

  it('is linked from every header and footer, and marked in the header when you are on it', async () => {
    const s = server()
    const a = await s.join('haiku')
    for (const path of ['/', '/odds', '/privacy', '/market', `/u/${handle(a)}`, `/c/${a.me.player.team[0]}`]) {
      const p = await get(s, path)
      const header = p.html.slice(p.html.indexOf('<header'), p.html.indexOf('</header>'))
      assert.match(header, /<a class="nb" href="\/boards"><svg [^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg><span class="nbl">Boards<\/span><\/a>/, path)
      const footer = p.html.slice(p.html.indexOf('<footer'))
      assert.ok(footer.includes('<a href="/boards">Leaderboards</a><a href="/market">Market</a>'), path)
    }
    assert.match((await get(s, '/boards')).html, /<a class="nb" href="\/boards" aria-current="page">/)
  })
})

// ---- the market --------------------------------------------------------------------------------

describe('the market page', () => {
  it('lists open listings as card tiles with their terms and sellers, read-only, with the line to buy them', async () => {
    const s = server()
    const [a, b] = [await s.join('haiku'), await s.join('opus')]
    const [x, y, z] = await looseCards(s, a, 3)
    await a.call('listCard', { cardId: x!.id, price: 120 })
    await a.call('listCard', { cardId: y!.id, want: { family: 'opus', rarity: 'rare' } })
    await a.call('listCard', { cardId: z!.id, price: 40, want: { shiny: true, family: 'haiku' } })
    const p = await get(s, '/market')
    assertSitePage(p)
    assert.equal(p.headers.get('cache-control'), 'public, max-age=60')
    const lots = [...p.html.matchAll(/<li class="lot">([\s\S]*?)<\/li>/g)].map(m => m[1]!)
    assert.equal(lots.length, 3)
    for (const c of [x, y, z]) assert.ok(p.html.includes(`<a class="cardlink" href="/c/${c!.id}"`), 'each card links to its page')
    const texts = lots.map(l => textOf(l).replace(/^.*?Level \d+ /, '').trim())
    assert.deepEqual(texts.sort(), [
      `120 sparks from ${handle(a)}`,
      `40 sparks and a shiny Haiku from ${handle(a)}`,
      `Swap for an Opus, rare or up from ${handle(a)}`,
    ].sort())
    const text = textOf(p.html)
    assert.ok(text.includes(MARKET_COMMAND) && text.includes('To buy one, type this inside Claude Code'))
    assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}\b/, 'never the day it was listed')
    assert.doesNotMatch(p.html, /<form\b|<button[^>]*data-buy/i, 'nothing to buy with here')
    // b's cancelled or sold listings are gone; a's own card arrives in b's hands and leaves the market
    const sold = (await b.call('market', {})).listings.find(l => l.price === 120)!
    await s.db.batch([stmt('UPDATE players SET sparks = 500 WHERE id = ?', b.id)])
    await b.call('buyListing', { listingId: sold.id })
    assert.equal(([...(await get(s, '/market')).html.matchAll(/<li class="lot">/g)]).length, 2)
  })

  it('filters by family and sorts by price through plain links, and pages with More', async () => {
    const s = server()
    const a = await s.join('haiku')
    const cards = await looseCards(s, a, 52, 'pg')
    for (const [i, c] of cards.entries()) await a.call('listCard', { cardId: c.id, price: 10 + i })
    const first = await get(s, '/market?sort=cheapest')
    assert.equal((first.html.match(/<li class="lot">/g) ?? []).length, 50)
    const prices = [...first.html.matchAll(/<p class="price"><svg[\s\S]*?<\/svg><b>([\d,]+)<\/b>/g)].map(m => Number(m[1]))
    assert.deepEqual(prices, [...prices].sort((p, q) => p - q))
    const more = first.html.match(/<a class="pbtn" href="(\/market\?sort=cheapest&amp;after=[^"]+)"><span class="face">More cards<\/span><\/a>/)
    assert.ok(more, 'a link to the next page')
    const second = await get(s, more[1]!.replace(/&amp;/g, '&'))
    assert.equal((second.html.match(/<li class="lot">/g) ?? []).length, 2)
    assert.ok(second.html.includes('<a class="tbtn" href="/market?sort=cheapest">Back to the start</a>'))
    // a cursor that does not fit is the first page, never an error
    assert.equal((await get(s, '/market?after=nonsense')).status, 200)
    const fable = await get(s, '/market?family=fable')
    assert.match(fable.html, /<a href="\/market\?family=fable" style="--fam:[^"]+" aria-current="page">/)
    assert.ok(textOf(fable.html).includes('No Fable cards up right now.'))
    assert.equal((await get(s, '/market?family=nope&sort=nope')).html, (await get(s, '/market')).html)
  })

  it('describes every kind of want in plain words', () => {
    assert.equal(wantWords({ family: 'sonnet', rarity: 'epic' }), 'a Sonnet, epic or up')
    assert.equal(wantWords({ rarity: 'rare' }), 'a card, rare or up')
    assert.equal(wantWords({ foil: true }), 'a foil card')
    assert.equal(wantWords({ shiny: true, foil: true, family: 'opus' }), 'a shiny foil Opus')
    assert.equal(wantWords({ species: 'mythic' }), 'Mythic')
  })
})

// ---- a trainer's camp --------------------------------------------------------------------------

describe('stats and listings on a camp', () => {
  it('shows the stats as tiles as of the last midnight, and the open listings without repeating the seller', async () => {
    const s = server()
    const a = await s.join('haiku')
    const [x] = await looseCards(s, a, 1)
    await a.call('listCard', { cardId: x!.id, price: 75 })
    await setStats(s, a, { duel_wins: 12, duel_losses: 4, beaten: 6, wild_wins: 40, catches: 17, first_finds: 2, mythics_found: 1, market_sales: 3 })
    nextMidnight(s)
    await s.db.batch(count(a.id, s.now(), { catches: 5 }))
    const p = await get(s, `/u/${handle(a)}`)
    assertSitePage(p)
    const grid = p.html.match(/<ul class="statgrid">([\s\S]*?)<\/ul>/)![1]!
    assert.deepEqual([...grid.matchAll(/<li class="stat[^"]*">([\s\S]*?)<\/li>/g)].map(m => textOf(m[1]!).trim()), [
      '12 - 4 12 wins and 4 losses: Duel wins and losses', '6 Players beaten', '40 Wild wins', '17 Catches', '2 First finds', '1 Mythics found', '3 Market sales',
    ])
    assert.match(grid, /<span class="split" role="img" aria-label="75% of duels went their way"><i style="--v:75%"><\/i><\/span>/)
    const market = p.html.slice(p.html.indexOf('On the market'))
    assert.ok(market.includes(`<a class="cardlink" href="/c/${x!.id}"`))
    assert.doesNotMatch(market.slice(0, market.indexOf('</ul>')), /class="seller"/)
    assert.ok(p.html.includes('<a href="/market">See the whole market</a>'))
  })

  it('shows no stats for a trainer who hid from the boards, and no market shelf without listings', async () => {
    const s = server()
    const a = await s.join('haiku')
    await setStats(s, a, { duel_wins: 12, board_hidden: 1 })
    const p = await get(s, `/u/${handle(a)}`)
    assert.equal(p.status, 200)
    assert.doesNotMatch(p.html, /class="statgrid"|Duel wins and losses|\.statgrid\{/)
    assert.doesNotMatch(p.html, /On the market|class="stall"/)
  })
})

// ---- copy ----------------------------------------------------------------------------------------

describe('the site after 0.2.0', () => {
  it('never mentions a trust gate, a trade lock, a fee or an opt-in leaderboard', async () => {
    const s = server()
    const a = await s.join('haiku')
    for (const path of ['/', '/odds', '/privacy', '/boards', '/market', `/u/${handle(a)}`, `/c/${a.me.player.team[0]}`]) {
      const text = textOf((await get(s, path)).html)
      assert.doesNotMatch(text, /trust|trade lock|locked for|\bfees?\b|opt[ -]?in|opt[ -]?out|days old|\d+ battles before/i, path)
    }
  })
})

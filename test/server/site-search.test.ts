// The top bar's ways round the site, and /search: every public player and every held card's public
// face, as native GET forms with bounded, cursor-paged queries that show nothing profiles do not.
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { describe, it } from 'node:test'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import type { Family, NewCard, Rarity } from '../../plugin/hooks/core/types.ts'
import { stmt } from '../../server/src/db.ts'
import { catalogOf } from '../../server/src/game/ctx.ts'
import { cardsByIds, mintCards, publicCard } from '../../server/src/game/mint.ts'
import { SITE_CSP } from '../../server/src/pages-html.ts'
import { CARDS_PAGE, PLAYERS_PAGE, SEARCH_CSP, SEARCH_WINDOW, SEARCH_WINDOWS } from '../../server/src/pages-search.ts'
import { spriteSvg } from '../../server/src/pages-sprite.ts'
import { server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

let visits = 0
const get = async (s: Server, path = '/search', token?: string) => {
  const response = await s.request('GET', path, { client: null, ip: `198.19.${visits >> 8 & 255}.${++visits & 255}`, ...(token ? { token } : {}) })
  return { response, markup: await response.text() }
}
const body = (markup: string) => markup.slice(markup.indexOf('<main'), markup.indexOf('</main>'))
const header = (markup: string) => markup.slice(markup.indexOf('<header class="top"'), markup.indexOf('</header>'))
const handles = (markup: string) => [...markup.matchAll(/<span class="trainer-name">([^<]+)<\/span>/g)].map(match => match[1]!)
const cardIds = (markup: string) => [...body(markup).matchAll(/<a class="cardlink" href="\/c\/([^"]+)"/g)].map(match => match[1]!)
const nextOf = (markup: string) => body(markup).match(/<a class="next" rel="next" href="([^"]+)">/)?.[1]?.replace(/&amp;/g, '&')
const env = (s: Server) => ({ db: s.db, now: s.now(), randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) })

async function named(s: Server, name: string): Promise<Player> {
  const player = await s.join('haiku')
  await s.db.batch([stmt('UPDATE players SET handle = ? WHERE id = ?', name, player.id)])
  return player
}
async function give(s: Server, p: Player, cards: NewCard[]): Promise<string[]> {
  const minted = await mintCards(env(s), p.id, cards)
  await s.db.batch(minted.stmts)
  return minted.cards.map(c => c.id)
}
const card = (s: Server, family: Family, rarity: Rarity, seed: string, finish: { shiny?: boolean; foil?: boolean } = {}) => {
  const c = mintFor(family, rarity, rngFromSeed(seed), s.now(), 'trader', false)
  c.shiny = finish.shiny ?? false
  if (finish.foil) c.foil = true
  else delete c.foil
  return c
}
/** Every page of a card search, following the next links. */
async function allCards(s: Server, path: string): Promise<string[]> {
  const out: string[] = []
  for (let at: string | undefined = path, n = 0; at && n < 50; n++) {
    const { response, markup } = await get(s, at)
    assert.equal(response.status, 200, at)
    out.push(...cardIds(markup))
    at = nextOf(markup)
  }
  return out
}
const heldIds = async (s: Server) => (await s.db.all<{ id: string }>('SELECT id FROM cards ORDER BY id')).map(r => r.id)

// ---- the top bar ---------------------------------------------------------------------------------

describe('the top bar', () => {
  it('leads to the leaderboards, search and your profile, in that order before the source, on every page', async () => {
    const s = server(), a = await s.join('haiku')
    const team = a.me.player.team
    for (const path of ['/', '/odds', '/privacy', '/boards', '/market', '/mythics', '/search', '/search?in=cards', `/u/${a.me.player.handle}`, `/c/${team[0]}`, '/account', '/u/nobody-here-11']) {
      const { markup } = await get(s, path)
      const top = header(markup)
      const links = [...top.slice(top.indexOf('<div class="end">')).matchAll(/<a class="(nb|gh)" href="([^"]+)"/g)].map(m => m[2])
      assert.deepEqual(links, ['/boards', '/search', '/account', 'https://github.com/416rehman/spinlings'], path)
      assert.match(top, /<a class="nb" href="\/boards" title="Leaderboards"[^>]*><svg viewBox="0 0 10 10"[^>]*aria-hidden="true"[\s\S]*?<\/svg><span class="nbl">Leaderboards<\/span><\/a>/, path)
      assert.match(top, /<a class="nb" href="\/search" title="Search"[^>]*><svg viewBox="0 0 20 20"[^>]*aria-hidden="true"[\s\S]*?<\/svg><span class="nbl">Search<\/span><\/a>/, path)
      assert.match(top, /<a class="nb" href="\/account" aria-label="Your profile" title="Your profile"[^>]*><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg><span class="nbl">Profile<\/span><\/a>/, path)
      assert.doesNotMatch(top, /\/players|js-only[^>]*class="nb"|class="nb[^"]*js-only/, `${path}: no old directory button, nothing that needs script`)
      const footer = markup.slice(markup.indexOf('<footer'))
      assert.ok(footer.includes('<a href="/boards">Leaderboards</a><a href="/search">Search</a><a href="/account">Your profile</a><a href="/market">Market</a>'), path)
      assert.doesNotMatch(footer, /\/players/, path)
    }
  })

  it('marks only the page you are on', async () => {
    const s = server()
    for (const [path, href] of [['/boards', '/boards'], ['/search', '/search'], ['/search?in=cards&rarity=rare', '/search'], ['/account', '/account']] as const) {
      const top = header((await get(s, path)).markup)
      const current = [...top.matchAll(/<a class="nb" href="([^"]+)"[^>]*aria-current="page"/g)].map(m => m[1])
      assert.deepEqual(current, [href], path)
    }
    assert.doesNotMatch(header((await get(s, '/market')).markup), /aria-current/)
  })

  it('keeps 44 px targets and shows words only where they fit, without layout script', async () => {
    const s = server(), css = (await get(s, '/')).markup.match(/<style>([\s\S]*?)<\/style>/)![1]!
    assert.ok(css.includes('.nb{display:flex;align-items:center;justify-content:center;gap:8px;min-width:44px;height:44px;'))
    assert.ok(css.includes('.nbl{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}'), 'icon-only names stay readable to assistive tech')
    assert.ok(css.includes('@media (min-width:1200px){.nbl{position:static;'), 'words show from 1200 px')
    assert.ok(css.includes('.nb[aria-current]::after{'), 'the current page is marked when only icons show')
    assert.ok(css.includes('@media(max-width:479px){.top .end{gap:0}'), 'phones lose gaps, never target size')
    assert.doesNotMatch(css, /\.nb\{[^}]*min-width:(?:[0-3]\d|4[0-3])px/)
  })
})

// ---- players -------------------------------------------------------------------------------------

describe('search: players', () => {
  it('opens on every visible player with a native search form, a page-local form policy and noindex', async () => {
    const s = server(), { response, markup } = await get(s), content = body(markup)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-security-policy'), SEARCH_CSP)
    assert.ok(SEARCH_CSP.includes("connect-src 'none'") && SEARCH_CSP.includes("form-action 'self'"))
    assert.ok(SITE_CSP.includes("form-action 'none'"), 'the global page policy is unchanged')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(markup, /<meta name="robots" content="noindex">/)
    assert.match(content, /<form class="sbox" method="get" action="\/search" role="search">/)
    assert.match(content, /<label class="sr" for="search-q">Search players by username<\/label>/)
    assert.match(content, /id="search-q" name="q" type="search" maxlength="40"/)
    assert.match(content, /<nav class="stabs" aria-label="Search in"><a class="stab" href="\/search" aria-current="page">[\s\S]*?Players[\s\S]*?<a class="stab" href="\/search\?in=cards">/)
    assert.doesNotMatch(content, /<input type="hidden"/, 'the players form sends only its search')
    assert.doesNotMatch(content, /class="fchip"/, 'card filters live on the Cards tab')
    assert.match(content, /No trainers here yet/)
    assert.equal(response.headers.get('set-cookie'), null)
  })

  it('lists players alphabetically with real lead art, including board-hidden players without their stats or activity', async () => {
    const s = server(), z = await named(s, 'zeta-player'), a = await named(s, 'alpha-player'), b = await named(s, 'bravo-hidden')
    await s.db.batch([stmt('UPDATE players SET board_hidden = 1, rating = ?, pub_stats = ?, last_seen = ? WHERE id = ?', 876543, '{"duelWins":765432}', '2099-12-31', b.id)])
    const { markup } = await get(s), content = body(markup)
    assert.deepEqual(handles(content), ['alpha-player', 'bravo-hidden', 'zeta-player'])
    for (const player of [z, a, b]) {
      const row = await player.row(), leadId = JSON.parse(row.team)[0] as string
      const lead = publicCard((await cardsByIds(s.db, [leadId])).get(leadId)!.card)
      assert.ok(content.includes(spriteSvg(spriteFor(lead), { flash: false })), 'lead artwork uses the actual public card')
      assert.ok(content.includes(`href="/u/${row.handle}"`))
      for (const hidden of [player.id, player.token, leadId]) assert.ok(!content.includes(hidden), 'only the public profile link is emitted')
    }
    assert.doesNotMatch(content, /876543|765432|2099-12-31|last_seen|pub_stats|board_hidden|rating|streak|mintedAt|raisedIn/)
    assert.deepEqual(handles((await get(s, '/search', a.token)).markup), handles(markup), 'sign-in does not alter the public list')
  })

  it('keeps missing or foreign team leads out instead of inventing or borrowing artwork', async () => {
    const s = server(), a = await named(s, 'empty-team'), b = await named(s, 'other-trainer')
    await s.db.batch([stmt('UPDATE players SET team = ? WHERE id = ?', (await b.row()).team, a.id)])
    const { markup } = await get(s, '/search?q=empty-team')
    const entry = body(markup).match(/<a class="trainer"[^>]*>([\s\S]*?)<\/a>/)![1]!
    assert.match(entry, /class="trainer-empty"/)
    assert.doesNotMatch(entry, /class="spr/)
    assert.deepEqual(handles(markup), ['empty-team'])
  })

  it('searches literal username text case-insensitively and never reflects query markup as HTML', async () => {
    const s = server()
    await named(s, 'moss_trainer')
    await named(s, 'another-trainer')
    assert.deepEqual(handles((await get(s, '/search?q=MOSS')).markup), ['moss_trainer'])
    assert.deepEqual(handles((await get(s, '/search?in=players&q=moss')).markup), ['moss_trainer'])
    assert.deepEqual(handles((await get(s, '/search?q=%25')).markup), [], 'percent is literal, not a LIKE wildcard')
    assert.deepEqual(handles((await get(s, '/search?q=_')).markup), ['moss_trainer'], 'underscore is literal')
    assert.deepEqual(handles((await get(s, '/search?q=')).markup), ['another-trainer', 'moss_trainer'], 'an empty search shows everyone')
    const query = '<img src=x onerror=alert(1)>'
    const { response, markup } = await get(s, '/search?q=' + encodeURIComponent(query)), content = body(markup)
    assert.equal(response.status, 200)
    assert.match(content, /value="&lt;img src=x onerror=alert\(1\)&gt;"/)
    assert.doesNotMatch(content, /<img\b|<script\b|\sonclick=/)
    assert.match(content, /No trainers by that name/)
    assert.match(content, /class="sclear" href="\/search" aria-label="Clear the search"/)
  })

  it('keeps the search as it was typed in the box and links, and pages it like its lowercase twin', async () => {
    const s = server()
    for (let i = 0; i < PLAYERS_PAGE + 1; i++) await named(s, `mossy-${String(i).padStart(2, '0')}`)
    const { markup } = await get(s, '/search?q=%20Mossy%20'), content = body(markup)
    assert.equal(handles(content).length, PLAYERS_PAGE)
    assert.match(content, /id="search-q"[^>]*value="Mossy"/)
    assert.match(content, /<a class="stab" href="\/search\?in=cards&amp;q=Mossy">/, 'tab links keep the typed case')
    const next = nextOf(markup)!
    assert.ok(next.includes('q=Mossy'), next)
    assert.deepEqual(handles((await get(s, next)).markup), [`mossy-${PLAYERS_PAGE}`])
    const lower = new URL(next, 'http://localhost')
    lower.searchParams.set('q', 'mossy')
    assert.deepEqual(handles((await get(s, lower.pathname + lower.search)).markup), [`mossy-${PLAYERS_PAGE}`], 'a cursor belongs to the search, not its case')
    const cards = body((await get(s, '/search?in=cards&q=MoSs&rarity=rare')).markup)
    assert.match(cards, /value="MoSs"/)
    assert.match(cards, /<a class="fchip" href="\/search\?in=cards&amp;q=MoSs" aria-current="true">/, 'chips keep it too')
  })

  it('reads players in bounded windows, moving past empty ones up to a limit, never the whole table', async () => {
    const s = server(), template = await named(s, 'a-template')
    const columns = (await s.db.all<{ name: string }>(`SELECT name FROM pragma_table_info('players')`)).map(c => c.name).filter(c => c !== 'id' && c !== 'handle')
    const filler = SEARCH_WINDOW * SEARCH_WINDOWS + 5
    await s.db.batch([stmt(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
      INSERT INTO players (id, handle, ${columns.join(', ')}) SELECT printf('pfill%05d', i), printf('a-filler-%05d', i), ${columns.join(', ')} FROM n, players WHERE players.id = ?`, filler, template.id)])
    await named(s, 'needle-trainer')
    const deep = (await get(s, '/search?q=filler-08003')).markup
    assert.deepEqual(handles(deep), ['a-filler-08003'], 'two empty windows are read past in one page')
    assert.ok(nextOf(deep), 'and the search goes on after the window that matched')
    const first = (await get(s, '/search?q=needle')).markup
    assert.deepEqual(handles(first), [], `no page reads more than ${SEARCH_WINDOWS} windows`)
    assert.match(body(first), /None in this stretch\./)
    assert.match(body(first), /More players wait further on\./)
    assert.deepEqual(handles((await get(s, nextOf(first)!)).markup), ['needle-trainer'])
    const all = (await get(s, '/search')).markup
    assert.deepEqual(handles(all), Array.from({ length: PLAYERS_PAGE }, (_, i) => `a-filler-${String(i + 1).padStart(5, '0')}`), 'a broad search fills its page from the start')
  })

  it('pages through every match without overlap and binds the cursor to its search', async () => {
    const s = server()
    const expected = Array.from({ length: PLAYERS_PAGE + 2 }, (_, i) => `trainer-${String(i).padStart(2, '0')}`)
    for (const handle of expected) await named(s, handle)
    const first = (await get(s, '/search?q=trainer-')).markup
    assert.deepEqual(handles(first), expected.slice(0, PLAYERS_PAGE))
    const next = nextOf(first)!
    assert.ok(next.includes('q=trainer-') && next.includes('after='))
    const last = (await get(s, next)).markup
    assert.deepEqual(handles(last), expected.slice(PLAYERS_PAGE))
    assert.match(body(last), /Back to first page/)
    assert.equal(nextOf(last), undefined)
    const changed = new URL(next, 'http://localhost')
    changed.searchParams.set('q', 'other')
    assert.equal((await get(s, changed.pathname + changed.search)).response.status, 400)
    changed.searchParams.set('q', 'trainer-')
    changed.searchParams.set('in', 'cards')
    assert.equal((await get(s, changed.pathname + changed.search)).response.status, 400, 'a players cursor never pages cards')
  })

  it('shows only the current username after a rename and drops deleted players', async () => {
    const s = server(), p = await named(s, 'old-player-name')
    assert.deepEqual(handles((await get(s)).markup), ['old-player-name'])
    await s.db.batch([stmt('UPDATE players SET handle = ? WHERE id = ?', 'new-player-name', p.id)])
    const renamed = (await get(s)).markup
    assert.deepEqual(handles(renamed), ['new-player-name'])
    assert.ok(!body(renamed).includes('old-player-name'))
    assert.deepEqual(handles((await get(s, '/search?q=old-player-name')).markup), [])
    await p.call('deleteMe', {})
    assert.deepEqual(handles((await get(s)).markup), [])
  })

  it('rejects oversized, control, duplicate, unknown and malformed parameters without echoing them', async () => {
    const s = server()
    assert.equal((await get(s, '/search?q=' + 'a'.repeat(40))).response.status, 200)
    for (const path of ['/search?q=' + 'a'.repeat(41), '/search?q=%E2%80%AE', '/search?q=%0A', '/search?q=one&q=two', '/search?sort=activity',
      '/search?after=bad', '/search?after=', '/search?after=a&after=b', '/search?in=everything', '/search?in=cards&family=gpt', '/search?in=cards&rarity=shiny',
      '/search?in=cards&shiny=yes', '/search?in=cards&foil=0', '/search?in=cards&owner=x']) {
      const { response, markup } = await get(s, path)
      assert.equal(response.status, 400, path)
      assert.ok(!markup.includes('sort=activity') && !markup.includes('one&q=two') && !markup.includes('owner=x'), path)
    }
  })
})

// ---- the old directory -----------------------------------------------------------------------------

describe('the old players directory', () => {
  it('moves permanently to the Players tab, keeping its search and page', async () => {
    const s = server()
    for (let i = 0; i < PLAYERS_PAGE + 1; i++) await named(s, `trainer-${String(i).padStart(2, '0')}`)
    for (const [from, to] of [['/players', '/search?in=players'], ['/players?q=moss', '/search?in=players&q=moss'], ['/players?q=', '/search?in=players'], ['/players?q=a%26b%3Cc', '/search?in=players&q=a%26b%3Cc']]) {
      const response = await s.request('GET', from, { client: null })
      assert.equal(response.status, 301, from)
      assert.equal(response.headers.get('location'), to, from)
    }
    const next = nextOf((await get(s, '/search?q=trainer')).markup)!
    const after = new URL(next, 'http://localhost').searchParams.get('after')!
    const moved = await s.request('GET', `/players?q=trainer&after=${after}`, { client: null })
    assert.equal(moved.status, 301)
    assert.deepEqual(handles((await get(s, moved.headers.get('location')!)).markup), [`trainer-${PLAYERS_PAGE}`], 'an old next link still lands on its page')
  })
})

// ---- cards ---------------------------------------------------------------------------------------

describe('search: cards', () => {
  it('shows every held card as a public face linking to its page, and nothing about its owner', async () => {
    const s = server(), a = await named(s, 'card-holder'), b = await named(s, 'hidden-holder')
    await s.db.batch([
      stmt(`UPDATE players SET board_hidden = 1, rating = 876543 WHERE id = ?`, b.id),
      stmt(`UPDATE cards SET minted = '2099-12-31', locked_until = 8765432100123, tired_until = 8765432100456, raised_in = 'opus', arena_opus = 77777 WHERE owner_id = ?`, a.id),
    ])
    const { response, markup } = await get(s, '/search?in=cards'), content = body(markup)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-security-policy'), SEARCH_CSP)
    assert.match(markup, /<meta name="robots" content="noindex">/)
    assert.deepEqual(cardIds(markup), await heldIds(s), 'every held card, in random-id order')
    assert.match(content, /<label class="sr" for="search-q">Search cards by creature name<\/label>/)
    assert.match(content, /<input type="hidden" name="in" value="cards">/)
    for (const p of [a, b]) for (const hidden of [p.id, p.token, (await p.row()).handle]) assert.ok(!content.includes(hidden), 'cards name no owner')
    assert.doesNotMatch(content, /2099-12-31|8765432100|876543|77777|raisedIn|raised_in|owner|locked|tired|minted/i)
  })

  it('never shows cards nobody public holds', async () => {
    const s = server(), a = await named(s, 'keeper'), gone = await named(s, 'leaver')
    const goneCards = JSON.parse((await gone.row()).team) as string[]
    await gone.call('deleteMe', {})
    const [orphan] = await give(s, a, [card(s, 'opus', 'epic', 'orphan')])
    await s.db.batch([stmt(`UPDATE cards SET owner_id = 'no-such-player' WHERE id = ?`, orphan!)])
    const shown = await allCards(s, '/search?in=cards')
    assert.deepEqual(shown, (await s.db.all<{ id: string }>('SELECT id FROM cards WHERE owner_id = ? ORDER BY id', a.id)).map(r => r.id))
    for (const id of [...goneCards, orphan!]) assert.ok(!shown.includes(id))
  })

  it('finds cards by species or creature name, whatever the stage or case, and Mythics by their name', async () => {
    const s = server(), a = await named(s, 'namer')
    const [mythic] = await give(s, a, [generateMythic({ seed: 'search-mythic', dna: 9, now: s.now(), origin: 'catch' })])
    const cards = [...(await cardsByIds(s.db, await heldIds(s))).values()].map(c => publicCard(c.card))
    const lead = cards.find(c => c.species !== 'mythic')!, myth = cards.find(c => c.id === mythic)!
    const species = [...catalogOf(s.db).values()].flat().find(sp => sp.id === lead.species)!
    const same = cards.filter(c => c.species === lead.species).map(c => c.id).sort()
    for (const name of species.names) {
      const word = name.slice(1, -1).toUpperCase()
      const found = await allCards(s, `/search?in=cards&q=${encodeURIComponent(word)}`)
      for (const id of same) assert.ok(found.includes(id), `${word} finds ${name}`)
      for (const id of found) {
        const c = cards.find(x => x.id === id)!
        const names = c.form ? c.form.names : [...catalogOf(s.db).values()].flat().find(sp => sp.id === c.species)!.names
        assert.ok(names.some(n => n.toLowerCase().includes(word.toLowerCase())), `${id} matches ${word}`)
      }
    }
    assert.deepEqual(await allCards(s, `/search?in=cards&q=${encodeURIComponent(myth.form!.names[0].toLowerCase())}`), [mythic])
    assert.deepEqual(await allCards(s, '/search?in=cards&q=zzzzqqq'), [])
    const nothing = body((await get(s, '/search?in=cards&q=%3Cb%3Ezzz')).markup)
    assert.match(nothing, /value="&lt;b&gt;zzz"/)
    assert.doesNotMatch(nothing, /<b>zzz/)
    assert.match(nothing, /No cards match\./)
    assert.match(nothing, /href="\/search\?in=cards">see every card<\/a>/)
  })

  it('filters by family, rarity, Mythic, shiny and foil with chips that work without script', async () => {
    const s = server(), a = await named(s, 'filterer')
    await give(s, a, [
      card(s, 'opus', 'legendary', 'f1', { shiny: true, foil: true }), card(s, 'opus', 'rare', 'f2', { shiny: true }),
      card(s, 'sonnet', 'rare', 'f3', { foil: true }), card(s, 'fable', 'epic', 'f4'),
      generateMythic({ seed: 'filter-mythic', dna: 4, now: s.now(), origin: 'catch' }),
    ])
    type Row = { id: string; family: string; rarity: string; species: string; shiny: number; foil: number }
    const rows = await s.db.all<Row>('SELECT id, family, rarity, species, shiny, foil FROM cards ORDER BY id')
    const idsWhere = (keep: (r: Row) => boolean) => rows.filter(keep).map(r => r.id)
    const cases: [string, (r: Row) => boolean][] = [
      ['family=opus', r => r.family === 'opus'],
      ['rarity=rare', r => r.rarity === 'rare' && r.species !== 'mythic'],
      ['rarity=legendary', r => r.rarity === 'legendary' && r.species !== 'mythic'],
      ['rarity=mythic', r => r.species === 'mythic'],
      ['shiny=1', r => r.shiny === 1],
      ['foil=1', r => r.foil === 1],
      ['shiny=1&foil=1', r => r.shiny === 1 && r.foil === 1],
      ['family=opus&rarity=rare&shiny=1', r => r.family === 'opus' && r.rarity === 'rare' && r.species !== 'mythic' && r.shiny === 1],
      ['family=haiku&foil=1&shiny=1&rarity=legendary', r => r.family === 'haiku' && r.foil === 1 && r.shiny === 1 && r.rarity === 'legendary' && r.species !== 'mythic'],
      ['family=&rarity=&shiny=&foil=', () => true],
    ]
    for (const [query, keep] of cases) assert.deepEqual(await allCards(s, `/search?in=cards&${query}`), idsWhere(keep), query)
    assert.ok(idsWhere(r => r.species === 'mythic').length && idsWhere(r => r.shiny === 1 && r.foil === 1).length, 'the fixture covers rare cases')

    const content = body((await get(s, '/search?in=cards&q=o&family=opus&shiny=1')).markup)
    assert.match(content, /<a class="fchip" href="\/search\?in=cards&amp;q=o&amp;shiny=1" aria-current="true"><i class="sw"[^>]*><\/i><span>Opus<\/span><span class="x" aria-hidden="true"><\/span><\/a>/, 'pressing an active chip lets it go')
    assert.match(content, /<a class="fchip" href="\/search\?in=cards&amp;q=o&amp;family=haiku&amp;shiny=1"><i class="sw"/, 'another family replaces it')
    assert.match(content, /<a class="fchip" href="\/search\?in=cards&amp;q=o&amp;family=opus&amp;shiny=1&amp;foil=1">/, 'finishes add up')
    assert.match(content, /<a class="fclear" href="\/search\?in=cards&amp;q=o">Clear filters<\/a>/)
    for (const hidden of ['name="in" value="cards"', 'name="family" value="opus"', 'name="shiny" value="1"']) assert.ok(content.includes(`<input type="hidden" ${hidden}>`), `the search keeps ${hidden}`)
    assert.doesNotMatch(content, /name="rarity"|name="foil"/, 'inactive filters are not sent')
    assert.match(content, /<a class="stab" href="\/search\?q=o">/, 'switching tabs keeps the search, not the filters')
    assert.equal((body((await get(s, '/search?family=opus&shiny=1')).markup).match(/class="fchip"/g) ?? []).length, 0, 'the Players tab ignores card filters')
  })

  it('pages through every card once, with the cursor bound to the search and filters', async () => {
    const s = server(), a = await named(s, 'pager')
    await give(s, a, Array.from({ length: CARDS_PAGE + 4 }, (_, i) => card(s, 'haiku', 'common', `p${i}`)))
    const all = await heldIds(s)
    assert.ok(all.length > CARDS_PAGE + 4)
    const first = (await get(s, '/search?in=cards')).markup
    assert.equal(cardIds(first).length, CARDS_PAGE)
    assert.deepEqual(await allCards(s, '/search?in=cards'), all)
    const next = new URL(nextOf(first)!, 'http://localhost')
    assert.match(body((await get(s, next.pathname + next.search)).markup), /Back to first page/)
    for (const [k, v] of [['family', 'opus'], ['q', 'x'], ['rarity', 'rare'], ['shiny', '1'], ['foil', '1'], ['in', 'players']]) {
      const changed = new URL(next)
      changed.searchParams.set(k, v)
      assert.equal((await get(s, changed.pathname + changed.search)).response.status, 400, k)
    }
  })

  it('reads bounded windows, moving past empty ones up to a limit, so a narrow filter rarely shows an empty page', async () => {
    const s = server(), a = await named(s, 'window')
    const [template] = await give(s, a, [card(s, 'fable', 'common', 'window')])
    const columns = (await s.db.all<{ name: string }>(`SELECT name FROM pragma_table_info('cards')`)).map(c => c.name).filter(c => c !== 'id')
    // ids that sort before every random one: a foil in the third window, then one past the next five
    const at = (i: number) => `0win${String(i).padStart(5, '0')}`
    await s.db.batch([stmt(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
      INSERT INTO cards (id, ${columns.join(', ')}) SELECT printf('0win%05d', i), ${columns.join(', ')} FROM n, cards WHERE cards.id = ?`, SEARCH_WINDOW * (SEARCH_WINDOWS + 3) + 5, template!)])
    const near = at(SEARCH_WINDOW * 2 + 3), far = at(SEARCH_WINDOW * (SEARCH_WINDOWS + 3) + 3)
    await s.db.batch([stmt(`UPDATE cards SET foil = 1 WHERE id IN (?, ?)`, near, far)])
    const foils = (await s.db.all<{ id: string }>('SELECT id FROM cards WHERE foil = 1 ORDER BY id')).map(r => r.id)
    assert.deepEqual(foils.slice(0, 2), [near, far])
    const first = (await get(s, '/search?in=cards&foil=1')).markup
    assert.deepEqual(cardIds(first), [near], 'two empty windows are read past in one page')
    const second = (await get(s, nextOf(first)!)).markup
    assert.deepEqual(cardIds(second), [], `no page reads more than ${SEARCH_WINDOWS} windows`)
    assert.match(body(second), /None in this stretch\./)
    assert.ok(nextOf(second), 'but the search goes on')
    assert.deepEqual(cardIds((await get(s, nextOf(second)!)).markup), foils.slice(1, 1 + CARDS_PAGE))
    assert.deepEqual(await allCards(s, '/search?in=cards&foil=1'), foils)
    assert.deepEqual(cardIds((await get(s, '/search?in=cards')).markup), (await heldIds(s)).slice(0, CARDS_PAGE), 'a broad search fills its page from the start')
  })
})

// ---- budgets -------------------------------------------------------------------------------------

describe('search on phones', () => {
  it('drops the scenery strip so the box and the first results sit near the top', async () => {
    const s = server(), { markup } = await get(s, '/search?in=cards')
    const css = markup.match(/<style>([\s\S]*?)<\/style>/)![1]!
    assert.match(body(markup), /<div class="place" style="[^"]*" aria-hidden="true">/)
    assert.ok(css.includes('@media(max-width:599px){.place{display:none}.search{padding-top:var(--s4)}'), 'no strip under 600 px, with a little room under the header')
  })
})

describe('search budgets', () => {
  it('stays light with a full page of cards: inline CSS, page weight and first-party scripts only', async () => {
    const s = server(), a = await named(s, 'heavy')
    await give(s, a, Array.from({ length: CARDS_PAGE }, (_, i) => card(s, (['haiku', 'sonnet', 'opus', 'fable'] as const)[i % 4], 'epic', `b${i}`, { shiny: i % 3 === 0, foil: i % 2 === 0 })))
    for (const path of ['/search?in=cards', '/search']) {
      const { markup } = await get(s, path)
      const css = markup.match(/<style>([\s\S]*?)<\/style>/)![1]!
      assert.ok(gzipSync(css).length <= 18 * 1024, `${path}: inline CSS ${gzipSync(css).length} bytes gzipped`)
      assert.ok(gzipSync(markup).length <= 64 * 1024, `${path}: page ${gzipSync(markup).length} bytes gzipped`)
      for (const [, src] of markup.matchAll(/<script\b[^>]*src="([^"]+)"/g)) assert.match(src!, /^\/static\//, path)
      assert.doesNotMatch(markup, /<script>(?!<\/script>)|\son[a-z]+=|style="[^"]*url\(/i, `${path}: no inline script or remote art`)
    }
  })
})

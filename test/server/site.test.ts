// The website (SPEC 9 Shares, 12 Pages, 20, 25, 26, 29-31, 36): every page renders, every value is
// escaped, the headers are strict, only first-party scripts run (and only where they should), nothing
// loads from elsewhere, and nothing about a player shows beyond what SPEC 20 allows. Pages run on the
// real app over node:sqlite.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { sha256Hex } from '../../plugin/hooks/core/sha256.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { RULE_INFO, utcDay, worldOf } from '../../plugin/hooks/core/world.ts'
import { stmt } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { INSTALL_STEPS, PAGE_CSP, REPO, SCRIPT_CSP, SITE_CSP, SOURCE_NAME } from '../../server/src/pages-html.ts'
import { SITE_ASSETS } from '../../server/static/site.gen.ts'
import { counts, DAY, MINUTE, server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const ORIGIN = 'http://localhost:8787'

type Page = { status: number; headers: Headers; html: string }

async function get(s: Server, path: string, o: { ip?: string; token?: string } = {}): Promise<Page> {
  const res = await s.request('GET', path, { ...o, client: null })
  return { status: res.status, headers: res.headers, html: await res.text() }
}

const env = (s: Server) => ({ db: s.db, now: s.now(), randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) })

/** The strict page headers (SPEC 12), and nothing that could carry state. */
function assertHeaders(p: Page, csp = PAGE_CSP) {
  assert.match(p.headers.get('content-type') ?? '', /^text\/html; charset=utf-8$/)
  assert.equal(p.headers.get('content-security-policy'), csp)
  assert.equal(p.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(p.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(p.headers.get('x-frame-options'), 'DENY')
  assert.equal(p.headers.get('set-cookie'), null)
  for (const k of p.headers.keys()) assert.ok(!k.startsWith('access-control-'), `no CORS header (${k})`)
}

const SKY_TAG = `<script src="/static/${SITE_ASSETS.sky}"></script>`
const SITE_TAG = `<script type="module" src="/static/${SITE_ASSETS.site}"></script>`

/** Nothing loads from another origin, nothing runs inline, and only our repo is linked from outside. */
function assertSelfContained(html: string, origin = ORIGIN) {
  assert.doesNotMatch(html, /<(iframe|object|embed|form|base|meta http-equiv)\b/i)
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'no inline event handlers')
  assert.doesNotMatch(html, /javascript:/i)
  assert.doesNotMatch(html, /@import/i)
  const allowed = [' src="/static/passkey.js" defer', ` src="/static/${SITE_ASSETS.sky}"`, ` type="module" src="/static/${SITE_ASSETS.site}"`]
  for (const [, tag] of html.matchAll(/<script\b([^>]*)>/gi)) assert.ok(allowed.includes(tag!), `only first-party scripts (${tag})`)
  assert.doesNotMatch(html, /<script\b[^>]*>[^<]+<\/script>/i, 'no inline script')
  for (const [, url] of html.matchAll(/\ssrc="([^"]*)"/gi)) assert.match(url!, /^\//, `src ${url} is same-origin`)
  for (const [, tag] of html.matchAll(/<link\b([^>]*)>/gi)) assert.match(tag!, /href="data:/, 'links are inline data only')
  for (const [, url] of html.matchAll(/url\(\s*["']?([^"')]*)/gi)) assert.match(url!, /^(data:|#[a-z0-9-]+$)/, `css url ${url} is inline or in this document`)
  for (const [url] of html.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
    assert.ok(url.startsWith(REPO) || url.startsWith(origin + '/'), `${url} is our repo or this origin`)
  }
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]*)"/gi)) assert.ok(href!.startsWith('/') || href!.startsWith(REPO) || /^#[a-z0-9-]+$/.test(href!), `link ${href}`)
}

const textOf = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ ([,.])/g, '$1')

/** A site page: SITE_CSP, the sky script synchronously in <head> and the site module, once each. */
function assertSiteScripts(p: Page) {
  assertHeaders(p, SITE_CSP)
  const head = p.html.slice(0, p.html.indexOf('</head>'))
  assert.equal(head.split(SKY_TAG).length, 2, 'one synchronous sky.js in <head>')
  assert.equal(p.html.split(SITE_TAG).length, 2, 'one site.js module')
  assert.equal((p.html.match(/<script\b/g) ?? []).length, 2)
}

/** SPEC 36: marketing pages never defend themselves, and privacy and odds sit quietly in the footer. */
function assertNotDefensive(p: Page) {
  assert.doesNotMatch(textOf(p.html), /never reads|read your work|no account|no tracking|we don't|privacy promise/i)
  assert.doesNotMatch(p.html, /<meta[^>]+content="[^"]*(never reads|read your work)/i)
  assert.ok(p.html.includes('href="/privacy"') && p.html.includes('href="/odds"'))
}

async function world(o: { origin?: string } = {}) {
  const s = server(o)
  const a = await s.join('haiku')
  const b = await s.join('opus')
  return { s, a, b }
}

/** A tradeable (unbound) card for `p`, minted the way the server mints everything. */
async function looseCard(s: Server, p: Player, seed = 'loose') {
  const fresh = mintFor('sonnet', 'rare', rngFromSeed(seed), s.now(), 'trader', false)
  const { cards, stmts } = await mintCards(env(s), p.id, [fresh])
  await s.db.batch(stmts)
  return cards[0]!
}

/** A Mythic as a catch makes it: `p` found it, and the loaders name them while that handle is theirs. */
async function mythicFor(s: Server, p: Player, seed: string) {
  const { cards, stmts } = await mintCards(env(s), p.id, [generateMythic({ seed, dna: 7, now: s.now(), origin: 'catch' })])
  await s.db.batch(stmts)
  return cards[0]!
}

async function gift(s: Server, p: Player, cardId: string, code = 'quiet-otter-lamp-4821', o: { expires?: string } = {}) {
  await s.db.batch([
    stmt(`INSERT INTO gifts (code, giver_id, card_id, state, created, expires) VALUES (?, ?, ?, 'open', ?, ?)`,
      code, p.id, cardId, utcDay(s.now()), o.expires ?? utcDay(s.now() + 14 * DAY)),
    stmt(`UPDATE cards SET state = 'escrow', escrow_ref = ? WHERE id = ?`, code, cardId),
  ])
  return code
}

const EGG = { type: 'egg', promo: { seed: 'founders-1', name: 'Founderling', family: 'fable', rarity: 'rare', foil: true, stamp: 'Founder, Oct 2026' } }

async function drop(s: Server, o: { plain?: string | null; reward?: unknown; supply?: number | null; redeemed?: number; startsIn?: number; endsIn?: number } = {}) {
  const plain = o.plain === undefined ? 'FOUNDERS' : o.plain
  await s.db.batch([stmt(
    `INSERT INTO drops (id, code_hash, code_plain, kind, reward_json, supply, redeemed, bound, starts_at, ends_at, created_at)
     VALUES (?, ?, ?, 'public', ?, ?, ?, 1, ?, ?, 0)`,
    `d-${plain ?? 'unique'}`, sha256Hex(plain ?? 'GOLDEN7Q2MK9XD'), plain, JSON.stringify(o.reward ?? [EGG, { type: 'pack', count: 1 }]),
    o.supply === undefined ? 1500 : o.supply, o.redeemed ?? 204, s.now() + (o.startsIn ?? -DAY), s.now() + (o.endsIn ?? 7 * DAY),
  )])
}

// ---- every page --------------------------------------------------------------------------------

describe('site pages', () => {
  it('render as strict pages: first-party scripts on site pages, none on /odds, /privacy and "not here"', async () => {
    const { s, a } = await world()
    const card = await mythicFor(s, a, 'aa11')
    const code = await gift(s, a, (await looseCard(s, a)).id)
    await drop(s)
    const scripted = ['/', `/u/${a.me.player.handle}`, `/c/${card.id}`, `/g/${code}`, '/d/founders', '/w/20261002-dusk-abcdefgh']
    const quiet = ['/odds', '/privacy']
    for (const path of [...scripted, ...quiet]) {
      const p = await get(s, path)
      assert.equal(p.status, 200, path)
      if (scripted.includes(path)) assertSiteScripts(p)
      else {
        assertHeaders(p)
        assert.doesNotMatch(p.html, /<script/i, `${path} has no script`)
      }
      assertSelfContained(p.html)
      assert.match(p.html, /^<!doctype html>\n<html lang="en"[ >]/)
      assert.match(p.html, /<meta name="viewport" content="width=device-width, initial-scale=1">/)
      assert.match(p.html, /<meta name="color-scheme" content="light dark">/)
      assert.match(p.html, /<title>[^<]+<\/title>/)
    }
    for (const path of ['/u/nobody-here-11', '/c/zzzzzzzzzzzzzzzzzzzzzzzzzz', '/g/no-such-gift-0000', '/d/nothing', '/w/not-a-seed', '/static/site.nope.js', '/og/meadow-19990101.png']) {
      const p = await get(s, path)
      assert.equal(p.status, 404, path)
      assertHeaders(p)
      assertSelfContained(p.html)
      assert.doesNotMatch(p.html, /<script/i, `${path}: the "not here" page runs nothing`)
      assert.match(p.html, /<meta name="robots" content="noindex">/)
      assert.match(textOf(p.html), /Nothing in this patch of grass\./)
      assert.ok(p.html.includes('<a class="back" href="/">Back to the meadow</a>'))
    }
  })

  it('carry the one-line install and open-source links, and never a defensive word, on the marketing pages', async () => {
    const { s, a } = await world()
    const p = await get(s, '/')
    const text = textOf(p.html)
    for (const step of INSTALL_STEPS) assert.ok(text.includes(step), `the SPEC 34 install step: ${step}`)
    assert.match(p.html, /class="w">416rehman\/spinlings<\/span>/, 'the command never breaks inside a word')
    assert.ok(p.html.includes(`href="${REPO}"`))
    assert.equal(p.headers.get('cache-control'), 'public, max-age=60')
    assert.match(p.html, /@media \(prefers-color-scheme:dark\)/)
    assert.match(p.html, /@media \(prefers-reduced-motion:reduce\)/)
    assert.match(p.html, /<title>Spinlings: wild creatures that find you while Claude works<\/title>/)
    assert.ok(text.includes('Wild creatures find you while Claude works.'), 'the pixel H1 keeps its real words')
    assert.ok(p.html.includes('<a class="skip" href="#install-cmd">Skip to the install command</a>'))
    for (const id of ['meet', 'battle', 'collect', 'trade', 'install']) assert.match(p.html, new RegExp(`<section [^>]*id="${id}" aria-labelledby="${id}-h"`))
    const card = await mythicFor(s, a, 'nd01')
    const code = await gift(s, a, (await looseCard(s, a)).id)
    await drop(s)
    for (const path of ['/', `/c/${card.id}`, `/g/${code}`, '/d/founders', '/w/20261002-morning-abcdefgh']) assertNotDefensive(await get(s, path))
  })

  it('show the source in every header: the GitHub mark, named at every width, one plain link to the repo', async () => {
    const { s, a } = await world()
    const card = await mythicFor(s, a, 'gh01')
    const code = await gift(s, a, (await looseCard(s, a)).id)
    await drop(s)
    const ticket = (url: string) => new URL(url).searchParams.get('t')!
    const add = ticket((await a.call('passkeyStart', {})).url)
    const signin = ticket((await s.call('authStart', {})).url)
    const pages: [string, number][] = [
      ['/', 200], ['/odds', 200], ['/privacy', 200], [`/u/${a.me.player.handle}`, 200], [`/c/${card.id}`, 200], [`/g/${code}`, 200],
      ['/d/founders', 200], ['/w/20261002-dusk-abcdefgh', 200], [`/passkey/add?t=${add}`, 200], [`/passkey/signin?t=${signin}`, 200],
      ['/u/nobody-here-11', 404], ['/w/not-a-seed', 404],
    ]
    for (const [path, status] of pages) {
      const p = await get(s, path)
      assert.equal(p.status, status, path)
      const links = [...p.html.matchAll(/<a class="gh"[^>]*>([\s\S]*?)<\/a>/g)]
      assert.equal(links.length, 1, `${path}: one way to the source`)
      const [tag, inner] = [links[0]![0], links[0]![1]!]
      const header = p.html.slice(p.html.indexOf('<header class="top" id="top">'), p.html.indexOf('</header>'))
      assert.ok(header.includes(tag), `${path}: it sits in the top bar`)
      assert.ok(tag.startsWith('<a class="gh" href="https://github.com/416rehman/spinlings" aria-label="Open source on GitHub">'), `${path}: a plain link to the repo, named (${tag.slice(0, 120)})`)
      assert.doesNotMatch(tag.slice(0, tag.indexOf('>')), /target=|js-only|hidden/, `${path}: same tab, there without script`)
      // the mark is drawn inline and says nothing itself; the words the link shows begin its name
      assert.match(inner, /^<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0C3\.58 0 0 3\.58 0 8c0 3\.54[^"]+"\/><\/svg>/, path)
      assert.doesNotMatch(inner, /xmlns|href|url\(/, `${path}: the mark asks nobody for anything`)
      const shown = textOf(inner).trim()
      assert.equal(shown, 'Open source')
      assert.equal(SOURCE_NAME, 'Open source on GitHub', 'the name keeps the visible words and says where it goes')
      assert.doesNotMatch(p.html.match(/<style>([\s\S]*?)<\/style>/)![1]!, /\/\*/, `${path}: the stylesheet ships without its notes`)
    }
    // the words show from 1024 px; narrower, the mark stands alone and the name still reads in full
    const css = (await get(s, '/')).html.match(/<style>([\s\S]*?)<\/style>/)![1]!
    assert.ok(css.includes('.ghl{display:none}') && css.includes('@media (min-width:1024px){.ghl{display:inline}}'))
    assert.ok(css.includes('.gh:focus-visible::before{outline:3px solid'), 'a focus ring round the frame')
    // a tap is not a hover: the lit state answers a real pointer only, so it never sticks on a phone
    assert.ok(css.includes('@media (hover:hover){.gh:hover::before{'), 'hover lives behind (hover:hover)')
    assert.doesNotMatch(css.replace(/@media \(hover:hover\)\{[^@]*?\}\}/g, ''), /\.gh:hover/, 'no hover rule outside it')
    // the sparkle rides the focus ring's corner rather than breaking it
    assert.ok(css.includes('.gh:focus-visible::after{opacity:1;animation:twk 1.8s steps(1) infinite;right:-6px;top:calc(var(--fy) - 8px)}'))
  })

  it('answer HEAD like GET without a body, and refuse other methods', async () => {
    const { s } = await world()
    const head = await s.request('HEAD', '/')
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
    assert.equal(head.headers.get('content-security-policy'), SITE_CSP)
    const post = await s.request('POST', '/', { body: {} })
    assert.equal(post.status, 405)
    assert.equal((await s.request('DELETE', '/u/someone-11')).status, 405)
  })

  it('change nothing, whoever asks: every page leaves every table exactly as it was', async () => {
    const { s, a, b } = await world()
    const card = await mythicFor(s, a, 'ee55')
    const code = await gift(s, a, (await looseCard(s, a)).id)
    await drop(s)
    const ticket = (url: string) => new URL(url).searchParams.get('t')!
    const add = ticket((await a.call('passkeyStart', {})).url)
    const signin = ticket((await s.call('authStart', {})).url)
    const paths = [
      '/', '/odds', '/privacy', `/u/${a.me.player.handle}`, `/c/${card.id}`, `/c/${card.id}.png`, `/g/${code}`, '/d/founders',
      `/passkey/add?t=${add}`, `/passkey/signin?t=${signin}`, '/static/passkey.js', `/static/${SITE_ASSETS.site}`,
      '/w/20261002-night-abcdefgh', '/w/20261002-night-abcdefgh.png', '/og/meadow-20261002.png',
    ]
    for (const path of paths) await get(s, path) // the first visit may freeze the season
    const tables = (await s.db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)).map(r => r.name)
    const dump = async () => JSON.stringify(await Promise.all(tables.map(t => s.db.all(`SELECT * FROM ${t} ORDER BY 1`))))
    const before = await dump()
    for (const token of [undefined, a.token, b.token]) {
      for (const path of paths) assert.ok([200, 410].includes((await get(s, path, token ? { token } : {})).status), path)
    }
    assert.equal(await dump(), before)
  })

  it('ignore credentials entirely: the same page with or without a session, and never a cookie', async () => {
    const { s, a } = await world()
    for (const path of ['/', `/u/${a.me.player.handle}`, `/c/${a.me.player.team[0]}`]) {
      const anon = await get(s, path)
      const signed = await get(s, path, { token: a.token })
      assert.equal(signed.html, anon.html, path)
      assert.equal(signed.headers.get('set-cookie'), null)
    }
  })
})

// ---- escaping ----------------------------------------------------------------------------------

describe('site escaping', () => {
  const EVIL = `<script>alert(1)</script>"'&<img src=x>`

  it('escapes every value that comes from the database', async () => {
    const { s, a } = await world()
    const card = await mythicFor(s, a, 'bb22')
    const evilHandle = `x"><b>${'y'}`
    await s.db.batch([
      stmt('UPDATE mythics SET name = ?, handle = ? WHERE card_id = ?', EVIL, evilHandle, card.id),
      stmt('UPDATE players SET handle = ? WHERE id = ?', evilHandle, a.id),
    ])
    const landing = await get(s, '/')
    assert.ok(landing.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;&lt;img src=x&gt;'))
    assert.ok(landing.html.includes('x&quot;&gt;&lt;b&gt;y'))
    assert.doesNotMatch(landing.html, /<script>alert|<img src=x|x"><b>y/)
    assertSelfContained(landing.html)

    // a card whose embedded form carries markup in its names
    const fusion = await looseCard(s, a, 'fz')
    const form = { kind: 'fusion', family: 'opus', body: 'blob', hue: 10, pattern: 'none', accessory: 'horns', base: { hp: 30, atk: 10, def: 10, spd: 10 },
      names: [EVIL, EVIL, EVIL], legendary: false, parents: ['s1-haiku-0', 's1-opus-1'] }
    await s.db.batch([stmt(`UPDATE cards SET species = 'fusion', form = ?, stage = 1 WHERE id = ?`, JSON.stringify(form), fusion.id)])
    const page = await get(s, `/c/${fusion.id}`)
    assert.equal(page.status, 200)
    assert.doesNotMatch(page.html, /<script>alert|<img src=x/)
    assert.ok(page.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
    assertSelfContained(page.html)
  })

  it('escapes a drop stamp, and never reflects a code or ticket it does not know', async () => {
    const { s } = await world()
    await drop(s, { reward: { type: 'egg', promo: { ...EGG.promo, stamp: `Founder <i>"&'</i>` } } })
    const p = await get(s, '/d/FOUNDERS')
    assert.equal(p.status, 200)
    assert.ok(p.html.includes('Founder &lt;i&gt;&quot;&amp;&#39;&lt;/i&gt;'))
    assert.doesNotMatch(p.html, /<i>"/)
    for (const path of ['/passkey/add?t=%3Cscript%3Ealert(1)%3C%2Fscript%3E', '/u/%3Cscript%3E', '/g/%3Cb%3E-x-y-1234', '/c/%22onload%3D']) {
      const page = await get(s, path)
      assert.ok(page.status === 404 || page.status === 410, path)
      assert.doesNotMatch(page.html, /<script>alert|<b>|"onload=/i, path)
    }
  })
})

// ---- the landing page --------------------------------------------------------------------------

describe('landing page', () => {
  it("shows today's rule and featured species, and the season with silhouettes for the unfound", async () => {
    const { s, a } = await world()
    const w = worldOf(s.now())
    const p = await get(s, '/')
    const text = textOf(p.html)
    assert.ok(text.includes(RULE_INFO[w.rule].name))
    const species = seasonSpecies(w.season)
    const featured = species.find(x => x.id === w.featured)!
    assert.ok(text.includes(`A wild ${featured.names[0]} appeared!`))
    const found = new Set((await s.db.all<{ species: string }>('SELECT species FROM firsts')).map(r => r.species))
    assert.ok(found.size >= 3, 'the starters were first finds')
    for (const sp of species) {
      const shown = text.includes(` ${sp.names[0]} `)
      if (found.has(sp.id) || sp.id === w.featured) assert.ok(shown, `${sp.id} found or featured: named`)
      else assert.ok(!shown, `${sp.id} unfound: no name, only its shadow`)
    }
    assert.ok(text.includes(`${found.size} of 36 found`))
    assert.equal((p.html.match(/<li class="nk unfound/g) ?? []).length, 36 - found.size)
    assert.equal((p.html.match(/<li class="nk found/g) ?? []).length, found.size)
    // an unfound species is a plain silhouette: one currentColor path, never its colours
    for (const nook of p.html.split('<li class="nk unfound').slice(1)) assert.match(nook.slice(0, nook.indexOf('</li>')), /<svg class="shd"[^>]*><path fill="currentColor" d="[^"]*"\/><\/svg>/)
    assert.ok(text.includes(`Season ${w.season}`))
    assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}\b/, 'no dates anywhere')
    void a
  })

  it('lists Mythics found as handle and name only, and forgets a finder who rerolls or leaves', async () => {
    const { s, a, b } = await world()
    const m = await mythicFor(s, a, 'cc33')
    const name = m.form!.names[2]
    let text = textOf((await get(s, '/')).html)
    assert.ok(text.includes(`${name} found by ${a.me.player.handle}`))
    assert.ok(text.includes('1 so far'))
    assert.ok(!text.includes(m.id) && !(await get(s, '/')).html.includes(m.id), 'no card id')
    // a new handle never shows beside the old one: the list and the card stop naming the finder
    const { handle } = await a.call('rerollHandle', {})
    for (const html of [(await get(s, '/')).html, (await get(s, `/c/${m.id}`)).html]) {
      assert.ok(!html.includes(a.me.player.handle) && !html.includes(handle))
    }
    assert.ok(textOf((await get(s, '/')).html).includes(`${name} found by a trainer`))
    assert.ok(textOf((await get(s, `/c/${m.id}`)).html).includes('Discovered by a trainer'))
    const b2 = await mythicFor(s, b, 'dd44')
    await b.call('deleteMe', {})
    text = textOf((await get(s, '/')).html)
    assert.ok(text.includes(`${b2.form!.names[2]} found by a trainer`))
    assert.ok(!text.includes(b.me.player.handle))
  })

  it('hangs a string of dark lanterns for the first Mythic instead of an empty list', async () => {
    const { s } = await world()
    const html = (await get(s, '/')).html
    const text = textOf(html)
    assert.ok(text.includes('The first Mythic lights a lantern.'))
    assert.doesNotMatch(text, /0 so far|Mythics found/, 'no empty stall')
    assert.equal((html.match(/class="lantern unlit"/g) ?? []).length, 12, 'a full string of lanterns, all dark')
    assert.doesNotMatch(html, /class="lantern l\d+"/)
    assert.ok(!html.includes('class="mythlist"'))
  })

  it('lights one lantern per Mythic, middle first, each tied to its line in the list', async () => {
    const { s, a } = await world()
    for (const seed of ['ln01', 'ln02', 'ln03']) await mythicFor(s, a, seed)
    const html = (await get(s, '/')).html
    assert.equal((html.match(/class="lantern unlit"/g) ?? []).length, 9)
    for (const i of [0, 1, 2]) {
      assert.equal((html.match(new RegExp(`class="lantern l${i}"`, 'g')) ?? []).length, 1, `lantern ${i}`)
      assert.match(html, new RegExp(`<li class="m${i}"><b>`), `list line ${i}`)
    }
    // the list hangs right under the string, before the Trader's cart
    assert.ok(html.indexOf('class="mythlist"') < html.indexOf('class="cart"'))
    assert.ok(html.indexOf('class="lstring"') < html.indexOf('class="mythlist"'))
  })

  it('freezes the season once when many first visits race, and every visit agrees', async () => {
    const s = server()
    const pages = await Promise.all(Array.from({ length: 6 }, (_, i) => get(s, '/', { ip: `203.0.113.${i}` })))
    for (const p of pages) assert.equal(p.status, 200)
    const gallery = (h: string) => h.slice(h.indexOf('id="collect"'), h.indexOf('id="trade"'))
    for (const p of pages) assert.equal(gallery(p.html), gallery(pages[0]!.html))
    assert.deepEqual(await counts(s.db, ['seasons']), { seasons: 1 })
  })
})

// ---- profiles ----------------------------------------------------------------------------------

describe('profile pages', () => {
  it('show exactly the public profile: handle, league, team, for-trade cards and album count', async () => {
    const { s, a } = await world()
    const loose = await looseCard(s, a)
    await s.db.batch([
      stmt('UPDATE players SET rating = 1555, sparks = 98765, battles = 4321, streak = 17 WHERE id = ?', a.id),
      stmt('UPDATE cards SET for_trade = 1 WHERE id = ?', loose.id),
      // a bound card is never on offer, whatever its flag says
      stmt('UPDATE cards SET for_trade = 1 WHERE id = ?', a.me.player.team[0]!),
    ])
    // a profile shows the numbers of the last UTC midnight, so the new rating's league shows from the next one
    s.set((Math.floor(s.now() / DAY) + 1) * DAY)
    const p = await get(s, `/u/${a.me.player.handle}`)
    assert.equal(p.status, 200)
    assertHeaders(p, SITE_CSP)
    assert.match(p.html, /<meta name="robots" content="noindex">/)
    const text = textOf(p.html)
    assert.ok(text.includes(a.me.player.handle))
    assert.ok(text.includes('Peak league'))
    const album = (await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM album WHERE player_id = ?', a.id))!.n
    assert.ok(text.includes(`${album} species in their album`))
    for (const secret of ['1555', '98765', '4321', ' 17 ', a.me.player.joinedDay]) assert.ok(!text.includes(secret), `never shows ${secret}`)
    assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}\b|\b(sparks|rating|battles|won|joined|last seen)\b/i)
    assert.equal((p.html.match(/<ul class="campers circle">(.*?)<\/ul>/s)?.[1]?.match(/<li class="camper">/g) ?? []).length, 3, 'three around the fire')
    assert.equal((text.match(/league/g) ?? []).length, 1, 'one league badge')
    assert.equal((p.html.match(/<li class="tile">/g) ?? []).length, 1, 'and the one free card pinned for trade')
    assert.ok(text.includes(`/spin trade ${a.me.player.handle}`))
    assert.match(p.html, /<pre aria-label="The trade command"><span class="gt" aria-hidden="true">&gt;<\/span><code>[\s\S]*?<\/pre><button class="pbtn copy js-only" type="button" data-copy>/, 'a prompt line to copy')
    assert.ok(p.html.includes(`href="/c/${loose.id}"`))
  })

  it('treat unknown, malformed and retired handles the same', async () => {
    const { s, a } = await world()
    const old = a.me.player.handle
    await s.db.batch([stmt('UPDATE players SET handle = ? WHERE id = ?', 'brand-new-handle-77', a.id), stmt('INSERT INTO retired_handles (handle, until) VALUES (?, ?)', old, '2099-01-01')])
    const bodies = new Set<string>()
    for (const h of [old, 'never-was-here-12', 'Bad%20Handle', 'a'.repeat(41)]) {
      const p = await get(s, `/u/${h}`)
      assert.equal(p.status, 404, h)
      bodies.add(p.html)
    }
    assert.equal(bodies.size, 1, 'one indistinguishable "not here" page')
    assert.equal((await get(s, '/u/brand-new-handle-77')).status, 200)
  })

  it('are rate limited per address, like profile lookups', async () => {
    const { s, a } = await world()
    const path = `/u/${a.me.player.handle}`
    for (let i = 0; i < 60; i++) assert.equal((await get(s, path, { ip: '198.18.0.9' })).status, 200)
    const limited = await s.request('GET', path, { ip: '198.18.0.9', client: null })
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
    assert.equal((await get(s, path, { ip: '198.18.0.10' })).status, 200, 'another address is unaffected')
    s.tick(MINUTE)
    assert.equal((await get(s, path, { ip: '198.18.0.9' })).status, 200, 'and it refills')
  })
})

// ---- cards -------------------------------------------------------------------------------------

describe('card pages', () => {
  it('show the public card, unfurl with og tags, and never name the owner', async () => {
    const { s, a, b } = await world({ origin: 'https://spinlings.dev' })
    // b found it, a holds it now
    const m = await mythicFor(s, b, 'dd44')
    await s.db.batch([stmt('UPDATE cards SET owner_id = ? WHERE id = ?', a.id, m.id)])
    const p = await get(s, `/c/${m.id}`)
    assert.equal(p.status, 200)
    assertHeaders(p, SITE_CSP)
    assertSelfContained(p.html, 'https://spinlings.dev')
    assert.ok(p.html.includes(`<meta property="og:image" content="https://spinlings.dev/c/${m.id}.png">`))
    assert.ok(p.html.includes(`<meta property="og:url" content="https://spinlings.dev/c/${m.id}">`))
    assert.ok(p.html.includes('<meta name="twitter:card" content="summary_large_image">'))
    assert.ok(p.html.includes(`<meta property="og:title" content="${m.form!.names[2]}, a mythic`))
    const text = textOf(p.html)
    assert.ok(text.includes(m.form!.names[2]!) && text.includes('Final form') && text.includes('Mythic, 1 of 1') && text.includes('Foil'))
    assert.ok(text.includes(`Discovered by ${b.me.player.handle}`), 'its finder')
    assert.ok(!text.includes(a.me.player.handle), 'no owner')
    assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}\b|Raised under|minted|locked|tired/i)
    assert.doesNotMatch(p.html, /undefined|null/, 'every stamp is words')
  })

  it('draw a 1200 x 630 og:image PNG', async () => {
    const { s, a } = await world()
    const res = await s.request('GET', `/c/${a.me.player.team[0]}.png`, { client: null })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600')
    const png = new Uint8Array(await res.arrayBuffer())
    assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(png.buffer, png.byteOffset)
    assert.deepEqual([view.getUint32(16), view.getUint32(20)], [1200, 630])
    assert.equal((await s.request('GET', '/c/nope.png', { client: null })).status, 404)
    assert.equal((await s.request('GET', `/c/${a.me.player.team[0]}.png.png`, { client: null })).status, 404)
  })

  it('treat recycled, unknown and malformed cards the same', async () => {
    const { s, a } = await world()
    const loose = await looseCard(s, a)
    await s.db.batch([stmt('DELETE FROM cards WHERE id = ?', loose.id)])
    const bodies = new Set<string>()
    for (const id of [loose.id, 'abcdefghijklmnopqrstuvwxyz', 'not*an*id']) {
      const p = await get(s, `/c/${id}`)
      assert.equal(p.status, 404)
      bodies.add(p.html)
    }
    assert.equal(bodies.size, 1)
  })
})

// ---- gifts -------------------------------------------------------------------------------------

describe('gift pages', () => {
  it("show an open gift's card and how to claim it, never who sent it", async () => {
    const { s, a } = await world()
    const card = await looseCard(s, a)
    const code = await gift(s, a, card.id)
    const p = await get(s, `/g/${code}`)
    assert.equal(p.status, 200)
    assertHeaders(p, SITE_CSP)
    assert.equal(p.headers.get('cache-control'), 'no-store', 'the URL is the secret')
    assert.match(p.html, /<meta name="robots" content="noindex">/)
    const text = textOf(p.html)
    assert.ok(text.includes(`/spin claim ${code}`))
    for (const step of INSTALL_STEPS) assert.ok(text.includes(step))
    assert.ok(!text.includes(a.me.player.handle), 'never the giver')
    assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}\b/, 'no dates')
    assert.ok(p.html.includes(`<meta property="og:image" content="${ORIGIN}/c/${card.id}.png">`))
  })

  it('look the same once claimed, cancelled, expired, moved or never made', async () => {
    const { s, a, b } = await world()
    const codes = {
      claimed: await gift(s, a, (await looseCard(s, a, 'g1')).id, 'one-two-three-0001'),
      cancelled: await gift(s, a, (await looseCard(s, a, 'g2')).id, 'one-two-three-0002'),
      expired: await gift(s, a, (await looseCard(s, a, 'g3')).id, 'one-two-three-0003', { expires: utcDay(s.now()) }),
      moved: await gift(s, a, (await looseCard(s, a, 'g4')).id, 'one-two-three-0004'),
    }
    await s.db.batch([
      stmt(`UPDATE gifts SET state = 'claimed', claimed_by = ? WHERE code = ?`, b.id, codes.claimed),
      stmt(`UPDATE gifts SET state = 'cancelled' WHERE code = ?`, codes.cancelled),
      stmt(`UPDATE cards SET owner_id = ?, state = 'owned', escrow_ref = NULL WHERE escrow_ref = ?`, b.id, codes.moved),
    ])
    const bodies = new Set<string>()
    for (const code of [...Object.values(codes), 'never-made-here-9999', 'NOT-A-CODE']) {
      const p = await get(s, `/g/${code}`)
      assert.equal(p.status, 404, code)
      assert.equal(p.headers.get('cache-control'), 'no-store')
      bodies.add(p.html)
    }
    assert.equal(bodies.size, 1, 'one indistinguishable page')
  })
})

// ---- drops -------------------------------------------------------------------------------------

describe('drop pages', () => {
  it('show a public drop: the creature in shadow, live counts and how to redeem, never who redeemed', async () => {
    const { s, a } = await world()
    await drop(s)
    await s.db.batch([stmt('INSERT INTO redemptions (drop_id, player_id, day) VALUES (?, ?, ?)', 'd-FOUNDERS', a.id, utcDay(s.now()))])
    let p = await get(s, '/d/founders')
    assert.equal(p.status, 200)
    assertHeaders(p, SITE_CSP)
    let text = textOf(p.html)
    assert.ok(text.includes('FOUNDERS'))
    assert.ok(text.includes('204 hatched so far, 1,296 left in the nest.'))
    assert.ok(text.includes('/spin redeem FOUNDERS'))
    assert.ok(text.includes('Founder, Oct 2026'))
    assert.ok(!text.includes('Founderling'), 'the creature stays a silhouette until it hatches')
    assert.ok(!text.includes(a.me.player.handle))
    assert.match(p.html, /role="img" aria-label="A creature still in its egg"/)
    assert.equal(p.headers.get('cache-control'), 'public, max-age=30')
    // the count is live, and codes are read the way the mod normalises them
    await s.db.batch([stmt('UPDATE drops SET redeemed = 205')])
    text = textOf((await get(s, '/d/Found-ers')).html)
    assert.ok(text.includes('205 hatched so far, 1,295 left in the nest.'))
    // supply gone: ended
    await s.db.batch([stmt('UPDATE drops SET redeemed = 1500')])
    p = await get(s, '/d/FOUNDERS')
    assert.equal(p.status, 200)
    assert.match(textOf(p.html), /This drop has ended/)
    assert.ok(!textOf(p.html).includes('/spin redeem'))
  })

  it('end on time, say nothing before they start, and have no page for unique or broken codes', async () => {
    const s = server()
    await drop(s, { plain: 'LATER', startsIn: DAY })
    await drop(s, { plain: 'OVER', endsIn: -1 })
    await drop(s, { plain: null })
    await drop(s, { plain: 'BROKEN', reward: { type: 'egg', promo: { seed: 'x' } } })
    await drop(s, { plain: 'PACKS', reward: { type: 'pack', count: 2, family: 'opus' }, supply: null })
    const bodies = new Set<string>()
    for (const code of ['LATER', 'GOLDEN-7Q2M-K9XD', 'BROKEN', 'NOPE', 'bad*code']) {
      const p = await get(s, `/d/${code}`)
      assert.equal(p.status, 404, code)
      bodies.add(p.html)
    }
    assert.equal(bodies.size, 1)
    assert.match(textOf((await get(s, '/d/over')).html), /This drop has ended/)
    const packs = textOf((await get(s, '/d/packs')).html)
    assert.ok(packs.includes('Redeem PACKS in Spinlings for 2 Opus packs.'))
    assert.ok(packs.includes('204 hatched so far.'), 'no supply, no "left"')
  })
})

// ---- passkey pages and the static script ----------------------------------------------------------

describe('passkey pages', () => {
  const ticketOf = (url: string) => new URL(url).searchParams.get('t')!

  it('carry one first-party script, the phishing warning and the domain, for a live ticket only', async () => {
    const { s, a } = await world()
    const { url } = await a.call('passkeyStart', {})
    const add = await get(s, `/passkey/add?t=${ticketOf(url)}`)
    assert.equal(add.status, 200)
    assertHeaders(add, SCRIPT_CSP)
    assertSelfContained(add.html)
    assert.equal(add.headers.get('cross-origin-opener-policy'), 'same-origin')
    assert.equal(add.headers.get('cache-control'), 'no-store')
    assert.equal((add.html.match(/<script\b/g) ?? []).length, 1)
    assert.ok(add.html.includes('<script src="/static/passkey.js" defer></script>'))
    assert.match(textOf(add.html), /You are on localhost:8787/)
    assert.match(textOf(add.html), /If someone sent you this link, close this page/)
    const options = JSON.parse(add.html.match(/data-options="([^"]*)"/)![1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'))
    assert.equal(options.rp.id, 'localhost')
    assert.equal(options.user.name, 'Spinlings', 'nothing that names the player')
    assert.ok(!add.html.includes(a.me.player.handle))

    const { url: signinUrl } = await s.call('authStart', {})
    const signin = await get(s, `/passkey/signin?t=${ticketOf(signinUrl)}`)
    assert.equal(signin.status, 200)
    assertHeaders(signin, SCRIPT_CSP)
    assert.ok(textOf(signin.html).includes(
      'You are signing in to Spinlings on your own computer. If someone sent you this link, close this page: continuing would give them your account.',
    ))

    // the other flow's ticket, no ticket, a made-up one, and an expired one: all "expired", with no script
    const expired = [
      `/passkey/signin?t=${ticketOf(url)}`, '/passkey/add', '/passkey/add?t=', `/passkey/add?t=${'a'.repeat(26)}`,
    ]
    s.tick(11 * MINUTE)
    expired.push(`/passkey/add?t=${ticketOf(url)}`, `/passkey/signin?t=${ticketOf(signinUrl)}`)
    for (const path of expired) {
      const p = await get(s, path)
      assert.equal(p.status, 410, path)
      assertHeaders(p)
      assert.doesNotMatch(p.html, /<script/)
      assert.match(textOf(p.html), /This link has expired/)
    }
  })

  it('serve the script as a first-party file that talks only to this origin', async () => {
    const { s } = await world()
    const res = await s.request('GET', '/static/passkey.js', { client: null })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    const js = await res.text()
    assert.doesNotThrow(() => new Function(js), 'it parses')
    assert.doesNotMatch(js, /https?:|['"`]\/\//i, 'no URL to anywhere else')
    assert.doesNotMatch(js, /\beval\b|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write|localStorage|sessionStorage|cookie|indexedDB|location/)
    assert.deepEqual([...js.matchAll(/'(\/[a-z/]+)'/g)].map(m => m[1]), ['/passkey/add/finish', '/passkey/signin/finish'])
  })
})

// ---- reference pages ---------------------------------------------------------------------------

describe('reference pages', () => {
  it('/odds publishes the rates the server rolls with', async () => {
    const { s } = await world()
    const text = textOf((await get(s, '/odds')).html)
    const E = ECONOMY
    for (const want of [
      `1 in ${Math.round(1 / E.wild.mythicChance)}`, `1 in ${Math.round(1 / E.shiny.chance)}`, `1 in ${Math.round(1 / E.foil.chance)}`,
      `${E.battle.catchChance * 100}%`, `${E.packs.odds[0]![1]}%`, `${E.packs.lastSlotOdds[0]![1]}%`, `${E.wild.rarity[0]![1]}%`,
      `${E.packs.bank} unopened packs`, `${E.battle.bountyChance * 100}%`,
    ]) assert.ok(text.includes(want), want)
  })

  it('/privacy states what is kept and what others see', async () => {
    const { s } = await world()
    const text = textOf((await get(s, '/privacy')).html)
    for (const want of ['Never kept: your IP address', 'Never visible to anyone else', '/spin privacy', 'handle, team, cards marked for trade, album count and league']) {
      assert.ok(text.includes(want), want)
    }
  })
})

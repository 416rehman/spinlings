// The site's craft (SPEC 36): the details a visitor meets first. Unknown addresses get the tuft page,
// headings are the bold pixel cut with each letter shape sent once, the bubble keeps its spaces, pack
// cards keep their names, section links clear the sticky header, the album is one Tab stop per family,
// an empty season invites instead of looking abandoned, the third spot is saved, the battle frame shows
// Claude at work, and a card page puts the card itself up front.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { boldGlyph } from '../../server/src/pages-font.ts'
import { PAGE_CSP, REPO } from '../../server/src/pages-html.ts'
import { SITE_ASSETS, SITE_FILES } from '../../server/static/site.gen.ts'
import { server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

type Page = { status: number; headers: Headers; html: string }

async function get(s: Server, path: string, headers: Record<string, string> = {}): Promise<Page> {
  const res = await s.request('GET', path, { client: null, headers })
  return { status: res.status, headers: res.headers, html: await res.text() }
}

const textOf = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ ([,.])/g, '$1')
const css = (html: string) => html.match(/<style>([\s\S]*?)<\/style>/)![1]!

async function world() {
  const s = server()
  const a = await s.join('haiku')
  return { s, a }
}

async function mythicFor(s: Server, p: Player, seed: string) {
  const env = { db: s.db, now: s.now(), randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) }
  const { cards, stmts } = await mintCards(env, p.id, [generateMythic({ seed, dna: 7, now: s.now(), origin: 'catch' })])
  await s.db.batch(stmts)
  return cards[0]!
}

const BROWSER = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

/** Every start tag with its attributes, and whether it or anything around it is js-only (gone without script). */
function tags(html: string): { tag: string; attrs: string; jsOnly: boolean }[] {
  const stack: boolean[] = []
  const out: { tag: string; attrs: string; jsOnly: boolean }[] = []
  for (const [, close, tag, attrs, self] of html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script\b[\s\S]*?<\/script>/g, '').matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    if (close) { stack.pop(); continue }
    const jsOnly = /\bclass="[^"]*\bjs-only\b/.test(attrs!) || stack.at(-1) === true
    out.push({ tag: tag!, attrs: attrs!, jsOnly })
    if (!self && !VOID.has(tag!.toLowerCase())) stack.push(jsOnly)
  }
  assert.equal(stack.length, 0, 'every element closes')
  return out
}

describe('site craft', () => {
  it('answers an unknown address with the tuft page for a browser, and JSON for everything else', async () => {
    const { s } = await world()
    const pages = new Set<string>()
    for (const path of ['/nope-zq91', '/instal-xk', '/oddz', '/PRIVACYQ']) {
      const p = await get(s, path, BROWSER)
      assert.equal(p.status, 404, path)
      assert.match(p.headers.get('content-type')!, /^text\/html; charset=utf-8$/)
      assert.equal(p.headers.get('content-security-policy'), PAGE_CSP)
      assert.equal(p.headers.get('x-content-type-options'), 'nosniff')
      assert.doesNotMatch(p.html, /<script/i, `${path}: the "not here" page runs nothing`)
      assert.doesNotMatch(p.html, /https?:\/\/(?!github\.com\/416rehman\/spinlings)/, `${path}: nothing from elsewhere`)
      assert.match(p.html, /<meta name="robots" content="noindex">/)
      assert.match(textOf(p.html), /Nothing in this patch of grass\. No page by that name\. Check the link for a typo\./)
      assert.ok(p.html.includes('<a class="back" href="/">Back to the meadow</a>'))
      assert.ok(!p.html.includes(path.slice(1)), 'the address is never echoed back')
      pages.add(p.html)
    }
    assert.equal(pages.size, 1, 'every unknown address gets the same page')
    for (const headers of [{}, { accept: 'application/json' }, { accept: '*/*' }]) {
      const res = await s.request('GET', '/nope', { client: null, headers })
      assert.equal(res.status, 404)
      assert.match(res.headers.get('content-type')!, /^application\/json/)
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'not_found')
    }
    const post = await s.request('POST', '/nope', { body: {} })
    assert.ok([404, 405].includes(post.status), 'nothing to post to')
    assert.match(post.headers.get('content-type')!, /^application\/json/)
    // every page that existed still answers as before, to a browser too
    for (const path of ['/', '/odds', '/privacy', `/static/${SITE_ASSETS.site}`]) assert.equal((await get(s, path, BROWSER)).status, 200, path)
    assert.equal((await get(s, '/v1/health', BROWSER)).status, 200)
  })

  it('draws headings in the bold pixel cut, every letter shape defined once per page', async () => {
    const { s, a } = await world()
    const card = await mythicFor(s, a, 'hd01')
    for (const path of ['/', '/odds', '/privacy', `/c/${card.id}`, `/u/${a.me.player.handle}`, '/u/nobody-here-11']) {
      const p = await get(s, path)
      const used = [...new Set([...p.html.matchAll(/href="#(bg\d+)"/g)].map(m => m[1]!))].sort()
      const defined = [...p.html.matchAll(/<path id="(bg\d+)"/g)].map(m => m[1]!)
      assert.ok(used.length > 0, `${path} has a pixel heading`)
      assert.deepEqual([...defined].sort(), used, `${path}: every letter used is defined, and nothing else`)
      assert.equal(new Set(defined).size, defined.length, `${path}: once each`)
      assert.match(p.html, /<h1[^>]*><span class="pt" aria-hidden="true"><svg class="pw bd"/, `${path}: the H1 is pixel type`)
      assert.match(p.html, /<h1[^>]*>.*?<span class="sr">[^<]+<\/span><\/h1>/s, `${path}: with its real words for readers`)
    }
  })

  it('keeps the gaps inside m and w open in the bold cut', () => {
    for (const ch of ['m', 'w', 'M', 'W']) {
      const runsByRow = new Map<number, number>()
      for (const [, y] of boldGlyph(ch).face.matchAll(/M\d+ (\d+)h/g)) runsByRow.set(Number(y), (runsByRow.get(Number(y)) ?? 0) + 1)
      assert.ok(Math.max(...runsByRow.values()) >= 3, `${ch} keeps its three stems apart`)
    }
  })

  it('names the wild one with spaces around it, in one run inside the bubble', async () => {
    const { s } = await world()
    const p = await get(s, '/')
    const bubble = p.html.match(/<p class="bubble" data-chip>([\s\S]*?)<\/p>/)![1]!
    assert.match(bubble, /^<span class="nojs-line">A wild <b style="color:#[0-9a-f]{6}">[^<]+<\/b> appeared!<\/span>$/)
    assert.match(css(p.html), /\.bubble>span\{display:block/)
  })

  it('keeps every pack card name visible however the card is squeezed', async () => {
    const { s } = await world()
    const c = css((await get(s, '/')).html)
    assert.ok(c.includes('.fan .cf>*{flex-shrink:0}'))
    assert.ok(c.includes('.fan .cf>.cf-art{flex:1 1 auto;min-height:0;overflow:hidden}'))
    assert.match(c, /\.fan \.cf-kind\{[^}]*white-space:nowrap/)
  })

  it('lands section links below the sticky header', async () => {
    const { s } = await world()
    for (const path of ['/', '/odds']) {
      const c = css((await get(s, path)).html)
      assert.match(c, /html\{[^}]*--hdr:64px;scroll-padding-top:calc\(var\(--hdr\) \+ 16px\)/)
      assert.ok(c.includes('@media (max-width:767px){html{--hdr:88px}}'))
    }
  })

  it('makes the album one Tab stop per family, each row named by its count', async () => {
    const { s } = await world()
    const p = await get(s, '/')
    const rows = [...p.html.matchAll(/<p class="blabel" id="row-([a-z]+)">[\s\S]*?<\/span> ([A-Z][a-z]+): (\d) of 9 found<\/p>\n<ul class="nooks" aria-labelledby="row-\1" data-roving>([\s\S]*?)<\/ul>/g)]
    assert.deepEqual(rows.map(r => r[1]), ['haiku', 'sonnet', 'opus', 'fable'])
    for (const r of rows) {
      assert.equal((r[4]!.match(/tabindex="0"/g) ?? []).length, 1, `${r[1]}: one stop`)
      assert.equal((r[4]!.match(/tabindex="-1"/g) ?? []).length, 8, `${r[1]}: the rest by arrow keys`)
      assert.equal((r[4]!.match(/<li class="nk found/g) ?? []).length, Number(r[3]))
    }
  })

  it('invites the first finder instead of showing an empty album', async () => {
    const s = server()
    const text = textOf((await get(s, '/')).html)
    assert.ok(text.includes('36 waiting to be found'))
    assert.match(text, /Nobody has found any of these 36 yet\. Be the first:/)
    assert.doesNotMatch(text, /\b0 of 36\b|0 so far|No lanterns lit yet/)
    assert.ok(text.includes('The first Mythic lights a lantern.'))
  })

  it('saves the third spot: a button up to the meet, and an empty log by the fire', async () => {
    const { s } = await world()
    const p = await get(s, '/')
    assert.match(p.html, /<p class="need js-only" data-need hidden><button class="tbtn" type="button" data-needgo>[^<]+<\/button><\/p>/)
    assert.match(p.html, /<span class="camper seat"><svg class="logart"[\s\S]*?<span class="saved">Saved for you<\/span><\/span>/)
  })

  it('shows Claude at work in the battle frame, not loading bars', async () => {
    const { s } = await world()
    const html = (await get(s, '/')).html
    const tx = html.match(/<div class="tx" aria-hidden="true">([\s\S]*?)<\/div>/)![1]!
    assert.ok((tx.match(/<p><i><\/i>[A-Z][a-z]+ [^<]+<\/p>/g) ?? []).length >= 5, 'Claude busy for a while')
    assert.ok((tx.match(/<p class="sub">[^<]+<\/p>/g) ?? []).length >= 1, 'with results under its steps')
    // the band rises inside a fixed screen (transforms and a clip), so nothing below it ever moves
    const c = css(html)
    assert.match(c, /\.screen\.open \.feed\{transform:translateY\(/)
    assert.match(c, /html\.js \.screen\.open \.band\{clip-path:inset\(0 0 0 0\)\}/)
    assert.doesNotMatch(c, /\.band\.open\{[^}]*height/)
  })

  it('puts the card itself up front on a card page: big, tilting, with its colours', async () => {
    const { s, a } = await world()
    const m = await mythicFor(s, a, 'cp01')
    const p = await get(s, `/c/${m.id}`)
    const big = p.html.match(/<div class="bigcard mythic" data-bigcard>([\s\S]*?)<\/div>\n<div class="plaque">/)![1]!
    assert.match(big, /<div class="cf big foil mythic"/, 'a Mythic is foil, in its own frame')
    assert.match(big, /<span class="holo" aria-hidden="true"><\/span>/)
    const swatches = [...big.matchAll(/<i style="--c:(#[0-9a-f]{6})"><\/i>/g)].map(x => x[1])
    assert.ok(swatches.length >= 2 && swatches.length <= 5, `${swatches.length} colours`)
    assert.match(big, /<p class="cf-dna" role="img" aria-label="Its colours">/)
    assert.match(big, /<button class="poke js-only" type="button" aria-label="[^"]+\. Poke it\.">/)
  })

  it("moves focus into a section from the header's links, as a plain link would, onto a heading made to hold it", async () => {
    const { s } = await world()
    const html = (await get(s, '/')).html
    for (const id of ['battle', 'collect', 'trade', 'install']) {
      assert.match(html, new RegExp(`<a href="#${id}" data-stop="${id}">`), id)
      assert.match(html, new RegExp(`<section class="[^"]+" id="${id}" aria-labelledby="${id}-h">[\\s\\S]*?<h2 id="${id}-h" tabindex="-1">`), id)
    }
    assert.match(html, /<h1 id="meet-h" tabindex="-1">/, 'the headline holds focus while no creature stands in the meadow')
    assert.equal((html.match(/<h[1-6][^>]*tabindex="0"/g) ?? []).length, 0, 'no heading is a Tab stop')
  })

  it('without script, offers no button it cannot honour: toys are pictures or text until site.js makes them buttons', async () => {
    const { s, a } = await world()
    const m = await mythicFor(s, a, 'ns01')
    for (const path of ['/', `/u/${a.me.player.handle}`, `/c/${m.id}`]) {
      const all = tags((await get(s, path)).html)
      // the album's nooks are the one exception: focus shows each one's tip, script or not
      const dead = all.filter(t => t.tag === 'button' && !t.jsOnly && !/\bclass="nook"/.test(t.attrs))
      assert.deepEqual(dead.map(t => t.attrs), [], `${path}: every other button is js-only`)
      for (const t of all.filter(t => /\bdata-toy=/.test(t.attrs))) {
        assert.equal(t.tag, 'span', `${path}: ${t.attrs}`)
        assert.doesNotMatch(t.attrs, /\btabindex=|\baria-keyshortcuts=|\btype=/, `${path}: a toy promises nothing until it wakes`)
        assert.match(t.attrs, /\brole="img" [^>]*aria-label="[^"]+"|aria-hidden="true"|data-toy="" data-deal=/, `${path}: a picture with words, a hidden lamp or a deal's own text`)
      }
    }
    const home = tags((await get(s, '/')).html).filter(t => /\bdata-toy=/.test(t.attrs)).map(t => /class="([^"]+)"/.exec(t.attrs)![1])
    assert.deepEqual([...new Set(home)].sort(), ['fire', 'key1', 'lamp', 'mate', 'pack', 'tagb', 'wheel'])
    // and nothing that is still a picture looks or acts pressable
    assert.ok(css((await get(s, '/')).html).includes('[data-toy]{pointer-events:none}'))
  })

  it('lets a mouse or pen drag a revealed pack card while a finger scrolls past it, and never forces motion on a visitor who asked for less', async () => {
    const { s } = await world()
    const c = css((await get(s, '/')).html)
    assert.ok(c.includes('@media (pointer:fine){.fan li[data-open]{touch-action:none}}'), 'a fine pointer takes the gesture instead of the page scrolling')
    assert.doesNotMatch(c.replace(/@media \(pointer:fine\)\{[^}]*\}\}/g, ''), /\.fan li\[data-open\]\{[^}]*touch-action/, 'a finger on a card still scrolls the page')
    assert.match(c, /@media \(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important;transition:none!important\}\}/)
    // scripted motion goes through steps(), which has no way left to override reduced motion
    const js = Object.values(SITE_FILES).join('\n')
    assert.doesNotMatch(js, /force:!0/)
  })

  it('labels the shortcut switch once, and names where security reports go', async () => {
    const { s } = await world()
    const p = await get(s, '/')
    assert.ok(p.html.includes('<button class="tbtn keys js-only" type="button" aria-pressed="true" data-keys>Key shortcuts</button>'))
    assert.ok(p.html.includes(`<a href="${REPO}/blob/main/SECURITY.md">Report a security issue</a>`))
    assert.ok(p.html.includes(`<a href="${REPO}/issues">Report a problem</a>`))
  })
})

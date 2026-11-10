// /whats-new (SPEC 32, 36): every announced release's notes, newest first, as lamps along the meadow path. A quiet
// page: no script, cached for an hour, escaped by construction, linked from every footer and listed in the sitemap,
// and never showing a release past LATEST_CLIENT, which the marketplace pins.
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { describe, it } from 'node:test'
import { compareSemver } from '../../plugin/hooks/client/remote.ts'
import type { ReleaseNote } from '../../plugin/hooks/core/api.ts'
import { RELEASES, releasedUpTo } from '../../plugin/hooks/core/releases.ts'
import { WHATS_NEW } from '../../plugin/hooks/core/servers.ts'
import { PAGE_CSP, REPO } from '../../server/src/pages-html.ts'
import { PROSE_CSS, WHATS_NEW_CSS, whatsNewBody } from '../../server/src/pages-info.ts'
import { LATEST_CLIENT } from '../../server/src/routes/account.ts'
import { server } from './scaffold-helpers.ts'
import type { Server } from './scaffold-helpers.ts'

let visits = 0
async function get(s: Server, path: string): Promise<{ res: Response; markup: string }> {
  const res = await s.request('GET', path, { client: null, ip: `198.20.${visits >> 8 & 255}.${++visits & 255}`, headers: { accept: 'text/html' } })
  return { res, markup: await res.text() }
}
const main = (markup: string) => markup.slice(markup.indexOf('<main'), markup.indexOf('</main>'))
const css = (markup: string) => markup.match(/<style>([\s\S]*?)<\/style>/)![1]!
/** What a reader gets: no tags, entities read back, spaces collapsed. */
const words = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/ ([.,:])/g, '$1').trim()
/** Each release on the page: its id, whether its lamp is lit, its date, and its highlights' words. */
const releasesOf = (markup: string) => [...main(markup).matchAll(/<li id="v([^"]+)"( class="lit")?>\n<h2>([\s\S]*?)<\/h2>\n<ul>([\s\S]*?)<\/ul>\n<\/li>/g)]
  .map(m => ({ version: m[1]!, lit: m[2] !== undefined, h2: m[3]!, items: [...m[4]!.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(i => i[1]!) }))

describe('the what\'s new page', () => {
  it('serves a plain page: no script, the page CSP, an hour of cache, its own title and description', async () => {
    const { res, markup } = await get(server(), '/whats-new')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600')
    assert.equal(res.headers.get('content-security-policy'), PAGE_CSP)
    assert.doesNotMatch(markup, /<script/i)
    assert.match(markup, /<title>What&#39;s new: Spinlings<\/title>/)
    assert.match(markup, /<meta name="description" content="What each Spinlings update brought, newest first\.">/)
    assert.equal(new URL(WHATS_NEW).pathname, '/whats-new', 'the mod links here')
  })

  it('lists every announced release newest first, each under its own id, and nothing past LATEST_CLIENT', async () => {
    const { markup } = await get(server(), '/whats-new')
    const shown = releasesOf(markup)
    const announced = releasedUpTo(LATEST_CLIENT)
    assert.deepEqual(shown.map(r => r.version), announced.map(r => r.version))
    assert.ok(shown.length > 0)
    assert.ok(shown.every(r => compareSemver(r.version, LATEST_CLIENT) <= 0), 'never a release the marketplace does not serve yet')
    for (const r of RELEASES.filter(x => compareSemver(x.version, LATEST_CLIENT) > 0)) assert.ok(!markup.includes(`id="v${r.version}"`), `${r.version} waits for its pin`)
    for (const [i, r] of shown.entries()) {
      const note = announced[i]!
      assert.equal(r.lit, i === 0, `only the newest lamp is lit (${r.version})`)
      assert.match(r.h2, /^<svg class="pic"/, `${r.version}: the lamp comes first`)
      assert.ok(r.h2.includes(`<span class="sr">${note.version}</span>`), `${r.version}: the version, in words for readers`)
      const [y, m, d] = note.date.split('-').map(Number)
      const long = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      assert.ok(r.h2.includes(` <time datetime="${note.date}">${long}</time>`), `${r.version}: dated ${long}`)
      // every highlight, whole and in order, with its mark hidden from readers
      assert.deepEqual(r.items.map(item => words(item.replace(/<i class="mk" aria-hidden="true">[^<]*<\/i>/, ''))), note.highlights.map(h => `${h.short}. ${h.text}`))
      for (const item of r.items) assert.match(item, /^<i class="mk" aria-hidden="true">✦<\/i><b>[^<]+\.<\/b> /)
    }
    // every older release has the same unlit lamp, and the newest one's differs
    const lamps = shown.map(r => r.h2.slice(0, r.h2.indexOf('</svg>')))
    assert.ok(lamps.slice(1).every(l => l === lamps[1]))
    if (lamps.length > 1) assert.notEqual(lamps[0], lamps[1])
  })

  it('leads with the updates command and closes with the changelog', async () => {
    const { markup } = await get(server(), '/whats-new')
    const body = main(markup)
    assert.match(body, /<h1><span class="pt" aria-hidden="true">[\s\S]*?<\/span><span class="sr">What&#39;s new<\/span><\/h1>/)
    assert.match(body, /<pre aria-label="The updates command"><span class="gt" aria-hidden="true">&gt;<\/span><code><span class="w">\/spin<\/span> <span class="w">updates<\/span><\/code><\/pre>/)
    const text = words(body)
    assert.ok(text.includes("Run it in Claude Code to see whether you're up to date, and let updates come by themselves."))
    assert.ok(body.indexOf('aria-label="The updates command"') < body.indexOf('<ol class="releases">'), 'the command before the list')
    assert.ok(body.includes(`Every detail, release by release: <a href="${REPO}/blob/main/CHANGELOG.md">the changelog on GitHub</a>.`))
    assert.ok(body.lastIndexOf('CHANGELOG.md') > body.indexOf('</ol>'), 'the changelog comes last')
    assert.doesNotMatch(text, /never|no sign-up|telemetry|tokens|read-only/i, 'nothing defensive')
  })

  it('escapes every word of a release, whatever it holds', () => {
    const hostile: ReleaseNote[] = [{
      version: '9.9.9"><script>alert(1)</script>', date: '2026-11-09" onmouseover="x',
      highlights: [{ short: '<img src=x onerror=alert(1)>', text: '</li></ol><script>alert(2)</script> & "quotes" \'too\'' }],
    }, { version: '0.0.1', date: '2026-13-40', highlights: [{ short: 'Fine', text: 'A <b>bold</b> claim.' }] }]
    const out = whatsNewBody(hostile).__html
    // no tag or attribute of their own: every one of their angle brackets and quotes arrives as an entity
    assert.doesNotMatch(out, /<script|<img|<b>bold|" on[a-z]+=/)
    assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;.'))
    assert.ok(out.includes('&lt;/li&gt;&lt;/ol&gt;&lt;script&gt;alert(2)&lt;/script&gt; &amp; &quot;quotes&quot; &#39;too&#39;'))
    assert.ok(out.includes('id="v9.9.9&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'))
    assert.ok(out.includes('<time datetime="2026-11-09&quot; onmouseover=&quot;x">2026-11-09&quot; onmouseover=&quot;x</time>'), 'a date it cannot read stays as it is')
    assert.ok(out.includes('<time datetime="2026-13-40">2026-13-40</time>'), 'no month 13')
    assert.ok(out.includes('A &lt;b&gt;bold&lt;/b&gt; claim.'))
  })

  it('still reads with no release to list', () => {
    const out = whatsNewBody([]).__html
    assert.doesNotMatch(out, /<ol/)
    assert.match(out, /the changelog on GitHub/)
  })

  it('is linked from every footer, between Mythics and Odds, and listed in the sitemap', async () => {
    const s = server()
    const a = await s.join('haiku')
    for (const path of ['/', '/whats-new', '/odds', '/privacy', '/boards', '/market', '/mythics', '/search', `/u/${a.me.player.handle}`, '/u/nobody-here-11']) {
      const { markup } = await get(s, path)
      const nav = markup.slice(markup.indexOf('<nav aria-label="More">'), markup.indexOf('</nav>', markup.indexOf('<nav aria-label="More">')))
      assert.ok(nav.includes('<a href="/mythics">Mythics</a><a href="/whats-new">What\'s new</a><a href="/odds">Odds</a>'), path)
    }
    const xml = await (await s.request('GET', '/sitemap.xml', { client: null })).text()
    assert.ok(xml.includes('/whats-new</loc>'))
  })

  it('looks after itself: paper colours for dark mode, a CSS-only flicker that rests under reduced motion, light to load', async () => {
    const { markup } = await get(server(), '/whats-new')
    const c = css(markup)
    // dark mode comes from the paper variables alone: no fixed colour for the words, the path or the lamp posts
    assert.match(c, /@media \(prefers-color-scheme:dark\)\{:root\{--paper:#231915;--pink:#f4e9dc;--psoft:#cdb9a6;--pline:#3e2d25\}\}/)
    assert.match(c, /\.releases::before\{[^}]*background:repeating-linear-gradient\(var\(--pedge\)/)
    for (const lamp of main(markup).match(/<svg class="pic"[\s\S]*?<\/svg>/g)!) assert.match(lamp, /fill="currentColor"/)
    // the flicker only where motion is welcome, and the site-wide rule stops every animation otherwise
    const own = WHATS_NEW_CSS.slice(PROSE_CSS.length)
    assert.ok(c.endsWith(own), 'the page ships the lamps\' own rules last')
    const welcome = own.split('\n').find(l => l.startsWith('@media (prefers-reduced-motion:no-preference){'))!
    const animations = (rules: string) => (rules.match(/animation:/g) ?? []).length
    assert.equal(animations(own), 2, 'the glow and the flame')
    assert.equal(animations(welcome), 2, 'both only where motion is welcome')
    assert.ok(c.includes('@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}'))
    assert.ok(gzipSync(c).length <= 18 * 1024, `inline CSS ${gzipSync(c).length} bytes gzipped`)
    assert.ok(gzipSync(markup).length <= 64 * 1024, `page ${gzipSync(markup).length} bytes gzipped`)
    assert.doesNotMatch(markup, /<img\b|url\([^)]*\.png|\.woff/, 'no raster art or fonts: nothing to shift the layout')
  })
})

// The living site (SPEC 36 and the site brief): the first-party scripts it serves and their budgets,
// the shared rules for where site creatures come from (no Mythic, no roamer, nothing unfound in
// colour), postcards and share images, and the world embedded in the landing page, which carries no
// player at all.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { gzipSync } from 'node:zlib'
import { RULES_VERSION, perfectRounds, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { featuredSpecies, utcDay, worldOf } from '../../plugin/hooks/core/world.ts'
import { stmt } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { HOUR_PAL, SITE_CSP } from '../../server/src/pages-html.ts'
import { HOURS, isFound, meet, newSeed, pool, regularOf, rollPack, SEED_RE, teamRegulars, wildCard } from '../../server/src/pages-meet.ts'
import type { SiteWorld } from '../../server/src/pages-meet.ts'
import { spriteLayers } from '../../server/src/pages-sprite.ts'
import { imageCache } from '../../server/src/pages-og.ts'
import { regulars } from '../../server/src/pages-world.ts'
import { viaEdgeCache } from '../../server/src/worker.ts'
import { buildSite, OUT } from '../../server/static/build.ts'
import { SITE_ASSETS, SITE_FILES, SITE_PARTS } from '../../server/static/site.gen.ts'
import { DESKTOP_CAPTURES } from '../../server/static/media.gen.ts'
import { testApp } from './infra-helpers.ts'
import { DAY, server, T0 } from './scaffold-helpers.ts'

const html = async (s: ReturnType<typeof server>, path: string) => {
  const res = await s.request('GET', path, { client: null })
  return { res, text: await res.text() }
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const worldOfPage = (page: string) => JSON.parse(unescape(page.match(/<main id="main" data-world="([^"]*)">/)![1]!)) as SiteWorld & Record<string, unknown>

/**
 * A world like the page's as of `at`: season 1, with first finds made on known days. Like the page, it
 * keeps no find's day: only which species are found by then and which of them on its own day.
 */
function siteWorld(finds: [string, string][] = [], at = T0): SiteWorld {
  const w = worldOf(at)
  const by = finds.filter(([, d]) => d <= w.day)
  return {
    now: at, day: w.day, season: w.season, rule: w.rule, featured: w.featured,
    found: by.map(([id]) => id), foundToday: by.filter(([, d]) => d === w.day).map(([id]) => id),
    species: [...seasonSpecies(1)], regulars: regulars(),
  }
}

// ---- the scripts -------------------------------------------------------------------------------------

describe('site scripts', () => {
  it('serve sky, site, names and the later parts as first-party JavaScript under immutable, content-hashed names', async () => {
    const s = server()
    for (const name of Object.values(SITE_ASSETS)) assert.match(name, /^(sky|site|names)\.[0-9a-f]{10}\.js$/)
    assert.ok(Object.keys(SITE_PARTS).length >= 2, 'the battle and the den load later')
    for (const name of Object.keys(SITE_FILES)) {
      assert.match(name, /^(sky|site|names)\.[0-9a-f]{10}\.js$|^part\.[A-Z0-9]{8}\.js$/)
      const res = await s.request('GET', `/static/${name}`, { client: null })
      assert.equal(res.status, 200, name)
      assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8')
      assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(await res.text(), SITE_FILES[name])
    }
    assert.equal((await s.request('GET', '/static/site.0000000000.js', { client: null })).status, 404)
    // only the table's own names: nothing it inherits is a script
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      const res = await s.request('GET', `/static/${name}`, { client: null, headers: { accept: 'text/html' } })
      assert.equal(res.status, 404, name)
      assert.match(res.headers.get('content-type')!, /^text\/html/, name)
      assert.doesNotMatch(res.headers.get('cache-control')!, /immutable/, name)
    }
    assert.doesNotThrow(() => new Function(SITE_FILES[SITE_ASSETS.sky]!), 'sky.js is a plain script')
  })

  it('talk to nobody: no URL elsewhere, no network APIs, no eval, and only names.js imported later', () => {
    for (const [name, js] of Object.entries(SITE_FILES)) {
      assert.doesNotMatch(js, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/i, `${name}: no URL to anywhere else`)
      assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|\beval\(|new Function|document\.write|document\.cookie|indexedDB|sessionStorage/, name)
      assert.doesNotMatch(js, /\binnerHTML\s*\+?=\s*[a-z_$][\w$]*\.(name|textContent)/i, `${name}: text is never markup`)
    }
    // site.js and its parts import only each other (by relative path under /static/) and names.js
    const own = new Set(Object.keys(SITE_PARTS))
    for (const name of [SITE_ASSETS.site, ...own]) {
      const js = SITE_FILES[name]!
      const specs = [...js.matchAll(/(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s*)["'`]([^"'`]+)["'`]/g)].map(m => m[1]!)
      for (const spec of specs) {
        if (spec === `/static/${SITE_ASSETS.names}`) continue
        assert.match(spec, /^\.\/part\.[A-Z0-9]{8}\.js$/, `${name} imports ${spec}`)
        assert.ok(own.has(spec.slice(2)), `${name} imports a part that is served: ${spec}`)
      }
      assert.doesNotMatch(js, /\bimport\(\s*[^"'`\s]/, `${name}: no computed import()`)
    }
    const later = [...SITE_FILES[SITE_ASSETS.site]!.matchAll(/import\(\s*["'`]([^"'`]+)/g)].map(m => m[1])
    assert.ok(later.includes(`/static/${SITE_ASSETS.names}`) || Object.values(SITE_PARTS).some(js => js.includes(`/static/${SITE_ASSETS.names}`)), 'names.js loads on the first fuse')
    assert.ok(later.filter(x => x?.startsWith('./part.')).length >= 2, 'the battle and the den are fetched as their sections come near')
    assert.match(SITE_FILES[SITE_ASSETS.names]!, /export\{/)
    assert.doesNotMatch(SITE_FILES[SITE_ASSETS.sky]!, /localStorage/, 'the sky remembers nothing')
  })

  it('are exactly what a fresh build makes (site.gen.ts is never stale)', async () => {
    assert.equal(readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n'), await buildSite())
  })

  it('stay inside the budgets: sky 1 KB, all JavaScript under SPEC 36’s 200 KB, the landing light', async () => {
    const size = (n: string) => SITE_FILES[n]!.length
    const gz = (n: string) => gzipSync(SITE_FILES[n]!).length
    assert.ok(size(SITE_ASSETS.sky) <= 1024, `sky.js ${size(SITE_ASSETS.sky)} bytes`)
    // the first screen pays for site.js and the parts it imports up front (the game's own sprite engine
    // among them); the battle engine and the den come later, as their sections near the viewport
    const site = SITE_FILES[SITE_ASSETS.site]!
    const upfront = [SITE_ASSETS.site, ...[...site.matchAll(/\bfrom\s*["']\.\/(part\.[A-Z0-9]{8}\.js)["']|\bimport\s*["']\.\/(part\.[A-Z0-9]{8}\.js)["']/g)].map(m => (m[1] ?? m[2])!)]
    const first = upfront.reduce((n, k) => n + size(k), 0)
    const firstGz = gzipSync(upfront.map(k => SITE_FILES[k]).join('\n')).length
    assert.ok(first <= 100 * 1024, `first-screen JavaScript ${first} bytes`)
    assert.ok(firstGz <= 42 * 1024, `first-screen JavaScript ${firstGz} bytes gzipped`)
    assert.ok(size(SITE_ASSETS.site) <= 40 * 1024, `site.js ${size(SITE_ASSETS.site)} bytes`)
    assert.ok(size(SITE_ASSETS.names) <= 76 * 1024, `names.js ${size(SITE_ASSETS.names)} bytes`)
    const total = Object.keys(SITE_FILES).reduce((n, k) => n + size(k), 0)
    assert.ok(total < 200 * 1024, `all JavaScript ${total} bytes (SPEC 36)`)
    // the heaviest landing: every species found (36 creatures asleep in colour) and a full string of lanterns
    const s = server()
    const p = await s.join('haiku')
    await s.db.batch(seasonSpecies(1).map(x => stmt('INSERT OR IGNORE INTO firsts (species, season, player_id, card_id, day) VALUES (?, 1, NULL, ?, ?)', x.id, `c-${x.id}`, '2026-10-01')))
    const env = { db: s.db, now: s.now(), randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) }
    for (let i = 0; i < 12; i++) await s.db.batch((await mintCards(env, p.id, [generateMythic({ seed: `budget-${i}`, dna: i, now: s.now(), origin: 'catch' })])).stmts)
    const { text } = await html(s, '/')
    assert.equal((text.match(/<li class="nk found/g) ?? []).length, 36)
    assert.ok(gzipSync(text).length <= 64 * 1024, `landing ${gzipSync(text).length} bytes gzipped`)
    const css = text.match(/<style>([\s\S]*?)<\/style>/)![1]!
    assert.ok(gzipSync(css).length <= 18 * 1024, `inline CSS ${gzipSync(css).length} bytes gzipped`)
    assert.doesNotMatch(text, /\.woff2?|url\([^)]*\.png/, 'no fonts or raster backgrounds on the page')
    const images = [...text.matchAll(/<img\b[^>]*>/g)].map(m => m[0])
    assert.equal(images.length, DESKTOP_CAPTURES.length, 'only reviewed native captures add raster images')
    for (const image of images) {
      assert.match(image, /loading="lazy"/)
      assert.ok(DESKTOP_CAPTURES.some(c => image.includes(`src="/media/${c.file}"`)), 'every image is a whitelisted first-party capture')
    }
  })
})

// ---- where site creatures come from ---------------------------------------------------------------

describe('site creatures', () => {
  it('meet the same creature from the same seed, every time, from the revealed pool only', () => {
    const species = seasonSpecies(1)
    const foundEarly = species.filter(s => !s.legendary).slice(0, 5).map(s => [s.id, '2026-10-01'] as [string, string])
    const foundToday = [[species[20]!.id, '2026-10-02'] as [string, string], [species[8]!.id, '2026-10-01'] as [string, string]]
    const w = siteWorld([...foundEarly, ...foundToday])
    const rng = rngFromSeed('seeds')
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const seed = newSeed('2026-10-02', HOURS[i % 4]!, Uint8Array.from({ length: 8 }, () => Math.floor(rng() * 256)))
      assert.match(seed, SEED_RE)
      const a = meet(seed, w)!, b = meet(seed, w)!
      assert.deepEqual(a, b, 'deterministic')
      assert.deepEqual(meet(seed, w, a.entry), a, 'its kept entry meets it again')
      const c = a.card
      assert.ok(['common', 'rare', 'epic'].includes(c.rarity), 'wild odds: never legendary')
      assert.equal(c.level, 3)
      assert.equal(c.xp, 100, 'one win from evolving')
      assert.notEqual(c.species, 'mythic', 'never a Mythic')
      if (c.species === 'promo') assert.ok(regulars().some(r => r.names[0] === c.form!.names[0]), 'a promo is one of the regulars')
      else {
        // revealed before the seed's day, or the day's featured species: never a later find, never unfound
        assert.ok(c.species === featuredSpecies(T0) || foundEarly.some(([id]) => id === c.species), `${c.species} is revealed`)
        assert.ok(!species.find(s => s.id === c.species)!.legendary)
      }
      seen.add(c.species)
    }
    assert.ok(seen.size > 3, 'the pool is really used')
  })

  it('meet a kept seed again on a later day, whatever was found since, and never an unfound species from an edited key', () => {
    const species = seasonSpecies(1)
    const regular = species.filter(s => !s.legendary)
    const early = regular.slice(0, 4).map(s => [s.id, '2026-10-01'] as [string, string])
    // three days on, most of the season has been found: the pools a past seed drew from are long gone
    const later = regular.slice(4, 24).map((s, i) => [s.id, `2026-10-0${3 + (i % 3)}`] as [string, string])
    const then = siteWorld(early), now = siteWorld([...early, ...later], T0 + 3 * DAY)
    assert.equal(now.day, '2026-10-05')
    const rng = rngFromSeed('kept')
    let moved = 0
    for (let i = 0; i < 300; i++) {
      const seed = newSeed('2026-10-02', HOURS[i % 4]!, Uint8Array.from({ length: 8 }, () => Math.floor(rng() * 256)))
      const met = meet(seed, then)!
      assert.deepEqual(meet(seed, now, met.entry), met, 'the same creature, three days later')
      if (meet(seed, now)!.entry !== met.entry) moved++
    }
    assert.ok(moved > 0, 'without its kept entry a later world would meet some other creature')
    // a kept key only ever names what the seed's day could have drawn
    const seed = newSeed('2026-10-02', 'dusk', new Uint8Array(8).fill(3))
    const unfound = regular.find(s => s.id !== then.featured && !then.found.includes(s.id))!
    const legend = species.find(s => s.legendary)!
    for (const key of [unfound.id, legend.id, 'mythic', 'fable/2', '../x', '']) {
      assert.deepEqual(meet(seed, then, key), meet(seed, then), `${key || '(empty)'} is ignored`)
    }
    assert.equal(meet(seed, then, 'fable/1')!.card.form?.names[0], regularOf(then, 'fable', 1).names[0], 'a regular is a fine key')
    assert.equal(meet(seed, then, then.featured)!.card.species, then.featured, 'and so is the day’s featured species')
  })

  it('turn down malformed, future and other-season seeds', () => {
    const w = siteWorld()
    for (const seed of ['nope', '20261002-noon-abcdefgh', '20261002-dusk-ABCDEFGH', '20261002-dusk-abc', '20261003-dusk-abcdefgh', '20260930-dusk-abcdefgh', '20261332-dusk-abcdefgh', '20261102-dusk-abcdefgh']) {
      assert.equal(meet(seed, w), null, seed)
    }
  })

  it('fill thin pools with regulars, and open legendaries only once somebody found them', () => {
    const species = seasonSpecies(1)
    const w = siteWorld()
    for (const f of ['haiku', 'sonnet', 'opus', 'fable'] as const) {
      const p = pool(w, f)
      assert.ok(p.length >= 2, f)
      for (const e of p) if ('species' in e) assert.ok(e.species.id === w.featured && !e.species.legendary)
    }
    const rng = rngFromSeed('packs')
    for (let i = 0; i < 400; i++) {
      for (const slot of rollPack(w, 'fable', rng)) {
        if ('unfound' in slot) { assert.ok(slot.unfound.legendary && !isFound(w, slot.unfound.id)); continue }
        assert.notEqual(slot.card.rarity, 'legendary', 'an unfound legendary never shows in colour')
      }
    }
    assert.ok('unfound' in rollPack(w, 'fable', () => 0.999)[0]!, 'a legendary draw shows the gold silhouette')
    const leg = species.find(s => s.family === 'fable' && s.legendary)!
    const w2 = siteWorld([[leg.id, '2026-10-01']])
    for (let i = 0; i < 400; i++) for (const slot of rollPack(w2, 'fable', rng)) {
      assert.ok(!('unfound' in slot), 'a found legendary is a real card')
      if (slot.card.rarity === 'legendary') { assert.equal(slot.card.species, leg.id); assert.ok(slot.card.foil) }
    }
    const drawn = rollPack(w2, 'fable', () => 0.999)[0]!
    assert.ok('card' in drawn)
    assert.equal(drawn.card.rarity, 'legendary')
    assert.equal(drawn.card.species, leg.id)
    assert.ok(drawn.card.foil)
  })

  it('battle with the real engine: a Perfect press changes nothing before its round', () => {
    const w = siteWorld()
    const seed = newSeed(w.day, 'dusk', new Uint8Array(8).fill(7))
    const you = meet(seed, w)!.card
    const setup = { seed: 'demo', kind: 'wild' as const, arena: 'fable' as const, rule: w.rule, rules: RULES_VERSION, attacker: [you, ...teamRegulars(w, 'dusk')], defender: [wildCard(w, rngFromSeed('wild'))] }
    const log = simulateBattle(setup, [])
    assert.deepEqual(simulateBattle(setup, []), log, 'the same setup replays the same log')
    const r = perfectRounds(log)[0]
    if (r) {
      const pressed = simulateBattle(setup, [r])
      assert.deepEqual(pressed.rounds.slice(0, r - 1), log.rounds.slice(0, r - 1))
      assert.ok(pressed.rounds[r - 1]!.actions.some(a => a.perfect))
    }
    const [a, b] = teamRegulars(w, 'dusk')
    assert.deepEqual([a.level, b.level, a.stage, b.stage], [4, 5, 2, 2])
    assert.equal(wildCard(w, rngFromSeed('x')).species, w.featured)
  })

  it('draw sprites in layers whose eyes only move where the body is', () => {
    for (const s of seasonSpecies(1)) {
      const px = spriteFor({ form: s, stage: 1 })
      const l = spriteLayers(px)
      assert.match(l.eo, /^l?r?u?d?$/)
      assert.ok(l.body.length > 0 && l.flash.length > 0)
      if (l.eyes) assert.ok(l.lids.length > 0, `${s.id} closes its eyes`)
    }
  })
})

// ---- contrast ----------------------------------------------------------------------------------------

const luminance = (h: string) => {
  const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }

describe('site contrast', () => {
  it('keeps body text at 4.5:1 on every sky band, the grass and the clearing in all six hour palettes', () => {
    for (const [hour, p] of Object.entries(HOUR_PAL)) {
      for (const band of p.sky.slice(0, 3)) assert.ok(contrast(p.ink, band) >= 4.5, `${hour}: ink on ${band}`)
      assert.ok(contrast('#fffdf5', p.grass[2]) >= 4.5, `${hour}: the install line on the grass`)
      assert.ok(contrast('#f3f1e7', p.clear) >= 4.5 && contrast('#cfdccb', p.clear) >= 4.5, `${hour}: the clearing`)
    }
    // the fixed surfaces the page descends through
    for (const [fg, bg] of [['#f4e9dc', '#2a1d18'], ['#cdb9a6', '#352620'], ['#eef1fb', '#142039'], ['#b7c0d8', '#142039'], ['#d9c6b3', '#3b2a22'], ['#fdf6ec', '#0f1626'], ['#c9c3d6', '#0f1626'], ['#cdb9a6', '#1f1512'], ['#f4f2fb', '#14121c'], ['#9aa3ad', '#14121c'], ['#4f8ff0', '#14121c'], ['#b06ef3', '#14121c'], ['#b7c0d8', '#171a24']]) {
      assert.ok(contrast(fg!, bg!) >= 4.5, `${fg} on ${bg}`)
    }
  })
})

// ---- postcards and share images ---------------------------------------------------------------------

const pngSize = (bytes: Uint8Array) => { const v = new DataView(bytes.buffer, bytes.byteOffset); return [v.getUint32(16), v.getUint32(20)] }

describe('postcards', () => {
  it('show the very creature a seed met, at its hour, and unfurl with its own picture', async () => {
    const s = server()
    await s.join('haiku')
    const seed = '20261002-night-abcdefgh'
    const { res, text } = await html(s, `/w/${seed}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-security-policy'), SITE_CSP)
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400')
    assert.match(text, /<html lang="en" data-hour="night" data-hour-fixed>/)
    assert.match(text, /<meta name="robots" content="noindex">/)
    const w = worldOfPage((await html(s, '/')).text)
    const met = meet(seed, w)!
    const name = met.card.form?.names[0] ?? seasonSpecies(1).find(x => x.id === met.card.species)!.names[0]
    assert.ok(text.includes(`${name} came out of the grass.`))
    assert.ok(text.includes(`A friend met this ${met.card.rarity}`))
    assert.ok(text.includes('<a class="pbtn" href="/"><span class="face">Meet your own</span></a>'))
    // its own link and picture carry what it met, so they keep showing it after later finds
    const e = encodeURIComponent(met.entry)
    assert.ok(text.includes(`<meta property="og:url" content="http://localhost:8787/w/${seed}?e=${e}">`))
    assert.ok(text.includes(`<meta property="og:image" content="http://localhost:8787/w/${seed}.png?e=${e}">`))
    // a link's pin keeps the creature its sender met; one naming nothing a meeting could draw is ignored
    const pinned = (await html(s, `/w/${seed}?e=${encodeURIComponent('fable/1')}`)).text
    assert.ok(pinned.includes(`${regularOf(w, 'fable', 1).names[0]} came out of the grass.`))
    assert.ok(pinned.includes(`<meta property="og:image" content="http://localhost:8787/w/${seed}.png?e=fable%2F1">`))
    for (const junk of ['mythic', 's1-fable-99', '..%2Fx', 'x'.repeat(40)]) assert.equal((await html(s, `/w/${seed}?e=${junk}`)).text, text, junk)
    const png = await s.request('GET', `/w/${seed}.png`, { client: null })
    assert.equal(png.status, 200)
    assert.equal(png.headers.get('content-type'), 'image/png')
    const bytes = new Uint8Array(await png.arrayBuffer())
    assert.deepEqual(pngSize(bytes), [1200, 630])
    assert.ok(bytes.length < 150 * 1024, `${bytes.length} bytes`)
  })

  it('answer "not here" for malformed, future, pre-season and impossible seeds', async () => {
    const s = server()
    for (const seed of ['nope', '20261002-noon-abcdefgh', '20261003-dusk-abcdefgh', '20260930-dusk-abcdefgh', '20261340-dusk-abcdefgh', '20261002-dusk-abcdefg1']) {
      for (const path of [`/w/${seed}`, `/w/${seed}.png`]) assert.equal((await s.request('GET', path, { client: null })).status, 404, path)
    }
    s.tick(40 * DAY)
    assert.equal((await s.request('GET', '/w/20261002-dusk-abcdefgh', { client: null })).status, 200, 'an old season still has its postcards')
  })

  it('never date a first find: the same finds made on other days give the same postcard for every day', async () => {
    // SPEC 20.3: were a postcard drawn from the world as of its seed's day, made-up seeds for each
    // past day would show what was found before it, and so the day each species was first found
    const regular = seasonSpecies(1).filter(x => !x.legendary).slice(0, 12)
    const found = async (days: string[]) => {
      const s = server()
      await s.request('GET', '/', { client: null })
      await s.db.batch(regular.map((x, i) => stmt('INSERT INTO firsts (species, season, player_id, card_id, day) VALUES (?, 1, NULL, ?, ?)', x.id, `c-${x.id}`, days[i % days.length]!)))
      s.tick(5 * DAY)
      return s
    }
    // the same twelve species, all found on the season's first day, or one day after another since
    const early = await found(['2026-10-02']), spread = await found(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'])
    const w = worldOfPage((await html(early, '/')).text)
    const rng = rngFromSeed('postcard-days')
    let shown = 0
    for (let d = 0; d < 6; d++) {
      for (let i = 0; i < 24; i++) {
        const seed = newSeed(utcDay(T0 + d * DAY), HOURS[i % 4]!, Uint8Array.from({ length: 8 }, () => Math.floor(rng() * 256)))
        const [a, b] = await Promise.all([early, spread].map(async s => (await html(s, `/w/${seed}`)).text))
        assert.equal(a, b, seed)
        // and it is the creature today's landing would meet for that seed
        const met = meet(seed, w)!
        const name = met.card.form?.names[0] ?? w.species.find(x => x.id === met.card.species)!.names[0]
        assert.ok(a.includes(`${name} came out of the grass.`), seed)
        if (regular.some(x => x.id === met.card.species)) shown++
      }
    }
    assert.ok(shown > 10, `found species really come out (${shown})`)
  })
})

describe('the meadow share image', () => {
  it("is today's dusk meadow, 1200 x 630, cached a day; other days are not here", async () => {
    const s = server()
    const day = utcDay(s.now()).replace(/-/g, '')
    const res = await s.request('GET', `/og/meadow-${day}.png`, { client: null })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400')
    const bytes = new Uint8Array(await res.arrayBuffer())
    assert.deepEqual(pngSize(bytes), [1200, 630])
    assert.ok(bytes.length < 150 * 1024)
    const page = (await html(s, '/')).text
    assert.ok(page.includes('<meta property="og:image" content="http://localhost:8787/og/meadow.png">'))
    assert.ok(page.includes('<meta property="og:image:alt" content="A team of Spinlings on a lamp-lit path as a wild one rustles in the grass.">'))
    for (const bad of ['meadow-20200101.png', 'meadow-x.png', 'sky.png']) assert.equal((await s.request('GET', `/og/${bad}`, { client: null })).status, 404)
  })
})

describe('share images, drawn once', () => {
  it('keeps the meadow for the day and each postcard once drawn; only a fresh drawing spends the share bucket', async () => {
    const { app } = testApp({ now: () => T0, config: { rates: { share: { capacity: 3, windowMs: 60_000 } } } })
    const get = (path: string, ip = '192.0.2.40') => app(new Request(`http://localhost:8787${path}`), { ip })
    const day = utcDay(T0).replace(/-/g, '')
    const first = new Uint8Array(await (await get(`/og/meadow-${day}.png`)).arrayBuffer())
    for (let i = 0; i < 20; i++) {
      const res = await get(`/og/meadow-${day}.png`)
      assert.equal(res.status, 200)
      assert.deepEqual(new Uint8Array(await res.arrayBuffer()), first, 'the same bytes, kept')
    }
    // two new postcards spend the rest; a third new one waits, while the ones already drawn still answer
    const seeds = ['20261002-night-abcdefgh', '20261002-dusk-bcdefghi', '20261002-morning-cdefghij']
    const one = await get(`/w/${seeds[0]}.png`)
    assert.equal(one.status, 200)
    assert.equal(one.headers.get('cache-control'), 'public, max-age=86400')
    assert.equal((await get(`/w/${seeds[1]}.png`)).status, 200)
    const limited = await get(`/w/${seeds[2]}.png`)
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
    for (let i = 0; i < 10; i++) assert.equal((await get(`/w/${seeds[i % 2]}.png`)).status, 200, 'a kept postcard costs nothing')
    assert.equal((await get(`/w/${seeds[2]}.png`, '192.0.2.41')).status, 200, 'another address draws its own')
    // the postcard pages themselves never spend it
    for (let i = 0; i < 5; i++) assert.equal((await get(`/w/${seeds[2]}`)).status, 200)
  })

  it('keeps at most the last N drawings, and forgets one that failed', async () => {
    const kept = imageCache(2)
    const bytes = (n: number) => Promise.resolve(new Uint8Array([n]))
    await kept.set('a', bytes(1))
    await kept.set('b', bytes(2))
    assert.ok(kept.get('a'), 'a is now the most recently used')
    await kept.set('c', bytes(3))
    assert.equal(kept.get('b'), undefined, 'b was the least recently used')
    assert.deepEqual(await kept.get('a'), new Uint8Array([1]))
    assert.deepEqual(await kept.get('c'), new Uint8Array([3]))
    await assert.rejects(kept.set('d', Promise.reject(new Error('boom'))))
    assert.equal(kept.get('d'), undefined, 'a failed drawing is drawn again next time')
  })

  it('on the Worker, answers repeats from the edge cache by path and pin, and stores nothing else', async () => {
    const store = new Map<string, Response>()
    const cache = {
      match: async (r: Request) => store.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => { store.set(r.url, res) },
    }
    const waits: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p) } }
    let runs = 0
    const answer = (status = 200, type = 'image/png') => async () => { runs++; return new Response('png', { status, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } }) }
    const via = async (url: string, o: { method?: string; status?: number; type?: string; c?: typeof cache } = {}) => {
      const res = await viaEdgeCache(new Request(url, { method: o.method ?? 'GET' }), 'c' in o ? o.c : cache, ctx, answer(o.status, o.type))
      await Promise.all(waits)
      return res
    }
    const png = 'https://spinlings.dev/w/20261002-night-abcdefgh.png'
    await via(png)
    assert.equal(runs, 1)
    assert.equal(await (await via(png)).text(), 'png')
    await via(png + '?bust=1')
    await via(png + '?e=' + 'x'.repeat(40))
    assert.equal(runs, 1, 'the repeat, with or without a query, never reaches the app')
    // a postcard's pin picks its creature, so it is kept apart, however it is spelled
    await via(png + '?e=fable/1')
    await via(png + '?bust=2&e=fable%2F1')
    assert.equal(runs, 2)
    assert.deepEqual([...store.keys()], [png, png + '?e=fable/1'])
    await via('https://spinlings.dev/og/meadow-20261002.png')
    await via('https://spinlings.dev/og/meadow-20261002.png?e=fable/1')
    assert.equal(runs, 3, 'the meadow has no pin')
    // pages, the API, other methods, failures and other content all pass straight through, unstored
    for (const url of ['https://spinlings.dev/w/20261002-night-abcdefgh', 'https://spinlings.dev/', 'https://spinlings.dev/v1/health', 'https://spinlings.dev/c/abc.png', 'https://spinlings.dev/static/site.0123456789.js']) {
      await via(url)
      await via(url)
    }
    await via('https://spinlings.dev/w/20261340-dusk-abcdefgh.png', { status: 404, type: 'text/html; charset=utf-8' })
    await via(png, { method: 'HEAD' })
    assert.equal(runs, 3 + 10 + 1 + 1)
    assert.equal(store.size, 3)
    // no cache, or a failing one, is just the app
    await via(png, { c: undefined })
    await via(png, { c: { match: () => Promise.reject(new Error('down')), put: () => Promise.reject(new Error('down')) } })
    assert.equal(runs, 17)
  })
})

// ---- the world in the page ------------------------------------------------------------------------

describe('data-world', () => {
  it('carries the world and nobody in it: no handle, no Mythic, no first finder', async () => {
    const s = server()
    const a = await s.join('haiku'), b = await s.join('opus')
    const env = { db: s.db, now: s.now(), randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) }
    const m = await mintCards(env, a.id, [generateMythic({ seed: 'dw01', dna: 7, now: s.now(), origin: 'catch' })])
    await s.db.batch(m.stmts)
    const page = (await html(s, '/')).text
    const raw = page.match(/data-world="([^"]*)"/)![1]!
    const w = worldOfPage(page)
    assert.deepEqual(Object.keys(w).sort(), ['day', 'daysLeft', 'featured', 'found', 'foundToday', 'fusionCost', 'now', 'regulars', 'rule', 'season', 'seasonDay', 'shinyHour', 'species', 'v'].sort())
    assert.equal(w.species.length, 36)
    assert.equal(w.regulars.length, 8)
    for (const handle of [a.me.player.handle, b.me.player.handle]) assert.ok(!unescape(raw).includes(handle), 'no handle in the world')
    assert.ok(!unescape(raw).includes(m.cards[0]!.form!.names[2]!), 'no Mythic in the world')
    assert.ok(!/mythic/i.test(unescape(raw)))
    // the starters were first finds: their finders are named nowhere on the page
    const finders = await s.db.all<{ player_id: string }>('SELECT player_id FROM firsts')
    assert.ok(finders.length > 0)
    for (const p of [a, b]) {
      const lanterns = page.slice(page.indexOf('class="mythlist"'), page.indexOf('</ul>', page.indexOf('class="mythlist"')))
      const elsewhere = page.replace(lanterns, '')
      assert.ok(!elsewhere.includes(p.me.player.handle), 'a handle shows only beside its own Mythic')
    }
  })

  it("never carries the day of a first find: a card's first-find stamp cannot be dated from the page", async () => {
    // A joins on day 2 and B five days later; both teams' starters became first finds the day they joined
    const s = server()
    const a = await s.join('haiku')
    s.tick(5 * DAY)
    const b = await s.join('opus')
    const firsts = await s.db.all<{ species: string; day: string; player_id: string }>('SELECT species, day, player_id FROM firsts ORDER BY species')
    const ofB = firsts.filter(f => f.player_id === b.id)
    assert.ok(firsts.some(f => f.player_id === a.id) && ofB.length > 0, 'both left first finds')
    const page = (await html(s, '/')).text
    const raw = unescape(page.match(/data-world="([^"]*)"/)![1]!)
    const w = worldOfPage(page)
    assert.deepEqual(w.found, firsts.map(f => f.species), 'the found species by id, in id order (never in the order they were found)')
    assert.ok(w.found.every(id => typeof id === 'string'))
    assert.deepEqual(w.foundToday, ofB.map(f => f.species).sort(), "today's finds, the day the album's own count already shows")
    assert.deepEqual([...new Set(raw.match(/\d{4}-\d{2}-\d{2}/g))], [w.day], 'no date in the world but today')
    // and a day on, nothing tells B's day from A's
    s.tick(DAY)
    const next = worldOfPage((await html(s, '/')).text)
    assert.deepEqual(next.foundToday, [])
    assert.deepEqual(next.found, w.found)
  })

  it('keeps even a hostile species name escaped inside the attribute', async () => {
    const s = server()
    const EVIL = `<script>alert(1)</script>"'&<img src=x>`
    const species = seasonSpecies(1).map((x, i) => (i === 3 ? { ...x, names: [EVIL, EVIL, EVIL] } : x))
    await s.db.batch([stmt('INSERT INTO seasons (season, generator, species_json) VALUES (1, 2, ?)', JSON.stringify(species))])
    const page = (await html(s, '/')).text
    assert.doesNotMatch(page, /<script>alert|<img src=x/)
    assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
    assert.equal(worldOfPage(page).species[3]!.names[0], EVIL, 'and reads back exactly')
  })

  it('ignores the dev preview unless the local server turned it on', async () => {
    const s = server()
    const plain = await html(s, '/')
    const asked = await html(s, '/?preview=rule:wildBloom,found:all,mythics:5')
    assert.equal(asked.res.headers.get('cache-control'), 'public, max-age=60')
    assert.equal(worldOfPage(asked.text).rule, worldOfPage(plain.text).rule)
    assert.ok(!('preview' in worldOfPage(asked.text)))
  })
})

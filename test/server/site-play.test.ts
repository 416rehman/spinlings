// The site's third pass (SPEC 36): a proportional pixel font, one pixel card frame everywhere, a
// battle band that rises without moving the page and ends in a catch, a den drawn as a place, a
// market with a lantern for every Mythic, prompts you can copy wherever there is a line to type, and
// regulars that never share a name with a species. Markup and CSS are read off the real pages.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import { utcDay, worldOf } from '../../plugin/hooks/core/world.ts'
import { stmt } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { boldWordSvg, ink, kern, layoutWord, wordSvg } from '../../server/src/pages-font.ts'
import { cardFace, rarityLine, SITE_CSP } from '../../server/src/pages-html.ts'
import { packDeck, rollPack, siteCard } from '../../server/src/pages-meet.ts'
import type { SiteWorld } from '../../server/src/pages-meet.ts'
import { regulars } from '../../server/src/pages-world.ts'
import { SITE_ASSETS, SITE_FILES } from '../../server/static/site.gen.ts'
import { DAY, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

type Page = { status: number; headers: Headers; html: string }
const get = async (s: Server, path: string): Promise<Page> => {
  const res = await s.request('GET', path, { client: null })
  return { status: res.status, headers: res.headers, html: await res.text() }
}
const textOf = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ ([,.])/g, '$1')
const css = (html: string) => html.match(/<style>([\s\S]*?)<\/style>/)![1]!
const env = (s: Server) => ({ db: s.db, now: s.now(), randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) })

async function mythicFor(s: Server, p: Player, seed: string) {
  const { cards, stmts } = await mintCards(env(s), p.id, [generateMythic({ seed, dna: 7, now: s.now(), origin: 'catch' })])
  await s.db.batch(stmts)
  return cards[0]!
}

async function giftFor(s: Server, p: Player) {
  const fresh = mintFor('sonnet', 'rare', rngFromSeed('gift-play'), s.now(), 'trader', false)
  const { cards, stmts } = await mintCards(env(s), p.id, [fresh])
  await s.db.batch(stmts)
  const code = 'soft-lamp-otter-1234'
  await s.db.batch([
    stmt(`INSERT INTO gifts (code, giver_id, card_id, state, created, expires) VALUES (?, ?, ?, 'open', ?, ?)`, code, p.id, cards[0]!.id, utcDay(s.now()), utcDay(s.now() + 14 * DAY)),
    stmt(`UPDATE cards SET state = 'escrow', escrow_ref = ? WHERE id = ?`, code, cards[0]!.id),
  ])
  return code
}

describe('pixel type', () => {
  it('sets each glyph by its own ink: i, l, 1 and stops are narrow, W and m stay wide', () => {
    for (const ch of ['i', 'l', '1', '.', ',', "'"]) assert.ok(ink(ch)[1] <= 3, `${ch} is ${ink(ch)[1]} wide`)
    for (const ch of ['W', 'm', 'M']) assert.equal(ink(ch)[1], 5, ch)
    // "Wild" used to be 4 cells of 6; now the i and l take their own width
    const wild = layoutWord('Wild')
    assert.ok(wild.w < 4 * 6 - 1, `Wild is ${wild.w} wide`)
    assert.deepEqual([...'Wild'].map((ch, i) => wild.at[i]! + ink(ch)[0]), [0, 6, 10, 14], "each glyph's ink starts one column after the last one's")
  })

  it('tucks a pair one column closer only where no row would touch, and never more', () => {
    assert.equal(kern('r', '.'), -1)
    assert.equal(kern('T', 'a'), -1)
    for (const [a, b] of [['l', 'l'], ['W', 'i'], ['m', 'n'], ['o', 'o']]) assert.equal(kern(a!, b!), 0, `${a}${b}`)
    // the bold cut keeps the same rhythm, doubled, with room for its shadow
    const reg = layoutWord('Claude'), bold = layoutWord('Claude', true)
    assert.ok(bold.w >= 2 * reg.w && bold.w <= 2 * reg.w + 2 * 6 + 2, `${bold.w} vs ${reg.w}`)
    assert.match(wordSvg('Claude'), new RegExp(`viewBox="0 0 ${reg.w} 9" style="--w:${reg.w}"`))
    assert.match(boldWordSvg('Claude'), new RegExp(`viewBox="0 0 ${bold.w} 20" style="--w:${bold.w}"`))
  })
})

describe('the card frame', () => {
  const w = { season: 1, now: T0 }
  const sp = seasonSpecies(1).find(s => s.family === 'sonnet' && !s.legendary)!

  it('says rarity and finish in one line, shows genes as gene quality with a tip, and draws finishes instead of chips', () => {
    const plain = siteCard(w, { species: sp }, { rarity: 'rare', shiny: false, foil: false, dna: 1 })
    const both = siteCard(w, { species: sp }, { rarity: 'epic', shiny: true, foil: true, dna: 2 })
    assert.equal(rarityLine(plain), 'Rare')
    assert.equal(rarityLine(both), 'Epic · Shiny Foil')
    const face = cardFace(both, { genes: true, big: true }).__html
    assert.match(face, /<div class="cf big foil shiny"/)
    assert.match(face, /<p class="cf-rar">Epic · Shiny Foil<\/p>/)
    assert.match(face, /<p class="cf-row genes" title="How good its four genes are[^"]*"><b>Gene quality \d+%<\/b>/)
    assert.doesNotMatch(face, /cf-stamps|--bc:/, 'no Shiny/Foil chips and one gene bar colour')
    assert.match(face, /<p class="cf-name"><span class="pt" aria-hidden="true"><svg class="pw bd"/, 'a big face names it in pixel type')
  })

  it('gives a Mythic its own animated frame and a halo on its page', async () => {
    const s = server()
    const a = await s.join('haiku')
    const m = await mythicFor(s, a, 'fr01')
    const p = await get(s, `/c/${m.id}`)
    assert.match(p.html, /<div class="bigcard mythic" data-bigcard><div class="cf big foil mythic"/)
    assert.match(css(p.html), /\.cf\.mythic\{[^}]*conic-gradient\(from var\(--ang\)/)
    assert.match(css(p.html), /\.bigcard\.mythic::before\{/)
    // the plaque holds what the face does not: no second rarity, family or genes line
    const plaque = p.html.slice(p.html.indexOf('<div class="plaque">'), p.html.indexOf('</article>'))
    assert.doesNotMatch(plaque.replace(/<p class="sr">[^<]*<\/p>/, ''), /Gene quality|class="kind"|Opus family|Fable family|Haiku family|Sonnet family/)
    assert.match(plaque, /<ul class="story">/)
  })
})

describe('every line to type can be copied', () => {
  it('puts the prompt caret inside the line, and a Copy button beside every command', async () => {
    const s = server()
    const a = await s.join('haiku')
    const code = await giftFor(s, a)
    for (const path of ['/', `/g/${code}`, `/u/${a.me.player.handle}`]) {
      const html = (await get(s, path)).html
      const prompts = [...html.matchAll(/<div class="prompt">([\s\S]*?)<\/div>/g)].map(m => m[1]!)
      assert.ok(prompts.length >= 1, path)
      for (const pr of prompts) {
        assert.match(pr, /^<pre [^>]*><span class="gt" aria-hidden="true">&gt;<\/span><code>/, `${path}: the caret shares the command's line`)
        assert.match(pr, /<button class="pbtn copy js-only" type="button" data-copy>/, `${path}: Copy`)
      }
    }
    const gift = await get(s, `/g/${code}`)
    assert.ok(textOf(gift.html).includes(`/spin claim ${code}`))
    assert.match(gift.html, /<p class="tapme js-only" aria-hidden="true">Tap to unwrap <span class="kc1">o<\/span><\/p>/)
    assert.ok(textOf(gift.html).includes('A Spinling is waiting for you.'), 'the heading ends like every other')
    assert.match(css(gift.html), /html\.js \.giftstall:not\(\.open\) \.present\{animation:pwob 3s/)
  })
})

describe('the landing, third pass', () => {
  it('opens the battle band with transforms and a clip only, dark in the arena family, with one keycap', async () => {
    const s = server()
    await s.join('haiku')
    const p = await get(s, '/')
    assert.equal(p.headers.get('content-security-policy'), SITE_CSP)
    assert.match(p.html, /<div class="demo" data-demo style="--psky:#1a1133;--pground:#3a2262;--pshade:#5e3d9a">/, 'the fable arena at dusk, dark')
    assert.match(p.html, /<div class="screen" data-screen>\n<div class="feed">/)
    assert.equal((p.html.match(/class="kc1">1</g) ?? []).length, 1, 'the 1 key appears once (on Start battle), beside the big keycap')
    // the keycap is a picture until site.js makes it the button (a toy: see the no-script test in site-craft)
    assert.match(p.html, /<span class="khint">Perfect hit when a special fires<\/span>\n<span class="key1" data-toy="Press 1 for a Perfect hit" data-keys="1" data-key1 role="img" aria-label="The 1 key">/)
    assert.match(p.html, /<p class="waitline">Win, and you might catch one\. You never lose a card\.<\/p>/, 'the result has its room before it arrives')
    const c = css(p.html)
    assert.match(c, /\.outrow\{[^}]*min-height:96px/)
    assert.match(c, /\.banner\{[^}]*white-space:nowrap/)
    assert.match(c, /\.fighter \.nm\{[^}]*text-overflow:ellipsis/)
    assert.match(c, /\.callout\{[^}]*bottom:calc\(100% \+ 2px\)/)
  })

  it('draws the den: a foil pack on a stump with an emboss per family, card-back slots and rooms in the soil', async () => {
    const s = server()
    await s.join('haiku')
    const html = (await get(s, '/')).html
    const den = html.slice(html.indexOf('id="collect"'), html.indexOf('id="trade"'))
    assert.match(den, /<span class="pack" data-toy="Fable pack\. Open it\." data-keys="o" data-pack data-fam="fable"/)
    for (const f of ['haiku', 'sonnet', 'opus', 'fable']) assert.match(den, new RegExp(`<g class="em em-${f}"`), f)
    assert.match(den, /<g class="pk-top">/, 'the crimp that tears off')
    assert.match(den, /<svg class="stumpart"/)
    assert.equal((den.match(/<div class="slots" aria-hidden="true">(<i><\/i>){5}<\/div>/g) ?? []).length, 1)
    assert.equal((den.match(/<div class="hollow-room /g) ?? []).length, 2)
    assert.match(den, /<div class="hatchspot" aria-hidden="true"><i><\/i><span>Hatches here<\/span><\/div>/)
    for (const h of ['Open a pack', 'Fuse two into one']) assert.ok(textOf(den).includes(h))
    assert.doesNotMatch(den, /class="chip"|class="chamber/, 'no panel kit')
  })

  it('keeps the meadow keyboard-first: a skip to the wild one, and lamps out of the Tab order', async () => {
    const s = server()
    const html = (await get(s, '/')).html
    assert.ok(html.includes('<a class="skip js-only" href="#meet" data-meetskip>Meet the wild one</a>'))
    // pictures without script; site.js makes them buttons and keeps them out of the Tab order (hero.ts lamps)
    assert.equal((html.match(/<span class="lamp" data-toy="Turn the lamp off" aria-hidden="true"/g) ?? []).length, 2)
    // the bubble's tail follows whoever speaks
    assert.match(css(html), /\.bubble::after\{[^}]*left:var\(--tail-x,/)
  })

  it('serves every script as first-party JavaScript, and the band catch lives in the shared card code', async () => {
    const s = server()
    for (const name of Object.keys(SITE_FILES)) {
      const res = await s.request('GET', `/static/${name}`, { client: null })
      assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8', name)
      const js = await res.text()
      assert.doesNotMatch(js, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/, `${name} reaches nowhere else`)
    }
    const all = Object.values(SITE_FILES).join('\n')
    assert.ok(all.includes('Gotcha!') && all.includes('It slipped away!') && all.includes('wandered back into the grass'), 'the catch, the miss and the loss')
    assert.ok(all.includes('Psst. Type spin.'), 'the napper knows the secret')
    assert.ok(SITE_FILES[SITE_ASSETS.site]!.length > 0)
  })
})

describe('site creatures, third pass', () => {
  it('names no regular after a species of the season', () => {
    const species = seasonSpecies(1)
    const names = new Set(species.flatMap(s => s.names))
    for (const r of regulars(species)) for (const n of r.names) assert.ok(!names.has(n), `${n} is a species name`)
    assert.equal(regulars(species).length, 8)
    assert.equal(regulars(species), regulars(species), 'computed once per season')
  })

  it('deals a pack from a shuffled deck: no creature twice while the deck lasts', () => {
    const species = seasonSpecies(1)
    const ww = worldOf(T0)
    const found = species.filter(s => !s.legendary && s.family === 'fable').slice(0, 3).map(s => s.id)
    const w: SiteWorld = { now: T0, day: ww.day, season: 1, rule: ww.rule, featured: ww.featured, found, foundToday: [], species: [...species], regulars: regulars(species) }
    assert.ok(packDeck(w, 'fable').length >= 5)
    const rng = rngFromSeed('decks')
    for (let i = 0; i < 200; i++) {
      const names = rollPack(w, 'fable', rng).flatMap(s => ('card' in s && s.card.rarity !== 'legendary' ? [s.card.species === 'promo' ? s.card.form!.names[0] : s.card.species] : []))
      assert.equal(new Set(names).size, names.length, `pack ${i}: ${names.join(', ')}`)
    }
  })
})

describe('the market and the camp, third pass', () => {
  it('hangs the deal tags as buttons the Trader answers, in short words', async () => {
    const s = server()
    await s.join('haiku')
    const html = (await get(s, '/')).html
    // plain text without script; site.js makes each a button the Trader answers
    const tags = [...html.matchAll(/<li class="dtag"><span class="tagb" data-toy="" data-deal="([^"]+)"><b>\1<\/b><span>([^<]+)<\/span><\/span><\/li>/g)]
    assert.equal(tags.length, 3)
    for (const t of tags) assert.match(t[2]!, /^\d+ [a-zA-Z]+ in, \d+ [a-zA-Z ]+ out$/)
    assert.doesNotMatch(html, /tabindex="0"><b>/, 'no focusable tag that does nothing')
    assert.match(html, /<svg class="edge mtop"[^>]*>[\s\S]*?<path class="nw"/, 'the town has lit windows')
  })

  it("pitches every trainer's camp: the fireside, their three, a tent and a fire to stoke", async () => {
    const s = server()
    const a = await s.join('haiku')
    const p = await get(s, `/u/${a.me.player.handle}`)
    assert.equal(p.status, 200)
    assert.match(p.html, /<div class="fireside tented">/)
    assert.match(p.html, /<svg class="tentart"/)
    assert.match(p.html, /<span class="fire" data-toy="Stoke the fire" data-fire role="img" aria-label="A campfire">/)
    assert.match(p.html, /<p class="pennant">[A-Z][a-z]+ league<\/p>/, 'the league badge is real text, not hidden')
    assert.match(p.html, /<p class="empty doze"><svg class="spr shut"/, 'an empty board dozes')
  })
})

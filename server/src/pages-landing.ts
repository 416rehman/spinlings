// The landing page (SPEC 36, site brief): one walk through the meadow the creatures come from. It
// starts under the visitor's own sky (#meet), crosses the clearing where the band demo battles
// (#battle), drops into the den under the roots (#collect), goes out to the night market (#trade)
// and ends at the campfire (#install). Each place fades into the next through a dithered ramp.
// Everything here is server-rendered and reads without script: the featured species stands revealed
// by the tuft, the album, the Trader's deals and the lanterns are all real. site.js
// (server/static/client) then brings the world to life. Its toys (teammates, lamps, the type wheel,
// the 1 key, the pack, the deal tags, the fire) are plain pictures and text until site.js makes each
// [data-toy] a button, so nothing without script promises a press that cannot happen.
import { cardName, geneScore } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { FAMILIES, FAMILY_INFO, SPECIALS, beatenBy } from '../../plugin/hooks/core/families.ts'
import { hashString, rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { TRAITS } from '../../plugin/hooks/core/traits.ts'
import type { BattleCard, Family, Species, TraderDeal } from '../../plugin/hooks/core/types.ts'
import { RULE_INFO } from '../../plugin/hooks/core/world.ts'
import { FAMILY_COLOR, FAMILY_MARK, RARITY_COLOR } from '../../plugin/hooks/ui/tokens.ts'
import { pixelWords, wordSvg } from './pages-font.ts'
import { cardFace, html, installBlock, pixelHeading, PLACE, raw, rarityLine, text } from './pages-html.ts'
import type { Raw } from './pages-html.ts'
import { ARENA, HOUR_FAMILY, isFound, regularCard, rollSlot } from './pages-meet.ts'
import type { Hour, SiteCard } from './pages-meet.ts'
import {
  Art, campGroundSvg, denTopSvg, dither, ditherDefs, fireSvg, grassSvg, hillSvg, lampSvg, marketTopSvg,
  moonSvg, noise, peaksSvg, ramp, rockSvg, starsSvg, sunSvg, tentSvg, tuftSvg,
} from './pages-scene.ts'
import { maskPath, shadowSvg, spriteSvg } from './pages-sprite.ts'
import type { SiteFacts } from './pages-world.ts'
import { desktopGallery } from './pages-media.ts'

export type LandingData = {
  w: SiteFacts
  mythics: { name: string; handle: string | null }[]
  mythicCount: number
  deals: TraderDeal[]
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const famName = (f: Family) => FAMILY_INFO[f].name
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** The day's regular of each family, at stage 2 (the hero team stands at levels 4 and 5). */
const dayRegulars = (w: SiteFacts) => Object.fromEntries(FAMILIES.map(f => [f, regularCard(w, f, teamIndex(w, f), 4)])) as Record<Family, SiteCard>

/** Which of a family's two regulars stands in the hero today (pages-meet teamRegulars agrees). */
const teamIndex = (w: SiteFacts, f: Family) => hashString(`spinlings/site/team/${w.day}/${f}`) % 2

const featuredOf = (w: SiteFacts): Species => w.species.find(s => s.id === w.featured)!

export function landingBody(d: LandingData): Raw {
  const { w } = d
  const regs = dayRegulars(w)
  return html`${raw(ditherDefs([['k1', 'k2'], ['k2', 'k3'], ['k3', 'k4']]))}
<p class="sr" id="live" aria-live="polite"></p>
${hero(w, regs)}
${battle(w, regs)}
${den(w, regs)}
${market(d)}
${campfire(w, regs)}`
}

// ---- #meet ---------------------------------------------------------------------------------------

/**
 * The hero's night sky, 420 x 84 art px: one path per star, so the page can hide the few that would
 * sit between the letters of the headline (hero.ts), instead of reading as accents on them.
 */
const HERO_STARS = (() => {
  let out = ''
  for (let i = 0; i < 110; i++) {
    const x = 1 + Math.floor(noise('hsx', i) * 418), y = 1 + Math.floor(noise('hsy', i) * 82)
    const d = i % 13 === 0 ? `M${x - 1} ${y}h3v1h-3zM${x} ${y - 1}h1v3h-1z` : `M${x} ${y}h1v1h-1z`
    out += `<path class="s${i % 3}" d="${d}"/>`
  }
  return `<svg class="stars" viewBox="0 0 420 84" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${out}</svg>`
})()

function hero(w: SiteFacts, regs: Record<Family, SiteCard>): Raw {
  const featured = featuredOf(w)
  const fname = text(featured.names[0], 40)
  const rule = RULE_INFO[w.rule]
  // the four hours' teams: the family each hour's family beats, and the one that beats it
  const mates = FAMILIES.map(f => {
    const c = regs[f]
    const name = text(cardName(c), 40)
    return html`<span class="mate" data-toy="" role="img" data-fam="${f}" aria-label="${name}, ${famName(f)} teammate">${raw(spriteSvg(spriteFor(c)))}<span class="tag" aria-hidden="true"></span></span>`
  })
  return html`<section class="hero" id="meet" aria-labelledby="meet-h">
<div class="sky">
<div class="starfield" aria-hidden="true">${raw(HERO_STARS)}</div>
<button class="sunbtn js-only" type="button" aria-label="Change the time of day. Now: dusk." title="Fable dusk. Drag me.">${raw(sunSvg())}${raw(moonSvg())}</button>
<span class="sunbtn still" aria-hidden="true">${raw(sunSvg())}</span>
<div class="skyb b1"><div class="wrap"><h1 id="meet-h" tabindex="-1">${pixelHeading('Wild creatures find you while Claude works.')}</h1>
<p class="lede">Spinlings is a creature card game inside Claude Code. While Claude works, wild ones wander into a slim band above your prompt. Your team of three battles them, and every catch is a card that exists exactly once.</p>
<p class="today-m"><b>Today: ${rule.name}.</b> <span class="ruletext">${rule.text}.</span></p>
</div></div>
${raw(dither('k1', 'k2'))}
<div class="skyb b2"></div>
${raw(dither('k2', 'k3'))}
<div class="skyb b3"></div>
</div>
<div class="scene" data-scene>
<div class="sband" aria-hidden="true"><div class="s3"></div>${raw(dither('k3', 'k4'))}<div class="s4"></div></div>
<div class="lay peaks" aria-hidden="true">${raw(peaksSvg())}</div>
<div class="lay hill" aria-hidden="true">${raw(hillSvg())}</div>
<div class="actors">
<span class="lamp" data-toy="Turn the lamp off" aria-hidden="true" style="--x:var(--lamp1)">${raw(lampSvg())}</span>
<div class="sign"><div class="board"><p><b>Today: ${rule.name}</b></p><p class="ruletext">${rule.text}.</p></div></div>
<span class="lamp" data-toy="Turn the lamp off" aria-hidden="true" style="--x:var(--lamp2)">${raw(lampSvg())}</span>
<div class="mates">${mates}</div>
<div class="patch" data-patch>
<p class="bubble" data-chip><span class="nojs-line">A wild <b style="color:${RARITY_COLOR.common}">${fname}</b> appeared!</span></p>
<div class="hide" data-hide></div>
<div class="tuftbox">${raw(tuftSvg())}</div>
<div class="featured-still">${raw(spriteSvg(spriteFor({ form: featured, stage: 1 }), { label: `A wild ${fname}` }))}</div>
</div>
</div>
<div class="lay grass" aria-hidden="true">${raw(grassSvg())}</div>
<div class="wx wx-${w.rule}" aria-hidden="true">${weather(w.rule)}</div>
</div>
<div class="ground">
<div class="wrap">
${installBlock('install')}
<div class="pokes" aria-hidden="true">${raw(TINY_TUFT)}${raw(TINY_TUFT)}${raw(TINY_TUFT)}</div>
</div>
</div>
</section>`
}

/** Fusion Fair: bunting in the four family colours strung across the path. */
const BUNTING = (() => {
  const cols = Object.values(FAMILY_COLOR)
  let flags = ''
  for (let i = 0; i < 40; i++) flags += `<path fill="${cols[i % 4]}" d="M${i * 12 + 2} ${4 + Math.round(3 * Math.sin((i % 10) / 10 * Math.PI))}h7v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z"/>`
  let line = ''
  for (let x = 0; x < 480; x++) line += `M${x} ${3 + Math.round(3 * Math.sin(((x % 120) / 120) * Math.PI))}h1v1h-1z`
  return `<svg class="bunting" viewBox="0 0 480 12" style="--aw:480;--ah:12" shape-rendering="crispEdges" focusable="false"><path fill="#3b2a22" d="${line}"/>${flags}</svg>`
})()

/** Tufts that grow behind the prompt box: the meadow sits on your prompt. */
const TINY_TUFT = `<svg class="poke" viewBox="0 0 9 4" shape-rendering="crispEdges" focusable="false"><path class="g1" d="M1 0h1v1h-1zM5 0h1v1h-1zM7 1h1v1h-1z"/><path class="g2" d="M1 1h2v1h-2zM4 1h3v1h-3zM0 2h9v1h-9zM0 3h9v1h-9z"/></svg>`

/** One quiet loop for the daily rule (site brief 11): particles with their own delays. */
function weather(rule: string): Raw {
  if (rule === 'wildBloom') return html`${FAMILIES.flatMap((f, k) => [0, 1, 2, 3, 4].map(i => html`<b style="--x:${(i * 23 + k * 6 + 3) % 100};--c:${FAMILY_COLOR[f]}"></b>`))}`
  if (rule === 'fusionFair') return raw(BUNTING)
  const n = rule === 'longDay' ? 0 : rule === 'calm' ? 1 : 12
  return html`${Array.from({ length: n }, (_, i) => html`<i style="--i:${i};--x:${(i * 37 + 11) % 100};--d:${((i * 53) % 40) / 10}"></i>`)}`
}

// ---- #battle -------------------------------------------------------------------------------------

function battle(w: SiteFacts, regs: Record<Family, SiteCard>): Raw {
  const featured = featuredOf(w)
  const fname = text(featured.names[0], 40)
  const topsy = w.rule === 'topsyTurvy'
  const dusk = HOUR_FAMILY.dusk
  const a = regs[FAMILY_INFO[dusk].beats], b = regs[beatenBy(dusk)]
  const lead = text(cardName(b), 40)
  const special = SPECIALS[FAMILY_INFO[b.family].special].name
  const place = ARENA[dusk]
  return html`<section class="battle dark" id="battle" aria-labelledby="battle-h">
${raw(ramp('g3', 'kc'))}
<div class="wrap">
<div class="bt-top">
<div class="bt-copy">
<h2 id="battle-h" tabindex="-1">${pixelHeading('Your team battles above the prompt.')}</h2>
<p class="body">Once Claude has been busy for 20 seconds, something may rustle out. Your three fight on their own. When a special fires, press 1 for a Perfect hit.</p>
<p class="need js-only" data-need hidden><button class="tbtn" type="button" data-needgo>Your third spot is empty. Meet the wild one at the top.</button></p>
</div>
<div class="bt-side">
<div class="poster" style="--fam:${FAMILY_COLOR[featured.family]}">
<div class="pin" aria-hidden="true"></div>
${raw(spriteSvg(spriteFor({ form: featured, stage: 1 })))}
<p><b>Spotted today: ${fname}</b></p><p class="soft">Out in the grass more than usual.</p>
</div>
<figure class="wheelbox${topsy ? ' topsy' : ''}">
<span class="wheel" data-toy="Turn the type wheel" role="img" aria-label="The type wheel">${raw(wheelSvg())}${FAMILIES.map((f, i) => html`<span class="runner r${i}" style="--fam:${FAMILY_COLOR[f]}">${raw(spriteSvg(spriteFor(regs[f])))}</span>`)}</span>
<figcaption>${topsy ? 'Today it all runs backwards. ' : ''}Opus beats Sonnet. Sonnet beats Haiku. Haiku beats Fable. Fable beats Opus.</figcaption>
</figure>
</div>
</div>
<div class="demo" data-demo style="--psky:${place[0]};--pground:${place[1]};--pshade:${place[2]}">
<div class="screen" data-screen>
<div class="feed">
<div class="tx" aria-hidden="true">${TRANSCRIPT.map(([sub, line]) => html`<p${sub ? html` class="sub"` : ''}>${sub ? '' : html`<i></i>`}${line}</p>`)}</div>
<div class="spinrow"><button class="spinner js-only" type="button" aria-label="Change the spinner word">${raw(flowerSvg())}<span class="verb">Rustling…</span> <span class="secs">0s</span><span class="ff" aria-hidden="true">${raw(FF)}</span></button><span class="spinner still" aria-hidden="true">${raw(flowerSvg())}<span class="verb">Rustling…</span> <span class="secs">24s</span></span></div>
</div>
<div class="band" data-band role="img" aria-label="${`The battle band above the prompt: your team against a wild ${fname}`}">
<div class="bsky"><i></i><i></i><i></i><i></i><i></i></div><div class="bridge" aria-hidden="true">${raw(RIDGE)}</div><div class="bdz">${raw(PLACE_DITHER)}</div><div class="bground"></div>
<div class="lbox" aria-hidden="true"></div>
<p class="banner" data-banner>${raw(pixelWords(`${lead} used ${special}!`, 'pt bpt'))}</p>
<p class="pcount" data-pcount></p>
<div class="side sa" data-side="a">${[b, a].map((c, i) => html`<div class="fighter${i ? '' : ' act'}"><span class="nm">${text(cardName(c), 40)}</span><span class="hp"><i style="--v:100%"></i></span>${raw(spriteSvg(spriteFor(c)))}</div>`)}</div>
<div class="side sd" data-side="d"><div class="fighter act"><span class="nm">${fname}</span><span class="hp"><i style="--v:62%"></i></span>${raw(spriteSvg(spriteFor({ form: featured, stage: 1 })))}</div></div>
</div>
</div>
<p class="cap" data-cap>Arena: ${famName(dusk)}. ${famName(dusk)} creatures hit 10% harder here.</p>
<div class="prow">
<span class="caret" aria-hidden="true"></span>
<button class="pchip js-only" type="button" data-model style="--fam:${FAMILY_COLOR[dusk]}"><span class="mark" aria-hidden="true">${FAMILY_MARK[dusk]}</span> <span class="v">${famName(dusk)}</span></button>
<span class="grow"></span>
<span class="khint">Perfect hit when a special fires</span>
<span class="key1" data-toy="Press 1 for a Perfect hit" data-keys="1" data-key1 role="img" aria-label="The 1 key">${raw(KEY_RING)}<span class="cap1">${raw(wordSvg('1'))}</span></span>
</div>
<div class="outrow js-only">
<button class="tbtn pauseb" type="button" data-pause aria-label="Pause demo battle" aria-pressed="false" hidden>Ⅱ Pause</button>
<button class="pbtn startb" type="button" data-start hidden><span class="face">Start battle <span class="kc1">1</span></span></button>
<div class="result" data-result hidden></div>
<p class="waitline">Win, and you might catch one. You never lose a card.</p>
</div>
</div>
<p class="foot1">Win, and you might catch one. You never lose a card.</p>
${desktopGallery()}
</div>
</section>`
}

/** Claude at work above the band: what the frame shows while the clock runs (sub lines are results). */
const TRANSCRIPT: [sub: boolean, line: string][] = [
  [false, 'Reading 6 files'], [false, 'Searching 3 folders'], [false, 'Thinking it over'], [false, 'Editing 2 files'],
  [false, 'Running the tests'], [true, '14 passed, 1 failed'], [false, 'Editing 1 file'], [false, 'Running the tests again'], [true, '15 passed'],
]

/** Fast-forward: two pixel arrowheads while the spinner's clock runs ahead. */
const FF = '<svg viewBox="0 0 9 5" shape-rendering="crispEdges" fill="currentColor" focusable="false"><path d="M0 0h1v5h-1zM1 1h1v3h-1zM2 2h1v1h-1zM5 0h1v5h-1zM6 1h1v3h-1zM7 2h1v1h-1z"/></svg>'

/** A low ridge in the place's shade behind the band's ground: 300 x 6, drawn at 4 px. */
const RIDGE = (() => {
  const h = (x: number) => Math.max(1, Math.round(3 + 2 * Math.sin(x / 13) + 1.5 * Math.sin(x / 5.3 + 1)))
  return `<svg viewBox="0 0 300 6" shape-rendering="crispEdges" focusable="false"><path d="${maskPath(300, 6, (x, y) => y >= 6 - h(x))}"/></svg>`
})()

/** The keycap's ring of 12 segments that light in turn during a wind-up. */
const KEY_RING = (() => {
  const segs: string[] = []
  const pos: [number, number, number, number][] = [
    [6, 0, 4, 2], [12, 0, 4, 2], [18, 2, 2, 4], [18, 8, 2, 4], [18, 14, 2, 4], [12, 18, 4, 2], [6, 18, 4, 2], [0, 14, 2, 4], [0, 8, 2, 4], [0, 2, 2, 4], [2, 0, 2, 2], [16, 0, 2, 2],
  ]
  pos.forEach(([x, y, ww, hh], i) => segs.push(`<path class="sg sg${i}" d="M${x} ${y}h${ww}v${hh}h-${ww}z"/>`))
  return `<svg class="ring" viewBox="0 0 20 20" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${segs.join('')}</svg>`
})()

const PLACE_DITHER = `<svg viewBox="0 0 400 2" preserveAspectRatio="none" shape-rendering="crispEdges" focusable="false"><defs><pattern id="pdz" width="2" height="2" patternUnits="userSpaceOnUse"><path class="pgr" d="M0 0h1v1h-1zM1 1h1v1h-1z"/></pattern></defs><path class="psk" d="M0 0h400v2h-400z"/><rect width="400" height="2" fill="url(#pdz)"/></svg>`

/** The spinner: our 6-frame pixel flower, 8x8 (each frame a <g>). */
function flowerSvg(): string {
  const frames = [
    ['...#....', '...#....', '.#.#.#..', '..###...', '#######.', '..###...', '.#.#.#..', '...#....'],
    ['....#...', '.#..#...', '..#.#.#.', '...###..', '.######.', '..###...', '.#.#..#.', '...#....'],
    ['........', '.#..#..#', '..#.#.#.', '...###..', '.#######', '...###..', '..#.#.#.', '.#..#..#'],
    ['........', '#..#..#.', '.#.#.#..', '..###...', '#######.', '..###...', '.#.#.#..', '#..#..#.'],
    ['...#....', '...#..#.', '.#.#.#..', '..###...', '.######.', '..###...', '.#.#.#..', '.#.#....'],
    ['...#....', '.#.#.#..', '..###...', '.#####..', '#######.', '.#####..', '..###...', '.#.#.#..'],
  ]
  const g = frames.map((rows, i) => {
    let d = ''
    rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') d += `M${x} ${y}h1v1h-1z` }))
    return `<path class="fr fr${i}" d="${d}"/>`
  }).join('')
  return `<svg class="flower" viewBox="0 0 8 8" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true" focusable="false">${g}</svg>`
}

/** The type wheel: a pixel ring with the four marks' places and arrows between them. */
function wheelSvg(): string {
  const ring = maskPath(40, 40, (x, y) => { const r = Math.hypot(x - 19.5, y - 19.5); return r > 15.5 && r < 17.6 })
  const arrows = ['M27 5h2v1h-2zM28 6h2v1h-2z', 'M34 27h1v2h-1zM33 28h1v2h-1z', 'M11 34h2v1h-2zM10 33h2v1h-2z', 'M5 11h1v2h-1zM6 10h1v2h-1z']
  return `<svg class="wheelart" viewBox="0 0 40 40" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path class="wr" d="${ring}"/><path class="wa" d="${arrows.join('')}"/></svg>`
}

// ---- #collect: the den -------------------------------------------------------------------------

function den(w: SiteFacts, regs: Record<Family, SiteCard>): Raw {
  const foundN = w.species.filter(s => isFound(w, s.id)).length
  const famHour = HOUR_FAMILY.dusk
  const featured = featuredOf(w)
  const fusionCost = w.rule === 'fusionFair' ? ECONOMY.fusion.fairCost : ECONOMY.fusion.cost
  const all = w.species.length
  return html`<section class="den dark" id="collect" aria-labelledby="collect-h">
<div class="edgebox">${raw(denTopSvg())}</div>
<div class="wrap">
<h2 id="collect-h" tabindex="-1">${pixelHeading('Every card is the only one.')}</h2>
<p class="body">Every catch rolls its own colours, eyes, genes and traits. One card in 16 is foil, one in 100 is shiny, and now and then a Mythic turns up that has never existed before.</p>
<div class="shelf" data-shelf>
<h3>${pixelHeading('Open a pack')}</h3>
<div class="packstage">
<div class="packspot"><span class="pack" data-toy="${famName(famHour)} pack. Open it." data-keys="o" data-pack data-fam="${famHour}" style="--fam:${FAMILY_COLOR[famHour]}" role="img" aria-label="A ${famName(famHour)} pack">${raw(packSvg(w))}<span class="ptag packtag" aria-hidden="true">${famName(famHour)} pack</span></span><div class="stump" aria-hidden="true">${raw(STUMP)}</div></div>
<div class="cards5"><div class="slots" aria-hidden="true">${Array.from({ length: ECONOMY.packs.size }, () => html`<i></i>`)}</div><ol class="fan" data-fan aria-label="Pack cards"></ol></div>
</div>
<div class="plank" aria-hidden="true"></div>
<p class="nojs-note">Packs open inside Claude Code.</p>
<div class="shelfctl js-only">
<button class="pbtn" type="button" data-open aria-keyshortcuts="o"><span class="face">Open pack <span class="kc1">o</span></span></button>
<p class="hint" data-fhint hidden><span class="kc1">f</span> Flip the next card</p>
<div class="summary" data-summary hidden></div>
</div>
</div>
<div class="lower">
<div class="hollow-room nest" data-nest>
<h3>${pixelHeading('Fuse two into one')}</h3>
<p class="soft">Tap a pack card or drag it onto a parent, or press Fuse.</p>
<div class="nestrow">
<div class="nslot" data-nslot="a">${raw(spriteSvg(spriteFor(regs[FAMILY_INFO[famHour].beats])))}<span class="nlabel">${text(cardName(regs[FAMILY_INFO[famHour].beats]), 40)}</span></div>
<div class="eggbox" data-egg aria-hidden="true"></div>
<div class="nslot" data-nslot="b">${raw(spriteSvg(spriteFor({ form: featured, stage: 1 })))}<span class="nlabel">${text(featured.names[0], 40)}</span></div>
</div>
<button class="pbtn js-only" type="button" data-fuse><span class="face">Fuse</span></button>
<div class="hatch"><div class="hatchspot" aria-hidden="true"><i></i><span>Hatches here</span></div><div class="nestout" data-nestout aria-live="off"></div></div>
<p class="note">In the game, fusing costs ${ECONOMY.fusion.cost} sparks, and both parents become the new one.${fusionCost !== ECONOMY.fusion.cost ? ` Today it's ${fusionCost}.` : ''}</p>
</div>
<div class="hollow-room burrow" id="season">
<div class="bhead"><h3>${pixelHeading(`Season ${w.season}`)}</h3><span class="ptag">${foundN ? `${foundN} of ${all} found` : `${all} waiting to be found`}</span></div>
<p class="soft">${foundN
    ? 'A creature shows up here once a trainer finds it in the game. The first to find each one keeps a First Discovered stamp for good.'
    : `Nobody has found any of these ${all} yet. Be the first: a first find keeps its First Discovered stamp for good.`}</p>
${FAMILIES.map(f => burrowRow(w, f))}
${tally(w)}
</div>
</div>
</div>
</section>`
}

/**
 * The pack, 32 x 44 art px: a foil wrapper in the family's colour with crimped silver ends (the top
 * crimp is its own group, so it can tear off), a lit left edge, two frames of foil shimmer, and the
 * family's regular embossed on the front (one per family; the page shows the hour's).
 */
function packSvg(w: SiteFacts): string {
  const top = new Art(32, 44), main = new Art(32, 44), shim = new Art(32, 44)
  const crimp = (a: Art, y0: number, teeth: number) => {
    for (let x = 1; x < 31; x++) {
      a.set(x, teeth, x % 2 ? 'pkc' : '')
      for (let y = Math.min(y0, y0 + 2); y <= Math.max(y0, y0 + 2); y++) a.set(x, y, x % 3 ? 'pkc' : 'pkd')
    }
  }
  crimp(top, 1, 0)
  for (let x = 1; x < 31; x++) top.set(x, 4, 'pkd')
  for (let y = 5; y < 39; y++) for (let x = 1; x < 31; x++) main.set(x, y, x < 3 ? 'pkh' : x > 28 || y === 38 ? 'pke' : 'pkb')
  for (let x = 1; x < 31; x++) main.set(x, 39, 'pkd')
  crimp(main, 40, 43)
  for (let y = 6; y < 37; y++) for (let x = 3; x < 28; x++) {
    const d = (x + y) % 44
    if (d >= 8 && d <= 9) shim.set(x, y, 'pks1')
    if (d >= 28 && d <= 30) shim.set(x, y, 'pks2')
  }
  const em = FAMILIES.map(f => {
    const px = spriteFor(regularCard(w, f, 0))
    const on = (x: number, y: number) => (px[y]?.[x] ?? -1) >= 0
    return `<g class="em em-${f}" transform="translate(8 12)"><path class="pke" d="${maskPath(17, 17, (x, y) => on(x - 1, y - 1))}"/><path class="pkm" d="${maskPath(16, 16, on)}"/></g>`
  }).join('')
  return `<svg class="packart" viewBox="0 0 32 44" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${main.paths(['pkb', 'pkh', 'pke', 'pkc', 'pkd'])}${em}<g class="sh1">${shim.paths(['pks1'])}</g><g class="sh2">${shim.paths(['pks2'])}</g><g class="pk-top">${top.paths(['pkc', 'pkd'])}</g></svg>`
}

/** The stump the pack stands on, 56 x 16: a ringed top, bark and a spread of roots. */
const STUMP = (() => {
  const a = new Art(56, 16)
  for (let y = 4; y < 16; y++) {
    const spread = y > 12 ? (y - 12) * 3 : 0
    for (let x = 6 - spread; x < 50 + spread; x++) {
      const edge = x < 8 || x > 47
      a.set(x, y, y > 12 && (x + y) % 5 === 0 ? '' : edge ? 'sd' : noise('bark', x) > 0.72 ? 'sd' : 'sb')
    }
  }
  for (let y = 0; y < 9; y++) for (let x = 0; x < 56; x++) {
    const e = ((x - 27.5) / 22) ** 2 + ((y - 4) / 4.4) ** 2
    if (e < 1) a.set(x, y, e > 0.8 ? 'sd' : (e > 0.36 && e < 0.48) || e < 0.04 ? 'sr' : 'sw')
  }
  return a.svg('stumpart', ['sb', 'sd', 'sw', 'sr'])
})()

function burrowRow(w: SiteFacts, f: Family): Raw {
  const list = w.species.filter(s => s.family === f)
  const n = list.filter(s => isFound(w, s.id)).length
  return html`<div class="brow" style="--fam:${FAMILY_COLOR[f]}">
<p class="blabel" id="row-${f}"><span class="mark" aria-hidden="true">${FAMILY_MARK[f]}</span> ${famName(f)}: ${n} of ${list.length} found</p>
<ul class="nooks" aria-labelledby="row-${f}" data-roving>${list.map((s, i) => nook(w, s, i))}</ul>
</div>`
}

function nook(w: SiteFacts, s: Species, i: number): Raw {
  const found = isFound(w, s.id)
  const name = text(s.names[0], 40)
  const line = found ? name : s.legendary ? 'A legendary nobody has found yet.' : 'Nobody has found this one yet.'
  const art = found
    ? raw(spriteSvg(spriteFor({ form: s, stage: 1 }), { cls: 'shut', flash: false }))
    : raw(shadowSvg(spriteFor({ form: s, stage: 1 }), 'shd'))
  return html`<li class="nk${found ? ' found' : ' unfound'}${s.legendary ? ' legend' : ''}"><button class="nook" type="button" tabindex="${i ? -1 : 0}" aria-label="${found ? `${name}${s.legendary ? ', legendary' : ''}` : line}"><span class="hollow">${art}<span class="z" aria-hidden="true">${raw(wordSvg('z'))}</span></span><span class="tip" aria-hidden="true">${line}</span></button></li>`
}

function tally(w: SiteFacts): Raw {
  const n = w.daysLeft
  return html`<div class="tally">
<div class="beam" aria-hidden="true">${Array.from({ length: 28 }, (_, i) => html`<i class="${i + 1 < w.seasonDay ? 'past' : i + 1 === w.seasonDay ? 'now' : ''}"></i>`)}</div>
<p>Day ${w.seasonDay} of 28. 36 new species arrive ${n === 1 ? 'tomorrow' : `in ${plural(n, 'day')}`}.</p>
</div>`
}

// ---- #trade: the night market ---------------------------------------------------------------

/** A deal in a few words: what goes in and what comes out. */
function dealWords(d: TraderDeal): string {
  const g = d.give
  const give = `${g.count} ${g.rarity ?? (g.family ? famName(g.family) : 'cards')}`
  const get = d.get.kind === 'pack'
    ? `${d.get.count} ${famName(d.get.family)} ${d.get.count === 1 ? 'pack' : 'packs'}`
    : `${d.get.count} ${d.get.rarity} ${famName(d.get.family)}`
  return `${give} in, ${get} out`
}

/** A cart wheel, 11 x 11: rim, spokes and a brass hub. */
const WHEEL = (() => {
  let rim = '', spoke = '', hub = ''
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
    const r = Math.hypot(x - 5, y - 5)
    const p = `M${x} ${y}h1v1h-1z`
    if (r > 3.9 && r < 5.5) rim += p
    else if (r < 1.1) hub += p
    else if (r <= 3.9 && (x === 5 || y === 5 || x === y || x + y === 10)) spoke += p
  }
  return `<svg class="cw" viewBox="0 0 11 11" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="#2a1d18" d="${rim}"/><path fill="#7a5638" d="${spoke}"/><path fill="#f2b33d" d="${hub}"/></svg>`
})()

/** Lanterns on the string, 12 of them; the ones near the middle light first. */
const LANTERNS = 12
const LIGHT_ORDER = [5, 6, 4, 7, 3, 8, 2, 9, 1, 10, 0, 11]
const stringY = (x: number) => Math.round(2 + 6 * Math.sin(((x % 250) / 250) * Math.PI))

/**
 * The lantern string across the market, 1000 x 24 art px: a sagging line, and a lantern hanging from
 * it every 30 px around the middle. A lit lantern (with its glow) is a Mythic somebody caught; the
 * others hang dark, waiting.
 */
function lanternString(lit: number): string {
  const line = maskPath(1000, 10, (x, y) => stringY(x) === y)
  const at = (k: number) => 335 + k * 30
  const slot = new Map(LIGHT_ORDER.slice(0, lit).map((k, i) => [k, i]))
  const lamps = Array.from({ length: LANTERNS }, (_, k) => {
    const x = at(k), y = stringY(x) + 1, i = slot.get(k)
    return `<g class="lantern${i === undefined ? ' unlit' : ` l${i}`}" transform="translate(${x - 3} ${y})">${i === undefined ? '' : '<path class="lglow" d="M1 -1h5v2h2v9h-2v3h-5v-3h-2v-9h2z"/>'}<use href="#lantern"/></g>`
  }).join('')
  return `<svg class="lstring" viewBox="0 0 1000 24" style="--aw:1000;--ah:24" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path class="ln" d="${line}"/>${lamps}</svg>`
}

function market(d: LandingData): Raw {
  const { w } = d
  const shown = d.mythics.slice(0, LANTERNS)
  const famHour = HOUR_FAMILY.dusk
  const present = rollSlot(w, FAMILIES[hashString('spinlings/site/present/' + w.day) % 4]!, rngFromSeed('spinlings/site/present/' + w.day), false)
  const trader = regularCard(w, 'fable', 1, 1)
  return html`<section class="market dark" id="trade" aria-labelledby="trade-h">
<div class="edgebox">${raw(marketTopSvg())}</div>
<div class="wrap">
<h2 id="trade-h" tabindex="-1">${pixelHeading('Swap, gift and trade.')}</h2>
<p class="body">Put cards up on the market, make offers, or wrap one up and send the link. When nobody's around, the Wandering Trader keeps a stall.</p>
<p class="body"><a class="tolink" href="/market">Browse the market</a> <a class="tolink" href="/boards">See the leaderboards</a></p>
</div>
<div class="overhead">${raw(LANTERN_SYMBOL)}
<div class="string">${raw(lanternString(shown.length))}</div>
<div class="wrap mythics" id="mythics">
${shown.length
    ? html`<div class="mhead"><h3>${pixelHeading('Mythics found')}</h3><span class="ptag">${d.mythicCount} so far</span></div>
<p class="soft">Each lit lantern is a Mythic somebody caught. When one gets away, it's gone for good.</p>
<ul class="mythlist">${shown.map((m, i) => html`<li class="m${i}"><b>${text(m.name, 48)}</b> found by ${m.handle ? html`<a href="/u/${m.handle}">${text(m.handle, 40)}</a>` : 'a trainer'}</li>`)}</ul>`
    : html`<p class="lampnote"><span class="ptag">The first Mythic lights a lantern.</span></p>`}
</div>
</div>
<div class="wrap">
<div class="bazaar">
<div class="cart">
<span class="trader" aria-hidden="true">${raw(spriteSvg(spriteFor(trader)))}</span>
<div class="awn" aria-hidden="true"></div>
<div class="board">
<h3>${pixelHeading('The Wandering Trader')}</h3>
<ul class="tags">${d.deals.map(deal => html`<li class="dtag"><span class="tagb" data-toy="" data-deal="${deal.name}"><b>${deal.name}</b><span>${dealWords(deal)}</span></span></li>`)}</ul>
<p class="soft">New deals tomorrow.</p>
</div>
<div class="axle" aria-hidden="true">${raw(WHEEL)}${raw(WHEEL)}</div>
</div>
<div class="rug" data-giftstall>
<h3>${pixelHeading('Send a gift')}</h3>
<p class="soft js-only" data-gifthint>Tap the present to unwrap it.</p>
<div class="giftstage">
<button class="present js-only" type="button" data-present style="--fam:${FAMILY_COLOR[famHour]}" aria-keyshortcuts="o" aria-label="A present. Unwrap it.">${raw(PRESENT_SVG)}</button>
<div class="giftcard" data-giftcard>${'card' in present ? cardFace(present.card, { genes: true, traits: true }) : html`<p>A legendary nobody has found yet.</p>`}</div>
<div class="mat" aria-hidden="true"></div>
</div>
<div class="giftafter" data-giftafter>
<p>Gift links open just like this.</p>
<p class="soft">Wrap one with <code>/spin gift</code> inside Claude Code.</p>
<button class="tbtn js-only" type="button" data-rewrap>Wrap it again</button>
</div>
</div>
</div>
<div class="cobbles" aria-hidden="true"></div>
</div>
</section>`
}

/** One lantern drawn once, lit or dark by its group's class. */
const LANTERN_SYMBOL = `<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><symbol id="lantern" viewBox="0 0 7 11" width="7" height="11"><path style="fill:#3b2a22" d="M3 0h1v1h-1zM2 1h3v1h-3zM1 2h5v1h-5zM1 8h5v1h-5zM3 9h1v1h-1z"/><path style="fill:var(--lg)" d="M0 3h1v5h-1zM3 3h1v5h-1zM6 3h1v5h-1z"/><path style="fill:var(--lb)" d="M1 3h2v5h-2zM4 3h2v5h-2z"/><path style="fill:var(--lt)" d="M3 10h1v1h-1z"/></symbol></svg>`

const PRESENT_SVG = (() => {
  const rows = [
    '.....rr..rr.....',
    '....r..rr..r....',
    '....r..rr..r....',
    '.....rrrrrr.....',
    '.LLLLLLrrLLLLLL.',
    '.LLLLLLrrLLLLLL.',
    '.lllllllrrlllll.',
    '..BBBBBrrBBBBB..',
    '..BbBBBrrBBBbB..',
    '..BBBBBrrBBBBB..',
    '..BBBBBrrBBBBB..',
    '..BBbBBrrBBBBB..',
    '..BBBBBrrBBbBB..',
    '..BBBBBrrBBBBB..',
    '..bbbbbrrbbbbb..',
  ]
  const by: Record<string, string> = { r: '', L: '', l: '', B: '', b: '' }
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (by[c] !== undefined) by[c] += `M${x} ${y}h1v1h-1z` }))
  return `<svg class="presentart" viewBox="0 0 16 15" shape-rendering="crispEdges" focusable="false"><g class="lid"><path class="pr" d="${by.r!.split('M').filter(Boolean).filter(p => +p.split(' ')[1]!.split('h')[0]! < 4).map(p => 'M' + p).join('')}"/><path class="pl" d="${by.L}"/><path class="pld" d="${by.l}"/></g><g class="box"><path class="pb" d="${by.B}"/><path class="pbd" d="${by.b}"/><path class="pr" d="${by.r!.split('M').filter(Boolean).filter(p => +p.split(' ')[1]!.split('h')[0]! >= 4).map(p => 'M' + p).join('')}"/></g></svg>`
})()


// ---- #install: the campfire ---------------------------------------------------------------------

/** The campfire: a picture without scripts, which site.js turns into the button that stokes it. */
const FIRE = html`<span class="fire" data-toy="Stoke the fire" data-fire role="img" aria-label="A campfire">${raw(fireSvg())}<span class="sparks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></span>`

/** An empty log by the fire, kept for the visitor's own creature. */
const LOG_SEAT = `<svg class="logart" viewBox="0 0 18 5" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="#6b4a33" d="M1 0h16v4h-16z"/><path fill="#4a3326" d="M1 4h16v1h-16zM0 1h1v3h-1zM17 1h1v3h-1z"/><path fill="#9a7048" d="M2 0h13v1h-13z"/><path fill="#3b2a22" d="M5 2h1v1h-1zM11 1h1v1h-1z"/></svg>`

function campfire(w: SiteFacts, regs: Record<Family, SiteCard>): Raw {
  const dusk = HOUR_FAMILY.dusk
  const lead = regs[FAMILY_INFO[dusk].beats]
  const third = regularCard(w, lead.family, teamIndex(w, lead.family), 8)
  return html`<section class="camp dark" id="install" aria-labelledby="install-h">
${raw(ramp('nt', 'ct'))}
<div class="wrap">
<h2 id="install-h" tabindex="-1">${pixelHeading('Your team is waiting by the fire.')}</h2>
<p class="body">One line inside Claude Code. A starter team hatches right away, two welcome packs are waiting, and the first wild one finds you on Claude's first long turn.</p>
</div>
<div class="fireside">
<div class="campsky" aria-hidden="true">${raw(starsSvg())}</div>
<div class="rock" aria-hidden="true">${raw(rockSvg())}<div class="shadow" data-shadow>${raw(spriteSvg(spriteFor(third), { cls: 'sil' }))}</div></div>
<div class="campers" data-campers>${[regs[beatenBy(dusk)], lead].map(c => html`<span class="camper">${raw(spriteSvg(spriteFor(c)))}</span>`)}<span class="camper seat">${raw(LOG_SEAT)}<span class="saved">Saved for you</span></span></div>
${FIRE}
<p class="oneday" data-oneday aria-hidden="true">One day: ${text(cardName(third), 40)}.</p>
<div class="campground" aria-hidden="true">${raw(campGroundSvg())}</div>
</div>
<div class="wrap campctl">
${installBlock('install2', 'Type this inside Claude Code')}
<p class="postcard js-only"><button class="pbtn" type="button" data-postcard hidden><span class="face" data-postcard-label>Send a postcard</span></button></p>
</div>
</section>`
}

/**
 * A trainer's camp (profile pages): the landing's fireside with their team of three round the fire,
 * each a link to its card, and their tent pitched beside it.
 */
export function teamCamp(team: readonly BattleCard[]): Raw {
  return html`<div class="fireside tented">
<div class="campsky" aria-hidden="true">${raw(starsSvg())}</div>
<div class="tent" aria-hidden="true">${raw(tentSvg())}</div>
<ul class="campers circle">${team.map(c => html`<li class="camper"><a href="/c/${c.id}" aria-label="${text(cardName(c), 40)}, ${rarityLine(c)}">${raw(spriteSvg(spriteFor(c)))}</a></li>`)}</ul>
${FIRE}
<div class="campground" aria-hidden="true">${raw(campGroundSvg())}</div>
</div>`
}

// ---- styles --------------------------------------------------------------------------------------

/** The fireside scene: the landing's campfire and every trainer's camp. */
export const CAMP_CSS = `
.fireside{position:relative;height:calc(76 * var(--ap));margin-top:var(--s4);overflow:hidden;--cs:calc(18 * var(--ap));--fx:0px}
@media (max-width:767px){.fireside{--fx:calc(12 * var(--ap))}}
.campsky{position:absolute;left:0;right:0;top:0;height:calc(40 * var(--ap));overflow:hidden;opacity:.7}
.campsky .stars{position:absolute;left:50%;left:round(down,50%,1px);top:0;width:calc(300 * var(--ap));height:calc(60 * var(--ap));transform:translateX(-50%)}
.campsky .stars path{fill:#c9c3d6}
.fireside[data-live] .campsky .s1{animation:tw 2.8s steps(1) infinite}
.campground{position:absolute;left:0;right:0;bottom:0;height:calc(40 * var(--ap))}
.campground svg{position:absolute;left:50%;left:round(down,50%,1px);bottom:0;width:calc(1000 * var(--ap));height:calc(40 * var(--ap));transform:translateX(-50%)}
.rock{position:absolute;left:calc(50% + var(--fx) - 2 * var(--ap));bottom:calc(17 * var(--ap));width:calc(80 * var(--ap));height:calc(42 * var(--ap));z-index:1}
.rock svg{width:100%;height:100%}
.rockart .rb{fill:#2b3348}.rockart .rh{fill:#46526e}.rockart .rd{fill:#222838}
.shadow{position:absolute;left:calc(30 * var(--ap));bottom:calc(6 * var(--ap));z-index:1;width:calc(27 * var(--ap));height:calc(27 * var(--ap));opacity:.75;--silc:#161c2c}
.shadow .spr{width:100%;height:100%}
.fireside[data-live] .shadow{animation:shad .375s steps(1) infinite}
@keyframes shad{0%{transform:translateX(0)}33%{transform:translateX(var(--ap))}66%{transform:translateX(calc(-1 * var(--ap)))}}
.shadow.color{opacity:1}
.shadow.color .spr.sil .b path,.shadow.color .spr.sil .e path{fill:revert-layer}
.fire{position:absolute;left:calc(50% + var(--fx) - 22 * var(--ap));bottom:calc(16 * var(--ap));z-index:3;width:calc(20 * var(--ap));height:calc(18 * var(--ap));padding:0;border:0;background:none;cursor:pointer}
.fire svg{position:relative;width:100%;height:100%;overflow:visible}
.fireart .fs{fill:#4a4f63}.fireart .fw{fill:#6b4a33}.fireart .fx{fill:#4a3326}
.fireart .f1{fill:#e8744f}.fireart .f2{fill:#f2b33d}.fireart .f3{fill:#fff1c2}
.ff{opacity:0}.ff0{opacity:1}
.fireside[data-live] .ff{animation:fr3 .375s steps(1) infinite}
.fireside[data-live] .ff1{animation-delay:-.25s}.fireside[data-live] .ff2{animation-delay:-.125s}
@keyframes fr3{0%{opacity:1}33.33%,100%{opacity:0}}
.fire.flare svg{transform:scale(1.25);transform-origin:50% 100%}
.sparks i{position:absolute;left:50%;bottom:60%;width:var(--ap);height:var(--ap);background:#ffe2a0;opacity:0}
.fire.flare .sparks i{animation:spark .6s steps(6) forwards}
.fire.flare .sparks i:nth-child(2){left:40%;animation-delay:.05s}.fire.flare .sparks i:nth-child(3){left:60%;animation-delay:.1s}.fire.flare .sparks i:nth-child(4){left:30%;animation-delay:.15s}.fire.flare .sparks i:nth-child(5){left:70%;animation-delay:.08s}.fire.flare .sparks i:nth-child(6){left:50%;animation-delay:.2s}
@keyframes spark{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(calc(-20 * var(--ap)))}}
.fire::before{content:"";position:absolute;left:50%;bottom:calc(-2 * var(--ap));width:calc(36 * var(--ap));height:calc(5 * var(--ap));transform:translateX(-50%);background:#f2b33d;opacity:.1;pointer-events:none;
clip-path:polygon(25% 0,75% 0,75% 25%,90% 25%,90% 50%,100% 50%,100% 100%,0 100%,0 50%,10% 50%,10% 25%,25% 25%)}
.campers{position:absolute;inset:0;z-index:2;pointer-events:none}
.camper{position:absolute;bottom:calc(17 * var(--ap));width:var(--cs);height:var(--cs)}
.camper .spr{width:var(--cs);height:var(--cs)}
.camper:nth-child(1){left:calc(50% + var(--fx) - 64 * var(--ap))}.camper:nth-child(2){left:calc(50% + var(--fx) - 44 * var(--ap));bottom:calc(15 * var(--ap));z-index:4}.camper:nth-child(3){left:calc(50% + var(--fx) + 2 * var(--ap));z-index:3}
.camper.seat{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;bottom:calc(15 * var(--ap))}
.logart{width:calc(18 * var(--ap));height:calc(5 * var(--ap))}
.saved{position:absolute;bottom:calc(8 * var(--ap));left:50%;translate:-50% 0;padding:2px 8px 3px;background:#f1e6cf;color:#2a1d18;font-size:.75rem;font-weight:700;white-space:nowrap;rotate:3deg}
.saved::after{content:"";position:absolute;left:50%;top:100%;width:2px;height:calc(3 * var(--ap));background:#6b4a33}
.oneday{position:absolute;left:calc(50% + var(--fx) + 10 * var(--ap));bottom:calc(56 * var(--ap));z-index:4;padding:4px 10px 5px;background:#fffdf5;color:#1d1726;font-size:.875rem;font-weight:700;opacity:0}
.oneday.on{opacity:1}
.campers{margin:0;padding:0;list-style:none}
.camper a{display:block;pointer-events:auto}
.tent{position:absolute;left:calc(50% + var(--fx) + 22 * var(--ap));bottom:calc(15 * var(--ap));z-index:1;width:calc(40 * var(--ap));height:calc(28 * var(--ap))}
.tent svg{width:100%;height:100%;transform-origin:50% 100%}
.tent:hover svg{animation:tentjig .3s steps(2) 2}
@keyframes tentjig{50%{transform:rotate(-2deg)}}
.tentart .tf{fill:#a8324a}.tentart .td{fill:#7a2236}.tentart .tl{fill:#c95a6e}.tentart .to{fill:#120a10}.tentart .tp{fill:#6b4a33}
@keyframes tw{50%{opacity:.25}}
`

export const LANDING_CSS = `
main{display:block}
.hero :focus-visible,.home .top:not(.solid) :focus-visible{outline-color:var(--ink)}
.hero .ground :focus-visible{outline-color:#fffdf5}
main>section,main>div,.foot,.place{overflow-x:clip}
.dark{color:#f3f1e7}
.dark .soft{color:#cfdccb}
.body{margin-top:var(--s3);font-size:1.0625rem}
.tolink{display:inline-flex;align-items:center;min-height:44px;margin-right:var(--s3);font-weight:700}
.tolink::after{content:"";width:6px;height:10px;margin-left:8px;background:currentColor;clip-path:polygon(0 0,33% 0,33% 20%,66% 20%,66% 40%,100% 40%,100% 60%,66% 60%,66% 80%,33% 80%,33% 100%,0 100%)}
.tolink:hover::after{translate:3px 0}
main section h2{color:inherit}
.ramp{position:relative}

/* ---- hero ---- */
.hero{position:relative;margin-top:calc(-1 * var(--hdr));color:var(--ink);background:var(--sky1);overflow:hidden}
.sky{position:relative;padding-top:var(--hdr)}
.skyb{position:relative}
.skyb>.wrap{position:relative;z-index:2}
.b1{background:var(--sky1);padding:var(--s4) 0 var(--s4)}
.b1 .lede{margin-top:var(--s4)}
.b2{background:var(--sky2);height:calc(6 * var(--ap))}
.b3{background:var(--sky3);height:0}
@media (min-width:1024px){.b3{height:calc(20 * var(--ap))}}
.sky>.dz{position:relative}
.starfield{position:absolute;left:0;right:0;top:0;z-index:1;height:calc(84 * var(--ap));overflow:hidden;opacity:0;pointer-events:none}
.starfield .stars{position:absolute;left:50%;left:round(down,50%,1px);top:0;width:calc(420 * var(--ap));height:calc(84 * var(--ap));transform:translateX(-50%)}
.stars .s0,.stars .s1,.stars .s2{fill:var(--rim)}
.stars .hid{display:none}
html:not(.js) .starfield{display:none}
html[data-hour=night] .starfield{opacity:1}
html[data-hour=dusk] .starfield{opacity:.5;height:calc(30 * var(--ap))}
.hero[data-live] .stars .s1{animation:tw 2.4s steps(1) infinite}
.hero[data-live] .stars .s2{animation:tw 3.1s steps(1) .8s infinite}
@keyframes tw{50%{opacity:.25}}
.hero h1{color:var(--ink);--hsh:var(--sky4);--sho:1}
:root:not([data-hour]) .hero h1,html[data-hour=night] .hero h1,html[data-hour=dusk] .hero h1{--hsh:#000;--sho:.55}
.hero h1 .pt{text-wrap:balance}
.lede{max-width:36rem;font-size:1.125rem;line-height:1.5;color:var(--ink)}
@media (min-width:768px){.lede{font-size:1.25rem}}
.today-m{margin-top:var(--s3);font-size:.9375rem;color:var(--ink)}
@media (min-width:1024px){.today-m{display:none}}
.sunbtn{position:absolute;z-index:3;right:max(24px,calc(50% - 600px));top:calc(var(--hdr) + 24px);width:calc(14 * var(--ap));height:calc(14 * var(--ap));padding:0;border:0;background:none;cursor:grab;touch-action:none}
@media (max-width:1023px){.sunbtn{top:calc(var(--hdr) + 2px);right:16px;width:calc(10 * var(--ap));height:calc(10 * var(--ap))}}
.sunbtn svg{position:absolute;inset:0;width:100%;height:100%}
.sunbtn .moonart{inset:7%;width:86%;height:86%;opacity:0}
.sunart .kl{fill:var(--light)}.sunart .kr{fill:var(--rim)}
.moonart .kl{fill:var(--light)}.moonart .km{fill:color-mix(in srgb,var(--light) 80%,var(--sky1))}
.moonart .ms{fill:var(--sky1);opacity:0}
${Array.from({ length: 8 }, (_, i) => `html[data-moon="${i}"] .moonart .mp${i}{opacity:1}`).join('')}
html[data-hour=night] .sunbtn .sunart{opacity:0}html[data-hour=night] .sunbtn .moonart{opacity:1}
html.js .sunbtn.still{display:none}
@media (min-width:1024px){:root:not([data-hour]) .sunbtn,html[data-hour=dusk] .sunbtn{z-index:0;top:auto;right:max(24px,calc(50% - 360px));bottom:calc(-10 * var(--ap))}}
.sunbtn.dragging{cursor:grabbing}

.scene{position:relative;height:calc(76 * var(--ap));z-index:1}
@media (min-width:1024px){.scene{margin-top:calc(-20 * var(--ap))}}
.sband{position:absolute;inset:0;display:flex;flex-direction:column}
.sband .s3{height:calc(26 * var(--ap));background:var(--sky3)}
.sband .s4{flex:1;background:var(--sky4)}
@media (min-width:1024px){.sband .s3{background:transparent}}
.lay{position:absolute;left:0;right:0;overflow:hidden;pointer-events:none}
.lay svg{position:absolute;left:50%;left:round(down,50%,1px);bottom:0;width:calc(var(--aw) * var(--ap));height:calc(var(--ah) * var(--ap));transform:translateX(-50%)}
.lay.peaks{top:0;height:calc(48 * var(--ap))}
.lay.hill{top:calc(40 * var(--ap));height:calc(30 * var(--ap))}
.lay.hill::after{content:"";position:absolute;left:0;right:0;bottom:0;height:calc(10 * var(--ap));background:var(--hill);z-index:-1}
.lay.grass{bottom:0;height:calc(16 * var(--ap));z-index:3}
.lay.grass .tf path{transition:none}
.lay.grass .tf.lean-l path{transform:translateX(-1px)}.lay.grass .tf.lean-r path{transform:translateX(1px)}
.actors{position:absolute;inset:0;z-index:2;--feet:calc(58 * var(--ap));--spr:64px;--lamp1:-380px;--lamp2:230px;--mate-a:-200px;--mate-b:-128px;--patch:56px;--land:-30px}
@media (min-width:1024px){.actors{--spr:96px;--lamp1:-540px;--lamp2:300px;--mate-a:-300px;--mate-b:-190px;--patch:110px;--land:-60px}}
@media (max-width:767px){.actors{--mate-a:-150px;--mate-b:-84px;--patch:28px;--land:-18px;--lamp1:-190px;--lamp2:156px}}
.actors>*{position:absolute;left:calc(50% + var(--x,0px));top:var(--feet);transform:translateY(-100%)}
.actors>.sign{--x:calc(var(--lamp1) + 7 * var(--ap));top:calc(var(--feet) - 17 * var(--ap));transform:none;width:11.5rem}
.sign::before{content:"";position:absolute;left:calc(-4 * var(--ap));top:calc(-3 * var(--ap));width:calc(100% - 12px + 4 * var(--ap));height:var(--ap);background:#2a2433}
.sign::after{content:"";position:absolute;left:12px;right:12px;top:calc(-2 * var(--ap));height:calc(2 * var(--ap));border-left:2px solid #2a2433;border-right:2px solid #2a2433}
.sign .board{padding:8px 12px 10px;background:#6b4a33;color:#fbf1e2;font-size:.8125rem;line-height:1.35;box-shadow:inset 0 -4px 0 #4a3326,inset 0 0 0 2px #3b2a22;
clip-path:polygon(0 4px,4px 4px,4px 0,calc(100% - 4px) 0,calc(100% - 4px) 4px,100% 4px,100% calc(100% - 4px),calc(100% - 4px) calc(100% - 4px),calc(100% - 4px) 100%,4px 100%,4px calc(100% - 4px),0 calc(100% - 4px))}
.sign b{font-weight:700}
.sign{transform-origin:50% calc(-3 * var(--ap))}
.hero[data-live] .sign{animation:creak 7s steps(1) infinite}
@keyframes creak{0%,88%,100%{rotate:0deg}90%,94%{rotate:1.5deg}92%{rotate:-1deg}}
@media (max-width:1023px){.sign{display:none}}
.lamp{width:calc(7 * var(--ap));height:calc(22 * var(--ap));padding:0;border:0;background:none;cursor:pointer;top:calc(var(--feet) + 1 * var(--ap)) !important}
.lamp svg{width:100%;height:100%}
.lamp .lp{fill:#2a2433}
.lamp.off .kl{fill:#3a3646}
html[data-hour=dusk] .hero[data-live] .lamp:not(.off) .kl{animation:flick 4s steps(1) infinite}
@keyframes flick{0%,92%,100%{opacity:1}94%{opacity:.6}97%{opacity:.85}}
.lamp:not(.off)::before{content:"";position:absolute;left:50%;top:calc(3 * var(--ap));width:calc(15 * var(--ap));height:calc(9 * var(--ap));transform:translateX(-50%);background:var(--lamp);opacity:0;pointer-events:none;
clip-path:polygon(33% 0,67% 0,67% 11%,78% 11%,78% 22%,89% 22%,89% 78%,78% 78%,78% 89%,67% 89%,67% 100%,33% 100%,33% 89%,22% 89%,22% 78%,11% 78%,11% 22%,22% 22%,22% 11%,33% 11%)}
html[data-hour=dusk] .lamp:not(.off)::before,html[data-hour=night] .lamp:not(.off)::before{opacity:.18}
.lamp .moth{position:absolute;width:var(--ap);height:var(--ap);background:#e9e4d0;top:0;left:50%}
.mates{display:contents}
.mate{position:absolute;left:calc(50% + var(--mx,0px));top:var(--feet);transform:translateY(-100%);width:var(--spr);height:var(--spr);padding:0;border:0;background:none;cursor:pointer;display:none}
.mate .spr{width:var(--spr);height:var(--spr)}
.mate .tag{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);padding:4px 10px 5px;background:#14121c;color:#f4f2fb;font-size:.8125rem;white-space:nowrap;opacity:0;pointer-events:none}
.mate.named .tag{opacity:1}
${(['morning', 'afternoon', 'dusk', 'night'] as Hour[]).map(h => {
    const hf = HOUR_FAMILY[h], a = FAMILY_INFO[hf].beats, b = beatenBy(hf)
    const sel = h === 'dusk' ? `:root:not([data-hour]) .mate,html[data-hour=dusk] .mate` : `html[data-hour=${h}] .mate`
    return `${sel.split(',').map(s => `${s}[data-fam=${a}]`).join(',')}{display:block;--mx:var(--mate-a)}${sel.split(',').map(s => `${s}[data-fam=${b}]`).join(',')}{display:block;--mx:var(--mate-b)}`
  }).join('\n')}
html.js .mates[data-own] .mate{display:none}
.mate.cast{display:block!important}
.patch{left:calc(50% + var(--patch));width:calc(24 * var(--ap));height:calc(14 * var(--ap));top:calc(var(--feet) + 2 * var(--ap)) !important}
.patch .tuftbox{position:absolute;inset:0;z-index:2}
.tuft{position:absolute;inset:0;width:100%;height:100%}
.tuft .tt{transition:none}
.patch .hide{position:absolute;left:50%;bottom:calc(4 * var(--ap));width:var(--spr);height:var(--spr);transform:translateX(-50%);z-index:1}
.patch .hide .spr{width:var(--spr);height:var(--spr)}
.featured-still{position:absolute;right:calc(100% + 4px);bottom:calc(2 * var(--ap));width:var(--spr);height:var(--spr)}
.featured-still .spr{width:var(--spr);height:var(--spr)}
html.js .featured-still{display:none}
.bubble{position:absolute;right:-8px;bottom:calc(100% + var(--spr) + 8px);z-index:4;display:flex;align-items:center;width:min(17rem,calc(100vw - 32px));min-height:calc(2 * 1.35em + 17px);padding:8px 12px 9px;background:#14121c;color:#f4f2fb;font-size:.9375rem;font-weight:600;line-height:1.35;
box-shadow:0 0 0 2px #fffdf5,0 4px 0 2px #fffdf5}
.bubble>span{display:block;min-width:0}
.bubble::after{content:"";position:absolute;left:var(--tail-x,calc(100% - 28px - 3 * var(--ap)));top:100%;width:calc(3 * var(--ap));height:calc(3 * var(--ap));margin-top:4px;background:#fffdf5;clip-path:polygon(0 0,100% 0,100% 33%,67% 33%,67% 67%,33% 67%,33% 100%,0 100%)}
@media (min-width:1024px){.bubble{right:-24px}}
.bubble b{font-weight:800}
.bubble a,.bubble button{color:inherit;font:inherit;font-weight:700;background:none;border:0;padding:0;text-decoration:underline;text-underline-offset:.2em;cursor:pointer}
html.js .bubble .nojs-line{display:none}
.bubble:empty{display:none}
.you{position:absolute;padding:0;border:0;background:none;cursor:pointer;width:var(--spr);height:var(--spr);left:calc(50% + var(--yx,var(--land)));top:var(--feet);transform:translate(0,-100%);z-index:2}
.you .spr{width:var(--spr);height:var(--spr)}
.you .holo{display:none}
.pip{position:absolute;left:50%;bottom:calc(100% + 2 * var(--ap));width:calc(5 * var(--ap));height:calc(9 * var(--ap));margin-left:calc(-2.5 * var(--ap));color:#fffdf5;filter:drop-shadow(0 2px 0 #1d1726);pointer-events:none}
.pip svg{width:100%;height:100%}
.ground{position:relative;z-index:4;background:var(--g3);padding:0 0 var(--s4);color:#fffdf5}
.ground .install{max-width:none;position:relative}
.ground .label{font-size:.9375rem;font-weight:600;margin-bottom:var(--s2);padding-top:var(--s2)}
.ground .ask{margin-top:var(--s2);font-size:.9375rem}
.ground .ask q{font-weight:600}
.ground .wrap{position:relative}
.ground .prompt{z-index:1}
.pokes{position:absolute;left:16px;right:16px;top:calc(var(--s2) + 1.6em + var(--s2) - 3 * var(--ap));height:calc(4 * var(--ap));pointer-events:none;z-index:0}
@media (min-width:768px){.pokes{left:32px;right:32px}}
.pokes .poke{position:absolute;top:0;width:calc(9 * var(--ap));height:calc(4 * var(--ap))}
.pokes .poke:nth-child(1){left:6%}.pokes .poke:nth-child(2){left:44%}.pokes .poke:nth-child(3){right:16%}
.wx{position:absolute;inset:0 0 calc(10 * var(--ap));pointer-events:none;z-index:1;overflow:hidden}
.wx b{position:absolute;left:calc(var(--x) * 1%);bottom:calc(3 * var(--ap));width:calc(3 * var(--ap));height:calc(3 * var(--ap));background:var(--c);
clip-path:polygon(33% 0,67% 0,67% 33%,100% 33%,100% 67%,67% 67%,67% 100%,33% 100%,33% 67%,0 67%,0 33%,33% 33%)}
.wx b::after{content:"";position:absolute;inset:33%;background:#fff1c2}
.wx .bunting{position:absolute;left:50%;left:round(down,50%,1px);top:calc(30 * var(--ap));width:calc(480 * var(--ap));height:calc(12 * var(--ap));transform:translateX(-50%)}
.wx i{position:absolute;left:calc(var(--x) * 1%);top:-8px;width:var(--ap);height:var(--ap);background:#fff;opacity:0}
.hero[data-live] .wx i{animation:fall 6s steps(30) calc(var(--d) * -1s) infinite}
.wx-sonnetDay i{width:var(--ap);height:calc(3 * var(--ap));background:#b9d0f5}
.hero[data-live] .wx-sonnetDay i{animation-duration:1.4s;animation-timing-function:steps(14)}
.wx-gentleDay i{background:#f6c1d4;width:calc(2 * var(--ap))}
.wx-opusDay i{background:#ffb27a;top:auto;bottom:0}
.hero[data-live] .wx-opusDay i,.hero[data-live] .wx-fableDay i{animation-name:rise}
.wx-fableDay i{background:#e7defa;top:auto;bottom:0}
.wx-haikuDay i{background:#a6d77a;width:calc(3 * var(--ap))}
.hero[data-live] .wx-haikuDay i{animation:blow 4s steps(24) calc(var(--d) * -1s) infinite}
.wx-glassDay i,.wx-shinyHour i{background:#fffdf5;top:auto;bottom:calc(2 * var(--ap))}
.hero[data-live] .wx-glassDay i,.hero[data-live] .wx-shinyHour i{animation:glint 3s steps(1) calc(var(--d) * -1s) infinite}
.wx-topsyTurvy i{width:calc(14 * var(--ap));height:calc(3 * var(--ap));background:color-mix(in srgb,var(--sky1) 60%,#fff);top:calc(var(--i) * 7px + 10px)}
.hero[data-live] .wx-topsyTurvy i{animation:drift 40s steps(160) calc(var(--d) * -10s) infinite;opacity:.6}
.wx-calm i{width:calc(3 * var(--ap));height:calc(2 * var(--ap));background:#f2d36b;top:40%}
.hero[data-live] .wx-calm i{animation:flutter 12s steps(60) infinite;opacity:1}
@keyframes fall{0%{transform:translateY(0);opacity:.9}100%{transform:translateY(calc(70 * var(--ap)));opacity:.9}}
@keyframes rise{0%{transform:translateY(0);opacity:.9}100%{transform:translateY(calc(-60 * var(--ap)));opacity:0}}
@keyframes blow{0%{transform:translate(-30vw,calc(10 * var(--ap)));opacity:.9}100%{transform:translate(60vw,calc(30 * var(--ap)));opacity:.9}}
@keyframes glint{0%,80%{opacity:0}85%,95%{opacity:1}}
@keyframes drift{0%{transform:translateX(30vw)}100%{transform:translateX(-80vw)}}
@keyframes flutter{0%{transform:translate(0,0)}25%{transform:translate(20vw,-30px)}50%{transform:translate(40vw,10px)}75%{transform:translate(20vw,-20px)}100%{transform:translate(0,0)}}

/* the meet ceremony: the creature spins into a card back, the card turns over big, then flies home */
.burst{position:absolute;width:var(--ap);height:var(--ap);background:#fffdf5;pointer-events:none;z-index:5}
.flyer{position:fixed;z-index:60;pointer-events:none}
.veil{position:fixed;inset:0;z-index:55;background:#080a14d1;opacity:0;transition:opacity .25s;pointer-events:none}
.veil.on{opacity:1}
.rv{position:fixed;z-index:58;width:var(--rw,232px);perspective:900px;cursor:pointer}
.rv-rays{position:absolute;left:50%;top:45%;width:200%;aspect-ratio:1;translate:-50% -50%;pointer-events:none;opacity:0;
background:repeating-conic-gradient(from 0deg,var(--glow) 0 7deg,#0000 7deg 22.5deg);mask:radial-gradient(circle,#000 0,#000 18%,#0000 62%);-webkit-mask:radial-gradient(circle,#000 0,#000 18%,#0000 62%)}
.rv.lit .rv-rays{opacity:.38;animation:rays 18s linear infinite}
@keyframes rays{to{rotate:1turn}}
.rv-in{position:relative;transform-style:preserve-3d}
.rv-back{display:grid;place-items:center;aspect-ratio:5/7;width:100%;background:#2b2440;box-shadow:inset 0 0 0 6px #fffdf5,inset 0 0 0 12px #2b2440,inset 0 0 0 16px var(--glow),0 0 0 6px color-mix(in srgb,var(--glow) 40%,#0000)}
.rv-back::after{content:"";width:34%;aspect-ratio:1;background:#3d3458;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
.rv .cf{--cs:8px;padding:var(--s2) var(--s3) var(--s3);filter:drop-shadow(0 14px 0 #0006)}
.rv .cf-name .pt{--gp:2px}
.rv .cf-kind,.rv .cf-row{font-size:.875rem}
.rv .cf.tilting .holo,.rv .cf.sweep .holo{opacity:.45}
.rv .gotcha{position:absolute;left:50%;bottom:calc(100% + 18px);transform:translateX(-50%);margin:0;padding:10px 14px 4px;white-space:nowrap;background:#14121c;color:#fffdf5;--hsh:#5a4e7a;--sho:1;
box-shadow:0 0 0 2px #fffdf5,4px 4px 0 2px #000,8px 8px 0 2px #0007}
.rv .gotcha .pt{--gp:3px}
.rv .cf.foil:not(.tilting) .holo{opacity:.32;animation:holo 2.4s linear infinite}
@media (max-width:767px){.rv{--rw:196px}.rv .cf{--cs:7px}.rv .gotcha .pt{--gp:2px}}

/* ---- battle ---- */
.battle{position:relative;background:var(--clear);padding-bottom:var(--s6)}
.battle>.ramp{margin-bottom:var(--s5)}
.battle h2{--hsh:#06120e;--sho:.7}
.bt-top{display:grid;gap:var(--s4)}
@media (min-width:1024px){.bt-top{grid-template-columns:minmax(0,1fr) minmax(0,420px);align-items:start;gap:var(--s5)}}
.need{margin-top:var(--s2)}
.need .tbtn{color:#ffe2a0;text-align:left}
.need .tbtn::before{content:"";display:inline-block;width:calc(3 * var(--ap));height:calc(3 * var(--ap));margin-right:10px;vertical-align:1px;background:currentColor;clip-path:polygon(50% 0,100% 60%,67% 60%,67% 100%,33% 100%,33% 60%,0 60%)}
.need[hidden]{display:none}
.bt-side{display:grid;grid-template-columns:1fr 1fr;gap:var(--s3);align-items:start}
.poster{position:relative;display:flex;flex-direction:column;align-items:center;gap:var(--s1);padding:var(--s3) var(--s3) var(--s3);background:#f1e6cf;color:#2a1d18;text-align:center;transform:rotate(-2deg);
box-shadow:0 4px 0 #0000004d}
.poster .pin{position:absolute;top:6px;left:50%;width:8px;height:8px;margin-left:-4px;background:#c2493d}
.poster .spr{width:64px;height:64px;margin-top:var(--s2)}
.poster .soft{color:#5e4a3c;font-size:.875rem}
.wheelbox{margin:0;display:grid;gap:var(--s2);justify-items:center;text-align:center;font-size:.875rem}
.wheel{position:relative;width:160px;height:160px;padding:0;border:0;background:none;cursor:pointer}
.wheelbox.topsy .wheel{transform:rotate(180deg)}
.wheelart{width:160px;height:160px}
.wheelart .wr{fill:#cfdccb;opacity:.5}.wheelart .wa{fill:#fffdf5}
.runner{position:absolute;width:48px;height:48px;left:56px;top:56px;transform:rotate(calc(var(--k,0) * 90deg + var(--a))) translateY(-64px) rotate(calc(var(--k,0) * -90deg - var(--a)))}
.runner .spr{width:48px;height:48px}
.r0{--a:0deg}.r1{--a:270deg}.r2{--a:180deg}.r3{--a:90deg}
.wheel.turning .runner{transition:transform .4s steps(4)}
.demo{position:relative;margin-top:var(--s5);padding:var(--s3);background:#171a24;border:1px solid #2a3040;border-radius:16px;--bh:156px;--spr:48px;--slot:64px}
@media (min-width:768px){.demo{padding:var(--s4);--bh:212px;--spr:96px;--slot:120px}}
/* the screen: Claude's transcript fills it; the band rises from the prompt and pushes the transcript up (transforms only, so nothing below moves) */
.screen{position:relative;overflow:hidden}
.feed{position:relative;transition:transform .32s cubic-bezier(.2,.8,.2,1)}
@media (min-width:768px){.feed{padding-top:var(--s5)}}
.screen.open .feed{transform:translateY(calc(-1 * var(--bh) - 8px))}
.tx{display:grid;gap:2px;font:400 .875rem/1.5 var(--mono);color:#7d869e}
.tx p{display:flex;align-items:center;gap:10px;max-width:none}
.tx p.sub{padding-left:16px;color:#5d6680}
.tx i{width:6px;height:6px;background:#4f5a74;flex:none}
.tx p:first-child i{background:#5fbf8f}
html.js .demo:not(.typed) .tx p{visibility:hidden}
.spinrow{margin-top:var(--s2);min-height:44px;display:flex;align-items:center}
.spinner{display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:0;border:0;background:none;color:#b7c0d8;font-size:.9375rem;cursor:pointer}
.spinner .flower{width:16px;height:16px;color:var(--fam,#a874e8)}
.spinner .secs{font-variant-numeric:tabular-nums;min-width:2.5ch}
.spinner .ff{display:none;width:18px;height:10px;color:#f2b33d}
.spinner .ff svg{width:18px;height:10px}
.spinner.ffwd .ff{display:inline-block;animation:ffb .3s steps(1) infinite}
@keyframes ffb{50%{opacity:.35}}
.flower .fr{opacity:0}.flower .fr0{opacity:1}
.spinner.go .flower .fr{animation:fr .6s steps(1) infinite}
.spinner.fast .flower .fr{animation-duration:.3s}
.spinner.ffwd .flower .fr{animation-duration:.18s}
${Array.from({ length: 6 }, (_, i) => `.spinner.go .fr${i}{animation-delay:${-0.6 + i * 0.1}s!important}`).join('')}
@keyframes fr{0%{opacity:1}16.66%,100%{opacity:0}}
html.js .spinner.still{display:none}
/* the band: a dark arena in the family's hue, opened by a clip from the bottom */
.band{position:relative;height:var(--bh);margin-top:var(--s2);overflow:hidden;border-radius:4px;background:var(--psky);color:#f4f2fb}
html.js .band{position:absolute;left:0;right:0;bottom:0;margin:0;clip-path:inset(100% 0 0 0);transition:clip-path .32s cubic-bezier(.2,.8,.2,1)}
html.js .screen.open .band{clip-path:inset(0 0 0 0)}
.bsky{position:absolute;inset:0 0 40% 0;background:var(--psky)}
.bsky i{position:absolute;width:3px;height:3px;background:#fffdf5;opacity:.5}
.bsky i:nth-child(1){left:8%;top:22%}.bsky i:nth-child(2){left:31%;top:12%;opacity:.3}.bsky i:nth-child(3){left:54%;top:30%}.bsky i:nth-child(4){left:71%;top:15%;opacity:.35}.bsky i:nth-child(5){left:92%;top:26%}
.bdz{position:absolute;left:0;right:0;top:60%;height:6px}
.bdz svg{width:100%;height:6px}
.bdz .psk{fill:var(--psky)}.bdz .pgr{fill:var(--pground)}
.bground{position:absolute;left:0;right:0;bottom:0;top:calc(60% + 6px);background:var(--pground)}
.bridge{position:absolute;left:0;right:0;top:calc(60% - 22px);height:24px;overflow:hidden}
.bridge svg{position:absolute;left:50%;bottom:0;width:1200px;height:24px;transform:translateX(-50%)}
.bridge path{fill:var(--pshade);opacity:.7}
.lbox{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 4px 0 #000,inset 0 -4px 0 #000;opacity:0}
.band.max .lbox{opacity:1}
/* one banner row at the top, never wrapping */
.banner{position:absolute;z-index:3;left:8px;right:8px;top:8px;margin:0;max-width:none;color:#fffdf5;text-align:center;white-space:nowrap;overflow:hidden}
.banner .pt{--gp:2px;display:inline-flex;--hsh:#000;--sho:.6}
@media (min-width:768px){.banner{top:12px}.banner .pt{--gp:3px}}
.banner.gold{color:#f2b33d}
.pcount{position:absolute;top:10px;right:12px;z-index:3;margin:0;color:#f2b33d;font-weight:800;font-size:.8125rem}
/* fighters: a fixed slot each (sprite plus a gap), name centred and cut short inside it */
.side{position:absolute;bottom:10px;display:flex;align-items:flex-end}
.side.sa{left:6px}.side.sd{right:6px}
@media (min-width:768px){.side{bottom:16px}.side.sa{left:22%;transform:translateX(-50%)}.side.sd{left:78%;right:auto;transform:translateX(-50%)}}
.fighter{position:relative;display:flex;flex-direction:column;align-items:center;width:var(--slot)}
.fighter .spr{width:var(--spr);height:var(--spr)}
.fighter .nm{display:block;width:100%;height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-size:12px;line-height:16px;font-weight:700;color:#f4f2fb;visibility:hidden}
@media (min-width:768px){.fighter .nm{font-size:14px;height:18px;line-height:18px}}
.fighter.act .nm{visibility:visible}
.fighter .hp{display:block;width:min(var(--spr),56px);height:5px;margin:3px 0 4px;background:#0006;box-shadow:0 0 0 1px #0008}
.fighter .hp i{display:block;height:100%;width:var(--v);background:var(--hc,#7cc47f);transition:width .3s cubic-bezier(.2,.8,.2,1)}
.fighter.out .spr{opacity:.25}
.fighter.ghost{--silc:#ffffff2e}
.fighter.ghost .nm,.fighter.ghost .hp{visibility:hidden}
.fighter.ghost .q{position:absolute;left:50%;bottom:calc(var(--spr) * .3);width:15px;height:27px;margin-left:-7px;color:#ffffff80}
.fighter.ghost .q svg{width:15px;height:27px}
.fighter .bcard{position:absolute;left:50%;bottom:0;width:calc(var(--spr) * .62);height:calc(var(--spr) * .86);margin-left:calc(var(--spr) * -.31);background:#2b2440;box-shadow:inset 0 0 0 2px #fffdf5,inset 0 0 0 4px #2b2440,inset 0 0 0 6px var(--glow,#9aa3ad)}
.dmg{position:absolute;left:50%;top:calc(24px + var(--spr) * .25);white-space:nowrap;z-index:4;color:#fffdf5;transform:translateX(-50%);pointer-events:none}
.dmg .pt{--gp:2px;--hsh:#000;--sho:.7}.dmg.big .pt{--gp:3px}.dmg.big{color:#f2b33d}
@media (min-width:768px){.dmg .pt{--gp:3px}.dmg.big .pt{--gp:4px}}
/* callouts sit above the name row, never on a sprite */
.callout{position:absolute;z-index:5;left:50%;bottom:calc(100% + 2px);transform:translateX(-50%);padding:2px 8px 3px;background:#fffdf5;color:#1d1726;font-size:.75rem;font-weight:800;white-space:nowrap;pointer-events:none}
.side.sd .callout{left:auto;right:0;transform:none}
.side.sa .fighter:first-child .callout{left:0;transform:none}
.cap{margin-top:var(--s2);min-height:1.5em;font-size:.875rem;color:#b7c0d8}
.prow{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;margin-top:var(--s2);min-height:56px;padding:var(--s1) var(--s1) var(--s1) var(--s3);background:#11131b;border-radius:12px}
.prow .caret{width:9px;height:18px;background:#fffdf5;animation:caret 1.1s steps(1) infinite}
.prow .grow{flex:1}
.prow .khint{font-size:.8125rem;color:#9aa3bd;text-align:right}
@media (max-width:599px){.prow .khint{display:none}}
.pchip{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 12px;border:1px solid #2e3446;border-radius:8px;background:#1b1f2b;color:#e4e8f4;font-size:.875rem;font-weight:600;cursor:pointer}
.pchip .mark{color:var(--fam)}
.key1{position:relative;width:48px;height:48px;padding:0;border:0;background:none;cursor:pointer;color:#1d1726}
@media (max-width:767px){.key1{width:56px;height:56px}}
.key1 .ring{position:absolute;inset:0;width:100%;height:100%}
.key1 .ring .sg{fill:#3a4058}
.key1 .ring .sg.lit{fill:#f2b33d}
.key1 .cap1{position:absolute;inset:6px;display:grid;place-items:center;background:#fffdf5;border-bottom:4px solid #9aa3ad}
.key1 .cap1 .pw{width:calc(var(--w) * 3px);height:calc(9 * 3px);transform:translateY(3px)}
.key1.now .cap1{background:#f2b33d;border-bottom-color:#9a6a06}
.key1.pressed .cap1{transform:translateY(3px);border-bottom-width:1px}
.outrow{display:flex;align-items:center;flex-wrap:wrap;gap:var(--s2) var(--s3);min-height:96px;margin-top:var(--s3)}
@media (max-width:599px){.outrow{min-height:150px;align-items:flex-start}}
.waitline{color:#b7c0d8}
.result:not([hidden])~.waitline{display:none}
html.js .foot1{display:none}
.outrow .startb[hidden],.outrow .result[hidden],.pauseb[hidden]{display:none}
.pauseb{position:relative;z-index:59;min-height:44px}
.result .kc1,.startb .kc1{color:#1d1726}
.result{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s2) var(--s3)}
.result .lines{display:grid;gap:2px;min-width:0}
.result p{max-width:none}
.result .big{font-weight:800;font-size:1.125rem}
.result .soft{color:#b7c0d8}
.result .caught{display:flex;align-items:center;gap:var(--s2)}
.result .caught .spr{width:40px;height:40px;flex:none}
.result a{color:#ffe2a0}
.foot1{margin-top:var(--s3);color:#cfdccb}
.desktop-shots{margin-top:var(--s4)}
.desktop-shots summary{width:fit-content;min-height:44px;padding:var(--s2) 0;cursor:pointer;color:#ffe2a0}
.desktop-shot-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:var(--s4);margin-top:var(--s3)}
.desktop-shot-grid figure{min-width:0;margin:0;display:grid;gap:var(--s2);align-content:start}
.desktop-shot-grid a{min-width:0}
.desktop-shot-grid img{display:block;width:auto;max-width:100%;height:auto;margin-inline:auto;border:1px solid #2a3040;border-radius:8px}
.desktop-shot-grid figcaption{font-size:.875rem;color:#b7c0d8}

/* ---- den: rooms dug into the soil under the clearing ---- */
.den{position:relative;background:#2a1d18;color:#f4e9dc;padding-bottom:var(--s6);content-visibility:auto;contain-intrinsic-size:auto 1900px;--cw:152px;--ch:208px}
@media (max-width:1179px){.den{--cw:108px;--ch:150px}}
.den .soft{color:#cdb9a6}
.den h2{--hsh:#0d0806;--sho:.8}
.den h3{color:#f4e9dc;--hsh:#0d0806;--sho:.9}
.den h3 .pt{--gp:2px}
.den h3:has(.pt){line-height:0}
.edgebox{position:relative;height:calc(22 * var(--ap));overflow:hidden}
.edgebox svg{position:absolute;left:50%;left:round(down,50%,1px);top:0;width:calc(var(--aw) * var(--ap));height:calc(var(--ah) * var(--ap));transform:translateX(-50%)}
.den>.wrap{padding-top:var(--s5)}
/* a paper tag on a pin: counts and names hung up in the den and at the market */
.ptag{position:relative;display:inline-block;padding:5px 10px 5px;background:#f1e6cf;color:#2a1d18;font-size:.875rem;font-weight:700;line-height:1.3;rotate:-2deg;box-shadow:0 3px 0 #0000004d}
.ptag::before{content:"";position:absolute;left:50%;top:-4px;width:6px;height:6px;margin-left:-3px;background:#c2493d;box-shadow:inset -2px -2px 0 #8a2f27}
/* the shelf: the pack on its stump, and the card-back outlines waiting on the plank */
.shelf{position:relative;margin-top:var(--s5)}
.packstage{position:relative;display:grid;grid-template-columns:200px auto;justify-content:center;align-items:end;gap:var(--s4);margin-top:var(--s4)}
@media (max-width:879px){.packstage{grid-template-columns:auto;justify-items:center;gap:var(--s3)}}
.packspot{position:relative;display:grid;justify-items:center;align-self:end}
.stump{width:calc(56 * var(--ap) * .75);height:calc(16 * var(--ap) * .75);margin-top:-4px}
.stump svg{width:100%;height:100%}
.stumpart .sb{fill:#5a3c2a}.stumpart .sd{fill:#45301f}.stumpart .sw{fill:#c79a63}.stumpart .sr{fill:#a9794a}
.pack{position:relative;z-index:2;width:128px;height:176px;padding:0;border:0;background:none;cursor:pointer;transform-origin:50% 100%}
.packart{width:128px;height:176px;overflow:visible}
.packart .pkb{fill:var(--fam)}.packart .pke{fill:color-mix(in srgb,var(--fam) 55%,#1d1726)}.packart .pkh{fill:color-mix(in srgb,var(--fam) 55%,#fff)}
.packart .pkm{fill:color-mix(in srgb,var(--fam) 72%,#fff)}.packart .pkc{fill:#dfe3ee}.packart .pkd{fill:#8a90a6}
.packart .pks1,.packart .pks2{fill:#fff;opacity:.4}
.packart .em{display:none}
.pack[data-fam=haiku] .em-haiku,.pack[data-fam=sonnet] .em-sonnet,.pack[data-fam=opus] .em-opus,.pack[data-fam=fable] .em-fable{display:inline}
.packart .sh2{opacity:0}
.den[data-live] .packart .sh1{animation:shA 2.4s steps(1) infinite}
.den[data-live] .packart .sh2{animation:shB 2.4s steps(1) infinite}
.den[data-live] .pack:hover .packart .sh1,.den[data-live] .pack:hover .packart .sh2,.den[data-live] .pack:focus-visible .packart .sh1,.den[data-live] .pack:focus-visible .packart .sh2{animation-duration:.5s}
@keyframes shA{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes shB{0%,49%{opacity:0}50%,100%{opacity:1}}
.pack:hover{animation:jig .2s steps(2)}
@keyframes jig{50%{transform:rotate(-3deg)}}
.pack.torn .pk-top{visibility:hidden}
.pack.torn .packart .sh1,.pack.torn .packart .sh2{animation:none;opacity:0}
.packtag{position:absolute;right:-30px;top:30px;rotate:9deg;font-size:.8125rem;white-space:nowrap}
.packtag::after{content:"";position:absolute;left:-14px;top:6px;width:14px;height:2px;background:#d9c6b3}
.slots,.fan{display:grid;grid-template-columns:repeat(${ECONOMY.packs.size},var(--cw));gap:12px}
@media (max-width:879px){.slots,.fan{gap:8px;justify-content:center}}
.cards5{position:relative;display:grid}
.cards5>*{grid-area:1/1}
.slots i{display:block;height:var(--ch);background:#2b2440;opacity:.28;box-shadow:inset 0 0 0 3px #fffdf5,inset 0 0 0 6px #2b2440,inset 0 0 0 8px #6b6385;
clip-path:polygon(0 4px,4px 4px,4px 0,calc(100% - 4px) 0,calc(100% - 4px) 4px,100% 4px,100% calc(100% - 4px),calc(100% - 4px) calc(100% - 4px),calc(100% - 4px) 100%,4px 100%,4px calc(100% - 4px),0 calc(100% - 4px))}
.cards5:has(.fan li) .slots{visibility:hidden}
.plank{position:relative;height:calc(4 * var(--ap));margin-top:-2px;background:#7a5638;box-shadow:inset 0 var(--ap) 0 #9a7048,inset 0 calc(-1 * var(--ap)) 0 #4a3326,0 calc(3 * var(--ap)) 0 #0000004d}
.plank::before,.plank::after{content:"";position:absolute;top:100%;width:calc(3 * var(--ap));height:calc(6 * var(--ap));background:#4a3326}
.plank::before{left:12%}.plank::after{right:12%}
html.js .nojs-note{display:none}
.nojs-note{margin-top:var(--s2)}
.fan{margin:0;padding:0;list-style:none}
.fan li{position:relative;min-width:0}
.fan li[data-open]{cursor:grab;user-select:none;-webkit-user-select:none}
@media (pointer:fine){.fan li[data-open]{touch-action:none}}
.fan .cf{height:var(--ch);overflow:hidden;padding:6px 8px 10px}
.fan .cf>*{flex-shrink:0}
.fan .cf>.cf-art{flex:1 1 auto;min-height:0;overflow:hidden}
.fan .cf-name{line-height:1.25;font-size:1rem}
.fan .cf-kind:not(.traits),.fan .bar{display:none}
.fan .cf-rar,.fan .cf-kind{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.8125rem}
@media (max-width:1179px){.fan .cf{padding:4px 4px 6px;gap:1px;--cs:3px;border-width:4px}.fan .cf-art{padding-top:4px}.fan .cf-name{margin-top:2px;font-size:.8125rem}.fan .cf-row,.fan .cf-kind,.fan .cf-rar{font-size:.625rem}.fan .cf-rar::before{width:8px;height:8px}.fan .bar{display:none}}
.back{position:relative;display:block;width:100%;height:var(--ch);padding:0;border:0;cursor:pointer;background:#2b2440;--glow:#4a4458;--halo:#0000;box-shadow:inset 0 0 0 4px #fffdf5,inset 0 0 0 8px #2b2440,inset 0 0 0 10px var(--glow),0 0 0 4px var(--halo)}
.back::after{content:"";position:absolute;inset:30% 30%;background:#3d3458;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
.back.g-rare{--glow:#4f8ff0;--halo:#4f8ff066}
.back.g-epic{--glow:#b06ef3;--halo:#b06ef366;animation:shim .4s steps(2) infinite}
.back.g-legendary{--glow:#f2b33d;--halo:#f2b33d66;animation:pulse .8s steps(2) infinite}
@keyframes shim{50%{--glow:#d6a8ff;--halo:#b06ef399}}
@keyframes pulse{50%{--glow:#ffe39a;--halo:#f2b33d33}}
.goldsil{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--s2);height:var(--ch);padding:var(--s3);background:#2a1d18;color:#f2b33d;text-align:center;font-size:.875rem;font-weight:700;box-shadow:inset 0 0 0 3px #f2b33d}
@media (max-width:1179px){.goldsil{padding:var(--s2);font-size:.75rem}.goldsil svg{width:48px!important;height:48px!important}}
.goldsil svg{width:64px;height:64px;color:#f2b33d}
.shelf.gold .plank{background:#f2b33d;box-shadow:inset 0 var(--ap) 0 #ffe39a,inset 0 calc(-1 * var(--ap)) 0 #9a6a06}
.shelfctl{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s2) var(--s3);margin-top:var(--s5)}
.hint{font-size:.875rem;color:#cdb9a6;display:flex;gap:var(--s2);align-items:center}
.hint .kc1,.summary .kc1{color:#1d1726}
.summary{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s2) var(--s3)}
.summary[hidden]{display:flex!important;visibility:hidden}
.summary{width:100%;min-height:3.2em}
.summary p{max-width:none}
.summary .big{font-weight:800}
/* the rooms: darker pockets in the soil with a stepped arch and roots hanging in */
.lower{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--s4);margin-top:var(--s6);align-items:stretch}
@media (min-width:1024px){.lower{grid-template-columns:minmax(0,5fr) minmax(0,7fr)}}
.hollow-room{position:relative;display:flex;flex-direction:column;padding:var(--s5) var(--s4) var(--s4);background:#1c1310;
clip-path:polygon(0 24px,8px 24px,8px 16px,16px 16px,16px 8px,32px 8px,32px 0,calc(100% - 32px) 0,calc(100% - 32px) 8px,calc(100% - 16px) 8px,calc(100% - 16px) 16px,calc(100% - 8px) 16px,calc(100% - 8px) 24px,100% 24px,100% 100%,0 100%)}
@media (max-width:767px){.hollow-room{padding:var(--s5) var(--s3) var(--s4)}}
.hollow-room::before,.hollow-room::after{content:"";position:absolute;top:0;width:4px;height:4px;background:#4a3326;pointer-events:none;
box-shadow:0 4px #4a3326,0 8px #4a3326,4px 12px #4a3326,4px 16px #4a3326,4px 20px #3b2a22,8px 24px #3b2a22,4px 28px #3b2a22}
.hollow-room::before{left:22%}.hollow-room::after{right:30%;scale:-1 1}
.hollow-room:hover::before,.hollow-room:hover::after{animation:rootsway .5s steps(2) 2}
@keyframes rootsway{50%{translate:2px 0}}
.nestrow{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:var(--s2);margin-top:var(--s3)}
.nslot{position:relative;display:flex;flex-direction:column;align-items:center;gap:var(--s2);padding:var(--s3) var(--s2);background:#2a1d18;min-height:132px;justify-content:flex-end;box-shadow:inset 0 -6px 0 #3b2a22}
.nslot .spr{width:64px;height:64px}
.nslot .nlabel{font-size:.875rem;font-weight:700;text-align:center}
.swatch{display:flex;gap:3px}.swatch i{display:block;width:10px;height:10px;background:var(--c)}
.nslot.drop{outline:3px dashed #f4e9dc;outline-offset:-6px}
.eggbox{position:relative;width:80px;height:96px;display:grid;place-items:end center;padding-bottom:6px}
.eggbox svg{position:relative;z-index:1;width:64px;height:80px}
.eggbox::after{content:"";position:absolute;left:50%;bottom:0;width:80px;height:20px;transform:translateX(-50%);background:#7a5638;box-shadow:inset 0 -6px 0 #5a3c2a,inset 0 4px 0 #9a7048;
clip-path:polygon(0 0,8% 0,8% 20%,16% 20%,16% 0,30% 0,30% 20%,44% 20%,44% 0,58% 0,58% 20%,72% 20%,72% 0,86% 0,86% 20%,92% 20%,92% 0,100% 0,92% 100%,8% 100%)}
.nest .pbtn{margin-top:var(--s3);align-self:flex-start}
.hatch{position:relative;flex:1;display:grid;place-items:center;min-height:340px;margin-top:var(--s3)}
.hatch>*{grid-area:1/1}
.hatchspot{display:grid;justify-items:center;gap:var(--s2);color:#7d6656;font-size:.875rem;font-weight:700}
.hatchspot i{width:180px;height:250px;background:#2a1d18;box-shadow:inset 0 0 0 3px #3b2a22,inset 0 0 0 9px #2a1d18,inset 0 0 0 11px #3b2a22}
.hatch:has(.nestout:not(:empty)) .hatchspot{visibility:hidden}
.nestout{display:grid;justify-items:center;gap:var(--s2);text-align:center}
.nestout .cf{width:200px;--cs:6px}
.nestout .first{font-weight:700;color:#ffe2a0}
.nestout .mix{display:flex;align-items:center;gap:6px;font-size:.8125rem;color:#cdb9a6}
.nestout .mix .swatch i{width:12px;height:12px}
.note{margin-top:var(--s3);font-size:.875rem;color:#cdb9a6}
.bhead{display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap}
.bhead+.soft{margin-top:var(--s3);font-size:.9375rem}
.brow{margin-top:var(--s3)}
.blabel{font-weight:700;font-size:.9375rem}
.blabel .mark{color:var(--fam)}
.nooks{list-style:none;margin:var(--s2) 0 0;padding:0 0 var(--s1);display:grid;grid-template-columns:repeat(9,40px);gap:8px}
@media (max-width:479px){.nooks{grid-template-columns:repeat(9,minmax(0,1fr));gap:3px}.nook,.hollow{width:100%!important}.hollow{height:38px!important}.hollow .spr,.hollow .shd{width:26px!important;height:26px!important}}
.nk:nth-child(n+7) .tip{left:auto;right:0;transform:none}
.nk:nth-child(-n+2) .tip{left:0;transform:none}
.nook{position:relative;display:grid;place-items:center;width:40px;padding:0;border:0;background:none;cursor:pointer}
.hollow{position:relative;display:grid;place-items:end center;width:40px;height:44px;padding-bottom:4px;background:#120c0a;border-radius:20px 20px 4px 4px;box-shadow:inset 0 3px 0 #0a0706;overflow:hidden}
.nk.legend .hollow{box-shadow:inset 0 3px 0 #0a0706,0 0 0 2px #f2b33d}
.hollow .spr,.hollow .shd{width:32px;height:32px}
.nk.unfound .shd{color:#4a3529}
.nk.unfound.legend .shd{color:#b8862a}
.nk.legend .hollow::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,#0000 40%,#fff3c4aa 50%,#0000 60%) no-repeat;background-size:300% 100%;background-position:100% 0;pointer-events:none}
.den[data-live] .nk.legend .hollow::after{animation:sheen 6s steps(12) infinite}
.den[data-live] .brow:nth-of-type(3) .nk.legend .hollow::after{animation-delay:1.5s}.den[data-live] .brow:nth-of-type(4) .nk.legend .hollow::after{animation-delay:3s}.den[data-live] .brow:nth-of-type(5) .nk.legend .hollow::after{animation-delay:4.5s}
@keyframes sheen{0%,70%{background-position:100% 0}100%{background-position:-50% 0}}
.hollow .z{position:absolute;right:4px;top:4px;width:6px;height:11px;color:#f4e9dc;opacity:0}
.hollow .z svg{width:6px;height:11px}
.nook .tip{position:absolute;left:50%;top:calc(100% + 4px);z-index:5;transform:translateX(-50%);width:max-content;max-width:11rem;text-align:center;padding:4px 10px 5px;background:#fffdf5;color:#1d1726;font-size:.8125rem;font-weight:600;opacity:0;pointer-events:none}
.nook:hover .tip,.nook:focus-visible .tip{opacity:1}
.nk.found .nook:hover .spr,.nk.found .nook:focus-visible .spr{animation:hop .5s steps(1)}
.nk.found .nook:hover .spr .e,.nk.found .nook:focus-visible .spr .e{opacity:1}.nk.found .nook:hover .spr .ld,.nk.found .nook:focus-visible .spr .ld{opacity:0}
.nk.found .nook:hover .z,.nk.found .nook:focus-visible .z{opacity:1;animation:zz 1.2s steps(4)}
.nk.unfound .nook:hover .shd,.nk.unfound .nook:focus-visible .shd{animation:wob .6s steps(1) 2}
@keyframes hop{0%{transform:translateY(0)}20%{transform:translateY(-6px)}40%{transform:translateY(-9px)}60%{transform:translateY(-3px)}80%{transform:translateY(0)}}
@keyframes wob{0%{transform:translateX(3px)}25%{transform:translateX(0)}50%{transform:translateX(-3px)}75%{transform:translateX(0)}}
.tally{margin-top:auto;padding-top:var(--s4)}
.beam{display:grid;grid-template-columns:repeat(28,minmax(0,1fr));gap:2px;padding:6px;background:#5a3c2a;box-shadow:inset 0 -4px 0 #3b2a22}
.beam i{display:block;height:14px;background:#6e4b34}
.beam i.past{background:#2a1d18}
.beam i.now{background:#ffe2a0;box-shadow:0 0 0 2px #ffe2a066}
.tally p{margin-top:var(--s2);color:#cdb9a6;font-size:.9375rem}

/* ---- market: one street at night, a string of lanterns, the trader's cart and a present on a mat ---- */
.market{position:relative;background:#142039;color:#eef1fb;padding-bottom:var(--s6);content-visibility:auto;contain-intrinsic-size:auto 1300px}
.market .soft{color:#b7c0d8}
.market h2,.market h3{--hsh:#05080f;--sho:.8}
.market h3 .pt{--gp:2px}
.market h3:has(.pt){line-height:0}
.market .edgebox{height:calc(34 * var(--ap))}
.market>.wrap:first-of-type{padding-top:var(--s4)}
.overhead{position:relative;margin-top:var(--s4)}
.string{position:relative;height:calc(24 * var(--ap));overflow:hidden}
.string>svg{position:absolute;left:50%;left:round(down,50%,1px);top:0;width:calc(1000 * var(--ap));height:calc(24 * var(--ap));transform:translateX(-50%);overflow:visible}
.lstring .ln{fill:#0a0f20}
.lstring .lantern{--lg:#ffcf6a;--lb:#ffe9a8;--lt:#f2b33d;transform-box:fill-box;transform-origin:50% 0;cursor:default}
.lstring .lglow{fill:#ffcf6a;opacity:.16}
.lstring .unlit{--lg:#26304b;--lb:#2c3552;--lt:#3a4058}
.market[data-live] .lstring .unlit:nth-of-type(4n+1){animation:flick1 9s steps(1) infinite}
@keyframes flick1{0%,96%,100%{--lg:#26304b}97%,98%{--lg:#8a7440}}
.mythics{margin-top:var(--s3)}
.mythics>*{max-width:720px}
.lampnote{display:flex;justify-content:center;max-width:none}
.mhead{display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap}
.mhead+.soft{margin-top:var(--s2)}
.mythlist{list-style:none;margin:var(--s3) 0 0;padding:0;display:grid;gap:var(--s2)}
.mythlist a{color:#ffe9a8}
.mythlist b::after{content:","}
${Array.from({ length: 12 }, (_, i) => `.market:has(.mythlist .m${i}:hover) .lantern.l${i}{animation:swing .5s steps(2)}.market:has(.lantern.l${i}:hover) .mythlist .m${i}{text-decoration:underline}`).join('')}
.bazaar{position:relative;display:grid;gap:var(--s5);margin-top:var(--s5);align-items:end}
@media (min-width:900px){.bazaar{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:var(--s4)}}
.cart{position:relative;padding-top:calc(8 * var(--ap));padding-bottom:calc(7 * var(--ap))}
.awn{position:absolute;left:-12px;right:-12px;top:0;height:calc(10 * var(--ap));z-index:1;background:repeating-linear-gradient(90deg,#a8324a 0 calc(8 * var(--ap)),#f1e6cf 0 calc(16 * var(--ap)));box-shadow:inset 0 calc(-2 * var(--ap)) 0 #0003;
clip-path:polygon(0 0,100% 0,100% 70%,97% 70%,97% 100%,91% 100%,91% 70%,85% 70%,85% 100%,79% 100%,79% 70%,73% 70%,73% 100%,67% 100%,67% 70%,61% 70%,61% 100%,55% 100%,55% 70%,49% 70%,49% 100%,43% 100%,43% 70%,37% 70%,37% 100%,31% 100%,31% 70%,25% 70%,25% 100%,19% 100%,19% 70%,13% 70%,13% 100%,7% 100%,7% 70%,1% 70%,1% 100%,0 100%)}
.cart::before,.cart::after{content:"";position:absolute;top:calc(6 * var(--ap));bottom:calc(7 * var(--ap));width:calc(2 * var(--ap));background:#4a3326}
.cart::before{left:0}.cart::after{right:0}
.board{position:relative;margin:0 calc(2 * var(--ap));padding:calc(var(--s4) + 2 * var(--ap)) var(--s3) var(--s3);background:repeating-linear-gradient(180deg,#5a3c2a 0 calc(9 * var(--ap)),#4a3326 0 calc(10 * var(--ap)));color:#f4e9dc;box-shadow:inset 0 calc(-2 * var(--ap)) 0 #3b2a22}
.board h3{--hsh:#1f1410}
.board .soft{color:#e0cdb8}
.trader{position:absolute;z-index:2;right:calc(8 * var(--ap));top:calc(-13 * var(--ap));width:64px;height:64px;cursor:pointer}
.trader .spr{width:64px;height:64px}
.trader .say{position:absolute;right:calc(100% + 4px);top:8px;padding:3px 10px 4px;background:#fffdf5;color:#1d1726;font-size:.8125rem;font-weight:700;white-space:nowrap;opacity:0;pointer-events:none}
.trader.talk .say{opacity:1}
.axle{position:absolute;left:calc(6 * var(--ap));right:calc(6 * var(--ap));bottom:0;height:calc(11 * var(--ap));display:flex;justify-content:space-between;pointer-events:none}
.cw{width:calc(11 * var(--ap));height:calc(11 * var(--ap))}
.market[data-live] .cart:hover .cw{animation:roll .6s steps(4)}
@keyframes roll{to{rotate:90deg}}
/* deal tags hang from the board on strings: the string sits on the item, the paper (with its eyelet) on the button */
.tags{list-style:none;margin:var(--s4) 0 var(--s3);padding:0;display:grid;gap:var(--s4) var(--s2)}
@media (min-width:600px){.tags{grid-template-columns:repeat(3,minmax(0,1fr))}}
.dtag{position:relative;padding-top:14px}
.dtag::before{content:"";position:absolute;left:22px;top:0;width:2px;height:18px;background:#d9c6b3}
.tagb{position:relative;display:grid;gap:2px;width:100%;min-height:44px;padding:10px 10px 10px 30px;border:0;background:#f1e6cf;color:#2a1d18;text-align:left;font-size:.8125rem;line-height:1.35;cursor:pointer;transform-origin:22px -14px;
clip-path:polygon(10px 0,100% 0,100% 100%,10px 100%,0 calc(100% - 10px),0 10px);box-shadow:inset 0 -3px 0 #d9c6b3}
.tagb::before{content:"";position:absolute;left:12px;top:10px;width:6px;height:6px;background:#4a3326;box-shadow:inset 1px 1px 0 #2a1d18}
.tagb b{font-size:.875rem}
.tagb:hover,.tagb:focus-visible{animation:swing .4s steps(2) 1}
.tagb:focus-visible{outline:3px solid #fffdf5;outline-offset:2px}
@keyframes swing{0%{transform:rotate(2deg)}50%{transform:rotate(-2deg)}100%{transform:rotate(0)}}
.rug{position:relative;display:grid;justify-items:center;text-align:center}
.rug h3 .pt{display:inline-block}
.rug [data-gifthint]{margin-top:var(--s2)}
.giftstage{position:relative;display:grid;place-items:end center;min-height:150px;width:100%;margin-top:var(--s2)}
.mat{position:absolute;left:50%;bottom:-6px;z-index:0;width:min(280px,90%);height:calc(6 * var(--ap));translate:-50% 0;background:repeating-linear-gradient(90deg,#5c3a8a 0 calc(4 * var(--ap)),#a874e8 0 calc(6 * var(--ap)),#5c3a8a 0 calc(10 * var(--ap)));box-shadow:inset 0 calc(-1 * var(--ap)) 0 #0004}
.present{position:relative;z-index:1;width:128px;height:120px;padding:0;border:0;background:none;cursor:pointer}
.presentart{width:128px;height:120px;overflow:visible}
.presentart .pb{fill:var(--fam)}.presentart .pbd{fill:color-mix(in srgb,var(--fam) 65%,#000)}.presentart .pl{fill:color-mix(in srgb,var(--fam) 80%,#fff)}.presentart .pld{fill:color-mix(in srgb,var(--fam) 70%,#000)}.presentart .pr{fill:#f2d36b}
.present:hover .presentart{animation:jig .2s steps(2)}
.giftcard{position:relative;z-index:1;width:200px;margin-bottom:var(--s2)}
html.js .giftcard{display:none}
html.js [data-giftstall].open .giftcard{display:block}
html.js [data-giftstall].open .present{display:none}
html.js .giftafter{visibility:hidden}
html.js [data-giftstall].open .giftafter{visibility:visible}
html.js [data-giftstall].open [data-gifthint]{visibility:hidden}
.giftafter{margin-top:var(--s3)}
.giftafter p{max-width:none}
.cobbles{height:calc(4 * var(--ap));margin-top:calc(-1 * var(--ap));background:repeating-linear-gradient(90deg,#1c2a4a 0 calc(9 * var(--ap)),#0f1830 0 calc(10 * var(--ap)));box-shadow:inset 0 var(--ap) 0 #24345a}

/* ---- campfire ---- */
.camp{position:relative;background:#0f1626;color:#fdf6ec;content-visibility:auto;contain-intrinsic-size:auto 1100px}
.camp .soft{color:#c9c3d6}
.camp h2{--hsh:#000;--sho:.6}
.camp>.ramp{margin-bottom:var(--s5)}
${CAMP_CSS}
.campctl{position:relative;padding-top:var(--s4);padding-bottom:var(--s6)}
.campctl .install{max-width:760px}
.campctl .label{font-weight:600;margin-bottom:var(--s2)}
.campctl .ask{margin-top:var(--s2);color:#c9c3d6;font-size:.9375rem}
.postcard{margin-top:var(--s4)}

/* popover */
.pop{position:fixed;z-index:70;width:320px;max-width:calc(100vw - 16px);padding:var(--s3);background:#14121c;color:#f4f2fb;border:1px solid #2e2a3d;border-radius:14px;box-shadow:0 12px 0 #00000040}
.pop .x{position:absolute;right:8px;top:8px;width:44px;height:44px;padding:0;border:0;background:none;color:#f4f2fb;cursor:pointer;display:grid;place-items:center}
.pop .x svg{width:14px;height:14px}
.pop .cf{margin-top:var(--s4);--cs:6px}
.pop .acts{display:flex;flex-wrap:wrap;gap:var(--s2);margin-top:var(--s3);align-items:center}
.pop .line{margin-top:var(--s3);font-size:.875rem;color:#c9c3d6}
@media (max-width:767px){.pop{left:0!important;right:0;top:auto!important;bottom:0;width:auto;max-width:none;border-radius:14px 14px 0 0;max-height:85vh;overflow:auto}}
@media (prefers-reduced-motion:reduce){.cf.foil{border-color:transparent}}
.perf{position:fixed;left:8px;bottom:8px;z-index:90;padding:6px 10px;background:#000;color:#0f0;font:12px/1.4 var(--mono)}

/* phones: one step less air between places, and shorter fades */
@media (max-width:599px){
.battle,.den,.market{padding-bottom:var(--s5)}
.campctl{padding-bottom:var(--s5)}
.battle>.ramp,.camp>.ramp{margin-bottom:var(--s4)}
.dz.ramp{height:calc(var(--ah) * 2px)}
.den>.wrap{padding-top:var(--s4)}
.shelf{margin-top:var(--s4)}
.lower{margin-top:var(--s5)}
.demo{margin-top:var(--s4)}
.bazaar{margin-top:var(--s4)}
}
`

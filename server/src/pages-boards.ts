// The public game pages of 0.2.0 (SPEC 8, 20): the leaderboards (/boards), the market (/market) and a
// trainer's stats on their camp page. All read-only and script-free in what they say: a board is a
// link, a period is a link, a market filter is a link. Every number is as it stood at the last UTC
// midnight (the server's own rule), every handle links to its camp, every card to its page, and buying
// happens inside Claude Code.
import type { BoardName, BoardPeriod, ListingView, MarketResponse, MarketSort, MarketWant, PlayerStats, RankingsResponse } from '../../plugin/hooks/core/api.ts'
import { cardName } from '../../plugin/hooks/core/cards.ts'
import { FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { getSpecies } from '../../plugin/hooks/core/species.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import type { BattleCard, Family, LeagueName } from '../../plugin/hooks/core/types.ts'
import { FAMILY_COLOR, LEAGUE_COLOR, MYTHIC_COLOR } from '../../plugin/hooks/ui/tokens.ts'
import { boldWords } from './pages-font.ts'
import { cardDetails, cardFace, heading, html, installBlock, promptLine, raw, rarityLine, text } from './pages-html.ts'
import type { Raw } from './pages-html.ts'
import { grassSvg, hillSvg, marketTopSvg, peaksSvg } from './pages-scene.ts'
import { spriteSvg } from './pages-sprite.ts'
import { regulars } from './pages-world.ts'

/** What a player types inside Claude Code to browse and buy (the mod's market). */
export const MARKET_COMMAND = '/spin market'
/** What a player types to see their own place on the boards. */
export const BOARD_COMMAND = '/spin leaderboard'

const num = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// ---- pixel icons ---------------------------------------------------------------------------------

/** A small pixel picture from rows of letters, decorative (the words beside it carry the meaning). */
function pic(rows: readonly string[], ink: Record<string, string>, cls = 'ico'): string {
  const by: Record<string, string> = {}
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (ink[c]) by[c] = (by[c] ?? '') + `M${x} ${y}h1v1h-1z` }))
  return `<svg class="${cls}" viewBox="0 0 ${rows[0]!.length} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${Object.entries(by).map(([c, d]) => `<path fill="${ink[c]}" d="${d}"/>`).join('')}</svg>`
}

const GOLD = { y: '#f2b33d', w: '#fff1c2', d: '#b5761f' }
export const ICONS = {
  trophy: pic(['yyyyyyyy', 'ywyyyyyy', 'ywyyyyyd', '.yyyyyd.', '..yyyd..', '...yd...', '..dddd..', '.dddddd.'], GOLD),
  star: pic(['...yy...', '...yy...', 'yyywyyyy', '.yywyyy.', '..yyyy..', '.yyyyyy.', '.yy..yy.', 'y......y'], GOLD),
  swords: pic(['s......s', 'ws....sw', '.ws..sw.', '..wssw..', '...ss...', '..h..h..', '.h....h.', 'h......h'], { s: '#c9cfe0', w: '#fffdf5', h: '#a8692f' }),
  egg: pic(['...ee...', '..eeee..', '.eeeeee.', '.eeccee.', 'eeecceee', 'eeeeccee', '.eeeeee.', '..eeee..'], { e: '#f1e6cf', c: '#5fbf8f' }),
  lantern: pic(['...kk...', '..kkkk..', '.kggggk.', '.kgwwgk.', '.kgwwgk.', '.kggggk.', '..kkkk..', '...kk...'], { k: '#5a5370', g: MYTHIC_COLOR, w: '#fff1c2' }),
  coin: pic(['..yyyy..', '.yywwyy.', 'yywyyyyd', 'yywyyyyd', 'yywyyyyd', 'yyyyyydd', '.yyyyddd', '..dddd..'], GOLD),
  tuft: pic(['........', '...1..1.', '.1.12.12', '.12.122.', '.122222.', '12222221', '22322232', '23222222'], { '1': '#9ed36a', '2': '#5f9f4a', '3': '#3f7a3a' }),
  jar: pic(['..kkkk..', '...kk...', '..k..k..', '.k....k.', '.k.gg.k.', '.kggggk.', '.kggsgk.', '..kkkk..'], { k: '#c9cfe0', g: '#5b8def', s: '#fffdf5' }),
  flag: pic(['pyyyyy..', 'pyyyyyy.', 'pyyyyy..', 'pyyyy...', 'p.......', 'p.......', 'p.......', 'pp......'], { p: '#c9cfe0', y: '#ff7ac6' }),
  swap: pic(['....y...', '.yyyyy..', '....y...', '........', '........', '...b....', '..bbbbb.', '...b....'], { y: '#f2b33d', b: '#9ed36a' }),
}

// ---- leagues -------------------------------------------------------------------------------------

/** A league as a small pennant in its colour, with its name (never colour alone). */
export const leagueBadge = (l: LeagueName): Raw => html`<span class="lg" style="--lg:${LEAGUE_COLOR[l]}">${l}</span>`

// ---- the boards ----------------------------------------------------------------------------------

type BoardInfo = { id: BoardName; tab: string; unit: (n: number) => string; icon: string }

export const BOARDS: readonly BoardInfo[] = [
  { id: 'rating', tab: 'Rating', unit: () => 'rating', icon: ICONS.star },
  { id: 'beaten', tab: 'Players beaten', unit: n => plural(n, 'player beaten', 'players beaten'), icon: ICONS.swords },
  { id: 'duelWins', tab: 'Duel wins', unit: n => plural(n, 'duel win', 'duel wins'), icon: ICONS.trophy },
  { id: 'species', tab: 'Species', unit: () => 'species', icon: ICONS.egg },
  { id: 'mythics', tab: 'Mythics', unit: n => plural(n, 'Mythic', 'Mythics'), icon: ICONS.lantern },
  { id: 'sales', tab: 'Sales', unit: n => plural(n, 'sale', 'sales'), icon: ICONS.coin },
]
export const BOARD_IDS = BOARDS.map(b => b.id)

const boardHref = (b: BoardName, p: BoardPeriod) => {
  const q = [b !== 'rating' ? `board=${b}` : '', p !== 'all' ? `period=${p}` : ''].filter(Boolean).join('&')
  return `/boards${q ? `?${q}` : ''}`
}

const current = (on: boolean) => (on ? html` aria-current="page"` : '')

/** Medal colours for the podium's three steps: face, side. */
const STEP = [['#f2b33d', '#b5761f'], ['#c9cfe0', '#8b90a6'], ['#d08a55', '#93552b']] as const

/** The podium: the top three's lead creatures on their steps in the meadow, handles and numbers on plates below. */
function podium(top: RankingsResponse['top'], info: BoardInfo, leads: Map<string, BattleCard>): Raw {
  const sleepers = regulars()
  const steps = [0, 1, 2].map(i => {
    const r = top[i]
    const [face, side] = STEP[i]!
    const style = `--sf:${face};--ss:${side}`
    if (!r) {
      return html`<li class="pod p${i + 1} open" style="${style}"><span class="champ" aria-hidden="true">${raw(spriteSvg(spriteFor({ form: sleepers[i * 2 + 1]!, stage: 1 }), { cls: 'sil' }))}</span>
<span class="step" aria-hidden="true">${raw(boldWords(String(i + 1)))}</span>
<span class="plate"><b>Open spot</b></span></li>`
    }
    const lead = leads.get(r.handle)
    const handle = text(r.handle, 40)
    const art = lead ? spriteSvg(spriteFor(lead)) : spriteSvg(spriteFor({ form: sleepers[i * 2]!, stage: 1 }), { cls: 'shut' })
    return html`<li class="pod p${i + 1}" style="${style}"><a class="champ" href="/u/${r.handle}" tabindex="-1" aria-hidden="true">${raw(art)}</a>
<span class="step" aria-hidden="true">${raw(boldWords(String(r.rank)))}</span>
<span class="plate"><span class="sr">Number ${r.rank}: </span><a href="/u/${r.handle}">${handle}</a><span class="pv">${num(r.value)} <span class="u">${info.unit(r.value)}</span></span></span></li>`
  })
  return html`<div class="ground"><ol class="podium" aria-label="The top three">${steps}</ol></div>`
}

export type BoardsData = { res: RankingsResponse; leads: Map<string, BattleCard> }

export function boardsBody(d: BoardsData): Raw {
  const { res } = d
  const info = BOARDS.find(b => b.id === res.board) ?? BOARDS[0]!
  const top = res.top
  const hi = top[0]?.value ?? 0
  const lo = res.board === 'rating' ? Math.min(...top.map(r => r.value)) : 0
  const share = (v: number) => (hi > lo ? Math.round(12 + (88 * (v - lo)) / (hi - lo)) : 100)
  const seasonWord = `Season ${res.season}`
  return html`<section class="arena" aria-labelledby="boards-h">
<div class="bsky"><div class="wrap">
<h1 id="boards-h">${heading('Leaderboards')}</h1>
<p class="lede">The trainers at the top of every board, ${res.period === 'season' ? `this season` : 'all time'}.</p>
</div></div>
<div class="stand">
<div class="lay peaks" aria-hidden="true">${raw(peaksSvg())}</div>
<div class="lay hill" aria-hidden="true">${raw(hillSvg())}</div>
<div class="lay grass" aria-hidden="true">${raw(grassSvg())}</div>
</div>
${podium(top, info, d.leads)}
</section>
<section class="wrap ranksbox" aria-label="${`${info.tab}, ${res.period === 'season' ? seasonWord : 'all time'}`}">
<nav class="tabs" aria-label="Boards">${BOARDS.map(b => html`<a class="tab" href="${boardHref(b.id, res.period)}"${current(b.id === res.board)}>${raw(b.icon)}<span>${b.tab}</span></a>`)}</nav>
<nav class="period" aria-label="When">${(['all', 'season'] as const).map(p => html`<a href="${boardHref(res.board, p)}"${current(p === res.period)}>${p === 'all' ? 'All time' : seasonWord}</a>`)}</nav>
${top.length
    ? html`<ol class="ranks">${top.map(r => html`<li class="r${r.rank <= 3 ? ` m${r.rank}` : ''}" style="--v:${share(r.value)}%">
<span class="rk">${r.rank}</span>
<span class="who"><a href="/u/${r.handle}">${text(r.handle, 40)}</a>${leagueBadge(r.league)}</span>
<span class="val"><b>${num(r.value)}</b> <span class="u">${info.unit(r.value)}</span></span>
</li>`)}</ol>
<p class="fine">Numbers move once a day, at midnight UTC.</p>`
    : html`<div class="nobody">${raw(spriteSvg(spriteFor({ form: regulars()[4]!, stage: 1 }), { cls: 'shut' }))}<div><p class="big">Nobody on this board yet.</p><p>The first name here could be yours.</p></div></div>`}
<div class="join">
<div><h2>${heading('Your place')}</h2><p><a href="/account">Sign in with your passkey</a> to see your rankings and collection, or open the boards in Claude Code.</p>${promptLine(BOARD_COMMAND, 'The leaderboard command')}</div>
<div><h2>${heading('Not playing yet?')}</h2>${installBlock('install', 'Install Spinlings. Your starter team hatches right away.')}</div>
</div>
</section>`
}

export const BOARDS_CSS = `
main{display:block;background:#0f1626;color:#f4f2fb;padding-bottom:var(--s6)}
.arena{position:relative;background:var(--sky1)}
.bsky{padding:var(--s5) 0 var(--s3);color:var(--ink)}
.bsky .lede{margin-top:var(--s2);font-size:1.125rem;color:var(--ink);opacity:.85}
.stand{position:relative;height:calc(84 * var(--ap));background:var(--sky3);overflow:hidden}
.stand::before{content:"";position:absolute;left:0;right:0;top:calc(30 * var(--ap));bottom:0;background:var(--sky4)}
.stand .lay{position:absolute;left:0;right:0;overflow:hidden}
.stand .lay svg{position:absolute;left:50%;left:round(down,50%,1px);bottom:0;width:calc(var(--aw) * var(--ap));height:calc(var(--ah) * var(--ap));transform:translateX(-50%)}
.stand .lay.peaks{top:0;height:calc(52 * var(--ap))}
.stand .lay.hill{top:calc(44 * var(--ap));height:calc(40 * var(--ap))}
.stand .lay.hill::after{content:"";position:absolute;left:0;right:0;bottom:0;height:calc(6 * var(--ap));background:var(--hill)}
.stand .lay.grass{bottom:0;height:calc(16 * var(--ap));z-index:3;pointer-events:none}
.ground{position:relative;z-index:2;padding-bottom:var(--s3);background:linear-gradient(transparent calc(59 * var(--ap)),var(--g3) 0);margin-top:calc(-59 * var(--ap))}
.podium{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:end;width:min(100% - 32px,600px);margin:0 auto;padding:0;list-style:none}
.pod{display:flex;flex-direction:column;align-items:center;min-width:0}
.pod.p1{order:2}.pod.p2{order:1}.pod.p3{order:3}
.champ{display:block;width:calc(20 * var(--ap));height:calc(20 * var(--ap));margin-bottom:calc(-1 * var(--ap));transition:transform .2s var(--spring)}
.champ .spr{width:100%;height:100%}
.pod:hover a.champ{transform:translateY(calc(-3 * var(--ap)))}
.pod.open .champ{--silc:#0003}
.step{display:flex;justify-content:center;width:100%;height:calc(var(--sh) * var(--ap));padding-top:calc(3 * var(--ap));background:var(--sf);color:#1d1726;box-shadow:inset calc(-2 * var(--ap)) 0 0 var(--ss),inset 0 var(--ap) 0 #fff8;--sho:.2}
.pod.p1 .step{--sh:40}.pod.p2 .step{--sh:32}.pod.p3 .step{--sh:26}
.step .pt{--gp:2px}
@media (min-width:768px){.step .pt{--gp:3px}}
.plate{display:flex;flex-direction:column;align-items:center;gap:2px;width:100%;padding:var(--s2) 4px 0;background:var(--g3);color:#fffdf5;text-align:center;font-size:.875rem;line-height:1.3;min-height:calc(2.6em + var(--s2))}
.plate a{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit;font-weight:800}
.plate .pv{font-variant-numeric:tabular-nums;opacity:.9}
.plate .pv .u{font-size:.75rem}
.pod.open .plate b{font-weight:600;opacity:.75}
`

/** The tabs, the period switch and the rows under the podium. */
export const RANKS_CSS = `
.ranksbox{padding-top:var(--s4)}
.tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s2)}
@media (min-width:768px){.tabs{grid-template-columns:repeat(6,minmax(0,1fr))}}
.tab{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:72px;padding:10px 6px 12px;background:#1c2333;color:#c9c3d6;font-size:.875rem;font-weight:700;line-height:1.2;text-align:center;text-decoration:none;box-shadow:inset 0 -4px 0 #141a28}
.tab .ico{width:24px;height:24px;transition:transform .2s var(--spring)}
.tab:hover{background:#252d40;color:#fffdf5}
.tab:hover .ico{transform:translateY(-3px) rotate(-6deg)}
.tab[aria-current]{background:#f1e6cf;color:#2a1d18;box-shadow:inset 0 -4px 0 #c9b38f}
.period{display:inline-flex;gap:4px;margin-top:var(--s3);padding:4px;background:#1c2333}
.period a{display:flex;align-items:center;min-height:40px;padding:0 var(--s3);color:#c9c3d6;font-weight:700;font-size:.9375rem;text-decoration:none}
.period a:hover{color:#fffdf5}
.period a[aria-current]{background:#fffdf5;color:#1d1726}
.ranks{list-style:none;display:grid;gap:4px;margin:var(--s3) 0 0;padding:0}
.r{position:relative;isolation:isolate;display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:var(--s3);min-height:60px;padding:8px var(--s3) 8px 10px;background:#151c2c;overflow:hidden}
.r::before{content:"";position:absolute;left:0;top:0;bottom:0;z-index:-1;width:var(--v);background:#1d2740}
.rk{display:grid;place-items:center;width:40px;height:40px;font:800 1.0625rem/1 var(--mono);color:#9aa3bd;font-variant-numeric:tabular-nums}
.m1 .rk,.m2 .rk,.m3 .rk{background:var(--md);color:#1d1726;box-shadow:inset -3px -3px 0 #0003;clip-path:polygon(0 3px,3px 3px,3px 0,calc(100% - 3px) 0,calc(100% - 3px) 3px,100% 3px,100% calc(100% - 3px),calc(100% - 3px) calc(100% - 3px),calc(100% - 3px) 100%,3px 100%,3px calc(100% - 3px),0 calc(100% - 3px))}
.m1{--md:#f2b33d}.m2{--md:#c9cfe0}.m3{--md:#d08a55}
.who{display:flex;flex-wrap:wrap;align-items:center;gap:2px 12px;min-width:0}
.who a{color:#fffdf5;font-weight:700;overflow-wrap:anywhere;text-decoration:none}
.who a:hover{text-decoration:underline}
.lg{display:inline-flex;align-items:center;gap:6px;font-size:.8125rem;font-weight:700;color:#c9c3d6}
.lg::before{content:"";width:10px;height:12px;background:var(--lg);clip-path:polygon(0 0,100% 0,100% 100%,50% 72%,0 100%)}
.val{text-align:right;white-space:nowrap}
.val b{font-size:1.125rem;font-variant-numeric:tabular-nums}
.val .u{display:block;font-size:.75rem;color:#9aa3bd}
.fine{margin-top:var(--s3);font-size:.875rem;color:#9aa3bd}
.nobody{display:flex;align-items:center;gap:var(--s3);margin-top:var(--s3);padding:var(--s4) var(--s3);background:#151c2c}
.nobody .spr{width:64px;height:64px;flex:none}
.nobody .big{font-size:1.25rem;font-weight:800}
.nobody p+p{margin-top:var(--s1);color:#c9c3d6}
.join{display:grid;gap:var(--s5);margin-top:var(--s5)}
.join h2{color:#fdf6ec;--hsh:#000;--sho:.6;margin-bottom:var(--s2)}
.join .prompt{margin-top:var(--s3);max-width:760px}
.join .install{max-width:760px}
.join .install .label{font-weight:600;margin-bottom:var(--s2)}
.join .install .ask{margin-top:var(--s2);font-size:.9375rem;color:#c9c3d6}
`

// ---- market lots (the market page and a trainer's camp) -----------------------------------------

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const an = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

/** What a listing asks for in return, in a few plain words. */
export function wantWords(w: MarketWant): string {
  const fin = [w.shiny ? 'shiny' : '', w.foil ? 'foil' : ''].filter(Boolean).join(' ')
  const up = w.rarity ? `, ${w.rarity} or up` : ''
  if (w.species) {
    const sp = getSpecies(w.species)
    const name = sp ? text(sp.name, 40) : cap(w.species)
    return fin ? `${an(fin)} ${fin} ${name}${up}` : `${name}${up}`
  }
  const thing = [fin, w.family ? FAMILY_INFO[w.family].name : 'card'].filter(Boolean).join(' ')
  return `${an(thing)} ${thing}${up}`
}

/** One listing: the card (linking to its page), a paper price tag, what it wants, and who put it up. */
function lot(l: ListingView, last?: number, seller = true): Raw {
  const c = l.card
  const name = text(cardName(c), 40)
  return html`<li class="lot">
<a class="cardlink" href="/c/${c.id}" aria-label="${name}, ${rarityLine(c)}">${cardFace(c, { level: true, combat: true, genes: true, traits: true })}</a>
<div class="ptagbox"><p class="price${l.price ? '' : ' swaponly'}">${l.price ? html`${raw(ICONS.coin)}<b>${num(l.price)}</b><span class="sr"> sparks</span>` : html`${raw(ICONS.swap)}<b>Swap</b>`}</p>
${l.want ? html`<p class="want">${l.price ? 'and ' : 'for '}${wantWords(l.want)}</p>` : ''}</div>
${seller ? html`<p class="seller">from <a href="/u/${l.seller}">${text(l.seller, 40)}</a></p>` : ''}
${last !== undefined ? html`<p class="last">Last one sold for ${num(last)}</p>` : ''}
${cardDetails(c)}
</li>`
}

export const lots = (listings: readonly ListingView[], prices: MarketResponse['prices'] = [], o: { seller?: boolean } = {}): Raw => {
  const last = new Map(prices.map(p => [p.species, p.sales[0]?.price]))
  return html`<ul class="lots">${listings.map(l => lot(l, last.get(l.card.species), o.seller !== false))}</ul>`
}

export const LOTS_CSS = `
.stall{position:relative;padding:var(--s4) var(--s3);background:repeating-linear-gradient(180deg,#5a3c2a 0 27px,#4a3326 0 30px);box-shadow:inset 0 -6px 0 #3b2a22}
.lots{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:var(--s4) var(--s3);margin:0;padding:0}
.lot{display:flex;flex-direction:column;align-items:center;min-width:0}
.lot .cardlink{display:block;width:100%;color:inherit;text-decoration:none;transition:transform .2s var(--spring)}
.lot .cardlink:hover{transform:translateY(-4px) rotate(-1deg)}
.lot .cf{padding:6px 8px 12px;--cs:4px}
.lot .cf-name{font-size:1rem;white-space:normal;overflow:visible}
.lot .card-inspect{align-self:stretch;color:#f1e6cf}
.ptagbox{position:relative;z-index:1;margin-top:-6px;padding:8px 12px;background:#f1e6cf;color:#2a1d18;text-align:center;rotate:-2deg;box-shadow:0 3px 0 #0000004d;max-width:100%}
.lot:nth-child(2n) .ptagbox{rotate:2deg}
.ptagbox::before{content:"";position:absolute;left:50%;top:-4px;width:6px;height:6px;margin-left:-3px;background:#c2493d}
.price{display:flex;align-items:center;justify-content:center;gap:6px;font-size:1.125rem;font-weight:800;font-variant-numeric:tabular-nums}
.price .ico{width:18px;height:18px}
.want{font-size:.8125rem;font-weight:600;line-height:1.3}
.seller{margin-top:var(--s2);font-size:.8125rem;color:#f1e6cf;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.seller a{color:#fffdf5;font-weight:700}
.last{font-size:.75rem;color:#e0cdb8}
`

// ---- the market page ---------------------------------------------------------------------------

export type MarketView = { family?: Family; sort: MarketSort }
export const SORTS: readonly MarketSort[] = ['newest', 'cheapest', 'priciest']

const marketHref = (v: MarketView, after?: string) => {
  const q = [v.family ? `family=${v.family}` : '', v.sort !== 'newest' ? `sort=${v.sort}` : '', after ? `after=${encodeURIComponent(after)}` : ''].filter(Boolean).join('&')
  return `/market${q ? `?${q}` : ''}`
}

export function marketBody(res: MarketResponse, v: MarketView, paged: boolean): Raw {
  const n = res.listings.length
  return html`<section class="mkthead" aria-labelledby="market-h">
<div class="wrap">
<h1 id="market-h">${heading('The market')}</h1>
<p class="lede">Cards up for sparks or a swap, from trainers everywhere. Every one is one of a kind.</p>
<div class="howbuy"><p>To buy one, type this inside Claude Code:</p>${promptLine(MARKET_COMMAND, 'The market command')}</div>
</div>
<div class="town" aria-hidden="true">${raw(marketTopSvg())}</div>
</section>
<section class="street" aria-label="Open listings"><div class="wrap mktbody">
<div class="filters">
<nav class="fams" aria-label="Family"><a href="${marketHref({ sort: v.sort })}"${current(!v.family)}>All</a>${FAMILIES.map(f => html`<a href="${marketHref({ family: f, sort: v.sort })}" style="--fam:${FAMILY_COLOR[f]}"${current(v.family === f)}><i aria-hidden="true"></i>${FAMILY_INFO[f].name}</a>`)}</nav>
<nav class="period" aria-label="Sort">${SORTS.map(s => html`<a href="${marketHref({ ...v, sort: s })}"${current(v.sort === s)}>${cap(s)}</a>`)}</nav>
</div>
${n
    ? html`<div class="stall">${lots(res.listings, res.prices)}</div>
${res.next || paged ? html`<p class="pages">${paged ? html`<a class="tbtn" href="${marketHref(v)}">Back to the start</a>` : ''}${res.next ? html`<a class="pbtn" href="${marketHref(v, res.next)}"><span class="face">More cards</span></a>` : ''}</p>` : ''}`
    : html`<div class="nobody">${raw(spriteSvg(spriteFor({ form: regulars()[6]!, stage: 1 }), { cls: 'shut' }))}<div><p class="big">${v.family ? `No ${FAMILY_INFO[v.family].name} cards up right now.` : 'The stalls are empty right now.'}</p><p>Put one of yours up from Claude Code and it shows here.</p></div></div>`}
<div class="join"><div><h2>${heading('Not playing yet?')}</h2>${installBlock('install', 'Install Spinlings. Your starter team hatches right away.')}</div></div>
</div></section>`
}

export const MARKET_CSS = `
main{display:block;background:#0f1830;color:#eef1fb;padding-bottom:var(--s6)}
.mkthead{padding-top:var(--s5);background:#142039}
.mkthead .lede{margin-top:var(--s3);font-size:1.25rem;line-height:1.5;color:#d8deef;max-width:46ch}
.mkthead h1{color:#fdf6ec;--hsh:#05080f;--sho:.8}
.howbuy{margin-top:var(--s4);max-width:640px}
.howbuy p{font-weight:600}
.howbuy .prompt{margin-top:var(--s2)}
.town{position:relative;height:calc(27 * var(--ap));margin-top:var(--s4);overflow:hidden;border-bottom:calc(2 * var(--ap)) solid #0a1226}
.town svg{position:absolute;left:50%;left:round(down,50%,1px);bottom:0;width:calc(1000 * var(--ap));height:calc(34 * var(--ap));transform:translateX(-50%)}
.mktbody{padding-top:var(--s4)}
.filters{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--s3);margin-bottom:var(--s4)}
.filters .period{margin-top:0}
.fams{display:flex;flex-wrap:wrap;gap:var(--s2)}
.fams a{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;background:#1c2a4a;color:#d8deef;font-weight:700;font-size:.9375rem;text-decoration:none;box-shadow:inset 0 -4px 0 #0f1830}
.fams a i{width:10px;height:10px;background:var(--fam)}
.fams a:hover{background:#26365c;color:#fffdf5}
.fams a[aria-current]{background:#f1e6cf;color:#2a1d18;box-shadow:inset 0 -4px 0 #c9b38f}
.street{background:#0f1830}
.mktbody .period{background:#1c2a4a}
.mktbody .period a{color:#d8deef}
.pages{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:var(--s3);margin-top:var(--s4);max-width:none}
.mktbody .nobody{background:#1a2848}
`

// ---- a trainer's stats -------------------------------------------------------------------------

/** The stats as tiles: the duel record wide with its split, then one tile per number. */
export function statTiles(s: PlayerStats): Raw {
  const duels = s.duelWins + s.duelLosses
  const winShare = duels ? Math.round((100 * s.duelWins) / duels) : 0
  const tiles: [string, number, string][] = [
    [ICONS.swords, s.playersBeaten, 'Players beaten'],
    [ICONS.tuft, s.wildWins, 'Wild wins'],
    [ICONS.jar, s.catches, 'Catches'],
    [ICONS.flag, s.firstFinds, 'First finds'],
    [ICONS.lantern, s.mythicsFound, 'Mythics found'],
    [ICONS.coin, s.marketSales, 'Market sales'],
  ]
  return html`<ul class="statgrid">
<li class="stat duel">${raw(ICONS.trophy)}<p class="n" aria-hidden="true"><b>${num(s.duelWins)}</b><span class="dash">-</span><b class="l">${num(s.duelLosses)}</b></p><p class="k"><span class="sr">${num(s.duelWins)} ${plural(s.duelWins, 'win', 'wins')} and ${num(s.duelLosses)} ${plural(s.duelLosses, 'loss', 'losses')}: </span>Duel wins and losses</p>
<span class="split" role="img" aria-label="${`${winShare}% of duels went their way`}"><i style="--v:${winShare}%"></i></span></li>
${tiles.map(([icon, n, label]) => html`<li class="stat${n ? '' : ' zero'}">${raw(icon)}<p class="n"><b>${num(n)}</b></p><p class="k">${label}</p></li>`)}
</ul>`
}

export const STATS_CSS = `
.statgrid{list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s2);margin:0;padding:0}
@media (min-width:768px){.statgrid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.stat{position:relative;display:flex;flex-direction:column;gap:2px;min-height:120px;padding:var(--s3);background:#1c2333;box-shadow:inset 0 -4px 0 #141a28}
.stat .ico{width:28px;height:28px;margin-bottom:var(--s2);transition:transform .2s var(--spring)}
.stat:hover .ico{transform:translateY(-4px) rotate(-8deg)}
.stat .n{display:flex;align-items:baseline;gap:8px;font-size:2rem;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums;color:#fffdf5}
.stat .n .dash{color:#6e7896}
.stat .n .l{color:#c9c3d6}
.stat .k{font-size:.875rem;color:#c9c3d6}
.stat.zero .n{color:#6e7896}
.stat.duel{grid-column:span 2}
.split{display:block;height:8px;margin-top:var(--s2);background:#e8744f;box-shadow:0 0 0 2px #141a28}
.split i{display:block;height:100%;width:var(--v);background:#9ed36a}
`

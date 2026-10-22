// Public camps: collection browsing and rankings use only the website projection and midnight stats.
import type { ListingView, ProfileResponse } from '../../plugin/hooks/core/api.ts'
import { RARITIES } from '../../plugin/hooks/core/cards.ts'
import { FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { seasonOf } from '../../plugin/hooks/core/world.ts'
import type { Db } from './db.ts'
import { catalogOf } from './game/ctx.ts'
import { publicRow, rankings } from './game/stats.ts'
import { lots, statTiles } from './pages-boards.ts'
import { cardTiles, heading, html, installBlock, promptLine, raw, text } from './pages-html.ts'
import type { DiscoveryCredits, Raw } from './pages-html.ts'
import { teamCamp } from './pages-landing.ts'
import type { publicInventory } from './public-collection.ts'
import type { PlayerRow } from './schema.ts'

type Inventory = NonNullable<Awaited<ReturnType<typeof publicInventory>>>
export type PublicStanding = {
  rating: number; rank: number | null; season: number
  seasonStats: { duelWins: number; playersBeaten: number; species: number; mythics: number; sales: number }
}

/** The same midnight rating/rank as the boards, including players outside their first fifty. */
export async function publicStanding(db: Db, handle: string, now: number): Promise<PublicStanding | null> {
  const p = await db.get<PlayerRow>('SELECT * FROM players WHERE handle = ?', handle)
  if (!p || p.board_hidden) return null
  const pub = publicRow(p, now), season = seasonOf(now), current = pub.stats_season === season
  const rating = await rankings(db, p, 'rating', 'all', now)
  return {
    rating: pub.rating, rank: rating.me?.rank ?? null, season,
    seasonStats: {
      duelWins: current ? pub.s_duel_wins : 0, playersBeaten: current ? pub.s_beaten : 0,
      species: current ? pub.s_species : 0, mythics: current ? pub.s_mythics : 0, sales: current ? pub.s_sales : 0,
    },
  }
}

const FILTER_KEYS = ['q', 'family', 'rarity', 'trait', 'finish', 'kind', 'sort'] as const
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
function collectionHref(handle: string, q: URLSearchParams, change: Record<string, string | undefined>): string {
  const next = new URLSearchParams()
  for (const k of FILTER_KEYS) if (q.get(k)) next.set(k, q.get(k)!)
  for (const [k, v] of Object.entries(change)) { if (v) next.set(k, v); else next.delete(k) }
  const query = next.toString()
  return `/u/${encodeURIComponent(handle)}${query ? '?' + query : ''}#collection`
}

function choices(handle: string, q: URLSearchParams, key: string, title: string, values: readonly (readonly [string, string])[]): Raw {
  const selected = q.get(key) ?? ''
  return html`<div class="collection-choice"><h3>${title}</h3><div class="filter-links">${[['', 'All'], ...values].map(([v, label]) => html`<a href="${collectionHref(handle, q, { [key]: v })}"${selected === v ? html` aria-current="true"` : ''}>${label}</a>`)}</div></div>`
}

function filters(handle: string, q: URLSearchParams): Raw {
  const active = FILTER_KEYS.some(k => k !== 'sort' && q.get(k))
  return html`<details class="collection-filters"${active ? html` open` : ''}><summary>Filter &amp; sort${active ? ' · filters on' : ''}</summary>
${choices(handle, q, 'family', 'Family', FAMILIES.map(f => [f, FAMILY_INFO[f].name] as const))}
${choices(handle, q, 'rarity', 'Rarity', RARITIES.map(r => [r, cap(r)] as const))}
${choices(handle, q, 'kind', 'Creature', [['species', 'Season species'], ['mythic', 'Mythics'], ['fusion', 'Hybrids'], ['promo', 'Special cards']])}
${choices(handle, q, 'finish', 'Finish', [['foil', 'Foil'], ['shiny', 'Shiny'], ['both', 'Shiny foil']])}
<div class="collection-choice"><h3>Sort by</h3><div class="filter-links">${[['name', 'Name'], ['rarity', 'Rarity'], ['level', 'Level'], ['power', 'Power'], ['genes', 'Genes'], ['hp', 'HP'], ['atk', 'Attack'], ['def', 'Defense'], ['spd', 'Speed']].map(([sort, label]) => html`<a href="${collectionHref(handle, q, { sort })}"${(q.get('sort') ?? 'name') === sort ? html` aria-current="true"` : ''}>${label}</a>`)}</div></div>
${active || q.get('sort') ? html`<p><a href="/u/${encodeURIComponent(handle)}#collection">Reset filters</a></p>` : ''}
</details>`
}

export function profileBody(p: ProfileResponse, inventory: Inventory, standing: PublicStanding | null, selling: readonly ListingView[], credits: DiscoveryCredits, q: URLSearchParams, db: Db): Raw {
  const handle = text(p.handle, 40)
  const season = standing?.seasonStats
  const after = q.get('after')
  return html`<section class="wrap profile profile-head">
<p class="pennant">${p.league} league</p><h1>${heading(`${handle}'s camp`)}</h1>
<div class="chips"><span class="ptag">${inventory.total} ${inventory.total === 1 ? 'card' : 'cards'}</span><span class="ptag">${p.seenCount} species collected</span>${standing ? html`<a class="ptag" href="/boards">${standing.rank === null ? 'Unranked' : '#' + standing.rank} · ${standing.rating} rating</a>` : ''}<button class="pbtn js-only" type="button" data-profile-share="/u/${encodeURIComponent(p.handle)}"><span class="face">↗ Share profile</span></button></div>
<p id="profile-share-status" role="status" aria-live="polite" style="overflow-wrap:anywhere"></p>
<nav class="camp-nav" aria-label="Profile sections"><a href="#collection">Collection</a><a href="#team">Team</a>${p.stats ? html`<a href="#stats">Stats</a>` : ''}${selling.length ? html`<a href="#market">Market</a>` : ''}</nav>
</section>
<section class="wrap profile collection" id="collection" aria-labelledby="collection-h"><div class="section-title"><h2 id="collection-h">${heading('Collection')}</h2><p class="soft">${inventory.matching === inventory.total ? `${inventory.total} cards` : `${inventory.matching} of ${inventory.total} cards`}</p></div>
${filters(p.handle, q)}
${inventory.cards.length ? cardTiles(inventory.cards, { link: true, credits }) : html`<p class="empty">${inventory.total ? 'No cards match these filters.' : 'No cards in this collection yet.'}</p>`}
${inventory.next || after ? html`<nav class="collection-pages" aria-label="Collection pages">${after ? html`<a class="pbtn" href="${collectionHref(p.handle, q, {})}">Back to first page</a>` : ''}${inventory.next ? html`<a class="pbtn" rel="next" href="${collectionHref(p.handle, q, { after: inventory.next })}">Next cards →</a>` : ''}</nav>` : ''}</section>
<section class="profile" id="team" aria-labelledby="team-h"><div class="wrap"><h2 id="team-h">${heading('Team')}</h2></div>${p.team.length ? teamCamp(p.team, credits) : html`<p class="wrap empty">No team saved right now. Everyone's off in the grass.</p>`}</section>
${p.stats ? html`<section class="wrap profile" id="stats" aria-labelledby="stats-h"><div class="section-title"><h2 id="stats-h">${heading('Stats')}</h2><span class="soft">Updated daily</span></div><h3>All time</h3>${statTiles(p.stats)}${season ? html`<h3>Season ${standing!.season}</h3><dl class="season-stats">${[['Duel wins', season.duelWins], ['Players beaten', season.playersBeaten], ['Species collected', season.species], ['Mythics found', season.mythics], ['Market sales', season.sales]].map(([label, value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}</dl>` : ''}</section>` : ''}
${selling.length ? html`<section class="wrap profile" id="market"><h2>${heading('On the market')}</h2><div class="stall">${lots(selling, [], { seller: false, catalog: catalogOf(db), credits })}</div><p class="more"><a href="/market">See the whole market</a></p></section>` : ''}
${p.forTrade.length ? html`<section class="wrap profile" id="trade"><h2>${heading('Pinned for trade')}</h2>${cardTiles(p.forTrade, { link: true, credits })}</section>` : ''}
<section class="wrap profile"><div class="cta"><h2>${heading(`Trade with ${handle}`)}</h2><p>Open their cards and make an offer inside Claude Code.</p>${promptLine(`/spin trade ${handle}`, 'The trade command')}<p class="duelask">Or challenge their team.</p>${promptLine(`/spin duel ${handle}`, 'The challenge command')}<div class="newhere"><h3>New here?</h3>${installBlock('install', 'Install Spinlings first. Your own starter team hatches right away.')}</div></div></section>`
}

export const PROFILE_COLLECTION_CSS = `
.camp-nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:var(--s4)}
.camp-nav a,.filter-links a{display:inline-flex;align-items:center;min-height:40px;padding:7px 12px;background:#1c2333;border:1px solid #46526c;color:#f4f2fb;border-radius:5px;text-decoration:none}
.camp-nav a:hover,.filter-links a:hover,.filter-links [aria-current]{background:#344365;border-color:#f2b33d}
.profile-head .chips a{text-decoration:none}
.profile section,.profile[id]{scroll-margin-top:90px}
.section-title{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px}
.collection-filters{margin:var(--s3) 0 var(--s4);padding:var(--s3);background:#1c2333;border:1px solid #354059;border-radius:7px}
.collection-filters summary{cursor:pointer;font-weight:700;min-height:32px}
.collection-choice h3{margin:var(--s3) 0 6px;font-size:.875rem}
.filter-links{display:flex;flex-wrap:wrap;gap:6px}
.filter-links a{min-height:36px;padding:5px 10px;font-size:.875rem}
.collection-filters>p{margin-top:var(--s3)}
.collection-pages{display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--s3);margin-top:var(--s4)}
.profile .cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,176px),1fr));align-items:start}
.profile .cards .cardlink{min-width:0}
.profile .cards .cf{--cs:3px}
.profile .cards .cf-name{white-space:normal;overflow-wrap:anywhere}
.season-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:var(--s2)}
.season-stats>div{padding:var(--s3);background:#1c2333;border:1px solid #354059;border-radius:6px}
.season-stats dt{font-size:.8125rem;color:#c9c3d6}.season-stats dd{font-size:1.5rem;font-weight:800;margin:4px 0 0}
@media(max-width:400px){.profile .cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.profile .cards .cf{--cs:2px;padding:6px}.profile .cards .cf-name{font-size:.875rem}.profile .cards .cf-combat{grid-template-columns:1fr}.profile .cards .cf-combat>div{display:flex;justify-content:space-between;gap:4px}.profile .cards .card-inspect{font-size:.75rem}.profile .cards .card-discovery{font-size:.75rem}.camp-nav a{padding:7px 9px}}
`

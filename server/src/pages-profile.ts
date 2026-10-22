// Public camps: collection browsing and rankings use only the website projection and midnight stats.
import type { ListingView, ProfileResponse } from '../../plugin/hooks/core/api.ts'
import { RARITIES } from '../../plugin/hooks/core/cards.ts'
import { FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { TRAITS, TRAIT_IDS } from '../../plugin/hooks/core/traits.ts'
import { seasonOf } from '../../plugin/hooks/core/world.ts'
import type { Db } from './db.ts'
import { catalogOf } from './game/ctx.ts'
import { publicRow, rankings } from './game/stats.ts'
import { lots, statTiles } from './pages-boards.ts'
import { cardTiles, heading, html, installBlock, promptLine, raw, SITE_CSP, text } from './pages-html.ts'
import type { DiscoveryCredits, Raw } from './pages-html.ts'
import { teamCamp } from './pages-landing.ts'
import type { publicInventory } from './public-collection.ts'
import type { PlayerRow } from './schema.ts'

type Inventory = NonNullable<Awaited<ReturnType<typeof publicInventory>>>
export const PROFILE_CSP = SITE_CSP.replace("form-action 'none'", "form-action 'self'")
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

function select(q: URLSearchParams, key: string, label: string, values: readonly (readonly [string, string])[], all?: string): Raw {
  const selected = q.get(key) ?? (key === 'sort' ? 'name' : '')
  const options = all ? [['', all], ...values] : values
  return html`<label class="filter-field" for="collection-${key}"><span id="collection-${key}-label">${label}</span><select id="collection-${key}" name="${key}" aria-labelledby="collection-${key}-label">${options.map(([value, title]) => html`<option value="${value}"${selected === value ? html` selected` : ''}>${title}</option>`)}</select></label>`
}

function filters(handle: string, q: URLSearchParams): Raw {
  const active = FILTER_KEYS.some(k => q.get(k) && (k !== 'sort' || q.get(k) !== 'name'))
  const more = ['kind', 'finish', 'trait'].filter(k => q.get(k)).length
  return html`<form class="collection-filters" method="get" action="/u/${encodeURIComponent(handle)}#collection" role="search" aria-label="Filter collection">
<div class="filter-primary"><label class="filter-field filter-search" for="collection-search"><span>Search cards</span><input id="collection-search" type="search" name="q" maxlength="40" autocomplete="off" placeholder="Creature name" value="${q.get('q') ?? ''}"></label>
${select(q, 'family', 'Family', FAMILIES.map(f => [f, FAMILY_INFO[f].name] as const), 'All families')}
${select(q, 'rarity', 'Rarity', RARITIES.map(r => [r, cap(r)] as const), 'All rarities')}
${select(q, 'sort', 'Sort by', [['name', 'Name'], ['rarity', 'Rarity'], ['level', 'Level'], ['power', 'Power'], ['genes', 'Genes'], ['hp', 'Health'], ['atk', 'Attack'], ['def', 'Defense'], ['spd', 'Speed']])}</div>
<div class="filter-footer"><details class="collection-more"${more ? html` open` : ''}><summary>More filters${more ? ` · ${more} active` : ''}</summary><div class="filter-secondary">
${select(q, 'kind', 'Creature', [['species', 'Season species'], ['mythic', 'Mythics'], ['fusion', 'Hybrids'], ['promo', 'Special cards']], 'All creatures')}
${select(q, 'finish', 'Finish', [['foil', 'Foil'], ['shiny', 'Shiny'], ['both', 'Shiny foil']], 'All finishes')}
${select(q, 'trait', 'Trait', TRAIT_IDS.map(id => [id, TRAITS[id].name] as const), 'All traits')}
</div></details><div class="filter-actions">${active ? html`<a class="filter-reset" href="/u/${encodeURIComponent(handle)}#collection">Reset</a>` : ''}<button class="pbtn" type="submit"><span class="face">Apply</span></button></div></div>
</form>`
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
.camp-nav{display:flex;flex-wrap:wrap;gap:24px;margin-top:var(--s4);border-bottom:1px solid #354059}
.camp-nav a{display:inline-flex;align-items:center;min-height:44px;border-bottom:2px solid transparent;color:#c9c3d6;text-decoration:none}
.camp-nav a:hover{color:#ffe2a0;border-bottom-color:#f2b33d}
.profile-head .chips a{text-decoration:none}
.profile section,.profile[id]{scroll-margin-top:90px}
.section-title{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;padding-top:24px}
.section-title h2,.section-title p{margin:0}
.collection-filters{margin:var(--s3) 0 24px;padding-bottom:20px;border-bottom:1px solid #354059}
.filter-primary{display:grid;grid-template-columns:minmax(180px,2fr) repeat(3,minmax(110px,1fr));gap:12px}
.filter-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.filter-field>span{font-size:.75rem;font-weight:700;color:#c9c3d6}
.filter-field input,.filter-field select{width:100%;min-width:0;min-height:44px;padding:10px 12px;border:0;border-bottom:2px solid #46526c;border-radius:0;background:#1c2333;color:#f4f2fb;font:inherit;font-size:.875rem;color-scheme:dark}
.filter-field :is(input,select):focus-visible,.camp-nav a:focus-visible,.collection-more summary:focus-visible{outline:2px solid #f2b33d;outline-offset:3px}
.filter-footer{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px;margin-top:12px}
.collection-more{flex:1 1 160px;min-width:0}
.collection-more summary{display:list-item;width:fit-content;min-height:44px;padding:12px 0;cursor:pointer;font-size:.875rem;color:#c9c3d6}
.collection-more[open]{flex-basis:100%}
.filter-secondary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:4px 0 12px}
.filter-actions{display:flex;align-items:center;gap:16px;margin-left:auto;min-height:44px}
.filter-actions .pbtn{min-width:88px}.filter-reset{display:inline-flex;align-items:center;min-height:44px;color:#c9c3d6}
.collection .cards{margin-top:0}
.collection-pages{display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--s3);margin-top:var(--s4)}
.profile .cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,176px),1fr));align-items:start}
.profile .cards .cardlink{min-width:0}
.profile .cards .cf{--cs:3px}
.profile .cards .cf-name{white-space:normal;overflow-wrap:anywhere}
.season-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:var(--s2)}
.season-stats>div{padding:var(--s3);background:#1c2333;border:1px solid #354059;border-radius:6px}
.season-stats dt{font-size:.8125rem;color:#c9c3d6}.season-stats dd{font-size:1.5rem;font-weight:800;margin:4px 0 0}
@media(max-width:800px){.filter-primary{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:479px){.filter-secondary{grid-template-columns:1fr}.camp-nav{gap:20px}}
@media(max-width:400px){.profile .cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.profile .cards .cf{--cs:2px;padding:6px}.profile .cards .cf-name{font-size:.875rem}.profile .cards .cf-combat{grid-template-columns:1fr}.profile .cards .cf-combat>div{display:flex;justify-content:space-between;gap:4px}.profile .cards .card-discovery{font-size:.75rem}}
`

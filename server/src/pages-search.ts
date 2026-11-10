// One search page with two tabs. Players lists every public profile handle with its saved-team lead
// art; Cards lists the public faces of every held card. Both read only what profiles already show
// (SPEC 20.3): no owner on a card, no activity ordering, no stats and no timestamps. Every page reads a
// bounded run of rows, the forms are native GETs, and the cursors carry only the public search and a
// handle or a random card id.
import { RARITIES } from '../../plugin/hooks/core/cards.ts'
import { FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { HANDLE_RE, ID_RE, S, SchemaError } from '../../plugin/hooks/core/schemas.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import type { BattleCard, Family, Rarity } from '../../plugin/hooks/core/types.ts'
import { FAMILY_COLOR, MYTHIC_COLOR, RARITY_COLOR } from '../../plugin/hooks/ui/tokens.ts'
import type { Api } from './app.ts'
import type { Db, SqlParam } from './db.ts'
import { catalogOf, ensureSeasons } from './game/ctx.ts'
import { cardsByIds, publicCard, queryCards } from './game/mint.ts'
import { b64urlDecode, b64urlEncode } from './game/passkeys.ts'
import { fail } from './http.ts'
import { cardTiles, heading, html, layout, PLACE, PLACE_CSS, raw, SITE_CSP, text } from './pages-html.ts'
import type { Raw } from './pages-html.ts'
import { placeStripSvg } from './pages-scene.ts'
import { spriteSvg } from './pages-sprite.ts'
import { regulars } from './pages-world.ts'
import { discoveryCredits } from './public-collection.ts'

export const PLAYERS_PAGE = 24
export const CARDS_PAGE = 24
/** Rows one window reads, whatever the search: a narrow one pages on rather than scanning the table. */
export const SEARCH_WINDOW = 4000
/** Windows one page may read while they come up empty, so a narrow search rarely shows an empty page. */
export const SEARCH_WINDOWS = 5
export const SEARCH_CSP = SITE_CSP.replace("form-action 'none'", "form-action 'self'")

type Tab = 'players' | 'cards'
type RarityFilter = Rarity | 'mythic'
/** `q` keeps the case it was typed in; matching and cursors use it lowercased. */
export type SearchQuery = { in: Tab; q?: string; after?: string; family?: Family; rarity?: RarityFilter; shiny?: true; foil?: true }
type Trainer = { handle: string; lead?: BattleCard }

const RARITY_FILTERS: readonly RarityFilter[] = [...RARITIES, 'mythic']
const schema = S.obj<Record<string, string | undefined>>({
  in: S.optional(S.oneOf(['players', 'cards'] as const)),
  q: S.optional(S.str({ max: 40, re: /^[^\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]*$/ })),
  after: S.optional(S.str({ min: 1, max: 256, re: /^[A-Za-z0-9_-]+$/ })),
  family: S.optional(S.oneOf(['', ...FAMILIES])),
  rarity: S.optional(S.oneOf(['', ...RARITY_FILTERS])),
  shiny: S.optional(S.oneOf(['', '1'])),
  foil: S.optional(S.oneOf(['', '1'])),
})
const encode = new TextEncoder(), decode = new TextDecoder('utf-8', { fatal: true })
const bad = (): never => fail('bad_request', 'Malformed search')

export function searchQuery(params: URLSearchParams): SearchQuery {
  const values: Record<string, string> = Object.create(null)
  for (const [key, value] of params) {
    if (Object.hasOwn(values, key)) bad()
    values[key] = value
  }
  let v: Record<string, string | undefined>
  try { v = schema(values, '$') } catch (err) {
    if (err instanceof SchemaError) bad()
    throw err
  }
  const q = v.q?.trim()
  const tab: Tab = v.in === 'cards' ? 'cards' : 'players'
  return {
    in: tab, ...(q ? { q } : {}), ...(v.after ? { after: v.after } : {}),
    // card filters belong to the Cards tab; elsewhere they are dropped, never echoed
    ...(tab === 'cards' && v.family ? { family: v.family as Family } : {}),
    ...(tab === 'cards' && v.rarity ? { rarity: v.rarity as RarityFilter } : {}),
    ...(tab === 'cards' && v.shiny ? { shiny: true as const } : {}),
    ...(tab === 'cards' && v.foil ? { foil: true as const } : {}),
  }
}

const needle = (q: SearchQuery) => q.q?.toLowerCase() ?? ''
/** The search a cursor belongs to: a page of one search never continues another. */
const scope = (q: SearchQuery): (string | number)[] => q.in === 'players' ? [1, needle(q)]
  : [2, needle(q), q.family ?? '', q.rarity ?? '', q.shiny ? 1 : 0, q.foil ? 1 : 0]
const cursorOf = (q: SearchQuery, last: string) => b64urlEncode(encode.encode(JSON.stringify([...scope(q), last])))

function afterOf(q: SearchQuery, valid: RegExp): string | null {
  if (!q.after) return null
  try {
    const at: unknown = JSON.parse(decode.decode(b64urlDecode(q.after)))
    const want = scope(q)
    if (!Array.isArray(at) || at.length !== want.length + 1 || want.some((v, i) => at[i] !== v)) return bad()
    const last = at[want.length]
    return typeof last === 'string' && valid.test(last) ? last : bad()
  } catch { return bad() }
}

// ---- windows ---------------------------------------------------------------------------------------

/**
 * Matches from runs of SEARCH_WINDOW rows in key order past `after`. A window with no match moves on to
 * the next, up to SEARCH_WINDOWS of them; `end` is the last key read when more rows follow it.
 */
async function windowed<T>(db: Db, table: 'players' | 'cards', key: 'handle' | 'id', after: string | null, size: number,
  read: (window: string, from: SqlParam[]) => Promise<T[]>): Promise<{ rows: T[]; end?: string }> {
  for (let n = 1; ; n++) {
    const from = after ? [after] : [], where = after ? `WHERE ${key} > ?` : ''
    const rows = await read(`SELECT * FROM ${table} ${where} ORDER BY ${key} LIMIT ${SEARCH_WINDOW}`, from)
    if (rows.length > size) return { rows }
    // more lie past this window only when it was full and another row follows it
    const edge = await db.all<{ k: string }>(`SELECT ${key} AS k FROM ${table} ${where} ORDER BY ${key} LIMIT 2 OFFSET ${SEARCH_WINDOW - 1}`, ...from)
    const end = edge.length === 2 ? edge[0]!.k : undefined
    if (rows.length || !end || n === SEARCH_WINDOWS) return { rows, ...(end ? { end } : {}) }
    after = end
  }
}

// ---- players ---------------------------------------------------------------------------------------

/** One page of handles in the handle index's order, joined to ownership before any card is loaded. */
export async function searchPlayers(db: Db, q: SearchQuery): Promise<{ trainers: Trainer[]; next?: string }> {
  const { rows, end } = await windowed(db, 'players', 'handle', afterOf(q, HANDLE_RE), PLAYERS_PAGE, (window, from) =>
    db.all<{ handle: string; lead: string | null }>(
      `SELECT p.handle, c.id AS lead FROM (${window}) p
       LEFT JOIN cards c ON c.id = json_extract(p.team, '$[0]') AND c.owner_id = p.id
       WHERE instr(lower(p.handle), ?) > 0 ORDER BY p.handle LIMIT ?`, ...from, needle(q), PLAYERS_PAGE + 1,
    ))
  const page = rows.slice(0, PLAYERS_PAGE), cards = await cardsByIds(db, page.flatMap(row => row.lead ? [row.lead] : []))
  const trainers = page.map(row => {
    const c = row.lead ? cards.get(row.lead)?.card : undefined
    return { handle: row.handle, ...(c ? { lead: publicCard(c) } : {}) }
  })
  const next = rows.length > PLAYERS_PAGE ? page.at(-1)!.handle : end
  return { trainers, ...(next ? { next: cursorOf(q, next) } : {}) }
}

// ---- cards -----------------------------------------------------------------------------------------

/** Season species whose names (any stage) hold the search: a card's name and its species' name. */
async function speciesNamed(db: Db, q: string): Promise<string[]> {
  await ensureSeasons(db, (await db.all<{ season: number }>('SELECT season FROM seasons')).map(r => r.season))
  const out: string[] = []
  for (const species of catalogOf(db).values()) for (const s of species) if (s.names.some(n => n.toLowerCase().includes(q))) out.push(s.id)
  return out
}

/** One page of held cards in random-id order, as public faces. */
export async function searchCards(db: Db, q: SearchQuery): Promise<{ cards: BattleCard[]; next?: string }> {
  const conditions = ['EXISTS (SELECT 1 FROM players p WHERE p.id = c.owner_id)']
  const params: SqlParam[] = []
  const add = (sql: string, ...values: SqlParam[]) => { conditions.push(sql); params.push(...values) }
  const name = needle(q)
  if (name) add(`(c.species IN (SELECT value FROM json_each(?))
    OR (c.form IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(c.form, '$.names') WHERE instr(lower(value), ?) > 0)))`,
  JSON.stringify(await speciesNamed(db, name)), name)
  if (q.family) add('c.family = ?', q.family)
  if (q.rarity === 'mythic') add(`c.species = 'mythic'`)
  else if (q.rarity) add(`c.rarity = ? AND c.species != 'mythic'`, q.rarity)
  if (q.shiny) add('c.shiny = 1')
  if (q.foil) add('c.foil = 1')
  const { rows, end } = await windowed(db, 'cards', 'id', afterOf(q, ID_RE), CARDS_PAGE, (window, from) =>
    queryCards(db, `SELECT c.* FROM (${window}) c WHERE ${conditions.join(' AND ')} ORDER BY c.id LIMIT ?`, ...from, ...params, CARDS_PAGE + 1))
  const cards = rows.slice(0, CARDS_PAGE).map(row => publicCard(row.card))
  const next = rows.length > CARDS_PAGE ? cards.at(-1)!.id : end
  return { cards, ...(next ? { next: cursorOf(q, next) } : {}) }
}

// ---- the page --------------------------------------------------------------------------------------

type Change = Partial<Record<'in' | 'q' | 'after' | 'family' | 'rarity' | 'shiny' | 'foil', string | undefined>>
export function searchHref(q: SearchQuery, change: Change = {}): string {
  const base: Change = {
    in: q.in === 'cards' ? 'cards' : undefined, q: q.q, family: q.family, rarity: q.rarity,
    shiny: q.shiny ? '1' : undefined, foil: q.foil ? '1' : undefined,
  }
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...base, ...change })) if (v) params.set(k, v)
  return `/search${params.size ? '?' + params : ''}`
}

const ICON = {
  players: '<svg viewBox="0 0 20 20" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 2h5v2h1v5H9v1H4V9H3V4h1zM13 4h3v1h1v4h-1v1h-3V9h-1V5h1zM3 12h7v1h2v5H1v-5h2zM14 12h3v1h2v5h-5z"/></svg>',
  cards: '<svg viewBox="0 0 20 20" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M5 2h10v1h1v14h-1v1H5v-1H4V3h1zM6 4v12h8V4z"/><path fill="currentColor" d="M9 7h2v1h1v2h-1v1H9v-1H8V8h1z"/></svg>',
  glass: '<svg viewBox="0 0 20 20" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 2h5v1h-5zM4 3h9v1h-9zM3 4h3v1h-3zM11 4h3v1h-3zM3 5h2v1h-2zM12 5h2v1h-2zM2 6h2v5h-2zM13 6h2v5h-2zM3 11h2v1h-2zM12 11h2v1h-2zM3 12h3v1h-3zM11 12h3v1h-3zM4 13h9v1h-9zM6 14h5v1h-5zM13 13h3v3h-3zM15 15h3v3h-3zM17 17h2v2h-2z"/></svg>',
}
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/** A filter chip is a link: it works without script, and pressing an active one lets it go. */
function chips(q: SearchQuery): Raw {
  const chip = (label: string, swatch: Raw | string, active: boolean, change: Change) =>
    html`<a class="fchip" href="${searchHref(q, { ...change, after: undefined })}"${active ? html` aria-current="true"` : ''}>${swatch}<span>${label}</span>${active ? html`<span class="x" aria-hidden="true"></span>` : ''}</a>`
  const hasFilters = Boolean(q.family || q.rarity || q.shiny || q.foil)
  return html`<div class="filters" aria-label="Filters" role="group">
<div class="fset" role="group" aria-label="Family">${FAMILIES.map(f => chip(FAMILY_INFO[f].name, html`<i class="sw" style="--c:${FAMILY_COLOR[f]}"></i>`, q.family === f, { family: q.family === f ? undefined : f }))}</div>
<div class="fset" role="group" aria-label="Rarity">${RARITY_FILTERS.map(r => chip(cap(r), html`<i class="gem" style="--c:${r === 'mythic' ? MYTHIC_COLOR : RARITY_COLOR[r]}"></i>`, q.rarity === r, { rarity: q.rarity === r ? undefined : r }))}</div>
<div class="fset" role="group" aria-label="Finish">${chip('Shiny', html`<i class="spark"></i>`, q.shiny === true, { shiny: q.shiny ? undefined : '1' })}${chip('Foil', html`<i class="holo"></i>`, q.foil === true, { foil: q.foil ? undefined : '1' })}</div>
${hasFilters ? html`<a class="fclear" href="${searchHref(q, { family: undefined, rarity: undefined, shiny: undefined, foil: undefined, after: undefined })}">Clear filters</a>` : ''}
</div>`
}

function searchBox(q: SearchQuery): Raw {
  const cards = q.in === 'cards'
  const keep: [string, string | undefined][] = cards ? [['in', 'cards'], ['family', q.family], ['rarity', q.rarity], ['shiny', q.shiny ? '1' : undefined], ['foil', q.foil ? '1' : undefined]] : []
  return html`<form class="sbox" method="get" action="/search" role="search">
${keep.map(([k, v]) => v ? html`<input type="hidden" name="${k}" value="${v}">` : '')}
<label class="sr" for="search-q">${cards ? 'Search cards by creature name' : 'Search players by username'}</label>
<div class="sfield"><span class="sglass">${raw(ICON.glass)}</span><input id="search-q" name="q" type="search" maxlength="40" autocomplete="off" spellcheck="false" value="${q.q ?? ''}" placeholder="${cards ? 'Creature name' : 'Trainer username'}">${q.q ? html`<a class="sclear" href="${searchHref(q, { q: undefined, after: undefined })}" aria-label="Clear the search" title="Clear the search"></a>` : ''}</div>
<button class="pbtn" type="submit"><span class="face">Search</span></button>
</form>`
}

function trainers(found: Trainer[]): Raw {
  return html`<ul class="trainers">${found.map(p => html`<li><a class="trainer" href="/u/${encodeURIComponent(p.handle)}" aria-label="${`Visit ${text(p.handle, 40)}’s profile`}"><span class="trainer-art">${p.lead ? raw(spriteSvg(spriteFor(p.lead), { flash: false })) : html`<span class="trainer-empty" aria-hidden="true">✦</span>`}</span><span class="trainer-name">${text(p.handle, 40)}</span><span class="trainer-arrow" aria-hidden="true">→</span></a></li>`)}</ul>`
}

let NAPPER = ''
const napper = () => NAPPER || (NAPPER = spriteSvg(spriteFor({ form: regulars()[6]!, stage: 1 }), { cls: 'shut' }))
const nobody = (big: string, line: Raw | string) => html`<div class="nobody">${raw(napper())}<div><p class="big">${big}</p><p>${line}</p></div></div>`

function pages(q: SearchQuery, next: string | undefined, more: string): Raw {
  if (!q.after && !next) return html``
  return html`<nav class="spages" aria-label="${q.in === 'cards' ? 'Card pages' : 'Player pages'}">${q.after ? html`<a href="${searchHref(q)}">Back to first page</a>` : ''}${next ? html`<a class="next" rel="next" href="${searchHref(q, { after: next })}">${more} →</a>` : ''}</nav>`
}

export function registerSearch(api: Api): void {
  api.add({
    method: 'GET', path: '/search', public: true, limit: 'browse',
    handler: async ctx => {
      const q = searchQuery(ctx.url.searchParams)
      let results: Raw
      if (q.in === 'players') {
        const found = await searchPlayers(ctx.db, q)
        results = html`${found.trainers.length ? trainers(found.trainers)
          : found.next ? nobody('None in this stretch.', 'More players wait further on.')
          : nobody(q.q ? 'No trainers by that name.' : 'No trainers here yet.', q.q ? 'Try a shorter part of the name.' : 'Your camp could be the first.')}
${pages(q, found.next, 'More players')}`
      } else {
        const found = await searchCards(ctx.db, q)
        const credits = await discoveryCredits(ctx.db, found.cards)
        const filtered = Boolean(q.q || q.family || q.rarity || q.shiny || q.foil)
        results = html`${found.cards.length ? cardTiles(found.cards, { link: true, credits })
          : found.next ? nobody('None in this stretch.', 'More cards wait further on.')
          : nobody(filtered ? 'No cards match.' : 'No cards here yet.', filtered ? html`Try fewer filters, or <a href="${searchHref({ in: 'cards' })}">see every card</a>.` : 'The first catch will show up here.')}
${pages(q, found.next, 'More cards')}`
      }
      const cards = q.in === 'cards'
      const [sky, ground, shade] = PLACE[cards ? q.family ?? 'sonnet' : 'haiku']
      const response = layout({
        kind: 'site', title: cards ? 'Search cards: Spinlings' : 'Search players: Spinlings',
        description: 'Find Spinlings trainers and their creatures. Visit public profiles and open any card.',
        path: '/search', origin: ctx.origin, noindex: true, cache: 'no-store', now: ctx.now, css: SEARCH_CSS,
        body: html`<div class="place" style="--psky:${sky};--pground:${ground};--pshade:${shade}" aria-hidden="true">${raw(placeStripSvg())}</div>
<section class="wrap search">
<h1>${heading('Search')}</h1>
<nav class="stabs" aria-label="Search in">${(['players', 'cards'] as const).map(t => html`<a class="stab" href="${searchHref({ in: t, ...(q.q ? { q: q.q } : {}) })}"${t === q.in ? html` aria-current="page"` : ''}>${raw(ICON[t])}<span>${cap(t)}</span></a>`)}</nav>
${searchBox(q)}
${cards ? chips(q) : ''}
<div class="results">${results}</div>
</section>`,
      })
      const headers = new Headers(response.headers)
      headers.set('Content-Security-Policy', SEARCH_CSP)
      return new Response(response.body, { status: response.status, headers })
    },
  })

  // the old directory: its searches and pages carry over
  api.add({
    method: 'GET', path: '/players', public: true,
    handler: ctx => {
      const params = new URLSearchParams({ in: 'players' })
      for (const key of ['q', 'after']) {
        const value = ctx.url.searchParams.get(key)
        if (value) params.set(key, value)
      }
      return new Response(null, { status: 301, headers: { Location: `/search?${params}`, 'Cache-Control': 'public, max-age=86400' } })
    },
  })
}

export const SEARCH_CSS = PLACE_CSS + `
main{display:block;background:#1c1a26;color:#f4f2fb;padding-bottom:var(--s6)}main :focus-visible{outline-color:#fffdf5}
.place{margin-bottom:var(--s4)}.place .placeart{left:50%;transform:translateX(-50%);width:calc(480 * var(--ap));height:calc(64 * var(--ap))}
.search{overflow-wrap:anywhere}.search h1{font-weight:800;line-height:1.2}
.stabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s2);max-width:440px;margin-top:var(--s4)}
.stab{display:flex;align-items:center;justify-content:center;gap:10px;min-height:56px;padding:0 var(--s3) 4px;background:#292232;color:#c9c3d6;font-weight:800;text-decoration:none;box-shadow:inset 0 -4px 0 #110e18}
.stab svg{width:20px;height:20px;transition:transform .2s var(--spring)}
.stab:hover{background:#352b40;color:#fffdf5}.stab:hover svg{transform:translateY(-3px) rotate(-8deg)}
.stab[aria-current]{background:#f1e6cf;color:#2a1d18;box-shadow:inset 0 -4px 0 #c9b38f}
.sbox{display:flex;flex-wrap:wrap;align-items:flex-start;gap:var(--s3);margin-top:var(--s3)}
.sfield{position:relative;flex:1 1 260px;max-width:560px;min-width:0}
.sglass{position:absolute;left:14px;top:14px;width:20px;height:20px;color:#bfb5cc;pointer-events:none}.sglass svg{width:20px;height:20px}
.sfield input{width:100%;height:48px;padding:0 48px 0 46px;border:2px solid #70617d;border-radius:0;background:#26222f;color:#f4f2fb;font:inherit;color-scheme:dark}
.sfield input::placeholder{color:#bfb5cc}.sfield input::-webkit-search-cancel-button{display:none}
.sfield input:focus-visible{outline:3px solid #f2b33d;outline-offset:2px}
.sclear{position:absolute;right:2px;top:2px;width:44px;height:44px;color:#c9c3d6}
.sclear::before,.sclear::after{content:"";position:absolute;left:14px;top:21px;width:16px;height:2px;background:currentColor;rotate:45deg}.sclear::after{rotate:-45deg}
.sclear:hover{color:#fffdf5}
.filters{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s2) var(--s4);margin-top:var(--s3)}
.fset{display:flex;flex-wrap:wrap;gap:var(--s2)}
.fchip{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 12px 4px;background:#292232;color:#e2deee;font-size:.9375rem;font-weight:700;text-decoration:none;box-shadow:inset 0 -4px 0 #110e18}
.fchip:hover{background:#352b40;color:#fffdf5}.fchip:hover i{transform:translateY(-2px)}
.fchip[aria-current]{background:#f1e6cf;color:#2a1d18;box-shadow:inset 0 -4px 0 #c9b38f}
.fchip i{flex:none;width:12px;height:12px;transition:transform .2s var(--spring)}
.fchip .sw{background:var(--c);box-shadow:inset -2px -2px 0 #0004}
.fchip .gem{background:linear-gradient(135deg,#ffffffa0 0 34%,#0000 34%),var(--c);clip-path:polygon(40% 0,60% 0,60% 20%,80% 20%,80% 40%,100% 40%,100% 60%,80% 60%,80% 80%,60% 80%,60% 100%,40% 100%,40% 80%,20% 80%,20% 60%,0 60%,0 40%,20% 40%,20% 20%,40% 20%)}
.fchip .spark{position:relative;width:12px}.fchip .spark::before{content:"";position:absolute;left:4px;top:4px;width:4px;height:4px;background:#fff6c9;box-shadow:-4px 0 #f2b33d,4px 0 #f2b33d,0 -4px #f2b33d,0 4px #f2b33d}
.fchip .holo{background:linear-gradient(135deg,#ff7ac6,#f2b33d,#9ed36a,#5b8def,#a874e8)}
.fchip .x{position:relative;width:10px;height:10px;margin-left:2px}.fchip .x::before,.fchip .x::after{content:"";position:absolute;left:0;top:4px;width:10px;height:2px;background:currentColor;rotate:45deg}.fchip .x::after{rotate:-45deg}
.fclear{display:inline-flex;align-items:center;min-height:44px;color:#c9c3d6}
.results{margin-top:var(--s4)}
.trainers{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:var(--s3)}
.trainers li{min-width:0}.trainer{display:grid;grid-template-columns:72px minmax(0,1fr) 20px;align-items:center;gap:var(--s3);min-height:104px;padding:var(--s3);color:inherit;text-decoration:none;background:#292232;box-shadow:inset 0 -4px 0 #110e18}.trainer:hover{background:#352b40}
.trainer-art{width:72px;height:72px;display:grid;place-items:center;background:#1c1a26}.trainer-art .spr{width:64px;height:64px;transition:transform .2s var(--spring)}.trainer:hover .trainer-art .spr{transform:translateY(-4px)}
.trainer-name{font-weight:750;overflow-wrap:anywhere}.trainer-arrow{color:#ffe2a0;transition:transform .2s var(--spring)}.trainer:hover .trainer-arrow{transform:translateX(4px)}.trainer-empty{font-size:2rem;color:#8b789b}
.search .cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,176px),1fr));gap:var(--s3);align-items:start}
.search .cardlink{display:block;min-width:0;color:inherit;text-decoration:none;transition:transform .2s var(--spring)}.search .cardlink:hover{transform:translateY(-4px)}
.search .cf{--cs:3px}.search .cf-name{white-space:normal;overflow-wrap:anywhere}.search .card-discovery{color:#c9c3d6}.search .card-discovery a{color:#ffe2a0}
.nobody{display:flex;align-items:center;gap:var(--s3);max-width:640px;padding:var(--s3) var(--s4);background:#26222f;color:#c9c3d6}
.nobody .spr{flex:none;width:64px;height:64px}.nobody .big{font-size:1.125rem;font-weight:800;color:#f4f2fb}.nobody a{color:#ffe2a0}
.spages{display:flex;flex-wrap:wrap;gap:var(--s3);margin-top:var(--s4)}.spages a{display:inline-flex;align-items:center;min-height:44px;font-weight:700}.spages .next{margin-left:auto}
@media(max-width:599px){.place{display:none}.search{padding-top:var(--s4)}.sbox{flex-wrap:nowrap;gap:var(--s2)}.sfield{flex:1 1 0;max-width:none}.sbox .pbtn{flex:none}
.filters{display:grid;gap:var(--s2)}.fset{flex-wrap:nowrap;gap:6px;margin:0 -16px;padding:0 16px 2px;overflow-x:auto;scrollbar-width:none}.fset::-webkit-scrollbar{display:none}.fchip{flex:none;padding:0 10px 4px}.fclear{justify-self:start}}
@media(max-width:479px){.trainer{grid-template-columns:56px minmax(0,1fr) 16px;gap:var(--s2);padding:var(--s3) var(--s2)}.trainer-art{width:56px;height:64px}.trainer-art .spr{width:48px;height:48px}.nobody{padding:var(--s3)}.nobody .spr{width:48px;height:48px}}
@media(max-width:400px){.search .cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.search .cf{--cs:2px;padding:6px}.search .cf-name{font-size:.875rem}.search .cf-combat{grid-template-columns:1fr}.search .card-discovery{font-size:.75rem}}
`

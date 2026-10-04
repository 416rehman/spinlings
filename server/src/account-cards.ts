// The owner's browser collection: filters and sorting run before paging, independently of the
// released mod's oldest-first /v1/cards contract. Cursors identify this collection and selection.
import { RARITIES } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { FAMILIES } from '../../plugin/hooks/core/families.ts'
import { DAY_RE, S, SchemaError } from '../../plugin/hooks/core/schemas.ts'
import { sha256Hex } from '../../plugin/hooks/core/sha256.ts'
import { SPECIES_ID } from '../../plugin/hooks/core/species.ts'
import { TRAIT_IDS } from '../../plugin/hooks/core/traits.ts'
import type { Card, CardForm, Family, Rarity, TraitId } from '../../plugin/hooks/core/types.ts'
import type { Api, PlayerCtx } from './app.ts'
import type { Db, SqlParam } from './db.ts'
import { catalogOf, rememberSeason, teamOf } from './game/ctx.ts'
import { cardOf } from './game/mint.ts'
import { b64urlDecode, b64urlEncode } from './game/passkeys.ts'
import { fail, json } from './http.ts'
import type { CardRow, SeasonRow } from './schema.ts'

export const ACCOUNT_CARDS_PAGE = 24
const SORTS = ['newest', 'oldest', 'name', 'rarity', 'level', 'genes', 'hp', 'atk', 'def', 'spd'] as const
type Sort = typeof SORTS[number]
type Selection = {
  q?: string; family?: Family; rarity?: Rarity; trait?: TraitId; finish?: 'foil' | 'shiny' | 'both'
  scope?: 'all' | 'team' | 'forTrade' | 'available'; sort?: Sort; after?: string
}
export type AccountCardsResponse = { cards: Card[]; team: Card[]; version: number; total: number; matched: number; next?: string }

const selectionSchema = S.obj<Selection>({
  q: S.optional(S.str({ max: 40, re: /^[^\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]*$/ })),
  family: S.optional(S.oneOf(FAMILIES)), rarity: S.optional(S.oneOf(RARITIES)), trait: S.optional(S.oneOf(TRAIT_IDS)),
  finish: S.optional(S.oneOf(['foil', 'shiny', 'both'] as const)),
  scope: S.optional(S.oneOf(['all', 'team', 'forTrade', 'available'] as const)),
  sort: S.optional(S.oneOf(SORTS)), after: S.optional(S.str({ min: 1, max: 256, re: /^[A-Za-z0-9_-]+$/ })),
})
const encode = new TextEncoder()
const decode = new TextDecoder('utf-8', { fatal: true })
const BAD_CURSOR = 'This page does not match the collection filters'
const CHANGED = 'Your collection changed. Refresh to see the latest cards.'
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ')

function selection(params: URLSearchParams): Selection {
  const input: Record<string, string | undefined> = Object.create(null)
  for (const [key, value] of params) {
    if (Object.hasOwn(input, key)) fail('bad_request', 'A collection filter was given twice')
    input[key] = value === '' && key !== 'after' ? undefined : value
  }
  try {
    const q = selectionSchema(input, '$')
    return { ...q, q: q.q?.trim().toLowerCase() || undefined, scope: q.scope === 'all' ? undefined : q.scope, sort: q.sort ?? 'newest' }
  } catch (err) {
    if (err instanceof SchemaError) fail('bad_request', 'Malformed collection filters')
    throw err
  }
}

type Key = number | string
type PageRow = CardRow & { sort_key: Key }
type Cursor = [number, string, Key, string]

function cursor(value: string, sort: Sort, fingerprint: string, version: number): Cursor {
  let at: unknown
  try { at = JSON.parse(decode.decode(b64urlDecode(value))) } catch { fail('bad_request', BAD_CURSOR) }
  if (!Array.isArray(at) || at.length !== 4 || !Number.isInteger(at[0]) || at[0] < 0 || at[0] > 1e9 ||
    at[1] !== fingerprint || typeof at[3] !== 'string' || !/^[a-z2-7]{26}$/.test(at[3])) fail('bad_request', BAD_CURSOR)
  const key = at[2]
  const stringKey = sort === 'name' || sort === 'newest' || sort === 'oldest'
  if (stringKey ? typeof key !== 'string' || key.length > 48 || (sort !== 'name' && !DAY_RE.test(key))
    : typeof key !== 'number' || !Number.isSafeInteger(key) || key < 0 || key > 1e9) fail('bad_request', BAD_CURSOR)
  if (at[0] !== version) fail('conflict', CHANGED)
  return at as Cursor
}

const NAME = `COALESCE(json_extract(c.form, '$.names[' || (c.stage - 1) || ']'),
  (SELECT json_extract(j.value, '$.names[' || (c.stage - 1) || ']')
   FROM seasons s, json_each(s.species_json) j WHERE s.season = c.season AND json_extract(j.value, '$.id') = c.species), 'Spinling')`
const GENES = Array.from({ length: 4 }, (_, i) => `COALESCE(json_extract(genes, '$[${i}]'), 0)`).join(' + ')
const stats = ECONOMY.stats
const traits = ECONOMY.traits
const COMMON = `((CASE rarity ${RARITIES.map(r => `WHEN '${r}' THEN ${stats.rarityMult[r]}`).join(' ')} END)
  * (1 + ${stats.levelStep} * (level - 1)) * (CASE stage ${stats.stageMult.map((n, i) => `WHEN ${i + 1} THEN ${n}`).join(' ')} END))`
const traitMult = (id: TraitId, n: number) => `(CASE WHEN EXISTS (SELECT 1 FROM json_each(traits) WHERE value = '${id}') THEN ${n} ELSE 1 END)`
/** Only old empty-stats rows need the same frozen-base formula as cardStats; stored values win. */
function statKey(k: 'hp' | 'atk' | 'def' | 'spd', i: number): string {
  const base = `COALESCE(json_extract(form, '$.base.${k}'),
    (SELECT json_extract(j.value, '$.base.${k}') FROM seasons s, json_each(s.species_json) j
     WHERE s.season = selected.season AND json_extract(j.value, '$.id') = selected.species))`
  const mult = k === 'hp' ? `${traitMult('glassHeart', traits.glassHp)} * ${traitMult('sleepy', traits.sleepyHp)}`
    : k === 'atk' ? traitMult('glassHeart', traits.glassAtk)
    : k === 'spd' ? `${traitMult('swift', traits.swift)} * ${traitMult('sleepy', traits.sleepySpd)}` : '1'
  return `COALESCE(json_extract(stats, '$.${k}'), MAX(1, ROUND(${base}
    * (${stats.geneBase} + ${stats.genePerPoint} * json_extract(genes, '$[${i}]')) * ${COMMON} * (${mult}))))`
}
const KEYS: Record<Sort, string> = {
  newest: 'minted', oldest: 'minted', name: 'lower(label)',
  rarity: `CASE rarity WHEN 'legendary' THEN 3 WHEN 'epic' THEN 2 WHEN 'rare' THEN 1 ELSE 0 END`,
  level: 'level', genes: `(${GENES})`, hp: statKey('hp', 0), atk: statKey('atk', 1), def: statKey('def', 2), spd: statKey('spd', 3),
}

/** Stored stats stay authoritative; frozen forms are resolved only within this database. */
async function wireCards(db: Db, rows: readonly CardRow[]): Promise<Map<string, Card>> {
  const catalog = catalogOf(db)
  const seasons = [...new Set(rows.flatMap(r => [r.season, ...(r.form ? (JSON.parse(r.form) as CardForm).parents ?? [] : []).flatMap(id => {
    const match = SPECIES_ID.exec(id)
    return match ? [Number(match[1])] : []
  })]))].filter(season => !catalog.has(season))
  if (seasons.length) {
    const frozen = await db.all<SeasonRow>(`SELECT season, generator, species_json FROM seasons WHERE season IN (${marks(seasons.length)})`, ...seasons)
    for (const r of frozen) rememberSeason(db, r)
    if (frozen.length !== seasons.length) throw new Error('Stored season is missing')
  }
  const cards = new Map(rows.map(r => [r.id, cardOf(r, catalog).card]))
  const mythics = [...cards.values()].filter(c => c.form?.kind === 'mythic').map(c => c.id)
  if (mythics.length) {
    const finders = await db.all<{ card_id: string; handle: string }>(
      `SELECT m.card_id, p.handle FROM mythics m JOIN players p ON p.id = m.finder_id AND p.handle = m.handle
       WHERE m.card_id IN (${marks(mythics.length)})`, ...mythics,
    )
    for (const row of finders) {
      const card = cards.get(row.card_id)!
      card.form = { ...card.form!, discoveredBy: row.handle }
    }
  }
  return cards
}

async function browse(ctx: PlayerCtx): Promise<AccountCardsResponse> {
  const q = selection(ctx.url.searchParams)
  const team = teamOf(ctx.player)
  const sort = q.sort!
  const fingerprint = sha256Hex(JSON.stringify([
    ctx.player.id, q.q, q.family, q.rarity, q.trait, q.finish, q.scope, sort, q.scope === 'team' ? team : [],
  ])).slice(0, 16)
  const at = q.after ? cursor(q.after, sort, fingerprint, ctx.player.cards_version) : null
  const named = `WITH named AS (SELECT c.*${q.q || sort === 'name' ? `, ${NAME} AS label` : ''} FROM cards c WHERE c.owner_id = ?)`
  const where: string[] = []
  const params: SqlParam[] = [ctx.player.id]
  const add = (sql: string, ...values: SqlParam[]) => { where.push(sql); params.push(...values) }
  if (q.q) add('(instr(lower(label), ?) > 0 OR instr(lower(species), ?) > 0)', q.q, q.q)
  if (q.family) add('family = ?', q.family)
  if (q.rarity) add('rarity = ?', q.rarity)
  if (q.trait) add('EXISTS (SELECT 1 FROM json_each(traits) WHERE value = ?)', q.trait)
  if (q.finish === 'shiny' || q.finish === 'both') add('shiny = 1')
  if (q.finish === 'foil' || q.finish === 'both') add('foil = 1')
  if (q.scope === 'team') add(team.length ? `id IN (${marks(team.length)})` : '0', ...team)
  if (q.scope === 'forTrade') add('for_trade = 1')
  if (q.scope === 'available') add(`state = 'owned'`)
  const filter = where.length ? where.join(' AND ') : '1'
  const counts = (await ctx.db.get<{ total: number; matched: number }>(
    `${named} SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN ${filter} THEN 1 ELSE 0 END), 0) AS matched FROM named`, ...params,
  ))!
  const ascending = sort === 'oldest' || sort === 'name'
  const direction = ascending ? 'ASC' : 'DESC'
  const rows = await ctx.db.all<PageRow>(
    `${named}, selected AS (SELECT * FROM named WHERE ${filter}), ordered AS (SELECT *, ${KEYS[sort]} AS sort_key FROM selected)
     SELECT * FROM ordered ${at ? `WHERE (sort_key ${ascending ? '>' : '<'} ? OR (sort_key = ? AND id ${ascending ? '>' : '<'} ?))` : ''}
     ORDER BY sort_key ${direction}, id ${direction} LIMIT ?`,
    ...params, ...(at ? [at[2], at[2], at[3]] : []), ACCOUNT_CARDS_PAGE + 1,
  )
  const page = rows.slice(0, ACCOUNT_CARDS_PAGE)
  const teamRows = team.length ? await ctx.db.all<CardRow>(
    `SELECT * FROM cards WHERE owner_id = ? AND id IN (${marks(team.length)})`, ctx.player.id, ...team,
  ) : []
  const cards = await wireCards(ctx.db, [...page, ...teamRows])
  const current = await ctx.db.get<{ cards_version: number; team: string }>('SELECT cards_version, team FROM players WHERE id = ?', ctx.player.id)
  if (!current) fail('unauthorized', 'Sign in again to see your collection')
  if (current.cards_version !== ctx.player.cards_version || current.team !== ctx.player.team) fail('conflict', CHANGED)
  const last = page.at(-1)
  const next = rows.length > ACCOUNT_CARDS_PAGE && last
    ? b64urlEncode(encode.encode(JSON.stringify([ctx.player.cards_version, fingerprint, last.sort_key, last.id])))
    : null
  return {
    cards: page.map(r => cards.get(r.id)!), team: team.flatMap(id => cards.has(id) ? [cards.get(id)!] : []),
    version: ctx.player.cards_version, ...counts, ...(next ? { next } : {}),
  }
}

export function accountCards(api: Api): void {
  api.add({ method: 'GET', path: '/account/cards', touch: false, handler: async ctx => json(await browse(ctx)) })
}

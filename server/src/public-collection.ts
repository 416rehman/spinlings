// Website-only views. The installed mod's v1 schemas stay unchanged, and every card goes through
// publicCard: no ownership ids, activity, acquisition dates, model signals or account fields.
import { cardName, cardPower, rarityRank, RARITIES } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { FAMILIES } from '../../plugin/hooks/core/families.ts'
import { HANDLE_RE, ID_RE, S, SchemaError } from '../../plugin/hooks/core/schemas.ts'
import { sha256Hex } from '../../plugin/hooks/core/sha256.ts'
import { SPECIES_ID } from '../../plugin/hooks/core/species.ts'
import { TRAIT_IDS } from '../../plugin/hooks/core/traits.ts'
import type { BattleCard, Family, Rarity, TraitId } from '../../plugin/hooks/core/types.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import type { Db, SqlParam } from './db.ts'
import { cardsByIds, publicCard, queryCards } from './game/mint.ts'
import { b64urlDecode, b64urlEncode } from './game/passkeys.ts'
import { fail } from './http.ts'

export const PUBLIC_INVENTORY_PAGE = 24
export const PUBLIC_MYTHICS_PAGE = 24
const CHUNK = 90
const SORTS = ['name', 'rarity', 'level', 'genes', 'power', 'hp', 'atk', 'def', 'spd'] as const
type Sort = typeof SORTS[number]
export type PublicInventoryQuery = {
  q?: string; family?: Family; rarity?: Rarity; trait?: TraitId; finish?: 'foil' | 'shiny' | 'both'
  kind?: 'species' | 'mythic' | 'fusion' | 'promo'; sort?: Sort; after?: string
}
export type PublicInventory = { cards: BattleCard[]; total: number; matching: number; next?: string }
export type DiscoveryCredit = { handle: string | null; kind: 'species' | 'mythic' }
export type PublicMythic = { name: string; handle: string | null; card: BattleCard | null }
export type PublicMythics = { mythics: PublicMythic[]; total: number; next?: string }

const querySchema = S.obj<PublicInventoryQuery>({
  q: S.optional(S.str({ max: 40, re: /^[^\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]*$/ })),
  family: S.optional(S.oneOf(FAMILIES)), rarity: S.optional(S.oneOf(RARITIES)), trait: S.optional(S.oneOf(TRAIT_IDS)),
  finish: S.optional(S.oneOf(['foil', 'shiny', 'both'] as const)),
  kind: S.optional(S.oneOf(['species', 'mythic', 'fusion', 'promo'] as const)),
  sort: S.optional(S.oneOf(SORTS)), after: S.optional(S.str({ min: 1, max: 256, re: /^[A-Za-z0-9_-]+$/ })),
})
const mythicsSchema = S.obj<{ after?: string }>({ after: S.optional(S.str({ min: 1, max: 256, re: /^[A-Za-z0-9_-]+$/ })) })
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ')
const encode = new TextEncoder()
const decode = new TextDecoder('utf-8', { fatal: true })
const BAD_FILTERS = 'Malformed collection filters'
const BAD_CURSOR = 'This page does not match the collection filters'

function input(q: URLSearchParams | object): Record<string, unknown> {
  if (!(q instanceof URLSearchParams)) return { ...q }
  const out: Record<string, unknown> = Object.create(null)
  for (const [key, value] of q) {
    if (Object.hasOwn(out, key)) fail('bad_request', BAD_FILTERS)
    out[key] = value === '' && key !== 'after' ? undefined : value
  }
  return out
}

function selection(q: URLSearchParams | PublicInventoryQuery): PublicInventoryQuery & { sort: Sort } {
  try {
    const out = querySchema(input(q), '$')
    return { ...out, q: out.q?.trim().toLowerCase() || undefined, sort: out.sort ?? 'name' }
  } catch (err) {
    if (err instanceof SchemaError) fail('bad_request', BAD_FILTERS)
    throw err
  }
}

type Key = number | string
type Cursor = [string, Key, string]
const nextPage = (fingerprint: string, key: Key, id: string) => b64urlEncode(encode.encode(JSON.stringify([fingerprint, key, id])))

function cursor(value: string, fingerprint: string, name: boolean): Cursor {
  let at: unknown
  try { at = JSON.parse(decode.decode(b64urlDecode(value))) } catch { fail('bad_request', BAD_CURSOR) }
  if (!Array.isArray(at) || at.length !== 3 || at[0] !== fingerprint || typeof at[2] !== 'string' || !ID_RE.test(at[2])) fail('bad_request', BAD_CURSOR)
  if (name ? typeof at[1] !== 'string' || at[1].length > 64 || /[\u0000-\u001f\u007f]/.test(at[1])
    : typeof at[1] !== 'number' || !Number.isSafeInteger(at[1]) || at[1] < 0 || at[1] > 1e9) fail('bad_request', BAD_CURSOR)
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
/** Old empty-stats rows use the same frozen-base formula as cardStats; server-stored values win. */
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
const STAT_KEYS = { hp: statKey('hp', 0), atk: statKey('atk', 1), def: statKey('def', 2), spd: statKey('spd', 3) }
const KEYS: Record<Sort, string> = {
  name: 'lower(label)', rarity: `CASE rarity WHEN 'legendary' THEN 3 WHEN 'epic' THEN 2 WHEN 'rare' THEN 1 ELSE 0 END`,
  level: 'level', genes: `(${GENES})`, ...STAT_KEYS,
  power: `(${STAT_KEYS.hp} + 2 * ${STAT_KEYS.atk} + 2 * ${STAT_KEYS.def} + ${STAT_KEYS.spd})`,
}
const keyOf = (card: BattleCard, sort: Sort): Key => sort === 'name' ? cardName(card).toLowerCase()
  : sort === 'rarity' ? rarityRank(card.rarity) : sort === 'level' ? card.level
  : sort === 'genes' ? card.genes.reduce((a, b) => a + b, 0) : sort === 'power' ? cardPower(card) : card.stats[sort]

/** All cards currently held by this exact handle, one bounded page of public faces at a time. */
export async function publicInventory(db: Db, handle: string, _now: number, query: URLSearchParams | PublicInventoryQuery = {}): Promise<PublicInventory | null> {
  if (!HANDLE_RE.test(handle)) return null
  const q = selection(query)
  const player = await db.get<{ id: string }>('SELECT id FROM players WHERE handle = ?', handle)
  if (!player) return null
  const fingerprint = sha256Hex(JSON.stringify(['public-inventory', handle, q.q, q.family, q.rarity, q.trait, q.finish, q.kind, q.sort])).slice(0, 16)
  const at = q.after ? cursor(q.after, fingerprint, q.sort === 'name') : null
  const named = `WITH named AS (SELECT c.*${q.q || q.sort === 'name' ? `, ${NAME} AS label` : ''} FROM cards c WHERE c.owner_id = ?)`
  const conditions: string[] = []
  const params: SqlParam[] = [player.id]
  const add = (sql: string, ...values: SqlParam[]) => { conditions.push(sql); params.push(...values) }
  if (q.q) add('(instr(lower(label), ?) > 0 OR instr(lower(species), ?) > 0)', q.q, q.q)
  if (q.family) add('family = ?', q.family)
  if (q.rarity) add('rarity = ?', q.rarity)
  if (q.trait) add('EXISTS (SELECT 1 FROM json_each(traits) WHERE value = ?)', q.trait)
  if (q.finish === 'shiny' || q.finish === 'both') add('shiny = 1')
  if (q.finish === 'foil' || q.finish === 'both') add('foil = 1')
  if (q.kind === 'species') add(`species NOT IN ('mythic', 'fusion', 'promo')`)
  else if (q.kind) add('species = ?', q.kind)
  const filter = conditions.length ? conditions.join(' AND ') : '1'
  const counts = (await db.get<{ total: number; matching: number }>(
    `${named} SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN ${filter} THEN 1 ELSE 0 END), 0) AS matching FROM named`, ...params,
  ))!
  const asc = q.sort === 'name'
  const direction = asc ? 'ASC' : 'DESC'
  const rows = await queryCards(db,
    `${named}, selected AS (SELECT * FROM named WHERE ${filter}), ordered AS (SELECT *, ${KEYS[q.sort]} AS sort_key FROM selected)
     SELECT * FROM ordered ${at ? `WHERE (sort_key ${asc ? '>' : '<'} ? OR (sort_key = ? AND id ${asc ? '>' : '<'} ?))` : ''}
     ORDER BY sort_key ${direction}, id ${direction} LIMIT ?`,
    ...params, ...(at ? [at[1], at[1], at[2]] : []), PUBLIC_INVENTORY_PAGE + 1,
  )
  const cards = rows.slice(0, PUBLIC_INVENTORY_PAGE).map(row => publicCard(row.card))
  const last = cards.at(-1)
  return { cards, ...counts, ...(rows.length > PUBLIC_INVENTORY_PAGE && last ? { next: nextPage(fingerprint, keyOf(last, q.sort), last.id) } : {}) }
}

/** A regular species was first found, with its contemporaneous credited handle if still valid. */
export async function speciesCredit(db: Db, species: string): Promise<{ handle: string | null } | null> {
  if (!SPECIES_ID.test(species)) return null
  const row = await db.get<{ handle: string | null }>(
    'SELECT p.handle FROM firsts f LEFT JOIN players p ON p.id = f.player_id AND p.handle = f.handle WHERE f.species = ?', species,
  )
  return row ?? null
}

/** Species discovery credit is separate from both the card's current owner and its first stamp. */
export async function discoveryCredits(db: Db, cards: readonly BattleCard[]): Promise<Map<string, DiscoveryCredit>> {
  const out = new Map<string, DiscoveryCredit>()
  const regular = [...new Set(cards.map(c => c.species).filter(s => SPECIES_ID.test(s)))]
  const credits = new Map<string, string | null>()
  for (let i = 0; i < regular.length; i += CHUNK) {
    const part = regular.slice(i, i + CHUNK)
    const rows = await db.all<{ species: string; handle: string | null }>(
      `SELECT f.species, p.handle FROM firsts f LEFT JOIN players p ON p.id = f.player_id AND p.handle = f.handle
       WHERE f.species IN (${marks(part.length)})`, ...part,
    )
    for (const r of rows) credits.set(r.species, r.handle)
  }
  for (const card of cards) if (credits.has(card.species)) out.set(card.id, { handle: credits.get(card.species)!, kind: 'species' })
  const mythics = [...new Set(cards.filter(c => c.species === 'mythic').map(c => c.id))]
  for (let i = 0; i < mythics.length; i += CHUNK) {
    const part = mythics.slice(i, i + CHUNK)
    const rows = await db.all<{ card_id: string; handle: string | null }>(
      `SELECT m.card_id, p.handle FROM mythics m LEFT JOIN players p ON p.id = m.finder_id AND p.handle = m.handle
       WHERE m.card_id IN (${marks(part.length)})`, ...part,
    )
    for (const r of rows) out.set(r.card_id, { handle: r.handle, kind: 'mythic' })
  }
  return out
}

/** Caught Mythics only, including anonymous historical records whose original card is gone. */
export async function publicMythics(db: Db, now: number, query: URLSearchParams | { after?: string } = {}): Promise<PublicMythics> {
  let q: { after?: string }
  try { q = mythicsSchema(input(query), '$') } catch (err) {
    if (err instanceof SchemaError) fail('bad_request', BAD_FILTERS)
    throw err
  }
  const fingerprint = 'public-mythics'
  const at = q.after ? cursor(q.after, fingerprint, true) : null
  const day = utcDay(now)
  const total = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mythics WHERE day <= ?', day))?.n ?? 0
  const rows = await db.all<{ card_id: string; name: string; handle: string | null }>(
    `SELECT m.card_id, m.name, p.handle FROM mythics m LEFT JOIN players p ON p.id = m.finder_id AND p.handle = m.handle
     WHERE m.day <= ? ${at ? 'AND (lower(m.name) > ? OR (lower(m.name) = ? AND m.card_id > ?))' : ''}
     ORDER BY lower(m.name), m.card_id LIMIT ?`, day, ...(at ? [at[1], at[1], at[2]] : []), PUBLIC_MYTHICS_PAGE + 1,
  )
  const page = rows.slice(0, PUBLIC_MYTHICS_PAGE)
  const cards = await cardsByIds(db, page.map(r => r.card_id))
  const mythics = page.map(r => {
    const card = cards.get(r.card_id)?.card
    return { name: r.name, handle: r.handle, card: card?.species === 'mythic' && card.form?.kind === 'mythic' ? publicCard(card) : null }
  })
  const last = page.at(-1)
  return { mythics, total, ...(rows.length > PUBLIC_MYTHICS_PAGE && last ? { next: nextPage(fingerprint, last.name.toLowerCase(), last.card_id) } : {}) }
}

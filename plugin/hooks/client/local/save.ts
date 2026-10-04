// The offline save (SPEC 28, 32): one JSON value under `offline:v1` in $.store, carrying its format version `v`. Older
// formats are migrated forward on load; a save is never reset, and one this mod cannot read (or a newer mod's) is left
// exactly as it is. Cards are compact tuples: stats are recomputed from the rules and the family is read from the
// species or the form, so about 8,000 cards stay far inside the store's 4 MiB, next to the online cache. A card this
// version cannot read (a card, a pack), and any key it does not know, is written back untouched rather than dropped.
import type { Notice, PackSource } from '../../core/api.ts'
import type { BattleCard, BattleSetup, Card, CardForm, CardOrigin, CardStage, Family, Genes, Rarity, Species, TraitId } from '../../core/types.ts'
import { cardStats } from '../../core/cards.ts'
import { DAY_RE, ID_RE, parseBattleCard, parseBattleSetup, parseCardForm, parseNotice } from '../../core/schemas.ts'
import { isFormKind, resolveCard, resolveCards, seasonSpecies, SPECIES_ID } from '../../core/species.ts'
import type { SeasonCatalog } from '../../core/species.ts'

/** The current format version. Bump it, with a migration from the version before, whenever the stored shape changes. */
export const SAVE_VERSION = 1

export const LIMITS = {
  /** packs, crafts and Trader deals stop adding cards here; the oldest commons are suggested for recycling */
  cards: 8000,
  /** cards a battle earns (catches, bounties, season rewards) still land up to here */
  hardCards: 9000,
  /** a one-time notice once the collection reaches this */
  nearFull: 7800,
  /** the save's JSON size: what is left of the 4 MiB store holds the online cache, seasons and settings */
  bytes: 2.5 * 1024 * 1024,
  notices: 30,
} as const

export type ArenaCounts = Record<Family, number>
export type LocalPack = { id: string; family: Family; source: PackSource; day: string; lockUntil: number; bound: boolean }
export type OpenBattle = {
  id: string
  state: 'open'
  setup: BattleSetup
  /** a duel's Rival: its name and the rating Elo settles against */
  rival: { name: string; rating: number } | null
  startedAt: number
  finishAfter: number
}
/** The last settled battle: its catch choice while one is open, and its id so a second finish or catch is refused. */
export type SettledBattle = { id: string; state: 'settled'; options: BattleCard[]; until: number }
export type LocalBattle = OpenBattle | SettledBattle

export type LocalState = {
  /** UTC day of the first run */
  joined: string
  sparks: number
  rating: number
  streak: number
  battles: number
  /** the first wild win (which always catches) has happened */
  wildWon: boolean
  /** the season the last season-end grant was for */
  season: number
  helloDay: string
  firstWinDay: string
  lastWildAt: number
  lastDuelAt: number
  lastChargeAt: number
  /** accepted charges in the last 24 hours */
  charges: number[]
  team: string[]
  seen: string[]
  cardsVersion: number
  cards: Card[]
  /** battles per arena family for cards not yet raised (SPEC 18); dropped once `raisedIn` is fixed */
  arena: Record<string, ArenaCounts>
  packs: LocalPack[]
  /** oldest first */
  notices: Notice[]
  battle: LocalBattle | null
  /** the last few settled battles: finishing or catching one again is refused as already done */
  done: string[]
  trader: { day: string; used: number[] }
  /** the species generator version each season was first played with (SPEC 32) */
  generators: Record<string, number>
  /** Resolved historical forms for this transaction; never serialized into the compact save. */
  catalog: Map<number, readonly Species[]>
  /** the nearly-full notice was given */
  nearFull: boolean
  /** cards and packs this version could not read: written back exactly as found */
  keep: { cards: unknown[]; packs: unknown[] }
  /** keys this version does not know: written back exactly as found */
  extra: Record<string, unknown>
}

// Append-only code tables: a stored number means the same thing forever.
const FAMILY_CODES: readonly Family[] = ['haiku', 'sonnet', 'opus', 'fable']
const RARITY_CODES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary']
const ORIGIN_CODES: readonly CardOrigin[] = ['starter', 'pack', 'catch', 'bounty', 'craft', 'fusion', 'gift', 'daily', 'trader', 'promo', 'season', 'unknown']
const SOURCE_CODES: readonly PackSource[] = ['welcome', 'charge', 'bought', 'daily', 'bonus', 'streak', 'season', 'trader', 'promo']
const TRAIT_CODES: readonly TraitId[] = [
  'sturdy', 'swift', 'thickHide', 'luckyStar', 'quickCharge', 'glassHeart', 'regrowth', 'underdog',
  'ambush', 'moonlit', 'stubborn', 'showoff', 'guardian', 'sleepy', 'homebody', 'mimic',
]
const FLAG = { shiny: 1, foil: 2, bound: 4, forTrade: 8, escrow: 16, firstFind: 32 } as const
const CARD_SPECIES_RE = /^(?:s[1-9]\d{0,3}-(?:haiku|sonnet|opus|fable)-[0-8]|fusion|mythic|promo)$/
const MAX_TIME = 8.64e15

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null)
const code = <T>(table: readonly T[], v: unknown): T | null => (int(v, 0, table.length - 1) === null ? null : table[v as number]!)
const time = (v: unknown): number => int(v, 0, MAX_TIME) ?? 0
const day = (v: unknown, fallback: string): string => (typeof v === 'string' && DAY_RE.test(v) ? v : fallback)
const id = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v)

// ---------- cards ----------

/** [id, species, season, rarity, flags, dna, genes, traits, level, xp, stage, raisedIn, origin, mintedAt, lockedUntil, tiredUntil, form?] */
export function encodeCard(c: Card): unknown[] {
  const flags = (c.shiny ? FLAG.shiny : 0) | (c.foil ? FLAG.foil : 0) | (c.bound ? FLAG.bound : 0) | (c.forTrade ? FLAG.forTrade : 0)
    | (c.state === 'escrow' ? FLAG.escrow : 0) | (c.firstFind ? FLAG.firstFind : 0)
  const [g0, g1, g2, g3] = c.genes
  const out: unknown[] = [
    c.id, c.species, c.season, RARITY_CODES.indexOf(c.rarity), flags, c.dna, (g0 << 12) | (g1 << 8) | (g2 << 4) | g3,
    c.traits.map(t => TRAIT_CODES.indexOf(t)), c.level, c.xp, c.stage, c.raisedIn ? FAMILY_CODES.indexOf(c.raisedIn) : -1,
    ORIGIN_CODES.indexOf(c.origin), c.mintedAt, c.lockedUntil, c.tiredUntil,
  ]
  if (c.form) out.push(c.form)
  return out
}

/** A stored card, with its stats recomputed; null when any part of it is not one this version can read. */
export function decodeCard(t: unknown, catalog?: SeasonCatalog): Card | null {
  if (!Array.isArray(t) || t.length < 16 || t.length > 17) return null
  const [cardId, species, season, rarity, flags, dna, genes, traits, level, xp, stage, raised, origin, minted, locked, tired, form] = t
  const r = code(RARITY_CODES, rarity), o = code(ORIGIN_CODES, origin), f = int(flags, 0, 63), g = int(genes, 0, 0xffff)
  const ri = int(raised, -1, FAMILY_CODES.length - 1)
  if (!id(cardId) || typeof species !== 'string' || !CARD_SPECIES_RE.test(species) || int(season, 1, 9999) === null) return null
  if (r === null || o === null || f === null || g === null || ri === null || int(dna, 0, 0xffffffff) === null) return null
  if (int(level, 1, 10) === null || int(xp, 0, 400) === null || int(stage, 1, 3) === null) return null
  if (!Array.isArray(traits) || traits.length < 1 || traits.length > 4) return null
  const traitIds = traits.map(k => code(TRAIT_CODES, k))
  if (traitIds.some(x => x === null) || new Set(traitIds).size !== traitIds.length) return null
  let cardForm: CardForm | undefined
  if (isFormKind(species)) {
    try {
      cardForm = parseCardForm(form)
    } catch {
      return null
    }
    if (cardForm.kind !== species) return null
  } else if (form !== undefined) return null
  const card: Card = {
    id: cardId, species, ...(cardForm ? { form: cardForm } : {}), season: season as number,
    family: cardForm ? cardForm.family : species.split('-')[1] as Family, rarity: r, shiny: (f & FLAG.shiny) !== 0,
    ...(f & FLAG.foil ? { foil: true as const } : {}), dna: dna as number,
    genes: [(g >> 12) & 15, (g >> 8) & 15, (g >> 4) & 15, g & 15] as Genes, traits: traitIds as TraitId[],
    level: level as number, xp: xp as number, stage: stage as CardStage, ...(ri >= 0 ? { raisedIn: FAMILY_CODES[ri]! } : {}),
    stats: { hp: 1, atk: 1, def: 1, spd: 1 }, bound: (f & FLAG.bound) !== 0, forTrade: (f & FLAG.forTrade) !== 0, origin: o,
    mintedAt: time(minted), lockedUntil: time(locked), tiredUntil: time(tired), state: f & FLAG.escrow ? 'escrow' : 'owned',
    ...(f & FLAG.firstFind ? { firstFind: true as const } : {}),
  }
  try {
    if (catalog && !isFormKind(card.species) && !catalog.has(card.season)) return null
    if (catalog) Object.assign(card, resolveCard(card, catalog))
    card.stats = cardStats(card, catalog)
  } catch {
    return null
  }
  return card
}

// ---------- the whole save ----------

export function blankState(joined: string): LocalState {
  return {
    joined, sparks: 0, rating: 1000, streak: 0, battles: 0, wildWon: false, season: 1, helloDay: '', firstWinDay: '',
    lastWildAt: 0, lastDuelAt: 0, lastChargeAt: 0, charges: [], team: [], seen: [], cardsVersion: 0, cards: [], arena: {},
    packs: [], notices: [], battle: null, done: [], trader: { day: '', used: [] }, generators: {}, catalog: new Map(), nearFull: false, keep: { cards: [], packs: [] }, extra: {},
  }
}

const KNOWN = new Set(['v', 'w', ...Object.keys(blankState('2026-10-01')).filter(k => k !== 'keep' && k !== 'extra' && k !== 'catalog')])

function decodePack(t: unknown): LocalPack | null {
  if (!Array.isArray(t) || t.length !== 6) return null
  const [packId, family, source, d, lockUntil, bound] = t
  const f = code(FAMILY_CODES, family), s = code(SOURCE_CODES, source)
  if (!id(packId) || f === null || s === null || typeof d !== 'string' || !DAY_RE.test(d)) return null
  return { id: packId, family: f, source: s, day: d, lockUntil: time(lockUntil), bound: bound === 1 }
}

const encodePack = (p: LocalPack): unknown[] =>
  [p.id, FAMILY_CODES.indexOf(p.family), SOURCE_CODES.indexOf(p.source), p.day, p.lockUntil, p.bound ? 1 : 0]

function decodeBattle(v: unknown, catalog: SeasonCatalog): LocalBattle | null {
  if (!isRecord(v) || !id(v.id)) return null
  try {
    if (v.state === 'open') {
      const rival = isRecord(v.rival) && typeof v.rival.name === 'string' && int(v.rival.rating, 0, 100_000) !== null
        ? { name: v.rival.name, rating: v.rival.rating as number } : null
      return { id: v.id, state: 'open', setup: resolveCards(parseBattleSetup(v.setup), catalog), rival, startedAt: time(v.startedAt), finishAfter: time(v.finishAfter) }
    }
    if (v.state === 'settled' && Array.isArray(v.options) && v.options.length <= 3) {
      return { id: v.id, state: 'settled', options: resolveCards(v.options.map(o => parseBattleCard(o)), catalog), until: time(v.until) }
    }
  } catch {
    // a battle is passing state: one this version cannot read simply ends
  }
  return null
}

function decodeArena(v: unknown, ids: ReadonlySet<string>): Record<string, ArenaCounts> {
  const out: Record<string, ArenaCounts> = {}
  if (!isRecord(v)) return out
  for (const [k, n] of Object.entries(v)) {
    if (!ids.has(k) || !Array.isArray(n) || n.length !== 4) continue
    const [h, s, o, f] = n.map(x => int(x, 0, 1e9) ?? 0) as [number, number, number, number]
    out[k] = { haiku: h, sonnet: s, opus: o, fable: f }
  }
  return out
}

/** A save at the current format version, read field by field: anything malformed takes its default. */
export function decodeState(o: Record<string, unknown>): LocalState {
  const s = blankState(day(o.joined, '2026-10-01'))
  const num = (k: keyof LocalState, lo: number, hi: number) => int(o[k], lo, hi) ?? (s[k] as number)
  s.sparks = num('sparks', 0, 1e9)
  s.rating = num('rating', 0, 100_000)
  s.streak = num('streak', 0, 1e9)
  s.battles = num('battles', 0, 1e9)
  s.season = num('season', 1, 9999)
  s.cardsVersion = num('cardsVersion', 0, 1e9)
  if (isRecord(o.generators)) for (const [k, g] of Object.entries(o.generators)) if (/^[1-9]\d{0,3}$/.test(k) && int(g, 1, 1e6) !== null) s.generators[k] = g as number
  const seasons = new Set([s.season])
  const collect = (v: unknown): void => {
    if (typeof v === 'string') {
      const m = SPECIES_ID.exec(v)
      if (m) seasons.add(Number(m[1]))
    } else if (Array.isArray(v)) for (const item of v) collect(item)
    else if (isRecord(v)) for (const item of Object.values(v)) collect(item)
  }
  collect(o.cards)
  collect(o.battle)
  for (const season of seasons) {
    try {
      // Compact v1 saves shipped with generator 2; a missing legacy entry keeps that historical meaning.
      s.catalog.set(season, seasonSpecies(season, undefined, s.generators[String(season)] ?? 2))
    } catch { /* unknown future generators keep their tuples untouched below */ }
  }
  s.wildWon = o.wildWon === true
  s.nearFull = o.nearFull === true
  s.helloDay = day(o.helloDay, '')
  s.firstWinDay = day(o.firstWinDay, '')
  s.lastWildAt = time(o.lastWildAt)
  s.lastDuelAt = time(o.lastDuelAt)
  s.lastChargeAt = time(o.lastChargeAt)
  s.charges = Array.isArray(o.charges) ? o.charges.filter(t => int(t, 0, MAX_TIME) !== null).slice(-64) as number[] : []
  for (const raw of Array.isArray(o.cards) ? o.cards : []) {
    const c = decodeCard(raw, s.catalog)
    if (c) s.cards.push(c)
    else s.keep.cards.push(raw)
  }
  const ids = new Set(s.cards.map(c => c.id))
  s.team = Array.isArray(o.team) ? [...new Set(o.team.filter(id))].slice(0, 3) : []
  s.seen = Array.isArray(o.seen) ? [...new Set(o.seen.filter((x): x is string => typeof x === 'string' && CARD_SPECIES_RE.test(x)))] : []
  s.arena = decodeArena(o.arena, ids)
  for (const raw of Array.isArray(o.packs) ? o.packs : []) {
    const p = decodePack(raw)
    if (p) s.packs.push(p)
    else s.keep.packs.push(raw)
  }
  s.notices = Array.isArray(o.notices) ? o.notices.flatMap(n => { try { return [parseNotice(n)] } catch { return [] } }).slice(-LIMITS.notices) : []
  s.battle = decodeBattle(o.battle, s.catalog)
  s.done = Array.isArray(o.done) ? o.done.filter(id).slice(-8) : []
  if (isRecord(o.trader)) s.trader = { day: day(o.trader.day, ''), used: Array.isArray(o.trader.used) ? o.trader.used.filter(k => int(k, 0, 9) !== null) as number[] : [] }
  for (const [k, v] of Object.entries(o)) if (!KNOWN.has(k)) s.extra[k] = v
  return s
}

/** The value written to the store. `stamp` marks this write, so a session can tell another one wrote in between. */
export function encodeState(s: LocalState, stamp: string): Record<string, unknown> {
  const arena: Record<string, number[]> = {}
  for (const [k, a] of Object.entries(s.arena)) arena[k] = [a.haiku, a.sonnet, a.opus, a.fable]
  return {
    ...s.extra,
    v: SAVE_VERSION, w: stamp, joined: s.joined, sparks: s.sparks, rating: s.rating, streak: s.streak, battles: s.battles,
    wildWon: s.wildWon, season: s.season, helloDay: s.helloDay, firstWinDay: s.firstWinDay, lastWildAt: s.lastWildAt,
    lastDuelAt: s.lastDuelAt, lastChargeAt: s.lastChargeAt, charges: s.charges, team: s.team, seen: s.seen,
    cardsVersion: s.cardsVersion, cards: [...s.cards.map(encodeCard), ...s.keep.cards], arena, packs: [...s.packs.map(encodePack), ...s.keep.packs],
    notices: s.notices, battle: s.battle ? stripAppearance(s.battle) : null, done: s.done, trader: s.trader, generators: s.generators, nearFull: s.nearFull,
  }
}

/** Local render metadata must not grow either the compact save or its transient battle snapshot. */
function stripAppearance<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripAppearance) as T
  if (!isRecord(v)) return v
  return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'appearance' && k !== 'parentForms').map(([k, item]) => [k, stripAppearance(item)])) as T
}

/** The write stamp of a stored value, or null when there is none. */
export function stampOf(raw: unknown): string | null {
  return isRecord(raw) && typeof raw.w === 'string' ? raw.w : null
}

// ---------- versions ----------

export type Migration = (save: Record<string, unknown>) => Record<string, unknown>

/** Forward migrations keyed by the version they upgrade from: MIGRATIONS[1] turns a v1 save into v2. Append-only. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {}

/** Runs every migration from `from` up to `to`, in order. Throws when a step is missing. */
export function migrate(save: Record<string, unknown>, from: number, table: Readonly<Record<number, Migration>> = MIGRATIONS, to = SAVE_VERSION): Record<string, unknown> {
  let out = save
  for (let v = from; v < to; v++) {
    const step = table[v]
    if (!step) throw new Error(`no offline save migration from v${v}`)
    out = { ...step(out), v: v + 1 }
  }
  return out
}

export type Opened =
  | { kind: 'empty' }
  | { kind: 'ok'; state: LocalState; stamp: string | null }
  /** a newer mod's save: never touched */
  | { kind: 'newer'; version: number }
  /** not a save this mod can read: never touched */
  | { kind: 'unreadable' }

/** Reads whatever the store holds under the offline key, migrating it forward to the current format. */
export function openSave(raw: unknown, table: Readonly<Record<number, Migration>> = MIGRATIONS, version = SAVE_VERSION): Opened {
  if (raw === undefined || raw === null) return { kind: 'empty' }
  if (!isRecord(raw)) return { kind: 'unreadable' }
  const v = int(raw.v, 1, 1e6)
  if (v === null) return { kind: 'unreadable' }
  if (v > version) return { kind: 'newer', version: v }
  try {
    const current = migrate(raw, v, table, version)
    return { kind: 'ok', state: decodeState(current), stamp: stampOf(current) }
  } catch {
    return { kind: 'unreadable' }
  }
}

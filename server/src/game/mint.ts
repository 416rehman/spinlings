// Cards on the server: mintCards is the ONLY place a card row is inserted (server-computed stats,
// first discoveries, the album, the Fusion Log and the Mythics list all follow from it). Also the row
// <-> wire conversions, the loaders and guards every route uses, pack grants, and the views of rows
// that carry cards (packs, offers, gifts). A Mythic's finder is never stored on the card: the
// loaders name them from the Mythics list as each card is read.
import type { GiftView, OfferState, OfferView, PackSource, PackView } from '../../../plugin/hooks/core/api.ts'
import { cardPower, cardStats, toBattleCard } from '../../../plugin/hooks/core/cards.ts'
import { FAMILIES } from '../../../plugin/hooks/core/families.ts'
import { parseCard } from '../../../plugin/hooks/core/schemas.ts'
import { SPECIES_ID } from '../../../plugin/hooks/core/species.ts'
import type { BattleCard, Card, CardForm, CardOrigin, Family, Genes, NewCard, Rarity, Stats, TraitId } from '../../../plugin/hooks/core/types.ts'
import { utcDay } from '../../../plugin/hooks/core/world.ts'
import { guard, stmt } from '../db.ts'
import type { Db, SqlParam, Stmt } from '../db.ts'
import type { CardRow, GiftRow, OfferRow, PackRow } from '../schema.ts'
import { dayStart, ensureSeasons, newId, notFound, readJson } from './ctx.ts'
import type { Env } from './ctx.ts'
import { albumAdd, count } from './stats.ts'

export type ArenaCounts = Record<Family, number>

/** A card as stored: the wire Card (`card`, safe to send to its owner) plus what never leaves the server. */
export type StoredCard = {
  card: Card
  owner: string
  version: number
  /** the offer id or gift code holding it while `card.state` is 'escrow' */
  escrowRef: string | null
  /** battles fought per arena family (SPEC 18), hidden from everyone */
  arena: ArenaCounts
}

const isSeasonSpecies = (species: string) => SPECIES_ID.test(species)

/** A form as stored: never a finder's name, which rows minted before finders were named on reading may still carry. */
const withoutFinder = ({ discoveredBy: _, ...form }: CardForm): CardForm => form

export function cardOf(r: CardRow): StoredCard {
  const base = {
    species: r.species,
    ...(r.form ? { form: withoutFinder(JSON.parse(r.form) as CardForm) } : {}),
    genes: JSON.parse(r.genes) as Genes,
    traits: JSON.parse(r.traits) as TraitId[],
    rarity: r.rarity as Rarity,
    level: r.level,
    stage: r.stage as Card['stage'],
  }
  const stored = readJson<Partial<Stats>>(r.stats, {})
  const card: Card = {
    id: r.id,
    ...base,
    season: r.season,
    family: r.family as Family,
    shiny: r.shiny === 1,
    ...(r.foil === 1 ? { foil: true as const } : {}),
    dna: r.dna,
    xp: r.xp,
    ...(r.raised_in ? { raisedIn: r.raised_in as Family } : {}),
    // rows from before stats were stored get them computed (their season is installed by the loaders)
    stats: typeof stored.hp === 'number' ? (stored as Stats) : cardStats(base),
    bound: r.bound === 1,
    forTrade: r.for_trade === 1,
    origin: r.origin as CardOrigin,
    mintedAt: dayStart(r.minted),
    lockedUntil: r.locked_until,
    tiredUntil: r.tired_until,
    state: r.state as Card['state'],
    ...(r.first_find === 1 ? { firstFind: true as const } : {}),
  }
  return {
    card, owner: r.owner_id, version: r.version, escrowRef: r.escrow_ref,
    arena: { haiku: r.arena_haiku, sonnet: r.arena_sonnet, opus: r.arena_opus, fable: r.arena_fable },
  }
}

/**
 * How another player sees a card: no ownership, timestamps, lock or tiredness, and not where it was
 * raised, since the arena is its owner's model (SPEC 20.3). The stats stay, so a duel replays alike.
 */
export function publicCard(card: Card | BattleCard): BattleCard {
  const { raisedIn: _, ...rest } = toBattleCard(card)
  return rest
}

// ---- loaders (each installs the seasons its cards come from, so stats and names resolve) --------

const CHUNK = 90 // D1 binds at most 100 parameters per statement

/** Cards by any SELECT over `cards`; keep the SELECT bounded. */
export async function queryCards(db: Db, sql: string, ...params: SqlParam[]): Promise<StoredCard[]> {
  const rows = await db.all<CardRow>(sql, ...params)
  await ensureSeasons(db, rows.map(r => r.season))
  const cards = rows.map(cardOf)
  await nameFinders(db, cards)
  return cards
}

/**
 * Who found each caught Mythic, named as it is read (SPEC 18, 20.1): the finder's handle while it is
 * still the one they found it under. After a reroll or a deletion the card names nobody (the site
 * says "a trainer"), so no card, copy or list ever shows an old handle beside a new one.
 */
async function nameFinders(db: Db, cards: readonly StoredCard[]): Promise<void> {
  const ids = cards.filter(c => c.card.form?.kind === 'mythic').map(c => c.card.id)
  if (!ids.length) return
  const finders = new Map<string, string>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK)
    const rows = await db.all<{ card_id: string; handle: string }>(
      `SELECT m.card_id, p.handle FROM mythics m JOIN players p ON p.id = m.finder_id AND p.handle = m.handle
       WHERE m.card_id IN (${part.map(() => '?').join(', ')})`,
      ...part,
    )
    for (const r of rows) finders.set(r.card_id, r.handle)
  }
  for (const { card } of cards) {
    const by = finders.get(card.id)
    if (by) card.form = { ...card.form!, discoveredBy: by }
  }
}

/** Every card a player holds, oldest first. */
export const cardsOf = (db: Db, owner: string): Promise<StoredCard[]> =>
  queryCards(db, 'SELECT * FROM cards WHERE owner_id = ? ORDER BY minted, id', owner)

/** A page of GET /v1/cards stays under the mod's 256 KB answer cap, whatever its cards carry. */
export const CARDS_PAGE_BYTES = 250_000
const CARDS_PAGE_MAX = 1000
/** Where the next page starts: the last card's mint day and id. */
export const CARDS_CURSOR = /^(\d{4}-\d{2}-\d{2})\.([a-z2-7]{26})$/
const utf8 = new TextEncoder()

/**
 * The player's cards oldest first, from just after `after` (a CARDS_CURSOR), as many as fit one
 * answer; `next` is where the following page starts, null after the last. A collection that fits
 * comes whole, exactly as before pages existed.
 */
export async function cardsPage(db: Db, owner: string, after: string | null): Promise<{ cards: Card[]; next: string | null }> {
  const at = after === null ? null : CARDS_CURSOR.exec(after)
  const rows = at
    ? await queryCards(db, 'SELECT * FROM cards WHERE owner_id = ? AND (minted > ? OR (minted = ? AND id > ?)) ORDER BY minted, id LIMIT ?',
      owner, at[1]!, at[1]!, at[2]!, CARDS_PAGE_MAX + 1)
    : await queryCards(db, 'SELECT * FROM cards WHERE owner_id = ? ORDER BY minted, id LIMIT ?', owner, CARDS_PAGE_MAX + 1)
  const cards: Card[] = []
  let bytes = 0
  for (const { card } of rows) {
    bytes += utf8.encode(JSON.stringify(card)).length + 1
    if (cards.length === CARDS_PAGE_MAX || (cards.length && bytes > CARDS_PAGE_BYTES)) break
    cards.push(card)
  }
  const last = cards.at(-1)
  return { cards, next: cards.length < rows.length && last ? `${utcDay(last.mintedAt)}.${last.id}` : null }
}

/** The caller's own card, or 404 exactly as if it did not exist. */
export async function ownCard(db: Db, owner: string, id: string): Promise<StoredCard> {
  return (await queryCards(db, 'SELECT * FROM cards WHERE id = ? AND owner_id = ?', id, owner))[0] ?? notFound('card')
}

/** The caller's own cards in the order asked for; 404 if any is missing or someone else's. */
export async function ownCards(db: Db, owner: string, ids: readonly string[]): Promise<StoredCard[]> {
  const found = await cardsByIds(db, ids)
  return ids.map(id => {
    const c = found.get(id)
    return c && c.owner === owner ? c : notFound('card')
  })
}

/** Any cards by id, whoever owns them (offers, battle snapshots); missing ids are simply absent. */
export async function cardsByIds(db: Db, ids: readonly string[]): Promise<Map<string, StoredCard>> {
  const unique = [...new Set(ids)]
  const out = new Map<string, StoredCard>()
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK)
    for (const c of await queryCards(db, `SELECT * FROM cards WHERE id IN (${part.map(() => '?').join(', ')})`, ...part)) out.set(c.card.id, c)
  }
  return out
}

// ---- guards and writes -------------------------------------------------------------------------

/** Aborts the batch unless the card is still this owner's, in this state, at this version. */
export const cardGuard = (c: StoredCard, state: Card['state'] = c.card.state): Stmt =>
  guard('SELECT 1 FROM cards WHERE id = ? AND owner_id = ? AND state = ? AND version = ?', c.card.id, c.owner, state, c.version)

/** PlayerView.cardsVersion moves whenever any of the player's cards change: add this to the batch. */
export const bumpCards = (owner: string): Stmt => stmt('UPDATE players SET cards_version = cards_version + 1 WHERE id = ?', owner)

export type CardChange = { owner?: string; escrowRef?: string | null; arena?: ArenaCounts }

/**
 * Writes `next` (the same card after levelling, evolving, tiring, escrow or a trade) over `prev`, with
 * stats and power recomputed on the server and the version bumped. Species, DNA, genes, traits,
 * rarity and form never change after minting, so they are not written; the origin and mint day say
 * how its current owner got it. Pair it with cardGuard(prev).
 */
export function saveCard(prev: StoredCard, next: Card, change: CardChange = {}): Stmt {
  const stats = cardStats(next)
  const arena = change.arena ?? prev.arena
  return stmt(
    `UPDATE cards SET owner_id = ?, level = ?, xp = ?, stage = ?, raised_in = ?, stats = ?, power = ?, bound = ?, for_trade = ?,
       origin = ?, minted = ?, locked_until = ?, tired_until = ?, state = ?, escrow_ref = ?, arena_haiku = ?, arena_sonnet = ?,
       arena_opus = ?, arena_fable = ?, version = version + 1
     WHERE id = ?`,
    change.owner ?? prev.owner, next.level, next.xp, next.stage, next.raisedIn ?? null, JSON.stringify(stats),
    cardPower({ ...next, stats }), next.bound, next.forTrade, next.origin, utcDay(next.mintedAt), next.lockedUntil, next.tiredUntil, next.state,
    change.escrowRef === undefined ? prev.escrowRef : change.escrowRef,
    arena.haiku, arena.sonnet, arena.opus, arena.fable, prev.card.id,
  )
}

/** Recycling, fusion parents and Trader payments: guard the card first. */
export const deleteCard = (id: string): Stmt => stmt('DELETE FROM cards WHERE id = ?', id)

// ---- minting -----------------------------------------------------------------------------------

export type MintOptions = {
  /** trade-locked until (welcome packs: midnight UTC 7 days after the join day) */
  lockedUntil?: number
  /** bound forever (starters, bound drops) */
  bound?: boolean
}

/**
 * Turns freshly rolled cards (core's rollPack, starterTeam, cardFromBattleCard, fuse, mintFor,
 * generateMythic, promoCard...) into rows for `owner`: random ids, stats computed here, the first
 * card of a species anyone obtained gets firstFind and a `firsts` row (a lost race on it is a
 * Conflict, so the handler re-runs and the card is no longer first), season species go into the
 * album, the player's own fusions into the Fusion Log, caught Mythics onto the public list with
 * `owner` as their finder (a `discoveredBy` the card claims is ignored and never stored), and the owner's
 * stats count each new album species, First Discovered stamp and Mythic found (stats.ts). Commit `stmts` in the
 * handler's batch, after the owner's row exists; return `cards` to the client.
 */
export async function mintCards(env: Env, owner: string, fresh: readonly NewCard[], o: MintOptions = {}): Promise<{ cards: Card[]; stmts: Stmt[] }> {
  await ensureSeasons(env.db, fresh.map(c => c.season))
  const caught = (c: Pick<NewCard, 'species' | 'origin'>) => c.species === 'mythic' && c.origin === 'catch'
  const finder = fresh.some(caught) ? (await env.db.get<{ handle: string }>('SELECT handle FROM players WHERE id = ?', owner))?.handle : undefined
  const species = [...new Set(fresh.map(c => c.species).filter(isSeasonSpecies))]
  const firstTaken = new Set<string>()
  for (let i = 0; i < species.length; i += CHUNK) {
    const part = species.slice(i, i + CHUNK)
    const rows = await env.db.all<{ species: string }>(`SELECT species FROM firsts WHERE species IN (${part.map(() => '?').join(', ')})`, ...part)
    for (const r of rows) firstTaken.add(r.species)
  }
  const day = utcDay(env.now)
  const cards: Card[] = []
  const stmts: Stmt[] = []
  for (const c of fresh) {
    const id = newId(env)
    const first = isSeasonSpecies(c.species) && !firstTaken.has(c.species)
    if (first) firstTaken.add(c.species)
    const { firstFind: _, ...rest } = c as NewCard & { firstFind?: true }
    if (rest.form) rest.form = withoutFinder(rest.form)
    // a self-check: a card that would not pass the client's own reader is a server bug, not a row
    const card = parseCard({
      ...rest,
      id,
      stats: cardStats(c),
      bound: c.bound || o.bound === true,
      forTrade: false,
      mintedAt: dayStart(day),
      lockedUntil: Math.max(c.lockedUntil, o.lockedUntil ?? 0),
      tiredUntil: 0,
      state: 'owned',
      ...(first ? { firstFind: true } : {}),
    })
    stmts.push(stmt(
      `INSERT INTO cards (id, owner_id, species, form, season, family, rarity, shiny, foil, dna, genes, traits, level, xp, stage,
         stats, power, bound, for_trade, origin, minted, locked_until, tired_until, state, first_find, raised_in)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 'owned', ?, ?)`,
      id, owner, card.species, card.form ? JSON.stringify(card.form) : null, card.season, card.family, card.rarity, card.shiny,
      card.foil === true, card.dna, JSON.stringify(card.genes), JSON.stringify(card.traits), card.level, card.xp, card.stage,
      JSON.stringify(card.stats), cardPower(card), card.bound, card.origin, day, card.lockedUntil, first, card.raisedIn ?? null,
    ))
    if (first) {
      stmts.push(stmt('INSERT INTO firsts (species, season, player_id, card_id, day) VALUES (?, ?, ?, ?, ?)', card.species, card.season, owner, id, day))
      stmts.push(...count(owner, env.now, { firstFinds: 1 }))
    }
    stmts.push(...albumAdd(owner, card.species, env.now))
    if (card.species === 'fusion' && card.origin === 'fusion') {
      stmts.push(stmt('INSERT INTO fusions (player_id, form, day) VALUES (?, ?, ?)', owner, JSON.stringify(card.form), day))
    }
    if (caught(card)) {
      // the handle it was found under: the loaders name the finder only while it is still theirs
      stmts.push(stmt(
        'INSERT INTO mythics (card_id, name, finder_id, handle, day) VALUES (?, ?, ?, ?, ?)',
        id, card.form!.names[2], owner, finder ?? null, day,
      ))
      stmts.push(...count(owner, env.now, { mythicsFound: 1 }))
    }
    cards.push(caught(card) && finder ? { ...card, form: { ...card.form!, discoveredBy: finder } } : card)
  }
  if (fresh.length) stmts.push(bumpCards(owner))
  return { cards, stmts }
}

// ---- packs -------------------------------------------------------------------------------------

export type PackOptions = {
  /** the cards it opens are trade-locked until then (welcome packs) */
  lockUntil?: number
  /** the cards it opens are bound (packs from a bound drop) */
  bound?: boolean
}

/**
 * An unopened pack for `owner`. Packs hold no cards: the collection rolls them at opening and mints
 * them with { lockedUntil: row.lock_until, bound: row.bound === 1 }. The bank of 12 limits charges
 * only (SPEC 6); every other source may go past it.
 */
export function grantPack(env: Pick<Env, 'now' | 'randomBytes'>, owner: string, family: Family, source: PackSource, o: PackOptions = {}): { pack: PackView; stmt: Stmt } {
  if (!FAMILIES.includes(family)) throw new TypeError(`bad family ${family}`)
  const pack: PackView = { id: newId(env), family, source, day: utcDay(env.now) }
  return {
    pack,
    stmt: stmt(
      'INSERT INTO packs (id, owner_id, family, source, created, lock_until, bound) VALUES (?, ?, ?, ?, ?, ?, ?)',
      pack.id, owner, family, source, pack.day, o.lockUntil ?? 0, o.bound === true,
    ),
  }
}

export const packView = (r: PackRow): PackView => ({ id: r.id, family: r.family as Family, source: r.source as PackSource, day: r.created })

/** The player's unopened packs, oldest first (at most `limit`, the wire allows 50). */
export async function packsOf(db: Db, owner: string, limit = 50): Promise<PackView[]> {
  return (await db.all<PackRow>('SELECT * FROM packs WHERE owner_id = ? ORDER BY created, id LIMIT ?', owner, limit)).map(packView)
}

export async function unopenedCount(db: Db, owner: string): Promise<number> {
  return (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM packs WHERE owner_id = ?', owner))!.n
}

// ---- views of rows that carry cards ------------------------------------------------------------

/** Handles by player id (a deleted player's id is simply absent). */
export async function handlesOf(db: Db, ids: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  const out = new Map<string, string>()
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK)
    const rows = await db.all<{ id: string; handle: string }>(`SELECT id, handle FROM players WHERE id IN (${part.map(() => '?').join(', ')})`, ...part)
    for (const r of rows) out.set(r.id, r.handle)
  }
  return out
}

/**
 * Offers as either side sees them: both sides' cards as public battle cards (SPEC 8, 20), and both
 * handles as they were when it was sent. A card that has since left its owner drops out of the view.
 */
export async function offerViews(db: Db, rows: readonly OfferRow[]): Promise<OfferView[]> {
  const ids = rows.flatMap(r => [...readJson<string[]>(r.give, []), ...readJson<string[]>(r.get, [])])
  const cards = await cardsByIds(db, ids)
  const side = (list: string, owner: string) =>
    readJson<string[]>(list, []).flatMap(id => {
      const c = cards.get(id)
      return c && c.owner === owner ? [publicCard(c.card)] : []
    })
  return rows.map(r => ({
    id: r.id,
    from: r.from_handle,
    to: r.to_handle,
    give: side(r.give, r.from_id),
    get: side(r.get, r.to_id),
    state: r.state as OfferState,
    createdAt: dayStart(r.created),
    expiresAt: r.expires_at,
  }))
}

/** The giver's own open gifts, each with the full card it holds in escrow. */
export async function giftViews(db: Db, rows: readonly GiftRow[]): Promise<GiftView[]> {
  const cards = await cardsByIds(db, rows.map(r => r.card_id))
  return rows.flatMap(r => {
    const c = cards.get(r.card_id)
    if (!c || c.owner !== r.giver_id) return []
    return [{ code: r.code, card: c.card, createdAt: dayStart(r.created), expiresAt: dayStart(r.expires) }]
  })
}

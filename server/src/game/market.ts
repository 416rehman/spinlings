// The market (SPEC 8, 15, 16, 20, 26): a player lists one tradeable card for sparks, a wanted card or both, and
// anyone else buys it whenever they like, while the seller is away. The listed card waits in escrow (off the team,
// out of every other action); a sale is one guarded batch that moves the card, the sparks (no fee) and any card
// asked for, so of two buyers at once exactly one wins and the other is told it is already sold. A listing lapses
// at the first midnight 14 days on, and the card comes home. What anyone sees: the public card, the seller's
// handle as listed, the terms and the day it was listed; recent sale prices name nobody.
import type {
  BuyResponse, ListCardRequest, ListingKind, ListingState, ListingView, MarketRequest, MarketResponse, MarketWant, SaleView,
} from '../../../plugin/hooks/core/api.ts'
import { ECONOMY } from '../../../plugin/hooks/core/economy.ts'
import { listingKind, wantMatches } from '../../../plugin/hooks/core/market.ts'
import { SPECIES_ID } from '../../../plugin/hooks/core/species.ts'
import type { Rarity } from '../../../plugin/hooks/core/types.ts'
import { seasonOf, utcDay } from '../../../plugin/hooks/core/world.ts'
import type { PlayerCtx } from '../app.ts'
import { guard, stmt } from '../db.ts'
import type { Db, SqlParam, Stmt } from '../db.ts'
import { fail } from '../http.ts'
import type { ListingRow } from '../schema.ts'
import { leaveTeam, mustBeTradeable, mustKeepTeam, seasonOfSpecies } from './collection.ts'
import { addDays, addSparks, bumpPlayer, commit, loadPlayer, mustAfford, newId, notFound, readJson } from './ctx.ts'
import type { Env } from './ctx.ts'
import { bumpCards, cardGuard, cardsByIds, ownCard, publicCard } from './mint.ts'
import type { StoredCard } from './mint.ts'
import { notice } from './notices.ts'
import { handOver, hold, release } from './social.ts'
import { sold } from './stats.ts'

const M = ECONOMY.market

/** The seller's news, in plain words; the buyer rides along as the notice's handle (SPEC 20: a sale is public). */
export const MARKET_TEXT = {
  sold: (price: number, swap: boolean) =>
    price > 0 ? `Your card sold for ${price} sparks${swap ? ' and a card' : ''}` : 'Your card sold for a card in return',
  expired: 'Your listing ran out of time, so your card is home again',
}

/** A listing's lapse day: it can be bought until the first UTC midnight at least 14 days on. */
export const listingExpiry = (now: number): string => addDays(utcDay(now + M.ttlMs), 1)

const wantOf = (l: Pick<ListingRow, 'want'>): MarketWant | undefined => readJson<MarketWant | undefined>(l.want, undefined)

/** A listing as anyone sees it, with its card's public view. */
export function listingView(l: ListingRow, card: StoredCard, state: ListingState = l.state as ListingState): ListingView {
  const want = wantOf(l)
  return { id: l.id, seller: l.seller_handle, card: publicCard(card.card), price: l.price, ...(want ? { want } : {}), day: l.created, state }
}

/** Open listings with their cards, in order; one whose card is not where it should be is left out. */
async function viewsOf(db: Db, rows: readonly ListingRow[]): Promise<ListingView[]> {
  const cards = await cardsByIds(db, rows.map(l => l.card_id))
  return rows.flatMap(l => {
    const c = cards.get(l.card_id)
    return c && c.owner === l.seller_id && c.card.state === 'escrow' && c.escrowRef === l.id ? [listingView(l, c)] : []
  })
}

/** The player's own open listings, newest first (MeResponse.listings). */
export async function listingsOf(db: Db, playerId: string): Promise<ListingView[]> {
  return viewsOf(db, await db.all<ListingRow>(
    `SELECT * FROM listings WHERE seller_id = ? AND state = 'open' ORDER BY created DESC, id DESC LIMIT ?`, playerId, M.open,
  ))
}

const openGuard = (l: Pick<ListingRow, 'id' | 'version'>): Stmt =>
  guard(`SELECT 1 FROM listings WHERE id = ? AND state = 'open' AND version = ?`, l.id, l.version)

const close = (l: Pick<ListingRow, 'id'>, state: ListingState, now: number): Stmt =>
  stmt('UPDATE listings SET state = ?, resolved = ?, version = version + 1 WHERE id = ?', state, utcDay(now), l.id)

// ---- listing -------------------------------------------------------------------------------------

/**
 * POST /v1/market: one tradeable card of the caller's (never bound, never held, never the last card on their team)
 * goes into escrow, off the team, for sparks and/or a wanted card. A wanted species must have appeared already.
 * The open listings a player may hold are a storage size, kept exact by the caller's version guard.
 */
export async function listCard(ctx: PlayerCtx, req: ListCardRequest): Promise<ListingView> {
  const p = ctx.player
  const c = await ownCard(ctx.db, p.id, req.cardId)
  mustBeTradeable(c)
  mustKeepTeam(p, c.card.id)
  if (req.want?.species !== undefined && seasonOfSpecies(req.want.species) > seasonOf(ctx.now)) fail('bad_request', 'That creature has not appeared yet')
  const open = (await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM listings WHERE seller_id = ? AND state = 'open'`, p.id))!.n
  if (open >= M.open) fail('cap_reached', `You have ${M.open} cards on the market: take one off to list another`)
  const id = newId(ctx)
  const price = req.price ?? 0
  const kind: ListingKind = listingKind(price, req.want)
  const row: ListingRow = {
    id, version: 0, seller_id: p.id, seller_handle: p.handle, card_id: c.card.id, species: c.card.species, family: c.card.family,
    rarity: c.card.rarity, shiny: c.card.shiny ? 1 : 0, foil: c.card.foil ? 1 : 0, price, want: req.want ? JSON.stringify(req.want) : null,
    kind, state: 'open', created: utcDay(ctx.now), expires: listingExpiry(ctx.now), resolved: null,
  }
  await commit(ctx, [
    cardGuard(c, 'owned'),
    hold(c, id),
    ...leaveTeam(p, [c.card.id]),
    bumpCards(p.id),
    stmt(
      `INSERT INTO listings (id, seller_id, seller_handle, card_id, species, family, rarity, shiny, foil, price, want, kind, created, expires)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, p.id, p.handle, row.card_id, row.species, row.family, row.rarity, row.shiny, row.foil, price, row.want, kind, row.created, row.expires,
    ),
  ])
  return listingView(row, { ...c, card: { ...c.card, state: 'escrow' } })
}

// ---- buying --------------------------------------------------------------------------------------

/**
 * A listing anyone may act on, by id: 404 when there is none. One past its day lapses on the spot (its card goes
 * home) and answers `expired`; a sold one answers `conflict` "Already sold".
 */
async function liveListing(ctx: PlayerCtx, id: string, mine: boolean): Promise<ListingRow> {
  const l = await ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', id)
  if (!l || (mine && l.seller_id !== ctx.player.id)) return notFound('listing')
  const lapsed = l.state === 'open' && utcDay(ctx.now) >= l.expires
  if (lapsed) await ctx.db.batch(expireListings(ctx, [l]))
  if (lapsed || l.state === 'expired') fail('expired', 'That listing ran out of time')
  if (l.state === 'sold') fail('conflict', 'Already sold')
  if (l.state !== 'open') fail('conflict', 'That listing was taken off the market')
  return l
}

/**
 * POST /v1/market/:listingId/buy. Anyone but the seller. A listing that wants a card takes exactly one of the
 * caller's that fits (tradeable, not their last team card); one that asks only for sparks takes none. One batch:
 * the listed card to the caller, the sparks to the seller in full, the caller's card to the seller, the listing
 * sold, the seller's sales count and a sale price kept without names (each once per buyer and season, the price only
 * for sparks alone), and the seller's notice.
 */
export async function buyListing(ctx: PlayerCtx, id: string, cardId: string | undefined): Promise<BuyResponse> {
  const p = ctx.player
  const l = await liveListing(ctx, id, false)
  if (l.seller_id === p.id) fail('not_allowed', 'That listing is yours: take it off the market instead')
  const listed = (await cardsByIds(ctx.db, [l.card_id])).get(l.card_id)
  if (!listed || listed.owner !== l.seller_id || listed.card.state !== 'escrow' || listed.escrowRef !== l.id) fail('conflict', 'Already sold')
  const want = wantOf(l)
  let given: StoredCard | null = null
  if (want) {
    if (cardId === undefined) fail('bad_request', 'Pick a card of yours that fits this listing')
    given = await ownCard(ctx.db, p.id, cardId)
    mustBeTradeable(given)
    if (!wantMatches(want, given.card)) fail('not_allowed', 'That card is not the one they want')
    mustKeepTeam(p, given.card.id)
  } else if (cardId !== undefined) fail('bad_request', 'This listing asks only for sparks')
  mustAfford(p, l.price)
  const seller = (await loadPlayer(ctx.db, l.seller_id)) ?? notFound('listing')
  const bought = handOver(listed, p.id, ctx.now)
  const paid = given ? handOver(given, seller.id, ctx.now) : null
  const day = utcDay(ctx.now)
  await commit(ctx, [
    guard(`SELECT 1 FROM listings WHERE id = ? AND state = 'open' AND version = ? AND expires > ?`, l.id, l.version, day),
    guard('SELECT 1 FROM players WHERE id = ?', seller.id),
    cardGuard(listed, 'escrow'),
    ...(given ? [cardGuard(given, 'owned')] : []),
    ...bought.stmts,
    ...(paid ? [...paid.stmts, ...leaveTeam(p, [given!.card.id])] : []),
    ...(l.price ? [addSparks(p.id, -l.price), addSparks(seller.id, l.price)] : []),
    // the sales count and the price record move once per buyer and season; only a sale for sparks alone has a price
    // that says what the card is worth (a card thrown in would not show)
    ...sold(seller.id, p.id, ctx.now, l.kind === 'sparks'
      ? { species: l.species, rarity: l.rarity, shiny: l.shiny, foil: l.foil, sparks: l.price }
      : null),
    // the seller's row moves (sparks, count, album), so a request of theirs read before this runs again
    bumpPlayer(seller.id),
    close(l, 'sold', ctx.now),
    bumpCards(p.id),
    bumpCards(seller.id),
    notice(ctx, seller.id, 'market-sold', MARKET_TEXT.sold(l.price, given !== null), { other: p.id }),
  ])
  return { listing: listingView(l, listed, 'sold'), card: bought.card, sparks: p.sparks - l.price }
}

// ---- taking it off, and time -------------------------------------------------------------------

/** POST /v1/market/:listingId/cancel: the seller only (anyone else's answers 404); the card comes home. */
export async function cancelListing(ctx: PlayerCtx, id: string): Promise<ListingView> {
  const p = ctx.player
  const l = await liveListing(ctx, id, true)
  const listed = (await cardsByIds(ctx.db, [l.card_id])).get(l.card_id)
  if (!listed || listed.owner !== p.id) fail('conflict', 'That listing was taken off the market')
  await commit(ctx, [openGuard(l), release(l.id, p.id), close(l, 'cancelled', ctx.now), bumpCards(p.id)])
  return listingView(l, { ...listed, card: { ...listed.card, state: 'owned' } }, 'cancelled')
}

/** Listings past their day: each card goes home to its seller, with word of it. */
export function expireListings(env: Env, rows: readonly ListingRow[]): Stmt[] {
  return rows.flatMap(l => [
    openGuard(l),
    release(l.id, l.seller_id),
    close(l, 'expired', env.now),
    bumpCards(l.seller_id),
    bumpPlayer(l.seller_id),
    notice(env, l.seller_id, 'market-expired', MARKET_TEXT.expired),
  ])
}

// ---- browsing ------------------------------------------------------------------------------------

const NEWEST_CURSOR = /^(\d{4}-\d{2}-\d{2})\.([a-z2-7]{26})$/
const PRICE_CURSOR = /^(0|[1-9]\d{0,6})\.([a-z2-7]{26})$/
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ')

/**
 * GET /v1/market: open listings in time, filtered and sorted (newest first by default; cheapest and priciest by
 * sparks, a card-only listing counting as 0), a page at a time with `next`. With each page, every season species
 * on it comes with its last few sales for sparks.
 */
export async function browse(ctx: PlayerCtx, q: MarketRequest): Promise<MarketResponse> {
  if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) fail('bad_request', 'The lowest price is above the highest')
  const where = [`state = 'open'`, 'expires > ?']
  const params: SqlParam[] = [utcDay(ctx.now)]
  const add = (sql: string, v: SqlParam) => { where.push(sql); params.push(v) }
  if (q.family !== undefined) add('family = ?', q.family)
  if (q.rarity !== undefined) add('rarity = ?', q.rarity)
  if (q.species !== undefined) add('species = ?', q.species)
  if (q.shiny !== undefined) add('shiny = ?', q.shiny)
  if (q.foil !== undefined) add('foil = ?', q.foil)
  if (q.kind !== undefined) add('kind = ?', q.kind)
  if (q.minPrice !== undefined) add('price >= ?', q.minPrice)
  if (q.maxPrice !== undefined) add('price <= ?', q.maxPrice)
  const sort = q.sort ?? 'newest'
  if (q.after !== undefined) {
    const at = (sort === 'newest' ? NEWEST_CURSOR : PRICE_CURSOR).exec(q.after) ?? fail('bad_request', 'Malformed cursor')
    const key = sort === 'newest' ? at[1]! : Number(at[1])
    const col = sort === 'newest' ? 'created' : 'price'
    where.push(sort === 'cheapest' ? `(${col} > ? OR (${col} = ? AND id > ?))` : `(${col} < ? OR (${col} = ? AND id < ?))`)
    params.push(key, key, at[2]!)
  }
  const order = sort === 'newest' ? 'created DESC, id DESC' : sort === 'cheapest' ? 'price ASC, id ASC' : 'price DESC, id DESC'
  const rows = await ctx.db.all<ListingRow>(`SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`, ...params, M.page + 1)
  const page = rows.slice(0, M.page)
  const last = page.at(-1)
  const next = rows.length > M.page && last ? `${sort === 'newest' ? last.created : last.price}.${last.id}` : null
  return { listings: await viewsOf(ctx.db, page), ...(next ? { next } : {}), prices: await recentPrices(ctx.db, page.map(l => l.species)) }
}

/** The last few sales for sparks of each season species, newest first. */
export async function recentPrices(db: Db, species: readonly string[]): Promise<MarketResponse['prices']> {
  const ids = [...new Set(species.filter(s => SPECIES_ID.test(s)))]
  if (!ids.length) return []
  const rows = await db.all<{ species: string; day: string; price: number; rarity: string; shiny: number; foil: number }>(
    `SELECT species, day, price, rarity, shiny, foil FROM (
       SELECT species, day, price, rarity, shiny, foil, ROW_NUMBER() OVER (PARTITION BY species ORDER BY day DESC, id DESC) AS n
       FROM market_sales WHERE price > 0 AND species IN (${marks(ids.length)})
     ) WHERE n <= ? ORDER BY species, n`,
    ...ids, M.recentSales,
  )
  const by = new Map<string, SaleView[]>()
  for (const r of rows) {
    const list = by.get(r.species) ?? []
    list.push({ day: r.day, price: r.price, rarity: r.rarity as Rarity, shiny: r.shiny === 1, foil: r.foil === 1 })
    by.set(r.species, list)
  }
  return ids.filter(s => by.has(s)).map(s => ({ species: s, sales: by.get(s)! }))
}

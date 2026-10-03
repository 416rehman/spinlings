// Trading between players (SPEC 8, 15, 16, 20, 24, 26): offers whose cards wait in escrow and
// swap in one batch, gifts by code, and what time does to both (expiry, the giver's bonus pack).
// Every check made here in plain code is made again by a guard in the batch that acts on it, and
// another player's offer or gift answers 404 exactly like a missing one. No account limits, fees
// or trade locks: only open-offer and open-gift storage and the claim brute-force cap. Bound cards
// (starters, bound drops) never trade: that is the card's own property.
import type { GiftView, OfferState, OfferView } from '../../../plugin/hooks/core/api.ts'
import { ECONOMY } from '../../../plugin/hooks/core/economy.ts'
import { FAMILIES } from '../../../plugin/hooks/core/families.ts'
import { pick } from '../../../plugin/hooks/core/rng.ts'
import type { Card } from '../../../plugin/hooks/core/types.ts'
import { utcDay } from '../../../plugin/hooks/core/world.ts'
import type { PlayerCtx } from '../app.ts'
import { guard, stmt } from '../db.ts'
import type { Db, Stmt } from '../db.ts'
import { fail, HttpError } from '../http.ts'
import type { ErrorCode } from '../http.ts'
import type { GiftRow, OfferRow, PlayerRow } from '../schema.ts'
import { leaveTeam, mustBeTradeable } from './collection.ts'
import { addDays, bumpPlayer, commit, DAY, dayStart, HOUR, loadPlayer, newGiftCode, newId, notFound, readJson, rngOf, setPlayer } from './ctx.ts'
import type { Env } from './ctx.ts'
import { bumpCards, cardGuard, cardsByIds, grantPack, offerViews, ownCard, ownCards, publicCard, saveCard } from './mint.ts'
import type { ArenaCounts, StoredCard } from './mint.ts'
import { notice } from './notices.ts'
import { albumAdd } from './stats.ts'

const TRADE = ECONOMY.trade
const GIFT = ECONOMY.gift

/**
 * Notice lines name nobody: the other player rides along as the notice's handle, always the current
 * one. News of an offer names its receiver only while they still have the handle it was sent to.
 */
export const SOCIAL_TEXT = {
  offerReceived: 'A trade offer arrived',
  countered: 'Your offer came back with a counter-offer',
  accepted: 'Your trade went through',
  declined: 'Your offer was declined, so your cards are home again',
  expired: 'Your offer ran out of time, so your cards are home again',
  giftClaimed: 'Your gift found a new home',
  giftReturned: 'Nobody claimed your gift in time, so it came home',
  bonusPack: 'Someone you sent a gift is playing: a bonus pack for you!',
}

export const playerByHandle = (db: Db, handle: string): Promise<PlayerRow | undefined> =>
  db.get<PlayerRow>('SELECT * FROM players WHERE handle = ?', handle)

// ---- times: the other side learns the day something happened, never the hour (SPEC 20.3) -------

/** An offer runs until the first UTC midnight at least 72 hours on. */
export const offerExpiry = (now: number): number => dayStart(utcDay(now + TRADE.expiryMs)) + DAY

/** A gift's lapse day: it can be claimed until the first UTC midnight at least 14 days on. */
export const giftExpiry = (now: number): string => addDays(utcDay(now + GIFT.ttlMs), 1)

const giftLive = (g: Pick<GiftRow, 'state' | 'expires'>, now: number): boolean => g.state === 'open' && utcDay(now) < g.expires

// ---- cards on the move -------------------------------------------------------------------------

const NO_ARENA: ArenaCounts = { haiku: 0, sonnet: 0, opus: 0, fable: 0 }

/** Held for an offer, a gift or a market listing (`ref`): out of every other action until it resolves. */
export const hold = (c: StoredCard, ref: string): Stmt => saveCard(c, { ...c.card, state: 'escrow' }, { escrowRef: ref })

/** Every card the owner holds for `ref` goes home. */
export const release = (ref: string, owner: string): Stmt =>
  stmt(`UPDATE cards SET state = 'owned', escrow_ref = NULL, version = version + 1 WHERE escrow_ref = ? AND owner_id = ? AND state = 'escrow'`, ref, owner)

/**
 * A card changing hands (SPEC 8): home with its new owner, off the trade list, rested, free to trade
 * again at once, and its species in the new owner's album. It arrives as a gift made today, with its
 * arena counts and raised form gone, so nothing on it tells the new owner when or how the last one
 * got it, or which arenas (which model) they battled in (SPEC 18, 20.2, 20.3).
 */
export function handOver(c: StoredCard, to: string, now: number): { card: Card; stmts: Stmt[] } {
  const { raisedIn: _, ...kept } = c.card
  const card: Card = {
    ...kept, state: 'owned', forTrade: false, tiredUntil: 0, lockedUntil: 0, origin: 'gift', mintedAt: dayStart(utcDay(now)),
  }
  return { card, stmts: [saveCard(c, card, { owner: to, escrowRef: null, arena: NO_ARENA }), ...albumAdd(to, c.card.species, now)] }
}

// ---- offers ------------------------------------------------------------------------------------

const idsOf = (list: string): string[] => readJson<string[]>(list, [])

/** For accept, decline, counter and cancel: still open, unchanged and in time. */
const liveGuard = (o: OfferRow, now: number): Stmt =>
  guard(`SELECT 1 FROM offers WHERE id = ? AND state = 'open' AND version = ? AND expires_at > ?`, o.id, o.version, now)

const settle = (o: OfferRow, state: OfferState, now: number): Stmt =>
  stmt('UPDATE offers SET state = ?, resolved = ?, version = version + 1 WHERE id = ?', state, utcDay(now), o.id)

/** Offers past their time: the sender's cards come home, with word of it. */
export function expireOffers(env: Env, rows: readonly OfferRow[]): Stmt[] {
  return rows.flatMap(o => [
    guard(`SELECT 1 FROM offers WHERE id = ? AND state = 'open' AND version = ?`, o.id, o.version),
    release(o.id, o.from_id),
    settle(o, 'expired', env.now),
    bumpCards(o.from_id),
    notice(env, o.from_id, 'offer-expired', SOCIAL_TEXT.expired, { other: o.to_id, knownAs: o.to_handle }),
  ])
}

/**
 * The caller's open offer, as its receiver (accept, decline, counter) or its sender (cancel). Anyone
 * else's is a 404 (SPEC 26); a settled one is a conflict; one past its time expires on the spot.
 */
export async function liveOffer(ctx: PlayerCtx, id: string, as: 'from' | 'to'): Promise<OfferRow> {
  const o = await ctx.db.get<OfferRow>('SELECT * FROM offers WHERE id = ?', id)
  if (!o || (as === 'to' ? o.to_id : o.from_id) !== ctx.player.id) return notFound('offer')
  const lapsed = o.state === 'open' && o.expires_at <= ctx.now
  if (lapsed) await ctx.db.batch(expireOffers(ctx, [o]))
  if (lapsed || o.state === 'expired') fail('expired', 'That offer ran out of time')
  if (o.state !== 'open') fail('conflict', 'That offer is already settled')
  return o
}

/**
 * What an offer may ask for: the receiver's cards on their trade list, the only ones their profile
 * shows; a counter-offer may also ask for the cards coming home from the offer it answers.
 */
function askable(c: StoredCard | undefined, owner: string, answering?: OfferRow): c is StoredCard {
  if (!c || c.owner !== owner || c.card.bound) return false
  if (answering && c.card.state === 'escrow' && c.escrowRef === answering.id) return true
  return c.card.state === 'owned' && c.card.forTrade
}

export type Outgoing = { to: PlayerRow; give: StoredCard[]; get: StoredCard[] }

/** An offer the caller wants to send: the open offers it may hold (storage), then every card. */
export async function checkOffer(ctx: PlayerCtx, to: PlayerRow, giveIds: readonly string[], getIds: readonly string[], answering?: OfferRow): Promise<Outgoing> {
  const p = ctx.player
  if (to.id === p.id) fail('not_allowed', 'A trade takes two players')
  const open = (await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM offers WHERE from_id = ? AND state = 'open'`, p.id))!.n
  if (open >= TRADE.openOutgoing) fail('cap_reached', `You have ${TRADE.openOutgoing} offers waiting: cancel one to send another`)
  const give = await ownCards(ctx.db, p.id, giveIds)
  for (const c of give) mustBeTradeable(c)
  const found = await cardsByIds(ctx.db, getIds)
  const get = getIds.map(id => {
    const c = found.get(id)
    return askable(c, to.id, answering) ? c : notFound('card')
  })
  return { to, give, get }
}

/**
 * The writes that send it: the caller's cards held for it (and off the team), the offer row and word
 * to the receiver. The caller's version guard (commit) keeps the open-offer count exact.
 */
export function sendOffer(ctx: PlayerCtx, o: Outgoing, text: string): { view: OfferView; stmts: Stmt[] } {
  const p = ctx.player
  const id = newId(ctx)
  const day = utcDay(ctx.now)
  const expiresAt = offerExpiry(ctx.now)
  const giveIds = o.give.map(c => c.card.id)
  return {
    view: {
      id, from: p.handle, to: o.to.handle, give: o.give.map(c => publicCard(c.card)), get: o.get.map(c => publicCard(c.card)),
      state: 'open', createdAt: dayStart(day), expiresAt,
    },
    stmts: [
      guard('SELECT 1 FROM players WHERE id = ?', o.to.id),
      ...o.give.map(c => cardGuard(c, 'owned')),
      ...o.give.map(c => hold(c, id)),
      ...leaveTeam(p, giveIds),
      bumpCards(p.id),
      stmt('INSERT INTO offers (id, from_id, to_id, from_handle, to_handle, give, get, created, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, p.id, o.to.id, p.handle, o.to.handle, JSON.stringify(giveIds), JSON.stringify(o.get.map(c => c.card.id)), day, expiresAt),
      notice(ctx, o.to.id, 'offer-received', text, { other: p.id }),
    ],
  }
}

/**
 * Accepting (SPEC 8): the offered cards are still held for it and every card asked for is still the
 * caller's and free to trade. Then everything moves at once, with no fee; if anything changed
 * meanwhile, the batch fails and the handler re-runs.
 */
export async function acceptOffer(ctx: PlayerCtx, o: OfferRow): Promise<OfferView> {
  const p = ctx.player
  const from = (await loadPlayer(ctx.db, o.from_id)) ?? notFound('offer')
  const giveIds = idsOf(o.give), getIds = idsOf(o.get)
  const cards = await cardsByIds(ctx.db, [...giveIds, ...getIds])
  const give = giveIds.map(id => cards.get(id)).filter((c): c is StoredCard => c?.owner === o.from_id && c.card.state === 'escrow' && c.escrowRef === o.id)
  if (give.length !== giveIds.length) fail('conflict', 'Those cards are no longer on offer')
  const get = getIds.map(id => cards.get(id)).filter((c): c is StoredCard => c?.owner === p.id)
  if (get.length !== getIds.length) fail('conflict', 'You no longer have every card they asked for')
  for (const c of get) mustBeTradeable(c)
  const moves = [...give.map(c => handOver(c, p.id, ctx.now)), ...get.map(c => handOver(c, from.id, ctx.now))]
  await commit(ctx, [
    liveGuard(o, ctx.now),
    guard('SELECT 1 FROM players WHERE id = ?', from.id),
    ...give.map(c => cardGuard(c, 'escrow')),
    ...get.map(c => cardGuard(c, 'owned')),
    ...moves.flatMap(m => m.stmts),
    ...leaveTeam(p, getIds),
    // the sender's album (and its count) may change, so their version moves
    bumpPlayer(from.id),
    settle(o, 'accepted', ctx.now),
    bumpCards(p.id),
    bumpCards(from.id),
    notice(ctx, from.id, 'offer-accepted', SOCIAL_TEXT.accepted, { other: p.id, knownAs: o.to_handle }),
  ])
  return {
    id: o.id, from: o.from_handle, to: o.to_handle, give: give.map(c => publicCard(c.card)), get: get.map(c => publicCard(c.card)),
    state: 'accepted', createdAt: dayStart(o.created), expiresAt: o.expires_at,
  }
}

/** Declining: the sender's cards come home, with word of it. */
export async function declineOffer(ctx: PlayerCtx, o: OfferRow): Promise<OfferView> {
  await ctx.db.batch([
    liveGuard(o, ctx.now), release(o.id, o.from_id), settle(o, 'declined', ctx.now), bumpCards(o.from_id),
    notice(ctx, o.from_id, 'offer-declined', SOCIAL_TEXT.declined, { other: o.to_id, knownAs: o.to_handle }),
  ])
  return (await offerViews(ctx.db, [{ ...o, state: 'declined' }]))[0]!
}

/** Cancelling: the caller's own cards come home; the offer simply leaves the receiver's inbox. */
export async function cancelOffer(ctx: PlayerCtx, o: OfferRow): Promise<OfferView> {
  await ctx.db.batch([liveGuard(o, ctx.now), release(o.id, o.from_id), settle(o, 'cancelled', ctx.now), bumpCards(o.from_id)])
  return (await offerViews(ctx.db, [{ ...o, state: 'cancelled' }]))[0]!
}

/**
 * A counter declines the offer and sends a new one with the roles swapped, in one batch. It goes to
 * the handle the offer came from, so a sender who has rerolled since is never named by the new one.
 */
export async function counterOffer(ctx: PlayerCtx, o: OfferRow, giveIds: readonly string[], getIds: readonly string[]): Promise<OfferView> {
  const sender = (await loadPlayer(ctx.db, o.from_id)) ?? notFound('offer')
  const sent = sendOffer(ctx, await checkOffer(ctx, { ...sender, handle: o.from_handle }, giveIds, getIds, o), SOCIAL_TEXT.countered)
  await commit(ctx, [liveGuard(o, ctx.now), release(o.id, o.from_id), settle(o, 'declined', ctx.now), bumpCards(o.from_id), ...sent.stmts])
  return sent.view
}

// ---- gifts -------------------------------------------------------------------------------------

const giftGuard = (g: GiftRow): Stmt => guard(`SELECT 1 FROM gifts WHERE code = ? AND state = 'open' AND version = ?`, g.code, g.version)

/** POST /v1/gifts (SPEC 8): one tradeable card held under a fresh code, valid for 14 days. */
export async function makeGift(ctx: PlayerCtx, cardId: string): Promise<GiftView> {
  const p = ctx.player
  const c = await ownCard(ctx.db, p.id, cardId)
  mustBeTradeable(c)
  const open = (await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM gifts WHERE giver_id = ? AND state = 'open'`, p.id))!.n
  if (open >= GIFT.open) fail('cap_reached', `You have ${GIFT.open} gifts waiting to be claimed`)
  // a code already in use is a unique-key Conflict: the handler re-runs and draws another
  const code = newGiftCode(ctx)
  const day = utcDay(ctx.now)
  const expires = giftExpiry(ctx.now)
  await commit(ctx, [
    cardGuard(c, 'owned'), hold(c, code), ...leaveTeam(p, [c.card.id]), bumpCards(p.id),
    stmt('INSERT INTO gifts (code, giver_id, card_id, created, expires) VALUES (?, ?, ?, ?, ?)', code, p.id, c.card.id, day, expires),
  ])
  return { code, card: { ...c.card, state: 'escrow' }, createdAt: dayStart(day), expiresAt: dayStart(expires) }
}

/** Only the giver can take a gift back, while nobody has claimed it. */
export async function cancelGift(ctx: PlayerCtx, code: string): Promise<GiftView> {
  const p = ctx.player
  const g = await ctx.db.get<GiftRow>('SELECT * FROM gifts WHERE code = ?', code)
  if (!g || g.giver_id !== p.id) return notFound('gift')
  if (g.state !== 'open') fail('conflict', 'That gift is already settled')
  await ctx.db.batch([
    giftGuard(g), release(g.code, p.id),
    stmt(`UPDATE gifts SET state = 'cancelled', resolved = ?, version = version + 1 WHERE code = ?`, utcDay(ctx.now), g.code),
    bumpCards(p.id),
  ])
  return { code: g.code, card: (await ownCard(ctx.db, p.id, g.card_id)).card, createdAt: dayStart(g.created), expiresAt: dayStart(g.expires) }
}

/**
 * POST /v1/claim (SPEC 8): open to everyone but the giver (the invite loop). Every
 * attempt, right or wrong, spends one of 5 tries an hour, counted exactly on the player row. A wrong,
 * spent and lapsed code answer alike. The giver's bonus waits for a claimant who joined after the gift.
 */
export async function claimGift(ctx: PlayerCtx, code: string): Promise<Card> {
  const p = ctx.player
  const hour = Math.floor(ctx.now / HOUR)
  const tries = p.claim_hour === hour ? p.claim_tries : 0
  if (tries >= GIFT.claimsPerHour) {
    throw new HttpError('rate_limited', 'That is a lot of tries: wait a little', 429, { 'Retry-After': String(Math.ceil(((hour + 1) * HOUR - ctx.now) / 1000)) })
  }
  const spend = setPlayer(p.id, { claim_hour: hour, claim_tries: tries + 1 })
  const refuse = async (code: ErrorCode, message: string): Promise<never> => {
    await commit(ctx, [spend])
    return fail(code, message)
  }
  const g = await ctx.db.get<GiftRow>('SELECT * FROM gifts WHERE code = ?', code)
  if (g && g.claimed_by === p.id) return refuse('conflict', 'You already claimed this gift')
  if (!g || !giftLive(g, ctx.now)) return refuse('not_found', 'No gift has that code')
  if (g.giver_id === p.id) return refuse('not_allowed', 'This gift is yours: send the code to a friend')
  const held = (await cardsByIds(ctx.db, [g.card_id])).get(g.card_id)
  if (!held || held.owner !== g.giver_id || held.card.state !== 'escrow' || held.escrowRef !== g.code) return refuse('not_found', 'No gift has that code')
  const moved = handOver(held, p.id, ctx.now)
  const day = utcDay(ctx.now)
  await commit(ctx, [
    spend,
    guard(`SELECT 1 FROM gifts WHERE code = ? AND state = 'open' AND version = ? AND expires > ?`, g.code, g.version, day),
    cardGuard(held, 'escrow'),
    ...moved.stmts,
    stmt(`UPDATE gifts SET state = 'claimed', claimed_by = ?, resolved = ?, bonus = ?, version = version + 1 WHERE code = ?`,
      p.id, day, p.joined >= g.created ? 1 : 0, g.code),
    bumpCards(p.id),
    bumpCards(g.giver_id),
    notice(ctx, g.giver_id, 'gift-claimed', SOCIAL_TEXT.giftClaimed, { other: p.id }),
  ])
  return moved.card
}

/** Gifts past their lapse day: the card goes home to the giver, with word of it. */
export function returnGifts(env: Env, rows: readonly GiftRow[]): Stmt[] {
  return rows.flatMap(g => [
    giftGuard(g),
    release(g.code, g.giver_id),
    stmt(`UPDATE gifts SET state = 'returned', resolved = ?, version = version + 1 WHERE code = ?`, utcDay(env.now), g.code),
    bumpCards(g.giver_id),
    notice(env, g.giver_id, 'gift-returned', SOCIAL_TEXT.giftReturned),
  ])
}

/**
 * The giver's bonus pack (SPEC 8, 24), once per gift, when its claimant has really played. The notice
 * names nobody: who is playing, and how much, stays the claimant's own (SPEC 20.3).
 */
export function giftBonuses(env: Env, rows: readonly GiftRow[]): Stmt[] {
  const rng = rngOf(env)
  return rows.flatMap(g => [
    guard('SELECT 1 FROM gifts WHERE code = ? AND bonus = 1 AND version = ?', g.code, g.version),
    stmt('UPDATE gifts SET bonus = 2, version = version + 1 WHERE code = ?', g.code),
    grantPack(env, g.giver_id, pick(rng, FAMILIES), 'bonus').stmt,
    notice(env, g.giver_id, 'bonus-pack', SOCIAL_TEXT.bonusPack),
  ])
}

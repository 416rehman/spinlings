// Time passing for offers, gifts and market listings (SPEC 8, 20.4): the player's touch settles their
// own lapsed offers (either side), gifts and listings; the hourly sweep settles the rest for players
// who stopped coming back, so retention can delete them 30 days on. Gift bonus packs go out only with the first sweep
// of each UTC day, so a giver learns at most that their claimant played "some time yesterday",
// never when (SPEC 20.3).
import { ECONOMY } from '../../../plugin/hooks/core/economy.ts'
import { utcDay } from '../../../plugin/hooks/core/world.ts'
import type { PlayerCtx } from '../app.ts'
import { Conflict } from '../db.ts'
import type { Db, Stmt } from '../db.ts'
import type { GiftRow, ListingRow, OfferRow } from '../schema.ts'
import { HOUR } from './ctx.ts'
import type { Env } from './ctx.ts'
import { expireListings } from './market.ts'
import { expireOffers, giftBonuses, returnGifts } from './social.ts'

/** At most this many offers, gifts and listings settle per touch or per sweep; the rest wait for the next. */
const BATCH = { touch: 10, sweep: 200 }

const { bonusBattles, bonusDays } = ECONOMY.gift

/** One indexed query when nothing is due (the usual case), the writes otherwise. */
export async function socialTouch(ctx: PlayerCtx): Promise<Stmt[]> {
  const { db, now } = ctx
  const id = ctx.player.id
  const day = utcDay(now)
  const due = (await db.get<{ offers: number; gifts: number; listings: number }>(
    `SELECT EXISTS (SELECT 1 FROM offers WHERE from_id = ? AND state = 'open' AND expires_at <= ?)
         OR EXISTS (SELECT 1 FROM offers WHERE to_id = ? AND state = 'open' AND expires_at <= ?) AS offers,
       EXISTS (SELECT 1 FROM gifts WHERE giver_id = ? AND state = 'open' AND expires <= ?) AS gifts,
       EXISTS (SELECT 1 FROM listings WHERE seller_id = ? AND state = 'open' AND expires <= ?) AS listings`,
    id, now, id, now, id, day, id, day,
  ))!
  if (!due.offers && !due.gifts && !due.listings) return []
  const offers = due.offers
    ? await db.all<OfferRow>(`SELECT * FROM offers WHERE (from_id = ? OR to_id = ?) AND state = 'open' AND expires_at <= ? LIMIT ?`, id, id, now, BATCH.touch)
    : []
  const gifts = due.gifts
    ? await db.all<GiftRow>(`SELECT * FROM gifts WHERE giver_id = ? AND state = 'open' AND expires <= ? LIMIT ?`, id, day, BATCH.touch)
    : []
  const listings = due.listings
    ? await db.all<ListingRow>(`SELECT * FROM listings WHERE seller_id = ? AND state = 'open' AND expires <= ? LIMIT ?`, id, day, BATCH.touch)
    : []
  return [...expireOffers(ctx, offers), ...returnGifts(ctx, gifts), ...expireListings(ctx, listings)]
}

/** The first sweep of a UTC day: the Worker's cron runs at :17 past each hour, the Node timer hourly. */
export const firstSweepOfDay = (now: number): boolean => now % (24 * HOUR) < HOUR

/**
 * The hourly sweep (api.onSweep): one batch per offer, gift or listing, so one a player settles
 * meanwhile costs only itself. Only rows whose owner exists (deleting a player takes their offers,
 * gifts and listings along in the same batch, so no others occur), so no notice is ever written for
 * nobody.
 */
export async function sweepSocial(db: Db, now: number): Promise<void> {
  const env: Env = { db, now, randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }
  const offers = await db.all<OfferRow>(
    `SELECT o.* FROM offers o JOIN players p ON p.id = o.from_id WHERE o.state = 'open' AND o.expires_at <= ? ORDER BY o.expires_at LIMIT ?`,
    now, BATCH.sweep)
  const gifts = await db.all<GiftRow>(
    `SELECT g.* FROM gifts g JOIN players p ON p.id = g.giver_id WHERE g.state = 'open' AND g.expires <= ? ORDER BY g.expires LIMIT ?`,
    utcDay(now), BATCH.sweep)
  const listings = await db.all<ListingRow>(
    `SELECT l.* FROM listings l JOIN players p ON p.id = l.seller_id WHERE l.state = 'open' AND l.expires <= ? ORDER BY l.expires LIMIT ?`,
    utcDay(now), BATCH.sweep)
  const bonus = firstSweepOfDay(now)
    ? await db.all<GiftRow>(
      `SELECT g.* FROM gifts g JOIN players giver ON giver.id = g.giver_id JOIN players c ON c.id = g.claimed_by
       WHERE g.state = 'claimed' AND g.bonus = 1 AND c.battles >= ? AND c.battle_days >= ? LIMIT ?`,
      bonusBattles, bonusDays, BATCH.sweep)
    : []
  const batches = [
    ...offers.map(o => expireOffers(env, [o])), ...gifts.map(g => returnGifts(env, [g])), ...listings.map(l => expireListings(env, [l])),
    ...bonus.map(g => giftBonuses(env, [g])),
  ]
  for (const stmts of batches) {
    await db.batch(stmts).catch((err: unknown) => {
      if (!(err instanceof Conflict)) throw err
    })
  }
}

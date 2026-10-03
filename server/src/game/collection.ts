// The collection's rules over the scaffold (SPEC 4, 6, 8, 19, 24, 25, 26): which cards an action may
// take, the team they leave, the pack bank, today's Trader stock and drops by code. Every check made
// here in plain code is made again by a guard in the batch that acts on it.
import type { TraderDealView } from '../../../plugin/hooks/core/api.ts'
import { dropItems, normalizeDropCode } from '../../../plugin/hooks/core/drops.ts'
import { ECONOMY } from '../../../plugin/hooks/core/economy.ts'
import { parseDropReward } from '../../../plugin/hooks/core/schemas.ts'
import { sha256Hex } from '../../../plugin/hooks/core/sha256.ts'
import { SPECIES_ID } from '../../../plugin/hooks/core/species.ts'
import { traderDeals } from '../../../plugin/hooks/core/trader.ts'
import type { DropReward } from '../../../plugin/hooks/core/types.ts'
import { utcDay } from '../../../plugin/hooks/core/world.ts'
import { guard, stmt } from '../db.ts'
import type { Db, Stmt } from '../db.ts'
import { fail } from '../http.ts'
import type { DropRow, PackRow, PlayerRow } from '../schema.ts'
import { setPlayer, teamOf } from './ctx.ts'
import { bumpCards, cardGuard, deleteCard } from './mint.ts'
import type { StoredCard } from './mint.ts'

// ---- which cards an action may take ------------------------------------------------------------

/** Team, for-trade and every other card action: not while it is held for an offer, a gift or the market. */
export function mustBeHome(c: StoredCard): void {
  if (c.card.state !== 'owned') fail('not_allowed', 'That card is held for a trade, a gift or the market')
}

/** Fuse, recycle and the Trader: home, and not bound (starters and keepsakes stay for good). */
export function mustBeFree(c: StoredCard): void {
  mustBeHome(c)
  if (c.card.bound) fail('not_allowed', 'That card stays with you for good')
}

/** Offers, gifts and the market: free. No card ever waits to trade (SPEC 8). */
export function mustBeTradeable(c: StoredCard): void {
  mustBeFree(c)
}

/** A card leaving for the market may not empty the team: a saved team is what defends (SPEC 5). */
export function mustKeepTeam(p: Pick<PlayerRow, 'team'>, id: string): void {
  const team = teamOf(p)
  if (team.length === 1 && team[0] === id) fail('not_allowed', 'That is your last team card: put another one on your team first')
}

/** The team without these cards: one write when any of them was on it. */
export function leaveTeam(p: Pick<PlayerRow, 'id' | 'team'>, ids: readonly string[]): Stmt[] {
  const team = teamOf(p)
  const kept = team.filter(id => !ids.includes(id))
  return kept.length === team.length ? [] : [setPlayer(p.id, { team: JSON.stringify(kept), team_size: kept.length })]
}

/**
 * Consumes the player's cards (fusion parents, recycling, Trader payments): each guarded as still
 * theirs, at home and unchanged, then deleted; they leave the team and the collection version moves.
 */
export function takeCards(p: Pick<PlayerRow, 'id' | 'team'>, cards: readonly StoredCard[]): Stmt[] {
  return [
    ...cards.map(c => cardGuard(c, 'owned')),
    ...cards.map(c => deleteCard(c.card.id)),
    ...leaveTeam(p, cards.map(c => c.card.id)),
    bumpCards(p.id),
  ]
}

// ---- species ids -------------------------------------------------------------------------------

/** The season a species id names, read from the id alone, so a far-off season is never generated to check it. */
export const seasonOfSpecies = (id: string): number => Number(SPECIES_ID.exec(id)?.[1] ?? 0)

// ---- packs -------------------------------------------------------------------------------------

export function ownPack(db: Db, owner: string, id: string): Promise<PackRow | undefined> {
  return db.get<PackRow>('SELECT * FROM packs WHERE id = ? AND owner_id = ?', id, owner)
}

/** Aborts a charge's batch once the bank of 12 unopened packs is full (SPEC 6), whoever else added one. */
export const bankGuard = (owner: string): Stmt =>
  guard('SELECT COUNT(*) < ? FROM packs WHERE owner_id = ?', ECONOMY.packs.bank, owner)

/** Aborts an opening's batch unless the pack is still there and still the caller's. */
export const packGuard = (owner: string, id: string): Stmt => guard('SELECT 1 FROM packs WHERE id = ? AND owner_id = ?', id, owner)

/** Opening deletes the row, so the pack's family lives no longer than the pack (SPEC 20.2). */
export const deletePack = (id: string): Stmt => stmt('DELETE FROM packs WHERE id = ?', id)

// ---- the Wandering Trader (SPEC 19) ------------------------------------------------------------

/** Today's three deals, each marked once this player has used it today. */
export async function traderView(db: Db, playerId: string, now: number): Promise<TraderDealView[]> {
  const rows = await db.all<{ deal: number }>('SELECT deal FROM trader_uses WHERE player_id = ? AND day = ?', playerId, utcDay(now))
  const used = new Set(rows.map(r => r.deal))
  return traderDeals(now).map((d, k) => ({ ...d, used: used.has(k) }))
}

/** One use of today's deal `k`; a second one for the same day is a unique-key Conflict. */
export const useDeal = (playerId: string, now: number, k: number): Stmt =>
  stmt('INSERT INTO trader_uses (player_id, day, deal) VALUES (?, ?, ?)', playerId, utcDay(now), k)

// ---- drops (SPEC 25) ---------------------------------------------------------------------------

/** A drop by its code: a public vanity code first, then a unique code's hash. */
export async function dropByCode(db: Db, code: string): Promise<DropRow | undefined> {
  const normal = normalizeDropCode(code)
  return await db.get<DropRow>('SELECT * FROM drops WHERE code_plain = ?', normal)
    ?? db.get<DropRow>('SELECT * FROM drops WHERE code_hash = ?', sha256Hex(normal))
}

export const dropLive = (d: Pick<DropRow, 'starts_at' | 'ends_at'>, now: number): boolean => d.starts_at <= now && now < d.ends_at

/** RedeemResponse carries at most 20 packs, while the admin schema allows 8 items of 3 packs each. */
const MAX_PACKS = 20

/** The drop's reward, checked by the strict admin schema; null when the row holds anything else. */
export function dropReward(d: Pick<DropRow, 'reward_json'>): DropReward | null {
  let reward: DropReward
  try {
    reward = parseDropReward(JSON.parse(d.reward_json))
  } catch {
    return null
  }
  const packs = dropItems(reward).reduce((n, i) => n + (i.type === 'pack' ? i.count : 0), 0)
  return packs <= MAX_PACKS ? reward : null
}

/**
 * The redemption's own writes: the drop's count, guarded on its window and supply, and the one
 * redemption per player (a second is a unique-key Conflict).
 */
export function redeemStmts(d: DropRow, playerId: string, now: number): Stmt[] {
  return [
    guard('SELECT 1 FROM drops WHERE id = ? AND starts_at <= ? AND ends_at > ? AND (supply IS NULL OR redeemed < supply)', d.id, now, now),
    stmt('UPDATE drops SET redeemed = redeemed + 1 WHERE id = ?', d.id),
    stmt('INSERT INTO redemptions (drop_id, player_id, day) VALUES (?, ?, ?)', d.id, playerId, utcDay(now)),
  ]
}

// What the public pages read, and nothing more (SPEC 20.3, 20.8, 26.4): a profile's allowed
// fields, a card's public face, an open gift's card, a public drop's counts and the Mythics list
// as handle plus name. Each returns null where the page should say "not here", whether the thing
// never existed, belongs to nobody any more or simply is not open.
import type { BoardName, BoardPeriod, ListingView, MarketRequest, MarketResponse, ProfileResponse, RankingsResponse } from '../../plugin/hooks/core/api.ts'
import type { BattleCard, DropReward } from '../../plugin/hooks/core/types.ts'
import { normalizeDropCode } from '../../plugin/hooks/core/drops.ts'
import { DROP_CODE_RE, GIFT_CODE_RE, HANDLE_RE, ID_RE, parseDropReward } from '../../plugin/hooks/core/schemas.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import type { PlayerCtx } from './app.ts'
import type { Db } from './db.ts'
import { teamOf } from './game/ctx.ts'
import { browse, listingExpiry, listingsOf } from './game/market.ts'
import { cardsByIds, publicCard, queryCards } from './game/mint.ts'
import { profileOf } from './game/social-board.ts'
import { rankings } from './game/stats.ts'
import type { DropRow, GiftRow, PlayerRow } from './schema.ts'

export const MYTHICS_SHOWN = 12
export const FOR_TRADE_SHOWN = 24
export const LISTINGS_SHOWN = 12

/** The Mythics found, newest first: name and the finder's handle while it is still theirs, nothing else (SPEC 18, 20.8). */
export type MythicsShown = {
  /** handle is the finder's while it is the one they found it under, null once they rerolled it or left */
  mythics: { name: string; handle: string | null }[]
  mythicCount: number
}

export async function mythicsShown(db: Db): Promise<MythicsShown> {
  const [mythics, count] = await Promise.all([
    // the finder's current handle, read now, and only while it is the one the Mythic was found under
    db.all<{ name: string; handle: string | null }>(
      `SELECT m.name, p.handle FROM mythics m LEFT JOIN players p ON p.id = m.finder_id AND p.handle = m.handle
       ORDER BY m.day DESC, m.card_id LIMIT ?`,
      MYTHICS_SHOWN,
    ),
    db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mythics'),
  ])
  return { mythics, mythicCount: count?.n ?? 0 }
}

/** Exactly ProfileResponse's fields (SPEC 20.3), the API's own profile with fewer cards for trade. */
export const profile = (db: Db, handle: string, now: number): Promise<ProfileResponse | null> =>
  HANDLE_RE.test(handle) ? profileOf(db, handle, now, FOR_TRADE_SHOWN) : Promise.resolve(null)

/** Any card by id, as other players see it: no owner, no timestamps, no locks (SPEC 20.3). */
export async function publicCardById(db: Db, id: string): Promise<BattleCard | null> {
  if (!ID_RE.test(id)) return null
  const c = (await queryCards(db, 'SELECT * FROM cards WHERE id = ?', id))[0]
  return c ? publicCard(c.card) : null
}

/** An open, unexpired gift's card; never who gave it (SPEC 20.8). */
export async function openGift(db: Db, code: string, now: number): Promise<BattleCard | null> {
  if (!GIFT_CODE_RE.test(code)) return null
  const g = await db.get<GiftRow>('SELECT * FROM gifts WHERE code = ?', code)
  if (!g || g.state !== 'open' || g.expires <= utcDay(now)) return null
  const c = (await cardsByIds(db, [g.card_id])).get(g.card_id)
  if (!c || c.owner !== g.giver_id || c.card.state !== 'escrow' || c.escrowRef !== g.code) return null
  return publicCard(c.card)
}

export type Drop = {
  code: string
  reward: DropReward
  redeemed: number
  supply: number | null
  /** its cards can never be traded, gifted or recycled */
  bound: boolean
  ended: boolean
}

/**
 * A public (vanity-code) drop that has started: its reward and counts only, never who redeemed
 * (SPEC 25). Unique codes have no page, and an unknown code, a unique code and one not yet open
 * look the same.
 */
export async function publicDrop(db: Db, code: string, now: number): Promise<Drop | null> {
  if (code.length > 40 || !DROP_CODE_RE.test(code)) return null
  const norm = normalizeDropCode(code)
  const d = await db.get<DropRow>('SELECT * FROM drops WHERE code_plain = ?', norm)
  if (!d || d.starts_at > now) return null
  let reward: DropReward
  try {
    reward = parseDropReward(JSON.parse(d.reward_json))
  } catch {
    return null
  }
  const gone = d.supply !== null && d.redeemed >= d.supply
  return { code: norm, reward, redeemed: d.redeemed, supply: d.supply, bound: d.bound === 1, ended: now >= d.ends_at || gone }
}

// ---- the boards and the market -------------------------------------------------------------------

/** Nobody: the boards as a visitor sees them, with no row of their own (no player has an empty id). */
const VISITOR = { id: '', handle: '' } as PlayerRow

/** One board, top 50, by the numbers of the last UTC midnight; hidden players are never on it (SPEC 8, 20). */
export const board = (db: Db, name: BoardName, period: BoardPeriod, now: number): Promise<RankingsResponse> =>
  rankings(db, VISITOR, name, period, now)

/** The lead creature of each handle's saved team (public on their profile already), for the podium. */
export async function leadsOf(db: Db, handles: readonly string[]): Promise<Map<string, BattleCard>> {
  const out = new Map<string, BattleCard>()
  if (!handles.length) return out
  const rows = await db.all<Pick<PlayerRow, 'id' | 'handle' | 'team'>>(
    `SELECT id, handle, team FROM players WHERE handle IN (${handles.map(() => '?').join(', ')})`, ...handles,
  )
  const lead = new Map(rows.flatMap(r => {
    const id = teamOf(r)[0]
    return id ? [[id, r] as const] : []
  }))
  const cards = await cardsByIds(db, [...lead.keys()])
  for (const [id, r] of lead) {
    const c = cards.get(id)
    if (c && c.owner === r.id) out.set(r.handle, publicCard(c.card))
  }
  return out
}

const NEWEST_CURSOR = /^\d{4}-\d{2}-\d{2}\.[a-z2-7]{26}$/
const PRICE_CURSOR = /^(0|[1-9]\d{0,6})\.[a-z2-7]{26}$/

/**
 * One page of the open market, exactly as GET /v1/market answers anyone: public cards, the seller's handle as
 * listed, the terms and the day. A cursor that does not fit the sort starts from the top instead of failing.
 */
export function marketPage(db: Db, now: number, q: MarketRequest): Promise<MarketResponse> {
  const fits = q.after !== undefined && ((q.sort ?? 'newest') === 'newest' ? NEWEST_CURSOR : PRICE_CURSOR).test(q.after)
  const { after: _, ...rest } = q
  // browse reads only the database and the clock
  return browse({ db, now } as unknown as PlayerCtx, fits ? q : rest)
}

/** A player's open listings by their current handle, newest first; the market shows them to anyone already. */
export async function listingsByHandle(db: Db, handle: string, now: number): Promise<ListingView[]> {
  if (!HANDLE_RE.test(handle)) return []
  const p = await db.get<{ id: string }>('SELECT id FROM players WHERE handle = ?', handle)
  if (!p) return []
  // one past its lapse day waits only for the sweep to send it home: it is not for sale
  const today = utcDay(now)
  return (await listingsOf(db, p.id)).filter(l => listingExpiry(Date.parse(`${l.day}T00:00:00Z`)) > today).slice(0, LISTINGS_SHOWN)
}

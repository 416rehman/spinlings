// What the public pages read, and nothing more (SPEC 20.3, 20.8, 26.4): a profile's allowed
// fields, a card's public face, an open gift's card, a public drop's counts and the Mythics list
// as handle plus name. Each returns null where the page should say "not here", whether the thing
// never existed, belongs to nobody any more or simply is not open.
import type { ProfileResponse } from '../../plugin/hooks/core/api.ts'
import type { BattleCard, DropReward } from '../../plugin/hooks/core/types.ts'
import { normalizeDropCode } from '../../plugin/hooks/core/drops.ts'
import { DROP_CODE_RE, GIFT_CODE_RE, HANDLE_RE, ID_RE, parseDropReward } from '../../plugin/hooks/core/schemas.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import type { Db } from './db.ts'
import { cardsByIds, publicCard, queryCards } from './game/mint.ts'
import { profileOf } from './game/social-board.ts'
import type { DropRow, GiftRow } from './schema.ts'

export const MYTHICS_SHOWN = 12
export const FOR_TRADE_SHOWN = 24

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

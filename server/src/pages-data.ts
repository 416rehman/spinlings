// What the public pages read, and nothing more (SPEC 20.3, 20.8, 26.4): the world's facts, a
// profile's allowed fields, a card's public face, an open gift's card, a public drop's counts and
// the Mythics list as handle plus name. Each returns null where the page should say "not here",
// whether the thing never existed, belongs to nobody any more or simply is not open.
import type { ProfileResponse } from '../../plugin/hooks/core/api.ts'
import type { BattleCard, DropReward, Species } from '../../plugin/hooks/core/types.ts'
import { normalizeDropCode } from '../../plugin/hooks/core/drops.ts'
import { DROP_CODE_RE, GIFT_CODE_RE, HANDLE_RE, ID_RE, parseDropReward } from '../../plugin/hooks/core/schemas.ts'
import { seasonOf, seasonStart, utcDay, worldOf } from '../../plugin/hooks/core/world.ts'
import type { WorldState } from '../../plugin/hooks/core/world.ts'
import type { Db } from './db.ts'
import { DAY, ensureSeason } from './game/ctx.ts'
import { cardsByIds, publicCard, queryCards } from './game/mint.ts'
import { profileOf } from './game/social-board.ts'
import type { DropRow, GiftRow } from './schema.ts'

export const MYTHICS_SHOWN = 12
export const FOR_TRADE_SHOWN = 24

export type Landing = {
  world: WorldState
  species: readonly Species[]
  /** species of this season somebody has found (the gallery shows the rest as silhouettes) */
  found: ReadonlySet<string>
  /** newest first; handle is the finder's at the catch, null once they rerolled it or left */
  mythics: { name: string; handle: string | null }[]
  mythicCount: number
  /** 1-based day of the season, and days until the next one */
  seasonDay: number
  daysLeft: number
}

export async function landing(db: Db, now: number): Promise<Landing> {
  const season = seasonOf(now)
  const { species } = await ensureSeason(db, season)
  const [found, mythics, count] = await Promise.all([
    db.all<{ species: string }>('SELECT species FROM firsts WHERE season = ?', season),
    db.all<{ name: string; handle: string | null }>(
      'SELECT name, handle FROM mythics ORDER BY day DESC, card_id LIMIT ?',
      MYTHICS_SHOWN,
    ),
    db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mythics'),
  ])
  const seasonDay = Math.floor((now - seasonStart(season)) / DAY) + 1
  return {
    world: worldOf(now), species, found: new Set(found.map(r => r.species)), mythics, mythicCount: count?.n ?? 0,
    seasonDay, daysLeft: Math.ceil((seasonStart(season + 1) - now) / DAY),
  }
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

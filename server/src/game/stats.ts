// Player stats and the leaderboards (SPEC 8, 20): public game numbers kept as counters on the player row, written
// relatively inside the batch of the event they count, and the boards read straight off them. A counter of this
// season lives beside each board-worthy all-time one; the first write in a new season zeroes them all (rollSeason),
// and the season boards read them only for the current season. Counts only: never who, never when.
//
// What other players see is the numbers as they stood at the last UTC midnight, so nobody can watch a counter move
// and tell that a player is playing right now (SPEC 20.3). The first write of a UTC day that moves any public
// number saves them first (publish); a row with no such write today still holds its midnight values.
import type { BoardName, BoardPeriod, LeaderboardResponse, PlayerStats, RankingsResponse, RankRow } from '../../../plugin/hooks/core/api.ts'
import { ECONOMY, leagueOf } from '../../../plugin/hooks/core/economy.ts'
import { SPECIES_ID } from '../../../plugin/hooks/core/species.ts'
import { seasonOf, utcDay } from '../../../plugin/hooks/core/world.ts'
import { stmt } from '../db.ts'
import type { Db, Stmt } from '../db.ts'
import type { PlayerRow } from '../schema.ts'

/** The counters an event can add to, by column; each season one moves with its all-time one. */
const COUNTERS = {
  duelWins: { all: 'duel_wins', season: 's_duel_wins' },
  duelLosses: { all: 'duel_losses', season: null },
  wildWins: { all: 'wild_wins', season: null },
  catches: { all: 'catches', season: null },
  firstFinds: { all: 'first_finds', season: null },
  mythicsFound: { all: 'mythics_found', season: 's_mythics' },
} as const
export type Counter = keyof typeof COUNTERS

const SEASON_COLUMNS = ['s_duel_wins', 's_beaten', 's_species', 's_mythics', 's_sales'] as const

/** Every player column another player can see a number from, directly or through a board's conditions or a league. */
const PUBLIC_COLUMNS = [
  'rating', 'season', 'battles', 'stats_season', 'duel_wins', 'duel_losses', 'beaten', 'wild_wins', 'catches', 'species_count',
  'first_finds', 'mythics_found', 'market_sales', ...SEASON_COLUMNS,
] as const
type PublicColumn = typeof PUBLIC_COLUMNS[number]
export type PublicNumbers = Pick<PlayerRow, PublicColumn>

/**
 * Saves the player's public numbers as they stand, once per UTC day: on the first write of the day that moves one,
 * before it does, so they are the midnight values. Put it before every write to a public column (count, albumAdd and
 * beat include it; settling a battle and the season's turn add it for rating, battles and season).
 */
export const publish = (id: string, now: number): Stmt => {
  const day = utcDay(now)
  return stmt(
    `UPDATE players SET pub_stats = json_object(${PUBLIC_COLUMNS.map(c => `'${c}', ${c}`).join(', ')}), pub_day = ?
     WHERE id = ? AND pub_day < ?`,
    day, id, day,
  )
}

/** The row with the numbers other players see today: the saved midnight values once something moved them today. */
export function publicRow<P extends PublicNumbers & Pick<PlayerRow, 'pub_day' | 'pub_stats'>>(p: P, now: number): P {
  if (p.pub_day !== utcDay(now)) return p
  const saved = JSON.parse(p.pub_stats) as Partial<PublicNumbers>
  const out = { ...p }
  for (const c of PUBLIC_COLUMNS) if (typeof saved[c] === 'number') (out as Record<PublicColumn, number>)[c] = saved[c]
  return out
}

/** The players on the boards (not hidden) with the numbers other players see, as a CTE body; binds ?1 to today. */
const PUBLIC_PLAYERS = `SELECT id, handle, ${PUBLIC_COLUMNS.map(c => `CASE WHEN pub_day = ?1 THEN json_extract(pub_stats, '$.${c}') ELSE ${c} END AS ${c}`).join(', ')}
  FROM players WHERE board_hidden = 0`

/** Zeroes this season's counters on the first stats write of a new season; nothing otherwise. Put it before any count. */
export const rollSeason = (id: string, now: number): Stmt => {
  const season = seasonOf(now)
  return stmt(
    `UPDATE players SET stats_season = ?, ${SEASON_COLUMNS.map(c => `${c} = 0`).join(', ')} WHERE id = ? AND stats_season != ?`,
    season, id, season,
  )
}

/** Before a count: the midnight values saved, then this season's counters zeroed if the season turned. */
const before = (id: string, now: number): Stmt[] => [publish(id, now), rollSeason(id, now)]

/** Adds to the player's counters (and this season's), relatively, so it composes with any other write to the row. */
export function count(id: string, now: number, add: Partial<Record<Counter, number>>): Stmt[] {
  const sets: string[] = []
  const params: number[] = []
  for (const [k, n] of Object.entries(add) as [Counter, number][]) {
    if (!n) continue
    const c = COUNTERS[k]
    sets.push(`${c.all} = ${c.all} + ?`)
    params.push(n)
    if (c.season) {
      sets.push(`${c.season} = ${c.season} + ?`)
      params.push(n)
    }
  }
  if (!sets.length) return []
  return [...before(id, now), stmt(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`, ...params, id)]
}

/**
 * A species into the player's album (SPEC 4: species they have ever owned), counted once: the counters move only
 * while the album lacks it, so these run before the insert. A species of the current season counts for the season too.
 */
export function albumAdd(owner: string, species: string, now: number): Stmt[] {
  const m = SPECIES_ID.exec(species)
  if (!m) return []
  const thisSeason = Number(m[1]) === seasonOf(now) ? 1 : 0
  return [
    ...before(owner, now),
    stmt(
      `UPDATE players SET species_count = species_count + 1, s_species = s_species + ?
       WHERE id = ? AND NOT EXISTS (SELECT 1 FROM album WHERE player_id = ? AND species = ?)`,
      thisSeason, owner, owner, species,
    ),
    stmt('INSERT INTO album (player_id, species) VALUES (?, ?) ON CONFLICT DO NOTHING', owner, species),
  ]
}

/**
 * `winner` beat `loser` in a duel: the distinct-players count moves the first time ever, the season's the first time
 * this season. The pair is kept only to count it once; it is never shown (SPEC 20).
 */
export function beat(winner: string, loser: string, now: number): Stmt[] {
  const season = seasonOf(now)
  return [
    ...before(winner, now),
    stmt('UPDATE players SET beaten = beaten + 1 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM beaten WHERE player_id = ? AND other_id = ?)',
      winner, winner, loser),
    stmt(
      `UPDATE players SET s_beaten = s_beaten + 1
       WHERE id = ? AND NOT EXISTS (SELECT 1 FROM beaten WHERE player_id = ? AND other_id = ? AND season = ?)`,
      winner, winner, loser, season,
    ),
    stmt('INSERT INTO beaten (player_id, other_id, season) VALUES (?, ?, ?) ON CONFLICT (player_id, other_id) DO UPDATE SET season = excluded.season',
      winner, loser, season),
  ]
}

/**
 * `seller` sold a listing to `buyer`: the sales count moves the first time ever this buyer buys from them, the season's
 * the first time this season, so two accounts passing a card back and forth add nothing. A sale for sparks alone
 * leaves its price among the recent prices on those same terms. Run before the listing's other writes. The pair is
 * kept only to count it once; it is never shown (SPEC 20).
 */
export function sold(seller: string, buyer: string, now: number, price: { species: string; rarity: string; shiny: number; foil: number; sparks: number } | null): Stmt[] {
  const season = seasonOf(now)
  const fresh = (extra: string) => `NOT EXISTS (SELECT 1 FROM sold_to WHERE seller_id = ? AND buyer_id = ?${extra})`
  return [
    ...before(seller, now),
    stmt(`UPDATE players SET market_sales = market_sales + 1 WHERE id = ? AND ${fresh('')}`, seller, seller, buyer),
    stmt(`UPDATE players SET s_sales = s_sales + 1 WHERE id = ? AND ${fresh(' AND season = ?')}`, seller, seller, buyer, season),
    ...(price ? [stmt(
      `INSERT INTO market_sales (species, rarity, shiny, foil, price, day) SELECT ?, ?, ?, ?, ?, ? WHERE ${fresh(' AND season = ?')}`,
      price.species, price.rarity, price.shiny, price.foil, price.sparks, utcDay(now), seller, buyer, season,
    )] : []),
    stmt('INSERT INTO sold_to (seller_id, buyer_id, season) VALUES (?, ?, ?) ON CONFLICT (seller_id, buyer_id) DO UPDATE SET season = excluded.season',
      seller, buyer, season),
  ]
}

/** The player's stats, all time, as the wire has them. */
export function statsOf(p: Pick<PlayerRow, 'duel_wins' | 'duel_losses' | 'beaten' | 'wild_wins' | 'catches' | 'species_count' | 'first_finds' | 'mythics_found' | 'market_sales'>): PlayerStats {
  return {
    duelWins: p.duel_wins,
    duelLosses: p.duel_losses,
    playersBeaten: p.beaten,
    wildWins: p.wild_wins,
    catches: p.catches,
    speciesCollected: p.species_count,
    firstFinds: p.first_finds,
    mythicsFound: p.mythics_found,
    marketSales: p.market_sales,
  }
}

// ---- the leaderboards ----------------------------------------------------------------------------

/**
 * Each board's value column, all time and this season, and who is on it. The rating board lists players with a
 * finished battle (this season: those who have played in it, so their rating has had its season reset). Columns
 * and conditions are code, never input; ?2 is the current season.
 */
const BOARDS: Record<BoardName, { all: string; season: string; on: string; onSeason: string }> = {
  rating: { all: 'rating', season: 'rating', on: 'battles > 0', onSeason: 'battles > 0 AND season = ?2' },
  beaten: { all: 'beaten', season: 's_beaten', on: 'beaten > 0', onSeason: 's_beaten > 0 AND stats_season = ?2' },
  duelWins: { all: 'duel_wins', season: 's_duel_wins', on: 'duel_wins > 0', onSeason: 's_duel_wins > 0 AND stats_season = ?2' },
  species: { all: 'species_count', season: 's_species', on: 'species_count > 0', onSeason: 's_species > 0 AND stats_season = ?2' },
  mythics: { all: 'mythics_found', season: 's_mythics', on: 'mythics_found > 0', onSeason: 's_mythics > 0 AND stats_season = ?2' },
  sales: { all: 'market_sales', season: 's_sales', on: 'market_sales > 0', onSeason: 's_sales > 0 AND stats_season = ?2' },
}

/**
 * One board: the top 50 by value (ties by handle, sharing a rank) and the caller's own row, among players who have
 * not hidden, all by the numbers of the last midnight (the caller's own row too, so it agrees with the list). Rivals
 * are not players, so they never appear.
 */
export async function rankings(db: Db, me: PlayerRow, board: BoardName, period: BoardPeriod, now: number): Promise<RankingsResponse> {
  const season = seasonOf(now)
  const b = BOARDS[board]
  const col = period === 'all' ? b.all : b.season
  const on = period === 'all' ? b.on : b.onSeason
  const rows = await db.all<{ handle: string; rating: number; value: number }>(
    `WITH pub AS (${PUBLIC_PLAYERS}) SELECT handle, rating, ${col} AS value FROM pub WHERE ${on} ORDER BY ${col} DESC, handle LIMIT ?3`,
    utcDay(now), season, ECONOMY.boards.size,
  )
  const top: RankRow[] = []
  rows.forEach((r, i) => {
    const rank = i > 0 && rows[i - 1]!.value === r.value ? top[i - 1]!.rank : i + 1
    top.push({ rank, handle: r.handle, league: leagueOf(r.rating).name, value: r.value })
  })
  const mine = await db.get<{ rating: number; value: number; ahead: number }>(
    `WITH pub AS (${PUBLIC_PLAYERS})
     SELECT rating, ${col} AS value, (SELECT COUNT(*) FROM pub WHERE ${on} AND ${col} > p.${col}) AS ahead
     FROM pub p WHERE p.id = ?3 AND ${on}`,
    utcDay(now), season, me.id,
  )
  const out: RankingsResponse = { board, period, season, top }
  if (mine) out.me = { rank: mine.ahead + 1, handle: me.handle, league: leagueOf(mine.rating).name, value: mine.value }
  return out
}

/** GET /v1/leaderboard, as the 0.1.0 mod reads it: the rating board's top 50, all time, by the last midnight's ratings. */
export async function ratingTop(db: Db, now: number): Promise<LeaderboardResponse> {
  const rows = await db.all<{ handle: string; rating: number }>(
    `WITH pub AS (${PUBLIC_PLAYERS}) SELECT handle, rating FROM pub WHERE battles > 0 ORDER BY rating DESC, handle LIMIT ?2`,
    utcDay(now), ECONOMY.boards.size,
  )
  return { top: rows.map(r => ({ handle: r.handle, league: leagueOf(r.rating).name, rating: r.rating })) }
}

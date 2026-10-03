// What players see of each other (SPEC 8, 19, 20.3, 26.4): a profile by exact handle and the trade
// board. Only handles, leagues, public battle cards, an album count and, unless the player hid from
// the leaderboards, their stats (game/stats.ts has the boards). Numbers are the last midnight's. Nothing is ordered by activity: the
// board takes players seen within the matchmaking window and shows them in a random order.
import type { BoardResponse, ProfileResponse } from '../../../plugin/hooks/core/api.ts'
import { ECONOMY, leagueOf } from '../../../plugin/hooks/core/economy.ts'
import { shuffle } from '../../../plugin/hooks/core/rng.ts'
import { utcDay } from '../../../plugin/hooks/core/world.ts'
import type { PlayerCtx } from '../app.ts'
import type { Db } from '../db.ts'
import type { PlayerRow } from '../schema.ts'
import { traderView } from './collection.ts'
import { newId, rngOf, teamOf } from './ctx.ts'
import { cardsByIds, handlesOf, publicCard, queryCards } from './mint.ts'
import type { StoredCard } from './mint.ts'
import { publicRow, statsOf } from './stats.ts'

const PROFILE_FOR_TRADE = 200
/** Matches are built from at most this many of the other side's listed cards. */
const MATCH_SCAN = 400
const MINE_SCAN = 500
const RECENT = { cards: 20, perPlayer: 2, scan: 80 }
const CHUNK = 90

/** A card on the trade list: marked, at home and never bound (`a` is the cards alias; binds `now`, which no card waits on any more). */
const listed = (a: string) => `${a}.for_trade = 1 AND ${a}.state = 'owned' AND ${a}.bound = 0 AND ${a}.locked_until <= ?`
const marks = (list: readonly unknown[]) => list.map(() => '?').join(', ')

/**
 * Exactly the public profile, by exact handle, for GET /v1/players/:handle and the /u/:handle page
 * (which shows fewer cards for trade); null for a retired or unknown handle.
 */
export async function profileOf(db: Db, handle: string, now: number, forTradeShown = PROFILE_FOR_TRADE): Promise<ProfileResponse | null> {
  const p = await db.get<PlayerRow>('SELECT * FROM players WHERE handle = ?', handle)
  if (!p) return null
  const ids = teamOf(p)
  // league, album count and stats as they stood at midnight, so none of them shows play as it happens (SPEC 20.3)
  const pub = publicRow(p, now)
  const [team, forTrade] = await Promise.all([
    cardsByIds(db, ids),
    queryCards(db, `SELECT * FROM cards c WHERE c.owner_id = ? AND ${listed('c')} ORDER BY c.power DESC, c.id LIMIT ?`, p.id, now, forTradeShown),
  ])
  return {
    handle: p.handle,
    league: leagueOf(pub.rating).name,
    team: ids.flatMap(id => {
      const c = team.get(id)
      return c && c.owner === p.id ? [publicCard(c.card)] : []
    }),
    forTrade: forTrade.map(c => publicCard(c.card)),
    seenCount: pub.species_count,
    ...(p.board_hidden ? {} : { stats: statsOf(pub) }),
  }
}

async function wishesOf(db: Db, players: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  for (let i = 0; i < players.length; i += CHUNK) {
    const part = players.slice(i, i + CHUNK)
    for (const w of await db.all<{ player_id: string; species: string }>(`SELECT player_id, species FROM wishes WHERE player_id IN (${marks(part)})`, ...part)) {
      out.set(w.player_id, (out.get(w.player_id) ?? new Set()).add(w.species))
    }
  }
  return out
}

/**
 * Matches (SPEC 8): players with a listed card on the caller's wishlist who wish for a species the
 * caller has listed. One card from each side per player (their strongest, and the caller's strongest
 * they want), at most 20 players.
 */
async function matchesFor(ctx: PlayerCtx, since: string): Promise<BoardResponse['matches']> {
  const { db, now } = ctx
  const me = ctx.player.id
  const wishes = (await db.all<{ species: string }>('SELECT species FROM wishes WHERE player_id = ?', me)).map(w => w.species)
  if (!wishes.length) return []
  const theirs = await queryCards(db,
    `SELECT c.* FROM cards c JOIN players p ON p.id = c.owner_id
     WHERE c.species IN (${marks(wishes)}) AND ${listed('c')} AND c.owner_id != ? AND p.last_seen >= ?
       AND EXISTS (SELECT 1 FROM wishes w JOIN cards m ON m.owner_id = ? AND m.species = w.species WHERE w.player_id = c.owner_id AND ${listed('m')})
     ORDER BY c.power DESC, c.id LIMIT ?`,
    ...wishes, now, me, since, me, now, MATCH_SCAN)
  if (!theirs.length) return []
  const owners = [...new Set(theirs.map(c => c.owner))]
  const [mine, wants, handles] = await Promise.all([
    queryCards(db, `SELECT * FROM cards c WHERE c.owner_id = ? AND ${listed('c')} ORDER BY c.power DESC, c.id LIMIT ?`, me, now, MINE_SCAN),
    wishesOf(db, owners),
    handlesOf(db, owners),
  ])
  const out: BoardResponse['matches'] = []
  for (const owner of shuffle(rngOf(ctx), owners)) {
    const take = theirs.find(c => c.owner === owner)
    const give = mine.find(c => wants.get(owner)?.has(c.card.species))
    const handle = handles.get(owner)
    if (take && give && handle) out.push({ handle, theirs: publicCard(take.card), mine: publicCard(give.card) })
    if (out.length >= ECONOMY.boardMatches) break
  }
  return out
}

/**
 * Recent listings, when there are no matches: from a random point in the card ids onwards (wrapping
 * round once), so the sample is fair without sorting the whole market; at most 2 cards per player.
 */
async function recentFor(ctx: PlayerCtx, since: string): Promise<BoardResponse['recent']> {
  const { db, now } = ctx
  const me = ctx.player.id
  const pivot = newId(ctx)
  const scan = (from: boolean): Promise<StoredCard[]> => queryCards(db,
    `SELECT c.* FROM cards c JOIN players p ON p.id = c.owner_id
     WHERE c.id ${from ? '>=' : '<'} ? AND ${listed('c')} AND c.owner_id != ? AND p.last_seen >= ? ORDER BY c.id LIMIT ?`,
    pivot, now, me, since, RECENT.scan)
  let found = await scan(true)
  if (found.length < RECENT.scan) found = [...found, ...await scan(false)]
  const per = new Map<string, number>()
  const picked = found.filter(c => {
    const n = per.get(c.owner) ?? 0
    per.set(c.owner, n + 1)
    return n < RECENT.perPlayer
  }).slice(0, RECENT.cards)
  const handles = await handlesOf(db, picked.map(c => c.owner))
  return shuffle(rngOf(ctx), picked).flatMap(c => {
    const handle = handles.get(c.owner)
    return handle ? [{ handle, card: publicCard(c.card) }] : []
  })
}

/** GET /v1/board: matches, else recent listings, always with today's Wandering Trader deals (SPEC 19). */
export async function boardFor(ctx: PlayerCtx): Promise<BoardResponse> {
  const since = utcDay(ctx.now - ECONOMY.rating.seenWithinMs)
  const matches = await matchesFor(ctx, since)
  return {
    matches,
    recent: matches.length ? [] : await recentFor(ctx, since),
    trader: await traderView(ctx.db, ctx.player.id, ctx.now),
  }
}

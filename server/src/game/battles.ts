// Battles on the server (SPEC 5, 13-19, 22, 24, 32). Starting one picks the team (tired and missing
// slots auto-filled), the opponent (a wild team, a matched player's snapshot, a revenge target or a
// Rival) and the seed. Settling re-simulates with the battle's own rules version and pays everything
// in one guarded batch: sparks, XP and evolution with arena counts, rating under the pair limit,
// defense, streaks, the daily first win, the catch roll and the bounty. No daily caps (SPEC 24).
import type { FinishBattleResponse, Opponent, StartBattleRequest, StartBattleResponse } from '../../../plugin/hooks/core/api.ts'
import { applyRating, battleRewards, eloDelta, participants, RULES_VERSION, simulateBattle } from '../../../plugin/hooks/core/battle.ts'
import { applyXp, cardFromBattleCard, cardName, cardPower, raisingFamily, toBattleCard } from '../../../plugin/hooks/core/cards.ts'
import { ECONOMY, finishAfter, leagueOf, streakPackDue } from '../../../plugin/hooks/core/economy.ts'
import { rollBounty, rollWildTeam } from '../../../plugin/hooks/core/packs.ts'
import { rollRival } from '../../../plugin/hooks/core/rivals.ts'
import { chance } from '../../../plugin/hooks/core/rng.ts'
import { SPECIES_ID } from '../../../plugin/hooks/core/species.ts'
import type { BattleCard, BattleLog, BattleSetup, Card } from '../../../plugin/hooks/core/types.ts'
import { utcDay, worldOf } from '../../../plugin/hooks/core/world.ts'
import { guard, stmt } from '../db.ts'
import type { Db, Stmt } from '../db.ts'
import { fail } from '../http.ts'
import type { BattleRow, PlayerRow } from '../schema.ts'
import { addSparks, bumpPlayer, DAY, ensureSeasons, newId, newSeed, notFound, randomInt, readJson, rngOf, setPlayer, teamOf } from './ctx.ts'
import type { Env } from './ctx.ts'
import { bumpCards, cardGuard, cardsByIds, grantPack, mintCards, publicCard, queryCards, saveCard } from './mint.ts'
import type { StoredCard } from './mint.ts'
import { notice } from './notices.ts'
import { battleFinished, firstWinDue, markDuelStart, markFirstWin, markWildStart, pairCounts, pairDuels, restedNow, waitUntil } from './pacing.ts'

const B = ECONOMY.battle

/**
 * The authoritative log for these inputs; null for a row that cannot be replayed, which closes with
 * nothing paid. Only one rules version exists so far: when RULES_VERSION moves, settle the previous
 * version's open battles with its own simulator here for at least one release (SPEC 32).
 */
export function replay(b: Pick<BattleRow, 'setup' | 'rules'>, inputs: readonly number[]): BattleLog | null {
  if (b.rules !== RULES_VERSION) return null
  try {
    return simulateBattle(JSON.parse(b.setup) as BattleSetup, inputs)
  } catch {
    return null
  }
}

/** A battle may be finished by its attacker until it is this old; after that it settles on its own (SPEC 5). */
export const abandoned = (b: Pick<BattleRow, 'started_at'>, now: number): boolean => now - b.started_at >= B.abandonMs

/** A Rival's place in players.recent_opponents (never a player id: those are 26 characters). */
export const RIVAL = 'rival'

/** What the row keeps about the opponent beyond the wire view: the rating Elo settles against. */
type StoredOpponent = { kind: 'wild' } | { kind: 'player'; rating: number } | { kind: 'rival'; name: string; rating: number }

/** Fixed lines for notices: results only, never the arena; the other player's handle rides alongside. */
export const BATTLE_TEXT = {
  defenseWin: (sparks: number) => `Your team held off a challenger${sparks ? ` · +${sparks} sparks` : ''}`,
  defenseLoss: () => 'A challenger beat your team · revenge is open for a day',
  evolved: (from: string, to: string) => `${from} evolved into ${to}!`,
  dailyPack: () => 'Your first win today brought a pack',
  streakPack: (streak: number) => `Hot streak! ${streak} wins in a row brought a pack`,
}

const battleGuard = (b: Pick<BattleRow, 'id' | 'version'>): Stmt =>
  guard(`SELECT 1 FROM battles WHERE id = ? AND state = 'open' AND version = ?`, b.id, b.version)

/** Rating is written relatively and floored, so it composes with the other side's writes. */
const addRating = (id: string, delta: number): Stmt =>
  stmt('UPDATE players SET rating = MAX(?, rating + ?) WHERE id = ?', ECONOMY.rating.floor, delta, id)

/** The caller's own battle, or 404 exactly as if it did not exist (SPEC 26). */
export async function ownBattle(db: Db, playerId: string, id: string): Promise<BattleRow> {
  return (await db.get<BattleRow>('SELECT * FROM battles WHERE id = ? AND attacker_id = ?', id, playerId)) ?? notFound('battle')
}

export const openBattleOf = (db: Db, playerId: string): Promise<BattleRow | undefined> =>
  db.get<BattleRow>(`SELECT * FROM battles WHERE attacker_id = ? AND state = 'open' ORDER BY started_at LIMIT 1`, playerId)

/** The oldest battle this player attacked or defended that was left unfinished for 10 minutes. */
export const abandonedBattleOf = (db: Db, playerId: string, now: number): Promise<BattleRow | undefined> => db.get<BattleRow>(
  `SELECT * FROM (
     SELECT * FROM battles WHERE attacker_id = ? AND state = 'open' AND started_at <= ?
     UNION ALL
     SELECT * FROM battles WHERE defender_id = ? AND state = 'open' AND started_at <= ?
   ) ORDER BY started_at LIMIT 1`,
  playerId, now - B.abandonMs, playerId, now - B.abandonMs,
)

// ---- starting ----------------------------------------------------------------------------------

export type TeamPick = { cards: StoredCard[]; subs: StartBattleResponse['subs'] }

/**
 * The team that battles now (SPEC 5, Format): each saved slot in order, a tired, held, missing or
 * empty one filled by the highest-power free card not on the team. `subs[].slot` is the position in
 * the battling team. Refuses when no creature can battle: 429 until the first one wakes, else 403.
 */
export async function battleTeam(db: Db, p: PlayerRow, now: number): Promise<TeamPick> {
  const ids = teamOf(p).slice(0, ECONOMY.teamSize)
  const held = await cardsByIds(db, ids)
  const bench = (await queryCards(db,
    `SELECT * FROM cards WHERE owner_id = ? AND state = 'owned' AND tired_until <= ? ORDER BY power DESC, id LIMIT ?`,
    p.id, now, 2 * ECONOMY.teamSize,
  )).filter(c => !ids.includes(c.card.id))
  const cards: StoredCard[] = []
  const subs: TeamPick['subs'] = []
  for (let slot = 0; slot < ECONOMY.teamSize; slot++) {
    const id = ids[slot]
    const own = id === undefined ? undefined : held.get(id)
    if (own && own.owner === p.id && own.card.state === 'owned' && own.card.tiredUntil <= now) {
      cards.push(own)
      continue
    }
    const sub = bench.shift()
    if (!sub) continue
    subs.push({ slot: cards.length, cardId: sub.card.id, replaced: id ?? null })
    cards.push(sub)
  }
  if (!cards.length) {
    const wake = await db.get<{ at: number | null }>(`SELECT MIN(tired_until) AS at FROM cards WHERE owner_id = ? AND state = 'owned'`, p.id)
    if (wake?.at && wake.at > now) waitUntil(wake.at, now, 'Your team is resting')
    fail('not_allowed', 'No creature is free to battle')
  }
  return { cards, subs }
}

/** A defending player's saved team as it is now, tired or not (SPEC 5: the snapshot ignores tiredness), as public cards. */
async function defenseTeam(db: Db, d: PlayerRow): Promise<BattleCard[]> {
  const ids = teamOf(d).slice(0, ECONOMY.teamSize)
  const found = await cardsByIds(db, ids)
  return ids.flatMap(id => {
    const c = found.get(id)
    return c && c.owner === d.id ? [publicCard(c.card)] : []
  })
}

/**
 * Duel matchmaking (SPEC 5): a player with a team, seen in the last 14 days, not the attacker and
 * not among their last 5 opponents, uniformly from the first non-empty rating window (±150, ±400,
 * anyone). Undefined when nobody fits: a Rival fills in.
 */
export async function findOpponent(env: Env, p: PlayerRow): Promise<PlayerRow | undefined> {
  const exclude = [p.id, ...readJson<string[]>(p.recent_opponents, []).slice(0, ECONOMY.rating.recentOpponents).filter(r => r !== RIVAL)]
  const seen = utcDay(env.now - ECONOMY.rating.seenWithinMs)
  const from = `FROM players WHERE team_size > 0 AND last_seen >= ? AND id NOT IN (${exclude.map(() => '?').join(', ')})`
  for (const width of [...ECONOMY.rating.windows, null]) {
    const where = width === null ? '' : ' AND rating BETWEEN ? AND ?'
    const params = [seen, ...exclude, ...(width === null ? [] : [p.rating - width, p.rating + width])]
    const n = (await env.db.get<{ n: number }>(`SELECT COUNT(*) AS n ${from}${where}`, ...params))!.n
    if (!n) continue
    const row = await env.db.get<PlayerRow>(`SELECT * ${from}${where} ORDER BY rating, id LIMIT 1 OFFSET ?`, ...params, randomInt(env, n))
    if (row) return row
  }
  return undefined
}

type Foe = { defender: BattleCard[]; opponent: Opponent; stored: StoredOpponent; kind: 'wild' | 'duel' | 'rival'; defenderId: string | null; stmts: Stmt[] }

const playerFoe = (d: PlayerRow, defender: BattleCard[], stmts: Stmt[] = []): Foe => ({
  defender, defenderId: d.id, kind: 'duel', stmts,
  opponent: { kind: 'player', handle: d.handle, league: leagueOf(d.rating).name },
  stored: { kind: 'player', rating: d.rating },
})

/**
 * A revenge (SPEC 14, 15): only against the player who beat this team within a day, once per defense
 * loss. Anything else answers 404, whether or not the handle exists.
 */
async function revengeFoe(env: Env, p: PlayerRow, handle: string): Promise<Foe> {
  const target = await env.db.get<PlayerRow>('SELECT * FROM players WHERE handle = ?', handle)
  const open = target && target.id !== p.id && await env.db.get<{ id: string; revenge_until: number }>(
    `SELECT id, revenge_until FROM notices WHERE player_id = ? AND kind = 'defense-loss' AND other_id = ? AND revenge_until > ?
     ORDER BY revenge_until LIMIT 1`,
    p.id, target.id, env.now,
  )
  if (!target || !open) return fail('not_found', 'No revenge is open against that player')
  const defender = await defenseTeam(env.db, target)
  if (!defender.length) fail('not_allowed', 'They have no team out right now')
  return playerFoe(target, defender, [
    guard('SELECT 1 FROM notices WHERE id = ? AND revenge_until = ?', open.id, open.revenge_until),
    stmt('UPDATE notices SET revenge_until = NULL WHERE id = ?', open.id),
  ])
}

async function duelFoe(env: Env, p: PlayerRow, team: readonly StoredCard[]): Promise<Foe> {
  const d = await findOpponent(env, p)
  const defender = d ? await defenseTeam(env.db, d) : []
  if (d && defender.length) return playerFoe(d, defender)
  const rival = rollRival({ rng: rngOf(env), now: env.now, rating: p.rating, power: team.reduce((n, c) => n + cardPower(c.card), 0), size: team.length })
  return {
    defender: rival.team, defenderId: null, kind: 'rival', stmts: [],
    opponent: { kind: 'rival', name: rival.name, league: leagueOf(rival.rating).name },
    stored: { kind: 'rival', name: rival.name, rating: rival.rating },
  }
}

/**
 * Wild creatures (SPEC 5, 7, 17, 18): the arena family, the featured species, the roamer, a Mythic,
 * the rested bonus (never for a player's very first battles: they are not back from a break).
 */
function wildFoe(env: Env, p: PlayerRow, req: StartBattleRequest, team: readonly StoredCard[]): Foe {
  const w = worldOf(env.now)
  const level = team.reduce((n, c) => n + c.card.level, 0) / team.length
  const defender = rollWildTeam({
    rng: rngOf(env), arena: req.family, now: env.now, level, rule: w.rule, featured: w.featured, roamer: w.roamer, rested: restedNow(p, env.now),
  })
  return { defender, defenderId: null, kind: 'wild', opponent: { kind: 'wild' }, stored: { kind: 'wild' }, stmts: [] }
}

/** Per defender slot: nobody has obtained this species this season yet (the FIRST IN THE WORLD tease). */
async function firstPossible(db: Db, defender: readonly BattleCard[]): Promise<boolean[]> {
  const species = [...new Set(defender.map(c => c.species).filter(s => SPECIES_ID.test(s)))]
  const taken = new Set(species.length
    ? (await db.all<{ species: string }>(`SELECT species FROM firsts WHERE species IN (${species.map(() => '?').join(', ')})`, ...species)).map(r => r.species)
    : [])
  return defender.map(c => SPECIES_ID.test(c.species) && !taken.has(c.species))
}

/**
 * POST /v1/battles once the spacing is checked and no battle of the player's is left open: the new
 * row and the start marks, for one batch behind the player's guard, and the answer.
 */
export async function prepareStart(env: Env, p: PlayerRow, req: StartBattleRequest): Promise<{ response: StartBattleResponse; stmts: Stmt[] }> {
  const { cards, subs } = await battleTeam(env.db, p, env.now)
  const foe = req.kind === 'wild' ? wildFoe(env, p, req, cards)
    : req.revenge !== undefined ? await revengeFoe(env, p, req.revenge)
      : await duelFoe(env, p, cards)
  const setup: BattleSetup = {
    seed: newSeed(env), kind: req.kind, arena: req.family, rule: worldOf(env.now).rule, rules: RULES_VERSION,
    attacker: cards.map(c => toBattleCard(c.card)), defender: foe.defender,
  }
  const id = newId(env)
  const until = finishAfter(env.now, simulateBattle(setup, []).rounds.length)
  // the last 5 duel opponents, Rivals included, so a lone real player comes round again after 5 duels
  const met = foe.defenderId ?? RIVAL
  const recent = [met, ...readJson<string[]>(p.recent_opponents, []).filter(r => r === RIVAL || r !== met)].slice(0, ECONOMY.rating.recentOpponents)
  const stmts = [
    guard(`SELECT NOT EXISTS (SELECT 1 FROM battles WHERE attacker_id = ? AND state = 'open')`, p.id),
    ...foe.stmts,
    // the last finish's stored answer has served its purpose (finishedAgain)
    stmt('UPDATE battles SET outcome = NULL WHERE attacker_id = ? AND outcome IS NOT NULL', p.id),
    stmt(
      `INSERT INTO battles (id, attacker_id, defender_id, kind, setup, opponent, started_at, rules, finish_after, revenge)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, p.id, foe.defenderId, foe.kind, JSON.stringify(setup), JSON.stringify(foe.stored), env.now, RULES_VERSION, until,
      req.revenge !== undefined,
    ),
    req.kind === 'wild' ? markWildStart(p, env.now) : markDuelStart(p, env.now),
    ...(req.kind === 'duel' ? [setPlayer(p.id, { recent_opponents: JSON.stringify(recent) })] : []),
  ]
  return {
    response: { id, setup, opponent: foe.opponent, subs, firstPossible: await firstPossible(env.db, foe.defender), startedAt: env.now, finishAfter: until },
    stmts,
  }
}

// ---- settling ----------------------------------------------------------------------------------

/**
 * How a battle settles: `finish` is the attacker's own POST .../finish; `auto` is an abandoned
 * battle (touch) or one a new start pushed aside. An auto settle rolls no catch, since nobody is
 * there to pick (a Mythic is gone for good), and so leaves beginner's luck for the next wild win.
 */
export type SettleMode = 'finish' | 'auto'

/** Closes a battle that cannot be replayed (an unreadable row): settled, nothing paid. */
export const closeBattle = (b: Pick<BattleRow, 'id' | 'version'>, now: number): Stmt[] => [
  battleGuard(b),
  stmt(`UPDATE battles SET state = 'settled', settled = ?, setup = '{}', opponent = '{}', version = version + 1 WHERE id = ?`, utcDay(now), b.id),
]

/**
 * Settles an open battle for its attacker `p` (their fresh row). Returns the answer and the batch:
 * guards for the battle, the cards and the pair limit first, then every write. It does not guard
 * the attacker's row: commit() it for the caller, or add playerGuard(p) and bumpPlayer when settling
 * for someone else. Writes to both players' rows are relative.
 */
export async function settleBattle(
  env: Env, b: BattleRow, p: PlayerRow, mode: SettleMode, log: BattleLog,
): Promise<{ response: FinishBattleResponse; stmts: Stmt[] }> {
  const setup = JSON.parse(b.setup) as BattleSetup
  const stored = readJson<StoredOpponent>(b.opponent, { kind: 'wild' })
  const { now } = env
  const { result } = log
  const win = result === 'win'
  const wild = b.kind === 'wild'
  const firstWildWin = wild && win && mode === 'finish' && p.wild_won === 0
  const rewards = battleRewards(setup.kind, result, setup.rule, { revenge: b.revenge === 1, firstWildWin })
  const rng = rngOf(env)
  const guards: Stmt[] = [battleGuard(b)]
  const writes: Stmt[] = []
  const told = (kind: Parameters<typeof notice>[2], text: string) => { if (mode === 'auto') writes.push(notice(env, p.id, kind, text)) }

  // XP, evolution and arena counts for the team cards that took part and are still the player's
  const slots = participants(log, 'a')
  const held = await cardsByIds(env.db, slots.map(i => setup.attacker[i]!.id))
  // after a draw or a loss, fainted cards rest 15 minutes from the battle's end: now, or for an auto
  // settle its earliest finish (SPEC 5, Outcomes)
  const tiredUntil = (mode === 'finish' ? now : b.finish_after) + B.tiredMs
  const xp: FinishBattleResponse['xp'] = []
  const tired: string[] = []
  for (const slot of slots) {
    const prev = held.get(setup.attacker[slot]!.id)
    if (!prev || prev.owner !== p.id) continue
    const arena = { ...prev.arena, [setup.arena]: prev.arena[setup.arena] + 1 }
    const grown = applyXp(prev.card, rewards.xp, raisingFamily(arena, prev.card.family))
    let next: Card = grown.card
    if (!win && log.fainted.a.includes(slot) && tiredUntil > now) {
      next = { ...next, tiredUntil: Math.max(next.tiredUntil, tiredUntil) }
      tired.push(next.id)
    }
    guards.push(cardGuard(prev))
    writes.push(saveCard(prev, next, { arena }))
    xp.push({ cardId: next.id, xp: rewards.xp, levelsGained: grown.levelsGained, evolved: grown.evolved, stage: next.stage })
    if (grown.evolved) told('evolved', BATTLE_TEXT.evolved(cardName(prev.card), cardName(next)))
  }
  if (xp.length) writes.push(bumpCards(p.id))

  // rating (duels and Rivals), the pair limit, and the defending player's side
  let ratingDelta = 0
  if (!wild) {
    const d = b.defender_id ? await env.db.get<PlayerRow>('SELECT * FROM players WHERE id = ?', b.defender_id) : undefined
    let counts = true
    if (d) {
      const earlier = await pairDuels(env.db, p.id, d.id, now)
      counts = pairCounts(earlier)
      guards.push(pairGuard(p.id, d.id, now, earlier))
    }
    const theirs = d?.rating ?? ('rating' in stored ? stored.rating : ECONOMY.rating.start)
    const elo = eloDelta(p.rating, theirs, result)
    if (counts) ratingDelta = applyRating(p.rating, elo.attacker) - p.rating
    if (ratingDelta) writes.push(addRating(p.id, ratingDelta))
    if (d) {
      const defense = result === 'loss' && counts ? B.defenseSparks : 0
      if (counts && elo.defender) writes.push(addRating(d.id, elo.defender))
      if (defense) writes.push(addSparks(d.id, defense))
      if (result === 'loss') writes.push(notice(env, d.id, 'defense-win', BATTLE_TEXT.defenseWin(defense), { other: p.id }))
      if (win) writes.push(notice(env, d.id, 'defense-loss', BATTLE_TEXT.defenseLoss(), { other: p.id, revengeUntil: now + DAY }))
      writes.push(bumpPlayer(d.id))
    }
  }

  // sparks, the streak and its pack, the daily first win, the trust gate's count
  const streak = win ? p.streak + 1 : 0
  const streakPack = win && streakPackDue(streak)
  const dailyWinPack = win && firstWinDue(p, now)
  writes.push(addSparks(p.id, rewards.sparks), battleFinished(p.id, now))
  if (streak !== p.streak) writes.push(setPlayer(p.id, { streak }))
  if (streakPack) {
    writes.push(grantPack(env, p.id, setup.arena, 'streak').stmt)
    told('streak-pack', BATTLE_TEXT.streakPack(streak))
  }
  if (dailyWinPack) {
    writes.push(grantPack(env, p.id, setup.arena, 'daily').stmt, markFirstWin(p, now))
    told('daily-pack', BATTLE_TEXT.dailyPack())
  }

  // a wild win's catch roll among the creatures it defeated (the first one ever always catches; a
  // win on the round limit may have defeated none, and then beginner's luck waits), a duel win's bounty
  const defeated = setup.defender.filter((_, i) => log.fainted.d.includes(i))
  const catchOptions = wild && win && mode === 'finish' && defeated.length && chance(rng, rewards.catchChance) ? defeated : []
  if (firstWildWin && catchOptions.length) writes.push(setPlayer(p.id, { wild_won: 1 }))
  let bounty: Card | null = null
  if (rewards.bountyChance > 0 && chance(rng, rewards.bountyChance)) {
    const lead = setup.defender[0]!
    await ensureSeasons(env.db, [lead.season, ...(lead.form?.parents ?? []).flatMap(seasonsIn)])
    const minted = await mintCards(env, p.id, [rollBounty(lead, rng, now, setup.rule)])
    bounty = minted.cards[0]!
    writes.push(...minted.stmts)
  }

  const response: FinishBattleResponse = {
    result, sparks: rewards.sparks, xp, rating: p.rating + ratingDelta, ratingDelta, catchOptions, bounty, dailyWinPack, streak, streakPack,
    tired, log,
  }
  // the row keeps the result, any catch and a finish's answer for a retry (finishedAgain); the arena,
  // both teams and the seed go now (SPEC 20.2)
  writes.push(stmt(
    `UPDATE battles SET state = 'settled', settled = ?, result = ?, setup = '{}', opponent = '{}', outcome = ?,
       catch_options = ?, catch_until = ?, version = version + 1
     WHERE id = ?`,
    utcDay(now), result, mode === 'finish' ? JSON.stringify(response) : null,
    catchOptions.length ? JSON.stringify(catchOptions) : null, catchOptions.length ? now + B.catchWindowMs : 0, b.id,
  ))

  return { response, stmts: [...guards, ...writes] }
}

/**
 * The attacker asking again for a finish that went through but whose answer never arrived (a
 * timeout, a dropped connection, a reload): the same answer, with the catch as it stands now.
 */
export function finishedAgain(b: Pick<BattleRow, 'outcome' | 'catch_options' | 'catch_until'>, now: number): FinishBattleResponse {
  const done = JSON.parse(b.outcome!) as FinishBattleResponse
  return { ...done, catchOptions: now < b.catch_until ? readJson<BattleCard[]>(b.catch_options, []) : [] }
}

/** Settles a battle nobody finished, with no inputs (SPEC 5); a row that cannot be replayed just closes. */
export async function autoSettle(env: Env, b: BattleRow, attacker: PlayerRow): Promise<Stmt[]> {
  const log = replay(b, [])
  return log ? (await settleBattle(env, b, attacker, 'auto', log)).stmts : closeBattle(b, env.now)
}

/** The pair limit exactly: aborts unless the pair still has `earlier` settled duels in the window. */
const pairGuard = (a: string, b: string, now: number, earlier: number): Stmt => guard(
  `SELECT COUNT(*) = ? FROM battles WHERE kind = 'duel' AND state = 'settled' AND started_at > ?
     AND ((attacker_id = ? AND defender_id = ?) OR (attacker_id = ? AND defender_id = ?))`,
  earlier, now - B.pairWindowMs, a, b, b, a,
)

const seasonsIn = (species: string): number[] => {
  const m = SPECIES_ID.exec(species)
  return m ? [Number(m[1])] : []
}

// ---- catching ----------------------------------------------------------------------------------

/**
 * POST /v1/battles/:id/catch: one of the defeated wild creatures becomes the attacker's card, with
 * the same DNA, genes, traits and level. A Mythic is stamped with its finder's handle and joins the
 * public Mythics list (mintCards). One-shot: the options go in the same batch.
 */
export async function prepareCatch(env: Env, p: PlayerRow, b: BattleRow, index: number): Promise<{ card: Card; stmts: Stmt[] }> {
  const options = readJson<BattleCard[] | null>(b.catch_options, null)
  if (b.state !== 'settled' || !options?.length) fail('conflict', 'Nothing is waiting to be caught')
  if (env.now >= b.catch_until) fail('expired', 'It wandered off')
  const pick = options[index] ?? fail('bad_request', 'No creature in that spot')
  const fresh = cardFromBattleCard(pick, 'catch', env.now, pick.species === 'mythic' ? { discoveredBy: p.handle } : {})
  const minted = await mintCards(env, p.id, [fresh])
  return {
    card: minted.cards[0]!,
    stmts: [
      guard('SELECT 1 FROM battles WHERE id = ? AND version = ? AND catch_options IS NOT NULL', b.id, b.version),
      stmt('UPDATE battles SET catch_options = NULL, catch_until = 0, version = version + 1 WHERE id = ?', b.id),
      ...minted.stmts,
    ],
  }
}

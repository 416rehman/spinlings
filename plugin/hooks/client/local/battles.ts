// Offline battles (SPEC 5, 13, 17-19, 22, 24, 28): wild teams and Rival duels from the shared core rolls, settled by the
// core simulator and paid by the core settlePlan, exactly as the server pays: sparks, XP and evolution with raised
// forms, rating against a Rival, streaks and their packs, the daily first win, the catch roll and the duel bounty.
import type { CardResponse, CatchRequest, FinishBattleRequest, FinishBattleResponse, StartBattleRequest, StartBattleResponse } from '../../core/api.ts'
import type { BattleLog, BattleSetup, Card } from '../../core/types.ts'
import { RULES_VERSION, simulateBattle } from '../../core/battle.ts'
import { cardFromBattleCard, cardPower, toBattleCard } from '../../core/cards.ts'
import { ECONOMY, finishAfter, firstWildDue, isRested, leagueOf } from '../../core/economy.ts'
import { rollFirstWild, rollWildTeam } from '../../core/packs.ts'
import { rollRival } from '../../core/rivals.ts'
import { settlePlan } from '../../core/settle.ts'
import type { SettleMode } from '../../core/settle.ts'
import { utcDay, worldOf } from '../../core/world.ts'
import type { Ctx } from './state.ts'
import { addCards, addNotice, grantPack, hasRoom, nextDuelAt, nextWildAt, refuse, TEXT } from './state.ts'
import type { ArenaCounts, LocalState, OpenBattle } from './save.ts'

const B = ECONOMY.battle

const noCounts = (): ArenaCounts => ({ haiku: 0, sonnet: 0, opus: 0, fable: 0 })

/**
 * The team that battles now (SPEC 5, Format): each saved slot in order, a tired or missing one filled by the
 * strongest rested card not on the team. Refuses when no creature can battle: rate_limited while they rest.
 */
export function battleTeam(s: LocalState, now: number): { cards: Card[]; subs: StartBattleResponse['subs'] } {
  const ids = s.team.slice(0, ECONOMY.teamSize)
  const ready = (c: Card) => c.state === 'owned' && c.tiredUntil <= now
  const bench = s.cards.filter(c => ready(c) && !ids.includes(c.id))
    .sort((a, b) => cardPower(b) - cardPower(a) || (a.id < b.id ? -1 : 1))
  const cards: Card[] = []
  const subs: StartBattleResponse['subs'] = []
  for (let slot = 0; slot < ECONOMY.teamSize; slot++) {
    const want = ids[slot]
    const own = want === undefined ? undefined : s.cards.find(c => c.id === want)
    if (own && ready(own)) {
      cards.push(own)
      continue
    }
    const sub = bench.shift()
    if (!sub) continue
    subs.push({ slot: cards.length, cardId: sub.id, replaced: want ?? null })
    cards.push(sub)
  }
  if (!cards.length) {
    const resting = s.cards.some(c => c.state === 'owned' && c.tiredUntil > now)
    refuse(resting ? 'rate_limited' : 'not_allowed', resting ? 'Your team is resting' : 'No creature is free to battle')
  }
  return { cards, subs }
}

/** One open battle at a time: a new start, or ten quiet minutes, settles the old one with no presses. */
export function startBattle(s: LocalState, ctx: Ctx, req: StartBattleRequest): StartBattleResponse {
  const { now, rng } = ctx
  if (req.revenge !== undefined) refuse('not_allowed', TEXT.online)
  if (s.battle?.state === 'open') settle(s, ctx, s.battle, 'auto')
  if (req.kind === 'wild' && now < nextWildAt(s)) refuse('rate_limited', 'Nothing is rustling yet')
  if (req.kind === 'duel' && now < nextDuelAt(s)) refuse('rate_limited', 'Your team is catching its breath')
  const { cards, subs } = battleTeam(s, now)
  const w = worldOf(now, ctx.catalog)
  let rival: OpenBattle['rival'] = null
  let defender
  if (req.kind === 'wild') {
    const level = cards.reduce((n, c) => n + c.level, 0) / cards.length
    const o = { rng, arena: req.family, now, level, rule: w.rule, catalog: ctx.catalog }
    // beginner's luck: the first wild encounter ever is one gentle creature against the lead
    defender = firstWildDue(s.wildWon, s.lastWildAt)
      ? rollFirstWild({ ...o, lead: cards[0]!.family })
      : rollWildTeam({ ...o, featured: w.featured, roamer: w.roamer, rested: isRested(Math.max(s.lastWildAt, s.lastDuelAt), now) })
  } else {
    const r = rollRival({ rng, now, rating: s.rating, power: cards.reduce((n, c) => n + cardPower(c), 0), size: cards.length, catalog: ctx.catalog })
    rival = { name: r.name, rating: r.rating }
    defender = r.team
  }
  const setup: BattleSetup = {
    seed: ctx.id() + ctx.id(), kind: req.kind, arena: req.family, rule: w.rule, rules: RULES_VERSION,
    attacker: cards.map(toBattleCard), defender,
  }
  const battle: OpenBattle = {
    id: ctx.id(), state: 'open', setup, rival, startedAt: now, finishAfter: finishAfter(now, simulateBattle(setup, []).rounds.length),
  }
  s.battle = battle
  if (req.kind === 'wild') s.lastWildAt = now
  else s.lastDuelAt = now
  return {
    id: battle.id, setup, opponent: rival ? { kind: 'rival', name: rival.name, league: leagueOf(rival.rating).name } : { kind: 'wild' },
    subs, firstPossible: defender.map(() => false), startedAt: now, finishAfter: battle.finishAfter,
  }
}

/** The battle a finish or a catch names: the current one, or refused as already over or not there. */
function named(s: LocalState, battleId: string) {
  if (s.battle?.id === battleId) return s.battle
  return s.done.includes(battleId) ? refuse('conflict', 'That battle is already over') : refuse('not_found', 'That battle is not here')
}

export function finishBattle(s: LocalState, ctx: Ctx, req: { battleId: string } & FinishBattleRequest): FinishBattleResponse {
  const b = named(s, req.battleId)
  if (b.state !== 'open') return refuse('conflict', 'That battle is already over')
  return settle(s, ctx, b, 'finish', simulateBattle(b.setup, req.inputs))
}

/**
 * Settles an open battle by the core settlePlan, the server's own: `auto` is one left behind (ten quiet minutes, or a
 * new start), which rolls no catch and tells its news as notices.
 */
export function settle(s: LocalState, ctx: Ctx, b: OpenBattle, mode: SettleMode, log: BattleLog = simulateBattle(b.setup, [])): FinishBattleResponse {
  const { now } = ctx
  const { setup } = b
  const held = new Map(s.cards.map(card => [card.id, { card, arena: s.arena[card.id] ?? noCounts() }]))
  const plan = settlePlan({
    setup, log, mode, now, finishAfter: b.finishAfter, rng: ctx.rng, catalog: ctx.catalog, held, streak: s.streak, rating: s.rating,
    opponentRating: b.rival?.rating ?? null, wildWon: s.wildWon, firstWinDue: s.firstWinDay !== utcDay(now), revenge: false,
  })
  const { answer } = plan

  // XP, evolution and raised forms; the arena counts only matter until the first evolution fixes the raising family
  for (const { next, arena } of plan.cards) {
    s.cards[s.cards.findIndex(c => c.id === next.id)] = next
    if (next.raisedIn === undefined && next.stage === 1) s.arena[next.id] = arena
    else delete s.arena[next.id]
  }
  if (plan.cards.length) s.cardsVersion++

  // rating, sparks, the streak and its pack, the daily first win, the finished-battle count, beginner's luck
  s.rating = answer.rating
  s.sparks += answer.sparks
  s.battles++
  s.streak = answer.streak
  if (answer.streakPack) grantPack(s, ctx, setup.arena, 'streak')
  if (answer.dailyWinPack) {
    grantPack(s, ctx, setup.arena, 'daily')
    s.firstWinDay = utcDay(now)
  }
  if (plan.luckSpent) s.wildWon = true
  for (const n of plan.notices) addNotice(s, ctx, n.kind, n.text)
  // a full collection lets the bounty go
  const bounty: Card | null = plan.bounty && hasRoom(s, 1, true) ? addCards(s, ctx, [plan.bounty])[0]! : null

  const { catchOptions } = answer
  s.battle = { id: b.id, state: 'settled', options: catchOptions, until: catchOptions.length ? now + B.catchWindowMs : 0 }
  s.done = [...s.done.filter(x => x !== b.id), b.id].slice(-8)
  return { ...answer, bounty }
}

/** One of the defeated wild creatures becomes a card with the same DNA, genes, traits and level. One-shot. */
export function catchCreature(s: LocalState, ctx: Ctx, req: { battleId: string } & CatchRequest): CardResponse {
  const b = named(s, req.battleId)
  if (b.state !== 'settled' || !b.options.length) return refuse('conflict', 'Nothing is waiting to be caught')
  if (ctx.now >= b.until) return refuse('expired', 'It wandered off')
  const pick = b.options[req.index] ?? refuse('bad_request', 'No creature in that spot')
  if (!hasRoom(s, 1, true)) refuse('cap_reached', TEXT.full)
  // an offline Mythic is a local one: no finder's name, no "1 of 1" (SPEC 28)
  const card = addCards(s, ctx, [cardFromBattleCard(pick, 'catch', ctx.now)])[0]!
  s.battle = { ...b, options: [], until: 0 }
  return { card }
}

/** Touch: a battle left open ten minutes settles with no presses. True when it did. */
export function sweepBattle(s: LocalState, ctx: Ctx): boolean {
  const b = s.battle
  if (b?.state !== 'open' || ctx.now < b.startedAt + B.abandonMs) return false
  settle(s, ctx, b, 'auto')
  return true
}

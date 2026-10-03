// How a finished battle pays (SPEC 5, 13, 14, 22, 24): one plan both worlds apply, the server as one guarded batch and
// the offline save in place, so no settling rule is written twice (SPEC 28). The plan rolls the catch, then the bounty.
import type { FinishBattleResponse, NoticeKind } from './api.ts'
import type { BattleCard, BattleLog, BattleSetup, Card, Family, NewCard, Rng } from './types.ts'
import { applyRating, battleRewards, eloDelta, participants } from './battle.ts'
import { applyXp, cardName, raisingFamily } from './cards.ts'
import { ECONOMY, streakPackDue } from './economy.ts'
import { rollBounty } from './packs.ts'
import { chance } from './rng.ts'

/**
 * `finish` is the attacker's own finish; `auto` is a battle left behind (ten quiet minutes, or a new start). An auto
 * settle rolls no catch, since nobody is there to pick (a Mythic is gone for good), and so keeps beginner's luck for
 * the next wild win; its news arrives as notices instead.
 */
export type SettleMode = 'finish' | 'auto'

export type ArenaCounts = Record<Family, number>

/** Fixed lines for battle notices: results only, never the arena; another player's handle rides alongside. */
export const BATTLE_TEXT = {
  defenseWin: (sparks: number) => `Your team held off a challenger${sparks ? ` · +${sparks} sparks` : ''}`,
  defenseLoss: () => 'A challenger beat your team · revenge is open for a day',
  evolved: (from: string, to: string) => `${from} evolved into ${to}!`,
  dailyPack: () => 'Your first win today brought a pack',
  streakPack: (streak: number) => `Hot streak! ${streak} wins in a row brought a pack`,
}

/** A team card as its world holds it: the card and its arena counts (the server's row carries more). */
export type HeldCard = { card: Card; arena: ArenaCounts }

export type SettleInput<H extends HeldCard> = {
  setup: BattleSetup
  log: BattleLog
  mode: SettleMode
  now: number
  /** the battle's earliest finish: an auto settle rests fainted cards from then */
  finishAfter: number
  rng: Rng
  /** the attacker's cards by id, still theirs; a card that took part but is gone (fused, recycled, traded) earns nothing */
  held: ReadonlyMap<string, H>
  streak: number
  rating: number
  /** the rating Elo settles against when this battle moves rating (a duel inside the pair limit), else null */
  opponentRating: number | null
  /** beginner's luck is spent */
  wildWon: boolean
  /** no win yet this UTC day */
  firstWinDue: boolean
  revenge: boolean
}

export type SettlePlan<H extends HeldCard> = {
  /** the answer, all but the bounty, which its world mints */
  answer: Omit<FinishBattleResponse, 'bounty'>
  /** each team card that took part, as it is now: XP, evolution, raising family, tiredness */
  cards: { held: H; next: Card; arena: ArenaCounts }[]
  /** the defending player's half-sized opposite move (0 when rating stays) */
  defenderDelta: number
  /** a first wild win's catch was offered: beginner's luck is spent */
  luckSpent: boolean
  bounty: NewCard | null
  /** for the attacker on an auto settle, since nobody saw the answer */
  notices: { kind: NoticeKind; text: string }[]
}

export function settlePlan<H extends HeldCard>(o: SettleInput<H>): SettlePlan<H> {
  const { setup, log, now } = o
  const { result } = log
  const win = result === 'win'
  const wild = setup.kind === 'wild'
  const firstWildWin = wild && win && o.mode === 'finish' && !o.wildWon
  const rewards = battleRewards(setup.kind, result, setup.rule, { revenge: o.revenge, firstWildWin })
  const notices: SettlePlan<H>['notices'] = []
  const tell = (kind: NoticeKind, text: string) => { if (o.mode === 'auto') notices.push({ kind, text }) }

  // XP, evolution and arena counts; after a draw or a loss, fainted cards rest 15 minutes from the battle's end: now,
  // or for an auto settle its earliest finish (SPEC 5, Outcomes)
  const tiredUntil = (o.mode === 'finish' ? now : o.finishAfter) + ECONOMY.battle.tiredMs
  const cards: SettlePlan<H>['cards'] = []
  const xp: FinishBattleResponse['xp'] = []
  const tired: string[] = []
  for (const slot of participants(log, 'a')) {
    const held = o.held.get(setup.attacker[slot]!.id)
    if (!held) continue
    const arena = { ...held.arena, [setup.arena]: held.arena[setup.arena] + 1 }
    const grown = applyXp(held.card, rewards.xp, raisingFamily(arena, held.card.family))
    let next = grown.card
    if (!win && log.fainted.a.includes(slot) && tiredUntil > now) {
      next = { ...next, tiredUntil: Math.max(next.tiredUntil, tiredUntil) }
      tired.push(next.id)
    }
    cards.push({ held, next, arena })
    xp.push({ cardId: next.id, xp: rewards.xp, levelsGained: grown.levelsGained, evolved: grown.evolved, stage: next.stage })
    if (grown.evolved) tell('evolved', BATTLE_TEXT.evolved(cardName(held.card), cardName(next)))
  }

  // rating: duels and Rivals inside the pair limit; wild battles leave it be
  const elo = o.opponentRating === null ? null : eloDelta(o.rating, o.opponentRating, result)
  const ratingDelta = elo ? applyRating(o.rating, elo.attacker) - o.rating : 0

  // the streak and its pack, the daily first win
  const streak = win ? o.streak + 1 : 0
  const streakPack = win && streakPackDue(streak)
  const dailyWinPack = win && o.firstWinDue
  if (streakPack) tell('streak-pack', BATTLE_TEXT.streakPack(streak))
  if (dailyWinPack) tell('daily-pack', BATTLE_TEXT.dailyPack())

  // a wild win's catch roll among the creatures it defeated (the first one ever always catches; a win on the round
  // limit may have defeated none, and then beginner's luck waits), a duel win's bounty
  const defeated = setup.defender.filter((_, i) => log.fainted.d.includes(i))
  const catchOptions: BattleCard[] = wild && win && o.mode === 'finish' && defeated.length && chance(o.rng, rewards.catchChance) ? defeated : []
  const bounty = rewards.bountyChance > 0 && chance(o.rng, rewards.bountyChance) ? rollBounty(setup.defender[0]!, o.rng, now, setup.rule) : null

  return {
    answer: {
      result, sparks: rewards.sparks, xp, rating: o.rating + ratingDelta, ratingDelta, catchOptions, dailyWinPack, streak, streakPack,
      tired, log,
    },
    cards, defenderDelta: elo?.defender ?? 0, luckSpent: firstWildWin && catchOptions.length > 0, bounty, notices,
  }
}

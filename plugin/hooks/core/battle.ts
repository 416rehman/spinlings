// The battle simulator (SPEC.md section 5). Deterministic: the same setup and inputs give the same log.
// Specials auto-fire on both sides the moment they are ready. A player press on the round the attacker's special fires
// makes it Perfect (1.3x). Each action draws exactly two numbers (variance, then crit) in action order, so a press on
// round r can never change any round before r.
import type {
  BattleAction, BattleCard, BattleKind, BattleLog, BattleResult, BattleRound, BattleSetup, DailyRule, Family, SpecialId, TraitId,
} from './types.ts'
import { ECONOMY } from './economy.ts'
import { FAMILY_INFO, SPECIALS, typeMult } from './families.ts'
import { statsOf } from './cards.ts'
import { rngFromSeed } from './rng.ts'
import { catchChance, roundLimit } from './world.ts'

/** The battle rules' version (SPEC section 32). Bump it whenever a change alters any battle's log. */
export const RULES_VERSION = 1

type Side = 'a' | 'd'

type Fighter = {
  slot: number
  family: Family
  traits: readonly TraitId[]
  maxHp: number
  hp: number
  atk: number
  def: number
  spd: number
  charge: number
  need: number
  sturdyUsed: boolean
  /** has not acted yet (Ambush) */
  fresh: boolean
  defMult: number
}

function fighter(card: BattleCard, slot: number, rule: DailyRule): Fighter {
  const s = statsOf(card)
  const quick = card.traits.includes('quickCharge') || (rule === 'fableDay' && card.family === 'fable')
  return {
    slot, family: card.family, traits: card.traits, maxHp: s.hp, hp: s.hp, atk: s.atk, def: s.def, spd: s.spd,
    charge: 0, need: quick ? 1 : ECONOMY.battle.chargeNeed, sturdyUsed: false, fresh: true, defMult: 1,
  }
}

export function effectiveSpeed(f: { family: Family; spd: number }, rule: DailyRule): number {
  return f.spd * (rule === 'haikuDay' && f.family === 'haiku' ? ECONOMY.daily.haikuSpd : 1)
}

function nextAlive(team: Fighter[], from: number): number {
  for (let i = Math.max(0, from); i < team.length; i++) if (team[i]!.hp > 0) return i
  return -1
}

/**
 * Simulates a battle. `inputs` are the 1-based rounds on which the player pressed; a press counts only on a round
 * where the attacker's special fires. Cards carrying server stats battle with those stats.
 */
export function simulateBattle(setup: BattleSetup, inputs: readonly number[]): BattleLog {
  const { rule, arena } = setup
  const B = ECONOMY.battle, T = ECONOMY.traits
  const rng = rngFromSeed('battle/' + setup.seed)
  const pressed = new Set(inputs)
  const teams: Record<Side, Fighter[]> = {
    a: setup.attacker.map((c, i) => fighter(c, i, rule)),
    d: setup.defender.map((c, i) => fighter(c, i, rule)),
  }
  const maxHp = { a: teams.a.map(f => f.maxHp), d: teams.d.map(f => f.maxHp) }
  const fainted: { a: number[]; d: number[] } = { a: [], d: [] }
  const active = { a: nextAlive(teams.a, 0), d: nextAlive(teams.d, 0) }
  const rounds: BattleRound[] = []
  const limit = roundLimit(rule)

  const act = (side: Side, me: Fighter, foe: Fighter, round: number): BattleAction => {
    const has = (f: Fighter, t: TraitId) => f.traits.includes(t)
    const fired: TraitId[] = []
    const fire = (t: TraitId) => { if (!fired.includes(t)) fired.push(t) }

    let special: SpecialId | undefined
    if (me.charge >= me.need) {
      special = has(me, 'mimic') ? FAMILY_INFO[foe.family].special : FAMILY_INFO[me.family].special
      if (has(me, 'mimic')) fire('mimic')
    }
    const move = special ? SPECIALS[special] : undefined
    const perfect = move !== undefined && side === 'a' && pressed.has(round)

    const variance = B.variance[0] + (B.variance[1] - B.variance[0]) * rng()
    const crit = rng() < (has(me, 'luckyStar') ? B.luckyCritChance : B.critChance)

    let atk = me.atk * (rule === 'opusDay' && me.family === 'opus' ? ECONOMY.daily.opusAtk : 1)
    if (has(me, 'underdog') && me.hp < T.underdogBelow * me.maxHp) { atk *= T.underdog; fire('underdog') }
    const def = foe.def * foe.defMult
    const raw = (atk * atk) / (atk + def)

    let type = move?.alwaysSuper ? B.typeStrong : typeMult(me.family, foe.family, rule)
    if (type < 1 && has(me, 'stubborn')) { type = 1; fire('stubborn') }
    let arenaMult = 1
    if (me.family === arena) {
      arenaMult = has(me, 'homebody') ? B.homebodyArena : B.arena
      if (has(me, 'homebody')) fire('homebody')
    }
    if (crit && has(me, 'luckyStar')) fire('luckyStar')
    let mods = 1
    if (has(foe, 'thickHide')) { mods *= T.thickHide; fire('thickHide') }
    if (me.fresh && has(me, 'ambush')) { mods *= T.ambush; fire('ambush') }
    if (move && has(me, 'showoff')) { mods *= T.showoff; fire('showoff') }
    const daily = rule === 'gentleDay' ? ECONOMY.daily.gentle : 1
    const critMult = crit ? (rule === 'glassDay' ? B.glassCrit : B.crit) : 1
    const moveMult = (move?.mult ?? 1) * (perfect ? B.perfect : 1)
    const per = Math.max(1, Math.round(raw * type * arenaMult * variance * critMult * moveMult * mods * daily))
    me.fresh = false

    let dealt = 0, hits = 0
    for (let h = 0; h < (move?.hits ?? 1) && foe.hp > 0; h++) {
      let d = per
      if (d >= foe.hp && has(foe, 'sturdy') && !foe.sturdyUsed) {
        d = foe.hp - 1
        foe.sturdyUsed = true
        fire('sturdy')
      }
      foe.hp -= d
      dealt += d
      hits++
    }

    let heal = 0
    if (move) {
      heal += Math.round(me.maxHp * move.heal)
      if (has(me, 'moonlit')) { heal += Math.round(dealt * T.moonlit); fire('moonlit') }
      heal = Math.min(heal, me.maxHp - me.hp)
      me.hp += heal
      me.charge = 0
    } else {
      me.charge = Math.min(me.need, me.charge + 1)
    }

    const targetFainted = foe.hp <= 0
    if (targetFainted) {
      foe.hp = 0
      const foeSide: Side = side === 'a' ? 'd' : 'a'
      fainted[foeSide].push(foe.slot)
      if (has(foe, 'guardian')) {
        const next = nextAlive(teams[foeSide], foe.slot + 1)
        if (next >= 0) { teams[foeSide][next]!.defMult *= T.guardian; fire('guardian') }
      }
    }

    const action: BattleAction = {
      round, side, slot: me.slot, targetSlot: foe.slot, move: move ? 'special' : 'attack',
      hits, dmg: dealt, crit, effect: type > 1 ? 'super' : type < 1 ? 'weak' : 'normal', heal, targetFainted, traits: fired,
    }
    if (special) action.special = special
    if (perfect) action.perfect = true
    return action
  }

  for (let round = 1; round <= limit && active.a >= 0 && active.d >= 0; round++) {
    const A = teams.a[active.a]!, D = teams.d[active.d]!
    const sa = effectiveSpeed(A, rule), sd = effectiveSpeed(D, rule)
    const attackerFirst = sa > sd || (sa === sd && round % 2 === 1)
    const order: [Side, Fighter, Fighter][] = attackerFirst ? [['a', A, D], ['d', D, A]] : [['d', D, A], ['a', A, D]]
    const actions: BattleAction[] = []
    for (const [side, me, foe] of order) {
      if (me.hp <= 0 || foe.hp <= 0) continue
      actions.push(act(side, me, foe, round))
    }
    for (const f of [A, D]) {
      if (f.hp <= 0) continue
      let heal = 0
      if (f.traits.includes('regrowth')) heal += Math.max(1, Math.round(f.maxHp * T.regrowth))
      if (rule === 'sonnetDay' && f.family === 'sonnet') heal += Math.max(1, Math.round(f.maxHp * ECONOMY.daily.sonnetHeal))
      f.hp = Math.min(f.maxHp, f.hp + heal)
    }
    active.a = nextAlive(teams.a, active.a)
    active.d = nextAlive(teams.d, active.d)
    const nextA = active.a >= 0 ? teams.a[active.a]! : undefined
    rounds.push({
      round,
      actions,
      hp: { a: teams.a.map(f => f.hp), d: teams.d.map(f => f.hp) },
      charge: { a: teams.a.map(f => f.charge), d: teams.d.map(f => f.charge) },
      active: { a: active.a, d: active.d },
      attackerSpecialReady: nextA !== undefined && active.d >= 0 && round < limit && nextA.charge >= nextA.need,
    })
  }

  return { rounds, result: outcome(teams), maxHp, fainted }
}

function outcome(teams: Record<Side, Fighter[]>): BattleResult {
  const sum = (t: Fighter[], k: 'hp' | 'maxHp') => t.reduce((n, f) => n + f[k], 0)
  const hpA = sum(teams.a, 'hp'), hpD = sum(teams.d, 'hp')
  if (hpA === 0 && hpD === 0) return 'draw'
  if (hpD === 0) return 'win'
  if (hpA === 0) return 'loss'
  // Compare remaining HP fractions exactly: hpA / maxA vs hpD / maxD.
  const left = hpA * sum(teams.d, 'maxHp'), right = hpD * sum(teams.a, 'maxHp')
  return left > right ? 'win' : left < right ? 'loss' : 'draw'
}

/** The rounds whose attacker special fired: the only rounds where a press does anything (the `[1] Now!` rounds). */
export function perfectRounds(log: BattleLog): number[] {
  return log.rounds.filter(r => r.actions.some(a => a.side === 'a' && a.move === 'special')).map(r => r.round)
}

/** Slots of one side that were in play at the start of some round (they took part and earn xp). */
export function participants(log: BattleLog, side: Side): number[] {
  const out = new Set<number>()
  let current = log.maxHp[side].length > 0 ? 0 : -1
  for (const r of log.rounds) {
    if (current >= 0) out.add(current)
    current = r.active[side]
  }
  return [...out].sort((x, y) => x - y)
}

/** Elo change for the attacker, and the defender's half-sized opposite move. */
export function eloDelta(attacker: number, defender: number, result: BattleResult): { attacker: number; defender: number } {
  const S = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0
  const E = 1 / (1 + 10 ** ((defender - attacker) / 400))
  const delta = Math.round(ECONOMY.rating.k * (S - E))
  return { attacker: delta, defender: -Math.round(delta / 2) }
}

export function applyRating(rating: number, delta: number): number {
  return Math.max(ECONOMY.rating.floor, rating + delta)
}

export type BattleRewards = { sparks: number; xp: number; catchChance: number; bountyChance: number }

export type RewardOptions = {
  /** a revenge duel: a win pays 5 extra sparks */
  revenge?: boolean
  /** the player's first wild win ever always catches (beginner's luck) */
  firstWildWin?: boolean
  /** a duel against a Rival trainer: no bounty card, so duels 2 minutes apart are no card faucet (SPEC 15) */
  rival?: boolean
}

/** What one finished battle pays. Every finished battle pays: there is no daily cap (SPEC section 24). */
export function battleRewards(kind: BattleKind, result: BattleResult, rule: DailyRule, o: RewardOptions = {}): BattleRewards {
  const B = ECONOMY.battle
  const win = result === 'win'
  const sparks = win ? (kind === 'duel' ? B.sparks.duelWin : B.sparks.win) : result === 'draw' ? B.sparks.draw : B.sparks.loss
  return {
    sparks: sparks + (win && kind === 'duel' && o.revenge ? B.revengeBonus : 0),
    xp: B.xp[result],
    catchChance: kind === 'wild' && win ? (o.firstWildWin ? 1 : catchChance(rule)) : 0,
    bountyChance: kind === 'duel' && win && !o.rival ? B.bountyChance : 0,
  }
}


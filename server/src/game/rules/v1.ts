// Rules 1 as shipped in v0.1.0–v0.2.2. Append a new engine for later rules; never retune this one.
// Battle snapshots carry their authoritative stats, so replay needs no current card or species code.
import type {
  BattleAction, BattleCard, BattleLog, BattleResult, BattleRound, BattleSetup, DailyRule, Family, SpecialId, TraitId,
} from '../../../../plugin/hooks/core/types.ts'

const B = {
  roundLimit: 20, longDayRoundLimit: 30, chargeNeed: 2, perfect: 1.3, variance: [0.85, 1],
  crit: 1.5, glassCrit: 2, critChance: 1 / 16, luckyCritChance: 1 / 8, arena: 1.1,
  homebodyArena: 1.2, typeStrong: 1.5, typeWeak: 0.67,
} as const
const T = {
  thickHide: 0.9, regrowth: 0.06, underdogBelow: 0.3, underdog: 1.25,
  ambush: 1.3, moonlit: 0.25, showoff: 1.25, guardian: 1.15,
} as const
const DAILY = { haikuSpd: 1.2, sonnetHeal: 0.04, opusAtk: 1.15, gentle: 0.85 } as const
const MOVES: Record<Family, SpecialId> = { haiku: 'flurry', sonnet: 'couplet', opus: 'crescendo', fable: 'twist' }
const BEATS: Record<Family, Family> = { haiku: 'fable', sonnet: 'haiku', opus: 'sonnet', fable: 'opus' }
const SPECIALS = {
  flurry: { mult: 0.9, hits: 2, heal: 0, alwaysSuper: false },
  couplet: { mult: 1.5, hits: 1, heal: 0.15, alwaysSuper: false },
  crescendo: { mult: 2.1, hits: 1, heal: 0, alwaysSuper: false },
  twist: { mult: 1.6, hits: 1, heal: 0, alwaysSuper: true },
} as const

function typeMult(att: Family, def: Family, rule: DailyRule): number {
  const strong = rule === 'topsyTurvy' ? BEATS[def] === att : BEATS[att] === def
  const weak = rule === 'topsyTurvy' ? BEATS[att] === def : BEATS[def] === att
  return strong ? B.typeStrong : weak ? B.typeWeak : 1
}

// The original cyrb128 + sfc32 stream, including its 12 warm-up draws.
function rngFromSeed(seed: string): () => number {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1; h3 ^= h1; h4 ^= h1
  let a = h1 >>> 0, b = h2 >>> 0, c = h3 >>> 0, d = h4 >>> 0
  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  for (let i = 0; i < 12; i++) next()
  return next
}

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
  fresh: boolean
  defMult: number
}

function fighter(card: BattleCard, slot: number, rule: DailyRule): Fighter {
  const s = card.stats
  if (!s) throw new Error('Battle snapshot has no stats')
  const quick = card.traits.includes('quickCharge') || (rule === 'fableDay' && card.family === 'fable')
  return {
    slot, family: card.family, traits: card.traits, maxHp: s.hp, hp: s.hp, atk: s.atk, def: s.def, spd: s.spd,
    charge: 0, need: quick ? 1 : B.chargeNeed, sturdyUsed: false, fresh: true, defMult: 1,
  }
}

function effectiveSpeed(f: { family: Family; spd: number }, rule: DailyRule): number {
  return f.spd * (rule === 'haikuDay' && f.family === 'haiku' ? DAILY.haikuSpd : 1)
}

function nextAlive(team: Fighter[], from: number): number {
  for (let i = Math.max(0, from); i < team.length; i++) if (team[i]!.hp > 0) return i
  return -1
}

export function simulateBattleV1(setup: BattleSetup, inputs: readonly number[]): BattleLog {
  const { rule, arena } = setup
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
  const limit = rule === 'longDay' ? B.longDayRoundLimit : B.roundLimit

  const act = (side: Side, me: Fighter, foe: Fighter, round: number): BattleAction => {
    const has = (f: Fighter, t: TraitId) => f.traits.includes(t)
    const fired: TraitId[] = []
    const fire = (t: TraitId) => { if (!fired.includes(t)) fired.push(t) }

    let special: SpecialId | undefined
    if (me.charge >= me.need) {
      special = has(me, 'mimic') ? MOVES[foe.family] : MOVES[me.family]
      if (has(me, 'mimic')) fire('mimic')
    }
    const move = special ? SPECIALS[special] : undefined
    const perfect = move !== undefined && side === 'a' && pressed.has(round)

    const variance = B.variance[0] + (B.variance[1] - B.variance[0]) * rng()
    const crit = rng() < (has(me, 'luckyStar') ? B.luckyCritChance : B.critChance)
    let atk = me.atk * (rule === 'opusDay' && me.family === 'opus' ? DAILY.opusAtk : 1)
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
    const daily = rule === 'gentleDay' ? DAILY.gentle : 1
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
      if (rule === 'sonnetDay' && f.family === 'sonnet') heal += Math.max(1, Math.round(f.maxHp * DAILY.sonnetHeal))
      f.hp = Math.min(f.maxHp, f.hp + heal)
    }
    active.a = nextAlive(teams.a, active.a)
    active.d = nextAlive(teams.d, active.d)
    const nextA = active.a >= 0 ? teams.a[active.a]! : undefined
    rounds.push({
      round, actions,
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
  const left = hpA * sum(teams.d, 'maxHp'), right = hpD * sum(teams.a, 'maxHp')
  return left > right ? 'win' : left < right ? 'loss' : 'draw'
}

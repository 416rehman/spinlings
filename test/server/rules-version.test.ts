import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { RULES_VERSION, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { FAMILY_INFO, SPECIALS } from '../../plugin/hooks/core/families.ts'
import type { BattleCard, BattleSetup, DailyRule, Family, Stats, TraitId } from '../../plugin/hooks/core/types.ts'
import { replayRules } from '../../server/src/game/rules/index.ts'
import { simulateBattleV1 } from '../../server/src/game/rules/v1.ts'

// This rules-1 matrix stays fixed when the current engine gains new families, traits or daily rules.
const FAMILIES: Family[] = ['haiku', 'sonnet', 'opus', 'fable']
const DAYS: DailyRule[] = ['haikuDay', 'sonnetDay', 'opusDay', 'fableDay', 'topsyTurvy', 'glassDay', 'longDay', 'gentleDay', 'wildBloom', 'shinyHour', 'fusionFair', 'calm']
const TRAITS: TraitId[] = ['sturdy', 'swift', 'thickHide', 'luckyStar', 'quickCharge', 'glassHeart', 'regrowth', 'underdog', 'ambush', 'moonlit', 'stubborn', 'showoff', 'guardian', 'sleepy', 'homebody', 'mimic']
const STATS: Stats[] = [
  { hp: 380, atk: 45, def: 24, spd: 35 },
  { hp: 35, atk: 84, def: 8, spd: 17 },
  { hp: 390, atk: 6, def: 190, spd: 35 },
]
const INPUTS = [[], Array.from({ length: 30 }, (_, i) => i + 1), [3, 6, 9, 12, 15, 18, 21, 24, 27, 30]]

function card(family: Family, slot: number, traits: TraitId[], stats = STATS[slot % STATS.length]!): BattleCard {
  return {
    id: String.fromCharCode(97 + slot).repeat(26), species: `s1-${family}-0`, season: 1, family,
    rarity: 'common', shiny: false, dna: slot, genes: [0, 5, 10, 15], traits: [...traits], level: 1, stage: 1, stats: { ...stats },
  }
}

function setup(attacker: Family = 'haiku', defender: Family = 'opus', rule: DailyRule = 'calm', traits: TraitId[] = ['guardian']): BattleSetup {
  const team = (family: Family, enemy: boolean) => Array.from({ length: 3 }, (_, slot) =>
    card(FAMILIES[(FAMILIES.indexOf(family) + slot) % 4]!, slot, traits, STATS[(slot + (enemy ? 1 : 0)) % 3]!))
  return { rules: 1, seed: 'rules-one-alpha', kind: 'duel', arena: attacker, rule, attacker: team(attacker, false), defender: team(defender, true) }
}

describe('retained battle rules', () => {
  it('registers the advertised current rules before they can start a battle', () => {
    const battle = { ...setup(), rules: RULES_VERSION }
    assert.deepEqual(replayRules(RULES_VERSION, battle, [3, 6]), simulateBattle(battle, [3, 6]))
  })

  it('matches the shipped rules-1 engine byte for byte across every family, arena, day and individual trait', () => {
    const digest = createHash('sha256')
    const traitSets: TraitId[][] = [[], ...TRAITS.map(t => [t])]
    let cases = 0
    for (const attacker of FAMILIES) for (const defender of FAMILIES) for (const arena of FAMILIES) for (const rule of DAYS) for (const traits of traitSets) for (const seed of ['rules-one-alpha', 'rules-one-zebra']) {
      const battle = { ...setup(attacker, defender, rule, traits), arena, seed }
      for (const inputs of INPUTS) {
        const frozen = JSON.stringify(simulateBattleV1(battle, inputs))
        if (RULES_VERSION === 1) assert.equal(frozen, JSON.stringify(simulateBattle(battle, inputs)), `${attacker}/${defender}/${arena}/${rule}/${traits}/${seed}`)
        digest.update(frozen + '\n')
        cases++
      }
    }
    assert.equal(cases, 78_336)
    // Captured from the released rules-1 engine; stays unchanged after RULES_VERSION advances.
    assert.equal(digest.digest('hex'), '8cf670234fd4304cd0511effa8f870792168f027ce539c907e998dc48c368c65')
  })

  it('covers trait combinations, fainting, swaps, healing, Perfect hits and the full thirty-round limit', () => {
    const combinations: TraitId[][] = [
      ['mimic', 'moonlit', 'showoff', 'quickCharge'],
      ['sturdy', 'guardian', 'regrowth', 'thickHide'],
      ['homebody', 'ambush', 'underdog', 'luckyStar'],
      ['stubborn', 'sleepy', 'glassHeart', 'swift'],
    ]
    for (const traits of combinations) for (const rule of DAYS) for (const inputs of INPUTS) {
      const battle = setup('fable', 'sonnet', rule, traits)
      if (RULES_VERSION === 1) assert.equal(JSON.stringify(simulateBattleV1(battle, inputs)), JSON.stringify(simulateBattle(battle, inputs)))
    }
    const steady = { hp: 999, atk: 1, def: 999, spd: 20 }
    const long = setup('haiku', 'sonnet', 'longDay', ['quickCharge'])
    long.attacker = [card('haiku', 0, ['quickCharge'], steady)]
    long.defender = [card('sonnet', 0, ['quickCharge'], steady)]
    const log = simulateBattleV1(long, INPUTS[1]!)
    assert.equal(log.rounds.length, 30)
    assert.ok(log.rounds.some(r => r.actions.some(a => a.perfect)))
    assert.ok(log.rounds.some(r => r.actions.some(a => a.heal > 0)))
    const swapped = simulateBattleV1(setup(), [])
    assert.ok(swapped.fainted.a.length + swapped.fainted.d.length > 0)
    assert.ok(swapped.rounds.some(r => r.active.a > 0 || r.active.d > 0))
  })

  it('replays stored rules 1 independently of current balance, family moves and matchup tables', () => {
    const battle = setup('haiku', 'opus', 'gentleDay', ['mimic', 'regrowth', 'homebody'])
    const expected = JSON.stringify(simulateBattleV1(battle, [3, 6, 9]))
    const economy = ECONOMY as unknown as { battle: { crit: number; chargeNeed: number }; daily: { gentle: number }; traits: { regrowth: number } }
    const before = { crit: economy.battle.crit, charge: economy.battle.chargeNeed, gentle: economy.daily.gentle, regrowth: economy.traits.regrowth, special: FAMILY_INFO.opus.special, beats: FAMILY_INFO.haiku.beats, move: SPECIALS.crescendo.mult }
    try {
      economy.battle.crit = 99
      economy.battle.chargeNeed = 1
      economy.daily.gentle = 0.1
      economy.traits.regrowth = 0.5
      FAMILY_INFO.opus.special = 'twist'
      FAMILY_INFO.haiku.beats = 'opus'
      SPECIALS.crescendo.mult = 99
      assert.equal(JSON.stringify(replayRules(1, battle, [3, 6, 9])), expected)
    } finally {
      economy.battle.crit = before.crit
      economy.battle.chargeNeed = before.charge
      economy.daily.gentle = before.gentle
      economy.traits.regrowth = before.regrowth
      FAMILY_INFO.opus.special = before.special
      FAMILY_INFO.haiku.beats = before.beats
      SPECIALS.crescendo.mult = before.move
    }
    assert.equal(replayRules(2, { ...battle, rules: 2 }, []), null, 'unimplemented engines never use current rules')
    assert.equal(replayRules(1, { ...battle, rules: 2 }, []), null, 'row and snapshot rules must agree')
    assert.equal(replayRules(9999, { ...battle, rules: 9999 }, []), null)
  })

  it('requires stored stats instead of rebuilding a snapshot with changing card formulas', () => {
    const battle = setup()
    delete (battle.attacker[0] as Partial<BattleCard>).stats
    assert.throws(() => simulateBattleV1(battle, []), /Battle snapshot has no stats/)
    assert.equal(replayRules(1, battle, []), null)
    assert.equal(replayRules(1, null as never, []), null)
  })

  it('keeps the frozen engine free of mutable runtime imports', () => {
    const source = readFileSync(new URL('../../server/src/game/rules/v1.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /^import (?!type\b)/m)
    assert.doesNotMatch(source, /\bimport\s*\(/)
  })
})

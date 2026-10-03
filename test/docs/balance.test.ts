// The balance figures SPEC 5 quotes, pinned so a rules change that moves them shows up (and bumps RULES_VERSION
// knowingly). Random 3v3 teams at level 5 under a random daily rule and arena; fixed seeds, so this is exact.
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { RULES_VERSION, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { rollPack } from '../../plugin/hooks/core/packs.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import type { BattleCard, BattleSetup, DailyRule, Family } from '../../plugin/hooks/core/types.ts'
import { atLevel, NOW } from '../core/helpers.ts'

const FAMILIES: Family[] = ['haiku', 'sonnet', 'opus', 'fable']
const RULES: DailyRule[] = [
  'haikuDay', 'sonnetDay', 'opusDay', 'fableDay', 'topsyTurvy', 'glassDay', 'longDay', 'gentleDay', 'wildBloom', 'shinyHour', 'fusionFair', 'calm',
]
const N = 4000
const PRESS_ALL = Array.from({ length: 30 }, (_, k) => k + 1)

it('SPEC 5 balance: about half with no presses, about 53% / 77% of mirror matches, about 59% of random even duels', { timeout: 120_000 }, () => {
  const wins = { mirror: 0, mirrorPressed: 0, even: 0, evenPressed: 0 }
  for (let i = 0; i < N; i++) {
    const rng = rngFromSeed(`balance-${i}`)
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]!
    const team = (tag: string): BattleCard[] =>
      [0, 1, 2].map(j => atLevel({ ...rollPack(pick(FAMILIES), 1, rng, NOW, 'calm')[0]!, id: `${tag}${j}` }, 5))
    const attacker = team('a')
    const base = { seed: `balance-${i}`, kind: 'duel' as const, arena: pick(FAMILIES), rule: pick(RULES), rules: RULES_VERSION, attacker }
    const mirror: BattleSetup = { ...base, defender: attacker.map(c => ({ ...c, id: `d${c.id}` })) }
    const even: BattleSetup = { ...base, defender: team('d') }
    if (simulateBattle(mirror, []).result === 'win') wins.mirror++
    if (simulateBattle(mirror, PRESS_ALL).result === 'win') wins.mirrorPressed++
    if (simulateBattle(even, []).result === 'win') wins.even++
    if (simulateBattle(even, PRESS_ALL).result === 'win') wins.evenPressed++
  }
  const near = (got: number, spec: number, what: string) =>
    assert.ok(Math.abs((100 * got) / N - spec) <= 3, `${what}: ${((100 * got) / N).toFixed(1)}%, SPEC 5 says about ${spec}%`)
  near(wins.mirror, 53, 'mirror matches, no presses')
  near(wins.mirrorPressed, 77, 'mirror matches, every special pressed')
  near(wins.even, 50, 'random even duels, no presses')
  near(wins.evenPressed, 59, 'random even duels, every special pressed')
})

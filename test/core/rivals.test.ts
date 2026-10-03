import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BattleSetup } from '../../plugin/hooks/core/types.ts'
import { RULES_VERSION, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { cardPower } from '../../plugin/hooks/core/cards.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { rivalScale, rollRival } from '../../plugin/hooks/core/rivals.ts'
import { parseBattleCard } from '../../plugin/hooks/core/schemas.ts'
import { starterTeam } from '../../plugin/hooks/core/cards.ts'
import { atLevel, NOW } from './helpers.ts'

test('rival scale: 1.0 at 1000, tougher with rating, clamped', () => {
  assert.equal(rivalScale(1000), 1)
  assert.ok(Math.abs(rivalScale(1400) - 1.08) < 1e-9)
  assert.equal(rivalScale(0), 0.85)
  assert.equal(rivalScale(9000), 1.25)
})

test('a Rival is named, rated near the player, and its team matches the player team power', () => {
  const rng = rngFromSeed('rival')
  for (const [power, size, rating] of [[140, 1, 1000], [420, 3, 1000], [900, 3, 1500], [700, 2, 600], [1000, 3, 1000]] as const) {
    for (let i = 0; i < 30; i++) {
      const r = rollRival({ rng, now: NOW, rating, power, size })
      assert.match(r.name, /^[A-Z][a-z]+$/)
      assert.ok(Math.abs(r.rating - rating) <= 50)
      assert.equal(r.team.length, size)
      r.team.forEach((c, slot) => {
        assert.equal(c.id, `rival-${slot}`)
        assert.notEqual(c.rarity, 'legendary')
        assert.doesNotThrow(() => parseBattleCard(c))
      })
      const total = r.team.reduce((n, c) => n + cardPower(c), 0)
      const target = power * rivalScale(rating)
      assert.ok(Math.abs(total - target) / target < 0.25, `power ${total} vs ${target}`)
    }
  }
  // a team weaker than any creature meets the humblest Rival there is: level-1 commons
  const tiny = rollRival({ rng, now: NOW, rating: 1000, power: 10, size: 3 })
  for (const c of tiny.team) assert.deepEqual([c.level, c.rarity], [1, 'common'])
})

test('a never-pressing player wins about half of duels against Rivals sized to their own team', () => {
  let wins = 0
  const n = 600
  for (let i = 0; i < n; i++) {
    const rng = rngFromSeed('rv' + i)
    const level = 1 + (i % 10)
    const team = starterTeam((['haiku', 'sonnet', 'opus', 'fable'] as const)[i % 4]!, rng, NOW).map((c, j) => atLevel({ ...c, id: 'a' + j }, level))
    const power = team.reduce((s, c) => s + cardPower(c), 0)
    const rival = rollRival({ rng, now: NOW, rating: 1000, power, size: team.length })
    const setup: BattleSetup = { seed: 'rv-' + i, kind: 'duel', arena: 'opus', rule: 'calm', rules: RULES_VERSION, attacker: team, defender: rival.team }
    if (simulateBattle(setup, []).result === 'win') wins++
  }
  assert.ok(wins / n > 0.35 && wins / n < 0.65, `wins ${wins / n}`)
})

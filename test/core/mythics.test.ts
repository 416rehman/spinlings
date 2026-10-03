import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyXp, cardFromBattleCard, cardName, cardStats, geneMult, recycleValue, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { FAMILIES, FAMILY_INFO, inHueRange } from '../../plugin/hooks/core/families.ts'
import { generateMythic, mythicForm, mythicSeed } from '../../plugin/hooks/core/mythics.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { parseCard } from '../../plugin/hooks/core/schemas.ts'
import { seasonOf } from '../../plugin/hooks/core/world.ts'
import { NOW } from './helpers.ts'

test('a Mythic form comes entirely from its seed: family, body, hue, name, 1.1x the legendary base', () => {
  const families = new Set<string>(), bodies = new Set<string>(), names = new Set<string>()
  for (let i = 0; i < 400; i++) {
    const f = mythicForm('seed-' + i)
    assert.deepEqual(mythicForm('seed-' + i), f)
    assert.equal(f.kind, 'mythic')
    assert.equal(f.seed, 'seed-' + i)
    assert.equal(f.legendary, true)
    assert.ok(inHueRange(f.family, f.hue))
    assert.ok(['halo', 'wings', 'spikes'].includes(f.accessory))
    assert.equal(f.names[0], f.names[1])
    assert.equal(f.names[1], f.names[2])
    assert.match(f.names[0], /^[A-Z][a-z]+ [A-Z][a-z]+$/)
    const b = FAMILY_INFO[f.family].bias, m = 1.15 * 1.1
    const shareHp = f.base.hp / m - 20
    assert.ok(Math.abs(shareHp - b.hp) <= 8.05, `hp share ${shareHp}`)
    families.add(f.family); bodies.add(f.body); names.add(f.names[0])
  }
  assert.equal(families.size, 4)
  assert.equal(bodies.size, 6)
  assert.ok(names.size > 350)
})

test('a Mythic card: species mythic, legendary, foil, final form, stats from its own form', () => {
  const c = generateMythic({ seed: 'abc', dna: 42, now: NOW, level: 6, shiny: true })
  assert.deepEqual([c.species, c.rarity, c.foil, c.stage, c.level, c.shiny, c.origin, c.season], ['mythic', 'legendary', true, 3, 6, true, 'catch', seasonOf(NOW)])
  assert.equal(c.family, c.form!.family)
  assert.equal(c.traits.length, 2)
  assert.deepEqual(c.stats, cardStats(c))
  assert.equal(c.stats.hp, Math.max(1, Math.round(c.form!.base.hp * geneMult(c.genes[0]) * 1.3 * (1 + 0.07 * 5) * ECONOMY.stats.stageMult[2] * (c.traits.includes('glassHeart') ? 0.85 : 1) * (c.traits.includes('sleepy') ? 1.15 : 1))))
  assert.equal(cardName(c), c.form!.names[0])
  assert.doesNotThrow(() => parseCard({ ...c, id: 'm1' }))
  assert.equal(applyXp(c, 10_000).evolved, false, 'Mythics never evolve')
  assert.equal(recycleValue(c), 250 * 2 * 1.5 * 2)
})

test('a caught Mythic keeps its form and records who discovered it', () => {
  const c = generateMythic({ seed: 'caught', dna: 1, now: NOW, level: 3 })
  const won = cardFromBattleCard(toBattleCard({ ...c, id: 'wild-0' }), 'catch', NOW, { discoveredBy: 'brave-wren-41' })
  assert.equal(won.form!.discoveredBy, 'brave-wren-41')
  assert.deepEqual({ ...won.form, discoveredBy: undefined }, { ...c.form, discoveredBy: undefined })
  assert.equal(c.form!.discoveredBy, undefined, 'the original is untouched')
})

test('Mythic seeds are 80 random bits in base32', () => {
  const rng = rngFromSeed('seeds')
  const seen = new Set<string>()
  for (let i = 0; i < 1000; i++) {
    const s = mythicSeed(rng)
    assert.match(s, /^[a-z2-7]{16}$/)
    seen.add(s)
  }
  assert.equal(seen.size, 1000)
  assert.ok(FAMILIES.length === 4)
})

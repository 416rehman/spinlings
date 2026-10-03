import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PromoEgg } from '../../plugin/hooks/core/types.ts'
import { applyXp, cardName, cardStats, look } from '../../plugin/hooks/core/cards.ts'
import { dropItems, mintDropReward, normalizeDropCode, promoCard, promoForm } from '../../plugin/hooks/core/drops.ts'
import { inHueRange } from '../../plugin/hooks/core/families.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { parseCard, parseDropReward } from '../../plugin/hooks/core/schemas.ts'
import { getSpecies } from '../../plugin/hooks/core/species.ts'
import { NOW } from './helpers.ts'

const egg: PromoEgg = { seed: 'founders-2026', name: 'Foundling', family: 'fable', rarity: 'epic', foil: true, stamp: 'Founder · Oct 2026' }

test('codes compare upper case without dashes or spaces', () => {
  assert.equal(normalizeDropCode('golden-7q2m-k9xd'), 'GOLDEN7Q2MK9XD')
  assert.equal(normalizeDropCode('Founders'), 'FOUNDERS')
  assert.equal(normalizeDropCode('gold en-1'), 'GOLDEN1')
})

test('everyone gets the same promo creature, each with personal DNA', () => {
  const f = promoForm(egg)
  assert.deepEqual(promoForm(egg), f)
  assert.deepEqual([f.kind, f.family, f.names, f.legendary, f.seed, f.stamp], ['promo', 'fable', ['Foundling', 'Foundling', 'Foundling'], false, egg.seed, egg.stamp])
  assert.ok(inHueRange('fable', f.hue))
  const a = promoCard(egg, 1, NOW), b = promoCard(egg, 2, NOW)
  assert.deepEqual(a.form, b.form)
  assert.notDeepEqual([a.genes, look(a)], [b.genes, look(b)])
  assert.deepEqual([a.species, a.rarity, a.foil, a.bound, a.origin, a.stage, a.traits.length], ['promo', 'epic', true, true, 'promo', 1, 2])
  assert.deepEqual(a.stats, cardStats(a))
  assert.equal(cardName(a), 'Foundling')
  assert.equal(promoCard(egg, 1, NOW, false).bound, false, 'fixed-supply drops may be tradeable')
  assert.doesNotThrow(() => parseCard({ ...a, id: 'p' }))
  const grown = applyXp(a, 10_000).card
  assert.equal(grown.stage, 3, 'a non-legendary promo evolves like any creature')
  const legend = promoCard({ ...egg, rarity: 'legendary', foil: false }, 3, NOW)
  assert.deepEqual([legend.stage, legend.foil, legend.form!.legendary], [3, true, true])
})

test('a reward mints its eggs, cards and packs', () => {
  const reward = parseDropReward([{ type: 'egg', promo: egg }, { type: 'pack', count: 2 }, { type: 'pack', family: 'opus', count: 1 }, { type: 'card', rarity: 'legendary', family: 'haiku' }])
  assert.equal(dropItems(reward).length, 4)
  assert.deepEqual(dropItems(reward[0 as never] as never), [reward[0 as never]])
  const got = mintDropReward(reward, rngFromSeed('drop'), NOW, true)
  assert.equal(got.cards.length, 2)
  assert.equal(got.packs.length, 3)
  assert.equal(got.packs[2], 'opus')
  const [promo, legend] = got.cards
  assert.equal(promo!.species, 'promo')
  assert.equal(getSpecies(legend!.species)!.legendary, true)
  assert.deepEqual([legend!.family, legend!.rarity, legend!.origin, legend!.bound, legend!.stage], ['haiku', 'legendary', 'promo', true, 3])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Card, TraderDeal } from '../../plugin/hooks/core/types.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { parse, parseCard, traderDealSchema } from '../../plugin/hooks/core/schemas.ts'
import { getSpecies } from '../../plugin/hooks/core/species.ts'
import { rollTraderDeal, traderDeals, traderGiveProblem } from '../../plugin/hooks/core/trader.ts'
import { DAY_MS, seasonOf, utcDay } from '../../plugin/hooks/core/world.ts'
import { card, NOW, speciesOf } from './helpers.ts'

test('three deals a day, the same for everyone that day, and they change from day to day', () => {
  const kinds = new Set<string>()
  let changed = 0
  for (let d = 0; d < 60; d++) {
    const now = NOW + d * DAY_MS
    const deals = traderDeals(now)
    assert.deepEqual(traderDeals(now + 3_600_000 * (23 - new Date(now).getUTCHours()) - 1), deals, 'stable within the UTC day')
    assert.equal(deals.length, 3)
    assert.deepEqual(deals.map(x => x.id), [0, 1, 2].map(k => `${utcDay(now)}-${k}`))
    assert.equal(new Set(deals.map(x => x.name)).size, 3)
    for (const deal of deals) {
      assert.deepEqual(parse(traderDealSchema, deal), deal)
      kinds.add(deal.name)
      if (deal.give.family && deal.get.family && deal.name === 'A pair for a rare') assert.notEqual(deal.give.family, deal.get.family)
    }
    if (JSON.stringify(deals.map(x => x.name)) !== JSON.stringify(traderDeals(now - DAY_MS).map(x => x.name))) changed++
  }
  assert.equal(kinds.size, 5)
  assert.ok(changed > 30)
})

const pair: TraderDeal = { id: '2026-10-04-0', name: 'A pair for a rare', give: { count: 2, family: 'opus' }, get: { kind: 'cards', count: 1, rarity: 'rare', family: 'haiku' } }

test('the Trader checks what is handed over: count, family, rarity, and only free cards', () => {
  const a = card(speciesOf('opus', 1), { id: 'a' }, 1), b = card(speciesOf('opus', 2), { id: 'b' }, 2)
  assert.equal(traderGiveProblem(pair, [a, b], NOW), null)
  assert.match(traderGiveProblem(pair, [a], NOW)!, /2 cards/)
  assert.match(traderGiveProblem(pair, [a, a], NOW)!, /same card/)
  assert.match(traderGiveProblem(pair, [a, card(speciesOf('haiku', 1), { id: 'h' })], NOW)!, /opus/)
  for (const over of [{ bound: true }, { state: 'escrow' as const }, { lockedUntil: NOW + 1 }] as Partial<Card>[]) {
    assert.match(traderGiveProblem(pair, [a, { ...b, ...over }], NOW)!, /cannot be traded/)
  }
  const epic: TraderDeal = { id: '2026-10-04-1', name: 'One epic, two rares', give: { count: 1, rarity: 'epic' }, get: { kind: 'cards', count: 2, rarity: 'rare', family: 'opus' } }
  assert.match(traderGiveProblem(epic, [a], NOW)!, /epic/)
  assert.equal(traderGiveProblem(epic, [{ ...a, rarity: 'epic' }], NOW), null)
})

test('the Trader hands back fresh current-season cards, or packs', () => {
  const rng = rngFromSeed('trade')
  const got = rollTraderDeal({ ...pair, get: { kind: 'cards', count: 2, rarity: 'rare', family: 'haiku' } }, rng, NOW)
  assert.equal(got.packs.length, 0)
  assert.equal(got.cards.length, 2)
  for (const c of got.cards) {
    assert.deepEqual([c.family, c.rarity, c.origin, c.season, c.level, c.bound], ['haiku', 'rare', 'trader', seasonOf(NOW), 1, false])
    assert.equal(getSpecies(c.species)!.legendary, false)
    assert.doesNotThrow(() => parseCard({ ...c, id: 'x' }))
  }
  assert.deepEqual(rollTraderDeal({ ...pair, get: { kind: 'pack', count: 1, family: 'fable' } }, rng, NOW), { cards: [], packs: ['fable'] })
})

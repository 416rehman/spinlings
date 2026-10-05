// Exact seller prices and suggestions use existing whole-spark amounts and observed comparable sales only.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SaleView } from '../../plugin/hooks/core/api.ts'
import { craftCost } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { parsePrice, priceHints, startPrice } from '../../plugin/hooks/client/viewmodels.ts'

const card = { rarity: 'rare' as const, shiny: false, foil: false }
const sale = (price: number, over: Partial<SaleView> = {}): SaleView => ({
  day: '2026-10-04', price, rarity: card.rarity, shiny: card.shiny, foil: card.foil, ...over,
})

test('seller prices accept exact whole amounts through the ceiling, never decimal or coerced text', () => {
  for (const [text, expected] of [['1', 1], ['7321', 7321], [' 7,321 ', 7321], ['1000000', ECONOMY.market.maxPrice], ['1,000,000', ECONOMY.market.maxPrice]] as const)
    assert.equal(parsePrice(text), expected)
  for (const text of ['', '0', '-5', '1.5', '1e3', '+10', 'Infinity', 'NaN', '1000001', '1 000', '1,23', '1000,000', '7,321 sparks'])
    assert.equal(parsePrice(text), null, text)
})

test('recent average counts only matching observed sales and rounds their real arithmetic mean', () => {
  const sales = [sale(101), sale(203), sale(303), sale(900000, { shiny: true }), sale(800000, { foil: true }), sale(700000, { rarity: 'epic' })]
  const hints = priceHints(card, sales)
  assert.deepEqual(hints.slice(0, 2), [
    { price: 101, label: 'last sale' },
    { price: 202, label: 'recent average · 3 sales' },
  ])
  assert.equal(startPrice(card, sales), 101)
  assert.ok(hints.length <= 3)
})

test('no or one matching sale has no manufactured average or finish premium', () => {
  assert.deepEqual(priceHints(card, undefined), [{ price: craftCost(card.rarity), label: 'craft reference' }])
  const foil = { ...card, foil: true, shiny: true }
  assert.deepEqual(priceHints(foil, [sale(700), sale(900)]), [{ price: craftCost(foil.rarity), label: 'craft reference' }])
  const one = priceHints(foil, [sale(701, { shiny: true, foil: true }), sale(900)])
  assert.deepEqual(one, [{ price: 701, label: 'last sale' }, { price: craftCost(foil.rarity), label: 'craft reference' }])
})

test('equal matching sales retain their sample count without repeated price buttons', () => {
  const hints = priceHints(card, [sale(111), sale(111)])
  assert.deepEqual(hints[0], { price: 111, label: 'last sale / recent average · 2 sales' })
  assert.equal(new Set(hints.map(h => h.price)).size, hints.length)
})

import assert from 'node:assert/strict'
import { it } from 'node:test'
import { demoSteps } from '../../plugin/hooks/client/demo.ts'
import { revealSummary } from '../../plugin/hooks/client/viewmodels.ts'

const NOW = Date.UTC(2026, 9, 2, 12)

it('pack demo states contain two cards and stop at their actual reveal count', () => {
  const scenes = demoSteps(NOW).filter(s => s.title.startsWith('Pack ·'))
  assert.equal(scenes.length, 4)
  for (const scene of scenes) {
    const r = scene.state.reveal!
    assert.equal(r.kind, 'pack')
    assert.equal(r.cards.length, 2)
    assert.equal(r.cards[0]!.rarity, 'common')
    assert.equal(r.cards[1]!.rarity, 'legendary')
    assert.equal(r.cards[1]!.foil, true)
    assert.ok(scene.state.pane.flipped <= r.cards.length)
    assert.deepEqual(r.fresh, r.cards.map(c => c.species))
  }
  const waiting = scenes.find(s => s.title === 'Pack · one turned, a gold back waiting')!
  assert.equal(waiting.state.pane.flipped, 1)
  const summary = scenes.find(s => s.title === 'Pack · the summary')!
  assert.equal(summary.state.pane.flipped, 2)
  assert.equal(revealSummary(summary.state.reveal!), '2 cards · 2 new species · Album 14/36 (+2)')
})

it('collection, fusion and market examples keep valid cards outside the shortened pack', () => {
  const scenes = demoSteps(NOW)
  const summary = scenes.find(s => s.title === 'Pack · the summary')!
  const packIds = new Set(summary.state.reveal!.cards.map(c => c.id))
  for (const title of ['Album · a species, craft and wishlist', 'Market · a swap: pick the card you give', 'Sell · sparks and a card from the wishlist', 'Sell · a card only']) {
    const scene = scenes.find(s => s.title === title)!
    const view = scene.state.pane.stack.at(-1)!
    assert.ok(scene, title)
    const card = 'cardId' in view
      ? scene.state.cards.find(c => c.id === view.cardId)
      : 'speciesId' in view ? scene.state.cards.find(c => c.species === view.speciesId) : undefined
    assert.ok(card, title)
    assert.ok(!packIds.has(card.id), title)
  }
  const legendary = scenes.find(s => s.title === 'Card · a legendary shiny foil')!
  const v = legendary.state.pane.stack.at(-1)!
  const c = 'cardId' in v ? legendary.state.cards.find(c => c.id === v.cardId) : undefined
  assert.ok(c?.shiny && c.foil && c.rarity === 'legendary')
  assert.equal(scenes.find(s => s.title === 'Fusion · hatched')!.state.reveal!.cards[0]!.origin, 'fusion')
})

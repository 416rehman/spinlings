// Opening every pack at once (SPEC 13.5): ten to a request, at most five best pulls first and rising to the top one,
// a new species told once, and the summary's groups, stacks and words.
import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Card } from '../../plugin/hooks/core/types.ts'
import { BEST_MAX, CHUNK, bulkReady, bulkSummary, chunks, pullOrder, rarityGroups, topPull, turns } from '../../plugin/hooks/client/bulk.ts'
import type { Reveal } from '../../plugin/hooks/client/types.ts'

type Pull = Pick<Card, 'id' | 'species' | 'rarity' | 'shiny' | 'foil' | 'firstFind'>
const pull = (id: string, species: string, rarity: Card['rarity'], extra: Partial<Pull> = {}): Pull => ({ id, species, rarity, shiny: false, ...extra })

it('opens ten packs to a request, the last request taking what is left', () => {
  assert.equal(CHUNK, 10)
  const ids = Array.from({ length: 23 }, (_, i) => `p${i}`)
  assert.deepEqual(chunks(ids).map(c => c.length), [10, 10, 3])
  assert.deepEqual(chunks(ids).flat(), ids)
  assert.deepEqual(chunks([]), [])
})

it('puts the best pulls first, rising to the top one: Mythic, legendary, epic, rare, then a first find, foil, Alt colour and a new species', () => {
  const cards = [
    pull('c1', 's1-a', 'common'), pull('r1', 's1-b', 'rare'), pull('n1', 's1-new', 'common'), pull('e1', 's1-c', 'epic'),
    pull('f1', 's1-d', 'common', { foil: true }), pull('l1', 's1-e', 'legendary'), pull('m1', 'mythic', 'epic'),
    pull('x1', 's1-f', 'common', { firstFind: true }), pull('a1', 's1-g', 'common', { shiny: true }), pull('c2', 's1-a', 'common'),
  ]
  const { cards: sorted, best } = pullOrder(cards, new Set(['s1-new']))
  // the five beats build up to the Mythic; the rest follow best first
  assert.deepEqual(sorted.map(c => c.id), ['x1', 'r1', 'e1', 'l1', 'm1', 'f1', 'a1', 'n1', 'c1', 'c2'])
  assert.equal(best, BEST_MAX)
  assert.equal(BEST_MAX, 5)
  assert.equal(topPull({ cards: sorted as Card[], bulk: { packs: 10, opened: 10, best } })?.id, 'm1')
})

it('tells a new species once, on its best copy, and gives plain commons no beat', () => {
  const cards = [pull('a', 's1-new', 'common'), pull('b', 's1-new', 'common'), pull('c', 's1-old', 'common'), pull('d', 's1-new', 'rare')]
  const { cards: sorted, best } = pullOrder(cards, new Set(['s1-new']))
  assert.deepEqual(sorted.map(c => c.id), ['d', 'a', 'b', 'c'])
  // the rare is the new species' best copy; its two commons and the old common are not news
  assert.equal(best, 1)
  assert.equal(pullOrder([pull('a', 's1-x', 'common')], new Set()).best, 0)
  assert.equal(topPull({ cards: [pull('a', 's1-x', 'common')] as Card[], bulk: { packs: 1, opened: 1, best: 0 } })?.id, 'a')
})

it('groups the summary rarest first, leaving empty groups out', () => {
  const cards = [pull('c', 's1-a', 'common'), pull('l', 's1-b', 'legendary'), pull('r', 's1-c', 'rare'), pull('c2', 's1-d', 'common')] as Card[]
  assert.deepEqual(rarityGroups(cards).map(g => [g.label, g.count, g.stacks.map(s => s.card.id)]), [['Legendary', 1, ['l']], ['Rare', 1, ['r']], ['Common', 2, ['c', 'c2']]])
})

it('stacks identical pulls into one chip, so fifty packs fit a screen, and keeps one-of-a-kind cards apart', () => {
  const commons = Array.from({ length: 40 }, (_, i) => pull(`c${i}`, `s1-${'abcd'[i % 4]}`, 'common'))
  const cards = [
    ...commons, pull('alt', 's1-a', 'common', { shiny: true }), pull('foil', 's1-a', 'common', { foil: true }),
    pull('ff', 's1-e', 'rare', { firstFind: true }), pull('r2', 's1-e', 'rare'), pull('r3', 's1-e', 'rare'),
    pull('m1', 'mythic', 'epic'), pull('m2', 'mythic', 'epic'), pull('new', 's1-z', 'common'),
  ] as Card[]
  const groups = rarityGroups(cards, new Set(['s1-z']))
  assert.deepEqual(groups.map(g => [g.label, g.count, g.stacks.map(s => [s.card.id, s.count])]), [
    ['Mythic', 2, [['m1', 1], ['m2', 1]]],
    ['Rare', 3, [['ff', 1], ['r2', 2]]],
    // Foil over Alt colour over a new species over plain copies, each plain species stacked
    ['Common', 43, [['foil', 1], ['alt', 1], ['new', 1], ['c0', 10], ['c1', 10], ['c2', 10], ['c3', 10]]],
  ])
  // every card is still counted once
  assert.equal(groups.reduce((n, g) => n + g.stacks.reduce((k, s) => k + s.count, 0), 0), cards.length)
})

it('says what came out, and what is still waiting when some packs could not open', () => {
  const base: Reveal = {
    id: 'r', kind: 'pack', family: 'opus', cards: [pull('a', 's1-a', 'rare'), pull('b', 's1-b', 'common')] as Card[], packs: [],
    fresh: ['s1-b'], album: { before: 12, after: 13, total: 36 }, torn: true, bulk: { packs: 2, opened: 2, best: 2 },
  }
  assert.equal(bulkSummary(base), '2 packs · 2 cards · 1 new species · Album 13/36 (+1)')
  assert.equal(bulkSummary({ ...base, bulk: { packs: 12, opened: 2, best: 2 } }), '2 packs · 2 cards · 1 new species · Album 13/36 (+1) · 10 still waiting')
  assert.equal(turns(base), 2)
  assert.equal(turns({ ...base, bulk: { packs: 2, opened: 2, best: 1 } }), 1)
  assert.equal(turns({ ...base, bulk: undefined }), 2)
  assert.equal(bulkReady({ bulk: { packs: 2, opened: 1 } }), false)
  assert.equal(bulkReady(base), true)
  assert.equal(bulkReady({}), true)
})

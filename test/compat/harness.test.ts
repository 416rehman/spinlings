import assert from 'node:assert/strict'
import { it } from 'node:test'
import { card, NOW, speciesOf } from '../core/helpers.ts'
import { bindAnswer, choosePackCards } from './harness.ts'

const fresh = (id: string) => card(speciesOf('fable'), { id })

it('shorter, reordered collection answers preserve action identities and never position-bind omitted pack cards', () => {
  const bound = new Map<string, string>()
  const omitted = new Set(['<card:3>', '<card:4>', '<card:5>'])
  bindAnswer({ cards: [1, 2, 3, 4, 5].map(n => ({ id: `<card:${n}>` })) },
    { cards: [{ id: 'first' }, { id: 'last' }] }, bound, omitted)
  bound.set('<card:6>', 'starter')
  bindAnswer({ cards: [{ id: '<card:3>' }, { id: '<card:2>' }, { id: '<card:1>' }, { id: '<card:6>' }] },
    { cards: [{ id: 'starter' }, { id: 'first' }, { id: 'last' }] }, bound, omitted)
  assert.deepEqual([...bound], [['<card:1>', 'first'], ['<card:2>', 'last'], ['<card:6>', 'starter']])
  // A new list item also cannot alias an entity that an earlier action already named.
  bindAnswer([{ id: '<card:7>' }], [{ id: 'first' }], bound, omitted)
  assert.ok(!bound.has('<card:7>'))
})

it('omitted pack cards select distinct observed free cards while preserving every referenced action identity', () => {
  const omitted = new Map([['<card:3>', fresh('<card:3>')], ['<card:4>', fresh('<card:4>')]])
  const bound = new Map([['<card:1>', 'original'], ['<card:2>', 'unused-in-this-flow']])
  const referenced = new Set(['<card:1>', '<card:3>', '<card:4>'])
  const chosen = choosePackCards({ refs: ['<card:3>', '<card:4>'], omitted,
    cards: [fresh('original'), fresh('unused-in-this-flow'), fresh('second-free')], team: [], now: NOW, bound, referenced })
  assert.equal(chosen.size, 2)
  assert.equal(new Set(chosen.values()).size, 2, 'two fusion or trade inputs remain different cards')
  assert.deepEqual(new Set(chosen.values()), new Set(['unused-in-this-flow', 'second-free']))
  assert.deepEqual([...bound], [['<card:1>', 'original'], ['<card:2>', 'unused-in-this-flow']], 'selection does not mutate known bindings')
})

it('selection obeys the observed listing or Trader requirements rather than the historical card preference', () => {
  const historical = fresh('<card:3>')
  const eligible = card(speciesOf('opus'), { id: 'eligible', rarity: 'rare', shiny: true, foil: true, firstFind: true })
  const chosen = choosePackCards({ refs: ['<card:3>'], omitted: new Map([['<card:3>', historical]]),
    cards: [historical, { ...eligible, id: 'wrong-species', species: 's1-opus-1' },
      { ...eligible, id: 'wrong-rarity', rarity: 'common' }, { ...eligible, id: 'not-shiny', shiny: false },
      { ...eligible, id: 'not-foil', foil: undefined }, { ...eligible, id: 'not-first', firstFind: undefined }, eligible],
    team: [], now: NOW, bound: new Map(), referenced: new Set(['<card:3>']),
    requirement: { species: eligible.species, family: 'opus', rarity: 'rare', shiny: true, foil: true, firstFind: true } })
  assert.equal(chosen.get('<card:3>'), 'eligible')
})

it('selection fails explicitly instead of manufacturing, consuming unavailable cards or reusing another input', () => {
  const omitted = new Map([['<card:3>', fresh('<card:3>')], ['<card:4>', fresh('<card:4>')]])
  const bound = new Map([['<card:1>', 'reserved']])
  const base = { refs: ['<card:3>'], omitted, team: ['team-card'], now: NOW, bound, referenced: new Set(['<card:1>', '<card:3>', '<card:4>']) }
  const unavailable = [fresh('reserved'), fresh('team-card'), { ...fresh('bound'), bound: true },
    { ...fresh('held'), state: 'escrow' as const }, { ...fresh('locked'), lockedUntil: NOW + 1 },
    { ...fresh('tired'), tiredUntil: NOW + 1 }]
  assert.throws(() => choosePackCards({ ...base, cards: unavailable }), /no observed free card/)
  assert.throws(() => choosePackCards({ ...base, refs: ['<card:3>', '<card:4>'], cards: [fresh('only-one')] }), /no observed free card/)
  assert.throws(() => choosePackCards({ ...base, refs: ['<card:99>'], cards: [fresh('free')] }), /was not omitted/)
  assert.deepEqual([...bound], [['<card:1>', 'reserved']], 'failed selections leave every existing binding intact')
})

it('Market accepts a higher-rarity payment while the Trader keeps its exact-rarity requirement', () => {
  const o = { refs: ['<card:3>'], omitted: new Map([['<card:3>', fresh('<card:3>')]]),
    cards: [card(speciesOf('opus'), { id: 'higher-rarity', rarity: 'epic' })], team: [], now: NOW,
    bound: new Map<string, string>(), referenced: new Set(['<card:3>']), requirement: { family: 'opus' as const, rarity: 'rare' as const } }
  assert.equal(choosePackCards({ ...o, market: true }).get('<card:3>'), 'higher-rarity')
  assert.throws(() => choosePackCards(o), /no observed free card/)
})

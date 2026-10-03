import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ARMS, EARS, HEADS, LEGS, MUZZLES, TAILS, WINGS, exalt, grow, hybrid, partsFor } from '../../plugin/hooks/core/parts.ts'
import { BODIES, seasonSpecies } from '../../plugin/hooks/core/species.ts'

test('parts are deterministic per seed and always in range', () => {
  for (const torso of BODIES) for (let i = 0; i < 200; i++) {
    const p = partsFor(`range/${torso}/${i}`, torso)
    assert.deepEqual(partsFor(`range/${torso}/${i}`, torso), p)
    assert.equal(p.torso, torso)
    assert.ok(HEADS.includes(p.head) && EARS.includes(p.ears) && WINGS.includes(p.wings) && TAILS.includes(p.tail))
    assert.ok(LEGS.includes(p.legs) && ARMS.includes(p.arms) && MUZZLES.includes(p.muzzle))
    for (const [k, lo, hi] of [['earSize', 1, 3], ['tailSize', 1, 3], ['eyeGap', 1, 3], ['tw', 3, 6], ['hw', 3, 6], ['th', 3, 10], ['hh', 4, 6]] as const) {
      assert.ok(p[k] >= lo && p[k] <= hi, `${torso} ${k} ${p[k]}`)
    }
    assert.ok(p.side === 1 || p.side === -1)
    if (p.head === 'merged') assert.ok(p.th >= 7 && p.tw >= 4, 'a merged head has room for a face')
  }
})

test('each archetype keeps its character but grows a wide range of parts', () => {
  for (const torso of BODIES) {
    const ps = Array.from({ length: 400 }, (_, i) => partsFor(`range/${torso}/${i}`, torso))
    const kinds = (k: 'head' | 'ears' | 'wings' | 'tail' | 'legs') => new Set(ps.map(p => p[k])).size
    assert.ok(kinds('ears') >= 4, `${torso} ears`)
    assert.ok(kinds('ears') * kinds('wings') * kinds('tail') * kinds('legs') * kinds('head') >= 16, `${torso} combinations`)
  }
  const all = (torso: (typeof BODIES)[number], k: 'legs' | 'muzzle' | 'head') => new Set(Array.from({ length: 300 }, (_, i) => partsFor(`c/${i}`, torso)[k]))
  assert.deepEqual(all('ghost', 'legs'), new Set(['none']), 'ghosts float')
  assert.ok(all('bird', 'muzzle').has('beak') && all('bug', 'legs').has('many'))
  assert.deepEqual(all('ghost', 'head'), new Set(['merged']))
})

test('each evolution grows the same parts; legendaries take the largest of each', () => {
  for (const s of seasonSpecies(1)) {
    const p = partsFor(s.id, s.body), g = grow(p)
    assert.equal(g.ears, p.ears)
    assert.equal(g.tail, p.tail)
    assert.equal(g.head, p.head)
    assert.equal(g.wings, p.wings === 'small' ? 'large' : p.wings)
    assert.ok(g.tw >= p.tw && g.th > p.th && g.hh > p.hh && g.earSize >= p.earSize && g.tailSize >= p.tailSize)
    const x = exalt(g)
    assert.ok(x.tw >= 5 && x.earSize === 3 && x.tailSize === 3)
    assert.ok(x.wings !== 'none' || x.tail !== 'none', 'always winged or tailed')
  }
})

test("a fusion takes parent A's torso, legs and tail and parent B's head-top and wings", () => {
  const a = partsFor('s1-haiku-0', 'critter'), b = partsFor('s1-opus-3', 'bird')
  const h = hybrid(a, b)
  assert.deepEqual([h.torso, h.legs, h.tail, h.th, h.tw], [a.torso, a.legs, a.tail, a.th, a.tw])
  assert.deepEqual([h.ears, h.earSize, h.wings, h.eyeGap], [b.ears, b.earSize, b.wings, b.eyeGap])
  assert.notEqual(h.muzzle, 'beak', 'only a bird body keeps a beak')
})

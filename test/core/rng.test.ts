import { test } from 'node:test'
import assert from 'node:assert/strict'
import { between, chance, hash128, hashString, int, pick, rngFromSeed, shuffle, uint32, weighted } from '../../plugin/hooks/core/rng.ts'
import { near } from './helpers.ts'

test('hashString is a stable uint32 (changing it reshuffles every season and card)', () => {
  assert.equal(hashString(''), hash128('')[0])
  for (const s of ['', 'a', 'spinlings/season/1/haiku/0', 'émoji 🟩']) {
    const h = hashString(s)
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff)
    assert.equal(hashString(s), h)
  }
  assert.deepEqual(
    ['', 'a', 'spinlings/day/2026-10-01', 'claude-opus-5-5'].map(hashString),
    [41608494, 1589175524, 4266258954, 4022567113],
  )
  assert.notEqual(hashString('a'), hashString('b'))
})

test('rngFromSeed replays the same stream and differs across seeds', () => {
  const a = rngFromSeed('x'), b = rngFromSeed('x'), c = rngFromSeed('y')
  const sa = Array.from({ length: 50 }, a), sb = Array.from({ length: 50 }, b), sc = Array.from({ length: 50 }, c)
  assert.deepEqual(sa, sb)
  assert.notDeepEqual(sa, sc)
  assert.deepEqual(Array.from({ length: 3 }, rngFromSeed(42)), Array.from({ length: 3 }, rngFromSeed('42')))
})

test('rng output is uniform in [0, 1)', () => {
  const r = rngFromSeed('uniform')
  const bins = Array(10).fill(0)
  let sum = 0
  const n = 100_000
  for (let i = 0; i < n; i++) {
    const v = r()
    assert.ok(v >= 0 && v < 1)
    sum += v
    bins[Math.floor(v * 10)]++
  }
  assert.ok(Math.abs(sum / n - 0.5) < 0.005)
  for (const b of bins) assert.ok(near(b, n, 0.1))
})

test('int, between, chance, uint32 and pick stay in range', () => {
  const r = rngFromSeed('helpers')
  const seen = new Set<number>()
  for (let i = 0; i < 2000; i++) {
    const v = int(r, 6)
    assert.ok(Number.isInteger(v) && v >= 0 && v < 6)
    const w = between(r, -2, 2)
    assert.ok(w >= -2 && w <= 2)
    seen.add(w)
    const u = uint32(r)
    assert.ok(Number.isInteger(u) && u >= 0 && u <= 0xffffffff)
    assert.ok(['a', 'b'].includes(pick(r, ['a', 'b'])))
  }
  assert.equal(seen.size, 5)
  assert.equal(chance(r, 0), false)
  assert.equal(chance(r, 1), true)
  assert.throws(() => pick(r, []))
})

test('weighted follows its weights', () => {
  const r = rngFromSeed('weighted')
  const counts = { a: 0, b: 0, c: 0 }
  const n = 50_000
  for (let i = 0; i < n; i++) counts[weighted(r, [['a', 70], ['b', 25], ['c', 5]] as const)]++
  assert.ok(near(counts.a, n, 0.7))
  assert.ok(near(counts.b, n, 0.25))
  assert.ok(near(counts.c, n, 0.05))
  assert.equal(weighted(r, [['only', 0]] as const), 'only')
})

test('shuffle returns a permutation and leaves the input alone', () => {
  const r = rngFromSeed('shuffle')
  const input = [1, 2, 3, 4, 5, 6, 7, 8]
  const out = shuffle(r, input)
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual([...out].sort((a, b) => a - b), input)
  const firsts = new Set(Array.from({ length: 200 }, () => shuffle(r, input)[0]))
  assert.equal(firsts.size, 8)
})

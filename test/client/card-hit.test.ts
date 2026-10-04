import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearCardHits, prepareCardHit, registerCardHit } from '../../plugin/hooks/ui/card-hit-state.ts'

test('a current pointer message runs the existing action once after focusing its name Button', async () => {
  clearCardHits(true)
  const calls: string[] = []
  registerCardHit('card-one-hit', 'card-one-pick', 'team:one', () => { calls.push('pick') })
  const press = prepareCardHit('card-one-hit', null)!
  await press(async button => { calls.push(button) })
  assert.deepEqual(calls, ['card-one-pick', 'pick'])
})

test('queued stale messages never run a replacement registration under the same key', async () => {
  clearCardHits(true)
  let calls = 0
  registerCardHit('team-0-hit', 'team-0-pick', 'team:one', () => { calls++ })
  const press = prepareCardHit('team-0-hit', null)!
  clearCardHits()
  registerCardHit('team-0-hit', 'team-0-pick', 'team:two', () => { calls++ })
  await press(async () => { assert.fail('a stale click never focuses') })
  assert.equal(calls, 0)
})

test('a cosmetic focus redraw preserves the intended captured action instead of calling a new closure', async () => {
  clearCardHits(true)
  const calls: string[] = []
  registerCardHit('card-one-hit', 'card-one-pick', 'team:one', () => { calls.push('original') })
  await prepareCardHit('card-one-hit', null)!(async () => {
    clearCardHits()
    registerCardHit('card-one-hit', 'card-one-pick', 'team:one', () => { calls.push('redrawn') })
  })
  assert.deepEqual(calls, ['original'])
})

test('navigation during focus rejects the old intent even if the region key is reused', async () => {
  clearCardHits(true)
  let calls = 0
  registerCardHit('partner-one-hit', 'partner-one-pick', 'fuse:a:one', () => { calls++ })
  await prepareCardHit('partner-one-hit', null)!(async () => {
    clearCardHits()
    registerCardHit('partner-one-hit', 'partner-one-pick', 'fuse:b:one', () => { calls++ })
  })
  assert.equal(calls, 0)
})

test('close or surface change during focus rejects the old action even after the same view reopens', async () => {
  clearCardHits(true)
  let calls = 0
  registerCardHit('card-one-hit', 'card-one-pick', 'team:one', () => { calls++ })
  await prepareCardHit('card-one-hit', null)!(async () => {
    clearCardHits(true)
    registerCardHit('card-one-hit', 'card-one-pick', 'team:one', () => { calls++ })
    throw new Error('closed while focusing')
  })
  assert.equal(calls, 0)
})

test('invalid payloads and unknown regions are refused; an unavailable host focus route still permits a valid click', async () => {
  clearCardHits(true)
  let calls = 0
  registerCardHit('card-one-hit', 'card-one-pick', 'team:one', () => { calls++ })
  for (const data of [undefined, {}, 'pick', 1, false, []]) assert.equal(prepareCardHit('card-one-hit', data), null)
  assert.equal(prepareCardHit('not-on-screen', null), null)
  await prepareCardHit('card-one-hit', null)!(async () => { throw new Error('no focus route') })
  assert.equal(calls, 1)
})

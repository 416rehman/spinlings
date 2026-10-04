// The footer calls the real game action: Back leaves the pane open, and Close reaches the host (SPEC 21, 32).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INITIAL, createGame } from '../../plugin/hooks/client/game.ts'
import type { Fx, GameState } from '../../plugin/hooks/client/types.ts'

function pane() {
  const state = structuredClone(INITIAL)
  const closed: GameState['pane'][] = []
  const unexpected = () => { throw new Error('pane navigation needs no backend') }
  const fx: Fx = {
    now: async () => 0, random: () => 0.5,
    after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }),
    fetch: unexpected,
    store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
    state: { get: async key => state[key], update: async (key, fn) => { state[key] = fn(state[key]); return state[key] } },
    ui: {
      toast: () => undefined, status: () => undefined, log: () => undefined, sound: () => undefined,
      copy: async () => true, openPane: async () => true, blit: async () => true,
      closePane: async () => { closed.push(structuredClone(state.pane)) },
    },
  }
  const game = createGame({ slots: { local: unexpected, battle: async () => undefined, reveal: async () => undefined, moments: null } })
  return { state, closed, actions: game.actions(fx) }
}

test('root Close closes the host pane exactly once, after clearing transient feedback', async () => {
  const w = pane()
  w.state.pane.message = 'Old feedback'
  w.state.pane.toCopy = 'Old clipboard fallback'
  await w.actions.back()
  assert.equal(w.closed.length, 1)
  assert.deepEqual(w.closed[0]!.stack, [])
  assert.equal(w.closed[0]!.message, '')
  assert.equal(w.closed[0]!.toCopy, '')
})

test('Back returns from nested details without closing the host, then Close closes it once', async () => {
  const w = pane()
  const card = { kind: 'card' as const, cardId: 'card-one' }
  w.state.pane.stack = [card, { kind: 'fuse', cardId: card.cardId, otherId: null }]
  await w.actions.back()
  assert.deepEqual(w.state.pane.stack, [card])
  assert.equal(w.closed.length, 0)
  await w.actions.back()
  assert.deepEqual(w.state.pane.stack, [])
  assert.equal(w.closed.length, 0)
  await w.actions.back()
  assert.equal(w.closed.length, 1)
})

test('Hide update dismisses the update before returning from details or closing the host', async () => {
  const w = pane()
  const card = { kind: 'card' as const, cardId: 'card-one' }
  w.state.account.latest = '99.0.0'
  w.state.pane.showUpdate = true
  w.state.pane.stack = [card]
  await w.actions.back()
  assert.equal(w.state.pane.showUpdate, false)
  assert.deepEqual(w.state.pane.stack, [card])
  assert.equal(w.closed.length, 0)
  await w.actions.back()
  assert.deepEqual(w.state.pane.stack, [])
  assert.equal(w.closed.length, 0)
  await w.actions.back()
  assert.equal(w.closed.length, 1)
  assert.equal(w.closed[0]!.showUpdate, false)
})

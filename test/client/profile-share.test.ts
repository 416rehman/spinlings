import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INITIAL, createGame } from '../../plugin/hooks/client/game.ts'
import type { Fx } from '../../plugin/hooks/client/types.ts'
import { fakeServer } from '../plugin/fixtures.ts'

function profile(copies = true) {
  const state = structuredClone(INITIAL)
  state.account = { ...state.account, server: 'https://meadow.example', link: 'ready' }
  state.me = structuredClone(fakeServer().me)
  state.me.player.handle = 'calm-hare-7'
  const copied: string[] = []
  const unexpected = () => { throw new Error('Sharing must not ask a backend or read a stored credential') }
  const fx: Fx = {
    now: async () => 0, random: () => 0.5,
    after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }), fetch: unexpected,
    store: { get: unexpected, set: unexpected, delete: unexpected, keys: unexpected },
    state: { get: async key => state[key], update: async (key, fn) => { state[key] = fn(state[key]); return state[key] } },
    ui: {
      toast: () => undefined, status: () => undefined, log: () => undefined, sound: () => undefined,
      copy: async text => { copied.push(text); return copies }, openPane: async () => true,
      closePane: async () => undefined, blit: async () => true,
    },
  }
  const game = createGame({ slots: { local: unexpected, battle: async () => undefined, reveal: async () => undefined, moments: null } })
  return { state, copied, actions: game.actions(fx) }
}

test('profile sharing copies only the current public URL and follows a changed username', async () => {
  const w = profile()
  await w.actions.shareProfile()
  assert.deepEqual(w.copied, ['https://meadow.example/u/calm-hare-7'])
  assert.equal(w.state.pane.message, 'Profile link copied.')
  assert.equal(w.state.pane.toCopy, '')
  w.state.me!.player.handle = 'new-name_8'
  await w.actions.shareProfile()
  assert.equal(w.copied.at(-1), 'https://meadow.example/u/new-name_8')
})

test('without a clipboard, profile sharing exposes only the encoded public URL for manual copy', async () => {
  const w = profile(false)
  w.state.me!.player.handle = 'a name/with?reserved'
  await w.actions.shareProfile()
  assert.equal(w.state.pane.toCopy, 'https://meadow.example/u/a%20name%2Fwith%3Freserved')
  assert.equal(w.state.pane.message, '')
})

test('offline and signed-out cached players cannot share a public profile', async () => {
  for (const mode of ['offline', 'signed-out'] as const) {
    const w = profile()
    if (mode === 'offline') w.state.account.world = 'offline'
    else w.state.account.link = 'signed-out'
    await w.actions.shareProfile()
    assert.deepEqual(w.copied, [])
    assert.equal(w.state.pane.toCopy, '')
  }
})

test('profile sharing with no player is inert', async () => {
  const w = profile()
  w.state.me = null
  await w.actions.shareProfile()
  assert.deepEqual(w.copied, [])
})

// An effort change may alter the local band's ink, but no request byte, storage field or send time (SPEC 20.2).
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { INITIAL, createGame } from '../../plugin/hooks/client/game.ts'
import { effortLook, effortOf } from '../../plugin/hooks/client/effort.ts'
import type { Effort } from '../../plugin/hooks/client/effort.ts'
import { createLocalBackend } from '../../plugin/hooks/client/local/index.ts'
import { playBattle } from '../../plugin/hooks/client/scheduler.ts'
import type { Fx, GameState, HttpInit } from '../../plugin/hooks/client/types.ts'
import { NOW, ORIGIN, TOKEN, fakeServer } from '../plugin/fixtures.ts'

type Timer = { at: number; seq: number; fn: () => void; active: boolean }
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(done => setImmediate(done)) }

async function play(effort: Effort, waiting: boolean, motion: boolean): Promise<{ sent: { at: number; bytes: string }[]; stored: unknown[] }> {
  let now = NOW, seq = 0
  const timers: Timer[] = []
  const state = structuredClone(INITIAL) as GameState
  const store = new Map<string, unknown>([
    ['prefs', { world: 'online', worldOption: 'online', motion }], [`server:${ORIGIN}:session`, TOKEN],
  ])
  const sent: { at: number; bytes: string }[] = []
  const server = fakeServer()
  const after = (ms: number, fn: () => void) => {
    const t = { at: now + ms, seq: seq++, fn, active: true }
    timers.push(t)
    return { cancel: () => { t.active = false } }
  }
  const fx: Fx = {
    now: async () => now, random: () => 0.5, after,
    every: () => ({ cancel: () => undefined }),
    fetch: async (url: string, init: HttpInit) => {
      sent.push({ at: now, bytes: JSON.stringify({ url, ...init }) })
      return server.handle(url, init)
    },
    store: {
      get: async key => store.get(key),
      set: async (key, value) => { store.set(key, structuredClone(value)) },
      delete: async key => { store.delete(key) }, keys: async () => [...store.keys()],
    },
    state: { get: async key => state[key], update: async (key, fn) => { state[key] = fn(state[key]); return state[key] } },
    ui: {
      toast: () => undefined, status: () => undefined, log: () => undefined, sound: () => undefined,
      copy: async () => true, openPane: async () => true, closePane: async () => undefined, blit: async () => true,
    },
  }
  const advance = async (ms: number) => {
    const end = now + ms
    for (;;) {
      await flush()
      timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
      const t = timers.find(t => t.active)
      if (!t || t.at > end) break
      timers.splice(timers.indexOf(t), 1)
      now = t.at
      t.fn()
    }
    now = end
    await flush()
  }
  const game = createGame({ slots: { local: createLocalBackend, battle: playBattle, reveal: async () => undefined, moments: null } })
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await advance(0)
  await game.turnStep(fx, 'claude-opus-5-5', effort)
  assert.equal(state.signals.effort, effort, 'the input reaches local state before the battle')
  if (waiting) await game.turnStarted(fx)
  else await game.command(fx, 'battle')
  await advance(180_000)
  if (waiting) await game.turnCompleted(fx, 'done')
  await game.actions(fx).openPack('pack-welcome-1')
  await advance(0)
  assert.ok(sent.some(r => /\/battles"/.test(r.bytes)), 'the battle starts')
  assert.ok(sent.some(r => /\/finish"/.test(r.bytes)), 'the real scheduler finishes the battle')
  assert.ok(sent.some(r => /\/packs\/open"/.test(r.bytes)), 'a card reveal also sends the same bytes')
  await game.end(fx)
  return { sent, stored: [...store.values()] }
}

it('low and max effort send byte-identical requests at identical timestamps in manual and waiting battles, with motion on and off', async () => {
  for (const waiting of [false, true]) for (const motion of [false, true]) {
    const low = await play('low', waiting, motion)
    const max = await play('max', waiting, motion)
    assert.deepEqual(max.sent, low.sent, `waiting=${waiting}, motion=${motion}: every byte and timestamp matches`)
    assert.deepEqual(max.stored, low.stored, 'effort never enters persistent storage')
    assert.doesNotMatch(JSON.stringify(max.stored), /"effort"\s*:/)
  }
})

it('missing and unfamiliar effort use the default look; low and max have distinct local ink', () => {
  for (const value of [undefined, null, 'auto', {}, 100, 'medium']) assert.equal(effortOf(value), 'medium')
  assert.notDeepEqual(effortLook('low'), effortLook('max'))
})

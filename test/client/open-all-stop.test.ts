// Esc while Open all is under way (SPEC 13.5), through the real game and its HTTP client: the request in flight
// finishes, because the server has already opened those packs; what it brought is kept, the bank drops them, no further
// request goes out, the summary shows what came out, and the passkey offer never names a card still face down.
import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { PackView } from '../../plugin/hooks/core/api.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import { INITIAL, createGame } from '../../plugin/hooks/client/game.ts'
import { createLocalBackend } from '../../plugin/hooks/client/local/index.ts'
import type { Fx, GameState, HttpInit } from '../../plugin/hooks/client/types.ts'
import { NOW, ORIGIN, TOKEN, fakeServer } from '../plugin/fixtures.ts'

type Timer = { at: number; seq: number; fn: () => void; active: boolean; every?: number }
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(done => setImmediate(done)) }
const FAMILIES = ['opus', 'haiku', 'fable', 'sonnet'] as const

/** 30 packs waiting; the second openPacks answer is held after the server has opened them, until `release`. */
function world() {
  let now = NOW, seq = 0, sent = 0
  const timers: Timer[] = []
  const state = structuredClone(INITIAL) as GameState
  const server = fakeServer({ difficulty: 1 })
  const packs: PackView[] = Array.from({ length: 30 }, (_, i) => ({ id: `bank-${i}`, family: FAMILIES[i % 4]!, source: 'charge', day: utcDay(NOW) }))
  server.me = { ...server.me, packs, player: { ...server.me.player, battles: 4 } }
  const store = new Map<string, unknown>([
    ['prefs', { world: 'online', worldOption: 'online' }], [`server:${ORIGIN}:session`, TOKEN],
    [`server:${ORIGIN}:meta`, { welcomed: true }], ['offline:meta', { welcomed: true }],
  ])
  const paths: string[] = []
  let release: (() => void) | null = null
  const schedule = (ms: number, fn: () => void, every?: number) => {
    const t: Timer = { at: now + ms, seq: seq++, fn, active: true, ...(every ? { every } : {}) }
    timers.push(t)
    return { cancel: () => { t.active = false } }
  }
  const fx: Fx = {
    now: async () => now, random: () => 0.5,
    after: (ms, fn) => schedule(ms, fn),
    every: (ms, fn) => schedule(ms, fn, ms),
    fetch: async (url: string, init: HttpInit) => {
      paths.push(new URL(url).pathname)
      let answer = server.handle(url, init)
      if (url.endsWith('/v1/packs/open-many') && answer.ok) {
        // a foil in every answer: worth a passkey offer, so one named while the cards are face down would show
        const v = JSON.parse(answer.text) as { opened: { cards: { foil?: boolean }[] }[] }
        v.opened[0]!.cards[0]!.foil = true
        answer = { ...answer, text: JSON.stringify(v) }
        if (++sent === 2) await new Promise<void>(done => { release = done })
      }
      return answer
    },
    registry: async () => null,
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
    const fired = new Map<Timer, number>()
    for (;;) {
      await flush()
      timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
      const t = timers.find(t => t.active && t.at <= end)
      if (!t) break
      now = Math.max(now, t.at)
      if (t.every) {
        const n = (fired.get(t) ?? 0) + 1
        fired.set(t, n)
        t.at = n >= 5 ? Math.max(t.at + t.every, end - t.every + 1) : t.at + t.every
      } else timers.splice(timers.indexOf(t), 1)
      t.fn()
    }
    now = end
    await flush()
  }
  const game = createGame({ slots: { local: createLocalBackend, battle: async () => undefined, reveal: async () => undefined, moments: null } })
  return { state, server, paths, fx, game, advance, release: () => release }
}

it('esc while packs open stops after the request in flight, keeps what it opened and names no hidden card', async () => {
  const w = world()
  await w.game.boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  assert.ok(w.state.account.features.includes('passkey'))
  assert.equal(w.state.me?.packs.length, 30)
  const before = w.state.cards.length
  const opening = w.game.actions(w.fx).openAll()
  await w.advance(0)
  assert.ok(w.release(), 'the second request is out')
  assert.deepEqual(w.state.reveal?.bulk, { packs: 30, opened: 10 })
  // esc, which the hints call Stop: the pane and the reveal stay, marked as stopping
  assert.equal(await w.game.paneClosing(w.fx, true), true)
  assert.deepEqual(w.state.reveal?.bulk, { packs: 30, opened: 10, stopping: true })
  assert.deepEqual(w.state.pane.stack.at(-1), { kind: 'reveal' })
  // another esc while it stops changes nothing
  assert.equal(await w.game.paneClosing(w.fx, true), true)
  assert.equal(w.state.reveal?.bulk?.opened, 10)
  w.release()!()
  await opening
  await w.advance(0)
  // the answer in flight is kept: twenty open, no third request, and the bank holds just the ten never sent
  assert.equal(w.paths.filter(p => p === '/v1/packs/open-many').length, 2)
  const r = w.state.reveal!
  assert.equal(r.cards.length, 20)
  assert.equal(r.bulk?.opened, 20)
  assert.equal(r.bulk?.packs, 30)
  assert.ok(r.bulk?.best !== undefined, 'the ceremony is ready')
  assert.deepEqual(w.state.me?.packs.map(p => p.id), Array.from({ length: 10 }, (_, i) => `bank-${i + 20}`))
  assert.deepEqual(w.server.me.packs.map(p => p.id), w.state.me?.packs.map(p => p.id))
  assert.equal(w.state.cards.length, before + 20)
  assert.ok(!w.state.moments.some(m => m.kind === 'passkey'), 'no passkey offer while the cards are face down')
  // once every card is face up, Done may offer it, naming a card the player has seen
  await w.game.actions(w.fx).skip(r.id)
  assert.equal(w.state.pane.flipped, 20)
  await w.game.actions(w.fx).doneReveal(r.id)
  const offer = w.state.moments.find(m => m.kind === 'passkey')
  assert.ok(offer && offer.kind === 'passkey' && r.cards.some(c => c.id === offer.card?.id))
  assert.equal(w.state.reveal, null)
})

it('Done part way through a single pack names only a card already face up', async () => {
  const w = world()
  await w.game.boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  // every card is still face down: the foil in it stays unnamed
  w.state.reveal = {
    id: 'reveal-hidden', kind: 'pack', family: 'opus', cards: [{ ...w.server.cards[0]!, id: 'hidden', foil: true }], packs: [], fresh: [],
    album: { before: 1, after: 1, total: 36 }, torn: true,
  }
  w.state.pane = { ...w.state.pane, flipped: 0, stack: [{ kind: 'reveal' }] }
  await w.game.actions(w.fx).doneReveal('reveal-hidden')
  assert.equal(w.state.reveal, null)
  assert.ok(!w.state.moments.some(m => m.kind === 'passkey'))
})

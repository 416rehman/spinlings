// The game over effects held in memory, for what only a reload or a lost answer shows: a catch picked just before the
// module reloaded asks again and lands on how it went (SPEC 13.4: the server already decided), and a catch whose
// answer never comes lets the band go instead of holding every waiting battle back.
import { expect, test } from 'claude-code/testing'
import type { ApiOp } from '../hooks/core/api.ts'
import type { Card } from '../hooks/core/types.ts'
import { toBattleCard } from '../hooks/core/cards.ts'
import { INITIAL, createGame } from '../hooks/client/game.ts'
import type { Backend, Fx, GameState, Moment, Outcome } from '../hooks/client/types.ts'
import { BackendError } from '../hooks/client/types.ts'
import { NOW, ORIGIN, TOKEN, fakeServer } from './fixtures.ts'

declare const setTimeout: (fn: () => void, ms: number) => unknown

type Handlers = Partial<Record<ApiOp, (req: never) => Promise<unknown>>>

/** A Backend from a few handlers; any other operation is refused as the server would refuse a stranger. */
function backend(h: Handlers): Backend {
  const call = (op: ApiOp, req: never) => (h[op] ?? (() => Promise.reject(new BackendError('not_found', 'refused', 404, 'no'))))(req)
  return new Proxy({}, { get: (_t, op: string) => (op === 'call' ? call : (req: never) => call(op as ApiOp, req)) }) as Backend
}

type World = { fx: Fx; state: GameState; store: Map<string, unknown>; advance(ms: number): Promise<void> }

function world(init: Partial<GameState>): World {
  let now = NOW, seq = 0
  const timers: { at: number; seq: number; fn: () => void }[] = []
  const state = { ...INITIAL, ...init } as GameState
  const store = new Map<string, unknown>([['prefs', { world: 'online', worldOption: 'online' }], [`server:${ORIGIN}:session`, TOKEN]])
  const fx: Fx = {
    now: async () => now,
    random: () => 0.5,
    after: (ms, fn) => {
      const t = { at: now + Math.max(0, ms), seq: seq++, fn }
      timers.push(t)
      return { cancel: () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) } }
    },
    every: () => ({ cancel: () => undefined }),
    fetch: () => Promise.reject(new Error('the backend is faked')),
    store: {
      get: async k => store.get(k), set: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))) }, delete: async k => { store.delete(k) },
      keys: async () => [...store.keys()],
    },
    state: { get: async k => state[k], update: async (k, fn) => { state[k] = fn(state[k]); return state[k] } },
    ui: {
      toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => true, openPane: async () => true,
      closePane: async () => undefined, blit: async () => true, sound: () => undefined,
    },
  }
  const flush = () => new Promise<void>(r => setTimeout(r, 0))
  return {
    fx, state, store,
    advance: async ms => {
      const end = now + ms
      for (;;) {
        for (let i = 0; i < 4; i++) await flush()
        timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
        const t = timers[0]
        if (!t || t.at > end) break
        timers.shift()
        now = t.at
        t.fn()
      }
      now = end
      for (let i = 0; i < 4; i++) await flush()
    },
  }
}

const server = fakeServer()
const wild: Card = { ...server.cards[0]!, id: 'wild-1', origin: 'catch', bound: false }

function catching(): Moment {
  const outcome: Outcome = {
    battleId: 'battle-9', kind: 'wild', opponent: { kind: 'wild' }, lead: toBattleCard(wild), result: 'win', sparks: 10, rating: 1000,
    ratingDelta: 0, league: null, perfect: 0, xp: [], catch: { status: 'catching', options: [toBattleCard(wild)], index: 0 }, bounty: null,
    dailyWinPack: false, streak: 1, streakPack: false,
  }
  // as a reload finds it: the request that picked it went with the old module
  return { kind: 'outcome', id: 'outcome:battle-9', outcome, until: null }
}

const slots = { local: () => backend({}), battle: async () => undefined, reveal: async () => undefined, moments: null }
const catchOf = (w: World) => w.state.moments.find(m => m.id === 'outcome:battle-9')

test('a catch picked before a reload asks again, and the server\'s one-shot answer says it was caught', async () => {
  const w = world({ moments: [catching()] })
  const asked: unknown[] = []
  const game = createGame({
    serverUrl: ORIGIN, world: 'online', slots,
    remote: () => backend({
      version: () => Promise.reject(new BackendError('unavailable', 'network', 0, 'offline')),
      me: async () => server.me,
      cards: async () => ({ cards: [...server.cards, wild], version: server.me.player.cardsVersion }),
      catchCreature: async req => { asked.push(req); throw new BackendError('conflict', 'refused', 409, 'Nothing is waiting to be caught') },
    }),
  })
  await game.boot(w.fx, { model: null })
  await w.advance(5000)
  expect(asked).toEqual([{ battleId: 'battle-9', index: 0 }])
  const m = catchOf(w)
  expect(m?.kind === 'outcome' && m.outcome.catch.status).toBe('caught')
})

test('a catch whose answer never comes lets the band go, so waiting battles start again', async () => {
  const w = world({ moments: [catching()] })
  const game = createGame({
    serverUrl: ORIGIN, world: 'online', slots,
    remote: () => backend({
      version: () => Promise.reject(new BackendError('unavailable', 'network', 0, 'offline')),
      me: async () => server.me,
      cards: async () => ({ cards: server.cards, version: server.me.player.cardsVersion }),
      catchCreature: () => new Promise(() => undefined),
    }),
  })
  await game.boot(w.fx, { model: null })
  await w.advance(1000)
  expect(catchOf(w)?.until).toBeGreaterThan(NOW)
  await w.advance(25_000)
  expect(catchOf(w)).toBeUndefined()
})

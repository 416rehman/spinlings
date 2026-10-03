// The game over effects held in memory, for what only a reload or a lost answer shows: a catch picked just before the
// module reloaded asks again and lands on how it went (SPEC 13.4: the server already decided), and a catch whose
// answer never comes lets the band go instead of holding every waiting battle back.
// Also the pane's esc order: the update row first, then the view on top, then the pane (SPEC 32).
// And answers that outlive the world or server they were asked of: a switch, by command or by a reload after another
// session switched, drops them, sends nothing more to the place left behind, and carries none of its state over (SPEC 28, 33).
// A battle's finish waits for the rounds its presses play and for any Retry-After a "still playing" names (SPEC 15).
import { expect, test } from 'claude-code/testing'
import type { ApiOp, StartBattleResponse, VersionResponse } from '../hooks/core/api.ts'
import { FEATURES } from '../hooks/core/api.ts'
import type { Card } from '../hooks/core/types.ts'
import { RULES_VERSION, simulateBattle } from '../hooks/core/battle.ts'
import { toBattleCard } from '../hooks/core/cards.ts'
import { finishAfter } from '../hooks/core/economy.ts'
import { GENERATOR_VERSION } from '../hooks/core/species.ts'
import { INITIAL, OFFLINE_FEATURES, createGame } from '../hooks/client/game.ts'
import { createLocalBackend } from '../hooks/client/local/index.ts'
import { CLIENT_VERSION } from '../hooks/client/remote.ts'
import type { RemoteDeps } from '../hooks/client/remote.ts'
import type { Backend, BattleDriver, Fx, GameState, Moment, Outcome } from '../hooks/client/types.ts'
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
    slots,
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
    slots,
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

test('a collection bigger than one answer arrives whole, a page at a time, read again if it changed on the way', async () => {
  const w = world({})
  const asked: unknown[] = []
  let version = server.me.player.cardsVersion
  const game = createGame({
    slots,
    remote: () => backend({
      version: () => Promise.reject(new BackendError('unavailable', 'network', 0, 'offline')),
      me: async () => server.me,
      cards: async (req: { after?: string }) => {
        asked.push(req)
        const at = req.after === undefined ? 0 : Number(req.after.slice(1))
        // the collection moves once, while the second page is on its way
        if (asked.length === 2) version++
        const next = at + 2 < server.cards.length ? { next: `p${at + 2}` } : {}
        return { cards: server.cards.slice(at, at + 2), version, ...next }
      },
    }),
  })
  await game.boot(w.fx, { model: null })
  await w.advance(5000)
  expect(w.state.cards.map(c => c.id)).toEqual(server.cards.map(c => c.id))
  expect(asked).toEqual([{}, { after: 'p2' }, {}, { after: 'p2' }, { after: 'p4' }])
})

test('esc closes the update row first, then the view on top, then the pane; a new tab or view closes the row too', async () => {
  const w = world({ pane: { ...INITIAL.pane, showUpdate: true, stack: [{ kind: 'privacy' }] }, account: { ...INITIAL.account, latest: '0.2.0' } })
  const game = createGame({ slots, remote: () => backend({}) })
  // the person's esc: the row alone, and the pane stays open
  expect(await game.paneClosing(w.fx, true)).toBe(true)
  expect(w.state.pane).toMatchObject({ showUpdate: false, stack: [{ kind: 'privacy' }] })
  expect(await game.paneClosing(w.fx, true)).toBe(true)
  expect(w.state.pane.stack).toEqual([])
  expect(await game.paneClosing(w.fx, true)).toBe(false)
  // a row that no longer shows (nothing newer in this world) never swallows an esc
  w.state.pane = { ...w.state.pane, showUpdate: true, stack: [{ kind: 'privacy' }] }
  w.state.account = { ...w.state.account, world: 'offline' }
  expect(await game.paneClosing(w.fx, true)).toBe(true)
  expect(w.state.pane.stack).toEqual([])
  w.state.account = { ...w.state.account, world: 'online' }
  // a plugin closing the pane closes it whole
  w.state.pane = { ...w.state.pane, showUpdate: true }
  expect(await game.paneClosing(w.fx, false)).toBe(false)
  expect(w.state.pane.showUpdate).toBe(false)
  // switching tabs or opening a view leaves the row behind
  const act = game.actions(w.fx)
  w.state.pane = { ...w.state.pane, showUpdate: true }
  await act.tab('cards')
  expect(w.state.pane).toMatchObject({ tab: 'cards', showUpdate: false })
  w.state.pane = { ...w.state.pane, showUpdate: true }
  await act.push({ kind: 'privacy' })
  expect(w.state.pane).toMatchObject({ stack: [{ kind: 'privacy' }], showUpdate: false })
})

// ---------- answers that outlive a switch (SPEC 28, 33) ----------

const COMMUNITY = 'https://cards.example.org'
const unreachable = () => new BackendError('unavailable', 'network', 0, 'The server could not be reached')
const VERSION: VersionResponse = {
  api: 1, server: '1.0.0', rules: RULES_VERSION, generator: GENERATOR_VERSION, minClient: '0.0.1', latestClient: CLIENT_VERSION, features: [...FEATURES],
}
const both = { ...slots, local: createLocalBackend }
const hang: BattleDriver = () => new Promise<void>(() => undefined)
const settleAtOnce: BattleDriver = async (_fx, ctl) => { await ctl.log(); await ctl.settle() }

test('going offline while the first join is under way: no join is sent, no session kept, and the offline save opens', async () => {
  const w = world({})
  w.store.clear()
  const sent: string[] = []
  let answer: (v: unknown) => void = () => undefined
  const game = createGame({
    slots: both,
    remote: () => backend({
      version: () => Promise.reject(unreachable()),
      challenge: () => { sent.push('challenge'); return new Promise(r => { answer = r }) },
      join: async () => { sent.push('join'); return { token: TOKEN, me: server.me } },
      me: async () => { sent.push('me'); return server.me },
      cards: async () => { sent.push('cards'); return { cards: server.cards, version: server.me.player.cardsVersion } },
    }),
  })
  await game.boot(w.fx, { model: null })
  await w.advance(100)
  expect({ sent, link: w.state.account.link }).toEqual({ sent: ['challenge'], link: 'joining' })
  await game.command(w.fx, 'world offline')
  answer({ challenge: 'challenge-0123456789', difficulty: 4 })
  await w.advance(5000)
  expect(sent).toEqual(['challenge'])
  expect(w.store.has(`server:${ORIGIN}:session`)).toBe(false)
  expect(w.store.has('offline:v1')).toBe(true)
  expect(w.state.account).toMatchObject({ world: 'offline', link: 'ready' })
  expect(w.state.me?.player.handle).not.toBe(server.me.player.handle)
  expect(w.state.cards.length).toBeGreaterThan(0)
  expect(w.state.cards.some(c => server.cards.some(x => x.id === c.id))).toBe(false)
})

test('a reconnect still waiting when play goes offline: its failure never marks the offline world', async () => {
  const w = world({})
  let fail: (err: unknown) => void = () => undefined
  let tries = 0
  const game = createGame({
    slots: both,
    remote: () => backend({
      version: () => Promise.reject(unreachable()),
      me: () => (++tries === 1 ? Promise.reject(unreachable()) : new Promise((_, reject) => { fail = reject })),
    }),
  })
  await game.boot(w.fx, { model: null })
  await w.advance(100)
  expect(w.state.account.link).toBe('unreachable')
  // the heartbeat tries again, and the server is slow to say no
  void game.heartbeat(w.fx)
  await w.advance(100)
  expect(tries).toBe(2)
  await game.command(w.fx, 'world offline')
  expect(w.state.account).toMatchObject({ world: 'offline', link: 'ready' })
  fail(unreachable())
  await w.advance(100)
  expect(w.state.account).toMatchObject({ world: 'offline', link: 'ready', note: '' })
})

test('a refresh still out when play goes offline: nothing it brings lands, and the heartbeat asks that server nothing more', async () => {
  const w = world({})
  const asked: string[] = []
  let hold = false
  let late: (me: unknown) => void = () => undefined
  const game = createGame({
    slots: both,
    remote: () => backend({
      version: async () => { asked.push('version'); return VERSION },
      me: () => { asked.push('me'); return hold ? new Promise(r => { late = r }) : Promise.resolve(server.me) },
      cards: async () => { asked.push('cards'); return { cards: server.cards, version: server.me.player.cardsVersion } },
    }),
  })
  await game.boot(w.fx, { model: null })
  await w.advance(100)
  expect(w.state.account).toMatchObject({ link: 'ready', features: [...FEATURES] })
  hold = true
  await w.advance(5 * 60_000)
  void game.heartbeat(w.fx)
  await w.advance(100)
  expect(asked.at(-1)).toBe('me')
  await game.command(w.fx, 'world offline')
  const offlineMe = w.state.me?.player.handle
  const before = asked.length
  late(server.me)
  await w.advance(1000)
  expect(asked.slice(before)).toEqual([])
  expect(w.state.account).toMatchObject({ world: 'offline', features: OFFLINE_FEATURES, readOnly: false, latest: null })
  expect(w.state.me?.player.handle).toBe(offlineMe)
  expect(offlineMe).not.toBe(server.me.player.handle)
})

test('switching servers while the old one still answers: nothing it says lands on the new one or in its cache', async () => {
  const w = world({})
  w.store.set('prefs', { world: 'online', worldOption: 'online', server: COMMUNITY, serverOption: ORIGIN, communityOk: [COMMUNITY] })
  w.store.set(`server:${COMMUNITY}:session`, TOKEN)
  let late: (me: unknown) => void = () => undefined
  const asked: string[] = []
  const game = createGame({
    slots,
    remote: (deps: RemoteDeps) => backend({
      version: () => Promise.reject(unreachable()),
      me: () => { asked.push(`me ${deps.origin}`); return deps.origin === COMMUNITY ? new Promise(r => { late = r }) : Promise.resolve(server.me) },
      cards: async () => { asked.push(`cards ${deps.origin}`); return { cards: server.cards, version: server.me.player.cardsVersion } },
    }),
  })
  await game.boot(w.fx, { model: null })
  await w.advance(100)
  expect(w.state.account.server).toBe(COMMUNITY)
  await game.command(w.fx, 'server default')
  expect(w.state.me?.player.handle).toBe(server.me.player.handle)
  late(server.other)
  await w.advance(1000)
  expect(asked).toEqual([`me ${COMMUNITY}`, `me ${ORIGIN}`, `cards ${ORIGIN}`])
  expect(w.state.me?.player.handle).toBe(server.me.player.handle)
  expect((w.store.get(`server:${ORIGIN}:cache`) as { me: { player: { handle: string } } }).me.player.handle).toBe(server.me.player.handle)
  expect(w.store.has(`server:${COMMUNITY}:cache`)).toBe(false)
})

test('a reload into the other world (/spin world in another session) carries nothing over: the offline battle is never finished online', async () => {
  const w = world({})
  w.store.set('prefs', { world: 'offline', worldOption: 'offline' })
  const first = createGame({ slots: { ...both, battle: hang }, remote: () => backend({}) })
  await first.boot(w.fx, { model: null })
  await w.advance(100)
  await first.command(w.fx, 'battle')
  const offline = { battle: w.state.battle?.id ?? null, cards: w.state.cards.map(c => c.id) }
  expect(offline.battle).not.toBeNull()
  // another session ran /spin world online: this one's module loads again, $.state and $.store as they were
  w.store.set('prefs', { ...(w.store.get('prefs') as object), world: 'online' })
  const finishes: unknown[] = []
  const second = createGame({
    slots: { ...both, battle: settleAtOnce },
    remote: () => backend({
      version: () => Promise.reject(unreachable()),
      me: async () => server.me,
      cards: async () => ({ cards: server.cards, version: server.me.player.cardsVersion }),
      finishBattle: async req => { finishes.push(req); throw unreachable() },
    }),
  })
  await second.boot(w.fx, { model: null })
  expect({ world: w.state.account.world, battle: w.state.battle, me: w.state.me, cards: w.state.cards }).toEqual({ world: 'online', battle: null, me: null, cards: [] })
  await w.advance(60_000)
  expect(finishes).toEqual([])
  expect(w.state.me?.player.handle).toBe(server.me.player.handle)
  expect(w.state.cards.some(c => offline.cards.includes(c.id))).toBe(false)
})

test('0.1.0 prefs whose world option chose offline boot offline and ask no server anything', async () => {
  const w = world({})
  w.store.set('prefs', { world: 'offline', worldOption: 'offline', serverOption: ORIGIN, server: ORIGIN })
  const asked: string[] = []
  w.fx.fetch = url => { asked.push(String(url)); return Promise.reject(new Error('offline')) }
  const game = createGame({ slots: both, remote: (deps: RemoteDeps) => backend({ version: async () => { asked.push(deps.origin); return VERSION } }) })
  await game.boot(w.fx, { model: null })
  await w.advance(60_000)
  await game.command(w.fx, 'battle')
  await w.advance(60_000)
  expect(asked).toEqual([])
  expect(w.state.account.world).toBe('offline')
  expect(w.store.get('prefs')).toMatchObject({ world: 'offline', worldOption: 'offline', serverOption: ORIGIN, server: ORIGIN })
})

test('a community server chosen through the server_url option of 0.1.0, with no /spin server choice, stays the server in play', async () => {
  const w = world({})
  w.store.set('prefs', { world: 'online', worldOption: 'online', server: null, serverOption: COMMUNITY, communityOk: [COMMUNITY] })
  w.store.set(`server:${COMMUNITY}:session`, TOKEN)
  const asked: string[] = []
  const remote = (deps: RemoteDeps) => backend({
    version: () => Promise.reject(unreachable()),
    me: async () => { asked.push(deps.origin); return server.other },
    cards: async () => ({ cards: server.cards, version: server.other.player.cardsVersion }),
  })
  for (let reload = 0; reload < 2; reload++) {
    await createGame({ slots, remote }).boot(w.fx, { model: null })
    await w.advance(1000)
    expect(w.state.account).toMatchObject({ world: 'online', server: COMMUNITY, host: 'cards.example.org', community: true })
  }
  expect(asked.length).toBeGreaterThan(0)
  expect(asked.every(o => o === COMMUNITY)).toBe(true)
  expect(w.store.get('prefs')).toMatchObject({ worldOption: 'online', server: null, serverOption: COMMUNITY })
})

test('offline, /spin server for a community server asks it nothing: the band keeps it for when play goes online', async () => {
  const w = world({})
  w.store.set('prefs', { world: 'offline', worldOption: 'online' })
  const asked: string[] = []
  const logs: string[] = []
  w.fx.ui.log = text => { logs.push(text) }
  const game = createGame({
    slots: both,
    remote: (deps: RemoteDeps) => backend({ version: async () => { asked.push(deps.origin); return VERSION } }),
  })
  await game.boot(w.fx, { model: null })
  await w.advance(100)
  expect(w.state.account.world).toBe('offline')
  await game.command(w.fx, `server ${COMMUNITY}`)
  expect(asked).toEqual([])
  expect(w.state.moments.map(m => m.id)).toContain(`server:${COMMUNITY}`)
  expect(logs.at(-1)).toBe('cards.example.org is a community server run by someone else. See the band to use it when you play online.')
  await game.actions(w.fx).act(`server:${COMMUNITY}`)
  expect(asked).toEqual([])
  expect(w.state.account).toMatchObject({ world: 'offline', server: COMMUNITY, link: 'ready' })
  expect((w.store.get('prefs') as { server: string }).server).toBe(COMMUNITY)
})

test('a pane action answered after play went offline is dropped: the account deleted online never signs out the offline world', async () => {
  const w = world({})
  let answer: (res: unknown) => void = () => undefined
  const game = createGame({
    slots: both,
    remote: () => backend({
      version: () => Promise.reject(unreachable()),
      me: async () => server.me,
      cards: async () => ({ cards: server.cards, version: server.me.player.cardsVersion }),
      deleteMe: () => new Promise(r => { answer = r }),
    }),
  })
  await game.boot(w.fx, { model: null })
  await w.advance(100)
  // held: a press, and another once it has been held long enough
  const act = game.actions(w.fx)
  await act.hold('delete-account', 'me')
  await w.advance(2500)
  void act.hold('delete-account', 'me')
  await w.advance(100)
  expect(w.state.pane.busy).toBe('Deleting')
  await game.command(w.fx, 'world offline')
  const offline = w.state.me?.player.handle
  answer({ deleted: true })
  await w.advance(1000)
  expect(w.state.account).toMatchObject({ world: 'offline', link: 'ready', note: '' })
  expect(w.state.me?.player.handle).toBe(offline)
  expect(w.state.pane.message).toBe('')
})

test('/spin server default connects play held back by a stored 0.1.0 server address Spinlings can\'t use', async () => {
  const w = world({})
  w.store.set('prefs', { world: 'online', worldOption: 'online', server: null, serverOption: 'http://cards.example.org' })
  const asked: string[] = []
  const logs: string[] = []
  w.fx.ui.log = text => { logs.push(text) }
  const remote = (deps: RemoteDeps) => backend({
    version: () => Promise.reject(unreachable()),
    me: async () => { asked.push(deps.origin); return server.me },
    cards: async () => ({ cards: server.cards, version: server.me.player.cardsVersion }),
  })
  // http is for localhost alone: no server is asked, and the account says why
  const game = createGame({ slots, remote })
  await game.boot(w.fx, { model: null })
  await w.advance(100)
  expect(asked).toEqual([])
  expect(w.state.account).toMatchObject({ server: ORIGIN, link: 'unreachable' })
  expect(w.state.account.note).toMatch(/^The server address/)
  await game.command(w.fx, 'server default')
  expect(logs.at(-1)).toBe('Server: spinlings.dev')
  await w.advance(100)
  expect(asked).toEqual([ORIGIN])
  expect(w.state.account).toMatchObject({ server: ORIGIN, link: 'ready', note: '' })
})

// ---------- finishing a battle (SPEC 15) ----------

/** A battle as the fixture server starts it: its id, setup and start. */
function started(kind: 'duel' | 'wild'): StartBattleResponse {
  const res = server.handle(`${ORIGIN}/v1/battles`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ kind, family: 'opus' }) })
  return JSON.parse(res.text) as StartBattleResponse
}
const finished = () => JSON.parse(server.handle(`${ORIGIN}/v1/battles/battle-1/finish`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: '{"inputs":[]}' }).text)

test('a finish called early waits the Retry-After the server names, then lands; one naming no wait is not tried again', { timeoutMs: 30_000 }, async () => {
  for (const named of [true, false]) {
    const w = world({})
    const finishes: number[] = []
    const game = createGame({
      slots: { ...slots, battle: settleAtOnce },
      remote: () => backend({
        version: () => Promise.reject(unreachable()),
        me: async () => server.me,
        cards: async () => ({ cards: server.cards, version: server.me.player.cardsVersion }),
        startBattle: async () => started('duel'),
        finishBattle: async () => {
          finishes.push(await w.fx.now())
          if (finishes.length === 1) throw new BackendError('conflict', 'refused', 409, 'The battle is still playing', named ? 4000 : null)
          return finished()
        },
      }),
    })
    await game.boot(w.fx, { model: null })
    await w.advance(1000)
    await game.command(w.fx, 'battle')
    const b = w.state.battle!
    const rounds = simulateBattle(b.setup as never, []).rounds.length
    // in one step past the rounds and the 4 s Retry-After (the outcome shows for 12 s): the fake clock fires each timer
    // at its own time on the way
    await w.advance(finishAfter(b.startedAt, rounds) + 5000 - (await w.fx.now()))
    // never sooner than the rounds the presses play, 1.5 s each from the start
    expect(finishes[0]).toBeGreaterThanOrEqual(finishAfter(b.startedAt, rounds))
    if (named) {
      expect(finishes.length).toBe(2)
      expect(finishes[1]! - finishes[0]!).toBeGreaterThanOrEqual(4000)
      expect(w.state.moments.some(m => m.id === 'outcome:battle-1')).toBe(true)
    } else {
      await w.advance(10_000)
      expect(finishes.length).toBe(1)
      expect(w.state.battle).toBeNull()
    }
  }
})

test('a finish that answers, or a settle still refreshing, once play moved to another server or world lands nowhere and asks no catch', async () => {
  for (const to of ['server default', 'world offline']) {
    for (const held of ['finish', 'refresh']) {
      const w = world({})
      w.store.set('prefs', { world: 'online', worldOption: 'online', server: COMMUNITY, serverOption: ORIGIN, communityOk: [COMMUNITY] })
      w.store.set(`server:${COMMUNITY}:session`, TOKEN)
      const sent: string[] = []
      let settled = false
      let answer: () => void = () => undefined
      const hold = () => new Promise<void>(r => { answer = r })
      const game = createGame({
        slots: { ...both, battle: settleAtOnce },
        remote: (deps: RemoteDeps) => backend({
          version: () => Promise.reject(unreachable()),
          me: async () => { if (held === 'refresh' && settled && deps.origin === COMMUNITY) await hold(); return server.me },
          cards: async () => ({ cards: server.cards, version: server.me.player.cardsVersion }),
          startBattle: async () => started('wild'),
          finishBattle: async () => {
            sent.push(`finish ${deps.origin}`)
            const res = finished()
            if (held === 'finish') await hold()
            settled = true
            // won, with one creature to keep: settled, it is asked for once the refresh is back
            return { ...res, result: 'win', catchOptions: [toBattleCard(wild)] }
          },
          catchCreature: async req => { sent.push(`catch ${deps.origin} ${JSON.stringify(req)}`); throw new BackendError('not_found', 'refused', 404, 'no') },
        }),
      })
      await game.boot(w.fx, { model: null })
      await w.advance(1000)
      await game.command(w.fx, 'battle')
      await w.advance(60_000)
      expect(sent).toEqual([`finish ${COMMUNITY}`])
      await game.command(w.fx, to)
      answer()
      await w.advance(5000)
      expect(sent).toEqual([`finish ${COMMUNITY}`])
      expect(w.state.moments.some(m => m.id === 'outcome:battle-1')).toBe(false)
      expect(w.state.battle).toBeNull()
    }
  }
})

// ---------- gifts and the clipboard ----------

test('a wrapped gift is marked copied only when the copy took', async () => {
  for (const takes of [false, true]) {
    const w = world({})
    w.fx.ui.copy = async () => takes
    const gift = { code: 'quiet-otter-lamp-4821', card: server.cards[1]!, createdAt: NOW, expiresAt: NOW + 14 * 86_400_000 }
    const game = createGame({
      slots,
      remote: () => backend({
        version: () => Promise.reject(unreachable()),
        me: async () => server.me,
        cards: async () => ({ cards: server.cards, version: server.me.player.cardsVersion }),
        gift: async () => ({ gift }),
      }),
    })
    await game.boot(w.fx, { model: null })
    await w.advance(100)
    const act = game.actions(w.fx)
    await act.hold('gift', gift.card.id)
    await w.advance(2000)
    await act.hold('gift', gift.card.id)
    expect(w.state.social.gift).toEqual({ code: gift.code, link: `${ORIGIN}/g/${gift.code}`, cardId: gift.card.id, copied: takes })
    expect(w.state.pane.stack.at(-1)).toEqual({ kind: 'gift', code: gift.code })
  }
})

// The auto-update offer through the real game (SPEC 32): it reads only the registry the host hands it, never sends a
// byte about it, offers once while off (or unknown with a newer release), keeps Not now, Don't ask again and the limit
// of three, stays out of the welcome and battles, and the steps re-read the registry while they show and celebrate.
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { INITIAL, createGame } from '../../plugin/hooks/client/game.ts'
import { PLUGIN_COMMAND, WATCH_MS } from '../../plugin/hooks/client/autoupdate.ts'
import { createLocalBackend } from '../../plugin/hooks/client/local/index.ts'
import { KEYS } from '../../plugin/hooks/client/store.ts'
import { CLIENT_VERSION } from '../../plugin/hooks/client/remote.ts'
import type { Fx, GameState, HttpInit } from '../../plugin/hooks/client/types.ts'
import { NEXT, NOW, ORIGIN, TOKEN, fakeServer } from '../plugin/fixtures.ts'

type Timer = { at: number; seq: number; fn: () => void; active: boolean; every?: number }
const DAY = 86_400_000
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(done => setImmediate(done)) }
const registry = (autoUpdate?: boolean) => JSON.stringify({
  'claude-plugins-official': { source: { source: 'github', repo: 'anthropics/claude-plugins-official' }, autoUpdate: true },
  spinlings: { source: { source: 'git', url: 'https://github.com/416rehman/spinlings.git' }, installLocation: '/home/a/.claude/plugins/marketplaces/spinlings', ...(autoUpdate === undefined ? {} : { autoUpdate }) },
})

function world(o: { latest?: string; battles?: number; welcomed?: boolean; text?: string | null; world?: 'online' | 'offline' } = {}) {
  let now = NOW, seq = 0
  const timers: Timer[] = []
  const state = structuredClone(INITIAL) as GameState
  const server = fakeServer(o.latest ? { latestClient: o.latest } : {})
  server.me = { ...server.me, player: { ...server.me.player, battles: o.battles ?? 5 } }
  const store = new Map<string, unknown>([
    ['prefs', { world: o.world ?? 'online', worldOption: 'online' }], [`server:${ORIGIN}:session`, TOKEN],
    ...((o.welcomed ?? true) ? [[`server:${ORIGIN}:meta`, { welcomed: true }], ['offline:meta', { welcomed: true }]] as [string, unknown][] : []),
    // this version has run here before: no "is here" in the band ahead of the offer
    [KEYS.release, { v: 1, ran: CLIENT_VERSION }],
  ])
  const sent: string[] = [], copied: string[] = [], sounds: string[] = [], reads: number[] = []
  let opened = 0
  const w = {
    text: o.text === undefined ? registry() : o.text,
    state, store, sent, copied, sounds, reads,
    get opened() { return opened },
    get now() { return now },
  }
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
      sent.push(JSON.stringify({ url, ...init }))
      return server.handle(url, init)
    },
    registry: async () => { reads.push(now); return w.text },
    store: {
      get: async key => store.get(key),
      set: async (key, value) => { store.set(key, structuredClone(value)) },
      delete: async key => { store.delete(key) }, keys: async () => [...store.keys()],
    },
    state: { get: async key => state[key], update: async (key, fn) => { state[key] = fn(state[key]); return state[key] } },
    ui: {
      toast: () => undefined, status: () => undefined, log: () => undefined, sound: cue => { sounds.push(cue) },
      copy: async text => { copied.push(text); return true }, openPane: async () => { opened++; return true }, closePane: async () => undefined, blit: async () => true,
    },
  }
  /** Runs due timers up to `ms` ahead; a repeating one fires at most five times per call, so long waits stay quick. */
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
  return { w, fx, game, advance }
}

const offered = (s: GameState) => s.moments.some(m => m.kind === 'auto-update')

/**
 * A newer release puts its "is out" in the band first, whose What's new opens /spin updates; once that is open, the
 * band's own offer waits a day (a week where the guide shows the switch).
 */
async function answerUpdate(w: ReturnType<typeof world>['w'], fx: Fx, game: ReturnType<typeof world>['game'], advance: (ms: number) => Promise<void>) {
  const update = w.state.moments.find(m => m.kind === 'update')
  if (!update) return
  assert.ok(!offered(w.state), 'never beside the update line')
  await game.actions(fx).act(update.id)
  assert.deepEqual(w.state.pane.stack.at(-1), { kind: 'auto-update' })
  await advance(DAY / 2)
  assert.ok(!offered(w.state), 'not the same day as the update line')
  await advance(DAY / 2 + 60_000)
}

it('offers once while auto-update is off, then Not now waits a week and Don\'t ask again is final', async () => {
  const { w, fx, game, advance } = world()
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await advance(0)
  assert.equal(w.state.account.autoUpdate, 'off')
  await advance(60_000)
  assert.ok(offered(w.state), 'the band offers once the heartbeat finds the band idle')
  const first = w.store.get(KEYS.autoUpdate) as { asks: number; until: number; never: boolean }
  assert.equal(first.asks, 1)
  assert.equal(first.never, false)
  assert.ok(first.until > w.now && first.until <= w.now + DAY)
  await game.actions(fx).autoUpdate('later')
  assert.ok(!offered(w.state))
  const later = w.store.get(KEYS.autoUpdate) as { asks: number; until: number; never: boolean }
  assert.equal(later.asks, 1)
  assert.ok(later.until >= w.now + 7 * DAY - 60_000)
  await advance(6 * DAY)
  assert.ok(!offered(w.state), 'not before the week is out')
  await advance(DAY + 60_000)
  assert.ok(offered(w.state), 'a week later it asks again')
  await game.actions(fx).autoUpdate('never')
  assert.equal((w.store.get(KEYS.autoUpdate) as { never: boolean }).never, true)
  await advance(60 * DAY)
  assert.ok(!offered(w.state), 'never again')
  // nothing about the registry ever leaves the machine
  for (const bytes of w.sent) assert.doesNotMatch(bytes, /autoUpdate|known_marketplaces|installLocation|plugins/)
  await game.end(fx)
})

it('asks at most three times ever, and an unanswered offer waits a day', async () => {
  const { w, fx, game, advance } = world()
  await game.boot(fx, { model: 'claude-opus-5-5' })
  for (let n = 1; n <= 3; n++) {
    await advance(10 * 60_000)
    assert.ok(offered(w.state), `offer ${n}`)
    // a new session forgets the band's moments; the store remembers the offer
    w.state.moments = []
    await advance(DAY / 2)
    assert.ok(!offered(w.state), 'an unanswered offer waits a day')
    await advance(DAY / 2)
  }
  await advance(30 * DAY)
  assert.ok(!offered(w.state))
  assert.equal((w.store.get(KEYS.autoUpdate) as { asks: number }).asks, 3)
  await game.end(fx)
})

it('never offers while on or turned off on purpose, nor while unknown unless a newer release is out', async () => {
  for (const [text, latest, expected] of [
    [registry(true), NEXT, false], [null, undefined, false], ['not json', undefined, false], [null, NEXT, true], [registry(false), undefined, false],
    [registry(), undefined, true],
  ] as const) {
    const { w, fx, game, advance } = world({ text, ...(latest ? { latest } : {}) })
    await game.boot(fx, { model: 'claude-opus-5-5' })
    await advance(120_000)
    await answerUpdate(w, fx, game, advance)
    assert.equal(offered(w.state), expected, `${String(text).slice(0, 30)} ${latest ?? ''}`)
    await game.end(fx)
  }
})

it('stays out of a first run\'s welcome, a battle, other moments and a player who has not battled', async () => {
  for (const o of [{ welcomed: false }, { battles: 0 }]) {
    const { w, fx, game, advance } = world(o)
    await game.boot(fx, { model: 'claude-opus-5-5' })
    await advance(5 * 60_000)
    assert.ok(!offered(w.state), JSON.stringify(o))
    await game.end(fx)
  }
  const { w, fx, game, advance } = world()
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await advance(0)
  w.state.moments = [{ kind: 'line', id: 'line:x', tone: 'notice', text: 'x', until: null }]
  await advance(120_000)
  assert.ok(!offered(w.state), 'another moment is up')
  w.state.moments = []
  w.state.battle = { id: 'b' } as GameState['battle']
  await advance(120_000)
  assert.ok(!offered(w.state), 'a battle is on')
  w.state.battle = null
  await advance(10 * 60_000)
  assert.ok(offered(w.state))
  await game.end(fx)
})

it('Show me how opens the steps, re-reads the registry while they show, and celebrates once it is on', async () => {
  const { w, fx, game, advance } = world({ latest: NEXT })
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await advance(60_000)
  await answerUpdate(w, fx, game, advance)
  assert.ok(offered(w.state))
  const opened = w.opened
  await game.actions(fx).act('auto-update')
  assert.ok(!offered(w.state))
  assert.deepEqual(w.state.pane.stack.at(-1), { kind: 'auto-update' })
  assert.equal(w.opened, opened + 1)
  // the steps once seen wait a week before the band asks again
  assert.ok((w.store.get(KEYS.autoUpdate) as { until: number }).until >= w.now + 7 * DAY - 1)
  await game.actions(fx).autoUpdate('copy')
  assert.deepEqual(w.copied, [PLUGIN_COMMAND])
  assert.equal(w.state.pane.tone, 'good')
  assert.equal(w.state.pane.message, 'Copied /plugin. Paste it into Claude Code\'s prompt.')
  // the toggle's Copy off the terminal: the same command, for Claude Code in a terminal, where the toggle is
  await game.actions(fx).autoUpdate('copy-terminal')
  assert.deepEqual(w.copied, [PLUGIN_COMMAND, PLUGIN_COMMAND])
  assert.equal(w.state.pane.message, 'Copied /plugin. Paste it into Claude Code in a terminal.')
  const before = w.reads.length
  await advance(3 * WATCH_MS)
  assert.ok(w.reads.length >= before + 3, 'read again every few seconds while the steps show')
  assert.equal(w.state.account.autoUpdate, 'off')
  w.text = registry(true)
  await advance(WATCH_MS)
  assert.equal(w.state.account.autoUpdate, 'on')
  assert.deepEqual(w.sounds, ['rare'])
  // leaving the steps stops the reads
  w.state.pane = { ...w.state.pane, stack: [] }
  await advance(WATCH_MS)
  const after = w.reads.length
  await advance(10 * WATCH_MS)
  assert.ok(w.reads.length - after <= 1, 'no reads once the steps are gone')
  for (const bytes of w.sent) assert.doesNotMatch(bytes, /autoUpdate|known_marketplaces|installLocation/)
  await game.end(fx)
})

it('the offline world reads the same setting and sends nothing at all', async () => {
  const { w, fx, game, advance } = world({ world: 'offline' })
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await advance(0)
  // the offline save's first player has not battled yet; give it one
  w.state.me = w.state.me && { ...w.state.me, player: { ...w.state.me.player, battles: 2 } }
  await advance(60_000)
  assert.equal(w.state.account.autoUpdate, 'off')
  await game.actions(fx).autoUpdate('how')
  assert.deepEqual(w.state.pane.stack.at(-1), { kind: 'auto-update' })
  assert.deepEqual(w.sent, [])
  await game.end(fx)
})

// What's new through the real game (SPEC 32): the band says a newer mod is here once per version on this computer
// (never on a first install, nothing after a downgrade), says one is out at most once and never while Claude Code's
// auto-update will bring it (a version that can't play online always says so), opening /spin updates by any route
// takes both off the band and counts as seeing the auto-update offer, and only spinlings.dev's release notes are kept,
// under their own key, where an older mod's sessions never strip them. The offline world sends nothing throughout.
import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ReleaseNote } from '../../plugin/hooks/core/api.ts'
import { INITIAL, createGame, headMoment, newerMod } from '../../plugin/hooks/client/game.ts'
import { ASK } from '../../plugin/hooks/client/autoupdate.ts'
import type { RegistryFile } from '../../plugin/hooks/client/autoswitch.ts'
import { createLocalBackend } from '../../plugin/hooks/client/local/index.ts'
import { CLIENT_VERSION } from '../../plugin/hooks/client/remote.ts'
import { KEYS } from '../../plugin/hooks/client/store.ts'
import type { Fx, GameState, HttpInit, Moment } from '../../plugin/hooks/client/types.ts'
import { NEXT, NOW, ORIGIN, TOKEN, fakeServer } from '../plugin/fixtures.ts'

type Timer = { at: number; seq: number; fn: () => void; active: boolean; every?: number }
const DAY = 86_400_000
const COMMUNITY = 'https://cats.example'
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(done => setImmediate(done)) }
const registry = (autoUpdate?: boolean) => JSON.stringify({
  spinlings: { source: { source: 'git', url: 'https://github.com/416rehman/spinlings.git' }, ...(autoUpdate === undefined ? {} : { autoUpdate }) },
})
const NOTES: ReleaseNote[] = [
  { version: NEXT, date: '2026-12-01', highlights: [{ short: 'Team presets', text: 'Save a few teams and switch between them.' }] },
  { version: CLIENT_VERSION, date: '2026-11-09', highlights: [{ short: 'Open all', text: 'Open every waiting pack at once.' }] },
]

type Opts = {
  /** the newest version that ran here before; null: no record (a first install, or a mod from before 0.3.0) */
  ran?: string | null
  /** a machine that never ran Spinlings: no prefs at all */
  fresh?: boolean
  world?: 'online' | 'offline'
  server?: string
  latest?: string
  minClient?: string
  notes?: ReleaseNote[]
  /** Claude Code's plugin list; null: none to read */
  list?: string | null
  /** how long the list takes to read */
  slow?: number
  /** the switch can write the list */
  writable?: boolean
  /** /v1/version answers after this many ms */
  slowVersion?: number
  /** another session's store, shared with this one */
  store?: Map<string, unknown>
  /** the store refuses every write but the privacy log's, as a full one does to anything larger */
  full?: boolean
}

function world(o: Opts = {}) {
  let now = NOW, seq = 0
  const timers: Timer[] = []
  const state = structuredClone(INITIAL) as GameState
  let server = fakeServer({ ...(o.latest ? { latestClient: o.latest } : {}), ...(o.minClient ? { minClient: o.minClient } : {}), ...(o.notes ? { notes: o.notes } : {}) })
  server.me = { ...server.me, player: { ...server.me.player, battles: 5 } }
  const origin = o.server ?? ORIGIN
  const store = o.store ?? new Map<string, unknown>(o.fresh ? [] : [
    ['prefs', { world: o.world ?? 'online', worldOption: 'online', ...(origin !== ORIGIN ? { server: origin, communityOk: [origin] } : {}) }],
    [`server:${origin}:session`, TOKEN], [`server:${origin}:meta`, { welcomed: true }], ['offline:meta', { welcomed: true }],
  ])
  if (o.ran) store.set(KEYS.release, { v: 1, ran: o.ran })
  const sent: string[] = []
  const opens: boolean[] = []
  const schedule = (ms: number, fn: () => void, every?: number) => {
    const t: Timer = { at: now + ms, seq: seq++, fn, active: true, ...(every ? { every } : {}) }
    timers.push(t)
    return { cancel: () => { t.active = false } }
  }
  const list = o.list === undefined ? registry() : o.list
  const file: RegistryFile = {
    stat: async () => ({ kind: 'file', size: list?.length ?? 0, isLink: false }), lock: async () => null,
    read: async () => Buffer.from(list ?? '').toString('base64'), write: async () => undefined,
  }
  const fx: Fx = {
    now: async () => now, random: () => 0.5,
    after: (ms, fn) => schedule(ms, fn),
    every: (ms, fn) => schedule(ms, fn, ms),
    fetch: async (url: string, init: HttpInit) => {
      sent.push(url)
      // every server answers as the fake does, whatever its address
      const answer = () => server.handle(url.replace(/^https:\/\/[^/]+/, ORIGIN), init)
      if (o.slowVersion && url.endsWith('/v1/version')) return new Promise(done => { schedule(o.slowVersion!, () => done(answer())) })
      return answer()
    },
    registry: () => (o.slow ? new Promise(done => { schedule(o.slow!, () => done(list)) }) : Promise.resolve(list)),
    ...(o.writable ? { registryFile: file } : {}),
    store: {
      get: async key => structuredClone(store.get(key)),
      set: async (key, value) => {
        if (o.full && key !== KEYS.privacy) throw new Error('the store is full')
        store.set(key, structuredClone(value))
      },
      delete: async key => { store.delete(key) }, keys: async () => [...store.keys()],
    },
    state: { get: async key => state[key], update: async (key, fn) => { state[key] = fn(state[key]); return state[key] } },
    ui: {
      toast: () => undefined, status: () => undefined, log: () => undefined, sound: () => undefined,
      copy: async () => true, openPane: async keys => { opens.push(keys !== false); return true }, closePane: async () => undefined, blit: async () => true,
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
  const make = () => createGame({ slots: { local: createLocalBackend, battle: async () => undefined, reveal: async () => undefined, moments: null } })
  return {
    state, store, sent, fx, advance, make, opens,
    get server() { return server }, set server(next) { server = next },
    get now() { return now }, set now(t: number) { now = t },
  }
}

const kinds = (s: GameState) => s.moments.map(m => m.kind).filter(k => k === 'update' || k === 'updated')
const updated = (s: GameState) => s.moments.find((m): m is Extract<Moment, { kind: 'updated' }> => m.kind === 'updated')

it('says a newer mod is here once per version: two boots on it show it once, and the record moves forward', async () => {
  const w = world({ ran: '0.2.16' })
  await w.make().boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  assert.deepEqual(updated(w.state), { kind: 'updated', id: `updated:${CLIENT_VERSION}`, version: CLIENT_VERSION, from: '0.2.16', until: null })
  assert.deepEqual(w.store.get(KEYS.release), { v: 1, ran: CLIENT_VERSION })
  // Close drops it for good: the next boot of the same version, in this session or a new one, says nothing
  const game = w.make()
  await game.actions(w.fx).dismiss(`updated:${CLIENT_VERSION}`)
  assert.deepEqual(kinds(w.state), [])
  await game.boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  assert.deepEqual(kinds(w.state), [])
  w.state.moments = []
  await w.make().reseed(w.fx)
  await w.advance(0)
  assert.deepEqual(kinds(w.state), [])
})

it('a reload into a newer module says so in the same session; one from before 0.3.0 kept no record, so it is from a version not known', async () => {
  const w = world({ ran: null })
  // the old module's session: its state stays, its in-memory game is gone
  w.state.account = { ...w.state.account, link: 'ready' }
  await w.make().boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  assert.equal(updated(w.state)?.from, '')
  assert.deepEqual(w.store.get(KEYS.release), { v: 1, ran: CLIENT_VERSION })
})

it('a first install says nothing (the welcome is the moment), and a downgrade says nothing and writes nothing', async () => {
  const fresh = world({ fresh: true })
  await fresh.make().boot(fresh.fx, { model: 'claude-opus-5-5' })
  await fresh.advance(0)
  assert.deepEqual(kinds(fresh.state), [])
  assert.deepEqual(fresh.store.get(KEYS.release), { v: 1, ran: CLIENT_VERSION })
  const older = world({ ran: '9.0.0' })
  await older.make().boot(older.fx, { model: 'claude-opus-5-5' })
  await older.advance(0)
  assert.deepEqual(kinds(older.state), [])
  assert.deepEqual(older.store.get(KEYS.release), { v: 1, ran: '9.0.0' })
})

it('what an older module queued is dropped at boot, and "is out" wins over "is here"', async () => {
  const w = world({ ran: '0.2.16', latest: NEXT })
  w.state.moments = [
    { kind: 'updated', id: 'updated:0.2.16', version: '0.2.16', from: '0.2.15', until: null },
    { kind: 'update', id: `update:${CLIENT_VERSION}`, version: CLIENT_VERSION, until: null },
    { kind: 'update', id: `update:${NEXT}`, version: NEXT, until: null },
  ]
  await w.make().boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  // the greeting for the old version and the news of this one are gone; a newer one still out stays, alone
  assert.deepEqual(w.state.moments.filter(m => m.kind === 'update' || m.kind === 'updated').map(m => m.id), [`update:${NEXT}`])
  // and a newer release announced after a greeting replaces it
  const v = world({ ran: '0.2.16', latest: NEXT, notes: NOTES })
  await v.make().boot(v.fx, { model: 'claude-opus-5-5' })
  assert.deepEqual(kinds(v.state), ['updated'])
  await v.advance(0)
  assert.deepEqual(kinds(v.state), ['update'])
  assert.equal(v.state.moments.find(m => m.kind === 'update')?.id, `update:${NEXT}`)
})

it('no "is out" while auto-update will bring it, waiting for the first read of the list; one that can\'t play online always says so', async () => {
  // the list reads slowly: the version answer comes first, and the band waits for the list before it decides
  const w = world({ ran: CLIENT_VERSION, latest: NEXT, list: registry(true), slow: 5000 })
  await w.make().boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(10_000)
  assert.equal(w.state.account.autoUpdate, 'on')
  assert.equal(w.state.account.latest, NEXT)
  assert.deepEqual(kinds(w.state), [])
  // it is not news again later: once per release
  assert.equal((w.store.get('prefs') as { updateSeen: string }).updateSeen, NEXT)
  const off = world({ ran: CLIENT_VERSION, latest: NEXT, list: registry() })
  await off.make().boot(off.fx, { model: 'claude-opus-5-5' })
  await off.advance(0)
  assert.deepEqual(kinds(off.state), ['update'])
  const held = world({ ran: CLIENT_VERSION, minClient: NEXT, latest: NEXT, list: registry(true) })
  await held.make().boot(held.fx, { model: 'claude-opus-5-5' })
  await held.advance(0)
  assert.equal(held.state.account.readOnly, true)
  assert.deepEqual(held.state.moments.filter(m => m.kind === 'update').map(m => m.id), [`update:${NEXT}`])
})

it('opening /spin updates by any route takes both off the band and counts as seeing the offer: a week where it shows Turn it on', async () => {
  const w = world({ ran: CLIENT_VERSION, writable: true })
  const game = w.make()
  await game.boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  assert.equal(w.state.account.autoUpdateWritable, true)
  w.state.moments = [
    { kind: 'updated', id: `updated:${CLIENT_VERSION}`, version: CLIENT_VERSION, from: '0.2.16', until: null },
    { kind: 'update', id: `update:${NEXT}`, version: NEXT, until: null },
  ]
  await game.actions(w.fx).updates()
  assert.deepEqual(kinds(w.state), [])
  assert.deepEqual(w.state.pane.stack.at(-1), { kind: 'auto-update' })
  assert.ok((w.store.get(KEYS.autoUpdate) as { until: number }).until >= w.now + ASK.laterMs)
  // where the guide cannot show the switch, a day, as the update line once did
  const v = world({ ran: CLIENT_VERSION, list: null })
  const g = v.make()
  await g.boot(v.fx, { model: 'claude-opus-5-5' })
  await v.advance(0)
  await g.command(v.fx, 'updates')
  const until = (v.store.get(KEYS.autoUpdate) as { until: number }).until
  assert.ok(until >= v.now + DAY && until < v.now + ASK.laterMs)
})

it('the band\'s What\'s new opens /spin updates without the keyboard, "is here" saying where it came from', async () => {
  const w = world({ ran: '0.2.16' })
  const game = w.make()
  await game.boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  await game.actions(w.fx).act(`updated:${CLIENT_VERSION}`)
  assert.deepEqual(w.state.pane.stack.at(-1), { kind: 'auto-update', here: '0.2.16' })
  assert.deepEqual(w.opens.at(-1), false)
  assert.deepEqual(kinds(w.state), [])
  const v = world({ ran: CLIENT_VERSION, latest: NEXT, notes: NOTES })
  const g = v.make()
  await g.boot(v.fx, { model: 'claude-opus-5-5' })
  await v.advance(0)
  await g.actions(v.fx).act(`update:${NEXT}`)
  assert.deepEqual(v.state.pane.stack.at(-1), { kind: 'auto-update' })
  assert.deepEqual(v.opens.at(-1), false)
})

it('a switch of world keeps what the band says about this mod, and moves what a server said about versions out', async () => {
  const w = world({ ran: '0.2.16', latest: NEXT, notes: NOTES })
  const game = w.make()
  await game.boot(w.fx, { model: 'claude-opus-5-5' })
  w.state.moments = [{ kind: 'updated', id: `updated:${CLIENT_VERSION}`, version: CLIENT_VERSION, from: '0.2.16', until: null }]
  await w.advance(0)
  assert.equal(w.state.account.notes?.[0]?.version, NEXT)
  assert.equal(typeof w.state.account.checked, 'string')
  w.state.moments = [{ kind: 'updated', id: `updated:${CLIENT_VERSION}`, version: CLIENT_VERSION, from: '0.2.16', until: null }]
  await game.command(w.fx, 'world offline')
  await w.advance(0)
  assert.deepEqual(kinds(w.state), ['updated'])
  assert.deepEqual({ notes: w.state.account.notes, checked: w.state.account.checked, checking: w.state.account.checking, latest: w.state.account.latest },
    { notes: undefined, checked: undefined, checking: undefined, latest: null })
})

it('keeps spinlings.dev\'s notes under their own key, never another server\'s, and an older session\'s meta loses none of them', async () => {
  const w = world({ ran: CLIENT_VERSION, latest: NEXT, notes: NOTES })
  await w.make().boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  assert.deepEqual(w.store.get(KEYS.notes(ORIGIN)), { v: 1, notes: NOTES })
  // the meta keeps the version answer without its notes: a reader from before them rebuilds it the same
  const meta = w.store.get(KEYS.meta(ORIGIN)) as { version: Record<string, unknown> }
  assert.equal('notes' in meta.version, false)
  assert.deepEqual(w.state.account.notes?.map(n => n.version), [NEXT])
  // an older mod's session saves its meta (a duel's time) with its own reader; the same day's boot still has the notes
  w.store.set(KEYS.meta(ORIGIN), { ...meta, lastDuelAt: NOW })
  w.state.account = { ...w.state.account, notes: [] }
  const requests = w.sent.length
  await w.make().boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  assert.equal(w.sent.filter(u => u.endsWith('/v1/version')).length, w.sent.slice(0, requests).filter(u => u.endsWith('/v1/version')).length)
  assert.deepEqual(w.state.account.notes?.map(n => n.version), [NEXT])
  // a community server's notes are never kept nor shown, though its version answer is
  const c = world({ ran: CLIENT_VERSION, server: COMMUNITY, latest: NEXT, notes: NOTES })
  await c.make().boot(c.fx, { model: 'claude-opus-5-5' })
  await c.advance(0)
  assert.equal(c.state.account.server, COMMUNITY)
  assert.equal(c.state.account.latest, NEXT)
  assert.deepEqual(c.state.account.notes, [])
  assert.equal(c.store.has(KEYS.notes(COMMUNITY)), false)
  assert.equal([...c.store.keys()].some(k => k.endsWith(':notes')), false)
})

it('a check a reload cut short is not still asking, and one under way says so until it ends', async () => {
  const w = world({ ran: CLIENT_VERSION })
  w.state.account = { ...w.state.account, checking: true }
  const game = w.make()
  await game.boot(w.fx, { model: 'claude-opus-5-5' })
  assert.equal(w.state.account.checking, false)
  let during: boolean | undefined
  w.server.handle = (handle => (url: string, init?: Parameters<typeof handle>[1]) => {
    if (url.endsWith('/v1/version')) during = w.state.account.checking
    return handle(url, init)
  })(w.server.handle.bind(w.server))
  await w.advance(0)
  assert.equal(during, true)
  assert.equal(w.state.account.checking, false)
  assert.equal(w.state.account.checked, new Date(NOW).toISOString().slice(0, 10))
})

it('the offline world sends nothing while "is here" and /spin updates show', async () => {
  const w = world({ ran: '0.2.16', world: 'offline' })
  const game = w.make()
  await game.boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  assert.equal(updated(w.state)?.from, '0.2.16')
  await game.actions(w.fx).act(`updated:${CLIENT_VERSION}`)
  await game.command(w.fx, 'updates')
  await game.command(w.fx, 'version')
  await w.advance(30 * 60_000)
  assert.equal(w.state.pane.stack.at(-1)?.kind, 'auto-update')
  assert.deepEqual(w.sent, [])
})

it('that this version can\'t play online is news of its own: told once, though the release was told as out (or swallowed by auto-update)', async () => {
  for (const auto of [false, true]) {
    const w = world({ ran: CLIENT_VERSION, latest: NEXT, list: registry(auto ? true : undefined) })
    const game = w.make()
    await game.boot(w.fx, { model: 'claude-opus-5-5' })
    await w.advance(0)
    if (auto) assert.deepEqual(kinds(w.state), [], 'on and able: nothing to say')
    else {
      assert.deepEqual(kinds(w.state), ['update'])
      await game.actions(w.fx).dismiss(`update:${NEXT}`)
    }
    // the next day the server needs that release to play online at all
    const needs = fakeServer({ latestClient: NEXT, minClient: NEXT })
    needs.me = w.server.me
    w.server = needs
    w.now += DAY
    await game.boot(w.fx, { model: 'claude-opus-5-5' })
    await w.advance(0)
    assert.equal(w.state.account.readOnly, true)
    assert.deepEqual(w.state.moments.filter(m => m.kind === 'update').map(m => m.id), [`update:${NEXT}`], `auto-update on: ${auto}`)
    // and that is news once too
    await game.actions(w.fx).dismiss(`update:${NEXT}`)
    w.now += DAY
    await game.boot(w.fx, { model: 'claude-opus-5-5' })
    await w.advance(0)
    assert.deepEqual(kinds(w.state), [])
  }
})

it('a refusal during the day asks the server again: this version can\'t play online, the band says so, and it holds', async () => {
  const w = world({ ran: CLIENT_VERSION, latest: NEXT })
  const game = w.make()
  await game.boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  await game.actions(w.fx).dismiss(`update:${NEXT}`)
  // the server now needs NEXT: it refuses every write, and its version answer says so
  const handle = w.server.handle.bind(w.server)
  w.server.handle = (url, init) => {
    if (url.endsWith('/v1/version')) {
      const a = handle(url, init)
      return { ...a, text: JSON.stringify({ ...JSON.parse(a.text) as object, minClient: NEXT }) }
    }
    if ((init?.method ?? 'GET') !== 'GET') {
      return { status: 426, ok: false, headers: { 'content-type': 'application/json' }, text: JSON.stringify({ error: { code: 'upgrade_required', message: 'Update Spinlings' } }) }
    }
    return handle(url, init)
  }
  const asked = () => w.sent.filter(u => u.endsWith('/v1/version')).length
  const before = asked()
  const duel = game.command(w.fx, 'battle')
  await w.advance(1000)
  await duel
  assert.equal(w.state.account.readOnly, true)
  // the next heartbeat's check asks again instead of trusting the morning's answer
  await w.advance(6 * 60_000)
  assert.equal(w.state.account.readOnly, true)
  assert.equal(asked(), before + 1)
  assert.deepEqual(w.state.moments.filter(m => m.kind === 'update').map(m => m.id), [`update:${NEXT}`])
})

it('a reload into the release it announced judges the stored answer again at once: the update is never offered as newer than itself', async () => {
  const today = new Date(NOW).toISOString().slice(0, 10)
  for (const readOnly of [false, true]) {
    // the old module's state stays across the reload; its version answer is the day's, and the new module's own is slow
    const w = world({ ran: null, latest: CLIENT_VERSION, slowVersion: 5000 })
    w.state.account = { ...w.state.account, link: 'ready', latest: CLIENT_VERSION, readOnly }
    w.store.set(KEYS.meta(ORIGIN), {
      welcomed: true, versionDay: today, versionClient: '0.2.16',
      version: { api: 1, server: '0.2.16', rules: 1, generator: 1, minClient: readOnly ? CLIENT_VERSION : '0.0.1', latestClient: CLIENT_VERSION, features: [] },
    })
    await w.make().boot(w.fx, { model: 'claude-opus-5-5' })
    assert.deepEqual(kinds(w.state), ['updated'])
    assert.deepEqual({ newer: newerMod(w.state.account), readOnly: w.state.account.readOnly }, { newer: null, readOnly: false }, `old module read-only: ${readOnly}`)
    await w.advance(6000)
    assert.deepEqual({ newer: newerMod(w.state.account), readOnly: w.state.account.readOnly }, { newer: null, readOnly: false })
  }
  // and whatever an account holds, this version or an older one is never newer
  for (const latest of [CLIENT_VERSION, '0.2.16', `${CLIENT_VERSION}-beta.1`, 'soon']) assert.equal(newerMod({ world: 'online', latest }), null, latest)
  assert.equal(newerMod({ world: 'online', latest: NEXT }), NEXT)
})

it('two sessions starting on a machine that never ran Spinlings: neither greets, whatever the order their steps interleave in', async () => {
  for (let offset = 0; offset < 160; offset++) {
    const store = new Map<string, unknown>()
    const a = world({ fresh: true, store })
    const b = world({ fresh: true, store })
    const first = a.make().boot(a.fx, { model: 'claude-opus-5-5' })
    for (let i = 0; i < offset; i++) await Promise.resolve()
    await Promise.all([first, b.make().boot(b.fx, { model: 'claude-opus-5-5' })])
    assert.deepEqual([kinds(a.state), kinds(b.state)], [[], []], `offset ${offset}`)
  }
})

it('a store that refuses the record greets nothing and still connects', async () => {
  const w = world({ ran: '0.2.16', full: true })
  await w.make().boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  assert.deepEqual(kinds(w.state), [])
  assert.ok(w.sent.some(u => u.endsWith('/v1/version')))
})

it('"is here" waits behind the band\'s lines, which expire, and comes before the passkey offer and "is out"', () => {
  const here: Moment = { kind: 'updated', id: `updated:${CLIENT_VERSION}`, version: CLIENT_VERSION, from: '', until: null }
  const reaction: Moment = { kind: 'line', id: 'line-1', tone: 'reaction', text: 'Gritmole flinched', until: NOW + 6000 }
  const notice: Moment = { ...reaction, id: 'line-2', tone: 'notice', text: 'The battle fizzled out' }
  const passkey: Moment = { kind: 'passkey', id: 'passkey', until: null }
  const out: Moment = { kind: 'update', id: `update:${NEXT}`, version: NEXT, until: null }
  assert.equal(headMoment([here, reaction])?.id, reaction.id)
  assert.equal(headMoment([here, notice])?.id, notice.id)
  assert.equal(headMoment([passkey, here])?.id, here.id)
  assert.equal(headMoment([out, passkey])?.id, passkey.id)
})

it('"is out" goes with what the server said: on a switch of world, and once the server names another release or none', async () => {
  const w = world({ ran: CLIENT_VERSION, latest: NEXT, notes: NOTES })
  const game = w.make()
  await game.boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(0)
  assert.deepEqual(kinds(w.state), ['update'])
  await game.command(w.fx, 'world offline')
  await w.advance(0)
  assert.deepEqual(kinds(w.state), [])
  // a rollback: the next day the server names no newer release, before the band's news was pressed
  const v = world({ ran: CLIENT_VERSION, latest: NEXT })
  const g = v.make()
  await g.boot(v.fx, { model: 'claude-opus-5-5' })
  await v.advance(0)
  assert.deepEqual(kinds(v.state), ['update'])
  const back = fakeServer({ latestClient: CLIENT_VERSION })
  back.me = v.server.me
  v.server = back
  v.now += DAY
  await g.boot(v.fx, { model: 'claude-opus-5-5' })
  await v.advance(0)
  assert.equal(v.state.account.latest, null)
  assert.deepEqual(kinds(v.state), [])
})

it('a switch of world or server while the band waits on the first read of the list: no "is out" for the place left', async () => {
  // the version answer comes first, the list takes 5 s, and the player switches 1 s after boot
  const w = world({ ran: CLIENT_VERSION, latest: NEXT, slow: 5000 })
  const game = w.make()
  await game.boot(w.fx, { model: 'claude-opus-5-5' })
  await w.advance(1000)
  assert.equal(w.state.account.latest, NEXT)
  assert.equal(w.state.account.autoUpdate, undefined)
  await game.command(w.fx, 'world offline')
  await w.advance(10_000)
  assert.equal(w.state.account.world, 'offline')
  assert.equal(newerMod(w.state.account), null)
  assert.deepEqual(kinds(w.state), [])
  // to another server: the release was told for the one left, so it is not told again
  const s = world({ ran: CLIENT_VERSION, server: COMMUNITY, latest: NEXT, slow: 5000 })
  const g = s.make()
  await g.boot(s.fx, { model: 'claude-opus-5-5' })
  await s.advance(1000)
  assert.equal(s.state.account.latest, NEXT)
  await g.command(s.fx, 'server default')
  await s.advance(10_000)
  assert.equal(s.state.account.server, ORIGIN)
  assert.deepEqual(kinds(s.state), [])
})

// The auto-update switch through the real game (SPEC 32): from the guide and from the band's offer, one press writes
// once, the chip flips from a fresh read, and the payoff (one chime, a short band line) follows only a confirmed
// write. A key within 500 ms of the guide or the offer appearing, of the setting changing or of a press settling
// does nothing. Turned off on purpose, held by Claude Code's environment, or not an installed copy: no switch and no
// write. Another marketplace's git URL carries a token: after every flow neither it (as text, base64, hex or escapes)
// nor any other word of the list is in the store, the game's state, the logs, toasts, status line or requests, and
// the store holds only the game's own keys. A guide opened from the band never takes the keyboard.
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { AUTO_CALM_MS, INITIAL, createGame } from '../../plugin/hooks/client/game.ts'
import { WATCH_MS } from '../../plugin/hooks/client/autoupdate.ts'
import { LOCK_WAIT_MS } from '../../plugin/hooks/client/autoswitch.ts'
import type { RegistryFile } from '../../plugin/hooks/client/autoswitch.ts'
import { createLocalBackend } from '../../plugin/hooks/client/local/index.ts'
import { KEYS } from '../../plugin/hooks/client/store.ts'
import { CLIENT_VERSION } from '../../plugin/hooks/client/remote.ts'
import type { Fx, GameState, HttpInit } from '../../plugin/hooks/client/types.ts'
import { NOW, ORIGIN, TOKEN, fakeServer } from '../plugin/fixtures.ts'
import { CANARY, b64, cc, leaksIn, list } from '../plugin/registry.ts'

type Timer = { at: number; seq: number; fn: () => void; active: boolean; every?: number }
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(done => setImmediate(done)) }
/** Where the fake list lives, as the guide names it when a write left the list unreadable. */
const FOLDER = '/cfg/plugins'
/** The keys the game keeps in $.store in these flows: its own, and nothing a copy of the list could hide under. */
const OWN = [/^prefs$/, /^presence$/, /^privacy$/, /^release$/, /^autoupdate$/, /^autoupdate:(mine|pending)$/, /^offline:(v1|meta)$/, new RegExp(`^server:${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(session|cache|meta|notes|season:\\d+)$`)]

type Opts = { text?: string; held?: boolean; installed?: boolean; lock?: () => boolean; read?: () => string; write?: (text: string) => string }

function world(o: Opts = {}) {
  let now = NOW, seq = 0
  const timers: Timer[] = []
  const state = structuredClone(INITIAL) as GameState
  const server = fakeServer()
  server.me = { ...server.me, player: { ...server.me.player, battles: 5 } }
  const store = new Map<string, unknown>([
    ['prefs', { world: 'online', worldOption: 'online' }], [`server:${ORIGIN}:session`, TOKEN],
    [`server:${ORIGIN}:meta`, { welcomed: true }], ['offline:meta', { welcomed: true }],
    // this version has run here before: no "is here" in the band ahead of the offer
    [KEYS.release, { v: 1, ran: CLIENT_VERSION }],
  ])
  const w = {
    bytes: b64(o.text ?? cc(list())), held: !!o.held,
    state, store, sent: [] as string[], logs: [] as string[], toasts: [] as string[], status: [] as (string | undefined)[],
    sounds: [] as string[], copied: [] as string[], writes: [] as string[], fileReads: 0, keys: [] as boolean[],
    get now() { return now },
    get text() { return Buffer.from(w.bytes, 'base64').toString('utf8') },
    set text(t: string) { w.bytes = b64(t) },
  }
  const schedule = (ms: number, fn: () => void, every?: number) => {
    const t: Timer = { at: now + ms, seq: seq++, fn, active: true, ...(every ? { every } : {}) }
    timers.push(t)
    return { cancel: () => { t.active = false } }
  }
  const file: RegistryFile = {
    stat: async () => ({ kind: 'file', size: Buffer.from(w.bytes, 'base64').length, isLink: false }),
    lock: async () => (o.lock?.() ? { mtimeMs: now } : null),
    read: async () => { w.fileReads++; return o.read ? o.read() : w.bytes },
    write: async text => { w.writes.push(text); w.bytes = b64(o.write ? o.write(text) : text) },
  }
  const fx: Fx = {
    now: async () => now, random: () => 0.5,
    after: (ms, fn) => schedule(ms, fn),
    every: (ms, fn) => schedule(ms, fn, ms),
    fetch: async (url: string, init: HttpInit) => {
      w.sent.push(JSON.stringify({ url, ...init }))
      return server.handle(url, init)
    },
    ...(o.installed === false ? {} : { registry: async () => w.text, registryFile: file, registryFolder: FOLDER }),
    updatesHeld: async () => w.held,
    store: {
      get: async key => structuredClone(store.get(key)),
      set: async (key, value) => { store.set(key, structuredClone(value)) },
      delete: async key => { store.delete(key) }, keys: async () => [...store.keys()],
    },
    state: { get: async key => state[key], update: async (key, fn) => { state[key] = fn(state[key]); return state[key] } },
    ui: {
      toast: t => { w.toasts.push(t) }, status: t => { w.status.push(t) }, log: t => { w.logs.push(t) }, sound: cue => { w.sounds.push(cue) },
      copy: async t => { w.copied.push(t); return true }, openPane: async keys => { w.keys.push(keys !== false); return true }, closePane: async () => undefined, blit: async () => true,
    },
  }
  /**
   * Runs due timers up to `ms` ahead; a repeating one fires at most five times per call. With `until`, stops right
   * after the timer that makes it true, the clock at that timer's time.
   */
  const advance = async (ms: number, until?: () => boolean) => {
    const end = now + ms
    const fired = new Map<Timer, number>()
    for (;;) {
      await flush()
      if (until?.()) return
      timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
      const t = timers.find(t => t.active && t.at <= end)
      if (!t) break
      now = Math.max(now, t.at)
      if (t.every) {
        const n = (fired.get(t) ?? 0) + 1
        fired.set(t, n)
        t.at = n >= 5 && !until ? Math.max(t.at + t.every, end - t.every + 1) : t.at + t.every
      } else timers.splice(timers.indexOf(t), 1)
      t.fn()
    }
    now = end
    await flush()
  }
  const game = createGame({ slots: { local: createLocalBackend, battle: async () => undefined, reveal: async () => undefined, moments: null } })
  return { w, fx, game, advance, actions: () => game.actions(fx) }
}

type World = ReturnType<typeof world>['w']

/** Nothing of the list (the token in any common form, or any other word of it) is where the game keeps, says or sends anything. */
function clean(w: World): void {
  const seen = { store: [...w.store], state: w.state, logs: w.logs, toasts: w.toasts, status: w.status, sent: w.sent, copied: w.copied }
  for (const [where, what] of Object.entries(seen)) assert.deepEqual(leaksIn(JSON.stringify(what) ?? ''), [], where)
  for (const key of w.store.keys()) assert.ok(OWN.some(k => k.test(key)), `the store holds ${key}`)
  // the switch's record and its pending one each have exactly one shape, and the offer's record its three fields
  const mine = w.store.get(KEYS.autoSwitch)
  assert.ok(mine === undefined || JSON.stringify(mine) === JSON.stringify({ v: 1, on: true }), JSON.stringify(mine))
  const pending = w.store.get(KEYS.autoSwitchPending)
  assert.ok(pending === undefined || JSON.stringify(pending) === JSON.stringify({ v: 1, on: true, pending: true }), JSON.stringify(pending))
  const ask = w.store.get(KEYS.autoUpdate) as Record<string, unknown> | undefined
  if (ask !== undefined) assert.deepEqual(Object.keys(ask).sort(), ['asks', 'never', 'until'])
}

const payoff = (w: World) => w.state.moments.filter(m => m.kind === 'auto-on').length
const offered = (s: GameState) => s.moments.some(m => m.kind === 'auto-update')

it('from the guide: a key as it appears does nothing; On writes once, the chip flips, one chime; again writes nothing; Off restores the bytes', async () => {
  const original = cc(list())
  const { w, fx, game, advance, actions } = world({ text: original })
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await advance(0)
  assert.equal(w.state.account.autoUpdate, 'off')
  assert.equal(w.state.account.autoUpdateWritable, true)
  await game.command(fx, 'updates')
  assert.deepEqual(w.state.pane.stack.at(-1), { kind: 'auto-update' })
  assert.deepEqual(w.keys, [true], '/spin updates is typed: the guide takes the keyboard')
  // a key pressed as the guide appears writes nothing
  await actions().autoUpdate('on')
  await advance(AUTO_CALM_MS - 100)
  await actions().autoUpdate('on')
  assert.deepEqual(w.writes, [])
  await advance(200)
  await actions().autoUpdate('on')
  assert.equal(w.writes.length, 1)
  assert.deepEqual(JSON.parse(w.text).spinlings.autoUpdate, true)
  assert.equal(w.state.account.autoUpdate, 'on', 'the chip flips at once')
  assert.equal(w.state.account.autoUpdateOurs, true)
  assert.deepEqual(w.state.pane.autoPress, { phase: 'done', to: 'on', result: 'ok' })
  assert.deepEqual(w.sounds, ['rare'])
  assert.equal(payoff(w), 1)
  assert.deepEqual(w.store.get(KEYS.autoSwitch), { v: 1, on: true })
  // the watcher sees it on and plays nothing more
  await advance(3 * WATCH_MS)
  assert.deepEqual(w.sounds, ['rare'])
  // a second press: nothing written, no second payoff
  await actions().autoUpdate('on')
  assert.equal(w.writes.length, 1)
  assert.deepEqual(w.sounds, ['rare'])
  // Turn it off, right after a press settled, does nothing; later it takes exactly the key away
  await actions().autoUpdate('off')
  assert.equal(w.writes.length, 1)
  await advance(AUTO_CALM_MS)
  await actions().autoUpdate('off')
  assert.equal(w.writes.length, 2)
  assert.equal(w.text, original)
  assert.equal(w.state.account.autoUpdate, 'off')
  assert.deepEqual(w.state.pane.autoPress, { phase: 'done', to: 'off', result: 'ok' })
  assert.equal(w.store.has(KEYS.autoSwitch), false)
  assert.equal((w.store.get(KEYS.autoUpdate) as { never: boolean }).never, true, 'an explicit off ends the offers')
  assert.deepEqual(w.sounds, ['rare'], 'no payoff for off')
  clean(w)
  await game.end(fx)
})

it('the band\'s offer turns it on in one press, but not a key pressed as it appears; then it is gone and the band says so', async () => {
  const { w, fx, game, advance, actions } = world()
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await advance(30 * 60_000, () => offered(w.state))
  assert.ok(offered(w.state), 'the band offers')
  await actions().autoUpdate('on')
  await advance(AUTO_CALM_MS - 1)
  await actions().autoUpdate('on')
  assert.deepEqual(w.writes, [])
  assert.ok(offered(w.state), 'the offer stays for a real press')
  await advance(1)
  await actions().autoUpdate('on')
  assert.equal(w.writes.length, 1)
  assert.equal(offered(w.state), false)
  assert.equal(w.state.account.autoUpdate, 'on')
  assert.equal(payoff(w), 1)
  assert.deepEqual(w.sounds, ['rare'])
  assert.notEqual(w.state.pane.stack.at(-1)?.kind, 'auto-update', 'a press that worked opens nothing')
  clean(w)
  await game.end(fx)
})

it('a press the band could not do opens the guide, which says why; the offer waits a week', async () => {
  let locked = false
  const { w, fx, game, advance, actions } = world({ lock: () => locked })
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await advance(30 * 60_000, () => offered(w.state))
  await advance(AUTO_CALM_MS)
  locked = true
  const pressing = actions().autoUpdate('on')
  await advance(0)
  assert.deepEqual(w.state.pane.autoPress, { phase: 'pressing', to: 'on' })
  await advance(LOCK_WAIT_MS + 500)
  await pressing
  assert.deepEqual(w.writes, [])
  assert.deepEqual(w.state.pane.stack.at(-1), { kind: 'auto-update' })
  assert.deepEqual(w.keys, [false], 'the guide a band press opened does not take the keyboard')
  assert.deepEqual(w.state.pane.autoPress, { phase: 'done', to: 'on', result: 'busy' })
  assert.ok((w.store.get(KEYS.autoUpdate) as { until: number }).until >= w.now + 6 * 86_400_000)
  assert.deepEqual(w.sounds, [])
  // Try again, once Claude Code is done
  locked = false
  await advance(AUTO_CALM_MS)
  await actions().autoUpdate('on')
  assert.equal(w.writes.length, 1)
  assert.equal(w.state.account.autoUpdate, 'on')
  clean(w)
  await game.end(fx)
})

it('turned off on purpose, held, or not an installed copy: no switch and no write; the band never asks', async () => {
  for (const o of [{ text: cc(list({ autoUpdate: false })) }, { held: true }, { installed: false }] as Opts[]) {
    const { w, fx, game, advance, actions } = world(o)
    await game.boot(fx, { model: 'claude-opus-5-5' })
    await advance(30 * 60_000)
    assert.equal(offered(w.state), false, JSON.stringify(o))
    const a = w.state.account
    if (o.held) assert.equal(a.autoUpdateHeld, true)
    if (o.installed === false) assert.equal(a.autoUpdateWritable, false)
    else if (!o.held) assert.equal(a.autoUpdate, 'off-chosen')
    await game.command(fx, 'updates')
    await advance(AUTO_CALM_MS)
    const reads = w.fileReads
    await actions().autoUpdate('on')
    assert.deepEqual(w.writes, [], JSON.stringify(o))
    if (o.held || o.installed === false) assert.equal(w.fileReads, reads, 'not even read')
    assert.deepEqual(w.sounds, [])
    clean(w)
    await game.end(fx)
  }
})

it('the record holds only while the list says on: /plugin turning it off drops it, and on again is not ours', async () => {
  const { w, fx, game, advance, actions } = world()
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await game.command(fx, 'updates')
  await advance(AUTO_CALM_MS)
  await actions().autoUpdate('on')
  assert.equal(w.state.account.autoUpdateOurs, true)
  w.text = cc(list({ autoUpdate: false }))
  await advance(WATCH_MS)
  assert.equal(w.state.account.autoUpdate, 'off-chosen')
  assert.equal(w.store.has(KEYS.autoSwitch), false)
  assert.equal(w.state.pane.autoPress, null, 'the last press\'s result goes once the setting changes')
  w.text = cc(list({ autoUpdate: true }))
  await advance(WATCH_MS)
  assert.equal(w.state.account.autoUpdate, 'on')
  assert.equal(w.state.account.autoUpdateOurs, false)
  assert.deepEqual(w.sounds, ['rare', 'rare'], 'turned on in /plugin: the watcher\'s chime')
  await advance(AUTO_CALM_MS)
  await actions().autoUpdate('off')
  assert.equal(w.writes.length, 1, 'not ours to turn off')
  assert.equal(JSON.parse(w.text).spinlings.autoUpdate, true)
  clean(w)
  await game.end(fx)
})

it('/spin version says where auto-update stands, and /spin updates opens the guide', async () => {
  for (const [o, word] of [[{}, 'off'], [{ text: cc(list({ autoUpdate: true })) }, 'on'], [{ held: true }, 'can\'t run here'], [{ installed: false }, 'can\'t tell from here']] as [Opts, string][]) {
    const { w, fx, game, advance } = world(o)
    await game.boot(fx, { model: 'claude-opus-5-5' })
    await advance(0)
    await game.command(fx, 'version')
    await advance(0)
    assert.equal(w.logs.at(-1)?.split('\n').at(-1), `Auto-update: ${word} · /spin updates`, word)
    clean(w)
    await game.end(fx)
  }
})

it('a file whose read fails with the token in its error: the press answers in a code and says nothing of it', async () => {
  const { w, fx, game, advance, actions } = world({ read: () => { throw new Error(`EACCES: open ${CANARY}`) } })
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await game.command(fx, 'updates')
  await advance(AUTO_CALM_MS)
  await actions().autoUpdate('on')
  assert.deepEqual(w.writes, [])
  assert.deepEqual(w.state.pane.autoPress, { phase: 'done', to: 'on', result: 'cannot' })
  clean(w)
  await game.end(fx)
})

it('the band\'s digit only opens the guide, and without the keyboard: keys typed on for the prompt never write', async () => {
  const { w, fx, game, advance, actions } = world()
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await advance(30 * 60_000, () => offered(w.state))
  assert.ok(offered(w.state))
  await advance(AUTO_CALM_MS)
  // 1 on the terminal band answers 'how': the guide, beside the prompt, keyboard untouched
  await actions().autoUpdate('how')
  assert.deepEqual(w.state.pane.stack.at(-1), { kind: 'auto-update' })
  assert.deepEqual(w.keys, [false])
  assert.deepEqual(w.writes, [])
  assert.equal(offered(w.state), false)
  clean(w)
  await game.end(fx)
})

it('Done shares the switch\'s pause: a second 1 just after Turn it on keeps the payoff on screen', async () => {
  const { w, fx, game, advance, actions } = world()
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await game.command(fx, 'updates')
  await advance(AUTO_CALM_MS)
  await actions().autoUpdate('on')
  assert.equal(w.state.account.autoUpdate, 'on')
  await actions().autoUpdate('done')
  assert.deepEqual(w.state.pane.stack.at(-1), { kind: 'auto-update' }, 'the payoff stays')
  await advance(AUTO_CALM_MS)
  await actions().autoUpdate('done')
  assert.notEqual(w.state.pane.stack.at(-1)?.kind, 'auto-update', 'later, Done leaves')
  clean(w)
  await game.end(fx)
})

it('a list unreadable for a moment keeps the record: on again, Turn it off is still offered', async () => {
  const { w, fx, game, advance, actions } = world()
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await game.command(fx, 'updates')
  await advance(AUTO_CALM_MS)
  await actions().autoUpdate('on')
  assert.equal(w.state.account.autoUpdateOurs, true)
  const whole = w.text
  // another session's truncating write, caught mid-way
  w.text = whole.slice(0, 30)
  await advance(WATCH_MS)
  assert.equal(w.state.account.autoUpdate, 'unknown')
  assert.deepEqual(w.store.get(KEYS.autoSwitch), { v: 1, on: true })
  w.text = whole
  await advance(WATCH_MS)
  assert.equal(w.state.account.autoUpdate, 'on')
  assert.equal(w.state.account.autoUpdateOurs, true)
  await advance(AUTO_CALM_MS)
  await actions().autoUpdate('off')
  assert.equal(w.writes.length, 2)
  assert.equal(JSON.parse(w.text).spinlings.autoUpdate, undefined)
  clean(w)
  await game.end(fx)
})

it('the payoff is the lead sparkling with where to turn it off, and it goes once the list says off', async () => {
  const { w, fx, game, advance, actions } = world()
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await game.command(fx, 'updates')
  await advance(AUTO_CALM_MS)
  await actions().autoUpdate('on')
  assert.deepEqual(w.state.moments.filter(m => m.kind === 'auto-on').map(m => m.id), ['auto-on'])
  assert.equal(w.state.moments.some(m => m.kind === 'line' && /Auto-update/.test(m.text)), false)
  await advance(AUTO_CALM_MS)
  await actions().autoUpdate('off')
  assert.equal(payoff(w), 0)
  clean(w)
  await game.end(fx)
})

it('a Turn it on cut short by a reload: its pending record makes the list\'s on ours, and an off list drops both records', async () => {
  const { w, fx, game, advance, actions } = world({ text: cc(list({ autoUpdate: true })) })
  // the session that pressed reloaded after its write landed, before it wrote the record itself
  w.store.set(KEYS.autoSwitchPending, { v: 1, on: true, pending: true })
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await game.command(fx, 'updates')
  await advance(AUTO_CALM_MS)
  assert.equal(w.state.account.autoUpdate, 'on')
  assert.equal(w.state.account.autoUpdateOurs, true, 'Turn it off is offered')
  await actions().autoUpdate('off')
  assert.equal(w.writes.length, 1)
  assert.equal(JSON.parse(w.text).spinlings.autoUpdate, undefined)
  assert.equal(w.store.has(KEYS.autoSwitch), false)
  assert.equal(w.store.has(KEYS.autoSwitchPending), false)
  // turned off elsewhere with both records left behind: the next look drops both
  w.store.set(KEYS.autoSwitch, { v: 1, on: true })
  w.store.set(KEYS.autoSwitchPending, { v: 1, on: true, pending: true })
  w.text = cc(list({ autoUpdate: false }))
  await advance(WATCH_MS)
  assert.equal(w.state.account.autoUpdate, 'off-chosen')
  assert.equal(w.store.has(KEYS.autoSwitch), false)
  assert.equal(w.store.has(KEYS.autoSwitchPending), false)
  clean(w)
  await game.end(fx)
})

it('a write that left the list unreadable for good: the guide names its folder, Copy folder copies just that path, and Copy command the command for where it runs', async () => {
  // every write is cut short, the put-back's too
  const { w, fx, game, advance, actions } = world({ write: text => text.slice(0, 20) })
  await game.boot(fx, { model: 'claude-opus-5-5' })
  await game.command(fx, 'updates')
  await advance(AUTO_CALM_MS)
  const pressing = actions().autoUpdate('on')
  await advance(60_000, () => w.state.pane.autoPress?.phase === 'done')
  await pressing
  assert.deepEqual(w.state.pane.autoPress, { phase: 'done', to: 'on', result: 'broken', folder: FOLDER })
  await actions().autoUpdate('copy-folder')
  assert.deepEqual(w.copied, [FOLDER])
  assert.equal(w.state.pane.message, 'Copied the folder.')
  // then the command that adds Spinlings back: /plugin's in Claude Code, and the shell's where /plugin cannot run
  await actions().autoUpdate('copy-add')
  assert.equal(w.copied.at(-1), '/plugin marketplace add 416rehman/spinlings')
  assert.equal(w.state.pane.message, 'Copied /plugin marketplace add 416rehman/spinlings. Paste it into Claude Code\'s prompt.')
  await actions().autoUpdate('copy-add-shell')
  assert.equal(w.copied.at(-1), 'claude plugin marketplace add 416rehman/spinlings')
  assert.equal(w.state.pane.message, 'Copied. Run it in a terminal.')
  assert.equal(w.store.has(KEYS.autoSwitch), false)
  assert.equal(w.store.has(KEYS.autoSwitchPending), false)
  clean(w)
  await game.end(fx)
})

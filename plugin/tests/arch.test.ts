// The mod's architecture, end to end through the engine: the zero-friction first run (SPEC 34), the offline world's
// silence (28), hooks that never stand in the way (2.3), commands that answer {} (9), and every band and pane state
// drawing without a refusal at 40, 80 and 120 columns on the terminal and the desktop (21).
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type {
  ListingView, MarketWant, MeResponse, Notice, OfferView, PlayerStats, PlayerView, ProfileResponse, RankingsResponse, SaleView,
} from '../hooks/core/api.ts'
import type { BattleCard, BattleLog, BattleSetup, Card, CardForm } from '../hooks/core/types.ts'
import type {
  SpinBattleCard, SpinBattleLog, SpinBattleSetup, SpinCard, SpinCardForm, SpinListing, SpinMarketWant, SpinMe, SpinNotice, SpinOffer,
  SpinPlayer, SpinPlayerStats, SpinProfile, SpinRankings, SpinSale,
} from '../types/index.d.ts'
import { CLIENT_VERSION } from '../hooks/client/remote.ts'
import { AFTER_NEXT, NEXT, NOW, ORIGIN, TOKEN, fakeServer } from './fixtures.ts'
import type { FakeServer } from './fixtures.ts'
import { cardArt } from './engine.ts'

// The contract restates core's shapes (a contract may not import); these fail to compile when the copies drift.
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Holds<T extends true> = T
export type ContractMatchesCore = [
  Holds<Same<SpinCard, Card>>, Holds<Same<SpinBattleCard, BattleCard>>, Holds<Same<SpinCardForm, CardForm>>,
  Holds<Same<SpinBattleSetup, BattleSetup>>, Holds<Same<SpinBattleLog, BattleLog>>, Holds<Same<SpinPlayer, PlayerView>>,
  Holds<Same<SpinNotice, Notice>>, Holds<Same<SpinOffer, OfferView>>, Holds<Same<SpinMe, MeResponse>>,
  Holds<Same<SpinPlayerStats, PlayerStats>>, Holds<Same<SpinListing, ListingView>>, Holds<Same<SpinMarketWant, MarketWant>>,
  Holds<Same<SpinSale, SaleView>>, Holds<Same<SpinRankings, RankingsResponse>>, Holds<Same<SpinProfile, ProfileResponse>>,
]

const PLUGIN = 'spinlings'
const SESSION = { cwd: '/work', surface: 'terminal', isInteractive: true } as const
const BAND = (columns: number) => ({
  plugin: PLUGIN, component: 'AbovePrompt', requestId: 'band',
  props: { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: columns, scroll: { offset: 0, bodyRows: 4 }, view: {} },
}) as const
const PANE = (columns: number) => ({
  plugin: PLUGIN, component: 'Pane', requestId: 'spinlings',
  props: { title: 'Spinlings', isFocused: true, bodyColumns: columns, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
}) as const
const RUN = (args: string) => ({ command: 'spin', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as never

type World = { store: Map<string, unknown>; server: FakeServer; status: (string | undefined)[]; logs: string[]; fetches: number; opened: number }

/** Plays Claude Code beneath the plugin: a store the test can read, the fake server, and the UI calls. */
function engine(on: On, server = fakeServer()): World {
  const w: World = { store: new Map(), server, status: [], logs: [], fetches: 0, opened: 0 }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'engine answer' }))
  on('turn.step', async function* (_$, e) {
    yield { kind: 'stop', stopReason: 'end_turn', usage: null } as never
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('session.compact', (_$, e) => ({ messages: e.messages }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => { w.store.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', (_$, e) => { w.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('http.fetch', (_$, e) => {
    w.fetches++
    try {
      return { value: server.handle(e.url, e.init) }
    } catch {
      return { deny: 'no network' }
    }
  })
  on('ui.status', (_$, e) => { w.status.push(e.text); return { value: undefined } })
  on('ui.log', (_$, e) => { if (e.to !== 'debug') w.logs.push(e.text); return { value: undefined } })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => { w.opened++; return { value: { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return w
}

async function settle(clock: { settle(): Promise<void> }, n = 6): Promise<void> {
  for (let i = 0; i < n; i++) await clock.settle()
}

test('first run: joins silently, keeps the session per origin, and welcomes with the pack', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  expect(w.store.get(`server:${ORIGIN}:session`)).toBe(TOKEN)
  const sent = w.server.calls.map(c => `${c.method} ${c.path}`)
  expect(sent.slice(0, 3)).toEqual(['GET /v1/version', 'GET /v1/challenge', 'POST /v1/join'])
  expect(w.server.calls.every(c => c.headers['x-spinlings-client'] === CLIENT_VERSION)).toBe(true)
  expect(w.status.at(-1)).toBe('spinlings · Online · 2 packs')

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const columns of [40, 80, 120]) {
      const band = await $.ui.mount({ ...BAND(columns), surface })
      expect(await band.find({ text: /A Spinling hatched!/ })).toBeDefined()
      expect(await band.find({ key: 'act-welcome' })).toBeDefined()
      await band.unmount()
    }
  }

  const band = await $.ui.mount({ ...BAND(80), surface: 'terminal' })
  await band.press({ key: 'act-welcome' })
  await settle(clock)
  expect(await band.find({ key: 'inline-pack-open' })).toBeDefined()
  expect(w.opened).toBe(0)
  expect(w.server.calls.some(c => c.path === '/v1/packs/open')).toBe(false)
  await band.press({ key: 'inline-pack-open' })
  await settle(clock)
  await band.press({ key: 'inline-pack-sidebar' })
  await settle(clock)
  await band.unmount()
  expect(w.opened).toBeGreaterThan(0)
  expect(w.server.calls.some(c => c.path === '/v1/packs/open' && c.body.includes('pack-welcome-1'))).toBe(true)

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const columns of [50, 80, 120]) {
      const pane = await $.ui.mount({ ...PANE(columns), surface })
      expect(await pane.find({ key: 'flip' })).toBeDefined()
      await pane.unmount()
    }
  }
  const pane = await $.ui.mount({ ...PANE(80), surface: 'terminal' })
  const count = w.server.calls.filter(c => c.path === '/v1/packs/open').length
  const cards = w.server.cards.filter(c => c.id.startsWith('pack-welcome-1-'))
  for (let i = 0; i < cards.length; i++) await pane.press({ key: 'flip' })
  expect(count).toBe(1)
  expect(cardArt(await pane.findAll({ type: 'Raster' })).length).toBe(cards.length)
  await pane.press({ key: 'done' })
  await settle(clock)
  await pane.unmount()

  const after = await $.ui.mount({ ...BAND(80), surface: 'terminal' })
  expect(await after.find({ text: /Creatures find you while Claude works/ })).toBeDefined()
  await after.unmount()
})

test('first run with no network plays offline instead, and says how to go online', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const server = fakeServer()
  server.down = true
  const w = engine(on, server)
  await $.session.start(SESSION)
  await settle(clock)
  expect((w.store.get('prefs') as { world: string }).world).toBe('offline')
  expect(w.status.at(-1)).toBe('spinlings · Offline · 2 packs')
  // the welcome itself says so: the payoff is never held back behind the line (SPEC 34.3, 34.4)
  const band = await $.ui.mount({ ...BAND(80), surface: 'terminal' })
  expect(await band.find({ text: /Playing offline · \/spin world online when you're connected/ })).toBeDefined()
  expect(await band.find({ text: /A Spinling hatched!/ })).toBeDefined()
  expect(await band.find({ key: 'act-welcome' })).toBeDefined()
  await band.unmount()
})

test('the offline world never sends a request', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  // offline from the start: the world a player chose with /spin world, as the store keeps it
  w.store.set('prefs', { world: 'offline' })
  await $.session.start(SESSION)
  await settle(clock)
  await clock.advance(5 * 60_000)
  await $.command.run(RUN('battle'))
  await $.command.run(RUN('trade quiet-otter-42'))
  await settle(clock)
  expect(w.fetches).toBe(0)
  expect((w.store.get('prefs') as { world: string }).world).toBe('offline')
})

test('upgrading from 0.1.0 with the world option on offline stays offline and sends nothing', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  // what 0.1.0 stored once its world option had applied: the option itself is gone, and nothing reads it now
  const old = { quiet: false, motion: true, sound: false, world: 'offline', worldOption: 'offline', server: ORIGIN, serverOption: ORIGIN, communityOk: [] }
  w.store.set('prefs', old)
  await $.session.start(SESSION)
  await settle(clock)
  expect(w.status.at(-1)).toMatch(/^spinlings · Offline/)
  await clock.advance(5 * 60_000)
  await $.command.run(RUN('battle'))
  await $.session.start(SESSION)
  await settle(clock)
  for (let i = 0; i < 5; i++) await clock.advance(60_000)
  await settle(clock)
  expect(w.fetches).toBe(0)
  expect(w.store.get('prefs')).toMatchObject({ world: 'offline', worldOption: 'offline', server: ORIGIN, serverOption: ORIGIN })
})

test('a fresh install plays online on spinlings.dev', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  expect(w.fetches).toBeGreaterThan(0)
  expect(w.server.calls[0]?.path).toBe('/v1/version')
  expect(w.store.get('prefs')).toMatchObject({ world: 'online', worldOption: null, server: null, serverOption: null })
  expect(w.store.get(`server:${ORIGIN}:session`)).toBe(TOKEN)
  expect(w.status.at(-1)).toBe('spinlings · Online · 2 packs')
})

test('hooks never stand in the way: results pass through untouched', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.turn.start({ text: 'secret prompt text', turnId: 't1' } as never)
  const done = await $.turn.complete({ turnId: 't1', answer: 'secret answer', durationMs: 1000, isAborted: false, reason: 'answer' } as never)
  expect(done).toEqual({ text: 'engine answer' })
  const messages = [{ role: 'user', text: 'secret', toolUses: [] }]
  const compact = await $.session.compact({ trigger: 'auto', messages } as never)
  expect(compact).toEqual({ messages })
})

test('commands answer {} and talk through the log, never the model', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  expect(await $.command.run(RUN('quiet on'))).toEqual({})
  expect(w.logs.at(-1)).toMatch(/quiet/)
  expect(w.status.at(-1)).toBeUndefined()
  expect(await $.command.run(RUN('quiet off'))).toEqual({})
  expect(await $.command.run(RUN('nonsense'))).toEqual({})
  expect(w.logs.at(-1)).toMatch(/There is no \/spin nonsense/)
  expect(await $.command.run(RUN('wild'))).toEqual({})
  expect(w.logs.at(-1)).toMatch(/There is no \/spin wild/)
  expect(await $.command.run(RUN('world'))).toEqual({})
  expect(w.logs.at(-1)).toBe('World: online on spinlings.dev')
})

test('a duel plays in the band, minis and all, then settles into a result', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('battle'))
  await settle(clock)
  expect(w.status.at(-1)).toBe('spinlings · vs Rival Thistlewick')
  await clock.advance(2000)
  await settle(clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const columns of [40, 80, 120]) {
      const band = await $.ui.mount({ ...BAND(columns), surface })
      expect(await band.find({ text: /Rival Thistlewick/ })).toBeDefined()
      if (surface === 'terminal' && columns >= 80) expect((await band.findAll({ type: 'Raster' })).length).toBe(2)
      if (surface === 'desktop' && columns >= 80) expect((await band.findAll({ type: 'Svg' })).length).toBe(2)
      await band.unmount()
    }
  }
  const finished = () => w.server.calls.some(c => c.path === '/v1/battles/battle-1/finish')
  for (let i = 0; i < 120 && !finished(); i++) await clock.advance(1000)
  await settle(clock)
  expect(finished()).toBe(true)
  const band = await $.ui.mount({ ...BAND(120), surface: 'terminal' })
  expect(await band.find({ text: /(Won vs|Lost to|Draw with) Rival Thistlewick · \+\d+ sparks/ })).toBeDefined()
  await band.unmount()
})

test('the card shows at full size and as tiles on both surfaces: starters, shiny foil, Mythic', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  const expectations: [string, RegExp[]][] = [
    ['starter-0', [/Common/, /Your starter/]],
    ['shiny-foil', [/Common · Shiny Foil/, /First Discovered/]],
    ['mythic-1', [/Mythic · Foil/, /Mythic · 1 of 1/, /Final form/]],
  ]
  for (const [id, texts] of expectations) {
    await $.command.run(RUN(`gift ${id}`))
    await settle(clock)
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const columns of [50, 80, 120]) {
        const pane = await $.ui.mount({ ...PANE(columns), surface })
        for (const text of texts) expect(await pane.find({ text })).toBeDefined()
        expect(cardArt(await pane.findAll({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).length).toBe(1)
        await pane.unmount()
      }
    }
  }
  const pane = await $.ui.mount({ ...PANE(120), surface: 'terminal' })
  await pane.press({ key: 'tab-cards' })
  expect(cardArt(await pane.findAll({ type: 'Raster' })).length).toBe(5)
  await pane.unmount()
  const desk = await $.ui.mount({ ...PANE(120), surface: 'desktop' })
  expect(cardArt(await desk.findAll({ type: 'Svg' })).length).toBe(5)
  await desk.unmount()
})

test('the first encounter is guaranteed 20 s into Claude\'s turn, and only while it runs', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  const starts = () => w.server.calls.filter(c => c.path === '/v1/battles')
  await $.turn.start({ text: 'x', turnId: 't1' } as never)
  await clock.advance(19_000)
  expect(starts().length).toBe(0)
  await clock.advance(1500)
  await settle(clock)
  expect(starts().length).toBe(1)
  expect(JSON.parse(starts()[0]!.body)).toEqual({ kind: 'wild', family: 'opus' })
})

test('presence charges a pack of the family used most, once per 50 minutes, and keeps the token out of the log', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1 } as never)
  let step: unknown
  for (;;) {
    const n = await stream.next()
    if (n.done) { step = n.value; break }
  }
  expect(step).toMatchObject({ turnId: 't1', stopReason: 'end_turn' })
  for (let m = 0; m < 49; m++) await clock.advance(60_000)
  expect(w.server.calls.some(c => c.path === '/v1/packs/charge')).toBe(false)
  await clock.advance(60_000)
  await settle(clock)
  const charges = w.server.calls.filter(c => c.path === '/v1/packs/charge')
  expect(charges.length).toBe(1)
  expect(JSON.parse(charges[0]!.body)).toEqual({ family: 'sonnet' })
  const log = w.store.get('privacy') as { path: string; body: string }[]
  expect(log.some(e => e.path === '/v1/packs/charge')).toBe(true)
  expect(JSON.stringify(log)).not.toContain(TOKEN)
  expect(JSON.stringify([...w.store.entries()].filter(([k]) => k !== `server:${ORIGIN}:session`))).not.toContain(TOKEN)
})

test('each world keeps its own collection: switching sends nothing offline and resumes the session online', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('world offline'))
  await settle(clock)
  expect(w.status.at(-1)).toBe('spinlings · Offline · 2 packs')
  const before = w.fetches
  await clock.advance(10 * 60_000)
  await $.command.run(RUN('battle'))
  await settle(clock)
  expect(w.fetches).toBe(before)
  expect(w.store.get(`server:${ORIGIN}:session`)).toBe(TOKEN)
  await $.command.run(RUN('world online'))
  await settle(clock)
  expect(w.server.calls.filter(c => c.path === '/v1/join').length).toBe(1)
  expect(w.server.calls.at(-1)?.path).not.toBe('/v1/join')
  expect(w.status.at(-1)).toBe('spinlings · Online · 2 packs')
})

test('a newer mod is announced once per version', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on, fakeServer({ latestClient: NEXT }))
  await $.session.start(SESSION)
  await settle(clock)
  expect((w.store.get('prefs') as { updateSeen: string }).updateSeen).toBe(NEXT)
  await $.command.run(RUN('battle'))
  await settle(clock)
  expect(w.server.calls.some(c => c.path === '/v1/battles')).toBe(true)
})

test('below minClient: no join on a first run (offline instead), and an existing account is read-only', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on, fakeServer({ latestClient: AFTER_NEXT, minClient: NEXT }))
  await $.session.start(SESSION)
  await settle(clock)
  expect(w.server.calls.some(c => c.path === '/v1/join')).toBe(false)
  expect((w.store.get('prefs') as { world: string }).world).toBe('offline')
  w.store.set('prefs', { ...(w.store.get('prefs') as object), world: 'online' })
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('battle'))
  await settle(clock)
  expect(w.server.calls.some(c => c.path === '/v1/me')).toBe(true)
  expect(w.server.calls.some(c => c.path === '/v1/battles')).toBe(false)
})

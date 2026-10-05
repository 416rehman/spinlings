// Canonical world choices, visible community consent, separate saves and cancelled asynchronous choices.
import { expect, mock, test } from 'claude-code/testing'
import { INITIAL, createGame } from '../hooks/client/game.ts'
import { createLocalBackend } from '../hooks/client/local/index.ts'
import type { Actions, El, Fx, GameState } from '../hooks/client/types.ts'
import { band as drawBand } from '../hooks/ui/band.tsx'
import { NOW, ORIGIN, TOKEN, fakeServer } from './fixtures.ts'
import { PANE, BAND, RUN, SESSION, engine, settle, textOf, measure } from './engine.ts'

const COMMUNITY = 'https://cats.example'
const COMMUNITY_TOKEN = 'tok_' + 'c'.repeat(40)

function servers() {
  const normal = fakeServer(), community = fakeServer()
  community.cards = community.cards.map(c => ({ ...c, id: `community-${c.id}` }))
  community.me = { ...community.me, player: { ...community.me.player, handle: 'mossy-badger-9', team: community.me.player.team.map(id => `community-${id}`) } }
  const handle = (url: string, init: Parameters<typeof normal.handle>[1] = {}) => {
    const at = new URL(url)
    if (at.origin === ORIGIN) return normal.handle(url, init)
    if (at.origin !== COMMUNITY) throw new Error('unexpected origin')
    const authorization = init.headers?.authorization
    if (authorization && authorization !== `Bearer ${COMMUNITY_TOKEN}`) throw new Error('wrong origin session')
    const answer = community.handle(ORIGIN + at.pathname + at.search, { ...init, headers: { ...init.headers, ...(authorization ? { authorization: `Bearer ${TOKEN}` } : {}) } })
    if (at.pathname === '/v1/join') return { ...answer, text: JSON.stringify({ ...JSON.parse(answer.text), token: COMMUNITY_TOKEN }) }
    return answer
  }
  return { normal, community, handle }
}

test('world opens a narrow chooser; reviewing, cancelling and going Back ask no proposed server', { timeoutMs: 90_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), both = servers()
  const w = engine(on, { ...both.normal, handle: both.handle })
  w.store.set('prefs', { world: 'offline' })
  await $.session.start(SESSION)
  await settle(clock)
  const saved = JSON.stringify(w.store.get('offline:v1'))
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run(RUN('world'))
    await settle(clock)
    const ui = await $.ui.mount(PANE(24, surface))
    const prefs = JSON.stringify(w.store.get('prefs'))
    expect(await ui.find({ key: 'world-online' })).toBeDefined()
    expect(await ui.find({ key: 'world-address' })).toBeDefined()
    expect(textOf(await ui.drawn())).toContain('Each world keeps its own collection')
    if (surface === 'terminal') {
      const issues: string[] = []
      measure(await ui.drawn(), 24, issues)
      expect(issues).toEqual([])
    }
    await ui.input({ key: 'world-address', text: 'http://outside.example' })
    await settle(clock); await ui.redraw()
    expect(textOf(await ui.drawn())).toContain('Use an https address')
    expect(w.requests).toEqual([])
    for (const cancel of ['world-cancel', 'pane-back']) {
      await ui.input({ key: 'world-address', text: `${COMMUNITY}/play` })
      await settle(clock); await ui.redraw()
      expect((await ui.find({ key: 'world-connect' }))?.props.label).toBe('Connect')
      expect(textOf(await ui.drawn())).toContain('Run by someone else')
      expect(w.requests).toEqual([])
      const reviewing = await $.ui.mount(BAND(24, surface))
      expect(await reviewing.find({ key: `act-server:${COMMUNITY}` })).toBeUndefined()
      expect(await reviewing.find({ key: `dismiss-server:${COMMUNITY}` })).toBeUndefined()
      await reviewing.unmount()
      await ui.press({ key: cancel })
      await settle(clock); await ui.redraw()
      const band = await $.ui.mount(BAND(24, surface))
      expect(await band.find({ key: `act-server:${COMMUNITY}` })).toBeUndefined()
      await band.unmount()
      expect(w.requests).toEqual([])
      expect(JSON.stringify(w.store.get('prefs'))).toBe(prefs)
      if (cancel === 'pane-back') {
        await $.command.run(RUN('world')); await settle(clock); await ui.redraw()
      }
    }
    expect(JSON.stringify(w.store.get('offline:v1'))).toBe(saved)
    await ui.unmount()
  }
})

test('chooser Connect enters the chosen community, online always returns default, and every collection stays at its origin', { timeoutMs: 90_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), both = servers()
  const w = engine(on, { ...both.normal, handle: both.handle })
  w.store.set('prefs', { world: 'offline' })
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  await $.session.start(SESSION); await settle(clock)
  const saved = JSON.stringify(w.store.get('offline:v1'))
  await $.command.run(RUN('world')); await settle(clock)
  const ui = await $.ui.mount(PANE(24, 'desktop'))
  await ui.input({ key: 'world-address', text: COMMUNITY }); await settle(clock); await ui.redraw()
  expect(w.requests).toEqual([])
  await ui.press({ key: 'world-connect' }); await settle(clock); await ui.redraw()
  expect(w.requests[0]?.url).toBe(`${COMMUNITY}/v1/version`)
  expect(w.store.get('prefs')).toMatchObject({ world: 'online', server: COMMUNITY, communityOk: [COMMUNITY] })
  expect(w.store.get(`server:${COMMUNITY}:cache`)).toMatchObject({ me: { player: { handle: both.community.me.player.handle } }, cards: { cards: both.community.cards } })
  const communityCache = JSON.stringify(w.store.get(`server:${COMMUNITY}:cache`))
  await $.command.run(RUN('world online')); await settle(clock)
  expect(w.store.get('prefs')).toMatchObject({ world: 'online', server: ORIGIN })
  expect(w.store.get(`server:${ORIGIN}:cache`)).toMatchObject({ me: { player: { handle: both.normal.me.player.handle } }, cards: { cards: both.normal.cards } })
  await $.command.run(RUN('world offline')); await settle(clock)
  const mark = w.requests.length
  await $.command.run(RUN('world online')); await settle(clock)
  expect(w.requests.slice(mark).every(r => r.url.startsWith(`${ORIGIN}/v1/`))).toBe(true)
  expect(w.store.get('prefs')).toMatchObject({ world: 'online', server: ORIGIN })
  // Approved URL commands resume their own account; the released alias is still interchangeable.
  await $.command.run(RUN(`world ${COMMUNITY}`)); await settle(clock)
  expect(JSON.stringify(w.store.get(`server:${COMMUNITY}:cache`))).toBe(communityCache)
  await $.command.run(RUN('server default')); await settle(clock)
  expect(w.store.get('prefs')).toMatchObject({ world: 'online', server: ORIGIN })
  expect(w.store.get(`server:${ORIGIN}:session`)).toBe(TOKEN)
  expect(w.store.get(`server:${COMMUNITY}:session`)).toBe(COMMUNITY_TOKEN)
  expect(w.requests.filter(r => r.url.endsWith('/v1/join'))).toHaveLength(1)
  expect(JSON.stringify(w.store.get('offline:v1'))).toBe(saved)
  await ui.unmount()
})

test('a world URL command waits for consent; Cancel sends nothing and the released server alias still connects', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), both = servers()
  const w = engine(on, { ...both.normal, handle: both.handle })
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  await $.session.start(SESSION); await settle(clock)
  const mark = w.requests.length, prefs = JSON.stringify(w.store.get('prefs'))
  await $.command.run(RUN(`world ${COMMUNITY}/play`)); await settle(clock)
  expect(w.requests.slice(mark)).toEqual([])
  const band = await $.ui.mount(BAND(24))
  expect((await band.find({ key: `act-server:${COMMUNITY}` }))?.props.label).toBe('Connect')
  await band.press({ key: `dismiss-server:${COMMUNITY}` }); await settle(clock)
  expect(w.requests.slice(mark)).toEqual([])
  expect(JSON.stringify(w.store.get('prefs'))).toBe(prefs)
  await $.command.run(RUN(`server ${COMMUNITY}`)); await settle(clock); await band.redraw()
  await band.press({ key: `act-server:${COMMUNITY}` }); await settle(clock)
  expect(w.store.get('prefs')).toMatchObject({ world: 'online', server: COMMUNITY })
  await band.unmount()
})

function lifecycle(boundary: 'prefs' | 'account-update' | 'account-ack' | 'committed-prefs' | 'retry' | 'response') {
  const both = servers(), state = JSON.parse(JSON.stringify(INITIAL)) as GameState
  Object.assign(state, { account: { ...state.account, link: 'ready' }, me: both.normal.me, cards: both.normal.cards })
  state.pane.stack = [{ kind: 'world', origin: COMMUNITY, address: COMMUNITY }]
  state.moments = [{ kind: 'server', id: `server:${COMMUNITY}`, origin: COMMUNITY, until: null }]
  const store = new Map<string, unknown>([['prefs', { world: 'online', server: ORIGIN }], [`server:${ORIGIN}:session`, TOKEN], [`server:${COMMUNITY}:session`, COMMUNITY_TOKEN]])
  let released!: () => void, reached!: () => void, paused = false
  let repeated = false
  const waiting = new Promise<void>(resolve => { reached = resolve })
  const release = new Promise<void>(resolve => { released = resolve })
  const pause = async () => { if (!paused) { paused = true; reached(); await release } }
  const requests: string[] = []
  const fx: Fx = {
    now: async () => NOW, random: () => .5, after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }),
    store: {
      get: async key => { const value = store.get(key); if (key === 'prefs' && (boundary === 'prefs' || boundary === 'committed-prefs' && state.account.server === COMMUNITY)) await pause(); return value },
      set: async (key, value) => { store.set(key, value) }, delete: async key => { store.delete(key) }, keys: async () => [...store.keys()],
    },
    state: { get: async key => state[key], update: async (key, fn) => {
      if (boundary === 'account-update' && key === 'account') await pause()
      if (boundary === 'retry' && key === 'account' && !repeated) { repeated = true; fn(state[key]) }
      const value = fn(state[key]); Object.assign(state, { [key]: value })
      if (boundary === 'account-ack' && key === 'account') await pause()
      return value
    } },
    fetch: async (url, init) => { requests.push(url); const answer = both.handle(url, init); if (boundary === 'response' && url === `${COMMUNITY}/v1/me`) await pause(); return answer },
    ui: { toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => false, openPane: async () => true, closePane: async () => undefined, blit: async () => false, sound: () => undefined },
  }
  const game = createGame({ slots: { local: createLocalBackend, battle: async () => undefined, reveal: async () => undefined, moments: null } })
  return { game, fx, state, store, requests, waiting, release: () => released(), repeated: () => repeated, normal: both.normal, community: both.community }
}

test('cancelled and stale chooser callbacks cannot switch worlds during preparation or overwrite a later offline selection', { timeoutMs: 60_000 }, async () => {
  for (const boundary of ['prefs', 'account-update'] as const) for (const cancel of ['cancel', 'back', 'tab'] as const) {
    const p = lifecycle(boundary), a = p.game.actions(p.fx)
    const collection = JSON.stringify({ me: p.state.me, cards: p.state.cards })
    const sessions = JSON.stringify([...p.store.entries()])
    const selecting = a.connect(COMMUNITY, { world: 'online', server: ORIGIN, origin: COMMUNITY })
    await p.waiting
    expect(p.state.moments.some(m => m.kind === 'server' && m.origin === COMMUNITY)).toBe(true)
    if (cancel === 'cancel') {
      // The originally rendered Cancel callback remains effective until the account transition is accepted.
      await a.dismiss(`server:${COMMUNITY}`)
      await a.pane(pane => ({ ...pane, stack: pane.stack.map(v => v.kind === 'world' && v.origin === COMMUNITY ? { kind: 'world', address: COMMUNITY } : v) }))
    }
    else if (cancel === 'back') await a.back()
    else await a.tab('cards')
    p.release(); await selecting
    expect(p.requests).toEqual([])
    expect(p.state.account).toMatchObject({ world: 'online', server: ORIGIN, link: 'ready' })
    expect(p.store.get('prefs')).toEqual({ world: 'online', server: ORIGIN })
    expect(JSON.stringify({ me: p.state.me, cards: p.state.cards })).toBe(collection)
    expect(JSON.stringify([...p.store.entries()])).toBe(sessions)
    const saved = JSON.stringify(p.state)
    await a.connect(COMMUNITY, { world: 'online', server: ORIGIN, origin: COMMUNITY })
    expect(p.requests).toEqual([])
    expect(JSON.stringify(p.state)).toBe(saved)
  }
  for (const boundary of ['account-update', 'response'] as const) {
    const p = lifecycle(boundary), a = p.game.actions(p.fx)
    const selecting = a.connect(COMMUNITY, { world: 'online', server: ORIGIN, origin: COMMUNITY })
    await p.waiting
    await a.world('offline')
    const cards = p.state.cards.map(c => c.id), me = JSON.stringify(p.state.me), save = JSON.stringify(p.store.get('offline:v1'))
    const prefs = JSON.stringify(p.store.get('prefs')), mark = p.requests.length
    p.release(); await selecting
    expect(p.state.account).toMatchObject({ world: 'offline', link: 'ready' })
    expect(p.state.cards.map(c => c.id)).toEqual(cards)
    expect(JSON.stringify(p.state.me)).toBe(me)
    expect(JSON.stringify(p.store.get('offline:v1'))).toBe(save)
    expect(JSON.stringify(p.store.get('prefs'))).toBe(prefs)
    expect(p.requests.slice(mark)).toEqual([])
  }
})

test('a cancelled pre-write world transition leaves an already awarded pack request alive in its original world', { timeoutMs: 60_000 }, async () => {
  for (const cancel of ['cancel', 'back', 'tab'] as const) {
    const p = lifecycle('account-update'), a = p.game.actions(p.fx)
    let arrived!: () => void, delivered!: () => void
    const arrival = new Promise<void>(resolve => { arrived = resolve })
    const delivery = new Promise<void>(resolve => { delivered = resolve })
    const fetch = p.fx.fetch
    p.fx.fetch = async (url, init) => {
      const answer = await fetch(url, init)
      if (url === `${ORIGIN}/v1/packs/open`) { arrived(); await delivery }
      return answer
    }
    const opening = a.openPack('pack-welcome-1')
    await arrival
    const selecting = a.connect(COMMUNITY, { world: 'online', server: ORIGIN, origin: COMMUNITY })
    await p.waiting
    if (cancel === 'cancel') await a.dismiss(`server:${COMMUNITY}`)
    else if (cancel === 'back') await a.back()
    else await a.tab('cards')
    p.release(); await selecting
    delivered(); await opening
    expect(p.state.account).toMatchObject({ world: 'online', server: ORIGIN, link: 'ready' })
    expect(p.state.reveal?.cards).toHaveLength(1)
    expect(p.state.cards.some(c => c.id === p.state.reveal!.cards[0]!.id)).toBe(true)
    expect(p.state.me!.packs.some(pack => pack.id === 'pack-welcome-1')).toBe(false)
    expect(p.requests.filter(url => url === `${ORIGIN}/v1/packs/open`)).toHaveLength(1)
    expect(p.requests.some(url => url.startsWith(COMMUNITY))).toBe(false)
  }
})

test('the accepted account updater can retry without invalidating its own world transition', { timeoutMs: 30_000 }, async () => {
  const p = lifecycle('retry')
  await p.game.actions(p.fx).connect(COMMUNITY, { world: 'online', server: ORIGIN, origin: COMMUNITY })
  expect(p.repeated()).toBe(true)
  expect(p.state.account).toMatchObject({ world: 'online', server: COMMUNITY, link: 'ready' })
  expect(p.store.get('prefs')).toMatchObject({ world: 'online', server: COMMUNITY, communityOk: [COMMUNITY] })
  expect(p.state.cards.every(c => c.id.startsWith('community-'))).toBe(true)
  expect(p.requests.filter(url => url === `${COMMUNITY}/v1/me`)).toHaveLength(1)
})

test('Back or retained Cancel after an accepted write cannot interrupt its pending acknowledgement or saved collection', { timeoutMs: 60_000 }, async ($, on) => {
  let shown: { state: GameState; actions: Actions } | null = null
  on('ui.render', { component: 'AbovePrompt', requestId: 'world-review-probe' }, async ($, e) => shown ? drawBand({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.maxRows,
    now: NOW, actions: shown.actions, isWorking: e.props.isWorking, state: shown.state,
  }) : null)
  for (const boundary of ['account-ack', 'committed-prefs'] as const) for (const later of ['back', 'cancel', 'unrelated-cancel', 'review', 'review-cancel'] as const) {
    const p = lifecycle(boundary), a = p.game.actions(p.fx)
    const other = 'https://other.example'
    p.state.moments.push({ kind: 'server', id: `server:${other}`, origin: other, until: null })
    const selecting = a.connect(COMMUNITY, { world: 'online', server: ORIGIN, origin: COMMUNITY })
    await p.waiting
    expect(p.state.account).toMatchObject({ world: 'online', server: COMMUNITY })
    expect(p.requests).toEqual([])
    if (later === 'back') await a.back()
    else if (later === 'cancel') await a.dismiss(`server:${COMMUNITY}`)
    else if (later === 'unrelated-cancel') await a.dismiss(`server:${other}`)
    else {
      await a.world(other)
      if (later === 'review-cancel') await a.dismiss(`server:${other}`)
    }
    p.release(); await selecting
    expect(p.state.account).toMatchObject({ world: 'online', server: COMMUNITY, link: 'ready' })
    expect(p.store.get('prefs')).toMatchObject({ world: 'online', server: COMMUNITY, communityOk: [COMMUNITY] })
    expect(p.state.cards.every(c => c.id.startsWith('community-'))).toBe(true)
    expect(p.state.me!.player.handle).toBe('mossy-badger-9')
    expect(p.store.get(`server:${ORIGIN}:session`)).toBe(TOKEN)
    expect(p.store.get(`server:${COMMUNITY}:session`)).toBe(COMMUNITY_TOKEN)
    expect(p.requests.every(url => url.startsWith(COMMUNITY))).toBe(true)
    expect(p.state.moments.some(m => m.kind === 'server' && m.origin === other)).toBe(later === 'review')
    if (later === 'review') {
      // A newer unconfirmed review remains usable after the accepted transition's cleanup.
      shown = { state: p.state, actions: a }
      const band = await $.ui.mount({ ...BAND(40), requestId: 'world-review-probe' })
      expect((await band.find({ key: `act-server:${other}`, plugin: 'test' }))?.props.label).toBe('Connect')
      expect(p.requests.some(url => url.startsWith(other))).toBe(false)
      await band.unmount()
    }
  }
})

test('a later accepted connection on the same origin keeps its new account generation over delayed earlier cleanup', { timeoutMs: 30_000 }, async () => {
  const p = lifecycle('committed-prefs'), a = p.game.actions(p.fx)
  const first = a.connect(COMMUNITY, { world: 'online', server: ORIGIN, origin: COMMUNITY })
  await p.waiting
  p.community.cards = p.community.cards.map(c => ({ ...c, id: `replacement-${c.id}` }))
  p.community.me = { ...p.community.me, player: { ...p.community.me.player, handle: 'fresh-fox-8', team: p.community.me.player.team.map(id => `replacement-${id}`) } }
  await a.connect(COMMUNITY)
  const saved = JSON.stringify({ account: p.state.account, me: p.state.me, cards: p.state.cards, pane: p.state.pane, prefs: p.store.get('prefs') })
  const mark = p.requests.length
  expect(p.state.me!.player.handle).toBe('fresh-fox-8')
  expect(p.state.cards.every(c => c.id.startsWith('replacement-'))).toBe(true)
  p.release(); await first
  expect(JSON.stringify({ account: p.state.account, me: p.state.me, cards: p.state.cards, pane: p.state.pane, prefs: p.store.get('prefs') })).toBe(saved)
  expect(p.requests.slice(mark)).toEqual([])
})

test('an old tab acknowledgement cannot cancel a replacement chooser that begins after its pane write', { timeoutMs: 30_000 }, async () => {
  const p = lifecycle('prefs'), a = p.game.actions(p.fx)
  const first = a.connect(COMMUNITY, { world: 'online', server: ORIGIN, origin: COMMUNITY })
  await p.waiting
  let tabArrived!: () => void, tabRelease!: () => void, accountArrived!: () => void, accountRelease!: () => void
  const tabWritten = new Promise<void>(resolve => { tabArrived = resolve })
  const tabAck = new Promise<void>(resolve => { tabRelease = resolve })
  const accountWaiting = new Promise<void>(resolve => { accountArrived = resolve })
  const accountWrite = new Promise<void>(resolve => { accountRelease = resolve })
  const update = p.fx.state.update
  let heldTab = false, heldAccount = false
  p.fx.state.update = async (key, fn) => {
    if (key === 'account' && !heldAccount) { heldAccount = true; accountArrived(); await accountWrite }
    const value = await update(key, fn)
    if (key === 'pane' && !heldTab && p.state.pane.stack.length === 0) { heldTab = true; tabArrived(); await tabAck }
    return value
  }
  const leaving = a.tab('cards')
  await tabWritten
  await a.push({ kind: 'world', origin: COMMUNITY, address: COMMUNITY })
  const replacement = a.connect(COMMUNITY, { world: 'online', server: ORIGIN, origin: COMMUNITY })
  await accountWaiting
  tabRelease(); await leaving
  accountRelease(); await replacement
  p.release(); await first
  expect(p.state.account).toMatchObject({ world: 'online', server: COMMUNITY, link: 'ready' })
  expect(p.store.get('prefs')).toMatchObject({ world: 'online', server: COMMUNITY, communityOk: [COMMUNITY] })
  expect(p.state.cards.every(c => c.id.startsWith('community-'))).toBe(true)
  expect(p.requests.filter(url => url === `${COMMUNITY}/v1/me`)).toHaveLength(1)

  // The inverse: a choice begins while an earlier tab's actual write is still held.
  const q = lifecycle('account-update'), next = q.game.actions(q.fx)
  let paneArrived!: () => void, paneRelease!: () => void
  const paneWaiting = new Promise<void>(resolve => { paneArrived = resolve })
  const paneWrite = new Promise<void>(resolve => { paneRelease = resolve })
  const qUpdate = q.fx.state.update
  let heldPane = false
  q.fx.state.update = async (key, fn) => {
    if (key === 'pane' && !heldPane) { heldPane = true; paneArrived(); await paneWrite }
    return qUpdate(key, fn)
  }
  const tab = next.tab('cards')
  await paneWaiting
  const orphan = next.connect(COMMUNITY, { world: 'online', server: ORIGIN, origin: COMMUNITY })
  await q.waiting
  paneRelease(); await tab
  q.release(); await orphan
  expect(q.requests).toEqual([])
  expect(q.state.account).toMatchObject({ world: 'online', server: ORIGIN, link: 'ready' })
  expect(q.store.get('prefs')).toEqual({ world: 'online', server: ORIGIN })
})

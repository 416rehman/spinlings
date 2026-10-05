// Inline pack previews award nothing until Open; sidebar and Close keep the same authoritative collection.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { INITIAL, createGame } from '../hooks/client/game.ts'
import type { Actions, El, Fx, GameState } from '../hooks/client/types.ts'
import { createLocalBackend } from '../hooks/client/local/index.ts'
import { demoSteps } from '../hooks/client/demo.ts'
import { band } from '../hooks/ui/band.tsx'
import { BAND, PANE, RUN, SESSION, engine, settle } from './engine.ts'
import { NOW, ORIGIN, TOKEN, fakeServer } from './fixtures.ts'

function probe(on: On) {
  const p = { state: JSON.parse(JSON.stringify(INITIAL)) as GameState, version: 0 }
  on('state.get', (_$, e) => ({ value: { value: p.state[e.key as keyof GameState], version: p.version } }))
  on('state.set', (_$, e) => {
    Object.assign(p.state, { [e.key]: e.value })
    return { value: { isSet: true, version: ++p.version } }
  })
  return p
}

test('closing a sealed inline preview keeps the pack; reopening and closing an opened pack keeps every card', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), w = engine(on), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  const cards = p.state.cards.map(c => c.id), packs = p.state.me!.packs.map(p => p.id)
  const ui = await $.ui.mount(BAND(40, 'desktop'))
  await ui.press({ key: 'act-welcome' })
  await settle(clock)
  await ui.redraw()
  const first = p.state.reveal!.id
  expect(p.state.reveal).toMatchObject({ inline: true, packId: packs[0], cards: [] })
  expect(w.opened).toBe(0)
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toEqual([])
  await ui.press({ key: 'inline-pack-close' })
  await settle(clock)
  await ui.redraw()
  expect(p.state.reveal).toBeNull()
  expect(p.state.me!.packs.map(p => p.id)).toEqual(packs)
  expect(p.state.cards.map(c => c.id)).toEqual(cards)
  await $.command.run(RUN('pack'))
  await settle(clock)
  await ui.redraw()
  expect(p.state.reveal!.id).not.toBe(first)
  await ui.press({ key: 'inline-pack-open' })
  await settle(clock)
  await ui.redraw()
  const opened = p.state.reveal!
  expect(opened.inline).toBe(true)
  expect(opened.packId).toBeUndefined()
  expect(opened.cards.length).toBeGreaterThan(0)
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toHaveLength(1)
  await ui.press({ key: 'inline-pack-close' })
  await settle(clock)
  expect(p.state.reveal).toBeNull()
  expect(p.state.me!.packs.map(p => p.id)).toEqual(packs.slice(1))
  expect(opened.cards.every(c => p.state.cards.some(k => k.id === c.id))).toBe(true)
  expect(w.opened).toBe(0)
  await ui.unmount()
})

test('an empty /spin pack invocation opens Team with its message and next-pack meter without consuming anything', { timeoutMs: 60_000 }, async ($, on) => {
  const server = fakeServer()
  server.me = { ...server.me, packs: [] }
  const clock = mock.clock(on, { now: NOW }), w = engine(on, server), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  const cards = p.state.cards.map(c => c.id)
  p.state.pane = { ...p.state.pane, tab: 'cards', stack: [{ kind: 'card', cardId: cards[0]! }] }
  await $.command.run(RUN('pack'))
  await settle(clock)
  expect(w.opened).toBe(1)
  expect(p.state.pane).toMatchObject({ tab: 'team', stack: [], message: 'No packs waiting. The next one charges while you work.' })
  expect(p.state.reveal).toBeNull()
  expect(p.state.me!.packs).toEqual([])
  expect(p.state.cards.map(c => c.id)).toEqual(cards)
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toEqual([])
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount(PANE(24, surface))
    expect(await pane.find({ text: 'No packs waiting. The next one charges while you work.' })).toBeDefined()
    expect(await pane.find({ key: 'pack-meter' })).toBeDefined()
    expect(await pane.find({ key: 'open-pack' })).toBeUndefined()
    await pane.unmount()
  }
})

test('Sidebar transfers a sealed preview and its opening without a second pack request', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), w = engine(on), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('pack'))
  await settle(clock)
  const id = p.state.reveal!.id, packId = p.state.reveal!.packId
  const ui = await $.ui.mount(BAND(80, 'terminal'))
  await ui.press({ key: 'inline-pack-sidebar' })
  await settle(clock)
  await ui.redraw()
  expect(p.state.reveal).toMatchObject({ id, packId, inline: false })
  expect(w.opened).toBe(1)
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toEqual([])
  const pane = await $.ui.mount(PANE(40, 'terminal'))
  expect((await pane.find({ key: 'done' }))?.props.label).toBe('Close')
  await pane.press({ key: 'flip' })
  await settle(clock)
  await pane.redraw()
  expect(p.state.reveal!.inline).not.toBe(true)
  expect(p.state.reveal!.packId).toBeUndefined()
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toHaveLength(1)
  await pane.press({ key: 'flip' })
  await settle(clock)
  await pane.redraw()
  const revealed = p.state.pane.flipped
  expect(revealed).toBe(1)
  await $.command.run(RUN('pack'))
  await settle(clock)
  await ui.redraw()
  expect(p.state.reveal!.inline).toBe(true)
  expect(p.state.pane.flipped).toBe(revealed)
  await ui.press({ key: 'inline-pack-sidebar' })
  await settle(clock)
  expect(p.state.pane.flipped).toBe(revealed)
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toHaveLength(1)
  await pane.unmount()
  await ui.unmount()
})

test('a supported older server returning five cards reveals all five inline before the same summary handoff', { timeoutMs: 60_000 }, async ($, on) => {
  const server = fakeServer(), handle = server.handle.bind(server)
  server.handle = (url, init) => {
    const answer = handle(url, init)
    if (url.endsWith('/v1/packs/open') && answer.ok) {
      const parsed = JSON.parse(answer.text), first = parsed.cards[0]
      parsed.cards = Array.from({ length: 5 }, (_, i) => ({ ...first, id: i ? `legacy-pack-${i}` : first.id }))
      server.cards.push(...parsed.cards.slice(1))
      return { ...answer, text: JSON.stringify(parsed) }
    }
    return answer
  }
  const clock = mock.clock(on, { now: NOW }), w = engine(on, server), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('pack'))
  await settle(clock)
  const ui = await $.ui.mount(BAND(40, 'desktop'))
  await ui.press({ key: 'inline-pack-open' })
  await settle(clock)
  await ui.redraw()
  expect(p.state.reveal!.cards).toHaveLength(5)
  for (let i = 0; i < 5; i++) {
    await ui.press({ key: 'inline-pack-open' })
    await settle(clock)
    await ui.redraw()
    expect(p.state.pane.flipped).toBe(i + 1)
  }
  expect(await ui.find({ text: /5 cards added to Collection/ })).toBeDefined()
  expect(await ui.find({ key: 'inline-pack-open' })).toBeUndefined()
  const ids = p.state.reveal!.cards.map(c => c.id), id = p.state.reveal!.id
  await ui.press({ key: 'inline-pack-sidebar' })
  await settle(clock)
  expect(p.state.reveal!.id).toBe(id)
  expect(p.state.reveal!.cards.map(c => c.id)).toEqual(ids)
  expect(p.state.pane.flipped).toBe(5)
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toHaveLength(1)
  expect(ids.every(id => p.state.cards.some(c => c.id === id))).toBe(true)
  await ui.unmount()
})

test('inline controls stay reachable in short windows and quiet still suppresses the band', { timeoutMs: 30_000 }, async ($, on) => {
  const state = { ...INITIAL, reveal: { id: 'preview-short', kind: 'pack' as const, packId: 'pack-1', inline: true,
    family: 'opus' as const, cards: [], packs: [], fresh: [], album: { before: 0, after: 0, total: 36 } } }
  const actions = new Proxy({}, { get: () => () => Promise.resolve() }) as Actions
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => band({ el: $.ui.resolve(e) as unknown as El,
    surface: e.surface, columns: e.props.bodyColumns, rows: e.props.maxRows, now: NOW, isWorking: false, state, actions,
  }) ?? { type: 'Text', props: {}, children: ['engine band'] })
  for (const rows of [1, 2, 3, 4]) {
    const ui = await $.ui.mount(BAND(40, 'terminal', rows))
    const controls = await ui.findAll({ type: 'Button' })
    expect(controls.map(n => n.key)).toEqual(['inline-pack-open', 'inline-pack-close', 'inline-pack-sidebar'])
    expect(controls.map(n => n.props.hotkey)).toEqual(['1', '2', '3'])
    await ui.unmount()
  }
  state.prefs = { ...state.prefs, quiet: true }
  const quiet = await $.ui.mount(BAND(40, 'terminal'))
  expect(await quiet.findAll({ type: 'Button' })).toEqual([])
  await quiet.unmount()
})

test('a battle or catch choice keeps its controls when it starts after an inline preview', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), w = engine(on), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('pack'))
  await settle(clock)
  const preview = p.state.reveal!.id, ui = await $.ui.mount(BAND(40, 'desktop'))
  expect(await ui.find({ key: 'inline-pack-open' })).toBeDefined()
  const fight = JSON.parse(JSON.stringify(demoSteps(NOW).find(s => s.title.includes('the special is ready:'))!.state)) as GameState
  p.state.battle = fight.battle
  await ui.redraw()
  expect(await ui.find({ key: 'now' })).toBeDefined()
  expect(await ui.find({ key: 'inline-pack-open' })).toBeUndefined()
  await ui.press({ key: 'now' })
  await settle(clock)
  expect(p.state.battle!.inputs.length).toBe(1)
  const choice = JSON.parse(JSON.stringify(demoSteps(NOW).find(s => s.title === 'Band · pick one to keep')!.state)) as GameState
  p.state.battle = null; p.state.moments = choice.moments
  await ui.redraw()
  for (let i = 0; i < 3; i++) expect(await ui.find({ key: `catch-${i}` })).toBeDefined()
  expect(await ui.find({ key: 'inline-pack-open' })).toBeUndefined()
  p.state.moments = []
  await ui.redraw()
  expect(p.state.reveal!.id).toBe(preview)
  expect(await ui.find({ key: 'inline-pack-open' })).toBeDefined()
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toEqual([])
  await ui.unmount()
})

test('requesting a pack during a battle or catch choice places its sealed preview in Sidebar', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), w = engine(on), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  const samples = demoSteps(NOW)
  p.state.battle = JSON.parse(JSON.stringify(samples.find(s => s.title.includes('the special is ready:'))!.state.battle))
  await $.command.run(RUN('pack'))
  await settle(clock)
  const id = p.state.reveal!.id
  expect(p.state.reveal).toMatchObject({ inline: false, cards: [], packId: 'pack-welcome-1' })
  expect(w.opened).toBe(1)
  p.state.battle = null
  p.state.moments = JSON.parse(JSON.stringify(samples.find(s => s.title === 'Band · pick one to keep')!.state.moments))
  await $.command.run(RUN('pack'))
  await settle(clock)
  expect(p.state.reveal!.id).toBe(id)
  expect(p.state.reveal!.inline).toBe(false)
  expect(w.opened).toBe(2)
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toEqual([])
})

test('a retained Sidebar control cannot transfer a newer inline preview', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), w = engine(on), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('pack'))
  await settle(clock)
  const old = p.state.reveal!.id, ui = await $.ui.mount(BAND(40, 'desktop'))
  await ui.press({ key: 'inline-pack-close' })
  await settle(clock)
  await $.command.run(RUN('pack'))
  await settle(clock)
  const next = p.state.reveal!.id
  expect(next).not.toBe(old)
  // The external probe leaves this mounted render's original Sidebar closure retained.
  await ui.press({ key: 'inline-pack-sidebar' })
  await settle(clock)
  expect(p.state.reveal).toMatchObject({ id: next, inline: true })
  expect(w.opened).toBe(0)
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toEqual([])
  await ui.unmount()
})

test('an inline preview, opening and Close preserve an already-open card or Community pane on both surfaces', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), w = engine(on), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN(''))
  await settle(clock)
  const opens = w.opened
  for (const origin of ['card', 'community'] as const) {
    p.state.pane = { ...p.state.pane, tab: origin === 'card' ? 'cards' : 'trade', community: 'profile',
      stack: origin === 'card' ? [{ kind: 'card', cardId: p.state.cards[0]!.id }] : [] }
    const stack = structuredClone(p.state.pane.stack)
    const context = async () => {
      expect(p.state.pane.stack).toEqual(stack)
      expect(p.state.pane.tab).toBe(origin === 'card' ? 'cards' : 'trade')
      expect(p.state.pane.community).toBe('profile')
      for (const surface of ['terminal', 'desktop'] as const) {
        const pane = await $.ui.mount(PANE(24, surface))
        expect(await pane.find({ key: origin === 'card' ? 'set-team' : 'community-profile' })).toBeDefined()
        expect(await pane.find({ key: 'flip' })).toBeUndefined()
        await pane.unmount()
      }
    }
    await $.command.run(RUN('pack'))
    await settle(clock)
    const ui = await $.ui.mount(BAND(40, 'desktop'))
    await context()
    await ui.press({ key: 'inline-pack-close' })
    await settle(clock)
    expect(p.state.reveal).toBeNull()
    await context()
    await $.command.run(RUN('pack'))
    await settle(clock)
    await ui.redraw()
    await ui.press({ key: 'inline-pack-open' })
    await settle(clock)
    await ui.redraw()
    expect(p.state.reveal?.inline).toBe(true)
    await context()
    const count = p.state.reveal!.cards.length
    for (let i = 0; i < count; i++) {
      await ui.press({ key: 'inline-pack-open' })
      await settle(clock)
      await ui.redraw()
    }
    await context()
    const awarded = p.state.reveal!.cards.map(c => c.id)
    await ui.press({ key: 'inline-pack-close' })
    await settle(clock)
    expect(p.state.reveal).toBeNull()
    expect(awarded.every(id => p.state.cards.some(c => c.id === id))).toBe(true)
    await context()
    expect(w.opened).toBe(opens)
    await ui.unmount()
  }
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toHaveLength(2)
})

test('Sidebar during a pending inline opening shows its ceremony once and keeps its card and flip progress', { timeoutMs: 30_000 }, async () => {
  for (const cancel of [null, 'close', 'replacement', 'offline', 'account'] as const) {
    const server = fakeServer(), store = new Map<string, unknown>([[`server:${ORIGIN}:session`, TOKEN]])
    const state = JSON.parse(JSON.stringify(INITIAL)) as GameState
    Object.assign(state, { account: { ...state.account, link: 'ready' }, me: server.me, cards: server.cards })
    state.pane = { ...state.pane, tab: 'cards', stack: [{ kind: 'card', cardId: state.cards[0]!.id }] }
    const original = structuredClone(state.pane.stack)
    let release: (() => void) | undefined, sidebarRelease: (() => void) | undefined, holdingSidebar = false, requests = 0, opened = 0
    const fx: Fx = {
      now: async () => NOW, random: () => .5, after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }),
      store: { get: async key => {
        const value = store.get(key)
        if (holdingSidebar && key === 'prefs' && !sidebarRelease) await new Promise<void>(resolve => { sidebarRelease = resolve })
        return value
      }, set: async (key, value) => { store.set(key, value) }, delete: async key => { store.delete(key) }, keys: async () => [...store.keys()] },
      state: { get: async key => state[key], update: async (key, fn) => { const value = fn(state[key]); Object.assign(state, { [key]: value }); return value } },
      fetch: async (url, init) => {
        const answer = server.handle(url, init)
        if (url.endsWith('/v1/packs/open')) { requests++; await new Promise<void>(resolve => { release = resolve }) }
        return answer
      },
      ui: { toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => false,
        openPane: async () => { opened++; return true }, closePane: async () => undefined, blit: async () => false, sound: () => undefined },
    }
    const game = createGame({ slots: { local: createLocalBackend, battle: async () => undefined, reveal: async () => undefined } })
    await game.command(fx, 'pack')
    expect(state.pane.stack).toEqual(original)
    const preview = state.reveal!.id, opening = game.actions(fx).flip(preview)
    for (let i = 0; i < 1000 && !release; i++) await Promise.resolve()
    expect(release).toBeDefined()
    holdingSidebar = true
    const sidebar = game.actions(fx).open({ view: { kind: 'reveal' }, revealId: preview })
    for (let i = 0; i < 1000 && !sidebarRelease; i++) await Promise.resolve()
    expect(sidebarRelease).toBeDefined()
    expect(state.reveal?.inline).toBe(false)
    expect(state.pane.stack).toEqual(original)
    release!()
    await opening
    if (cancel) {
      if (cancel === 'close' || cancel === 'replacement') {
        await game.actions(fx).doneReveal(state.reveal!.id)
        if (cancel === 'replacement') await game.command(fx, 'pack')
      } else if (cancel === 'offline') await game.actions(fx).world('offline')
      else {
        state.account = { ...state.account, link: 'signed-out' }
        await game.actions(fx).world('online')
      }
      const reveal = structuredClone(state.reveal), pane = structuredClone(state.pane), account = structuredClone(state.account)
      const cards = state.cards.map(c => c.id), packs = state.me!.packs.map(p => p.id), prefs = structuredClone(store.get('prefs'))
      sidebarRelease!()
      await sidebar
      expect(state.reveal).toEqual(reveal)
      expect(state.pane).toEqual(pane)
      expect(state.account).toEqual(account)
      expect(state.cards.map(c => c.id)).toEqual(cards)
      expect(state.me!.packs.map(p => p.id)).toEqual(packs)
      expect(store.get('prefs')).toEqual(prefs)
      expect(requests).toBe(1)
      expect(opened).toBe(0)
      continue
    }
    // The pending Sidebar action may finish for this exact preview's opened successor, never an unrelated reveal.
    sidebarRelease!()
    await sidebar
    expect(state.reveal?.inline).not.toBe(true)
    expect(state.pane.stack).toEqual([...original, { kind: 'reveal' }])
    expect(opened).toBe(1)
    await game.actions(fx).open({ view: { kind: 'reveal' }, revealId: preview })
    expect(opened).toBe(1)
    const reveal = state.reveal!.id, ids = state.reveal!.cards.map(c => c.id)
    await game.actions(fx).flip(reveal)
    expect(state.pane.flipped).toBe(1)
    await game.command(fx, 'pack')
    expect(state.reveal?.inline).toBe(true)
    expect(state.pane.stack).toEqual(original)
    expect(state.pane.flipped).toBe(1)
    await game.actions(fx).open({ view: { kind: 'reveal' }, revealId: reveal })
    expect(state.pane.stack).toEqual([...original, { kind: 'reveal' }])
    expect(state.reveal!.cards.map(c => c.id)).toEqual(ids)
    expect(state.pane.flipped).toBe(1)
    expect(requests).toBe(1)
    expect(opened).toBe(2)
    await game.actions(fx).doneReveal(reveal)
    expect(state.pane.stack).toEqual(original)
    expect(ids.every(id => state.cards.some(c => c.id === id))).toBe(true)
  }
})

test('a delayed Sidebar handoff cannot reopen a closed reveal or alter its replacement account and pane', { timeoutMs: 60_000 }, async () => {
  const community = 'https://garden.example'
  for (const boundary of ['now', 'prefs-read', 'prefs-save-read', 'pane-update'] as const) for (const target of ['close', 'replacement', 'offline', 'server', 'account'] as const) {
    const old = fakeServer(), other = fakeServer({ family: 'haiku' })
    other.cards = other.cards.map(c => ({ ...c, id: `new-${c.id}` }))
    other.me = { ...other.me, player: { ...other.me.player, team: other.cards.slice(0, 3).map(c => c.id) } }
    const store = new Map<string, unknown>([[`server:${ORIGIN}:session`, TOKEN], [`server:${community}:session`, TOKEN], ['prefs', { communityOk: [community] }]])
    const state = JSON.parse(JSON.stringify(INITIAL)) as GameState
    Object.assign(state, { account: { ...state.account, link: 'ready' }, me: old.me, cards: old.cards })
    let armed = false, paused = false, release: (() => void) | undefined, opened = 0, packRequests = 0, prefsReads = 0
    const pause = async () => {
      if (!armed || paused) return
      paused = true
      await new Promise<void>(resolve => { release = resolve })
    }
    const fx: Fx = {
      now: async () => { if (boundary === 'now') await pause(); return NOW }, random: () => .5,
      after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }),
      store: {
        get: async key => {
          const value = store.get(key)
          if (armed && key === 'prefs' && ++prefsReads === (boundary === 'prefs-read' ? 1 : boundary === 'prefs-save-read' ? 2 : 0)) await pause()
          return value
        },
        set: async (key, value) => { store.set(key, value) },
        delete: async key => { store.delete(key) }, keys: async () => [...store.keys()],
      },
      state: { get: async key => state[key], update: async (key, fn) => {
        if (key === 'pane' && boundary === 'pane-update') await pause()
        const value = fn(state[key]); Object.assign(state, { [key]: value }); return value
      } },
      fetch: async (url, init) => {
        if (url.endsWith('/v1/packs/open')) packRequests++
        const source = url.startsWith(community) ? other : old
        return source.handle(url.startsWith(community) ? ORIGIN + url.slice(community.length) : url, init)
      },
      ui: { toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => false,
        openPane: async () => { opened++; return true }, closePane: async () => undefined, blit: async () => false, sound: () => undefined },
    }
    const game = createGame({ slots: { local: createLocalBackend, battle: async () => undefined, reveal: async () => undefined } })
    await game.command(fx, 'pack')
    const original = state.reveal!.id
    armed = true
    const handoff = game.actions(fx).open({ view: { kind: 'reveal' }, revealId: original })
    for (let i = 0; i < 1000 && !release; i++) await Promise.resolve()
    expect(release).toBeDefined()
    if (target === 'close' || target === 'replacement') {
      await game.actions(fx).doneReveal(original)
      if (target === 'replacement') await game.command(fx, 'pack')
    } else if (target === 'offline') await game.actions(fx).world('offline')
    else if (target === 'server') await game.command(fx, `server ${community}`)
    else {
      old.cards = other.cards; old.me = other.me
      state.account = { ...state.account, link: 'signed-out' }
      await game.actions(fx).world('online')
    }
    state.pane = { ...state.pane, stack: [{ kind: 'help' }], message: 'The current pane', flipped: target === 'replacement' ? 1 : 0 }
    const reveal = structuredClone(state.reveal), pane = structuredClone(state.pane), account = structuredClone(state.account)
    const cards = state.cards.map(c => c.id), packs = state.me!.packs.map(p => p.id), prefs = structuredClone(store.get('prefs')), opens = opened
    release!()
    await handoff
    expect(state.reveal).toEqual(reveal)
    expect(state.pane).toEqual(pane)
    expect(state.account).toEqual(account)
    expect(state.cards.map(c => c.id)).toEqual(cards)
    expect(state.me!.packs.map(p => p.id)).toEqual(packs)
    expect(store.get('prefs')).toEqual(prefs)
    expect(opened).toBe(opens)
    expect(packRequests).toBe(0)
  }
})

test('world, server and same-server account changes reject pack work paused across reads, dispatch and state callbacks', { timeoutMs: 60_000 }, async () => {
  const community = 'https://garden.example'
  for (const target of ['offline', 'server', 'account'] as const) for (const boundary of ['preview-read', 'opening-read', 'backend-read', 'busy-update', 'response', 'reveal-update'] as const) {
    const old = fakeServer(), other = fakeServer({ family: 'haiku' })
    other.cards = other.cards.map(c => ({ ...c, id: `new-${c.id}` }))
    other.me = { ...other.me, player: { ...other.me.player, team: other.cards.slice(0, 3).map(c => c.id) } }
    const store = new Map<string, unknown>([[`server:${ORIGIN}:session`, TOKEN], [`server:${community}:session`, TOKEN], ['prefs', { communityOk: [community] }]])
    const state = JSON.parse(JSON.stringify(INITIAL)) as GameState
    Object.assign(state, { account: { ...state.account, link: 'ready' }, me: old.me, cards: old.cards })
    let armed = false, paused = false, release: (() => void) | undefined
    const opened: { url: string; packId: string }[] = []
    const pause = async () => {
      if (!armed || paused) return
      paused = true
      await new Promise<void>(resolve => { release = resolve })
    }
    const fx: Fx = {
      now: async () => NOW, random: () => .5, after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }),
      store: { get: async key => store.get(key), set: async (key, value) => { store.set(key, value) }, delete: async key => { store.delete(key) }, keys: async () => [...store.keys()] },
      state: {
        get: async key => {
          const value = state[key]
          if (boundary === 'preview-read' && key === 'reveal' || boundary === 'opening-read' && key === 'me' || boundary === 'backend-read' && key === 'account') await pause()
          return value
        },
        update: async (key, fn) => {
          if (boundary === 'busy-update' && key === 'pane' || boundary === 'reveal-update' && key === 'reveal') await pause()
          const value = fn(state[key]); Object.assign(state, { [key]: value }); return value
        },
      },
      fetch: async (url, init) => {
        const source = url.startsWith(community) ? other : old
        const answer = source.handle(url.startsWith(community) ? ORIGIN + url.slice(community.length) : url, init)
        if (url.endsWith('/v1/packs/open')) {
          opened.push({ url, packId: JSON.parse(init!.body!).packId })
          if (boundary === 'response') await pause()
        }
        return answer
      },
      ui: { toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => false, openPane: async () => true,
        closePane: async () => undefined, blit: async () => false, sound: () => undefined },
    }
    const game = createGame({ slots: { local: createLocalBackend, battle: async () => undefined, reveal: async () => undefined } })
    if (boundary !== 'preview-read') await game.command(fx, 'pack')
    armed = true
    const work = boundary === 'preview-read' ? game.command(fx, 'pack') : game.actions(fx).flip(state.reveal!.id)
    for (let i = 0; i < 1000 && !release; i++) await Promise.resolve()
    expect(release).toBeDefined()
    if (target === 'offline') await game.actions(fx).world('offline')
    else if (target === 'server') await game.command(fx, `server ${community}`)
    else {
      old.cards = other.cards; old.me = other.me
      state.account = { ...state.account, link: 'signed-out' }
      await game.actions(fx).world('online')
    }
    const collection = state.cards.map(c => c.id), packs = state.me!.packs.map(p => p.id), player = state.me!.player.handle
    release!()
    await work
    expect(state.reveal).toBeNull()
    expect(state.cards.map(c => c.id)).toEqual(collection)
    expect(state.me!.packs.map(p => p.id)).toEqual(packs)
    expect(state.me!.player.handle).toBe(player)
    expect(state.pane.stack).toEqual([])
    expect(state.pane.busy).toBeNull()
    expect(opened).toHaveLength(boundary === 'response' || boundary === 'reveal-update' ? 1 : 0)
    expect(opened.every(r => r.url.startsWith(ORIGIN))).toBe(true)
  }
})

for (const placement of ['inline', 'sidebar'] as const) test(`a late ${placement} opening response cannot revive a closed preview, and stale Close cannot dismiss its replacement`, { timeoutMs: 30_000 }, async () => {
  const server = fakeServer(), store = new Map<string, unknown>([[`server:${ORIGIN}:session`, TOKEN]])
  const state = JSON.parse(JSON.stringify(INITIAL)) as GameState
  Object.assign(state, { account: { ...state.account, link: 'ready' }, me: server.me, cards: server.cards })
  let release: (() => void) | undefined, requests = 0
  const fx: Fx = {
    now: async () => NOW, random: () => .5, after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }),
    store: { get: async key => store.get(key), set: async (key, value) => { store.set(key, value) }, delete: async key => { store.delete(key) }, keys: async () => [...store.keys()] },
    state: { get: async key => state[key], update: async (key, fn) => { const value = fn(state[key]); Object.assign(state, { [key]: value }); return value } },
    fetch: async (url, init) => {
      const answer = server.handle(url, init)
      if (url.endsWith('/v1/packs/open')) { requests++; await new Promise<void>(resolve => { release = resolve }) }
      return answer
    },
    ui: { toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => false, openPane: async () => true,
      closePane: async () => undefined, blit: async () => false, sound: () => undefined },
  }
  const game = createGame({ slots: { local: createLocalBackend, battle: async () => undefined, reveal: async () => undefined } })
  await game.command(fx, 'pack')
  const preview = state.reveal!.id
  if (placement === 'sidebar') await game.actions(fx).open({ view: { kind: 'reveal' } })
  expect(state.reveal!.id).toBe(preview)
  expect(state.reveal!.inline).toBe(placement === 'inline')
  const opening = game.actions(fx).flip(preview)
  for (let i = 0; i < 100 && !release; i++) await Promise.resolve()
  expect(release).toBeDefined()
  await game.actions(fx).flip(preview)
  expect(requests).toBe(1)
  await game.actions(fx).doneReveal(preview)
  expect(state.reveal).toBeNull()
  release!()
  await opening
  expect(state.reveal).toBeNull()
  expect(server.cards.every(c => state.cards.some(k => k.id === c.id))).toBe(true)
  expect(state.me!.packs).toHaveLength(1)
  await game.command(fx, 'pack')
  const next = state.reveal!.id
  expect(next).not.toBe(preview)
  await game.actions(fx).doneReveal(preview)
  expect(state.reveal!.id).toBe(next)
  expect(requests).toBe(1)
})

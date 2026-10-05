// The supported prompt control, through the registered mod: preserve Claude's hint, open only the pane, and keep
// live pack state without taking composer keys. Desktop uses the native SessionMode slot, including an empty
// modes list; PromptHint is terminal-only in older Desktop hosts. Scene probes cover uncommon game states.
import { expect, mock, test } from 'claude-code/testing'
import type { El } from '../../plugin/hooks/client/types.ts'
import { INITIAL } from '../../plugin/hooks/client/game.ts'
import { launcher } from '../../plugin/hooks/ui/launcher.tsx'
import type { LauncherState } from '../../plugin/hooks/ui/launcher.tsx'
import { INERT, uiScenes } from './ui-scenes.ts'
import { NOW, fakeServer } from './fixtures.ts'
import { BAND, PANE, RUN, SESSION, engine, measure, settle, textOf, walk } from './engine.ts'

const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [20, 40, 80, 120] as const
const HINT = (columns: number, surface: 'terminal' | 'desktop') => ({
  plugin: 'spinlings', component: 'PromptHint', requestId: 'prompt-hint', surface, viewport: { columns, rows: 4 },
  props: { isDraft: true, isWorking: false, hint: 'Private composer hint: not read by Spinlings' },
}) as const
const MODE = (columns: number, surface: 'terminal' | 'desktop') => ({
  plugin: 'spinlings', component: 'SessionMode', requestId: 'session-mode', surface, viewport: { columns, rows: 4 },
  props: { modes: [] },
}) as const
const COMPOSER = (columns: number, surface: 'terminal' | 'desktop') => surface === 'desktop' ? MODE(columns, surface) : HINT(columns, surface)

function fits(tree: unknown, columns: number): void {
  const problems: string[] = []
  const size = measure(tree, columns, problems)
  if (size.w > columns) problems.push(`needs ${size.w} cells at ${columns}`)
  expect(problems).toEqual([])
  for (const button of walk(tree).filter(n => n.type === 'Button')) {
    expect(button.props?.hotkey).toBeUndefined()
    expect(button.props?.action).toBeUndefined()
    expect(button.props?.autoFocus).toBeUndefined()
  }
}

test('unsupported composer sites pass Claude through and keep status until the native Desktop slot draws', { timeoutMs: 90_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), w = engine(on, fakeServer())
  await $.session.start(SESSION)
  await settle(clock)
  const fallback = w.status.at(-1)
  expect(fallback).toBe('▪')
  for (const event of [HINT(40, 'desktop'), MODE(40, 'terminal')]) {
    const ui = await $.ui.mount(event)
    expect(textOf(await ui.drawn())).toBe('engine')
    expect(await ui.find({ key: 'spinlings-launcher' })).toBeUndefined()
    expect(w.status.at(-1)).toBe(fallback)
    await ui.unmount()
  }
  // This is the actual Desktop request shape, even when Claude has no additional session modes.
  const ui = await $.ui.mount(MODE(40, 'desktop'))
  expect((await ui.find({ key: 'spinlings-launcher' }))?.props.label).toBe('Spinlings ▪')
  expect(walk(await ui.drawn()).filter(n => n.type === 'Text' && textOf(n) === 'engine')).toHaveLength(1)
  expect(w.status.at(-1)).toBeUndefined()
  await ui.unmount()
  // Ending a conversation must not hide the next conversation's fallback before its composer renders.
  await $.session.end({ reason: 'clear', sessionId: 'launcher-session', resume: { id: 'launcher-session' } })
  await $.session.start(SESSION)
  await settle(clock)
  expect(w.status.at(-1)).toBe(fallback)
})

test('the unstarted prompt launcher preserves Claude\'s hint and never starts an account or claims the keyboard', { timeoutMs: 90_000 }, async ($, on) => {
  const w = engine(on)
  for (const surface of SURFACES) for (const columns of WIDTHS) {
    const ui = await $.ui.mount(COMPOSER(columns, surface))
    const tree = await ui.drawn()
    expect((await ui.find({ key: 'spinlings-launcher' }))?.props.label).toBe('Spinlings')
    expect(textOf(tree)).toBe('Spinlingsengine')
    expect(walk(tree).filter(n => n.type === 'Text' && textOf(n) === 'engine')).toHaveLength(1)
    expect(textOf(tree)).not.toContain('Private composer hint')
    fits(tree, columns)
    await ui.unmount()
  }
  expect(w.requests).toEqual([])
  expect(w.opened).toBe(0)
  expect(w.status.at(-1)).toBeUndefined()
})

test('the launcher opens only the pane; pack consumption updates its badge, quiet hides it, and offline keeps its own state', { timeoutMs: 90_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), server = fakeServer()
  server.me.player.leaderboard = true
  const w = engine(on, server)
  await $.session.start(SESSION)
  await settle(clock)
  // A host without a supported composer slot retains its concise passive status.
  expect(w.status.at(-1)).toBe('▪')
  const ui = await $.ui.mount(MODE(20, 'desktop'))
  const packIds = w.server.me.packs.map(p => p.id), cards = w.server.cards.map(c => c.id)
  const before = w.requests.length
  expect((await ui.find({ key: 'spinlings-launcher' }))?.props.label).toBe('Spinlings ▪')
  expect(w.status.at(-1)).toBeUndefined()
  await ui.press({ key: 'spinlings-launcher' })
  await settle(clock)
  expect(w.opened).toBe(1)
  expect(w.requests.length).toBe(before)
  expect(w.server.me.packs.map(p => p.id)).toEqual(packIds)
  expect(w.server.cards.map(c => c.id)).toEqual(cards)

  await $.command.run(RUN('pack'))
  await settle(clock)
  const preview = await $.ui.mount(BAND(40, 'desktop'))
  await preview.press({ key: 'inline-pack-open' })
  await settle(clock)
  await ui.redraw()
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toHaveLength(1)
  expect((await ui.find({ key: 'spinlings-launcher' }))?.props.label).toBe('Spinlings ▪')
  expect(w.status.at(-1)).toBeUndefined()
  await preview.redraw()
  await preview.press({ key: 'inline-pack-close' })
  await settle(clock)
  await preview.unmount()

  await $.command.run(RUN('quiet on'))
  await settle(clock)
  await ui.redraw()
  expect(await ui.find({ key: 'spinlings-launcher' })).toBeUndefined()
  expect(textOf(await ui.drawn())).toBe('engine')
  await $.command.run(RUN('quiet off'))
  await settle(clock)
  await ui.redraw()
  expect(await ui.find({ key: 'spinlings-launcher' })).toBeDefined()
  expect(w.status.at(-1)).toBeUndefined()

  await $.command.run(RUN('pack'))
  await settle(clock)
  const last = await $.ui.mount(BAND(40, 'desktop'))
  await last.press({ key: 'inline-pack-open' })
  await settle(clock)
  await ui.redraw()
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toHaveLength(2)
  expect(w.server.me.packs).toHaveLength(0)
  expect((await ui.find({ key: 'spinlings-launcher' }))?.props.label).toBe('Spinlings')
  await last.redraw()
  await last.press({ key: 'inline-pack-close' })
  await settle(clock)
  await last.unmount()

  // Boards are loaded only by the player's explicit action; redraws reuse the exact own rank, outside top[].
  await $.command.run(RUN('leaderboard'))
  await settle(clock)
  const boardCalls = w.requests.length
  await ui.redraw()
  expect((await ui.find({ key: 'spinlings-launcher' }))?.props.label).toBe('Spinlings #9')
  await ui.redraw()
  expect(w.requests.length).toBe(boardCalls)

  const onlineCalls = w.requests.length
  await $.command.run(RUN('world offline'))
  await settle(clock)
  await ui.redraw()
  expect(textOf(await ui.drawn())).toBe('Spinlings ▪engine')
  expect((await ui.find({ key: 'spinlings-launcher' }))?.props.label).toBe('Spinlings ▪')
  expect(w.requests.length).toBe(onlineCalls)
  expect(w.status.at(-1)).toBeUndefined()
  await ui.unmount()
})

test('launcher connection states, cached-pack guards, rest, battle, update and full-bank labels stay readable at narrow widths', { timeoutMs: 90_000 }, async ($, on) => {
  const base = uiScenes(NOW)[0]!.state
  const packs = Array.from({ length: 12 }, (_, i) => ({ ...base.me!.packs[0]!, id: `held-${i}` }))
  const full: LauncherState = { ...base, me: { ...base.me!, packs }, social: { ...base.social, rankings: null } }
  const battle = uiScenes(NOW).find(s => s.state.battle)!.state
  const ranked: LauncherState = {
    ...full, me: { ...full.me!, packs: [], player: { ...full.me!.player, leaderboard: true } },
    social: { ...full.social, rankings: {
      board: 'rating', period: 'all', season: 1, top: [],
      me: { rank: 23, handle: full.me!.player.handle, league: full.me!.player.league, value: full.me!.player.rating },
    } },
  }
  const cases: { state: LauncherState; label: string }[] = [
    { state: full, label: 'Spinlings ▪' },
    { state: { ...full, me: { ...full.me!, packs: [] } }, label: 'Spinlings' },
    { state: { ...full, account: { ...full.account, link: 'starting' } }, label: 'Spinlings' },
    { state: { ...full, account: { ...full.account, link: 'joining' } }, label: 'Spinlings' },
    { state: { ...full, account: { ...full.account, link: 'signed-out' } }, label: 'Spinlings' },
    { state: { ...full, account: { ...full.account, link: 'unreachable' } }, label: 'Spinlings ▪' },
    { state: { ...full, account: { ...full.account, world: 'offline' } }, label: 'Spinlings ▪' },
    { state: { ...full, account: { ...full.account, community: true, host: 'world.example' } }, label: 'Spinlings ▪' },
    { state: { ...full, account: { ...full.account, latest: '9.0.0' } }, label: 'Spinlings ▪' },
    { state: { ...full, signals: { ...full.signals, restingUntil: NOW + 60_000 } }, label: 'Spinlings ▪' },
    { state: battle, label: battle.me!.packs.length > 0 ? 'Spinlings ▪' : 'Spinlings' },
    { state: ranked, label: 'Spinlings #23' },
    { state: { ...ranked, me: { ...ranked.me!, packs } }, label: 'Spinlings ▪' },
    { state: { ...ranked, account: { ...ranked.account, world: 'offline' } }, label: 'Spinlings' },
    { state: { ...ranked, account: { ...ranked.account, link: 'unreachable' } }, label: 'Spinlings' },
    { state: { ...ranked, account: { ...ranked.account, link: 'signed-out' } }, label: 'Spinlings' },
    { state: { ...ranked, account: { ...ranked.account, link: 'joining' } }, label: 'Spinlings' },
    { state: { ...ranked, me: null }, label: 'Spinlings' },
    { state: { ...ranked, account: { ...ranked.account, features: ['leaderboard'] } }, label: 'Spinlings' },
    { state: { ...ranked, battle: battle.battle }, label: 'Spinlings' },
    { state: { ...ranked, me: { ...ranked.me!, player: { ...ranked.me!.player, leaderboard: false } } }, label: 'Spinlings' },
    { state: { ...ranked, me: { ...ranked.me!, player: { ...ranked.me!.player, handle: 'Renamed' } } }, label: 'Spinlings' },
    { state: { ...ranked, me: { ...ranked.me!, player: { ...ranked.me!.player, rating: ranked.me!.player.rating + 1 } } }, label: 'Spinlings' },
    { state: { ...ranked, social: { ...ranked.social, loading: ['rankings'] } }, label: 'Spinlings' },
    { state: { ...ranked, social: { ...ranked.social, rankings: { ...ranked.social.rankings!, board: 'species' } } }, label: 'Spinlings' },
    { state: { ...ranked, social: { ...ranked.social, rankings: { ...ranked.social.rankings!, period: 'season' } } }, label: 'Spinlings' },
    { state: { ...ranked, social: { ...ranked.social, rankings: { ...ranked.social.rankings!, me: undefined } } }, label: 'Spinlings' },
    { state: { ...ranked, social: { ...ranked.social, rankings: { ...ranked.social.rankings!, me: { ...ranked.social.rankings!.me!, rank: 0 } } } }, label: 'Spinlings' },
  ]
  let state: LauncherState = INITIAL
  let opened = 0
  on('ui.render', { component: 'Pane', requestId: 'launcher-probe' }, ($, e) => launcher({
    el: $.ui.resolve(e) as unknown as El, state, theirs: { type: 'Text', props: {}, children: ['Claude hint'] },
    open: () => { opened++ },
  }))
  for (const surface of SURFACES) for (const columns of WIDTHS) for (const one of cases) {
    state = one.state
    const ui = await $.ui.mount({ ...PANE(columns, surface), requestId: 'launcher-probe' })
    const tree = await ui.drawn()
    const control = await ui.find({ key: 'spinlings-launcher' })
    if (!control) throw new Error(`Missing launcher at ${columns} ${surface}: ${one.label}; ${textOf(tree)}`)
    expect(control.props.label).toBe(one.label)
    expect(textOf(tree)).toBe(one.label + 'Claude hint')
    expect(walk(tree).filter(n => n.type === 'Text' && textOf(n) === 'Claude hint')).toHaveLength(1)
    fits(tree, columns)
    await ui.unmount()
  }
  // These fixture trees are drawn by the test engine rather than the registered mod; the registered composer click
  // above exercises the host-owned handler. Merely rendering any of these fixtures must never invoke its action.
  expect(opened).toBe(0)
  // A quiet fixture returns the exact caller-provided tree, with no launcher.
  const theirs = { type: 'Text', props: {}, children: ['Claude hint'] } as const
  expect(launcher({ el: {} as El, state: { ...full, prefs: { ...full.prefs, quiet: true } }, theirs: theirs as never, open: INERT.close })).toBe(theirs)
})

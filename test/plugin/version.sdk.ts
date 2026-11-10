// The quiet version indicator (SPEC 32): the pane's hint row ends in the mod's version where the hints leave room (a
// dim press with no key), a chip once the server names a newer release (`Update to 0.2.0` on u), and both open
// /spin updates, where the chip is plain text; a version that can't play online says so above, with Update; the
// status line stays out of it; and `/spin version` in the log, with what the missing releases bring. Through the
// wired mod on the terminal and the desktop at 40, 80 and 120 columns: current, update available, can't play online
// and offline. Then every pane screen keeps its way out (`esc …`) whole, and u for the chip alone.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { ReleaseNote, VersionResponse } from '../../plugin/hooks/core/api.ts'
import { RULES_VERSION } from '../../plugin/hooks/core/battle.ts'
import { GENERATOR_VERSION } from '../../plugin/hooks/core/species.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import { uiScenes } from './ui-scenes.ts'
import { INITIAL, newerMod, statusLine, versionReport } from '../../plugin/hooks/client/game.ts'
import { CLIENT_VERSION, UPDATE_COMMAND, versionStatus } from '../../plugin/hooks/client/remote.ts'
import { KEYS } from '../../plugin/hooks/client/store.ts'
import type { El, GameState } from '../../plugin/hooks/client/types.ts'
import { pane } from '../../plugin/hooks/ui/pane.tsx'
import { fitHints } from '../../plugin/hooks/ui/pane-kit.tsx'
import { NEXT, NOW, ORIGIN, TOKEN, fakeServer } from './fixtures.ts'
import { PANE, RUN, SESSION, engine, measure, settle, textOf, walk } from './engine.ts'
import type { Engine, Node } from './engine.ts'

const LONG = { timeoutMs: 120_000 }
const WIDTHS = [40, 80, 120] as const
const SURFACES = ['terminal', 'desktop'] as const
const NEWER = NEXT
const CHIP_FULL = `Update to ${NEWER}`
const CHIP_NARROW = `Update ${NEWER}`
const chipLabel = (columns: number) => (columns >= 60 ? CHIP_FULL : CHIP_NARROW)
/** What spinlings.dev says the newer release brings. */
const NOTES: ReleaseNote[] = [{ version: NEWER, date: '2026-12-01', highlights: [{ short: 'Team presets', text: 'Save a few teams and switch between them.' }, { short: 'Album stamps', text: 'A family page earns a stamp.' }] }]

const VERSION: VersionResponse = {
  api: 1, server: '1.4.2', rules: RULES_VERSION, generator: GENERATOR_VERSION, minClient: '0.0.1', latestClient: CLIENT_VERSION, features: [],
}

type Mounted = { drawn(): Promise<unknown>; press(t: { key: string }): Promise<unknown>; redraw(): Promise<void>; unmount(): Promise<void> }

/** The hint row: the last row of the frame, its version at the right end. */
function hintRow(tree: unknown): Node {
  return (tree as Node).children!.at(-1) as Node
}

/** The hint row's hints alone, without the version or the chip. */
function hintsOf(tree: unknown): string {
  return String(walk(hintRow(tree).children![0]).find(n => n.type === 'Button')?.props?.label ?? '')
}

/** The hint row's right end: the dim version or the chip, or undefined where the hints took its room. */
function versionOf(tree: unknown): Node | undefined {
  const end = hintRow(tree).children![1]
  return walk(end).find(n => n.type === 'Text' || n.type === 'Button')
}

function buttons(tree: unknown): Node[] {
  return walk(tree).filter(n => n.type === 'Button')
}

/** Text nodes that show the update command themselves. */
function commandLines(tree: unknown): number {
  return walk(tree).filter(n => n.type === 'Text' && (n.children ?? []).some(k => typeof k === 'string' && k.includes(UPDATE_COMMAND))).length
}

function fits(tree: unknown, columns: number, where: string): void {
  const problems: string[] = []
  const size = measure(tree, columns, problems)
  if (size.w > columns) problems.push(`needs ${size.w} cells`)
  expect({ where, problems }).toEqual({ where, problems: [] })
  const keys = buttons(tree).map(b => b.props?.hotkey).filter((k): k is string => typeof k === 'string')
  expect({ where, dupes: keys.filter((k, i) => keys.indexOf(k) !== i) }).toEqual({ where, dupes: [] })
}

async function press(ui: Mounted, key: string, clock: { settle(): Promise<void> }): Promise<void> {
  await ui.press({ key })
  await settle(clock)
  await ui.redraw()
}

/** A session on a fresh machine against `server`, settled. */
async function started($: { session: { start(e: never): Promise<unknown> } }, on: On, server = fakeServer(), prefs?: object) {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on, server)
  if (prefs) w.store.set('prefs', prefs)
  await $.session.start(SESSION as never)
  await settle(clock)
  return { clock, w }
}

const versionChecks = (w: Engine) => w.requests.filter(r => new URL(r.url).pathname === '/v1/version').length
/** `/spin version`'s last line: no plugin list in these worlds, so the setting cannot be told */
const AUTO = 'Auto-update: can\'t tell from here'
/**
 * The version report without that last line, which points to /spin updates only where the update line above does
 * not already: the command is named once.
 */
const report = (log: string | undefined) => {
  const lines = (log ?? '').split('\n')
  const named = lines.slice(0, -1).some(l => l.endsWith(' · /spin updates'))
  expect(lines.at(-1)).toBe(named ? AUTO : `${AUTO} · /spin updates`)
  expect(lines.filter(l => l.includes('/spin updates'))).toHaveLength(1)
  return lines.slice(0, -1)
}

test('an updated mod refreshes same-day cached capabilities once, so Market and the six boards are discoverable', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on, fakeServer())
  w.store.set(KEYS.session(ORIGIN), TOKEN)
  w.store.set(KEYS.meta(ORIGIN), { versionDay: utcDay(NOW), versionClient: '0.1.0', version: { ...VERSION, features: ['leaderboard', 'rivals'] } })
  await $.session.start(SESSION as never)
  await settle(clock)
  expect(versionChecks(w)).toBe(1)
  expect((w.store.get(KEYS.meta(ORIGIN)) as { versionClient: string }).versionClient).toBe(CLIENT_VERSION)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(PANE(40, surface))
    expect(await ui.find({ key: 'tab-market' })).toBeUndefined()
    expect((await ui.find({ key: 'tab-trade' }))?.props.hotkey).toBe('4')
    await press(ui, 'tab-trade', clock)
    await press(ui, 'community-market', clock)
    expect(await ui.find({ key: 'listing-listing-for-sale-pick' })).toBeDefined()
    await press(ui, 'community-boards', clock)
    for (const board of ['rating', 'beaten', 'duelWins', 'species', 'mythics', 'sales']) expect(await ui.find({ key: `board-${board}` })).toBeDefined()
    expect((await ui.find({ key: 'pane-back' }))?.props.label).toBe('Close')
    await ui.unmount()
  }
  await $.command.run(RUN('version'))
  await settle(clock)
  expect(versionChecks(w)).toBe(1)
})

// ---------- pure: what each part says ----------

test('the update target: latestClient when newer, minClient when a lagging server names nothing newer, else none', () => {
  expect(versionStatus(VERSION, CLIENT_VERSION).target).toBeNull()
  expect(versionStatus({ ...VERSION, latestClient: '0.2.0' }, '0.1.0')).toMatchObject({ target: '0.2.0', readOnly: false, update: '0.2.0' })
  expect(versionStatus({ ...VERSION, minClient: '0.2.0', latestClient: '0.3.0' }, '0.1.0')).toMatchObject({ target: '0.3.0', readOnly: true })
  expect(versionStatus({ ...VERSION, minClient: '0.2.0', latestClient: '0.1.0' }, '0.1.0')).toMatchObject({ target: '0.2.0', readOnly: true, update: null })
  expect(versionStatus({ ...VERSION, latestClient: '0.0.9' }, '0.1.0').target).toBeNull()
})

test('a pre-release is never offered: its tag is a server\'s free text, and the marketplace carries releases', () => {
  const tagged = `${NEXT}-security-fix-reinstall-now`
  expect(versionStatus({ ...VERSION, latestClient: tagged }, '0.1.0')).toMatchObject({ target: null, update: null, readOnly: false })
  // read-only still holds below a tagged minClient, but the tag is named nowhere
  expect(versionStatus({ ...VERSION, minClient: tagged, latestClient: '0.1.0' }, '0.1.0')).toMatchObject({ target: null, update: null, readOnly: true })
  expect(versionStatus({ ...VERSION, minClient: tagged, latestClient: '0.3.0' }, '0.1.0')).toMatchObject({ target: '0.3.0', update: '0.3.0', readOnly: true })
  const report = versionReport({ ...INITIAL.account, host: 'cats.example' }, { ...VERSION, minClient: tagged, latestClient: '0.1.0' })
  expect(report.split('\n')[2]).toBe(`This version can't play on cats.example until you update · /spin updates`)
  expect(report).not.toContain('security-fix')
})

test('the passive composer stays empty without packs, including updates, offline, resting and quiet states', () => {
  const online = { ...INITIAL, account: { ...INITIAL.account, link: 'ready' as const } }
  expect(statusLine(online)).toBeUndefined()
  const update = { ...online, account: { ...online.account, latest: NEWER } }
  expect(statusLine(update)).toBeUndefined()
  expect(statusLine({ ...update, signals: { ...update.signals, restingUntil: NOW + 60_000 } })).toBeUndefined()
  expect(statusLine({ ...update, prefs: { ...update.prefs, quiet: true } })).toBeUndefined()
  // the offline world never shows what a server said
  expect(statusLine({ ...update, account: { ...update.account, world: 'offline' } })).toBeUndefined()
  // a $.state value from before the field existed
  const old = { ...online, account: { ...online.account, latest: undefined as unknown as null } }
  expect(statusLine(old)).toBeUndefined()
  expect(newerMod(old.account)).toBeNull()
})

test('/spin version: the mod, the world, the server and its versions, then up to date or the update line', () => {
  const account = { ...INITIAL.account, host: 'spinlings.dev' }
  const lines = (s: string) => s.split('\n')
  expect(lines(versionReport(account, VERSION))).toEqual([
    `Spinlings ${CLIENT_VERSION} · online on spinlings.dev · server 1.4.2`,
    `Rules ${RULES_VERSION} · generator ${GENERATOR_VERSION}`,
    'Up to date.',
  ])
  expect(lines(versionReport(account, { ...VERSION, latestClient: NEWER }))[2]).toBe(`Spinlings ${NEWER} is out · /spin updates`)
  expect(lines(versionReport(account, { ...VERSION, minClient: NEWER }))[2]).toBe(`This version can't play on spinlings.dev until you update to ${NEWER} · /spin updates`)
  // what the missing releases bring, right under the line that names the newest
  expect(lines(versionReport(account, { ...VERSION, latestClient: NEWER }, CLIENT_VERSION, NOTES)).slice(2)).toEqual([
    `Spinlings ${NEWER} is out · /spin updates`, `New since ${CLIENT_VERSION}: Team presets · Album stamps`,
  ])
  expect(lines(versionReport(account, { ...VERSION, rules: RULES_VERSION + 1 }))[1]).toBe(`Rules ${RULES_VERSION + 1} (this mod: ${RULES_VERSION}) · generator ${GENERATOR_VERSION}`)
  expect(lines(versionReport({ ...account, host: 'cats.example', community: true }, VERSION))[0]).toBe(`Spinlings ${CLIENT_VERSION} · online on cats.example (a community server) · server 1.4.2`)
  expect(lines(versionReport(account, null))).toEqual([`Spinlings ${CLIENT_VERSION} · online on spinlings.dev`, 'Can\'t tell whether an update is out until spinlings.dev answers.'])
  // offline: no server, no host, no update line
  const offline = versionReport({ ...account, world: 'offline' }, VERSION)
  expect(lines(offline)).toEqual([`Spinlings ${CLIENT_VERSION} · offline, so no server is asked`, `Rules ${RULES_VERSION} · generator ${GENERATOR_VERSION}`])
  expect(offline).not.toMatch(/spinlings\.dev|1\.4\.2|Up to date|is out/)
})

test('hints fit whole: the way out always stays, the middle gives way from the end, the lead last', () => {
  const cards = ['1-4 Tabs', 'o Open pack', 'm Family · y Rarity', 'n Next page', 'Tab Pick a card', 'esc Close']
  expect(fitHints(cards, 200)).toBe(cards.join(' · '))
  expect(fitHints(cards, 60)).toBe('1-4 Tabs · o Open pack · m Family · y Rarity · esc Close')
  expect(fitHints(cards, 34)).toBe('1-4 Tabs · o Open pack · esc Close')
  expect(fitHints(cards, 33)).toBe('1-4 Tabs · esc Close')
  expect(fitHints(cards, 20)).toBe('1-4 Tabs · esc Close')
  expect(fitHints(cards, 12)).toBe('esc Close')
  // a ceremony without esc keeps its Done
  expect(fitHints(['t Set team', 'd Done', 'Tab Look at a card'], 20)).toBe('t Set team · d Done')
  expect(fitHints(['t Set team', 'd Done', 'Tab Look at a card'], 8)).toBe('d Done')
  // empty items are skipped, and nothing at all draws nothing
  expect(fitHints(['', '1-4 Tabs', '', 'esc Back'], 80)).toBe('1-4 Tabs · esc Back')
  expect(fitHints([], 40)).toBe('')
})

// ---------- wired: the footer chip, the status line and the command, through the engine ----------

test('current: a dim version at the hint row\'s right end where the hints leave room, the way out always whole', LONG, async ($, on) => {
  const { clock, w } = await started($, on)
  expect(w.status.at(-1)).toBe('▪')
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      const where = `current @${columns} ${surface}`
      const ui = await $.ui.mount(PANE(columns, surface))
      const tree = await ui.drawn()
      fits(tree, columns, where)
      // the screen's own hints lead the row and keep their way out
      expect({ where, esc: hintsOf(tree).endsWith('Close') }).toEqual({ where, esc: true })
      const version = versionOf(tree)
      if (columns >= 120) expect({ where, shown: !!version }).toEqual({ where, shown: true })
      if (version) {
        expect({ where, text: textOf(version), dim: version.props?.dimColor, key: version.props?.hotkey, press: version.type })
          .toEqual({ where, text: `v${CLIENT_VERSION}`, dim: true, key: undefined, press: 'Button' })
      }
      await ui.unmount()
    }
  }
  // the dim version opens /spin updates, where it is plain words that press nothing
  const ui = await $.ui.mount(PANE(120, 'desktop'))
  await press(ui, 'version', clock)
  const guide = await ui.drawn()
  // three whole phrases, which a narrow pane breaks only between
  expect(textOf(guide)).toMatch(new RegExp(`Up to date· Spinlings ${CLIENT_VERSION.replace(/\./g, '\\.')}· checked today`))
  expect(versionOf(guide)?.type).toBe('Text')
  expect(await ui.find({ key: 'version' })).toBeUndefined()
  await ui.unmount()
  await settle(clock)
  expect(await $.command.run(RUN('version'))).toEqual({})
  await settle(clock)
  // the day's handshake answers it at once: no "Asking" line, no second version check
  expect(report(w.logs.at(-1))).toEqual([`Spinlings ${CLIENT_VERSION} · online on spinlings.dev · server 1.0.0`, `Rules ${RULES_VERSION} · generator ${GENERATOR_VERSION}`, 'Up to date.'])
  expect(w.logs.some(l => l.startsWith('Asking'))).toBe(false)
  expect(versionChecks(w)).toBe(1)
})

test('update available: the chip is a verb with the version on u, whole at every width, and opens /spin updates', LONG, async ($, on) => {
  const { clock, w } = await started($, on, fakeServer({ latestClient: NEWER, notes: NOTES }))
  expect(w.status.at(-1)).toBe('▪')
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      const where = `update @${columns} ${surface}`
      const ui = await $.ui.mount(PANE(columns, surface))
      let tree = await ui.drawn()
      fits(tree, columns, where)
      const label = chipLabel(columns)
      const chip = await ui.find({ key: 'version' })
      expect({ where, label: chip?.props.label, hotkey: chip?.props.hotkey }).toEqual({ where, label, hotkey: 'u' })
      expect({ where, end: textOf(hintRow(tree)).endsWith(label), esc: hintsOf(tree).endsWith('Close') }).toEqual({ where, end: true, esc: true })
      // the footer gives no command and no row of its own: the chip opens the one place that says it all
      expect({ where, command: commandLines(tree), copy: await ui.find({ key: 'copy-update' }) }).toEqual({ where, command: 0, copy: undefined })
      await press(ui, 'version', clock)
      tree = await ui.drawn()
      fits(tree, columns, `${where}, /spin updates`)
      const text = textOf(tree)
      expect({ where, out: text.includes(`Spinlings ${NEWER} is out`), notes: text.includes('Team presets'), back: hintsOf(tree).endsWith('Back') })
        .toEqual({ where, out: true, notes: true, back: true })
      // inside it, the chip is the plain version: nothing to press, no u
      expect({ where, chip: await ui.find({ key: 'version' }), plain: versionOf(tree)?.type }).toEqual({ where, chip: undefined, plain: 'Text' })
      await press(ui, 'pane-back', clock)
      await ui.unmount()
    }
  }
  expect(await $.command.run(RUN('version'))).toEqual({})
  await settle(clock)
  expect(report(w.logs.at(-1)).slice(-2)).toEqual([`Spinlings ${NEWER} is out · /spin updates`, `New since ${CLIENT_VERSION}: Team presets · Album stamps`])
  expect(versionChecks(w)).toBe(1)
})

test('a $.state pane from before 0.3.0, the update row still open, reloads cleanly and the chip opens /spin updates', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on, fakeServer({ latestClient: NEWER }))
  // $.state as the old module left it: the pane still carries the update row's flag
  const probe = { state: structuredClone(INITIAL) as GameState, version: 0 }
  probe.state.pane = { ...INITIAL.pane, showUpdate: true, stack: [{ kind: 'privacy' }] } as unknown as GameState['pane']
  on('state.get', (_$, e) => ({ value: { value: probe.state[e.key as keyof GameState], version: probe.version } }))
  on('state.set', (_$, e) => {
    Object.assign(probe.state, { [e.key as keyof GameState]: e.value })
    return { value: { isSet: true, version: ++probe.version } }
  })
  await $.session.start(SESSION)
  await settle(clock)
  const ui = await $.ui.mount(PANE(80, 'terminal'))
  const tree = await ui.drawn()
  fits(tree, 80, 'stale pane')
  expect(hintsOf(tree).endsWith('Back')).toBe(true)
  await press(ui, 'version', clock)
  expect(probe.state.pane.stack.at(-1)).toEqual({ kind: 'auto-update' })
  await ui.unmount()
  expect(w.status.at(-1)).toBe('▪')
})

test('read-only below minClient: plain words above, with Update, which opens /spin updates; the chip to the version it needs', LONG, async ($, on) => {
  // a lagging server: minClient is above this mod and latestClient names nothing newer
  const { clock, w } = await started($, on, fakeServer({ latestClient: CLIENT_VERSION, minClient: NEWER }))
  w.store.set('prefs', { ...(w.store.get('prefs') as object), world: 'online' })
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  await $.session.start(SESSION)
  await settle(clock)
  expect(w.status.at(-1)).toBe('▪')
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      const where = `read-only @${columns} ${surface}`
      const ui = await $.ui.mount(PANE(columns, surface))
      let tree = await ui.drawn()
      fits(tree, columns, where)
      expect({ where, said: !!(await ui.find({ text: /This version can't play on spinlings\.dev until you update\./ })), command: commandLines(tree), plain: /read-only/i.test(textOf(tree)) })
        .toEqual({ where, said: true, command: 0, plain: false })
      expect({ where, label: (await ui.find({ key: 'version' }))?.props.label }).toEqual({ where, label: chipLabel(columns) })
      expect({ where, update: (await ui.find({ key: 'link-update' }))?.props }).toMatchObject({ where, update: { label: 'Update', dimColor: true } })
      expect({ where, key: (await ui.find({ key: 'link-update' }))?.props.hotkey }).toEqual({ where, key: undefined })
      await press(ui, 'link-update', clock)
      tree = await ui.drawn()
      fits(tree, columns, `${where}, /spin updates`)
      // the screen says it itself, so the note above is gone, and Copy leads on 1
      expect({ where, head: textOf(tree).includes('Update to keep playing online'), note: !!(await ui.find({ key: 'link-update' })) }).toEqual({ where, head: true, note: false })
      expect({ where, copy: (await ui.find({ key: 'update-copy' }))?.props }).toMatchObject({ where, copy: { hotkey: '1', variant: 'primary' } })
      await press(ui, 'pane-back', clock)
      await ui.unmount()
    }
  }
  await $.command.run(RUN('version'))
  await settle(clock)
  expect(report(w.logs.at(-1)).at(-1)).toBe(`This version can't play on spinlings.dev until you update to ${NEWER} · /spin updates`)
})

test('read-only with auto-update on and able: the chip still says Update on u, as the note above does, never that it is on its way', LONG, async ($, on) => {
  const scene = (title: string) => structuredClone(uiScenes(NOW).find(s => s.title === title)!.state)
  let state = scene('Version · can\'t play online, though auto-update is on')
  on('ui.render', { component: 'Pane', requestId: 'probe' }, async ($, e) => pane({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows, now: NOW,
    actions: new Proxy({}, { get: () => () => Promise.resolve() }) as never, focused: true, placement: 'inline', state,
  }))
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      const where = `read-only, auto-update on @${columns} ${surface}`
      state = scene('Version · can\'t play online, though auto-update is on')
      let ui = await $.ui.mount({ ...PANE(columns, surface), requestId: 'probe' })
      const tree = await ui.drawn()
      fits(tree, columns, where)
      const chip = (await ui.find({ key: 'version' }))?.props
      expect({ where, label: chip?.label, hotkey: chip?.hotkey, dim: !!chip?.dimColor, said: textOf(tree).includes('This version can\'t play on spinlings.dev until you update.') })
        .toEqual({ where, label: chipLabel(columns), hotkey: 'u', dim: false, said: true })
      await ui.unmount()
      // the same account able to play online: the release is on its way, dim
      state = scene('Version · on its way: auto-update brings it')
      ui = await $.ui.mount({ ...PANE(columns, surface), requestId: 'probe' })
      expect({ where, label: (await ui.find({ key: 'version' }))?.props.label }).toEqual({ where, label: columns >= 60 ? `${NEWER} on its way` : `${NEWER} soon` })
      await ui.unmount()
    }
  }
})

test('offline: the plain version where there is room, no update, and /spin version names no server and sends nothing', LONG, async ($, on) => {
  const { clock, w } = await started($, on, fakeServer({ latestClient: NEWER }), { world: 'offline' })
  expect(w.status.at(-1)).toBe('▪')
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      const where = `offline @${columns} ${surface}`
      const ui = await $.ui.mount(PANE(columns, surface))
      const tree = await ui.drawn()
      fits(tree, columns, where)
      const version = versionOf(tree)
      if (columns >= 120) expect({ where, shown: !!version }).toEqual({ where, shown: true })
      expect({ where, version: version ? textOf(version) : `v${CLIENT_VERSION}`, chip: (await ui.find({ key: 'version' }))?.props.hotkey, esc: hintsOf(tree).endsWith('Close') })
        .toEqual({ where, version: `v${CLIENT_VERSION}`, chip: undefined, esc: true })
      await ui.unmount()
    }
  }
  await $.command.run(RUN('version'))
  await settle(clock)
  expect(report(w.logs.at(-1))).toEqual([`Spinlings ${CLIENT_VERSION} · offline, so no server is asked`, `Rules ${RULES_VERSION} · generator ${GENERATOR_VERSION}`])
  expect(w.requests).toEqual([])
})

test('switching worlds: the update shows online only, and comes back from the day\'s answer without asking again', LONG, async ($, on) => {
  const { clock, w } = await started($, on, fakeServer({ latestClient: NEWER }))
  await $.command.run(RUN('world offline'))
  await settle(clock)
  expect(w.status.at(-1)).toBe('▪')
  let ui = await $.ui.mount(PANE(80))
  expect((await ui.find({ key: 'version' }))?.props).toMatchObject({ label: `v${CLIENT_VERSION}`, dimColor: true })
  expect((await ui.find({ key: 'version' }))?.props.hotkey).toBeUndefined()
  await ui.unmount()
  await $.command.run(RUN('world online'))
  await settle(clock)
  expect(w.status.at(-1)).toBe('▪')
  ui = await $.ui.mount(PANE(80))
  expect((await ui.find({ key: 'version' }))?.props.label).toBe(CHIP_FULL)
  await ui.unmount()
  expect(versionChecks(w)).toBe(1)
})

test('/spin version never waits silently: it says it is asking, reports the last answer with its day, and does not ask again soon', LONG, async ($, on) => {
  const server = fakeServer({ latestClient: NEWER })
  const { clock, w } = await started($, on, server)
  // yesterday's answer is the last one, and the server has gone quiet
  const key = KEYS.meta(ORIGIN)
  const yesterday = utcDay(NOW - 86_400_000)
  w.store.set(key, { ...(w.store.get(key) as object), versionDay: yesterday })
  server.down = true
  const before = versionChecks(w)
  await $.command.run(RUN('version'))
  await settle(clock)
  expect(w.logs.at(-2)).toBe('Asking spinlings.dev…')
  expect(report(w.logs.at(-1))).toEqual([
    `Spinlings ${CLIENT_VERSION} · online on spinlings.dev · server 1.0.0`,
    `Rules ${RULES_VERSION} · generator ${GENERATOR_VERSION}`,
    `Spinlings ${NEWER} is out · /spin updates`,
    'Can\'t reach spinlings.dev right now, so that is its answer from yesterday.',
  ])
  expect(versionChecks(w)).toBe(before + 1)
  // straight after a failure: the report at once, no new request, no "Asking"
  const logs = w.logs.length
  await $.command.run(RUN('version'))
  await settle(clock)
  expect(w.logs.slice(logs).length).toBe(1)
  expect(report(w.logs.at(-1)).at(-1)).toBe('Can\'t reach spinlings.dev right now, so that is its answer from yesterday.')
  expect(versionChecks(w)).toBe(before + 1)
})

// ---------- every screen: the way out stays whole, and u belongs to the chip alone ----------

test('on every pane screen at 40, 80 and 120, current and with an update: the way out whole, u the chip\'s alone', { timeoutMs: 300_000 }, async ($, on) => {
  let state: GameState = INITIAL
  on('ui.render', { component: 'Pane', requestId: 'probe' }, async ($, e) => pane({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows, now: NOW,
    actions: new Proxy({}, { get: () => () => Promise.resolve() }) as never, focused: true, placement: 'inline', state,
  }))
  const draw = async (s: GameState, columns: number, surface: 'terminal' | 'desktop') => {
    state = s
    const ui = await $.ui.mount({ ...PANE(columns, surface), requestId: 'probe' })
    const tree = await ui.drawn()
    await ui.unmount()
    return tree
  }
  const steps = uiScenes(NOW).filter(s => !s.band)
  expect(steps.length).toBeGreaterThan(40)
  const failures: string[] = []
  for (const step of steps) {
    const variants = {
      current: { ...step.state, account: { ...step.state.account, latest: null } },
      update: { ...step.state, account: { ...step.state.account, latest: '9.9.0' } },
    }
    // the screen's way out, from its hints drawn with room to spare
    const wide = hintsOf(await draw(variants.current, 400, 'terminal')).split(' · ')
    const leave = [...wide].reverse().find(h => h === 'Close' || h === 'Back' || h === 'Done') ?? null
    const online = step.state.account.world === 'online'
    // /spin updates says all a chip would, so the chip there is plain words
    const guide = step.state.pane.stack.at(-1)?.kind === 'auto-update'
    for (const [name, s] of Object.entries(variants)) {
      for (const surface of SURFACES) {
        for (const columns of WIDTHS) {
          const where = `${step.title} @${columns} ${surface} (${name})`
          const tree = await draw(s, columns, surface)
          const hints = hintsOf(tree)
          if (leave && !hints.split(' · ').includes(leave)) failures.push(`${where}: lost "${leave}" from "${hints}"`)
          const keys = buttons(tree).map(b => b.props?.hotkey).filter((k): k is string => typeof k === 'string')
          const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
          if (dupes.length > 0) failures.push(`${where}: keys twice: ${dupes.join(' ')}`)
          const u = buttons(tree).filter(b => b.props?.hotkey === 'u').map(b => String(b.key ?? b.props?.key))
          const owner = name === 'current' || !online || guide ? [] : ['version']
          if (u.join() !== owner.join()) failures.push(`${where}: u on [${u.join()}], not [${owner.join()}]`)
          // the update chip always shows when there is one, and is never cut
          const chip = buttons(tree).find(b => String(b.key ?? b.props?.key) === 'version' && b.props?.hotkey === 'u')
          if (name !== 'current' && online && !guide && !chip) failures.push(`${where}: no update chip`)
          if (chip && String(chip.props?.label).includes('…')) failures.push(`${where}: the chip is cut`)
          const problems: string[] = []
          if (measure(tree, columns, problems).w > columns || problems.length > 0) failures.push(`${where}: ${problems.join('; ') || 'overflow'}`)
        }
      }
    }
  }
  expect(failures).toEqual([])
})

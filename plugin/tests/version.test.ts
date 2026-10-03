// The quiet version indicator (SPEC 32): the pane's hint row ends in the mod's version where the hints leave room, a
// chip once the server names a newer release (`Update to 0.2.0`; u opens the update command, u again copies it, the
// chip closes it, as esc does in game.test.ts), the status line's ` · update 0.2.0`, and `/spin version` in the log.
// Through the wired mod on the terminal and the desktop at 40, 80 and 120 columns: current, update available,
// read-only and offline. Then every pane screen keeps its way out (`esc …`) whole, and u for the chip alone.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { VersionResponse } from '../hooks/core/api.ts'
import { RULES_VERSION } from '../hooks/core/battle.ts'
import { GENERATOR_VERSION } from '../hooks/core/species.ts'
import { utcDay } from '../hooks/core/world.ts'
import { demoSteps } from '../hooks/client/demo.ts'
import { INITIAL, newerMod, statusLine, versionReport } from '../hooks/client/game.ts'
import { CLIENT_VERSION, UPDATE_COMMAND, versionStatus } from '../hooks/client/remote.ts'
import { KEYS } from '../hooks/client/store.ts'
import type { El, GameState } from '../hooks/client/types.ts'
import { pane } from '../hooks/ui/pane.tsx'
import { CHIP_HIDE, fitHints } from '../hooks/ui/pane-kit.tsx'
import { INK } from '../hooks/ui/tokens.ts'
import { NOW, ORIGIN, TOKEN, fakeServer } from './fixtures.ts'
import { PANE, RUN, SESSION, engine, measure, settle, textOf, walk } from './engine.ts'
import type { Engine, Node } from './engine.ts'

const LONG = { timeoutMs: 120_000 }
const WIDTHS = [40, 80, 120] as const
const SURFACES = ['terminal', 'desktop'] as const
const NEWER = '0.2.0'
const CHIP_FULL = `Update to ${NEWER}`
const CHIP_NARROW = `Update ${NEWER}`
const chipLabel = (columns: number) => (columns >= 60 ? CHIP_FULL : CHIP_NARROW)
const ESC_HIDE = `esc ${CHIP_HIDE}`

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
  return textOf(hintRow(tree).children![0])
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

// ---------- pure: what each part says ----------

test('the update target: latestClient when newer, minClient when a lagging server names nothing newer, else none', () => {
  expect(versionStatus(VERSION, CLIENT_VERSION).target).toBeNull()
  expect(versionStatus({ ...VERSION, latestClient: '0.2.0' }, '0.1.0')).toMatchObject({ target: '0.2.0', readOnly: false, update: '0.2.0' })
  expect(versionStatus({ ...VERSION, minClient: '0.2.0', latestClient: '0.3.0' }, '0.1.0')).toMatchObject({ target: '0.3.0', readOnly: true })
  expect(versionStatus({ ...VERSION, minClient: '0.2.0', latestClient: '0.1.0' }, '0.1.0')).toMatchObject({ target: '0.2.0', readOnly: true, update: null })
  expect(versionStatus({ ...VERSION, latestClient: '0.0.9' }, '0.1.0').target).toBeNull()
})

test('a pre-release is never offered: its tag is a server\'s free text, and the marketplace carries releases', () => {
  const tagged = '0.2.0-security-fix-reinstall-now'
  expect(versionStatus({ ...VERSION, latestClient: tagged }, '0.1.0')).toMatchObject({ target: null, update: null, readOnly: false })
  // read-only still holds below a tagged minClient, but the tag is named nowhere
  expect(versionStatus({ ...VERSION, minClient: tagged, latestClient: '0.1.0' }, '0.1.0')).toMatchObject({ target: null, update: null, readOnly: true })
  expect(versionStatus({ ...VERSION, minClient: tagged, latestClient: '0.3.0' }, '0.1.0')).toMatchObject({ target: '0.3.0', update: '0.3.0', readOnly: true })
  const report = versionReport({ ...INITIAL.account, host: 'cats.example' }, { ...VERSION, minClient: tagged, latestClient: '0.1.0' })
  expect(report.split('\n')[2]).toBe(`Read-only on cats.example until you update · ${UPDATE_COMMAND}`)
  expect(report).not.toContain('security-fix')
})

test('the status line gains ` · update {latest}` only when an update exists, online, and stays empty while quiet', () => {
  const online = { ...INITIAL, account: { ...INITIAL.account, link: 'ready' as const } }
  expect(statusLine(online)).toBe('spinlings · Online')
  const update = { ...online, account: { ...online.account, latest: NEWER } }
  expect(statusLine(update)).toBe(`spinlings · Online · update ${NEWER}`)
  expect(statusLine({ ...update, signals: { ...update.signals, restingUntil: NOW + 60_000 } })).toMatch(new RegExp(`^spinlings · .+ · update ${NEWER.replaceAll('.', '\\.')}$`))
  expect(statusLine({ ...update, prefs: { ...update.prefs, quiet: true } })).toBeUndefined()
  // the offline world never shows what a server said
  expect(statusLine({ ...update, account: { ...update.account, world: 'offline' } })).toBe('spinlings · Offline')
  // a $.state value from before the field existed
  const old = { ...online, account: { ...online.account, latest: undefined as unknown as null } }
  expect(statusLine(old)).toBe('spinlings · Online')
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
  expect(lines(versionReport(account, { ...VERSION, latestClient: NEWER }))[2]).toBe(`Spinlings ${NEWER} is out · ${UPDATE_COMMAND}`)
  expect(lines(versionReport(account, { ...VERSION, minClient: NEWER }))[2]).toBe(`Read-only on spinlings.dev until you update to ${NEWER} · ${UPDATE_COMMAND}`)
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
  expect(w.status.at(-1)).toBe('spinlings · Online · 2 packs')
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      const where = `current @${columns} ${surface}`
      const ui = await $.ui.mount(PANE(columns, surface))
      const tree = await ui.drawn()
      fits(tree, columns, where)
      // the screen's own hints lead the row and keep their way out
      expect({ where, esc: hintsOf(tree).endsWith('esc Close') }).toEqual({ where, esc: true })
      const version = versionOf(tree)
      if (columns >= 120) expect({ where, shown: !!version }).toEqual({ where, shown: true })
      if (version) expect({ where, text: textOf(version), dim: version.props?.dimColor }).toEqual({ where, text: `v${CLIENT_VERSION}`, dim: true })
      expect({ where, chip: await ui.find({ key: 'version' }) }).toEqual({ where, chip: undefined })
      await ui.unmount()
    }
  }
  await settle(clock)
  expect(await $.command.run(RUN('version'))).toEqual({})
  await settle(clock)
  // the day's handshake answers it at once: no "Asking" line, no second version check
  expect(w.logs.at(-1)).toBe([`Spinlings ${CLIENT_VERSION} · online on spinlings.dev · server 1.0.0`, `Rules ${RULES_VERSION} · generator ${GENERATOR_VERSION}`, 'Up to date.'].join('\n'))
  expect(w.logs.some(l => l.startsWith('Asking'))).toBe(false)
  expect(versionChecks(w)).toBe(1)
})

test('update available: the chip is a verb with the version, u shows the command, u copies it, esc or the chip hides it', LONG, async ($, on) => {
  const { clock, w } = await started($, on, fakeServer({ latestClient: NEWER }))
  expect(w.status.at(-1)).toBe(`spinlings · Online · 2 packs · update ${NEWER}`)
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      const where = `update @${columns} ${surface}`
      const ui = await $.ui.mount(PANE(columns, surface))
      let tree = await ui.drawn()
      fits(tree, columns, where)
      const label = chipLabel(columns)
      const chip = await ui.find({ key: 'version' })
      expect({ where, label: chip?.props.label, hotkey: chip?.props.hotkey }).toEqual({ where, label, hotkey: 'u' })
      expect({ where, end: textOf(hintRow(tree)).endsWith(label), esc: hintsOf(tree).endsWith('esc Close') }).toEqual({ where, end: true, esc: true })
      expect({ where, command: await ui.find({ text: UPDATE_COMMAND }) }).toEqual({ where, command: undefined })

      // open: the command with what it is for, Copy on u, the chip says it hides the row, esc says so too
      await press(ui, 'version', clock)
      tree = await ui.drawn()
      fits(tree, columns, `${where}, command open`)
      expect({ where, command: commandLines(tree), lead: !!(await ui.find({ type: 'Text', text: /^In a terminal: $/ })) }).toEqual({ where, command: 1, lead: true })
      const open = await ui.find({ key: 'version' })
      expect({ where, copy: (await ui.find({ key: 'copy-update' }))?.props.hotkey, chip: open?.props.hotkey, label: open?.props.label })
        .toEqual({ where, copy: 'u', chip: undefined, label: CHIP_HIDE })
      expect({ where, esc: hintsOf(tree).endsWith(ESC_HIDE) }).toEqual({ where, esc: true })

      // Copy, asked where the press came from: on the terminal it lands, said in the good ink, not as a warning; the
      // desktop has no clipboard path yet, so the pane points at the command rather than claim a copy
      const copies = w.copied.length
      await press(ui, 'copy-update', clock)
      expect({ where, asked: w.copies.at(-1) }).toEqual({ where, asked: { text: UPDATE_COMMAND, surface } })
      if (surface === 'terminal') {
        expect({ where, copied: w.copied.slice(copies) }).toEqual({ where, copied: [UPDATE_COMMAND] })
        const said = await ui.find({ type: 'Text', text: /Copied\. Run it in a terminal\./ })
        expect({ where, said: !!said, color: said?.props.color }).toEqual({ where, said: true, color: INK.good })
      } else {
        expect({ where, copied: w.copied.slice(copies) }).toEqual({ where, copied: [] })
        const claims = await ui.find({ type: 'Text', text: /Copied/ })
        const points = await ui.find({ type: 'Text', text: /Select the command below to copy it/ })
        expect({ where, claims: !!claims, points: !!points }).toEqual({ where, claims: false, points: true })
      }

      // the chip, now `Hide update`, closes the row (esc does too: game.test.ts), and takes u back
      await press(ui, 'version', clock)
      tree = await ui.drawn()
      const closed = await ui.find({ key: 'version' })
      expect({ where, command: commandLines(tree), label: closed?.props.label, hotkey: closed?.props.hotkey, esc: hintsOf(tree).endsWith('esc Close') })
        .toEqual({ where, command: 0, label, hotkey: 'u', esc: true })
      await ui.unmount()
    }
  }
  expect(await $.command.run(RUN('version'))).toEqual({})
  await settle(clock)
  expect(w.logs.at(-1)?.split('\n').at(-1)).toBe(`Spinlings ${NEWER} is out · ${UPDATE_COMMAND}`)
  expect(versionChecks(w)).toBe(1)
})

test('the update row closes when the tab changes or a view opens over it', LONG, async ($, on) => {
  const { clock } = await started($, on, fakeServer({ latestClient: NEWER }))
  const ui = await $.ui.mount(PANE(80))
  await press(ui, 'version', clock)
  expect(commandLines(await ui.drawn())).toBe(1)
  await press(ui, 'tab-cards', clock)
  expect(commandLines(await ui.drawn())).toBe(0)
  await press(ui, 'version', clock)
  expect(commandLines(await ui.drawn())).toBe(1)
  const card = buttons(await ui.drawn()).find(b => String(b.key ?? b.props?.key).startsWith('card-'))
  expect(card).toBeDefined()
  await press(ui, String(card!.key ?? card!.props?.key), clock)
  const tree = await ui.drawn()
  expect({ command: commandLines(tree), esc: hintsOf(tree).endsWith('esc Back') }).toEqual({ command: 0, esc: true })
  await ui.unmount()
})

test('read-only below minClient: the warning above, the chip to the version the server needs, the command once', LONG, async ($, on) => {
  // a lagging server: minClient is above this mod and latestClient names nothing newer
  const { clock, w } = await started($, on, fakeServer({ latestClient: CLIENT_VERSION, minClient: NEWER }))
  w.store.set('prefs', { ...(w.store.get('prefs') as object), world: 'online' })
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  await $.session.start(SESSION)
  await settle(clock)
  expect(w.status.at(-1)).toBe(`spinlings · Online · 2 packs · update ${NEWER}`)
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      const where = `read-only @${columns} ${surface}`
      const ui = await $.ui.mount(PANE(columns, surface))
      let tree = await ui.drawn()
      fits(tree, columns, where)
      expect({ where, warned: !!(await ui.find({ text: /This version is read-only on spinlings\.dev/ })), command: commandLines(tree) }).toEqual({ where, warned: true, command: 1 })
      expect({ where, label: (await ui.find({ key: 'version' }))?.props.label }).toEqual({ where, label: chipLabel(columns) })
      await press(ui, 'version', clock)
      tree = await ui.drawn()
      fits(tree, columns, `${where}, command open`)
      // the warning stays, the command shows once: in the row that explains it
      expect({ where, warned: !!(await ui.find({ text: /This version is read-only on spinlings\.dev\./ })), command: commandLines(tree) }).toEqual({ where, warned: true, command: 1 })
      await press(ui, 'copy-update', clock)
      expect({ where, copied: w.copied.at(-1) }).toEqual({ where, copied: UPDATE_COMMAND })
      await press(ui, 'version', clock)
      await ui.unmount()
    }
  }
  await $.command.run(RUN('version'))
  await settle(clock)
  expect(w.logs.at(-1)?.split('\n').at(-1)).toBe(`Read-only on spinlings.dev until you update to ${NEWER} · ${UPDATE_COMMAND}`)
})

test('offline: the plain version where there is room, no update, and /spin version names no server and sends nothing', LONG, async ($, on) => {
  const { clock, w } = await started($, on, fakeServer({ latestClient: NEWER }), { world: 'offline' })
  expect(w.status.at(-1)).toBe('spinlings · Offline · 2 packs')
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      const where = `offline @${columns} ${surface}`
      const ui = await $.ui.mount(PANE(columns, surface))
      const tree = await ui.drawn()
      fits(tree, columns, where)
      const version = versionOf(tree)
      if (columns >= 120) expect({ where, shown: !!version }).toEqual({ where, shown: true })
      expect({ where, version: version ? textOf(version) : `v${CLIENT_VERSION}`, chip: await ui.find({ key: 'version' }), esc: hintsOf(tree).endsWith('esc Close') })
        .toEqual({ where, version: `v${CLIENT_VERSION}`, chip: undefined, esc: true })
      await ui.unmount()
    }
  }
  await $.command.run(RUN('version'))
  await settle(clock)
  expect(w.logs.at(-1)).toBe(`Spinlings ${CLIENT_VERSION} · offline, so no server is asked\nRules ${RULES_VERSION} · generator ${GENERATOR_VERSION}`)
  expect(w.requests).toEqual([])
})

test('switching worlds: the update shows online only, and comes back from the day\'s answer without asking again', LONG, async ($, on) => {
  const { clock, w } = await started($, on, fakeServer({ latestClient: NEWER }))
  await $.command.run(RUN('world offline'))
  await settle(clock)
  expect(w.status.at(-1)).toBe('spinlings · Offline · 2 packs')
  let ui = await $.ui.mount(PANE(80))
  expect(await ui.find({ key: 'version' })).toBeUndefined()
  await ui.unmount()
  await $.command.run(RUN('world online'))
  await settle(clock)
  expect(w.status.at(-1)).toBe(`spinlings · Online · 2 packs · update ${NEWER}`)
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
  expect(w.logs.at(-1)?.split('\n')).toEqual([
    `Spinlings ${CLIENT_VERSION} · online on spinlings.dev · server 1.0.0`,
    `Rules ${RULES_VERSION} · generator ${GENERATOR_VERSION}`,
    `Spinlings ${NEWER} is out · ${UPDATE_COMMAND}`,
    'Can\'t reach spinlings.dev right now, so that is its answer from yesterday.',
  ])
  expect(versionChecks(w)).toBe(before + 1)
  // straight after a failure: the report at once, no new request, no "Asking"
  const logs = w.logs.length
  await $.command.run(RUN('version'))
  await settle(clock)
  expect(w.logs.slice(logs).length).toBe(1)
  expect(w.logs.at(-1)?.split('\n').at(-1)).toBe('Can\'t reach spinlings.dev right now, so that is its answer from yesterday.')
  expect(versionChecks(w)).toBe(before + 1)
})

// ---------- every screen: the way out stays whole, and u belongs to the chip alone ----------

test('on every pane screen at 40, 80 and 120, current, with an update and with it open: the way out whole, u the chip\'s alone', { timeoutMs: 300_000 }, async ($, on) => {
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
  const steps = demoSteps(NOW).filter(s => !s.band)
  expect(steps.length).toBeGreaterThan(40)
  const failures: string[] = []
  for (const step of steps) {
    const variants = {
      current: { ...step.state, account: { ...step.state.account, latest: null }, pane: { ...step.state.pane, showUpdate: false } },
      update: { ...step.state, account: { ...step.state.account, latest: '9.9.0' }, pane: { ...step.state.pane, showUpdate: false } },
      open: { ...step.state, account: { ...step.state.account, latest: '9.9.0' }, pane: { ...step.state.pane, showUpdate: true } },
    }
    // the screen's way out, from its hints drawn with room to spare
    const wide = hintsOf(await draw(variants.current, 400, 'terminal')).split(' · ')
    const leave = [...wide].reverse().find(h => h.startsWith('esc ') || h === 'd Done') ?? null
    const online = step.state.account.world === 'online'
    for (const [name, s] of Object.entries(variants)) {
      const want = name === 'open' && online ? ESC_HIDE : leave
      for (const surface of SURFACES) {
        for (const columns of WIDTHS) {
          const where = `${step.title} @${columns} ${surface} (${name})`
          const tree = await draw(s, columns, surface)
          const hints = hintsOf(tree)
          if (want && !hints.split(' · ').includes(want)) failures.push(`${where}: lost "${want}" from "${hints}"`)
          if (want?.startsWith('esc ') && !hints.endsWith(want)) failures.push(`${where}: "${hints}" does not end with "${want}"`)
          const keys = buttons(tree).map(b => b.props?.hotkey).filter((k): k is string => typeof k === 'string')
          const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
          if (dupes.length > 0) failures.push(`${where}: keys twice: ${dupes.join(' ')}`)
          const u = buttons(tree).filter(b => b.props?.hotkey === 'u').map(b => String(b.key ?? b.props?.key))
          const owner = name === 'current' || !online ? [] : [name === 'open' ? 'copy-update' : 'version']
          if (u.join() !== owner.join()) failures.push(`${where}: u on [${u.join()}], not [${owner.join()}]`)
          // the update chip always shows when there is one
          if (name !== 'current' && online && !buttons(tree).some(b => String(b.key ?? b.props?.key) === 'version')) failures.push(`${where}: no update chip`)
          const problems: string[] = []
          if (measure(tree, columns, problems).w > columns || problems.length > 0) failures.push(`${where}: ${problems.join('; ') || 'overflow'}`)
        }
      }
    }
  }
  expect(failures).toEqual([])
})

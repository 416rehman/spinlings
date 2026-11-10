// The one-press auto-update switch through the wired mod (SPEC 32), staged as an installed copy so it finds its plugin
// list four folders up. On the terminal at 40, 80 and 120 columns and on the desktop: the guide writes nothing before
// a press; a press as it appears does nothing; Turn it on writes once, the chip flips and the rare chime plays once;
// pressing on writes nothing more; Turn it off puts the bytes back as they were; on the desktop the switch itself is
// a control, and a switch is drawn only where a click on it does something (Try again after a busy press; none where
// the guide cannot change it). The band never writes from a digit: on the desktop its Turn on auto-update carries no
// digit and writes once on a click, after its own pause, and its payoff shows the whole command to turn it off at any
// width; on the terminal 1 opens the guide without the keyboard, which says how to hand it the keys before anything to
// press. Turned off on purpose, held by Claude Code's environment, with no list at all, or one the switch cannot
// rewrite: no switch. The list's path is the only one ever written, settings are never read, and nothing of the list
// (another marketplace's token in any common form, or any other word of it) reaches the store, the state, a log,
// toast, status line, drawn tree or request.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { AUTO_CALM_MS } from '../../plugin/hooks/client/game.ts'
import { CAP, LOCK_WAIT_MS } from '../../plugin/hooks/client/autoswitch.ts'
import type { GameState } from '../../plugin/hooks/client/types.ts'
import { DESK_ART_COLUMNS } from '../../plugin/hooks/ui/band.tsx'
import { KEYS_NOTE } from '../../plugin/hooks/ui/pane-autoupdate.tsx'
import { CLIENT_VERSION } from '../../plugin/hooks/client/remote.ts'
import { KEYS } from '../../plugin/hooks/client/store.ts'
import { ORIGIN, TOKEN, NOW, fakeServer } from './fixtures.ts'
import { BAND, PANE, RUN, SESSION, engine, files, isNode, measure, settle, textOf, walk } from './engine.ts'
import type { Engine, Files } from './engine.ts'
import { LOCK_RE, REGISTRY_RE, cc, leaksIn, list } from './registry.ts'

const LONG = { timeoutMs: 180_000 }
const WIDTHS = [40, 80, 120] as const
const SURFACES = ['terminal', 'desktop'] as const
const ENV = ['DISABLE_UPDATES', 'DISABLE_AUTOUPDATER', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'FORCE_AUTOUPDATE_PLUGINS', 'CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST']
/** The desktop switch's own track: any Svg drawing it is the switch. */
const TRACK = '<rect x="4" y="14" width="40" height="20" rx="10"'

type Mounted = {
  drawn(): Promise<unknown>; press(t: { key: string }): Promise<unknown>; redraw(): Promise<void>; unmount(): Promise<void>
  find(q: { key: string }): Promise<{ props: Record<string, unknown> } | undefined>
  findAll(q: { type: string; in?: string }): Promise<{ key?: string; props: Record<string, unknown> }[]>
  post(data: unknown, o: { in: string }): Promise<unknown>
}
type Clock = ReturnType<typeof mock.clock>

function fits(tree: unknown, columns: number, where: string): void {
  const problems: string[] = []
  if (measure(tree, columns, problems).w > columns) problems.push('overflow')
  const buttons = walk(tree).filter(n => n.type === 'Button')
  const keys = buttons.map(b => b.props?.hotkey).filter((k): k is string => typeof k === 'string')
  if (keys.some((k, i) => keys.indexOf(k) !== i)) problems.push(`keys twice: ${keys.join(' ')}`)
  // a primary is on 1, or (the band's one write on the desktop) on no digit at all
  for (const b of buttons) if (b.props?.variant === 'primary' && b.props?.hotkey !== '1' && !(b.props?.key === 'auto-on' && b.props?.hotkey === undefined)) problems.push('primary off 1')
  // nothing that writes takes the focus by itself, so Enter alone never turns anything on or off
  if (buttons.some(b => b.props?.autoFocus)) problems.push('a button takes the focus')
  expect({ where, problems }).toEqual({ where, problems: [] })
}

/** A switch is drawn on the desktop only with its click region over it, and `want` says whether one is. */
function switchDrawn(tree: unknown, where: string, want: boolean): void {
  const toggles = walk(tree).filter(n => n.type === 'Svg' && String(n.props?.source).includes(TRACK)).length
  const hit = walk(tree).some(n => n.type === 'Client' && n.props?.key === 'auto-switch-hit')
  expect({ where, toggles, hit }).toEqual({ where, toggles: want ? 1 : 0, hit: want })
}

/**
 * What a drawn tree shows `room` cells across: text that truncates is cut at the edge it gets. In a row, what does
 * not shrink keeps its own width (a desktop plate `svg` cells, a Raster its columns) and the rest share what is left.
 */
function shown(n: unknown, room: number, svg: number): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (!isNode(n)) return ''
  const p = n.props ?? {}
  if (n.type === 'Button') return String(p.label ?? '')
  if (n.type === 'Text') {
    const s = [...textOf(n)]
    return String(p.wrap ?? 'wrap').startsWith('truncate') && s.length > room ? s.slice(0, Math.max(0, room - 1)).join('') + '…' : s.join('')
  }
  if (n.type !== 'Box' || p.display === 'none') return ''
  const inner = (typeof p.width === 'number' ? Math.min(p.width, room) : room) - (p.borderStyle ? 2 : 0) - 2 * Number(p.paddingX ?? 0)
  const kids = (n.children ?? []).filter(k => isNode(k) || typeof k === 'string')
  if (!String(p.flexDirection ?? 'row').startsWith('row') || p.flexWrap === 'wrap') return kids.map(k => shown(k, inner, svg)).join('\n')
  const own = (k: unknown) => walk(k).some(x => x.type === 'Svg') ? svg
    : Math.max(0, ...walk(k).filter(x => x.type === 'Raster').map(x => Number(x.props?.columns))) || measure(k, inner, []).w
  const fixed = kids.filter(k => isNode(k) && k.props?.flexShrink === 0)
  const gap = Number(p.columnGap ?? p.gap ?? 0) * Math.max(0, kids.length - 1)
  const left = inner - fixed.reduce((w: number, k) => w + own(k), 0) - gap
  return kids.map(k => shown(k, fixed.includes(k) ? own(k) : Math.floor(left / Math.max(1, kids.length - fixed.length)), svg)).join(' ')
}

/** The guide's ctrl+x tab note comes, in drawing order, before any button of the guide's own. */
function noteFirst(tree: unknown, where: string): void {
  const nodes = walk(tree)
  const note = nodes.findIndex(n => n.type === 'Text' && textOf(n) === KEYS_NOTE)
  const button = nodes.findIndex(n => n.type === 'Button' && /^auto-/.test(String(n.props?.key ?? n.key ?? '')))
  expect({ where, note: note >= 0, first: note >= 0 && (button < 0 || note < button) }).toEqual({ where, note: true, first: true })
}

/** A machine that has played (so the band may offer), with `registry` beside the installed copy. */
async function started($: { session: { start(e: never): Promise<unknown> } }, on: On, registry: Files): Promise<{ clock: Clock; w: Engine; account: () => GameState['account']; moments: () => GameState['moments'] }> {
  const clock = mock.clock(on, { now: NOW })
  const server = fakeServer()
  server.me = { ...server.me, player: { ...server.me.player, battles: 5 } }
  const w = engine(on, server, undefined, registry)
  w.store.set('prefs', { world: 'online', worldOption: 'online', sound: true })
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  w.store.set(`server:${ORIGIN}:meta`, { welcomed: true })
  // this version has run here before: no "is here" in the band ahead of the offer
  w.store.set(KEYS.release, { v: 1, ran: CLIENT_VERSION })
  let account = {} as GameState['account']
  let moments: GameState['moments'] = []
  on('state.set', (_$, e, next) => {
    if (e.key === 'account') account = e.value as GameState['account']
    if (e.key === 'moments') moments = e.value as GameState['moments']
    return next(e)
  })
  await $.session.start(SESSION as never)
  await settle(clock)
  return { clock, w, account: () => account, moments: () => moments }
}

async function press(ui: Mounted, key: string, clock: Clock): Promise<void> {
  await ui.press({ key })
  await settle(clock)
  await ui.redraw()
}

/** The mod named no file but its list (and the list's lock), wrote only the list, read no settings, and only the five update variables. */
function onlyTheList(w: Engine): void {
  for (const call of w.fs) {
    const [method, ...rest] = call.split(' ')
    const path = rest.join(' ')
    const ok = method === 'write' ? REGISTRY_RE.test(path) : (method === 'read' && REGISTRY_RE.test(path)) || (method === 'stat' && (REGISTRY_RE.test(path) || LOCK_RE.test(path)))
    expect({ call, ok }).toEqual({ call, ok: true })
    expect({ call, settings: /settings/i.test(path) }).toEqual({ call, settings: false })
  }
  for (const write of w.files.writes) expect({ path: write.path, list: REGISTRY_RE.test(write.path) }).toEqual({ path: write.path, list: true })
  expect(w.settings).toBe(0)
  for (const name of w.envReads) expect({ name, known: ENV.includes(name) }).toEqual({ name, known: true })
}

/** Nothing of the list is anywhere the mod keeps, says, draws or sends anything. */
function clean(w: Engine, trees: unknown[]): void {
  const seen = {
    store: [...w.store], logs: w.logs, toasts: w.toasts, status: w.status, copied: w.copied, requests: w.requests, trees,
  }
  for (const [where, what] of Object.entries(seen)) expect({ where, leaks: leaksIn(JSON.stringify(what)) }).toEqual({ where, leaks: [] })
}

test('the guide: nothing written before a press, a press as it appears does nothing, On writes once with one chime, Off restores the bytes', LONG, async ($, on) => {
  const original = cc(list())
  const { clock, w, account } = await started($, on, files(original))
  expect(account().autoUpdate).toBe('off')
  expect(await $.command.run(RUN('updates'))).toEqual({})
  await settle(clock)
  const trees: unknown[] = []
  for (const surface of SURFACES) for (const columns of WIDTHS) {
    const where = `off @${columns} ${surface}`
    const ui = await $.ui.mount(PANE(columns, surface)) as unknown as Mounted
    const tree = await ui.drawn()
    trees.push(tree)
    fits(tree, columns, where)
    const text = textOf(tree)
    for (const words of ['Auto-update is off', 'Get new creatures and fixes by themselves.', 'Sets one switch in Claude Code\'s plugin list. Turn it off here anytime.']) {
      expect({ where, words, shown: text.includes(words) }).toEqual({ where, words, shown: true })
    }
    expect({ where, on: (await ui.find({ key: 'auto-on' }))?.props }).toMatchObject({ where, on: { label: 'Turn it on', hotkey: '1', variant: 'primary' } })
    // the steps to do it by hand are the terminal's /plugin menu; the desktop's /plugin has no such toggle, and the
    // press does it all there
    expect({ where, steps: (await ui.find({ key: 'auto-steps' }))?.props.label }).toEqual({ where, steps: surface === 'terminal' ? 'Show steps' : undefined })
    if (surface === 'desktop') {
      expect({ where, art: walk(tree).some(n => n.type === 'Svg' && n.props?.alt === 'Auto-update is off') }).toEqual({ where, art: true })
      expect({ where, hit: walk(tree).some(n => n.type === 'Client' && n.props?.key === 'auto-switch-hit') }).toEqual({ where, hit: true })
    }
    await ui.unmount()
  }
  expect(w.files.writes).toEqual([])
  const chimes = w.sounds.length
  const ui = await $.ui.mount(PANE(80, 'terminal')) as unknown as Mounted
  // Show steps opens the three /plugin steps in place, and writes nothing
  await press(ui, 'auto-steps', clock)
  expect(textOf(await ui.drawn())).toMatch(/Choose Enable auto-update/)
  expect((await ui.find({ key: 'auto-steps' }))?.props.label).toBe('Hide steps')
  // a key as the guide appears does nothing
  await press(ui, 'auto-on', clock)
  expect(w.files.writes).toEqual([])
  await clock.advance(AUTO_CALM_MS)
  await press(ui, 'auto-on', clock)
  expect(w.files.writes.length).toBe(1)
  expect(w.files.writes[0]!.text).toBe(cc(list({ autoUpdate: true })))
  expect(account().autoUpdate).toBe('on')
  expect(account().autoUpdateOurs).toBe(true)
  expect(w.sounds.length).toBe(chimes + 1)
  let tree = await ui.drawn()
  trees.push(tree)
  expect(textOf(tree)).toMatch(/Auto-update is on/)
  expect(textOf(tree)).toMatch(/Claude Code checks for a new Spinlings each time it starts\./)
  expect((await ui.find({ key: 'auto-done' }))?.props.hotkey).toBe('1')
  expect((await ui.find({ key: 'auto-off' }))?.props).toMatchObject({ label: 'Turn it off', hotkey: '2' })
  expect(await ui.find({ key: 'auto-on' })).toBeUndefined()
  await ui.unmount()
  // on: every surface and width draws the payoff, and 1 is Done, which writes nothing
  for (const surface of SURFACES) for (const columns of WIDTHS) {
    const where = `on @${columns} ${surface}`
    const again = await $.ui.mount(PANE(columns, surface)) as unknown as Mounted
    const drawn = await again.drawn()
    trees.push(drawn)
    fits(drawn, columns, where)
    if (surface === 'desktop') expect({ where, art: walk(drawn).some(n => n.type === 'Svg' && n.props?.alt === 'Auto-update is on') }).toEqual({ where, art: true })
    await again.unmount()
  }
  await $.command.run(RUN('updates'))
  await settle(clock)
  await clock.advance(AUTO_CALM_MS)
  const second = await $.ui.mount(PANE(80, 'desktop')) as unknown as Mounted
  expect(await second.find({ key: 'auto-on' })).toBeUndefined()
  await press(second, 'auto-done', clock)
  expect(w.files.writes.length).toBe(1)
  expect(w.sounds.length).toBe(chimes + 1)
  await second.unmount()
  // Turn it off: exactly the key goes, so the list reads byte for byte as Claude Code left it
  await $.command.run(RUN('updates'))
  await settle(clock)
  await clock.advance(AUTO_CALM_MS)
  const off = await $.ui.mount(PANE(80, 'terminal')) as unknown as Mounted
  await press(off, 'auto-off', clock)
  expect(w.files.writes.length).toBe(2)
  expect(w.files.text).toBe(original)
  expect(account().autoUpdate).toBe('off')
  tree = await off.drawn()
  trees.push(tree)
  expect(textOf(tree)).toMatch(/Claude Code's plugin list is back as it was\./)
  expect((await off.find({ key: 'auto-on' }))?.props).toMatchObject({ label: 'Turn it on', hotkey: '2' })
  expect(w.sounds.length).toBe(chimes + 1)
  await off.unmount()
  onlyTheList(w)
  clean(w, trees)
})

test('the band\'s offer never writes from a digit: on the terminal 1 opens the guide without the keyboard', LONG, async ($, on) => {
  const { clock, w, moments } = await started($, on, files(cc(list())))
  // the first heartbeat makes the offer
  for (let i = 0; i < 30 && !moments().some(m => m.kind === 'auto-update'); i++) await clock.advance(60_000)
  expect(moments().some(m => m.kind === 'auto-update')).toBe(true)
  await clock.advance(AUTO_CALM_MS)
  const trees: unknown[] = []
  for (const surface of SURFACES) for (const columns of WIDTHS) {
    const band = await $.ui.mount(BAND(columns, surface)) as unknown as Mounted
    const tree = await band.drawn()
    trees.push(tree)
    const where = `offer @${columns} ${surface}`
    fits(tree, columns, where)
    // a digit an empty prompt hands the band may be an answer for Claude: no Button that writes carries one
    const write = await band.find({ key: 'auto-on' })
    if (surface === 'terminal') {
      expect({ where, write }).toEqual({ where, write: undefined })
      expect({ where, how: (await band.find({ key: 'auto-how' }))?.props }).toMatchObject({ where, how: { hotkey: '1', label: columns >= 80 ? 'Turn on auto-update…' : 'Turn on…' } })
    } else {
      expect({ where, write: write?.props }).toMatchObject({ where, write: { label: columns >= 80 ? 'Turn on auto-update' : 'Turn on', variant: 'primary' } })
      expect({ where, digit: write?.props.hotkey }).toEqual({ where, digit: undefined })
    }
    await band.unmount()
  }
  // the terminal's 1: the guide, beside the prompt, with nothing written and the keyboard left where it was
  const opens = w.opens.length
  const band = await $.ui.mount(BAND(80, 'terminal')) as unknown as Mounted
  await press(band, 'auto-how', clock)
  expect(w.files.writes).toEqual([])
  expect(w.opens.slice(opens)).toEqual([false])
  await band.unmount()
  // the guide it opened, not focused: it says how to hand it the keys, right under the chip and before anything to
  // press, so even a short pane that cannot scroll yet shows it; with the steps open too
  const unfocused = (columns: number) => ({ ...PANE(columns, 'terminal'), props: { ...PANE(columns, 'terminal').props, isFocused: false } })
  const pane = await $.ui.mount(unfocused(80)) as unknown as Mounted
  const tree = await pane.drawn()
  trees.push(tree)
  expect(textOf(tree)).toMatch(/Press ctrl\+x tab to use the keys here\./)
  noteFirst(tree, 'unfocused @80')
  await pane.unmount()
  const opener = await $.ui.mount(PANE(40, 'terminal')) as unknown as Mounted
  await press(opener, 'auto-steps', clock)
  await opener.unmount()
  const narrow = await $.ui.mount(unfocused(40)) as unknown as Mounted
  const open = await narrow.drawn()
  trees.push(open)
  expect(textOf(open)).toMatch(/Choose Enable auto-update/)
  noteFirst(open, 'unfocused @40, the steps open')
  await narrow.unmount()
  const focused = await $.ui.mount(PANE(80, 'terminal')) as unknown as Mounted
  expect(textOf(await focused.drawn())).not.toMatch(/ctrl\+x tab/)
  await focused.unmount()
  onlyTheList(w)
  clean(w, trees)
})

test('the desktop band\'s Turn on auto-update writes once on a click, after its own pause, and the lead sparkles with where to turn it off', LONG, async ($, on) => {
  const { clock, w, account, moments } = await started($, on, files(cc(list())))
  for (let i = 0; i < 30 && !moments().some(m => m.kind === 'auto-update'); i++) await clock.advance(60_000)
  expect(moments().some(m => m.kind === 'auto-update')).toBe(true)
  const chimes = w.sounds.length
  const band = await $.ui.mount(BAND(80, 'desktop')) as unknown as Mounted
  await band.press({ key: 'auto-on' })
  await settle(clock)
  expect(w.files.writes).toEqual([])
  await clock.advance(AUTO_CALM_MS)
  await band.redraw()
  await band.press({ key: 'auto-on' })
  await settle(clock)
  expect(w.files.writes.length).toBe(1)
  expect(account().autoUpdate).toBe('on')
  expect(moments().some(m => m.kind === 'auto-update')).toBe(false)
  expect(moments().some(m => m.kind === 'auto-on')).toBe(true)
  expect(w.sounds.length).toBe(chimes + 1)
  await band.unmount()
  const trees: unknown[] = []
  for (const surface of SURFACES) for (const columns of WIDTHS) {
    const payoff = await $.ui.mount(BAND(columns, surface)) as unknown as Mounted
    const tree = await payoff.drawn()
    trees.push(tree)
    const where = `payoff @${columns} ${surface}`
    fits(tree, columns, where)
    expect({ where, says: /✓ Auto-update is on[\s\S]*Turn it off .*in \/spin updates|Off: \/spin updates/.test(textOf(tree)) }).toEqual({ where, says: true })
    // the command the line points to is never cut, beside the art at any width
    expect({ where, whole: shown(tree, columns, DESK_ART_COLUMNS).includes('/spin updates') }).toEqual({ where, whole: true })
    expect({ where, art: walk(tree).some(n => n.type === (surface === 'terminal' ? 'Raster' : 'Svg')) }).toEqual({ where, art: true })
    await payoff.unmount()
  }
  onlyTheList(w)
  clean(w, trees)
})

test('on the desktop the switch itself is a control: a click on it turns it on once, through the same pause', LONG, async ($, on) => {
  const { clock, w, account } = await started($, on, files(cc(list())))
  await $.command.run(RUN('updates'))
  await settle(clock)
  const ui = await $.ui.mount(PANE(80, 'desktop')) as unknown as Mounted
  const hit = (await ui.findAll({ type: 'Client' })).find(n => n.key === 'auto-switch-hit')
  expect(hit).toBeDefined()
  // assistive tech names the control by what a click on it does
  expect((await ui.findAll({ type: 'Svg', in: hit!.key! })).map(n => n.props.alt)).toEqual(['Turn on auto-update'])
  // a click as the guide appears does nothing
  await ui.post(null, { in: hit!.key! })
  await settle(clock)
  expect(w.files.writes).toEqual([])
  await clock.advance(AUTO_CALM_MS)
  await ui.redraw()
  await ui.post(null, { in: (await ui.findAll({ type: 'Client' })).find(n => n.key === 'auto-switch-hit')!.key! })
  await settle(clock)
  expect(w.files.writes.length).toBe(1)
  expect(account().autoUpdate).toBe('on')
  await ui.redraw()
  // once on, the check is art only: nothing left to press there
  expect((await ui.findAll({ type: 'Client' })).some(n => n.key === 'auto-switch-hit')).toBe(false)
  await ui.unmount()
  onlyTheList(w)
  clean(w, [])
})

test('on the desktop a switch is drawn only where a click on it does something: after a busy press it is Try again', LONG, async ($, on) => {
  const registry = files(cc(list()))
  // a save of Claude Code's that outlasts the press
  registry.lock = { mtimeMs: NOW }
  const { clock, w, account } = await started($, on, registry)
  await $.command.run(RUN('updates'))
  await settle(clock)
  await clock.advance(AUTO_CALM_MS)
  const ui = await $.ui.mount(PANE(80, 'desktop')) as unknown as Mounted
  switchDrawn(await ui.drawn(), 'off', true)
  await ui.press({ key: 'auto-on' })
  await clock.advance(LOCK_WAIT_MS + 1000)
  await settle(clock)
  await ui.redraw()
  const busy = await ui.drawn()
  expect(textOf(busy)).toMatch(/Claude Code was saving its plugin list\. Try again\./)
  switchDrawn(busy, 'busy', true)
  expect((await ui.findAll({ type: 'Svg', in: 'auto-switch-hit' })).map(n => n.props.alt)).toEqual(['Turn on auto-update'])
  expect(w.files.writes).toEqual([])
  // the save is over: a click on the switch, after the pause, is Try again
  registry.lock = null
  await clock.advance(AUTO_CALM_MS)
  await ui.redraw()
  await ui.post(null, { in: 'auto-switch-hit' })
  await settle(clock)
  expect(w.files.writes.length).toBe(1)
  expect(account().autoUpdate).toBe('on')
  await ui.unmount()
  onlyTheList(w)
  clean(w, [busy])
})

test('a list the switch cannot rewrite: Couldn\'t change it from here, the steps, and no switch to click', LONG, async ($, on) => {
  // past the switch's size cap, so a press stops at the look before any write
  const registry = files(cc({ ...list(), pad: 'x'.repeat(CAP) }))
  const { clock, w, account } = await started($, on, registry)
  expect(account().autoUpdate).toBe('off')
  await $.command.run(RUN('updates'))
  await settle(clock)
  await clock.advance(AUTO_CALM_MS)
  const ui = await $.ui.mount(PANE(80, 'desktop')) as unknown as Mounted
  await press(ui, 'auto-on', clock)
  expect(registry.writes).toEqual([])
  await ui.unmount()
  const trees: unknown[] = []
  for (const surface of SURFACES) for (const columns of WIDTHS) {
    const where = `cannot @${columns} ${surface}`
    const drawn = await $.ui.mount(PANE(columns, surface)) as unknown as Mounted
    const tree = await drawn.drawn()
    trees.push(tree)
    fits(tree, columns, where)
    const says = surface === 'terminal' ? /Couldn't change it from here\. In \/plugin:[\s\S]*Choose Enable auto-update/
      : /Couldn't change it from here\. Turn it on by hand:[\s\S]*In Claude Code in a terminal: \/plugin, then Marketplaces, then spinlings, then Enable auto-update/
    expect({ where, says: says.test(textOf(tree)) }).toEqual({ where, says: true })
    if (surface === 'desktop') switchDrawn(tree, where, false)
    await drawn.unmount()
  }
  onlyTheList(w)
  clean(w, trees)
})

const NO_SWITCH: [string, () => Files, RegExp][] = [
  ['turned off in /plugin', () => files(cc(list({ autoUpdate: false }))), /Auto-update was turned off in Claude Code\. To turn it back on:/],
  ['held by the environment', () => files(cc(list()), { DISABLE_UPDATES: '1' }), /Auto-update can't run here[\s\S]*Claude Code's updates are turned off on this computer\./],
  ['no list at all', () => files(null), /Auto-update: can't tell from here/],
]

for (const [name, make, says] of NO_SWITCH) {
  test(`${name}: no switch on any surface, the band never asks, and nothing is written`, LONG, async ($, on) => {
    const registry = make()
    const { clock, w, moments } = await started($, on, registry)
    await clock.advance(30 * 60_000)
    expect(moments().some(m => m.kind === 'auto-update')).toBe(false)
    await $.command.run(RUN('updates'))
    await settle(clock)
    await clock.advance(AUTO_CALM_MS)
    const trees: unknown[] = []
    for (const surface of SURFACES) for (const columns of WIDTHS) {
      const where = `${name} @${columns} ${surface}`
      const ui = await $.ui.mount(PANE(columns, surface)) as unknown as Mounted
      const tree = await ui.drawn()
      trees.push(tree)
      fits(tree, columns, where)
      expect({ where, says: says.test(textOf(tree)) }).toEqual({ where, says: true })
      expect({ where, on: await ui.find({ key: 'auto-on' }), off: await ui.find({ key: 'auto-off' }) }).toEqual({ where, on: undefined, off: undefined })
      // nothing here can change it, so no switch is drawn that a click would do nothing on
      if (surface === 'desktop') switchDrawn(tree, where, false)
      await ui.unmount()
    }
    expect(registry.writes).toEqual([])
    onlyTheList(w)
    clean(w, trees)
  })
}

// /spin updates and what's new (SPEC 32): every state of the version card and every way to get a release, on the
// desktop first, then the terminal and an editor, at 40, 80 and 120 columns. One primary on 1, keys once each, the way
// out whole, every highlight whole, the link to every release, one picture at most (the card's badge for out, needed
// and here), one /plugin step list at most and each surface's own (the terminal's menu; the desktop's plugin page;
// the command elsewhere), the ctrl+x tab note before anything to press, the feedback right under the action, the
// version plain inside, no note above. Then the band's "is out" and "is here", through the wired mod: whole labels,
// 1 opens the guide without the keyboard, 2 closes it for good, and no labels from a community server.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { ReleaseNote } from '../../plugin/hooks/core/api.ts'
import { releaseOf } from '../../plugin/hooks/core/releases.ts'
import { CLIENT_VERSION, UPDATE_COMMAND } from '../../plugin/hooks/client/remote.ts'
import { KEYS } from '../../plugin/hooks/client/store.ts'
import type { Actions, El, GameState } from '../../plugin/hooks/client/types.ts'
import { band } from '../../plugin/hooks/ui/band.tsx'
import { pane } from '../../plugin/hooks/ui/pane.tsx'
import { KEYS_NOTE } from '../../plugin/hooks/ui/pane-autoupdate.tsx'
import { SCENE_NOTES, uiScenes } from './ui-scenes.ts'
import { BAND, PANE, SESSION, engine, measure, settle, textOf, walk } from './engine.ts'
import type { Node } from './engine.ts'
import { NEXT, NOW, ORIGIN, TOKEN, fakeServer } from './fixtures.ts'

const LONG = { timeoutMs: 180_000 }
const WIDTHS = [40, 80, 120] as const
const SURFACES = ['desktop', 'terminal'] as const
const NEWER = SCENE_NOTES[0]!.version
const mine = CLIENT_VERSION.replace(/\./g, '\\.')

type Probe = { state: GameState; calls: [string, unknown[]][]; focused: boolean }
const scene = (title: string) => JSON.parse(JSON.stringify(uiScenes(NOW).find(s => s.title === title)!.state)) as GameState

function actions(p: Probe): Actions {
  return new Proxy({}, { get: (_, name) => async (...args: unknown[]) => { p.calls.push([String(name), args]) } }) as Actions
}

function draws(on: On, p: Probe): void {
  on('ui.render', { component: 'Pane', requestId: 'probe' }, async ($, e) => pane({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows, now: NOW,
    actions: actions(p), focused: p.focused, placement: 'inline', state: p.state,
  }))
  on('ui.render', { component: 'AbovePrompt', requestId: 'band-probe' }, async ($, e) => band({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.maxRows, now: NOW,
    actions: actions(p), isWorking: true, state: p.state,
  }) ?? { type: 'Text', props: {}, children: ['engine band'] })
}

const MOUNT = (columns: number, surface: (typeof SURFACES)[number]) => ({ ...PANE(columns, surface), requestId: 'probe' })
const BAND_MOUNT = (columns: number, surface: (typeof SURFACES)[number]) => ({ ...BAND(columns, surface), requestId: 'band-probe' })
const keyOf = (n: Node) => String(n.key ?? n.props?.key ?? '')
const buttons = (tree: unknown) => walk(tree).filter(n => n.type === 'Button')
/** The pane's tree, drawn without an engine: element names for elements, so any surface draws. */
const ANY_EL = new Proxy({}, { get: (_, k) => String(k) }) as unknown as El

/** Every state of the card: its headline, the one primary's label, and the desktop badge's words (null: none). */
type Row = { title: string; head: RegExp; primary: string; badge: string | null; release: string; notes: ReleaseNote | null }
const OUT = SCENE_NOTES[0]!
const HERE = releaseOf(CLIENT_VERSION)
const ROWS: Row[] = [
  { title: 'Updates · needed to keep playing online', head: /Update to keep playing online/, primary: 'Copy', badge: 'Update needed to play online', release: NEWER, notes: OUT },
  { title: 'Updates · needed, the switch could not change it', head: /Update to keep playing online/, primary: 'Copy', badge: 'Update needed to play online', release: NEWER, notes: OUT },
  { title: 'Updates · needed, the plugin list did not save', head: /Update to keep playing online/, primary: 'Copy folder', badge: 'Update needed to play online', release: NEWER, notes: OUT },
  { title: 'Updates · needed, nothing newer named', head: new RegExp(`Update to keep playing online[\\s\\S]*You have ${mine}`), primary: 'Copy', badge: 'Update needed to play online', release: CLIENT_VERSION, notes: null },
  { title: 'Updates · out, auto-update brings it', head: new RegExp(`Spinlings ${NEWER.replace(/\./g, '\\.')} is out[\\s\\S]*You have ${mine} · it arrives by itself the next time Claude Code starts`), primary: 'Done', badge: `Spinlings ${NEWER} is out`, release: NEWER, notes: OUT },
  { title: 'Updates · out, one press to turn auto-update on', head: new RegExp(`Spinlings ${NEWER.replace(/\./g, '\\.')} is out[\\s\\S]*You have ${mine}`), primary: 'Turn it on', badge: `Spinlings ${NEWER} is out`, release: NEWER, notes: OUT },
  { title: 'Updates · out, the plugin list did not save', head: /is out/, primary: 'Copy folder', badge: `Spinlings ${NEWER} is out`, release: NEWER, notes: OUT },
  { title: 'Updates · out, auto-update turned off in /plugin', head: /is out/, primary: 'Copy', badge: `Spinlings ${NEWER} is out`, release: NEWER, notes: OUT },
  { title: 'Updates · out, auto-update not known', head: /is out/, primary: 'Copy', badge: `Spinlings ${NEWER} is out`, release: NEWER, notes: OUT },
  { title: 'Updates · out, on a community server', head: /is out/, primary: 'Turn it on', badge: `Spinlings ${NEWER} is out`, release: NEWER, notes: null },
  { title: 'Updates · here, just updated', head: new RegExp(`Spinlings ${mine} is here[\\s\\S]*Up to date · checked today`), primary: 'Turn it on', badge: `Spinlings ${CLIENT_VERSION} is here`, release: CLIENT_VERSION, notes: HERE },
  { title: 'Updates · here, before the first check', head: new RegExp(`Spinlings ${mine} is here[\\s\\S]*Asking spinlings\\.dev…`), primary: 'Done', badge: `Spinlings ${CLIENT_VERSION} is here`, release: CLIENT_VERSION, notes: HERE },
  { title: 'Updates · here, offline', head: new RegExp(`Spinlings ${mine} is here[\\s\\S]*Playing offline`), primary: 'Turn it on', badge: `Spinlings ${CLIENT_VERSION} is here`, release: CLIENT_VERSION, notes: HERE },
  { title: 'Updates · up to date, checked yesterday', head: new RegExp(`✓Up to date· Spinlings ${mine}· checked yesterday`), primary: 'Done', badge: null, release: CLIENT_VERSION, notes: HERE },
  { title: 'Auto-update · the steps offline', head: new RegExp(`Spinlings ${mine} · playing offline`), primary: 'Copy', badge: null, release: CLIENT_VERSION, notes: HERE },
  { title: 'Updates · asking the server', head: new RegExp(`Spinlings ${mine} · asking spinlings\\.dev…`), primary: 'Turn it on', badge: null, release: CLIENT_VERSION, notes: HERE },
  { title: 'Updates · the server is out of reach', head: new RegExp(`Spinlings ${mine} · can't reach spinlings\\.dev right now`), primary: 'Turn it on', badge: null, release: CLIENT_VERSION, notes: HERE },
  { title: 'Updates · the server names no newest version', head: new RegExp(`Spinlings ${mine} · spinlings\\.dev doesn't say which version is newest`), primary: 'Copy', badge: null, release: CLIENT_VERSION, notes: HERE },
]

/** What every screen holds to, whatever its state. */
function holds(tree: unknown, columns: number, where: string, row: Row, surface: string): void {
  const problems: string[] = []
  if (measure(tree, columns, problems).w > columns) problems.push('overflow')
  const all = buttons(tree)
  const keys = all.map(b => b.props?.hotkey).filter((k): k is string => typeof k === 'string')
  if (keys.some((k, i) => keys.indexOf(k) !== i)) problems.push(`keys twice: ${keys.join(' ')}`)
  const primary = all.filter(b => b.props?.variant === 'primary')
  if (primary.length !== 1 || primary[0]!.props?.hotkey !== '1') problems.push(`primaries: ${primary.map(b => `${b.props?.hotkey}:${b.props?.label}`).join(', ')}`)
  else if (primary[0]!.props?.label !== row.primary) problems.push(`primary ${String(primary[0]!.props?.label)}, not ${row.primary}`)
  if (keys.filter(k => k !== '1').length > 2) problems.push(`keys ${keys.join(' ')}`)
  if (!all.some(b => keyOf(b) === 'pane-back' && b.props?.label === 'Back')) problems.push('no whole way out')
  if (all.some(b => b.props?.autoFocus)) problems.push('a button takes the focus')
  const text = textOf(tree)
  if (!row.head.test(text)) problems.push(`no headline ${row.head}`)
  // every highlight whole, never cut
  for (const h of row.notes?.highlights ?? []) if (!text.includes(h.short) || !text.includes(h.text)) problems.push(`highlight ${h.short} not whole`)
  if (!row.notes && /New in /.test(text)) problems.push('notes it should not show')
  // the link to every release, at the release on show
  const href = `https://spinlings.dev/whats-new#v${row.release}`
  const link = walk(tree).find(n => n.type === 'Link')
  if (link?.props?.href !== href) problems.push(`link ${String(link?.props?.href)}`)
  if (surface === 'terminal' ? !text.includes('Every release: spinlings.dev/whats-new') : textOf(link) !== 'Every release') problems.push('link words')
  // one picture at most: the card's badge where it has one
  const svgs = walk(tree).filter(n => n.type === 'Svg')
  if (svgs.length > 1) problems.push(`${svgs.length} pictures`)
  if (surface === 'desktop' && row.badge && svgs[0]?.props?.alt !== row.badge) problems.push(`badge ${String(svgs[0]?.props?.alt)}`)
  if (surface === 'desktop' && row.badge && (svgs[0]?.props?.width !== 48 || svgs[0]?.props?.height !== 48)) problems.push('badge not 48 px')
  // one /plugin step list at most
  if (walk(tree).filter(n => keyOf(n) === 'auto-step-0').length > 1) problems.push('two step lists')
  // inside, the version is plain words, and the screen says how it stands itself: no note above
  if (all.some(b => keyOf(b) === 'version' || keyOf(b) === 'link-update')) problems.push('a chip or a note inside the guide')
  if (!walk(tree).some(n => n.type === 'Text' && textOf(n) === `v${CLIENT_VERSION}`)) problems.push('no plain version')
  expect({ where, problems }).toEqual({ where, problems: [] })
}

test('every state of the card, on the desktop and the terminal at 40, 80 and 120', LONG, async ($, on) => {
  const p: Probe = { state: scene(ROWS[0]!.title), calls: [], focused: true }
  draws(on, p)
  for (const surface of SURFACES) for (const row of ROWS) for (const columns of WIDTHS) {
    p.state = scene(row.title)
    const ui = await $.ui.mount(MOUNT(columns, surface))
    holds(await ui.drawn(), columns, `${row.title} @${columns} ${surface}`, row, surface)
    await ui.unmount()
  }
})

test('the update steps are each surface\'s own: the terminal\'s /plugin menu, the desktop\'s plugin page, the command elsewhere', LONG, async ($, on) => {
  const p: Probe = { state: scene('Updates · out, auto-update not known'), calls: [], focused: true }
  draws(on, p)
  for (const surface of SURFACES) for (const columns of WIDTHS) {
    const ui = await $.ui.mount(MOUNT(columns, surface))
    const tree = await ui.drawn()
    const where = `steps @${columns} ${surface}`
    const steps = walk(tree).filter(n => /^auto-step-\d$/.test(keyOf(n))).map(textOf).join('\n')
    if (surface === 'terminal') {
      // one trip through /plugin: Update now under Installed, and on the way out the toggle the switch could not set
      expect({ where, installed: /Open Installed, pick Spinlings, choose Update now/.test(steps), toggle: /Enable auto-update/.test(steps), close: /Then close the menu\./.test(textOf(tree)) })
        .toEqual({ where, installed: true, toggle: true, close: true })
    } else {
      // the desktop answers /plugin with its own page: its Update button, no Installed tab, no Update now, no toggle
      expect({ where, page: /Type \/plugin, pick Spinlings[\s\S]*Press Update/.test(steps), installed: /Installed|Update now|Enable auto-update/.test(steps), reload: /loads by itself between turns/.test(textOf(tree)) })
        .toEqual({ where, page: true, installed: false, reload: true })
    }
    expect({ where, copy: (await ui.find({ key: 'update-copy' }))?.props }).toMatchObject({ where, copy: { hotkey: '1', variant: 'primary', label: 'Copy' } })
    await ui.unmount()
  }
  // turned off on purpose, or held: the steps, without the toggle
  for (const title of ['Updates · out, auto-update turned off in /plugin', 'Updates · out, updates held here']) {
    p.state = scene(title)
    const ui = await $.ui.mount(MOUNT(80, 'terminal'))
    expect({ title, toggle: /Enable auto-update/.test(textOf(await ui.drawn())) }).toEqual({ title, toggle: false })
    await ui.unmount()
  }
  const ui = await $.ui.mount(MOUNT(80, 'terminal'))
  await ui.press({ key: 'update-copy', plugin: 'test' })
  expect(p.calls.at(-1)).toEqual(['autoUpdate', ['copy']])
  await ui.unmount()
})

test('in an editor or on the phone, where /plugin is not at hand: the command, in a terminal, with Copy command', () => {
  for (const surface of ['vscode', 'mobile'] as const) for (const columns of WIDTHS) {
    const state = scene('Updates · needed to keep playing online')
    const tree = pane({ el: ANY_EL, surface, columns, rows: 40, now: NOW, actions: actions({ state, calls: [], focused: true }), focused: true, placement: 'inline', state })
    const where = `${surface} @${columns}`
    const text = textOf(tree)
    expect({ where, command: text.includes(`In a terminal: ${UPDATE_COMMAND}`), reload: text.includes('Then run /reload-plugins.'), menu: /Installed|Press Update/.test(text) })
      .toEqual({ where, command: true, reload: true, menu: false })
    const copy = walk(tree).find(n => keyOf(n) === 'update-copy')
    expect({ where, copy: copy?.props?.label, key: copy?.props?.hotkey, primary: copy?.props?.variant }).toEqual({ where, copy: 'Copy command', key: '1', primary: 'primary' })
  }
})

test('the layouts: on and able says it all, one press with Update now beside it, the steps open, and needed leads with them', LONG, async ($, on) => {
  const p: Probe = { state: scene('Updates · out, auto-update brings it'), calls: [], focused: true }
  draws(on, p)
  for (const surface of SURFACES) for (const columns of WIDTHS) {
    const where = (l: string) => `${l} @${columns} ${surface}`
    // (a) on and able: no steps, nothing to switch, no way to turn it off between the news and its notes; Done
    p.state = scene('Updates · out, auto-update brings it')
    let ui = await $.ui.mount(MOUNT(columns, surface))
    let tree = await ui.drawn()
    expect({ where: where('a'), steps: !!(await ui.find({ key: 'update-copy' })), on: !!(await ui.find({ key: 'auto-on' })), copy: (await ui.find({ key: 'auto-copy-off' }))?.props.hotkey, off: /To turn it off/.test(textOf(tree)) })
      .toEqual({ where: where('a'), steps: false, on: false, copy: undefined, off: false })
    await ui.unmount()
    // where the switch put it there, Turn it off is one press, so it stays
    p.state = scene('Updates · out, auto-update brings it (turned on here)')
    ui = await $.ui.mount(MOUNT(columns, surface))
    expect({ where: where('a ours'), off: (await ui.find({ key: 'auto-off' }))?.props.hotkey }).toEqual({ where: where('a ours'), off: '2' })
    await ui.unmount()
    // (b) off by default and writable: Turn it on, its line saying the release comes the next start, Update now on 2
    p.state = scene('Updates · out, one press to turn auto-update on')
    ui = await $.ui.mount(MOUNT(columns, surface))
    tree = await ui.drawn()
    expect({ where: where('b'), line: textOf(tree).includes(`and ${NEWER} arrives by itself the next time Claude Code starts.`), hand: (await ui.find({ key: 'update-hand' }))?.props })
      .toMatchObject({ where: where('b'), line: true, hand: { label: 'Update now', hotkey: '2', dimColor: true } })
    expect({ where: where('b'), steps: await ui.find({ key: 'update-copy' }) }).toEqual({ where: where('b'), steps: undefined })
    await ui.press({ key: 'update-hand', plugin: 'test' })
    expect(p.calls.at(-1)?.[0]).toBe('pane')
    await ui.unmount()
    p.state = scene('Updates · out, the update steps open')
    ui = await $.ui.mount(MOUNT(columns, surface))
    expect({ where: where('b open'), hand: (await ui.find({ key: 'update-hand' }))?.props.label, copy: (await ui.find({ key: 'update-copy' }))?.props.hotkey })
      .toEqual({ where: where('b open'), hand: 'Hide steps', copy: '3' })
    await ui.unmount()
    // a press under way: the line says so, and nothing is there to press twice
    p.state = scene('Updates · out, turning auto-update on')
    ui = await $.ui.mount(MOUNT(columns, surface))
    tree = await ui.drawn()
    expect({ where: where('b pressing'), says: textOf(tree).includes('Turning on…'), on: await ui.find({ key: 'auto-on' }) }).toEqual({ where: where('b pressing'), says: true, on: undefined })
    await ui.unmount()
    // the switch could not do it: the steps, open, on the terminal its toggle as the third step, and under the chip
    // a line that says so and where it can be done; the same where this version can't play online
    for (const title of ['Updates · out, the switch could not change it', 'Updates · needed, the switch could not change it']) {
      p.state = scene(title)
      ui = await $.ui.mount(MOUNT(columns, surface))
      tree = await ui.drawn()
      const text = textOf(tree)
      const why = surface === 'terminal' ? 'Couldn\'t turn it on from here. Step ❸ does it.'
        : 'Couldn\'t turn it on from here. In Claude Code in a terminal: /plugin, then Marketplaces, then spinlings, then Enable auto-update'
      expect({ where: where(title), copy: (await ui.find({ key: 'update-copy' }))?.props.hotkey, third: /While you're there/.test(text), on: await ui.find({ key: 'auto-on' }), why: text.includes(why) })
        .toEqual({ where: where(title), copy: '1', third: surface === 'terminal', on: undefined, why: true })
      await ui.unmount()
    }
    // (d) needed: the steps first and open, then the switch, quietly, on 2
    p.state = scene('Updates · needed to keep playing online')
    ui = await $.ui.mount(MOUNT(columns, surface))
    tree = await ui.drawn()
    const order = walk(tree).map(keyOf)
    expect({ where: where('d'), on: (await ui.find({ key: 'auto-on' }))?.props, first: order.indexOf('update-copy') < order.indexOf('auto-on') })
      .toMatchObject({ where: where('d'), on: { hotkey: '2', dimColor: true }, first: true })
    expect({ where: where('d'), says: textOf(tree).includes('Then each new Spinlings arrives by itself when Claude Code starts.') }).toEqual({ where: where('d'), says: true })
    await ui.unmount()
  }
})

test('a press that left the plugin list unreadable: putting it right comes first, out or needed, and no /plugin steps', LONG, async ($, on) => {
  const p: Probe = { state: scene('Updates · out, the plugin list did not save'), calls: [], focused: true }
  draws(on, p)
  for (const title of ['Updates · out, the plugin list did not save', 'Updates · needed, the plugin list did not save']) for (const surface of SURFACES) for (const columns of WIDTHS) {
    p.state = scene(title)
    const ui = await $.ui.mount(MOUNT(columns, surface))
    const tree = await ui.drawn()
    const text = textOf(tree)
    const where = `${title} @${columns} ${surface}`
    // Claude Code refuses /plugin while its list does not parse: the folder and the command that adds Spinlings back
    expect({ where, why: text.includes('Claude Code can\'t read its plugin list now.'), delete: text.includes('Delete known_marketplaces.json from this folder:'), folder: text.includes('/Users/sam/.claude/plugins') })
      .toEqual({ where, why: true, delete: true, folder: true })
    // /plugin runs only in Claude Code in a terminal: on the desktop the shell's command, in a terminal
    expect({ where, add: addStep(text) }).toEqual({ where, add: surface === 'terminal' ? 'in Claude Code' : 'in a terminal' })
    expect({ where, folder: (await ui.find({ key: 'auto-copy-folder' }))?.props, add: (await ui.find({ key: 'auto-copy-add' }))?.props.hotkey })
      .toMatchObject({ where, folder: { label: 'Copy folder', hotkey: '1', variant: 'primary' }, add: '2' })
    // no way through /plugin: no update copy, no Update now, no switch, no picture of a menu that would refuse
    const pictures = walk(tree).filter(n => /^update-shot-/.test(keyOf(n))).length
    expect({ where, copy: await ui.find({ key: 'update-copy' }), hand: await ui.find({ key: 'update-hand' }), on: await ui.find({ key: 'auto-on' }), pictures, menu: /Installed|Update now|Press Update|Enable auto-update|Then close the menu/.test(text) })
      .toEqual({ where, copy: undefined, hand: undefined, on: undefined, pictures: 0, menu: false })
    await ui.unmount()
  }
  const ui = await $.ui.mount(MOUNT(80, 'desktop'))
  await ui.press({ key: 'auto-copy-folder', plugin: 'test' })
  expect(p.calls.at(-1)).toEqual(['autoUpdate', ['copy-folder']])
  await ui.press({ key: 'auto-copy-add', plugin: 'test' })
  expect(p.calls.at(-1)).toEqual(['autoUpdate', ['copy-add-shell']])
  await ui.unmount()
  // in an editor, which refuses /plugin as well, drawn without an engine
  for (const title of ['Updates · out, the plugin list did not save', 'Updates · needed, the plugin list did not save']) for (const columns of WIDTHS) {
    const state = scene(title)
    const tree = pane({ el: ANY_EL, surface: 'vscode', columns, rows: 40, now: NOW, actions: actions({ state, calls: [], focused: true }), focused: true, placement: 'inline', state })
    const where = `${title} @${columns} vscode`
    expect({ where, add: addStep(textOf(tree)), menu: /Installed|Update now|Press Update|Enable auto-update/.test(textOf(tree)) }).toEqual({ where, add: 'in a terminal', menu: false })
    const copy = walk(tree).find(n => keyOf(n) === 'auto-copy-add')
    expect({ where, copy: copy?.props?.label, key: copy?.props?.hotkey }).toEqual({ where, copy: 'Copy command', key: '2' })
  }
})

/** Which way the broken list's second step adds Spinlings back: `/plugin` in Claude Code, or the shell's command. */
function addStep(text: string): 'in Claude Code' | 'in a terminal' | null {
  if (!text.includes('Then add your marketplaces again. For Spinlings:')) return null
  const slash = text.includes('/plugin marketplace add 416rehman/spinlings')
  const shell = text.includes('In a terminal: claude plugin marketplace add 416rehman/spinlings')
  return slash === shell ? null : slash ? 'in Claude Code' : 'in a terminal'
}

test('opened from the band without the keyboard, the note comes before anything to press; feedback sits right under the action', LONG, async ($, on) => {
  const p: Probe = { state: scene('Updates · out, one press to turn auto-update on'), calls: [], focused: false }
  draws(on, p)
  for (const title of ['Updates · out, one press to turn auto-update on', 'Updates · needed to keep playing online', 'Updates · here, just updated', 'Updates · out, auto-update not known']) {
    p.state = scene(title)
    for (const columns of WIDTHS) {
      const ui = await $.ui.mount(MOUNT(columns, 'terminal'))
      const nodes = walk(await ui.drawn())
      const note = nodes.findIndex(n => n.type === 'Text' && textOf(n) === KEYS_NOTE)
      const first = nodes.findIndex(n => n.type === 'Button' && keyOf(n) !== '' && !/^(tab-|today|world-|pane-|version)/.test(keyOf(n)))
      expect({ title, columns, note: note >= 0, first: note >= 0 && note < first }).toEqual({ title, columns, note: true, first: true })
      await ui.unmount()
    }
  }
  p.focused = true
  const desk = await $.ui.mount(MOUNT(80, 'desktop'))
  expect(textOf(await desk.drawn())).not.toMatch(/ctrl\+x tab/)
  await desk.unmount()
  p.state = scene('Updates · out, copied')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(MOUNT(80, surface))
    const nodes = walk(await ui.drawn())
    const said = nodes.findIndex(n => n.type === 'Text' && textOf(n) === 'Copied /plugin. Paste it into Claude Code\'s prompt.')
    const action = nodes.findIndex(n => keyOf(n) === 'update-copy')
    const notes = nodes.findIndex(n => n.type === 'Text' && /^New in /.test(textOf(n)))
    expect({ surface, once: nodes.filter(n => n.type === 'Text' && /^Copied/.test(textOf(n))).length, under: action < said && said < notes }).toEqual({ surface, once: 1, under: true })
    await ui.unmount()
  }
})

test('the badge\'s markup rests on the state alone: the guide\'s reads of the plugin list never start it over', LONG, async ($, on) => {
  const p: Probe = { state: scene('Updates · out, one press to turn auto-update on'), calls: [], focused: true }
  draws(on, p)
  const source = async () => {
    const ui = await $.ui.mount(MOUNT(80, 'desktop'))
    const svg = walk(await ui.drawn()).find(n => n.type === 'Svg')
    await ui.unmount()
    return String(svg?.props?.source)
  }
  const before = await source()
  expect(before).toMatch(/animateTransform/)
  // a read a few seconds later: the same setting, a new account object, the clock on
  p.state = { ...JSON.parse(JSON.stringify(p.state)), clock: NOW + 3000 }
  expect(await source()).toBe(before)
  // the star is a control where the desktop forwards presses: a click on it is a press of Update now, which writes
  // nothing; needed's padlock and here's check press nothing
  const nodes = (title: string) => walk(pane({ el: ANY_EL, surface: 'desktop', columns: 80, rows: 40, now: NOW, actions: actions(p), focused: true, placement: 'inline', state: scene(title), hitAreas: true }))
  const hits = (title: string) => nodes(title).filter(n => n.type === 'Client').map(keyOf).filter(k => k !== 'world-mark-hit')
  expect(hits('Updates · out, one press to turn auto-update on')).toEqual(['update-star-hit'])
  // what assistive tech calls the star follows what a click on it does
  const named = (title: string) => (nodes(title).find(n => keyOf(n) === 'update-star-hit')?.props?.props as { alt?: string } | undefined)?.alt
  expect(named('Updates · out, one press to turn auto-update on')).toBe('Show the update steps')
  expect(named('Updates · out, the update steps open')).toBe('Hide the update steps')
  expect(hits('Updates · needed to keep playing online')).toEqual([])
  expect(hits('Updates · here, just updated')).toEqual([])
  // needed: a still padlock; with auto-update on, the star does not swell
  p.state = scene('Updates · needed to keep playing online')
  expect(await source()).not.toMatch(/animate/)
  p.state = scene('Updates · out, auto-update brings it')
  expect(await source()).not.toMatch(/animateTransform/)
})

// ---------- the band, through the wired mod ----------

type Mounted = { drawn(): Promise<unknown>; press(t: { key: string }): Promise<unknown>; redraw(): Promise<void>; unmount(): Promise<void> }

/** A machine that last ran `ran`, by default against a server with a newer release and its notes. */
async function started(
  $: { session: { start(e: never): Promise<unknown> } }, on: On, ran = CLIENT_VERSION,
  server = fakeServer({ latestClient: NEXT, notes: [{ version: NEXT, date: '2026-12-01', highlights: SCENE_NOTES[0]!.highlights }] }),
) {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on, server)
  w.store.set('prefs', { world: 'online', worldOption: 'online' })
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  w.store.set(`server:${ORIGIN}:meta`, { welcomed: true })
  w.store.set(KEYS.release, { v: 1, ran })
  let moments: GameState['moments'] = []
  let paneState: GameState['pane'] | null = null
  on('state.set', (_$, e, next) => {
    if (e.key === 'moments') moments = e.value as GameState['moments']
    if (e.key === 'pane') paneState = e.value as GameState['pane']
    return next(e)
  })
  await $.session.start(SESSION as never)
  await settle(clock)
  return { clock, w, moments: () => moments, pane: () => paneState }
}

test('the band\'s "is out": whole labels, 1 opens /spin updates without the keyboard, 2 closes it for good', LONG, async ($, on) => {
  const { clock, w, moments, pane: shown } = await started($, on)
  expect(moments().map(m => m.id)).toEqual([`update:${NEXT}`])
  for (const surface of SURFACES) for (const columns of WIDTHS) {
    const b = await $.ui.mount(BAND(columns, surface)) as unknown as Mounted
    const tree = await b.drawn()
    const where = `out @${columns} ${surface}`
    const chips = walk(tree).find(n => keyOf(n) === 'release-chips')
    expect({ where, chips: !!chips, cut: textOf(chips).includes('…'), lead: textOf(chips).startsWith('✦ Team presets') }).toEqual({ where, chips: true, cut: false, lead: true })
    expect({ where, keys: buttons(tree).map(n => `${n.props?.hotkey}:${n.props?.label}`) }).toEqual({ where, keys: ['1:What\'s new', '2:Close'] })
    await b.unmount()
  }
  const opens = w.opens.length
  const b = await $.ui.mount(BAND(80, 'terminal')) as unknown as Mounted
  await b.press({ key: `act-update:${NEXT}` })
  await settle(clock)
  expect(w.opens.slice(opens)).toEqual([false])
  expect(shown()?.stack.at(-1)).toEqual({ kind: 'auto-update' })
  expect(moments().some(m => m.kind === 'update')).toBe(false)
  await b.unmount()
  // a new session the same day: it was news once
  await $.session.start(SESSION as never)
  await settle(clock)
  expect(moments().some(m => m.kind === 'update')).toBe(false)
})

test('Close on "is out" is for good: the next session says nothing of it', LONG, async ($, on) => {
  const { clock, moments } = await started($, on)
  const b = await $.ui.mount(BAND(80, 'terminal')) as unknown as Mounted
  await b.press({ key: `dismiss-update:${NEXT}` })
  await settle(clock)
  expect(moments().some(m => m.kind === 'update')).toBe(false)
  await b.unmount()
  await $.session.start(SESSION as never)
  await settle(clock)
  expect(moments().some(m => m.kind === 'update')).toBe(false)
})

test('the band\'s "is here" after an update: what came, as whole labels, and 1 opens /spin updates saying where it came from', LONG, async ($, on) => {
  const { clock, w, moments, pane: shown } = await started($, on, '0.2.16', fakeServer())
  expect(moments().map(m => m.id)).toEqual([`updated:${CLIENT_VERSION}`])
  for (const surface of SURFACES) for (const columns of WIDTHS) {
    const b = await $.ui.mount(BAND(columns, surface)) as unknown as Mounted
    const tree = await b.drawn()
    const where = `here @${columns} ${surface}`
    // one sparkle: the lead's, and the label line's; the headline carries none
    const head = walk(tree).find(n => n.type === 'Text' && /is here/.test(textOf(n)))
    expect({ where, head: textOf(head), cut: textOf(walk(tree).find(n => keyOf(n) === 'release-chips')).includes('…') })
      .toEqual({ where, head: `Spinlings ${CLIENT_VERSION} is here`, cut: false })
    await b.unmount()
  }
  const b = await $.ui.mount(BAND(80, 'terminal')) as unknown as Mounted
  expect(textOf(await b.drawn())).toMatch(/✦ Open all · Auto-update · Card search/)
  await b.press({ key: `act-updated:${CLIENT_VERSION}` })
  await settle(clock)
  expect(w.opens.at(-1)).toBe(false)
  expect(shown()?.stack.at(-1)).toEqual({ kind: 'auto-update', here: '0.2.16' })
  await b.unmount()
})

test('a community server\'s "is out" names the version and no labels: only spinlings.dev says what a release brings', LONG, async ($, on) => {
  const p: Probe = { state: scene('Band · a new version is out, on a community server'), calls: [], focused: true }
  draws(on, p)
  for (const title of ['Band · a new version is out, on a community server', 'Band · a new version is out, what it brings not known']) {
    p.state = scene(title)
    for (const surface of SURFACES) for (const columns of WIDTHS) {
      const b = await $.ui.mount(BAND_MOUNT(columns, surface))
      const tree = await b.drawn()
      // with nothing known of what it brings, 1 is the update itself, not a What's new with nothing in it
      const keys = buttons(tree).map(n => `${n.props?.hotkey}:${n.props?.label}`)
      expect({ title, columns, surface, out: /is out/.test(textOf(tree)), chips: walk(tree).some(n => keyOf(n) === 'release-chips'), keys })
        .toEqual({ title, columns, surface, out: true, chips: false, keys: ['1:Update', '2:Close'] })
      await b.unmount()
    }
  }
})

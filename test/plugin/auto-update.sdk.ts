// Turning on Claude Code's auto-update (SPEC 32): the band's offer and its three answers, the steps with their live
// light and Copy (pictures of /plugin on the terminal; on the desktop, whose /plugin has no such toggle, one line that
// says where it is), the payoff once on, and /spin updates' version card above the section, the switch never twice.
// On the terminal and the desktop at 24 to 120 columns. Through the wired mod, staged as an installed copy, the one
// file opened is its own plugin list, four folders up, only read.
// (A dev or --plugin-dir copy opens nothing: registryPath in test/client/autoupdate.test.ts and the allowlist.)
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { INITIAL } from '../../plugin/hooks/client/game.ts'
import type { Actions, El, GameState } from '../../plugin/hooks/client/types.ts'
import { band } from '../../plugin/hooks/ui/band.tsx'
import { pane } from '../../plugin/hooks/ui/pane.tsx'
import { uiScenes } from './ui-scenes.ts'
import { BAND, PANE, SESSION, engine, files, measure, settle, textOf, walk } from './engine.ts'
import type { Node } from './engine.ts'
import { NEXT, NOW, fakeServer } from './fixtures.ts'
import { REGISTRY_RE, cc, list } from './registry.ts'

const SURFACES = ['terminal', 'desktop'] as const
type Probe = { state: GameState; calls: [string, unknown[]][] }

function actions(p: Probe): Actions {
  return new Proxy({}, {
    get: (_, name) => async (...args: unknown[]) => {
      p.calls.push([String(name), args])
      if (name === 'back') p.state = { ...p.state, pane: { ...p.state.pane, stack: p.state.pane.stack.slice(0, -1) } }
    },
  }) as Actions
}

function draws(on: On, p: Probe): void {
  on('ui.render', { component: 'Pane', requestId: 'probe' }, async ($, e) => pane({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows, now: NOW,
    actions: actions(p), focused: true, placement: 'inline', state: p.state,
  }))
  on('ui.render', { component: 'AbovePrompt', requestId: 'band-probe' }, async ($, e) => band({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.maxRows, now: NOW,
    actions: actions(p), isWorking: true, state: p.state,
  }) ?? { type: 'Text', props: {}, children: ['engine band'] })
}

const MOUNT = (columns: number, surface: (typeof SURFACES)[number]) => ({ ...PANE(columns, surface), requestId: 'probe' })
const BAND_MOUNT = (columns: number, surface: (typeof SURFACES)[number], rows = 4) => ({ ...BAND(columns, surface, rows), requestId: 'band-probe' })
const scene = (title: string) => JSON.parse(JSON.stringify(uiScenes(NOW).find(s => s.title === title)!.state)) as GameState
/** The pane's tree, drawn without an engine: element names for elements, so any surface draws. */
const ANY_EL = new Proxy({}, { get: (_, k) => String(k) }) as unknown as El

function fits(tree: unknown, columns: number, where: string): void {
  const problems: string[] = []
  if (measure(tree, columns, problems).w > columns) problems.push('overflow')
  const keys = walk(tree).filter(n => n.type === 'Button').map(b => b.props?.hotkey).filter((k): k is string => typeof k === 'string')
  if (keys.some((k, i) => keys.indexOf(k) !== i)) problems.push(`keys twice: ${keys.join(' ')}`)
  // a primary is on 1, or (the desktop band's one write) on no digit at all
  for (const b of walk(tree).filter(n => n.type === 'Button' && n.props?.variant === 'primary')) if (b.props?.hotkey !== '1' && !(b.props?.key === 'auto-on' && b.props?.hotkey === undefined)) problems.push('primary off 1')
  expect({ where, problems }).toEqual({ where, problems: [] })
}

test('an installed copy opens only its own plugin list, four folders up, and only reads it until a press', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on, fakeServer({ latestClient: NEXT, difficulty: 1 }), undefined, files(cc(list())))
  let account = INITIAL.account
  on('state.set', (_$, e, next) => { if (e.key === 'account') account = e.value as GameState['account']; return next(e) })
  await $.session.start(SESSION)
  await settle(clock)
  expect(w.fs.length > 0).toBe(true)
  for (const call of w.fs) expect({ call, ok: /^read /.test(call) && REGISTRY_RE.test(call) }).toEqual({ call, ok: true })
  expect(w.files.writes).toEqual([])
  expect(account.autoUpdate).toBe('off')
  expect(account.autoUpdateWritable).toBe(true)
  expect(w.settings).toBe(0)
})

test('the band asks once, plainly, with Show me how, Not now and Don\'t ask again on 1, 2 and 3', { timeoutMs: 60_000 }, async ($, on) => {
  const p: Probe = { state: scene('Band · turn on auto-update?'), calls: [] }
  draws(on, p)
  for (const surface of SURFACES) for (const columns of [40, 80, 120]) for (const rows of surface === 'terminal' ? [4, 2] : [4]) {
    const ui = await $.ui.mount(BAND_MOUNT(columns, surface, rows))
    const tree = await ui.drawn()
    fits(tree, columns, `offer @${columns} ${surface} ${rows}`)
    expect(textOf(tree)).toMatch(columns >= 80 ? /Let Spinlings update itself/ : /Updates by itself|Let Spinlings update itself/)
    expect(textOf(tree)).not.toMatch(/by themselves/)
    const buttons = walk(tree).filter(n => n.type === 'Button')
    expect(buttons.map(b => b.props?.hotkey)).toEqual(['1', '2', '3'])
    expect(buttons.map(b => b.props?.label)).toEqual(columns >= 80 ? ['Show me how', 'Not now', 'Don\'t ask again'] : ['How', 'Later', 'Never'])
    await ui.unmount()
  }
  const ui = await $.ui.mount(BAND_MOUNT(80, 'desktop'))
  for (const key of ['auto-how', 'auto-later', 'auto-never']) await ui.press({ key, plugin: 'test' })
  expect(p.calls).toEqual([['autoUpdate', ['how']], ['autoUpdate', ['later']], ['autoUpdate', ['never']]])
  await ui.unmount()
})

test('where the switch can write, no digit writes: the desktop\'s Turn on auto-update is a click, the terminal\'s 1 opens the guide', { timeoutMs: 60_000 }, async ($, on) => {
  const p: Probe = { state: scene('Band · turn on auto-update in one press'), calls: [] }
  draws(on, p)
  for (const surface of SURFACES) for (const columns of [40, 80, 120]) for (const rows of surface === 'terminal' ? [4, 2] : [4]) {
    const ui = await $.ui.mount(BAND_MOUNT(columns, surface, rows))
    const tree = await ui.drawn()
    fits(tree, columns, `one press @${columns} ${surface} ${rows}`)
    const buttons = walk(tree).filter(n => n.type === 'Button')
    const wide = columns >= 80
    if (surface === 'terminal') {
      expect(buttons.map(b => b.props?.hotkey)).toEqual(['1', '2', '3'])
      expect(buttons.map(b => b.props?.key)).toEqual(['auto-how', 'auto-later', 'auto-never'])
      expect(buttons.map(b => b.props?.label)).toEqual(wide ? ['Turn on auto-update…', 'Not now', 'Don\'t ask again'] : ['Turn on…', 'Later', 'Never'])
    } else {
      // the write carries no digit, so a digit an empty prompt hands the band (an answer meant for Claude) never reaches it
      expect(buttons.map(b => b.props?.hotkey)).toEqual([undefined, '2', '3'])
      expect(buttons.map(b => b.props?.key)).toEqual(['auto-on', 'auto-later', 'auto-never'])
      expect(buttons.map(b => b.props?.label)).toEqual(wide ? ['Turn on auto-update', 'Not now', 'Don\'t ask again'] : ['Turn on', 'Later', 'Never'])
    }
    expect(buttons.some(b => b.props?.autoFocus)).toBe(false)
    await ui.unmount()
  }
  const ui = await $.ui.mount(BAND_MOUNT(80, 'terminal'))
  await ui.press({ key: 'auto-how', plugin: 'test' })
  expect(p.calls).toEqual([['autoUpdate', ['how']]])
  await ui.unmount()
  const desk = await $.ui.mount(BAND_MOUNT(80, 'desktop'))
  await desk.press({ key: 'auto-on', plugin: 'test' })
  expect(p.calls).toEqual([['autoUpdate', ['how']], ['autoUpdate', ['on']]])
  await desk.unmount()
  // held by Claude Code's environment: the plain Show me how, which says why
  p.state = { ...p.state, account: { ...p.state.account, autoUpdateHeld: true } }
  const held = await $.ui.mount(BAND_MOUNT(80, 'terminal'))
  expect(await held.find({ key: 'auto-on' })).toBeUndefined()
  expect(await held.find({ key: 'auto-how' })).toBeDefined()
  await held.unmount()
})

test('the steps: a live light, three pictures of /plugin on the terminal, one plain line on the desktop, Copy on 1', { timeoutMs: 90_000 }, async ($, on) => {
  const p: Probe = { state: scene('Auto-update · the steps, setting not known'), calls: [] }
  draws(on, p)
  for (const surface of SURFACES) for (const columns of [24, 40, 80, 120]) {
    const ui = await $.ui.mount(MOUNT(columns, surface))
    const tree = await ui.drawn()
    const where = `steps @${columns} ${surface}`
    fits(tree, columns, where)
    const text = textOf(tree)
    expect({ where, light: /can't tell from here/.test(text), path: /Marketplaces[\s\S]*Enable auto-update/.test(text) }).toEqual({ where, light: true, path: true })
    // the desktop's own /plugin is a plugin page with no auto-update toggle: no picture of a menu it does not show
    const pictures = walk(tree).filter(n => n.type === 'Box' && n.props?.borderStyle === 'round').length
    if (surface === 'terminal') expect({ where, typed: /Type \/plugin/.test(text), pictures }).toEqual({ where, typed: true, pictures: 3 })
    else expect({ where, line: /In Claude Code in a terminal: \/plugin, then Marketplaces, then spinlings, then Enable auto-update/.test(text), pictures }).toEqual({ where, line: true, pictures: 0 })
    expect({ where, command: /claude plugin update|marketplace update/.test(text) }).toEqual({ where, command: false })
    await ui.unmount()
  }
  const ui = await $.ui.mount(MOUNT(80, 'terminal'))
  expect((await ui.find({ key: 'auto-copy' }))?.props).toMatchObject({ hotkey: '1', variant: 'primary' })
  await ui.press({ key: 'auto-copy', plugin: 'test' })
  expect(p.calls).toEqual([['autoUpdate', ['copy']]])
  await ui.unmount()
  // off the terminal the toggle is in a terminal's /plugin, so Copy's feedback says to paste it there
  const desk = await $.ui.mount(MOUNT(80, 'desktop'))
  await desk.press({ key: 'auto-copy', plugin: 'test' })
  expect(p.calls.at(-1)).toEqual(['autoUpdate', ['copy-terminal']])
  await desk.unmount()
})

test('the version card sits above the section, and the switch never shows twice', { timeoutMs: 90_000 }, async ($, on) => {
  const titles = ['Auto-update · off, one press to turn it on', 'Updates · out, one press to turn auto-update on', 'Updates · out, auto-update brings it',
    'Updates · needed to keep playing online', 'Updates · here, just updated', 'Updates · the server is out of reach']
  const p: Probe = { state: scene(titles[0]!), calls: [] }
  draws(on, p)
  for (const title of titles) for (const surface of SURFACES) for (const columns of [40, 80]) {
    p.state = scene(title)
    const where = `${title} @${columns} ${surface}`
    const ui = await $.ui.mount(MOUNT(columns, surface))
    const tree = await ui.drawn()
    fits(tree, columns, where)
    const nodes = walk(tree)
    const card = nodes.findIndex(n => n.key === 'version-card' || n.props?.key === 'version-card')
    // the section's chip: on its own, or beside the switch on the desktop
    const isChip = (n: Node) => ['auto-chip', 'auto-hero'].includes(String(n.key ?? n.props?.key))
    const chip = nodes.findIndex(isChip)
    expect({ where, card: card >= 0, above: card < chip }).toEqual({ where, card: true, above: true })
    expect({ where, chips: nodes.filter(isChip).length }).toEqual({ where, chips: 1 })
    expect({ where, on: nodes.filter(n => n.type === 'Button' && n.props?.key === 'auto-on').length <= 1 }).toEqual({ where, on: true })
    // one picture at most, and no switch where the card has the screen's badge
    expect({ where, art: nodes.filter(n => n.type === 'Svg').length <= 1 }).toEqual({ where, art: true })
    await ui.unmount()
  }
})

test('once on: the payoff and Done on 1; with a release out, the card says the next start brings it and the chip that it is on its way', { timeoutMs: 90_000 }, async ($, on) => {
  const p: Probe = { state: scene('Auto-update · on'), calls: [] }
  draws(on, p)
  for (const surface of SURFACES) for (const columns of [24, 40, 80, 120]) {
    const ui = await $.ui.mount(MOUNT(columns, surface))
    const tree = await ui.drawn()
    fits(tree, columns, `on @${columns} ${surface}`)
    expect(textOf(tree)).toMatch(/Auto-update is on/)
    expect(textOf(tree)).toMatch(/Claude Code checks for a new Spinlings each time it starts\./)
    // on, but not by this mod's switch: the way to turn it off is the terminal's /plugin, with Copy on 2
    expect(textOf(tree)).toMatch(surface === 'terminal' ? /To turn it off: \/plugin, then Marketplaces, then spinlings/ : /To turn it off, in Claude Code in a terminal: \/plugin, then Marketplaces/)
    expect(walk(tree).some(n => n.type === 'Button' && n.props?.key === 'auto-off')).toBe(false)
    expect(walk(tree).some(n => n.type === 'Button' && n.props?.key === 'auto-copy')).toBe(false)
    if (surface === 'desktop') expect(walk(tree).some(n => n.type === 'Svg' && n.props?.alt === 'Auto-update is on')).toBe(true)
    await ui.unmount()
  }
  const ui = await $.ui.mount(MOUNT(80, 'terminal'))
  // Done goes through the game, which holds it for the switch's pause
  await ui.press({ key: 'auto-done', plugin: 'test' })
  expect(p.calls).toEqual([['autoUpdate', ['done']]])
  await ui.unmount()
  p.state = scene('Updates · out, auto-update brings it')
  for (const surface of SURFACES) {
    const out = await $.ui.mount(MOUNT(80, surface))
    const tree = await out.drawn()
    expect(textOf(tree)).toMatch(/You have [\d.]+ · it arrives by itself the next time Claude Code starts/)
    // nothing to do: no update steps, no command, and the switch's payoff once, without its art beside the card's
    expect({ surface, steps: await out.find({ key: 'update-copy' }), on: await out.find({ key: 'auto-on' }) }).toEqual({ surface, steps: undefined, on: undefined })
    expect((await out.find({ key: 'auto-done' }))?.props).toMatchObject({ hotkey: '1', variant: 'primary' })
    await out.unmount()
  }
  p.state = scene('Version · on its way: auto-update brings it')
  const chip = await $.ui.mount(MOUNT(80, 'terminal'))
  expect((await chip.find({ key: 'version' }))?.props).toMatchObject({ label: `${NEXT} on its way`, hotkey: 'u', dimColor: true })
  await chip.unmount()
  const narrow = await $.ui.mount(MOUNT(40, 'terminal'))
  expect((await narrow.find({ key: 'version' }))?.props.label).toBe(`${NEXT} soon`)
  await narrow.unmount()
})

test('on, but Claude Code\'s updates are held here: promise nothing, and the update steps lead, without the toggle', { timeoutMs: 60_000 }, async ($, on) => {
  const p: Probe = { state: scene('Updates · out, updates held here'), calls: [] }
  draws(on, p)
  for (const surface of SURFACES) for (const columns of [40, 80, 120]) {
    const ui = await $.ui.mount(MOUNT(columns, surface))
    const tree = await ui.drawn()
    const where = `held @${columns} ${surface}`
    fits(tree, columns, where)
    const text = textOf(tree)
    expect({ where, promise: /arrives by itself|on its way/.test(text), held: /Auto-update can't run here/.test(text), toggle: /Enable auto-update/.test(text) })
      .toEqual({ where, promise: false, held: true, toggle: false })
    expect({ where, copy: (await ui.find({ key: 'update-copy' }))?.props.hotkey }).toEqual({ where, copy: '1' })
    await ui.unmount()
  }
  p.state = scene('Version · a newer mod is out: the footer chip')
  p.state = { ...p.state, account: { ...p.state.account, autoUpdate: 'on', autoUpdateHeld: true } }
  const chip = await $.ui.mount(MOUNT(80, 'terminal'))
  expect((await chip.find({ key: 'version' }))?.props.label).not.toMatch(/on its way/)
  await chip.unmount()
})

test('the band says a release is out with what it brings, and What\'s new and Close are its only answers', { timeoutMs: 60_000 }, async ($, on) => {
  const p: Probe = { state: scene('Band · a new version is out'), calls: [] }
  draws(on, p)
  const b = await $.ui.mount(BAND_MOUNT(80, 'terminal'))
  expect(textOf(await b.drawn())).not.toMatch(/claude plugin update/)
  const id = p.state.moments[0]!.id
  await b.press({ key: `act-${id}`, plugin: 'test' })
  await b.press({ key: `dismiss-${id}`, plugin: 'test' })
  expect(p.calls).toEqual([['act', [id]], ['dismiss', [id]]])
  await b.unmount()
})

/** The chip's own column: the chip and the line under it, kept together (no row between them). */
function chipColumn(tree: unknown): { gap: unknown; text: string } | null {
  const isChip = (n: Node) => n.key === 'auto-chip' || n.props?.key === 'auto-chip'
  const parent = walk(tree).find(n => (n.children ?? []).some(k => typeof k === 'object' && k !== null && isChip(k as Node)))
  return parent ? { gap: parent.props?.rowGap, text: textOf(parent) } : null
}

/** Each state's chip line, its primary, and whether the desktop draws the switch beside it (only where it is pressed). */
const SAYS: [string, RegExp, string | null, boolean][] = [
  ['Auto-update · Claude Code was saving', /Claude Code was saving its plugin list\. Try again\./, 'Try again', true],
  ['Auto-update · could not change it here', /Couldn't change it from here\. (In \/plugin|Turn it on by hand):/, 'Copy', false],
  ['Auto-update · turned off in /plugin', /Auto-update was turned off in Claude Code\. To turn it back on:/, 'Copy', false],
  ['Auto-update · can\'t run here', /Claude Code's updates are turned off on this computer\./, 'Done', false],
  ['Auto-update · turning on', /Turning on…/, null, true],
]

test('every state says why right under its chip, with the switch beside it on the desktop only where it can be pressed', { timeoutMs: 90_000 }, async ($, on) => {
  const p: Probe = { state: scene(SAYS[0]![0]), calls: [] }
  draws(on, p)
  for (const [title, says, primary, art] of SAYS) {
    p.state = scene(title)
    for (const surface of SURFACES) for (const columns of [40, 80]) {
      const where = `${title} @${columns} ${surface}`
      const ui = await $.ui.mount(MOUNT(columns, surface))
      const tree = await ui.drawn()
      fits(tree, columns, where)
      if (surface === 'terminal' || !art) {
        const col = chipColumn(tree)
        expect({ where, gap: col?.gap, says: says.test(col?.text ?? '') }).toEqual({ where, gap: 0, says: true })
      } else {
        expect({ where, art: walk(tree).some(n => n.type === 'Svg' && typeof n.props?.alt === 'string' && /Auto-update|Turning on/.test(n.props.alt as string)) }).toEqual({ where, art: true })
        expect({ where, says: says.test(textOf(tree)) }).toEqual({ where, says: true })
      }
      // a switch is drawn only where a click on it presses something
      if (surface === 'desktop') {
        expect({ where, drawn: walk(tree).some(n => n.type === 'Svg' && String(n.props?.source).includes('<rect x="4" y="14" width="40" height="20" rx="10"')) }).toEqual({ where, drawn: art })
      }
      const first = walk(tree).find(n => n.type === 'Button' && n.props?.variant === 'primary')
      expect({ where, primary: first ? String(first.props?.label) : null }).toEqual({ where, primary })
      await ui.unmount()
    }
  }
})

test('a list left unreadable: the one way out that works, the folder and the command each whole on its own line with its own Copy', { timeoutMs: 60_000 }, async ($, on) => {
  const p: Probe = { state: scene('Auto-update · the plugin list did not save'), calls: [] }
  const folder = (p.state.pane.autoPress as { folder?: string }).folder!
  expect(folder).toMatch(/[\\/]plugins$/)
  draws(on, p)
  for (const surface of SURFACES) for (const columns of [40, 80, 120]) {
    const where = `broken @${columns} ${surface}`
    const ui = await $.ui.mount(MOUNT(columns, surface))
    const tree = await ui.drawn()
    fits(tree, columns, where)
    const text = textOf(tree)
    // /plugin runs only in Claude Code in a terminal: off it, the shell's command, in a terminal
    const command = surface === 'terminal' ? '/plugin marketplace add 416rehman/spinlings' : 'In a terminal: claude plugin marketplace add 416rehman/spinlings'
    expect({ where, says: /Claude Code can't read its plugin list now\.[\s\S]*Delete known_marketplaces\.json from this folder:[\s\S]*Then add your marketplaces again\. For Spinlings:/.test(text) }).toEqual({ where, says: true })
    expect({ where, restart: /Restart Claude Code/.test(text), slash: surface !== 'terminal' && text.includes('/plugin marketplace add') }).toEqual({ where, restart: false, slash: false })
    // each on a line of its own that wraps rather than cut, right under the words it belongs to
    for (const whole of [folder, command]) {
      const at = walk(tree).find(n => n.type === 'Text' && textOf(n) === whole)
      expect({ where, whole, line: at?.props?.wrap }).toEqual({ where, whole, line: 'wrap' })
    }
    const steps = walk(tree).filter(n => n.type === 'Box' && n.props?.rowGap === 0 && /^(Delete|Then add)/.test(textOf(n)))
    expect({ where, tight: steps.length }).toEqual({ where, tight: 2 })
    expect({ where, folder: (await ui.find({ key: 'auto-copy-folder' }))?.props, add: (await ui.find({ key: 'auto-copy-add' }))?.props })
      .toMatchObject({ where, folder: { label: 'Copy folder', hotkey: '1', variant: 'primary' }, add: { label: 'Copy command', hotkey: '2' } })
    await ui.unmount()
  }
  const ui = await $.ui.mount(MOUNT(80, 'terminal'))
  await ui.press({ key: 'auto-copy-folder', plugin: 'test' })
  await ui.press({ key: 'auto-copy-add', plugin: 'test' })
  expect(p.calls).toEqual([['autoUpdate', ['copy-folder']], ['autoUpdate', ['copy-add']]])
  await ui.unmount()
  const desk = await $.ui.mount(MOUNT(80, 'desktop'))
  await desk.press({ key: 'auto-copy-add', plugin: 'test' })
  expect(p.calls.at(-1)).toEqual(['autoUpdate', ['copy-add-shell']])
  await desk.unmount()
  // in an editor, which refuses /plugin as well, drawn without an engine: the shell's command and its Copy command
  const editorState = scene('Auto-update · the plugin list did not save')
  for (const columns of [40, 80, 120]) {
    const tree = pane({
      el: ANY_EL, surface: 'vscode', columns, rows: 40, now: NOW, actions: actions({ state: editorState, calls: [] }), focused: true, placement: 'inline', state: editorState,
    })
    const where = `broken @${columns} vscode`
    const text = textOf(tree)
    expect({ where, command: text.includes('Then add your marketplaces again. For Spinlings:') && text.includes('In a terminal: claude plugin marketplace add 416rehman/spinlings'), slash: text.includes('/plugin marketplace add') })
      .toEqual({ where, command: true, slash: false })
    const copy = walk(tree).find(n => String(n.key ?? n.props?.key) === 'auto-copy-add')
    expect({ where, label: copy?.props?.label, hotkey: copy?.props?.hotkey }).toEqual({ where, label: 'Copy command', hotkey: '2' })
  }
  // a result from before the folder was kept: the words alone, and Copy command on 1
  p.state = { ...p.state, pane: { ...p.state.pane, autoPress: { phase: 'done', to: 'on', result: 'broken' } } }
  const bare = await $.ui.mount(MOUNT(80, 'terminal'))
  expect(textOf(await bare.drawn())).toMatch(/Delete known_marketplaces\.json from Claude Code's plugins folder\./)
  expect((await bare.find({ key: 'auto-copy-add' }))?.props).toMatchObject({ hotkey: '1', variant: 'primary' })
  expect(await bare.find({ key: 'auto-copy-folder' })).toBeUndefined()
  await bare.unmount()
})

test('on, but not turned on here: the whole /plugin path to turn it off, and Copy says what it copies', { timeoutMs: 60_000 }, async ($, on) => {
  const p: Probe = { state: scene('Auto-update · on'), calls: [] }
  draws(on, p)
  const ui = await $.ui.mount(MOUNT(80, 'terminal'))
  expect(textOf(await ui.drawn())).toMatch(/To turn it off: \/plugin, then Marketplaces, then spinlings, then Disable auto-update/)
  expect((await ui.find({ key: 'auto-copy-off' }))?.props).toMatchObject({ label: 'Copy /plugin', hotkey: '2' })
  await ui.press({ key: 'auto-copy-off', plugin: 'test' })
  expect(p.calls.at(-1)).toEqual(['autoUpdate', ['copy']])
  await ui.unmount()
  const desk = await $.ui.mount(MOUNT(80, 'desktop'))
  expect(textOf(await desk.drawn())).toMatch(/To turn it off, in Claude Code in a terminal: \/plugin, then Marketplaces, then spinlings, then Disable auto-update/)
  await desk.press({ key: 'auto-copy-off', plugin: 'test' })
  expect(p.calls.at(-1)).toEqual(['autoUpdate', ['copy-terminal']])
  await desk.unmount()
})

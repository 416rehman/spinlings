// The SPEC 21 quality gate, end to end through the plugin: `/spin demo` is walked with its own Next button on the
// terminal and the desktop at 40, 80 and 120 columns, and every pane screen and every band moment it shows must draw
// with no refused tree, no overflow, one meaning per key, a primary action only on 1 (o opens, in the header and the
// ceremonies), a hint row, art on its own surface only (Raster on the terminal, Svg on the desktop), and guidance in
// every empty state. Each band moment is then drawn as the band itself: four rows at most, every button on a digit.
import { expect, mock, test } from 'claude-code/testing'
import type { El } from '../hooks/client/types.ts'
import { demoSteps } from '../hooks/client/demo.ts'
import { band } from '../hooks/ui/band.tsx'
import { NOW } from './fixtures.ts'
import { BAND, PANE, RUN, SESSION, engine, measure, settle, textOf, walk } from './engine.ts'
import type { Node } from './engine.ts'

const WIDTHS = [40, 80, 120] as const
const SURFACES = ['terminal', 'desktop'] as const

/** Every way a drawn tree can fail the gate, as lines in `failures`. */
function gate(tree: unknown, columns: number, surface: string, where: string, failures: string[]): void {
  const nodes = walk(tree)
  const problems: string[] = []
  const size = measure(tree, columns, problems)
  if (size.w > columns) problems.push(`needs ${size.w} cells`)
  for (const n of nodes) if (n.type === 'Box' && typeof n.props?.width === 'number' && (n.props.width as number) > columns) problems.push(`a box ${String(n.props.width)} wide`)
  const keys = nodes.filter(n => n.type === 'Button').map(b => b.props?.hotkey).filter((k): k is string => typeof k === 'string')
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
  if (dupes.length > 0) problems.push(`keys twice: ${dupes.join(' ')}`)
  for (const b of nodes.filter(n => n.type === 'Button' && n.props?.variant === 'primary')) {
    if (!['1', 'o'].includes(String(b.props?.hotkey))) problems.push(`primary "${String(b.props?.label)}" on ${String(b.props?.hotkey)}`)
  }
  const wrong = nodes.filter(n => n.type === (surface === 'terminal' ? 'Svg' : 'Raster')).length
  if (wrong > 0) problems.push(`${wrong} art nodes for the other surface`)
  const rasters = nodes.filter(n => n.type === 'Raster').map(n => String(n.props?.key))
  const twice = rasters.filter((k, i) => rasters.indexOf(k) !== i)
  if (twice.length > 0) problems.push(`raster keys twice: ${twice.join(' ')}`)
  if (problems.length > 0) failures.push(`${where}: ${problems.join('; ')}`)
}

/** The screen under the demo's own title row: its last line is the hint row. */
function hintOf(tree: unknown): string {
  const screen = (tree as Node).children?.at(-1)
  return textOf((screen as Node | undefined)?.children?.at(-1)).trim()
}

const GUIDED: [string, RegExp][] = [
  ['Cards · empty collection', /Creatures show up while Claude works/],
  ['Team · a brand-new player', /Your team forms as your first cards arrive/],
  ['Trade · empty inbox', /No offers yet/],
  ['Trade · a new player\'s inbox',/opens once your account is 3 days old with 10 battles.*Wandering Trader deals with you today/],
  ['Trade · the Trader has not come by', /Press w to look again/],
  ['Start · this computer is signed out', /Start fresh for a new online collection/],
  ['Start · the offline save cannot be opened', /This save is from a newer Spinlings/],
  ['Devices · signed out, a passkey brings the old collection', /Use a passkey you saved on another computer/],
  ['Cards · a filter with nothing in it', /change the filters/],
  ['First run · hatching', /Hatching your first Spinling/],
  ['Band · Claude is resting: only the status line speaks', /Claude is resting until/],
]

test('/spin demo: every pane screen and band moment passes the gate at 40, 80 and 120 columns on both surfaces', { options: { world: 'offline' }, timeoutMs: 600_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  expect(await $.command.run(RUN('demo'))).toEqual({})
  const steps = demoSteps(NOW)
  expect(steps.filter(s => s.band).length).toBeGreaterThan(30)
  expect(steps.filter(s => !s.band).length).toBeGreaterThan(40)
  const failures: string[] = []
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      const ui = await $.ui.mount(PANE(columns, surface))
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!
        const where = `${i + 1} ${step.title} @${columns} ${surface}`
        const tree = await ui.drawn()
        const text = textOf(tree)
        if (!text.includes(`Demo ${i + 1}/${steps.length} · ${step.title}`)) failures.push(`${where}: not the step the demo shows`)
        gate(tree, columns, surface, where, failures)
        if (!/\S/.test(hintOf(tree))) failures.push(`${where}: no hint row`)
        const guided = GUIDED.find(([title]) => title === step.title)
        if (guided && !guided[1].test(text)) failures.push(`${where}: an empty state without its guidance`)
        await ui.press({ key: 'demo-next' })
        await ui.redraw()
      }
      await ui.unmount()
    }
  }
  expect(failures).toEqual([])
})

test('every band moment of the demo draws as the band itself: four rows at most (fewer in a shorter window), buttons on digits, 1 the primary', { timeoutMs: 300_000 }, async ($, on) => {
  let state = demoSteps(NOW)[0]!.state
  const actions = new Proxy({}, { get: () => () => Promise.resolve() }) as never
  // beneath the plugin (whose own band is empty before a session starts), as register.tsx's BAND slot draws it
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => band({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.maxRows, now: state.clock,
    actions, isWorking: true, state,
  }) ?? { type: 'Text', props: {}, children: ['engine band'] })
  const failures: string[] = []
  for (const step of demoSteps(NOW).filter(s => s.band)) {
    state = step.state
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const where = `${step.title} @${columns} ${surface}`
        const ui = await $.ui.mount(BAND(columns, surface))
        const tree = await ui.drawn()
        await ui.unmount()
        if (textOf(tree) === 'engine band') {
          if (!/resting/.test(step.title)) failures.push(`${where}: the band is hidden`)
          continue
        }
        gate(tree, columns, surface, where, failures)
        const rows = measure(tree, columns, []).h
        if (surface === 'terminal' && rows > 4) failures.push(`${where}: ${rows} rows`)
        // in a window of 2 or 3 rows the whole moment still shows, so a digit reaches every button (maxRows)
        for (const maxRows of surface === 'terminal' ? [2, 3] : []) {
          const short = await $.ui.mount(BAND(columns, surface, maxRows))
          const small = await short.drawn()
          await short.unmount()
          gate(small, columns, surface, `${where} in ${maxRows} rows`, failures)
          const h = measure(small, columns, []).h
          if (h > maxRows) failures.push(`${where}: ${h} rows in a window of ${maxRows}`)
        }
        for (const b of walk(tree).filter(n => n.type === 'Button')) {
          if (!/^[1-9]$/.test(String(b.props?.hotkey))) failures.push(`${where}: ${String(b.props?.label)} on ${String(b.props?.hotkey)}`)
          if (b.props?.variant === 'primary' && b.props.hotkey !== '1') failures.push(`${where}: the primary on ${String(b.props.hotkey)}`)
        }
      }
    }
  }
  expect(failures).toEqual([])
})

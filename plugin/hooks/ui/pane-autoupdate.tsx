// Auto-update (SPEC 32): a live chip that says whether Claude Code updates Spinlings by itself, the one-press switch
// that turns it on (and, when it put it there, off again), and where in /plugin to do it by hand for every case the
// switch leaves to Claude Code. /spin updates (pane-version.tsx) draws this section under its version card, and says
// how much of it to draw. The chip follows the plugin list while this shows (client/game.ts reads it every few
// seconds) and celebrates when it turns on. Nothing here is sent anywhere, so it works the same offline.
import type { RenderElement } from 'claude-code'
import { ADD_COMMAND, ADD_SHELL_COMMAND, PLUGIN_COMMAND } from '../client/autoupdate.ts'
import type { AutoPress, View } from '../client/types.ts'
import { cardHitRegion } from './card-hit-area.tsx'
import type { Ctx, Shown } from './pane-kit.tsx'
import { actions, btn, column, line, para } from './pane-kit.tsx'
import { INK, MARK, SPACE } from './tokens.ts'

const STEP = ['❶', '❷', '❸'] as const
/** The one picture a screen has, on the desktop: this many cells square. */
export const ART = 48

/** The list does not parse after a write that never took: Claude Code then refuses every command that reads it. */
const BROKEN = 'Claude Code can\'t read its plugin list now.'
const BROKEN_DELETE = 'Delete known_marketplaces.json from this folder:'
const BROKEN_ADD = 'Then add your marketplaces again. For Spinlings:'
/** A press found Claude Code writing its plugin list at that moment. */
export const BUSY = 'Claude Code was saving its plugin list. Try again.'
export const KEYS_NOTE = 'Press ctrl+x tab to use the keys here.'

/**
 * How much of the section to draw (pane-version.tsx decides): `art` the desktop's switch or check beside the chip,
 * `sub` the line under the chip, `boldChip` its words in bold; `offRoute` false leaves out the way to turn it off by
 * hand, where the screen above is about something else (a release on its way).
 */
export type SectionOptions = { art: boolean; sub: boolean; boldChip: boolean; offRoute?: boolean }

type Guide = Extract<View, { kind: 'auto-update' }>

/** One step: its number, what to do, and a small picture of where in Claude Code it happens. */
export function step(c: Ctx, n: 0 | 1 | 2, what: string, picture: RenderElement, act: RenderElement | null = null): RenderElement {
  const { Box, Text } = c.el
  const inner = Math.max(12, c.columns - 3)
  return (
    <Box key={`auto-step-${n}`} flexDirection="row" columnGap={SPACE.tight} width={c.columns}>
      <Box flexShrink={0}><Text bold color={INK.accent}>{STEP[n]}</Text></Box>
      <Box flexDirection="column" rowGap={SPACE.none} width={inner}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={inner}>
          <Text bold wrap="wrap">{what}</Text>
          {act}
        </Box>
        {picture}
      </Box>
    </Box>
  )
}

/** A little window of Claude Code: a rounded box with its rows, as wide as the words need and the pane allows. */
export function screenshot(c: Ctx, key: string, rows: RenderElement[]): RenderElement {
  const width = Math.max(12, Math.min(c.columns - 3, 34))
  return <c.el.Box key={key} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={width}>{...rows}</c.el.Box>
}

/** The picture of /plugin typed at Claude Code's prompt. */
export const typedPlugin = (c: Ctx, key: string) =>
  screenshot(c, key, [<c.el.Text><c.el.Text dimColor>{'> '}</c.el.Text><c.el.Text>{PLUGIN_COMMAND}</c.el.Text></c.el.Text>])

/** A row of a /plugin menu picture: the menu's own name (depth 0), a choice in it (1), or a choice under that (2). */
export function menuRow(c: Ctx, label: string | RenderElement, depth: 0 | 1 | 2): RenderElement {
  const { Text } = c.el
  const words = typeof label === 'string' ? <Text>{label}</Text> : label
  if (depth === 0) return <Text bold color={INK.accent}>{label}</Text>
  if (depth === 1) return <Text><Text color={INK.accent}>{'› '}</Text>{words}</Text>
  return <Text><Text>{'  '}</Text><Text color={INK.accent}>{'› '}</Text>{words}</Text>
}

/** The terminal's /plugin path to the marketplace's toggle, in words. */
export const pathTo = (choice: string) => `${PLUGIN_COMMAND}, then Marketplaces, then spinlings, then ${choice}`

/** Copy of /plugin for that toggle: off the terminal, the feedback says to paste it in a terminal, where the toggle is. */
const copyAnswer = (c: Ctx) => (c.surface === 'terminal' ? 'copy' : 'copy-terminal')

/**
 * Where to turn it `to` by hand, with Copy of /plugin on `hotkey` (1 where this is the screen's main thing, else the
 * next free key). The terminal: three steps with a picture of its /plugin menu each. Any other surface: the one line
 * that says the toggle is in Claude Code in a terminal.
 */
function steps(c: Ctx, to: 'on' | 'off', hotkey: string): RenderElement[] {
  const { Box, Text } = c.el
  const choice = to === 'on' ? 'Enable auto-update' : 'Disable auto-update'
  const copy = btn(c, { key: 'auto-copy', label: 'Copy', hotkey, primary: hotkey === '1', on: () => c.actions.autoUpdate(copyAnswer(c)) })
  // Claude Desktop's /plugin page has no auto-update toggle, and the editors refuse /plugin: only the terminal's has it
  if (c.surface !== 'terminal') {
    return [
      <Box key="auto-elsewhere" flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
        <Text wrap="wrap"><Text dimColor>In Claude Code in a terminal: </Text><Text>{pathTo(choice)}</Text></Text>
        {copy}
      </Box>,
    ]
  }
  const toggle = <Text><Text dimColor>{to === 'on' ? '○ ' : '● '}</Text><Text>{choice}</Text></Text>
  return [
    step(c, 0, `Type ${PLUGIN_COMMAND}`, typedPlugin(c, 'auto-shot-0'), copy),
    step(c, 1, 'Open Marketplaces, pick spinlings', screenshot(c, 'auto-shot-1', [menuRow(c, 'Marketplaces', 0), menuRow(c, 'spinlings', 1)])),
    step(c, 2, `Choose ${choice}`, screenshot(c, 'auto-shot-2', [menuRow(c, toggle, 1)])),
  ]
}

export type Look = { mark: string; color: string; text: string }

/** The chip: on, off, can't run, or not known, in words and a colour. */
export function lookOf(c: Ctx): Look {
  const a = c.state.account
  const state = a.autoUpdate ?? 'unknown'
  if (a.autoUpdateHeld) return { mark: MARK.away, color: INK.muted, text: 'Auto-update can\'t run here' }
  if (state === 'on') return { mark: MARK.check, color: INK.good, text: 'Auto-update is on' }
  if (state === 'off' || state === 'off-chosen') return { mark: MARK.dot, color: INK.warn, text: 'Auto-update is off' }
  return { mark: MARK.away, color: INK.muted, text: 'Auto-update: can\'t tell from here' }
}

export function chip(c: Ctx, look: Look, bold = true): RenderElement {
  const { Box, Text } = c.el
  return (
    <Box key="auto-chip" flexDirection="row" columnGap={SPACE.tight} width={c.columns}>
      <Text color={look.color}>{look.mark}</Text>
      <Text bold={bold} color={look.color} wrap="wrap">{look.text}</Text>
    </Box>
  )
}

/** How the last press ended, when it did not end as asked: busy, broken or cannot; null otherwise. */
export function failedPress(c: Ctx): Extract<AutoPress, { phase: 'done' }>['result'] | null {
  const press = c.state.pane.autoPress ?? null
  return press?.phase === 'done' && press.result !== 'ok' ? press.result : null
}

/** The payoff on the desktop: a check in the good ink, a few twinkles around it while motion is on. */
export function onSvg(motion: boolean): string {
  const twinkle = (x: number, y: number, at: number) => `<path d="M${x} ${y - 3}L${x + 1} ${y - 1}L${x + 3} ${y}L${x + 1} ${y + 1}L${x} ${y + 3}`
    + `L${x - 1} ${y + 1}L${x - 3} ${y}L${x - 1} ${y - 1}Z" fill="${INK.accent}"${motion ? ' opacity="0"' : ''}>`
    + (motion ? `<animate attributeName="opacity" values="0;1;0" begin="${at}s" dur="0.9s" repeatCount="3"/>` : '') + '</path>'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART} ${ART}" width="${ART}" height="${ART}">`
    + `<circle cx="24" cy="24" r="15" fill="${INK.good}"/>`
    + '<path d="M17 24.5l5 5 9-10" fill="none" stroke="#14301a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>'
    + (motion ? twinkle(6, 9, 0) + twinkle(42, 12, 0.25) + twinkle(40, 41, 0.5) : '') + '</svg>'
}

/** The switch itself on the desktop: off at rest, its knob sliding across while a press turns it. */
function switchSvg(from: 'on' | 'off', to: 'on' | 'off', motion: boolean): string {
  const x = (s: 'on' | 'off') => (s === 'on' ? 32 : 16)
  const fill = (s: 'on' | 'off') => (s === 'on' ? INK.good : INK.muted)
  const moving = motion && from !== to
  const at = moving ? from : to
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART} ${ART}" width="${ART}" height="${ART}">`
    + `<rect x="4" y="14" width="40" height="20" rx="10" fill="${fill(at)}"${moving ? '' : ' opacity="0.85"'}>`
    + (moving ? `<animate attributeName="fill" values="${fill(from)};${fill(to)}" dur="0.6s" fill="freeze"/>` : '') + '</rect>'
    + `<circle cx="${x(at)}" cy="24" r="7" fill="${INK.bright}">`
    + (moving ? `<animate attributeName="cx" values="${x(from)};${x(to)}" dur="0.6s" fill="freeze"/>` : '') + '</circle></svg>'
}

/**
 * A screen's one picture on the desktop. `press` makes it a control: a click on the hit `region` is a press of the
 * button named `button` (through the same pause), and `name` is what assistive tech calls it.
 */
export type Art = { svg: string; alt: string; press?: { region: string; on: () => unknown; button: string; name: string } }

/** The picture with its rows beside it, centred on it: the desktop's hero shape, here and on the version card. */
export function artBeside(c: Ctx, key: string, art: Art, rows: (RenderElement | null)[]): RenderElement {
  const { Box } = c.el
  const svg = <c.el.Svg source={art.svg} alt={art.alt} width={ART} height={ART} isInteractive={c.motion} />
  const p = art.press
  const node = p ? cardHitRegion(c.el, svg, c.hitAreas, p.region, p.on, p.button, `${c.hitIntent}:${p.region}`, undefined, undefined, p.name) : svg
  return (
    <Box key={key} flexDirection="row" columnGap={SPACE.loose} alignItems="center" width={c.columns}>
      <Box flexShrink={0}>{node}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>{...rows.filter((r): r is RenderElement => r !== null)}</Box>
    </Box>
  )
}

/**
 * The top of every state: on the desktop, the switch (or the check once on) beside the chip's words and one line under
 * them; on the terminal, without art, and on the desktop where nothing here can change it, the chip and the line, kept
 * together. The section draws no art and no line where `o` says the screen above already does.
 */
function hero(c: Ctx, o: SectionOptions, look: Look, sub: string | null, art: Art | null): RenderElement {
  const under = o.sub ? sub : null
  if (c.surface === 'terminal' || !art || !o.art) return column(c, [chip(c, look, o.boldChip), under ? para(c, under) : null], SPACE.none)
  const { Text } = c.el
  return artBeside(c, 'auto-hero', art, [
    <Text bold={o.boldChip} color={look.color} wrap="wrap">{look.text}</Text>,
    under ? <Text wrap="wrap">{under}</Text> : null,
  ])
}

/** The guide's steps, shown or hidden (`steps` on its view): Show steps here, Update now on /spin updates. */
export const toggleSteps = (c: Ctx) => () => c.actions.pane(p => ({
  ...p, stack: p.stack.map((v, i) => (i === p.stack.length - 1 && v.kind === 'auto-update' ? { ...v, steps: !v.steps } : v)),
}))

/** Done goes through the game, so a second tap of 1 just after a press keeps its payoff on screen. */
const done = (c: Ctx) => btn(c, { key: 'auto-done', label: 'Done', hotkey: '1', primary: true, on: () => c.actions.autoUpdate('done') })

/** The switch, off, as a control: pressing the picture is pressing Turn it on. */
const offSwitch = (c: Ctx, look: Look): Art => ({
  svg: switchSvg('off', 'off', c.motion), alt: look.text,
  press: { region: 'auto-switch', on: () => c.actions.autoUpdate('on'), button: 'auto-on', name: 'Turn on auto-update' },
})
/** The switch where a press found Claude Code saving: as it was before the press, and pressing it is pressing Try again. */
const retrySwitch = (c: Ctx, look: Look, to: 'on' | 'off'): Art => {
  const at = to === 'on' ? 'off' : 'on'
  return {
    svg: switchSvg(at, at, c.motion), alt: look.text,
    press: { region: 'auto-switch', on: () => c.actions.autoUpdate(to), button: 'auto-retry', name: to === 'on' ? 'Turn on auto-update' : 'Turn off auto-update' },
  }
}

/**
 * On: the payoff and the way back to off (here when the switch put it there, else where /plugin has it, unless
 * `offRoute` is false).
 */
function onScreen(c: Ctx, o: SectionOptions, look: Look): Shown {
  const ours = !!c.state.account.autoUpdateOurs && !!c.state.account.autoUpdateWritable
  const byHand = !ours && o.offRoute !== false
  const checks = 'Claude Code checks for a new Spinlings each time it starts.'
  const top = c.surface === 'terminal' || !o.art
    ? column(c, [chip(c, look, o.boldChip), o.sub ? line(c, `${MARK.sparkle} ${checks}`, { color: INK.good }) : null], SPACE.none)
    : hero(c, o, look, checks, { svg: onSvg(c.motion), alt: 'Auto-update is on' })
  const off = c.surface === 'terminal' ? `To turn it off: ${pathTo('Disable auto-update')}` : `To turn it off, in Claude Code in a terminal: ${pathTo('Disable auto-update')}`
  return {
    body: column(c, [
      top,
      byHand ? para(c, off, { dim: true }) : null,
      actions(c, [
        done(c),
        ours
          ? btn(c, { key: 'auto-off', label: 'Turn it off', hotkey: '2', dim: true, on: () => c.actions.autoUpdate('off') })
          : byHand ? btn(c, { key: 'auto-copy-off', label: `Copy ${PLUGIN_COMMAND}`, hotkey: '2', on: () => c.actions.autoUpdate(copyAnswer(c)) }) : null,
      ]),
    ], SPACE.loose),
    hints: ['1 Done', ...(ours ? ['2 Turn it off'] : byHand ? [`2 Copy ${PLUGIN_COMMAND}`] : []), 'esc Back'],
  }
}

/**
 * Off by default: one press turns it on, with what it touches said plainly under it. On the terminal the /plugin
 * steps wait behind Show steps; elsewhere the press is the only way here, so there is nothing to show.
 */
function offerScreen(c: Ctx, o: SectionOptions, look: Look, view: Guide): Shown {
  const terminal = c.surface === 'terminal'
  const open = terminal && !!view.steps
  return {
    body: column(c, [
      hero(c, o, look, 'Get new creatures and fixes by themselves.', offSwitch(c, look)),
      column(c, [
        actions(c, [btn(c, { key: 'auto-on', label: 'Turn it on', hotkey: '1', primary: true, on: () => c.actions.autoUpdate('on') })]),
        para(c, 'Sets one switch in Claude Code\'s plugin list. Turn it off here anytime.', { dim: true }),
      ], SPACE.none),
      terminal ? actions(c, [btn(c, { key: 'auto-steps', label: open ? 'Hide steps' : 'Show steps', hotkey: '2', dim: true, on: toggleSteps(c) })]) : null,
      ...(open ? steps(c, 'on', '3') : []),
    ], SPACE.loose),
    hints: ['1 Turn it on', ...(terminal ? [`2 ${open ? 'Hide' : 'Show'} steps`] : []), ...(open ? ['3 Copy'] : []), 'esc Back'],
  }
}

/** Where to do it by hand as the whole section, under the chip and the line that says why. */
function stepsScreen(c: Ctx, o: SectionOptions, look: Look, why: string, to: 'on' | 'off' = 'on'): Shown {
  return {
    body: column(c, [hero(c, o, look, why, null), ...steps(c, to, '1')], SPACE.loose),
    hints: ['1 Copy', 'esc Back'],
  }
}

/** A press under way: the switch slides, the line under the chip says so in place, and nothing more can be pressed. */
function pressingScreen(c: Ctx, o: SectionOptions, look: Look, to: 'on' | 'off'): Shown {
  const words = to === 'on' ? 'Turning on…' : 'Turning off…'
  return {
    body: hero(c, { ...o, sub: true }, look, words, { svg: switchSvg(to === 'on' ? 'off' : 'on', to, c.motion), alt: words }),
    hints: ['esc Back'],
  }
}

/** How the last press ended, when it did not end as asked. */
function failedScreen(c: Ctx, o: SectionOptions, look: Look, press: Extract<AutoPress, { phase: 'done' }>): Shown {
  // why it did not take is the point of these screens: their line always shows
  const withLine = { ...o, sub: true }
  switch (press.result) {
    case 'busy': return {
      body: column(c, [
        hero(c, withLine, look, BUSY, retrySwitch(c, look, press.to)),
        actions(c, [btn(c, { key: 'auto-retry', label: 'Try again', hotkey: '1', primary: true, on: () => c.actions.autoUpdate(press.to) })]),
      ], SPACE.loose),
      hints: ['1 Try again', 'esc Back'],
    }
    case 'broken': {
      // Claude Code refuses every plugin-list command while the file does not parse, so the one way out is a fresh list.
      // Off the terminal /plugin cannot run, so there it is the shell's command, in a terminal
      const folder = press.folder ?? null
      const add = folder ? '2' : '1'
      const shell = c.surface !== 'terminal'
      return {
        body: column(c, [
          hero(c, withLine, look, BROKEN, null),
          folder
            ? step(c, 0, BROKEN_DELETE, <c.el.Text bold wrap="wrap">{folder}</c.el.Text>,
              btn(c, { key: 'auto-copy-folder', label: 'Copy folder', hotkey: '1', primary: true, on: () => c.actions.autoUpdate('copy-folder') }))
            : para(c, 'Delete known_marketplaces.json from Claude Code\'s plugins folder.'),
          step(c, folder ? 1 : 0, BROKEN_ADD, shell
            ? <c.el.Text wrap="wrap"><c.el.Text dimColor>In a terminal: </c.el.Text><c.el.Text bold>{ADD_SHELL_COMMAND}</c.el.Text></c.el.Text>
            : <c.el.Text bold wrap="wrap">{ADD_COMMAND}</c.el.Text>,
            btn(c, { key: 'auto-copy-add', label: 'Copy command', hotkey: add, primary: !folder, on: () => c.actions.autoUpdate(shell ? 'copy-add-shell' : 'copy-add') })),
        ], SPACE.loose),
        hints: [...(folder ? ['1 Copy folder'] : []), `${add} Copy command`, 'esc Back'],
      }
    }
    default: return stepsScreen(c, withLine, look, `Couldn't change it from here. ${c.surface === 'terminal' ? `In ${PLUGIN_COMMAND}:` : `Turn it ${press.to} by hand:`}`, press.to)
  }
}

/**
 * The section as /spin updates draws it under its version card: the chip, and for the state it is in the press, the
 * steps or the payoff. It never draws the ctrl+x tab note: the screen puts that before anything to press.
 */
export function autoUpdateSection(c: Ctx, view: Guide, o: SectionOptions): Shown {
  const a = c.state.account
  const look = lookOf(c)
  const press = c.state.pane.autoPress ?? null
  const state = a.autoUpdate ?? 'unknown'
  if (a.autoUpdateHeld) {
    return {
      body: column(c, [hero(c, { ...o, sub: true }, look, 'Claude Code\'s updates are turned off on this computer.', null), actions(c, [done(c)])], SPACE.loose),
      hints: ['1 Done', 'esc Back'],
    }
  }
  if (press?.phase === 'pressing') return pressingScreen(c, o, look, press.to)
  if (press?.phase === 'done' && press.result !== 'ok') return failedScreen(c, o, look, press)
  if (state === 'on') return onScreen(c, o, look)
  if (state === 'off' && a.autoUpdateWritable) {
    if (press?.phase === 'done' && press.to === 'off') {
      return {
        body: column(c, [
          hero(c, o, look, 'Claude Code\'s plugin list is back as it was.', offSwitch(c, look)),
          actions(c, [done(c), btn(c, { key: 'auto-on', label: 'Turn it on', hotkey: '2', dim: true, on: () => c.actions.autoUpdate('on') })]),
        ], SPACE.loose),
        hints: ['1 Done', '2 Turn it on', 'esc Back'],
      }
    }
    return offerScreen(c, o, look, view)
  }
  const withLine = { ...o, sub: true }
  if (state === 'off-chosen') return stepsScreen(c, withLine, look, 'Auto-update was turned off in Claude Code. To turn it back on:', 'on')
  return stepsScreen(c, withLine, look, c.surface === 'terminal' ? 'New creatures and fixes, no commands. Three steps in Claude Code:' : 'New creatures and fixes, no commands.')
}

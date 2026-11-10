// /spin updates (SPEC 32): one screen that answers "is an update out?" first, gives the one action that gets it, and
// then what it brings. Nothing here asks a server anything: the card rests on the day's version check, and the notes
// on what spinlings.dev said there or what this mod carries.
import type { RenderElement } from 'claude-code'
import type { ReleaseHighlight, ReleaseNote } from '../core/api.ts'
import { NOTE_READ } from '../core/schemas.ts'
import { WHATS_NEW } from '../core/servers.ts'
import { utcDay } from '../core/world.ts'
import { PLUGIN_COMMAND, arrivesByItself, oneTapOn } from '../client/autoupdate.ts'
import { newerMod } from '../client/game.ts'
import { linkHref } from '../client/net.ts'
import { CLIENT_VERSION, UPDATE_COMMAND } from '../client/remote.ts'
import { dayLabel, safe } from '../client/text.ts'
import type { View } from '../client/types.ts'
import { bundledSince, labelsOf, shortOf } from '../client/whatsnew.ts'
import type { Ctx, Shown } from './pane-kit.tsx'
import { actions, btn, column, feedback, para } from './pane-kit.tsx'
import type { Art, SectionOptions } from './pane-autoupdate.tsx'
import {
  ART, BUSY, KEYS_NOTE, artBeside, autoUpdateSection, chip, failedPress, lookOf, menuRow, onSvg, pathTo, screenshot, step,
  toggleSteps, typedPlugin,
} from './pane-autoupdate.tsx'
import { INK, MARK, SPACE } from './tokens.ts'

type Guide = Extract<View, { kind: 'auto-update' }>

/**
 * How this mod stands with its server, beyond out, needed and here: checked on a day, or why that is not known, as
 * the one-line card says it (`words`, after the version) and as the line under "is here" says it (`under`).
 */
type Standing = { kind: 'current'; day: string } | { kind: 'note'; words: string; under: string }

/** What the card says, in its order of precedence: needed, then out, then here, then the standing. */
type Card =
  | { kind: 'needed'; target: string | null }
  | { kind: 'out'; target: string; arrives: boolean }
  | { kind: 'here'; from: string; standing: Standing }
  | { kind: 'standing'; standing: Standing }

const version = (v: string) => safe(v, 16)

/** `today`, `yesterday` or `on 2026-11-07`. */
function checkedOn(day: string, now: number): string {
  const d = dayLabel(day, utcDay(now))
  return d === 'today' || d === 'yesterday' ? d : `on ${d}`
}

function standingOf(c: Ctx): Standing {
  const a = c.state.account
  const host = safe(a.host, 80)
  if (a.world === 'offline') return { kind: 'note', words: 'playing offline', under: 'Playing offline' }
  if (a.checked) return { kind: 'current', day: checkedOn(a.checked, c.now) }
  // a link still coming up will ask: until it has, nothing says the server has no answer
  if (a.checking || a.link === 'starting' || a.link === 'joining') return { kind: 'note', words: `asking ${host}…`, under: `Asking ${host}…` }
  if (a.link === 'unreachable') return { kind: 'note', words: `can't reach ${host} right now`, under: `Can't reach ${host} right now` }
  return { kind: 'note', words: `${host} doesn't say which version is newest`, under: `${host} doesn't say which version is newest` }
}

function cardOf(c: Ctx, view: Guide): Card {
  const a = c.state.account
  const target = newerMod(a)
  if (a.world === 'online' && a.readOnly) return { kind: 'needed', target: target ? version(target) : null }
  if (target) return { kind: 'out', target: version(target), arrives: arrivesByItself(a) }
  if (view.here !== undefined) return { kind: 'here', from: view.here, standing: standingOf(c) }
  return { kind: 'standing', standing: standingOf(c) }
}

// ---------- the badge: the card's one picture on the desktop ----------

/** A four-point star, centred on 0,0. */
const STAR = 'M0 -17C1.6 -5.5 5.5 -1.6 17 0C5.5 1.6 1.6 5.5 0 17C-1.6 5.5 -5.5 1.6 -17 0C-5.5 -1.6 -1.6 -5.5 0 -17Z'

/**
 * The badge's markup rests on its kind, motion and pulse alone, so the guide's reads of the plugin list every
 * few seconds never start its animation over. Out: a gold star that swells twice as it appears (while motion is on and
 * there is something to press). Needed: a padlock in the warning ink, still. Here: the check with its twinkles.
 */
function badgeSvg(kind: 'needed' | 'out' | 'here', motion: boolean, pulse = false): string {
  if (kind === 'here') return onSvg(motion)
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART} ${ART}" width="${ART}" height="${ART}">`
  if (kind === 'needed') {
    return open
      + `<path d="M16 22V16a8 8 0 0 1 16 0v6" fill="none" stroke="${INK.warn}" stroke-width="4" stroke-linecap="round"/>`
      + `<rect x="11" y="21" width="26" height="20" rx="4" fill="${INK.warn}"/>`
      + '<circle cx="24" cy="29.5" r="3" fill="#3a2a08"/><rect x="22.6" y="30" width="2.8" height="6" rx="1.2" fill="#3a2a08"/></svg>'
  }
  const swell = motion && pulse ? '<animateTransform attributeName="transform" type="scale" values="1;1.15;1" dur="0.9s" repeatCount="2"/>' : ''
  return open
    + `<g transform="translate(24 24)"><g>${swell}<path d="${STAR}" fill="${INK.accent}"/>`
    + `<path d="M0 -9C0.8 -3 3 -0.8 9 0C3 0.8 0.8 3 0 9" fill="${INK.bright}" opacity="0.35"/></g></g>`
    + `<path d="M39 7l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" fill="${INK.accent}" opacity="0.7"/></svg>`
}

// ---------- A: the version card ----------

/** The card's words: the headline, its terminal glyph and that glyph's colour, and the line under it. */
function wordsOf(card: Exclude<Card, { kind: 'standing' }>): { mark: string; color: string; head: string; under: string } {
  const mine = version(CLIENT_VERSION)
  switch (card.kind) {
    case 'needed': return {
      mark: MARK.dot, color: INK.warn, head: 'Update to keep playing online',
      under: card.target ? `Spinlings ${card.target} is out · you have ${mine}` : `You have ${mine}`,
    }
    case 'out': return {
      mark: MARK.sparkle, color: INK.accent, head: `Spinlings ${card.target} is out`,
      under: card.arrives ? `You have ${mine} · it arrives by itself the next time Claude Code starts` : `You have ${mine}`,
    }
    case 'here': {
      const s = card.standing
      return { mark: MARK.sparkle, color: INK.accent, head: `Spinlings ${mine} is here`, under: s.kind === 'current' ? `Up to date · checked ${s.day}` : s.under }
    }
  }
}

/** What a click on the card's badge does, and what assistive tech calls it. */
type Press = { on: () => unknown; name: string }

/**
 * The version card. Out, needed and here: the headline in bold with a dim line under it, beside its badge on the
 * desktop and after its glyph on the terminal; the words are never coloured, so the meaning never rests on colour.
 * Otherwise one line: up to date with the day it was checked, or why that is not known.
 */
function versionCard(c: Ctx, card: Card, press: Press | null): RenderElement {
  const { Box, Text } = c.el
  const mine = version(CLIENT_VERSION)
  if (card.kind === 'standing') {
    const s = card.standing
    if (s.kind === 'current') {
      // whole phrases that wrap only between each other, so a narrow pane never leaves "today" alone on a line
      return (
        <Box key="version-card" flexDirection="row" columnGap={SPACE.tight} width={c.columns}>
          <Text color={INK.good}>{MARK.check}</Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.tight} flexShrink={1}>
            <Text>Up to date</Text>
            <Text>{`· Spinlings ${mine}`}</Text>
            <Text>{`· checked ${s.day}`}</Text>
          </Box>
        </Box>
      )
    }
    return <Box key="version-card" width={c.columns}><Text dimColor wrap="wrap">{`Spinlings ${mine} · ${s.words}`}</Text></Box>
  }
  const w = wordsOf(card)
  if (c.surface === 'terminal') {
    return (
      <Box key="version-card" flexDirection="column" width={c.columns}>
        <Box flexDirection="row" columnGap={SPACE.tight} width={c.columns}>
          <Text color={w.color}>{w.mark}</Text>
          <Text bold wrap="wrap">{w.head}</Text>
        </Box>
        <Text dimColor wrap="wrap">{w.under}</Text>
      </Box>
    )
  }
  const pulse = card.kind === 'out' && !card.arrives
  // a click on the star does what Update now does: it shows (or hides) the steps, and writes nothing
  const badge: Art = {
    svg: badgeSvg(card.kind, c.motion, pulse), alt: card.kind === 'needed' ? 'Update needed to play online' : w.head,
    ...(press ? { press: { region: 'update-star', on: press.on, button: 'update-hand', name: press.name } } : {}),
  }
  return artBeside(c, 'version-card', badge, [<Text bold wrap="wrap">{w.head}</Text>, <Text dimColor wrap="wrap">{w.under}</Text>])
}

// ---------- B: getting it ----------

/**
 * How to update by hand, as each surface really offers it, Copy on `hotkey`. The terminal: one trip through its /plugin
 * menu (Installed, Spinlings, Update now; closing the menu reloads), and with `third` the auto-update toggle on the
 * way out. Claude Desktop answers /plugin with its own plugin page, whose Update button installs it, and reloads
 * plugins by itself between turns; it has no auto-update toggle, so there is no third step. Elsewhere (an editor, the
 * phone) /plugin is not at hand: the command, in a terminal.
 */
function handSteps(c: Ctx, hotkey: string, third: boolean): RenderElement[] {
  const { Box, Text } = c.el
  const primary = hotkey === '1'
  const copy = btn(c, { key: 'update-copy', label: 'Copy', hotkey, primary, on: () => c.actions.autoUpdate('copy') })
  const then = (words: string) => para(c, words, { dim: true })
  if (c.surface === 'terminal') {
    const toggle = <Text><Text dimColor>{'○ '}</Text><Text>Enable auto-update</Text></Text>
    return [
      step(c, 0, `Type ${PLUGIN_COMMAND}`, typedPlugin(c, 'update-shot-0'), copy),
      step(c, 1, 'Open Installed, pick Spinlings, choose Update now', screenshot(c, 'update-shot-1', [
        menuRow(c, 'Installed', 0), menuRow(c, 'Spinlings', 1), menuRow(c, 'Update now', 2),
      ])),
      third ? step(c, 2, 'While you\'re there: Marketplaces, pick spinlings, choose Enable auto-update', screenshot(c, 'update-shot-2', [
        menuRow(c, 'Marketplaces', 0), menuRow(c, 'spinlings', 1), menuRow(c, toggle, 2),
      ])) : null,
      then('Then close the menu.'),
    ].filter((x): x is RenderElement => x !== null)
  }
  if (c.surface === 'desktop') {
    return [
      step(c, 0, `Type ${PLUGIN_COMMAND}, pick Spinlings`, typedPlugin(c, 'update-shot-0'), copy),
      step(c, 1, 'Press Update', screenshot(c, 'update-shot-1', [
        <Text bold>Spinlings</Text>,
        <Text bold color={INK.accent}>Update</Text>,
      ])),
      then('The new version loads by itself between turns.'),
    ]
  }
  return [
    <Box key="update-command" flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
      <Text wrap="wrap"><Text dimColor>In a terminal: </Text><Text>{UPDATE_COMMAND}</Text></Text>
      {btn(c, { key: 'update-copy', label: 'Copy command', hotkey, primary, on: () => c.actions.copyUpdate() })}
    </Box>,
    then('Then run /reload-plugins.'),
  ]
}

/** `Update now` over the steps, kept together as one block. */
function byHand(c: Ctx, hotkey: string, third: boolean): RenderElement {
  return column(c, [<c.el.Text key="update-heading" bold>Update now</c.el.Text>, ...handSteps(c, hotkey, third)], SPACE.tight)
}

/**
 * The auto-update chip on its own, below the steps. After a Turn it on that could not be done here, a dim line says so
 * and where it can be done: step ❸ on the terminal, Claude Code in a terminal anywhere else.
 */
function chipBelow(c: Ctx, failed: string | null, third: boolean): RenderElement {
  const why = failed !== 'cannot' ? null
    : c.surface !== 'terminal' ? `Couldn't turn it on from here. In Claude Code in a terminal: ${pathTo('Enable auto-update')}`
    : third ? 'Couldn\'t turn it on from here. Step ❸ does it.'
    : 'Couldn\'t turn it on from here.'
  return column(c, [chip(c, lookOf(c), false), why ? para(c, why, { dim: true }) : null], SPACE.none)
}

/** What to press, its keys, what comes after it (the chip alone, when the switch is not the press), and the badge's press. */
type Action = { block: RenderElement | null; hints: string[]; after: RenderElement | null; press: Press | null }

/** The auto-update section as the whole action, with its own keys. */
function sectionAction(c: Ctx, view: Guide, o: SectionOptions): Action {
  const s = autoUpdateSection(c, view, o)
  return { block: s.body, hints: s.hints, after: null, press: null }
}

/**
 * After a press that left the plugin list unreadable: Claude Code refuses /plugin as well until it is put right, so the
 * way to put it right comes first, in place of any update steps.
 */
function fixListFirst(c: Ctx, view: Guide): Action {
  return sectionAction(c, view, { art: false, sub: true, boldChip: true })
}

/**
 * What to press to get the release, by how auto-update stands. On and able: nothing to do here, so the section says
 * so. Off and one press away: Turn it on, with Update now for those who want it today. A list left unreadable: putting
 * it right. Otherwise: the steps, open.
 */
function getOut(c: Ctx, card: Extract<Card, { kind: 'out' }>, view: Guide): Action {
  // the card says it is on its way: Done, and Turn it off where the switch put it there, nothing more
  if (card.arrives) return sectionAction(c, view, { art: false, sub: false, boldChip: false, offRoute: false })
  const failed = failedPress(c)
  if (failed === 'broken') return fixListFirst(c, view)
  if (oneTapOn(c.state.account) && failed !== 'cannot') {
    // a press under way says so in place; one that ended badly says how, as the section does
    if (c.state.pane.autoPress?.phase === 'pressing' || failed) return sectionAction(c, view, { art: false, sub: true, boldChip: failed !== null })
    const open = !!view.steps
    const toggle = toggleSteps(c)
    return {
      block: column(c, [
        // the switch's state and its press belong together; Update now is the other way, a block of its own
        column(c, [
          chip(c, lookOf(c), false),
          column(c, [
            actions(c, [btn(c, { key: 'auto-on', label: 'Turn it on', hotkey: '1', primary: true, on: () => c.actions.autoUpdate('on') })]),
            para(c, `Sets one switch in Claude Code's plugin list, and ${card.target} arrives by itself the next time Claude Code starts.`, { dim: true }),
          ], SPACE.none),
        ], SPACE.tight),
        column(c, [
          actions(c, [btn(c, { key: 'update-hand', label: open ? 'Hide steps' : 'Update now', hotkey: '2', dim: true, on: toggle })]),
          ...(open ? handSteps(c, '3', false) : []),
        ], SPACE.tight),
      ], SPACE.loose),
      hints: ['1 Turn it on', `2 ${open ? 'Hide steps' : 'Update now'}`, ...(open ? ['3 Copy'] : []), 'esc Back'],
      after: null,
      press: { on: toggle, name: open ? 'Hide the update steps' : 'Show the update steps' },
    }
  }
  // off by choice, not known, a list the switch cannot write (or could not), or updates held here: the steps, open
  const third = togglesByHand(c, failed)
  return { block: byHand(c, '1', third), hints: ['1 Copy', 'esc Back'], after: chipBelow(c, failed, third), press: null }
}

/**
 * The update steps take the auto-update toggle along (in the terminal's /plugin, on the way out) only where the
 * switch could not set it and the player never chose off: not known, or off with a list the switch cannot write.
 */
function togglesByHand(c: Ctx, failed: string | null): boolean {
  const a = c.state.account
  const state = a.autoUpdate ?? 'unknown'
  return !a.autoUpdateHeld && (state === 'unknown' || state === 'off' && (!a.autoUpdateWritable || failed === 'cannot'))
}

/**
 * This version can't play online until updated: the fastest path first, the steps open, whatever auto-update says;
 * where the switch can turn it on, a quiet second press so the next one never needs this.
 */
function getNeeded(c: Ctx, view: Guide): Action {
  const pressing = c.state.pane.autoPress?.phase === 'pressing'
  const failed = failedPress(c)
  if (failed === 'broken') return fixListFirst(c, view)
  const canTurnOn = oneTapOn(c.state.account) && failed !== 'cannot'
  const third = togglesByHand(c, failed)
  // the switch, where it can be pressed, under its chip as in the other states; else the chip alone, further down
  const second = !canTurnOn ? null : column(c, [
    chip(c, lookOf(c), false),
    pressing ? para(c, 'Turning on…', { dim: true }) : column(c, [
      actions(c, [btn(c, { key: 'auto-on', label: failed === 'busy' ? 'Try again' : 'Turn it on', hotkey: '2', dim: true, on: () => c.actions.autoUpdate('on') })]),
      para(c, failed === 'busy' ? BUSY : 'Then each new Spinlings arrives by itself when Claude Code starts.', { dim: true }),
    ], SPACE.none),
  ], SPACE.tight)
  return {
    block: column(c, [byHand(c, '1', third), second], SPACE.loose),
    hints: ['1 Copy', ...(canTurnOn && !pressing ? [failed === 'busy' ? '2 Try again' : '2 Turn it on'] : []), 'esc Back'],
    after: canTurnOn ? null : chipBelow(c, failed, third),
    press: null,
  }
}

/** Nothing newer to get: the auto-update section as it is, its art beside it unless the card has the badge. */
function getStanding(c: Ctx, card: Card, view: Guide): Action {
  return sectionAction(c, view, { art: card.kind !== 'here', sub: true, boldChip: true })
}

// ---------- the notes ----------

/** One highlight: the mark, then its label and, dim, its sentence, wrapping as one; nothing bold. */
function noteRow(c: Ctx, highlight: ReleaseHighlight, i: number): RenderElement {
  const { Box, Text } = c.el
  return (
    <Box key={`note-${i}`} flexDirection="row" columnGap={SPACE.tight} width={c.columns}>
      <Box flexShrink={0}><Text color={INK.accent}>{MARK.sparkle}</Text></Box>
      <Box flexShrink={1}>
        <Text wrap="wrap"><Text>{shortOf(highlight)}</Text><Text>{'  '}</Text><Text dimColor>{safe(highlight.text, NOTE_READ.text)}</Text></Text>
      </Box>
    </Box>
  )
}

/** `Also new since 0.3.0: Open all · Auto-update`: the older releases' labels, newest first, wrapping, never cut. */
const alsoLine = (c: Ctx, notes: readonly ReleaseNote[], since: string) =>
  notes.length === 0 ? null : para(c, `Also new since ${version(since)}: ${labelsOf(notes)}`, { dim: true })

/** Every release, on spinlings.dev, at the release on show. */
function everyRelease(c: Ctx, shown: string): RenderElement | null {
  const { Link, Text } = c.el
  const href = linkHref(`${WHATS_NEW}#v${shown}`)
  if (!href) return null
  if (c.surface === 'terminal') return <Text key="every-release" wrap="wrap"><Text dimColor>{'Every release: '}</Text><Link href={href}>spinlings.dev/whats-new</Link></Text>
  return <Link key="every-release" href={href}>Every release</Link>
}

/**
 * The notes: for a release out (or needed), what spinlings.dev says it brings, the newest in full and older ones as a
 * line of labels; from another server, or with none known, the link alone. Otherwise what this version brought, as
 * the mod itself carries it, and just after an update the releases since the one before.
 */
function notesBlock(c: Ctx, card: Card): RenderElement | null {
  const mine = CLIENT_VERSION
  const fromServer = card.kind === 'out' || card.kind === 'needed'
  let release: ReleaseNote | null
  let older: ReleaseNote[]
  let since = mine
  if (fromServer) {
    const notes = c.state.account.community ? [] : c.state.account.notes ?? []
    release = notes[0] ?? null
    older = notes.slice(1)
  } else {
    const bundled = bundledSince(card.kind === 'here' ? card.from : '', mine)
    release = bundled.find(n => n.version === mine) ?? null
    older = bundled.filter(n => n.version !== mine)
    if (card.kind === 'here' && card.from) since = card.from
  }
  const shown = release?.version ?? (fromServer ? card.target ?? mine : mine)
  const rows = release ? column(c, [
    para(c, `New in ${version(release.version)}`, { dim: true }),
    ...release.highlights.map((note, i) => noteRow(c, note, i)),
  ], SPACE.none) : null
  return column(c, [rows, release ? alsoLine(c, older, since) : null, everyRelease(c, shown)], SPACE.tight)
}

// ---------- the screen ----------

/**
 * Top to bottom: the version card, the ctrl+x tab note before anything to press, the way to get a newer release, what
 * that press said, the chip when the switch is not the press, the release notes and the link to every release.
 */
export function updatesScreen(c: Ctx): Shown {
  const top = c.state.pane.stack.at(-1)
  const view: Guide = top?.kind === 'auto-update' ? top : { kind: 'auto-update' }
  const card = cardOf(c, view)
  const action = card.kind === 'out' ? getOut(c, card, view) : card.kind === 'needed' ? getNeeded(c, view) : getStanding(c, card, view)
  // opened by a band press, the pane has no keyboard yet: the one key that hands it over, before anything to press
  const note = c.surface === 'terminal' && c.focused === false ? para(c, KEYS_NOTE, { dim: true }) : null
  return {
    body: column(c, [
      column(c, [versionCard(c, card, action.press), note], SPACE.tight),
      column(c, [action.block, feedback(c)], SPACE.tight),
      action.after,
      notesBlock(c, card),
    ], SPACE.loose),
    hints: action.hints,
    bare: true,
    feedback: 'inline',
  }
}

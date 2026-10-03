// The pane's building blocks (SPEC 21): the header on every screen (tabs left; daily rule, pack meter, world and
// server right), the one button, the card at the pane's sizes, the 2-second hold line, feedback and the hint row, whose
// hints fit whole (the way out always stays) and whose right end carries the mod's version where there is room and,
// when the server names a newer one, the chip that gives the update command.
// Keys: on a tab's own screen 1-4 switch tabs and `o` opens a pack; a pushed view or a ceremony keeps 1-3 for its own
// choices and the tabs stay pressable without keys, so a key never means two things on one screen.
import type { RenderElement } from 'claude-code'
import type { Form } from '../core/types.ts'
import { RULE_INFO, dailyRule } from '../core/world.ts'
import type { Actions, El, GameState, HoldAction, Presence, Surface, Tab } from '../client/types.ts'
import { newerMod } from '../client/game.ts'
import { CLIENT_VERSION, UPDATE_COMMAND } from '../client/remote.ts'
import { bar, cells, dots, fit, safe, span } from '../client/text.ts'
import { HOLD_VERB, holdText } from '../client/viewmodels.ts'
import { CARD_WIDTH, card, formArt } from './card.tsx'
import type { CardFace, CardOptions } from './card.tsx'
import { svgHold } from './ceremony-art.tsx'
import { INK, MARK, SPACE } from './tokens.ts'

/** Everything a pane screen draws from. */
export type Ctx = {
  el: El
  surface: Surface
  columns: number
  rows: number
  now: number
  actions: Actions
  state: GameState
  /** a tab's own screen (digits switch tabs) rather than a pushed view or a ceremony (digits choose) */
  root: boolean
  offline: boolean
  motion: boolean
  /** the footer's version chip takes `u`: everywhere but inside /spin demo, whose own Previous is on u */
  versionKey: boolean
}

/** What a screen hands the frame. `bare`: the screen says how the link stands itself, so the frame's note stays out. */
export type Shown = { body: RenderElement; hints: string[]; banner?: RenderElement | null; bare?: boolean }

/** A chip: the 8x8 mini in a 10-cell column (pickers, offers, the album). */
export const CHIP = CARD_WIDTH.mini
/** A tile: the framed 16x16 art in an 18-cell column (team, collection, summaries). */
export const TILE = CARD_WIDTH.tile

export const TABS: readonly { tab: Tab; label: string; hotkey: string }[] = [
  { tab: 'team', label: 'Team', hotkey: '1' },
  { tab: 'cards', label: 'Cards', hotkey: '2' },
  { tab: 'album', label: 'Album', hotkey: '3' },
  { tab: 'trade', label: 'Trade', hotkey: '4' },
]

/** `next pack ███░░ 18 min`, or why it waits (SPEC 13.8). */
export function packMeter(p: Presence, width = 5): string {
  if (p.blocked === 'bank') return 'Open some packs to make room'
  const left = Math.max(0, p.need - p.minutes)
  if (left === 0) return 'next pack any moment'
  return `next pack ${bar(p.minutes / p.need, width)} ${span(left * 60_000)}`
}

// ---------- buttons and text ----------

export type Btn = { key: string; label: string; hotkey?: string | undefined; primary?: boolean; dim?: boolean; on: () => unknown }

/** The one button: always plain (the hotkey shows in the accent colour); primary only with 1 or o (SPEC 21.1). */
export function btn(c: Ctx, b: Btn): RenderElement {
  const { Button } = c.el
  const extra = {
    ...(b.hotkey ? { hotkey: b.hotkey } : {}),
    ...(b.primary ? { variant: 'primary' as const } : {}),
    ...(b.dim ? { dimColor: true } : {}),
  }
  return <Button key={b.key} label={b.label} plain {...extra} onPress={() => { void b.on() }} />
}

/** A row of actions that wraps rather than overflows. */
export function actions(c: Ctx, items: (RenderElement | null | false)[]): RenderElement | null {
  const list = items.filter((x): x is RenderElement => !!x)
  if (list.length === 0) return null
  return <c.el.Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>{...list}</c.el.Box>
}

export function line(c: Ctx, text: string, o: { dim?: boolean; color?: string; bold?: boolean; italic?: boolean } = {}): RenderElement {
  const props = { ...(o.dim ? { dimColor: true } : {}), ...(o.color ? { color: o.color } : {}), ...(o.bold ? { bold: true } : {}), ...(o.italic ? { italic: true } : {}) }
  return <c.el.Text wrap="truncate-end" {...props}>{fit(text, c.columns)}</c.el.Text>
}

/** A paragraph that wraps (guidance, consequences). */
export function para(c: Ctx, text: string, o: { dim?: boolean; color?: string } = {}): RenderElement {
  const props = { ...(o.dim ? { dimColor: true } : {}), ...(o.color ? { color: o.color } : {}) }
  return <c.el.Box width={c.columns}><c.el.Text wrap="wrap" {...props}>{text}</c.el.Text></c.el.Box>
}

/** A section heading with an optional dim note on the right. */
export function heading(c: Ctx, text: string, note = ''): RenderElement {
  const { Box, Text } = c.el
  const room = Math.max(0, c.columns - text.length - SPACE.loose)
  return (
    <Box flexDirection="row" columnGap={SPACE.loose} width={c.columns}>
      <Text>{text}</Text>
      {note && room > 3 ? <Text dimColor wrap="truncate-end">{fit(note, room)}</Text> : null}
    </Box>
  )
}

export function column(c: Ctx, items: (RenderElement | null | false)[], gap: number = SPACE.tight): RenderElement {
  return <c.el.Box flexDirection="column" rowGap={gap} width={c.columns}>{...items.filter((x): x is RenderElement => !!x)}</c.el.Box>
}

/** Items laid out in rows of `per`, each `width` cells, a cell apart. */
export function grid(c: Ctx, items: RenderElement[], per: number): RenderElement {
  const { Box } = c.el
  const rows: RenderElement[] = []
  for (let i = 0; i < items.length; i += per) rows.push(<Box flexDirection="row" columnGap={SPACE.tight}>{...items.slice(i, i + per)}</Box>)
  return <Box flexDirection="column" rowGap={SPACE.tight}>{...rows}</Box>
}

// ---------- the one card, at the pane's sizes (ui/card.tsx) ----------

type Press = Pick<CardOptions, 'key' | 'on' | 'hotkey' | 'selected' | 'note' | 'dimmed'>

/** The mini card: art, name (pressable), family mark, rarity initial, level and finish; the same order everywhere. */
export const chip = (c: Ctx, x: CardFace, o: Press) => card(c.el, c.surface, x, 'mini', { ...o, motion: c.motion })
/** The tile card (SPEC 21: sprite, name, rarity initial, level), its name pressable, with an optional state line. */
export const tile = (c: Ctx, x: CardFace, o: Press) => card(c.el, c.surface, x, 'tile', { ...o, motion: c.motion })
/** A card as one row: the mini beside its name, marks and a note (narrow lists). */
export const cardRow = (c: Ctx, x: CardFace, o: Press) => card(c.el, c.surface, x, 'row', { ...o, motion: c.motion, width: c.columns })

/** A species (or any form) as a mini: its plain look at a stage, or its silhouette while unseen. */
export function formMini(c: Ctx, key: string, form: Form & { id?: string }, seen: boolean, stage: 1 | 2 | 3 = 1): RenderElement {
  return formArt(c.el, c.surface, key, form, seen, stage, 'mini')
}

// ---------- header, holds, feedback, hints ----------

/** A collection to play: not before the first answers, and not a signed-out machine's cached one. */
export function playable(s: GameState): boolean {
  return !!s.me && !(s.account.link === 'signed-out' && s.account.world === 'online')
}

/** `Online · spinlings.dev`, `Community · example.org`, `Offline`: the world and server, always in the header. */
export function worldBadge(s: GameState): string {
  const a = s.account
  if (a.world === 'offline') return 'Offline'
  return dots(a.community ? 'Community' : 'Online', a.host)
}

/** The header row on every screen (SPEC 21): tabs on the left; the daily rule, the pack meter and the world right. */
export function header(c: Ctx): RenderElement {
  const { Box, Text } = c.el
  const s = c.state
  const packs = playable(s) ? s.me!.packs.length : 0
  const rule = RULE_INFO[dailyRule(c.now)].name
  const meter = packMeter(s.presence)
  const link = s.account.link === 'unreachable' || s.account.link === 'signed-out'
  const world = link ? `${worldBadge(s)} ${MARK.bullet} not connected` : worldBadge(s)
  const tabs = (
    <Box flexDirection="row" columnGap={SPACE.tight} flexShrink={0}>
      {TABS.map(t => btn(c, { key: `tab-${t.tab}`, label: t.label, hotkey: c.root ? t.hotkey : undefined, dim: t.tab !== s.pane.tab, on: () => c.actions.tab(t.tab) }))}
    </Box>
  )
  const open = packs > 0 ? btn(c, { key: 'open-pack', label: `Open pack (${packs})`, hotkey: c.root ? 'o' : undefined, primary: c.root, on: () => c.actions.openPack() }) : null
  const tabsWidth = TABS.reduce((n, t) => n + t.label.length + (c.root ? 3 : 0), 0) + TABS.length - 1
  if (c.columns >= 110) {
    const room = c.columns - tabsWidth - (open ? `Open pack (${packs})`.length + 3 + SPACE.loose : 0) - SPACE.loose
    return (
      <Box flexDirection="row" columnGap={SPACE.loose} width={c.columns}>
        {tabs}
        {open}
        <Box flexGrow={1} justifyContent="flex-end"><Text dimColor wrap="truncate-end">{fit(dots(rule, meter, world), Math.max(4, room))}</Text></Box>
      </Box>
    )
  }
  const short = c.columns < 80 ? (link ? 'Not connected' : s.account.world === 'offline' ? 'Offline' : s.account.community ? 'Community' : 'Online') : world
  const second = c.columns < 80 ? dots(s.account.world === 'online' ? s.account.host : '', rule, meter) : dots(rule, meter)
  const room = c.columns - (open ? `Open pack (${packs})`.length + 3 + SPACE.loose : 0)
  return (
    <Box flexDirection="column" width={c.columns}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={SPACE.loose} width={c.columns}>
        {tabs}
        <Text dimColor wrap="truncate-end">{fit(short, Math.max(4, c.columns - tabsWidth - SPACE.loose))}</Text>
      </Box>
      <Box flexDirection="row" columnGap={SPACE.loose} width={c.columns}>
        {open}
        <Text dimColor wrap="truncate-end">{fit(second, Math.max(4, room))}</Text>
      </Box>
    </Box>
  )
}

/** The hold's consequence line, shown once armed (SPEC 21.8); on the desktop a bar fills over the 2 seconds. */
export function holdLine(c: Ctx, action: HoldAction, target: string, hotkey: string): RenderElement | null {
  const held = c.state.pane.hold
  if (!held || held.action !== action || held.target !== target) return null
  const { Box, Text, Svg } = c.el
  const text = `${holdText(action, target, c.state, c.now)} Press ${hotkey} again in 2 s to ${HOLD_VERB[action]}.`
  return (
    <Box flexDirection="row" columnGap={SPACE.tight} width={c.columns}>
      {c.surface === 'terminal' ? null : <Svg source={svgHold(c.motion)} alt="hold for 2 seconds" width={64} height={6} isInteractive={c.motion} />}
      <Box flexShrink={1}><Text color={INK.warn} wrap="wrap">{text}</Text></Box>
    </Box>
  )
}

/**
 * The pane's own feedback: a request under way (dim), the last plain-words message, a success in the good ink, and
 * what a clipboard did not take, line for line, to select and copy by hand.
 */
export function feedback(c: Ctx): RenderElement | null {
  const p = c.state.pane
  const items: RenderElement[] = []
  if (p.busy) items.push(line(c, `${safe(p.busy, 60)}…`, { dim: true }))
  if (p.message) items.push(para(c, safe(p.message, 160), { color: p.tone === 'good' ? INK.good : INK.warn }))
  if (p.toCopy) {
    items.push(line(c, 'To share it, copy this:', { dim: true }))
    items.push(<c.el.Box flexDirection="column" width={c.columns}>{...p.toCopy.split('\n').slice(0, 16).map(l => <c.el.Text wrap="wrap">{safe(l, 200)}</c.el.Text>)}</c.el.Box>)
  }
  return items.length > 0 ? column(c, items, SPACE.none) : null
}

/** The update command's row is open: the version chip offered a newer mod and was pressed. */
const updateOpen = (c: Ctx) => c.state.pane.showUpdate && !!newerMod(c.state.account)

/**
 * The link's own line when it is not ready, and the read-only notice (SPEC 32), which gives the update command
 * unless the update row right below already shows it.
 */
export function linkNote(c: Ctx): RenderElement | null {
  const a = c.state.account
  if (a.world === 'online' && a.readOnly) {
    return para(c, updateOpen(c) ? `This version is read-only on ${a.host}.` : `This version is read-only on ${a.host} · ${UPDATE_COMMAND}`, { color: INK.warn })
  }
  if (a.link !== 'ready' && a.note) return para(c, safe(a.note, 160), { dim: true })
  return null
}

/** From this many columns the version chip reads `Update to 0.2.0`; narrower, `Update 0.2.0`. */
export const CHIP_WIDE = 60
/** The chip's label while the update row is open: pressing it again closes the row, as esc does. */
export const CHIP_HIDE = 'Hide update'

/**
 * The hint row's right end (SPEC 32): this mod's version, dim, never asking for anything, shown where the hints leave
 * room for it. When the server names a newer mod it becomes a chip that always shows, a verb with its version
 * (`u: Update to 0.2.0`), that opens the update command; while that is open it reads `Hide update` and u copies the
 * command, so the chip itself carries no key.
 */
export function versionChip(c: Ctx): { node: RenderElement; width: number; chip: boolean } {
  const latest = newerMod(c.state.account)
  if (!latest) {
    const label = `v${CLIENT_VERSION}`
    return { node: <c.el.Text dimColor wrap="truncate-end">{label}</c.el.Text>, width: cells(label), chip: false }
  }
  const open = c.state.pane.showUpdate
  const label = open ? CHIP_HIDE : fit(c.columns >= CHIP_WIDE ? `Update to ${latest}` : `Update ${latest}`, Math.max(8, Math.floor(c.columns / 2)))
  const hotkey = c.versionKey && !open ? 'u' : undefined
  const node = btn(c, { key: 'version', label, hotkey, dim: open, on: () => c.actions.pane(p => ({ ...p, showUpdate: !p.showUpdate, message: '' })) })
  return { node, width: cells(label) + (hotkey ? 3 : 0), chip: true }
}

/** The update command the chip opened, right above it: what it is for, the command, and Copy on u (SPEC 32). */
export function updateRow(c: Ctx): RenderElement | null {
  if (!updateOpen(c)) return null
  const { Box, Text } = c.el
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
      <Text wrap="wrap"><Text dimColor>In a terminal: </Text><Text>{UPDATE_COMMAND}</Text></Text>
      {btn(c, { key: 'copy-update', label: 'Copy', hotkey: c.versionKey ? 'u' : undefined, on: () => c.actions.copyUpdate() })}
    </Box>
  )
}

const HINT_SEP = ` ${MARK.bullet} `

/** The index of the last hint that passes `test`, or -1. */
function lastIndex(items: readonly string[], test: (hint: string) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i]!)) return i
  return -1
}

const isEsc = (hint: string) => hint.startsWith('esc ')
/** The way out of a screen: `esc Close`, `esc Back`, `esc Done`, or a ceremony's `d Done` where it has no esc. */
const leaves = (hint: string) => isEsc(hint) || hint === 'd Done'

/**
 * A screen's hints with the update row open: esc closes the row first (SPEC 32), so the way out says so.
 */
export function hintsOf(c: Ctx, hints: readonly string[]): string[] {
  const items = hints.filter(Boolean)
  if (!updateOpen(c)) return items
  const esc = lastIndex(items, isEsc)
  const hide = `esc ${CHIP_HIDE}`
  return esc < 0 ? [...items, hide] : items.map((h, i) => (i === esc ? hide : h))
}

/**
 * The hints that fit `room` cells, whole items only (SPEC 21.2): the way out always stays, the others give way from
 * the end (`Tab Pick a card`, `n Next page`), the leading one last. Only a way out longer than the room is cut.
 */
export function fitHints(hints: readonly string[], room: number): string {
  const items = hints.filter(Boolean)
  const leave = lastIndex(items, leaves)
  const order = [...items.keys()].filter(i => i !== leave && i !== 0).reverse()
  if (leave !== 0 && items.length > 0) order.push(0)
  const kept = new Set(items.keys())
  const text = () => items.filter((_, i) => kept.has(i)).join(HINT_SEP)
  for (const i of order) {
    if (cells(text()) <= room) break
    kept.delete(i)
  }
  return fit(text(), room)
}

/**
 * The bottom row that answers "what can I do now?" (SPEC 21.2), with the version at its right end: the update chip
 * always, the plain version only where the hints leave room for it.
 */
export function hintRow(c: Ctx, hints: readonly string[]): RenderElement {
  const { Box, Text } = c.el
  const items = hintsOf(c, hints)
  const version = versionChip(c)
  const shown = version.chip || cells(items.join(HINT_SEP)) + SPACE.loose + version.width <= c.columns
  const room = shown ? Math.max(1, c.columns - version.width - SPACE.loose) : c.columns
  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={SPACE.loose} width={c.columns}>
      <Text dimColor wrap="truncate-end">{fitHints(items, room)}</Text>
      {shown ? <Box flexShrink={0}>{version.node}</Box> : null}
    </Box>
  )
}

/** Header, notes, banner, body, feedback, the update command once opened, hint row: the same frame on every screen. */
export function frame(c: Ctx, shown: Shown): RenderElement {
  return (
    <c.el.Box flexDirection="column" width={c.columns} rowGap={SPACE.tight}>
      {header(c)}
      {shown.bare ? null : linkNote(c)}
      {shown.banner ?? null}
      {shown.body}
      {feedback(c)}
      {updateRow(c)}
      {hintRow(c, shown.hints)}
    </c.el.Box>
  )
}

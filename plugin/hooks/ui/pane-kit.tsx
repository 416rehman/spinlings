// The pane's building blocks (SPEC 21): the header on every screen (tabs left; daily rule, world and
// server right), the one button, the card at the pane's sizes, the 2-second hold line, feedback and the hint row, whose
// hints fit whole (the way out always stays) and whose right end carries the mod's version where there is room and,
// when the server names a newer one, the chip that gives the update command.
// Keys: on a tab's own screen 1-4 switch tabs and `o` opens a pack; a pushed view or a ceremony keeps 1-3 for its own
// choices and the tabs stay pressable without keys, so a key never means two things on one screen.
import type { RenderElement } from 'claude-code'
import type { Family, Form } from '../core/types.ts'
import { FAMILY_INFO } from '../core/families.ts'
import { RULE_INFO, dailyRule } from '../core/world.ts'
import { pixelCells } from '../client/anim.ts'
import { packArt as packPixels } from '../client/battleview.ts'
import type { Actions, El, GameState, HoldAction, PlayerStats, Presence, Surface, Tab } from '../client/types.ts'
import { hasFeature, newerMod } from '../client/game.ts'
import { CLIENT_VERSION, UPDATE_COMMAND } from '../client/remote.ts'
import { bar, cells, dots, fit, safe, span } from '../client/text.ts'
import { HOLD_VERB, grouped, holdText, statTiles } from '../client/viewmodels.ts'
import type { StatTile } from '../client/viewmodels.ts'
import { CARD_WIDTH, card, formArt } from './card.tsx'
import type { CardFace, CardOptions } from './card.tsx'
import { svgHold } from './ceremony-art.tsx'
import { cardHitRegion } from './card-hit-area.tsx'
import { FAMILY_COLOR, INK, LEAGUE_COLOR, MARK, SPACE, STAT, pixelRects } from './tokens.ts'

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
  /** the actual desktop pane forwards tile pointer messages; inert previews need no route */
  hitAreas: boolean
  hitIntent: string
}

/** What a screen hands the frame. `bare`: the screen says how the link stands itself, so the frame's note stays out. */
export type Shown = { body: RenderElement; hints: string[]; banner?: RenderElement | null; bare?: boolean }

/** A chip: the 8x8 mini in a 10-cell column (pickers, offers, the album). */
export const CHIP = CARD_WIDTH.mini
/** A tile: the framed 16x16 art in an 18-cell column (team, collection, summaries). */
export const TILE = CARD_WIDTH.tile

const ALL_TABS: readonly { tab: Tab; label: string }[] = [
  { tab: 'team', label: 'Team' },
  { tab: 'cards', label: 'Collection' },
  { tab: 'album', label: 'Discoveries' },
  { tab: 'trade', label: 'Community' },
]

/** The Market section shows where it can be used: online, on a server with a market. */
export const marketOpen = (s: GameState) => s.account.world === 'online' && hasFeature(s.account, 'market')

/** The four top tabs, hotkeys 1 to 4 (SPEC 21): Market lives inside Community. */
export function tabsOf(s: GameState): { tab: Tab; label: string; hotkey: string }[] {
  return ALL_TABS.map((t, i) => ({ ...t, hotkey: String(i + 1) }))
}

/** The hint for the four main tab keys. */
export const tabsHint = (s: GameState) => `1-${tabsOf(s).length} Tabs`

/** `next pack ███░░ 18 min`, or why it waits (SPEC 13.8): the words a meter's tooltip and the demo read. */
export function packMeter(p: Presence, width = 5): string {
  if (p.blocked === 'bank') return 'Open some packs to make room'
  const left = Math.max(0, p.need - p.minutes)
  if (left === 0) return 'next pack any moment'
  return `next pack ${bar(p.minutes / p.need, width)} ${span(left * 60_000)}`
}

/** The meter's short time: `18m`, `1h`, `now`, or `full` while the bank of packs waits to be opened. */
export function meterTime(p: Presence): string {
  if (p.blocked === 'bank') return 'full'
  const left = Math.max(0, p.need - p.minutes)
  if (left === 0) return 'now'
  return left >= 60 ? `${Math.round(left / 60)}h` : `${left}m`
}

// ---------- buttons and text ----------

export type Btn = {
  key: string; label: string; hotkey?: string | undefined; primary?: boolean; dim?: boolean
  /** the button names a picture above it (a tile, a pack, a row): it lights while the pointer is anywhere over its keyed Box */
  lit?: boolean
  on: () => unknown
}

/** The one button: always plain (the hotkey shows in the accent colour); primary only with 1 or o (SPEC 21.1). */
export function btn(c: Ctx, b: Btn): RenderElement {
  const { Button } = c.el
  const extra = {
    ...(b.hotkey ? { hotkey: b.hotkey } : {}),
    ...(b.primary ? { variant: 'primary' as const } : {}),
    ...(b.dim ? { dimColor: true } : {}),
    ...(b.lit ? { hover: { bold: true, underline: true } } : {}),
  }
  return <Button key={b.key} label={b.label} plain {...extra} onPress={() => { void b.on() }} />
}

/** A row of actions that wraps rather than overflows. */
export function actions(c: Ctx, items: (RenderElement | null | false)[]): RenderElement | null {
  const list = items.filter((x): x is RenderElement => !!x)
  if (list.length === 0) return null
  return <c.el.Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>{...list}</c.el.Box>
}

/**
 * One line of text that wraps onto the next row rather than lose its end: nothing in the pane is cut where it could
 * be read whole (a name, a handle, a sentence); only the hint row gives way, a whole hint at a time.
 */
export function line(c: Ctx, text: string, o: { dim?: boolean; color?: string; bold?: boolean; italic?: boolean } = {}): RenderElement {
  const props = { ...(o.dim ? { dimColor: true } : {}), ...(o.color ? { color: o.color } : {}), ...(o.bold ? { bold: true } : {}), ...(o.italic ? { italic: true } : {}) }
  return <c.el.Box width={c.columns}><c.el.Text wrap="wrap" {...props}>{text}</c.el.Text></c.el.Box>
}

/** A paragraph that wraps (guidance, consequences). */
export function para(c: Ctx, text: string, o: { dim?: boolean; color?: string } = {}): RenderElement {
  const props = { ...(o.dim ? { dimColor: true } : {}), ...(o.color ? { color: o.color } : {}) }
  return <c.el.Box width={c.columns}><c.el.Text wrap="wrap" {...props}>{text}</c.el.Text></c.el.Box>
}

/** A section heading with an optional dim note on the right. */
export function heading(c: Ctx, text: string, note = ''): RenderElement {
  const { Box, Text } = c.el
  // the note goes on the next row where the heading leaves no room, never cut
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
      <Text wrap="wrap">{text}</Text>
      {note ? <Text dimColor wrap="wrap">{note}</Text> : null}
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

type Press = Pick<CardOptions, 'key' | 'on' | 'hotkey' | 'selected' | 'note' | 'dimmed' | 'extra'>

/** The mini card: art, name, family, rarity, level and finish; one control, in the same order everywhere. */
export const chip = (c: Ctx, x: CardFace, o: Press) => card(c.el, c.surface, x, 'mini', { ...o, motion: c.motion, hitArea: c.hitAreas, hitIntent: c.hitIntent })
/** The tile card (SPEC 21: sprite, name, rarity, level), pressable whole, with an optional state line. */
export const tile = (c: Ctx, x: CardFace, o: Press) => card(c.el, c.surface, x, 'tile', { ...o, motion: c.motion, hitArea: c.hitAreas, hitIntent: c.hitIntent })
/** A card as one row: the mini beside its name, marks and a note (narrow lists). */
export const cardRow = (c: Ctx, x: CardFace, o: Press) => card(c.el, c.surface, x, 'row', { ...o, motion: c.motion, width: c.columns, hitArea: c.hitAreas, hitIntent: c.hitIntent })

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

/** The pack meter's art on the desktop: a pack in the family's colour, filling from the bottom as presence adds up. */
export function meterSvg(p: Presence, color: string, title: string): string {
  const f = p.blocked === 'bank' ? 1 : Math.min(1, Math.max(0, p.minutes / Math.max(1, p.need)))
  const h = Math.round(12 * f)
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 16" width="12" height="16" shape-rendering="crispEdges">'
    + `<title>${esc}</title>`
    + `<rect x="0.5" y="2.5" width="11" height="13" rx="1.5" fill="none" stroke="${color}" stroke-opacity="0.9"/>`
    + `<rect x="3" y="0.5" width="6" height="2" fill="${color}"/>`
    + `<rect x="2" y="${14 - h}" width="8" height="${h}" fill="${color}"/>`
    + '</svg>'
}

/**
 * The pack meter (SPEC 13.8) as a picture, never cut: a small pack in the family's colour that fills as presence adds
 * up (cells on the terminal, art on the desktop), then the time left (`18m`, `now`, or `full` while the bank waits).
 */
export function meter(c: Ctx): RenderElement {
  const { Box, Text, Svg } = c.el
  const p = c.state.presence
  const color = FAMILY_COLOR[c.state.signals.family]
  const time = meterTime(p)
  const tone = p.blocked === 'bank' ? INK.warn : time === 'now' ? INK.good : undefined
  const filled = p.blocked === 'bank' ? 5 : Math.round(5 * Math.min(1, p.minutes / Math.max(1, p.need)))
  const art = c.surface === 'terminal'
    ? <Text><Text color={color}>{'▮'.repeat(filled)}</Text><Text dimColor>{'▯'.repeat(5 - filled)}</Text></Text>
    : <Svg source={meterSvg(p, color, packMeter(p))} alt={packMeter(p)} width={12} height={16} />
  return (
    <Box key="pack-meter" flexDirection="row" columnGap={SPACE.tight} flexShrink={0}>
      {art}
      <Text {...(tone ? { color: tone } : { dimColor: true })}>{`Next pack ${time}`}</Text>
    </Box>
  )
}

/** The current world opens its chooser: green online, hollow offline, amber when unreachable. */
function worldDot(c: Ctx): RenderElement {
  const { Box, Text } = c.el
  const a = c.state.account
  const out = a.link === 'unreachable' || a.link === 'signed-out'
  const dot = a.world === 'offline' ? MARK.away : MARK.dot
  const color = out ? INK.warn : a.world === 'offline' ? INK.muted : INK.good
  const words = out && a.world === 'online' ? `${a.host} · not connected` : worldBadge(c.state)
  const on = () => c.actions.push({ kind: 'world' } as const)
  const mark = cardHitRegion(c.el, <Text color={color}>{dot}</Text>, c.hitAreas, 'world-mark', on, 'world-picker', c.hitIntent + ':' + a.host)
  if (cells(words) + 4 > c.columns) {
    const mode = a.world === 'offline' ? 'Offline' : a.community ? 'Community' : 'Online'
    const host = <Text dimColor wrap="wrap">{a.host + (out ? ' · not connected' : '')}</Text>
    return <Box key="world-control" flexDirection="column" width={c.columns}>
      <Box flexDirection="row" columnGap={SPACE.tight}>
        {mark}
        {btn(c, { key: 'world-picker', label: `${mode} ▾`, dim: true, on })}
      </Box>
      {a.world === 'online' ? cardHitRegion(c.el, host, c.hitAreas, 'world-host', on, 'world-picker', c.hitIntent + ':' + a.host, undefined, c.columns) : null}
    </Box>
  }
  return (
    <Box key="world-control" flexDirection="row" columnGap={SPACE.tight}>
      {mark}
      {btn(c, { key: 'world-picker', label: `${words} ▾`, dim: true, on })}
    </Box>
  )
}

/**
 * The passkey marker (SPEC 30): while an online collection lives only on this computer, a small "Not backed up" sits in
 * the header; pressing it opens the passkey steps. Gone for good once a passkey is saved.
 */
export function unsavedMarker(c: Ctx): RenderElement | null {
  const a = c.state.account
  if (a.world !== 'online' || a.link !== 'ready' || a.backedUp !== false || !hasFeature(a, 'passkey') || !c.state.me) return null
  if ((a.devices?.passkeys ?? 0) > 0) return null
  const { Box, Text } = c.el
  return (
    <Box key="unsaved" flexDirection="row" columnGap={SPACE.tight} flexShrink={0}>
      <Text color={INK.warn}>{MARK.unsaved}</Text>
      {btn(c, { key: 'not-backed-up', label: 'Not backed up', dim: true, on: () => c.actions.push({ kind: 'devices' }) })}
    </Box>
  )
}

/**
 * The header on every screen (SPEC 21): the tabs; then the daily rule, the world chooser and, until
 * a passkey is saved, the "Not backed up" marker. Every piece is whole and the row wraps rather than cut one.
 */
export function header(c: Ctx): RenderElement {
  const { Box } = c.el
  const s = c.state
  const rule = RULE_INFO[dailyRule(c.now)].name
  const tabs = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.tight} flexShrink={0}>
      {tabsOf(s).map(t => btn(c, { key: `tab-${t.tab}`, label: t.label, hotkey: c.root ? t.hotkey : undefined, dim: t.tab !== (s.pane.tab === 'market' ? 'trade' : s.pane.tab), on: () => c.actions.tab(t.tab) }))}
    </Box>
  )
  return (
    <Box flexDirection="column" width={c.columns}>
      {tabs}
      <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
        {btn(c, { key: 'today', label: rule, dim: true, on: () => c.actions.push({ kind: 'today' }) })}
        {worldDot(c)}
        {unsavedMarker(c)}
      </Box>
    </Box>
  )
}

/** A price in sparks: the spark mark in its colour and the whole number, grouped (`✧ 1,250`); `swap` for a card only. */
export function priceChip(c: Ctx, price: number, key?: string): RenderElement {
  const { Text } = c.el
  if (price <= 0) return <Text key={key} color={INK.muted}>{`${MARK.swap} swap`}</Text>
  return <Text key={key}><Text color={STAT.sales.color}>{MARK.spark}</Text><Text bold>{` ${grouped(price)}`}</Text></Text>
}

/** One stat as a tile: its glyph in its colour, the number, and one dim word (SPEC 8: counts only). */
export function statTile(c: Ctx, t: StatTile, key: string): RenderElement {
  const { Box, Text } = c.el
  const look = STAT[t.key]
  return (
    <Box key={key} flexDirection="row" columnGap={SPACE.tight} flexShrink={0}>
      <Text color={look.color}>{look.mark}</Text>
      <Text bold>{grouped(t.value)}</Text>
      <Text dimColor>{t.key === 'duelWins' ? 'duel wins' : t.key === 'beaten' ? 'players beaten' : t.key === 'firsts' ? 'first finds' : t.key === 'sales' ? 'market sales' : t.label}</Text>
    </Box>
  )
}

/** A player's stats as a wrapping row of tiles. */
export function statRow(c: Ctx, stats: PlayerStats | undefined, key: string): RenderElement | null {
  if (!stats) return null
  const tiles = statTiles(stats)
  return <c.el.Box key={key} flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>{...tiles.map((t, i) => statTile(c, t, `${key}-${i}`))}</c.el.Box>
}

/** A pack as a small package in its family's colour: 8 x 4 cells on the terminal, crisp art on the desktop. */
export function packArt(c: Ctx, family: Family, key: string): RenderElement {
  const px = packPixels(family)
  if (c.surface === 'terminal') {
    const r = pixelCells(px)
    return <c.el.Raster key={key} columns={r.columns} rows={r.rows} cells={r.cells} />
  }
  const name = `${FAMILY_INFO[family].name} pack`
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="32" height="32" shape-rendering="crispEdges">'
    + `<title>${name}</title>${pixelRects(px)}</svg>`
  return <c.el.Svg source={svg} alt={`${name} waiting to open`} width={32} height={32} />
}

/** A league as a badge: its colour and its name. */
export function leagueBadge(c: Ctx, league: keyof typeof LEAGUE_COLOR): RenderElement {
  return <c.el.Text color={LEAGUE_COLOR[league] ?? INK.muted}>{`${MARK.dot} ${league}`}</c.el.Text>
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
  const items = hintsOf(c, hints).filter(leaves)
  const version = versionChip(c)
  const shown = version.chip || cells(items.join(HINT_SEP)) + SPACE.loose + version.width <= c.columns
  const room = shown ? Math.max(1, c.columns - version.width - SPACE.loose) : c.columns
  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={SPACE.loose} width={c.columns}>
      {actions({ ...c, columns: room }, [
        btn(c, { key: 'pane-back', label: updateOpen(c) ? 'Hide update' : c.state.pane.stack.length === 0 ? 'Close' : 'Back', dim: true, on: () => c.actions.back() }),
        !playable(c.state) || room < 13 || c.state.pane.stack.at(-1)?.kind === 'help' ? null : btn(c, { key: 'pane-help', label: '? Help', dim: true, on: () => c.actions.push({ kind: 'help' }) }),
      ])}
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

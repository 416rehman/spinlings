// The Team tab (SPEC 9, 14): the three slots in play order with resting timers, league, rating and streak, and the
// notices (defense results with Revenge, evolutions, gifts, season ends). Other players show by handle and day only.
import type { RenderElement } from 'claude-code'
import { dayLabel, dots, safe, span } from '../client/text.ts'
import { teamSlots, today } from '../client/viewmodels.ts'
import type { Slot } from '../client/viewmodels.ts'
import type { Ctx, Shown } from './pane-kit.tsx'
import { TILE, actions, btn, cardRow, column, heading, line, para, tile } from './pane-kit.tsx'
import { ART, SPACE } from './tokens.ts'

const NOTICES = 4

function slotNote(s: Slot): string {
  if (!s.card) return ''
  if (s.restingMs > 0) return `Resting · ${span(s.restingMs)}`
  return s.slot === 0 ? 'Leads' : `Slot ${s.slot + 1}`
}

function emptySlot(c: Ctx, s: Slot, wide: boolean): RenderElement {
  const { Box, Text } = c.el
  if (!wide) return line(c, `Slot ${s.slot + 1} · empty · open a card in Cards and choose Set in team`, { dim: true })
  return (
    <Box key={`team-${s.slot}`} flexDirection="column" width={TILE} flexShrink={0}>
      <Box width={TILE} height={ART.rows} borderStyle="round" borderDimColor justifyContent="center" alignItems="center">
        <Text dimColor>Empty</Text>
      </Box>
      <Text dimColor>{`Slot ${s.slot + 1}`}</Text>
      <Text dimColor wrap="truncate-end">Pick one in Cards</Text>
    </Box>
  )
}

export function teamScreen(c: Ctx): Shown {
  const me = c.state.me!
  const p = me.player
  const slots = teamSlots(p.team, c.state.cards, c.now)
  const filled = slots.filter(s => s.card)
  const wide = c.columns >= 3 * TILE + 2 * SPACE.tight
  const open = (id: string) => c.actions.push({ kind: 'card', cardId: id })
  const shown = slots.map(s => {
    if (!s.card) return emptySlot(c, s, wide)
    const o = { key: `team-${s.slot}`, note: slotNote(s), on: () => open(s.card!.id) }
    return wide ? tile(c, s.card, o) : cardRow(c, s.card, o)
  })
  const todayDay = today(c.now)
  const notices = me.notices.slice(0, NOTICES)
  let revenge = false
  const rows = notices.map(n => {
    const when = dayLabel(n.day, todayDay)
    const can = n.kind === 'defense-loss' && !!n.handle && (when === 'today' || when === 'yesterday') && !c.state.account.readOnly
    const hotkey = can && !revenge ? 'r' : undefined
    if (hotkey) revenge = true
    const text = line(c, dots(when, safe(n.text, 100)), { dim: n.kind !== 'defense-loss' && n.kind !== 'season-end' && n.kind !== 'new-device' })
    if (!can) return text
    return (
      <c.el.Box flexDirection="column" width={c.columns}>
        {text}
        {btn(c, { key: `revenge-${n.id}`, label: `Revenge on ${safe(n.handle, 40)}`, hotkey, on: () => c.actions.duel(n.handle!) })}
      </c.el.Box>
    )
  })
  const streak = p.streak > 0 ? `streak ${p.streak}` : ''
  const duel = !c.state.account.readOnly && filled.length > 0
  const body = column(c, [
    heading(c, 'Your team', dots(p.league, `rating ${p.rating}`, streak)),
    filled.length === 0
      ? para(c, 'Your team forms as your first cards arrive. Open a pack with o, then set your favourites from Cards.', { dim: true })
      : wide ? <c.el.Box flexDirection="row" columnGap={SPACE.tight}>{...shown}</c.el.Box> : column(c, shown, SPACE.none),
    actions(c, [duel ? btn(c, { key: 'duel', label: 'Duel', hotkey: 'b', on: () => c.actions.duel() }) : null]),
    heading(c, 'Notices'),
    rows.length > 0 ? column(c, rows, SPACE.none) : line(c, 'Nothing yet. When someone duels your team, you will see it here.', { dim: true }),
    me.notices.length > NOTICES ? line(c, `and ${me.notices.length - NOTICES} older`, { dim: true }) : null,
  ])
  return {
    body,
    hints: ['1-4 Tabs', me.packs.length > 0 ? 'o Open pack' : '', duel ? 'b Duel' : '', revenge ? 'r Revenge' : '', filled.length > 0 ? 'Tab Pick a card' : '', 'esc Close'],
  }
}


// The Team tab (SPEC 8, 9, 14): the three slots in play order with resting timers, the packs waiting as art to open,
// league, rating and streak, your stats as tiles, the way to the leaderboards, and the notices (defense results with
// Revenge, evolutions, gifts, sales, season ends). Other players show by handle and day only.
import type { RenderElement } from 'claude-code'
import { FAMILY_INFO } from '../core/families.ts'
import { comfortLine } from '../client/session.ts'
import { dayLabel, dots, safe, span } from '../client/text.ts'
import { teamSlots, today } from '../client/viewmodels.ts'
import type { Slot } from '../client/viewmodels.ts'
import type { Ctx, Shown } from './pane-kit.tsx'
import { cardHitRegion } from './card-hit-area.tsx'
import { TILE, actions, btn, cardRow, column, heading, line, meter, packArt, para, tabsHint, tile } from './pane-kit.tsx'
import { ART, INK, MARK, SPACE, SVG_SCALE } from './tokens.ts'

const NOTICES = 2
/** Packs drawn as art on the Team tab; more show as a count. */
const PACKS_SHOWN = 3

function slotNote(s: Slot): string {
  if (!s.card) return ''
  if (s.restingMs > 0) return `Resting · ${span(s.restingMs)}`
  return s.slot === 0 ? 'Leads' : `Slot ${s.slot + 1}`
}

/** An empty slot is a button too: pressing it goes to Cards to pick one. */
function emptySlot(c: Ctx, s: Slot, wide: boolean): RenderElement {
  const { Box, Text } = c.el
  const pick = () => c.actions.tab('cards')
  if (!wide) {
    return (
      <Box key={`team-${s.slot}`} position="relative" flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
        {cardHitRegion(c.el, <Text dimColor>{`Slot ${s.slot + 1} · empty`}</Text>, c.hitAreas, `team-${s.slot}-empty`, pick,
          `team-${s.slot}-pick`, `${c.hitIntent}:empty-${s.slot}`, undefined, c.columns)}
        {btn(c, { key: `team-${s.slot}-pick`, label: 'Pick a card', on: pick })}
      </Box>
    )
  }
  const extent = ART.columns * SVG_SCALE.tile
  const picture = c.surface === 'desktop'
    ? <c.el.Svg key={`team-${s.slot}-art`} width={extent} height={extent} alt={`Empty team slot ${s.slot + 1}`}
      source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect x=".5" y=".5" width="17" height="17" rx="1" fill="none" stroke="${INK.muted}"/><path d="M9 6v6M6 9h6" fill="none" stroke="${INK.muted}"/></svg>`} />
    : <Box width={TILE} height={ART.rows} borderStyle="round" borderDimColor justifyContent="center" alignItems="center"><Text dimColor>+</Text></Box>
  return (
    <Box key={`team-${s.slot}`} position="relative" flexDirection="column" width={TILE} flexShrink={0}>
      {cardHitRegion(c.el, picture, c.hitAreas, `team-${s.slot}-art`, pick, `team-${s.slot}-pick`, `${c.hitIntent}:empty-${s.slot}`)}
      {btn(c, { key: `team-${s.slot}-pick`, label: 'Pick a card', on: pick })}
      {cardHitRegion(c.el, <Text dimColor>{`Slot ${s.slot + 1}`}</Text>, c.hitAreas, `team-${s.slot}-note`, pick,
        `team-${s.slot}-pick`, `${c.hitIntent}:empty-${s.slot}`, undefined, TILE)}
    </Box>
  )
}

/** The packs waiting, as the packages themselves: each is pressed to open. */
function packStrip(c: Ctx): RenderElement | null {
  const packs = c.state.me?.packs ?? []
  if (packs.length === 0) return null
  const { Box, Text } = c.el
  const shown = packs.slice(0, PACKS_SHOWN)
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
      {...shown.map(p => (
        <Box key={`pack-${p.id}`} position="relative" flexDirection="column" flexShrink={0} width={12}>
          {cardHitRegion(c.el, packArt(c, p.family, `pack-${p.id}-art`), c.hitAreas, `pack-${p.id}-art`,
            () => c.actions.openPack(p.id), `pack-${p.id}`, `${c.hitIntent}:${p.id}`)}
          {btn(c, { key: `pack-${p.id}`, label: `${FAMILY_INFO[p.family].name} pack`, lit: true, on: () => c.actions.openPack(p.id) })}
        </Box>
      ))}
      {packs.length > shown.length ? <Text dimColor>{`+${packs.length - shown.length}`}</Text> : null}
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
    const loud = n.kind === 'defense-loss' || n.kind === 'season-end' || n.kind === 'new-device' || n.kind === 'market-sold'
    const text = para(c, dots(when, safe(n.text, 100)), loud ? {} : { dim: true })
    if (!can) return text
    return (
      <c.el.Box flexDirection="column" width={c.columns}>
        {text}
        {btn(c, { key: `revenge-${n.id}`, label: c.columns < 40 ? 'Revenge' : `Revenge on ${safe(n.handle, 40)}`, hotkey, on: () => c.actions.duel(n.handle!) })}
      </c.el.Box>
    )
  })
  const streak = p.streak > 0 ? `${p.streak} win streak` : ''
  const duel = !c.state.account.readOnly && filled.length > 0
  const { Box, Text } = c.el
  const standing = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
      <Text bold>Your team</Text>
      <Text color={INK.muted}>{`${p.league} league`}</Text>
      <Text><Text color={INK.accent}>{MARK.rank}</Text><Text bold>{` ${p.rating} rating`}</Text></Text>
      <Text><Text color={INK.accent}>{MARK.spark}</Text><Text>{` ${p.sparks} sparks`}</Text></Text>
      {streak ? <Text color={INK.good}>{streak}</Text> : null}
    </Box>
  )
  const body = column(c, [
    column(c, [
      standing,
      filled.length === 0
        ? para(c, 'Your team forms as your first cards arrive. Open a pack, then set your favourites from Collection.', { dim: true })
        : wide ? <Box flexDirection="row" columnGap={SPACE.tight}>{...shown}</Box> : column(c, shown, SPACE.none),
      actions(c, [
        duel ? btn(c, { key: 'duel', label: 'Duel', hotkey: 'b', on: () => c.actions.duel() }) : null,
      ]),
    ]),
    <Box key="team-packs" flexDirection="column" rowGap={SPACE.tight} width={c.columns}>
      {actions(c, [
        <Text bold>{me.packs.length ? `Packs · ${me.packs.length} ready` : 'Packs'}</Text>,
        me.packs.length ? btn(c, { key: 'open-pack', label: 'Open pack', hotkey: c.root ? 'o' : undefined, primary: c.root, on: () => c.actions.openPack() }) : null,
      ])}
      {c.state.signals.restingUntil !== null ? para(c, comfortLine(c.state.signals.restingUntil), { dim: true }) : null}
      {meter(c)}
      {packStrip(c)}
    </Box>,
    column(c, [
      heading(c, 'Notices'),
      rows.length > 0 ? column(c, rows, SPACE.none) : line(c, 'Nothing yet. When someone duels your team, you will see it here.', { dim: true }),
      me.notices.length > NOTICES ? line(c, `and ${me.notices.length - NOTICES} older`, { dim: true }) : null,
    ]),
  ], SPACE.loose)
  return {
    body,
    hints: [tabsHint(c.state), me.packs.length > 0 ? 'o Open pack' : '', duel ? 'b Duel' : '', revenge ? 'r Revenge' : '', filled.length > 0 ? 'Tab Pick a card' : '', 'esc Close'],
  }
}

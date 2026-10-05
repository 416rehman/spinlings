// The Album tab (SPEC 9, 13.7, 4): the season's species family by family, silhouettes for the unseen, the count you
// already have; a species page with its evolution line, craft and the wishlist; and the Fusion Log of your hybrids.
import type { RenderElement } from 'claude-code'
import type { Family, Species } from '../core/types.ts'
import { FAMILIES, FAMILY_INFO } from '../core/families.ts'
import { getSpecies } from '../core/species.ts'
import { catalogOf } from '../client/frozen.ts'
import { seasonOf } from '../core/world.ts'
import { dots, fit, plural, safe } from '../client/text.ts'
import { albumCount, albumEntries, craftChoices, cycle, fusionLog, parentsLine, perRow } from '../client/viewmodels.ts'
import type { AlbumEntry } from '../client/viewmodels.ts'
import { formArt } from './card.tsx'
import { cardHitRegion } from './card-hit-area.tsx'
import type { Ctx, Shown } from './pane-kit.tsx'
import { CHIP, TILE, actions, btn, cardRow, column, formMini, grid, heading, line, para, tabsHint } from './pane-kit.tsx'
import { ECONOMY } from '../core/economy.ts'
import { FAMILY_COLOR, FAMILY_MARK, RARITY_COLOR, SPACE } from './tokens.ts'

const PAGES: readonly (Family | 'fusion')[] = [...FAMILIES, 'fusion']

function entryChip(c: Ctx, e: AlbumEntry): RenderElement {
  const { Box, Text } = c.el
  const s = e.species
  const name = e.seen ? safe(s.names[s.legendary ? 2 : 0], 24) : '???'
  const note = [s.legendary ? 'Legend' : '', e.owned > 0 ? `×${e.owned}` : '', e.wished ? 'wished' : ''].filter(Boolean).join(' ')
  const open = () => c.actions.push({ kind: 'species', speciesId: s.id })
  return (
    <Box key={`album-${s.id}`} position="relative" flexDirection="column" width={CHIP} flexShrink={0}>
      {cardHitRegion(c.el, formMini(c, `album-${s.id}`, s, e.seen), c.hitAreas, `album-${s.id}-art`, open,
        `album-${s.id}-pick`, `${c.hitIntent}:${s.id}`)}
      {btn(c, { key: `album-${s.id}-pick`, label: fit(name, CHIP), dim: !e.seen, lit: true, on: open })}
      {cardHitRegion(c.el, <Text dimColor wrap="truncate-end" {...(s.legendary && e.seen ? { color: RARITY_COLOR.legendary } : {})}>{fit(note || ' ', CHIP)}</Text>,
        c.hitAreas, `album-${s.id}-note`, open, `album-${s.id}-pick`, `${c.hitIntent}:${s.id}`, undefined, CHIP)}
    </Box>
  )
}

export function albumScreen(c: Ctx): Shown {
  const me = c.state.me
  const season = seasonOf(c.now)
  const seen = me?.player.seen ?? []
  const catalog = catalogOf(c.state.account)
  const count = albumCount(season, seen, c.state.cards, catalog)
  const page = c.state.pane.album
  const go = (by: number) => c.actions.pane(p => ({ ...p, album: cycle(PAGES, p.album, by) }))
  const nav = actions(c, [
    btn(c, { key: 'album-next', label: 'Next family', hotkey: 'n', on: () => go(1) }),
    btn(c, { key: 'album-prev', label: 'Previous', hotkey: 'p', on: () => go(-1) }),
    page === 'fusion' ? null : btn(c, { key: 'album-log', label: 'Fusion Log', hotkey: 'l', on: () => c.actions.pane(p => ({ ...p, album: 'fusion' })) }),
  ])
  const head = heading(c, `Discoveries · ${count.seen}/${count.total}`, `season ${season}`)
  if (page === 'fusion') {
    const log = fusionLog(c.state.cards)
    const shown = log.slice(0, 6)
    return {
      body: column(c, [
        head,
        nav,
        line(c, `Fusion Log · ${plural(log.length, 'hybrid')}`),
        log.length === 0
          ? para(c, 'No hybrids yet. Open a card in Collection and choose Fuse to make one nobody has ever seen.', { dim: true })
          : column(c, shown.map(x => cardRow(c, x, { key: `log-${x.id}`, note: parentsLine(x, catalog), on: () => c.actions.push({ kind: 'card', cardId: x.id }) })), SPACE.none),
        log.length > shown.length ? line(c, `and ${log.length - shown.length} more in Collection`, { dim: true }) : null,
      ]),
      hints: [tabsHint(c.state), 'n Next family', 'p Previous', log.length > 0 ? 'Tab Pick a hybrid' : '', 'esc Close'],
    }
  }
  const entries = albumEntries(season, page, seen, c.state.cards, me?.player.wishlist ?? [], catalog)
  const inFamily = entries.filter(e => e.seen).length
  return {
    body: column(c, [
      head,
      para(c, 'Species you have collected this season. Silhouettes are still waiting to be found.', { dim: true }),
      nav,
      <c.el.Text wrap="truncate-end">
        <c.el.Text color={FAMILY_COLOR[page]}>{FAMILY_MARK[page]}</c.el.Text>
        {` ${FAMILY_INFO[page].name} · ${inFamily}/${entries.length}`}
      </c.el.Text>,
      grid(c, entries.map(e => entryChip(c, e)), perRow(c.columns, CHIP)),
      inFamily === 0 ? para(c, 'Silhouettes are species you have not met yet. Packs and wild encounters fill them in.', { dim: true }) : null,
    ]),
    hints: [tabsHint(c.state), 'n Next family', 'l Fusion Log', 'Tab Pick a species', 'esc Close'],
  }
}

function stages(c: Ctx, s: Species, seen: boolean): RenderElement {
  const { Box } = c.el
  const list: (1 | 2 | 3)[] = s.legendary ? [3] : seen ? [1, 2, 3] : [1]
  const big = c.columns >= list.length * TILE + (list.length - 1) * SPACE.loose
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} rowGap={SPACE.tight} width={c.columns}>
      {...list.map(st => big ? formArt(c.el, c.surface, `stage-${st}`, s, seen, st) : formMini(c, `stage-${st}`, s, seen, st))}
    </Box>
  )
}

export function speciesScreen(c: Ctx, speciesId: string): Shown {
  const s = getSpecies(speciesId, catalogOf(c.state.account))
  if (!s) return { body: column(c, [line(c, 'Discoveries', { dim: true }), para(c, 'This creature is not in this album.', { dim: true })]), hints: ['esc Back'] }
  const me = c.state.me
  const seen = (me?.player.seen ?? []).includes(s.id) || c.state.cards.some(x => x.species === s.id)
  const owned = c.state.cards.filter(x => x.species === s.id).length
  const names = s.legendary ? safe(s.names[2], 24) : seen ? s.names.map(n => safe(n, 24)).join(' → ') : '??? → ??? → ???'
  const sparks = me?.player.sparks ?? 0
  const choices = craftChoices(s, sparks, c.now)
  const wishlist = me?.player.wishlist ?? []
  const wished = wishlist.includes(s.id)
  const canWish = !c.offline && !!me && (wished || wishlist.length < ECONOMY.wishlistMax)
  const craft = choices.map((ch, i) => ch.ok
    ? btn(c, { key: `craft-${ch.rarity}`, label: `Craft ${ch.rarity} · ${ch.cost}`, hotkey: String(i + 1), primary: i === 0, on: () => c.actions.craft(s.id, ch.rarity) })
    : <c.el.Text dimColor>{`${ch.rarity[0]!.toUpperCase()}${ch.rarity.slice(1)} · ${ch.cost}`}</c.el.Text>)
  return {
    body: column(c, [
      line(c, `Album › ${s.legendary || seen ? safe(s.names[s.legendary ? 2 : 0], 24) : '???'}`, { dim: true }),
      stages(c, s, seen),
      line(c, names, { bold: true, ...(s.legendary ? { color: RARITY_COLOR.legendary } : {}) }),
      <c.el.Text wrap="wrap">
        <c.el.Text color={FAMILY_COLOR[s.family]}>{FAMILY_MARK[s.family]}</c.el.Text>
        <c.el.Text dimColor>{` ${dots(FAMILY_INFO[s.family].name, s.legendary && 'Legendary · Final form', seen ? 'seen' : 'not met yet', owned > 0 && `you have ${owned}`)}`}</c.el.Text>
      </c.el.Text>,
      choices.length === 0
        ? line(c, 'Crafting covers the current season only.', { dim: true })
        : column(c, [line(c, `Craft one with fresh genes · you have ${sparks} sparks`), actions(c, craft)], SPACE.none),
      canWish ? actions(c, [btn(c, { key: 'wish', label: wished ? 'Take off the wishlist' : 'Wish for it', hotkey: 'w', on: () => c.actions.wishlist(wished ? wishlist.filter(id => id !== s.id) : [...wishlist, s.id]) })]) : null,
      !c.offline && !canWish && me ? line(c, `Your wishlist holds ${ECONOMY.wishlistMax}. Take one off first.`, { dim: true }) : null,
    ]),
    hints: [choices.some(ch => ch.ok) ? '1-3 Craft' : '', canWish ? 'w Wishlist' : '', 'esc Back'],
  }
}

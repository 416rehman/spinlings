// The Cards tab (SPEC 9, 21): the collection grid with family and rarity filters and pages; the card detail with set in
// team, for trade, fuse, gift (hold), recycle (hold) and share; and the fusion picker. Destructive actions arm on the
// first press and need a second press after 2 seconds, with their consequence in one line.
import type { RenderElement } from 'claude-code'
import { recycleValue } from '../core/cards.ts'
import { FAMILY_INFO } from '../core/families.ts'
import { dailyRule, fusionCost } from '../core/world.ts'
import { nameOf } from '../client/game.ts'
import { dots } from '../client/text.ts'
import {
  FILTER_FAMILIES, FILTER_RARITIES, cardCan, collection, cycle, filterLabel, fusePartners, paged, perRow, sellProblem, teamPlace,
  withTop,
} from '../client/viewmodels.ts'
import { card } from './card.tsx'
import type { Ctx, Shown } from './pane-kit.tsx'
import {
  CHIP, TILE, actions, btn, chip, column, grid, heading, holdLine, line, marketOpen, para, priceChip, tabsHint, tile,
} from './pane-kit.tsx'
import { MARK, SPACE } from './tokens.ts'

const TILE_ROWS = { terminal: 14, desktop: 8 }
const CHIP_ROWS = { terminal: 8, desktop: 6 }

/** How many grid rows fit the pane's body: at least one, at most three. */
function rowsFor(c: Ctx, each: number): number {
  return Math.max(1, Math.min(3, Math.floor((c.rows - 11) / (each + 1))))
}

export function cardsScreen(c: Ctx): Shown {
  const p = c.state.pane
  const all = c.state.cards
  const list = collection(all, p.family, p.rarity)
  const small = c.columns < 2 * TILE + 2 * SPACE.tight + TILE
  const per = small ? perRow(c.columns, CHIP) : perRow(c.columns, TILE)
  const heights = small ? CHIP_ROWS : TILE_ROWS
  const pg = paged(list, p.page, per * rowsFor(c, c.surface === 'terminal' ? heights.terminal : heights.desktop))
  const open = (id: string) => c.actions.push({ kind: 'card', cardId: id })
  const items = pg.items.map(x => (small ? chip : tile)(c, x, { key: `card-${x.id}`, on: () => open(x.id) }))
  const filters = actions(c, [
    btn(c, { key: 'filter-family', label: `Family: ${p.family === 'all' ? 'All' : FAMILY_INFO[p.family].name}`, hotkey: 'm', on: () => c.actions.pane(x => ({ ...x, family: cycle(FILTER_FAMILIES, x.family), page: 0 })) }),
    btn(c, { key: 'filter-rarity', label: `Rarity: ${p.rarity === 'all' ? 'All' : p.rarity[0]!.toUpperCase() + p.rarity.slice(1)}`, hotkey: 'y', on: () => c.actions.pane(x => ({ ...x, rarity: cycle(FILTER_RARITIES, x.rarity), page: 0 })) }),
  ])
  const pages = pg.pages > 1
  const body = column(c, [
    heading(c, `Collection · ${all.length}`, list.length === all.length ? '' : `${list.length} shown · ${filterLabel(p.family, p.rarity)}`),
    para(c, 'The cards you own. Pick one to inspect or set in your team.', { dim: true }),
    all.length > 0 ? filters : null,
    all.length === 0
      ? para(c, 'Creatures show up while Claude works. Your first one is on its way.', { dim: true })
      : list.length === 0
        ? para(c, `No ${filterLabel(p.family, p.rarity).toLowerCase()} cards yet. Press m or y to change the filters.`, { dim: true })
        : grid(c, items, per),
    pages ? actions(c, [
      btn(c, { key: 'page-next', label: 'Next page', hotkey: 'n', on: () => c.actions.pane(x => ({ ...x, page: (pg.page + 1) % pg.pages })) }),
      btn(c, { key: 'page-prev', label: 'Previous', hotkey: 'p', on: () => c.actions.pane(x => ({ ...x, page: (pg.page - 1 + pg.pages) % pg.pages })) }),
      <c.el.Text dimColor>{`page ${pg.page + 1} of ${pg.pages}`}</c.el.Text>,
    ]) : null,
  ])
  return {
    body,
    hints: [tabsHint(c.state), (c.state.me?.packs.length ?? 0) > 0 ? 'o Open pack' : '', all.length > 0 ? 'm Family · y Rarity' : '', pages ? 'n Next page' : '', all.length > 0 ? 'Tab Pick a card' : '', 'esc Close'],
  }
}

function missing(c: Ctx, where: string): Shown {
  return { body: column(c, [line(c, where, { dim: true }), para(c, 'That card is not here any more.', { dim: true })]), hints: ['esc Back'] }
}

export function cardScreen(c: Ctx, cardId: string): Shown {
  const x = c.state.cards.find(k => k.id === cardId)
  if (!x) return missing(c, 'Collection')
  const me = c.state.me
  const can = cardCan(x, { offline: c.offline, now: c.now, market: marketOpen(c.state) })
  const listing = me?.listings?.find(l => l.card.id === x.id) ?? null
  const place = me && x.state === 'owned' ? teamPlace(me.player.team, x, c.state.cards) : null
  const name = nameOf(x)
  const replaceLabel = place?.kind === 'replace' ? `Set in team, for ${nameOf(place.replaced)}` : ''
  const shortReplace = replaceLabel.length + 3 > c.columns
  const team = place === null || place.kind === 'leads' ? null
    : btn(c, {
      key: 'set-team', hotkey: '1', primary: true, on: () => c.actions.setTeam(place.ids),
      label: place.kind === 'lead' ? 'Lead the team' : place.kind === 'replace' && !shortReplace ? replaceLabel : 'Set in team',
    })
  const value = recycleValue(x)
  const sellNote = can.sell && me ? sellProblem(x, me.player.team, c.state.cards) : ''
  const rows = column(c, [
    para(c, `Cards › ${name}`, { dim: true }),
    card(c.el, c.surface, x, 'full', { key: 'detail', width: c.columns, motion: c.motion, offline: c.offline, now: c.now }),
    place?.kind === 'leads' ? line(c, 'Leads your team', { dim: true }) : null,
    place?.kind === 'replace' && shortReplace ? line(c, `Setting this card in your team replaces ${nameOf(place.replaced)}.`, { dim: true }) : null,
    actions(c, [
      team,
      can.trade ? btn(c, { key: 'for-trade', label: x.forTrade ? 'Keep (not for trade)' : 'Mark for trade', hotkey: '2', on: () => c.actions.setForTrade(x.id, !x.forTrade) }) : null,
      can.fuse ? btn(c, { key: 'fuse', label: 'Fuse', hotkey: '3', on: () => c.actions.push({ kind: 'fuse', cardId: x.id, otherId: null }) }) : null,
    ]),
    actions(c, [
      can.sell && !sellNote ? btn(c, { key: 'sell', label: `${MARK.spark} Sell`, hotkey: 'l', on: async () => {
        await c.actions.push({ kind: 'sell', cardId: x.id, price: 0, want: null })
        await c.actions.prices(x.species)
      } }) : null,
      can.gift ? btn(c, { key: 'gift', label: 'Gift', hotkey: 'g', on: () => c.actions.hold('gift', x.id) }) : null,
      can.recycle ? btn(c, { key: 'recycle', label: `Recycle (+${value} sparks)`, hotkey: 'x', on: () => c.actions.hold('recycle', x.id) }) : null,
      btn(c, { key: 'share', label: 'Share', hotkey: 's', on: () => c.actions.share(x.id) }),
    ]),
    holdLine(c, 'gift', x.id, 'g'),
    holdLine(c, 'recycle', x.id, 'x'),
    can.sell && sellNote ? para(c, sellNote, { dim: true }) : null,
    listing ? actions(c, [
      <c.el.Text dimColor>On the market for</c.el.Text>,
      priceChip(c, listing.price),
      btn(c, { key: 'see-listing', label: 'See the listing', on: () => c.actions.push({ kind: 'listing', listingId: listing.id, cardId: null }) }),
    ]) : null,
    can.tradeNote && !listing ? line(c, can.tradeNote, { dim: true }) : null,
  ])
  return {
    body: rows,
    hints: [team ? '1 Set in team' : '', can.trade ? '2 Trade' : '', can.fuse ? '3 Fuse' : '', can.sell && !sellNote ? 'l Sell' : '', can.gift ? 'g Gift' : '', can.recycle ? 'x Recycle' : '', 's Share', 'esc Back'],
  }
}

export function fuseScreen(c: Ctx, cardId: string, otherId: string | null): Shown {
  const x = c.state.cards.find(k => k.id === cardId)
  if (!x) return missing(c, 'Collection › Fuse')
  const other = otherId ? c.state.cards.find(k => k.id === otherId) ?? null : null
  const cost = fusionCost(dailyRule(c.now))
  const sparks = c.state.me?.player.sparks ?? 0
  const choose = (id: string | null) => c.actions.pane(p => withTop(p, v => (v.kind === 'fuse' ? { ...v, otherId: id } : v)))
  const crumb = para(c, `Cards › ${nameOf(x)} › Fuse`, { dim: true })
  const price = dots(`${cost} sparks`, `you have ${sparks}`)
  if (!other) {
    const partners = fusePartners(x, c.state.cards)
    const per = perRow(c.columns, CHIP)
    const shown = partners.slice(0, per * rowsFor(c, c.surface === 'terminal' ? CHIP_ROWS.terminal : CHIP_ROWS.desktop))
    return {
      body: column(c, [
        crumb,
        heading(c, `Fuse ${nameOf(x)} with…`, price),
        partners.length === 0
          ? para(c, 'You need another card that is free to fuse. Starters stay as they are; open a pack or catch one.', { dim: true })
          : grid(c, shown.map((k, i) => chip(c, k, { key: `partner-${k.id}`, hotkey: i < 3 ? String(i + 1) : undefined, on: () => choose(k.id) })), per),
        partners.length > shown.length ? line(c, `and ${partners.length - shown.length} more · newest first`, { dim: true }) : null,
        para(c, 'Both cards are used up. The hybrid takes one body from each, and nobody has ever seen it.', { dim: true }),
      ]),
      hints: [partners.length > 0 ? '1-3 Pick' : '', partners.length > 3 ? 'Tab More' : '', 'esc Back'],
    }
  }
  const target = `${x.id}|${other.id}`
  const afford = sparks >= cost
  const pair: RenderElement = (
    <c.el.Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} rowGap={SPACE.tight} alignItems="center" width={c.columns}>
      {chip(c, x, { key: 'fuse-a' })}
      <c.el.Text>+</c.el.Text>
      {chip(c, other, { key: 'fuse-b' })}
    </c.el.Box>
  )
  return {
    body: column(c, [
      crumb,
      heading(c, `${nameOf(x)} + ${nameOf(other)}`, price),
      pair,
      para(c, 'A brand-new hybrid hatches from these two. Both are used up.', { dim: true }),
      afford ? null : para(c, `Fusing costs ${cost} sparks and you have ${sparks}. Battles and recycling earn more.`, { dim: true }),
      actions(c, [
        afford ? btn(c, { key: 'fuse-go', label: 'Fuse', hotkey: '1', primary: true, on: () => c.actions.hold('fuse', target) }) : null,
        btn(c, { key: 'fuse-other', label: 'Pick another', hotkey: '2', on: () => choose(null) }),
      ]),
      holdLine(c, 'fuse', target, '1'),
    ]),
    hints: [afford ? '1 Fuse (press, wait, press)' : '', '2 Pick another', 'esc Back'],
  }
}

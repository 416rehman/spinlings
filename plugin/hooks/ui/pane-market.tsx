// The Market section (SPEC 8): everyone's listings as a grid of card tiles (the art, the rarity gem, the family mark, the
// finish, a price chip and the card a listing wants in return), filtered by chips and pages; your own listings; one
// listing's page, which is the confirm (what you give, what you get, then Buy); and the sell page, where a card gets a
// exact price with optional recent-sale hints, and optionally asks for a card too. Online only.
import type { RenderElement } from 'claude-code'
import type { Family, Rarity } from '../core/types.ts'
import { FAMILIES, FAMILY_INFO } from '../core/families.ts'
import { ECONOMY } from '../core/economy.ts'
import { marketChips, nameOf } from '../client/game.ts'
import { catalogOf } from '../client/frozen.ts'
import { dayLabel, dots, safe, title } from '../client/text.ts'
import type { Listing, MarketQuery, MarketWant } from '../client/types.ts'
import {
  cycle, grouped, paged, parsePrice, perRow, priceHints, salesOf, sameWant, sellProblem, startPrice, stepPrice, today, wantChoices, wantFits,
  wantSpecies, wantWords, withTop,
} from '../client/viewmodels.ts'
import { card, rarityColor } from './card.tsx'
import type { Ctx, Shown } from './pane-kit.tsx'
import {
  CHIP, TILE, actions, btn, chip, column, formMini, grid, holdLine, line, para, priceChip, tabsHint, tile,
} from './pane-kit.tsx'
import { canChallenge } from './pane-trade.tsx'
import { FAMILY_COLOR, FAMILY_MARK, INK, MARK, RARITY_COLOR, RARITY_INITIAL, SPACE, STAT } from './tokens.ts'

const FAMILY_CHIPS: readonly (Family | 'all')[] = ['all', ...FAMILIES]
const RARITY_CHIPS: readonly (Rarity | 'all')[] = ['all', 'common', 'rare', 'epic', 'legendary']
const KINDS: readonly MarketQuery['kind'][] = ['all', 'sparks', 'swap', 'both']
const SORTS: readonly MarketQuery['sort'][] = ['newest', 'cheapest', 'priciest']

const KIND_LABEL: Record<MarketQuery['kind'], string> = {
  all: 'Any deal', sparks: `${MARK.spark} Sparks`, swap: `${MARK.swap} Swap`, both: `${MARK.spark}${MARK.swap} Both`,
}
const SORT_LABEL: Record<MarketQuery['sort'], string> = { newest: 'Newest', cheapest: 'Cheapest', priciest: 'Priciest' }

/** Grid rows that fit the pane's body, at least one, at most three. */
function rowsFor(c: Ctx, each: number): number {
  return Math.max(1, Math.min(3, Math.floor((c.rows - 12) / (each + 1))))
}

/** What a listing asks in return, as a picture: the wanted creature's mini sprite, or its family mark and rarity gem. */
function wantArt(c: Ctx, w: MarketWant, key: string, big = false): RenderElement {
  const { Box, Text } = c.el
  const s = wantSpecies(w, catalogOf(c.state.account))
  const finish = dots(w.shiny ? 'shiny' : '', w.foil ? 'foil' : '')
  const mark = (
    <Box flexDirection="row" columnGap={SPACE.tight} flexShrink={0}>
      <Text color={INK.accent}>{MARK.swap}</Text>
      {s && big ? formMini(c, `${key}-art`, s, true) : null}
      {!s && w.family ? <Text color={FAMILY_COLOR[w.family]}>{FAMILY_MARK[w.family]}</Text> : null}
      {!s && w.rarity ? <Text color={RARITY_COLOR[w.rarity]}>{`${RARITY_INITIAL[w.rarity]}+`}</Text> : null}
      {!s && !w.family && !w.rarity ? <Text dimColor>any</Text> : null}
    </Box>
  )
  // the wanted creature's name (and finish) under its art: never cut
  const words = s ? wantWords(w, catalogOf(c.state.account)) : finish
  return (
    <Box key={key} flexDirection={s && big ? 'column' : 'row'} columnGap={SPACE.tight} flexShrink={0}>
      {mark}
      {words ? <Text wrap="wrap" dimColor={!s}>{words}</Text> : null}
    </Box>
  )
}

/** The terms under a listing's tile: the price chip, then what it wants in return. */
function terms(c: Ctx, l: Listing, key: string, width: number): RenderElement {
  const { Box } = c.el
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap" columnGap={SPACE.tight} width={width}>
      {l.price > 0 || !l.want ? priceChip(c, l.price) : null}
      {l.want ? wantArt(c, l.want, `${key}-want`, width >= TILE) : null}
    </Box>
  )
}

/** One chip of the filter row: bright when it narrows, dim at its default; the hotkey cycles it. */
function filterChip(c: Ctx, key: string, label: string, on: boolean, hotkey: string | undefined, press: () => unknown): RenderElement {
  return btn(c, { key, label, hotkey, dim: !on, on: press })
}

function chips(c: Ctx): RenderElement | null {
  const q = marketChips(c.state.pane)
  const set = (change: Partial<MarketQuery & { mine: boolean }>) => c.actions.marketFilter(change)
  const famLabel = q.family === 'all' ? 'All families' : `${FAMILY_MARK[q.family]} ${FAMILY_INFO[q.family].name}`
  const rarLabel = q.rarity === 'all' ? 'Any rarity' : `${RARITY_INITIAL[q.rarity]} ${title(q.rarity)}+`
  return actions(c, [
    filterChip(c, 'chip-family', famLabel, q.family !== 'all', 'm', () => set({ family: cycle(FAMILY_CHIPS, q.family) })),
    filterChip(c, 'chip-rarity', rarLabel, q.rarity !== 'all', 'y', () => set({ rarity: cycle(RARITY_CHIPS, q.rarity) })),
    filterChip(c, 'chip-kind', KIND_LABEL[q.kind], q.kind !== 'all', 'k', () => set({ kind: cycle(KINDS, q.kind) })),
    filterChip(c, 'chip-sort', SORT_LABEL[q.sort], q.sort !== 'newest', 's', () => set({ sort: cycle(SORTS, q.sort) })),
    filterChip(c, 'chip-shiny', 'Shiny', q.shiny, undefined, () => set({ shiny: !q.shiny })),
    filterChip(c, 'chip-foil', 'Foil', q.foil, undefined, () => set({ foil: !q.foil })),
  ])
}

/** The Market section: everyone's listings, or your own with `l`. */
export function marketScreen(c: Ctx): Shown {
  const q = marketChips(c.state.pane)
  const me = c.state.me!
  const mine = me.listings ?? []
  const { Box, Text } = c.el
  const toggle = btn(c, {
    key: 'market-mine', label: q.mine ? 'Everyone\'s listings' : `Your listings (${mine.length})`, hotkey: 'l',
    on: () => c.actions.marketFilter({ mine: !q.mine }),
  })
  const sparks = (
    <Text><Text color={STAT.sales.color}>{MARK.spark}</Text><Text bold>{` ${grouped(me.player.sparks)}`}</Text><Text dimColor> yours</Text></Text>
  )
  const small = c.columns < 2 * TILE + 2 * SPACE.tight + TILE
  const per = small ? perRow(c.columns, CHIP) : perRow(c.columns, TILE)
  const size = per * rowsFor(c, small ? 9 : 14)
  const open = (l: Listing) => () => c.actions.push({ kind: 'listing', listingId: l.id, cardId: null })
  const tileOf = (l: Listing, note: string) => (small ? chip : tile)(c, l.card, {
    key: `listing-${l.id}`, on: open(l), note, extra: terms(c, l, `listing-${l.id}-terms`, small ? CHIP : TILE),
  })
  if (q.mine) {
    const pg = paged(mine, c.state.pane.page, size)
    const pages = pg.pages > 1
    return {
      body: column(c, [
        <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>{toggle}{sparks}</Box>,
        mine.length === 0
          ? para(c, 'Nothing of yours on the market. Open a card in Collection and press l to sell it.', { dim: true })
          : grid(c, pg.items.map(l => tileOf(l, `listed ${dayLabel(l.day, today(c.now))}`)), per),
        pages ? pager(c, pg.page, pg.pages, false) : null,
      ]),
      hints: [tabsHint(c.state), 'l Everyone\'s', pages ? 'n Next page' : '', mine.length > 0 ? 'Tab Pick a listing' : '', 'esc Close'],
    }
  }
  const m = c.state.social.market
  const loading = c.state.social.loading.includes('market')
  const listings = (m?.listings ?? []).filter(l => l.state === 'open' && l.seller.toLowerCase() !== me.player.handle.toLowerCase())
  const pg = paged(listings, c.state.pane.page, size)
  const more = !!m?.next
  const pages = pg.pages > 1 || more
  return {
    body: column(c, [
      <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>{toggle}{sparks}</Box>,
      chips(c),
      !m && loading ? line(c, 'Reading the market…', { dim: true })
        : !m ? para(c, 'The market did not load. Press a chip to look again.', { dim: true })
        : listings.length === 0
          ? para(c, 'Nothing listed like that right now. Change the chips, or sell one of yours from its card page (l in Collection).', { dim: true })
          : grid(c, pg.items.map(l => tileOf(l, safe(l.seller, 40))), per),
      pages && listings.length > 0 ? pager(c, pg.page, pg.pages, more) : null,
    ]),
    // the hint names the page key as its button does: More where the next press reads further
    hints: [tabsHint(c.state), 'm y k s Chips', pages ? `n ${pg.page >= pg.pages - 1 && more ? 'More' : 'Next page'}` : '', 'l Your listings', listings.length > 0 ? 'Tab Pick a card' : '', 'esc Close'],
  }
}

/** Next and previous pages; past the last page the market reads the next one. */
function pager(c: Ctx, page: number, pages: number, more: boolean): RenderElement | null {
  const last = page >= pages - 1
  return actions(c, [
    btn(c, {
      key: 'page-next', label: last && more ? 'More' : 'Next page', hotkey: 'n', on: async () => {
        if (last && more) {
          await c.actions.market(true)
          await c.actions.pane(p => ({ ...p, page: page + 1 }))
        } else await c.actions.pane(p => ({ ...p, page: last ? 0 : page + 1 }))
      },
    }),
    pages > 1 ? btn(c, { key: 'page-prev', label: 'Previous', hotkey: 'p', on: () => c.actions.pane(p => ({ ...p, page: (page - 1 + pages) % pages })) }) : null,
    <c.el.Text dimColor>{`page ${page + 1} of ${pages}${more ? '+' : ''}`}</c.el.Text>,
  ])
}

// ---------- one listing: the confirm ----------

function findListing(c: Ctx, id: string): Listing | null {
  return c.state.social.market?.listings.find(l => l.id === id) ?? c.state.me?.listings?.find(l => l.id === id) ?? null
}

/** A recent sale as a chip: the price and the day, never who. */
function saleChips(c: Ctx, species: string): RenderElement | null {
  const sales = salesOf(c.state.social.prices ?? c.state.social.market?.prices, species).slice(0, 5)
  if (sales.length === 0) return null
  const { Box, Text } = c.el
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
      <Text dimColor>Sold lately</Text>
      {...sales.map((s, i) => (
        <Box key={`sale-${i}`} flexDirection="row" columnGap={SPACE.tight} flexShrink={0}>
          {priceChip(c, s.price)}
          <Text color={RARITY_COLOR[s.rarity]}>{RARITY_INITIAL[s.rarity]}</Text>
          <Text dimColor>{dayLabel(s.day, today(c.now))}</Text>
        </Box>
      ))}
    </Box>
  )
}

/** A listing's page (SPEC 8): the card in full, the seller, what you give and what you get, then Buy with one press. */
export function listingScreen(c: Ctx, v: { listingId: string; cardId: string | null }): Shown {
  const l = findListing(c, v.listingId)
  const crumb = line(c, l ? `Market › ${nameOf(l.card)}` : 'Market', { dim: true })
  if (!l || l.state !== 'open') {
    return { body: column(c, [crumb, para(c, 'That listing is gone: sold, taken off or lapsed.', { dim: true })]), hints: ['esc Back'] }
  }
  const me = c.state.me
  const { Box, Text } = c.el
  const ownIt = !!me && (me.listings?.some(x => x.id === l.id) || l.seller.toLowerCase() === me.player.handle.toLowerCase())
  const sparks = me?.player.sparks ?? 0
  const afford = sparks >= l.price
  const fits = l.want && me ? wantFits(l.want, c.state.cards, me.player.team, c.now) : []
  const picked = l.want ? fits.find(x => x.id === v.cardId) ?? null : null
  const pick = (id: string) => c.actions.pane(p => withTop(p, x => (x.kind === 'listing' ? { ...x, cardId: x.cardId === id ? null : id } : x)))
  const ready = !ownIt && afford && (!l.want || !!picked) && !c.state.account.readOnly
  const buyLabel = l.price > 0 && l.want ? `Buy for ${MARK.spark} ${grouped(l.price)} + ${picked ? nameOf(picked) : 'a card'}`
    : l.price > 0 ? `Buy for ${MARK.spark} ${grouped(l.price)}` : `Swap for ${picked ? nameOf(picked) : 'a card'}`
  const duel = canChallenge(c, l.seller)
  const giveRow = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
      <Box width={8} flexShrink={0}><Text dimColor>You give</Text></Box>
      {l.price > 0 ? priceChip(c, l.price) : null}
      {l.want ? (picked ? chip(c, picked, { key: 'give-picked' }) : wantArt(c, l.want, 'give-want', true)) : null}
    </Box>
  )
  const getRow = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
      <Box width={8} flexShrink={0}><Text dimColor>You get</Text></Box>
      <Text wrap="wrap" color={rarityColor(l.card)}>{nameOf(l.card)}</Text>
    </Box>
  )
  const seller = (
    <Box key="seller-row" flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
      <Text dimColor>{ownIt ? 'Yours' : 'Seller'}</Text>
      {ownIt ? null : btn(c, { key: 'seller', label: safe(l.seller, 40), lit: true, on: async () => {
        await c.actions.push({ kind: 'profile', handle: l.seller, give: [], get: [], counterOf: null })
        await c.actions.profile(l.seller)
      } })}
      {duel && !ownIt ? btn(c, { key: 'challenge', label: 'Challenge', hotkey: 'c', on: () => c.actions.challenge(l.seller) }) : null}
      <Text dimColor>{`listed ${dayLabel(l.day, today(c.now))}`}</Text>
    </Box>
  )
  const picker = l.want && !ownIt ? column(c, [
    line(c, fits.length > 0 ? `Pick the card you give (${wantWords(l.want, catalogOf(c.state.account))})` : `You have no ${wantWords(l.want, catalogOf(c.state.account))} free to give yet.`, { dim: true }),
    fits.length > 0 ? grid(c, fits.slice(0, perRow(c.columns, CHIP) * 2).map((x, i) => chip(c, x, {
      key: `fit-${x.id}`, hotkey: i < 3 ? String(i + 2) : undefined, selected: x.id === v.cardId, on: () => pick(x.id),
    })), perRow(c.columns, CHIP)) : null,
  ], SPACE.none) : null
  return {
    body: column(c, [
      crumb,
      card(c.el, c.surface, l.card, 'full', { key: 'listing-card', width: c.columns, motion: c.motion, offline: c.offline, now: c.now }),
      seller,
      saleChips(c, l.card.species),
      ownIt ? null : giveRow,
      ownIt ? null : getRow,
      picker,
      ownIt ? null : afford ? null : para(c, `You have ${MARK.spark} ${grouped(sparks)}: ${grouped(l.price - sparks)} more to go. Battles and recycling earn sparks.`, { color: INK.warn }),
      ownIt
        ? actions(c, [btn(c, { key: 'cancel-listing', label: c.columns < 26 ? 'Remove listing' : 'Take it off the market', hotkey: 'x', on: () => c.actions.hold('cancel-listing', l.id) })])
        : actions(c, [ready ? btn(c, { key: 'buy', label: buyLabel, hotkey: '1', primary: true, on: () => c.actions.buy(l.id, picked?.id ?? null) }) : null]),
      ownIt ? holdLine(c, 'cancel-listing', l.id, 'x') : null,
      ready ? line(c, `After: ${MARK.spark} ${grouped(sparks - l.price)}`, { dim: true }) : null,
    ]),
    hints: [ready ? '1 Buy' : '', l.want && fits.length > 0 && !ownIt ? '2-4 Pick yours' : '', duel && !ownIt ? 'c Challenge' : '', ownIt ? 'x Take it off' : '', 'esc Back'],
  }
}

// ---------- selling one of yours ----------

/** The seller applies an exact price (or an optional hint), then separately confirms the full listing terms. */
export function sellScreen(c: Ctx, v: { cardId: string; price: number; want: MarketWant | null }): Shown {
  const x = c.state.cards.find(k => k.id === v.cardId)
  const crumb = (name: string) => para(c, `Cards › ${name} › Sell`, { dim: true })
  if (!x || x.state !== 'owned') return { body: column(c, [crumb('Sell'), para(c, 'That card is not free to sell now.', { dim: true })]), hints: ['esc Back'] }
  const me = c.state.me
  const sales = salesOf(c.state.social.prices ?? c.state.social.market?.prices, x.species)
  const hints = priceHints(x, sales)
  const price = v.price > 0 ? v.price : v.want ? 0 : startPrice(x, sales)
  const set = (change: Partial<{ price: number; want: MarketWant | null }>) => c.actions.pane(p => {
    const top = p.stack.at(-1)
    return top?.kind === 'sell' && top.cardId === v.cardId
      ? { ...withTop(p, w => (w.kind === 'sell' ? { ...w, ...change } : w)), message: '' } : p
  })
  const applyPrice = (text: string) => {
    const chosen = parsePrice(text)
    if (chosen !== null) return set({ price: chosen })
    return c.actions.pane(p => {
      const top = p.stack.at(-1)
      return top?.kind === 'sell' && top.cardId === v.cardId
        ? { ...p, message: `Enter a whole price from 1 to ${grouped(ECONOMY.market.maxPrice)} sparks.` } : p
    })
  }
  const problem = me ? sellProblem(x, me.player.team, c.state.cards) : ''
  const { Box, Text, Input } = c.el
  // the card beside the price: a tile where there is room, else its mini
  const big = c.columns >= TILE + 30
  const beside = c.columns >= CHIP + SPACE.loose + 20
  const ic: Ctx = { ...c, columns: beside ? c.columns - (big ? TILE : CHIP) - SPACE.loose : c.columns }
  const stepper = (
    <Box flexDirection="row" columnGap={SPACE.loose} width={ic.columns} flexWrap="wrap">
      {btn(c, { key: 'price-down', label: 'Lower', hotkey: 'j', on: () => set({ price: v.want ? stepPrice(price, -1) : Math.max(1, stepPrice(price, -1)) }) })}
      {btn(c, { key: 'price-up', label: 'Higher', hotkey: 'k', on: () => set({ price: Math.min(ECONOMY.market.maxPrice, stepPrice(price, 1)) }) })}
    </Box>
  )
  const hintChips = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={ic.columns}>
      {...hints.map((hint, i) => (
        <Box key={`hint-${i}`} flexDirection="row" flexWrap="wrap" columnGap={SPACE.tight} width={Math.min(ic.columns, 44)} flexShrink={0}>
          {btn(c, { key: `price-hint-${i}`, label: `${MARK.spark} ${grouped(hint.price)}`, hotkey: String(i + 2), dim: hint.price !== price, on: () => set({ price: hint.price }) })}
          <Text dimColor wrap="wrap">{hint.label}</Text>
        </Box>
      ))}
    </Box>
  )
  const wants = me ? wantChoices(x, me.player.wishlist) : []
  const wantRow = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
      {btn(c, { key: 'want-none', label: 'Sparks only', dim: v.want !== null, on: () => set({ want: null, price: price > 0 ? price : startPrice(x, sales) }) })}
      {...wants.map((w, i) => {
        const s = wantSpecies(w, catalogOf(c.state.account))
        return (
          <Box key={`want-${i}`} flexDirection="row" flexWrap="wrap" columnGap={SPACE.tight} rowGap={SPACE.tight} width={Math.min(c.columns, CHIP + 24)} flexShrink={0}>
            {s ? formMini(c, `want-${i}-art`, s, true) : <Text color={FAMILY_COLOR[x.family]}>{FAMILY_MARK[x.family]}</Text>}
            {btn(c, { key: `want-${i}`, label: `${MARK.swap} ${wantWords(w, catalogOf(c.state.account))}`, dim: !sameWant(v.want, w), lit: true, on: () => set({ want: sameWant(v.want, w) ? null : w, price }) })}
          </Box>
        )
      })}
      {v.want ? btn(c, { key: 'want-sparks', label: price > 0 ? 'Card only' : 'Sparks too', on: () => set({ price: price > 0 ? 0 : startPrice(x, sales) }) }) : null}
    </Box>
  )
  const name = nameOf(x)
  const label = price > 0 && v.want ? `List for ${MARK.spark} ${grouped(price)} + ${wantWords(v.want, catalogOf(c.state.account))}`
    : price > 0 ? `List for ${MARK.spark} ${grouped(price)}` : v.want ? `List for ${wantWords(v.want, catalogOf(c.state.account))}` : 'List'
  const shortLabel = label.length + 3 > c.columns
  const ready = !problem && (price > 0 || !!v.want) && !c.state.account.readOnly
  return {
    body: column(c, [
      crumb(name),
      <Box flexDirection={beside ? 'row' : 'column'} columnGap={SPACE.loose} rowGap={SPACE.tight} width={c.columns}>
        <Box flexShrink={0}>{(big ? tile : chip)(c, x, { key: 'sell-card' })}</Box>
        {column(ic, [
          <Input key="sell-price" label={price > 0 ? 'Your price (sparks)' : 'Add sparks (optional)'} value={price > 0 ? String(price) : ''} placeholder="1–1,000,000" submitLabel="Apply" onSubmit={text => { void applyPrice(text) }} />,
          stepper,
          line(ic, 'Optional suggestions', { dim: true }),
          hintChips,
          sales.some(s => s.rarity === x.rarity && s.shiny === x.shiny && s.foil === !!x.foil)
            ? null : line(ic, 'No matching recent sales.', { dim: true }),
        ], SPACE.tight)}
      </Box>,
      line(c, 'Ask for a card too', { dim: true }),
      wantRow,
      problem ? para(c, problem, { color: INK.warn }) : null,
      shortLabel ? line(c, label, { dim: true }) : null,
      actions(c, [ready ? btn(c, { key: 'list', label: shortLabel ? 'List on market' : label, hotkey: '1', primary: true, on: () => c.actions.list(x.id, price, v.want) }) : null]),
      para(c, 'It waits on the market for up to 14 days, held off your team. Take it off any time.', { dim: true }),
    ]),
    hints: [ready ? '1 List' : '', 'j k Price', hints.length === 1 ? '2 Suggested' : hints.length > 1 ? `2-${hints.length + 1} Suggested` : '', 'esc Back'],
  }
}

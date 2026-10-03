// The Trade tab (SPEC 8, 19, 25): the inbox (accept, decline, counter; cancel your own with a hold), the board of
// matches and recent cards, the Wandering Trader, and gifts (claim, redeem, your open gifts). A player's profile
// doubles as the offer builder. Offline, players' trading is one line away: only the Trader is in that world.
import type { RenderElement } from 'claude-code'
import type { OfferView } from '../core/api.ts'
import type { BattleCard, Card } from '../core/types.ts'
import { ECONOMY } from '../core/economy.ts'
import { DROP_CODE_RE, GIFT_CODE_RE } from '../core/schemas.ts'
import { isOnServer } from '../core/servers.ts'
import { hasFeature, nameOf } from '../client/game.ts'
import { linkHref } from '../client/net.ts'
import { dots, plural, safe, span } from '../client/text.ts'
import {
  TRADE_SECTIONS, byNewest, dealLine, offerLeft, perRow, tradeSection, tradeable, traderPicks, withTop,
} from '../client/viewmodels.ts'
import type { TradeSection } from '../client/viewmodels.ts'
import type { Ctx, Shown } from './pane-kit.tsx'
import {
  CHIP, actions, btn, chip, column, grid, heading, holdLine, leagueBadge, line, para, statRow, tabsHint, tile,
} from './pane-kit.tsx'
import { MARK, SPACE, STAT } from './tokens.ts'

const SHOWN = 4

const LABEL: Record<TradeSection, { label: string; hotkey: string }> = {
  inbox: { label: 'Inbox', hotkey: 'i' }, board: { label: 'Board', hotkey: 'b' }, trader: { label: 'Trader', hotkey: 'w' }, gifts: { label: 'Gifts', hotkey: 'g' },
}

function sections(c: Ctx, current: TradeSection): RenderElement | null {
  const me = c.state.me
  const open = me?.offers.incoming.filter(o => o.state === 'open').length ?? 0
  const list = TRADE_SECTIONS.filter(s => s !== 'trader' || hasFeature(c.state.account, 'trader'))
  return actions(c, list.map(s => btn(c, {
    key: `section-${s}`, label: s === 'inbox' && open > 0 ? `Inbox (${open})` : LABEL[s].label, hotkey: LABEL[s].hotkey, dim: s !== current,
    on: async () => {
      await c.actions.pane(p => ({ ...p, page: TRADE_SECTIONS.indexOf(s), message: '' }))
      if (s === 'board') await c.actions.load('board')
      if (s === 'trader') await c.actions.load('trader')
    },
  })))
}

/** A row of chips with a label in front: what one side of an offer gives. */
function side(c: Ctx, label: string, cards: readonly BattleCard[], key: string): RenderElement {
  const { Box, Text } = c.el
  return (
    <Box flexDirection="row" columnGap={SPACE.tight}>
      <Box width={9} flexShrink={0}><Text dimColor>{label}</Text></Box>
      {cards.length === 0 ? <Text dimColor>nothing</Text> : null}
      {...cards.slice(0, 3).map((x, k) => chip(c, x, { key: `${key}-${k}` }))}
    </Box>
  )
}

function offerBlock(c: Ctx, o: OfferView, incoming: boolean, first: boolean): RenderElement {
  const who = safe(incoming ? o.from : o.to, 40)
  const wide = c.columns >= 9 + 3 * (CHIP + 1) + SPACE.loose + 9 + 3 * (CHIP + 1)
  const give = side(c, incoming ? 'You get' : 'You give', o.give, `${o.id}-give`)
  const get = side(c, incoming ? 'You give' : 'You get', o.get, `${o.id}-get`)
  const counter = () => c.actions.push({ kind: 'profile', handle: o.from, give: o.get.map(x => x.id), get: o.give.map(x => x.id), counterOf: o.id })
  const buttons = incoming
    ? actions(c, [
      btn(c, { key: `accept-${o.id}`, label: 'Accept', hotkey: first ? 'a' : undefined, on: () => c.actions.respond(o.id, 'accept') }),
      btn(c, { key: `decline-${o.id}`, label: 'Decline', hotkey: first ? 'n' : undefined, on: () => c.actions.respond(o.id, 'decline') }),
      btn(c, { key: `counter-${o.id}`, label: 'Counter', hotkey: first ? 'c' : undefined, on: async () => { await counter(); await c.actions.profile(o.from) } }),
    ])
    : actions(c, [btn(c, { key: `cancel-${o.id}`, label: 'Cancel', hotkey: first ? 'x' : undefined, on: () => c.actions.hold('cancel-offer', o.id) })])
  return column(c, [
    line(c, dots(incoming ? `${who} offers` : `To ${who}`, offerLeft(o, c.now))),
    wide ? <c.el.Box flexDirection="row" columnGap={SPACE.loose}>{give}{get}</c.el.Box> : column(c, [give, get], SPACE.none),
    buttons,
    incoming ? null : holdLine(c, 'cancel-offer', o.id, first ? 'x' : 'Cancel'),
  ], SPACE.none)
}

function inbox(c: Ctx): { body: RenderElement; hints: string[] } {
  const me = c.state.me!
  const incoming = me.offers.incoming.filter(o => o.state === 'open')
  const outgoing = me.offers.outgoing.filter(o => o.state === 'open')
  if (incoming.length + outgoing.length === 0) {
    const trader = hasFeature(c.state.account, 'trader')
    const text = `No offers yet. Mark cards for trade in Cards so others find them, or make an offer from the Board.${trader ? ' The Wandering Trader deals with you today: w.' : ''}`
    return { body: para(c, text, { dim: true }), hints: ['b Board', trader ? 'w Trader' : '', 'g Gifts'] }
  }
  return {
    body: column(c, [
      incoming.length > 0 ? heading(c, `Offers for you (${incoming.length})`) : null,
      ...incoming.slice(0, SHOWN).map((o, i) => offerBlock(c, o, true, i === 0)),
      incoming.length > SHOWN ? line(c, `and ${incoming.length - SHOWN} more waiting`, { dim: true }) : null,
      outgoing.length > 0 ? heading(c, `Your offers (${outgoing.length})`) : null,
      ...outgoing.slice(0, SHOWN).map((o, i) => offerBlock(c, o, false, i === 0)),
    ]),
    hints: [incoming.length > 0 ? 'a Accept · n Decline · c Counter' : '', outgoing.length > 0 ? 'x Cancel' : ''],
  }
}

function openProfile(c: Ctx, handle: string, give: string[], get: string[]): () => Promise<void> {
  return async () => {
    await c.actions.push({ kind: 'profile', handle, give, get, counterOf: null })
    await c.actions.profile(handle)
  }
}

function board(c: Ctx): { body: RenderElement; hints: string[] } {
  const s = c.state.social
  const b = s.board
  const wish = (c.state.me?.player.wishlist ?? []).length
  if (s.loading.includes('board') && !b) return { body: line(c, 'Reading the board…', { dim: true }), hints: [] }
  if (!b) return { body: para(c, 'The board did not load. Press b to look again.', { dim: true }), hints: ['b Look again'] }
  const matches = b.matches.slice(0, SHOWN)
  const per = perRow(c.columns, CHIP)
  return {
    body: column(c, [
      heading(c, `Matches (${b.matches.length})`, 'they have what you wish for, and want what you trade'),
      matches.length === 0
        ? line(c, wish === 0 ? 'Add species to your wishlist from the Album to find matches.' : 'No matches today.', { dim: true })
        : column(c, matches.map((m, i) => (
          <c.el.Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
            {chip(c, m.theirs, { key: `match-${i}-t` })}
            {chip(c, m.mine, { key: `match-${i}-m` })}
            <c.el.Box flexDirection="column" flexShrink={1}>
              <c.el.Text wrap="wrap">{`${safe(m.handle, 40)} has ${nameOf(m.theirs)}`}</c.el.Text>
              <c.el.Text dimColor wrap="wrap">{`and would like your ${nameOf(m.mine)}`}</c.el.Text>
              {btn(c, { key: `match-${i}-offer`, label: 'Make an offer', on: openProfile(c, m.handle, [m.mine.id], [m.theirs.id]) })}
            </c.el.Box>
          </c.el.Box>
        )), SPACE.tight),
      heading(c, 'For trade lately'),
      b.recent.length === 0
        ? line(c, 'Nothing listed yet. Mark yours for trade so others can find them.', { dim: true })
        : grid(c, b.recent.slice(0, per * 2).map((r, i) => chip(c, r.card, { key: `recent-${i}`, note: safe(r.handle, 24), on: openProfile(c, r.handle, [], [r.card.id]) })), per),
      b.trader.length > 0 ? line(c, `The Wandering Trader has ${plural(b.trader.filter(d => !d.used).length, 'deal')} today · w`, { dim: true }) : null,
    ]),
    hints: ['Tab Pick a card', 'b Refresh'],
  }
}

/** The Wandering Trader. Online its section button (w) visits and looks again; offline, where there are no sections, a button does. */
function trader(c: Ctx): { body: RenderElement; hints: string[] } {
  const s = c.state.social
  const t = s.trader
  if (s.loading.includes('trader') && !t) return { body: line(c, 'Finding the Trader…', { dim: true }), hints: [] }
  if (!t) {
    const about = para(c, 'The Wandering Trader swaps cards you can spare for ones you want, three deals a day.', { dim: true })
    if (!c.offline) return { body: column(c, [about, para(c, 'The Trader has not come by yet. Press w to look again.', { dim: true })]), hints: ['w Look again'] }
    return {
      body: column(c, [about, actions(c, [btn(c, { key: 'trader-visit', label: 'Visit the Trader', hotkey: 'w', on: () => c.actions.load('trader') })])]),
      hints: ['w Visit the Trader'],
    }
  }
  const me = c.state.me
  const team = me?.player.team ?? []
  const blocks = t.deals.slice(0, ECONOMY.trader.deals).map(d => {
    const picks = d.used ? null : traderPicks(d, c.state.cards as Card[], team, c.now)
    return column(c, [
      heading(c, safe(d.name, 40), d.used ? 'done for today ✓' : ''),
      line(c, dealLine(d), { dim: d.used }),
      d.used ? null : picks
        ? column(c, [
          line(c, `Takes ${picks.map(nameOf).join(', ')}`, { dim: true }),
          actions(c, [btn(c, { key: `deal-${d.id}`, label: 'Trade', on: () => c.actions.trade(d.id, picks.map(x => x.id)) })]),
        ], SPACE.none)
        : line(c, `You need ${plural(d.give.count, 'card')} like that, free to trade and off your team.`, { dim: true }),
    ], SPACE.none)
  })
  return {
    body: column(c, [
      heading(c, 'The Wandering Trader', 'new deals every day'),
      ...blocks,
      para(c, 'The Trader picks your plainest spare cards: never your team, shinies, foils or cards marked for trade.', { dim: true }),
    ]),
    hints: ['Tab Pick a deal'],
  }
}

function gifts(c: Ctx): { body: RenderElement; hints: string[] } {
  const me = c.state.me!
  const { Input } = c.el
  const say = (message: string) => c.actions.pane(p => ({ ...p, message }))
  const open = me.gifts.slice(0, SHOWN)
  const redeem = hasFeature(c.state.account, 'redeem')
  return {
    body: column(c, [
      heading(c, 'Claim a gift', 'from a friend\'s link or code'),
      <Input key="claim-code" label="Code" placeholder="quiet-otter-lamp-4821" value="" submitLabel="claim" onSubmit={v => {
        const code = v.trim().toLowerCase()
        void (GIFT_CODE_RE.test(code) ? c.actions.claim(code) : say('A gift code looks like quiet-otter-lamp-4821.'))
      }} />,
      redeem ? heading(c, 'Redeem a drop', 'a code from Spinlings, like FOUNDERS') : null,
      redeem ? <Input key="redeem-code" label="Code" placeholder="FOUNDERS" value="" submitLabel="redeem" onSubmit={v => {
        const code = v.trim()
        void (code.length >= 3 && code.length <= 40 && DROP_CODE_RE.test(code) ? c.actions.redeem(code) : say('A drop code looks like FOUNDERS.'))
      }} /> : null,
      heading(c, `Your gifts (${me.gifts.length})`, `up to ${ECONOMY.gift.open} at once`),
      open.length === 0
        ? para(c, 'Wrap a card from its page in Cards (g). The link brings a friend in, and the card waits for them.', { dim: true })
        : column(c, open.map((g, i) => (
          <c.el.Box flexDirection="column" width={c.columns}>
            <c.el.Box flexDirection="row" columnGap={SPACE.loose}>
              {chip(c, g.card, { key: `gift-${g.code}` })}
              <c.el.Box flexDirection="column" flexShrink={1}>
                <c.el.Text wrap="wrap">{safe(g.code, 48)}</c.el.Text>
                <c.el.Text dimColor wrap="wrap">{g.claimedBy ? `claimed by ${safe(g.claimedBy, 40)}` : g.expiresAt > c.now ? `waiting · ${span(g.expiresAt - c.now)} left` : 'expired · it comes back to you'}</c.el.Text>
                {g.claimedBy ? null : btn(c, { key: `cancel-gift-${g.code}`, label: 'Cancel', hotkey: i === 0 ? 'x' : undefined, on: () => c.actions.hold('cancel-gift', g.code) })}
              </c.el.Box>
            </c.el.Box>
            {holdLine(c, 'cancel-gift', g.code, i === 0 ? 'x' : 'Cancel')}
          </c.el.Box>
        )), SPACE.tight),
    ]),
    hints: ['Tab Type a code', open.some(g => !g.claimedBy) ? 'x Cancel a gift' : ''],
  }
}

export function tradeScreen(c: Ctx): Shown {
  const section = tradeSection(c.state.pane.page, c.offline)
  if (c.offline) {
    const t = trader(c)
    return {
      body: column(c, [
        para(c, 'Trading with other players needs the online world, a fresh collection of its own.', { dim: true }),
        actions(c, [btn(c, { key: 'join-online', label: 'Join online', hotkey: 'j', on: () => c.actions.world('online') })]),
        t.body,
      ]),
      hints: [tabsHint(c.state), 'j Join online', ...t.hints, 'esc Close'],
    }
  }
  const shown = section === 'inbox' ? inbox(c) : section === 'board' ? board(c) : section === 'trader' ? trader(c) : gifts(c)
  return {
    body: column(c, [sections(c, section), shown.body]),
    hints: [tabsHint(c.state), 'i b w g Sections', ...shown.hints, 'esc Close'],
  }
}

// ---------- a player's profile, and the offer builder ----------

const toggle = (list: readonly string[], id: string, max: number) => list.includes(id) ? list.filter(x => x !== id) : list.length < max ? [...list, id] : list

export function profileScreen(c: Ctx, v: { handle: string; give: string[]; get: string[]; counterOf: string | null }): Shown {
  const s = c.state.social
  const prof = s.profile && s.profile.handle.toLowerCase() === v.handle.toLowerCase() ? s.profile : null
  const crumb = line(c, `Trade › ${safe(v.handle, 40)}`, { dim: true })
  if (!prof) {
    const loading = s.loading.includes('profile')
    return { body: column(c, [crumb, para(c, loading ? 'Looking them up…' : `Can't find ${safe(v.handle, 40)} right now.`, { dim: true })]), hints: ['esc Back'] }
  }
  const me = c.state.me
  const counter = v.counterOf ? me?.offers.incoming.find(o => o.id === v.counterOf) ?? null : null
  const theirs = [...prof.forTrade, ...(counter?.give ?? []).filter(x => !prof.forTrade.some(y => y.id === x.id))]
  const mine = (c.state.cards as Card[]).filter(x => tradeable(x, c.now)).sort((a, b) => Number(b.forTrade) - Number(a.forTrade) || byNewest(a, b))
  const per = perRow(c.columns, CHIP)
  const pick = (which: 'give' | 'get', id: string) => c.actions.pane(p => withTop(p, x => (x.kind === 'profile' ? { ...x, [which]: toggle(x[which], id, 3) } : x)))
  const shownMine = [...mine.filter(x => v.give.includes(x.id)), ...mine.filter(x => !v.give.includes(x.id))].slice(0, per * 2)
  const ready = v.give.length >= 1
  const duel = canChallenge(c, prof.handle)
  const { Box, Text } = c.el
  return {
    body: column(c, [
      crumb,
      <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
        <Text bold wrap="wrap">{safe(prof.handle, 40)}</Text>
        {leagueBadge(c, prof.league)}
        <Text><Text color={STAT.species.color}>{MARK.species}</Text><Text>{` ${prof.seenCount}`}</Text><Text dimColor> album</Text></Text>
        {duel ? btn(c, { key: 'challenge', label: 'Challenge', hotkey: 'c', on: () => c.actions.challenge(prof.handle) }) : null}
      </Box>,
      statRow(c, prof.stats, 'their-stats'),
      line(c, 'Their team', { dim: true }),
      prof.team.length === 0 ? line(c, 'No team saved', { dim: true }) : grid(c, prof.team.map((x, k) => chip(c, x, { key: `their-team-${k}` })), per),
      line(c, `For trade · pick up to 3 (${v.get.length})`, { dim: true }),
      theirs.length === 0
        ? line(c, 'Nothing marked for trade. You can still offer a gift-trade.', { dim: true })
        : grid(c, theirs.map((x, k) => chip(c, x, { key: `their-${k}`, selected: v.get.includes(x.id), on: () => pick('get', x.id) })), per),
      line(c, `Your cards · pick 1 to 3 (${v.give.length})`, { dim: true }),
      mine.length === 0
        ? line(c, 'None free to trade yet: starters stay with you.', { dim: true })
        : grid(c, shownMine.map(x => chip(c, x, { key: `mine-${x.id}`, selected: v.give.includes(x.id), on: () => pick('give', x.id) })), per),
      line(c, `You give ${v.give.length} · you get ${v.get.length}`),
      actions(c, [ready ? btn(c, {
        key: 'send-offer', label: v.counterOf ? 'Send counter' : 'Send offer', hotkey: '1', primary: true,
        on: () => (v.counterOf ? c.actions.counter(v.counterOf, v.give, v.get) : c.actions.offer(prof.handle, v.give, v.get)),
      }) : null]),
    ]),
    hints: ['Tab Pick cards', ready ? `1 ${v.counterOf ? 'Send counter' : 'Send offer'}` : '', duel ? 'c Challenge' : '', 'esc Back'],
  }
}

/** A Challenge button goes wherever another player shows, on a server with challenges, never for yourself. */
export function canChallenge(c: Ctx, handle: string): boolean {
  const a = c.state.account
  return a.world === 'online' && !a.readOnly && hasFeature(a, 'challenge') && !!c.state.me
    && c.state.me.player.handle.toLowerCase() !== handle.toLowerCase()
}

// ---------- a gift just wrapped ----------

export function giftScreen(c: Ctx, code: string): Shown {
  const g = c.state.social.gift
  const made = g && g.code === code ? g : null
  const x = made ? c.state.cards.find(k => k.id === made.cardId) ?? c.state.me?.gifts.find(k => k.code === code)?.card ?? null : null
  const { Box, Link, Text } = c.el
  const link = made && isOnServer(made.link, c.state.account.server) ? linkHref(made.link) : null
  const lasts = 'The code works for 14 days; cancel it from Trade › Gifts.'
  // the clipboard is named only when the copy took (a surface may have none): otherwise the two lines show, to copy
  const send = made?.copied === true
    ? [link ? para(c, link, { dim: true }) : null, para(c, `The link and the claim command are on your clipboard. ${lasts}`, { dim: true })]
    : [
      line(c, 'Send your friend these lines:'),
      <Box flexDirection="column" width={c.columns}>
        {link ? <Text wrap="wrap">{link}</Text> : null}
        <Text wrap="wrap">{`/spin claim ${safe(code, 48)}`}</Text>
      </Box>,
      para(c, lasts, { dim: true }),
    ]
  return {
    body: column(c, [
      line(c, 'Cards › Gift', { dim: true }),
      x ? line(c, `Wrapped! ${nameOf(x)} waits for whoever claims it.`, { bold: true }) : line(c, 'Wrapped!', { bold: true }),
      x ? tile(c, x, { key: 'gift-card' }) : null,
      line(c, `Code  ${safe(code, 48)}`),
      link ? <Link href={link}>Open the gift page</Link> : null,
      ...send,
    ]),
    hints: ['esc Back'],
  }
}


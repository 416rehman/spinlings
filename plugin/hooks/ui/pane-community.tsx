// The Community hub, your live game numbers, and small explanations reached from the pane's controls.
import type { RenderElement } from 'claude-code'
import { ECONOMY } from '../core/economy.ts'
import { FAMILIES, FAMILY_INFO, SPECIALS } from '../core/families.ts'
import { hasFeature } from '../client/game.ts'
import { safe } from '../client/text.ts'
import { BOARDS, grouped, hello } from '../client/viewmodels.ts'
import type { Ctx, Shown } from './pane-kit.tsx'
import { actions, btn, column, heading, leagueBadge, line, para, statRow } from './pane-kit.tsx'
import { FAMILY_COLOR, FAMILY_MARK, MARK, SPACE, STAT } from './tokens.ts'

const BOARD_LABEL = { rating: 'Rating', beaten: 'Players beaten', duelWins: 'Duel wins', species: 'Species', mythics: 'Mythics', sales: 'Market sales' } as const

function boardButtons(c: Ctx): RenderElement | null {
  const full = hasFeature(c.state.account, 'stats')
  return actions(c, BOARDS.filter(b => full || b.board === 'rating').map(b => btn(c, {
    key: `community-board-${b.board}`, label: `${STAT[b.stat].mark} ${BOARD_LABEL[b.board]}`,
    on: async () => {
      await c.actions.push({ kind: 'boards', board: b.board, period: 'all' })
      await c.actions.rankings(b.board, 'all')
    },
  })))
}

export function communityScreen(c: Ctx): Shown {
  const p = c.state.me!.player
  const boards = !c.offline && (hasFeature(c.state.account, 'stats') || hasFeature(c.state.account, 'leaderboard'))
  const openTrades = async (page: number, load?: 'board' | 'trader') => {
    await c.actions.pane(pane => ({ ...pane, page }))
    await c.actions.push({ kind: 'trades' })
    if (load) await c.actions.load(load)
  }
  const incoming = c.state.me!.offers.incoming.filter(o => o.state === 'open').length
  return {
    body: column(c, [
      heading(c, 'Community'),
      actions(c, [btn(c, { key: 'my-profile', label: `${MARK.dot} Your profile`, hotkey: 'p', on: () => c.actions.push({ kind: 'mine' }) })]),
      line(c, `${safe(p.handle, 40)} · ${p.league} league · ${grouped(p.rating)} rating`, { dim: true }),
      boards ? heading(c, 'Leaderboards') : null,
      boards ? boardButtons(c) : null,
      c.offline ? para(c, 'Play online to meet other trainers and join the leaderboards.', { dim: true }) : null,
      heading(c, 'Trading'),
      actions(c, [
        c.offline ? btn(c, { key: 'community-online', label: 'Join online', on: () => c.actions.world('online') }) : null,
        !c.offline ? btn(c, { key: 'community-inbox', label: `Offers${incoming ? ` (${incoming})` : ''}`, hotkey: 'i', on: () => openTrades(0) }) : null,
        !c.offline ? btn(c, { key: 'community-trade-board', label: 'Find a trade', hotkey: 'b', on: () => openTrades(1, 'board') }) : null,
        hasFeature(c.state.account, 'trader') ? btn(c, { key: 'community-trader', label: 'Wandering Trader', hotkey: 'w', on: () => openTrades(2, 'trader') }) : null,
        !c.offline ? btn(c, { key: 'community-gifts', label: 'Gifts', hotkey: 'g', on: () => openTrades(3) }) : null,
      ]),
    ]),
    hints: ['esc Close'],
  }
}

export function mineScreen(c: Ctx): Shown {
  const p = c.state.me!.player
  const next = ECONOMY.leagues.find(l => l.min > p.rating)
  const stats = p.stats
  const { Box, Text, Link } = c.el
  return {
    body: column(c, [
      heading(c, 'Your profile'),
      line(c, safe(p.handle, 40), { bold: true }),
      <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
        {leagueBadge(c, p.league)}
        <Text>{`${MARK.rank} ${grouped(p.rating)} rating`}</Text>
        <Text>{`${MARK.spark} ${grouped(p.sparks)} sparks`}</Text>
      </Box>,
      next ? para(c, `${grouped(next.min - p.rating)} rating to ${next.name}. Matched duels move your rating.`, { dim: true }) : para(c, 'Star is the highest league. Matched duels move your rating.', { dim: true }),
      line(c, `${p.streak} win streak · a pack every ${ECONOMY.streak.every} wins in a row`, { dim: true }),
      heading(c, 'Your stats'),
      statRow(c, stats, 'profile-stats'),
      stats ? actions(c, [
        <Text dimColor>{`${grouped(stats.duelLosses)} duel losses`}</Text>,
        <Text dimColor>{`${grouped(stats.wildWins)} wild wins`}</Text>,
      ]) : para(c, 'This server has no detailed stats yet. Your collection and rating are above.', { dim: true }),
      line(c, `${c.state.cards.length} cards · ${p.seen.length} species discovered`, { dim: true }),
      !c.offline ? para(c, p.leaderboard ? 'Your public stats and ranks update at midnight UTC.' : 'Your stats and ranks are hidden from other trainers.', { dim: true }) : null,
      actions(c, [
        btn(c, { key: 'profile-collection', label: 'Your collection', on: () => c.actions.tab('cards') }),
        !c.offline && hasFeature(c.state.account, 'passkey') ? btn(c, { key: 'profile-devices', label: 'Passkey & devices', on: () => c.actions.push({ kind: 'devices' }) }) : null,
        btn(c, { key: 'profile-privacy', label: 'Privacy & settings', on: () => c.actions.push({ kind: 'privacy' }) }),
      ]),
      !c.offline ? <Link href={`${c.state.account.server}/account`}>Open in browser</Link> : null,
      !c.offline ? <Link href={`${c.state.account.server}/u/${encodeURIComponent(p.handle)}`}>View public profile</Link> : null,
    ]),
    hints: ['esc Back'],
  }
}

export function todayScreen(c: Ctx): Shown {
  const day = hello(c.now)
  return {
    body: column(c, [heading(c, day.rule), para(c, `${day.text}.`), para(c, 'A different meadow rule arrives each day at midnight UTC.', { dim: true })]),
    hints: ['esc Back'],
  }
}

export function helpScreen(c: Ctx): Shown {
  return {
    body: column(c, [
      heading(c, 'A little field guide'),
      para(c, 'Your team battles while Claude works. Open packs and catch creatures, then pick three favourites for your team.'),
      heading(c, 'Your numbers'),
      para(c, `${MARK.spark} Sparks buy packs and craft or fuse cards. ${MARK.rank} Rating measures duel results; it sets your league, from Pebble to Star.`),
      para(c, `A win streak counts wins in a row. Every ${ECONOMY.streak.every} wins earns a pack. Friendly challenges do not change it.`),
      heading(c, 'Your creatures'),
      ...FAMILIES.map(f => line(c, `${FAMILY_MARK[f]} ${FAMILY_INFO[f].name} · ${SPECIALS[FAMILY_INFO[f].special].text} · strong against ${FAMILY_INFO[FAMILY_INFO[f].beats].name}`, { color: FAMILY_COLOR[f] })),
      para(c, 'Families are creature types. Your Claude model selects the family of charged packs and the battle arena.', { dim: true }),
      para(c, 'Claude effort brightens the battle band; battles keep the same pace.', { dim: true }),
      para(c, 'Rarity: Common, Rare, Epic, Legendary. A Mythic is one of a kind. Shiny changes colours; Foil adds a rainbow finish.'),
      para(c, 'First Discovered means the first trainer globally to find that species in its season.', { dim: true }),
      para(c, 'Card stats: HP is health, Atk attack, Def defense, Spd speed. Genes show its individual stat potential. Battles raise its level.', { dim: true }),
      heading(c, 'Where to go'),
      para(c, 'Collection holds the individual cards you own. Discoveries tracks species you have collected this season, including cards you no longer own. Community holds your profile, leaderboards, offers and gifts.'),
      para(c, 'Press a creature to inspect it. Buttons show their shortcuts; Tab moves between controls.', { dim: true }),
    ]),
    hints: ['esc Back'],
  }
}

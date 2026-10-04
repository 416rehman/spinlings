// Community's sections, your live game numbers, and small explanations reached from the pane's controls.
import { ECONOMY } from '../core/economy.ts'
import { FAMILIES, FAMILY_INFO, SPECIALS } from '../core/families.ts'
import { communitySection, hasFeature } from '../client/game.ts'
import { catalogOf } from '../client/frozen.ts'
import type { BoardName, BoardPeriod, CommunitySection } from '../client/types.ts'
import { safe } from '../client/text.ts'
import { grouped, hello } from '../client/viewmodels.ts'
import type { Ctx, Shown } from './pane-kit.tsx'
import { actions, btn, column, heading, leagueBadge, line, marketOpen, para, statRow } from './pane-kit.tsx'
import { boardsScreen } from './pane-boards.tsx'
import { marketScreen } from './pane-market.tsx'
import { tradeScreen } from './pane-trade.tsx'
import { FAMILY_COLOR, FAMILY_MARK, MARK, SPACE } from './tokens.ts'

export function communityScreen(c: Ctx, legacy?: { section: CommunitySection; boards?: { board: BoardName; period: BoardPeriod } }): Shown {
  const boards = !c.offline && (hasFeature(c.state.account, 'stats') || hasFeature(c.state.account, 'leaderboard'))
  const requested = legacy?.section ?? communitySection(c.state.pane)
  const section = requested === 'market' && !marketOpen(c.state) || requested === 'boards' && !boards ? 'profile' : requested
  const sections: { id: CommunitySection; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    ...(marketOpen(c.state) ? [{ id: 'market' as const, label: 'Market' }] : []),
    ...(boards ? [{ id: 'boards' as const, label: 'Rankings' }] : []),
    { id: 'trades', label: 'Trading' },
  ]
  const shown = section === 'market' ? marketScreen(c) : section === 'boards' ? boardsScreen(c, legacy?.boards ?? c.state.pane.boards ?? { board: 'rating', period: 'all' })
    : section === 'trades' ? tradeScreen(c) : mineScreen(c)
  return {
    body: column(c, [
      actions(c, sections.map(s => btn(c, { key: `community-${s.id}`, label: s.label, dim: s.id !== section, on: () => c.actions.community(s.id) }))),
      shown.body,
    ]),
    hints: shown.hints,
  }
}

export function mineScreen(c: Ctx): Shown {
  const p = c.state.me!.player
  const next = ECONOMY.leagues.find(l => l.min > p.rating)
  const stats = p.stats
  const { Box, Text } = c.el
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
        !c.offline && c.state.account.link !== 'signed-out' ? btn(c, { key: 'profile-share', label: 'Share profile', hotkey: 's', on: () => c.actions.shareProfile() }) : null,
        !c.offline && hasFeature(c.state.account, 'passkey') ? btn(c, { key: 'profile-devices', label: 'Passkey & devices', on: () => c.actions.push({ kind: 'devices' }) }) : null,
        btn(c, { key: 'profile-privacy', label: 'Privacy & settings', on: () => c.actions.push({ kind: 'privacy' }) }),
      ]),
    ]),
    hints: ['esc Back'],
  }
}

export function todayScreen(c: Ctx): Shown {
  const day = hello(c.now, catalogOf(c.state.account))
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
      para(c, 'Collection holds the cards you own. Discoveries tracks species you collected this season. Community brings together Profile, Market, Rankings and Trading. Pick a section there to see your stats, browse listings, compare ranks or trade.'),
      para(c, 'Press a creature to inspect it. Buttons show their shortcuts; Tab moves between controls.', { dim: true }),
    ]),
    hints: ['esc Back'],
  }
}

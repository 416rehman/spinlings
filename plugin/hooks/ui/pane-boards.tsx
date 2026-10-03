// The leaderboards (SPEC 8): one board at a time (rating, players beaten, duel wins, species, Mythics, sales), all
// time or this season; the top rows with a league badge and the value, your own rank pinned, and from any row the
// player's profile or a Challenge. Numbers as they stood at the last UTC midnight. Online only.
import type { RenderElement } from 'claude-code'
import { hasFeature } from '../client/game.ts'
import { safe } from '../client/text.ts'
import type { BoardName, BoardPeriod, RankRow } from '../client/types.ts'
import { BOARDS, grouped, withTop } from '../client/viewmodels.ts'
import type { Ctx, Shown } from './pane-kit.tsx'
import { actions, btn, column, leagueBadge, line, para } from './pane-kit.tsx'
import { canChallenge } from './pane-trade.tsx'
import { INK, LEAGUE_COLOR, MARK, SPACE, STAT } from './tokens.ts'

/** Rows of a board shown at first; `m` shows more, up to the server's 50. */
const ROWS = 10

const lookOf = (board: BoardName) => STAT[BOARDS.find(b => b.board === board)!.stat]

/** The board switcher: each board a chip with its glyph; the next and previous boards carry n and p. */
function switcher(c: Ctx, board: BoardName, period: BoardPeriod, boards: readonly (typeof BOARDS)[number][]): RenderElement | null {
  const at = boards.findIndex(b => b.board === board)
  const go = (b: BoardName) => c.actions.rankings(b, period)
  return actions(c, boards.map((b, i) => {
    const look = STAT[b.stat]
    const hotkey = boards.length > 1 && i === (at + 1) % boards.length ? 'n' : boards.length > 2 && i === (at - 1 + boards.length) % boards.length ? 'p' : undefined
    return btn(c, { key: `board-${b.board}`, label: `${look.mark} ${b.label}`, hotkey, dim: b.board !== board, on: () => go(b.board) })
  }))
}

/** One row: rank, league, the handle (press for their profile), the value, and Challenge. */
function row(c: Ctx, r: RankRow, board: BoardName, o: { mine: boolean; key: string }): RenderElement {
  const { Box, Text } = c.el
  const look = lookOf(board)
  const medal = r.rank <= 3
  const open = async () => {
    await c.actions.push({ kind: 'profile', handle: r.handle, give: [], get: [], counterOf: null })
    await c.actions.profile(r.handle)
  }
  return (
    <Box key={o.key} flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
      <Box width={4} flexShrink={0}><Text color={medal ? INK.accent : INK.muted} bold={medal}>{`${r.rank}`}</Text></Box>
      {c.columns >= 64 ? leagueBadge(c, r.league) : <Text color={LEAGUE_COLOR[r.league] ?? INK.muted}>{MARK.dot}</Text>}
      {o.mine
        ? <Text bold color={INK.accent}>{`You · ${safe(r.handle, 40)}`}</Text>
        : btn(c, { key: `${o.key}-who`, label: safe(r.handle, 40), lit: true, on: open })}
      <Text><Text color={look.color}>{look.mark}</Text><Text bold>{` ${grouped(r.value)}`}</Text></Text>
      {!o.mine && canChallenge(c, r.handle) ? btn(c, { key: `${o.key}-duel`, label: 'Challenge', dim: true, on: () => c.actions.challenge(r.handle) }) : null}
    </Box>
  )
}

export function boardsScreen(c: Ctx, v: { board: BoardName; period: BoardPeriod }): Shown {
  const a = c.state.account
  const full = hasFeature(a, 'stats')
  const boards = full ? BOARDS : BOARDS.filter(b => b.board === 'rating')
  const board = boards.some(b => b.board === v.board) ? v.board : 'rating'
  const r = c.state.social.rankings
  const shown = r && r.board === board && r.period === (full ? v.period : 'all') ? r : null
  const loading = c.state.social.loading.includes('rankings')
  const me = c.state.me
  const hidden = me ? !me.player.leaderboard : false
  const page = Math.max(1, c.state.pane.page + 1)
  const top = shown ? shown.top.slice(0, ROWS * page) : []
  const meRow = shown?.me && !top.some(x => x.handle === shown.me!.handle) ? shown.me : null
  const mineIn = (x: RankRow) => !!me && x.handle.toLowerCase() === me.player.handle.toLowerCase()
  const period = full ? actions(c, [
    btn(c, { key: 'period-all', label: 'All time', hotkey: v.period === 'all' ? undefined : 'a', dim: v.period !== 'all', on: () => c.actions.rankings(board, 'all') }),
    btn(c, { key: 'period-season', label: `Season ${shown?.season ?? ''}`.trim(), hotkey: v.period === 'season' ? undefined : 'a', dim: v.period !== 'season', on: () => c.actions.rankings(board, 'season') }),
  ]) : null
  const more = shown && shown.top.length > top.length
  return {
    body: column(c, [
      line(c, `${MARK.rank} Leaderboards`, { dim: true }),
      switcher(c, board, v.period, boards),
      period,
      !shown && loading ? line(c, 'Reading the board…', { dim: true })
        : !shown ? para(c, 'The board did not load. Press a board to look again.', { dim: true })
        : top.length === 0 ? para(c, 'Nobody on this board yet. The first name here could be yours.', { dim: true })
        : column(c, top.map((x, i) => row(c, x, board, { mine: mineIn(x), key: `rank-${i}` })), SPACE.none),
      meRow ? column(c, [line(c, '···', { dim: true }), row(c, meRow, board, { mine: true, key: 'rank-me' })], SPACE.none) : null,
      more ? actions(c, [btn(c, { key: 'rank-more', label: 'Show more', hotkey: 'm', on: () => c.actions.pane(p => withTop({ ...p, page: p.page + 1 }, x => x)) })]) : null,
      hidden ? actions(c, [
        <c.el.Text dimColor>You are hidden from the boards</c.el.Text>,
        btn(c, { key: 'boards-show-me', label: 'Show me', on: () => c.actions.leaderboard(true) }),
      ]) : null,
      line(c, 'As of the last midnight', { dim: true }),
    ]),
    hints: [boards.length > 1 ? 'n p Boards' : '', full ? 'a All time / season' : '', more ? 'm More' : '', 'Tab Pick a player', 'esc Back'],
  }
}

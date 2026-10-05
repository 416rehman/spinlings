// A native composer control: PromptHint in the terminal, SessionMode in Desktop. Claude's tree stays unread.
// Desktop shapes SessionMode into one compact line, keeping native buttons and their hosted press handlers.
import type { RenderElement } from 'claude-code'
import type { El, GameState } from '../client/types.ts'
import { packReady } from '../client/game.ts'
import { MARK, SPACE } from './tokens.ts'

export type LauncherState = Pick<GameState, 'account' | 'me' | 'battle' | 'prefs' | 'signals' | 'social'>

/** One cue at a time. Never fetch a board just to decorate Claude's composer. */
export function launcherLabel(s: LauncherState): string {
  if (packReady(s)) return `Spinlings ${MARK.dot}`
  const board = s.social.rankings, player = s.me?.player, mine = board?.me
  if (s.account.world === 'online' && s.account.link === 'ready' && s.account.features.includes('stats')
    && !s.battle && !s.social.loading.includes('rankings') && player?.leaderboard
    && board?.board === 'rating' && board.period === 'all' && mine?.handle === player.handle
    && mine.value === player.rating && Number.isSafeInteger(mine.rank) && mine.rank > 0) return `Spinlings #${mine.rank}`
  return 'Spinlings'
}

export function launcher(env: { el: El; state: LauncherState; theirs: RenderElement; open(): void }): RenderElement {
  if (env.state.prefs.quiet) return env.theirs
  const { Box, Button } = env.el
  const label = launcherLabel(env.state)
  return (
    <Box flexDirection="row" columnGap={SPACE.loose} flexWrap="wrap">
      <Box flexShrink={0}><Button key="spinlings-launcher" label={label} plain onPress={env.open} /></Box>
      <Box flexGrow={1} flexShrink={1}>{env.theirs}</Box>
    </Box>
  )
}

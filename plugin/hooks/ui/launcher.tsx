// A native control in the prompt hint site. Claude's own hint stays in the tree, unread; no composer keys are taken.
import type { RenderElement } from 'claude-code'
import type { El, GameState } from '../client/types.ts'
import { newerMod, statusLine } from '../client/game.ts'
import { dots, plural, safe } from '../client/text.ts'
import { MARK, SPACE } from './tokens.ts'

export type LauncherState = Pick<GameState, 'account' | 'me' | 'battle' | 'prefs' | 'signals'>

/** The world is implicit online; connection problems, offline, battles, rests and updates keep their words. */
function hint(state: LauncherState): string {
  const { account } = state
  if (state.battle || state.signals.restingUntil !== null) return statusLine({ ...state, me: null }) ?? ''
  const link = account.link === 'starting' ? 'Starting…' : account.link === 'joining' ? 'Hatching…'
    : account.link === 'signed-out' ? 'Sign in' : account.link === 'unreachable' ? 'Connection unavailable'
    : account.world === 'offline' ? 'Offline' : account.community ? safe(account.host, 80) : ''
  const latest = newerMod(account)
  return dots(link, latest && `update ${latest}`)
}

export function launcher(env: { el: El; state: LauncherState; theirs: RenderElement; open(): void }): RenderElement {
  if (env.state.prefs.quiet) return env.theirs
  const { Box, Text, Button } = env.el
  const { account, me } = env.state
  // A signed-out or changing account must not advertise cached packs belonging to the previous player.
  const packs = account.link === 'ready' || account.link === 'unreachable' ? me?.packs.length ?? 0 : 0
  const label = packs > 0 ? `Spinlings ${MARK.dot} ${plural(packs, 'pack')}` : 'Spinlings'
  const note = hint(env.state)
  return (
    <Box flexDirection="row" columnGap={SPACE.loose} flexWrap="wrap">
      <Box flexShrink={0}><Button key="spinlings-launcher" label={label} plain onPress={env.open} /></Box>
      {note ? <Text dimColor>{note}</Text> : null}
      <Box flexGrow={1} flexShrink={1}>{env.theirs}</Box>
    </Box>
  )
}

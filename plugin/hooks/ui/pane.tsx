// The /spin pane (SPEC 9, 13, 14, 21, 25, 28, 30, 33): the same frame on every screen (header, body, hint row), the
// four tabs, the views pushed over them (card, fuse, species, profile, gift, privacy, devices), the reveal ceremonies,
// the daily hello and /spin demo. Registered in register.tsx's PANE slot; draws only from the state it is handed.
import type { RenderElement } from 'claude-code'
import type { GameState, PaneView } from '../client/types.ts'
import { drawnLayout, noteLayout } from '../client/battleview.ts'
import { INERT, demoStep } from '../client/demo.ts'
import { hasFeature, statusLine } from '../client/game.ts'
import { fit, safe } from '../client/text.ts'
import { band } from './band.tsx'
import { hello, screenOf, withTop } from '../client/viewmodels.ts'
import { ceremonyScreen } from './ceremony.tsx'
import { privacyScreen, devicesScreen } from './pane-account.tsx'
import { albumScreen, speciesScreen } from './pane-album.tsx'
import { cardScreen, cardsScreen, fuseScreen } from './pane-cards.tsx'
import type { Ctx, Shown } from './pane-kit.tsx'
import { actions, btn, column, formMini, frame, line, marketOpen, para, playable } from './pane-kit.tsx'
import { listingScreen, sellScreen } from './pane-market.tsx'
import { teamScreen } from './pane-team.tsx'
import { communityScreen, helpScreen, todayScreen } from './pane-community.tsx'
import { giftScreen, profileScreen } from './pane-trade.tsx'
import { INK, SPACE } from './tokens.ts'

type Env = Parameters<PaneView>[0]

/**
 * Nothing to play yet, or no more (a signed-out machine's cached collection): the start screen shows in place of the
 * tabs, with its own keys, so the tabs carry none. Privacy and devices still open.
 */
function startsHere(s: GameState): boolean {
  const top = screenOf(s.pane).kind
  return !playable(s) && top !== 'privacy' && top !== 'devices'
}

function ctxOf(env: Env, inDemo = false): Ctx {
  const s = env.state
  return {
    el: env.el, surface: env.surface, columns: Math.max(20, Math.floor(env.columns)), rows: env.rows, now: env.now || s.clock,
    actions: env.actions, state: s, root: screenOf(s.pane).kind === 'tab' && !startsHere(s), offline: s.account.world === 'offline',
    motion: s.prefs.motion, versionKey: !inDemo,
  }
}

/**
 * Before there is a collection to play: the silent join, a server that does not answer, an offline save that cannot be
 * opened, and a machine the server no longer knows (a session unused for 180 days, reset elsewhere, a deleted
 * account), where starting fresh is the one action and a passkey sign-in the way back to the old collection.
 */
function starting(c: Ctx): Shown {
  const a = c.state.account
  const online = a.world === 'online'
  const busy = a.link === 'joining' || a.link === 'starting'
  const out = a.link === 'signed-out' && online
  const deleted = out && a.note.startsWith('Your online account was deleted')
  const lead = a.link === 'joining' ? 'Hatching your first Spinling…'
    : a.link === 'starting' ? 'Getting your collection…'
    : !online ? 'Your offline collection could not be opened.'
    : deleted ? 'Your online account was deleted.'
    : out ? `This computer is signed out of ${a.host}.`
    : `Can't reach ${a.host} right now.`
  const guide = busy ? 'It takes a moment and asks nothing of you. Your welcome pack waits in the band.'
    : !online ? 'It is left exactly as it was. Update the mod, or join online for a separate collection.'
    : deleted ? 'Start fresh for a new online collection, or play offline: each world keeps its own.'
    : out ? 'Start fresh for a new online collection, or sign in with a passkey saved on another computer to play the old one.'
    : 'Your cards are safe. Playing offline keeps a separate collection on this machine.'
  // the reason itself, when it says more than the headline (an unreadable save, a server's own words)
  const detail = !busy && !out && a.note && a.note.replace(/\.$/, '') !== lead.replace(/\.$/, '') ? safe(a.note, 160) : ''
  const signIn = out && hasFeature(a, 'passkey')
  return {
    body: column(c, [
      line(c, lead, { bold: true }),
      detail ? para(c, detail, { dim: true }) : null,
      para(c, guide, { dim: true }),
      busy ? null : actions(c, [
        out ? btn(c, { key: 'start-fresh', label: 'Start fresh online', hotkey: '1', primary: true, on: () => c.actions.world('online') }) : null,
        signIn ? btn(c, { key: 'passkey-signin', label: c.columns < 26 ? 'Use a passkey' : 'Sign in with a passkey', hotkey: 'k', on: () => c.actions.push({ kind: 'devices' }) }) : null,
        online
          ? btn(c, { key: 'play-offline', label: 'Play offline', hotkey: 'w', on: () => c.actions.world('offline') })
          : btn(c, { key: 'join-online', label: 'Join online', hotkey: 'w', on: () => c.actions.world('online') }),
      ]),
    ]),
    hints: busy ? ['esc Close'] : [out ? '1 Start fresh' : '', signIn ? 'k Sign in' : '', online ? 'w Play offline' : 'w Join online', 'esc Close'],
    bare: true,
  }
}

/** The daily hello (SPEC 13.11): the first pane of each UTC day shows the rule and the featured species. */
function helloBanner(c: Ctx): RenderElement | null {
  if (!c.state.pane.hello) return null
  const day = hello(c.now)
  const { Box } = c.el
  const name = day.featured ? safe(day.featured.names[day.featured.legendary ? 2 : 0], 24) : ''
  const beside = c.columns >= 30
  const inner: Ctx = { ...c, columns: beside ? c.columns - 8 - SPACE.loose : c.columns }
  return (
    <Box flexDirection={beside ? 'row' : 'column'} columnGap={SPACE.loose} rowGap={SPACE.tight} width={c.columns}>
      {day.featured ? <Box flexShrink={0}>{formMini(c, 'hello-featured', day.featured, true)}</Box> : null}
      {column(inner, [
        line(inner, `Today: ${day.rule}`, { color: INK.accent }),
        para(inner, `${day.text}.${name ? ` Featured: ${name}.` : ''}`, { dim: true }),
        actions(inner, [btn(inner, { key: 'hello-ok', label: 'Got it', dim: true, on: () => c.actions.pane(p => ({ ...p, hello: false })) })]),
      ], SPACE.none)}
    </Box>
  )
}

function tabScreen(c: Ctx): Shown {
  const tab = c.state.pane.tab
  // The old Market tab remains readable as Community's Market section; unavailable sections fall back to Profile.
  const shown = tab === 'cards' ? cardsScreen(c) : tab === 'album' ? albumScreen(c) : tab === 'trade' || tab === 'market' ? communityScreen(c) : teamScreen(c)
  return { ...shown, banner: helloBanner(c) }
}

/** An online-only view in the offline world: one line and the way back (SPEC 28); nothing is asked of a server. */
function onlineOnly(c: Ctx): Shown {
  return {
    body: column(c, [
      para(c, 'This needs the online world, a collection of its own.', { dim: true }),
      actions(c, [btn(c, { key: 'join-online', label: 'Join online', hotkey: '1', primary: true, on: () => c.actions.world('online') })]),
    ]),
    hints: ['1 Join online', 'esc Back'],
  }
}

function route(c: Ctx): Shown {
  const s = c.state
  const top = screenOf(s.pane)
  if (startsHere(s)) return starting(c)
  switch (top.kind) {
    case 'tab': return tabScreen(c)
    case 'reveal': return s.reveal ? ceremonyScreen(c, s.reveal) : tabScreen({ ...c, root: true })
    case 'card': return cardScreen(c, top.cardId)
    case 'fuse': return fuseScreen(c, top.cardId, top.otherId)
    case 'species': return speciesScreen(c, top.speciesId)
    case 'profile': return profileScreen(c, top)
    case 'gift': return giftScreen(c, top.code)
    case 'privacy': return privacyScreen(c)
    case 'devices': return devicesScreen(c)
    case 'trades': return communityScreen(c, { section: 'trades' })
    case 'mine': return communityScreen(c, { section: 'profile' })
    case 'help': return helpScreen(c)
    case 'today': return todayScreen(c)
    case 'demo': return tabScreen({ ...c, root: true })
    case 'boards': return c.offline ? onlineOnly(c) : communityScreen(c, { section: 'boards', boards: top })
    case 'listing': return c.offline ? onlineOnly(c) : listingScreen(c, top)
    case 'sell': return c.offline ? onlineOnly(c) : sellScreen(c, top)
  }
}

/** One screen of the pane, framed: what the demo draws for each of its states too (`inDemo`: u is the demo's own). */
export function draw(env: Env, inDemo = false): RenderElement {
  const c = ctxOf(env, inDemo)
  return frame(c, route(c))
}

/**
 * A band moment as the demo shows it: the band itself at the pane's width, then the status line that goes with it.
 * The band notes the layout it was drawn at for the battle driver's blits, so the real band's note is put back.
 */
function bandDemo(c: Ctx, env: Env, state: GameState): RenderElement {
  const { Box, Text } = c.el
  const held = drawnLayout()
  const tree = band({ ...env, columns: c.columns, rows: 4, now: state.clock, actions: INERT, isWorking: state.signals.working, state })
  noteLayout(held.columns, held.surface)
  const status = statusLine(state)
  return (
    <Box flexDirection="column" width={c.columns} rowGap={SPACE.tight}>
      {line(c, 'Above the prompt', { dim: true })}
      {tree ?? para(c, 'Nothing is live, so the band stays hidden.', { dim: true })}
      {para(c, status ? `Status line · ${status}` : 'Status line · empty', { dim: true })}
      <Text dimColor wrap="truncate-end">{fit('v Next · u Previous · esc Close', c.columns)}</Text>
    </Box>
  )
}

/** `/spin demo`: every state, one at a time, over inert actions (SPEC 21 quality gate). */
function demo(env: Env, step: number): RenderElement {
  const c = ctxOf(env)
  const d = demoStep(step, c.now)
  const go = (by: number) => env.actions.pane(p => withTop(p, v => (v.kind === 'demo' ? { ...v, step: (d.index + by + d.count) % d.count } : v)))
  const { Box, Text } = c.el
  return (
    <Box flexDirection="column" width={c.columns} rowGap={SPACE.tight}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.loose} width={c.columns}>
        <Text color={INK.accent} wrap="truncate-end">{`Demo ${d.index + 1}/${d.count} · ${d.title}`}</Text>
        {btn(c, { key: 'demo-next', label: 'Next', hotkey: 'v', on: () => go(1) })}
        {btn(c, { key: 'demo-prev', label: 'Previous', hotkey: 'u', on: () => go(-1) })}
      </Box>
      {d.band ? bandDemo(c, env, d.state) : draw({ ...env, state: d.state, actions: INERT }, true)}
    </Box>
  )
}

/** The pane (register.tsx's PANE slot). */
export const pane: PaneView = env => {
  const top = env.state.pane.stack[env.state.pane.stack.length - 1]
  if (top?.kind === 'demo') return demo(env, top.step)
  return draw(env)
}

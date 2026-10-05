// The /spin pane (SPEC 9, 13, 14, 21, 25, 28, 30, 33): the same frame on every screen (header, body, hint row), the
// four tabs, the views pushed over them (card, fuse, species, profile, gift, privacy, devices), the reveal ceremonies,
// and the daily hello. Registered in register.tsx's PANE slot; draws only from the state it is handed.
import type { RenderElement } from 'claude-code'
import type { GameState, PaneView } from '../client/types.ts'
import { hasFeature } from '../client/game.ts'
import { catalogOf } from '../client/frozen.ts'
import { safe } from '../client/text.ts'
import { hello, screenOf } from '../client/viewmodels.ts'
import { ceremonyScreen } from './ceremony.tsx'
import { privacyScreen, devicesScreen } from './pane-account.tsx'
import { worldScreen } from './pane-world.tsx'
import { albumScreen, speciesScreen } from './pane-album.tsx'
import { cardScreen, cardsScreen, fuseScreen, teamSlotScreen } from './pane-cards.tsx'
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
  return !playable(s) && top !== 'privacy' && top !== 'devices' && top !== 'world'
}

function ctxOf(env: Env): Ctx {
  const s = env.state
  return {
    el: env.el, surface: env.surface, columns: Math.max(20, Math.floor(env.columns)), rows: env.rows, now: env.now || s.clock,
    actions: env.actions, state: s, root: screenOf(s.pane).kind === 'tab' && !startsHere(s), offline: s.account.world === 'offline',
    motion: s.prefs.motion, hitAreas: !!env.hitAreas,
    hitIntent: JSON.stringify([s.account.world, s.account.server, s.pane.tab, s.pane.community, s.pane.stack]),
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
  const day = hello(c.now, catalogOf(c.state.account))
  const { Box } = c.el
  const name = day.featured ? safe(day.featured.names[day.featured.legendary ? 2 : 0], 24) : ''
  const beside = c.columns >= 30
  const inner: Ctx = { ...c, columns: beside ? c.columns - 8 - SPACE.loose : c.columns }
  return (
    <Box flexDirection={beside ? 'row' : 'column'} columnGap={SPACE.loose} rowGap={SPACE.tight} width={c.columns}>
      {day.featured ? <Box flexShrink={0}>{formMini(c, 'hello-featured', day.featured, true)}</Box> : null}
      {column(inner, [
        line(inner, `Today: ${day.rule}`, { color: INK.accent }),
        para(inner, `${day.rule === 'Shiny Hour' ? day.text.replace('shinies', 'Alt colour cards') : day.text}.${name ? ` Featured: ${name}.` : ''}`, { dim: true }),
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
    case 'team-slot': return teamSlotScreen(c, top.cardId, top.chosenSlot)
    case 'fuse': return fuseScreen(c, top.cardId, top.otherId)
    case 'species': return speciesScreen(c, top.speciesId)
    case 'profile': return profileScreen(c, top)
    case 'gift': return giftScreen(c, top.code)
    case 'privacy': return privacyScreen(c)
    case 'devices': return devicesScreen(c)
    case 'world': return worldScreen(c, top)
    case 'trades': return communityScreen(c, { section: 'trades' })
    case 'mine': return communityScreen(c, { section: 'profile' })
    case 'help': return helpScreen(c)
    case 'today': return todayScreen(c, top.rule)
    case 'boards': return c.offline ? onlineOnly(c) : communityScreen(c, { section: 'boards', boards: top })
    case 'listing': return c.offline ? onlineOnly(c) : listingScreen(c, top)
    case 'sell': return c.offline ? onlineOnly(c) : sellScreen(c, top)
  }
  return tabScreen({ ...c, root: true })
}

/** One screen of the pane, framed. */
export function draw(env: Env): RenderElement {
  const c = ctxOf(env)
  return frame(c, route(c))
}

/** The pane (register.tsx's PANE slot). */
export const pane: PaneView = draw

// Privacy and devices (SPEC 12, 20, 26, 27, 29, 30, 33): what Spinlings reads and sends, where the game lives, the
// anonymous handle and the opt-in leaderboard, the passkey offer, reset access, and deleting everything (each behind
// a 2-second hold). The token never shows; sign-in links show only on the server's own origin.
import type { RenderElement } from 'claude-code'
import { isOnServer } from '../core/servers.ts'
import { hasFeature } from '../client/game.ts'
import { linkHref } from '../client/net.ts'
import { dots, safe, span } from '../client/text.ts'
import { HOOKS, rerollWhen } from '../client/viewmodels.ts'
import type { Ctx, Shown } from './pane-kit.tsx'
import { actions, btn, column, heading, holdLine, line, para, worldBadge } from './pane-kit.tsx'
import { INK, SPACE } from './tokens.ts'

const GUARANTEE = 'Spinlings reads only the shape of a session: the model\'s family, whether Claude is working, '
  + 'how many helpers run and when a usage limit is full. Never your prompts, Claude\'s answers, files, commands, paths or cost.'

function sent(c: Ctx): RenderElement {
  const log = c.state.privacy.slice(-20).reverse()
  if (log.length === 0) return line(c, c.state.account.world === 'offline' ? 'Nothing: the offline world never sends a request.' : 'Nothing sent yet.', { dim: true })
  return column(c, log.map(s => line(c, dots(`${s.method} ${safe(s.path, 60)}`, s.body && s.body !== '{}' ? safe(s.body, 200) : ''), { dim: true })), SPACE.none)
}

/** Signed in on this server right now: what saving a passkey and resetting access need. */
const signedIn = (c: Ctx) => c.state.account.world === 'online' && !!c.state.me && c.state.account.link === 'ready'

/** The passkey offer (SPEC 30.2): no email, no password, and honest about losing every device. */
function passkeyOffer(c: Ctx, hotkey: string): RenderElement | null {
  const a = c.state.account
  if (!signedIn(c) || !hasFeature(a, 'passkey') || (a.devices?.passkeys ?? 0) > 0) return null
  return column(c, [
    actions(c, [btn(c, { key: 'passkey-add', label: 'Save your collection with a passkey', hotkey, primary: hotkey === '1', on: () => c.actions.passkey('add') })]),
    line(c, 'No email, no password. Losing every device without one loses the online account.', { dim: true }),
  ], SPACE.none)
}

/** The sign-in page in flight: a link on the server's own origin, and how it stands. */
function signIn(c: Ctx): RenderElement | null {
  const s = c.state.account.signIn
  if (!s) return null
  const { Link } = c.el
  // only on the server's own origin, and only as the URL parser spells it (anything else and the engine refuses the pane)
  const href = isOnServer(s.url, c.state.account.server) ? linkHref(s.url) : null
  const ok = href !== null
  const status = s.status === 'pending' ? `Waiting for the passkey page · ${span(Math.max(0, s.until - c.now))} left`
    : s.status === 'added' ? 'Passkey saved ✓' : s.status === 'done' ? 'Signed in ✓' : 'The page expired. Try again.'
  return column(c, [
    s.status === 'pending' && href ? <Link href={href}>{s.kind === 'add' ? 'Open the passkey page' : 'Open the sign-in page'}</Link> : null,
    // the whole address, wrapped: a terminal that cannot open links still lets it be copied (SPEC 29)
    s.status === 'pending' && href ? para(c, safe(href, 400), { dim: true }) : null,
    s.status === 'pending' && !ok ? line(c, 'That page is not on this server, so it is not shown.', { color: INK.warn }) : null,
    line(c, status, { color: s.status === 'expired' ? INK.warn : s.status === 'pending' ? INK.muted : INK.good }),
  ], SPACE.none)
}

export function privacyScreen(c: Ctx): Shown {
  const a = c.state.account
  const me = c.state.me
  const online = a.world === 'online'
  // a signed-out machine's cached player is not its own any more
  const p = a.link === 'signed-out' ? undefined : me?.player
  const reroll = online && p && hasFeature(a, 'handle-reroll') ? rerollWhen(p.handleRerollFrom, c.now) : null
  const board = online && p && hasFeature(a, 'leaderboard')
  const offer = passkeyOffer(c, '1')
  const top = c.state.social.leaderboard
  return {
    body: column(c, [
      line(c, 'Privacy', { dim: true }),
      para(c, GUARANTEE),
      line(c, `Hooks: ${HOOKS.join(' · ')}`, { dim: true }),
      heading(c, 'Where your game lives', worldBadge(c.state)),
      para(c, online
        ? a.community
          ? `${a.host} is a community server run by someone else. It gets the same anonymous game data as spinlings.dev, never anything about your work.`
          : `Online on ${a.host}: an anonymous handle, no email, no name, no account to remember.`
        : 'Offline: your collection lives on this machine and nothing leaves it.', { dim: true }),
      p && online ? line(c, `You are ${safe(p.handle, 40)}${board && p.leaderboard ? ' · on the leaderboard' : ''}`) : null,
      offer,
      actions(c, [
        reroll === '' ? btn(c, { key: 'reroll', label: 'Draw a new handle', hotkey: '2', on: () => c.actions.rerollHandle() }) : null,
        board ? btn(c, { key: 'leaderboard', label: p!.leaderboard ? 'Leave the leaderboard' : 'Join the leaderboard', hotkey: '3', on: () => c.actions.leaderboard(!p!.leaderboard) }) : null,
        board ? btn(c, { key: 'leaderboard-show', label: 'Show it', hotkey: '4', dim: true, on: () => c.actions.load('leaderboard') }) : null,
      ]),
      reroll ? line(c, `A new handle can be drawn ${reroll} (once a week).`, { dim: true }) : null,
      board ? line(c, 'The leaderboard shows only handle, league and rating, and only if you join.', { dim: true }) : null,
      top && top.length > 0 ? column(c, top.slice(0, 5).map((r, i) => line(c, `${i + 1}. ${safe(r.handle, 40)} · ${r.league} · ${r.rating}`, { dim: true })), SPACE.none) : null,
      heading(c, 'Sent lately', 'paths and bodies; the session token never shows'),
      sent(c),
      heading(c, 'Your data'),
      actions(c, [
        signedIn(c) ? btn(c, { key: 'reset-access', label: 'Reset access', hotkey: 'k', on: () => c.actions.hold('reset-access', 'me') }) : null,
        signedIn(c) ? btn(c, { key: 'delete-account', label: 'Delete online account', hotkey: 'x', on: () => c.actions.hold('delete-account', 'me') }) : null,
        btn(c, { key: 'delete-offline', label: 'Delete offline save', hotkey: 'z', on: () => c.actions.hold('delete-offline', 'offline') }),
      ]),
      holdLine(c, 'reset-access', 'me', 'k'),
      holdLine(c, 'delete-account', 'me', 'x'),
      holdLine(c, 'delete-offline', 'offline', 'z'),
      line(c, 'Deleting takes everything with it: cards, packs, offers, gifts, notices. Traded-away cards stay with their owners.', { dim: true }),
    ]),
    hints: [offer ? '1 Passkey' : '', reroll === '' ? '2 New handle' : '', board ? '3 Leaderboard' : '', signedIn(c) ? 'k Reset access · x Delete' : '', 'z Delete offline save', 'esc Back'],
  }
}

export function devicesScreen(c: Ctx): Shown {
  const a = c.state.account
  if (a.world !== 'online') {
    return {
      body: column(c, [
        line(c, 'Devices', { dim: true }),
        para(c, 'Devices and passkeys belong to the online world. Offline, your collection lives on this machine only.', { dim: true }),
        actions(c, [btn(c, { key: 'join-online', label: 'Join online (fresh collection)', hotkey: '1', primary: true, on: () => c.actions.world('online') })]),
      ]),
      hints: ['1 Join online', 'esc Stay offline'],
    }
  }
  if (!c.state.me && (a.link === 'joining' || a.link === 'starting')) {
    return { body: column(c, [line(c, 'Devices', { dim: true }), line(c, 'Getting your collection…', { dim: true })]), hints: ['esc Back'] }
  }
  if (!c.state.me || a.link === 'signed-out') {
    // a machine the server does not know: signing in with a passkey saved elsewhere is the one thing to do here
    const passkeys = hasFeature(a, 'passkey')
    return {
      body: column(c, [
        line(c, 'Devices', { dim: true }),
        para(c, passkeys ? 'This computer is not signed in.' : `${a.host} has no passkeys, so this computer cannot sign in to another account.`),
        passkeys ? actions(c, [btn(c, { key: 'passkey-signin', label: 'Sign in with a saved passkey', hotkey: '1', primary: true, on: () => c.actions.passkey('signin') })]) : null,
        passkeys ? para(c, 'Use a passkey you saved on another computer.', { dim: true }) : null,
        signIn(c),
      ]),
      hints: [passkeys ? '1 Sign in' : '', 'esc Back'],
    }
  }
  const d = a.devices
  const loading = c.state.social.loading.includes('devices')
  const offer = passkeyOffer(c, '1')
  const count = d ? dots(`Signed in on ${d.sessions} ${d.sessions === 1 ? 'device' : 'devices'}`, d.passkeys > 0 ? 'passkey saved ✓' : 'no passkey yet') : loading ? 'Counting devices…' : 'Devices not counted yet'
  return {
    body: column(c, [
      line(c, 'Devices', { dim: true }),
      line(c, count),
      offer,
      hasFeature(a, 'passkey') ? actions(c, [btn(c, { key: 'passkey-signin', label: 'Sign in with a saved passkey', hotkey: '2', on: () => c.actions.passkey('signin') })]) : null,
      hasFeature(a, 'passkey') ? line(c, 'This computer then plays as that account. Its current account stays on the server.', { dim: true }) : null,
      signIn(c),
      signedIn(c) ? actions(c, [btn(c, { key: 'reset-access', label: 'Reset access', hotkey: 'k', on: () => c.actions.hold('reset-access', 'me') })]) : null,
      holdLine(c, 'reset-access', 'me', 'k'),
      signedIn(c) ? line(c, 'Reset access signs out every other machine. Passkeys stay, so they can sign back in.', { dim: true }) : null,
    ]),
    hints: [offer ? '1 Passkey' : '', hasFeature(a, 'passkey') ? '2 Sign in' : '', signedIn(c) ? 'k Reset access' : '', 'esc Back'],
  }
}

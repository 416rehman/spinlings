// Privacy and devices (SPEC 12, 20, 26, 27, 29, 30, 33): what Spinlings reads and sends, where the game lives, the
// anonymous handle, showing or hiding yourself on the boards, the passkey offer and its steps, reset access, and
// deleting everything (each behind a 2-second hold). The token never shows; sign-in links show only on the server's
// own origin.
import type { RenderElement } from 'claude-code'
import { isOnServer } from '../core/servers.ts'
import { hasFeature } from '../client/game.ts'
import { linkHref } from '../client/net.ts'
import { dots, safe, span } from '../client/text.ts'
import { rarityRank } from '../core/cards.ts'
import { HOOKS, rerollWhen } from '../client/viewmodels.ts'
import type { Ctx, Shown } from './pane-kit.tsx'
import { CHIP, actions, btn, chip, column, heading, holdLine, line, para, worldBadge } from './pane-kit.tsx'
import { INK, MARK, SPACE } from './tokens.ts'

const GUARANTEE = 'Spinlings reads only the shape of a session: the model\'s family, whether Claude is working, '
  + 'how many helpers run, when a usage limit is full, and effort for local appearance. Never your prompts, Claude\'s answers, files, commands, paths or cost.'

function sent(c: Ctx): RenderElement {
  const log = c.state.privacy.slice(-20).reverse()
  if (log.length === 0) return line(c, c.state.account.world === 'offline' ? 'Nothing: the offline world never sends a request.' : 'Nothing sent yet.', { dim: true })
  return column(c, log.map(s => line(c, dots(`${s.method} ${safe(s.path, 60)}`, s.body && s.body !== '{}' ? safe(s.body, 200) : ''), { dim: true })), SPACE.none)
}

/** Signed in on this server right now: what saving a passkey and resetting access need. */
const signedIn = (c: Ctx) => c.state.account.world === 'online' && !!c.state.me && c.state.account.link === 'ready'

/**
 * The passkey offer (SPEC 30.2): what is at stake as a picture (the best card, and how many live only on this
 * computer), no email, no password, and one press to start.
 */
function passkeyOffer(c: Ctx, hotkey: string): RenderElement | null {
  const a = c.state.account
  if (!signedIn(c) || !hasFeature(a, 'passkey') || (a.devices?.passkeys ?? 0) > 0 || a.backedUp === true || a.signIn?.kind === 'add') return null
  const best = [...c.state.cards].sort((x, y) => rarityRank(y.rarity) - rarityRank(x.rarity) || Number(!!y.foil) - Number(!!x.foil) || Number(y.shiny) - Number(x.shiny))[0]
  const { Box } = c.el
  // Leave room for the passkey action; stack the card when its words would be cramped.
  const beside = !best || c.columns >= CHIP + SPACE.loose + 22
  const ic: Ctx = { ...c, columns: beside ? c.columns - (best ? CHIP + SPACE.loose : 0) : c.columns }
  return (
    <Box flexDirection={beside ? 'row' : 'column'} columnGap={SPACE.loose} rowGap={SPACE.tight} width={c.columns}>
      {best ? <Box flexShrink={0}>{chip(c, best, { key: 'passkey-best' })}</Box> : null}
      {column(ic, [
        line(ic, `${c.state.cards.length} cards live only on this computer`, { color: INK.warn }),
        para(ic, 'A passkey keeps them safe and brings them to another computer. No email, no password.', { dim: true }),
        actions(ic, [
          btn(c, { key: 'passkey-add', label: 'Save with a passkey', hotkey, primary: hotkey === '1', on: () => c.actions.passkey('add') }),
        ]),
      ], SPACE.none)}
    </Box>
  )
}

/** The steps of a passkey page, as a row each: done ones ticked, the one under way bright, the rest dim. */
function steps(c: Ctx, list: readonly string[], at: number): RenderElement {
  const { Text } = c.el
  return column(c, list.map((s, i) => {
    const done = i < at
    const now = i === at
    return (
      <Text wrap="wrap">
        <Text color={done ? INK.good : now ? INK.accent : INK.muted}>{done ? `${MARK.win} ` : `${i + 1} `}</Text>
        <Text {...(now ? { bold: true } : done ? {} : { dimColor: true })}>{s}</Text>
      </Text>
    )
  }), SPACE.none)
}

/**
 * The passkey page in flight, step by step (SPEC 29, 30): the link first and prominent (on the server's own origin
 * only), its whole address to copy where a terminal cannot open links, then the steps and how they stand.
 */
function signIn(c: Ctx): RenderElement | null {
  const s = c.state.account.signIn
  if (!s) return null
  const { Link } = c.el
  // only on the server's own origin, and only as the URL parser spells it (anything else and the engine refuses the pane)
  const href = isOnServer(s.url, c.state.account.server) ? linkHref(s.url) : null
  const ok = href !== null
  const add = s.kind === 'add'
  const list = add
    ? ['Open the passkey page', 'Save the passkey your browser offers', 'Saved: your collection is backed up']
    : ['Open the sign-in page', 'Pick your saved passkey', 'Signed in: this computer plays that account']
  const at = s.status === 'pending' ? 1 : s.status === 'expired' ? 0 : 3
  return column(c, [
    s.status === 'pending' && href ? <Link href={href}>{add ? `${MARK.sparkle} Open the passkey page` : `${MARK.sparkle} Open the sign-in page`}</Link> : null,
    // the whole address, wrapped: a terminal that cannot open links still lets it be copied (SPEC 29)
    s.status === 'pending' && href ? para(c, safe(href, 400), { dim: true }) : null,
    s.status === 'pending' && !ok ? line(c, 'That page is not on this server, so it is not shown.', { color: INK.warn }) : null,
    steps(c, list, at),
    s.status === 'pending' ? line(c, `The page works for ${span(Math.max(0, s.until - c.now))} more`, { dim: true }) : null,
    s.status === 'expired' ? line(c, 'The page expired. Start again for a fresh one.', { color: INK.warn }) : null,
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
      p && online ? para(c, `You are ${safe(p.handle, 40)}${board ? (p.leaderboard ? ' · on the boards' : ' · hidden from the boards') : ''}`) : null,
      offer,
      online && p && a.features.includes('browser-account') ? <c.el.Link href={`${a.server}/account`}>Manage account</c.el.Link> : null,
      actions(c, [
        reroll === '' ? btn(c, { key: 'reroll', label: 'Draw a new handle', hotkey: '2', on: () => c.actions.rerollHandle() }) : null,
        board ? btn(c, { key: 'leaderboard', label: c.columns < 26 ? (p!.leaderboard ? 'Hide my stats' : 'Show my stats') : (p!.leaderboard ? 'Hide me from the boards' : 'Show me on the boards'), hotkey: '3', on: () => c.actions.leaderboard(!p!.leaderboard) }) : null,
      ]),
      reroll ? line(c, `A new handle can be drawn ${reroll} (once a week).`, { dim: true }) : null,
      board ? para(c, 'Every player is on the boards: handle, league and game numbers as they stood at the last midnight. Hidden, your stats leave your profile too.', { dim: true }) : null,
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
      para(c, 'Deleting takes everything with it: cards, packs, offers, gifts, listings, stats, notices. Traded-away and sold cards stay with their owners.', { dim: true }),
    ]),
    hints: [offer ? '1 Passkey' : '', reroll === '' ? '2 New handle' : '', board ? '3 Boards' : '', signedIn(c) ? 'k Reset access · x Delete' : '', 'z Delete offline save', 'esc Back'],
  }
}

export function devicesScreen(c: Ctx): Shown {
  const a = c.state.account
  if (a.world !== 'online') {
    return {
      body: column(c, [
        line(c, 'Devices', { dim: true }),
        para(c, 'Devices and passkeys belong to the online world. Offline, your collection lives on this machine only.', { dim: true }),
        actions(c, [btn(c, { key: 'join-online', label: c.columns < 33 ? 'Join online' : 'Join online (fresh collection)', hotkey: '1', primary: true, on: () => c.actions.world('online') })]),
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
        passkeys ? actions(c, [btn(c, { key: 'passkey-signin', label: c.columns < 31 ? 'Use a saved passkey' : 'Sign in with a saved passkey', hotkey: '1', primary: true, on: () => c.actions.passkey('signin') })]) : null,
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
      hasFeature(a, 'passkey') ? actions(c, [btn(c, { key: 'passkey-signin', label: c.columns < 31 ? 'Use a saved passkey' : 'Sign in with a saved passkey', hotkey: '2', on: () => c.actions.passkey('signin') })]) : null,
      hasFeature(a, 'passkey') ? line(c, 'This computer then plays as that account. Its current account stays on the server.', { dim: true }) : null,
      signIn(c),
      signedIn(c) ? actions(c, [btn(c, { key: 'reset-access', label: 'Reset access', hotkey: 'k', on: () => c.actions.hold('reset-access', 'me') })]) : null,
      holdLine(c, 'reset-access', 'me', 'k'),
      signedIn(c) ? line(c, 'Reset access signs out every other machine and removes saved passkeys. Save a passkey again after.', { dim: true }) : null,
    ]),
    hints: [offer ? '1 Passkey' : '', hasFeature(a, 'passkey') ? '2 Sign in' : '', signedIn(c) ? 'k Reset access' : '', 'esc Back'],
  }
}

// Accounts without accounts (SPEC 27, 29, 30): joining with a generated handle, one session per
// device, reset access, the sign-in polls behind both passkey flows, handle rerolls and total
// deletion (SPEC 20.7). Nothing here knows who anyone is.
import type { AuthStartResponse, JoinRequest } from '../../../plugin/hooks/core/api.ts'
import { starterTeam } from '../../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../../plugin/hooks/core/economy.ts'
import { FAMILIES } from '../../../plugin/hooks/core/families.ts'
import { isBlocked } from '../../../plugin/hooks/core/naming.ts'
import { otherFamily } from '../../../plugin/hooks/core/packs.ts'
import { pick, shuffle } from '../../../plugin/hooks/core/rng.ts'
import { HANDLE_RE } from '../../../plugin/hooks/core/schemas.ts'
import { sha256Hex } from '../../../plugin/hooks/core/sha256.ts'
import { seasonOf, utcDay } from '../../../plugin/hooks/core/world.ts'
import type { Ctx, PlayerCtx } from '../app.ts'
import { newSession, prepareJoin, sessionStmt } from '../auth.ts'
import { guard, stmt } from '../db.ts'
import type { Db, Stmt } from '../db.ts'
import { fail } from '../http.ts'
import { spendJoinCounter } from '../ratelimit.ts'
import type { AuthPollRow, PlayerRow } from '../schema.ts'
import { RIVAL } from './battles.ts'
import { addDays, dayStart, ensureSeason, loadPlayer, newId, notFound, pickWord, randomInt, rngOf, setPlayer } from './ctx.ts'
import type { Env } from './ctx.ts'
import { grantPack, mintCards } from './mint.ts'
import { NOTICE_TEXT, notice } from './notices.ts'
import { b64urlEncode, ES256, RS256 } from './passkeys.ts'
import { ADJECTIVES, CREATURES } from './words.ts'

// ---- handles -----------------------------------------------------------------------------------

/** Handles of deleted accounts and old rerolled handles stay taken this long (SPEC 20.7). */
export const HANDLE_HOLD_DAYS = 30

/**
 * A free adjective-creature-NN handle, unrelated to anything about the player (SPEC 20.1). Taken
 * means held by a player or retired. A lost race on the unique index is a Conflict: the handler
 * re-runs and draws again.
 */
export async function newHandle(env: Env): Promise<string> {
  for (let round = 0; round < 8; round++) {
    const candidates = [...new Set(Array.from({ length: 8 }, () => {
      const n = round < 4 ? 10 + randomInt(env, 90) : 1000 + randomInt(env, 9000)
      return `${pickWord(env, ADJECTIVES)}-${pickWord(env, CREATURES)}-${n}`
    }))].filter(h => HANDLE_RE.test(h) && !isBlocked(h))
    if (!candidates.length) continue
    const marks = candidates.map(() => '?').join(', ')
    const taken = new Set((await env.db.all<{ handle: string }>(
      `SELECT handle FROM players WHERE handle IN (${marks}) UNION SELECT handle FROM retired_handles WHERE handle IN (${marks})`,
      ...candidates, ...candidates,
    )).map(r => r.handle))
    const free = candidates.find(h => !taken.has(h))
    if (free) return free
  }
  throw new Error('no free handle')
}

/** Keeps a handle out of circulation for 30 days. */
export const retireHandle = (handle: string, now: number): Stmt => stmt(
  'INSERT INTO retired_handles (handle, until) VALUES (?, ?) ON CONFLICT (handle) DO UPDATE SET until = excluded.until',
  handle, addDays(utcDay(now), HANDLE_HOLD_DAYS),
)

// ---- joining (SPEC 6 First run, 30.1, 34) ------------------------------------------------------

/**
 * POST /v1/join: checks the proof of work and the join limits, then in one batch creates the player
 * (100 sparks, rating 1000), its first session, the bound starter team (saved as the team) and two
 * welcome packs (the joining family and one other), whose cards open trade-locked for 7 days. The
 * starters come from a family the server picks, in a shuffled order: the team is public, and the
 * joining family is the model in use (SPEC 20.2). The first wild battle is allowed at once; the
 * first pack charge 45 minutes on, as for any charge.
 */
export async function joinPlayer(ctx: Ctx, req: JoinRequest): Promise<{ token: string; playerId: string }> {
  const ticket = await prepareJoin(ctx.db, {
    challenge: req.challenge, nonce: req.nonce, now: ctx.now, randomBytes: ctx.randomBytes, addressKey: ctx.addressKey,
  })
  const id = newId(ctx)
  const handle = await newHandle(ctx)
  const day = utcDay(ctx.now)
  const season = seasonOf(ctx.now)
  await ensureSeason(ctx.db, season)
  const rng = rngOf(ctx)
  const starters = await mintCards(ctx, id, shuffle(rng, starterTeam(pick(rng, FAMILIES), rng, ctx.now)), { bound: true })
  const lockUntil = ctx.now + ECONOMY.welcomeLockMs
  const packs = [req.family, otherFamily(req.family, rng)].map(f => grantPack(ctx, id, f, 'welcome', { lockUntil }))
  const team = starters.cards.map(c => c.id)
  await ctx.db.batch([
    ...ticket.stmts,
    stmt(
      `INSERT INTO players (id, handle, joined, last_seen, season, sparks, rating, team, team_size, hello_day, last_charge_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, handle, day, day, season, ECONOMY.sparks.start, ECONOMY.rating.start, JSON.stringify(team), team.length, day, ctx.now,
    ),
    sessionStmt({ randomBytes: ctx.randomBytes, playerId: id, tokenHash: ticket.tokenHash, now: ctx.now }),
    ...starters.stmts,
    ...packs.map(p => p.stmt),
  ])
  return { token: ticket.token, playerId: id }
}

// ---- sessions (SPEC 26.6, 27) ------------------------------------------------------------------

/**
 * POST /v1/me/token: every way into the account goes, atomically, and the caller gets one new
 * session. That is every session, every saved passkey and every passkey flow still open: whoever
 * held a leaked token could have saved a passkey of their own with it, and a session is the only
 * thing that tells them apart from the owner. The owner saves a new passkey afterwards.
 */
export async function resetSessions(ctx: PlayerCtx): Promise<string> {
  const id = ctx.player.id
  const session = newSession({ randomBytes: ctx.randomBytes, playerId: id, now: ctx.now })
  await ctx.db.batch([
    // two devices resetting at once: one wins, the other's session is gone and it signs in again
    guard('SELECT 1 FROM sessions WHERE id = ?', ctx.sessionId),
    stmt('DELETE FROM sessions WHERE player_id = ?', id),
    stmt('DELETE FROM passkeys WHERE player_id = ?', id),
    stmt('DELETE FROM auth_polls WHERE player_id = ?', id),
    session.stmt,
  ])
  return session.token
}

export async function devicesOf(db: Db, playerId: string): Promise<{ sessions: number; passkeys: number }> {
  const row = await db.get<{ sessions: number; passkeys: number }>(
    `SELECT (SELECT COUNT(*) FROM sessions WHERE player_id = ?) AS sessions, (SELECT COUNT(*) FROM passkeys WHERE player_id = ?) AS passkeys`,
    playerId, playerId,
  )
  return { sessions: row!.sessions, passkeys: row!.passkeys }
}

// ---- sign-in polls (SPEC 29) -------------------------------------------------------------------

export type PollKind = AuthPollRow['kind']
export const POLL_TTL = ECONOMY.server.pollTtlMs

const PAGE: Record<PollKind, string> = { add: '/passkey/add', signin: '/passkey/signin' }

/**
 * Starts a passkey flow: a poll for the mod and a ticket for the page, both 128 random bits, kept
 * only as hashes, alive 10 minutes. The page URL carries the ticket, never the pollId, so a link
 * left in a browser's history cannot collect a session. `add` replaces the player's earlier one.
 */
export async function startPoll(ctx: Ctx, kind: PollKind, player?: PlayerRow): Promise<AuthStartResponse> {
  if (kind === 'add' && !player) throw new Error('adding a passkey needs the player')
  const pollId = newId(ctx)
  const ticket = newId(ctx)
  const challenge = b64urlEncode(ctx.randomBytes(32))
  const stmts: Stmt[] = []
  let userId: string | null = null
  if (kind === 'add') {
    // one user.id per account, so a second passkey on the same authenticator replaces the first
    userId = (await ctx.db.get<{ user_id: string }>('SELECT user_id FROM passkeys WHERE player_id = ? LIMIT 1', player!.id))?.user_id
      ?? b64urlEncode(ctx.randomBytes(16))
    stmts.push(stmt(`DELETE FROM auth_polls WHERE player_id = ? AND kind = 'add'`, player!.id))
  } else {
    stmts.push(...await spendJoinCounter(ctx.db, 'auth', ctx.addressKey, ctx.now))
  }
  stmts.push(stmt(
    'INSERT INTO auth_polls (id, ticket_hash, kind, player_id, user_id, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    sha256Hex(pollId), sha256Hex(ticket), kind, player?.id ?? null, userId, challenge, ctx.now + POLL_TTL,
  ))
  await ctx.db.batch(stmts)
  return { url: `${ctx.origin}${PAGE[kind]}?t=${ticket}`, pollId }
}

const TICKET = /^[a-z2-7]{26}$/

/** The live poll behind a page ticket, or null when the ticket is unknown, used, expired or of the other kind. */
export async function pollByTicket(db: Db, ticket: string, kind: PollKind, now: number): Promise<AuthPollRow | null> {
  if (!TICKET.test(ticket)) return null
  const row = await db.get<AuthPollRow>('SELECT * FROM auth_polls WHERE ticket_hash = ?', sha256Hex(ticket))
  return row && row.kind === kind && row.state === 'pending' && row.expires_at > now ? row : null
}

/** Aborts the batch unless the poll is still in `state` at `version` and alive. */
export const pollGuard = (row: AuthPollRow, state: AuthPollRow['state'], now: number): Stmt =>
  guard('SELECT 1 FROM auth_polls WHERE id = ? AND state = ? AND version = ? AND expires_at > ?', row.id, state, row.version, now)

export type Collected = { status: 'pending' } | { status: 'added' } | { status: 'done'; token: string; playerId: string }

/**
 * GET /v1/auth/poll/:pollId. A saved passkey is reported once; a finished sign-in makes its session
 * here, delivered exactly once (the poll row goes in the same batch), and tells the account a new
 * device signed in.
 */
export async function collectPoll(ctx: Ctx, pollId: string): Promise<Collected> {
  const row = await ctx.db.get<AuthPollRow>('SELECT * FROM auth_polls WHERE id = ?', sha256Hex(pollId)) ?? notFound('sign-in')
  if (row.expires_at <= ctx.now) fail('expired', 'This sign-in has expired')
  if (row.state === 'pending') return { status: 'pending' }
  const done = stmt('DELETE FROM auth_polls WHERE id = ?', row.id)
  if (row.state === 'added') {
    await ctx.db.batch([pollGuard(row, 'added', ctx.now), done])
    return { status: 'added' }
  }
  const playerId = row.player_id!
  if (!(await loadPlayer(ctx.db, playerId))) {
    await ctx.db.batch([done])
    notFound('account')
  }
  const session = newSession({ randomBytes: ctx.randomBytes, playerId, now: ctx.now })
  await ctx.db.batch([
    pollGuard(row, 'done', ctx.now),
    guard('SELECT 1 FROM players WHERE id = ?', playerId),
    done,
    session.stmt,
    notice(ctx, playerId, 'new-device', NOTICE_TEXT.newDevice()),
  ])
  return { status: 'done', token: session.token, playerId }
}

// ---- the passkey pages' data (for the site's /passkey/add and /passkey/signin) -----------------

export type PasskeyPage =
  | {
    kind: 'add'
    /** PublicKeyCredentialCreationOptions with every binary field as base64url */
    options: {
      rp: { id: string; name: string }
      user: { id: string; name: string; displayName: string }
      challenge: string
      pubKeyCredParams: { type: 'public-key'; alg: number }[]
      timeout: number
      authenticatorSelection: { residentKey: 'required'; requireResidentKey: true; userVerification: 'preferred' }
      attestation: 'none'
      excludeCredentials: { type: 'public-key'; id: string }[]
    }
  }
  | {
    kind: 'signin'
    /** PublicKeyCredentialRequestOptions with every binary field as base64url */
    options: { rpId: string; challenge: string; timeout: number; userVerification: 'preferred'; allowCredentials: [] }
  }

/**
 * What a passkey page needs for its ticket, or null when the ticket is unknown, used or expired (show
 * "This link has expired"). Nothing in it names the player: user.name is just "Spinlings".
 */
export async function passkeyPage(db: Db, o: { kind: PollKind; ticket: string; now: number; rpId: string }): Promise<PasskeyPage | null> {
  const row = await pollByTicket(db, o.ticket, o.kind, o.now)
  if (!row) return null
  const timeout = row.expires_at - o.now
  if (o.kind === 'signin') {
    return { kind: 'signin', options: { rpId: o.rpId, challenge: row.challenge, timeout, userVerification: 'preferred', allowCredentials: [] } }
  }
  const existing = await db.all<{ credential_id: string }>('SELECT credential_id FROM passkeys WHERE player_id = ?', row.player_id)
  return {
    kind: 'add',
    options: {
      rp: { id: o.rpId, name: 'Spinlings' },
      user: { id: row.user_id!, name: 'Spinlings', displayName: 'Spinlings' },
      challenge: row.challenge,
      pubKeyCredParams: [{ type: 'public-key', alg: ES256 }, { type: 'public-key', alg: RS256 }],
      timeout,
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
      attestation: 'none',
      excludeCredentials: existing.map(r => ({ type: 'public-key' as const, id: r.credential_id })),
    },
  }
}

// ---- deletion (SPEC 12, 20.7, 27) --------------------------------------------------------------

/**
 * DELETE /v1/me, as statements for one batch behind the player's version guard: the player and
 * everything that is theirs (sessions, passkeys, cards, packs, battles, offers, gifts, notices,
 * wishlist, album, Fusion Log, Trader uses, redemptions). First-discovery rows and Mythic finds stay
 * without a player, so nobody else becomes first. Cards already traded away stay with their owners;
 * cards other players had held for an offer to this player go back to them, with a notice. The
 * handle stays taken for 30 days.
 */
export function deletionStmts(p: PlayerRow, now: number): Stmt[] {
  const id = p.id
  const day = utcDay(now)
  const incoming = `SELECT id FROM offers WHERE to_id = ? AND state = 'open'`
  return [
    stmt(`UPDATE cards SET state = 'owned', escrow_ref = NULL, version = version + 1 WHERE state = 'escrow' AND escrow_ref IN (${incoming})`, id),
    stmt(`UPDATE players SET cards_version = cards_version + 1 WHERE id IN (SELECT from_id FROM offers WHERE to_id = ? AND state = 'open')`, id),
    stmt(
      `INSERT INTO notices (id, player_id, day, kind, text)
       SELECT lower(hex(randomblob(16))), from_id, ?, 'offer-declined', ? FROM offers WHERE to_id = ? AND state = 'open'`,
      day, 'Your offer came back: they left the meadow, so your cards are home again', id,
    ),
    stmt('DELETE FROM offers WHERE from_id = ? OR to_id = ?', id, id),
    stmt('DELETE FROM gifts WHERE giver_id = ?', id),
    stmt('UPDATE gifts SET claimed_by = NULL, bonus = 0 WHERE claimed_by = ?', id),
    stmt('DELETE FROM battles WHERE attacker_id = ?', id),
    stmt('UPDATE battles SET defender_id = NULL WHERE defender_id = ?', id),
    stmt('DELETE FROM cards WHERE owner_id = ?', id),
    stmt('DELETE FROM packs WHERE owner_id = ?', id),
    stmt('DELETE FROM notices WHERE player_id = ?', id),
    stmt('UPDATE notices SET other_id = NULL, revenge_until = NULL WHERE other_id = ?', id),
    // other players' last opponents keep the slot (the matchmaking window stays the same) but not the id
    stmt(
      `UPDATE players SET recent_opponents = replace(recent_opponents, ?, ?), version = version + 1 WHERE instr(recent_opponents, ?) > 0`,
      JSON.stringify(id), JSON.stringify(RIVAL), JSON.stringify(id),
    ),
    stmt('DELETE FROM wishes WHERE player_id = ?', id),
    stmt('DELETE FROM album WHERE player_id = ?', id),
    stmt('DELETE FROM fusions WHERE player_id = ?', id),
    stmt('UPDATE firsts SET player_id = NULL WHERE player_id = ?', id),
    // a Mythic that changed hands stays with its owner, no longer stamped with who found it
    ...forgetFinder(id),
    stmt('UPDATE mythics SET finder_id = NULL WHERE finder_id = ?', id),
    stmt('DELETE FROM trader_uses WHERE player_id = ?', id),
    stmt('DELETE FROM redemptions WHERE player_id = ?', id),
    stmt('DELETE FROM auth_polls WHERE player_id = ?', id),
    stmt('DELETE FROM passkeys WHERE player_id = ?', id),
    stmt('DELETE FROM sessions WHERE player_id = ?', id),
    retireHandle(p.handle, now),
    stmt('DELETE FROM players WHERE id = ?', id),
  ]
}

/**
 * The Mythics this player found stop naming them, on the public list and on each card wherever it
 * lives now, so an old handle never sits beside a new one. Cards hold no finder (the loaders name
 * one while `mythics.handle` is still theirs), so each owner's collection version moves for the
 * stamp to go, and rows minted before that rule lose the name they still carry.
 */
function forgetFinder(id: string): Stmt[] {
  const found = 'id IN (SELECT card_id FROM mythics WHERE finder_id = ?)'
  return [
    stmt(`UPDATE players SET cards_version = cards_version + 1 WHERE id IN (SELECT owner_id FROM cards WHERE ${found})`, id),
    stmt(`UPDATE cards SET form = json_remove(form, '$.discoveredBy'), version = version + 1 WHERE ${found} AND json_extract(form, '$.discoveredBy') IS NOT NULL`, id),
    stmt('UPDATE mythics SET handle = NULL WHERE finder_id = ?', id),
  ]
}

// ---- handle rerolls (SPEC 20.1) ----------------------------------------------------------------

/** How long until the player may reroll again, in ms (0 = now). */
export const rerollWait = (from: string, now: number): number => Math.max(0, dayStart(from) - now)

/**
 * A new handle, for the caller's commit: the old one retired for 30 days, and nothing left that
 * would show the two side by side. Other players' notices about this player lose the handle (an
 * open revenge closes with it) and found Mythics lose the finder's name. Open offers keep the
 * handles they were sent with.
 */
export function rerollStmts(p: Pick<PlayerRow, 'id' | 'handle'>, handle: string, now: number): Stmt[] {
  return [
    retireHandle(p.handle, now),
    setPlayer(p.id, { handle, handle_day: utcDay(now) }),
    stmt('UPDATE notices SET other_id = NULL, revenge_until = NULL WHERE other_id = ?', p.id),
    ...forgetFinder(p.id),
  ]
}


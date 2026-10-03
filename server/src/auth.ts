// Sessions and the join proof of work. A session's bearer token is 32 random bytes (hex), stored
// only as its SHA-256 in sessions (SPEC 27, 29), one row per device. Challenges are D1 rows, single
// use, gone after 5 minutes, and spent with a guarded delete in the join's own batch.
import type { ChallengeResponse } from '../../plugin/hooks/core/api.ts'
import { sha256, sha256Hex, toHex } from '../../plugin/hooks/core/sha256.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import { guard, stmt } from './db.ts'
import type { Db, Stmt } from './db.ts'
import { fail } from './http.ts'
import { spendJoinCounter } from './ratelimit.ts'
import type { PlayerRow } from './schema.ts'

export type RandomBytes = (n: number) => Uint8Array

export const DEFAULT_DIFFICULTY = 18
export const CHALLENGE_TTL = 5 * 60_000

const TOKEN = /^[0-9a-f]{64}$/
const BEARER = /^Bearer ([0-9a-f]{64})$/
const CHALLENGE = /^[0-9a-f]{32}$/
const NONCE = /^[0-9A-Za-z_-]{1,64}$/

export const newToken = (randomBytes: RandomBytes) => toHex(randomBytes(32))

export function hashToken(token: string): string {
  if (!TOKEN.test(token)) throw new TypeError('not a token')
  return sha256Hex(token)
}

/** The bearer token from the Authorization header, or null when it is missing or malformed. */
export function bearerToken(req: Request): string | null {
  return BEARER.exec(req.headers.get('authorization') ?? '')?.[1] ?? null
}

export type SessionPlayer = { player: PlayerRow; session: { id: string; lastUsedDay: string } }

/** The player behind a session's token hash, with the session; undefined when unknown or revoked. */
export async function findSession(db: Db, tokenHash: string): Promise<SessionPlayer | undefined> {
  const row = await db.get<PlayerRow & { session_id: string; session_day: string }>(
    `SELECT p.*, s.id AS session_id, s.last_used_day AS session_day
     FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?`,
    tokenHash,
  )
  if (!row) return undefined
  const { session_id, session_day, ...player } = row
  return { player, session: { id: session_id, lastUsedDay: session_day } }
}

export type NewSession = { token: string; tokenHash: string; stmt: Stmt }

/**
 * A fresh session: the token to hand back exactly once, and the insert to commit in the same batch
 * as whatever earned it (join, reset access, a passkey sign-in).
 */
export function newSession(o: { randomBytes: RandomBytes; playerId: string; now: number }): NewSession {
  const token = newToken(o.randomBytes)
  const tokenHash = hashToken(token)
  return { token, tokenHash, stmt: sessionStmt({ ...o, tokenHash }) }
}

/** The insert behind newSession, for a token made elsewhere (prepareJoin). */
export function sessionStmt(o: { randomBytes: RandomBytes; playerId: string; tokenHash: string; now: number }): Stmt {
  const day = utcDay(o.now)
  return stmt(
    'INSERT INTO sessions (id, player_id, token_hash, created_day, last_used_day) VALUES (?, ?, ?, ?, ?)',
    toHex(o.randomBytes(16)), o.playerId, o.tokenHash, day, day,
  )
}

/** Leading zero bits of sha256(challenge + ':' + nonce); `difficulty` bits means exactly that many. */
export function proofBits(challenge: string, nonce: string): number {
  let bits = 0
  for (const byte of sha256(`${challenge}:${nonce}`)) {
    if (byte) return bits + Math.clz32(byte) - 24
    bits += 8
  }
  return bits
}

/** Hands out a challenge, counted against the caller's address key (SPEC 15). */
export async function issueChallenge(
  db: Db,
  o: { now: number; randomBytes: RandomBytes; difficulty: number; addressKey: string },
): Promise<ChallengeResponse> {
  if (!Number.isInteger(o.difficulty) || o.difficulty < 1 || o.difficulty > 32) throw new RangeError('difficulty out of range')
  const counted = await spendJoinCounter(db, 'challenges', o.addressKey, o.now)
  const challenge = toHex(o.randomBytes(16))
  await db.batch([
    ...counted,
    stmt('DELETE FROM challenges WHERE expires_at <= ?', o.now),
    stmt('INSERT INTO challenges (id, difficulty, expires_at) VALUES (?, ?, ?)', challenge, o.difficulty, o.now + CHALLENGE_TTL),
  ])
  return { challenge, difficulty: o.difficulty }
}

/**
 * Checks a solved challenge at the difficulty it was issued with and returns the statements that
 * spend it: put them in the join's batch, so one challenge makes at most one account (a racing join
 * fails the guard). A wrong proof or an expired challenge is deleted on the spot and refused.
 */
export async function spendChallenge(db: Db, challenge: unknown, nonce: unknown, now: number): Promise<Stmt[]> {
  if (typeof challenge !== 'string' || !CHALLENGE.test(challenge)) fail('bad_request', 'Malformed challenge')
  if (typeof nonce !== 'string' || !NONCE.test(nonce)) fail('bad_request', 'Malformed nonce')
  const row = await db.get<{ difficulty: number; expires_at: number }>(
    'SELECT difficulty, expires_at FROM challenges WHERE id = ?', challenge,
  )
  if (!row) fail('expired', 'Challenge expired or already used')
  const burn = stmt('DELETE FROM challenges WHERE id = ?', challenge)
  if (row.expires_at <= now) {
    await db.batch([burn])
    fail('expired', 'Challenge expired or already used')
  }
  if (proofBits(challenge, nonce) < row.difficulty) {
    await db.batch([burn])
    fail('not_allowed', 'Proof of work does not check out')
  }
  return [guard('SELECT 1 FROM challenges WHERE id = ? AND expires_at > ?', challenge, now), burn]
}

export type JoinTicket = { token: string; tokenHash: string; stmts: Stmt[] }

/**
 * Everything POST /v1/join needs before it creates the player: the proof is checked and the join is
 * counted against the address key. Commit `stmts` in the same batch as the new player's rows.
 */
export async function prepareJoin(
  db: Db,
  o: { challenge: unknown; nonce: unknown; now: number; randomBytes: RandomBytes; addressKey: string },
): Promise<JoinTicket> {
  const proof = await spendChallenge(db, o.challenge, o.nonce, o.now)
  const counted = await spendJoinCounter(db, 'joins', o.addressKey, o.now)
  const token = newToken(o.randomBytes)
  return { token, tokenHash: hashToken(token), stmts: [...proof, ...counted] }
}

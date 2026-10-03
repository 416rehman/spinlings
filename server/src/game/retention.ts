// The hourly sweep the Worker's cron and the Node timer run (app.sweep): retention (SPEC 20.4, 27,
// 29), deleting what the server must not keep, bounded per run so a backlog clears over runs;
// forgetting accounts nobody can reach any more; and freezing seasons ahead of the players who need
// them (SPEC 32).
import { ECONOMY } from '../../../plugin/hooks/core/economy.ts'
import { seasonOf, utcDay } from '../../../plugin/hooks/core/world.ts'
import type { Api } from '../app.ts'
import { Conflict, stmt } from '../db.ts'
import type { Db } from '../db.ts'
import type { PlayerRow } from '../schema.ts'
import { deletionStmts } from './auth.ts'
import { DAY, ensureSeasons, HOUR, playerGuard } from './ctx.ts'

export const KEEP_DAYS = { notices: 30, resolvedOffers: 30, resolvedGifts: 30, settledBattles: 7, openBattles: 7 } as const
const SWEEP_BATCH = 500
/** Accounts deleted per run once nobody can reach them. */
const UNREACHABLE_BATCH = 50

const capped = (table: string, key: string, where: string) =>
  `DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE ${where} LIMIT ${SWEEP_BATCH})`

/**
 * Exact times on a player row outlive every rule that reads them after a day: wild and duel spacing
 * (minutes), the rested bonus (4 hours), the charge window (24 hours), claim tries (an hour). Then
 * they go back to 0, which those rules read as "long ago", so only day-granular dates stay (SPEC
 * 20.4). One scan, and SET reads the row as it was, so `charges` empties with its last charge.
 */
const STALE_MARKS = `last_wild_at BETWEEN 1 AND ?1 OR last_duel_at BETWEEN 1 AND ?1 OR last_charge_at BETWEEN 1 AND ?1
  OR charges != '[]' AND last_charge_at <= ?1 OR claim_hour BETWEEN 1 AND ?2`
const clearMarks = (now: number) => stmt(
  `UPDATE players SET
     last_wild_at = CASE WHEN last_wild_at <= ?1 THEN 0 ELSE last_wild_at END,
     last_duel_at = CASE WHEN last_duel_at <= ?1 THEN 0 ELSE last_duel_at END,
     last_charge_at = CASE WHEN last_charge_at <= ?1 THEN 0 ELSE last_charge_at END,
     charges = CASE WHEN last_charge_at <= ?1 THEN '[]' ELSE charges END,
     claim_hour = CASE WHEN claim_hour <= ?2 THEN 0 ELSE claim_hour END,
     claim_tries = CASE WHEN claim_hour <= ?2 THEN 0 ELSE claim_tries END,
     version = version + 1
   WHERE id IN (SELECT id FROM players WHERE ${STALE_MARKS} LIMIT ${4 * SWEEP_BATCH})`,
  now - DAY, Math.floor((now - DAY) / HOUR),
)

export async function sweepGame(db: Db, now: number): Promise<void> {
  const daysAgo = (n: number) => utcDay(now - n * DAY)
  await db.batch([
    stmt('DELETE FROM auth_polls WHERE expires_at <= ?', now),
    stmt(capped('sessions', 'id', 'last_used_day < ?'), daysAgo(ECONOMY.server.sessionIdleMs / DAY)),
    stmt('DELETE FROM trader_uses WHERE day < ?', utcDay(now)),
    stmt('DELETE FROM retired_handles WHERE until <= ?', utcDay(now)),
    stmt(capped('notices', 'id', 'day < ?'), daysAgo(KEEP_DAYS.notices)),
    stmt(capped('offers', 'id', `state != 'open' AND resolved < ?`), daysAgo(KEEP_DAYS.resolvedOffers)),
    stmt(capped('gifts', 'code', `state != 'open' AND resolved < ?`), daysAgo(KEEP_DAYS.resolvedGifts)),
    // the arena family lives no longer than its battle row (SPEC 20.2), settled or never finished
    stmt(capped('battles', 'id', `state = 'settled' AND settled < ?`), daysAgo(KEEP_DAYS.settledBattles)),
    stmt(capped('battles', 'id', `state = 'open' AND started_at < ?`), now - KEEP_DAYS.openBattles * DAY),
    // a finish's stored answer only serves a retry within minutes (finishedAgain), so not past its day
    stmt(`UPDATE battles SET outcome = NULL WHERE state = 'settled' AND settled < ? AND outcome IS NOT NULL`, utcDay(now)),
    clearMarks(now),
  ])
  await forgetUnreachable(db, now)
}

/**
 * An account nobody can reach any more, with no session left (they expire after 180 idle days) and
 * no passkey to sign in with, is deleted outright, exactly as DELETE /v1/me would, rather than kept
 * on public pages forever (SPEC 20.4, 29).
 */
async function forgetUnreachable(db: Db, now: number): Promise<void> {
  const gone = await db.all<PlayerRow>(
    `SELECT * FROM players p WHERE p.last_seen < ?
       AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.player_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM passkeys k WHERE k.player_id = p.id)
     LIMIT ?`,
    utcDay(now - ECONOMY.server.sessionIdleMs), UNREACHABLE_BATCH,
  )
  for (const p of gone) {
    await db.batch([playerGuard(p), ...deletionStmts(p, now)]).catch((err: unknown) => {
      if (!(err instanceof Conflict)) throw err // touched meanwhile: the next run looks again
    })
  }
}

/**
 * The cron also freezes the current season, and the next one in its last hour, so generating 36
 * species (a cold isolate's first names cost about half a second of CPU) never lands on a player.
 */
export async function freezeSeasons(db: Db, now: number): Promise<void> {
  await ensureSeasons(db, [seasonOf(now), seasonOf(now + HOUR)])
}

export function registerRetention(api: Api): void {
  api.onSweep(sweepGame)
  api.onSweep(freezeSeasons)
}

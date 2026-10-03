// Notices: the player's own news feed, composed from fixed templates. Each carries a day only, shown
// as "today" or "yesterday", never a time (SPEC 20.3), and is deleted 30 days on (retention.ts).
import type { Notice, NoticeKind } from '../../../plugin/hooks/core/api.ts'
import { cleanText } from '../../../plugin/hooks/core/schemas.ts'
import { utcDay } from '../../../plugin/hooks/core/world.ts'
import { stmt } from '../db.ts'
import type { Db, Stmt } from '../db.ts'
import { newId } from './ctx.ts'
import type { Env } from './ctx.ts'

/** Notices /v1/me shows, newest first. */
export const NOTICES_SHOWN = 30
/** Of those, sign-in and passkey warnings always shown first, however many other notices came after them. */
export const WARNINGS_SHOWN = 10

export type NoticeOptions = {
  /** the other player (defense, offers, gifts): shown by their current handle, and the revenge target */
  other?: string
  /**
   * the handle the player knows `other` by (an offer's): once `other` has rerolled, the notice names
   * nobody, so it never shows the new handle beside the old one (SPEC 20.1). Checked as the batch writes.
   */
  knownAs?: string
  /** defense-loss only: revenge is open until then (ms), and cleared once used */
  revengeUntil?: number
}

/** A notice for `playerId`. `text` comes from a fixed template; it is cleaned and cut to 200 anyway. */
export function notice(env: Pick<Env, 'now' | 'randomBytes'>, playerId: string, kind: NoticeKind, text: string, o: NoticeOptions = {}): Stmt {
  const known = o.knownAs !== undefined
  return stmt(
    `INSERT INTO notices (id, player_id, day, kind, text, other_id, revenge_until)
     VALUES (?, ?, ?, ?, ?, ${known ? '(SELECT id FROM players WHERE id = ? AND handle = ?)' : '?'}, ?)`,
    newId(env), playerId, utcDay(env.now), kind, cleanText(text, 200), o.other ?? null, ...(known ? [o.knownAs!] : []), o.revengeUntil ?? null,
  )
}

/** The fixed lines this module's own events use. */
export const NOTICE_TEXT = {
  newDevice: () => 'A new device signed in · Reset access if this was not you',
  passkeySaved: () => 'A passkey was saved for your collection · Reset access if this was not you',
  /** the 0003 migration's notice to every player then, word for word */
  boardsOpen: () => 'Leaderboards now show every player, with stats on profiles. To stay off them: /spin leaderboard off',
  /** a new player's first notice: a mod from before the boards opened still says they are opt-in */
  onBoards: () => 'You are on the leaderboards, with stats on your profile. To stay off them: /spin leaderboard off',
  seasonEnd: (season: number, league: string, packs: number, legendary: boolean) =>
    `Season ${season} ended in ${league}: ${packs} reward pack${packs === 1 ? '' : 's'}${legendary ? ' and a foil legendary' : ''}!`,
}

/**
 * The player's latest notices, with the other player's current handle: the latest sign-in and passkey warnings
 * (`new-device`, kept 30 days like any notice) first, then the rest newest first, `limit` in all. So no stream of
 * other notices, such as defenses another player can cause, ever pushes a warning out of sight.
 */
export async function noticesOf(db: Db, playerId: string, limit = NOTICES_SHOWN): Promise<Notice[]> {
  type Row = { id: string; day: string; kind: NoticeKind; text: string; handle: string | null }
  const read = (kind: string, n: number) => db.all<Row>(
    `SELECT n.id, n.day, n.kind, n.text, p.handle FROM notices n LEFT JOIN players p ON p.id = n.other_id
     WHERE n.player_id = ? AND n.kind ${kind} 'new-device' ORDER BY n.day DESC, n.rowid DESC LIMIT ?`,
    playerId, n,
  )
  const warnings = await read('=', Math.min(WARNINGS_SHOWN, limit))
  const rows = [...warnings, ...await read('!=', limit - warnings.length)]
  return rows.map(r => ({ id: r.id, day: r.day, kind: r.kind, text: r.text, ...(r.handle ? { handle: r.handle } : {}) }))
}

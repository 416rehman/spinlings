// The shape of the session, never its content (SPEC 2.1, 10): which family the model belongs to, whether Claude's
// main turn runs, rate-limit fullness, and presence minutes for pack charging. Pure: the hooks that feed these live in
// register.tsx and the orchestration in game.ts.
import type { Family } from '../core/types.ts'
import { ECONOMY } from '../core/economy.ts'
import { FAMILIES, familyOfModel } from '../core/families.ts'
import type { Lease, StoredPresence } from './store.ts'
import { emptyTally } from './store.ts'
import { clockTime } from './text.ts'

const B = ECONOMY.battle

export { familyOfModel }

/** The reset time of a rate-limit window at 100%, or null. Only fullness is read, never cost or context (SPEC 10). */
export function restingUntil(limits: readonly { percentUsed: number; resetsAt?: string }[], now: number): number | null {
  let until: number | null = null
  for (const l of limits) {
    if (!(l.percentUsed >= 100)) continue
    const t = typeof l.resetsAt === 'string' ? Date.parse(l.resetsAt) : NaN
    if (Number.isFinite(t) && t > now) until = until === null ? t : Math.max(until, t)
  }
  return until
}

/** The status line's comfort note while a window is full (SPEC 17): no reward, no penalty. */
export function comfortLine(until: number): string {
  const at = clockTime(until)
  return at ? `Claude is resting until ${at} · your team is napping too` : 'Claude is resting · your team is napping too'
}

// ---------- reactions: one line, then gone ----------

export const REACTION_MS = 4000

/** A one-line reaction to the turn ending early or the conversation being tidied (SPEC 10). */
export function reactionLine(kind: 'aborted' | 'compact', name: string): string {
  return kind === 'aborted' ? `${name} flinched` : `${name} tidied its nest`
}

// ---------- waiting battles: the encounter timing of SPEC 13 ----------

/** A player with fewer finished battles than this is new: every check meets a wild creature, as the server's spacing allows. */
export const BEGINNER_BATTLES = 3

export type EncounterInput = {
  now: number
  /**
   * Claude's working time so far toward this check: what earlier turns left over plus the running turn's own, so
   * short turns add up (the clock starts over only when an encounter begins)
   */
  worked: number
  /** fewer than BEGINNER_BATTLES battles: the first encounters are guaranteed, wild ones, one as soon as the server's spacing allows */
  beginner: boolean
  /** a die in [0, 1) for the 30% roll, another for the 40% duel pick */
  roll: number
  duelRoll: number
  nextWildAt: number
  nextDuelAt: number
  lastDuelAt: number
}

/** Working time until the next encounter check, from the time worked so far: 20 s, then every 15 s. */
export function nextCheckIn(worked: number): number {
  const ran = Math.max(0, worked)
  if (ran < B.encounterAfterMs) return B.encounterAfterMs - ran
  const since = (ran - B.encounterAfterMs) % B.encounterEveryMs
  return since === 0 ? 0 : B.encounterEveryMs - since
}

/** The working time a turn adds when it ends, carried to the next turn: never negative, never more than a day. */
export function workedAfter(worked: number, turnStartedAt: number | null, now: number): number {
  const turn = turnStartedAt === null ? 0 : Math.max(0, now - turnStartedAt)
  return Math.min(86_400_000, Math.max(0, worked) + turn)
}

/**
 * One check: a waiting battle to start now, or null. A roll that lands picks a duel 40% of the time when no duel ran
 * in the last 20 minutes, else wild. A beginner's check always meets a wild creature. Server spacing is never pushed:
 * a kind whose spacing has not passed is skipped.
 */
export function encounterDue(i: EncounterInput): 'wild' | 'duel' | null {
  if (i.worked < B.encounterAfterMs) return null
  if (i.beginner) return i.now >= i.nextWildAt ? 'wild' : null
  if (i.roll >= B.encounterChance) return null
  const duelOk = i.now - i.lastDuelAt >= B.duelCooldownMs && i.now >= i.nextDuelAt
  if (duelOk && i.duelRoll < B.duelChance) return 'duel'
  return i.now >= i.nextWildAt ? 'wild' : null
}

// ---------- presence: one lamp per machine (SPEC 6) ----------

export const HEARTBEAT_MS = 60_000
/** A lease outlives two missed heartbeats; then another session may take the lamp. */
export const LEASE_MS = 150_000

export function mayHold(lease: Lease | null, me: string, now: number): boolean {
  return lease === null || lease.holder === me || lease.until <= now
}

export function leaseFor(me: string, now: number): Lease {
  return { holder: me, until: now + LEASE_MS }
}

/** Counts the current wall-clock minute for `family`, once, however many sessions are open. */
export function tickPresence(p: StoredPresence, family: Family, now: number): { presence: StoredPresence; counted: boolean } {
  const minute = Math.floor(now / 60_000)
  if (minute <= p.lastMinute) return { presence: p, counted: false }
  const tally = { ...p.tally, [family]: p.tally[family] + 1 }
  return { presence: { ...p, minutes: Math.min(ECONOMY.packs.presenceMinutes, p.minutes + 1), tally, lastMinute: minute }, counted: true }
}

/** The family to charge once a stretch is complete: the one used most, ties to the current family. Null while blocked. */
export function chargeDue(p: StoredPresence, current: Family, now: number): Family | null {
  if (p.minutes < ECONOMY.packs.presenceMinutes) return null
  if (p.blocked === 'bank' || (p.blocked === 'spacing' && now < p.blockedUntil)) return null
  let best = current
  for (const f of FAMILIES) if (p.tally[f] > p.tally[best]) best = f
  return best
}

/** A fresh stretch after an accepted charge. */
export function afterCharge(p: StoredPresence): StoredPresence {
  return { ...p, minutes: 0, tally: emptyTally(), blocked: null, blockedUntil: 0 }
}

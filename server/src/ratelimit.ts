// Rate limits (SPEC 11, 15, 16, 20.5). A client address is only ever used as
// HMAC(SECRET, day + network) cut to 16 bytes, so the key changes every UTC day and nothing can
// map it back to an address without the secret.
//  * Join challenges, joins, sign-in starts and drop redemptions are counted exactly in D1
//    (join_counters), per key and hour, and the rows are deleted 24 hours on.
//  * Request bursts per token and per key use best-effort in-memory buckets, one set per isolate,
//    all dropped when the UTC day turns.
import { toHex } from '../../plugin/hooks/core/sha256.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import { guard, stmt } from './db.ts'
import type { Db, Stmt } from './db.ts'
import { HttpError } from './http.ts'

const HOUR = 3_600_000

/** `capacity` requests per `windowMs`, refilled continuously. */
export type Rate = { capacity: number; windowMs: number }

export const RATES: Readonly<Record<string, Rate>> = {
  ip: { capacity: 600, windowMs: 60_000 }, // every request, per address key
  token: { capacity: 120, windowMs: 60_000 }, // authenticated requests, per token
  claim: { capacity: 5, windowMs: HOUR }, // gift claim attempts, per player (exact cap: players.claim_tries)
  poll: { capacity: 60, windowMs: 60_000 }, // sign-in polls (one every 2 s), per address key
  passkey: { capacity: 20, windowMs: HOUR }, // passkey starts per token, passkey page posts per address key
  redeem: { capacity: 10, windowMs: HOUR }, // drop code attempts, per token (exact per address: JOIN_LIMITS.redeem)
  profile: { capacity: 60, windowMs: 60_000 }, // profile lookups by handle, per token (SPEC 26.4)
  board: { capacity: 20, windowMs: 60_000 }, // trade board reads, per token
}

/** Per address key, counted in D1. */
export const JOIN_LIMITS = {
  challenges: { hour: 20, day: 60 },
  joins: { hour: 5, day: 20 },
  auth: { hour: 20, day: 60 }, // POST /v1/auth/start (SPEC 29)
  redeem: { hour: 10, day: 40 }, // POST /v1/redeem attempts (SPEC 25)
} as const
export type JoinCounter = keyof typeof JOIN_LIMITS

const MAX_KEYS = 20_000

export type Limiter = {
  /** Spends `cost` tokens; returns 0 when allowed, otherwise the ms until enough have refilled. */
  take(key: string, now: number, cost?: number): number
  clear(): void
  readonly size: number
}

export function createLimiter(rate: Rate, maxKeys = MAX_KEYS): Limiter {
  const perMs = rate.capacity / rate.windowMs
  const buckets = new Map<string, { tokens: number; at: number }>()
  return {
    take(key, now, cost = 1) {
      let b = buckets.get(key)
      if (b) {
        buckets.delete(key) // re-inserted below, so the Map stays in least-recently-used order
        b.tokens = Math.min(rate.capacity, b.tokens + Math.max(0, now - b.at) * perMs)
        b.at = now
      } else {
        b = { tokens: rate.capacity, at: now }
        if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value!)
      }
      buckets.set(key, b)
      if (b.tokens >= cost) {
        b.tokens -= cost
        return 0
      }
      return Math.ceil((cost - b.tokens) / perMs)
    },
    clear: () => buckets.clear(),
    get size() { return buckets.size },
  }
}

export type RateLimits = { take(name: string, key: string, now: number): number }

/** Named in-memory buckets; every bucket is dropped when the UTC day changes. */
export function createRateLimits(rates: Readonly<Record<string, Rate>>): RateLimits {
  const limiters = new Map(Object.entries(rates).map(([name, rate]) => [name, createLimiter(rate)]))
  let day = ''
  return {
    take(name, key, now) {
      const limiter = limiters.get(name)
      if (!limiter) throw new Error(`unknown rate limit ${name}`)
      const today = utcDay(now)
      if (today !== day) {
        day = today
        for (const l of limiters.values()) l.clear()
      }
      return limiter.take(key, now)
    },
  }
}

/** HMAC(secret, day + network) cut to 16 bytes, as hex: the only form of an address the server keeps. */
export function createAddressKey(secret: string): (ip: string, now: number) => Promise<string> {
  const encoder = new TextEncoder()
  const key = crypto.subtle.importKey('raw', encoder.encode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return async (ip, now) => {
    const mac = await crypto.subtle.sign('HMAC', await key, encoder.encode(`${utcDay(now)} ${networkOf(ip)}`) as BufferSource)
    return toHex(new Uint8Array(mac, 0, 16))
  }
}

/** One key per IPv4 address and per IPv6 /64, so a host cannot rotate through its own subnet. */
export function networkOf(ip: string): string {
  const v = ip.trim().toLowerCase().split('%')[0]!
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v)
  if (mapped) return mapped[1]!
  if (!v.includes(':')) return v
  const [head = '', tail] = v.split('::')
  const groups = (part: string) => (part ? part.split(':').flatMap(g => (g.includes('.') ? ['0', '0'] : [g])) : [])
  const h = groups(head)
  const t = tail === undefined ? [] : groups(tail)
  const all = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
  return all.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64'
}

// Column names come from this closed map, never from input.
const COLUMN: Record<JoinCounter, string> = { challenges: 'challenges', joins: 'joins', auth: 'auth', redeem: 'redeem' }

/**
 * Reads what the address key has spent, throws rate_limited (with Retry-After) once the hourly or
 * daily cap is reached, and otherwise returns the statements that spend one more. Put them in the
 * same batch as the action: the guard re-checks the cap atomically, so racing spends cannot pass it.
 */
export async function spendJoinCounter(db: Db, counter: JoinCounter, key: string, now: number): Promise<Stmt[]> {
  const col = COLUMN[counter]
  const limit = JOIN_LIMITS[counter]
  const hour = Math.floor(now / HOUR)
  // The key changes with the UTC day, so all of its rows are today's.
  const spent = await db.get<{ hour: number; day: number }>(
    `SELECT COALESCE(SUM(CASE WHEN hour = ? THEN ${col} END), 0) AS hour, COALESCE(SUM(${col}), 0) AS day
     FROM join_counters WHERE key = ?`,
    hour, key,
  )
  const dayFull = (spent?.day ?? 0) >= limit.day
  if (dayFull || (spent?.hour ?? 0) >= limit.hour) {
    const wait = dayFull ? Date.parse(utcDay(now)) + 24 * HOUR - now : (hour + 1) * HOUR - now
    throw new HttpError('rate_limited', 'Too many tries from here, come back later', 429, { 'Retry-After': String(Math.ceil(wait / 1000)) })
  }
  return [
    guard(
      `SELECT COALESCE(SUM(CASE WHEN hour = ? THEN ${col} END), 0) < ? AND COALESCE(SUM(${col}), 0) < ?
       FROM join_counters WHERE key = ?`,
      hour, limit.hour, limit.day, key,
    ),
    stmt(
      `INSERT INTO join_counters (key, hour, ${col}) VALUES (?, ?, 1)
       ON CONFLICT (key, hour) DO UPDATE SET ${col} = ${col} + 1`,
      key, hour,
    ),
  ]
}

/** Deletes counters 24 hours after their hour. */
export const pruneJoinCounters = (now: number): Stmt =>
  stmt('DELETE FROM join_counters WHERE hour < ?', Math.floor(now / HOUR) - 24)

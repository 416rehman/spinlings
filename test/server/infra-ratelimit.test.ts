// In-memory buckets, address keys, the D1 join counters, and the limits as the app applies them.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  createAddressKey, createLimiter, createRateLimits, JOIN_LIMITS, networkOf, pruneJoinCounters, RATES, spendJoinCounter,
} from '../../server/src/ratelimit.ts'
import type { Db } from '../../server/src/db.ts'
import { HttpError } from '../../server/src/http.ts'
import { conflicted, freshDb, SECRET, T0, testApp } from './infra-helpers.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR

describe('token bucket', () => {
  it('allows a burst of capacity, then says how long to wait', () => {
    const l = createLimiter({ capacity: 3, windowMs: 3000 })
    assert.deepEqual([l.take('k', 0), l.take('k', 0), l.take('k', 0)], [0, 0, 0])
    assert.equal(l.take('k', 0), 1000)
    assert.equal(l.take('k', 400), 600)
    assert.equal(l.take('other', 400), 0)
  })

  it('refills continuously and never past capacity', () => {
    const l = createLimiter({ capacity: 2, windowMs: 2000 })
    l.take('k', 0); l.take('k', 0)
    assert.equal(l.take('k', 1000), 0)
    assert.ok(l.take('k', 1000) > 0)
    assert.equal(l.take('k', 1_000_000), 0)
    assert.equal(l.take('k', 1_000_000), 0)
    assert.ok(l.take('k', 1_000_000) > 0)
  })

  it('ignores a clock that runs backwards', () => {
    const l = createLimiter({ capacity: 1, windowMs: 1000 })
    l.take('k', 5000)
    assert.ok(l.take('k', 0) > 0)
  })

  it('keeps at most maxKeys buckets, dropping the least recently used', () => {
    const l = createLimiter({ capacity: 1, windowMs: 60_000 }, 3)
    for (const k of ['a', 'b', 'c']) l.take(k, 0)
    l.take('a', 0)
    l.take('d', 0)
    assert.equal(l.size, 3)
    assert.equal(l.take('b', 0), 0) // 'b' was dropped, so it starts full again
    assert.ok(l.take('a', 0) > 0)
  })

  it('drops every bucket when the UTC day turns, and refuses unknown names', () => {
    const limits = createRateLimits({ x: { capacity: 1, windowMs: 10 * DAY } })
    assert.equal(limits.take('x', 'k', T0), 0)
    assert.ok(limits.take('x', 'k', T0 + HOUR) > 0)
    assert.equal(limits.take('x', 'k', T0 + DAY), 0)
    assert.throws(() => limits.take('nope', 'k', T0), /unknown rate limit/)
  })

  it('keeps the SPEC numbers', () => {
    assert.deepEqual(RATES.token, { capacity: 120, windowMs: 60_000 })
    assert.deepEqual(JOIN_LIMITS.joins, { hour: 5, day: 20 })
  })
})

describe('address keys', () => {
  const key = createAddressKey(SECRET)

  it('are HMAC(SECRET, day + network) cut to 16 bytes', async () => {
    const expected = createHmac('sha256', SECRET).update('2026-10-02 198.51.100.7').digest('hex').slice(0, 32)
    assert.equal(await key('198.51.100.7', T0), expected)
  })

  it('are stable within a UTC day and change with the day and the secret', async () => {
    const a = await key('198.51.100.7', T0)
    assert.equal(await key('198.51.100.7', T0 + HOUR), a)
    assert.notEqual(await key('198.51.100.8', T0), a)
    assert.notEqual(await key('198.51.100.7', T0 + DAY), a)
    assert.notEqual(await createAddressKey('f'.repeat(32))('198.51.100.7', T0), a)
  })

  it('never contain the address', async () => {
    assert.doesNotMatch(await key('198.51.100.7', T0), /198|51\.|100/)
  })

  it('group IPv6 by /64 and unwrap IPv4-mapped addresses', async () => {
    assert.equal(networkOf('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64')
    assert.equal(networkOf('2001:DB8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64')
    assert.equal(networkOf('2001:db8::1'), '2001:db8:0:0::/64')
    assert.equal(networkOf('::1'), '0:0:0:0::/64')
    assert.equal(networkOf('fe80::1%eth0'), 'fe80:0:0:0::/64')
    assert.equal(networkOf('::ffff:192.0.2.1'), '192.0.2.1')
    assert.equal(networkOf(' 192.0.2.1 '), '192.0.2.1')
    assert.equal(await key('2001:db8::1', T0), await key('2001:db8::ffff', T0))
  })
})

describe('join counters', () => {
  const K = 'b'.repeat(32)
  const spendAndCommit = async (db: Db, now: number, key = K) => db.batch(await spendJoinCounter(db, 'joins', key, now))
  const refusal = async (p: Promise<unknown>) => {
    try { await p } catch (err) { if (err instanceof HttpError) return [err.code, err.headers['Retry-After']] }
    return null
  }

  it('stop at the hourly cap, then again at the daily one', async () => {
    const db = freshDb()
    for (let i = 0; i < 5; i++) await spendAndCommit(db, T0 + i)
    assert.deepEqual(await refusal(spendJoinCounter(db, 'joins', K, T0 + 30 * 60_000)), ['rate_limited', '1800'])
    for (let h = 1; h < 4; h++) for (let i = 0; i < 5; i++) await spendAndCommit(db, T0 + h * HOUR)
    assert.deepEqual(await refusal(spendJoinCounter(db, 'joins', K, T0 + 4 * HOUR)), ['rate_limited', String(8 * 3600)])
    await spendAndCommit(db, T0, 'c'.repeat(32)) // other keys are untouched
    assert.equal((await spendJoinCounter(db, 'challenges', K, T0 + 4 * HOUR)).length, 2) // and other counters
  })

  it('cannot be raced past the cap', async () => {
    const db = freshDb()
    for (let i = 0; i < 4; i++) await spendAndCommit(db, T0)
    const [a, b] = await Promise.all([spendJoinCounter(db, 'joins', K, T0), spendJoinCounter(db, 'joins', K, T0)])
    await db.batch(a!)
    await conflicted(db.batch(b!))
    assert.equal((await db.get<{ joins: number }>('SELECT joins FROM join_counters WHERE key = ?', K))!.joins, 5)
  })

  it('are deleted 24 hours after their hour', async () => {
    const db = freshDb()
    await spendAndCommit(db, T0)
    await db.batch([pruneJoinCounters(T0 + 24 * HOUR)])
    assert.equal((await db.all('SELECT * FROM join_counters')).length, 1)
    await db.batch([pruneJoinCounters(T0 + 25 * HOUR)])
    assert.equal((await db.all('SELECT * FROM join_counters')).length, 0)
  })
})

describe('app limits', () => {
  it('limits every request per address key, with Retry-After, across an IPv6 /64', async () => {
    let now = T0
    const { app } = testApp({ now: () => now, config: { rates: { ip: { capacity: 2, windowMs: 60_000 } } } })
    const get = (ip: string) => app(new Request('http://x/v1/health'), { ip })
    assert.equal((await get('2001:db8::1')).status, 200)
    assert.equal((await get('2001:db8::2')).status, 200)
    const limited = await get('2001:db8::3')
    assert.equal(limited.status, 429)
    assert.equal(((await limited.json()) as { error: { code: string } }).error.code, 'rate_limited')
    assert.equal(limited.headers.get('retry-after'), '30')
    assert.equal((await get('2001:db8:0:1::1')).status, 200) // another /64
    now += 30_000
    assert.equal((await get('2001:db8::3')).status, 200)
  })

  it('spends a route bucket once before the handler', async () => {
    let runs = 0
    const { app } = testApp({
      now: () => T0,
      config: { rates: { claim: { capacity: 2, windowMs: HOUR } } },
      register: api => api.add({ method: 'GET', path: '/try', public: true, limit: 'claim', handler: () => { runs++; return new Response('ok') } }),
    })
    const statuses = []
    for (let i = 0; i < 3; i++) statuses.push((await app(new Request('http://x/try'), { ip: '192.0.2.9' })).status)
    assert.deepEqual(statuses, [200, 200, 429])
    assert.equal(runs, 2)
    assert.throws(() => testApp({ register: api => api.add({ method: 'GET', path: '/x', public: true, limit: 'nope', handler: () => new Response('') }) }), /unknown rate limit nope/)
  })

  it('counts join challenges per address in D1', async () => {
    const { db, app } = testApp({ now: () => T0 })
    const statuses = []
    for (let i = 0; i < JOIN_LIMITS.challenges.hour + 1; i++) statuses.push((await app(new Request('http://x/v1/challenge'), { ip: '192.0.2.7' })).status)
    assert.deepEqual(statuses, [...Array(JOIN_LIMITS.challenges.hour).fill(200), 429])
    const rows = await db.all<{ key: string }>('SELECT key FROM join_counters')
    assert.equal(rows.length, 1)
    assert.match(rows[0]!.key, /^[0-9a-f]{32}$/)
  })
})

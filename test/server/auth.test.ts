// Sessions and sign-in (SPEC 26, 27, 29): identity only from the token, one session per device,
// reset access, device counts, the sign-in poll and its limits.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { API_ROUTES } from '../../plugin/hooks/core/api.ts'
import { REQUEST_SCHEMAS } from '../../plugin/hooks/core/schemas.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import { hashToken, newSession } from '../../server/src/auth.ts'
import { stmt } from '../../server/src/db.ts'
import { counts, DAY, MINUTE, server, T0 } from './scaffold-helpers.ts'

describe('sessions', () => {
  it('are the only identity: a body, path or query never names the caller', () => {
    for (const [op, route] of Object.entries(API_ROUTES)) {
      assert.doesNotMatch(route.path, /:(player|me|id)\b/i, op)
      const schema = REQUEST_SCHEMAS[op as keyof typeof REQUEST_SCHEMAS]
      if (!schema) continue
      for (const key of ['playerId', 'player', 'me', 'token', 'handle']) {
        assert.throws(() => schema({ [key]: 'x' }, '$'), Error, `${op} accepts ${key}`)
      }
    }
  })

  it('work per device: another session for the same player is another device, and both work', async () => {
    const s = server()
    const p = await s.join()
    const second = newSession({ randomBytes: n => crypto.getRandomValues(new Uint8Array(n)), playerId: p.id, now: T0 })
    await s.db.batch([second.stmt])
    const there = await s.as(second.token)
    assert.equal(there.id, p.id)
    assert.deepEqual(await p.call('devices'), { sessions: 2, passkeys: 0 })
  })

  it('record their last day of use, at most once a day, and expire after 180 days unused', async () => {
    const s = server()
    const p = await s.join()
    const day = async () => (await s.db.get<{ last_used_day: string }>('SELECT last_used_day FROM sessions WHERE token_hash = ?', hashToken(p.token)))!.last_used_day
    assert.equal(await day(), '2026-10-02')
    s.tick(179 * DAY)
    await s.app.sweep()
    assert.equal(await day(), '2026-10-02')
    await p.call('devices')
    assert.equal(await day(), utcDay(T0 + 179 * DAY))
    s.tick(181 * DAY)
    await s.app.sweep()
    assert.equal((await s.request('GET', '/v1/me', { token: p.token })).status, 401)
  })
})

describe('POST /v1/me/token (reset access)', () => {
  it('revokes every session at once and hands the caller one new token', async () => {
    const s = server()
    const p = await s.join()
    const other = newSession({ randomBytes: n => crypto.getRandomValues(new Uint8Array(n)), playerId: p.id, now: T0 })
    await s.db.batch([other.stmt])
    const { token } = await p.call('resetToken', {})
    for (const old of [p.token, other.token]) assert.equal((await s.request('GET', '/v1/me', { token: old })).status, 401)
    const fresh = await s.as(token)
    assert.equal(fresh.id, p.id)
    assert.deepEqual(await fresh.call('devices'), { sessions: 1, passkeys: 0 })
  })

  it('lets one of two racing resets win; the other device must sign in again', async () => {
    const s = server()
    const p = await s.join()
    const other = newSession({ randomBytes: n => crypto.getRandomValues(new Uint8Array(n)), playerId: p.id, now: T0 })
    await s.db.batch([other.stmt])
    const [a, b] = await Promise.all([
      s.request('POST', '/v1/me/token', { token: p.token, body: {} }),
      s.request('POST', '/v1/me/token', { token: other.token, body: {} }),
    ])
    assert.deepEqual([a.status, b.status].sort(), [200, 401])
    assert.equal((await counts(s.db, ['sessions'])).sessions, 1)
  })

  it('never touches another player', async () => {
    const s = server()
    const p = await s.join()
    const q = await s.join()
    await p.call('resetToken', {})
    assert.equal((await q.call('me')).player.handle, q.me.player.handle)
  })
})

describe('sign-in polling', () => {
  it('answers pending until something happens, 404 for an unknown poll and 410 once expired', async () => {
    const s = server()
    const { pollId } = await s.call('authStart', {})
    assert.match(pollId, /^[a-z2-7]{26}$/)
    assert.deepEqual(await s.call('authPoll', { pollId }), { status: 'pending' })
    assert.equal((await s.request('GET', '/v1/auth/poll/aaaaaaaaaaaaaaaaaaaaaaaaaa')).status, 404)
    s.tick(10 * MINUTE)
    assert.equal((await s.request('GET', `/v1/auth/poll/${pollId}`)).status, 410)
    await s.app.sweep()
    assert.equal((await counts(s.db, ['auth_polls'])).auth_polls, 0)
  })

  it('limits sign-in starts per address in D1, 20 an hour', async () => {
    const s = server()
    const statuses: number[] = []
    for (let i = 0; i < 21; i++) statuses.push((await s.request('POST', '/v1/auth/start', { body: {}, ip: '203.0.113.9' })).status)
    assert.deepEqual([...new Set(statuses)], [200, 429])
    assert.equal(statuses.filter(x => x === 200).length, 20)
    assert.equal((await s.request('POST', '/v1/auth/start', { body: {}, ip: '203.0.113.10' })).status, 200)
  })

  it('limits polling per address', async () => {
    const s = server()
    const { pollId } = await s.call('authStart', {})
    let limited = 0
    for (let i = 0; i < 61; i++) if ((await s.request('GET', `/v1/auth/poll/${pollId}`, { ip: '203.0.113.11' })).status === 429) limited++
    assert.equal(limited, 1)
  })

  it('keeps one add flow per player: a new start replaces the old one', async () => {
    const s = server()
    const p = await s.join()
    await p.call('passkeyStart', {})
    const { pollId } = await p.call('passkeyStart', {})
    assert.equal((await counts(s.db, ['auth_polls'])).auth_polls, 1)
    assert.deepEqual(await s.call('authPoll', { pollId }), { status: 'pending' })
  })

  it('drops a finished sign-in whose account was deleted meanwhile', async () => {
    const s = server()
    const p = await s.join()
    const { pollId } = await s.call('authStart', {})
    await s.db.batch([stmt(`UPDATE auth_polls SET state = 'done', player_id = ?`, p.id)])
    await p.call('deleteMe')
    assert.equal((await s.request('GET', `/v1/auth/poll/${pollId}`)).status, 404)
    assert.equal((await counts(s.db, ['auth_polls', 'sessions'])).sessions, 0)
  })
})

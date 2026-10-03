// Tokens, join challenges and proof of work, the join ticket, and authentication as the app applies it.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sha256Hex, solveProofOfWork } from '../../plugin/hooks/core/sha256.ts'
import type { Api, PlayerCtx } from '../../server/src/app.ts'
import {
  bearerToken, CHALLENGE_TTL, DEFAULT_DIFFICULTY, hashToken, issueChallenge, newToken, prepareJoin, proofBits, sessionStmt, spendChallenge,
} from '../../server/src/auth.ts'
import { Conflict, guard, stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { HttpError } from '../../server/src/http.ts'
import type { PlayerRow } from '../../server/src/schema.ts'
import { addPlayer, conflicted, freshDb, realRandom, T0, testApp } from './infra-helpers.ts'

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (err) {
    assert.ok(err instanceof HttpError, String(err))
    return err.code
  }
  return 'ok'
}

const ADDRESS = 'a'.repeat(32)
const issue = (db: Db, difficulty = 8, now = T0, addressKey = ADDRESS) =>
  issueChallenge(db, { now, randomBytes: realRandom, difficulty, addressKey })
const solve = (challenge: string, difficulty: number) => solveProofOfWork(challenge, difficulty)!
const count = async (db: Db, table: string) => (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n

/** A nonce whose hash has exactly `bits` leading zero bits. */
function nonceWithBits(challenge: string, bits: number): string {
  for (let i = 0; ; i++) if (proofBits(challenge, i.toString(36)) === bits) return i.toString(36)
}

describe('tokens', () => {
  it('are 32 random bytes as hex', () => {
    let asked = 0
    assert.equal(newToken(n => { asked = n; return new Uint8Array(n).fill(0xab) }), 'ab'.repeat(32))
    assert.equal(asked, 32)
    const a = newToken(realRandom), b = newToken(realRandom)
    assert.match(a, /^[0-9a-f]{64}$/)
    assert.notEqual(a, b)
  })

  it('are stored as their SHA-256', () => {
    const token = newToken(realRandom)
    assert.equal(hashToken(token), sha256Hex(token))
    assert.throws(() => hashToken('not-a-token'), TypeError)
  })

  it('are read only from a well-formed Bearer header', () => {
    const token = 'c'.repeat(64)
    const req = (auth?: string) => new Request('http://x/', auth ? { headers: { authorization: auth } } : {})
    assert.equal(bearerToken(req(`Bearer ${token}`)), token)
    for (const bad of [undefined, token, `bearer ${token}`, `Bearer  ${token}`, `Bearer ${token}0`, `Bearer ${'C'.repeat(64)}`, 'Basic abc']) {
      assert.equal(bearerToken(req(bad)), null, String(bad))
    }
  })
})

describe('proof of work', () => {
  it('defaults to 18 bits and counts bits exactly', () => {
    assert.equal(DEFAULT_DIFFICULTY, 18)
    const challenge = 'f'.repeat(32)
    for (const bits of [0, 1, 5, 9]) assert.equal(proofBits(challenge, nonceWithBits(challenge, bits)), bits)
    const hex = sha256Hex(`${challenge}:${nonceWithBits(challenge, 9)}`)
    assert.ok(hex.startsWith('00') && !hex.startsWith('000') && parseInt(hex[2]!, 16) < 8 && parseInt(hex[2]!, 16) >= 4)
  })

  it('accepts what the shared core solver finds (the client side)', async () => {
    const db = freshDb()
    const { challenge, difficulty } = await issue(db, 10)
    assert.equal(await codeOf(spendChallenge(db, challenge, solve(challenge, difficulty), T0)), 'ok')
  })
})

describe('join challenges', () => {
  it('are random, stored with their difficulty, and counted per address key', async () => {
    const db = freshDb()
    const a = await issue(db, 12), b = await issue(db, 12)
    assert.match(a.challenge, /^[0-9a-f]{32}$/)
    assert.notEqual(a.challenge, b.challenge)
    assert.equal(a.difficulty, 12)
    assert.equal((await db.get<{ challenges: number }>('SELECT challenges FROM join_counters WHERE key = ?', ADDRESS))!.challenges, 2)
    await assert.rejects(issue(db, 33), RangeError)
  })

  it('are spent once: the spend commits with the join, and a second spend is refused', async () => {
    const db = freshDb()
    const { challenge } = await issue(db)
    const nonce = solve(challenge, 8)
    const spend = await spendChallenge(db, challenge, nonce, T0 + 1000)
    const racing = await spendChallenge(db, challenge, nonce, T0 + 1000) // read before the first commits
    await db.batch(spend)
    await conflicted(db.batch(racing))
    assert.equal(await codeOf(spendChallenge(db, challenge, nonce, T0 + 1000)), 'expired')
    assert.equal(await count(db, 'challenges'), 0)
  })

  it('stay unspent when the join batch fails for another reason', async () => {
    const db = freshDb()
    const { challenge } = await issue(db)
    const nonce = solve(challenge, 8)
    await conflicted(db.batch([...(await spendChallenge(db, challenge, nonce, T0)), guard('SELECT 0')]))
    assert.equal(await codeOf(spendChallenge(db, challenge, nonce, T0)), 'ok')
  })

  it('expire after 5 minutes and are deleted', async () => {
    const db = freshDb()
    const { challenge } = await issue(db)
    const nonce = solve(challenge, 8)
    assert.equal(await codeOf(spendChallenge(db, challenge, nonce, T0 + CHALLENGE_TTL)), 'expired')
    assert.equal(await count(db, 'challenges'), 0)
    const again = await issue(db)
    assert.equal(await codeOf(spendChallenge(db, again.challenge, solve(again.challenge, 8), T0 + CHALLENGE_TTL - 1)), 'ok')
  })

  it('burn on a wrong proof, judged at the difficulty they were issued with', async () => {
    const db = freshDb()
    const { challenge } = await issue(db, 14)
    assert.equal(await codeOf(spendChallenge(db, challenge, nonceWithBits(challenge, 13), T0)), 'not_allowed')
    assert.equal(await count(db, 'challenges'), 0)
    const fresh = await issue(db, 14)
    assert.equal(await codeOf(spendChallenge(db, fresh.challenge, solve(fresh.challenge, 14), T0)), 'ok')
  })

  it('reject malformed input before touching the database', async () => {
    const reads: string[] = []
    const db = { get: async (sql: string) => { reads.push(sql) }, all: async () => [], batch: async () => [] } as unknown as Db
    for (const [c, n] of [['xyz', 'a'], ['a'.repeat(32), ''], ['a'.repeat(32), 'a b'], [42, 'a'], ['a'.repeat(32), 'a'.repeat(65)]]) {
      assert.equal(await codeOf(spendChallenge(db, c, n, T0)), 'bad_request')
    }
    assert.deepEqual(reads, [])
  })

  it('prune expired challenges when issuing', async () => {
    const db = freshDb()
    await issue(db, 8, T0)
    await issue(db, 8, T0 + CHALLENGE_TTL)
    assert.equal(await count(db, 'challenges'), 1)
  })
})

describe('joining', () => {
  // The smallest join route: the real one adds the starter team and packs to the same batch.
  const joinRoute = (api: Api) => api.add({
    method: 'POST', path: '/join', public: true,
    handler: async ctx => {
      const { challenge, nonce } = ctx.body as { challenge: string; nonce: string }
      const ticket = await prepareJoin(ctx.db, { challenge, nonce, now: ctx.now, randomBytes: ctx.randomBytes, addressKey: ctx.addressKey })
      const id = `p${ticket.tokenHash.slice(0, 8)}`
      await ctx.db.batch([
        ...ticket.stmts,
        stmt(`INSERT INTO players (id, handle, joined, last_seen, season) VALUES (?, ?, '2026-10-02', '2026-10-02', 1)`, id, `soft-otter-${id}`),
        sessionStmt({ randomBytes: ctx.randomBytes, playerId: id, tokenHash: ticket.tokenHash, now: ctx.now }),
      ])
      return Response.json({ token: ticket.token })
    },
  })
  const setup = () => {
    let now = T0
    const { db, app } = testApp({ now: () => now, config: { difficulty: 8 }, register: joinRoute })
    const call = (path: string, ip = '192.0.2.1', body?: unknown) => app(new Request(`http://x${path}`, {
      method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: body ? { 'content-type': 'application/json' } : {},
    }), { ip })
    const join = async (ip = '192.0.2.1') => {
      const { challenge } = (await (await call('/v1/challenge', ip)).json()) as { challenge: string }
      return call('/join', ip, { challenge, nonce: solve(challenge, 8) })
    }
    return { db, call, join, tick: (ms: number) => { now += ms } }
  }

  it('makes one account per solved challenge, even when two joins race', async () => {
    const { db, call } = setup()
    const { challenge } = (await (await call('/v1/challenge')).json()) as { challenge: string }
    const body = { challenge, nonce: solve(challenge, 8) }
    const [a, b] = await Promise.all([call('/join', '192.0.2.1', body), call('/join', '192.0.2.1', body)])
    assert.deepEqual([a.status, b.status].sort(), [200, 410])
    assert.equal(await count(db, 'players'), 1)
    const { token } = (await (a.status === 200 ? a : b).json()) as { token: string }
    assert.ok((await db.get('SELECT 1 FROM sessions WHERE token_hash = ?', hashToken(token))) !== undefined)
  })

  it('allows 5 joins an hour and 20 a day per address, answering with Retry-After', async () => {
    const { join, tick } = setup()
    for (let i = 0; i < 5; i++) assert.equal((await join()).status, 200)
    const limited = await join()
    assert.equal(limited.status, 429)
    assert.equal(((await limited.json()) as { error: { code: string } }).error.code, 'rate_limited')
    assert.equal(limited.headers.get('retry-after'), '3600') // T0 is on the hour
    assert.equal((await join('198.51.100.9')).status, 200) // another address
    for (let h = 1; h < 4; h++) {
      tick(3_600_000)
      for (let i = 0; i < 5; i++) assert.equal((await join()).status, 200, `hour ${h} join ${i}`)
    }
    tick(3_600_000)
    const daily = await join()
    assert.equal(daily.status, 429)
    assert.equal(daily.headers.get('retry-after'), String(8 * 3600)) // until midnight UTC
  })
})

describe('authenticated routes', () => {
  const setup = async (register?: (api: Api) => void) => {
    let now = T0
    const { db, app } = testApp({ now: () => now, config: { rates: { token: { capacity: 3, windowMs: 60_000 } } }, register })
    const token = newToken(realRandom)
    await addPlayer(db, 'p1', hashToken(token))
    const call = (method: string, path: string, auth: string | null = token, body?: unknown) =>
      app(new Request(`http://x${path}`, {
        method,
        headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }), { ip: '192.0.2.1' })
    return { db, token, call, tick: (ms: number) => { now += ms } }
  }

  it('answers 401 with no detail for a missing, malformed or unknown token', async () => {
    const { call } = await setup(api => api.add({ method: 'GET', path: '/me', handler: ctx => Response.json({ id: ctx.player.id }) }))
    for (const auth of [null, 'nope', 'f'.repeat(64)]) {
      const res = await call('GET', '/me', auth)
      assert.equal(res.status, 401)
      assert.deepEqual(await res.json(), { error: { code: 'unauthorized', message: 'Unauthorized' } })
    }
    assert.deepEqual(await (await call('GET', '/me')).json(), { id: 'p1' })
  })

  it('records last_seen as a day, and only once a day', async () => {
    // touch: false, so the game's daily hello (which bumps the version) stays out of it
    const { db, call, tick } = await setup(api => api.add({ method: 'GET', path: '/me', touch: false, handler: () => new Response('ok') }))
    const seen = async () => (await db.get<{ last_seen: string; version: number }>(`SELECT last_seen, version FROM players WHERE id = 'p1'`))!
    await call('GET', '/me')
    assert.deepEqual(await seen(), { last_seen: '2026-10-02', version: 0 })
    tick(86_400_000)
    await call('GET', '/me')
    assert.equal((await seen()).last_seen, '2026-10-03')
  })

  it('runs touch hooks first and hands the handler the row they changed', async () => {
    const { call } = await setup(api => {
      api.onTouch(async (ctx: PlayerCtx) => {
        if (ctx.player.hello_day === '2026-10-02') return
        await ctx.db.batch([
          guard('SELECT 1 FROM players WHERE id = ? AND version = ?', ctx.player.id, ctx.player.version),
          stmt(`UPDATE players SET sparks = sparks + 10, hello_day = '2026-10-02', version = version + 1 WHERE id = ?`, ctx.player.id),
        ])
        return (await ctx.db.get<PlayerRow>('SELECT * FROM players WHERE id = ?', ctx.player.id))!
      })
      api.add({ method: 'GET', path: '/sparks', handler: ctx => Response.json({ sparks: ctx.player.sparks }) })
    })
    assert.deepEqual(await (await call('GET', '/sparks')).json(), { sparks: 110 })
    assert.deepEqual(await (await call('GET', '/sparks')).json(), { sparks: 110 })
  })

  it('re-runs a handler that lost a race, with a fresh player row', async () => {
    let runs = 0
    const { db, call } = await setup(api => api.add({
      method: 'POST', path: '/spend',
      handler: async ctx => {
        runs++
        const p = ctx.player
        if (runs === 1) await ctx.db.batch([stmt(`UPDATE players SET sparks = 40, version = version + 1 WHERE id = ?`, p.id)]) // a rival writer
        await ctx.db.batch([
          guard('SELECT 1 FROM players WHERE id = ? AND version = ?', p.id, p.version),
          stmt('UPDATE players SET sparks = ?, version = version + 1 WHERE id = ?', p.sparks - 30, p.id),
        ])
        return Response.json({ sparks: p.sparks - 30 })
      },
    }))
    assert.deepEqual(await (await call('POST', '/spend', undefined, {})).json(), { sparks: 10 })
    assert.equal(runs, 2)
    assert.equal((await db.get<{ sparks: number }>(`SELECT sparks FROM players WHERE id = 'p1'`))!.sparks, 10)
  })

  it('answers 409 conflict after 3 retries', async () => {
    let runs = 0
    const { call } = await setup(api => api.add({
      method: 'POST', path: '/never', handler: async () => { runs++; throw new Conflict() },
    }))
    const res = await call('POST', '/never', undefined, {})
    assert.equal(res.status, 409)
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'conflict')
    assert.equal(runs, 4)
  })

  it('limits requests per token', async () => {
    const { call, tick } = await setup(api => api.add({ method: 'GET', path: '/me', handler: () => new Response('ok') }))
    const statuses = []
    for (let i = 0; i < 4; i++) statuses.push((await call('GET', '/me')).status)
    assert.deepEqual(statuses, [200, 200, 200, 429])
    tick(20_000)
    assert.equal((await call('GET', '/me')).status, 200)
  })

  it('logs a deleted player out', async () => {
    const { db, call } = await setup(api => api.add({ method: 'GET', path: '/me', handler: () => new Response('ok') }))
    await db.batch([stmt(`DELETE FROM players WHERE id = 'p1'`)])
    assert.equal((await call('GET', '/me')).status, 401)
  })
})

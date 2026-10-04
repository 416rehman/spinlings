import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { server, DAY } from './scaffold-helpers.ts'

describe('chosen public usernames', () => {
  it('normalizes a chosen name, keeps the account and collection, and accepts a same-name retry during cooldown', async () => {
    const s = server(), p = await s.join()
    const before = await p.row(), cards = await p.call('cards')
    const renamed = await p.call('rerollHandle', { handle: 'Fern_Keeper-42' })
    assert.equal(renamed.handle, 'fern_keeper-42')
    assert.equal(renamed.handleRerollFrom, '2026-10-09')
    const after = await p.row()
    assert.equal(after.id, before.id)
    assert.equal(after.team, before.team)
    assert.equal(after.sparks, before.sparks)
    assert.deepEqual(await p.call('cards'), cards)
    assert.equal((await p.call('me')).player.handle, renamed.handle)
    assert.equal((await p.call('profile', { handle: renamed.handle })).handle, renamed.handle)
    assert.equal((await p.fails('profile', { handle: before.handle })).code, 'not_found')
    assert.deepEqual(await p.call('rerollHandle', { handle: 'FERN_KEEPER-42' }), renamed)
    const early = await p.fails('rerollHandle', { handle: 'fern_keeper-43' })
    assert.equal(early.status, 429)
    assert.ok(Number(early.headers.get('retry-after')) > 0)
    s.tick(7 * DAY)
    assert.ok((await p.call('rerollHandle', {})).handle)
  })

  it('refuses occupied and recently retired usernames, and allows an expired hold', async () => {
    const s = server(), p = await s.join(), q = await s.join()
    await p.call('rerollHandle', { handle: 'moss_keeper' })
    assert.equal((await q.fails('rerollHandle', { handle: 'MOSS_KEEPER' })).status, 409)
    s.tick(7 * DAY)
    await p.call('rerollHandle', { handle: 'fern_keeper' })
    assert.equal((await q.fails('rerollHandle', { handle: 'moss_keeper' })).status, 409)
    s.tick(30 * DAY)
    assert.equal((await q.call('rerollHandle', { handle: 'moss_keeper' })).handle, 'moss_keeper')
  })

  it('lets only one of two concurrent requests claim a username', async () => {
    const s = server(), p = await s.join(), q = await s.join()
    const results = await Promise.all([p, q].map(player => s.request('POST', '/v1/me/handle', { token: player.token, body: { handle: 'shared_fern' } })))
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
    assert.equal((await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM players WHERE handle = ?', 'shared_fern'))?.n, 1)
  })

  it('rejects malformed, filtered and reserved usernames without changing the account', async () => {
    const s = server(), p = await s.join(), before = await p.row()
    for (const handle of ['', 'x'.repeat(41), 'with spaces', '../path', 'moss🌿', '<script>', 'admin', 'SPINLINGS', 'fuck', 'aaab']) {
      const response = await s.request('POST', '/v1/me/handle', { token: p.token, body: { handle } })
      assert.equal(response.status, 400)
    }
    const extra = await s.request('POST', '/v1/me/handle', { token: p.token, body: { handle: 'valid_name', playerId: 'another-player' } })
    assert.equal(extra.status, 400)
    assert.equal((await p.row()).handle, before.handle)
    assert.equal((await p.row()).handle_day, before.handle_day)
    assert.equal((await s.request('POST', '/v1/me/handle', { body: { handle: 'valid_name' } })).status, 401)
  })

  it('advertises the browser page and chosen-name support together with their working routes', async () => {
    const s = server(), version = await s.call('version')
    assert.ok(version.features.includes('browser-account'))
    assert.ok(version.features.includes('custom-handles'))
    assert.equal((await s.request('GET', '/account')).status, 200)
    assert.equal((await s.request('POST', '/account/signin/start', { body: {} })).status, 200)
    const p = await s.join()
    assert.equal((await p.call('rerollHandle', { handle: 'bright_fern' })).handle, 'bright_fern')
  })
})

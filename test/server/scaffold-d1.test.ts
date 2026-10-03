// The scaffold over Cloudflare D1, run locally by wrangler's workerd (the real D1 engine, in memory):
// every migration applied the way wrangler applies it, then a player's whole life. Skipped only when
// wrangler cannot start here.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { localD1 } from './d1-helpers.ts'
import { softAuthenticator } from './passkeys-helpers.ts'
import { counts, DAY, server } from './scaffold-helpers.ts'

const local = await localD1()

if ('skip' in local) {
  describe('scaffold over local D1', () => { it('runs', { skip: local.skip }, () => {}) })
} else {
  describe('scaffold over local D1', () => {
    it('joins, touches, adds a passkey, signs in elsewhere, resets, sweeps and deletes', async () => {
      const s = server({ db: local.db })
      const p = await s.join('fable')
      assert.equal(p.me.player.team.length, 3)
      assert.equal((await p.call('world')).season, 1)
      assert.equal((await p.call('season', { season: 1 })).species.length, 36)
      s.tick(DAY)
      assert.equal((await p.call('me')).player.sparks, 110)

      const auth = await softAuthenticator('ES256')
      const { url, pollId } = await p.call('passkeyStart', {})
      const ticket = new URL(url).searchParams.get('t')!
      const { passkeyPage } = await import('../../server/src/game/auth.ts')
      const page = await passkeyPage(local.db, { kind: 'add', ticket, now: s.now(), rpId: 'localhost' })
      assert.equal(page?.kind, 'add')
      const created = await auth.create(page!.kind === 'add' ? page!.options : (null as never), 'http://localhost:8787')
      assert.equal((await s.request('POST', '/passkey/add/finish', { body: { ticket, ...created } })).status, 200)
      assert.deepEqual(await s.call('authPoll', { pollId }), { status: 'added' })

      const start = await s.call('authStart', {})
      const signTicket = new URL(start.url).searchParams.get('t')!
      const signPage = await passkeyPage(local.db, { kind: 'signin', ticket: signTicket, now: s.now(), rpId: 'localhost' })
      const got = await auth.get(signPage!.kind === 'signin' ? signPage!.options : (null as never), 'http://localhost:8787')
      assert.equal((await s.request('POST', '/passkey/signin/finish', { body: { ticket: signTicket, ...got } })).status, 200)
      const done = await s.call('authPoll', { pollId: start.pollId })
      assert.equal(done.status, 'done')

      const { token } = await p.call('resetToken', {})
      const fresh = await s.as(token)
      assert.deepEqual(await fresh.call('devices'), { sessions: 1, passkeys: 0 }, 'reset access ends every way in, passkeys too')
      await s.app.sweep()
      await fresh.call('deleteMe')
      const left = await counts(local.db, ['players', 'sessions', 'passkeys', 'cards', 'packs', 'auth_polls'])
      assert.deepEqual(left, { players: 0, sessions: 0, passkeys: 0, cards: 0, packs: 0, auth_polls: 0 })
    })
  })
}

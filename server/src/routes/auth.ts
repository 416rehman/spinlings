// Joining and signing in (SPEC 27, 29, 30): the proof-of-work join, sessions per device, reset
// access, and the API side of both passkey flows. The two passkey pages (GET /passkey/add and
// /passkey/signin, and /static/passkey.js) are the site's; they post here.
import { ID_RE, S, SchemaError, cleanText } from '../../../plugin/hooks/core/schemas.ts'
import { utcDay } from '../../../plugin/hooks/core/world.ts'
import type { Api, Ctx } from '../app.ts'
import { guard, stmt } from '../db.ts'
import { fail, json } from '../http.ts'
import type { PasskeyRow } from '../schema.ts'
import { collectPoll, devicesOf, joinPlayer, pollByTicket, pollGuard, resetSessions, startPoll } from '../game/auth.ts'
import { apiRoute, loadPlayer, newId, notFound, publicRoute } from '../game/ctx.ts'
import { NOTICE_TEXT, notice } from '../game/notices.ts'
import { b64urlDecode, PasskeyError, rpIdOf, verifyAssertion, verifyRegistration } from '../game/passkeys.ts'
import type { PublicKey } from '../game/passkeys.ts'
import { meResponse } from './account.ts'

const b64 = (max: number) => S.str({ min: 1, max, re: /^[A-Za-z0-9_-]+$/ })
const ticket = S.str({ min: 26, max: 26, re: ID_RE })

/** What /static/passkey.js posts after navigator.credentials.create: every binary field base64url. */
export type AddFinishRequest = { ticket: string; id: string; clientData: string; attestation: string }
/** What /static/passkey.js posts after navigator.credentials.get: every binary field base64url. */
export type SigninFinishRequest = { ticket: string; id: string; clientData: string; authenticator: string; signature: string; userHandle?: string }

export const addFinishSchema = S.obj<AddFinishRequest>({ ticket, id: b64(1400), clientData: b64(4096), attestation: b64(10_000) })
export const signinFinishSchema = S.obj<SigninFinishRequest>({
  ticket, id: b64(1400), clientData: b64(4096), authenticator: b64(4096), signature: b64(1024), userHandle: S.optional(b64(128)),
})

function strict<T>(ctx: Ctx, schema: (v: unknown, path: string) => T): T {
  try {
    return schema(ctx.body, '$')
  } catch (err) {
    if (err instanceof SchemaError) fail('bad_request', cleanText(err.message, 200))
    throw err
  }
}

const decode = (s: string) => {
  try {
    return b64urlDecode(s)
  } catch {
    return fail('bad_request', 'Malformed passkey data')
  }
}

/** Verification failures say only that the passkey did not check out. */
async function checked<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof PasskeyError) fail('bad_request', 'That passkey did not check out')
    throw err
  }
}

const expired = (): never => fail('expired', 'This link has expired: start again in Claude Code')

export function auth(api: Api): void {
  publicRoute(api, 'join', async (ctx, req) => {
    const { token, playerId } = await joinPlayer(ctx, req)
    const player = (await loadPlayer(ctx.db, playerId))!
    return { token, me: await meResponse(ctx.db, player, ctx.now) }
  })

  publicRoute(api, 'authStart', async ctx => startPoll(ctx, 'signin'))

  publicRoute(api, 'authPoll', async (ctx, req) => {
    const got = await collectPoll(ctx, req.pollId)
    if (got.status !== 'done') return { status: got.status }
    const player = (await loadPlayer(ctx.db, got.playerId)) ?? notFound('account')
    return { status: 'done' as const, token: got.token, me: await meResponse(ctx.db, player, ctx.now) }
  }, { limit: 'poll' })

  apiRoute(api, 'resetToken', async ctx => ({ token: await resetSessions(ctx) }), { touch: false })

  apiRoute(api, 'devices', async ctx => devicesOf(ctx.db, ctx.player.id), { touch: false })

  apiRoute(api, 'passkeyStart', async ctx => startPoll(ctx, 'add', ctx.player), { touch: false, limit: 'passkey' })

  // The page's half of "add a passkey": the ticket binds it to the account that started it.
  api.add({
    method: 'POST', path: '/passkey/add/finish', public: true, limit: 'passkey',
    handler: async ctx => {
      const body = strict(ctx, addFinishSchema)
      const row = (await pollByTicket(ctx.db, body.ticket, 'add', ctx.now)) ?? expired()
      const reg = await checked(() => verifyRegistration({
        challenge: row.challenge, origin: ctx.origin, rpId: rpIdOf(ctx.origin),
        credentialId: body.id, clientData: decode(body.clientData), attestation: decode(body.attestation),
      }))
      if (await ctx.db.get('SELECT 1 FROM passkeys WHERE credential_id = ?', reg.credentialId)) fail('conflict', 'This passkey is already saved')
      await ctx.db.batch([
        pollGuard(row, 'pending', ctx.now),
        guard('SELECT 1 FROM players WHERE id = ?', row.player_id),
        stmt(`UPDATE auth_polls SET state = 'added', version = version + 1 WHERE id = ?`, row.id),
        stmt(
          `INSERT INTO passkeys (id, player_id, credential_id, user_id, alg, public_key, sign_count, created_day)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          newId(ctx), row.player_id, reg.credentialId, row.user_id, reg.key.alg, JSON.stringify(reg.key.jwk), reg.signCount,
          utcDay(ctx.now),
        ),
        // whoever holds a session can save a passkey, so the account always hears of one
        notice(ctx, row.player_id!, 'new-device', NOTICE_TEXT.passkeySaved()),
      ])
      return json({ ok: true })
    },
  })

  // The page's half of "sign in": the account is whichever one the passkey belongs to.
  api.add({
    method: 'POST', path: '/passkey/signin/finish', public: true, limit: 'passkey',
    handler: async ctx => {
      const body = strict(ctx, signinFinishSchema)
      const row = (await pollByTicket(ctx.db, body.ticket, 'signin', ctx.now)) ?? expired()
      const pk = (await ctx.db.get<PasskeyRow>('SELECT * FROM passkeys WHERE credential_id = ?', body.id)) ?? fail('not_found', 'This passkey is not saved on this server')
      if (body.userHandle !== undefined && body.userHandle !== pk.user_id) fail('bad_request', 'That passkey did not check out')
      const key: PublicKey = { alg: pk.alg as PublicKey['alg'], jwk: JSON.parse(pk.public_key) as JsonWebKey }
      const { signCount } = await checked(() => verifyAssertion({
        challenge: row.challenge, origin: ctx.origin, rpId: rpIdOf(ctx.origin), key, signCount: pk.sign_count,
        clientData: decode(body.clientData), authenticator: decode(body.authenticator), signature: decode(body.signature),
      }))
      await ctx.db.batch([
        pollGuard(row, 'pending', ctx.now),
        guard('SELECT 1 FROM passkeys WHERE id = ? AND version = ?', pk.id, pk.version),
        stmt('UPDATE passkeys SET sign_count = ?, version = version + 1 WHERE id = ?', signCount, pk.id),
        stmt(`UPDATE auth_polls SET state = 'done', player_id = ?, version = version + 1 WHERE id = ?`, pk.player_id, row.id),
      ])
      return json({ ok: true })
    },
  })
}

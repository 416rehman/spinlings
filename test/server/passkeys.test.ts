// The optional passkey (SPEC 30): our CBOR decoder, the WebAuthn checks, and both flows end to end
// with a software authenticator, ES256 and RS256, including every way a ceremony can be bent.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sha256 } from '../../plugin/hooks/core/sha256.ts'
import { CborError, decodeCbor, decodeCborPrefix } from '../../server/src/game/cbor.ts'
import { passkeyPage } from '../../server/src/game/auth.ts'
import { NOTICE_TEXT, NOTICES_SHOWN, WARNINGS_SHOWN } from '../../server/src/game/notices.ts'
import { stmt } from '../../server/src/db.ts'
import type { PasskeyPage } from '../../server/src/game/auth.ts'
import {
  b64urlDecode, b64urlEncode, coseKey, derToRaw, FLAG, parseAuthData, PasskeyError, verifyAssertion, verifyRegistration,
} from '../../server/src/game/passkeys.ts'
import { cbor, concat, rawToDer, softAuthenticator } from './passkeys-helpers.ts'
import type { Authenticator, Bend } from './passkeys-helpers.ts'
import { counts, MINUTE, server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const ORIGIN = 'http://localhost:8787'
const bytes = (...b: number[]) => new Uint8Array(b)
const hex = (s: string) => new Uint8Array(s.match(/../g)!.map(h => parseInt(h, 16)))

describe('CBOR decoder', () => {
  it('reads the RFC 8949 examples it needs', () => {
    const cases: [string, unknown][] = [
      ['00', 0], ['17', 23], ['1818', 24], ['1903e8', 1000], ['1a000f4240', 1000000], ['1b000000e8d4a51000', 1000000000000],
      ['20', -1], ['3863', -100], ['3903e7', -1000], ['f4', false], ['f5', true], ['f6', null], ['f7', undefined],
      ['f93c00', 1], ['f97e00', NaN], ['fa47c35000', 100000], ['fb3ff199999999999a', 1.1],
      ['6161', 'a'], ['6449455446', 'IETF'], ['62c3bc', 'ü'], ['80', []], ['83010203', [1, 2, 3]],
      ['c074323031332d30332d32315432303a30343a30305a', '2013-03-21T20:04:00Z'],
    ]
    for (const [h, want] of cases) assert.deepEqual(decodeCbor(hex(h)), want, h)
    assert.deepEqual(decodeCbor(hex('4401020304')), bytes(1, 2, 3, 4))
    assert.deepEqual(decodeCbor(hex('a201020304')), new Map([[1, 2], [3, 4]]))
    assert.deepEqual(decodeCbor(hex('a26161016162820203')), new Map<string, unknown>([['a', 1], ['b', [2, 3]]]))
  })

  it('refuses what CTAP2 never writes and anything malformed', () => {
    for (const h of [
      '9f018202039f0405ffff', // indefinite array
      '5f42010243030405ff', // indefinite bytes
      'a201020103', // duplicate key
      'a1f601', // a null key
      '1c', // reserved
      '1b0020000000000000', // beyond 2^53
      '62c3', // truncated text
      '62c328', // invalid UTF-8
      '9a00010000', // an array longer than the input
      'f818', // a simple value
      '0001', // trailing bytes
    ]) assert.throws(() => decodeCbor(hex(h)), CborError, h)
    assert.throws(() => decodeCbor(hex('81'.repeat(17) + '00')), /deep/)
    assert.deepEqual(decodeCborPrefix(hex('0102'), 0), { value: 1, end: 1 })
  })
})

describe('WebAuthn pieces', () => {
  it('base64url round-trips and refuses padding and other alphabets', () => {
    for (let n = 0; n < 40; n++) {
      const b = crypto.getRandomValues(new Uint8Array(n))
      assert.deepEqual(b64urlDecode(b64urlEncode(b)), b)
    }
    assert.equal(b64urlEncode(bytes(0xfb, 0xff)), '-_8')
    for (const bad of ['AA==', 'A+B/', 'A', 'AB$c', 'AR']) assert.throws(() => b64urlDecode(bad), PasskeyError, bad)
  })

  it('turns DER ECDSA signatures into r || s, and refuses broken ones', () => {
    const raw = crypto.getRandomValues(new Uint8Array(64))
    raw[0] = 0x80
    raw[32] = 0
    raw[33] = 0x01
    assert.deepEqual(derToRaw(rawToDer(raw)), raw)
    const der = rawToDer(raw)
    for (const broken of [der.slice(0, -1), concat(der, bytes(0)), bytes(0x31, ...der.slice(1)), bytes(0x30, 6, 2, 1, 0x80, 2, 1, 1)]) {
      assert.throws(() => derToRaw(broken), PasskeyError)
    }
  })

  it('reads COSE keys for ES256 and RS256 only', () => {
    const x = new Uint8Array(32).fill(1), y = new Uint8Array(32).fill(2)
    assert.deepEqual(coseKey(new Map<number | string, never>([[1, 2 as never], [3, -7 as never], [-1, 1 as never], [-2, x as never], [-3, y as never]])).jwk,
      { kty: 'EC', crv: 'P-256', x: b64urlEncode(x), y: b64urlEncode(y) })
    const bad = [
      [[1, 2], [3, -7], [-1, 2], [-2, x], [-3, y]], // P-384 curve id
      [[1, 2], [3, -7], [-1, 1], [-2, x.slice(1)], [-3, y]],
      [[1, 3], [3, -257], [-1, new Uint8Array(128).fill(9)], [-2, bytes(1, 0, 1)]], // 1024-bit RSA
      [[1, 1], [3, -8], [-1, 6], [-2, x]], // EdDSA
    ] as [number, unknown][][]
    for (const entries of bad) assert.throws(() => coseKey(new Map(entries) as never), PasskeyError)
  })

  it('reads authenticator data with or without a credential and extensions', () => {
    const rp = sha256('localhost')
    const plain = concat(rp, bytes(FLAG.UP), bytes(0, 0, 0, 7))
    assert.deepEqual(parseAuthData(plain, false), { rpIdHash: rp, flags: FLAG.UP, signCount: 7 })
    assert.throws(() => parseAuthData(plain, true), /no attested credential/)
    assert.throws(() => parseAuthData(concat(plain, bytes(0)), false), /trailing/)
    const ext = concat(rp, bytes(FLAG.UP | FLAG.ED), bytes(0, 0, 0, 1), cbor(new Map([['credProtect', 1]])))
    assert.equal(parseAuthData(ext, false).signCount, 1)
    assert.throws(() => parseAuthData(plain.slice(0, 36), false), /too short/)
  })
})

// ---- the flows ----------------------------------------------------------------------------------

const ticketOf = (url: string) => new URL(url).searchParams.get('t')!

async function page<K extends PasskeyPage['kind']>(s: Server, kind: K, ticket: string): Promise<Extract<PasskeyPage, { kind: K }>> {
  const p = await passkeyPage(s.db, { kind, ticket, now: s.now(), rpId: 'localhost' })
  assert.ok(p && p.kind === kind, `a live ${kind} page`)
  return p as Extract<PasskeyPage, { kind: K }>
}

const post = async (s: Server, path: string, body: unknown, ip?: string) => {
  const res = await s.request('POST', path, { body, ...(ip ? { ip } : {}) })
  return { status: res.status, body: (await res.json()) as { ok?: true; error?: { code: string; message: string } } }
}

async function addPasskey(s: Server, p: Player, auth: Authenticator, bend: Bend = {}) {
  const { url, pollId } = await p.call('passkeyStart', {})
  const ticket = ticketOf(url)
  const options = (await page(s, 'add', ticket)).options
  const res = await post(s, '/passkey/add/finish', { ticket, ...(await auth.create(options, ORIGIN, bend)) })
  return { ...res, pollId, ticket, options }
}

async function signIn(s: Server, auth: Authenticator, bend: Bend = {}) {
  const { url, pollId } = await s.call('authStart', {})
  const ticket = ticketOf(url)
  const options = (await page(s, 'signin', ticket)).options
  const res = await post(s, '/passkey/signin/finish', { ticket, ...(await auth.get(options, ORIGIN, bend)) })
  return { ...res, pollId, ticket, options }
}

for (const alg of ['ES256', 'RS256'] as const) {
  describe(`a passkey with ${alg}`, () => {
    it('is saved from the add page, reported to the mod once, and brings the account to another computer', async () => {
      const s = server()
      const p = await s.join()
      const auth = await softAuthenticator(alg)
      const added = await addPasskey(s, p, auth)
      assert.deepEqual(added, { ...added, status: 200, body: { ok: true } })
      assert.deepEqual(added.options.pubKeyCredParams.map(x => x.alg), [-7, -257])
      assert.deepEqual([added.options.rp.id, added.options.user.name, added.options.attestation], ['localhost', 'Spinlings', 'none'])
      assert.equal(b64urlDecode(added.options.user.id).length, 16)
      assert.deepEqual(await s.call('authPoll', { pollId: added.pollId }), { status: 'added' })
      assert.equal((await s.request('GET', `/v1/auth/poll/${added.pollId}`)).status, 404, 'reported once')
      assert.deepEqual(await p.call('devices'), { sessions: 1, passkeys: 1 })

      const signed = await signIn(s, auth)
      assert.deepEqual(signed.body, { ok: true })
      const done = await s.call('authPoll', { pollId: signed.pollId })
      assert.equal(done.status, 'done')
      if (done.status !== 'done') return
      assert.notEqual(done.token, p.token)
      assert.equal(done.me.player.handle, p.me.player.handle)
      assert.equal((await s.request('GET', `/v1/auth/poll/${signed.pollId}`)).status, 404, 'the session is delivered exactly once')
      const there = await s.as(done.token)
      assert.equal(there.id, p.id)
      assert.deepEqual(await p.call('devices'), { sessions: 2, passkeys: 1 })
      const news = (await p.call('me')).notices
      assert.equal(news[0]!.kind, 'new-device')
      assert.match(news[0]!.text, /new device signed in/)
      // a second sign-in climbs the counter again
      assert.equal((await signIn(s, auth)).status, 200)
      assert.equal((await s.db.get<{ sign_count: number }>('SELECT sign_count FROM passkeys'))!.sign_count, 2)
    })
  })
}

describe('passkey checks', () => {
  const bent = async (bend: Bend, what: 'add' | 'signin', alg: 'ES256' | 'RS256' = 'ES256') => {
    const s = server()
    const p = await s.join()
    const auth = await softAuthenticator(alg)
    if (what === 'add') return (await addPasskey(s, p, auth, bend)).status
    assert.equal((await addPasskey(s, p, auth)).status, 200)
    return (await signIn(s, auth, bend)).status
  }

  it('refuse a registration from another origin, ceremony, challenge or relying party, or without presence', async () => {
    for (const bend of [
      { origin: 'https://evil.example' }, { origin: 'http://localhost:8788' }, { type: 'webauthn.get' }, { challenge: 'AAAA' },
      { crossOrigin: true }, { rpId: 'evil.example' }, { flags: FLAG.UV | FLAG.AT }, { flags: FLAG.UP | FLAG.AT | FLAG.BS },
      { id: 'AAAAAAAAAAAAAAAAAAAAAA' }, { cose: new Map<number | string, never>([[1, 1 as never], [3, -8 as never]]) },
    ] satisfies Bend[]) {
      assert.equal(await bent(bend, 'add'), 400, JSON.stringify(bend))
    }
  })

  it('refuse a sign-in that is bent the same ways, badly signed, or for another user', async () => {
    for (const alg of ['ES256', 'RS256'] as const) {
      for (const bend of [
        { origin: 'https://evil.example' }, { type: 'webauthn.create' }, { challenge: 'AAAA' }, { rpId: 'evil.example' },
        { flags: FLAG.UV }, { badSignature: true }, { userHandle: 'AAAAAAAAAAAAAAAAAAAAAA' }, { crossOrigin: true },
      ] satisfies Bend[]) {
        assert.equal(await bent(bend, 'signin', alg), 400, `${alg} ${JSON.stringify(bend)}`)
      }
    }
  })

  it('accept an authenticator that never counts, and refuse one whose counter goes backwards', async () => {
    const s = server()
    const p = await s.join()
    const flat = await softAuthenticator('ES256', { counts: false })
    assert.equal((await addPasskey(s, p, flat)).status, 200)
    assert.equal((await signIn(s, flat)).status, 200)
    assert.equal((await signIn(s, flat)).status, 200)
    const climbing = await softAuthenticator('ES256')
    assert.equal((await addPasskey(s, p, climbing)).status, 200)
    assert.equal((await signIn(s, climbing, { counter: 5 })).status, 200)
    assert.equal((await signIn(s, climbing, { counter: 5 })).status, 400)
    assert.equal((await signIn(s, climbing, { counter: 6 })).status, 200)
  })

  it('verify directly too, naming why a ceremony failed', async () => {
    const auth = await softAuthenticator('ES256')
    const e = { challenge: 'Y2hhbGxlbmdl', origin: ORIGIN, rpId: 'localhost' }
    const made = await auth.create({ rp: { id: 'localhost' }, user: { id: 'dXNlcg' }, challenge: e.challenge }, ORIGIN)
    const reg = await verifyRegistration({ ...e, credentialId: made.id, clientData: b64urlDecode(made.clientData), attestation: b64urlDecode(made.attestation) })
    assert.equal(reg.key.alg, -7)
    const got = await auth.get({ rpId: 'localhost', challenge: e.challenge }, ORIGIN)
    const args = { ...e, key: reg.key, signCount: 0, clientData: b64urlDecode(got.clientData), authenticator: b64urlDecode(got.authenticator), signature: b64urlDecode(got.signature) }
    assert.deepEqual(await verifyAssertion(args), { signCount: 1 })
    await assert.rejects(verifyAssertion({ ...args, signCount: 1 }), /counter went backwards/)
    await assert.rejects(verifyAssertion({ ...args, origin: 'https://spinlings.dev' }), /wrong origin/)
    await assert.rejects(verifyRegistration({ ...e, credentialId: made.id, clientData: b64urlDecode(made.clientData), attestation: bytes(0xa0) }), /bad attestation/)
  })
})

describe('passkey tickets and polls', () => {
  it('are single use, live 10 minutes, and only for their own flow', async () => {
    const s = server()
    const p = await s.join()
    const auth = await softAuthenticator()
    const added = await addPasskey(s, p, auth)
    assert.equal(added.status, 200)
    const again = await post(s, '/passkey/add/finish', { ticket: added.ticket, ...(await auth.create(added.options, ORIGIN)) })
    assert.equal(again.status, 410, 'the ticket is spent')
    assert.equal(await passkeyPage(s.db, { kind: 'add', ticket: added.ticket, now: s.now(), rpId: 'localhost' }), null)

    const { url, pollId } = await s.call('authStart', {})
    const ticket = ticketOf(url)
    assert.equal(await passkeyPage(s.db, { kind: 'add', ticket, now: s.now(), rpId: 'localhost' }), null, 'a sign-in ticket is not an add ticket')
    const options = (await page(s, 'signin', ticket)).options
    assert.equal((await post(s, '/passkey/add/finish', { ticket, ...(await auth.create({ rp: { id: 'localhost' }, user: { id: 'dXNlcg' }, challenge: options.challenge }, ORIGIN)) })).status, 410)
    s.tick(10 * MINUTE)
    assert.equal(await passkeyPage(s.db, { kind: 'signin', ticket, now: s.now(), rpId: 'localhost' }), null)
    assert.equal((await post(s, '/passkey/signin/finish', { ticket, ...(await auth.get(options, ORIGIN)) })).status, 410)
    assert.equal((await s.request('GET', `/v1/auth/poll/${pollId}`)).status, 410)
  })

  it('put the ticket in the page URL, never the poll id, and keep both only as hashes', async () => {
    const s = server()
    const { url, pollId } = await s.call('authStart', {})
    assert.match(url, /^http:\/\/localhost:8787\/passkey\/signin\?t=[a-z2-7]{26}$/)
    assert.ok(!url.includes(pollId))
    const rows = JSON.stringify(await s.db.all('SELECT * FROM auth_polls'))
    assert.ok(!rows.includes(pollId) && !rows.includes(ticketOf(url)))
    assert.deepEqual(await s.call('authPoll', { pollId }), { status: 'pending' })
  })

  it('use the configured origin for links and the relying party', async () => {
    const s = server({ origin: 'https://spinlings.dev' })
    const p = await s.join()
    const { url } = await p.call('passkeyStart', {})
    assert.match(url, /^https:\/\/spinlings\.dev\/passkey\/add\?t=/)
    const options = (await passkeyPage(s.db, { kind: 'add', ticket: ticketOf(url), now: s.now(), rpId: 'spinlings.dev' }))!
    const auth = await softAuthenticator()
    const body = await auth.create((options as Extract<PasskeyPage, { kind: 'add' }>).options, 'https://spinlings.dev')
    assert.equal((await post(s, '/passkey/add/finish', { ticket: ticketOf(url), ...body })).status, 200)
  })

  it('exclude the passkeys an account already has, and refuse one saved twice', async () => {
    const s = server()
    const p = await s.join()
    const auth = await softAuthenticator()
    const first = await addPasskey(s, p, auth)
    const { url } = await p.call('passkeyStart', {})
    const options = (await page(s, 'add', ticketOf(url))).options
    assert.deepEqual(options.excludeCredentials, [{ type: 'public-key', id: auth.id }])
    assert.equal(options.user.id, first.options.user.id, 'one user.id per account')
    const twice = await post(s, '/passkey/add/finish', { ticket: ticketOf(url), ...(await auth.create(options, ORIGIN)) })
    assert.equal(twice.status, 409)
  })

  it('know nothing of a passkey from elsewhere or of a deleted account', async () => {
    const s = server()
    const p = await s.join()
    const auth = await softAuthenticator()
    assert.equal((await addPasskey(s, p, auth)).status, 200)
    const stranger = await softAuthenticator()
    stranger.userId = auth.userId
    assert.equal((await signIn(s, stranger)).status, 404)
    await p.call('deleteMe')
    assert.equal((await signIn(s, auth)).status, 404)
    assert.deepEqual(await counts(s.db, ['passkeys']), { passkeys: 0 })
  })

  it('only ever say that a passkey did not check out', async () => {
    const s = server()
    const p = await s.join()
    const res = await addPasskey(s, p, await softAuthenticator(), { rpId: 'evil.example' })
    assert.deepEqual(res.body, { error: { code: 'bad_request', message: 'That passkey did not check out' } })
    const junk = await post(s, '/passkey/add/finish', { ticket: res.ticket, id: 'x', clientData: 'a', attestation: 'b' })
    assert.equal(junk.status, 400)
    assert.equal((await post(s, '/passkey/add/finish', { ticket: res.ticket, id: 'x', clientData: 'aa', attestation: 'bb', more: 1 })).status, 400)
  })

  it('say a malformed COSE key or extension block did not check out, never fail or log', async () => {
    const logs: string[] = []
    const s = server({ log: m => { logs.push(m) } })
    const p = await s.join()
    const auth = await softAuthenticator()
    // a truncated COSE key: a 5-entry map that ends at once
    const { url } = await p.call('passkeyStart', {})
    const ticket = ticketOf(url)
    const options = (await page(s, 'add', ticket)).options
    const good = await auth.create(options, ORIGIN)
    const cred = b64urlDecode(auth.id)
    const authData = concat(sha256('localhost'), bytes(FLAG.UP | FLAG.AT), bytes(0, 0, 0, 0), new Uint8Array(16), bytes(0, cred.length), cred, bytes(0xa5))
    const attestation = b64urlEncode(cbor(new Map<number | string, never>([['fmt', 'none' as never], ['attStmt', new Map() as never], ['authData', authData as never]])))
    const add = await post(s, '/passkey/add/finish', { ticket, ...good, attestation })
    assert.deepEqual(add, { status: 400, body: { error: { code: 'bad_request', message: 'That passkey did not check out' } } })
    // a sign-in whose authenticator data claims extensions and then carries garbage
    assert.equal((await addPasskey(s, p, auth)).status, 200)
    const { url: signUrl } = await s.call('authStart', {})
    const signTicket = ticketOf(signUrl)
    const got = await auth.get((await page(s, 'signin', signTicket)).options, ORIGIN)
    const garbage = b64urlEncode(concat(sha256('localhost'), bytes(FLAG.UP | FLAG.ED), bytes(0, 0, 0, 9), bytes(0xa5, 0x01)))
    const signin = await post(s, '/passkey/signin/finish', { ticket: signTicket, ...got, authenticator: garbage })
    assert.deepEqual([signin.status, signin.body.error?.message], [400, 'That passkey did not check out'])
    assert.deepEqual(logs, [])
  })

  it('tell the account whenever a passkey is saved for it', async () => {
    const s = server()
    const p = await s.join()
    assert.equal((await addPasskey(s, p, await softAuthenticator())).status, 200)
    const [news] = (await p.call('me')).notices
    assert.deepEqual([news!.kind, news!.text], ['new-device', 'A passkey was saved for your collection · Reset access if this was not you'])
  })

  it('keep that warning in sight however many other notices come after it', async () => {
    const s = server()
    const p = await s.join()
    assert.equal((await addPasskey(s, p, await softAuthenticator())).status, 200)
    // another player's challenges, or anything else, leave a flood of newer notices
    const flood = (n: number, kind: string) => s.db.batch(Array.from({ length: n }, (_, i) => stmt(
      `INSERT INTO notices (id, player_id, day, kind, text) VALUES (?, ?, '2026-10-09', ?, 'x')`, `${kind}-${i}`, p.id, kind)))
    await flood(NOTICES_SHOWN + 10, 'defense-win')
    let news = (await p.call('me')).notices
    assert.equal(news.length, NOTICES_SHOWN)
    assert.deepEqual([news[0]!.kind, news[0]!.text], ['new-device', NOTICE_TEXT.passkeySaved()])
    assert.deepEqual(news.slice(1).map(n => n.day), Array(NOTICES_SHOWN - 1).fill('2026-10-09'), 'then the newest of the rest')
    // the warnings shown first are bounded too
    await flood(WARNINGS_SHOWN + 5, 'new-device')
    news = (await p.call('me')).notices
    assert.equal(news.length, NOTICES_SHOWN)
    assert.deepEqual(news.map(n => n.kind), [...Array(WARNINGS_SHOWN).fill('new-device'), ...Array(NOTICES_SHOWN - WARNINGS_SHOWN).fill('defense-win')])
  })

  it('end with reset access: a passkey saved with a leaked token, and one half saved, stop working', async () => {
    const s = server()
    const p = await s.join()
    const thief = await softAuthenticator()
    assert.equal((await addPasskey(s, p, thief)).status, 200)
    // the thief starts a second one and waits
    const { url } = await p.call('passkeyStart', {})
    const pending = ticketOf(url)
    const options = (await page(s, 'add', pending)).options
    const { token } = await p.call('resetToken', {})
    const owner = await s.as(token)
    assert.deepEqual(await owner.call('devices'), { sessions: 1, passkeys: 0 })
    assert.equal((await post(s, '/passkey/add/finish', { ticket: pending, ...(await (await softAuthenticator()).create(options, ORIGIN)) })).status, 410)
    assert.equal((await signIn(s, thief)).status, 404)
    // the owner saves a new one and signs in with it elsewhere
    const mine = await softAuthenticator()
    assert.equal((await addPasskey(s, owner, mine)).status, 200)
    assert.equal((await signIn(s, mine)).status, 200)
  })

  it('limit page posts per address', async () => {
    const s = server()
    const statuses = new Set<number>()
    for (let i = 0; i < 21; i++) statuses.add((await post(s, '/passkey/signin/finish', { ticket: 'a'.repeat(26), id: 'a', clientData: 'aa', authenticator: 'aa', signature: 'aa' }, '203.0.113.5')).status)
    assert.deepEqual([...statuses].sort(), [410, 429])
  })
})

// RemoteBackend and the wire: one origin, strict requests, tolerant answers, the 256 KB cap, no redirects, the
// privacy log without the token, the join's proof of work, the version handshake, per-origin sessions.
import { expect, test } from 'claude-code/testing'
import { sha256 } from '../hooks/core/sha256.ts'
import { buildRequest, readAnswer, redact, sentEntry, serverOrigin } from '../hooks/client/net.ts'
import { CLIENT_VERSION, compareSemver, createRemoteBackend, joinServer, solvePow, versionStatus } from '../hooks/client/remote.ts'
import type { RemoteDeps } from '../hooks/client/remote.ts'
import { KEYS, readCache, readPrefs, readToken, serverKeys } from '../hooks/client/store.ts'
import type { Sent, Timer } from '../hooks/client/types.ts'
import { BackendError } from '../hooks/client/types.ts'
import { NOW, ORIGIN, TOKEN, fakeServer } from './fixtures.ts'

const answer = (status: number, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) => ({
  status, ok: status >= 200 && status < 300, headers, text: typeof body === 'string' ? body : JSON.stringify(body),
})

function caught(fn: () => unknown): BackendError {
  try {
    fn()
  } catch (err) {
    if (err instanceof BackendError) return err
    throw err
  }
  throw new Error('did not throw')
}

async function rejected(p: Promise<unknown>): Promise<BackendError> {
  try {
    await p
  } catch (err) {
    if (err instanceof BackendError) return err
    throw err
  }
  throw new Error('did not reject')
}

function deps(over: Partial<RemoteDeps> & { server?: ReturnType<typeof fakeServer> } = {}) {
  const server = over.server ?? fakeServer()
  const sent: Sent[] = []
  const timers: { ms: number; fn: () => void; live: boolean }[] = []
  const d: RemoteDeps = {
    origin: ORIGIN,
    fetch: async (url, init) => server.handle(url, init),
    token: async () => TOKEN,
    now: async () => NOW,
    after: (ms, fn): Timer => { const t = { ms, fn, live: true }; timers.push(t); return { cancel: () => { t.live = false } } },
    sent: e => { sent.push(e) },
    ...over,
  }
  return { d, sent, timers, server }
}

test('the server address is reduced to one https origin', () => {
  expect(serverOrigin(' HTTPS://Spinlings.dev/v1/x ')).toBe('https://spinlings.dev')
  expect(serverOrigin('http://localhost:8787')).toBe('http://localhost:8787')
  expect(serverOrigin('http://example.com')).toBeNull()
  expect(serverOrigin('https://user:pw@example.com')).toBeNull()
  expect(serverOrigin(42)).toBeNull()
})

test('requests carry the client version, and the token only where the route needs it', () => {
  const pub = buildRequest(ORIGIN, 'challenge', {}, TOKEN, CLIENT_VERSION)
  expect(pub.url).toBe(`${ORIGIN}/v1/challenge`)
  expect(pub.init.headers['x-spinlings-client']).toBe(CLIENT_VERSION)
  expect(pub.init.headers.authorization).toBeUndefined()
  expect(pub.init.body).toBeUndefined()
  const auth = buildRequest(ORIGIN, 'openPack', { packId: 'p1' }, TOKEN, CLIENT_VERSION)
  expect(auth.init.method).toBe('POST')
  expect(auth.init.headers.authorization).toBe(`Bearer ${TOKEN}`)
  expect(auth.init.headers['content-type']).toBe('application/json')
  expect(auth.body).toBe('{"packId":"p1"}')
  const path = buildRequest(ORIGIN, 'finishBattle', { battleId: 'b-1', inputs: [2, 5] }, TOKEN, CLIENT_VERSION)
  expect(path.path).toBe('/v1/battles/b-1/finish')
  expect(path.body).toBe('{"inputs":[2,5]}')
  const empty = buildRequest(ORIGIN, 'recycle', { cardId: 'c1' }, TOKEN, CLIENT_VERSION)
  expect(empty.body).toBe('{}')
})

test('the mod never sends a field or a path the documented shape lacks', () => {
  expect(() => buildRequest(ORIGIN, 'openPack', { packId: 'p1', extra: 1 } as never, TOKEN, CLIENT_VERSION)).toThrow()
  expect(() => buildRequest(ORIGIN, 'profile', { handle: '../me' }, TOKEN, CLIENT_VERSION)).toThrow()
  expect(() => buildRequest(ORIGIN, 'join', { challenge: 'abcdefgh', nonce: '1', family: 'opus', email: 'x' } as never, null, CLIENT_VERSION)).toThrow()
  expect(caught(() => buildRequest(ORIGIN, 'me', {}, null, CLIENT_VERSION)).code).toBe('unauthorized')
})

test('answers: redirects, oversize and non-JSON bodies are refused', () => {
  expect(caught(() => readAnswer('me', answer(302, '', { location: 'https://elsewhere' }))).kind).toBe('redirect')
  expect(caught(() => readAnswer('me', answer(200, 'x'.repeat(256 * 1024 + 1)))).kind).toBe('too_large')
  expect(caught(() => readAnswer('me', answer(200, '{}', { 'content-type': 'application/json', 'content-length': String(300_000) }))).kind).toBe('too_large')
  expect(caught(() => readAnswer('me', answer(200, '<html>', { 'content-type': 'text/html' }))).kind).toBe('bad_response')
  expect(caught(() => readAnswer('me', answer(200, { player: 1 }))).kind).toBe('bad_response')
})

test('answers: errors map to codes, unknown codes to unavailable', () => {
  expect(caught(() => readAnswer('me', answer(401, ''))).code).toBe('unauthorized')
  expect(caught(() => readAnswer('me', answer(426, ''))).code).toBe('upgrade_required')
  expect(caught(() => readAnswer('buyPack', answer(400, { error: { code: 'insufficient_sparks', message: 'Need 150 sparks' } }))).code).toBe('insufficient_sparks')
  expect(caught(() => readAnswer('me', answer(500, { error: { code: 'brand-new-code', message: 'x' } }))).code).toBe('unavailable')
  expect(caught(() => readAnswer('me', answer(400, { error: { code: 'not_allowed', message: 'Not on this server' } }))).message).toBe('Not on this server')
  // a message carrying escape sequences fails the schema whole: the generic line shows instead
  const hostile = caught(() => readAnswer('me', answer(400, { error: { code: 'not_allowed', message: 'bad \u001b[31mred\u001b[0m' } })))
  expect(hostile.message).toBe('The server answered 400')
})

test('answers are read tolerantly: unknown keys dropped, unknown kinds fall back', { timeoutMs: 30_000 }, () => {
  const server = fakeServer()
  const me = { ...server.me, futureField: 1, notices: [{ id: 'n1', day: '2026-10-02', kind: 'brand-new', text: 'hi', extra: true }] }
  const read = readAnswer('me', answer(200, me))
  expect((read as Record<string, unknown>).futureField).toBeUndefined()
  expect(read.notices[0]!.kind).toBe('notice')
  expect((read.notices[0] as Record<string, unknown>).extra).toBeUndefined()
})

test('the privacy log never holds the token', () => {
  const built = buildRequest(ORIGIN, 'openPack', { packId: 'p1' }, TOKEN, CLIENT_VERSION)
  const e = sentEntry(NOW, built, TOKEN)
  expect(JSON.stringify(e)).not.toContain(TOKEN)
  expect(e).toEqual({ at: NOW, method: 'POST', path: '/v1/packs/open', body: '{"packId":"p1"}' })
  expect(redact(`{"token":"${TOKEN}"} Bearer ${TOKEN}`, null)).toBe('{"token":"[token]"} Bearer [token]')
})

test('the privacy log never holds the sign-in poll\'s id, which collects a session once', () => {
  const pollId = 'abcdefghijklmnopqrstuvwxyz'
  const e = sentEntry(NOW, buildRequest(ORIGIN, 'authPoll', { pollId }, null, CLIENT_VERSION), null)
  expect(e.path).toBe('/v1/auth/poll/[id]')
  expect(JSON.stringify(e)).not.toContain(pollId)
})

test('RemoteBackend: one door, logged, token on auth routes only', async () => {
  const { d, sent, server } = deps()
  const api = createRemoteBackend(d)
  const v = await api.version({})
  expect(v.features.length).toBeGreaterThan(0)
  const me = await api.me({})
  expect(me.player.handle).toBe('brave-wren-41')
  expect(server.calls.map(c => `${c.method} ${c.path}`)).toEqual(['GET /v1/version', 'GET /v1/me'])
  expect(server.calls[0]!.headers.authorization).toBeUndefined()
  expect(server.calls[1]!.headers.authorization).toBe(`Bearer ${TOKEN}`)
  expect(server.calls.every(c => c.headers['x-spinlings-client'] === CLIENT_VERSION)).toBe(true)
  expect(sent.map(s => s.path)).toEqual(['/v1/version', '/v1/me'])
  expect(JSON.stringify(sent)).not.toContain(TOKEN)
})

test('RemoteBackend: a bad request is refused before anything is sent', async () => {
  const { d, server, sent } = deps()
  const api = createRemoteBackend(d)
  const err = await rejected(api.setTeam({ cardIds: ['a', 'b', 'c', 'd'] }))
  expect(err.code).toBe('bad_request')
  expect(server.calls.length).toBe(0)
  expect(sent.length).toBe(0)
})

test('RemoteBackend: network failures and timeouts are unavailable', async () => {
  const { d } = deps({ fetch: async () => { throw new Error('refused by policy') } })
  expect((await rejected(createRemoteBackend(d).version({}))).kind).toBe('network')
  const slow = deps({ fetch: () => new Promise(() => undefined) })
  const pending = rejected(createRemoteBackend(slow.d).version({}))
  await Promise.resolve()
  await Promise.resolve()
  const timer = slow.timers.find(t => t.live)
  expect(timer?.ms).toBe(15_000)
  timer!.fn()
  expect((await pending).kind).toBe('timeout')
})

test('RemoteBackend: a sign-in page off the server origin is refused', async () => {
  const { d } = deps({
    fetch: async () => answer(200, { url: 'https://phish.example/passkey', pollId: 'p1' }),
  })
  const err = await rejected(createRemoteBackend(d).authStart({}))
  expect(err.kind).toBe('bad_response')
  const ok = deps({ fetch: async () => answer(200, { url: `${ORIGIN}/passkey/signin?p=p1`, pollId: 'p1' }) })
  expect((await createRemoteBackend(ok.d).authStart({})).pollId).toBe('p1')
})

test('proof of work: bit-exact, sliced, and the join sends only challenge, nonce and family', async () => {
  let pauses = 0
  const nonce = await solvePow('challenge-0123456789', 10, async () => { pauses++ }, 'bits', 1 << 16)
  expect(nonce).not.toBeNull()
  const digest = sha256('challenge-0123456789:' + nonce)
  expect(digest[0]).toBe(0)
  expect(digest[1]! >> 6).toBe(0)
  const { d, server } = deps({ token: async () => null })
  const joined = await joinServer(createRemoteBackend(d), 'opus', async () => undefined)
  expect(joined.token).toBe(TOKEN)
  const join = server.calls.find(c => c.path === '/v1/join')!
  expect(Object.keys(JSON.parse(join.body)).sort()).toEqual(['challenge', 'family', 'nonce'])
  expect(join.headers.authorization).toBeUndefined()
  void pauses
})

test('proof of work: an absurd difficulty is declined', async () => {
  const { d } = deps({ server: fakeServer({ difficulty: 30 }), token: async () => null })
  const err = await rejected(joinServer(createRemoteBackend(d), 'opus', async () => undefined))
  expect(err.code).toBe('unavailable')
})

test('version handshake: read-only below minClient, an update to announce, features kept', () => {
  expect(compareSemver('0.1.0', '0.2.0')).toBe(-1)
  expect(compareSemver('1.0.0', '1.0.0-beta.1')).toBe(1)
  expect(compareSemver('0.10.0', '0.9.9')).toBe(1)
  const base = { api: 1, server: '1.0.0', rules: 1, generator: 2, minClient: '0.0.1', latestClient: '0.1.0', features: ['rivals'] }
  expect(versionStatus(base, '0.1.0')).toMatchObject({ readOnly: false, update: null, features: ['rivals'] })
  expect(versionStatus({ ...base, minClient: '0.2.0', latestClient: '0.3.0' }, '0.1.0')).toMatchObject({ readOnly: true, update: '0.3.0' })
})

test('per-origin sessions: keys live under server:{origin}:, and readers trust nothing', () => {
  expect(KEYS.session(ORIGIN)).toBe('server:https://spinlings.dev:session')
  expect(serverKeys(['server:https://a.dev:session', 'server:https://b.dev:cache', 'offline:v1', 'prefs'], 'https://a.dev')).toEqual(['server:https://a.dev:session'])
  expect(readToken(TOKEN)).toBe(TOKEN)
  expect(readToken('short')).toBeNull()
  expect(readToken({ token: TOKEN })).toBeNull()
  expect(readPrefs({ quiet: 'yes', world: 'moon', hints: [1, 'a'] })).toMatchObject({ quiet: false, world: null, hints: ['a'], motion: true })
  expect(readCache({ me: { player: 1 } })).toBeNull()
  expect(readCache({ me: fakeServer().me })?.me.player.handle).toBe('brave-wren-41')
})

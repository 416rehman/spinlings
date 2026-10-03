// Router, body limits, ApiError responses and the security headers, alone and through the app.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Api } from '../../server/src/app.ts'
import { BODY_LIMIT, createRouter, escapeHtml, fail, HttpError, readJson, SECURITY_HEADERS } from '../../server/src/http.ts'
import { testApp } from './infra-helpers.ts'

const caught = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (err) {
    return err as HttpError
  }
  assert.fail('expected a throw')
}

const post = (body: BodyInit | null, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  new Request('http://x/', { method: 'POST', body, headers, duplex: 'half' } as RequestInit)

const streamOf = (chunks: Uint8Array[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const ch of chunks) c.enqueue(ch); c.close() },
})

describe('router', () => {
  const router = createRouter<string>()
  router.add('GET', '/v1/battles/:id', 'battle')
  router.add('POST', '/v1/battles/:id/finish', 'finish')
  router.add('GET', '/v1/offers/:id', 'offer')
  router.add('GET', '/v1/offers/inbox', 'inbox')
  router.add('GET', '/', 'home')

  it('captures and decodes params', () => {
    const m = router.match('POST', '/v1/battles/b%20x/finish')
    assert.equal(m.kind, 'found')
    if (m.kind === 'found') {
      assert.equal(m.value, 'finish')
      assert.deepEqual(m.params, { id: 'b x' })
      assert.equal(m.pattern, '/v1/battles/:id/finish')
    }
  })

  it('prefers literal segments over params whatever the order added', () => {
    const inbox = router.match('GET', '/v1/offers/inbox')
    const offer = router.match('GET', '/v1/offers/o1')
    assert.equal(inbox.kind === 'found' && inbox.value, 'inbox')
    assert.equal(offer.kind === 'found' && offer.value, 'offer')
  })

  it('answers HEAD with the GET route, and the root path', () => {
    const m = router.match('HEAD', '/v1/battles/b1')
    assert.equal(m.kind === 'found' && m.value, 'battle')
    assert.equal(router.match('GET', '/').kind, 'found')
  })

  it('tells 404 from 405, listing what is allowed', () => {
    assert.deepEqual(router.match('DELETE', '/v1/battles/b1'), { kind: 'method', allow: ['GET', 'HEAD'] })
    assert.deepEqual(router.match('GET', '/v1/battles'), { kind: 'none' })
    assert.deepEqual(router.match('GET', '/v1/battles/'), { kind: 'none' }) // empty param
    assert.deepEqual(router.match('GET', '/v1/battles/b1/'), { kind: 'none' })
    assert.deepEqual(router.match('GET', '//v1/battles/b1'), { kind: 'none' })
  })

  it('rejects malformed escapes as a bad request', async () => {
    const err = await caught(() => router.match('GET', '/v1/battles/%E0%A4%A'))
    assert.ok(err instanceof HttpError)
    assert.equal(err.code, 'bad_request')
  })

  it('refuses bad and duplicate patterns', () => {
    assert.throws(() => router.add('GET', 'v1/x', 'x'))
    assert.throws(() => router.add('GET', '/v1//x', 'x'))
    assert.throws(() => router.add('GET', '/v1/:a/:a', 'x'))
    assert.throws(() => router.add('GET', '/v1/battles/:other', 'x'), /duplicate/)
  })
})

describe('readJson', () => {
  it('parses a JSON object', async () => {
    assert.deepEqual(await readJson(post('{"a":[1,2]}')), { a: [1, 2] })
    assert.deepEqual(await readJson(post('{}', { 'content-type': 'Application/JSON; charset=utf-8' })), {})
  })

  it('requires application/json', async () => {
    for (const type of [undefined, 'text/plain', 'application/jsonx', 'multipart/form-data']) {
      const err = await caught(readJson(post('{}', type ? { 'content-type': type } : {})))
      assert.equal(err.code, 'bad_request')
    }
  })

  it('rejects an oversized declared length without reading the body', async () => {
    let pulled = false
    const body = new ReadableStream({ pull() { pulled = true } }, { highWaterMark: 0 })
    const req = post(body, { 'content-type': 'application/json', 'content-length': String(BODY_LIMIT + 1) })
    const err = await caught(readJson(req))
    assert.equal(err.code, 'too_large')
    assert.equal(err.status, 413)
    assert.equal(pulled, false)
  })

  it('stops a body without a length as soon as it passes the limit', async () => {
    const chunk = new Uint8Array(4096).fill(0x20)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({ pull(c) { sent++; c.enqueue(chunk) } }) // endless
    const err = await caught(readJson(post(body)))
    assert.equal(err.code, 'too_large')
    assert.ok(sent <= BODY_LIMIT / chunk.length + 2, `read ${sent} chunks`)
  })

  it('accepts exactly the limit and refuses one byte more', async () => {
    const at = (n: number) => `"${'a'.repeat(n - 2)}"`
    assert.equal(((await readJson(post(at(BODY_LIMIT)))) as string).length, BODY_LIMIT - 2)
    const err = await caught(readJson(post(streamOf([new TextEncoder().encode(at(BODY_LIMIT + 1))]))))
    assert.equal(err.code, 'too_large')
  })

  it('answers 400 for broken JSON, bad UTF-8 and an empty body', async () => {
    for (const body of ['{"a":', '', 'undefined', '{a:1}']) {
      assert.equal((await caught(readJson(post(body)))).code, 'bad_request', JSON.stringify(body))
    }
    assert.equal((await caught(readJson(post(new Uint8Array([0x22, 0xff, 0x22]))))).code, 'bad_request')
  })
})

describe('responses', () => {
  it('maps error codes to statuses', () => {
    const status = (code: HttpError['code']) => new HttpError(code, '').status
    assert.equal(status('bad_request'), 400)
    assert.equal(status('unauthorized'), 401)
    assert.equal(status('not_found'), 404)
    assert.equal(status('rate_limited'), 429)
    assert.equal(status('too_large'), 413)
    assert.throws(() => fail('conflict', 'taken'), (e: HttpError) => e.status === 409 && e.message === 'taken')
  })

  it('escapes HTML', () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})

describe('app', () => {
  const app = (extra: Parameters<typeof testApp>[0] = {}) => testApp(extra).app
  const call = (a: ReturnType<typeof app>, method: string, path: string, init: RequestInit = {}) =>
    a(new Request(`http://x${path}`, { method, ...init }), { ip: '192.0.2.1' })
  const routes = (api: Api) => {
    api.add({ method: 'POST', path: '/echo/:name', public: true, handler: ctx => Response.json({ name: ctx.params.name, body: ctx.body }) })
    api.add({ method: 'POST', path: '/boom/:id', public: true, handler: ctx => { throw new TypeError(`bad ${JSON.stringify(ctx.body)} for ${ctx.params.id}`) } })
    api.add({ method: 'GET', path: '/teapot', public: true, handler: () => fail('conflict', 'Already done') })
    api.add({
      method: 'GET', path: '/cors', public: true,
      handler: () => new Response('x', { headers: { 'Access-Control-Allow-Origin': '*', 'X-Frame-Options': 'SAMEORIGIN' } }),
    })
  }

  it('serves /v1/health with every security header and no CORS', async () => {
    const res = await call(app(), 'GET', '/v1/health')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
    assert.match(res.headers.get('content-type')!, /^application\/json/)
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(k), v)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal([...res.headers.keys()].some(k => k.startsWith('access-control-')), false)
  })

  it('strips CORS headers a handler adds and keeps its own stricter values', async () => {
    const res = await call(app({ register: routes }), 'GET', '/cors')
    assert.equal(res.headers.get('access-control-allow-origin'), null)
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  })

  it('answers JSON errors shaped like ApiError', async () => {
    const a = app({ register: routes })
    const cases: [string, string, RequestInit, number, string][] = [
      ['GET', '/nope', {}, 404, 'not_found'],
      ['DELETE', '/v1/health', {}, 405, 'not_allowed'],
      ['OPTIONS', '/v1/health', {}, 405, 'not_allowed'],
      ['GET', '/teapot', {}, 409, 'conflict'],
      ['POST', '/echo/a', { body: '{', headers: { 'content-type': 'application/json' } }, 400, 'bad_request'],
      ['POST', '/echo/a', { body: '{}' }, 400, 'bad_request'],
      ['POST', '/echo/a', { body: 'x'.repeat(BODY_LIMIT + 1), headers: { 'content-type': 'application/json' } }, 413, 'too_large'],
      ['GET', `/${'a'.repeat(3000)}`, {}, 414, 'too_large'],
    ]
    for (const [method, path, init, status, code] of cases) {
      const res = await call(a, method, path, init)
      assert.equal(res.status, status, `${method} ${path.slice(0, 20)}`)
      const body = await res.json() as { error: { code: string; message: string } }
      assert.equal(body.error.code, code)
      assert.equal(typeof body.error.message, 'string')
      assert.deepEqual(Object.keys(body), ['error'])
    }
    assert.equal((await call(a, 'DELETE', '/v1/health')).headers.get('allow'), 'GET, HEAD')
  })

  it('passes params and the parsed body to handlers', async () => {
    const res = await call(app({ register: routes }), 'POST', '/echo/fog%20maw', {
      body: '{"x":1}', headers: { 'content-type': 'application/json' },
    })
    assert.deepEqual(await res.json(), { name: 'fog maw', body: { x: 1 } })
  })

  it('hides unexpected errors and logs only the route and error name, never the message, URL, IP or body', async () => {
    const logs: string[] = []
    const res = await call(app({ register: routes, log: m => logs.push(m) }), 'POST', '/boom/soft-otter-42?code=quiet-otter-lamp-4821', {
      body: '{"secret":"moonlit"}', headers: { 'content-type': 'application/json' },
    })
    assert.equal(res.status, 500)
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'unavailable')
    assert.equal(logs.length, 1)
    assert.match(logs[0]!, /^spinlings: \/boom\/:id failed: TypeError/)
    assert.doesNotMatch(logs[0]!, /soft-otter|4821|quiet|192\.0\.2\.1|moonlit|secret|bad /)
  })

  it('refuses to start without a real secret', () => {
    assert.throws(() => testApp({ config: { secret: 'short' } }), /SECRET/)
  })

  it('sends HEAD without a body', async () => {
    const res = await call(app(), 'HEAD', '/v1/health')
    assert.equal(res.status, 200)
    assert.equal(await res.text(), '')
  })
})

// The passkey pages' one script, run for real: the page served by the app, /static/passkey.js in a
// sandbox with a stand-in DOM, navigator.credentials backed by the software authenticator, and its
// fetch going back into the same app. If the script decodes or encodes one byte wrongly, the server's
// checks fail and these tests do too.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { b64urlDecode, b64urlEncode } from '../../server/src/game/passkeys.ts'
import { softAuthenticator } from './passkeys-helpers.ts'
import type { Authenticator } from './passkeys-helpers.ts'
import { counts, server } from './scaffold-helpers.ts'
import type { Server } from './scaffold-helpers.ts'

const ORIGIN = 'http://localhost:8787'
const ticketOf = (url: string) => new URL(url).searchParams.get('t')!
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const buf = (b64: string) => b64urlDecode(b64).buffer as ArrayBuffer
const b64 = (bytes: ArrayBufferView | ArrayBuffer) =>
  b64urlEncode(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))

type Credentials = { create?: (o: { publicKey: any }) => Promise<unknown>; get?: (o: { publicKey: any }) => Promise<unknown> }

type Run = {
  status(): string
  state(): string | undefined
  disabled(): boolean
  click(): Promise<void>
  posts: { path: string; body: Record<string, unknown> }[]
}

/** Loads a passkey page from the app and runs the served script against it in a sandbox. */
async function runPage(s: Server, path: string, credentials: Credentials | null): Promise<Run> {
  const page = await (await s.request('GET', path, { client: null })).text()
  const script = await (await s.request('GET', '/static/passkey.js', { client: null })).text()
  const attrs = new Map<string, string>()
  for (const name of ['data-kind', 'data-ticket', 'data-options', 'data-state']) {
    const m = page.match(new RegExp(`${name}="([^"]*)"`))
    if (m) attrs.set(name, unescape(m[1]!))
  }
  let onClick: (() => Promise<void>) | null = null
  const button = { disabled: false, addEventListener: (type: string, fn: () => Promise<void>) => { if (type === 'click') onClick = fn } }
  const status = { textContent: '' }
  const root = { getAttribute: (n: string) => attrs.get(n) ?? null, setAttribute: (n: string, v: string) => { attrs.set(n, String(v)) } }
  const elements: Record<string, unknown> = { passkey: root, go: button, status }
  const posts: Run['posts'] = []
  const sandbox: Record<string, unknown> = {
    document: { getElementById: (id: string) => elements[id] ?? null },
    navigator: credentials ? { credentials } : {},
    atob, btoa,
    fetch: async (url: string, init: { method: string; body: string; credentials?: string; redirect?: string }) => {
      assert.equal(init.credentials, 'omit')
      assert.equal(init.redirect, 'error')
      assert.ok(url.startsWith('/'), 'same origin only')
      const body = JSON.parse(init.body) as Record<string, unknown>
      posts.push({ path: url, body })
      return s.request(init.method, url, { body })
    },
  }
  if (credentials) sandbox.PublicKeyCredential = function PublicKeyCredential() {}
  sandbox.window = sandbox
  vm.runInNewContext(script, sandbox)
  return {
    status: () => status.textContent,
    state: () => attrs.get('data-state'),
    disabled: () => button.disabled,
    click: async () => { assert.ok(onClick, 'the button is wired'); await onClick!() },
    posts,
  }
}

/** navigator.credentials over the software authenticator, keeping what the page handed it. */
function browser(auth: Authenticator, seen: { create?: any; get?: any } = {}): Credentials {
  return {
    async create({ publicKey }) {
      seen.create = publicKey
      const made = await auth.create({ rp: publicKey.rp, user: { id: b64(publicKey.user.id) }, challenge: b64(publicKey.challenge) }, ORIGIN)
      return { rawId: buf(made.id), response: { clientDataJSON: buf(made.clientData), attestationObject: buf(made.attestation) } }
    },
    async get({ publicKey }) {
      seen.get = publicKey
      const got = await auth.get({ rpId: publicKey.rpId, challenge: b64(publicKey.challenge) }, ORIGIN)
      return {
        rawId: buf(got.id),
        response: {
          clientDataJSON: buf(got.clientData), authenticatorData: buf(got.authenticator), signature: buf(got.signature),
          userHandle: got.userHandle ? buf(got.userHandle) : null,
        },
      }
    },
  }
}

for (const alg of ['ES256', 'RS256'] as const) {
  describe(`the passkey page script with ${alg}`, () => {
    it('saves a passkey, then signs in with it on another computer', async () => {
      const s = server()
      const p = await s.join()
      const auth = await softAuthenticator(alg)
      const seen: { create?: any; get?: any } = {}

      const start = await p.call('passkeyStart', {})
      const add = await runPage(s, `/passkey/add?t=${ticketOf(start.url)}`, browser(auth, seen))
      assert.equal(add.state(), 'ready')
      await add.click()
      assert.equal(add.state(), 'done', add.status())
      assert.match(add.status(), /Passkey saved/)
      assert.deepEqual(add.posts.map(x => x.path), ['/passkey/add/finish'])
      assert.deepEqual(Object.keys(add.posts[0]!.body).sort(), ['attestation', 'clientData', 'id', 'ticket'])
      // what reached navigator.credentials: binary where WebAuthn wants it, the rest untouched
      assert.ok(seen.create.challenge instanceof Uint8Array || ArrayBuffer.isView(seen.create.challenge))
      assert.equal(seen.create.attestation, 'none')
      assert.equal(seen.create.authenticatorSelection.residentKey, 'required')
      assert.deepEqual(Array.from(seen.create.pubKeyCredParams, (x: { alg: number }) => x.alg), [-7, -257])
      assert.equal(seen.create.user.id.length, 16)
      assert.deepEqual(await s.call('authPoll', { pollId: start.pollId }), { status: 'added' })

      const signin = await s.call('authStart', {})
      const run = await runPage(s, `/passkey/signin?t=${ticketOf(signin.url)}`, browser(auth, seen))
      await run.click()
      assert.equal(run.state(), 'done', run.status())
      assert.match(run.status(), /Signed in/)
      assert.ok(run.posts[0]!.body.userHandle, 'the user handle comes along')
      assert.equal(seen.get.allowCredentials.length, 0)
      const done = await s.call('authPoll', { pollId: signin.pollId })
      assert.equal(done.status, 'done')
      if (done.status === 'done') assert.equal(done.me.player.handle, p.me.player.handle)
    })
  })
}

describe('the passkey page script', () => {
  it('sends nothing when the person cancels, and the same link still works after', async () => {
    const s = server()
    const p = await s.join()
    const auth = await softAuthenticator()
    const start = await p.call('passkeyStart', {})
    const path = `/passkey/add?t=${ticketOf(start.url)}`
    const cancelled = await runPage(s, path, { create: async () => { throw new DOMException('cancelled', 'NotAllowedError') } })
    await cancelled.click()
    assert.equal(cancelled.state(), 'error')
    assert.match(cancelled.status(), /Nothing was saved/)
    assert.equal(cancelled.disabled(), false, 'ready to try again')
    assert.equal(cancelled.posts.length, 0)
    assert.deepEqual(await counts(s.db, ['passkeys']), { passkeys: 0 })
    const again = await runPage(s, path, browser(auth))
    await again.click()
    assert.equal(again.state(), 'done', again.status())
  })

  it("shows the server's reason when a passkey does not check out, and stops on an expired link", async () => {
    const s = server()
    const auth = await softAuthenticator()
    const signin = await s.call('authStart', {})
    const run = await runPage(s, `/passkey/signin?t=${ticketOf(signin.url)}`, browser(auth))
    await run.click()
    assert.equal(run.state(), 'error')
    assert.match(run.status(), /not saved on this server/)
    assert.equal(run.disabled(), false, 'another passkey can be tried')

    const p = await s.join()
    const start = await p.call('passkeyStart', {})
    const page = await runPage(s, `/passkey/add?t=${ticketOf(start.url)}`, browser(auth))
    s.tick(11 * 60_000)
    await page.click()
    assert.equal(page.state(), 'error')
    assert.match(page.status(), /expired/)
    assert.equal(page.disabled(), true, 'an expired link cannot be retried')
  })

  it('tells a browser without passkeys so plainly, and does nothing', async () => {
    const s = server()
    const p = await s.join()
    const start = await p.call('passkeyStart', {})
    const run = await runPage(s, `/passkey/add?t=${ticketOf(start.url)}`, null)
    assert.equal(run.state(), 'error')
    assert.match(run.status(), /cannot use passkeys/)
    assert.equal(run.disabled(), true)
    assert.equal(run.posts.length, 0)
  })
})

// Browser access exercises the actual script and passkey verifier against the real API. No player
// data is in the public shell; bearer sessions remain tab-local and sign-out revokes just this one.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { b64urlDecode, b64urlEncode } from '../../server/src/game/passkeys.ts'
import { passkeyPage } from '../../server/src/game/auth.ts'
import { stmt } from '../../server/src/db.ts'
import { ACCOUNT_JS } from '../../server/static/account.ts'
import { SCRIPT_CSP } from '../../server/src/pages-html.ts'
import { softAuthenticator } from './passkeys-helpers.ts'
import type { Authenticator } from './passkeys-helpers.ts'
import { server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const ORIGIN = 'http://localhost:8787'
const buf = (s: string) => b64urlDecode(s).buffer as ArrayBuffer

async function saved(s: Server, p: Player, auth: Authenticator) {
  const start = await p.call('passkeyStart', {})
  const ticket = new URL(start.url).searchParams.get('t')!
  const options = await passkeyPage(s.db, { ticket, kind: 'add', now: s.now(), rpId: 'localhost' })
  assert.ok(options?.kind === 'add')
  const body = await auth.create(options.options, ORIGIN)
  assert.equal((await s.request('POST', '/passkey/add/finish', { body: { ticket, ...body } })).status, 200)
  await s.call('authPoll', { pollId: start.pollId })
}

class Node {
  children: Node[] = []
  ownText = ''
  hidden = false
  disabled = false
  value = ''
  href = ''
  className = ''
  attributes = new Map<string, string>()
  focused = false
  selected = false
  prevented = false
  listeners = new Map<string, (event: { preventDefault(): void }) => Promise<void> | void>()
  style = { setProperty() {} }
  get textContent(): string { return this.ownText + this.children.map(x => x.textContent).join(' ') }
  set textContent(text: string) { this.ownText = text; this.children = [] }
  get selectedOptions() { return [{ textContent: ({rating:'Rating',beaten:'Players beaten',duelWins:'Duel wins',species:'Species collected',mythics:'Mythics found',sales:'Market sales'} as Record<string,string>)[this.value] }] }
  append(...nodes: Node[]) { this.children.push(...nodes) }
  replaceChildren(...nodes: Node[]) { this.ownText = ''; this.children = nodes }
  setAttribute(key: string, value: string) { this.attributes.set(key, value) }
  removeAttribute(key: string) { this.attributes.delete(key) }
  focus() { this.focused = true }
  select() { this.selected = true }
  addEventListener(kind: string, fn: (event: { preventDefault(): void }) => Promise<void> | void) { this.listeners.set(kind, fn) }
  async act(kind = 'click') { await this.listeners.get(kind)?.({ preventDefault: () => { this.prevented = true } }) }
}

function browser(s: Server, auth: Authenticator, initialToken = '', after?: (path: string, response: Response) => Promise<void>) {
  const nodes = new Map<string, Node>()
  const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id)! }
  node('board').value = 'rating'; node('period').value = 'all'
  const storage = new Map<string, string>()
  if (initialToken) storage.set('spinlings-session',initialToken)
  node('username-form').hidden = true
  const requests: { path: string; authenticated: boolean; method: string; body: unknown }[] = []
  const context = {
    document: { getElementById: node, createElement: () => new Node() },
    window: { PublicKeyCredential: function () {} },
    navigator: { credentials: { get: async ({publicKey}: any) => {
      assert.ok(ArrayBuffer.isView(publicKey.challenge))
      const body = await auth.get({ ...publicKey, challenge: b64urlEncode(publicKey.challenge) }, ORIGIN)
      return { id: body.id, response: { clientDataJSON: buf(body.clientData), authenticatorData: buf(body.authenticator), signature: buf(body.signature), userHandle: body.userHandle ? buf(body.userHandle) : null } }
    } } },
    sessionStorage: { getItem: (k: string) => storage.get(k), setItem: (k: string,v: string) => {storage.set(k,v)}, removeItem: (k: string) => {storage.delete(k)} },
    fetch: async (path: string, options: any) => {
      assert.ok(path.startsWith('/') && !path.startsWith('//'))
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store')
      const token = options.headers.Authorization?.slice(7)
      const body = options.body === undefined ? undefined : JSON.parse(options.body)
      requests.push({ path, authenticated: !!token, method: options.method, body })
      const response = await s.request(options.method, path, { token, body, client: null })
      await after?.(path, response)
      return response
    },
    Uint8Array, ArrayBuffer, atob, btoa, Date: class extends Date { constructor() { super(s.now()) } },
  }
  vm.runInNewContext(ACCOUNT_JS, context)
  return { node, storage, requests }
}

describe('the private browser collection', () => {
  it('serves a no-store public shell with no session or player data, and enables only first-party API calls there', async () => {
    const s = server(); const p = await s.join()
    const response = await s.request('GET', '/account', { token: p.token })
    const page = await response.text()
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('content-security-policy'), SCRIPT_CSP)
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin')
    assert.match(page, /noindex/); assert.match(page, /src="\/static\/account.js"/)
    assert.ok(!page.includes(p.token) && !page.includes(p.me.player.handle))
    const boards = await (await s.request('GET','/boards')).text()
    assert.match(boards, /href="\/account"/)
    assert.doesNotMatch(ACCOUNT_JS, /localStorage|document\.cookie|console\.|https?:\/\//)
    assert.ok(Buffer.byteLength(ACCOUNT_JS) < 16 * 1024)
    assert.match(page, /id="username-change"[^>]*aria-controls="username-form"[^>]*aria-expanded="false"/)
    assert.match(page, /<label for="username">Username<\/label>/)
    assert.match(page, /id="username"[^>]*maxlength="40"[^>]*aria-describedby="username-rules username-note username-status"/)
    assert.match(page, /id="username-status" role="status" aria-live="polite"/)
    assert.match(page, /Your account and passkeys stay the same\./)
    assert.equal((await s.request('GET','/v1/me')).status, 401)
    assert.equal((await s.request('DELETE','/account/signout')).status, 401)
    assert.equal((await s.request('POST','/account/signin/start',{body:{playerId:p.id}})).status, 400)
  })

  for (const alg of ['ES256','RS256'] as const) it(`signs in with ${alg}, displays own cards and stats, switches board/period, and revokes only the browser session`, async () => {
    const s = server(); const p = await s.join(); const other = await s.join('opus')
    const auth = await softAuthenticator(alg); await saved(s,p,auth)
    await s.db.batch([stmt('UPDATE players SET duel_wins = 7, beaten = 4, first_finds = 2, market_sales = 3 WHERE id = ?',p.id)])
    const view = browser(s,auth)
    await view.node('signin').act()
    assert.equal(view.node('account-status').textContent,'')
    assert.equal(view.node('dashboard').hidden,false)
    assert.equal(view.node('myhandle').textContent,p.me.player.handle)
    assert.match(view.node('stats').textContent,/7 ⚔ Duel wins/)
    assert.match(view.node('stats').textContent,/4 Players beaten/)
    assert.match(view.node('stats').textContent,/2 First discoveries/)
    assert.match(view.node('stats').textContent,/3 Market sales/)
    assert.equal(view.node('teamcards').children.length,3)
    assert.equal(view.node('collection').children.length,3)
    assert.ok(view.storage.has('spinlings-session'))
    assert.ok(!view.node('myhandle').textContent.includes(other.me.player.handle))
    assert.ok(view.requests.some(r => r.path === '/v1/cards' && r.authenticated))
    view.node('board').value = 'species'; view.node('period').value = 'season'
    await view.node('board').act('change')
    assert.equal(view.node('publicboard').href,'/boards?board=species&period=season')
    assert.ok(view.requests.some(r => r.path === '/v1/leaderboards?board=species&period=season' && r.authenticated))
    const browserToken = view.storage.get('spinlings-session')!
    await view.node('signout').act()
    assert.equal(view.storage.size,0); assert.equal(view.node('dashboard').hidden,true)
    assert.equal(view.node('collection').children.length,0)
    assert.equal((await s.request('GET','/v1/me',{token:browserToken})).status,401)
    assert.equal((await p.call('me',{})).player.handle,p.me.player.handle)
    assert.equal((await p.call('devices',{})).sessions,1)
  })

  it('edits a chosen username inline, trims and saves it on the same account, and preserves the session and passkey', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    const view = browser(s,auth); await view.node('signin').act()
    const held = view.storage.get('spinlings-session')
    const owned = (await p.call('cards',{})).cards.map(c => c.id)
    await view.node('username-change').act()
    assert.equal(view.node('username-form').hidden,false)
    assert.equal(view.node('username-change').attributes.get('aria-expanded'),'true')
    assert.equal(view.node('username').value,p.me.player.handle)
    assert.ok(view.node('username').focused && view.node('username').selected)
    view.node('username').value = 'not-saved'
    await view.node('username-cancel').act()
    assert.equal(view.node('username-form').hidden,true)
    assert.equal(view.node('myhandle').textContent,p.me.player.handle)
    await view.node('username-change').act()
    view.node('username').value = ' Cozy_Heron-42 '
    await view.node('username-form').act('submit')
    assert.equal(view.node('username-form').prevented,true)
    assert.equal(view.node('myhandle').textContent,'cozy_heron-42')
    assert.equal(view.node('username-form').hidden,true)
    assert.equal(view.node('username-status').textContent,'Username saved.')
    assert.equal(view.node('username-change').disabled,true)
    assert.match(view.node('username-note').textContent,/2026-10-09 UTC.*account and passkeys stay the same/)
    assert.deepEqual(view.requests.filter(r => r.path === '/v1/me/handle'),[{path:'/v1/me/handle',authenticated:true,method:'POST',body:{handle:'Cozy_Heron-42'}}])
    assert.ok(view.storage.get('spinlings-session') === held)
    assert.equal((await p.call('me',{})).player.handle,'cozy_heron-42')
    assert.deepEqual((await p.call('cards',{})).cards.map(c => c.id),owned)
    const devices = await p.call('devices',{}); assert.equal(devices.sessions,2); assert.equal(devices.passkeys,1)
    await view.node('refresh').act()
    assert.equal(view.node('myhandle').textContent,'cozy_heron-42')
    assert.equal(view.node('username-change').disabled,true)
    s.tick(7*86_400_000)
    await view.node('refresh').act()
    assert.equal(view.node('username-change').disabled,false)
  })

  it('validates names locally and leaves a correctable form after collision, reserved-name and stale cooldown errors', async () => {
    const s = server(); const p = await s.join(); const other = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    const view = browser(s,auth); await view.node('signin').act(); await view.node('username-change').act()
    for (const value of ['', 'two words', 'x'.repeat(41), 'møss']) {
      view.node('username').value = value; await view.node('username-form').act('submit')
      assert.match(view.node('username-status').textContent,/1–40 letters, numbers, _ or -/)
      assert.equal(view.node('username').attributes.get('aria-invalid'),'true')
    }
    assert.equal(view.requests.filter(r => r.path === '/v1/me/handle').length,0)
    await view.node('username').act('input')
    assert.equal(view.node('username').attributes.has('aria-invalid'),false)
    view.node('username').value = other.me.player.handle; await view.node('username-form').act('submit')
    assert.equal(view.node('username-status').textContent,'That username is taken')
    assert.equal(view.node('username-form').hidden,false)
    assert.equal(view.node('username-save').disabled,false)
    assert.equal(view.node('refresh').disabled,false)
    view.node('username').value = 'admin'; await view.node('username-form').act('submit')
    assert.equal(view.node('username-status').textContent,'Choose another username')
    await p.call('rerollHandle',{handle:'other-side'})
    view.node('username').value = 'new-side'; await view.node('username-form').act('submit')
    assert.equal(view.node('username-status').textContent,'A new handle once a week')
    assert.equal(view.node('username-form').hidden,false)
    assert.equal((await p.call('me',{})).player.handle,'other-side')
    await view.node('username-cancel').act(); await view.node('refresh').act()
    assert.equal(view.node('myhandle').textContent,'other-side')
    assert.equal(view.node('username-change').disabled,true)
  })

  it('sends one rename while busy and avoids a concurrent refresh overwriting its accepted response', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    let release!: () => void, reached!: () => void
    const heldResponse = new Promise<void>(resolve => {release = resolve}), atResponse = new Promise<void>(resolve => {reached = resolve})
    const view = browser(s,auth,'',async path => {if (path === '/v1/me/handle') {reached(); await heldResponse}})
    await view.node('signin').act(); await view.node('username-change').act()
    view.node('username').value = 'patient-heron'
    const saving = view.node('username-form').act('submit'); await atResponse
    for (const id of ['username','username-save','username-cancel','refresh']) assert.equal(view.node(id).disabled,true)
    const reads = view.requests.filter(r => r.path === '/v1/me').length
    await view.node('username-form').act('submit'); await view.node('refresh').act()
    assert.equal(view.requests.filter(r => r.path === '/v1/me/handle').length,1)
    assert.equal(view.requests.filter(r => r.path === '/v1/me').length,reads)
    release(); await saving
    assert.equal(view.node('myhandle').textContent,'patient-heron')
    assert.equal(view.node('refresh').disabled,false)
    await view.node('refresh').act()
    assert.equal(view.node('myhandle').textContent,'patient-heron')
  })

  it('ignores a rename response after sign-out and can use the unchanged passkey for the renamed account', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    let release!: () => void, reached!: () => void
    const heldResponse = new Promise<void>(resolve => {release = resolve}), atResponse = new Promise<void>(resolve => {reached = resolve})
    const view = browser(s,auth,'',async path => {if (path === '/v1/me/handle') {reached(); await heldResponse}})
    await view.node('signin').act(); await view.node('username-change').act(); view.node('username').value = 'same-passkey'
    const saving = view.node('username-form').act('submit'); await atResponse
    await view.node('signout').act()
    release(); await saving
    assert.equal(view.storage.size,0)
    assert.equal(view.node('dashboard').hidden,true)
    assert.equal(view.node('username-form').hidden,true)
    assert.equal(view.node('username-status').textContent,'')
    assert.equal(view.node('myhandle').textContent,'')
    assert.equal(view.node('account-status').textContent,'Signed out of this browser tab.')
    assert.equal(view.node('refresh').disabled,false)
    await view.node('signin').act()
    assert.equal(view.node('dashboard').hidden,false)
    assert.equal(view.node('myhandle').textContent,'same-passkey')
    assert.equal(view.node('username-change').disabled,true)
    assert.equal((await p.call('devices',{})).passkeys,1)
  })

  it('does not deliver a session for an unverified assertion, and an expired browser flow cannot finish', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    const response = await s.request('POST','/account/signin/start',{body:{}})
    const start = await response.json() as any
    assert.equal((await s.call('authPoll',{pollId:start.pollId})).status,'pending')
    const body = await auth.get(start.options,ORIGIN,{origin:'https://elsewhere.invalid'})
    assert.equal((await s.request('POST','/passkey/signin/finish',{body:{ticket:start.ticket,...body}})).status,400)
    s.tick(10*60_000+1)
    assert.equal((await s.request('POST','/passkey/signin/finish',{body:{ticket:start.ticket,...body}})).status,410)
    assert.equal((await p.call('devices',{})).sessions,1)
  })

  it('serves small public creature art without spending the profile-lookup bucket', async () => {
    const s = server(); const p = await s.join(); const cards = (await p.call('cards',{})).cards
    for (let i = 0; i < 80; i++) {
      const response = await s.request('GET',`/c/${cards[i % cards.length]!.id}/art.svg`)
      assert.equal(response.status,200)
      assert.equal(response.headers.get('content-type'),'image/svg+xml')
      const svg = await response.text()
      assert.match(svg,/viewBox="0 0 16 16"/)
      assert.doesNotMatch(svg,/script|player|raisedIn|mintedAt|tiredUntil/)
    }
    assert.equal((await s.request('GET','/c/unknown/art.svg')).status,404)
  })

  it('returns an expired tab session to sign-in without leaving a loading message or disabled refresh', async () => {
    const s = server(); const view = browser(s,await softAuthenticator(),'expired-session')
    for (let i = 0; i < 50 && view.storage.size; i++) await new Promise(resolve => setTimeout(resolve,2))
    assert.equal(view.storage.size,0)
    assert.equal(view.node('dashboard').hidden,true)
    assert.equal(view.node('signedout').hidden,false)
    assert.equal(view.node('refresh').disabled,false)
    assert.equal(view.node('account-status').textContent,'Sign in again to see your collection.')
  })
})

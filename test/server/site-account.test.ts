// Browser access exercises the actual script and passkey verifier against the real API. No player
// data is in the public shell; bearer sessions remain tab-local and sign-out revokes just this one.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { b64urlDecode, b64urlEncode } from '../../server/src/game/passkeys.ts'
import { passkeyPage } from '../../server/src/game/auth.ts'
import { stmt } from '../../server/src/db.ts'
import { ACCOUNT_HASH, ACCOUNT_JS } from '../../server/static/account.ts'
import { CARD_HELP } from '../../server/src/card-guide.ts'
import { cardName } from '../../plugin/hooks/core/cards.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import type { NewCard } from '../../plugin/hooks/core/types.ts'
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

type BrowserEvent = { preventDefault(): void; key?: string; pointerType?: string; target?: Node }

class Node {
  tagName: string
  constructor(tagName = '') { this.tagName = tagName }
  children: Node[] = []
  id = ''
  ownText = ''
  hidden = false
  disabled = false
  value = ''
  href = ''
  title = ''
  className = ''
  attributes = new Map<string, string>()
  focused = false
  selected = false
  prevented = false
  listeners = new Map<string, (event: BrowserEvent) => Promise<void> | void>()
  style = { setProperty() {} }
  get textContent(): string { return this.ownText + this.children.map(x => x.textContent).join(' ') }
  set textContent(text: string) { this.ownText = text; this.children = [] }
  get selectedOptions() { return [{ textContent: ({rating:'Rating',beaten:'Players beaten',duelWins:'Duel wins',species:'Species collected',mythics:'Mythics found',sales:'Market sales'} as Record<string,string>)[this.value] }] }
  append(...nodes: Node[]) { this.children.push(...nodes) }
  replaceChildren(...nodes: Node[]) { this.ownText = ''; this.children = nodes }
  setAttribute(key: string, value: string) { this.attributes.set(key, value) }
  getAttribute(key: string) { return this.attributes.get(key) ?? null }
  removeAttribute(key: string) { this.attributes.delete(key) }
  focus() { this.focused = true }
  select() { this.selected = true }
  contains(target?: Node): boolean { return target === this || this.children.some(child => child.contains(target)) }
  addEventListener(kind: string, fn: (event: BrowserEvent) => Promise<void> | void) { this.listeners.set(kind, fn) }
  async act(kind = 'click', extra: { key?: string; pointerType?: string; target?: Node } = {}) { await this.listeners.get(kind)?.({ target: this, ...extra, preventDefault: () => { this.prevented = true } }) }
}

const descendants = (node: Node): Node[] => node.children.flatMap(child => [child, ...descendants(child)])
const shownIds = (node: Node) => node.children.map(c => c.attributes.get('data-card-id'))

async function give(s: Server, p: Player, cards: NewCard[]) {
  const minted = await mintCards({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) },p.id,cards)
  await s.db.batch(minted.stmts)
  return minted.cards
}

type Sharing = { share?: (data: { url: string }) => Promise<void>; clipboard?: { writeText(text: string): Promise<void> } }

function browser(s: Server, auth: Authenticator, initialToken = '', after?: (path: string, response: Response) => Promise<void>, sharing: Sharing = {}) {
  const nodes = new Map<string, Node>()
  const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id)! }
  node('board').value = 'rating'; node('period').value = 'all'; node('sort').value = 'newest'
  node('account').setAttribute('data-card-help',JSON.stringify(CARD_HELP))
  const storage = new Map<string, string>()
  if (initialToken) storage.set('spinlings-session',initialToken)
  node('username-form').hidden = true
  const requests: { path: string; authenticated: boolean; method: string; body: unknown }[] = []
  const document = new Node('document')
  const context = {
    document: { getElementById: node, createElement: (tag: string) => new Node(tag), addEventListener: document.addEventListener.bind(document) },
    window: { PublicKeyCredential: function () {} },
    location: { origin: ORIGIN, href: ORIGIN+'/account?private=discarded#discarded' },
    navigator: { ...sharing, credentials: { get: async ({publicKey}: any) => {
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
  return { node, storage, requests, document }
}

describe('the private browser collection', () => {
  it('serves a no-store public shell with no session or player data, and enables only first-party API calls there', async () => {
    const s = server(); const p = await s.join()
    const response = await s.request('GET', '/account', { token: p.token })
    const page = await response.text()
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('content-security-policy'), SCRIPT_CSP)
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin')
    assert.match(page, /noindex/); assert.ok(page.includes(`src="/static/account.js?v=${ACCOUNT_HASH}"`))
    assert.ok(!page.includes(p.token) && !page.includes(p.me.player.handle))
    const boards = await (await s.request('GET','/boards')).text()
    assert.match(boards, /href="\/account"/)
    assert.doesNotMatch(ACCOUNT_JS, /localStorage|document\.cookie|console\.|https?:\/\//)
    assert.ok(Buffer.byteLength(ACCOUNT_JS) < 24 * 1024, 'the standalone account browser script stays bounded')
    assert.match(page, /id="card-search" role="search"/)
    for (const id of ['q','family','rarity','sort','trait','finish','scope']) assert.ok(page.includes(`for="${id}"`))
    assert.match(page, /id="q"[^>]*type="search"[^>]*maxlength="40"/)
    assert.match(page, /<details class="morefilters" id="morefilters"><summary>More filters<\/summary>/)
    assert.match(page, /id="collection-status" role="status" aria-live="polite"/)
    assert.match(page, /id="username-change"[^>]*aria-controls="username-form"[^>]*aria-expanded="false"/)
    assert.match(page, /<label for="username">Username<\/label>/)
    assert.match(page, /id="username"[^>]*maxlength="40"[^>]*aria-describedby="username-rules username-note username-status"/)
    assert.match(page, /id="username-status" role="status" aria-live="polite"/)
    assert.match(page, /id="profile-share">↗ Share profile<\/button>/)
    assert.ok(page.includes('data-card-help="{&quot;stats&quot;:'), 'card help is safely escaped public data on the shell')
    assert.doesNotMatch(page, /Your account and passkeys stay the same|Once a week/)
    assert.match(page, /role="tablist" aria-label="Your collection"/)
    for (const id of ['collection','team','stats']) assert.ok(page.includes(`role="tabpanel" aria-labelledby="tab-${id}"`))
    assert.equal((await s.request('GET','/v1/me')).status, 401)
    assert.equal((await s.request('DELETE','/account/signout')).status, 401)
    assert.equal((await s.request('POST','/account/signin/start',{body:{playerId:p.id}})).status, 400)
  })

  it('shares only the current public profile URL, including after a username change, without requests or session details', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    const shares: {url:string}[] = [], copied: string[] = []
    const view = browser(s,auth,'',undefined,{share:async data => {shares.push({...data})},clipboard:{writeText:async text => {copied.push(text)}}})
    await view.node('profile-share').act()
    assert.deepEqual(shares,[])
    await view.node('signin').act()
    const n = view.requests.length
    await view.node('profile-share').act()
    assert.equal(view.requests.length,n)
    assert.deepEqual(shares,[{url:ORIGIN+'/u/'+encodeURIComponent(p.me.player.handle)}])
    await view.node('username-change').act(); view.node('username').value = 'Share_Me-42'; await view.node('username-form').act('submit')
    const afterRename = view.requests.length
    await view.node('profile-share').act()
    assert.equal(view.requests.length,afterRename)
    assert.deepEqual(shares[1],{url:ORIGIN+'/u/share_me-42'})
    assert.deepEqual(copied,[])
    for (const share of shares) assert.ok(!JSON.stringify(share).includes(view.storage.get('spinlings-session')!))
    await view.node('signout').act(); await view.node('profile-share').act()
    assert.equal(shares.length,2)
  })

  for (const native of [false,true]) it(`copies the public profile when native sharing is ${native?'refused':'unavailable'}`, async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    const copied: string[] = []
    const view = browser(s,auth,'',undefined,{...(native?{share:async () => {throw new Error('Unavailable')}}:{}),clipboard:{writeText:async text => {copied.push(text)}}})
    await view.node('signin').act(); const n = view.requests.length
    await view.node('profile-share').act()
    assert.deepEqual(copied,[ORIGIN+'/u/'+encodeURIComponent(p.me.player.handle)])
    assert.equal(view.node('account-status').textContent,'Profile link copied.')
    assert.equal(view.requests.length,n)
  })

  it('honors share cancellation and offers a public link when the clipboard is unavailable', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    let native = true, copies = 0
    const view = browser(s,auth,'',undefined,{share:async () => {const e = new Error('Cancelled'); e.name = native?'AbortError':'NotAllowedError'; throw e},clipboard:{writeText:async () => {copies++; throw new Error('Refused')}}})
    await view.node('signin').act(); await view.node('profile-share').act()
    assert.equal(copies,0); assert.equal(view.node('account-status').textContent,'')
    native = false; await view.node('profile-share').act()
    assert.equal(copies,1)
    assert.equal(view.node('account-status').textContent,'Copy your profile link: '+ORIGIN+'/u/'+encodeURIComponent(p.me.player.handle))
  })

  it('does not replace sign-out feedback when an earlier profile copy completes', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    let release!: () => void, reached!: () => void
    const pending = new Promise<void>(resolve => {release = resolve}), copying = new Promise<void>(resolve => {reached = resolve})
    const view = browser(s,auth,'',undefined,{clipboard:{writeText:async () => {reached(); await pending}}})
    await view.node('signin').act()
    const sharing = view.node('profile-share').act(); await copying
    await view.node('signout').act(); release(); await sharing
    assert.equal(view.node('account-status').textContent,'Signed out of this browser tab.')
    assert.equal(view.node('dashboard').hidden,true)
  })

  it('starts in Collection and changes sections with keyboard tabs without losing collection filters or refreshing data', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    const view = browser(s,auth); await view.node('signin').act()
    assert.equal(view.node('panel-collection').hidden,false)
    assert.equal(view.node('panel-team').hidden,true)
    assert.equal(view.node('panel-stats').hidden,true)
    assert.equal(view.node('tab-collection').attributes.get('aria-selected'),'true')
    for (const balance of view.node('mybalance').children) {
      assert.ok(balance.title)
      assert.equal(balance.attributes.get('role'),'group')
      assert.ok(balance.attributes.get('aria-label')?.includes(balance.title))
      assert.ok(!balance.textContent.includes(balance.title),'balance explanations stay out of the permanent summary')
    }
    view.node('family').value = 'opus'; await view.node('family').act('change')
    const ids = shownIds(view.node('collection')), requests = view.requests.length
    await view.node('tab-collection').act('keydown',{key:'ArrowRight'})
    assert.equal(view.node('panel-team').hidden,false)
    assert.equal(view.node('panel-collection').hidden,true)
    assert.equal(view.node('tab-team').attributes.get('tabindex'),'0')
    assert.equal(view.node('tab-team').focused,true)
    await view.node('tab-team').act('keydown',{key:'End'})
    assert.equal(view.node('panel-stats').hidden,false)
    assert.equal(view.node('panel-team').hidden,true)
    await view.node('tab-stats').act('keydown',{key:'Home'})
    assert.equal(view.node('panel-collection').hidden,false)
    assert.equal(view.node('family').value,'opus')
    assert.deepEqual(shownIds(view.node('collection')),ids)
    assert.equal(view.requests.length,requests,'section switching uses already loaded data')
    await view.node('tab-stats').act(); await view.node('refresh').act()
    assert.equal(view.node('panel-stats').hidden,false,'refresh preserves the selected section')
    await view.node('signout').act()
    assert.equal(view.node('panel-collection').hidden,false)
    assert.equal(view.node('panel-stats').hidden,true)
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
    assert.ok(view.requests.some(r => r.path === '/account/cards?sort=newest' && r.authenticated))
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

  it('shows combat stats immediately and explains attributes and real trait effects by pointer, focus and tap', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    const [target] = await give(s,p,[{...mintFor('opus','epic',rngFromSeed('browser-help'),s.now(),'pack'),traits:['sleepy','quickCharge'],genes:[0,5,10,15]}])
    const view = browser(s,auth); await view.node('signin').act()
    const card = view.node('collection').children.find(c => c.attributes.get('data-card-id') === target!.id)!
    assert.ok(card)
    const face = card.children[0], plaque = card.children[1]
    assert.match(face.className,/^cf/)
    const stats = plaque.children[0]
    for (const [i,key] of (['hp','atk','def','spd'] as const).entries()) assert.equal(stats.children[i].children[0].attributes.get('aria-label'),`${CARD_HELP.stats[key].label} ${target!.stats[key]}`)
    const attack = stats.children[1], button = attack.children[0], tip = attack.children[1]
    assert.equal(tip.textContent,CARD_HELP.stats.atk.text)
    assert.equal(tip.attributes.get('role'),'tooltip')
    assert.equal(button.attributes.get('aria-describedby'),tip.id)
    assert.equal(tip.hidden,true)
    await button.act('pointerenter',{pointerType:'mouse'}); assert.equal(tip.hidden,false)
    await attack.act('pointerleave'); assert.equal(tip.hidden,true)
    await button.act('focus'); assert.equal(tip.hidden,false)
    await attack.act('keydown',{key:'Escape'}); assert.equal(tip.hidden,true)
    await button.act(); assert.equal(tip.hidden,false)
    await button.act(); assert.equal(tip.hidden,true)
    await button.act('pointerenter',{pointerType:'mouse'}); await view.document.act('keydown',{key:'Escape',target:view.node('q')})
    assert.equal(tip.hidden,true,'Escape dismisses pointer help even when focus is elsewhere')
    assert.equal(view.document.prevented,true)
    await button.act(); await view.document.act('pointerdown',{target:tip})
    assert.equal(tip.hidden,false,'touching the tooltip itself keeps it available to read')
    await view.document.act('pointerdown',{target:view.node('q')})
    assert.equal(tip.hidden,true,'touching outside dismisses a pinned tooltip')
    await button.act(); await button.act('blur')
    assert.equal(tip.hidden,true,'Tab to an unrelated link dismisses pinned help')
    assert.ok(plaque.textContent.includes(CARD_HELP.traits.sleepy.text))
    assert.ok(plaque.textContent.includes(CARD_HELP.traits.quickCharge.text))
    assert.ok(plaque.textContent.includes(CARD_HELP.genes))
    const more = plaque.children.find(n => n.tagName === 'details')!
    assert.ok(more.textContent.includes(CARD_HELP.damage),'damage explanations stay inside More about this card')
    const genes = more.children.find(n => n.tagName === 'dl')!
    assert.deepEqual(genes.children.map(n => n.textContent),['HP gene 0/15','Attack gene 5/15','Defense gene 10/15','Speed gene 15/15'])
    assert.match(plaque.textContent,/Fires automatically after 1 normal attack\./)
    assert.doesNotMatch(plaque.textContent,/Stats & traits|Damage \d/)
    const sleepy = descendants(plaque).find(n => n.tagName === 'button' && n.textContent === 'Sleepy')!
    await button.act(); await sleepy.act('focus')
    assert.equal(tip.hidden,true,'opening another explanation closes the first')
  })

  it('names Mythics as one of one and does not call a bound pack card a starter', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    const [bound, mythic] = await give(s,p,[
      mintFor('sonnet','rare',rngFromSeed('bound-pack'),s.now(),'pack',true),
      generateMythic({seed:'browser-mythic',dna:41,now:s.now(),origin:'catch'}),
    ])
    const view = browser(s,auth); await view.node('signin').act()
    const shown = (id: string) => view.node('collection').children.find(c => c.attributes.get('data-card-id') === id)!
    assert.match(shown(bound!.id).textContent,/Stays with you/)
    assert.doesNotMatch(shown(bound!.id).textContent,/Starter/)
    assert.match(shown(p.me.player.team[0]!).textContent,/Starter · stays with you/)
    const face = shown(mythic!.id).children[0]!
    assert.match(face.textContent,/Mythic · 1 of 1/)
    assert.doesNotMatch(face.textContent,/Legendary/)
  })

  it('searches and sorts the whole collection, keeps the complete team, and resets filters without sending search on each keypress', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    const ordinary = Array.from({length:36},(_,i) => mintFor('haiku','common',rngFromSeed('browse/'+i),s.now(),'pack'))
    const [target] = await give(s,p,[{...mintFor('opus','legendary',rngFromSeed('browse-target'),s.now(),'pack'),level:10,stage:3,genes:[15,15,15,15],traits:['sleepy','glassHeart']}])
    s.tick(86_400_000); await give(s,p,ordinary)
    const view = browser(s,auth); await view.node('signin').act()
    assert.equal(view.node('collection').children.length,24)
    assert.ok(!shownIds(view.node('collection')).includes(target!.id))
    assert.equal(view.node('teamcards').children.length,3)
    assert.match(view.node('tab-collection').textContent,/40/)
    assert.match(view.node('collection-status').textContent,/24 of 40 matching cards/)
    const before = view.requests.length
    view.node('q').value = cardName(target!); await view.node('q').act('input')
    assert.equal(view.requests.length,before,'search waits for Enter or Search')
    await view.node('card-search').act('submit')
    assert.equal(view.node('card-search').prevented,true)
    assert.deepEqual(shownIds(view.node('collection')),[target!.id])
    view.node('family').value = 'opus'; view.node('rarity').value = 'legendary'; view.node('trait').value = 'sleepy'; view.node('finish').value = 'foil'
    await view.node('finish').act('change')
    assert.deepEqual(shownIds(view.node('collection')),[target!.id])
    assert.equal(view.node('teamcards').children.length,3,'family and trait filters do not hide the real team')
    view.node('trait').value = 'sturdy'; await view.node('trait').act('change')
    assert.equal(view.node('collection').children.length,0)
    assert.match(view.node('collection-status').textContent,/No matching cards/)
    await view.node('filters-reset').act()
    assert.equal(view.node('q').value,''); assert.equal(view.node('trait').value,''); assert.equal(view.node('sort').value,'newest')
    view.node('sort').value = 'atk'; await view.node('sort').act('change')
    assert.equal(shownIds(view.node('collection'))[0],target!.id,'highest Attack includes cards beyond the first default page')
    view.node('scope').value = 'team'; await view.node('scope').act('change')
    assert.deepEqual(new Set(shownIds(view.node('collection'))),new Set(p.me.player.team))
    assert.equal(view.node('more').hidden,true)
    assert.ok(view.requests.filter(r => r.path.startsWith('/account/cards')).every(r => r.authenticated && !r.path.includes(p.token)))
  })

  it('pages without duplicates, retries from the first page after inventory changes, and ignores an old page after a filter change', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    await give(s,p,Array.from({length:50},(_,i)=>mintFor(i%2?'opus':'haiku','rare',rngFromSeed('pages/'+i),s.now(),'pack')))
    let release!: () => void, reached!: () => void, hold = false
    const waiting = new Promise<void>(resolve=>{release=resolve}), ready = new Promise<void>(resolve=>{reached=resolve})
    const view = browser(s,auth,'',async path => {if (hold && path.includes('after=')) {hold=false; reached(); await waiting}})
    await view.node('signin').act(); await view.node('more').act()
    assert.equal(view.node('collection').children.length,48)
    assert.equal(new Set(shownIds(view.node('collection'))).size,48)
    await give(s,p,[mintFor('fable','epic',rngFromSeed('changed-page'),s.now(),'pack')])
    await view.node('more').act()
    assert.equal(view.node('collection').children.length,24,'changed cursor version reloads the beginning')
    assert.match(view.node('tab-collection').textContent,/54/)
    hold = true
    const oldPage = view.node('more').act(); await ready
    view.node('family').value='fable'; await view.node('family').act('change')
    const filtered = shownIds(view.node('collection'))
    release(); await oldPage
    assert.deepEqual(shownIds(view.node('collection')),filtered)
    assert.equal(view.node('more').hidden,true)
    assert.equal(view.node('more').disabled,false)
    assert.equal(view.node('collection').attributes.get('aria-busy'),'false')
  })

  it('ignores an old filtered response after sign-out and clears private search terms', async () => {
    const s = server(); const p = await s.join(); const auth = await softAuthenticator(); await saved(s,p,auth)
    let release!: () => void, reached!: () => void
    const waiting = new Promise<void>(resolve=>{release=resolve}), ready = new Promise<void>(resolve=>{reached=resolve})
    const view = browser(s,auth,'',async path => {if (path.includes('q=')) {reached(); await waiting}})
    await view.node('signin').act(); view.node('q').value = 'Moss'
    const searching = view.node('card-search').act('submit'); await ready
    await view.node('signout').act(); release(); await searching
    assert.equal(view.node('q').value,'')
    assert.equal(view.node('collection').children.length,0)
    assert.equal(view.node('teamcards').children.length,0)
    assert.equal(view.node('collection-status').textContent,'')
    assert.equal(view.node('dashboard').hidden,true)
    assert.equal(view.node('collection').attributes.get('aria-busy'),'false')
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
    assert.equal(view.node('username-note').textContent,'Next change: 2026-10-09 UTC.')
    assert.equal(view.node('username-change').title,'Change username on 2026-10-09 UTC')
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

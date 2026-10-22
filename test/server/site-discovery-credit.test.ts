// Discovery credit belongs to the species or unique Mythic, not its present owner or every copy's
// First Discovered stamp. Website-only metadata must keep the released card contract unchanged.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { mintCard, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { parseCard } from '../../plugin/hooks/core/schemas.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import type { Card, NewCard } from '../../plugin/hooks/core/types.ts'
import { seasonOf } from '../../plugin/hooks/core/world.ts'
import type { AccountCardsResponse } from '../../server/src/account-cards.ts'
import { CARD_HELP } from '../../server/src/card-guide.ts'
import { stmt } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { b64urlDecode, b64urlEncode } from '../../server/src/game/passkeys.ts'
import { lots } from '../../server/src/pages-boards.ts'
import { cardTile, discoveryCredit, fullCard } from '../../server/src/pages-html.ts'
import { ACCOUNT_JS } from '../../server/static/account.ts'
import { server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

async function give(s: Server, player: Player, fresh: NewCard): Promise<Card> {
  const minted = await mintCards({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }, player.id, [fresh])
  await s.db.batch(minted.stmts)
  return minted.cards[0]!
}

async function copies() {
  const s = server(), finder = await s.join(), owner = await s.join('opus')
  const found = new Set((await s.db.all<{ species: string }>('SELECT species FROM firsts')).map(row => row.species))
  const species = seasonSpecies(seasonOf(s.now())).find(form => !found.has(form.id))!
  assert.ok(species, 'a species not already found by the starter rolls')
  const fresh = mintCard({ species, rarity: 'common', shiny: false, dna: 12, now: s.now(), origin: 'pack' })
  const first = await give(s, finder, fresh), copy = await give(s, owner, fresh)
  assert.equal(first.firstFind, true); assert.equal(copy.firstFind, undefined)
  return { s, finder, owner, first, copy }
}

async function account(s: Server, owner: Player): Promise<AccountCardsResponse> {
  const response = await s.request('GET', '/account/cards', { token: owner.token, client: null })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  return response.json() as Promise<AccountCardsResponse>
}

function noNestedLinks(markup: string) {
  let depth = 0
  for (const [tag] of markup.matchAll(/<\/?a\b[^>]*>/g)) {
    depth += tag.startsWith('</') ? -1 : 1
    assert.ok(depth >= 0 && depth <= 1, 'card, seller and finder links are separate semantic anchors')
  }
  assert.equal(depth, 0)
}

describe('website discovery credit', () => {
  it('links a species finder on later copies without giving them a First Discovered stamp', () => {
    const c = toBattleCard({ ...mintCard({ species: seasonSpecies(1)[0]!, rarity: 'common', shiny: false, dna: 3, now: 0, origin: 'pack' }), id: 'a'.repeat(26) })
    const credits = new Map([[c.id, { kind: 'species' as const, handle: 'first-trainer-42' }]])
    for (const markup of [cardTile(c, { link: true, credits }).__html, fullCard(c, { credits }).__html,
      lots([{ id: 'b'.repeat(26), card: c, seller: 'present-owner', price: 25, day: '2026-10-02', state: 'open' }], [], { credits }).__html]) {
      assert.match(markup, /First discovered by <a href="\/u\/first-trainer-42">first-trainer-42<\/a>/)
      assert.doesNotMatch(markup, /First found by a trainer|cf-stamps/)
      noNestedLinks(markup)
    }
    const stamped = cardTile({ ...c, firstFind: true }, { link: true, credits }).__html
    assert.match(stamped, /First Discovered/)
    assert.doesNotMatch(stamped, /First Discovered stamp/)
    assert.match(stamped, /First discovered by <a/)
  })

  it('uses current resolved Mythic credit, with one founder link outside the card', () => {
    const c = toBattleCard({ ...generateMythic({ seed: 'safe-display-mythic', dna: 3, now: 0 }), id: 'b'.repeat(26) })
    c.form = { ...c.form!, discoveredBy: 'stale-finder' }
    const credits = new Map([[c.id, { kind: 'mythic' as const, handle: 'current-finder' }]])
    for (const markup of [cardTile(c, { link: true, credits }).__html, fullCard(c, { credits }).__html]) {
      assert.doesNotMatch(markup, /stale-finder/)
      assert.equal(markup.split('href="/u/current-finder"').length, 2)
      assert.match(markup, /Mythic, 1 of 1/)
      noNestedLinks(markup)
    }
    assert.match(discoveryCredit({ kind: 'mythic', handle: null }).__html, /First discovered by a trainer/)
    assert.equal(discoveryCredit().__html, '')
    const invalid = discoveryCredit({ kind: 'species', handle: '"><script>alert(1)</script>' }).__html
    assert.doesNotMatch(invalid, /href=|<script|alert/)
    assert.match(invalid, /a trainer/)
  })

  it('adds only public credit metadata to the authenticated browser envelope, never the v1 card', async () => {
    const { s, finder, owner, copy } = await copies()
    const data = await account(s, owner)
    assert.deepEqual(data.discoveryCredits[copy.id], { handle: finder.me.player.handle, kind: 'species' })
    for (const credit of Object.values(data.discoveryCredits)) assert.deepEqual(Object.keys(credit).sort(), ['handle', 'kind'])
    for (const card of [...data.cards, ...data.team]) assert.deepEqual(parseCard(card), card)
    const legacy = await owner.call('cards')
    assert.ok(!JSON.stringify(legacy).includes('discoveryCredits'))
    const encoded = JSON.stringify(data.discoveryCredits)
    for (const privateValue of [finder.id, finder.token, owner.id, owner.token]) assert.ok(!encoded.includes(privateValue))
    assert.equal((await s.request('GET', '/account/cards', { client: null })).status, 401)
  })

  it('unlinks species discovery after a rename or deletion, including another owner’s copy', async () => {
    const { s, finder, owner, copy } = await copies()
    const before = finder.me.player.handle
    const { handle: renamed } = await finder.call('rerollHandle', {})
    let data = await account(s, owner)
    assert.deepEqual(data.discoveryCredits[copy.id], { handle: null, kind: 'species' })
    assert.ok(!JSON.stringify(data.discoveryCredits).includes(before) && !JSON.stringify(data.discoveryCredits).includes(renamed))
    await finder.call('deleteMe')
    data = await account(s, owner)
    assert.deepEqual(data.discoveryCredits[copy.id], { handle: null, kind: 'species' })
  })

  for (const action of ['rename', 'delete'] as const) it(`invalidates another owner's browser cursor when a species finder ${action === 'rename' ? 'renames' : 'deletes their account'}`, async () => {
    const { s, finder, owner, copy } = await copies()
    const species = seasonSpecies(copy.season).find(form => form.id === copy.species)!
    const fresh = mintCard({ species, rarity: 'common', shiny: false, dna: 17, now: s.now(), origin: 'pack' })
    const minted = await mintCards({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }, owner.id, Array.from({ length: 24 }, () => fresh))
    await s.db.batch(minted.stmts)
    const first = await account(s, owner)
    assert.ok(first.next)
    const wire = await owner.call('cards')
    assert.ok(Object.values(first.discoveryCredits).some(credit => credit.handle === finder.me.player.handle))
    if (action === 'rename') await finder.call('rerollHandle', {})
    else await finder.call('deleteMe')
    const outdated = await s.request('GET', '/account/cards?after=' + first.next, { token: owner.token, client: null })
    assert.equal(outdated.status, 409, 'the browser restarts rather than retaining attribution from loaded pages')
    const current = await account(s, owner)
    assert.equal(current.version, first.version, 'ordinary discovery metadata never changes the released card version')
    assert.deepEqual(await owner.call('cards'), wire, 'the v1 collection remains byte-for-byte equivalent')
    assert.ok(!Object.values(current.discoveryCredits).some(credit => credit.handle === finder.me.player.handle))
    assert.deepEqual(current.discoveryCredits[current.cards.find(card => card.species === copy.species)!.id], { handle: null, kind: 'species' })
  })

  it('restarts a valid legacy browser cursor without treating it as a v1 card change', async () => {
    const { s, owner, copy } = await copies()
    const species = seasonSpecies(copy.season).find(form => form.id === copy.species)!
    const fresh = mintCard({ species, rarity: 'common', shiny: false, dna: 18, now: s.now(), origin: 'pack' })
    const minted = await mintCards({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }, owner.id, Array.from({ length: 24 }, () => fresh))
    await s.db.batch(minted.stmts)
    const page = await account(s, owner)
    const cursor = JSON.parse(new TextDecoder().decode(b64urlDecode(page.next!)))
    const legacy = b64urlEncode(new TextEncoder().encode(JSON.stringify(cursor.slice(0, 4))))
    const response = await s.request('GET', '/account/cards?after=' + legacy, { token: owner.token, client: null })
    assert.equal(response.status, 409)
    assert.equal((await account(s, owner)).version, page.version)
  })

  it('never revives stale Mythic form handles in browser metadata or card fields', async () => {
    const s = server(), finder = await s.join(), owner = await s.join()
    const mythic = await give(s, finder, generateMythic({ seed: 'browser-discovery-mythic', dna: 6, now: s.now() }))
    await s.db.batch([stmt(`UPDATE cards SET owner_id = ?, form = json_set(form, '$.discoveredBy', 'stale-claimed-finder') WHERE id = ?`, owner.id, mythic.id)])
    let data = await account(s, owner)
    assert.deepEqual(data.discoveryCredits[mythic.id], { handle: finder.me.player.handle, kind: 'mythic' })
    assert.ok(!JSON.stringify(data).includes('stale-claimed-finder'))
    await finder.call('rerollHandle', {})
    data = await account(s, owner)
    assert.deepEqual(data.discoveryCredits[mythic.id], { handle: null, kind: 'mythic' })
    assert.equal(data.cards.find(card => card.id === mythic.id)!.form!.discoveredBy, undefined)
  })
})

class Element {
  readonly tagName: string
  constructor(tagName = '') { this.tagName = tagName }
  children: Element[] = []
  ownText = ''; className = ''; href = ''; value = ''; hidden = false; disabled = false
  attributes = new Map<string, string>()
  listeners = new Map<string, (event: { preventDefault(): void }) => unknown>()
  style = { setProperty() {} }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(' ') }
  set textContent(value: string) { this.ownText = value; this.children = [] }
  get selectedOptions() { return [{ textContent: this.value }] }
  append(...children: Element[]) { this.children.push(...children) }
  replaceChildren(...children: Element[]) { this.ownText = ''; this.children = children }
  setAttribute(key: string, value: string) { this.attributes.set(key, value) }
  getAttribute(key: string) { return this.attributes.get(key) ?? null }
  removeAttribute(key: string) { this.attributes.delete(key) }
  addEventListener(name: string, listener: (event: { preventDefault(): void }) => unknown) { this.listeners.set(name, listener) }
}

const descendants = (node: Element): Element[] => node.children.flatMap(child => [child, ...descendants(child)])

describe('the account card discovery links', () => {
  it('renders the real envelope through the account script with independently clickable finder and card links', async () => {
    const { s, finder, owner, copy } = await copies()
    const nodes = new Map<string, Element>()
    const node = (id: string): Element => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id)! }
    node('account').setAttribute('data-card-help', JSON.stringify(CARD_HELP))
    node('board').value = 'rating'; node('period').value = 'all'; node('sort').value = 'newest'
    vm.runInNewContext(ACCOUNT_JS, {
      document: { getElementById: node, createElement: (tag: string) => new Element(tag), addEventListener() {} },
      sessionStorage: { getItem: () => owner.token },
      fetch: async (path: string, options: { method: string; headers: Record<string, string> }) => s.request(options.method, path, { token: options.headers.Authorization?.slice(7), client: null }),
    })
    await node('refresh').listeners.get('click')!({ preventDefault() {} })
    assert.equal(node('profile-open').href, '/u/' + owner.me.player.handle)
    const card = node('collection').children.find(child => child.attributes.get('data-card-id') === copy.id)!
    assert.ok(card)
    const links = descendants(card).filter(element => element.tagName === 'a')
    assert.ok(links.some(link => link.href === '/c/' + copy.id))
    const finderLink = links.find(link => link.href === '/u/' + finder.me.player.handle)!
    assert.equal(finderLink.textContent, finder.me.player.handle)
    assert.ok(descendants(card).some(element => element.className === 'card-discovery' && element.textContent.includes('First discovered by')))
    for (const link of links) assert.ok(!descendants(link).some(child => child.tagName === 'a'))
    await finder.call('rerollHandle', {})
    await node('refresh').listeners.get('click')!({ preventDefault() {} })
    const refreshed = node('collection').children.find(child => child.attributes.get('data-card-id') === copy.id)!
    assert.ok(!descendants(refreshed).some(element => element.href.startsWith('/u/')))
    assert.ok(descendants(refreshed).some(element => element.className === 'card-discovery' && element.textContent.includes('a trainer')))
    const renamed = await owner.call('rerollHandle', {})
    await node('refresh').listeners.get('click')!({ preventDefault() {} })
    assert.equal(node('profile-open').href, '/u/' + renamed.handle, 'the action follows the current public username without session data')
  })
})

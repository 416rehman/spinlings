// Mutable public identity and stats must be read again after privacy changes, even on a cached revisit.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mintCard } from '../../plugin/hooks/core/cards.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { stmt } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { server } from './scaffold-helpers.ts'
import type { Server } from './scaffold-helpers.ts'
import { trust } from './social-helpers.ts'

type Page = { status: number; html: string; cache: string }
let visits = 0

async function get(s: Server, path: string, method = 'GET'): Promise<Page> {
  const response = await s.request(method, path, { client: null, ip: `198.18.${visits >> 8}.${++visits & 255}` })
  assert.match(response.headers.get('content-type') ?? '', /^text\/html; charset=utf-8$/)
  return { status: response.status, html: await response.text(), cache: response.headers.get('cache-control') ?? '' }
}

/** A visitor may reuse a fresh max-age response without contacting the server. */
function cachedVisitor(s: Server) {
  const saved = new Map<string, { until: number; page: Page }>()
  return async (path: string): Promise<Page> => {
    const old = saved.get(path)
    if (old && old.until > s.now()) return old.page
    const page = await get(s, path), maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(page.cache)
    if (!/(?:^|,)\s*no-store(?:\s*,|$)/i.test(page.cache) && maxAge) {
      saved.set(path, { until: s.now() + Number(maxAge[1]) * 1000, page })
    }
    return page
  }
}

async function setup() {
  const s = server(), finder = await s.join(), holder = await s.join('opus')
  const found = new Set((await s.db.all<{ species: string }>('SELECT species FROM firsts')).map(row => row.species))
  const species = seasonSpecies(1).find(form => !form.legendary && !found.has(form.id))!
  assert.ok(species)
  const fresh = [
    mintCard({ species, rarity: 'rare', shiny: false, dna: 17, now: s.now(), origin: 'catch' }),
    generateMythic({ seed: 'public-cache-mythic', dna: 7, now: s.now(), origin: 'catch' }),
  ]
  const minted = await mintCards({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }, finder.id, fresh)
  await s.db.batch(minted.stmts)
  const [regular, mythic] = minted.cards
  assert.ok(regular && mythic)
  await s.db.batch([
    stmt('UPDATE cards SET owner_id = ? WHERE id IN (?, ?)', holder.id, regular.id, mythic.id),
    stmt(`UPDATE players SET pub_day = '', rating = 1729, battles = 10, duel_wins = 13 WHERE id = ?`, finder.id),
  ])
  await trust(s, holder)
  await holder.call('listCard', { cardId: regular.id, price: 10 })
  const profile = '/u/' + holder.me.player.handle
  const creditPaths = [profile, `/c/${regular.id}`, `/c/${mythic.id}`, `/species/${species.id}`, '/mythics', '/market', '/']
  return { s, finder, holder, profile, creditPaths, paths: [...creditPaths, '/players', '/boards'] }
}

describe('public website cache privacy', () => {
  it('prevents storage of identity and stat-bearing HTML on GET and HEAD', async () => {
    const { s, finder, paths } = await setup()
    for (const path of paths) {
      const page = await get(s, path)
      assert.equal(page.status, 200, path)
      assert.ok(page.html.includes(finder.me.player.handle), `${path} contains public player identity`)
      assert.equal(page.cache, 'no-store', path)
      const head = await get(s, path, 'HEAD')
      assert.equal(head.status, 200, path)
      assert.equal(head.cache, 'no-store', path)
      assert.equal(head.html, '', 'HEAD preserves the cache policy without a body')
    }
  })

  it('removes profile stats and board places on a cached revisit immediately after hiding', async () => {
    const { s, finder, profile } = await setup(), visit = cachedVisitor(s)
    const ownProfile = '/u/' + finder.me.player.handle
    const before = await visit(ownProfile)
    assert.match(before.html, /id="stats"/)
    assert.match(before.html, /1729 rating/)
    assert.ok((await visit('/boards')).html.includes(finder.me.player.handle))
    await visit(profile)
    const now = s.now()
    await finder.call('setLeaderboard', { optIn: false })
    assert.equal(s.now(), now, 'the privacy change does not wait for a cache expiry')
    const hidden = await visit(ownProfile)
    assert.doesNotMatch(hidden.html, /id="stats"|1729 rating|class="season-stats"/)
    assert.ok(!(await visit('/boards')).html.includes(finder.me.player.handle))
    assert.ok((await visit(profile)).html.includes(`href="/u/${finder.me.player.handle}"`), 'discovery credit remains public')
  })

  for (const action of ['rename', 'delete'] as const) it(`removes discovery identity on cached revisits immediately after ${action}`, async () => {
    const { s, finder, creditPaths } = await setup(), visit = cachedVisitor(s), old = finder.me.player.handle
    for (const path of [...creditPaths, '/players']) {
      assert.ok((await visit(path)).html.includes(old), `${path} initially names the finder`)
    }
    const now = s.now()
    const renamed = action === 'rename' ? (await finder.call('rerollHandle', {})).handle : null
    if (action === 'delete') await finder.call('deleteMe')
    assert.equal(s.now(), now, 'identity removal does not wait for a cache expiry')
    for (const path of creditPaths) {
      const page = await visit(path)
      assert.equal(page.status, 200, path)
      assert.equal(page.cache, 'no-store', path)
      assert.ok(!page.html.includes(old), `${path} no longer names the finder`)
      if (renamed) assert.ok(!page.html.includes(renamed), `${path} does not link old discoveries to the new username`)
    }
    const directory = await visit('/players')
    assert.ok(!directory.html.includes(old), 'the directory does not retain the old account identity')
    if (renamed) assert.ok(directory.html.includes(renamed), 'the renamed public profile remains discoverable')
  })
})

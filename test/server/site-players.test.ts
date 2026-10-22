import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { stmt } from '../../server/src/db.ts'
import { cardsByIds, publicCard } from '../../server/src/game/mint.ts'
import { SITE_CSP } from '../../server/src/pages-html.ts'
import { PLAYERS_CSP, PLAYERS_PAGE } from '../../server/src/pages-players.ts'
import { spriteSvg } from '../../server/src/pages-sprite.ts'
import { server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const body = (markup: string) => markup.slice(markup.indexOf('<main'), markup.indexOf('</main>'))
const get = async (s: Server, path = '/players', token?: string) => {
  const response = await s.request('GET', path, { client: null, ...(token ? { token } : {}) })
  return { response, markup: await response.text() }
}
const handles = (markup: string) => [...markup.matchAll(/<span class="trainer-name">([^<]+)<\/span>/g)].map(match => match[1]!)
async function named(s: Server, name: string): Promise<Player> {
  const player = await s.join('haiku')
  await s.db.batch([stmt('UPDATE players SET handle = ? WHERE id = ?', name, player.id)])
  return player
}

describe('the public trainer directory', () => {
  it('offers native username search and access to your own profile with a page-local form policy', async () => {
    const s = server(), { response, markup } = await get(s), content = body(markup)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-security-policy'), PLAYERS_CSP)
    assert.ok(PLAYERS_CSP.includes("connect-src 'none'") && PLAYERS_CSP.includes("form-action 'self'"))
    assert.ok(SITE_CSP.includes("form-action 'none'"), 'the global page policy is unchanged')
    assert.match(markup, /<meta name="robots" content="noindex">/)
    assert.match(content, /<form class="players-search" method="get" action="\/players" role="search">/)
    assert.match(content, /<label for="player-search">Search usernames<\/label>/)
    assert.match(content, /id="player-search" name="q" type="search" maxlength="40"/)
    assert.match(content, /href="\/account"><span class="face">Your profile/)
    assert.match(content, /href="\/boards">See the leaderboards/)
    assert.match(content, /No trainers here yet/)
    assert.equal(response.headers.get('set-cookie'), null)
  })

  it('lists profiles alphabetically with real lead art, including hidden-board players without their stats or activity', async () => {
    const s = server(), z = await named(s, 'zeta-player'), a = await named(s, 'alpha-player'), b = await named(s, 'bravo-hidden')
    await s.db.batch([stmt('UPDATE players SET board_hidden = 1, rating = ?, pub_stats = ?, last_seen = ? WHERE id = ?', 876543, '{"duelWins":765432}', '2099-12-31', b.id)])
    const { markup } = await get(s), content = body(markup)
    assert.deepEqual(handles(content), ['alpha-player', 'bravo-hidden', 'zeta-player'])
    for (const player of [z, a, b]) {
      const row = await player.row(), leadId = JSON.parse(row.team)[0] as string
      const card = publicCard((await cardsByIds(s.db, [leadId])).get(leadId)!.card)
      assert.ok(content.includes(spriteSvg(spriteFor(card), { flash: false })), 'lead artwork uses the actual public frozen card')
      assert.ok(content.includes(`href="/u/${row.handle}"`))
      for (const hidden of [player.id, player.token, leadId]) assert.ok(!content.includes(hidden), 'only the public profile link is emitted')
    }
    assert.doesNotMatch(content, /876543|765432|2099-12-31|last_seen|pub_stats|board_hidden|rating|streak|mintedAt|raisedIn/)
    assert.deepEqual(await handles((await get(s, '/players', a.token)).markup), handles(markup), 'sign-in does not alter the public list')
  })

  it('keeps missing or foreign team leads out of the directory instead of inventing or borrowing artwork', async () => {
    const s = server(), a = await named(s, 'empty-team'), b = await named(s, 'other-trainer')
    await s.db.batch([stmt('UPDATE players SET team = ? WHERE id = ?', (await b.row()).team, a.id)])
    const { markup } = await get(s, '/players?q=empty-team')
    const entry = body(markup).match(/<a class="trainer"[^>]*>([\s\S]*?)<\/a>/)![1]!
    assert.match(entry, /class="trainer-empty"/)
    assert.doesNotMatch(entry, /class="spr/)
    assert.deepEqual(handles(markup), ['empty-team'])
    await s.db.batch([stmt('UPDATE players SET team = ? WHERE id = ?', '[]', a.id)])
    assert.match(body((await get(s, '/players?q=empty-team')).markup), /class="trainer-empty"/)
  })

  it('searches literal username text case-insensitively and never reflects query markup as HTML', async () => {
    const s = server()
    await named(s, 'Moss_Trainer')
    await named(s, 'another-trainer')
    assert.deepEqual(handles((await get(s, '/players?q=MOSS')).markup), ['Moss_Trainer'])
    assert.deepEqual(handles((await get(s, '/players?q=%25')).markup), [], 'percent is literal, not a LIKE wildcard')
    assert.deepEqual(handles((await get(s, '/players?q=_')).markup), ['Moss_Trainer'], 'underscore is literal')
    const query = '<img src=x onerror=alert(1)>'
    const { response, markup } = await get(s, '/players?q=' + encodeURIComponent(query)), content = body(markup)
    assert.equal(response.status, 200)
    assert.match(content, /value="&lt;img src=x onerror=alert\(1\)&gt;"/)
    assert.doesNotMatch(content, /<img\b|<script\b|\sonclick=/)
    assert.match(content, /No trainers match that username/)
  })

  it('paginates all matching usernames without overlap and binds the continuation to its search', async () => {
    const s = server()
    const expected = Array.from({ length: PLAYERS_PAGE + 2 }, (_, i) => `trainer-${String(i).padStart(2, '0')}`)
    for (const handle of expected) await named(s, handle)
    const first = (await get(s, '/players?q=trainer-')).markup
    assert.deepEqual(handles(first), expected.slice(0, PLAYERS_PAGE))
    const next = body(first).match(/<a class="next" href="([^\"]+)">/)![1]!.replace(/&amp;/g, '&')
    assert.ok(next.includes('q=trainer-') && next.includes('after='))
    const last = (await get(s, next)).markup
    assert.deepEqual(handles(last), expected.slice(PLAYERS_PAGE))
    assert.match(body(last), /Back to first page/)
    assert.doesNotMatch(body(last), /class="next"/)
    const changed = new URL(next, 'http://localhost:8787')
    changed.searchParams.set('q', 'other')
    assert.equal((await get(s, changed.pathname + changed.search)).response.status, 400)
  })

  it('shows the current username only after rename and drops deleted players', async () => {
    const s = server(), p = await named(s, 'old-player-name')
    assert.deepEqual(handles((await get(s)).markup), ['old-player-name'])
    await s.db.batch([stmt('UPDATE players SET handle = ? WHERE id = ?', 'new-player-name', p.id)])
    const renamed = (await get(s)).markup
    assert.deepEqual(handles(renamed), ['new-player-name'])
    assert.ok(!body(renamed).includes('old-player-name'))
    assert.deepEqual(handles((await get(s, '/players?q=old-player-name')).markup), [])
    await p.call('deleteMe', {})
    assert.deepEqual(handles((await get(s)).markup), [])
  })

  it('rejects oversized, non-ASCII, duplicate, unknown and malformed continuation parameters without echoing them', async () => {
    const s = server()
    assert.equal((await get(s, '/players?q=' + 'a'.repeat(40))).response.status, 200)
    for (const path of ['/players?q=' + 'a'.repeat(41), '/players?q=%E2%80%AE', '/players?q=%0A', '/players?q=one&q=two', '/players?sort=activity', '/players?after=bad', '/players?after=', '/players?after=a&after=b']) {
      const { response, markup } = await get(s, path)
      assert.equal(response.status, 400, path)
      assert.ok(!markup.includes('sort=activity') && !markup.includes('one&q=two'))
    }
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cardStats, stageFor, rarityRank } from '../../plugin/hooks/core/cards.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { parseCard } from '../../plugin/hooks/core/schemas.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import type { Card, NewCard, TraitId } from '../../plugin/hooks/core/types.ts'
import { ACCOUNT_CARDS_PAGE } from '../../server/src/account-cards.ts'
import type { AccountCardsResponse } from '../../server/src/account-cards.ts'
import { stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { b64urlEncode } from '../../server/src/game/passkeys.ts'
import { localD1 } from './d1-helpers.ts'
import { DAY, server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const families = ['haiku', 'sonnet', 'opus', 'fable'] as const
const rarities = ['common', 'rare', 'epic', 'legendary'] as const
const ids = (cards: readonly Card[]) => cards.map(c => c.id)
const params = (q: Record<string, string>) => new URLSearchParams(q).toString()

async function give(s: Server, p: Player, fresh: NewCard[]): Promise<Card[]> {
  const minted = await mintCards({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }, p.id, fresh)
  await s.db.batch(minted.stmts)
  return minted.cards
}

function fresh(s: Server, i: number): NewCard {
  const rarity = rarities[i % 4]!
  const card = mintFor(families[(i >> 2) % 4]!, rarity, rngFromSeed(`account-card/${i}`), s.now(), 'pack')
  const level = i % 10 + 1
  return {
    ...card, level, stage: rarity === 'legendary' ? 3 : stageFor(level), shiny: i % 3 === 0,
    ...(i % 5 === 0 ? { foil: true } : {}), genes: [i % 16, i % 7, i % 4, i % 3],
    traits: i % 2 ? ['regrowth'] : ['thickHide'], forTrade: i % 6 === 0,
  }
}

async function setup(n = 65, db?: Db) {
  const s = server({ db }); const p = await s.join(); const other = await s.join('opus')
  await s.db.batch([
    stmt('DELETE FROM cards WHERE owner_id = ?', p.id),
    stmt(`UPDATE players SET team = '[]', team_size = 0, cards_version = cards_version + 1 WHERE id = ?`, p.id),
  ])
  const split = Math.floor(n / 2)
  const cards = await give(s, p, Array.from({ length: split }, (_, i) => fresh(s, i)))
  s.tick(DAY)
  cards.push(...await give(s, p, Array.from({ length: n - split }, (_, i) => fresh(s, i + split))))
  // card minting clears for-trade; these fixtures exercise the real stored flags and escrow state.
  await s.db.batch(cards.flatMap((c, i) => [stmt(
    `UPDATE cards SET for_trade = ?, state = ?, escrow_ref = ?, stats = ? WHERE id = ?`,
    i % 6 === 0, i % 11 === 0 ? 'escrow' : 'owned', i % 11 === 0 ? 'fixture-hold' : null,
    JSON.stringify({ hp: 100 + i % 13, atk: 20 + i % 9, def: 30 + i % 8, spd: 40 + i % 7 }), c.id,
  )]))
  const all = (await p.call('cards')).cards
  const team = all.length ? [all.at(-1)!, all.at(0)!, all.at(-2)!] : []
  await s.db.batch([stmt('UPDATE players SET team = ?, team_size = ? WHERE id = ?', JSON.stringify(ids(team)), team.length, p.id)])
  return { s, p, other, cards: all, team }
}

async function get(s: Server, p: Player, q: Record<string, string> = {}): Promise<AccountCardsResponse> {
  const response = await s.request('GET', '/account/cards' + (Object.keys(q).length ? '?' + params(q) : ''), { token: p.token, client: null })
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const data = await response.json() as AccountCardsResponse
  assert.deepEqual(Object.keys(data).sort(), ['cards', 'matched', ...(data.next ? ['next'] : []), 'team', 'total', 'version'].sort())
  for (const c of [...data.cards, ...data.team]) assert.deepEqual(parseCard(c), c, 'no server-only card fields')
  return data
}

async function every(s: Server, p: Player, q: Record<string, string> = {}): Promise<Card[]> {
  const cards: Card[] = []
  let after: string | undefined
  do {
    const page = await get(s, p, { ...q, ...(after ? { after } : {}) })
    assert.ok(page.cards.length <= ACCOUNT_CARDS_PAGE)
    cards.push(...page.cards); after = page.next
  } while (after)
  assert.equal(new Set(ids(cards)).size, cards.length, 'no repeated cards across pages')
  return cards
}

const key = (c: Card, sort: string) => sort === 'level' ? c.level : sort === 'rarity' ? rarityRank(c.rarity)
  : sort === 'genes' ? c.genes.reduce((a, b) => a + b, 0) : c.stats[sort as keyof Card['stats']]
const numericOrder = (cards: Card[], sort: string) => [...cards].sort((a, b) => key(b, sort) - key(a, sort) || b.id.localeCompare(a.id))
const STAT_TRAITS: TraitId[][] = [
  ['sturdy'], ['glassHeart'], ['sleepy'], ['swift'], ['glassHeart', 'sleepy'], ['glassHeart', 'swift'],
  ['swift', 'sleepy'], ['glassHeart', 'swift', 'sleepy'],
]
async function legacyStats(s: Server, p: Player, cards: Card[]): Promise<Card[]> {
  await s.db.batch(cards.map((c, i) => stmt('UPDATE cards SET stats = ?, traits = ? WHERE id = ?',
    i % 2 ? JSON.stringify(c.stats) : '{}', JSON.stringify(STAT_TRAITS[Math.floor(i / 2) % STAT_TRAITS.length]), c.id)))
  const all = (await p.call('cards')).cards
  for (const [i, c] of all.entries()) {
    assert.deepEqual(c.traits, STAT_TRAITS[Math.floor(i / 2) % STAT_TRAITS.length])
    assert.deepEqual(c.stats, i % 2 ? cards[i]!.stats : cardStats(c), i % 2 ? 'stored values win even with new stat traits' : 'legacy values use the core formula')
  }
  assert.ok(all.some((c, i) => i % 2 && JSON.stringify(c.stats) !== JSON.stringify(cardStats(c))), 'the authoritative fixtures differ from the core formula')
  for (const combination of STAT_TRAITS) assert.ok(all.some((c, i) => i % 2 === 0 && JSON.stringify(c.traits) === JSON.stringify(combination)), 'each legacy stat-trait combination is represented')
  return all
}

describe('the authenticated browser collection', () => {
  it('pages the entire collection with complete slot-ordered team and keeps the legacy API unchanged', async () => {
    const { s, p, other, cards, team } = await setup()
    const before = await p.row()
    const page = await get(s, p)
    assert.equal(page.cards.length, 24); assert.equal(page.total, 65); assert.equal(page.matched, 65)
    assert.equal(page.version, (await p.row()).cards_version); assert.ok(page.next)
    assert.deepEqual(ids(page.team), ids(team))
    assert.ok(page.team.some(c => !ids(page.cards).includes(c.id)), 'team includes cards outside the current page')
    const newest = [...cards].sort((a, b) => b.mintedAt - a.mintedAt || b.id.localeCompare(a.id))
    assert.deepEqual(ids(await every(s, p)), ids(newest))
    assert.deepEqual(ids(await every(s, p, { sort: 'oldest' })), ids(cards))
    const theirs = new Set(ids((await other.call('cards')).cards))
    assert.ok([...page.cards, ...page.team].every(c => !theirs.has(c.id)))
    assert.equal((await s.request('GET', '/account/cards')).status, 401)
    assert.equal((await s.request('GET', '/account/cards?owner=' + other.id, { token: p.token })).status, 400)
    assert.equal((await s.request('GET', '/v1/cards?sort=newest', { token: p.token })).status, 400)
    assert.deepEqual(await p.row(), before, 'browser collection reads do not change game state')
  })

  it('applies each filter to cards beyond the loaded page, combines filters and reports honest counts', async () => {
    const { s, p, cards, team } = await setup()
    const cases: [Record<string, string>, (c: Card) => boolean][] = [
      [{ family: 'haiku' }, c => c.family === 'haiku'], [{ rarity: 'epic' }, c => c.rarity === 'epic'],
      [{ trait: 'thickHide' }, c => c.traits.includes('thickHide')], [{ finish: 'foil' }, c => !!c.foil],
      [{ finish: 'shiny' }, c => c.shiny], [{ finish: 'both' }, c => c.shiny && !!c.foil],
      [{ scope: 'team' }, c => ids(team).includes(c.id)], [{ scope: 'forTrade' }, c => c.forTrade],
      [{ scope: 'available' }, c => c.state === 'owned'],
      [{ family: 'haiku', rarity: 'common', trait: 'thickHide', finish: 'shiny', scope: 'available' },
        c => c.family === 'haiku' && c.rarity === 'common' && c.traits.includes('thickHide') && c.shiny && c.state === 'owned'],
    ]
    for (const [q, match] of cases) {
      const expected = cards.filter(match)
      assert.deepEqual(new Set(ids(await every(s, p, q))), new Set(ids(expected)), params(q))
      const page = await get(s, p, q)
      assert.equal(page.total, cards.length); assert.equal(page.matched, expected.length)
      assert.deepEqual(ids(page.team), ids(team), 'filters never hide the actual team')
    }
    await p.call('setTeam', { cardIds: [] })
    const empty = await get(s, p, { scope: 'team' })
    assert.equal(empty.matched, 0); assert.deepEqual(empty.cards, []); assert.deepEqual(empty.team, [])
  })

  it('searches literal displayed names and species from frozen seasons and embedded forms', async () => {
    const { s, p, cards } = await setup()
    const selected = cards.find(c => c.rarity !== 'legendary')!
    const stored = (await s.db.get<{ species_json: string }>('SELECT species_json FROM seasons WHERE season = ?', selected.season))!
    const species = JSON.parse(stored.species_json)
    species.find((c: { id: string }) => c.id === selected.species).names = ['Alderling', 'Alderfin', 'Aldergrove']
    await s.db.batch([stmt('UPDATE seasons SET species_json = ? WHERE season = ?', JSON.stringify(species), selected.season)])
    const byName = await every(s, p, { q: '  ALDER  ' })
    assert.ok(byName.length > 0); assert.ok(byName.every(c => c.species === selected.species))
    const byId = await every(s, p, { q: selected.species })
    assert.deepEqual(new Set(ids(byId)), new Set(ids(cards.filter(c => c.species === selected.species))))
    const base = fresh(s, 70)
    const embedded = await give(s, p, [{ ...base, species: 'promo', stage: 3, form: {
      ...seasonSpecies(1).find(c => c.family === base.family)!, kind: 'promo', seed: 'collection-test', names: ['Hollowmere Duskwing', 'Hollowmere Duskwing', 'Hollowmere Duskwing'],
    } }])
    assert.deepEqual(ids(await every(s, p, { q: 'duskwing' })), ids(embedded))
    for (const q of ['%', '_', "' OR 1=1--", '<script>']) assert.deepEqual(await every(s, p, { q }), [], q)
    const all = await every(s, p, { sort: 'name' })
    const names = new Map<string, [string, string, string]>(species.map((c: { id: string; names: [string, string, string] }) => [c.id, c.names]))
    const name = (c: Card) => (c.form?.names || names.get(c.species)!)[c.stage - 1]!.toLowerCase()
    const expected = [...all].sort((a, b) => name(a).localeCompare(name(b), 'en') || a.id.localeCompare(b.id))
    assert.deepEqual(ids(all), ids(expected))
  })

  it('sorts all authoritative combat numbers, levels, genes and rarities with stable tied pages', async () => {
    const { s, p, cards } = await setup(80)
    for (const sort of ['rarity', 'level', 'genes', 'hp', 'atk', 'def', 'spd']) {
      assert.deepEqual(ids(await every(s, p, { sort })), ids(numericOrder(cards, sort)), sort)
    }
    const shown = (await get(s, p, { sort: 'atk' })).cards[0]!
    assert.equal(shown.stats.atk, Math.max(...cards.map(c => c.stats.atk)), 'displayed values are the stored server values')
  })

  it('sorts legacy empty stats by the same frozen formula it displays, while preserving stored numbers', async () => {
    const { s, p, cards } = await setup(70)
    const all = await legacyStats(s, p, cards)
    for (const sort of ['hp', 'atk', 'def', 'spd']) assert.deepEqual(ids(await every(s, p, { sort })), ids(numericOrder(all, sort)), sort)
  })

  it('binds opaque pages to owner, normalized filters, order and version', async () => {
    const { s, p, other } = await setup(80)
    const first = await get(s, p, { trait: 'thickHide' }); assert.ok(first.next)
    const after = first.next
    for (const q of [{ trait: 'regrowth', after }, { sort: 'level', trait: 'thickHide', after }]) {
      assert.equal((await s.request('GET', '/account/cards?' + params(q), { token: p.token })).status, 400)
    }
    assert.equal((await s.request('GET', '/account/cards?' + params({ trait: 'thickHide', after }), { token: other.token })).status, 400)
    assert.equal((await s.request('GET', '/account/cards?' + params({ trait: 'thickHide', after, scope: 'all', family: '' }), { token: p.token })).status, 200)
    await give(s, p, [fresh(s, 101)])
    assert.equal((await s.request('GET', '/account/cards?' + params({ trait: 'thickHide', after }), { token: p.token })).status, 409)
    const team = await get(s, p, { scope: 'team' })
    assert.equal(team.next, undefined)
    assert.equal((await get(s, p)).total, 81)
  })

  it('rejects malformed and repeated queries without echoing the submitted value', async () => {
    const s = server(); const p = await s.join()
    const bad = ['family=dragon', 'rarity=mythic', 'trait=unknown', 'finish=plain', 'scope=owner', 'sort=damage',
      'family=haiku&family=opus', 'sort=&sort=', '__proto__=polluted', 'playerId=' + p.id, 'q=' + 'x'.repeat(41),
      'q=%00', 'after=', 'after=' + 'A'.repeat(257), 'after=nonsense', 'after=%25',
      'after=' + b64urlEncode(new TextEncoder().encode(JSON.stringify({ sort: 'newest' }))),
    ]
    for (const query of bad) {
      const response = await s.request('GET', '/account/cards?' + query, { token: p.token })
      assert.equal(response.status, 400, query)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.ok(!(await response.text()).includes(p.id))
    }
  })

  it('refuses a torn response if ownership or the team changes while a page is being read', async () => {
    const { s, p } = await setup()
    const rawAll = s.db.all.bind(s.db)
    let race = true
    let changeTeam = false
    s.db.all = async (sql, ...args) => {
      const result = await rawAll(sql, ...args)
      if (race && sql.includes('SELECT * FROM ordered')) {
        race = false
        await s.db.batch([changeTeam
          ? stmt(`UPDATE players SET team = '[]', team_size = 0 WHERE id = ?`, p.id)
          : stmt('UPDATE players SET cards_version = cards_version + 1 WHERE id = ?', p.id)])
      }
      return result
    }
    assert.equal((await s.request('GET', '/account/cards', { token: p.token })).status, 409)
    changeTeam = true; race = true
    assert.equal((await s.request('GET', '/account/cards', { token: p.token })).status, 409)
    s.db.all = rawAll
    const current = await get(s, p)
    assert.equal(current.version, (await p.row()).cards_version)
  })

  it('keeps even a page of fully dressed forms under the 256 KiB HTTP cap', async () => {
    const { s, p } = await setup(0)
    const base = fresh(s, 70)
    const longestName = 'A' + 'a'.repeat(23) + ' B' + 'b'.repeat(22)
    assert.equal(longestName.length, 48)
    const form = { ...seasonSpecies(1).find(c => c.family === base.family)!, kind: 'promo' as const, seed: 's'.repeat(64), names: [longestName, longestName, longestName] as [string, string, string], stamp: 'Founder October 2026' }
    await give(s, p, Array.from({ length: 60 }, () => ({ ...base, species: 'promo', stage: 3 as const, form })))
    const response = await s.request('GET', '/account/cards', { token: p.token })
    assert.equal(response.status, 200)
    const body = await response.text()
    assert.ok(Buffer.byteLength(body) < 256 * 1024)
    const page = JSON.parse(body) as AccountCardsResponse
    assert.equal(page.cards.length, 24); assert.equal(page.matched, 60); assert.ok(page.next)
    assert.equal((await every(s, p, { sort: 'name' })).length, 60, 'the longest embedded name still produces a usable cursor')
  })
})

describe('the browser collection on real D1', async () => {
  const d1 = await localD1()
  it('runs the frozen-name, trait, numeric sort and keyset queries on the Worker database', { skip: 'skip' in d1 ? d1.skip : false }, async () => {
    if ('skip' in d1) return
    const { s, p, cards, team } = await setup(65, d1.db)
    assert.deepEqual(ids(await every(s, p, { sort: 'atk', trait: 'thickHide' })), ids(numericOrder(cards.filter(c => c.traits.includes('thickHide')), 'atk')))
    const selected = cards[0]!
    const name = seasonSpecies(selected.season).find(c => c.id === selected.species)!.names[selected.stage - 1]!
    const found = await get(s, p, { q: name.toLowerCase(), sort: 'name' })
    assert.ok(found.cards.some(c => c.id === selected.id))
    assert.deepEqual(ids(found.team), ids(team))
    assert.equal(found.total, 65)
    assert.ok((await get(s, p, { finish: 'both', scope: 'available' })).cards.every(c => c.shiny && c.foil && c.state === 'owned'))
    const legacy = await legacyStats(s, p, cards)
    for (const sort of ['hp', 'atk', 'def', 'spd']) assert.deepEqual(ids(await every(s, p, { sort })), ids(numericOrder(legacy, sort)), 'D1 legacy ' + sort)
  })
})

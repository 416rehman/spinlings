import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cardName, cardPower, cardStats, rarityRank, stageFor } from '../../plugin/hooks/core/cards.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import type { BattleCard, Card, NewCard, TraitId } from '../../plugin/hooks/core/types.ts'
import { stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { mintCards, publicCard } from '../../server/src/game/mint.ts'
import { b64urlDecode, b64urlEncode } from '../../server/src/game/passkeys.ts'
import { HttpError, wireJson } from '../../server/src/http.ts'
import { PUBLIC_INVENTORY_PAGE, publicInventory } from '../../server/src/public-collection.ts'
import type { PublicInventory, PublicInventoryQuery } from '../../server/src/public-collection.ts'
import { localD1 } from './d1-helpers.ts'
import { DAY, server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'
import { assertNoIds, assertPublic, snapshot } from './social-helpers.ts'

const ids = (cards: readonly BattleCard[]) => cards.map(c => c.id)
const families = ['haiku', 'sonnet', 'opus', 'fable'] as const
const rarities = ['common', 'rare', 'epic', 'legendary'] as const
const sorts = ['name', 'rarity', 'level', 'genes', 'power', 'hp', 'atk', 'def', 'spd'] as const

function fresh(s: Server, i: number): NewCard {
  const rarity = rarities[i % 4]!
  const base = mintFor(families[(i >> 2) % 4]!, rarity, rngFromSeed(`public-card/${i}`), s.now(), 'pack')
  const level = i % 10 + 1
  return { ...base, level, stage: rarity === 'legendary' ? 3 : stageFor(level), shiny: i % 3 === 0,
    ...(i % 5 === 0 ? { foil: true } : {}), genes: [i % 16, i % 7, i % 4, i % 3],
    traits: i % 2 ? ['regrowth'] : ['thickHide'] }
}

async function setup(db?: Db, count = 67) {
  const s = server({ db }), p = await s.join(), other = await s.join('opus')
  await s.db.batch([stmt('DELETE FROM cards WHERE owner_id = ?', p.id), stmt(`UPDATE players SET team = '[]', team_size = 0 WHERE id = ?`, p.id)])
  const minted = await mintCards({ db: s.db, now: s.now(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)) }, p.id,
    Array.from({ length: count }, (_, i) => fresh(s, i)))
  await s.db.batch(minted.stmts)
  await s.db.batch(minted.cards.map((c, i) => stmt(
    `UPDATE cards SET stats = ?, raised_in = 'opus', arena_opus = 9, state = ?, escrow_ref = ?, locked_until = ?, tired_until = ? WHERE id = ?`,
    JSON.stringify({ hp: 100 + i % 13, atk: 20 + i % 9, def: 30 + i % 8, spd: 40 + i % 7 }),
    i % 11 === 0 ? 'escrow' : 'owned', i % 11 === 0 ? 'private-offer-reference' : null, s.now() + DAY, s.now() + DAY, c.id,
  )))
  return { s, p, other, cards: (await p.call('cards')).cards }
}

async function page(s: Server, p: Player, query: PublicInventoryQuery = {}): Promise<PublicInventory> {
  const out = await publicInventory(s.db, p.me.player.handle, s.now(), query)
  assert.ok(out)
  assert.deepEqual(Object.keys(out).sort(), ['cards', 'matching', ...(out.next ? ['next'] : []), 'total'].sort())
  assert.ok(out.cards.length <= PUBLIC_INVENTORY_PAGE)
  for (const c of out.cards) assertPublic(JSON.parse(wireJson(c)), 'public inventory')
  return out
}

async function every(s: Server, p: Player, query: PublicInventoryQuery = {}): Promise<BattleCard[]> {
  const cards: BattleCard[] = []
  let after: string | undefined
  do {
    const out = await page(s, p, { ...query, ...(after ? { after } : {}) })
    cards.push(...out.cards); after = out.next
  } while (after)
  assert.equal(new Set(ids(cards)).size, cards.length, 'no duplicates across tied pages')
  return cards
}

function sorted(cards: readonly BattleCard[], sort: NonNullable<PublicInventoryQuery['sort']>): BattleCard[] {
  if (sort === 'name') return [...cards].sort((a, b) => cardName(a).toLowerCase().localeCompare(cardName(b).toLowerCase()) || a.id.localeCompare(b.id))
  const key = (c: BattleCard) => sort === 'rarity' ? rarityRank(c.rarity) : sort === 'level' ? c.level
    : sort === 'genes' ? c.genes.reduce((a, b) => a + b, 0) : sort === 'power' ? cardPower(c) : c.stats[sort]
  return [...cards].sort((a, b) => key(b) - key(a) || b.id.localeCompare(a.id))
}

describe('the public website collection', () => {
  it('pages every held card, including escrowed faces, without private card or player fields', async () => {
    const { s, p, other, cards } = await setup()
    const before = await snapshot(s.db)
    const first = await page(s, p)
    assert.equal(first.total, 67); assert.equal(first.matching, 67); assert.equal(first.cards.length, 24); assert.ok(first.next)
    assert.deepEqual(ids(await every(s, p)), ids(sorted(cards, 'name')))
    const json = wireJson(first)
    assertNoIds(first, [p.id, other.id], 'public inventory')
    for (const key of ['owner', 'version', 'xp', 'bound', 'forTrade', 'origin', 'mintedAt', 'lockedUntil', 'tiredUntil', 'raisedIn', 'arena', 'state', 'escrowRef', 'packs', 'source', 'sparks', 'token']) {
      assert.ok(!json.includes(`"${key}"`), `does not disclose ${key}`)
    }
    assert.ok(!json.includes('private-offer-reference'))
    assert.deepEqual(await snapshot(s.db), before, 'browsing does not touch activity or game state')
    assert.equal(await publicInventory(s.db, 'not/a/handle', s.now()), null)
    assert.equal(await publicInventory(s.db, 'missing-trainer-12', s.now()), null)
  })

  it('filters the entire collection before paging and sorts public stat/name ties consistently', async () => {
    const { s, p, cards } = await setup()
    const cases: [PublicInventoryQuery, (c: Card) => boolean][] = [
      [{ family: 'haiku' }, c => c.family === 'haiku'], [{ rarity: 'epic' }, c => c.rarity === 'epic'],
      [{ trait: 'thickHide' }, c => c.traits.includes('thickHide')], [{ finish: 'foil' }, c => !!c.foil],
      [{ finish: 'shiny' }, c => c.shiny], [{ finish: 'both' }, c => c.shiny && !!c.foil],
      [{ kind: 'species' }, () => true], [{ kind: 'mythic' }, () => false],
      [{ family: 'sonnet', trait: 'thickHide', finish: 'shiny' }, c => c.family === 'sonnet' && c.traits.includes('thickHide') && c.shiny],
      [{ q: cards[42]!.species }, c => c.species === cards[42]!.species],
      [{ q: cardName(cards[52]!).toUpperCase() }, c => cardName(c).toLowerCase().includes(cardName(cards[52]!).toLowerCase())],
    ]
    for (const [query, accept] of cases) {
      const first = await page(s, p, query), expected = sorted(cards.filter(accept), 'name')
      assert.equal(first.total, cards.length); assert.equal(first.matching, expected.length)
      assert.deepEqual(ids(await every(s, p, query)), ids(expected), JSON.stringify(query))
    }
    for (const sort of sorts) assert.deepEqual(ids(await every(s, p, { sort })), ids(sorted(cards, sort)), sort)
  })

  it('uses authoritative stored stats and frozen fallback formulas for numeric sorting', async () => {
    const { s, p, cards } = await setup()
    const traits: TraitId[][] = [['glassHeart'], ['sleepy'], ['swift'], ['glassHeart', 'sleepy'], ['swift', 'sleepy']]
    await s.db.batch(cards.map((c, i) => stmt('UPDATE cards SET stats = ?, traits = ? WHERE id = ?',
      i % 2 ? JSON.stringify(c.stats) : '{}', JSON.stringify(traits[i % traits.length]), c.id)))
    const current = (await p.call('cards')).cards
    for (const [i, c] of current.entries()) assert.deepEqual(c.stats, i % 2 ? cards[i]!.stats : cardStats(c))
    for (const sort of ['hp', 'atk', 'def', 'spd', 'power'] as const) {
      assert.deepEqual(ids(await every(s, p, { sort })), ids(sorted(current, sort)), sort)
    }
  })

  it('binds cursors to the public handle and filters, never to acquisition times or collection versions', async () => {
    const { s, p, other } = await setup()
    const first = await page(s, p, { sort: 'level' })
    const decoded = JSON.parse(new TextDecoder().decode(b64urlDecode(first.next!)))
    assert.equal(decoded.length, 3); assert.match(decoded[0], /^[0-9a-f]{16}$/)
    assert.equal(typeof decoded[1], 'number'); assert.equal(typeof decoded[2], 'string')
    assert.ok(first.cards.some(c => c.id === decoded[2] && c.level === decoded[1]), 'cursor includes only displayed public sort key/card id')
    const bad = (query: PublicInventoryQuery | URLSearchParams) => assert.rejects(publicInventory(s.db, p.me.player.handle, s.now(), query), (err: unknown) => err instanceof HttpError && err.status === 400)
    await bad({ sort: 'name', after: first.next }); await bad({ sort: 'level', family: 'opus', after: first.next })
    await assert.rejects(publicInventory(s.db, other.me.player.handle, s.now(), { sort: 'level', after: first.next }), HttpError)
    for (const value of ['%', 'eA', b64urlEncode(new TextEncoder().encode(JSON.stringify([decoded[0], {}, decoded[2]])))]) await bad({ sort: 'level', after: value })
    await bad(new URLSearchParams('family=opus&family=haiku'))
    await bad(new URLSearchParams('sort=newest')); await bad(new URLSearchParams('owner=anything'))
    await bad(new URLSearchParams('q=%00')); await bad(new URLSearchParams('q=' + 'a'.repeat(41)))
    // Ordinary live changes do not reveal a collection version, nor turn a cursor into ownership authority.
    await s.db.batch([stmt('UPDATE players SET cards_version = cards_version + 1 WHERE id = ?', p.id)])
    assert.ok(await page(s, p, { sort: 'level', after: first.next }))
    await s.db.batch([stmt('UPDATE cards SET owner_id = ? WHERE owner_id = ?', other.id, p.id)])
    assert.equal((await page(s, p, { sort: 'level', after: first.next })).cards.length, 0)
  })

  it('keeps database work and parameters bounded on a cold public inventory read', async () => {
    const { s, p } = await setup()
    const all = s.db.all.bind(s.db), get = s.db.get.bind(s.db)
    let reads = 0, maxParams = 0
    const db: Db = {
      all: async (sql, ...params) => { reads++; maxParams = Math.max(maxParams, params.length); return all(sql, ...params) },
      get: async (sql, ...params) => { reads++; maxParams = Math.max(maxParams, params.length); return get(sql, ...params) },
      batch: async () => assert.fail('public reads must not write'),
    }
    const out = await publicInventory(db, p.me.player.handle, s.now(), { sort: 'atk', trait: 'thickHide' })
    assert.ok(out); assert.ok(reads <= 8, `${reads} reads`); assert.ok(maxParams <= 100)
    assert.ok(out.cards.every(c => !Object.hasOwn(c, 'raisedIn')))
    assert.deepEqual(out.cards, (await every(s, p, { sort: 'atk', trait: 'thickHide' })).slice(0, 24).map(publicCard))
  })
})

describe('public website collection on real D1', async () => {
  const local = await localD1()
  it('runs name, trait, stat and keyset queries with the Worker database', { skip: 'skip' in local ? local.skip : false }, async () => {
    if ('skip' in local) return
    const { s, p, cards } = await setup(local.db)
    for (const sort of ['name', 'atk', 'power'] as const) assert.deepEqual(ids(await every(s, p, { sort })), ids(sorted(cards, sort)))
    assert.deepEqual(ids(await every(s, p, { trait: 'thickHide', finish: 'shiny' })), ids(sorted(cards.filter(c => c.traits.includes('thickHide') && c.shiny), 'name')))
  })
})

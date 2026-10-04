import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cardName, cardStats, mintCard, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import type { Card, Species } from '../../plugin/hooks/core/types.ts'
import type { SeasonResponse } from '../../plugin/hooks/core/api.ts'
import { createFrozenCatalog, createSeasonCache } from '../../plugin/hooks/client/frozen.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { parseCardsResponse } from '../../plugin/hooks/core/schemas.ts'

const NOW = Date.UTC(2026, 9, 4)
const card = (season: number): Card => ({ ...mintCard({ species: seasonSpecies(season)[0]!, rarity: 'common', dna: 4,
  shiny: false, origin: 'pack', now: NOW }), id: `card${season}` })
function frozen(season: number, name = 'Frostlet'): SeasonResponse {
  const species = structuredClone(seasonSpecies(season)) as Species[]
  species[0] = { ...species[0]!, names: [name, 'Frostmaw', 'Frosttitan'], hue: 140, body: 'ghost', base: { hp: 300, atk: 40, def: 50, spd: 20 } }
  return { season, generator: 1, species }
}
function world(name = 'Frostlet') {
  const calls: number[] = [], saved = new Map<number, SeasonResponse>()
  let snapshot: Species[] = []
  const loader = createFrozenCatalog({
    read: async n => saved.get(n), write: async (n, data) => { saved.set(n, data) },
    fetch: async n => { calls.push(n); return frozen(n, name) }, now: async () => NOW,
    changed: async value => { snapshot = value },
  })
  return { loader, calls, saved, snapshot: () => snapshot }
}

test('all nine owned seasons and a foreign opponent hydrate from frozen data, despite matching current generators', async () => {
  const w = world()
  const cards = Array.from({ length: 9 }, (_, i) => card(i + 1))
  const beforeStats = cards.map(c => c.stats)
  const answer = await w.loader.hydrate({ cards, setup: { attacker: [toBattleCard(cards[0]!)], defender: [toBattleCard(card(10))] } }, [11])
  assert.deepEqual([...w.calls].sort((a, b) => a - b), Array.from({ length: 11 }, (_, i) => i + 1))
  assert.ok(answer.cards.every(c => cardName(c) === 'Frostlet'))
  assert.deepEqual(answer.cards.map(c => c.stats), beforeStats, 'server stats never recomputed by appearance hydration')
  assert.equal(cardName(answer.setup.defender[0]!), 'Frostlet')
  assert.equal(w.snapshot().length, 11 * 36)
  await w.loader.hydrate(cards, [11])
  assert.equal(w.calls.length, 11, 'one immutable fetch per season')
  const parsed = parseCardsResponse({ cards: answer.cards, version: 1 })
  assert.ok(parsed.cards.every(c => c.appearance === undefined), 'local metadata is stripped on a wire/cache read')
  assert.ok((await w.loader.hydrate(parsed)).cards.every(c => cardName(c) === 'Frostlet'))
})

test('two origins resolve independently and never change offline names, sprites or recomputed stats', async () => {
  const own = card(1), offlineName = cardName(own), offlineStats = cardStats(own), offlineSprite = spriteFor(own)
  const a = world('Frostlet'), b = world('Mosslet')
  const [first, second] = await Promise.all([a.loader.hydrate(own), b.loader.hydrate(own)])
  assert.equal(cardName(first), 'Frostlet'); assert.equal(cardName(second), 'Mosslet')
  assert.equal(cardName(await a.loader.hydrate(own)), 'Frostlet')
  assert.equal(cardName(own), offlineName); assert.deepEqual(cardStats(own), offlineStats); assert.deepEqual(spriteFor(own), offlineSprite)
  assert.notDeepEqual(spriteFor(first), offlineSprite)
  assert.equal(cardName(toBattleCard(first)), 'Frostlet', 'ceremonies and setup copies retain resolved appearance')
})

test('a mismatched cache entry is fetched again, while a valid old generator cache remains authoritative', async () => {
  const w = world()
  w.saved.set(1, frozen(2, 'Mosslet')); w.saved.set(3, frozen(3, 'Leaflet'))
  const out = await w.loader.hydrate([card(1), card(3)])
  assert.deepEqual(w.calls, [1]); assert.deepEqual(out.map(cardName), ['Frostlet', 'Leaflet'])
})

test('leaving a world during appearance fetch stops later batches and does not publish its snapshot', async () => {
  let wanted = true, complete: (v: SeasonResponse) => void = () => undefined, published = 0
  const calls: number[] = []
  const loader = createFrozenCatalog({ read: async () => undefined, write: async () => undefined, now: async () => NOW,
    fetch: n => { calls.push(n); return n === 1 ? new Promise(r => { complete = r }) : Promise.resolve(frozen(n)) },
    changed: async () => { published++ },
  })
  const pending = loader.hydrate(Array.from({ length: 9 }, (_, i) => card(i + 1)), [], () => wanted)
  for (let i = 0; i < 8; i++) await Promise.resolve()
  wanted = false; complete(frozen(1)); await pending
  assert.deepEqual(calls, [1, 2, 3, 4]); assert.equal(published, 0)
  assert.equal(cardName(card(1)), seasonSpecies(1)[0]!.names[0])
})

test('market wants, album ids and fusion parents fetch their own frozen season without owned cards', async () => {
  const w = world()
  await w.loader.hydrate({ want: { species: 's12-haiku-0' }, seen: ['s13-haiku-0'], form: { parents: ['s14-haiku-0', 's15-sonnet-0'] } })
  assert.deepEqual([...w.calls].sort((a, b) => a - b), [12, 14, 15], 'past discovery history does not trigger unused downloads')
})

test('usernames, notices and arbitrary strings never request unrelated frozen seasons', async () => {
  const w = world()
  await w.loader.hydrate({ player: { handle: 's9999-haiku-1', wishlist: ['s4-sonnet-0'], seen: ['s8-opus-0'] },
    notices: [{ text: 's9998-haiku-0', handle: 's9997-haiku-0' }], url: 's9996-haiku-0', id: 's9995-haiku-0',
    cards: [card(1)], want: { species: 's2-haiku-0' }, form: { parents: ['s3-opus-0', 's3-opus-1'] } }, [5])
  assert.deepEqual([...w.calls].sort((a, b) => a - b), [1, 2, 3, 4, 5])
})

test('appearance storage stays bounded across origins and concurrent writes, preserving game data', async () => {
  const store = new Map<string, unknown>([['offline:v1', { cards: ['keep'] }], ['server:https://a.example:session', 'keep'],
    ['server:https://a.example:cache', { cards: ['keep'] }]])
  const data = frozen(1), size = Buffer.byteLength(JSON.stringify(data))
  const cache = createSeasonCache({ get: async key => store.get(key), set: async (key, value) => { store.set(key, value) },
    delete: async key => { store.delete(key) }, keys: async () => [...store.keys()] }, size * 2 + 100)
  await Promise.all([cache.write('https://a.example', 1, data), cache.write('https://b.example', 1, data),
    cache.write('https://a.example', 2, frozen(2)), cache.write('https://a.example', 3, frozen(3))])
  const kept = [...store].filter(([key]) => key.includes(':season:'))
  assert.ok(kept.reduce((n, [, value]) => n + Buffer.byteLength(JSON.stringify(value)), 0) <= size * 2 + 100)
  assert.deepEqual(store.get('offline:v1'), { cards: ['keep'] }); assert.equal(store.get('server:https://a.example:session'), 'keep')
  assert.deepEqual(store.get('server:https://a.example:cache'), { cards: ['keep'] })
  assert.ok(await cache.read('https://a.example', 3))
})

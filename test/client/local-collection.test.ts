// The offline collection (SPEC 4, 6, 19, 24): pack charging and the bank, buying and opening, the team, fusion,
// recycling, crafting and the Wandering Trader, each by the core rule the server uses.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Card, Family } from '../../plugin/hooks/core/types.ts'
import { craftCost, mintCard, recycleValue } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { familySpecies, getSpecies, legendaryOf } from '../../plugin/hooks/core/species.ts'
import { traderDeals } from '../../plugin/hooks/core/trader.ts'
import { DAY_MS, EPOCH_MS, SEASON_MS, dailyRule, fusionCost, seasonOf } from '../../plugin/hooks/core/world.ts'
import { createLocalBackend } from '../../plugin/hooks/client/local/index.ts'
import type { LocalState } from '../../plugin/hooks/client/local/save.ts'
import { encodeState, openSave } from '../../plugin/hooks/client/local/save.ts'
import { BackendError } from '../../plugin/hooks/client/types.ts'

const NOW = EPOCH_MS + 3 * DAY_MS + 3_600_000
const MIN = 60_000

function world(o: { family?: Family; seed?: string } = {}) {
  const w = { stored: undefined as unknown, now: NOW, saves: 0 }
  const backend = createLocalBackend({
    load: async () => (w.stored === undefined ? undefined : JSON.parse(JSON.stringify(w.stored))),
    save: async v => { w.saves++; w.stored = JSON.parse(JSON.stringify(v)) },
    now: async () => w.now,
    random: rngFromSeed(o.seed ?? 'collection'),
    family: () => o.family ?? 'opus',
  })
  const edit = (fn: (s: LocalState) => void) => {
    const opened = openSave(w.stored)
    if (opened.kind !== 'ok') throw new Error('no save')
    fn(opened.state)
    w.stored = JSON.parse(JSON.stringify(encodeState(opened.state, 'edited')))
  }
  const cards = async () => (await backend.cards({})).cards
  return Object.assign(w, { backend, edit, cards })
}

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  const err = await p.then(() => null, (e: unknown) => e)
  assert.ok(err instanceof BackendError, `expected ${code}, got ${String(err)}`)
  assert.equal(err.code, code, err.message)
}

let given = 0

/** Free cards of a family and rarity minted straight into the save. */
function give(w: ReturnType<typeof world>, family: Family, rarity: Card['rarity'], n: number): string[] {
  const ids: string[] = []
  w.edit(s => {
    for (let i = 0; i < n; i++) {
      const species = rarity === 'legendary' ? legendaryOf(seasonOf(w.now), family) : familySpecies(seasonOf(w.now), family)[i % 8]!
      const id = `given${given++}`
      s.cards.push({ ...mintCard({ species, rarity, shiny: false, dna: 1000 + i, origin: 'pack', now: w.now }), id })
      ids.push(id)
    }
  })
  return ids
}

test('presence charges a pack 45 minutes apart into a bank of 12; past 16 a day the lamp slows to 90', async () => {
  const w = world()
  assert.equal((await w.backend.me({})).player.nextChargeAt, NOW + ECONOMY.packs.chargeSpacingMs, 'hatching counts as a charge')
  await refused(w.backend.chargePack({ family: 'fable' }), 'rate_limited')
  w.now += ECONOMY.packs.chargeSpacingMs
  const first = await w.backend.chargePack({ family: 'fable' })
  assert.equal(first.packs.length, 3)
  assert.deepEqual([first.packs[2]!.family, first.packs[2]!.source], ['fable', 'charge'])
  assert.equal((await w.backend.me({})).player.nextChargeAt, w.now + ECONOMY.packs.chargeSpacingMs)
  await refused(w.backend.chargePack({ family: 'fable' }), 'rate_limited')
  w.now += ECONOMY.packs.chargeSpacingMs
  assert.equal((await w.backend.chargePack({ family: 'haiku' })).packs.length, 4)

  w.edit(s => { s.packs = s.packs.concat(Array.from({ length: 8 }, (_, i) => ({ id: `bank${i}`, family: 'opus' as const, source: 'charge' as const, day: '2026-10-04', lockUntil: 0, bound: false }))) })
  w.now += ECONOMY.packs.chargeSpacingMs
  await refused(w.backend.chargePack({ family: 'haiku' }), 'cap_reached')
  await w.backend.openPack({ packId: 'bank0' })
  assert.equal((await w.backend.chargePack({ family: 'haiku' })).packs.length, 12)

  w.edit(s => { s.packs = []; s.charges = Array.from({ length: 16 }, (_, i) => w.now - i * MIN); s.lastChargeAt = w.now })
  assert.equal((await w.backend.me({})).player.nextChargeAt, w.now + 2 * ECONOMY.packs.chargeSpacingMs)
  w.now += ECONOMY.packs.chargeSpacingMs
  await refused(w.backend.chargePack({ family: 'haiku' }), 'rate_limited')
  w.now += ECONOMY.packs.chargeSpacingMs
  await w.backend.chargePack({ family: 'haiku' })
})

test('packs cost 150 sparks with no limit; opening rolls five current-season cards into the album', async () => {
  const w = world()
  await w.backend.me({})
  await refused(w.backend.buyPack({ family: 'sonnet' }), 'insufficient_sparks')
  w.edit(s => { s.sparks = 1000 })
  for (let i = 0; i < 5; i++) await w.backend.buyPack({ family: 'sonnet' })
  const me = await w.backend.me({})
  assert.equal(me.player.sparks, 1000 - 5 * ECONOMY.packs.buyCost)
  const bought = me.packs.filter(p => p.source === 'bought')
  assert.equal(bought.length, 5)

  const { cards } = await w.backend.openPack({ packId: bought[0]!.id })
  assert.equal(cards.length, ECONOMY.packs.size)
  for (const c of cards) {
    assert.deepEqual([c.family, c.season, c.origin, c.lockedUntil, c.bound], ['sonnet', seasonOf(NOW), 'pack', 0, false])
    assert.ok(getSpecies(c.species))
  }
  const after = await w.backend.me({})
  for (const c of cards) assert.ok(after.player.seen.includes(c.species))
  assert.equal(after.packs.length, me.packs.length - 1)
  assert.equal((await w.cards()).length, 3 + 5)
  await refused(w.backend.openPack({ packId: bought[0]!.id }), 'not_found')
})

test('the team takes up to three of your own cards', async () => {
  const w = world()
  const me = await w.backend.me({})
  const [a, b] = me.player.team
  assert.deepEqual(await w.backend.setTeam({ cardIds: [b!, a!] }), { team: [b, a] })
  assert.deepEqual((await w.backend.me({})).player.team, [b, a])
  await refused(w.backend.setTeam({ cardIds: ['nosuchcard'] }), 'not_found')
  assert.deepEqual(await w.backend.setTeam({ cardIds: [] }), { team: [] })
})

test('fusion: two free cards become one hybrid for the day\'s price; starters stay; a hybrid keeps a trade lock', async () => {
  const w = world()
  const me = await w.backend.me({})
  const cost = fusionCost(dailyRule(NOW))
  const [a, b] = give(w, 'haiku', 'rare', 2)
  w.edit(s => { s.team = [a!, ...s.team.slice(0, 2)]; s.cards = s.cards.map(c => (c.id === b ? { ...c, lockedUntil: NOW + DAY_MS } : c)) })
  await refused(w.backend.fuse({ cardId: a!, otherId: a! }), 'bad_request')
  await refused(w.backend.fuse({ cardId: a!, otherId: me.player.team[0]! }), 'not_allowed')
  await refused(w.backend.fuse({ cardId: a!, otherId: 'nosuchcard' }), 'not_found')
  const res = await w.backend.fuse({ cardId: a!, otherId: b! })
  assert.deepEqual(res.consumed, [a, b])
  assert.deepEqual([res.card.species, res.card.form?.kind, res.card.form?.parents, res.card.origin, res.card.lockedUntil], ['fusion', 'fusion', [familySpecies(1, 'haiku')[0]!.id, familySpecies(1, 'haiku')[1]!.id], 'fusion', NOW + DAY_MS])
  const after = await w.backend.me({})
  assert.equal(after.player.sparks, me.player.sparks - cost)
  assert.ok(!after.player.team.includes(a!))
  const cards = await w.cards()
  assert.ok(!cards.some(c => c.id === a || c.id === b))
  assert.ok(cards.some(c => c.id === res.card.id))
  assert.ok(!after.player.seen.includes('fusion'), 'a hybrid is not an album species')
  w.edit(s => { s.sparks = cost - 1 })
  const [c, d] = give(w, 'opus', 'common', 2)
  await refused(w.backend.fuse({ cardId: c!, otherId: d! }), 'insufficient_sparks')
})

test('recycling pays by rarity and finish, takes the card off the team, and never takes a starter', async () => {
  const w = world()
  const me = await w.backend.me({})
  await refused(w.backend.recycle({ cardId: me.player.team[0]! }), 'not_allowed')
  const [epic] = give(w, 'fable', 'epic', 1)
  w.edit(s => { s.team = [epic!]; s.cards = s.cards.map(c => (c.id === epic ? { ...c, shiny: true, foil: true } : c)) })
  const card = (await w.cards()).find(c => c.id === epic)!
  const res = await w.backend.recycle({ cardId: epic! })
  assert.equal(res.gained, recycleValue(card))
  assert.equal(res.gained, Math.round(ECONOMY.recycle.epic * ECONOMY.recycleShiny * ECONOMY.recycleFoil))
  assert.equal(res.sparks, me.player.sparks + res.gained)
  assert.deepEqual((await w.backend.me({})).player.team, [])
  await refused(w.backend.recycle({ cardId: epic! }), 'not_found')
})

test('crafting makes a current-season creature at its rarity\'s price', async () => {
  const w = world()
  await w.backend.me({})
  w.edit(s => { s.sparks = 10_000 })
  const season = seasonOf(NOW)
  const regular = familySpecies(season, 'sonnet')[3]!
  const { card } = await w.backend.craft({ speciesId: regular.id, rarity: 'epic' })
  assert.deepEqual([card.species, card.rarity, card.origin, card.level], [regular.id, 'epic', 'craft', 1])
  assert.equal((await w.backend.me({})).player.sparks, 10_000 - craftCost('epic'))
  await refused(w.backend.craft({ speciesId: regular.id, rarity: 'legendary' }), 'bad_request')
  await refused(w.backend.craft({ speciesId: legendaryOf(season, 'sonnet').id, rarity: 'rare' }), 'bad_request')
  const legend = await w.backend.craft({ speciesId: legendaryOf(season, 'sonnet').id, rarity: 'legendary' })
  assert.deepEqual([legend.card.stage, legend.card.foil], [3, true])
  await refused(w.backend.craft({ speciesId: `s${season + 1}-sonnet-0`, rarity: 'common' }), 'not_allowed')
  w.now += SEASON_MS
  await refused(w.backend.craft({ speciesId: regular.id, rarity: 'common' }), 'not_allowed')
  w.edit(s => { s.sparks = 10 })
  await refused(w.backend.craft({ speciesId: `s${seasonOf(w.now)}-sonnet-0`, rarity: 'common' }), 'insufficient_sparks')
})

test('the Wandering Trader: today\'s three deals, each once a day, paid with free cards only', async () => {
  const w = world()
  await w.backend.me({})
  const today = await w.backend.trader({})
  assert.deepEqual(today.deals, traderDeals(NOW).map(d => ({ ...d, used: false })))
  for (const [k, deal] of today.deals.entries()) {
    const family = deal.give.family ?? 'haiku'
    const rarity = deal.give.rarity ?? 'common'
    const ids = give(w, family, rarity, deal.give.count)
    await refused(w.backend.traderDeal({ dealId: deal.id, cardIds: [...ids, ...give(w, family, rarity, 1)] }), 'not_allowed')
    const before = (await w.cards()).length
    const res = await w.backend.traderDeal({ dealId: deal.id, cardIds: ids })
    assert.deepEqual(res.consumed, ids)
    if (deal.get.kind === 'cards') {
      assert.equal(res.cards.length, deal.get.count)
      for (const c of res.cards) assert.deepEqual([c.family, c.rarity, c.origin], [deal.get.family, deal.get.rarity, 'trader'])
    } else {
      assert.equal(res.packs.length, deal.get.count)
      for (const p of res.packs) assert.deepEqual([p.family, p.source], [deal.get.family, 'trader'])
    }
    assert.equal((await w.cards()).length, before - ids.length + res.cards.length)
    const again = give(w, family, rarity, deal.give.count)
    await refused(w.backend.traderDeal({ dealId: deal.id, cardIds: again }), 'conflict')
    assert.equal((await w.backend.trader({})).deals[k]!.used, true)
  }
  const starter = (await w.backend.me({})).player.team[0]!
  w.now += DAY_MS
  const tomorrow = await w.backend.trader({})
  assert.ok(tomorrow.deals.every(d => !d.used))
  await refused(w.backend.traderDeal({ dealId: today.deals[0]!.id, cardIds: [starter] }), 'not_found')
  await refused(w.backend.traderDeal({ dealId: tomorrow.deals[0]!.id, cardIds: [starter] }), 'not_allowed')
})

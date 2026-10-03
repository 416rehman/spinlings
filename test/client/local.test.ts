// LocalBackend's door (SPEC 28): the first run, the views, the operations it answers and the ones it refuses, strict
// requests, and that it stays inside its own save with no network at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import type { ApiOp, ApiRequest } from '../../plugin/hooks/core/api.ts'
import { API_ROUTES } from '../../plugin/hooks/core/api.ts'
import type { Family } from '../../plugin/hooks/core/types.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { beatenBy, beats } from '../../plugin/hooks/core/families.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { RESPONSE_SCHEMAS, parseMeResponse } from '../../plugin/hooks/core/schemas.ts'
import { GENERATOR_VERSION, getSpecies, seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { DAY_MS, EPOCH_MS, utcDay, worldOf } from '../../plugin/hooks/core/world.ts'
import { createLocalBackend, OFFLINE_HANDLE } from '../../plugin/hooks/client/local/index.ts'
import { BackendError } from '../../plugin/hooks/client/types.ts'

const NOW = EPOCH_MS + 3 * DAY_MS + 3_600_000

/** A local world over a JSON store, like $.store: every load is a fresh copy, every save is counted. */
function world(o: { family?: Family; seed?: string; now?: number } = {}) {
  const w = { stored: undefined as unknown, now: o.now ?? NOW, loads: 0, saves: 0 }
  const backend = createLocalBackend({
    load: async () => { w.loads++; return w.stored === undefined ? undefined : JSON.parse(JSON.stringify(w.stored)) },
    save: async v => { w.saves++; w.stored = JSON.parse(JSON.stringify(v)) },
    now: async () => w.now,
    random: rngFromSeed(o.seed ?? 'local'),
    family: () => o.family ?? 'opus',
  })
  return Object.assign(w, { backend })
}

async function refused(p: Promise<unknown>, code: string): Promise<BackendError> {
  const err = await p.then(() => null, (e: unknown) => e)
  assert.ok(err instanceof BackendError, `expected a BackendError ${code}, got ${String(err)}`)
  assert.equal(err.code, code, err.message)
  assert.equal(err.kind, 'refused')
  assert.equal(err.status, 0)
  return err
}

test('the first me() hatches a save: starter team set, two welcome packs, 100 sparks, saved once', async () => {
  for (const family of ['haiku', 'sonnet', 'opus', 'fable'] as const) {
    const w = world({ family, seed: family })
    const me = await w.backend.me({})
    assert.deepEqual(parseMeResponse(me), me)
    assert.equal(w.saves, 1)
    const p = me.player
    assert.deepEqual([p.handle, p.sparks, p.rating, p.league, p.battles, p.streak, p.canTrade, p.leaderboard], [OFFLINE_HANDLE, 100, 1000, 'Pebble', 0, 0, false, false])
    // hatching counts as a charge: the welcome packs are the first payoff, the lamp starts from here
    assert.deepEqual([p.joinedDay, p.nextWildAt, p.nextDuelAt, p.nextChargeAt], [utcDay(NOW), 0, 0, NOW + ECONOMY.packs.chargeSpacingMs])
    assert.equal(me.now, NOW)
    assert.deepEqual([me.offers, me.gifts, me.notices], [{ incoming: [], outgoing: [] }, [], []])

    const { cards, version } = await w.backend.cards({})
    assert.equal(version, p.cardsVersion)
    assert.equal(cards.length, 3)
    assert.deepEqual(p.team, cards.map(c => c.id))
    assert.deepEqual(cards.map(c => c.family), [family, beats(family), beatenBy(family)])
    for (const c of cards) {
      assert.deepEqual([c.bound, c.level, c.xp, c.stage, c.rarity, c.origin, c.state], [true, 3, ECONOMY.starter.xp, 1, 'common', 'starter', 'owned'])
      assert.match(c.id, /^[a-z2-7]{10}$/, 'offline ids are short and never look like a server id')
    }
    assert.deepEqual(p.seen, cards.map(c => c.species))

    assert.equal(me.packs.length, 2)
    assert.deepEqual(me.packs.map(x => x.source), ['welcome', 'welcome'])
    assert.equal(me.packs[0]!.family, family)
    assert.notEqual(me.packs[1]!.family, family)
    const opened = await w.backend.openPack({ packId: me.packs[0]!.id })
    for (const c of opened.cards) assert.equal(c.lockedUntil, NOW + ECONOMY.welcomeLockMs, 'welcome cards open trade-locked for 7 days')
  }
})

test('reading is quiet: me, cards, world, season and trader write nothing until something changes', async () => {
  const w = world()
  await w.backend.me({})
  const saves = w.saves
  await w.backend.me({})
  await w.backend.cards({})
  await w.backend.world({})
  await w.backend.season({ season: 1 })
  await w.backend.trader({})
  assert.equal(w.saves, saves)
  w.now += DAY_MS
  const me = await w.backend.me({})
  assert.equal(me.player.sparks, 100 + ECONOMY.sparks.dailyHello, 'the daily hello, once')
  assert.equal(w.saves, saves + 1)
  assert.equal((await w.backend.me({})).player.sparks, 100 + ECONOMY.sparks.dailyHello)
  assert.equal(w.saves, saves + 1)
})

test('the living world comes from the date, and seasons from the generator', async () => {
  const w = world()
  assert.deepEqual(await w.backend.world({}), { ...worldOf(NOW), players: 1 })
  const s1 = await w.backend.season({ season: 1 })
  assert.deepEqual([s1.season, s1.generator], [1, GENERATOR_VERSION])
  assert.deepEqual(s1.species, seasonSpecies(1).map(s => ({ ...s, base: { ...s.base }, names: [...s.names] })))
  await refused(w.backend.season({ season: 2 }), 'not_found')
})

test('it answers exactly the offline operations; the rest need the online world and touch nothing', async () => {
  const w = world()
  const me = await w.backend.me({})
  const day = utcDay(NOW)
  const species = getSpecies('s1-opus-0')!.id
  const sample: { [K in ApiOp]?: ApiRequest<K> } = {
    season: { season: 1 }, world: {}, me: {}, cards: {}, chargePack: { family: 'opus' }, buyPack: { family: 'opus' },
    openPack: { packId: me.packs[0]!.id }, setTeam: { cardIds: [] }, startBattle: { kind: 'wild', family: 'opus' },
    finishBattle: { battleId: 'nobattle', inputs: [] }, catchCreature: { battleId: 'nobattle', index: 0 },
    fuse: { cardId: 'a', otherId: 'b' }, recycle: { cardId: 'a' }, craft: { speciesId: species, rarity: 'common' }, trader: {},
    traderDeal: { dealId: `${day}-0`, cardIds: ['a'] },
  }
  for (const op of Object.keys(API_ROUTES) as ApiOp[]) {
    if (op === 'deleteMe') continue
    if (!API_ROUTES[op].offline) {
      const before = { loads: w.loads, saves: w.saves, stored: JSON.stringify(w.stored) }
      const err = await refused(w.backend.call(op, {} as never), 'not_allowed')
      assert.match(err.message, /online world/)
      assert.deepEqual({ loads: w.loads, saves: w.saves, stored: JSON.stringify(w.stored) }, before, `${op} must not even read the save`)
      continue
    }
    const req = sample[op]
    assert.ok(req, `a sample request for ${op}`)
    const out = await w.backend.call(op, req as never).then(
      res => { RESPONSE_SCHEMAS[op](res, '$'); return 'ok' },
      (e: unknown) => (e instanceof BackendError ? e.code : String(e)),
    )
    assert.notEqual(out, 'not_allowed', `${op} is an offline operation`)
    assert.notEqual(out, 'unavailable', `${op} answered with a shape the schema refuses`)
  }
})

test('requests are as strict as the server\'s: unknown keys, bad ids and bad numbers are refused, nothing is saved', async () => {
  const w = world()
  await w.backend.me({})
  const saves = w.saves
  const bad: [ApiOp, unknown][] = [
    ['me', { extra: 1 }],
    ['cards', { cards: [] }],
    ['openPack', { packId: 'not a valid id!' }],
    ['openPack', { packId: 'x', card: { id: 'y' } }],
    ['finishBattle', { battleId: 'b', inputs: [3, 2] }],
    ['finishBattle', { inputs: [] }],
    ['catchCreature', { battleId: 'b', index: 7 }],
    ['setTeam', { cardIds: ['a', 'a'] }],
    ['craft', { speciesId: 's1-opus-0', rarity: 'mythic' }],
    ['season', { season: 0 }],
    ['traderDeal', { dealId: 'today', cardIds: ['a'] }],
    ['startBattle', { kind: 'wild', family: 'gpt' }],
  ]
  for (const [op, req] of bad) await refused(w.backend.call(op, req as never), 'bad_request')
  await refused(w.backend.call('me', null as never), 'bad_request')
  assert.equal(w.saves, saves)
})

test('deleting the offline account clears the save; the next visit hatches a fresh one', async () => {
  const w = world()
  const first = await w.backend.me({})
  assert.deepEqual(await w.backend.deleteMe({}), { deleted: true })
  assert.equal(w.stored, null)
  const again = await w.backend.me({})
  assert.notDeepEqual(again.player.team, first.player.team)
  assert.equal(again.player.sparks, 100)
})

test('the offline engine reaches nothing but its injected save, clock and dice', () => {
  const dir = new URL('../../plugin/hooks/client/local/', import.meta.url)
  const files = readdirSync(dir).filter(f => f.endsWith('.ts'))
  assert.ok(files.length >= 5)
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*\*[\s\S]*?\*\//g, '')
    for (const banned of [/\bfetch\b/, /\bhttp\b/i, /\$\./, /Math\.random/, /Date\.now/, /\bglobalThis\b/, /\bcrypto\b/, /\.\.\/remote\.ts/, /\.\.\/net\.ts/]) {
      assert.doesNotMatch(src, banned, `${f} must not use ${banned}`)
    }
    for (const m of src.matchAll(/from '([^']+)'/g)) {
      assert.match(m[1]!, /^\.\/|^\.\.\/\.\.\/core\/|^\.\.\/types\.ts$/, `${f} imports only core, its own files and the shared client types`)
    }
  }
})

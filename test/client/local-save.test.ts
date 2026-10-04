// The offline save (SPEC 28, 32): a compact versioned format, migrated forward and never reset, that keeps what it
// cannot read, shares the store safely with other sessions, and stays well inside $.store's 4 MiB.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Card, Family } from '../../plugin/hooks/core/types.ts'
import { applyXp, cardName, cardStats, fuse, mintCard } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY, seasonEnd } from '../../plugin/hooks/core/economy.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { GENERATOR_VERSION, familySpecies, legendaryOf, seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { DAY_MS, EPOCH_MS, SEASON_MS, seasonOf } from '../../plugin/hooks/core/world.ts'
import { createLocalBackend, recycleSuggestions } from '../../plugin/hooks/client/local/index.ts'
import type { LocalState } from '../../plugin/hooks/client/local/save.ts'
import { LIMITS, SAVE_VERSION, decodeCard, encodeCard, encodeState, migrate, openSave } from '../../plugin/hooks/client/local/save.ts'
import { BackendError } from '../../plugin/hooks/client/types.ts'

const NOW = EPOCH_MS + 3 * DAY_MS + 3_600_000

type Hooks = { onLoad?: (n: number) => void; failSave?: () => boolean }

function world(o: { family?: Family; seed?: string; stored?: unknown } & Hooks = {}) {
  const w = { stored: o.stored, now: NOW, loads: 0, saves: 0 }
  const backend = createLocalBackend({
    load: async () => {
      o.onLoad?.(++w.loads)
      return w.stored === undefined ? undefined : JSON.parse(JSON.stringify(w.stored))
    },
    save: async v => {
      if (o.failSave?.()) throw new Error('the store is full')
      w.saves++
      w.stored = JSON.parse(JSON.stringify(v))
    },
    now: async () => w.now,
    random: rngFromSeed(o.seed ?? 'save'),
    family: () => o.family ?? 'haiku',
  })
  const edit = (fn: (s: LocalState) => void) => {
    const opened = openSave(w.stored)
    if (opened.kind !== 'ok') throw new Error('no save')
    fn(opened.state)
    w.stored = JSON.parse(JSON.stringify(encodeState(opened.state, `edit${w.saves}`)))
  }
  return Object.assign(w, { backend, edit })
}

async function refused(p: Promise<unknown>, code: string): Promise<BackendError> {
  const err = await p.then(() => null, (e: unknown) => e)
  assert.ok(err instanceof BackendError, `expected ${code}, got ${String(err)}`)
  assert.equal(err.code, code, err.message)
  return err
}

function sampleCards(): Card[] {
  const rng = rngFromSeed('codec')
  const s = familySpecies(1, 'opus')
  const plain = { ...mintCard({ species: s[2]!, rarity: 'rare', shiny: false, dna: 123, origin: 'pack', now: NOW }), id: 'plaincard1' }
  const shiny = { ...mintCard({ species: s[5]!, rarity: 'epic', shiny: true, dna: 0xffffffff, origin: 'craft', now: NOW, foil: true, bound: true }), id: 'shinycard1', lockedUntil: NOW + 5, tiredUntil: NOW + 7 }
  const raised = { ...applyXp(mintCard({ species: s[1]!, rarity: 'common', shiny: false, dna: 9, origin: 'starter', now: NOW, level: 3, xp: 100 }), 40, 'fable').card, id: 'raisedcar1' }
  const legend = { ...mintCard({ species: legendaryOf(1, 'sonnet'), rarity: 'legendary', shiny: false, dna: 4, origin: 'season', now: NOW }), id: 'legendcar1' }
  const hybrid = { ...fuse(plain, raised, rng, NOW), id: 'hybridcar1' }
  const mythic = { ...generateMythic({ seed: 'codecmythic', dna: 77, now: NOW, level: 6 }), id: 'mythiccar1' }
  const flagged: Card = { ...plain, id: 'flagged001', forTrade: true, state: 'escrow', firstFind: true }
  return [plain, shiny, raised, legend, hybrid, mythic, flagged]
}

test('every card survives the compact form exactly, stats recomputed by the rules', () => {
  const cards = sampleCards()
  assert.equal(cards[2]!.raisedIn, 'fable')
  for (const c of cards) {
    const t = encodeCard(c)
    assert.deepEqual(decodeCard(JSON.parse(JSON.stringify(t))), c, c.id)
    assert.ok(JSON.stringify(t).length < (c.form ? 600 : 110), `${c.id} is ${JSON.stringify(t).length} characters`)
  }
  for (const broken of [null, [], ['x'], [...encodeCard(cards[0]!).slice(0, 15)], encodeCard(cards[0]!).map((v, i) => (i === 8 ? 11 : v)),
    encodeCard(cards[0]!).map((v, i) => (i === 7 ? [99] : v)), encodeCard(cards[4]!).slice(0, 16), [...encodeCard(cards[0]!), { kind: 'fusion' }]]) {
    assert.equal(decodeCard(broken), null)
  }
})

test('8,000 cards fit in well under the save\'s share of the 4 MiB store, and stay quick to read', async () => {
  const w = world()
  await w.backend.me({})
  const rng = rngFromSeed('many')
  w.edit(s => {
    for (let i = 0; i < LIMITS.cards - 3; i++) {
      const fam = (['haiku', 'sonnet', 'opus', 'fable'] as const)[i % 4]!
      const c = mintCard({ species: familySpecies(1, fam)[i % 8]!, rarity: i % 7 ? 'common' : 'rare', shiny: false, dna: Math.floor(rng() * 2 ** 32), origin: 'pack', now: NOW + i })
      s.cards.push({ ...c, id: `bulk${i.toString(36).padStart(6, '0')}` })
    }
  })
  const size = JSON.stringify(w.stored).length
  assert.ok(size < 1024 * 1024, `8,000 cards take ${size} characters`)
  assert.ok(size < LIMITS.bytes)
  const t0 = performance.now()
  const me = await w.backend.me({})
  const { cards } = await w.backend.cards({})
  const ms = performance.now() - t0
  assert.equal(cards.length, LIMITS.cards)
  assert.ok(ms < 3000, `reading took ${Math.round(ms)} ms`)

  // full: packs wait, recycling makes room, and the oldest free commons are the ones suggested
  assert.ok(me.notices.some(n => n.kind === 'notice' && /nearly full/.test(n.text)), 'a nearly-full notice')
  assert.equal((await w.backend.me({})).notices.filter(n => /nearly full/.test(n.text)).length, 1, 'once')
  await refused(w.backend.openPack({ packId: me.packs[0]!.id }), 'cap_reached')
  const suggested = recycleSuggestions(cards, me.player.team, 5)
  assert.deepEqual(suggested.map(c => c.id), cards.filter(c => c.id.startsWith('bulk') && c.rarity === 'common').slice(0, 5).map(c => c.id))
  for (const c of suggested) await w.backend.recycle({ cardId: c.id })
  assert.equal((await w.backend.openPack({ packId: me.packs[0]!.id })).cards.length, 5)
})

test('a save past its byte budget only shrinks; a store that refuses the write leaves the save as it was', async () => {
  let full = false
  const w = world({ failSave: () => full })
  const me = await w.backend.me({})
  const before = JSON.stringify(w.stored)
  full = true
  await refused(w.backend.openPack({ packId: me.packs[0]!.id }), 'cap_reached')
  assert.equal(JSON.stringify(w.stored), before)
  w.now += DAY_MS
  assert.equal((await w.backend.me({})).player.sparks, 100 + ECONOMY.sparks.dailyHello, 'reading still answers')
  assert.equal(JSON.stringify(w.stored), before)
  full = false
  assert.equal((await w.backend.openPack({ packId: me.packs[0]!.id })).cards.length, 5)

  w.edit(s => { s.extra.ballast = 'x'.repeat(LIMITS.bytes) })
  const big = JSON.stringify(w.stored)
  await refused(w.backend.openPack({ packId: me.packs[1]!.id }), 'cap_reached')
  assert.equal(JSON.stringify(w.stored), big)
  const victim = (await w.backend.cards({})).cards.find(c => !c.bound)!
  await w.backend.recycle({ cardId: victim.id })
  assert.ok(JSON.stringify(w.stored).length < big.length)
})

test('a store that cannot be read at all is one plain refusal, not a crash', async () => {
  const backend = createLocalBackend({
    load: async () => { throw new Error('disk trouble') }, save: async () => undefined, now: async () => NOW,
    random: rngFromSeed('broken'), family: () => 'opus',
  })
  const err = await refused(backend.me({}), 'unavailable')
  assert.equal(err.kind, 'refused')
  assert.match(err.message, /stumbled/)
})

test('a save this mod cannot read, or a newer mod\'s, is never touched; deleting it is the way out', async () => {
  for (const [stored, why] of [
    [{ v: SAVE_VERSION + 1, cards: [], something: 'new' }, /newer Spinlings/],
    ['not a save', /could not be read/],
    [{ cards: [] }, /could not be read/],
    [{ v: 0 }, /could not be read/],
  ] as const) {
    const w = world({ stored })
    for (const call of [() => w.backend.me({}), () => w.backend.cards({}), () => w.backend.chargePack({ family: 'opus' })]) {
      const err = await refused(call(), 'unavailable')
      assert.match(err.message, why)
    }
    assert.equal(w.saves, 0)
    assert.deepEqual(w.stored, stored)
    await w.backend.deleteMe({})
    assert.equal(w.stored, null)
    assert.equal((await w.backend.me({})).player.sparks, 100)
  }
})

test('keys and cards this version does not know are written back exactly as found', async () => {
  const w = world()
  await w.backend.me({})
  const strange = ['futurecard', 's1-opus-1', 1, 9, 0, 1, 0, [0], 1, 0, 1, -1, 0, 0, 0, 0]
  const oddPack = ['futurepack', 9, 0, '2026-10-04', 0, 0]
  const old = w.stored as { cards: unknown[]; packs: unknown[] }
  w.stored = { ...old, cards: [...old.cards, strange], packs: [...old.packs, oddPack], hereafter: { a: [1, 2] } }
  const me = await w.backend.me({})
  assert.equal((await w.backend.cards({})).cards.length, 3)
  await w.backend.openPack({ packId: me.packs[0]!.id })
  const stored = w.stored as { cards: unknown[]; packs: unknown[]; hereafter: unknown; v: number }
  assert.deepEqual(stored.hereafter, { a: [1, 2] })
  assert.deepEqual(stored.cards.at(-1), strange)
  assert.deepEqual(stored.packs.at(-1), oddPack)
  assert.equal(me.packs.length, 2)
  assert.equal(stored.v, SAVE_VERSION)
  assert.equal((await w.backend.cards({})).cards.length, 8)
})

test('older formats migrate forward step by step; a missing step leaves the save alone', () => {
  const steps = {
    1: (s: Record<string, unknown>) => ({ ...s, sparks: s.coins, coins: undefined }),
    2: (s: Record<string, unknown>) => ({ ...s, rating: 1234 }),
  }
  assert.deepEqual(migrate({ v: 1, coins: 7 }, 1, steps, 3), { v: 3, sparks: 7, coins: undefined, rating: 1234 })
  assert.throws(() => migrate({ v: 1 }, 1, { 2: steps[2] }, 3))

  const w = world()
  const old = { v: 1, joined: '2026-10-02', coins: 555, cards: [] }
  const opened = openSave(old, steps, 3)
  assert.equal(opened.kind, 'ok')
  if (opened.kind === 'ok') assert.deepEqual([opened.state.sparks, opened.state.rating, opened.state.joined], [555, 1234, '2026-10-02'])
  assert.deepEqual(openSave(old, { 1: steps[1] }, 3), { kind: 'unreadable' })
  assert.deepEqual(openSave({ v: 4 }, steps, 3), { kind: 'newer', version: 4 })
  assert.equal(w.saves, 0)
})

test('calls run one at a time, and another session\'s write in between sends the change round again', async () => {
  const w = world()
  const me = await w.backend.me({})
  const [a, b] = await Promise.all([w.backend.openPack({ packId: me.packs[0]!.id }), w.backend.openPack({ packId: me.packs[1]!.id })])
  assert.equal(a.cards.length + b.cards.length, 10)
  assert.equal((await w.backend.cards({})).cards.length, 13)

  // a second session buys a pack while this one is charging one: neither change is lost
  let other: ReturnType<typeof world> | null = null
  const w2 = world({
    seed: 'two',
    onLoad: n => {
      if (n === 2 && other) {
        other.stored = w2.stored
        other.edit(s => { s.sparks += 500; s.packs.push({ id: 'otherpack1', family: 'fable', source: 'bought', day: '2026-10-04', lockUntil: 0, bound: false }) })
        w2.stored = other.stored
      }
    },
  })
  await w2.backend.me({})
  w2.now += ECONOMY.packs.chargeSpacingMs
  other = world({ seed: 'other' })
  w2.loads = 0
  const sparks = (await w2.backend.me({})).player.sparks
  w2.loads = 0
  const res = await w2.backend.chargePack({ family: 'opus' })
  assert.equal(w2.loads, 4, 'read, saw the other write, read again, checked again')
  assert.ok(res.packs.some(p => p.id === 'otherpack1'), 'the other session\'s pack is still there')
  assert.ok(res.packs.some(p => p.source === 'charge'))
  assert.equal((await w2.backend.me({})).player.sparks, sparks + 500)
})

test('a new season grants its league\'s packs, softens the rating and leaves a notice; the generator is recorded', async () => {
  const w = world()
  await w.backend.me({})
  w.edit(s => { s.rating = 1750 })
  w.now += SEASON_MS
  const me = await w.backend.me({})
  const end = seasonEnd(1750)
  assert.equal(me.player.rating, end.rating)
  assert.equal(me.packs.filter(p => p.source === 'season').length, end.packs)
  assert.ok(me.notices[0]!.kind === 'season-end' && /Season 1 ended in Star: 5 reward packs and a foil legendary!/.test(me.notices[0]!.text))
  const legend = (await w.backend.cards({})).cards.find(c => c.origin === 'season')!
  assert.deepEqual([legend.rarity, legend.foil, legend.stage], ['legendary', true, 3])
  const stored = w.stored as { generators: Record<string, number>; season: number }
  assert.deepEqual(stored.generators, { 1: GENERATOR_VERSION, [seasonOf(w.now)]: GENERATOR_VERSION })
  assert.equal(stored.season, seasonOf(w.now))
  const again = await w.backend.me({})
  assert.equal(again.packs.filter(p => p.source === 'season').length, end.packs, 'once')
  w.now += 31 * DAY_MS
  assert.ok(!(await w.backend.me({})).notices.some(n => n.text.startsWith('Season 1 ended')), 'old notices go after 30 days')
})


test('the compact save resolves retained generator forms without storing render metadata', async () => {
  const w = world()
  await w.backend.me({})
  const cards = (await w.backend.cards({})).cards
  assert.ok(cards.every(c => c.appearance))
  for (const c of cards) {
    const form = seasonSpecies(c.season, undefined, 2).find(s => s.id === c.species)!
    assert.deepEqual(c.appearance, form)
    assert.equal(cardName(c), form.names[c.stage - 1])
    assert.deepEqual(cardStats(c), c.stats)
  }
  const battle = await w.backend.startBattle({ kind: 'wild', family: 'haiku' })
  assert.ok(battle.setup.attacker.every(c => c.appearance))
  assert.doesNotMatch(JSON.stringify(w.stored), /"(?:catalog|appearance|parentForms)":/)
  const opened = openSave(w.stored)
  assert.equal(opened.kind, 'ok')
  if (opened.kind === 'ok' && opened.state.battle?.state === 'open') {
    assert.deepEqual(opened.state.battle.setup.attacker.map(c => cardName(c)), battle.setup.attacker.map(c => cardName(c)))
  } else assert.fail('battle did not reopen')
  assert.equal((await w.backend.season({ season: 1 })).generator, 2)
})

test('unknown historical generators preserve card tuples while the current offline season remains usable', async () => {
  const w = world()
  await w.backend.me({})
  const tuples = (w.stored as { cards: unknown[] }).cards
  w.edit(s => { s.generators['1'] = 999 })
  w.now += 2 * SEASON_MS
  const me = await w.backend.me({})
  assert.equal(me.player.handle, 'offline')
  assert.equal((await w.backend.cards({})).cards.length, 0, 'unknown cards are held, never guessed')
  assert.deepEqual((w.stored as { cards: unknown[] }).cards, tuples)
  const season = seasonOf(w.now)
  assert.equal((await w.backend.season({ season })).generator, GENERATOR_VERSION)
  const fresh = await w.backend.openPack({ packId: me.packs[0]!.id })
  assert.ok(fresh.cards.every(c => c.season === season && c.appearance))
  const stored = w.stored as { cards: unknown[]; generators: Record<string, number> }
  assert.deepEqual(stored.cards.slice(-tuples.length), tuples)
  assert.equal(stored.generators['1'], 999)
})

test('a stored unknown catalog key survives local render catalog resolution', async () => {
  const w = world()
  await w.backend.me({})
  const extra = { future: ['keep this value'], revision: 7 }
  ;(w.stored as Record<string, unknown>).catalog = extra
  w.now += DAY_MS
  await w.backend.me({})
  assert.deepEqual((w.stored as Record<string, unknown>).catalog, extra)
  const reopened = openSave(w.stored)
  assert.equal(reopened.kind, 'ok')
  if (reopened.kind === 'ok') {
    assert.ok(reopened.state.catalog instanceof Map)
    assert.deepEqual(reopened.state.extra.catalog, extra)
  }
})

// The collection (SPEC 4, 6, 8, 19, 22, 24, 32): cards with server stats, packs (charge, buy, open),
// the team, for-trade, fusion, recycling, crafting, the wishlist and frozen seasons. Every answer is
// read with the client's own reader and must be exactly what it parsed (scaffold-helpers' exact).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { allCards } from '../../plugin/hooks/client/game.ts'
import { routeOf } from '../../plugin/hooks/core/api.ts'
import { cardStats, rarityRank, stageFor } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import type { Card, Family, NewCard, Rarity, Species } from '../../plugin/hooks/core/types.ts'
import { dailyRule, seasonOf, seasonStart } from '../../plugin/hooks/core/world.ts'
import { stmt } from '../../server/src/db.ts'
import { setPlayer } from '../../server/src/game/ctx.ts'
import { grantPack, mintCards } from '../../server/src/game/mint.ts'
import type { MintOptions } from '../../server/src/game/mint.ts'
import { DAY, exact, FIRST_CHARGE, HOUR, MINUTE, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n))
const env = (s: Server) => ({ db: s.db, now: s.now(), randomBytes: rand })
let seed = 0

/** A current-season card exactly as asked: no shiny or foil unless asked (legendaries are always foil). */
function fresh(s: Server, family: Family, rarity: Rarity, o: { shiny?: boolean; foil?: boolean; level?: number } = {}): NewCard {
  const { foil: _, ...c } = mintFor(family, rarity, rngFromSeed(`fresh/${seed++}`), s.now(), 'pack')
  const level = o.level ?? 1
  return { ...c, level, stage: rarity === 'legendary' ? 3 : stageFor(level), shiny: o.shiny ?? false, ...(o.foil || rarity === 'legendary' ? { foil: true as const } : {}) }
}

/** Mints cards straight into a collection, as a battle or a pack would. */
async function give(s: Server, p: Player, cards: NewCard[], o: MintOptions = {}): Promise<Card[]> {
  const minted = await mintCards(env(s), p.id, cards, o)
  await s.db.batch(minted.stmts)
  return minted.cards
}

const update = (s: Server, p: Player, fields: Record<string, string | number>) => s.db.batch([setPlayer(p.id, fields)])
const escrow = (s: Server, id: string) =>
  s.db.batch([stmt(`UPDATE cards SET state = 'escrow', escrow_ref = 'o1', version = version + 1 WHERE id = ?`, id)])
/** 3 calendar days old with 10 finished battles: past the trust gate (SPEC 30). */
const trust = (s: Server, p: Player) => update(s, p, { joined: '2026-09-28', battles: 10 })
const ids = (cards: readonly { id: string }[]) => cards.map(c => c.id)
const starters = async (p: Player) => (await p.call('cards')).cards.filter(c => c.origin === 'starter')

describe('GET /v1/cards', () => {
  it("answers every one of the caller's cards with server-computed stats and the collection version", async () => {
    const s = server()
    const p = await s.join('sonnet')
    const q = await s.join('opus')
    await give(s, p, [fresh(s, 'fable', 'epic', { level: 5 }), { ...fresh(s, 'opus', 'rare'), stats: { hp: 999, atk: 999, def: 999, spd: 999 } }])
    const { cards, version } = await p.call('cards')
    assert.equal(cards.length, 5)
    assert.equal(version, (await p.call('me')).player.cardsVersion)
    for (const c of cards) assert.deepEqual(c.stats, cardStats(c), `${c.species} stats are the formula's`)
    const theirs = new Set(ids((await q.call('cards')).cards))
    assert.ok(cards.every(c => !theirs.has(c.id)), 'nobody else sees these cards')
  })

  it('answers a big collection a page at a time, each under the mod\'s 256 KB cap, oldest first', async () => {
    const s = server()
    const p = await s.join()
    await give(s, p, Array.from({ length: 900 }, (_, i) => fresh(s, (['opus', 'haiku', 'fable', 'sonnet'] as const)[i % 4]!, 'common')))
    s.tick(DAY)
    await give(s, p, [fresh(s, 'opus', 'rare')])
    const all = (await s.db.all<{ id: string }>('SELECT id FROM cards WHERE owner_id = ? ORDER BY minted, id', p.id)).map(r => r.id)
    const got: string[] = []
    let after: string | undefined
    let pages = 0
    do {
      const { path } = routeOf('cards', after === undefined ? {} : { after })
      const res = await s.request('GET', path, { token: p.token })
      const text = await res.text()
      assert.equal(res.status, 200)
      assert.ok(new TextEncoder().encode(text).length < 256 * 1024, `page ${pages} fits the mod's cap`)
      // `next` is part of the wire contract: the client's reader keeps every field of every page
      const page = exact('cards', JSON.parse(text))
      assert.equal(page.version, (await p.row()).cards_version)
      got.push(...ids(page.cards))
      after = page.next
      pages++
    } while (after !== undefined)
    assert.ok(pages >= 2, `${pages} pages`)
    assert.deepEqual(got, all, 'every card once, in order')
    // and the mod reads them all, through its own request builder
    assert.deepEqual(ids((await allCards({ cards: req => p.call('cards', req) })).cards), all)
    for (const bad of ['nope', '2026-10-02.', `2026-10-02.${'A'.repeat(26)}`]) {
      assert.equal((await s.request('GET', `/v1/cards?after=${bad}`, { token: p.token })).status, 400, bad)
    }
  })
})

describe('pack charging (SPEC 6, 24)', () => {
  it('accepts a charge 45 minutes after the last one, joining counting as one, with a Retry-After until then', async () => {
    const s = server()
    const p = await s.join()
    assert.equal(p.me.player.nextChargeAt, T0 + 45 * MINUTE, 'a new account waits like anyone else')
    const fresh = await p.fails('chargePack', { family: 'opus' })
    assert.deepEqual([fresh.status, fresh.code, fresh.headers.get('retry-after')], [429, 'rate_limited', '2700'])
    s.tick(FIRST_CHARGE)
    const first = await p.call('chargePack', { family: 'opus' })
    assert.deepEqual(first.packs.map(k => [k.source, k.family]).filter(([src]) => src === 'charge'), [['charge', 'opus']])
    assert.equal((await p.call('me')).player.nextChargeAt, s.now() + 45 * MINUTE)
    const soon = await p.fails('chargePack', { family: 'opus' })
    assert.deepEqual([soon.status, soon.code, soon.headers.get('retry-after')], [429, 'rate_limited', '2700'])
    s.tick(44 * MINUTE)
    assert.equal((await p.fails('chargePack', { family: 'haiku' })).headers.get('retry-after'), '60')
    s.tick(MINUTE)
    const second = await p.call('chargePack', { family: 'haiku' })
    assert.equal(second.packs.filter(k => k.source === 'charge').length, 2)
  })

  it('doubles the spacing beyond 16 charges in 24 hours, and never stops charging', async () => {
    const s = server({ now: Date.UTC(2026, 9, 2, 1) })
    const p = await s.join()
    s.tick(FIRST_CHARGE)
    const clear = () => s.db.batch([stmt('DELETE FROM packs WHERE owner_id = ?', p.id)])
    for (let i = 0; i < 16; i++) {
      await p.call('chargePack', { family: 'fable' })
      await clear()
      s.tick(45 * MINUTE)
    }
    assert.equal((await p.fails('chargePack', { family: 'fable' })).headers.get('retry-after'), String(45 * 60), 'your lamp needs sleep')
    s.tick(45 * MINUTE)
    await p.call('chargePack', { family: 'fable' })
    s.tick(90 * MINUTE)
    await p.call('chargePack', { family: 'fable' })
    assert.equal(JSON.parse((await p.row()).charges).length, 18)
  })

  it('stops at a bank of 12 unopened packs until one is opened, while other pack sources go past it', async () => {
    const s = server()
    const p = await s.join()
    await update(s, p, { sparks: 10_000 })
    s.tick(FIRST_CHARGE)
    for (let i = 0; i < 10; i++) await p.call('buyPack', { family: 'haiku' })
    const full = await p.fails('chargePack', { family: 'opus' })
    assert.deepEqual([full.status, full.code], [429, 'cap_reached'])
    assert.match(full.message, /Open some packs to make room$/)
    const me = await p.call('me')
    assert.equal(me.packs.length, 12)
    await p.call('openPack', { packId: me.packs.find(k => k.source === 'bought')!.id })
    const charged = await p.call('chargePack', { family: 'opus' })
    assert.equal(charged.packs.length, 12)
    assert.equal((await p.call('buyPack', { family: 'opus' })).packs.length, 13, 'buying is not a charge')
  })
})

describe('buying packs', () => {
  it('costs 150 sparks a pack with no daily limit, and refuses what the player cannot afford', async () => {
    const s = server()
    const p = await s.join()
    const poor = await p.fails('buyPack', { family: 'sonnet' })
    assert.deepEqual([poor.status, poor.code], [409, 'insufficient_sparks'])
    assert.equal((await p.call('me')).packs.length, 2, 'nothing changed')
    await update(s, p, { sparks: 1000 })
    for (let i = 0; i < 6; i++) await p.call('buyPack', { family: 'sonnet' })
    const me = await p.call('me')
    assert.equal(me.player.sparks, 100)
    assert.deepEqual(me.packs.filter(k => k.source === 'bought').map(k => [k.family, k.day]), Array(6).fill(['sonnet', '2026-10-02']))
  })
})

describe('opening packs', () => {
  it("rolls exactly 2 current-season cards of the pack's family when opened, the last rare or better", async () => {
    const s = server()
    const p = await s.join()
    s.tick(FIRST_CHARGE)
    const { packs } = await p.call('chargePack', { family: 'fable' })
    const pack = packs.find(k => k.source === 'charge')!
    const before = (await p.call('me')).player.cardsVersion
    const { cards } = await p.call('openPack', { packId: pack.id })
    assert.equal(cards.length, 2)
    for (const c of cards) {
      assert.deepEqual([c.family, c.season, c.origin, c.bound, c.lockedUntil, c.state], ['fable', 1, 'pack', false, 0, 'owned'])
      assert.deepEqual(c.stats, cardStats(c))
    }
    assert.ok(rarityRank(cards[1]!.rarity) >= rarityRank('rare'))
    const me = await p.call('me')
    assert.equal(me.player.cardsVersion, before + 1)
    assert.ok(cards.every(c => me.player.seen.includes(c.species)), 'the album fills in')
    assert.ok(!me.packs.some(k => k.id === pack.id))
    const again = await p.fails('openPack', { packId: pack.id })
    assert.deepEqual([again.status, again.code], [404, 'not_found'])
    assert.equal((await p.call('cards')).cards.length, 5, 'a replay mints nothing')
  })

  it('opens welcome packs into cards free to trade at once, and bound packs into bound cards', async () => {
    const s = server()
    const p = await s.join()
    const welcome = (await p.call('me')).packs.find(k => k.source === 'welcome')!
    const { cards } = await p.call('openPack', { packId: welcome.id })
    assert.ok(cards.every(c => c.lockedUntil === 0 && !c.bound), 'no welcome lock (SPEC 8)')
    assert.equal((await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM packs WHERE lock_until > 0'))!.n, 0, 'no pack is made locked')
    const bound = grantPack(env(s), p.id, 'opus', 'promo', { bound: true })
    await s.db.batch([bound.stmt])
    assert.ok((await p.call('openPack', { packId: bound.pack.id })).cards.every(c => c.bound && c.lockedUntil === 0))
    // a pack made locked before 0003 opens free all the same
    const old = grantPack(env(s), p.id, 'haiku', 'welcome', { lockUntil: T0 + 7 * DAY })
    await s.db.batch([old.stmt])
    assert.ok((await p.call('openPack', { packId: old.pack.id })).cards.every(c => c.lockedUntil === 0))
  })

  it('rolls from the season the pack is opened in, not the one it was charged in', async () => {
    const s = server({ now: seasonStart(2) - HOUR })
    const p = await s.join()
    s.tick(FIRST_CHARGE)
    const { packs } = await p.call('chargePack', { family: 'haiku' })
    s.set(seasonStart(2) + HOUR)
    const { cards } = await p.call('openPack', { packId: packs.find(k => k.source === 'charge')!.id })
    assert.ok(cards.every(c => c.season === 2 && c.species.startsWith('s2-haiku-')))
  })
})

describe('the team', () => {
  it('saves up to 3 cards in slot order, and an unchanged team writes nothing', async () => {
    const s = server()
    const p = await s.join()
    const [a, b] = await give(s, p, [fresh(s, 'opus', 'rare'), fresh(s, 'haiku', 'common')])
    const [st] = await starters(p)
    assert.deepEqual((await p.call('setTeam', { cardIds: [b!.id, st!.id, a!.id] })).team, [b!.id, st!.id, a!.id])
    assert.deepEqual((await p.call('me')).player.team, [b!.id, st!.id, a!.id])
    const row = await p.row()
    assert.equal(row.team_size, 3)
    await p.call('setTeam', { cardIds: [b!.id, st!.id, a!.id] })
    assert.equal((await p.row()).version, row.version)
    assert.deepEqual((await p.call('setTeam', { cardIds: [] })).team, [])
    assert.equal((await p.row()).team_size, 0)
  })

  it('refuses a card held for a trade, more than 3 cards and the same card twice', async () => {
    const s = server()
    const p = await s.join()
    const [a, b, c, d] = await give(s, p, ['opus', 'haiku', 'fable', 'sonnet'].map(f => fresh(s, f as Family, 'common')))
    await escrow(s, a!.id)
    const held = await p.fails('setTeam', { cardIds: [a!.id] })
    assert.deepEqual([held.status, held.code], [403, 'not_allowed'])
    assert.equal((await p.fails('setTeam', { cardIds: [b!.id, c!.id, d!.id, a!.id] })).status, 400)
    assert.equal((await p.fails('setTeam', { cardIds: [b!.id, b!.id] })).status, 400)
    assert.equal((await p.call('me')).player.team.length, 3, 'the starters are still the team')
  })
})

describe('for trade', () => {
  it('lists a card from the first day, with no account limits, and takes it off any time', async () => {
    const s = server()
    const p = await s.join()
    const [c] = await give(s, p, [fresh(s, 'opus', 'rare')])
    const v0 = (await p.call('me')).player.cardsVersion
    assert.equal((await p.call('setForTrade', { cardId: c!.id, forTrade: true })).card.forTrade, true)
    assert.equal((await p.call('setForTrade', { cardId: c!.id, forTrade: true })).card.forTrade, true)
    assert.equal((await p.call('me')).player.cardsVersion, v0 + 1, 'a repeat changes nothing')
    assert.equal((await p.call('cards')).cards.find(x => x.id === c!.id)!.forTrade, true)
    await update(s, p, { battles: 0 })
    assert.equal((await p.call('setForTrade', { cardId: c!.id, forTrade: false })).card.forTrade, false)
  })

  it('never lists bound or held cards; an old trade lock no longer stops one', async () => {
    const s = server()
    const p = await s.join()
    const [st] = await starters(p)
    const [locked, held] = await give(s, p, [fresh(s, 'opus', 'rare'), fresh(s, 'haiku', 'rare')], { lockedUntil: T0 + 7 * DAY })
    await escrow(s, held!.id)
    assert.match((await p.fails('setForTrade', { cardId: st!.id, forTrade: true })).message, /for good/)
    assert.match((await p.fails('setForTrade', { cardId: held!.id, forTrade: true })).message, /held for a trade, a gift or the market/)
    assert.equal((await p.fails('setForTrade', { cardId: held!.id, forTrade: false })).code, 'not_allowed')
    assert.equal((await p.call('setForTrade', { cardId: locked!.id, forTrade: true })).card.forTrade, true)
  })
})

describe('fusion (SPEC 4)', () => {
  it("consumes both parents for 40 sparks into a hybrid with A's shape and B's family, logged but not in the album", async () => {
    const s = server()
    const p = await s.join()
    assert.notEqual(dailyRule(T0), 'fusionFair')
    const [a, b] = await give(s, p, [fresh(s, 'opus', 'common', { level: 6 }), fresh(s, 'fable', 'rare', { level: 8 })])
    const [st] = await starters(p)
    await p.call('setTeam', { cardIds: [a!.id, st!.id] })
    const seenBefore = (await p.call('me')).player.seen
    const { card, consumed } = await p.call('fuse', { cardId: a!.id, otherId: b!.id })
    assert.deepEqual(consumed, [a!.id, b!.id])
    assert.deepEqual([card.species, card.form!.kind, card.form!.parents, card.family, card.origin], ['fusion', 'fusion', [a!.species, b!.species], 'fable', 'fusion'])
    assert.deepEqual([card.level, card.stage, card.xp, card.season], [6, 2, 0, 1])
    assert.ok(['rare', 'epic'].includes(card.rarity))
    assert.deepEqual(card.stats, cardStats(card))
    const me = await p.call('me')
    assert.equal(me.player.sparks, 100 - 40)
    assert.deepEqual(me.player.team, [st!.id], 'a fused parent leaves the team')
    assert.deepEqual(me.player.seen, seenBefore)
    const left = ids((await p.call('cards')).cards)
    assert.ok(left.includes(card.id) && !left.includes(a!.id) && !left.includes(b!.id))
    const log = await s.db.all<{ form: string }>('SELECT form FROM fusions WHERE player_id = ?', p.id)
    assert.deepEqual(log.map(r => JSON.parse(r.form)), [card.form])
  })

  it('costs 20 sparks on Fusion Fair, with no daily limit', async () => {
    const day = Date.UTC(2026, 9, 25, 12)
    assert.equal(dailyRule(day), 'fusionFair')
    const s = server({ now: day })
    const p = await s.join()
    await update(s, p, { sparks: 200 })
    for (let i = 0; i < 6; i++) {
      const [a, b] = await give(s, p, [fresh(s, 'haiku', 'common'), fresh(s, 'sonnet', 'common')])
      await p.call('fuse', { cardId: a!.id, otherId: b!.id })
    }
    assert.equal((await p.call('me')).player.sparks, 200 - 6 * 20)
  })

  it('makes a hybrid free to trade, whatever its parents carried', async () => {
    const s = server()
    const p = await s.join()
    const [a] = await give(s, p, [fresh(s, 'opus', 'common')], { lockedUntil: T0 + 5 * DAY })
    const [b] = await give(s, p, [fresh(s, 'haiku', 'common')], { lockedUntil: T0 + 2 * DAY })
    assert.equal((await p.call('fuse', { cardId: a!.id, otherId: b!.id })).card.lockedUntil, 0)
  })

  it('refuses bound or held parents, one card twice and a fusion the player cannot afford, changing nothing', async () => {
    const s = server()
    const p = await s.join()
    const [st] = await starters(p)
    const [a, b, held] = await give(s, p, [fresh(s, 'opus', 'common'), fresh(s, 'haiku', 'common'), fresh(s, 'fable', 'common')])
    await escrow(s, held!.id)
    assert.match((await p.fails('fuse', { cardId: a!.id, otherId: st!.id })).message, /for good/)
    assert.match((await p.fails('fuse', { cardId: held!.id, otherId: a!.id })).message, /held for a trade/)
    assert.equal((await p.fails('fuse', { cardId: a!.id, otherId: a!.id })).status, 400)
    await update(s, p, { sparks: 39 })
    const poor = await p.fails('fuse', { cardId: a!.id, otherId: b!.id })
    assert.deepEqual([poor.status, poor.code], [409, 'insufficient_sparks'])
    assert.equal((await p.call('cards')).cards.length, 6)
    assert.equal((await p.call('me')).player.sparks, 39)
  })
})

describe('recycling (SPEC 6)', () => {
  it('pays by rarity: shiny doubles, foil adds half again, a Mythic doubles once more', async () => {
    const s = server()
    const p = await s.join()
    const mythic = (shiny: boolean) => generateMythic({ seed: `m${seed++}`, dna: seed, now: s.now(), shiny })
    const R = ECONOMY.recycle
    // legendaries and Mythics are always foil
    const cases: [NewCard, number][] = [
      [fresh(s, 'opus', 'common'), R.common],
      [fresh(s, 'opus', 'rare'), R.rare],
      [fresh(s, 'opus', 'epic'), R.epic],
      [fresh(s, 'opus', 'legendary'), Math.round(R.legendary * 1.5)],
      [fresh(s, 'haiku', 'common', { shiny: true }), R.common * 2],
      [fresh(s, 'haiku', 'rare', { foil: true }), Math.round(R.rare * 1.5)],
      [fresh(s, 'fable', 'epic', { shiny: true, foil: true }), Math.round(R.epic * 2 * 1.5)],
      [mythic(false), Math.round(R.legendary * 1.5 * 2)],
      [mythic(true), Math.round(R.legendary * 2 * 1.5 * 2)],
    ]
    let sparks = 100
    for (const [card, value] of cases) {
      const [c] = await give(s, p, [card])
      const res = await p.call('recycle', { cardId: c!.id })
      sparks += value
      assert.deepEqual(res, { sparks, gained: value }, `${c!.rarity}${c!.shiny ? ' shiny' : ''}${c!.foil ? ' foil' : ''} ${c!.species}`)
    }
    assert.equal((await p.call('me')).player.sparks, sparks)
    assert.equal((await p.call('cards')).cards.length, 3, 'only the starters are left')
  })

  it('never recycles a bound or held card, and takes a team card off the team', async () => {
    const s = server()
    const p = await s.join()
    const [st] = await starters(p)
    assert.match((await p.fails('recycle', { cardId: st!.id })).message, /for good/)
    const [held, team, locked] = await give(s, p, [fresh(s, 'opus', 'rare'), fresh(s, 'opus', 'rare'), fresh(s, 'opus', 'rare')])
    await escrow(s, held!.id)
    assert.equal((await p.fails('recycle', { cardId: held!.id })).code, 'not_allowed')
    await p.call('setTeam', { cardIds: [st!.id, team!.id] })
    await p.call('recycle', { cardId: team!.id })
    assert.deepEqual((await p.call('me')).player.team, [st!.id])
    assert.equal((await p.row()).team_size, 1)
    await s.db.batch([stmt('UPDATE cards SET locked_until = ? WHERE id = ?', T0 + DAY, locked!.id)])
    assert.equal((await p.call('recycle', { cardId: locked!.id })).gained, ECONOMY.recycle.rare, 'a trade lock does not stop recycling')
  })
})

describe('crafting (SPEC 4, 6)', () => {
  it('mints a fresh current-season card of the species for its rarity cost', async () => {
    const s = server()
    const p = await s.join()
    await update(s, p, { sparks: 4300 })
    const regular = seasonSpecies(1).find(sp => sp.family === 'sonnet' && !sp.legendary)!
    const legend = seasonSpecies(1).find(sp => sp.family === 'opus' && sp.legendary)!
    const made: Card[] = []
    for (const [species, rarity] of [[regular, 'common'], [regular, 'rare'], [regular, 'epic'], [legend, 'legendary']] as [Species, Rarity][]) {
      made.push((await p.call('craft', { speciesId: species.id, rarity })).card)
    }
    assert.deepEqual(made.map(c => [c.species, c.rarity, c.origin, c.level, c.stage, c.season]), [
      [regular.id, 'common', 'craft', 1, 1, 1], [regular.id, 'rare', 'craft', 1, 1, 1], [regular.id, 'epic', 'craft', 1, 1, 1],
      [legend.id, 'legendary', 'craft', 1, 3, 1],
    ])
    assert.equal(made[3]!.foil, true)
    assert.equal(new Set(made.map(c => c.dna)).size, 4, 'fresh DNA every time')
    const me = await p.call('me')
    assert.equal(me.player.sparks, 4300 - 50 - 200 - 800 - 3200)
    assert.ok(me.player.seen.includes(legend.id))
  })

  it("refuses a rarity the species never has, another season's species and a cost the player cannot meet", async () => {
    const s = server({ now: seasonStart(2) + HOUR })
    const p = await s.join()
    const regular = seasonSpecies(2).find(sp => !sp.legendary)!
    const legend = seasonSpecies(2).find(sp => sp.legendary)!
    assert.equal((await p.fails('craft', { speciesId: regular.id, rarity: 'legendary' })).status, 400)
    assert.equal((await p.fails('craft', { speciesId: legend.id, rarity: 'epic' })).status, 400)
    assert.equal((await p.fails('craft', { speciesId: 's1-haiku-0', rarity: 'common' })).code, 'not_allowed')
    assert.equal((await p.fails('craft', { speciesId: 's9999-haiku-0', rarity: 'common' })).code, 'not_allowed')
    assert.equal(await s.db.get('SELECT 1 FROM seasons WHERE season = 9999'), undefined, 'a far season is never generated to check it')
    const poor = await p.fails('craft', { speciesId: regular.id, rarity: 'rare' })
    assert.deepEqual([poor.code, (await p.call('me')).player.sparks], ['insufficient_sparks', 100])
  })
})

describe('the wishlist', () => {
  it('keeps up to 5 species from any season that has begun, in order', async () => {
    const s = server({ now: seasonStart(2) + HOUR })
    const p = await s.join()
    const five = ['s2-opus-3', 's1-haiku-0', 's2-fable-8', 's1-sonnet-7', 's2-haiku-1']
    assert.deepEqual((await p.call('setWishlist', { species: five })).wishlist, five)
    assert.deepEqual((await p.call('me')).player.wishlist, five)
    const row = await p.row()
    await p.call('setWishlist', { species: five })
    assert.equal((await p.row()).version, row.version, 'an unchanged list writes nothing')
    assert.equal((await p.fails('setWishlist', { species: [...five, 's2-opus-4'] })).status, 400)
    assert.equal((await p.fails('setWishlist', { species: ['s2-opus-3', 's2-opus-3'] })).status, 400)
    assert.equal((await p.fails('setWishlist', { species: ['s3-opus-3'] })).status, 400)
    assert.equal((await p.fails('setWishlist', { species: ['fusion'] })).status, 400)
    assert.deepEqual((await p.call('setWishlist', { species: [] })).wishlist, [])
    assert.deepEqual((await p.call('me')).player.wishlist, [])
  })
})

describe('frozen seasons in the collection (SPEC 32)', () => {
  it('keeps past-season cards whole after the season turns: they load, fuse and recycle', async () => {
    const s = server()
    const p = await s.join()
    const [a, b, c] = await give(s, p, [fresh(s, 'opus', 'rare'), fresh(s, 'haiku', 'common'), fresh(s, 'fable', 'epic')])
    s.set(seasonStart(2) + HOUR)
    const old = (await p.call('cards')).cards.filter(x => x.season === 1)
    assert.equal(old.length, 6)
    assert.deepEqual(old.find(x => x.id === a!.id)!.stats, a!.stats)
    const { card } = await p.call('fuse', { cardId: a!.id, otherId: b!.id })
    assert.deepEqual([card.season, card.form!.parents], [2, [a!.species, b!.species]])
    assert.equal((await p.call('recycle', { cardId: c!.id })).gained, ECONOMY.recycle.epic)
  })

  it("mints and serves the season's stored species, whatever the generator would make now", async () => {
    const SEASON = 83 // a season nothing else in this process uses
    const s = server({ now: seasonStart(SEASON) + HOUR })
    // a generated base hp is at most about 75; 300 stays far above it whatever the genes and traits
    const fake = (seasonSpecies(SEASON) as Species[]).map(sp => ({ ...sp, base: { hp: 300, atk: 30, def: 30, spd: 30 } }))
    await s.db.batch([stmt('INSERT INTO seasons (season, generator, species_json) VALUES (?, 1, ?)', SEASON, JSON.stringify(fake))])
    const p = await s.join()
    await update(s, p, { sparks: 1000 })
    const { card } = await p.call('craft', { speciesId: `s${SEASON}-fable-2`, rarity: 'rare' })
    assert.ok(card.stats.hp >= 200, `hp ${card.stats.hp} comes from the stored base`)
    const season = await s.call('season', { season: SEASON })
    assert.deepEqual([season.generator, season.species.find(sp => sp.id === card.species)!.base.hp], [1, 300])
    assert.equal(seasonOf(s.now()), SEASON)
    const opened = await p.call('openPack', { packId: (await p.call('me')).packs[0]!.id })
    assert.ok(opened.cards.every(x => x.stats.hp >= 200))
  })
})

describe('no daily quotas (SPEC 24)', () => {
  it('lets one player buy, open, fuse, recycle and craft again and again in one day', async () => {
    const s = server()
    const p = await s.join()
    await update(s, p, { sparks: 100_000 })
    let gained = 0
    for (let i = 0; i < 25; i++) {
      const { packs } = await p.call('buyPack', { family: 'haiku' })
      const { cards } = await p.call('openPack', { packId: packs.find(k => k.source === 'bought')!.id })
      const fused = await p.call('fuse', { cardId: cards[0]!.id, otherId: cards[1]!.id })
      gained += (await p.call('recycle', { cardId: fused.card.id })).gained
      await p.call('craft', { speciesId: 's1-haiku-0', rarity: 'common' })
      s.tick(MINUTE) // the per-token request bucket is 120 a minute
    }
    // each round: 2 opened, fused into 1 hybrid, that hybrid recycled, 1 crafted
    assert.equal((await p.call('cards')).cards.length, 3 + 25)
    assert.equal((await p.call('me')).player.sparks, 100_000 - 25 * (150 + 40 + 50) + gained)
  })
})

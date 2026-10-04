// Frozen species belong to one database. Reading another world cannot alter old cards, new rolls,
// website art or offline generation, even when requests interleave across awaits.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cardName, cardStats, mintCard, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { rollPack, rollWildTeam } from '../../plugin/hooks/core/packs.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { rollRival } from '../../plugin/hooks/core/rivals.ts'
import { getSpecies, resolveCard, seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { mintFor, rollTraderDeal } from '../../plugin/hooks/core/trader.ts'
import type { Card, Species, TraderDeal } from '../../plugin/hooks/core/types.ts'
import { seasonStart } from '../../plugin/hooks/core/world.ts'
import { stmt } from '../../server/src/db.ts'
import type { Db, SqlParam, Stmt } from '../../server/src/db.ts'
import { passkeyPage } from '../../server/src/game/auth.ts'
import { catalogOf, ensureSeason, ensureSeasons } from '../../server/src/game/ctx.ts'
import { cardsOf, ownCard, saveCard } from '../../server/src/game/mint.ts'
import { json, wireJson } from '../../server/src/http.ts'
import { cardSvg } from '../../server/src/pages-art.ts'
import type { CardRow } from '../../server/src/schema.ts'
import { softAuthenticator } from './passkeys-helpers.ts'
import { HOUR, server } from './scaffold-helpers.ts'
import type { Server } from './scaffold-helpers.ts'

const SEASON = 93
const frozen = (season: number, prefix: 'Amber' | 'Rain', hp: number): Species[] => seasonSpecies(season).map(s => {
  const names = s.names.map(n => prefix + n) as Species['names']
  return { ...s, names, name: names[0], hue: prefix === 'Amber' ? 30 : 230, base: { hp, atk: 30, def: 30, spd: 30 } }
})

async function world(season: number, prefix: 'Amber' | 'Rain', hp: number): Promise<Server> {
  const s = server({ now: seasonStart(season) + HOUR })
  await s.db.batch([stmt('INSERT INTO seasons (season, generator, species_json) VALUES (?, 1, ?)', season, JSON.stringify(frozen(season, prefix, hp)))])
  return s
}

describe('database-owned frozen seasons', () => {
  it('loads a cold many-season collection within bounded database reads and parameters', async () => {
    const s = server(), p = await s.join()
    const seed = (await s.db.get<CardRow>('SELECT * FROM cards WHERE id = ?', p.me.player.team[0]!))!
    const columns = Object.keys(seed)
    const inserts: Stmt[] = []
    for (let season = 1; season <= 121; season++) {
      inserts.push(stmt('INSERT INTO seasons (season, generator, species_json) VALUES (?, 1, ?) ON CONFLICT (season) DO NOTHING', season, JSON.stringify(frozen(season, 'Amber', 180))))
      const id = 'a'.repeat(24) + String.fromCharCode(97 + Math.floor(season / 26), 97 + season % 26)
      const row = { ...seed, id, species: `s${season}-haiku-1`, season }
      inserts.push(stmt(`INSERT INTO cards (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, ...columns.map(key => row[key as keyof CardRow])))
    }
    await s.db.batch(inserts)
    const reads: number[] = [], singles: string[] = []
    let writes = 0
    const cold: Db = {
      all<T>(sql: string, ...params: SqlParam[]) { reads.push(params.length); return s.db.all<T>(sql, ...params) },
      get<T>(sql: string, ...params: SqlParam[]) { singles.push(sql); return s.db.get<T>(sql, ...params) },
      batch: stmts => { writes++; return s.db.batch(stmts) },
    }
    const cards = await cardsOf(cold, p.id)
    assert.equal(cards.length, 124)
    assert.deepEqual(reads, [1, 90, 31], 'one card read and two season batches, each below the D1 parameter limit')
    assert.deepEqual(singles, [])
    assert.equal(writes, 0, 'reading stored seasons never rewrites them')
    assert.ok(cardName(cards.find(c => c.card.season === 121)!.card).startsWith('Amber'))
    await ensureSeasons(cold, cards.map(c => c.card.season))
    assert.deepEqual(reads, [1, 90, 31], 'a warm catalog needs no further database reads')
  })

  it('keeps each actual frozen list cached while another database loads the same season', async () => {
    const generated = JSON.stringify(seasonSpecies(SEASON))
    const [a, b] = await Promise.all([world(SEASON, 'Amber', 180), world(SEASON, 'Rain', 60)])
    const [first, second] = await Promise.all([ensureSeason(a.db, SEASON), ensureSeason(b.db, SEASON)])
    assert.equal(first.species[0]!.base.hp, 180)
    assert.equal(second.species[0]!.base.hp, 60)
    assert.equal((await ensureSeason(a.db, SEASON)).species, first.species)
    assert.equal((await ensureSeason(b.db, SEASON)).species, second.species)
    assert.notEqual(catalogOf(a.db), catalogOf(b.db))
    assert.ok(Object.isFrozen(first.species) && Object.isFrozen(first.species[0]!.base) && Object.isFrozen(first.species[0]!.names))
    assert.equal(JSON.stringify(seasonSpecies(SEASON)), generated, 'online frozen data never replaces offline generation')
    const untouched = server({ now: seasonStart(SEASON) + HOUR })
    assert.equal(JSON.stringify((await ensureSeason(untouched.db, SEASON)).species), generated, 'a third database freezes the pure generator')
  })

  it('joins, opens, crafts, loads legacy stats and saves XP from each database after interleaved reads', async () => {
    const [a, b] = await Promise.all([world(SEASON, 'Amber', 180), world(SEASON, 'Rain', 60)])
    const [pa, pb] = await Promise.all([a.join(), b.join()])
    for (const [s, p, prefix] of [[a, pa, 'Amber'], [b, pb, 'Rain']] as const) {
      const cards = await p.call('cards')
      assert.equal(cards.cards.length, 3)
      for (const c of cards.cards) {
        assert.deepEqual(c.stats, cardStats(c, catalogOf(s.db)))
        assert.ok(!Object.hasOwn(c, 'appearance') && !Object.hasOwn(c, 'parentForms'), 'local forms stay off the wire')
      }
      await s.db.batch([stmt('UPDATE players SET sparks = 1000 WHERE id = ?', p.id)])
      const crafted = (await p.call('craft', { speciesId: `s${SEASON}-fable-2`, rarity: 'rare' })).card
      assert.deepEqual(crafted.stats, cardStats(crafted, catalogOf(s.db)))
      const opened = await p.call('openPack', { packId: p.me.packs[0]!.id })
      for (const c of opened.cards) assert.deepEqual(c.stats, cardStats(c, catalogOf(s.db)))
      // Empty stats are pre-stats rows; their fallback must use the same frozen list as minting.
      await s.db.batch([stmt(`UPDATE cards SET stats = '{}' WHERE id = ?`, crafted.id)])
      const held = await ownCard(s.db, p.id, crafted.id)
      assert.deepEqual(held.card.stats, crafted.stats)
      assert.ok(cardName(held.card).startsWith(prefix))
      await s.db.batch([saveCard(held, { ...held.card, level: 4, stage: 2 })])
      const grown = (await ownCard(s.db, p.id, crafted.id)).card
      assert.deepEqual(grown.stats, cardStats(grown, catalogOf(s.db)))
      assert.ok(cardName(grown).startsWith(prefix))
      const html = await (await s.request('GET', `/c/${crafted.id}`)).text()
      assert.ok(html.includes(cardName(grown)), 'the public card name uses its own world')
    }
  })

  it('passes scoped species through pack, wild, Rival and Trader rolls without changing the offline rolls', async () => {
    const [a, b] = await Promise.all([world(SEASON, 'Amber', 180), world(SEASON, 'Rain', 60)])
    await Promise.all([ensureSeason(a.db, SEASON), ensureSeason(b.db, SEASON)])
    const deal: TraderDeal = { id: 'test-deal', name: 'A pair for a rare', give: { count: 2, family: 'haiku' }, get: { kind: 'cards', count: 1, rarity: 'rare', family: 'fable' } }
    for (const [s, prefix] of [[a, 'Amber'], [b, 'Rain']] as const) {
      const catalog = catalogOf(s.db), now = s.now()
      const rolls = [
        ...rollPack('haiku', SEASON, rngFromSeed('pack-isolation'), now, 'calm', catalog),
        ...rollWildTeam({ now, arena: 'haiku', level: 3, rng: rngFromSeed('wild-isolation'), rule: 'calm', catalog }),
        ...rollRival({ now, rating: 1000, power: 300, size: 3, rng: rngFromSeed('rival-isolation'), catalog }).team,
        ...rollTraderDeal(deal, rngFromSeed('trader-isolation'), now, catalog).cards,
        mintFor('sonnet', 'rare', rngFromSeed('mint-isolation'), now, 'pack', false, catalog),
      ]
      for (const c of rolls) {
        assert.deepEqual(c.stats, cardStats(c, catalog))
        if (!c.form) assert.ok(cardName(c).startsWith(prefix))
      }
    }
    const plain = rollPack('haiku', SEASON, rngFromSeed('pack-isolation'), a.now(), 'calm')
    assert.ok(plain.every(c => !c.appearance && !cardName(c).startsWith('Amber') && !cardName(c).startsWith('Rain')))
  })

  it('keys rendered card art by the resolved world, even with identical ids and DNA', async () => {
    const [a, b] = await Promise.all([world(SEASON, 'Amber', 180), world(SEASON, 'Rain', 60)])
    await Promise.all([ensureSeason(a.db, SEASON), ensureSeason(b.db, SEASON)])
    const make = (s: Server) => toBattleCard({ ...mintCard({ species: getSpecies(`s${SEASON}-haiku-1`, catalogOf(s.db))!, rarity: 'rare', dna: 42, shiny: false, origin: 'pack', now: s.now() }, catalogOf(s.db)), id: 'same-card' })
    const ca = make(a), cb = make(b)
    assert.notDeepEqual(spriteFor(ca), spriteFor(cb))
    const aa = cardSvg(ca), bb = cardSvg(cb)
    assert.notEqual(aa, bb, 'memoized art must include the frozen form, not just species and DNA')
    assert.equal(cardSvg(ca), aa)
    assert.equal(cardSvg(cb), bb)
    const fusion = resolveCard({ ...ca, species: 'fusion', appearance: undefined, form: { ...ca.appearance!, kind: 'fusion', parents: [ca.species, `s${SEASON}-sonnet-1`] } } as Card, catalogOf(a.db))
    const value = { cards: [ca, { child: fusion }], nested: { collection: [cb] } }
    const body = await json(value).json()
    assert.deepEqual(JSON.parse(wireJson(value)), body, 'stored snapshots use the same recursive projection as API answers')
    assert.ok(!JSON.stringify(body).includes('appearance') && !JSON.stringify(body).includes('parentForms'), 'nested owner and public responses omit local-only metadata')
    assert.ok(ca.appearance && fusion.parentForms, 'wire serialization does not mutate internal cards')
  })
})

it('turns the season once while keeping old cards, the account and a working saved passkey', async () => {
  const s = server()
  const p = await s.join()
  const before = (await p.call('cards')).cards
  const auth = await softAuthenticator()
  const origin = 'http://localhost:8787'
  const add = await p.call('passkeyStart')
  const addTicket = new URL(add.url).searchParams.get('t')!
  const addPage = await passkeyPage(s.db, { kind: 'add', ticket: addTicket, now: s.now(), rpId: 'localhost' })
  assert.ok(addPage?.kind === 'add')
  assert.equal((await s.request('POST', '/passkey/add/finish', { body: { ticket: addTicket, ...(await auth.create(addPage.options, origin)) } })).status, 200)
  await s.db.batch([stmt('UPDATE players SET rating = 1720 WHERE id = ?', p.id)])
  s.set(seasonStart(2) + HOUR)
  const first = await p.call('me')
  assert.equal(first.player.rating, 1360)
  assert.equal((await p.row()).season, 2)
  assert.equal(first.packs.filter(pack => pack.source === 'season').length, 5)
  const after = (await p.call('cards')).cards
  assert.deepEqual(after.filter(c => c.season === 1), before)
  const rewards = after.filter(c => c.origin === 'season')
  assert.equal(rewards.length, 1)
  assert.deepEqual([rewards[0]!.season, rewards[0]!.rarity, rewards[0]!.foil], [2, 'legendary', true])
  const again = await p.call('me')
  assert.equal(again.packs.filter(pack => pack.source === 'season').length, 5)
  assert.equal((await cardsOf(s.db, p.id)).filter(c => c.card.origin === 'season').length, 1)
  const signin = await s.call('authStart')
  const signinTicket = new URL(signin.url).searchParams.get('t')!
  const signinPage = await passkeyPage(s.db, { kind: 'signin', ticket: signinTicket, now: s.now(), rpId: 'localhost' })
  assert.ok(signinPage?.kind === 'signin')
  assert.equal((await s.request('POST', '/passkey/signin/finish', { body: { ticket: signinTicket, ...(await auth.get(signinPage.options, origin)) } })).status, 200)
  const done = await s.call('authPoll', { pollId: signin.pollId })
  assert.equal(done.status, 'done')
  if (done.status !== 'done') return
  const recovered = await s.as(done.token)
  assert.equal(recovered.id, p.id)
  assert.deepEqual((await recovered.call('cards')).cards, after)
  assert.equal((await recovered.call('devices')).passkeys, 1)
})

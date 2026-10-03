// What could tell another player which model someone uses (SPEC 6, 18, 20.2, 20.3, 20.9): the
// family they joined with, their packs and their families, and the arenas their cards were raised
// in. Nothing anyone else can see depends on any of them.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { beatenBy, beats, FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import type { Family } from '../../plugin/hooks/core/types.ts'
import { stmt } from '../../server/src/db.ts'
import { server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'
import { fresh, trust } from './social-helpers.ts'

const handle = (p: Player) => p.me.player.handle
const page = async (s: Server, path: string) => (await s.request('GET', path, { client: null })).text()

/** The same stream of random bytes on every server made from the same seed. */
const seeded = (seed: string) => {
  const rng = rngFromSeed(seed)
  return (n: number) => Uint8Array.from({ length: n }, () => Math.floor(rng() * 256))
}

/** The family a starter team was built around: the one whose beater and beaten are both on it. */
const homeOf = (team: readonly { family: Family }[]): Family => {
  const fams = new Set(team.map(c => c.family))
  return FAMILIES.find(f => fams.has(f) && fams.has(beats(f)) && fams.has(beatenBy(f)))!
}

describe('the family a player joins with (SPEC 6 First run, 20.2)', () => {
  it('changes nothing anyone else sees: the same profile and page, byte for byte, whichever model joined', async () => {
    const seen = new Set<string>()
    for (const family of FAMILIES) {
      const s = server({ randomBytes: seeded('one-join') })
      const p = await s.join(family)
      const profile = await p.call('profile', { handle: handle(p) })
      assert.equal(profile.team.length, 3)
      seen.add(JSON.stringify(profile) + (await page(s, `/u/${handle(p)}`)))
    }
    assert.equal(seen.size, 1)
  })

  it('builds the starter team around a family of its own, not the one joined with', async () => {
    const s = server()
    const homes = new Set<Family>()
    for (let i = 0; i < 12; i++) homes.add(homeOf((await (await s.join('opus')).call('cards')).cards))
    assert.ok(homes.size > 1, `12 opus joins, every team built around ${[...homes]}`)
  })
})

describe('what other players see (SPEC 20.3, 20.9)', () => {
  it('never a pack, its family, the arena or where a card was raised: profile, board, pages, a duel and its notice', async () => {
    const s = server()
    const a = await s.join('opus') // welcome packs: opus and one other
    const m = await s.join('haiku')
    await trust(s, a, m)
    const [x] = await fresh(s, a, 1, { family: 'sonnet' })
    await a.call('setForTrade', { cardId: x!.id, forTrade: true })
    await a.call('setLeaderboard', { optIn: true })
    await s.db.batch([
      stmt(`UPDATE cards SET raised_in = 'opus', arena_opus = 9, level = 4, stage = 2 WHERE owner_id = ?`, a.id),
      stmt('UPDATE cards SET stats = ? WHERE owner_id = ?', JSON.stringify({ hp: 999, atk: 999, def: 999, spd: 999 }), m.id),
    ])
    const packs = (await a.call('me')).packs
    assert.ok(packs.some(p => p.family === 'opus'), 'a holds a pack of the family they joined with')
    await m.call('setWishlist', { species: [] })

    // m duels a in m's own arena; a hears only the result
    const duel = await m.call('startBattle', { kind: 'duel', family: 'fable' })
    assert.deepEqual(duel.opponent, { kind: 'player', handle: handle(a), league: 'Pebble' })
    assert.equal(duel.setup.arena, 'fable', "the arena is the attacker's own")
    s.set(Math.max(s.now(), duel.startedAt + simulateBattle(duel.setup, []).rounds.length * ECONOMY.battle.minRoundMs))
    assert.equal((await m.call('finishBattle', { battleId: duel.id, inputs: [] })).result, 'win')
    const told = (await a.call('me')).notices.filter(n => n.kind.startsWith('defense'))
    assert.equal(told.length, 1)
    const words = [...FAMILIES, ...FAMILIES.map(f => FAMILY_INFO[f].name), 'arena', 'model']
    for (const n of told) for (const w of words) assert.ok(!n.text.toLowerCase().includes(w.toLowerCase()), `the notice says ${w}`)

    const seen: [string, unknown][] = [
      ['profile', await m.call('profile', { handle: handle(a) })],
      ['board', await m.call('board')],
      ['leaderboard', await m.call('leaderboard')],
      ['duel', duel.setup.defender],
      ['profile page', await page(s, `/u/${handle(a)}`)],
      ['card page', await page(s, `/c/${x!.id}`)],
      ['team card page', await page(s, `/c/${a.me.player.team[0]}`)],
    ]
    for (const [where, body] of seen) {
      const json = typeof body === 'string' ? body : JSON.stringify(body)
      for (const p of packs) assert.ok(!json.includes(p.id), `${where} names a pack`)
      for (const k of ['"packs"', '"source"', '"raisedIn"', '"arena', '"welcome"']) assert.ok(!json.includes(k), `${where} shows ${k}`)
      assert.doesNotMatch(json, /raised under|-raised|welcome pack/i, where)
    }
  })

  it('a card that changes hands forgets where it was raised and the arenas it fought in', async () => {
    const s = server()
    const a = await s.join('opus')
    const b = await s.join('haiku')
    await trust(s, a, b)
    const [g, t] = await fresh(s, a, 2)
    await s.db.batch([stmt(`UPDATE cards SET raised_in = 'opus', arena_opus = 9, level = 4, stage = 2 WHERE id IN (?, ?)`, g!.id, t!.id)])
    const { gift } = await a.call('gift', { cardId: g!.id })
    await b.call('claim', { code: gift.code })
    const { offer } = await a.call('offer', { to: handle(b), give: [t!.id], get: [] })
    await b.call('acceptOffer', { offerId: offer.id })
    const mine = (await b.call('cards')).cards
    for (const c of [g!, t!]) {
      assert.equal(mine.find(x => x.id === c.id)!.raisedIn, undefined, 'nothing says how the last owner raised it')
      assert.deepEqual(
        await s.db.get('SELECT owner_id, raised_in, arena_haiku, arena_sonnet, arena_opus, arena_fable FROM cards WHERE id = ?', c.id),
        { owner_id: b.id, raised_in: null, arena_haiku: 0, arena_sonnet: 0, arena_opus: 0, arena_fable: 0 },
      )
    }
  })
})

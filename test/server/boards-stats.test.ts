// Duels by handle, player stats and the global leaderboards (SPEC 8, 15, 20, 26): a challenge fights one player's
// saved team with the usual spacing, friendly (no rating, stats or bounty; it pays like a loss); every counter moves
// inside the batch of what it counts; other players see the numbers of the last midnight; the boards list every
// player who has not hidden, top 50 with the caller's own rank, all time and this season; Rivals never appear; and
// the 0003 migration backfills what the database already knew.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import type { BoardName, StartBattleRequest } from '../../plugin/hooks/core/api.ts'
import { simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { ECONOMY, leagueOf } from '../../plugin/hooks/core/economy.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import type { BattleSetup, Stats } from '../../plugin/hooks/core/types.ts'
import { SEASON_MS } from '../../plugin/hooks/core/world.ts'
import { migrateSqlite, nodeDb, stmt } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { NOTICE_TEXT } from '../../server/src/game/notices.ts'
import { loadMigrations } from '../../server/src/node.ts'
import type { PlayerRow } from '../../server/src/schema.ts'
import { DAY, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'
import { assertNoIds, envOf, fresh } from './social-helpers.ts'

const STRONG: Stats = { hp: 999, atk: 999, def: 999, spd: 999 }
const WEAK: Stats = { hp: 1, atk: 1, def: 1, spd: 1 }
const DUEL = ECONOMY.battle.duelSpacingMs
const handle = (p: Player) => p.me.player.handle
const statsAll = (s: Server, p: Player, stats: Stats) =>
  s.db.batch([stmt('UPDATE cards SET stats = ?, tired_until = 0 WHERE owner_id = ?', JSON.stringify(stats), p.id)])
const readyAt = (start: { startedAt: number; setup: BattleSetup }) =>
  start.startedAt + simulateBattle(start.setup, []).rounds.length * ECONOMY.battle.minRoundMs

/** A duel fought to the end with no presses, after the duel spacing. */
async function fight(s: Server, p: Player, req: StartBattleRequest) {
  s.tick(DUEL)
  const start = await p.call('startBattle', req)
  s.set(Math.max(s.now(), readyAt(start)))
  const fin = await p.call('finishBattle', { battleId: start.id, inputs: [] })
  return { start, fin }
}

/** A matched duel of `attacker` against `defender`, the only other player with a team out for it. */
async function duel(s: Server, attacker: Player, defender: Player) {
  const others = await s.db.all<{ id: string; team_size: number }>('SELECT id, team_size FROM players WHERE id NOT IN (?, ?)', attacker.id, defender.id)
  await s.db.batch([
    stmt('UPDATE players SET team_size = 0 WHERE id NOT IN (?, ?)', attacker.id, defender.id),
    stmt(`UPDATE players SET recent_opponents = '[]' WHERE id = ?`, attacker.id),
  ])
  const r = await fight(s, attacker, { kind: 'duel', family: 'opus' })
  await s.db.batch(others.map(o => stmt('UPDATE players SET team_size = ? WHERE id = ?', o.team_size, o.id)))
  assert.ok(r.start.opponent.kind === 'player' && r.start.opponent.handle === handle(defender))
  return r
}

/** `winner` beats `loser` in a matched duel, every card rested. */
async function beat(s: Server, winner: Player, loser: Player) {
  await statsAll(s, winner, STRONG)
  await statsAll(s, loser, WEAK)
  const r = await duel(s, winner, loser)
  assert.equal(r.fin.result, 'win')
  return r
}

/** To the next UTC midnight, when what others see catches up with today. */
const nextDay = (s: Server) => s.set((Math.floor(s.now() / DAY) + 1) * DAY)

const statsOf = async (p: Player) => (await p.call('me')).player.stats!

describe('a challenge by handle', () => {
  it('fights that player\'s saved team, with the defense notice and a revenge', async () => {
    const s = server()
    const [a, b, c] = [await s.join(), await s.join('fable'), await s.join()]
    await statsAll(s, a, STRONG)
    await statsAll(s, b, WEAK)
    const { start, fin } = await fight(s, a, { kind: 'duel', family: 'opus', handle: handle(b) })
    assert.deepEqual(start.opponent, { kind: 'player', handle: handle(b), league: 'Pebble' })
    assert.deepEqual(start.setup.defender.map(x => x.id), b.me.player.team, 'their saved team, not a random player\'s')
    assert.ok(!JSON.stringify(start).includes(b.id) && !JSON.stringify(start).includes(c.id))
    assert.equal(fin.result, 'win')
    assert.deepEqual([fin.ratingDelta, fin.sparks], [0, ECONOMY.battle.sparks.loss], 'friendly: no rating, and it pays like a loss')
    const loss = (await b.call('me')).notices.find(n => n.kind === 'defense-loss')!
    assert.equal(loss.handle, handle(a))
    // the defender takes revenge as usual
    await statsAll(s, b, STRONG)
    await statsAll(s, a, WEAK)
    const back = await fight(s, b, { kind: 'duel', family: 'fable', revenge: handle(a) })
    assert.ok(back.start.opponent.kind === 'player' && back.start.opponent.handle === handle(a))
  })

  it('refuses the caller, an unknown handle and a player with no team, and keeps the duel spacing', async () => {
    const s = server()
    const [a, b] = [await s.join(), await s.join()]
    const before = (await a.row()).last_duel_at
    const self = await a.fails('startBattle', { kind: 'duel', family: 'opus', handle: handle(a) })
    assert.deepEqual([self.status, self.code], [403, 'not_allowed'])
    assert.equal((await a.fails('startBattle', { kind: 'duel', family: 'opus', handle: 'nobody-here-00' })).code, 'not_found')
    await b.call('setTeam', { cardIds: [] })
    assert.equal((await a.fails('startBattle', { kind: 'duel', family: 'opus', handle: handle(b) })).message, '403 not_allowed: They have no team out right now')
    assert.equal((await a.row()).last_duel_at, before, 'a refused challenge spends no spacing')
    await b.call('setTeam', { cardIds: b.me.player.team })
    await a.call('startBattle', { kind: 'duel', family: 'opus', handle: handle(b) })
    s.tick(DUEL - 1)
    assert.equal((await a.fails('startBattle', { kind: 'duel', family: 'opus', handle: handle(b) })).code, 'rate_limited', '2 minutes apart, like any duel')
    for (const body of [
      { kind: 'wild', family: 'opus', handle: handle(b) },
      { kind: 'duel', family: 'opus', handle: handle(b), revenge: handle(b) },
      { kind: 'duel', family: 'opus', handle: 'not a handle' },
    ]) assert.equal((await s.request('POST', '/v1/battles', { token: a.token, body })).status, 400, JSON.stringify(body))
  })

  it('never pays more than a loss, moves no rating, stat, streak or pack, and tells the defender of 3 a day at most', async () => {
    const s = server()
    const [a, b] = [await s.join(), await s.join()]
    await statsAll(s, a, STRONG)
    await statsAll(s, b, WEAK)
    const before = { a: await a.row(), b: await b.row() }
    const fins = []
    for (let i = 0; i < 12; i++) {
      await statsAll(s, a, STRONG)
      fins.push((await fight(s, a, { kind: 'duel', family: 'opus', handle: handle(b) })).fin)
    }
    // farming one weak team pays the sparks of a loss: no bounty, streak, streak pack or daily pack, no rating
    for (const fin of fins) {
      assert.deepEqual([fin.result, fin.sparks, fin.ratingDelta, fin.bounty, fin.streak, fin.streakPack, fin.dailyWinPack],
        ['win', ECONOMY.battle.sparks.loss, 0, null, before.a.streak, false, false])
    }
    const after = { a: await a.row(), b: await b.row() }
    assert.equal(after.a.sparks, before.a.sparks + 12 * ECONOMY.battle.sparks.loss)
    assert.deepEqual([after.a.rating, after.b.rating, after.b.sparks], [before.a.rating, before.b.rating, before.b.sparks])
    assert.equal((await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM cards WHERE owner_id = ? AND origin = ?', a.id, 'bounty'))!.n, 0)
    const [sa, sb] = [await statsOf(a), await statsOf(b)]
    assert.deepEqual([sa.duelWins, sa.playersBeaten, sb.duelLosses], [0, 0, 0], 'a challenge pads no board')
    // the defender hears of the first 3 in 24 hours, so their notices cannot be flooded
    const told = (await b.call('me')).notices.filter(n => n.kind === 'defense-loss')
    assert.equal(told.length, ECONOMY.battle.pairLimit)
    // and the challenges spend the pair's limit: a matched duel between them now moves nothing either
    assert.equal((await beat(s, a, b)).fin.ratingDelta, 0)
  })
})

describe('stats', () => {
  it('count duel wins and losses on both sides, and each player beaten once, never who', async () => {
    const s = server()
    const [a, b, c] = [await s.join(), await s.join(), await s.join()]
    await beat(s, a, b)
    await beat(s, a, b)
    await beat(s, a, c)
    await beat(s, b, a)
    // a defense that holds is a win for the defender
    await statsAll(s, c, WEAK)
    await statsAll(s, b, STRONG)
    assert.equal((await duel(s, c, b)).fin.result, 'loss')
    const [sa, sb, sc] = [await statsOf(a), await statsOf(b), await statsOf(c)]
    assert.deepEqual([sa.duelWins, sa.duelLosses, sa.playersBeaten], [3, 1, 2])
    assert.deepEqual([sb.duelWins, sb.duelLosses, sb.playersBeaten], [2, 2, 2])
    assert.deepEqual([sc.duelWins, sc.duelLosses, sc.playersBeaten], [0, 2, 0])
    nextDay(s)
    const profile = await c.call('profile', { handle: handle(a) })
    assert.deepEqual(profile.stats, sa)
    assertNoIds(profile, [a.id, b.id, c.id], 'profile')
    // Rival duels count for no player's board
    await statsAll(s, c, STRONG)
    await s.db.batch([stmt('UPDATE players SET team_size = 0 WHERE id != ?', c.id)])
    const rival = await fight(s, c, { kind: 'duel', family: 'opus' })
    assert.equal(rival.start.opponent.kind, 'rival')
    assert.equal((await statsOf(c)).duelWins, 0)
  })

  it('show other players the numbers of the last midnight, never a count moving as it happens', async () => {
    const s = server()
    const [a, b] = [await s.join(), await s.join()]
    await statsAll(s, a, STRONG)
    nextDay(s)
    const seen = async () => {
      const p = await b.call('profile', { handle: handle(a) })
      const top = (await b.call('rankings', { board: 'rating' })).top.find(r => r.handle === handle(a))
      const old = (await b.call('leaderboard', {})).top.find(r => r.handle === handle(a))
      return { wild: p.stats!.wildWins, species: p.seenCount, league: p.league, rating: top?.value, old: old?.rating }
    }
    const midnight = await seen()
    assert.deepEqual(midnight, { wild: 0, species: 3, league: 'Pebble', rating: undefined, old: undefined })
    let wins = 0
    for (let i = 0; i < 6; i++) {
      await statsAll(s, a, STRONG)
      s.tick(ECONOMY.battle.wildSpacingMs)
      const start = await a.call('startBattle', { kind: 'wild', family: 'opus' })
      s.set(Math.max(s.now(), readyAt(start)))
      if ((await a.call('finishBattle', { battleId: start.id, inputs: [] })).result === 'win') wins++
      // the player sees their own numbers at once; everyone else, the same as at midnight all day
      assert.equal((await statsOf(a)).wildWins, wins)
      assert.deepEqual(await seen(), midnight)
    }
    assert.ok(wins > 0)
    await s.db.batch([stmt('UPDATE players SET rating = 1600 WHERE id = ?', a.id)])
    assert.deepEqual(await seen(), midnight, 'nor a rating or league')
    nextDay(s)
    const today = await seen()
    assert.deepEqual([today.wild, today.league, today.rating, today.old], [wins, leagueOf(1600).name, 1600, 1600])
    assert.equal(today.species, (await statsOf(a)).speciesCollected)
  })

  it('count wild wins and catches, new species, first finds, Mythics found and market sales', async () => {
    const s = server()
    const [a, b] = [await s.join(), await s.join()]
    const zero = await statsOf(a)
    assert.equal(zero.speciesCollected, 3, 'the starters')
    await statsAll(s, a, STRONG)
    let wins = 0, caught = 0
    for (let i = 0; i < 12 && !caught; i++) {
      s.tick(ECONOMY.battle.wildSpacingMs)
      const start = await a.call('startBattle', { kind: 'wild', family: 'opus' })
      s.set(Math.max(s.now(), readyAt(start)))
      const fin = await a.call('finishBattle', { battleId: start.id, inputs: [] })
      if (fin.result === 'win') wins++
      if (fin.catchOptions.length) {
        await a.call('catchCreature', { battleId: start.id, index: 0 })
        caught++
      }
    }
    assert.ok(caught === 1)
    let st = await statsOf(a)
    assert.deepEqual([st.wildWins, st.catches], [wins, 1])
    assert.equal(st.speciesCollected, (await a.call('me')).player.seen.length, 'species collected is the album')
    const firsts = (await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM firsts WHERE player_id = ?', a.id))!.n
    assert.equal(st.firstFinds, firsts)
    // a Mythic caught (minted the way a catch mints it)
    const { stmts } = await mintCards(envOf(s), a.id, [generateMythic({ seed: 'stats-mythic', dna: 1, now: s.now(), origin: 'catch' })])
    await s.db.batch(stmts)
    st = await statsOf(a)
    assert.equal(st.mythicsFound, 1)
    // a sale
    const [x] = await fresh(s, a, 1, { species: 's1-sonnet-6' })
    const { listing } = await a.call('listCard', { cardId: x!.id, price: 1 })
    const seenBefore = (await statsOf(b)).speciesCollected
    await b.call('buyListing', { listingId: listing.id })
    assert.equal((await statsOf(a)).marketSales, 1)
    assert.ok((await statsOf(b)).speciesCollected >= seenBefore, 'a card bought fills the album')
    // the same species twice counts once
    const again = await statsOf(a)
    const [y] = await fresh(s, a, 1, { species: 's1-sonnet-6' })
    assert.ok(y)
    assert.equal((await statsOf(a)).speciesCollected, again.speciesCollected)
  })
})

describe('the leaderboards', () => {
  const board = (p: Player, b: BoardName, period: 'all' | 'season' = 'all') => p.call('rankings', { board: b, period })

  it('list every player by default, best first, ties sharing a rank, with the caller\'s own row', async () => {
    const s = server()
    const ps = [await s.join(), await s.join(), await s.join(), await s.join()]
    const ratings = [1300, 1500, 1500, 1100]
    await s.db.batch(ps.map((p, i) => stmt('UPDATE players SET rating = ?, battles = 1 WHERE id = ?', ratings[i]!, p.id)))
    nextDay(s)
    const res = await board(ps[3]!, 'rating')
    assert.deepEqual([res.board, res.period, res.season], ['rating', 'all', 1])
    assert.deepEqual(res.top.map(r => [r.rank, r.value]), [[1, 1500], [1, 1500], [3, 1300], [4, 1100]])
    assert.deepEqual(res.top.slice(0, 2).map(r => r.handle), [handle(ps[1]!), handle(ps[2]!)].sort())
    assert.deepEqual(res.me, { rank: 4, handle: handle(ps[3]!), league: 'Brook', value: 1100 })
    for (const r of res.top) assert.deepEqual(Object.keys(r).sort(), ['handle', 'league', 'rank', 'value'])
    assertNoIds(res, ps.map(p => p.id), 'rankings')
    // defaults: the rating board, all time
    assert.deepEqual(await ps[0]!.call('rankings', {}), { ...res, me: { rank: 3, handle: handle(ps[0]!), league: 'Grove', value: 1300 } })
  })

  it('hide a player who opts out from every board, their own rank and their profile\'s stats, and back again', async () => {
    const s = server()
    const [a, b] = [await s.join(), await s.join()]
    await beat(s, a, b)
    nextDay(s)
    assert.ok((await board(b, 'duelWins')).top.some(r => r.handle === handle(a)))
    assert.deepEqual(await a.call('setLeaderboard', { optIn: false }), { leaderboard: false })
    assert.equal((await a.call('me')).player.leaderboard, false)
    for (const name of ['rating', 'beaten', 'duelWins', 'species'] as const) {
      const res = await board(b, name)
      assert.ok(!res.top.some(r => r.handle === handle(a)), name)
      assert.equal((await board(a, name)).me, undefined, `${name}: no own row while hidden`)
    }
    assert.ok(!(await b.call('leaderboard', {})).top.some(r => r.handle === handle(a)))
    assert.equal((await b.call('profile', { handle: handle(a) })).stats, undefined)
    assert.ok((await a.call('me')).player.stats, 'a player always sees their own stats')
    await a.call('setLeaderboard', { optIn: true })
    assert.equal((await board(b, 'duelWins')).top[0]!.handle, handle(a))
  })

  it('leave a player off a board until they have something on it', async () => {
    const s = server()
    const [a, b] = [await s.join(), await s.join()]
    assert.deepEqual((await board(a, 'rating')).top, [], 'nobody has battled')
    assert.equal((await board(a, 'sales')).me, undefined)
    await beat(s, a, b)
    nextDay(s)
    const res = await board(b, 'beaten')
    assert.deepEqual(res.top.map(r => [r.handle, r.value]), [[handle(a), 1]])
    assert.equal(res.me, undefined)
  })

  it('count this season only on the season boards, and start each season from nothing', async () => {
    const s = server()
    const [a, b, c] = [await s.join(), await s.join(), await s.join()]
    await beat(s, a, b)
    await beat(s, c, b)
    nextDay(s)
    assert.deepEqual((await board(b, 'beaten', 'season')).top.map(r => r.value), [1, 1])
    // season 2: a season's counts zero on the player's first count of the new season
    s.set(T0 + SEASON_MS)
    await b.call('me')
    const fresh2 = await board(b, 'beaten', 'season')
    assert.deepEqual([fresh2.season, fresh2.top], [2, []], 'last season\'s wins are not this season\'s')
    await beat(s, a, b)
    nextDay(s)
    const now = await board(b, 'beaten', 'season')
    assert.deepEqual(now.top.map(r => [r.handle, r.value]), [[handle(a), 1]], 'the same player beaten again counts for the new season')
    assert.deepEqual((await board(b, 'beaten', 'all')).top.map(r => [r.handle, r.value]).sort(), [[handle(a), 1], [handle(c), 1]].sort(), 'but once all time')
    const row = (await s.db.get<PlayerRow>('SELECT * FROM players WHERE id = ?', a.id))!
    assert.deepEqual([row.stats_season, row.s_duel_wins, row.duel_wins], [2, 1, 2])
    // the rating board of a season lists those who have played in it, with their reset rating
    const rating = await board(b, 'rating', 'season')
    assert.ok(rating.top.every(r => [handle(a), handle(b)].includes(r.handle)), 'c has not been back this season')
  })

  it('show at most 50 and the caller\'s rank beyond them', async () => {
    const s = server()
    const me = await s.join()
    const others: Player[] = []
    for (let i = 0; i < ECONOMY.boards.size + 4; i++) others.push(await s.join())
    await s.db.batch(others.map((p, i) => stmt('UPDATE players SET species_count = ? WHERE id = ?', 100 + i, p.id)))
    nextDay(s)
    const res = await board(me, 'species')
    assert.equal(res.top.length, ECONOMY.boards.size)
    assert.equal(res.top[0]!.value, 100 + ECONOMY.boards.size + 3)
    assert.deepEqual(res.me, { rank: others.length + 1, handle: handle(me), league: 'Pebble', value: 3 })
  })

  it('never list a Rival, a deleted player or a hidden one, and parse the query strictly', async () => {
    const s = server()
    const [a, b] = [await s.join(), await s.join()]
    await beat(s, a, b)
    await s.db.batch([stmt('UPDATE players SET team_size = 0')])
    await statsAll(s, b, STRONG)
    await fight(s, b, { kind: 'duel', family: 'opus' })
    nextDay(s)
    const names = (await board(b, 'rating')).top.map(r => r.handle).sort()
    assert.deepEqual(names, [handle(a), handle(b)].sort(), 'Rivals are not players')
    await a.call('deleteMe')
    assert.ok(!(await board(b, 'duelWins')).top.length)
    assert.deepEqual(await s.db.all('SELECT * FROM beaten'), [], 'a deleted player\'s pairs go, both ways')
    for (const q of ['board=richest', 'period=week', 'board=rating&board=sales', 'sort=newest']) {
      assert.equal((await s.request('GET', `/v1/leaderboards?${q}`, { token: b.token })).status, 400, q)
    }
  })
})

describe('the 0003 migration', () => {
  it('backfills stats from what the database knew, frees every lock and tells everyone the boards are open', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const all = loadMigrations()
    migrateSqlite(sqlite, all.filter(m => m.name < '0003'))
    const db = nodeDb(sqlite)
    const player = (id: string, handle: string, season: number) =>
      stmt(`INSERT INTO players (id, handle, joined, last_seen, season) VALUES (?, ?, '2026-10-01', '2026-10-05', ?)`, id, handle, season)
    const duel = (id: string, att: string, def: string, result: string, settled: string) =>
      stmt(`INSERT INTO battles (id, attacker_id, defender_id, kind, state, setup, opponent, started_at, settled, result)
            VALUES (?, ?, ?, 'duel', 'settled', '{}', '{}', 0, ?, ?)`, id, att, def, settled, result)
    const card = (id: string, owner: string, origin: string, locked: number) =>
      stmt(`INSERT INTO cards (id, owner_id, species, season, family, rarity, dna, genes, traits, origin, minted, locked_until)
            VALUES (?, ?, 's1-opus-1', 1, 'opus', 'common', 1, '[1,1,1,1]', '["swift"]', ?, '2026-10-02', ?)`, id, owner, origin, locked)
    await db.batch([
      player('pa', 'ann-a-11', 1), player('pb', 'ben-b-22', 1), player('pc', 'cat-c-33', 2),
      duel('d1', 'pa', 'pb', 'win', '2026-10-03'), duel('d2', 'pa', 'pb', 'win', '2026-10-04'), duel('d3', 'pb', 'pa', 'win', '2026-10-04'),
      duel('d4', 'pc', 'pa', 'loss', '2026-10-29'), duel('d5', 'pa', 'pc', 'draw', '2026-10-29'),
      stmt(`INSERT INTO battles (id, attacker_id, kind, state, setup, opponent, started_at, settled, result) VALUES ('w1', 'pa', 'wild', 'settled', '{}', '{}', 0, '2026-10-04', 'win')`),
      card('c1', 'pa', 'catch', 0), card('c2', 'pa', 'catch', 0), card('c3', 'pa', 'catch', 0), card('c4', 'pb', 'pack', T0 + 7 * DAY),
      stmt(`INSERT INTO album (player_id, species) VALUES ('pa', 's1-opus-1'), ('pa', 's1-opus-2'), ('pa', 's2-opus-1'), ('pc', 's2-fable-1')`),
      stmt(`INSERT INTO firsts (species, season, player_id, card_id, day) VALUES ('s1-opus-1', 1, 'pa', 'c1', '2026-10-02')`),
      stmt(`INSERT INTO mythics (card_id, name, finder_id, handle, day) VALUES ('m1', 'Glimmer', 'pa', 'ann-a-11', '2026-10-03'), ('m2', 'Hollow', 'pc', 'cat-c-33', '2026-10-30')`),
      stmt(`INSERT INTO packs (id, owner_id, family, source, created, lock_until) VALUES ('k1', 'pb', 'opus', 'welcome', '2026-10-01', ?)`, T0 + 7 * DAY),
    ])
    const v0 = await db.get<{ cards_version: number }>(`SELECT cards_version FROM players WHERE id = 'pb'`)
    migrateSqlite(sqlite, all)
    const rows = await db.all<PlayerRow>('SELECT * FROM players ORDER BY id')
    const pick = (r: PlayerRow) => [r.duel_wins, r.duel_losses, r.beaten, r.wild_wins, r.catches, r.species_count, r.first_finds, r.mythics_found, r.market_sales, r.board_hidden]
    assert.deepEqual(rows.map(pick), [
      // pa: won d1, d2 and d4 (a defense that held), lost d3; beat pb and pc; 3 catches beat 1 wild win on record
      [3, 1, 2, 3, 3, 3, 1, 1, 0, 0],
      [1, 2, 1, 0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 1, 0, 1, 0, 0],
    ])
    const season = (r: PlayerRow) => [r.stats_season, r.s_duel_wins, r.s_beaten, r.s_species, r.s_mythics, r.s_sales]
    assert.deepEqual(rows.map(season), [[1, 2, 1, 2, 1, 0], [1, 1, 1, 0, 0, 0], [2, 0, 0, 1, 1, 0]])
    assert.deepEqual(await db.all('SELECT player_id, other_id, season FROM beaten ORDER BY player_id, other_id'), [
      { player_id: 'pa', other_id: 'pb', season: 1 }, { player_id: 'pa', other_id: 'pc', season: 2 }, { player_id: 'pb', other_id: 'pa', season: 1 },
    ])
    assert.deepEqual(await db.all('SELECT locked_until FROM cards WHERE locked_until > 0'), [])
    assert.deepEqual(await db.all('SELECT lock_until FROM packs WHERE lock_until > 0'), [])
    assert.ok((await db.get<{ cards_version: number }>(`SELECT cards_version FROM players WHERE id = 'pb'`))!.cards_version > v0!.cards_version)
    const told = await db.all<{ player_id: string; kind: string; text: string }>('SELECT player_id, kind, text FROM notices ORDER BY player_id')
    assert.deepEqual(told.map(n => [n.player_id, n.kind]), [['pa', 'notice'], ['pb', 'notice'], ['pc', 'notice']])
    assert.deepEqual([...new Set(told.map(n => n.text))], [NOTICE_TEXT.boardsOpen()])
  })

  it('is matched by a notice to every player who joins after it', async () => {
    const s = server()
    const a = await s.join()
    assert.deepEqual(a.me.notices.map(n => [n.kind, n.text]), [['notice', NOTICE_TEXT.onBoards()]])
  })
})

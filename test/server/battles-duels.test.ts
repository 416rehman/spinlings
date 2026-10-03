// Duels end to end: matchmaking (rating windows, the 14-day and last-5 rules), Rival trainers, Elo
// with the pair limit, defense sparks and notices, revenge, settling from the defender's side, and
// what one player can learn about another through any of it (SPEC 5, 14, 15, 19, 20, 26).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { StartBattleRequest } from '../../plugin/hooks/core/api.ts'
import { eloDelta, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY, leagueOf } from '../../plugin/hooks/core/economy.ts'
import type { BattleSetup, Stats } from '../../plugin/hooks/core/types.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import { stmt } from '../../server/src/db.ts'
import { BATTLE_TEXT } from '../../server/src/game/battles.ts'
import { cardsOf } from '../../server/src/game/mint.ts'
import type { BattleRow } from '../../server/src/schema.ts'
import { DAY, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const STRONG: Stats = { hp: 999, atk: 999, def: 999, spd: 999 }
const WEAK: Stats = { hp: 1, atk: 1, def: 1, spd: 1 }
const DUEL = ECONOMY.battle.duelSpacingMs
const FAMILY_WORDS = /haiku|sonnet|opus|fable|arena/i

const statsAll = (s: Server, p: Player, stats: Stats) =>
  s.db.batch([stmt('UPDATE cards SET stats = ? WHERE owner_id = ?', JSON.stringify(stats), p.id)])
/** Wakes every card of the player (a lost battle tires them for 15 minutes). */
const rest = (s: Server, p: Player) => s.db.batch([stmt('UPDATE cards SET tired_until = 0 WHERE owner_id = ?', p.id)])
const setRow = (s: Server, p: Player, col: string, value: string | number) =>
  s.db.batch([stmt(`UPDATE players SET ${col} = ? WHERE id = ?`, value, p.id)])
const battleRow = async (s: Server, id: string) => (await s.db.get<BattleRow>('SELECT * FROM battles WHERE id = ?', id))!
const readyAt = (start: { startedAt: number; setup: BattleSetup }) =>
  start.startedAt + simulateBattle(start.setup, []).rounds.length * ECONOMY.battle.minRoundMs

const DUEL_REQ: StartBattleRequest = { kind: 'duel', family: 'opus' }

async function fight(s: Server, p: Player, req: StartBattleRequest = DUEL_REQ) {
  const start = await p.call('startBattle', req)
  s.set(Math.max(s.now(), readyAt(start)))
  const fin = await p.call('finishBattle', { battleId: start.id, inputs: [] })
  return { start, fin }
}

/** Who a duel is matched with ('rival' for a Rival), fought to the end after the duel spacing by a team that cannot faint. */
async function matched(s: Server, p: Player): Promise<string> {
  s.tick(DUEL)
  await statsAll(s, p, STRONG)
  await rest(s, p)
  const { start } = await fight(s, p)
  return start.opponent.kind === 'player' ? start.opponent.handle : start.opponent.kind
}

describe('duel matchmaking', () => {
  it('fills in a Rival trainer when no real player fits, sized to the team, moving only the player\'s rating', async () => {
    const s = server()
    const a = await s.join()
    await statsAll(s, a, WEAK)
    const start = await a.call('startBattle', DUEL_REQ)
    assert.equal(start.opponent.kind, 'rival')
    const row = await battleRow(s, start.id)
    const rival = JSON.parse(row.opponent) as { kind: string; name: string; rating: number }
    assert.deepEqual(start.opponent, { kind: 'rival', name: rival.name, league: leagueOf(rival.rating).name })
    assert.ok(Math.abs(rival.rating - 1000) <= ECONOMY.rival.ratingSpread)
    assert.deepEqual([row.kind, row.defender_id, start.setup.kind], ['rival', null, 'duel'])
    assert.deepEqual(start.setup.defender.map(c => c.id), ['rival-0', 'rival-1', 'rival-2'])
    s.set(start.finishAfter)
    const fin = await a.call('finishBattle', { battleId: start.id, inputs: [] })
    const delta = eloDelta(1000, rival.rating, fin.result).attacker
    assert.deepEqual([fin.ratingDelta, fin.rating, fin.bounty], [delta, 1000 + delta, null])
    assert.equal((await a.call('me')).player.rating, 1000 + delta)
  })

  it('matches a real player and shows only their handle, league and public team, tired or not', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join('fable')
    await s.db.batch([stmt('UPDATE cards SET tired_until = ? WHERE owner_id = ?', T0 + DAY, b.id)])
    const team = new Map((await cardsOf(s.db, b.id)).map(c => [c.card.id, c.card]))
    const start = await a.call('startBattle', DUEL_REQ)
    assert.deepEqual(start.opponent, { kind: 'player', handle: b.me.player.handle, league: 'Pebble' })
    assert.deepEqual(start.setup.defender, b.me.player.team.map(id => toBattleCard(team.get(id)!)))
    for (const card of start.setup.defender) {
      for (const key of ['mintedAt', 'lockedUntil', 'tiredUntil', 'origin', 'state', 'bound', 'forTrade', 'xp', 'raisedIn']) assert.ok(!(key in card), key)
    }
    assert.ok(!JSON.stringify(start).includes(b.id), 'never the player id')
    const row = await battleRow(s, start.id)
    assert.deepEqual([row.kind, row.defender_id], ['duel', b.id])
    assert.deepEqual(JSON.parse((await a.row()).recent_opponents), [b.id])

    // the snapshot is what battles: the defender changing their team meanwhile changes nothing
    await b.call('setTeam', { cardIds: [b.me.player.team[2]!] })
    s.set(start.finishAfter)
    assert.deepEqual((await a.call('finishBattle', { battleId: start.id, inputs: [] })).log, simulateBattle(start.setup, []))
  })

  it('only matches players with a team, seen in the last 14 days, and not among the last 5 opponents', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    const handle = b.me.player.handle
    await setRow(s, b, 'last_seen', utcDay(T0 - 15 * DAY))
    assert.equal(await matched(s, a), 'rival')
    await setRow(s, b, 'last_seen', utcDay(T0 - 14 * DAY))
    await setRow(s, b, 'team_size', 0)
    assert.equal(await matched(s, a), 'rival')
    await setRow(s, b, 'team_size', 3)
    await setRow(s, a, 'recent_opponents', '[]')
    const seq = []
    for (let i = 0; i < 7; i++) seq.push(await matched(s, a))
    assert.deepEqual(seq, [handle, 'rival', 'rival', 'rival', 'rival', 'rival', handle])
  })

  it('picks from the first rating window with anyone in it: ±150, then ±400, then anyone', async () => {
    // margins leave room for the rating the pushed-aside duels move
    const s = server()
    const a = await s.join()
    const [b, c, d] = [await s.join(), await s.join(), await s.join()]
    await setRow(s, b!, 'rating', 1100)
    await setRow(s, c!, 'rating', 1290)
    await setRow(s, d!, 'rating', 2200)
    const next = async () => {
      await setRow(s, a, 'recent_opponents', '[]')
      return matched(s, a)
    }
    for (let i = 0; i < 3; i++) assert.equal(await next(), b!.me.player.handle)
    await setRow(s, b!, 'rating', 2000)
    for (let i = 0; i < 3; i++) assert.equal(await next(), c!.me.player.handle)
    await setRow(s, c!, 'rating', 2100)
    const anyone = new Set<string>()
    for (let i = 0; i < 12; i++) anyone.add(await next())
    assert.ok([...anyone].every(h => [b, c, d].some(p => p!.me.player.handle === h)))
    assert.ok(anyone.size >= 2, 'uniform over everyone once no window has anybody')
  })
})

describe('rating, defense and the pair limit', () => {
  it('moves both ratings and pays defense sparks only for the first 3 duels of a pair in 24 hours', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    const duelB = async (attacker: Player) => {
      await setRow(s, attacker, 'recent_opponents', '[]')
      await statsAll(s, a, WEAK)
      await rest(s, a)
      const before = { a: await a.row(), b: await b.row() }
      const { fin } = await fight(s, attacker)
      s.tick(DUEL)
      return { fin, before, after: { a: await a.row(), b: await b.row() } }
    }
    const first = await duelB(a)
    const elo = eloDelta(1000, 1000, 'loss')
    assert.deepEqual([first.fin.result, first.fin.ratingDelta, first.fin.rating], ['loss', elo.attacker, 1000 + elo.attacker])
    assert.deepEqual([first.after.b.rating, first.after.b.sparks], [1000 + elo.defender, 104])
    await duelB(b) // the pair counts both ways
    const third = await duelB(a)
    assert.notEqual(third.fin.ratingDelta, 0)
    const fourth = await duelB(a)
    assert.deepEqual([fourth.fin.result, fourth.fin.ratingDelta, fourth.fin.rating], ['loss', 0, fourth.before.a.rating])
    assert.deepEqual([fourth.after.b.rating, fourth.after.b.sparks], [fourth.before.b.rating, fourth.before.b.sparks])
    // the defender hears of the duels inside the pair limit only, so nobody can fill their notices
    const notes = (await b.call('me')).notices.filter(n => n.kind === 'defense-win')
    assert.deepEqual(notes.map(n => n.text), [BATTLE_TEXT.defenseWin(4), BATTLE_TEXT.defenseWin(4)])

    s.set(T0 + 2 * DAY)
    assert.notEqual((await duelB(a)).fin.ratingDelta, 0, 'a new day for the pair')
  })

  it('tells the defender only the other handle and the result, by the day, and never tires their team', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    const cardsBefore = JSON.stringify(await cardsOf(s.db, b.id))
    await statsAll(s, a, STRONG)
    const { fin } = await fight(s, a, { kind: 'duel', family: 'haiku' })
    assert.equal(fin.result, 'win')
    const elo = eloDelta(1000, 1000, 'win')
    const me = await b.call('me')
    me.notices = me.notices.filter(n => n.kind !== 'notice')
    assert.deepEqual(me.notices.map(n => ({ ...n, id: '' })), [
      { id: '', day: utcDay(s.now()), kind: 'defense-loss', text: BATTLE_TEXT.defenseLoss(), handle: a.me.player.handle },
    ])
    assert.doesNotMatch(me.notices[0]!.text, FAMILY_WORDS)
    assert.deepEqual([me.player.rating, me.player.sparks, me.player.battles], [1000 + elo.defender, 100, 0])
    assert.equal(JSON.stringify(await cardsOf(s.db, b.id)), cardsBefore, 'defending changes no card')
    const row = await battleRow(s, (await s.db.get<{ id: string }>('SELECT id FROM battles'))!.id)
    assert.deepEqual([row.setup, row.opponent], ['{}', '{}'], 'no arena or teams kept once settled')
  })

  it('settles an abandoned duel when the defender touches the server', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    await statsAll(s, a, STRONG)
    const start = await a.call('startBattle', DUEL_REQ)
    const version = (await a.row()).version
    s.tick(ECONOMY.battle.abandonMs)
    const me = await b.call('me')
    assert.equal((await battleRow(s, start.id)).state, 'settled')
    assert.deepEqual(me.notices.filter(n => n.kind !== 'notice').map(n => [n.kind, n.handle]), [['defense-loss', a.me.player.handle]])
    const row = await a.row()
    assert.deepEqual([row.battles, row.sparks, row.streak], [1, 112, 1])
    assert.ok(row.version > version)
    assert.equal((await a.fails('finishBattle', { battleId: start.id, inputs: [] })).code, 'conflict')
  })

  it('settles against a defender who has left the meadow', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    await statsAll(s, a, STRONG)
    const start = await a.call('startBattle', DUEL_REQ)
    await b.call('deleteMe')
    s.set(start.finishAfter)
    const fin = await a.call('finishBattle', { battleId: start.id, inputs: [] })
    assert.deepEqual([fin.result, fin.ratingDelta], ['win', eloDelta(1000, 1000, 'win').attacker])
    assert.equal((await s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM notices WHERE kind != 'notice'`))!.n, 0)
  })
})

describe('revenge', () => {
  it('duels the winner once within a day, bypassing matchmaking but not the spacing, for 5 extra sparks', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    await statsAll(s, a, STRONG)
    await fight(s, a)
    await s.join() // someone else matchmaking could pick now
    const revenge = { kind: 'duel', family: 'sonnet', revenge: a.me.player.handle } as const
    await statsAll(s, a, WEAK)
    await statsAll(s, b, STRONG)
    const start = await b.call('startBattle', revenge)
    assert.deepEqual(start.opponent, { kind: 'player', handle: a.me.player.handle, league: 'Pebble' })
    assert.equal((await battleRow(s, start.id)).revenge, 1)
    s.set(start.finishAfter)
    const fin = await b.call('finishBattle', { battleId: start.id, inputs: [] })
    assert.deepEqual([fin.result, fin.sparks], ['win', ECONOMY.battle.sparks.duelWin + ECONOMY.battle.revengeBonus])
    const used = await s.db.get<{ revenge_until: number | null }>(`SELECT revenge_until FROM notices WHERE player_id = ? AND kind = 'defense-loss'`, b.id)
    assert.equal(used!.revenge_until, null)
    s.tick(DUEL)
    const again = await b.fails('startBattle', revenge)
    assert.deepEqual([again.status, again.code], [404, 'not_found'])
  })

  it('answers 404 alike for no open revenge, an unknown handle, oneself and a day too late', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    const tries = async () => [
      await b.fails('startBattle', { kind: 'duel', family: 'opus', revenge: a.me.player.handle }),
      await b.fails('startBattle', { kind: 'duel', family: 'opus', revenge: 'nobody-here-99' }),
      await b.fails('startBattle', { kind: 'duel', family: 'opus', revenge: b.me.player.handle }),
    ]
    const before = await tries()
    await statsAll(s, a, STRONG)
    await fight(s, a)
    s.tick(DAY)
    const after = await tries()
    for (const f of [...before, ...after]) assert.deepEqual([f.status, f.code, f.message], [404, 'not_found', before[0]!.message])
    assert.equal((await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM battles WHERE attacker_id = ?', b.id))!.n, 0)
  })

  it('waits out the duel spacing like any duel', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    await statsAll(s, a, STRONG)
    await fight(s, a)
    await fight(s, b)
    const early = await b.fails('startBattle', { kind: 'duel', family: 'opus', revenge: a.me.player.handle })
    assert.deepEqual([early.status, early.code], [429, 'rate_limited'])
    s.tick(DUEL)
    await rest(s, b)
    assert.equal((await b.call('startBattle', { kind: 'duel', family: 'opus', revenge: a.me.player.handle })).opponent.kind, 'player')
  })
})

describe('what a duel shows of one player to another', () => {
  it('never puts a rating, count, date or arena of another player in any answer', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    await setRow(s, b, 'rating', 1234)
    await setRow(s, b, 'battles', 77)
    await statsAll(s, a, STRONG)
    // the league shown is the one of the last midnight (SPEC 20.3): b's rating moved today, so the next day
    s.set(T0 + DAY)
    const { start, fin } = await fight(s, a)
    const seen = JSON.stringify([start, fin, await a.call('me')])
    for (const secret of [b.id, '"rating":1234', '"battles":77']) assert.ok(!seen.includes(secret), secret)
    assert.deepEqual(start.opponent, { kind: 'player', handle: b.me.player.handle, league: leagueOf(1234).name })
    const notice = (await b.call('me')).notices.find(n => n.kind === 'defense-loss')!
    assert.deepEqual(Object.keys(notice).sort(), ['day', 'handle', 'id', 'kind', 'text'])
    assert.doesNotMatch(notice.text, FAMILY_WORDS)
  })
})
